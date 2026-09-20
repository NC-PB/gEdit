// Remove empty lines (plan §5 WP4.3). Owner: WP4.3.
//
// A line counts as empty when it holds nothing but whitespace. A line holding only a
// block number is not empty, and neither is a comment.
//
// On Klartext the block numbers have to stay consecutive, so removing lines leaves a
// program the control rejects. The transform therefore warns and `contrib/ncCleanup.ts`
// offers `nc.renumber` afterwards, rather than renumbering behind the user's back.
//
// **The last line is never deleted.** The array a transform receives carries the
// document's trailing state in its final element: a file that ends with a newline is
// `['A', '']`, and dropping that `''` would take the final newline with it (rule 5 of
// `types.ts`). So `['A', '', '', '']` becomes `['A', '']` — every blank line goes, and the
// one that says "this file ends with a newline" stays.
//
// This is the transform that proves the `lineMap` contract: a bookmark on a line it did
// not delete has to be on the same block afterwards.

import type { Msg } from '$lib/app/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** True when the line holds nothing but whitespace. */
function isBlank(line: string): boolean {
  return line.trim() === '';
}

export const removeEmptyLines: TransformDef = {
  id: 'remove-empty-lines',
  title: 'ncCleanup.removeEmptyLines.title',
  available(cp: CompiledProfile): true | Msg {
    void cp;
    return true;
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    const last = lines.length - 1;
    const out: string[] = [];
    const lineMap = new Int32Array(lines.length);
    let removed = 0;

    for (let i = 0; i < lines.length; i++) {
      if (i !== last && isBlank(lines[i])) {
        lineMap[i] = -1;
        removed++;
        continue;
      }
      lineMap[i] = out.length;
      out.push(lines[i]);
    }

    const warnings: Msg[] = [];
    if (removed > 0 && ctx.cp.profile.numbering?.mode === 'consecutive') {
      warnings.push({ key: 'ncCleanup.renumberNeeded' });
    }

    return {
      lines: out,
      lineMap,
      summary:
        removed === 0
          ? { key: 'ncCleanup.removeEmptyLines.summaryNone' }
          : { key: 'ncCleanup.removeEmptyLines.summary', params: { count: removed } },
      skipped: [],
      warnings,
    };
  },
};
