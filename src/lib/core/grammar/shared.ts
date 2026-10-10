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

/**
 * One Monarch action step: a role for the text it covers, plus — for the few places where
 * the tokenizer's reading depends on what stood before (a `DEF` line, B1-G) — the state to
 * go to. `@rematch` gives the text back, so a state can hand a position to another one
 * without consuming it.
 */
export type GrammarStep = Role | '' | { token: Role | '' | '@rematch'; next?: string; switchTo?: string };

/** A Monarch action: one step for the whole match, or one per capture group. */
export type GrammarAction = GrammarStep | GrammarStep[];

/** One Monarch rule, as `[regex source, action]`. */
export type GrammarRule = [string, GrammarAction];

/** A rule of a state other than `root`, or the inclusion of another state's rules. */
export type GrammarEntry = GrammarRule | { include: string };

/**
 * The Monarch language a generator produces. `IMonarchLanguage`, typed without Monaco.
 *
 * `root` is the whole grammar of every dialect but one construct: the names a Sinumerik
 * `DEF` line declares depend on what stood before them on the line, which a single state
 * cannot know. Every other state is entered from `root` and left again at the first
 * character of the next line (`STATE_EXIT` below), so no state ever outlives its line.
 */
export interface MonarchGrammar {
  defaultToken: '';
  ignoreCase: boolean;
  tokenizer: { root: GrammarRule[]; [state: string]: GrammarEntry[] };
}

/**
 * The first rule of every state besides `root`: at the first position of a line, give the
 * position back and leave all states at once. A state therefore never reaches the next
 * line, however the line before ended (a comment, an edit, a line too long to tokenize).
 */
export const STATE_EXIT: GrammarRule = ['^', { token: '@rematch', next: '@popall' }];

/**
 * A function name in front of its argument bracket: `SIN[30]`, `SQRT[…]`, `DROUND[…]`.
 *
 * The longest function of either dialect has six letters, and the bound is not a detail:
 * Monarch tries a rule at every position no earlier rule took, and nothing takes a long
 * run of letters whole. Unbounded, this rule read to the end of the run at every letter
 * of it and gave up only there, so a line of 16k letters took over a second to paint
 * (G8 M8). Bounded, a run too long to be a function costs eight characters a position.
 */
export const FUNCTION_NAME = '[A-Za-z]{2,8}(?=\\s*\\[)';

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
  if (p.syntax?.tapeMarker === false) return false; // M12.5: Klartext has no tape
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

// ---------------------------------------------------------------------------------------
// B1-G: the `syntax` fields of M12.5 that the tokenizer reads and the grammar did not.
// Each builder below mirrors one scan of `core/nc/tokenizer.ts` (named in its comment);
// `differential.test.ts` holds the two to the same answer over every golden line.
// ---------------------------------------------------------------------------------------

/**
 * `source` with every capturing group made non-capturing (`(` and `(?<name>` become `(?:`).
 * A profile pattern is dropped into a rule whose capture groups are counted against its
 * actions, so a group of the pattern's own would shift every role behind it.
 */
export function nonCapturing(source: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      out += char + (source[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      out += char;
      continue;
    }
    if (char === '[') {
      inClass = true;
      out += char;
      continue;
    }
    if (char !== '(') {
      out += char;
      continue;
    }
    if (source[i + 1] !== '?') {
      out += '(?:';
      continue;
    }
    // `(?<name>` is a capturing group; `(?<=` and `(?<!` are lookbehinds and stay.
    const named = /^\(\?<([A-Za-z_]\w*)>/.exec(source.slice(i, i + 40));
    if (named) {
      out += '(?:';
      i += named[0].length - 1;
      continue;
    }
    out += char;
  }
  return out;
}

/** Index of the `)` that closes the group opened at `open`, or -1. */
function closingParen(source: string, open: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      continue;
    }
    if (char === '[') inClass = true;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return i;
  }
  return -1;
}

/** The words an atom of a `freeText` prefix can be: `CYCL` is one, `(?:BEGIN|END)` two; null when it is no word. */
function atomWords(atom: string): string[] | null {
  const match = /^(?:\(\?:([A-Z][A-Z0-9]*(?:\|[A-Z][A-Z0-9]*)*)\)|([A-Z][A-Z0-9]*))$/.exec(atom);
  const words = match?.[1] ?? match?.[2];
  return words === undefined ? null : words.split('|');
}

/** What a regex atom of a `freeText` prefix that is not a word paints as: a number or a mark. */
function prefixRole(atom: string): Role | '' {
  if (/^(?:\\d|\d)/.test(atom)) return 'number';
  if (atom === ':') return 'operator';
  return '';
}

/**
 * The prefix of a `freeText` pattern (what stands in front of its `text` group) as the
 * groups of a rule: its words, numbers and blanks each get the role the ordinary rules would
 * have given them (`CYCL DEF 207` stays a keyword and a number), cut at the blanks
 * (`\s+`, `\s*`) that stand outside every group. Words are keywords where the profile says
 * so — a run of them that is one keyword (`CYCL DEF`, `BEGIN PGM`) stays one piece, and a word
 * that is part of no keyword (the `PGM` of `CYCL DEF 12.1 PGM`) is not one. A prefix this
 * cannot cut safely — an alternation outside a group, say — is one uncoloured group.
 */
function prefixGroups(prefix: string, keywords: ReadonlySet<string>): [source: string, role: Role | ''][] {
  type Part = { source: string; blank: boolean; words: string[] | null; role: Role | '' };
  const parts: Part[] = [];
  let atom = '';
  const flush = (): void => {
    if (atom !== '') parts.push({ source: nonCapturing(atom), blank: false, words: atomWords(atom), role: prefixRole(atom) });
    atom = '';
  };
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < prefix.length; i++) {
    const char = prefix[i];
    if (depth === 0 && !inClass && char === '|') return [[nonCapturing(prefix), '']];
    if (depth === 0 && !inClass && char === '\\' && prefix[i + 1] === 's' && (prefix[i + 2] === '+' || prefix[i + 2] === '*')) {
      flush();
      parts.push({ source: prefix.slice(i, i + 3), blank: true, words: null, role: '' });
      i += 2;
      continue;
    }
    if (char === '\\') {
      atom += char + (prefix[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
    } else if (char === '[') inClass = true;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    atom += char;
  }
  flush();
  if (depth !== 0 || inClass || parts.length === 0) return [[nonCapturing(prefix), '']];

  // A run of words and the blanks between them is a keyword when it spells one, in every
  // alternative; take the longest such run at each word.
  const spells = (from: number, to: number): boolean => {
    let combos: string[] = [''];
    for (let k = from; k <= to; k++) {
      const part = parts[k];
      if (part.blank) continue;
      if (part.words === null) return false;
      const words = part.words;
      combos = combos.flatMap((head) => words.map((word) => (head === '' ? word : `${head} ${word}`)));
    }
    return combos.every((combo) => keywords.has(combo));
  };
  const out: [string, Role | ''][] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].words === null) {
      out.push([parts[i].source, parts[i].role]);
      continue;
    }
    let end = -1;
    for (let k = parts.length - 1; k >= i; k--) {
      if (!parts[k].blank && parts[k].words !== null && spells(i, k) && parts.slice(i, k + 1).every((part, at) => (at % 2 === 0 ? !part.blank : part.blank))) {
        end = k;
        break;
      }
    }
    if (end < 0) {
      out.push([parts[i].source, '']);
      continue;
    }
    out.push([parts.slice(i, end + 1).map((part) => part.source).join(''), 'keyword']);
    i = end;
  }
  return out;
}

/**
 * The rules of `syntax.freeText` (M12.5; `freeTextAt` in the tokenizer): in each pattern, the
 * named group `text` is one uncoloured piece, as the tokenizer makes it one `text` token — a
 * Klartext cycle name or program name is not a row of words and numbers. What stands in
 * front of the group keeps its own colours (`prefixGroups`); what stands behind it is a
 * lookahead in every built-in pattern and is kept as one, otherwise it is consumed
 * uncoloured. Rules go before the keyword rule, because the prefix contains keywords.
 */
export function freeTextRules(p: Profile, keywords: ReadonlySet<string>): GrammarRule[] {
  const rules: GrammarRule[] = [];
  for (const source of Array.isArray(p.syntax?.freeText) ? p.syntax.freeText : []) {
    if (typeof source !== 'string') continue;
    const open = source.indexOf('(?<text>');
    if (open < 0) continue;
    const close = closingParen(source, open);
    if (close < 0) continue;
    const before = source.slice(0, open);
    const body = nonCapturing(source.slice(open + '(?<text>'.length, close));
    const after = source.slice(close + 1);
    // A prefix that starts with a line anchor would be read as the line-start rule; none does.
    const groups = prefixGroups(before.replace(/^\^/, ''), keywords);
    const lookahead = /^\(\?[=!]/.test(after) && closingParen(after, 0) === after.length - 1;
    const parts: [string, Role | ''][] = [...groups, [body, ''], ...(after === '' || lookahead ? [] : [[nonCapturing(after), ''] as [string, Role | '']])];
    rules.push([`${parts.map(([part]) => `(${part})`).join('')}${lookahead ? nonCapturing(after) : ''}`, parts.map(([, role]) => role)]);
  }
  return rules;
}

/**
 * The rule of `syntax.colonWords` (M12.5; `colonWordAt`): `VCONST:ON`, `VC:120`, `HSC-MODE:1`
 * are one word of an address the dialect lists, the way the tokenizer reads them — the name,
 * a colon, then a number, a parameter, an expression or plain letters, up to a blank, a
 * comment or the end of the block. They are painted like any other address with a value
 * the profile gives no meaning of its own (`number`), so a listed name that is also a code of
 * the database (`VC`) is not a keyword here. The rule goes before the keyword rule.
 */
export function colonWordRule(p: Profile, value: string): GrammarRule | null {
  const names = (Array.isArray(p.syntax?.colonWords) ? p.syntax.colonWords : [])
    .filter((name): name is string => typeof name === 'string' && name !== '')
    .sort((a, b) => b.length - a.length)
    .map(escapeLiteral);
  if (names.length === 0) return null;
  const ends = ['\\s', '$', ...commentMarkers(p).map((marker) => escapeLiteral(marker.start))];
  return [`(?:${names.join('|')}):(?:${value}|\\[[^\\]]*\\]|[A-Za-z]+)(?=${ends.join('|')})`, 'number'];
}

/**
 * The rule of `syntax.plainTextRun` (M12.5; `plainTextEndAt`): where words are packed, a run
 * of at least that many letters — and the groups of letters and blanks that follow it, up to
 * a keyword or a group with a value behind it — is one uncoloured piece, as the tokenizer
 * makes it one `unknown` token (`M797 SPINDLE ONE DONE`). Without it the letters of the
 * text that happen to be a keyword (`NE`, `LE`) or an address are painted one by one.
 * `keywords` is the keyword alternation of the grammar. The rule goes behind the keyword
 * rule and in front of every address rule, which is where the tokenizer asks.
 */
export function plainTextRule(p: Profile, keywords: string | null): GrammarRule | null {
  const run = p.syntax?.plainTextRun;
  if (typeof run !== 'number' || !Number.isInteger(run) || run < 2 || p.syntax?.wordSeparatorRequired === true) return null;
  const sigil = variableSigil(p);
  const point = escapeLiteral(p.syntax?.decimalSeparator ?? '.');
  const starts = `[0-9+\\-\\[${escapeClass(sigil ?? '')}]|${point}`;
  const notKeyword = keywords === null ? '' : `(?!${keywords}(?![A-Za-z]))`;
  return [`[A-Za-z]{${run},}(?:\\s+${notKeyword}[A-Za-z]+(?![A-Za-z])(?!\\s*(?:${starts})))*`, ''];
}

/**
 * Several block-skip marks on one block (`/1 /3 N10 G1`): where the mark takes a level, the
 * tokenizer reads each one as a `skip` of its own at the head of the block (`pushSkips`,
 * M9). The longest stack first; a single mark is the ordinary rule of the generator.
 */
export function stackedSkipRules(p: Profile, mark: string): GrammarRule[] {
  if (p.syntax?.blockSkip?.levels !== true) return [];
  return [3, 2].map((count): GrammarRule => {
    const parts = Array.from({ length: count }, () => `(\\s*)(${mark})`);
    return [lineStart(parts.join('')), Array.from({ length: count }, () => ['', 'skip'] as const).flat()];
  });
}
