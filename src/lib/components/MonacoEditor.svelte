<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import loader from '@monaco-editor/loader';
  import type * as Monaco from 'monaco-editor';

  export let text: string = '';
  export let language: string = 'plaintext';

  let editorContainer: HTMLElement;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor;
  let monacoInstance: typeof Monaco;
  
  onMount(async () => {
    // Load Monaco
    monacoInstance = await loader.init();

    // Create Editor
    monacoEditor = monacoInstance.editor.create(editorContainer, {
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

    // Listen for changes
    monacoEditor.onDidChangeModelContent(() => {
      text = monacoEditor.getValue();
    });
  });

  onDestroy(() => {
    if (monacoEditor) {
      monacoEditor.dispose();
    }
  });

  // Exported actions
  export function insertTextAtCursor(insertStr: string) {
    if (!monacoEditor) return;
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
    width: 100%;
    height: 100%;
    overflow: hidden;
    background-color: var(--bg-app); /* Match background */
  }
  .editor-container {
    width: 100%;
    height: 100%;
  }
</style>

<div class="editor-wrapper">
  <div class="editor-container" bind:this={editorContainer}></div>
</div>
