// Renumber blocks (plan §5 WP4.2 and WP6.3, `docs/planning/nc-transformations.md`).
// Owner: **WP6.3** (was WP4.2).
//
// Rewrites the block number at the start of each block **and the references that point at
// it** (M6). What it must never do:
//
//  - touch a number that is not a block number: `N` inside a comment (`(N50)`), inside a
//    string, or as an address in the middle of a block
//  - lose the block-skip mark: `/N100 G0` keeps its `/`, and `N120/` keeps the `/` where
//    it stood
//  - renumber an alphanumeric block name (`NLAP1`) — it is a label, not a counter. A jump
//    label whose own name starts with the prefix letter (Sinumerik `NEXT_PECK:`) is no
//    block name, and its block is numbered like any other (`N10 NEXT_PECK:`)
//  - number a program marker: `%`, `O1000` and `:1000` are not blocks, and `N10 :1000`
//    moves the program number out of the first position of the block
//  - turn a **main block** into an ordinary one. Where the dialect has main blocks
//    (`syntax.blockNumber.mainPrefix`, Sinumerik `:20`), `:20` is renumbered as `:30` and
//    never as `N30`: a main block is where a block search may start the program (it has
//    to carry everything the machining from there on needs), and a jump names it by its
//    own prefix (`GOTOF :20`) and not by `N20` (M9, WP9.5b; see "Main blocks" below)
//  - **guess** at a reference. `GOTO 100`, `M98 Q100` and `G71 P100 Q200` are rewritten
//    only where the run can prove which block they name: one block with that number, in
//    the same program, inside the lines this run rewrites, under a rule that allows it
//    (`numbering.references[].rewrite`, §7.1). Everything else is reported and left
//    exactly as it is — a jump target written wrongly is worse than one left behind,
//    because the program still runs and lands in the wrong place. The scan is over the
//    whole document (`references.ts`), not over the selection: a jump *above* the
//    selection points into it just as well. On a control whose sequence numbers are
//    names (Okuma) a reference names the block written exactly like it, and it is
//    rewritten with exactly the text that block receives (`references.ts`, "Numbers or
//    names").
//  - wrap past the maximum in silence: wrapping writes a second `N10` into the program,
//    and duplicate block numbers are a defect, not a formatting choice. `stop` warned
//    from the start; `wrap` warns now too (G8 M4). And it rewrites **no** reference whose
//    new value the run itself made ambiguous: a control takes the first block that
//    matches, so a value that names several blocks is not an answer (G8 M6). The
//    preflight bounds that question before the run and asks about it (`mayWrap`).
//
// Nor does it read a selection as if it were the start of the document: the state going
// into `lines[0]` comes from `fragment.ts`, so a Klartext selection that begins inside a
// `~` block knows that its first lines are a continuation tail.
//
// Options (defaults from `profile.numbering`): `start`, `step`, `digits`, `max` with
// `onOverflow` wrap or stop, `spacesAfter`, `skipStartingWith`, `skipEmpty`,
// `restartAtProgramStart`, `onlyNumbered`, `altPrefixes`.
//
// Klartext (`numbering.mode === 'consecutive'`) has no options form at all: the control
// requires consecutive numbers from 0, and a continuation line (the tail of a `~` block)
// is not a block and gets none.
//
// ## How the line is taken apart
//
// Every line goes through `tokenizeLine`, never through a regex (types.ts, rule 1). The
// head of a block is at most four things, and the tokenizer is what decides which is
// which:
//
//     ␣␣  /1   N100   ␣ /   G0 X10 (SEE N50)
//     │    │     │      │    └── rest: copied through, untouched
//     │    │     │      └────── skip mark after the number (`blockSkip.position`)
//     │    │     └───────────── the block number, prefix included
//     │    └─────────────────── skip mark before the number
//     └──────────────────────── leading whitespace, kept exactly
//
// Only the block number is rewritten. The gaps inside the head are copied verbatim, so
// `N100 /G0` keeps its space and `N120/G0` keeps its lack of one. `spacesAfter` sets the
// one gap between the head and the code — and only when no skip mark follows the number,
// because `/` binds to the block it skips (`5 /L X+0` stays `5 /L X+0`).
//
// ## What is not rewritten
//
// A line is left exactly as it was when it is a Klartext continuation line, when it is
// empty and `skipEmpty` is set, when it starts with one of `skipStartingWith`, when it
// carries a block *name* instead of a number, when `onlyNumbered` is set and it has no
// number, and once numbering has stopped at `max`.
//
// `skipStartingWith` reads the line as it is written, behind its indentation and nothing
// else: `(HEADER)` starts with `(` and is skipped, while `/(HEADER)` starts with `/` and
// is a block that gets a number. The list is a text match the user can predict, and a
// user who wants the skipped blocks left alone writes `/` in it.
//
// The trailing empty element of the line array — the one a final newline produces — is
// never numbered either: writing into it would turn the document's final newline into
// content, and the trailing state is not this transform's (types.ts, rule 5).
//
// Skipped lines are reported to the results panel, capped at `SKIP_LIMIT` entries: a
// 300k-line program must not allocate one object per line just to say "not numbered".

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import { t } from '$lib/i18n';
import { continuationRisk, stateBefore } from './fragment';
import { mainKeyOf, mainPrefixOf, mainReferencesOn, maskedOf, referencePreflight, scanProgram } from './references';

export { mainKeyOf, mainPrefixOf } from './references';
import type { Located, Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import type { BlockKey, FoundReference, NumberSite, ProgramScan, ReferenceWord } from './references';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** Rows the results panel gets at most; the summary still counts every skipped line. */
const SKIP_LIMIT = 200;

const TAB = 0x09;
const SPACE = 0x20;

function isSpaceCode(code: number): boolean {
  return code === SPACE || code === TAB;
}

function isLetterCode(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function upperCode(code: number): number {
  return code >= 0x61 && code <= 0x7a ? code - 32 : code;
}

/** `line.startsWith(literal, at)`, honouring the profile's case rule. */
function matchesAt(line: string, at: number, literal: string, caseSensitive: boolean): boolean {
  if (literal === '' || at + literal.length > line.length) return false;
  for (let i = 0; i < literal.length; i++) {
    const a = line.charCodeAt(at + i);
    const b = literal.charCodeAt(i);
    if (a === b) continue;
    if (caseSensitive || upperCode(a) !== upperCode(b)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** The run's settings: the form values where they are usable, the profile where they are not. */
interface Settings {
  /** Klartext: every block, step 1, no form (`numbering.mode`). */
  consecutive: boolean;
  /** The caller asked for more digits than the dialect allows, and was held to them. */
  digitsLimited: boolean;
  /** The caller asked for a higher maximum (or none) than the dialect allows. */
  maxLimited: boolean;
  start: number;
  step: number;
  digits: number;
  max: number | null;
  /** `onOverflow`: true wraps to `start`, false stops and warns. */
  wrap: boolean;
  spacesAfter: number;
  skipStartingWith: string[];
  skipEmpty: boolean;
  restartAtProgramStart: boolean;
  onlyNumbered: boolean;
  /** Prefixes that also count as an existing block number; new numbers keep the profile's. */
  altPrefixes: string[];
}

/**
 * A whole number from a form value.
 *
 * `validateFields` never corrects, so a field the user left empty arrives as `undefined`
 * or `''` and has to fall back here. A caller that skips the form (`skipForm`) passes
 * nothing at all, and lands on the profile's value the same way.
 */
function intOf(value: unknown, fallback: number, min: number): number {
  if (value === undefined || value === null || value === '') return Math.max(min, fallback);
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : Math.max(min, fallback);
}

function boolOf(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** An empty `max` field is "no maximum", which is not the same as "not filled in". */
function maxOf(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
}

/** A space-separated list field. An empty string is an empty list, not a missing value. */
function wordsOf(value: unknown, fallback: string[]): string[] {
  if (typeof value === 'string') return value.split(/\s+/).filter((word) => word !== '');
  if (Array.isArray(value)) return value.filter((word): word is string => typeof word === 'string' && word !== '');
  return [...fallback];
}

/**
 * The highest block number the control accepts and how many digits it has, or null when
 * the dialect has no hard limit. Padding past that width writes a block number the
 * control reads as too long (`N00010` on a 9999 control).
 *
 * The schema has no field for "hard limit" (§7.1), so the profile says it the way it
 * already can: a `max` with `onOverflow: 'stop'` (Okuma, 9999) is the control's limit. A
 * `max` with `wrap` (Fanuc, Sinumerik) is only where the counter starts over, and a user
 * may raise it or clear it for a control with a longer number.
 */
function profileLimit(cp: CompiledProfile): { max: number; digits: number } | null {
  const { max, onOverflow } = cp.profile.numbering;
  if (onOverflow !== 'stop' || max === undefined || !Number.isFinite(max) || max < 1) return null;
  const whole = Math.trunc(max);
  return { max: whole, digits: String(whole).length };
}

function settingsFor(cp: CompiledProfile, options: Record<string, unknown>): Settings {
  const numbering = cp.profile.numbering;
  const separated = cp.profile.syntax.wordSeparatorRequired === true;
  // A dialect that separates its words needs at least one space behind the number, or
  // `5 L X+0` would come back as `5L X+0` and stop being a move.
  const minSpaces = separated ? 1 : 0;

  if (numbering.mode === 'consecutive') {
    return {
      consecutive: true,
      digitsLimited: false,
      maxLimited: false,
      start: Math.max(0, Math.trunc(numbering.start ?? 0)),
      step: 1,
      digits: 0,
      max: null,
      wrap: false,
      spacesAfter: intOf(numbering.spacesAfter, 1, Math.max(1, minSpaces)),
      skipStartingWith: [],
      skipEmpty: true,
      restartAtProgramStart: false,
      onlyNumbered: false,
      altPrefixes: [],
    };
  }

  // A caller that skips the form (a script, a headless run) is held to the same limit
  // the form enforces, and told which of its answers was cut down (`digitsLimited`,
  // `maxLimited`).
  const limit = profileLimit(cp);
  const digits = intOf(options.digits, numbering.digits ?? 0, 0);
  const max = maxOf(options.max, numbering.max ?? null);
  const digitsOver = limit !== null && digits > limit.digits;
  const maxOver = limit !== null && (max === null || max > limit.max);

  return {
    consecutive: false,
    digitsLimited: digitsOver,
    maxLimited: maxOver,
    start: intOf(options.start, numbering.start ?? 10, 0),
    step: intOf(options.step, numbering.step ?? 10, 1),
    digits: digitsOver ? limit.digits : digits,
    max: maxOver ? limit.max : max,
    wrap: options.onOverflow === undefined ? (numbering.onOverflow ?? 'wrap') === 'wrap' : options.onOverflow === 'wrap',
    spacesAfter: intOf(options.spacesAfter, numbering.spacesAfter ?? 1, minSpaces),
    skipStartingWith: wordsOf(options.skipStartingWith, numbering.skipStartingWith ?? []),
    skipEmpty: boolOf(options.skipEmpty, numbering.skipEmpty === true),
    restartAtProgramStart: boolOf(options.restartAtProgramStart, numbering.restartAtProgramStart === true),
    onlyNumbered: boolOf(options.onlyNumbered, numbering.onlyNumbered === true),
    altPrefixes: wordsOf(options.altPrefixes, cp.profile.syntax.blockNumber.altPrefixes ?? []),
  };
}

/**
 * The profile the tokenizer should use for this run.
 *
 * `altPrefixes` decides what counts as an *existing* block number, and that lives in the
 * profile the tokenizer reads — so a run that changes the list recompiles the profile
 * once instead of second-guessing the tokenizer per line. Only the alternative prefixes
 * change; every pattern is the one that already compiled, so this cannot throw.
 */
function withAltPrefixes(cp: CompiledProfile, altPrefixes: string[]): CompiledProfile {
  const current = cp.profile.syntax.blockNumber.altPrefixes ?? [];
  if (current.length === altPrefixes.length && current.every((prefix, i) => prefix === altPrefixes[i])) return cp;
  const profile: Profile = {
    ...cp.profile,
    syntax: {
      ...cp.profile.syntax,
      blockNumber: { ...cp.profile.syntax.blockNumber, altPrefixes: [...altPrefixes] },
    },
  };
  return compileProfile(profile);
}

// ---------------------------------------------------------------------------
// The head of a block
// ---------------------------------------------------------------------------

interface Head {
  /** Offset behind the leading whitespace. */
  leadEnd: number;
  /** The skip marks before the number, as one span when there are several (`/1/2`). */
  skipBefore: NcToken | null;
  number: NcToken | null;
  /** Only ever set together with `number`: the tokenizer looks for it behind one. Spans several marks as `skipBefore` does. */
  skipAfter: NcToken | null;
  /** Offset behind the last head token, or `leadEnd` when the head is empty. */
  end: number;
  /** First non-whitespace offset behind `end`, or `line.length` when there is no code. */
  restStart: number;
}

/** One skip mark from the start of `first` to the end of `last`, the gaps between them included. */
function spanOf(line: string, first: NcToken, last: NcToken): NcToken {
  return { ...first, end: last.end, text: line.slice(first.start, last.end) };
}

/** Splits the head off the token list. Nothing here re-reads the line's syntax. */
function readHead(line: string, tokens: NcToken[]): Head {
  let index = 0;
  let leadEnd = 0;
  if (tokens[0]?.kind === 'whitespace') {
    leadEnd = tokens[0].end;
    index = 1;
  }

  let skipBefore: NcToken | null = null;
  let number: NcToken | null = null;
  let skipAfter: NcToken | null = null;
  let end = leadEnd;

  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'whitespace') continue;
    // Several skip levels on one block (`/1/2 N20`, `/1 /2 N20`) are one mark here: the
    // number stands behind all of them. Taking only the first one read `/2` as the start
    // of the code and wrote `/1N110 /2 N20 G1` (M9 NC review F7).
    if (token.kind === 'skip' && number === null) {
      skipBefore = skipBefore === null ? token : spanOf(line, skipBefore, token);
      end = token.end;
      continue;
    }
    if (token.kind === 'skip' && number !== null) {
      skipAfter = skipAfter === null ? token : spanOf(line, skipAfter, token);
      end = token.end;
      continue;
    }
    if (token.kind === 'blockNumber' && number === null && skipAfter === null) {
      number = token;
      end = token.end;
      continue;
    }
    break;
  }

  let restStart = end;
  while (restStart < line.length && isSpaceCode(line.charCodeAt(restStart))) restStart++;
  return { leadEnd, skipBefore, number, skipAfter, end, restStart };
}

/**
 * The line with `numberText` as its block number, everything else as it was.
 *
 * The gaps *inside* the head are copied from the original, so the two block-skip forms
 * keep their shape. `spacesAfter` only sets the gap between the head and the code, and
 * only when the head does not end in a skip mark.
 */
function rebuild(line: string, head: Head, numberText: string, spacesAfter: number): string {
  let out = line.slice(0, head.leadEnd);
  if (head.skipBefore !== null) {
    out += head.skipBefore.text;
    if (head.number !== null) out += line.slice(head.skipBefore.end, head.number.start);
  }
  out += numberText;
  if (head.skipAfter !== null && head.number !== null) {
    out += line.slice(head.number.end, head.skipAfter.start) + head.skipAfter.text;
  }

  // Nothing but whitespace behind the head: keep that whitespace instead of writing a
  // separator the block has nothing to separate.
  if (head.restStart >= line.length) return out + line.slice(head.end);

  const gap = head.skipAfter !== null ? line.slice(head.skipAfter.end, head.restStart) : ' '.repeat(spacesAfter);
  return out + gap + line.slice(head.restStart);
}

/**
 * True when the block carries a name rather than a number (`NLAP1`).
 *
 * The tokenizer already refuses `NLAP1` as a block number, which would leave the line
 * looking unnumbered and earn it a fresh `N10` in front of its own label. Read at the
 * head only, and only where a prefix would have stood.
 */
function looksLikeBlockName(line: string, at: number, prefixes: string[], caseSensitive: boolean): boolean {
  for (const prefix of prefixes) {
    if (!matchesAt(line, at, prefix, caseSensitive)) continue;
    let i = at + prefix.length;
    while (i < line.length && isSpaceCode(line.charCodeAt(i))) i++;
    if (i < line.length && isLetterCode(line.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * The tokenizer's answer to "does this block carry a name?", where it has one.
 *
 * A `label` token at the start of the block's text is either a **block name** — the block
 * prefix written in front of the name (Okuma `NLAP1`: text `NLAP1`, name `LAP1`) — or a
 * **jump label** whose own name happens to start with the prefix letter (Sinumerik
 * `NEXT_PECK:`: text `NEXT_PECK:`, name `NEXT_PECK`). Only the first is a block name; the
 * second is a label like `LAST_CUT:` and its block gets a number in front of it. Without a
 * label token there (Fanuc reads `NLAP1` as letters), the text decides as before.
 *
 * Returns null when the head of the block's text is not a label token.
 */
function labelIsBlockName(
  tokens: NcToken[],
  at: number,
  prefixes: string[],
  caseSensitive: boolean,
): boolean | null {
  const label = tokens.find((token) => token.start === at && token.kind !== 'whitespace');
  if (label === undefined || label.kind !== 'label') return null;
  const name = label.address;
  if (name === undefined || name === '') return false;
  for (const prefix of prefixes) {
    if (!matchesAt(label.text, 0, prefix, caseSensitive)) continue;
    let i = prefix.length;
    while (i < label.text.length && isSpaceCode(label.text.charCodeAt(i))) i++;
    if (matchesAt(label.text, i, name, caseSensitive)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main blocks (M9, WP9.5b)
// ---------------------------------------------------------------------------
//
// A Sinumerik program has two kinds of block number: `N20` numbers a block, `:20` numbers
// a **main block** (`syntax.blockNumber.mainPrefix`, §7.1, §7.16 #50). The manuals keep
// them apart in three places, and so does this run:
//
//  - the prefix belongs to the block: renumbering writes `:30`, never `N30`;
//  - a jump names a main block by its own prefix (`GOTOF :20`) and an ordinary block by
//    `N` (`GOTOF N20`), so `GOTOF N20` does not name `:20`, and a program that has only a
//    `:20` has no `N20` for it to find;
//  - `GOTOF :20` is a reference all the same, and it is rewritten under exactly the rules
//    every other reference is (the reference rules whose addresses name the ordinary block
//    prefix, `numbering.references`, read with the main prefix in front).
//
// `references.ts` indexes every block by its value, whatever its prefix, and reads `:20`
// behind a `GOTOF` as two tokens of no address. [`withMainBlocks`] corrects that scan
// before anything reads it: main blocks get keys of their own (the prefix in front, so a
// main key is a string that never equals an ordinary one), and the main-block jumps are
// added as references. A dialect without the field, or a program without the prefix in any
// line, keeps the scan exactly as it was and pays nothing for this. The three helpers are
// exported for Remove Block Numbers, which has to keep a main block a jump names (hand-off
// note of WP9.5b); they live in `references.ts` since the M11 review (NC-3), which reads
// main-block jumps for review mode too, and are re-exported here.

/** True for a key [`mainKeyOf`] made. */
function isMainKey(key: BlockKey | null | undefined, main: string | null): boolean {
  return main !== null && typeof key === 'string' && key.startsWith(main);
}

/** The scan with main blocks keyed by their own prefix and their jumps added (see above). */
export function withMainBlocks(scan: ProgramScan, cp: CompiledProfile): ProgramScan {
  const main = mainPrefixOf(cp);
  if (main === null || cp.re.references.length === 0 || scan.scanned.length === 0) return scan;
  if (!scan.scanned.some((line) => line.includes(main))) return scan;

  const keys = scan.keys.slice();
  const added: FoundReference[] = [];
  let state: LineState | undefined;
  for (let row = 0; row < scan.scanned.length; row++) {
    const line = scan.scanned[row];
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;
    if (!line.includes(main)) continue;

    for (const token of tokens) {
      if (token.kind !== 'blockNumber') continue;
      if (token.address === main && keys[row] !== null && token.valueText !== undefined) {
        keys[row] = mainKeyOf(main, token.valueText, scan.byText);
      }
      break;
    }

    for (const word of mainReferencesOn(tokens, line, cp)) added.push({ row, word });
  }

  const segments: Map<BlockKey, NumberSite>[] = scan.segments.map(() => new Map());
  for (let row = 0; row < keys.length; row++) {
    const key = keys[row];
    if (key === null) continue;
    const counts = segments[scan.segmentOf[row]];
    const site = counts.get(key);
    if (site === undefined) counts.set(key, { count: 1, row, lastRow: row });
    else {
      site.count++;
      site.lastRow = row;
    }
  }

  const found = added.length === 0 ? scan.found : [...scan.found, ...added].sort((a, b) => a.row - b.row || a.word.start - b.word.start);
  let count = scan.count;
  let first = scan.first;
  if (added.length > 0) {
    // `found` is in row order, so its first row is the first line that carries one.
    const rows = new Set(found.map((reference) => reference.row));
    count = rows.size;
    first = scan.firstLine + found[0].row;
  }
  return { ...scan, found, count, first, keys, segments };
}

// ---------------------------------------------------------------------------
// Program starts and program markers
// ---------------------------------------------------------------------------

function isProgramStart(masked: string, cp: CompiledProfile): boolean {
  for (const re of cp.re.programStart) if (re.test(masked)) return true;
  return false;
}

/**
 * True when the block *is* a program marker: `%`, `O1000`, `:1000`.
 *
 * Such a line is not a block and never gets a number. Writing `N10` in front of `:1000`
 * moves the program number out of the first position and the control loses it — which is
 * what the shipped defaults did, because `skipStartingWith` is `%`, `O`, `(` and the
 * colon form is not in the list (G8 M4). The tokenizer already knows all three forms, so
 * the text list stays what it is meant to be: an extra user filter, not the only guard.
 *
 * Read from the tokens of *this* run, so a dialect (or an `altPrefixes` run) that reads
 * `:1000` as a block number still renumbers it: it is a `blockNumber` token then, not a
 * `programMarker`.
 */
function isProgramMarkerLine(tokens: NcToken[]): boolean {
  for (const token of tokens) {
    if (token.kind === 'whitespace') continue;
    return token.kind === 'programMarker';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Block-number references
// ---------------------------------------------------------------------------

/**
 * What this run does with one reference.
 *
 * Only `rewritten` writes anything; `unchanged` is a reference whose target keeps the
 * number it had, which is the right answer and not worth a word. The other six are the
 * ones the user is told about, and each names the reason, because "check your jumps" is
 * not something anybody can act on.
 */
type Outcome =
  /** The value was replaced with the number its block carries now. */
  | 'rewritten'
  /** Resolved, and the number did not change. */
  | 'unchanged'
  /** The rule says report only: the block may be in the calling program (`M99 P`, F42). */
  | 'kept'
  /** No block of this program carries that number. */
  | 'missing'
  /** More than one does, so there is no single answer. */
  | 'duplicate'
  /** The block it names is not among the lines this run rewrites. */
  | 'outside'
  /** The reference itself is outside them and points into them. */
  | 'incoming'
  /** The value is a variable, an expression or otherwise not a block number. */
  | 'notNumber'
  /** The block carries two words with this address, so which one points at a block
   *  number cannot be told from the line (`references.ts`, `ReferenceWord.ambiguous`). */
  | 'ambiguous';

interface Decision {
  /** Index into the run's `lines`, or -1 when the reference stands outside them. */
  index: number;
  /** The document line, for the results panel. */
  line: number;
  word: ReferenceWord;
  outcome: Outcome;
  /** The value to write in place of `word.text`; empty unless `outcome` is `rewritten`. */
  text: string;
}

/** True for every outcome the user is told about. */
function isTrouble(outcome: Outcome): boolean {
  return outcome !== 'rewritten' && outcome !== 'unchanged';
}

/**
 * The new value, written the way the old one was.
 *
 * Zero padding is a property of the reference, not of the block number: `P0100` is written
 * with four digits because the post writes four, so it becomes `P0020` and not `P20`. A
 * value that was not padded stays unpadded, and one that outgrows its padding is written
 * in full rather than truncated.
 *
 * This is the rule of a control that reads block numbers as **numbers**. Where they are
 * names (`ProgramScan.byText`, Okuma) the padding belongs to the name, and a reference is
 * written with exactly the text its block receives instead (see `decideReferences`).
 */
function writtenAs(oldText: string, oldValue: number, newValue: number): string {
  const digits = String(newValue);
  const padded = oldText.length > String(oldValue).length;
  return padded && digits.length < oldText.length ? digits.padStart(oldText.length, '0') : digits;
}

/**
 * The key a block number written as `text` has in this scan (`references.ts`, `BlockKey`).
 * `main` is the main prefix when the block is a main block, which keeps its prefix.
 */
function keyOfWritten(scan: ProgramScan, text: string, main: string | null = null): BlockKey {
  if (main !== null) return mainKeyOf(main, text, scan.byText);
  return scan.byText ? text : Number(text);
}

/**
 * How often each block occurs in a program **after** the run.
 *
 * `newTextOf` is the run's answer for a line of its scope — the digits it wrote; every
 * other row keeps the block number the scan read. The result is per program segment,
 * because that is the scope a block-number reference is resolved in, and it counts
 * [`BlockKey`]s, so on a dialect whose sequence numbers are names `N20` and `N0020` are
 * two blocks and not one twice.
 *
 * Without this, a run that wraps rewrote every reference with a number the program now
 * carries ten times over (G8 M6): the duplicate test only ever looked at the numbering
 * the run **replaced**, found each target unique there, and wrote a value a control
 * resolves to the first of many matching blocks.
 */
function keysAfter(
  scan: ProgramScan,
  base: number,
  lineCount: number,
  newTextOf: (index: number) => string | null,
  main: string | null,
): Map<BlockKey, number>[] {
  const end = base + lineCount;
  const after: Map<BlockKey, number>[] = scan.segments.map(() => new Map());
  for (let row = 0; row < scan.keys.length; row++) {
    const written = row >= base && row < end ? newTextOf(row - base) : null;
    // A main block keeps its prefix, so it keeps its kind of key.
    const key =
      written === null ? scan.keys[row] : keyOfWritten(scan, written, isMainKey(scan.keys[row], main) ? main : null);
    if (key === null) continue;
    const counts = after[scan.segmentOf[row]];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return after;
}

/**
 * What the run can do with every reference in the program.
 *
 * `newTextOf` answers, for a line of the run's scope, the digits of the block number it
 * carries afterwards (`'20'`, or `'0020'` with four digits), or null when that line keeps
 * the number it had. The preflight passes null for the whole function: it only has to know
 * *whether* a reference can be rewritten, and that question is answered by the program's
 * own numbers, so the preflight and the run always agree on what will be reported — with
 * one exception, a run that wraps: only the run knows the numbering it wrote, and the
 * preflight bounds that question for itself (`mayWrap`).
 *
 * A reference is resolved by its [`BlockKey`]. Where sequence numbers are names
 * (`scan.byText`, Okuma) it names the block written exactly like it, so `N0020` is missing
 * in a program that only has an `N20`, and a rewritten reference takes exactly the text its
 * block receives — including when only the padding changed and the number stayed the same
 * (`N0020` renumbered to `N20` moves its jumps along, G10 M8).
 */
function decideReferences(
  scan: ProgramScan,
  firstLine: number,
  lineCount: number,
  newTextOf: ((index: number) => string | null) | null,
  main: string | null,
): Decision[] {
  const base = Math.max(0, Math.trunc(firstLine) - scan.firstLine);
  const end = base + lineCount;
  const decisions: Decision[] = [];
  // Only the run knows the numbering it wrote; the preflight asks about wrapping in its
  // own way (`mayWrap`), because it cannot know how many blocks will really be numbered.
  const after = newTextOf === null ? null : keysAfter(scan, base, lineCount, newTextOf, main);

  for (const { row, word } of scan.found) {
    const line = scan.firstLine + row;
    const site = word.key === null ? undefined : scan.segments[scan.segmentOf[row]].get(word.key);

    if (row < base || row >= end) {
      // A reference this run does not rewrite only matters when it points **into** the
      // lines it does: everything else keeps naming a number nothing here touches.
      if (site === undefined) continue;
      const inside =
        (site.row >= base && site.row < end) ||
        (site.lastRow >= base && site.lastRow < end) ||
        (site.row < base && site.lastRow >= end);
      if (inside) decisions.push({ index: -1, line, word, outcome: 'incoming', text: '' });
      continue;
    }

    const index = row - base;
    const decide = (outcome: Outcome, text = ''): void => {
      decisions.push({ index, line, word, outcome, text });
    };
    // The rule first: `rewrite: false` is not "could not", it is "must not", and that is
    // what the row has to say even when the number happens to exist here as well.
    if (!word.rewrite) decide('kept');
    // Two words of one address in one block: the rule fired on the line and cannot say
    // which of them it meant, so neither is touched.
    else if (word.ambiguous) decide('ambiguous');
    else if (word.target === null) decide('notNumber');
    // Without a document a missing number may simply be out of sight, and saying "this
    // program has no N100" about lines nobody read would be a lie.
    else if (site === undefined) decide(scan.unchecked ? 'outside' : 'missing');
    else if (site.count > 1) decide('duplicate');
    else if (site.row < base || site.row >= end) decide('outside');
    else {
      const written = newTextOf === null ? null : newTextOf(site.row - base);
      // The block this reference would name afterwards, whether the run rewrites the
      // value or leaves it standing. A run that wrapped hands the same number out several
      // times, and a control takes the first match, so an answer that is no longer unique
      // is not an answer (G8 M6).
      const named = written === null ? word.key : keyOfWritten(scan, written, isMainKey(word.key, main) ? main : null);
      if (after !== null && named !== null && (after[scan.segmentOf[row]].get(named) ?? 0) > 1) decide('duplicate');
      else if (written === null || named === word.key) {
        // Where blocks are names, the same key is the same text: nothing to write.
        decide('unchanged');
      } else if (scan.byText) decide('rewritten', written);
      else decide('rewritten', writtenAs(word.text, word.target, Number(written)));
    }
  }
  return decisions;
}

/**
 * Writes the rewritten values into the lines the run produced.
 *
 * The spans were read on the original line, and the only thing the run changed in front
 * of them is the head of the block — the number, its skip marks and the gap behind it —
 * so everything behind the head moved by exactly the change in the line's length. Several
 * values on one line are written from the back, so an earlier span keeps its offsets.
 */
function applyReferences(out: string[], lines: readonly string[], decisions: readonly Decision[]): void {
  const byLine = new Map<number, Decision[]>();
  for (const decision of decisions) {
    if (decision.outcome !== 'rewritten' || decision.index < 0) continue;
    const list = byLine.get(decision.index);
    if (list === undefined) byLine.set(decision.index, [decision]);
    else list.push(decision);
  }

  for (const [index, list] of byLine) {
    const delta = out[index].length - lines[index].length;
    list.sort((a, b) => b.word.start - a.word.start);
    let text = out[index];
    for (const { word, text: value } of list) {
      text = text.slice(0, word.start + delta) + value + text.slice(word.end + delta);
    }
    out[index] = text;
  }
}

/**
 * The two row lists in one, in line order and capped.
 *
 * The results panel is read top to bottom, so a reference row belongs next to the skipped
 * line above it and not behind 200 of them. Both lists are already in line order, which
 * makes this a merge; where a line appears in both, the skip comes first, because it is
 * the reason the line looks the way it does.
 */
function mergeRows(skipped: Located[], references: Located[], limit: number): Located[] {
  if (references.length === 0) return skipped;
  const rows: Located[] = [];
  let a = 0;
  let b = 0;
  while (rows.length < limit && (a < skipped.length || b < references.length)) {
    if (b >= references.length || (a < skipped.length && skipped[a].line <= references[b].line)) rows.push(skipped[a++]);
    else rows.push(references[b++]);
  }
  return rows;
}

/**
 * The scan both the preflight and the run work from.
 *
 * `altPrefixes` decides what counts as an existing block number, so the scan has to read
 * the program through the same compiled profile the run writes it with.
 */
function scanFor(lines: string[], ctx: TransformContext, cp: CompiledProfile): ProgramScan {
  return withMainBlocks(scanProgram(lines, cp === ctx.cp ? ctx : { ...ctx, cp }), cp);
}

/**
 * The most blocks one run of the counter can have to number, as an upper bound.
 *
 * Every line is at most one block, so the scope's line count is the bound — except where
 * the counter starts over at each program start, and then it is the longest program
 * inside the scope. It is deliberately an over-estimate: skipped and unnumbered lines
 * bring the real count down, and the only thing this answers is whether the run *could*
 * run past the maximum.
 */
function mostBlocks(scan: ProgramScan, restart: boolean, firstLine: number, lineCount: number): number {
  if (!restart) return lineCount;
  const base = Math.max(0, Math.trunc(firstLine) - scan.firstLine);
  const end = Math.min(scan.segmentOf.length, base + lineCount);
  let best = 0;
  let run = 0;
  let segment = -1;
  for (let row = base; row < end; row++) {
    if (scan.segmentOf[row] !== segment) {
      segment = scan.segmentOf[row];
      run = 0;
    }
    run++;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Whether this run could pass the maximum and start over, which makes **every** rewritten
 * value suspect (G8 M6).
 *
 * The run itself knows exactly what it wrote and reports each affected reference as a
 * duplicate (`numbersAfter`). This is the question the preflight can answer before any of
 * it happens, and it can only bound it: the answer is "may", and the message says so.
 */
function mayWrap(settings: Settings, scan: ProgramScan, firstLine: number, lineCount: number): boolean {
  if (!settings.wrap || settings.max === null) return false;
  const blocks = mostBlocks(scan, settings.restartAtProgramStart, firstLine, lineCount);
  if (blocks <= 0) return false;
  return settings.start + settings.step * (blocks - 1) > settings.max;
}

// ---------------------------------------------------------------------------
// The transform
// ---------------------------------------------------------------------------

function optionFields(cp: CompiledProfile): FieldSpec[] {
  const numbering = cp.profile.numbering;
  // Klartext: consecutive from 0 in steps of 1 is what the control accepts, so there is
  // nothing to ask. `TransformService` opens no dialog for an empty field list.
  if (numbering.mode === 'consecutive') return [];
  // The dialect's own limit bounds the form: Okuma reads block numbers up to 9999, so a
  // fifth digit (`N00010`) or a maximum above it writes blocks the control rejects.
  const limit = profileLimit(cp);

  return [
    {
      id: 'start',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.start.label'),
      help: t('ncNumbering.renumber.fields.start.help'),
      default: numbering.start ?? 10,
      required: true,
      min: 0,
      max: limit?.max ?? 99999999,
    },
    { id: 'step', type: 'integer', label: t('ncNumbering.renumber.fields.step.label'), default: numbering.step ?? 10, required: true, min: 1, max: 100000 },
    {
      id: 'digits',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.digits.label'),
      help:
        limit === null
          ? t('ncNumbering.renumber.fields.digits.help')
          : t('ncNumbering.renumber.fields.digits.helpLimit', { digits: limit.digits }),
      default: Math.min(numbering.digits ?? 0, limit?.digits ?? 9),
      required: true,
      min: 0,
      max: limit?.digits ?? 9,
    },
    {
      id: 'max',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.max.label'),
      help:
        limit === null
          ? t('ncNumbering.renumber.fields.max.help')
          : t('ncNumbering.renumber.fields.max.helpLimit', { max: limit.max }),
      default: numbering.max ?? undefined,
      // Empty means "no maximum", which a dialect with a limit does not have.
      required: limit !== null,
      min: 1,
      max: limit?.max ?? 999999999,
    },
    {
      id: 'onOverflow',
      type: 'choice',
      label: t('ncNumbering.renumber.fields.onOverflow.label'),
      default: numbering.onOverflow ?? 'wrap',
      choices: [
        { label: t('ncNumbering.renumber.fields.onOverflow.wrap'), value: 'wrap' },
        { label: t('ncNumbering.renumber.fields.onOverflow.stop'), value: 'stop' },
      ],
    },
    {
      id: 'spacesAfter',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.spacesAfter.label'),
      default: numbering.spacesAfter ?? 1,
      required: true,
      min: cp.profile.syntax.wordSeparatorRequired === true ? 1 : 0,
      max: 16,
    },
    {
      id: 'skipStartingWith',
      type: 'text',
      label: t('ncNumbering.renumber.fields.skipStartingWith.label'),
      help: t('ncNumbering.renumber.fields.skipStartingWith.help'),
      default: (numbering.skipStartingWith ?? []).join(' '),
    },
    { id: 'skipEmpty', type: 'bool', label: t('ncNumbering.renumber.fields.skipEmpty.label'), default: numbering.skipEmpty === true },
    {
      id: 'restartAtProgramStart',
      type: 'bool',
      label: t('ncNumbering.renumber.fields.restartAtProgramStart.label'),
      default: numbering.restartAtProgramStart === true,
    },
    { id: 'onlyNumbered', type: 'bool', label: t('ncNumbering.renumber.fields.onlyNumbered.label'), default: numbering.onlyNumbered === true },
    {
      id: 'altPrefixes',
      type: 'text',
      label: t('ncNumbering.renumber.fields.altPrefixes.label'),
      help: t('ncNumbering.renumber.fields.altPrefixes.help'),
      default: (cp.profile.syntax.blockNumber.altPrefixes ?? []).join(' '),
    },
  ];
}

/**
 * The confirmation this transform asks for before it runs.
 *
 * Three cases, most concrete first:
 *
 *  - a consecutive dialect, numbered from a line that is not line 1: the numbers this run
 *    writes cannot line up with the blocks above and below the selection.
 *  - the program points at block numbers this run **cannot** follow: a target that is not
 *    there, one that is there twice, one outside the renumbered lines, a pointer from
 *    outside them into them, or a rule that says the target may be in the caller. The
 *    ones it can follow are rewritten and are not worth a dialog (M6, WP6.3).
 *  - a run that could not look outside its own lines at all.
 *
 * The reference scan is over the **document**, not over `lines`. A selection that holds
 * `N100` but not the `IF [#1 EQ 1] GOTO 100` above it used to pass the preflight without
 * a word and rewrite the jump target in silence (G8 M4).
 */
function preflightOf(lines: string[], ctx: TransformContext): Msg | null {
  const numbering = ctx.cp.profile.numbering;
  if (numbering.mode === 'consecutive') {
    if (ctx.firstLine <= 1) return null;
    return { key: 'ncNumbering.renumber.consecutiveSelection', params: { start: numbering.start ?? 0 } };
  }
  // A dialect that joins blocks across lines, run on a fragment whose incoming state is
  // unknown: the first lines could be the tail of a block above and must not be numbered.
  if (continuationRisk(ctx, stateBefore(ctx))) return { key: 'ncNumbering.renumber.fragmentUnknown' };

  const settings = settingsFor(ctx.cp, ctx.options);
  const cp = withAltPrefixes(ctx.cp, settings.altPrefixes);
  const scan = scanFor(lines, ctx, cp);
  // One line, one question: a `G71 P100 Q200` whose two targets are both gone is one
  // thing to look at, not two.
  const lineNumbers = new Set<number>();
  for (const decision of decideReferences(scan, ctx.firstLine, lines.length, null, mainPrefixOf(cp))) {
    if (isTrouble(decision.outcome)) lineNumbers.add(decision.line);
  }
  let first = 0;
  for (const line of lineNumbers) if (first === 0 || line < first) first = line;

  // Before the more usual question: a run that starts the numbering over hands the same
  // number out several times, and then no reference can be rewritten with an answer a
  // control would resolve to one block. The run reports each of them; this says it first.
  if (scan.count > 0 && mayWrap(settings, scan, ctx.firstLine, lines.length)) {
    return {
      key: 'ncNumbering.renumber.referencesMayWrap',
      params: { count: scan.count, start: settings.start, max: settings.max ?? 0 },
    };
  }

  return referencePreflight(
    { count: lineNumbers.size, first, unchecked: scan.unchecked },
    { references: 'ncNumbering.renumber.references', unchecked: 'ncNumbering.renumber.referencesUnchecked' },
  );
}

function runRenumber(lines: string[], ctx: TransformContext): TransformResult {
  const settings = settingsFor(ctx.cp, ctx.options);
  const cp = withAltPrefixes(ctx.cp, settings.altPrefixes);
  const caseSensitive = cp.profile.syntax.caseSensitive === true;
  const blockNumber = cp.profile.syntax.blockNumber;
  const prefixOut = blockNumber.mode === 'leading-integer' ? '' : (blockNumber.prefix ?? 'N');
  const namePrefixes = blockNumber.mode === 'leading-integer' ? [] : [prefixOut, ...settings.altPrefixes];
  const main = mainPrefixOf(cp);
  const marks = settings.skipStartingWith;

  // One lookup per run instead of one per skipped line (`Located.message` is display text).
  const reason = {
    prefix: t('ncNumbering.renumber.skippedByPrefix'),
    name: t('ncNumbering.renumber.skippedName'),
    notNumbered: t('ncNumbering.renumber.skippedNotNumbered'),
    stopped: t('ncNumbering.renumber.skippedStopped'),
    programMarker: t('ncNumbering.renumber.skippedProgramMarker'),
    wrapped: t('ncNumbering.renumber.wrappedRow'),
  };

  const out = lines.slice();
  const lineMap = new Int32Array(lines.length);
  const skipped: Located[] = [];
  const warnings: Msg[] = [];
  /**
   * Scope index → the digits of the block number that line carries after the run, as they
   * are written (`'20'`, `'0020'`): a dialect whose sequence numbers are names tells blocks
   * apart by exactly that text.
   */
  const newTextOf = new Map<number, string>();
  let skippedCount = 0;
  let numbered = 0;
  let value = settings.start;
  let stopped = false;
  let wraps = 0;
  let firstWrapLine = 0;
  // The state `lines[0]` begins in. `undefined` — a caller that handed over a fragment
  // without its document — is what `tokenizeLine` reads as the start of the document,
  // and the preflight has already warned about that on a dialect with continuations.
  let state: LineState | undefined = stateBefore(ctx);
  const lastIndex = lines.length - 1;

  const note = (index: number, message: string, severity: Located['severity']): void => {
    if (skipped.length < SKIP_LIMIT) skipped.push({ line: ctx.firstLine + index, message, severity });
  };
  const skip = (index: number, message: string): void => {
    skippedCount++;
    note(index, message, 'info');
  };

  for (let i = 0; i < lines.length; i++) {
    lineMap[i] = i;
    const line = lines[i];
    const continuation = state?.continuation === true;
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;

    // The tail of a `~` block is part of the block above; it is not a block and gets no
    // number, and it is not something the user "skipped" either.
    if (continuation) continue;

    if (settings.restartAtProgramStart && isProgramStart(maskedOf(line, tokens), cp)) value = settings.start;

    const head = readHead(line, tokens);
    const blank = head.restStart >= line.length && head.end === head.leadEnd;
    // The trailing empty element belongs to the final newline, not to a block: numbering
    // it would turn that newline into text (types.ts, rule 5).
    if (blank && (settings.skipEmpty || (i === lastIndex && line === ''))) continue;

    // A program marker is not a block, whatever the skip list says (see the function).
    if (isProgramMarkerLine(tokens)) {
      skip(i, reason.programMarker);
      continue;
    }
    if (marks.length > 0 && marks.some((mark) => matchesAt(line, head.leadEnd, mark, caseSensitive))) {
      skip(i, reason.prefix);
      continue;
    }
    // `restStart` is where the block's text starts, which is where a block *name* would
    // stand: behind the leading whitespace, or behind a skip mark and its whitespace.
    // The tokenizer decides where it read a label there (`NEXT_PECK:` is no block name,
    // Okuma `NLAP1` is); the text decides where it did not (Fanuc `NLAP1`).
    const named =
      head.number === null &&
      (labelIsBlockName(tokens, head.restStart, namePrefixes, caseSensitive) ??
        looksLikeBlockName(line, head.restStart, namePrefixes, caseSensitive));
    if (named) {
      skip(i, reason.name);
      continue;
    }
    if (settings.onlyNumbered && head.number === null) {
      skip(i, reason.notNumbered);
      continue;
    }
    if (stopped) {
      skip(i, reason.stopped);
      continue;
    }

    if (settings.max !== null && value > settings.max) {
      if (settings.wrap) value = settings.start;
      // `stop`, or a start value that is itself above the maximum: there is no number
      // left to write, so the rest of the program keeps the numbers it has.
      if (!settings.wrap || value > settings.max) {
        stopped = true;
        warnings.push({ key: 'ncNumbering.renumber.overflowStopped', params: { line: ctx.firstLine + i, max: settings.max } });
        skip(i, reason.stopped);
        continue;
      }
      // Wrapping is not free, and it used to be silent: 12,000 blocks numbered from 10 in
      // steps of 10 with the shipped `max` of 99999 wrap twice and the program comes back
      // with 2,001 duplicate block numbers (G8 M4). Duplicates break block search and
      // restart on the control, and make `GOTO`, `M99 P` and `G71 P-Q` ambiguous — the
      // control takes the first match. `stop` says what it did; so does this now.
      wraps++;
      if (firstWrapLine === 0) firstWrapLine = ctx.firstLine + i;
      note(i, reason.wrapped, 'warning');
    }

    const digits = settings.digits > 0 ? String(value).padStart(settings.digits, '0') : String(value);
    // A main block keeps its own prefix (`:20` becomes `:30`, never `N30`).
    const prefix = main !== null && head.number !== null && head.number.address === main ? main : prefixOut;
    out[i] = rebuild(line, head, prefix + digits, settings.spacesAfter);
    newTextOf.set(i, digits);
    numbered++;
    value += settings.step;
  }

  // One warning per answer that was cut down: a run that only asked for too high a maximum
  // used to be told it had been held to "at most 0 digits" as well.
  if (settings.maxLimited && settings.max !== null) {
    warnings.push({ key: 'ncNumbering.renumber.limitedMax', params: { max: settings.max } });
  }
  if (settings.digitsLimited) {
    warnings.push({ key: 'ncNumbering.renumber.limitedDigits', params: { digits: settings.digits } });
  }
  if (wraps > 0) {
    warnings.push({
      key: 'ncNumbering.renumber.wrapped',
      params: { count: wraps, line: firstWrapLine, start: settings.start, max: settings.max ?? 0 },
    });
  }

  // The references, over the whole document: a jump *above* the selection points into it
  // just as well, and the run's own walk only ever saw the selection (G8 M4).
  const decisions = decideReferences(
    scanFor(lines, ctx, cp),
    ctx.firstLine,
    lines.length,
    (index) => newTextOf.get(index) ?? null,
    main,
  );
  applyReferences(out, lines, decisions);

  const rowText: Record<Outcome, string> = {
    rewritten: '',
    unchanged: '',
    kept: t('ncNumbering.renumber.referenceKeptRow'),
    missing: t('ncNumbering.renumber.referenceMissingRow'),
    duplicate: t('ncNumbering.renumber.referenceDuplicateRow'),
    outside: t('ncNumbering.renumber.referenceOutsideRow'),
    incoming: t('ncNumbering.renumber.referenceIncomingRow'),
    notNumber: t('ncNumbering.renumber.referenceNotNumberRow'),
    ambiguous: t('ncNumbering.renumber.referenceAmbiguousRow'),
  };
  const referenceRows: Located[] = [];
  const seen = new Set<string>();
  let rewritten = 0;
  let kept = 0;
  let unresolved = 0;
  for (const decision of decisions) {
    if (decision.outcome === 'rewritten') rewritten++;
    if (!isTrouble(decision.outcome)) continue;
    if (decision.outcome === 'kept') kept++;
    else unresolved++;
    // Two values of one cycle call that fail the same way are one row, not two.
    const key = `${decision.line}:${decision.outcome}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (referenceRows.length < SKIP_LIMIT) {
      referenceRows.push({ line: decision.line, message: rowText[decision.outcome], severity: 'warning' });
    }
  }

  if (rewritten > 0) warnings.push({ key: 'ncNumbering.renumber.referencesRewritten', params: { count: rewritten } });
  if (kept > 0) warnings.push({ key: 'ncNumbering.renumber.referencesKept', params: { count: kept } });
  if (unresolved > 0) warnings.push({ key: 'ncNumbering.renumber.referencesUnresolved', params: { count: unresolved } });

  const rows = mergeRows(skipped, referenceRows, SKIP_LIMIT);
  const listed = skippedCount + wraps + seen.size;
  if (listed > rows.length) warnings.push({ key: 'ncNumbering.renumber.skippedTruncated', params: { shown: rows.length, total: listed } });

  const summary: Msg =
    numbered === 0 && skippedCount === 0
      ? { key: 'ncNumbering.renumber.nothing' }
      : skippedCount === 0
        ? { key: 'ncNumbering.renumber.summary', params: { count: numbered } }
        : { key: 'ncNumbering.renumber.summarySkipped', params: { count: numbered, skipped: skippedCount } };

  return { lines: out, lineMap, summary, skipped: rows, warnings };
}

export const renumber: TransformDef = {
  id: 'renumber',
  title: 'ncNumbering.renumber.title',
  available(): true | Msg {
    return true;
  },
  options(cp: CompiledProfile): FieldSpec[] {
    return optionFields(cp);
  },
  preflight(lines: string[], ctx: TransformContext): Msg | null {
    return preflightOf(lines, ctx);
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    return runRenumber(lines, ctx);
  },
};
