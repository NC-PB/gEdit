// What the shipped Okuma OSP profile decides about a file (plan §8.4, §8.8, AD-24, AD-31,
// and gate G10 §8.7 items 4 and 5a). Owner: WP8.3.
//
// The `syntax` section is **not** tested here: the M8 prelude pinned it for the milestone
// (P8 item 3), and the tokenizer and grammar packages own what it does. This file answers
// the rest of the profile, and every assertion in it decides something a machinist sees:
//
//   1. **Which profile?** Line by line an Okuma turning program is Fanuc lathe code:
//      `G00 X600 Z400`, `G96 S180 M03` and `G50 S2500` read the same on both controls.
//      What tells them apart is a handful of words — the `$NAME.MIN%` header, a six-digit
//      `T`, `SB=`, `CALL O…`, `RTS`, `V1 =`, a named sequence — and the extension. So:
//        - an Okuma extension decides on its own. `.MIN`, `.SUB` and `.SSB` belong to this
//          control alone, and a program with four-digit `T` words and nothing else of this
//          control cannot be told from a Fanuc lathe program on its content, so the weight
//          is set above anything 400 lines of content can reach;
//        - the `$NAME.MIN%` header decides just as firmly wherever the file came from, and
//          the syntax only this control writes (`CALL O`, `RTS`, the driven-tool cycles, a
//          LAP call, a `G71` thread with `H` and `D`, a `G77` tap with `K`, a `$` line)
//          outweighs any pile of shared lines (G10 M8: `o01-flange.MIN` saved as `.nc`
//          opened as a Fanuc lathe program, and its `G71` lead was scaled as a feed);
//        - on content alone the profile claims the lines both lathes share with the Fanuc
//          lathe's own weights (a G/M block, `G50 S`, `G96`/`G97`, since G10 M8 also `%`,
//          a bare program name and a four-digit `T`). Those lines then say "a lathe" and
//          nothing more, and the Okuma words decide. It deliberately does **not** claim
//          comment lines or bare block numbers, which a page of comments or a milling
//          fragment would otherwise hand to it.
//   2. **Which tool, and when?** A `T` of four or six digits, the station in the middle
//      pair of six; not a `T` inside a cycle block, where it only changes the offset of the
//      end point, and not station `00`.
//   3. **What does a number mean?** The unit system of the machine, applied to every
//      number with or without a point (F52, syntax-okuma.md §3.3): three presets, per class
//      of word, and with no machine no length or feed word has a value at all (AD-31).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { MAX_SNIFF_LINES, detectProfile, detectResult } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { maskComments } from '$lib/core/nc/mask';
import { parseNumber } from '$lib/core/nc/numbers';
import { modalGroupsOf } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { readingsOf, resolveValue, valueOf } from '$lib/core/machines/numbers';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CompiledProfile, NumberInputPreset, Profile } from '$lib/core/profiles/types';
import type { MachineConfig, MachineParams, NumberClass, NumberInput } from '$lib/core/machines/types';
import type { NumericLiteral } from '$lib/core/nc/types';

const OKUMA = 'okuma-osp';
const LATHE = 'fanuc-lathe';
const MILL = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

/** The minimum distance between the winner and the runner-up that §8.4 asks for. */
const MIN_MARGIN = 3;

/** The built-ins, through the same gate the registry uses. */
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

const okuma = compiled(OKUMA);

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

/** The extension detection reads off a path, lower case, `''` for none. */
function extensionOf(path: string | null): string {
  if (path === null) return '';
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The score of every profile for one file, by the rules of `detect.ts`: the extension
 * weight plus the **strongest** matching content rule per line. A second implementation
 * on purpose — `detectProfile` answers with an id and says nothing about the distance to
 * the next profile — and every winner below is cross-checked against the shipped function.
 */
function scores(path: string | null, text: string): Map<string, number> {
  const out = new Map<string, number>();
  const ext = extensionOf(path);
  const lines = sniffLines(text);
  for (const cp of BUILTINS) {
    let score = ext === '' ? 0 : (cp.profile.detect.extensions?.[ext] ?? 0);
    const rules = [...cp.re.detectContent].sort((a, b) => b.weight - a.weight);
    for (const line of lines) {
      for (const rule of rules) {
        if (rule.re.test(line)) {
          score += rule.weight;
          break;
        }
      }
    }
    // A veto (`detect.vetoes`, rule 5 of detect.ts) takes the profile out of the file.
    if (cp.re.detectVetoes.some((veto) => lines.some((line) => veto.test(line)))) score = 0;
    out.set(cp.profile.id, score);
  }
  return out;
}

/** The root of a profile's `extends` chain: the mill and the lathe are one family. */
function familyOf(id: string): string {
  const cp = compiled(id);
  return typeof cp.profile.extends === 'string' ? cp.profile.extends : cp.profile.id;
}

/** Winner, the best profile of another family, and the distance between them. */
function ranked(path: string | null, text: string): { winner: string; score: number; runnerUp: string; margin: number } {
  const rows = [...scores(path, text)].sort((a, b) => b[1] - a[1]);
  const [winner, score] = rows[0];
  const outside = rows.slice(1).find((row) => familyOf(row[0]) !== familyOf(winner));
  return { winner, score, runnerUp: outside?.[0] ?? '(none)', margin: score - (outside?.[1] ?? 0) };
}

/** The editor text of a fixture. */
function readFixture(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
  return opened.text;
}

const FIXTURES = listFixtures('nc/okuma');
/** The fixtures that carry no Okuma extension: the content rules alone have to decide. */
const CONTENT_ONLY = FIXTURES.filter((rel) => !['min', 'sub', 'ssb'].includes(extensionOf(rel)));

/**
 * Every line of the other dialects' fixtures as detection reads it: the negative set. The
 * owner's own Okuma programs (`nc/owner-public/okuma-osp/`) are this dialect, not another.
 */
function otherDialectLines(): string[] {
  return listFixtures('nc')
    .filter(
      (rel) =>
        !rel.startsWith('nc/okuma/') && !rel.startsWith('nc/owner-public/okuma-osp/') && !rel.startsWith('nc/encoding/'),
    )
    .flatMap((rel) => {
      const opened = openFixture(rel);
      return opened.refused === null ? sniffLines(opened.text) : [];
    });
}

// ---------------------------------------------------------------------------
// 1. Detection (§8.4, G10 item 4)
// ---------------------------------------------------------------------------

describe('an Okuma program is recognised as one', () => {
  const printed: string[] = [];

  it('has fixtures to be recognised on, three of them without an Okuma extension', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(6);
    expect(CONTENT_ONLY).toEqual(['nc/okuma/O06-THREAD', 'nc/okuma/SHAFT-OP2', 'nc/okuma/detect-okuma.txt']);
  });

  it.each(FIXTURES)('%s is Okuma, by at least 3 over every other dialect', (rel) => {
    const text = readFixture(rel);
    const path = `/work/${rel}`;
    const { winner, score, runnerUp, margin } = ranked(path, text);
    expect(detectProfile(BUILTINS, path, text, LATHE), rel).toBe(OKUMA);
    expect(detectProfile(BUILTINS, path, text, MILL), rel).toBe(OKUMA);
    expect(winner, rel).toBe(OKUMA);
    expect(margin, `${rel}: ${score} against ${runnerUp}`).toBeGreaterThanOrEqual(MIN_MARGIN);
    const content = ranked(null, text);
    printed.push(`${rel}: +${margin} over ${runnerUp}; content alone: ${content.winner} +${content.margin} over ${content.runnerUp}`);
  });

  it.each(CONTENT_ONLY)('%s is Okuma on its content alone', (rel) => {
    // No extension weight at all: this is the case §8.4 names, "on extension-less files".
    const text = readFixture(rel);
    const { winner, margin, runnerUp } = ranked(null, text);
    expect(winner, rel).toBe(OKUMA);
    expect(margin, `${rel}: only ${margin} over ${runnerUp}`).toBeGreaterThanOrEqual(MIN_MARGIN);
    expect(detectProfile(BUILTINS, null, text, LATHE), rel).toBe(OKUMA);
  });

  it('prints the margins for the review', () => {
    expect(printed.length).toBe(FIXTURES.length);
    console.log(`Okuma detection margins (G10 §8.7 item 4):\n  ${printed.sort().join('\n  ')}`);
  });

  it('gives a program with nothing Okuma-only to the Fanuc lathe, and lets the extension decide it', () => {
    // R1: a program that writes nothing only this control writes — no header, four-digit
    // `T` words, no call, no thread cycle — scores exactly as high on both lathes. Its
    // lines mean the same on both controls, and the codes that do not (G71/G72, LAP,
    // sequence names, `$` lines) carry markers of their own, so the tie is settled by
    // `priority: -1` here, from either fallback: the Fanuc lathe. It used to go to whatever
    // the document was before, which made the answer depend on the order files were opened.
    const text = ['G50 S2000', 'T0101', 'G96 S150 M03', 'G00 X50 Z2', 'G01 Z-20 F0.2', 'G00 X200 Z200', 'M02', ''].join('\n');
    const table = scores(null, text);
    expect(table.get(OKUMA)).toBe(table.get(LATHE));
    expect(detectProfile(BUILTINS, null, text, LATHE)).toBe(LATHE);
    expect(detectProfile(BUILTINS, null, text, OKUMA)).toBe(LATHE);
    expect(okuma.profile.detect.priority).toBe(-1);
    // The extension breaks the tie the other way: a `.MIN` file is an Okuma program…
    for (const path of ['/work/O1001.MIN', '/work/O1001.SUB', '/work/O1001.ssb']) {
      expect(detectProfile(BUILTINS, path, text, LATHE), path).toBe(OKUMA);
    }
    // …but it is a weight, not a verdict (R1): it outweighs any one ordinary line, and a
    // Fanuc mill program saved as `.MIN` stays a mill, where its tap feeds are leads.
    const strongestShared = Math.max(...okuma.re.detectContent.filter((r) => r.weight < 20).map((r) => r.weight));
    for (const ext of ['min', 'sub', 'ssb']) {
      expect(okuma.profile.detect.extensions[ext], ext).toBeGreaterThan(strongestShared);
      expect(okuma.profile.detect.extensions[ext], ext).toBeLessThan(100);
    }
    // Since the M12.5 review its `G91 G28 Z0.` lines (a `G28` with an axis word, which Okuma
    // never writes) take Okuma out of the file altogether; without them the extension still
    // only weighs.
    const rel = 'nc/fanuc/f08-tapping.MIN';
    const fixture = readFixture(rel);
    const { winner, margin } = ranked(`/work/${rel}`, fixture);
    expect(winner).toBe(MILL);
    expect(margin).toBeGreaterThanOrEqual(MIN_MARGIN);
    expect(scores(`/work/${rel}`, fixture).get(OKUMA)).toBe(0);
    const unvetoed = ranked(`/work/${rel}`, fixture.replace(/^G91 G28 Z0\.\r?\n/gm, ''));
    expect(unvetoed.winner).toBe(MILL);
    expect(unvetoed.runnerUp).toBe(OKUMA);
    expect(unvetoed.margin).toBeGreaterThanOrEqual(MIN_MARGIN);
  });

  it('breaks the tie with the thread cycle when its parameters go on over a $ line (R1)', () => {
    // O06-THREAD: the G71 line holds X, Z, B, D and U, the H and F follow on `$H…` — the
    // manual's own layout, with no blank after the `$`. Before R1 nothing on either line
    // was an Okuma marker, the Fanuc lathe won on its comment lines, and scale feed read
    // the lead as a feed. Both lines say Okuma now, the first because a Fanuc G71/G72
    // carries P/Q or U…R and never an end point.
    const text = readFixture('nc/okuma/O06-THREAD');
    const { winner, margin } = ranked(null, text);
    expect(winner).toBe(OKUMA);
    expect(margin).toBeGreaterThanOrEqual(100);
    expect(scores(null, 'G71 X27.55 Z-24 B60 D0.6 U0.1').get(OKUMA)).toBe(20);
    expect(scores(null, '$H2.45 L2 F2 M23 M32 M73').get(OKUMA)).toBe(100);
    // A Sinumerik system variable at the start of a line is not a continuation.
    expect(scores(null, '$TC_DP1[1,1]=0.4').get(OKUMA)).toBeLessThan(20);
    expect(scores(null, '$P_UIFR[1]=CTRANS(X,10)').get(OKUMA)).toBeLessThan(20);
  });

  it('lets the header decide wherever the file came from (G10 M8)', () => {
    // The reviewer's case: `o01-flange.MIN` saved as `prog.nc`, `prog.txt` and with no
    // extension scored as a Fanuc lathe program (69 to 56), and scale feed then read the
    // lead of an Okuma `G71` as a roughing feed. The header is written by this control only.
    const text = readFixture('nc/okuma/o01-flange.MIN');
    for (const path of ['/work/prog.nc', '/work/prog.txt', '/work/prog', null]) {
      const { winner, margin, runnerUp } = ranked(path, text);
      expect(winner, String(path)).toBe(OKUMA);
      expect(margin, `${String(path)}: ${margin} over ${runnerUp}`).toBeGreaterThan(MAX_SNIFF_LINES * 8);
      expect(detectProfile(BUILTINS, path, text, LATHE), String(path)).toBe(OKUMA);
    }
  });

  it('reads the syntax only this control writes as Okuma, under any extension (G10 M8)', () => {
    // Every Okuma case of `_improvements.json` — the reviewer's header-less program with a
    // `G71` thread among them — with the margin §8.4 asks for over every other dialect.
    const improvements = JSON.parse(readFileSync(join(FIXTURES_DIR, 'expected/detect/_improvements.json'), 'utf8')) as {
      improvements: { case: string; path: string; text: string; expected: string }[];
    };
    const cases = improvements.improvements.filter((entry) => entry.expected === OKUMA);
    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const entry of cases) {
      const { winner, margin, runnerUp } = ranked(entry.path, entry.text);
      expect(winner, entry.case).toBe(OKUMA);
      expect(margin, `${entry.case}: ${margin} over ${runnerUp}`).toBeGreaterThanOrEqual(MIN_MARGIN);
    }
    // One line of each is worth more than a program's worth of lines both lathes share.
    const strong = [
      'CALL O2345 Q2 DIA1=40',
      'NEND RTS',
      'G85 NLAP1 D2 F0.3 U0.4 W0.2',
      'G71 X27.55 Z-30 B60 D0.7 U0.1 H2.45 L2 F2',
      'G77 X0 Z-20 K5 F1.25',
      '$H2.45 L2 F2 M23 M32 M73',
    ];
    for (const line of strong) {
      const table = scores(null, line);
      expect(table.get(OKUMA), line).toBeGreaterThanOrEqual(100);
      for (const [id, score] of table) if (id !== OKUMA) expect(score, `${line}: ${id}`).toBeLessThanOrEqual(6);
    }
    // M12.5: with a blank after the `$` the line is still a continuation of NC words,
    // but another ISO dialect writes `$ <text>` comment lines, so that form is a marker below
    // the certain weight, and a `$` line of text is no marker at all.
    for (const line of ['$ H2.45 L2 F2 M23 M32 M73', '$ G84 XA=60 DA=2 FA=0.25', '$ XB=40 DB=1 FB=0.2']) {
      expect(scores(null, line).get(OKUMA), line).toBe(8);
    }
    for (const line of ['$ ROUGH TURNING', '$ OP1 - FACE AND TURN', '$A12-FINISH PASS', '$TEXT ONLY']) {
      expect(scores(null, line).get(OKUMA), line).toBe(0);
    }
    // …and a Fanuc lathe block with P and Q is not an Okuma thread cycle.
    expect(scores(null, 'N80 G71 P90 Q130 U0.4 W0.2 D1.5 H1 F0.25').get(OKUMA)).toBeLessThan(10);
    expect(scores(null, 'N70 G71 U2.0 R0.5').get(OKUMA)).toBeLessThan(10);
    expect(scores(null, 'N70 G72 W2.0 R0.5').get(OKUMA)).toBeLessThan(10);
  });

  it('weighs a G180-G189 code as a hint only, because Fanuc lathes call builder macros by them', () => {
    // M8 re-review F2: at 100, one `G183` macro call (a Fanuc 18i twin-turret lathe's deep
    // drilling on the B axis, in a builder manual) turned a Fanuc lathe program into Okuma,
    // and renumbering then left its `G71 P/Q` pointing at old numbers. The Okuma drilling
    // cycles are written by this control, but the number alone does not say so.
    for (const line of ['G181 X50 Z-12 C0 K3 F120', 'N180 G183 B10. C5. D8. I-40. K2 A1. F0.1']) {
      expect(scores(null, line).get(OKUMA), line).toBe(3);
    }
    const text = readFileSync(join(FIXTURES_DIR, 'expected/detect/programs/l08-g183-macro.nc'), 'utf8');
    for (const path of ['/work/flange.nc', '/work/flange.txt', null]) {
      for (const fallback of [LATHE, OKUMA, MILL]) {
        expect(detectProfile(BUILTINS, path, text, fallback), `${String(path)} ${fallback}`).toBe(LATHE);
      }
      const table = scores(path, text);
      expect((table.get(LATHE) ?? 0) - (table.get(OKUMA) ?? 0), String(path)).toBeGreaterThanOrEqual(MIN_MARGIN);
    }
  });

  it('reads the work and length offsets of a machining-centre program as Okuma, and a Fanuc line as Fanuc (R9 guard)', () => {
    // Three of the owner's Okuma programs are machining-centre programs: a page of mill
    // moves that scores for the Fanuc mill line by line, with `G15 H1`, `G16 H0` and
    // `G56 H1` among them. No Fanuc post writes those (G15/G16 are polar coordinates there,
    // G56 a work offset without H, and a length offset is G43 H), so each one outweighs a
    // page of mill moves: two of them open the program as Okuma under any extension.
    for (const line of ['N20 G15 H1', 'N2130 G16 H0 X0 Y0', 'N60 G56 H1', 'G56H12']) {
      const table = scores(null, line);
      expect(table.get(OKUMA), line).toBe(400);
      for (const [id, score] of table) if (id !== OKUMA) expect(score, `${line}: ${id}`).toBeLessThanOrEqual(6);
    }
    for (const line of ['G56 G43 Z50. H1', 'G90 G56 G0 X0. Y0.', 'N10 G15', 'G16 X50. Y30.', 'G43 H1 Z50. G56']) {
      expect(scores(null, line).get(OKUMA), line).toBeLessThanOrEqual(1);
    }
    for (const rel of listFixtures('nc/owner-public/okuma-osp').filter((r) => !r.endsWith('TURN.min'))) {
      const text = readFixture(rel);
      for (const path of [`/work/${rel}`, '/work/prog.nc', null]) {
        const { winner, margin, runnerUp } = ranked(path, text);
        expect(winner, `${rel} ${String(path)}`).toBe(OKUMA);
        expect(margin, `${rel} ${String(path)}: ${margin} over ${runnerUp}`).toBeGreaterThanOrEqual(MIN_MARGIN);
      }
    }
  });

  it('claims .min, .sub and .ssb and nothing else', () => {
    // `.sdf` schedule programs open only through "open anyway" (§8.4).
    expect(Object.keys(okuma.profile.detect.extensions).sort()).toEqual(['min', 'ssb', 'sub']);
    expect(okuma.profile.files.extensions).toEqual(['min', 'sub', 'ssb']);
    expect(okuma.profile.files.defaultExtension).toBe('min');
    for (const cp of BUILTINS.filter((other) => other.profile.id !== OKUMA)) {
      for (const ext of ['min', 'sub', 'ssb']) expect(cp.profile.detect.extensions?.[ext], cp.profile.id).toBeUndefined();
    }
    expect(detectProfile(BUILTINS, '/work/a.sdf', '', LATHE)).toBe(LATHE);
    expect(detectProfile(BUILTINS, '/work/a.nc', '', LATHE)).toBe(MILL);
  });

  it('leaves the Fanuc lathe programs with the Fanuc lathe, with and without an extension', () => {
    // The other direction of §8.4's test: the shared lathe rules make Okuma the runner-up
    // on a Fanuc turning program, and it must stay a clear second.
    for (const rel of listFixtures('nc/fanuc-lathe')) {
      const text = readFixture(rel);
      for (const path of [`/work/${rel}`, null]) {
        const table = scores(path, text);
        const lathe = table.get(LATHE) ?? 0;
        const mine = table.get(OKUMA) ?? 0;
        expect(detectProfile(BUILTINS, path, text, OKUMA), `${rel} ${String(path)}`).toBe(LATHE);
        expect(lathe - mine, `${rel} ${String(path)}: ${lathe} against Okuma ${mine}`).toBeGreaterThanOrEqual(MIN_MARGIN);
      }
    }
  });

  it('takes neither a page of comments nor a milling fragment', () => {
    const comments = readFixture('nc/ambiguous/comment-only.txt');
    expect(scores(null, comments).get(OKUMA)).toBeLessThanOrEqual((scores(null, comments).get(MILL) ?? 0) - MIN_MARGIN);
    expect(detectProfile(BUILTINS, '/work/comment-only.txt', comments, KLARTEXT)).toBe(MILL);
    // M12.5: Okuma scores a numbered block as both Fanuc profiles do, so six numbered
    // positioning blocks fit Okuma almost as well as the Fanuc mill. The mill still wins,
    // and the answer says that it is not sure.
    const fragment = readFixture('nc/ambiguous/fanuc-fragment.txt');
    expect(scores(null, fragment).get(OKUMA)).toBeLessThan(scores(null, fragment).get(MILL) ?? 0);
    const result = detectResult(BUILTINS, '/work/fanuc-fragment.txt', fragment, KLARTEXT);
    expect(result.id).toBe(MILL);
    expect(result.uncertain).toBe(true);
  });

  it('gives every content rule a line of its own in the fixtures', () => {
    // G10 §8.7 item 4: a pattern nothing ever matches describes nothing. The owner's
    // machining-centre programs are this dialect too, and the only ones with `G15 H`.
    const lines = [...FIXTURES, ...listFixtures('nc/owner-public/okuma-osp')].flatMap((rel) => sniffLines(readFixture(rel)));
    const silent = okuma.re.detectContent
      .filter((rule) => !lines.some((line) => rule.re.test(line)))
      .map((rule) => rule.re.source);
    expect(silent, 'content rules no fixture line matches').toEqual([]);
  });

  it('claims a line of another dialect only where the Fanuc lathe claims it just as much', () => {
    // The negative half of item 4. An Okuma marker that fires on a Fanuc, Klartext or
    // Sinumerik fixture would be a marker of that dialect too; the shared lathe rules may
    // fire there, but never with more weight than the Fanuc lathe gives the same line.
    const lathe = compiled(LATHE);
    const strongest = (cp: CompiledProfile, line: string): number => {
      let best = 0;
      for (const rule of cp.re.detectContent) if (rule.re.test(line) && rule.weight > best) best = rule.weight;
      return best;
    };
    const offenders = otherDialectLines().filter((line) => strongest(okuma, line) > strongest(lathe, line));
    expect(offenders).toEqual([]);
  });

  // G8 M8 code review, finding 4: a rule that reads to the end of the line from every
  // candidate position costs the square of the line. Detection reads 400 lines on open and
  // the map runs its rules after every edit, so a padded or malformed file stalls both. A
  // rule that looks ahead does so once, from the start of the line.
  it('reads a long line in time proportional to its length, with every content and map rule', () => {
    const SHAPES: [string, string][] = [
      ['blanks', ' '],
      ['letters', 'A'],
      ['a slash and blanks', '/ '],
      ['sequence names', 'NA '],
      ['conditions', 'IF ['],
      ['thread cycles', 'G71 '],
      ['taps', 'G77 '],
      ['packed words', 'G1X1'],
      ['variables', 'V1'],
      ['continuation marks', '$ '],
      ['end codes', 'M02 '],
    ];
    const rules = [
      ...okuma.re.detectContent.map((rule, i) => [`detect.content[${i}]`, rule.re] as const),
      ...okuma.re.outline.map((rule, i) => [`outline[${i}]`, rule.re] as const),
    ];
    const cost = (re: RegExp, line: string): number => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        re.test(line);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    for (const [path, re] of rules) {
      for (const [name, unit] of SHAPES) {
        const short = cost(re, unit.repeat(4000 / unit.length));
        const long = cost(re, unit.repeat(32000 / unit.length));
        // Linear is eight times as long for eight times the line; the square is 64 times.
        expect(long, `${path} on ${name}: ${short.toFixed(2)} ms for 4k, ${long.toFixed(2)} ms for 32k`).toBeLessThan(
          Math.max(50, 24 * short),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The turret tool rule (§8.4, syntax-okuma.md §5)
// ---------------------------------------------------------------------------

describe('the turret tool rule', () => {
  const isToolChange = (line: string): boolean => {
    const masked = maskComments(line, okuma);
    return okuma.re.toolTrigger.test(masked) && !(okuma.re.toolIgnore?.test(masked) ?? false);
  };
  const station = (line: string): string | undefined => okuma.re.tool.exec(maskComments(line, okuma))?.groups?.tool;

  it.each([
    // Four digits: station, then offset.
    ['T0202', true, '02'],
    ['T0303 (THREAD)', true, '03'],
    ['G00 X600 Z400 T0505', true, '05'],
    // Six digits: nose radius number, station, offset — the station is the middle pair.
    ['T010101', true, '01'],
    ['T010203', true, '02'],
    ['T000202', true, '02'],
    ['T020305', true, '03'],
    ['T001200', true, '12'],
    // Station 00 is no tool (syntax-okuma.md §5.3 item 4, verify): not a change.
    ['T0000', false, undefined],
    ['T0012', false, undefined],
    ['T000000', false, undefined],
    ['T120012', false, undefined],
    // Other lengths are not T words of this control.
    ['T1', false, undefined],
    ['T12', false, undefined],
    ['T123', false, undefined],
    ['T12345', false, undefined],
    ['T1234567', false, undefined],
    // A T in a comment names nothing.
    ['(T0101 OD ROUGH)', false, undefined],
    ['G00 X50 (NEXT T0303)', false, undefined],
  ])('%s', (line, change, tool) => {
    expect(isToolChange(line), line).toBe(change);
    if (change) expect(station(line), line).toBe(tool);
  });

  it.each([
    'G71 X27.55 Z-30 B60 D0.7 U0.1 H2.45 F2 T0708',
    'G72 X20 Z-2 B60 D0.5 W0.1 H1.2 F1.5 T0708',
    'G73 X40 Z-20 K5 D1 F0.05 T0102',
    'G74 X0 Z-12 D3 F0.12 T0203',
    'G74 X44 Z-4 I4 D1 F0.05 T010708',
    'G77 X0 Z-15 K3 F1.25 T0506',
    'G78 X0 Z-15 K3 F1.25 T0506',
    'G181 X50 Z-12 C0 K3 F120 T001112',
    'G184 X50 Z-10 C0 K3 F750 Q6 T001213',
    'G189 X20 Z-8 K3 F60 T001314',
  ])('a T inside a cycle block only changes the offset: %s', (line) => {
    // syntax-okuma.md §5.2: the T of a cycle block picks the offset for the end point.
    expect(okuma.re.toolTrigger.test(line), line).toBe(true);
    expect(isToolChange(line), line).toBe(false);
  });

  it('keeps the chamfer and corner-round codes inside the ignored range, as §8.4 writes it', () => {
    // G75 and G76 are not cycles here, but §8.4 ignores `G71`–`G78` whole; neither takes a
    // T word in practice, so the range stays as the plan gives it.
    expect(okuma.re.toolIgnore?.test('G01 X40 G75 L2 T0101')).toBe(true);
    expect(okuma.re.toolIgnore?.test('G01 X40 G70 T0101')).toBe(false);
    expect(okuma.re.toolIgnore?.test('G01 X40 G79 T0101')).toBe(false);
    expect(okuma.re.toolIgnore?.test('G01 X40 G179 T0101')).toBe(false);
  });

  it('takes the tool from the line it stands on, and counts an offset change as a row (D25)', () => {
    expect(okuma.profile.toolCall.toolFrom).toBe('same-line');
    const index = new OutlineIndex(okuma);
    index.reset(['T010101', 'G00 X40 Z2', 'T010102', 'G00 X40 Z2', 'T020202']);
    expect(index.items().map((item) => `${item.line}:${String(item.tool)}`)).toEqual(['1:01', '3:01', '5:02']);
    expect(index.toolLines()).toEqual([1, 3, 5]);
  });

  it('puts one program-map row on every turret change of the fixtures, and none on a cycle T', () => {
    const rows = (rel: string): string[] => {
      const text = readFixture(rel);
      const lines = text.split('\n');
      const index = new OutlineIndex(okuma);
      index.reset(lines);
      return index
        .items()
        .flatMap((item) => [item, ...(item.children ?? [])])
        .filter((item) => item.kind === 'tool')
        .map((item) => `${String(item.tool)}: ${lines[item.line - 1].trim()}`);
    };
    expect(rows('nc/okuma/o01-flange.MIN')).toEqual(['01: T010101', '03: T030303', '02: T0202', '07: T0707']);
    expect(rows('nc/okuma/o02-thread.MIN')).toEqual(['07: T070707', '09: T090909']);
    expect(rows('nc/okuma/o03-live-tool.MIN')).toEqual(['11: T001111', '12: T001212']);
    expect(rows('nc/okuma/SHAFT-OP2')).toEqual(['01: T010101', '02: T020202', '12: T001212']);
    expect(rows('nc/okuma/o05-lap-tap.MIN')).toEqual(['01: T010101', '03: T030303', '07: T070707', '09: T0909']);
    for (const row of rows('nc/okuma/o01-flange.MIN')) expect(row).not.toMatch(/G74/);
  });
});

// ---------------------------------------------------------------------------
// 3. The program map (§8.4 outline list)
// ---------------------------------------------------------------------------

describe('the program map', () => {
  /** Every item of a fixture, tool segments flattened, as `kind@line: text`. */
  function items(rel: string): string[] {
    const index = new OutlineIndex(okuma);
    index.reset(readFixture(rel).split('\n'));
    return index
      .items()
      .flatMap((item) => [item, ...(item.children ?? [])])
      .map((item) => `${item.kind}@${item.line}: ${item.text}`);
  }

  it('lists both programs of a subprogram file, the named sequences, the call and the return', () => {
    const rows = items('nc/okuma/o04-sub.SUB');
    expect(rows.filter((row) => row.startsWith('program@'))).toEqual(['program@3: O1234', 'program@14: O2345']);
    // A sequence name is a label, never a block number (AD-24): `NLAP1` is the LAP shape a
    // `G85` refers to, `NLOOP` a jump target.
    expect(rows.filter((row) => row.startsWith('label@'))).toEqual(['label@6: NLOOP', 'label@17: NLAP1']);
    expect(rows.filter((row) => row.startsWith('subprogram-call@'))).toEqual(['subprogram-call@12: CALL O2345']);
    // `NEND RTS` is a jump target and the return of the second program. A line gives the
    // map one item, and the end is the one that must not go missing, so it is listed as the
    // end with the name in its text (G10 M8, as the Sinumerik `LOOP_END: M30`).
    expect(rows.filter((row) => row.startsWith('end@'))).toEqual(['end@13: RTS', 'end@25: NEND RTS']);
  });

  it('lists a named block that ends the program as the end, and a plain label as a label (G10 M8)', () => {
    const index = new OutlineIndex(okuma);
    index.reset(['NEND M02', '/ NFIN M30', 'NAB1 G00 X10 M02', 'NLAP1 G85 NAT01 D4 F0.3', 'NAB2 XM30', 'NEND (M02 LATER)']);
    expect(index.items().map((item) => `${item.kind}@${item.line}: ${item.text}`)).toEqual([
      'end@1: NEND M02',
      'end@2: NFIN M30',
      'end@3: NAB1 G00 X10 M02',
      'label@4: NLAP1',
      'label@5: NAB2',
      // An end code inside a comment ends nothing; the line is the operation it names.
      'comment@6: M02 LATER',
    ]);
  });

  it('lists a modal call like a call', () => {
    expect(items('nc/okuma/detect-okuma.txt')).toContain('subprogram-call@16: MODIN O3000');
  });

  it('lists a G-code macro as a call (G10 M8)', () => {
    // G161-G170 call their macro after every move like MODIN, G171 and G205-G214 once like
    // CALL (syntax-okuma.md §7.1). What the macro does is the machine's setup, not the map's.
    const index = new OutlineIndex(okuma);
    index.reset(['G171 X40 Z-20', 'G0161 A1', 'G205', 'G214 B2', 'G160', 'G172', 'G1710', 'G215', '(G171)']);
    expect(index.items().map((item) => `${item.kind}@${item.line}: ${item.text}`)).toEqual([
      'subprogram-call@1: G171',
      'subprogram-call@2: G0161',
      'subprogram-call@3: G205',
      'subprogram-call@4: G214',
      'comment@9: G171',
    ]);
  });

  it('reads a sequence number with a comment as the operation it names', () => {
    // `N2 (OD FINISH)` is how a post marks an operation, and the tool row takes it.
    const rows = items('nc/okuma/o01-flange.MIN');
    expect(rows).toContain('comment@18: OD FINISH');
    expect(rows).toContain('tool@19: T3 — OD FINISH');
    expect(rows).toContain('end@42: M02');
  });

  it('shows neither the transfer header nor a numbered block as an item', () => {
    const index = new OutlineIndex(okuma);
    index.reset(['$O01-FLANGE.MIN%', 'N100 G00 X80 Z5', '/N110 G01 X60', 'O1001 (NAME)', '/NLAP1 G81']);
    expect(index.items().map((item) => `${item.kind}@${item.line}: ${item.text}`)).toEqual([
      // A comment on the name line is not allowed by every control, but it is text and is
      // masked before the rule reads the line.
      'program@4: O1001',
      'label@5: NLAP1',
    ]);
  });

  it('marks the optional and the program stop', () => {
    const index = new OutlineIndex(okuma);
    index.reset(['M00', 'M01', 'M02', 'M30', 'RTS', 'M010', 'M300']);
    expect(index.items().map((item) => `${item.kind}@${item.line}`)).toEqual([
      'stop@1',
      'stop@2',
      'end@3',
      'end@4',
      'end@5',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Block references (§8.4 numbering)
// ---------------------------------------------------------------------------

describe('block references', () => {
  const fires = (line: string): string[] =>
    okuma.re.references.filter((rule) => rule.trigger.test(line)).map((rule) => rule.addresses.join(''));

  it('follows the jump targets and the LAP shape a call names, all in the same program', () => {
    expect(fires('GOTO N100')).toEqual(['N']);
    expect(fires('IF [V1 LT 3] GOTO N100')).toEqual(['N', 'N']);
    expect(fires('IF [DIA1 GT 50] N100')).toEqual(['N']);
    expect(fires('G85 N100 D2 F0.3 U0.4 W0.2')).toEqual(['N']);
    expect(fires('G088 N100 D1 H1.2')).toEqual(['N']);
    // Everything targets a block of the program it stands in (syntax-okuma.md §7.2), so
    // every rule may rewrite what it finds.
    for (const rule of okuma.profile.numbering.references ?? []) expect(rule.rewrite ?? true).toBe(true);
  });

  it('does not fire on a word that only contains the keyword', () => {
    expect(fires('G00 X50 Z2')).toEqual([]);
    expect(fires('MODIN O3000')).toEqual([]);
    expect(fires('G84 X20')).toEqual([]);
    expect(fires('G185 X20 Z-10 F1.5')).toEqual([]);
  });

  it('keeps the numbering limits of the control', () => {
    // `N` + at most four characters, a space after it, the header and the program name
    // never numbered.
    const numbering = okuma.profile.numbering;
    expect(numbering.max).toBe(9999);
    expect(numbering.spacesAfter).toBe(1);
    expect(numbering.skipStartingWith).toEqual(['$', '%', 'O', '(']);
    expect(numbering.onOverflow).toBe('stop');
  });
});

// ---------------------------------------------------------------------------
// 5. The machine parameters (§8.8, D34, F52)
// ---------------------------------------------------------------------------

/** What one "1" is worth per class, from the unit table of syntax-okuma.md §3.3. */
const UNIT_TABLE: Record<string, Partial<Record<'mm' | 'inch', Record<NumberClass, string>>>> = {
  'okuma-1mm': {
    mm: { length: '1', feedPerRev: '1', feedPerMin: '1', angle: '1', dwell: '1' },
    inch: { length: '1', feedPerRev: '1', feedPerMin: '1', angle: '1', dwell: '1' },
  },
  'okuma-1um': {
    mm: { length: '0.001', feedPerRev: '0.001', feedPerMin: '0.1', angle: '0.001', dwell: '0.01' },
    inch: { length: '0.0001', feedPerRev: '0.0001', feedPerMin: '0.01', angle: '0.001', dwell: '0.01' },
  },
  // The control has no 10 µm inch system, so the table has no inch column here.
  'okuma-10um': {
    mm: { length: '0.01', feedPerRev: '0.01', feedPerMin: '1', angle: '0.01', dwell: '0.1' },
  },
};

const CLASSES: NumberClass[] = ['length', 'feedPerRev', 'feedPerMin', 'angle', 'dwell'];

function literal(text: string): NumericLiteral {
  const lit = parseNumber(text);
  if (lit === null) throw new Error(`not a number: ${text}`);
  return lit;
}

const decl = okuma.profile.machineParams;
const presets: NumberInputPreset[] = decl?.numberInput?.presets ?? [];

function preset(id: string): NumberInputPreset {
  const found = presets.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found;
}

/** The machine a document gets when a configuration chooses this preset and nothing else. */
function machineWith(params: MachineConfig['params']) {
  return effectiveMachine(okuma.profile, { id: 'm', name: 'm', profile: OKUMA, params }, 'document', {});
}

function paramsWith(input: NumberInput): MachineParams {
  return { ...noMachine(okuma.profile).params, numberInput: input };
}

describe('the machine parameters', () => {
  it('offers exactly what §8.8 lists', () => {
    expect(decl?.units).toBe('mm');
    expect(decl?.diameter).toBe('on');
    expect(decl?.modalGroups).toEqual(['feedmode', 'distance', 'spindlemode']);
    // M9 (R6): the one variant is the tool word's offset digits (r6Variants.test.ts).
    expect(decl?.variants?.map((v) => v.id)).toEqual(['toolWord']);
    expect(okuma.profile.modal?.initial).toEqual({ feedmode: 'G95', distance: 'G90' });
    expect(okuma.profile.machineType).toBe('lathe');
    // M12 (P12, §8.9): channel presets are offered, never applied, all `verify`;
    // `channelPresets.test.ts` pins them.
    for (const preset of decl?.channels?.presets ?? []) expect(preset.verify, preset.id).toBe(true);
    // Every offered group is a modal group of the profile's own database.
    const groups = modalGroupsOf(BUILTIN_CODE_DB_JSON as Record<string, unknown>, okuma.profile.codes);
    for (const group of decl?.modalGroups ?? []) expect(groups, group).toContain(group);
  });

  it('ships the three unit systems, the 1 mm one as the assumed default', () => {
    expect(decl?.numberInput?.default).toBe('okuma-1mm');
    expect(presets.map((entry) => entry.id)).toEqual(['okuma-1mm', 'okuma-1um', 'okuma-10um']);
    expect(preset('okuma-1mm').value.mode).toBe('calculator');
    expect(preset('okuma-1um').value.mode).toBe('scale');
    expect(preset('okuma-10um').value.mode).toBe('scale');
    for (const entry of presets) {
      // §8 header: a documented default names its source; the unit table is in §3.3.
      expect(entry.source, entry.id).toBe('syntax-okuma.md §3.3');
      // The label says what a number becomes with and without a point.
      expect(entry.label, entry.id).toMatch(/X50 and X50\. are both/);
      expect(entry.label, entry.id).toMatch(/point or not/);
      expect(entry.label, entry.id).toMatch(/G04 F\d+ waits 2 s/);
    }
    // Which system the owner's machines use is open (syntax-okuma.md §10 question 2), so the
    // default is marked; the 10 µm preset is marked for its missing inch system.
    expect(preset('okuma-1mm').verify).toBe(true);
    expect(preset('okuma-10um').verify).toBe(true);
    expect(preset('okuma-10um').label).toMatch(/metric only/);
    expect(preset('okuma-1um').verify).toBeUndefined();
  });

  it('says nothing about an inch system the control does not have', () => {
    // A 10 µm inch unit would be invented. Leaving it out means the generic rule of
    // §7.15 applies, and the label and the verify flag say that it is not a fact.
    const value = preset('okuma-10um').value;
    expect(value.incrementInch).toBeUndefined();
    for (const cls of CLASSES) expect(value.classes?.[cls]?.incrementInch, cls).toBeUndefined();
  });

  it.each(presets.map((entry) => entry.id))('the effective profile of %s validates and compiles', (id) => {
    const applied = applyMachine(okuma.profile, machineWith({ numberInput: preset(id).value }));
    const checked = validateProfile(applied.profile, { applied: true });
    expect(checked.ok, checked.ok ? '' : checked.errors.join('; ')).toBe(true);
    if (checked.ok) expect(() => compileProfile(checked.profile)).not.toThrow();
    expect(applied.codes).toBe('okuma');
  });

  it('never makes the decimal point significant, under any preset and with none', () => {
    // 1 mm reads a number as written, 1 µm and 10 µm multiply it whether or not it has a
    // point: on this control a point never changes a value (§8.4, F52).
    expect(okuma.profile.syntax.decimalPointSignificant).toBe(false);
    for (const entry of presets) {
      const applied = applyMachine(okuma.profile, machineWith({ numberInput: entry.value }));
      expect(applied.profile.syntax.decimalPointSignificant, entry.id).toBe(false);
    }
    expect(applyMachine(okuma.profile, noMachine(okuma.profile)).profile.syntax.decimalPointSignificant).toBe(false);
  });

  it.each(Object.keys(UNIT_TABLE))('%s gives every class the unit of the table', (id) => {
    const input = preset(id).value;
    for (const units of ['mm', 'inch'] as const) {
      const row = UNIT_TABLE[id][units];
      if (!row) continue;
      for (const cls of CLASSES) {
        expect(valueOf(literal('1'), cls, paramsWith(input), units), `${id} ${units} ${cls}`).toBe(row[cls]);
      }
    }
  });

  it.each(presets.map((entry) => entry.id))('%s reads a number with a point exactly like one without', (id) => {
    const params = paramsWith(preset(id).value);
    for (const cls of CLASSES) {
      for (const [bare, pointed] of [
        ['50', '50.'],
        ['1', '1.0'],
        ['1000', '1000.000'],
      ]) {
        expect(valueOf(literal(bare), cls, params, 'mm'), `${id} ${cls} ${bare}`).toBe(
          valueOf(literal(pointed), cls, params, 'mm'),
        );
      }
    }
  });

  it('reads the examples of the unit table', () => {
    const tenMicron = paramsWith(preset('okuma-10um').value);
    const oneMicron = paramsWith(preset('okuma-1um').value);
    const oneMm = paramsWith(preset('okuma-1mm').value);
    expect(valueOf(literal('0.1'), 'length', tenMicron, 'mm')).toBe('0.001');
    expect(valueOf(literal('1000'), 'length', tenMicron, 'mm')).toBe('10');
    expect(valueOf(literal('10001'), 'length', tenMicron, 'mm')).toBe('100.01');
    expect(valueOf(literal('23.456'), 'feedPerRev', tenMicron, 'mm')).toBe('0.23456');
    expect(valueOf(literal('10000'), 'length', oneMicron, 'mm')).toBe('10');
    expect(valueOf(literal('100010'), 'length', oneMicron, 'mm')).toBe('100.01');
    expect(valueOf(literal('234.56'), 'feedPerRev', oneMicron, 'mm')).toBe('0.23456');
    expect(valueOf(literal('1'), 'length', oneMm, 'mm')).toBe('1');
    expect(valueOf(literal('1.000'), 'length', oneMm, 'mm')).toBe('1');
    expect(valueOf(literal('0.23456'), 'feedPerRev', oneMm, 'mm')).toBe('0.23456');
    // The labels' own examples: G04 F200 under 1 µm and F20 under 10 µm both wait 2 s.
    expect(valueOf(literal('200'), 'dwell', oneMicron, 'mm')).toBe('2');
    expect(valueOf(literal('20'), 'dwell', tenMicron, 'mm')).toBe('2');
    expect(valueOf(literal('50'), 'length', oneMicron, 'mm')).toBe('0.05');
    expect(valueOf(literal('50'), 'length', tenMicron, 'mm')).toBe('0.5');
  });

  it('agrees with the Okuma unit systems of the number golden set', () => {
    // `tests/fixtures/machines/numbers.json` (WP6.9) wrote the §8.8 systems before this
    // profile existed. Two declarations of one fact must read every number alike.
    const golden = JSON.parse(readFileSync(join(FIXTURES_DIR, 'machines/numbers.json'), 'utf8')) as {
      inputs: Record<string, NumberInput>;
    };
    const inputs = golden.inputs;
    for (const id of ['okuma-1mm', 'okuma-1um', 'okuma-10um']) {
      const written = paramsWith(inputs[id]);
      const shipped = paramsWith(preset(id).value);
      for (const cls of CLASSES) {
        for (const text of ['1', '50', '50.', '0.1', '23.456', '-12.5']) {
          const units = id === 'okuma-10um' ? (['mm'] as const) : (['mm', 'inch'] as const);
          for (const u of units) {
            expect(valueOf(literal(text), cls, shipped, u), `${id} ${cls} ${text} ${u}`).toBe(
              valueOf(literal(text), cls, written, u),
            );
          }
        }
      }
    }
  });

  it('gives a length, feed, angle or dwell word no value while no machine is chosen', () => {
    // AD-31 "No machine, no guess": the three presets disagree on every such word, with or
    // without a point, so nothing may convert it — and every reading is on offer, the
    // assumed default first.
    const none = noMachine(okuma.profile);
    for (const cls of CLASSES) {
      for (const text of ['50', '50.', '0.25']) {
        const answer = resolveValue(literal(text), cls, none, decl, 'mm');
        expect(answer.value, `${cls} ${text}`).toBeNull();
        expect(answer.readings.map((r) => r.preset), `${cls} ${text}`).toEqual(['okuma-1mm', 'okuma-1um', 'okuma-10um']);
      }
    }
    expect(readingsOf(literal('50'), 'length', decl, 'mm').map((r) => r.value)).toEqual(['50', '0.05', '0.5']);
    // A count and a word without a class are never converted, machine or not.
    expect(resolveValue(literal('3'), 'count', none, decl, 'mm')).toEqual({ value: null, readings: [] });
    expect(resolveValue(literal('2000'), null, none, decl, 'mm')).toEqual({ value: null, readings: [] });
    // With a machine the machine decides, and there is nothing left to show.
    const chosen = machineWith({ numberInput: preset('okuma-1um').value });
    expect(resolveValue(literal('50000'), 'length', chosen, decl, 'mm')).toEqual({ value: '50', readings: [] });
  });

  it('starts every document with X as a diameter, feed per revolution and absolute positions', () => {
    const applied = applyMachine(okuma.profile, noMachine(okuma.profile)).profile;
    expect(applied.modal?.diameter).toBe('on');
    expect(applied.modal?.units).toBe('mm');
    expect(applied.modal?.initial).toEqual({ feedmode: 'G95', distance: 'G90' });
    expect(applied.modal?.sources).toEqual({ feedmode: 'profile', distance: 'profile', units: 'profile', diameter: 'profile' });
    // A machine may say otherwise, and then it is the machine's.
    const inch = applyMachine(okuma.profile, machineWith({ units: 'inch', modalInitial: { feedmode: 'G94' } })).profile;
    expect(inch.modal?.units).toBe('inch');
    expect(inch.modal?.initial?.feedmode).toBe('G94');
    expect(inch.modal?.sources?.feedmode).toBe('machine');
  });
});

// ---------------------------------------------------------------------------
// 6. What the profile states besides syntax (§8.4)
// ---------------------------------------------------------------------------

describe('the profile around its syntax', () => {
  it('is a lathe with X as a diameter and no incremental twins', () => {
    const addresses = okuma.profile.addresses;
    expect(addresses.axes).toEqual(['X', 'Z', 'C', 'Y']);
    expect(addresses.arcCenter).toEqual(['I', 'K']);
    expect(addresses.diameter).toEqual(['X']);
    expect(addresses.angular).toEqual(['C']);
    // U and W are finishing allowances on this control, not incremental X and Z: it writes
    // incremental moves with G91 (§8.4, syntax-okuma.md §4.3).
    expect(addresses.incremental).toBeUndefined();
    expect(addresses.axes).not.toContain('U');
    expect(addresses.axes).not.toContain('W');
    expect(addresses.speedLimitWords).toBeUndefined();
  });

  it('reads a line that starts with $ as part of the block above it (G10 M8)', () => {
    // OSP writes the rest of a long block on `$` lines; the lead of a `G71` thread cycle
    // can stand there (§7.16 #27). The header `$NAME.MIN%` is no such line.
    const marker = okuma.re.continuationStart;
    expect(marker).toBeDefined();
    const lines = ['$ H2.45 L2 F2 M23 M32 M73', '  $ G84 XA=60 DA=2 FA=0.2', '$', '$O05-LAP-TAP.MIN%', 'N001 G71 X27.55', 'X10 $ Z5'];
    expect(lines.map((line) => marker?.test(line))).toEqual([true, true, true, false, false, false]);
  });

  it('keeps the syntax section the prelude pinned', () => {
    // P8 item 3: a content package may not edit it; a change goes through a hand-off note.
    const raw = BUILTIN_PROFILE_JSON.find((p) => (p as Profile).id === OKUMA) as Profile;
    expect(raw.syntax.sequenceNames).toBe(true);
    expect(raw.syntax.header).toBe('^\\$[^%]*%');
    expect(raw.syntax.maxLineLength).toBe(158);
  });
});
