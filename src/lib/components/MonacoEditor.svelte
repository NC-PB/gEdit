<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
  import { getMonaco } from '$lib/monaco/setup';
  import type { CursorInfo } from '$lib/monaco/types';

  /** Initial content (used until the editor has loaded). */
  export let text: string = '';
  export let language: string = 'plaintext';
  /** Called after every content change (typing, undo/redo, inserts, loads). */
  export let onChange: (() => void) | undefined = undefined;
  /** Called when the cursor or selection changes. */
  export let onCursorChange: ((info: CursorInfo) => void) | undefined = undefined;
  /** Called once the Monaco editor has been created. */
  export let onReady: (() => void) | undefined = undefined;

  let editorContainer: HTMLElement;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoInstance: typeof Monaco | undefined;
  let destroyed = false;
  let loadError = '';
  // Model alternative version id of the last loaded/saved state. Undoing back
  // to that state yields the same id again, so the buffer counts as clean.
  let cleanVersionId = 0;

  onMount(async () => {
    let monaco: typeof Monaco;
    try {
      // Locally bundled Monaco; the custom languages are registered inside getMonaco().
      monaco = await getMonaco();
    } catch (err) {
      console.error('Failed to load the Monaco editor', err);
      loadError = `The editor failed to load: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    if (destroyed) return; // component went away while Monaco was loading

    const editor = monaco.editor.create(editorContainer, {
      value: text,
      language: language,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 14,
      fontFamily: "'Fira Code', 'Consolas', monospace",
      lineNumbersMinChars: 4,
      padding: { top: 16 }
    });
    cleanVersionId = editor.getModel()?.getAlternativeVersionId() ?? 0;

    editor.onDidChangeModelContent(() => onChange?.());
    editor.onDidChangeCursorPosition(emitCursor);
    editor.onDidChangeCursorSelection(emitCursor);

    monacoInstance = monaco;
    monacoEditor = editor;
    emitCursor();
    onReady?.();
  });

  onDestroy(() => {
    destroyed = true;
    monacoEditor?.dispose();
    monacoEditor = undefined;
  });

  function emitCursor() {
    if (!monacoEditor || !onCursorChange) return;
    const model = monacoEditor.getModel();
    const position = monacoEditor.getPosition();
    const selections = monacoEditor.getSelections() ?? [];
    let selectedChars = 0;
    if (model) {
      for (const selection of selections) {
        if (!selection.isEmpty()) selectedChars += model.getValueLengthInRange(selection);
      }
    }
    onCursorChange({
      line: position?.lineNumber ?? 1,
      column: position?.column ?? 1,
      selectedChars,
      selections: Math.max(selections.length, 1)
    });
  }

  // Exported actions
  export function insertTextAtCursor(insertStr: string) {
    if (!monacoEditor || !monacoInstance) return;
    const position = monacoEditor.getPosition();
    if (position) {
      monacoEditor.executeEdits('custom-insert', [{
        range: new monacoInstance.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        text: insertStr,
        forceMoveMarkers: true
      }]);
    }
  }

  export function getEditorValue(): string {
    return monacoEditor ? monacoEditor.getValue() : text;
  }

  export function setEditorValue(val: string) {
    if (monacoEditor && monacoEditor.getValue() !== val) {
      monacoEditor.setValue(val);
    }
    text = val;
  }

  /**
   * Replaces the whole buffer with a freshly opened document: switches the
   * model language first (so the new text is tokenized only once), resets the
   * undo history and marks the result as clean.
   */
  export function loadDocument(val: string, lang: string) {
    text = val;
    if (!monacoEditor || !monacoInstance) return; // the editor is created from `text` once Monaco has loaded
    const model = monacoEditor.getModel();
    if (model) monacoInstance.editor.setModelLanguage(model, lang);
    // setValue re-detects the EOL: CRLF if over half the breaks are CR-based, else LF. Mixed
    // (and CR-only) files are normalized to it; edits and getValue() then use it, so saves keep it.
    monacoEditor.setValue(val); // also clears the undo stack
    markClean();
  }

  /** Current model alternative version id (0 before the editor exists). */
  export function getVersionId(): number {
    return monacoEditor?.getModel()?.getAlternativeVersionId() ?? 0;
  }

  /** Marks the given version (default: the current one) as the saved state. */
  export function markClean(versionId: number = getVersionId()) {
    cleanVersionId = versionId;
  }

  export function isDirty(): boolean {
    return !!monacoEditor && getVersionId() !== cleanVersionId;
  }

  export function focus() {
    monacoEditor?.focus();
  }

  export function getSelectedText(): string {
    if (!monacoEditor) return '';
    const selection = monacoEditor.getSelection();
    if (selection && !selection.isEmpty()) {
      return monacoEditor.getModel()?.getValueInRange(selection) || '';
    }
    return '';
  }

  export function alignToLine(lineNumber: number) {
    if (!monacoEditor) return;
    monacoEditor.revealLineInCenter(lineNumber);
    monacoEditor.setPosition({ lineNumber, column: 1 });
    monacoEditor.focus();
  }

  // React to language change
  $: if (monacoEditor && monacoInstance) {
    const model = monacoEditor.getModel();
    if (model) {
      monacoInstance.editor.setModelLanguage(model, language);
    }
  }
</script>

<style>
  .editor-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: var(--bg-app); /* Match background */
  }
  .editor-container {
    width: 100%;
    height: 100%;
  }
  .editor-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: #f38ba8;
    font-size: 13px;
    text-align: center;
  }
</style>

<div class="editor-wrapper">
  <div class="editor-container" bind:this={editorContainer}></div>
  {#if loadError}
    <div class="editor-error" role="alert">{loadError}</div>
  {/if}
</div>
