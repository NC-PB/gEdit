// The template manager and "New Template from Selection" commands (Phase 3 plan §5 P3.9, §6.7,
// AD-40). Owner: P3.9.
//
// The platform is faked (the code files folder, the dialogs, the file operations, the editor and the
// machine service); the profile registry, the document store, the code databases, the loader, the
// engine and the selection engine are the real ones. The last test drives a whole Save through the
// wiring: the manager opens the file's document, edits it once and saves it through `files.save`.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocId, NewDocMeta } from '$lib/app/types';
import type { ManagerState, TemplateManager } from '$lib/app/templateManager';

const fake = vi.hoisted(() => {
  const state = {
    shown: [] as { text: string; error: boolean }[],
    opened: [] as { component: unknown; props: { model: TemplateManager }; options?: { wide?: boolean; mayClose?: () => boolean | Promise<boolean> } }[],
    /** The code files folder: name → text. */
    folder: new Map<string, string>(),
    created: [] as { name: string; text: string }[],
    /** The text of the open documents (`editor`). */
    texts: new Map<string, string>(),
    lines: [] as string[],
    selection: null as { startLine: number; endLine: number; empty: boolean } | null,
    cursor: { line: 1 } as { line: number } | null,
    /** What `files.open` does: the paths asked for and the id it answers. */
    openPaths: [] as string[][],
    openOptions: [] as unknown[],
    marked: [] as string[],
    /** What `files.save` answers. */
    saveAnswer: true,
    saves: [] as string[],
    replaces: [] as string[],
    loaded: 0,
    confirm: true,
  };
  return state;
});

vi.mock('$lib/app/status', () => ({
  status: { show: (text: string, o?: { error?: boolean }) => fake.shown.push({ text, error: o?.error === true }) },
}));
vi.mock('$lib/app/dialogs', () => ({ dialogs: { confirm: async () => fake.confirm } }));
vi.mock('$lib/app/modals', () => ({
  modals: {
    open: async (component: unknown, props: { model: TemplateManager }, options?: { wide?: boolean; mayClose?: () => boolean | Promise<boolean> }) => {
      fake.opened.push({ component, props, options });
      return undefined;
    },
  },
}));
vi.mock('$lib/app/userConfig', async () => {
  const { writable } = await import('svelte/store');
  return {
    userConfig: {
      files: writable([{ kind: 'codes', name: 'my-lathe.json', error: null }, { kind: 'profiles', name: 'p.json', error: null }]),
      load: async () => {
        fake.loaded += 1;
        return [];
      },
    },
  };
});
vi.mock('$lib/app/fileOps', () => ({
  files: {
    open: async (paths: string[], opts?: unknown) => {
      fake.openPaths.push(paths);
      fake.openOptions.push(opts);
      const { docs } = await import('$lib/stores/documents');
      const name = paths[0].slice(paths[0].lastIndexOf('/') + 1);
      const id = docs.add(
        {
          path: paths[0],
          untitledIndex: null,
          profileId: 'fanuc-gcode',
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
        },
        { activate: true },
      );
      fake.texts.set(id, fake.folder.get(name) ?? '');
      return [id];
    },
    save: async (id: string) => {
      fake.saves.push(id);
      if (!fake.saveAnswer) return false;
      const { docs } = await import('$lib/stores/documents');
      const path = docs.get(id)?.path ?? '';
      fake.folder.set(path.slice(path.lastIndexOf('/') + 1), fake.texts.get(id) ?? '');
      return true;
    },
  },
}));
vi.mock('$lib/platform/commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/platform/commands')>()),
  userFilesList: async () => [...fake.folder].map(([name, text]) => ({ name, text, error: null })),
  userFilePath: async (_kind: string, name: string) => `/cfg/codes/${name}`,
  userFileCreate: async (_kind: string, name: string, text: string) => {
    fake.created.push({ name, text });
    fake.folder.set(name, text);
    return `/cfg/codes/${name}`;
  },
}));
vi.mock('$lib/monaco/editorService', () => ({
  editor: {
    hasModel: () => true,
    cursor: () => fake.cursor,
    getLineCount: () => fake.lines.length,
    getLines: (_id: string, from: number, to: number) => fake.lines.slice(from - 1, to),
    selectionLines: () => fake.selection,
    getText: (id: string) => fake.texts.get(id) ?? '',
    replaceAll: (id: string, text: string) => {
      fake.replaces.push(id);
      fake.texts.set(id, text);
    },
    markClean: (id: string) => {
      fake.marked.push(id);
    },
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
    },
  };
});

const contrib = (await import('./templateManager')).default;
const { documentEnv, machineTypesOf, manageableDialects, realDeps, starKey } = await import('./templateManager');
const { createTemplateManager } = await import('$lib/app/templateManager');
const { templates } = await import('$lib/app/templateService');
const { docs } = await import('$lib/stores/documents');
const { hasKey } = await import('$lib/i18n');
const { TEMPLATE_LIMITS, loadTemplates } = await import('$lib/core/templates');

const commandOf = (id: string) => {
  const found = contrib.commands.find((c) => c.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
};
const run = (id: string): Promise<unknown> => Promise.resolve((commandOf(id).run as (c: unknown) => unknown)({ activeDocId: docs.getActiveId() }));

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
  return docs.add(meta, { activate: true });
}

function stateOf(m: TemplateManager): ManagerState {
  return get(m.state);
}

beforeEach(() => {
  for (const doc of docs.all()) docs.remove(doc.id);
  fake.shown.length = 0;
  fake.opened.length = 0;
  fake.folder.clear();
  fake.created.length = 0;
  fake.texts.clear();
  fake.lines = [];
  fake.selection = null;
  fake.cursor = { line: 1 };
  fake.openPaths.length = 0;
  fake.openOptions.length = 0;
  fake.marked.length = 0;
  fake.saveAnswer = true;
  fake.saves.length = 0;
  fake.replaces.length = 0;
  fake.loaded = 0;
  fake.confirm = true;
});

describe('the commands', () => {
  it('declares the two commands, no default keys, in the Insert tab after the templates', () => {
    expect(contrib.commands.map((c) => [c.id, c.title, c.category])).toEqual([
      ['templates.manage', 'templateManager.manage', 'templateManager.category'],
      ['templates.fromSelection', 'templateManager.fromSelection', 'templateManager.category'],
    ]);
    for (const c of contrib.commands) {
      expect('keys' in c).toBe(false);
      expect(hasKey(c.title)).toBe(true);
    }
    expect(contrib.ribbon.map((r) => [r.tab, r.group, r.command])).toEqual([
      ['insert', 'templateManager.group', 'templates.fromSelection'],
      ['insert', 'templateManager.group', 'templates.manage'],
    ]);
    expect(Math.min(...contrib.ribbon.map((r) => r.order))).toBeGreaterThan(100);
  });

  it('is enabled with a program open', () => {
    for (const c of contrib.commands) {
      expect(c.enabled?.({ activeDocId: null } as never)).toBe(false);
      expect(c.enabled?.({ activeDocId: 'doc' } as never)).toBe(true);
    }
  });
});

describe('Manage Templates', () => {
  it('says so when no program is open, and opens nothing', async () => {
    await run('templates.manage');
    expect(fake.shown).toEqual([{ text: 'Open a program first. Its templates are the ones you manage.', error: true }]);
    expect(fake.opened).toEqual([]);
  });

  it('opens the manager on the code set of the active program’s profile, for its machine type', async () => {
    addDoc('fanuc-lathe');
    await run('templates.manage');
    expect(fake.opened).toHaveLength(1);
    const model = fake.opened[0].props.model;
    const s = stateOf(model);
    expect(s.dialect).toBe('fanuc-lathe');
    expect(s.fileName).toBe('fanuc-lathe.json');
    expect(s.fileExists).toBe(false);
    // Every built-in database and every code file of yours, and not the profiles.
    expect(s.dialects).toEqual(expect.arrayContaining(['fanuc', 'fanuc-lathe', 'fanuc-lathe-b', 'heidenhain', 'my-lathe', 'okuma', 'sinumerik']));
    expect(s.dialects).not.toContain('p');
    expect(s.rows.length).toBeGreaterThan(5);
    expect(s.rows.every((r) => r.origin === 'builtin')).toBe(true);
    // A template your own would be given the machine type of the program.
    model.add();
    expect(stateOf(model).rows.at(-1)?.def?.machineType).toBe('lathe');
  });
});

describe('the dialog’s options (P3b intB)', () => {
  it('opens the manager wide, and asks before the host closes it with unsaved edits', async () => {
    addDoc('fanuc-lathe');
    await run('templates.manage');
    const { props, options } = fake.opened[0];
    expect(options?.wide).toBe(true);
    // Nothing edited: the host may close it without a question.
    fake.confirm = false;
    expect(await options!.mayClose!()).toBe(true);
    // An unsaved edit: the question is the model's "leave", and the answer is the user's.
    props.model.add();
    expect(await options!.mayClose!()).toBe(false);
    fake.confirm = true;
    expect(await options!.mayClose!()).toBe(true);
  });

  it('gives the dialog of a selection the same options', async () => {
    addDoc('fanuc-gcode');
    fake.lines = ['N10 G0 X0'];
    fake.selection = { startLine: 1, endLine: 1, empty: false };
    await run('templates.fromSelection');
    expect(fake.opened[0].options?.wide).toBe(true);
    expect(typeof fake.opened[0].options?.mayClose).toBe('function');
  });
});

describe('New Template from Selection', () => {
  it('asks for a selection first', async () => {
    addDoc();
    await run('templates.fromSelection');
    fake.selection = { startLine: 3, endLine: 3, empty: true };
    await run('templates.fromSelection');
    expect(fake.shown.map((s) => s.text)).toEqual(Array(2).fill('Select the blocks to turn into a template first.'));
    expect(fake.opened).toEqual([]);
  });

  it('refuses a selection longer than a template body may be', async () => {
    addDoc();
    fake.selection = { startLine: 1, endLine: TEMPLATE_LIMITS.bodyLines + 1, empty: false };
    await run('templates.fromSelection');
    expect(fake.shown[0].text).toBe(`Select at most ${TEMPLATE_LIMITS.bodyLines} lines for a template.`);
    expect(fake.opened).toEqual([]);
  });

  it('opens the manager on a draft of the selected lines, read with the program’s own profile and database', async () => {
    addDoc('fanuc-gcode');
    fake.lines = ['%', 'O1000', 'N10 G98 G83 X20. Y60. Z-18. R3. Q4. F240.', 'N20 G80', 'M30'];
    fake.selection = { startLine: 3, endLine: 4, empty: false };
    await run('templates.fromSelection');
    expect(fake.opened).toHaveLength(1);
    const s = stateOf(fake.opened[0].props.model);
    expect(s.dialect).toBe('fanuc');
    expect(s.draft?.draft.body).toBe('{{N}}G98 G83 X20. Y60. Z-18. R3. Q4. F240.\n{{N}}G80');
    expect(s.draft?.draft.candidates.map((c) => `${c.address}${c.written}`)).toEqual(['X20.', 'Y60.', 'Z-18.', 'R3.', 'Q4.', 'F240.']);
    expect(s.draft?.chosen).toEqual([]);
  });

  it('ticks, names and saves it into the user file of the program’s code set, end to end', async () => {
    addDoc('fanuc-gcode');
    fake.lines = ['N10 G98 G83 X20. Y60. Z-18. R3. Q4. F240.'];
    fake.selection = { startLine: 1, endLine: 1, empty: false };
    await run('templates.fromSelection');
    const model = fake.opened[0].props.model;
    const draft = stateOf(model).draft!.draft;
    for (const key of draft.candidates.filter((c) => ['Z', 'Q', 'F'].includes(c.address)).map((c) => c.key)) model.toggleCandidate(key);
    model.setDraft('label', 'My peck cycle');
    expect(model.applyDraft()).toBe(true);
    expect(await model.save()).toEqual({ ok: true });

    // A new file, made with user_file_create, and the registries asked to read the folder again.
    expect(fake.created.map((c) => c.name)).toEqual(['fanuc.json']);
    expect(fake.loaded).toBe(1);
    const written = JSON.parse(fake.created[0].text) as { dialect: string; version: number; templates: unknown[] };
    expect(written).toMatchObject({ dialect: 'fanuc', version: 1 });
    const [saved] = loadTemplates(written.templates);
    expect(saved).toMatchObject({ id: 'my-peck-cycle', label: 'My peck cycle', group: 'My templates', machineType: 'mill', body: '{{N}}G98 G83 X20. Y60. {{z}} R3. {{q}} {{f}}' });
    expect(saved.params?.map((p) => [p.id, p.default])).toEqual([['z', '-18.'], ['q', '4.'], ['f', '240.']]);
  });
});

describe('the wiring of Save through the file’s document', () => {
  it('opens the code file as a document, edits it once, saves it with files.save, and leaves the active tab as it was', async () => {
    const main = addDoc('fanuc-lathe', '/nc/part.nc');
    const original = `${JSON.stringify({ dialect: 'fanuc-lathe', version: 1, codes: [], templates: [{ id: 'mine', label: 'Mine', group: 'G', body: 'M0' }] }, null, 4)}\n`;
    fake.folder.set('fanuc-lathe.json', original);
    await run('templates.manage');
    const model = fake.opened[0].props.model;
    expect(stateOf(model).fileExists).toBe(true);
    expect(stateOf(model).rows.some((r) => r.origin === 'user' && r.def?.id === 'mine')).toBe(true);

    const row = stateOf(model).rows.find((r) => r.def?.id === 'mine')!;
    model.setField(row.key, 'label', 'Mine, changed');
    expect(await model.save()).toEqual({ ok: true });

    expect(fake.openPaths).toEqual([['/cfg/codes/fanuc-lathe.json']]);
    // CODE-07: the program the user works in (maybe an untouched new document) is not replaced by the file's tab.
    expect(fake.openOptions).toEqual([{ keepScratch: true }]);
    expect(fake.replaces).toHaveLength(1);
    expect(fake.saves).toHaveLength(1);
    const written = JSON.parse(fake.folder.get('fanuc-lathe.json') as string) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(['dialect', 'version', 'codes', 'templates']);
    expect((written.templates as { label: string }[])[0].label).toBe('Mine, changed');
    expect(fake.folder.get('fanuc-lathe.json')).toBe(`${JSON.stringify(written, null, 2)}\n`);
    expect(fake.created).toEqual([]);
    expect(docs.getActiveId()).toBe(main);
    // The file's tab stays open, and the registries were asked to read the folder again.
    expect(docs.all().some((d) => d.path === '/cfg/codes/fanuc-lathe.json')).toBe(true);
    expect(fake.loaded).toBe(1);
  });

  it('CODE-02/03: asks the lock of the file’s tab, and puts the tab back as it was when the save does not happen', async () => {
    addDoc('fanuc-lathe', '/nc/part.nc');
    const original = `${JSON.stringify({ dialect: 'fanuc-lathe', version: 1, templates: [{ id: 'mine', label: 'Mine', group: 'G', body: 'M0' }] }, null, 2)}\n`;
    fake.folder.set('fanuc-lathe.json', original);
    const file = addDoc('fanuc-gcode', '/cfg/codes/fanuc-lathe.json');
    fake.texts.set(file, original);
    docs.activate(docs.all()[0].id);
    await run('templates.manage');
    const model = fake.opened[0].props.model;
    model.setField(stateOf(model).rows.find((r) => r.def?.id === 'mine')!.key, 'label', 'Changed');

    // Locked: refused with the lock's message, the tab untouched.
    docs.update(file, { readOnly: true, readOnlyReason: 'user' });
    expect(await model.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(model).message).toMatchObject({ error: true, msg: { key: 'readOnly.refusedUser' } });
    expect(fake.replaces).toEqual([]);
    // Unlocked, but the save does not happen: the old text is back and the tab is marked clean.
    docs.update(file, { readOnly: false, readOnlyReason: null });
    fake.saveAnswer = false;
    expect(await model.save()).toEqual({ ok: false, reason: 'failed' });
    expect(fake.texts.get(file)).toBe(original);
    expect(fake.marked).toEqual([file]);
  });

  it('refuses a code file whose open document has unsaved changes', async () => {
    addDoc('fanuc-lathe', '/nc/part.nc');
    fake.folder.set('fanuc-lathe.json', '{ "dialect": "fanuc-lathe", "version": 1, "templates": [] }');
    const open = addDoc('fanuc-gcode', '/cfg/codes/fanuc-lathe.json');
    docs.update(open, { textDirty: true });
    docs.activate(docs.all()[0].id);
    await run('templates.manage');
    const model = fake.opened[0].props.model;
    model.add();
    expect(await model.save()).toEqual({ ok: false, reason: 'dirtyDocument' });
    expect(fake.replaces).toEqual([]);
    expect(fake.saves).toEqual([]);
  });
});

describe('the services the manager reads', () => {
  it('reads the built-in templates and the variants that replace some of them from the loaded databases', () => {
    const deps = realDeps('x');
    const base = deps.baseTemplates('fanuc-lathe');
    expect(base.length).toBeGreaterThan(3);
    expect(base.every((d) => d.review === 'pending')).toBe(true);
    const variants = deps.variants('fanuc-lathe');
    expect(variants.map((v) => [v.dialect, v.label])).toEqual([['fanuc-lathe-b', 'G-code system B']]);
    expect(variants[0].ids).toContain('tool-start');
    expect(deps.variants('heidenhain')).toEqual([]);
    expect(deps.dialects()).toContain('my-lathe');
  });

  // P3b fix H, finding 2: `fanuc-lathe` extends `fanuc`, and the manager listed the mill templates it
  // inherits (tool change, drills, tapping, boring) although no lathe program is ever offered one.
  it('lists the built-in templates a program of the code set is offered, the same ones the Insert tab shows', async () => {
    const builtinIds = async (docId: string, dialect: string): Promise<string[]> => {
      const model = createTemplateManager(realDeps(docId));
      expect(await model.load(dialect)).toBe(true);
      return stateOf(model)
        .rows.filter((r) => r.origin === 'builtin')
        .map((r) => (r.def as { id: string }).id)
        .sort();
    };
    const offered = (docId: string): string[] => templates.list(docId).map((d) => d.id).sort();
    const lathe = addDoc('fanuc-lathe');
    const mill = addDoc('fanuc-gcode');
    const turning = addDoc('sinumerik');
    const klartext = addDoc('heidenhain-klartext');
    expect(await builtinIds(lathe, 'fanuc-lathe')).toEqual(offered(lathe));
    expect(await builtinIds(lathe, 'fanuc-lathe')).not.toContain('tapping');
    expect(await builtinIds(mill, 'fanuc')).toEqual(offered(mill));
    expect(await builtinIds(mill, 'fanuc')).not.toContain('threading');
    // The code set of system B is a lathe set too (the choice of the lathe profile's variant).
    expect(await builtinIds(lathe, 'fanuc-lathe-b')).toEqual(offered(lathe));
    // One code set, two profiles (turning and milling): both machine types are offered.
    expect(await builtinIds(turning, 'sinumerik')).toEqual(expect.arrayContaining(['stock-removal', 'peck-drill', 'program-start']));
    expect(await builtinIds(klartext, 'heidenhain')).toEqual(offered(klartext));
  });

  // The note "G-code system B documents use their own version of this template" belongs on the lathe's
  // "Program start" and "Tool start" (what `fanuc-lathe-b` defines), not on the mill's templates of
  // those ids: `fanuc-lathe-b` reaches the mill set through the lathe set, which defines them again.
  it('notes the system B version only on the templates of the set it replaces', async () => {
    const lathe = addDoc('fanuc-lathe');
    const noted = async (dialect: string): Promise<string[]> => {
      const model = createTemplateManager(realDeps(lathe));
      await model.load(dialect);
      return stateOf(model)
        .rows.filter((r) => r.variants.length > 0)
        .map((r) => (r.def as { id: string }).id)
        .sort();
    };
    expect(await noted('fanuc-lathe')).toEqual(['program-start', 'tool-start']);
    expect(await noted('fanuc')).toEqual([]);
  });

  it('knows the machine type of every profile that uses a code set, as its own or as a variant’s', () => {
    expect(machineTypesOf('fanuc-lathe')).toEqual(['lathe']);
    expect(machineTypesOf('fanuc-lathe-b')).toEqual(['lathe']);
    expect(machineTypesOf('fanuc')).toEqual(['mill']);
    expect([...machineTypesOf('sinumerik')].sort()).toEqual(['lathe', 'mill']);
    expect(machineTypesOf('no-such-set')).toEqual([]);
  });

  it('lists the code sets: the built-in ones and yours, each once', () => {
    expect(manageableDialects([{ kind: 'codes', name: 'fanuc.json' }, { kind: 'codes', name: 'Mine.JSON' }, { kind: 'profiles', name: 'z.json' }])).toEqual(
      expect.arrayContaining(['fanuc', 'Mine']),
    );
    expect(manageableDialects([{ kind: 'codes', name: 'fanuc.json' }]).filter((id) => id === 'fanuc')).toHaveLength(1);
    expect(manageableDialects([{ kind: 'profiles', name: 'z.json' }])).not.toContain('z');
  });
});

describe('the stars are the Insert tab’s stars (P3b intB)', () => {
  it('keeps them in the service, under the key of the document’s effective database for its own code set', () => {
    const id = addDoc('fanuc-lathe');
    const deps = realDeps(id);
    expect(starKey(id, 'fanuc-lathe')).toBe('fanuc-lathe');
    deps.favorites.set('fanuc-lathe', 'tool-start', true);
    expect(templates.favorites('fanuc-lathe')).toEqual(['tool-start']);
    expect(deps.favorites.get('fanuc-lathe')).toEqual(['tool-start']);
    deps.favorites.set('fanuc-lathe', 'tool-start', false);
    expect(templates.favorites('fanuc-lathe')).toEqual([]);
  });

  it('under G-code system B a star in the manager is a star of the tab, which reads the system B database', () => {
    const id = addDoc('fanuc-lathe');
    const spy = vi.spyOn(templates, 'dialectOf').mockReturnValue('fanuc-lathe-b');
    try {
      expect(starKey(id, 'fanuc-lathe')).toBe('fanuc-lathe-b');
      // Another code set picked in the manager keeps its own key.
      expect(starKey(id, 'my-lathe')).toBe('my-lathe');
      realDeps(id).favorites.set('fanuc-lathe', 'tool-start', true);
      expect(templates.favorites('fanuc-lathe-b')).toEqual(['tool-start']);
      expect(templates.favorites('fanuc-lathe')).toEqual([]);
      expect(realDeps(id).favorites.get('fanuc-lathe')).toEqual(['tool-start']);
    } finally {
      spy.mockRestore();
      templates.setFavorite('fanuc-lathe-b', 'tool-start', false);
    }
  });
});

describe('the star key is read once (CODE-07)', () => {
  it('keeps working with the code set the program had when the manager opened, whatever happens to its tab', () => {
    const id = addDoc('fanuc-lathe');
    const spy = vi.spyOn(templates, 'dialectOf').mockReturnValue('fanuc-lathe-b');
    try {
      const deps = realDeps(id);
      docs.remove(id);
      spy.mockReturnValue(null);
      deps.favorites.set('fanuc-lathe', 'tool-start', true);
      expect(templates.favorites('fanuc-lathe-b')).toEqual(['tool-start']);
      expect(deps.favorites.get('fanuc-lathe')).toEqual(['tool-start']);
    } finally {
      spy.mockRestore();
      templates.setFavorite('fanuc-lathe-b', 'tool-start', false);
    }
  });
});

describe('the preview’s environment', () => {
  it('continues from the block number at or above the cursor and says the program is numbered', () => {
    const id = addDoc('fanuc-gcode');
    fake.lines = ['O1000', 'N10 G0 X0', 'N20 G1 X1', 'N30 G1 X2', 'M30'];
    fake.cursor = { line: 3 };
    const env = documentEnv(id, new Date(2026, 9, 9, 8, 5));
    expect(env).toMatchObject({ prevBlockNumber: 20, numbered: true, sys: { date: '2026-10-09', time: '08:05', file: 'part.nc', stem: 'part' } });
  });

  it('is unnumbered without block numbers, has no number above the first line, and no file name for an untitled program', () => {
    const id = addDoc('fanuc-gcode', null);
    fake.lines = ['G0 X0', 'G1 X1'];
    fake.cursor = null;
    const env = documentEnv(id);
    expect(env).toMatchObject({ prevBlockNumber: null, numbered: false, sys: { file: '', stem: '' } });
    expect(documentEnv('nope')).toBeNull();
  });

  it('is always numbered on a Klartext profile', () => {
    const id = addDoc('heidenhain-klartext');
    fake.lines = ['BEGIN PGM X MM', 'TOOL CALL 1 Z S3000'];
    expect(documentEnv(id)?.numbered).toBe(true);
  });
});
