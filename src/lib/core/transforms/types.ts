// The transform contract (plan §7.5, AD-12). Written by the M4 prelude (P4) and binding
// for every M4 work package: an implementation may change, a signature here may not (a
// deviation needs a hand-off note and integration approval).
//
// A transform is a **pure function** `(lines, ctx) => TransformResult`. It knows nothing
// about Monaco, the document store or the UI: `app/transforms.ts` (WP4.1) collects the
// scope, asks the options form, runs the preflight, calls `run`, and turns the result
// into one undo step through `monaco/applyLines.ts`. That split is what makes every
// transform testable against `tests/fixtures/transforms/<id>/<case>/`.
//
// **The correctness rules, in order of how much damage breaking one does.** A transform
// that corrupts a program is the worst bug this project can ship: the file looks fine,
// it runs on the machine, and the part is scrap.
//
//  1. **Work on tokens, never on a regex over raw lines.** `tokenizeLine` (WP3.2) knows
//     what is a comment, a string, a variable and an expression in *this* dialect. A
//     naive `/G(\d+)/` rewrites the `G1` inside `(FINISH G1 PASS)` and the `N50` inside
//     `(SEE N50)`. The one exception is a transform whose job *is* the comments
//     (`removeComments`), and it still finds them with the tokenizer.
//  2. **Never touch what the profile says is untouchable.** Packed code (`N10G0X0`),
//     the block-skip mark (`/N100` and `N120/`), macro and Q variables, Klartext
//     continuation lines (a `~` line and its tail are one block), and lathe conventions
//     such as `,R` and `,C` all appear in the fixtures for a reason.
//  3. **Numbers keep their written form.** Go through `formatNumber` (WP3.2): `10.` and
//     `10` are different positions where `decimalPointSignificant` is set, `F.15` keeps
//     its missing leading zero, and rounding is half away from zero so the Python side
//     agrees to the last digit.
//  4. **Return only what changed.** `lineMap` lets `computeLineEdits` build minimal edits,
//     so bookmarks, folds and the cursor on untouched lines survive.
//  5. **The document's encoding, line ending and trailing state are not yours.** A
//     transform sees LF-joined lines and returns LF-joined lines; the trailing empty
//     element that a final newline produces is part of the array and has to come back.
//
// Nothing here throws to report "cannot run": `available()` answers with the reason, which
// the status bar shows. An exception out of `run()` is a bug, and `TransformService`
// turns it into a status error plus a `console.error`.

import type { Located, Msg } from '$lib/app/types';
import type { CodeDb } from '$lib/core/codes/types';
import type { EffectiveMachine } from '$lib/core/machines/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { CompiledProfile } from '$lib/core/profiles/types';

/** Everything a transform may read besides the lines themselves. */
export interface TransformContext {
  /** The active document's profile, patterns already compiled — M6: the **effective** one. */
  cp: CompiledProfile;
  /** The document's effective code database, for what a code *means* (a cycle, a pitch feed, ...). */
  codes: CodeDb;
  /**
   * M6, AD-31: the document's effective machine. A transform that only rewrites text does
   * not need it; one that **computes with values** — compares a feed against a limit,
   * converts a depth — calls `resolveValue`/`writeBack` (§7.15) with it, so it never
   * guesses what a point-less word means on a machine nobody chose.
   */
  machine: EffectiveMachine;
  /** The values of `options()`, already validated by the form. */
  options: Record<string, unknown>;
  /**
   * The document line `lines[0]` came from, 1-based. It is 1 for a whole-document run and
   * the first selected line otherwise, and it is what turns an index inside the transform
   * into a line number a user can click in the results panel.
   */
  firstLine: number;
  /**
   * The whole document, **read only**, with `document[firstLine - 1] === lines[0]`.
   *
   * A selection is a fragment, and a fragment lies about the program around it. Two
   * things a transform cannot work out from `lines` alone, both found by the M4 review:
   *
   *  - a `GOTO 100` above or below the selection still points at a block number inside
   *    it, so a preflight that only scans `lines` renumbers a jump target and says
   *    nothing (`references.ts`);
   *  - a Klartext `~` block that starts above the selection makes its first lines
   *    continuation tails, not block heads, so a renumber writes a block number into a
   *    cycle parameter (`fragment.ts`).
   *
   * `app/transforms.ts` always sets it; a whole-document run passes the very array it
   * passed as `lines`, so nothing is copied. It is optional because a caller that has
   * only a fragment — a unit test, a future headless runner — must still be able to build
   * a context, and because a transform that reads it has to cope with not having it: the
   * two helpers above answer "unknown" rather than guessing, and their callers warn.
   *
   * A transform still only ever *returns* `lines`. This is for deciding and for warning,
   * never for widening what a run rewrites (rule 5).
   */
  document?: readonly string[];
}

/** What a transform produces. `lines` replaces the input range, nothing else. */
export interface TransformResult {
  /** The new lines, LF semantics, same trailing-empty-element convention as the input. */
  lines: string[];
  /**
   * Optional, and worth providing: `lineMap[i]` is the index in `lines` that input line
   * `i` became, or `-1` when it was deleted. With it, `computeLineEdits` produces the
   * deletions plus the changed lines instead of diffing; without it, it falls back to a
   * capped Myers diff. Length is always the number of **input** lines.
   */
  lineMap?: Int32Array;
  /** The one line the status bar shows, e.g. "Renumbered 1204 blocks". */
  summary: Msg;
  /** Lines the transform deliberately left alone, listed in the results panel. */
  skipped: Located[];
  /** Anything the user should know that is not a skip. */
  warnings: Msg[];
}

/**
 * One transform, registered by a `contrib/` file as a command that calls
 * `transforms.run(def)`.
 *
 * `id` is stable and dotted-free (`renumber`, `remove-block-numbers`, `insert-spaces`):
 * it names the fixture folder `tests/fixtures/transforms/<id>/` and the remembered form
 * values, which `uiState` keys as `transform:<id>`.
 */
export interface TransformDef {
  id: string;
  /** An i18n key, not display text (AD-14). */
  title: string;
  /**
   * Whether this transform makes sense for the profile. The `Msg` is the reason, shown
   * in the status bar when the user runs it anyway (`removeBlockNumbers` on a dialect
   * with `blockNumber.mandatory`, `removeSpaces` with `wordSeparatorRequired`).
   */
  available(cp: CompiledProfile): true | Msg;
  /**
   * The options form. Defaults come from the profile (`numbering.start`, `.step`, ...),
   * so a Klartext renumber offers no form at all and a Fanuc one is pre-filled from the
   * dialect. `label` and `help` are display text; a transform that wants translated
   * labels resolves them through `t()` here.
   */
  options?(cp: CompiledProfile): FieldSpec[];
  /**
   * Run before the options are applied, after they are collected. A non-null `Msg` becomes
   * a confirmation dialog — "there are GOTO references to these block numbers; renumbering
   * will not update them. Continue?" — and the user may still say no.
   */
  preflight?(lines: string[], ctx: TransformContext): Msg | null;
  /** Pure. No I/O, no Monaco, no stores. */
  run(lines: string[], ctx: TransformContext): TransformResult;
}
