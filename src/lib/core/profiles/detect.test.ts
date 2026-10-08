// Profile detection (plan §5 WP3.1, AD-11): the scoring rules, and the answer for every
// NC fixture.
//
// The fixture answers and the list of results that moved since the M0 characterization
// live in `tests/fixtures/expected/detect/fixtures.json`, so the Python side (§7.10) and
// a future profile can be checked against the same table.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { compileProfile } from './compile';
import {
  CERTAIN_WEIGHT,
  DECISIVE_WEIGHT,
  MAX_SNIFF_LINES,
  UNCERTAIN_FAMILY_MARGIN,
  UNCERTAIN_MIN_LINES,
  VARIANT_MARGIN,
  detectProfile,
  detectResult,
  detectScores,
  detectVariants,
  extensionOf,
} from './detect';
import { validateProfile } from './validate';
import type { CompiledProfile, Profile } from './types';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';

const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';
const LATHE = 'fanuc-lathe';
const OKUMA = 'okuma-osp';
const SINUMERIK = 'sinumerik';
const SINUMERIK_MILL = 'sinumerik-mill';

/** The built-ins, through the same gate the registry uses. */
const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

/** Detects `text` once with each fallback; the pair shows whether the fallback was used. */
function detectBoth(path: string | null, text: string, profiles = BUILTINS): [string, string] {
  return [detectProfile(profiles, path, text, FANUC), detectProfile(profiles, path, text, KLARTEXT)];
}

/** A profile built for one rule of the test, on top of a built-in so it stays complete. */
function variant(id: string, detect: Partial<Profile['detect']>): CompiledProfile {
  const base = BUILTINS[0].profile;
  const profile: Profile = {
    ...structuredClone(base),
    id,
    detect: { extensions: {}, content: [], ...structuredClone(detect) },
  };
  return compileProfile(profile);
}

interface ExpectedDetect {
  fixtures: Record<string, string>;
  /**
   * Fixtures gEdit detects wrongly today, with the reason (`owner-public.json`, the owner's
   * real programs). Their `fixtures` entry is still the right answer and is run as an
   * expected failure, so a fix shows up as a failing test instead of passing unnoticed.
   */
  knownGaps?: Record<string, string>;
}

interface ExpectedImprovements {
  improvements: { case: string; path: string; text: string; m0: string; expected: string }[];
}

const EXPECTED_DIR = join(FIXTURES_DIR, 'expected/detect');

function readExpected(name: string): unknown {
  return JSON.parse(readFileSync(join(EXPECTED_DIR, name), 'utf8'));
}

/**
 * One expectation file per folder of `tests/fixtures/nc` (M6 P6 item 11), globbed rather
 * than listed: a content work package adds its dialect's fixtures and their expectations
 * in one file of its own, and no two work packages edit the same JSON. A name that starts
 * with `_` is not a folder (`_improvements.json`).
 */
const FOLDER_FILES = readdirSync(EXPECTED_DIR)
  .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
  .sort()
  .map((name) => readExpected(name) as ExpectedDetect);

const EXPECTED: Required<ExpectedDetect> = {
  fixtures: Object.assign({}, ...FOLDER_FILES.map((file) => file.fixtures)) as Record<string, string>,
  knownGaps: Object.assign({}, ...FOLDER_FILES.map((file) => file.knownGaps ?? {})) as Record<string, string>,
};

const IMPROVEMENTS = readExpected('_improvements.json') as ExpectedImprovements;

describe('the extension weight', () => {
  it('decides on its own when the file says nothing', () => {
    expect(detectBoth('/work/a.h', '')).toEqual([KLARTEXT, KLARTEXT]);
    expect(detectBoth('/work/a.nc', '')).toEqual([FANUC, FANUC]);
    // M8: `.min` is the Okuma main-program extension, and the Fanuc mill gave it up (F22).
    // On content the Okuma profile still scores nothing until WP8.3 writes its rules.
    expect(detectBoth('/work/a.min', '')).toEqual([OKUMA, OKUMA]);
    expect(detectBoth('/work/a.mpf', '')).toEqual([SINUMERIK, SINUMERIK]);
  });

  it('reads the extension off the file name only, in any case', () => {
    expect(extensionOf('/work/A.H')).toBe('h');
    expect(extensionOf('C:\\work\\B.NC')).toBe('nc');
    // A dot in a folder name is not an extension, and neither is a leading dot.
    expect(extensionOf('/work/dir.h/prog')).toBe('');
    expect(extensionOf('/work/.nc')).toBe('');
    expect(extensionOf('/work/O1234')).toBe('');
    expect(detectBoth('C:\\work\\B.NC', '')).toEqual([FANUC, FANUC]);
  });

  it('keeps the fallback for an extension no profile claims', () => {
    expect(detectBoth('/work/a.txt', '')).toEqual([FANUC, KLARTEXT]);
    expect(detectBoth('/work/O1234', '')).toEqual([FANUC, KLARTEXT]);
  });

  it('is not outvoted by a single weak content line', () => {
    expect(detectBoth('/work/a.nc', '12 L X+10 Y+5 R0')).toEqual([FANUC, FANUC]);
  });
});

describe('the content score', () => {
  it('counts a line only for its strongest matching pattern', () => {
    // Both of `two`'s rules match the line. Summed they would be 13 and win; capped at
    // the strongest they are 10, and the single rule of `one` takes it.
    const two = variant('two', {
      content: [
        { pattern: '^N\\d+', weight: 10 },
        { pattern: 'G0', weight: 3 },
      ],
    });
    const exact = variant('exact', { content: [{ pattern: 'G0', weight: 10 }] });
    const higher = variant('higher', { content: [{ pattern: 'G0', weight: 12 }] });
    const line = 'N10 G0 X0\n';
    // A tie with `exact` is only a tie because the 3 did not count: the fallback decides.
    expect(detectProfile([two, exact], null, line, 'exact')).toBe('exact');
    expect(detectProfile([two, exact], null, line, 'two')).toBe('two');
    expect(detectProfile([two, higher], null, line, 'two')).toBe('higher');
  });

  it('adds up over the lines, so content outvotes an extension', () => {
    const klartext = '0 BEGIN PGM PROG MM\n1 TOOL CALL 5 Z S2000\n2 END PGM PROG MM\n';
    expect(detectBoth('/work/prog.nc', klartext)).toEqual([KLARTEXT, KLARTEXT]);
  });

  it('reads only the first 400 non-empty lines', () => {
    const neutral = Array.from({ length: MAX_SNIFF_LINES }, (_, i) => `X${i}.`);
    const marker = '0 BEGIN PGM A MM';
    expect(detectBoth('/work/a.txt', [...neutral, marker].join('\n\n'))).toEqual([FANUC, KLARTEXT]);
    expect(detectBoth('/work/a.txt', [...neutral.slice(1), marker].join('\n\n'))).toEqual([KLARTEXT, KLARTEXT]);
  });

  it('does not read the rest of a large file', () => {
    // Detection is on the open path: it has to look at 400 lines, not at 200 000.
    const big = `%\nO1234\n${Array.from({ length: 200_000 }, (_, i) => `N${i} G1 X${i}.`).join('\n')}\n`;
    expect(detectProfile(BUILTINS, '/work/big.nc', big, KLARTEXT)).toBe(FANUC);
    // A few milliseconds in practice; the limit only catches a full split. One pause of
    // a loaded machine is 100 ms, so the fastest of three runs is what is held to it.
    expectWithin(
      fastest(3, () => detectProfile(BUILTINS, '/work/big.nc', big, KLARTEXT)),
      100,
      '400 lines of a 200 000-line file',
    );
  });

  it('scores a document without a path on its content alone', () => {
    expect(detectBoth(null, '0 BEGIN PGM A MM\n')).toEqual([KLARTEXT, KLARTEXT]);
    expect(detectBoth(null, '%\nO1234\n')).toEqual([FANUC, FANUC]);
    expect(detectBoth(null, '')).toEqual([FANUC, KLARTEXT]);
  });

  it('handles CRLF and CR line endings the same as LF', () => {
    const lines = ['0 BEGIN PGM A MM', '1 TOOL CALL 5 Z S2000', '2 END PGM A MM'];
    for (const eol of ['\n', '\r\n', '\r']) {
      expect(detectProfile(BUILTINS, '/work/a.txt', lines.join(eol), FANUC)).toBe(KLARTEXT);
    }
  });
});

describe('ties', () => {
  it('go to the higher priority before they reach the fallback', () => {
    // One `%` against one Klartext line: 5 against 5 on the shipped profiles. (R1: the
    // line is a `TOOL CALL`, because a numbered `BEGIN PGM` block is decisive now.)
    //
    // In P1 this went to the fallback, because no built-in carried a priority. M6/WP6.2
    // gave the Fanuc mill `detect.priority: 1` so that a Fanuc file scoring the same as
    // the Fanuc lathe stays a mill (AD-18, §8.1), and the priority is the **first**
    // tie-break of AD-11 — so it now settles this stand-off as well. The fallback still
    // decides between profiles of equal priority; `the content score` above shows that.
    expect(detectBoth('/work/a.txt', '%\n1 TOOL CALL 5 Z S2000\n')).toEqual([FANUC, FANUC]);
  });

  /**
   * G8 M6, the reviewer's own program: a turning program a post can perfectly well emit,
   * with no four-digit `T`, no `G50 S`, no `U`/`W`, no cycle that names a block, and
   * every cycle expanded by the CAM. It scored exactly as high on the mill as on the
   * lathe, and a tie goes to the mill by `detect.priority` — even when the document's own
   * profile was the lathe, because the priority is the first tie-break of AD-11.
   *
   * The tie-break order is left as AD-11 and §8.1 wrote it; what such a program lacked
   * was a marker. `G96`/`G97` is one: a turning program states its spindle mode, and a
   * milling program does not have the codes at all (syntax-fanuc §4.2, and §11.5 lists
   * `G96` first among the lathe markers). The second test says which marker is carrying
   * the file, so the day it is dropped this says so instead of quietly going to the mill.
   */
  it('send a turning program with no lathe-only marker to the lathe, from either fallback', () => {
    const turning = [
      '%',
      'O6001 (SHAFT OP1)',
      'G21 G40 G18',
      'G53 X0 Z0',
      'T3 (OD ROUGH CNMG)',
      'G96 S220 M03',
      'G00 X52. Z2. M08',
      'G01 Z-40. F0.25',
      'G00 X54.',
      'G00 X200. Z200. T0',
      'T4 (OD FINISH DNMG)',
      'G96 S260 M03',
      'G00 X50. Z2.',
      'G01 Z-40. F0.12',
      'G00 X200. Z200. T0',
      'M30',
      '%',
      '',
    ].join('\n');
    expect(detectBoth('/work/shaft.nc', turning)).toEqual([LATHE, LATHE]);
  });

  it('and would go to the mill again without the spindle-mode marker', () => {
    // The same program with `G96` taken out: nothing left says lathe, the two Fanuc
    // profiles tie, and the mill's priority decides. That is the residual gap, and the
    // transforms are written for it — a `G7[0-3] P-Q` is reported and never rewritten
    // under the mill profile, and the user guide says to set the dialect by hand.
    const neutral = ['%', 'O6001 (SHAFT OP1)', 'G21 G40 G18', 'G53 X0 Z0', 'T3 (OD ROUGH CNMG)', 'G00 X52. Z2. M08', 'G01 Z-40. F0.25', 'M30', '%', ''].join('\n');
    expect(detectBoth('/work/shaft.nc', neutral)).toEqual([FANUC, FANUC]);
  });

  it('go to the higher priority first', () => {
    const rule = { content: [{ pattern: 'X', weight: 5 }] };
    const plain = variant('plain', rule);
    const important = variant('important', { ...rule, priority: 5 });
    expect(detectProfile([plain, important], null, 'X\n', 'plain')).toBe('important');
    expect(detectProfile([important, plain], null, 'X\n', 'plain')).toBe('important');
  });

  it('go to the registry order when neither the priority nor the fallback decides', () => {
    const first = variant('first', { content: [{ pattern: 'X', weight: 5 }] });
    const second = variant('second', { content: [{ pattern: 'X', weight: 5 }] });
    expect(detectProfile([first, second], null, 'X\n', 'someone-else')).toBe('first');
    expect(detectProfile([second, first], null, 'X\n', 'someone-else')).toBe('second');
  });

  // M6: the user wrote their profile for their own posts, so it beats the one we guessed at.
  it('go to a user profile before a built-in, but after the priority', () => {
    const rule = { content: [{ pattern: 'X', weight: 5 }] };
    const shipped = variant('shipped', rule);
    const mine = variant('mine', rule);
    const important = variant('important', { ...rule, priority: 5 });
    const origin = (cp: CompiledProfile) => (cp.profile.id === 'mine' ? ('user' as const) : ('builtin' as const));

    expect(detectProfile([shipped, mine], null, 'X\n', 'shipped', { origin })).toBe('mine');
    expect(detectProfile([mine, shipped], null, 'X\n', 'shipped', { origin })).toBe('mine');
    // Without the origin everything is a built-in, which is the P1 answer.
    expect(detectProfile([shipped, mine], null, 'X\n', 'shipped')).toBe('shipped');
    // A priority the shipped profile carries still wins: it is the explicit statement.
    expect(detectProfile([mine, important], null, 'X\n', 'mine', { origin })).toBe('important');
  });

  it('are broken by three profiles in the documented order', () => {
    const rule = { content: [{ pattern: 'X', weight: 5 }] };
    const shipped = variant('shipped', rule);
    const mine = variant('mine', rule);
    const important = variant('important', { ...rule, priority: 2 });
    const origin = (cp: CompiledProfile) => (cp.profile.id === 'mine' ? ('user' as const) : ('builtin' as const));
    const all = [shipped, mine, important];

    expect(detectProfile(all, null, 'X\n', 'shipped', { origin })).toBe('important');
    expect(detectProfile([shipped, mine], null, 'X\n', 'shipped', { origin })).toBe('mine');
    expect(detectProfile([shipped, important], null, 'X\n', 'shipped')).toBe('important');
    // Nothing to tell them apart: the fallback, then the registry order.
    expect(detectProfile([shipped, mine], null, 'X\n', 'shipped')).toBe('shipped');
  });
});

// ---------------------------------------------------------------------------
// R1: detection that cannot wreck a program (source review 2026-09, §5)
// ---------------------------------------------------------------------------

describe('decisive headers', () => {
  /** A page of mill moves: one point a line for the Fanuc mill's `Y` rule. */
  const millPage = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `X${i}.5 Y${i}.25 Z-1.`);

  it('decide the dialect against a full page of lines that score for another', () => {
    // 5X_MILLING_VECTOR.H and the Siemens milling programs opened as Fanuc mill: every
    // line that moves Y scored for the mill, and nothing outweighed 400 of them.
    // Under a Siemens header the page of mill moves is a Siemens milling program (M12.5:
    // the milling profile scores a line that moves Y; the turning profile does not).
    const cases: [string, string][] = [
      ['0 BEGIN PGM VECTOR MM', KLARTEXT],
      ['%_N_PLATE_MPF', SINUMERIK_MILL],
      [';$PATH=/_N_WKS_DIR/_N_PLATE_WPD', SINUMERIK_MILL],
      [';%_N_PLATE_MPF', SINUMERIK_MILL],
      ['$PLATE.MIN%', OKUMA],
    ];
    for (const [header, expected] of cases) {
      const text = [header, ...millPage(MAX_SNIFF_LINES - 1)].join('\n');
      for (const path of ['/work/prog.nc', '/work/prog.txt', null]) {
        expect(detectBoth(path, text), `${header} ${String(path)}`).toEqual([expected, expected]);
      }
    }
  });

  it('carry the decisive weight, and no rule below the certain weight can reach it', () => {
    const headers = new Map<string, number>();
    for (const cp of BUILTINS) {
      for (const rule of cp.re.detectContent) {
        if (rule.weight >= DECISIVE_WEIGHT) headers.set(`${cp.profile.id} ${rule.re.source}`, rule.weight);
        // "Hard" (detect.ts): only certain syntax can add up past a header.
        if (rule.weight < CERTAIN_WEIGHT) expect(rule.weight * MAX_SNIFF_LINES, rule.re.source).toBeLessThan(DECISIVE_WEIGHT);
      }
    }
    expect([...headers.values()].every((weight) => weight === DECISIVE_WEIGHT)).toBe(true);
    // M9 (WP9.1): the Sinumerik milling profile carries the same two headers as the turning one.
    expect([...headers.keys()].map((key) => key.split(' ')[0]).sort()).toEqual([
      KLARTEXT, OKUMA, SINUMERIK, SINUMERIK, 'sinumerik-mill', 'sinumerik-mill',
    ]);
  });

  it('give way only where the content contradicts them hard', () => {
    // Another dialect's header is the plainest contradiction: the second one decides by
    // the rest of the file. And 60 lines of Okuma calls add up past a Klartext header.
    const both = ['0 BEGIN PGM A MM', '%_N_A_MPF', 'N10 G0 X0 Z0', 'N20 DIAMON', '1 L X+0 R0 FMAX'].join('\n');
    expect(detectProfile(BUILTINS, '/work/a.txt', both, FANUC)).toBe(SINUMERIK);
    const calls = ['0 BEGIN PGM A MM', ...Array.from({ length: 60 }, (_, i) => `CALL O${1000 + i}`)].join('\n');
    expect(detectProfile(BUILTINS, '/work/a.h', calls, KLARTEXT)).toBe(OKUMA);
    // A `BEGIN PGM` that is not a numbered block is only a Klartext line, not a header.
    expect(detectProfile(BUILTINS, '/work/a.nc', ['BEGIN PGM A MM', ...millPage(10)].join('\n'), KLARTEXT)).toBe(FANUC);
  });
});

describe('Klartext blocks', () => {
  it('count every numbered Klartext statement, LN included, over a line that moves Y', () => {
    // Without the header: the LN program's body alone, as a fragment would be.
    const body = Array.from(
      { length: MAX_SNIFF_LINES },
      (_, i) => `${25 + i} LN X${i}.5 Y1.3 Z-2.5 NX-0.23 NY-0.66 NZ0.70 TX-0.23 TY-0.66 TZ0.70`,
    ).join('\n');
    expect(detectBoth('/work/vector.txt', body)).toEqual([KLARTEXT, KLARTEXT]);
    for (const line of ['12 LN X+1 Y+2', '13 RND R2', '14 APPR LCT X+0 Y+0 R5 RR', '15 CYCL DEF 200 BOHREN', '16 * - NOTE', '17 M3', '18 Q1 = 5']) {
      expect(detectProfile(BUILTINS, null, line, FANUC), line).toBe(KLARTEXT);
    }
  });
});

// ---------------------------------------------------------------------------
// Variants (M6, §7.1, AD-31)
// ---------------------------------------------------------------------------

describe('variant detection', () => {
  /** A profile with one variant of two choices, each with its own rules. */
  function withVariants(
    a: { pattern: string; weight: number }[],
    b: { pattern: string; weight: number }[],
    fallback = 'A',
  ): CompiledProfile {
    const base = BUILTINS[0].profile;
    const profile: Profile = {
      ...structuredClone(base),
      id: 'variants',
      machineParams: {
        variants: [
          {
            id: 'gcodeSystem',
            label: 'G-code system',
            default: fallback,
            choices: [
              { value: 'A', label: 'A', detect: a },
              { value: 'B', label: 'B', detect: b },
            ],
          },
        ],
      },
    };
    return compileProfile(profile);
  }

  /**
   * The weights are the ones that make the presence rule visible: the cycle-return marker
   * a post repeats in every block is worth little, and the single clamp that names the
   * G-code system is worth a lot.
   */
  const cp = withVariants(
    [{ pattern: '(?<![A-Z])G9[89](?!\\d)', weight: 2 }],
    [
      { pattern: '(?<![A-Z])G92(?!\\d)\\s*S', weight: 6 },
      { pattern: '(?<![A-Z])G9[45](?!\\d)', weight: 1 },
    ],
  );

  it('answers nothing for a profile that declares no variant', () => {
    expect(detectVariants(BUILTINS[0], 'G98 G83 X1.\n')).toEqual({});
  });

  it('gives the winner and its margin over the runner-up', () => {
    expect(detectVariants(cp, 'N10 G92 S2000\n')).toEqual({ gcodeSystem: { value: 'B', margin: 6 } });
    expect(detectVariants(cp, 'N10 G98 G81 X1.\n')).toEqual({ gcodeSystem: { value: 'A', margin: 2 } });
  });

  // The rule this scoring exists for (WP6.1): a post writes the cycle return mode into
  // every drilling block, so the incidental marker stands there six times and the decisive
  // one once. Counted per line the habit would win 12 to 6; counted once each, the
  // statement wins 6 to 2 — which is how a person reads the program too.
  it('scores a pattern once for the whole file, however often it repeats', () => {
    const drilling = [
      'N10 G92 S2500',
      ...Array.from({ length: 6 }, (_, i) => `N${20 + i * 10} G99 G83 X${i}. Z-10. Q500 F0.2`),
    ].join('\n');
    const detected = detectVariants(cp, drilling);
    expect(detected).toEqual({ gcodeSystem: { value: 'B', margin: 4 } });
    expect(detected.gcodeSystem.margin).toBeGreaterThanOrEqual(VARIANT_MARGIN);

    // The same program without the clamp is what it looks like, and only barely so.
    const withoutClamp = drilling.split('\n').slice(1).join('\n');
    expect(detectVariants(cp, withoutClamp)).toEqual({ gcodeSystem: { value: 'A', margin: 2 } });
  });

  it('adds up the weights of the different patterns of one choice', () => {
    expect(detectVariants(cp, 'N10 G92 S2000\nN20 G95 F0.2\n')).toEqual({
      gcodeSystem: { value: 'B', margin: 7 },
    });
  });

  it('keeps the default while the margin is below the threshold', () => {
    const both = detectVariants(cp, 'N10 G98 G81 X1.\nN20 G95 F0.2\n');
    expect(both.gcodeSystem).toEqual({ value: 'A', margin: 1 });
    expect(both.gcodeSystem.margin).toBeLessThan(VARIANT_MARGIN);
  });

  it('answers the default with a margin of 0 when nothing matched', () => {
    expect(detectVariants(cp, 'N10 G0 X0\n')).toEqual({ gcodeSystem: { value: 'A', margin: 0 } });
    expect(detectVariants(cp, '')).toEqual({ gcodeSystem: { value: 'A', margin: 0 } });
    const other = withVariants([], [], 'B');
    expect(detectVariants(other, 'N10 G92 S2000\n')).toEqual({ gcodeSystem: { value: 'B', margin: 0 } });
  });

  it('gives a tie to the default, whichever choice is written first', () => {
    const rulesA = [{ pattern: 'AAA', weight: 3 }];
    const rulesB = [{ pattern: 'BBB', weight: 3 }];
    const text = 'N10 AAA\nN20 BBB\n';
    expect(detectVariants(withVariants(rulesA, rulesB), text)).toEqual({
      gcodeSystem: { value: 'A', margin: 0 },
    });
    expect(detectVariants(withVariants(rulesA, rulesB, 'B'), text)).toEqual({
      gcodeSystem: { value: 'B', margin: 0 },
    });
  });

  it('reads a marker inside a comment as text, not as a marker', () => {
    expect(detectVariants(cp, 'N10 (G92 S2000 IS THE CLAMP)\nN20 G98 G81 X1.\n')).toEqual({
      gcodeSystem: { value: 'A', margin: 2 },
    });
  });

  it('reads the first 400 non-empty lines, like profile detection', () => {
    const padding = Array.from({ length: MAX_SNIFF_LINES }, (_, i) => `N${i} X${i}.`);
    expect(detectVariants(cp, [...padding, 'G92 S2000'].join('\n'))).toEqual({
      gcodeSystem: { value: 'A', margin: 0 },
    });
  });

  it('reads the shipped lathe rules on a system-B program whose post writes no clamp', () => {
    // G8 M6, the reviewer's own program. `G92 S` is the decisive system-B marker, and a
    // post that sets the clamp on the offset page never writes one — while the cycle
    // return mode of every drilling block scores for system A. B was ahead by 2 and the
    // margin is 3, so the program was read as system A, where `G78` is not a code at all
    // and its `F` is an ordinary feed.
    //
    // Two answers to that, and this is the second one: `G77`/`G78`/`G79` exist only in
    // system B, which makes them as decisive as the clamp, so the weight is the clamp's.
    // The first answer does not depend on detection at all — the system-A database now
    // carries `G78` as an ambiguous pitch feed, so the lead is refused either way
    // (`data/codes/fanucLathe.test.ts`).
    const lathe = BUILTINS.find((entry) => entry.profile.id === LATHE);
    if (!lathe) throw new Error('no fanuc-lathe profile');
    const program = [
      '%',
      'O4100 (SPINDLE SHAFT)',
      'G21 G40',
      'G28 U0. W0.',
      'T0101 (CENTRE DRILL)',
      'G97 S2000 M03',
      'G00 X0. Z5. M08',
      'G99 G83 Z-6. R2. F0.08',
      'G98 G80',
      'G00 X200. Z200. T0100',
      'T0303 (THREAD 60DEG)',
      'G97 S700 M03',
      'G00 X32. Z5.',
      'G78 X29.5 Z-25. F1.5',
      'G78 X29.1 Z-25. F1.5',
      'G78 X28.8 Z-25. F1.5',
      'G00 X200. Z200. T0300',
      'M30',
      '%',
      '',
    ].join('\n');
    const detected = detectVariants(lathe, program);
    expect(detected.gcodeSystem).toEqual({ value: 'B', margin: 3 });
    // The two R6 variants carry no rules: they answer with their default and a margin of 0.
    expect(detected.incrementalAddresses).toEqual({ value: 'uw', margin: 0 });
    expect(detected.toolWord).toEqual({ value: 'byLength', margin: 0 });
    expect(detected.gcodeSystem.margin).toBeGreaterThanOrEqual(VARIANT_MARGIN);

    // Without the threading passes it is a drilling program that says nothing about the
    // system, and the documented default A stands — which is the honest answer.
    const drillingOnly = program
      .split('\n')
      .filter((line) => !line.startsWith('G78'))
      .join('\n');
    expect(detectVariants(lathe, drillingOnly).gcodeSystem).toEqual({ value: 'A', margin: 2 });
  });

  it('leaves a rule that does not compile out instead of throwing', () => {
    const broken = withVariants([{ pattern: '(', weight: 4 }], [{ pattern: 'G92', weight: 4 }]);
    expect(detectVariants(broken, 'N10 G98\n')).toEqual({ gcodeSystem: { value: 'A', margin: 0 } });
    expect(detectVariants(broken, 'N10 G92 S1\n')).toEqual({ gcodeSystem: { value: 'B', margin: 4 } });
  });
});

describe('vetoes', () => {
  // M9 NC review F3: a veto takes a profile out of the file, however much it scored.
  const strong = variant('strong', { content: [{ pattern: 'M6', weight: 50 }], vetoes: ['DIAMON'] });
  const weak = variant('weak', { content: [{ pattern: 'G1', weight: 1 }] });

  it('take the profile out of a file that has the vetoed word on any scanned line', () => {
    const text = 'N10 G1 X1\nN20 M6\nN30 M6\nN40 DIAMON\n';
    expect(detectProfile([strong, weak], null, text, 'strong')).toBe('weak');
    expect(detectScores([strong, weak], null, text)).toEqual([0, 1]);
  });

  it('leave the profile alone without the word, or with it past the scanned lines', () => {
    expect(detectProfile([strong, weak], null, 'N10 G1 X1\nN20 M6\n', 'weak')).toBe('strong');
    const late = [...Array.from({ length: MAX_SNIFF_LINES }, () => 'M6'), 'DIAMON'].join('\n');
    expect(detectProfile([strong, weak], null, late, 'weak')).toBe('strong');
  });

  it('keep the fallback when the vetoed profile was the only one that scored', () => {
    expect(detectProfile([strong], null, 'M6\nDIAMON\n', 'other')).toBe('other');
  });

  it('do not override a folder, which is the user\'s own choice', () => {
    const machine = variant('machine', { folders: ['/cam/mill'], vetoes: ['DIAMON'] });
    expect(detectProfile([weak, machine], '/cam/mill/a.nc', 'G1\nDIAMON\n', 'weak')).toBe('machine');
  });
});

describe('folders', () => {
  const machine = variant('machine', { folders: ['D:/CAM/mill3', '/Volumes/nc'] });
  const other = variant('other', { extensions: { nc: 100 }, content: [{ pattern: 'X', weight: 50 }] });
  const profiles = [other, machine];

  it('win outright, whatever the extension and the content say', () => {
    expect(detectProfile(profiles, 'D:/CAM/mill3/part.nc', 'X\n', 'other')).toBe('machine');
    expect(detectProfile(profiles, '/Volumes/nc/sub/dir/part.nc', 'X\n', 'other')).toBe('machine');
  });

  it('accept both separators and ignore case', () => {
    expect(detectProfile(profiles, 'D:\\CAM\\mill3\\part.nc', '', 'other')).toBe('machine');
    expect(detectProfile(profiles, 'd:/cam/MILL3/part.nc', '', 'other')).toBe('machine');
  });

  it('match whole path segments only', () => {
    expect(detectProfile(profiles, 'D:/CAM/mill3x/part.nc', '', 'other')).toBe('other');
    // The folder itself is not a file in it.
    expect(detectProfile(profiles, 'D:/CAM/mill3', '', 'other')).toBe('other');
  });

  it('let the deepest folder win', () => {
    const root = variant('root', { folders: ['/cam'] });
    const deep = variant('deep', { folders: ['/cam/mill3'] });
    expect(detectProfile([root, deep], '/cam/mill3/part.nc', '', 'root')).toBe('deep');
    expect(detectProfile([deep, root], '/cam/other/part.nc', '', 'deep')).toBe('root');
  });

  it('are skipped for a document without a path', () => {
    expect(detectProfile(profiles, null, 'X\n', 'machine')).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// M12.5: how sure detection is (`detectResult`, §7.16 #177; WP-RP1)
// ---------------------------------------------------------------------------

describe('detectResult', () => {
  /** A profile of its own grammar, for the family margin. */
  function ofGrammar(id: string, grammar: string, detect: Partial<Profile['detect']>): CompiledProfile {
    const cp = variant(id, detect);
    return compileProfile({ ...cp.profile, grammar } as Profile);
  }
  const iso = ofGrammar('iso', 'iso', { content: [{ pattern: '^N\\d+', weight: 1 }, { pattern: '^%$', weight: 5 }] });
  const isoTwin = ofGrammar('iso-twin', 'iso', { content: [{ pattern: '^N\\d+', weight: 1 }] });
  const other = ofGrammar('other', 'other', {
    content: [{ pattern: '^N\\d+', weight: 1 }, { pattern: 'MARK=', weight: CERTAIN_WEIGHT }],
  });
  const lines = (count: number): string[] => Array.from({ length: count }, (_, i) => `N${i + 1} X${i}`);

  it('answers what detectProfile answers, with how it got there', () => {
    const cases: [CompiledProfile[], string | null, string, string][] = [
      [BUILTINS, '/work/a.nc', '%\nO1234\nN10 G0 X0\n', KLARTEXT],
      [BUILTINS, '/work/a.txt', '', 'siemens-840d'],
      [BUILTINS, null, '0 BEGIN PGM A MM\n', FANUC],
      [[], '/work/a.nc', 'N1', FANUC],
      [[iso, isoTwin, other], '/work/a', lines(9).join('\n'), 'other'],
    ];
    for (const [profiles, path, text, fallback] of cases) {
      expect(detectResult(profiles, path, text, fallback).id).toBe(detectProfile(profiles, path, text, fallback));
    }
    expect(detectResult(BUILTINS, '/work/a.txt', '', 'siemens-840d')).toEqual({
      id: 'siemens-840d', by: 'fallback', score: 0, rival: null, familyMargin: 0, certain: false, uncertain: false,
    });
  });

  it('measures the margin against another grammar only, and calls a near tie uncertain', () => {
    // Nine numbered lines score 9 on all three; `iso` wins the tie by registry order. Its
    // twin of the same grammar is no rival: mill against lathe is not a dialect question.
    const result = detectResult([iso, isoTwin, other], '/work/a', lines(9).join('\n'), 'iso');
    expect(result).toEqual({ id: 'iso', by: 'content', score: 9, rival: 'other', familyMargin: 0, certain: false, uncertain: true });
    // Five points of markers only one grammar writes are enough (the calibrated margin).
    const header = detectResult([iso, isoTwin, other], '/work/a', ['%', ...lines(9)].join('\n'), 'iso');
    expect(header.familyMargin).toBe(UNCERTAIN_FAMILY_MARGIN);
    expect(header.uncertain).toBe(false);
  });

  it('is never uncertain on a certain rule of the winner, a short text, a folder or no score', () => {
    const certain = detectResult([iso, other], '/work/a', ['MARK=1', ...lines(9)].join('\n'), 'iso');
    expect(certain).toMatchObject({ id: 'other', certain: true, uncertain: false });
    const short = detectResult([iso, isoTwin, other], '/work/a', lines(UNCERTAIN_MIN_LINES - 1).join('\n'), 'iso');
    expect(short).toMatchObject({ familyMargin: 0, uncertain: false });
    const enough = detectResult([iso, isoTwin, other], '/work/a', lines(UNCERTAIN_MIN_LINES).join('\n'), 'iso');
    expect(enough.uncertain).toBe(true);
    const mine = ofGrammar('mine', 'iso', { folders: ['/cam/mill'] });
    expect(detectResult([iso, other, mine], '/cam/mill/a.nc', lines(9).join('\n'), 'iso')).toMatchObject({
      id: 'mine', by: 'folder', uncertain: false,
    });
    expect(detectResult([iso, other], '/work/a', 'nothing here\n'.repeat(9), 'iso')).toMatchObject({
      id: 'iso', by: 'fallback', uncertain: false,
    });
  });

  it('reads a decisive header of the built-ins as certain', () => {
    const text = ['%_N_PLATE_MPF', ...Array.from({ length: 20 }, (_, i) => `N${i} G1 X${i}`)].join('\n');
    expect(detectResult(BUILTINS, '/work/a.mpf', text, FANUC)).toMatchObject({ certain: true, uncertain: false });
    expect(detectResult(BUILTINS, '/work/a.mpf', text, FANUC).score).toBeGreaterThanOrEqual(DECISIVE_WEIGHT);
  });
});

describe('nothing to go on', () => {
  it('returns the fallback unchanged, even when no profile carries that id', () => {
    expect(detectProfile(BUILTINS, '/work/a.txt', '', 'siemens-840d')).toBe('siemens-840d');
    expect(detectProfile([], '/work/a.h', '0 BEGIN PGM A MM', FANUC)).toBe(FANUC);
  });
});

describe('every NC fixture', () => {
  it('has an expectation', () => {
    expect(Object.keys(EXPECTED.fixtures).sort()).toEqual(listFixtures('nc'));
  });

  it('lists a known gap only for a fixture it has an answer for', () => {
    expect(Object.keys(EXPECTED.knownGaps).filter((rel) => !(rel in EXPECTED.fixtures))).toEqual([]);
  });

  for (const [rel, expected] of Object.entries(EXPECTED.fixtures)) {
    // A known gap fails today on purpose: the answer above is the right one, not gEdit's.
    const test = rel in EXPECTED.knownGaps ? it.fails : it;
    test(`${rel} -> ${expected}`, () => {
      const opened = openFixture(rel);
      if (expected === 'refused') {
        expect(opened.refused).toBeTypeOf('string');
        return;
      }
      if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
      // The open dialog returns absolute paths.
      const result = detectBoth(`/work/${rel}`, opened.text);
      expect(result).toEqual(expected === 'fallback' ? [FANUC, KLARTEXT] : [expected, expected]);
    });
  }
});

describe('the results that moved since M0', () => {
  it('lists an improvement for every hand-written case, and no case that did not move', () => {
    expect(IMPROVEMENTS.improvements.length).toBeGreaterThan(0);
    for (const improvement of IMPROVEMENTS.improvements) {
      expect(improvement.expected, improvement.case).not.toBe(improvement.m0);
      const answers = detectBoth(improvement.path, improvement.text);
      expect(answers, improvement.case).toEqual([improvement.expected, improvement.expected]);
    }
  });
});
