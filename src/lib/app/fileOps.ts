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
// M7 (WP7.3) adds three things to that, and all three are about not losing an edit:
//
//   - **the backup** (AD-21): the file is copied aside immediately before it is
//     overwritten, and a failed copy is a question, never a shrug;
//   - **read-only documents** (AD-23): the file's own attribute at open, the lock the
//     user sets by hand, and a Save that goes to Save As rather than truncating a file
//     it may not write;
//   - **restored snapshots** (AD-21) and **per-file memory** at open (AD-22).
//
// The order inside `write()` is the load-bearing part: every question that can still end
// in "no" comes first, then the copy, then the write, then the stamp.
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
import { fileMemory as appFileMemory } from '$lib/stores/fileMemory';
import { profiles as appProfiles } from '$lib/stores/profiles';
import { filesBackup, filesStat } from '$lib/platform/commands';
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
  FileMemoryStore,
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
  /**
   * M7, AD-21: copies the file aside before the write that overwrites it. Answers where
   * the copy went, `null` when there was nothing to copy (`files.backup` is `off`, or the
   * file does not exist yet), and **rejects** when a copy was wanted and could not be
   * made. Rust reads the mode and the count from `settings.json` itself, so nothing here
   * can turn backups off for one save.
   */
  backup(path: string): Promise<string | null>;
  /** M7, AD-22: what the user last chose for a file. A memo is never load-bearing. */
  fileMemory: Pick<FileMemoryStore, 'profileFor' | 'machineFor'>;
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
 * Why one document's save ended the way it did.
 *
 * `save()` and `saveAs()` answer `boolean` (§7.2) and always will; internally the three
 * cases have to be told apart, because **Save All treats them differently**: a *cancel* is
 * a decision the user made about that one document, a *failure* is usually the disk or the
 * share and will meet the next file too. Collapsing them was what let a cancelled Save As
 * on an untitled scratch note silently skip the rest of a Save All (G8 M5).
 */
type SaveOutcome = 'saved' | 'cancelled' | 'failed';

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
  const willCloseEvent = emitter<[DocId]>();
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

  /**
   * `files_stat`, or **`undefined` when it did not answer at all**.
   *
   * The distinction is the whole point of the signature. An empty array used to mean
   * both "the call failed" and "nothing matched", and every caller read it as the
   * second: `saveOutcome`'s `stat?.readonly === true` was false, `write`'s
   * changed-on-disk question was skipped, and the save then restamped the document
   * with `mtimeMs: null` — so one dropped IPC call turned both of M7's save guards off
   * and left the document half-blind for the rest of its life (G8 M7). A caller that
   * gets `undefined` knows only that it knows nothing, which is the one answer that
   * makes it ask instead of write.
   */
  async function statOf(paths: string[]): Promise<FileStat[] | undefined> {
    try {
      return await deps.filesStat(paths);
    } catch (err) {
      console.error('files_stat failed', err);
      return undefined;
    }
  }

  /** The stat of one path, or `undefined` for "no answer" **and** "no such entry". */
  async function statOne(path: string): Promise<FileStat | undefined> {
    return (await statOf([path]))?.[0];
  }

  function stampOf(bytes: Uint8Array, stat: FileStat | undefined): DiskStamp {
    return { mtimeMs: stat?.mtimeMs ?? null, size: bytes.length, hash: fnv1a32(bytes) };
  }

  /**
   * The document's stamp after bytes of ours have gone to `path`.
   *
   * `stat` is the answer for the file we have just written, or `undefined` when
   * `files_stat` did not answer. A stat that did not answer must not be allowed to
   * erase the mtime: `diskChanged` compares times only when **both** sides have one, so
   * a `null` here would leave the document watching for size changes alone for the rest
   * of the session — a post that rewrites a program to the same length would then be
   * invisible to the poll and to the next save's question (G8 M7). Keeping the previous
   * time instead is the self-healing direction: it does not match the file's real one,
   * so the next poll reads the file, finds our own bytes and restamps quietly.
   */
  function restamp(bytes: Uint8Array, stat: FileStat | undefined, previous: DiskStamp | null): DiskStamp {
    return {
      mtimeMs: stat ? stat.mtimeMs : (previous?.mtimeMs ?? null),
      size: bytes.length,
      hash: fnv1a32(bytes),
    };
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

  /**
   * Takes one document out of the app.
   *
   * `willCloseEvent` fires **first**, while the model is still there: per-file memory
   * reads the cursor, the top line and the bookmarks out of it (AD-22), and after
   * `disposeModel` there is nothing left to read. A listener that throws is logged by
   * `emitter` and never stops the close.
   */
  function drop(id: DocId): void {
    willCloseEvent.fire(id);
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
        readOnly: false,
        readOnlyReason: null,
      },
      { activate: o?.activate !== false },
    );
    editor.createModel(id, o?.text ?? '', profileId, eol);
    return id;
  }

  // -- open -----------------------------------------------------------------

  /**
   * Reads and decodes one file into a new document. Returns null when it was refused.
   *
   * `refuse` is how the refusal is shown, and the caller picks it: one file gets the
   * blocking error box, which is the right affordance for the thing the user just asked
   * for; a multi-file Open collects the refusals instead and shows **one** box at the end.
   * A select-all in a job directory — up to `MAX_OPEN_AT_ONCE` paths, with a scanned setup
   * sheet and a binary tool file among them — used to be N identical native alerts to
   * click through before the good programs were usable (G8 M5).
   */
  async function openOne(
    path: string,
    notices: string[],
    refuse: (name: string, detail: string) => Promise<void>,
  ): Promise<DocId | null> {
    const name = baseName(path);
    // The stat runs BEFORE the read: reading first would mean a multi-gigabyte file is
    // already in the webview by the time its size is known (G8 F4). The same answer is
    // the disk stamp below, so this costs no extra round trip.
    const stat = await statOne(path);
    if (stat && stat.size !== null && stat.size > MAX_OPEN_BYTES) {
      await refuse(
        name,
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
      await refuse(name, errorText(err));
      return null;
    }

    const decoded = decodeFile(bytes);
    if (!decoded.ok) {
      // AD-7: more than 10 % inner NUL bytes is data, not a program.
      await refuse(name, t(decoded.message.key, decoded.message.params));
      return null;
    }

    // AD-22: a dialect the user picked by hand for this very file replaces detection
    // (the spec's detection step 4). A profile that no longer exists is ignored, so a
    // removed user profile can never leave a file without a dialect.
    const remembered = deps.fileMemory.profileFor(path);
    const fallback = resolve()?.profileId ?? profiles.defaultId();
    const profileId =
      remembered !== undefined && profiles.get(remembered)
        ? remembered
        : profiles.detect(path, decoded.text, fallback);
    const eol = decoded.eol ?? profiles.get(profileId)?.newFileEol ?? 'crlf';

    // AD-31: three answers, and `??` would collapse two of them. `undefined` is "nothing
    // remembered, follow the profile's default machine", `null` is "the user chose none
    // for this file", and a string is a machine id. Only the last two are written.
    const machineId = deps.fileMemory.machineFor(path);

    // AD-23: the file carries the read-only attribute, so the buffer opens locked. The
    // answer comes from the stat that was taken above for the size guard and the stamp.
    const readOnly = stat?.readonly === true;

    const id = docs.add(
      {
        path,
        untitledIndex: null,
        profileId,
        ...(machineId !== undefined ? { machineId } : {}),
        encoding: decoded.encoding,
        eol,
        eolMixedOnLoad: decoded.eolMixed,
        nul: decoded.nul,
        textDirty: false,
        // A stripped NUL means the buffer no longer matches the file (AD-7).
        metaDirty: decoded.nul.stripped > 0,
        disk: stampOf(bytes, stat),
        external: 'none',
        readOnly,
        readOnlyReason: readOnly ? 'attribute' : null,
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
    // Said once, when it happens: a lock that is only visible as a small padlock is
    // found by the first refused keystroke, which is the wrong moment to learn it.
    if (readOnly) notices.push(t('readOnly.opened', { name }));
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

    // A drop of a whole folder tree, or a select-all in a job directory (G8 F4).
    if (wanted.length > MAX_OPEN_AT_ONCE) {
      notices.push(t('files.tooManyAtOnce', { count: MAX_OPEN_AT_ONCE, total: wanted.length }));
      wanted = wanted.slice(0, MAX_OPEN_AT_ONCE);
    }

    // One file: the blocking box, unchanged, because it is the thing the user asked for.
    // Several: collect, and show one box after the loop (G8 M5).
    const single = wanted.length === 1;
    const refusals: string[] = [];
    const refuse = async (name: string, detail: string): Promise<void> => {
      if (single) await reportError(t('files.openFailed', { name }), detail);
      else refusals.push(`${name}: ${detail}`);
    };

    for (const path of wanted) {
      const existing = docs.byPath(path);
      if (existing) {
        docs.activate(existing.id);
        opened.push(existing.id);
        notices.push(t('files.focused', { name: existing.title }));
        continue;
      }
      const id = await openOne(path, notices, refuse);
      if (id !== null) {
        opened.push(id);
        created++;
      }
    }

    // Only once something took its place, and never when it is what the user asked for.
    if (created > 0 && scratch !== null && !opened.includes(scratch)) drop(scratch);

    if (refusals.length > 0) {
      // One alert for the whole Open, listing every file and why. The programs that did
      // open are already on screen behind it.
      notices.push(t('files.openFailedMany', { count: refusals.length }));
      await dialogs.error(t('files.openFailedMany', { count: refusals.length }), refusals.join('\n'));
    }

    // The summary is shown even when something was refused: the refusal has its own box
    // and its own line in this message, so "Opened 3 files" is no longer suppressed by it.
    const parts: string[] = [];
    if (created === 1 && opened.length === 1) {
      parts.push(t('files.opened', { name: docs.get(opened[0])?.title ?? baseName(wanted[0]) }));
    } else if (created > 0) {
      parts.push(t('files.openedMany', { count: created }));
    }
    parts.push(...notices);
    if (parts.length > 0) {
      status.show(parts.join(' · '), refusals.length > 0 ? { error: true } : undefined);
    }
    if (opened.length > 0) editor.focus();
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
  async function reportWriteFailure(
    id: DocId,
    name: string,
    err: unknown,
    backupAt: string | null,
  ): Promise<SaveOutcome> {
    const summary = t('files.saveFailed', { name });
    const detail = errorText(err);
    status.show(`${summary}: ${detail}`, { error: true, detail });
    // This is the moment the backup of AD-21 exists for, so the message says where it
    // is. "The file may now be incomplete" is frightening and useless on its own; with
    // the path of the copy it is a repair instruction.
    const where = backupAt === null ? '' : `\n\n${t('files.saveFailedBackup', { path: backupAt })}`;
    const elsewhere = await dialogs.confirm({
      title: t('files.saveFailedTitle'),
      message: `${t('files.saveFailedMessage', { name, detail })}${where}`,
      ok: t('common.saveAs'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
    return elsewhere ? saveAsOutcome(id) : 'failed';
  }

  /**
   * "The copy could not be made — save anyway?" (AD-21). The default is Cancel, and a
   * Cancel writes nothing at all: the file on disk is still the last good version, and
   * the buffer still holds the new one, so nothing is lost either way.
   */
  function confirmWithoutBackup(name: string, detail: string): Promise<boolean> {
    return dialogs.confirm({
      title: t('files.backupFailedTitle'),
      message: t('files.backupFailedMessage', { name, detail }),
      ok: t('files.saveWithoutBackupButton'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
  }

  /**
   * Copies the file aside before it is overwritten (AD-21).
   *
   * `outcome` is `'made'`, `'none'` (nothing to copy — the setting is `off`, or the file
   * does not exist yet), `'without'` when the copy failed and the user said to save
   * anyway, or `'cancelled'`, and then **nothing is written**. `at` is where the copy
   * went, which a failed write then names.
   *
   * The failure is never swallowed and never silent: without this question a save over a
   * good program would replace it with no previous version anywhere, which is the one
   * outcome this milestone exists to prevent.
   */
  async function backupBeforeWrite(
    path: string,
    name: string,
  ): Promise<{ outcome: 'made' | 'none' | 'without' | 'cancelled'; at: string | null }> {
    try {
      const at = await deps.backup(path);
      return { outcome: at === null ? 'none' : 'made', at };
    } catch (err) {
      // Reported the way a failed write is (`reportWriteFailure`): the status bar keeps
      // the reason after the dialog is gone, and the console stays clear, because a
      // failure the user has just been asked about is not an unhandled one.
      const detail = errorText(err);
      status.show(`${t('files.backupFailed', { name })}: ${detail}`, { error: true, detail });
      const anyway = await confirmWithoutBackup(name, detail);
      return { outcome: anyway ? 'without' : 'cancelled', at: null };
    }
  }

  /**
   * Writes the buffer to `path` in place, which keeps the file's identity and its ACLs on
   * a share, and restamps the document. An edit made while the write was in flight leaves
   * the document dirty: what reached the disk is the older text.
   *
   * `fresh` is a `files_stat` of `path` the caller has just taken, so the changed-on-disk
   * guard does not pay for a second round trip after `saveOutcome` has already asked.
   */
  async function write(id: DocId, path: string, fresh?: FileStat): Promise<SaveOutcome> {
    const doc = docs.get(id);
    if (!doc) return 'failed';
    const name = baseName(path);
    const textLF = editor.getText(id);
    const versionBefore = editor.versionId(id);

    // A CAM post can rewrite the file while the tab sits open. The document already
    // carries the stamp it was read at, so the answer costs one stat (G8 F5). The poll
    // and the banner of AD-10 are M2; this is only the guard on the write itself, and it
    // asks about the file the document owns, never about a Save As target the user has
    // just picked and confirmed in the native dialog.
    //
    // **It fails closed.** Three states used to fall through it in silence, and each one
    // ends in the same place — the program on disk replaced with no question asked
    // (G8 M7):
    //
    //   `doc.disk === null`   nothing to compare. Not the same as "unchanged": a "Keep
    //                         mine" with no stamp to adopt, or a restored snapshot whose
    //                         sidecar carried none, both land here.
    //   `before === undefined` the stat did not answer. Same again, one layer out.
    //   `doc.external`        the banner is up. The user has been told the file moved on
    //                         and has not answered yet, so the save must not decide for
    //                         them.
    //
    // A file that is **not there** is the one case that needs no question: the write
    // recreates it, and there is nothing to overwrite.
    if (doc.path === path) {
      const before = fresh?.path === path ? fresh : await statOne(path);
      const suspect =
        doc.disk === null ||
        before === undefined ||
        doc.external !== 'none' ||
        diskChanged(doc.disk, before);
      if (suspect && before?.exists !== false && !(await confirmOverwrite(name))) {
        return 'cancelled';
      }
    }

    let encoding = doc.encoding;
    let switchedToUtf8 = false;
    let bytes: Uint8Array;
    const encoded = encodeFile(textLF, { encoding, eol: doc.eol, nul: doc.nul });
    if (encoded.ok) {
      bytes = encoded.bytes;
    } else {
      if (!(await confirmUtf8(path, encoded))) return 'cancelled';
      encoding = UTF8;
      switchedToUtf8 = true;
      const retry = encodeFile(textLF, { encoding, eol: doc.eol, nul: doc.nul });
      if (!retry.ok) return 'failed'; // unreachable: UTF-8 stores every character
      bytes = retry.bytes;
    }

    // `encodeFile` leaves the tape leader out of a UTF-16 file — the byte order mark has
    // to sit at offset 0 — so the document must stop claiming one, or a later save back
    // to UTF-8 would resurrect a leader that is no longer on disk (G8 F1).
    const tapeDropped =
      !keepsNulLeader(encoding) && (doc.nul.leader > 0 || doc.nul.trailer > 0);

    // AD-21: immediately before the write, and after every question that could still end
    // in "no" — a cancelled encoding fallback must not leave a backup of a save that
    // never happened. Rust decides where the copy goes and whether one is wanted at all.
    const backup = await backupBeforeWrite(path, name);
    if (backup.outcome === 'cancelled') return 'cancelled';

    try {
      await deps.fs.writeFile(path, bytes);
    } catch (err) {
      return reportWriteFailure(id, name, err, backup.at);
    }

    // What was stripped on load is now gone from the file as well; a dropped tape leader
    // clears the whole record.
    let nul: NulInfo | undefined;
    if (tapeDropped) nul = NO_NUL;
    else if (doc.nul.stripped > 0) nul = { ...doc.nul, stripped: 0 };

    const stat = await statOne(path);
    docs.update(id, {
      path,
      untitledIndex: null,
      // The document now owns a real file, so the name it only proposed is spent (AD-21).
      ...(doc.proposedPath ? { proposedPath: null } : {}),
      encoding,
      ...(nul ? { nul } : {}),
      // `encodeFile` wrote every line with `doc.eol`, so a file that arrived with mixed
      // endings is uniform now and the status bar must stop saying "(mixed)" (AD-7).
      ...(doc.eolMixedOnLoad ? { eolMixedOnLoad: false } : {}),
      metaDirty: false,
      external: 'none',
      disk: restamp(bytes, stat, doc.disk),
    });
    if (editor.versionId(id) === versionBefore) editor.markClean(id);
    saveEvent.fire(id, path);
    const saved = switchedToUtf8 ? t('files.savedAsUtf8', { name }) : t('files.saved', { name });
    // The dropped tape leader is a loss, not a footnote: `{ error: true }` gives it the
    // warning styling and the 8 s an error gets, because the 4 s a plain "Saved …" lives
    // for is not enough to notice that the punched-tape framing has just gone (G8 M5).
    // `contrib/encoding.ts` also asks before the fact, when the encoding is picked.
    // A save the user let through without a backup is worth the same 8 s: it is the one
    // save of this file whose previous version is nowhere.
    const warnings: string[] = [];
    if (tapeDropped) warnings.push(t('files.tapeDropped'));
    if (backup.outcome === 'without') warnings.push(t('files.savedWithoutBackup'));
    if (warnings.length > 0) status.show([saved, ...warnings].join(' · '), { error: true });
    else status.show(saved);
    return 'saved';
  }

  async function saveAsOutcome(id?: DocId): Promise<SaveOutcome> {
    const doc = resolve(id);
    if (!doc || !haveDisk()) return 'failed';

    // A restored snapshot that could not be bound to its file proposes that file here:
    // it is the one place the original path is allowed to matter, because the user sees
    // it in the native dialog and confirms it (AD-21).
    const defaultPath =
      doc.path ?? doc.proposedPath ?? profiles.get(doc.profileId)?.defaultFileName ?? doc.title;
    let path: string | null;
    try {
      path = await dialogs.saveFile({ defaultPath, profileId: doc.profileId });
    } catch (err) {
      await reportError(t('files.saveDialogFailed'), err);
      return 'failed';
    }
    if (!path) return 'cancelled';

    // Two tabs on one file would each believe they own it.
    const other = docs.byPath(path);
    if (other && other.id !== doc.id) {
      const name = baseName(path);
      await reportError(t('files.saveFailed', { name }), t('files.alreadyOpen', { name }));
      return 'failed';
    }
    return write(doc.id, path);
  }

  async function saveOutcome(id?: DocId): Promise<SaveOutcome> {
    const doc = resolve(id);
    if (!doc) return 'failed';
    if (!doc.path) return saveAsOutcome(doc.id);
    if (!haveDisk()) return 'failed';

    // `undefined` for a stat that did not answer as well as for a file that is not
    // there. Both branches below treat it as "cannot be ruled out": the unchanged
    // shortcut is not taken, the read-only branch cannot be decided here — and `write`,
    // which is where a file could actually be damaged, asks before it overwrites
    // anything it could not compare (G8 M7). A file the user may not write is refused by
    // the OS at `open`, before a byte is truncated, and `reportWriteFailure` then offers
    // Save As; so the honest answer to a stat that did not come back is to go on and let
    // the write ask, not to send a working save to a Save As dialog.
    const stat = await statOne(doc.path);

    // Rewriting an unchanged file could only alter it, unless it has disappeared since.
    // This comes first, and before the read-only branch below: a document with nothing
    // to write needs neither a copy nor a different file, and Cmd+S on a program that was
    // opened to be read would otherwise answer with a Save As dialog.
    if (!doc.dirty && stat?.exists) {
      status.show(t('files.unchanged', { name: doc.title }));
      return 'saved';
    }

    // AD-23: gEdit never changes a file's attributes, so Save of a read-only document
    // goes to Save As. Both halves matter. `doc.readOnly` covers the lock the user set
    // by hand on a perfectly writable file. `stat.readonly` covers the file's own
    // attribute, and it is read **now** rather than remembered: an `attribute` document
    // the user unlocked still may not overwrite its file (the unlock frees the buffer,
    // not the file), and a file somebody write-protected while the tab sat open must not
    // be attempted either. Only the second could be found out by trying — and finding
    // out by trying means a truncated file (AD-7 writes in place).
    if (doc.readOnly || stat?.readonly === true) {
      status.show(t('readOnly.saveAsInstead', { name: doc.title }));
      return saveAsOutcome(doc.id);
    }

    return write(doc.id, doc.path, stat);
  }

  const saveAs = async (id?: DocId): Promise<boolean> => (await saveAsOutcome(id)) === 'saved';
  const save = async (id?: DocId): Promise<boolean> => (await saveOutcome(id)) === 'saved';

  /**
   * Saves every dirty document, and names what it did not save.
   *
   * **`stopOnCancel` is the difference between the command and the close paths.** Save All
   * over three dirty tabs, one of them an untitled scratch note, used to abort at that
   * note's cancelled Save As: the third tab — a real program with a shift's edits in it —
   * was never written, and the status bar read "Saved <the first file>", which looks like
   * success (G8 M5). For the command the answer is to carry on: "save all" on a named file
   * is unambiguous, and only the untitled one needed a decision. `closeAll` and
   * `confirmQuit` then **throw the document away**, so for them a cancelled Save As must
   * still abort the whole thing, or the note the user declined to save is lost without a
   * word.
   *
   * A write that *failed* stops either way: a full disk or a lost share fails for the next
   * file too, and it has already shown its own error box.
   *
   * The boolean is "everything dirty is now on disk", which is what the close paths ask.
   */
  async function saveAll(o?: { stopOnCancel?: boolean }): Promise<boolean> {
    const stopOnCancel = o?.stopOnCancel === true;
    let saved = 0;
    const skipped: string[] = [];
    let stopped = false;
    for (const doc of [...docs.all()]) {
      const current = docs.get(doc.id);
      if (!current?.dirty) continue;
      if (stopped) {
        skipped.push(current.title);
        continue;
      }
      const outcome = current.path
        ? await saveOutcome(current.id)
        : await saveAsOutcome(current.id);
      if (outcome === 'saved') {
        saved++;
        continue;
      }
      skipped.push(current.title);
      if (outcome === 'failed' || stopOnCancel) stopped = true;
    }

    if (skipped.length === 0) {
      if (saved > 1) status.show(t('files.savedAll', { count: saved }));
      return true;
    }
    // Never silent: the one thing the old code did not do. The names are what makes it
    // actionable — "two of them" is not something a programmer can act on at shift end.
    const names = skipped.slice(0, MAX_LISTED).join(', ');
    const list =
      skipped.length > MAX_LISTED
        ? `${names}, ${t('files.unsavedMore', { count: skipped.length - MAX_LISTED })}`
        : names;
    status.show(t('files.savedAllPartial', { saved, list }), { error: true });
    return false;
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
    // `stopOnCancel`: everything here is about to be dropped, so a Save As the user
    // cancelled has to stop the close rather than be skipped over.
    if (decision === 'save' && !(await saveAll({ stopOnCancel: true }))) return false;
    for (const doc of [...docs.all()]) drop(doc.id);
    newUntitled();
    return true;
  }

  async function confirmQuit(): Promise<boolean> {
    const decision = await askUnsaved(docs.all().filter((doc) => doc.dirty));
    if (decision === 'cancel') return false;
    // Same as `closeAll`: the window is about to go.
    if (decision === 'save') return saveAll({ stopOnCancel: true });
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
    // The read above is an await, and on a share or a large file it is a long one. A
    // reload that was started on a *clean* document — the AD-10 auto-reload — must not
    // overwrite text the user typed while the file was being read: it is one undo step,
    // but nothing would tell them it happened. The banner's explicit Reload starts on a
    // dirty document and is meant to overwrite it, so it is unaffected. The caller sees
    // the refusal in `doc.disk`, which has not moved (G8 M2).
    const fresh = docs.get(id);
    if (!fresh || fresh.path !== doc.path) return;
    if (!doc.dirty && fresh.dirty) return;
    // One undo step, cursor line kept (§7.2).
    editor.replaceAll(id, decoded.text, { keepCursorLine: true });
    editor.markClean(id);
    const stat = await statOne(doc.path);
    docs.update(id, {
      encoding: decoded.encoding,
      eol: decoded.eol ?? doc.eol,
      eolMixedOnLoad: decoded.eolMixed,
      nul: decoded.nul,
      textDirty: false,
      metaDirty: decoded.nul.stripped > 0,
      // The same rule as after a write: a stat that did not answer may not erase the
      // mtime the document had, or the poll compares sizes alone from then on.
      disk: restamp(bytes, stat, doc.disk),
      external: 'none',
    });
    status.show(t('files.reloaded', { name: doc.title }));
  }

  // -- M7: crash recovery and read-only documents ---------------------------

  /**
   * Binds a restored snapshot to the file it came from, once `files_stat` has said the
   * fs scope allows it (AD-21).
   *
   * Why this is a second step. `restoreDocument` is synchronous (§7.9) and the question
   * "may this app touch that path?" is a round trip — `files_stat` is it, and it answers
   * `allowed: false` without saying whether the file exists and without granting
   * anything. So the document is created **unbound**, which is the safe end of the
   * decision: an unbound document can only reach the disk through Save As, where the
   * user picks the file in the native dialog. The binding then lands a tick later, and
   * the tab's text does not move, because an unbound restored document already shows the
   * file's name.
   *
   * It gives up rather than guess whenever the document has moved on in the meantime:
   * closed, already saved somewhere, or a second tab that now owns the path (two tabs on
   * one file each believe they own it, and the second save discards the first).
   *
   * The binding is the moment this document becomes "that file open in gEdit", so it is
   * also the moment `onDidOpen` belongs: without it a recovered program is the one tab
   * that never joins the per-file memory (its cursor and bookmarks are neither restored
   * nor written back) and never reaches the Recent list (M7 integration, mergeA).
   *
   * **A snapshot with no stamp binds with the banner up.** There is then nothing to
   * hold the file against — `outlookOf` already says as much in the dialog ("gEdit
   * cannot tell whether this changed") — and binding it quietly would hand the tab a
   * file it has never compared with anything, which the next Cmd+S would overwrite.
   * `external: 'changed'` puts the AD-10 banner in front of the text instead, and
   * `write` asks before it writes (G8 M7).
   */
  async function bindRestored(id: DocId, path: string, diskStamp: DiskStamp | null): Promise<void> {
    const stat = await statOne(path);
    if (stat?.allowed !== true) return;
    const doc = docs.get(id);
    if (!doc || doc.path !== null || doc.proposedPath !== path) return;
    const other = docs.byPath(path);
    if (other && other.id !== id) return;
    const unknown = diskStamp === null && stat.exists;
    docs.update(id, {
      path,
      untitledIndex: null,
      proposedPath: null,
      disk: diskStamp,
      ...(unknown ? { external: 'changed' } : {}),
    });
    openEvent.fire(id, path);
  }

  /**
   * Opens a crash-recovery snapshot as a dirty document (AD-21).
   *
   * The text is the one copy of that work left, so nothing here can refuse it: whatever
   * the metadata says, a document with the snapshot's text appears. What the metadata
   * decides is only how much of the *file* comes with it (see `bindRestored`).
   *
   * `metaDirty` rather than `textDirty` carries the dirty flag: the model is created
   * from this text and is therefore clean by construction, so a flag that the editor
   * recomputes would be cleared by the first undo. `metaDirty` is exactly "the buffer no
   * longer matches the file", which is what a snapshot is, and a save clears it.
   *
   * `o.title` is not read. For a snapshot that has a path it is `basename(path)`, which
   * the store derives anyway; for one that has none it named an untitled document of a
   * session that is over, and handing that name back would either collide with an open
   * tab's index or become the Save As default in place of the profile's file name.
   */
  function restoreDocument(o: {
    path: string | null;
    title: string;
    profileId: string;
    machineId?: string | null;
    encoding: FileEncoding;
    eol: Eol;
    nul: NulInfo;
    textLF: string;
    diskStamp: DiskStamp | null;
  }): DocId {
    const profileId = profiles.get(o.profileId) ? o.profileId : profiles.defaultId();
    // The same rule `open()` follows, and AD-22 asks of the session restore: recovered
    // work takes the place of the empty document the window started with, instead of
    // being handed back beside a stray `Untitled-1` (M7 integration, mergeA).
    const scratch = scratchDocument();
    const id = docs.add(
      {
        path: null,
        // An untitled snapshot gets a fresh index: the one it had belonged to a session
        // that is over, and reusing it could collide with a tab that is open now.
        untitledIndex: o.path === null ? docs.nextUntitledIndex() : null,
        proposedPath: o.path,
        profileId,
        ...(o.machineId !== undefined ? { machineId: o.machineId } : {}),
        encoding: o.encoding,
        eol: o.eol,
        eolMixedOnLoad: false,
        nul: o.nul,
        textDirty: false,
        metaDirty: true,
        disk: null,
        external: 'none',
        // Recovered work is editable even when its file is not: the lock belongs to the
        // file, and Save of a read-only file goes to Save As anyway (`saveOutcome`).
        readOnly: false,
        readOnlyReason: null,
      },
      { activate: true },
    );
    editor.createModel(id, o.textLF, profileId, o.eol);
    // After the model: the snapshot is on screen before the empty tab it replaces goes.
    if (scratch !== null && scratch !== id) drop(scratch);
    if (o.path !== null) {
      void bindRestored(id, o.path, o.diskStamp).catch((err: unknown) => {
        // The document is already on screen with its text; only the binding is lost.
        console.error(`the restored document could not be bound to ${o.path}`, err);
      });
    }
    return id;
  }

  /**
   * Locks or unlocks the buffer (AD-23).
   *
   * `readOnlyReason` says where the lock came from, and unlocking always clears it: a
   * `user` lock is simply undone, and an `attribute` lock frees the **buffer** only —
   * Save still goes to Save As, because `saveOutcome` re-reads the file's own attribute
   * instead of trusting a remembered one. The editor option follows from
   * `monaco/editorService.ts`, which watches the active document.
   */
  function setReadOnly(id: DocId, readOnly: boolean): void {
    const doc = docs.get(id);
    if (!doc || doc.readOnly === readOnly) return;
    docs.update(id, { readOnly, readOnlyReason: readOnly ? 'user' : null });
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
    restoreDocument,
    setReadOnly,

    onDidOpen(cb: (id: DocId, path: string) => void): Disposable {
      return openEvent.add(cb);
    },
    onDidSave(cb: (id: DocId, path: string) => void): Disposable {
      return saveEvent.add(cb);
    },
    onWillClose(cb: (id: DocId) => void): Disposable {
      return willCloseEvent.add(cb);
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
  backup: filesBackup,
  fileMemory: appFileMemory,
  isTauri: isTauriRuntime,
});
