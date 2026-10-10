// The diff editor behind Compare (plan §5 WP2.5). Owner: WP2.5.
//
// This is the only module besides `editorService` that may hold a Monaco object, and the
// rules are the same: the instance never goes into a store, and the editor it created is
// disposed on close. The two scratch models behind a text side are the exception: they are
// reused, not disposed (see `scratchModel`), and their text changes only while no diff
// view model that could still be computing a diff for them exists. Monaco does not sync a model above 50 MB to its worker, so a diff
// for such a side never arrives (F8) — `CompareService.open()` checks the sizes with
// `modelCharCount()` first and answers false rather than showing an editor that stays
// empty.
//
// `DiffHandle` is what `CompareView` holds: the navigation the toolbar drives, the two live
// options, the content to show (raw or the normalized copies of review mode, M11) and the
// handful of reads and the model access that the merge needs (`app/compare.ts` plans it).
//
// Three rules the construction options follow, all verified against Monaco 0.55:
//
//  1. `createDiffEditor` feeds every *editor* option it is given into the shared
//     standalone configuration service (`standaloneServices.js:517`), so anything passed
//     here that is not diff-specific would silently change the main editor as well. Only
//     `automaticLayout` is passed, with the value `editorService` already set, and
//     `readOnly`/`readOnlyMessage`, which `editorService` sets on every document switch
//     anyway and which no Monaco feature reads back from that service. The exception is
//     `SHARED_EDITOR_OPTIONS` (`instanceOptions.ts`): the same values the main editor is
//     created with (no colour boxes, fixed overflow widgets), so passing them changes nothing.
//  2. `theme` is deliberately absent: passing it calls `themeService.setTheme()`
//     (`standaloneCodeEditor.js:258`), which would override the user's theme choice
//     (WP2.6) for as long as the comparison is open. Left out, the diff editor simply
//     renders in the current global theme.
//  3. The read-only lock (AD-23) covers the comparison: the modified side *is* the
//     document, and the gutter's revert arrows write into it. The diff editor's `readOnly`
//     locks that side and hides the arrows; it follows the lock while the comparison is
//     open, because the status bar can lock or unlock the document underneath it.
//
// IMPORTANT: Monaco is reached through `$lib/monaco/setup`, which imports
// `$lib/monaco/core` *dynamically*. Nothing in this module may import `core` for a value,
// or Monaco would land in the initial bundle and be evaluated during prerender
// (`app/context.test.ts` is the tripwire, because `app/compare.ts` imports this file).

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { getMonaco } from '$lib/monaco/setup';
import { editor as editorService } from '$lib/monaco/editorService';
import { SHARED_EDITOR_OPTIONS } from '$lib/monaco/instanceOptions';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { Disposable, DocId } from '$lib/app/types';
import type { EditableModel } from '$lib/monaco/applyLines';

/**
 * Monaco stops syncing a model to the editor worker above this many UTF-16 code units
 * (`TextModel._MODEL_SYNC_LIMIT`, `common/model/textModel.js:116`), and the diff is
 * computed in that worker. A comparison with a larger side would render two editors and
 * never show a change, so Compare refuses it instead (F8).
 */
export const MODEL_SYNC_LIMIT_CHARS = 50 * 1024 * 1024;

/** The two panes of a diff editor. */
export type DiffSide = 'original' | 'modified';

/** One Monaco line change, as `IStandaloneDiffEditor.getLineChanges()` reports it. */
export interface DiffLineChange {
  /** An empty side has `…EndLineNumber` 0, and its start is the line *before* the change. */
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
}

/** Where the user is: the pane that has the keyboard (the modified one by default) and its line. */
export interface DiffCursor {
  side: DiffSide;
  line: number;
}

/** A mounted diff editor. `dispose()` also lets go of the scratch models this module lent it. */
export interface DiffHandle {
  /** Moves to the next or previous change and reveals it. */
  goToDiff(direction: 'next' | 'previous'): void;
  setInline(inline: boolean): void;
  setIgnoreTrimWhitespace(ignore: boolean): void;
  /** Focuses the editable side, so the keyboard reaches the comparison. */
  focus(): void;
  /**
   * Shows other content in the same editor (raw ↔ review, another set of toggles). A text
   * side goes into one of the two scratch models, which are reused, never disposed (see
   * `scratchModel`). A text modified side is read-only: it is a normalized copy.
   */
  show(sides: DiffSides): void;
  cursor(): DiffCursor | null;
  /** The blocks Monaco found, or null while the first diff has not arrived. */
  lineChanges(): DiffLineChange[] | null;
  /**
   * Whether `lineChanges()` describes the text as it is now. Monaco recomputes the diff
   * 200 ms or more after an edit and serves the old blocks until then, so a merge planned
   * from them would act on line numbers that no longer hold what they did (M11 CODE-1).
   */
  isCurrent(): boolean;
  /** The model behind a pane, for the merge (it edits through the model, one undo step). */
  model(side: DiffSide): EditableModel | null;
  /** Puts the cursor of a pane on `line` (clamped) and scrolls it into view. */
  reveal(side: DiffSide, line: number): void;
  /**
   * Goes to the next change once the diff has been recomputed. A merge edit changes the
   * text, and `goToDiff` asked straight away would still see the block that was just
   * copied; Monaco's own update event is the ordering that makes it right.
   */
  nextWhenUpdated(): void;
  dispose: Disposable;
}

/** What one pane shows: another document's live model, or text (a file, or a normalized copy). */
export type DiffSource =
  | { kind: 'document'; docId: DocId }
  | { kind: 'text'; text: string; languageId: string };

/** The read-only side of a raw comparison. */
export type DiffOriginal = DiffSource;

/** The two panes' content. */
export interface DiffSides {
  original: DiffSource;
  modified: DiffSource;
}

/** What `CompareView` asks for. */
export interface DiffRequest {
  container: HTMLElement;
  /** The compared document: its lock decides whether the modified side may be edited. */
  modifiedDocId: DocId;
  sides: DiffSides;
  inline: boolean;
  ignoreTrimWhitespace: boolean;
}

// ---------------------------------------------------------------------------
// Scratch models
// ---------------------------------------------------------------------------

/**
 * Two models, one per pane, created on first use and **never disposed**. A text side (a
 * file read from disk, or a normalized copy in review mode) is put into one of them with
 * `setValue`, and it is blanked when the comparison closes.
 *
 * Two races decide how. Both come from the diff being computed in Monaco's editor worker
 * while the main thread goes on (`diffEditorViewModel.js`, `diffProviderFactoryService.js`):
 *
 *  1. A request that is on its way answers `null` when its model has been unsynced in the
 *     meantime, and `WorkerBasedDocumentDiffProvider` turns that into `throw new Error('no
 *     diff result available')` unless the request's cancellation token is set by then.
 *     Disposing a model unsyncs it, so these models are never disposed (this replaced a
 *     250 ms delay).
 *  2. The view model records the edits made while its request is on its way and applies
 *     them to the answer, assuming the worker diffed the text as it was when the request
 *     started. But `EditorWorkerClient.computeDiff` awaits a `$ping` of the worker before
 *     it syncs the models, and a synced model forwards every edit straight away, so an
 *     edit in that window is diffed by the worker *and* applied again on top: a diff of
 *     the old text is laid over the new one and `LineRange` throws ("startLineNumber 5
 *     cannot be after endLineNumberExclusive 2" after a blank-on-close). Monaco drops an
 *     answer only when the token is set, and a view model it created itself is disposed —
 *     which sets the token — in a `setTimeout(0)` after `setModel` replaced it, so a
 *     `setValue` right after `setModel(null)` is still inside the window.
 *
 * So this module creates the view models itself (`createViewModel`). Monaco never disposes
 * a view model it was given, and `detach` disposes it synchronously right after
 * `setModel(null)`: its token is set before any scratch text changes, and an answer that
 * arrives later is dropped at Monaco's cancellation check before it reads a model. A
 * scratch model's text changes only while no live view model holds it — the order is the
 * proof, not a margin. "No temporary model is left behind" reads: at most these two exist,
 * however many comparisons were opened.
 */
const scratch: Partial<Record<DiffSide, MonacoApi.editor.ITextModel>> = {};

/** A handle, as far as the scratch slots are concerned. */
interface ScratchOwner {
  /** Takes the models off its diff editor and disposes its view model (no-op when detached). */
  detach(): void;
}

/**
 * Which handle last filled a slot, so a late `dispose()` of an older handle blanks nothing,
 * and so a newer handle that takes the slot detaches the older one before it refills it.
 */
const scratchOwner: Partial<Record<DiffSide, ScratchOwner>> = {};

function scratchModel(
  monaco: typeof MonacoApi,
  slot: DiffSide,
  owner: ScratchOwner,
  text: string,
  languageId: string,
): MonacoApi.editor.ITextModel {
  // Another handle that still shows this model (a comparison rebuilt before the old one
  // was disposed) lets go of it first, so its view model is gone before the text changes.
  const previous = scratchOwner[slot];
  if (previous && previous !== owner) previous.detach();
  let model = scratch[slot];
  if (!model || model.isDisposed()) {
    model = monaco.editor.createModel(text, languageId);
    scratch[slot] = model;
  } else {
    if (model.getLanguageId() !== languageId) monaco.editor.setModelLanguage(model, languageId);
    model.setValue(text);
  }
  scratchOwner[slot] = owner;
  return model;
}

/** Empties the slots `owner` filled last: the text of a 50 MB file does not outlive its view. */
function releaseScratch(owner: ScratchOwner): void {
  for (const slot of ['original', 'modified'] as const) {
    if (scratchOwner[slot] !== owner) continue;
    scratchOwner[slot] = undefined;
    const model = scratch[slot];
    if (model && !model.isDisposed()) model.setValue('');
  }
}

/** The models a comparison runs on (a test counts them through Monaco's registry). */
export function scratchModelCount(): number {
  return Object.values(scratch).filter((model) => model && !model.isDisposed()).length;
}

// ---------------------------------------------------------------------------
// The diff editor
// ---------------------------------------------------------------------------

/** Mounts a diff editor into `container`. Rejects when a side has no model. */
export async function createDiff(req: DiffRequest): Promise<DiffHandle> {
  const monaco = await getMonaco();
  let diffEditor: MonacoApi.editor.IStandaloneDiffEditor | undefined;
  /** The view model on screen, created and disposed by this module (see `scratch`). */
  let viewModel: MonacoApi.editor.IDiffEditorViewModel | null = null;
  const detach = (): void => {
    if (!diffEditor || !viewModel) return;
    diffEditor.setModel(null);
    // Synchronously, not in Monaco's `setTimeout(0)`: this sets the cancellation token of a
    // diff that is still being computed, before anyone changes the text it was asked about.
    viewModel.dispose();
    viewModel = null;
  };
  const attach = (original: MonacoApi.editor.ITextModel, modified: MonacoApi.editor.ITextModel): void => {
    if (!diffEditor) return;
    const next = diffEditor.createViewModel({ original, modified });
    diffEditor.setModel(next);
    viewModel = next;
  };
  const owner: ScratchOwner = { detach };

  const modelOf = (slot: DiffSide, source: DiffSource): MonacoApi.editor.ITextModel => {
    if (source.kind === 'text') return scratchModel(monaco, slot, owner, source.text, source.languageId);
    const model = editorService.model(source.docId);
    if (!model) throw new Error(`compare: document "${source.docId}" has no model`);
    return model;
  };

  const modifiedModel = modelOf('modified', req.sides.modified);
  const originalModel = modelOf('original', req.sides.original);

  // The modified side is a normalized copy in review mode: nothing may write it.
  let reviewing = req.sides.modified.kind === 'text';
  const lockedNow = (): boolean => reviewing || docs.get(req.modifiedDocId)?.readOnly === true;
  let appliedLock = lockedNow();

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
      readOnly: appliedLock,
      readOnlyMessage: { value: t('readOnly.editorMessage') },
      renderOverviewRuler: true,
      ...SHARED_EDITOR_OPTIONS,
    });
  } catch (err) {
    releaseScratch(owner);
    throw err;
  }
  diffEditor = instance;
  attach(originalModel, modifiedModel);

  let disposed = false;
  // CODE-1: false from any change of either pane's text (or model) until Monaco has
  // recomputed the diff for it.
  let fresh = false;
  let shown = req.sides;
  let pendingNext: MonacoApi.IDisposable | null = null;

  const applyLock = (): void => {
    const locked = lockedNow();
    if (disposed || locked === appliedLock) return;
    appliedLock = locked;
    instance.updateOptions({ readOnly: locked });
  };
  // Rule 3: `fileOps.setReadOnly` changes the document without changing which one is open.
  const stopFollowingLock = docs.list.subscribe(applyLock);

  // A toolbar button takes the focus away from both panes, so the pane the user was last
  // in is remembered: that is the one a "copy" starts from.
  let lastSide: DiffSide = 'modified';
  const trackFocus = [
    instance.getOriginalEditor().onDidFocusEditorText(() => {
      lastSide = 'original';
    }),
    instance.getModifiedEditor().onDidFocusEditorText(() => {
      lastSide = 'modified';
    }),
  ];

  const markStale = (): void => {
    fresh = false;
  };
  const trackFresh = [
    instance.getOriginalEditor().onDidChangeModelContent(markStale),
    instance.getModifiedEditor().onDidChangeModelContent(markStale),
    instance.getOriginalEditor().onDidChangeModel(markStale),
    instance.getModifiedEditor().onDidChangeModel(markStale),
    instance.onDidUpdateDiff(() => {
      fresh = true;
    }),
  ];

  const editorOf = (side: DiffSide): MonacoApi.editor.ICodeEditor =>
    side === 'original' ? instance.getOriginalEditor() : instance.getModifiedEditor();

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
    show(sides: DiffSides): void {
      if (disposed || sides === shown) return;
      // CODE-12: everything that can throw happens before anything changes, so a refused
      // show() leaves the handle (and the scratch models) as they were.
      for (const source of [sides.modified, sides.original]) {
        if (source.kind === 'document' && !editorService.model(source.docId)) {
          throw new Error(`compare: document "${source.docId}" has no model`);
        }
      }
      // The scratch models are filled with `setValue`, and nothing may hold them while
      // that happens: the diff editor would shrink the model under view zones and
      // decorations built for the old text ("Illegal value for lineNumber"), and a view
      // model still computing a diff would lay it over the new text (see `scratch`). So
      // the editor is detached first — its view model disposed — filled, and attached to
      // a new view model.
      const refills = sides.modified.kind === 'text' || sides.original.kind === 'text';
      if (refills) detach();
      const modified = modelOf('modified', sides.modified);
      const original = modelOf('original', sides.original);
      shown = sides;
      reviewing = sides.modified.kind === 'text';
      applyLock();
      const current = viewModel?.model;
      if (current?.original !== original || current?.modified !== modified) {
        detach();
        attach(original, modified);
      }
      // A side that is a document again no longer needs its scratch text (up to the size
      // of the program, twice): blank it, now that no pane shows it.
      for (const slot of ['original', 'modified'] as const) {
        if (sides[slot].kind !== 'document' || scratchOwner[slot] !== owner) continue;
        scratchOwner[slot] = undefined;
        const model = scratch[slot];
        if (model && !model.isDisposed()) model.setValue('');
      }
    },
    isCurrent(): boolean {
      return !disposed && fresh;
    },
    cursor(): DiffCursor | null {
      if (disposed) return null;
      const side: DiffSide = instance.getOriginalEditor().hasTextFocus()
        ? 'original'
        : instance.getModifiedEditor().hasTextFocus()
          ? 'modified'
          : lastSide;
      const position = editorOf(side).getPosition();
      return position ? { side, line: position.lineNumber } : null;
    },
    lineChanges(): DiffLineChange[] | null {
      return disposed ? null : instance.getLineChanges();
    },
    model(side: DiffSide): EditableModel | null {
      if (disposed) return null;
      return editorOf(side).getModel() as EditableModel | null;
    },
    reveal(side: DiffSide, line: number): void {
      if (disposed) return;
      const editor = editorOf(side);
      const count = editor.getModel()?.getLineCount() ?? 1;
      const lineNumber = Math.min(Math.max(Math.floor(line), 1), count);
      editor.setPosition({ lineNumber, column: 1 });
      editor.revealLineInCenterIfOutsideViewport(lineNumber);
    },
    nextWhenUpdated(): void {
      if (disposed) return;
      pendingNext?.dispose();
      pendingNext = instance.onDidUpdateDiff(() => {
        pendingNext?.dispose();
        pendingNext = null;
        if (!disposed) instance.goToDiff('next');
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pendingNext?.dispose();
      pendingNext = null;
      stopFollowingLock();
      for (const listener of trackFocus) listener.dispose();
      for (const listener of trackFresh) listener.dispose();
      // Detach first: the document models outlive this view, the view model is disposed
      // (its pending diff cancelled) before the scratch models are blanked, and they are
      // blanked, not disposed, so the worker is never asked about one that has gone.
      detach();
      instance.dispose();
      releaseScratch(owner);
    },
  };
}

/**
 * Brings a freshly instance editor up to what the toolbar says now. The effects that drive
 * the live editor ran while it was still being built (`handle` was null), so a toggle
 * pressed in that window was shown by its button and applied by nothing (CODE-11).
 */
export function settleCreated(
  handle: Pick<DiffHandle, 'show' | 'setInline' | 'setIgnoreTrimWhitespace'>,
  latest: { sides: DiffSides | null; inline: boolean; ignoreTrimWhitespace: boolean },
): void {
  if (latest.sides) handle.show(latest.sides);
  handle.setInline(latest.inline);
  handle.setIgnoreTrimWhitespace(latest.ignoreTrimWhitespace);
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
