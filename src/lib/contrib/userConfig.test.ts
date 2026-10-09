// Your own profiles and code files: the commands, the save hook and the machines file's
// import and export (plan §6 M13 WP13.3, AD-29, §7.13). Owner: WP13.3.
//
// The platform is faked (the five `user_file_*` wrappers, the dialogs, the file reader and
// writer, the machine service); the profile registry, the document store and the Results
// store are the real ones, so what a new file contains is checked against the same
// resolver, validator and code-database resolver the application loads it with.

import { get, writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocId, NewDocMeta, ProfileInfo } from '$lib/app/types';
import type { ProfileProblem } from '$lib/core/profiles/types';

const fake = vi.hoisted(() => {
  const state = {
    shown: [] as { text: string; error: boolean; detail?: string }[],
    /** Answers of the quick picks and prompts, in order; `CANCEL` is "dismissed". */
    picks: [] as unknown[],
    pickItems: [] as unknown[][],
    promptAnswers: [] as unknown[],
    prompts: [] as { title: string; initial?: string; validate?: (v: string) => unknown }[],
    opened: [] as string[][],
    created: [] as { kind: string; name: string; text: string }[],
    imported: [] as { kind: string; src: string }[],
    pathOf: new Map<string, string>(),
    pickedFile: null as string | null,
    savedTo: null as string | null,
    pickedTitles: [] as (string | undefined)[],
    saveDefaults: [] as string[],
    read: new Map<string, Uint8Array>(),
    written: [] as { path: string; bytes: Uint8Array }[],
    loaded: 0,
    loadProblems: [] as unknown[],
    saveHook: null as ((id: string, path: string) => void) | null,
    folderOf: new Map<string, string>(),
    lastParams: undefined as Record<string, unknown> | undefined,
    setLastParams: [] as { key: string; value: unknown }[],
    lines: [] as string[],
    createFails: null as string | null,
    importFails: null as string | null,
    importResult: 'imported.json',
    importedMachines: [] as unknown[],
    importMachinesFails: false,
    openFails: null as string | null,
    statSize: null as number | null,
    statCalls: [] as string[][],
  };
  return state;
});

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean; detail?: string }) =>
      fake.shown.push({ text, error: o?.error === true, ...(o?.detail === undefined ? {} : { detail: o.detail }) }),
  },
}));

vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    exclusive: async (op: () => Promise<unknown>) => op(),
    pickFile: async (o?: { title?: string }) => {
      fake.pickedTitles.push(o?.title);
      return fake.pickedFile;
    },
    saveFile: async (o: { defaultPath: string }) => {
      fake.saveDefaults.push(o.defaultPath);
      return fake.savedTo;
    },
  },
}));

vi.mock('$lib/app/fileOps', () => ({
  files: {
    open: async (paths: string[]) => {
      if (fake.openFails !== null) throw new Error(fake.openFails);
      fake.opened.push(paths);
      return [];
    },
    onDidSave: (cb: (id: string, path: string) => void) => {
      fake.saveHook = cb;
      return () => {
        fake.saveHook = null;
      };
    },
  },
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    quickPick: async (items: unknown[]) => {
      fake.pickItems.push(items);
      return fake.picks.shift();
    },
    prompt: async (o: { title: string; initial?: string; validate?: (v: string) => unknown }) => {
      fake.prompts.push(o);
      return fake.promptAnswers.shift();
    },
  },
}));

vi.mock('$lib/app/userConfig', async () => {
  const { writable } = await import('svelte/store');
  const files = writable<unknown[]>([]);
  return {
    userConfig: {
      files,
      problems: writable([]),
      load: async () => {
        fake.loaded += 1;
        return fake.loadProblems;
      },
      kindOf: (path: string) => fake.folderOf.get(path.slice(0, path.lastIndexOf('/'))) ?? null,
    },
  };
});

vi.mock('$lib/platform/commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/platform/commands')>()),
  userFileCreate: async (kind: string, name: string, text: string) => {
    if (fake.createFails !== null) throw new Error(fake.createFails);
    fake.created.push({ kind, name, text });
    return `/cfg/${kind}/${name}`;
  },
  userFileImport: async (kind: string, src: string) => {
    if (fake.importFails !== null) throw new Error(fake.importFails);
    fake.imported.push({ kind, src });
    return fake.importResult;
  },
  userFilePath: async (kind: string, name: string) => {
    const path = fake.pathOf.get(`${kind}/${name}`);
    if (path === undefined) throw new Error(`no file ${name}`);
    return path;
  },
  machinesOpenFile: async () => '/cfg/machines.json',
  filesStat: async (paths: string[]) => {
    fake.statCalls.push(paths);
    if (fake.statSize === null) throw new Error('no answer');
    return paths.map((path) => ({ path, size: fake.statSize }));
  },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: async (path: string) => {
    const bytes = fake.read.get(path);
    if (bytes === undefined) throw new Error(`cannot read ${path}`);
    return bytes;
  },
  writeFile: async (path: string, bytes: Uint8Array) => {
    fake.written.push({ path, bytes });
  },
}));

vi.mock('$lib/stores/uiState', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/stores/uiState')>()),
  uiState: {
    getLastParams: () => fake.lastParams,
    setLastParams: (key: string, value: unknown) => fake.setLastParams.push({ key, value }),
  },
}));

vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    getLineCount: () => fake.lines.length,
    getLines: (_id: string, from: number, to: number) => fake.lines.slice(from - 1, to),
  },
}));

vi.mock('$lib/stores/machines', async () => {
  const { effectiveMachine } = await import('$lib/core/machines/effective');
  const { profiles } = await import('$lib/stores/profiles');
  const { docs } = await import('$lib/stores/documents');
  const { codes } = await import('$lib/stores/codes');
  return {
    machines: {
      effective: (id: string) => {
        const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
        const profile = profiles.profile(profileId);
        return { profile, cp: profiles.compiled(profileId), codes: codes.forProfile(profileId), machine: effectiveMachine(profile, null, 'none', {}) };
      },
      importMachines: async (parsed: unknown) => {
        fake.importedMachines.push(parsed);
        if (fake.importMachinesFails) throw new Error('refused');
        return {};
      },
    },
  };
});

const contrib = (await import('./userConfig')).default;
const { MAX_REPORT_ROWS, formatMs, newFileText, nameProblem, parentChoices, reportOf, stemOf } = await import('./userConfig');
const { docs } = await import('$lib/stores/documents');
const { profiles } = await import('$lib/stores/profiles');
const { results } = await import('$lib/stores/results');
const { userConfig } = await import('$lib/app/userConfig');
const { hasKey, t } = await import('$lib/i18n');
const { BUILTIN_PROFILE_SOURCES } = await import('$lib/data/profiles');
const { BUILTIN_CODE_DB_JSON } = await import('$lib/data/codes');
const { resolveProfiles } = await import('$lib/core/profiles/resolve');
const { validateProfile } = await import('$lib/core/profiles/validate');
const { resolveCodeDbs } = await import('$lib/core/codes/resolve');
const { testReport } = await import('$lib/core/profiles/testReport');
const { noMachine } = await import('$lib/core/machines/effective');

const commandOf = (id: string) => {
  const found = contrib.commands.find((c) => c.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
};
const run = (id: string, arg?: unknown): Promise<unknown> => Promise.resolve(commandOf(id).run({ activeDocId: null } as never, arg));

const filesStore = (userConfig as unknown as { files: ReturnType<typeof writable<unknown[]>> }).files;

function addDoc(profileId = 'fanuc-gcode', path: string | null = '/nc/part.nc'): DocId {
  const meta: NewDocMeta = {
    path,
    untitledIndex: path === null ? 1 : null,
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
  };
  const id = docs.add(meta);
  docs.activate(id);
  return id;
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

beforeEach(() => {
  fake.shown.length = 0;
  fake.picks.length = 0;
  fake.pickItems.length = 0;
  fake.promptAnswers.length = 0;
  fake.prompts.length = 0;
  fake.opened.length = 0;
  fake.created.length = 0;
  fake.imported.length = 0;
  fake.pathOf.clear();
  fake.pickedFile = null;
  fake.savedTo = null;
  fake.pickedTitles.length = 0;
  fake.saveDefaults.length = 0;
  fake.read.clear();
  fake.written.length = 0;
  fake.loaded = 0;
  fake.loadProblems = [];
  fake.folderOf.clear();
  fake.lastParams = undefined;
  fake.setLastParams.length = 0;
  fake.lines = [];
  fake.createFails = null;
  fake.importFails = null;
  fake.importResult = 'imported.json';
  fake.importedMachines.length = 0;
  fake.importMachinesFails = false;
  fake.openFails = null;
  fake.statSize = null;
  fake.statCalls.length = 0;
  filesStore.set([]);
  results.clear();
});

afterEach(() => {
  for (const doc of docs.all()) docs.remove(doc.id);
});

describe('what it declares', () => {
  it('registers the eight pinned commands, with no shortcut', () => {
    expect(contrib.commands.map((c) => c.id)).toEqual([
      'profile.newFrom',
      'profile.open',
      'profile.import',
      'profile.export',
      'profile.reload',
      'profile.testOnDocument',
      'machines.import',
      'machines.export',
    ]);
    for (const command of contrib.commands) {
      expect(command).not.toHaveProperty('keys');
      expect(command.global).toBe(true);
    }
    expect(contrib.commands.map((c) => c.title)).toEqual([
      'userConfig.newFrom',
      'userConfig.open',
      'userConfig.import',
      'userConfig.export',
      'userConfig.reload',
      'userConfig.testOnDocument',
      'machines.import',
      'machines.export',
    ]);
    expect(contrib.commands.map((c) => c.category)).toEqual([
      ...Array<string>(6).fill('userConfig.category'),
      'machines.category',
      'machines.category',
    ]);
  });

  it('has an id that matches its file name, and every title, category and group has a message', () => {
    expect(contrib.id).toBe('userConfig');
    const keys = [
      ...contrib.commands.flatMap((c) => [c.title, c.category]),
      ...contrib.ribbon.map((r) => r.group),
    ];
    expect(keys.filter((key): key is string => typeof key === 'string').filter((key) => !hasKey(key))).toEqual([]);
  });

  it('puts the tester on the Tools tab, after the Channels group', () => {
    expect(contrib.ribbon).toEqual([{ tab: 'tools', group: 'userConfig.toolsGroup', command: 'profile.testOnDocument', order: 70 }]);
  });

  it('offers the tester only while a document is open', () => {
    const test = commandOf('profile.testOnDocument');
    expect(test.enabled?.({ activeDocId: null } as never)).toBe(false);
    expect(test.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
  });
});

describe('the save hook', () => {
  beforeEach(() => {
    fake.folderOf.set('/cfg/profiles', 'profiles');
    fake.folderOf.set('/cfg/codes', 'codes');
  });

  it('reloads when a file of either folder is saved', () => {
    const dispose = contrib.activate();
    fake.saveHook?.('d1', '/cfg/profiles/shop.json');
    fake.saveHook?.('d2', '/cfg/codes/shop.json');
    expect(fake.loaded).toBe(2);
    dispose();
  });

  it('ignores the save of any other file', () => {
    const dispose = contrib.activate();
    fake.saveHook?.('d1', '/nc/part.nc');
    fake.saveHook?.('d1', '/cfg/profiles/nested/shop.json');
    expect(fake.loaded).toBe(0);
    dispose();
  });

  it('removes its listener with the disposer', () => {
    contrib.activate()();
    expect(fake.saveHook).toBeNull();
  });
});

describe('names', () => {
  it('turns what was typed into a file name stem', () => {
    expect(stemOf('  My Lathe ')).toBe('my-lathe');
    expect(stemOf('Shop.JSON')).toBe('shop');
  });

  it('refuses names the folder would refuse', () => {
    expect(nameProblem('profiles', 'fanuc-gcode', '')).toMatchObject({ key: 'userConfig.name.invalid' });
    expect(nameProblem('profiles', 'fanuc-gcode', '-x')).toMatchObject({ key: 'userConfig.name.invalid' });
    expect(nameProblem('profiles', 'fanuc-gcode', 'a'.repeat(65))).toMatchObject({ key: 'userConfig.name.invalid' });
    expect(nameProblem('profiles', 'fanuc-gcode', 'a b')).toMatchObject({ key: 'userConfig.name.invalid' });
    expect(nameProblem('profiles', 'fanuc-gcode', 'con')).toMatchObject({ key: 'userConfig.name.device' });
    expect(nameProblem('profiles', 'fanuc-gcode', 'com1.x')).toMatchObject({ key: 'userConfig.name.device' });
    expect(nameProblem('profiles', 'fanuc-gcode', 'shop')).toBeNull();
    expect(nameProblem('profiles', 'fanuc-gcode', 'shop.v2_a-b')).toBeNull();
  });

  it('refuses a name that is taken: by a file, or by the id of a profile that exists', () => {
    filesStore.set([{ kind: 'profiles', name: 'shop.json', error: null }]);
    expect(nameProblem('profiles', 'fanuc-gcode', 'shop')).toMatchObject({ key: 'userConfig.name.taken', params: { name: 'shop.json' } });
    expect(nameProblem('profiles', 'fanuc-gcode', 'fanuc-lathe')).toMatchObject({ key: 'userConfig.name.profileExists' });
    // The other folder has its own names.
    expect(nameProblem('codes', 'fanuc', 'shop')).toBeNull();
  });

  it('lets a code file take the name of the built-in set it is made from, and of no other', () => {
    expect(nameProblem('codes', 'fanuc-lathe', 'fanuc-lathe')).toBeNull();
    expect(nameProblem('codes', 'fanuc-lathe', 'fanuc')).toMatchObject({ key: 'userConfig.name.codesBuiltin' });
    expect(nameProblem('codes', 'fanuc-lathe', 'my-codes')).toBeNull();
  });

  it('offers every profile, and the built-in code sets then yours', () => {
    expect(parentChoices('profiles').map((c) => c.value)).toEqual(profiles.list().map((info: ProfileInfo) => info.id));
    filesStore.set([{ kind: 'codes', name: 'mine.json', error: null }]);
    const codeSets = parentChoices('codes');
    expect(codeSets.map((c) => c.value)).toEqual([...Object.keys(BUILTIN_CODE_DB_JSON), 'mine']);
    expect(codeSets.at(-1)?.detail).toBe(t('userConfig.origin.user'));
  });
});

describe('the text of a new file loads clean', () => {
  it('is a profile that resolves and validates, for every built-in parent', () => {
    for (const info of profiles.list()) {
      const text = newFileText('profiles', info.id, 'shop-test');
      const { resolved, problems } = resolveProfiles([
        ...BUILTIN_PROFILE_SOURCES,
        { raw: JSON.parse(text), origin: 'user', file: 'shop-test.json' },
      ]);
      expect(problems, info.id).toEqual([]);
      const child = resolved.find((entry) => entry.origin === 'user');
      expect(child, info.id).toBeDefined();
      const checked = validateProfile(child?.profile, { codeDbs: Object.keys(BUILTIN_CODE_DB_JSON) });
      expect(checked.ok ? [] : checked.errors, info.id).toEqual([]);
    }
  });

  it('does not take over detection from its parent: it scores no content of its own', () => {
    const child = JSON.parse(newFileText('profiles', 'fanuc-lathe', 'shop')) as { detect: { content: unknown[] } };
    expect(child.detect.content).toEqual([]);
  });

  it('is an overlay of a built-in set under its own name, with nothing to extend', () => {
    const text = newFileText('codes', 'fanuc-lathe', 'fanuc-lathe');
    expect(JSON.parse(text)).toEqual({ dialect: 'fanuc-lathe', version: 1, codes: [] });
    // Laid over the built-in set by the registry (WP13.2); on its own it is a valid, empty file.
    const problems: unknown[] = [];
    const db = resolveCodeDbs({ 'fanuc-lathe': JSON.parse(text) }, (_d, p) => problems.push(p));
    expect(problems).toEqual([]);
    expect(db['fanuc-lathe'].codes).toEqual([]);
  });

  it('is a database of its own, built on its parent, under another name', () => {
    const text = newFileText('codes', 'fanuc-lathe', 'my-codes');
    expect(JSON.parse(text)).toEqual({ dialect: 'my-codes', version: 1, extends: 'fanuc-lathe', codes: [] });
    const problems: unknown[] = [];
    const db = resolveCodeDbs({ ...BUILTIN_CODE_DB_JSON, 'my-codes': JSON.parse(text) }, (_d, p) => problems.push(p));
    expect(problems).toEqual([]);
    expect(db['my-codes'].codes.length).toBe(db['fanuc-lathe'].codes.length);
  });
});

describe('profile.newFrom', () => {
  it('creates the file named in the arguments, opens it and reads the folders again', async () => {
    await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'Shop Lathe' });
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({ kind: 'profiles', name: 'shop-lathe.json' });
    expect(JSON.parse(fake.created[0].text)).toMatchObject({ id: 'shop-lathe', extends: 'fanuc-lathe' });
    expect(fake.opened).toEqual([['/cfg/profiles/shop-lathe.json']]);
    expect(fake.loaded).toBe(1);
    expect(fake.setLastParams).toEqual([{ key: 'userConfig:newFrom', value: { kind: 'profiles', parent: 'fanuc-lathe' } }]);
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.create.created', { name: 'shop-lathe.json' }), error: false });
    // Everything was in the arguments: nothing was asked.
    expect(fake.pickItems).toEqual([]);
    expect(fake.prompts).toEqual([]);
  });

  it('asks for the kind, the parent and the name from the palette', async () => {
    fake.picks.push('codes', 'fanuc-lathe');
    fake.promptAnswers.push('My Codes');
    await run('profile.newFrom');
    expect(fake.pickItems).toHaveLength(2);
    expect((fake.pickItems[0] as { value: string }[]).map((i) => i.value)).toEqual(['profiles', 'codes']);
    expect(fake.prompts[0].initial).toBe('fanuc-lathe');
    expect(fake.created[0]).toMatchObject({ kind: 'codes', name: 'my-codes.json' });
    expect(JSON.parse(fake.created[0].text)).toMatchObject({ dialect: 'my-codes', extends: 'fanuc-lathe' });
  });

  it('suggests a name for a profile and starts the choice at the last parent', async () => {
    fake.lastParams = { kind: 'profiles', parent: 'fanuc-lathe' };
    fake.picks.push('profiles', 'fanuc-lathe');
    fake.promptAnswers.push(undefined);
    await run('profile.newFrom');
    const parents = fake.pickItems[1] as { value: string }[];
    const initial = (fake.pickItems[1] as unknown[]).length > 0 ? parents.findIndex((p) => p.value === 'fanuc-lathe') : -1;
    expect(initial).toBeGreaterThan(-1);
    expect(fake.prompts[0].initial).toBe('my-fanuc-lathe');
  });

  it('validates the name while it is typed', async () => {
    fake.picks.push('profiles', 'fanuc-lathe');
    fake.promptAnswers.push(undefined);
    await run('profile.newFrom');
    const validate = fake.prompts[0].validate;
    expect(validate?.('fanuc-lathe')).toMatchObject({ key: 'userConfig.name.profileExists' });
    expect(validate?.('con')).toMatchObject({ key: 'userConfig.name.device' });
    expect(validate?.('Shop Lathe')).toBeNull();
  });

  it('creates nothing when any question is dismissed', async () => {
    await run('profile.newFrom'); // kind dismissed
    fake.picks.push('profiles'); // parent dismissed
    await run('profile.newFrom');
    fake.picks.push('profiles', 'fanuc-lathe'); // name dismissed
    await run('profile.newFrom');
    expect(fake.created).toEqual([]);
    expect(fake.opened).toEqual([]);
    expect(fake.loaded).toBe(0);
  });

  it('refuses a name that is not acceptable even when the arguments give it', async () => {
    await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'fanuc-gcode' });
    expect(fake.created).toEqual([]);
    expect(fake.shown.at(-1)?.error).toBe(true);
  });

  it('says why when the file could not be created (a name taken in the meantime), and opens nothing', async () => {
    fake.createFails = 'shop.json already exists';
    await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'shop' });
    expect(fake.opened).toEqual([]);
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.create.failed'), error: true, detail: 'shop.json already exists' });
  });
});

describe('profile.newFrom: the file is made but cannot be opened (CODE-9)', () => {
  it('reads the folders again anyway and says the file was made but not opened', async () => {
    fake.openFails = 'the editor refused';
    await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'shop' });
    expect(fake.created).toHaveLength(1);
    expect(fake.loaded).toBe(1);
    expect(fake.shown.at(-1)).toEqual({
      text: t('userConfig.create.createdNotOpened', { name: 'shop.json' }),
      error: true,
      detail: 'the editor refused',
    });
  });

  it('answers whether a file was made, which is what keeps the Profiles page form', async () => {
    expect(await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'one' })).toBe(true);
    fake.openFails = 'x';
    expect(await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'two' })).toBe(true);
    fake.openFails = null;
    fake.createFails = 'taken';
    expect(await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'three' })).toBe(false);
    expect(await run('profile.newFrom', { kind: 'profiles', parent: 'fanuc-lathe', name: 'bad name!' })).toBe(false);
  });
});

describe('profile.open', () => {
  it('opens the named file', async () => {
    fake.pathOf.set('profiles/shop.json', '/cfg/profiles/shop.json');
    await run('profile.open', { kind: 'profiles', name: 'shop.json' });
    expect(fake.opened).toEqual([['/cfg/profiles/shop.json']]);
  });

  it('asks which file from the palette, listing a file that could not be read with its reason', async () => {
    filesStore.set([
      { kind: 'codes', name: 'a.json', error: null },
      { kind: 'codes', name: 'big.json', error: 'larger than 1 MiB' },
      { kind: 'profiles', name: 'other.json', error: null },
    ]);
    fake.pathOf.set('codes/a.json', '/cfg/codes/a.json');
    fake.picks.push('a.json');
    await run('profile.open', { kind: 'codes' });
    const items = fake.pickItems[0] as { label: string; detail?: string }[];
    expect(items.map((i) => i.label)).toEqual(['a.json', 'big.json']);
    expect(items[1].detail).toBe('larger than 1 MiB');
    expect(fake.opened).toEqual([['/cfg/codes/a.json']]);
  });

  it('says so when the folder has no files', async () => {
    await run('profile.open', { kind: 'profiles' });
    expect(fake.shown.at(-1)?.text).toBe(t('userConfig.noProfileFiles'));
    expect(fake.opened).toEqual([]);
  });

  it('reports a file the folder refuses to give a path for', async () => {
    await run('profile.open', { kind: 'profiles', name: 'gone.json' });
    expect(fake.opened).toEqual([]);
    expect(fake.shown.at(-1)).toMatchObject({ text: t('userConfig.openFailed', { name: 'gone.json' }), error: true });
  });
});

describe('profile.import', () => {
  it('copies the picked file into the folder and reads the folders again', async () => {
    fake.pickedFile = '/home/u/Downloads/Shop.json';
    await run('profile.import', { kind: 'profiles' });
    expect(fake.imported).toEqual([{ kind: 'profiles', src: '/home/u/Downloads/Shop.json' }]);
    expect(fake.loaded).toBe(1);
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.importer.done', { name: 'imported.json' }), error: false });
    // Rust answers only the name and grants nothing: the file is not opened here.
    expect(fake.opened).toEqual([]);
  });

  it('says when the imported file has problems of its own', async () => {
    fake.pickedFile = '/x/shop.json';
    fake.loadProblems = [{ origin: 'user', file: 'imported.json', profileId: 'x', path: 'id', message: 'bad', kind: 'profiles' } satisfies ProfileProblem];
    await run('profile.import', { kind: 'profiles' });
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.importer.doneProblems', { name: 'imported.json' }), error: true });
  });

  it('does not count the problems of the same-named file in the other folder', async () => {
    fake.pickedFile = '/x/imported.json';
    fake.loadProblems = [
      { origin: 'user', file: 'imported.json', profileId: 'imported', path: 'id', message: 'bad', kind: 'profiles' } satisfies ProfileProblem,
    ];
    await run('profile.import', { kind: 'codes' });
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.importer.done', { name: 'imported.json' }), error: false });
  });

  it('matches a code file by its dialect', async () => {
    fake.pickedFile = '/x/imported.json';
    fake.loadProblems = [{ origin: 'user', file: null, profileId: 'imported', path: 'extends', message: 'bad', kind: 'codes' } satisfies ProfileProblem];
    await run('profile.import', { kind: 'codes' });
    expect(fake.shown.at(-1)?.error).toBe(true);
  });

  it('does nothing when the dialog is dismissed', async () => {
    await run('profile.import', { kind: 'codes' });
    expect(fake.imported).toEqual([]);
    expect(fake.loaded).toBe(0);
  });

  it('shows the folder’s refusal (a name that is taken, a link, too large)', async () => {
    fake.pickedFile = '/x/shop.json';
    fake.importFails = 'shop.json already exists';
    await run('profile.import', { kind: 'profiles' });
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.importer.failed'), error: true, detail: 'shop.json already exists' });
    expect(fake.loaded).toBe(0);
  });

  it('asks for the kind from the palette', async () => {
    fake.picks.push('codes');
    fake.pickedFile = '/x/a.json';
    await run('profile.import');
    expect(fake.imported[0].kind).toBe('codes');
  });
});

describe('profile.export', () => {
  it('saves a copy of the file where the user chooses, byte for byte', async () => {
    fake.pathOf.set('profiles/shop.json', '/cfg/profiles/shop.json');
    fake.read.set('/cfg/profiles/shop.json', bytes('{ "id": "shop" }\n'));
    fake.savedTo = '/home/u/Desktop/shop-copy.json';
    await run('profile.export', { kind: 'profiles', name: 'shop.json' });
    expect(fake.saveDefaults).toEqual(['shop.json']);
    expect(fake.written).toHaveLength(1);
    expect(fake.written[0].path).toBe('/home/u/Desktop/shop-copy.json');
    expect(new TextDecoder().decode(fake.written[0].bytes)).toBe('{ "id": "shop" }\n');
    expect(fake.shown.at(-1)?.text).toBe(t('userConfig.exporter.done', { name: 'shop.json', file: 'shop-copy.json' }));
  });

  it('writes nothing when the save dialog is dismissed', async () => {
    fake.pathOf.set('codes/a.json', '/cfg/codes/a.json');
    fake.read.set('/cfg/codes/a.json', bytes('{}'));
    await run('profile.export', { kind: 'codes', name: 'a.json' });
    expect(fake.written).toEqual([]);
  });

  it('reports a file that cannot be read or written', async () => {
    fake.pathOf.set('codes/a.json', '/cfg/codes/a.json');
    await run('profile.export', { kind: 'codes', name: 'a.json' });
    expect(fake.shown.at(-1)).toMatchObject({ text: t('userConfig.exporter.failed', { name: 'a.json' }), error: true });
  });

  it('asks which file from the palette, and says so when there is none', async () => {
    await run('profile.export', { kind: 'codes' });
    expect(fake.shown.at(-1)?.text).toBe(t('userConfig.noCodeFiles'));
  });
});

describe('profile.reload', () => {
  it('reads both folders again and counts what is there', async () => {
    filesStore.set([
      { kind: 'profiles', name: 'a.json', error: null },
      { kind: 'profiles', name: 'b.json', error: null },
      { kind: 'codes', name: 'c.json', error: null },
    ]);
    await run('profile.reload');
    expect(fake.loaded).toBe(1);
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.reloaded.done', { profiles: 2, codes: 1 }), error: false });
  });

  it('says how many problems it found', async () => {
    fake.loadProblems = [{}, {}];
    await run('profile.reload');
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.reloaded.problems', { profiles: 0, codes: 0, count: 2 }), error: true });
  });
});

describe('profile.testOnDocument', () => {
  const PROGRAM = ['%', 'O1001 (TEST)', 'N10 T1 M6', 'N20 GOTO 10', 'N30 M30', '%'];

  it('shows what the document’s profile finds, line by line, in Results', async () => {
    const id = addDoc('fanuc-gcode');
    fake.lines = PROGRAM;
    await run('profile.testOnDocument');
    const report = get(results.current);
    expect(report?.docId).toBe(id);
    expect(report?.title).toBe(t('userConfig.test.title', { profile: profiles.profile('fanuc-gcode').name, document: 'part.nc' }));
    // The profile's own name, which is what the picker shows; not the file-dialog filter "Fanuc G-Code".
    expect(report?.title).not.toContain('Fanuc G-Code');
    expect(report?.columns.map((c) => c.key)).toEqual(['line', 'what', 'rule', 'found', 'time']);
    const rows = report?.rows ?? [];
    const tool = rows.find((row) => row.what === t('userConfig.test.what.toolCall'));
    expect(tool).toMatchObject({ line: 3 });
    expect(String(tool?.found)).toContain('tool 1');
    expect(rows.find((row) => row.what === t('userConfig.test.what.reference'))).toMatchObject({ line: 4 });
    expect(rows.find((row) => row.what === t('userConfig.test.what.programEnd'))).toMatchObject({ line: 5 });
    expect(report?.message).toContain(t('userConfig.test.detected', { profile: profiles.profile('fanuc-gcode').name }));
    expect(fake.shown.at(-1)?.text).toBe(t('userConfig.test.shown', { count: rows.length }));
  });

  it('tests another profile on the same text when the Profiles page asks for it', async () => {
    addDoc('fanuc-gcode');
    fake.lines = PROGRAM;
    await run('profile.testOnDocument', { profileId: 'heidenhain-klartext' });
    const report = get(results.current);
    expect(report?.title).toContain('Heidenhain');
    // The Fanuc tool change is not one for Klartext.
    expect((report?.rows ?? []).some((row) => row.what === t('userConfig.test.what.toolCall'))).toBe(false);
  });

  it('reads another profile the way choosing it would, with the setting the program points at (NC-11)', async () => {
    addDoc('fanuc-gcode');
    fake.lines = ['O1', 'G92 S2000', 'G96 S200 M3', 'T0101', 'G77 X10. Z-5. F0.1', 'M30'];
    await run('profile.testOnDocument', { profileId: 'fanuc-lathe' });
    const rows = get(results.current)?.rows ?? [];
    const result = rows.find((row) => row.what === t('userConfig.test.what.variantResult'));
    expect(String(result?.found)).toContain('G-code system');
    // The G-code system B reading of the same program, as the document of that profile gets it.
    const own = (() => {
      for (const doc of docs.all()) docs.remove(doc.id);
      addDoc('fanuc-lathe');
      return run('profile.testOnDocument');
    })();
    await own;
    const ownRows = get(results.current)?.rows ?? [];
    expect(ownRows.map((row) => [row.line, row.what, row.rule])).toEqual(rows.map((row) => [row.line, row.what, row.rule]));
  });

  it('runs one test at a time: a second ask while one runs only says so', async () => {
    addDoc('fanuc-gcode');
    fake.lines = Array.from({ length: 900 }, (_, i) => `N${i + 1} G1 X${i}. F100`);
    const first = run('profile.testOnDocument');
    await run('profile.testOnDocument');
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.test.running'), error: false });
    await first;
    expect(get(results.current)).not.toBeNull();
    // Afterwards a new test runs again.
    fake.shown.length = 0;
    await run('profile.testOnDocument');
    expect(fake.shown.at(-1)?.text).toBe(t('userConfig.test.shown', { count: get(results.current)?.rows.length ?? 0 }));
  });

  it('reads the setting a program points at, with its margin', async () => {
    addDoc('fanuc-lathe');
    fake.lines = ['O1', 'G92 S2000', 'G96 S200 M3', 'T0101', 'G77 X10. Z-5. F0.1', 'M30'];
    await run('profile.testOnDocument');
    const rows = get(results.current)?.rows ?? [];
    const result = rows.find((row) => row.what === t('userConfig.test.what.variantResult'));
    expect(result).toBeDefined();
    expect(result?.line).toBeNull();
    expect(String(result?.found)).toContain('G-code system');
    expect(String(result?.found)).toContain('B');
  });

  it('refuses a profile that does not exist, and does nothing with no document', async () => {
    addDoc('fanuc-gcode');
    await run('profile.testOnDocument', { profileId: 'nope' });
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.test.unknownProfile', { id: 'nope' }), error: true });
    expect(get(results.current)).toBeNull();
    for (const doc of docs.all()) docs.remove(doc.id);
    await run('profile.testOnDocument');
    expect(get(results.current)).toBeNull();
  });
});

describe('the Results report', () => {
  const cp = profiles.compiled('fanuc-gcode');
  const make = (lines: string[], now?: () => number) =>
    testReport({
      cp,
      lines,
      codes: { dialect: 'none', version: 1, addresses: {}, codes: [] },
      machine: noMachine(cp.profile),
      now: now ?? (() => 0),
    });
  const o = { document: 'part.nc', profile: 'Fanuc', docId: 'd1', detected: null };

  it('warns above 50 ms with the rule and the line, and says how long the rules took', () => {
    let t0 = 0;
    let calls = 0;
    const report = make(['O1', 'T1 M6'], () => (calls++ % 2 === 0 ? t0 : (t0 += 80)));
    const shown = reportOf(report, o);
    expect(shown.message).toContain('more than 50 ms');
    expect(shown.message).toContain('80 ms');
    expect(shown.rows.some((row) => String(row.time).includes('80'))).toBe(true);
  });

  it('has no warning when every rule is fast', () => {
    const shown = reportOf(make(['O1', 'T1 M6']), o);
    expect(shown.message).not.toContain('more than');
  });

  it('counts the rows it does not list instead of cutting them silently', () => {
    const lines = Array.from({ length: MAX_REPORT_ROWS }, (_, i) => `N${i + 1} T1 M6`);
    const report = make(lines);
    const shown = reportOf(report, o);
    expect(report.rows.length).toBeGreaterThan(MAX_REPORT_ROWS);
    expect(shown.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(shown.dropped).toBe(report.rows.length - MAX_REPORT_ROWS);
  });

  it('says when the program was longer than what was tested', () => {
    const shown = reportOf({ ...make(['O1']), truncated: true }, o);
    expect(shown.message).toContain('Only the first');
  });

  it('says that a detect rule above a veto does not count, and where the test stopped', () => {
    const veto = { ...cp, re: { ...cp.re, detectVetoes: [/^STOPHERE/] } };
    const report = testReport({
      cp: veto,
      lines: ['O1', 'N10 G0 X1', 'STOPHERE'],
      codes: { dialect: 'none', version: 1, addresses: {}, codes: [] },
      machine: noMachine(cp.profile),
      now: () => 0,
    });
    const detect = reportOf(report, o).rows.filter((row) => row.what === t('userConfig.test.what.detect'));
    expect(detect.length).toBeGreaterThan(0);
    expect(detect.every((row) => String(row.found).includes('line 3 rules this profile out'))).toBe(true);

    let clock = 0;
    const slow = make(Array.from({ length: 300 }, () => 'N10 G0 X1.'), () => (clock += 1000));
    const shown = reportOf(slow, o);
    expect(slow.stoppedAt).not.toBeNull();
    expect(shown.rows.some((row) => row.what === t('userConfig.test.what.stopped'))).toBe(true);
    // The stop is said once: not also as "only the first lines were tested".
    expect(shown.message).not.toContain('Only the first');
  });

  it('formats times', () => {
    expect(formatMs(null)).toBe('');
    expect(formatMs(0)).toBe(t('userConfig.test.timeTiny'));
    expect(formatMs(0.456)).toBe('0.46 ms');
    expect(formatMs(12.4)).toBe('12 ms');
  });

  it('has a message for every kind of row, built from the profile’s own labels', () => {
    const lathe = profiles.compiled('fanuc-lathe');
    const report = testReport({
      cp: lathe,
      lines: ['O1', 'G92 S2000', 'T0100', 'T0101', 'G71 P10 Q20', 'N10 G0 X1.', 'N20 G0 X2.', 'M99 P10', '(NOTE)', 'M30'],
      codes: { dialect: 'none', version: 1, addresses: {}, codes: [] },
      machine: noMachine(lathe.profile),
      variants: profiles.detectVariants('fanuc-lathe', 'G92 S2000'),
      now: () => 0,
    });
    const shown = reportOf(report, o);
    const kinds = new Set(report.rows.map((row) => row.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(7);
    for (const row of shown.rows) {
      expect(String(row.what)).not.toMatch(/^userConfig\./);
      expect(String(row.found)).not.toMatch(/userConfig\./);
    }
  });
});

describe('machines.import', () => {
  it('reads the picked file and hands the parsed machines to the service', async () => {
    fake.pickedFile = '/x/machines.json';
    fake.read.set('/x/machines.json', bytes('{"$version":1,"machines":[]}'));
    await run('machines.import');
    expect(fake.pickedTitles).toEqual([t('machines.transfer.pickTitle')]);
    expect(fake.importedMachines).toEqual([{ $version: 1, machines: [] }]);
  });

  it('ignores a byte-order mark', async () => {
    fake.pickedFile = '/x/machines.json';
    fake.read.set('/x/machines.json', new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('{"machines":[]}')]));
    await run('machines.import');
    expect(fake.importedMachines).toEqual([{ machines: [] }]);
  });

  it('does nothing when the dialog is dismissed', async () => {
    await run('machines.import');
    expect(fake.importedMachines).toEqual([]);
  });

  it('says so when the file is not JSON, and does not call the service', async () => {
    fake.pickedFile = '/x/m.json';
    fake.read.set('/x/m.json', bytes('machines: none'));
    await run('machines.import');
    expect(fake.importedMachines).toEqual([]);
    expect(fake.shown.at(-1)).toMatchObject({ text: t('machines.transfer.notJson'), error: true });
  });

  it('refuses a file over 1 MiB without reading it as text', async () => {
    fake.pickedFile = '/x/m.json';
    fake.read.set('/x/m.json', new Uint8Array(1024 * 1024 + 1));
    await run('machines.import');
    expect(fake.importedMachines).toEqual([]);
    expect(fake.shown.at(-1)).toMatchObject({ text: t('machines.transfer.tooBig'), error: true });
  });

  it('asks for the size first and refuses a file of 2 GiB without reading it (CODE-10)', async () => {
    fake.pickedFile = '/x/huge.json';
    fake.statSize = 2 * 1024 ** 3;
    // Reading it would fail with another message: the refusal has to come from the size.
    await run('machines.import');
    expect(fake.statCalls).toEqual([['/x/huge.json']]);
    expect(fake.importedMachines).toEqual([]);
    expect(fake.shown.at(-1)).toMatchObject({ text: t('machines.transfer.tooBig'), error: true });
  });

  it('reads the file when the size is small, and when the size cannot be had', async () => {
    fake.pickedFile = '/x/m.json';
    fake.read.set('/x/m.json', bytes('{"machines":[]}'));
    fake.statSize = 15;
    await run('machines.import');
    fake.statSize = null;
    await run('machines.import');
    expect(fake.importedMachines).toEqual([{ machines: [] }, { machines: [] }]);
  });

  it('leaves the explanation to the service when it refuses', async () => {
    fake.pickedFile = '/x/m.json';
    fake.read.set('/x/m.json', bytes('{}'));
    fake.importMachinesFails = true;
    await expect(run('machines.import')).resolves.toBeUndefined();
    expect(fake.shown).toEqual([]);
  });
});

describe('machines.export', () => {
  it('saves the whole machines file where the user chooses', async () => {
    fake.read.set('/cfg/machines.json', bytes('{"$version":1,"machines":[],"defaults":{},"future":true}\n'));
    fake.savedTo = '/home/u/backup/machines-2026.json';
    await run('machines.export');
    expect(fake.saveDefaults).toEqual(['machines.json']);
    expect(new TextDecoder().decode(fake.written[0].bytes)).toBe('{"$version":1,"machines":[],"defaults":{},"future":true}\n');
    expect(fake.written[0].path).toBe('/home/u/backup/machines-2026.json');
    expect(fake.shown.at(-1)?.text).toBe(t('machines.transfer.exported', { file: 'machines-2026.json' }));
  });

  it('writes nothing when the save dialog is dismissed', async () => {
    fake.read.set('/cfg/machines.json', bytes('{}'));
    await run('machines.export');
    expect(fake.written).toEqual([]);
  });

  it('reports a file that cannot be read', async () => {
    fake.savedTo = '/x/m.json';
    await run('machines.export');
    expect(fake.written).toEqual([]);
    expect(fake.shown.at(-1)).toMatchObject({ text: t('machines.transfer.exportFailed'), error: true });
  });
});
