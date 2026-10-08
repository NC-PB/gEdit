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
//
// ## Numbers or names (M8)
//
// A Fanuc control reads a block number as a number: `N0100` and `N100` are the same
// block, and `GOTO 0100` finds it however it is written. A control whose sequence numbers
// are **names** (`syntax.sequenceNames`, Okuma) compares them as the text they are
// written in, so `N0100` and `N100` are two different blocks and `GOTO N0100` finds only
// the first (syntax-okuma.md §3.1). [`BlockKey`] is how a block is told apart on each kind
// of control, and everything that looks a target up — the index of a program, the
// question "is this number still unique after the run" — looks it up by that key.
// Resolving an Okuma jump by its value sent `IF [V1 EQ 5] N0020` to a block `N20` it never
// named, and renumbering then wrote a jump to a block that no longer existed (G10 M8).

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { documentOf } from './fragment';
import type { Msg } from '$lib/app/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

/** Digits a block number may have before this module refuses to read it as one. */
export const MAX_TARGET_DIGITS = 9;

/**
 * What tells two blocks apart: the number (`100` for both `N100` and `N0100`) on a control
 * that reads block numbers as numbers, the digits as written (`'0100'`) on one whose
 * sequence numbers are names. A program is indexed by one kind only, so a number and a
 * string never meet in the same map.
 */
export type BlockKey = number | string;

/**
 * True when the dialect compares its sequence numbers as text (`syntax.sequenceNames`,
 * Okuma: `N0123` and `N123` are two names). Every other dialect compares them as numbers.
 */
export function comparesByText(cp: CompiledProfile): boolean {
  return cp.profile.syntax?.sequenceNames === true;
}

/**
 * The key of a block number or a reference value, or null when the text is not one.
 *
 * `text` is the digits without the address. On a dialect that compares by text the key
 * is that text exactly, zero padding included; elsewhere it is the number it spells.
 */
export function blockKeyOf(text: string, byText: boolean): BlockKey | null {
  const target = targetOf(text);
  if (target === null) return null;
  return byText ? text : target;
}

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
  /**
   * The block it names as the dialect tells blocks apart ([`BlockKey`]): `target` itself,
   * or the digits exactly as written where sequence numbers are names. Null exactly when
   * `target` is.
   */
  key: BlockKey | null;
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

/** A name a jump can go to (`LOOP_A`), as the tokenizer leaves it when it reads no more into it. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The jump labels a file defines (Sinumerik `LOOP_A:`), upper case, as the tokenizer reads
 * them. Only lines with a colon can hold one, so only those are tokenized; a jump to a name
 * in this set is a jump to a label and names no block number (review NC-3).
 */
export function labelsOf(lines: readonly string[], cp: CompiledProfile): Set<string> {
  const labels = new Set<string>();
  for (const line of lines) {
    if (!line.includes(':')) continue;
    for (const token of tokenizeLine(line, cp).tokens) {
      if (token.kind === 'label' && token.address !== undefined) labels.add(token.address.toUpperCase());
      // M12.5 (`syntax.labelAfter`): a label behind a jump names its target and defines
      // nothing; only the head of a block (number, skip marks, blanks) can define one.
      if (token.kind !== 'whitespace' && token.kind !== 'blockNumber' && token.kind !== 'skip') break;
    }
  }
  return labels;
}

/**
 * True when `keyword` is one of the profile's `syntax.labelAfter` jumps (M12.5): the name
 * behind it is a `label` token, which may still be a `STRING` variable rather than a label
 * of this file, so it is judged as the `unknown` name it used to be.
 */
function jumpsToLabel(cp: CompiledProfile, keyword: string): boolean {
  const list = cp.profile.syntax?.labelAfter;
  return Array.isArray(list) && list.some((entry) => typeof entry === 'string' && entry.trim().toUpperCase() === keyword.toUpperCase());
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
 *
 * A jump keyword followed by a string or by a name is a computed reference (`target`
 * null): Sinumerik `GOTOF "N"<<R10` builds its target, and `GOTOF DEST` jumps to what a
 * `STRING` variable holds (review NC-3). A name in `labels` (the file's own `NAME:`
 * labels, [`labelsOf`]) is a jump to that label and no reference at all; without
 * `labels` every name counts as computed, which reports rather than hides.
 */
export function referencesOn(
  tokens: NcToken[],
  line: string,
  cp: CompiledProfile,
  addresses: Set<string>,
  labels?: ReadonlySet<string>,
): ReferenceWord[] {
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
    if (next === undefined) continue;
    const computed =
      next.kind === 'variable' ||
      next.kind === 'expression' ||
      (token.kind === 'keyword' && next.kind === 'string') ||
      (token.kind === 'keyword' &&
        (next.kind === 'unknown' || (next.kind === 'label' && jumpsToLabel(cp, token.address))) &&
        IDENTIFIER.test(next.text) &&
        !labels?.has(next.text.toUpperCase()));
    if (!computed) continue;
    (carried ??= []).push({ address: token.address, start: next.start, end: next.end, text: next.text });
  }
  if (carried === null) return [];

  const masked = maskedOf(line, tokens);
  const byText = comparesByText(cp);
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
    found.push({
      address,
      start,
      end,
      text,
      target: targetOf(text),
      key: blockKeyOf(text, byText),
      rewrite,
      ambiguous: twice.has(address),
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Main blocks (M9 WP9.5b; moved here from `renumber.ts` for review NC-3)
// ---------------------------------------------------------------------------
//
// A Sinumerik program has two kinds of block number: `N20` numbers a block, `:20` numbers
// a **main block** (`syntax.blockNumber.mainPrefix`, §7.1, §7.16 #50). A jump names a main
// block by its own prefix (`GOTOF :20`), which the tokenizer reads as an operator and a
// word of no address, so [`referencesOn`] never sees it. [`mainReferencesOn`] does, under
// the reference rules that name ordinary blocks (`numbering.references` with the block
// prefix among the addresses), with keys of their own ([`mainKeyOf`]). Renumber and Remove
// Block Numbers read it through `withMainBlocks`, review mode through `keptNumbers`.

/** `syntax.blockNumber.mainPrefix` (Sinumerik `:`), or null where the dialect has no main blocks. */
export function mainPrefixOf(cp: CompiledProfile): string | null {
  const blockNumber = cp.profile.syntax.blockNumber;
  if (blockNumber.mode === 'leading-integer') return null;
  const main = blockNumber.mainPrefix;
  return typeof main === 'string' && main !== '' ? main : null;
}

/** The key of a main block (`':20'`): the prefix in front of the key its number would have. */
export function mainKeyOf(main: string, digits: string, byText: boolean): BlockKey {
  return main + (byText ? digits : String(Number(digits)));
}

/**
 * Every `<main prefix><number>` behind the head of the block: `GOTOF :20` gives the `20`.
 *
 * Written without the blank, `GOTOB:20` is not an operator and a word: the tokenizer reads
 * a name and a colon at the start of a block as a jump **label** (`GOTOB:`) and the digits
 * behind it as a word of no address. A label whose name is a jump (`isJump`, the reference
 * rules' own triggers) cannot be a label, so its colon is the main prefix and the digits
 * name a main block, exactly as with the blank (M9 NC review F2: renumbering moved `:20`
 * and left `GOTOB:20` pointing at nothing, and Remove Block Numbers dropped the `:20`).
 */
function mainJumpsOn(tokens: NcToken[], main: string, isJump: (name: string) => boolean): NcToken[] {
  const out: NcToken[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    const mark = tokens[i];
    if (mark.kind === 'operator') {
      if (mark.text !== main) continue;
    } else if (mark.kind === 'label') {
      const name = mark.address ?? '';
      if (name === '' || mark.text !== name + main || !isJump(name)) continue;
    } else continue;
    const value = tokens[i + 1];
    if (value.kind !== 'word' || value.address !== undefined || value.valueText === undefined) continue;
    if (value.start !== mark.end) continue;
    out.push(value);
  }
  return out;
}

/** The reference rules that name ordinary blocks, which are the ones that name main blocks. */
interface MainRules {
  main: string;
  rules: { trigger: RegExp; rewrite: boolean }[];
}

const MAIN_RULES = new WeakMap<CompiledProfile, MainRules | null>();

function mainRulesOf(cp: CompiledProfile): MainRules | null {
  const cached = MAIN_RULES.get(cp);
  if (cached !== undefined) return cached;
  const main = mainPrefixOf(cp);
  let result: MainRules | null = null;
  if (main !== null) {
    const blockPrefix = cp.profile.syntax.blockNumber.prefix ?? 'N';
    const rules: MainRules['rules'] = [];
    cp.re.references.forEach((rule, index) => {
      if (!rule.addresses.includes(blockPrefix)) return;
      rules.push({ trigger: rule.trigger, rewrite: ruleRewrites(cp, index) });
    });
    if (rules.length > 0) result = { main, rules };
  }
  MAIN_RULES.set(cp, result);
  return result;
}

/**
 * The main-block jumps on this line (`GOTOF :20`, `GOTOB:20`) as reference words: address
 * the main prefix, key [`mainKeyOf`]. Empty on a dialect without main blocks or a line
 * without the prefix.
 */
export function mainReferencesOn(tokens: NcToken[], line: string, cp: CompiledProfile): ReferenceWord[] {
  const found = mainRulesOf(cp);
  if (found === null || !line.includes(found.main)) return [];
  const { main, rules } = found;
  const jumps = mainJumpsOn(tokens, main, (name) => rules.some((rule) => rule.trigger.test(name)));
  if (jumps.length === 0) return [];
  const masked = maskedOf(line, tokens);
  let fired = false;
  let rewrite = true;
  for (const rule of rules) {
    if (!rule.trigger.test(masked)) continue;
    fired = true;
    if (!rule.rewrite) rewrite = false;
  }
  if (!fired) return [];
  const byText = comparesByText(cp);
  return jumps.map((value) => {
    const text = value.valueText ?? '';
    const target = targetOf(text);
    return {
      address: main,
      start: value.end - text.length,
      end: value.end,
      text,
      target,
      key: target === null ? null : mainKeyOf(main, text, byText),
      rewrite,
      // Two of them on one line: which one the rule is about cannot be told (G8 M6).
      ambiguous: jumps.length > 1,
    };
  });
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
   * True when the dialect tells its blocks apart by the text of the sequence number
   * ([`comparesByText`]), so every key below is a string; numbers otherwise.
   */
  byText: boolean;
  /**
   * The key of the block number each row carries ([`BlockKey`]), or null. The same
   * information as `segments` read the other way round, and the only way to ask what the
   * numbering looks like **after** a run that rewrites it: a renumber that wraps hands
   * numbers out twice, and a reference must not be rewritten with a value that is no longer
   * unique (G8 M6).
   */
  keys: (BlockKey | null)[];
  /** Per program: block key → where it stands. */
  segments: Map<BlockKey, NumberSite>[];
}

const NO_SCAN: ProgramScan = {
  scanned: [],
  firstLine: 1,
  unchecked: false,
  found: [],
  count: 0,
  first: 0,
  segmentOf: new Int32Array(0),
  byText: false,
  keys: [],
  segments: [],
};

/** The key of the block number a line carries, or null; read from the tokens, never from the text. */
function blockKeyOfTokens(tokens: NcToken[], byText: boolean): BlockKey | null {
  for (const token of tokens) {
    if (token.kind !== 'blockNumber') continue;
    return token.valueText === undefined ? null : blockKeyOf(token.valueText, byText);
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
 *
 * Blocks are indexed by their [`BlockKey`], so on a dialect whose sequence numbers are
 * names `N0100` and `N100` are two entries, and a jump to one never finds the other.
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
  const labels = labelsOf(scanned, cp);
  const byText = comparesByText(cp);
  const segmentOf = new Int32Array(scanned.length);
  const keys: (BlockKey | null)[] = new Array<BlockKey | null>(scanned.length).fill(null);
  const segments: Map<BlockKey, NumberSite>[] = [new Map()];
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

    const key = blockKeyOfTokens(tokens, byText);
    if (key !== null) {
      keys[row] = key;
      const site = segments[segment].get(key);
      if (site === undefined) segments[segment].set(key, { count: 1, row, lastRow: row });
      else {
        site.count++;
        site.lastRow = row;
      }
    }

    const words = referencesOn(tokens, line, cp, addresses, labels);
    if (words.length === 0) continue;
    for (const word of words) found.push({ row, word });
    count++;
    if (first === 0) first = firstLine + row;
  }

  return { scanned, firstLine, unchecked, found, count, first, segmentOf, byText, keys, segments };
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
