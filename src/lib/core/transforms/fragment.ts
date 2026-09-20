// What a transform may assume about the lines above its scope. Owner: **WP4.1**.
//
// A transform that runs on a selection sees a fragment, and a fragment has no history.
// Everything modal in an NC program — a feed mode, a cycle, a Klartext `~` block — is
// set further up and is invisible from inside the selection. The tokenizer says as much:
// `tokenizeLine(line, cp, prev)` takes the state of the line *before* this one, and every
// transform starts that state at `undefined`, which means "line 1 of the document".
//
// That is right for a whole-document run and wrong for a selection. The review found it
// in its worst shape: a Klartext selection starting inside a `CYCL DEF … ~` block made
// `renumber` read the cycle's parameter tails as block heads and write `0` between the
// indentation and the first `Q` parameter of the cycle.
//
// So this module answers one question — *what state does `lines[0]` begin in?* — and is
// honest when it cannot:
//
//  - `firstLine === 1`: the start of the document, which is `{ continuation: false }`.
//  - `ctx.document` present and long enough: tokenize down to `firstLine - 1` and use
//    the state that comes out.
//  - otherwise: `undefined`, "not known". A caller that gets `undefined` on a dialect
//    with a `continuation` pattern must warn rather than guess, which is what
//    `continuationRisk` is for.
//
// The walk costs one tokenize per line above the scope and happens once per run. A
// whole-document run pays nothing (the first branch), and a selection at the end of a
// 100k-line program pays what the whole-document run of the same transform pays anyway.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

/** The state the document starts in, which is what line 1 is tokenized with. */
export const DOCUMENT_START: LineState = { continuation: false };

/**
 * The `LineState` that `lines[0]` begins in, or `undefined` when the run cannot know it.
 *
 * Pass it as the `prev` argument of the first `tokenizeLine` of a run. `undefined` is
 * also what `tokenizeLine` reads as "the start of the document", so a transform that
 * ignores the difference behaves exactly as it did before — which is why every caller
 * that cares checks [`continuationRisk`] as well.
 */
export function stateBefore(ctx: TransformContext): LineState | undefined {
  const firstLine = Math.trunc(ctx.firstLine);
  if (!Number.isFinite(firstLine) || firstLine <= 1) return DOCUMENT_START;

  const document = ctx.document;
  // A document that does not reach the scope cannot be the scope's document; refusing to
  // use it is the same answer as not having one.
  if (document === undefined || document.length < firstLine - 1) return undefined;

  let state: LineState | undefined;
  for (let i = 0; i < firstLine - 1; i++) {
    state = tokenizeLine(document[i], ctx.cp, state).state;
  }
  return state ?? DOCUMENT_START;
}

/**
 * True when this run starts inside a block whose head is above the scope, so the first
 * lines of `lines` are a continuation tail and not blocks of their own.
 *
 * `undefined` from [`stateBefore`] on a dialect that has continuations is reported as a
 * risk too: not knowing is not the same as knowing there is none, and the two cases lead
 * to the same warning.
 */
export function continuationRisk(ctx: TransformContext, state: LineState | undefined): boolean {
  if (!hasContinuations(ctx.cp)) return false;
  return state === undefined || state.continuation;
}

/** Whether the dialect joins a block across lines at all (Klartext `~`). */
export function hasContinuations(cp: CompiledProfile): boolean {
  return cp.re.continuation !== undefined;
}

/**
 * The whole document when the context carries one that reaches the scope, else null.
 *
 * Null is the answer a caller has to be able to live with: it means "this run can only
 * see its own lines", and a run on a fragment then says so instead of reporting a clean
 * bill of health it did not earn.
 */
export function documentOf(ctx: TransformContext, lines: readonly string[]): readonly string[] | null {
  const document = ctx.document;
  const firstLine = Math.trunc(ctx.firstLine);
  if (document === undefined || !Number.isFinite(firstLine) || firstLine < 1) return null;
  if (document.length < firstLine - 1 + lines.length) return null;
  return document;
}

