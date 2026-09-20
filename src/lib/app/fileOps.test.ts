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
import { createDocumentStore } from '$lib/stores/documents';
import { decodeFile } from '$lib/core/text';
import { createProfileRegistry } from '$lib/stores/profiles';
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
  NativeDialogs,
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
} {
  const files = new Map<string, Uint8Array>();
  const mtimes = new Map<string, number>();
  const sizes = new Map<string, number>();
  const writes: string[] = [];
  const readFailures = new Set<string>();
  const writeFailures = new Set<string>();
  let clock = 1000;
  return {
    files,
    mtimes,
    sizes,
    writes,
    readFailures,
    writeFailures,
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

interface Harness {
  docs: DocumentStore;
  editor: FakeEditor;
  dialogs: FakeDialogs;
  status: FakeStatus;
  fs: ReturnType<typeof createFakeFs>;
  files: ReturnType<typeof createFileOps>;
  put(path: string, rel: string): string;
}

function setup(o: { isTauri?: boolean; filtersSupported?: boolean } = {}): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const editor = createFakeEditor(docs);
  const dialogs = createFakeDialogs();
  const status = createFakeStatus();
  const fs = createFakeFs();
  const profiles = createProfileRegistry({ filtersSupported: o.filtersSupported ?? true });

  const filesStat: FileOpsDeps['filesStat'] = async (paths) =>
    paths.map(
      (path): FileStat => ({
        path,
        allowed: true,
        exists: fs.files.has(path),
        isDir: false,
        mtimeMs: fs.mtimes.get(path) ?? null,
        size: fs.sizes.get(path) ?? fs.files.get(path)?.length ?? null,
        readonly: false,
      }),
    );

  const files = createFileOps({
    docs,
    editor,
    dialogs,
    status,
    profiles,
    fs,
    filesStat,
    isTauri: () => o.isTauri ?? true,
  });

  return {
    docs,
    editor,
    dialogs,
    status,
    fs,
    files,
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
    expect(h.status.last()).toBe(`${t('files.saved', { name: 'tape.nc' })} · ${t('files.tapeDropped')}`);
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

  it('aborts the rest when one Save As is cancelled', async () => {
    const b = h.files.newUntitled({ text: '' });
    h.editor.type(b, 'G0 X1\n');
    const c = h.files.newUntitled({ text: '' });
    h.editor.type(c, 'G0 X2\n');
    h.dialogs.answers.saveFile.push(null);

    expect(await h.files.saveAll()).toBe(false);

    expect(h.fs.writes).toEqual([]);
    expect(h.dialogs.calls.filter((call) => call.kind === 'saveFile')).toHaveLength(1);
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
