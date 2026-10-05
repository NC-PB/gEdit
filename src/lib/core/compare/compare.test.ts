// Compare normalization and the unified diff (plan §6 M11 WP11.2, §7.7, AD-26).
//
// The one rule every case below checks from one side or the other: **review mode never
// hides a difference the machine would see.** Each option is tested alone (what it makes
// equal, and what it must leave apart), then all together per profile, then the decimal
// point under each kind of machine, the comments a control reads, the block numbers a
// jump keeps, the re-post pair of X5 (`tests/fixtures/compare/`), the 100k-line budget
// and the unified-diff goldens. Every line is synthetic, written for gEdit from
// `docs/planning/syntax/`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import type { EffectiveMachine, NumberInput } from '$lib/core/machines/types';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { diffLines } from '$lib/core/transforms/lineDiff';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import {
  COMPARE_NOTE_KEYS,
  COMPARE_OPTION_KEYS,
  compareDefaults,
  normalizeLine,
  normalizeLines,
  pointSignificant,
  prepareNormalize,
  unifiedDiff,
  type CompareOptions,
  type SideMachine,
} from './index';

function profile(id: string): Profile {
  const result = validateProfile(BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === id));
  if (!result.ok) throw new Error(`${id}: ${result.errors.join('; ')}`);
  return result.profile;
}

const PROFILES = {
  fanuc: profile('fanuc-gcode'),
  lathe: profile('fanuc-lathe'),
  klartext: profile('heidenhain-klartext'),
  okuma: profile('okuma-osp'),
  sinumerik: profile('sinumerik'),
  sinumerikMill: profile('sinumerik-mill'),
};
type ProfileKey = keyof typeof PROFILES;

const COMPILED = new Map<string, CompiledProfile>();
function cpOf(key: ProfileKey): CompiledProfile {
  let cp = COMPILED.get(key);
  if (!cp) {
    cp = compileProfile(PROFILES[key]);
    COMPILED.set(key, cp);
  }
  return cp;
}

const NONE: CompareOptions = {
  ignoreBlockNumbers: false,
  ignoreWhitespace: false,
  ignoreComments: false,
  ignoreCase: false,
  ignoreNumberFormat: false,
};
const ALL: CompareOptions = {
  ignoreBlockNumbers: true,
  ignoreWhitespace: true,
  ignoreComments: true,
  ignoreCase: true,
  ignoreNumberFormat: true,
};

/** The normalized lines of a side; `o` is laid over "nothing ignored". */
function norm(key: ProfileKey, lines: string[], o: Partial<CompareOptions> = {}, machine?: SideMachine): string[] {
  const text = normalizeLines(lines, cpOf(key), { ...NONE, ...o }, machine).text;
  return text === '' ? [] : text.split('\n');
}

/** True when the two lines read alike under `o`. */
function same(key: ProfileKey, a: string, b: string, o: Partial<CompareOptions>, machine?: SideMachine): boolean {
  return norm(key, [a], o, machine).join('\n') === norm(key, [b], o, machine).join('\n');
}

/** A machine of `key`'s profile with this number input, through the real effective-machine code. */
function machineWith(key: ProfileKey, numberInput: NumberInput): { cp: CompiledProfile; machine: EffectiveMachine } {
  const p = PROFILES[key];
  const machine = effectiveMachine(
    p,
    { id: 'm1', name: 'Machine 1', profile: p.id, params: { numberInput } },
    'document',
    {},
  );
  return { cp: compileProfile(applyMachine(p, machine).profile), machine };
}

function presetOf(key: ProfileKey, id: string): NumberInput {
  const preset = PROFILES[key].machineParams?.numberInput?.presets.find((entry) => entry.id === id);
  if (!preset) throw new Error(`no preset ${id}`);
  return preset.value as NumberInput;
}

describe('compareDefaults', () => {
  it('reads the profile block over the fallback, toggles only', () => {
    expect(compareDefaults(PROFILES.sinumerik)).toEqual(ALL);
    expect(compareDefaults(PROFILES.fanuc)).toEqual({ ...ALL, ignoreCase: false });
    expect(Object.keys(compareDefaults(PROFILES.fanuc)).sort()).toEqual([...COMPARE_OPTION_KEYS].sort());
  });
});

describe('nothing ignored', () => {
  it('gives the side back as written, every line mapped to itself', () => {
    const lines = ['N10 G01 X+05.500 (A)', '', '  g1  x10.'];
    const result = normalizeLines(lines, cpOf('fanuc'), NONE);
    expect(result.text).toBe(lines.join('\n'));
    expect([...result.lineMap]).toEqual([1, 2, 3]);
    expect(result.notes).toEqual([]);
  });
});

describe('ignoreBlockNumbers alone', () => {
  it('drops N and the blank behind it, whatever the number', () => {
    expect(norm('fanuc', ['N10 G1 X10.', 'N0020G0X0', '/N30 G0 X1', '  N40 Z5.'], { ignoreBlockNumbers: true })).toEqual([
      'G1 X10.',
      'G0X0',
      '/G0 X1',
      '  Z5.',
    ]);
    expect(same('fanuc', 'N10 G1 X10.', 'G1 X10.', { ignoreBlockNumbers: true })).toBe(true);
  });

  it('drops a lone block number with its line, and keeps the map', () => {
    const result = normalizeLines(['G1 X1', 'N100', 'G1 X2'], cpOf('fanuc'), { ...NONE, ignoreBlockNumbers: true });
    expect(result.text).toBe('G1 X1\nG1 X2');
    expect([...result.lineMap]).toEqual([1, 3]);
  });

  it('drops the Sinumerik main block number `:10` and the plain `N`', () => {
    expect(norm('sinumerik', [':10 G0 X10', 'N20 G1 X5'], { ignoreBlockNumbers: true })).toEqual(['G0 X10', 'G1 X5']);
  });

  it('drops the leading Klartext block number, on the first line of a block only', () => {
    const lines = ['5 L X+10 Y+5 R0 FMAX ~', '  M3', '6 CYCL DEF 200 DRILLING'];
    expect(norm('klartext', lines, { ignoreBlockNumbers: true })).toEqual(['L X+10 Y+5 R0 FMAX ~', '  M3', 'CYCL DEF 200 DRILLING']);
    // The numbers are positions: a block inserted above renumbers every block below it.
    expect(norm('klartext', ['7 L Z+50 FMAX'], { ignoreBlockNumbers: true })).toEqual(
      norm('klartext', ['12 L Z+50 FMAX'], { ignoreBlockNumbers: true }),
    );
  });

  it('never drops a label: Okuma `NLAP1`, Sinumerik `LOOP_A:`, Klartext `LBL`', () => {
    expect(norm('okuma', ['NLAP1 G1 X5', 'N10 G0'], { ignoreBlockNumbers: true })).toEqual(['NLAP1 G1 X5', 'G0']);
    expect(norm('sinumerik', ['LOOP_A: G1 X1'], { ignoreBlockNumbers: true })).toEqual(['LOOP_A: G1 X1']);
    expect(norm('klartext', ['17 LBL 1'], { ignoreBlockNumbers: true })).toEqual(['LBL 1']);
  });

  it('keeps a number written against a name on a dialect with names (`N30XNOW=62`)', () => {
    expect(norm('sinumerik', ['N30XNOW=62', 'N40 XNOW=62'], { ignoreBlockNumbers: true })).toEqual(['N30XNOW=62', 'XNOW=62']);
    // A packed Fanuc block has no names to run into.
    expect(norm('fanuc', ['N30X62.'], { ignoreBlockNumbers: true })).toEqual(['X62.']);
  });
});

describe('block numbers a reference points at', () => {
  it('keeps the target of a GOTO, wherever the jump stands', () => {
    const lines = ['N90 #1=#1+1', 'N100 G1 X1', 'N110 IF[#1LT5]GOTO100', 'N120 M30'];
    expect(norm('fanuc', lines, { ignoreBlockNumbers: true })).toEqual([
      '#1=#1+1',
      'N100 G1 X1',
      'IF[#1LT5]GOTO100',
      'M30',
    ]);
    // A jump below its target is found too: the walk reads the whole file first.
    expect(prepareNormalize(lines, cpOf('fanuc')).keepBlockNumbers).toEqual(new Set([100]));
  });

  it('keeps the turning-cycle pair `G70 P100 Q200`', () => {
    const lines = ['N10 G71 U2. R1.', 'N20 G71 P100 Q200 U0.5 W0.1 F0.25', 'N100 G0 X20.', 'N150 G1 Z-20.', 'N200 X40.', 'N210 G70 P100 Q200'];
    expect(norm('lathe', lines, { ignoreBlockNumbers: true })).toEqual([
      'G71 U2. R1.',
      'G71 P100 Q200 U0.5 W0.1 F0.25',
      'N100 G0 X20.',
      'G1 Z-20.',
      'N200 X40.',
      'G70 P100 Q200',
    ]);
  });

  it('keeps an Okuma target by its text: `N0020` is not `N20`', () => {
    const lines = ['N0020 G0 X10.', 'N20 G0 X20.', 'IF [V1 EQ 5] N0020'];
    expect(norm('okuma', lines, { ignoreBlockNumbers: true })).toEqual(['N0020 G0 X10.', 'G0 X20.', 'IF [V1 EQ 5] N0020']);
  });

  it('keeps a Sinumerik `GOTOB N10` target', () => {
    expect(norm('sinumerik', ['N10 R1=R1+1', 'N20 G1 X1', 'GOTOB N10'], { ignoreBlockNumbers: true })).toEqual([
      'N10 R1=R1+1',
      'G1 X1',
      'GOTOB N10',
    ]);
  });

  it('keeps every block number of a file with a computed jump, and says so', () => {
    const lines = ['N10 G1 X1', 'N20 GOTO #1', 'N30 G1 X2'];
    const result = normalizeLines(lines, cpOf('fanuc'), { ...NONE, ignoreBlockNumbers: true });
    expect(result.text).toBe(lines.join('\n'));
    expect(result.notes).toEqual([{ key: COMPARE_NOTE_KEYS.blockNumbers, params: { line: 2 } }]);
    expect(prepareNormalize(lines, cpOf('fanuc')).keepBlockNumbers).toBe('all');
    // Without the option there is nothing to keep and nothing to say.
    expect(normalizeLines(lines, cpOf('fanuc'), NONE).notes).toEqual([]);
  });
});

describe('ignoreWhitespace alone', () => {
  it('trims, collapses runs, drops blank lines', () => {
    const result = normalizeLines(['  G1   X10.\tY5.  ', '', '   ', 'G0 Z5.'], cpOf('fanuc'), {
      ...NONE,
      ignoreWhitespace: true,
    });
    expect(result.text).toBe('G1 X10. Y5.\nG0 Z5.');
    expect([...result.lineMap]).toEqual([1, 4]);
  });

  it('never removes or inserts a blank between two words', () => {
    expect(same('fanuc', 'G1X10.', 'G1 X10.', { ignoreWhitespace: true })).toBe(false);
    expect(same('sinumerik', 'N30XNOW=62', 'N30 XNOW=62', { ignoreWhitespace: true })).toBe(false);
    expect(same('okuma', 'IF[V1EQ5]N20', 'IF [V1 EQ 5] N20', { ignoreWhitespace: true })).toBe(false);
  });

  it('keeps a blank line when whitespace counts', () => {
    expect(norm('fanuc', ['G1', '', 'G0'])).toEqual(['G1', '', 'G0']);
  });

  it('leaves the blanks inside a string alone', () => {
    expect(norm('sinumerik', ['MSG("TOOL  CHANGE")   M0'], { ignoreWhitespace: true })).toEqual(['MSG("TOOL  CHANGE") M0']);
  });
});

describe('ignoreComments alone', () => {
  it('drops a comment-only line and keeps the map intact', () => {
    const lines = ['%', '(T1 FACE MILL D50)', 'N10 G0 X0. (START)', '(ONLY A COMMENT)', 'N20 G1 X10.'];
    const result = normalizeLines(lines, cpOf('fanuc'), { ...NONE, ignoreComments: true });
    expect(result.text).toBe('%\nN10 G0 X0.\nN20 G1 X10.');
    expect([...result.lineMap]).toEqual([1, 3, 5]);
  });

  it('takes one blank with a dropped comment, and never inserts one', () => {
    expect(norm('fanuc', ['G1 (A) X1', 'G1 (A) (B) X1', 'G1(A)X1', '(A) G1', 'G1 X1 (A)'], { ignoreComments: true })).toEqual([
      'G1 X1',
      'G1 X1',
      'G1X1',
      'G1',
      'G1 X1',
    ]);
  });

  it('keeps a bare block number where a comment was (a Fanuc jump target)', () => {
    expect(norm('fanuc', ['N100 (LOOP TOP)'], { ignoreComments: true })).toEqual(['N100']);
  });

  it('keeps the Klartext `~` behind a comment, and drops `;` labels and `*` structure blocks', () => {
    const lines = ['5 CYCL DEF 200 DRILLING ~', '  Q200=2 ;SET-UP CLEARANCE ~', '  Q201=-20 ;DEPTH', '6 * - ROUGH'];
    expect(norm('klartext', lines, { ignoreComments: true })).toEqual(['5 CYCL DEF 200 DRILLING ~', '  Q200=2 ~', '  Q201=-20', '6']);
    expect(norm('klartext', lines, { ignoreComments: true, ignoreBlockNumbers: true })).toEqual([
      'CYCL DEF 200 DRILLING ~',
      '  Q200=2 ~',
      '  Q201=-20',
    ]);
  });

  it('does not take the Klartext cycle name for a comment (P11, §10.2 M11-1)', () => {
    expect(same('klartext', '5 CYCL DEF 200 DRILLING ~', '5 CYCL DEF 200 BOHREN ~', ALL)).toBe(false);
  });

  it('leaves a comment marker inside a string alone', () => {
    expect(norm('sinumerik', ['MSG("A;B") ;REAL COMMENT'], { ignoreComments: true })).toEqual(['MSG("A;B")']);
  });
});

describe('keepComments: the comments a control reads', () => {
  it('Fanuc: the program title, an alarm or stop message, a `%` inside a comment', () => {
    const lines = [
      'O1001 (BRACKET OP1)',
      ':1001 (BRACKET)',
      '<SHAFT_T12> (SHAFT)',
      '#3000=1 (TOOL BROKEN)',
      '#3006 = 1 (CHECK INSERT)',
      'G1 X10. (FEED 100%)',
      'G1 X10. (ROUGH)',
      'M98 P1001 (CALL O1001)',
    ];
    expect(norm('fanuc', lines, { ignoreComments: true })).toEqual([
      'O1001 (BRACKET OP1)',
      ':1001 (BRACKET)',
      '<SHAFT_T12> (SHAFT)',
      '#3000=1 (TOOL BROKEN)',
      '#3006 = 1 (CHECK INSERT)',
      'G1 X10. (FEED 100%)',
      'G1 X10.',
      'M98 P1001',
    ]);
    // A new title is a change the directory of the control shows.
    expect(same('fanuc', 'O1001 (BRACKET OP1)', 'O1001 (BRACKET OP2)', compareDefaults(PROFILES.fanuc))).toBe(false);
    expect(same('lathe', '#3000=1 (TOOL BROKEN)', '#3000=1 (INSERT BROKEN)', compareDefaults(PROFILES.lathe))).toBe(false);
  });

  it('keeps a header comment on its own line apart from the title: X5 puts new ones there', () => {
    expect(norm('fanuc', ['O1001 (BRACKET OP1)', '(POSTED 2026-10-05)'], compareDefaults(PROFILES.fanuc))).toEqual([
      'O1001 (BRACKET OP1)',
    ]);
  });

  it('Sinumerik: `;$PATH=` and the cycle-screen markers, with their case and their blanks', () => {
    const lines = [';$PATH=/_N_WKS_DIR/_N_Shaft_WPD', 'CYCLE81(10,0,2,-12) ;*RO*', 'CYCLE82(10,0,2,-12,,1) ;*HD*', 'G1 X1 ;ROUGH'];
    expect(norm('sinumerik', lines, compareDefaults(PROFILES.sinumerik))).toEqual([
      ';$PATH=/_N_WKS_DIR/_N_Shaft_WPD',
      'CYCLE81(10,0,2,-12) ;*RO*',
      'CYCLE82(10,0,2,-12,,1) ;*HD*',
      'G1 X1',
    ]);
    expect(norm('sinumerikMill', [';$PATH=/_N_WKS_DIR/_N_PLATE_WPD'], ALL)).toEqual([';$PATH=/_N_WKS_DIR/_N_PLATE_WPD']);
  });

  it('Okuma: a `%` inside a comment', () => {
    expect(norm('okuma', ['G1 X10 (100%)', 'G1 X10 (A)'], { ignoreComments: true })).toEqual(['G1 X10 (100%)', 'G1 X10']);
  });
});

describe('ignoreCase alone', () => {
  it('folds code and ordinary comments', () => {
    expect(same('fanuc', 'g1 x10. (rough)', 'G1 X10. (ROUGH)', { ignoreCase: true })).toBe(true);
    expect(same('fanuc', 'g1 x10.', 'G1 X10.', {})).toBe(false);
  });

  it('never folds a string: Sinumerik tool names are case-sensitive', () => {
    expect(norm('sinumerik', ['t="Rough_1" d1', 'msg("Tool change")'], { ignoreCase: true })).toEqual([
      'T="Rough_1" D1',
      'MSG("Tool change")',
    ]);
    expect(same('sinumerik', 'T="ROUGH" D1', 'T="Rough" D1', ALL)).toBe(false);
  });

  it('is off by default wherever the control may tell case apart', () => {
    for (const key of ['fanuc', 'lathe', 'klartext', 'okuma'] as const) {
      expect(same(key, 'G1 X10.', 'g1 x10.', compareDefaults(PROFILES[key]))).toBe(false);
    }
    expect(same('sinumerik', 'G1 X10', 'g1 x10', compareDefaults(PROFILES.sinumerik))).toBe(true);
  });
});

describe('ignoreNumberFormat alone', () => {
  const NUM = { ignoreNumberFormat: true };

  it('writes values canonically: no `+`, no leading zeros, no trailing zeros, the point kept (Fanuc)', () => {
    expect(norm('fanuc', ['G01 X+05.500 Y-0.0 Z-.5 F0100.0'], NUM)).toEqual(['G1 X5.5 Y0. Z-0.5 F100.']);
    expect(norm('fanuc', ['X0010 Y-0'], NUM)).toEqual(['X10 Y0']);
  });

  it('drops a point that cannot count (Sinumerik, Okuma, Klartext without a machine)', () => {
    expect(norm('sinumerik', ['G01 X10.000 Z-2.50'], NUM)).toEqual(['G1 X10 Z-2.5']);
    expect(norm('okuma', ['G01 X10. Z-2.50'], NUM)).toEqual(['G1 X10 Z-2.5']);
    expect(norm('klartext', ['L X+10.000 Y-5 R0 FMAX'], NUM)).toEqual(['L X10 Y-5 R0 FMAX']);
  });

  it('reads the Klartext decimal comma as a point', () => {
    expect(norm('klartext', ['12 L X+10,500 Y-5,0 R0 FMAX'], NUM)).toEqual(['12 L X10.5 Y-5 R0 FMAX']);
    expect(same('klartext', '12 L X+10,5', '12 L X10.50', NUM)).toBe(true);
  });

  it('takes only the leading zeros off a code: `G01` → `G1`, `G84.2` and `G1.` as written', () => {
    expect(norm('fanuc', ['G01 G084.2 M03', 'G1.', 'G84.20'], NUM)).toEqual(['G1 G84.2 M3', 'G1.', 'G84.20']);
    expect(same('fanuc', 'G1', 'G1.', NUM)).toBe(false);
  });

  it('writes an assigned value canonically, but not the variable it goes into', () => {
    expect(norm('fanuc', ['#101=0005.500', '#0101=5.5'], NUM)).toEqual(['#101=5.5', '#0101=5.5']);
    expect(norm('sinumerik', ['R1=5.000', 'R01=5'], NUM)).toEqual(['R1=5', 'R01=5']);
    expect(norm('klartext', ['19 FN 0: Q1 = +10.0', '  Q200=2.000 ;SET-UP'], NUM)).toEqual(['19 FN 0: Q1 = 10', '  Q200=2 ;SET-UP']);
  });

  it('never reformats a number that may be a name: program numbers, subprograms, tools, offsets', () => {
    expect(norm('fanuc', ['O0010 (TITLE)', 'M98 P0010', 'G65 P09010 A1.0', 'T01 M06 H01 D01'], NUM)).toEqual([
      'O0010 (TITLE)',
      'M98 P0010',
      'G65 P09010 A1.',
      'T01 M6 H01 D01',
    ]);
    expect(norm('sinumerik', ['L0123', 'T="DRILL_08" D01'], NUM)).toEqual(['L0123', 'T="DRILL_08" D01']);
    expect(norm('okuma', ['CALL O0123 VA=01.50'], NUM)).toEqual(['CALL O0123 VA=1.5']);
  });

  it('never reformats the tool word of a turning profile (D49: `T001` is not `T1`)', () => {
    for (const key of ['lathe', 'okuma'] as const) {
      expect(norm(key, ['T0101', 'T101', 'T001'], ALL)).toEqual(['T0101', 'T101', 'T001']);
      expect(same(key, 'T0101 M8', 'T101 M8', ALL)).toBe(false);
    }
  });

  it('never reformats a value a reference points with, or a number a statement names', () => {
    expect(norm('lathe', ['G70 P0100 Q0200'], NUM)).toEqual(['G70 P0100 Q0200']);
    expect(norm('okuma', ['IF [V1 EQ 5] N0020'], NUM)).toEqual(['IF [V1 EQ 5] N0020']);
    expect(norm('klartext', ['3 BLK FORM 0.1 Z X+0 Y+0 Z-40', '4 CYCL DEF 200', '5 LBL 01'], NUM)).toEqual([
      '3 BLK FORM 0.1 Z X0 Y0 Z-40',
      '4 CYCL DEF 200',
      '5 LBL 01',
    ]);
  });

  it('leaves block numbers, labels, strings and comments as written', () => {
    expect(norm('fanuc', ['N0010 G0 X1.0 (X1.000)'], NUM)).toEqual(['N0010 G0 X1. (X1.000)']);
    expect(norm('sinumerik', ['MSG("X1.000")'], NUM)).toEqual(['MSG("X1.000")']);
  });
});

describe('the decimal point and the effective machine (AD-26)', () => {
  it('pointSignificant without a machine: any declared preset that counts increments', () => {
    expect(pointSignificant(PROFILES.fanuc, null)).toBe(true);
    expect(pointSignificant(PROFILES.lathe, undefined)).toBe(true);
    expect(pointSignificant(PROFILES.okuma, null)).toBe(false);
    expect(pointSignificant(PROFILES.sinumerik, null)).toBe(false);
    expect(pointSignificant(PROFILES.sinumerikMill, null)).toBe(false);
    expect(pointSignificant(PROFILES.klartext, null)).toBe(false);
    // `noMachine` is not a machine's own number input: every preset still applies.
    expect(pointSignificant(PROFILES.lathe, noMachine(PROFILES.lathe))).toBe(true);
  });

  it('`X10` ≠ `X10.` under an IS-B machine', () => {
    for (const key of ['fanuc', 'lathe'] as const) {
      const { cp, machine } = machineWith(key, presetOf(key, 'is-b'));
      expect(pointSignificant(cp.profile, machine)).toBe(true);
      const a = normalizeLines(['G1 X10'], cp, ALL, machine);
      const b = normalizeLines(['G1 X10.'], cp, ALL, machine);
      expect(a.text).not.toBe(b.text);
      expect(a.notes).toEqual([]);
    }
  });

  it('`X10` = `X10.` under a calculator-type machine', () => {
    for (const key of ['fanuc', 'lathe'] as const) {
      const { cp, machine } = machineWith(key, presetOf(key, 'calculator'));
      expect(pointSignificant(cp.profile, machine)).toBe(false);
      expect(normalizeLines(['G1 X10'], cp, ALL, machine).text).toBe(normalizeLines(['G1 X10.000'], cp, ALL, machine).text);
    }
  });

  it('`X10` = `X10.` under an Okuma `scale` machine (the unit multiplies both)', () => {
    for (const id of ['okuma-10um', 'okuma-1um']) {
      const { cp, machine } = machineWith('okuma', presetOf('okuma', id));
      expect(pointSignificant(cp.profile, machine)).toBe(false);
      expect(normalizeLines(['G1 X10'], cp, ALL, machine).text).toBe(normalizeLines(['G1 X10.'], cp, ALL, machine).text);
    }
  });

  it('a machine that counts increments in one class only still keeps the point', () => {
    const { cp, machine } = machineWith('fanuc', {
      mode: 'calculator',
      incrementMm: '0.001',
      classes: { feedPerRev: { mode: 'increment', increment: '0.01' } },
    });
    expect(pointSignificant(cp.profile, machine)).toBe(true);
  });

  it('with no machine, apart whenever one declared preset reads them apart, and the side says so', () => {
    for (const key of ['fanuc', 'lathe'] as const) {
      const a = normalizeLines(['G1 X10'], cpOf(key), ALL, null);
      const b = normalizeLines(['G1 X10.'], cpOf(key), ALL, null);
      expect(a.text).not.toBe(b.text);
      expect(a.notes).toEqual([{ key: COMPARE_NOTE_KEYS.pointWithoutMachine }]);
    }
    for (const key of ['okuma', 'sinumerik', 'sinumerikMill', 'klartext'] as const) {
      const a = normalizeLines(['G1 X10'], cpOf(key), ALL, null);
      expect(a.text).toBe(normalizeLines(['G1 X10.'], cpOf(key), ALL, null).text);
      expect(a.notes).toEqual([]);
    }
  });

  it('with the point counted, `X10.` = `X10.000` and `F100.` ≠ `F100` (stricter than per class)', () => {
    expect(same('fanuc', 'G1 X10. F100.', 'G1 X10.000 F100.0', ALL)).toBe(true);
    expect(same('fanuc', 'G1 F100.', 'G1 F100', ALL)).toBe(false);
  });
});

describe('every option together, per profile', () => {
  const CASES: [ProfileKey, string[], string[]][] = [
    ['fanuc', ['N10 g01 X+05.500  Y-0.0 (rough)', '(ONLY)', ''], ['G1 X5.5 Y0.']],
    ['lathe', ['N20 G00 X100.0 Z100. T0100 (RETRACT)'], ['G0 X100. Z100. T0100']],
    ['klartext', ['12 l x+10,500  y-5 R0 FMAX ;c ~', '  Q200=2.000 ;SET-UP ~'], ['L X10.5 Y-5 R0 FMAX ~', 'Q200=2 ~']],
    ['okuma', ['N0010 g00 x10.0 z02.  (A)', 'NLAP1 G1 X5'], ['G0 X10 Z2', 'NLAP1 G1 X5']],
    ['sinumerik', ['n10 g01 x10.000 ;rough', 't="Rough" d1'], ['G1 X10', 'T="Rough" D1']],
    ['sinumerikMill', ['N10 G0 X1.0 Y02.50 ;A'], ['G0 X1 Y2.5']],
  ];
  it.each(CASES)('%s', (key, lines, expected) => {
    expect(norm(key, lines, ALL)).toEqual(expected);
  });

  it('normalizeLine is the same step, one line at a time, with the Klartext state carried', () => {
    const cp = cpOf('klartext');
    const lines = ['5 CYCL DEF 200 DRILLING ~', '  Q200=2.000 ;SET-UP ~', '  Q201=-20,0', '6 L Z+50 FMAX'];
    const ctx = prepareNormalize(lines, cp, null);
    let state;
    const out: (string | null)[] = [];
    for (const line of lines) {
      const result = normalizeLine(line, cp, ALL, ctx, state);
      state = result.state;
      out.push(result.text);
    }
    expect(out).toEqual(['CYCL DEF 200 DRILLING ~', 'Q200=2 ~', 'Q201=-20', 'L Z50 FMAX']);
    expect(out.filter((text) => text !== null).join('\n')).toBe(normalizeLines(lines, cp, ALL).text);
  });
});

describe('X5: a re-posted program yields exactly its real changes', () => {
  const DIR = fileURLToPath(new URL('../../../../tests/fixtures/compare/x5-repost/', import.meta.url));
  const read = (name: string): string[] => {
    const lines = readFileSync(DIR + name, 'utf8').split('\n');
    // The final line break leaves an empty last element, as the editor's model has none.
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const original = read('original.nc');
  const reposted = read('reposted.nc');
  const o = compareDefaults(PROFILES.fanuc);

  it('raw, almost every line differs', () => {
    const changed = diffLines(original, reposted).reduce((sum, edit) => sum + edit.oldEnd - edit.oldStart, 0);
    expect(changed).toBeGreaterThan(original.length / 2);
  });

  it('normalized, the feed and the drilling depth are the only changes, mapped back to their lines', () => {
    const a = normalizeLines(original, cpOf('fanuc'), o, null);
    const b = normalizeLines(reposted, cpOf('fanuc'), o, null);
    const aLines = a.text.split('\n');
    const bLines = b.text.split('\n');
    const edits = diffLines(aLines, bLines);
    expect(edits.map((edit) => [original[a.lineMap[edit.oldStart] - 1], edit.oldEnd - edit.oldStart, edit.newLines])).toEqual([
      ['N70 X130. F600.', 1, ['X130. F650.']],
      ['N140 G81 G98 X20. Y20. Z-15.25 R2. F120.', 1, ['G81 G98 X20. Y20. Z-15. R2. F120.']],
    ]);
    // The new side's map points at the re-posted lines.
    const changed = edits.map((edit) => reposted[b.lineMap[bLines.indexOf(edit.newLines[0])] - 1]);
    expect(changed).toEqual(['X130.000 F650.0', 'G81 G98 X20.000 Y20.000 Z-15.000 R2.000 F120.0']);
  });

  it('the export of the normalized sides is the golden', () => {
    const a = normalizeLines(original, cpOf('fanuc'), o, null).text.split('\n');
    const b = normalizeLines(reposted, cpOf('fanuc'), o, null).text.split('\n');
    const golden = readFileSync(`${DIR}expected.diff`, 'utf8');
    expect(unifiedDiff({ name: 'original.nc', lines: a }, { name: 'reposted.nc', lines: b })).toBe(golden);
  });
});

describe('budget', () => {
  it('normalizes two 100k-line sides in a second', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../../tests/fixtures/compare/x5-repost/original.nc', import.meta.url)),
      'utf8',
    )
      .split('\n')
      .filter((line) => line !== '');
    const a = Array.from({ length: 100_000 }, (_, i) => source[i % source.length]);
    // A jump in the middle makes the block-number walk read the whole file.
    a[50_000] = 'N99990 IF[#1LT5]GOTO100';
    const b = a.map((line) => line.replace(/\.(?=\s|$)/g, '.000'));
    const cp = cpOf('fanuc');
    const o = compareDefaults(PROFILES.fanuc);
    normalizeLines(a.slice(0, 1000), cp, o);
    const started = performance.now();
    const left = normalizeLines(a, cp, o);
    const right = normalizeLines(b, cp, o);
    const ms = performance.now() - started;
    expect(left.text).toBe(right.text);
    expectWithin(ms, 1000, `two 100k-line sides: ${ms.toFixed(0)} ms`);
  });
});

describe('unifiedDiff', () => {
  const side = (name: string, lines: string[]) => ({ name, lines });

  it('is empty for two equal sides, and for two empty ones', () => {
    expect(unifiedDiff(side('a', ['G1', 'G0']), side('b', ['G1', 'G0']))).toBe('');
    expect(unifiedDiff(side('a', []), side('b', []))).toBe('');
  });

  it('all added', () => {
    expect(unifiedDiff(side('a.nc', []), side('b.nc', ['G1', 'G0']))).toBe(['--- a.nc', '+++ b.nc', '@@ -0,0 +1,2 @@', '+G1', '+G0'].join('\n'));
  });

  it('all removed', () => {
    expect(unifiedDiff(side('a.nc', ['G1', 'G0', 'M30']), side('b.nc', []))).toBe(
      ['--- a.nc', '+++ b.nc', '@@ -1,3 +0,0 @@', '-G1', '-G0', '-M30'].join('\n'),
    );
  });

  it('one changed line with three lines of context, the count left out where it is 1', () => {
    const a = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'];
    const b = [...a];
    b[4] = 'L5 NEW';
    expect(unifiedDiff(side('a', a), side('b', b))).toBe(
      ['--- a', '+++ b', '@@ -2,7 +2,7 @@', ' L2', ' L3', ' L4', '-L5', '+L5 NEW', ' L6', ' L7', ' L8'].join('\n'),
    );
    expect(unifiedDiff(side('a', ['X']), side('b', ['Y']))).toBe(['--- a', '+++ b', '@@ -1 +1 @@', '-X', '+Y'].join('\n'));
  });

  it('an insertion and a deletion stay what they are (the plain Myers diff, no same-length pairing)', () => {
    const a = ['A', 'B', 'C', 'D', 'E', 'F'];
    const b = ['A', 'NEW', 'B', 'C', 'D', 'E'];
    expect(unifiedDiff(side('a', a), side('b', b), { context: 0 })).toBe(
      ['--- a', '+++ b', '@@ -1,0 +2 @@', '+NEW', '@@ -6 +6,0 @@', '-F'].join('\n'),
    );
  });

  it('merges hunks whose context touches, and keeps apart those that do not', () => {
    const a = Array.from({ length: 20 }, (_, i) => `L${i + 1}`);
    const near = [...a];
    near[3] = 'X4';
    near[9] = 'X10'; // five lines between: the two contexts of three overlap
    expect(unifiedDiff(side('a', a), side('b', near))).toBe(
      [
        '--- a',
        '+++ b',
        '@@ -1,13 +1,13 @@',
        ' L1',
        ' L2',
        ' L3',
        '-L4',
        '+X4',
        ' L5',
        ' L6',
        ' L7',
        ' L8',
        ' L9',
        '-L10',
        '+X10',
        ' L11',
        ' L12',
        ' L13',
      ].join('\n'),
    );
    const far = [...a];
    far[3] = 'X4';
    far[11] = 'X12'; // seven lines between: two hunks
    expect(unifiedDiff(side('a', a), side('b', far))).toBe(
      [
        '--- a',
        '+++ b',
        '@@ -1,7 +1,7 @@',
        ' L1',
        ' L2',
        ' L3',
        '-L4',
        '+X4',
        ' L5',
        ' L6',
        ' L7',
        '@@ -9,7 +9,7 @@',
        ' L9',
        ' L10',
        ' L11',
        '-L12',
        '+X12',
        ' L13',
        ' L14',
        ' L15',
      ].join('\n'),
    );
  });

  it('shifts the new side by what the hunks before it added', () => {
    const a = Array.from({ length: 12 }, (_, i) => `L${i + 1}`);
    const b = ['L1', 'NEW1', 'NEW2', ...a.slice(1, 10), 'L11 CHANGED', 'L12'];
    expect(unifiedDiff(side('a', a), side('b', b), { context: 1 })).toBe(
      ['--- a', '+++ b', '@@ -1,2 +1,4 @@', ' L1', '+NEW1', '+NEW2', ' L2', '@@ -10,3 +12,3 @@', ' L10', '-L11', '+L11 CHANGED', ' L12'].join(
        '\n',
      ),
    );
  });

  it('no newline at the end: the final empty line of a side is an ordinary line, and no marker is written', () => {
    // `G1\nG0\n` against `G1\nG0`: the editor's lines are ['G1', 'G0', ''] and ['G1', 'G0'].
    const out = unifiedDiff(side('a', ['G1', 'G0', '']), side('b', ['G1', 'G0']));
    expect(out).toBe(['--- a', '+++ b', '@@ -1,3 +1,2 @@', ' G1', ' G0', '-'].join('\n'));
    expect(out.endsWith('\n')).toBe(false);
    expect(out).not.toContain('\\ No newline');
  });

  it('falls back to three lines of context for a context that is not a count', () => {
    const a = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const b = ['A', 'B', 'C', 'X', 'E', 'F', 'G'];
    const expected = unifiedDiff(side('a', a), side('b', b));
    expect(unifiedDiff(side('a', a), side('b', b), { context: -1 })).toBe(expected);
    expect(unifiedDiff(side('a', a), side('b', b), { context: Number.NaN })).toBe(expected);
  });
});

describe('M11 review fixes (2026-10-05)', () => {
  /** Two sides of one profile and machine read alike under every default option. */
  const alike = (cp: CompiledProfile, a: string[], b: string[], machine?: SideMachine): boolean =>
    normalizeLines(a, cp, ALL, machine).text === normalizeLines(b, cp, ALL, machine).text;

  it('NC-2: keeps the point of a word that takes none under a calculator machine', () => {
    const mill = machineWith('fanuc', presetOf('fanuc', 'calculator'));
    expect(alike(mill.cp, ['G04 P1000'], ['G04 P1000.'], mill.machine)).toBe(false);
    expect(alike(mill.cp, ['G82 X0 Y0 Z-5. R2. P500 F100.'], ['G82 X0 Y0 Z-5. R2. P500. F100.'], mill.machine)).toBe(false);
    expect(alike(mill.cp, ['G43 H1 Z50.'], ['G43 H1. Z50.'], mill.machine)).toBe(false);
    const lathe = machineWith('lathe', presetOf('lathe', 'calculator'));
    expect(alike(lathe.cp, ['G76 P020060 Q100 R0.02'], ['G76 P020060 Q100. R0.02'], lathe.machine)).toBe(false);
    expect(alike(lathe.cp, ['G83 X0 Z-20. Q6000 F0.1'], ['G83 X0 Z-20. Q6000. F0.1'], lathe.machine)).toBe(false);
    expect(alike(cpOf('sinumerik'), ['T1 D1'], ['T1 D1.'], null)).toBe(false);
    // Still equal: an axis under calculator input, and trailing zeros after the point.
    expect(alike(mill.cp, ['G1 X10'], ['G1 X10.'], mill.machine)).toBe(true);
    expect(alike(mill.cp, ['G04 P1000.0'], ['G04 P1000.'], mill.machine)).toBe(true);
  });

  it('NC-6: one decimal-point rule for both sides when the comparison hands it in', () => {
    const isb = machineWith('fanuc', presetOf('fanuc', 'is-b'));
    const calc = machineWith('fanuc', presetOf('fanuc', 'calculator'));
    const strict = pointSignificant(isb.cp.profile, isb.machine) || pointSignificant(calc.cp.profile, calc.machine);
    expect(strict).toBe(true);
    // Each side with its own rule hides the difference; with the shared rule it shows.
    expect(normalizeLines(['G1 X10'], isb.cp, ALL, isb.machine).text).toBe(normalizeLines(['G1 X10.'], calc.cp, ALL, calc.machine).text);
    const over = { pointSignificant: strict };
    expect(normalizeLines(['G1 X10'], isb.cp, ALL, isb.machine, over).text).not.toBe(
      normalizeLines(['G1 X10.'], calc.cp, ALL, calc.machine, over).text,
    );
    // The same text on a calculator side and a no-machine side is equal again.
    const none = pointSignificant(cpOf('fanuc').profile, null) || pointSignificant(calc.cp.profile, calc.machine);
    const lines = ['G0 X10. Y20.'];
    expect(normalizeLines(lines, calc.cp, ALL, calc.machine, { pointSignificant: none }).text).toBe(
      normalizeLines(lines, cpOf('fanuc'), ALL, null, { pointSignificant: none }).text,
    );
    // prepareNormalize takes the same override; absent, the side keeps its own answer.
    expect(prepareNormalize(lines, calc.cp, calc.machine, { pointSignificant: true }).pointSignificant).toBe(true);
    expect(prepareNormalize(lines, calc.cp, calc.machine).pointSignificant).toBe(false);
  });

  it('NC-3: a Sinumerik jump to a main block, a bare number or a computed target keeps its block numbers', () => {
    const cp = cpOf('sinumerik');
    expect(alike(cp, [':200 G1 X1', 'GOTOF :200'], [':210 G1 X1', 'GOTOF :200'])).toBe(false);
    expect(alike(cp, ['N200 G1 X1', 'GOTOF 200'], ['N210 G1 X1', 'GOTOF 200'])).toBe(false);
    expect(alike(cp, ['N200 G1 X1', 'GOTOC 200'], ['N210 G1 X1', 'GOTOC 200'])).toBe(false);
    // The main block `:200` is not `N200`: a jump to one keeps that one.
    expect(alike(cp, ['N200 G1 X1', 'GOTOF :200'], ['N210 G1 X1', 'GOTOF :200'])).toBe(true);
    for (const jump of ['GOTOF DEST', 'GOTOF "N"<<R10']) {
      const result = normalizeLines(['N200 G1 X1', jump], cp, ALL, null);
      expect(result.text.split('\n')[0], jump).toBe('N200 G1 X1');
      expect(result.notes, jump).toEqual([{ key: COMPARE_NOTE_KEYS.blockNumbers, params: { line: 2 } }]);
    }
    // A jump to a label of the file names no block: the unreferenced numbers still go.
    const label = normalizeLines(['N100 LOOP_A: G1 X1', 'N110 GOTOB LOOP_A'], cp, ALL, null);
    expect(label.text).toBe('LOOP_A: G1 X1\nGOTOB LOOP_A');
    expect(label.notes).toEqual([]);
  });

  it('NC-7: an Okuma message comment is compared', () => {
    expect(alike(cpOf('okuma'), ['MSG (CHECK INSERT)'], ['MSG (CHANGE INSERT)'])).toBe(false);
    expect(alike(cpOf('okuma'), ['G215 (CHECK INSERT)'], ['G215 (CHANGE INSERT)'])).toBe(false);
    expect(alike(cpOf('okuma'), ['G1 X1 (CHECK)'], ['G1 X1 (CHANGE)'])).toBe(true);
  });

  it('NC-8: the Fanuc mill cycles G70.7 to G73.7 keep the blocks their P and Q name', () => {
    for (const cycle of ['G70.7', 'G71.7', 'G72.7', 'G73.7']) {
      expect(alike(cpOf('fanuc'), [`${cycle} P100 Q200`, 'N100 G0 X10.'], [`${cycle} P100 Q200`, 'N101 G0 X10.']), cycle).toBe(false);
    }
    expect(alike(cpOf('fanuc'), ['G71 P100 Q200', 'N100 G0 X10.'], ['G71 P100 Q200', 'N101 G0 X10.'])).toBe(false);
    expect(alike(cpOf('fanuc'), ['G71.5 P100 Q200', 'N100 G0 X10.'], ['G71.5 P100 Q200', 'N101 G0 X10.'])).toBe(true);
  });

  it('NC-10: a dropped comment never glues an Okuma name to the next word', () => {
    expect(alike(cpOf('okuma'), ['NAB(C)G1 X1'], ['NABG1 X1'])).toBe(false);
    expect(alike(cpOf('okuma'), ['G1 (C) X1'], ['G1 X1'])).toBe(true);
    expect(norm('fanuc', ['G1(A)X1'], ALL)).toEqual(['G1X1']);
  });
});
