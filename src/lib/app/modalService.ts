// The modal state of every open document (Phase 3 plan §6.2, AD-33). Written by the Phase 3
// prelude (P3a) as a stub; implemented by P3.1. The contract is `ModalService` in
// `app/types.ts`; in short:
//
//   1. one `ModalIndex` (`core/nc/modal.ts`) per open document, built with the document's
//      effective compiled profile and database (`machines.effective(docId)`, AD-31);
//   2. an edit calls `applyChange(firstChangedLine, …)` at once (it only drops snapshots),
//      and the rest is rebuilt by `buildSome(8)` from `requestIdleCallback` (a `setTimeout`
//      where there is none, which is the shipped macOS webview), one document per idle
//      callback, the active one first;
//   3. a change of the effective key (`machines.revision`, `profiles.revision`, a dialect
//      switch, a variant the program's text now detects) rebuilds the document's index from
//      scratch; a closed document drops it;
//   4. `changed` bumps after every one of these, so the inspector, the hover and the motion
//      colours ask again instead of holding a stale state;
//   5. nothing here blocks: a state the index has not reached is `null`;
//   6. `changed` is global and bumps for every slice of every document, so a reader cannot tell
//      from it whether its answer can differ. `revisionOf(id)` can: it changes on an edit, a
//      rebuild and when a slice reaches a line a reader asked for and got `null` for, and
//      never for the slice of another document or one that moves the build on unseen;
//   7. a model that is only queued (Monaco is not attached yet) is not loaded: reading it
//      costs the whole text per call, and Monaco's own model replaces it (and fires
//      `onDidCreateModel`) before anything could use the index; a `.json` or `.py` document
//      (a profile, a code file, a script) is not an NC program and gets no index.
//
// The key is re-read on the revisions and on the document list (a dialect switch), and once
// after a pause in typing (`KEY_CHECK_DELAY_MS`): a variant the machine leaves to detection
// (a lathe's G-code system) can change with the text, and asking `machines.effective` on
// every keystroke would run the detection over the whole program each time.
//
// `createModalService(deps)` plus the singleton wired to the real modules (AD-2), so a unit
// test drives it with a fake editor and a fake clock; `contrib/modal.ts` calls `start()`.

import { writable, type Readable } from 'svelte/store';
import { ModalIndex, SNAPSHOT_EVERY } from '$lib/core/nc/modal';
import { isNcDocumentPath } from '$lib/core/profiles/ncDocument';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import { profiles as appProfiles } from '$lib/stores/profiles';
import type { CodeDb } from '$lib/core/codes/types';
import type { ModalState } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { Disposable, DocId, DocumentStore, EditorService, ModalService } from '$lib/app/types';

/** The most one idle callback spends on building (AD-33, X17: "idle chunks of ≤ 8 ms"). */
export const IDLE_BUDGET_MS = 8;
/** How long after the last edit the document's effective key is read again. */
export const KEY_CHECK_DELAY_MS = 300;

/** One document's effective view as the index is built from it. */
export interface ModalView {
  cp: CompiledProfile;
  db: CodeDb;
  /** `EffectiveMachine.key`: the profile and every machine parameter, variants included. */
  key: string;
}

export interface ModalServiceDeps {
  docs: Pick<DocumentStore, 'get' | 'list' | 'getActiveId'>;
  /** `model` is the realized-model test: a queued model (`hasModel`) is not one. */
  editor: Pick<EditorService, 'model' | 'getLineCount' | 'getLines' | 'onDidChangeContent' | 'onDidCreateModel'>;
  /** The document's effective view, or null while the document or its profile is unknown. */
  effective(id: DocId): ModalView | null;
  /** `machines.revision`: a machine, a document's choice or a variant changed. */
  machineRevision?: Readable<number>;
  /** `profiles.revision`: a reload compiled every profile again (AD-29). */
  profileRevision?: Readable<number>;
  /** Runs `fn` when the app is idle (`requestIdleCallback`, else a timer one frame away). */
  idle(fn: () => void): Disposable;
  /** `setTimeout`, as a canceller. */
  schedule(fn: () => void, ms: number): Disposable;
  budgetMs?: number;
  keyCheckDelayMs?: number;
  /** Lines between two snapshots (tests use a few; the app the index's default). */
  every?: number;
}

/** The service, plus the start the contribution calls. */
export type ModalServiceInternals = ModalService & {
  /** Installs the listeners; the returned disposer drops them and every index. */
  start(): Disposable;
};

interface Entry {
  id: DocId;
  /** The view the index was built from; null while the document's profile is unknown. */
  view: ModalView | null;
  index: ModalIndex | null;
  /** The editor has a realized model of the document; before that there is nothing to build. */
  loaded: boolean;
  /** The number `revisionOf` answers. */
  revision: number;
  /** The lines the index was last told the document has. */
  lineCount: number;
  /** The snapshot numbers readers asked for and got `null`; a slice that reaches the lowest one bumps `revision`. */
  waiting: Set<number>;
  ready: Promise<void>;
  markReady: () => void;
  /** `ready` has resolved; the next edit that leaves work arms a new promise. */
  settled: boolean;
  /** The pending key check after an edit. */
  keyCheck: Disposable | null;
}

export function createModalService(deps: ModalServiceDeps): ModalServiceInternals {
  const entries = new Map<DocId, Entry>();
  const changed = writable(0);
  const budget = deps.budgetMs ?? IDLE_BUDGET_MS;
  const keyDelay = deps.keyCheckDelayMs ?? KEY_CHECK_DELAY_MS;
  const every = deps.every ?? SNAPSHOT_EVERY;
  let stops: Disposable[] = [];
  let installed = false;
  let pending: Disposable | null = null;

  const bump = (): void => changed.update((n) => n + 1);

  /** Readers must ask again: an edit, a rebuild. Nothing they waited for is waited for any more. */
  function revise(entry: Entry): void {
    entry.revision++;
    entry.waiting.clear();
  }

  /** A reader asked for `line` and got `null` for it: remember which snapshot would answer. */
  function wait(entry: Entry, line: number): void {
    if (!Number.isInteger(line) || line < 0 || line > entry.lineCount) return; // never answerable until an edit
    // The index answers the line of a snapshot from the one before it when only that one is valid (CODE-8), so a reader
    // that waits for line k·every needs snapshot k-1 and no more.
    const k = Math.floor(line / every);
    entry.waiting.add(line === k * every && k >= 1 ? k - 1 : k);
  }

  /**
   * After a slice: have the snapshots reached the lowest one a reader waits for? A snapshot is
   * valid only if every one below it is, so the lowest is the one to look at; the question is
   * asked of the line right after the snapshot (the snapshot line itself is answered from the
   * snapshot before it), which replays nothing.
   */
  function reached(entry: Entry): boolean {
    if (entry.index === null || entry.waiting.size === 0) return false;
    let any = false;
    for (;;) {
      let lowest = Infinity;
      for (const k of entry.waiting) lowest = Math.min(lowest, k);
      if (lowest === Infinity || entry.index.stateAfter(lowest === 0 ? 0 : lowest * every + 1) === null) return any;
      entry.waiting.delete(lowest);
      any = true;
    }
  }

  function lineOf(id: DocId): (n: number) => string {
    return (n) => deps.editor.getLines(id, n, n)[0] ?? '';
  }

  function arm(entry: Entry): void {
    if (!entry.settled) return; // the pending promise still waits for this build
    entry.settled = false;
    entry.ready = new Promise<void>((resolve) => {
      entry.markReady = () => {
        entry.settled = true;
        resolve();
      };
    });
  }

  /** Resolves `ready` once the index covers the document (or there is nothing to cover). */
  function settleIfReady(entry: Entry): void {
    if (entry.settled || !entry.loaded) return;
    if (entry.index === null || entry.index.ready()) entry.markReady();
  }

  function needsWork(entry: Entry): boolean {
    return entry.loaded && entry.index !== null && !entry.index.ready();
  }

  function schedulePump(): void {
    if (pending !== null || !installed) return;
    if (![...entries.values()].some(needsWork)) return;
    pending = deps.idle(pump);
  }

  /** One idle callback: one slice of one document, the active one first. */
  function pump(): void {
    pending = null;
    const active = deps.docs.getActiveId();
    const first = active !== null ? entries.get(active) : undefined;
    const entry = first !== undefined && needsWork(first) ? first : [...entries.values()].find(needsWork);
    if (entry === undefined || entry.index === null) return;
    entry.index.buildSome(budget);
    if (reached(entry)) entry.revision++;
    settleIfReady(entry);
    bump();
    schedulePump();
  }

  /** Starts the document's index over from its text (a new model, a flush, a new key). */
  function restart(entry: Entry): void {
    entry.loaded = deps.editor.model(entry.id) !== undefined;
    entry.lineCount = entry.loaded ? deps.editor.getLineCount(entry.id) : 0;
    if (entry.index !== null) {
      arm(entry);
      entry.index.reset(entry.lineCount, lineOf(entry.id));
    }
    revise(entry);
    settleIfReady(entry);
    bump();
    schedulePump();
  }

  /** Same content of a profile or a database, even when a reload made new objects (AD-29). */
  function sameView(a: ModalView, b: ModalView): boolean {
    if (a.key !== b.key) return false;
    if (a.cp !== b.cp && JSON.stringify(a.cp.profile) !== JSON.stringify(b.cp.profile)) return false;
    if (a.db !== b.db && JSON.stringify(a.db) !== JSON.stringify(b.db)) return false;
    return true;
  }

  /** Rebuilds when the document's effective view is not the one the index was built from. */
  function reindexIfChanged(entry: Entry): void {
    const doc = deps.docs.get(entry.id);
    // A profile, a code file or a script is not an NC program: nothing to index (the
    // inspector and the colours leave such documents out as well).
    const view = doc !== undefined && !isNcDocumentPath(doc.path) ? null : deps.effective(entry.id);
    if (view === null) {
      if (entry.view === null) return;
      entry.view = null;
      entry.index = null;
      restart(entry);
      return;
    }
    if (entry.view !== null && sameView(entry.view, view)) {
      entry.view = view;
      return;
    }
    entry.view = view;
    entry.index = deps.every === undefined ? new ModalIndex(view.cp, view.db) : new ModalIndex(view.cp, view.db, { every: deps.every });
    restart(entry);
  }

  function drop(entry: Entry): void {
    entry.keyCheck?.();
    entry.keyCheck = null;
    // Nothing is going to build this document any more, so a waiter must not hang.
    entry.markReady();
    entries.delete(entry.id);
    bump();
  }

  function ensure(id: DocId): Entry {
    install();
    const found = entries.get(id);
    if (found) return found;
    const entry: Entry = {
      id,
      view: null,
      index: null,
      loaded: false,
      revision: 0,
      lineCount: 0,
      waiting: new Set(),
      ready: Promise.resolve(),
      markReady: () => {},
      settled: true,
      keyCheck: null,
    };
    arm(entry);
    entries.set(id, entry);
    reindexIfChanged(entry);
    if (entry.view === null) restart(entry);
    return entry;
  }

  function install(): void {
    if (installed) return;
    installed = true;
    stops = [
      deps.editor.onDidChangeContent((id, change) => {
        if (deps.docs.get(id) === undefined) return;
        const entry = entries.get(id) ?? ensure(id);
        if (change.flush || !entry.loaded) {
          restart(entry);
        } else if (entry.index !== null) {
          entry.lineCount = deps.editor.getLineCount(id);
          entry.index.applyChange(change.startLine, entry.lineCount, lineOf(id));
          revise(entry);
          if (!entry.index.ready()) arm(entry);
          bump();
          schedulePump();
        }
        entry.keyCheck?.();
        entry.keyCheck = deps.schedule(() => {
          entry.keyCheck = null;
          if (entries.get(id) === entry) reindexIfChanged(entry);
        }, keyDelay);
      }),
      // A fresh Monaco model replaces the text the index was built from.
      deps.editor.onDidCreateModel((id) => {
        if (deps.docs.get(id) === undefined) return;
        const entry = entries.get(id);
        if (entry) restart(entry);
        else ensure(id);
      }),
      // Every open document has an index; a closed one loses it; a dialect switch rebuilds it.
      deps.docs.list.subscribe((list) => {
        const open = new Set(list.map((doc) => doc.id));
        for (const entry of [...entries.values()]) if (!open.has(entry.id)) drop(entry);
        for (const doc of list) {
          const entry = entries.get(doc.id);
          if (entry) reindexIfChanged(entry);
          else ensure(doc.id);
        }
      }),
      ...[deps.machineRevision, deps.profileRevision].flatMap((revision) =>
        revision === undefined
          ? []
          : [
              revision.subscribe(() => {
                for (const entry of [...entries.values()]) reindexIfChanged(entry);
              }),
            ],
      ),
    ];
  }

  return {
    stateAfter(id: DocId, line: number): ModalState | null {
      if (deps.docs.get(id) === undefined) return null;
      const entry = ensure(id);
      const state = entry.index?.stateAfter(line) ?? null;
      if (state === null && entry.index !== null) wait(entry, line);
      return state;
    },

    statesAfter(id: DocId, first: number, last: number): ModalState[] | null {
      if (deps.docs.get(id) === undefined) return null;
      const entry = ensure(id);
      const states = entry.index?.statesAfter(first, last) ?? null;
      if (states === null && entry.index !== null) wait(entry, first);
      return states;
    },

    changed: { subscribe: changed.subscribe },

    revisionOf(id: DocId): number {
      return entries.get(id)?.revision ?? 0;
    },

    whenReady(id: DocId): Promise<void> {
      if (deps.docs.get(id) === undefined) return Promise.resolve();
      return ensure(id).ready;
    },

    start(): Disposable {
      install();
      return () => {
        if (!installed) return;
        installed = false;
        for (const stop of stops.reverse()) stop();
        stops = [];
        pending?.();
        pending = null;
        for (const entry of [...entries.values()]) drop(entry);
      };
    },
  };
}

/** The gap between two slices where there is no idle clock: one frame. */
export const FALLBACK_GAP_MS = 16;

/**
 * Runs `fn` when the app is idle: `requestIdleCallback` where there is one; the macOS webview
 * has none, so there it is a timer one frame away (`FALLBACK_GAP_MS`). Each slice ends after
 * `IDLE_BUDGET_MS`, so a keystroke waits for at most one slice, and a build that runs for
 * seconds leaves the main thread half of the time to the editor instead of holding it back
 * to back.
 */
export function runWhenIdle(fn: () => void): Disposable {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => fn(), { timeout: 1000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(fn, FALLBACK_GAP_MS);
  return () => clearTimeout(handle);
}

/** The application-wide modal service; `contrib/modal.ts` starts it. */
export const modal: ModalServiceInternals = createModalService({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => {
    const doc = appDocs.get(id);
    // A reload can remove a document's profile for a moment (AD-29): nothing to index then.
    if (doc === undefined || appProfiles.get(doc.profileId) === undefined) return null;
    const view = appMachines.effective(id);
    return { cp: view.cp, db: view.codes, key: view.machine.key };
  },
  machineRevision: appMachines.revision,
  profileRevision: appProfiles.revision,
  idle: runWhenIdle,
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
});
