// The decoration half of bookmarks (plan §7.3, §5 WP4.4).
//
// Monaco is never imported here (`vitest` runs in node): the service only needs two enum
// values and an `ITextModel`-shaped object that can hold decorations, so both are faked.
// What that buys is the ability to check the two things the real editor would hide —
// that the decoration options are the ones the plan asks for, and that `lines()` reads
// the model back instead of remembering a list of its own, which is what makes a
// bookmark survive an edit above it.

import { describe, expect, it } from 'vitest';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { createBookmarks, type BookmarkMonaco } from './bookmarks';
import type { Disposable, DocId, DocumentStore, EditorService } from '$lib/app/types';

/** The two enum members `install()` needs; the numbers are Monaco's own. */
const MONACO = {
  editor: {
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    OverviewRulerLane: { Left: 1 },
  },
} as unknown as BookmarkMonaco;

interface DeltaCall {
  old: string[];
  lines: number[];
}

/** An `ITextModel` that does nothing but hold decorations, one per line. */
function fakeModel() {
  const ranges = new Map<string, number | null>();
  const options = new Map<string, MonacoApi.editor.IModelDecorationOptions>();
  const calls: DeltaCall[] = [];
  let seq = 0;
  /** How long the document is; only `set()` (M7) cares, so the default is generous. */
  let lineCount = 1000;

  const model = {
    calls,
    setLineCount(n: number): void {
      lineCount = n;
    },
    getLineCount(): number {
      return lineCount;
    },
    /** Simulates an edit that pushed a decoration to another line, or removed its text. */
    moveTo(id: string, line: number | null): void {
      ranges.set(id, line);
    },
    optionsOf(id: string): MonacoApi.editor.IModelDecorationOptions | undefined {
      return options.get(id);
    },
    ids(): string[] {
      return [...ranges.keys()];
    },
    deltaDecorations(
      old: string[],
      added: MonacoApi.editor.IModelDeltaDecoration[],
    ): string[] {
      calls.push({ old: [...old], lines: added.map((d) => d.range.startLineNumber) });
      for (const id of old) {
        ranges.delete(id);
        options.delete(id);
      }
      return added.map((decoration) => {
        const id = `dec${(seq += 1)}`;
        ranges.set(id, decoration.range.startLineNumber);
        options.set(id, decoration.options);
        return id;
      });
    },
    getDecorationRange(id: string): MonacoApi.IRange | null {
      const line = ranges.get(id);
      if (line === undefined || line === null) return null;
      return { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 };
    },
  };
  return model;
}

type FakeModel = ReturnType<typeof fakeModel>;

function setup(o: { activeId?: DocId | null; cursorLine?: number | null } = {}) {
  const models = new Map<DocId, FakeModel>();
  const revealed: { id: DocId; line: number }[] = [];
  const created: ((id: DocId) => void)[] = [];
  const optionUpdates: Record<string, unknown>[] = [];
  const state = {
    activeId: o.activeId === undefined ? ('d1' as DocId | null) : o.activeId,
    cursorLine: o.cursorLine === undefined ? 1 : o.cursorLine,
  };

  const editor = {
    model: (id: DocId) => models.get(id) as unknown as MonacoApi.editor.ITextModel | undefined,
    cursor: () =>
      state.cursorLine === null
        ? null
        : { line: state.cursorLine, column: 1, selectedChars: 0, selections: 1 },
    reveal: (id: DocId, line: number) => revealed.push({ id, line }),
    updateOptions: (o: Record<string, unknown>) => optionUpdates.push(o),
    onDidCreateModel: (cb: (id: DocId) => void): Disposable => {
      created.push(cb);
      return () => {
        created.splice(created.indexOf(cb), 1);
      };
    },
  } as unknown as EditorService;

  const docListeners: (() => void)[] = [];
  const docs = {
    getActiveId: () => state.activeId,
    list: {
      subscribe(cb: () => void) {
        cb();
        docListeners.push(cb);
        return () => {
          docListeners.splice(docListeners.indexOf(cb), 1);
        };
      },
    },
  } as unknown as DocumentStore;

  const bookmarks = createBookmarks({ editor, docs });
  return {
    bookmarks,
    state,
    revealed,
    optionUpdates,
    /** Gives a document a (new) model, the way `createModel` does. */
    addModel(id: DocId): FakeModel {
      const model = fakeModel();
      models.set(id, model);
      return model;
    },
    /** What closing a tab does: the model goes, then the document list changes. */
    dropModel(id: DocId): void {
      models.delete(id);
      for (const cb of [...docListeners]) cb();
    },
    /** Fires `onDidCreateModel`, which is what a reload from disk does. */
    fireCreate(id: DocId): void {
      for (const cb of [...created]) cb(id);
    },
    listenerCount: () => created.length,
  };
}

describe('bookmarks', () => {
  it('does nothing until Monaco has been handed over', () => {
    const h = setup();
    const model = h.addModel('d1');
    h.bookmarks.toggle();
    expect(h.bookmarks.lines('d1')).toEqual([]);
    expect(model.calls).toEqual([]);
  });

  it('toggles the cursor line on and off again', () => {
    const h = setup({ cursorLine: 12 });
    h.addModel('d1');
    h.bookmarks.install(MONACO);

    h.bookmarks.toggle();
    expect(h.bookmarks.lines('d1')).toEqual([12]);

    h.bookmarks.toggle();
    expect(h.bookmarks.lines('d1')).toEqual([]);
  });

  it('reports the lines ascending, whatever order they were set in', () => {
    const h = setup();
    h.addModel('d1');
    h.bookmarks.install(MONACO);
    for (const line of [20, 4, 12]) h.bookmarks.toggle('d1', line);
    expect(h.bookmarks.lines('d1')).toEqual([4, 12, 20]);
  });

  it('decorates whole lines, never grows at the edges and marks the overview ruler', () => {
    const h = setup();
    const model = h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 7);

    const options = model.optionsOf(model.ids()[0]);
    expect(options?.isWholeLine).toBe(true);
    expect(options?.stickiness).toBe(MONACO.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges);
    expect(options?.glyphMarginClassName).toBe('gedit-bookmark-glyph codicon-bookmark');
    expect(options?.className).toBe('gedit-bookmark-line');
    expect(options?.overviewRuler?.position).toBe(MONACO.editor.OverviewRulerLane.Left);
    expect(typeof options?.overviewRuler?.color).toBe('string');
  });

  it('shows the glyph margin with the first bookmark and hides it with the last', () => {
    // The standalone Monaco build has `glyphMargin: false` by default, and a margin that
    // is off renders no glyph — but an empty one costs a line height of gutter.
    const h = setup();
    h.addModel('d1');
    h.addModel('d2');
    h.bookmarks.install(MONACO);
    expect(h.optionUpdates).toEqual([]);

    h.bookmarks.toggle('d1', 4);
    expect(h.optionUpdates).toEqual([{ glyphMargin: true }]);

    // Still on, and asked for only once.
    h.bookmarks.toggle('d1', 12);
    h.bookmarks.toggle('d2', 3);
    expect(h.optionUpdates).toEqual([{ glyphMargin: true }]);

    h.bookmarks.clear('d1');
    expect(h.optionUpdates).toEqual([{ glyphMargin: true }]);

    h.bookmarks.clear('d2');
    expect(h.optionUpdates).toEqual([{ glyphMargin: true }, { glyphMargin: false }]);
  });

  it('hides the glyph margin again when it is uninstalled', () => {
    const h = setup();
    h.addModel('d1');
    const uninstall = h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 4);
    uninstall();
    expect(h.optionUpdates.at(-1)).toEqual({ glyphMargin: false });
  });

  it('follows the decoration when an edit moves the line', () => {
    const h = setup();
    const model = h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 12);

    // What Monaco does when two lines are inserted above the bookmark.
    model.moveTo(model.ids()[0], 14);
    expect(h.bookmarks.lines('d1')).toEqual([14]);

    // And when the bookmarked text is deleted outright.
    model.moveTo(model.ids()[0], null);
    expect(h.bookmarks.lines('d1')).toEqual([]);
  });

  it('collapses two bookmarks an edit merged onto one line', () => {
    const h = setup();
    const model = h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 4);
    h.bookmarks.toggle('d1', 5);

    for (const id of model.ids()) model.moveTo(id, 4);
    expect(h.bookmarks.lines('d1')).toEqual([4]);
  });

  it('replaces the previous decorations in one call, so a toggle is never two edits', () => {
    const h = setup();
    const model = h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 4);
    const first = [...model.ids()];
    h.bookmarks.toggle('d1', 12);

    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]).toEqual({ old: first, lines: [4, 12] });
  });

  it('clears a document and forgets it', () => {
    const h = setup();
    const model = h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 4);
    h.bookmarks.toggle('d1', 12);

    h.bookmarks.clear('d1');
    expect(h.bookmarks.lines('d1')).toEqual([]);
    expect(model.calls.at(-1)?.lines).toEqual([]);
  });

  it('bookmarks a document that is not the active one only when the line is given', () => {
    const h = setup({ activeId: 'd1', cursorLine: 12 });
    h.addModel('d1');
    h.addModel('d2');
    h.bookmarks.install(MONACO);

    // Without a line there is no cursor to read for another document.
    h.bookmarks.toggle('d2');
    expect(h.bookmarks.lines('d2')).toEqual([]);

    h.bookmarks.toggle('d2', 30);
    expect(h.bookmarks.lines('d2')).toEqual([30]);
    expect(h.bookmarks.lines('d1')).toEqual([]);
  });

  it('does nothing without a document or without a cursor', () => {
    const h = setup({ activeId: null });
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle();
    h.bookmarks.clear();
    h.bookmarks.next();
    expect(h.revealed).toEqual([]);

    const noCursor = setup({ cursorLine: null });
    noCursor.addModel('d1');
    noCursor.bookmarks.install(MONACO);
    noCursor.bookmarks.toggle();
    expect(noCursor.bookmarks.lines('d1')).toEqual([]);
  });

  it('steps to the next and the previous bookmark, wrapping at both ends', () => {
    const h = setup({ cursorLine: 1 });
    h.addModel('d1');
    h.bookmarks.install(MONACO);
    for (const line of [4, 12, 20]) h.bookmarks.toggle('d1', line);

    h.bookmarks.next();
    expect(h.revealed.at(-1)).toEqual({ id: 'd1', line: 4 });

    h.state.cursorLine = 20;
    h.bookmarks.next();
    expect(h.revealed.at(-1)).toEqual({ id: 'd1', line: 4 });

    h.state.cursorLine = 4;
    h.bookmarks.prev();
    expect(h.revealed.at(-1)).toEqual({ id: 'd1', line: 20 });
  });

  it('does not move the cursor when there is no bookmark', () => {
    const h = setup();
    h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.next();
    h.bookmarks.prev();
    expect(h.revealed).toEqual([]);
  });

  it('drops the bookmarks when the document gets a new model', () => {
    const h = setup();
    h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 4);

    // A reload from disk: `createModel` disposes the old model and announces the new one.
    h.addModel('d1');
    h.fireCreate('d1');
    expect(h.bookmarks.lines('d1')).toEqual([]);
  });

  it('answers nothing for a document whose model is gone, and takes the margin with it', () => {
    const h = setup();
    h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 4);

    // A closed tab: the model is disposed without an `onDidCreateModel` to follow.
    h.dropModel('d1');
    expect(h.bookmarks.lines('d1')).toEqual([]);
    expect(h.optionUpdates).toEqual([{ glyphMargin: true }, { glyphMargin: false }]);
  });

  it('removes its decorations and stops listening when it is uninstalled', () => {
    const h = setup();
    const model = h.addModel('d1');
    const uninstall = h.bookmarks.install(MONACO);
    expect(h.listenerCount()).toBe(1);
    h.bookmarks.toggle('d1', 4);
    const ids = [...model.ids()];

    uninstall();
    expect(h.listenerCount()).toBe(0);
    expect(model.calls.at(-1)).toEqual({ old: ids, lines: [] });
    expect(h.bookmarks.lines('d1')).toEqual([]);

    // Twice is harmless, and the service is a no-op again.
    uninstall();
    h.bookmarks.toggle('d1', 4);
    expect(h.bookmarks.lines('d1')).toEqual([]);
  });
});

// M7, §7.9 (P7). Per-file memory hands back the lines it stored for a file that may have
// been edited by someone else in the meantime, so `set` is the place where a remembered
// line meets the document that is actually open.
describe('set', () => {
  it('replaces the bookmarks with the ones it is given, in order and without duplicates', () => {
    const h = setup();
    const model = h.addModel('d1');
    h.bookmarks.install(MONACO);
    h.bookmarks.toggle('d1', 4);

    h.bookmarks.set('d1', [12, 3, 12, 7]);

    expect(h.bookmarks.lines('d1')).toEqual([3, 7, 12]);
    // One delta call, replacing what was there: the old decoration is handed back in.
    const last = model.calls.at(-1);
    expect(last?.lines).toEqual([3, 7, 12]);
    expect(last?.old).toHaveLength(1);
  });

  it('drops a line the document no longer has instead of clamping it to the end', () => {
    const h = setup();
    const model = h.addModel('d1');
    model.setLineCount(20);
    h.bookmarks.install(MONACO);

    // The file was 400 lines when it was closed and is 20 now.
    h.bookmarks.set('d1', [5, 20, 21, 380]);

    // 21 and 380 are gone, and nothing piled up on line 20 that the user did not set.
    expect(h.bookmarks.lines('d1')).toEqual([5, 20]);
  });

  it('ignores lines that are not lines at all', () => {
    const h = setup();
    h.addModel('d1');
    h.bookmarks.install(MONACO);

    h.bookmarks.set('d1', [0, -3, 2.5, Number.NaN, Infinity, 6]);

    expect(h.bookmarks.lines('d1')).toEqual([6]);
  });

  it('is a no-op for a document with no model', () => {
    const h = setup();
    h.bookmarks.install(MONACO);
    expect(() => h.bookmarks.set('d9', [1, 2])).not.toThrow();
    expect(h.bookmarks.lines('d9')).toEqual([]);
  });
});
