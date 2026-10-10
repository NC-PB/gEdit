// The code inspector's rows (Phase 3 plan §6.3; Phase 2 plan AD-27). Owner: P3.2a (the Phase 3
// prelude wrote the contract). Pure and Monaco-free, like `hoverText.ts`:
// `components/panels/InspectorPanel.svelte` (P3.2b) shows what this module answers, and every
// rule is pinned by node tests here.
//
// What the inspector shows for the block at the cursor (a Klartext block whose lines end in
// `~` counts as one block, and so does an Okuma line that starts with `$` with the block above):
//
//   - one row per token that means something (`InspectedWord`): what the code database calls
//     it, its **effective value** (`wordValue.ts` `readWord`) with where the reading comes
//     from, or, with no machine and a reading that depends on one, every reading instead of
//     a value, the assumed profile default first (AD-31); and notes, in this order: what kind
//     of number it is (a feed per revolution set by `G99` on line 3, a thread lead, a surface
//     speed with its clamp), incremental, diameter or radius (AD-19 rule 11), data or machine
//     coordinates, how the machine reads it (no decimal point: steps of 0.001 mm), and last
//     where an assumed reading comes from. A word is read in the state **after** its block,
//     in which the block's own codes are in force (`G91 X10.` is incremental), as the Python
//     scripts read it (Phase 3 AD-35);
//   - the cycle of the block (a cycle entry it writes, or the cycle it runs: the modal cycle
//     on a positioning block, the defined cycle a call runs) with each of its parameters and
//     the value written for it, or none: a Klartext definition over several lines, a call's
//     arguments by position (`CYCLE83(50,0,1,-20,,5)`: the empty fifth is "not written"), a
//     Fanuc cycle's words. A one-shot cycle written in two consecutive blocks (the lathe
//     `G71`, `G76`) shows the parameters of the block at the cursor and which of the two
//     blocks it is (`part`); for a call of a defined cycle the parameters come from the
//     definition, each with its line;
//   - the modal state **after** the block (`INSPECTOR_STATE_KEYS`, in that order), each
//     value with its source line, assumed values marked with where they come from; a row
//     the block itself changed (set on one of its lines, or different from `before`) is
//     marked as set here (`setHere`).
//
// Unknown words are rows too ("not described"); comments, whitespace, a block skip, a label,
// text the control only shows and a bare value that belongs to a keyword (`TOOL CALL 1`) are
// not. Every text that comes from a profile, a database or the document is data: the panel
// shows it as text, never as HTML or markdown.
//
// Editing (AD-27): `checkEdit` says whether a row may be edited and why not — a code, a call,
// a block or program number, a variable, a word the database does not describe, a word with
// no value, a word whose reading needs a machine that is not chosen, and any word while the
// state is not known yet. The panel then prompts, `checkValue` validates what was typed (a
// decimal number; a whole number for the tool word, `D` and `H` written as register numbers and
// every `unit: 'count'` parameter; the parameter's `min`/`max`), and `core/nc/rewriteWord.ts`
// writes it with `word.how`. Nothing is corrected silently: a value that does not fit is
// refused with the reason.

import type { Msg } from '$lib/app/types';
import { valueOf } from '$lib/core/machines/numbers';
import type { EffectiveMachine, ParamSource, Reading, ResolvedClass } from '$lib/core/machines/types';
import { parseNumber } from '$lib/core/nc/numbers';
import type { RewriteHow } from '$lib/core/nc/rewriteWord';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { CompiledProfile, NumberFormatOptions, Profile } from '$lib/core/profiles/types';
import type { LineState, ModalState, ModalValue, NcToken } from '$lib/core/nc/types';
import { cycleBlockOf, paramOfBlock, paramsOfBlock, type CycleBlock } from './blocks';
import { codeAddressesOf } from './hoverText';
import { axisWordsOf, isAssignmentWord, lookupCode, lookupWord } from './lookup';
import type { CodeDb, CodeEntry, CodeParam } from './types';
import {
  blockEntries,
  feedUnitSource,
  inForceEntries,
  incrementalAxisOf,
  isAxisWord,
  isFeedWord,
  keywordEntry,
  paramOf,
  readWord,
  unitsAfter,
  type WordReading,
} from './wordValue';

/** The document the inspector reads, without Monaco: the cursor line and a way to read any line. */
export interface InspectInput {
  /** 1-based line of the cursor. */
  line: number;
  lineCount: number;
  getLine(n: number): string;
}

/** The document's effective view (AD-31): what `machines.effective(docId)` answers. */
export interface InspectView {
  profile: Profile;
  cp: CompiledProfile;
  db: CodeDb;
  machine: EffectiveMachine;
}

/** What a word is to the inspector. */
export type InspectedKind =
  | 'code' // a G/M code or keyword the database has an entry for
  | 'address' // an address word with a value (`X10.`, `F0.2`), a block or program number
  | 'cycleParam' // a word that is a parameter of the block's cycle (`R2.`, `Q2`, `Q200=2`)
  | 'call' // a call the database describes (`CYCLE83(…)`)
  | 'variable' // a variable or an expression; its value is not known without running the program
  | 'assignment' // a word written with `=` that is a value, never a code (`S3=2400`, `SB=800`, `#1=5`)
  | 'unknown'; // a word the database does not describe (or describes with `verify`)

/** The unit of an effective value. P3.2a added the per-tooth and inverse-time feeds. */
export type ValueUnit =
  | 'mm'
  | 'inch'
  | 'deg'
  | 's'
  | 'mm/min'
  | 'mm/rev'
  | 'inch/min'
  | 'inch/rev'
  | 'mm/tooth'
  | 'inch/tooth'
  | '1/min'
  | 'rpm'
  | 'm/min'
  | 'ft/min';

/** The value of one word on this document's machine. */
export interface InspectedValue {
  /** How the word is read (`numberClassOf`); null: no class, or undecidable. */
  cls: ResolvedClass;
  /** The effective value as decimal text, or null (no class, a variable, or it needs a machine). */
  effective: string | null;
  /** The unit of `effective`, and of every reading. */
  unit: ValueUnit | null;
  /** Where the reading comes from (the machine, a detected variant, the profile default). */
  source: ParamSource | null;
  /** With no machine and a reading that depends on one: every preset's reading, the default first. */
  readings: Reading[];
}

/** One row of the current block. */
export interface InspectedWord {
  /** The 1-based line the token stands on (a Klartext block spans lines). */
  line: number;
  /**
   * The token. A Klartext or macro assignment (`Q200=2`, `#1=5`) is one token here, from the
   * variable to the number, with `address` the variable and `valueText` the number, so
   * `rewriteWord` changes only the number.
   */
  token: NcToken;
  kind: InspectedKind;
  /** The token as written. */
  written: string;
  /** The address (`X`, `G`, `,R`, `Q200`), the keyword or the call's name; null for a bare value. */
  address: string | null;
  /** The database's label for the code, the address or the cycle parameter (data, untranslated). */
  meaning: string | null;
  value: InspectedValue | null;
  /** Notes in the order shown: the kind of number, incremental, diameter or radius, data, how the machine reads it, assumed. */
  notes: Msg[];
  /** Whether the row may be edited, and why not (`inspector.why.*`). */
  edit: { ok: true } | { ok: false; reason: Msg };
  /** P3.2a: the parameter the word is of (the block's cycle first, then the block's codes, then the codes in force). */
  param?: CodeParam;
  /** P3.2a: how `rewriteWord` writes this row; present on every editable row. */
  how?: RewriteHow;
}

/** The cycle that runs in (or is defined by) the block, with its parameters. */
export interface InspectedCycle {
  code: string;
  /** The line of the entry that names the cycle (for `calls`: the definition's first line). */
  line: number;
  /** 'runs': the block runs it; 'defines': a Klartext definition; 'calls': a call of the defined cycle. */
  role: 'runs' | 'defines' | 'calls';
  params: { param: CodeParam; written: string | null; line: number | null }[];
  /**
   * P3.2a: a one-shot cycle written in two consecutive blocks (the lathe `G71`, `G76`): which
   * of the two this block is. Each block shows its own words; the database's labels say what
   * a parameter means in which block (the thread height is `P` of the second `G76` block).
   */
  part?: { index: 1 | 2; of: 2 };
}

/** One row of the modal state after the block. */
export interface InspectedState {
  /** One of `INSPECTOR_STATE_KEYS`, or `group:<name>` for a modal group not in that list. */
  key: string;
  /** The row's caption (`inspector.state.<key>`, `inspector.state.group` for a group). */
  label: Msg;
  /** The value as shown: the code (`G54`), or a derived word (`mm`, `per-rev`, `on`). */
  value: string;
  /** Where it was set; 0 for a power-on value. Clickable when > 0. */
  line: number;
  assumed: boolean;
  from?: ParamSource;
  /** P3.2a: the block itself set it (on one of its lines), or it differs from the state before. */
  setHere: boolean;
}

/** What `inspectBlock` answers. */
export interface BlockInspection {
  firstLine: number;
  lastLine: number;
  words: InspectedWord[];
  cycle: InspectedCycle | null;
  /** The state after `lastLine`; empty while the modal index has not reached it (`stateReady` false). */
  state: InspectedState[];
  stateReady: boolean;
}

/**
 * The state rows, in the order shown (code-assistant.md "Code inspector panel"). A key with
 * nothing in force is left out; a modal group the database has and this list does not name
 * follows at the end as `group:<name>`, in alphabetical order.
 */
export const INSPECTOR_STATE_KEYS = [
  'motion',
  'plane',
  'distance',
  'units',
  'diameter',
  'workOffset',
  'tool',
  'spindle',
  'speed',
  'speedLimit',
  'feed',
  'coolant',
  'compensation',
  'cycle',
  'definedCycle',
  'frame',
  'tcp',
] as const;

/** The `data-testid`s of the panel (Phase 3 plan §6.8); attributes as listed there. */
export const INSPECTOR_TEST_IDS = {
  panel: 'inspector-panel',
  row: 'inspector-row',
  state: 'inspector-state',
  edit: 'inspector-edit',
  cycle: 'inspector-cycle',
} as const;

/** How far a block may reach over continued lines in either direction before it is cut. */
export const MAX_BLOCK_LINES = 500;

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

function upper(text: string | undefined | null): string {
  return typeof text === 'string' ? text.toUpperCase() : '';
}

function lineAt(input: InspectInput, n: number): string {
  const text = n >= 1 && n <= input.lineCount ? input.getLine(n) : '';
  return typeof text === 'string' ? text : '';
}

/** The line ends with the continuation marker, so the next line is its tail (Klartext `~`). */
function continues(text: string, cp: CompiledProfile): boolean {
  if (!cp.re.continuation) return false;
  return tokenizeLine(text, cp).state.continuation;
}

/** The line starts with the marker that joins it to the block above (Okuma `$`). */
function startsAsContinuation(text: string, cp: CompiledProfile): boolean {
  const re = cp.re.continuationStart;
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(text);
}

/**
 * The block around `input.line`: its first and last line. A line ending in the profile's
 * continuation marker joins the next one, and a line that starts with the profile's
 * continuation-start marker joins the one above (P2 §7.16 #27). At most `MAX_BLOCK_LINES`
 * lines are followed in each direction.
 */
export function blockRange(input: InspectInput, cp: CompiledProfile): { first: number; last: number } {
  const count = Math.max(0, input.lineCount);
  const line = Math.min(Math.max(1, Math.trunc(input.line) || 1), Math.max(1, count));
  let first = line;
  let last = line;
  if (count === 0) return { first, last };
  while (
    first > 1 &&
    line - first < MAX_BLOCK_LINES &&
    (continues(lineAt(input, first - 1), cp) || startsAsContinuation(lineAt(input, first), cp))
  ) {
    first--;
  }
  while (
    last < count &&
    last - line < MAX_BLOCK_LINES &&
    (continues(lineAt(input, last), cp) || startsAsContinuation(lineAt(input, last + 1), cp))
  ) {
    last++;
  }
  return { first, last };
}

interface BlockLine {
  line: number;
  text: string;
  tokens: NcToken[];
}

function tokenizeBlock(input: InspectInput, cp: CompiledProfile, first: number, last: number): BlockLine[] {
  const out: BlockLine[] = [];
  let state: LineState | undefined;
  for (let n = first; n <= last; n++) {
    const text = lineAt(input, n);
    const result = tokenizeLine(text, cp, state);
    state = result.state;
    out.push({ line: n, text, tokens: result.tokens });
  }
  return out;
}

function nextContent(tokens: readonly NcToken[], from: number): number {
  for (let i = from + 1; i < tokens.length; i++) if (tokens[i].kind !== 'whitespace') return i;
  return -1;
}

/**
 * A feed written as a word in place of a number (`FAUTO`, `FMAX`, `FU`, `FZ`): the profile's
 * rapid marker, a code of the database's feed-unit setting or a feed-unit word of the profile,
 * written without a value.
 */
function isFeedKeyword(token: NcToken, profile: Profile, db: CodeDb): boolean {
  if (token.kind !== 'keyword' && !(token.kind === 'word' && (token.valueText ?? '') === '')) return false;
  const name = upper(token.address || token.text);
  if (name === '') return false;
  if (upper(profile.addresses?.rapid) === name) return true;
  if (Object.keys(profile.addresses?.feedUnitWords ?? {}).some((w) => upper(w) === name)) return true;
  const entry = lookupCode(db, name);
  return entry !== null && entry.verify !== true && (entry.group === 'feedmode' || entry.sets?.feedUnit !== undefined);
}

/**
 * A variable set to one plain number (`Q200=2`, `#1=5`, `Q201 = -15`), as one word token
 * from the variable to the number; null for anything else (`Q1=Q2+1`). With `feeds`, a
 * cycle's feed parameter written as a word (`Q206=FAUTO`, `Q206=FMAX`, `Q206=FU0.2`) is one
 * too: the token carries the word as written and no number.
 */
function assignmentAt(
  tokens: readonly NcToken[],
  i: number,
  text: string,
  feeds?: { profile: Profile; db: CodeDb },
): { token: NcToken; last: number } | null {
  const variable = tokens[i];
  if (variable.kind !== 'variable') return null;
  const op = nextContent(tokens, i);
  if (op < 0 || tokens[op].kind !== 'operator' || tokens[op].text !== '=') return null;
  let num = nextContent(tokens, op);
  if (num < 0) return null;
  if (feeds && tokens[num].kind === 'operator' && (tokens[num].text === '+' || tokens[num].text === '-')) {
    const signed = nextContent(tokens, num);
    if (signed >= 0 && isFeedKeyword(tokens[signed], feeds.profile, feeds.db)) num = signed;
  }
  const value = tokens[num];
  if (feeds && value.address !== undefined && (value.kind === 'keyword' || value.kind === 'word') && isFeedKeyword(value, feeds.profile, feeds.db)) {
    const after = nextContent(tokens, num);
    if (after >= 0 && (tokens[after].kind === 'operator' || tokens[after].kind === 'expression')) return null;
    const written = text.slice(tokens[nextContent(tokens, op)].start, value.end);
    return {
      token: { kind: 'word', start: variable.start, end: value.end, text: text.slice(variable.start, value.end), address: variable.text, valueText: written, value: null },
      last: num,
    };
  }
  if (feeds && value.kind === 'word' && value.address !== undefined && value.value && isFeedWord(feeds.profile, value.address)) {
    // `Q206=FU0.2`, `Q206=FZ0.05`: a feed word with its own unit, written whole.
    const after = nextContent(tokens, num);
    if (after >= 0 && (tokens[after].kind === 'operator' || tokens[after].kind === 'expression')) return null;
    return {
      token: { kind: 'word', start: variable.start, end: value.end, text: text.slice(variable.start, value.end), address: variable.text, valueText: value.text, value: null },
      last: num,
    };
  }
  if (value.kind !== 'word' || value.address !== undefined || !value.value) return null;
  const after = nextContent(tokens, num);
  if (after >= 0 && (tokens[after].kind === 'operator' || tokens[after].kind === 'expression')) return null;
  return {
    token: {
      kind: 'word',
      start: variable.start,
      end: value.end,
      text: text.slice(variable.start, value.end),
      address: variable.text,
      valueText: value.valueText ?? value.text,
      value: value.value,
    },
    last: num,
  };
}

/** A call's arguments, split at the commas outside brackets and strings; `''` for an empty one. */
export function callArguments(argumentText: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of argumentText) {
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out.length === 1 && out[0] === '' ? [] : out;
}

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

interface CycleFound {
  cycle: InspectedCycle;
  entry: CodeEntry;
  /** B1: the block of a two-block cycle this block is (`cycle.part`), whose parameters its words are. */
  block: CycleBlock | null;
}

/** Where `entry` is written in the block, or null. */
function lineOfEntry(lines: readonly BlockLine[], entry: CodeEntry, db: CodeDb): number | null {
  for (const { line, tokens } of lines) {
    if (blockEntries(tokens, db).includes(entry)) return line;
  }
  return null;
}

/**
 * The value written for each parameter of `entry` in these lines; of a two-block cycle only the
 * parameters of `block` (B1, `CodeParam.block`), all of them with `block` null.
 */
function paramsWritten(
  lines: readonly BlockLine[],
  entry: CodeEntry,
  db: CodeDb,
  profile: Profile,
  block: CycleBlock | null = null,
): InspectedCycle['params'] {
  const params = paramsOfBlock(entry, block);
  // A call: its arguments by position.
  for (const { line, tokens } of lines) {
    const call = tokens.find((token) => token.kind === 'call' && lookupCode(db, token.address ?? '') === entry);
    if (call) {
      const args = callArguments(call.valueText ?? '');
      return params.map((param, i) => {
        const arg = args[i];
        return arg === undefined || arg === '' ? { param, written: null, line: null } : { param, written: arg, line };
      });
    }
  }
  // Words: the first word of each parameter's address, with a Klartext `Q200=2` read as one.
  const found = new Map<string, { written: string; line: number }>();
  for (const { line, text, tokens } of lines) {
    tokens.forEach((token, i) => {
      let word: NcToken | null = null;
      if (token.kind === 'word' && token.address !== undefined && token.valueText !== undefined) word = token;
      else if (token.kind === 'variable') word = assignmentAt(tokens, i, text, { profile, db })?.token ?? null;
      if (!word || word.address === undefined) return;
      const key = upper(word.address);
      if (!found.has(key)) found.set(key, { written: word.valueText ?? '', line });
    });
  }
  return params.map((param) => {
    const hit = found.get(upper(param.address));
    return hit ? { param, written: hit.written, line: hit.line } : { param, written: null, line: null };
  });
}

/** The tokens of the block around line `n`, or null outside the document. */
function blockTokensAt(input: InspectInput, view: InspectView, n: number): NcToken[] | null {
  if (n < 1 || n > input.lineCount) return null;
  const range = blockRange({ ...input, line: n }, view.cp);
  return tokenizeBlock(input, view.cp, range.first, range.last).flatMap((l) => l.tokens);
}

/** How many comment or blank lines the search for the other block of a two-block cycle steps over. */
const PAIR_SKIP_LINES = 3;

/**
 * The tokens of the neighbouring block of a two-block cycle, starting at line `n` and going
 * `step` (-1 up, +1 down): a line that holds only comments or whitespace (or nothing) is
 * stepped over, at most `PAIR_SKIP_LINES` of them, so `G71 U2. R1.` / `(ROUGH)` /
 * `G71 P10 Q20 …` still pair. Null outside the document or past the bound.
 */
function neighbourTokens(input: InspectInput, view: InspectView, n: number, step: -1 | 1): NcToken[] | null {
  for (let skipped = 0; skipped <= PAIR_SKIP_LINES; skipped++, n += step) {
    const tokens = blockTokensAt(input, view, n);
    if (tokens === null) return null;
    if (tokens.some((t) => t.kind !== 'comment' && t.kind !== 'whitespace')) return tokens;
  }
  return null;
}

/** The block writes `entry` as a code word (`G76`), not as a call or a keyword. */
function writesAsWord(tokens: readonly NcToken[], entry: CodeEntry, db: CodeDb): boolean {
  return tokens.some(
    (t) =>
      t.kind === 'word' &&
      t.address !== undefined &&
      t.valueText !== undefined &&
      !isAssignmentWord(t) &&
      lookupCode(db, t.address + t.valueText) === entry,
  );
}

function addressesWritten(tokens: readonly NcToken[]): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) if (t.kind === 'word' && t.address !== undefined && t.valueText !== undefined) out.add(upper(t.address));
  return out;
}

/**
 * Whether `a` and then `b` are the two blocks of one cycle (the lathe `G71`, `G74`–`G76`): both
 * write the same one-shot cycle code as a word, the first writes no feed word, and the second
 * writes an address the first does not. A heuristic on the words, no code list: two
 * consecutive threading blocks that each carry their lead, or two calls, are no pair.
 *
 * B1: only the fallback. An entry that declares its blocks (`CodeParam.block`) is answered by
 * `cycleBlockOf` from the block's own words, which also knows a second block that stands alone
 * because the first block's values are set by machine parameters.
 */
function isPair(a: readonly NcToken[], b: readonly NcToken[], entry: CodeEntry, view: InspectView): boolean {
  const { db, profile } = view;
  if (!writesAsWord(a, entry, db) || !writesAsWord(b, entry, db)) return false;
  const first = addressesWritten(a);
  if ([...first].some((address) => isFeedWord(profile, address))) return false;
  return [...addressesWritten(b)].some((address) => !first.has(address));
}

function findCycle(
  input: InspectInput,
  view: InspectView,
  lines: readonly BlockLine[],
  blockCodes: readonly CodeEntry[],
  after: ModalState | null,
  first: number,
  last: number,
): CycleFound | null {
  const { db } = view;
  const own = blockCodes.find((entry) => entry.sets?.cycle === 'start' || entry.sets?.cycle === 'define');
  // A cycle written behind a word that makes it modal (`MCALL CYCLE81(…)`) runs nothing on
  // its own line: the line defines what the positions after it run.
  const madeModal = blockCodes.some((entry) => entry.sets?.cycle === 'call-modal-next');
  if (own) {
    // A one-shot cycle written in two blocks: which one this is, by the database's
    // `CodeParam.block` (B1), else by pairing it with a neighbouring block.
    let block: CycleBlock | null = null;
    if (own.sets?.cycle === 'start' && own.modal !== true) {
      const here = lines.flatMap((l) => l.tokens);
      block = cycleBlockOf(own, addressesWritten(here));
      if (block === null) {
        const above = neighbourTokens(input, view, first - 1, -1);
        const below = neighbourTokens(input, view, last + 1, 1);
        if (above && isPair(above, here, own, view)) block = 2;
        else if (below && isPair(here, below, own, view)) block = 1;
      }
    }
    const cycle: InspectedCycle = {
      code: own.code,
      line: lineOfEntry(lines, own, db) ?? first,
      role: own.sets?.cycle === 'define' || madeModal ? 'defines' : 'runs',
      params: paramsWritten(lines, own, db, view.profile, block),
    };
    if (block !== null) cycle.part = { index: block, of: 2 };
    return { cycle, entry: own, block };
  }
  const runs = after?.block.cycle;
  if (!after || typeof runs !== 'string' || runs === '') return null;
  const entry = lookupCode(db, runs);
  if (!entry) return null;
  const defined = after.definedCycle;
  if (defined && lookupCode(db, defined.code) === entry) {
    const range = blockRange({ ...input, line: defined.line }, view.cp);
    const definition = tokenizeBlock(input, view.cp, range.first, range.last);
    return {
      cycle: { code: entry.code, line: defined.line, role: 'calls', params: paramsWritten(definition, entry, db, view.profile) },
      entry,
      block: null,
    };
  }
  // A position under a cycle made modal on another line: the parameters are written there.
  const active = after.activeCycle;
  let source: readonly BlockLine[] = lines;
  if (active && lookupCode(db, active.code) === entry && (active.line < first || active.line > last) && active.line >= 1) {
    const range = blockRange({ ...input, line: active.line }, view.cp);
    source = tokenizeBlock(input, view.cp, range.first, range.last);
  }
  return {
    cycle: { code: entry.code, line: active?.line ?? first, role: 'runs', params: paramsWritten(source, entry, db, view.profile) },
    entry,
    block: null,
  };
}

// ---------------------------------------------------------------------------
// The notes of a row
// ---------------------------------------------------------------------------

const ASSUMED_KEY: Record<ParamSource, string> = {
  machine: 'inspector.note.assumedMachine',
  detected: 'inspector.note.assumedDetected',
  profile: 'inspector.note.assumedProfile',
};

const FEED_KEY: Partial<Record<NonNullable<ResolvedClass>, string>> = {
  feedPerMin: 'inspector.note.feedPerMinute',
  feedPerRev: 'inspector.note.feedPerRev',
  feedPerTooth: 'inspector.note.feedPerTooth',
  inverseTime: 'inspector.note.inverseTime',
};

/** The modal group whose code in force sets `member` (`feedUnit`, `speedUnit`), or null. */
function groupSetting(after: ModalState, db: CodeDb, member: 'feedUnit' | 'speedUnit'): { name: string; value: ModalValue } | null {
  for (const [name, value] of Object.entries(after.groups)) {
    if (!value || typeof value.code !== 'string') continue;
    const entry = lookupCode(db, value.code);
    if (entry?.sets?.[member] !== undefined) return { name, value };
  }
  return null;
}

/** "set by G99 on line 3", or the assumed source of a power-on code. */
function setBy(value: ModalValue, assumed: Set<ParamSource>): Msg | null {
  if (value.assumed) {
    assumed.add(value.from ?? 'profile');
    return { key: 'inspector.note.setByAssumed', params: { code: value.code } };
  }
  return { key: 'inspector.note.setBy', params: { code: value.code, line: value.line } };
}

/** What one step of a written "1" is worth on this machine, or null where "1" is 1. */
function stepOf(cls: ResolvedClass, view: InspectView, units: 'mm' | 'inch', withPoint: boolean): string | null {
  if (cls === null || cls === 'count') return null;
  const one = parseNumber(withPoint ? '1.' : '1');
  if (!one) return null;
  const value = valueOf(one, cls, view.machine.params, units);
  return value !== null && value !== '1' ? value : null;
}

function notesOf(
  token: NcToken,
  kind: InspectedKind,
  reading: WordReading | null,
  after: ModalState | null,
  view: InspectView,
  blockCodes: readonly CodeEntry[],
  blockLine: number,
): Msg[] {
  const notes: Msg[] = [];
  if (kind === 'unknown') return [{ key: 'inspector.note.notDescribed' }];
  if (kind === 'variable') return [{ key: 'inspector.note.variable' }];
  if (!after || !reading || token.address === undefined) return notes;
  const { profile, db, machine } = view;
  const address = upper(token.address);
  const base = address.replace(/\d+$/, '');
  const assumed = new Set<ParamSource>();

  // 1. What kind of number it is.
  if (isFeedWord(profile, address)) {
    if (reading.lead) {
      const code = [...blockCodes, ...inForceEntries(after, blockCodes, db)].find(
        (entry) => entry.pitchFeed === true && paramOf(entry, address)?.unit === 'feedPerRev',
      )?.code;
      notes.push({ key: 'inspector.note.lead', params: { code: code ?? '' } });
    } else if (reading.cls === 'dwell') {
      const code = blockCodes.find((entry) => entry.fNotFeed === true)?.code ?? '';
      notes.push({ key: 'inspector.note.dwell', params: { code } });
    } else if (reading.cls === null && after.pitchFeedAmbiguous) {
      notes.push({ key: 'inspector.note.ambiguousFeed', params: { code: after.pitchFeedAmbiguous } });
    } else if (reading.cls === null) {
      notes.push({ key: 'inspector.note.feedUnknown' });
    } else {
      const key = FEED_KEY[reading.cls];
      if (key) {
        notes.push({ key });
        // The code that gave the unit: the feed-unit code in force when it agrees with the
        // class, else the code that declares the word with that unit (Okuma `G101 … F`).
        const unitWord = Object.keys(profile.addresses?.feedUnitWords ?? {}).some((w) => upper(w) === address);
        const source = unitWord ? null : feedUnitSource(after, db, reading.cls, address, blockCodes, blockLine);
        const by = source ? setBy(source, assumed) : null;
        if (by) notes.push(by);
      }
    }
  } else if (base !== '' && upper(profile.addresses?.spindle) === base && (address === base || isAssignmentWord(token))) {
    if (after.block.speedLimit) {
      notes.push({ key: 'inspector.note.speedLimit' });
    } else if (after.speedUnit === 'surface' || after.speedUnit === 'rpm') {
      notes.push({ key: after.speedUnit === 'surface' ? 'inspector.note.surfaceSpeed' : 'inspector.note.rpm' });
      const group = groupSetting(after, db, 'speedUnit');
      const by = group ? setBy(group.value, assumed) : null;
      if (by) notes.push(by);
      if (after.speedUnit === 'surface' && after.speedLimit) {
        notes.push({
          key: 'inspector.note.clamp',
          params: { value: after.speedLimit.valueText, line: after.speedLimit.line },
        });
      }
    }
  } else if ((profile.addresses?.speedLimitWords ?? []).some((w) => upper(w) === address)) {
    notes.push({ key: 'inspector.note.speedLimit' });
  }

  // 2. Incremental (a value of a code that makes the axis words data is not: `G71 U2.`).
  const twin = incrementalAxisOf(profile, address);
  if (twin !== null && reading.incremental) notes.push({ key: 'inspector.note.incrementalOf', params: { axis: twin } });
  else if (reading.incremental) notes.push({ key: 'inspector.note.incremental' });

  // 3. Diameter or radius (AD-19 rule 11), the hover's rule: only for a length (a dwell
  // time written in `X` is no diameter), and on a milling profile only a diameter.
  const lengthLike = reading.cls === null || reading.cls === 'length';
  const millRadius = reading.diameter === 'radius' && profile.machineType === 'mill';
  if (reading.diameter !== null && lengthLike && !millRadius) {
    notes.push({
      key:
        reading.diameter === 'diameter'
          ? 'inspector.note.diameter'
          : reading.diameter === 'radius'
            ? 'inspector.note.radius'
            : 'inspector.note.diameterUnknown',
    });
    if (after.diameter?.assumed) assumed.add(after.diameter.from ?? 'profile');
  }

  // 4. Axis words that are data, or positions in machine coordinates.
  if (isAxisWord(profile, address)) {
    for (const entry of blockCodes) {
      const what = axisWordsOf(entry);
      if (what === 'data') {
        notes.push({ key: 'inspector.note.axisData', params: { code: entry.code } });
        break;
      }
      if (what === 'machine') {
        // `G28`, `G30`: the words are an intermediate point in the program's coordinates,
        // which the code declares as its parameters; `G53`: machine coordinates.
        const via = paramOf(entry, address) !== null;
        notes.push({ key: via ? 'inspector.note.axisVia' : 'inspector.note.axisMachine', params: { code: entry.code } });
        break;
      }
    }
  }

  // 5. How the machine reads it.
  if (reading.readings.length > 0) {
    notes.push({ key: 'inspector.note.needsMachine' });
  } else if (reading.value !== null && token.value) {
    // The hover's wording: a machine that scales a word with a point too counts every
    // number in its unit; one that reads only a point-less word in increments says so.
    const units = unitsAfter(after, machine);
    const scaled = stepOf(reading.cls, view, units, true);
    const increments = scaled === null && !token.value.hasPoint ? stepOf(reading.cls, view, units, false) : null;
    if (scaled !== null) notes.push({ key: 'inspector.note.scaled', params: { step: scaled, unit: reading.unit ?? '' } });
    else if (increments !== null) notes.push({ key: 'inspector.note.noPoint', params: { step: increments, unit: reading.unit ?? '' } });
    if (reading.source === 'machine') notes.push({ key: 'inspector.note.machine', params: { name: machine.name ?? '' } });
  }

  // 6. Where the assumed readings come from.
  for (const from of ['machine', 'detected', 'profile'] as const) if (assumed.has(from)) notes.push({ key: ASSUMED_KEY[from] });
  return notes;
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

const FORMAT_AS_WRITTEN: NumberFormatOptions = { decimals: 'keep', trailingZeros: 'keep', keepPoint: true, plusSign: 'keep' };

/** True for a value that could be the number of a code: `83`, not `+5` and not `#101`. */
function looksLikeCodeNumber(token: NcToken): boolean {
  return token.valueText !== undefined && !!token.value && token.value.sign === '';
}

function addressLabel(db: CodeDb, token: NcToken): string | null {
  const found = lookupWord(db, { ...token, kind: 'word', address: token.address ?? token.text.toUpperCase() });
  return found?.address?.label ?? null;
}

/**
 * The parameter `address` is of: the block's cycle (in its `block`, B1), the block's other codes,
 * the codes in force.
 */
function paramFor(
  address: string,
  cycle: CodeEntry | null,
  blockCodes: readonly CodeEntry[],
  inForce: readonly CodeEntry[],
  block: CycleBlock | null = null,
): CodeParam | null {
  const own = paramOfBlock(cycle, address, block);
  if (own) return own;
  for (const entry of [...blockCodes, ...inForce]) {
    const param = entry === cycle ? paramOfBlock(entry, address, block) : paramOf(entry, address);
    if (param) return param;
  }
  return null;
}

function valueOfReading(reading: WordReading | null): InspectedValue | null {
  if (!reading) return null;
  return {
    cls: reading.cls,
    effective: reading.value,
    unit: reading.unit as ValueUnit | null,
    source: reading.source,
    readings: reading.readings,
  };
}

/**
 * The inspector's rows for the block at the cursor. `after` is the state after the block's
 * last line, in which every word of the block is read (AD-35); `before` the state after the
 * line before the block, only to mark the state rows the block changed. Either is null while
 * the modal index has not reached it: the word rows still show, and the notes and values
 * that need the state, and the state rows, wait (`stateReady` false).
 */
export function inspectBlock(
  input: InspectInput,
  view: InspectView,
  before: ModalState | null,
  after: ModalState | null,
): BlockInspection {
  const { first, last } = blockRange(input, view.cp);
  if (input.lineCount < 1) return { firstLine: first, lastLine: last, words: [], cycle: null, state: [], stateReady: after !== null };
  const { db, profile, cp } = view;
  const lines = tokenizeBlock(input, cp, first, last);
  const blockTokens = lines.flatMap((l) => l.tokens);
  const blockCodes = blockEntries(blockTokens, db);
  const inForce = after ? inForceEntries(after, blockCodes, db) : [];
  const found = findCycle(input, view, lines, blockCodes, after, first, last);
  const cycleEntry = found?.entry ?? null;
  const cycleBlock = found?.block ?? null;
  const codeAddresses = codeAddressesOf(db);
  const units = unitsAfter(after, view.machine);

  const words: InspectedWord[] = [];
  const push = (line: number, token: NcToken, kind: InspectedKind, meaning: string | null, param: CodeParam | null): void => {
    const reading =
      after && (kind === 'address' || kind === 'cycleParam' || kind === 'assignment' || kind === 'variable')
        ? readWord(token, blockTokens, after, view)
        : null;
    const word: InspectedWord = {
      line,
      token,
      kind,
      written: token.text,
      address: token.address ?? null,
      meaning,
      value: valueOfReading(reading),
      notes: notesOf(token, kind, reading, after, view, blockCodes, first),
      edit: { ok: true },
    };
    if (param) word.param = param;
    word.edit = checkEdit(word);
    if (word.edit.ok && reading) {
      word.how = {
        cls: reading.cls,
        params: view.machine.params,
        units,
        fmt: profile.numberFormat ?? FORMAT_AS_WRITTEN,
        readings: reading.readings,
      };
    }
    words.push(word);
  };

  for (const { line, text, tokens } of lines) {
    const consumed = new Set<number>();
    tokens.forEach((token, i) => {
      if (consumed.has(i)) return;
      switch (token.kind) {
        case 'blockNumber':
        case 'programMarker':
          // `N10`, `O1234`: rows that are never edited; `%`, a header and a bare Klartext number are not rows.
          if (token.address !== undefined && token.address !== '') push(line, token, 'address', addressLabel(db, token), null);
          return;
        case 'unknown': {
          // The marker of a line that continues the block above (Okuma `$`) is no word.
          const re = cp.re.continuationStart;
          if (re) {
            re.lastIndex = 0;
            const m = re.exec(text);
            if (m && m.index === 0 && token.start < m[0].length) return;
          }
          push(line, token, 'unknown', null, null);
          return;
        }
        case 'variable': {
          const assignment = assignmentAt(tokens, i, text, { profile, db });
          if (assignment) {
            for (let j = i + 1; j <= assignment.last; j++) consumed.add(j);
            const param = paramOfBlock(cycleEntry, token.text, cycleBlock);
            if (param) push(line, assignment.token, 'cycleParam', param.label, param);
            else push(line, assignment.token, 'assignment', addressLabel(db, token), null);
          } else {
            push(line, token, 'variable', addressLabel(db, token), null);
          }
          return;
        }
        case 'keyword': {
          const { entry, joined } = keywordEntry(tokens, i, db);
          let shown = token;
          if (joined) {
            consumed.add(tokens.indexOf(joined));
            shown = {
              kind: 'keyword',
              start: token.start,
              end: joined.end,
              text: text.slice(token.start, joined.end),
              address: entry?.code ?? token.address,
            };
          }
          const described = entry && entry.verify !== true ? entry : null;
          push(line, shown, described ? 'code' : 'unknown', described?.label ?? null, null);
          return;
        }
        case 'call': {
          const entry = lookupCode(db, token.address ?? '');
          const described = entry && entry.verify !== true ? entry : null;
          push(line, token, described ? 'call' : 'unknown', described?.label ?? null, null);
          return;
        }
        case 'word': {
          if (token.address === undefined) return; // a bare value of a keyword: `TOOL CALL 1`
          const lookup = lookupWord(db, token);
          const entry = lookup?.entry ?? null;
          const described = entry && entry.verify !== true ? entry : null;
          if (isAssignmentWord(token)) {
            if (entry) push(line, token, described ? 'code' : 'unknown', described?.label ?? null, null);
            else if (token.value === null) push(line, token, 'variable', lookup?.address?.label ?? null, null);
            else push(line, token, 'assignment', lookup?.address?.label ?? null, paramFor(token.address, cycleEntry, blockCodes, inForce, cycleBlock));
            return;
          }
          if (entry) {
            push(line, token, described ? 'code' : 'unknown', described?.label ?? null, null);
            return;
          }
          if (codeAddresses.has(upper(token.address)) && looksLikeCodeNumber(token)) {
            push(line, token, 'unknown', null, null);
            return;
          }
          if (token.valueText !== undefined && /^[+-]$/.test(token.valueText)) {
            // A bare sign is a direction, fixed when written (Klartext `DR+`, `DR-`): no
            // number to read or edit, and no variable either.
            push(line, token, 'address', lookup?.address?.label ?? null, null);
            return;
          }
          if (token.valueText !== undefined && token.value === null) {
            push(line, token, 'variable', lookup?.address?.label ?? null, null);
            return;
          }
          const cycleParam = paramOfBlock(cycleEntry, token.address, cycleBlock);
          if (cycleParam) {
            push(line, token, 'cycleParam', cycleParam.label, cycleParam);
            return;
          }
          const param = paramFor(token.address, null, blockCodes.filter((e) => e !== cycleEntry), inForce);
          push(line, token, lookup?.unknown && !param ? 'unknown' : 'address', param?.label ?? lookup?.address?.label ?? null, param);
          return;
        }
        default:
          // Whitespace, comments, strings, text, operators, expressions, labels, the
          // continuation marker and a block skip are not rows.
          return;
      }
    });
  }

  const stateReady = after !== null;
  return {
    firstLine: first,
    lastLine: last,
    words,
    cycle: found?.cycle ?? null,
    state: after ? stateRows(after, before, first, last, view) : [],
    stateReady,
  };
}

// ---------------------------------------------------------------------------
// The state rows
// ---------------------------------------------------------------------------

type Row = Omit<InspectedState, 'setHere' | 'label'>;

function fromValue(key: string, value: ModalValue): Row {
  const row: Row = { key, value: value.code, line: value.line, assumed: value.assumed };
  if (value.assumed && value.from) row.from = value.from;
  return row;
}

function plainRows(s: ModalState, view: InspectView): Row[] {
  const { db, profile } = view;
  const g = s.groups ?? {};
  const used = new Set<string>(['motion', 'plane', 'distance', 'units', 'diametermode', 'offset', 'spindle', 'coolant', 'compensation', 'cycle']);
  const rows: Row[] = [];
  const add = (row: Row | null): void => {
    if (row) rows.push(row);
  };

  add(g.motion ? fromValue('motion', g.motion) : null);
  add(g.plane ? fromValue('plane', g.plane) : s.plane !== 'unknown' ? { key: 'plane', value: s.plane, line: 0, assumed: false } : null);
  add(
    g.distance
      ? fromValue('distance', g.distance)
      : s.distance !== 'unknown'
        ? { key: 'distance', value: s.distance, line: 0, assumed: false }
        : null,
  );
  if (g.units) add(fromValue('units', g.units));
  else if (s.units && s.units.value !== 'unknown') {
    const row: Row = { key: 'units', value: s.units.value, line: s.units.line, assumed: s.units.assumed };
    if (s.units.assumed && s.units.from) row.from = s.units.from;
    add(row);
  }
  if (g.diametermode) add(fromValue('diameter', g.diametermode));
  else if (s.diameter) {
    const row: Row = { key: 'diameter', value: s.diameter.mode, line: s.diameter.line, assumed: s.diameter.assumed };
    if (s.diameter.assumed && s.diameter.from) row.from = s.diameter.from;
    add(row);
  }
  add(g.offset ? fromValue('workOffset', g.offset) : null);
  add(s.tool ? { key: 'tool', value: s.tool.written, line: s.tool.line, assumed: false } : null);
  add(g.spindle ? fromValue('spindle', g.spindle) : null);

  // The speed: the code that sets its unit, and the last speed word.
  const spindle = upper(profile.addresses?.spindle) || 'S';
  const speedGroup = groupSetting(s, db, 'speedUnit');
  if (speedGroup) used.add(speedGroup.name);
  const speedWord = s.speed && !s.speed.variable ? `${spindle}${s.speed.valueText}` : s.speed ? s.speed.valueText : null;
  if (speedGroup || speedWord !== null || s.speedUnit !== 'unknown') {
    const base: Row = speedGroup
      ? fromValue('speed', speedGroup.value)
      : { key: 'speed', value: s.speedUnit !== 'unknown' ? s.speedUnit : '', line: s.speed?.line ?? 0, assumed: false };
    base.value = [base.value, speedWord].filter((part) => part !== null && part !== '').join(' ');
    if (base.value !== '') add(base);
  }
  add(s.speedLimit ? { key: 'speedLimit', value: s.speedLimit.valueText, line: s.speedLimit.line, assumed: false } : null);

  // The feed: the code that sets its unit, and the last feed word.
  const feed = upper(profile.addresses?.feed) || 'F';
  const feedGroup = groupSetting(s, db, 'feedUnit');
  if (feedGroup) used.add(feedGroup.name);
  const feedWord = s.feed && !s.feed.variable ? `${feed}${s.feed.valueText}` : s.feed ? s.feed.valueText : null;
  if (feedGroup || feedWord !== null || s.feedUnit !== 'unknown') {
    const base: Row = feedGroup
      ? fromValue('feed', feedGroup.value)
      : { key: 'feed', value: s.feedUnit !== 'unknown' ? s.feedUnit : '', line: s.feed?.line ?? 0, assumed: false };
    base.value = [base.value, feedWord].filter((part) => part !== null && part !== '').join(' ');
    if (base.value !== '') add(base);
  }

  add(g.coolant ? fromValue('coolant', g.coolant) : null);
  add(g.compensation ? fromValue('compensation', g.compensation) : null);
  // A threading move the interpreter carries as the active cycle (`G32`, `G33`) is a move:
  // the motion row shows it, and the cycle row is the cycle group's (`G80`).
  const activeIsMove = s.activeCycle !== null && lookupCode(db, s.activeCycle.code)?.group === 'motion';
  if (s.activeCycle && !activeIsMove) add({ key: 'cycle', value: s.activeCycle.code, line: s.activeCycle.line, assumed: false });
  else add(g.cycle ? fromValue('cycle', g.cycle) : null);
  if (s.definedCycle) {
    const value = s.modalCall ? `${s.definedCycle.code} · ${s.modalCall.code}` : s.definedCycle.code;
    add({ key: 'definedCycle', value, line: s.definedCycle.line, assumed: false });
  }
  add(s.frame ? { key: 'frame', value: s.frame.code, line: s.frame.line, assumed: false } : null);
  add(s.tcp ? { key: 'tcp', value: s.tcp.code, line: s.tcp.line, assumed: false } : null);

  for (const name of Object.keys(g).sort()) {
    if (used.has(name) || !g[name]) continue;
    add(fromValue(`group:${name}`, g[name]));
  }
  return rows;
}

function stateRows(after: ModalState, before: ModalState | null, first: number, last: number, view: InspectView): InspectedState[] {
  const was = new Map((before ? plainRows(before, view) : []).map((row) => [row.key, row]));
  return plainRows(after, view).map((row) => {
    const prior = was.get(row.key);
    const setHere = (row.line >= first && row.line <= last) || (before !== null && (!prior || prior.value !== row.value));
    const label: Msg = row.key.startsWith('group:')
      ? { key: 'inspector.state.group', params: { name: row.key.slice('group:'.length) } }
      : { key: `inspector.state.${row.key}` };
    return { ...row, label, setHere };
  });
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * Whether a row may be edited (AD-27): `G`, `M`, `N`, `O` words, calls, keywords and
 * variables are not; a word whose reading depends on a machine that is not chosen is not,
 * with that reason; nothing is while the state the word is read in is not known yet.
 */
export function checkEdit(word: InspectedWord): { ok: true } | { ok: false; reason: Msg } {
  const no = (key: string): { ok: false; reason: Msg } => ({ ok: false, reason: { key: `inspector.why.${key}` } });
  if (word.token.kind === 'blockNumber') return no('blockNumber');
  if (word.token.kind === 'programMarker') return no('programNumber');
  switch (word.kind) {
    case 'code':
      return no('code');
    case 'call':
      return no('call');
    case 'unknown':
      return no('unknown');
    case 'variable':
      return no('variable');
    default:
      break;
  }
  if (!word.token.value || word.token.valueText === undefined) return no('noValue');
  if (word.value === null) return no('waiting');
  if (word.value.readings.length > 0) return no('needsMachine');
  return { ok: true };
}

/** Addresses written as whole numbers when they carry no class and no point (the tool word joins them). */
const WHOLE_NUMBER_ADDRESSES = ['D', 'H'];

/** `a` compared with `b`, both decimal text: -1, 0 or 1, exactly. */
function compareDecimal(a: string, b: string): number {
  const pa = parseNumber(a.trim());
  const pb = parseNumber(b.trim());
  if (!pa || !pb) return 0;
  const scale = Math.max(pa.fracPart?.length ?? 0, pb.fracPart?.length ?? 0);
  const big = (p: NonNullable<typeof pa>): bigint => {
    const digits = `${p.intPart}${(p.fracPart ?? '').padEnd(scale, '0')}`.replace(/^0+(?=\d)/, '') || '0';
    const n = BigInt(digits);
    return p.sign === '-' ? -n : n;
  };
  const x = big(pa);
  const y = big(pb);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A finite JS number as plain decimal text (`1e-7` → `0.0000001`). */
function numberText(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const text = String(n);
  if (!/e/i.test(text)) return text;
  return n.toFixed(20).replace(/\.?0+$/, '');
}

/**
 * What was typed for a row, checked before anything is written: a decimal number (a decimal
 * comma is read as the point), a whole number for the tool word, `D` and `H` written as plain
 * register numbers and every `unit: 'count'` parameter, the parameter's `min`/`max` (against
 * the typed, effective value). `null` when it may be written; the message otherwise. Never
 * corrects the value.
 */
export function checkValue(word: InspectedWord, typed: string, view: InspectView): Msg | null {
  if (!word.edit.ok) return word.edit.reason;
  const text = typeof typed === 'string' ? typed.trim().replace(',', '.') : '';
  const lit = parseNumber(text);
  if (!lit) return { key: 'inspector.why.notANumber' };
  const fraction = (lit.fracPart ?? '').replace(/0+$/, '');

  const address = upper(word.address);
  const tool = upper(view.profile.addresses?.tool);
  const plainRegister =
    (word.value?.cls ?? null) === null &&
    word.token.value?.hasPoint !== true &&
    ((tool !== '' && address === tool) || WHOLE_NUMBER_ADDRESSES.includes(address));
  if ((word.param?.unit === 'count' || plainRegister) && fraction !== '') {
    return { key: 'inspector.why.wholeNumber' };
  }
  // A tool, `D` or `H` register number is never negative (`-0` neither: no sign at all).
  if (plainRegister && lit.sign === '-') return { key: 'inspector.why.min', params: { min: '0' } };
  const min = word.param?.min;
  if (typeof min === 'number' && compareDecimal(text, numberText(min)) < 0) {
    return { key: 'inspector.why.min', params: { min: numberText(min) } };
  }
  const max = word.param?.max;
  if (typeof max === 'number' && compareDecimal(text, numberText(max)) > 0) {
    return { key: 'inspector.why.max', params: { max: numberText(max) } };
  }
  return null;
}
