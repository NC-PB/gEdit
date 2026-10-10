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
  // A hover opens below the word and goes above it only when there is no room below. In the
  // fixed layer the room above a line near the top of the editor is the ribbon and the tab
  // bar, and a hover that prefers "above" there is drawn over them.
  hover: { above: false },
} as const satisfies MonacoApi.editor.IEditorOptions;
