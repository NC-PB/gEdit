// The parts of the editor service that do not need Monaco: the spanning
// `ContentChange`, the selection-to-lines rule and the LF normalization (plan §7.2).
// Importing this module in node is also a guard: `$lib/monaco/core` must stay behind a
// dynamic import, or loading the service here would pull the whole editor in.

import { describe, expect, it } from 'vitest';
import {
  createEditorService,
  docIdOf,
  editor,
  linesOf,
  modelUri,
  normalizeToLF,
  selectionLinesOf,
  spanOfChange,
  type ContentEventLike,
} from './editorService';
import { createDocumentStore } from '$lib/stores/documents';
import type { Monaco } from '$lib/monaco/setup';
import type { DocId, DocumentStore } from '$lib/app/types';

function event(
  ranges: [number, number][],
  o: { isFlush?: boolean; versionId?: number } = {},
): ContentEventLike {
  return {
    changes: ranges.map(([startLineNumber, endLineNumber]) => ({
      range: { startLineNumber, endLineNumber },
    })),
    isFlush: o.isFlush ?? false,
    versionId: o.versionId ?? 1,
  };
}

describe('spanOfChange', () => {
  it('spans a single edit in old and new coordinates', () => {
    expect(spanOfChange(event([[3, 3]]), 10, 12)).toEqual({
      startLine: 3,
      endLineOld: 3,
      endLineNew: 5,
      flush: false,
      versionId: 1,
    });
  });

  it('spans every change of a multi-cursor edit', () => {
    // Monaco reports the changes of one event in reverse document order.
    const change = spanOfChange(
      event([
        [9, 9],
        [4, 6],
      ]),
      20,
      18,
    );
    expect(change.startLine).toBe(4);
    expect(change.endLineOld).toBe(9);
    expect(change.endLineNew).toBe(7);
  });

  it('reports a deletion that shrinks the document', () => {
    expect(spanOfChange(event([[2, 5]]), 10, 7)).toMatchObject({
      startLine: 2,
      endLineOld: 5,
      endLineNew: 2,
    });
  });

  it('spans the whole document on a flush', () => {
    expect(spanOfChange(event([], { isFlush: true, versionId: 9 }), 100, 3)).toEqual({
      startLine: 1,
      endLineOld: 100,
      endLineNew: 3,
      flush: true,
      versionId: 9,
    });
  });

  it('spans the whole document for an EOL-only change, without calling it a flush', () => {
    expect(spanOfChange(event([]), 5, 5)).toEqual({
      startLine: 1,
      endLineOld: 5,
      endLineNew: 5,
      flush: false,
      versionId: 1,
    });
  });

  it('never reports a line number below 1', () => {
    const change = spanOfChange(event([], { isFlush: true }), 0, 0);
    expect(change.endLineOld).toBe(1);
    expect(change.endLineNew).toBe(1);
  });
});

describe('docIdOf', () => {
  /** What Monaco's `Uri.parse` makes of one of our model URIs. */
  function uriOf(text: string): { scheme: string; authority: string; path: string } {
    const match = /^([a-z]+):\/\/([^/]*)(\/.*)$/.exec(text);
    if (match === null) return { scheme: '', authority: '', path: text };
    return { scheme: match[1], authority: match[2], path: match[3] };
  }

  it('finds the document a model belongs to', () => {
    // This is how hover and completion get from the model Monaco hands them back to the
    // document, and so to its effective profile (AD-31).
    expect(docIdOf({ uri: uriOf(modelUri('d7')) })).toBe('d7');
  });

  it('survives an id that needs escaping', () => {
    expect(docIdOf({ uri: uriOf(modelUri('d 7/8')) })).toBe('d 7/8');
  });

  it('answers null for a model that is not a document', () => {
    expect(docIdOf(null)).toBeNull();
    expect(docIdOf({})).toBeNull();
    expect(docIdOf({ uri: uriOf('file:///work/part.nc') })).toBeNull();
    expect(docIdOf({ uri: uriOf('inmemory://model/1') })).toBeNull();
    expect(docIdOf({ uri: { scheme: 'inmemory', authority: 'doc', path: '/' } })).toBeNull();
  });
});

describe('selectionLinesOf', () => {
  it('reports the caret line when nothing is selected', () => {
    expect(selectionLinesOf(7, 7, 4, true)).toEqual({ startLine: 7, endLine: 7, empty: true });
  });

  it('keeps a selection that ends inside a line', () => {
    expect(selectionLinesOf(2, 5, 3, false)).toEqual({ startLine: 2, endLine: 5, empty: false });
  });

  it('drops a trailing line the selection only touches at column 1', () => {
    expect(selectionLinesOf(2, 5, 1, false)).toEqual({ startLine: 2, endLine: 4, empty: false });
  });

  it('keeps a single line selected to column 1', () => {
    expect(selectionLinesOf(3, 3, 1, false)).toEqual({ startLine: 3, endLine: 3, empty: false });
  });
});

describe('text helpers', () => {
  it('normalizes CRLF and CR to LF', () => {
    expect(normalizeToLF('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('returns 1-based inclusive line ranges, clamped', () => {
    const text = 'a\nb\nc\nd';
    expect(linesOf(text, 2, 3)).toEqual(['b', 'c']);
    expect(linesOf(text, 0, 99)).toEqual(['a', 'b', 'c', 'd']);
    expect(linesOf(text, 3, 2)).toEqual([]);
    expect(linesOf(text, 9, 10)).toEqual([]);
  });
});

describe('the default service before it is attached', () => {
  it('answers neutrally instead of throwing', () => {
    expect(editor.hasModel('d404')).toBe(false);
    expect(editor.getText('d404')).toBe('');
    expect(editor.getLineCount('d404')).toBe(0);
    expect(editor.getLines('d404', 1, 5)).toEqual([]);
    expect(editor.versionId('d404')).toBe(0);
    expect(editor.cursor()).toBeNull();
    expect(editor.selectionLines()).toBeNull();
    expect(editor.selectedText()).toBe('');
    expect(editor.hasFocus()).toBe(false);
    expect(editor.model('d404')).toBeUndefined();
    expect(editor.editorInstance()).toBeUndefined();
  });

  it('queues a document created before Monaco is there', () => {
    const created: string[] = [];
    const stop = editor.onDidCreateModel((id) => created.push(id));
    editor.createModel('dq', 'N10\r\nN20\r\n', 'fanuc-gcode', 'crlf');
    expect(created).toEqual(['dq']);
    expect(editor.hasModel('dq')).toBe(true);
    expect(editor.getText('dq')).toBe('N10\nN20\n');
    expect(editor.getLineCount('dq')).toBe(3);
    expect(editor.getLines('dq', 1, 2)).toEqual(['N10', 'N20']);
    editor.replaceAll('dq', 'N30');
    expect(editor.getText('dq')).toBe('N30');
    editor.disposeModel('dq');
    expect(editor.hasModel('dq')).toBe(false);
    stop();
  });
});

// ---------------------------------------------------------------------------
// The service with a fake Monaco (G8: `loadMonaco` is an injection point, and nothing
// used it — every Monaco-dependent path was covered only by the 3-minute app run)
// ---------------------------------------------------------------------------

interface FakeModel {
  uri: string;
  value: string;
  languageId: string;
  eol: 'crlf' | 'lf';
  disposed: boolean;
  calls: string[];
  getValue(preference?: number): string;
  getAlternativeVersionId(): number;
  getLineCount(): number;
  getLineContent(line: number): string;
  getFullModelRange(): Record<string, number>;
  getValueLengthInRange(range: unknown, preference?: number): number;
  getValueInRange(range: unknown, preference?: number): string;
  setEOL(sequence: number): void;
  pushEOL(sequence: number): void;
  pushStackElement(): void;
  pushEditOperations(before: unknown, edits: { text: string }[], after: unknown): null;
  onDidChangeContent(cb: (e: ContentEventLike) => void): { dispose(): void };
  dispose(): void;
}

interface FakeEditorInstance {
  model: FakeModel | null;
  position: { lineNumber: number; column: number };
  calls: string[];
  /** The options `create()` was called with. */
  createdWith: Record<string, unknown>;
  /** One entry per `updateOptions()` call, in order. */
  optionUpdates: Record<string, unknown>[];
  viewStates: string[];
  restored: string[];
  cursorListeners: (() => void)[];
  setModel(model: FakeModel | null): void;
  getModel(): FakeModel | null;
  saveViewState(): string | null;
  restoreViewState(state: string): void;
  getPosition(): { lineNumber: number; column: number } | null;
  setPosition(p: { lineNumber: number; column: number }): void;
  getSelections(): never[];
  getSelection(): null;
  revealLineInCenter(): void;
  revealLineInCenterIfOutsideViewport(): void;
  executeEdits(source: string, edits: unknown[]): void;
  focus(): void;
  hasTextFocus(): boolean;
  trigger(): void;
  updateOptions(o: Record<string, unknown>): void;
  onDidChangeCursorPosition(cb: () => void): { dispose(): void };
  onDidChangeCursorSelection(cb: () => void): { dispose(): void };
  dispose(): void;
}

interface FakeMonaco {
  models: Map<string, FakeModel>;
  editors: FakeEditorInstance[];
  created: FakeModel[];
  containers: unknown[];
}

const EOL_SEQ = { CRLF: 1, LF: 0 };

function fakeMonaco(): { api: Monaco; state: FakeMonaco } {
  const state: FakeMonaco = { models: new Map(), editors: [], created: [], containers: [] };

  function makeModel(text: string, languageId: string, uri: string): FakeModel {
    let version = 1;
    const listeners = new Set<(e: ContentEventLike) => void>();
    const model: FakeModel = {
      uri,
      value: text,
      languageId,
      eol: 'lf',
      disposed: false,
      calls: [],
      getValue: () => model.value,
      getAlternativeVersionId: () => version,
      getLineCount: () => model.value.split('\n').length,
      getLineContent: (line) => model.value.split('\n')[line - 1] ?? '',
      getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: model.getLineCount(), endColumn: 1 }),
      getValueLengthInRange: () => 0,
      getValueInRange: () => '',
      setEOL(sequence) {
        model.eol = sequence === EOL_SEQ.CRLF ? 'crlf' : 'lf';
      },
      pushEOL(sequence) {
        model.calls.push('pushEOL');
        model.setEOL(sequence);
      },
      pushStackElement() {
        model.calls.push('pushStackElement');
      },
      pushEditOperations(_before, edits) {
        model.calls.push('pushEditOperations');
        model.value = edits[0].text;
        version++;
        const event: ContentEventLike = {
          changes: [{ range: { startLineNumber: 1, endLineNumber: 1 } }],
          isFlush: false,
          versionId: version,
        };
        for (const cb of [...listeners]) cb(event);
        return null;
      },
      onDidChangeContent(cb) {
        listeners.add(cb);
        return {
          dispose() {
            listeners.delete(cb);
          },
        };
      },
      dispose() {
        model.disposed = true;
        state.models.delete(uri);
      },
    };
    return model;
  }

  function makeEditor(createdWith: Record<string, unknown>): FakeEditorInstance {
    let saved = 0;
    const editorInstance: FakeEditorInstance = {
      model: null,
      position: { lineNumber: 1, column: 1 },
      calls: [],
      createdWith,
      optionUpdates: [],
      viewStates: [],
      restored: [],
      cursorListeners: [],
      setModel(model) {
        editorInstance.calls.push(`setModel:${model?.uri ?? 'null'}`);
        editorInstance.model = model;
      },
      getModel: () => editorInstance.model,
      saveViewState() {
        if (!editorInstance.model) return null;
        const state = `view-${++saved}`;
        editorInstance.viewStates.push(state);
        return state;
      },
      restoreViewState(state) {
        editorInstance.restored.push(state);
      },
      getPosition: () => editorInstance.position,
      setPosition(p) {
        editorInstance.position = p;
      },
      getSelections: () => [],
      getSelection: () => null,
      revealLineInCenter() {},
      revealLineInCenterIfOutsideViewport() {},
      executeEdits(source) {
        editorInstance.calls.push(`executeEdits:${source}`);
      },
      focus() {
        editorInstance.calls.push('focus');
      },
      hasTextFocus: () => false,
      trigger() {},
      updateOptions(o) {
        editorInstance.optionUpdates.push(o);
      },
      onDidChangeCursorPosition(cb) {
        editorInstance.cursorListeners.push(cb);
        return { dispose() {} };
      },
      onDidChangeCursorSelection(cb) {
        editorInstance.cursorListeners.push(cb);
        return { dispose() {} };
      },
      dispose() {
        editorInstance.calls.push('dispose');
      },
    };
    return editorInstance;
  }

  const api = {
    Uri: { parse: (value: string) => ({ toString: () => value, value }) },
    editor: {
      EndOfLineSequence: EOL_SEQ,
      EndOfLinePreference: { TextDefined: 0, LF: 1, CRLF: 2 },
      createModel(text: string, languageId: string, uri: { value: string }) {
        const model = makeModel(text, languageId, uri.value);
        state.models.set(uri.value, model);
        state.created.push(model);
        return model;
      },
      getModel: (uri: { value: string }) => state.models.get(uri.value) ?? null,
      setModelLanguage(model: FakeModel, languageId: string) {
        model.languageId = languageId;
      },
      create(element: unknown, options: Record<string, unknown>) {
        state.containers.push(element);
        const instance = makeEditor(options);
        state.editors.push(instance);
        return instance;
      },
    },
  };
  return { api: api as unknown as Monaco, state };
}

/** A document store with one document already in it, and the service attached to a fake. */
async function attached(o: { fail?: boolean } = {}) {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const { api, state } = fakeMonaco();
  let loads = 0;
  const service = createEditorService({
    docs,
    loadMonaco: async () => {
      loads++;
      if (o.fail && loads === 1) throw new Error('chunk load failed');
      return api;
    },
  });
  return { docs, state, service, container: () => ({}) as HTMLElement, loads: () => loads };
}

function addDoc(docs: DocumentStore, id = 'a'): DocId {
  return docs.add({
    path: `/nc/${id}.nc`,
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
  });
}

/** Lets the microtask queue and the cursor throttle drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createEditorService with a fake Monaco', () => {
  it('realizes the queued models on attach and says so through onDidCreateModel', async () => {
    const h = await attached();
    const first = addDoc(h.docs, 'first');
    const second = addDoc(h.docs, 'second');
    const created: DocId[] = [];
    h.service.createModel(first, 'N10\n', 'fanuc-gcode', 'lf');
    h.service.createModel(second, 'N20\n', 'heidenhain-klartext', 'crlf');
    h.service.onDidCreateModel((id) => created.push(id));

    await h.service.attach(h.container());

    // G8: a listener that evicts cached work per model — the program map, M3's
    // OutlineIndex — has to hear about the startup documents too.
    expect(created).toEqual([first, second]);
    expect(h.state.created.map((m) => m.uri)).toEqual([
      `inmemory://doc/${first}`,
      `inmemory://doc/${second}`,
    ]);
    expect(h.state.created[1].eol).toBe('crlf');
    expect(h.state.created[1].languageId).toBe('heidenhain-klartext');
    // The active document is the one in the editor.
    expect(h.state.editors[0].getModel()?.uri).toBe(`inmemory://doc/${second}`);
  });

  it('keeps one model per document and replaces it on a second createModel', async () => {
    const h = await attached();
    const id = addDoc(h.docs);
    await h.service.attach(h.container());
    h.service.createModel(id, 'first\n', 'fanuc-gcode', 'lf');
    const first = h.state.created.at(-1) as FakeModel;

    h.service.createModel(id, 'second\n', 'fanuc-gcode', 'lf');

    expect(first.disposed).toBe(true);
    expect(h.state.models.size).toBe(1);
    expect(h.service.getText(id)).toBe('second\n');
    expect(h.state.editors[0].getModel()).toBe(h.state.created.at(-1));
  });

  it('takes the model out of the editor when it is disposed', async () => {
    const h = await attached();
    const id = addDoc(h.docs);
    await h.service.attach(h.container());
    h.service.createModel(id, 'N10\n', 'fanuc-gcode', 'lf');
    const model = h.state.created.at(-1) as FakeModel;
    expect(h.state.editors[0].getModel()).toBe(model);

    h.service.disposeModel(id);

    expect(model.disposed).toBe(true);
    expect(h.state.editors[0].getModel()).toBeNull();
    expect(h.service.hasModel(id)).toBe(false);
  });

  it('normalizes to LF on the way in and reports LF on the way out', async () => {
    const h = await attached();
    const id = addDoc(h.docs);
    await h.service.attach(h.container());
    h.service.createModel(id, 'N10\r\nN20\rN30', 'fanuc-gcode', 'crlf');
    expect(h.service.getText(id)).toBe('N10\nN20\nN30');
    expect(h.service.getLines(id, 2, 3)).toEqual(['N20', 'N30']);
    expect(h.service.getLineCount(id)).toBe(3);
    // The model itself keeps the CRLF sequence: that is what a save joins with.
    expect((h.state.created.at(-1) as FakeModel).eol).toBe('crlf');
  });

  it('wraps a rewrite in one undo step and keeps the cursor line', async () => {
    const h = await attached();
    const id = addDoc(h.docs);
    await h.service.attach(h.container());
    h.service.createModel(id, 'a\nb\nc\nd\n', 'fanuc-gcode', 'lf');
    const model = h.state.created.at(-1) as FakeModel;
    h.state.editors[0].position = { lineNumber: 3, column: 5 };
    model.calls.length = 0;

    h.service.replaceAll(id, 'x\n', { keepCursorLine: true });

    // `pushStackElement` on both sides: one undo step, whatever Monaco was doing before.
    expect(model.calls).toEqual(['pushStackElement', 'pushEditOperations', 'pushStackElement']);
    expect(h.service.getText(id)).toBe('x\n');
    // Line 3 no longer exists, so the cursor is clamped to the shorter document.
    expect(h.state.editors[0].getPosition()).toEqual({ lineNumber: 2, column: 1 });
  });

  it('writes textDirty into the store only when it flips', async () => {
    const h = await attached();
    const id = addDoc(h.docs);
    await h.service.attach(h.container());
    h.service.createModel(id, 'a\n', 'fanuc-gcode', 'lf');
    const writes: boolean[] = [];
    const stop = h.docs.list.subscribe((list) => {
      const doc = list.find((d) => d.id === id);
      if (doc) writes.push(doc.textDirty);
    });
    writes.length = 0;

    h.service.replaceAll(id, 'b\n');
    expect(h.docs.get(id)?.textDirty).toBe(true);
    h.service.replaceAll(id, 'c\n');
    expect(writes).toEqual([true]); // the second edit changes nothing to publish

    h.service.markClean(id);
    expect(h.docs.get(id)?.textDirty).toBe(false);
    h.service.markClean(id);
    expect(writes).toEqual([true, false]);
    stop();
  });

  it('saves the view state of the document it leaves and restores the one it returns to', async () => {
    const h = await attached();
    const first = addDoc(h.docs, 'first');
    const second = addDoc(h.docs, 'second');
    h.service.createModel(first, 'a\n', 'fanuc-gcode', 'lf');
    h.service.createModel(second, 'b\n', 'fanuc-gcode', 'lf');
    await h.service.attach(h.container());
    const instance = h.state.editors[0];

    h.docs.activate(first);
    // Leaving `second` saved its view state; `first` has none yet, so nothing is restored.
    expect(instance.viewStates).toEqual(['view-1']);
    expect(instance.restored).toEqual([]);

    h.docs.activate(second);
    // Leaving `first` saves its state, and `second` gets the one it was left with.
    expect(instance.viewStates).toEqual(['view-1', 'view-2']);
    expect(instance.restored).toEqual(['view-1']);

    h.docs.activate(first);
    expect(instance.restored).toEqual(['view-1', 'view-2']);
    expect(instance.calls.filter((c) => c.startsWith('setModel'))).toEqual([
      `setModel:inmemory://doc/${second}`,
      `setModel:inmemory://doc/${first}`,
      `setModel:inmemory://doc/${second}`,
      `setModel:inmemory://doc/${first}`,
    ]);
  });

  it('throttles the cursor callback to one frame', async () => {
    const h = await attached();
    const id = addDoc(h.docs);
    await h.service.attach(h.container());
    h.service.createModel(id, 'a\nb\n', 'fanuc-gcode', 'lf');
    await settle();
    let fired = 0;
    const stop = h.service.onDidChangeCursor(() => fired++);

    for (const cb of h.state.editors[0].cursorListeners) for (let i = 0; i < 5; i++) cb();
    await settle();

    expect(fired).toBe(1);
    stop();
  });

  it('ignores an attach whose container was superseded while Monaco was loading', async () => {
    const h = await attached();
    const first = h.container();
    const second = h.container();
    const firstAttach = h.service.attach(first);
    const secondAttach = h.service.attach(second);
    await Promise.all([firstAttach, secondAttach]);

    // Only the last container got an editor; the first call resolved without creating one.
    expect(h.state.containers).toEqual([second]);
    expect(h.state.editors).toHaveLength(1);
  });

  it('resolves ready on a later attach after the first one failed', async () => {
    // G8: `ready` used to reject on the first failure and could never resolve again, so
    // the Monaco bridge was never installed and `data-ready` stayed "0" behind a working
    // editor. EditorHost is remounted by the compare overlay from M2 on.
    const h = await attached({ fail: true });
    let resolved = false;
    void h.service.ready.then(() => {
      resolved = true;
    });

    await expect(h.service.attach(h.container())).rejects.toThrow('chunk load failed');
    await settle();
    expect(resolved).toBe(false);

    await h.service.attach(h.container());
    await settle();

    expect(resolved).toBe(true);
    expect(h.state.editors).toHaveLength(1);
  });

  it('replays the editor options onto the editor a re-attach builds', async () => {
    // G8 M2: the compare overlay unmounts `EditorHost` and mounts it again, so `attach()`
    // runs a second time and `create()` starts from `EDITOR_OPTIONS`. Nothing re-applies
    // the settings then — `installEditorSettings` and `setMonacoTheme` both hang off
    // `ready`, which resolved on the first attach — so the theme and every settings-driven
    // option used to revert until the user touched a setting.
    const h = await attached();
    const first = h.container();
    await h.service.attach(first);
    h.service.updateOptions({ theme: 'vs', fontSize: 22 });
    h.service.updateOptions({ wordWrap: 'on' });

    const second = h.container();
    await h.service.attach(second);

    expect(h.state.editors).toHaveLength(2);
    // Every payload so far, shallow-merged, in one call on the new instance.
    expect(h.state.editors[1].optionUpdates).toEqual([
      { theme: 'vs', fontSize: 22, wordWrap: 'on' },
    ]);
    // A later change still reaches the current instance only.
    h.service.updateOptions({ fontSize: 18 });
    expect(h.state.editors[1].optionUpdates.at(-1)).toEqual({ fontSize: 18 });
    expect(h.state.editors[0].optionUpdates).toEqual([
      { theme: 'vs', fontSize: 22 },
      { wordWrap: 'on' },
    ]);
  });

  it('applies an option set before the first attach to the editor that appears', async () => {
    // `app/theme.ts` runs during bootstrap, long before `EditorHost` has attached.
    const h = await attached();
    h.service.updateOptions({ theme: 'vs' });

    await h.service.attach(h.container());

    expect(h.state.editors[0].optionUpdates).toEqual([{ theme: 'vs' }]);
    // The construction options are the fallback, not the settings (see EDITOR_OPTIONS).
    expect(h.state.editors[0].createdWith.theme).toBe('vs-dark');
  });

  it('builds an editor with no option update when nothing was ever set', async () => {
    const h = await attached();
    await h.service.attach(h.container());
    expect(h.state.editors[0].optionUpdates).toEqual([]);
  });

  it('answers from the queued text before Monaco is there, and from the model after', async () => {
    const h = await attached();
    const id = addDoc(h.docs);
    h.service.createModel(id, 'N10\r\nN20\r\n', 'fanuc-gcode', 'crlf');

    expect(h.service.hasModel(id)).toBe(true);
    expect(h.service.getText(id)).toBe('N10\nN20\n');
    expect(h.service.versionId(id)).toBe(0);
    h.service.setLanguage(id, 'heidenhain-klartext');
    h.service.setModelEol(id, 'lf');
    h.service.replaceAll(id, 'N30\n');

    await h.service.attach(h.container());

    const model = h.state.created.at(-1) as FakeModel;
    expect(model.value).toBe('N30\n');
    expect(model.languageId).toBe('heidenhain-klartext');
    expect(model.eol).toBe('lf');
    expect(h.service.versionId(id)).toBe(model.getAlternativeVersionId());
  });
});
