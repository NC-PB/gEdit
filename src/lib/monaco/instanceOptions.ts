// Construction options that every Monaco editor of gEdit shares (B1 A9). Pure data and no
// import of Monaco, so `editorService.ts` and `diff.ts` can both take it.
//
// `createDiffEditor` and `create` both feed the editor options they are given into the one
// standalone configuration service (see the header of `diff.ts`), so these values have to be
// the same at every creation site: a site that left one out would switch it back on for the
// editors that were made earlier.

import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

export const SHARED_EDITOR_OPTIONS = {
  // No colour boxes. Monaco's built-in colour detection reads `#101` in `#101=5` (a Fanuc
  // parameter) as the colour #110011 and draws a swatch with a picker in front of it. NC
  // text has no colours; `defaultColorDecorators` switches the built-in detector off and
  // `colorDecorators` every decorator, whoever provides the colour. No colour provider is
  // registered for any NC language either (`languages.test.ts` holds that).
  colorDecorators: false,
  defaultColorDecorators: 'never',
  // Hovers, the suggest list and the find widget's tips are drawn in a fixed layer on top
  // of the page instead of inside the editor box, which clips them: a hover on one of the
  // first lines no longer sticks out under the ribbon and gets cut off.
  fixedOverflowWidgets: true,
  // No `hover.above` here on purpose (owner decision, 2026-10-10): a hover is placed the
  // way Monaco places it, above the word and below it when there is no room above in the
  // window. Near the first lines it may be drawn over the ribbon; it is fully visible.
} as const satisfies MonacoApi.editor.IEditorOptions;
