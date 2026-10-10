// The template manager's model (Phase 3 plan §5 P3.9, AD-40). Owner: P3.9.
//
// The files, the documents and the dialogs are fakes (`world()`); the loader (`loadTemplates`), the
// engine (`renderTemplate`), the selection engine (`templateFromSelection`) and the built-in databases
// are the real ones, so what the manager writes is read back by the same reader the application uses.

import { describe, expect, it } from 'vitest';
import { hasKey } from '$lib/i18n';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { loadTemplates, renderTemplate, templateFromSelection, TEMPLATE_LIMITS, type TemplateDef, type TemplateEnv } from '$lib/core/templates';
import { cpOf } from '../../../tests/unit/helpers/profiles';
import {
  PARAM_MEMBERS,
  PARAM_TYPES,
  baseTemplatesFrom,
  createTemplateManager,
  fileTextWith,
  groupRows,
  insertAt,
  slugId,
  uniqueId,
  variantsFrom,
  visibleRows,
  type ManagerState,
  type TemplateManager,
  type TemplateManagerDeps,
} from './templateManager';

const BASE: TemplateDef[] = [
  { id: 'program-start', label: 'Program start', group: 'Program', body: '%\nO{{n}}', params: [{ id: 'n', label: 'Number', type: 'integer', required: true, default: 1000 }], review: 'pending' },
  { id: 'tool-start', label: 'Tool start', group: 'Tool change', body: 'T{{t}} M6', params: [{ id: 't', label: 'Tool', type: 'integer', required: true, default: 1 }], review: 'pending' },
  { id: 'program-end', label: 'Program end', group: 'Program', body: 'M30', review: 'pending' },
];

const NAME = 'fanuc-lathe.json';
const PATH = `/cfg/codes/${NAME}`;

interface World {
  /** The code files folder: name → text. */
  folder: Map<string, string>;
  /** The open documents by path. */
  documents: Map<string, { id: string; text: string; dirty: boolean; locked: boolean; refuses?: boolean }>;
  trace: string[];
  created: { name: string; text: string }[];
  backups: string[];
  writes: string[];
  opened: string[];
  confirms: { title: string; message: string }[];
  answer: { confirm: boolean; save: boolean };
  favoriteSet: [string, string, boolean][];
  active: { id: string | null };
  starred: Set<string>;
  env: TemplateEnv | null;
  deps: TemplateManagerDeps;
}

function world(o: { files?: Record<string, string>; base?: TemplateDef[]; env?: TemplateEnv | null } = {}): World {
  const w: World = {
    folder: new Map(Object.entries(o.files ?? {})),
    documents: new Map(),
    trace: [],
    created: [],
    backups: [],
    writes: [],
    opened: [],
    confirms: [],
    answer: { confirm: true, save: true },
    favoriteSet: [],
    active: { id: 'doc-main' },
    starred: new Set(),
    env: o.env === undefined ? { cp: cpOf('fanuc-lathe'), prevBlockNumber: null, numbered: false, sys: { date: '2026-10-09', time: '12:00', file: 'a.nc', stem: 'a' } } : o.env,
    deps: undefined as unknown as TemplateManagerDeps,
  };
  let nextDoc = 1;
  w.deps = {
    dialects: () => ['fanuc', 'fanuc-lathe'],
    baseTemplates: () => (o.base ?? BASE).map((d) => structuredClone(d)),
    variants: () => [],
    userFiles: {
      list: async () => [...w.folder].map(([name, text]) => ({ name, text, error: null })),
      path: async (name) => `/cfg/codes/${name}`,
      create: async (name, text) => {
        if (w.folder.has(name)) throw new Error('name taken');
        w.trace.push('create');
        w.created.push({ name, text });
        w.folder.set(name, text);
        return `/cfg/codes/${name}`;
      },
    },
    reloadUserFiles: async () => {
      w.trace.push('reload');
    },
    docs: {
      find: (path) => {
        const d = w.documents.get(path);
        return d === undefined ? undefined : { id: d.id, dirty: d.dirty, title: path.slice(path.lastIndexOf('/') + 1) };
      },
      open: async (path) => {
        const text = w.folder.get(path.slice(path.lastIndexOf('/') + 1));
        if (text === undefined) return null;
        w.trace.push('open');
        w.opened.push(path);
        const id = `doc-${++nextDoc}`;
        w.documents.set(path, { id, text, dirty: false, locked: false });
        w.active.id = id; // files.open activates the tab
        return id;
      },
      text: (id) => [...w.documents.values()].find((d) => d.id === id)?.text ?? '',
      replace: (id, text) => {
        const d = [...w.documents.values()].find((x) => x.id === id);
        if (d === undefined || d.locked) return;
        w.trace.push('replace');
        d.text = text;
        d.dirty = true;
      },
      refusal: (id, action) => {
        const d = [...w.documents.values()].find((x) => x.id === id);
        return d?.refuses === true ? { key: 'readOnly.refusedUser', params: { name: 'fanuc-lathe.json', action } } : null;
      },
      markClean: (id) => {
        const d = [...w.documents.values()].find((x) => x.id === id);
        if (d !== undefined) d.dirty = false;
      },
      save: async (id) => {
        const entry = [...w.documents].find(([, d]) => d.id === id);
        if (entry === undefined || !w.answer.save) return false;
        const [path, d] = entry;
        const name = path.slice(path.lastIndexOf('/') + 1);
        w.trace.push('backup');
        w.backups.push(w.folder.get(name) ?? '');
        w.trace.push('write');
        w.writes.push(name);
        w.folder.set(name, d.text);
        d.dirty = false;
        w.trace.push('hook-reload'); // contrib/userConfig.ts reloads on save
        return true;
      },
      activeId: () => w.active.id,
      activate: (id) => {
        w.active.id = id;
      },
    },
    confirm: async (c) => {
      w.confirms.push({ title: c.title, message: c.message });
      return w.answer.confirm;
    },
    favorites: {
      get: () => [...w.starred],
      set: (dialect, id, on) => {
        w.favoriteSet.push([dialect, id, on]);
        if (on) w.starred.add(id);
        else w.starred.delete(id);
      },
    },
    env: () => w.env,
  };
  return w;
}

function stateOf(m: TemplateManager): ManagerState {
  let value: ManagerState | undefined;
  m.state.subscribe((s) => (value = s))();
  return value as ManagerState;
}

async function open(w: World, dialect = 'fanuc-lathe', o?: { machineType?: 'mill' | 'lathe' }): Promise<TemplateManager> {
  const m = createTemplateManager(w.deps);
  await m.load(dialect, o);
  return m;
}

const rowFor = (m: TemplateManager, id: string) => {
  const row = stateOf(m).rows.find((r) => r.def?.id === id && (r.origin !== 'builtin' || !stateOf(m).rows.some((x) => x.origin === 'override' && x.def?.id === id)));
  if (row === undefined) throw new Error(`no row ${id}`);
  return row;
};

const mine = (extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify(
    {
      dialect: 'fanuc-lathe',
      version: 1,
      note: 'kept as it is',
      codes: [{ code: 'M97', label: 'My code' }],
      templates: [
        { id: 'my-tool', label: 'My tool', group: 'Mine', body: 'T{{t}} M6', params: [{ id: 't', label: 'Tool', type: 'integer', required: true }], keepMe: 'unknown member' },
        { id: 'tool-start', label: 'My tool start', group: 'Tool change', body: 'T{{t}}0{{t}} M6', params: [{ id: 't', label: 'Tool', type: 'integer' }] },
      ],
      extra: { deep: [1, 2, { x: 3 }] },
      ...extra,
    },
    null,
    4,
  )}\n`;

describe('opening a code set', () => {
  it('lists the built-in templates read-only, with their review mark, and nothing of yours without a file', async () => {
    const w = world();
    const m = await open(w);
    const s = stateOf(m);
    expect(s.fileExists).toBe(false);
    expect(s.fileName).toBe(NAME);
    expect(s.dirty).toBe(false);
    expect(s.rows.map((r) => [r.def?.id, r.origin])).toEqual([
      ['program-start', 'builtin'],
      ['tool-start', 'builtin'],
      ['program-end', 'builtin'],
    ]);
    expect(s.rows.every((r) => r.def?.review === 'pending')).toBe(true);
    expect(s.selected).toBe(s.rows[0].key);
    expect(groupRows(visibleRows(s, '')).map((g) => [g.group, g.rows.length])).toEqual([
      ['Program', 2],
      ['Tool change', 1],
    ]);
  });

  it('reads your file: your own templates, one that replaces a built-in one, and an entry it cannot read kept as it is', async () => {
    const text = mine({
      templates: [
        { id: 'my-tool', label: 'My tool', group: 'Mine', body: 'T{{t}} M6', params: [{ id: 't', label: 'Tool', type: 'integer' }] },
        { id: 'tool-start', label: 'My tool start', group: 'Tool change', body: 'M6' },
        { id: 'Bad Id', label: 'Broken', group: 'Mine', body: 'X' },
      ],
    });
    const m = await open(world({ files: { [NAME]: text } }));
    const s = stateOf(m);
    expect(s.fileExists).toBe(true);
    expect(s.fileError).toBeNull();
    expect(s.rows.map((r) => [r.def?.id ?? null, r.origin, r.problems.length > 0])).toEqual([
      ['program-start', 'builtin', false],
      ['tool-start', 'builtin', false],
      ['program-end', 'builtin', false],
      ['my-tool', 'user', false],
      ['tool-start', 'override', false],
      [null, 'user', true],
    ]);
    // The built-in template your own replaces is not listed twice.
    expect(visibleRows(s, '').map((r) => `${r.origin}:${r.def?.id ?? '?'}`)).toEqual([
      'builtin:program-start',
      'builtin:program-end',
      'user:my-tool',
      'override:tool-start',
      'user:?',
    ]);
    const broken = s.rows[5];
    expect(broken.problems[0].path).toContain('.id');
    expect(broken.problems[0].message).toContain('lower-case');
    expect(s.dirty).toBe(false);
  });

  it('says why a file cannot be edited and edits nothing: not JSON, not an object, templates not a list', async () => {
    for (const [text, key] of [
      ['{ nope', 'templateManager.file.notJson'],
      ['[1]', 'templateManager.file.notObject'],
      ['{ "dialect": "fanuc-lathe", "templates": {} }', 'templateManager.file.notList'],
    ] as const) {
      const w = world({ files: { [NAME]: text } });
      const m = await open(w);
      expect(stateOf(m).fileError?.key).toBe(key);
      expect((await m.save()).ok).toBe(false);
      expect(w.created).toEqual([]);
      expect(w.writes).toEqual([]);
    }
  });

  it('reads the built-in templates of a real database, with the system B variant noted on the ones it replaces', () => {
    const sources = BUILTIN_CODE_DB_JSON as Record<string, unknown>;
    const ids = Object.keys(sources);
    const lathe = baseTemplatesFrom(sources, ids, 'fanuc-lathe');
    expect(lathe.map((d) => d.id)).toContain('tool-start');
    expect(lathe.every((d) => d.review === 'pending')).toBe(true);
    const variants = variantsFrom(sources, 'fanuc-lathe', new Map([['fanuc-lathe-b', 'G-code system B'], ['fanuc', 'not below']]));
    expect(variants).toEqual([{ dialect: 'fanuc-lathe-b', label: 'G-code system B', ids: expect.arrayContaining(['tool-start']) }]);
    // A database that extends another one lists what it inherits.
    expect(baseTemplatesFrom(sources, ids, 'fanuc-lathe-b').map((d) => d.id)).toEqual(expect.arrayContaining(lathe.map((d) => d.id)));
    expect(baseTemplatesFrom(sources, ids, 'no-such-set')).toEqual([]);
  });

  it('P3b fix H: a variant replaces the template of the set whose own version it overrides, not one further up the chain', () => {
    const sources = BUILTIN_CODE_DB_JSON as Record<string, unknown>;
    const labels = new Map([['fanuc-lathe-b', 'G-code system B']]);
    // `fanuc-lathe-b` -> `fanuc-lathe` -> `fanuc`, and the lathe set defines "Program start" and "Tool start" again.
    expect(variantsFrom(sources, 'fanuc-lathe', labels).map((v) => v.ids)).toEqual([['program-start', 'tool-start']]);
    expect(variantsFrom(sources, 'fanuc', labels)).toEqual([]);
    // A set between the variant and `dialect` that does not define the id leaves it to the variant.
    const chain = {
      root: { templates: [{ id: 'a', label: 'A', group: 'G', body: 'M0' }, { id: 'b', label: 'B', group: 'G', body: 'M0' }] },
      mid: { extends: 'root', templates: [{ id: 'b', label: 'B2', group: 'G', body: 'M1' }] },
      leaf: { extends: 'mid', templates: [{ id: 'a', label: 'A3', group: 'G', body: 'M2' }, { id: 'b', label: 'B3', group: 'G', body: 'M2' }] },
    };
    const names = new Map([['leaf', 'Leaf']]);
    expect(variantsFrom(chain, 'root', names)).toEqual([{ dialect: 'leaf', label: 'Leaf', ids: ['a'] }]);
    expect(variantsFrom(chain, 'mid', names)).toEqual([{ dialect: 'leaf', label: 'Leaf', ids: ['a', 'b'] }]);
  });

  it('takes the user layer out of the base: an overlay and a database of your own show what is below them', () => {
    const builtin = BUILTIN_CODE_DB_JSON as Record<string, unknown>;
    const ids = Object.keys(builtin);
    const own = { dialect: 'fanuc-lathe', version: 1, templates: [{ id: 'mine', label: 'Mine', group: 'G', body: 'M0' }] };
    const overlay = { ...builtin, 'fanuc-lathe@base': builtin['fanuc-lathe'], 'fanuc-lathe': { ...own, extends: 'fanuc-lathe@base' } };
    const base = baseTemplatesFrom(overlay, ids, 'fanuc-lathe').map((d) => d.id);
    expect(base).toContain('tool-start');
    expect(base).not.toContain('mine');
    const userDb = { ...builtin, 'my-lathe': { dialect: 'my-lathe', version: 1, extends: 'fanuc-lathe', templates: own.templates } };
    const fromUser = baseTemplatesFrom(userDb, ids, 'my-lathe').map((d) => d.id);
    expect(fromUser).toContain('tool-start');
    expect(fromUser).not.toContain('mine');
  });
});

describe('duplicate, new, edit, delete, reorder, favourite', () => {
  it('Duplicate of a built-in template with a new id makes a template of your own, without the review mark', async () => {
    const m = await open(world());
    m.duplicate(rowFor(m, 'tool-start').key, 'copy');
    const s = stateOf(m);
    const copy = s.rows[s.rows.length - 1];
    expect(copy.origin).toBe('user');
    expect(copy.def).toMatchObject({ id: 'tool-start-copy', label: 'Tool start (copy)', group: 'Tool change', body: 'T{{t}} M6' });
    expect(copy.def?.review).toBeUndefined();
    expect(s.selected).toBe(copy.key);
    expect(s.dirty).toBe(true);
    // And again: the id stays free.
    m.duplicate(copy.key, 'copy');
    expect(stateOf(m).rows.map((r) => r.def?.id)).toContain('tool-start-copy-2');
  });

  it('Duplicate with the same id replaces the built-in template (an override); a second one is refused', async () => {
    const m = await open(world());
    const builtin = rowFor(m, 'tool-start');
    m.duplicate(builtin.key, 'override');
    const s = stateOf(m);
    const row = s.rows[s.rows.length - 1];
    expect(row.origin).toBe('override');
    expect(row.def?.id).toBe('tool-start');
    expect(visibleRows(s, '').filter((r) => r.def?.id === 'tool-start')).toHaveLength(1);
    m.duplicate(builtin.key, 'override');
    const again = stateOf(m);
    expect(again.rows).toHaveLength(s.rows.length);
    expect(again.message).toMatchObject({ error: true, msg: { key: 'templateManager.duplicate.alreadyOverridden' } });
    expect(again.selected).toBe(row.key);
  });

  it('New makes a template with a free id in the machine type of the document, and leaves the others alone', async () => {
    const w = world();
    const m = await open(w, 'fanuc-lathe', { machineType: 'lathe' });
    m.add();
    m.add();
    const users = stateOf(m).rows.filter((r) => r.origin === 'user');
    expect(users.map((r) => r.def?.id)).toEqual(['new-template', 'new-template-2']);
    expect(users[0].def?.machineType).toBe('lathe');
    expect(users[0].problems).toEqual([]);
    expect(stateOf(m).rows.filter((r) => r.origin === 'builtin')).toHaveLength(3);
  });

  it('a built-in template cannot be changed, only copied', async () => {
    const m = await open(world());
    const builtin = rowFor(m, 'program-end');
    m.setField(builtin.key, 'label', 'Hacked');
    m.setBody(builtin.key, 'M0');
    m.addParam(builtin.key);
    expect(rowFor(m, 'program-end').def?.label).toBe('Program end');
    expect(stateOf(m).dirty).toBe(false);
  });

  it('edits the properties, the text and the parameters of your template, a problem showing at once', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setField(key, 'label', 'Drill 8');
    m.setField(key, 'group', 'Drilling');
    m.setField(key, 'description', 'Eight holes');
    m.setField(key, 'toolbar', true);
    m.setBody(key, 'G81 Z{{depth}} R2.\n{{missing}}');
    let row = stateOf(m).rows.find((r) => r.key === key);
    expect(row?.def).toMatchObject({ label: 'Drill 8', group: 'Drilling', description: 'Eight holes', toolbar: true });
    // {{depth}} has no parameter yet: the loader's reason, with the place in plain words.
    expect(row?.problems.map((p) => p.message)).toEqual([expect.stringContaining('no parameter')]);
    expect(row?.problems[0].where).toBe('Drill 8 › Text');
    m.addParam(key);
    m.setParam(key, 0, 'id', 'depth');
    m.setParam(key, 0, 'label', 'Depth');
    m.setParam(key, 0, 'prefix', '-');
    m.setParam(key, 0, 'min', 0);
    m.setParam(key, 0, 'default', '5');
    m.setBody(key, 'G81 Z{{depth}} R2.');
    row = stateOf(m).rows.find((r) => r.key === key);
    expect(row?.problems).toEqual([]);
    expect(row?.def?.params).toEqual([{ id: 'depth', label: 'Depth', type: 'number', required: true, prefix: '-', min: 0, default: '5' }]);
    // Cleared optional members leave the file, they are not written empty.
    m.setField(key, 'description', '');
    m.setField(key, 'toolbar', false);
    m.setParam(key, 0, 'prefix', '');
    const cleared = stateOf(m).rows.find((r) => r.key === key)?.def;
    expect(cleared).not.toHaveProperty('description');
    expect(cleared).not.toHaveProperty('toolbar');
    expect(cleared?.params?.[0]).not.toHaveProperty('prefix');
  });

  it('changing the id of a parameter follows it into the text and the formulas', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, 'G1 X{{d}} F{{f}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 'd');
    m.addParam(key);
    m.setParam(key, 1, 'id', 'f');
    m.setParamType(key, 1, 'formula');
    m.setParam(key, 1, 'formula', 'd * 2 + dd');
    m.setParam(key, 0, 'id', 'dia');
    const def = stateOf(m).rows.find((r) => r.key === key)?.def;
    expect(def?.body).toBe('G1 X{{dia}} F{{f}}');
    // Only the whole name changes: `dd` is another name.
    expect(def?.params?.[1].formula).toBe('dia * 2 + dd');
  });

  it('a change of kind drops the members the new kind may not have, so the loader never refuses the leftovers', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, 'Z{{z}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 'z');
    m.setParam(key, 0, 'min', 1);
    m.setParam(key, 0, 'max', 9);
    m.setParam(key, 0, 'decimals', 2);
    m.setParam(key, 0, 'default', '5');
    m.setParam(key, 0, 'prefix', 'Z');
    m.setParamType(key, 0, 'text');
    let p = stateOf(m).rows.find((r) => r.key === key)?.def?.params?.[0];
    expect(p).toEqual({ id: 'z', label: 'Value 1', type: 'text', required: true, prefix: 'Z' });
    m.setParamType(key, 0, 'choice');
    p = stateOf(m).rows.find((r) => r.key === key)?.def?.params?.[0];
    expect(p?.choices).toEqual([{ label: 'Choice 1', value: '1' }]);
    m.addChoice(key, 0);
    m.setChoice(key, 0, 1, 'label', 'Two');
    m.setParam(key, 0, 'default', '2');
    m.removeChoice(key, 0, 1);
    expect(stateOf(m).rows.find((r) => r.key === key)?.def?.params?.[0]).not.toHaveProperty('default');
    expect(stateOf(m).rows.find((r) => r.key === key)?.problems).toEqual([]);
    // Every kind keeps only members the loader allows for it.
    for (const type of PARAM_TYPES) {
      m.setParamType(key, 0, type);
      const q = stateOf(m).rows.find((r) => r.key === key)?.def?.params?.[0] as unknown as Record<string, unknown>;
      expect(Object.keys(q).filter((k) => !PARAM_MEMBERS[type].includes(k))).toEqual([]);
    }
  });

  it('shows the check of a formula under its field', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.addParam(key);
    m.addParam(key);
    m.setParamType(key, 1, 'formula');
    m.setParam(key, 1, 'formula', 'p1 * nothing');
    expect(m.formulaProblem(key, 1)).toContain('nothing');
    m.setParam(key, 1, 'formula', 'p1 * 2');
    expect(m.formulaProblem(key, 1)).toBeNull();
    expect(m.formulaProblem(key, 0)).toBeNull();
  });

  it('Delete asks first and only your own templates can go; an override says the built-in one comes back', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    expect(await m.remove(rowFor(m, 'program-end').key)).toBe(false);
    expect(w.confirms).toEqual([]);

    w.answer.confirm = false;
    const before = stateOf(m).rows.length;
    expect(await m.remove(rowFor(m, 'my-tool').key)).toBe(false);
    expect(stateOf(m).rows).toHaveLength(before);
    expect(w.confirms).toHaveLength(1);
    expect(w.confirms[0].message).toContain('My tool');

    w.answer.confirm = true;
    expect(await m.remove(rowFor(m, 'my-tool').key)).toBe(true);
    expect(stateOf(m).rows.some((r) => r.def?.id === 'my-tool')).toBe(false);
    const override = stateOf(m).rows.find((r) => r.origin === 'override') as { key: string };
    await m.remove(override.key);
    expect(w.confirms[2].message).toContain('built-in template comes back');
    expect(visibleRows(stateOf(m), '').map((r) => r.origin)).toEqual(['builtin', 'builtin', 'builtin']);
    expect(stateOf(m).dirty).toBe(true);
  });

  it('keeps the order of your file: up and down move among your own templates only', async () => {
    const m = await open(world({ files: { [NAME]: mine() } }));
    const order = (): string[] => stateOf(m).rows.filter((r) => r.origin !== 'builtin').map((r) => r.def?.id ?? '?');
    expect(order()).toEqual(['my-tool', 'tool-start']);
    m.move(rowFor(m, 'my-tool').key, -1);
    expect(order()).toEqual(['my-tool', 'tool-start']);
    expect(stateOf(m).dirty).toBe(false);
    m.move(rowFor(m, 'my-tool').key, 1);
    expect(order()).toEqual(['tool-start', 'my-tool']);
    expect(stateOf(m).dirty).toBe(true);
    m.move(rowFor(m, 'my-tool').key, 1);
    expect(order()).toEqual(['tool-start', 'my-tool']);
    expect(stateOf(m).rows.slice(0, 3).every((r) => r.origin === 'builtin')).toBe(true);
  });

  it('stars a template of either kind in the database, not in the file', async () => {
    const w = world();
    const m = await open(w);
    m.setFavorite(rowFor(m, 'tool-start').key, true);
    expect(w.favoriteSet).toEqual([['fanuc-lathe', 'tool-start', true]]);
    expect(stateOf(m).favorites).toEqual(['tool-start']);
    expect(stateOf(m).dirty).toBe(false);
    m.setFavorite(rowFor(m, 'tool-start').key, false);
    expect(stateOf(m).favorites).toEqual([]);
  });

  it('searches the name, the id, the group and the description', async () => {
    const m = await open(world({ files: { [NAME]: mine() } }));
    const ids = (q: string): string[] => visibleRows(stateOf(m), q).map((r) => r.def?.id ?? '?');
    expect(ids('PROGRAM')).toEqual(['program-start', 'program-end']);
    expect(ids('mine')).toEqual(['my-tool']);
    expect(ids('tool-start')).toEqual(['tool-start']);
    expect(ids('zzz')).toEqual([]);
  });

  it('asks before the changes are lost, and only then', async () => {
    const w = world();
    const m = await open(w);
    expect(await m.leave()).toBe(true);
    expect(w.confirms).toEqual([]);
    m.add();
    w.answer.confirm = false;
    expect(await m.leave()).toBe(false);
    expect(await m.load('fanuc')).toBe(false);
    expect(stateOf(m).dialect).toBe('fanuc-lathe');
    w.answer.confirm = true;
    expect(await m.load('fanuc')).toBe(true);
    expect(stateOf(m).dialect).toBe('fanuc');
    expect(stateOf(m).dirty).toBe(false);
  });

  it('Revert reads the file again', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.add();
    expect(stateOf(m).dirty).toBe(true);
    expect(await m.revert()).toBe(true);
    expect(stateOf(m).dirty).toBe(false);
    expect(stateOf(m).rows.filter((r) => r.origin !== 'builtin')).toHaveLength(2);
  });
});

describe('the preview', () => {
  it('renders your template with the starting values in the open program’s environment', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, '{{N}}T{{t}} M6');
    m.addParam(key);
    m.setParam(key, 0, 'id', 't');
    m.setParamType(key, 0, 'integer');
    m.setParam(key, 0, 'default', '3');
    // An unnumbered program: `{{N}}` is empty.
    expect(m.preview(key)).toEqual({ kind: 'text', text: 'T3 M6' });
  });

  it('says what is missing rather than showing a wrong text', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, 'T{{t}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 't');
    m.setParam(key, 0, 'label', 'Tool');
    expect(m.preview(key)).toMatchObject({ kind: 'errors', key: 'templateManager.preview.needsDefault', lines: [expect.stringContaining('Tool')] });
    m.setBody(key, 'T{{nope}}');
    expect(m.preview(key)).toMatchObject({ kind: 'errors', key: 'templateManager.preview.problems' });
  });

  it('refuses a starting value the engine refuses, with the parameter’s name', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, 'F{{f}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 'f');
    m.setParam(key, 0, 'label', 'Feed');
    m.setParam(key, 0, 'decimals', 1);
    m.setParam(key, 0, 'default', '1.5');
    expect(m.preview(key)).toEqual({ kind: 'text', text: 'F1.5' });
    m.setParam(key, 0, 'min', 2);
    expect(stateOf(m).rows.find((r) => r.key === key)?.problems[0].message).toContain('below the minimum');
  });

  it('has no preview without an open program, and a built-in one is shown too', async () => {
    const w = world({ env: null });
    const m = await open(w);
    expect(m.preview(rowFor(m, 'tool-start').key)).toEqual({ kind: 'none' });
    w.env = { cp: cpOf('fanuc-lathe'), prevBlockNumber: 20, numbered: true, sys: { date: 'd', time: 't', file: 'f.nc', stem: 'f' } };
    expect(m.preview(rowFor(m, 'tool-start').key)).toMatchObject({ kind: 'text' });
  });
});

describe('Save', () => {
  it('writes a new file through user_file_create and nothing else: the dialect, the version, the templates, two-space indentation', async () => {
    const w = world();
    const m = await open(w);
    m.add();
    m.setField(stateOf(m).selected as string, 'label', 'Mine');
    const result = await m.save();
    expect(result).toEqual({ ok: true });
    expect(w.trace).toEqual(['create', 'reload']);
    expect(w.created).toHaveLength(1);
    expect(w.created[0].name).toBe(NAME);
    const written = JSON.parse(w.created[0].text) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(['dialect', 'version', 'templates']);
    expect(written.dialect).toBe('fanuc-lathe');
    expect(written.version).toBe(1);
    expect(w.created[0].text).toBe(`${JSON.stringify(written, null, 2)}\n`);
    expect(loadTemplates(written.templates).map((d) => d.label)).toEqual(['Mine']);
    expect(w.documents.size).toBe(0);
    // The manager reads the file it made: no longer dirty, the template stays selected.
    const s = stateOf(m);
    expect(s.dirty).toBe(false);
    expect(s.fileExists).toBe(true);
    expect(s.rows.find((r) => r.key === s.selected)?.def?.label).toBe('Mine');
    expect(s.message).toMatchObject({ error: false, msg: { key: 'templateManager.save.done' } });
  });

  it('changes an existing file through its document: one edit, one save with the backup before the write, the reload after', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const before = w.folder.get(NAME) as string;
    const m = await open(w);
    m.setField(rowFor(m, 'my-tool').key, 'label', 'My tool, changed');
    expect(await m.save()).toEqual({ ok: true });

    expect(w.trace).toEqual(['open', 'replace', 'backup', 'write', 'hook-reload', 'reload']);
    expect(w.writes).toEqual([NAME]);
    expect(w.backups).toEqual([before]);
    expect(w.created).toEqual([]);

    const after = JSON.parse(w.folder.get(NAME) as string) as Record<string, unknown>;
    const was = JSON.parse(before) as Record<string, unknown>;
    // Only the `templates` member changed; every other member is the same, in the same place.
    expect(Object.keys(after)).toEqual(Object.keys(was));
    for (const key of Object.keys(was)) if (key !== 'templates') expect(after[key]).toEqual(was[key]);
    const templates = after.templates as Record<string, unknown>[];
    expect(templates[0].label).toBe('My tool, changed');
    // A member the loader ignores (a note written by hand) survives the edit of its template, and the
    // template that was not edited is written exactly as the file had it.
    expect(templates[0].keepMe).toBe('unknown member');
    expect(templates[1]).toEqual((was.templates as unknown[])[1]);
    expect(w.folder.get(NAME)).toBe(`${JSON.stringify(after, null, 2)}\n`);
    // The tab that was active stays the active one; the file's tab stays open.
    expect(w.active.id).toBe('doc-main');
    expect(w.documents.has(PATH)).toBe(true);
    expect(stateOf(m).dirty).toBe(false);
  });

  it('adds the templates member to a file that has none, at the end', async () => {
    const w = world({ files: { [NAME]: '{\n  "dialect": "fanuc-lathe",\n  "version": 1,\n  "codes": []\n}\n' } });
    const m = await open(w);
    m.add();
    expect((await m.save()).ok).toBe(true);
    expect(Object.keys(JSON.parse(w.folder.get(NAME) as string))).toEqual(['dialect', 'version', 'codes', 'templates']);
  });

  it('keeps an entry it could not read exactly as it was, and an edit of another template does not touch it', async () => {
    const odd = { id: 'Bad Id', label: 'Broken', group: 'Mine', body: 'X', strange: [1, { a: null }] };
    const w = world({ files: { [NAME]: mine({ templates: [odd, { id: 'ok-one', label: 'Fine', group: 'G', body: 'M0' }] }) } });
    const m = await open(w);
    m.setField(rowFor(m, 'ok-one').key, 'label', 'Fine too');
    expect(await m.save()).toEqual({ ok: true });
    const templates = (JSON.parse(w.folder.get(NAME) as string) as { templates: unknown[] }).templates;
    expect(templates[0]).toEqual(odd);
    expect(templates[1]).toMatchObject({ id: 'ok-one', label: 'Fine too' });
  });

  it('writes a template the loader read with a note (a mistyped flag) from its reading, so the note goes', async () => {
    const w = world({ files: { [NAME]: mine({ templates: [{ id: 'x', label: 'X', group: 'G', body: 'M0', toolbar: 'yes' }] }) } });
    const m = await open(w);
    const row = rowFor(m, 'x');
    expect(row.notes).toHaveLength(1);
    expect(row.notes[0].message).toContain('true or false');
    expect(stateOf(m).dirty).toBe(true);
    expect((await m.save()).ok).toBe(true);
    expect((JSON.parse(w.folder.get(NAME) as string) as { templates: unknown[] }).templates).toEqual([{ id: 'x', label: 'X', group: 'G', body: 'M0' }]);
  });

  it('is refused while the list has a problem: the problems are listed with their path, nothing is written', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    const key = rowFor(m, 'my-tool').key;
    const other = stateOf(m).rows.find((r) => r.origin === 'override')?.key as string;
    m.setBody(key, 'T{{gone}}');
    m.addParam(other);
    m.setParam(other, 1, 'min', 5);
    m.setParam(other, 1, 'max', 1);
    const result = await m.save();
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    const s = stateOf(m);
    expect(s.problems.map((p) => p.path).sort()).toEqual(['.body', '.params[1].min'].sort());
    expect(s.problems.find((p) => p.path === '.body')?.where).toBe('My tool › Text');
    expect(s.problems.find((p) => p.path === '.params[1].min')?.where).toBe('My tool start › Parameter 2 (Value 2) › Smallest value');
    expect(s.problems.find((p) => p.path === '.body')?.message).toContain('no parameter');
    expect(s.message).toMatchObject({ error: true, msg: { key: 'templateManager.save.invalid', params: { count: 2 } } });
    expect(w.trace).toEqual([]);
    expect(w.folder.get(NAME)).toBe(mine());
    // Fixing them lets the save through.
    m.setBody(key, 'T{{t}}');
    m.removeParam(other, 1);
    expect(stateOf(m).problems).toEqual([]);
    expect((await m.save()).ok).toBe(true);
  });

  it('refuses two templates of yours with one id, and more than the loader reads', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.duplicate(rowFor(m, 'my-tool').key, 'copy');
    const copy = stateOf(m).selected as string;
    m.setField(copy, 'id', 'my-tool');
    expect(stateOf(m).rows.find((r) => r.key === copy)?.problems[0].message).toContain('already has the id');
    expect(await m.save()).toEqual({ ok: false, reason: 'invalid' });
    expect(w.trace).toEqual([]);

    const big = Array.from({ length: TEMPLATE_LIMITS.templates + 1 }, (_, i) => ({ id: `t-${i}`, label: 'T', group: 'G', body: 'M0' }));
    const w2 = world({ files: { [NAME]: mine({ templates: big }) } });
    const m2 = await open(w2);
    m2.add();
    // The 201st entry is not read; its text stays in the file as it is, and the list that is read saves.
    expect(stateOf(m2).rows.filter((r) => r.origin !== 'builtin').length).toBeGreaterThan(TEMPLATE_LIMITS.templates);
    expect((await m2.save()).ok).toBe(false);
    expect(w2.trace).toEqual([]);
  });

  it('refuses a file whose document has unsaved changes: "Save or close … first", nothing written', async () => {
    const w = world({ files: { [NAME]: mine() } });
    w.documents.set(PATH, { id: 'doc-9', text: `${mine()}\n// typed`, dirty: true, locked: false });
    const m = await open(w);
    m.setField(rowFor(m, 'my-tool').key, 'label', 'Changed');
    expect(await m.save()).toEqual({ ok: false, reason: 'dirtyDocument' });
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'templateManager.save.saveFirst', params: { name: NAME } } });
    expect(w.trace).toEqual([]);
    expect(w.documents.get(PATH)?.text.endsWith('// typed')).toBe(true);
    expect(stateOf(m).dirty).toBe(true);
    // Once that document is saved, the same Save goes through, in the document that is already open.
    w.documents.get(PATH)!.dirty = false;
    w.documents.get(PATH)!.text = mine();
    expect((await m.save()).ok).toBe(true);
    expect(w.opened).toEqual([]);
    expect(w.trace).toEqual(['replace', 'backup', 'write', 'hook-reload', 'reload']);
  });

  it('refuses a file that changed since the manager read it', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.setField(rowFor(m, 'my-tool').key, 'label', 'Changed');
    // Someone else (another editor, a script) changed the file on disk in the meantime.
    w.folder.set(NAME, mine({ templates: [{ id: 'other', label: 'Other', group: 'G', body: 'M0' }] }));
    expect(await m.save()).toEqual({ ok: false, reason: 'changed' });
    expect(w.writes).toEqual([]);
    expect(w.active.id).toBe('doc-main');
    // Revert reads it again.
    expect(await m.revert()).toBe(true);
    expect(stateOf(m).rows.some((r) => r.def?.id === 'other')).toBe(true);
  });

  it('refuses a document that is not one JSON object, and a locked one that takes no edit', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.add();
    w.documents.set(PATH, { id: 'doc-5', text: '{ broken', dirty: false, locked: false });
    expect(await m.save()).toMatchObject({ ok: false, reason: 'fileError' });
    w.documents.set(PATH, { id: 'doc-5', text: mine(), dirty: false, locked: true });
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(m).message).toMatchObject({ msg: { key: 'templateManager.save.locked' } });
    expect(w.writes).toEqual([]);
  });

  it('says so when the save itself did not happen (cancelled or failed), the file’s tab put back as it was (CODE-03)', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.add();
    w.answer.save = false;
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'templateManager.save.notSaved' } });
    expect(stateOf(m).dirty).toBe(true);
    expect(stateOf(m).busy).toBe(false);
    expect(w.documents.get(PATH)?.dirty).toBe(false);
    expect(w.documents.get(PATH)?.text).toBe(mine());
    expect(w.active.id).toBe('doc-main');
  });

  it('turns a failure of the file functions into a message, not an exception', async () => {
    const w = world();
    w.deps.userFiles.create = async () => {
      throw new Error('disk full');
    };
    const m = await open(w);
    m.add();
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'templateManager.save.failed', params: { detail: 'disk full' } } });
    expect(stateOf(m).busy).toBe(false);
  });

  it('has nothing to save when nothing changed', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    expect(await m.save()).toEqual({ ok: false, reason: 'nothing' });
    m.add();
    await m.remove(stateOf(m).selected as string);
    expect(stateOf(m).dirty).toBe(false);
  });

  it('opens the file in a tab on request, and says when there is none yet', async () => {
    const w = world();
    const m = await open(w);
    expect(await m.openFile()).toBe(false);
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'templateManager.file.notThere' } });
    const w2 = world({ files: { [NAME]: mine() } });
    const m2 = await open(w2);
    expect(await m2.openFile()).toBe(true);
    expect(w2.opened).toEqual([PATH]);
    expect(w2.active.id).toBe('doc-2');
  });
});

describe('pure helpers', () => {
  it('slugId and uniqueId make ids the loader accepts', () => {
    expect(slugId('Peck drill, 8 holes!')).toBe('peck-drill-8-holes');
    expect(slugId('  --  ')).toBe('');
    expect(slugId('x'.repeat(90))).toHaveLength(64);
    expect(uniqueId('a', new Set(['a', 'a-2']))).toBe('a-3');
    expect(uniqueId('', new Set())).toBe('template');
    expect(uniqueId('x'.repeat(64), new Set(['x'.repeat(64)]))).toHaveLength(64);
  });

  it('insertAt puts text over the selection and answers the caret', () => {
    expect(insertAt('G0 X', 4, 4, '{{x}}')).toEqual({ body: 'G0 X{{x}}', caret: 9 });
    expect(insertAt('G0 Xabc', 4, 7, '{{x}}')).toEqual({ body: 'G0 X{{x}}', caret: 9 });
    expect(insertAt('ab', 99, 99, 'Z')).toEqual({ body: 'abZ', caret: 3 });
  });

  it('fileTextWith keeps the members and their order, and ends with a line break', () => {
    expect(fileTextWith({ b: 1, templates: [], a: 2 }, 'x', [{ id: 'n' }])).toBe('{\n  "b": 1,\n  "templates": [\n    {\n      "id": "n"\n    }\n  ],\n  "a": 2\n}\n');
    expect(JSON.parse(fileTextWith(null, 'd', []))).toEqual({ dialect: 'd', version: 1, templates: [] });
  });

  it('has a message for every name the dialog and the problems use', () => {
    const fields = ['id', 'label', 'group', 'description', 'body', 'machineType', 'toolbar', 'snippet', 'review', 'params', 'paramId', 'type', 'help', 'required', 'min', 'max', 'default', 'choices', 'prefix', 'suffix', 'decimals', 'digits', 'plusSign', 'uppercase', 'comment', 'remember', 'formula', 'hidden'];
    const missing = [
      ...fields.map((f) => `templateManager.field.${f}`),
      ...PARAM_TYPES.map((p) => `templateManager.type.${p}`),
      ...['required', 'plusSign', 'uppercase', 'comment', 'remember', 'hidden', 'toolbar', 'snippet'].map((f) => `templateManager.flag.${f}`),
      ...['any', 'mill', 'lathe'].map((f) => `templateManager.machine.${f}`),
    ].filter((key) => !hasKey(key));
    expect(missing).toEqual([]);
  });
});

describe('New Template from Selection, end to end', () => {
  const db = loadCodeDb(resolveCodeDbFiles(BUILTIN_CODE_DB_JSON)['fanuc']);
  const lines = ['N10 G98 G83 X20. Y60. Z-5. R3. Q4. F240.', 'N20 X40. Y60.', 'N30 G80'];

  it('offers the numbers, builds the template from the ticked ones and saves it into your file', async () => {
    const w = world({ base: [], env: { cp: cpOf('fanuc-gcode'), prevBlockNumber: 100, numbered: true, sys: { date: '2026-10-09', time: '12:00', file: 'a.nc', stem: 'a' } } });
    const m = await open(w, 'fanuc', { machineType: 'mill' });
    const draft = templateFromSelection(lines, cpOf('fanuc-gcode'), db);
    m.startDraft(draft, {});
    expect(stateOf(m).draft?.chosen).toEqual([]);
    expect(m.draftBody().split('\n')[0]).toBe('{{N}}G98 G83 X20. Y60. Z-5. R3. Q4. F240.');

    // Tick Z only: it becomes {{z}}; the rest stays text.
    const z = draft.candidates.find((c) => c.address === 'Z');
    expect(z?.written).toBe('-5.');
    m.toggleCandidate(z?.key as string);
    expect(m.draftBody().split('\n')[0]).toBe('{{N}}G98 G83 X20. Y60. {{z}} R3. Q4. F240.');
    expect(stateOf(m).draft?.chosen).toEqual([z?.key]);

    // No name yet: refused, nothing added.
    expect(m.applyDraft()).toBe(false);
    expect(stateOf(m).draft?.error).toMatchObject({ key: 'templateManager.draft.needsName' });
    m.setDraft('label', 'Peck drill 3 holes');
    expect(stateOf(m).draft?.id).toBe('peck-drill-3-holes');
    m.setDraft('group', 'Drilling');
    expect(m.applyDraft()).toBe(true);

    const s = stateOf(m);
    expect(s.draft).toBeNull();
    const row = s.rows.find((r) => r.key === s.selected);
    expect(row?.origin).toBe('user');
    expect(row?.def).toMatchObject({ id: 'peck-drill-3-holes', label: 'Peck drill 3 holes', group: 'Drilling', machineType: 'mill' });
    expect(row?.def?.params).toEqual([{ id: 'z', label: expect.any(String), type: 'number', required: true, prefix: 'Z', decimals: 'min1', default: '-5.' }]);
    expect(row?.problems).toEqual([]);

    expect(await m.save()).toEqual({ ok: true });
    expect(w.created).toHaveLength(1);
    const file = JSON.parse(w.created[0].text) as { dialect: string; templates: unknown[] };
    expect(file.dialect).toBe('fanuc');
    const [saved] = loadTemplates(file.templates);
    expect(saved.body.split('\n')).toEqual(['{{N}}G98 G83 X20. Y60. {{z}} R3. Q4. F240.', '{{N}}X40. Y60.', '{{N}}G80']);

    // What the Insert tab would write for the saved template: numbers continue from the program, Z as typed.
    const env: TemplateEnv = { cp: cpOf('fanuc-gcode'), prevBlockNumber: 100, numbered: true, sys: { date: '', time: '', file: '', stem: '' } };
    const out = renderTemplate(saved, { z: '-7.5' }, env);
    expect(out).toEqual({ ok: true, blocks: 3, text: 'N110 G98 G83 X20. Y60. Z-7.5 R3. Q4. F240.\nN120 X40. Y60.\nN130 G80' });
    // And the manager previews it with the starting value.
    expect(m.preview(stateOf(m).selected as string)).toEqual({ kind: 'text', text: 'N110 G98 G83 X20. Y60. Z-5. R3. Q4. F240.\nN120 X40. Y60.\nN130 G80' });
  });

  it('ties a repeated value to one parameter and ticks them together', async () => {
    const w = world({ base: [] });
    const m = await open(w, 'fanuc');
    const draft = templateFromSelection(['G0 Z25.', 'G1 Z-5. F100.', 'G0 Z25.'], cpOf('fanuc-gcode'), db);
    m.startDraft(draft, {});
    const first = draft.candidates.find((c) => c.written === '25.');
    m.toggleCandidate(first?.key as string);
    expect(stateOf(m).draft?.chosen).toHaveLength(2);
    expect(m.draftBody()).toBe('G0 {{z}}\nG1 Z-5. F100.\nG0 {{z}}');
    m.toggleCandidate(first?.key as string);
    expect(stateOf(m).draft?.chosen).toEqual([]);
    m.setAllCandidates(true);
    expect(stateOf(m).draft?.chosen).toHaveLength(draft.candidates.length);
    m.setDraft('label', 'Z moves');
    expect(m.applyDraft()).toBe(true);
    const def = stateOf(m).rows.find((r) => r.key === stateOf(m).selected)?.def;
    expect(def?.params?.map((p) => p.id)).toEqual(expect.arrayContaining(['z', 'z_2']));
    expect(def?.params).toHaveLength(new Set(draft.candidates.map((c) => c.param.id)).size);
  });

  it('refuses an id that a built-in template has, a bad id and a missing group, and keeps the draft', async () => {
    const w = world();
    const m = await open(w);
    const draft = templateFromSelection(['G0 X10.'], cpOf('fanuc-gcode'), db);
    m.startDraft(draft, {});
    m.setDraft('label', 'Tool start');
    expect(m.applyDraft()).toBe(false);
    expect(stateOf(m).draft?.error).toMatchObject({ key: 'templateManager.draft.idTaken', params: { id: 'tool-start' } });
    m.setDraft('id', 'Bad Id');
    expect(m.applyDraft()).toBe(false);
    expect(stateOf(m).draft?.error).toMatchObject({ key: 'templateManager.draft.badId' });
    m.setDraft('id', 'ok-id');
    m.setDraft('group', '  ');
    expect(m.applyDraft()).toBe(false);
    expect(stateOf(m).draft?.error).toMatchObject({ key: 'templateManager.draft.needsGroup' });
    expect(stateOf(m).dirty).toBe(false);
    m.cancelDraft();
    expect(stateOf(m).draft).toBeNull();
    expect(stateOf(m).rows).toHaveLength(BASE.length);
  });

  it('adds the draft to the templates already in your file and writes them all', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    const draft = templateFromSelection(['G0 X10.'], cpOf('fanuc-lathe'), db);
    m.startDraft(draft, { label: 'Move to X', group: 'Moves' });
    m.toggleCandidate(draft.candidates[0].key);
    m.setDraft('label', 'Move to X');
    expect(m.applyDraft()).toBe(true);
    expect((await m.save()).ok).toBe(true);
    const templates = (JSON.parse(w.folder.get(NAME) as string) as { templates: { id: string }[] }).templates;
    expect(templates.map((x) => x.id)).toEqual(['my-tool', 'tool-start', 'move-to-x']);
    expect(w.trace).toEqual(['open', 'replace', 'backup', 'write', 'hook-reload', 'reload']);
  });
});

describe('P3b fix code: the save path', () => {
  it('CODE-02: a locked tab is refused before anything is written, with the lock’s own message', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.add();
    // The file’s tab is open, clean and locked (the user locked it, or it is read-only on disk).
    w.documents.set(PATH, { id: 'doc-5', text: mine(), dirty: false, locked: true, refuses: true });
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(m).message).toMatchObject({
      error: true,
      msg: { key: 'readOnly.refusedUser', params: { name: 'fanuc-lathe.json', action: 'saving the templates' } },
    });
    expect(w.trace).toEqual([]);
    expect(w.documents.get(PATH)).toMatchObject({ text: mine(), dirty: false });
    expect(stateOf(m).busy).toBe(false);
    expect(stateOf(m).dirty).toBe(true);
  });

  it('CODE-03: a write that throws leaves the tab as it was, and the next Save works', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.add();
    const real = w.deps.docs.save;
    let fault = true;
    w.deps.docs.save = async (id) => {
      if (fault) throw new Error('disk full');
      return real(id);
    };
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'templateManager.save.failed' } });
    expect(w.documents.get(PATH)).toMatchObject({ text: mine(), dirty: false });
    expect(w.active.id).toBe('doc-main');
    fault = false;
    expect((await m.save()).ok).toBe(true);
    expect(w.writes).toEqual([NAME]);
    expect(JSON.parse(w.folder.get(NAME) as string).templates).toHaveLength(3);
  });

  it('CODE-03: a refused save (cancelled question) can be repeated at once', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.add();
    w.answer.save = false;
    expect((await m.save()).ok).toBe(false);
    w.answer.save = true;
    expect(await m.save()).toEqual({ ok: true });
  });

  it('CODE-13: a list that would be larger than the program reads is refused with nothing written', async () => {
    const big = Array.from({ length: 140 }, (_, i) => ({ id: `t-${i}`, label: 'T', group: 'G', body: `M0 (${'x'.repeat(7900)})` }));
    const w = world({ files: { [NAME]: mine({ templates: big }) } });
    const m = await open(w);
    m.setField(stateOf(m).rows.filter((r) => r.origin !== 'builtin')[0].key, 'label', 'Changed');
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'templateManager.save.tooBig', params: { name: NAME, max: 1 } } });
    expect(w.trace).toEqual(['open']);
    expect(w.documents.get(PATH)?.text).toBe(mine({ templates: big }));
    // The same for a file that does not exist yet.
    const w2 = world();
    const m2 = await open(w2);
    for (let i = 0; i < 140; i++) {
      m2.add();
      m2.setBody(stateOf(m2).selected as string, `M0 (${'x'.repeat(7900)})`);
    }
    expect((await m2.save()).ok).toBe(false);
    expect(w2.created).toEqual([]);
  });

  it('CODE-10: a reading that throws does not leave the dialog busy', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = createTemplateManager(w.deps);
    w.deps.baseTemplates = () => {
      throw new Error('boom');
    };
    await expect(m.load('fanuc-lathe')).rejects.toThrow('boom');
    expect(stateOf(m).busy).toBe(false);
  });

  it('CODE-10: when the list cannot be read again after the write, Save ends with a message and is not stuck', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    m.setField(rowFor(m, 'my-tool').key, 'label', 'Changed');
    w.deps.baseTemplates = () => {
      throw new Error('boom');
    };
    expect(await m.save()).toEqual({ ok: true });
    expect(w.writes).toEqual([NAME]);
    expect(stateOf(m).busy).toBe(false);
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'templateManager.save.rereadFailed' } });
  });

  it('CODE-10: an edit typed while the Save is in flight is not taken (the reading that follows would overwrite it)', async () => {
    const w = world({ files: { [NAME]: mine() } });
    const m = await open(w);
    const key = rowFor(m, 'my-tool').key;
    m.setField(key, 'label', 'First');
    const real = w.deps.docs.save;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    w.deps.docs.save = async (id) => {
      await gate;
      return real(id);
    };
    const saving = m.save();
    await new Promise((r) => setTimeout(r, 0));
    expect(stateOf(m).busy).toBe(true);
    m.setField(key, 'label', 'Typed during save');
    m.add();
    // Nothing of it reached the list while the Save ran.
    expect(rowFor(m, 'my-tool').def?.label).toBe('First');
    expect(stateOf(m).rows.filter((r) => r.origin !== 'builtin')).toHaveLength(2);
    release();
    expect(await saving).toEqual({ ok: true });
    expect(rowFor(m, 'my-tool').def?.label).toBe('First');
    expect(stateOf(m).rows.filter((r) => r.origin !== 'builtin')).toHaveLength(2);
    expect(stateOf(m).dirty).toBe(false);
  });

  it('CODE-09: members of a parameter and of a choice that the loader ignores survive an edit and a save; a top-level __proto__ member is kept', async () => {
    const entry = {
      id: 'sel',
      label: 'Sel',
      group: 'G',
      body: 'G{{c}} X{{x}}',
      params: [
        { id: 'c', label: 'Mode', type: 'choice', required: true, choices: [{ label: 'One', value: '1', hint: 'first' }, { label: 'Two', value: '2' }], $comment: 'my note' },
        { id: 'x', label: 'X', type: 'number', unit: 'mm' },
      ],
    };
    const text = `{\n  "dialect": "fanuc-lathe",\n  "version": 1,\n  "__proto__": { "marker": 1 },\n  "x-note": 5,\n  "templates": ${JSON.stringify([entry])}\n}\n`;
    const w = world({ files: { [NAME]: text } });
    const m = await open(w);
    m.setField(rowFor(m, 'sel').key, 'label', 'Sel, changed');
    expect((await m.save()).ok).toBe(true);
    const written = JSON.parse(w.folder.get(NAME) as string) as { templates: { label: string; params: Record<string, unknown>[] }[] };
    expect(written.templates[0].label).toBe('Sel, changed');
    expect(written.templates[0].params[0].$comment).toBe('my note');
    expect((written.templates[0].params[0].choices as Record<string, unknown>[])[0].hint).toBe('first');
    expect(written.templates[0].params[1].unit).toBe('mm');
    expect(Object.hasOwn(written, '__proto__')).toBe(true);
    expect(w.folder.get(NAME)).toContain('"__proto__"');
  });
});

describe('P3b fix code: the model', () => {
  it('CODE-04: retyping an id through an empty text renames from the last valid id, once', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, 'G1 X{{s}} Z{{z}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 's');
    m.addParam(key);
    m.setParam(key, 1, 'id', 'z');
    m.addParam(key);
    m.setParam(key, 2, 'id', 'f');
    m.setParamType(key, 2, 'formula');
    m.setParam(key, 2, 'formula', 's * z + s');
    const def = () => stateOf(m).rows.find((r) => r.key === key)?.def;

    m.setParam(key, 0, 'id', '');
    // Nothing to rename from: the text and the formula are untouched.
    expect(def()?.params?.[2].formula).toBe('s * z + s');
    expect(def()?.body).toBe('G1 X{{s}} Z{{z}}');
    m.setParam(key, 0, 'id', 't');
    expect(def()?.params?.[2].formula).toBe('t * z + t');
    expect(def()?.body).toBe('G1 X{{t}} Z{{z}}');
    expect(def()?.params?.[0].id).toBe('t');
  });

  it('CODE-04: backspacing and typing through invalid ids ends with the text, the formula and the id agreeing', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, 'G1 X{{sp}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 'sp');
    m.addParam(key);
    m.setParam(key, 1, 'id', 'f');
    m.setParamType(key, 1, 'formula');
    m.setParam(key, 1, 'formula', 'sp * 2');
    for (const typed of ['spE', 'spe', 'spee']) m.setParam(key, 0, 'id', typed);
    const def = stateOf(m).rows.find((r) => r.key === key)?.def;
    expect(def?.params?.[0].id).toBe('spee');
    expect(def?.body).toBe('G1 X{{spee}}');
    expect(def?.params?.[1].formula).toBe('spee * 2');
    expect(stateOf(m).rows.find((r) => r.key === key)?.problems).toEqual([]);
  });

  it('CODE-04: moving and removing parameters keeps the last valid ids with their parameters', async () => {
    const m = await open(world());
    m.add();
    const key = stateOf(m).selected as string;
    m.setBody(key, 'X{{a}} Y{{b}}');
    m.addParam(key);
    m.setParam(key, 0, 'id', 'a');
    m.addParam(key);
    m.setParam(key, 1, 'id', 'b');
    m.moveParam(key, 0, 1);
    // `a` is now the second parameter; renaming it must rename `{{a}}`.
    m.setParam(key, 1, 'id', 'aa');
    expect(stateOf(m).rows.find((r) => r.key === key)?.def?.body).toBe('X{{aa}} Y{{b}}');
    m.removeParam(key, 0);
    m.setParam(key, 0, 'id', 'cc');
    expect(stateOf(m).rows.find((r) => r.key === key)?.def?.body).toBe('X{{cc}} Y{{b}}');
  });

  it('CODE-11: two requests to leave while the question is open ask once and get one answer', async () => {
    const w = world();
    const m = await open(w);
    m.add();
    let answer: (v: boolean) => void = () => {};
    w.deps.confirm = (c) => {
      w.confirms.push({ title: c.title, message: c.message });
      return new Promise<boolean>((resolve) => (answer = resolve));
    };
    const first = m.leave();
    const second = m.leave();
    expect(w.confirms).toHaveLength(1);
    answer(false);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    // Once answered, a later request asks again.
    const third = m.leave();
    expect(w.confirms).toHaveLength(2);
    answer(true);
    expect(await third).toBe(true);
  });

  it('CODE-11: an open draft with a ticked number or a typed name counts as unsaved; an untouched one does not', async () => {
    const db = loadCodeDb(resolveCodeDbFiles(BUILTIN_CODE_DB_JSON)['fanuc']);
    const w = world({ base: [] });
    const m = await open(w, 'fanuc', { machineType: 'mill' });
    const draft = templateFromSelection(['N10 G98 G83 X20. Y60. Z-5. R3. Q4. F240.'], cpOf('fanuc-gcode'), db);
    m.startDraft(draft, {});
    expect(await m.leave()).toBe(true);
    expect(w.confirms).toEqual([]);
    m.toggleCandidate(draft.candidates[0].key);
    w.answer.confirm = false;
    expect(await m.leave()).toBe(false);
    expect(w.confirms).toHaveLength(1);
    expect(w.confirms[0].message).toContain('not added');
    m.setAllCandidates(false);
    m.setDraft('label', 'Mine');
    expect(await m.leave()).toBe(false);
    expect(await m.load('fanuc-lathe')).toBe(false);
    expect(stateOf(m).dialect).toBe('fanuc');
  });
});

describe('P3b fix H: the built-in rows are what the code set offers a program', () => {
  const MIXED: TemplateDef[] = [
    { id: 'drill', label: 'Drill', group: 'Holes', body: 'G81', machineType: 'mill' },
    { id: 'thread', label: 'Thread', group: 'Turning', body: 'G76', machineType: 'lathe' },
    { id: 'end', label: 'End', group: 'Program', body: 'M30' },
  ];
  const ids = async (types: ((d: string) => (string | undefined)[]) | undefined, dialect = 'fanuc-lathe'): Promise<string[]> => {
    const w = world({ base: MIXED });
    if (types !== undefined) w.deps.machineTypes = types;
    const m = createTemplateManager(w.deps);
    await m.load(dialect);
    return stateOf(m)
      .rows.filter((r) => r.origin === 'builtin')
      .map((r) => (r.def as TemplateDef).id);
  };

  it('leaves out the templates of another machine type (the set of a lathe inherits the mill\'s)', async () => {
    expect(await ids(() => ['lathe'])).toEqual(['thread', 'end']);
    expect(await ids(() => ['mill'])).toEqual(['drill', 'end']);
  });

  it('lists both when profiles of both types use the set, and everything when none does or nothing is known', async () => {
    expect(await ids(() => ['lathe', 'mill'])).toEqual(['drill', 'thread', 'end']);
    expect(await ids(() => [])).toEqual(['drill', 'thread', 'end']);
    expect(await ids(undefined)).toEqual(['drill', 'thread', 'end']);
    // A profile without a machine type sees the unmarked templates only.
    expect(await ids(() => [undefined])).toEqual(['end']);
  });

  it('asks for the set that was opened, and a template of yours with a hidden built-in id is yours, not an override', async () => {
    const asked: string[] = [];
    const w = world({ base: MIXED, files: { [NAME]: JSON.stringify({ dialect: 'fanuc-lathe', version: 1, templates: [{ id: 'drill', label: 'My drill', group: 'Holes', body: 'G83' }] }) } });
    w.deps.machineTypes = (d) => {
      asked.push(d);
      return ['lathe'];
    };
    const m = createTemplateManager(w.deps);
    await m.load('fanuc-lathe');
    expect(asked).toContain('fanuc-lathe');
    expect(stateOf(m).rows.map((r) => `${r.origin}:${(r.def as TemplateDef).id}`)).toEqual(['builtin:thread', 'builtin:end', 'user:drill']);
  });
});
