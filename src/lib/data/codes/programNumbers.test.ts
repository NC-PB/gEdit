// Which parameters name a program (plan §7.6, §7.16 #136; the "O-number references in
// search" leftover of TODO). Written by the M11 prelude (P11); WP11.1's search reads the
// flag, so a search for `O2000` finds `M98 P2000`, `M98 P52000` (five times O2000) and
// `G65 P2000` too. Held in both directions: every flagged parameter of every resolved
// database is listed here, and nothing else carries the flag.
//
// Only the Fanuc family numbers its programs: Okuma calls a program by its `O` name after
// `CALL` (compared as text), Sinumerik and Klartext call programs by name.

import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { resolveCodeDbs } from '$lib/core/codes/resolve';

const LOADED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);

const FANUC = [
  ['G65', 'P', 'plain'],
  ['G66', 'P', 'plain'],
  ['G66.1', 'P', 'plain'],
  ['M98', 'P', 'packed'],
  // M11 review NC-12: the external call names a program as well (syntax-fanuc.md §7.1).
  ['M198', 'P', 'plain'],
];

const EXPECTED: Record<string, string[][]> = {
  fanuc: FANUC,
  'fanuc-lathe': FANUC,
  'fanuc-lathe-b': FANUC,
  heidenhain: [],
  okuma: [],
  sinumerik: [],
};

describe('the parameters that name a program (CodeParam.programNumber)', () => {
  it('lists every database', () => {
    expect(Object.keys(LOADED).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s', (dialect, rows) => {
    const found = LOADED[dialect].codes.flatMap((entry) =>
      (entry.params ?? [])
        .filter((param) => param.programNumber !== undefined)
        .map((param) => [entry.code, param.address, param.programNumber as string]),
    );
    expect(found).toEqual(rows);
  });

  it('is read by the loader, and an unknown value is dropped and reported', () => {
    const problems: CodeDbProblem[] = [];
    const db = loadCodeDb(
      {
        dialect: 'x',
        version: 1,
        codes: [
          { code: 'M98', label: 'Call', params: [{ address: 'P', label: 'Program', programNumber: 'packed' }] },
          { code: 'G65', label: 'Macro', params: [{ address: 'P', label: 'Program', programNumber: 'name' }] },
        ],
      },
      (p) => problems.push(p),
    );
    expect(db.codes[0].params?.[0].programNumber).toBe('packed');
    expect(db.codes[1].params?.[0].programNumber).toBeUndefined();
    expect(problems.map((p) => p.path)).toEqual(['codes[1].params[0].programNumber']);
  });
});
