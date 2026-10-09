// Settings ▸ Profiles (plan §6 M13 WP13.3, AD-29, §7.12). Owner: WP13.3.
//
// The page runs the commands of `contrib/userConfig.ts`; here the command layer is a fake, so
// what matters is which command each button runs, with which arguments, and what the list
// says about each file. The markup is rendered with `svelte/server` (no DOM), which is where
// the `profile-row` and `profile-action` test ids of §7.12 are checked.

import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileInfo, UserFileEntry } from '$lib/app/types';
import type { ProfileProblem } from '$lib/core/profiles/types';

const fake = vi.hoisted(() => ({
  shown: [] as { text: string; error: boolean; detail?: string }[],
  confirm: undefined as unknown as ReturnType<typeof import('vitest').vi.fn>,
  ran: [] as { id: string; arg: unknown }[],
}));

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean; detail?: string }) =>
      fake.shown.push({ text, error: o?.error === true, ...(o?.detail === undefined ? {} : { detail: o.detail }) }),
  },
}));
vi.mock('$lib/app/dialogs', () => ({ dialogs: { confirm: async () => true, exclusive: async (op: () => Promise<unknown>) => op() } }));
vi.mock('$lib/app/fileOps', () => ({ files: { open: async () => [], onDidSave: () => () => {} } }));
vi.mock('$lib/app/modals', () => ({ modals: { quickPick: async () => undefined, prompt: async () => undefined } }));
vi.mock('$lib/stores/machines', () => ({ machines: {} }));
vi.mock('$lib/app/userConfig', async () => {
  const { writable } = await import('svelte/store');
  return { userConfig: { files: writable([]), problems: writable([]), load: async () => [], kindOf: () => null } };
});
vi.mock('$lib/stores/profiles', async (importOriginal) => {
  const { writable } = await import('svelte/store');
  const actual = (await importOriginal<typeof import('$lib/stores/profiles')>()).profiles;
  const extra: ProfileInfo[] = [];
  return {
    profiles: new Proxy(actual, {
      get(target, key) {
        if (key === 'revision') return writable(0);
        if (key === 'list') return () => [...target.list(), ...extra];
        if (key === 'get') return (id: string) => [...target.list(), ...extra].find((info) => info.id === id);
        if (key === '__extra') return extra;
        return Reflect.get(target, key) as unknown;
      },
    }),
  };
});

const ProfilesPage = (await import('./ProfilesPage.svelte')).default;
const {
  FIELD_NAME,
  FIELD_PARENT,
  MAX_ROW_LINES,
  createFile,
  looseProblems,
  newDraft,
  newErrors,
  newFields,
  removeRow,
  rowCommand,
  rowsOf,
} = await import('./ProfilesPage.svelte');
const { userConfig } = await import('$lib/app/userConfig');
const { profiles } = await import('$lib/stores/profiles');
const { t } = await import('$lib/i18n');

const filesStore = (userConfig as unknown as { files: ReturnType<typeof writable<UserFileEntry[]>> }).files;
const problemStore = (userConfig as unknown as { problems: ReturnType<typeof writable<ProfileProblem[]>> }).problems;
const extra = (profiles as unknown as { __extra: ProfileInfo[] }).__extra;

const SHOP: ProfileInfo = {
  id: 'shop-lathe',
  name: 'Shop lathe',
  shortName: 'SHOP',
  extensions: ['nc'],
  defaultFileName: 'program.nc',
  newFileEol: 'lf',
  machineType: 'lathe',
  origin: 'user',
  parent: 'fanuc-lathe',
  file: 'shop-lathe.json',
  chain: ['shop-lathe', 'fanuc-lathe', 'fanuc-gcode'],
  hasMachineParams: true,
};

const page = (): string => render(ProfilesPage).body;

/** The `data-action`s (and kinds) the page offers, with `!` on the ones it disabled. */
function actions(html: string): string[] {
  return [...html.matchAll(/data-action="([a-z-]+)"(?: data-kind="([a-z]+)")? data-disabled="([01])"/g)].map(
    ([, action, kind, disabled]) => `${action}${kind ? `:${kind}` : ''}${disabled === '1' ? '!' : ''}`,
  );
}

function deps(over: Partial<Parameters<typeof removeRow>[1]> = {}): Parameters<typeof removeRow>[1] {
  return {
    run: async (id, arg) => {
      fake.ran.push({ id, arg });
      return true;
    },
    deleteFile: vi.fn(async () => {}),
    userConfig: { load: vi.fn(async () => []) },
    dialogs: { confirm: vi.fn(async () => true) },
    status: { show: (text, o) => fake.shown.push({ text, error: o?.error === true }) },
    t,
    ...over,
  };
}

beforeEach(() => {
  fake.shown.length = 0;
  fake.ran.length = 0;
  extra.length = 0;
  filesStore.set([]);
  problemStore.set([]);
});

describe('the list', () => {
  it('says what a profile is, and offers the two ways to make one, when you have none', () => {
    const html = page();
    expect(html).toContain('data-testid="settings-profiles"');
    expect(html).toContain(t('userConfig.page.noProfiles'));
    expect(html).toContain(t('userConfig.page.noCodes'));
    expect(actions(html).filter((a) => !a.startsWith('test') && !a.startsWith('new:profiles!'))).toEqual(
      expect.arrayContaining(['reload', 'new:profiles', 'import:profiles', 'new:codes', 'import:codes']),
    );
  });

  it('lists the built-in profiles with their origin and what they extend, and no file', () => {
    const html = page();
    expect(html).toContain('data-profile-id="fanuc-lathe"');
    expect(html).toContain('data-origin="builtin"');
    expect(html).toContain('data-kind="profile"');
    expect(html).toContain('data-file=""');
    expect(html).toContain(t('userConfig.origin.builtin'));
    expect(html).toContain(t('userConfig.page.extends', { parent: 'fanuc-gcode' }));
  });

  it('lists your profile with its origin, parent and file', () => {
    extra.push(SHOP);
    filesStore.set([{ kind: 'profiles', name: 'shop-lathe.json', error: null }]);
    const html = page();
    expect(html).toContain('data-profile-id="shop-lathe"');
    expect(html).toContain('data-origin="user"');
    expect(html).toContain('data-file="shop-lathe.json"');
    expect(html).toContain('data-problems="0"');
    expect(html).toContain('Shop lathe');
    expect(html).toContain(t('userConfig.page.extends', { parent: 'fanuc-lathe' }));
    expect(html).toContain(t('userConfig.origin.user'));
  });

  it('lists a file that did not load as a row of its own, with its problems and JSON path', () => {
    filesStore.set([{ kind: 'profiles', name: 'broken.json', error: null }]);
    problemStore.set([
      { origin: 'user', file: 'broken.json', profileId: 'broken', path: 'syntax.comments[0].start', message: 'has to be a non-empty string', kind: 'profiles' },
    ]);
    const html = page();
    expect(html).toContain('data-file="broken.json"');
    expect(html).toContain('data-problems="1"');
    expect(html).toContain('syntax.comments[0].start: has to be a non-empty string');
    // It cannot be tested (it is not a profile), but it can be opened, exported and removed.
    const row = html.slice(html.indexOf('data-file="broken.json"'));
    expect(row.slice(0, row.indexOf('</li>'))).toContain('data-action="test" data-disabled="1"');
  });

  it('lists a file the folder could not read with the reason', () => {
    filesStore.set([{ kind: 'codes', name: 'huge.json', error: 'larger than 1 MiB' }]);
    const html = page();
    expect(html).toContain('data-kind="codes"');
    expect(html).toContain('data-file="huge.json"');
    expect(html).toContain('larger than 1 MiB');
  });

  it('shows a problem of a code file on its row, by the dialect it names', () => {
    filesStore.set([{ kind: 'codes', name: 'my-codes.json', error: null }]);
    problemStore.set([{ origin: 'user', file: null, profileId: 'my-codes', path: 'extends', message: 'the parent was not found', kind: 'codes' }]);
    const html = page();
    expect(html).toContain('data-problems="1"');
    expect(html).toContain('extends: the parent was not found');
  });

  it('shows a problem that names no file of the list above the list', () => {
    problemStore.set([{ origin: 'user', file: null, profileId: null, path: '', message: 'the folder could not be read' }]);
    const html = page();
    expect(html).toContain('data-testid="profiles-notice"');
    expect(html).toContain('the folder could not be read');
  });

  it('offers Open, Export and Remove on your own rows only', () => {
    extra.push(SHOP);
    filesStore.set([{ kind: 'profiles', name: 'shop-lathe.json', error: null }]);
    const html = page();
    const start = html.indexOf('data-file="shop-lathe.json"');
    const row = html.slice(start, html.indexOf('</li>', start));
    expect(actions(row)).toEqual(['test', 'open', 'export', 'remove']);
    const builtin = html.slice(html.indexOf('data-profile-id="fanuc-gcode"'));
    expect(actions(builtin.slice(0, builtin.indexOf('</li>')))).toEqual(['test', 'new:profiles']);
  });
});

describe('rowsOf', () => {
  it('lists your profile files, then your code files, then the built-ins', () => {
    const rows = rowsOf(
      [SHOP, ...profiles.list().slice(0, 2)],
      [
        { kind: 'codes', name: 'c.json', error: null },
        { kind: 'profiles', name: 'shop-lathe.json', error: null },
      ],
      [],
      t,
    );
    expect(rows.map((row) => [row.kind, row.origin])).toEqual([
      ['profile', 'user'],
      ['codes', 'user'],
      ['profile', 'builtin'],
      ['profile', 'builtin'],
    ]);
    expect(rows[0]).toMatchObject({ id: 'shop-lathe', parent: 'fanuc-lathe', loaded: true });
  });

  it('keeps a file whose profile did not load, named by its file', () => {
    const rows = rowsOf([], [{ kind: 'profiles', name: 'x.json', error: null }], [], t);
    expect(rows).toEqual([expect.objectContaining({ id: 'x', name: 'x.json', loaded: false })]);
  });

  it('marks a code file that could not be read as not loaded', () => {
    const rows = rowsOf([], [{ kind: 'codes', name: 'x.json', error: 'a link' }], [], t);
    expect(rows[0]).toMatchObject({ loaded: false, problems: ['a link'] });
  });

  it('does not let a problem of the profile file x.json land on the code file x.json', () => {
    const rows = rowsOf(
      [],
      [
        { kind: 'profiles', name: 'x.json', error: null },
        { kind: 'codes', name: 'x.json', error: null },
      ],
      [{ origin: 'user', file: 'x.json', profileId: 'not-x', path: 'id', message: 'bad', kind: 'profiles' }],
      t,
    );
    expect(rows.map((row) => row.problems.length)).toEqual([1, 0]);
  });

  it('keeps the problems of a profile file and a code file of one name apart, whatever else they share', () => {
    // Same file name and the same dialect/id in both: only the folder kind tells them apart.
    const rows = rowsOf(
      [],
      [
        { kind: 'profiles', name: 'x.json', error: null },
        { kind: 'codes', name: 'x.json', error: null },
      ],
      [
        { origin: 'user', file: 'x.json', profileId: 'x', path: 'id', message: 'profile problem', kind: 'profiles' },
        { origin: 'user', file: 'x.json', profileId: 'x', path: 'codes[0]', message: 'code problem', kind: 'codes' },
      ],
      t,
    );
    expect(rows[0].problems).toEqual(['id: profile problem']);
    expect(rows[1].problems).toEqual(['codes[0]: code problem']);
    expect(looseProblems([{ kind: 'profiles', name: 'x.json', error: null }, { kind: 'codes', name: 'x.json', error: null }], [
      { origin: 'user', file: 'x.json', profileId: 'x', path: 'id', message: 'm', kind: 'profiles' },
      { origin: 'user', file: 'x.json', profileId: 'x', path: 'id', message: 'm', kind: 'codes' },
    ], t)).toEqual([]);
  });

  it('shows a problem of a code file whose only profile-kind namesake is not listed on the code row', () => {
    const rows = rowsOf([], [{ kind: 'codes', name: 'x.json', error: null }], [{ origin: 'user', file: 'x.json', profileId: 'x', path: 'id', message: 'm', kind: 'profiles' }], t);
    expect(rows[0].problems).toEqual([]);
  });

  it('leaves out a built-in problem', () => {
    const rows = rowsOf([], [{ kind: 'profiles', name: 'x.json', error: null }], [{ origin: 'builtin', file: 'x.json', profileId: 'x', path: '', message: 'm' }], t);
    expect(rows[0].problems).toEqual([]);
  });
});

describe('looseProblems', () => {
  it('keeps the problems that name no listed file', () => {
    const files: UserFileEntry[] = [{ kind: 'codes', name: 'a.json', error: null }, { kind: 'profiles', name: 'p.json', error: null }];
    const problems: ProfileProblem[] = [
      { origin: 'user', file: 'p.json', profileId: 'p', path: 'id', message: 'listed on the row', kind: 'profiles' },
      { origin: 'user', file: null, profileId: 'a', path: 'extends', message: 'listed on the row too', kind: 'codes' },
      { origin: 'user', file: null, profileId: null, path: '', message: 'loose' },
      { origin: 'user', file: 'gone.json', profileId: 'gone', path: 'id', message: 'for a file that is not there', kind: 'profiles' },
    ];
    expect(looseProblems(files, problems, t)).toEqual(['loose', 'id: for a file that is not there']);
  });
});

describe('the buttons run the commands', () => {
  it('Open and Export of a row name the kind and the file; Test names the profile', () => {
    extra.push(SHOP);
    const [row] = rowsOf([SHOP], [{ kind: 'profiles', name: 'shop-lathe.json', error: null }], [], t);
    expect(rowCommand('open', row)).toEqual({ id: 'profile.open', arg: { kind: 'profiles', name: 'shop-lathe.json' } });
    expect(rowCommand('export', row)).toEqual({ id: 'profile.export', arg: { kind: 'profiles', name: 'shop-lathe.json' } });
    expect(rowCommand('test', row)).toEqual({ id: 'profile.testOnDocument', arg: { profileId: 'shop-lathe' } });
    const [codes] = rowsOf([], [{ kind: 'codes', name: 'c.json', error: null }], [], t);
    expect(rowCommand('open', codes).arg).toEqual({ kind: 'codes', name: 'c.json' });
  });
});

describe('New…', () => {
  it('starts from the profile the row came from, with a name suggested from it', () => {
    const draft = newDraft('profiles', 'fanuc-lathe');
    expect(draft.values).toEqual({ [FIELD_PARENT]: 'fanuc-lathe', [FIELD_NAME]: 'my-fanuc-lathe' });
  });

  it('suggests the set’s own name for a code file, which adds to that set', () => {
    expect(newDraft('codes', 'fanuc-lathe').values).toEqual({ [FIELD_PARENT]: 'fanuc-lathe', [FIELD_NAME]: 'fanuc-lathe' });
  });

  it('falls back to the first choice when the parent is not offered', () => {
    expect(newDraft('profiles', 'nope').values[FIELD_PARENT]).toBe(profiles.list()[0].id);
  });

  it('shows the form with a choice of parents and a name, in plain words', () => {
    const fields = newFields(newDraft('profiles'), t);
    expect(fields.map((f) => [f.id, f.type])).toEqual([[FIELD_PARENT, 'choice'], [FIELD_NAME, 'text']]);
    expect(fields[0].choices?.length).toBe(profiles.list().length);
    expect(fields[0].label).toBe(t('userConfig.page.parentProfile'));
  });

  it('refuses an empty name, a bad name, a name that is taken and a profile id that exists', () => {
    const draft = newDraft('profiles', 'fanuc-lathe');
    const fields = newFields(draft, t);
    const with_ = (name: string) => newErrors({ ...draft, values: { ...draft.values, [FIELD_NAME]: name } }, fields);
    expect(Object.keys(with_(''))).toEqual([FIELD_NAME]);
    expect(with_('has space!')[FIELD_NAME]).toMatchObject({ key: 'userConfig.name.invalid' });
    expect(with_('fanuc-gcode')[FIELD_NAME]).toMatchObject({ key: 'userConfig.name.profileExists' });
    expect(with_('shop')).toEqual({});
    filesStore.set([{ kind: 'profiles', name: 'shop.json', error: null }]);
    expect(with_('shop')[FIELD_NAME]).toMatchObject({ key: 'userConfig.name.taken' });
    // What would be written is what is checked: typed capitals and blanks are folded first.
    expect(with_('Shop')[FIELD_NAME]).toMatchObject({ key: 'userConfig.name.taken' });
  });

  it('runs profile.newFrom with the kind, the parent and the name', async () => {
    const draft = newDraft('codes', 'fanuc');
    await createFile({ ...draft, values: { ...draft.values, [FIELD_NAME]: 'mine' } }, deps());
    expect(fake.ran).toEqual([{ id: 'profile.newFrom', arg: { kind: 'codes', parent: 'fanuc', name: 'mine' } }]);
  });

  it('shows the form in place of the list (a modal cannot open over this dialog)', () => {
    // The markup of the initial state has no form; the form is state of the page.
    expect(page()).not.toContain('data-testid="profile-form"');
  });
});

describe('Remove…', () => {
  const row = rowsOf([], [{ kind: 'profiles', name: 'x.json', error: null }], [], t)[0];

  it('asks first, deletes the file, reads the folders again and says so', async () => {
    const d = deps();
    expect(await removeRow(row, d)).toBe(true);
    expect(d.dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: t('userConfig.page.removeTitle', { name: 'x.json' }) }));
    expect(d.deleteFile).toHaveBeenCalledWith('profiles', 'x.json');
    expect(d.userConfig.load).toHaveBeenCalledTimes(1);
    expect(fake.shown.at(-1)).toEqual({ text: t('userConfig.page.removed', { name: 'x.json' }), error: false });
  });

  it('deletes nothing when the question is answered no', async () => {
    const d = deps({ dialogs: { confirm: vi.fn(async () => false) } });
    expect(await removeRow(row, d)).toBe(false);
    expect(d.deleteFile).not.toHaveBeenCalled();
    expect(d.userConfig.load).not.toHaveBeenCalled();
  });

  it('uses the code folder for a code file', async () => {
    const d = deps();
    await removeRow(rowsOf([], [{ kind: 'codes', name: 'c.json', error: null }], [], t)[0], d);
    expect(d.deleteFile).toHaveBeenCalledWith('codes', 'c.json');
  });

  it('says why when the file could not be removed', async () => {
    const d = deps({ deleteFile: vi.fn(async () => { throw new Error('in use'); }) });
    expect(await removeRow(row, d)).toBe(false);
    expect(fake.shown.at(-1)).toMatchObject({ text: t('userConfig.page.removeFailed', { name: 'x.json' }), error: true });
  });

  it('never removes a built-in profile', async () => {
    const d = deps();
    const builtin = rowsOf(profiles.list().slice(0, 1), [], [], t)[0];
    expect(await removeRow(builtin, d)).toBe(false);
    expect(d.dialogs.confirm).not.toHaveBeenCalled();
  });
});

// M13 review fixes: notes are not problems (info notices), a row is bounded (CODE-5), and a create
// that made no file keeps the form (CODE-9).
describe('notes and bounds', () => {
  const problem = (over: Partial<ProfileProblem>): ProfileProblem => ({
    origin: 'user',
    file: 'x.json',
    profileId: 'x',
    path: 'codes[0]',
    message: 'm',
    kind: 'codes',
    ...over,
  });

  it('lists a note under its file without counting it as a problem', () => {
    filesStore.set([{ kind: 'codes', name: 'x.json', error: null }]);
    problemStore.set([problem({ severity: 'info', message: 'changes what G83 means' })]);
    const html = page();
    expect(html).toContain('data-problems="0"');
    expect(html).toContain('data-notices="1"');
    expect(html).toContain('data-testid="profile-notes"');
    expect(html).toContain('changes what G83 means');
  });

  it('keeps notes and problems of one file in their own lists', () => {
    const rows = rowsOf(
      [],
      [{ kind: 'codes', name: 'x.json', error: null }],
      [problem({ message: 'bad' }), problem({ severity: 'info', message: 'fyi' })],
      t,
    );
    expect(rows[0].problems).toEqual(['codes[0]: bad']);
    expect(rows[0].notices).toEqual(['codes[0]: fyi']);
  });

  it('puts a note that names no file of the list among the loose notes, not the loose problems', () => {
    const loose = [problem({ file: null, profileId: null, path: '', kind: undefined, severity: 'info', message: 'fyi' })];
    expect(looseProblems([], loose, t)).toEqual([]);
    expect(looseProblems([], loose, t, true)).toEqual(['fyi']);
  });

  it('lists at most MAX_ROW_LINES problems of one file and counts the rest', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => problem({ path: `codes[${i}]`, message: 'bad' }));
    const rows = rowsOf([], [{ kind: 'codes', name: 'x.json', error: null }], many, t);
    expect(rows[0].problems).toHaveLength(MAX_ROW_LINES + 1);
    expect(rows[0].problems.at(-1)).toBe(t('userConfig.load.more', { count: 10_000 - MAX_ROW_LINES }));
    filesStore.set([{ kind: 'codes', name: 'x.json', error: null }]);
    problemStore.set(many);
    expect(page().match(/class="problem"/g)?.length ?? 0).toBeLessThanOrEqual(MAX_ROW_LINES + 1);
  });

  it('bounds the loose lines too', () => {
    const many = Array.from({ length: 500 }, (_, i) => problem({ file: null, profileId: null, path: '', kind: undefined, message: `m${i}` }));
    expect(looseProblems([], many, t)).toHaveLength(MAX_ROW_LINES + 1);
  });
});

describe('Create keeps the form when no file was made', () => {
  const draft = (): ReturnType<typeof newDraft> => {
    const d = newDraft('profiles', 'fanuc-gcode');
    return { ...d, values: { ...d.values, [FIELD_NAME]: 'Mine' } };
  };

  it('answers false when the command ran but the file is not in the folder', async () => {
    const asked: [string, string][] = [];
    const made = await createFile(draft(), deps({ exists: (kind, name) => (asked.push([kind, name]), false) }));
    expect(made).toBe(false);
    expect(asked).toEqual([['profiles', 'mine.json']]);
  });

  it('answers true when the file is there, and false when the command failed', async () => {
    expect(await createFile(draft(), deps({ exists: () => true }))).toBe(true);
    expect(await createFile(draft(), deps({ run: async () => false, exists: () => true }))).toBe(false);
  });
});
