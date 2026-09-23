// The file operations (plan §5 WP1.6, §7.2, AD-7): opening, the save pipeline, the close
// decision table and the one combined dialog that covers every unsaved document.
//
// The real document store and the real codec are used; only the editor, the native
// dialogs, the file system and `files_stat` are fakes, so a test never needs Monaco or a
// webview. The encoding fixtures under `tests/fixtures/nc/encoding` are the same bytes
// the runtime scenarios open.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFileOps,
  diskChanged,
  formatBytes,
  MAX_OPEN_AT_ONCE,
  MAX_OPEN_BYTES,
  type FileOpsDeps,
  type FileSystemAccess,
} from './fileOps';
import { createExternalChangeService } from './external';
import { outlookOf } from './recovery';
import { createDocumentStore } from '$lib/stores/documents';
import { decodeFile } from '$lib/core/text';
import { createProfileRegistry } from '$lib/stores/profiles';
import { baseName } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import type { FileStat } from '$lib/platform/commands';
import type {
  ContentChange,
  CursorInfo,
  Disposable,
  DocId,
  DocumentStore,
  EditorService,
  Eol,
  ExternalChangeService,
  FileMemoryStore,
  NativeDialogs,
  RecoveryEntry,
  StatusService,
} from '$lib/app/types';

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));

function fixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURES}${rel}`));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A text buffer per document with the version bookkeeping the dirty flag needs. */
interface FakeEditor extends EditorService {
  /** Test seam: an edit the user made. */
  type(id: DocId, textLF: string): void;
  calls: string[];
  languages: Map<DocId, string>;
  eols: Map<DocId, Eol>;
  focusCount: number;
}

function createFakeEditor(docs: DocumentStore): FakeEditor {
  const texts = new Map<DocId, string>();
  const versions = new Map<DocId, number>();
  const cleanAt = new Map<DocId, number>();
  const languages = new Map<DocId, string>();
  const eols = new Map<DocId, Eol>();
  const calls: string[] = [];

  function sync(id: DocId): void {
    const dirty = versions.get(id) !== cleanAt.get(id);
    if (docs.get(id)?.textDirty !== dirty) docs.update(id, { textDirty: dirty });
  }

  function change(id: DocId, textLF: string): void {
    if (!texts.has(id)) return;
    texts.set(id, textLF);
    versions.set(id, (versions.get(id) ?? 0) + 1);
    sync(id);
  }

  const never = (): never => {
    throw new Error('not used by these tests');
  };
  const off = (): Disposable => () => {};

  const editor: FakeEditor = {
    calls,
    languages,
    eols,
    focusCount: 0,
    type: change,

    attach: () => Promise.resolve(),
    ready: Promise.resolve(),

    createModel(id, textLF, languageId, eol) {
      calls.push(`createModel:${id}`);
      texts.set(id, textLF);
      versions.set(id, 1);
      cleanAt.set(id, 1);
      languages.set(id, languageId);
      eols.set(id, eol);
    },
    disposeModel(id) {
      calls.push(`disposeModel:${id}`);
      texts.delete(id);
      versions.delete(id);
      cleanAt.delete(id);
      languages.delete(id);
      eols.delete(id);
    },
    hasModel: (id) => texts.has(id),
    getText: (id) => texts.get(id) ?? '',
    getLineCount: (id) => (texts.get(id) ?? '').split('\n').length,
    getLines: (id, start, end) => (texts.get(id) ?? '').split('\n').slice(start - 1, end),
    versionId: (id) => versions.get(id) ?? 0,
    markClean(id) {
      calls.push(`markClean:${id}`);
      cleanAt.set(id, versions.get(id) ?? 0);
      sync(id);
    },
    setLanguage(id, languageId) {
      calls.push(`setLanguage:${id}:${languageId}`);
      languages.set(id, languageId);
    },
    setModelEol(id, eol) {
      calls.push(`setModelEol:${id}:${eol}`);
      eols.set(id, eol);
    },
    replaceAll(id, textLF) {
      calls.push(`replaceAll:${id}`);
      change(id, textLF);
    },
    insertText: never,
    focus() {
      editor.focusCount++;
    },
    hasFocus: () => false,
    reveal: never,
    cursor: (): CursorInfo | null => null,
    selectionLines: () => null,
    selectedText: () => '',
    triggerAction: never,
    updateOptions: () => {},
    onDidChangeContent: (_cb: (id: DocId, c: ContentChange) => void) => off(),
    onDidChangeCursor: () => off(),
    onDidCreateModel: () => off(),
    onDidActivate: () => off(),
    model: never,
    editorInstance: never,
  };
  return editor;
}

interface DialogCall {
  kind: 'ask3' | 'confirm' | 'error' | 'openFiles' | 'saveFile';
  args: Record<string, unknown>;
}

interface FakeDialogs extends NativeDialogs {
  calls: DialogCall[];
  answers: {
    ask3: ('yes' | 'no' | 'cancel')[];
    confirm: boolean[];
    openFiles: string[][];
    saveFile: (string | null)[];
  };
}

function createFakeDialogs(): FakeDialogs {
  const calls: DialogCall[] = [];
  const answers: FakeDialogs['answers'] = { ask3: [], confirm: [], openFiles: [], saveFile: [] };
  let busy = false;

  return {
    calls,
    answers,
    async ask3(o) {
      calls.push({ kind: 'ask3', args: { ...o } });
      return answers.ask3.shift() ?? 'cancel';
    },
    async confirm(o) {
      calls.push({ kind: 'confirm', args: { ...o } });
      return answers.confirm.shift() ?? false;
    },
    async error(summary, detail) {
      calls.push({ kind: 'error', args: { summary, detail: String(detail) } });
    },
    async openFiles(o) {
      calls.push({ kind: 'openFiles', args: { ...o } });
      return answers.openFiles.shift() ?? [];
    },
    async saveFile(o) {
      calls.push({ kind: 'saveFile', args: { ...o } });
      return answers.saveFile.shift() ?? null;
    },
    async pickFolder() {
      return null;
    },
    async pickFile() {
      return null;
    },
    async exclusive(op) {
      if (busy) return undefined;
      busy = true;
      try {
        return await op();
      } finally {
        busy = false;
      }
    },
  };
}

interface FakeStatus extends StatusService {
  messages: { text: string; error: boolean }[];
  last(): string;
}

function createFakeStatus(): FakeStatus {
  const messages: { text: string; error: boolean }[] = [];
  return {
    messages,
    last: () => messages[messages.length - 1]?.text ?? '',
    current: { subscribe: () => () => {} },
    show(text, o) {
      messages.push({ text, error: o?.error === true });
    },
    clear() {
      messages.length = 0;
    },
  };
}

/** An in-memory disk. `mtime` only moves when something is written. */
function createFakeFs(): FileSystemAccess & {
  files: Map<string, Uint8Array>;
  mtimes: Map<string, number>;
  /** A stat size that is not the byte length, for the "too large to read" guard. */
  sizes: Map<string, number>;
  writes: string[];
  readFailures: Set<string>;
  writeFailures: Set<string>;
  /** Paths whose `files_stat` answers `readonly: true` (M7, AD-23). */
  readOnly: Set<string>;
  /** Paths the fs scope does not allow, so `files_stat` answers `allowed: false`. */
  forbidden: Set<string>;
} {
  const files = new Map<string, Uint8Array>();
  const mtimes = new Map<string, number>();
  const sizes = new Map<string, number>();
  const writes: string[] = [];
  const readFailures = new Set<string>();
  const writeFailures = new Set<string>();
  const readOnly = new Set<string>();
  const forbidden = new Set<string>();
  let clock = 1000;
  return {
    files,
    mtimes,
    sizes,
    writes,
    readFailures,
    writeFailures,
    readOnly,
    forbidden,
    async readFile(path) {
      if (readFailures.has(path)) throw new Error(`cannot read ${path}`);
      const bytes = files.get(path);
      if (!bytes) throw new Error(`no such file: ${path}`);
      return bytes;
    },
    async writeFile(path, bytes) {
      if (writeFailures.has(path)) throw new Error(`cannot write ${path}`);
      writes.push(path);
      files.set(path, bytes);
      mtimes.set(path, (clock += 1000));
    },
  };
}

/**
 * The Rust `files_backup` (M7, AD-21), as a fake: it records the order it was called in
 * against the writes, and `failures` makes the copy fail the way a full disk or a lost
 * share would.
 */
interface FakeBackup {
  calls: string[];
  /** Paths whose backup rejects. */
  failures: Set<string>;
  /** Paths with nothing to copy — `files.backup` is off, or the file is new. */
  nothing: Set<string>;
  backup(path: string): Promise<string | null>;
}

function createFakeBackup(trace: string[]): FakeBackup {
  const fake: FakeBackup = {
    calls: [],
    failures: new Set<string>(),
    nothing: new Set<string>(),
    async backup(path) {
      fake.calls.push(path);
      trace.push(`backup:${path}`);
      if (fake.failures.has(path)) throw new Error(`cannot copy ${path}`);
      return fake.nothing.has(path) ? null : `/backups/${baseName(path)}`;
    },
  };
  return fake;
}

/** Per-file memory (M7, AD-22) as two lookup tables; WP7.5 owns the real one. */
interface FakeMemory {
  profiles: Map<string, string>;
  /** `null` is a remembered "none", a missing key is "nothing remembered" (AD-31). */
  machines: Map<string, string | null>;
  store: Pick<FileMemoryStore, 'profileFor' | 'machineFor'>;
}

function createFakeMemory(): FakeMemory {
  const fake: FakeMemory = {
    profiles: new Map<string, string>(),
    machines: new Map<string, string | null>(),
    store: {
      profileFor: (path) => fake.profiles.get(path),
      machineFor: (path) => (fake.machines.has(path) ? fake.machines.get(path) : undefined),
    },
  };
  return fake;
}

interface Harness {
  docs: DocumentStore;
  editor: FakeEditor;
  dialogs: FakeDialogs;
  status: FakeStatus;
  fs: ReturnType<typeof createFakeFs>;
  backup: FakeBackup;
  memory: FakeMemory;
  /** `backup:<path>` and `write:<path>`, in the order they happened. */
  trace: string[];
  files: ReturnType<typeof createFileOps>;
  /**
   * The real AD-10 poll over the same fake disk, so the cases where the two modules
   * disagree about a document can be driven end to end (G8 M7).
   */
  external: ExternalChangeService;
  /** Makes every `files_stat` reject, the way a dropped IPC call does. */
  statFails: { now: boolean };
  put(path: string, rel: string): string;
}

function setup(o: { isTauri?: boolean; filtersSupported?: boolean } = {}): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const editor = createFakeEditor(docs);
  const dialogs = createFakeDialogs();
  const status = createFakeStatus();
  const fs = createFakeFs();
  const trace: string[] = [];
  const backup = createFakeBackup(trace);
  const memory = createFakeMemory();
  const profiles = createProfileRegistry({ filtersSupported: o.filtersSupported ?? true });

  const write = fs.writeFile;
  fs.writeFile = async (path, bytes) => {
    trace.push(`write:${path}`);
    await write(path, bytes);
  };

  const statFails = { now: false };
  const filesStat: FileOpsDeps['filesStat'] = async (paths) => {
    if (statFails.now) throw new Error('files_stat: the IPC call failed');
    return paths.map((path): FileStat => {
      // A forbidden path answers `allowed: false` and nothing else, so a caller never
      // learns whether it exists (§7.6).
      if (fs.forbidden.has(path)) {
        return { path, allowed: false, exists: false, isDir: false, mtimeMs: null, size: null, readonly: false };
      }
      return {
        path,
        allowed: true,
        exists: fs.files.has(path),
        isDir: false,
        mtimeMs: fs.mtimes.get(path) ?? null,
        size: fs.sizes.get(path) ?? fs.files.get(path)?.length ?? null,
        readonly: fs.readOnly.has(path),
      };
    });
  };

  const files = createFileOps({
    docs,
    editor,
    dialogs,
    status,
    profiles,
    fs,
    filesStat,
    backup: (path) => backup.backup(path),
    fileMemory: memory.store,
    isTauri: () => o.isTauri ?? true,
  });

  const external = createExternalChangeService({
    docs,
    files,
    status,
    filesStat,
    readFile: (path) => fs.readFile(path),
    policy: () => 'ask',
    hasFocus: () => true,
    watchFocus: () => () => {},
    intervalMs: 2000,
  });

  return {
    docs,
    editor,
    dialogs,
    status,
    fs,
    backup,
    memory,
    trace,
    files,
    external,
    statFails,
    put(path, rel) {
      fs.files.set(path, fixture(rel));
      fs.mtimes.set(path, 500);
      return path;
    },
  };
}

// ---------------------------------------------------------------------------

let h: Harness;

beforeEach(() => {
  h = setup();
  vi.restoreAllMocks();
});

describe('newUntitled', () => {
  it('numbers untitled documents from 1 and reuses a freed index', async () => {
    const first = h.files.newUntitled();
    const second = h.files.newUntitled();
    expect(h.docs.get(first)?.title).toBe('Untitled-1');
    expect(h.docs.get(second)?.title).toBe('Untitled-2');

    await h.files.close(first);
    expect(h.docs.get(h.files.newUntitled())?.title).toBe('Untitled-1');
  });

  it('is UTF-8 without a BOM, uses the profile line ending and creates a model', () => {
    const id = h.files.newUntitled({ text: 'G0 X0' });
    const doc = h.docs.get(id);
    expect(doc?.encoding).toEqual({ encoding: 'utf-8', hasBom: false });
    expect(doc?.eol).toBe('crlf'); // newFileLineEnding, AD-7
    expect(doc?.profileId).toBe('fanuc-gcode');
    expect(doc?.dirty).toBe(false);
    expect(doc?.disk).toBeNull();
    expect(h.editor.getText(id)).toBe('G0 X0');
    expect(h.editor.eols.get(id)).toBe('crlf');
  });
});

describe('open', () => {
  it('opens several files as several tabs and drops the untouched scratch buffer', async () => {
    h.files.newUntitled({ text: '% \nO1000\n%' });
    const paths = [
      h.put('/nc/a.nc', 'nc/fanuc/f01-mill-3tools.nc'),
      h.put('/nc/b.h', 'nc/heidenhain/h01-3tools.h'),
      h.put('/nc/c.nc', 'nc/encoding/utf8-lf.nc'),
    ];

    const ids = await h.files.open(paths);

    expect(ids).toHaveLength(3);
    expect(h.docs.all().map((d) => d.title)).toEqual(['a.nc', 'b.h', 'c.nc']);
    expect(h.docs.getActiveId()).toBe(ids[2]);
    expect(h.editor.focusCount).toBeGreaterThan(0);
  });

  it('keeps an edited scratch buffer', async () => {
    const scratch = h.files.newUntitled();
    h.editor.type(scratch, 'G0 X1');
    await h.files.open([h.put('/nc/a.nc', 'nc/fanuc/f01-mill-3tools.nc')]);
    expect(h.docs.all()).toHaveLength(2);
  });

  it('focuses a document that is already open instead of opening it twice', async () => {
    const path = h.put('/nc/a.nc', 'nc/fanuc/f01-mill-3tools.nc');
    const [first] = await h.files.open([path]);
    h.files.newUntitled();
    expect(h.docs.getActiveId()).not.toBe(first);

    const again = await h.files.open([path]);

    expect(again).toEqual([first]);
    expect(h.docs.all().filter((d) => d.path === path)).toHaveLength(1);
    expect(h.docs.getActiveId()).toBe(first);
    expect(h.status.last()).toBe(t('files.focused', { name: 'a.nc' }));
  });

  it('detects the dialect from the file and sets the Monaco language', async () => {
    const [id] = await h.files.open([h.put('/nc/b.h', 'nc/heidenhain/h01-3tools.h')]);
    expect(h.docs.get(id)?.profileId).toBe('heidenhain-klartext');
    expect(h.editor.languages.get(id)).toBe('heidenhain-klartext');
  });

  it('records the encoding, the line ending and the disk stamp', async () => {
    const [id] = await h.files.open([h.put('/nc/bom.nc', 'nc/encoding/utf8-bom-crlf.nc')]);
    const doc = h.docs.get(id);
    expect(doc?.encoding).toEqual({ encoding: 'utf-8', hasBom: true });
    expect(doc?.eol).toBe('crlf');
    expect(doc?.disk?.size).toBe(fixture('nc/encoding/utf8-bom-crlf.nc').length);
    expect(doc?.disk?.mtimeMs).toBe(500);
    expect(doc?.dirty).toBe(false);
  });

  it('marks a document modified when inner NUL bytes were stripped', async () => {
    const [id] = await h.files.open([h.put('/nc/nul.nc', 'nc/encoding/nul-inside.nc')]);
    const doc = h.docs.get(id);
    expect(doc?.nul.stripped).toBeGreaterThan(0);
    expect(doc?.metaDirty).toBe(true);
    expect(doc?.dirty).toBe(true);
    expect(h.status.last()).toContain(t('files.nulStripped', { count: doc?.nul.stripped ?? 0, name: 'nul.nc' }));
  });

  it('says so when a file arrived with mixed line endings', async () => {
    const [id] = await h.files.open([h.put('/nc/mixed.nc', 'nc/encoding/mixed-eol.nc')]);
    expect(h.docs.get(id)?.eolMixedOnLoad).toBe(true);
    expect(h.status.last()).toContain('mixed line endings');
  });

  it('refuses a binary file with an error dialog and opens no tab', async () => {
    await h.files.open([h.put('/nc/bin.bin', 'nc/encoding/nul-heavy.bin')]);
    expect(h.docs.all()).toHaveLength(0);
    const error = h.dialogs.calls.find((c) => c.kind === 'error');
    expect(error?.args.summary).toBe(t('files.openFailed', { name: 'bin.bin' }));
    expect(String(error?.args.detail)).toContain('NUL bytes');
    expect(h.status.messages.at(-1)?.error).toBe(true);
  });

  it('reports a file it cannot read and carries on with the rest', async () => {
    h.put('/nc/a.nc', 'nc/fanuc/f01-mill-3tools.nc');
    h.fs.readFailures.add('/nc/a.nc');
    const ids = await h.files.open(['/nc/a.nc', h.put('/nc/b.h', 'nc/heidenhain/h01-3tools.h')]);
    expect(ids).toHaveLength(1);
    expect(h.docs.all().map((d) => d.title)).toEqual(['b.h']);
  });

  // G8 M5: a select-all in a job directory with a scanned setup sheet and a binary tool
  // file in it popped one blocking NSAlert per refused file, to be clicked through before
  // the good programs were usable — and then suppressed the "Opened N files" summary.
  describe('a multi-file Open with refusals in it', () => {
    async function openThree(): Promise<void> {
      await h.files.open([
        h.put('/nc/bad-a.bin', 'nc/encoding/nul-heavy.bin'),
        h.put('/nc/bad-b.bin', 'nc/encoding/nul-heavy.bin'),
        h.put('/nc/good.nc', 'nc/fanuc/f01-mill-3tools.nc'),
      ]);
    }

    it('shows one dialog for the whole Open, not one per file', async () => {
      await openThree();
      const errors = h.dialogs.calls.filter((c) => c.kind === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].args.summary).toBe(t('files.openFailedMany', { count: 2 }));
    });

    it('names every refused file and why, in that one dialog', async () => {
      await openThree();
      const detail = String(h.dialogs.calls.find((c) => c.kind === 'error')?.args.detail);
      expect(detail).toContain('bad-a.bin');
      expect(detail).toContain('bad-b.bin');
      expect(detail).toContain('NUL bytes');
      expect(detail.split('\n')).toHaveLength(2);
    });

    it('still opens the programs that are programs', async () => {
      await openThree();
      expect(h.docs.all().map((d) => d.title)).toEqual(['good.nc']);
    });

    it('still summarises what was opened, and marks the message as a failure', async () => {
      await openThree();
      const last = h.status.messages.at(-1);
      expect(last?.text).toContain(t('files.opened', { name: 'good.nc' }));
      expect(last?.text).toContain(t('files.openFailedMany', { count: 2 }));
      expect(last?.error).toBe(true);
    });

    it('keeps the blocking box for a single file, which is what the user asked for', async () => {
      await h.files.open([h.put('/nc/only.bin', 'nc/encoding/nul-heavy.bin')]);
      const errors = h.dialogs.calls.filter((c) => c.kind === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].args.summary).toBe(t('files.openFailed', { name: 'only.bin' }));
    });
  });

  it('asks for the files when no path is given, with multi-select', async () => {
    h.put('/nc/a.nc', 'nc/fanuc/f01-mill-3tools.nc');
    h.dialogs.answers.openFiles.push(['/nc/a.nc']);
    await h.files.open();
    expect(h.dialogs.calls[0]).toEqual({ kind: 'openFiles', args: { multiple: true } });
  });

  it('does nothing when the dialog is cancelled', async () => {
    h.dialogs.answers.openFiles.push([]);
    expect(await h.files.open()).toEqual([]);
    expect(h.docs.all()).toHaveLength(0);
  });

  it('says that file operations need the desktop app outside Tauri', async () => {
    const browser = setup({ isTauri: false });
    expect(await browser.files.open()).toEqual([]);
    expect(browser.status.last()).toBe(t('files.desktopOnly'));
  });

  // G8 F4: nothing stopped a multi-gigabyte file from being pulled through IPC into the
  // webview, because the stat that knows the size ran *after* the whole read.
  describe('the size and count guards', () => {
    it('refuses a file above the limit without ever reading it', async () => {
      const path = '/nc/huge.nc';
      h.fs.files.set(path, new Uint8Array(0));
      h.fs.mtimes.set(path, 500);
      h.fs.sizes.set(path, 4 * MAX_OPEN_BYTES);
      const read = vi.spyOn(h.fs, 'readFile');

      expect(await h.files.open([path])).toEqual([]);

      expect(read).not.toHaveBeenCalled();
      expect(h.docs.all()).toHaveLength(0);
      const error = h.dialogs.calls.find((c) => c.kind === 'error');
      expect(error?.args.summary).toBe(t('files.openFailed', { name: 'huge.nc' }));
      expect(String(error?.args.detail)).toBe(
        t('files.tooLarge', { name: 'huge.nc', size: '200 MB', limit: '50 MB' }),
      );
    });

    it('opens a file that is exactly at the limit', async () => {
      const path = h.put('/nc/big.nc', 'nc/encoding/utf8-lf.nc');
      h.fs.sizes.set(path, MAX_OPEN_BYTES);
      expect(await h.files.open([path])).toHaveLength(1);
    });

    it('opens at most MAX_OPEN_AT_ONCE files and says how many it left', async () => {
      const paths = Array.from({ length: MAX_OPEN_AT_ONCE + 3 }, (_, i) =>
        h.put(`/nc/many-${i}.nc`, 'nc/encoding/utf8-lf.nc'),
      );

      const ids = await h.files.open(paths);

      expect(ids).toHaveLength(MAX_OPEN_AT_ONCE);
      expect(h.docs.all()).toHaveLength(MAX_OPEN_AT_ONCE);
      expect(h.status.last()).toContain(
        t('files.tooManyAtOnce', { count: MAX_OPEN_AT_ONCE, total: paths.length }),
      );
    });

    it('formats a size a message can name', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(9 * 1024 * 1024)).toBe('9.0 MB');
      expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
      expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB');
    });
  });
});

describe('save', () => {
  /** Opens a fixture and makes the buffer dirty without changing a single byte. */
  async function openDirty(path: string, rel: string): Promise<DocId> {
    h.put(path, rel);
    const [id] = await h.files.open([path]);
    h.editor.type(id, h.editor.getText(id));
    return id;
  }

  it.each([
    ['utf8-lf.nc', 'nc/encoding/utf8-lf.nc'],
    ['utf8-bom-crlf.nc', 'nc/encoding/utf8-bom-crlf.nc'],
    ['cp1252-crlf.nc', 'nc/encoding/cp1252-crlf.nc'],
    ['cr-only.nc', 'nc/encoding/cr-only.nc'],
    ['utf16le-bom.nc', 'nc/encoding/utf16le-bom.nc'],
    ['utf16be-bom.nc', 'nc/encoding/utf16be-bom.nc'],
    ['nul-leader-trailer.nc', 'nc/encoding/nul-leader-trailer.nc'],
  ])('writes %s back byte for byte: encoding, BOM, line ending and NUL leader/trailer', async (name, rel) => {
    const path = `/nc/${name}`;
    const id = await openDirty(path, rel);

    expect(await h.files.save(id)).toBe(true);

    expect(hex(h.fs.files.get(path) as Uint8Array)).toBe(hex(fixture(rel)));
    expect(h.docs.get(id)?.dirty).toBe(false);
    expect(h.status.last()).toBe(t('files.saved', { name }));
  });

  it('writes a tape program picked as UTF-16 so that it opens again', async () => {
    // G8 F1: the status-bar QuickPick offers UTF-16 for any document. The leader used to
    // be written in front of the byte order mark, which made the saved file unreadable —
    // for gEdit and for everything else — with the original bytes already gone.
    const path = '/nc/tape.nc';
    const id = await openDirty(path, 'nc/encoding/nul-leader-trailer.nc');
    const text = h.editor.getText(id);
    h.files.setEncoding(id, { encoding: 'utf-16le', hasBom: true });

    expect(await h.files.save(id)).toBe(true);

    const written = h.fs.files.get(path) as Uint8Array;
    expect([...written.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const reopened = decodeFile(written);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.text).toBe(text);
    expect(reopened.encoding).toEqual({ encoding: 'utf-16le', hasBom: true });
    // The document has to stop claiming a leader, or saving it back as UTF-8 later would
    // write one the file no longer has.
    expect(h.docs.get(id)?.nul).toEqual({ leader: 0, trailer: 0, stripped: 0 });
    // G8 M5: a lost tape leader is a loss, not a footnote. It carries the warning
    // styling and an error's 8 s, because the 4 s a plain "Saved …" lives for is not
    // enough to notice that the punched-tape framing has gone.
    const last = h.status.messages.at(-1);
    expect(last?.text).toBe(`${t('files.saved', { name: 'tape.nc' })} · ${t('files.tapeDropped')}`);
    expect(last?.error).toBe(true);
  });

  it('shows an ordinary save without the warning styling', async () => {
    const id = await openDirty('/nc/plain.nc', 'nc/encoding/utf8-lf.nc');
    await h.files.save(id);
    expect(h.status.messages.at(-1)?.error).toBe(false);
  });

  it('keeps the CR line endings of an edited tape file', async () => {
    const id = await openDirty('/nc/cr.nc', 'nc/encoding/cr-only.nc');
    h.editor.type(id, 'G0 X1\nG0 X2\n');
    await h.files.save(id);
    const written = new TextDecoder('latin1').decode(h.fs.files.get('/nc/cr.nc'));
    expect(written).toBe('G0 X1\rG0 X2\r');
  });

  it('writes a mixed file with the majority line ending', async () => {
    const id = await openDirty('/nc/mixed.nc', 'nc/encoding/mixed-eol.nc');
    const eol = h.docs.get(id)?.eol;
    await h.files.save(id);
    const written = new TextDecoder().decode(h.fs.files.get('/nc/mixed.nc'));
    expect(['crlf', 'lf', 'cr']).toContain(eol);
    expect(written.includes('\r\n')).toBe(eol === 'crlf');
  });

  it('clears the mixed-line-ending mark once the file has been written uniformly', async () => {
    const id = await openDirty('/nc/mixed.nc', 'nc/encoding/mixed-eol.nc');
    expect(h.docs.get(id)?.eolMixedOnLoad).toBe(true);
    await h.files.save(id);
    // The file on disk now has one kind of line break, so the status bar must stop
    // saying "(mixed)" — `components/status/EolStatus.svelte` promises exactly that.
    expect(h.docs.get(id)?.eolMixedOnLoad).toBe(false);
  });

  it('does not rewrite a clean file that is still on disk', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);

    expect(await h.files.save(id)).toBe(true);

    expect(h.fs.writes).toEqual([]);
    expect(h.status.last()).toBe(t('files.unchanged', { name: 'a.nc' }));
  });

  it('does rewrite a clean file that has disappeared', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.fs.files.delete(path);

    expect(await h.files.save(id)).toBe(true);
    expect(h.fs.writes).toEqual([path]);
  });

  it('sends an untitled document to Save As', async () => {
    const id = h.files.newUntitled({ text: 'G0 X0\n' });
    h.editor.type(id, 'G0 X1\n');
    h.dialogs.answers.saveFile.push('/nc/new.nc');

    expect(await h.files.save(id)).toBe(true);

    const call = h.dialogs.calls.find((c) => c.kind === 'saveFile');
    expect(call?.args).toEqual({ defaultPath: 'program.nc', profileId: 'fanuc-gcode' });
    expect(h.docs.get(id)?.title).toBe('new.nc');
    expect(h.docs.get(id)?.untitledIndex).toBeNull();
    expect(h.docs.get(id)?.dirty).toBe(false);
  });

  it('reports a write failure, says the file may be incomplete and leaves the document dirty', async () => {
    const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    h.fs.writeFailures.add('/nc/a.nc');

    expect(await h.files.save(id)).toBe(false);

    expect(h.docs.get(id)?.dirty).toBe(true);
    expect(h.status.messages.at(-1)?.error).toBe(true);
    // G8 F6: the write truncates in place, so a failure can leave the file short. The
    // message has to say so, and the buffer must not be the only offer on the table.
    const asked = h.dialogs.calls.find((c) => c.kind === 'confirm');
    expect(asked?.args.title).toBe(t('files.saveFailedTitle'));
    expect(String(asked?.args.message)).toContain('may now be incomplete');
    expect(asked?.args.ok).toBe(t('common.saveAs'));
  });

  it('sends the buffer to Save As when the failed write is answered with it', async () => {
    const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    h.fs.writeFailures.add('/nc/a.nc');
    h.dialogs.answers.confirm.push(true);
    h.dialogs.answers.saveFile.push('/nc/rescued.nc');

    expect(await h.files.save(id)).toBe(true);

    expect(h.fs.writes).toEqual(['/nc/rescued.nc']);
    expect(h.docs.get(id)?.path).toBe('/nc/rescued.nc');
    expect(h.docs.get(id)?.dirty).toBe(false);
  });

  // G8 F5: the document carries the stamp it was read at, and nothing compared it.
  describe('a file that changed on disk under the tab', () => {
    /** Rewrites the file behind gEdit's back, the way a CAM post would. */
    function repost(path: string, text: string): void {
      h.fs.files.set(path, new TextEncoder().encode(text));
      h.fs.mtimes.set(path, (h.fs.mtimes.get(path) ?? 0) + 5000);
    }

    it('asks before overwriting it, and writes nothing when the answer is no', async () => {
      const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      repost('/nc/a.nc', 'G0 X999 (FROM THE POST)\n');

      expect(await h.files.save(id)).toBe(false);

      const asked = h.dialogs.calls.find((c) => c.kind === 'confirm');
      expect(asked?.args.title).toBe(t('files.changedOnDiskTitle'));
      expect(asked?.args.message).toBe(t('files.changedOnDiskMessage', { name: 'a.nc' }));
      expect(h.fs.writes).toEqual([]);
      expect(new TextDecoder().decode(h.fs.files.get('/nc/a.nc'))).toBe('G0 X999 (FROM THE POST)\n');
      expect(h.docs.get(id)?.dirty).toBe(true);
    });

    it('overwrites it once the answer is yes, and does not ask twice', async () => {
      const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      repost('/nc/a.nc', 'G0 X999\n');
      h.dialogs.answers.confirm.push(true);

      expect(await h.files.save(id)).toBe(true);
      expect(h.fs.writes).toEqual(['/nc/a.nc']);

      // The save restamped the document, so the next one goes straight through.
      h.editor.type(id, 'G0 X2\n');
      expect(await h.files.save(id)).toBe(true);
      expect(h.dialogs.calls.filter((c) => c.kind === 'confirm')).toHaveLength(1);
    });

    it('never asks when only gEdit wrote the file', async () => {
      const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      expect(await h.files.save(id)).toBe(true);
      h.editor.type(id, 'G0 X3\n');
      expect(await h.files.save(id)).toBe(true);
      expect(h.dialogs.calls.filter((c) => c.kind === 'confirm')).toEqual([]);
      expect(h.fs.writes).toEqual(['/nc/a.nc', '/nc/a.nc']);
    });

    it('does not ask when the file is gone: the save recreates it', async () => {
      const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      h.fs.files.delete('/nc/a.nc');
      h.fs.mtimes.delete('/nc/a.nc');

      expect(await h.files.save(id)).toBe(true);
      expect(h.dialogs.calls.filter((c) => c.kind === 'confirm')).toEqual([]);
    });

    it('does not ask for a Save As target the user just picked', async () => {
      const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      h.put('/nc/other.nc', 'nc/encoding/cp1252-crlf.nc');
      h.fs.files.delete('/nc/other.nc'); // the picker's overwrite question is the native one
      h.dialogs.answers.saveFile.push('/nc/other.nc');

      expect(await h.files.saveAs(id)).toBe(true);
      expect(h.dialogs.calls.filter((c) => c.kind === 'confirm')).toEqual([]);
    });

    it('compares the size when the platform reports no modification time', () => {
      const stamp = { mtimeMs: null, size: 10, hash: 1 };
      const stat = { path: '/x', allowed: true, exists: true, isDir: false, readonly: false };
      expect(diskChanged(stamp, { ...stat, mtimeMs: null, size: 10 })).toBe(false);
      expect(diskChanged(stamp, { ...stat, mtimeMs: null, size: 11 })).toBe(true);
      expect(diskChanged(stamp, { ...stat, mtimeMs: 7, size: 10 })).toBe(false);
      expect(diskChanged({ ...stamp, mtimeMs: 7 }, { ...stat, mtimeMs: 8, size: 10 })).toBe(true);
      // Not allowed, or not there: there is nothing to overwrite.
      expect(diskChanged(stamp, { ...stat, allowed: false, mtimeMs: null, size: 99 })).toBe(false);
      expect(diskChanged(stamp, { ...stat, exists: false, mtimeMs: null, size: 99 })).toBe(false);
    });
  });

  it('leaves the document dirty when it was edited while the write was in flight', async () => {
    const id = await openDirty('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const original = h.fs.writeFile.bind(h.fs);
    h.fs.writeFile = async (path, bytes) => {
      h.editor.type(id, 'edited later\n');
      await original(path, bytes);
    };

    expect(await h.files.save(id)).toBe(true);
    expect(h.docs.get(id)?.dirty).toBe(true);
  });
});

describe('the Windows-1252 fallback', () => {
  async function unencodable(): Promise<DocId> {
    const path = h.put('/nc/cp.nc', 'nc/encoding/cp1252-crlf.nc');
    const [id] = await h.files.open([path]);
    expect(h.docs.get(id)?.encoding.encoding).toBe('windows-1252');
    h.editor.type(id, 'O1000\nG0 X0 (π)\n');
    return id;
  }

  it('offers UTF-8 and writes the whole file in it when the user agrees', async () => {
    const id = await unencodable();
    h.dialogs.answers.confirm.push(true);

    expect(await h.files.save(id)).toBe(true);

    const call = h.dialogs.calls.find((c) => c.kind === 'confirm');
    expect(call?.args.ok).toBe(t('files.saveAsUtf8Button'));
    expect(String(call?.args.message)).toContain('U+03C0');
    expect(h.docs.get(id)?.encoding).toEqual({ encoding: 'utf-8', hasBom: false });
    expect(new TextDecoder().decode(h.fs.files.get('/nc/cp.nc'))).toContain('π');
    expect(h.status.last()).toBe(t('files.savedAsUtf8', { name: 'cp.nc' }));
  });

  it('writes nothing and keeps the encoding when the user cancels', async () => {
    const id = await unencodable();
    h.dialogs.answers.confirm.push(false);

    expect(await h.files.save(id)).toBe(false);

    expect(h.fs.writes).toEqual([]);
    expect(h.docs.get(id)?.encoding.encoding).toBe('windows-1252');
    expect(h.docs.get(id)?.dirty).toBe(true);
  });
});

describe('saveAs', () => {
  it('refuses the path of another open document', async () => {
    const taken = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    await h.files.open([taken]);
    const other = h.files.newUntitled({ text: 'G0 X1\n' });
    h.dialogs.answers.saveFile.push(taken);

    expect(await h.files.saveAs(other)).toBe(false);

    expect(h.fs.writes).toEqual([]);
    const error = h.dialogs.calls.find((c) => c.kind === 'error');
    expect(String(error?.args.detail)).toBe(t('files.alreadyOpen', { name: 'a.nc' }));
  });

  it('suggests the current path and the document profile', async () => {
    const path = h.put('/nc/b.h', 'nc/heidenhain/h01-3tools.h');
    const [id] = await h.files.open([path]);
    h.dialogs.answers.saveFile.push('/nc/copy.h');

    expect(await h.files.saveAs(id)).toBe(true);

    expect(h.dialogs.calls.find((c) => c.kind === 'saveFile')?.args).toEqual({
      defaultPath: path,
      profileId: 'heidenhain-klartext',
    });
    expect(hex(h.fs.files.get('/nc/copy.h') as Uint8Array)).toBe(hex(fixture('nc/heidenhain/h01-3tools.h')));
  });

  it('returns false when the dialog is cancelled', async () => {
    const id = h.files.newUntitled({ text: 'G0\n' });
    h.dialogs.answers.saveFile.push(null);
    expect(await h.files.saveAs(id)).toBe(false);
    expect(h.fs.writes).toEqual([]);
  });
});

describe('saveAll', () => {
  it('saves every dirty document and sends untitled ones through Save As in order', async () => {
    const a = await (async () => {
      const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      const [id] = await h.files.open([path]);
      h.editor.type(id, 'G0 X9\n');
      return id;
    })();
    const b = h.files.newUntitled({ text: '' });
    h.editor.type(b, 'G0 X1\n');
    const c = h.files.newUntitled({ text: '' });
    h.editor.type(c, 'G0 X2\n');
    h.dialogs.answers.saveFile.push('/nc/b.nc', '/nc/c.nc');

    expect(await h.files.saveAll()).toBe(true);

    expect(h.fs.writes).toEqual(['/nc/a.nc', '/nc/b.nc', '/nc/c.nc']);
    expect(h.docs.all().every((doc) => !doc.dirty)).toBe(true);
    expect(h.docs.get(b)?.title).toBe('b.nc');
    expect(h.docs.get(c)?.title).toBe('c.nc');
    expect(h.status.last()).toBe(t('files.savedAll', { count: 3 }));
  });

  // G8 M5: Save All used to stop at the first cancelled Save As and then report
  // "Saved <the one file>", with nothing anywhere saying the rest had been skipped —
  // so a real program with a shift's edits in it was silently left unwritten.
  it('carries on past a cancelled Save As, and names what it did not save', async () => {
    const a = await (async () => {
      const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      const [id] = await h.files.open([path]);
      h.editor.type(id, 'G0 X9\n');
      return id;
    })();
    const scratch = h.files.newUntitled({ text: '' });
    h.editor.type(scratch, 'G0 X1\n');
    const c = h.files.newUntitled({ text: '' });
    h.editor.type(c, 'G0 X2\n');
    // The scratch note's Save As is cancelled; the third document still has a name to
    // be picked for it.
    h.dialogs.answers.saveFile.push(null, '/nc/c.nc');

    expect(await h.files.saveAll()).toBe(false);

    expect(h.fs.writes).toEqual(['/nc/a.nc', '/nc/c.nc']);
    expect(h.docs.get(a)?.dirty).toBe(false);
    expect(h.docs.get(c)?.dirty).toBe(false);
    expect(h.docs.get(scratch)?.dirty).toBe(true);
    // Not a success, and it names the document it left behind.
    const last = h.status.messages.at(-1);
    expect(last?.error).toBe(true);
    expect(last?.text).toBe(t('files.savedAllPartial', { saved: 2, list: 'Untitled-1' }));
  });

  it('stops at a write that failed, because the next one will fail too', async () => {
    const a = await (async () => {
      const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
      const [id] = await h.files.open([path]);
      h.editor.type(id, 'G0 X9\n');
      return id;
    })();
    const b = await (async () => {
      const path = h.put('/nc/b.nc', 'nc/encoding/utf8-lf.nc');
      const [id] = await h.files.open([path]);
      h.editor.type(id, 'G0 X8\n');
      return id;
    })();
    h.fs.writeFailures.add('/nc/a.nc');
    h.dialogs.answers.confirm.push(false); // "save it somewhere else?" — no

    expect(await h.files.saveAll()).toBe(false);

    expect(h.fs.writes).toEqual([]);
    expect(h.docs.get(a)?.dirty).toBe(true);
    expect(h.docs.get(b)?.dirty).toBe(true);
    expect(h.status.messages.at(-1)?.error).toBe(true);
  });

  // The close and quit paths are the other half of the rule: they throw the document
  // away next, so there a cancelled Save As has to abort everything.
  it('aborts the whole Close All when a Save As is cancelled', async () => {
    const b = h.files.newUntitled({ text: '' });
    h.editor.type(b, 'G0 X1\n');
    const c = h.files.newUntitled({ text: '' });
    h.editor.type(c, 'G0 X2\n');
    h.dialogs.answers.ask3.push('yes'); // Save All
    h.dialogs.answers.saveFile.push(null);

    expect(await h.files.closeAll()).toBe(false);

    expect(h.fs.writes).toEqual([]);
    expect(h.dialogs.calls.filter((call) => call.kind === 'saveFile')).toHaveLength(1);
    expect(h.docs.get(b)?.dirty).toBe(true);
    expect(h.docs.get(c)?.dirty).toBe(true);
  });

  it('skips documents that are not dirty', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    await h.files.open([path]);
    expect(await h.files.saveAll()).toBe(true);
    expect(h.fs.writes).toEqual([]);
  });
});

describe('close', () => {
  async function dirtyFile(): Promise<DocId> {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'G0 X9\n');
    return id;
  }

  it('closes a clean document without asking', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.files.newUntitled();

    expect(await h.files.close(id)).toBe(true);

    expect(h.dialogs.calls.filter((c) => c.kind === 'ask3')).toHaveLength(0);
    expect(h.docs.get(id)).toBeUndefined();
    expect(h.editor.calls).toContain(`disposeModel:${id}`);
  });

  it('offers Save, Don’t Save and Cancel for one dirty document', async () => {
    const id = await dirtyFile();
    h.dialogs.answers.ask3.push('cancel');

    expect(await h.files.close(id)).toBe(false);

    const ask = h.dialogs.calls.find((c) => c.kind === 'ask3');
    expect([ask?.args.yes, ask?.args.no, ask?.args.cancel]).toEqual([
      t('common.save'),
      t('common.dontSave'),
      t('common.cancel'),
    ]);
    expect(String(ask?.args.message)).toContain('a.nc');
    expect(h.docs.get(id)).toBeDefined();
  });

  it('saves first on Save', async () => {
    const id = await dirtyFile();
    h.dialogs.answers.ask3.push('yes');

    expect(await h.files.close(id)).toBe(true);

    expect(h.fs.writes).toEqual(['/nc/a.nc']);
    expect(h.docs.get(id)).toBeUndefined();
  });

  it("keeps the document when the save behind Save is cancelled", async () => {
    const id = h.files.newUntitled({ text: '' });
    h.editor.type(id, 'G0 X1\n');
    h.dialogs.answers.ask3.push('yes');
    h.dialogs.answers.saveFile.push(null);

    expect(await h.files.close(id)).toBe(false);
    expect(h.docs.get(id)).toBeDefined();
  });

  it('throws the changes away on Don’t Save', async () => {
    const id = await dirtyFile();
    h.dialogs.answers.ask3.push('no');

    expect(await h.files.close(id)).toBe(true);

    expect(h.fs.writes).toEqual([]);
    expect(h.docs.get(id)).toBeUndefined();
  });

  it('opens a fresh untitled document when the last one is closed', async () => {
    const id = h.files.newUntitled();
    expect(await h.files.close(id)).toBe(true);
    expect(h.docs.all()).toHaveLength(1);
    expect(h.docs.all()[0].title).toBe('Untitled-1');
    expect(h.docs.all()[0].id).not.toBe(id);
  });
});

// M7, AD-22 (P7). Per-file memory reads the cursor, the top line and the bookmarks out
// of the Monaco model when a tab closes, so the ordering below is the whole mechanism:
// after `disposeModel` there is nothing left to read, and the memory would silently be
// the last one written instead of the one for this close.
describe('onWillClose', () => {
  it('fires before the model is disposed, and only for the document that closes', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    const other = h.files.newUntitled();
    const seen: string[] = [];
    const stop = h.files.onWillClose((closing) => {
      seen.push(`willClose:${closing}`);
      // The evidence that the model is still there: reading it here must work.
      seen.push(`text:${h.editor.getText(closing).length > 0}`);
    });

    expect(await h.files.close(id)).toBe(true);

    expect(seen).toEqual([`willClose:${id}`, 'text:true']);
    const disposedAt = h.editor.calls.indexOf(`disposeModel:${id}`);
    expect(disposedAt).toBeGreaterThanOrEqual(0);
    stop();
    expect(await h.files.close(other)).toBe(true);
    // The listener was removed, so the second close added nothing.
    expect(seen).toHaveLength(2);
  });

  it('is not stopped by a listener that throws', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.files.newUntitled();
    const failing = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.files.onWillClose(() => {
      throw new Error('memory is full of chips');
    });

    expect(await h.files.close(id)).toBe(true);

    expect(h.docs.get(id)).toBeUndefined();
    expect(h.editor.calls).toContain(`disposeModel:${id}`);
    failing.mockRestore();
  });
});

describe('closeAll and confirmQuit', () => {
  async function twoDirty(): Promise<void> {
    const a = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const b = h.put('/nc/b.h', 'nc/heidenhain/h01-3tools.h');
    const [first] = await h.files.open([a]);
    const [second] = await h.files.open([b]);
    h.editor.type(first, 'G0 X9\n');
    h.editor.type(second, '0 BEGIN PGM X MM\n');
  }

  it('asks once, names every unsaved document and offers Save All / Discard All', async () => {
    await twoDirty();
    h.dialogs.answers.ask3.push('cancel');

    expect(await h.files.confirmQuit()).toBe(false);

    const asks = h.dialogs.calls.filter((c) => c.kind === 'ask3');
    expect(asks).toHaveLength(1);
    expect([asks[0].args.yes, asks[0].args.no, asks[0].args.cancel]).toEqual([
      t('files.saveAllButton'),
      t('files.discardAllButton'),
      t('common.cancel'),
    ]);
    expect(String(asks[0].args.message)).toContain('• a.nc');
    expect(String(asks[0].args.message)).toContain('• b.h');
    expect(h.docs.all()).toHaveLength(2);
  });

  it('lists at most ten documents and counts the rest', async () => {
    for (let i = 0; i < 12; i++) {
      const id = h.files.newUntitled({ text: '' });
      h.editor.type(id, `G0 X${i}\n`);
    }
    h.dialogs.answers.ask3.push('cancel');

    await h.files.confirmQuit();

    const message = String(h.dialogs.calls[0].args.message);
    expect(message.match(/• Untitled-/g)).toHaveLength(10);
    expect(message).toContain(t('files.unsavedMore', { count: 2 }));
  });

  it('quits without writing on Discard All', async () => {
    await twoDirty();
    h.dialogs.answers.ask3.push('no');

    expect(await h.files.confirmQuit()).toBe(true);

    expect(h.fs.writes).toEqual([]);
    expect(h.docs.all()).toHaveLength(2); // confirmQuit only answers; it closes nothing
  });

  it('saves everything on Save All and refuses to quit when one save is cancelled', async () => {
    await twoDirty();
    const untitled = h.files.newUntitled({ text: '' });
    h.editor.type(untitled, 'G0\n');
    h.dialogs.answers.ask3.push('yes');
    h.dialogs.answers.saveFile.push(null);

    expect(await h.files.confirmQuit()).toBe(false);

    expect(h.fs.writes).toEqual(['/nc/a.nc', '/nc/b.h']);
  });

  it('quits straight away when nothing is unsaved', async () => {
    h.files.newUntitled();
    expect(await h.files.confirmQuit()).toBe(true);
    expect(h.dialogs.calls).toEqual([]);
  });

  it('closeAll empties every tab and leaves one fresh untitled document', async () => {
    await twoDirty();
    h.dialogs.answers.ask3.push('no');

    expect(await h.files.closeAll()).toBe(true);

    expect(h.docs.all()).toHaveLength(1);
    expect(h.docs.all()[0].title).toBe('Untitled-1');
    expect(h.editor.calls.filter((c) => c.startsWith('disposeModel:'))).toHaveLength(2);
  });

  it('closeAll keeps every tab on Cancel', async () => {
    await twoDirty();
    h.dialogs.answers.ask3.push('cancel');
    expect(await h.files.closeAll()).toBe(false);
    expect(h.docs.all()).toHaveLength(2);
  });
});

describe('metadata', () => {
  it('changes the encoding and marks the document modified', async () => {
    const [id] = await h.files.open([h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc')]);
    h.files.setEncoding(id, { encoding: 'windows-1252', hasBom: false });
    expect(h.docs.get(id)?.encoding.encoding).toBe('windows-1252');
    expect(h.docs.get(id)?.metaDirty).toBe(true);
  });

  it('ignores an encoding that is already set', async () => {
    const [id] = await h.files.open([h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc')]);
    h.files.setEncoding(id, { encoding: 'utf-8', hasBom: false });
    expect(h.docs.get(id)?.metaDirty).toBe(false);
  });

  it('pushes CRLF and LF into the model and keeps CR as metadata only', async () => {
    const [id] = await h.files.open([h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc')]);

    h.files.setEol(id, 'crlf');
    expect(h.editor.calls).toContain(`setModelEol:${id}:crlf`);

    h.editor.calls.length = 0;
    h.files.setEol(id, 'cr');
    expect(h.editor.calls.filter((c) => c.startsWith('setModelEol'))).toEqual([]);
    expect(h.docs.get(id)?.eol).toBe('cr');
    expect(h.docs.get(id)?.metaDirty).toBe(true);
  });

  it('changes the profile and the Monaco language together', async () => {
    const [id] = await h.files.open([h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc')]);
    h.files.setProfile(id, 'heidenhain-klartext');
    expect(h.docs.get(id)?.profileId).toBe('heidenhain-klartext');
    expect(h.editor.languages.get(id)).toBe('heidenhain-klartext');
    // A dialect is not part of the bytes, so it does not make the file modified.
    expect(h.docs.get(id)?.metaDirty).toBe(false);
  });
});

describe('reloadFromDisk and readDisk', () => {
  it('replaces the buffer, restamps it and marks it clean', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'local edit\n');
    h.fs.files.set(path, new TextEncoder().encode('G0 X5\nG0 X6\n'));
    h.fs.mtimes.set(path, 9999);

    await h.files.reloadFromDisk(id);

    expect(h.editor.getText(id)).toBe('G0 X5\nG0 X6\n');
    expect(h.docs.get(id)?.dirty).toBe(false);
    expect(h.docs.get(id)?.disk?.mtimeMs).toBe(9999);
    expect(h.editor.calls).toContain(`replaceAll:${id}`);
  });

  it('reports a file it cannot read and keeps the buffer', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'local edit\n');
    h.fs.readFailures.add(path);

    await h.files.reloadFromDisk(id);

    expect(h.editor.getText(id)).toBe('local edit\n');
    expect(h.dialogs.calls.some((c) => c.kind === 'error')).toBe(true);
  });

  it('abandons a reload of a clean document that went dirty while the file was read', async () => {
    // G8 M2: the AD-10 auto-reload decides on a clean document and then awaits the read.
    // On a share that is tens of milliseconds, and text typed in between used to be
    // replaced with no warning at all (one undo step, but nothing says so).
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    const stamp = h.docs.get(id)?.disk;
    h.fs.files.set(path, new TextEncoder().encode('G0 X5\nG0 X6\n'));
    h.fs.mtimes.set(path, 9999);
    const read = h.fs.readFile.bind(h.fs);
    vi.spyOn(h.fs, 'readFile').mockImplementation(async (p: string) => {
      const bytes = await read(p);
      h.editor.type(id, 'typed while reading\n');
      return bytes;
    });

    await h.files.reloadFromDisk(id);

    expect(h.editor.getText(id)).toBe('typed while reading\n');
    expect(h.docs.get(id)?.dirty).toBe(true);
    // The stamp is the caller's signal that nothing happened (`app/external.ts`).
    expect(h.docs.get(id)?.disk).toBe(stamp);
    expect(h.dialogs.calls.some((c) => c.kind === 'error')).toBe(false);
  });

  it('still overwrites a document that was already modified when the reload was asked for', async () => {
    // The banner's Reload: the user asked for the file to win, so an edit made while it
    // was being read is not a reason to refuse.
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'mine\n');
    h.fs.files.set(path, new TextEncoder().encode('G0 X5\n'));
    h.fs.mtimes.set(path, 9999);
    const read = h.fs.readFile.bind(h.fs);
    vi.spyOn(h.fs, 'readFile').mockImplementation(async (p: string) => {
      const bytes = await read(p);
      h.editor.type(id, 'mine, and more\n');
      return bytes;
    });

    await h.files.reloadFromDisk(id);

    expect(h.editor.getText(id)).toBe('G0 X5\n');
    expect(h.docs.get(id)?.dirty).toBe(false);
    expect(h.docs.get(id)?.disk?.mtimeMs).toBe(9999);
  });

  it('readDisk decodes a file and answers null for one it cannot read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-bom-crlf.nc');
    const decoded = await h.files.readDisk(path);
    expect(decoded?.ok).toBe(true);
    expect(decoded?.ok === true && decoded.encoding.hasBom).toBe(true);
    expect(await h.files.readDisk('/nc/missing.nc')).toBeNull();
  });
});

describe('events', () => {
  it('reports opened and saved documents and runs the quit handlers once', async () => {
    const opened: string[] = [];
    const saved: string[] = [];
    const order: string[] = [];
    h.files.onDidOpen((_id, path) => opened.push(path));
    const offSave = h.files.onDidSave((_id, path) => saved.push(path));
    h.files.onWillQuit(() => {
      order.push('first');
    });
    h.files.onWillQuit(async () => {
      order.push('second');
    });

    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'G0 X9\n');
    await h.files.save(id);
    offSave();
    h.editor.type(id, 'G0 X8\n');
    await h.files.save(id);
    await h.files.runWillQuit();

    expect(opened).toEqual([path]);
    expect(saved).toEqual([path]);
    expect(order).toEqual(['first', 'second']);
  });

  it('a failing quit handler never blocks the quit', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.files.onWillQuit(() => {
      throw new Error('boom');
    });
    await expect(h.files.runWillQuit()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M7 (WP7.3): the backup before a write, read-only documents, restored snapshots
// and what per-file memory decides at open
// ---------------------------------------------------------------------------

describe('the backup before a write (AD-21)', () => {
  /** Opens a fixture and makes the buffer dirty without changing a single byte. */
  async function openDirty(path: string, rel = 'nc/encoding/utf8-lf.nc'): Promise<DocId> {
    h.put(path, rel);
    const [id] = await h.files.open([path]);
    h.editor.type(id, h.editor.getText(id));
    return id;
  }

  it('copies the file aside before the write, and stamps the document after it', async () => {
    const path = '/nc/a.nc';
    const id = await openDirty(path);

    expect(await h.files.save(id)).toBe(true);

    // The order is the whole mechanism: a copy taken after the write would be a copy of
    // the new text, which is exactly the version that is not worth keeping.
    expect(h.trace).toEqual([`backup:${path}`, `write:${path}`]);
    expect(h.backup.calls).toEqual([path]);
    expect(h.docs.get(id)?.disk?.size).toBe(h.fs.files.get(path)?.length);
    expect(h.docs.get(id)?.dirty).toBe(false);
  });

  it('asks before the write, so a Cancel leaves the file and the buffer untouched', async () => {
    // Without the question this save would replace a good program with the new text and
    // leave no previous version anywhere.
    const path = '/nc/a.nc';
    const id = await openDirty(path);
    const before = hex(h.fs.files.get(path) as Uint8Array);
    h.editor.type(id, 'G0 X99\n');
    h.backup.failures.add(path);
    h.dialogs.answers.confirm.push(false);

    expect(await h.files.save(id)).toBe(false);

    expect(h.fs.writes).toEqual([]);
    expect(hex(h.fs.files.get(path) as Uint8Array)).toBe(before);
    expect(h.editor.getText(id)).toBe('G0 X99\n');
    expect(h.docs.get(id)?.dirty).toBe(true);
    const asked = h.dialogs.calls.filter((call) => call.kind === 'confirm');
    expect(asked).toHaveLength(1);
    expect(asked[0].args.title).toBe(t('files.backupFailedTitle'));
    expect(asked[0].args.ok).toBe(t('files.saveWithoutBackupButton'));
    expect(String(asked[0].args.message)).toContain('cannot copy /nc/a.nc');
    // The reason outlives the dialog, and nothing reached the console: a failure the
    // user has just been asked about is not an unhandled one, and the runtime harness
    // counts a console error as a failed scenario.
    expect(h.status.messages.at(-1)?.text).toContain(t('files.backupFailed', { name: 'a.nc' }));
    expect(h.status.messages.at(-1)?.error).toBe(true);
  });

  it('writes when the user accepts it, and says that there is no previous version', async () => {
    const path = '/nc/a.nc';
    const id = await openDirty(path);
    h.editor.type(id, 'G0 X99\n');
    h.backup.failures.add(path);
    h.dialogs.answers.confirm.push(true);

    expect(await h.files.save(id)).toBe(true);

    expect(h.fs.writes).toEqual([path]);
    expect(h.status.last()).toContain(t('files.savedWithoutBackup'));
    expect(h.status.messages.at(-1)?.error).toBe(true);
  });

  it('does not ask when there was nothing to copy', async () => {
    // `files.backup: off` and a Save As to a new file both answer null, and neither is a
    // failure: the save goes ahead without a word.
    const path = '/nc/a.nc';
    const id = await openDirty(path);
    h.backup.nothing.add(path);

    expect(await h.files.save(id)).toBe(true);

    expect(h.dialogs.calls.filter((call) => call.kind === 'confirm')).toEqual([]);
    expect(h.trace).toEqual([`backup:${path}`, `write:${path}`]);
  });

  it('is not taken for a save that writes nothing', async () => {
    // The P1 rule stands: an unchanged file is not rewritten, so there is nothing to
    // copy aside either — five saves in a row must not push the real backup out of the
    // history with five copies of the same bytes.
    const path = '/nc/a.nc';
    h.put(path, 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);

    expect(await h.files.save(id)).toBe(true);

    expect(h.backup.calls).toEqual([]);
    expect(h.fs.writes).toEqual([]);
    expect(h.status.last()).toBe(t('files.unchanged', { name: 'a.nc' }));
  });

  it('is not taken when the user cancels the encoding fallback', async () => {
    // A question that can still end in "no" comes first: a backup of a save that never
    // happened would be a second copy of the bytes that are already on disk.
    const path = '/nc/cp1252.nc';
    const id = await openDirty(path, 'nc/encoding/cp1252-crlf.nc');
    h.editor.type(id, 'G0 X0 ☂\n');
    h.dialogs.answers.confirm.push(false);

    expect(await h.files.save(id)).toBe(false);

    expect(h.backup.calls).toEqual([]);
    expect(h.fs.writes).toEqual([]);
  });

  it('names the copy when the write itself fails, so the truncated file can be repaired', async () => {
    // AD-7 writes in place, so a failed write has already truncated the file. This is the
    // moment the copy exists for, and "the file may now be incomplete" is useless without
    // saying where the previous version went.
    const path = '/nc/a.nc';
    const id = await openDirty(path);
    h.editor.type(id, 'G0 X99\n');
    h.fs.writeFailures.add(path);
    h.dialogs.answers.confirm.push(false);

    expect(await h.files.save(id)).toBe(false);

    const asked = h.dialogs.calls.filter((call) => call.kind === 'confirm');
    expect(asked).toHaveLength(1);
    expect(asked[0].args.title).toBe(t('files.saveFailedTitle'));
    expect(String(asked[0].args.message)).toContain('/backups/a.nc');
    // The buffer still holds the full text, whatever happened to the file.
    expect(h.editor.getText(id)).toBe('G0 X99\n');
    expect(h.docs.get(id)?.dirty).toBe(true);
  });

  it('says nothing about a copy that was not made', async () => {
    const path = '/nc/a.nc';
    const id = await openDirty(path);
    h.editor.type(id, 'G0 X99\n');
    h.backup.nothing.add(path);
    h.fs.writeFailures.add(path);
    h.dialogs.answers.confirm.push(false);

    expect(await h.files.save(id)).toBe(false);

    const asked = h.dialogs.calls.filter((call) => call.kind === 'confirm');
    expect(String(asked[0].args.message)).not.toContain('/backups/');
  });

  it('is taken for a Save As that overwrites an existing file', async () => {
    // The overwrite was confirmed in the native dialog, which says nothing about the
    // file that is about to be replaced.
    const other = h.put('/nc/old.nc', 'nc/encoding/utf8-lf.nc');
    const id = h.files.newUntitled({ text: 'G0 X1\n' });
    h.dialogs.answers.saveFile.push(other);

    expect(await h.files.saveAs(id)).toBe(true);

    expect(h.trace).toEqual([`backup:${other}`, `write:${other}`]);
  });
});

describe('read-only documents (AD-23)', () => {
  it('opens a file with the read-only attribute locked, and says so', async () => {
    const path = h.put('/nc/locked.nc', 'nc/encoding/utf8-lf.nc');
    h.fs.readOnly.add(path);

    const [id] = await h.files.open([path]);

    expect(h.docs.get(id)?.readOnly).toBe(true);
    expect(h.docs.get(id)?.readOnlyReason).toBe('attribute');
    expect(h.status.last()).toContain(t('readOnly.opened', { name: 'locked.nc' }));
  });

  it('opens a writable file unlocked', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    expect(h.docs.get(id)?.readOnly).toBe(false);
    expect(h.docs.get(id)?.readOnlyReason).toBeNull();
  });

  it('locks and unlocks a document by hand, and records which lock it was', () => {
    const id = h.files.newUntitled();

    h.files.setReadOnly(id, true);
    expect(h.docs.get(id)?.readOnly).toBe(true);
    expect(h.docs.get(id)?.readOnlyReason).toBe('user');

    h.files.setReadOnly(id, false);
    expect(h.docs.get(id)?.readOnly).toBe(false);
    expect(h.docs.get(id)?.readOnlyReason).toBeNull();
  });

  it('ignores a lock that changes nothing and an id that is not a document', () => {
    const id = h.files.newUntitled();
    h.files.setReadOnly(id, false);
    expect(h.docs.get(id)?.readOnlyReason).toBeNull();
    expect(() => h.files.setReadOnly('d404', true)).not.toThrow();
  });

  it.each([
    ['the file is read-only and the buffer is locked', true, true],
    ['the file is read-only and the user unlocked the buffer', true, false],
    ['the file is writable and the user locked the buffer', false, true],
  ])('sends Save to Save As when %s', async (_name, attribute, locked) => {
    const path = h.put('/nc/p.nc', 'nc/encoding/utf8-lf.nc');
    if (attribute) h.fs.readOnly.add(path);
    const [id] = await h.files.open([path]);
    h.files.setReadOnly(id, locked);
    h.editor.type(id, 'G0 X5\n');
    h.dialogs.answers.saveFile.push('/nc/copy.nc');

    expect(await h.files.save(id)).toBe(true);

    // The original is untouched; the text went to the file the user picked.
    expect(h.fs.writes).toEqual(['/nc/copy.nc']);
    expect(h.docs.get(id)?.path).toBe('/nc/copy.nc');
    expect(h.status.messages.map((m) => m.text)).toContain(t('readOnly.saveAsInstead', { name: 'p.nc' }));
  });

  it('answers "unchanged" rather than opening Save As for a clean locked document', async () => {
    // Cmd+S on a program that was opened to be read has nothing to write, so it needs
    // neither a copy nor a different file. A Save As dialog here would be a no-op with
    // a native dialog in front of it.
    const path = h.put('/nc/p.nc', 'nc/encoding/utf8-lf.nc');
    h.fs.readOnly.add(path);
    const [id] = await h.files.open([path]);

    expect(await h.files.save(id)).toBe(true);

    expect(h.dialogs.calls.filter((call) => call.kind === 'saveFile')).toEqual([]);
    expect(h.fs.writes).toEqual([]);
    expect(h.backup.calls).toEqual([]);
    expect(h.status.last()).toBe(t('files.unchanged', { name: 'p.nc' }));
  });

  it('writes nothing when the Save As of a read-only document is cancelled', async () => {
    const path = h.put('/nc/p.nc', 'nc/encoding/utf8-lf.nc');
    h.fs.readOnly.add(path);
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'G0 X5\n');
    h.dialogs.answers.saveFile.push(null);

    expect(await h.files.save(id)).toBe(false);

    expect(h.fs.writes).toEqual([]);
    expect(h.backup.calls).toEqual([]);
  });

  it('sends Save to Save As when the file was write-protected while the tab sat open', async () => {
    // Remembering the answer from open would mean finding this out by trying, and a
    // failed in-place write has already truncated the file (AD-7).
    const path = h.put('/nc/p.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'G0 X5\n');
    h.fs.readOnly.add(path);
    h.dialogs.answers.saveFile.push('/nc/copy.nc');

    expect(await h.files.save(id)).toBe(true);

    expect(h.fs.writes).toEqual(['/nc/copy.nc']);
  });

  it('saves a document the user unlocked whose file is writable', async () => {
    const path = h.put('/nc/p.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.files.setReadOnly(id, true);
    h.files.setReadOnly(id, false);
    h.editor.type(id, 'G0 X5\n');

    expect(await h.files.save(id)).toBe(true);

    expect(h.fs.writes).toEqual([path]);
  });
});

describe('restoreDocument (AD-21)', () => {
  const SNAPSHOT = {
    title: 'welle.nc',
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false } as const,
    eol: 'crlf' as const,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textLF: 'G0 X1\nG0 X2\n',
    diskStamp: { mtimeMs: 500, size: 12, hash: 7 },
  };

  /** The binding runs one `files_stat` after the document appears. */
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('binds the document to a path the fs scope allows, with the snapshot stamp', async () => {
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');

    const id = h.files.restoreDocument({ ...SNAPSHOT, path });
    await settled();

    const doc = h.docs.get(id);
    expect(doc?.path).toBe(path);
    expect(doc?.title).toBe('welle.nc');
    expect(doc?.dirty).toBe(true);
    // The stamp is the file as it was when the snapshot was taken, so the external-change
    // check of AD-10 sees a file that has moved on since.
    expect(doc?.disk).toEqual(SNAPSHOT.diskStamp);
    expect(doc?.proposedPath).toBeNull();
    expect(h.editor.getText(id)).toBe(SNAPSHOT.textLF);
    expect(h.editor.eols.get(id)).toBe('crlf');
  });

  it('takes the place of the empty document the window started with', async () => {
    // M7 integration (mergeA): the rule `open()` follows and AD-22 asks of the session
    // restore. Recovered work handed back beside a stray `Untitled-1` is not what a
    // window that has just come up after a crash should look like.
    const scratch = h.files.newUntitled();
    expect(h.docs.all()).toHaveLength(1);

    const id = h.files.restoreDocument({ ...SNAPSHOT, path: null });

    expect(h.docs.all().map((doc) => doc.id)).toEqual([id]);
    expect(h.docs.get(scratch)).toBeUndefined();
  });

  it('keeps a document the user has already typed in', async () => {
    const mine = h.files.newUntitled();
    h.editor.type(mine, 'G0 X1');
    expect(h.docs.get(mine)?.dirty).toBe(true);

    const id = h.files.restoreDocument({ ...SNAPSHOT, path: null });

    expect(h.docs.all().map((doc) => doc.id)).toContain(mine);
    expect(h.docs.get(id)).toBeDefined();
  });

  it('announces the binding, so the recovered program joins the per-file memory', async () => {
    // M7 integration (mergeA): `onDidOpen` is what `createFileTracker` and the Recent
    // list hang from. Without it a recovered program is the one tab whose cursor and
    // bookmarks are neither put back nor written down.
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    const opened: string[] = [];
    h.files.onDidOpen((_id, p) => opened.push(p));

    const id = h.files.restoreDocument({ ...SNAPSHOT, path });
    // Not before the binding: a listener told about a document that is still unbound
    // would read `path: null` off it.
    expect(opened).toEqual([]);
    await settled();

    expect(opened).toEqual([path]);
    expect(h.docs.get(id)?.path).toBe(path);
  });

  it('announces nothing when the binding was refused', async () => {
    const path = '/elsewhere/welle.nc';
    h.fs.forbidden.add(path);
    const opened: string[] = [];
    h.files.onDidOpen((_id, p) => opened.push(p));

    h.files.restoreDocument({ ...SNAPSHOT, path });
    await settled();

    expect(opened).toEqual([]);
  });

  it('leaves a path the fs scope does not allow untitled, named after the file', async () => {
    // Nothing in a snapshot's metadata is ever granted: a path that was not re-granted
    // at startup is a name here and nothing else.
    const path = '/elsewhere/welle.nc';
    h.fs.forbidden.add(path);

    const id = h.files.restoreDocument({ ...SNAPSHOT, path });
    await settled();

    const doc = h.docs.get(id);
    expect(doc?.path).toBeNull();
    expect(doc?.proposedPath).toBe(path);
    // The tab still says which program this is; `Untitled-1` would not.
    expect(doc?.title).toBe('welle.nc');
    expect(doc?.dirty).toBe(true);
    expect(doc?.disk).toBeNull();
  });

  it('proposes the original path in Save As, and forgets it once the file is written', async () => {
    const path = '/elsewhere/welle.nc';
    h.fs.forbidden.add(path);
    const id = h.files.restoreDocument({ ...SNAPSHOT, path });
    await settled();
    h.dialogs.answers.saveFile.push('/nc/welle.nc');

    expect(await h.files.saveAs(id)).toBe(true);

    const dialog = h.dialogs.calls.find((call) => call.kind === 'saveFile');
    expect(dialog?.args.defaultPath).toBe(path);
    expect(h.docs.get(id)?.path).toBe('/nc/welle.nc');
    expect(h.docs.get(id)?.proposedPath).toBeNull();
    expect(h.docs.get(id)?.dirty).toBe(false);
  });

  it('never binds a path a second tab already owns', async () => {
    // Two tabs on one file each believe they own it, and the second save discards the
    // first (the P1 `alreadyOpen` guard, reached from the other side).
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    const [open] = await h.files.open([path]);

    const id = h.files.restoreDocument({ ...SNAPSHOT, path });
    await settled();

    expect(h.docs.get(id)?.path).toBeNull();
    expect(h.docs.get(id)?.proposedPath).toBe(path);
    expect(h.docs.byPath(path)?.id).toBe(open);
  });

  it('does not resurrect a document that was closed while the stat was in flight', async () => {
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    const id = h.files.restoreDocument({ ...SNAPSHOT, path });

    h.docs.remove(id);
    await settled();

    expect(h.docs.get(id)).toBeUndefined();
    expect(h.docs.byPath(path)).toBeUndefined();
  });

  it('leaves a document that was saved elsewhere in the meantime where the user put it', async () => {
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    const id = h.files.restoreDocument({ ...SNAPSHOT, path });
    h.dialogs.answers.saveFile.push('/nc/other.nc');

    await h.files.saveAs(id);
    await settled();

    expect(h.docs.get(id)?.path).toBe('/nc/other.nc');
    expect(h.docs.byPath(path)).toBeUndefined();
  });

  it('gives an untitled snapshot a fresh index', () => {
    h.files.newUntitled();
    const id = h.files.restoreDocument({ ...SNAPSHOT, path: null, title: 'Untitled-7' });
    expect(h.docs.get(id)?.path).toBeNull();
    expect(h.docs.get(id)?.title).toBe('Untitled-2');
    expect(h.docs.get(id)?.dirty).toBe(true);
  });

  it.each([
    ['a machine id', 'lathe-2' as string | null, 'lathe-2' as string | null | undefined],
    ['an explicit none', null, null],
  ])('keeps %s from the snapshot', (_name, machineId, expected) => {
    const id = h.files.restoreDocument({ ...SNAPSHOT, path: null, machineId });
    expect(h.docs.get(id)?.machineId).toBe(expected);
  });

  it('leaves the machine unset when the snapshot remembered none', () => {
    // `undefined` is "follow the profile's default machine" and is not the same answer
    // as `null` (AD-31), so it must not be written as one.
    const id = h.files.restoreDocument({ ...SNAPSHOT, path: null });
    expect(h.docs.get(id)?.machineId).toBeUndefined();
  });

  it('falls back to the default dialect when the snapshot names one that is gone', () => {
    const id = h.files.restoreDocument({ ...SNAPSHOT, path: null, profileId: 'shop-special-2019' });
    expect(h.docs.get(id)?.profileId).toBe('fanuc-gcode');
    expect(h.editor.languages.get(id)).toBe('fanuc-gcode');
  });

  it('opens editable even when the file it came from is read-only', async () => {
    // The lock belongs to the file; the buffer is the only copy of the recovered work.
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    h.fs.readOnly.add(path);

    const id = h.files.restoreDocument({ ...SNAPSHOT, path });
    await settled();

    expect(h.docs.get(id)?.readOnly).toBe(false);
    expect(h.docs.get(id)?.path).toBe(path);
  });

  it('stays dirty through an undo back to the snapshot text', () => {
    // A dirty flag the editor recomputes would be cleared here, and the tab would claim
    // the file on disk already holds this text.
    const id = h.files.restoreDocument({ ...SNAPSHOT, path: null });
    h.editor.type(id, 'G0 X3\n');
    h.editor.type(id, SNAPSHOT.textLF);
    h.editor.markClean(id);
    expect(h.docs.get(id)?.dirty).toBe(true);
  });
});

describe('per-file memory at open (AD-22)', () => {
  it('uses the dialect the user chose for this file instead of detection', async () => {
    const path = h.put('/nc/mill-looking.nc', 'nc/encoding/utf8-lf.nc');
    h.memory.profiles.set(path, 'heidenhain-klartext');

    const [id] = await h.files.open([path]);

    expect(h.docs.get(id)?.profileId).toBe('heidenhain-klartext');
    expect(h.editor.languages.get(id)).toBe('heidenhain-klartext');
  });

  it('ignores a remembered dialect that no longer exists', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    h.memory.profiles.set(path, 'shop-special-2019');

    const [id] = await h.files.open([path]);

    expect(h.docs.get(id)?.profileId).toBe('fanuc-gcode');
  });

  it.each([
    ['a machine id', 'lathe-2' as string | null, 'lathe-2' as string | null | undefined],
    ['an explicit none', null, null],
  ])('applies %s remembered for the file', async (_name, remembered, expected) => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    h.memory.machines.set(path, remembered);

    const [id] = await h.files.open([path]);

    expect(h.docs.get(id)?.machineId).toBe(expected);
  });

  it('leaves the machine unset when nothing is remembered', async () => {
    const path = h.put('/nc/a.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    expect(h.docs.get(id)?.machineId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// G8 M7: the guards that used to fail open
// ---------------------------------------------------------------------------

/**
 * Three ways a document could end up bound to a file it had never compared with
 * anything, and in all three the next Cmd+S replaced a CAM post's program with no
 * question asked. The fix is one sentence in `write`: **nothing to compare is not the
 * same as unchanged**, so it asks.
 */
describe('a save over a file the document cannot vouch for (G8 M7)', () => {
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const text = (path: string): string => new TextDecoder().decode(h.fs.files.get(path));
  const confirms = (): number => h.dialogs.calls.filter((c) => c.kind === 'confirm').length;

  it('asks after a "Keep mine" on a file a post deleted and rewrote', async () => {
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    h.editor.type(id, 'G0 X1 (my edit)\n');

    // A CAM post regenerates the program the usual way: delete, then write.
    h.fs.files.delete(path);
    await h.external.checkNow();
    expect(h.docs.get(id)?.external).toBe('deleted');

    // "Keep mine" is the only button the banner offers for a deleted file.
    h.external.keepMine(id);
    expect(h.docs.get(id)?.path).toBe(path);
    expect(h.docs.get(id)?.disk).not.toBeNull();

    // The post finishes: a brand new program is at that path.
    h.fs.files.set(path, new TextEncoder().encode('G0 X999 (the new post)\n'));
    h.fs.mtimes.set(path, 90_000);

    // The poll notices it again …
    await h.external.checkNow();
    expect(h.docs.get(id)?.external).toBe('changed');

    // … and the save asks before it overwrites it. Cancel writes nothing at all.
    h.dialogs.answers.confirm.push(false);
    expect(await h.files.save(id)).toBe(false);
    expect(confirms()).toBe(1);
    expect(text(path)).toContain('the new post');
    expect(h.fs.writes).toEqual([]);
  });

  it('asks for a restored snapshot whose sidecar carried no stamp', async () => {
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    // What `app/recovery.ts` writes for a document whose stamp had been cleared.
    const entry = {
      session: 's-1',
      key: 'd1',
      bytes: 20,
      path,
      title: 'welle.nc',
      profileId: 'fanuc-gcode',
      encoding: { encoding: 'utf-8', hasBom: false },
      eol: 'crlf',
      nul: { leader: 0, trailer: 0, stripped: 0 },
      diskStamp: null,
      savedAt: 1,
    } as unknown as RecoveryEntry;

    // The dialog says as much, before anything is opened.
    expect(
      outlookOf(entry, {
        path,
        allowed: true,
        exists: true,
        isDir: false,
        mtimeMs: 500,
        size: 12,
        readonly: false,
      }),
    ).toBe('unknown');

    const id = h.files.restoreDocument({
      path: entry.path,
      title: entry.title,
      profileId: entry.profileId,
      encoding: entry.encoding,
      eol: entry.eol,
      nul: entry.nul,
      textLF: 'G0 X1 (my edit)\n',
      diskStamp: entry.diskStamp,
    });
    await settled();

    // Bound — the work belongs to that program — but bound with the banner up.
    expect(h.docs.get(id)?.path).toBe(path);
    expect(h.docs.get(id)?.external).toBe('changed');

    h.dialogs.answers.confirm.push(false);
    expect(await h.files.save(id)).toBe(false);
    expect(confirms()).toBe(1);
    expect(h.fs.writes).toEqual([]);
  });

  it('asks when files_stat stops answering, and keeps the mtime it had', async () => {
    const path = h.put('/nc/welle.nc', 'nc/encoding/utf8-lf.nc');
    const [id] = await h.files.open([path]);
    const before = h.docs.get(id)?.disk?.mtimeMs;
    h.editor.type(id, 'G0 X1 (my edit)\n');
    h.fs.files.set(path, new TextEncoder().encode('G0 X999 (the new post)\n'));
    h.fs.mtimes.set(path, 90_000);
    h.fs.readOnly.add(path);

    // A dropped IPC call: neither the read-only attribute nor the file's new stamp can
    // be read, and `files_stat` used to answer `[]` for both. The console line is the
    // one `statOf` logs on purpose, and it is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.statFails.now = true;
    h.dialogs.answers.confirm.push(false);
    expect(await h.files.save(id)).toBe(false);
    expect(confirms()).toBe(1);
    expect(text(path)).toContain('the new post');
    expect(h.fs.writes).toEqual([]);

    // And when the user does say "overwrite", the document keeps the time it had rather
    // than being restamped with `mtimeMs: null` — which would leave it watching for size
    // changes alone for the rest of the session.
    h.dialogs.answers.confirm.push(true);
    expect(await h.files.save(id)).toBe(true);
    expect(h.docs.get(id)?.disk?.mtimeMs).toBe(before);
    expect(text(path)).toContain('my edit');
  });
});
