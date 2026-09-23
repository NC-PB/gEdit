// Bookmarks in the editor (plan §7.3, §5 WP4.4). Owner: WP4.4.
//
// Per-model whole-line decorations with a codicon in the glyph margin and a mark in the
// overview ruler. Session only: nothing is written to `state.json`, because a bookmark on
// line 240 means nothing once the file has changed under it.
//
// The decoration options that matter:
//
//  - `stickiness: NeverGrowsWhenTypingAtEdges`, so typing at the start or the end of a
//    bookmarked line does not stretch the decoration over the neighbouring lines
//  - `isWholeLine: true`, so the bookmark belongs to the block and not to a column
//
// Because transforms apply minimal edits (AD-12), Monaco moves the decorations with the
// lines they sit on: a bookmark on a line `removeEmptyLines` did not delete is still on
// the same block afterwards. That is an H4 check, and it is the reason `applyLines`
// exists at all.
//
// **Monaco's decorations are the storage.** There is no second list of line numbers to
// keep in step: `lines()` reads the decoration ranges back out of the model every time,
// so an edit, an undo and a transform all move the bookmarks for free. The map below
// holds only decoration *ids*, together with the model they belong to, so a document
// whose model was replaced (reload from disk, a reopened tab) drops its stale ids instead
// of reporting lines from a model nobody can see.
//
// Monaco is reached through `$lib/monaco/editorService`; nothing here may statically
// import `$lib/monaco/core`, or Monaco would land in the initial bundle and be evaluated
// during prerender (`app/context.test.ts` is the tripwire, because `app/context.ts`
// imports this module). The two enum values the decoration options need therefore arrive
// through `install()`, which `contrib/bookmarks.ts` calls once the editor is ready.
// Before that call the service is a no-op, which is exactly the state of the app while
// there is no editor and no model to decorate.
//
// The styles are in `bookmarks.css` next door, imported below so the feature carries
// them; the glyph margin itself is switched on and off by `syncGlyphMargin`, because the
// standalone Monaco build ships it disabled.

import './bookmarks.css';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { stepBookmark, toggleBookmark } from '$lib/core/nav/bookmarks';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import type {
  BookmarkService,
  Disposable,
  DocId,
  DocumentStore,
  EditorService,
} from '$lib/app/types';

/**
 * The slice of the Monaco namespace this module needs: two enums, no editor.
 * The real `Monaco` satisfies it, and a unit test can hand over the two numbers.
 */
export interface BookmarkMonaco {
  editor: {
    TrackedRangeStickiness: typeof MonacoApi.editor.TrackedRangeStickiness;
    OverviewRulerLane: typeof MonacoApi.editor.OverviewRulerLane;
  };
}

/**
 * The overview-ruler mark's colour.
 *
 * It is a literal and not a `var(--…)` token because Monaco paints the ruler on a canvas
 * from a JavaScript value: a CSS variable would arrive as the string "var(--accent)" and
 * be dropped. The value is `--accent-hover` of the dark theme, which also reads on the
 * light one — the ruler sits on the scrollbar, not on the editor background.
 */
const RULER_COLOR = '#2b88d8';

/** What `lines()` and `setLines()` remember about one document. */
interface Entry {
  /** The model the ids belong to; a replaced model invalidates them. */
  model: MonacoApi.editor.ITextModel;
  ids: string[];
}

export interface BookmarkDeps {
  editor: EditorService;
  docs: DocumentStore;
}

/** `BookmarkService` plus the one-time wiring `contrib/bookmarks.ts` does. */
export interface BookmarkApi extends BookmarkService {
  /**
   * Hands the service the Monaco enums and starts watching for replaced models.
   * The disposer removes every decoration it put on a model and goes back to no-op.
   */
  install(monaco: BookmarkMonaco): Disposable;
}

export function createBookmarks(deps: BookmarkDeps): BookmarkApi {
  const entries = new Map<DocId, Entry>();
  let api: BookmarkMonaco | undefined;
  let options: MonacoApi.editor.IModelDecorationOptions | undefined;
  /**
   * Whether the glyph margin has been asked for. It starts false because that is the
   * standalone build's default (see `syncGlyphMargin`), so a window without bookmarks
   * never calls `updateOptions` at all.
   */
  let glyphMarginOn = false;

  function decorationOptions(monaco: BookmarkMonaco): MonacoApi.editor.IModelDecorationOptions {
    return {
      isWholeLine: true,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      className: 'gedit-bookmark-line',
      // Monaco already puts `cgmr codicon` on the element, so only the icon and our own
      // class are needed here.
      glyphMarginClassName: 'gedit-bookmark-glyph codicon-bookmark',
      overviewRuler: { color: RULER_COLOR, position: monaco.editor.OverviewRulerLane.Left },
    };
  }

  /**
   * The live entry for `id`, or undefined once its model is gone or has been replaced.
   * Stale ids are dropped here rather than in a listener, so `lines()` can never answer
   * from a model the document no longer has.
   */
  function entryFor(id: DocId): Entry | undefined {
    const entry = entries.get(id);
    if (!entry) return undefined;
    if (deps.editor.model(id) !== entry.model) {
      entries.delete(id);
      return undefined;
    }
    return entry;
  }

  /**
   * Shows the glyph margin while any open document has a bookmark, and hides it again
   * when the last one goes.
   *
   * Monaco's own default for `glyphMargin` is `true`, but the **standalone** build turns
   * it off (`monaco-editor/esm/vs/editor/editor.api2.js`:
   * `EditorOptions.glyphMargin.defaultValue = false`), and a margin that is off renders no
   * glyph at all: `GlyphMarginWidgets.prepareRender` returns before it looks at a single
   * decoration. Asking for it here rather than in `EDITOR_OPTIONS` keeps the option where
   * the reason for it is — the same call `contrib/assistant.ts` makes for
   * `acceptSuggestionOnEnter` — and keeps it *conditional*: an empty margin is 21px of
   * gutter (one line height per lane) that a window without bookmarks should not pay for.
   *
   * `EditorService.updateOptions` remembers the payload, so the setting survives the
   * editor being re-created by the compare overlay.
   */
  function syncGlyphMargin(): void {
    let wanted = false;
    // A copy: `entryFor` drops stale entries as it goes.
    for (const id of [...entries.keys()]) {
      if (entryFor(id) !== undefined) {
        wanted = true;
        break;
      }
    }
    if (wanted === glyphMarginOn) return;
    glyphMarginOn = wanted;
    deps.editor.updateOptions({ glyphMargin: wanted });
  }

  function linesOf(id: DocId): number[] {
    const entry = entryFor(id);
    if (!entry) return [];
    const lines: number[] = [];
    for (const decorationId of entry.ids) {
      const range = entry.model.getDecorationRange(decorationId);
      // A decoration whose text an edit removed entirely comes back as null.
      if (range) lines.push(range.startLineNumber);
    }
    return [...new Set(lines)].sort((a, b) => a - b);
  }

  /** Replaces the bookmarks of `id` with `lines`, in one `deltaDecorations` call. */
  function setLines(id: DocId, lines: number[]): void {
    const model = deps.editor.model(id);
    if (!model || !api) return;
    const decoration = (options ??= decorationOptions(api));
    const old = entryFor(id)?.ids ?? [];
    const ids = model.deltaDecorations(
      old,
      lines.map((line) => ({
        // `isWholeLine` makes the columns irrelevant; an empty range keeps the decoration
        // anchored to the line's start, which is what has to move when text is inserted.
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: decoration,
      })),
    );
    if (ids.length === 0) entries.delete(id);
    else entries.set(id, { model, ids });
    syncGlyphMargin();
  }

  /** The cursor's line, but only when `id` is the document the cursor is in. */
  function cursorLineOf(id: DocId): number | undefined {
    if (deps.docs.getActiveId() !== id) return undefined;
    return deps.editor.cursor()?.line;
  }

  function step(dir: 1 | -1): void {
    const id = deps.docs.getActiveId();
    if (id === null) return;
    const target = stepBookmark(linesOf(id), cursorLineOf(id) ?? 0, dir);
    if (target === null) return;
    deps.editor.reveal(id, target);
  }

  return {
    toggle(id?: DocId, line?: number): void {
      const docId = id ?? deps.docs.getActiveId();
      if (docId === null) return;
      const at = line ?? cursorLineOf(docId);
      if (at === undefined) return;
      setLines(docId, toggleBookmark(linesOf(docId), at));
    },

    next(): void {
      step(1);
    },

    prev(): void {
      step(-1);
    },

    clear(id?: DocId): void {
      const docId = id ?? deps.docs.getActiveId();
      if (docId === null) return;
      setLines(docId, []);
    },

    lines(id: DocId): number[] {
      return linesOf(id);
    },

    /**
     * Replaces the bookmarks of `id` (§7.9, M7). Used when a remembered file is
     * reopened.
     *
     * Lines outside the document are dropped rather than clamped to the last line: a
     * file that was shortened outside gEdit would otherwise pile every remembered
     * bookmark onto its final block, which looks like a mark the user set and is not
     * one. Duplicates and non-integers go the same way, so a hand-edited `state.json`
     * cannot put a decoration anywhere surprising.
     */
    set(id: DocId, lines: number[]): void {
      const count = deps.editor.model(id)?.getLineCount() ?? 0;
      const wanted = lines.filter((line) => Number.isInteger(line) && line >= 1 && line <= count);
      setLines(id, [...new Set(wanted)].sort((a, b) => a - b));
    },

    install(monaco: BookmarkMonaco): Disposable {
      api = monaco;
      options = undefined;
      // A document that gets a fresh model (reload from disk, a reopened tab) starts
      // without bookmarks: the old ids belong to a model that is being thrown away.
      const stopCreate = deps.editor.onDidCreateModel((id) => {
        if (entries.delete(id)) syncGlyphMargin();
      });
      // Closing the last bookmarked tab has to take the margin away too, and there is no
      // "model disposed" event to hang that on. `fileOps.drop` disposes the model and
      // *then* removes the document, so by the time this fires the entry is already
      // stale and `syncGlyphMargin` sees it.
      const stopDocs = deps.docs.list.subscribe(() => syncGlyphMargin());
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        stopCreate();
        stopDocs();
        for (const [id, entry] of entries) {
          if (deps.editor.model(id) === entry.model) entry.model.deltaDecorations(entry.ids, []);
        }
        entries.clear();
        syncGlyphMargin();
        api = undefined;
        options = undefined;
      };
    },
  };
}

/** The application-wide bookmark service (`ctx.bookmarks`). */
export const bookmarks: BookmarkApi = createBookmarks({ editor: appEditor, docs: appDocs });
