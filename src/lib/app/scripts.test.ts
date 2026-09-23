// The script runner (plan §5 WP5.1, §7.3): the eight steps, in order, and every way out
// of them.
//
// The real document store, the real profile registry, the real results store and the real
// script stores are used; the editor, the modals, the dialogs, the status bar, the layout,
// the apply step and the whole Tauri backend are fakes, so no test needs Monaco or a
// webview. What each case asserts is what the user would see: what the script was handed,
// what reached the model, what the status bar says, and what the Results and Output panels
// end up holding.
//
// `t` is a fake that renders `<key> <params>`, not the real catalog. WP5.2 owns
// `i18n/en/scripts.ts` and writes the v2 namespace against `SCRIPT_STATUS_KEYS` and
// `APPLY_ERROR_KEYS`; asserting on English here would make this file fail on its own
// branch and pin wording that is not WP5.1's to choose. The key and its parameters are
// what this service decides, so that is what the tests read.

import { get, writable, type Writable } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { createScriptService, formKey, SCRIPT_OUTPUT_PANEL, SCRIPT_STATUS_KEYS } from './scripts';
import { createDocumentStore } from '$lib/stores/documents';
import { noMachine } from '$lib/core/machines/effective';
import { profiles } from '$lib/stores/profiles';
import { results } from '$lib/stores/results';
import {
  lastScriptId,
  pythonStatus,
  resetScriptsForTest,
  runningScript,
  scriptFolders,
  scriptList,
  scriptListError,
  scriptOutput,
} from '$lib/stores/scripts';
import type {
  DocId,
  DocumentStore,
  NewDocMeta,
  ScriptService,
  Translate,
  UiState,
} from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { ScriptContextV2 } from '$lib/core/scripting/types';
import type {
  PythonStatus,
  RunRequest,
  RunResult,
  ScriptEntry,
  ScriptList,
  ScriptMeta,
} from '$lib/platform/commands';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINES = ['%', 'O1000 (PART 42)', 'N10 G0 X0', 'N20 G1 X10. F100.', 'N30 M30', '%'];

const PERCENT: FieldSpec[] = [{ id: 'percent', type: 'number', label: 'Percent', default: 100 }];

function meta(over: Partial<ScriptMeta> = {}): ScriptMeta {
  return {
    name: 'Scale feed rates',
    description: 'Scales every feed word.',
    profiles: null,
    input: 'selection-or-document',
    output: 'replace',
    timeout: null,
    envelope: false,
    documents: 'active',
    params: [],
    warnings: [],
    ...over,
  };
}

function entry(id: string, over: Partial<ScriptEntry> = {}): ScriptEntry {
  return {
    id,
    root: id.split(':')[0],
    group: null,
    fileName: id.split(':')[1] ?? id,
    meta: meta(),
    headerError: null,
    shadowed: false,
    editable: false,
    ...over,
  };
}

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    exitCode: 0,
    success: true,
    stdout: '',
    stderr: '',
    timedOut: false,
    cancelled: false,
    stdoutTruncated: false,
    durationMs: 12,
    interpreter: '/usr/bin/python3',
    ...over,
  };
}

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: '/jobs/part42.nc',
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...over,
  };
}

/** Renders `<key> {"param":…}`, so a test reads the decision and not WP5.2's wording. */
const fakeT: Translate = (key, params) =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const OK_PYTHON: PythonStatus = {
  ok: true,
  interpreter: '/usr/bin/python3',
  version: '3.12.1',
  message: null,
};

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

interface Harness {
  service: ScriptService;
  docs: DocumentStore;
  docId: DocId;
  lines: string[];
  selection: { startLine: number; endLine: number; empty: boolean } | null;
  cursor: { line: number; column: number; selectedChars: number; selections: number } | null;
  version: number;
  /** Runs this before answering `script_run`, to simulate an edit during the run. */
  duringRun: (() => void) | null;
  /** Runs this while the parameter form is open, e.g. to take the selection away. */
  duringForm: (() => void) | null;
  entries: ScriptEntry[];
  listError: unknown;
  status: { text: string; error: boolean; detail?: string; sticky: boolean }[];
  forms: { title: string; fields: FieldSpec[]; values?: Record<string, unknown> }[];
  formAnswers: (Record<string, unknown> | undefined)[];
  confirms: { title: string; message: string; ok: string }[];
  confirmAnswers: boolean[];
  applied: { id: DocId; startLine: number; endLine: number; lines: string[] }[];
  /** What the fake `applyLines` reports as changed; null means "one per line handed over". */
  applyLinesAnswer: number | null;
  created: { profileId?: string; text?: string }[];
  shown: string[];
  requests: RunRequest[];
  runs: (RunResult | Error)[];
  cancels: string[];
  /** What `script_cancel` answers; `false` is "the kill did not land" (it already exited). */
  cancelAnswer: boolean;
  /** Awaited inside `python_check`, to hold the probe open the way startup does. */
  probeGate: Promise<void> | null;
  probes: number;
  python: PythonStatus;
  /** A probe that fails, so `checkPython` has to turn it into an `ok: false` status. */
  probeError: unknown;
  ui: Writable<UiState>;
  desktop: boolean;
}

function harness(o: { profileId?: string; entries?: ScriptEntry[] } = {}): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const docId = docs.add(newDoc({ profileId: o.profileId ?? 'fanuc-gcode' }));
  const uiStore = writable<UiState>({ layout: {}, lastParams: {}, lastScript: null, files: {} });

  const h: Harness = {
    service: undefined as unknown as ScriptService,
    docs,
    docId,
    lines: [...LINES],
    selection: null,
    cursor: { line: 3, column: 1, selectedChars: 0, selections: 1 },
    version: 7,
    duringRun: null,
    duringForm: null,
    entries: o.entries ?? [entry('bundled:scale_feed.py')],
    listError: null,
    status: [],
    forms: [],
    formAnswers: [],
    confirms: [],
    confirmAnswers: [],
    applied: [],
    applyLinesAnswer: null,
    created: [],
    shown: [],
    requests: [],
    runs: [],
    cancels: [],
    cancelAnswer: true,
    probeGate: null,
    probes: 0,
    python: OK_PYTHON,
    probeError: null,
    ui: uiStore,
    desktop: true,
  };

  h.service = createScriptService({
    docs,
    editor: {
      getLineCount: () => h.lines.length,
      getLines: (_id, startLine, endLine) => h.lines.slice(startLine - 1, endLine),
      selectionLines: () => h.selection,
      cursor: () => h.cursor,
      versionId: () => h.version,
    },
    // The effective view of the document (AD-31): without a machine it is the profile's
    // own compile and its own database, which is what this service used to ask for.
    machines: {
      effective: (id) => {
        const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
        const profile = profiles.profile(profileId);
        return {
          profile,
          cp: profiles.compiled(profileId),
          codes: {
            dialect: 'fanuc',
            version: 1,
            addresses: {},
            codes: [{ code: 'G84', label: 'Tapping cycle', group: 'cycle', pitchFeed: true }],
          },
          machine: noMachine(profile),
        };
      },
    },
    modals: {
      form: (request) => {
        h.forms.push(request);
        h.duringForm?.();
        return Promise.resolve(h.formAnswers.shift());
      },
    },
    dialogs: {
      confirm: (request) => {
        h.confirms.push({ title: request.title, message: request.message, ok: request.ok });
        return Promise.resolve(h.confirmAnswers.shift() ?? false);
      },
    },
    status: {
      show: (text, options) =>
        h.status.push({
          text,
          error: options?.error === true,
          detail: options?.detail,
          sticky: options?.sticky === true,
        }),
    },
    uiState: {
      state: uiStore,
      getLastParams: (key) => get(uiStore).lastParams[key],
      setLastParams: (key, value) =>
        uiStore.update((state) => ({ ...state, lastParams: { ...state.lastParams, [key]: value } })),
      update: (fn) => uiStore.update(fn),
    },
    results,
    files: {
      newUntitled: (options) => {
        h.created.push({ profileId: options?.profileId, text: options?.text });
        return 'd-new';
      },
    },
    layout: { show: (panelId) => h.shown.push(panelId) },
    applyLines: (id, startLine, endLine, lines) => {
      h.applied.push({ id, startLine, endLine, lines });
      return { changedLines: h.applyLinesAnswer ?? lines.length };
    },
    backend: {
      list: (): Promise<ScriptList> =>
        h.listError === null
          ? Promise.resolve({ scripts: h.entries, folders: [] })
          : Promise.reject(h.listError),
      run: (req) => {
        h.requests.push(req);
        h.duringRun?.();
        const next = h.runs.shift() ?? result();
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
      cancel: (runId) => {
        h.cancels.push(runId);
        return Promise.resolve(h.cancelAnswer);
      },
      check: async () => {
        h.probes += 1;
        if (h.probeGate !== null) await h.probeGate;
        if (h.probeError !== null) throw h.probeError;
        return h.python;
      },
    },
    isDesktop: () => h.desktop,
    newRunId: () => 'run-1',
    now: () => 1_000,
    t: fakeT,
  });

  return h;
}

/** The harness with its script list already loaded and Python known to be there. */
async function ready(o: { profileId?: string; entries?: ScriptEntry[] } = {}): Promise<Harness> {
  const h = harness(o);
  await h.service.rescan();
  pythonStatus.set(OK_PYTHON);
  return h;
}

const lastStatus = (h: Harness) => h.status[h.status.length - 1];

beforeEach(() => {
  resetScriptsForTest();
  results.clear();
});

// ---------------------------------------------------------------------------
// rescan and the Python probe
// ---------------------------------------------------------------------------

describe('ScriptService.rescan', () => {
  it('fills the list and the folders', async () => {
    const h = harness();
    await h.service.rescan();
    expect(get(scriptList).map((s) => s.id)).toEqual(['bundled:scale_feed.py']);
    expect(get(scriptFolders)).toEqual([]);
    expect(get(scriptListError)).toBeNull();
  });

  it('keeps the failure as a store, not an exception', async () => {
    const h = harness();
    h.listError = new Error('permission denied');
    await expect(h.service.rescan()).resolves.toBeUndefined();
    expect(get(scriptList)).toEqual([]);
    expect(get(scriptListError)).toBe('permission denied');
  });

  it('answers an empty list outside the desktop app', async () => {
    const h = harness();
    h.desktop = false;
    await h.service.rescan();
    expect(get(scriptList)).toEqual([]);
    expect(get(scriptListError)).toBeNull();
  });

  it('catches the session mirror up with `ui.lastScript`, once', async () => {
    const h = harness();
    h.ui.update((state) => ({ ...state, lastScript: 'user:mine.py' }));
    await h.service.rescan();
    expect(get(lastScriptId)).toBe('user:mine.py');

    lastScriptId.set('bundled:scale_feed.py');
    await h.service.rescan();
    expect(get(lastScriptId)).toBe('bundled:scale_feed.py');
  });
});

describe('ScriptService.checkPython', () => {
  it('publishes the probe', async () => {
    const h = harness();
    expect(get(pythonStatus)).toBeNull();
    await h.service.checkPython();
    expect(get(pythonStatus)).toEqual(OK_PYTHON);
  });

  it('never rejects: a failed probe becomes an `ok: false` status', async () => {
    const h = harness();
    h.probeError = new Error('spawn python3 ENOENT');
    await expect(h.service.checkPython()).resolves.toMatchObject({ ok: false });
    expect(get(pythonStatus)).toEqual({
      ok: false,
      interpreter: null,
      version: null,
      message: 'spawn python3 ENOENT',
    });
  });

  it('answers null outside the desktop app and leaves the status unknown', async () => {
    const h = harness();
    h.desktop = false;
    expect(await h.service.checkPython()).toBeNull();
    expect(get(pythonStatus)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Step 1: can it run at all
// ---------------------------------------------------------------------------

describe('ScriptService.run: the refusals before anything starts', () => {
  it('says so in a plain browser', async () => {
    const h = await ready();
    h.desktop = false;
    await h.service.run('bundled:scale_feed.py');
    expect(lastStatus(h)).toMatchObject({ text: 'scripts.desktopOnly', error: true });
    expect(h.requests).toHaveLength(0);
  });

  it('refuses a second run while one is in flight', async () => {
    const h = await ready();
    runningScript.set({ runId: 'run-0', scriptId: 'user:other.py', docId: 'd1', startedAt: 1 });
    await h.service.run('bundled:scale_feed.py');
    expect(lastStatus(h).error).toBe(true);
    expect(h.requests).toHaveLength(0);
  });

  it('refuses an id that is not in the list', async () => {
    const h = await ready();
    await h.service.run('user:gone.py');
    expect(lastStatus(h)).toMatchObject({ error: true });
    expect(lastStatus(h).text).toContain('user:gone.py');
    expect(h.requests).toHaveLength(0);
  });

  it('refuses without a document', async () => {
    const h = await ready();
    h.docs.remove(h.docId);
    await h.service.run('bundled:scale_feed.py');
    expect(lastStatus(h).error).toBe(true);
    expect(h.requests).toHaveLength(0);
  });

  it('refuses a script that is not offered for the active profile', async () => {
    const h = await ready({
      entries: [entry('bundled:klartext.py', { meta: meta({ profiles: ['heidenhain-klartext'] }) })],
    });
    await h.service.run('bundled:klartext.py');
    expect(lastStatus(h).error).toBe(true);
    expect(lastStatus(h).text).toContain('fanuc-gcode');
    expect(h.requests).toHaveLength(0);
  });

  it('refuses a shadowed id, which the filter drops', async () => {
    const h = await ready({ entries: [entry('bundled:scale_feed.py', { shadowed: true })] });
    await h.service.run('bundled:scale_feed.py');
    expect(lastStatus(h).error).toBe(true);
    expect(h.requests).toHaveLength(0);
  });

  it('probes Python once when the answer is still unknown, and refuses when it is missing', async () => {
    const h = harness();
    await h.service.rescan();
    h.python = { ok: false, interpreter: null, version: null, message: 'python3: not found' };
    await h.service.run('bundled:scale_feed.py');
    expect(h.probes).toBe(1);
    expect(lastStatus(h)).toMatchObject({ error: true, detail: 'python3: not found' });
    expect(h.requests).toHaveLength(0);
  });

  it('does not probe again once the answer is known', async () => {
    const h = await ready();
    await h.service.run('bundled:scale_feed.py');
    expect(h.probes).toBe(0);
  });

  it('refuses a header that asks for no input and wants to replace it, before the form', async () => {
    const h = await ready({
      entries: [
        entry('user:gen.py', { meta: meta({ input: 'none', output: 'replace', params: PERCENT }) }),
      ],
    });
    await h.service.run('user:gen.py');
    expect(lastStatus(h)).toMatchObject({ error: true, text: expect.stringContaining('noInputToReplace') });
    expect(h.forms).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
    expect(h.applied).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Step 2: the parameter form
// ---------------------------------------------------------------------------

describe('ScriptService.run: parameters', () => {
  it('runs a script with no parameters immediately, with no modal', async () => {
    const h = await ready();
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.forms).toHaveLength(0);
    expect(h.requests).toHaveLength(1);
  });

  it('opens the form pre-filled from what was remembered', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    h.ui.update((state) => ({ ...state, lastParams: { [formKey('bundled:scale_feed.py')]: { percent: 90 } } }));
    h.formAnswers = [{ percent: 80 }];
    h.runs = [result({ stdout: 'N10' })];

    await h.service.run('bundled:scale_feed.py');
    expect(h.forms[0]).toMatchObject({ title: 'Scale feed rates', values: { percent: 90 } });
    expect(get(h.ui).lastParams[formKey('bundled:scale_feed.py')]).toEqual({ percent: 80 });
    const context = h.requests[0].context as ScriptContextV2;
    expect(context.params).toEqual({ percent: 80 });
  });

  it('cancelling the form cancels the run', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    h.formAnswers = [undefined];
    await h.service.run('bundled:scale_feed.py');
    expect(h.requests).toHaveLength(0);
    expect(get(runningScript)).toBeNull();
  });

  it('skipForm uses the defaults and the given values, not what was remembered', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    h.ui.update((state) => ({ ...state, lastParams: { [formKey('bundled:scale_feed.py')]: { percent: 90 } } }));
    h.runs = [result({ stdout: 'N10' })];

    await h.service.run('bundled:scale_feed.py', { skipForm: true });
    expect(h.forms).toHaveLength(0);
    expect((h.requests[0].context as ScriptContextV2).params).toEqual({ percent: 100 });
  });

  it('params without skipForm pre-fill the form', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    h.formAnswers = [{ percent: 70 }];
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py', { params: { percent: 55 } });
    expect(h.forms[0].values).toEqual({ percent: 55 });
  });
});

// ---------------------------------------------------------------------------
// Step 3 and 4: the input scope and the context
// ---------------------------------------------------------------------------

describe('ScriptService.run: the input scope', () => {
  it('sends the whole document when nothing is selected', async () => {
    const h = await ready();
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.requests[0].stdin).toBe(LINES.join('\n'));
    expect((h.requests[0].context as ScriptContextV2).input).toEqual({
      scope: 'document',
      startLine: 1,
      endLine: 6,
    });
  });

  it('sends the selection, extended to whole lines', async () => {
    const h = await ready();
    h.selection = { startLine: 3, endLine: 4, empty: false };
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.requests[0].stdin).toBe('N10 G0 X0\nN20 G1 X10. F100.');
    expect((h.requests[0].context as ScriptContextV2).input).toMatchObject({
      scope: 'selection',
      startLine: 3,
      endLine: 4,
    });
  });

  it('ignores the selection for a header that asks for the document', async () => {
    const h = await ready({
      entries: [entry('user:whole.py', { meta: meta({ input: 'document', output: 'panel' }) })],
    });
    h.selection = { startLine: 3, endLine: 4, empty: false };
    await h.service.run('user:whole.py');
    expect((h.requests[0].context as ScriptContextV2).input).toMatchObject({ scope: 'document' });
  });

  it('refuses a header that asks for a selection when there is none', async () => {
    const h = await ready({
      entries: [entry('user:sel.py', { meta: meta({ input: 'selection', output: 'panel' }) })],
    });
    await h.service.run('user:sel.py');
    expect(lastStatus(h).error).toBe(true);
    expect(h.requests).toHaveLength(0);
  });

  it('sends nothing for a header that asks for no input', async () => {
    const h = await ready({
      entries: [entry('user:gen.py', { meta: meta({ input: 'none', output: 'new-document' }) })],
    });
    await h.service.run('user:gen.py');
    expect(h.requests[0].stdin).toBe('');
    expect((h.requests[0].context as ScriptContextV2).input).toEqual({
      scope: 'none',
      startLine: 0,
      endLine: 0,
    });
  });

  it('takes the scope from the moment the command was invoked, not after the form', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    h.selection = { startLine: 3, endLine: 4, empty: false };
    h.formAnswers = [{ percent: 90 }];
    h.runs = [result({ stdout: 'N10\nN20' })];
    // The modal took the focus and the selection went away while it was open.
    h.duringForm = () => {
      h.selection = null;
    };
    await h.service.run('bundled:scale_feed.py');
    expect((h.requests[0].context as ScriptContextV2).input).toMatchObject({
      scope: 'selection',
      startLine: 3,
      endLine: 4,
    });
  });

  it('carries the lines above a selection so the script can prime its modal state', async () => {
    const h = await ready();
    h.selection = { startLine: 4, endLine: 5, empty: false };
    h.runs = [result({ stdout: 'N20\nN30' })];
    await h.service.run('bundled:scale_feed.py');
    expect((h.requests[0].context as ScriptContextV2).input.precedingLines).toEqual(
      LINES.slice(0, 3),
    );
  });

  it('carries none for a whole-document run, which already sees everything', async () => {
    const h = await ready();
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect((h.requests[0].context as ScriptContextV2).input.precedingLines).toBeUndefined();
  });

  it('describes the document and the caret', async () => {
    const h = await ready();
    h.cursor = { line: 4, column: 12, selectedChars: 0, selections: 1 };
    await h.service.run('bundled:scale_feed.py');
    const context = h.requests[0].context as ScriptContextV2;
    expect(context.contract).toBe(2);
    expect(context.document).toMatchObject({
      path: '/jobs/part42.nc',
      name: 'part42.nc',
      profile: 'fanuc-gcode',
      encoding: 'utf-8',
      lineEnding: 'crlf',
    });
    expect(context.cursor).toEqual({ line: 4, column: 12 });
    expect(context.profile.id).toBe('fanuc-gcode');
    expect(context.codes).toHaveLength(1);
  });

  it('leaves the timeout to Rust', async () => {
    const h = await ready();
    await h.service.run('bundled:scale_feed.py');
    expect(h.requests[0].timeoutSecs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Steps 6 to 8: the run and what it is allowed to do
// ---------------------------------------------------------------------------

describe('ScriptService.run: applying the result', () => {
  it('replaces the scope as one call, and says how much changed', async () => {
    const h = await ready();
    h.selection = { startLine: 3, endLine: 4, empty: false };
    h.runs = [result({ stdout: 'N10 G0 X0\nN20 G1 X10. F90.\n' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.applied).toEqual([
      {
        id: h.docId,
        startLine: 3,
        endLine: 4,
        lines: ['N10 G0 X0', 'N20 G1 X10. F90.'],
      },
    ]);
    expect(lastStatus(h)).toMatchObject({
      error: false,
      text: expect.stringContaining('"count":2'),
    });
  });

  it('says so when the script changed nothing', async () => {
    const h = await ready();
    h.applyLinesAnswer = 0;
    h.runs = [result({ stdout: LINES.join('\n') })];
    await h.service.run('bundled:scale_feed.py');
    expect(lastStatus(h).text).toContain('appliedNone');
  });

  it('shows the script’s own message next to the summary', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ envelope: true }) })],
    });
    h.runs = [result({ stdout: JSON.stringify({ text: 'N10', message: '3 feeds scaled' }) })];
    await h.service.run('bundled:scale_feed.py');
    expect(lastStatus(h).text).toContain('3 feeds scaled');
  });

  it('puts an envelope’s findings in the Results panel, pointing at this document', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ envelope: true }) })],
    });
    h.runs = [
      result({
        stdout: JSON.stringify({
          text: 'N10',
          message: '1 skipped',
          findings: [{ line: 12, message: 'G84: pitch feed', severity: 'warning' }],
        }),
      }),
    ];
    await h.service.run('bundled:scale_feed.py');
    expect(get(results.current)).toMatchObject({
      title: 'Scale feed rates',
      message: '1 skipped',
      docId: h.docId,
      findings: [{ line: 12, message: 'G84: pitch feed', severity: 'warning' }],
    });
  });

  it('clears its own previous report when the next run has nothing to say', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ envelope: true }) })],
    });
    h.runs = [
      result({ stdout: JSON.stringify({ text: 'N10', findings: [{ line: 1, message: 'x' }] }) }),
      result({ stdout: JSON.stringify({ text: 'N10' }) }),
    ];
    await h.service.run('bundled:scale_feed.py');
    expect(get(results.current)).not.toBeNull();
    await h.service.run('bundled:scale_feed.py');
    expect(get(results.current)).toBeNull();
  });

  it('leaves somebody else’s report alone', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ envelope: true }) })],
    });
    h.runs = [result({ stdout: JSON.stringify({ text: 'N10' }) })];
    const other = { title: 'Renumber', columns: [], rows: [] };
    results.show(other);
    await h.service.run('bundled:scale_feed.py');
    expect(get(results.current)).toBe(other);
  });

  it('opens a new document for a new-document script, with the same profile', async () => {
    const h = await ready({
      entries: [entry('user:gen.py', { meta: meta({ output: 'new-document' }) })],
    });
    h.runs = [result({ stdout: 'N10 G0\n' })];
    await h.service.run('user:gen.py');
    expect(h.created).toEqual([{ profileId: 'fanuc-gcode', text: 'N10 G0' }]);
    expect(h.applied).toHaveLength(0);
  });

  it('sends a report to the Results panel with the document it ran on', async () => {
    const h = await ready({
      entries: [entry('bundled:tool_list.py', { meta: meta({ name: 'Tool list', output: 'report' }) })],
    });
    h.runs = [
      result({
        stdout: JSON.stringify({
          title: 'Tool list',
          columns: [{ key: 'tool', label: 'T' }],
          rows: [{ tool: 1 }],
        }),
      }),
    ];
    await h.service.run('bundled:tool_list.py');
    expect(get(results.current)).toMatchObject({ title: 'Tool list', docId: h.docId });
    expect(h.applied).toHaveLength(0);
  });

  it('opens the Output panel with a panel-mode run, before it starts', async () => {
    const h = await ready({
      entries: [entry('user:info.py', { meta: meta({ output: 'panel' }) })],
    });
    h.runs = [result({ stdout: 'hello' })];
    await h.service.run('user:info.py');
    expect(h.shown).toEqual([SCRIPT_OUTPUT_PANEL]);
    expect(get(scriptOutput)).toMatchObject({ stdout: 'hello', scriptName: 'Scale feed rates' });
  });

  it('leaves the layout alone for a replace run that worked', async () => {
    const h = await ready();
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.shown).toEqual([]);
  });

  it('keeps stdout, stderr and the timings of every run for the panel', async () => {
    const h = await ready();
    h.runs = [result({ stdout: 'N10', stderr: 'note\n', durationMs: 91 })];
    await h.service.run('bundled:scale_feed.py');
    expect(get(scriptOutput)).toMatchObject({
      scriptId: 'bundled:scale_feed.py',
      stderr: 'note\n',
      durationMs: 91,
      interpreter: '/usr/bin/python3',
    });
  });

  it('parses stdout for the panel only when it looks like a result', async () => {
    const h = await ready({ entries: [entry('user:info.py', { meta: meta({ output: 'panel' }) })] });
    h.runs = [result({ stdout: '{"tools":2}' })];
    await h.service.run('user:info.py');
    expect(get(scriptOutput)?.json).toEqual({ tools: 2 });

    h.runs = [result({ stdout: 'N10 G0 X0' })];
    await h.service.run('user:info.py');
    expect(get(scriptOutput)?.json).toBeNull();
  });
});

describe('ScriptService.run: failures are visible and apply nothing', () => {
  it('applies nothing on a non-zero exit, and shows stderr', async () => {
    const h = await ready();
    h.runs = [result({ success: false, exitCode: 1, stdout: 'N10', stderr: 'Traceback…' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.applied).toHaveLength(0);
    expect(lastStatus(h)).toMatchObject({ error: true, detail: 'Traceback…' });
    expect(h.shown).toEqual([SCRIPT_OUTPUT_PANEL]);
  });

  it('applies nothing on a timeout', async () => {
    const h = await ready();
    h.runs = [result({ success: false, exitCode: null, timedOut: true, stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.applied).toHaveLength(0);
    expect(lastStatus(h).error).toBe(true);
  });

  it('applies nothing when stdout is empty', async () => {
    const h = await ready();
    h.runs = [result({ stdout: '' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.applied).toHaveLength(0);
    expect(lastStatus(h).error).toBe(true);
  });

  it('reports a run that never started, and clears the running flag', async () => {
    const h = await ready();
    h.runs = [new Error('no such script id')];
    await expect(h.service.run('bundled:scale_feed.py')).resolves.toBeUndefined();
    expect(get(runningScript)).toBeNull();
    expect(lastStatus(h)).toMatchObject({ error: true, detail: 'no such script id' });
    expect(h.shown).toEqual([SCRIPT_OUTPUT_PANEL]);
  });
});

describe('ScriptService.run: the stale guard', () => {
  it('applies nothing when the document changed during the run, and offers a new tab', async () => {
    const h = await ready();
    h.duringRun = () => {
      h.version += 1;
    };
    h.runs = [result({ stdout: 'N10 G1 F90.' })];
    h.confirmAnswers = [true];

    await h.service.run('bundled:scale_feed.py');
    expect(h.applied).toHaveLength(0);
    expect(h.confirms).toHaveLength(1);
    expect(h.created).toEqual([{ profileId: 'fanuc-gcode', text: 'N10 G1 F90.' }]);
  });

  it('says so when the user declines the new tab', async () => {
    const h = await ready();
    h.duringRun = () => {
      h.version += 1;
    };
    h.runs = [result({ stdout: 'N10 G1 F90.' })];
    h.confirmAnswers = [false];

    await h.service.run('bundled:scale_feed.py');
    expect(h.created).toHaveLength(0);
    expect(lastStatus(h).error).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The running flag, the last script, cancel
// ---------------------------------------------------------------------------

describe('ScriptService: the run in flight', () => {
  it('publishes the run while it lasts and clears it afterwards', async () => {
    const h = await ready();
    const seen: (string | null)[] = [];
    h.duringRun = () => seen.push(get(runningScript)?.runId ?? null);
    h.runs = [result({ stdout: 'N10' })];

    await h.service.run('bundled:scale_feed.py');
    expect(seen).toEqual(['run-1']);
    expect(get(runningScript)).toBeNull();
  });

  it('cancels the run in flight by its id', async () => {
    const h = await ready();
    h.duringRun = () => {
      void h.service.cancel();
    };
    h.runs = [result({ success: false, cancelled: true, exitCode: null })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.cancels).toEqual(['run-1']);
    expect(h.applied).toHaveLength(0);
    expect(lastStatus(h).error).toBe(true);
  });

  it('cancelling with nothing running is harmless', async () => {
    const h = await ready();
    await expect(h.service.cancel()).resolves.toBeUndefined();
    expect(h.cancels).toEqual([]);
    expect(h.status).toHaveLength(0);
  });

  // G8 M5. `RunRegistry::cancel` finds no entry once the child has exited and answers
  // `false`, and Rust then drains the pipes for a grace period, so a Stop click can land
  // after the script's last write. The run still answered exit 0 with a perfectly good
  // program on stdout — and it must not reach the document, because a stopped run
  // changing nothing is what the Stop button and the user guide promise.
  it('applies nothing when Stop lost the race with the process exit', async () => {
    const h = await ready();
    h.selection = { startLine: 3, endLine: 4, empty: false };
    h.duringRun = () => {
      void h.service.cancel();
    };
    // The backend says the kill did not land and the run finished normally.
    h.cancelAnswer = false;
    h.runs = [result({ success: true, exitCode: 0, stdout: 'N10 G0 X0\nN20 G1 X10. F90.' })];

    await h.service.run('bundled:scale_feed.py');

    expect(h.cancels).toEqual(['run-1']);
    expect(h.applied).toHaveLength(0);
    expect(lastStatus(h)).toMatchObject({ error: true, text: 'scripts.errCancelled' });
    // What the script produced is still readable, just not written into the program.
    expect(get(scriptOutput)).toMatchObject({ stdout: 'N10 G0 X0\nN20 G1 X10. F90.' });
  });

  it('forgets the cancel once the run is over, so the next run is applied', async () => {
    const h = await ready();
    h.duringRun = () => {
      void h.service.cancel();
    };
    h.cancelAnswer = false;
    h.runs = [result({ stdout: 'N10' }), result({ stdout: 'N10' })];

    await h.service.run('bundled:scale_feed.py');
    expect(h.applied).toHaveLength(0);

    h.duringRun = null;
    await h.service.run('bundled:scale_feed.py');
    expect(h.applied).toHaveLength(1);
  });

  // G8 M5. `runningScript` is only set at step 5, and the steps before it await — the
  // Python probe is a real IPC round trip whenever the status is still unknown, which is
  // the state the app starts in. A second F9 in that window used to start a second run.
  it('refuses a second run started while the first is still asking for Python', async () => {
    const h = harness();
    await h.service.rescan();
    // `pythonStatus` is null, so the probe is awaited — the window the guard missed.
    let releaseProbe = (): void => {};
    const probed = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const realCheck = h.python;
    h.probeGate = probed;
    h.runs = [result({ stdout: 'N10' }), result({ stdout: 'N10' })];

    const first = h.service.run('bundled:scale_feed.py');
    const second = h.service.run('bundled:scale_feed.py');
    releaseProbe();
    await Promise.all([first, second]);

    expect(realCheck.ok).toBe(true);
    expect(h.requests).toHaveLength(1);
    expect(h.status.some((entry) => entry.text === 'scripts.busy' && entry.error)).toBe(true);
    expect(get(runningScript)).toBeNull();
  });

  it('lets the slot go again once the run is finished', async () => {
    const h = await ready();
    h.runs = [result({ stdout: 'N10' }), result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    await h.service.run('bundled:scale_feed.py');
    expect(h.requests).toHaveLength(2);
  });

  it('lets the slot go when the run was refused before it started', async () => {
    const h = await ready();
    await h.service.run('user:gone.py');
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect(h.requests).toHaveLength(1);
  });
});

describe('ScriptService.runLast', () => {
  it('remembers the script that ran, in the session and in the state file', async () => {
    const h = await ready();
    h.runs = [result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    expect(get(lastScriptId)).toBe('bundled:scale_feed.py');
    expect(get(h.ui).lastScript).toBe('bundled:scale_feed.py');
  });

  it('repeats it with the values it was last given, and no form', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    h.formAnswers = [{ percent: 80 }];
    h.runs = [result({ stdout: 'N10' }), result({ stdout: 'N10' })];
    await h.service.run('bundled:scale_feed.py');
    await h.service.runLast();

    expect(h.forms).toHaveLength(1);
    expect((h.requests[1].context as ScriptContextV2).params).toEqual({ percent: 80 });
  });

  // G8 M5. The form's pre-fill drops a remembered value whose type no longer suits its
  // field (`initialValues`); `runLast` used to spread the raw record over the defaults and
  // hand the script exactly what the form had just discarded. The two ways in have to
  // agree about the same stored record.
  it('filters the remembered values through the field specs, as the form does', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    // What a hand-edited state file, or a header that changed `percent` from text to
    // number, leaves behind — plus a key that is not a field at all.
    h.ui.update((state) => ({
      ...state,
      lastParams: { [formKey('bundled:scale_feed.py')]: { percent: 'ninety', stray: 1 } },
    }));
    lastScriptId.set('bundled:scale_feed.py');
    h.runs = [result({ stdout: 'N10' })];

    await h.service.runLast();

    expect(h.forms).toHaveLength(0);
    expect((h.requests[0].context as ScriptContextV2).params).toEqual({ percent: 100 });
  });

  it('keeps a remembered value that still suits its field', async () => {
    const h = await ready({
      entries: [entry('bundled:scale_feed.py', { meta: meta({ params: PERCENT }) })],
    });
    h.ui.update((state) => ({
      ...state,
      lastParams: { [formKey('bundled:scale_feed.py')]: { percent: 90 } },
    }));
    lastScriptId.set('bundled:scale_feed.py');
    h.runs = [result({ stdout: 'N10' })];

    await h.service.runLast();
    expect((h.requests[0].context as ScriptContextV2).params).toEqual({ percent: 90 });
  });

  it('says so when nothing has run yet', async () => {
    const h = await ready();
    await h.service.runLast();
    expect(lastStatus(h).error).toBe(true);
    expect(h.requests).toHaveLength(0);
  });

  it('goes through the profile filter like every other way in', async () => {
    const h = await ready({
      entries: [entry('user:klartext.py', { meta: meta({ profiles: ['heidenhain-klartext'] }) })],
    });
    lastScriptId.set('user:klartext.py');
    await h.service.runLast();
    expect(lastStatus(h).error).toBe(true);
    expect(h.requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The message table WP5.2 writes its namespace against
// ---------------------------------------------------------------------------

describe('SCRIPT_STATUS_KEYS', () => {
  it('is a closed list of distinct keys in the scripts namespace', () => {
    expect(SCRIPT_STATUS_KEYS.length).toBeGreaterThan(0);
    expect(new Set(SCRIPT_STATUS_KEYS).size).toBe(SCRIPT_STATUS_KEYS.length);
    expect(SCRIPT_STATUS_KEYS.every((key) => key.startsWith('scripts.'))).toBe(true);
  });
});
