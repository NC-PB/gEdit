// NC-aware search and replace (plan §7.6, AD-25). Owner: WP11.1. The rules are in `./types.ts`.
//
// Two kinds of query, two ways to find them:
//
//  - A **word** is matched on the tokenizer's tokens, so `G1` is `G01` and `G1.` and never
//    `G10` or the `G1` in a comment, and `S>12000` compares the digits as written. A line is
//    tokenized only when a cheap pattern says the address could be on it: a CAM program
//    is mostly lines that cannot match, and 300k lines have to stay inside a second.
//  - **Text** is a pattern on the line as written. A comment is found in the masked line
//    (`maskComments` keeps every offset), so a hit that sits in one is told apart without
//    changing what the pattern sees.
//
// `findInLines` and `replaceInLines` share one scanner, so a replace changes exactly what a
// find lists. The one difference is on purpose: a find on the program-number address also
// lists the calls that name the program, and a replace never touches them (§7.16 #136).

import { lookupCode } from '$lib/core/codes/lookup';
import type { CodeDb } from '$lib/core/codes/types';
import { maskComments } from '$lib/core/nc/mask';
import { parseNumber } from '$lib/core/nc/numbers';
import { lexSpec, tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, NcToken, NumericLiteral } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { ParseQueryResult, SearchFlags, SearchHit, SearchQuery, WordOp } from './types';
import { SEARCH_MAX_HITS } from './types';

export * from './types';

/** An address with or without digits, then a value: `G01`, `SB`, `,R`, `X-5.5`, `T`. */
const BARE_WORD = /^(,?[A-Za-z]+)\s*([+-]?(?:\d+\.?\d*|\.\d+))?$/;

/** An address (an assignment identifier may end in digits: `S1`), an operator, a value: `S1=`, `SB=500`, `S>12000`. */
const OPERATOR_WORD = /^(,?[A-Za-z]+\d*)\s*(!=|<=|>=|=|<|>)\s*([+-]?(?:\d+\.?\d*|\.\d+))?$/;

/** The longest program number: `M98 P52000` is a count of 5 in front of the number 2000. */
const PACKED_NUMBER_DIGITS = 4;

/** The search form's text and toggles → a query, or the reason it is not one. */
export function parseQuery(input: string, cp: CompiledProfile, o: SearchFlags): ParseQueryResult {
  const text = input.trim();
  if (text === '') return { error: { key: 'search.errorEmpty' } };

  if (o.wholeAddress) {
    const caseSensitive = cp.profile.syntax?.caseSensitive === true;
    const withOperator = OPERATOR_WORD.exec(text);
    const bare = withOperator === null ? BARE_WORD.exec(text) : null;
    const found = withOperator ?? bare;
    if (found === null) return { error: { key: 'search.errorWord', params: { query: text } } };
    const address = caseSensitive ? found[1] : found[1].toUpperCase();
    const op = withOperator === null ? undefined : (withOperator[2] as WordOp);
    const value = withOperator === null ? bare?.[2] : withOperator[3];
    // `S>` names no number to compare with; only `=` and a bare address may leave it out.
    if (op !== undefined && op !== '=' && value === undefined) {
      return { error: { key: 'search.errorValue', params: { query: text } } };
    }
    return { kind: 'word', address, ...(op === undefined ? {} : { op }), ...(value === undefined ? {} : { value }) };
  }

  if (o.regex) {
    try {
      new RegExp(text);
    } catch (err) {
      return { error: { key: 'search.errorRegex', params: { message: err instanceof Error ? err.message : String(err) } } };
    }
  }
  return { kind: 'text', text, regex: o.regex, caseSensitive: o.caseSensitive, inComments: o.inComments };
}

// ---------------------------------------------------------------------------
// Decimal text
// ---------------------------------------------------------------------------

/** Sign, the integer digits without leading zeros and the fraction without trailing zeros. */
function canonical(n: NumericLiteral): { negative: boolean; int: string; frac: string } {
  const int = n.intPart.replace(/^0+/, '');
  const frac = (n.fracPart ?? '').replace(/0+$/, '');
  // `-0` and `-0.0` are zero, and zero has no sign.
  const negative = n.sign === '-' && (int !== '' || frac !== '');
  return { negative, int, frac };
}

/** Negative, zero or positive: `a` against `b` as decimal numbers, no JS number in between. */
function compareDecimal(a: NumericLiteral, b: NumericLiteral): number {
  const x = canonical(a);
  const y = canonical(b);
  if (x.negative !== y.negative) return x.negative ? -1 : 1;
  let order = 0;
  if (x.int.length !== y.int.length) order = x.int.length < y.int.length ? -1 : 1;
  else if (x.int !== y.int) order = x.int < y.int ? -1 : 1;
  else if (x.frac !== y.frac) {
    // Same integer: the fractions compare as digit strings, the shorter padded with zeros.
    const width = Math.max(x.frac.length, y.frac.length);
    const left = x.frac.padEnd(width, '0');
    const right = y.frac.padEnd(width, '0');
    order = left < right ? -1 : 1;
  }
  return x.negative ? -order : order;
}

function holds(op: WordOp, order: number): boolean {
  switch (op) {
    case '=':
      return order === 0;
    case '!=':
      return order !== 0;
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
  }
}

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

/** One hit inside a line; `match` is kept for a regex query, whose replacement uses its groups. */
interface RawHit {
  start: number;
  end: number;
  match?: RegExpExecArray;
  /**
   * Where a replace stops when it is not `end`: a word query that names no value replaces
   * the address and keeps the value (`X`→`Y` makes `X10.` into `Y10.`, `S1`→`S2` makes
   * `S1=1000` into `S2=1000`; review NC-4).
   */
  replaceEnd?: number;
}

type LineScanner = (line: string) => RawHit[];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `a` and `b` are one address on this profile (case matters only where it says so). */
function sameAddress(a: string, b: string, caseSensitive: boolean): boolean {
  return caseSensitive ? a === b : a.toUpperCase() === b.toUpperCase();
}

/** The compiled pattern of a text query, once per query object. */
const PATTERNS = new WeakMap<SearchQuery, RegExp>();

function patternOf(q: Extract<SearchQuery, { kind: 'text' }>): RegExp {
  let pattern = PATTERNS.get(q);
  if (!pattern) {
    const source = q.regex ? q.text : escapeRegex(q.text);
    pattern = new RegExp(source, q.caseSensitive ? 'g' : 'gi');
    PATTERNS.set(q, pattern);
  }
  return pattern;
}

/** A text query: the pattern on the line, minus the hits that lie in a comment. */
function textScanner(cp: CompiledProfile, q: Extract<SearchQuery, { kind: 'text' }>): LineScanner {
  const pattern = patternOf(q);
  return (line) => {
    const hits: RawHit[] = [];
    let comments: number[] | null = null;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
      const start = match.index;
      const end = start + match[0].length;
      // An empty match (`^`, `x*`) marks no text; step over it or the loop never ends.
      if (end === start) {
        pattern.lastIndex = end + 1;
        continue;
      }
      if (!q.inComments) {
        comments ??= commentRegions(line, maskComments(line, cp));
        if (overlaps(comments, start, end)) continue;
      }
      hits.push({ start, end, match });
    }
    return hits;
  };
}

/**
 * The comment spans of a line as `[start, end, start, end, …]`, read off the mask: inside a
 * run of blanks on the masked line, from the first character the mask blanked to the last.
 * So the blanks **inside** a comment belong to it (`(A  B)`: a regex `\s{2,}` must not
 * find them; review CODE-6), and the blanks around it do not. Two comments with nothing but
 * blanks between them are one span: the gap is left alone, which only ever leaves a
 * replace undone, never a comment changed.
 */
function commentRegions(line: string, masked: string): number[] {
  const out: number[] = [];
  if (masked === line) return out;
  let i = 0;
  while (i < line.length) {
    if (masked.charCodeAt(i) !== 0x20) {
      i++;
      continue;
    }
    let first = -1;
    let last = -1;
    for (; i < line.length && masked.charCodeAt(i) === 0x20; i++) {
      if (line.charCodeAt(i) === 0x20) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first >= 0) out.push(first, last + 1);
  }
  return out;
}

/** True when `[start, end)` overlaps one of the spans `commentRegions` returned. */
function overlaps(regions: readonly number[], start: number, end: number): boolean {
  for (let i = 0; i < regions.length; i += 2) {
    if (start < regions[i + 1] && end > regions[i]) return true;
  }
  return false;
}

/**
 * The parameters the code database marks as naming a program, by address: the `P` of `M98`,
 * `G65`, `G66`, `G66.1`. Empty without a database.
 */
function programCallers(db: CodeDb | undefined): Set<string> {
  const addresses = new Set<string>();
  for (const entry of db?.codes ?? []) {
    for (const param of entry.params ?? []) {
      if (param.programNumber !== undefined) addresses.add(param.address.toUpperCase());
    }
  }
  return addresses;
}

/** Whether `address` is the program-number address of this dialect (`O`, the `:` of an ISO program). */
function isProgramAddress(cp: CompiledProfile, address: string): boolean {
  const probe = tokenizeLine(`${address}1`, cp).tokens[0];
  return probe !== undefined && probe.kind === 'programMarker';
}

/** A word query: the tokens of the lines the address can be on. */
function wordScanner(
  cp: CompiledProfile,
  q: Extract<SearchQuery, { kind: 'word' }>,
  db: CodeDb | undefined,
): LineScanner {
  const caseSensitive = cp.profile.syntax?.caseSensitive === true;
  const op: WordOp = q.op ?? '=';
  const wanted = q.value === undefined ? null : parseNumber(q.value);
  const spec = lexSpec(cp);
  // Klartext `IX+10` is an incremental X: its address as the user writes it is `IX`, so `X…`
  // never finds it and `IX…` does (review NC-1: replacing `X10` turned `IX+10` absolute).
  const prefix = cp.profile.syntax?.incrementalPrefix ?? '';
  // A query that names no value names an address: a replace changes the address and keeps
  // the value (review NC-4).
  const addressOnly = q.value === undefined;
  // A parameter's name (`Q206`, `R1`) also stands inside the value of a word (`X+Q206`,
  // `FQ206`, Sinumerik `X=R1*2`); a query that could be a name finds it there (review NC-5).
  const parameter =
    q.op === undefined && q.value !== undefined && /^[A-Za-z]+\d+$/.test(q.address + q.value)
      ? new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(q.address + q.value)}(?![A-Za-z0-9_.])`, caseSensitive ? 'g' : 'gi')
      : null;

  // A call such as `M98 P2000` names the program `O2000`; only a word query that asks for
  // a program number and no more can mean that.
  const callers =
    wanted !== null && op === '=' && isProgramAddress(cp, q.address) ? programCallers(db) : new Set<string>();
  const references = callers.size > 0 && db !== undefined;

  // The cheap test in front of the tokenizer: the address letters, or the letters of a call's parameter.
  const letters = [q.address, ...callers].map(escapeRegex).join('|');
  const prefilter = new RegExp(letters, caseSensitive ? '' : 'i');

  /** The state a line hands on without being tokenized: only the continuation marker has any. */
  const skipState = (line: string): LineState | undefined =>
    spec.continuation === null ? undefined : { continuation: line.search(spec.continuation) >= 0 };

  /**
   * Whether the word is an instance of the query: `'word'` with its value, `'address'` when
   * the address alone names it (`S1` finds `S1=500`: on a control with indexed spindles it
   * is one address), or false.
   */
  const matches = (address: string | undefined, value: NumericLiteral | null | undefined): 'word' | 'address' | false => {
    if (address === undefined) return false;
    if (!sameAddress(address, q.address, caseSensitive)) {
      return q.op === undefined && q.value !== undefined && sameAddress(address, q.address + q.value, caseSensitive) ? 'address' : false;
    }
    if (wanted === null) return q.op === undefined || q.op === '=' ? 'word' : false;
    if (value === null || value === undefined) return false;
    return holds(op, compareDecimal(value, wanted)) ? 'word' : false;
  };

  /** The address of a word as it is written: with the incremental prefix in front where it has one. */
  const addressOf = (token: NcToken): string | undefined =>
    token.incremental === true && token.address !== undefined ? prefix + token.address : token.address;

  let carry: LineState | undefined;
  return (line) => {
    if (!prefilter.test(line)) {
      carry = skipState(line);
      return [];
    }
    const result = tokenizeLine(line, cp, carry);
    carry = result.state;
    const tokens = result.tokens.filter((token) => token.kind !== 'whitespace');
    const hits: RawHit[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      switch (token.kind) {
        case 'word':
        case 'blockNumber':
        case 'programMarker': {
          const address = addressOf(token);
          const how = matches(address, token.value);
          if (how !== false && address !== undefined) {
            const hit: RawHit = { start: token.start, end: token.end };
            // The address is written first (`X10.`, `IX+10`, `S1=1000`, `,R2.`, `P 100`).
            if (addressOnly || how === 'address') hit.replaceEnd = token.start + address.length;
            hits.push(hit);
          } else if (
            parameter !== null &&
            token.kind === 'word' &&
            token.value === null &&
            token.valueText !== undefined &&
            !/["']/.test(token.valueText)
          ) {
            // `X+Q206`, `FQ206`, `X=R1*2`: the name inside the value, and only the name.
            const from = token.end - token.valueText.length;
            parameter.lastIndex = 0;
            for (let m = parameter.exec(token.valueText); m !== null; m = parameter.exec(token.valueText)) {
              hits.push({ start: from + m.index, end: from + m.index + m[0].length });
            }
          }
          break;
        }
        case 'keyword':
          // `FMAX`, `L`, `GOTO`: a keyword has no value, so only a query without one finds it.
          if (q.value === undefined && q.op === undefined && token.address !== undefined && sameAddress(token.address, q.address, caseSensitive)) {
            hits.push({ start: token.start, end: token.end });
          }
          break;
        case 'variable': {
          // A Klartext `Q206` or a Sinumerik `R1`: found by name, or with its value when assigned (`Q206=5`).
          const name = token.text;
          const operator = tokens[i + 1];
          const number = tokens[i + 2];
          if (q.op === undefined && q.value !== undefined) {
            if (sameAddress(name, q.address + q.value, caseSensitive)) hits.push({ start: token.start, end: token.end });
          } else if (
            operator?.kind === 'operator' &&
            operator.text === '=' &&
            number?.kind === 'word' &&
            number.address === undefined &&
            matches(name, number.value)
          ) {
            // `R1=` names no value: a replace renames the parameter and keeps what it is set to.
            hits.push(addressOnly ? { start: token.start, end: number.end, replaceEnd: token.end } : { start: token.start, end: number.end });
          }
          break;
        }
        default:
          break;
      }
    }

    if (references && db !== undefined && wanted !== null) {
      for (const token of tokens) {
        if (token.kind !== 'word' || token.address === undefined || token.valueText === undefined) continue;
        const entry = lookupCode(db, token.address + token.valueText);
        for (const param of entry?.params ?? []) {
          if (param.programNumber === undefined) continue;
          const argument = tokens.find(
            (other) => other.kind === 'word' && other.address !== undefined && sameAddress(other.address, param.address, false) && other.value,
          );
          if (argument?.value === undefined || argument.value === null) continue;
          if (namesProgram(argument.value, param.programNumber, wanted)) hits.push({ start: argument.start, end: argument.end });
        }
      }
      hits.sort((a, b) => a.start - b.start);
    }
    return hits;
  };
}

/** Whether the argument `P…` of a call names the program `wanted`; a packed one also by its last four digits. */
function namesProgram(argument: NumericLiteral, how: 'plain' | 'packed', wanted: NumericLiteral): boolean {
  if (compareDecimal(argument, wanted) === 0) return true;
  if (how !== 'packed' || argument.hasPoint || argument.intPart.length <= PACKED_NUMBER_DIGITS) return false;
  // `M98 P52000`: five times the program 2000.
  const program = parseNumber(argument.intPart.slice(-PACKED_NUMBER_DIGITS));
  return program !== null && compareDecimal(program, wanted) === 0;
}

function scannerFor(cp: CompiledProfile, q: SearchQuery, db: CodeDb | undefined): LineScanner {
  return q.kind === 'text' ? textScanner(cp, q) : wordScanner(cp, q, db);
}

// ---------------------------------------------------------------------------
// Find, replace
// ---------------------------------------------------------------------------

/**
 * Every hit of `q`, in line order, at most `o.max` (default `SEARCH_MAX_HITS`).
 *
 * `o.codes` (§7.16 #136, an added optional member) is the document's effective code
 * database; a word query on the program-number address needs it to find the calls that
 * name the program (`CodeParam.programNumber`). Without it only the program's own number
 * is found.
 */
export function findInLines(
  lines: string[],
  cp: CompiledProfile,
  q: SearchQuery,
  o?: { max?: number; codes?: CodeDb },
): { hits: SearchHit[]; truncated: boolean } {
  const max = o?.max ?? SEARCH_MAX_HITS;
  const scan = scannerFor(cp, q, o?.codes);
  const hits: SearchHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const found = scan(lines[i]);
    for (const hit of found) {
      if (hits.length >= max) return { hits, truncated: true };
      hits.push({ line: i + 1, start: hit.start, end: hit.end, text: lines[i] });
    }
  }
  return { hits, truncated: false };
}

/**
 * `$1`, `$<name>`, `$&` and `$$` in a replacement, as `String.prototype.replace` reads them:
 * `$10` is group 10 when there is one, else group 1 and a `0`; `$<name>` is literal when
 * the pattern has no named group at all (review CODE-8).
 */
function expand(replacement: string, match: RegExpExecArray): string {
  if (!replacement.includes('$')) return replacement;
  const group = (n: number): boolean => n >= 1 && n < match.length;
  return replacement.replace(/\$(\$|&|\d{1,2}|<[^>]*>)/g, (all, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return match[0];
    if (token.startsWith('<')) return match.groups === undefined ? all : (match.groups[token.slice(1, -1)] ?? '');
    const two = Number(token);
    if (group(two)) return match[two] ?? '';
    if (token.length === 2 && group(Number(token[0]))) return (match[Number(token[0])] ?? '') + token[1];
    return all;
  });
}

/**
 * Every hit replaced. A word query with a value replaces the whole word; one without a
 * value replaces the address and keeps the value (`X`→`Y`: `X10.` → `Y10.`; review NC-4,
 * §7.16 #143); a regex query may use `$1` groups. A replace never follows program-number references (a call is not renamed with
 * its program; cross-file references are Phase 4, §11 item 15).
 */
export function replaceInLines(
  lines: string[],
  cp: CompiledProfile,
  q: SearchQuery,
  replacement: string,
): { lines: string[]; count: number } {
  const scan = scannerFor(cp, q, undefined);
  const useGroups = q.kind === 'text' && q.regex;
  const out = new Array<string>(lines.length);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const found = scan(line);
    if (found.length === 0) {
      out[i] = line;
      continue;
    }
    let text = '';
    let at = 0;
    for (const hit of found) {
      text += line.slice(at, hit.start) + (useGroups && hit.match ? expand(replacement, hit.match) : replacement);
      at = hit.replaceEnd ?? hit.end;
    }
    out[i] = text + line.slice(at);
    count += found.length;
  }
  return { lines: out, count };
}

/**
 * The regex Monaco's find widget gets for "whole address" (`search.wholeAddressInFind`,
 * `editor.actions.findWithArgs`, F31): `wholeAddressRegex('G', '1')` →
 * `(?<![A-Z_])G\+?0*1(?:\.0*)?(?![\d.])`, which finds `G1`, `G01`, `G1.`, `G1.0` and a
 * Klartext `X+10` for `X10`, and not `G10`, `G1.5`, `XG1`, `MY_G1` or the `X` of `IX+10`
 * (review NC-9, §7.16 #143). (The §7.6 example `(?<![A-Z])G0*1(?![\d.])` misses `G1.`, which
 * its own sentence says must match; §7.16 #136.) Case-insensitive matching is the widget's
 * own toggle.
 */
export function wholeAddressRegex(address: string, value: string): string {
  // Not after a letter or `_`: `MY_G1` is a name (review NC-9). A digit may stand in front,
  // because Fanuc packs its words (`N10G1X1`).
  const head = `(?<![A-Z_])${escapeRegex(address)}`;
  const number = parseNumber(value);
  // No value: any number or variable after the address (`S` finds `S12000` and `S#5`, not `SB`).
  if (number === null) return `${head}(?:[-+]?[\\d.]+|#\\d+)`;
  // A positive value may carry its `+` (Klartext writes `X+10`; review NC-9).
  const sign = number.sign === '-' ? '-' : '\\+?';
  const int = number.intPart.replace(/^0+/, '');
  const frac = (number.fracPart ?? '').replace(/0+$/, '');
  // The integer digits keep any number of leading zeros (`G01`); a zero keeps one digit to match.
  const integer = int === '' && frac === '' ? '0' : int;
  const fraction = frac === '' ? '(?:\\.0*)?' : `\\.${frac}0*`;
  return `${head}${sign}0*${integer}${fraction}(?![\\d.])`;
}
