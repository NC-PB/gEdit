// Typing options: the decisions behind `editing.forceUppercase` and `editing.preventLineJoin`
// (plan AD-30, §6 M13 WP13.4, §7.16 #193). Pure functions, no Monaco and no stores, so the
// rules can be tested without an editor; `contrib/typing.ts` reads the keyboard and the
// editor, asks these, and acts on the answer.
//
// Upper case. A plain lower-case letter key becomes its capital, unless the character lands
// in a token the control keeps as written: `comment`, `string` or `text` (Klartext program
// and cycle names, `FN 16` paths; Sinumerik `MSG("…")`, `T="name"`), or a program name in
// place of a number (Fanuc `<name>`, `syntax.programNames`; owner, 2026-10-09). The question is asked of
// the tokenizer on the line **as it reads with the character typed**, so a comment or string
// opened earlier on the line counts, and so does one the character itself continues. One
// previous line is tokenized for the one bit of state the tokenizer carries (a Klartext line
// that ends with `~`; it depends on that line alone).
//
// Line joins. Backspace in column 1 and Delete at the end of a line join two blocks, which
// on a control is a different program. Both are refused for an empty selection and give a
// hint, with or without a word-delete chord (Ctrl, Alt, Cmd); a selection that contains a line
// break is deleted as usual.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { tokenizeLine } from './tokenizer';
import type { TokenKind } from './types';

/** The token kinds whose text is never upper-cased (AD-30). */
export const KEPT_KINDS: ReadonlySet<TokenKind> = new Set<TokenKind>(['comment', 'string', 'text']);

/** The parts of a keyboard event the decisions read (a DOM `KeyboardEvent` has all of them). */
export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** A composition (IME) is running. */
  isComposing?: boolean;
  /** 229 is what browsers report for a key that goes to an IME. */
  keyCode?: number;
}

function isModified(k: KeyInput): boolean {
  return k.ctrlKey === true || k.altKey === true || k.metaKey === true;
}

function isComposing(k: KeyInput, composing: boolean): boolean {
  return composing || k.isComposing === true || k.keyCode === 229 || k.key === 'Process';
}

/**
 * The capital that a plain lower-case letter key would type, or `null` when the key is
 * anything else: a modifier chord (Ctrl, Alt, Cmd; AltGr arrives as Ctrl+Alt), a key that
 * goes to an IME, a dead key, a named key (`Enter`), a digit or symbol, an upper-case letter,
 * and a letter whose capital is not one character (`ß`).
 */
export function uppercaseOf(k: KeyInput, composing = false): string | null {
  if (isModified(k) || isComposing(k, composing)) return null;
  const key = k.key;
  // One UTF-16 unit: named keys are longer, and a character outside the BMP is not a letter
  // of any NC program.
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  if (upper === key || upper.length !== 1) return null;
  return upper;
}

/**
 * Where one cursor (or selection) will insert: the text of its line before and after the
 * selection (the selection itself is replaced by the typed character, so a selection that
 * spans lines contributes the start line's head and the end line's tail), and the line
 * above, for the tokenizer's continuation state; `null` on the first line.
 */
export interface TypingSite {
  before: string;
  after: string;
  previousLine: string | null;
}

/**
 * True when `ch`, typed at `site`, would be part of a comment, a string or kept text, so its
 * case stays as typed. The tokenizer reads `before + ch + after`; a `ch` that no token covers
 * (it cannot happen: whitespace is a token too) counts as code.
 */
export function keepsCase(site: TypingSite, ch: string, cp: CompiledProfile): boolean {
  const line = site.before + ch + site.after;
  const prev = site.previousLine === null ? undefined : tokenizeLine(site.previousLine, cp).state;
  const at = site.before.length;
  const kept = keptAt(line, at, cp, prev);
  if (kept) return true;
  // A program name typed left to right is not closed yet (`M98 <sub_a`); it is one as soon as
  // its closing character follows, so the letter is read as if that were typed behind it.
  const closer = programNameCloser(cp);
  return closer !== null && keptAt(site.before + ch + closer + site.after, at, cp, prev);
}

/** Is the character at `at` of `line` in a token whose case the control keeps? */
function keptAt(line: string, at: number, cp: CompiledProfile, prev: ReturnType<typeof tokenizeLine>['state'] | undefined): boolean {
  for (const token of tokenizeLine(line, cp, prev).tokens) {
    if (token.start > at) break;
    if (token.end > at) {
      return KEPT_KINDS.has(token.kind) || inQuotes(line, token.start, at, cp) || isProgramName(token.text, cp);
    }
  }
  return false;
}

/**
 * Owner decision of 2026-10-09 (M13 review NC-7): a program **name** in place of a number
 * (`syntax.programNames`, the Fanuc `<shaft_t12>` of a 30i-type control) keeps its case as
 * typed, like a Klartext program name. Only a `programMarker` that is such a name: the
 * Okuma `$NAME.MIN%` and Sinumerik `%_N_…_MPF` headers are upper case on their controls.
 */
function isProgramName(text: string, cp: CompiledProfile): boolean {
  let re = PROGRAM_NAME.get(cp);
  if (re === undefined) {
    const source = cp.profile.syntax?.programNames;
    try {
      re = typeof source === 'string' && source !== '' ? new RegExp(`^(?:${source})$`, cp.flags) : null;
    } catch {
      re = null;
    }
    PROGRAM_NAME.set(cp, re);
  }
  return re !== null && re.test(text);
}

/** `syntax.programNames`, anchored, compiled once per compiled profile. */
const PROGRAM_NAME = new WeakMap<CompiledProfile, RegExp | null>();

/** The literal last character of `syntax.programNames` (`>`), which closes a name; `null` when there is none. */
function programNameCloser(cp: CompiledProfile): string | null {
  const source = cp.profile.syntax?.programNames;
  if (typeof source !== 'string' || source.length < 2) return null;
  const last = source[source.length - 1];
  if ('\\^$.|?*+()[]{}'.includes(last) || source[source.length - 2] === '\\') return null;
  return last;
}

/**
 * The tokenizer takes a `call` (`MSG("text")`) and a word with a string value (`T="name"`)
 * as one token, and does not look inside it. The letter is still in a string when an odd
 * number of double quotes lies between the token's start and the letter (a doubled quote
 * inside a string is two, so it does not change the parity). Only where the profile has
 * strings; a stray quote in Fanuc is just a character.
 */
function inQuotes(line: string, tokenStart: number, at: number, cp: CompiledProfile): boolean {
  if (cp.profile.syntax?.strings !== true) return false;
  let quotes = 0;
  for (let i = tokenStart; i < at; i++) if (line.charCodeAt(i) === 34) quotes++;
  return quotes % 2 === 1;
}

/** What to do with a letter key. */
export type UppercaseDecision =
  /** Leave the key to the editor. */
  | { kind: 'pass' }
  /** Every cursor takes the same capital: one `type` command (auto-closing and undo stay the editor's). */
  | { kind: 'type'; text: string }
  /**
   * The cursors disagree (one is in a comment, another in code): the text to insert at each,
   * in the order of `sites`, which is the order of the selections.
   */
  | { kind: 'perCursor'; texts: string[] };

/**
 * The decision for a key press. `enabled` is the effective option (the profile's flag or the
 * session switch). `composing` is the editor's own composition state, on top of what the
 * event says.
 */
export function decideUppercase(
  k: KeyInput,
  sites: readonly TypingSite[],
  cp: CompiledProfile,
  enabled: boolean,
  composing = false,
): UppercaseDecision {
  if (!enabled || sites.length === 0) return { kind: 'pass' };
  const upper = uppercaseOf(k, composing);
  if (upper === null) return { kind: 'pass' };
  const texts = sites.map((site) => (keepsCase(site, upper, cp) ? k.key : upper));
  const changed = texts.filter((text) => text !== k.key).length;
  if (changed === 0) return { kind: 'pass' };
  if (changed === texts.length) return { kind: 'type', text: upper };
  return { kind: 'perCursor', texts };
}

/** One selection as the join rule needs it (1-based lines and UTF-16 columns, as Monaco). */
export interface JoinSelection {
  empty: boolean;
  /** The cursor's line and column (the selection's active end). */
  line: number;
  column: number;
  /** The length of that line, so `column === lineLength + 1` is its end. */
  lineLength: number;
  /** The cursor's line holds nothing but blanks (or nothing). */
  lineBlank: boolean;
  /**
   * The line a join would pull in: the one above for Backspace, the one below for Delete.
   * Blank when it holds nothing but blanks; `true` when there is no such line, which also
   * leaves nothing to refuse.
   */
  neighbourBlank: boolean;
}

/** True for a line that holds only blanks, the empty line included. */
export function isBlankLine(text: string): boolean {
  return text.trim() === '';
}

/**
 * Backspace and Delete refused because they would join two blocks: the plain keys, Shift
 * allowed for Backspace, and the word and line deletions on the same keys (Ctrl, Alt or Cmd
 * with Backspace or Delete; owner decision of 2026-10-09, M13 review CODE-12), which in
 * column 1 or at the line end take the line break just as the plain key does. Never during a
 * composition. Refused when some cursor has an empty selection in column 1 (Backspace, not on
 * the first line) or at the end of a line (Delete, not on the last line) **and both lines hold
 * text**: removing an empty or blank line joins no two blocks (owner, 2026-10-09). A selection
 * is never refused, so with a single selection that spans a line break the delete works; with
 * several cursors one empty cursor at a join of two text lines is enough to refuse the key
 * press. The explicit Join Lines command is another command and stays allowed.
 */
export function wouldJoinBlocks(
  k: KeyInput,
  selections: readonly JoinSelection[],
  lineCount: number,
  composing = false,
): boolean {
  if (isComposing(k, composing)) return false;
  if (k.key === 'Backspace') {
    return selections.some((s) => s.empty && s.column === 1 && s.line > 1 && !s.lineBlank && !s.neighbourBlank);
  }
  // Shift+Delete is Cut on Windows and Linux; it joins nothing.
  if (k.key === 'Delete' && k.shiftKey !== true) {
    return selections.some(
      (s) => s.empty && s.column === s.lineLength + 1 && s.line < lineCount && !s.lineBlank && !s.neighbourBlank,
    );
  }
  return false;
}
