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
// Token shapes that the contract in `types.ts` leaves open, decided here:
//
//   - A value without an address (`GOTO 100`'s target, `LBL 1`'s number, `BLK FORM 0.1`'s
//     sub-index, the right-hand side of `Q1 = 5`) is a `word` with no `address`.
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
//     value is one `unknown` token (a program name, a path), not a letter each.
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
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const ZERO = 0x30;
const NINE = 0x39;
const COLON = 0x3a;
const STAR = 0x2a;
const BRACKET_OPEN = 0x5b;
const BRACKET_CLOSE = 0x5d;
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
  operators: Set<number>;
  /** `%` at the head of a line is a tape marker unless the profile uses it otherwise. */
  tapeMarker: boolean;
  /** `:1234` as a program number, the punched-tape form of `O1234`. */
  colonProgram: boolean;
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

  const commentLeads = new Set(comments.map((marker) => marker.code));
  const skipCodes = new Set(skip?.codes ?? []);

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
    operators,
    tapeMarker: !commentLeads.has(PERCENT) && !skipCodes.has(PERCENT),
    colonProgram: syntax.blockNumber?.mode !== 'leading-integer' && !commentLeads.has(COLON),
  };
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

/** End of the number that starts at `p`, or `p` when there is none (a sign is not one). */
function numberEndAt(line: string, p: number, limit: number, spec: LexSpec): number {
  let i = p;
  let digits = false;
  while (i < limit && isDigit(line.charCodeAt(i))) {
    i++;
    digits = true;
  }
  if (i < limit && line.charCodeAt(i) === spec.decimalPoint) {
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
    return { end: numberEnd, text, value: parseNumber(text) };
  }

  if (spec.variables && start < limit) {
    spec.variables.lastIndex = start;
    const match = spec.variables.exec(line);
    if (match && match.index === start && start + match[0].length <= limit) {
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

/** End of the block-skip mark at `p`, or `p` when there is none. */
function scanSkip(line: string, p: number, limit: number, spec: LexSpec): number {
  const skip = spec.skip;
  if (!skip || p >= limit || !skip.codes.includes(line.charCodeAt(p))) return p;
  let end = p + 1;
  if (skip.levels && end < limit) {
    const level = line.charCodeAt(end);
    if (level > ZERO && level <= NINE) end++;
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
function endsOperand(tokens: NcToken[]): boolean {
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
      return true;
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

  if (atHead) {
    if (spec.skip?.before === true) {
      const end = scanSkip(line, p, limit, spec);
      if (end > p) {
        push(tokens, 'skip', line, p, end);
        p = pushSpace(tokens, line, end, limit);
      }
    }
    const block = scanBlockNumber(line, p, limit, spec);
    if (block) {
      const token = push(tokens, 'blockNumber', line, block.start, block.end);
      const digits = line.slice(block.digitsStart, block.end);
      if (block.prefix !== '') token.address = spec.caseSensitive ? block.prefix : block.prefix.toUpperCase();
      token.valueText = digits;
      token.value = parseNumber(digits);
      atHead = false;
      p = pushSpace(tokens, line, block.end, limit);
      if (spec.skip?.after === true) {
        const end = scanSkip(line, p, limit, spec);
        if (end > p) {
          push(tokens, 'skip', line, p, end);
          p = pushSpace(tokens, line, end, limit);
        }
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

    const keyword = matchKeyword(line, p, limit, spec);
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

    if (spec.variables) {
      spec.variables.lastIndex = p;
      const match = spec.variables.exec(line);
      if (match && match.index === p && p + match[0].length <= limit) {
        p = push(tokens, 'variable', line, p, p + match[0].length).end;
        continue;
      }
    }
    // The indirect form `#[#1+1]`: the lead character on its own, then the expression.
    if (code === spec.variableLead && p + 1 < limit && line.charCodeAt(p + 1) === BRACKET_OPEN) {
      p = push(tokens, 'variable', line, p, p + 1).end;
      continue;
    }

    if (code === BRACKET_OPEN) {
      const end = expressionEndAt(line, p, limit);
      push(tokens, 'expression', line, p, end);
      p = end;
      continue;
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
    if (isDigit(code) || code === spec.decimalPoint || ((code === PLUS || code === MINUS) && !endsOperand(tokens))) {
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
