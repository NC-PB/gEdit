// Starting the app (plan §5 WP1.5). Owner: WP1.5 in M1; the prelude owns this file from
// M2 on (plan §4.2), so the exported names stay.
//
// The order is fixed:
//   1. set the command context provider
//   2. read settings.json, state.json and machines.json (P2, P6): the contributions build
//      their commands and panels from the effective settings and restore the saved
//      layout, so both have to be in memory first, and the machines have to be there
//      before the first document opens — otherwise its effective view would be built
//      without them and every consumer would have to re-evaluate. None of the three may
//      throw — a broken file falls back to the defaults and the store shows the notice —
//      so a failure here is logged and startup continues.
//   3. load the contributions (this is where the initial untitled document appears, WP1.6)
//   4. install the window key dispatcher
//   5. watch the state behind the context, so the ribbon re-evaluates enablement
//   6. install the test hook
//   7. probe Python (P5), detached
//   8. once Monaco is up, install the Monaco bridge and flip `appReady` (`data-ready="1"`)
//
// Step 7 spawns a process, so it is fired and not awaited: it must not delay `data-ready`,
// and its answer only decides whether the script commands are enabled. It runs after the
// first render and even when Monaco never loads, because "is there a Python" is shell
// state, not editor state. `ScriptService.checkPython` is contracted never to reject; the
// `catch` here is the belt to that braces.
//
// Step 8 is deliberately NOT awaited before the rest: `editor.ready` only resolves after
// `EditorHost` has called `attach()`, so awaiting it first would deadlock the shell it is
// waiting for. It rejects when Monaco cannot load; the shell keeps working without an
// editor and `data-ready` stays "0", which is what the M0 build did too.
//
// `createStartApp(deps)` plus a default singleton wired to the real modules (AD-2), so a
// unit test can watch the order without Monaco, Tauri or a DOM.

import { derived, get, writable } from 'svelte/store';
import { notifyContextChanged, setContextProvider } from '$lib/app/registry/commands';
import { loadContributions } from '$lib/app/contributions';
import { installDispatcher } from '$lib/app/keys/dispatcher';
import { installMonacoBridge } from '$lib/app/keys/monacoBridge';
import { modals } from '$lib/app/modals';
import { ctx } from '$lib/app/context';
import { installTestHook, type GeditTestHook } from '$lib/app/testHook';
import { editor } from '$lib/monaco/editorService';
import { getMonaco, type Monaco } from '$lib/monaco/setup';
import { docs } from '$lib/stores/documents';
import { layout } from '$lib/stores/layout';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { settings } from '$lib/stores/settings';
import { loadConfigOnce, uiState } from '$lib/stores/uiState';
import { isTauriRuntime } from '$lib/utils/platform';
import { files } from '$lib/app/fileOps';
import { scripts } from '$lib/app/scripts';
import { isScriptRunning, runningScript } from '$lib/stores/scripts';
import type { CommandContext, Disposable } from '$lib/app/types';

const ready = writable(false);

/** True once the contributions are loaded and the editor is up; drives `data-ready`. */
export const appReady = derived(ready, (value) => value);

// ---------------------------------------------------------------------------
// The command context
// ---------------------------------------------------------------------------

/** What `CommandDef.enabled` and `run` see (plan §7.1). Read on every enablement check. */
export function commandContext(): CommandContext {
  const activeDocId = docs.getActiveId();
  const doc = activeDocId === null ? undefined : docs.get(activeDocId);
  // `selectionLines()` answers with a flag; `selectedText()` would copy the selection.
  const selection = editor.selectionLines();
  return {
    activeDocId,
    profileId: doc?.profileId ?? null,
    hasSelection: selection !== null && !selection.empty,
    editorFocused: editor.hasFocus(),
    compareOpen: get(layout.state).overlay !== null,
    modalOpen: get(modals.isOpen),
    scriptRunning: isScriptRunning(),
  };
}

/**
 * Bumps `commands.changed` whenever the state behind `commandContext()` changes (WP1.1
 * D1: the provider is a pull function, so the registry has to be told). Cursor moves are
 * already throttled to one animation frame by the editor service.
 */
export function watchContext(notify: () => void): Disposable {
  const stops: Disposable[] = [
    docs.list.subscribe(notify),
    docs.activeId.subscribe(notify),
    layout.state.subscribe(notify),
    modals.isOpen.subscribe(notify),
    runningScript.subscribe(notify),
    editor.onDidChangeCursor(notify),
    editor.onDidActivate(notify),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

// ---------------------------------------------------------------------------
// The test hook
// ---------------------------------------------------------------------------

/** The `window.__gedit` surface (§7.9). Only a `VITE_GEDIT_TEST=1` build installs it. */
export function buildTestHook(readyPromise: Promise<void>): GeditTestHook {
  return {
    ready: readyPromise,
    version: __APP_VERSION__,
    text(): string {
      const id = docs.getActiveId();
      return id !== null && editor.hasModel(id) ? editor.getText(id) : '';
    },
    cursor(): { line: number; column: number } {
      const info = editor.cursor();
      return { line: info?.line ?? 1, column: info?.column ?? 1 };
    },
    activeProfile(): string {
      const id = docs.getActiveId();
      return (id === null ? undefined : docs.get(id)?.profileId) ?? '';
    },
    setProfile(id: string): void {
      if (profiles.get(id) === undefined) throw new Error(`Unknown profile: ${id}`);
      const docId = docs.getActiveId();
      if (docId === null) throw new Error('There is no active document');
      files.setProfile(docId, id);
    },
    ctx,
  };
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

export interface BootstrapDeps {
  setContextProvider: (fn: () => CommandContext) => void;
  commandContext: () => CommandContext;
  /** `settings.load()` (WP2.6); the result is the store's to report, not ours. */
  loadSettings: () => Promise<unknown>;
  /** `uiState.load()` (WP2.3). */
  loadUiState: () => Promise<unknown>;
  /** `machines.load(configLoad)` (P6, §7.15): the same round trip, no second read. */
  loadMachines: () => Promise<unknown>;
  loadContributions: () => Promise<Disposable>;
  installDispatcher: () => Disposable;
  watchContext: (notify: () => void) => Disposable;
  notifyContextChanged: () => void;
  /** Resolves once Monaco is loaded; rejects when it cannot be. */
  monacoReady: () => Promise<Monaco>;
  installMonacoBridge: (monaco: Monaco) => Disposable;
  installTestHook: (hook: GeditTestHook) => void;
  buildTestHook: (ready: Promise<void>) => GeditTestHook;
  /** `scripts.checkPython()` (WP5.1). Fired, not awaited; see the header. */
  checkPython: () => Promise<unknown>;
  setReady: (value: boolean) => void;
}

/** The context the registry falls back to once the app is torn down again. */
const EMPTY_CONTEXT: CommandContext = {
  activeDocId: null,
  profileId: null,
  hasSelection: false,
  editorFocused: false,
  compareOpen: false,
  modalOpen: false,
  scriptRunning: false,
};

/**
 * Step 2: `settings.json` and `state.json`, in that order (settings decide how much of
 * the UI state is honoured). A rejection is logged and swallowed, because the app has to
 * start even when the config folder is unreadable.
 */
async function loadPersisted(
  deps: Pick<BootstrapDeps, 'loadSettings' | 'loadUiState' | 'loadMachines'>,
): Promise<void> {
  try {
    await deps.loadSettings();
  } catch (err) {
    console.error('settings could not be loaded; using the defaults', err);
  }
  try {
    await deps.loadUiState();
  } catch (err) {
    console.error('the saved UI state could not be loaded', err);
  }
  try {
    await deps.loadMachines();
  } catch (err) {
    // The machine service reports a broken file itself; a rejection here means the
    // round trip failed, and a document then runs on its profile's defaults.
    console.error('the machine configurations could not be loaded', err);
  }
}

export function createStartApp(deps: BootstrapDeps): () => Promise<Disposable> {
  return async function startApp(): Promise<Disposable> {
    let disposed = false;
    const disposers: Disposable[] = [];
    const add = (d: Disposable): void => {
      if (disposed) d();
      else disposers.push(d);
    };

    deps.setContextProvider(deps.commandContext);
    add(() => deps.setContextProvider(() => EMPTY_CONTEXT));

    // Persisted state first: the contributions read the effective settings while they
    // register, and `layoutPersist` (WP2.3) restores the layout from `uiState` in its
    // `activate()`. Both loaders own their own error reporting and are contracted not to
    // throw; a broken one must still leave a usable editor behind.
    await loadPersisted(deps);

    add(await deps.loadContributions());
    add(deps.installDispatcher());
    add(deps.watchContext(deps.notifyContextChanged));

    let markReady: () => void = () => {};
    let failReady: (err: unknown) => void = () => {};
    const readyPromise = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failReady = reject;
    });
    // The hook hands this promise to the harness, which may never await it.
    void readyPromise.catch(() => {});

    deps.installTestHook(deps.buildTestHook(readyPromise));

    // Step 7: the interpreter probe. Detached on purpose — it spawns a process, and
    // nothing before `data-ready` depends on the answer.
    void Promise.resolve()
      .then(() => deps.checkPython())
      .catch((err: unknown) => {
        console.error('the Python check failed', err);
      });

    void deps.monacoReady().then(
      (monaco) => {
        add(deps.installMonacoBridge(monaco));
        if (disposed) return;
        deps.setReady(true);
        markReady();
      },
      (err: unknown) => {
        // EditorHost already shows the load error; nothing here can recover from it.
        failReady(err);
      },
    );

    return () => {
      if (disposed) return;
      disposed = true;
      deps.setReady(false);
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch (err) {
          console.error('shutdown step failed', err);
        }
      }
      disposers.length = 0;
    };
  };
}

/** Starts the real app. `AppShell` calls this once, in `onMount`. */
export const startApp: () => Promise<Disposable> = createStartApp({
  setContextProvider,
  commandContext,
  loadSettings: () => settings.load(),
  loadUiState: () => uiState.load(),
  loadMachines: async () => {
    // `loadConfigOnce` is the memo behind `settings.load()`, so this is the same
    // `config_load` answer, not a second round trip (AD-8 allows exactly one).
    if (!isTauriRuntime()) return;
    machines.load(await loadConfigOnce());
  },
  loadContributions,
  installDispatcher,
  watchContext,
  notifyContextChanged,
  // `editor.ready` resolves once EditorHost has attached; Monaco itself is then loaded,
  // so `getMonaco()` is already settled and adds no extra wait. It resolves on the FIRST
  // attach that works and never rejects, so a transient load failure followed by a
  // remount still installs the bridge (G8). While Monaco cannot be loaded at all it stays
  // pending — the shell runs, EditorHost shows the load error, and `data-ready` is "0".
  monacoReady: async () => {
    await editor.ready;
    return getMonaco();
  },
  installMonacoBridge,
  installTestHook,
  buildTestHook,
  checkPython: () => scripts.checkPython(),
  setReady: (value) => ready.set(value),
});
