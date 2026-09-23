// The outline service (plan §7.3, AD-12). Owner: WP3.5.
//
// One `OutlineIndex` (core/profiles/outline.ts) per open document. The first build runs
// after the first render, in 20k-line chunks, so opening a 10 MB program never blocks a
// frame; every content change is fed into `applyChange`, and only the *published* items
// are debounced by 150 ms. `toolLines()` and `itemAt()` answer from the index directly,
// because F7 pressed right after a keystroke must not step to a stale line.
//
// A document is indexed once, not once per tab switch: the M1 program map re-parsed on
// every switch and paid ~36 ms on a 10 MB program (G7). Here the panel only swaps which
// store it subscribes to.
//
// Why the chunk loop re-reads the line count instead of trusting the change events: while
// the first build is running, an edit *below* the built prefix needs no work at all (the
// build has not read those lines yet), and an edit *inside* it is a normal `applyChange`
// plus a shift of the build cursor. Only a change that straddles the boundary, or a flush
// (`setValue`, reload, compare), restarts the build.
//
// `createOutlineService(deps)` plus the singleton wired to the real modules (AD-2), so a
// unit test drives it with a fake editor and a fake clock.

import { writable, type Readable, type Writable } from 'svelte/store';
import { OutlineIndex, type OutlineItem } from '$lib/core/profiles/outline';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { Disposable, DocId, DocumentStore, EditorService, OutlineService } from '$lib/app/types';

/** Lines per chunk of the first build (AD-12). */
export const CHUNK_LINES = 20_000;
/** How long the published items wait after the last change (AD-12). */
export const AGGREGATE_DELAY_MS = 150;

export interface OutlineServiceDeps {
  docs: Pick<DocumentStore, 'get' | 'list'>;
  editor: Pick<EditorService, 'hasModel' | 'getLineCount' | 'getLines' | 'onDidChangeContent' | 'onDidCreateModel'>;
  /**
   * The document's **effective** compiled profile and the key it was built from (AD-31),
   * or null while the document is unknown.
   *
   * The key, not the profile id, is what an index is rebuilt on. A machine decides which
   * G-code system a lathe program is read in, and with it which lines are tool changes —
   * so switching the machine has to rebuild the map exactly as switching the profile does.
   */
  effective(id: DocId): { cp: CompiledProfile; key: string } | null;
  /** Bumps whenever a machine or a document's choice changed, so the keys are re-read. */
  machineRevision?: Readable<number>;
  /** `setTimeout`, as a canceller; `ms` of 0 means "after this frame". */
  schedule(fn: () => void, ms: number): Disposable;
  chunkLines: number;
  delayMs: number;
}

interface Entry {
  /** `EffectiveMachine.key`: the profile **and** the machine the index was built with. */
  key: string;
  index: OutlineIndex;
  store: Writable<OutlineItem[]>;
  /** The chunked first build, or null once it has finished. */
  build: { next: number; cancel: Disposable } | null;
  ready: Promise<void>;
  markReady: () => void;
  /** The pending aggregation. */
  publish: Disposable | null;
}

/** The service, plus the hooks that are not part of the §7.3 contract. */
export type OutlineServiceInternals = OutlineService & {
  /** Installs the listeners; the returned disposer drops them and every index. */
  start(): Disposable;
  /**
   * The items as they are right now, debounce and all bypassed. The Monaco providers use
   * this: Monaco asks for symbols and folding ranges with its own delay already, and
   * answering with a 150 ms old tree would fold the wrong lines.
   */
  snapshot(id: DocId): OutlineItem[];
};

export function createOutlineService(deps: OutlineServiceDeps): OutlineServiceInternals {
  const entries = new Map<DocId, Entry>();
  let stops: Disposable[] = [];
  let installed = false;

  function install(): void {
    if (installed) return;
    installed = true;
    stops = [
      deps.editor.onDidChangeContent((id, change) => {
        const entry = entries.get(id);
        if (!entry) return;
        if (change.flush) {
          rebuild(id, entry);
          return;
        }
        if (entry.build !== null) {
          const built = entry.build.next; // the first line the build has not read yet
          if (change.startLine >= built) return; // below the prefix: the build reads it
          if (change.endLineOld >= built) {
            rebuild(id, entry); // straddles the boundary
            return;
          }
          entry.build.next += change.endLineNew - change.endLineOld;
        }
        entry.index.applyChange(change.startLine, change.endLineOld, deps.editor.getLines(id, change.startLine, change.endLineNew));
        schedulePublish(entry);
      }),
      // A fresh Monaco model replaces the text the index was built from.
      deps.editor.onDidCreateModel((id) => {
        const entry = entries.get(id);
        if (entry) rebuild(id, entry);
      }),
      // Closed documents lose their index; a profile or machine change rebuilds it.
      deps.docs.list.subscribe((list) => {
        const open = new Set(list.map((doc) => doc.id));
        for (const [id, entry] of [...entries]) {
          if (!open.has(id)) drop(id, entry);
          else reindexIfChanged(id, entry);
        }
      }),
      ...(deps.machineRevision === undefined
        ? []
        : [
            deps.machineRevision.subscribe(() => {
              for (const [id, entry] of [...entries]) reindexIfChanged(id, entry);
            }),
          ]),
    ];
  }

  /** Rebuilds when the document's effective view is not the one the index was built with. */
  function reindexIfChanged(id: DocId, entry: Entry): void {
    const view = deps.effective(id);
    if (view === null || view.key === entry.key) return;
    entry.key = view.key;
    entry.index = new OutlineIndex(view.cp);
    rebuild(id, entry);
  }

  /** The effective compiled profile, or an empty one that classifies nothing. */
  function profileOf(id: DocId): CompiledProfile {
    return deps.effective(id)?.cp ?? EMPTY_PROFILE;
  }

  function drop(id: DocId, entry: Entry): void {
    entry.build?.cancel();
    entry.publish?.();
    // Nothing is going to build this document any more, so a waiter must not hang.
    entry.markReady();
    entries.delete(id);
  }

  /** Publishes the aggregated items after the debounce. */
  function schedulePublish(entry: Entry): void {
    entry.publish?.();
    entry.publish = deps.schedule(() => {
      entry.publish = null;
      entry.store.set(entry.index.items());
    }, deps.delayMs);
  }

  /** Reads the next chunk; the last one finishes the build and publishes at once. */
  function step(id: DocId, entry: Entry): void {
    const build = entry.build;
    if (build === null) return;
    const total = deps.editor.getLineCount(id);
    const end = Math.min(total, build.next + deps.chunkLines - 1);
    if (end >= build.next) {
      entry.index.applyChange(build.next, build.next - 1, deps.editor.getLines(id, build.next, end));
      build.next = end + 1;
    }
    if (build.next > total) {
      entry.build = null;
      entry.publish?.();
      entry.publish = null;
      entry.store.set(entry.index.items());
      entry.markReady();
      return;
    }
    build.cancel = deps.schedule(() => step(id, entry), 0);
  }

  function rebuild(id: DocId, entry: Entry): void {
    // A flush (`setValue`, reload from disk, compare) or a profile change empties the
    // index and starts over, so a `whenReady` that the *previous* build resolved must not
    // keep answering: the Monaco providers await it and would then read an empty tree and
    // drop every fold arrow. A rebuild that interrupts an unfinished build keeps the
    // promise that is still pending — re-arming it there would strand its waiters.
    if (entry.build === null) arm(entry);
    entry.build?.cancel();
    entry.index.reset([]);
    // The first chunk waits for the next turn as well, so opening a document never
    // classifies 20k lines inside the event that created it.
    entry.build = { next: 1, cancel: deps.schedule(() => step(id, entry), 0) };
    schedulePublish(entry);
  }

  /** Gives the entry a fresh, unresolved readiness promise. */
  function arm(entry: { ready: Promise<void>; markReady: () => void }): void {
    entry.ready = new Promise<void>((resolve) => {
      entry.markReady = resolve;
    });
  }

  function ensure(id: DocId): Entry {
    install();
    const found = entries.get(id);
    if (found) return found;

    const view = deps.effective(id);
    const entry: Entry = {
      key: view?.key ?? '',
      index: new OutlineIndex(view?.cp ?? profileOf(id)),
      store: writable<OutlineItem[]>([]),
      build: null,
      ready: Promise.resolve(),
      markReady: () => {},
      publish: null,
    };
    arm(entry);
    entries.set(id, entry);
    if (deps.editor.hasModel(id)) rebuild(id, entry);
    return entry;
  }

  return {
    items(id: DocId): Readable<OutlineItem[]> {
      // Asking for the store is what starts the index: the program map asks as soon as a
      // document becomes the active one, which is the "after the first render" of AD-12.
      return ensure(id).store;
    },

    snapshot(id: DocId): OutlineItem[] {
      return ensure(id).index.items();
    },

    toolLines(id: DocId): number[] {
      return ensure(id).index.toolLines();
    },

    itemAt(id: DocId, line: number): OutlineItem | null {
      return ensure(id).index.itemAt(line);
    },

    whenReady(id: DocId): Promise<void> {
      const entry = ensure(id);
      // A document whose model has not been created yet has nothing to build from; the
      // `onDidCreateModel` listener starts the build and resolves this promise.
      return entry.ready;
    },

    start(): Disposable {
      install();
      return () => {
        if (!installed) return;
        installed = false;
        for (const stop of stops.reverse()) stop();
        stops = [];
        for (const [id, entry] of [...entries]) drop(id, entry);
      };
    },
  };
}

/**
 * The fallback for a document whose profile the registry does not know (a stale id in a
 * restored session). It classifies nothing, so the map is empty instead of wrong.
 */
const EMPTY_PROFILE: CompiledProfile = {
  profile: { syntax: { comments: [] }, toolCall: { toolFrom: 'same-line' }, outline: [] } as unknown as CompiledProfile['profile'],
  flags: 'i',
  re: {
    detectContent: [],
    toolTrigger: /(?!)/,
    tool: /(?!)/,
    programStart: [],
    programEnd: [],
    outline: [],
    references: [],
  },
  keywords: [],
};

/** The application-wide outline service. */
export const outline: OutlineServiceInternals = createOutlineService({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => {
    if (appDocs.get(id) === undefined) return null;
    const view = appMachines.effective(id);
    return { cp: view.cp, key: view.machine.key };
  },
  machineRevision: appMachines.revision,
  schedule: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
  chunkLines: CHUNK_LINES,
  delayMs: AGGREGATE_DELAY_MS,
});
