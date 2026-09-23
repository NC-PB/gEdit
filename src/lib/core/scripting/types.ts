// The scripting contract (plan §7.5, AD-13). Written by the M5 prelude (P5) and binding
// for every M5 work package: an implementation may change, a signature here may not (a
// deviation needs a hand-off note and integration approval).
//
// This file holds *types only*, so it is erased at build time. The two functions of §7.5
// live next door, where WP5.1 owns them: `buildContext` in `./context.ts` and
// `decideApply` in `./apply.ts` (the same split `core/forms/types.ts` made in P2).
//
// **Where the pieces sit.** Rust owns discovery, the header and the process
// (`src-tauri/src/scripts/*`, WP4.5): it answers `scripts_list` with a `ScriptMeta` per
// script and `script_run` with a `RunResult`. TS owns three things, and all three are
// here:
//
//  1. what the script is *told* — `ScriptContextV2`, written to the `GEDIT_CONTEXT` file;
//  2. what stdout is allowed to *mean* — the output modes and their wire shapes;
//  3. what the app is allowed to *do* with it — `ApplyDecision`.
//
// **The safety bar (plan §5 M5, scripting.md "Applying results safely").** Every rule
// below exists because breaking it silently damages a program the operator will run:
//
//  - Nothing runs without the user asking. There is no run-on-open and no run-on-save.
//  - A result is applied as **one undo step** (`applyLines`), or not at all.
//  - A result is **never** applied to a document that changed while the script ran. The
//    version id is taken before stdin is built and compared after the run; a mismatch is
//    `stale`, which offers the text in a new tab instead.
//  - A failure is **visible**. A non-zero exit, a signal, a timeout, a cancel, a truncated
//    stdout and a malformed envelope or report all end as `{ kind: 'error' }` with a
//    reason, and stderr is kept for the output panel. Nothing is applied on any of them.
//  - `replace` with empty stdout is an error, not an empty document: a script that
//    crashed after printing nothing must not delete the selection.
//
// A script is an ordinary program with the user's rights and gEdit cannot sandbox it
// (AD-13). The rules above bound what the *editor* does with the answer, never what the
// script may do while it runs.

import type { DocMeta, EncodingName, Eol, Located, Msg, ReportData } from '$lib/app/types';
import type { CodeEntry } from '$lib/core/codes/types';
import type { EffectiveMachine, MachineParams } from '$lib/core/machines/types';
import type { Profile } from '$lib/core/profiles/types';

// ---------------------------------------------------------------------------
// The context (`GEDIT_CONTEXT`)
// ---------------------------------------------------------------------------

/**
 * Where stdin came from, as the script sees it.
 *
 * The header's `selection-or-document` is resolved **before** the context is built: it
 * becomes `selection` when there is a non-empty selection and `document` otherwise, so a
 * script never has to guess. `none` means stdin is empty.
 */
export type ScriptInputScope = 'selection' | 'document' | 'none';

/**
 * The range stdin covers, 1-based and inclusive, in the document's own line numbers.
 *
 * A selection is always extended to whole lines before it gets here (plan §5 WP5.1), so
 * `startLine`/`endLine` address complete lines and `applyLines` can put the answer back
 * without splitting one. For `scope: 'document'` it is `1..lineCount`; for `'none'` it is
 * `0..0`.
 */
export interface ScriptContextInput {
  scope: ScriptInputScope;
  startLine: number;
  endLine: number;
  /**
   * The document lines **above** `startLine`, LF-split, so a script can prime its modal
   * state (feed mode, active cycle, thread pitch, CSS) before the first line it may edit.
   *
   * Carry-over from M4 (G8 M4 finding 6): a selection run cannot see a `G95` or a `G84`
   * set above the selection, and `scale_feed` / `scale_speed` therefore emit a warning
   * finding instead of a wrong number. Filling this field is the durable fix, and it takes
   * both sides — the TS runner and `gedit_nc` — plus integration approval.
   *
   * It is optional on purpose: **absent means exactly today's M4 behaviour**, so nothing
   * breaks if M5 ships without it. Present only when `scope === 'selection'` and
   * `startLine > 1`; when the preceding text is too large to send, leave it out rather
   * than truncating it — a half-primed tracker is a wrong answer, an absent field keeps
   * the existing loud warning.
   */
  precedingLines?: string[];
}

/** The active document, as the script sees it. */
export interface ScriptContextDocument {
  /** Absolute path, or null for an untitled document. */
  path: string | null;
  /** `DocMeta.title`: the base name, or `Untitled-<n>`. */
  name: string;
  /** The dialect profile id, e.g. `fanuc-gcode`. */
  profile: string;
  /** What the file is decoded from and encoded back to; stdin/stdout are always UTF-8. */
  encoding: EncodingName;
  hasBom: boolean;
  /** The document's own line ending. stdin is LF whatever this says. */
  lineEnding: Eol;
  /** `DocMeta.dirty`: unsaved changes, of any kind. */
  modified: boolean;
}

/**
 * The JSON the runner writes to the `GEDIT_CONTEXT` file, which Python reads back with
 * `gedit_nc.load_context()` (plan §7.10). stdin stays plain text, so a v1 script that
 * ignores the context keeps working.
 *
 * `contract: 2` is the version marker: a script that finds `{}` was started the v1 way and
 * has to fall back to defaults rather than fail.
 *
 * Not in P1: `documents` (scripting.md's `all-open` / `pick`). `ScriptMeta.documents` only
 * supports `'active'` in Phase 1, so the context carries exactly one document.
 */
export interface ScriptContextV2 {
  contract: 2;
  document: ScriptContextDocument;
  input: ScriptContextInput;
  /** The caret when the command was invoked, 1-based. */
  cursor: { line: number; column: number };
  /** The values of the parameter form, already validated; `{}` for a script with none. */
  params: Record<string, unknown>;
  /**
   * The profile the document is read with. M6: the **effective** profile — resolved
   * (`extends`, AD-16) and with the document's machine applied (AD-31) — so a script that
   * reads `syntax.decimalPointSignificant` already follows the machine without knowing
   * that machines exist.
   */
  profile: Profile;
  /** The document's effective code database, flattened: the entries, without templates. */
  codes: CodeEntry[];
  /**
   * M6, AD-31. The document's effective machine. `contract` stays 2: the member is
   * additive, and `gedit_nc.machine_params(ctx)` answers the profile's defaults (every
   * source `profile`) for a context that does not carry it, so an M5 script is unaffected.
   */
  machine: {
    id: string | null;
    name: string | null;
    choice: 'document' | 'default' | 'none';
    params: MachineParams;
    source: EffectiveMachine['source'];
  };
}

/** What `buildContext` needs. Everything it cannot derive, the caller passes in. */
export interface BuildContextInput {
  doc: DocMeta;
  profile: Profile;
  codes: CodeEntry[];
  input: ScriptContextInput;
  cursor: { line: number; column: number };
  params: Record<string, unknown>;
  /** M6: the document's effective machine; `buildContext` copies the §7.15 script member out of it. */
  machine: EffectiveMachine;
}

// ---------------------------------------------------------------------------
// What stdout may mean
// ---------------------------------------------------------------------------

/**
 * stdout when the header sets `envelope = true`, whatever the output mode
 * (`gedit_nc.envelope()`). It lets a script hand back text **and** a summary and warnings.
 *
 * `text` is used exactly as given — the "drop one trailing LF" rule of plain stdout does
 * **not** apply to it, because the script chose the string deliberately.
 */
export interface ScriptEnvelope {
  text: string;
  /** Already-translated display text; a script's message is data (AD-14). */
  message?: string;
  findings?: Located[];
}

/**
 * stdout for `output = "report"` (`gedit_nc.report()`). It becomes a `ReportData` in the
 * Results panel; `docId` is filled in by the caller, which knows which document ran.
 */
export interface ScriptReportPayload {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  message?: string;
  findings?: Located[];
}

// ---------------------------------------------------------------------------
// What the app does with it
// ---------------------------------------------------------------------------

/**
 * The one decision `ScriptService` acts on. `decideApply` is a **pure function**: it never
 * touches a model, a store or a dialog, so every rule of the safety bar is unit-testable
 * without Monaco (plan §5 WP5.1 "Tests").
 *
 * - `error` — nothing is applied. `reason` is an i18n key (the `scripts.*` namespace, see
 *   `decideApply`), `stderr` is the process's own output for the panel. A user-initiated
 *   cancel arrives here too: nothing was applied, and the caller may show it without the
 *   error styling.
 * - `replace` — `text` replaces `input.startLine..endLine` through `applyLines`, one undo
 *   step, minimal edits, so bookmarks and folds outside the change survive.
 * - `new-document` — `text` opens in an untitled tab with the same profile
 *   (`files.newUntitled`). Nothing in the source document is touched.
 *
 * `dropped` on the two text decisions is how many findings `decideApply` refused to carry
 * past its `MAX_FINDINGS` cap (G8 M5). The caller puts it on the `ReportData` it builds,
 * so the panel can say how many are not shown instead of losing them quietly.
 * - `report` — `report` goes to the Results panel (`results.show`).
 * - `panel` — the v1 behaviour: raw stdout, stderr and parsed JSON in the Output panel.
 *   It is also the fallback for a script with no header or an unusable one.
 * - `stale` — the document changed while the script ran. Nothing is applied; the caller
 *   offers "Open result in new tab" with `text`.
 */
export type ApplyDecision =
  | { kind: 'error'; reason: Msg; stderr?: string }
  | { kind: 'replace'; text: string; message?: string; findings?: Located[]; dropped?: number }
  | { kind: 'new-document'; text: string; message?: string; findings?: Located[]; dropped?: number }
  | { kind: 'report'; report: ReportData }
  | { kind: 'panel' }
  | { kind: 'stale'; text: string };

/**
 * Every `Msg.key` `decideApply` may return. The list itself is in `./apply.ts`
 * (`APPLY_ERROR_KEYS`), because it is a value and this file stays erasable; the type is
 * here so a caller can narrow a reason without importing the runtime module.
 */
export type ApplyErrorKey =
  /** Exit code other than 0. Params: `{ code }`. */
  | 'scripts.errExitCode'
  /** The process died on a signal (`exitCode === null`) without being cancelled. */
  | 'scripts.errKilled'
  /** The deadline ran out; the process group was killed. */
  | 'scripts.errTimeout'
  /** The user pressed Cancel. */
  | 'scripts.errCancelled'
  /** `replace` (or `new-document`) produced no text at all. */
  | 'scripts.errEmptyOutput'
  /** stdout hit the runner's cap, so the text is a prefix of the answer. */
  | 'scripts.errTruncated'
  /** `envelope = true`, but stdout is not a `{ text, … }` object. */
  | 'scripts.errEnvelope'
  /** `output = "report"`, but stdout is not a valid report. */
  | 'scripts.errReport';
