// The NC line tokenizer (plan §7.4, AD-12). Owner: WP3.2.
//
// One line in, one token list out, plus the state the next line needs. Everything that
// reads NC code goes through here: the outline runner, the transforms, hover, completion
// and the Python side (§7.10 mirrors this file).
//
// The tokenizer is driven by the profile, not by the dialect: there is no `if (fanuc)`
// anywhere below. The fields that shape it are
//
//   syntax.wordSeparatorRequired   false → packed words (`N10T1M6`), one letter per
//                                  address; true → words separated by whitespace, an
//                                  address may be several letters (`SPB+30`, `DR-0.02`)
//   syntax.comments                start and end markers; `end: null` runs to the line end
//   syntax.blockNumber             `N10` (prefix) or a leading integer (Klartext)
//   syntax.blockSkip               `/` and `/1`, before or after the block number
//   syntax.continuation            the trailing marker that joins the line to the next
//   syntax.sectionHeading          a structure block; its text is read as a comment
//   syntax.variables               `#101`, `Q12`, `QL3`, `QS1`
//   syntax.incrementalPrefix       Klartext `I`: `IX+10` is an incremental X
//   syntax.decimalSeparator        the character that starts a fraction
//   keywords (compiled)            upper case, longest first, `\s+` between the parts of
//                                  a multi-word keyword
//   program.start                  a program number at the head of a line (`O1001`)
//
// P8 (AD-24) adds six opt-in fields for the turning dialects. Every one of them is off
// unless the profile sets it, so a profile that does not mention them tokenizes exactly
// as it did before — which is what the Fanuc and Klartext goldens prove:
//
//   syntax.header                  a file header at the head of a line, one
//                                  `programMarker`: `$PART.MIN%`, `%_N_PART_MPF`
//   syntax.sequenceNames           the block-number prefix also names blocks: `NLAP1` is
//                                  a `label`, never a block number
//   syntax.labels                  a label definition at the head of a block: `LOOP_A:`
//   syntax.systemVariables         read before `variables`, so `VZOFZ` is not `V` + a
//                                  value and `$AA_IM` not `$` + letters
//   syntax.assignment              an address that takes `=` and an expression: `SB=1200`
//   syntax.calls                   an identifier in front of `(` (a name also with blanks
//                                  between the two): one `call` token
//
// The M8 integration adds a seventh, opt-in like the others (§7.16):
//
//   syntax.names                   a name the program gives itself (`XBOT`, `LOOP_A`,
//                                  Okuma `DIA1`): one `unknown` token, never a run of
//                                  one-letter words, and a keyword only where the name at
//                                  its position is no longer than the keyword
//
// Phase 2 adds one more for the ISO dialects, opt-in the same way (§7.16):
//
//   syntax.programNames            a program name in place of a program number (Fanuc
//                                  `<SHAFT_T12>`, at the head of a program and behind
//                                  `M98`/`G65`): one `programMarker`, wherever it stands
//
// Token shapes that the contract in `types.ts` leaves open, decided here:
//
//   - A value without an address (`GOTO 100`'s target, `LBL 1`'s number, `BLK FORM 0.1`'s
//     sub-index, the right-hand side of `Q1 = 5`) is a `word` with no `address`.
//   - A `label` carries the name in `address` without the punctuation that marks it, so
//     `NLAP1` reports `LAP1` (the block-number prefix is the prefix, exactly as a block
//     number reports its digits) and `LOOP_A:` reports `LOOP_A`. A file header carries no
//     `address` and no value: what the program is called is `program.start`'s answer.
//     A program name (`<SHAFT_T12>`, `syntax.programNames`) is the same: a `programMarker`
//     with neither, at the head of a line and behind a call word alike.
//   - A variable keeps its own rule in front of `assignment`, which is the rule order both
//     dialects propose for themselves: `R1=R2*2` and `V5=V5+1` set a parameter and read
//     `R1`/`V5` as variables, exactly as Fanuc `#1=#2-5` and Klartext `Q200=2` already do,
//     instead of inventing an address the code database has never heard of. `F=R1` is an
//     address with a value that is not a literal, which is the case that matters: nothing
//     may scale it.
//   - A declared keyword wins over `assignment` and over `calls`, so a profile that lists
//     `IF` keeps `IF(…)` a conditional. An identifier the profile does not list, in front
//     of `(`, is a `call`. A name (`syntax.names`) may stand apart from its bracket by
//     blanks: the control reads `MSG ("TEXT")` and `CYCLE840 (…)` as it reads
//     `MSG("TEXT")`, and a cycle the tokenizer missed would be a cycle no script checks. A
//     word of one letter and a number is a call only with the bracket touching it
//     (`L10(1)`), so `M30 (END)` in a program written for another control stays an `M30`.
//   - An assignment address is one identifier (letters, digits and `_`), the whole of it:
//     the pattern of `syntax.assignment` decides which identifiers take an `=`, and it is
//     only asked where an identifier has an `=` behind it. That is what an address is, and
//     it keeps a long run of packed words (`G1X1G1X1…`) linear.
//   - A pattern that matches nothing (`R?\d*` on a letter) finds nothing: an empty match
//     of `variables` or `systemVariables` is no match, so the scanner always advances.
//   - A keyword may carry a value when the dialect packs words and a number follows it
//     directly, so `GOTO100` is one token with `address: 'GOTO'`. That is what
//     `numbering.references` means when it lists `GOTO` as an address (WP4.2).
//   - `address` is upper case (the canonical keyword text for a keyword), `text` is what
//     the file says. `valueText` is the value without the whitespace a packed dialect
//     allows between an address and its value, so `X 50` has `valueText: '50'`.
//   - A bracket expression is one `expression` token, however deeply it nests; a string is
//     one `string` token. Neither is tokenized inside.
//   - A `,` that a letter follows is part of the address (`,R1.`, `,C2.`).
//   - Whitespace is a token, so the tokens cover the line without a gap.
//   - Anything else is `unknown`, never `invalid`: marking errors is the linter's job.
//     Where words are separated, a whole word that does not split into an address and a
//     value is one `unknown` token (a program name, a path), not a letter each. Where the
//     profile declares `syntax.names`, a name is one `unknown` token in a packed dialect
//     too, for the same reason: `IF XNOW<=XBOT GOTOF LAST_CUT` read letter by letter is a
//     string of X, T and S words that a hover would explain and a transform would pull
//     apart with spaces. Such a name also ends an operand, like a variable.
//   - A block-skip level is one digit, `0` included: Sinumerik writes `/0` for the level
//     that `/` means (syntax-sinumerik §3.1), and the block number behind it stays one.
//
// Two program markers are not in any profile field and are read from the punched-tape
// convention instead: `%` as the first character of a line, unless the profile uses `%`
// for a comment or a block skip, and `:1234` beside `O1234` where the profile numbers
// blocks with a prefix. Everything else comes from `program.start`.
//
// Performance budget: 300k lines in under 1 s in node. The per-profile work (keyword
// index, anchored variable pattern, comment markers) is done once in `lexSpec` and cached
// on the `CompiledProfile`; per line the tokenizer walks the string with `charCodeAt` and
// allocates one object per token.

import type { CompiledProfile } from '$lib/core/profiles/types';
import { parseNumber } from './numbers';
import type { BlockNumberInfo, LineState, NcToken, NumericLiteral, TokenizeResult } from './types';

const TAB = 0x09;
const SPACE = 0x20;
const QUOTE = 0x22;
const PERCENT = 0x25;
const PAREN_OPEN = 0x28;
const PAREN_CLOSE = 0x29;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const EQUALS = 0x3d;
const STAR = 0x2a;
const BRACKET_OPEN = 0x5b;
const BRACKET_CLOSE = 0x5d;
const UNDERSCORE = 0x5f;
const NO_CHAR = -1;

/** Characters that may stand between two tokens. */
function isSpace(code: number): boolean {
  return code === SPACE || code === TAB || code === 0x0b || code === 0x0c || code === 0xa0;
}

function isDigit(code: number): boolean {
  return code >= ZERO && code <= NINE;
}

function isLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function toUpper(code: number): number {
  return code >= 0x61 && code <= 0x7a ? code - 32 : code;
}

/** Operators, minus whatever the profile uses to delimit a comment. */
const OPERATOR_CHARS = '=+-*/^%:<>|&,()!';

interface CommentMarker {
  start: string;
  end: string | null;
  code: number;
}

interface KeywordEntry {
  /** Upper case, one space between the parts; this is what a token reports as `address`. */
  canonical: string;
  parts: string[];
  /** A one-letter keyword (`L`, `C`) needs whitespace or the line end behind it. */
  single: boolean;
}

/** Everything the scanner needs from a profile, derived once per `CompiledProfile`. */
interface LexSpec {
  packed: boolean;
  caseSensitive: boolean;
  comments: CommentMarker[];
  /** True when `"` opens a string in this dialect (Klartext tool and label names). */
  strings: boolean;
  blockNumberMode: 'prefix' | 'leading-integer';
  blockNumberPrefixes: string[];
  skip: { codes: number[]; before: boolean; after: boolean; levels: boolean } | null;
  keywords: Map<number, KeywordEntry[]>;
  /** `syntax.variables`, sticky, so it can be tried at a position without slicing. */
  variables: RegExp | null;
  /** The literal first character of `syntax.variables`, for the Fanuc `#[…]` form. */
  variableLead: number;
  continuation: RegExp | null;
  sectionHeading: RegExp | null;
  programStart: RegExp[];
  /** Upper-case `syntax.incrementalPrefix`. */
  incremental: number;
  decimalPoint: number;
  /** `syntax.decimalSeparatorAlt` (the Klartext decimal comma), or `NO_CHAR` when unset. */
  decimalPointAlt: number;
  operators: Set<number>;
  /** `%` at the head of a line is a tape marker unless the profile uses it otherwise. */
  tapeMarker: boolean;
  /** `:1234` as a program number, the punched-tape form of `O1234`. */
  colonProgram: boolean;
  /** P8 `syntax.sequenceNames`: the block-number prefix also names blocks (`NLAP1`). */
  sequenceNames: boolean;
  /** P8 `syntax.labels`, with `d` so the `name` group's position is known. */
  labels: RegExp | null;
  /** P8 `syntax.header`, anchored by the profile at the start of the line. */
  header: RegExp | null;
  /** P8 `syntax.systemVariables`, sticky, like `variables`. */
  systemVariables: RegExp | null;
  /** P8 `syntax.assignment`, sticky: the address in front of an `=`. */
  assignment: RegExp | null;
  /** P8 `syntax.calls`: an identifier in front of `(` is one token (`argumentListAt`). */
  calls: boolean;
  /** M8 integration `syntax.names`, sticky: a name the program gives itself is one token. */
  names: RegExp | null;
  /** Phase 2 `syntax.programNames`, sticky: a program name (`<SHAFT_T12>`) is one token. */
  programNames: RegExp | null;
  /** The literal first character of `syntax.programNames` (`<`), so it is tried only there. */
  programNameLead: number;
  /**
   * `mask.ts`'s whole-line fast path: a global pattern of every character that can start
   * something the mask changes (a comment marker, `"` when the profile has strings, the
   * program-name lead). `null` when `programNames` cannot be reduced to a literal lead
   * character (a regex marker) — the fast path is unsafe there, so `mask.ts` always takes
   * the character loop for that profile. A profile with nothing at all to mask still gets
   * a real pattern, one that matches nothing (`/[]/g`), so the fast path applies to it too.
   *
   * @internal Shared with `mask.ts`, built once here because comment markers and the
   * program-name lead are already computed in this function.
   */
  maskLeadPattern: RegExp | null;
}

const SPECS = new WeakMap<CompiledProfile, LexSpec>();

function buildSpec(cp: CompiledProfile): LexSpec {
  const syntax = cp.profile.syntax ?? ({} as CompiledProfile['profile']['syntax']);
  const caseSensitive = syntax.caseSensitive === true;

  const comments: CommentMarker[] = [];
  for (const raw of syntax.comments ?? []) {
    if (!raw || typeof raw.start !== 'string' || raw.start === '') continue;
    comments.push({ start: raw.start, end: typeof raw.end === 'string' && raw.end !== '' ? raw.end : null, code: toUpper(raw.start.charCodeAt(0)) });
  }

  const keywords = new Map<number, KeywordEntry[]>();
  for (const keyword of cp.keywords) {
    const parts = keyword.split(/\s+/).filter((part) => part !== '');
    if (parts.length === 0) continue;
    const code = toUpper(keyword.charCodeAt(0));
    const group = keywords.get(code);
    const entry: KeywordEntry = { canonical: parts.join(' '), parts, single: keyword.length === 1 };
    if (group) group.push(entry);
    else keywords.set(code, [entry]);
  }

  const blockSkip = syntax.blockSkip;
  const position = blockSkip?.position ?? 'either';
  const skip =
    blockSkip && typeof blockSkip.chars === 'string' && blockSkip.chars !== ''
      ? {
          codes: [...blockSkip.chars].map((char) => char.charCodeAt(0)),
          before: position === 'before-number' || position === 'either',
          after: position === 'after-number' || position === 'either',
          levels: blockSkip.levels === true,
        }
      : null;

  const operators = new Set<number>();
  for (const char of OPERATOR_CHARS) {
    const code = char.charCodeAt(0);
    if (comments.some((marker) => marker.start.charCodeAt(0) === code || marker.end?.charCodeAt(0) === code)) continue;
    operators.add(code);
  }

  const variablePattern = syntax.variables;
  const lead = typeof variablePattern === 'string' && /^[^\\^$.|?*+()[\]{}]/.test(variablePattern) ? variablePattern.charCodeAt(0) : NO_CHAR;

  const prefix = syntax.blockNumber?.prefix;
  const prefixes = [prefix, ...(syntax.blockNumber?.altPrefixes ?? [])].filter(
    (value): value is string => typeof value === 'string' && value !== '',
  );

  // Compiled here rather than in `compile.ts`, which this field has not reached yet; the
  // spec is built once per compiled profile, so it is still compiled once.
  const programNameSource = typeof syntax.programNames === 'string' && syntax.programNames !== '' ? syntax.programNames : null;
  const programNames = programNameSource === null ? null : new RegExp(programNameSource, `${cp.flags}y`);
  const programNameLead =
    programNameSource !== null && /^[^\\^$.|?*+()[\]{}]/.test(programNameSource) ? programNameSource.charCodeAt(0) : NO_CHAR;

  const commentLeads = new Set(comments.map((marker) => marker.code));
  const skipCodes = new Set(skip?.codes ?? []);

  const maskLeadPattern = buildMaskLeadPattern(comments, syntax.strings === true, programNameSource, programNameLead);

  return {
    packed: syntax.wordSeparatorRequired !== true,
    caseSensitive,
    comments,
    strings: syntax.strings === true,
    blockNumberMode: syntax.blockNumber?.mode === 'leading-integer' ? 'leading-integer' : 'prefix',
    blockNumberPrefixes: prefixes,
    skip,
    keywords,
    variables: cp.re.variables ? new RegExp(cp.re.variables.source, `${cp.flags}y`) : null,
    variableLead: lead,
    continuation: cp.re.continuation ?? null,
    sectionHeading: cp.re.sectionHeading ?? null,
    programStart: cp.re.programStart,
    incremental: typeof syntax.incrementalPrefix === 'string' && syntax.incrementalPrefix.length === 1 ? toUpper(syntax.incrementalPrefix.charCodeAt(0)) : NO_CHAR,
    decimalPoint: (syntax.decimalSeparator ?? '.').charCodeAt(0),
    decimalPointAlt: typeof syntax.decimalSeparatorAlt === 'string' && syntax.decimalSeparatorAlt.length === 1 ? syntax.decimalSeparatorAlt.charCodeAt(0) : NO_CHAR,
    operators,
    tapeMarker: !commentLeads.has(PERCENT) && !skipCodes.has(PERCENT),
    colonProgram: syntax.blockNumber?.mode !== 'leading-integer' && !commentLeads.has(COLON),
    sequenceNames: syntax.sequenceNames === true,
    // `d` gives the offsets of the `name` group, so the label token can start where the
    // name starts although the pattern carries the block skip and the block number in
    // front of it (`/1 N10 LOOP_A:`).
    labels: cp.re.labels ? new RegExp(cp.re.labels.source, `${cp.flags}d`) : null,
    header: cp.re.header ?? null,
    systemVariables: cp.re.systemVariables ? new RegExp(cp.re.systemVariables.source, `${cp.flags}y`) : null,
    assignment: cp.re.assignment ? new RegExp(cp.re.assignment.source, `${cp.flags}y`) : null,
    calls: syntax.calls === true,
    names: cp.re.names ? new RegExp(cp.re.names.source, `${cp.flags}y`) : null,
    programNames,
    programNameLead,
    maskLeadPattern,
  };
}

/** Escapes a character for use inside a `[...]` character class. */
function escapeForCharClass(char: string): string {
  return /[\]\\^-]/.test(char) ? `\\${char}` : char;
}

/**
 * Builds `LexSpec.maskLeadPattern` (see its doc comment): a global character-class pattern
 * of every character that can start a span `mask.ts` changes, or `null` when the
 * program-name pattern has no literal lead character to add to it.
 *
 * A comment marker's lead goes in both cases, because `commentAt` compares case-folded
 * (`toUpper` on both sides); the program-name lead goes in exactly as it is, because
 * `programNameEndAt` compares it raw, with no case folding — mirroring that quirk is what
 * keeps the fast path byte-identical to the loop it replaces.
 */
function buildMaskLeadPattern(
  comments: CommentMarker[],
  strings: boolean,
  programNameSource: string | null,
  programNameLead: number,
): RegExp | null {
  if (programNameSource !== null && programNameLead === NO_CHAR) return null;

  const leads = new Set<number>();
  for (const marker of comments) {
    leads.add(marker.code);
    leads.add(marker.code >= 0x41 && marker.code <= 0x5a ? marker.code + 32 : marker.code);
  }
  if (strings) leads.add(QUOTE);
  if (programNameSource !== null) leads.add(programNameLead);

  if (leads.size === 0) return /[]/g; // nothing this profile masks ever starts a span

  const chars = [...leads].map((code) => escapeForCharClass(String.fromCharCode(code))).join('');
  return new RegExp(`[${chars}]`, 'g');
}

/**
 * The scanner's view of a profile, built once and cached on the compiled profile.
 *
 * @internal Shared with `mask.ts`, which has to blank exactly the spans this tokenizer
 * reads as comments. Not part of §7.4.
 */
export function lexSpec(cp: CompiledProfile): LexSpec {
  let spec = SPECS.get(cp);
  if (!spec) {
    spec = buildSpec(cp);
    SPECS.set(cp, spec);
  }
  return spec;
}

export type { CommentMarker, LexSpec };

/** Compares `literal` against the line at `p`, honouring the profile's case rule. */
function matchLiteral(line: string, p: number, literal: string, caseSensitive: boolean): boolean {
  if (p + literal.length > line.length) return false;
  for (let i = 0; i < literal.length; i++) {
    const a = line.charCodeAt(p + i);
    const b = literal.charCodeAt(i);
    if (a === b) continue;
    if (caseSensitive || toUpper(a) !== toUpper(b)) return false;
  }
  return true;
}

/** The comment marker that starts at `p`, or null. */
export function commentAt(line: string, p: number, spec: LexSpec): CommentMarker | null {
  const code = toUpper(line.charCodeAt(p));
  for (const marker of spec.comments) {
    if (marker.code !== code) continue;
    if (matchLiteral(line, p, marker.start, spec.caseSensitive)) return marker;
  }
  return null;
}

/**
 * Where the comment that starts at `p` ends (exclusive).
 *
 * A comment with an end marker stops at the first one and runs to `limit` when it is
 * missing, which is what an unclosed `(` does. A comment without an end marker runs to
 * `limit` as well, but gives back its trailing whitespace, so a Klartext `; TEXT ~` keeps
 * the continuation marker outside the comment.
 *
 * @internal Shared with `mask.ts`.
 */
export function commentEndAt(line: string, p: number, limit: number, marker: CommentMarker, spec: LexSpec): number {
  if (marker.end === null) {
    let end = limit;
    while (end > p && isSpace(line.charCodeAt(end - 1))) end--;
    return end;
  }
  for (let i = p + marker.start.length; i <= limit - marker.end.length; i++) {
    if (matchLiteral(line, i, marker.end, spec.caseSensitive)) return i + marker.end.length;
  }
  return limit;
}

/** Where the string that starts at `p` ends (exclusive); an unclosed one runs to `limit`. */
function stringEndAt(line: string, p: number, limit: number): number {
  for (let i = p + 1; i < limit; i++) if (line.charCodeAt(i) === QUOTE) return i + 1;
  return limit;
}

/** True for the first character of an identifier: a letter or `_`. */
function isIdentifierStart(code: number): boolean {
  return isLetter(code) || code === UNDERSCORE;
}

/** End of the identifier at `p` (`CYCLE81`, `LOOP_A`), or `p` when there is none. */
function identifierEndAt(line: string, p: number, limit: number): number {
  if (p >= limit || !isIdentifierStart(line.charCodeAt(p))) return p;
  let i = p + 1;
  while (i < limit) {
    const code = line.charCodeAt(i);
    if (!isLetter(code) && !isDigit(code) && code !== UNDERSCORE) break;
    i++;
  }
  return i;
}

/** The first position at or behind `p` that is not whitespace, `limit` at the latest. */
function skipSpace(line: string, p: number, limit: number): number {
  let i = p;
  while (i < limit && isSpace(line.charCodeAt(i))) i++;
  return i;
}

/**
 * End of the name at `p` (`syntax.names`: `XBOT`, `LOOP_A`, `DIA1`), or `p` when the
 * profile declares no names or none starts there.
 */
function nameEndAt(line: string, p: number, limit: number, spec: LexSpec): number {
  if (!spec.names || p >= limit) return p;
  spec.names.lastIndex = p;
  const match = spec.names.exec(line);
  if (!match || match.index !== p || match[0].length === 0) return p;
  return Math.min(p + match[0].length, limit);
}

/**
 * End of the program name at `p` (`syntax.programNames`: `<SHAFT_T12>`), or `p` when the
 * profile declares none or none starts there.
 *
 * @internal Shared with `mask.ts`, which masks exactly the names this tokenizer reads.
 */
export function programNameEndAt(line: string, p: number, limit: number, spec: LexSpec): number {
  const re = spec.programNames;
  if (re === null || p >= limit) return p;
  if (spec.programNameLead !== NO_CHAR && line.charCodeAt(p) !== spec.programNameLead) return p;
  re.lastIndex = p;
  const match = re.exec(line);
  if (!match || match.index !== p || match[0].length === 0 || p + match[0].length > limit) return p;
  return p + match[0].length;
}

/**
 * Where the argument list of the identifier `[p, identifierEnd)` opens, or -1 when it is
 * not a call.
 *
 * The `(` stands right behind the identifier (`CYCLE81(…)`, `L10(1)`), or behind blanks
 * when the identifier is a name the profile declares (`syntax.names`): `MSG ("TEXT")`,
 * `CYCLE840 (…)`. A word of one letter and a number keeps its bracket touching it to be a
 * call, so `M30 (END)` in a program written for another control stays the `M30` it says.
 * `afterBlanks` is the first position behind the identifier that is not whitespace.
 */
function argumentListAt(
  line: string,
  p: number,
  identifierEnd: number,
  afterBlanks: number,
  limit: number,
  spec: LexSpec,
): number {
  if (afterBlanks >= limit || line.charCodeAt(afterBlanks) !== PAREN_OPEN) return -1;
  if (afterBlanks === identifierEnd) return afterBlanks;
  return nameEndAt(line, p, limit, spec) === identifierEnd ? afterBlanks : -1;
}

/**
 * Where the argument list that starts at the `(` at `p` ends (exclusive).
 *
 * Parentheses nest, and a `)` inside a string does not close the list, which is what
 * holds `MSG("A;B")` together. A comment marker outside a string ends the list where it
 * stands, so an unclosed `(` can never swallow a comment — the tokenizer and `mask.ts`
 * have to agree on where a comment begins, whatever the line looks like.
 */
function argumentsEndAt(line: string, p: number, limit: number, spec: LexSpec): number {
  let depth = 0;
  for (let i = p; i < limit; i++) {
    const code = line.charCodeAt(i);
    if (spec.strings && code === QUOTE) {
      i = stringEndAt(line, i, limit) - 1;
      continue;
    }
    if (i > p && spec.comments.length > 0 && commentAt(line, i, spec)) return i;
    if (code === PAREN_OPEN) depth++;
    else if (code === PAREN_CLOSE && --depth === 0) return i + 1;
  }
  return limit;
}

/** Where the bracket expression that starts at `p` ends (exclusive); brackets may nest. */
function expressionEndAt(line: string, p: number, limit: number): number {
  let depth = 0;
  for (let i = p; i < limit; i++) {
    const code = line.charCodeAt(i);
    if (code === BRACKET_OPEN) depth++;
    else if (code === BRACKET_CLOSE && --depth === 0) return i + 1;
  }
  return limit;
}

/**
 * End of the number that starts at `p`, or `p` when there is none (a sign is not one).
 *
 * `decimalPointAlt` (the Klartext decimal comma, §7.16 / R4) starts a fraction exactly as
 * `decimalPoint` does; which mark it was does not matter here — `readValue` decides that
 * once, from the text this scans, and only when the strict parse of it fails.
 */
function numberEndAt(line: string, p: number, limit: number, spec: LexSpec): number {
  let i = p;
  let digits = false;
  while (i < limit && isDigit(line.charCodeAt(i))) {
    i++;
    digits = true;
  }
  if (i < limit && (line.charCodeAt(i) === spec.decimalPoint || line.charCodeAt(i) === spec.decimalPointAlt)) {
    const afterPoint = i + 1;
    let j = afterPoint;
    while (j < limit && isDigit(line.charCodeAt(j))) j++;
    if (digits || j > afterPoint) {
      digits = true;
      i = j;
    }
  }
  return digits ? i : p;
}

interface ValueRead {
  end: number;
  text: string;
  value: NumericLiteral | null;
}

/**
 * `parseNumber`, plus the Klartext decimal comma (§7.16 / R4): retried with
 * `decimalPointAlt` read as the point when the strict parse fails.
 *
 * `parseNumber` itself stays exactly the contract it always was — `.` only, no comma, no
 * profile — so `numbers.ts` never widens what a number is for every other dialect. `text`
 * only ever carries a comma here because `numberEndAt` already decided, from the
 * profile's own `decimalSeparatorAlt`, that this text is a number; the retry just reads
 * the digits it already agreed to. The result keeps `text` as `raw`, comma included, so
 * `formatNumber` can tell which separator to write back.
 */
function parseValue(text: string, spec: LexSpec): NumericLiteral | null {
  const value = parseNumber(text);
  if (value !== null || spec.decimalPointAlt === NO_CHAR) return value;
  const alt = String.fromCharCode(spec.decimalPointAlt);
  if (!text.includes(alt)) return null;
  const normalized = parseNumber(text.split(alt).join('.'));
  return normalized === null ? null : { ...normalized, raw: text };
}

/**
 * Reads the value of a word at `p`: a number, a variable, a bracket expression, each with
 * an optional sign. `allowLoneSign` accepts a sign on its own, which is how Klartext
 * writes a rotation direction (`DR-`).
 */
function readValue(line: string, p: number, limit: number, spec: LexSpec, allowLoneSign: boolean): ValueRead | null {
  if (p >= limit) return null;
  const first = line.charCodeAt(p);
  const signed = first === PLUS || first === MINUS;
  const start = signed ? p + 1 : p;

  const numberEnd = numberEndAt(line, start, limit, spec);
  if (numberEnd > start) {
    const text = line.slice(p, numberEnd);
    return { end: numberEnd, text, value: parseValue(text, spec) };
  }

  if (spec.variables && start < limit) {
    spec.variables.lastIndex = start;
    const match = spec.variables.exec(line);
    // An empty match is no variable: `R?\d*` matches nothing in front of every letter.
    if (match && match.index === start && match[0].length > 0 && start + match[0].length <= limit) {
      const end = start + match[0].length;
      return { end, text: line.slice(p, end), value: null };
    }
  }

  if (start < limit && line.charCodeAt(start) === BRACKET_OPEN) {
    const end = expressionEndAt(line, start, limit);
    return { end, text: line.slice(p, end), value: null };
  }

  if (signed && allowLoneSign) return { end: p + 1, text: line.slice(p, p + 1), value: null };
  return null;
}

/** End of the whitespace-delimited chunk that starts at `p` (a comment or `"` ends it too). */
function chunkEndAt(line: string, p: number, limit: number, spec: LexSpec): number {
  let i = p;
  while (i < limit) {
    const code = line.charCodeAt(i);
    if (isSpace(code) || (spec.strings && code === QUOTE)) break;
    if (spec.comments.length > 0 && commentAt(line, i, spec)) break;
    i++;
  }
  return i;
}

/**
 * End of the value behind an `=` (exclusive), or `r` when the address takes none.
 *
 * A string, a bracket expression and a call are taken whole, because none of them may be
 * cut at a space; anything else runs to the end of the word, so `X=V1+V2` keeps its
 * expression together while `SB=1200 M13` stops in front of `M13`. A comment behind the
 * `=` ends the value, so `X= (SET LATER)` is an address without one. A call is read here
 * as everywhere else, blanks in front of its bracket included (`X=AC (10)`).
 */
function assignedValueEndAt(line: string, r: number, limit: number, spec: LexSpec): number {
  if (r >= limit) return r;
  const code = line.charCodeAt(r);
  if (spec.strings && code === QUOTE) return stringEndAt(line, r, limit);
  if (code === BRACKET_OPEN) return expressionEndAt(line, r, limit);
  if (spec.calls) {
    const nameEnd = identifierEndAt(line, r, limit);
    const open = nameEnd > r ? argumentListAt(line, r, nameEnd, skipSpace(line, nameEnd, limit), limit, spec) : -1;
    if (open >= 0) return argumentsEndAt(line, open, limit, spec);
  }
  return chunkEndAt(line, r, limit, spec);
}

interface BlockNumberScan {
  start: number;
  end: number;
  digitsStart: number;
  prefix: string;
}

/** The block number at `p`, when the profile's rule finds one there. */
function scanBlockNumber(line: string, p: number, limit: number, spec: LexSpec): BlockNumberScan | null {
  if (spec.blockNumberMode === 'leading-integer') {
    let i = p;
    while (i < limit && isDigit(line.charCodeAt(i))) i++;
    if (i === p) return null;
    if (i < limit) {
      const next = line.charCodeAt(i);
      // A leading integer is a block number only when the block starts after it.
      if (!isSpace(next) && !(spec.skip?.after === true && spec.skip.codes.includes(next))) return null;
    }
    return { start: p, end: i, digitsStart: p, prefix: '' };
  }

  for (const prefix of spec.blockNumberPrefixes) {
    if (!matchLiteral(line, p, prefix, spec.caseSensitive)) continue;
    let i = p + prefix.length;
    while (i < limit && isSpace(line.charCodeAt(i))) i++;
    const digitsStart = i;
    while (i < limit && isDigit(line.charCodeAt(i))) i++;
    if (i === digitsStart) continue;
    return { start: p, end: i, digitsStart, prefix };
  }
  return null;
}

/**
 * The sequence *name* at `p` (`NLAP1`), on a profile whose block-number prefix names
 * blocks as well as numbering them (`syntax.sequenceNames`).
 *
 * A name is the prefix, a letter, up to three more letters or digits, and a separator or
 * the end of the block behind it. The separator is what the control insists on, and it is
 * what keeps this rule off ordinary code: `N100G0` stays a numbered block and `NLAP1G85`
 * is not a name at all. A name is never a block number, so renumbering never rewrites one.
 */
function scanSequenceName(line: string, p: number, limit: number, spec: LexSpec): { start: number; end: number; nameStart: number } | null {
  if (!spec.sequenceNames) return null;
  for (const prefix of spec.blockNumberPrefixes) {
    if (!matchLiteral(line, p, prefix, spec.caseSensitive)) continue;
    const nameStart = p + prefix.length;
    if (nameStart >= limit || !isLetter(line.charCodeAt(nameStart))) continue;
    let i = nameStart + 1;
    while (i < limit && i - nameStart < 4) {
      const code = line.charCodeAt(i);
      if (!isLetter(code) && !isDigit(code)) break;
      i++;
    }
    if (i < limit && !isSpace(line.charCodeAt(i))) continue;
    return { start: p, end: i, nameStart };
  }
  return null;
}

/**
 * The label definition of the line (`LOOP_A:`), as the span of its `name` group and the
 * end of the whole match, or null.
 *
 * The pattern is anchored at the start of the line and carries the block skip and the
 * block number in front of the name, because a label may itself start with the
 * block-number prefix (`NEXT_PART:`) and has to be recognised before it. One `exec` per
 * line answers both positions a label may stand in: in front of a block number and behind
 * one.
 */
function labelSpanOf(line: string, spec: LexSpec): { start: number; end: number; name: string } | null {
  if (!spec.labels) return null;
  const match = spec.labels.exec(line);
  if (!match || match.index !== 0) return null;
  const at = match.indices?.groups?.name;
  const name = match.groups?.name;
  if (!at || typeof name !== 'string' || name === '') return null;
  return { start: at[0], end: match[0].length, name };
}

/** End of the block-skip mark at `p`, or `p` when there is none. */
function scanSkip(line: string, p: number, limit: number, spec: LexSpec): number {
  const skip = spec.skip;
  if (!skip || p >= limit || !skip.codes.includes(line.charCodeAt(p))) return p;
  let end = p + 1;
  if (skip.levels && end < limit) {
    // `/0` is a level too (Sinumerik writes it for the level `/` means), so the block
    // number behind it is still read as one.
    const level = line.charCodeAt(end);
    if (level >= ZERO && level <= NINE) end++;
  }
  return end;
}

/** The keyword that starts at `p`, with the position behind it. */
function matchKeyword(line: string, p: number, limit: number, spec: LexSpec): { end: number; entry: KeywordEntry } | null {
  const group = spec.keywords.get(toUpper(line.charCodeAt(p)));
  if (!group) return null;

  for (const entry of group) {
    let q = p;
    let ok = true;
    for (let i = 0; i < entry.parts.length; i++) {
      if (i > 0) {
        let after = q;
        while (after < limit && isSpace(line.charCodeAt(after))) after++;
        if (after === q) {
          ok = false;
          break;
        }
        q = after;
      }
      const part = entry.parts[i];
      if (q + part.length > limit || !matchLiteral(line, q, part, spec.caseSensitive)) {
        ok = false;
        break;
      }
      q += part.length;
    }
    if (!ok) continue;

    // A packed dialect writes `GOTO100`, so only a letter behind the keyword rules it
    // out. Where words are separated, a one-letter keyword needs a separator, or the
    // Klartext C axis (`C+45`) and a tool length (`L+10`) would become path functions.
    if (q < limit) {
      const next = line.charCodeAt(q);
      const separated = !spec.packed && entry.single;
      if (separated ? !isSpace(next) : isLetter(next)) continue;
    }
    return { end: q, entry };
  }
  return null;
}

/** A program number or tape marker at the head of a line; returns its end, or `p`. */
function matchProgramMarker(line: string, p: number, limit: number, spec: LexSpec): number {
  const code = line.charCodeAt(p);
  if (spec.tapeMarker && code === PERCENT) return p + 1;

  if (spec.colonProgram && code === COLON) {
    let i = p + 1;
    while (i < limit && isDigit(line.charCodeAt(i))) i++;
    if (i > p + 1) return i;
  }

  if (isLetter(code)) {
    for (const re of spec.programStart) {
      const match = re.exec(line);
      if (!match || match.index !== 0) continue;
      const end = match[0].length;
      let start = 0;
      while (start < end && isSpace(line.charCodeAt(start))) start++;
      if (start === p && end > p && end <= limit) return end;
    }
  }
  return p;
}

/** True when a `+` or `-` behind these tokens joins two operands instead of signing one. */
function endsOperand(tokens: NcToken[], spec: LexSpec): boolean {
  let i = tokens.length - 1;
  while (i >= 0 && tokens[i].kind === 'whitespace') i--;
  const token = i >= 0 ? tokens[i] : undefined;
  if (!token) return false;
  switch (token.kind) {
    case 'word':
    case 'variable':
    case 'expression':
    case 'string':
    case 'blockNumber':
    // A call gives a value back, so `SETVAL(1)-2` subtracts instead of starting a
    // negative one. A label does not, and it is not in this list.
    case 'call':
      return true;
    // A name (`syntax.names`) is a value like a variable, so `XNOW-2` subtracts. Any
    // other unknown token is not an operand; a name is the one that starts like a name.
    case 'unknown':
      return spec.names !== null && nameEndAt(token.text, 0, token.text.length, spec) > 0;
    default:
      return false;
  }
}

function push(tokens: NcToken[], kind: NcToken['kind'], line: string, start: number, end: number): NcToken {
  const token: NcToken = { kind, start, end, text: line.slice(start, end) };
  tokens.push(token);
  return token;
}

/** Adds an unknown token, merging it with the one before when they touch. */
function pushUnknown(tokens: NcToken[], line: string, start: number, end: number): void {
  const last = tokens[tokens.length - 1];
  if (last && last.kind === 'unknown' && last.end === start) {
    last.end = end;
    last.text = line.slice(last.start, end);
    return;
  }
  push(tokens, 'unknown', line, start, end);
}

function pushSpace(tokens: NcToken[], line: string, p: number, limit: number): number {
  let end = p;
  while (end < limit && isSpace(line.charCodeAt(end))) end++;
  if (end > p) push(tokens, 'whitespace', line, p, end);
  return end;
}

/**
 * Puts the address and the value on a word token.
 *
 * The incremental prefix is only taken off a coordinate word — one or two letters behind
 * the prefix and a value behind those (`IX+10`, `IPA+360`) — so a program name such as
 * `INCHJOB` keeps all of its letters.
 */
function describeWord(token: NcToken, address: string, spec: LexSpec, value: ValueRead | null): void {
  let name = spec.caseSensitive ? address : address.toUpperCase();
  if (spec.incremental !== NO_CHAR && value && name.length >= 2 && name.length <= 3 && toUpper(name.charCodeAt(0)) === spec.incremental) {
    name = name.slice(1);
    token.incremental = true;
  }
  token.address = name;
  if (value) {
    token.valueText = value.text;
    token.value = value.value;
  }
}

/**
 * Tokenizes one line. `prev` is the state `tokenizeLine` returned for the line above;
 * leave it out for the first line of a document.
 */
export function tokenizeLine(line: string, cp: CompiledProfile, prev?: LineState): TokenizeResult {
  const spec = lexSpec(cp);
  const tokens: NcToken[] = [];

  // The continuation marker is found first: it is the line's tail, and a comment in front
  // of it must not swallow it.
  let limit = line.length;
  let continuationStart = -1;
  if (spec.continuation) {
    const match = spec.continuation.exec(line);
    if (match) {
      continuationStart = match.index;
      limit = match.index;
    }
  }

  let p = pushSpace(tokens, line, 0, limit);
  // A line that continues the one above carries no block number and no program marker.
  let atHead = prev?.continuation !== true;

  // `chunkEndAt` scans forward to the end of the chunk, so asking it once per character
  // makes a long unbroken run quadratic: 32k characters of `+-` in a word-separated
  // profile took over two seconds, and hover tokenizes a line on every mouse move. The
  // chunk end only changes when `p` leaves the chunk, and `p` never moves backwards, so
  // one scan per chunk is enough.
  let cachedChunkEnd = -1;
  const chunkFrom = (from: number): number => {
    if (from >= cachedChunkEnd) cachedChunkEnd = chunkEndAt(line, from, limit, spec);
    return cachedChunkEnd;
  };

  // The same holds for a run of letters, digits and underscores in a packed dialect. `p`
  // stops at every letter of `G1X1G1X1…`, and the `calls` and `assignment` rules both ask
  // where the identifier at `p` ends and what stands behind it: asked afresh at every
  // letter, 32k characters of such a run took three seconds on Sinumerik, and a script
  // needed nine for half as many. Every letter of a run has the same end and the same
  // character behind the blanks that follow it, so one scan per run answers them all.
  // Only ask at a letter or `_`: a digit inside a run starts no identifier.
  let runEnd = -1;
  let afterRun = -1;
  const identifierFrom = (from: number): number => {
    if (from >= runEnd) {
      runEnd = identifierEndAt(line, from, limit);
      afterRun = skipSpace(line, runEnd, limit);
    }
    return runEnd;
  };

  /** Pushes a label and the whitespace behind it, and returns the new position. */
  const pushLabel = (start: number, end: number, name: string): number => {
    const token = push(tokens, 'label', line, start, end);
    token.address = spec.caseSensitive ? name : name.toUpperCase();
    return pushSpace(tokens, line, end, limit);
  };

  // A file header is not an NC block: `$PART.MIN%` and `%_N_PART_MPF` are one marker, so
  // the `$` in front of it is not a hexadecimal constant and the `%` not a tape marker.
  if (atHead && spec.header && p === 0) {
    const match = spec.header.exec(line);
    if (match && match.index === 0 && match[0].length > 0) {
      const end = Math.min(match[0].length, limit);
      if (end > 0) {
        push(tokens, 'programMarker', line, 0, end);
        p = pushSpace(tokens, line, end, limit);
        atHead = false;
      }
    }
  }

  if (atHead) {
    if (spec.skip?.before === true) {
      const end = scanSkip(line, p, limit, spec);
      if (end > p) {
        push(tokens, 'skip', line, p, end);
        p = pushSpace(tokens, line, end, limit);
      }
    }
    // A label may start with the block-number prefix (`NEXT_PART:`), so it is read before
    // the block number — and once more behind one, because a block may carry both.
    const label = labelSpanOf(line, spec);
    if (label && label.start === p) {
      p = pushLabel(label.start, label.end, label.name);
      atHead = false;
    } else {
      const named = scanSequenceName(line, p, limit, spec);
      const block = named ? null : scanBlockNumber(line, p, limit, spec);
      if (named) {
        p = pushLabel(named.start, named.end, line.slice(named.nameStart, named.end));
        atHead = false;
      } else if (block) {
        const token = push(tokens, 'blockNumber', line, block.start, block.end);
        const digits = line.slice(block.digitsStart, block.end);
        if (block.prefix !== '') token.address = spec.caseSensitive ? block.prefix : block.prefix.toUpperCase();
        token.valueText = digits;
        token.value = parseNumber(digits);
        atHead = false;
        p = pushSpace(tokens, line, block.end, limit);
      }
      if (named || block) {
        if (spec.skip?.after === true) {
          const end = scanSkip(line, p, limit, spec);
          if (end > p) {
            push(tokens, 'skip', line, p, end);
            p = pushSpace(tokens, line, end, limit);
          }
        }
        if (label && label.start === p) p = pushLabel(label.start, label.end, label.name);
      }
    }
  }

  // A structure block (`12 * - ROUGHING`) is a heading; its text is read as a comment.
  if (spec.sectionHeading && p < limit && line.charCodeAt(p) === STAR && spec.sectionHeading.test(line)) {
    let end = limit;
    while (end > p && isSpace(line.charCodeAt(end - 1))) end--;
    push(tokens, 'comment', line, p, end);
    p = end;
  }

  while (p < limit) {
    const code = line.charCodeAt(p);
    if (isSpace(code)) {
      p = pushSpace(tokens, line, p, limit);
      continue;
    }
    const head = atHead;
    atHead = false;

    const marker = spec.comments.length > 0 ? commentAt(line, p, spec) : null;
    if (marker) {
      const end = commentEndAt(line, p, limit, marker, spec);
      push(tokens, 'comment', line, p, Math.max(end, p + 1));
      p = Math.max(end, p + 1);
      continue;
    }

    if (spec.strings && code === QUOTE) {
      const end = stringEndAt(line, p, limit);
      push(tokens, 'string', line, p, end);
      p = end;
      continue;
    }

    // A program name (`syntax.programNames`) is one program marker wherever it stands: at
    // the head of a program it is what `O1234` would be, behind `M98` or `G65` the program
    // called. The control reads the characters between the brackets like comment text, so
    // nothing in it is a word: letter by letter, `<SHAFT_F12>` held a feed a script would
    // scale into another program's name, and `<PART_T12>` a lathe tool change.
    const programNameEnd = programNameEndAt(line, p, limit, spec);
    if (programNameEnd > p) {
      push(tokens, 'programMarker', line, p, programNameEnd);
      p = programNameEnd;
      continue;
    }

    // Where the profile declares names, a keyword is only one when the name that starts
    // here is no longer than it: `LOOP_A` and `GOTO100` are names, `LOOP` and `GOTOF`
    // keywords, `IF[` still a conditional.
    const matched = matchKeyword(line, p, limit, spec);
    const keyword = matched && (spec.names === null || nameEndAt(line, p, limit, spec) <= matched.end) ? matched : null;
    if (keyword) {
      let end = keyword.end;
      let value: ValueRead | null = null;
      if (spec.packed) {
        // `GOTO100`, `DO1`, `END1`: the jump target belongs to the keyword, which is how
        // `numbering.references` addresses it. A `[` starts an expression of its own.
        let q = end;
        while (q < limit && isSpace(line.charCodeAt(q))) q++;
        const next = q < limit ? line.charCodeAt(q) : NO_CHAR;
        if (next !== NO_CHAR && (isDigit(next) || next === spec.decimalPoint || next === PLUS || next === MINUS)) {
          value = readValue(line, q, limit, spec, false);
          if (value) end = value.end;
        }
      }
      const token = push(tokens, 'keyword', line, p, end);
      token.address = keyword.entry.canonical;
      if (value) {
        token.valueText = value.text;
        token.value = value.value;
      }
      p = end;
      continue;
    }

    // An identifier written in front of `(` is one token, together with everything up to
    // the matching `)`. What the arguments mean is the cycle's business and not the
    // tokenizer's, and taking them in one piece is what keeps the `;` of `MSG("A;B")` out
    // of the comment rule. A keyword the profile declares was matched above, so `IF(…)`
    // is still a conditional and only an identifier the profile does not know is a call.
    // Blanks may stand between a name and its bracket (`CYCLE840 (…)`, `MSG ("…")`): the
    // control reads both spellings as the same call, and so do the grammar and the
    // detection rules. Read as a name and loose values, a tapping cycle would be one the
    // scripts never see (`argumentListAt`).
    if (spec.calls && isIdentifierStart(code)) {
      const nameEnd = identifierFrom(p);
      const open = argumentListAt(line, p, nameEnd, afterRun, limit, spec);
      if (open >= 0) {
        const end = argumentsEndAt(line, open, limit, spec);
        const token = push(tokens, 'call', line, p, end);
        const name = line.slice(p, nameEnd);
        token.address = spec.caseSensitive ? name : name.toUpperCase();
        const closed = end > open + 1 && line.charCodeAt(end - 1) === PAREN_CLOSE;
        const args = line.slice(open + 1, closed ? end - 1 : end);
        if (args !== '') token.valueText = args;
        p = end;
        continue;
      }
    }

    if (head) {
      const end = matchProgramMarker(line, p, limit, spec);
      if (end > p) {
        const token = push(tokens, 'programMarker', line, p, end);
        let i = p;
        while (i < end && isLetter(line.charCodeAt(i))) i++;
        if (i === p) i = p + 1; // `%`, `:`
        token.address = spec.caseSensitive ? line.slice(p, i) : line.slice(p, i).toUpperCase();
        if (i < end) {
          token.valueText = line.slice(i, end);
          token.value = parseNumber(token.valueText);
        }
        p = end;
        continue;
      }
    }

    // System variables come first, so Okuma's `VZOFZ` is not the common variable `V` with
    // a value behind it and Sinumerik's `$AA_IM` not a stray `$`. An empty match is no
    // match: a token of no characters would leave `p` where it is, forever.
    if (spec.systemVariables) {
      spec.systemVariables.lastIndex = p;
      const match = spec.systemVariables.exec(line);
      if (match && match.index === p && match[0].length > 0 && p + match[0].length <= limit) {
        p = push(tokens, 'variable', line, p, p + match[0].length).end;
        continue;
      }
    }

    if (spec.variables) {
      spec.variables.lastIndex = p;
      const match = spec.variables.exec(line);
      if (match && match.index === p && match[0].length > 0 && p + match[0].length <= limit) {
        p = push(tokens, 'variable', line, p, p + match[0].length).end;
        continue;
      }
    }
    // The indirect form `#[#1+1]`: the lead character on its own, then the expression.
    if (code === spec.variableLead && p + 1 < limit && line.charCodeAt(p + 1) === BRACKET_OPEN) {
      p = push(tokens, 'variable', line, p, p + 1).end;
      continue;
    }

    // An address that takes `=` and an expression (`SB=1200`, `CR=15`, `X=V1+V2`). The
    // token stays a word: the address is what stands in front of the `=`, and the value
    // is the text behind it — a literal only when the whole right-hand side is one, so
    // nothing that computes with NC numbers can ever scale `F=R1`.
    //
    // The address is the identifier at `p`, all of it, and the pattern is only asked where
    // that identifier has an `=` behind it (not the `==` of a comparison). The `=` is found
    // with the tokenizer's own whitespace rule, not with the pattern's lookahead.
    if (spec.assignment && isIdentifierStart(code)) {
      const nameEnd = identifierFrom(p);
      const q = afterRun;
      if (q < limit && line.charCodeAt(q) === EQUALS && line.charCodeAt(q + 1) !== EQUALS) {
        spec.assignment.lastIndex = p;
        const match = spec.assignment.exec(line);
        if (match && match.index === p && p + match[0].length === nameEnd) {
          const r = skipSpace(line, q + 1, limit);
          const valueEnd = assignedValueEndAt(line, r, limit, spec);
          const token = push(tokens, 'word', line, p, valueEnd > r ? valueEnd : q + 1);
          token.address = spec.caseSensitive ? match[0] : match[0].toUpperCase();
          if (valueEnd > r) {
            token.valueText = line.slice(r, valueEnd);
            token.value = parseNumber(token.valueText);
          }
          p = token.end;
          continue;
        }
      }
    }

    if (code === BRACKET_OPEN) {
      const end = expressionEndAt(line, p, limit);
      push(tokens, 'expression', line, p, end);
      p = end;
      continue;
    }

    // A sequence name is one token wherever it stands. At the head of a block it names
    // the block; behind a jump it names the block that is jumped to (`GOTO NLAP1`), and
    // there it has to stay in one piece, because letter by letter a name such as `NFED1`
    // would turn into a feed word that a script would then scale. A numbered target
    // (`GOTO N200`) stays an `N` word: that one a renumber does have to rewrite.
    //
    // Away from the head the name needs whitespace in front of it as well as behind it.
    // Packed words are read letter by letter, and without that rule the `NG` of a word
    // such as `NTOOLING` would become a name in the middle of another one.
    if (spec.sequenceNames && (p === 0 || isSpace(line.charCodeAt(p - 1)))) {
      const named = scanSequenceName(line, p, limit, spec);
      if (named) {
        const token = push(tokens, 'label', line, named.start, named.end);
        const name = line.slice(named.nameStart, named.end);
        token.address = spec.caseSensitive ? name : name.toUpperCase();
        p = named.end;
        continue;
      }
    }

    // A name the program gives itself (`syntax.names`): a variable, a jump target, a
    // subprogram called by its name. One token, so `XBOT` is no X word and `PASS2` no S
    // word of 2 — a hover would explain those letters and a transform would move them.
    // Every rule above has had its turn, so `XNOW=62` is still an assignment, `NAME(…)`
    // a call and `NLAP1` a label.
    if (spec.names) {
      const end = nameEndAt(line, p, limit, spec);
      if (end > p) {
        push(tokens, 'unknown', line, p, end);
        p = end;
        continue;
      }
    }

    if (spec.packed) {
      // One letter is the address; `,R` and `,C` take the comma with them.
      let addressEnd = NO_CHAR;
      if (isLetter(code)) addressEnd = p + 1;
      else if (code === COMMA && p + 1 < limit && isLetter(line.charCodeAt(p + 1))) addressEnd = p + 2;
      if (addressEnd !== NO_CHAR) {
        let q = addressEnd;
        while (q < limit && isSpace(line.charCodeAt(q))) q++;
        const value = readValue(line, q, limit, spec, false);
        const token = push(tokens, 'word', line, p, value ? value.end : addressEnd);
        describeWord(token, line.slice(p, addressEnd), spec, value);
        p = token.end;
        continue;
      }
    } else if (isLetter(code)) {
      const chunkEnd = chunkFrom(p);
      let letters = p;
      while (letters < chunkEnd && isLetter(line.charCodeAt(letters))) letters++;
      if (letters === chunkEnd) {
        const token = push(tokens, 'word', line, p, chunkEnd);
        describeWord(token, line.slice(p, chunkEnd), spec, null);
        p = chunkEnd;
        continue;
      }
      // The shortest address whose value fills the rest of the chunk wins, so `FQ50` is
      // the feed from Q50 while `DR-0.02` is a delta radius. Past the letters the address
      // may take digits with it, but only in front of a signed value, which is what tells
      // the delta radius of tool 2 (`DR2+0.05`) from a plain `DR2`.
      let digits = letters;
      while (digits < chunkEnd && isDigit(line.charCodeAt(digits))) digits++;
      let found: ValueRead | null = null;
      let split = NO_CHAR;
      for (let s = p + 1; s <= digits; s++) {
        if (s > letters) {
          const sign = line.charCodeAt(s);
          if (sign !== PLUS && sign !== MINUS) continue;
        }
        const value = readValue(line, s, chunkEnd, spec, true);
        if (value && value.end === chunkEnd) {
          found = value;
          split = s;
          break;
        }
      }
      if (found) {
        const token = push(tokens, 'word', line, p, chunkEnd);
        describeWord(token, line.slice(p, split), spec, found);
        p = chunkEnd;
        continue;
      }
      // Not a word at all: a program name, a path. One token, and on to the next chunk.
      pushUnknown(tokens, line, p, chunkEnd);
      p = chunkEnd;
      continue;
    }

    // A value without an address: a jump target, a label number, a right-hand side.
    if (
      isDigit(code) ||
      code === spec.decimalPoint ||
      code === spec.decimalPointAlt ||
      ((code === PLUS || code === MINUS) && !endsOperand(tokens, spec))
    ) {
      const stop = spec.packed ? limit : chunkFrom(p);
      const value = readValue(line, p, stop, spec, false);
      if (value) {
        const token = push(tokens, 'word', line, p, value.end);
        token.valueText = value.text;
        token.value = value.value;
        p = value.end;
        continue;
      }
    }

    if (spec.operators.has(code)) {
      p = push(tokens, 'operator', line, p, p + 1).end;
      continue;
    }

    pushUnknown(tokens, line, p, p + 1);
    p += 1;
  }

  if (continuationStart >= 0) {
    let end = line.length;
    while (end > continuationStart && isSpace(line.charCodeAt(end - 1))) end--;
    push(tokens, 'continuation', line, continuationStart, end);
    pushSpace(tokens, line, end, line.length);
  }

  return { tokens, state: { continuation: continuationStart >= 0 } };
}

/**
 * The block number of a line, or null when it has none. `start`/`end` cover the whole
 * block number including its prefix, so a renumber can replace exactly that span, while
 * `text` is the digits as they were written.
 */
export function blockNumberOf(line: string, cp: CompiledProfile): BlockNumberInfo | null {
  const spec = lexSpec(cp);
  const limit = line.length;

  let p = 0;
  while (p < limit && isSpace(line.charCodeAt(p))) p++;
  if (spec.skip?.before === true) {
    const end = scanSkip(line, p, limit, spec);
    if (end > p) {
      p = end;
      while (p < limit && isSpace(line.charCodeAt(p))) p++;
    }
  }

  const block = scanBlockNumber(line, p, limit, spec);
  if (!block) return null;

  const text = line.slice(block.digitsStart, block.end);
  return { value: Number.parseInt(text, 10), text, start: block.start, end: block.end };
}
