// The diff editor behind Compare (plan §5 WP2.5). Owner: WP2.5.
//
// This is the only module besides `editorService` that may hold a Monaco object, and the
// rules are the same: the instance never goes into a store, and everything it created is
// disposed on close. Monaco does not sync a model above 50 MB to its worker, so a diff
// for such a side never arrives (F8) — `CompareService.open()` checks the sizes with
// `modelCharCount()` first and answers false rather than showing an editor that stays
// empty.
//
// `DiffHandle` is what `CompareView` holds: the navigation the toolbar drives, plus the
// two live options.
//
// Two rules the construction options follow, both verified against Monaco 0.55:
//
//  1. `createDiffEditor` feeds every *editor* option it is given into the shared
//     standalone configuration service (`standaloneServices.js:517`), so anything passed
//     here that is not diff-specific would silently change the main editor as well. Only
//     `automaticLayout` is passed, with the value `editorService` already set.
//  2. `theme` is deliberately absent: passing it calls `themeService.setTheme()`
//     (`standaloneCodeEditor.js:258`), which would override the user's theme choice
//     (WP2.6) for as long as the comparison is open. Left out, the diff editor simply
//     renders in the current global theme.
//
// IMPORTANT: Monaco is reached through `$lib/monaco/setup`, which imports
// `$lib/monaco/core` *dynamically*. Nothing in this module may import `core` for a value,
// or Monaco would land in the initial bundle and be evaluated during prerender
// (`app/context.test.ts` is the tripwire, because `app/compare.ts` imports this file).

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { getMonaco } from '$lib/monaco/setup';
import { editor as editorService } from '$lib/monaco/editorService';
import type { Disposable, DocId } from '$lib/app/types';

/**
 * Monaco stops syncing a model to the editor worker above this many UTF-16 code units
 * (`TextModel._MODEL_SYNC_LIMIT`, `common/model/textModel.js:116`), and the diff is
 * computed in that worker. A comparison with a larger side would render two editors and
 * never show a change, so Compare refuses it instead (F8).
 */
export const MODEL_SYNC_LIMIT_CHARS = 50 * 1024 * 1024;

/** A mounted diff editor. `dispose()` also disposes any model this module created. */
export interface DiffHandle {
  /** Moves to the next or previous change and reveals it. */
  goToDiff(direction: 'next' | 'previous'): void;
  setInline(inline: boolean): void;
  setIgnoreTrimWhitespace(ignore: boolean): void;
  /** Focuses the editable side, so the keyboard reaches the comparison. */
  focus(): void;
  dispose: Disposable;
}

/** The read-only side: another document's live model, or text read from disk. */
export type DiffOriginal =
  | { kind: 'document'; docId: DocId }
  | { kind: 'text'; text: string; languageId: string };

/** What the two sides of a comparison are. */
export interface DiffRequest {
  container: HTMLElement;
  /** The document whose model is the editable, modified side. */
  modifiedDocId: DocId;
  /** The other document's model, or a file's text for a temporary model. */
  original: DiffOriginal;
  inline: boolean;
  ignoreTrimWhitespace: boolean;
}

/**
 * Lets go of a model this module created (mergeA).
 *
 * The diff itself is computed in Monaco's editor worker, and a request that is already on
 * its way answers `null` when the model it asks about has been unsynced in the meantime.
 * `WorkerBasedDocumentDiffProvider` turns that `null` into `throw new Error('no diff
 * result available')` unless its cancellation token has been flagged by then
 * (`diffProviderFactoryService.js:103,110`) — and closing a comparison flags that token
 * through the observable graph, which settles a tick later than `dispose()` returns. A
 * comparison closed before its first diff had arrived therefore left an unhandled
 * rejection behind, which fails a runtime-harness run (reproduced: a `document` original,
 * which has no model of ours to drop, never showed it).
 *
 * The model is detached from the editor before this runs, so nothing renders it in the
 * meantime, and letting go of it later is free.
 *
 * The delay is a *margin, not a proof* (I2). mergeA handed the disposal to the next
 * macrotask, which is enough when the main thread is idle, but the rejection came back
 * once in four full-suite runs — in `m2-external`, which closes a comparison and then
 * immediately reloads the document. Cancellation travels through Monaco's observable
 * graph, so a busy main thread delays it, while the worker's `null` answer arrives on a
 * message task that does not wait. A margin of `GRACE_MS` is some two orders of magnitude
 * more than a worker round trip and survives that, but it cannot rule the race out.
 *
 * The deterministic fix is to stop unsyncing the model at all: reuse one scratch model
 * across comparisons, so the worker is never asked about a model that has gone. That
 * changes what "no temporary model is left behind" means (one model would persist), so it
 * wants WP2.5 and the `m2-compare` check together rather than a late integration commit.
 */
const GRACE_MS = 250;

function disposeOwnedModel(model: MonacoApi.editor.ITextModel): void {
  if (typeof setTimeout !== 'function') {
    model.dispose();
    return;
  }
  setTimeout(() => model.dispose(), GRACE_MS);
}

/** Mounts a diff editor into `container`. Rejects when a side has no model. */
export async function createDiff(req: DiffRequest): Promise<DiffHandle> {
  const monaco = await getMonaco();

  const modified = editorService.model(req.modifiedDocId);
  if (!modified) throw new Error(`compare: document "${req.modifiedDocId}" has no model`);

  // Only a `text` original belongs to this module; a document's model is the store's.
  let owned: MonacoApi.editor.ITextModel | undefined;
  let original: MonacoApi.editor.ITextModel | undefined;
  if (req.original.kind === 'document') {
    original = editorService.model(req.original.docId);
    if (!original) throw new Error(`compare: document "${req.original.docId}" has no model`);
  } else {
    owned = monaco.editor.createModel(req.original.text, req.original.languageId);
    original = owned;
  }

  let instance: MonacoApi.editor.IStandaloneDiffEditor;
  try {
    instance = monaco.editor.createDiffEditor(req.container, {
      automaticLayout: true,
      renderSideBySide: !req.inline,
      // The toggle is authoritative: without this Monaco flips to the inline view on its
      // own as soon as the window is narrow, and the toolbar would say the opposite.
      useInlineViewWhenSpaceIsLimited: false,
      ignoreTrimWhitespace: req.ignoreTrimWhitespace,
      originalEditable: false,
      renderOverviewRuler: true,
    });
  } catch (err) {
    owned?.dispose();
    throw err;
  }
  instance.setModel({ original, modified });

  let disposed = false;
  return {
    goToDiff(direction: 'next' | 'previous'): void {
      if (!disposed) instance.goToDiff(direction);
    },
    setInline(inline: boolean): void {
      if (!disposed) instance.updateOptions({ renderSideBySide: !inline });
    },
    setIgnoreTrimWhitespace(ignore: boolean): void {
      if (!disposed) instance.updateOptions({ ignoreTrimWhitespace: ignore });
    },
    focus(): void {
      if (!disposed) instance.getModifiedEditor().focus();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Detach first: the modified model (and a `document` original) outlives this view.
      instance.setModel(null);
      instance.dispose();
      const model = owned;
      owned = undefined;
      if (model) disposeOwnedModel(model);
    },
  };
}

// ---------------------------------------------------------------------------
// The mounted comparison
// ---------------------------------------------------------------------------

let mounted: DiffHandle | null = null;

/** `CompareView` publishes its handle here, so the commands can drive the toolbar's job. */
export function setCurrentDiff(handle: DiffHandle | null): void {
  mounted = handle;
}

/** The diff editor on screen, or null while there is none. */
export function currentDiff(): DiffHandle | null {
  return mounted;
}

// ---------------------------------------------------------------------------
// Sizes and the editor's view state
// ---------------------------------------------------------------------------

/**
 * The document's length in UTF-16 code units, without copying the text out of the model
 * (a 50 MB `getText()` just to measure it is exactly what the guard is trying to avoid).
 */
export function modelCharCount(docId: DocId): number {
  const model = editorService.model(docId);
  return model ? model.getValueLength() : editorService.getText(docId).length;
}

/** The scroll position, cursor and folding of the code editor, tied to the instance it came from. */
export interface EditorViewSnapshot {
  readonly state: MonacoApi.editor.ICodeEditorViewState;
  /** The editor the state was taken from; `restore` waits for its replacement. */
  readonly instance: unknown;
}

/** The editor's view state right now, or null when there is no editor yet. */
export function captureEditorViewState(): EditorViewSnapshot | null {
  const instance = editorService.editorInstance();
  const state = instance?.saveViewState();
  return instance && state ? { state, instance } : null;
}

function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 16);
}

/**
 * Puts `snapshot` back once the editor is on screen again.
 *
 * Opening the comparison takes the editor's place in the shell (AD-6), so `EditorHost` is
 * unmounted and, on close, mounted again — which makes `editorService.attach()` build a
 * *new* `IStandaloneCodeEditor`. Restoring straight away would write the state into the
 * old instance microseconds before it is disposed, so this waits for an instance that is
 * not the one the snapshot came from, and gives up after `frames` tries (nothing was
 * remounted, e.g. because the overlay never replaced the editor) by restoring into
 * whatever is there.
 */
export function restoreEditorViewState(
  snapshot: EditorViewSnapshot | null,
  o: { frames?: number } = {},
): void {
  if (!snapshot) return;
  let left = o.frames ?? 30;
  const tick = (): void => {
    const instance = editorService.editorInstance();
    const replaced = instance !== undefined && instance !== snapshot.instance && instance.getModel() !== null;
    if (replaced || left <= 0) {
      instance?.restoreViewState(snapshot.state);
      instance?.focus();
      return;
    }
    left--;
    nextFrame(tick);
  };
  nextFrame(tick);
}
