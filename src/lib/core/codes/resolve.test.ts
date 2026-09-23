// Code-database inheritance (plan §7.2, AD-17). Written with `resolve.ts` by the M6
// prelude (P6); WP6.1 owns both from Wave A on.

import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { modalGroupsOf, resolveCodeDbFiles, resolveCodeDbs } from './resolve';
import type { CodeDbProblem } from './load';

const PARENT = {
  dialect: 'parent',
  version: 1,
  addresses: { X: { label: 'X axis' }, F: { label: 'Feed' } },
  codes: [
    { code: 'G0', group: 'motion', modal: true, label: 'Rapid' },
    { code: 'G81', group: 'cycle', modal: true, label: 'Drilling cycle' },
    { code: 'G98', group: 'cyclereturn', modal: true, label: 'Return to the initial level' },
  ],
};

function problemsOf(files: Record<string, unknown>): string[] {
  const out: string[] = [];
  resolveCodeDbFiles(files, (dialect, problem: CodeDbProblem) => out.push(`${dialect}: ${problem.message}`));
  return out;
}

describe('resolveCodeDbFiles', () => {
  it('replaces a parent entry whole, never field by field', () => {
    const files = {
      parent: PARENT,
      kid: {
        dialect: 'kid',
        version: 1,
        extends: 'parent',
        codes: [{ code: 'G98', group: 'feedmode', modal: true, label: 'Feed per minute', sets: { feedUnit: 'per-minute' } }],
      },
    };
    const merged = resolveCodeDbFiles(files).kid;
    const g98 = (merged.codes as Record<string, unknown>[]).find((entry) => entry.code === 'G98');
    // The parent said `cyclereturn`; nothing of it may survive under the child's label.
    expect(g98).toEqual({
      code: 'G98',
      group: 'feedmode',
      modal: true,
      label: 'Feed per minute',
      sets: { feedUnit: 'per-minute' },
    });
  });

  it('keeps the parent order and appends what the child adds', () => {
    const files = {
      parent: PARENT,
      kid: { dialect: 'kid', version: 1, extends: 'parent', codes: [{ code: 'G99', label: 'New' }] },
    };
    const merged = resolveCodeDbFiles(files).kid;
    expect((merged.codes as { code: string }[]).map((entry) => entry.code)).toEqual(['G0', 'G81', 'G98', 'G99']);
  });

  it('drops a parent code the child removes, whatever the zero padding', () => {
    const files = {
      parent: PARENT,
      kid: { dialect: 'kid', version: 1, extends: 'parent', remove: ['G081'], codes: [] },
    };
    const merged = resolveCodeDbFiles(files).kid;
    expect((merged.codes as { code: string }[]).map((entry) => entry.code)).toEqual(['G0', 'G98']);
  });

  it('overrides an address by letter and keeps the rest', () => {
    const files = {
      parent: PARENT,
      kid: {
        dialect: 'kid',
        version: 1,
        extends: 'parent',
        addresses: { X: { label: 'Diameter' } },
        codes: [],
      },
    };
    const merged = resolveCodeDbFiles(files).kid;
    expect(merged.addresses).toEqual({ X: { label: 'Diameter' }, F: { label: 'Feed' } });
  });

  it('keeps the child its own dialect id and consumes extends and remove', () => {
    const files = { parent: PARENT, kid: { dialect: 'wrong', version: 1, extends: 'parent', codes: [] } };
    const merged = resolveCodeDbFiles(files).kid;
    expect(merged.dialect).toBe('kid');
    expect(merged.extends).toBeUndefined();
    expect(merged.remove).toBeUndefined();
  });

  it('resolves a grandchild through its parent', () => {
    const files = {
      parent: PARENT,
      kid: { dialect: 'kid', version: 1, extends: 'parent', codes: [{ code: 'G81', label: 'Kid drill' }] },
      grandkid: { dialect: 'grandkid', version: 1, extends: 'kid', codes: [{ code: 'G0', label: 'Grandkid rapid' }] },
    };
    const merged = resolveCodeDbFiles(files).grandkid;
    const byCode = new Map((merged.codes as { code: string; label: string }[]).map((e) => [e.code, e.label]));
    expect(byCode.get('G0')).toBe('Grandkid rapid');
    expect(byCode.get('G81')).toBe('Kid drill');
    expect(byCode.get('G98')).toBe('Return to the initial level');
  });

  it('reports an unknown parent, a cycle and a file that is not an object', () => {
    expect(problemsOf({ kid: { dialect: 'kid', version: 1, extends: 'nowhere', codes: [] } })[0]).toContain(
      'was not found',
    );
    expect(
      problemsOf({
        a: { dialect: 'a', version: 1, extends: 'b', codes: [] },
        b: { dialect: 'b', version: 1, extends: 'a', codes: [] },
      }).some((message) => message.includes('extends itself')),
    ).toBe(true);
    expect(problemsOf({ bad: 42 })[0]).toContain('not an object');
  });

  it('leaves a database without a parent exactly as it was', () => {
    const merged = resolveCodeDbFiles({ parent: PARENT }).parent;
    expect(merged).toEqual({ ...PARENT });
  });
});

describe('a database member called __proto__', () => {
  it('never becomes the merged object\'s prototype', () => {
    // The twin of the same guard in `profiles/resolve.ts` (G8 M6): `JSON.parse` makes it
    // an own member, and writing it into a plain object runs the prototype setter.
    const files = {
      parent: PARENT,
      kid: JSON.parse(
        '{"dialect": "kid", "version": 1, "extends": "parent", "__proto__": {"codes": [{"code": "G0"}]}, "codes": []}',
      ),
    };
    const merged = resolveCodeDbFiles(files).kid;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(false);
    // The parent's own codes are still there, so the merge itself did its work.
    expect((merged.codes as Record<string, unknown>[]).map((entry) => entry.code)).toEqual(['G0', 'G81', 'G98']);
  });
});

describe('resolveCodeDbs', () => {
  it('loads every shipped database without a problem', () => {
    const problems: string[] = [];
    const dbs = resolveCodeDbs(BUILTIN_CODE_DB_JSON, (dialect, problem) =>
      problems.push(`${dialect}: ${problem.path}: ${problem.message}`),
    );
    expect(problems).toEqual([]);
    expect(Object.keys(dbs).sort()).toEqual(['fanuc', 'fanuc-lathe', 'fanuc-lathe-b', 'heidenhain']);
  });

  it('gives the lathe databases the mill entries their files do not repeat', () => {
    const dbs = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
    const lathe = dbs['fanuc-lathe'];
    const mill = dbs.fanuc;
    // M6/WP6.2: the lathe file itself lists 29 entries and `remove`s 10 mill ones, and
    // everything it says nothing about — the macro keywords, the M-codes, the work
    // offsets, `G0`–`G3` — comes from the mill database unchanged. Counting proves that
    // the merge happened; `G0` proves it is the parent's entry and not a copy.
    expect(lathe.codes.length).toBeGreaterThan(mill.codes.length / 2);
    expect(lathe.codes.find((e) => e.code === 'G0')?.label).toBe(mill.codes.find((e) => e.code === 'G0')?.label);
    expect(lathe.codes.find((e) => e.code === 'MOD')?.group).toBe('macro');
    // An address the lathe file does not mention is the mill's; one it does mention wins.
    expect(lathe.addresses.N?.label).toBe(mill.addresses.N?.label);
    expect(lathe.addresses.X?.label).not.toBe(mill.addresses.X?.label);
  });

  it('reads G98 and G99 as the feed modes of G-code system A, and B puts them back', () => {
    const dbs = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
    const groupOf = (dialect: string, code: string): string | undefined =>
      dbs[dialect].codes.find((entry) => entry.code === code)?.group;
    // syntax-fanuc.md §4.1: system A numbers the feed modes G98/G99 and has no G94/G95
    // feed mode; system B numbers them as a mill does and uses G98/G99 for the cycle
    // return level. Which of the two a document reads is a machine setting (AD-31).
    expect(groupOf('fanuc', 'G98')).toBe('cyclereturn');
    expect(groupOf('fanuc-lathe', 'G98')).toBe('feedmode');
    expect(groupOf('fanuc-lathe', 'G99')).toBe('feedmode');
    expect(groupOf('fanuc-lathe-b', 'G98')).toBe('cyclereturn');
    expect(groupOf('fanuc-lathe-b', 'G94')).toBe('feedmode');
  });
});

describe('aliases after the merge', () => {
  // The clash can only be seen on the result: neither file is wrong by itself, and the
  // child is the one that means it — so the parent's entry keeps the code and loses the
  // alias, with a problem that names both.
  it('are re-checked, so a child may take an alias the parent gave away', () => {
    const files = {
      parent: {
        dialect: 'parent',
        version: 1,
        codes: [
          { code: 'G1', label: 'Line', aliases: ['G01', 'G1.1'] },
          { code: 'G2', label: 'Arc' },
        ],
      },
      kid: {
        dialect: 'kid',
        version: 1,
        extends: 'parent',
        codes: [{ code: 'G2', label: 'Arc, clockwise', aliases: ['G1.1'] }],
      },
    };
    const problems: string[] = [];
    const dbs = resolveCodeDbs(files, (dialect, problem) => problems.push(`${dialect}: ${problem.message}`));

    // `G01` is `G1` normalized, which is the entry's own code, so only `G1.1` is an alias.
    expect(dbs.parent.codes.map((entry) => entry.aliases)).toEqual([['G1.1'], undefined]);
    // `G1` was loaded first, so it keeps `G1.1` and the child's entry loses it.
    expect(dbs.kid.codes.map((entry) => entry.aliases)).toEqual([['G1.1'], undefined]);
    expect(problems).toEqual(['kid: alias G1.1 of G2 is already defined by codes[0]']);
  });
});

describe('modalGroupsOf', () => {
  it('collects the modal groups of a dialect and of the ones it extends', () => {
    const groups = modalGroupsOf(BUILTIN_CODE_DB_JSON as Record<string, unknown>, 'fanuc-lathe');
    // Its own file only writes the feed and spindle modes; the rest is the mill's.
    expect(groups).toEqual(expect.arrayContaining(['feedmode', 'spindlemode', 'plane', 'motion', 'distance']));
    expect(groups).not.toContain(undefined);
    // A non-modal entry's group is not a modal group, and neither is a missing dialect.
    expect(groups).not.toContain('nonmodal');
    expect(modalGroupsOf(BUILTIN_CODE_DB_JSON as Record<string, unknown>, 'okuma')).toEqual([]);
  });

  it('stops at a cycle instead of looping', () => {
    const files = {
      a: { dialect: 'a', extends: 'b', codes: [{ code: 'G1', group: 'motion', modal: true, label: 'Line' }] },
      b: { dialect: 'b', extends: 'a', codes: [{ code: 'G17', group: 'plane', modal: true, label: 'XY' }] },
    };
    expect(modalGroupsOf(files, 'a').sort()).toEqual(['motion', 'plane']);
  });
});
