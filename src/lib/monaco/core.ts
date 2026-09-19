// Loads the full Monaco *editor* (all editor contributions: find, suggest,
// snippets, folding, multicursor, hover, context menu, quick access / F1,
// Ctrl+G, ...) WITHOUT any of the bundled languages or language services
// (TS/JSON/CSS/HTML workers, 80+ Monarch grammars, LSP client).
//
// `edcore.main.js` ships no .d.ts, so it is imported for its side effects
// only; the typed API comes from `editor.api.js`. Both resolve to the same
// `editor.api2.js` module instance, so this is one Monaco, not two.
//
// Only ever import this module dynamically (see ./setup.ts) so it stays out
// of the initial bundle and is never evaluated during SSR/prerender.
import 'monaco-editor/esm/vs/editor/edcore.main.js';

export * from 'monaco-editor/esm/vs/editor/editor.api.js';
