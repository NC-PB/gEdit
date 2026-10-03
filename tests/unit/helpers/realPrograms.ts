// What G11 and exit criterion X13 do to a real program (plan §9.2, §6 M9 WP9.6), in one
// place for the two tests that run it: `tests/unit/realFixtures.test.ts` over the owner's
// local folder, and `tests/unit/ownerPublic.test.ts` over the committed owner-public
// programs.
//
// Every step is the app's own: the file is decoded by `decodeFile`, the profile detected
// by `detectProfile`, the machine merged by `effectiveMachine`/`applyMachine`, the tokens
// read by `tokenizeLine`, the map built by `OutlineIndex`, and a bundled script started
// the way the Rust runner starts it (stdin, `GEDIT_CONTEXT`, `PYTHONPATH`). Nothing here
// is a second implementation of a rule.
//
// Standing rule 12: nothing this module returns carries a file name or a line of a
// program. A failure is a manifest index and a line number; the report is counts.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile, detectVariants } from '$lib/core/profiles/detect';
import { OutlineIndex } from '$lib/core/profiles/outline';
import { validateProfile } from '$lib/core/profiles/validate';
import { buildContext } from '$lib/core/scripting/context';
import { decodeFile, encodeFile } from '$lib/core/text';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON, FALLBACK_PROFILE_ID } from '$lib/data/profiles';
import type { DocMeta } from '$lib/app/types';
import type { CodeEntry } from '$lib/core/codes/types';
import type { EffectiveMachine, MachineConfig } from '$lib/core/machines/types';
import type { LineState } from '$lib/core/nc/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';

/** The bundled scripts, which are also the `bundled:` root at runtime. */
export const SCRIPTS_DIR = fileURLToPath(new URL('../../../src-tauri/resources/scripts/', import.meta.url));

/** The built-ins, through the same gate the registry uses, in registry order. */
export const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

export function builtin(id: string): CompiledProfile | null {
  return BUILTINS.find((cp) => cp.profile.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Opening a program
// ---------------------------------------------------------------------------

/** A program as the app opens it, or why it does not open. */
export type Opened =
  | { ok: true; text: string; bytes: Uint8Array; decoded: Extract<ReturnType<typeof decodeFile>, { ok: true }> }
  | { ok: false; reason: string };

export function openBytes(bytes: Uint8Array): Opened {
  const decoded = decodeFile(bytes);
  if (!decoded.ok) return { ok: false, reason: decoded.message.key };
  return { ok: true, text: decoded.text, bytes, decoded };
}

/**
 * Whether saving the unchanged document writes the bytes it was read from: line endings,
 * encoding, byte-order mark and NUL leader included. A file with mixed line endings does
 * not (the editor writes one ending), and that is a real finding.
 */
export function roundTrips(opened: Extract<Opened, { ok: true }>): boolean {
  const { decoded } = opened;
  if (decoded.eolMixed) return false;
  const encoded = encodeFile(decoded.text, { encoding: decoded.encoding, eol: decoded.eol ?? 'lf', nul: decoded.nul });
  if (!encoded.ok) return false;
  const a = encoded.bytes;
  const b = opened.bytes;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The profile and the machine
// ---------------------------------------------------------------------------

/** What a document of this profile is read with: the app's effective view (AD-31). */
export interface Effective {
  profile: Profile;
  cp: CompiledProfile;
  codes: CodeEntry[];
  machine: EffectiveMachine;
}

/**
 * The effective profile of a program read as `profileId` under `machine`. With no machine
 * the variants are the ones detected in the text, exactly as a document without a machine
 * gets them; with a machine, the machine's choices win.
 */
export function effectiveFor(profileId: string, text: string, machine: MachineConfig | null): Effective {
  const base = builtin(profileId);
  if (!base) throw new Error(`no built-in profile "${profileId}"`);
  const detected = detectVariants(base, text);
  const eff = effectiveMachine(base.profile, machine, machine === null ? 'none' : 'document', detected);
  const applied = applyMachine(base.profile, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(`the effective profile does not validate: ${checked.errors.join('; ')}`);
  const db = CODE_DBS[applied.codes] as { codes?: CodeEntry[] } | undefined;
  return {
    profile: checked.profile,
    cp: compileProfile(checked.profile),
    codes: Array.isArray(db?.codes) ? db.codes : [],
    machine: eff,
  };
}

/** The profile detection picks for this file, with `fallback` as the open document's. */
export function detect(path: string, text: string, fallback: string = FALLBACK_PROFILE_ID): string {
  return detectProfile(BUILTINS, path, text, fallback);
}

/**
 * Whether detection answers `expected` whichever document was open before: once with the
 * default profile as the fallback and once with each built-in. A program that only gets
 * its dialect when the right one happened to be open is not detected, it is lucky.
 */
export function detectsAs(path: string, text: string, expected: string): boolean {
  if (detect(path, text) !== expected) return false;
  return BUILTINS.every((cp) => detect(path, text, cp.profile.id) === expected);
}

// ---------------------------------------------------------------------------
// Tokens and the map
// ---------------------------------------------------------------------------

/** One `unknown` token: its text and its 1-based line. Comments are tokens of their own. */
export interface UnknownToken {
  text: string;
  line: number;
}

export function unknownTokens(cp: CompiledProfile, text: string): UnknownToken[] {
  const out: UnknownToken[] = [];
  let state: LineState | undefined;
  text.split('\n').forEach((line, i) => {
    const result = tokenizeLine(line, cp, state);
    state = result.state;
    for (const token of result.tokens) if (token.kind === 'unknown') out.push({ text: token.text, line: i + 1 });
  });
  return out;
}

/** The unknown tokens grouped by text, in order of first appearance: `{ text, count, firstLine }`. */
export function groupUnknown(tokens: readonly UnknownToken[]): { text: string; count: number; firstLine: number }[] {
  const out = new Map<string, { text: string; count: number; firstLine: number }>();
  for (const token of tokens) {
    const entry = out.get(token.text);
    if (entry) entry.count++;
    else out.set(token.text, { text: token.text, count: 1, firstLine: token.line });
  }
  return [...out.values()];
}

/** The tool changes of the program map, as `[line, station]`, in order. */
export function mapTools(cp: CompiledProfile, text: string): [number, string][] {
  const outline = new OutlineIndex(cp);
  outline.reset(text.split('\n'));
  return outline
    .items()
    .flatMap((item) => [item, ...(item.children ?? [])])
    .filter((item) => item.kind === 'tool')
    .map((item) => [item.line, item.tool ?? '']);
}

/**
 * A station the way two readers write it the same: no `T`, no quotes or `=`, no leading
 * zeros, upper case. `T01`, `"01"`, `1` and `T1` are one station; `T="DRILL"` is `DRILL`.
 */
export function station(written: string): string {
  const bare = written.trim().replace(/^T(?=[\d"=])/i, '').replace(/^=/, '').replace(/^"(.*)"$/, '$1');
  return (/^\d+$/.test(bare) ? bare.replace(/^0+(?=\d)/, '') : bare).toUpperCase();
}

/**
 * The rows `tool_list` must give for this map: one per station in order of first use, with
 * the line of its first call and how many tool segments of the map it has.
 */
export function rowsOfMap(tools: readonly [number, string][]): { station: string; line: number; calls: number }[] {
  const out = new Map<string, { station: string; line: number; calls: number }>();
  for (const [line, tool] of tools) {
    const key = station(tool);
    const row = out.get(key);
    if (row) row.calls++;
    else out.set(key, { station: key, line, calls: 1 });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// The bundled scripts
// ---------------------------------------------------------------------------

/** How the scripts are started: an interpreter, or why there is none. */
export type Python = { ok: true; command: string } | { ok: false; reason: string };

/**
 * The interpreter the script checks run with: `GEDIT_PYTHON` when it is set (the app's own
 * override), else `python3` (`python` on Windows). It has to be Python 3.9 or newer, like
 * the app requires. Without one the script checks are reported as skipped, never as passed.
 */
export function findPython(env: NodeJS.ProcessEnv = process.env): Python {
  const named = env.GEDIT_PYTHON?.trim();
  const command = named !== undefined && named !== '' ? named : process.platform === 'win32' ? 'python' : 'python3';
  const probe = spawnSync(command, ['-c', 'import sys; print(sys.version_info >= (3, 9))'], { encoding: 'utf8', timeout: 20_000 });
  if (probe.error || probe.status !== 0) return { ok: false, reason: 'no Python interpreter found' };
  if (probe.stdout.trim() !== 'True') return { ok: false, reason: 'Python is older than 3.9' };
  return { ok: true, command };
}

/** What one script run gave back. */
export type ScriptRun = { ok: true; json: Record<string, unknown> } | { ok: false; reason: string };

/** How long one script may take on one program before the run counts as hung. */
export const SCRIPT_TIMEOUT_MS = 120_000;

/**
 * Runs a bundled script over the whole of `text` the way the app does: the text on stdin,
 * the context in a temporary `GEDIT_CONTEXT` file, the scripts folder as the working
 * directory and on `PYTHONPATH`, UTF-8 on both pipes.
 */
export function runScript(
  python: Extract<Python, { ok: true }>,
  script: string,
  text: string,
  eff: Effective,
  params: Record<string, unknown>,
): ScriptRun {
  const doc = {
    path: null,
    title: 'Untitled-1',
    profileId: eff.profile.id,
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    dirty: false,
  } as unknown as DocMeta;
  const context = buildContext({
    doc,
    profile: eff.profile,
    codes: eff.codes,
    machine: eff.machine,
    input: { scope: 'document', startLine: 1, endLine: text.split('\n').length },
    cursor: { line: 1, column: 1 },
    params,
  });
  const dir = mkdtempSync(join(tmpdir(), 'gedit-g11-'));
  try {
    const file = join(dir, 'context.json');
    writeFileSync(file, JSON.stringify(context), 'utf8');
    const env: NodeJS.ProcessEnv = { ...process.env };
    env.PYTHONPATH = [SCRIPTS_DIR, env.PYTHONPATH].filter((part) => part !== undefined && part !== '').join(process.platform === 'win32' ? ';' : ':');
    env.PYTHONUTF8 = '1';
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONDONTWRITEBYTECODE = '1';
    env.GEDIT_CONTEXT = file;
    const run = spawnSync(python.command, [join(SCRIPTS_DIR, script)], {
      input: Buffer.from(text, 'utf8'),
      cwd: SCRIPTS_DIR,
      env,
      timeout: SCRIPT_TIMEOUT_MS,
      maxBuffer: 512 * 1024 * 1024,
    });
    if (run.error) return { ok: false, reason: run.error.message.includes('ETIMEDOUT') ? 'timed out' : 'did not start' };
    if (run.status !== 0) return { ok: false, reason: `exit ${String(run.status)}` };
    try {
      return { ok: true, json: JSON.parse(run.stdout.toString('utf8')) as Record<string, unknown> };
    } catch {
      return { ok: false, reason: 'stdout is not JSON' };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether a scaling script at 100 % handed back exactly the text it was given. */
export function unchangedAt100(python: Extract<Python, { ok: true }>, script: string, text: string, eff: Effective): boolean {
  const run = runScript(python, script, text, eff, { percent: 100 });
  return run.ok && run.json.text === text;
}

/**
 * The first line where `tool_list` disagrees with the map, `0` when they agree on every
 * row (station, first call, number of calls), `-1` when the script failed.
 */
export function toolListAgrees(python: Extract<Python, { ok: true }>, text: string, eff: Effective, tools: readonly [number, string][]): number {
  const run = runScript(python, 'tool_list.py', text, eff, {});
  if (!run.ok) return -1;
  const rows = Array.isArray(run.json.rows) ? (run.json.rows as { tool?: unknown; line?: unknown; calls?: unknown }[]) : [];
  const expected = rowsOfMap(tools);
  const n = Math.max(rows.length, expected.length);
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    const want = expected[i];
    if (!row || !want) return Number(row?.line ?? want?.line ?? 1) || 1;
    if (station(String(row.tool ?? '')) !== want.station || row.line !== want.line || row.calls !== want.calls) {
      return want.line;
    }
  }
  return 0;
}
