// Crash recovery, webview half (plan §5 WP7.4, §7.9, AD-21). Owner: WP7.4.
//
// The promise is narrow and absolute: if the process dies without warning — a power
// cut, a `kill -9`, a WebKit crash, a Windows logoff — at most the last
// `SNAPSHOT_INTERVAL_MS` of typing is gone. Everything in this module exists to keep
// that true without making the editor feel slower:
//
//  - a document is snapshotted only when it is **dirty** and its Monaco version has
//    changed since its last snapshot, so an idle window writes nothing at all;
//  - the work runs from an **idle callback**, never on the keystroke path (the M7
//    perf budget measures exactly this);
//  - the text goes to Rust as a raw body, so a 10 MB program is not JSON-escaped;
//  - a snapshot is dropped as soon as it cannot be needed: on save, on close, on
//    discard, and — for the whole session — in `files.onWillQuit`, after the user has
//    decided to quit. Never on exit: a Windows logoff also ends there (F29).
//
// Blur and `visibilitychange` trigger a flush as well, because "the user switched
// away" is the moment before a machine is put to sleep or shut down.
//
// **Restoring writes nothing.** `restore()` reopens the snapshot as a *dirty* document
// and stops there. The file on disk is not touched, and the document carries the disk
// stamp the snapshot was taken with, so if the file moved on in the meantime the P1
// external-change banner is already up when the user first looks at it. Before that,
// `outlookFor()` tells the restore dialog — per snapshot, before anything is opened —
// which of the six things a restore will do, so a file that changed under a snapshot
// is never quietly reopened as if it had not.
//
// Three things this module will not do, each of which would cost work:
//
//  1. **It never clears on exit.** Only `files.onWillQuit` — which runs after the user
//     answered the quit dialog — clears the session. A Windows logoff ends in the same
//     `Exit` event as a clean quit, and clearing there would delete the snapshots of
//     the very session the logoff is killing (F29).
//  2. **It never discards a snapshot that was not restored.** A restore drops each
//     snapshot it has opened — one by one (`recovery_discard_entry`) — and nothing else,
//     so the snapshots that were *not* restored are offered again at the next start
//     instead of disappearing with the ones that were, and a restore that is cut short
//     leaves exactly the rest.
//  3. **A failed write is not forgotten, and it is not silent.** The document keeps no
//     "snapshotted at" stamp, so the next pass tries again rather than assuming the text
//     is safe — and the failure is said in the status bar: once as a message, and for as
//     long as it lasts as an item (`snapshotTrouble`, shown by `RecoveryStatus.svelte`)
//     that goes when a pass writes again. A crash net that is off while the guide
//     promises thirty seconds is worse than one that was never switched on, and a
//     message that was gone after eight seconds did not stay true for the afternoon.
//
// `createRecoveryService(deps)` plus the singleton wired to the real services (AD-2),
// so a unit test drives the whole of it with a fake clock and fake commands.

import { diskChanged, files as appFiles, formatBytes } from '$lib/app/fileOps';
import { status as appStatus } from '$lib/app/status';
import { docs as appDocs } from '$lib/stores/documents';
import { editor as appEditor } from '$lib/monaco/editorService';
import { runningScript } from '$lib/stores/scripts';
import { settings } from '$lib/stores/settings';
import { get, writable, type Readable } from 'svelte/store';
import {
  filesStat,
  recoveryClearCurrent,
  recoveryDiscard,
  recoveryDiscardEntry,
  recoveryDrop,
  recoveryList,
  recoveryPut,
  recoveryRead,
  type FileStat,
  type RecoveryMeta,
} from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type {
  Disposable,
  DocId,
  DocMeta,
  DocumentStore,
  EditorService,
  FileOps,
  RecoveryEntry,
  RecoveryService,
  StatusService,
} from '$lib/app/types';

/** At most one snapshot per document per this many milliseconds (AD-21). */
export const SNAPSHOT_INTERVAL_MS = 30_000;

/**
 * What a restore of one snapshot is going to do. The dialog shows it per row, before
 * anything is opened, because most of them are surprises if they are not said out loud
 * — above all `changed`, where the file the text came from is not the file that is on
 * disk now.
 */
export type RestoreOutlook =
  /** The snapshot was never saved to a file; it reopens untitled. */
  | 'untitled'
  /** The file is there and matches the stamp the snapshot was taken with. */
  | 'unchanged'
  /** The file is there and is **not** the one the snapshot came from. */
  | 'changed'
  /** The file is gone; the text reopens and a save writes it again. */
  | 'missing'
  /** There is no stamp to compare against, so nothing can be claimed either way. */
  | 'unknown'
  /** The path is outside the fs scope now: the text reopens untitled, Save As offers the path. */
  | 'unreachable';

/** The one id a snapshot has across a session boundary: its folder and its file name. */
export function entryKey(entry: Pick<RecoveryEntry, 'session' | 'key'>): string {
  return `${entry.session}/${entry.key}`;
}

/**
 * What restoring `entry` will do, given the file's current stat (`undefined` when the
 * stat did not answer for it).
 *
 * `diskChanged` is the same comparison the external-change poll makes on its first
 * pass: size, then mtime when both sides have one. It is a *hint* there and a hint
 * here — a touch that did not change the bytes reads as `changed`. That is the safe
 * direction: the worst case is a warning about a file that turns out to be identical,
 * and the case being defended against is the opposite one.
 */
export function outlookOf(entry: RecoveryEntry, stat: FileStat | undefined): RestoreOutlook {
  if (entry.path === null) return 'untitled';
  if (stat === undefined || !stat.allowed) return 'unreachable';
  if (!stat.exists) return 'missing';
  if (entry.diskStamp === null) return 'unknown';
  return diskChanged(entry.diskStamp, stat) ? 'changed' : 'unchanged';
}

/** How the recovery service reaches the world. Injected so a unit test needs no runtime. */
export interface RecoveryDeps {
  docs: Pick<DocumentStore, 'all'>;
  editor: Pick<EditorService, 'hasModel' | 'getText' | 'versionId'>;
  files: Pick<FileOps, 'restoreDocument' | 'onDidSave' | 'onWillClose' | 'onWillQuit'>;
  status: Pick<StatusService, 'show'>;
  /** `files.recovery`, read per pass so turning it off takes effect at once. */
  enabled(): boolean;
  /**
   * The document a script run is applying to, or `null` when no run is in flight.
   *
   * A run rewrites the whole document in one `replaceAll`, so a snapshot taken across
   * it would serialise megabytes of text that is about to be replaced — and the version
   * it recorded would be one no editor state ever had. The next pass after the run picks
   * the result up.
   *
   * **That argument is about one document, so the skip is about one document.** It used
   * to be a bare "is a script running", app-wide, which meant one script on one tab
   * stopped the snapshots of every other tab for as long as it ran — up to the 120 s run
   * timeout on top of the 30 s interval, for documents the run never touches (G8 M7).
   */
  scriptTarget(): DocId | null;
  put(meta: RecoveryMeta, textLF: string): Promise<void>;
  drop(key: string): Promise<void>;
  clearCurrent(): Promise<void>;
  list(): Promise<RecoveryEntry[]>;
  read(session: string, key: string): Promise<string>;
  discardSession(session: string): Promise<void>;
  /** Removes one snapshot of a leftover session; the ones beside it stay. */
  discardEntry(session: string, key: string): Promise<void>;
  /**
   * Called after every change of the set of documents whose snapshots cannot be written,
   * with their titles (oldest failure first); an empty list means all is well again.
   */
  trouble(titles: string[]): void;
  now(): number;
  /** Installs the "the user turned away" triggers (blur, visibilitychange). */
  watchAway(flush: () => void): Disposable;
  /** Runs `fn` off the current task — an idle callback where there is one. */
  idle(fn: () => void): Disposable;
  intervalMs: number;
}

/** What was last written for a document, and when. Absent = nothing is on disk for it. */
interface Taken {
  version: number;
  /** When it was written. The version gate is the only reader. */
  at: number;
  /**
   * When the last **scheduled** pass wrote it, or `null` when none has.
   *
   * The throttle is measured from here and not from `at`, and that is the difference
   * between "a crash costs 30 seconds" and "a crash costs 59" (G8 M7). A forced write —
   * a blur, a `visibilitychange`, `flushNow()` — used to reset the same clock the ticker
   * reads, so alt-tabbing one second into a period made the ticker at 30 s skip ("only
   * 29 s since the last write") and the next write land at 60 s. The trigger that exists
   * to make a crash cheaper was doubling the worst case.
   *
   * Keeping the two apart holds both properties at once: at most one *scheduled* write
   * per period (the ticker is what a 10 MB document has to be protected from), and never
   * more than one period of typing at risk.
   */
  ticked: number | null;
}

/**
 * The documents whose snapshots are not reaching the disk right now (their titles), or
 * `null` when all is well. `RecoveryStatus.svelte` shows it for as long as it is set.
 */
const trouble = writable<string[] | null>(null);
export const snapshotTrouble: Readable<string[] | null> = { subscribe: trouble.subscribe };

/** Sets `snapshotTrouble`; an empty list clears it. The singleton's `deps.trouble`, and a test seam. */
export function setSnapshotTrouble(titles: string[]): void {
  trouble.set(titles.length > 0 ? titles : null);
}

export function createRecoveryService(deps: RecoveryDeps): RecoveryService {
  const taken = new Map<DocId, Taken>();
  /**
   * Documents whose last write failed, with their titles: one warning is logged rather
   * than one per pass, and the status item lasts as long as this is not empty.
   */
  const warned = new Map<DocId, string>();
  /** Tells `deps.trouble` what `warned` holds now. */
  function publish(): void {
    deps.trouble([...warned.values()]);
  }
  /**
   * Whether the user has been told, by a message, that snapshots are not reaching the
   * disk. Reset when the trouble is over, so the next episode is told again.
   *
   * In the status bar, the way a failed backup is reported — and, since B1, beside the
   * message a lasting item (above), because a message goes after eight seconds and the
   * trouble does not. Without either the
   * whole feature could be off — a full data volume, a `<data>/recovery` that could not
   * be created, a document grown past `MAX_BODY_BYTES` by a paste or a script — with
   * nothing on screen to say so: the tab is dirty, the status bar is quiet, and the
   * guide still promises that a crash costs the last 30 seconds. Failing silently is the
   * one failure this milestone cannot afford (G8 M7).
   */
  let told = false;

  /**
   * Everything this module sends to Rust runs on one chain, in the order it was asked
   * for. That is not tidiness: a save fires `onDidSave` while a pass may still be
   * awaiting the `put` of the very document that was saved, and a drop that overtook
   * that put would leave the pre-save text on disk to be offered after the next crash.
   */
  let chain: Promise<void> = Promise.resolve();

  function after(step: () => Promise<void>): Promise<void> {
    const next = chain.then(step, step);
    chain = next;
    return next;
  }

  // --- taking snapshots -----------------------------------------------------

  /**
   * Whether `doc` is worth writing right now.
   *
   * `force` skips the 30 s throttle but never the version check: blur, a
   * `visibilitychange` and `flushNow()` all mean "write what is not on disk yet", not
   * "write everything again". A window that is alt-tabbed a hundred times therefore
   * costs a hundred passes and no writes at all.
   */
  function due(doc: DocMeta, force: boolean, now: number): boolean {
    if (!doc.dirty) return false;
    if (!deps.editor.hasModel(doc.id)) return false;
    const last = taken.get(doc.id);
    if (last === undefined) return true;
    if (last.version === deps.editor.versionId(doc.id)) return false;
    // `ticked`, not `at`: a forced write does not spend this document's turn on the
    // ticker. See [`Taken.ticked`].
    return force || last.ticked === null || now - last.ticked >= deps.intervalMs;
  }

  function metaOf(doc: DocMeta, now: number): RecoveryMeta {
    return {
      // The document id is the key: it is unique for the life of the process and it
      // already matches the `^[a-z0-9-]{1,64}$` alphabet Rust turns into a file name.
      key: doc.id,
      path: doc.path,
      title: doc.title,
      profileId: doc.profileId,
      // Left out of the JSON when it is `undefined`, which is exactly right: absent,
      // `null` and an id are three different answers about the machine (AD-31), and
      // `JSON.stringify` preserves that distinction for free.
      machineId: doc.machineId,
      encoding: doc.encoding,
      eol: doc.eol,
      nul: doc.nul,
      diskStamp: doc.disk,
      savedAt: now,
    };
  }

  async function writeOne(doc: DocMeta, now: number, force: boolean): Promise<void> {
    const previous = taken.get(doc.id);
    try {
      // Inside the try: a document can be closed and its model disposed between two
      // awaits of the same pass, and a throw here would abandon the documents after it.
      const version = deps.editor.versionId(doc.id);
      const textLF = deps.editor.getText(doc.id);
      await deps.put(metaOf(doc, now), textLF);
      taken.set(doc.id, {
        version,
        at: now,
        // A forced write leaves the ticker's clock where it was.
        ticked: force ? (previous?.ticked ?? null) : now,
      });
      if (warned.delete(doc.id)) {
        if (warned.size === 0) told = false;
        publish();
      }
    } catch (err) {
      // No stamp is recorded, so the next pass tries the same document again. A
      // warning rather than an error, and only the first one per document: the runtime
      // harness fails on unexpected console errors, and a share that went away would
      // otherwise produce one every 30 s for the rest of the session.
      if (!warned.has(doc.id)) {
        warned.set(doc.id, doc.title);
        console.warn(`a recovery snapshot for ${doc.title} could not be written`, err);
        publish();
      }
      // And said out loud once, because the alternative is a programmer who keeps
      // typing all afternoon believing a crash costs half a minute. See [`told`].
      if (!told) {
        told = true;
        deps.status.show(t('recovery.snapshotFailed', { name: doc.title }), { error: true });
      }
    }
  }

  async function pass(force: boolean): Promise<void> {
    if (!deps.enabled()) return;
    const busy = deps.scriptTarget();
    const now = deps.now();
    // Sequential: one snapshot may be 64 MiB, and two of them in flight is two copies
    // of it in the webview at once.
    for (const doc of deps.docs.all()) {
      // Only the document the run is rewriting waits; the rest of the window is not the
      // run's business.
      if (doc.id === busy) continue;
      if (due(doc, force, now)) await writeOne(doc, now, force);
    }
  }

  // --- scheduling -----------------------------------------------------------

  let queued: Disposable | null = null;
  let queuedForce = false;

  /** Queues one pass for the next idle moment. A second trigger before it runs joins it. */
  function schedule(force: boolean): void {
    if (force) queuedForce = true;
    if (queued) return;
    queued = deps.idle(() => {
      queued = null;
      const asked = queuedForce;
      queuedForce = false;
      void after(() => pass(asked));
    });
  }

  /** The document is saved or gone: whatever is on disk for it is now noise. */
  function forget(id: DocId): void {
    taken.delete(id);
    if (warned.delete(id)) {
      if (warned.size === 0) told = false;
      publish();
    }
    void after(async () => {
      try {
        await deps.drop(id);
      } catch (err) {
        console.warn(`a recovery snapshot for ${id} could not be dropped`, err);
      }
    });
  }

  // --- restoring ------------------------------------------------------------

  async function leftovers(): Promise<RecoveryEntry[]> {
    try {
      return await deps.list();
    } catch (err) {
      // The restore dialog runs during startup; a recovery folder that cannot be read
      // is an empty list, never a failed start.
      console.warn('the leftover recovery snapshots could not be listed', err);
      return [];
    }
  }

  /**
   * Says how many snapshots of the sessions just restored from are still on disk.
   *
   * Each restored snapshot is discarded on its own (`recovery_discard_entry`), so what
   * is left is exactly what the user did not take, or what could not be read or removed.
   * Before B1 a session could only be discarded whole, so a partial restore had to keep
   * all of it — and offered the restored snapshots again at the next start, next to the
   * open, dirty copies of the same work.
   */
  async function reportKept(asked: RecoveryEntry[]): Promise<void> {
    const sessions = new Set(asked.map((entry) => entry.session));
    if (sessions.size === 0) return;
    const kept = (await leftovers()).filter((entry) => sessions.has(entry.session)).length;
    if (kept > 0) deps.status.show(t('recovery.keptRest', { count: kept }));
  }

  async function restore(entries: RecoveryEntry[]): Promise<DocId[]> {
    const ids: DocId[] = [];
    for (const entry of entries) {
      try {
        const textLF = await deps.read(entry.session, entry.key);
        ids.push(
          deps.files.restoreDocument({
            path: entry.path,
            title: entry.title,
            profileId: entry.profileId,
            machineId: entry.machineId,
            encoding: entry.encoding,
            eol: entry.eol,
            nul: entry.nul,
            textLF,
            diskStamp: entry.diskStamp,
          }),
        );
      } catch (err) {
        // One snapshot that cannot be read must not cost the others. It stays on disk
        // and is offered again.
        console.warn(`the recovery snapshot ${entryKey(entry)} could not be restored`, err);
        deps.status.show(t('recovery.restoreFailed', { name: entry.title }), { error: true });
        continue;
      }
      // Its text is open now, so this one snapshot is noise. Only this one: the others of
      // its session are not the user's to lose because of it.
      try {
        await deps.discardEntry(entry.session, entry.key);
      } catch (err) {
        // The document is open and dirty; the snapshot simply stays. Being offered it
        // again is the harmless half of this failure.
        console.warn(`the restored recovery snapshot ${entryKey(entry)} could not be discarded`, err);
      }
    }
    await reportKept(entries);
    return ids;
  }

  return {
    start(): Disposable {
      const ticker = setInterval(() => schedule(false), deps.intervalMs);
      const stopAway = deps.watchAway(() => schedule(true));
      const offSave = deps.files.onDidSave((id) => forget(id));
      const offClose = deps.files.onWillClose((id) => forget(id));
      // The one place the session is cleared, and the reason it is here: this runs
      // *after* the user answered the quit dialog. `RunEvent::Exit` would also cover a
      // Windows logoff, which is the case the snapshots exist for (F29, AD-21).
      //
      // **On the chain, like every other command.** Cmd+Q with a dirty document puts a
      // native alert on screen, which takes the focus off the webview, which fires
      // `watchAway` — so a forced pass is very often in flight at exactly this moment. A
      // clear that overtook it deleted the folder and then let the put land in it, and
      // the next start offered the user a snapshot of the work they had just chosen not
      // to save, with `outlookOf` calling it `unchanged` (G8 M7).
      //
      // **And the bookkeeping goes with it.** `taken` describes a folder that is now
      // empty; leaving it behind would make the next pass skip every document whose
      // version has not changed since, so a window that does not actually die — a
      // `destroy()` that rejects, a close path that aborts after the handlers — would
      // sit there dirty and unprotected.
      const offQuit = deps.files.onWillQuit(() =>
        after(async () => {
          try {
            await deps.clearCurrent();
          } catch (err) {
            console.warn('the recovery session could not be cleared', err);
          }
          taken.clear();
          warned.clear();
          told = false;
          publish();
        }),
      );
      return () => {
        clearInterval(ticker);
        queued?.();
        queued = null;
        queuedForce = false;
        offQuit();
        offClose();
        offSave();
        stopAway();
      };
    },

    flushNow(): Promise<void> {
      return after(() => pass(true));
    },

    leftovers,
    restore,

    async discard(session: string): Promise<void> {
      await deps.discardSession(session);
    },
  };
}

/**
 * What a restore of each of `entries` would do, keyed by `entryKey`.
 *
 * One `files_stat` round trip for every distinct path, and none at all for snapshots
 * that never had one. A stat that fails answers `unreachable` for every path in it,
 * which is the cautious reading: it is the outlook that promises the least.
 */
export async function outlookFor(
  entries: readonly RecoveryEntry[],
  stat: (paths: string[]) => Promise<FileStat[]> = filesStat,
): Promise<Record<string, RestoreOutlook>> {
  const paths = [
    ...new Set(entries.map((entry) => entry.path).filter((p): p is string => p !== null)),
  ];
  const stats = new Map<string, FileStat>();
  if (paths.length > 0) {
    try {
      for (const one of await stat(paths)) stats.set(one.path, one);
    } catch (err) {
      console.warn('the files behind the recovery snapshots could not be checked', err);
    }
  }
  const out: Record<string, RestoreOutlook> = {};
  for (const entry of entries) {
    out[entryKey(entry)] = outlookOf(entry, entry.path === null ? undefined : stats.get(entry.path));
  }
  return out;
}

/** "Snapshot 12/03/2026, 14:02 · 4.1 KB": the second line of a row in the dialog. */
export function takenText(entry: Pick<RecoveryEntry, 'savedAt' | 'bytes'>): string {
  const time = new Date(entry.savedAt);
  return t('recovery.taken', {
    time: Number.isFinite(entry.savedAt) ? time.toLocaleString() : String(entry.savedAt),
    size: formatBytes(entry.bytes),
  });
}

// ---------------------------------------------------------------------------
// The startup gate
// ---------------------------------------------------------------------------

let decided: () => void = () => {};

/**
 * Resolves once the startup restore decision has been made — or at once when there was
 * nothing to ask about.
 *
 * AD-21 puts the restore dialog **before** session restore, and the two live in
 * different contributions: `contrib/recovery.ts` settles this, `contrib/session.ts`
 * (WP7.5) awaits it. It cannot be done by contribution order alone, because the dialog
 * must not be awaited inside `activate()` — the contributions are loaded before
 * `data-ready`, and a dialog waiting for a human there would hold up the whole start.
 */
export const restoreDecided: Promise<void> = new Promise<void>((resolve) => {
  decided = resolve;
});

/** Settles `restoreDecided`. Called exactly once, from a `finally` in `contrib/recovery.ts`. */
export function markRestoreDecided(): void {
  decided();
}

/** Whether anybody is going to answer the restore question (M7 integration, mergeA). */
let claimed = false;

/**
 * Says that the restore dialog will be asked and answered, so `awaitRestoreDecision()`
 * has somebody to wait for. Called synchronously from `contrib/recovery.ts`'s
 * `activate()`, which the loader reaches before `contrib/session.ts`'s.
 */
export function claimRestoreDecision(): void {
  claimed = true;
}

/**
 * What `contrib/session.ts` waits on before it reopens the stored session.
 *
 * The claim is the difference between "wait" and "wait forever". `registerContributions`
 * registers a contribution's commands **before** it calls `activate()`, and a duplicate
 * command id throws there (`registry/commands.ts`), so a typo in some future feature
 * could leave `contrib/recovery.ts` unloaded — and a bare `await restoreDecided` would
 * then hang the session restore silently and permanently. Waiting only on a decider that
 * really started removes that coupling without weakening the order AD-21 asks for: no
 * claim, nobody to ask, go ahead.
 */
export function awaitRestoreDecision(): Promise<void> {
  return claimed ? restoreDecided : Promise.resolve();
}

// ---------------------------------------------------------------------------
// The singleton
// ---------------------------------------------------------------------------

/**
 * Runs `fn` off the current task.
 *
 * `requestIdleCallback` where there is one — and on the macOS webview there is not,
 * WebKit has never shipped it, so the `setTimeout` is the path this actually takes in
 * the shipped app rather than a fallback for exotic browsers. Either way the work
 * leaves the task that scheduled it, which is the property the keystroke path needs.
 */
function idle(fn: () => void): Disposable {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => fn(), { timeout: 2000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(fn, 0);
  return () => clearTimeout(handle);
}

/** Blur and `visibilitychange`: the last moment before a sleep, a shutdown or a logoff. */
function watchAway(flush: () => void): Disposable {
  if (typeof window === 'undefined') return () => {};
  const run = (): void => flush();
  window.addEventListener('blur', run);
  document.addEventListener('visibilitychange', run);
  return () => {
    window.removeEventListener('blur', run);
    document.removeEventListener('visibilitychange', run);
  };
}

/** The application-wide recovery service. */
export const recovery: RecoveryService = createRecoveryService({
  docs: appDocs,
  editor: appEditor,
  files: appFiles,
  status: appStatus,
  // Outside the Tauri runtime there is nowhere to write, so the whole feature is inert
  // rather than one failed IPC call per pass (`contrib/quitGuard.ts` does the same).
  enabled: () => isTauriRuntime() && settings.get('files.recovery'),
  scriptTarget: () => get(runningScript)?.docId ?? null,
  put: (meta, textLF) => (isTauriRuntime() ? recoveryPut(meta, textLF) : Promise.resolve()),
  drop: (key) => (isTauriRuntime() ? recoveryDrop(key) : Promise.resolve()),
  clearCurrent: () => (isTauriRuntime() ? recoveryClearCurrent() : Promise.resolve()),
  // Deliberately **not** gated on `files.recovery`: snapshots written while it was on
  // are still the user's work after they turn it off.
  list: () => (isTauriRuntime() ? recoveryList() : Promise.resolve([])),
  read: recoveryRead,
  discardSession: recoveryDiscard,
  discardEntry: recoveryDiscardEntry,
  trouble: setSnapshotTrouble,
  now: () => Date.now(),
  watchAway,
  idle,
  intervalMs: SNAPSHOT_INTERVAL_MS,
});
