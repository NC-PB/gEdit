// "Test Profile on Document" (plan §6 M13 WP13.3, AD-29). Owner: WP13.3.
//
// The report reads the profile's own rules, so the cases here run the six built-ins over
// small programs of our own and check what each part of the profile found: the detection
// rule that scored a line, the tool-change rule with its ignore and its tool, the program
// start and end, the program-map rule, the block-number references, the lines a renumber
// leaves alone, and the setting a program's markers point at, with its margin. The slow
// warning is checked with a clock that makes one rule take longer than 50 ms; the cases that
// need a profile with no built-in equivalent patch the compiled rules.

import { describe, expect, it } from 'vitest';
import { noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectResult, detectVariants } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUDGET_MS, CHUNK_LINES, MAX_REPORT_LINES, SLOW_MS, testReport, testReportAsync } from './testReport';
import type { TestReport, TestRow, TestRowKind } from './testReport';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';

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

const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

/** A clock that never advances: every rule takes 0 ms. */
const FROZEN = (): number => 0;

function run(id: string, lines: string[], extra: Partial<Parameters<typeof testReport>[0]> = {}): TestReport {
  const cp = compiled(id);
  return testReport({
    cp,
    lines,
    codes: NO_CODES,
    machine: noMachine(cp.profile),
    now: FROZEN,
    detection: detectResult(BUILTINS, null, lines.join('\n'), id),
    variants: detectVariants(cp, lines.join('\n')),
    ...extra,
  });
}

function rowsOf(report: TestReport, kind: TestRowKind, line?: number): TestRow[] {
  return report.rows.filter((row) => row.kind === kind && (line === undefined || row.line === line));
}

const MILL = [
  '%',
  'O1001 (SYNTHETIC TEST)',
  'N10 G90 G54',
  'N20 T1 M6',
  'N30 G0 X0. Y0.',
  '(NOTE T9 M6)',
  '',
  'N40 GOTO 20',
  'N50 M98 Q20',
  'N60 M30',
  '%',
];

describe('testReport over the built-ins', () => {
  it('lists the detection rule, what it captured and its time, for the strongest rule of a line', () => {
    const report = run('fanuc-gcode', MILL);
    const detect = rowsOf(report, 'detect');
    expect(detect.length).toBeGreaterThan(0);
    const header = rowsOf(report, 'detect', 2)[0];
    expect(header).toBeDefined();
    expect(header.rule.length).toBeGreaterThan(0);
    expect(header.weight).toBeGreaterThan(0);
    expect(header.captured).toMatch(/O1001/);
    expect(header.ms).toBe(0);
    // One row per line at most: a line counts for its strongest rule only.
    const lines = detect.map((row) => row.line);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('reports what detection decided for the whole text', () => {
    const report = run('fanuc-gcode', MILL);
    expect(report.detection?.id).toBe('fanuc-gcode');
  });

  it('reads a tool change: the trigger, the tool, and no row for a comment', () => {
    const report = run('fanuc-gcode', MILL);
    const change = rowsOf(report, 'toolCall', 4);
    expect(change).toHaveLength(1);
    expect(change[0]).toMatchObject({ outcome: 'tool-change', tool: '1' });
    expect(change[0].captured).toMatch(/M0*6/);
    // `(NOTE T9 M6)` is a comment: nothing in it is a tool change.
    expect(rowsOf(report, 'toolCall', 6)).toHaveLength(0);
  });

  it('says which tool change a profile ignores, and what ignored it', () => {
    const lines = ['O1', 'G0 X1. Z1. T0100', 'T0101', 'M30'];
    const report = run('fanuc-lathe', lines);
    const unload = rowsOf(report, 'toolCall', 2)[0];
    expect(unload).toMatchObject({ outcome: 'ignored' });
    expect(unload.ignoredBy).toBeDefined();
    const load = rowsOf(report, 'toolCall', 3)[0];
    // The tool as the pattern captured it: the station and offset digits as written.
    expect(load).toMatchObject({ outcome: 'tool-change', tool: '01' });
  });

  it('finds the program start and the end', () => {
    const report = run('fanuc-gcode', MILL);
    expect(rowsOf(report, 'programStart', 2)[0].captured).toBe('O1001');
    expect(rowsOf(report, 'programEnd', 10)[0].captured).toBe('M30');
    expect(rowsOf(report, 'programStart', 4)).toHaveLength(0);
  });

  it('shows what the program map makes of a line', () => {
    const report = run('fanuc-gcode', MILL);
    const kinds = report.rows.filter((row) => row.kind === 'outline').map((row) => row.outlineKind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(rowsOf(report, 'outline', 2)[0].rule.length).toBeGreaterThan(0);
  });

  it('lists block-number references with the number they name and whether a renumber may rewrite them', () => {
    const report = run('fanuc-gcode', MILL);
    const jump = rowsOf(report, 'reference', 8)[0];
    expect(jump).toMatchObject({ target: 20, rewrite: true });
    expect(jump.captured).toMatch(/20/);
    expect(jump.rule.length).toBeGreaterThan(0);
    expect(rowsOf(report, 'reference', 9)[0]).toMatchObject({ target: 20 });
  });

  it('lists the lines a renumber would leave alone, with the reason it gives', () => {
    const report = run('fanuc-gcode', MILL);
    const skipped = rowsOf(report, 'numbering').map((row) => row.line);
    expect(skipped).toContain(1);
    expect(skipped).toContain(2);
    expect(rowsOf(report, 'numbering', 2)[0].message?.length).toBeGreaterThan(0);
    // A numbered block is renumbered, not skipped.
    expect(skipped).not.toContain(3);
  });

  it('gives no row to a line that no rule says anything about, nor to a blank one', () => {
    const report = run('fanuc-gcode', MILL);
    expect(report.rows.some((row) => row.line === 7)).toBe(false);
  });

  it('keeps the rows in line order, whole-program findings first', () => {
    const lathe = [
      'O1',
      'G50 S2000',
      'G96 S200 M3',
      'T0101',
      'G71 U1. R0.5',
      'M30',
    ];
    const report = run('fanuc-lathe', lathe);
    const order = report.rows.map((row) => row.line);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(report.rows[0].line).toBe(0);
    expect(report.rows[0].kind).toBe('variantResult');
  });

  it('reads every built-in without throwing, on a program of its own kind', () => {
    for (const cp of BUILTINS) {
      const report = testReport({ cp, lines: ['', 'G0 X1', 'M30', ''], codes: NO_CODES, machine: noMachine(cp.profile), now: FROZEN });
      expect(report.linesRead).toBe(4);
    }
  });
});

describe('testReport: the settings the program points at', () => {
  const SYSTEM_B = ['O1', 'G92 S2000', 'G96 S200 M3', 'G95', 'T0101', 'G77 X10. Z-5. F0.1', 'M30'];

  it('shows each rule that matched and the margin of the choice', () => {
    const report = run('fanuc-lathe', SYSTEM_B);
    const hits = rowsOf(report, 'variant');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((row) => row.variant === 'gcodeSystem' && row.choice === 'B')).toBe(true);
    expect(hits[0].weight).toBeGreaterThan(0);

    const result = rowsOf(report, 'variantResult').find((row) => row.variant === 'gcodeSystem');
    expect(result).toMatchObject({ line: 0, choice: 'B', acts: true });
    expect(result?.margin).toBeGreaterThanOrEqual(3);
    expect(result?.default).toBe('A');
    expect(result?.variantLabel).toBe('G-code system');
  });

  it('says when the margin is too small to act on', () => {
    const report = run('fanuc-lathe', ['O1', 'G92 S2000', 'G50 S2000', 'T0101', 'M30'], {
      variants: { gcodeSystem: { value: 'A', margin: 1 } },
    });
    const result = rowsOf(report, 'variantResult').find((row) => row.variant === 'gcodeSystem');
    expect(result).toMatchObject({ margin: 1, acts: false, choice: 'A' });
  });

  it('lists a rule once, on the first line it matches, as detection scores it once per file', () => {
    const report = run('fanuc-lathe', ['O1', 'G92 S2000', 'G92 S1500', 'G92 S1000', 'M30']);
    const rules = rowsOf(report, 'variant').map((row) => row.rule);
    expect(new Set(rules).size).toBe(rules.length);
    expect(rowsOf(report, 'variant')[0].line).toBe(2);
  });

  it('has no variant rows for a profile that declares none', () => {
    const report = run('fanuc-gcode', MILL);
    expect(rowsOf(report, 'variant')).toHaveLength(0);
    expect(rowsOf(report, 'variantResult')).toHaveLength(0);
  });
});

describe('testReport: time', () => {
  /** Every timed call takes 1 ms, except the call number `slowCall` (0-based), which takes `ms`. */
  function clock(slowCall: number, ms: number): () => number {
    let calls = 0;
    let t = 0;
    return () => {
      const c = calls++;
      if (c % 2 === 0) return t;
      t += c >> 1 === slowCall ? ms : 1;
      return t;
    };
  }

  it('times each rule and totals them', () => {
    const report = run('fanuc-gcode', MILL, { now: clock(-1, 0) });
    expect(report.totalMs).toBeGreaterThan(0);
    expect(rowsOf(report, 'detect')[0].ms).toBe(1);
    expect(report.slow).toEqual([]);
  });

  it('warns about a rule above the limit, and flags its row', () => {
    const report = run('fanuc-gcode', MILL, { now: clock(3, SLOW_MS + 10) });
    expect(report.slow).toHaveLength(1);
    expect(report.slow[0].ms).toBe(SLOW_MS + 10);
    expect(report.slow[0].line).toBeGreaterThan(0);
    expect(report.slow[0].rule).not.toBe('');
  });

  it('does not warn at exactly the limit', () => {
    const report = run('fanuc-gcode', MILL, { now: clock(3, SLOW_MS) });
    expect(report.slow).toEqual([]);
  });

  it('puts the slow flag on the row of the rule that was slow', () => {
    // Make every rule slow: every row that carries a time is flagged.
    let t = 0;
    let calls = 0;
    const slowAll = (): number => (calls++ % 2 === 0 ? t : (t += SLOW_MS + 1));
    const report = run('fanuc-gcode', ['O1', 'T1 M6'], { now: slowAll });
    const timed = report.rows.filter((row) => row.ms !== null);
    expect(timed.length).toBeGreaterThan(0);
    expect(timed.every((row) => row.slow)).toBe(true);
    expect(report.slow.length).toBeGreaterThan(0);
    // Slowest first.
    const sorted = [...report.slow].sort((a, b) => b.ms - a.ms);
    expect(report.slow).toEqual(sorted);
  });
});

describe('testReport: vetoes and bounds', () => {
  it('stops scoring a profile at the line a veto matches, and lists the veto', () => {
    const base = compiled('fanuc-gcode');
    const cp: CompiledProfile = { ...base, re: { ...base.re, detectVetoes: [/^STOPHERE/] } };
    const report = testReport({
      cp,
      lines: ['O1', 'N10 G0 X1', 'STOPHERE', 'N20 G0 X2'],
      codes: NO_CODES,
      machine: noMachine(cp.profile),
      now: FROZEN,
    });
    const veto = rowsOf(report, 'veto');
    expect(veto).toHaveLength(1);
    expect(veto[0]).toMatchObject({ line: 3, captured: 'STOPHERE' });
    // Nothing after the veto scores for detection.
    expect(rowsOf(report, 'detect').every((row) => row.line < 3)).toBe(true);
  });

  it('reads detection over the first 400 non-empty lines only, as detection itself does', () => {
    const lines = Array.from({ length: 450 }, (_, i) => `N${i + 1} G1 X${i}. F100`);
    const report = run('fanuc-gcode', lines);
    const detect = rowsOf(report, 'detect');
    expect(Math.max(...detect.map((row) => row.line))).toBeLessThanOrEqual(400);
    // The other rules go on to the end.
    expect(report.linesRead).toBe(450);
    expect(report.truncated).toBe(false);
  });

  it('reads at most the first lines of a very long program and says so', () => {
    const lines = Array.from({ length: MAX_REPORT_LINES + 5 }, () => 'G0 X1.');
    const report = run('fanuc-gcode', lines);
    expect(report.linesRead).toBe(MAX_REPORT_LINES);
    expect(report.truncated).toBe(true);
  });

  it('answers an empty program with no rows', () => {
    const report = run('fanuc-gcode', []);
    expect(report.rows).toEqual([]);
    expect(report.linesRead).toBe(0);
  });
});

// M13 review fixes: CODE-8 (a budget, and a thread handed back) and NC-11 (a veto after the detect rows).
describe('testReport: the time budget (CODE-8)', () => {
  /** Every call to the clock moves it 1 s on: each timed rule takes 1 s. */
  const SECOND_PER_CALL = (): (() => number) => {
    let t = 0;
    return () => (t += 1000);
  };

  it('stops at the line it has reached once the rules have used up the budget, and says so', () => {
    const lines = Array.from({ length: 300 }, () => 'N10 G0 X1.');
    const report = run('fanuc-gcode', lines, { now: SECOND_PER_CALL() });
    expect(report.stoppedAt).not.toBeNull();
    expect(report.totalMs).toBeGreaterThan(BUDGET_MS);
    expect(report.linesRead).toBe(report.stoppedAt);
    expect(report.linesRead).toBeLessThan(300);
    expect(report.truncated).toBe(true);
    const stopped = rowsOf(report, 'stopped');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].lines).toBe(report.stoppedAt);
  });

  it('does not stop a program the rules read quickly', () => {
    const report = run('fanuc-gcode', MILL);
    expect(report.stoppedAt).toBeNull();
    expect(rowsOf(report, 'stopped')).toEqual([]);
    expect(report.linesRead).toBe(MILL.length);
  });

  it('gives the thread back every chunk of lines, and answers what the synchronous one answers', async () => {
    const lines = Array.from({ length: CHUNK_LINES * 3 + 10 }, (_, i) => `N${i + 1} G1 X${i}. F100`);
    const cp = compiled('fanuc-gcode');
    const input = { cp, lines, codes: NO_CODES, machine: noMachine(cp.profile), now: FROZEN };
    let pauses = 0;
    const report = await testReportAsync(input, async () => {
      pauses++;
    });
    expect(pauses).toBe(3);
    expect(report).toEqual(testReport(input));
  });
});

describe('testReport: detect rows before a veto (NC-11)', () => {
  it('marks the detect rows above a veto as not counted, with the line of the veto', () => {
    const base = compiled('fanuc-gcode');
    const cp: CompiledProfile = { ...base, re: { ...base.re, detectVetoes: [/^STOPHERE/] } };
    const report = testReport({
      cp,
      lines: ['O1', 'N10 G0 X1', 'STOPHERE', 'N20 G0 X2'],
      codes: NO_CODES,
      machine: noMachine(cp.profile),
      now: FROZEN,
    });
    const detect = rowsOf(report, 'detect');
    expect(detect.length).toBeGreaterThan(0);
    expect(detect.every((row) => row.counted === false && row.vetoLine === 3)).toBe(true);
  });

  it('leaves the rows alone when there is no veto', () => {
    const detect = rowsOf(run('fanuc-gcode', MILL), 'detect');
    expect(detect.length).toBeGreaterThan(0);
    expect(detect.every((row) => row.counted === undefined)).toBe(true);
  });
});
