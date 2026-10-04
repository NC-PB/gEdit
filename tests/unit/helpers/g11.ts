// Gate G11, the real-program smoke (plan §9.2, §6 M9 WP9.6): the checks of
// `tests/real/README.md` run over a manifest and the folder next to it, and the report
// they print. `tests/unit/realFixtures.test.ts` runs it over the owner's local folder and,
// in CI, over a synthetic manifest in a temporary folder, so the logic is tested where no
// real program exists.
//
// Standing rule 12: the result names a program by its manifest index and a line number,
// never by its file name, and carries no line of a program. The folder is never printed.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMachinesFile } from '$lib/core/machines/file';
import {
  type Effective,
  type Python,
  addressArithmeticUnchangedAt0,
  detectsAs,
  effectiveFor,
  mapTools,
  extentsRun,
  openBytes,
  programChecksRun,
  roundTrips,
  station,
  toolListAgrees,
  unchangedAt100,
  unknownTokens,
} from './realPrograms';
import type { MachineConfig, MachineParams } from '$lib/core/machines/types';

/** The checks, in the order the report prints them (`tests/real/README.md`). */
export const CHECKS = [
  'detection',
  'unknownTokens',
  'map',
  'toolList',
  'roundTrip',
  'scaleFeed',
  'scaleSpeed',
  'programChecks',
  'extents',
  'addressArithmetic',
  'noCrash',
] as const;
export type Check = (typeof CHECKS)[number];

/** An `allowUnknown` entry: a token text (case ignored), `/…/` for a pattern, or with a reason. */
export type AllowEntry = string | { text: string; why?: string };

/** One manifest entry. Everything but `file` and `profile` is optional (`$version` 1). */
export interface RealProgram {
  file: string;
  profile: string;
  variant?: Record<string, string>;
  /** An inline partial `MachineParams`, or `{ id }` of a machine in `machines.json` next to the manifest. */
  machine?: Partial<MachineParams> | { id: string };
  tools?: string[];
  allowUnknown?: AllowEntry[];
  knownGaps?: Partial<Record<Check, string>>;
}

/** Where the programs came from, as the report names it (never the path). */
export type Source = 'GEDIT_REAL_FIXTURES' | 'main working tree';

export interface CheckCounts {
  pass: number;
  fail: number;
  known: number;
  skipped: number;
}

/** A failure: the check, the manifest index (from 0) and, where there is one, the line. */
export interface Failure {
  check: Check;
  index: number;
  line?: number;
}

/** What `GEDIT_G11_REPORT` writes, and what the printed lines say (`$format` 1). */
export interface G11Report {
  $format: 1;
  source: Source | 'none';
  programs: number;
  checks: Record<Check, CheckCounts>;
  failures: Failure[];
  noLongerGaps: { check: Check; index: number }[];
  /**
   * M10: what the program checks found, by check id: the rows, and in how many programs.
   * Not pass or fail (a finding is not a failure), but a check that fires on most of the
   * owner's correct programs is a check that cries wolf, and this is where that shows.
   */
  findings: Record<string, { rows: number; programs: number }>;
}

/** What a check found for one program: passed, failed (maybe at a line), or not run. */
type Outcome = { result: 'pass' } | { result: 'fail'; line?: number } | { result: 'skipped' };

const PASS: Outcome = { result: 'pass' };
const SKIP: Outcome = { result: 'skipped' };
const fail = (line?: number): Outcome => (line !== undefined && line > 0 ? { result: 'fail', line } : { result: 'fail' });

/**
 * The manifest's entries, **every one of them and in order**, so that a failure's index is
 * the entry's index in the file. An entry that is not an object, or has no string `file`
 * or `profile`, is kept as it is and fails `noCrash` at its index (nothing ran for it);
 * dropping it would shift every later index and give a quiet green with fewer programs.
 */
export function programsOf(raw: unknown): RealProgram[] {
  const programs = typeof raw === 'object' && raw !== null ? (raw as { programs?: unknown }).programs : undefined;
  return (Array.isArray(programs) ? programs : []).map((entry) => (typeof entry === 'object' && entry !== null ? (entry as RealProgram) : ({} as RealProgram)));
}

/** Whether an entry names a program: a string `file` and a string `profile`. */
function wellFormed(program: Partial<RealProgram>): boolean {
  return typeof program.file === 'string' && typeof program.profile === 'string';
}

/**
 * Whether `token` is on the allow-list: equal to an entry's text with case ignored, or
 * matched by an entry written `/…/` (a pattern over the token's text, read like a profile
 * pattern: case ignored, not anchored unless it says so).
 */
export function allowed(token: string, list: readonly AllowEntry[] | undefined): boolean {
  for (const entry of list ?? []) {
    const text = typeof entry === 'string' ? entry : entry?.text;
    if (typeof text !== 'string' || text === '') continue;
    if (text.length > 2 && text.startsWith('/') && text.endsWith('/')) {
      try {
        if (new RegExp(text.slice(1, -1), 'i').test(token)) return true;
      } catch {
        // A pattern that does not compile allows nothing.
      }
      continue;
    }
    if (text.toLowerCase() === token.toLowerCase()) return true;
  }
  return false;
}

/** The machine an entry names, `null` for none, or an error for a machine that is not there. */
function machineOf(program: RealProgram, folder: string): MachineConfig | null {
  const machine = program.machine;
  if (machine === undefined || machine === null) return null;
  if (typeof machine !== 'object') throw new Error('the machine member is not an object');
  if ('id' in machine && typeof machine.id === 'string') {
    const path = join(folder, 'machines.json');
    if (!existsSync(path)) throw new Error('machines.json is missing next to the manifest');
    const file = parseMachinesFile(JSON.parse(readFileSync(path, 'utf8')));
    const found = file.machines.find((m) => m.id === machine.id);
    if (!found) throw new Error('the manifest names a machine that machines.json does not have');
    return found;
  }
  return { id: 'manifest', name: 'manifest', profile: program.profile, params: machine as Partial<MachineParams> };
}

/** Every check over one program. A check that throws fails, and so does `noCrash`. */
function checkProgram(program: RealProgram, folder: string, python: Python, found: Map<string, number>): Record<Check, Outcome> {
  const out = Object.fromEntries(CHECKS.map((check) => [check, SKIP])) as Record<Check, Outcome>;
  let crashed = false;
  const guard = (check: Check, run: () => Outcome): void => {
    try {
      out[check] = run();
    } catch {
      out[check] = fail();
      crashed = true;
    }
  };

  if (!wellFormed(program)) {
    out.noCrash = fail();
    return out;
  }
  const path = join(folder, program.file);
  let bytes: Uint8Array;
  let machine: MachineConfig | null;
  try {
    bytes = new Uint8Array(readFileSync(path));
    machine = machineOf(program, folder);
  } catch {
    // A file that is not there, or a machine the manifest cannot give: nothing ran.
    out.noCrash = fail();
    return out;
  }

  const opened = openBytes(bytes);
  guard('roundTrip', () => (opened.ok && roundTrips(opened) ? PASS : fail()));
  if (!opened.ok) {
    out.noCrash = PASS;
    return out;
  }
  const { text } = opened;

  guard('detection', () => {
    if (!detectsAs(path, text, program.profile)) return fail();
    if (machine === null) {
      const detected = effectiveFor(program.profile, text, null);
      for (const [id, value] of Object.entries(program.variant ?? {})) {
        if (detected.machine.params.variants[id] !== value) return fail();
      }
    }
    return PASS;
  });
  // Every check below reads the program under the machine its entry names; without the
  // effective profile none of them can run.
  let effective: Effective;
  try {
    effective = effectiveFor(program.profile, text, machine);
  } catch {
    out.unknownTokens = fail();
    out.noCrash = fail();
    return out;
  }
  guard('unknownTokens', () => {
    const first = unknownTokens(effective.cp, text).find((token) => !allowed(token.text, program.allowUnknown));
    return first === undefined ? PASS : fail(first.line);
  });
  let tools: [number, string][] = [];
  guard('map', () => {
    tools = mapTools(effective.cp, text);
    if (!Array.isArray(program.tools)) return SKIP;
    const want = program.tools.map((tool) => station(String(tool)));
    const n = Math.max(want.length, tools.length);
    for (let i = 0; i < n; i++) {
      const have = tools[i] === undefined ? undefined : station(tools[i][1]);
      if (want[i] !== have) return fail((tools[i] ?? tools[tools.length - 1])?.[0]);
    }
    return PASS;
  });
  if (python.ok) {
    guard('toolList', () => {
      const line = toolListAgrees(python, text, effective, tools);
      return line === 0 ? PASS : fail(line);
    });
    guard('scaleFeed', () => (unchangedAt100(python, 'scale_feed.py', text, effective) ? PASS : fail()));
    guard('scaleSpeed', () => (unchangedAt100(python, 'scale_speed.py', text, effective) ? PASS : fail()));
    // M10: the three scripts that read the program, started the way the app starts them.
    // A finding is no failure; the run must end with a well-formed report.
    guard('programChecks', () => {
      const rows = programChecksRun(python, text, effective);
      if (rows === null) return fail();
      for (const [id, count] of rows) found.set(id, (found.get(id) ?? 0) + count);
      return PASS;
    });
    guard('extents', () => (extentsRun(python, text, effective) ? PASS : fail()));
    // Adding nothing to Z changes nothing: every word is left as written (the byte-for-byte
    // guard of M9 for a script that rewrites values).
    guard('addressArithmetic', () => (addressArithmeticUnchangedAt0(python, text, effective) ? PASS : fail()));
  }
  out.noCrash = crashed ? fail() : PASS;
  return out;
}

/** Runs every check over every program and counts, the known gaps applied. */
export function runG11(folder: string, programs: readonly RealProgram[], source: Source, python: Python): G11Report {
  const checks = Object.fromEntries(CHECKS.map((check) => [check, { pass: 0, fail: 0, known: 0, skipped: 0 }])) as Record<
    Check,
    CheckCounts
  >;
  const failures: Failure[] = [];
  const noLongerGaps: { check: Check; index: number }[] = [];
  const findings: G11Report['findings'] = {};

  programs.forEach((program, index) => {
    const found = new Map<string, number>();
    const outcomes = checkProgram(program, folder, python, found);
    for (const [id, rows] of found) {
      const entry = (findings[id] ??= { rows: 0, programs: 0 });
      entry.rows += rows;
      entry.programs++;
    }
    for (const check of CHECKS) {
      const outcome = outcomes[check];
      const gap = check !== 'noCrash' && typeof program.knownGaps?.[check] === 'string';
      if (outcome.result === 'skipped') checks[check].skipped++;
      else if (outcome.result === 'pass') {
        checks[check].pass++;
        if (gap) noLongerGaps.push({ check, index });
      } else if (gap) checks[check].known++;
      else {
        checks[check].fail++;
        failures.push(outcome.line === undefined ? { check, index } : { check, index, line: outcome.line });
      }
    }
  });

  return { $format: 1, source, programs: programs.length, checks, failures, noLongerGaps, findings };
}

/** The printed form of a report: one line per check, then the failures (README format). */
export function formatReport(report: G11Report): string[] {
  const n = (value: number): string => String(value).padStart(3);
  const lines = [`G11 source: ${report.source}; ${report.programs} programs`];
  for (const check of CHECKS) {
    const c = report.checks[check];
    let line = `G11 ${check.padEnd(14)}${n(c.pass)} pass ${n(c.fail)} fail`;
    if (check !== 'noCrash') line += ` ${n(c.known)} known`;
    if (c.skipped > 0) line += ` ${n(c.skipped)} skipped`;
    lines.push(line);
  }
  const failed = CHECKS.map((check) => {
    const where = report.failures.filter((f) => f.check === check).map((f) => `#${f.index}${f.line === undefined ? '' : `:${f.line}`}`);
    return where.length > 0 ? `${check} ${where.join(' ')}` : '';
  }).filter((part) => part !== '');
  lines.push(`G11 failures: ${failed.length > 0 ? failed.join('; ') : '(none)'}`);
  const gone = report.noLongerGaps.map((g) => `${g.check} #${g.index}`);
  lines.push(`G11 no longer a gap: ${gone.length > 0 ? gone.join('; ') : '(none)'}`);
  const found = Object.entries(report.findings ?? {}).sort((a, b) => b[1].rows - a[1].rows || a[0].localeCompare(b[0]));
  lines.push(`G11 programChecks findings: ${found.length > 0 ? found.map(([id, f]) => `${id} ${f.rows} in ${f.programs}`).join('; ') : '(none)'}`);
  return lines;
}
