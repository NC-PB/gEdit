// What the shipped Sinumerik profile decides about a file (plan §8.5, §8.8, AD-24, AD-31,
// and gate G10 §8.7 items 4 and 5a). Owner: WP8.5.
//
// The `syntax` section is **not** tested here: the M8 prelude pinned it for the milestone
// (P8 item 3) and the tokenizer and grammar packages own its behaviour. What this file
// answers is the rest of the profile, and every assertion in it decides something a
// machinist sees:
//
//   1. **Which profile?** `detect.content`, scored the way `core/profiles/detect.ts`
//      scores it. §8.5 asks for a margin of at least 3 over the runner-up and names
//      Klartext, because both dialects write `;` comments. On a turning program the real
//      runner-up is the Fanuc lathe: block numbers, G codes and `G96`/`G97` score there on
//      almost every line. The profile therefore scores those lines the same way, or a
//      program of ordinary length would lose to the Fanuc lathe line by line, `.MPF` or
//      not — which is why the long-program cases below exist.
//   2. **Which tool, and when?** The turret rule of §8.5: every `T` word except `T0`,
//      `T="NAME"` included, the spindle forms `T1=5` and `T2="NAME"` read as the tool
//      they name, and never a `T` inside a string, because a post writes `MSG("T1 ROUGH")`.
//   3. **What does the map show?** Programs, labels, comments and `MSG` texts, calls,
//      stops and ends — and not a stop on `M1=4` or an end on `M2=5`, which switch a
//      spindle.
//   4. **What does a number mean?** In Siemens mode a number is read as written, with or
//      without a point (the 840D sl programming manual, 06/2019, §2.15.6): that is the one
//      preset, so `X50` has its value with no machine, as `X50.`, `F0.2` and `G4 F2` do. The
//      increment readings belong to the ISO dialect mode, which this profile does not read.
//   5. **Is X a diameter?** `DIAMON` is the default for this turning profile (D35), which
//      is a property of the effective machine and not of the JSON alone.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileProfile } from '$lib/core/profiles/compile';
import { MAX_SNIFF_LINES, detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { numberClassOf, resolveValue } from '$lib/core/machines/numbers';
import { parseNumber } from '$lib/core/nc/numbers';
import { lookupCode } from '$lib/core/codes/lookup';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { renumber } from '$lib/core/transforms/renumber';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { FIXTURES_DIR, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { MachineConfig } from '$lib/core/machines/types';
import type { NumericLiteral } from '$lib/core/nc/types';

const SINUMERIK = 'sinumerik';
const KLARTEXT = 'heidenhain-klartext';
const MILL = 'fanuc-gcode';
const LATHE = 'fanuc-lathe';
/** M9 (R2): the milling child of this profile; `sinumerikMill.test.ts` holds the two apart. */
const SINUMERIK_MILL = 'sinumerik-mill';

/** The minimum distance between the winner and the runner-up that §8.5 asks for. */
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

const sinumerik = compiled(SINUMERIK);
const DB: CodeDb = resolveCodeDbs(BUILTIN_CODE_DB_JSON)[SINUMERIK];

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
 * The score of every profile for one file, by the rules of `detect.ts`: the extension
 * weight plus the **strongest** matching content rule per line. It is a second
 * implementation on purpose — `detectProfile` answers with an id and says nothing about
 * the distance to the next profile — and every assertion below cross-checks its winner
 * against the shipped function, so the two cannot drift apart without a failure.
 */
function scores(path: string | null, text: string): Map<string, number> {
  const out = new Map<string, number>();
  const name = path === null ? '' : (path.split(/[\\/]/).pop() ?? '');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
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

/** The dialect family a profile belongs to: the Fanuc mill and lathe are one, and so are the two Siemens profiles. */
function familyOf(id: string): string {
  if (id === SINUMERIK_MILL) return SINUMERIK;
  return id === LATHE ? MILL : id;
}

/** The winner and its distance to the best profile of every other dialect. */
function margins(path: string | null, text: string): { winner: string; mine: number; others: Map<string, number> } {
  const table = scores(path, text);
  const winner = [...table].sort((a, b) => b[1] - a[1])[0][0];
  const mine = table.get(winner) ?? 0;
  const others = new Map<string, number>();
  for (const [id, score] of table) {
    const family = familyOf(id);
    if (family === familyOf(winner)) continue;
    others.set(family, Math.max(others.get(family) ?? 0, score));
  }
  return { winner, mine, others };
}

/** The editor text of a fixture. */
function readFixture(rel: string): string {
  const opened = openFixture(rel);
  if (opened.refused !== null) throw new Error(`${rel} was refused: ${opened.refused}`);
  return opened.text;
}

/**
 * A program of `count` lines built from `text`: its first three lines, then its blocks
 * over and over, block numbers rewritten in steps of 10. It is what a real posted program
 * looks like to detection — a header, then hundreds of ordinary blocks. Comment lines,
 * tape marks and program numbers are not repeated, so the dialect markers that come with
 * them do not multiply either.
 */
function longProgram(text: string, count: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const out = lines.slice(0, 3);
  const blocks = lines.slice(3).filter((line) => !/^\s*(?:[;(%]|O\d)/i.test(line));
  if (blocks.length === 0) throw new Error('no blocks to repeat');
  let n = 10;
  while (out.length < count) {
    for (const block of blocks) {
      out.push(block.replace(/^N\d+/, () => `N${n}`));
      n += 10;
      if (out.length >= count) break;
    }
  }
  return `${out.join('\n')}\n`;
}

const FIXTURES = listFixtures('nc/sinumerik');

// ---------------------------------------------------------------------------
// 1. Detection
// ---------------------------------------------------------------------------

describe('a Sinumerik program is recognised as one', () => {
  const printed: string[] = [];

  it('has the fixtures §9.1 names', () => {
    for (const name of ['s01-shaft.MPF', 's02-drill.MPF', 's03-sub.SPF', 'detect-sinumerik.txt', 'SHAFT_OP20']) {
      expect(FIXTURES, name).toContain(`nc/sinumerik/${name}`);
    }
  });

  it.each(FIXTURES)('%s wins by at least 3 over every other dialect', (rel) => {
    const text = readFixture(rel);
    const path = `/work/${rel}`;
    const { winner, mine, others } = margins(path, text);

    expect(detectProfile(BUILTINS, path, text, MILL), rel).toBe(SINUMERIK);
    expect(winner, rel).toBe(SINUMERIK);
    const row: string[] = [];
    for (const [family, score] of others) {
      expect(mine - score, `${rel}: ${mine} against ${family} ${score}`).toBeGreaterThanOrEqual(MIN_MARGIN);
      row.push(`${family} +${mine - score}`);
    }
    printed.push(`${rel}: sinumerik ${mine}, ${row.join(', ')}`);
  });

  it('prints the margins for the review', () => {
    expect(printed.length).toBe(FIXTURES.length);
    console.log(`Sinumerik detection margins (G10 §8.7 item 4):\n  ${printed.sort().join('\n  ')}`);
  });

  it.each(FIXTURES.filter((rel) => /\.(MPF|SPF)$/.test(rel)))(
    '%s stays Sinumerik at 450 lines, as .MPF, as .txt and without an extension',
    (rel) => {
      // With the rules §8.5 lists and nothing else, a 2,000-line block-numbered turning
      // program scored 22 for this profile against 397 for the Fanuc lathe: every
      // `N… G1 X…` line is worth 1 there and nothing here. The neutral rules close that gap.
      const text = longProgram(readFixture(rel), 450);
      for (const path of ['/work/long.MPF', '/work/long.txt', '/work/LONG']) {
        const { winner, mine, others } = margins(path, text);
        expect(winner, `${rel} as ${path}`).toBe(SINUMERIK);
        expect(detectProfile(BUILTINS, path, text, MILL), `${rel} as ${path}`).toBe(SINUMERIK);
        for (const [family, score] of others) {
          expect(mine - score, `${rel} as ${path}: ${mine} against ${family} ${score}`).toBeGreaterThanOrEqual(MIN_MARGIN);
        }
      }
    },
  );

  it.each(['nc/fanuc-lathe/l01-turning-a.nc', 'nc/fanuc-lathe/l05-system-b.nc', 'nc/fanuc/f01-mill-3tools.nc', 'nc/fanuc/f04-feed-modes.nc'])(
    'leaves the Fanuc program %s a Fanuc program at 450 lines',
    (rel) => {
      const text = longProgram(readFixture(rel).replace(/\r/g, ''), 450);
      for (const path of ['/work/long.nc', '/work/long.txt']) {
        const table = scores(path, text);
        const fanuc = Math.max(table.get(MILL) ?? 0, table.get(LATHE) ?? 0);
        expect(familyOf(detectProfile(BUILTINS, path, text, KLARTEXT)), `${rel} as ${path}`).toBe(MILL);
        expect(fanuc - (table.get(SINUMERIK) ?? 0), `${rel} as ${path}`).toBeGreaterThanOrEqual(MIN_MARGIN);
      }
    },
  );

  it('scores a turning block as the Fanuc profiles do, and leaves a block that moves Y to the mill', () => {
    // A block with nothing but block number, G code and positions says nothing about the
    // dialect, so it scores 1 here exactly as on the Fanuc profiles — written `X10` or
    // `X10.`, because a Siemens post may write the point too. A `Y` word is the mill
    // profile's marker and rare on a lathe, so this turning profile leaves such a line
    // alone; that is what keeps the Fanuc milling fragment, which is ambiguous by
    // construction, with the mill.
    const neutral = (line: string): number => scores(null, line).get(SINUMERIK) ?? 0;
    expect(neutral('N110 G1 Z-1. F200.')).toBe(1);
    expect(neutral('N110 G1 Z-1 F0.2')).toBe(1);
    expect(neutral('N120 X40.5')).toBe(1);
    expect(neutral('G0 X10 Z2')).toBe(1);
    expect(neutral('N100 G0 X10. Y10.')).toBe(0);
    expect(neutral('N130 Y30.')).toBe(0);
    expect(neutral('X10 Z2')).toBe(0);
    const rel = 'nc/ambiguous/fanuc-fragment.txt';
    const table = scores(`/work/${rel}`, readFixture(rel));
    expect(table.get(SINUMERIK)).toBe(4);
    expect((table.get(MILL) ?? 0) - (table.get(SINUMERIK) ?? 0)).toBeGreaterThanOrEqual(MIN_MARGIN);
  });

  it('counts the syntax only a Siemens post writes on a line that moves Y as well (R1)', () => {
    // Three of the owner's five published Siemens programs are milling programs and opened
    // as Fanuc mill: nearly every line moves Y, and the neutral rules leave such a line to
    // the mill. The markers below are Siemens-only, so they count on those lines too.
    for (const line of [
      'N110 G2 X130 Y40 CR=15',
      'N240 X=AC(100) Y=AC(20)',
      'N250 X100 Y=IC(40)',
      'N100 CYCLE800(1,"TABLE",0,27,0,0,0,0,0,0,0,0,0,-1)',
      'N20 CYCLE800',
      'N220 MCALL CYCLE81(5,0,2,-12,)',
      'N320 TRAORI',
      'WORKPIECE(,,,"BOX",112,0,-30,-80,0,0,120,80)',
      'MSG("OP1 - FACING")',
      'N100 MSG()',
    ]) {
      const table = scores(null, line);
      expect(table.get(SINUMERIK), line).toBeGreaterThanOrEqual(3);
      expect(table.get(SINUMERIK), line).toBeGreaterThan(Math.max(table.get(MILL) ?? 0, table.get(LATHE) ?? 0));
    }
    // An Okuma message is `MSG (TEXT)`, with no string: not a Siemens marker.
    expect(scores(null, 'MSG (CHECK THE JAWS)').get(SINUMERIK)).toBe(0);
  });

  it('opens a Siemens milling program as Siemens, header or not, with the milling profile since R2', () => {
    // `%_N_…_MPF` and `;$PATH=` are decisive (detect.ts, `DECISIVE_WEIGHT`); without them
    // the markers carry the file: `s06-milling.txt` is Demo_1.mpf's case, content only.
    // M9 (R2): the milling child wins inside the family (`sinumerikMill.test.ts`).
    for (const rel of ['nc/owner-public/sinumerik-mill/2.5D_Milling.mpf', 'nc/owner-public/sinumerik-mill/5X_Milling.mpf']) {
      const text = readFixture(rel);
      for (const path of ['/work/prog.nc', '/work/prog.txt', null]) {
        expect(detectProfile(BUILTINS, path, text, MILL), `${rel} ${String(path)}`).toBe(SINUMERIK_MILL);
      }
    }
    for (const rel of ['nc/owner-public/sinumerik-mill/Demo_1.mpf', 'nc/sinumerik-mill/s06-milling.txt']) {
      const { winner, mine, others } = margins(null, readFixture(rel));
      expect(winner, rel).toBe(SINUMERIK_MILL);
      for (const [family, score] of others) expect(mine - score, `${rel}: ${family}`).toBeGreaterThanOrEqual(MIN_MARGIN);
    }
  });

  it('stays Sinumerik at 450 lines when a post writes a point behind every whole number', () => {
    // `X64.` instead of `X64`: a Fanuc post has to write it, a Siemens post may. The
    // neutral lines tie either way, so the markers still decide.
    const dotted = readFixture('nc/sinumerik/s01-shaft.MPF')
      .split('\n')
      .map((line) => (/^[;%]/.test(line) ? line : line.replace(/([XZIKF]-?\d+)(?![\d.])/g, '$1.')))
      .join('\n');
    expect(dotted).toContain('N60 G0 X64. Z2. M8');
    const text = longProgram(dotted, 450);
    for (const path of ['/work/long.MPF', '/work/long.txt']) {
      const { winner, mine, others } = margins(path, text);
      expect(winner, path).toBe(SINUMERIK);
      for (const [family, score] of others) expect(mine - score, `${path}: ${family}`).toBeGreaterThanOrEqual(MIN_MARGIN);
    }
  });

  it('leaves every Klartext fixture Klartext, although both dialects comment with ;', () => {
    for (const rel of listFixtures('nc/heidenhain')) {
      expect(detectProfile(BUILTINS, `/work/${rel}`, readFixture(rel), MILL), rel).toBe(KLARTEXT);
    }
    const fragment = 'nc/ambiguous/heidenhain-fragment.txt';
    expect(detectProfile(BUILTINS, `/work/${fragment}`, readFixture(fragment), MILL)).toBe(KLARTEXT);
  });

  it('does not take a page of Fanuc comments for a program, and takes a page of ; comments', () => {
    const rel = 'nc/ambiguous/comment-only.txt';
    expect(detectProfile(BUILTINS, `/work/${rel}`, readFixture(rel), MILL)).not.toBe(SINUMERIK);
    expect(detectProfile(BUILTINS, null, '; ONE\n; TWO\n; THREE\n', MILL)).toBe(SINUMERIK);
    expect(scores(null, '; ONE\n; TWO\n; THREE\n').get(SINUMERIK)).toBe(3);
  });

  it('claims .mpf and .spf, in either case, and nothing else', () => {
    expect(sinumerik.profile.detect.extensions).toEqual({ mpf: 8, spf: 8 });
    expect(sinumerik.profile.files.extensions).toEqual(['mpf', 'spf']);
    for (const path of ['/work/a.mpf', '/work/a.spf', '/work/A.MPF', '/work/B.SPF']) {
      expect(detectProfile(BUILTINS, path, '', MILL), path).toBe(SINUMERIK);
    }
    expect(detectProfile(BUILTINS, '/work/a.nc', '', MILL)).toBe(MILL);
    expect(detectProfile(BUILTINS, '/work/a.min', '', MILL)).not.toBe(SINUMERIK);
  });

  it('matches every content rule on some fixture line, and every marker on no other dialect', () => {
    // G10 §8.7 item 4: every pattern has a positive and a negative line. Four rules match
    // other dialects' lines on purpose: the three neutral ones (block numbers, G and M
    // codes, G96/G97), which score what the Fanuc profiles score, and the whole-line `;`
    // comment, which a Klartext fragment without block numbers writes too (§8.5). Every
    // other rule is a marker and must not fire outside this dialect.
    // M9 (WP9.1): the Siemens milling programs are Siemens lines too; `s06-milling.txt` moved there.
    const own = [...FIXTURES, ...listFixtures('nc/sinumerik-mill')].flatMap((rel) => sniffLines(readFixture(rel)));
    // The owner's own Sinumerik programs (`nc/owner-public/sinumerik/`) are this dialect
    // too, not a negative line, and so are the Siemens milling programs (M9, R2).
    const foreign = listFixtures('nc')
      .filter(
        (rel) =>
          !/^nc\/(?:owner-public\/)?sinumerik(?:-mill)?\//.test(rel) && openFixture(rel).refused === null,
      )
      .flatMap((rel) => sniffLines(readFixture(rel)));
    const neutral = new Set([
      '^(?![^;]*(?<![A-Z_$])Y)N\\d+',
      '^(?![^;]*(?<![A-Z_$])Y)(?:N\\d+[ \\t]*)?[GM]\\d{1,3}(?![\\d.])',
      '(?<![A-Z0-9_$])G0*9[67](?![\\d.])',
      '^;',
    ]);
    const rules = sinumerik.re.detectContent;
    expect(rules.filter((rule) => neutral.has(rule.re.source)).length).toBe(neutral.size);
    for (const rule of rules) {
      expect(own.some((line) => rule.re.test(line)), `${rule.re.source} matches no fixture line`).toBe(true);
      expect(foreign.every((line) => rule.re.test(line)), `${rule.re.source} has no negative line`).toBe(false);
      if (neutral.has(rule.re.source)) continue;
      const hits = foreign.filter((line) => rule.re.test(line));
      expect(hits, `${rule.re.source} fires in another dialect`).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The turret rule (§8.5, D35)
// ---------------------------------------------------------------------------

describe('the turret tool rule', () => {
  const isToolChange = (line: string): boolean =>
    sinumerik.re.toolTrigger.test(line) && !(sinumerik.re.toolIgnore?.test(line) ?? false);
  const tool = (line: string): string | undefined => sinumerik.re.tool.exec(line)?.groups?.tool;

  it.each([
    ['T="FACEMILL_D50"', true, '"FACEMILL_D50"'],
    ['T = "ROUGH_80" D1', true, '"ROUGH_80"'],
    ['T1', true, '1'],
    ['T1D1', true, '1'],
    ['t12d1', true, '12'],
    ['T0303', true, '0303'],
    ['N120 T12 D1', true, '12'],
    // The spindle forms (§5.1 of the notes): the number in the address names the spindle,
    // the value the tool. Reading `T1=5` as tool 1 would label the map with the spindle.
    ['T1=5 D1', true, '5'],
    ['T2="PARTOFF" D1', true, '"PARTOFF"'],
    ['T1 = 12', true, '12'],
    // `T0` deselects the tool (§5.1); it is not a change, on any spindle.
    ['T0', false, undefined],
    ['T0 D0', false, undefined],
    ['T00', false, undefined],
    ['T1=0', false, undefined],
    // Words that merely contain a T, or a T that is the start of a name.
    ['TRAORI', false, undefined],
    ['STOPRE', false, undefined],
    ['TRAFOOF', false, undefined],
    ['$TC_DP1[1,1]=0.4', false, undefined],
    ['GOTOF T1_DONE', false, undefined],
    ['T=R1', false, undefined],
    // A post writes the tool into an operator message. It is text, not a tool change.
    ['MSG("T1 ROUGH")', false, undefined],
    ['N30 MSG("T12 FINISH")', false, undefined],
  ])('%s', (line, change, station) => {
    expect(isToolChange(line), line).toBe(change);
    if (change) expect(tool(line), line).toBe(station);
  });

  it('takes the tool from the line it stands on', () => {
    // A turret changes on the `T` word itself, so there is no "last T before it" rule to
    // fall back on — that is the milling case, and a milling user derives a profile (§8.5).
    expect(sinumerik.profile.toolCall.toolFrom).toBe('same-line');
    expect(sinumerik.profile.toolCall.ignore).toBeUndefined();
  });

  it('puts one program-map row on every tool change and none on a string or a T0', () => {
    const lines = readFixture('nc/sinumerik/s04-packed.MPF').split('\n');
    const index = new OutlineIndex(sinumerik);
    index.reset(lines);
    const rows = index
      .items()
      .flatMap((item) => [item, ...(item.children ?? [])])
      .filter((item) => item.kind === 'tool')
      .map((item) => `${item.text} @ ${lines[item.line - 1].trim()}`);
    expect(rows).toEqual([
      'T1 — ROUGH @ N40 T1D1',
      'T12 — FINISH @ N120 T12D1',
      'T5 @ N190 T1=5 D1',
      'PARTOFF @ N250 T2="PARTOFF" D1',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. The program map (§8.5 outline list)
// ---------------------------------------------------------------------------

describe('the program map', () => {
  /** Every item of a fixture, tool segments flattened, as `kind@line: text`. */
  function items(rel: string): string[] {
    const index = new OutlineIndex(sinumerik);
    index.reset(readFixture(rel).split('\n'));
    return index
      .items()
      .flatMap((item) => [item, ...(item.children ?? [])])
      .map((item) => `${item.kind}@${item.line}: ${item.text}`);
  }

  function itemsOf(lines: string[]): string[] {
    const index = new OutlineIndex(sinumerik);
    index.reset(lines);
    return index
      .items()
      .flatMap((item) => [item, ...(item.children ?? [])])
      .map((item) => `${item.kind}@${item.line}: ${item.text}`);
  }

  it('reads an operator message as a comment-like item, which names the tool below it', () => {
    const rows = items('nc/sinumerik/s01-shaft.MPF');
    expect(rows).toContain('comment@12: OD ROUGH');
    expect(rows).toContain('tool@13: ROUGH — OD ROUGH');
    expect(rows).toContain('tool@19: T3 — OD FINISH');
    // `MSG()` clears the message and says nothing.
    expect(rows.some((row) => row.startsWith('comment@48'))).toBe(false);
  });

  it('lists whole-line comments and leaves out the separator lines', () => {
    const rows = items('nc/sinumerik/s01-shaft.MPF');
    expect(rows).toContain('comment@4: SHAFT D60 - OP10 TURNING');
    expect(rows.some((row) => /^comment@(5|9):/.test(row))).toBe(false);
    expect(itemsOf(['; ****', ';', '; ====  ', '; -- NOTE --'])).toEqual(['comment@4: -- NOTE --']);
  });

  it('lists the transfer header and PROC as programs, and labels by their name', () => {
    const rows = items('nc/sinumerik/s03-sub.SPF');
    expect(rows).toContain('program@1: %_N_GROOVE_SPF');
    expect(rows).toContain('program@4: PROC GROOVE');
    expect(rows.filter((row) => row.startsWith('label@'))).toEqual(['label@12: NEXT_PECK', 'label@19: LAST_CUT']);
    expect(itemsOf(['N10 LOOP_A: G1 X10', '/1 N20 SKIP_B:', 'N30 X=5', 'N40 R1:=2'])).toEqual([
      'label@1: LOOP_A',
      'label@2: SKIP_B',
    ]);
  });

  it('reads the short transfer header as a program start, as the long one (M9)', () => {
    // syntax-sinumerik §2.2: line 1 is `%_N_<NAME>_MPF` or the short `%<NAME>_MPF`. The
    // tokenizer reads both as the header (`syntax.header`, pinned by P9); the map and the
    // program rule that renumbering and the scripts restart at read them the same way.
    expect(itemsOf(['%PART_ONE_MPF', 'N10 G0 X0', 'M30', '%_N_SUB_TWO_SPF', 'N10 G0 X1', 'M17'])).toEqual([
      'program@1: %PART_ONE_MPF',
      'end@3: M30',
      'program@4: %_N_SUB_TWO_SPF',
      'end@6: M17',
    ]);
    const starts = sinumerik.re.programStart;
    const names = ['%PART_ONE_MPF', '%_N_PART_ONE_MPF', '%GROOVE_SPF'].map((line) => {
      for (const re of starts) {
        const match = re.exec(line);
        if (match) return match.groups?.name ?? null;
      }
      return null;
    });
    expect(names).toEqual(['PART_ONE', 'PART_ONE', 'GROOVE']);
    // Not a header: no file id, or a `%` that is not at the start.
    expect(starts.some((re) => re.test('%PART_ONE'))).toBe(false);
    expect(starts.some((re) => re.test('N10 %PART_MPF'))).toBe(false);
  });

  it('lists an L subprogram once, with or without its pass count (M9)', () => {
    // TODO "Sinumerik structure": `L10 (1)` was a map row of its own next to `L10`. One row
    // per call, named by the subprogram; the count is not part of the name.
    expect(itemsOf(['N10 L10(1)', 'N20 L10 (1)', 'N30 L10', 'N40 L10 P2'])).toEqual([
      'subprogram-call@1: L10',
      'subprogram-call@2: L10',
      'subprogram-call@3: L10',
      'subprogram-call@4: L10',
    ]);
  });

  it('lists every call form, and a cycle by its name, modal or not', () => {
    expect(items('nc/sinumerik/s03-sub.SPF').filter((row) => row.startsWith('subprogram-call@'))).toEqual([
      'subprogram-call@24: L20',
      'subprogram-call@25: L30',
      'subprogram-call@26: CALL "PROBE_CYCLE"',
      'subprogram-call@27: EXTCALL "GROOVE_FINISH"',
      'subprogram-call@28: PROBE_DIA',
    ]);
    // `MCALL CYCLE83(…)` is listed under the cycle it makes modal; the bare `MCALL` that
    // cancels it, `SETMS(3)` and `M3=5` are no items at all.
    expect(items('nc/sinumerik/s02-drill.MPF').filter((row) => row.startsWith('subprogram-call@'))).toEqual([
      'subprogram-call@12: CYCLE83',
      'subprogram-call@24: CYCLE83',
      'subprogram-call@36: CYCLE84',
      'subprogram-call@38: CYCLE84',
      'subprogram-call@40: CYCLE84',
    ]);
    // A turning cycle the database only recognises is still a row in the map (§8.5).
    expect(items('nc/sinumerik/s01-shaft.MPF')).toContain('subprogram-call@16: CYCLE95');
    expect(itemsOf(['PCALL /_N_SPF_DIR/_N_PART_SPF'])).toEqual(['subprogram-call@1: PCALL /_N_SPF_DIR/_N_PART_SPF']);
  });

  it('lists the call forms of the manual, and the end on a line with a label', () => {
    // A name alone is a call when it carries a repeat count or a digit or an underscore; a
    // name of letters alone is how the control's own commands stand in a block.
    expect(
      itemsOf([
        'N100 SUB_PROG P3',
        'N110 RAHMEN P3',
        'N115 RAHMEN',
        'N120 PCALL/_N_WKS_DIR/_N_WELLE_WPD/WELLE(1,2)',
        'N130 EXTCALL("SURFACE_1")',
        'N135 ISOCALL PROGNAME',
        'N140 CALLPATH("/_N_WKS_DIR/_N_MYWPD_WPD")',
        'N150 DIAM90',
        'N160 SETMS',
        'N390 LOOP_END: M30',
      ]),
    ).toEqual([
      'subprogram-call@1: SUB_PROG P3',
      'subprogram-call@2: RAHMEN P3',
      'subprogram-call@4: PCALL/_N_WKS_DIR/_N_WELLE_WPD/WELLE',
      'subprogram-call@5: EXTCALL("SURFACE_1")',
      'subprogram-call@6: ISOCALL PROGNAME',
      'end@10: LOOP_END: M30',
    ]);
    // A name may stand apart from its bracket by blanks, as the control reads it; a jump,
    // a control function and a modifier stay out with or without the blank.
    expect(
      itemsOf([
        'N60 CYCLE840 (5,0,2,-15,,0.5,3,3,1,,1.5)',
        'N61 MCALL CYCLE83 (5,0,2,-18)',
        'N62 IF (R1==1) GOTOF DONE',
        'N63 SETMS (3)',
        'N64 X=AC (10)',
        'N65 CALLPATH ("/_N_WKS_DIR/_N_MYWPD_WPD")',
        'N66 EXTCALL ("SURFACE_2")',
      ]),
    ).toEqual(['subprogram-call@1: CYCLE840', 'subprogram-call@2: CYCLE83', 'subprogram-call@7: EXTCALL ("SURFACE_2")']);
  });

  it('does not read a jump, a declaration, a control function or a modifier as a call', () => {
    // The generic call rule is "an identifier written directly in front of `(`", and the
    // control's own words are excluded, so none of these is a subprogram.
    expect(
      itemsOf([
        'N10 IF R1==1 GOTOF DONE',
        'N20 DEF REAL DEPTH=5',
        'N30 G1 X=AC(10) Y=IC(-5)',
        'N40 MCALL',
        'N50 SETMS(3)',
        'N60 TRACYL(40)',
        'N70 TRANSMIT',
        'N80 WAITM(10,1,2)',
        'N90 EXTERN PROBE_DIA(INT,REAL,INT)',
      ]),
    ).toEqual([]);
  });

  it('marks the stops and the program end, and not the spindle forms of M1 and M2', () => {
    const rows = items('nc/sinumerik/s04-packed.MPF');
    expect(rows.filter((row) => row.startsWith('stop@'))).toEqual(['stop@18: M0', 'stop@19: M1']);
    expect(rows.filter((row) => row.startsWith('end@'))).toEqual(['end@34: M30']);
    // `M1=4` runs spindle 1 backwards and `M2=5` stops spindle 2 (§3.2 of the notes).
    expect(itemsOf(['N10 M1=4 S1=900', 'N20 M2=5', 'N30 M1 = 3', 'N40 M17', 'N50 RET'])).toEqual([
      'end@4: M17',
      'end@5: RET',
    ]);
    for (const re of sinumerik.re.programEnd) {
      expect(re.test('N300 M2=5'), re.source).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Numbering
// ---------------------------------------------------------------------------

describe('renumbering', () => {
  it('leaves the header, the path line and the declarations alone', () => {
    const lines = readFixture('nc/sinumerik/s03-sub.SPF').split('\n');
    const result = renumber.run(lines, {
      cp: sinumerik,
      codes: DB,
      options: {},
      firstLine: 1,
      machine: noMachine(sinumerik.profile),
    });
    for (const i of [0, 1, 2, 3, 4, 5]) expect(result.lines[i], `line ${i + 1}`).toBe(lines[i]);
    expect(result.lines[6]).toBe('N10 MSG("GROOVE IN PECKS")');
    expect(sinumerik.profile.numbering.skipStartingWith).toEqual(['%', ';', 'PROC', 'DEF', 'EXTERN']);
  });

  it('treats a jump to a block number as a reference', () => {
    expect(sinumerik.profile.numbering.references).toEqual([
      // Review NC-3: the jump keyword itself carries a bare block number (`GOTOF 200`).
      { trigger: '(?<![A-Z_])GOTO[FBC]?(?![A-Z0-9_])', addresses: ['N', 'GOTO', 'GOTOF', 'GOTOB', 'GOTOC'] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. The machine parameters (§8.8, D35, D54)
// ---------------------------------------------------------------------------

describe('the machine parameters', () => {
  const decl = sinumerik.profile.machineParams;

  it('offers exactly what §8.8 lists', () => {
    expect(decl?.units).toBe('mm');
    expect(decl?.diameter).toBe('on');
    // G96 and G97 belong to the feed type on this control (G group 15), so there is no
    // spindle mode of its own for a machine to start in.
    expect(decl?.modalGroups).toEqual(['feedmode', 'plane', 'distance']);
    expect(decl?.variants).toBeUndefined();
    expect(sinumerik.profile.modal?.initial).toEqual({ plane: 'G18', feedmode: 'G95' });
    expect(sinumerik.profile.machineType).toBe('lathe');
    // No built-in ships a channel preset in Phase 2 (§8.9, D58).
    expect((decl as Record<string, unknown> | undefined)?.channels).toBeUndefined();
  });

  it('reads numbers as written, the only reading Siemens mode has', () => {
    const presets = decl?.numberInput?.presets ?? [];
    expect(decl?.numberInput?.default).toBe('calculator');
    expect(presets.map((preset) => preset.id)).toEqual(['calculator']);
    // §8 header: the preset names its source, and the label tells the user what a written
    // number becomes. The manual settles it, so it is no longer marked for verification.
    expect(presets[0].source).toBe('syntax-sinumerik.md §3.3');
    expect(presets[0].verify).toBeUndefined();
    expect(presets[0].label).toMatch(/X50 and X50\. are both 50 mm/);
    // The default preset and `syntax.decimalPointSignificant` have to say the same thing,
    // which is what makes "no machine" behave the way the JSON reads (validate.ts).
    expect(sinumerik.profile.syntax.decimalPointSignificant).toBe(false);
  });

  it('names LIMS as a clamp, so nothing raises it with the speed', () => {
    // WP8.7 reads this: `LIMS=3000` under `G96` is the guard the programmer set.
    expect(sinumerik.profile.addresses.speedLimitWords).toEqual(['LIMS']);
    expect(compiled(LATHE).profile.addresses.speedLimitWords).toBeUndefined();
  });
});

describe('what a written number is worth without a machine (AD-31, D57)', () => {
  const profile = sinumerik.profile;
  const none = noMachine(profile);
  const g4 = lookupCode(DB, 'G4') as CodeEntry;

  function literal(raw: string): NumericLiteral {
    const lit = parseNumber(raw);
    if (lit === null) throw new Error(raw);
    return lit;
  }

  function valueFor(address: string, raw: string, blockCodes: CodeEntry[], eff = none): string | null {
    const cls = numberClassOf(address, { profile, feedUnit: 'per-rev', blockCodes, pitchFeed: false });
    return resolveValue(literal(raw), cls, eff, profile.machineParams, 'mm').value;
  }

  it('gives every word its value', () => {
    expect(g4.fNotFeed).toBe(true);
    expect(valueFor('F', '2', [g4])).toBe('2');
    expect(valueFor('F', '0.2', [])).toBe('0.2');
    expect(valueFor('X', '50.', [])).toBe('50');
  });

  it('gives a point-less position its value with no machine, because Siemens mode reads it as written', () => {
    const cls = numberClassOf('X', { profile, feedUnit: 'per-rev', blockCodes: [], pitchFeed: false });
    const answer = resolveValue(literal('50'), cls, none, profile.machineParams, 'mm');
    expect(answer.value).toBe('50');
    expect(answer.readings).toEqual([]);
    // A start angle is an angle, read as written too.
    expect(numberClassOf('SF', { profile, feedUnit: 'per-rev', blockCodes: [], pitchFeed: false })).toBe('angle');
    const machine = effectiveMachine(
      profile,
      { id: 'm', name: 'm', profile: profile.id, params: { numberInput: profile.machineParams?.numberInput?.presets[0].value } },
      'document',
      {},
    );
    expect(valueFor('X', '50', [], machine)).toBe('50');
  });
});

describe('diameter programming', () => {
  const profile = sinumerik.profile;

  function diameterOf(params: MachineConfig['params'] | null): string | undefined {
    const machine =
      params === null
        ? noMachine(profile)
        : effectiveMachine(profile, { id: 'm', name: 'm', profile: profile.id, params }, 'document', {});
    return applyMachine(profile, machine).profile.modal?.diameter;
  }

  it('is on at the first block of a document that has no machine (D35)', () => {
    expect(diameterOf(null)).toBe('on');
    expect(noMachine(profile).params.diameter).toBe('on');
    // It is assumed, not stated: the status item and the inspector say so (AD-31).
    expect(noMachine(profile).source.diameter).toBe('profile');
    expect(applyMachine(profile, noMachine(profile)).profile.modal?.sources?.diameter).toBe('profile');
  });

  it('is off when a machine says the control starts from DIAMOF, and on when it says on', () => {
    expect(diameterOf({ diameter: 'off' })).toBe('off');
    expect(diameterOf({ diameter: 'on' })).toBe('on');
    const machine = effectiveMachine(
      profile,
      { id: 'm', name: 'm', profile: profile.id, params: { diameter: 'off' } },
      'document',
      {},
    );
    expect(machine.params.diameter).toBe('off');
    expect(machine.source.diameter).toBe('machine');
    expect(applyMachine(profile, machine).profile.modal?.sources?.diameter).toBe('machine');
  });

  it('is what the generated effective profile records', () => {
    // The G10 review and the Python side read `tests/fixtures/resolved/effective/**`, not
    // this test; integration regenerates it (§5.2 rule 3), and the default stays on.
    const defaults = JSON.parse(
      readFileSync(join(FIXTURES_DIR, 'resolved/effective/sinumerik/defaults.json'), 'utf8'),
    ) as { profile: { modal?: { diameter?: string } } };
    expect(defaults.profile.modal?.diameter).toBe('on');
  });
});
