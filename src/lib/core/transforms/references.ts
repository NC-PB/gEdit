// Block-number references: who points at a block number, which block that is, and what a
// transform that rewrites or removes block numbers owes them (plan §7.1
// `numbering.references`, §5 WP6.3, syntax-fanuc §7). Owner: **WP6.3** (was WP4.2).
//
// `GOTO 100`, `M98 Q100`, `M99 P100` and the lathe pair `G71 P100 Q200` / `G70 P100 Q200`
// all name a block by its number. Phase 1 only warned about them; M6 rewrites the ones it
// can prove and reports the rest, so this module now answers three questions instead of
// one:
//
//   1. **Which words on this line are block numbers?** [`referencesOn`] — the address and
//      the exact span of the value, so a caller replaces the value and nothing else.
//   2. **Which block does a number name?** [`scanProgram`] indexes every block number of
//      the program **per program**, because `GOTO 100` means the `N100` of the program it
//      stands in and nothing else. A number that occurs twice in one program is not an
//      answer, it is an ambiguity, and the caller reports it instead of guessing.
//   3. **May this reference be rewritten at all?** `numbering.references[].rewrite`
//      (§7.1). Fanuc's `M99 P` returns to a block of the **caller** (F42), which a
//      renumber of this file cannot see: rewriting it with a number out of this program
//      would send the return somewhere else. Such a rule is `rewrite: false` and the
//      value is reported, never touched.
//
// ## Two halves, and both are needed
//
// A rule fires only when the **trigger** matches the comment-masked line *and* the line
// carries a word with one of the rule's **addresses**. `M99` on its own returns to the
// caller and points at nothing; `P` on its own is a subprogram number, a dwell or a peck.
// Requiring both is what keeps `M98 P1010` — a program number — out of this.
//
// The weakness of that design is the line: a rule fires on the whole of it and cannot
// say **which** word it meant, so a block that carries the same address twice has no
// answer at all. Such a block is [`ReferenceWord.ambiguous`], and every caller reports
// both words and rewrites neither (G8 M6).
//
// ## Why the scan is not the scope
//
// A selection that holds `N100` but not the `GOTO 100` above it used to come back with no
// references and no warning at all, and the renumber rewrote the target in silence (G8
// M4). References are a property of the **document**, not of the lines a run happens to
// cover, so [`scanProgram`] reads `ctx.document` whenever the context carries one and
// reports honestly when it does not.
//
// ## What is never rewritten
//
// A value that is not a plain unsigned integer — `GOTO #100`, `GOTO [#1+1]`, `P100.` —
// has no block number in it that this module is willing to name. `target` is `null` and
// every caller reports rather than guesses (the standing rule of §5 M6: refuse, do not
// guess). The same goes for a value longer than [`MAX_TARGET_DIGITS`], which no control
// takes as a block number and which JavaScript can no longer hold exactly.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { documentOf } from './fragment';
import type { Msg } from '$lib/app/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

/** Digits a block number may have before this module refuses to read it as one. */
export const MAX_TARGET_DIGITS = 9;

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
 * Whether rule `index` allows its values to be rewritten (§7.1; the default is true).
 *
 * `CompiledProfile.re.references` carries the trigger and the addresses only, and the
 * compiler maps the profile's rules one for one in order (`compile.ts`), so the flag is
 * read from the profile at the same index. Compiling it in would be a change to a
 * contract this work package does not own.
 */
function ruleRewrites(cp: CompiledProfile, index: number): boolean {
  return cp.profile.numbering?.references?.[index]?.rewrite !== false;
}

/** One word whose value is a block number. */
export interface ReferenceWord {
  /** `'P'`, `'Q'`, `'GOTO'`. */
  address: string;
  /** Offset of the value inside the line; the address is in front of it. */
  start: number;
  /** Offset one past the value. */
  end: number;
  /** The value exactly as it is written, zero padding included (`'0100'`). */
  text: string;
  /** The block number it names, or null when the value is not a plain block number. */
  target: number | null;
  /** False when a rule that fires on this word says `rewrite: false` (`M99 P`, F42). */
  rewrite: boolean;
  /**
   * True when the block carries more than one word with this address, so which of them
   * the rule is about cannot be told from the line (G8 M6).
   *
   * A rule fires on the whole line, not on a span of it, so `G83 … Q3000 F0.1 M98 Q3000`
   * used to hand both `Q` words to the `M98 Q` rule and the peck depth was rewritten as a
   * block number. A control rejects a block with two words of one address and no post
   * writes one, so this is a guard and not an everyday case — but the rule of this module
   * is refuse, do not guess, and a silent rewrite is the one answer it must not give.
   */
  ambiguous: boolean;
}

/** The block number in `text`, or null when it is not one this module will name. */
function targetOf(text: string): number | null {
  if (text.length === 0 || text.length > MAX_TARGET_DIGITS) return null;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x30 || code > 0x39) return null;
  }
  return Number(text);
}

/**
 * Every word on this line whose value is a block number.
 *
 * A word is one when a rule fires: the trigger matches the comment-masked line and the
 * rule lists the word's address. Several rules may fire on one line; a word that any of
 * them marks `rewrite: false` keeps the safer answer, because one rule saying "this may
 * point outside the program" is enough not to touch it.
 *
 * A word without a value is not a reference: a bare `GOTO` at the end of a line names no
 * block, and there is nothing to rewrite.
 */
export function referencesOn(tokens: NcToken[], line: string, cp: CompiledProfile, addresses: Set<string>): ReferenceWord[] {
  let carried: { address: string; start: number; end: number; text: string }[] | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'word' && token.kind !== 'keyword') continue;
    if (token.address === undefined || !addresses.has(token.address)) continue;
    if (token.valueText !== undefined && token.valueText !== '') {
      // `valueText` is the tail of the token, so the value starts that many characters
      // before its end even where the dialect allows a space behind the address (`P 100`).
      const text = token.valueText;
      (carried ??= []).push({ address: token.address, start: token.end - text.length, end: token.end, text });
      continue;
    }
    // A keyword takes a number with it (`GOTO100`, `GOTO 100`) but never a variable or a
    // bracket expression, which the tokenizer reads as tokens of their own. `GOTO #100`
    // and `GOTO [#1+1]` are references all the same — computed ones, which a renumber
    // can neither follow nor leave working, so they have to be reported rather than
    // overlooked.
    const next = tokens[i + 1]?.kind === 'whitespace' ? tokens[i + 2] : tokens[i + 1];
    if (next === undefined || (next.kind !== 'variable' && next.kind !== 'expression')) continue;
    (carried ??= []).push({ address: token.address, start: next.start, end: next.end, text: next.text });
  }
  if (carried === null) return [];

  const masked = maskedOf(line, tokens);
  // Which addresses this block carries more than once: a rule fires on the line, so it
  // cannot say which of two `Q` words it means (see `ReferenceWord.ambiguous`).
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { address } of carried) {
    if (seen.has(address)) twice.add(address);
    else seen.add(address);
  }
  const found: ReferenceWord[] = [];
  for (const { address, start, end, text } of carried) {
    let fired = false;
    let rewrite = true;
    for (let i = 0; i < cp.re.references.length; i++) {
      const rule = cp.re.references[i];
      if (!rule.addresses.includes(address)) continue;
      if (!rule.trigger.test(masked)) continue;
      fired = true;
      if (!ruleRewrites(cp, i)) rewrite = false;
    }
    if (!fired) continue;
    found.push({ address, start, end, text, target: targetOf(text), rewrite, ambiguous: twice.has(address) });
  }
  return found;
}

/** Where a block number stands, and how often that number occurs in its program. */
export interface NumberSite {
  count: number;
  /** The row of the first block that carries it, in the scanned array. */
  row: number;
  /** The row of the last one; the same as `row` while `count` is 1. */
  lastRow: number;
}

/** One reference, and the row of the scanned array it stands on. */
export interface FoundReference {
  row: number;
  word: ReferenceWord;
}

/**
 * What a walk of the program found: its references and its block numbers.
 *
 * `scanned` is the document when the context carries one and the run's own lines when it
 * does not, and `firstLine` is the document line `scanned[0]` came from, so a caller
 * turns a row into a line a user can click.
 */
export interface ProgramScan {
  scanned: readonly string[];
  firstLine: number;
  /**
   * True when the walk could only look at the run's own lines, so a pointer above or
   * below the selection was not examined. The caller warns; it never reports "none".
   */
  unchecked: boolean;
  found: FoundReference[];
  /** How many lines carry at least one reference. */
  count: number;
  /** The first such line as a document line number; 0 when there is none. */
  first: number;
  /** The program each row belongs to: `segments[segmentOf[row]]`. */
  segmentOf: Int32Array;
  /**
   * The block number each row carries, or -1. The same information as `segments` read the
   * other way round, and the only way to ask what the numbering looks like **after** a run
   * that rewrites it: a renumber that wraps hands numbers out twice, and a reference must
   * not be rewritten with a value that is no longer unique (G8 M6).
   *
   * A block number has at most [`MAX_TARGET_DIGITS`] digits, which fits an `Int32Array`.
   */
  numbers: Int32Array;
  /** Per program: block number → where it stands. */
  segments: Map<number, NumberSite>[];
}

const NO_SCAN: ProgramScan = {
  scanned: [],
  firstLine: 1,
  unchecked: false,
  found: [],
  count: 0,
  first: 0,
  segmentOf: new Int32Array(0),
  numbers: new Int32Array(0),
  segments: [],
};

/** The block number a line carries, or null; read from the tokens, never from the text. */
function blockNumberOfTokens(tokens: NcToken[]): number | null {
  for (const token of tokens) {
    if (token.kind !== 'blockNumber') continue;
    return token.valueText === undefined ? null : targetOf(token.valueText);
  }
  return null;
}

/**
 * Walks the program: every reference, and every block number indexed per program.
 *
 * The index is **per program**, not per file, whatever `restartAtProgramStart` says. A
 * block-number reference never leaves its own program — `GOTO`, `M98 Q` and the turning
 * cycles all name a block of the program they stand in — so a file that holds a main
 * program and a subprogram, each with its own `N100`, has two unambiguous answers and not
 * one ambiguous one. (`M99 P` is the exception that proves it: it names a block of the
 * *caller*, which is why its rule is `rewrite: false` and nothing here tries to resolve
 * it.)
 */
export function scanProgram(lines: readonly string[], ctx: TransformContext): ProgramScan {
  if (ctx.cp.re.references.length === 0) return NO_SCAN;

  const cp = ctx.cp;
  const document = documentOf(ctx, lines);
  const scanned = document ?? lines;
  // The document is read from its own line 1; a bare fragment starts where the scope does.
  const firstLine = document !== null ? 1 : Math.max(1, Math.trunc(ctx.firstLine));
  // Without a document, a run that starts at line 1 is the whole program as far as anyone
  // here can tell; one that starts below it is knowingly looking at a fragment.
  const unchecked = document === null && ctx.firstLine > 1;

  const addresses = referenceAddresses(cp);
  const segmentOf = new Int32Array(scanned.length);
  const numbers = new Int32Array(scanned.length).fill(-1);
  const segments: Map<number, NumberSite>[] = [new Map()];
  const found: FoundReference[] = [];
  let segment = 0;
  let count = 0;
  let first = 0;
  let state: LineState | undefined;

  for (let row = 0; row < scanned.length; row++) {
    const line = scanned[row];
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;

    if (cp.re.programStart.length > 0 && row > 0) {
      const masked = maskedOf(line, tokens);
      if (cp.re.programStart.some((re) => re.test(masked))) {
        segment = segments.length;
        segments.push(new Map());
      }
    }
    segmentOf[row] = segment;

    const number = blockNumberOfTokens(tokens);
    if (number !== null) {
      numbers[row] = number;
      const site = segments[segment].get(number);
      if (site === undefined) segments[segment].set(number, { count: 1, row, lastRow: row });
      else {
        site.count++;
        site.lastRow = row;
      }
    }

    const words = referencesOn(tokens, line, cp, addresses);
    if (words.length === 0) continue;
    for (const word of words) found.push({ row, word });
    count++;
    if (first === 0) first = firstLine + row;
  }

  return { scanned, firstLine, unchecked, found, count, first, segmentOf, numbers, segments };
}

/**
 * The confirmation a scan asks for, or null when there is nothing to confirm.
 *
 * `keys.references` is used when there are pointers to ask about, `keys.unchecked` when
 * the run could not look outside the selection. A run that is both gets the first, which
 * is the more concrete of the two.
 */
export function referencePreflight(
  trouble: { count: number; first: number; unchecked: boolean },
  keys: { references: string; unchecked: string },
): Msg | null {
  if (trouble.count > 0) return { key: keys.references, params: { count: trouble.count, first: trouble.first } };
  if (trouble.unchecked) return { key: keys.unchecked };
  return null;
}
