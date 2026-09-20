import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';
import { registerAll } from '$lib/monaco/languages';

export type Monaco = typeof MonacoApi;

let monacoPromise: Promise<Monaco> | null = null;

/**
 * Returns the locally bundled Monaco instance (no CDN, no AMD loader).
 * The first call loads Monaco, wires up the editor web worker and registers
 * the profiles as languages; every later call returns the same promise.
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

  // One language per dialect profile, with its generated grammar, plus the two generated
  // themes. Everything a dialect needs is data now, so a new profile needs no code here
  // (plan §5 WP3.4; M0's hand-written `src/lib/languages/**` is gone).
  registerAll(monaco);

  return monaco;
}
