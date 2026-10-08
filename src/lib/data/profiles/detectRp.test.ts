// M12.5 "Real programs, second pass": detection of programs without their usual header, of
// five-axis mills against the lathe, of commented Siemens headers and of `$` comment lines,
// and the uncertain signal (plan §6 M12.5, decisions 2 and 10; §7.16 #177).
//
// Every program here is synthetic, written for gEdit; the evidence behind each case is in
// the plan. Each case failed before the `detect` change it pins.

import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import {
  CERTAIN_WEIGHT,
  DECISIVE_WEIGHT,
  UNCERTAIN_FAMILY_MARGIN,
  detectProfile,
  detectResult,
  detectVariants,
} from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import type { CompiledProfile } from '$lib/core/profiles/types';

const MILL = 'fanuc-gcode';
const LATHE = 'fanuc-lathe';
const OKUMA = 'okuma-osp';
const SINUMERIK = 'sinumerik';
const SINUMERIK_MILL = 'sinumerik-mill';
const KLARTEXT = 'heidenhain-klartext';

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

const IDS = BUILTINS.map((cp) => cp.profile.id);

/** One line's score per profile: its strongest content rule, as detection counts it. */
function lineScores(line: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const cp of BUILTINS) {
    let best = 0;
    for (const rule of cp.re.detectContent) if (rule.re.test(line.trim()) && rule.weight > best) best = rule.weight;
    out.set(cp.profile.id, best);
  }
  return out;
}

/** `count` lines made by `line(i)`, numbered from `first` in steps of 10. */
function numbered(first: number, count: number, line: (n: number, i: number) => string): string[] {
  return Array.from({ length: count }, (_, i) => line(first + i * 10, i));
}

/** Detection from every built-in as the fallback: the answer must not depend on it. */
function detectAll(path: string | null, text: string): string[] {
  return [...new Set(IDS.map((fallback) => detectProfile(BUILTINS, path, text, fallback)))];
}

// ---------------------------------------------------------------------------
// The synthetic programs of the plan's WP-RP1 list
// ---------------------------------------------------------------------------

/** An Okuma lathe program without the `$NAME.MIN%` header, 300 modal lines. */
const OKUMA_NO_HEADER = [
  'N10 G140',
  'N20 G0 X400 Z300',
  'N30 G50 S2000',
  'N40 T010101',
  'N50 G96 S180 M3',
  'N60 SB=1500 M13',
  ...numbered(70, 300, (n, i) => `N${n} X${(50.1 - i * 0.1).toFixed(1)} Z-0.2`),
  'N9990 M2',
].join('\n');

/** A Siemens milling program without a header. */
const SIEMENS_MILL_NO_HEADER = [
  '; demo part, no header',
  'WORKPIECE(,,,"BOX",112,0,-50,-80,-60,60,60,-60)',
  'T="MILL10" M6',
  'CYCLE800(1,"TC1",200000,27,0,0,0,0,0,0,0,0,0,1,,0)',
  ...numbered(10, 300, (n, i) => `N${n} G1 X${i % 40} Y${(i * 3) % 50} Z-1 F500`),
  'M30',
].join('\n');

/** A five-axis Fanuc mill program with four-digit tools and a pre-selected next tool. */
const FIVE_AXIS_MILL = [
  '%',
  'O1000 (FIVE AXIS)',
  'N10 G90 G17',
  'N20 T1205 T1310 M6',
  'N30 T1310',
  'N40 G43.4 H1205',
  ...numbered(50, 300, (n, i) => `N${n} X${i % 30}. Y${(i * 2) % 40}. Z-1. A0 C${i % 360}.`),
  'N9990 M30',
  '%',
].join('\n');

/** An ISO turning dialect that writes its comments as `$ <text>` lines. */
const DOLLAR_COMMENTS = [
  '%1',
  '$ ROUGH TURNING',
  'N10 T1 D1 M6',
  ...numbered(20, 60, (n, i) => `N${n} G1 X${40 - (i % 20)} Z-${i % 30}`),
].join('\n');

// ---------------------------------------------------------------------------
// Okuma without its header
// ---------------------------------------------------------------------------

describe('an Okuma program without the $NAME.MIN% header', () => {
  it('is read as Okuma, not as the Fanuc lathe, under its own extension and on its content alone', () => {
    expect(detectAll('/work/part.min', OKUMA_NO_HEADER)).toEqual([OKUMA]);
    expect(detectAll(null, OKUMA_NO_HEADER)).toEqual([OKUMA]);
    const result = detectResult(BUILTINS, '/work/part.min', OKUMA_NO_HEADER, LATHE);
    expect(result).toMatchObject({ id: OKUMA, by: 'content', certain: true, uncertain: false });
  });

  it('scores a numbered block as both Fanuc profiles do', () => {
    // The parity rule: without it ~300 modal lines at 1 for the Fanuc lathe outweighed every
    // Okuma marker of the program.
    for (const line of ['N70 X50.1 Z-0.2', 'N80 Z-20', 'N9990 M2']) {
      const scores = lineScores(line);
      expect(scores.get(OKUMA), line).toBe(1);
      expect(scores.get(LATHE), line).toBe(1);
    }
  });

  it('reads the markers such programs carry near the top', () => {
    const certain: string[] = ['NOEX VTLL[1]=50 VTLD[1]=8', 'N25 G20 HP=1', 'N26 MT=1', 'N27 OS=1 M19'];
    for (const line of certain) {
      const scores = lineScores(line);
      expect(scores.get(OKUMA), line).toBe(CERTAIN_WEIGHT);
      for (const id of IDS.filter((other) => other !== OKUMA)) expect(scores.get(id)!, `${line}: ${id}`).toBeLessThanOrEqual(1);
    }
    // `G140`/`G141` (turning and milling mode) is a marker, not a certain one: another ISO
    // control writes a lone `G141` for its own purpose. Nor is a lone `G13`/`G14` (turret
    // selection): a Fanuc-compatible lathe control writes a lone `G14` to swap spindles.
    for (const line of ['N10 G140', 'N20 G141', 'G140', 'N40 G13', 'N45 G14', 'G13']) {
      expect(lineScores(line).get(OKUMA), line).toBe(8);
    }
    // A Siemens approach block (`G140` with `G147`/`G341`/`DISR`) is no Okuma marker, nor is a
    // `G13`/`G14` that is not alone in its block.
    for (const line of ['N50 G140 G147 G341 DISR=5 Z0', 'G141 G248 DISCL=2', 'N40 G13 X10', 'N41 G14 Z5']) {
      expect(lineScores(line).get(OKUMA), line).toBeLessThan(8);
    }
  });

  it('keeps an Okuma marker out of a comment and off a Siemens line', () => {
    for (const line of ['(SET MT=1 ON THE MACHINE)', '; HP=1', 'N10 G0 X0 ; MT=1']) {
      expect(lineScores(line).get(OKUMA), line).toBeLessThan(CERTAIN_WEIGHT);
    }
  });
});

// ---------------------------------------------------------------------------
// Siemens milling lines
// ---------------------------------------------------------------------------

describe('a Siemens milling program without a header', () => {
  it('is read as Siemens milling, not as the Fanuc mill', () => {
    expect(detectAll('/work/part.mpf', SIEMENS_MILL_NO_HEADER)).toEqual([SINUMERIK_MILL]);
    expect(detectAll(null, SIEMENS_MILL_NO_HEADER)).toEqual([SINUMERIK_MILL]);
  });

  it('scores the lines that move Y on the milling profile, and only there', () => {
    for (const line of ['N10 G1 X1 Y2 Z-1 F500', 'X10 Y20', 'G0 Y-5.5']) {
      const scores = lineScores(line);
      expect(scores.get(SINUMERIK_MILL), line).toBeGreaterThanOrEqual(1);
      expect(scores.get(SINUMERIK), line).toBe(0);
    }
    // Inside a comment or a string a Y is no move.
    expect(lineScores('; Y10').get(SINUMERIK_MILL)).toBe(1); // the comment line itself
    expect(lineScores('MSG("Y10")').get(SINUMERIK_MILL)).toBe(3); // MSG, not a Y word
  });
});

// ---------------------------------------------------------------------------
// A five-axis mill against the lathe
// ---------------------------------------------------------------------------

describe('a five-axis Fanuc mill with four-digit tools', () => {
  it('is read as the Fanuc mill, not as the lathe', () => {
    expect(detectAll('/work/part.nc', FIVE_AXIS_MILL)).toEqual([MILL]);
    expect(detectAll(null, FIVE_AXIS_MILL)).toEqual([MILL]);
  });

  it('does not count a turret word on a block that changes a milling tool or names two tools', () => {
    for (const line of ['N20 T1205 T1310 M6', 'M06 T21000', 'T0101 M6', 'N30 T1205 T1310']) {
      expect(lineScores(line).get(LATHE), line).toBeLessThan(3);
      expect(lineScores(line).get(OKUMA), line).toBeLessThan(3);
    }
    // A turret word alone still is one in code; in a comment (a CAM header's tool list) it
    // is none, on the Fanuc lathe and on Okuma alike.
    for (const line of ['N30 T1310', 'T0101', 'G0 X50 T12012']) {
      expect(lineScores(line).get(LATHE), line).toBe(3);
    }
    for (const line of ['(T0101  OD ROUGH)', '(T1205 D10 END MILL)', 'G0 X50 (T1205)']) {
      expect(lineScores(line).get(LATHE), line).toBeLessThan(3);
      expect(lineScores(line).get(OKUMA), line).toBeLessThan(3);
    }
  });

  it('counts the tool length of a tool-centre-point block as a mill marker', () => {
    expect(lineScores('N40 G43.4 H1205').get(MILL)).toBe(3);
    expect(lineScores('N40 G43.4 H1205').get(LATHE)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The Siemens header written as a comment
// ---------------------------------------------------------------------------

describe('a Siemens header written as a comment', () => {
  it('decides the dialect the way the header does', () => {
    const text = [';%_N_SHAFT_12_MPF', ';$PATH=/_N_WKS_DIR/_N_SHAFT_WPD', 'N10 G0 X100 Z100', 'N20 M30'].join('\n');
    const result = detectResult(BUILTINS, '/work/SHAFT_12.MPF', text, MILL);
    expect(result).toMatchObject({ id: SINUMERIK, by: 'content', certain: true, uncertain: false });
    const alone = [';%_N_SHAFT_12_MPF', ...numbered(10, 50, (n, i) => `N${n} X${i}.5 Y${i}.25 Z-1.`)].join('\n');
    const decided = detectResult(BUILTINS, '/work/shaft.nc', alone, MILL);
    expect(decided.score).toBeGreaterThanOrEqual(DECISIVE_WEIGHT);
    expect(decided.id).toBe(SINUMERIK_MILL);
  });
});

// ---------------------------------------------------------------------------
// `$` comment lines of another dialect
// ---------------------------------------------------------------------------

describe('`$` comment lines of another ISO dialect', () => {
  it('do not make a program Okuma', () => {
    for (const path of ['/work/part', '/work/part.nc', null]) {
      expect(detectAll(path, DOLLAR_COMMENTS), String(path)).not.toContain(OKUMA);
    }
  });
});

// ---------------------------------------------------------------------------
// The M12.5 review: markers that another control writes too
// ---------------------------------------------------------------------------

/**
 * A Fanuc-compatible lathe program that swaps to the second spindle with a lone `G14` and
 * cancels with a lone `G15`, in plain Fanuc lathe syntax otherwise (`G50 S`, `T0101`, `G96`,
 * `G28 U0 W0`). `withFanucOnly: false` leaves out the `G28` with axis words and the lone
 * `G15`, the two shapes Okuma never writes.
 */
function spindleSwap(numbered: boolean, withFanucOnly = true): string {
  const body = [
    'G50 S2000',
    'T0101',
    'G96 S200 M3',
    ...Array.from({ length: 60 }, (_, i) => `G1 X${(40 - i * 0.2).toFixed(1)} Z-${i % 30}. F0.2`),
    ...(withFanucOnly ? ['G28 U0 W0'] : ['G0 X200. Z200.']),
    'M5',
    'G14',
    'T0202',
    'G97 S1000 M3',
    ...Array.from({ length: 60 }, (_, i) => `G1 X${(30 - i * 0.2).toFixed(1)} Z-${i % 20}. F0.15`),
    ...(withFanucOnly ? ['G15'] : []),
    'M30',
  ];
  const lines = numbered ? body.map((line, i) => `N${(i + 1) * 10} ${line}`) : body;
  return ['%', 'O0001', '(SPINDLE SWAP DEMO)', ...lines, '%'].join('\n');
}

describe('a lone G13/G14 is an Okuma marker, not a certain one', () => {
  it('leaves a Fanuc lathe program that swaps spindles with a lone G14 to the Fanuc lathe', () => {
    for (const numbered of [false, true]) {
      const text = spindleSwap(numbered);
      for (const path of ['/work/O0001.nc', '/work/O0001', null]) {
        expect(detectAll(path, text), `${path} numbered=${numbered}`).toEqual([LATHE]);
      }
    }
  });

  it('takes Okuma out of a file that writes G28 with an axis word or a lone G15', () => {
    const okuma = BUILTINS.find((cp) => cp.profile.id === OKUMA)!;
    const vetoed = (line: string): boolean => okuma.re.detectVetoes.some((re) => re.test(line));
    for (const line of ['G28 U0 W0', 'N100 G28 U0.', 'G91 G28 Z0', 'G28 X0 Y0', 'G15', 'N20 G15', 'G15 (CANCEL)']) {
      expect(vetoed(line), line).toBe(true);
    }
    // Okuma's own `G28` (torque limit cancel) stands alone, and its `G15` always takes `H`.
    for (const line of ['N100 G28', 'G28', 'N20 G15 H1', 'G150', 'G15.1']) {
      expect(vetoed(line), line).toBe(false);
    }
  });

  it('calls a program with a lone G14 and nothing Fanuc-only a guess, not a certainty', () => {
    const result = detectResult(BUILTINS, '/work/O0001.nc', spindleSwap(true, false), LATHE);
    expect(result.certain).toBe(false);
    if (result.id === OKUMA) expect(result.uncertain).toBe(true);
  });

  it('still reads real Okuma programs without a header as Okuma', () => {
    const opened = openFixture('nc/okuma/o07-no-header.MIN');
    if (opened.refused !== null) throw new Error('o07 was refused');
    expect(detectAll('/work/o07-no-header.MIN', opened.text)).toEqual([OKUMA]);
    expect(detectAll('/work/part.min', OKUMA_NO_HEADER)).toEqual([OKUMA]);
    const turret = ['N10 G13', ...numbered(20, 200, (n, i) => `N${n} X${(80 - i * 0.2).toFixed(1)} Z-${i % 40}`), 'N9990 M2'].join('\n');
    expect(detectAll('/work/part.min', turret)).toEqual([OKUMA]);
  });
});

describe('a header tool list in comments does not make a five-axis mill a lathe', () => {
  it('keeps the mill with two tool comments in the header, with and without G43.4', () => {
    const header = ['(T1205 D10 END MILL)', '(T1310 D6 BALL MILL)'];
    const lines = FIVE_AXIS_MILL.split('\n');
    const withHeader = [lines[0], lines[1], ...header, ...lines.slice(2)];
    const without = withHeader.filter((line) => !line.includes('G43.4'));
    for (const text of [withHeader.join('\n'), without.join('\n')]) {
      expect(detectAll('/work/part.nc', text)).toEqual([MILL]);
      expect(detectAll(null, text)).toEqual([MILL]);
    }
  });
});

describe('an Okuma MT=/OS=/HP= marker is no Siemens variable', () => {
  it('leaves a short Siemens program with a user variable MT to Siemens', () => {
    const text = ['N10 DEF INT MT=1', 'N20 G0 X10 Z5', 'N30 G1 X20 F0.2', 'N40 M30'].join('\n');
    for (const path of ['/work/part.mpf', '/work/part.txt']) {
      expect(detectAll(path, text), path).toEqual([SINUMERIK]);
    }
  });

  it('counts only a whole number, never a declaration', () => {
    for (const line of ['N10 DEF INT MT=1', 'DEF REAL HP=2', 'N16 MT=2.5', 'N17 HP=R1']) {
      expect(lineScores(line).get(OKUMA), line).toBeLessThan(CERTAIN_WEIGHT);
    }
    for (const line of ['N26 MT=1', 'N27 OS=1 M19', 'N25 G20 HP=1', 'MT=0102']) {
      expect(lineScores(line).get(OKUMA), line).toBe(CERTAIN_WEIGHT);
    }
  });
});

// ---------------------------------------------------------------------------
// The uncertain signal (decision 2)
// ---------------------------------------------------------------------------

describe('the uncertain signal', () => {
  const uncertainFixtures = listFixtures('nc/uncertain');
  const others = [...listFixtures('nc'), ...listFixtures('channels/nc')].filter(
    (rel) => !rel.startsWith('nc/ambiguous/') && !rel.startsWith('nc/uncertain/'),
  );

  it('flags every synthetic program of a dialect gEdit has no profile for', () => {
    expect(uncertainFixtures.length).toBe(4);
    for (const rel of uncertainFixtures) {
      const opened = openFixture(rel);
      if (opened.refused !== null) throw new Error(`${rel} was refused`);
      const result = detectResult(BUILTINS, `/work/${rel.split('/').pop()}`, opened.text, MILL);
      expect(result.uncertain, `${rel}: ${JSON.stringify(result)}`).toBe(true);
      expect(result.familyMargin, rel).toBeLessThan(UNCERTAIN_FAMILY_MARGIN);
    }
  });

  it('flags no other committed fixture outside nc/ambiguous', () => {
    expect(others.length).toBeGreaterThanOrEqual(100);
    const flagged = others.filter((rel) => {
      const opened = openFixture(rel);
      return opened.refused === null && detectResult(BUILTINS, `/work/${rel.split('/').pop()}`, opened.text, KLARTEXT).uncertain;
    });
    expect(flagged).toEqual([]);
  });

  it('flags none of the synthetic programs above, which their markers decide', () => {
    for (const [path, text] of [
      ['/work/part.min', OKUMA_NO_HEADER],
      ['/work/part.mpf', SIEMENS_MILL_NO_HEADER],
      ['/work/part.nc', FIVE_AXIS_MILL],
    ] as const) {
      expect(detectResult(BUILTINS, path, text, MILL).uncertain, path).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// G7: the cost of detection
// ---------------------------------------------------------------------------

describe('the cost of detection', () => {
  it('reads a 400-line program against every profile, with the variants, within 5 ms', () => {
    const text = FIVE_AXIS_MILL.split('\n').slice(0, 400).join('\n');
    const run = (): void => {
      const result = detectResult(BUILTINS, '/work/part.nc', text, MILL);
      const cp = BUILTINS.find((p) => p.profile.id === result.id)!;
      detectVariants(cp, text);
    };
    expectWithin(fastest(5, run), 5, 'detectResult and detectVariants on 400 lines');
  });
});
