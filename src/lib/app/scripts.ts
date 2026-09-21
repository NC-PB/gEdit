// The script runner (plan §7.3, §5 WP5.1). Owner: **WP5.1**.
//
// `ScriptService.run` is the whole sequence a script goes through, in one place, so that
// every script behaves the same and no `contrib/` file repeats it. The eight steps are
// listed on `ScriptService` in `app/types.ts`; `core/scripting/` holds the three pure
// pieces (`scriptsForProfile`, `buildContext`, `decideApply`) and this module holds the
// wiring.
//
// Three decisions carried over from `app/transforms.ts`, for the same reasons:
//
//  - **The scope is taken before the form opens**, not after. It is the selection the user
//    had when they picked the command; a modal takes the focus and a click in it must not
//    quietly widen a run to the whole program.
//  - **The version is taken before stdin is built**, and compared after the run. That
//    window is what `decideApply`'s `stale` covers; taking it later would miss an edit
//    made while the script was already reading.
//  - **The service is the only writer of `stores/scripts.ts`.** The panel, the status item
//    and the ribbon read those stores and never set them.
//
// `createScriptService(deps)` plus the singleton at the bottom (AD-2), so a unit test can
// drive the sequence with a fake backend, modal and status service and no Monaco.
//
// Nothing here runs a script without the user asking (plan §3, standing rule 5). There is
// no run-on-open, no run-on-save and no timer. Every way out of `run()` — a refusal before
// the process starts, a failure, a timeout, a cancel, a stale document — says so in the
// status bar or a dialog: a run that changed nothing must never look like one that did.
//
// **Why every message goes through `MSG` instead of a literal `t('scripts.…')`.** WP5.2
// owns `i18n/en/scripts.ts`; WP5.1 owns this file. Keeping the keys as `Msg` values in one
// exported table (`SCRIPT_STATUS_KEYS`) is what lets the two work packages be written at
// the same time: this file names the closed set it can emit, and WP5.2's namespace carries
// it, exactly as `APPLY_ERROR_KEYS` already does for `decideApply`'s reasons. The i18n key
// scan (`i18n/keys.test.ts`) only sees literal `t()` calls, so the table is the contract
// and the hand-off note repeats it in full.
//
// `checkPython` is what `bootstrap.ts` calls after the first render. It never rejects: a
// startup probe that threw would be an unhandled rejection and would fail the harness.

import { derived, get } from 'svelte/store';
import { dialogs as appDialogs } from '$lib/app/dialogs';
import { files as appFiles } from '$lib/app/fileOps';
import { modals as appModals } from '$lib/app/modals';
import { status as appStatus } from '$lib/app/status';
import { initialValues } from '$lib/core/forms/values';
import { decideApply } from '$lib/core/scripting/apply';
import { buildContext, MAX_PRECEDING_LINES } from '$lib/core/scripting/context';
import { scriptLabel, scriptsForProfile } from '$lib/core/scripting/filter';
import { transformScope } from '$lib/core/transforms/scope';
import { applyLines as applyLinesToModel } from '$lib/monaco/applyLines';
import { editor as appEditor } from '$lib/monaco/editorService';
import {
  pythonCheck,
  scriptCancel,
  scriptRun,
  scriptsList,
  type PythonStatus,
  type RunRequest,
  type RunResult,
  type ScriptEntry,
  type ScriptList,
} from '$lib/platform/commands';
import { codes as appCodes } from '$lib/stores/codes';
import { docs as appDocs } from '$lib/stores/documents';
import { layout as appLayout } from '$lib/stores/layout';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { results as appResults } from '$lib/stores/results';
import {
  jsonFromStdout,
  lastScriptId,
  outputFromRun,
  pythonStatus,
  resetScriptOutput,
  runningScript,
  scriptFolders,
  scriptList,
  scriptListError,
  scriptOutput,
} from '$lib/stores/scripts';
import { uiState as appUiState } from '$lib/stores/uiState';
import { t as translate } from '$lib/i18n';
import { isTauriRuntime } from '$lib/utils/platform';
import type {
  CodeDbService,
  DocId,
  DocumentStore,
  EditorService,
  FileOps,
  LayoutStore,
  Modals,
  Msg,
  NativeDialogs,
  ProfileRegistry,
  ReportData,
  ResultsService,
  ScriptService,
  StatusService,
  Translate,
  UiStateStore,
} from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { Profile } from '$lib/core/profiles/types';
import type { ScriptContextInput } from '$lib/core/scripting/types';

/** The `uiState.lastParams` key a script's form values are remembered under (§7.3). */
export function formKey(scriptId: string): string {
  return `script:${scriptId}`;
}

/**
 * The panel a `panel`-mode run and every failure reveal. `contrib/scripts.ts` registers it
 * under this id (§7.9 pins `output-*` to it).
 */
export const SCRIPT_OUTPUT_PANEL = 'output';

// ---------------------------------------------------------------------------
// The closed set of messages this service can show
// ---------------------------------------------------------------------------

/**
 * Every `Msg` the runner emits, as builders, so the keys are in one place and WP5.2's
 * namespace is written against a list rather than against a grep.
 *
 * `scripts.keys.test.ts` asserts that `SCRIPT_STATUS_KEYS` below and the namespace are the
 * same set, and that no message interpolates a placeholder these builders do not pass. That
 * test is what stands in for the key scan, which only sees literal `t()` calls.
 */
const MSG = {
  desktopOnly: (): Msg => ({ key: 'scripts.desktopOnly' }),
  busy: (): Msg => ({ key: 'scripts.busy' }),
  noDocument: (): Msg => ({ key: 'scripts.noDocument' }),
  notFound: (script: string): Msg => ({ key: 'scripts.notFound', params: { script } }),
  notForProfile: (script: string, profile: string): Msg => ({
    key: 'scripts.notForProfile',
    params: { script, profile },
  }),
  noProfile: (profile: string): Msg => ({ key: 'scripts.noProfile', params: { profile } }),
  pythonMissing: (): Msg => ({ key: 'scripts.pythonMissing' }),
  needsSelection: (script: string): Msg => ({ key: 'scripts.needsSelection', params: { script } }),
  noInputToReplace: (script: string): Msg => ({
    key: 'scripts.noInputToReplace',
    params: { script },
  }),
  noLastScript: (): Msg => ({ key: 'scripts.noLastScript' }),
  running: (script: string): Msg => ({ key: 'scripts.running', params: { script } }),
  cancelling: (): Msg => ({ key: 'scripts.cancelling' }),
  cancelFailed: (): Msg => ({ key: 'scripts.cancelFailed' }),
  runFailed: (script: string): Msg => ({ key: 'scripts.runFailed', params: { script } }),
  finished: (script: string): Msg => ({ key: 'scripts.finished', params: { script } }),
  applied: (script: string, count: number): Msg => ({
    key: 'scripts.applied',
    params: { script, count },
  }),
  appliedNone: (script: string): Msg => ({ key: 'scripts.appliedNone', params: { script } }),
  openedNewTab: (script: string): Msg => ({ key: 'scripts.openedNewTab', params: { script } }),
  reported: (script: string): Msg => ({ key: 'scripts.reported', params: { script } }),
  staleTitle: (): Msg => ({ key: 'scripts.staleTitle' }),
  staleMessage: (script: string): Msg => ({ key: 'scripts.staleMessage', params: { script } }),
  staleOpen: (): Msg => ({ key: 'scripts.staleOpen' }),
  staleDiscarded: (script: string): Msg => ({ key: 'scripts.staleDiscarded', params: { script } }),
} as const;

/**
 * The keys of `MSG`, for the hand-off and for WP5.2's namespace. `scripts.applied` is a
 * plural key: it needs `applied_one` and `applied_other`, and no plain `applied`.
 */
export const SCRIPT_STATUS_KEYS: readonly string[] = [
  'scripts.desktopOnly',
  'scripts.busy',
  'scripts.noDocument',
  'scripts.notFound',
  'scripts.notForProfile',
  'scripts.noProfile',
  'scripts.pythonMissing',
  'scripts.needsSelection',
  'scripts.noInputToReplace',
  'scripts.noLastScript',
  'scripts.running',
  'scripts.cancelling',
  'scripts.cancelFailed',
  'scripts.runFailed',
  'scripts.finished',
  'scripts.applied',
  'scripts.appliedNone',
  'scripts.openedNewTab',
  'scripts.reported',
  'scripts.staleTitle',
  'scripts.staleMessage',
  'scripts.staleOpen',
  'scripts.staleDiscarded',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An error as the English detail line the status bar shows under a translated summary. */
function detail(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Unique within the process, which is all `RunRegistry` needs. */
let runSequence = 0;
function nextRunId(): string {
  runSequence += 1;
  return `run-${Date.now().toString(36)}-${runSequence}`;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface ScriptDeps {
  docs: Pick<DocumentStore, 'getActiveId' | 'get'>;
  editor: Pick<EditorService, 'getLineCount' | 'getLines' | 'selectionLines' | 'cursor' | 'versionId'>;
  profiles: Pick<ProfileRegistry, 'profile'>;
  codes: Pick<CodeDbService, 'forScripts'>;
  modals: Pick<Modals, 'form'>;
  dialogs: Pick<NativeDialogs, 'confirm'>;
  status: Pick<StatusService, 'show'>;
  uiState: Pick<UiStateStore, 'state' | 'getLastParams' | 'setLastParams' | 'update'>;
  results: ResultsService;
  files: Pick<FileOps, 'newUntitled'>;
  layout: Pick<LayoutStore, 'show'>;
  /** `monaco/applyLines.ts`; a fake in the tests. */
  applyLines(
    id: DocId,
    startLine: number,
    endLine: number,
    newLines: string[],
    lineMap?: Int32Array,
  ): { changedLines: number };
  /** The four Tauri commands, so a test never needs a webview. */
  backend: {
    list(): Promise<ScriptList>;
    run(req: RunRequest): Promise<RunResult>;
    cancel(runId: string): Promise<boolean>;
    check(): Promise<PythonStatus>;
  };
  /** False in a plain browser: the script backend is desktop-only. */
  isDesktop(): boolean;
  newRunId(): string;
  now(): number;
  t: Translate;
}

export function createScriptService(deps: ScriptDeps): ScriptService {
  const { t } = deps;

  /** The report this service last published, so it can retract that one and no other. */
  let ownReport: ReportData | null = null;

  /**
   * True from the moment `run()` claims the slot until it lets go (G8 M5).
   *
   * `runningScript` is only set at step 5, and steps 1 to 4 await: the Python probe is a
   * real IPC round trip whenever the status is still unknown, which is exactly the state
   * the app starts in. A second F9 in that window found `runningScript` null and started a
   * second run, whose id then overwrote the first's. The document was never at risk — each
   * run takes its own `versionAtStart`, so the loser lands as `stale` — but the status
   * item, Cancel and the Output panel all addressed the wrong run. This flag is set in the
   * same tick as the check, which is what closes it.
   */
  let starting = false;

  /**
   * The run id the user asked to stop, until that run is over (G8 M5).
   *
   * `scriptCancel` answering `false` means the kill did not land, which is what a Cancel
   * click that lost the race with the process exit looks like — but it is not the same
   * question as "did the user ask to stop". This is that question. A run the user stopped
   * must not reach the document even when the process had already written a perfectly good
   * program, because the guarantee the Stop button and the user guide make is that a
   * stopped run changes nothing. The output is still kept for the panel.
   */
  let cancelRequested: string | null = null;

  /** A `Msg` as display text. */
  const tr = (msg: Msg): string => t(msg.key, msg.params);

  const say = (msg: Msg, o?: { error?: boolean; detail?: string; sticky?: boolean }): void => {
    deps.status.show(tr(msg), o);
  };

  /**
   * Step 8: what the Results panel shows for this run.
   *
   * A run with nothing to report **clears its own previous report** and nothing else, as
   * `app/transforms.ts` does: leaving the last run's findings on screen after the user
   * fixed them reads as "still there", and clearing somebody else's report would be worse.
   */
  function publish(report: ReportData | null): void {
    if (report === null) {
      if (ownReport !== null && get(deps.results.current) === ownReport) deps.results.clear();
      ownReport = null;
      return;
    }
    ownReport = report;
    deps.results.show(report);
  }

  /** The values a run starts from when the form is skipped, or the form is pre-filled with. */
  function startingValues(
    fields: FieldSpec[],
    scriptId: string,
    o: { params?: Record<string, unknown>; skipForm?: boolean } | undefined,
  ): Record<string, unknown> {
    // `skipForm` also skips what was remembered: a headless run (the harness, a test, a
    // command that carries its own values) has to be reproducible.
    const remembered = o?.skipForm === true ? undefined : deps.uiState.getLastParams(formKey(scriptId));
    return { ...initialValues(fields, remembered), ...(o?.params ?? {}) };
  }

  /** Publishes `status` and answers whether scripts can run at all. */
  async function pythonReady(): Promise<boolean> {
    let status = get(pythonStatus);
    if (status === null) status = await checkPython();
    if (status !== null && status.ok) return true;
    say(MSG.pythonMissing(), { error: true, detail: status?.message ?? undefined });
    return false;
  }

  /** Probes the interpreter and publishes the answer. Never rejects. */
  async function checkPython(): Promise<PythonStatus | null> {
    if (!deps.isDesktop()) return null;
    let status: PythonStatus;
    try {
      status = await deps.backend.check();
    } catch (err) {
      status = { ok: false, interpreter: null, version: null, message: detail(err) };
    }
    pythonStatus.set(status);
    return status;
  }

  /**
   * A header combination that cannot be run at all, or null.
   *
   * Rust refuses a header that is unusable (`headerError`) and warns about values it had
   * to downgrade; what it does not check is `input = "none"` together with
   * `output = "replace"`. The range to replace would be `0..0`, which `applyLines` clamps
   * to the first line, so a script that was handed no input would quietly overwrite line 1
   * — exactly the kind of damage the safety bar exists to prevent. It is caught before the
   * parameter form, so the user is not asked to fill one in for a run that cannot happen.
   */
  function headerRefusal(meta: ScriptEntry['meta'], label: string): Msg | null {
    if (meta === null) return null;
    return meta.input === 'none' && meta.output === 'replace' ? MSG.noInputToReplace(label) : null;
  }

  /**
   * The input scope, the text for stdin and the lines that prime the modal state.
   *
   * A `Msg` is a refusal the caller reports: a script that declared `input = "selection"`
   * and was started without one gets a reason rather than the whole program.
   */
  function resolveInput(
    docId: DocId,
    meta: ScriptEntry['meta'],
    selection: { startLine: number; endLine: number; empty: boolean } | null,
    lineCount: number,
    label: string,
  ): { input: ScriptContextInput; stdin: string } | Msg {
    const wanted = meta?.input ?? 'selection-or-document';
    if (wanted === 'none') return { input: { scope: 'none', startLine: 0, endLine: 0 }, stdin: '' };

    const scope = transformScope(lineCount, selection);
    if (wanted === 'selection' && !scope.fromSelection) return MSG.needsSelection(label);

    const useSelection = wanted !== 'document' && scope.fromSelection;
    const startLine = useSelection ? scope.startLine : 1;
    const endLine = useSelection ? scope.endLine : lineCount;

    const input: ScriptContextInput = {
      scope: useSelection ? 'selection' : 'document',
      startLine,
      endLine,
    };
    // Carry-over (2): the modal state above a selection. `buildContext` applies the caps
    // and drops the field when it does not fit, so reading is the only cost here — and it
    // is skipped outright for a selection that starts unreasonably deep in a program.
    const above = startLine - 1;
    if (input.scope === 'selection' && above > 0 && above <= MAX_PRECEDING_LINES) {
      input.precedingLines = deps.editor.getLines(docId, 1, above);
    }

    return { input, stdin: deps.editor.getLines(docId, startLine, endLine).join('\n') };
  }

  async function run(
    scriptId: string,
    o?: { params?: Record<string, unknown>; skipForm?: boolean },
  ): Promise<void> {
    if (!deps.isDesktop()) {
      say(MSG.desktopOnly(), { error: true });
      return;
    }
    // One run at a time in P1: the registry would take a second one, but two scripts
    // writing the same document as one undo step each is not a state worth having. The
    // slot is claimed here, synchronously, and not at step 5 — see `starting`.
    if (starting || get(runningScript) !== null) {
      say(MSG.busy(), { error: true });
      return;
    }
    starting = true;
    try {
      await runClaimed(scriptId, o);
    } finally {
      starting = false;
    }
  }

  /** `run` with the slot already claimed; every way out of it releases it. */
  async function runClaimed(
    scriptId: string,
    o?: { params?: Record<string, unknown>; skipForm?: boolean },
  ): Promise<void> {
    const entry = get(scriptList).find((candidate) => candidate.id === scriptId);
    if (entry === undefined) {
      say(MSG.notFound(scriptId), { error: true });
      return;
    }
    const label = scriptLabel(entry);

    const docId = deps.docs.getActiveId();
    const doc = docId === null ? undefined : deps.docs.get(docId);
    if (docId === null || doc === undefined) {
      say(MSG.noDocument(), { error: true });
      return;
    }

    // 1. The profile filter, for every way in: the ribbon, the palette, `script.run:<id>`
    // and `script.runLast` all end here.
    if (scriptsForProfile([entry], doc.profileId).length === 0) {
      say(MSG.notForProfile(label, doc.profileId), { error: true });
      return;
    }

    const badHeader = headerRefusal(entry.meta, label);
    if (badHeader !== null) {
      say(badHeader, { error: true });
      return;
    }

    let profile: Profile;
    try {
      profile = deps.profiles.profile(doc.profileId);
    } catch {
      say(MSG.noProfile(doc.profileId), { error: true });
      return;
    }

    if (!(await pythonReady())) return;

    // The scope and the caret belong to the moment the command was invoked (see the
    // header), so both are read before the form can take the focus.
    const selection = deps.editor.selectionLines();
    const cursor = deps.editor.cursor() ?? { line: 1, column: 1 };

    // 2. The parameter form. A script with no parameters runs immediately.
    const fields = entry.meta?.params ?? [];
    let params = startingValues(fields, scriptId, o);
    if (fields.length > 0 && o?.skipForm !== true) {
      const answered = await deps.modals.form({ title: label, fields, values: params });
      if (answered === undefined) return;
      params = answered;
      deps.uiState.setLastParams(formKey(scriptId), answered);
    }

    // 5, taken here on purpose: the version has to be older than the text that is sent,
    // or an edit made between reading the lines and stamping the version would slip
    // through `decideApply`'s stale check.
    const versionAtStart = deps.editor.versionId(docId);

    // 3. The input scope, extended to whole lines, LF-joined. A `Msg` back is a refusal.
    const lineCount = deps.editor.getLineCount(docId);
    const resolved = resolveInput(docId, entry.meta, selection, lineCount, label);
    if ('key' in resolved) {
      say(resolved, { error: true });
      return;
    }

    // 4. The context file.
    const context = buildContext({
      doc,
      profile,
      codes: deps.codes.forScripts(doc.profileId),
      input: resolved.input,
      cursor: { line: cursor.line, column: cursor.column },
      params,
    });

    const runId = deps.newRunId();
    const request: RunRequest = {
      runId,
      scriptId,
      stdin: resolved.stdin,
      context,
      // The header's `timeout` and `scripts.timeoutSeconds` are Rust's to resolve (§7.6);
      // nothing in the UI overrides them in P1.
      timeoutSecs: null,
    };

    resetScriptOutput();
    cancelRequested = null;
    runningScript.set({ runId, scriptId, startedAt: deps.now() });
    lastScriptId.set(scriptId);
    deps.uiState.update((state) => ({ ...state, lastScript: scriptId }));
    // A panel-mode script *is* its output, so the panel opens with the run. Every other
    // mode leaves the layout alone unless the run fails, and the status bar carries the
    // running state and its Cancel.
    if ((entry.meta?.output ?? 'panel') === 'panel') deps.layout.show(SCRIPT_OUTPUT_PANEL);
    say(MSG.running(label), { sticky: true });

    // 6. The run. A rejection means nothing ever started (no such id, no interpreter).
    let result: RunResult;
    try {
      result = await deps.backend.run(request);
    } catch (err) {
      runningScript.set(null);
      cancelRequested = null;
      say(MSG.runFailed(label), { error: true, detail: detail(err) });
      deps.layout.show(SCRIPT_OUTPUT_PANEL);
      return;
    }
    runningScript.set(null);

    // A Stop the process outran is still a Stop. `RunRegistry::cancel` finds no entry
    // once the child has exited and answers `false`, and Rust then drains the pipes for a
    // grace period, so a click can land after the script's last write and before this
    // promise resolves. The user asked for the run to stop: the result is kept for the
    // panel and is not allowed anywhere near the program.
    const stopped = cancelRequested === runId;
    cancelRequested = null;
    if (stopped && !result.cancelled) result = { ...result, cancelled: true };

    // Everything the panel shows is kept first, whatever the mode was and whatever is
    // decided below: a run that failed, was cancelled or rewrote the program still has
    // stderr, an exit code and a duration worth reading.
    scriptOutput.set(outputFromRun(scriptId, label, result, jsonFromStdout(result.stdout)));

    // 7. What the run is allowed to do.
    const versionNow = deps.editor.versionId(docId);
    const decision = decideApply(entry.meta, result, versionAtStart, versionNow, resolved.stdin.endsWith('\n'));

    // 8. Acting on it.
    switch (decision.kind) {
      case 'error': {
        say(decision.reason, { error: true, detail: decision.stderr });
        deps.layout.show(SCRIPT_OUTPUT_PANEL);
        publish(null);
        return;
      }
      case 'panel': {
        say(MSG.finished(label));
        publish(null);
        return;
      }
      case 'report': {
        say(MSG.reported(label));
        publish({ ...decision.report, docId });
        return;
      }
      case 'stale': {
        await offerNewTab(label, doc.profileId, decision.text);
        publish(null);
        return;
      }
      case 'new-document': {
        deps.files.newUntitled({ profileId: doc.profileId, text: decision.text, activate: true });
        sayResult(MSG.openedNewTab(label), decision.message);
        publish(findingsReport(label, decision.message, decision.findings, docId, decision.dropped));
        return;
      }
      case 'replace': {
        const { changedLines } = deps.applyLines(
          docId,
          resolved.input.startLine,
          resolved.input.endLine,
          decision.text.split('\n'),
        );
        sayResult(
          changedLines === 0 ? MSG.appliedNone(label) : MSG.applied(label, changedLines),
          decision.message,
        );
        publish(findingsReport(label, decision.message, decision.findings, docId, decision.dropped));
        return;
      }
    }
  }

  /** The summary, plus the script's own message when it sent one (data, untranslated). */
  function sayResult(msg: Msg, message: string | undefined): void {
    const summary = tr(msg);
    deps.status.show(message === undefined || message === '' ? summary : `${summary} ${message}`);
  }

  /** An envelope's findings as the Results panel's shape, or null when there are none. */
  function findingsReport(
    label: string,
    message: string | undefined,
    findings: ReportData['findings'],
    docId: DocId,
    dropped?: number,
  ): ReportData | null {
    if (findings === undefined || findings.length === 0) return null;
    const report: ReportData = { title: label, columns: [], rows: [], findings, docId };
    if (message !== undefined && message !== '') report.message = message;
    if (dropped !== undefined && dropped > 0) report.dropped = dropped;
    return report;
  }

  /** The recovery from a stale result: the text still exists, just not where it was going. */
  async function offerNewTab(label: string, profileId: string, text: string): Promise<void> {
    const open = await deps.dialogs.confirm({
      title: tr(MSG.staleTitle()),
      message: tr(MSG.staleMessage(label)),
      ok: tr(MSG.staleOpen()),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
    if (!open) {
      say(MSG.staleDiscarded(label), { error: true });
      return;
    }
    deps.files.newUntitled({ profileId, text, activate: true });
    say(MSG.openedNewTab(label));
  }

  return {
    // `derived` rather than the writables themselves, so `set` does not leak out of the
    // service (as in stores/results.ts and stores/layout.ts).
    list: derived(scriptList, (v) => v),
    python: derived(pythonStatus, (v) => v),
    running: derived(runningScript, (v) => v),

    /** Never rejects: the list's own error is a store the UI reads, not an exception. */
    async rescan(): Promise<void> {
      if (!deps.isDesktop()) {
        scriptList.set([]);
        scriptFolders.set([]);
        scriptListError.set(null);
        return;
      }
      try {
        const listed = await deps.backend.list();
        scriptList.set(listed.scripts);
        scriptFolders.set(listed.folders);
        scriptListError.set(null);
      } catch (err) {
        scriptList.set([]);
        scriptFolders.set([]);
        scriptListError.set(detail(err));
      }
      // `ui.lastScript` survives a restart; this is where the session's mirror catches up
      // with it, once, so `script.runLast` works before anything has run in this window.
      if (get(lastScriptId) === null) {
        const remembered = get(deps.uiState.state).lastScript;
        if (remembered !== null) lastScriptId.set(remembered);
      }
    },

    run,

    async runLast(): Promise<void> {
      const scriptId = get(lastScriptId) ?? get(deps.uiState.state).lastScript;
      if (scriptId === null) {
        say(MSG.noLastScript(), { error: true });
        return;
      }
      // The remembered values are used, not asked for again: "run the last one again" is
      // the point of the command. A script whose parameters should change is started from
      // the ribbon or the palette.
      //
      // They go through the field specs first, exactly as the form's pre-fill does
      // (`initialValues` drops a value whose type no longer suits its field). Without it
      // the two ways in disagreed about the same stored record: the form discarded a
      // stale value and this handed it straight to the script (G8 M5).
      const fields = get(scriptList).find((candidate) => candidate.id === scriptId)?.meta?.params ?? [];
      const remembered = deps.uiState.getLastParams(formKey(scriptId));
      await run(scriptId, { skipForm: true, params: initialValues(fields, remembered) });
    },

    async cancel(): Promise<void> {
      const active = get(runningScript);
      if (active === null) return;
      // Recorded before the await, so the request is on file whatever the backend then
      // answers. The boolean `scriptCancel` returns says only whether the kill landed.
      cancelRequested = active.runId;
      say(MSG.cancelling(), { sticky: true });
      try {
        await deps.backend.cancel(active.runId);
      } catch (err) {
        say(MSG.cancelFailed(), { error: true, detail: detail(err) });
      }
      // `runningScript` stays set: the run's own promise clears it when the process is
      // actually gone, and `decideApply` turns the cancel into a visible refusal.
    },

    checkPython,
  };
}

/** The application-wide script service. */
export const scripts: ScriptService = createScriptService({
  docs: appDocs,
  editor: appEditor,
  profiles: appProfiles,
  codes: appCodes,
  modals: appModals,
  dialogs: appDialogs,
  status: appStatus,
  uiState: appUiState,
  results: appResults,
  files: appFiles,
  layout: appLayout,
  applyLines: applyLinesToModel,
  backend: {
    list: scriptsList,
    run: scriptRun,
    cancel: scriptCancel,
    check: pythonCheck,
  },
  isDesktop: isTauriRuntime,
  newRunId: nextRunId,
  now: () => Date.now(),
  t: translate,
});
