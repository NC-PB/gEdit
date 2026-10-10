// Cycle forms (Phase 3 plan §6.11, AD-39, P3.8; `docs/planning/code-assistant.md` "Cycle forms").
// Written by the P3b prelude as stubs; owned by P3.8.
//
// "Edit Cycle" (`nc.editCycle`, P3.5 wires it) opens a form with one field per parameter of the
// cycle at the cursor, pre-filled from its block, and rewrites the block on confirm; on a line
// with no cycle it offers the database's cycles and inserts a new block. Pure: the caller passes
// the document's lines, its effective view and the modal state after the block (AD-35).
//
// The rules (binding):
//
//  1. **Which cycles.** An entry with `params` whose `sets.cycle` is `start` (Fanuc, Okuma
//     `G73`–`G89`, `G181`…, Sinumerik `CYCLE81`… by position) or `define` (Klartext `CYCL DEF 2xx`
//     over several lines), and that is not written in two blocks (`blocks: 2`, set by P3.6 on the
//     lathe roughing and threading cycles; the inspector's pairing heuristic also marks such a
//     block, `InspectedCycle.part`). A two-block cycle is refused with the reason
//     (`cycleForm.refused.twoBlocks`): its words cannot be put in the right block until the
//     database says which block each belongs to (`CodeParam.block`, backlog). A `verify` entry is
//     not offered. `cycleEntries(db, machineType)` lists them in database order. A block that
//     only runs or calls a cycle written on another line (a position under a modal `G83`, a
//     Klartext `CYCL CALL`, a position under `MCALL`) is refused with that line
//     (`cycleForm.refused.elsewhere`): the form edits the block that writes the cycle.
//  2. **Reading the block.** The block is `blockRange` of `inspect.ts`; each parameter's value is
//     the word as written (`4.` of `Q4.`, `2` of `Q200=2`, the third argument of `CYCLE83(…)`),
//     never converted; a parameter the block does not write is `''`. A word the database does not
//     know for the cycle is kept (`CycleForm.kept`), as are the block number, the other codes
//     (`G98`), the comment and the spacing.
//  3. **The fields.** Id: the address; label: `<address> — <the parameter's label>`; type
//     `integer` for `unit: 'count'` and the tool, `D` and `H` words, `number` otherwise;
//     `required`, `min`, `max` from the parameter. A value written as a variable, an expression or
//     a word (`Z#101`, `Q206=FAUTO`, `CYCLE83(R1,…)`) is shown in a read-only text field and kept.
//     **A value is typed as it is written** (the field shows `50` of a point-less `X50`, and `60`
//     is written `X60`), so what the form shows and what it writes are the same text; it is
//     checked like the inspector's edit (`checkEdit`, `checkValue`, against its reading on the
//     machine): a point-less word under a machine that reads it in increments takes only a whole
//     number (a fraction would change how the machine reads the word), and a word whose reading
//     depends on a machine that is not chosen is refused, never guessed.
//  4. **Writing back** (`applyCycleForm`): confirming without a change gives the block back
//     byte for byte (the same lines: the caller makes no edit). A changed value rewrites only its
//     word by the rules of `rewriteWord` (§6.4: the word's own number form, typed decimals kept).
//     A value cleared on an optional word removes the word and one space next to it; clearing a
//     required one is refused. **Present words keep their order; a new optional word is appended
//     after the block's last parameter word, in the database's order**, written as typed (a point
//     added where the word reads as a length, an angle or a feed and the profile's decimal point
//     is significant, `min1`), with the block's own separator (a space, or none in a packed
//     block), before a trailing comment. The new block is read again and every changed or added
//     word must read back as the value typed, or the field is refused (`refused.noWord`).
//  5. **Klartext** (`define` over several lines): a `Qnnn=` line changes after the `=` only; a
//     new parameter is a new line `Qnnn=<value> ;<LABEL>` (the label in upper case, as the control
//     writes it) indented like the block's other Q lines and inserted in the database's order;
//     a cleared optional parameter removes its line; the `~` continuation marks stay right
//     (every line of the block but the last ends with one).
//  6. **Sinumerik by position**: the argument at the parameter's index is rewritten; a new value
//     beyond the written arguments extends the list with empty arguments; an argument cleared at
//     the end of the list is dropped with its comma; nothing else changes.
//  7. **Inserting** (`mode: 'insert'`): one new block after the cursor's block, the parameter
//     words in database order, a block number by `{{N}}`'s rule (`TemplateEnv`: the step after
//     `prevBlockNumber`, `numbering.start` with none above, nothing in an unnumbered document,
//     always for Klartext), Klartext with the renumber of the following blocks in the same edit
//     (the caller's, as for templates).
//  8. One undo step (`applyLines`); nothing outside the block changes. An error that belongs to
//     no one field (the block changed since the form was read) is keyed `CYCLE_FORM_WHOLE`.
//
// P3b fix NC (plan §7 #253 ff.):
//
//  9. **A modal cycle is inserted with its cancel** (review NC-05): a cycle that stays on
//     (`modal`, `sets.cycle: 'start'`: Fanuc `G73`–`G89`, Okuma `G181`…) gets a second block
//     with the database's cancel code (`G80`, Okuma `G180`, alone in its block as the Okuma
//     manual asks), numbered as the next `{{N}}`; further hole positions go between the two.
//     **Never inside a cycle that is on** (SK-01): where the state after the cursor's block has
//     such a cycle active, the insert is refused (`refused.insideCycle`): a new cycle there
//     would change what the next position of the old one does. A Sinumerik call and a Klartext
//     definition are not modal cycles and stay one block.
// 10. **Two blocks** only by the database's `blocks: 2` (review NC-11): the inspector's pairing
//     heuristic also paired Okuma one-block cycles written twice in a row.
// 11. **A variable stays** (review NC-16): a changed or cleared value of a read-only field is
//     `refused.variable` in every layout, not only where the words are rewritten.
// 12. **More decimals than the machine has** (review NC-13): with a machine whose number input
//     reads a point-less length in increments (Fanuc IS-B, IS-C), a length or angle typed with
//     more decimals than the increment is refused (`machines.numbers.rounded`: the control
//     would round it). Without a machine nothing is guessed.
// 13. **The reading of a point-less word** (review NC-08): `CycleForm.readings` says what a word
//     written without a point is on the machine (`Q4000` = 4 mm), so the user types the value as
//     it is written.

import type { Msg } from '$lib/app/types';
import { blockRange, checkEdit, checkValue, inspectBlock, type InspectInput, type InspectView, type InspectedWord } from '$lib/core/codes/inspect';
import { lookupCode } from '$lib/core/codes/lookup';
import type { CodeDb, CodeEntry, CodeParam } from '$lib/core/codes/types';
import { blockEntries, isAxisWord, paramOf } from '$lib/core/codes/wordValue';
import type { FieldSpec } from '$lib/core/forms/types';
import { valueOf, WRITE_BACK_ERRORS } from '$lib/core/machines/numbers';
import type { RewriteHow } from '$lib/core/nc/rewriteWord';
import type { ResolvedClass } from '$lib/core/machines/types';
import { parseNumber } from '$lib/core/nc/numbers';
import { rewriteWord } from '$lib/core/nc/rewriteWord';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState, ModalState, NcToken } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';
import type { CycleForm, CycleFormAt, CycleFormEdit, TemplateEnv } from './types';

/** The reasons `cycleFormAt` refuses, and the errors of `applyCycleForm`, as message keys (`cycleForm` namespace). */
export const CYCLE_FORM_REFUSALS = {
  twoBlocks: { key: 'cycleForm.refused.twoBlocks' },
  verify: { key: 'cycleForm.refused.verify' },
  noParams: { key: 'cycleForm.refused.noParams' },
  tooLong: { key: 'cycleForm.refused.tooLong' },
  /** P3.8: the block runs or calls a cycle written on another line (`params.line`). */
  elsewhere: { key: 'cycleForm.refused.elsewhere' },
  /** P3.8: the block is no longer the one the form was read from. */
  changed: { key: 'cycleForm.refused.changed' },
  /** P3.8: a required value is empty. */
  required: { key: 'cycleForm.refused.required' },
  /** P3.8: a value written as a variable or an expression was changed in the form. */
  variable: { key: 'cycleForm.refused.variable' },
  /** P3.8: the block read again does not carry the value typed. */
  noWord: { key: 'cycleForm.refused.noWord' },
  /** P3b fix NC (SK-01): a modal cycle is still on at the cursor (`params.code`, `line`, `cancel`). */
  insideCycle: { key: 'cycleForm.refused.insideCycle' },
} as const satisfies Record<string, Msg>;

/** The key of an error that belongs to the whole form, not to one field (rule 8). */
export const CYCLE_FORM_WHOLE = '';

/** The largest block a form edits: lines, and characters of one line (the inspector reads no longer line). */
export const CYCLE_FORM_LIMITS = { lines: 100, lineLength: 4000 } as const;

// ---------------------------------------------------------------------------------------------
// Which cycles (rule 1)
// ---------------------------------------------------------------------------------------------

function upper(text: string | undefined | null): string {
  return typeof text === 'string' ? text.toUpperCase() : '';
}

function paramsOf(entry: CodeEntry): CodeParam[] {
  return Array.isArray(entry.params) ? entry.params.filter((p) => p && typeof p.address === 'string' && p.address !== '') : [];
}

function isCycle(entry: CodeEntry): boolean {
  return entry.sets?.cycle === 'start' || entry.sets?.cycle === 'define';
}

/**
 * The cycles the form can edit and insert (rule 1), in database order. `machineType` is
 * reserved (Phase 3 plan §7 #236, decided at the Wave A integration): no code entry names a
 * machine type, the Fanuc cycles are split by database already, and only Sinumerik's shared
 * database lists turning and milling cycles alike; nothing is filtered by it.
 */
export function cycleEntries(db: CodeDb, machineType?: string): CodeEntry[] {
  void machineType;
  return (Array.isArray(db?.codes) ? db.codes : []).filter(
    (entry) => isCycle(entry) && entry.verify !== true && entry.blocks !== 2 && paramsOf(entry).length > 0,
  );
}

// ---------------------------------------------------------------------------------------------
// The block, its layout and its fields (rules 2, 3)
// ---------------------------------------------------------------------------------------------

/** How the block writes the cycle's parameters. */
type Layout = 'words' | 'klartext' | 'call';

function layoutOf(entry: CodeEntry, view: InspectView): Layout {
  if (entry.sets?.cycle === 'define') return 'klartext';
  const probe = tokenizeLine(`${entry.code}(1)`, view.cp).tokens[0];
  return probe?.kind === 'call' && upper(probe.address) === upper(entry.code) ? 'call' : 'words';
}

interface BlockText {
  first: number;
  last: number;
  lines: string[];
  tokens: NcToken[][];
}

function readBlock(input: InspectInput, first: number, last: number, view: InspectView): BlockText {
  const lines: string[] = [];
  const tokens: NcToken[][] = [];
  let state: LineState | undefined;
  for (let n = first; n <= last; n++) {
    const raw = n >= 1 && n <= input.lineCount ? input.getLine(n) : '';
    const text = typeof raw === 'string' ? raw : '';
    const r = tokenizeLine(text, view.cp, state);
    state = r.state;
    lines.push(text);
    tokens.push(r.tokens);
  }
  return { first, last, lines, tokens };
}

/** The input with lines `first`…`last` replaced by `lines`. */
function spliced(input: InspectInput, first: number, last: number, lines: readonly string[], line: number): InspectInput {
  const removed = last - first + 1;
  const count = input.lineCount - removed + lines.length;
  return {
    line,
    lineCount: count,
    getLine: (n) => {
      if (n < first) return input.getLine(n);
      if (n < first + lines.length) return lines[n - first];
      return input.getLine(n - lines.length + removed);
    },
  };
}

/** A call token of `entry` in the block, with where its arguments stand on its line. */
interface CallAt {
  line: number; // index into BlockText.lines
  token: NcToken;
  argStart: number;
  argEnd: number;
}

function callOf(block: BlockText, entry: CodeEntry, db: CodeDb): CallAt | null {
  for (let i = 0; i < block.tokens.length; i++) {
    for (const token of block.tokens[i]) {
      if (token.kind !== 'call' || lookupCode(db, token.address ?? '') !== entry) continue;
      const open = token.text.indexOf('(');
      if (open < 0 || !token.text.endsWith(')')) return null;
      const argStart = token.start + open + 1;
      const argEnd = token.end - 1;
      if (block.lines[i].slice(argStart, argEnd) !== (token.valueText ?? '')) return null;
      return { line: i, token, argStart, argEnd };
    }
  }
  return null;
}

/** The raw arguments of a call (with their spaces), split at the commas outside brackets and strings. */
function splitArguments(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of text) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.length === 1 && out[0].trim() === '' ? [] : out;
}

/** A plain decimal number as written (a decimal comma read as the point), or null. */
function plainNumber(text: string): ReturnType<typeof parseNumber> {
  return parseNumber(text.trim().replace(',', '.'));
}

/** The words of the block that are parameters of `entry`, by address: the first one written. */
function paramRows(words: readonly InspectedWord[], entry: CodeEntry): Map<string, InspectedWord> {
  const out = new Map<string, InspectedWord>();
  for (const word of words) {
    if (word.kind === 'code' || word.kind === 'call' || word.token.kind === 'blockNumber' || word.token.kind === 'programMarker') continue;
    if (word.address === null || word.token.valueText === undefined) continue;
    const param = paramOf(entry, word.address);
    if (!param) continue;
    const key = upper(param.address);
    if (!out.has(key)) out.set(key, word);
  }
  return out;
}

function isWholeNumberWord(param: CodeParam, profile: Profile): boolean {
  if (param.unit === 'count') return true;
  const address = upper(param.address);
  return address === upper(profile.addresses?.tool) || address === 'D' || address === 'H';
}

function fieldOf(param: CodeParam, value: string, readOnly: boolean, profile: Profile): FieldSpec {
  const field: FieldSpec = {
    id: param.address,
    type: readOnly ? 'text' : isWholeNumberWord(param, profile) ? 'integer' : 'number',
    label: `${param.address} — ${param.label}`,
    default: value,
  };
  if (readOnly) {
    field.readOnly = true;
    return field;
  }
  if (param.required === true) field.required = true;
  if (typeof param.min === 'number') field.min = param.min;
  if (typeof param.max === 'number') field.max = param.max;
  return field;
}

/** What the block says about its cycle: the form's values and fields, and the rows they come from. */
interface Reading {
  entry: CodeEntry;
  layout: Layout;
  block: BlockText;
  words: InspectedWord[];
  rows: Map<string, InspectedWord>;
  call: CallAt | null;
  args: string[];
  form: CycleForm;
}

/** The cycle written in the block at `input.line`, or a refusal, or null (rules 1–3). */
function readCycle(input: InspectInput, view: InspectView, after: ModalState | null): { ok: true; reading: Reading } | { ok: false; reason: Msg } | null {
  if (!input || input.lineCount < 1) return null;
  const { first, last } = blockRange(input, view.cp);
  if (last - first + 1 > CYCLE_FORM_LIMITS.lines) return { ok: false, reason: CYCLE_FORM_REFUSALS.tooLong };
  const block = readBlock(input, first, last, view);
  if (block.lines.some((l) => l.length > CYCLE_FORM_LIMITS.lineLength)) return { ok: false, reason: CYCLE_FORM_REFUSALS.tooLong };

  const inspection = inspectBlock({ ...input, line: first }, view, null, after);
  const cycle = inspection.cycle;
  const own = blockEntries(block.tokens.flat(), view.db).find(isCycle) ?? null;
  if (!cycle) {
    // A position under a modal cycle written above (Fanuc `X80.` after `G83 …`): the cycle runs
    // here, and its words are on that line.
    const active = after?.activeCycle;
    const runs = active ? lookupCode(view.db, active.code) : null;
    const moves = block.tokens.flat().some((t) => t.kind === 'word' && t.address !== undefined && t.value && isAxisWord(view.profile, t.address));
    if (own === null && active && runs && isCycle(runs) && (active.line < first || active.line > last) && moves) {
      return { ok: false, reason: { ...CYCLE_FORM_REFUSALS.elsewhere, params: { line: active.line } } };
    }
    return null;
  }
  const entry = lookupCode(view.db, cycle.code);
  if (!entry) return null;
  if (own !== entry || cycle.role === 'calls') {
    return { ok: false, reason: { ...CYCLE_FORM_REFUSALS.elsewhere, params: { line: cycle.line } } };
  }
  if (entry.verify === true) return { ok: false, reason: CYCLE_FORM_REFUSALS.verify };
  // Rule 10: the database says which cycles are written in two blocks (the pairing heuristic
  // of the inspector paired an Okuma one-block cycle written twice in a row).
  if (entry.blocks === 2) return { ok: false, reason: CYCLE_FORM_REFUSALS.twoBlocks };
  const params = paramsOf(entry);
  if (params.length === 0) return { ok: false, reason: CYCLE_FORM_REFUSALS.noParams };

  const layout = layoutOf(entry, view);
  const rows = paramRows(inspection.words, entry);
  const values: Record<string, string> = {};
  const fields: FieldSpec[] = [];
  const kept: string[] = [];
  let call: CallAt | null = null;
  let args: string[] = [];
  let readings: Record<string, Msg> | undefined;

  if (layout === 'call') {
    call = callOf(block, entry, view.db);
    if (!call) return { ok: false, reason: CYCLE_FORM_REFUSALS.noParams };
    args = splitArguments(call.token.valueText ?? '');
    params.forEach((param, i) => {
      const value = (args[i] ?? '').trim();
      values[param.address] = value;
      fields.push(fieldOf(param, value, value !== '' && plainNumber(value) === null, view.profile));
    });
    for (let i = params.length; i < args.length; i++) if (args[i].trim() !== '') kept.push(args[i].trim());
  } else {
    for (const param of params) {
      const row = rows.get(upper(param.address));
      const value = row ? (row.token.valueText ?? '') : '';
      values[param.address] = value;
      const readOnly = row !== undefined && (row.token.value === null || row.token.value === undefined || row.kind === 'variable');
      fields.push(fieldOf(param, value, readOnly, view.profile));
      const reading = row && !readOnly ? readingOf(row) : null;
      if (reading !== null) (readings ??= {})[param.address] = reading;
    }
  }
  // Words the database does not know for this cycle (rule 2).
  const used = new Set(rows.values());
  for (const word of inspection.words) {
    if (used.has(word) || word.kind === 'code' || word.kind === 'call') continue;
    if (word.token.kind === 'blockNumber' || word.token.kind === 'programMarker') continue;
    if (word.address !== null && paramOf(entry, word.address)) continue;
    kept.push(word.written);
  }

  const form: CycleForm = { entry, mode: 'edit', block: { first, last }, fields, values, kept };
  if (readings !== undefined) form.readings = readings;
  return { ok: true, reading: { entry, layout, block, words: inspection.words, rows, call, args, form } };
}

/** The form of the cycle at the cursor (rules 1–3); null when the cursor's block runs, defines or calls no cycle. */
export function cycleFormAt(input: InspectInput, view: InspectView, after: ModalState | null): CycleFormAt | null {
  const found = readCycle(input, view, after);
  if (found === null) return null;
  return found.ok ? { ok: true, form: found.reading.form } : { ok: false, reason: found.reason };
}

/** The empty form of `entry`, for a new block (rule 7). */
export function cycleFormFor(entry: CodeEntry, view: InspectView): CycleForm {
  const params = paramsOf(entry);
  return {
    entry,
    mode: 'insert',
    block: null,
    fields: params.map((param) => fieldOf(param, '', false, view.profile)),
    values: Object.fromEntries(params.map((param) => [param.address, ''])),
    kept: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Checking one value (rule 3)
// ---------------------------------------------------------------------------------------------

/** A typed value as text: `undefined` (not given: unchanged), or the trimmed text (`''` cleared). */
function typedText(values: Record<string, unknown>, id: string): string | undefined {
  if (values === null || typeof values !== 'object' || !Object.prototype.hasOwnProperty.call(values, id)) return undefined;
  const raw = values[id];
  if (raw === undefined) return undefined;
  if (raw === null) return '';
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return String(raw);
    const text = String(raw);
    return /e/i.test(text) ? raw.toFixed(20).replace(/\.?0+$/, '') : text;
  }
  return typeof raw === 'string' ? raw.trim() : String(raw);
}

/** True when the machine reads `1` of this class as something other than 1 (point-less increments, a scale). */
function scaledWithoutPoint(cls: ResolvedClass, row: InspectedWord): boolean {
  if (cls === null || cls === 'count' || !row.how) return false;
  const one = parseNumber('1');
  if (!one) return false;
  const value = valueOf(one, cls, row.how.params, row.how.units);
  return value !== null && value !== '1';
}

/** Rule 13: how the machine reads a word written without a point, where that is not the literal itself. */
function readingOf(row: InspectedWord): Msg | null {
  const lit = row.token.value;
  const effective = row.value?.effective;
  if (!lit || lit.hasPoint || typeof effective !== 'string' || row.value?.unit === null || row.value?.unit === undefined) return null;
  if (canonical(effective) === canonical(row.token.valueText ?? '')) return null;
  return { key: 'cycleForm.withoutPoint', params: { literal: row.token.valueText ?? '', value: `${canonical(effective)} ${String(row.value.unit)}` } };
}

/**
 * Rule 12: with a machine that reads a point-less length in increments, a typed value with more
 * decimals than the increment is refused; null where it fits or nothing is known.
 */
function tooFine(how: RewriteHow | undefined, typed: string, view: InspectView): Msg | null {
  if (!how || view.machine?.source?.numberInput !== 'machine') return null;
  const cls = how.cls;
  if (cls !== 'length' && cls !== 'angle') return null;
  const lit = plainNumber(typed);
  const one = parseNumber('1');
  const pointed = parseNumber('1.');
  if (!lit || !one || !pointed) return null;
  // Only where a point keeps the value as written and a point-less `1` is one increment.
  if (valueOf(pointed, cls, how.params, how.units) !== '1') return null;
  const increment = valueOf(one, cls, how.params, how.units);
  if (increment === null || increment === '1') return null;
  const decimals = (increment.split('.')[1] ?? '').replace(/0+$/, '').length;
  if ((lit.fracPart ?? '').replace(/0+$/, '').length <= decimals) return null;
  return { key: WRITE_BACK_ERRORS.rounded.key, params: { increment } };
}

/** Rule 9: the code that cancels `entry` when it is a cycle that stays on, or null. */
export function cancelOf(entry: CodeEntry, db: CodeDb): string | null {
  if (entry.modal !== true || entry.sets?.cycle !== 'start') return null;
  const cancel = (Array.isArray(db?.codes) ? db.codes : []).find((e) => e.sets?.cycle === 'cancel');
  return cancel ? cancel.code : null;
}

/** The effective value of a literal on the row's machine (the literal itself where it reads as written). */
function effectiveOf(literal: string, row: InspectedWord): string {
  const cls = row.how?.cls ?? null;
  const lit = plainNumber(literal);
  if (!lit || !row.how || cls === null || cls === 'count') return literal.replace(',', '.');
  return valueOf(lit, cls, row.how.params, row.how.units) ?? literal.replace(',', '.');
}

/**
 * The new text of a written word for `typed`, or why not: the inspector's checks, then
 * `rewriteWord` with the word's own number form; `typed` is the literal (rule 3).
 */
function rewriteRow(line: string, row: InspectedWord, typed: string, view: InspectView): { ok: true; text: string } | { ok: false; reason: Msg } {
  if (row.token.value === null || row.token.value === undefined || row.kind === 'variable') return { ok: false, reason: CYCLE_FORM_REFUSALS.variable };
  if (!plainNumber(typed)) return { ok: false, reason: { key: 'inspector.why.notANumber' } };
  const edit = checkEdit(row);
  if (!edit.ok) return edit;
  if (!row.how) return { ok: false, reason: { key: 'inspector.why.waiting' } };
  const wanted = plainNumber(typed);
  if (!row.token.value.hasPoint && wanted && (wanted.fracPart ?? '').replace(/0+$/, '') !== '' && scaledWithoutPoint(row.how.cls, row)) {
    return { ok: false, reason: WRITE_BACK_ERRORS.rounded };
  }
  const fine = tooFine(row.how, typed, view);
  if (fine) return { ok: false, reason: fine };
  const result = rewriteWord(line, row.token, typed, { ...row.how, cls: null });
  if (!result.ok) return result;
  const valueText = result.text.slice(row.token.text.length - (row.token.valueText ?? '').length);
  const why = checkValue(row, effectiveOf(valueText, row), view);
  if (why) return { ok: false, reason: why };
  return { ok: true, text: result.text };
}

/** A new word's value as written: as typed, with a point where the profile's point is significant and the word is a length, an angle or a feed (rule 4). */
function newValueText(typed: string, cls: ResolvedClass | undefined, profile: Profile): string {
  const lit = plainNumber(typed);
  if (!lit || lit.hasPoint || profile.syntax?.decimalPointSignificant !== true) return typed;
  const pointed: readonly ResolvedClass[] = ['length', 'angle', 'feedPerMin', 'feedPerRev', 'feedPerTooth', 'inverseTime'];
  return pointed.includes(cls ?? null) ? `${typed}.` : typed;
}

// ---------------------------------------------------------------------------------------------
// Writing back (rules 4–8)
// ---------------------------------------------------------------------------------------------

interface Change {
  param: CodeParam;
  index: number;
  typed: string; // '' cleared
  current: string;
}

/** The changes the values make, and the errors of the values that cannot be taken. */
function changesOf(form: CycleForm, values: Record<string, unknown>, current: Record<string, string>, errors: Record<string, Msg>): Change[] {
  const out: Change[] = [];
  paramsOf(form.entry).forEach((param, index) => {
    const typed = typedText(values, param.address);
    const now = current[param.address] ?? '';
    if (typed === undefined || typed === now) return;
    // Rule 11: a value written as a variable or an expression is kept, in every layout.
    if (form.fields.find((f) => f.id === param.address)?.readOnly === true) {
      errors[param.address] = CYCLE_FORM_REFUSALS.variable;
      return;
    }
    if (typed === '') {
      if (param.required === true) {
        errors[param.address] = CYCLE_FORM_REFUSALS.required;
        return;
      }
    } else if (!plainNumber(typed)) {
      const field = form.fields.find((f) => f.id === param.address);
      errors[param.address] = field?.readOnly ? CYCLE_FORM_REFUSALS.variable : { key: 'inspector.why.notANumber' };
      return;
    }
    out.push({ param, index, typed, current: now });
  });
  return out;
}

/** One replacement on a line of the block (columns of the original line). */
interface Patch {
  line: number;
  start: number;
  end: number;
  text: string;
}

function applyPatches(lines: readonly string[], patches: readonly Patch[]): string[] {
  const out = [...lines];
  const sorted = [...patches].sort((a, b) => a.line - b.line || b.start - a.start);
  for (const p of sorted) out[p.line] = out[p.line].slice(0, p.start) + p.text + out[p.line].slice(p.end);
  return out;
}

/** The span of a word with one space next to it (the one after, else the one before). */
function removalOf(line: string, token: NcToken): { start: number; end: number } {
  if (line[token.end] === ' ') return { start: token.start, end: token.end + 1 };
  if (token.start > 0 && line[token.start - 1] === ' ') return { start: token.start - 1, end: token.end };
  return { start: token.start, end: token.end };
}

/** The block separates its words with spaces (else it is packed). */
function spaced(tokens: readonly NcToken[]): boolean {
  const content = tokens.filter((t) => t.kind !== 'comment' && t.kind !== 'continuation');
  for (let i = 1; i < content.length - 1; i++) if (content[i].kind === 'whitespace') return true;
  return content.length === 0;
}

function editWords(r: Reading, changes: readonly Change[], view: InspectView, errors: Record<string, Msg>): string[] {
  const patches: Patch[] = [];
  const added: Change[] = [];
  for (const change of changes) {
    const row = r.rows.get(upper(change.param.address));
    if (!row) {
      if (change.typed !== '') added.push(change);
      continue;
    }
    const lineIndex = row.line - r.block.first;
    const line = r.block.lines[lineIndex];
    if (change.typed === '') {
      patches.push({ line: lineIndex, ...removalOf(line, row.token), text: '' });
      continue;
    }
    const result = rewriteRow(line, row, change.typed, view);
    if (!result.ok) errors[change.param.address] = result.reason;
    else patches.push({ line: lineIndex, start: row.token.start, end: row.token.end, text: result.text });
  }
  if (added.length > 0) {
    // After the block's last parameter word, else after the cycle's code (rule 4).
    let anchor: { line: number; end: number } | null = null;
    let code: { line: number; end: number } | null = null;
    const later = (a: { line: number; end: number }, b: { line: number; end: number } | null): boolean =>
      b === null || a.line > b.line || (a.line === b.line && a.end > b.end);
    for (const word of r.words) {
      const at = { line: word.line - r.block.first, end: word.token.end };
      if (word.kind === 'code') {
        const written = lookupCode(view.db, `${word.token.address ?? ''}${word.token.valueText ?? ''}`);
        if (written === r.entry && code === null) code = at;
        continue;
      }
      if (word.address !== null && paramOf(r.entry, word.address) !== null && later(at, anchor)) anchor = at;
    }
    anchor = anchor ?? code;
    if (anchor === null) {
      for (const c of added) errors[c.param.address] = CYCLE_FORM_REFUSALS.noWord;
    } else {
      const sep = spaced(r.block.tokens[anchor.line]) ? ' ' : '';
      const text = added.map((c) => `${sep}${c.param.address}${c.typed}`).join('');
      patches.push({ line: anchor.line, start: anchor.end, end: anchor.end, text });
    }
  }
  return applyPatches(r.block.lines, patches);
}

/** The continuation marker of a line (Klartext `~`), with the space before it, or null. */
function continuationOf(line: string, view: InspectView): { start: number; end: number } | null {
  const tokens = tokenizeLine(line, view.cp).tokens;
  const mark = [...tokens].reverse().find((t) => t.kind !== 'whitespace');
  if (!mark || mark.kind !== 'continuation') return null;
  const start = mark.start > 0 && line[mark.start - 1] === ' ' ? mark.start - 1 : mark.start;
  return { start, end: line.length };
}

/** Every line but the last ends with the continuation marker, the last without (rule 5). Lines already right are untouched. */
function fixContinuations(lines: string[], view: InspectView): string[] {
  return lines.map((line, i) => {
    const mark = continuationOf(line, view);
    if (i < lines.length - 1) return mark ? line : `${line.replace(/\s+$/, '')} ~`;
    return mark ? line.slice(0, mark.start) : line;
  });
}

function editKlartext(r: Reading, changes: readonly Change[], view: InspectView, errors: Record<string, Msg>): string[] {
  const patches: Patch[] = [];
  const removeLines = new Set<number>();
  const added: Change[] = [];
  for (const change of changes) {
    const row = r.rows.get(upper(change.param.address));
    if (!row) {
      if (change.typed !== '') added.push(change);
      continue;
    }
    const lineIndex = row.line - r.block.first;
    const line = r.block.lines[lineIndex];
    if (change.typed === '') {
      // A line that holds nothing but this assignment, its comment and the marker goes whole.
      const others = r.block.tokens[lineIndex].filter(
        (t) => t.end <= row.token.start || t.start >= row.token.end,
      ).filter((t) => t.kind !== 'whitespace' && t.kind !== 'comment' && t.kind !== 'continuation');
      if (others.length === 0 && lineIndex > 0) removeLines.add(lineIndex);
      else patches.push({ line: lineIndex, ...removalOf(line, row.token), text: '' });
      continue;
    }
    const result = rewriteRow(line, row, change.typed, view);
    if (!result.ok) errors[change.param.address] = result.reason;
    else patches.push({ line: lineIndex, start: row.token.start, end: row.token.end, text: result.text });
  }
  const patched = applyPatches(r.block.lines, patches);

  // New Q lines, each after the line of the parameter before it in the database's order.
  const params = paramsOf(r.entry);
  const indent = (() => {
    for (const row of r.rows.values()) {
      const i = row.line - r.block.first;
      if (i > 0) return /^\s*/.exec(r.block.lines[i])?.[0] ?? '   ';
    }
    return '   ';
  })();
  const after = new Map<number, string[]>(); // original line index → new lines after it
  for (const change of added) {
    let at = 0;
    for (let k = change.index - 1; k >= 0; k--) {
      const row = r.rows.get(upper(params[k].address));
      if (row && !removeLines.has(row.line - r.block.first)) {
        at = row.line - r.block.first;
        break;
      }
    }
    const list = after.get(at) ?? [];
    list.push(`${indent}${change.param.address}=${change.typed} ;${change.param.label.toUpperCase()}`);
    after.set(at, list);
  }
  const out: string[] = [];
  patched.forEach((line, i) => {
    if (!removeLines.has(i)) out.push(line);
    for (const extra of after.get(i) ?? []) out.push(extra);
  });
  // Lines that were already right stay as they were (a no-op keeps every byte).
  if (removeLines.size === 0 && added.length === 0) return out;
  return fixContinuations(out, view);
}

function editCall(r: Reading, changes: readonly Change[], view: InspectView, errors: Record<string, Msg>): string[] {
  const call = r.call as CallAt;
  const args = [...r.args];
  const original = args.length;
  const changed = new Set<number>();
  const space = args.slice(1).some((a) => a.startsWith(' ')) ? ' ' : '';
  for (const change of changes) {
    if (change.typed !== '') {
      const why = checkValue(argumentWord(change.param, change.typed), change.typed.replace(',', '.'), view);
      if (why) {
        errors[change.param.address] = why;
        continue;
      }
    }
    while (args.length <= change.index) args.push(args.length === 0 ? '' : space);
    const raw = args[change.index];
    const lead = /^\s*/.exec(raw)?.[0] ?? '';
    const trail = /\s*$/.exec(raw.slice(lead.length))?.[0] ?? '';
    args[change.index] = raw.trim() === '' ? `${raw.length > 0 && change.index > 0 ? space : ''}${change.typed}` : `${lead}${change.typed}${trail}`;
    changed.add(change.index);
  }
  // Empty arguments at the end that this edit made or added go, with their commas (rule 6).
  let length = args.length;
  while (length > 0 && args[length - 1].trim() === '' && (length - 1 >= original || changed.has(length - 1))) length--;
  const text = args.slice(0, length).join(',');
  const line = r.block.lines[call.line];
  const lines = [...r.block.lines];
  lines[call.line] = line.slice(0, call.argStart) + text + line.slice(call.argEnd);
  return lines;
}

/** A row for `checkValue` of a call's argument (rule 6): read as written, by its parameter's bounds. */
function argumentWord(param: CodeParam, typed: string): InspectedWord {
  const value = plainNumber(typed);
  const token: NcToken = { kind: 'word', start: 0, end: typed.length, text: typed, address: param.address, valueText: typed, value };
  return {
    line: 0,
    token,
    kind: 'cycleParam',
    written: typed,
    address: param.address,
    meaning: param.label,
    value: { cls: null, effective: typed, unit: null, source: null, readings: [] },
    notes: [],
    edit: { ok: true },
    param,
  };
}

/** Each changed or added value reads back from the new block as typed; and an added word passes the inspector's checks. */
function verify(r: Reading, changes: readonly Change[], next: InspectInput, view: InspectView, after: ModalState | null, errors: Record<string, Msg>): void {
  const again = readCycle(next, view, after);
  if (!again || !again.ok || again.reading.entry !== r.entry) {
    for (const c of changes) if (!errors[c.param.address]) errors[c.param.address] = CYCLE_FORM_REFUSALS.noWord;
    return;
  }
  for (const c of changes) {
    if (errors[c.param.address]) continue;
    const now = again.reading.form.values[c.param.address] ?? '';
    if (c.typed === '') {
      if (now !== '') errors[c.param.address] = CYCLE_FORM_REFUSALS.noWord;
      continue;
    }
    const a = plainNumber(now);
    const b = plainNumber(c.typed);
    if (!a || !b || canonical(a.raw) !== canonical(b.raw)) {
      errors[c.param.address] = CYCLE_FORM_REFUSALS.noWord;
      continue;
    }
    if (c.current !== '' || r.layout === 'call') continue;
    // An added word: the inspector's checks on its reading (a machine-dependent reading is refused).
    const row = again.reading.rows.get(upper(c.param.address));
    if (!row) {
      errors[c.param.address] = CYCLE_FORM_REFUSALS.noWord;
      continue;
    }
    const edit = checkEdit(row);
    if (!edit.ok) {
      errors[c.param.address] = edit.reason;
      continue;
    }
    const why = checkValue(row, effectiveOf(row.token.valueText ?? '', row), view) ?? tooFine(row.how, row.token.valueText ?? '', view);
    if (why) errors[c.param.address] = why;
  }
}

/** `-012.500` → `-12.5`: the value without its spelling (a decimal comma read as the point). */
function canonical(text: string): string {
  const lit = plainNumber(text);
  if (!lit) return text;
  const int = lit.intPart.replace(/^0+/, '');
  const frac = (lit.fracPart ?? '').replace(/0+$/, '');
  if (int === '' && frac === '') return '0';
  return `${lit.sign === '-' ? '-' : ''}${int === '' ? '0' : int}${frac === '' ? '' : `.${frac}`}`;
}

/** The class each new word reads as, from a first composition of the block, so the point can be added (rule 4). */
function withPoints(r: Reading, changes: readonly Change[], view: InspectView, after: ModalState | null, input: InspectInput, compose: (cs: readonly Change[]) => string[]): Change[] {
  if (r.layout === 'call' || view.profile.syntax?.decimalPointSignificant !== true) return [...changes];
  const added = changes.filter((c) => c.current === '' && c.typed !== '');
  if (added.length === 0) return [...changes];
  const probe = compose(changes);
  const next = spliced(input, r.block.first, r.block.last, probe, r.block.first);
  const again = readCycle(next, view, after);
  if (!again || !again.ok) return [...changes];
  return changes.map((c) => {
    if (!added.includes(c)) return c;
    const row = again.reading.rows.get(upper(c.param.address));
    const cls = row?.how?.cls ?? row?.value?.cls ?? null;
    return { ...c, typed: newValueText(c.typed, cls, view.profile) };
  });
}

/** The block number of an inserted block by `{{N}}`'s rule (rule 7), with its separator, or `''`. */
function blockNumberText(env: TemplateEnv | undefined, profile: Profile, nth = 1): string {
  const p = env?.cp?.profile ?? profile;
  const numbering = p.numbering;
  const bn = p.syntax?.blockNumber;
  const consecutive = numbering?.mode === 'consecutive';
  if (!consecutive && env?.numbered !== true) return '';
  const step = consecutive ? 1 : numbering?.step ?? 10;
  const start = numbering?.start ?? (consecutive ? 0 : 10);
  const prev = env?.prevBlockNumber;
  const n = (typeof prev === 'number' && Number.isFinite(prev) ? prev + step : start) + (nth - 1) * step;
  const digits = String(n).padStart(numbering?.digits ?? 0, '0');
  if (bn?.mode === 'leading-integer') return `${digits} `;
  return `${bn?.prefix ?? 'N'}${digits}${' '.repeat(numbering?.spacesAfter ?? 1)}`;
}

function insertCycle(form: CycleForm, values: Record<string, unknown>, input: InspectInput, view: InspectView, after: ModalState | null, env?: TemplateEnv): CycleFormEdit {
  const errors: Record<string, Msg> = {};
  const entry = form.entry;
  // Rule 9 (SK-01): not inside a cycle that is still on.
  const active = after?.activeCycle ?? null;
  const running = active ? lookupCode(view.db, active.code) : null;
  const cancel = running ? cancelOf(running, view.db) : null;
  if (active && running && cancel !== null) {
    return { ok: false, errors: { [CYCLE_FORM_WHOLE]: { ...CYCLE_FORM_REFUSALS.insideCycle, params: { code: active.code, line: active.line, cancel } } } };
  }
  const params = paramsOf(entry);
  const typed: { param: CodeParam; text: string }[] = [];
  for (const param of params) {
    const text = typedText(values, param.address) ?? '';
    if (text === '') {
      if (param.required === true) errors[param.address] = CYCLE_FORM_REFUSALS.required;
      continue;
    }
    if (!plainNumber(text)) {
      errors[param.address] = { key: 'inspector.why.notANumber' };
      continue;
    }
    typed.push({ param, text });
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const layout = layoutOf(entry, view);
  const number = blockNumberText(env, view.profile);
  const compose = (items: readonly { param: CodeParam; text: string }[]): string[] => {
    if (layout === 'klartext') {
      const head = `${number}${entry.code} ${entry.label.toUpperCase()}`;
      const qs = items.map((t) => `   ${t.param.address}=${t.text} ;${t.param.label.toUpperCase()}`);
      return fixContinuations([head, ...qs], view);
    }
    if (layout === 'call') {
      const args: string[] = [];
      for (const t of items) {
        const i = params.indexOf(t.param);
        while (args.length < i) args.push('');
        args[i] = t.text;
      }
      return [`${number}${entry.code}(${args.join(',')})`];
    }
    return [`${number}${[entry.code, ...items.map((t) => `${t.param.address}${t.text}`)].join(' ')}`];
  };

  // Where the new block goes: after the cursor's block (never inside a `~` block).
  const at = input.lineCount < 1 ? 0 : blockRange(input, view.cp).last;
  const place = (lines: readonly string[]): InspectInput => spliced(input, at + 1, at, lines, at + 1);

  // A point where the word reads as a length, an angle or a feed (rule 4), from a first reading.
  let items = typed;
  if (layout !== 'call' && view.profile.syntax?.decimalPointSignificant === true) {
    const first = readCycle(place(compose(items)), view, after);
    if (first && first.ok) {
      items = items.map((t) => {
        const row = first.reading.rows.get(upper(t.param.address));
        return { ...t, text: newValueText(t.text, row?.how?.cls ?? row?.value?.cls ?? null, view.profile) };
      });
    }
  }
  const lines = compose(items);
  const again = readCycle(place(lines), view, after);
  if (!again || !again.ok || again.reading.entry !== entry) {
    for (const t of items) errors[t.param.address] = CYCLE_FORM_REFUSALS.noWord;
    if (items.length === 0) errors[CYCLE_FORM_WHOLE] = CYCLE_FORM_REFUSALS.noWord;
    return { ok: false, errors };
  }
  for (const t of items) {
    const now = again.reading.form.values[t.param.address] ?? '';
    if (canonical(now) !== canonical(t.text)) {
      errors[t.param.address] = CYCLE_FORM_REFUSALS.noWord;
      continue;
    }
    if (layout === 'call') {
      const why = checkValue(argumentWord(t.param, t.text), t.text.replace(',', '.'), view);
      if (why) errors[t.param.address] = why;
      continue;
    }
    const row = again.reading.rows.get(upper(t.param.address));
    if (!row) {
      errors[t.param.address] = CYCLE_FORM_REFUSALS.noWord;
      continue;
    }
    const edit = checkEdit(row);
    if (!edit.ok) {
      errors[t.param.address] = edit.reason;
      continue;
    }
    const why = checkValue(row, effectiveOf(row.token.valueText ?? '', row), view) ?? tooFine(row.how, row.token.valueText ?? '', view);
    if (why) errors[t.param.address] = why;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // Rule 9: a cycle that stays on is cancelled in a block of its own after it.
  const ends = cancelOf(entry, view.db);
  if (ends !== null) return { ok: true, first: at + 1, last: at, lines: [...lines, `${blockNumberText(env, view.profile, 2)}${ends}`] };
  return { ok: true, first: at + 1, last: at, lines };
}

/** The edit for the confirmed `values` (rules 4–8); `env` numbers an inserted block. Never corrects a value. */
export function applyCycleForm(
  form: CycleForm,
  values: Record<string, unknown>,
  input: InspectInput,
  view: InspectView,
  after: ModalState | null,
  env?: TemplateEnv,
): CycleFormEdit {
  if (form.mode === 'insert' || form.block === null) return insertCycle(form, values, input, view, after, env);

  const whole = (reason: Msg): CycleFormEdit => ({ ok: false, errors: { [CYCLE_FORM_WHOLE]: reason } });
  if (form.block.first < 1 || form.block.last > input.lineCount) return whole(CYCLE_FORM_REFUSALS.changed);
  const found = readCycle({ ...input, line: form.block.first }, view, after);
  if (!found) return whole(CYCLE_FORM_REFUSALS.changed);
  if (!found.ok) return whole(found.reason);
  const r = found.reading;
  if (r.entry !== form.entry || r.block.first !== form.block.first || r.block.last !== form.block.last) return whole(CYCLE_FORM_REFUSALS.changed);

  const errors: Record<string, Msg> = {};
  const changes = changesOf(r.form, values, r.form.values, errors);
  if (changes.length === 0 && Object.keys(errors).length === 0) {
    return { ok: true, first: r.block.first, last: r.block.last, lines: [...r.block.lines] };
  }
  const compose = (cs: readonly Change[]): string[] => {
    const scratch: Record<string, Msg> = {};
    if (r.layout === 'klartext') return editKlartext(r, cs, view, scratch);
    if (r.layout === 'call') return editCall(r, cs, view, scratch);
    return editWords(r, cs, view, scratch);
  };
  const final = withPoints(r, changes, view, after, input, compose);
  const lines = r.layout === 'klartext' ? editKlartext(r, final, view, errors) : r.layout === 'call' ? editCall(r, final, view, errors) : editWords(r, final, view, errors);
  // Every value without an error of its own is read back, so the form shows every problem at once.
  const next = spliced(input, r.block.first, r.block.last, lines, r.block.first);
  verify(r, final, next, view, after, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, first: r.block.first, last: r.block.last, lines };
}
