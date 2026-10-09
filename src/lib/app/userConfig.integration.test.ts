// The user's profiles and code files across the whole chain (plan AD-29, M13 integration):
// `userConfig.load()` → `codes.reload` → `profiles.reload` → `machines` → re-detection, and the
// commands and the save hook of `contrib/userConfig.ts` on top.
//
// Nothing is faked above the Tauri boundary. The real singletons run: `userConfig`, `profiles`,
// `codes`, `machines`, `docs`, `files`, `settings`, `status`, `results`, the platform wrappers
// of `platform/commands.ts`, the native-dialog wrappers. What is replaced is `invoke` (a small
// in-memory model of the five Rust commands of `userfiles.rs`, the machines file and the file
// stat, with the same rules: lower-case names only, a name never overwritten, one JSON object
// per file) and the two plugins (`plugin-fs` bytes, `plugin-dialog` picks).
//
// The unit tests of each work package fake the neighbours (`app/userConfig.test.ts` has the
// real registries but no machines, no documents and no commands; `contrib/userConfig.test.ts`
// has the commands over a fake service). This file is the one that fails when two packages
// disagree about a contract.

import { get } from 'svelte/store';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigLoad } from '$lib/platform/commands';
import type { DocId } from '$lib/app/types';

const CONFIG = '/cfg';

// -- the Tauri boundary -----------------------------------------------------------------------

const boundary = vi.hoisted(() => {
  const state = {
    /** Every file by absolute path (the two folders, the machines file, picked and exported files). */
    disk: new Map<string, string>(),
    /** Files the folder lists with a reason instead of a text. */
    unreadable: new Map<string, string>(),
    /** What the open dialog answers next, and the save dialog. */
    pick: null as string | null,
    saveTo: null as string | null,
    calls: [] as string[],
    machinesSaved: [] as Record<string, unknown>[],
    machinesFailing: false,
  };
  const dir = (kind: string): string => {
    if (kind !== 'profiles' && kind !== 'codes') throw `unknown kind of user file: "${kind}"`;
    return `/cfg/${kind}`;
  };
  const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  const rule = /^[a-z0-9][a-z0-9._-]{0,63}\.json$/;
  const isObject = (text: string): boolean => {
    try {
      const value: unknown = JSON.parse(text);
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    } catch {
      return false;
    }
  };
  async function invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    state.calls.push(command);
    switch (command) {
      case 'user_files_list': {
        const folder = dir(args.kind as string);
        const names = new Set<string>();
        for (const path of [...state.disk.keys(), ...state.unreadable.keys()]) {
          if (path.startsWith(`${folder}/`) && rule.test(baseOf(path))) names.add(baseOf(path));
        }
        return [...names].sort().map((name) => {
          const reason = state.unreadable.get(`${folder}/${name}`);
          return reason === undefined
            ? { name, text: state.disk.get(`${folder}/${name}`) ?? '', error: null }
            : { name, text: null, error: reason };
        });
      }
      case 'user_file_create': {
        const folder = dir(args.kind as string);
        const name = args.name as string;
        if (!rule.test(name)) throw `${name} is not a user file name`;
        if (!isObject(args.text as string)) throw 'not a JSON object';
        const path = `${folder}/${name}`;
        if (state.disk.has(path) || state.unreadable.has(path)) throw 'already exists';
        state.disk.set(path, args.text as string);
        return path;
      }
      case 'user_file_path': {
        const path = `${dir(args.kind as string)}/${args.name as string}`;
        if (!state.disk.has(path)) throw 'not found';
        return path;
      }
      case 'user_file_import': {
        const folder = dir(args.kind as string);
        const src = args.src as string;
        const text = state.disk.get(src);
        if (text === undefined) throw 'not found';
        const name = baseOf(src).toLowerCase();
        if (!rule.test(name)) throw `${name} is not a user file name`;
        if (!isObject(text)) throw 'not a JSON object';
        if (state.disk.has(`${folder}/${name}`)) throw 'already exists';
        state.disk.set(`${folder}/${name}`, text);
        return name;
      }
      case 'user_file_delete': {
        const path = `${dir(args.kind as string)}/${args.name as string}`;
        if (!state.disk.delete(path)) throw 'not found';
        return undefined;
      }
      case 'machines_save': {
        if (state.machinesFailing) throw 'disk full';
        state.machinesSaved.push(args.machines as Record<string, unknown>);
        state.disk.set('/cfg/machines.json', JSON.stringify(args.machines));
        return undefined;
      }
      case 'machines_open_file': {
        if (!state.disk.has('/cfg/machines.json')) state.disk.set('/cfg/machines.json', '{}');
        return '/cfg/machines.json';
      }
      case 'files_stat':
        return (args.paths as string[]).map((path) => {
          const text = state.disk.get(path);
          return {
            path,
            allowed: true,
            exists: text !== undefined,
            isDir: false,
            mtimeMs: text === undefined ? null : 1,
            size: text === undefined ? null : text.length,
            readonly: false,
          };
        });
      case 'config_load':
        return {
          settings: { $version: 1 },
          settingsError: null,
          ui: {},
          stateError: null,
          machines: {},
          machinesError: null,
          paths: {
            configDir: '/cfg',
            dataDir: '/data',
            settingsFile: '/cfg/settings.json',
            stateFile: '/data/state.json',
            userScriptsDir: '/cfg/scripts',
            machinesFile: '/cfg/machines.json',
            profilesDir: '/cfg/profiles',
            codesDir: '/cfg/codes',
          },
        };
      case 'files_backup':
        return null;
      case 'files_set_dirty':
        return undefined;
      default:
        throw new Error(`the Tauri boundary of this test does not know ${command}`);
    }
  }
  return { state, invoke };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: boundary.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {}, emit: async () => {} }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: async (path: string): Promise<Uint8Array> => {
    const text = boundary.state.disk.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return new TextEncoder().encode(text);
  },
  writeFile: async (path: string, bytes: Uint8Array): Promise<void> => {
    boundary.state.disk.set(path, new TextDecoder().decode(bytes));
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: async (): Promise<string | null> => boundary.state.pick,
  save: async (): Promise<string | null> => boundary.state.saveTo,
  message: async (): Promise<void> => {},
  ask: async (): Promise<boolean> => true,
}));

// The real modules, loaded after the mocks (and after the runtime looks like Tauri).
let userConfig: typeof import('$lib/app/userConfig').userConfig;
let profiles: typeof import('$lib/stores/profiles').profiles;
let codes: typeof import('$lib/stores/codes').codes;
let machines: typeof import('$lib/stores/machines').machines;
let docs: typeof import('$lib/stores/documents').docs;
let files: typeof import('$lib/app/fileOps').files;
let settings: typeof import('$lib/stores/settings').settings;
let status: typeof import('$lib/app/status').status;
let results: typeof import('$lib/stores/results').results;
let editor: typeof import('$lib/monaco/editorService').editor;
let contribution: (typeof import('$lib/contrib/userConfig'))['default'];
let rowsOf: typeof import('$lib/components/dialogs/ProfilesPage.svelte').rowsOf;
let looseProblems: typeof import('$lib/components/dialogs/ProfilesPage.svelte').looseProblems;
let t: typeof import('$lib/i18n').t;

beforeAll(async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  ({ userConfig } = await import('$lib/app/userConfig'));
  ({ profiles } = await import('$lib/stores/profiles'));
  ({ codes } = await import('$lib/stores/codes'));
  ({ machines } = await import('$lib/stores/machines'));
  ({ docs } = await import('$lib/stores/documents'));
  ({ files } = await import('$lib/app/fileOps'));
  ({ settings } = await import('$lib/stores/settings'));
  ({ status } = await import('$lib/app/status'));
  ({ results } = await import('$lib/stores/results'));
  ({ editor } = await import('$lib/monaco/editorService'));
  ({ default: contribution } = await import('$lib/contrib/userConfig'));
  ({ rowsOf, looseProblems } = await import('$lib/components/dialogs/ProfilesPage.svelte'));
  ({ t } = await import('$lib/i18n'));

  boundary.state.disk.set('/cfg/machines.json', '{}');
  // The startup read, as `bootstrap.ts` does it: settings (fills `settings.paths`), then machines.
  await settings.load();
  machines.load((await boundary.invoke('config_load')) as ConfigLoad);
});

// -- helpers ----------------------------------------------------------------------------------

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const put = (kind: 'profiles' | 'codes', name: string, value: unknown | string): void => {
  boundary.state.disk.set(`${CONFIG}/${kind}/${name}`, typeof value === 'string' ? value : json(value));
};
const remove = (kind: 'profiles' | 'codes', name: string): void => {
  boundary.state.disk.delete(`${CONFIG}/${kind}/${name}`);
  boundary.state.unreadable.delete(`${CONFIG}/${kind}/${name}`);
};
const userProfile = (id: string, patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  name: `${id} lathe`,
  shortName: id.toUpperCase().slice(0, 8),
  version: 1,
  extends: 'fanuc-lathe',
  detect: { content: [] },
  ...patch,
});

let docCount = 0;
function addDoc(profileId: string, text: string, path: string | null = null): DocId {
  const id = docs.add({
    path,
    untitledIndex: path === null ? ++docCount : null,
    profileId,
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
  });
  editor.createModel(id, text, profileId, 'lf');
  return id;
}

const reports: string[] = [];
let unsubscribe: (() => void)[] = [];

async function empty(): Promise<void> {
  for (const kind of ['profiles', 'codes'] as const) {
    for (const key of [...boundary.state.disk.keys()]) if (key.startsWith(`${CONFIG}/${kind}/`)) boundary.state.disk.delete(key);
  }
  boundary.state.unreadable.clear();
  await userConfig.load();
}

beforeEach(async () => {
  reports.length = 0;
  boundary.state.pick = null;
  boundary.state.saveTo = null;
  boundary.state.machinesFailing = false;
  unsubscribe.push(results.current.subscribe((r) => r !== null && reports.push(r.title)));
});

afterEach(async () => {
  for (const off of unsubscribe.splice(0)) off();
  for (const doc of docs.all()) {
    editor.disposeModel(doc.id);
    docs.remove(doc.id);
  }
  for (const m of get(machines.list)) await machines.remove(m.id);
  await empty();
});

const run = (id: string, arg?: unknown): unknown => {
  const command = contribution.commands.find((c) => c.id === id);
  if (command === undefined) throw new Error(`no command ${id}`);
  return (command.run as (c: unknown, a: unknown) => unknown)({ activeDocId: docs.getActiveId() }, arg);
};

// -- the chain --------------------------------------------------------------------------------

describe('load: the real Rust commands’ shapes through the real stores', () => {
  it('a profile file and a code file become a profile and a database; the list says where each came from', async () => {
    put('codes', 'shop-lathe.json', { dialect: 'shop-lathe', extends: 'fanuc-lathe', codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }] });
    put('profiles', 'shop-lathe.json', userProfile('shop-lathe', { codes: 'shop-lathe' }));
    const before = get(profiles.revision);

    expect(await userConfig.load()).toEqual([]);

    expect(get(profiles.revision)).toBe(before + 1);
    expect(profiles.get('shop-lathe')).toMatchObject({ origin: 'user', file: 'shop-lathe.json' });
    expect(codes.byId('shop-lathe').codes.some((c) => c.code === 'M13')).toBe(true);
    expect(get(userConfig.files)).toEqual([
      { kind: 'profiles', name: 'shop-lathe.json', error: null },
      { kind: 'codes', name: 'shop-lathe.json', error: null },
    ]);
    // A load with nothing changed reloads nothing.
    expect(await userConfig.load()).toEqual([]);
    expect(get(profiles.revision)).toBe(before + 1);
  });

  it('a program in a user profile’s own folder is detected as that profile', async () => {
    put('profiles', 'shop-lathe.json', userProfile('shop-lathe', { detect: { folders: ['/shop/lathe-2/'], content: [] } }));
    await userConfig.load();
    expect(profiles.detect('/shop/lathe-2/part-17.nc', 'O0001\nG0 X0\nM30\n', 'fanuc-gcode')).toBe('shop-lathe');
    expect(profiles.detect('/elsewhere/part-17.nc', 'O0001\nG0 X0\nM30\n', 'fanuc-gcode')).not.toBe('shop-lathe');
  });

  it('every problem names the folder of its file, whichever package made it', async () => {
    put('profiles', 'bad-step.json', userProfile('bad-step', { numbering: { step: 'ten' } }));
    put('profiles', 'fanuc-gcode.json', userProfile('fanuc-gcode'));
    put('profiles', 'not-json.json', '{ "id": ');
    put('profiles', 'orphan.json', userProfile('orphan', { extends: 'nowhere' }));
    put('codes', 'mine.json', { dialect: 'mine', extends: 'fanuc-lathe', codes: {} });
    put('codes', 'wrong.json', { dialect: 'other', extends: 'fanuc-lathe', codes: [] });
    boundary.state.unreadable.set(`${CONFIG}/codes/huge.json`, 'larger than 1 MiB');

    const problems = await userConfig.load();

    expect(problems.length).toBeGreaterThanOrEqual(6);
    for (const problem of problems) expect(problem.kind, JSON.stringify(problem)).toMatch(/^(profiles|codes)$/);
    const where = (p: { file: string | null; kind?: string }): string => `${p.kind}/${p.file}`;
    expect(new Set(problems.map(where))).toEqual(
      new Set([
        'profiles/bad-step.json',
        'profiles/fanuc-gcode.json',
        'profiles/not-json.json',
        'profiles/orphan.json',
        'codes/mine.json',
        'codes/wrong.json',
        'codes/huge.json',
      ]),
    );
    // Built-ins are untouched by all of it.
    expect(profiles.get('fanuc-gcode')?.origin).toBe('builtin');
    expect(reports).toContain(t('userConfig.load.report.title'));
  });
});

describe('a profile file and a code file of one name', () => {
  it('never show each other’s problems on the page', async () => {
    put('profiles', 'twin.json', userProfile('twin', { extends: 'nowhere' }));
    put('codes', 'twin.json', { dialect: 'twin', extends: 'fanuc-lathe', codes: [{ code: 'M13', label: 'ok' }] });

    const problems = await userConfig.load();
    expect(problems.map((p) => `${p.kind}/${p.file}`)).toEqual(['profiles/twin.json']);

    const list = get(userConfig.files);
    const rows = rowsOf(profiles.list(), list, problems, t);
    const profileRow = rows.find((row) => row.kind === 'profile' && row.file === 'twin.json');
    const codeRow = rows.find((row) => row.kind === 'codes' && row.file === 'twin.json');
    expect(profileRow?.problems.join(' ')).toContain('nowhere');
    expect(codeRow?.problems).toEqual([]);
    expect(looseProblems(list, problems, t)).toEqual([]);
  });

  it('and the other way round', async () => {
    put('profiles', 'twin.json', userProfile('twin'));
    put('codes', 'twin.json', { dialect: 'twin', extends: 'nowhere', codes: [] });

    const problems = await userConfig.load();
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.kind === 'codes' && p.file === 'twin.json')).toBe(true);

    const rows = rowsOf(profiles.list(), get(userConfig.files), problems, t);
    expect(rows.find((row) => row.kind === 'profile' && row.file === 'twin.json')?.problems).toEqual([]);
    expect(rows.find((row) => row.kind === 'codes' && row.file === 'twin.json')?.problems.length).toBeGreaterThan(0);
  });
});

describe('machines follow the profile set', () => {
  it('a machine on a user profile that appears becomes active, and goes inactive when it vanishes', async () => {
    const raw = {
      $version: 1,
      machines: [{ id: 'shop-1', name: 'Shop lathe', profile: 'shop-lathe', params: {} }],
    };
    const summary = await machines.importMachines(raw);
    expect(summary).toMatchObject({ imported: 1, inactive: 1 });
    // Kept in the list, reported, and not offered for a program.
    expect(machines.problems().map((p) => p.machineId)).toEqual(['shop-1']);
    expect(machines.compatibleWith('fanuc-lathe')).toEqual([]);

    put('profiles', 'shop-lathe.json', userProfile('shop-lathe'));
    await userConfig.load();
    expect(machines.problems()).toEqual([]);
    expect(machines.compatibleWith('shop-lathe').map((m) => m.id)).toEqual(['shop-1']);

    remove('profiles', 'shop-lathe.json');
    await userConfig.load();
    expect(machines.problems().map((p) => p.machineId)).toEqual(['shop-1']);
    expect(machines.compatibleWith('fanuc-lathe')).toEqual([]);
    // Never deleted: the record is still in the file the machine service wrote.
    const saved = JSON.parse(boundary.state.disk.get('/cfg/machines.json') ?? '{}') as { machines?: { id: string }[] };
    expect(saved.machines?.map((m) => m.id)).toEqual(['shop-1']);
  });

  it('the cached view of an open document is rebuilt on the new profile set', async () => {
    put('profiles', 'shop-lathe.json', userProfile('shop-lathe', { numbering: { step: 5 } }));
    await userConfig.load();
    const id = addDoc('shop-lathe', 'O0001\nN10 G0 X0\nM30\n', '/shop/p.nc');
    expect(machines.effective(id).profile.numbering?.step).toBe(5);

    put('profiles', 'shop-lathe.json', userProfile('shop-lathe', { numbering: { step: 20 } }));
    await userConfig.load();
    expect(machines.effective(id).profile.numbering?.step).toBe(20);
  });
});

describe('a profile that vanishes while documents use it', () => {
  it('every revision subscriber can still ask for the document, and the document is read as the detected dialect', async () => {
    put('profiles', 'shop-lathe.json', userProfile('shop-lathe'));
    await userConfig.load();
    const id = addDoc('shop-lathe', 'O0001\nG0 X0\nM30\n', '/shop/p.nc');
    expect(docs.get(id)?.profileId).toBe('shop-lathe');

    // What the outline, the status item and the assistant do on every change: ask for the
    // document's effective view. In the middle of a reload the id may be unknown.
    const failures: string[] = [];
    const ask = (): void => {
      for (const doc of docs.all()) {
        try {
          machines.effective(doc.id);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }
    };
    unsubscribe.push(profiles.revision.subscribe(ask), machines.revision.subscribe(ask));
    failures.length = 0;
    const messages: string[] = [];
    unsubscribe.push(status.current.subscribe((m) => m !== null && messages.push(m.text)));

    remove('profiles', 'shop-lathe.json');
    await userConfig.load();

    expect(failures).toEqual([]);
    expect(profiles.get(docs.get(id)?.profileId ?? '')).toBeDefined();
    expect(docs.get(id)?.profileId).not.toBe('shop-lathe');
    expect(messages.some((m) => m === t('userConfig.load.redetected', { count: 1 }))).toBe(true);
    expect(() => machines.effective(id)).not.toThrow();
  });
});

// -- the commands, the save hook, the page’s own flows -----------------------------------------

describe('profile.newFrom → open → save → reload', () => {
  it('writes the file, opens it, and a save of the edited text takes effect', async () => {
    const hook = contribution.activate?.();
    try {
      await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'My Lathe' });

      const path = `${CONFIG}/profiles/my-lathe.json`;
      expect(boundary.state.disk.has(path)).toBe(true);
      expect(profiles.get('my-lathe')).toMatchObject({ origin: 'user', file: 'my-lathe.json', parent: 'fanuc-lathe' });
      const doc = docs.byPath(path);
      expect(doc).toBeDefined();
      expect(userConfig.kindOf(path)).toBe('profiles');

      // The user edits the open file and saves it: the save hook reloads.
      const edited = JSON.parse(boundary.state.disk.get(path) ?? '{}') as Record<string, unknown>;
      edited.name = 'Renamed in the editor';
      editor.replaceAll(doc!.id, `${JSON.stringify(edited, null, 2)}\n`);
      const revision = get(profiles.revision);
      // Without Monaco the editor service does not track edits, so the flag is set by hand.
      docs.update(doc!.id, { textDirty: true });
      expect(await files.save(doc!.id)).toBe(true);
      await vi.waitFor(() => expect(profiles.profile('my-lathe').name).toBe('Renamed in the editor'));
      expect(get(profiles.revision)).toBeGreaterThan(revision);
    } finally {
      if (typeof hook === 'function') hook();
    }
  });

  it('refuses a name that is taken, in either way a name can be taken', async () => {
    put('profiles', 'taken.json', userProfile('taken'));
    await userConfig.load();
    const messages: string[] = [];
    unsubscribe.push(status.current.subscribe((m) => m !== null && messages.push(m.text)));

    await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'taken' });
    await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'fanuc-gcode' });
    expect(messages).toContain(t('userConfig.name.taken', { name: 'taken.json' }));
    expect(messages).toContain(t('userConfig.name.profileExists'));
    expect([...boundary.state.disk.keys()].filter((p) => p.startsWith('/cfg/profiles/'))).toEqual(['/cfg/profiles/taken.json']);
  });
});

describe('a new code file', () => {
  it('named like a built-in set is an overlay that reaches that set and its children', async () => {
    await run('profile.newFrom', { kind: 'codes', parent: 'fanuc-lathe', name: 'fanuc-lathe' });
    const path = `${CONFIG}/codes/fanuc-lathe.json`;
    expect(JSON.parse(boundary.state.disk.get(path) ?? '{}')).toMatchObject({ dialect: 'fanuc-lathe', codes: [] });
    expect(get(userConfig.problems)).toEqual([]);

    // Add M13 to it the way a user does, and reload. The system B database inherits it.
    boundary.state.disk.set(path, json({ dialect: 'fanuc-lathe', version: 1, codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }] }));
    await userConfig.load();
    expect(codes.byId('fanuc-lathe').codes.find((c) => c.code === 'M13')?.label).toBe('Chuck clamp (shop)');
    expect(codes.byId('fanuc-lathe-b').codes.find((c) => c.code === 'M13')?.label).toBe('Chuck clamp (shop)');
  });

  it('under another name is a database of its own that extends the one it starts from', async () => {
    await run('profile.newFrom', { kind: 'codes', parent: 'fanuc-lathe', name: 'shop-codes' });
    expect(JSON.parse(boundary.state.disk.get(`${CONFIG}/codes/shop-codes.json`) ?? '{}')).toMatchObject({
      dialect: 'shop-codes',
      extends: 'fanuc-lathe',
    });
    expect(get(userConfig.problems)).toEqual([]);
    expect(codes.byId('shop-codes')).toBeDefined();
  });
});

describe('profile.import and profile.export', () => {
  it('imports a picked file under its lower-cased name and loads it', async () => {
    boundary.state.disk.set('/home/u/Downloads/Imported.JSON'.replace('.JSON', '.json'), json(userProfile('imported')));
    boundary.state.pick = '/home/u/Downloads/Imported.json';
    const messages: string[] = [];
    unsubscribe.push(status.current.subscribe((m) => m !== null && messages.push(m.text)));

    await run('profile.import', { kind: 'profiles' });

    expect(boundary.state.disk.has('/cfg/profiles/imported.json')).toBe(true);
    expect(profiles.get('imported')?.origin).toBe('user');
    expect(messages).toContain(t('userConfig.importer.done', { name: 'imported.json' }));
  });

  it('says so when the imported file has problems of its own, and not for the other folder’s namesake', async () => {
    put('profiles', 'same.json', userProfile('same', { extends: 'nowhere' }));
    await userConfig.load();
    boundary.state.disk.set('/in/same.json', json({ dialect: 'same-codes-not-this', codes: [] }));
    boundary.state.pick = '/in/same.json';
    const messages: { text: string; error: boolean }[] = [];
    unsubscribe.push(
      status.current.subscribe((m) => m !== null && messages.push({ text: m.text, error: m.error })),
    );

    // A code file `same.json` (a different name than the profile's problem file, same stem).
    await run('profile.import', { kind: 'codes' });
    const last = messages.at(-1);
    expect(last?.text).toBeDefined();
    // The profile `same.json` has a problem; the code file `same.json` has its own (wrong dialect).
    expect(last?.text).toBe(t('userConfig.importer.doneProblems', { name: 'same.json' }));
  });

  it('exports the file as it is on disk to the place the user picks', async () => {
    put('profiles', 'out.json', userProfile('out'));
    await userConfig.load();
    boundary.state.saveTo = '/home/u/Desktop/out.json';

    await run('profile.export', { kind: 'profiles', name: 'out.json' });

    expect(boundary.state.disk.get('/home/u/Desktop/out.json')).toBe(boundary.state.disk.get('/cfg/profiles/out.json'));
  });
});

describe('machines.import and machines.export', () => {
  it('imports the machines of a picked file through the real service and the machines file', async () => {
    boundary.state.disk.set('/in/machines.json', json({ $version: 1, machines: [{ id: 'a', name: 'Lathe A', profile: 'fanuc-lathe', params: {} }] }));
    boundary.state.pick = '/in/machines.json';
    boundary.state.machinesSaved.length = 0;

    await run('machines.import');

    expect(get(machines.list).map((m) => m.name)).toEqual(['Lathe A']);
    expect(boundary.state.machinesSaved).toHaveLength(1);
  });

  it('exports the whole file as it is on disk', async () => {
    boundary.state.disk.set('/cfg/machines.json', json({ $version: 1, machines: [], extra: 'kept' }));
    boundary.state.saveTo = '/home/u/Desktop/machines.json';

    await run('machines.export');

    expect(boundary.state.disk.get('/home/u/Desktop/machines.json')).toContain('"extra": "kept"');
  });
});

describe('profile.testOnDocument on a user profile', () => {
  it('reports on the document with the user profile’s rules', async () => {
    put('profiles', 'shop-lathe.json', userProfile('shop-lathe', { detect: { content: [{ pattern: '^O\\d{4}', weight: 5 }] } }));
    await userConfig.load();
    const id = addDoc('shop-lathe', 'O0001\nT0101\nG0 X0\nM30\n', '/shop/p.nc');
    docs.activate(id);

    await run('profile.testOnDocument');

    expect(reports.some((title) => title.includes('shop-lathe'))).toBe(true);
  });
});
