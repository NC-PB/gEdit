// The user's profiles and code files (plan AD-29, §7.16 #192, #197; WP13.2): the load chain
// over the real registries with a fake folder, fake documents and a fake Results panel.

import { get, writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { capProblems, createUserConfig, MAX_PROBLEMS, MAX_PROBLEMS_PER_FILE, nestingOf, type UserConfigDeps } from './userConfig';
import { createProfileRegistry } from '$lib/stores/profiles';
import { createCodeDbService } from '$lib/stores/codes';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import type { ConfigPaths, UserFile, UserFileKind } from '$lib/platform/commands';
import type { DocMeta, ReportData } from '$lib/app/types';
import type { ProfileProblem } from '$lib/core/profiles/types';

const PATHS = {
  configDir: '/cfg',
  profilesDir: '/cfg/profiles',
  codesDir: '/cfg/codes',
} as ConfigPaths;

const json = (value: unknown): string => JSON.stringify(value);
const profileFile = (id: string, patch: Record<string, unknown> = {}): UserFile => ({
  name: `${id}.json`,
  text: json({ id, name: `${id} lathe`, shortName: id.toUpperCase().slice(0, 8), extends: 'fanuc-lathe', ...patch }),
  error: null,
});
const codeFile = (id: string, patch: Record<string, unknown> = {}): UserFile => ({
  name: `${id}.json`,
  text: json({ dialect: id, extends: 'fanuc-lathe', codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }], ...patch }),
  error: null,
});

function setup(initial: { profiles?: UserFile[]; codes?: UserFile[] } = {}, over: Partial<UserConfigDeps> = {}) {
  const folder: Record<UserFileKind, UserFile[]> = { profiles: initial.profiles ?? [], codes: initial.codes ?? [] };
  const codes = createCodeDbService({
    dialectOf: (dialect) => dialect,
    source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
    sources: () => BUILTIN_CODE_DB_JSON,
    warn: () => {},
  });
  const profiles = createProfileRegistry({
    filtersSupported: true,
    codeDbFiles: () => codes.files(),
    codeDb: (dialect, own) => codes.over(own, dialect),
    onProblem: () => {},
  });
  const reloads: string[] = [];
  const codeReload = codes.reload.bind(codes);
  const profileReload = profiles.reload.bind(profiles);
  codes.reload = (user) => (reloads.push('codes'), codeReload(user));
  profiles.reload = (user) => (reloads.push('profiles'), profileReload(user));

  const docs: DocMeta[] = [];
  const setProfile = vi.fn((id: string, profileId: string) => {
    const doc = docs.find((d) => d.id === id);
    if (doc) doc.profileId = profileId;
  });
  const status = vi.fn();
  const reports: ReportData[] = [];
  const list = vi.fn(async (kind: UserFileKind) => folder[kind]);
  const deps: UserConfigDeps = {
    available: () => true,
    list,
    codes,
    profiles,
    docs: () => docs,
    text: (id) => `text of ${id}`,
    setProfile,
    status,
    report: (data) => reports.push(data),
    paths: writable<ConfigPaths | null>(PATHS),
    caseInsensitivePaths: false,
    backslashSeparator: false,
    ...over,
  };
  const config = createUserConfig(deps);
  let revision = 0;
  profiles.revision.subscribe((n) => (revision = n));
  const addDoc = (id: string, profileId: string, path: string | null = null): DocMeta => {
    const doc = { id, profileId, path, title: id } as DocMeta;
    docs.push(doc);
    return doc;
  };
  return { config, codes, profiles, folder, reloads, docs, addDoc, setProfile, status, reports, list, revision: () => revision };
}

describe('load', () => {
  it('reloads nothing when there are no user files, as at every start without any', async () => {
    const s = setup();
    expect(await s.config.load()).toEqual([]);
    expect(s.reloads).toEqual([]);
    expect(s.revision()).toBe(0);
    expect(s.reports).toEqual([]);
    expect(get(s.config.files)).toEqual([]);
  });

  it('reloads the code files, then the profiles, and the profile sees the database', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe', { codes: 'lathe-shop' })], codes: [codeFile('lathe-shop')] });
    expect(await s.config.load()).toEqual([]);
    expect(s.reloads).toEqual(['codes', 'profiles']);
    expect(s.revision()).toBe(1);
    expect(s.profiles.get('shop-lathe')?.origin).toBe('user');
    expect(s.codes.byId('lathe-shop').codes.some((c) => c.code === 'M13')).toBe(true);
    expect(get(s.config.files)).toEqual([
      { kind: 'profiles', name: 'shop-lathe.json', error: null },
      { kind: 'codes', name: 'lathe-shop.json', error: null },
    ]);
  });

  it('does nothing when every file is byte-identical to the last load', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    s.reloads.length = 0;
    await s.config.load();
    await s.config.load();
    expect(s.reloads).toEqual([]);
    expect(s.revision()).toBe(1);

    s.folder.profiles = [profileFile('shop-lathe', { name: 'Renamed' })];
    await s.config.load();
    expect(s.reloads).toEqual(['codes', 'profiles']);
    expect(s.revision()).toBe(2);
    expect(s.profiles.profile('shop-lathe').name).toBe('Renamed');
  });

  it('forgets a profile whose file was removed', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    s.folder.profiles = [];
    await s.config.load();
    expect(s.profiles.get('shop-lathe')).toBeUndefined();
  });

  it('keeps open documents and their profiles when a reload changes other things', async () => {
    const s = setup();
    const built = s.addDoc('d1', 'fanuc-lathe', '/nc/a.nc');
    s.folder.profiles = [profileFile('shop-lathe')];
    await s.config.load();
    expect(s.docs).toEqual([built]);
    expect(built.profileId).toBe('fanuc-lathe');
    expect(s.setProfile).not.toHaveBeenCalled();
    expect(s.status).not.toHaveBeenCalled();
  });

  it('keeps a document on a user profile that is still there after the reload', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    s.addDoc('d1', 'shop-lathe');
    s.folder.profiles = [profileFile('shop-lathe', { name: 'Changed' })];
    await s.config.load();
    expect(s.setProfile).not.toHaveBeenCalled();
  });

  it('detects the documents again whose profile has vanished, with one status message', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    s.addDoc('d1', 'shop-lathe', '/nc/a.mpf');
    s.addDoc('d2', 'shop-lathe');
    s.addDoc('d3', 'fanuc-gcode');
    s.folder.profiles = [];
    await s.config.load();

    expect(s.setProfile).toHaveBeenCalledTimes(2);
    // d1 is read as the dialect its path and text say; d2 falls back to the default.
    expect(s.setProfile).toHaveBeenCalledWith('d1', 'sinumerik');
    expect(s.setProfile).toHaveBeenCalledWith('d2', s.profiles.defaultId());
    expect(s.status).toHaveBeenCalledTimes(1);
    expect(s.status.mock.calls[0][0]).toMatch(/2 open documents/);
  });

  it('never throws when a document cannot be detected again', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] }, { text: () => { throw new Error('no model'); } });
    await s.config.load();
    s.addDoc('d1', 'shop-lathe');
    s.folder.profiles = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(s.config.load()).resolves.toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('problems', () => {
  it('shows a file that could not be read as a problem and never loads it', async () => {
    const s = setup({
      profiles: [
        { name: 'big.json', text: null, error: 'the file is larger than 1 MiB' },
        profileFile('good'),
      ],
    });
    const problems = await s.config.load();
    expect(problems).toEqual([
      { origin: 'user', file: 'big.json', profileId: null, path: '', message: 'the file is larger than 1 MiB', kind: 'profiles' },
    ]);
    expect(s.profiles.get('good')).toBeDefined();
    expect(get(s.config.files).find((f) => f.name === 'big.json')?.error).toBe('the file is larger than 1 MiB');
  });

  it('reports a broken profile and a broken code file with their JSON paths, and the rest loads', async () => {
    const s = setup({
      profiles: [profileFile('bad-step', { numbering: { step: 'ten' } }), profileFile('fanuc-gcode'), profileFile('good')],
      codes: [codeFile('mine', { codes: {} })],
    });
    const problems = await s.config.load();
    const keys = problems.map((p) => `${p.file}:${p.path}`).sort();
    expect(keys).toEqual(['bad-step.json:numbering.step', 'fanuc-gcode.json:id', 'mine.json:codes']);
    // Every problem says which folder its file is in.
    expect(problems.map((p) => `${p.file}:${p.kind}`).sort()).toEqual([
      'bad-step.json:profiles',
      'fanuc-gcode.json:profiles',
      'mine.json:codes',
    ]);
    expect(get(s.config.problems)).toEqual(problems);
    expect(s.profiles.get('good')).toBeDefined();
    expect(s.profiles.get('fanuc-gcode')?.origin).toBe('builtin');
    expect(s.profiles.get('bad-step')).toBeUndefined();
  });

  it('puts the problems into the Results panel, one row each, and says nothing when there are none', async () => {
    const s = setup({ profiles: [profileFile('bad-step', { numbering: { step: 'ten' } })] });
    await s.config.load();
    expect(s.reports).toHaveLength(1);
    const report = s.reports[0];
    expect(report.title).toBe('Profiles and code files');
    expect(report.message).toMatch(/1 problem/);
    expect(report.rows).toEqual([{ file: 'bad-step.json', at: 'bad-step · numbering.step', problem: 'has to be a number' }]);

    s.folder.profiles = [profileFile('good')];
    await s.config.load();
    expect(s.reports).toHaveLength(1);
    expect(get(s.config.problems)).toEqual([]);
  });

  it('does not show the same problems again for a byte-identical load', async () => {
    const s = setup({ profiles: [{ name: 'x.json', text: '{', error: null }] });
    await s.config.load();
    await s.config.load();
    expect(s.reports).toHaveLength(1);
    expect(get(s.config.problems)).toHaveLength(1);
  });

  it('survives a registry that throws', async () => {
    const s = setup({ profiles: [profileFile('good')] });
    s.profiles.reload = () => {
      throw new Error('boom');
    };
    const problems = await s.config.load();
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/boom/);
  });

  it('reports a folder that cannot be listed and changes nothing', async () => {
    const s = setup({ profiles: [profileFile('good')] });
    await s.config.load();
    s.list.mockRejectedValueOnce(new Error('permission denied'));
    const problems = await s.config.load();
    expect(problems[0].message).toMatch(/permission denied/);
    expect(s.profiles.get('good')).toBeDefined();
  });

  it('reads nothing outside Tauri', async () => {
    const s = setup({ profiles: [profileFile('good')] }, { available: () => false });
    expect(await s.config.load()).toEqual([]);
    expect(s.list).not.toHaveBeenCalled();
    expect(s.profiles.get('good')).toBeUndefined();
  });

  it('runs two loads one after the other', async () => {
    const s = setup({ profiles: [profileFile('good')] });
    const [a, b] = await Promise.all([s.config.load(), s.config.load()]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(s.reloads).toEqual(['codes', 'profiles']);
  });
});

describe('kindOf', () => {
  const s = setup();

  it('answers the folder a file lies directly in', () => {
    expect(s.config.kindOf('/cfg/profiles/shop.json')).toBe('profiles');
    expect(s.config.kindOf('/cfg/codes/shop.json')).toBe('codes');
    expect(s.config.kindOf('/cfg//profiles/./shop.json')).toBe('profiles');
  });

  it('answers null for everything else', () => {
    expect(s.config.kindOf('/cfg/settings.json')).toBeNull();
    expect(s.config.kindOf('/cfg/profiles/sub/shop.json')).toBeNull();
    expect(s.config.kindOf('/cfg/profiles2/shop.json')).toBeNull();
    expect(s.config.kindOf('/other/profiles/shop.json')).toBeNull();
    expect(s.config.kindOf('shop.json')).toBeNull();
    expect(s.config.kindOf('')).toBeNull();
  });

  it('knows no folder before the paths are known', () => {
    const early = setup({}, { paths: writable<ConfigPaths | null>(null) });
    expect(early.config.kindOf('/cfg/profiles/shop.json')).toBeNull();
  });

  it('folds case where the platform does, and the separator on Windows', () => {
    const win = setup(
      {},
      {
        paths: writable<ConfigPaths | null>({ ...PATHS, profilesDir: 'C:\\Users\\Me\\cfg\\profiles', codesDir: 'C:\\Users\\Me\\cfg\\codes' }),
        caseInsensitivePaths: true,
        backslashSeparator: true,
      },
    );
    expect(win.config.kindOf('c:\\users\\me\\CFG\\Profiles\\a.json')).toBe('profiles');
    expect(win.config.kindOf('C:/Users/Me/cfg/codes/a.json')).toBe('codes');
    const posix = setup({}, { paths: writable<ConfigPaths | null>({ ...PATHS, profilesDir: '/Cfg/profiles' }) });
    expect(posix.config.kindOf('/cfg/profiles/a.json')).toBeNull();
  });
});

// M13 review fixes (CODE-2, CODE-5, CODE-6): a broken file, a flood of problems, a typo saved
// and fixed again.
describe('a file that nests too deeply (CODE-2)', () => {
  const deep = (levels: number): string => `${'['.repeat(levels)}${']'.repeat(levels)}`;

  it('counts the brackets outside strings only', () => {
    expect(nestingOf('{"a":[1,[2]]}')).toBe(3);
    expect(nestingOf('{"a":"[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[["}')).toBe(1);
    expect(nestingOf('{"a":"\\"[[[["}')).toBe(1);
    expect(nestingOf(deep(10_000))).toBeGreaterThan(64);
  });

  it('reports a deep code file and a deep profile file with their names and loads everything else', async () => {
    const s = setup({
      profiles: [
        profileFile('a-good'),
        { name: 'b-deep.json', text: `{"id":"b-deep","name":"b","shortName":"B","extends":"fanuc-lathe","zzz":${deep(8000)}}`, error: null },
      ],
      codes: [{ name: 'fanuc.json', text: `{"dialect":"fanuc","version":1,"codes":[],"zzz":${deep(8000)}}`, error: null }],
    });
    const problems = await s.config.load();
    expect(problems.map((p) => `${p.kind}:${p.file}`).sort()).toEqual(['codes:fanuc.json', 'profiles:b-deep.json']);
    expect(problems.every((p) => /nested too deeply/.test(p.message))).toBe(true);
    expect(s.profiles.get('a-good')).toBeDefined();
    // The code service is not poisoned: the built-in database still answers.
    expect(s.codes.byId('fanuc').codes.length).toBeGreaterThan(10);
    expect(s.codes.byId('fanuc-lathe').codes.length).toBeGreaterThan(10);
  });
});

describe('a load that failed is tried again (CODE-2)', () => {
  it('runs the reloads again for the same bytes after a registry threw, and not after one that worked', async () => {
    const s = setup({ profiles: [profileFile('good')] });
    const real = s.profiles.reload.bind(s.profiles);
    let fail = true;
    s.profiles.reload = (user) => {
      if (fail) throw new Error('boom');
      return real(user);
    };
    const first = await s.config.load();
    expect(first[0].message).toMatch(/boom/);
    fail = false;
    // Same bytes: Reload retries, instead of "nothing changed".
    const second = await s.config.load();
    expect(second).toEqual([]);
    expect(s.profiles.get('good')).toBeDefined();
    // And now it is remembered.
    s.reloads.length = 0;
    await s.config.load();
    expect(s.reloads).toEqual([]);
  });

  it('retries after the profile registry answered with a failure that names no file', async () => {
    const s = setup({ profiles: [profileFile('good')] });
    let net = true;
    const real = s.profiles.reload.bind(s.profiles);
    s.profiles.reload = (user) =>
      net
        ? [{ origin: 'user' as const, file: null, profileId: null, path: '', message: 'Maximum call stack size exceeded', kind: 'profiles' as const }]
        : real(user);
    await s.config.load();
    net = false;
    expect(await s.config.load()).toEqual([]);
    expect(s.profiles.get('good')).toBeDefined();
  });
});

describe('a flood of problems (CODE-5)', () => {
  const problem = (file: string, n: number, severity?: 'info'): ProfileProblem => ({
    origin: 'user',
    file,
    profileId: null,
    path: `outline[${n}]`,
    message: `bad ${n}`,
    kind: 'profiles',
    ...(severity === undefined ? {} : { severity }),
  });

  it('keeps at most 50 problems of a file with a last row that counts the rest', () => {
    const many = Array.from({ length: 10_000 }, (_, n) => problem('big.json', n));
    const { problems, dropped } = capProblems(many);
    expect(problems).toHaveLength(MAX_PROBLEMS_PER_FILE + 1);
    expect(problems.at(-1)).toMatchObject({ file: 'big.json', path: '', message: 'and 9950 more not listed' });
    expect(dropped).toBe(9950);
  });

  it('keeps at most 500 in a load, and keeps errors apart from notes', () => {
    const files = Array.from({ length: 40 }, (_, f) => Array.from({ length: 30 }, (_, n) => problem(`f${f}.json`, n)));
    const { problems } = capProblems([...files.flat(), problem('n.json', 0, 'info')]);
    expect(problems.filter((p) => p.severity !== 'info').length).toBeLessThanOrEqual(MAX_PROBLEMS + 40);
    expect(problems.filter((p) => p.severity !== 'info' && p.path !== '').length).toBe(MAX_PROBLEMS);
    // A note is listed too, after the errors.
    expect(problems.at(-1)).toMatchObject({ file: 'n.json', severity: 'info' });
  });

  it('puts at most the cap into the problems and the report of a load, and sets dropped', async () => {
    const s = setup({ profiles: [profileFile('good')] });
    s.profiles.reload = () => Array.from({ length: 10_000 }, (_, n) => problem('big.json', n));
    const problems = await s.config.load();
    expect(problems.length).toBeLessThanOrEqual(MAX_PROBLEMS_PER_FILE + 1);
    expect(get(s.config.problems)).toEqual(problems);
    expect(s.reports[0].rows.length).toBeLessThanOrEqual(MAX_PROBLEMS_PER_FILE + 1);
    expect(s.reports[0].dropped).toBe(10_000 - MAX_PROBLEMS_PER_FILE);
  });
});

describe('notes (severity info)', () => {
  const note: ProfileProblem = {
    origin: 'user',
    file: 'fanuc-lathe.json',
    profileId: null,
    path: 'codes[0].pitchFeed',
    message: 'G76: your entry sets pitchFeed to false; scale feed will scale its F',
    kind: 'codes',
    severity: 'info',
  };

  it('are listed with the problems but never open the Results panel on their own', async () => {
    const s = setup({ codes: [codeFile('lathe-shop')] });
    s.codes.reload = () => [note];
    const problems = await s.config.load();
    expect(problems).toEqual([note]);
    expect(get(s.config.problems)).toEqual([note]);
    expect(s.reports).toEqual([]);
  });

  it('are rows in the report that a real problem opens, marked as notes and counted apart', async () => {
    const s = setup({ profiles: [profileFile('bad-step', { numbering: { step: 'ten' } })], codes: [codeFile('lathe-shop')] });
    s.codes.reload = () => [note];
    await s.config.load();
    expect(s.reports).toHaveLength(1);
    const [report] = s.reports;
    expect(report.message).toBe('1 problem in your profiles and code files. Everything else loaded. And 1 note.');
    expect(report.rows).toHaveLength(2);
    expect(report.rows[1]).toMatchObject({ file: 'fanuc-lathe.json', problem: `Note: ${note.message}` });
  });
});

describe('a profile that vanishes for one save (CODE-6)', () => {
  it('moves a document back when the profile is fixed, with one status line', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    const doc = s.addDoc('d1', 'shop-lathe', '/shop/a.nc');
    s.folder.profiles = [profileFile('shop-lathe', { numbering: { step: 'ten' } })];
    await s.config.load();
    expect(doc.profileId).not.toBe('shop-lathe');
    expect(s.status).toHaveBeenCalledTimes(1);

    s.folder.profiles = [profileFile('shop-lathe', { name: 'Fixed' })];
    await s.config.load();
    expect(doc.profileId).toBe('shop-lathe');
    expect(s.status).toHaveBeenCalledTimes(2);
    expect(s.status.mock.calls[1][0]).toMatch(/1 open document is back/);
  });

  it('keeps the original profile through a second bad save', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    const doc = s.addDoc('d1', 'shop-lathe');
    for (const step of ['ten', 'twenty']) {
      s.folder.profiles = [profileFile('shop-lathe', { numbering: { step } })];
      await s.config.load();
    }
    s.folder.profiles = [profileFile('shop-lathe')];
    await s.config.load();
    expect(doc.profileId).toBe('shop-lathe');
  });

  it('leaves a document the user moved in between where the user put it', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    const doc = s.addDoc('d1', 'shop-lathe');
    s.folder.profiles = [];
    await s.config.load();
    doc.profileId = 'okuma-osp';
    s.folder.profiles = [profileFile('shop-lathe')];
    await s.config.load();
    expect(doc.profileId).toBe('okuma-osp');
    // And it is forgotten: a later load does not move it either.
    s.folder.profiles = [profileFile('shop-lathe', { name: 'Again' })];
    await s.config.load();
    expect(doc.profileId).toBe('okuma-osp');
  });

  it('runs as the runtime scenario does: a program in the profile\'s folder, bad save, fixed save, the same bytes again', async () => {
    // m13-user-profile: shop-lathe is found by folder only (no content rules), the program
    // lies in that folder, and the save hook reloads after every save of the profile file.
    const good = (): UserFile =>
      profileFile('shop-lathe', { name: 'Shop lathe', detect: { folders: ['/shop'], content: [] }, numbering: { step: 7 } });
    const text = 'O1\nG21 G40 G99\nT0101 (ROUGH)\nM13\nG96 S200 M03\nM30\n';
    const s = setup({ profiles: [good()] }, { text: () => text });
    await s.config.load();
    const path = '/shop/part.nc';
    const doc = s.addDoc('d1', 'shop-lathe', path);
    expect(s.profiles.detect(path, text, s.profiles.defaultId())).toBe('shop-lathe');

    s.folder.profiles = [profileFile('shop-lathe', { detect: { folders: ['/shop'], content: [] }, numbering: { step: 'seven' } })];
    await s.config.load();
    expect(s.profiles.get('shop-lathe')).toBeUndefined();
    expect(doc.profileId).toBe('fanuc-lathe');

    s.folder.profiles = [good()];
    await s.config.load();
    expect(s.profiles.get('shop-lathe')).toBeDefined();
    expect(doc.profileId).toBe('shop-lathe');

    // The save hook may reload a second time with the same bytes: nothing moves, nothing is said.
    const said = s.status.mock.calls.length;
    await s.config.load();
    expect(doc.profileId).toBe('shop-lathe');
    expect(s.status.mock.calls.length).toBe(said);
  });

  it('forgets a document the user chose a dialect for, even the one it was moved to', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    const doc = s.addDoc('d1', 'shop-lathe');
    s.folder.profiles = [];
    await s.config.load();
    const fallback = doc.profileId;
    expect(s.config.forget('d1')).toBe(true);
    expect(s.config.forget('d1')).toBe(false);
    s.folder.profiles = [profileFile('shop-lathe')];
    await s.config.load();
    expect(doc.profileId).toBe(fallback);
  });

  it('forgets a document that was closed', async () => {
    const s = setup({ profiles: [profileFile('shop-lathe')] });
    await s.config.load();
    s.addDoc('d1', 'shop-lathe');
    s.folder.profiles = [];
    await s.config.load();
    s.docs.length = 0;
    s.setProfile.mockClear();
    s.folder.profiles = [profileFile('shop-lathe')];
    await s.config.load();
    expect(s.setProfile).not.toHaveBeenCalled();
  });
});
