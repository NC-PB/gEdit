// What the shipped code databases say about absolute positions in cycle parameters (plan
// §6 M10 P10 item 1, roadmap R8 accepted 2026-10-01, §7.2 `CodeParam.position`, §7.16 #106;
// gate G10). Written by the M10 prelude.
//
// Address arithmetic (WP10.4) shifts a program on the tool axis. The axis words move by the
// ordinary rule; a cycle parameter moves only where the database gives it the role
// `'tool-axis'` (an absolute coordinate on the tool axis), and a cycle that holds any
// absolute position the role does not cover is refused and listed, never shifted in part.
// A role that goes missing would leave a hole depth where it was while the rest of the
// program moves — a scrapped part — so the roles are a golden, held in both directions:
//
//   - `tests/fixtures/codes/positions.json` lists every entry with a role, its parameters
//     in order and the role each declares (`null`: not reviewed). The shipped files have to
//     equal it; `tests/python/test_code_positions.py` holds `gedit_nc.position_of` to it.
//   - the decisions that are not obvious from a list are sentences below.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { lookupCode, positionOf } from '$lib/core/codes/lookup';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import type { CodeDb, CodeEntry, CodeParam } from '$lib/core/codes/types';
import { FIXTURES_DIR } from '../../../../tests/unit/helpers/fixtures';

type Role = ReturnType<typeof positionOf>;
interface Row {
  code: string;
  params: [string, Role][];
}

const GOLDEN = JSON.parse(readFileSync(join(FIXTURES_DIR, 'codes', 'positions.json'), 'utf8')) as {
  databases: Record<string, Row[]>;
};
const OWN = BUILTIN_CODE_DB_JSON as Record<string, { codes: CodeEntry[] }>;
const LOADED: Record<string, CodeDb> = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
const DIALECTS = Object.keys(OWN);

const rowsOf = (dialect: string): Row[] =>
  OWN[dialect].codes
    .filter((e) => (e.params ?? []).some((p) => p.position !== undefined))
    .map((e) => ({ code: e.code, params: (e.params ?? []).map((p): [string, Role] => [p.address, p.position ?? null]) }));

const loaded = (dialect: string, code: string): CodeEntry => {
  const entry = lookupCode(LOADED[dialect], code);
  if (!entry) throw new Error(`no entry ${code} in ${dialect}`);
  return entry;
};
const rolesOf = (dialect: string, code: string): Record<string, Role> =>
  Object.fromEntries((loaded(dialect, code).params ?? []).map((p: CodeParam) => [p.address, positionOf(p)]));
const withRole = (dialect: string, role: Role): string[] =>
  rowsOf(dialect).flatMap((row) => row.params.filter(([, r]) => r === role).map(([a]) => `${row.code} ${a}`));

describe('the R8 roles of the shipped databases', () => {
  it('has one list per database file', () => {
    expect(Object.keys(GOLDEN.databases).sort()).toEqual([...DIALECTS].sort());
  });

  it.each(DIALECTS)('%s declares exactly the roles the golden lists, in file order', (dialect) => {
    expect(rowsOf(dialect)).toEqual(GOLDEN.databases[dialect]);
  });

  it.each(DIALECTS)('%s: the reader gives the roles the golden lists, through the loader', (dialect) => {
    for (const row of GOLDEN.databases[dialect]) {
      expect(Object.entries(rolesOf(dialect, row.code)), `${dialect} ${row.code}`).toEqual(row.params);
    }
  });
});

describe('what the roles decide (the reasons are in the G10 table, plan §8.7)', () => {
  it('Fanuc mill: R is the one tool-axis position of every drilling cycle, and the axis words carry no role', () => {
    // X, Y and Z are axis words and move as axis words; under G91 the whole block is
    // incremental and address arithmetic skips it, so R is absolute wherever it is judged.
    const drilling = ['G73', 'G74', 'G76', 'G81', 'G82', 'G83', 'G84', 'G84.2', 'G84.3', 'G85', 'G86', 'G87', 'G88', 'G89'];
    expect(GOLDEN.databases.fanuc.map((row) => row.code)).toEqual(drilling);
    expect(withRole('fanuc', 'tool-axis')).toEqual(drilling.map((code) => `${code} R`));
    for (const row of GOLDEN.databases.fanuc) {
      for (const [address, role] of row.params) {
        expect(role, `${row.code} ${address}`).toBe(['X', 'Y', 'Z'].includes(address) ? null : role ?? 'missing');
      }
    }
  });

  it('Fanuc lathe: no role at all, its own or inherited — R of a lathe drilling cycle is a machine parameter', () => {
    // On a lathe in G-code system A, whether R is a distance from the initial level or a
    // position is a parameter of the control; nothing here is certain, so every lathe
    // cycle is refused and listed. The lathe replaces or removes every mill drilling cycle.
    for (const dialect of ['fanuc-lathe', 'fanuc-lathe-b', 'okuma']) {
      expect(GOLDEN.databases[dialect], dialect).toEqual([]);
      const inherited = LOADED[dialect].codes.filter((e) => (e.params ?? []).some((p) => positionOf(p) !== null));
      expect(inherited.map((e) => e.code), dialect).toEqual([]);
    }
  });

  it('Klartext: Q203 is the one tool-axis position, every depth and clearance is measured from it', () => {
    // P10 added 202 (boring), 208 (bore milling) and 262 (thread milling), §7.16 #110.
    const cycles = ['200', '201', '202', '203', '205', '206', '207', '208', '209', '240', '262'];
    expect(withRole('heidenhain', 'tool-axis')).toEqual(cycles.map((n) => `CYCL DEF ${n} Q203`));
    for (const n of cycles) {
      const roles = rolesOf('heidenhain', `CYCL DEF ${n}`);
      expect(roles.Q201, n).toBe('none');
      expect(roles.Q204, n).toBe('none');
      expect(Object.values(roles), `${n}: every parameter reviewed`).not.toContain(null);
    }
  });

  it('Klartext: a call at a position or at a pattern holds positions the role does not cover', () => {
    // The tool-axis coordinate of CYCL CALL POS works like an extra datum shift on top of
    // the cycle's own Q203 (and a start point the cycle defines adds to its X and Y), so
    // moving both would move the hole twice; the points of a pattern are outside the block.
    for (const code of ['CYCL CALL POS', 'CYCL CALL PAT']) {
      expect(rolesOf('heidenhain', code), code).toEqual({ X: 'other', Y: 'other', Z: 'other' });
    }
    // A call at the current position, M99 and M89 run the defined cycle where the tool is.
    for (const code of ['CYCL CALL', 'M99', 'M89']) expect(loaded('heidenhain', code).params, code).toBeUndefined();
    // A cycle the database lacks falls to the generic entry, which no one reviewed.
    expect(loaded('heidenhain', 'CYCL DEF').params).toBeUndefined();
  });

  it('Sinumerik: RTP, RFP, DP and FDEP are the tool-axis positions; the mode arguments refuse when set', () => {
    const drilling = ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89'];
    for (const code of drilling) {
      const roles = rolesOf('sinumerik', code);
      expect([roles.RTP, roles.RFP, roles.DP, roles.SDIS, roles.DPR], code).toEqual(['tool-axis', 'tool-axis', 'tool-axis', 'none', 'none']);
      expect(Object.values(roles), `${code}: every parameter reviewed`).not.toContain(null);
    }
    expect(withRole('sinumerik', 'tool-axis').filter((p) => !/ (RTP|RFP|DP)$/.test(p))).toEqual(['CYCLE83 FDEP']);
    // The drilling axis, the plane and whether the depth is absolute can each be chosen by a
    // mode argument; anything but 0 there is a reading the role does not describe.
    for (const code of ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE85']) {
      expect([rolesOf('sinumerik', code)._GMODE, rolesOf('sinumerik', code)._DMODE, rolesOf('sinumerik', code)._AMODE], code)
        .toEqual(['mode', 'mode', 'mode']);
    }
    for (const code of ['CYCLE83', 'CYCLE84', 'CYCLE840']) expect(rolesOf('sinumerik', code)._AXN, code).toBe('mode');
    // CYCLE86's _GMODE only says whether the tool lifts off the wall.
    expect(rolesOf('sinumerik', 'CYCLE86')._GMODE).toBe('none');
  });

  it('Sinumerik: the swivel points of CYCLE800 are positions the role does not cover', () => {
    // The point before the rotation may be in the previous swivel (_ST ones digit 1), and
    // the one after it is in the rotated frame: neither is a coordinate of the program's
    // own tool axis. CYCLE800 opens a frame as well, so its block is refused either way.
    const roles = rolesOf('sinumerik', 'CYCLE800');
    expect(['_X0', '_Y0', '_Z0', '_X1', '_Y1', '_Z1'].map((a) => roles[a])).toEqual(Array(6).fill('other'));
    expect([roles._ST, roles._MODE, roles._DMODE]).toEqual(['mode', 'mode', 'mode']);
  });

  it('gives no unit to a position: what a cycle position is worth is the address reading, untouched', () => {
    for (const dialect of DIALECTS) {
      for (const entry of OWN[dialect].codes) {
        for (const p of entry.params ?? []) {
          if (p.position === 'tool-axis' || p.position === 'other') expect(p.unit, `${dialect} ${entry.code} ${p.address}`).toBeUndefined();
        }
      }
    }
  });
});
