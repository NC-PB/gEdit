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
import { MAX_SNIFF_LINES, VARIANT_MARGIN, detectProfile, detectVariants } from '$lib/core/profiles/detect';
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

/** Every fixture that opens and that one profile wins outright. */
const decided = listFixtures('nc').filter((rel) => {
  const expected = FIXTURE_PROFILE[rel];
  return expected !== undefined && expected !== 'fallback' && expected !== 'refused';
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
    // §8.1 — the `M6` itself, `G43 … H`, the `Y` words — outweigh it.
    const rel = 'nc/ambiguous/mill-4digit-t.nc';
    const text = readFixture(rel);
    expect(ranked(`/work/${rel}`, text).winner).toBe(MILL);
    // It is not a tie broken by `priority`: the mill outscores the lathe on this file.
    expect(insideFamily(`/work/${rel}`, text)).toEqual({ by: 'score', margin: 5 });
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
    // it: `min` is inherited and stays until M8 hands it to Okuma (F22). It costs
    // nothing — a `.min` file scores the same 2 on both Fanuc profiles and the tie goes
    // to the mill — but it is worth knowing before somebody reads §8.1 as a removal.
    expect(compiled(LATHE).profile.detect.extensions).toEqual(compiled(MILL).profile.detect.extensions);
    expect(detectProfile(BUILTINS, '/work/a.min', '', KLARTEXT)).toBe(MILL);
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
    // Five digits are not a turret word on these controls.
    ['T10101', false, undefined],
  ])('%s', (line, change, tool) => {
    expect(isToolChange(line), line).toBe(change);
    if (change) expect(station(line), line).toBe(tool);
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
    expect(mill.re.toolIgnore).toBeUndefined();
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
    expect(lathe.profile.addresses.incremental).toEqual({ U: 'X', W: 'Z' });
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
    // The presets themselves are inherited key by key (AD-16): the lathe repeats none.
    expect(lathe.profile.machineParams?.numberInput?.presets?.map((p) => p.id)).toEqual([
      'is-b',
      'is-c',
      'calculator',
    ]);
  });

  it('offers exactly the machine parameters of §8.8', () => {
    expect(lathe.profile.machineParams?.diameter).toBe('on');
    expect(lathe.profile.machineParams?.modalGroups).toEqual(['feedmode', 'spindlemode', 'plane']);
    expect(compiled(MILL).profile.machineParams?.modalGroups).toEqual(['feedmode', 'distance', 'plane']);
    expect(compiled(MILL).profile.machineParams?.diameter).toBeUndefined();
    expect(compiled(MILL).profile.machineParams?.variants).toBeUndefined();
    // Klartext declares no machine parameters at all, so it has no machine item (§8.8).
    expect(compiled(KLARTEXT).profile.machineParams).toBeUndefined();
    // No built-in ships a channel preset in Phase 2 (§8.9, D58). `channels` is not a
    // declared member until M10, so it is read here the way the G10 reviewer greps for it.
    for (const cp of BUILTINS) {
      const decl = cp.profile.machineParams as Record<string, unknown> | undefined;
      expect(decl?.channels, cp.profile.id).toBeUndefined();
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

/** The editor text of a fixture. */
function readFixture(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
  return opened.text;
}
