// What the shipped Fanuc profiles decide about a file (plan §8.1, AD-18, gate G10 item 4
// and item 5a). Owner: WP6.2.
//
// Two questions, and they are answered in this order:
//
//   1. **Which profile?** Mill or lathe. That is `detect.content`, scored the way
//      `core/profiles/detect.ts` scores it, and the review asks for more than "the right
//      one won": it asks by how much. A fixture that wins by one weak line is one CAM
//      post away from flipping, so §8.1 requires a margin of at least 3 over the
//      runner-up on **every** fixture, this dialect's and everybody else's, and G10 wants
//      that number printed.
//   2. **Which G-code system?** A or B. That is the `gcodeSystem` variant of §8.1, and it
//      is asked only when no machine is chosen (AD-31). Its scoring is deliberately *not*
//      the profile's: a variant pattern counts **once**, however many lines match it
//      (`VariantChoice.detect`), because a system-B post writes `G99 G83 …` on every
//      cycle line — which also matches system A's `G98`/`G99` rule — and per-line scoring
//      would let six ordinary drilling blocks outvote the one `G92 S` clamp that really
//      decides. `l07-system-b-drill.nc` is exactly that program.
//
// The margins are data, not code: they live in `tests/fixtures/expected/detect/*.json`
// next to the profile each fixture is expected to get, so a reviewer reads one file and
// sees both answers. `WP6.1` implements `detectVariants` in `core/profiles/detect.ts`
// against the same table (see the hand-off note).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { MAX_SNIFF_LINES, VARIANT_MARGIN, detectProfile, detectResult, detectVariants } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { maskComments } from '$lib/core/nc/mask';
import { BUILTIN_PROFILE_JSON, FALLBACK_PROFILE_ID } from '$lib/data/profiles';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CompiledProfile, VariantChoice } from '$lib/core/profiles/types';

const MILL = 'fanuc-gcode';
const LATHE = 'fanuc-lathe';
const KLARTEXT = 'heidenhain-klartext';

/** The minimum distance between the winner and the runner-up that §8.1 asks for. */
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

/**
 * The content and extension score of every profile for one file, by the rules of
 * `detect.ts`: the extension weight, plus the **strongest** matching content rule per
 * line. It is a second implementation on purpose — the shipped function answers with a
 * profile id and says nothing about the distance to the next one — and every fixture
 * assertion below cross-checks its winner against `detectProfile`, so the two cannot
 * drift apart without a failure.
 */
function scores(path: string | null, text: string): Map<string, number> {
  const out = new Map<string, number>();
  const ext = path === null ? '' : (path.split(/[\\/]/).pop() ?? '').split('.').slice(1).pop()?.toLowerCase();
  const lines = sniffLines(text);
  for (const cp of BUILTINS) {
    let score = ext === undefined || ext === '' ? 0 : (cp.profile.detect.extensions?.[ext] ?? 0);
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

/** The root of a profile's `extends` chain: `fanuc-gcode` for the mill and the lathe. */
function familyOf(id: string): string {
  let cp = compiled(id);
  const seen = new Set<string>();
  while (typeof cp.profile.extends === 'string' && !seen.has(cp.profile.id)) {
    seen.add(cp.profile.id);
    const parent = BUILTINS.find((other) => other.profile.id === cp.profile.extends);
    if (!parent) break;
    cp = parent;
  }
  return cp.profile.id;
}

/**
 * Winner, runner-up and the distance between them.
 *
 * The runner-up is the best profile of **another dialect family**. Two profiles that
 * share a parent share its whole `detect.content` list (AD-16), so a file that carries no
 * turning and no milling marker — a fragment of six positioning blocks, a page of
 * comments — scores the same on both by construction; no wording of the rules can pull
 * them apart, and it should not, because both readings of such a file are equally right.
 * What must be true there is that the tie is settled by something a reader of the JSON
 * can see, which is `detect.priority` (§8.1), and `insideFamily` below checks that.
 */
function ranked(path: string | null, text: string): { winner: string; runnerUp: string; margin: number } {
  const rows = [...scores(path, text)].sort((a, b) => b[1] - a[1]);
  const winner = rows[0][0];
  const family = familyOf(winner);
  const outside = rows.slice(1).find((row) => familyOf(row[0]) !== family);
  return {
    winner,
    runnerUp: outside?.[0] ?? '(no other dialect)',
    margin: rows[0][1] - (outside?.[1] ?? 0),
  };
}

/** How the winner beats its own siblings: by score, or — on a tie — by priority. */
function insideFamily(path: string | null, text: string): { by: 'score' | 'priority'; margin: number } {
  const rows = [...scores(path, text)].sort((a, b) => b[1] - a[1]);
  const [winner, score] = rows[0];
  const family = familyOf(winner);
  const siblings = rows.slice(1).filter((row) => familyOf(row[0]) === family);
  if (siblings.length === 0) return { by: 'score', margin: score };
  const margin = score - siblings[0][1];
  if (margin > 0) return { by: 'score', margin };
  const mine = compiled(winner).profile.detect.priority ?? 0;
  const theirs = compiled(siblings[0][0]).profile.detect.priority ?? 0;
  expect(mine, `${String(path)}: ${winner} ties ${siblings[0][0]} and has no higher priority`).toBeGreaterThan(theirs);
  return { by: 'priority', margin };
}

// ---------------------------------------------------------------------------
// The G-code system, scored by presence (§8.1, AD-31)
// ---------------------------------------------------------------------------

/** One variant answer: the choice, and how far ahead of the runner-up it is. */
interface VariantAnswer {
  choice: string;
  margin: number;
  detected: boolean;
}

/**
 * The `gcodeSystem` answer for a text, by the contract of `VariantChoice.detect`: each
 * pattern adds its weight **once**, over the first 400 masked lines; a margin below
 * `MIN_MARGIN` is not an answer and the variant's `default` applies.
 */
function variantOf(cp: CompiledProfile, variantId: string, text: string): VariantAnswer {
  const decl = cp.profile.machineParams?.variants?.find((v) => v.id === variantId);
  if (!decl) throw new Error(`${cp.profile.id} has no variant ${variantId}`);
  const masked = sniffLines(text).map((line) => maskComments(line, cp));

  const scored = decl.choices.map((choice: VariantChoice) => {
    let score = 0;
    for (const rule of choice.detect ?? []) {
      const re = new RegExp(rule.pattern, cp.flags);
      if (masked.some((line) => re.test(line))) score += rule.weight;
    }
    return { value: choice.value, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const margin = scored[0].score - (scored[1]?.score ?? 0);
  const detected = scored[0].score > 0 && margin >= MIN_MARGIN;
  return { choice: detected ? scored[0].value : decl.default, margin, detected };
}

// ---------------------------------------------------------------------------
// The expectation files (one per fixture folder, P6 item 11)
// ---------------------------------------------------------------------------

interface ExpectedFile {
  fixtures: Record<string, string>;
  /** WP6.2: fixture → the `gcodeSystem` the variant rules answer with. */
  variants?: Record<string, { gcodeSystem: string; detected: boolean }>;
  /** Fixtures detected wrongly today (the owner's real programs); see `owner-public.json`. */
  knownGaps?: Record<string, string>;
}

const EXPECTED_DIR = join(FIXTURES_DIR, 'expected/detect');

const EXPECTED: ExpectedFile[] = readdirSync(EXPECTED_DIR)
  .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(EXPECTED_DIR, name), 'utf8')) as ExpectedFile);

const FIXTURE_PROFILE: Record<string, string> = Object.assign({}, ...EXPECTED.map((e) => e.fixtures));
const FIXTURE_VARIANT: Record<string, { gcodeSystem: string; detected: boolean }> = Object.assign(
  {},
  ...EXPECTED.map((e) => e.variants ?? {}),
);

const KNOWN_GAPS: Record<string, string> = Object.assign({}, ...EXPECTED.map((e) => e.knownGaps ?? {}));

/**
 * Every fixture that opens and that one profile wins outright. A known detection gap is
 * left out: its winner is the wrong profile, so a margin over the runner-up means nothing,
 * and `detect.test.ts` already runs it as an expected failure. A fixture `detectResult` calls
 * uncertain (M12.5: a fragment, or a dialect gEdit has no profile for) is left out too: it
 * fits no dialect well by definition, and `detectRp.test.ts` holds what is said about it.
 */
const decided = listFixtures('nc').filter((rel) => {
  const expected = FIXTURE_PROFILE[rel];
  if (expected === undefined || expected === 'fallback' || expected === 'refused' || rel in KNOWN_GAPS) return false;
  const opened = openFixture(rel);
  return opened.refused !== null || !detectResult(BUILTINS, `/work/${rel}`, opened.text, KLARTEXT).uncertain;
});

describe('the profile margin on every NC fixture', () => {
  const printed: string[] = [];

  it.each(decided)('%s wins by at least 3', (rel) => {
    const opened = openFixture(rel);
    if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
    const path = `/work/${rel}`;
    const { winner, runnerUp, margin } = ranked(path, opened.text);
    const family = insideFamily(path, opened.text);
    printed.push(`${rel}: ${winner} +${margin} over ${runnerUp}, +${family.margin} by ${family.by} in its family`);

    // The mirror above has to agree with the function the app runs, or the margin it
    // reports describes nothing.
    expect(detectProfile(BUILTINS, path, opened.text, KLARTEXT), rel).toBe(winner);
    expect(winner, rel).toBe(FIXTURE_PROFILE[rel]);
    expect(margin, `${rel}: ${winner} beats ${runnerUp} by ${margin} only`).toBeGreaterThanOrEqual(MIN_MARGIN);
  });

  it('prints the margins for the review', () => {
    expect(printed.length).toBe(decided.length);
    console.log(`profile detection margins (G10 §8.7 item 4):\n  ${printed.sort().join('\n  ')}`);
  });
});

describe('the mill and the lathe against each other', () => {
  it('reads a turning program as a lathe and a milling program as a mill', () => {
    expect(detectProfile(BUILTINS, '/work/a.nc', readFixture('nc/fanuc-lathe/l01-turning-a.nc'), MILL)).toBe(LATHE);
    expect(detectProfile(BUILTINS, '/work/a.nc', readFixture('nc/fanuc/f01-mill-3tools.nc'), LATHE)).toBe(MILL);
  });

  it('keeps a mill whose tool numbers have four digits', () => {
    // `T1001 M6` looks like a turret word (`T\d{4}`) and is not one: the mill markers of
    // §8.1 — the `M6` itself, `G43 … H`, the `Y` words — outweighed it, and since M12.5
    // the turret-word rule does not fire on a block that writes `M6` (it was 5).
    const rel = 'nc/ambiguous/mill-4digit-t.nc';
    const text = readFixture(rel);
    expect(ranked(`/work/${rel}`, text).winner).toBe(MILL);
    // It is not a tie broken by `priority`: the mill outscores the lathe on this file.
    expect(insideFamily(`/work/${rel}`, text)).toEqual({ by: 'score', margin: 11 });
  });

  it('reads a five-digit T word as a turret word too (owner decision of 2026-09-27)', () => {
    // A lathe post of the owner writes `T12345` (which digits are the tool is the machine's
    // `toolWord` setting, M12.5 decision 1; detection only needs the word's shape).
    // It counts as lathe evidence exactly like `T0101`, and a mill program whose tool
    // numbers have five digits stays a mill on its `M6`, as with four (`mill-4digit-t.nc`).
    const turning = ['%', 'O0510', 'T12345', 'G96 S180 M03', 'G00 X50. Z2.', 'G01 Z-30. F0.2', 'G00 X200. Z200.', 'T10101', 'G97 S800 M03', 'M30', '%', ''].join('\n');
    expect(scores(null, 'T12345').get(LATHE)).toBe(3);
    expect(scores(null, 'T12345').get(MILL)).toBe(0);
    // Two turret words, three points each over the mill: the rest is the spindle modes.
    expect(insideFamily(null, turning)).toEqual({ by: 'score', margin: 12 });
    expect(insideFamily(null, turning.replace(/T\d{5}/g, 'T1'))).toEqual({ by: 'score', margin: 6 });
    expect(detectProfile(BUILTINS, '/work/a.nc', turning, MILL)).toBe(LATHE);
    const milling = readFixture('nc/ambiguous/mill-4digit-t.nc').replace(/T1(\d{3})/g, 'T10$1');
    expect(milling).toMatch(/T10\d{3}/);
    expect(ranked('/work/a.nc', milling).winner).toBe(MILL);
  });

  it('keeps a Fanuc lathe program that calls a builder macro G183 a lathe (R1)', () => {
    // M8 re-review F2. The program is kept under expected/detect/programs because the code
    // databases cannot describe a builder's macro code, which every nc/ fixture must be.
    const text = readFileSync(join(FIXTURES_DIR, 'expected/detect/programs/l08-g183-macro.nc'), 'utf8');
    for (const path of ['/work/flange.nc', null]) {
      const { winner, runnerUp, margin } = ranked(path, text);
      expect(winner, String(path)).toBe(LATHE);
      expect(margin, `${String(path)}: +${margin} over ${runnerUp}`).toBeGreaterThanOrEqual(MIN_MARGIN);
      expect(detectProfile(BUILTINS, path, text, 'okuma-osp'), String(path)).toBe(LATHE);
    }
  });

  it('keeps the mill-turn fixture of Phase 1 a mill', () => {
    // `f04-feed-modes.nc` carries `G50 S2500` and `G96 S180` on a mill-turn machine, both
    // of them lathe markers. P1 read it as a mill and it still does (§5, M6 goals).
    const rel = 'nc/fanuc/f04-feed-modes.nc';
    const { winner, margin } = ranked(`/work/${rel}`, readFixture(rel));
    expect(winner).toBe(MILL);
    expect(margin).toBeGreaterThanOrEqual(MIN_MARGIN);
  });

  it('breaks a tie towards the mill', () => {
    // Nothing but a program frame: both Fanuc profiles score the same, and `priority: 1`
    // on the mill decides (§8.1). Without it the registry order would, which is not
    // something a reader of the JSON can see.
    expect(detectProfile(BUILTINS, null, '%\nO1234\n', KLARTEXT)).toBe(MILL);
    expect(compiled(MILL).profile.detect.priority).toBe(1);
    expect(compiled(LATHE).profile.detect.priority).toBe(0);
  });

  it('claims the same extensions as the mill', () => {
    // `detect.extensions` is an object, and objects merge key by key (AD-16), so the
    // extension list the lathe file restates **adds** to the mill's rather than replacing
    // it. That is why dropping `min` from the mill in M8 (F22) dropped it from the lathe
    // too, and why a `.MIN` file now reaches the Okuma profile instead of either of them.
    expect(compiled(LATHE).profile.detect.extensions).toEqual(compiled(MILL).profile.detect.extensions);
    expect(compiled(LATHE).profile.detect.extensions.min).toBeUndefined();
    expect(detectProfile(BUILTINS, '/work/a.min', '', KLARTEXT)).toBe('okuma-osp');
  });
});

describe('the G-code system of a lathe program', () => {
  const lathe = compiled(LATHE);
  const latheFixtures = decided.filter((rel) => FIXTURE_PROFILE[rel] === LATHE);

  it('has an expectation for every lathe fixture', () => {
    expect(Object.keys(FIXTURE_VARIANT).sort()).toEqual([...latheFixtures].sort());
  });

  it.each(latheFixtures)('%s', (rel) => {
    const expected = FIXTURE_VARIANT[rel];
    const text = readFixture(rel);
    const answer = variantOf(lathe, 'gcodeSystem', text);
    expect({ gcodeSystem: answer.choice, detected: answer.detected }, rel).toEqual(expected);
    if (expected.detected) expect(answer.margin, rel).toBeGreaterThanOrEqual(MIN_MARGIN);

    // I6: the mirror above was written before `detectVariants` existed (WP6.1). The
    // shipped function is what a document without a machine really asks, so the table has
    // to describe **it**. It answers the raw winner and its margin; the ≥ 3 threshold and
    // the fall back to the variant's default belong to `effectiveMachine`, which is why
    // the value is compared only where the margin carries it.
    const shipped = detectVariants(lathe, text).gcodeSystem;
    expect(shipped, rel).toBeDefined();
    expect(shipped.margin, rel).toBe(answer.margin);
    expect(shipped.margin >= VARIANT_MARGIN, rel).toBe(answer.detected);
    if (answer.detected) expect(shipped.value, rel).toBe(expected.gcodeSystem);
  });

  it('falls back to A when the program carries no marker at all', () => {
    const answer = variantOf(lathe, 'gcodeSystem', '%\nO2100\nG00 X40. Z2.\nG01 Z-10.\nM30\n%\n');
    expect(answer).toEqual({ choice: 'A', margin: 0, detected: false });
  });

  it('lets one G92 S clamp outweigh six repeated G99 cycle blocks', () => {
    // The presence rule, stated as the program that needs it: `l07-system-b-drill.nc`
    // matches system A's `G98`/`G99` rule on six lines and system B's `G92 S` rule on
    // one. Counting every line would answer A (12 against 5); counting each pattern once
    // answers B by 3, which is what the control really is.
    const text = readFixture('nc/fanuc-lathe/l07-system-b-drill.nc');
    expect(variantOf(lathe, 'gcodeSystem', text)).toEqual({ choice: 'B', margin: 3, detected: true });
    const code = sniffLines(text)
      .map((line) => maskComments(line, lathe))
      .join('\n');
    expect(code.match(/G99 G83/g)).toHaveLength(6);
    expect(code.match(/G92 S/g)).toHaveLength(1);
  });

  it('does not read a marker out of a comment', () => {
    const text = '%\nO2101 (SET G92 S2000 BY HAND)\nG00 X40. Z2.\nM30\n%\n';
    expect(variantOf(lathe, 'gcodeSystem', text).detected).toBe(false);
  });

  it('gives system B its own database and the G95 power-on feed mode', () => {
    const variant = lathe.profile.machineParams?.variants?.[0];
    expect(variant?.id).toBe('gcodeSystem');
    expect(variant?.default).toBe('A');
    expect(variant?.choices.map((c) => [c.value, c.codes])).toEqual([
      ['A', 'fanuc-lathe'],
      ['B', 'fanuc-lathe-b'],
    ]);
    // An overlay may touch `modal`, `toolCall`, `numbering` and `addresses` and nothing
    // else (§7.1); this one touches only the power-on feed mode.
    expect(variant?.choices[1].overlay).toEqual({ modal: { initial: { feedmode: 'G95' } } });
    expect(lathe.profile.modal?.initial).toEqual({ feedmode: 'G99', spindlemode: 'G97', plane: 'G18' });
  });
});

describe('the turret tool rule', () => {
  const lathe = compiled(LATHE);

  const isToolChange = (line: string): boolean =>
    lathe.re.toolTrigger.test(line) && !(lathe.re.toolIgnore?.test(line) ?? false);
  const station = (line: string): string | undefined => lathe.re.tool.exec(line)?.groups?.tool;

  it.each([
    ['T0101', true, '01'],
    ['T101', true, '1'],
    ['T1', true, '1'],
    ['T12', true, '12'],
    ['T0111', true, '01'],
    ['T0303 G00 X100. Z100.', true, '03'],
    ['N10T0101M8', true, '01'],
    // §5.2: an offset cancel is the same station with offset 00, and a retract that
    // carries it is not a tool change either. Counting them would put a tool step and a
    // program-map row on every retract (§7.1 `toolCall.ignore`).
    ['T0100', false, undefined],
    ['T100', false, undefined],
    ['T0', false, undefined],
    ['T0000', false, undefined],
    ['G00 X100. Z100. T0100', false, undefined],
    // M12.5 decision 1 (the owner, 2026-10-08, revising 2026-09-27): with no machine a
    // five-digit T word is a 2-digit tool plus a 3-digit offset (`byLength`, the default;
    // the reading under which a non-zero offset is the tool's own number, plan §7.16 #181). Its
    // cancel form is the tool followed by "000". The 3 + 2 reading is the `offset2`
    // machine setting (`r6Variants.test.ts`).
    ['T10101', true, '10'],
    ['T12345', true, '12'],
    ['T12012', true, '12'],
    ['T12300', true, '12'],
    ['T12000', false, undefined],
    // A sixth digit is outside every rule this pattern knows, so the word is left alone.
    ['T123456', false, undefined],
    // On every choice: a zero offset part in a block that writes `M6` is the tool loaded
    // into the milling spindle of a mill-turn, not an offset cancel; an all-zero word stays
    // no tool.
    ['N20 T12000 M6', true, '12'],
    ['M06 T21000', true, '21'],
    ['T0100 M6', true, '01'],
    ['T00 M6', false, undefined],
    ['G28 U0 T0100', false, undefined],
    // A block with a three-digit G code is a builder cycle whose `T` is a parameter
    // (M12.5 decision 1): no tool change, while the turret word itself still is one.
    ['G183 Z-5. T5 F20', false, undefined],
    ['G183 Z-5. T0505 F20', false, undefined],
    ['T0505', true, '05'],
  ])('%s', (line, change, tool) => {
    expect(isToolChange(line), line).toBe(change);
    if (change) expect(station(line), line).toBe(tool);
  });

  it('reads the five-digit program of M12.5 decision 1 as stations 12 and 12 with no machine', () => {
    // Before M12.5 the map read both words as station 120 (3 + 2).
    const program = ['%', 'O2000', 'N10 G50 S3000', 'N20 T12000 M6', 'N30 T12012', 'N40 G96 S200 M3', 'N60 M30', '%'];
    const index = new OutlineIndex(lathe);
    index.reset(program);
    const tools = index
      .items()
      .flatMap((item) => [item, ...(item.children ?? [])])
      .filter((item) => item.kind === 'tool')
      .map((item) => [item.line, item.tool]);
    expect(tools).toEqual([
      [4, '12'],
      [5, '12'],
    ]);
  });

  it('does not fire on a letter in front of the T', () => {
    expect(isToolChange('CUT0101')).toBe(false);
  });

  it('puts one program-map row on every turret change and none on a retract', () => {
    // The same rule read off the program map, which is where a user meets it. Every `T`
    // line is an item (F23, D25: one per CAM operation), and the two `T0100` retracts of
    // `l01` are not — counting them would double the map and the tool list.
    const rows = (rel: string): string[] => {
      const text = readFixture(rel);
      const index = new OutlineIndex(lathe);
      index.reset(text.split('\n'));
      const lines = text.split('\n');
      return index
        .items()
        .filter((item) => item.kind === 'tool')
        .map((item) => `${item.tool}: ${lines[item.line - 1].trim()}`);
    };
    expect(rows('nc/fanuc-lathe/l01-turning-a.nc')).toEqual([
      '01: T0101 (OD ROUGH)',
      '03: T0303 (THREAD)',
      '05: T0505 G00 X40. Z5. C0. (DRILL)',
    ]);
    expect(rows('nc/fanuc-lathe/l02-packed.nc')).toEqual([
      '01: N10T0101M8',
      '1: N80T101',
      '1: N130T1',
      '01: N170T0111',
    ]);
    for (const rel of ['nc/fanuc-lathe/l01-turning-a.nc', 'nc/fanuc-lathe/l02-packed.nc']) {
      expect(rows(rel).some((row) => row.includes('T0100')), rel).toBe(false);
    }
  });

  it('leaves the mill rule alone', () => {
    // A mill changes on `M6`; a bare `T` there is a pre-selection (§5.1).
    const mill = compiled(MILL);
    expect(mill.re.toolTrigger.test('T1 M6')).toBe(true);
    expect(mill.re.toolTrigger.test('T2')).toBe(false);
    // `M6 T0` unloads the spindle (5-Axis.NC, owner-public/fanuc-gcode): no tool, so `T0`
    // on an `M6` line is ignored rather than listed as tool T0.
    expect(mill.re.toolIgnore?.test('M6 T0')).toBe(true);
    expect(mill.re.toolIgnore?.test('M6 T5')).toBe(false);
  });
});

describe('what the lathe profile inherits and what it states', () => {
  const lathe = compiled(LATHE);

  it('is a lathe that extends the mill and keeps its own names', () => {
    expect(lathe.profile.extends).toBe('fanuc-gcode');
    expect(lathe.profile.machineType).toBe('lathe');
    expect(compiled(MILL).profile.machineType).toBe('mill');
    expect(lathe.profile.id).not.toBe(MILL);
    expect(lathe.profile.shortName).toBe('Fanuc T');
    expect(lathe.profile.files.filterName).toBe('Fanuc lathe G-Code');
    expect(FALLBACK_PROFILE_ID).toBe(MILL);
  });

  it('reads U and W as incremental twins and X and U as diameters', () => {
    // M9 (R6): the base profile no longer states the incremental twins; the default choice of
    // the `incrementalAddresses` variant does (r6Variants.test.ts reads every choice).
    expect(lathe.profile.addresses.incremental).toBeUndefined();
    const uw = lathe.profile.machineParams?.variants?.find((v) => v.id === 'incrementalAddresses');
    expect(uw?.default).toBe('uw');
    expect(uw?.choices[0].overlay?.addresses?.incremental).toEqual({ U: 'X', W: 'Z' });
    expect(lathe.profile.addresses.diameter).toEqual(['X', 'U']);
    expect(lathe.profile.addresses.angular).toEqual(['C']);
    expect(lathe.profile.addresses.arcCenter).toEqual(['I', 'K']);
    // The mill says nothing of the kind, and must not start to.
    expect(compiled(MILL).profile.addresses.incremental).toBeUndefined();
    expect(compiled(MILL).profile.addresses.diameter).toBeUndefined();
  });

  it('inherits the mill syntax, and states only the decimal point', () => {
    const mill = compiled(MILL).profile;
    expect(lathe.profile.syntax.comments).toEqual(mill.syntax.comments);
    expect(lathe.profile.syntax.keywords).toEqual(mill.syntax.keywords);
    expect(lathe.profile.syntax.blockNumber).toEqual(mill.syntax.blockNumber);
    // §8.8, D56: the lathe's default preset reads a number as written, so a point is not
    // significant on it; the mill keeps IS-B and `true`.
    expect(lathe.profile.syntax.decimalPointSignificant).toBe(false);
    expect(mill.syntax.decimalPointSignificant).toBe(true);
    expect(lathe.profile.machineParams?.numberInput?.default).toBe('calculator');
    expect(mill.machineParams?.numberInput?.default).toBe('is-b');
    // The lathe states its presets itself (an array is replaced as a whole, AD-16): the
    // same three, because the mill's "As written" label is about the mill.
    expect(lathe.profile.machineParams?.numberInput?.presets?.map((p) => p.id)).toEqual([
      'is-b',
      'is-c',
      'calculator',
    ]);
  });

  // Review of the UI polish pass: the mill's "As written" label says no cycle parameter has
  // a fixed micron reading, and the lathe inherited it — where G74/G75 P and Q, G76 Q and
  // G83/G87 Q are exactly that (`unit: "increment"` in its code database).
  it('describes the lathe, not the mill, in its default number-input preset', () => {
    const presets = lathe.profile.machineParams?.numberInput?.presets ?? [];
    const calculator = presets.find((preset) => preset.id === 'calculator');
    expect(calculator?.label).not.toMatch(/mill/i);
    expect(calculator?.label).toContain('G76 Q');
    expect(calculator?.label).toContain('Q6000 is 6 mm');
    // The two increment presets say the same as the mill's.
    const mill = compiled(MILL).profile.machineParams?.numberInput?.presets ?? [];
    expect(presets.slice(0, 2)).toEqual(mill.slice(0, 2));
  });

  it('offers exactly the machine parameters of §8.8', () => {
    expect(lathe.profile.machineParams?.diameter).toBe('on');
    expect(lathe.profile.machineParams?.modalGroups).toEqual(['feedmode', 'spindlemode', 'plane']);
    expect(compiled(MILL).profile.machineParams?.modalGroups).toEqual(['feedmode', 'distance', 'plane']);
    expect(compiled(MILL).profile.machineParams?.diameter).toBeUndefined();
    expect(compiled(MILL).profile.machineParams?.variants).toBeUndefined();
    // Klartext declares no machine parameters at all, so it has no machine item (§8.8).
    expect(compiled(KLARTEXT).profile.machineParams).toBeUndefined();
    // M12 (P12, the owner's decision of 2026-10-07, §8.9): channel presets are offered,
    // never applied, and every one is `verify`; `channelPresets.test.ts` pins which profile
    // declares which. The mill and Klartext declare none.
    for (const cp of BUILTINS) {
      const decl = cp.profile.machineParams;
      if (cp.profile.id === MILL || cp.profile.id === KLARTEXT) expect(decl?.channels, cp.profile.id).toBeUndefined();
      for (const preset of decl?.channels?.presets ?? []) expect(preset.verify, `${cp.profile.id}/${preset.id}`).toBe(true);
    }
  });

  it('says of every preset where it comes from', () => {
    const presets = [
      ...(compiled(MILL).profile.machineParams?.numberInput?.presets ?? []),
      ...(lathe.profile.machineParams?.numberInput?.presets ?? []),
    ];
    expect(presets.length).toBe(6);
    for (const preset of presets) {
      expect(typeof preset.label, preset.id).toBe('string');
      expect(preset.label.length, preset.id).toBeGreaterThan(0);
      // §8 header: a preset is a documented default, so it names its source or says it is
      // not confirmed. Both is allowed; neither is not.
      expect(preset.source !== undefined || preset.verify === true, preset.id).toBe(true);
      // The label has to tell the user what happens to a number with and without a point.
      expect(preset.label, preset.id).toMatch(/X50\.? /);
    }
  });

  it('rewrites the block references a renumber can follow, and only those', () => {
    const rules = lathe.profile.numbering.references ?? [];
    expect(rules.map((r) => [r.addresses.join(''), r.rewrite ?? true])).toEqual([
      // `M99 P` may name a block in the **caller**, which renumbering this file cannot
      // see, so it is reported and never rewritten (F42).
      ['P', false],
      // `M98 Q…` without a `P` calls a block of this program: followed and rewritten.
      ['Q', true],
      // G8 M6: with a `P` it starts another program at *that* program's block, so the
      // lathe now carries the same reporting rule the mill got in I6. Nothing is
      // rewritten by it — the user guide promises such a line is listed with its reason,
      // and before this the lathe listed nothing at all.
      ['Q', false],
      ['PQ', true],
      ['GOTO', true],
    ]);
  });
});

// B1 B2: the thread-cycle rule (`G70`-`G73` with a `P` and a `Q`) looked ahead for the `P` and the
// `Q` from every `G7x` it found, so a long line of `G71 G71 G71 ...` cost the square of its
// length (34-38 ms on 16,000 characters). Detection reads 400 lines on open, and a program
// that is one very long line stalled it. The rule now looks ahead once, from the start of the
// line, like the map's own `G71` trigger.
describe('the thread-cycle rule of detection (B1 B2)', () => {
  const lathe = compiled(LATHE);
  const rule = lathe.re.detectContent.find((r) => r.weight === 6 && r.re.source.includes('7[0-3]'));
  const claims = (line: string): boolean => rule?.re.test(line) === true;

  it('finds the rule', () => {
    expect(rule).toBeDefined();
  });

  it('claims a roughing or finishing cycle block that gives its P and Q, in either order', () => {
    expect(claims('G71 P100 Q200 U0.4 W0.1 F0.3')).toBe(true);
    expect(claims('N50 G70 P100 Q200')).toBe(true);
    expect(claims('G73 Q200 P100 U1.')).toBe(true);
    expect(claims('G072 P1 Q2')).toBe(true);
    // The two addresses may now stand in front of the G, as the map trigger reads them.
    expect(claims('P100 Q200 G71')).toBe(true);
    expect(claims('P100 G71 Q200')).toBe(true);
  });

  it('claims nothing without both addresses, with a longer number or with a letter in front', () => {
    expect(claims('G71 P100')).toBe(false);
    expect(claims('G71 Q200')).toBe(false);
    expect(claims('G74 P100 Q200')).toBe(false);
    expect(claims('G710 P100 Q200')).toBe(false);
    expect(claims('G71.5 P100 Q200')).toBe(false);
    expect(claims('XG71 P100 Q200')).toBe(false);
    expect(claims('G1 X10. Z-5.')).toBe(false);
  });

  it('reads only what stands in front of a comment', () => {
    expect(claims('G71 P100 (Q200)')).toBe(false);
    expect(claims('(G71) P100 Q200')).toBe(false);
    expect(claims('G71 (P100 Q200)')).toBe(false);
    expect(claims('P100 Q200 (G71)')).toBe(false);
    expect(claims('G71 P100 Q200 (CYCLE)')).toBe(true);
  });

  // The same budget as the Okuma rules (`okuma.test.ts`): eight times the line, at most 24 times the time.
  it('reads a long line in time proportional to its length, with every content rule', () => {
    const SHAPES: [string, string][] = [
      ['blanks', ' '],
      ['letters', 'A'],
      ['thread cycles', 'G71 '],
      ['a cycle with its P', 'G71 P1 '],
      ['a cycle with both addresses', 'G71 P1 Q1 '],
      ['the addresses alone', 'P Q '],
      ['packed words', 'G1X1'],
      ['packed cycles', 'G71P1Q'],
      ['tool words', 'T0101 '],
      ['the retract words', 'G28 U0. W0. '],
      ['comments', '(A) '],
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
    lathe.re.detectContent.forEach((r, i) => {
      for (const [name, unit] of SHAPES) {
        const short = cost(r.re, unit.repeat(4000 / unit.length));
        const long = cost(r.re, unit.repeat(32000 / unit.length));
        expect(long, `detect.content[${i}] on ${name}: ${short.toFixed(2)} ms for 4k, ${long.toFixed(2)} ms for 32k`).toBeLessThan(
          Math.max(50, 24 * short),
        );
      }
    });
  });
});

/** The editor text of a fixture. */
function readFixture(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
  return opened.text;
}
