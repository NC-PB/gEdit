// Remove block numbers (plan §5 WP4.2 and WP6.3). Owner: **WP6.3** (was WP4.2).
//
// Drops the block number and the whitespace that followed it, and nothing else:
// `/N100 G0` becomes `/G0`, `N120/G0` keeps its skip mark, `(N50)` inside a comment stays
// untouched, and a block that had no number is left exactly as it was.
//
// Not available when `syntax.blockNumber.mandatory` is set: a control that refuses an
// unnumbered block would reject the whole program, so `available()` answers with the
// reason instead of producing a file that cannot run.
//
// ## Why this is a two-line edit and still needs the tokenizer
//
// `line.replace(/^N\d+\s*/, '')` gets `/N100 G0` wrong, gets `N120/G0` wrong, and eats
// the `N50` of a line that begins `N50` inside nothing at all. `tokenizeLine` marks the
// one span that is a block number — it is only ever produced at the head of a block, and
// never inside a comment, a string or a Klartext continuation line — so the edit is
// "cut that span plus the whitespace behind it" and cannot reach anything else.
//
// A line that held nothing but its block number becomes empty. That is what removing the
// numbers means, but such a line is usually a jump target, so each one is reported to the
// results panel with a warning.
//
// ## The jump targets
//
// This transform is strictly more destructive than `renumber`: a renumber leaves *a*
// number on the target block, so a `GOTO 100` lands on the wrong block; removing the
// numbers leaves no target at all, and the control alarms. It used to be the quieter of
// the two all the same — no preflight, no reference warning, nothing (G8 M4).
//
// M6 (WP6.3) turns that warning into a rule: **`keepReferenced` keeps the numbers that
// are pointed at**, and it is on wherever the profile knows what a reference looks like.
// A tidy-up of the block numbers then leaves `N100` and `N200` standing under their
// `G71 P100 Q200`, the program still runs, and the results panel lists every number that
// was kept and why. Turning it off removes them all, which is what the command used to
// do; then — and on a fragment, where a pointer from outside cannot be seen — the
// confirmation of Phase 1 is asked first.
//
// The one pointer `keepReferenced` cannot keep is a **computed** one: `GOTO #100` works
// its target out while the program runs, so no number here can be held on to and that
// block loses its number like any other. That case is confirmed and reported whichever
// way the option stands — switching the option on made the program safer everywhere else
// and must not be what silences the warning (G8 M6).
//
// The kept numbers are decided over the **whole document** and not per program: `M99 P20`
// in a subprogram names the `N20` of its **caller** (F42), so a per-program answer would
// delete exactly the block that must stay. Keeping a number twice over costs nothing; a
// missing jump target costs a crashed program.

import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { t } from '$lib/i18n';
import { continuationRisk, stateBefore } from './fragment';
import { referenceAddresses, referencePreflight, referencesOn, scanProgram } from './references';
import type { Located, Msg } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import type { LineState } from '$lib/core/nc/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext, TransformDef, TransformResult } from './types';

/** Rows the results panel gets at most; the warning still counts every emptied line. */
const ROW_LIMIT = 200;

const TAB = 0x09;
const SPACE = 0x20;

function isSpaceCode(code: number): boolean {
  return code === SPACE || code === TAB;
}

/** True while the line holds nothing but spaces and tabs. */
function isBlank(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (!isSpaceCode(line.charCodeAt(i))) return false;
  return true;
}

/** Whether the dialect describes block-number references at all (Klartext does not). */
function knowsReferences(cp: CompiledProfile): boolean {
  return cp.re.references.length > 0;
}

/** The one option, and only where there is something to decide. */
function optionFields(cp: CompiledProfile): FieldSpec[] {
  if (!knowsReferences(cp)) return [];
  return [
    {
      id: 'keepReferenced',
      type: 'bool',
      label: t('ncNumbering.removeBlockNumbers.fields.keepReferenced.label'),
      help: t('ncNumbering.removeBlockNumbers.fields.keepReferenced.help'),
      default: true,
    },
  ];
}

function keepReferencedOf(cp: CompiledProfile, options: Record<string, unknown>): boolean {
  if (!knowsReferences(cp)) return false;
  return typeof options.keepReferenced === 'boolean' ? options.keepReferenced : true;
}

/**
 * True when the scope holds at least one block number, so the run has something to do.
 *
 * Costs one pass over the scope, which the run pays anyway. It is what keeps the
 * confirmation below off a program that has nothing to remove: a dialog that asks
 * whether to break the jumps of a program the run will not touch is a dialog people
 * learn to click through.
 */
function hasBlockNumber(lines: string[], ctx: TransformContext): boolean {
  let state: LineState | undefined = stateBefore(ctx);
  for (const line of lines) {
    const { tokens, state: next } = tokenizeLine(line, ctx.cp, state);
    state = next;
    if (tokens.some((token) => token.kind === 'blockNumber')) return true;
  }
  return false;
}

/**
 * The lines carrying a reference `keepReferenced` cannot keep, and the first of them.
 *
 * A reference whose value is a variable or an expression — `GOTO #100`, `M98 Q[#1]` —
 * names no number, so there is nothing for the run to hold on to and the block it lands
 * on is removed like any other. This is the one case where `keepReferenced` on is not
 * safer than off, and before M6 it was at least confirmed and warned about (G8 M6).
 */
function computedOf(scan: ReturnType<typeof scanProgram>): { count: number; first: number } {
  const rows = new Set<number>();
  for (const { row, word } of scan.found) if (word.target === null) rows.add(row);
  let first = 0;
  for (const row of rows) {
    const line = scan.firstLine + row;
    if (first === 0 || line < first) first = line;
  }
  return { count: rows.size, first };
}

/**
 * The confirmation this transform asks for: the jump targets it is about to delete.
 *
 * With `keepReferenced` on the numbers a pointer names stay, so the only ones left to ask
 * about are the computed pointers, whose target cannot be named here at all
 * ([`computedOf`]) — and what the run cannot see: a fragment with no document behind it,
 * where a pointer from above would keep a number that is about to go. With the option
 * off, the Phase 1 confirmation is asked in full, over the whole document rather than
 * over the selection.
 */
function preflightOf(lines: string[], ctx: TransformContext): Msg | null {
  if (!hasBlockNumber(lines, ctx)) return null;
  if (continuationRisk(ctx, stateBefore(ctx))) return { key: 'ncNumbering.removeBlockNumbers.fragmentUnknown' };

  const scan = scanProgram(lines, ctx);
  const keep = keepReferencedOf(ctx.cp, ctx.options);
  const computed = computedOf(scan);
  return referencePreflight(
    keep
      ? { count: computed.count, first: computed.first, unchecked: scan.unchecked }
      : { count: scan.count, first: scan.first, unchecked: scan.unchecked },
    {
      references: keep ? 'ncNumbering.removeBlockNumbers.computed' : 'ncNumbering.removeBlockNumbers.references',
      unchecked: 'ncNumbering.removeBlockNumbers.referencesUnchecked',
    },
  );
}

function runRemove(lines: string[], ctx: TransformContext): TransformResult {
  const cp = ctx.cp;
  const keep = keepReferencedOf(cp, ctx.options);
  const emptiedRow = t('ncNumbering.removeBlockNumbers.emptiedRow');
  const referenceRow = t('ncNumbering.removeBlockNumbers.referenceRow');
  const computedRow = t('ncNumbering.removeBlockNumbers.computedRow');
  const keptRow = t('ncNumbering.removeBlockNumbers.keptReferencedRow');
  const addresses = referenceAddresses(cp);

  // Which numbers a jump, a return or a cycle points at. Read from the document when
  // there is one: a `GOTO 100` above the selection needs the `N100` inside it just as
  // much as one below it does.
  const referenced = new Set<number>();
  if (keep) {
    for (const { word } of scanProgram(lines, ctx).found) if (word.target !== null) referenced.add(word.target);
  }

  const out = lines.slice();
  const lineMap = new Int32Array(lines.length);
  const skipped: Located[] = [];
  const warnings: Msg[] = [];
  let removed = 0;
  let emptied = 0;
  let references = 0;
  let computed = 0;
  let kept = 0;
  // The state `lines[0]` begins in, so a Klartext selection that starts inside a `~`
  // block does not read the tail of that block as a numbered head (`fragment.ts`).
  let state: LineState | undefined = stateBefore(ctx);

  const note = (index: number, message: string, severity: Located['severity'] = 'warning'): void => {
    if (skipped.length < ROW_LIMIT) skipped.push({ line: ctx.firstLine + index, message, severity });
  };

  for (let i = 0; i < lines.length; i++) {
    lineMap[i] = i;
    const line = lines[i];
    const { tokens, state: next } = tokenizeLine(line, cp, state);
    state = next;

    // Listed before the number goes: this is the line that will still point at a block
    // number the program no longer has. With `keepReferenced` the number stays and the
    // line is not a finding — **unless** the reference is a computed one, because then
    // there is no number to keep and the target goes with the rest (G8 M6).
    const words = addresses.size > 0 ? referencesOn(tokens, line, cp, addresses) : [];
    if (!keep && words.length > 0) {
      references++;
      note(i, referenceRow);
    } else if (keep && words.some((word) => word.target === null)) {
      computed++;
      note(i, computedRow);
    }

    // At most one, and only ever at the head of a block (`tokenizeLine`).
    const number = tokens.find((token) => token.kind === 'blockNumber');
    if (number === undefined) continue;

    if (keep && number.valueText !== undefined && referenced.has(Number(number.valueText))) {
      kept++;
      note(i, keptRow, 'info');
      continue;
    }

    let end = number.end;
    while (end < line.length && isSpaceCode(line.charCodeAt(end))) end++;
    out[i] = line.slice(0, number.start) + line.slice(end);
    removed++;

    if (isBlank(out[i]) && !isBlank(line)) {
      emptied++;
      note(i, emptiedRow);
    }
  }

  // A run that removed nothing reports nothing. The reference rows were collected while
  // walking, before it was known whether any number would go; a program whose numbers
  // are already gone would otherwise be told that its jumps point at numbers this run
  // removed, which it did not.
  if (removed === 0 && kept === 0) skipped.length = 0;

  if (emptied > 0) warnings.push({ key: 'ncNumbering.removeBlockNumbers.emptied', params: { count: emptied } });
  if (kept > 0) warnings.push({ key: 'ncNumbering.removeBlockNumbers.keptReferenced', params: { count: kept } });
  if (removed > 0 && references > 0) {
    warnings.push({ key: 'ncNumbering.removeBlockNumbers.referencesKept', params: { count: references } });
  }
  if (removed > 0 && computed > 0) {
    warnings.push({ key: 'ncNumbering.removeBlockNumbers.referencesComputed', params: { count: computed } });
  }
  const listed = removed === 0 && kept === 0 ? 0 : emptied + references + computed + kept;
  if (listed > skipped.length) {
    warnings.push({ key: 'ncNumbering.removeBlockNumbers.skippedTruncated', params: { shown: skipped.length, total: listed } });
  }

  const summary: Msg =
    removed > 0
      ? { key: 'ncNumbering.removeBlockNumbers.summary', params: { count: removed } }
      : kept > 0
        ? { key: 'ncNumbering.removeBlockNumbers.allKept', params: { count: kept } }
        : { key: 'ncNumbering.removeBlockNumbers.nothing' };

  return { lines: out, lineMap, summary, skipped, warnings };
}

export const removeBlockNumbers: TransformDef = {
  id: 'remove-block-numbers',
  title: 'ncNumbering.removeBlockNumbers.title',
  available(cp: CompiledProfile): true | Msg {
    return cp.profile.syntax.blockNumber.mandatory === true ? { key: 'ncNumbering.removeBlockNumbers.mandatory' } : true;
  },
  options(cp: CompiledProfile): FieldSpec[] {
    return optionFields(cp);
  },
  preflight(lines: string[], ctx: TransformContext): Msg | null {
    return preflightOf(lines, ctx);
  },
  run(lines: string[], ctx: TransformContext): TransformResult {
    return runRemove(lines, ctx);
  },
};
