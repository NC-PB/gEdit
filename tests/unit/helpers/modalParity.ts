// The TS/Python modal parity check's plumbing (Phase 3 plan §6.9; P3.1, the parity judge).
//
// Both interpreters walk the program of every `tests/fixtures/modal/**` golden with the same
// effective profile (`tests/fixtures/resolved/effective/index.json` names it) and give the
// state after **every** line in the goldens' notation (`tests/fixtures/modal/README.md`):
// `G95`, `=G95`, `=G95@machine`, the tool's station, a feed as its `WordSeen`. Python's side is
// `tests/python/modal_dump.py` (one process for all goldens); the TypeScript side is
// `walkTs` below, over `core/nc/modal.ts`.
//
// P3.1: programs without a golden (the owner-public set, and G11's local programs on the
// owner's machine) run through the dump's `--context` mode: TypeScript detects the profile,
// applies the machine (or none) exactly as the app does (`effectiveFor`), and hands Python
// the effective profile, the database's entries and the lines on stdin, so Python never
// merges anything. For long programs both sides compare a digest of each line's rendered
// state (`digestOf`, the twin of the dump's `digest`) instead of the states themselves.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCodeDb } from '$lib/core/codes/load';
import { ModalInterpreter } from '$lib/core/nc/modal';
import { maskComments } from '$lib/core/nc/mask';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CodeEntry } from '$lib/core/codes/types';
import type { ModalState, ModalValue, LineState } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';
import type { Python } from './realPrograms';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = join(ROOT, 'tests', 'fixtures');
export const RESOLVED = join(FIXTURES, 'resolved');

/** The state after one line, as a golden writes it (Python `test_modal.render`). */
export type GoldenView = Record<string, unknown>;

/** What `modal_dump.py` prints for one golden. */
export interface DumpedGolden {
  /** Under `tests/fixtures/resolved`: the effective profile this golden runs with. */
  effective: string;
  /** The resolved database, `resolved/codes/<codes>.json`. */
  codes: string;
  lines: number;
  states: GoldenView[];
}

export interface Dump {
  $format: 1;
  goldens: Record<string, DumpedGolden>;
}

/** Every modal golden, as `modal/<profileId>/<case>.json`, sorted (one folder deep, as Python's `golden_files`). */
export function goldenNames(): string[] {
  const dir = join(FIXTURES, 'modal');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      readdirSync(join(dir, entry.name))
        .filter((file) => file.endsWith('.json'))
        .map((file) => `modal/${entry.name}/${file}`),
    )
    .sort();
}

/** Runs `tests/python/modal_dump.py` over `names` (all goldens when empty). */
export function pythonDump(python: Extract<Python, { ok: true }>, names: readonly string[] = []): Dump {
  const run = spawnSync(python.command, ['-S', '-m', 'tests.python.modal_dump', ...names], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`modal_dump.py failed (${run.status}): ${run.stderr}`);
  return JSON.parse(run.stdout) as Dump;
}

/** The program of a golden, split the way Python's `helpers.read_lines` splits it. */
export function goldenLines(name: string): string[] {
  const golden = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as { input: string };
  const program = join(FIXTURES, name, '..', golden.input);
  return readFileSync(program, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/** One value in the goldens' notation: `G95`, `=G95`, `=G95@machine`. */
function marked(value: string | null | undefined, record: { assumed: boolean; from?: string } | null): string | null {
  if (value === null || value === undefined || record === null) return null;
  if (!record.assumed) return value;
  const from = record.from;
  return from !== undefined && from !== '' && from !== 'profile' ? `=${value}@${from}` : `=${value}`;
}

/** The TS twin of Python's `render`: the whole state in the goldens' notation. */
export function goldenView(state: ModalState): GoldenView {
  const groups: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(state.groups) as [string, ModalValue][]) groups[name] = marked(value.code, value);
  return {
    groups,
    feedUnit: state.feedUnit,
    speedUnit: state.speedUnit,
    distance: state.distance,
    plane: state.plane,
    units: marked(state.units.value, state.units),
    diameter: state.diameter !== null ? marked(state.diameter.mode, state.diameter) : null,
    tool: state.tool !== null ? state.tool.station : null,
    activeCycle: state.activeCycle?.code ?? null,
    definedCycle: state.definedCycle?.code ?? null,
    modalCall: state.modalCall?.code ?? null,
    frame: state.frame?.code ?? null,
    tcp: state.tcp?.code ?? null,
    pitchFeedAmbiguous: state.pitchFeedAmbiguous,
    block: { ...state.block },
    feed: state.feed === null ? null : { ...state.feed },
    speed: state.speed === null ? null : { ...state.speed },
    speedLimit: state.speedLimit === null ? null : { ...state.speedLimit },
  };
}

/**
 * Whether one rendered state holds a golden's claim (`states[].after`): only the listed keys,
 * `groups` and `block` member by member, a feed/speed/clamp as its value text or as an object
 * of fields (Python `ModalTestCase.check`). The differences, empty when it holds.
 */
export function claimDiffers(view: GoldenView, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  for (const [key, want] of Object.entries(after)) {
    if (key === 'groups' || key === 'block') {
      const got = (view[key] ?? {}) as Record<string, unknown>;
      for (const [member, value] of Object.entries(want as Record<string, unknown>)) {
        const have = got[member] === undefined ? null : got[member];
        if (!same(have, value)) out.push(`${key}.${member}: ${JSON.stringify(have)} ≠ ${JSON.stringify(value)}`);
      }
    } else if (key === 'feed' || key === 'speed' || key === 'speedLimit') {
      const got = view[key] as Record<string, unknown> | null;
      if (want === null) {
        if (got !== null) out.push(`${key}: ${JSON.stringify(got)} ≠ null`);
      } else if (got === null) {
        out.push(`${key}: null ≠ ${JSON.stringify(want)}`);
      } else if (typeof want === 'string') {
        if (got.valueText !== want) out.push(`${key}: ${JSON.stringify(got.valueText)} ≠ ${JSON.stringify(want)}`);
      } else {
        for (const [member, value] of Object.entries(want as Record<string, unknown>)) {
          if (!same(got[member], value)) out.push(`${key}.${member}: ${JSON.stringify(got[member])} ≠ ${JSON.stringify(value)}`);
        }
      }
    } else if (!same(view[key], want)) {
      out.push(`${key}: ${JSON.stringify(view[key])} ≠ ${JSON.stringify(want)}`);
    }
  }
  return out;
}

/** The effective profile and database a dumped golden ran with, read from the same files. */
export function effectiveOf(dumped: Pick<DumpedGolden, 'effective' | 'codes'>): { profile: Profile; codesRaw: unknown } {
  const entry = JSON.parse(readFileSync(join(RESOLVED, dumped.effective), 'utf8')) as { profile: Profile };
  const codesRaw = JSON.parse(readFileSync(join(RESOLVED, 'codes', `${dumped.codes}.json`), 'utf8')) as unknown;
  return { profile: entry.profile, codesRaw };
}

/** The TypeScript interpreter over the same lines: the rendered state after each line. */
export function walkTs(profile: Profile, codesRaw: unknown, lines: readonly string[]): GoldenView[] {
  const cp = compileProfile(profile);
  const db = loadCodeDb(codesRaw);
  const interp = new ModalInterpreter(cp, db);
  interp.reset();
  let state: LineState | undefined;
  const out: GoldenView[] = [];
  lines.forEach((line, i) => {
    const result = tokenizeLine(line, cp, state);
    state = result.state;
    interp.update(result.tokens, i + 1, maskComments(line, cp));
    out.push(goldenView(interp.state()));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Programs without a golden: the dump's `--context` mode (P3.1)
// ---------------------------------------------------------------------------

/** One program for `--context`: its effective profile and database, and its lines. */
export interface ContextRun {
  name: string;
  profile: Profile;
  codes: CodeEntry[];
  lines: string[];
}

/** What the dump answers for one run: the states, or one digest per line. */
export interface ContextResult {
  lines: number;
  states?: GoldenView[];
  digests?: string[];
}

/** A program's text split the way Python's helpers split it (`\r\n` and `\r` read as `\n`). */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * A rendered state as canonical JSON, the twin of the dump's `canonical` (Python
 * `json.dumps(view, sort_keys=True, separators=(",", ":"), ensure_ascii=True)`): keys sorted
 * by code unit, no blanks, every character outside printable ASCII escaped as `\uXXXX`.
 */
export function canonicalJson(value: unknown): string {
  const text = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(text).join(',')}]`;
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${text(obj[key])}`).join(',')}}`;
  };
  return text(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The first 16 hex digits of the MD5 of `canonicalJson(view)`: the dump's `digest`. */
export function digestOf(view: GoldenView): string {
  return createHash('md5').update(canonicalJson(view), 'latin1').digest('hex').slice(0, 16);
}

/** One `--context -` process over `runs` (stdin); resolves with its runs. */
function contextProcess(
  python: Extract<Python, { ok: true }>,
  runs: readonly ContextRun[],
  digest: boolean,
): Promise<Record<string, ContextResult>> {
  return new Promise((resolve, reject) => {
    const child = spawn(python.command, ['-S', '-m', 'tests.python.modal_dump', '--context', '-'], {
      cwd: ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      if (status !== 0) {
        reject(new Error(`modal_dump.py --context failed (${String(status)}): ${Buffer.concat(err).toString('utf8')}`));
        return;
      }
      try {
        resolve((JSON.parse(Buffer.concat(out).toString('utf8')) as { runs: Record<string, ContextResult> }).runs);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    child.stdin.end(JSON.stringify({ $format: 1, runs: runs.map((run) => ({ ...run, digest })) }), 'utf8');
  });
}

/**
 * Runs the dump's `--context -` over `runs`, with digests or with the states, in up to
 * `workers` Python processes at once (the runs shared out by line count): Python tokenizes
 * about 25k lines a second, and the owner-public set alone is 300k lines.
 */
export async function pythonContext(
  python: Extract<Python, { ok: true }>,
  runs: readonly ContextRun[],
  o: { digest: boolean; workers?: number },
): Promise<Record<string, ContextResult>> {
  const workers = Math.max(1, Math.min(o.workers ?? 4, runs.length));
  const shares: ContextRun[][] = Array.from({ length: workers }, () => []);
  const load = new Array<number>(workers).fill(0);
  for (const run of [...runs].sort((a, b) => b.lines.length - a.lines.length)) {
    const least = load.indexOf(Math.min(...load));
    shares[least].push(run);
    load[least] += run.lines.length;
  }
  const parts = await Promise.all(shares.filter((share) => share.length > 0).map((share) => contextProcess(python, share, o.digest)));
  return Object.assign({}, ...parts) as Record<string, ContextResult>;
}

/** The TypeScript states of a context run, rendered (the database read as the app reads it). */
export function walkRun(run: ContextRun): GoldenView[] {
  return walkTs(run.profile, { dialect: String(run.profile.codes ?? 'context'), version: 1, addresses: {}, codes: run.codes }, run.lines);
}

/** Per line, where TypeScript and Python differ: 1-based lines, in order. */
export function differingLines(ts: readonly string[], python: readonly string[]): number[] {
  const out: number[] = [];
  const count = Math.max(ts.length, python.length);
  for (let i = 0; i < count; i++) if (ts[i] !== python[i]) out.push(i + 1);
  return out;
}
