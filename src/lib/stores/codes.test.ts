// The code database service (plan §7.3, WP3.3): profile → dialect → database, caching,
// and what happens when a database is missing or broken.

import { describe, expect, it, vi } from 'vitest';
import { codes as service, createCodeDbService } from './codes';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { profiles } from './profiles';
import type { NcToken } from '$lib/core/nc/types';
import type { ProfileProblem } from '$lib/core/profiles/types';

function word(address: string, valueText: string): NcToken {
  return { kind: 'word', start: 0, end: 0, text: address + valueText, address, valueText };
}

describe('the built-in code database service', () => {
  it('answers for both P1 profiles', () => {
    expect(service.forProfile('fanuc-gcode').dialect).toBe('fanuc');
    expect(service.forProfile('heidenhain-klartext').dialect).toBe('heidenhain');
  });

  // The merge wired `dialectOf` to the registry, so a profile names its database in one
  // place. A user profile (P2) resolves through the same path once the registry loads it.
  it('takes the dialect from the profile registry, not from a copy', () => {
    for (const info of profiles.list()) {
      expect(service.forProfile(info.id).dialect).toBe(profiles.profile(info.id).codes);
    }
  });

  it('hands out the same database object twice, so the lookup index is built once', () => {
    expect(service.forProfile('fanuc-gcode')).toBe(service.forProfile('fanuc-gcode'));
  });

  it('answers with an empty database for a profile it does not know', () => {
    const db = service.forProfile('no-such-profile');
    expect(db.codes).toEqual([]);
    expect(db.addresses).toEqual({});
  });

  it('looks a word up through the profile', () => {
    expect(service.lookupWord('fanuc-gcode', word('G', '83'))?.entry?.label).toBe(
      'Peck drilling cycle',
    );
    expect(service.lookupWord('no-such-profile', word('G', '83'))).toEqual({ entry: null, unknown: true });
  });

  it('completes through the profile', () => {
    // G80–G89 plus the older-format rigid taps G84.2 and G84.3 (2026-09).
    expect(service.completions('fanuc-gcode', 'G8', false)).toHaveLength(12);
    expect(service.completions('heidenhain-klartext', 'CYCL DEF 2', true).length).toBeGreaterThan(0);
    expect(service.completions('no-such-profile', 'G', true)).toEqual([]);
  });

  it('hands the flat list to the script context', () => {
    const list = service.forScripts('fanuc-gcode');
    expect(list).toBe(service.forProfile('fanuc-gcode').codes);
    expect(list.length).toBeGreaterThan(50);
  });

  // M6, AD-17: a child database is written as the difference to its parent, so what the
  // service serves has to be the **resolved** one — otherwise a lathe document would find
  // four codes and call everything else unknown.
  it('serves a child database with its parent merged in', () => {
    const lathe = service.forProfile('fanuc-lathe');
    expect(lathe.dialect).toBe('fanuc-lathe');
    // I6: `G28` is inherited word for word, while `G83` is a **face** drilling cycle on a
    // lathe and the child overrides it — so the inherited entry is the one that proves the
    // merge, and the overridden one proves the child still wins.
    expect(lathe.codes.find((entry) => entry.code === 'G28')?.label).toBe('Return to the reference point');
    expect(lathe.codes.find((entry) => entry.code === 'G83')?.label).toBe('Drilling cycle on the face');
    expect(lathe.codes.length).toBeGreaterThan(50);
    expect(Object.keys(lathe.addresses).length).toBeGreaterThan(5);
  });

  it('serves a variant database by its own id, for a machine that switches to it', () => {
    const b = service.byId('fanuc-lathe-b');
    expect(b.dialect).toBe('fanuc-lathe-b');
    expect(b.codes.find((entry) => entry.code === 'G95')?.group).toBe('feedmode');
    // The same object every time; an empty id is the "no database" answer.
    expect(service.byId('fanuc-lathe-b')).toBe(b);
    expect(service.byId('')).toEqual({ dialect: '', version: 0, addresses: {}, codes: [] });
  });

  it('looks up and completes an inherited code through the child profile', () => {
    expect(service.lookupWord('fanuc-lathe', word('G', '28'))?.entry?.label).toBe('Return to the reference point');
    expect(service.completions('fanuc-lathe', 'G8', false).length).toBeGreaterThan(0);
  });
});

describe('createCodeDbService', () => {
  const db = {
    dialect: 'demo',
    version: 1,
    addresses: { X: { label: 'X axis' } },
    codes: [{ code: 'G0', label: 'Rapid' }],
  };

  it('loads a dialect once and caches it', () => {
    const source = vi.fn(() => db);
    const svc = createCodeDbService({ dialectOf: () => 'demo', source, warn: () => {} });
    expect(svc.forProfile('a')).toBe(svc.forProfile('b'));
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('falls back to an empty database and warns when the file is missing', () => {
    const warn = vi.fn();
    const svc = createCodeDbService({ dialectOf: () => 'gone', source: () => undefined, warn });
    expect(svc.forProfile('a').codes).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/gone/);
  });

  it('falls back to an empty database and warns when the file is not a database', () => {
    const warn = vi.fn();
    const svc = createCodeDbService({ dialectOf: () => 'bad', source: () => 42, warn });
    expect(svc.forProfile('a').codes).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the good part of a database and reports the rest', () => {
    const warn = vi.fn();
    const svc = createCodeDbService({
      dialectOf: () => 'partly',
      source: () => ({ dialect: 'partly', version: 1, codes: [{ code: 'G0', label: 'Rapid' }, {}] }),
      warn,
    });
    expect(svc.forProfile('a').codes.map((e) => e.code)).toEqual(['G0']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/codes\[1\]/);
  });
});

// ---------------------------------------------------------------------------
// M13 (WP13.2, AD-29, §7.16 #195): the user's code files
// ---------------------------------------------------------------------------

/** A service over the built-in databases, as the application builds it, with its own reload state. */
function builtinService() {
  return createCodeDbService({
    dialectOf: (id) => id,
    source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
    sources: () => BUILTIN_CODE_DB_JSON,
    warn: () => {},
  });
}

const file = (name: string, content: unknown) => ({ name, text: typeof content === 'string' ? content : JSON.stringify(content) });
const labelOf = (db: { codes: { code: string; label: string }[] }, code: string) =>
  db.codes.find((entry) => entry.code === code)?.label;

describe('reload: a code file with the id of a built-in database is an overlay', () => {
  const overlay = file('fanuc-lathe.json', {
    dialect: 'fanuc-lathe',
    codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }],
  });

  it('lays the file over the built-in before its children resolve', () => {
    const svc = builtinService();
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).not.toBe('Chuck clamp (shop)');
    expect(svc.reload([overlay])).toEqual([]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Chuck clamp (shop)');
    // The child database inherits what the user added to its parent.
    expect(labelOf(svc.byId('fanuc-lathe-b'), 'M13')).toBe('Chuck clamp (shop)');
    // Everything else of the built-in is still there, and the other dialects did not change.
    expect(labelOf(svc.byId('fanuc-lathe'), 'G28')).toBe('Return to the reference point');
    expect(svc.byId('fanuc').codes.length).toBe(builtinService().byId('fanuc').codes.length);
  });

  it('drops every cache: a database handed out before the reload is not served after it', () => {
    const svc = builtinService();
    const before = svc.byId('fanuc-lathe');
    svc.reload([overlay]);
    expect(svc.byId('fanuc-lathe')).not.toBe(before);
    svc.reload([]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe(labelOf(before, 'M13'));
  });

  it('applies `remove` to the built-in', () => {
    const svc = builtinService();
    svc.reload([file('fanuc-lathe.json', { dialect: 'fanuc-lathe', remove: ['G28'] })]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'G28')).toBeUndefined();
    expect(labelOf(svc.byId('fanuc-lathe-b'), 'G28')).toBeUndefined();
  });
});

describe('reload: a code file with a new id is a database of its own', () => {
  const shop = file('lathe-shop.json', {
    dialect: 'lathe-shop',
    extends: 'fanuc-lathe',
    codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }],
  });

  it('extends a built-in database', () => {
    const svc = builtinService();
    expect(svc.reload([shop])).toEqual([]);
    const db = svc.byId('lathe-shop');
    expect(db.dialect).toBe('lathe-shop');
    expect(labelOf(db, 'M13')).toBe('Chuck clamp (shop)');
    expect(labelOf(db, 'G28')).toBe('Return to the reference point');
    // The built-in is not touched.
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).not.toBe('Chuck clamp (shop)');
  });

  it('extends another user database (files are read by name, so order does not matter)', () => {
    const svc = builtinService();
    const second = file('a-second.json', { dialect: 'a-second', extends: 'lathe-shop', codes: [{ code: 'M14', label: 'Chuck unclamp' }] });
    expect(svc.reload([second, shop])).toEqual([]);
    const db = svc.byId('a-second');
    expect(labelOf(db, 'M13')).toBe('Chuck clamp (shop)');
    expect(labelOf(db, 'M14')).toBe('Chuck unclamp');
  });

  it('serves its files to the profile registry, the overlay laid over its built-in', () => {
    const svc = builtinService();
    svc.reload([shop]);
    expect(Object.keys(svc.files())).toContain('lathe-shop');
    expect(Object.keys(svc.files())).toContain('fanuc-lathe');
  });
});

describe('reload: the variant rule (a user database follows the machine)', () => {
  const shop = file('lathe-shop.json', {
    dialect: 'lathe-shop',
    extends: 'fanuc-lathe',
    codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }, { code: 'G95', label: 'Shop feed per revolution' }],
  });

  it('lays the file\'s own entries over the variant\'s database', () => {
    const svc = builtinService();
    svc.reload([shop]);
    const underB = svc.over('lathe-shop', 'fanuc-lathe-b');
    // The user\'s M-code survives system B. G95 is a code system B defines itself and
    // system A does not have (M13 review NC-3): the variant decides it, not the A-based file.
    expect(labelOf(underB, 'M13')).toBe('Chuck clamp (shop)');
    expect(labelOf(underB, 'G95')).toBe(labelOf(svc.byId('fanuc-lathe-b'), 'G95'));
    expect(labelOf(underB, 'G95')).not.toBe('Shop feed per revolution');
    // What system B has and system A has not is there (`G92` threading in B).
    expect(labelOf(underB, 'G92')).toBe(labelOf(svc.byId('fanuc-lathe-b'), 'G92'));
    expect(labelOf(underB, 'G92')).not.toBe(labelOf(svc.byId('fanuc-lathe'), 'G92'));
    expect(underB.dialect).toBe('lathe-shop');
  });

  it('caches per pair', () => {
    const svc = builtinService();
    svc.reload([shop]);
    expect(svc.over('lathe-shop', 'fanuc-lathe-b')).toBe(svc.over('lathe-shop', 'fanuc-lathe-b'));
  });

  it('is the database itself for the same id, and the variant\'s own for a database that is not the user\'s', () => {
    const svc = builtinService();
    svc.reload([shop]);
    expect(svc.over('lathe-shop', 'lathe-shop')).toBe(svc.byId('lathe-shop'));
    expect(svc.over('fanuc-lathe', 'fanuc-lathe-b')).toBe(svc.byId('fanuc-lathe-b'));
    // A database that does not descend from the one the file extends is not laid under it.
    expect(svc.over('lathe-shop', 'heidenhain')).toBe(svc.byId('heidenhain'));
  });

  it('keeps the layers of a user database that extends a user database', () => {
    const svc = builtinService();
    const top = file('shop-top.json', { dialect: 'shop-top', extends: 'lathe-shop', codes: [{ code: 'M14', label: 'Unclamp' }] });
    svc.reload([shop, top]);
    const underB = svc.over('shop-top', 'fanuc-lathe-b');
    expect(labelOf(underB, 'M14')).toBe('Unclamp');
    expect(labelOf(underB, 'M13')).toBe('Chuck clamp (shop)');
  });
});

describe('reload: a bad file is reported and changes nothing', () => {
  const problemsOf = (...files: { name: string; text: string }[]) => {
    const svc = builtinService();
    return { svc, problems: svc.reload(files) };
  };

  it('reports text that is not JSON, with the file name, and keeps the built-ins', () => {
    const { svc, problems } = problemsOf(file('broken.json', '{ "dialect": '));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ origin: 'user', file: 'broken.json', path: '' });
    expect(problems[0].message).toMatch(/not valid JSON/);
    expect(svc.byId('fanuc-lathe').codes.length).toBe(builtinService().byId('fanuc-lathe').codes.length);
  });

  it('names a byte order mark', () => {
    const { problems } = problemsOf(file('bom.json', '\ufeff{}'));
    expect(problems[0].message).toMatch(/byte order mark/);
  });

  it('reports a file that is not an object', () => {
    expect(problemsOf(file('list.json', '[]')).problems[0].message).toMatch(/JSON object/);
  });

  it('requires the dialect to be the file stem', () => {
    const { problems, svc } = problemsOf(file('lathe-shop.json', { dialect: 'other', extends: 'fanuc', codes: [] }));
    expect(problems[0]).toMatchObject({ file: 'lathe-shop.json', path: 'dialect' });
    expect(svc.byId('lathe-shop').codes).toEqual([]);
  });

  it('requires `extends` on a new id, and refuses it on an overlay', () => {
    expect(problemsOf(file('mine.json', { dialect: 'mine', codes: [] })).problems[0]).toMatchObject({ path: 'extends' });
    const overlay = problemsOf(file('fanuc.json', { dialect: 'fanuc', extends: 'okuma', codes: [] }));
    expect(overlay.problems[0]).toMatchObject({ file: 'fanuc.json', path: 'extends' });
    // Refused whole: the built-in is as it was.
    expect(overlay.svc.byId('fanuc').codes.length).toBe(builtinService().byId('fanuc').codes.length);
  });

  it('reports an `extends` that names nothing, and a cycle', () => {
    const missing = problemsOf(file('mine.json', { dialect: 'mine', extends: 'nowhere', codes: [] }));
    expect(missing.problems[0]).toMatchObject({ origin: 'user', file: 'mine.json', profileId: 'mine', path: 'extends' });
    const cycle = problemsOf(
      file('aa.json', { dialect: 'aa', extends: 'bb', codes: [] }),
      file('bb.json', { dialect: 'bb', extends: 'aa', codes: [] }),
    );
    expect(cycle.problems.length).toBeGreaterThan(0);
    expect(cycle.problems.every((p) => p.path === 'extends')).toBe(true);
  });

  it('reports `codes` that is not an array', () => {
    expect(problemsOf(file('mine.json', { dialect: 'mine', extends: 'fanuc', codes: {} })).problems[0]).toMatchObject({ path: 'codes' });
  });

  it('reports a broken entry with its path in the file, and it cannot take the built-in entry of its code away', () => {
    // A label that is not text rejects the entry; laid over G28 unfiltered it would have
    // replaced G28 with nothing usable.
    const { svc, problems } = problemsOf(
      file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'M13', label: 'ok' }, { code: 'G28', label: 42 }] }),
    );
    expect(problems.map((p) => [p.file, p.path])).toEqual([['fanuc-lathe.json', 'codes[1].label']]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'G28')).toBe('Return to the reference point');
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('ok');
  });

  it('reports a problem once, however many databases inherit the file', () => {
    const { problems } = problemsOf(
      file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'G28', label: 42 }] }),
    );
    expect(problems).toHaveLength(1);
  });

  it('ignores the good file\'s neighbour: one broken file does not stop the next', () => {
    const { svc, problems } = problemsOf(
      file('a-broken.json', '{'),
      file('lathe-shop.json', { dialect: 'lathe-shop', extends: 'fanuc-lathe', codes: [{ code: 'M13', label: 'x' }] }),
    );
    expect(problems).toHaveLength(1);
    expect(labelOf(svc.byId('lathe-shop'), 'M13')).toBe('x');
  });

  it('never lets a file named __proto__ or with such members through', () => {
    const { svc } = problemsOf(
      file('mine.json', '{"dialect":"mine","extends":"fanuc","codes":[],"__proto__":{"polluted":true}}'),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(svc.byId('mine').dialect).toBe('mine');
  });

  it('is back to the built-ins after a reload with no files', () => {
    const svc = builtinService();
    svc.reload([file('lathe-shop.json', { dialect: 'lathe-shop', extends: 'fanuc-lathe', codes: [] })]);
    expect(svc.byId('lathe-shop').dialect).toBe('lathe-shop');
    expect(svc.reload([])).toEqual([]);
    expect(svc.byId('lathe-shop').codes).toEqual([]);
    expect(Object.keys(svc.files()).sort()).toEqual(Object.keys(BUILTIN_CODE_DB_JSON).sort());
  });
});

// ---------------------------------------------------------------------------
// M13 review: the NC batch (owner decisions of 2026-10-09)
// ---------------------------------------------------------------------------

const entryOf = (db: { codes: { code: string }[] }, code: string) =>
  db.codes.find((entry) => entry.code === code) as Record<string, unknown> | undefined;
const errorsOf = (problems: ProfileProblem[]) => problems.filter((p) => p.severity !== 'info');
const noticesOf = (problems: ProfileProblem[]) => problems.filter((p) => p.severity === 'info');

/** The profiles' view of the databases, as the application builds it from the built-in profiles. */
const PROFILE_USE = [
  { codes: 'fanuc', variants: [], machineType: 'mill' },
  { codes: 'fanuc-lathe', variants: [['fanuc-lathe', 'fanuc-lathe-b']], machineType: 'lathe' },
  { codes: 'okuma', variants: [], machineType: 'lathe' },
];

function serviceWithProfiles() {
  return createCodeDbService({
    dialectOf: (id) => id,
    source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
    sources: () => BUILTIN_CODE_DB_JSON,
    warn: () => {},
    profileUse: () => PROFILE_USE,
  });
}

describe('NC-1: a user entry for a built-in code is merged member by member', () => {
  const shopText = file('fanuc-lathe.json', {
    dialect: 'fanuc-lathe',
    version: 1,
    codes: [
      { code: 'G99', label: 'Feed per revolution (shop text)' },
      { code: 'G76', label: 'Threading (shop text)' },
    ],
  });

  it('keeps what a label-only overlay does not mention, under both G-code systems', () => {
    const svc = builtinService();
    expect(svc.reload([shopText])).toEqual([]);
    for (const dialect of ['fanuc-lathe', 'fanuc-lathe-b']) {
      const g76 = entryOf(svc.byId(dialect), 'G76');
      expect(g76).toMatchObject({ label: 'Threading (shop text)', pitchFeed: true, sets: { cycle: 'start' } });
    }
    const g99 = entryOf(svc.byId('fanuc-lathe'), 'G99');
    expect(g99).toMatchObject({ label: 'Feed per revolution (shop text)', sets: { feedUnit: 'per-rev' } });
    // B keeps its own G99 (a built-in child replaces whole, AD-17).
    expect(entryOf(svc.byId('fanuc-lathe-b'), 'G99')).toEqual(entryOf(builtinService().byId('fanuc-lathe-b'), 'G99'));
  });

  it('merges an own database\'s entry over its parent\'s, and a later member wins', () => {
    const svc = builtinService();
    const problems = svc.reload([
      file('my-lathe.json', {
        dialect: 'my-lathe',
        extends: 'fanuc-lathe',
        codes: [{ code: 'G99', label: 'Shop' }, { code: 'G76', pitchFeed: false }],
      }),
    ]);
    expect(entryOf(svc.byId('my-lathe'), 'G99')).toMatchObject({ label: 'Shop', sets: { feedUnit: 'per-rev' } });
    // A delta without a label keeps the parent's label, and changes what it says.
    const g76 = entryOf(svc.byId('my-lathe'), 'G76');
    expect(g76?.label).toBe(entryOf(svc.byId('fanuc-lathe'), 'G76')?.label);
    expect(g76?.pitchFeed).toBeUndefined();
    expect(errorsOf(problems)).toEqual([]);
    expect(noticesOf(problems)).toEqual([
      expect.objectContaining({
        origin: 'user',
        file: 'my-lathe.json',
        path: 'codes[1].pitchFeed',
        kind: 'codes',
        severity: 'info',
        message: expect.stringMatching(/^G76: your entry sets pitchFeed to false .*scale feed will scale its F/),
      }),
    ]);
  });

  it('replaces the entry whole with "replace": true and names every meaning it drops', () => {
    const svc = builtinService();
    const problems = svc.reload([
      file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'G76', label: 'Mine', replace: true }] }),
    ]);
    expect(entryOf(svc.byId('fanuc-lathe'), 'G76')).toEqual({ code: 'G76', label: 'Mine' });
    expect(errorsOf(problems)).toEqual([]);
    const paths = noticesOf(problems).map((p) => p.path);
    expect(paths).toContain('codes[0].pitchFeed');
    expect(paths).toContain('codes[0].sets.cycle');
    expect(noticesOf(problems).find((p) => p.path === 'codes[0].pitchFeed')?.message).toMatch(
      /^G76: "replace": true drops pitchFeed \(the built-in fanuc-lathe has true\)/,
    );
  });

  it('reports a replace that is not true or false, and a label-less entry with nothing to lay itself over', () => {
    const svc = builtinService();
    const problems = svc.reload([
      file('fanuc-lathe.json', {
        dialect: 'fanuc-lathe',
        codes: [
          { code: 'M13', label: 'Shop' },
          { code: 'G76', label: 'Mine', replace: 'yes' },
          { code: 'M777' },
        ],
      }),
    ]);
    expect(errorsOf(problems).map((p) => [p.file, p.path])).toEqual([
      ['fanuc-lathe.json', 'codes[1].replace'],
      ['fanuc-lathe.json', 'codes[2].label'],
    ]);
    expect(entryOf(svc.byId('fanuc-lathe'), 'G76')).toMatchObject({ label: 'Mine', pitchFeed: true });
    expect(entryOf(svc.byId('fanuc-lathe'), 'M777')).toBeUndefined();
  });

  it('leaves the built-in resolution alone: no user file, the same databases', () => {
    const svc = builtinService();
    svc.reload([]);
    for (const dialect of Object.keys(BUILTIN_CODE_DB_JSON)) {
      expect(svc.byId(dialect)).toEqual(builtinService().byId(dialect));
    }
  });
});

describe('NC-3: a user database under the other G-code system', () => {
  const systemA = file('my-lathe.json', {
    dialect: 'my-lathe',
    extends: 'fanuc-lathe',
    codes: [
      { code: 'G90', group: 'motion', modal: true, sets: { motion: 'feed' }, label: 'Turning pass (shop)' },
      { code: 'G92', group: 'motion', modal: true, pitchFeed: true, sets: { speedLimit: true, motion: 'feed' }, label: 'Threading pass (shop)' },
      { code: 'M13', label: 'Builder M13' },
      { code: 'G76', label: 'Threading (shop text)' },
    ],
  });

  it('lets system B decide the codes it defines itself, and keeps the rest of the user\'s', () => {
    const svc = serviceWithProfiles();
    const problems = svc.reload([systemA]);
    const underB = svc.over('my-lathe', 'fanuc-lathe-b');
    const b = svc.byId('fanuc-lathe-b');
    expect(entryOf(underB, 'G90')).toEqual(entryOf(b, 'G90'));
    expect(entryOf(underB, 'G90')?.sets).toMatchObject({ distance: 'absolute' });
    expect(entryOf(underB, 'G92')).toEqual(entryOf(b, 'G92'));
    expect(entryOf(underB, 'G92')?.pitchFeed).toBeUndefined();
    expect(labelOf(underB, 'M13')).toBe('Builder M13');
    // G76 is alike in both systems: the user's text stays, with the built-in's meaning.
    expect(entryOf(underB, 'G76')).toMatchObject({ label: 'Threading (shop text)', pitchFeed: true });
    // Under its own system nothing is left out.
    expect(labelOf(svc.over('my-lathe', 'fanuc-lathe'), 'G90')).toBe('Turning pass (shop)');
    const notices = noticesOf(problems).filter((p) => /not used under/.test(p.message));
    expect(notices.map((p) => [p.file, p.path])).toEqual([
      ['my-lathe.json', 'codes[0]'],
      ['my-lathe.json', 'codes[1]'],
    ]);
    expect(notices[0].message).toMatch(/^G90: not used under "fanuc-lathe-b", which defines G90 itself/);
  });

  it('follows the variant upward as well: a system-B file keeps its entries under system A', () => {
    const svc = serviceWithProfiles();
    svc.reload([file('my-lathe-b.json', { dialect: 'my-lathe-b', extends: 'fanuc-lathe-b', codes: [{ code: 'M13', label: 'Builder M13' }] })]);
    const underA = svc.over('my-lathe-b', 'fanuc-lathe');
    expect(labelOf(underA, 'M13')).toBe('Builder M13');
    expect(underA.dialect).toBe('my-lathe-b');
    expect(labelOf(underA, 'G95')).toBe(labelOf(svc.byId('fanuc-lathe'), 'G95'));
  });
});

describe('NC-6: an overlay of the mill database reaches the lathe databases', () => {
  it('says so once, with the databases and the machine type', () => {
    const svc = serviceWithProfiles();
    const problems = svc.reload([file('fanuc.json', { dialect: 'fanuc', codes: [{ code: 'M13', label: 'Spindle CW and coolant (mill builder)' }] })]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Spindle CW and coolant (mill builder)');
    expect(noticesOf(problems)).toEqual([
      expect.objectContaining({
        file: 'fanuc.json',
        path: '',
        severity: 'info',
        message: expect.stringMatching(/also reaches "fanuc-lathe", "fanuc-lathe-b", which lathe profiles read/),
      }),
    ]);
  });

  it('says nothing for an overlay that stays within one machine type', () => {
    const svc = serviceWithProfiles();
    const problems = svc.reload([file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }] })]);
    expect(problems).toEqual([]);
  });
});

describe('CODE-2: a reload that fails keeps the databases in force', () => {
  const deep = (levels: number): string => `${'['.repeat(levels)}${']'.repeat(levels)}`;

  it('refuses a file nested 8,000 levels deep, by name, and keeps the built-ins', () => {
    const svc = builtinService();
    const problems = svc.reload([{ name: 'fanuc.json', text: `{"dialect":"fanuc","version":1,"codes":[],"zzz":${deep(8000)}}` }]);
    expect(problems).toEqual([expect.objectContaining({ file: 'fanuc.json', path: '', message: expect.stringMatching(/nested more than 64 levels/) })]);
    expect(svc.byId('fanuc').codes.length).toBe(builtinService().byId('fanuc').codes.length);
    expect(svc.byId('fanuc-lathe').codes.length).toBeGreaterThan(50);
  });

  it('keeps the state of the last good load when the reload itself throws', () => {
    let broken = false;
    const svc = createCodeDbService({
      dialectOf: (id) => id,
      source: (dialect) => BUILTIN_CODE_DB_JSON[dialect],
      sources: () => {
        if (broken) throw new Error('boom');
        return BUILTIN_CODE_DB_JSON;
      },
      warn: () => {},
    });
    expect(svc.reload([file('fanuc-lathe.json', { dialect: 'fanuc-lathe', codes: [{ code: 'M13', label: 'Chuck clamp (shop)' }] })])).toEqual([]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Chuck clamp (shop)');
    broken = true;
    const problems = svc.reload([]);
    broken = false;
    expect(problems).toEqual([expect.objectContaining({ kind: 'codes', message: expect.stringMatching(/stay in force: boom/) })]);
    expect(labelOf(svc.byId('fanuc-lathe'), 'M13')).toBe('Chuck clamp (shop)');
    expect(Object.keys(svc.files())).toContain('fanuc-lathe@base');
  });
});

describe('CODE-13: a database id is an own member, never an inherited one', () => {
  it('answers with an empty database for constructor and friends', () => {
    for (const id of ['constructor', 'toString', 'hasOwnProperty']) {
      expect(service.byId(id).codes).toEqual([]);
      expect(builtinService().byId(id).codes).toEqual([]);
    }
  });
});
