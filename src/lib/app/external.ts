// Noticing that a file changed under the editor (plan §7.3, AD-10). Owner: WP2.3.
//
// The mechanism is a poll over the batched `files_stat` command, not an fs watch: a watch
// needs a non-local crate and extra permissions, is unreliable on SMB and NFS, and a CAM
// post that saves by atomic rename produces a remove/create pair rather than a
// modification. The poll runs every 2 s while the window has focus, and immediately on
// `focus` and `visibilitychange`.
//
// A differing `(mtime, size)` is only a hint. The file is read and its FNV-1a hash
// compared with the document's disk stamp before anything is reported, so a touch that
// did not change the bytes — and the app's own write, which restamps — stays silent.
//
// The decision, once the content really differs:
//
//   clean document and `files.externalChange = reload` → reload, one undo step
//   otherwise                                          → `external: 'changed'`, banner
//   the file is gone                                   → `external: 'deleted'`, metaDirty
//
// An auto-reload that cannot be carried out — the new bytes do not decode, or the user
// typed while the file was being read — falls back to the banner and is not retried for
// the same `(mtime, size)`. See `reload()` for why that matters.
//
// `createExternalChangeService(deps)` plus the singleton wired to the real services
// (AD-2), so a unit test drives it with a fake clock, a fake stat and a fake read.

import { diskChanged, files as appFiles, MAX_OPEN_BYTES } from '$lib/app/fileOps';
import { status as appStatus } from '$lib/app/status';
import { fnv1a32 } from '$lib/core/text';
import { docs as appDocs } from '$lib/stores/documents';
import { settings } from '$lib/stores/settings';
import { filesStat } from '$lib/platform/commands';
import { isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { FileStat } from '$lib/platform/commands';
import type {
  DiskStamp,
  Disposable,
  DocId,
  DocumentStore,
  ExternalChangeService,
  FileOps,
  StatusService,
} from '$lib/app/types';

/** How often the poll runs while the window has focus (AD-10). */
export const POLL_INTERVAL_MS = 2000;

export interface ExternalChangeDeps {
  docs: DocumentStore;
  /** Only `reloadFromDisk` is used; the rest of `FileOps` is none of this module's business. */
  files: Pick<FileOps, 'reloadFromDisk'>;
  status: StatusService;
  filesStat(paths: string[]): Promise<FileStat[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** `files.externalChange`, read per check so a settings change takes effect at once. */
  policy(): 'ask' | 'reload';
  /** False while the window is in the background: AD-10 does not poll then. */
  hasFocus(): boolean;
  /** Installs the `focus` and `visibilitychange` listeners; returns their disposer. */
  watchFocus(check: () => void): Disposable;
  intervalMs: number;
}

/** What `(mtime, size)` the last reported change was raised for. */
interface Seen {
  mtimeMs: number | null;
  size: number | null;
}

export function createExternalChangeService(deps: ExternalChangeDeps): ExternalChangeService {
  /**
   * The stamp a "Keep mine" would apply, per document: the file as the poll last read it.
   * `null` means the new content was too large to hash, so there is no stamp to keep and
   * the document stops being watched instead.
   */
  const pending = new Map<DocId, DiskStamp | null>();
  /** The `(mtime, size)` a banner is already up for, so the file is read only once. */
  const seen = new Map<DocId, Seen>();
  let running = false;

  function forget(id: DocId): void {
    pending.delete(id);
    seen.delete(id);
  }

  async function statOf(paths: string[]): Promise<FileStat[]> {
    try {
      return await deps.filesStat(paths);
    } catch (err) {
      // Nothing decides anything on a failed stat; the next tick tries again.
      console.warn('files_stat failed', err);
      return [];
    }
  }

  /** The file gone from under the tab: the buffer is kept and the document is modified. */
  function reportDeleted(id: DocId): void {
    const doc = deps.docs.get(id);
    if (!doc || doc.external === 'deleted') return;
    forget(id);
    deps.docs.update(id, { external: 'deleted', metaDirty: true });
    deps.status.show(t('external.deletedStatus', { name: doc.title }), { error: true });
  }

  /** The file matches the stamp again (an editor that saved it back, an undone change). */
  function reportUnchanged(id: DocId, stamp?: DiskStamp): void {
    const doc = deps.docs.get(id);
    if (!doc) return;
    forget(id);
    if (doc.external === 'none' && stamp === undefined) return;
    deps.docs.update(id, {
      external: 'none',
      ...(stamp === undefined ? {} : { disk: stamp }),
    });
  }

  /**
   * Reloads one document and answers whether it really was reloaded.
   *
   * `FileOps.reloadFromDisk` returns `Promise<void>` (§7.2) and changes nothing at all
   * when it gives up — bytes that do not decode, or a document that went dirty while the
   * file was being read. The disk stamp is therefore the only honest signal: on success
   * it is a fresh object, on a refusal it is the one that was there before.
   *
   * This is why `forget()` moved in here from before the await (G8 M2). Clearing `seen`
   * and then failing meant the next tick read the file, auto-reloaded it and failed the
   * same way — a native modal error dialog every two seconds, for ever, under the default
   * `files.externalChange = 'reload'`.
   */
  async function reload(id: DocId): Promise<boolean> {
    const doc = deps.docs.get(id);
    if (!doc) return false;
    const before = doc.disk;
    // On success `reloadFromDisk` restamps, marks the document clean and sets
    // `external: 'none'`.
    await deps.files.reloadFromDisk(id);
    const after = deps.docs.get(id);
    if (!after) {
      // Closed while the file was being read: nothing left to watch or to remember.
      forget(id);
      return false;
    }
    if (after.disk === before) return false;
    forget(id);
    return true;
  }

  /** One document, against the stat of its path in this sweep. */
  async function examine(id: DocId, stat: FileStat): Promise<void> {
    const doc = deps.docs.get(id);
    if (!doc?.path || !doc.disk) return;
    if (!stat.allowed) return;
    if (!stat.exists) {
      reportDeleted(id);
      return;
    }
    if (!diskChanged(doc.disk, stat)) {
      reportUnchanged(id);
      return;
    }
    // The banner is already up for exactly this file; do not read it again every 2 s.
    const last = seen.get(id);
    if (last && last.mtimeMs === stat.mtimeMs && last.size === stat.size && doc.external !== 'none') return;

    // Above the IPC ceiling there is nothing useful to hash: report the change on the
    // stat alone and let "Keep mine" stop watching the document (G8 F4).
    if (stat.size !== null && stat.size > MAX_OPEN_BYTES) {
      seen.set(id, { mtimeMs: stat.mtimeMs, size: stat.size });
      pending.set(id, null);
      reportChanged(id);
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await deps.readFile(doc.path);
    } catch (err) {
      // Mid-write on a share, or a permission that just went away: try again next tick.
      console.warn(`could not read ${doc.path}`, err);
      return;
    }

    // The document may have been saved, reloaded or closed while the read was in flight.
    const fresh = deps.docs.get(id);
    if (!fresh?.path || fresh.path !== doc.path || !fresh.disk) return;

    const stamp: DiskStamp = { mtimeMs: stat.mtimeMs, size: bytes.length, hash: fnv1a32(bytes) };
    if (stamp.hash === fresh.disk.hash && stamp.size === fresh.disk.size) {
      // Same bytes, new mtime: record the stamp so the next tick is cheap, and stay quiet.
      reportUnchanged(id, stamp);
      return;
    }

    seen.set(id, { mtimeMs: stat.mtimeMs, size: stat.size });
    pending.set(id, stamp);
    if (!fresh.dirty && deps.policy() === 'reload') {
      if (await reload(id)) {
        deps.status.show(t('external.autoReloaded', { name: fresh.title }));
        return;
      }
      // The reload gave up: the file does not decode, or the document went dirty while it
      // was being read. `seen` is still set for this `(mtime, size)`, so the banner below
      // is raised once and asks instead of the poll trying the same thing every 2 s.
    }
    reportChanged(id);
  }

  function reportChanged(id: DocId): void {
    const doc = deps.docs.get(id);
    if (!doc || doc.external === 'changed') return;
    deps.docs.update(id, { external: 'changed' });
    deps.status.show(t('external.changedStatus', { name: doc.title }));
  }

  async function sweep(): Promise<void> {
    // A document with no stamp is untitled, or one whose file the user chose to keep
    // after it was deleted; there is nothing to compare it against.
    const watched = deps.docs.all().filter((doc) => doc.path !== null && doc.disk !== null);
    if (watched.length === 0) return;
    const stats = await statOf(watched.map((doc) => doc.path as string));
    const byPath = new Map(stats.map((stat) => [stat.path, stat]));
    for (const doc of watched) {
      const stat = byPath.get(doc.path as string);
      if (stat) await examine(doc.id, stat);
    }
  }

  async function checkNow(): Promise<void> {
    // One sweep at a time: the interval keeps firing while a big file is being hashed.
    if (running) return;
    running = true;
    try {
      await sweep();
    } finally {
      running = false;
    }
  }

  return {
    start(): Disposable {
      const timer = setInterval(() => {
        if (deps.hasFocus()) void checkNow();
      }, deps.intervalMs);
      const off = deps.watchFocus(() => void checkNow());
      return () => {
        clearInterval(timer);
        off();
      };
    },

    checkNow,

    async reload(id: DocId): Promise<void> {
      await reload(id);
    },

    /**
     * Keeps the buffer and restamps, so the banner does not come back: the document now
     * claims the file as the poll last saw it, and the next save overwrites it. A file
     * that is gone (or whose new content was too large to hash) loses its stamp instead,
     * which stops the poll for that document until it is saved again.
     */
    keepMine(id: DocId): void {
      const doc = deps.docs.get(id);
      if (!doc) return;
      const stamp = pending.get(id);
      forget(id);
      deps.docs.update(id, {
        external: 'none',
        metaDirty: true,
        disk: stamp ?? null,
      });
      deps.status.show(t('external.keptStatus', { name: doc.title }));
    },
  };
}

/**
 * The `focus` and `visibilitychange` listeners of AD-10. A window that comes back to the
 * front checks at once rather than waiting out the interval, which is the case that
 * matters: the user alt-tabbed to a CAM post and came back.
 */
function watchWindowFocus(check: () => void): Disposable {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const onFocus = (): void => check();
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') check();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** The application-wide external-change poll. */
export const external: ExternalChangeService = createExternalChangeService({
  docs: appDocs,
  files: appFiles,
  status: appStatus,
  filesStat: (paths) => (isTauriRuntime() ? filesStat(paths) : Promise.resolve([])),
  async readFile(path) {
    // Loaded on demand: the fs plugin is only reachable inside the webview.
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  },
  policy: () => settings.get('files.externalChange'),
  // A window that is not in front is not polled; `document.hasFocus()` is false then,
  // and false in a headless environment too, where there is nothing to poll for.
  hasFocus: () => typeof document !== 'undefined' && document.hasFocus(),
  watchFocus: watchWindowFocus,
  intervalMs: POLL_INTERVAL_MS,
});
