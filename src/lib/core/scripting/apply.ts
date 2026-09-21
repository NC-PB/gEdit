// `decideApply` (plan §7.5): the one place that decides what a finished run is allowed to
// do to a document. Owner: **WP5.1**. Stub written by P5 — the signature and the order of
// the checks below are binding, the body is not.
//
// It is a **pure function** of the run's outcome. It reads no store, opens no dialog and
// touches no model, so the whole safety bar of plan §5 M5 is unit-testable in node:
//
//   exit ≠ 0 applies nothing · empty stdout in replace mode is an error · a changed
//   version gives stale · truncated output · envelope and report validation · v1 fallback
//
// **The order is the contract**, because a run can fail in several ways at once (a
// cancelled run also has a non-zero exit; a timed-out run is usually truncated too) and
// the reason the user is shown must be the *cause*, not whichever check ran first:
//
//   1. `cancelled`            → error `scripts.errCancelled`
//   2. `timedOut`             → error `scripts.errTimeout`
//   3. `!success`             → error `scripts.errExitCode` `{ code }`, or
//                               `scripts.errKilled` when `exitCode === null`
//   4. mode = `meta?.output ?? 'panel'` — **no header, or an unusable one, means `panel`**
//      (the v1 fallback: a half-understood script must never be read as `replace`)
//   5. `panel`                → `{ kind: 'panel' }`, whatever stdout holds
//   6. `stdoutTruncated`      → error `scripts.errTruncated` (the text is a prefix, and a
//                               prefix of a program is a program that ends mid-cut)
//   7. `report`               → parse; invalid → error `scripts.errReport`
//   8. `replace` / `new-document`:
//      a. `meta.envelope` → parse `{ text, message, findings }`; invalid → error
//         `scripts.errEnvelope`. Otherwise the text is stdout, with the trailing-LF rule.
//      b. `replace` and the text is empty → error `scripts.errEmptyOutput`
//      c. `replace` and `versionNow !== versionAtStart` → `{ kind: 'stale', text }`
//      d. → `{ kind: 'replace' | 'new-document', text, message, findings }`
//
// **Why the truncation check moved up** (G8 M5): it used to sit inside step 7, after the
// envelope parse, so a script that wrote more than the runner's cap was told its output
// "was not a valid result" when the truth was that the output had been cut off — two
// different problems with two different fixes. A `report` that was cut off misreported the
// same way. Nothing was applied either way, so this is about naming the cause. The mode is
// resolved first, and `panel` returns before it, because raw output is what a panel run
// *is*: a truncated one still shows, with the panel's own "output was cut off" flag.
//
// **Why `stale` is `replace`-only.** Stale means "the answer no longer fits the question":
// the line range the text would overwrite has moved. `new-document` overwrites nothing, so
// a changed version costs nothing there — and it is also the *recovery* from a stale
// replace ("Open result in new tab"), which would be absurd to refuse for the same reason
// it exists. A stale `report` still shows; its line numbers may be off by the user's own
// edit, which the user can see, unlike a silent rewrite.
//
// **The trailing-LF rule** (plan §5 WP5.1): a single trailing LF in *plain* stdout is
// dropped when the input did not end with one. `print()` adds a newline, and without this
// every replace run would grow the program by one empty line. It does **not** apply to an
// envelope's `text`, which the script chose deliberately (`gedit_nc.envelope`).
//
// **One addition WP5.1 made to that rule: every text is put into LF form first** (`toLf`,
// `core/text/eol.ts`). A document is held as LF in memory and gets its own ending back on
// save (AD-7), so a CR that reached the model would be a literal control character in the
// program, not a line break. It is not a theoretical case: on Windows `print()` writes
// through a text stream whose newline translation turns every `\n` into `\r\n`, and
// `PYTHONIOENCODING` does not switch that off. Without the normalisation the same script
// would be correct on macOS and corrupt every line on Windows. It runs before the
// trailing-LF rule, so "a single trailing LF" also covers a trailing CRLF.
//
// **What is *not* checked here.** Findings are the script's own line numbers in the
// *document*'s coordinates (the bundled scripts add `input.startLine` themselves), so this
// function neither shifts nor clamps them; a finding that points past the end is the
// script's bug and stays visible as one.
//
// **What *is* bounded here** (G8 M5): how many findings and rows one run may hand over.
// This is the boundary at which a script's output stops being trusted, and past it the
// Results panel renders one real `<button>` per row and per finding with no virtualisation.
// A script that returns a finding per line of a 300k-line program — easy to write by
// accident, and bounded only by the 64 MiB stdout cap — would otherwise stall the UI
// thread. The two bundled `Findings` classes cap themselves at 200 and report what they
// dropped; `MAX_FINDINGS` is the same promise made where it cannot be removed by copying a
// script to My Scripts. What was dropped is counted, never silently discarded:
// `ReportData.dropped` carries it and the panel says so.

import { toLf } from '$lib/core/text';
import type { Located, Msg, ReportData } from '$lib/app/types';
import type { ApplyDecision, ApplyErrorKey } from '$lib/core/scripting/types';
import type { RunResult, ScriptMeta } from '$lib/platform/commands';

/**
 * Every reason `decideApply` may give, as a value, so `i18n/en/scripts.ts` (WP5.2) is
 * written against a closed list and a test can assert that each one resolves.
 */
export const APPLY_ERROR_KEYS: readonly ApplyErrorKey[] = [
  'scripts.errExitCode',
  'scripts.errKilled',
  'scripts.errTimeout',
  'scripts.errCancelled',
  'scripts.errEmptyOutput',
  'scripts.errTruncated',
  'scripts.errEnvelope',
  'scripts.errReport',
];

/** The severities `Located` accepts; anything else is dropped rather than shown wrongly. */
const SEVERITIES = new Set(['info', 'warning', 'error']);

/**
 * At most this many findings are taken from one envelope or report.
 *
 * Generous next to the 200 the bundled scripts cap themselves at, and small enough that
 * the Results panel's one-button-per-finding markup stays a list and not a freeze.
 */
export const MAX_FINDINGS = 1000;

/**
 * At most this many table rows are taken from one report.
 *
 * Higher than `MAX_FINDINGS` because a row is a table line a user may well want all of
 * (a tool list of a big program), and cheaper per entry than a finding.
 */
export const MAX_ROWS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `JSON.parse`, as a value: `undefined` means "not JSON at all". */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The `findings` member of an envelope or a report.
 *
 * `null` is the refusal: the field is there and is not a list of findings, which makes the
 * whole payload invalid. A finding needs a finite `line` and a `message`; `severity` and
 * `document` are decoration and an unusable one is simply left out, because refusing a
 * hundred good findings over one misspelled severity helps nobody.
 *
 * `dropped` is how many the `MAX_FINDINGS` cap left behind. Beyond the cap nothing is
 * validated either — the point of stopping is to stop walking.
 */
function findingsOf(
  value: unknown,
): { findings: Located[]; dropped: number } | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;

  const out: Located[] = [];
  for (const item of value) {
    if (out.length >= MAX_FINDINGS) break;
    if (!isRecord(item)) return null;
    const { line, message, severity, document } = item;
    if (typeof line !== 'number' || !Number.isFinite(line)) return null;
    if (typeof message !== 'string') return null;

    const located: Located = { line: Math.trunc(line), message };
    if (typeof severity === 'string' && SEVERITIES.has(severity)) {
      located.severity = severity as Located['severity'];
    }
    if (typeof document === 'string') located.document = document;
    out.push(located);
  }
  return { findings: out, dropped: value.length - out.length };
}

/** The text of a `replace`/`new-document` run, in the form a model accepts. */
function applyText(raw: string, dropTrailingLf: boolean): string {
  const text = toLf(raw);
  return dropTrailingLf && text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * A refusal, with the process's own stderr attached when it said anything.
 *
 * stderr is kept out of `reason` on purpose: `reason` is a key the UI translates, stderr
 * is the script's untranslated output (AD-14), and the status bar shows the one as its
 * text and the other as its detail.
 */
function error(reason: ApplyErrorKey, r: RunResult, params?: Record<string, number>): ApplyDecision {
  const message: Msg = params === undefined ? { key: reason } : { key: reason, params };
  return r.stderr === ''
    ? { kind: 'error', reason: message }
    : { kind: 'error', reason: message, stderr: r.stderr };
}

/**
 * `gedit_nc.report()`'s JSON as the Results panel's shape, or null when it is not one.
 *
 * `docId` is left off: the caller knows which document ran, this function does not.
 */
export function parseReport(stdout: string): ReportData | null {
  const parsed = parseJson(stdout);
  if (!isRecord(parsed)) return null;

  const { title, columns, rows, message } = parsed;
  if (typeof title !== 'string') return null;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null;
  if (message !== undefined && message !== null && typeof message !== 'string') return null;

  const cols: { key: string; label: string }[] = [];
  for (const column of columns) {
    if (!isRecord(column)) return null;
    if (typeof column.key !== 'string' || typeof column.label !== 'string') return null;
    cols.push({ key: column.key, label: column.label });
  }

  // Capped before the rows are validated, for the same reason as `findingsOf`: what is
  // not shown is not walked either.
  const kept: unknown[] = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows;
  for (const row of kept) if (!isRecord(row)) return null;

  const found = findingsOf(parsed.findings);
  if (found === null) return null;

  const report: ReportData = { title, columns: cols, rows: kept as Record<string, unknown>[] };
  if (typeof message === 'string') report.message = message;
  if (found !== undefined) report.findings = found.findings;
  const dropped = rows.length - kept.length + (found?.dropped ?? 0);
  if (dropped > 0) report.dropped = dropped;
  return report;
}

/** The `{ text, message, findings }` of `gedit_nc.envelope()`, or null when it is not one. */
export function parseEnvelope(
  stdout: string,
): { text: string; message?: string; findings?: Located[]; dropped?: number } | null {
  const parsed = parseJson(stdout);
  if (!isRecord(parsed)) return null;

  const { text, message } = parsed;
  if (typeof text !== 'string') return null;
  if (message !== undefined && message !== null && typeof message !== 'string') return null;

  const found = findingsOf(parsed.findings);
  if (found === null) return null;

  const out: { text: string; message?: string; findings?: Located[]; dropped?: number } = {
    text: toLf(text),
  };
  if (typeof message === 'string') out.message = message;
  if (found !== undefined) out.findings = found.findings;
  if (found !== undefined && found.dropped > 0) out.dropped = found.dropped;
  return out;
}

/**
 * What to do with a finished run (plan §7.5).
 *
 * @param meta            the script's header, or null when it has none or it was unusable
 *                        (`ScriptEntry.headerError`) — both mean the v1 `panel` fallback
 * @param r               what `script_run` answered
 * @param versionAtStart  `editor.versionId(docId)` taken **before** stdin was built
 * @param versionNow      `editor.versionId(docId)` taken after the run came back
 * @param inputEndedWithLf whether the text sent on stdin ended with a newline
 */
export function decideApply(
  meta: ScriptMeta | null,
  r: RunResult,
  versionAtStart: number,
  versionNow: number,
  inputEndedWithLf: boolean,
): ApplyDecision {
  // 1-3. Why the run is not usable, cause first.
  if (r.cancelled) return error('scripts.errCancelled', r);
  if (r.timedOut) return error('scripts.errTimeout', r, { seconds: Math.round(r.durationMs / 1000) });
  if (!r.success) {
    return r.exitCode === null
      ? error('scripts.errKilled', r)
      : error('scripts.errExitCode', r, { code: r.exitCode });
  }

  // 4. The mode. No header, or one that did not parse, is the v1 panel.
  const mode = meta?.output ?? 'panel';

  // 5. The v1 behaviour: stdout is whatever it is, and the panel shows it.
  if (mode === 'panel') return { kind: 'panel' };

  // 6. Cut off at the runner's cap. Checked before anything is parsed, so a payload that
  // ends mid-JSON is reported as what it is — output that was cut off — and not as a
  // script that wrote nonsense.
  if (r.stdoutTruncated) return error('scripts.errTruncated', r);

  // 7. A table for the Results panel.
  if (mode === 'report') {
    const report = parseReport(r.stdout);
    return report === null ? error('scripts.errReport', r) : { kind: 'report', report };
  }

  // 8. Text that goes back into a document.
  let text: string;
  let message: string | undefined;
  let findings: Located[] | undefined;
  let dropped: number | undefined;
  if (meta?.envelope === true) {
    const envelope = parseEnvelope(r.stdout);
    if (envelope === null) return error('scripts.errEnvelope', r);
    ({ text, message, findings, dropped } = envelope);
  } else {
    text = applyText(r.stdout, !inputEndedWithLf);
  }

  if (mode === 'replace' && text === '') return error('scripts.errEmptyOutput', r);
  if (mode === 'replace' && versionNow !== versionAtStart) return { kind: 'stale', text };

  const answer = {
    text,
    ...(message === undefined ? {} : { message }),
    ...(findings === undefined ? {} : { findings }),
    ...(dropped === undefined ? {} : { dropped }),
  };
  return mode === 'replace' ? { kind: 'replace', ...answer } : { kind: 'new-document', ...answer };
}
