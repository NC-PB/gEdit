// What the shipped Sinumerik milling profile decides about a file (plan §6 M9 WP9.1,
// roadmap R2; gate G10 §8.7 items 4 and 5a). Owner: WP9.1.
//
// `sinumerik-mill` is a child of the turning profile `sinumerik` (AD-16): the same
// language, syntax, code database, number preset and program-map rules. It changes four
// things, and each of them decides something a machinist sees:
//
//   1. **Which of the two Siemens profiles?** Both share every Siemens marker and the
//      decisive headers, so only what one kind of machine writes may decide between them:
//      `M6` in a block without a `T` number, `G17`/`G94`, `CYCLE800`, `CYCLE832` and the
//      milling cycles for milling; `DIAMON`, `LIMS=`, `G96`/`G97`, `TRANSMIT`/`TRACYL`
//      and the spindle-addressed words for turning, because this profile leaves them out.
//      A line that moves `Y` is **not** counted for milling, as R2 first proposed: the
//      owner's mill-turn program `TURN_1.mpf` moves `Y` on 78 of its first 400 lines and
//      writes 22 turning markers, and a mill-turn program has to stay with the turning
//      profile (R2). A file with neither kind of evidence ties, and the tie goes to turning
//      (`detect.priority` -2 here, -1 there). And the turning words are a **veto**, not a
//      weight (M9 NC review F3, `detect.vetoes`): one `DIAMON`, `DIAM90`, `LIMS=`,
//      `SETMS`, `TRANSMIT`, `TRACYL` or spindle-addressed `S3=` / `M3=` outside a comment
//      or string takes the milling profile out, so a mill-turn program whose milling
//      operations outnumber its turning ones still opens as turning.
//   2. **When does the tool change?** At `M6`, with the `T` of that block or the last one
//      before it: a `T` alone is a preselect, `T0` before `M6` empties the spindle.
//   3. **Where does a program start?** In `G17` with feed per minute (`G94`), the
//      control's reset state, instead of the turning profile's `G18`/`G95`.
//   4. **Is X a diameter?** Not at power-on (`machineParams.diameter: "off"`); `DIAMON`
//      still switches it on, as on any Siemens control.

import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { MAX_SNIFF_LINES, detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CompiledProfile } from '$lib/core/profiles/types';

const MILLING = 'sinumerik-mill';
const TURNING = 'sinumerik';
const FANUC = 'fanuc-gcode';

/** The distance §8.5 and WP9.1 ask for between the winner and the runner-up. */
const MIN_MARGIN = 3;

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

const mill = compiled(MILLING);
const turn = compiled(TURNING);

function readFixture(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
  return opened.text;
}

/** The first `MAX_SNIFF_LINES` non-empty lines, trimmed, as detection reads them. */
function sniffLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line !== '') out.push(line);
    if (out.length >= MAX_SNIFF_LINES) break;
  }
  return out;
}

/** One profile's score, by the rules of `detect.ts` (strongest rule per line, plus the extension). */
function score(cp: CompiledProfile, path: string | null, text: string): number {
  const name = path === null ? '' : (path.split(/[\\/]/).pop() ?? '');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  let total = ext === '' ? 0 : (cp.profile.detect.extensions?.[ext] ?? 0);
  const rules = [...cp.re.detectContent].sort((a, b) => b.weight - a.weight);
  const lines = sniffLines(text);
  for (const line of lines) {
    for (const rule of rules) {
      if (rule.re.test(line)) {
        total += rule.weight;
        break;
      }
    }
  }
  // A veto (`detect.vetoes`, rule 5 of detect.ts) takes the profile out of the file.
  if (cp.re.detectVetoes.some((veto) => lines.some((line) => veto.test(line)))) return 0;
  return total;
}

/** The weight of the strongest rule one line matches. */
function lineScore(cp: CompiledProfile, line: string): number {
  return score(cp, null, line);
}

/** Every Siemens fixture, by the folder that names its profile. */
const SIEMENS = listFixtures('nc').filter((rel) => /^nc\/(?:owner-public\/)?sinumerik(?:-mill)?\//.test(rel));
const folderOf = (rel: string): string => (/\/sinumerik-mill\//.test(rel) ? MILLING : TURNING);

/**
 * The fixtures that carry no evidence of either kind of machine: a subprogram of plain
 * moves and logic. Their margin is 0 by construction, and the priority settles it.
 */
const NEUTRAL = ['nc/sinumerik/s03-sub.SPF'];

// ---------------------------------------------------------------------------
// 1. Which of the two Siemens profiles
// ---------------------------------------------------------------------------

describe('milling against turning', () => {
  const printed: string[] = [];

  it('has the milling fixtures §9.1 names, and the owner-public milling programs', () => {
    for (const rel of [
      'nc/sinumerik-mill/m01-plate.MPF',
      'nc/sinumerik-mill/m02-five-axis.MPF',
      'nc/sinumerik-mill/detect-sinumerik-mill.txt',
      'nc/sinumerik-mill/s06-milling.txt',
      'nc/owner-public/sinumerik-mill/2.5D_Milling.mpf',
      'nc/owner-public/sinumerik-mill/5X_Milling.mpf',
      'nc/owner-public/sinumerik-mill/DRILLING.mpf',
      'nc/owner-public/sinumerik-mill/Demo_1.mpf',
      'nc/owner-public/sinumerik/TURN_1.mpf',
    ]) {
      expect(SIEMENS, rel).toContain(rel);
    }
  });

  it.each(SIEMENS)('%s goes to the profile its folder names, by at least 3 over the other one', (rel) => {
    const text = readFixture(rel);
    const path = `/work/${rel}`;
    const want = folderOf(rel);
    const other = want === MILLING ? TURNING : MILLING;
    const mine = score(compiled(want), path, text);
    const theirs = score(compiled(other), path, text);
    expect(detectProfile(BUILTINS, path, text, FANUC), rel).toBe(want);
    // Whichever profile the document had before: a tie must not go to the fallback.
    expect(detectProfile(BUILTINS, path, text, other), rel).toBe(want);
    printed.push(`${rel}: ${want} ${mine}, ${other} ${theirs}, +${mine - theirs}`);
    if (NEUTRAL.includes(rel)) {
      expect(mine - theirs, rel).toBe(0);
      expect(want).toBe(TURNING);
      return;
    }
    expect(mine - theirs, `${rel}: ${want} ${mine} against ${other} ${theirs}`).toBeGreaterThanOrEqual(MIN_MARGIN);
  });

  it('prints the margins for the review', () => {
    expect(printed.length).toBe(SIEMENS.length);
    console.log(`Sinumerik milling against turning (G10 §8.7 item 4):\n  ${printed.sort().join('\n  ')}`);
  });

  it('lets a neutral file tie, and gives the tie to turning by priority, from either fallback', () => {
    expect(mill.profile.detect.priority).toBeLessThan(turn.profile.detect.priority ?? 0);
    const text = readFixture(NEUTRAL[0]);
    for (const fallback of [FANUC, MILLING, TURNING]) {
      expect(detectProfile(BUILTINS, '/work/sub.SPF', text, fallback), fallback).toBe(TURNING);
    }
  });

  it('keeps a mill-turn program with a magazine with turning, M6 on every tool notwithstanding', () => {
    // A turn-mill centre changes every tool, turning or driven, with M6 (R2: a mill-turn
    // program is still read as turning). The turning words decide.
    const text = [
      '%_N_SHAFT_MT_MPF',
      ';$PATH=/_N_WKS_DIR/_N_SHAFT_MT_WPD',
      'N10 G18 G90 G95 G40 G500 DIAMON',
      'N20 G54',
      'N30 T="ROUGH_80" D1',
      'N40 M6',
      'N50 G96 S200 LIMS=3000 M4',
      'N60 G0 X64 Z2 M8',
      'N70 CYCLE95("SHAFT_CONTOUR",2,0.2,0.4,,0.3,0.25,0.12,9,,,0.5)',
      'N80 G0 X200 Z200 M9',
      'N90 T="FINISH_35" D1',
      'N100 M6',
      'N110 G96 S260 LIMS=3500 M4',
      'N120 G0 X34 Z2 M8',
      'N130 G42 G1 Z0 F0.2',
      'N140 X40 Z-1',
      'N150 G40 G0 X200 Z200 M9',
      'N160 T="DRILL_D8" D1',
      'N170 M6',
      'N180 SETMS(3)',
      'N190 DIAMOF',
      'N200 TRANSMIT',
      'N210 G17 G94',
      'N220 S3=2400 M3=3',
      'N230 G0 X30 Y0 Z5 M8',
      'N240 F120',
      'N250 MCALL CYCLE83(5,0,2,-18,,-5,,2,0,0.5,1,0)',
      'N260 X30 Y0',
      'N270 X-15 Y25.981',
      'N280 X-15 Y-25.981',
      'N290 MCALL',
      'N300 G0 Z50 M9',
      'N310 M3=5',
      'N320 TRAFOOF',
      'N330 SETMS(1)',
      'N340 DIAMON',
      'N350 G18 G95',
      'N360 G0 X200 Z200',
      'N370 M30',
    ].join('\n');
    for (const path of ['/work/shaft.MPF', '/work/shaft.txt', null]) {
      expect(detectProfile(BUILTINS, path, text, MILLING), String(path)).toBe(TURNING);
      expect(score(turn, path, text) - score(mill, path, text), String(path)).toBeGreaterThanOrEqual(MIN_MARGIN);
    }
  });

  it('keeps a mill-turn program with more milling than turning operations with turning (M9 NC review F3)', () => {
    // One turning operation, one milling operation, M6 on both tools: the milling words
    // outscored the turning ones by 1 and the program opened as milling. One turning word
    // is enough now (`detect.vetoes`); `nc/sinumerik/s07-mill-turn.MPF` is the same with
    // three milling operations (+17 for milling before the vetoes).
    const text = [
      '%_N_FLANGE_MPF',
      ';$PATH=/_N_WKS_DIR/_N_FLANGE_WPD',
      'N10 G18 G90 G95 G40 G500 DIAMON',
      'N20 G54',
      'N30 T="ROUGH_80" D1',
      'N40 M6',
      'N50 G96 S220 LIMS=3000 M4',
      'N60 G0 X84 Z2 M8',
      'N70 G1 Z0 F0.25',
      'N80 X-1.6',
      'N120 G0 X200 Z200 M9',
      'N200 T="EM10" D1',
      'N210 M6',
      'N220 G17 G94 DIAMOF',
      'N230 SETMS(4)',
      'N240 CYCLE800(1,"",0,57,0,0,0,0,90,0,0,0,0,-1,100,1)',
      'N250 S6000 M3',
      'N260 G0 X20 Y0 Z5 M8',
      'N270 CYCLE61(50,0,1,0,0,0,80,80,1,500,0.1,0,0,10000)',
      'N280 G0 Z50 M9',
      'N290 CYCLE800()',
      ...Array.from({ length: 10 }, (_, i) => `N${300 + 10 * i} G1 X${20 + i} Y${i} Z-${i % 3} F800`),
      'N900 SETMS(1)',
      'N910 G18 G95 DIAMON',
      'N920 M30',
    ].join('\n');
    const unvetoed = BUILTINS.map((cp) =>
      cp.profile.id === MILLING ? compileProfile({ ...cp.profile, detect: { ...cp.profile.detect, vetoes: [] } }) : cp,
    );
    for (const path of ['/work/flange.MPF', '/work/flange.txt', null]) {
      for (const fallback of [MILLING, TURNING, FANUC]) {
        expect(detectProfile(BUILTINS, path, text, fallback), `${path} ${fallback}`).toBe(TURNING);
      }
      expect(score(turn, path, text) - score(mill, path, text), String(path)).toBeGreaterThanOrEqual(MIN_MARGIN);
      // Without the vetoes the milling words win, which is the regression.
      expect(detectProfile(unvetoed, path, text, TURNING), `${path} without vetoes`).toBe(MILLING);
    }
    const fixture = readFixture('nc/sinumerik/s07-mill-turn.MPF');
    expect(detectProfile(unvetoed, '/work/s07-mill-turn.MPF', fixture, TURNING)).toBe(MILLING);
  });

  it('is vetoed by every Siemens turning word, and by none in a comment, a string or a milling program', () => {
    const vetoed = (line: string): boolean => mill.re.detectVetoes.some((veto) => veto.test(line));
    for (const line of [
      'N10 G18 G90 G95 G40 G500 DIAMON',
      'N20 DIAM90',
      'N50 G96 S200 LIMS=3000 M4',
      'N60 LIMS = 25000',
      'N180 SETMS(4)',
      'N185 SETMS',
      'N150 TRANSMIT',
      'N160 TRACYL(40)',
      'N170 S3=2400 M3=3',
      'N175 M1=4',
    ]) {
      expect(vetoed(line), line).toBe(true);
    }
    for (const line of [
      '; DIAMON ON THE LATHE',
      'N10 G0 X0 ; LIMS=3000',
      'N20 MSG("SETMS(4) NEXT")',
      'N30 T="TRANSMIT_TOOL" D1',
      '(DIAMON)',
      'N40 G97 S5000 M3',
      'N50 DIAMOF',
      'N60 G17 G94',
      'N70 T1 M6',
      'N80 R1=S1',
      '12 L X+0 R0 FMAX M3',
    ]) {
      expect(vetoed(line), line).toBe(false);
    }
    // No milling fixture writes a turning word, so none of them is vetoed.
    for (const rel of SIEMENS.filter((r) => folderOf(r) === MILLING)) {
      expect(sniffLines(readFixture(rel)).filter(vetoed), rel).toEqual([]);
    }
  });

  it('scores the milling words higher than the turning profile does, and the turning words lower', () => {
    for (const line of [
      'N50 M6',
      'M06',
      'N30 T="FACEMILL_D50" M6',
      'N80 G0 G17 X241.781 Y286',
      'N10 G0 G40 G90 G94',
      'N20 CYCLE800',
      'N100 CYCLE800(1,"DMG",0,27,0,0,0,0,0,0,0,0,0,-1)',
      'N120 CYCLE832(0.01,_ORI_FINISH,0.5)',
      'N140 CYCLE61(50,0,2,-1,-10,-10,130,90,2,40,0,900,31,0)',
      'POCKET3(50,0,1,-6,40,20,4,60,40,0,2,0.2,0,800,600,0,11,10)',
    ]) {
      expect(lineScore(mill, line), line).toBeGreaterThan(lineScore(turn, line));
    }
    for (const line of [
      'N10 G18 G90 G95 G40 G500 DIAMON',
      'N50 G96 S200 LIMS=3000 M4',
      'N120 G97 S1800 M3',
      'N60 LIMS=25000',
      'N150 TRANSMIT',
      'N160 TRACYL(40)',
      'N170 S3=2400 M3=3',
    ]) {
      expect(lineScore(turn, line), line).toBeGreaterThan(lineScore(mill, line));
    }
    // A line that moves Y counts for neither (point 1 above).
    expect(lineScore(mill, 'N140 Y25.969')).toBe(0);
    expect(lineScore(mill, 'N150 G2 X226.031 Y10.219 F800')).toBe(0);
  });

  it('gives a Fanuc tool change, a comment and a Klartext block no milling bonus', () => {
    // A Fanuc post writes the tool and M6 in one block; a Siemens milling post writes `T1 D1`
    // and `M6` apart, or `T="NAME" M6`. The bonus is for the Siemens forms only, so the Fanuc
    // mill programs keep their margin.
    expect(lineScore(mill, 'N20 T1 M6')).toBe(1);
    expect(lineScore(mill, 'T01 M06')).toBe(0);
    expect(lineScore(mill, 'M6 T1')).toBe(1);
    expect(lineScore(mill, '(TOOL CHANGE M6)')).toBe(0);
    expect(lineScore(mill, '; M6 AFTER THE PRESELECT')).toBe(1);
    expect(lineScore(mill, 'N60 ; M6')).toBe(1);
    expect(lineScore(mill, 'MSG("M6 NEXT")')).toBe(3);
    expect(lineScore(mill, '12 L Z+100 R0 FMAX M6')).toBe(0);
    expect(lineScore(mill, '5 CYCL DEF 832')).toBe(0);
  });

  it('matches every content rule on some Siemens fixture line', () => {
    const own = SIEMENS.flatMap((rel) => sniffLines(readFixture(rel)));
    for (const rule of mill.re.detectContent) {
      expect(own.some((line) => rule.re.test(line)), `${rule.re.source} matches no fixture line`).toBe(true);
    }
  });

  it('fires its Siemens markers on no line of another dialect, and never outscores another dialect on its own file', () => {
    // G10 §8.7 item 4. Five rules are this profile's own: CYCLE800, the milling cycles and
    // the transformation words without TRANSMIT/TRACYL are Siemens-only and must not fire
    // elsewhere. M6 in its own block and G17/G94 are what a Fanuc mill writes too
    // (`f03-multi-program.nc` has an `M6` block): they tell milling from turning, not one
    // dialect from another, so what is asserted for them is that no other dialect's file
    // comes within 3 of being read as Siemens milling.
    const ownRules = mill.re.detectContent.filter(
      (rule) => !turn.re.detectContent.some((other) => other.re.source === rule.re.source),
    );
    expect(ownRules.length).toBe(5);
    const millingWords = (source: string): boolean => /M0\*6|G0\*\(\?:17\|94\)/.test(source);
    expect(ownRules.filter((rule) => millingWords(rule.re.source)).length).toBe(2);
    const others = listFixtures('nc').filter((rel) => !SIEMENS.includes(rel) && openFixture(rel).refused === null);
    const foreign = others.flatMap((rel) => sniffLines(readFixture(rel)));
    for (const rule of ownRules) {
      if (millingWords(rule.re.source)) continue;
      expect(foreign.filter((line) => rule.re.test(line)), `${rule.re.source} fires in another dialect`).toEqual([]);
    }
    for (const rel of others) {
      const path = `/work/${rel}`;
      const text = readFixture(rel);
      const best = Math.max(...BUILTINS.map((cp) => score(cp, path, text)));
      if (best === 0) continue;
      expect(detectProfile(BUILTINS, path, text, MILLING), rel).not.toBe(MILLING);
      expect(best - score(mill, path, text), rel).toBeGreaterThanOrEqual(MIN_MARGIN);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The tool rule
// ---------------------------------------------------------------------------

describe('the tool change', () => {
  function toolRows(cp: CompiledProfile, lines: string[]): [number, string | undefined][] {
    const index = new OutlineIndex(cp);
    index.reset(lines);
    return index
      .items()
      .flatMap((item) => [item, ...(item.children ?? [])])
      .filter((item) => item.kind === 'tool')
      .map((item) => [item.line, item.tool]);
  }

  it('is M6, with the T of its block or the last one before it', () => {
    expect(mill.profile.toolCall.toolFrom).toBe('same-line-or-last');
    expect(
      toolRows(mill, [
        'N10 T1 D1',
        'N20 M6',
        'N30 T2',
        'N40 S3000 M3',
        'N50 T2 D1',
        'N60 M6',
        'N70 T="BALL_D6"',
        'N80 T="BALL_D6" M6',
        'N90 T7=12 D1',
        'N100 M06',
      ]),
    ).toEqual([
      [2, '1'],
      [6, '2'],
      [8, '"BALL_D6"'],
      [10, '12'],
    ]);
  });

  it('does not change on a T alone, on M60 or M6 in a string, and empties the spindle on T0', () => {
    expect(toolRows(mill, ['N10 T1', 'N20 T="DRILL"', 'N30 M60', 'N40 MSG("M6")', 'N50 M61=6'])).toEqual([]);
    // `T0` deselects the tool: `T0` then `M6`, or both in one block, put it away.
    expect(toolRows(mill, ['N10 T1 D1', 'N20 M6', 'N30 T0', 'N40 M5', 'N50 M6'])).toEqual([[2, '1']]);
    expect(toolRows(mill, ['N10 T1 M6', 'N20 T0 M6', 'N30 T00 M6', 'N40 T1=0 M6'])).toEqual([[1, '1']]);
  });

  it('gives the owner-public drilling program one segment per tool, where the turning rule gave nine', () => {
    // The TODO item of M8: read as turning, every preselect was a change of its own.
    const lines = readFixture('nc/owner-public/sinumerik-mill/DRILLING.mpf').split('\n');
    expect(toolRows(mill, lines)).toEqual([
      [8, '1'],
      [746, '2'],
      [2406, '3'],
      [2435, '5'],
      [2457, '4'],
    ]);
    expect(toolRows(turn, lines).length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 3. and 4. Power-on state and diameter programming
// ---------------------------------------------------------------------------

describe('what a milling program starts with', () => {
  it('starts in G17 with feed per minute, where the turning profile starts in G18 per revolution', () => {
    expect(mill.profile.modal?.initial).toEqual({ plane: 'G17', feedmode: 'G94' });
    expect(turn.profile.modal?.initial).toEqual({ plane: 'G18', feedmode: 'G95' });
  });

  it('starts with diameter programming off, as an assumption a machine can change', () => {
    const none = noMachine(mill.profile);
    expect(none.params.diameter).toBe('off');
    expect(none.source.diameter).toBe('profile');
    expect(applyMachine(mill.profile, none).profile.modal?.diameter).toBe('off');
    expect(applyMachine(turn.profile, noMachine(turn.profile)).profile.modal?.diameter).toBe('on');
  });

  it('is a milling profile of its own in the lists, and the turning profile in everything else', () => {
    expect(mill.profile.machineType).toBe('mill');
    expect(mill.profile.files.filterName).toBe('Sinumerik milling');
    expect(mill.profile.files.extensions).toEqual(turn.profile.files.extensions);
    // AD-16: what it does not change it inherits, so the two cannot drift apart.
    expect(mill.profile.codes).toBe(TURNING);
    expect(mill.profile.grammar).toBe(TURNING);
    expect(mill.profile.syntax).toEqual(turn.profile.syntax);
    expect(mill.profile.outline).toEqual(turn.profile.outline);
    expect(mill.profile.numbering).toEqual(turn.profile.numbering);
    expect(mill.profile.program).toEqual(turn.profile.program);
    // P10 (§6 M10 item 4): the milling profile names its rotary axes, A and B as well as C,
    // as axes and as angles, so a simultaneous rotary move is seen (address arithmetic refuses
    // it without tool centre point control) and extents can list them. Nothing else differs.
    const { axes, angular, ...rest } = mill.profile.addresses ?? {};
    const { axes: turnAxes, angular: turnAngular, ...turnRest } = turn.profile.addresses ?? {};
    expect(rest).toEqual(turnRest);
    expect(axes).toEqual(['X', 'Y', 'Z', 'A', 'B', 'C']);
    expect(angular).toEqual(['A', 'B', 'C', 'AR', 'SF']);
    expect([turnAxes, turnAngular]).toEqual([['X', 'Z', 'C', 'Y'], ['C', 'AR', 'SF']]);
    expect(mill.profile.toolCall.tool).toBe(turn.profile.toolCall.tool);
    expect(mill.profile.machineParams?.numberInput).toEqual(turn.profile.machineParams?.numberInput);
  });
});
