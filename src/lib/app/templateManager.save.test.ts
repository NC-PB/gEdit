// The manager's Save through the real file operations (Phase 3 plan §5 P3.9, AD-40). Owner: P3.9.
//
// `templateManager.test.ts` drives the model against a fake document port. This one puts the real
// `createFileOps` and the real document store behind it, with an in-memory disk, a recording backup
// and a recording save hook (what `contrib/userConfig.ts` reloads the code files with), so what AD-40
// promises is checked where it happens: one write, the M7 backup made before it, the code files
// reloaded after it, the file's own encoding and line ending kept, a document with unsaved changes
// never overwritten.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createFileOps } from './fileOps';
import { lockRefusal } from './readOnlyLock';
import { createTemplateManager, type ManagerState, type TemplateManager, type TemplateManagerDeps } from './templateManager';
import { createDocumentStore } from '$lib/stores/documents';
import { createProfileRegistry } from '$lib/stores/profiles';
import { loadTemplates } from '$lib/core/templates';
import type { ContentChange, CursorInfo, Disposable, DocId, DocumentStore, EditorService, Eol, NativeDialogs, StatusService } from '$lib/app/types';

const DIR = '/cfg/codes';
const NAME = 'fanuc-lathe.json';
const PATH = `${DIR}/${NAME}`;

function fakeEditor(docs: DocumentStore): EditorService & { type(id: DocId, text: string): void } {
  const texts = new Map<DocId, string>();
  const versions = new Map<DocId, number>();
  const cleanAt = new Map<DocId, number>();
  const sync = (id: DocId): void => {
    const dirty = versions.get(id) !== cleanAt.get(id);
    if (docs.get(id)?.textDirty !== dirty) docs.update(id, { textDirty: dirty });
  };
  const change = (id: DocId, text: string): void => {
    texts.set(id, text);
    versions.set(id, (versions.get(id) ?? 0) + 1);
    sync(id);
  };
  const never = (): never => {
    throw new Error('not used here');
  };
  const off = (): Disposable => () => {};
  return {
    type: change,
    attach: () => Promise.resolve(),
    ready: Promise.resolve(),
    createModel(id, text) {
      texts.set(id, text);
      versions.set(id, 1);
      cleanAt.set(id, 1);
    },
    disposeModel(id) {
      texts.delete(id);
    },
    hasModel: (id) => texts.has(id),
    getText: (id) => texts.get(id) ?? '',
    getLineCount: (id) => (texts.get(id) ?? '').split('\n').length,
    getLines: (id, a, b) => (texts.get(id) ?? '').split('\n').slice(a - 1, b),
    versionId: (id) => versions.get(id) ?? 0,
    markClean(id) {
      cleanAt.set(id, versions.get(id) ?? 0);
      sync(id);
    },
    setLanguage: () => {},
    setModelEol: (_id: DocId, _eol: Eol) => {},
    replaceAll: change,
    insertText: never,
    insertSnippet: never,
    focus: () => {},
    hasFocus: () => false,
    reveal: never,
    cursor: (): CursorInfo | null => null,
    selectionLines: () => null,
    selectedText: () => '',
    triggerAction: never,
    presetFind: () => {},
    updateOptions: () => {},
    onDidChangeContent: (_cb: (id: DocId, c: ContentChange) => void) => off(),
    onDidChangeCursor: () => off(),
    onDidCreateModel: () => off(),
    onDidActivate: () => off(),
    onDidAttach: () => off(),
    model: never,
    editorInstance: never,
  };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (data: Uint8Array | undefined): string => new TextDecoder().decode(data);

function setup(file: string) {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const editor = fakeEditor(docs);
  const disk = new Map<string, Uint8Array>([[PATH, bytes(file)]]);
  const mtimes = new Map<string, number>([[PATH, 500]]);
  const trace: string[] = [];
  let clock = 1000;
  const dialogsLog: string[] = [];
  const dialogs = {
    ask3: async () => 'cancel',
    confirm: async (o: { title: string }) => {
      dialogsLog.push(o.title);
      return true;
    },
    error: async (summary: string) => {
      dialogsLog.push(`error:${summary}`);
    },
    openFiles: async () => [],
    saveFile: async () => null,
    pickFolder: async () => null,
    pickFile: async () => null,
    exclusive: async <T>(op: () => Promise<T>) => op(),
  } as unknown as NativeDialogs;
  const status = { messages: [] as string[], current: { subscribe: () => () => {} }, show: (text: string) => void status.messages.push(text), clear: () => {} } as unknown as StatusService & { messages: string[] };
  const files = createFileOps({
    docs,
    editor,
    dialogs,
    status,
    profiles: createProfileRegistry({ filtersSupported: true }),
    fs: {
      readFile: async (path) => {
        const data = disk.get(path);
        if (data === undefined) throw new Error(`no such file: ${path}`);
        return data;
      },
      writeFile: async (path, data) => {
        trace.push(`write:${path}`);
        disk.set(path, data);
        mtimes.set(path, (clock += 1000));
      },
    },
    filesStat: async (paths) =>
      paths.map((path) => ({ path, allowed: true, exists: disk.has(path), isDir: false, mtimeMs: mtimes.get(path) ?? null, size: disk.get(path)?.length ?? null, readonly: false })),
    backup: async (path) => {
      trace.push(`backup:${path}`);
      return `/backups/${path.slice(path.lastIndexOf('/') + 1)}`;
    },
    fileMemory: { profileFor: () => undefined, machineFor: () => undefined, remember: () => {} },
    isTauri: () => true,
  });
  // `contrib/userConfig.ts`: saving a document that lives in the code files folder reloads the folder.
  let reloads = 0;
  files.onDidSave((_id, path) => {
    if (path.startsWith(`${DIR}/`)) {
      trace.push('reload');
      reloads++;
    }
  });
  // The program the user is working in. (An untouched new document would be replaced by the first file opened.)
  const main = files.newUntitled({ text: 'G0 X0' });
  editor.type(main, 'G0 X0\nG1 X1');
  let explicitReloads = 0;

  const deps: TemplateManagerDeps = {
    dialects: () => ['fanuc-lathe'],
    baseTemplates: () => [],
    variants: () => [],
    userFiles: {
      list: async () => [...disk].filter(([p]) => p.startsWith(`${DIR}/`)).map(([p, data]) => ({ name: p.slice(DIR.length + 1), text: textOf(data), error: null })),
      path: async (name) => `${DIR}/${name}`,
      create: async (name, text) => {
        disk.set(`${DIR}/${name}`, bytes(text));
        return `${DIR}/${name}`;
      },
    },
    reloadUserFiles: async () => {
      explicitReloads++;
    },
    docs: {
      find: (path) => {
        const d = docs.byPath(path);
        return d === undefined ? undefined : { id: d.id, dirty: d.dirty, title: d.title };
      },
      open: async (path) => (await files.open([path], { keepScratch: true }))[0] ?? null,
      text: (id) => editor.getText(id),
      replace: (id, text) => editor.replaceAll(id, text),
      refusal: (id, action) => {
        const d = docs.get(id);
        return d === undefined ? null : lockRefusal(d, action);
      },
      markClean: (id) => editor.markClean(id),
      save: (id) => files.save(id),
      activeId: () => docs.getActiveId(),
      activate: (id) => docs.activate(id),
    },
    confirm: async () => true,
    favorites: { get: () => [], set: () => {} },
    env: () => null,
  };
  return { docs, editor, disk, trace, files, main, deps, dialogsLog, reloads: () => reloads, explicitReloads: () => explicitReloads, mtimes };
}

async function manager(deps: TemplateManagerDeps): Promise<TemplateManager> {
  const m = createTemplateManager(deps);
  await m.load('fanuc-lathe');
  return m;
}

const stateOf = (m: TemplateManager): ManagerState => get(m.state);

const FILE = `${JSON.stringify({ dialect: 'fanuc-lathe', version: 1, codes: [], templates: [{ id: 'mine', label: 'Mine', group: 'G', body: 'M0' }] }, null, 2)}\n`;

describe('Save through the real file operations', () => {
  it('makes one write, with the backup before it and the reload after it, and leaves the tab that was active', async () => {
    const h = setup(FILE);
    const m = await manager(h.deps);
    m.setField(stateOf(m).rows[0].key, 'label', 'Mine, changed');
    expect(await m.save()).toEqual({ ok: true });

    expect(h.trace).toEqual([`backup:${PATH}`, `write:${PATH}`, 'reload']);
    const written = JSON.parse(textOf(h.disk.get(PATH))) as { codes: unknown[]; templates: unknown[] };
    expect(written.codes).toEqual([]);
    expect(loadTemplates(written.templates).map((d) => d.label)).toEqual(['Mine, changed']);
    // The file's tab is open and clean; the active tab is the one that was.
    const doc = h.docs.byPath(PATH);
    expect(doc?.dirty).toBe(false);
    expect(h.docs.getActiveId()).toBe(h.main);
    expect(stateOf(m).dirty).toBe(false);
    expect(h.dialogsLog).toEqual([]);
    expect(h.reloads()).toBe(1);
  });

  it('keeps the file’s line ending and encoding', async () => {
    const h = setup(FILE.replace(/\n/g, '\r\n'));
    const m = await manager(h.deps);
    m.add();
    expect((await m.save()).ok).toBe(true);
    const raw = textOf(h.disk.get(PATH));
    expect(raw).toContain('\r\n');
    expect(raw.replace(/\r\n/g, '')).not.toContain('\n');
    expect(h.docs.byPath(PATH)?.eol).toBe('crlf');
    expect(JSON.parse(raw).templates).toHaveLength(2);
  });

  it('CODE-07: an untouched new document is not replaced by the file’s tab', async () => {
    const h = setup(FILE);
    // The start-up state: one untouched Untitled and nothing else.
    for (const doc of h.docs.all()) {
      h.editor.disposeModel(doc.id);
      h.docs.remove(doc.id);
    }
    const scratch = h.files.newUntitled({ text: '' });
    const m = await manager(h.deps);
    m.add();
    expect((await m.save()).ok).toBe(true);
    expect(h.docs.all().map((d) => d.id)).toContain(scratch);
    expect(h.docs.all()).toHaveLength(2);
    expect(h.docs.getActiveId()).toBe(scratch);
  });

  it('a second Save reuses the open tab: one more write, one more backup, no second tab', async () => {
    const h = setup(FILE);
    const m = await manager(h.deps);
    m.add();
    await m.save();
    m.add();
    await m.save();
    expect(h.docs.all().filter((d) => d.path === PATH)).toHaveLength(1);
    expect(h.trace).toEqual([`backup:${PATH}`, `write:${PATH}`, 'reload', `backup:${PATH}`, `write:${PATH}`, 'reload']);
    expect(JSON.parse(textOf(h.disk.get(PATH))).templates).toHaveLength(3);
  });

  it('never overwrites a document of the file that has unsaved changes', async () => {
    const h = setup(FILE);
    const [id] = await h.files.open([PATH]);
    h.editor.type(id, `${FILE}\n`);
    h.docs.activate(h.main);
    const m = await manager(h.deps);
    m.add();
    expect(await m.save()).toEqual({ ok: false, reason: 'dirtyDocument' });
    expect(h.trace).toEqual([]);
    expect(textOf(h.disk.get(PATH))).toBe(FILE);
    expect(h.editor.getText(id)).toBe(`${FILE}\n`);
  });

  it('does not write a file that was changed on disk behind the manager', async () => {
    const h = setup(FILE);
    const m = await manager(h.deps);
    m.add();
    h.disk.set(PATH, bytes(FILE.replace('"Mine"', '"Changed elsewhere"')));
    expect(await m.save()).toEqual({ ok: false, reason: 'changed' });
    expect(h.trace).toEqual([]);
    expect(textOf(h.disk.get(PATH))).toContain('Changed elsewhere');
  });

  it('makes a new file without a document or a backup (there is nothing to protect) and asks for the reload itself', async () => {
    const h = setup(FILE);
    h.disk.delete(PATH);
    const m = await manager(h.deps);
    m.add();
    expect((await m.save()).ok).toBe(true);
    expect(h.trace).toEqual([]);
    expect(h.explicitReloads()).toBe(1);
    expect(h.docs.all().filter((d) => d.path !== null)).toEqual([]);
    expect(JSON.parse(textOf(h.disk.get(PATH)))).toMatchObject({ dialect: 'fanuc-lathe', version: 1 });
  });

  it('CODE-02: a locked file tab is refused: the buffer stays as it is and clean, nothing is written', async () => {
    const h = setup(FILE);
    const [id] = await h.files.open([PATH]);
    h.docs.update(id, { readOnly: true, readOnlyReason: 'user' });
    h.docs.activate(h.main);
    const m = await manager(h.deps);
    m.add();
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    expect(stateOf(m).message).toMatchObject({ error: true, msg: { key: 'readOnly.refusedUser' } });
    expect(h.editor.getText(id)).toBe(FILE);
    expect(h.docs.get(id)?.dirty).toBe(false);
    expect(h.trace).toEqual([]);
    expect(textOf(h.disk.get(PATH))).toBe(FILE);
  });

  it('CODE-03: a disk error leaves the tab as it was, and the next Save after the fault writes', async () => {
    const h = setup(FILE);
    const m = await manager(h.deps);
    m.add();
    // The disk refuses the first write (full, a stale handle); the editor's own save answers false.
    let fault = true;
    const real = h.deps.docs.save;
    h.deps.docs.save = async (id) => {
      if (fault) return false;
      return real(id);
    };
    expect(await m.save()).toEqual({ ok: false, reason: 'failed' });
    const doc = h.docs.byPath(PATH);
    expect(doc?.dirty).toBe(false);
    expect(h.editor.getText(doc?.id as string)).toBe(FILE);
    fault = false;
    expect((await m.save()).ok).toBe(true);
    expect(JSON.parse(textOf(h.disk.get(PATH))).templates).toHaveLength(2);
  });
});
