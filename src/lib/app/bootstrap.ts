// Starting the app (plan §5 WP1.5). Owner: WP1.5 in M1; the prelude owns this file from
// M2 on (plan §4.2), so the exported names stay.
//
// The order is fixed:
//   1. set the command context provider
//   2. load the contributions (this is where the initial untitled document appears, WP1.6)
//   3. install the window key dispatcher
//   4. watch the state behind the context, so the ribbon re-evaluates enablement
//   5. install the test hook
//   6. once Monaco is up, install the Monaco bridge and flip `appReady` (`data-ready="1"`)
//
// Step 6 is deliberately NOT awaited before the rest: `editor.ready` only resolves after
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
import { profiles } from '$lib/stores/profiles';
import { files } from '$lib/app/fileOps';
import { isScriptRunning, scriptRunning } from '$lib/components/panels/scriptsV1State';
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
    scriptRunning.subscribe(notify),
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
  loadContributions: () => Promise<Disposable>;
  installDispatcher: () => Disposable;
  watchContext: (notify: () => void) => Disposable;
  notifyContextChanged: () => void;
  /** Resolves once Monaco is loaded; rejects when it cannot be. */
  monacoReady: () => Promise<Monaco>;
  installMonacoBridge: (monaco: Monaco) => Disposable;
  installTestHook: (hook: GeditTestHook) => void;
  buildTestHook: (ready: Promise<void>) => GeditTestHook;
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
  setReady: (value) => ready.set(value),
});
