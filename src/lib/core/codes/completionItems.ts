// Completion from the code database (plan §5 WP3.6). Owner: WP3.6.
//
// Pure and Monaco-free: `monaco/providers/completion.ts` turns a `CompletionSpec` into a
// Monaco suggestion (range, kind, `InsertAsSnippet`), so every rule below is a node test.
//
// The rules (plan §5 WP3.6, `docs/planning/code-assistant.md` "Dictionary-driven
// completion"):
//
//   - suggestions come from the database, filtered by what is typed (`G8` → G80…G89);
//   - a word-shaped code (`L`, `CYCL DEF 200`, `TOOL CALL`) is only offered at the start
//     of a block, which is the one place Klartext can use it — `completionsFor()` in
//     `lookup.ts` owns that rule;
//   - a multi-word code keeps working while it is half typed: `CYCL DEF 20` still finds
//     the cycles, because the prefix may reach back over the words before the cursor;
//   - nothing is suggested inside a comment or a string, and that is decided by the
//     tokenizer, not by counting brackets;
//   - a code with required parameters inserts as a snippet with one tab stop per
//     parameter.
//
// Content: a label, a description and a parameter name belong to the database and are
// inserted as they are written there. The notes around them (`modal`, `Required: …`, the
// warning on an entry that is not verified yet) come from `t()`.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { completionsFor } from './lookup';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { Translate } from '$lib/app/types';
import type { CodeDb, CodeEntry } from './types';

/** What kind of thing a suggestion is; the provider maps it to a Monaco icon. */
export type CompletionKind = 'code' | 'cycle' | 'keyword';

/** One suggestion, before it is turned into a Monaco item. */
export interface CompletionSpec {
  label: string;
  /** Plain text, or Monaco snippet syntax when `snippet` is set. */
  insertText: string;
  snippet: boolean;
  kind: CompletionKind;
  /** Short text shown next to the label: the entry's label. */
  detail?: string;
  /** Plain text, never markdown: the description plus the notes. */
  documentation?: string;
  /** Keeps the database order instead of Monaco's alphabetical one. */
  sortText?: string;
}

export interface CompletionOptions {
  /** False inserts the bare code, even for a cycle. Defaults to true. */
  snippets?: boolean;
  /** Needed for the notes in `documentation`; without it only the description is shown. */
  t?: Translate;
  /** The state the line before the cursor left behind (Klartext `~`). */
  prev?: LineState;
  /**
   * The profile the text is written for; it decides how a snippet is laid out (the
   * continuation marker of a multi-line cycle, and whether a word address takes a space
   * before its value). `completionsAt` passes it; without it the ISO layout is used.
   */
  profile?: CompiledProfile;
}

/** Where a suggestion goes and what it is filtered by. */
export interface CompletionContext {
  /** What has been typed for this word; `''` right after a separator. */
  prefix: string;
  /** Offset the suggestion replaces from (UTF-16, into the line). */
  start: number;
  /** Offset it replaces to: the cursor. */
  end: number;
  /** True when nothing but a block number or a block skip stands before the word. */
  atBlockStart: boolean;
  /**
   * A wider prefix that reaches back over the bare words before the cursor, for the
   * multi-word codes of Klartext (`CYCL DEF 20`, `TOOL CA`). Null when there are none.
   */
  wide: { prefix: string; start: number } | null;
}

/** The suggestions for one position, or null when this place takes none at all. */
export interface CompletionResult {
  items: CompletionSpec[];
  start: number;
  end: number;
}

/** Token kinds a half-typed code can be sitting in. */
const PREFIXABLE = new Set<NcToken['kind']>(['word', 'keyword', 'unknown']);

/** Token kinds that may stand before a word and still leave it at the start of a block. */
const BEFORE_BLOCK_START = new Set<NcToken['kind']>(['whitespace', 'blockNumber', 'skip']);

/** A word that carries no value and no digits: a keyword, or the head of one. */
const BARE_WORD = /^[A-Za-z]+(?: +[A-Za-z]+)*$/;

/** A Klartext cycle parameter: `Q200`, `QL5`. Each one is a line of its own. */
const Q_PARAMETER = /^Q[LRS]?\d+$/i;

/** A word address written out in letters (`MB`, `REP`), not a single letter plus digits. */
const WORD_ADDRESS = /^[A-Za-z]{2,}$/;

/** How far a Q-style cycle indents its parameter lines, as the control writes them. */
const CYCLE_INDENT = '   ';

/** The tab stop that stands in for the cycle name a control writes in its own language. */
const CYCLE_NAME = '${1:NAME}';

/** Characters Monaco's snippet parser reads as syntax. */
const SNIPPET = /[$}\\]/g;

function escapeSnippet(text: string): string {
  return text.replace(SNIPPET, '\\$&');
}

/** What the profile needs an inserted block to look like. */
interface SnippetStyle {
  /** The literal that joins a block to its continuation line (Klartext `~`), or `''`. */
  continuation: string;
  /** True when a word address needs a space before its value (Klartext `MB 50`). */
  spacedWords: boolean;
}

function styleOf(cp: CompiledProfile | undefined): SnippetStyle {
  return {
    continuation: cp?.profile.syntax.continuationMark ?? '',
    spacedWords: cp?.profile.syntax.wordSeparatorRequired === true,
  };
}

/** `G83 Z${1} R${2} Q${3} F${4}`, or null when the entry has no required parameter. */
function snippetFor(entry: CodeEntry, style: SnippetStyle): string | null {
  const required = (entry.params ?? []).filter((param) => param.required);
  if (required.length === 0) return null;

  const code = escapeSnippet(entry.code);

  // A Klartext Q-style cycle is one *logical* block spread over several lines: a header
  // carrying the cycle name, then one indented line per parameter, and every line but the
  // last ends in the profile's continuation marker. Leaving the markers out does not give
  // a syntax error — the control reads the parameter lines as separate assignments and
  // runs the cycle with whatever values it held before, which is a different program.
  if (required.every((param) => Q_PARAMETER.test(param.address))) {
    const mark = style.continuation === '' ? '' : ` ${style.continuation}`;
    const lines = [
      `${code} ${CYCLE_NAME}`,
      ...required.map((param, i) => `${CYCLE_INDENT}${escapeSnippet(param.address)}=\${${i + 2}}`),
    ];
    return lines.map((text, i) => (i + 1 === lines.length ? text : text + mark)).join('\n');
  }

  // Every other parameter stays in the block it belongs to. A profile that separates its
  // words needs a space between a spelled-out address and its value (`M140 MB 50`); a
  // single letter takes none in either dialect (`G83 Z-5.`, `CR R+15`).
  const stops = required.map((param, i) => {
    const gap = style.spacedWords && WORD_ADDRESS.test(param.address) ? ' ' : '';
    return `${escapeSnippet(param.address)}${gap}\${${i + 1}}`;
  });
  return `${code} ${stops.join(' ')}`;
}

/**
 * What kind of icon the entry deserves.
 *
 * `cycle` is the snippet icon in `monaco/providers/completion.ts`, and that icon is a
 * promise that accepting the item leaves tab stops to fill in. So it is decided by what
 * the item *inserts*, not by the group alone: a cycle with no required parameter
 * (`G80`, `CYCL CALL`, `M89`, `M99`) inserts the bare code and is drawn like any other
 * code. The same holds when snippets are switched off for all of them.
 */
function kindOf(entry: CodeEntry, snippet: boolean): CompletionKind {
  if (snippet && entry.group === 'cycle') return 'cycle';
  return /^[A-Za-z]\d/.test(entry.code) ? 'code' : 'keyword';
}

/** The description plus the notes, as plain text. */
function documentationFor(entry: CodeEntry, t: Translate | undefined): string | undefined {
  const lines: string[] = [];
  if (entry.description) lines.push(entry.description);
  if (t) {
    const required = (entry.params ?? []).filter((param) => param.required).map((param) => param.address);
    if (required.length > 0) lines.push(t('assistant.completion.required', { list: required.join(', ') }));
    if (entry.modal) lines.push(t('assistant.completion.modal'));
    // An entry nobody has confirmed yet may be offered, but it says so (content rule).
    if (entry.verify) lines.push(t('assistant.completion.unverified'));
  }
  return lines.length === 0 ? undefined : lines.join('\n\n');
}

/** Builds the suggestions for `entries`, keeping the order they come in. */
export function completionItems(entries: CodeEntry[], o: CompletionOptions = {}): CompletionSpec[] {
  const snippets = o.snippets !== false;
  const style = styleOf(o.profile);
  return entries.map((entry, i) => {
    const snippet = snippets ? snippetFor(entry, style) : null;
    return {
      label: entry.code,
      insertText: snippet ?? entry.code,
      snippet: snippet !== null,
      kind: kindOf(entry, snippet !== null),
      detail: entry.label,
      documentation: documentationFor(entry, o.t),
      sortText: String(i).padStart(4, '0'),
    };
  });
}

// ---------------------------------------------------------------------------
// Where the cursor is
// ---------------------------------------------------------------------------

/** The last token of the line head, whitespace included. */
function lastOf(tokens: NcToken[]): NcToken | null {
  return tokens.length === 0 ? null : tokens[tokens.length - 1];
}

/** A character the probe below appends: a letter starts a word anywhere it is allowed. */
const PROBE = 'A';

/** Kinds that are prose rather than code: no suggestion belongs inside them. */
const PROSE = new Set<NcToken['kind']>(['comment', 'string']);

/**
 * True when a word typed at the end of `head` would land inside a comment or a string.
 *
 * Looking at the last token alone is not enough. A comment without an end marker gives
 * its trailing whitespace back, so that a Klartext `; TEXT ~` keeps its continuation
 * marker outside the comment (`commentEndAt`, tokenizer.ts) — and `12 ; ROUGHING ` then
 * ends in a whitespace token although the cursor sits in the middle of prose. Tokenizing
 * one character further asks the tokenizer the question directly, and it answers for a
 * closed `( … )` comment too, after which code may legitimately follow.
 *
 * The probe only runs when the head really ends in whitespace behind prose, so the common
 * case still tokenizes the line once.
 */
function inProse(head: string, tokens: NcToken[], cp: CompiledProfile, prev?: LineState): boolean {
  const last = lastOf(tokens);
  if (last === null) return false;
  if (PROSE.has(last.kind)) return true;
  if (last.kind !== 'whitespace') return false;
  const before = tokens[tokens.length - 2];
  if (before === undefined || !PROSE.has(before.kind)) return false;
  const probe = lastOf(tokenizeLine(head + PROBE, cp, prev).tokens);
  return probe !== null && PROSE.has(probe.kind);
}

/** True for a token that may stand inside a half-typed multi-word code. */
function isBareWord(token: NcToken): boolean {
  if (token.kind !== 'word' && token.kind !== 'keyword') return false;
  return token.valueText === undefined && BARE_WORD.test(token.text);
}

/**
 * What a completion at `offset` replaces and filters by, or null inside a comment or a
 * string, where NC code is prose and a suggestion would be noise.
 *
 * Only the head of the line is tokenized, so an unclosed `(` is seen for what it is and
 * the word under the cursor always ends at the cursor.
 */
export function completionContext(
  line: string,
  offset: number,
  cp: CompiledProfile,
  prev?: LineState,
): CompletionContext | null {
  const end = Math.max(0, Math.min(offset, line.length));
  const head = line.slice(0, end);
  const { tokens } = tokenizeLine(head, cp, prev);

  if (inProse(head, tokens, cp, prev)) return null;

  const content = tokens.filter((token) => token.kind !== 'whitespace');
  const current = content[content.length - 1];
  const onWord = current !== undefined && current.end === end && PREFIXABLE.has(current.kind);
  const before = onWord ? content.slice(0, -1) : content;

  const start = onWord ? current.start : end;
  const atBlockStart = before.every((token) => BEFORE_BLOCK_START.has(token.kind));

  // `CYCL DEF 20` and `TOOL CA` are one code in two or three words. The prefix may reach
  // back over them as long as everything between the block number and the cursor is a
  // bare word — `L X+10 R` must not, or an axis word would end up inside the prefix.
  let wide: CompletionContext['wide'] = null;
  if (!atBlockStart) {
    const words = before.filter((token) => !BEFORE_BLOCK_START.has(token.kind));
    if (words.length > 0 && words.every(isBareWord)) {
      const from = words[0].start;
      wide = { prefix: head.slice(from), start: from };
    }
  }

  return { prefix: head.slice(start), start, end, atBlockStart, wide };
}

/**
 * The suggestions for a position in a line: the whole path from the text to the specs.
 *
 * Null means "no suggestions here at all" (a comment or a string); an empty `items` means
 * "nothing in the database matches", which is a different answer for the provider.
 */
export function completionsAt(
  line: string,
  offset: number,
  cp: CompiledProfile,
  db: CodeDb,
  o: CompletionOptions = {},
): CompletionResult | null {
  const context = completionContext(line, offset, cp, o.prev);
  if (!context) return null;

  // The snippet layout follows the profile the line is written in, so the caller never
  // has to pass it twice.
  const options: CompletionOptions = { ...o, profile: o.profile ?? cp };

  if (context.wide) {
    const entries = completionsFor(db, context.wide.prefix, true);
    if (entries.length > 0) {
      return { items: completionItems(entries, options), start: context.wide.start, end: context.end };
    }
  }

  const entries = completionsFor(db, context.prefix, context.atBlockStart);
  return { items: completionItems(entries, options), start: context.start, end: context.end };
}
