// Compare contracts (plan §7.7, AD-26). Written by the M11 prelude (P11); binding.
// WP11.2 implements `index.ts`; WP11.3 builds the review mode, the merge and the export on
// it. A signature here changes only with a numbered §7.16 entry.
//
// Review mode normalizes both sides of a comparison **line by line** and diffs the
// normalized text. The one rule every option obeys: **review mode never hides a difference
// the machine would see.** An option may only make two lines equal when the control reads
// them alike; where that is not certain, the lines stay apart and the user sees the
// difference. Showing a difference that is not one costs a glance; hiding one costs a part.
//
// What each option does (the details are WP11.2's, inside these limits):
//
//  - `ignoreBlockNumbers` — the block number goes (`N10`, Sinumerik `:10`, the leading
//    Klartext number). **Kept**: a number that a reference of the profile's
//    `numbering.references` in the same file points at (`GOTO 100`, `G70 P100 Q200`), and
//    every block number of a file with a reference whose target is not a literal
//    (`GOTO #1`, Sinumerik `GOTOF DEST` without a `DEST:` label, `GOTOF "N"<<R10`) — the
//    review bar says so (`Normalized.notes`). A Sinumerik main block `:200` is kept for a
//    `GOTOF :200`. Labels (Okuma sequence
//    names, Sinumerik `LOOP_A:`, Klartext `LBL`) are names, not numbers, and are never
//    dropped.
//  - `ignoreWhitespace` — leading and trailing blanks go and every run of blanks outside a
//    string becomes one blank; a blank line disappears. A blank **between** two words is
//    never removed and never inserted (`G1X10` ≠ `G1 X10`): on Sinumerik and Okuma two
//    words written together can turn into one name (`N30XNOW=62`), and Klartext requires
//    the separator. Text inside a string is never touched.
//  - `ignoreComments` — every comment goes, and a line that held nothing else disappears;
//    a Klartext `~` behind a comment stays. **Kept**: the comments of a line that matches
//    one of the profile's `compare.keepComments` patterns — a comment the control reads
//    (the Fanuc program title, an alarm or stop message, a `%` that ends the program on
//    input; the Sinumerik `;$PATH=` header and cycle-screen markers).
//  - `ignoreCase` — letters outside strings compare without case. Strings keep theirs
//    (Sinumerik tool names are case-sensitive). Only safe where the control does not tell
//    case apart, which is why it is off by default on every dialect but Sinumerik.
//  - `ignoreNumberFormat` — a numeric value is written in one canonical form: no `+`, no
//    leading zeros, no trailing zeros after the point, the decimal comma read as a point.
//    The decimal point itself survives (`X10.` vs `X10`) wherever **any reading that
//    applies** is an increment reading (`pointSignificant`, AD-26): with the document's
//    machine that is the machine's number input; with no machine it is every preset the
//    profile declares. A comparison may hand both sides one answer (`NormalizeOverrides`,
//    the stricter of the two; review NC-6). The point is kept whatever the machine on an
//    address that is not a value address of the profile (a dwell `P`, a cycle `Q`, `H`,
//    `D`: they take no point under calculator input either; review NC-2). Code words lose
//    leading zeros only (`G01` → `G1`, `G84.2` as written). Never reformatted: the tool word on a turning profile (its digits are a
//    tool and an offset counted by position: `T001` is not `T1`; D49), block numbers kept
//    by the rule above (on a `sequenceNames` dialect `N0123` and `N123` are two names),
//    program numbers and names, labels, variables' names (`#101`, `R1`, `Q1`, `V1`),
//    strings and comments.
//
// There is no numeric tolerance (§2.1, D41): a carried `compare.tolerance` is ignored.
//
// Not ignored, by decision (P11; §8.11): the Klartext cycle name after `CYCL DEF <n>` and
// the label words of the old numbered cycles. They are dialog-language text, not
// comments, and whether a control ignores them on import is open (§10.2 M11-1). A
// re-post in another dialog language therefore shows every cycle header as changed; the
// `;` labels of the parameter lines are comments and go with `ignoreComments`.

import type { LineState } from '$lib/core/nc/types';
import type { EffectiveMachine } from '$lib/core/machines/types';
import type { Msg } from '$lib/app/types';
import type { BlockKey } from '$lib/core/transforms/references';

/** The five review-mode toggles (§7.7). Each one is a button in the compare toolbar. */
export interface CompareOptions {
  ignoreBlockNumbers: boolean;
  ignoreWhitespace: boolean;
  ignoreComments: boolean;
  ignoreCase: boolean;
  ignoreNumberFormat: boolean;
}

/** The toggles in toolbar order; the `data-option` values of `compare-option` (§7.12). */
export const COMPARE_OPTION_KEYS = [
  'ignoreBlockNumbers',
  'ignoreWhitespace',
  'ignoreComments',
  'ignoreCase',
  'ignoreNumberFormat',
] as const satisfies readonly (keyof CompareOptions)[];

/**
 * What `compareDefaults` answers for a profile that writes no `compare` block, or leaves
 * a toggle out: the three options that are safe on every dialect by construction are on,
 * the two that depend on what the control reads are off.
 */
export const COMPARE_FALLBACK: Readonly<CompareOptions> = Object.freeze({
  ignoreBlockNumbers: true,
  ignoreWhitespace: true,
  ignoreComments: false,
  ignoreCase: false,
  ignoreNumberFormat: true,
});

/**
 * `profile.compare` as a profile file writes it (§7.1). Every toggle is optional (the
 * fallback above fills the gaps), and so is `keepComments`.
 *
 * `tolerance` was carried by the Phase 1 data and is **ignored**, not refused (§2.1): the
 * validator accepts any value there and nothing reads it.
 */
export interface ProfileCompare extends Partial<CompareOptions> {
  /**
   * P11 (§7.16 #134). Patterns (§7.4 subset, the profile's case rule) tested against the
   * line as written. A line that matches one keeps its comments under `ignoreComments`:
   * the control reads them. Inherited through `extends` like every array (replaced
   * whole).
   */
  keepComments?: string[];
  /** Ignored (§2.1, D41). */
  tolerance?: unknown;
}

/** One side of a comparison after normalization. */
export interface Normalized {
  /** The normalized lines joined with LF; no trailing LF after the last line. */
  text: string;
  /** `lineMap[i]` = the original **1-based** line that normalized line `i` came from. */
  lineMap: Int32Array;
  /**
   * P11 (§7.16 #135). What the review bar has to say about this side, already decided:
   * "block numbers kept: a jump with a computed target", "read with no machine: a point
   * is significant under one of the presets". Empty when there is nothing to say.
   */
  notes: Msg[];
}

/**
 * What one file's normalization needs beyond the options, worked out once per side by
 * `prepareNormalize` and then handed to every `normalizeLine` call.
 */
export interface NormalizeContext {
  /** True when `X10` and `X10.` can be read apart (see the header, `ignoreNumberFormat`). */
  pointSignificant: boolean;
  /** The block numbers `ignoreBlockNumbers` keeps: every one, or these keys. */
  keepBlockNumbers: 'all' | ReadonlySet<BlockKey>;
  /** `profile.compare.keepComments`, compiled with the profile's flags. */
  keepComments: readonly RegExp[];
}

/**
 * §7.16 #144 (M11 review NC-6). What a comparison decides for both sides at once and hands
 * to `normalizeLines` / `prepareNormalize`: `pointSignificant` replaces the side's own
 * answer, so both sides are written by one decimal-point rule (the stricter of the two).
 * Absent members keep the side's own answer.
 */
export interface NormalizeOverrides {
  pointSignificant?: boolean;
}

/** One line after normalization: `text` null = the line disappears (comment-only, blank). */
export interface NormalizedLine {
  text: string | null;
  /** The tokenizer state for the next line (Klartext `~` continuations). */
  state: LineState;
}

/** The effective machine of a side, or none (every declared preset applies, AD-31). */
export type SideMachine = EffectiveMachine | null | undefined;

// ---------------------------------------------------------------------------
// The saved compare options (WP11.3; §7.11, §7.16 #137)
// ---------------------------------------------------------------------------

/**
 * The `ui.lastParams` key the compare toolbar's state is saved under in `state.json`. It is
 * the P1 per-form memory (`uiState.getLastParams` / `setLastParams`), which already
 * persists with a 1 s debounce and is flushed on quit; no settings key and no store change.
 */
export const COMPARE_MEMO_KEY = 'compare';

/**
 * What is saved under `COMPARE_MEMO_KEY`. A hand-edited or outdated record is read member
 * by member and anything that is not the declared type is dropped (WP11.3's
 * `compareMemoOf`), so a bad file can only bring the defaults back.
 */
export interface CompareMemo {
  /** The mode the next comparison opens in. Absent: `raw` (the Phase 1 behaviour). */
  mode?: 'raw' | 'review';
  /** The raw-mode view options of the P1 toolbar. */
  inline?: boolean;
  ignoreTrimWhitespace?: boolean;
  /**
   * Per profile id, only the toggles the user changed away from that profile's defaults,
   * so a later change of a built-in default still reaches every toggle the user never
   * touched. "Profile defaults" in the toolbar deletes the profile's entry.
   */
  review?: Record<string, Partial<CompareOptions>>;
}
