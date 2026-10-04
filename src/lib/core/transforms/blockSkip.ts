// Insert and remove block skip (plan §6 M10, WP10.1). Owner: WP10.1.
//
// The skip mark (`/`, on some controls `/1` to `/9`) makes the control leave a block out
// while the operator's switch is on. A prove-out section is wrapped in it, then taken out
// again. Two transforms, `blockSkipAdd` and `blockSkipRemove`, one command each.
//
// ## Where the mark stands
//
// The profile says (`syntax.blockSkip.position`): before the block number, after it, or
// either. `either` is decided by the dialect's own habit, because the two are not
// interchangeable in practice. A prefix number (`N100`) takes the mark in front (`/N100
// G0`, the Fanuc and Okuma manuals), a leading-integer number (Klartext) takes it behind
// (`12 /L X+0`, the Heidenhain manuals). A line with no number takes the mark at its head
// whatever the position says.
//
// ## What is never touched
//
// Everything rests on the tokenizer, which produces a `skip` token only at the head of a
// block or behind its number. That is why a `/` that divides (`#1=#2/2`, `R1=R2/2`,
// `[#1/#2]`) can neither be removed nor mistaken for a mark: it is not a `skip` token, and
// the insert position is never inside the block.
//
//  - **Already marked** lines are not marked twice, whatever their level. A line that
//    carries a *different* level than the one asked for is listed, because a second mark
//    would change which switch skips it.
//  - **Blank lines** get no mark: a lone `/` is a block that does nothing.
//  - **Continuation lines** (a Klartext `~` tail, an Okuma `$` line) belong to the block
//    above; its first line carries the mark for all of them. When the scope *starts* inside
//    such a block, its head is above the scope and stays unmarked: said in a warning.
//  - **Program markers** (`%`, `O1001`, a program name, Klartext `BEGIN PGM` and its closing
//    `END PGM` (`program.endRecord`), the decisive header lines of Sinumerik and Okuma) are not
//    blocks the program skips; a skipped program number would hide the program from the
//    control. They are left and listed.
//  - **Levels are kept.** Removing level 2 leaves `/1` and `/3`; removing all levels is the
//    default. The bare `/` is the profile's `plainLevel`: `/` and `/0` are one level on
//    Sinumerik (syntax-sinumerik §3.1), `/` and `/1` on Fanuc (BDT1); the form calls it
//    "plain".
//
// Removal cuts the mark and the blanks behind it, so adding and removing are inverses
// (`N100 G0` ⇄ `/N100 G0`, `12 L X+0` ⇄ `12 /L X+0`, `N120G0` ⇄ `N120/G0`).
//
// The result keeps the input's length and line order (`lineMap` is the identity), so
// bookmarks and folds stay where they are.

import type { Located, Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import { maskComments } from '$lib/core/nc/mask';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { DECISIVE_WEIGHT } from '$lib/core/profiles/detect';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import { t } from '$lib/i18n';
import { continuationRisk, stateBefore } from './fragment';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** Rows the results panel gets at most; the summary still counts every line. */
const ROW_LIMIT = 200;

/** The form values for "all levels" and "no level / level 0" on removal; add uses '' for plain. */
const ALL = 'all';
const PLAIN = 'plain';

const TAB = 0x09;
const SPACE = 0x20;

function isSpaceCode(code: number): boolean {
  return code === SPACE || code === TAB;
}

function isBlank(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (!isSpaceCode(line.charCodeAt(i))) return false;
  return true;
}

interface SkipSyntax {
  chars: string;
  position: 'before-number' | 'after-number' | 'either';
  levels: boolean;
  /** The digit a bare mark is (`syntax.blockSkip.plainLevel`): `'0'` on Sinumerik, `'1'` on Fanuc. */
  plain: string;
}

function skipSyntaxOf(cp: CompiledProfile): SkipSyntax | null {
  const skip = cp.profile.syntax.blockSkip;
  if (!skip || typeof skip.chars !== 'string' || skip.chars === '') return null;
  const plain = typeof skip.plainLevel === 'string' && /^[0-9]$/.test(skip.plainLevel) ? skip.plainLevel : '0';
  return { chars: skip.chars, position: skip.position ?? 'either', levels: skip.levels === true, plain };
}

function availability(cp: CompiledProfile): true | Msg {
  return skipSyntaxOf(cp) === null ? { key: 'ncBlockSkip.unavailable', params: { profile: cp.profile.name } } : true;
}

/** `'1'`…`'9'` as choices. */
function levelChoices(): { label: string; value: unknown }[] {
  return ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((level) => ({ label: `/${level}`, value: level }));
}

/** The level a skip token writes: `''` for `/`, the digit otherwise. */
function levelOf(token: NcToken, mark: string): string {
  return token.text.slice(mark.length);
}

/**
 * Whether a written level is the one asked for. The bare mark is the profile's plain level
 * (M10 review, NC-9): `/` is `/0` on Sinumerik and `/1` on Fanuc (BDT1, "`/` or `/1`").
 */
function levelMatches(wanted: string, written: string, plain: string): boolean {
  if (wanted === ALL) return true;
  const level = written === '' ? plain : written;
  return level === (wanted === PLAIN ? plain : wanted);
}

function optionString(ctx: TransformContext, fallback: string): string {
  const value = ctx.options.level;
  return typeof value === 'string' && value !== '' ? value : fallback;
}

/** Where a mark goes on a line that has none: an offset into `line`, and whether a number precedes it. */
function insertionPoint(line: string, tokens: NcToken[], skip: SkipSyntax, cp: CompiledProfile): number {
  let head = 0;
  while (head < line.length && isSpaceCode(line.charCodeAt(head))) head++;
  const number = tokens.find((token) => token.kind === 'blockNumber' || token.kind === 'label');
  if (number === undefined || number.kind === 'label') return head;
  const behind =
    skip.position === 'after-number' ||
    (skip.position === 'either' && cp.profile.syntax.blockNumber.mode === 'leading-integer');
  if (!behind) return head;
  let at = number.end;
  while (at < line.length && isSpaceCode(line.charCodeAt(at))) at++;
  return at;
}

/** True when the line is a file header the control reads (see `removeComments`). */
function isHeaderLine(line: string, cp: CompiledProfile): boolean {
  const trimmed = line.trim();
  for (const rule of cp.re.detectContent) if (rule.weight >= DECISIVE_WEIGHT && rule.re.test(trimmed)) return true;
  return false;
}

/** True when the line opens the program (Klartext `BEGIN PGM`), outside any comment. */
function isProgramStart(line: string, cp: CompiledProfile): boolean {
  if (cp.re.programStart.length === 0) return false;
  const masked = maskComments(line, cp);
  return cp.re.programStart.some((re) => re.test(masked));
}

/**
 * True when the line is the closing record of the program (Klartext `END PGM`): the profile
 * says so with `program.endRecord` (M10 review, NC-8). An ordinary end block (`M30`) is not.
 */
function isProgramEndRecord(line: string, cp: CompiledProfile): boolean {
  if (cp.profile.program.endRecord !== true || cp.re.programEnd.length === 0) return false;
  const masked = maskComments(line, cp);
  return cp.re.programEnd.some((re) => re.test(masked));
}

/** The first token that is neither blank nor a skip mark. */
function firstCode(tokens: NcToken[]): NcToken | null {
  for (const token of tokens) if (token.kind !== 'whitespace' && token.kind !== 'skip') return token;
  return null;
}

/** Whether an Okuma-style `$` line continues the block above. */
function startsContinuation(line: string, cp: CompiledProfile): boolean {
  return cp.re.continuationStart?.test(line) === true;
}

interface Walk {
  line: string;
  tokens: NcToken[];
  /** The line is the tail of the block above (`~` or `$`). */
  tail: boolean;
}

/** Tokenizes the scope once, carrying the state from line to line. */
function walk(lines: string[], ctx: TransformContext): Walk[] {
  const out: Walk[] = [];
  let state: LineState | undefined = stateBefore(ctx);
  for (const line of lines) {
    const tail = state?.continuation === true || startsContinuation(line, ctx.cp);
    const result = tokenizeLine(line, ctx.cp, state);
    state = result.state;
    out.push({ line, tokens: result.tokens, tail });
  }
  return out;
}

/** The scope starts inside a block whose head is above it. */
function startsInsideBlock(lines: string[], ctx: TransformContext): boolean {
  if (lines.length === 0) return false;
  if (continuationRisk(ctx, stateBefore(ctx))) return true;
  return Math.trunc(ctx.firstLine) > 1 && startsContinuation(lines[0], ctx.cp);
}

function note(skipped: Located[], line: number, message: string, severity: Located['severity'] = 'info'): void {
  if (skipped.length < ROW_LIMIT) skipped.push({ line, message, severity });
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

function addFields(cp: CompiledProfile): FieldSpec[] {
  const skip = skipSyntaxOf(cp);
  if (skip === null || !skip.levels) return [];
  return [
    {
      id: 'level',
      type: 'choice',
      label: t('ncBlockSkip.fields.level.label'),
      help: t('ncBlockSkip.fields.level.addHelp'),
      default: PLAIN,
      choices: [{ label: t('ncBlockSkip.plain'), value: PLAIN }, ...levelChoices()],
    },
  ];
}

function runAdd(lines: string[], ctx: TransformContext): TransformResult {
  const cp = ctx.cp;
  const skip = skipSyntaxOf(cp);
  const out = lines.slice();
  const lineMap = new Int32Array(lines.length);
  const skipped: Located[] = [];
  const warnings: Msg[] = [];
  if (skip === null) {
    for (let i = 0; i < lines.length; i++) lineMap[i] = i;
    return { lines: out, lineMap, summary: { key: 'ncBlockSkip.addRun.nothing' }, skipped, warnings };
  }

  const mark = skip.chars[0];
  const level = skip.levels ? optionString(ctx, PLAIN) : PLAIN;
  const written = mark + (level === PLAIN ? '' : level);
  const programRow = t('ncBlockSkip.addRun.programRow');
  let marked = 0;
  let already = 0;

  const rows = walk(lines, ctx);
  for (let i = 0; i < rows.length; i++) {
    lineMap[i] = i;
    const { line, tokens, tail } = rows[i];
    if (isBlank(line) || tail) continue;

    const present = tokens.filter((token) => token.kind === 'skip');
    if (present.length > 0) {
      already++;
      if (skip.levels && !present.some((token) => levelMatches(level, levelOf(token, mark), skip.plain))) {
        note(skipped, ctx.firstLine + i, t('ncBlockSkip.addRun.otherLevelRow', { level: present.map((p) => p.text).join(' ') }));
      }
      continue;
    }

    const first = firstCode(tokens);
    if (first === null) continue;
    if (first.kind === 'programMarker' || isHeaderLine(line, cp) || isProgramStart(line, cp) || isProgramEndRecord(line, cp)) {
      note(skipped, ctx.firstLine + i, programRow);
      continue;
    }

    const at = insertionPoint(line, tokens, skip, cp);
    // A level is a digit, and a digit runs into the word behind it (`/1G1`): a blank after it.
    const behind = level !== PLAIN && at < line.length && !isSpaceCode(line.charCodeAt(at)) ? ' ' : '';
    out[i] = line.slice(0, at) + written + behind + line.slice(at);
    marked++;
  }

  if (startsInsideBlock(lines, ctx) && lines.length > 0 && !isBlank(lines[0])) {
    warnings.push({ key: 'ncBlockSkip.addRun.startsInside' });
  }
  if (already > 0) warnings.push({ key: 'ncBlockSkip.addRun.already', params: { count: already } });

  const summary: Msg =
    marked > 0
      ? { key: 'ncBlockSkip.addRun.summary', params: { count: marked } }
      : { key: 'ncBlockSkip.addRun.nothing' };
  return { lines: out, lineMap, summary, skipped, warnings };
}

/**
 * A run that marks every line of the program is almost never what was meant: the command
 * works on the selection, and without one it takes the whole file. Asked once, before.
 */
function preflightAdd(lines: string[], ctx: TransformContext): Msg | null {
  const document = ctx.document;
  const whole = document === undefined ? Math.trunc(ctx.firstLine) <= 1 : document.length === lines.length;
  if (!whole) return null;
  if (!lines.some((line) => !isBlank(line))) return null;
  return { key: 'ncBlockSkip.addRun.wholeProgram' };
}

export const blockSkipAdd: TransformDef = {
  id: 'block-skip-add',
  title: 'ncBlockSkip.add',
  available: availability,
  options: addFields,
  preflight: preflightAdd,
  run: runAdd,
};

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

function removeFields(cp: CompiledProfile): FieldSpec[] {
  const skip = skipSyntaxOf(cp);
  if (skip === null || !skip.levels) return [];
  return [
    {
      id: 'level',
      type: 'choice',
      label: t('ncBlockSkip.fields.level.label'),
      help: t('ncBlockSkip.fields.level.removeHelp'),
      default: ALL,
      choices: [
        { label: t('ncBlockSkip.allLevels'), value: ALL },
        { label: t('ncBlockSkip.plain'), value: PLAIN },
        ...levelChoices(),
      ],
    },
  ];
}

function runRemove(lines: string[], ctx: TransformContext): TransformResult {
  const cp = ctx.cp;
  const skip = skipSyntaxOf(cp);
  const out = lines.slice();
  const lineMap = new Int32Array(lines.length);
  const skipped: Located[] = [];
  const warnings: Msg[] = [];
  for (let i = 0; i < lines.length; i++) lineMap[i] = i;
  if (skip === null) return { lines: out, lineMap, summary: { key: 'ncBlockSkip.removeRun.nothing' }, skipped, warnings };

  const mark = skip.chars[0];
  const wanted = skip.levels ? optionString(ctx, ALL) : ALL;
  const separated = cp.profile.syntax.wordSeparatorRequired === true;
  let removed = 0;
  let kept = 0;

  const rows = walk(lines, ctx);
  for (let i = 0; i < rows.length; i++) {
    const { line, tokens } = rows[i];
    const marks = tokens.filter((token) => token.kind === 'skip');
    if (marks.length === 0) continue;

    let text = '';
    let at = 0;
    let cutAny = false;
    for (const token of marks) {
      if (!levelMatches(wanted, levelOf(token, mark), skip.plain)) {
        kept++;
        continue;
      }
      let end = token.end;
      while (end < line.length && isSpaceCode(line.charCodeAt(end))) end++;
      text += line.slice(at, token.start);
      // Two words that were held apart by the mark alone stay apart on a control that needs it.
      const before = text.length > 0 ? text.charCodeAt(text.length - 1) : SPACE;
      const after = end < line.length ? line.charCodeAt(end) : SPACE;
      if (separated && !isSpaceCode(before) && !isSpaceCode(after)) text += ' ';
      at = end;
      cutAny = true;
    }
    if (!cutAny) continue;
    out[i] = text + line.slice(at);
    removed++;
  }

  if (kept > 0) warnings.push({ key: 'ncBlockSkip.removeRun.keptLevels', params: { count: kept } });
  for (let i = 0; i < rows.length && kept > 0; i++) {
    const marks = rows[i].tokens.filter((token) => token.kind === 'skip');
    const left = marks.filter((token) => !levelMatches(wanted, levelOf(token, mark), skip.plain));
    if (left.length > 0) note(skipped, ctx.firstLine + i, t('ncBlockSkip.removeRun.keptRow', { level: left.map((l) => l.text).join(' ') }));
  }

  const summary: Msg =
    removed > 0
      ? { key: 'ncBlockSkip.removeRun.summary', params: { count: removed } }
      : { key: 'ncBlockSkip.removeRun.nothing' };
  return { lines: out, lineMap, summary, skipped, warnings };
}

export const blockSkipRemove: TransformDef = {
  id: 'block-skip-remove',
  title: 'ncBlockSkip.remove',
  available: availability,
  options: removeFields,
  run: runRemove,
};
