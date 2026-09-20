// New, open, save, close and the document metadata behind them (plan §7.2, AD-5, AD-7).
// Owner: WP1.6.
//
// This is the only module that turns bytes into documents and back. It owns:
//
//   - the decision dialogs (unsaved changes, quit, the Windows-1252 fallback),
//   - the document metadata a save has to reproduce byte for byte: encoding, BOM, line
//     ending and the NUL leader and trailer of a punched-tape program,
//   - the disk stamp (`mtime`, size, content hash) the external-change poll reads in M2.
//
// `createFileOps(deps)` plus the singleton wired to the real services (AD-2), so a unit
// test injects a fake editor, fake dialogs and a fake file system and never needs Monaco
// or a webview.
//
// Nothing here imports Monaco: it goes through `EditorService`, whose Monaco import is
// dynamic (`app/context.test.ts` is the tripwire).

import { codePointLabel, decodeFile, encodeFile, fnv1a32, keepsNulLeader } from '$lib/core/text';
import { dialogs as appDialogs, errorText } from '$lib/app/dialogs';
import { status as appStatus } from '$lib/app/status';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { filesStat } from '$lib/platform/commands';
import { baseName, isTauriRuntime } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { FileStat } from '$lib/platform/commands';
import type {
  DecodeResult,
  DiskStamp,
  Disposable,
  DocId,
  DocMeta,
  DocumentStore,
  EditorService,
  Eol,
  EncodeResult,
  FileEncoding,
  FileOps,
  NativeDialogs,
  NulInfo,
  ProfileRegistry,
  StatusService,
} from '$lib/app/types';

/** How the file operations reach the disk. Injected so a test needs no Tauri runtime. */
export interface FileSystemAccess {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
}

/**
 * P1 wrote a first version of this interface; it is a starting point, not a contract
 * (prelude D4). `FileOps` itself is binding.
 */
export interface FileOpsDeps {
  docs: DocumentStore;
  editor: EditorService;
  dialogs: NativeDialogs;
  status: StatusService;
  profiles: ProfileRegistry;
  fs: FileSystemAccess;
  filesStat(paths: string[]): Promise<FileStat[]>;
  /** False in a plain browser, where there is no file system to reach. */
  isTauri(): boolean;
}

/**
 * The quit hooks the close guard runs after `confirmQuit()` said yes and before the
 * window is destroyed. Beyond §7.2: only `contrib/files.ts` calls it, and it lives here
 * because this module owns the handler list `onWillQuit` fills.
 */
export interface FileOpsQuit {
  runWillQuit(): Promise<void>;
}

/** A new document: UTF-8 without a byte order mark (AD-7). */
const UTF8: FileEncoding = { encoding: 'utf-8', hasBom: false };

const NO_NUL: NulInfo = { leader: 0, trailer: 0, stripped: 0 };

/** Status-bar and dialog names of the three line endings. */
export const EOL_LABELS: Record<Eol, string> = { crlf: 'CRLF', lf: 'LF', cr: 'CR' };

/** How many document names the combined unsaved-changes dialog lists before "+N more". */
const MAX_LISTED = 10;

/**
 * The largest file that may be pulled through IPC into the webview (G8 F4). Above this
 * there is nothing useful left to do with it: Monaco stops syncing a model to its worker
 * at 50 MB (F8), so compare and every worker-backed feature are out, while decoding walks
 * the bytes twice and builds two full-size strings first. The size comes from the stat
 * that `openOne` runs *before* the read.
 */
export const MAX_OPEN_BYTES = 50 * 1024 * 1024;

/**
 * How many files one Open or one drop may turn into documents. Each one costs a Monaco
 * model; a dropped folder tree or a stray select-all has no business opening hundreds.
 */
export const MAX_OPEN_AT_ONCE = 50;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** "512 B", "9.4 MB", "1.3 GB": a size a message can name. */
export function formatBytes(bytes: number): string {
  let value = Math.max(bytes, 0);
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${rounded} ${SIZE_UNITS[unit]}`;
}

/**
 * True when the file is not the one the stamp was taken from. A file that is gone (or
 * that the scope no longer answers for) is not "changed": the write simply recreates it.
 * `mtimeMs` is only compared when both sides have one — AD-10 records a null mtime
 * without raising an event, and both values come from the same `files_stat`.
 */
export function diskChanged(stamp: DiskStamp, stat: FileStat): boolean {
  if (!stat.allowed || !stat.exists) return false;
  if (stat.size !== null && stat.size !== stamp.size) return true;
  return stamp.mtimeMs !== null && stat.mtimeMs !== null && stat.mtimeMs !== stamp.mtimeMs;
}

/** A minimal listener list; one failing listener never stops the others. */
function emitter<A extends unknown[]>(): { add(cb: (...a: A) => void): Disposable; fire(...a: A): void } {
  const listeners = new Set<(...a: A) => void>();
  return {
    add(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    fire(...a) {
      for (const cb of [...listeners]) {
        try {
          cb(...a);
        } catch (err) {
          console.error('file listener failed', err);
        }
      }
    },
  };
}

export function createFileOps(deps: FileOpsDeps): FileOps & FileOpsQuit {
  const { docs, editor, dialogs, status, profiles } = deps;

  const openEvent = emitter<[DocId, string]>();
  const saveEvent = emitter<[DocId, string]>();
  const quitHandlers = new Set<() => Promise<void> | void>();

  // -- helpers --------------------------------------------------------------

  function resolve(id?: DocId): DocMeta | undefined {
    const wanted = id ?? docs.getActiveId();
    return wanted === null ? undefined : docs.get(wanted);
  }

  /** Shows the failure in the status bar and as a native error dialog. */
  async function reportError(summary: string, err: unknown): Promise<void> {
    const detail = errorText(err);
    status.show(`${summary}: ${detail}`, { error: true, detail });
    await dialogs.error(summary, err);
  }

  /** True inside Tauri; otherwise it says so once in the status bar. */
  function haveDisk(): boolean {
    if (deps.isTauri()) return true;
    status.show(t('files.desktopOnly'), { error: true });
    return false;
  }

  /** `files_stat` never decides anything on its own, so a failure is not an error here. */
  async function statOf(paths: string[]): Promise<FileStat[]> {
    try {
      return await deps.filesStat(paths);
    } catch (err) {
      console.error('files_stat failed', err);
      return [];
    }
  }

  function stampOf(bytes: Uint8Array, stat: FileStat | undefined): DiskStamp {
    return { mtimeMs: stat?.mtimeMs ?? null, size: bytes.length, hash: fnv1a32(bytes) };
  }

  /**
   * The lone untitled buffer the app starts with, when it was never touched. Opening a
   * file replaces it instead of leaving an empty tab behind, the way every tabbed editor
   * does; a second document, an edit or a save all disqualify it.
   */
  function scratchDocument(): DocId | null {
    const all = docs.all();
    if (all.length !== 1) return null;
    const only = all[0];
    return only.path === null && !only.dirty ? only.id : null;
  }

  function drop(id: DocId): void {
    editor.disposeModel(id);
    docs.remove(id);
  }

  // -- new ------------------------------------------------------------------

  function newUntitled(o?: { profileId?: string; text?: string; activate?: boolean }): DocId {
    const profileId = o?.profileId ?? profiles.defaultId();
    const eol = profiles.get(profileId)?.newFileEol ?? 'crlf';
    const id = docs.add(
      {
        path: null,
        untitledIndex: docs.nextUntitledIndex(),
        profileId,
        encoding: UTF8,
        eol,
        eolMixedOnLoad: false,
        nul: NO_NUL,
        textDirty: false,
        metaDirty: false,
        disk: null,
        external: 'none',
      },
      { activate: o?.activate !== false },
    );
    editor.createModel(id, o?.text ?? '', profileId, eol);
    return id;
  }

  // -- open -----------------------------------------------------------------

  /** Reads and decodes one file into a new document. Returns null when it was refused. */
  async function openOne(path: string, notices: string[]): Promise<DocId | null> {
    const name = baseName(path);
    // The stat runs BEFORE the read: reading first would mean a multi-gigabyte file is
    // already in the webview by the time its size is known (G8 F4). The same answer is
    // the disk stamp below, so this costs no extra round trip.
    const [stat] = await statOf([path]);
    if (stat && stat.size !== null && stat.size > MAX_OPEN_BYTES) {
      await reportError(
        t('files.openFailed', { name }),
        t('files.tooLarge', {
          name,
          size: formatBytes(stat.size),
          limit: formatBytes(MAX_OPEN_BYTES),
        }),
      );
      return null;
    }

    let bytes: Uint8Array;
    try {
      bytes = await deps.fs.readFile(path);
    } catch (err) {
      await reportError(t('files.openFailed', { name }), err);
      return null;
    }

    const decoded = decodeFile(bytes);
    if (!decoded.ok) {
      // AD-7: more than 10 % inner NUL bytes is data, not a program.
      await reportError(t('files.openFailed', { name }), t(decoded.message.key, decoded.message.params));
      return null;
    }

    const fallback = resolve()?.profileId ?? profiles.defaultId();
    const profileId = profiles.detect(path, decoded.text, fallback);
    const eol = decoded.eol ?? profiles.get(profileId)?.newFileEol ?? 'crlf';

    const id = docs.add(
      {
        path,
        untitledIndex: null,
        profileId,
        encoding: decoded.encoding,
        eol,
        eolMixedOnLoad: decoded.eolMixed,
        nul: decoded.nul,
        textDirty: false,
        // A stripped NUL means the buffer no longer matches the file (AD-7).
        metaDirty: decoded.nul.stripped > 0,
        disk: stampOf(bytes, stat),
        external: 'none',
      },
      { activate: true },
    );
    editor.createModel(id, decoded.text, profileId, eol);

    if (decoded.nul.stripped > 0) {
      notices.push(t('files.nulStripped', { count: decoded.nul.stripped, name }));
    }
    if (decoded.eolMixed) {
      notices.push(t('files.eolMixed', { name, eol: EOL_LABELS[eol] }));
    }
    openEvent.fire(id, path);
    return id;
  }

  async function open(paths?: string[]): Promise<DocId[]> {
    if (!haveDisk()) return [];
    let wanted = paths;
    if (!wanted) {
      try {
        wanted = await dialogs.openFiles({ multiple: true });
      } catch (err) {
        await reportError(t('files.dialogFailed'), err);
        return [];
      }
    }
    if (wanted.length === 0) return [];

    const scratch = scratchDocument();
    const opened: DocId[] = [];
    const notices: string[] = [];
    let created = 0;
    let failed = 0;

    // A drop of a whole folder tree, or a select-all in a job directory (G8 F4).
    if (wanted.length > MAX_OPEN_AT_ONCE) {
      notices.push(t('files.tooManyAtOnce', { count: MAX_OPEN_AT_ONCE, total: wanted.length }));
      wanted = wanted.slice(0, MAX_OPEN_AT_ONCE);
    }

    for (const path of wanted) {
      const existing = docs.byPath(path);
      if (existing) {
        docs.activate(existing.id);
        opened.push(existing.id);
        notices.push(t('files.focused', { name: existing.title }));
        continue;
      }
      const id = await openOne(path, notices);
      if (id === null) failed++;
      else {
        opened.push(id);
        created++;
      }
    }

    // Only once something took its place, and never when it is what the user asked for.
    if (created > 0 && scratch !== null && !opened.includes(scratch)) drop(scratch);

    if (opened.length > 0) {
      // A failure already put an error on the status bar; do not paint over it.
      if (failed === 0) {
        const parts: string[] = [];
        if (created === 1 && opened.length === 1) {
          parts.push(t('files.opened', { name: docs.get(opened[0])?.title ?? baseName(wanted[0]) }));
        } else if (created > 0) {
          parts.push(t('files.openedMany', { count: created }));
        }
        parts.push(...notices);
        if (parts.length > 0) status.show(parts.join(' · '));
      }
      editor.focus();
    }
    return opened;
  }

  // -- save -----------------------------------------------------------------

  /** Asks whether text Windows-1252 cannot store may go to disk as UTF-8 instead. */
  function confirmUtf8(path: string, bad: Extract<EncodeResult, { ok: false }>): Promise<boolean> {
    return dialogs.confirm({
      title: t('files.encodingTitle'),
      message: t('files.encodingFallback', {
        name: baseName(path),
        char: bad.badChar,
        code: codePointLabel(bad.badChar),
        line: bad.line,
        column: bad.column,
      }),
      ok: t('files.saveAsUtf8Button'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
  }

  /** "Another program changed this file while you had it open — still overwrite it?" */
  function confirmOverwrite(name: string): Promise<boolean> {
    return dialogs.confirm({
      title: t('files.changedOnDiskTitle'),
      message: t('files.changedOnDiskMessage', { name }),
      ok: t('files.overwriteButton'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
  }

  /**
   * A write that failed may have truncated the file: `writeFile` opens with
   * `create(true).truncate(true)`, so the old content is gone before the first byte of
   * the new one lands (AD-7 writes in place on purpose, for identity and ACLs on shares).
   * The buffer can be the only full copy left, so the failure offers Save As.
   */
  async function reportWriteFailure(id: DocId, name: string, err: unknown): Promise<boolean> {
    const summary = t('files.saveFailed', { name });
    const detail = errorText(err);
    status.show(`${summary}: ${detail}`, { error: true, detail });
    const elsewhere = await dialogs.confirm({
      title: t('files.saveFailedTitle'),
      message: t('files.saveFailedMessage', { name, detail }),
      ok: t('common.saveAs'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
    return elsewhere ? saveAs(id) : false;
  }

  /**
   * Writes the buffer to `path` in place, which keeps the file's identity and its ACLs on
   * a share, and restamps the document. An edit made while the write was in flight leaves
   * the document dirty: what reached the disk is the older text.
   */
  async function write(id: DocId, path: string): Promise<boolean> {
    const doc = docs.get(id);
    if (!doc) return false;
    const name = baseName(path);
    const textLF = editor.getText(id);
    const versionBefore = editor.versionId(id);

    // A CAM post can rewrite the file while the tab sits open. The document already
    // carries the stamp it was read at, so the answer costs one stat (G8 F5). The poll
    // and the banner of AD-10 are M2; this is only the guard on the write itself, and it
    // asks about the file the document owns, never about a Save As target the user has
    // just picked and confirmed in the native dialog.
    if (doc.path === path && doc.disk) {
      const [before] = await statOf([path]);
      if (before && diskChanged(doc.disk, before) && !(await confirmOverwrite(name))) return false;
    }

    let encoding = doc.encoding;
    let switchedToUtf8 = false;
    let bytes: Uint8Array;
    const encoded = encodeFile(textLF, { encoding, eol: doc.eol, nul: doc.nul });
    if (encoded.ok) {
      bytes = encoded.bytes;
    } else {
      if (!(await confirmUtf8(path, encoded))) return false;
      encoding = UTF8;
      switchedToUtf8 = true;
      const retry = encodeFile(textLF, { encoding, eol: doc.eol, nul: doc.nul });
      if (!retry.ok) return false; // unreachable: UTF-8 stores every character
      bytes = retry.bytes;
    }

    // `encodeFile` leaves the tape leader out of a UTF-16 file — the byte order mark has
    // to sit at offset 0 — so the document must stop claiming one, or a later save back
    // to UTF-8 would resurrect a leader that is no longer on disk (G8 F1).
    const tapeDropped =
      !keepsNulLeader(encoding) && (doc.nul.leader > 0 || doc.nul.trailer > 0);

    try {
      await deps.fs.writeFile(path, bytes);
    } catch (err) {
      return reportWriteFailure(id, name, err);
    }

    // What was stripped on load is now gone from the file as well; a dropped tape leader
    // clears the whole record.
    let nul: NulInfo | undefined;
    if (tapeDropped) nul = NO_NUL;
    else if (doc.nul.stripped > 0) nul = { ...doc.nul, stripped: 0 };

    const [stat] = await statOf([path]);
    docs.update(id, {
      path,
      untitledIndex: null,
      encoding,
      ...(nul ? { nul } : {}),
      // `encodeFile` wrote every line with `doc.eol`, so a file that arrived with mixed
      // endings is uniform now and the status bar must stop saying "(mixed)" (AD-7).
      ...(doc.eolMixedOnLoad ? { eolMixedOnLoad: false } : {}),
      metaDirty: false,
      external: 'none',
      disk: stampOf(bytes, stat),
    });
    if (editor.versionId(id) === versionBefore) editor.markClean(id);
    saveEvent.fire(id, path);
    const saved = switchedToUtf8 ? t('files.savedAsUtf8', { name }) : t('files.saved', { name });
    status.show(tapeDropped ? `${saved} · ${t('files.tapeDropped')}` : saved);
    return true;
  }

  async function saveAs(id?: DocId): Promise<boolean> {
    const doc = resolve(id);
    if (!doc || !haveDisk()) return false;

    const defaultPath = doc.path ?? profiles.get(doc.profileId)?.defaultFileName ?? doc.title;
    let path: string | null;
    try {
      path = await dialogs.saveFile({ defaultPath, profileId: doc.profileId });
    } catch (err) {
      await reportError(t('files.saveDialogFailed'), err);
      return false;
    }
    if (!path) return false; // cancelled

    // Two tabs on one file would each believe they own it.
    const other = docs.byPath(path);
    if (other && other.id !== doc.id) {
      const name = baseName(path);
      await reportError(t('files.saveFailed', { name }), t('files.alreadyOpen', { name }));
      return false;
    }
    return write(doc.id, path);
  }

  async function save(id?: DocId): Promise<boolean> {
    const doc = resolve(id);
    if (!doc) return false;
    if (!doc.path) return saveAs(doc.id);
    if (!haveDisk()) return false;

    // Rewriting an unchanged file could only alter it, unless it has disappeared since.
    if (!doc.dirty) {
      const [stat] = await statOf([doc.path]);
      if (stat?.exists) {
        status.show(t('files.unchanged', { name: doc.title }));
        return true;
      }
    }
    return write(doc.id, doc.path);
  }

  async function saveAll(): Promise<boolean> {
    let saved = 0;
    for (const doc of [...docs.all()]) {
      const current = docs.get(doc.id);
      if (!current?.dirty) continue;
      const ok = current.path ? await save(current.id) : await saveAs(current.id);
      if (!ok) return false; // Cancel or a failure aborts the rest
      saved++;
    }
    if (saved > 1) status.show(t('files.savedAll', { count: saved }));
    return true;
  }

  // -- close ----------------------------------------------------------------

  /**
   * ONE dialog for every unsaved document. A single document keeps the M0 wording and the
   * Save / Don't Save / Cancel buttons; several get the list and Save All / Discard All.
   */
  async function askUnsaved(dirty: DocMeta[]): Promise<'save' | 'discard' | 'cancel'> {
    if (dirty.length === 0) return 'discard';
    const single = dirty.length === 1;
    const names = dirty.slice(0, MAX_LISTED).map((doc) => `• ${doc.title}`);
    if (dirty.length > MAX_LISTED) names.push(t('files.unsavedMore', { count: dirty.length - MAX_LISTED }));

    const choice = await dialogs.ask3({
      title: t('files.unsavedTitle'),
      message: single
        ? t('files.unsavedMessage', { name: dirty[0].title })
        : t('files.unsavedManyMessage', { list: names.join('\n') }),
      yes: single ? t('common.save') : t('files.saveAllButton'),
      no: single ? t('common.dontSave') : t('files.discardAllButton'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
    return choice === 'yes' ? 'save' : choice === 'no' ? 'discard' : 'cancel';
  }

  async function close(id?: DocId): Promise<boolean> {
    const doc = resolve(id);
    if (!doc) return false;
    if (doc.dirty) {
      const decision = await askUnsaved([doc]);
      if (decision === 'cancel') return false;
      if (decision === 'save' && !(await save(doc.id))) return false;
    }
    drop(doc.id);
    // The window always holds a document; closing the last one opens a fresh buffer.
    if (docs.all().length === 0) newUntitled();
    return true;
  }

  async function closeAll(): Promise<boolean> {
    const decision = await askUnsaved(docs.all().filter((doc) => doc.dirty));
    if (decision === 'cancel') return false;
    if (decision === 'save' && !(await saveAll())) return false;
    for (const doc of [...docs.all()]) drop(doc.id);
    newUntitled();
    return true;
  }

  async function confirmQuit(): Promise<boolean> {
    const decision = await askUnsaved(docs.all().filter((doc) => doc.dirty));
    if (decision === 'cancel') return false;
    if (decision === 'save') return saveAll();
    return true;
  }

  // -- metadata -------------------------------------------------------------

  function setEncoding(id: DocId, e: FileEncoding): void {
    const doc = docs.get(id);
    if (!doc || (doc.encoding.encoding === e.encoding && doc.encoding.hasBom === e.hasBom)) return;
    docs.update(id, { encoding: e, metaDirty: true });
  }

  function setEol(id: DocId, eol: Eol): void {
    const doc = docs.get(id);
    if (!doc || doc.eol === eol) return;
    // CRLF and LF are real model states and the change is undoable; a CR document uses an
    // LF model too (AD-5), so it is metadata only.
    if (eol !== 'cr') editor.setModelEol(id, eol);
    docs.update(id, { eol, metaDirty: true });
  }

  function setProfile(id: DocId, profileId: string): void {
    const doc = docs.get(id);
    if (!doc || doc.profileId === profileId) return;
    docs.update(id, { profileId });
    editor.setLanguage(id, profileId);
  }

  // -- disk -----------------------------------------------------------------

  async function readDisk(path: string): Promise<DecodeResult | null> {
    try {
      return decodeFile(await deps.fs.readFile(path));
    } catch (err) {
      console.error(`Could not read ${path}`, err);
      return null;
    }
  }

  async function reloadFromDisk(id: DocId): Promise<void> {
    const doc = docs.get(id);
    if (!doc?.path) return;
    let bytes: Uint8Array;
    try {
      bytes = await deps.fs.readFile(doc.path);
    } catch (err) {
      await reportError(t('files.reloadFailed', { name: doc.title }), err);
      return;
    }
    const decoded = decodeFile(bytes);
    if (!decoded.ok) {
      await reportError(t('files.reloadFailed', { name: doc.title }), t(decoded.message.key, decoded.message.params));
      return;
    }
    // One undo step, cursor line kept (§7.2).
    editor.replaceAll(id, decoded.text, { keepCursorLine: true });
    editor.markClean(id);
    const [stat] = await statOf([doc.path]);
    docs.update(id, {
      encoding: decoded.encoding,
      eol: decoded.eol ?? doc.eol,
      eolMixedOnLoad: decoded.eolMixed,
      nul: decoded.nul,
      textDirty: false,
      metaDirty: decoded.nul.stripped > 0,
      disk: stampOf(bytes, stat),
      external: 'none',
    });
    status.show(t('files.reloaded', { name: doc.title }));
  }

  return {
    newUntitled,
    open,
    save,
    saveAs,
    saveAll,
    close,
    closeAll,
    confirmQuit,
    setEncoding,
    setEol,
    setProfile,
    reloadFromDisk,
    readDisk,

    onDidOpen(cb: (id: DocId, path: string) => void): Disposable {
      return openEvent.add(cb);
    },
    onDidSave(cb: (id: DocId, path: string) => void): Disposable {
      return saveEvent.add(cb);
    },
    onWillQuit(cb: () => Promise<void> | void): Disposable {
      quitHandlers.add(cb);
      return () => {
        quitHandlers.delete(cb);
      };
    },

    /** Runs between "yes, quit" and `destroy()`. A failing handler never blocks the quit. */
    async runWillQuit(): Promise<void> {
      for (const handler of [...quitHandlers]) {
        try {
          await handler();
        } catch (err) {
          console.error('onWillQuit handler failed', err);
        }
      }
    },
  };
}

/** The application-wide file operations. */
export const files: FileOps & FileOpsQuit = createFileOps({
  docs: appDocs,
  editor: appEditor,
  dialogs: appDialogs,
  status: appStatus,
  profiles: appProfiles,
  fs: {
    // Loaded on demand: the fs plugin is only reachable inside the webview, and nothing
    // in this module's import graph may need the Tauri runtime to evaluate.
    async readFile(path) {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      return readFile(path);
    },
    async writeFile(path, bytes) {
      const { writeFile } = await import('@tauri-apps/plugin-fs');
      await writeFile(path, bytes);
    },
  },
  filesStat,
  isTauri: isTauriRuntime,
});
