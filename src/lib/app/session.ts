// Session restore and per-file memory, webview half (plan §7.9, AD-22). Owner: WP7.5
// (the M7 prelude wrote the stubs this replaces).
//
// Two halves of one idea — "gEdit comes back the way it was left" — and they are in one
// file because they are switched on by two settings that the user reads as one feature:
//
//   `createSessionService` — **which files** were open (`files.restoreSession`);
//   `createFileTracker`    — **where you were in each of them** (`files.rememberPerFile`).
//
// Rust owns the stored list and the grants, for the reason `recent` is Rust's (P1
// AD-9): a path has to be back in the fs scope *before* the webview asks to reopen it,
// and only Rust can widen the scope. This half decides what goes into the list and what
// comes out of it.
//
// Writing: the list is pushed to Rust `SESSION_DEBOUNCE_MS` after any open, close or
// activation, and once more before quit. The debounce matters because closing ten tabs
// is ten events and one session.
//
// Restoring: with `files.restoreSession` set, the stored paths are reopened in order and
// the stored index is activated. **A file that is no longer there is dropped before
// anything is opened**, with one status message rather than one dialog per file — a
// restore that puts up a stack of native alerts at start, or that resurrects a program
// that was deleted on purpose, is worse than no restore at all.
//
// Three rules that a test would catch if they were broken:
//
//  1. **`start()` never writes the list it has not seen change**, and **a restore that
//     could not reach its files never shrinks the stored list.** It seeds itself from
//     the documents that are open when it is called — after `restore()` — so a window
//     that opens with nothing never overwrites a stored session with `[]`; and every
//     path the restore could not reach is carried back into the list it writes, so one
//     login before the share is mounted does not destroy the tab list (G8 M7).
//  2. **A document nobody ever looked at is never written over.** A file is written back
//     only once it has been on screen *and* holds what was remembered for it; a tab that
//     was opened behind another one and closed again unvisited keeps its memo exactly as
//     it was. Reading "no cursor, no bookmarks" off a tab that was never shown and
//     storing that would erase the real one.
//  3. **A restore is applied, or it stays pending.** Monaco is not up during startup,
//     so `bookmarks.set` and `reveal` would silently do nothing; the memo is held until
//     the editor can take it and the document is in front, and only then dropped.
//
// `createSessionService(deps)` / `createFileTracker(deps)` plus the singletons wired to
// the real modules (AD-2), so a unit test drives the debounce with a fake clock and
// never needs Tauri or Monaco.

import { bookmarks as appBookmarks } from '$lib/monaco/bookmarks';
import { docs as appDocs } from '$lib/stores/documents';
import { editor as appEditor } from '$lib/monaco/editorService';
import { fileMemory as appFileMemory } from '$lib/stores/fileMemory';
import { files as appFiles } from '$lib/app/fileOps';
import { getMonaco } from '$lib/monaco/setup';
import { settings as appSettings } from '$lib/stores/settings';
import { status as appStatus } from '$lib/app/status';
import { uiState as appUiState } from '$lib/stores/uiState';
import { filesStat, sessionLoad, sessionSave, type SessionState } from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { Readable } from 'svelte/store';
import type {
  Disposable,
  DocId,
  FileMemo,
  FileMemoryStore,
  SessionService,
} from '$lib/app/types';

/** How long the session list waits after the last change before it reaches Rust. */
export const SESSION_DEBOUNCE_MS = 1000;

// ---------------------------------------------------------------------------
// Which files were open
// ---------------------------------------------------------------------------

/** What is pushed to Rust: the open files in tab order, and which one was in front. */
export interface SessionSnapshot {
  paths: string[];
  active: number | null;
}

export interface SessionDeps {
  /** Tab order and the active tab; both emit on every change of the document list. */
  docs: {
    list: Readable<{ id: DocId; path: string | null }[]>;
    activeId: Readable<DocId | null>;
    all(): { id: DocId; path: string | null }[];
    getActiveId(): DocId | null;
    byPath(path: string): { id: DocId } | undefined;
  };
  /** `session_save`. Rust keeps only allowed paths and truncates to 50. */
  save(paths: string[], active: number | null): Promise<void>;
  /** `session_load`. Contracted never to reject; the `catch` here is the belt to that. */
  load(): Promise<SessionState>;
  /** `files_stat`, so a file that is gone is dropped before a dialog can appear. */
  stat(paths: string[]): Promise<{ allowed: boolean; exists: boolean; isDir: boolean }[]>;
  /** `files.open`. It also drops the pristine untitled document for us. */
  open(paths: string[]): Promise<DocId[]>;
  activate(id: DocId): void;
  onWillQuit(cb: () => Promise<void> | void): Disposable;
  notify(text: string, o?: { error?: boolean; detail?: string }): void;
  /** `files.restoreSession`. Read when `restore()` runs, not when it is wired. */
  restoreEnabled(): boolean;
  debounceMs: number;
}

/** The open files in tab order plus the index of the active one, as Rust stores it. */
export function snapshotOf(
  all: { id: DocId; path: string | null }[],
  activeId: DocId | null,
): SessionSnapshot {
  const saved = all.filter((doc): doc is { id: DocId; path: string } => doc.path !== null);
  const at = saved.findIndex((doc) => doc.id === activeId);
  // An untitled document in front is not an index into `paths`; `null` means "no
  // preference", and the restore then fronts the first file it could reopen.
  return { paths: saved.map((doc) => doc.path), active: at < 0 ? null : at };
}

export function createSessionService(deps: SessionDeps): SessionService {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** True while a change has not reached `deps.save` yet. */
  let unsaved = false;
  /** Serializes the writes, so the quit flush can wait for the one already in flight. */
  let writing: Promise<void> = Promise.resolve();
  /**
   * The stored paths **this run could not reach**, in the order they were stored.
   *
   * They are written back with the session, and that is the whole point (G8 M7). A
   * network share or a USB stick that mounts a moment after login answers
   * `allowed: false` / `exists: false` for every path on it, so `restore()` opened
   * nothing; the first tab the user then opened by hand became the entire stored
   * session, and ten programs were gone with no way back from inside the app. The same
   * happened in miniature whenever three of ten files were briefly offline.
   *
   * Keeping them costs nothing: Rust drops anything the fs scope refuses at save time
   * and truncates at 50, and they are appended **after** the open documents, so the cap
   * gives up a path nobody could open before it gives up a tab that is on screen.
   *
   * The price is that a file which is really gone stays in the list and is skipped —
   * with its one status line — at every start. That is the direction to fail in: a path
   * that lingers is a nuisance, a tab list that vanished is a day's work to reconstruct.
   */
  let unreachable: string[] = [];
  /** Whether the user has been told, once, that the session list is not being stored. */
  let toldSaveFailed = false;

  function current(): SessionSnapshot {
    const snapshot = snapshotOf(deps.docs.all(), deps.docs.getActiveId());
    if (unreachable.length === 0) return snapshot;
    const open = new Set(snapshot.paths);
    const rest = unreachable.filter((path) => !open.has(path));
    if (rest.length === 0) return snapshot;
    // Appended, never inserted: `active` is an index into `paths`.
    return { paths: [...snapshot.paths, ...rest], active: snapshot.active };
  }

  function writeNow(): Promise<void> {
    if (!unsaved) return writing;
    unsaved = false;
    // Read again here rather than at schedule time: what is saved is what is open when
    // the write happens, which is the only state a restart could come back to.
    const snapshot = current();
    writing = writing.then(() => deps.save(snapshot.paths, snapshot.active)).catch((err: unknown) => {
      // A warning, not an error: the runtime harness fails a scenario on a console
      // error, and a session list that cannot be written must not take a run down. The
      // user loses which tabs come back, not their work.
      console.warn('the session could not be saved', err);
      // Said once, though. `session_save` goes through the same `state.rs` write as the
      // recent list and the window layout, and Rust refuses the whole file once it is
      // over 1 MiB — so "the tabs do not come back" can be a condition that has been
      // true for weeks with nothing on screen to say so (G8 M7).
      if (!toldSaveFailed) {
        toldSaveFailed = true;
        deps.notify(t('session.saveFailed'), {
          error: true,
          detail: typeof err === 'string' ? err : err instanceof Error ? err.message : String(err),
        });
      }
    });
    return writing;
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    await writeNow();
  }

  return {
    start(): Disposable {
      // The seed is the state `restore()` left behind, and it is not written: a window
      // that comes up with one untitled document must not replace the stored session
      // with an empty list before the user has done anything (rule 1).
      let last = JSON.stringify(current());
      const onChange = (): void => {
        const encoded = JSON.stringify(current());
        if (encoded === last) return;
        last = encoded;
        unsaved = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          void writeNow();
        }, deps.debounceMs);
      };

      const stops: Disposable[] = [
        deps.docs.list.subscribe(onChange),
        deps.docs.activeId.subscribe(onChange),
        deps.onWillQuit(() => flush()),
      ];
      return () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        for (const stop of stops.reverse()) stop();
      };
    },

    /** Never rejects: `contrib/session.ts` fires it during startup and cannot recover. */
    async restore(): Promise<number> {
      if (!deps.restoreEnabled()) return 0;

      let stored: SessionState;
      try {
        stored = await deps.load();
      } catch (err) {
        console.warn('the session could not be read', err);
        return 0;
      }
      if (stored.paths.length === 0) return 0;

      let stats: { allowed: boolean; exists: boolean; isDir: boolean }[];
      try {
        stats = await deps.stat(stored.paths);
      } catch (err) {
        // Nothing is opened at all: the stored list is still on disk and the next start
        // tries again, which is better than a stack of "could not be opened" dialogs
        // over an empty editor. Every path is held back, or the first write of this run
        // would replace the stored list with whatever the window happens to hold.
        console.warn('the session files could not be checked', err);
        unreachable = [...stored.paths];
        return 0;
      }

      // A path the fs scope does not allow answers `allowed: false` with everything else
      // false, so a file that was moved out of reach and one that was deleted look the
      // same here — and both get the same treatment: skipped, counted, never opened,
      // and kept in the stored list (see [`unreachable`]).
      const reachable = stored.paths.map((_, at) => {
        const stat = stats[at];
        return stat !== undefined && stat.allowed && stat.exists && !stat.isDir;
      });
      const usable = stored.paths.filter((_, at) => reachable[at]);
      unreachable = stored.paths.filter((_, at) => !reachable[at]);
      const missing = unreachable.length;
      if (missing > 0) deps.notify(t('session.missing', { count: missing }));
      if (usable.length === 0) return 0;

      let opened: DocId[];
      try {
        opened = await deps.open(usable);
      } catch (err) {
        console.warn('the session could not be reopened', err);
        return 0;
      }
      if (opened.length === 0) return 0;

      // The tab that was in front, or — when that file is one of the skipped ones — the
      // first that came back. `files.open` leaves the *last* one active, which is never
      // what was meant.
      const wanted = stored.active === null ? undefined : stored.paths[stored.active];
      const front =
        wanted !== undefined && usable.includes(wanted) ? deps.docs.byPath(wanted)?.id : opened[0];
      if (front !== undefined) deps.activate(front);
      return opened.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Where you were in each file
// ---------------------------------------------------------------------------

/** The part of a memo that describes a place in the text. */
export interface Position {
  line: number;
  column: number;
  top: number;
}

export interface FileTrackerDeps {
  docs: {
    activeId: Readable<DocId | null>;
    get(id: DocId): { path: string | null } | undefined;
    all(): { id: DocId }[];
    getActiveId(): DocId | null;
  };
  memory: FileMemoryStore;
  /**
   * `files.rememberPerFile`. The store answers nothing and writes nothing while it is
   * off; it is read here as well, so a document opened while the feature was off never
   * joins [`live`] and switching it back on cannot write over that file's memo out of
   * an editor that was never given it.
   */
  enabled(): boolean;
  /** The bookmarked lines of a document, read out of Monaco's decorations. */
  bookmarkLines(id: DocId): number[];
  /** Puts `lines` back; out-of-range lines are dropped by the service (§7.9). */
  setBookmarks(id: DocId, lines: number[]): void;
  /** Whether the editor has a model for `id`; without one there is nothing to read. */
  hasModel(id: DocId): boolean;
  /** Cursor and first visible line, or null when `id` is not the document on screen. */
  position(id: DocId): Position | null;
  /** Puts the cursor and the scroll position back; false when the editor could not. */
  applyPosition(id: DocId, at: Position): boolean;
  /** Resolves once Monaco is up **and** the bookmark decorations can be set. */
  ready: Promise<void>;
  onDidChangeCursor(cb: () => void): Disposable;
  onDidCreateModel(cb: (id: DocId) => void): Disposable;
  onDidOpen(cb: (id: DocId, path: string) => void): Disposable;
  onWillClose(cb: (id: DocId) => void): Disposable;
  onWillQuit(cb: () => Promise<void> | void): Disposable;
  /** `uiState.flush()`: the memos share its file and its debounce. */
  flushMemory(): Promise<void>;
}

/**
 * Follows the documents and keeps their memos (AD-22): written on close, on a tab
 * switch and before quit, applied when a remembered file is opened again.
 */
export function createFileTracker(deps: FileTrackerDeps): Disposable {
  /** The last place the cursor was seen, per document. */
  const seen = new Map<DocId, Position>();
  /** Memos that have not been applied yet, because Monaco or the tab was not ready. */
  const waiting = new Map<DocId, FileMemo>();
  /**
   * The documents whose editor state may be written back.
   *
   * A document joins when it has been on screen with a model **and** whatever was
   * remembered for it is already in the editor. Until then what the editor holds is
   * not an answer about this file: reading "line 1, no bookmarks" off a document that
   * was never shown, or one whose memo is still waiting to be applied, and storing it
   * would replace a real memo with nothing.
   */
  const live = new Set<DocId>();
  let ready = false;
  let disposed = false;

  function note(id: DocId): void {
    const at = deps.position(id);
    if (at !== null) seen.set(id, at);
  }

  /** Writes what is known about `id` into its memo, for a document in [`live`]. */
  function capture(id: DocId): void {
    if (!live.has(id)) return;
    const path = deps.docs.get(id)?.path;
    if (!path) return;
    note(id);
    const at = seen.get(id);
    let marks: number[] = [];
    try {
      marks = deps.bookmarkLines(id);
    } catch (err) {
      console.warn('the bookmarks of a document could not be read', err);
      return;
    }
    // A document on screen while Monaco had no cursor to give has no position of its
    // own; leaving the three members out of the patch keeps what was remembered before.
    deps.memory.remember(path, at === undefined ? { bookmarks: marks } : { ...at, bookmarks: marks });
  }

  function forget(id: DocId): void {
    seen.delete(id);
    waiting.delete(id);
    live.delete(id);
  }

  /**
   * Puts a waiting memo into the editor and, once that has worked, lets the document
   * write its own memo from then on.
   *
   * Called from every moment that could have changed the answer — the file was opened,
   * its model was created, it was brought to the front, Monaco finished loading —
   * because none of them is reliably the last one during startup.
   */
  function apply(id: DocId): void {
    if (!deps.enabled() || !ready) return;
    if (deps.docs.getActiveId() !== id || !deps.hasModel(id)) return;
    const memo = waiting.get(id);
    if (memo !== undefined) {
      const at = { line: memo.line, column: memo.column, top: memo.top };
      if (!deps.applyPosition(id, at)) return;
      // After the position, so the bookmark decorations land on a model that is already
      // the one on screen; `set` drops any line past the end of the file.
      deps.setBookmarks(id, memo.bookmarks);
      waiting.delete(id);
      seen.set(id, at);
    }
    live.add(id);
  }

  const stops: Disposable[] = [
    deps.onDidOpen((id, path) => {
      if (!deps.enabled()) return;
      const memo = deps.memory.get(path);
      if (memo !== undefined) waiting.set(id, memo);
      apply(id);
    }),
    deps.onDidCreateModel((id) => {
      // The models made before Monaco was up are created here, at attach; this is the
      // moment a memo held since startup can finally be applied.
      apply(id);
    }),
    deps.onDidChangeCursor(() => {
      const id = deps.docs.getActiveId();
      if (id !== null) note(id);
    }),
    deps.onWillClose((id) => {
      capture(id);
      forget(id);
    }),
    deps.onWillQuit(async () => {
      for (const doc of deps.docs.all()) capture(doc.id);
      // The memos go through `uiState`, whose own quit handler may already have run
      // (the contributions are loaded by file name, and `layoutPersist` sorts before
      // `session`), so this flush is the one that gets them onto disk. It is idempotent.
      await deps.flushMemory();
    }),
  ];

  let previous = deps.docs.getActiveId();
  stops.push(
    deps.docs.activeId.subscribe((id) => {
      if (id === previous) return;
      // The outgoing document first: by now `editor` has already swapped the model, so
      // its position comes from `seen` and not from the editor.
      if (previous !== null) capture(previous);
      previous = id;
      if (id !== null) apply(id);
    }),
  );

  void deps.ready.then(
    () => {
      if (disposed) return;
      ready = true;
      const id = deps.docs.getActiveId();
      if (id !== null) apply(id);
    },
    () => {
      // Monaco could not be loaded. There is no editor to restore into, and every memo
      // stays exactly as it is — which is what an empty [`live`] already guarantees.
    },
  );

  return () => {
    if (disposed) return;
    disposed = true;
    for (const stop of stops.reverse()) stop();
    seen.clear();
    waiting.clear();
    live.clear();
  };
}

// ---------------------------------------------------------------------------
// The singletons
// ---------------------------------------------------------------------------

/** The application-wide session service (`ctx.session`). */
export const session: SessionService = createSessionService({
  docs: {
    list: appDocs.list,
    activeId: appDocs.activeId,
    all: () => appDocs.all(),
    getActiveId: () => appDocs.getActiveId(),
    byPath: (path) => appDocs.byPath(path),
  },
  save: async (paths, active) => {
    if (!isTauriRuntime()) return;
    await sessionSave(paths, active);
  },
  load: async () => (isTauriRuntime() ? sessionLoad() : { paths: [], active: null }),
  stat: async (paths) => (isTauriRuntime() ? filesStat(paths) : []),
  open: (paths) => appFiles.open(paths),
  activate: (id) => appDocs.activate(id),
  onWillQuit: (cb) => appFiles.onWillQuit(cb),
  notify: (text, o) => appStatus.show(text, o),
  restoreEnabled: () => appSettings.get('files.restoreSession'),
  debounceMs: SESSION_DEBOUNCE_MS,
});

/**
 * The first visible line of the editor.
 *
 * `EditorService` has no `topLine()` — `monaco/editorService.ts` belongs to WP7.3 in
 * this milestone — so this is the one place that reaches for the instance, and it is a
 * read that cannot damage anything. The hand-off asks for the two calls below to move
 * behind `EditorService.topLine()`/`scrollToLine()` in M8.
 */
function topLineOf(): number | undefined {
  const instance = appEditor.editorInstance();
  return instance?.getVisibleRanges()[0]?.startLineNumber;
}

/** Puts the first visible line back where it was, once the cursor is in place. */
function scrollToLine(top: number): void {
  const instance = appEditor.editorInstance();
  if (!instance) return;
  instance.setScrollTop(instance.getTopForLineNumber(top));
}

/** Starts the per-file memory of the real application. `contrib/session.ts` calls it. */
export function startFileTracker(): Disposable {
  return createFileTracker({
    docs: {
      activeId: appDocs.activeId,
      get: (id) => appDocs.get(id),
      all: () => appDocs.all(),
      getActiveId: () => appDocs.getActiveId(),
    },
    memory: appFileMemory,
    enabled: () => appSettings.get('files.rememberPerFile'),
    hasModel: (id) => appEditor.hasModel(id),
    bookmarkLines: (id) => appBookmarks.lines(id),
    setBookmarks: (id, lines) => appBookmarks.set(id, lines),
    position: (id) => {
      // Only the document on screen has a cursor and a viewport; for any other one the
      // last value `onDidChangeCursor` recorded is the whole truth.
      if (appDocs.getActiveId() !== id) return null;
      const at = appEditor.cursor();
      if (at === null) return null;
      return { line: at.line, column: at.column, top: topLineOf() ?? at.line };
    },
    applyPosition: (id, at) => {
      if (!appEditor.hasModel(id) || appEditor.editorInstance() === undefined) return false;
      appEditor.reveal(id, at.line, at.column);
      // After `reveal`, which centres the cursor line: the remembered viewport wins, and
      // a file whose cursor was at the top comes back at the top rather than centred.
      scrollToLine(at.top);
      return true;
    },
    // The same two promises `contrib/bookmarks.ts` awaits before it installs the
    // decoration service, and in the same order — the contributions are loaded by file
    // name, so `bookmarks` has registered its handler before this one is created.
    ready: appEditor.ready.then(() => getMonaco()).then(() => undefined),
    onDidChangeCursor: (cb) => appEditor.onDidChangeCursor(() => cb()),
    onDidCreateModel: (cb) => appEditor.onDidCreateModel(cb),
    onDidOpen: (cb) => appFiles.onDidOpen(cb),
    onWillClose: (cb) => appFiles.onWillClose(cb),
    onWillQuit: (cb) => appFiles.onWillQuit(cb),
    flushMemory: () => appUiState.flush(),
  });
}
