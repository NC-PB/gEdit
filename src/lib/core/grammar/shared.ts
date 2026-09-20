// The pieces both grammar generators are built from (plan §5 WP3.4). Owner: WP3.4.
//
// A generator returns a list of `[regex source, action]` rules, in the order Monarch tries
// them. Monarch matches a rule against the rest of the line with `'^(?:' + source + ')'`,
// so a `^` is only an anchor when it is the very first character of the source — anywhere
// else it would match at every token boundary. `lineStart()` and `wholeLine()` below are
// the two shapes that get that right; nothing here writes a bare `^` inside a group.
//
// Everything is derived from the profile, with the code database filling in the address
// letters a dialect knows. The one thing that is not derived is which *kind* of grammar to
// build: `profile.grammar` picks `iso` or `klartext`, and the two files differ exactly as
// `syntax-fanuc.md` §3.8 and `syntax-heidenhain.md` §3.2 differ.

import type { CodeDb } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';
import type { Role } from './roles';

/** A Monarch action: one role for the whole match, or one per capture group. */
export type GrammarAction = Role | '' | (Role | '')[];

/** One Monarch rule, as `[regex source, action]`. */
export type GrammarRule = [string, GrammarAction];

/** The Monarch language a generator produces. `IMonarchLanguage`, typed without Monaco. */
export interface MonarchGrammar {
  defaultToken: '';
  ignoreCase: boolean;
  tokenizer: { root: GrammarRule[] };
}

/** Escapes `text` so it matches itself inside a regular expression. */
export function escapeLiteral(text: string): string {
  return text.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

/** Escapes `text` so it may stand inside a `[...]` character class. */
export function escapeClass(text: string): string {
  return text.replace(/[\\\]\[^-]/g, '\\$&');
}

/** `^…`: a rule Monarch only tries at column 0. */
export function lineStart(body: string): string {
  return `^${body}`;
}

/**
 * `pattern`, extended to the end of the line. A leading `^` is kept in front so Monarch
 * still reads it as the line-start anchor; the rest is wrapped, so an alternation inside
 * `pattern` cannot swallow the tail.
 */
export function wholeLine(pattern: string): string {
  return pattern.startsWith('^') ? `^(?:${pattern.slice(1)}).*$` : `(?:${pattern}).*$`;
}

/** `a|b|c`, wrapped so it can be used as one atom. Empty in, empty out. */
export function alternation(parts: readonly string[]): string | null {
  return parts.length === 0 ? null : `(?:${parts.join('|')})`;
}

/**
 * One atom that matches any of `names`: a character class for single letters, an
 * alternation otherwise. The caller passes them longest first, which is what makes an
 * alternation try `CCA` before `CC` and `CC` before `C`.
 */
export function namesPattern(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.every((name) => name.length === 1)) {
    return names.length === 1 ? escapeLiteral(names[0]) : `[${escapeClass(names.join(''))}]`;
  }
  return alternation(names.map(escapeLiteral));
}

/**
 * The decimal number of the dialect: `10`, `10.`, `.5`, `-0.5`, `+3`.
 * `syntax.decimalSeparator` decides the character; there is no exponent and no grouping.
 */
export function numberPattern(p: Profile, o: { signed?: boolean } = {}): string {
  const point = escapeLiteral(p.syntax?.decimalSeparator ?? '.');
  const sign = o.signed === false ? '' : '[+-]?';
  return `${sign}(?:\\d+${point}?\\d*|${point}\\d+)`;
}

/** `syntax.variables`, as an atom; null when the profile defines none. */
export function variablePattern(p: Profile): string | null {
  const source = p.syntax?.variables;
  return typeof source === 'string' && source !== '' ? `(?:${source})` : null;
}

/**
 * The first character of `syntax.variables` when it is a literal, e.g. `#` of `#\d+`.
 * Mirrors `variableLead` in `core/nc/tokenizer.ts`, which is what makes `#[#1+1]` and
 * the word pattern of the language configuration agree with the tokenizer.
 */
export function variableSigil(p: Profile): string | null {
  const source = p.syntax?.variables;
  if (typeof source !== 'string' || source === '') return null;
  return /^[^\\^$.|?*+()[\]{}]/.test(source) ? source[0] : null;
}

/** The comment markers of the profile, with `end: null` meaning "to the end of the line". */
export function commentMarkers(p: Profile): { start: string; end: string | null }[] {
  return (p.syntax?.comments ?? []).filter(
    (marker): marker is { start: string; end: string | null } => typeof marker?.start === 'string' && marker.start !== '',
  );
}

/** The first character of every comment delimiter, opening and closing. */
function commentChars(p: Profile): Set<string> {
  const chars = new Set<string>();
  for (const marker of commentMarkers(p)) {
    chars.add(marker.start[0]);
    if (marker.end) chars.add(marker.end[0]);
  }
  return chars;
}

/** The first character of every comment *opener*, which is what the tokenizer looks at. */
function commentLeads(p: Profile): Set<string> {
  return new Set(commentMarkers(p).map((marker) => marker.start[0]));
}

/**
 * The operator characters of the dialect: the punctuation that is not part of a word.
 * The list mirrors `OPERATOR_CHARS` in `core/nc/tokenizer.ts`, minus anything the profile
 * uses to delimit a comment — `(` is an operator nowhere in Fanuc, because it opens one.
 * `extra` adds the characters a generator needs on top (brackets, the end-of-block mark).
 */
export function operatorClass(p: Profile, extra = ''): string | null {
  const reserved = commentChars(p);
  const chars = [...`=+-*/^%:<>|&,()!${extra}`].filter((char, i, all) => !reserved.has(char) && all.indexOf(char) === i);
  return chars.length === 0 ? null : `[${escapeClass(chars.join(''))}]`;
}

/**
 * Whether a `%` at the head of a line is the punched-tape marker rather than a comment or
 * a block skip. Mirrors `tapeMarker` in `core/nc/tokenizer.ts`.
 */
export function hasTapeMarker(p: Profile): boolean {
  if (commentLeads(p).has('%')) return false;
  return ![...(p.syntax?.blockSkip?.chars ?? '')].includes('%');
}

/** Whether `:1234` is a program number here. Mirrors `colonProgram` in the tokenizer. */
export function hasColonProgram(p: Profile): boolean {
  if (p.syntax?.blockNumber?.mode === 'leading-integer') return false;
  return !commentLeads(p).has(':');
}

/** The block-skip mark of the dialect, e.g. `[/][1-9]?`; null when there is none. */
export function blockSkipPattern(p: Profile): { pattern: string; before: boolean; after: boolean } | null {
  const skip = p.syntax?.blockSkip;
  if (!skip || typeof skip.chars !== 'string' || skip.chars === '') return null;
  const position = skip.position ?? 'either';
  return {
    pattern: `[${escapeClass(skip.chars)}]${skip.levels === true ? '[1-9]?' : ''}`,
    before: position === 'before-number' || position === 'either',
    after: position === 'after-number' || position === 'either',
  };
}

/**
 * The keywords of the profile, upper-cased, de-duplicated and longest first (ties
 * alphabetical). The same order `compileProfile` produces — `grammar.test.ts` pins that
 * they agree, because the grammar and `core/nc/tokenizer.ts` have to split a line the same
 * way or a token would be coloured as something the assistant does not see.
 *
 * `extra` carries the word-shaped codes of the database (Klartext `R0`, `RL`, `RR`), which
 * belong to the same alternation but are not in `syntax.keywords`.
 */
export function orderedKeywords(p: Profile, extra: readonly string[] = []): string[] {
  const seen = new Set<string>();
  for (const keyword of [...(p.syntax?.keywords ?? []), ...extra]) {
    if (typeof keyword === 'string' && keyword.trim() !== '') seen.add(keyword.trim().toUpperCase());
  }
  return [...seen].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** One keyword as a regex: the parts of a multi-word name joined by `\s+`. */
export function keywordPattern(keyword: string): string {
  return keyword
    .split(/\s+/)
    .map(escapeLiteral)
    .join('\\s+');
}

/**
 * The letters the code database knows as addresses, upper-cased, longest first so `CCA`
 * is tried before `CC` and `C`. `exclude` drops the ones a generator has already given a
 * role of their own.
 */
export function addressNames(db: CodeDb, exclude: Iterable<string> = []): string[] {
  const skip = new Set([...exclude].map((name) => name.toUpperCase()));
  const names = Object.keys(db.addresses ?? {})
    .map((name) => name.toUpperCase())
    .filter((name) => name !== '' && /^[A-Z][A-Z0-9]*$/.test(name) && !skip.has(name));
  return [...new Set(names)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** The single-letter addresses a profile names, upper-cased and without duplicates. */
export function letterAddresses(p: Profile): {
  axes: string[];
  arcCenter: string[];
  tool: string | null;
  feed: string | null;
  spindle: string | null;
} {
  const letter = (value: unknown): string | null =>
    typeof value === 'string' && /^[A-Za-z]$/.test(value) ? value.toUpperCase() : null;
  const letters = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.map(letter).filter((name): name is string => name !== null))] : [];
  return {
    axes: letters(p.addresses?.axes),
    arcCenter: letters(p.addresses?.arcCenter),
    tool: letter(p.addresses?.tool),
    feed: letter(p.addresses?.feed),
    spindle: letter(p.addresses?.spindle),
  };
}

/**
 * The codes of the database that are words rather than a letter and a number: Klartext
 * `R0`, `RL`, `RR`, `FMAX`. A numeric code (`G83`, `M6`, `CYCL DEF 200`) is left out — the
 * first two have a rule of their own, and the last only repeats a keyword that is already
 * in the alternation, which would colour the cycle number as part of the name and disagree
 * with the tokenizer.
 */
export function wordCodes(db: CodeDb, codeLetters: readonly string[]): string[] {
  const letters = new Set(codeLetters.map((letter) => letter.toUpperCase()));
  const words: string[] = [];
  for (const entry of db.codes ?? []) {
    for (const code of [entry.code, ...(entry.aliases ?? [])]) {
      if (typeof code !== 'string' || code === '') continue;
      const upper = code.toUpperCase();
      if (/\s/.test(upper)) continue;
      if (!/^[A-Z][A-Z0-9]*$/.test(upper)) continue;
      if (letters.has(upper[0]) && /^[A-Z]\d/.test(upper)) continue;
      words.push(upper);
    }
  }
  return [...new Set(words)];
}
