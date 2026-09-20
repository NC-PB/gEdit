// Block-number references: who points at a block number, and what that costs a run that
// rewrites or removes one (plan §7.4 `numbering.references`, syntax-fanuc §7).
// Owner: **WP4.2**.
//
// `GOTO 100`, `M99 P100` and the lathe pair `G71 P100 Q200` / `G70 P100 Q200` all name a
// block by its number. Nothing in gEdit rewrites those pointers, so a transform that
// touches block numbers has to say so before it runs — and both transforms that touch
// them now ask the same code, which is why this module exists.
//
// It used to live inside `renumber.ts`, which meant `remove-block-numbers` had none of
// it: it deleted `N100` and `N200` out from under a `G71 P100 Q200` and reported nothing
// at all (G8 M4). Removing a jump target is strictly worse than renumbering one, so the
// warning belongs to the more destructive transform first.
//
// ## Two halves, and both are needed
//
// A rule fires only when the **trigger** matches the comment-masked line *and* the line
// carries a word with one of the rule's **addresses**. `M99` on its own returns to the
// caller and points at nothing; `P` on its own is a subprogram number, a dwell or a
// peck. Requiring both is what keeps `M98 P1010` — a program number — out of this.
//
// ## Why the scan is not the scope
//
// A selection that holds `N100` but not the `GOTO 100` above it used to come back with
// no references and no warning at all, and the renumber rewrote the target in silence
// (G8 M4). References are a property of the **document**, not of the lines a run happens
// to cover, so [`scanReferences`] reads `ctx.document` whenever the context carries one
// and reports honestly when it does not.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { documentOf } from './fragment';
import type { Msg } from '$lib/app/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

/**
 * The line with its comments blanked out, same length and same offsets.
 *
 * `maskComments` (WP3.2) does the same from the raw line; here the tokens are already in
 * hand, so blanking their spans is the same decision without a second scan. Only comments
 * are blanked — a string is code (a tool name), exactly as `mask.ts` has it.
 */
export function maskedOf(line: string, tokens: NcToken[]): string {
  let masked = line;
  for (const token of tokens) {
    if (token.kind !== 'comment') continue;
    masked = masked.slice(0, token.start) + ' '.repeat(token.end - token.start) + masked.slice(token.end);
  }
  return masked;
}

/** Every address a `numbering.references` rule could have to rewrite, for the cheap test below. */
export function referenceAddresses(cp: CompiledProfile): Set<string> {
  const all = new Set<string>();
  for (const rule of cp.re.references) for (const address of rule.addresses) all.add(address);
  return all;
}

/**
 * True when a `numbering.references` rule fires on this line.
 *
 * A rule needs both halves: the trigger (`M99`, `GOTO`, `G71`) on the comment-masked
 * line, and the address whose value is a block number. `M99` on its own returns to the
 * calling block and points at nothing, so it is not a reference.
 */
export function hasReference(
  tokens: NcToken[],
  line: string,
  cp: CompiledProfile,
  addresses: Set<string>,
): boolean {
  let carried: string[] | null = null;
  for (const token of tokens) {
    if (token.kind !== 'word' && token.kind !== 'keyword') continue;
    if (token.address === undefined || !addresses.has(token.address)) continue;
    (carried ??= []).push(token.address);
  }
  if (carried === null) return false;

  const masked = maskedOf(line, tokens);
  for (const rule of cp.re.references) {
    if (!rule.addresses.some((address) => carried.includes(address))) continue;
    if (rule.trigger.test(masked)) return true;
  }
  return false;
}

/** What a scan of the program for block-number references found. */
export interface ReferenceScan {
  /** How many lines point at a block number. */
  count: number;
  /** The first such line, as a document line number; 0 when there is none. */
  first: number;
  /**
   * True when the run could only look at its own lines, so a pointer above or below the
   * selection was not examined. The caller warns; it never reports "no references".
   */
  unchecked: boolean;
}

/**
 * Every line of the document that points at a block number.
 *
 * Reads `ctx.document` when the context carries one — a reference outside the selection
 * still breaks — and falls back to `lines` when it does not, which is the case for a
 * fragment handed to a headless caller. The fallback sets `unchecked`.
 */
export function scanReferences(lines: string[], ctx: TransformContext): ReferenceScan {
  if (ctx.cp.re.references.length === 0) return { count: 0, first: 0, unchecked: false };

  const document = documentOf(ctx, lines);
  const scanned = document ?? lines;
  // The document is read from its own line 1; a bare fragment starts where the scope does.
  const offset = document !== null ? 1 : ctx.firstLine;
  // Without a document, a run that starts at line 1 is the whole program as far as
  // anyone here can tell; one that starts below it is knowingly looking at a fragment.
  const unchecked = document === null && ctx.firstLine > 1;

  const addresses = referenceAddresses(ctx.cp);
  let count = 0;
  let first = 0;
  let state: LineState | undefined;
  for (let i = 0; i < scanned.length; i++) {
    const { tokens, state: next } = tokenizeLine(scanned[i], ctx.cp, state);
    state = next;
    if (!hasReference(tokens, scanned[i], ctx.cp, addresses)) continue;
    count++;
    if (first === 0) first = offset + i;
  }
  return { count, first, unchecked };
}

/**
 * The confirmation a scan asks for, or null when there is nothing to confirm.
 *
 * `keys.references` is used when the scan found pointers, `keys.unchecked` when it could
 * not look outside the selection. A run that is both gets the first, which is the more
 * concrete of the two.
 */
export function referencePreflight(
  scan: ReferenceScan,
  keys: { references: string; unchecked: string },
): Msg | null {
  if (scan.count > 0) return { key: keys.references, params: { count: scan.count, first: scan.first } };
  if (scan.unchecked) return { key: keys.unchecked };
  return null;
}
