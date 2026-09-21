// What the script UI shows (plan §5 WP5.1). Owner: **WP5.1** — written by P5, and real
// code rather than a stub, the same call P4 made for `stores/results.ts`.
//
// Plain `svelte/store` modules, no Tauri and no i18n (AD-2), for two reasons:
//
//  - `bootstrap.ts` reads the running flag for the command context. It must not pull the
//    Tauri API into its import graph to learn whether a script is running. (The v1 UI kept
//    a `panels/scriptsV1State.ts` for the same reason; I5 deleted it with the rest of v1.)
//  - The panel, the status item and the ribbon (WP5.2) read these stores; the service
//    (`app/scripts.ts`, WP5.1) is their **only writer**. That keeps "who changed this"
//    answerable and lets a unit test drive the UI without a backend.
//
// Nothing here is persisted. The one piece of script state that outlives the session is
// `ui.lastScript` in `state.json`, which `uiState` owns (§7.3); `lastScriptId` below is
// the in-memory mirror the service keeps in step.

import { get, writable, type Writable } from 'svelte/store';
import type {
  FolderInfo,
  PythonStatus,
  RunResult,
  ScriptEntry,
} from '$lib/platform/commands';

/** The run in flight, as `ScriptService.running` reports it (plan §7.3). */
export interface ScriptRun {
  /** The webview's id for this run; `scriptCancel(runId)` uses it. */
  runId: string;
  scriptId: string;
  /** `Date.now()` when the run started, for the "running for Ns" hint. */
  startedAt: number;
}

/**
 * The last finished run, for the Output panel (plan §5 WP5.2 "Output panel v2").
 *
 * It is kept whatever the output mode was, including `replace`: a run that rewrote the
 * program still has stderr worth reading. `json` is stdout parsed as JSON when it parses,
 * and null when it does not — the panel shows the "Structured result" section only when
 * there is one.
 */
export interface ScriptOutput {
  scriptId: string;
  /** The header `name`, or the file name. Data, untranslated (AD-14). */
  scriptName: string;
  /** stdout for the panel, cut to `MAX_OUTPUT_PREVIEW`. See `stdoutLength`. */
  stdout: string;
  /** stderr for the panel, cut to `MAX_OUTPUT_PREVIEW`. See `stderrLength`. */
  stderr: string;
  /**
   * How long the run's stdout really was, so the panel can say what it is not showing.
   *
   * A `replace` run's stdout is a *program* — the M5 perf scenarios use 300k lines and
   * ~10 MiB, and the runner's own cap is 64 MiB. The panel renders it into a `<pre>` with
   * `white-space: pre-wrap`, which is a full text-wrap layout pass over the whole string
   * on the UI thread. Cutting it here rather than in the component means the 64 MiB string
   * is not held in a store for the rest of the session either (G8 M5).
   */
  stdoutLength: number;
  /** The same for stderr, which Rust caps at 1 MiB. */
  stderrLength: number;
  json: unknown;
  /** null when the process was killed by a signal. */
  exitCode: number | null;
  success: boolean;
  timedOut: boolean;
  cancelled: boolean;
  stdoutTruncated: boolean;
  durationMs: number;
  interpreter: string;
}

/** Everything `scripts_list` found, shadowing and `scripts.showBundled` already applied. */
export const scriptList: Writable<ScriptEntry[]> = writable([]);

/** The roots behind that list, for the empty-state hint and the settings UI. */
export const scriptFolders: Writable<FolderInfo[]> = writable([]);

/** Why the last `scripts_list` failed, as English detail (AD-14); null when it worked. */
export const scriptListError: Writable<string | null> = writable(null);

/**
 * The Python probe. **null means "not asked yet"**, not "missing": `bootstrap.ts` fires
 * `pythonCheck()` detached after the first render, so there is a window at startup where
 * the answer is unknown. The UI treats null like "not available yet" — the script commands
 * stay disabled, but without the "Python not found" message.
 */
export const pythonStatus: Writable<PythonStatus | null> = writable(null);

/** The run in flight, or null. Exactly one run at a time in P1. */
export const runningScript: Writable<ScriptRun | null> = writable(null);

/** The last finished run, or null before the first one. */
export const scriptOutput: Writable<ScriptOutput | null> = writable(null);

/** The id `script.runLast` (Mod+F9) would run; mirrors `ui.lastScript`. */
export const lastScriptId: Writable<string | null> = writable(null);

/** For `commandContext()` in `bootstrap.ts`, which needs the value and not a subscription. */
export function isScriptRunning(): boolean {
  return get(runningScript) !== null;
}

/** Builds the panel's view of a finished run. `json` is stdout parsed, or null. */
/**
 * At most this much stdout is even tried as JSON.
 *
 * A `replace` run's stdout is a *program*, not a result, and may be tens of megabytes.
 * Parsing it to discover that would cost more than the panel is worth — and it would cost
 * it on the UI thread, inside a `$derived`, on every render of the panel.
 */
export const MAX_JSON_PREVIEW = 1024 * 1024;

/**
 * At most this much stdout or stderr is kept for the panel to draw.
 *
 * The same 1 MiB as `MAX_JSON_PREVIEW`, and for the same reason: past it the string is a
 * program rather than a result, and nobody reads a megabyte in a `<pre>`. Anything longer
 * is cut and counted (`ScriptOutput.stdoutLength`), so the panel says what it left out.
 * The run's real output is not lost — a `replace` run put it in the document, and a
 * failure's stderr is capped at 1 MiB by Rust and so is never cut here at all.
 */
export const MAX_OUTPUT_PREVIEW = 1024 * 1024;

/**
 * stdout as the Output panel's "Structured result", or null.
 *
 * **This is the one rule.** The service calls it when it fills `ScriptOutput.json`, and
 * `ScriptOutputPanel` calls it as the fallback for an output that was set with none (the
 * M0 `output-json` seam: a header-less script that prints a JSON blob). Two copies of it
 * disagreed at I5 — the panel's had no size cap, so it re-parsed the whole program the
 * service had deliberately skipped.
 */
export function jsonFromStdout(stdout: string): unknown {
  if (stdout.length > MAX_JSON_PREVIEW) return null;
  const head = stdout.trimStart()[0];
  if (head !== '{' && head !== '[') return null;
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

/** `text` cut to the preview cap; the cap is applied once, here. */
function preview(text: string): string {
  return text.length > MAX_OUTPUT_PREVIEW ? text.slice(0, MAX_OUTPUT_PREVIEW) : text;
}

export function outputFromRun(
  scriptId: string,
  scriptName: string,
  r: RunResult,
  json: unknown = null,
): ScriptOutput {
  return {
    scriptId,
    scriptName,
    stdout: preview(r.stdout),
    stderr: preview(r.stderr),
    stdoutLength: r.stdout.length,
    stderrLength: r.stderr.length,
    json,
    exitCode: r.exitCode,
    success: r.success,
    timedOut: r.timedOut,
    cancelled: r.cancelled,
    stdoutTruncated: r.stdoutTruncated,
    durationMs: r.durationMs,
    interpreter: r.interpreter,
  };
}

/** Clears the previous run's output; called just before a new run starts. */
export function resetScriptOutput(): void {
  scriptOutput.set(null);
}

/** Test seam: back to the state of a fresh app. */
export function resetScriptsForTest(): void {
  scriptList.set([]);
  scriptFolders.set([]);
  scriptListError.set(null);
  pythonStatus.set(null);
  runningScript.set(null);
  lastScriptId.set(null);
  resetScriptOutput();
}
