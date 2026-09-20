// Renumber blocks (plan §5 WP4.2, `docs/planning/nc-transformations.md`). Owner: **WP4.2**.
//
// Rewrites the block number at the start of each block. What it must never do:
//
//  - touch a number that is not a block number: `N` inside a comment (`(N50)`), inside a
//    string, or as an address in the middle of a block
//  - lose the block-skip mark: `/N100 G0` keeps its `/`, and `N120/` keeps the `/` where
//    it stood
//  - renumber an alphanumeric block name (`NLAP1`) — it is a label, not a counter
//  - number a program marker: `%`, `O1000` and `:1000` are not blocks, and `N10 :1000`
//    moves the program number out of the first position of the block
//  - update a `GOTO` target silently: `numbering.references` matches become a **preflight
//    warning**, because a renumber that rewrites `GOTO 100` targets is a different, much
//    more dangerous transform. The scan is over the whole document (`references.ts`), not
//    over the selection: a jump *above* the selection points into it just as well.
//  - wrap past the maximum in silence: wrapping writes a second `N10` into the program,
//    and duplicate block numbers are a defect, not a formatting choice. `stop` warned
//    from the start; `wrap` warns now too (G8 M4).
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
import { hasReference, maskedOf, referenceAddresses, referencePreflight, scanReferences } from './references';
import type { Located, Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
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

function settingsFor(cp: CompiledProfile, options: Record<string, unknown>): Settings {
  const numbering = cp.profile.numbering;
  const separated = cp.profile.syntax.wordSeparatorRequired === true;
  // A dialect that separates its words needs at least one space behind the number, or
  // `5 L X+0` would come back as `5L X+0` and stop being a move.
  const minSpaces = separated ? 1 : 0;

  if (numbering.mode === 'consecutive') {
    return {
      consecutive: true,
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

  return {
    consecutive: false,
    start: intOf(options.start, numbering.start ?? 10, 0),
    step: intOf(options.step, numbering.step ?? 10, 1),
    digits: intOf(options.digits, numbering.digits ?? 0, 0),
    max: maxOf(options.max, numbering.max ?? null),
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
  skipBefore: NcToken | null;
  number: NcToken | null;
  /** Only ever set together with `number`: the tokenizer looks for it behind one. */
  skipAfter: NcToken | null;
  /** Offset behind the last head token, or `leadEnd` when the head is empty. */
  end: number;
  /** First non-whitespace offset behind `end`, or `line.length` when there is no code. */
  restStart: number;
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
    if (token.kind === 'skip' && skipAfter === null && (number !== null || skipBefore === null)) {
      if (number === null) skipBefore = token;
      else skipAfter = token;
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
// The transform
// ---------------------------------------------------------------------------

function optionFields(cp: CompiledProfile): FieldSpec[] {
  const numbering = cp.profile.numbering;
  // Klartext: consecutive from 0 in steps of 1 is what the control accepts, so there is
  // nothing to ask. `TransformService` opens no dialog for an empty field list.
  if (numbering.mode === 'consecutive') return [];

  return [
    {
      id: 'start',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.start.label'),
      help: t('ncNumbering.renumber.fields.start.help'),
      default: numbering.start ?? 10,
      required: true,
      min: 0,
      max: 99999999,
    },
    { id: 'step', type: 'integer', label: t('ncNumbering.renumber.fields.step.label'), default: numbering.step ?? 10, required: true, min: 1, max: 100000 },
    {
      id: 'digits',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.digits.label'),
      help: t('ncNumbering.renumber.fields.digits.help'),
      default: numbering.digits ?? 0,
      required: true,
      min: 0,
      max: 9,
    },
    {
      id: 'max',
      type: 'integer',
      label: t('ncNumbering.renumber.fields.max.label'),
      help: t('ncNumbering.renumber.fields.max.help'),
      default: numbering.max ?? undefined,
      min: 1,
      max: 999999999,
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
 *  - the program points at its own block numbers (`GOTO 100`, `M99 P…`, `G71 P…Q…`).
 *    Renumbering rewrites the targets and not the pointers, so the jumps would land
 *    somewhere else. Reference-aware renumbering is a separate, later transform.
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

  return referencePreflight(scanReferences(lines, ctx), {
    references: 'ncNumbering.renumber.references',
    unchecked: 'ncNumbering.renumber.referencesUnchecked',
  });
}

function runRenumber(lines: string[], ctx: TransformContext): TransformResult {
  const settings = settingsFor(ctx.cp, ctx.options);
  const cp = withAltPrefixes(ctx.cp, settings.altPrefixes);
  const caseSensitive = cp.profile.syntax.caseSensitive === true;
  const blockNumber = cp.profile.syntax.blockNumber;
  const prefixOut = blockNumber.mode === 'leading-integer' ? '' : (blockNumber.prefix ?? 'N');
  const namePrefixes = blockNumber.mode === 'leading-integer' ? [] : [prefixOut, ...settings.altPrefixes];
  const marks = settings.skipStartingWith;
  const addresses = referenceAddresses(cp);

  // One lookup per run instead of one per skipped line (`Located.message` is display text).
  const reason = {
    prefix: t('ncNumbering.renumber.skippedByPrefix'),
    name: t('ncNumbering.renumber.skippedName'),
    notNumbered: t('ncNumbering.renumber.skippedNotNumbered'),
    stopped: t('ncNumbering.renumber.skippedStopped'),
    reference: t('ncNumbering.renumber.referenceKept'),
    programMarker: t('ncNumbering.renumber.skippedProgramMarker'),
    wrapped: t('ncNumbering.renumber.wrappedRow'),
  };

  const out = lines.slice();
  const lineMap = new Int32Array(lines.length);
  const skipped: Located[] = [];
  const warnings: Msg[] = [];
  let skippedCount = 0;
  let references = 0;
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
    if (addresses.size > 0 && hasReference(tokens, line, cp, addresses)) {
      references++;
      note(i, reason.reference, 'warning');
    }

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
    if (head.number === null && looksLikeBlockName(line, head.restStart, namePrefixes, caseSensitive)) {
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

    const digits = String(value);
    out[i] = rebuild(line, head, prefixOut + (settings.digits > 0 ? digits.padStart(settings.digits, '0') : digits), settings.spacesAfter);
    numbered++;
    value += settings.step;
  }

  if (wraps > 0) {
    warnings.push({
      key: 'ncNumbering.renumber.wrapped',
      params: { count: wraps, line: firstWrapLine, start: settings.start, max: settings.max ?? 0 },
    });
  }
  // A jump *above* the selection points into it just as well, and the run's own walk
  // only ever saw the selection. The preflight already scanned the document; counting
  // there again keeps the results panel from reporting a clean program (G8 M4).
  const referencesTotal =
    addresses.size > 0 && ctx.firstLine > 1 ? Math.max(references, scanReferences(lines, ctx).count) : references;
  if (referencesTotal > 0) warnings.push({ key: 'ncNumbering.renumber.referencesKept', params: { count: referencesTotal } });
  const listed = skippedCount + references + wraps;
  if (listed > skipped.length) warnings.push({ key: 'ncNumbering.renumber.skippedTruncated', params: { shown: skipped.length, total: listed } });

  const summary: Msg =
    numbered === 0 && skippedCount === 0
      ? { key: 'ncNumbering.renumber.nothing' }
      : skippedCount === 0
        ? { key: 'ncNumbering.renumber.summary', params: { count: numbered } }
        : { key: 'ncNumbering.renumber.summarySkipped', params: { count: numbered, skipped: skippedCount } };

  return { lines: out, lineMap, summary, skipped, warnings };
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
