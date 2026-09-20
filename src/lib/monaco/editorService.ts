// The one Monaco editor and the models behind the open documents (plan §7.2, AD-5).
//
// - One `IStandaloneCodeEditor`, one model per document, URI `inmemory://doc/<id>`.
// - The service subscribes to `docs.activeId` when it is created and switches models
//   synchronously (save the view state, `setModel`, restore the view state), so a
//   `reveal()` straight after `activate()` is safe.
// - Text is LF-normalized before a model is created; the model EOL is CRLF for a `crlf`
//   document and LF otherwise, so `lf` and `cr` share one model shape and a CR-only file
//   survives a round trip (the file operations join `getText()` with the document EOL).
// - `textDirty` is `alternativeVersionId !== cleanVersionId` and is pushed into the
//   document store only when that value flips.
// - Every rewrite is one undo step: `pushStackElement`, `pushEditOperations`,
//   `pushStackElement`. `setValue` is used only while a model is being created.
// - `onDidChangeContent` reports ONE spanning `ContentChange` per Monaco event.
// - The cursor callback is throttled to one animation frame.
//
// IMPORTANT: Monaco is reached through `$lib/monaco/setup`, which imports
// `$lib/monaco/core` *dynamically*. Nothing in this module may import `core` for a
// value, or Monaco would land in the initial bundle and be evaluated during prerender
// (`app/context.test.ts` is the tripwire).

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { getMonaco, type Monaco } from '$lib/monaco/setup';
import { docs as appDocs } from '$lib/stores/documents';
import type {
  ContentChange,
  CursorInfo,
  Disposable,
  DocId,
  DocumentStore,
  EditorService,
  Eol,
} from '$lib/app/types';

/**
 * Editor construction options: what the editor looks like for the few statements between
 * `create()` and the replay of `updateOptions` below.
 *
 * They are **not** the app's settings. Every value here that a setting also drives
 * (`theme`, `fontSize`, `fontFamily`, `minimap`) is overwritten synchronously at the end
 * of `doAttach`, so these only decide the look of an editor that nobody ever configured —
 * a unit test, or a build without `contrib/theme.ts`. `theme: 'vs-dark'` matches the
 * `FALLBACK` of `app/theme.ts` and the dark palette on `:root` in `app.css`.
 */
const EDITOR_OPTIONS: MonacoApi.editor.IStandaloneEditorConstructionOptions = {
  model: null,
  theme: 'vs-dark',
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 14,
  fontFamily: "'Fira Code', 'Consolas', monospace",
  lineNumbersMinChars: 4,
  padding: { top: 16 },
};

/** A document whose model exists. */
interface ModelEntry {
  model: MonacoApi.editor.ITextModel;
  /** The `alternativeVersionId` the buffer was last loaded or saved at. */
  cleanVersionId: number;
  /** Line count after the previous content event, for the spanning `ContentChange`. */
  lineCount: number;
  /** Removes the content listener. */
  unlisten: () => void;
}

/** A document created before `attach()` had Monaco; realized when the editor appears. */
interface PendingModel {
  textLF: string;
  languageId: string;
  eol: Eol;
}

export interface EditorServiceDeps {
  docs: DocumentStore;
  /** Resolves the Monaco namespace. Injected so a test never has to load the real one. */
  loadMonaco: () => Promise<Monaco>;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for the unit tests)
// ---------------------------------------------------------------------------

/** Monaco's model EOL is irrelevant to the rest of the app: text always travels as LF. */
export function normalizeToLF(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** The lines of `textLF`, 1-based inclusive and clamped to the text. */
export function linesOf(textLF: string, startLine: number, endLine: number): string[] {
  if (endLine < startLine) return [];
  const lines = textLF.split('\n');
  const from = Math.max(1, startLine);
  const to = Math.min(lines.length, endLine);
  return from > to ? [] : lines.slice(from - 1, to);
}

/** The fields of `IModelContentChangedEvent` the spanning range is built from. */
export interface ContentEventLike {
  changes: readonly { range: { startLineNumber: number; endLineNumber: number } }[];
  isFlush: boolean;
  versionId: number;
}

/**
 * One spanning `ContentChange` per Monaco event: `[startLine, endLineOld]` in the old
 * document and `[startLine, endLineNew]` in the new one, 1-based and inclusive.
 * A flush (`setValue`) and an EOL-only change (no `changes`) span the whole document.
 *
 * `versionId` is Monaco's monotonic model version, not `alternativeVersionId`: it is a
 * cache marker, and unlike the alternative id it never goes backwards on undo.
 */
export function spanOfChange(
  event: ContentEventLike,
  oldLineCount: number,
  newLineCount: number,
): ContentChange {
  if (event.isFlush || event.changes.length === 0) {
    return {
      startLine: 1,
      endLineOld: Math.max(oldLineCount, 1),
      endLineNew: Math.max(newLineCount, 1),
      flush: event.isFlush,
      versionId: event.versionId,
    };
  }
  let startLine = Number.MAX_SAFE_INTEGER;
  let endLineOld = 1;
  for (const change of event.changes) {
    startLine = Math.min(startLine, change.range.startLineNumber);
    endLineOld = Math.max(endLineOld, change.range.endLineNumber);
  }
  return {
    startLine,
    endLineOld,
    endLineNew: endLineOld + (newLineCount - oldLineCount),
    flush: false,
    versionId: event.versionId,
  };
}

/**
 * The lines a selection covers. A selection that ends in column 1 of a later line does
 * not include that line, which is what the line-based transforms expect.
 */
export function selectionLinesOf(
  startLineNumber: number,
  endLineNumber: number,
  endColumn: number,
  empty: boolean,
): { startLine: number; endLine: number; empty: boolean } {
  const endLine = !empty && endColumn === 1 && endLineNumber > startLineNumber ? endLineNumber - 1 : endLineNumber;
  return { startLine: startLineNumber, endLine, empty };
}

let cancellationGuardInstalled = false;

/**
 * Monaco rejects the promise of its background tokenizer with a `Canceled` error when a
 * model is disposed while a delayed run is still queued (closing a tab right after it was
 * opened). Nothing awaits that promise, so it surfaces as an unhandled rejection and the
 * runtime harness counts it as a console error. VS Code drops canceled errors the same
 * way. Installed once, next to the only Monaco owner in the app.
 */
function installCancellationGuard(): void {
  if (cancellationGuardInstalled || typeof window === 'undefined') return;
  cancellationGuardInstalled = true;
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: unknown } | null | undefined;
    if (reason && typeof reason === 'object' && reason.name === 'Canceled') event.preventDefault();
  });
}

/** A minimal listener list; `fire` never lets one listener stop the others. */
function emitter<A extends unknown[]>(): {
  add(cb: (...a: A) => void): Disposable;
  fire(...a: A): void;
} {
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
          console.error('editor listener failed', err);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createEditorService(deps: EditorServiceDeps): EditorService {
  const { docs } = deps;

  let monaco: Monaco | undefined;
  let instance: MonacoApi.editor.IStandaloneCodeEditor | undefined;
  let container: HTMLElement | undefined;
  let attaching: Promise<void> | undefined;

  const models = new Map<DocId, ModelEntry>();
  const pending = new Map<DocId, PendingModel>();
  const viewStates = new Map<DocId, MonacoApi.editor.ICodeEditorViewState>();
  const editorDisposables: MonacoApi.IDisposable[] = [];

  let currentId: DocId | null = docs.getActiveId();
  let cursorScheduled = false;

  /**
   * Every option ever handed to `updateOptions`, shallow-merged, so that a new editor
   * instance can be brought back to the state the old one was in (G8 M2).
   *
   * `attach()` runs more than once: the compare overlay unmounts `EditorHost` and mounts
   * it again, and `doAttach` then builds a **second** `IStandaloneCodeEditor` from
   * `EDITOR_OPTIONS`. Without this replay the user's theme and every settings-driven
   * editor option silently fell back to the construction defaults until the next settings
   * change — and because `create()` feeds its `theme` to the *global* standalone theme
   * service, the whole app went back to `vs-dark`.
   *
   * The subscribers cannot do it themselves: `installEditorSettings` and `setMonacoTheme`
   * hang off `ready`, which resolves on the FIRST attach only. Keeping the payload here is
   * what makes the re-apply attach-scoped instead of first-attach-scoped.
   */
  let appliedOptions: Record<string, unknown> = {};

  const contentEvent = emitter<[DocId, ContentChange]>();
  const cursorEvent = emitter<[CursorInfo]>();
  const createEvent = emitter<[DocId]>();
  const activateEvent = emitter<[DocId | null]>();

  let markReady: () => void = () => {};
  /**
   * Resolves on the FIRST successful attach and never rejects: a failed attach is not the
   * end of the story. A transient chunk-load failure, an HMR reload, or — from M2 on —
   * EditorHost being unmounted and remounted by the compare overlay all lead to another
   * `attach()`, and the one that works has to be able to settle this promise. Rejecting
   * it on the first failure made that impossible, so `installMonacoBridge` never ran and
   * `data-ready` stayed "0" behind a perfectly usable editor.
   *
   * The failure itself is not swallowed: `attach()` rejects to its caller and EditorHost
   * shows the load error.
   */
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });

  // -- models ---------------------------------------------------------------

  /** Monaco, or a hard failure: the callers below only run once it is loaded. */
  function api(): Monaco {
    if (!monaco) throw new Error('editor: Monaco is not loaded');
    return monaco;
  }

  function eolSequence(eol: Eol): MonacoApi.editor.EndOfLineSequence {
    const { editor: ed } = api();
    return eol === 'crlf' ? ed.EndOfLineSequence.CRLF : ed.EndOfLineSequence.LF;
  }

  function syncDirty(id: DocId, entry: ModelEntry): void {
    const textDirty = entry.model.getAlternativeVersionId() !== entry.cleanVersionId;
    if (docs.get(id)?.textDirty !== textDirty) docs.update(id, { textDirty });
  }

  function realize(id: DocId, spec: PendingModel): ModelEntry {
    const monacoApi = api();
    const uri = monacoApi.Uri.parse(`inmemory://doc/${encodeURIComponent(id)}`);
    // A model for this URI can survive a hot reload; Monaco refuses a duplicate URI.
    monacoApi.editor.getModel(uri)?.dispose();
    const model = monacoApi.editor.createModel(normalizeToLF(spec.textLF), spec.languageId, uri);
    model.setEOL(eolSequence(spec.eol));
    const entry: ModelEntry = {
      model,
      cleanVersionId: model.getAlternativeVersionId(),
      lineCount: model.getLineCount(),
      unlisten: () => {},
    };
    const listener = model.onDidChangeContent((event) => {
      const newLineCount = model.getLineCount();
      const change = spanOfChange(event, entry.lineCount, newLineCount);
      entry.lineCount = newLineCount;
      syncDirty(id, entry);
      contentEvent.fire(id, change);
    });
    entry.unlisten = () => listener.dispose();
    models.set(id, entry);
    return entry;
  }

  function disposeModel(id: DocId): void {
    pending.delete(id);
    viewStates.delete(id);
    const entry = models.get(id);
    if (!entry) return;
    if (instance?.getModel() === entry.model) instance.setModel(null);
    entry.unlisten();
    entry.model.dispose();
    models.delete(id);
  }

  // -- the active model -----------------------------------------------------

  function applyActive(id: DocId | null): void {
    const previous = currentId;
    currentId = id;
    if (!instance) return;
    if (previous !== null && models.has(previous)) {
      const state = instance.saveViewState();
      if (state) viewStates.set(previous, state);
    }
    const entry = id === null ? undefined : models.get(id);
    instance.setModel(entry?.model ?? null);
    if (id !== null && entry) {
      const state = viewStates.get(id);
      if (state) instance.restoreViewState(state);
    }
    scheduleCursor();
  }

  // The subscription fires immediately with the current value; `currentId` was seeded
  // from the same store, so that first call is a no-op.
  docs.activeId.subscribe((id) => {
    if (id === currentId) return;
    applyActive(id);
    activateEvent.fire(id);
  });

  // -- cursor ---------------------------------------------------------------

  function cursor(): CursorInfo | null {
    if (!instance) return null;
    const model = instance.getModel();
    const position = instance.getPosition();
    if (!model || !position) return null;
    const selections = instance.getSelections() ?? [];
    const lf = monaco?.editor.EndOfLinePreference.LF;
    let selectedChars = 0;
    for (const selection of selections) {
      // Counted in LF, like `getText()`: a CRLF model must not inflate the count.
      if (!selection.isEmpty()) selectedChars += model.getValueLengthInRange(selection, lf);
    }
    return {
      line: position.lineNumber,
      column: position.column,
      selectedChars,
      selections: Math.max(selections.length, 1),
    };
  }

  function scheduleCursor(): void {
    if (cursorScheduled) return;
    cursorScheduled = true;
    const emit = (): void => {
      cursorScheduled = false;
      const info = cursor();
      if (info) cursorEvent.fire(info);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(emit);
    else queueMicrotask(emit);
  }

  // -- attach ---------------------------------------------------------------

  async function doAttach(element: HTMLElement): Promise<void> {
    const api = await deps.loadMonaco();
    if (container !== element) return; // superseded while Monaco was loading
    monaco = api;
    installCancellationGuard();
    for (const disposable of editorDisposables.splice(0)) disposable.dispose();
    instance?.dispose();
    instance = api.editor.create(element, EDITOR_OPTIONS);
    // In the same synchronous block as `create`, so nothing is ever painted with the
    // construction defaults over the user's settings (see `appliedOptions`).
    if (Object.keys(appliedOptions).length > 0) {
      instance.updateOptions(
        appliedOptions as MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions,
      );
    }
    editorDisposables.push(
      instance.onDidChangeCursorPosition(scheduleCursor),
      instance.onDidChangeCursorSelection(scheduleCursor),
    );
    for (const [id, spec] of [...pending]) {
      pending.delete(id);
      realize(id, spec);
      // Same event as `createModel`: "there is now a real model for this id". A listener
      // that keys cached work on the model — the program map today, M3's OutlineIndex —
      // has to hear about the models that were queued before Monaco arrived too, because
      // a fresh model restarts `alternativeVersionId`.
      createEvent.fire(id);
    }
    const active = currentId;
    currentId = null; // force applyActive to bind the model
    applyActive(active);
    markReady();
  }

  return {
    attach(element: HTMLElement): Promise<void> {
      if (container === element && attaching) return attaching;
      container = element;
      attaching = doAttach(element).catch((err: unknown) => {
        // Forget the failed attempt, so a remount of the same element tries again.
        if (container === element) {
          container = undefined;
          attaching = undefined;
        }
        throw err;
      });
      return attaching;
    },

    ready,

    createModel(id: DocId, textLF: string, languageId: string, eol: Eol): void {
      disposeModel(id);
      const spec: PendingModel = { textLF, languageId, eol };
      if (monaco && instance) {
        const entry = realize(id, spec);
        // A fresh model of the active document goes straight into the editor; there is
        // no view state to save or restore, so this is not a `applyActive` switch.
        if (id === currentId) {
          instance.setModel(entry.model);
          scheduleCursor();
        }
      } else {
        pending.set(id, spec);
      }
      createEvent.fire(id);
    },

    disposeModel,

    hasModel(id: DocId): boolean {
      return models.has(id) || pending.has(id);
    },

    getText(id: DocId): string {
      const entry = models.get(id);
      if (entry && monaco) return entry.model.getValue(monaco.editor.EndOfLinePreference.LF);
      return normalizeToLF(pending.get(id)?.textLF ?? '');
    },

    getLineCount(id: DocId): number {
      const entry = models.get(id);
      if (entry) return entry.model.getLineCount();
      const spec = pending.get(id);
      return spec ? normalizeToLF(spec.textLF).split('\n').length : 0;
    },

    getLines(id: DocId, startLine: number, endLine: number): string[] {
      const entry = models.get(id);
      if (!entry) {
        const spec = pending.get(id);
        return spec ? linesOf(normalizeToLF(spec.textLF), startLine, endLine) : [];
      }
      const last = entry.model.getLineCount();
      const from = Math.max(1, startLine);
      const to = Math.min(last, endLine);
      const lines: string[] = [];
      for (let line = from; line <= to; line++) lines.push(entry.model.getLineContent(line));
      return lines;
    },

    versionId(id: DocId): number {
      return models.get(id)?.model.getAlternativeVersionId() ?? 0;
    },

    markClean(id: DocId): void {
      const entry = models.get(id);
      if (!entry) return; // a pending model is clean by construction
      entry.cleanVersionId = entry.model.getAlternativeVersionId();
      syncDirty(id, entry);
    },

    setLanguage(id: DocId, languageId: string): void {
      const spec = pending.get(id);
      if (spec) {
        pending.set(id, { ...spec, languageId });
        return;
      }
      const entry = models.get(id);
      if (entry && monaco) monaco.editor.setModelLanguage(entry.model, languageId);
    },

    setModelEol(id: DocId, eol: Eol): void {
      const spec = pending.get(id);
      if (spec) {
        pending.set(id, { ...spec, eol });
        return;
      }
      const entry = models.get(id);
      if (entry && monaco) entry.model.pushEOL(eolSequence(eol));
    },

    replaceAll(id: DocId, textLF: string, o?: { keepCursorLine?: boolean }): void {
      const spec = pending.get(id);
      if (spec) {
        pending.set(id, { ...spec, textLF });
        return;
      }
      const entry = models.get(id);
      if (!entry) return;
      const model = entry.model;
      const keepLine =
        o?.keepCursorLine && id === currentId ? instance?.getPosition()?.lineNumber : undefined;
      model.pushStackElement();
      model.pushEditOperations(
        null,
        [{ range: model.getFullModelRange(), text: normalizeToLF(textLF) }],
        () => null,
      );
      model.pushStackElement();
      if (keepLine !== undefined && instance) {
        const lineNumber = Math.min(Math.max(keepLine, 1), model.getLineCount());
        instance.setPosition({ lineNumber, column: 1 });
        instance.revealLineInCenterIfOutsideViewport(lineNumber);
      }
    },

    insertText(text: string): void {
      if (!instance) return;
      const model = instance.getModel();
      if (!model) return;
      const position = instance.getPosition();
      const selections = instance.getSelections() ?? [];
      const ranges =
        selections.length > 0
          ? selections.map((selection) => ({ range: selection, text, forceMoveMarkers: true }))
          : position
            ? [
                {
                  range: {
                    startLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                  },
                  text,
                  forceMoveMarkers: true,
                },
              ]
            : [];
      if (ranges.length === 0) return;
      model.pushStackElement();
      instance.executeEdits('gedit.insertText', ranges);
      model.pushStackElement();
    },

    focus(): void {
      instance?.focus();
    },

    hasFocus(): boolean {
      return instance?.hasTextFocus() ?? false;
    },

    reveal(id: DocId, line: number, column?: number): void {
      if (docs.getActiveId() !== id) docs.activate(id);
      const entry = models.get(id);
      if (!instance || !entry) return;
      const lineNumber = Math.min(Math.max(line, 1), entry.model.getLineCount());
      instance.setPosition({ lineNumber, column: column ?? 1 });
      instance.revealLineInCenter(lineNumber);
      instance.focus();
    },

    cursor,

    selectionLines(): { startLine: number; endLine: number; empty: boolean } | null {
      const selection = instance?.getSelection();
      if (!selection) return null;
      return selectionLinesOf(
        selection.startLineNumber,
        selection.endLineNumber,
        selection.endColumn,
        selection.isEmpty(),
      );
    },

    selectedText(): string {
      if (!instance || !monaco) return '';
      const model = instance.getModel();
      const selection = instance.getSelection();
      if (!model || !selection || selection.isEmpty()) return '';
      return model.getValueInRange(selection, monaco.editor.EndOfLinePreference.LF);
    },

    triggerAction(actionId: string, payload?: unknown): void {
      instance?.trigger('gedit', actionId, payload);
    },

    updateOptions(o: Record<string, unknown>): void {
      // Remembered before it is applied, so an option set while there is no editor (the
      // theme, during startup) still reaches the one that appears later.
      appliedOptions = { ...appliedOptions, ...o };
      instance?.updateOptions(
        o as MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions,
      );
    },

    onDidChangeContent(cb: (id: DocId, c: ContentChange) => void): Disposable {
      return contentEvent.add(cb);
    },

    onDidChangeCursor(cb: (c: CursorInfo) => void): Disposable {
      return cursorEvent.add(cb);
    },

    onDidCreateModel(cb: (id: DocId) => void): Disposable {
      return createEvent.add(cb);
    },

    onDidActivate(cb: (id: DocId | null) => void): Disposable {
      return activateEvent.add(cb);
    },

    model(id: DocId): MonacoApi.editor.ITextModel | undefined {
      return models.get(id)?.model;
    },

    editorInstance(): MonacoApi.editor.IStandaloneCodeEditor | undefined {
      return instance;
    },
  };
}

/** The application-wide editor service. */
export const editor: EditorService = createEditorService({
  docs: appDocs,
  loadMonaco: getMonaco,
});
