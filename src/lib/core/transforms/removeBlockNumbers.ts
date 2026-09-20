// Remove block numbers (plan §5 WP4.2). Owner: **WP4.2**.
//
// Drops the block number and the whitespace that followed it, and nothing else:
// `/N100 G0` becomes `/G0`, `N120/G0` keeps its skip mark, `(N50)` inside a comment stays
// untouched, and a block that had no number is left exactly as it was.
//
// Not available when `syntax.blockNumber.mandatory` is set: a control that refuses an
// unnumbered block would reject the whole program, so `available()` answers with the
// reason instead of producing a file that cannot run.
//
// ## Why this is a two-line edit and still needs the tokenizer
//
// `line.replace(/^N\d+\s*/, '')` gets `/N100 G0` wrong, gets `N120/G0` wrong, and eats
// the `N50` of a line that begins `N50` inside nothing at all. `tokenizeLine` marks the
// one span that is a block number — it is only ever produced at the head of a block, and
// never inside a comment, a string or a Klartext continuation line — so the edit is
// "cut that span plus the whitespace behind it" and cannot reach anything else.
//
// A line that held nothing but its block number becomes empty. That is what removing the
// numbers means, but such a line is usually a jump target, so each one is reported to the
// results panel with a warning.
//
// ## The jump targets
//
// This transform is strictly more destructive than `renumber`: a renumber leaves *a*
// number on the target block, so a `GOTO 100` lands on the wrong block; removing the
// numbers leaves no target at all, and the control alarms. It used to be the quieter of
// the two all the same — no preflight, no reference warning, nothing (G8 M4).
//
// It now runs the same document-wide reference scan as `renumber` (`references.ts`), asks
// the same confirmation before it starts, and lists every referencing line in the results
// panel. Refusing outright was considered and dropped: a program whose jumps are all
// inside subprograms it does not renumber is a real case, and the user who reads the
// dialog is the one who knows.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { t } from '$lib/i18n';
import { continuationRisk, stateBefore } from './fragment';
import { hasReference, referenceAddresses, referencePreflight, scanReferences } from './references';
import type { Located, Msg } from '$lib/app/types';
import type { LineState } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** Rows the results panel gets at most; the warning still counts every emptied line. */
const ROW_LIMIT = 200;

const TAB = 0x09;
const SPACE = 0x20;

function isSpaceCode(code: number): boolean {
  return code === SPACE || code === TAB;
}

/** True while the line holds nothing but spaces and tabs. */
function isBlank(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (!isSpaceCode(line.charCodeAt(i))) return false;
  return true;
}

/**
 * True when the scope holds at least one block number, so the run has something to do.
 *
 * Costs one pass over the scope, which the run pays anyway. It is what keeps the
 * confirmation below off a program that has nothing to remove: a dialog that asks
 * whether to break the jumps of a program the run will not touch is a dialog people
 * learn to click through.
 */
function hasBlockNumber(lines: string[], ctx: TransformContext): boolean {
  let state: LineState | undefined = stateBefore(ctx);
  for (const line of lines) {
    const { tokens, state: next } = tokenizeLine(line, ctx.cp, state);
    state = next;
    if (tokens.some((token) => token.kind === 'blockNumber')) return true;
  }
  return false;
}

/**
 * The confirmation this transform asks for: the jump targets it is about to delete.
 *
 * The same scan `renumber` runs, over the whole document rather than over the selection,
 * plus the continuation guard a fragment needs on a dialect that joins blocks. Neither
 * is asked when there is no block number in the scope to begin with.
 */
function preflightOf(lines: string[], ctx: TransformContext): Msg | null {
  if (!hasBlockNumber(lines, ctx)) return null;
  if (continuationRisk(ctx, stateBefore(ctx))) return { key: 'ncNumbering.removeBlockNumbers.fragmentUnknown' };
  return referencePreflight(scanReferences(lines, ctx), {
    references: 'ncNumbering.removeBlockNumbers.references',
    unchecked: 'ncNumbering.removeBlockNumbers.referencesUnchecked',
  });
}

function runRemove(lines: string[], ctx: TransformContext): TransformResult {
  const cp = ctx.cp;
  const emptiedRow = t('ncNumbering.removeBlockNumbers.emptiedRow');
  const referenceRow = t('ncNumbering.removeBlockNumbers.referenceRow');
  const addresses = referenceAddresses(cp);

  const out = lines.slice();
  const lineMap = new Int32Array(lines.length);
  const skipped: Located[] = [];
  const warnings: Msg[] = [];
  let removed = 0;
  let emptied = 0;
  let references = 0;
  // The state `lines[0]` begins in, so a Klartext selection that starts inside a `~`
  // block does not read the tail of that block as a numbered head (`fragment.ts`).
  let state: LineState | undefined = stateBefore(ctx);

  const note = (index: number, message: string): void => {
    if (skipped.length < ROW_LIMIT) skipped.push({ line: ctx.firstLine + index, message, severity: 'warning' });
  };

  for (let i = 0; i < lines.length; i++) {
    lineMap[i] = i;
    const line = lines[i];
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;

    // Listed before the number goes: this is the line that will still point at a block
    // number the program no longer has.
    if (addresses.size > 0 && hasReference(tokens, line, cp, addresses)) {
      references++;
      note(i, referenceRow);
    }

    // At most one, and only ever at the head of a block (`tokenizeLine`).
    const number = tokens.find((token) => token.kind === 'blockNumber');
    if (number === undefined) continue;

    let end = number.end;
    while (end < line.length && isSpaceCode(line.charCodeAt(end))) end++;
    out[i] = line.slice(0, number.start) + line.slice(end);
    removed++;

    if (isBlank(out[i]) && !isBlank(line)) {
      emptied++;
      note(i, emptiedRow);
    }
  }

  // A run that removed nothing reports nothing. The reference rows were collected while
  // walking, before it was known whether any number would go; a program whose numbers
  // are already gone would otherwise be told that its jumps point at numbers this run
  // removed, which it did not.
  if (removed === 0) skipped.length = 0;

  if (emptied > 0) warnings.push({ key: 'ncNumbering.removeBlockNumbers.emptied', params: { count: emptied } });
  if (removed > 0 && references > 0) {
    warnings.push({ key: 'ncNumbering.removeBlockNumbers.referencesKept', params: { count: references } });
  }
  const listed = removed === 0 ? 0 : emptied + references;
  if (listed > skipped.length) {
    warnings.push({ key: 'ncNumbering.removeBlockNumbers.skippedTruncated', params: { shown: skipped.length, total: listed } });
  }

  const summary: Msg =
    removed === 0 ? { key: 'ncNumbering.removeBlockNumbers.nothing' } : { key: 'ncNumbering.removeBlockNumbers.summary', params: { count: removed } };

  return { lines: out, lineMap, summary, skipped, warnings };
}

export const removeBlockNumbers: TransformDef = {
  id: 'remove-block-numbers',
  title: 'ncNumbering.removeBlockNumbers.title',
  available(cp: CompiledProfile): true | Msg {
    return cp.profile.syntax.blockNumber.mandatory === true ? { key: 'ncNumbering.removeBlockNumbers.mandatory' } : true;
  },
  preflight(lines: string[], ctx: TransformContext): Msg | null {
    return preflightOf(lines, ctx);
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    return runRemove(lines, ctx);
  },
};
