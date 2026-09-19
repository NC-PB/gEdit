import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { fanucLanguageDef, getFanucCompletions } from '$lib/languages/fanuc';
import { heidenhainLanguageDef, getHeidenhainCompletions } from '$lib/languages/heidenhain';

export type Monaco = typeof MonacoApi;

let monacoPromise: Promise<Monaco> | null = null;

/**
 * Returns the locally bundled Monaco instance (no CDN, no AMD loader).
 * The first call loads Monaco, wires up the editor web worker and registers
 * the custom G-code languages; every later call returns the same promise.
 * Browser-only: call it from onMount (or other client-only code).
 */
export function getMonaco(): Promise<Monaco> {
  if (!monacoPromise) {
    monacoPromise = loadMonaco().catch((err) => {
      monacoPromise = null; // allow a retry after a failed load
      throw err;
    });
  }
  return monacoPromise;
}

async function loadMonaco(): Promise<Monaco> {
  const [monaco, { default: EditorWorker }] = await Promise.all([
    import('./core'),
    // Vite emits the worker as its own same-origin file (no blob:, no data:).
    import('monaco-editor/esm/vs/editor/editor.worker.js?worker'),
  ]);

  // Only the base editor worker is needed: the app registers Monarch
  // grammars only, no TS/JSON/CSS/HTML language services.
  self.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  };

  monaco.languages.register({ id: 'fanuc-gcode' });
  monaco.languages.setMonarchTokensProvider('fanuc-gcode', fanucLanguageDef);
  monaco.languages.registerCompletionItemProvider('fanuc-gcode', getFanucCompletions(monaco));

  monaco.languages.register({ id: 'heidenhain-klartext' });
  monaco.languages.setMonarchTokensProvider('heidenhain-klartext', heidenhainLanguageDef);
  monaco.languages.registerCompletionItemProvider('heidenhain-klartext', getHeidenhainCompletions(monaco));

  return monaco;
}
