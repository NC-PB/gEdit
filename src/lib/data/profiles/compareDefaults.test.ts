// The review-mode defaults of every built-in profile (plan §8.11, the G10 table; AD-26,
// §7.7). Written by the M11 prelude (P11). A change to any value here is a change of what a
// comparison hides by default, so it goes through the NC review and §8.11 first.
//
// The one rule behind the table: **review mode never hides a difference the machine would
// see.** So a toggle is on by default only where the control reads both spellings alike:
//   - block numbers, blanks and the number format are safe on every dialect by
//     construction (referenced numbers and the decimal point are kept, `core/compare`);
//   - comments go everywhere, except the comments a control reads (`keepComments`);
//   - case only on Sinumerik, the one control that does not tell case apart in code (its
//     tool names are strings, which keep their case). The Fanuc code table has no lower
//     case and drops it on input; Okuma and Klartext leave it open (verify).

import { describe, expect, it } from 'vitest';
import { compareDefaults, COMPARE_FALLBACK, COMPARE_OPTION_KEYS, type CompareOptions } from '$lib/core/compare';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { Profile } from '$lib/core/profiles/types';
import { BUILTIN_PROFILE_JSON } from './index';

function resolved(id: string): Profile {
  const raw = BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id);
  const result = validateProfile(raw);
  if (!result.ok) throw new Error(`${id}: ${result.errors.join('; ')}`);
  return result.profile;
}

const ON = true;
const OFF = false;

/** §8.11: profile → [block numbers, whitespace, comments, case, number format]. */
const GOLDEN: Record<string, [boolean, boolean, boolean, boolean, boolean]> = {
  'fanuc-gcode': [ON, ON, ON, OFF, ON],
  'fanuc-lathe': [ON, ON, ON, OFF, ON], // inherited from fanuc-gcode
  'heidenhain-klartext': [ON, ON, ON, OFF, ON],
  'okuma-osp': [ON, ON, ON, OFF, ON],
  sinumerik: [ON, ON, ON, ON, ON],
  'sinumerik-mill': [ON, ON, ON, ON, ON], // inherited from sinumerik
};

/** §8.11: the comments each profile keeps under `ignoreComments`, as written. */
const KEEP: Record<string, string[] | undefined> = {
  'fanuc-gcode': ['^\\s*(?:[O:]\\d+|<[^>]*>)', '#\\s*30(?:00|06)\\s*=', '\\([^)]*%'],
  'fanuc-lathe': ['^\\s*(?:[O:]\\d+|<[^>]*>)', '#\\s*30(?:00|06)\\s*=', '\\([^)]*%'],
  'heidenhain-klartext': undefined,
  // Review NC-7: `MSG (…)` and `G215 (…)` show their text to the operator.
  'okuma-osp': ['\\([^)]*%', '(?<![A-Z])(?:MSG|G0*215)(?![A-Z0-9])'],
  sinumerik: ['^\\s*;\\s*\\$PATH\\s*=', ';.*\\*(?:RO|HD)\\*'],
  'sinumerik-mill': ['^\\s*;\\s*\\$PATH\\s*=', ';.*\\*(?:RO|HD)\\*'],
};

/** Lines whose comments a profile keeps, and lines whose comments go. */
const KEEP_CASES: Record<string, { kept: string[]; dropped: string[] }> = {
  'fanuc-gcode': {
    kept: ['O1001 (BRACKET OP1)', ':1001 (BRACKET)', '<SHAFT_T12> (SHAFT)', '#3006=1 (CHECK INSERT)', '#3000 = 1 (TOOL BROKEN)', 'G1 X10. (FEED 100%)'],
    dropped: ['(T1 FACE MILL D50)', 'G1 X10. F500 (ROUGH)', 'N100 (LOOP TOP)', '#100=1 (COUNTER)', 'M98 P1001 (CALL O1001)'],
  },
  'fanuc-lathe': {
    kept: ['O2001 (PIN D30)', '#3006=1 (TURN PART)'],
    dropped: ['T0101 (OD ROUGH)', 'G00 X100. Z100. T0100 (RETRACT)'],
  },
  'okuma-osp': {
    kept: ['G00 X100 (100% RAPID)', 'MSG (CHECK INSERT)', 'N10 MSG(TOOL 5)', 'G215 (CHANGE INSERT)', 'G0215 (A)'],
    dropped: ['N2 (CENTER DRILL)', '(OP10)', 'O1234', 'NMSG (A)', 'G1 X1 (A)', 'G2150 (A)', 'MSGX (A)'],
  },
  sinumerik: {
    kept: [';$PATH=/_N_WKS_DIR/_N_PART_WPD', '  ; $PATH = /_N_MPF_DIR', ';*RO*', 'CYCLE81(10,0,2,-12) ;*HD*'],
    dropped: ['; ROUGHING', 'N10 G0 X100 ; RAPID', 'MSG("100%") ; MESSAGE'],
  },
};

describe('the review-mode defaults of the built-in profiles (§8.11)', () => {
  it('cover every built-in profile, and only those', () => {
    const ids = BUILTIN_PROFILE_JSON.map((p) => (p as { id: string }).id).sort();
    expect(Object.keys(GOLDEN).sort()).toEqual(ids);
  });

  it.each(Object.entries(GOLDEN))('%s', (id, row) => {
    const profile = resolved(id);
    const expected = Object.fromEntries(COMPARE_OPTION_KEYS.map((key, i) => [key, row[i]])) as unknown as CompareOptions;
    expect(compareDefaults(profile)).toEqual(expected);
    // Every toggle is written down (or inherited), so no built-in leans on the fallback.
    for (const key of COMPARE_OPTION_KEYS) expect(typeof profile.compare?.[key], `${id} ${key}`).toBe('boolean');
    expect(profile.compare?.keepComments).toEqual(KEEP[id]);
    // The tolerance was cut (§2.1, D41); no built-in carries it any more.
    expect(profile.compare && 'tolerance' in profile.compare).toBe(false);
  });

  it.each(Object.entries(KEEP_CASES))('%s keeps the comments its control reads, and no others', (id, cases) => {
    const cp = compileProfile(resolved(id));
    const patterns = (cp.profile.compare?.keepComments ?? []).map((source) => new RegExp(source, cp.flags));
    const keeps = (line: string): boolean => patterns.some((re) => re.test(line));
    for (const line of cases.kept) expect(keeps(line), line).toBe(true);
    for (const line of cases.dropped) expect(keeps(line), line).toBe(false);
  });
});

describe('compareDefaults and the validator', () => {
  const base = resolved('fanuc-gcode');

  it('falls back member by member, and ignores a carried tolerance', () => {
    expect(compareDefaults({ ...base, compare: undefined })).toEqual(COMPARE_FALLBACK);
    expect(compareDefaults({ ...base, compare: { ignoreCase: true, tolerance: 0.01 } })).toEqual({
      ...COMPARE_FALLBACK,
      ignoreCase: true,
    });
    // A member of the wrong type is the fallback's; the validator reports it.
    expect(compareDefaults({ ...base, compare: { ignoreComments: 'yes' } as never })).toEqual(COMPARE_FALLBACK);
  });

  it('accepts a profile that still carries a tolerance, whatever its value', () => {
    for (const tolerance of [0, 0.005, 'x', null]) {
      const result = validateProfile({ ...base, compare: { ignoreCase: true, tolerance } });
      expect(result.ok ? [] : result.errors, String(tolerance)).toEqual([]);
    }
  });

  it('reports a toggle that is not true or false and a keep pattern that is not one', () => {
    const result = validateProfile({
      ...base,
      compare: { ignoreBlockNumbers: 1, keepComments: ['(unclosed', 42] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.split(':')[0])).toEqual([
      'compare.ignoreBlockNumbers',
      'compare.keepComments[0]',
      'compare.keepComments[1]',
    ]);
    expect(validateProfile({ ...base, compare: { keepComments: '%' } }).ok).toBe(false);
    expect(validateProfile({ ...base, compare: [] }).ok).toBe(false);
  });
});
