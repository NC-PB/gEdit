// Hover text for one word (plan §5 WP3.6). Owner: WP3.6.
//
// Pure and Monaco-free: this module turns a line plus a cursor offset into the markdown
// of a hover, and `monaco/providers/hover.ts` puts it into a Monaco hover. Everything is
// unit-testable in node, which is where the rules below are pinned.
//
// Security (plan §3, rule 3): the hover is rendered with `isTrusted: false` and
// `supportHtml: false`, and every value that comes from a profile, a code database or the
// document is escaped here with `escapeMarkdown`, because a user database (P2) and the
// open file are untrusted content.
//
// What is shown (plan §5 WP3.6, `docs/planning/code-assistant.md` "Hover help"):
//
//   - a code: its label, its description and a line with its group and, when it is one,
//     `modal`; a code with required parameters also lists them;
//   - an address letter: its label and description (`X10.` → `X`, `X axis`);
//   - a variable (`#100`, `Q200`): its kind only. The value is unknown without
//     simulation, and the hover says so instead of guessing;
//   - a word the database does not describe: shown as such, never guessed. An entry that
//     still carries `verify: true` counts as "not described" — its label and description
//     stay out of hover until someone has confirmed them (content rule, §5 WP3.3).
//
// What stays silent, because saying "unknown" about it would be noise rather than help:
// comments, strings, operators, expressions, block skips, a bare value with no address
// (`TOOL CALL 5`), and a many-lettered word that is a name and not a code
// (`BEGIN PGM TEST`).

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { lookupCode, lookupWord, normalizeCode } from './lookup';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { Translate } from '$lib/app/types';
import type { CodeDb, CodeEntry, CodeLookup } from './types';

/** The markdown of one hover and the range in the line it belongs to (UTF-16 offsets). */
export interface HoverInfo {
  markdown: string;
  start: number;
  end: number;
}

export interface HoverOptions {
  /**
   * Address letters the database uses for numbered codes (`G`, `M`). A word with such an
   * address and no entry is an *unknown code* (`G12`), not an address; every other letter
   * falls back to its address help. `codeAddressesOf()` derives the set from a database.
   */
  codeAddresses?: ReadonlySet<string>;
}

/** Characters markdown would read as formatting. */
const MARKDOWN = /[\\`*_{}[\]()#+\-.!|<>~]/g;

/** An address letter written together with digits: `G83`, `M8`, `R0`. */
const NUMBERED_CODE = /^([A-Z])\d/;

/**
 * How many numbered codes a letter needs before a word with that address counts as a code
 * rather than as a value. Two keeps Klartext's single `R0` out of the set — `R+5` is a
 * radius, and calling it an unknown code would be wrong — while `G` and `M` are far above
 * it in both built-in databases.
 */
const MIN_NUMBERED_CODES = 2;

/** A word whose address is longer than this is a name (`BEGIN PGM TEST`), not a code. */
const MAX_ADDRESS_LENGTH = 2;

/** A Klartext parameter word, as the tokenizer writes it into a variable token. */
const Q_PARAMETER = /^Q[LRS]?\d+$/i;

/** Text that is safe inside markdown, whatever a profile or a database put in it. */
export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN, '\\$&');
}

const CODE_ADDRESSES = new WeakMap<CodeDb, ReadonlySet<string>>();

/**
 * The address letters `db` describes numbered codes for, cached against the database.
 *
 * Fanuc answers `G` and `M`, Klartext `M`. It is what tells `G12` (an unknown code) from
 * `X12` (an X position the database has nothing more to say about).
 */
export function codeAddressesOf(db: CodeDb): ReadonlySet<string> {
  const cached = CODE_ADDRESSES.get(db);
  if (cached) return cached;

  const counts = new Map<string, number>();
  for (const entry of db.codes) {
    const match = NUMBERED_CODE.exec(normalizeCode(entry.code));
    if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  const letters = new Set<string>();
  for (const [letter, count] of counts) if (count >= MIN_NUMBERED_CODES) letters.add(letter);
  CODE_ADDRESSES.set(db, letters);
  return letters;
}

/** The token at `offset`, or null past the end of the line. Tokens cover the line. */
function tokenAt(tokens: NcToken[], offset: number): number {
  for (let i = 0; i < tokens.length; i++) {
    if (offset >= tokens[i].start && offset < tokens[i].end) return i;
  }
  return -1;
}

/** The next token that is not whitespace, in `step` direction. */
function contentNeighbour(tokens: NcToken[], from: number, step: 1 | -1): NcToken | null {
  for (let i = from + step; i >= 0 && i < tokens.length; i += step) {
    if (tokens[i].kind !== 'whitespace') return tokens[i];
  }
  return null;
}

/** The digits of a word that carries nothing else: the `200` of `CYCL DEF 200`. */
function bareNumberOf(token: NcToken | null): string | null {
  if (!token || token.kind !== 'word' || token.address !== undefined) return null;
  return /^\d+$/.test(token.text) ? token.text : null;
}

/**
 * A keyword and the number behind it, as one token, when the database knows the pair.
 *
 * Klartext writes its cycles that way (`CYCL DEF 200`), and the tokenizer hands the
 * keyword and the number over separately, so hovering either half has to find the cycle.
 * The join only happens when the joined form really is in the database, so `LBL 1` still
 * describes `LBL` and a number that just follows a keyword stays a number.
 */
function joinWithNumber(tokens: NcToken[], index: number, line: string, db: CodeDb): NcToken | null {
  const token = tokens[index];
  const keyword = token.kind === 'keyword' ? token : contentNeighbour(tokens, index, -1);
  const number = token.kind === 'keyword' ? contentNeighbour(tokens, index, 1) : token;
  if (!keyword || keyword.kind !== 'keyword') return null;

  const digits = bareNumberOf(number);
  if (digits === null || !number) return null;
  if (number.start < keyword.end) return null;

  const code = `${keyword.address ?? keyword.text} ${digits}`;
  if (!lookupCode(db, code)) return null;
  return {
    kind: 'keyword',
    start: keyword.start,
    end: number.end,
    text: line.slice(keyword.start, number.end),
    address: code,
  };
}

/**
 * The token a hover at `offset` describes, with a Klartext cycle joined into one token.
 *
 * `offset` is a UTF-16 offset into `line` (Monaco's `column - 1`).
 */
export function hoverTarget(
  line: string,
  offset: number,
  cp: CompiledProfile,
  db: CodeDb,
  prev?: LineState,
): NcToken | null {
  const { tokens } = tokenizeLine(line, cp, prev);
  const index = tokenAt(tokens, offset);
  if (index < 0 || tokens[index].kind === 'whitespace') return null;
  return joinWithNumber(tokens, index, line, db) ?? tokens[index];
}

/** Kinds `lookupWord` says nothing about, although the database describes their address. */
const ASK_AS_WORD = new Set<NcToken['kind']>(['variable', 'blockNumber', 'programMarker']);

/**
 * What the database knows about `token`.
 *
 * `lookupWord` answers only about words and keywords, because that is what a *code*
 * database is about. Three other kinds still carry an address it describes — a variable
 * (`Q200` → the `Q` parameter class), a block number (`N10` → `N`) and a program number
 * (`O1234` → `O`) — so those are asked about as if they were words. A variable has no
 * address of its own, and its text is the class the lookup then matches.
 */
function lookupFor(db: CodeDb, token: NcToken): CodeLookup | null {
  if (!ASK_AS_WORD.has(token.kind)) return lookupWord(db, token);
  return lookupWord(db, { ...token, kind: 'word', address: token.address ?? token.text.toUpperCase() });
}

/** The whole hover for a position in a line, or null when there is nothing to say. */
export function hoverAt(
  line: string,
  offset: number,
  cp: CompiledProfile,
  db: CodeDb,
  t: Translate,
  prev?: LineState,
): HoverInfo | null {
  const token = hoverTarget(line, offset, cp, db, prev);
  if (!token) return null;
  const markdown = hoverText(token, lookupFor(db, token), t, { codeAddresses: codeAddressesOf(db) });
  return markdown === null ? null : { markdown, start: token.start, end: token.end };
}

// ---------------------------------------------------------------------------
// The markdown
// ---------------------------------------------------------------------------

/** `**title** — subtitle`, both escaped; the subtitle is left out when there is none. */
function heading(title: string, subtitle?: string): string {
  const head = `**${escapeMarkdown(title)}**`;
  return subtitle ? `${head} — ${escapeMarkdown(subtitle)}` : head;
}

/** Paragraphs, blank ones dropped. */
function paragraphs(parts: (string | null | undefined)[]): string {
  return parts.filter((part): part is string => !!part).join('\n\n');
}

/** The group name in English, or the raw id when the catalog has no message for it. */
function groupLabel(group: string, t: Translate): string {
  const key = `assistant.group.${group}`;
  const label = t(key);
  return label === key ? group : label;
}

/** `_Cycle · modal_`, or null for an entry with neither. */
function groupLine(entry: CodeEntry, t: Translate): string | null {
  const parts: string[] = [];
  if (entry.group) parts.push(escapeMarkdown(groupLabel(entry.group, t)));
  if (entry.modal) parts.push(escapeMarkdown(t('assistant.hover.modal')));
  return parts.length === 0 ? null : `_${parts.join(' · ')}_`;
}

/** `Required: Z, R, Q, F`, or null when the code has no required parameter. */
function requiredLine(entry: CodeEntry, t: Translate): string | null {
  const required = (entry.params ?? []).filter((param) => param.required).map((param) => param.address);
  if (required.length === 0) return null;
  return escapeMarkdown(t('assistant.hover.required', { list: required.join(', ') }));
}

/** A code the database describes: label, description, group and required parameters. */
function codeHover(display: string, entry: CodeEntry, t: Translate): string {
  return paragraphs([
    heading(display, entry.label),
    entry.description ? escapeMarkdown(entry.description) : null,
    entry.pitchFeed ? escapeMarkdown(t('assistant.hover.pitchFeed')) : null,
    groupLine(entry, t),
    requiredLine(entry, t),
  ]);
}

/** An address letter: what it means in this dialect. */
function addressHover(address: NonNullable<CodeLookup['address']>, t: Translate, incremental?: boolean): string {
  return paragraphs([
    heading(address.letter, address.label),
    address.description ? escapeMarkdown(address.description) : null,
    incremental ? escapeMarkdown(t('assistant.hover.incremental')) : null,
  ]);
}

/** A word the database does not describe, with the address as context when it knows it. */
function unknownHover(display: string, t: Translate, address?: CodeLookup['address']): string {
  return paragraphs([
    heading(display),
    escapeMarkdown(t('assistant.hover.unknown')),
    address ? `_${escapeMarkdown(`${address.letter} — ${address.label}`)}_` : null,
  ]);
}

/** A variable: its kind, and the reminder that the editor does not know its value. */
function variableHover(token: NcToken, lookup: CodeLookup | null, t: Translate): string {
  const kind = lookup?.address;
  const isParameter = kind !== undefined && Q_PARAMETER.test(token.text);
  return paragraphs([
    heading(token.text, isParameter ? kind.label : t('assistant.hover.variable')),
    isParameter && kind.description ? escapeMarkdown(kind.description) : null,
    escapeMarkdown(t('assistant.hover.variableValue')),
  ]);
}

/** The code as the database spells it: the canonical address plus the value as written. */
function wordDisplay(token: NcToken): string {
  return `${token.address ?? ''}${token.valueText ?? ''}`;
}

/** True for a value that could be the number of a code: `83`, not `+5` and not `#101`. */
function looksLikeCodeNumber(token: NcToken): boolean {
  return token.valueText !== undefined && token.value !== null && token.value !== undefined && token.value.sign === '';
}

/**
 * The markdown for one token, or null when there is nothing to say.
 *
 * `lookup` is what the database answered for the token (`lookupWord`, or the variable
 * form of it); `null` counts as "the database has nothing".
 */
export function hoverText(
  token: NcToken,
  lookup: CodeLookup | null,
  t: Translate,
  o: HoverOptions = {},
): string | null {
  const entry = lookup?.entry ?? null;
  const described = entry && entry.verify !== true ? entry : null;

  switch (token.kind) {
    case 'variable':
      return variableHover(token, lookup, t);

    case 'blockNumber':
    case 'programMarker':
      // `N10` and `O1234` carry an address letter the database describes; `%` and a
      // Klartext leading-integer block number carry none, and stay silent.
      return lookup?.address ? addressHover(lookup.address, t) : null;

    case 'keyword': {
      const display = token.address ?? token.text;
      return described ? codeHover(display, described, t) : unknownHover(display, t);
    }

    case 'word': {
      if (token.address === undefined) return null; // a bare value: `TOOL CALL 5`
      const display = wordDisplay(token);
      if (described) return codeHover(display, described, t);
      const address = lookup?.address;
      if (entry) return unknownHover(display, t, address); // an unverified entry
      if (address) {
        const isCode = o.codeAddresses?.has(address.letter) === true && looksLikeCodeNumber(token);
        return isCode ? unknownHover(display, t, address) : addressHover(address, t, token.incremental);
      }
      return token.address.length <= MAX_ADDRESS_LENGTH ? unknownHover(display, t) : null;
    }

    default:
      return null;
  }
}
