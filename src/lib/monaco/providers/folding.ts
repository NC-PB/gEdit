// Folding ranges for tool segments, programs and sections (plan §5 WP3.5).
// Owner: WP3.5.
//
// The ranges come from `OutlineItem.endLine`, which is why the outline index tracks it.
// A one-line item is not a range: a section heading that announces the next tool call
// ends on its own line, and Monaco would draw a fold arrow that folds nothing.

import { outline } from '$lib/app/outlineService';
import { docIdOf, flatten } from './symbols';
import type { Monaco } from '$lib/monaco/setup';
import type { Disposable } from '$lib/app/types';

/** Registers the folding-range provider for one profile (Monaco language id). */
export function registerFolding(monaco: Monaco, profileId: string): Disposable {
  const registration = monaco.languages.registerFoldingRangeProvider(profileId, {
    async provideFoldingRanges(model) {
      const id = docIdOf(model);
      if (id === null) return [];
      await outline.whenReady(id);
      const lines = model.getLineCount();
      const ranges: import('monaco-editor/esm/vs/editor/editor.api.js').languages.FoldingRange[] = [];
      for (const item of flatten(outline.snapshot(id))) {
        const end = Math.min(item.endLine ?? item.line, lines);
        if (item.line < 1 || end <= item.line) continue;
        ranges.push({ start: item.line, end, kind: monaco.languages.FoldingRangeKind.Region });
      }
      return ranges;
    },
  });
  return () => registration.dispose();
}
