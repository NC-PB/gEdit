// The TypeScript modal interpreter and its index (Phase 3 plan §6.1, Phase 2 plan §7.4 and
// AD-19). Implemented by P3.1.
//
// What it does, in one paragraph: it reads the same state out of a program as the Python
// interpreter (`src-tauri/resources/scripts/_nc_modal.py`), rule for rule (AD-19 rules 1-12,
// the defined cycle of §7.4 and rule 11b, the cycle a word in front of it makes modal
// (Sinumerik `MCALL`), rules 13-15, the speed-limit bound, indexed assignment words,
// the main spindle by number), driven by the **effective** compiled profile and code
// database it is given and by no dialect name. The oracle is `tests/fixtures/modal/**`, every
// golden unchanged (`modal.golden.test.ts`), and the per-line parity check
// `tests/unit/modalParity.test.ts`, which runs both interpreters over every golden's program
// and every owner-public program and compares the state after every line.
//
// Where this file departs from a literal transcription of the Python, it does so for speed
// and never for meaning (each is pinned by a test):
//   - a written code is looked up through a small memo, and only when its first letter can
//     start a code of the database at all: `X10.123` never reaches `normalizeCode` (three
//     regex replaces), so a line of coordinates costs no regex call here (`modal.test.ts`
//     pins the regex calls per line);
//   - the codes of a block are collected once per `update`, not again for rule 11's
//     positioning check;
//   - the per-line state lives in one plain record (`Inner`), so `snapshot`/`restore` are a
//     structured copy of it.
//
// What it does **not** follow, on purpose and as in Python (P3a prelude, decision 7): the
// master spindle a program switches with `SETMS(n)`, and the Okuma `G141` spindle selection.
// A plain `S` is the master spindle's speed, whichever spindle that is. Following them is a
// later decision for both languages at once, with goldens.
//
// `ModalIndex` keeps a snapshot every `every` lines (1,000), so `stateAfter(n)` replays at
// most 999 lines (exactly `every` for the line of a snapshot an edit has just dropped, read
// from the snapshot before it); an edit drops the snapshots at and after its first changed line, and the
// owner of the index (`app/modalService.ts`) rebuilds the rest in idle chunks
// (`buildSome`). A reader never waits for the build: a line no snapshot within `every` lines
// covers yet answers `null` (AD-33). No worker (P1 AD-12).

import { lookupCode, normalizeCode } from '$lib/core/codes/lookup';
import type { CodeDb, CodeEntry, CodeSets } from '$lib/core/codes/types';
import type { CompiledProfile, FeedUnit } from '$lib/core/profiles/types';
import type { ParamSource } from '$lib/core/machines/types';
import { maskComments } from './mask';
import { tokenizeLine } from './tokenizer';
import type { LineState, ModalState, ModalValue, NcToken, WordSeen } from './types';

/** How many lines lie between two snapshots of a `ModalIndex` (Phase 2 plan AD-19). */
export const SNAPSHOT_EVERY = 1000;

/** The most lines one `statesAfter` call answers for (Phase 3 plan §6.1). */
export const STATES_MAX = 1000;

/**
 * Thrown by a placeholder implementation. Nothing throws it since P3.1; it stays exported
 * because the parity harness names it.
 */
export class ModalNotImplemented extends Error {
  constructor(what: string) {
    super(`${what}: the TypeScript modal interpreter is not implemented yet (P3.1)`);
    this.name = 'ModalNotImplemented';
  }
}

// ---------------------------------------------------------------------------
// Reading one entry and one token (the twins of `_nc_modal.py`'s helpers)
// ---------------------------------------------------------------------------

/** What a value or a group reads as while nothing has said anything. */
const UNKNOWN = 'unknown';

/** Rule 15: the tool axis a bare axis letter names → the working plane. */
const PLANE_OF_TOOL_AXIS: Readonly<Record<string, 'XY' | 'ZX' | 'YZ'>> = { Z: 'XY', Y: 'ZX', X: 'YZ' };

/** The written codes of the memo, at most; past it the memo starts over (a bound, not an LRU). */
const MEMO_MAX = 4096;

const DIGITS = /^[0-9]+$/;

/** A Python `float()` literal (`+0`, `-0.000`, `1_0e2`, `.5`), without `inf`/`nan`, which are never zero. */
const PY_FLOAT = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/;

/** `_is_zero`: a value written as a plain number that is zero; anything else is not. */
function isZero(value: string): boolean {
  const text = value.trim();
  if (!PY_FLOAT.test(text)) return false;
  return Number(text.replace(/_/g, '')) === 0;
}

/** `is_assignment`: an address written with `=` (`SB=1200`, `S3=2500`, `S[2]=500`, `F=R1`). */
function isAssignment(token: NcToken): boolean {
  if (token.kind !== 'word' || !token.address) return false;
  if (token.index !== undefined) return true;
  const eq = token.text.indexOf('=');
  return eq >= 0 && token.text.slice(0, eq).trim().toUpperCase() === token.address.toUpperCase();
}

/** `same_spindle`: `1` and `01` name the same spindle; a letter is compared without case. */
function sameSpindle(written: string, main: string): boolean {
  const a = written.trim();
  const b = main.trim();
  if (DIGITS.test(a) && DIGITS.test(b)) return Number.parseInt(a, 10) === Number.parseInt(b, 10);
  return a !== '' && a.toUpperCase() === b.toUpperCase();
}

/** `names_main_spindle`: `S1=900` / `S[1]=900` while `addresses.mainSpindle` is 1 (P10, decision 3). */
function namesMainSpindle(token: NcToken, speedAddress: string, mainSpindle: string | null): boolean {
  if (mainSpindle === null || mainSpindle.trim() === '' || token.kind !== 'word' || !token.address) return false;
  const speed = speedAddress.toUpperCase();
  const address = token.address.toUpperCase();
  if (token.index !== undefined) return address === speed && sameSpindle(token.index, mainSpindle);
  if (!isAssignment(token) || !address.startsWith(speed) || address === speed) return false;
  return sameSpindle(address.slice(speed.length), mainSpindle);
}

/** `_next_code_token`: the next token that is not whitespace. */
function nextCodeToken(tokens: readonly NcToken[], start: number): NcToken | undefined {
  for (let i = start; i < tokens.length; i++) if (tokens[i].kind !== 'whitespace') return tokens[i];
  return undefined;
}

/** `_zero_words_of`: the angle words of `frameZeroWords`, upper case. */
function zeroWordsOf(entry: CodeEntry): string[] {
  const words = entry.frameZeroWords;
  if (!Array.isArray(words)) return [];
  return words.filter((word) => typeof word === 'string' && word !== '').map((word) => word.toUpperCase());
}

/** `_empty_closes_of`: the sub-block number whose empty block closes the code's group. */
function emptyClosesOf(entry: CodeEntry | null): string | null {
  const value = entry?.frameEmptyCloses;
  return typeof value === 'string' && DIGITS.test(value) ? value : null;
}

/** `axis_words_of`: `'data'` for a block whose axis words are values, not a position. */
function axisWordsAreData(entry: CodeEntry | null): boolean {
  if (entry === null) return false;
  return entry.wordsAreData === true || entry.axisWords === 'data';
}

function seen(token: NcToken, line: number): WordSeen {
  return { valueText: token.valueText ?? '', line, variable: token.value === undefined || token.value === null };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// The interpreter
// ---------------------------------------------------------------------------

type Cycle = { code: string; line: number; pitchFeed: boolean };
type Frame = { code: string; line: number; group: string | null; nonzero?: string[] };
type Block = ModalState['block'];
type Units = ModalState['units'];
type Diameter = NonNullable<ModalState['diameter']>;
type Tool = NonNullable<ModalState['tool']>;

/** Everything `update` carries from one line to the next (and nothing it does not). */
interface Inner {
  groups: Record<string, ModalValue>;
  feedUnitGroup: string;
  feedUnitWord: string | null;
  speedUnit: ModalState['speedUnit'];
  plane: ModalState['plane'];
  distance: ModalState['distance'];
  tool: Tool | null;
  lastTool: Tool | null;
  feed: WordSeen | null;
  speed: WordSeen | null;
  speedLimit: WordSeen | null;
  activeCycle: Cycle | null;
  definedCycle: Cycle | null;
  modalCall: { code: string; line: number } | null;
  /** Rule 11b: the cycle a `'call-modal-next'` word made modal (Sinumerik `MCALL CYCLE81(…)`). */
  mcall: Cycle | null;
  frames: Frame[];
  tcp: { code: string; line: number; group: string | null } | null;
  modalAmbiguous: string | null;
  units: Units;
  diameter: Diameter | null;
  /** The line just applied ends in a continuation: the next one is the same block. */
  continued: boolean;
  block: Block;
  blockAmbiguous: string | null;
  blockDwell: string | null;
  blockRun: Cycle | null;
  blockDefined: Cycle | null;
  blockUpper: boolean;
  blockLower: boolean;
}

function emptyBlock(): Block {
  return { cycle: null, pitchFeed: false, speedLimit: false, fNotFeed: false, toolChange: false };
}

function copyOf<T extends object | null>(value: T): T {
  return value === null ? value : ({ ...value } as T);
}

function cloneInner(s: Inner): Inner {
  const groups: Record<string, ModalValue> = {};
  for (const key of Object.keys(s.groups)) groups[key] = { ...s.groups[key] };
  return {
    ...s,
    groups,
    tool: copyOf(s.tool),
    lastTool: copyOf(s.lastTool),
    feed: copyOf(s.feed),
    speed: copyOf(s.speed),
    speedLimit: copyOf(s.speedLimit),
    activeCycle: copyOf(s.activeCycle),
    definedCycle: copyOf(s.definedCycle),
    modalCall: copyOf(s.modalCall),
    mcall: copyOf(s.mcall),
    frames: s.frames.map((f) => (f.nonzero === undefined ? { ...f } : { ...f, nonzero: [...f.nonzero] })),
    tcp: copyOf(s.tcp),
    units: { ...s.units },
    diameter: copyOf(s.diameter),
    block: { ...s.block },
    blockRun: copyOf(s.blockRun),
    blockDefined: copyOf(s.blockDefined),
  };
}

/** The opaque snapshot type; only `ModalInterpreter.restore` reads it. */
interface Snapshot {
  readonly inner: Inner;
}

/** Walks a program line by line and keeps what is in force (§7.4, AD-19). */
export class ModalInterpreter {
  private readonly cp: CompiledProfile;
  private readonly db: CodeDb;
  private readonly feedAddress: string;
  private readonly speedAddress: string;
  private readonly mainSpindle: string | null;
  private readonly feedUnitWords: Map<string, string>;
  private readonly speedLimitWords: Set<string>;
  private readonly axes: Set<string>;
  private readonly toolFromLast: boolean;
  private readonly hasDistance: boolean;
  private readonly hasBareFrames: boolean;
  private readonly hasZeroFrames: boolean;
  private readonly hasEmptyCloses: boolean;
  /** Rule 11b: the database has a `'call-modal-next'` word at all (only then is a block searched for one). */
  private readonly hasModalNext: boolean;
  /** Rule 11b: the block being applied holds a `'call-modal-next'` word. */
  private modalNext = false;
  /** The first letters a code of the database starts with, normalized: `G`, `M`, `C` (`CYCL DEF`, `CYCLE81`). */
  private readonly heads: Set<string>;
  /** Written code → entry (or null), for the codes `heads` lets through. */
  private readonly memo = new Map<string, CodeEntry | null>();
  private s!: Inner;

  // Per block, filled by `readValues` and read in the same `update` only (`_read_values`).
  private axisPlane = false;
  private callsBare = new Map<string, boolean>();
  private blockValues = false;
  private blockWords = new Map<string, string>();
  private blockSubs = new Map<string, string>();

  /** The **effective** compiled profile and database of the document (AD-31). */
  constructor(cp: CompiledProfile, db: CodeDb) {
    this.cp = cp;
    this.db = db;
    const profile = record(cp.profile);
    const addresses = record(profile.addresses);
    this.feedAddress = nonEmpty(addresses.feed)?.toUpperCase() ?? 'F';
    this.speedAddress = nonEmpty(addresses.spindle)?.toUpperCase() ?? 'S';
    const main = addresses.mainSpindle;
    this.mainSpindle = typeof main === 'string' && main.trim() !== '' ? main.trim() : null;
    this.feedUnitWords = new Map();
    for (const [word, unit] of Object.entries(record(addresses.feedUnitWords))) this.feedUnitWords.set(word.toUpperCase(), String(unit));
    const limits = addresses.speedLimitWords;
    this.speedLimitWords = new Set(Array.isArray(limits) ? limits.filter((w): w is string => typeof w === 'string').map((w) => w.toUpperCase()) : []);
    const axes = addresses.axes;
    this.axes = new Set(Array.isArray(axes) ? axes.filter((a): a is string => typeof a === 'string' && a !== '').map((a) => a.toUpperCase()) : []);
    this.toolFromLast = record(profile.toolCall).toolFrom === 'same-line-or-last';

    const codes = Array.isArray(db.codes) ? db.codes : [];
    this.hasDistance = codes.some((e) => e.sets?.distance === 'absolute' || e.sets?.distance === 'incremental');
    this.hasBareFrames = codes.some((e) => e.frameWithoutValues === 'close');
    this.hasZeroFrames = codes.some((e) => zeroWordsOf(e).length > 0);
    this.hasEmptyCloses = codes.some((e) => emptyClosesOf(e) !== null);
    this.hasModalNext = codes.some((e) => e.sets?.cycle === 'call-modal-next');
    this.heads = new Set();
    for (const entry of codes) {
      for (const code of [entry.code, ...(entry.aliases ?? [])]) {
        if (typeof code !== 'string' || code === '') continue;
        const key = normalizeCode(code);
        if (key !== '') this.heads.add(key[0]);
      }
    }
    this.reset();
  }

  /** The entry of a written code, following aliases (`_entries.get(normalize_code(code))`). */
  private entryOf(written: string): CodeEntry | null {
    if (written === '') return null;
    // Only a code whose normalized form starts with a letter some code starts with can be
    // one; `normalizeCode` upper-cases and trims, and every written code here starts with an
    // address, a keyword or an identifier.
    const head = written.trimStart().charAt(0).toUpperCase();
    if (!this.heads.has(head)) return null;
    const known = this.memo.get(written);
    if (known !== undefined) return known;
    const entry = lookupCode(this.db, written);
    if (this.memo.size >= MEMO_MAX) this.memo.clear();
    this.memo.set(written, entry);
    return entry;
  }

  // -- the power-on state ---------------------------------------------------

  /** The power-on state: `modal.initial`, `modal.units`, `modal.diameter`, assumed, with `from` (rule 8). */
  reset(): void {
    const modal = record(record(this.cp.profile).modal);
    const sources = record(modal.sources);
    this.s = {
      groups: {},
      feedUnitGroup: UNKNOWN,
      feedUnitWord: null,
      speedUnit: 'unknown',
      plane: 'unknown',
      // Rule 8: a database that declares no distance code at all leaves one reading.
      distance: this.hasDistance ? 'unknown' : 'absolute',
      tool: null,
      lastTool: null,
      feed: null,
      speed: null,
      speedLimit: null,
      activeCycle: null,
      definedCycle: null,
      modalCall: null,
      mcall: null,
      frames: [],
      tcp: null,
      modalAmbiguous: null,
      units: { value: 'unknown', line: 0, assumed: false },
      diameter: null,
      continued: false,
      block: emptyBlock(),
      blockAmbiguous: null,
      blockDwell: null,
      blockRun: null,
      blockDefined: null,
      blockUpper: false,
      blockLower: false,
    };
    const fromOf = (key: string): ParamSource | undefined => {
      const source = sources[key];
      return typeof source === 'string' ? (source as ParamSource) : undefined;
    };
    const withFrom = <T extends object>(value: T, from: ParamSource | undefined): T => (from === undefined ? value : { ...value, from });

    const initial = modal.initial;
    if (typeof initial === 'object' && initial !== null && !Array.isArray(initial)) {
      const table = initial as Record<string, unknown>;
      for (const group of Object.keys(table).sort()) {
        const code = table[group];
        if (group === '' || typeof code !== 'string') continue;
        this.s.groups[group] = withFrom({ code, line: 0, assumed: true }, fromOf(group));
        // The power-on code carries its own meaning: a lathe that powers on in `G99` powers on
        // in feed per revolution, and the derived units have to say so from line 0 on.
        this.applySets(this.entryOf(code)?.sets, 0, true);
      }
    }
    // `modal.units` and `modal.diameter` are what `applyMachine` wrote (AD-31): the authority.
    const units = modal.units;
    if (units === 'mm' || units === 'inch') this.s.units = withFrom({ value: units, line: 0, assumed: true }, fromOf('units'));
    const diameter = modal.diameter;
    if (diameter === 'on' || diameter === 'off' || diameter === 'absolute-only') {
      this.s.diameter = withFrom<Diameter>({ mode: diameter, line: 0, assumed: true }, fromOf('diameter'));
    }
  }

  // -- one block --------------------------------------------------------------

  /**
   * Applies one line. `tokens` from `tokenizeLine` with the state of the line before,
   * `line` 1-based, `masked` the line from `maskComments` (the tool rule reads it; an empty
   * `masked` skips the tool rule, as in Python).
   *
   * Whether the line continues the block above by a marker at its **start**
   * (`syntax.continuationStart`, Okuma `$`; P2 §7.16 #27) the interpreter asks its own
   * profile, on the line the tokens give back — the text Python's `continues_block` reads,
   * so a comment holding the marker's look-ahead (`%`) reads alike in both languages.
   */
  update(tokens: NcToken[], line: number, masked: string): void {
    const s = this.s;
    const start = this.cp.re.continuationStart;
    let continued = false;
    if (start !== undefined) {
      let text = '';
      for (const token of tokens) text += token.text;
      continued = start.test(text);
    }
    const sameBlock = s.continued || continued;
    s.continued = tokens.some((token) => token.kind === 'continuation');
    if (!sameBlock) this.clearBlock();

    // Two passes, because a block is not a sentence: every code of the block is applied
    // before a single address word is read (rules 4 and 6 depend on it).
    this.axisPlane = false;
    this.readValues(tokens);
    const codes = this.writtenCodes(tokens);
    // Rule 11b: a `'call-modal-next'` word ends the modal call in force; the cycle written
    // behind it in the same block (if any) becomes the new one.
    this.modalNext = this.hasModalNext && codes.some((code) => this.entryOf(code)?.sets?.cycle === 'call-modal-next');
    if (this.modalNext) s.mcall = null;
    for (const code of codes) this.applyCode(code, line);
    if (this.axisPlane) this.applyToolAxis(tokens);
    this.applyModalCall(tokens, codes);
    this.applyWords(tokens, line);
    if (masked !== '') this.applyTool(masked, line);
  }

  private clearBlock(): void {
    const s = this.s;
    const block = s.block;
    block.cycle = null;
    block.pitchFeed = false;
    block.speedLimit = false;
    block.fNotFeed = false;
    block.toolChange = false;
    s.blockAmbiguous = null;
    s.blockDwell = null;
    s.blockRun = null;
    s.blockDefined = null;
    s.blockUpper = false;
    s.blockLower = false;
  }

  /**
   * `_written_codes`: every code the block writes, in written order. A word whose address
   * cannot start a code of the database (`X10.`) is left out here already: it would be an
   * unknown code (rule 9), and every reader of this list ignores those.
   */
  private writtenCodes(tokens: readonly NcToken[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind === 'word') {
        const address = token.address ?? '';
        if (address !== '' && this.heads.has(address.charAt(0).toUpperCase()) && !isAssignment(token)) out.push(address + (token.valueText ?? ''));
      } else if (token.kind === 'call') {
        const name = token.address ?? '';
        if (name !== '') out.push(name);
      } else if (token.kind === 'keyword') {
        const name = token.address || token.text;
        let number = token.valueText;
        if (number === undefined) {
          const next = nextCodeToken(tokens, i + 1);
          if (next !== undefined && next.address === undefined && next.valueText !== undefined) number = next.valueText;
        }
        out.push(this.joinedCode(name, number) ?? name);
      }
    }
    return out;
  }

  /** `_joined_code`: a keyword and the number behind it as one code, when the database knows the pair. */
  private joinedCode(name: string, number: string | undefined): string | null {
    if (number === undefined) return null;
    const joined = `${name} ${number}`;
    if (this.entryOf(joined) !== null) return joined;
    const dot = number.indexOf('.');
    if (dot >= 0) {
      const whole = number.slice(0, dot);
      const part = number.slice(dot + 1);
      if (DIGITS.test(whole) && DIGITS.test(part)) {
        const shorter = `${name} ${whole}`;
        if (this.entryOf(shorter) !== null) return shorter;
      }
    }
    return null;
  }

  private applyCode(code: string, line: number): void {
    const entry = this.entryOf(code);
    if (entry === null) return; // rule 9: an unknown code changes nothing
    const s = this.s;
    const canonical = nonEmpty(entry.code) ?? code;
    const group = nonEmpty(entry.group);
    const sets = entry.sets;
    const modal = entry.modal === true;
    const ambiguous = entry.pitchFeedAmbiguous === true;
    const pitch = entry.pitchFeed === true;

    // Rule 1: a modal entry becomes the active code of its group.
    if (modal && group !== null) s.groups[group] = { code: canonical, line, assumed: false };

    this.applySets(sets, line, false);
    this.applyFrame(entry, canonical, group, line);
    this.applyTcp(sets, canonical, modal ? group : null, line);
    if (sets?.planeFromAxisWord === true) this.axisPlane = true;

    // Rule 6: the block's feed word is a time here, not a feed.
    if (entry.fNotFeed === true) {
      s.block.fNotFeed = true;
      s.blockDwell = s.blockDwell ?? canonical;
    }

    const cycle = sets?.cycle;
    if (cycle === 'define' || cycle === 'call' || cycle === 'call-modal') {
      this.applyDefined(cycle, canonical, line, pitch);
      return;
    }
    if (cycle === 'call-modal-next') return; // rule 11b: read in `update`
    if (cycle === 'start' && this.modalNext) {
      // Rule 11b: written behind `MCALL`, the cycle does not run here; it runs after every
      // following positioning block until the word stands alone.
      s.mcall = { code: canonical, line, pitchFeed: pitch };
      return;
    }
    if (cycle === 'cancel') {
      // Rule 2: the cycle is off, and with it the ambiguity it was carrying.
      s.activeCycle = null;
      s.modalAmbiguous = null;
      return;
    }
    if (cycle === 'start') {
      // Rule 2: a non-modal start is a flag of this block and nothing more.
      s.block.cycle = canonical;
      if (pitch) s.block.pitchFeed = true;
      if (modal) {
        s.activeCycle = { code: canonical, line, pitchFeed: pitch };
        s.modalAmbiguous = ambiguous ? canonical : null;
      } else if (ambiguous) {
        s.blockAmbiguous = canonical;
      }
      return;
    }
    if (group === 'motion') {
      // Rule 3: a threading pass (or an ambiguous move) becomes the cycle; any other move cancels it.
      if (pitch || ambiguous) {
        s.block.cycle = canonical;
        if (pitch) s.block.pitchFeed = true;
        s.activeCycle = { code: canonical, line, pitchFeed: pitch };
        s.modalAmbiguous = ambiguous ? canonical : null;
      } else {
        s.activeCycle = null;
        s.modalAmbiguous = null;
      }
      return;
    }
    // A code that is neither a cycle nor a move (Fanuc `G92` on a mill): its meaning, and
    // with it the meaning of the block's feed word, belongs to this block alone.
    if (ambiguous) s.blockAmbiguous = canonical;
  }

  /** `_read_values` (rule 13): the block's bare calls, whether it writes a value, its angle words and sub-blocks. */
  private readValues(tokens: readonly NcToken[]): void {
    this.blockValues = false;
    if (this.hasZeroFrames) {
      this.blockWords.clear();
      for (const token of tokens) {
        if (token.kind === 'word' && token.address && (token.valueText ?? '') !== '') {
          this.blockWords.set(token.address.toUpperCase(), token.valueText ?? '');
        }
      }
    }
    if (this.hasEmptyCloses) {
      this.blockSubs.clear();
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind !== 'keyword' || token.valueText !== undefined) continue;
        const next = nextCodeToken(tokens, i + 1);
        if (next === undefined || next.address !== undefined || next.valueText === undefined) continue;
        const dot = next.valueText.indexOf('.');
        const joined = this.joinedCode(token.address || token.text, next.valueText);
        if (dot >= 0 && joined !== null) {
          const part = next.valueText.slice(dot + 1);
          if (DIGITS.test(part)) this.blockSubs.set(normalizeCode(joined), part);
        }
      }
    }
    if (!this.hasBareFrames) return;
    this.callsBare.clear();
    for (const token of tokens) {
      if (token.kind === 'call' && token.address) {
        this.callsBare.set(normalizeCode(token.address), (token.valueText ?? '').trim() === '');
      } else if (token.kind === 'word' && (token.valueText ?? '') !== '') {
        const address = token.address ?? '';
        if (address !== '' && !isAssignment(token) && this.entryOf(address + (token.valueText ?? '')) !== null) continue;
        this.blockValues = true;
      }
    }
  }

  /** Rule 13: the code is written without values — `CYCLE800()`, or `TRANS` alone. */
  private writtenBare(code: string): boolean {
    const known = this.callsBare.get(normalizeCode(code));
    if (known !== undefined) return known;
    return !this.blockValues;
  }

  /** Rule 13 (P10): the coordinate frames a code opens and closes. */
  private applyFrame(entry: CodeEntry, code: string, group: string | null, line: number): void {
    const zeroWords = this.hasZeroFrames ? zeroWordsOf(entry) : [];
    if (zeroWords.length > 0) {
      this.applyZeroFrame(entry, zeroWords, code, group, line);
      return;
    }
    let frame = entry.frame === 'open' || entry.frame === 'close' ? entry.frame : null;
    if (entry.frameWithoutValues === 'close' && this.writtenBare(code)) frame = 'close';
    const s = this.s;
    if (frame === 'open') {
      s.frames = s.frames.filter((f) => f.code !== code);
      s.frames.push({ code, line, group });
    } else if (frame === 'close') {
      s.frames = s.frames.filter((f) => f.group !== group);
    }
  }

  /** Rule 13, `frameZeroWords` (owner decision of 2026-10-08) and `frameEmptyCloses` (M12.5). */
  private applyZeroFrame(entry: CodeEntry, words: readonly string[], code: string, group: string | null, line: number): void {
    const s = this.s;
    const written = new Map<string, string>();
    for (const word of words) {
      const value = this.blockWords.get(word);
      if (value !== undefined) written.set(word, value);
    }
    if (written.size === 0) {
      const empty = emptyClosesOf(entry);
      if (empty !== null && this.blockSubs.get(normalizeCode(code)) === empty) s.frames = s.frames.filter((f) => f.group !== group);
      return;
    }
    const previous = s.frames.find((f) => f.code === code);
    const nonzero = new Set(previous?.nonzero ?? []);
    for (const [word, value] of written) {
      if (isZero(value)) nonzero.delete(word);
      else nonzero.add(word);
    }
    if (nonzero.size > 0) {
      s.frames = s.frames.filter((f) => f.code !== code);
      s.frames.push({ code, line, group, nonzero: [...nonzero] });
    } else {
      s.frames = s.frames.filter((f) => f.group !== group);
    }
  }

  /** Rule 14 (P10): tool centre point control, which is no frame. */
  private applyTcp(sets: CodeSets | undefined, code: string, group: string | null, line: number): void {
    const s = this.s;
    const tcp = sets?.tcp;
    if (tcp === 'on') s.tcp = { code, line, group };
    else if (tcp === 'off') s.tcp = null;
    else if (s.tcp !== null && group !== null && s.tcp.group === group) s.tcp = null;
  }

  /** Rule 15 (P10): the bare axis letter of a `planeFromAxisWord` block names the plane. */
  private applyToolAxis(tokens: readonly NcToken[]): void {
    for (const token of tokens) {
      if (token.kind !== 'word' || !token.address || (token.valueText ?? '') !== '') continue;
      const letter = token.address.toUpperCase();
      if (this.axes.has(letter) || letter in PLANE_OF_TOOL_AXIS) {
        this.s.plane = PLANE_OF_TOOL_AXIS[letter] ?? 'unknown';
        return;
      }
    }
  }

  /** Rule 11: a cycle defined once and run where it is called (§7.4 rules 1–4). */
  private applyDefined(cycle: 'define' | 'call' | 'call-modal', code: string, line: number, pitch: boolean): void {
    const s = this.s;
    if (cycle === 'define') {
      s.definedCycle = { code, line, pitchFeed: pitch };
      s.blockDefined = { ...s.definedCycle };
      s.modalCall = null;
      return;
    }
    if (cycle === 'call') s.modalCall = null;
    else s.modalCall = { code, line };
    if (s.definedCycle !== null) s.blockRun = { ...s.definedCycle };
  }

  /**
   * Rule 11: a positioning block under a modal call runs the defined cycle. Rule 11b: one
   * under a cycle a `'call-modal-next'` word made modal runs that cycle (not the block that
   * holds the word itself).
   */
  private applyModalCall(tokens: readonly NcToken[], codes: readonly string[]): void {
    const s = this.s;
    if (s.blockRun !== null) return;
    if (s.modalCall !== null && s.definedCycle !== null) {
      if (this.positions(tokens, codes)) s.blockRun = { ...s.definedCycle };
      return;
    }
    if (s.mcall === null || this.modalNext) return;
    if (this.positions(tokens, codes)) s.blockRun = { ...s.mcall };
  }

  /**
   * Whether the line moves to a position: an axis word with a value, or a code that moves
   * around the pole (`pole: 'use'`: Klartext `LP PR+30 PA+45`, `CP IPA+90`, whose end point
   * is written in polar words), and no code that makes the axis words data. The pole itself
   * (`CC`, `pole: 'set'`) moves nothing.
   */
  private positions(tokens: readonly NcToken[], codes: readonly string[]): boolean {
    if (this.axes.size === 0) return false;
    let found = false;
    for (const token of tokens) {
      if (token.kind === 'word' && this.axes.has((token.address ?? '').toUpperCase()) && (token.valueText ?? '') !== '' && !isAssignment(token)) {
        found = true;
        break;
      }
    }
    if (!found) found = codes.some((code) => this.entryOf(code)?.pole === 'use');
    if (!found) return false;
    for (const code of codes) if (axisWordsAreData(this.entryOf(code))) return false;
    return true;
  }

  /** What a code switches on (§7.2): the derived units of the state. */
  private applySets(sets: CodeSets | undefined, line: number, assumed: boolean): void {
    if (sets === undefined) return;
    const s = this.s;
    // Read as Python reads it (any non-empty string); the loader already kept only known units.
    const feedUnit: unknown = sets.feedUnit;
    if (typeof feedUnit === 'string' && feedUnit !== '') {
      s.feedUnitGroup = feedUnit;
      // A modal feed mode ends a feed set by word: the two answer the same question.
      s.feedUnitWord = null;
    }
    if (sets.speedUnit === 'rpm' || sets.speedUnit === 'surface') s.speedUnit = sets.speedUnit;
    if (sets.distance === 'absolute' || sets.distance === 'incremental') s.distance = sets.distance;
    if (sets.plane === 'XY' || sets.plane === 'ZX' || sets.plane === 'YZ') s.plane = sets.plane;
    if (sets.units === 'mm' || sets.units === 'inch') s.units = { value: sets.units, line, assumed };
    if (sets.diameter === 'on' || sets.diameter === 'off' || sets.diameter === 'absolute-only') {
      s.diameter = { mode: sets.diameter, line, assumed };
    }
    if (sets.speedLimit === true) {
      // Rule 4: of this block, whatever order the words are written in; rule 12: which bound.
      s.block.speedLimit = true;
      if (sets.speedLimitBound === 'lower') s.blockLower = true;
      else s.blockUpper = true;
    }
  }

  /** The address words of the block: the feed, the speed and the clamp. */
  private applyWords(tokens: readonly NcToken[], line: number): void {
    const s = this.s;
    for (const token of tokens) {
      if (token.kind !== 'word') continue;
      let address = (token.address ?? '').toUpperCase();
      if (address === '') continue;
      const main = namesMainSpindle(token, this.speedAddress, this.mainSpindle);
      // `S[2]=500`, `LIMS[2]=1800`: another spindle's (or axis's) word, not the speed in force.
      if (token.index !== undefined && !main) continue;
      // P10 (decision 3): `S1=` and `S[1]=` are the main spindle's speed, read like the plain `S`.
      if (main) address = this.speedAddress;
      if (this.feedUnitWords.has(address)) {
        // Rule 5: the word says which unit its own value is in.
        s.feedUnitWord = address;
        s.feed = seen(token, line);
      } else if (address === this.feedAddress) {
        // Rule 5: a plain feed word returns to the unit the modal group gives; rule 6: in a
        // dwell block it is a time, so the feed in force stays.
        s.feedUnitWord = null;
        if (!s.block.fNotFeed) s.feed = seen(token, line);
      } else if (this.speedLimitWords.has(address)) {
        s.speedLimit = seen(token, line);
      } else if (address === this.speedAddress) {
        // Rule 6: a dwell's speed word counts revolutions (Sinumerik `G4 S2`).
        if (s.block.fNotFeed) continue;
        if (s.block.speedLimit) {
          // Rule 12: a lower limit alone is neither the speed nor the clamp.
          if (s.blockUpper || !s.blockLower) s.speedLimit = seen(token, line);
        } else {
          s.speed = seen(token, line);
        }
      }
    }
  }

  /** Rule 7: the tool of a tool line, as the profile's patterns read it. */
  private applyTool(masked: string, line: number): void {
    const s = this.s;
    const re = this.cp.re;
    const isTool = re.toolTrigger.test(masked) && !(re.toolIgnore !== undefined && re.toolIgnore.test(masked));
    let found: Tool | null = null;
    if (isTool || this.toolFromLast) {
      const match = re.tool.exec(masked);
      // B1: no fallback to the whole match. A `tool` group that took no part in the match is
      // one the pattern made optional, and the whole match would turn "no tool" into a
      // garbage station (the program map and the tool list already read it this way).
      const station = match?.groups?.tool;
      if (match !== null && station !== undefined && station.trim() !== '') {
        found = { station: station.trim(), written: match[0].trim(), line };
      }
    }
    if (found !== null) s.lastTool = found;
    if (!isTool) return;
    s.block.toolChange = true;
    if (found !== null) s.tool = found;
    else if (this.toolFromLast && s.lastTool !== null) {
      // `toolFrom: same-line-or-last`: the station was written on an earlier line.
      s.tool = { station: s.lastTool.station, written: s.lastTool.written, line };
    }
  }

  // -- what is in force -------------------------------------------------------

  /** A frozen copy of what is in force after the last `update` (or after `reset`). */
  state(): ModalState {
    const s = this.s;
    const groups: Record<string, ModalValue> = {};
    for (const key of Object.keys(s.groups)) groups[key] = Object.freeze({ ...s.groups[key] });
    const freeze = <T extends object>(value: T | null): Readonly<T> | null => (value === null ? null : Object.freeze({ ...value }));
    let activeCycle: Cycle | null = s.activeCycle;
    if (activeCycle === null && s.modalCall !== null) activeCycle = s.definedCycle;
    if (activeCycle === null) activeCycle = s.mcall;
    const block = { ...s.block };
    if (block.cycle === null && s.blockRun !== null) block.cycle = s.blockRun.code;
    const last = s.frames.length > 0 ? s.frames[s.frames.length - 1] : null;
    const feedUnit = (s.feedUnitWord !== null ? (this.feedUnitWords.get(s.feedUnitWord) ?? UNKNOWN) : s.feedUnitGroup) as FeedUnit;
    return Object.freeze({
      groups: Object.freeze(groups),
      feedUnit,
      speedUnit: s.speedUnit,
      distance: s.distance,
      units: Object.freeze({ ...s.units }),
      plane: s.plane,
      diameter: freeze(s.diameter),
      tool: freeze(s.tool),
      feed: freeze(s.feed),
      speed: freeze(s.speed),
      speedLimit: freeze(s.speedLimit),
      activeCycle: freeze(activeCycle),
      definedCycle: freeze(s.definedCycle),
      modalCall: freeze(s.modalCall),
      frame: last === null ? null : Object.freeze({ code: last.code, line: last.line }),
      tcp: s.tcp === null ? null : Object.freeze({ code: s.tcp.code, line: s.tcp.line }),
      pitchFeedAmbiguous: s.blockAmbiguous ?? s.modalAmbiguous,
      block: Object.freeze(block),
    }) as ModalState;
  }

  /** An opaque copy of the interpreter's whole state, including what `state()` does not show. */
  snapshot(): unknown {
    const snap: Snapshot = { inner: cloneInner(this.s) };
    return snap;
  }

  /** Puts back a `snapshot()` of an interpreter built with the same profile and database. */
  restore(s: unknown): void {
    const snap = s as Snapshot | null;
    if (snap === null || typeof snap !== 'object' || !('inner' in snap)) throw new TypeError('ModalInterpreter.restore: not a snapshot');
    this.s = cloneInner(snap.inner);
  }
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/** What a snapshot of the index holds: the interpreter after a line and the tokenizer's state for the next. */
interface IndexSnapshot {
  interp: unknown;
  lineState: LineState | undefined;
}

/** A walk in progress: the interpreter after `line`, and the tokenizer's state for `line + 1`. */
interface Walk {
  interp: ModalInterpreter;
  line: number;
  lineState: LineState | undefined;
}

/** The clock `buildSome` reads after every line (read through `performance` on each call, so a test can stand in for it). */
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The modal state of a whole document, with a snapshot every `every` lines (§6.1, AD-33). */
export class ModalIndex {
  private readonly cp: CompiledProfile;
  private readonly every: number;
  /** `snapshots[k]` is the state after line `k * every`; `[0]` is the power-on state. */
  private readonly snapshots: IndexSnapshot[] = [];
  /** How many snapshots from the first on are valid (at least the power-on one). */
  private valid = 1;
  private lineCount = 0;
  private getLine: (n: number) => string = () => '';
  /** The idle build's walk, between the last valid snapshot and the next one. */
  private build: Walk | null = null;
  /** The last reader's walk, kept so that asking for the next lines of a block costs one line each. */
  private reader: Walk | null = null;

  constructor(cp: CompiledProfile, db: CodeDb, o?: { every?: number }) {
    this.cp = cp;
    const every = o?.every ?? SNAPSHOT_EVERY;
    if (!Number.isInteger(every) || every < 1) throw new RangeError(`ModalIndex: every has to be a positive integer, not ${every}`);
    this.every = every;
    this.builder = new ModalInterpreter(cp, db);
    this.readerInterp = new ModalInterpreter(cp, db);
    this.snapshots.push({ interp: this.builder.snapshot(), lineState: undefined });
  }

  /** The interpreter of the idle build's walk. */
  private readonly builder: ModalInterpreter;
  /** The interpreter of the readers' walk; never the build's, so a read never disturbs a build. */
  private readonly readerInterp: ModalInterpreter;

  /** Forgets everything and starts over on a document of `lineCount` lines. Builds nothing yet. */
  reset(lineCount: number, getLine: (n: number) => string): void {
    this.lineCount = Math.max(0, lineCount);
    this.getLine = getLine;
    this.valid = 1;
    this.snapshots.length = 1;
    this.build = null;
    this.reader = null;
  }

  /** After an edit: drops the snapshots at and after `firstChangedLine` (1-based). */
  applyChange(firstChangedLine: number, lineCount: number, getLine: (n: number) => string): void {
    const first = Math.max(1, Math.floor(firstChangedLine));
    this.lineCount = Math.max(0, lineCount);
    this.getLine = getLine;
    // The state after line L reads lines 1..L, so a snapshot after a line before `first` stands.
    const keep = Math.floor((first - 1) / this.every) + 1;
    if (keep < this.valid) {
      this.valid = keep;
      this.snapshots.length = keep;
    }
    if (this.build !== null && this.build.line >= first) this.build = null;
    if (this.reader !== null && this.reader.line >= first) this.reader = null;
  }

  /** The snapshot a line's state starts from: the one at or before it. */
  private baseOf(line: number): number {
    return Math.floor(line / this.every);
  }

  /** The last snapshot the document needs: after it, every line is within `every - 1` lines of one. */
  private lastNeeded(): number {
    return this.baseOf(this.lineCount);
  }

  /** Steps a walk over one line. */
  private step(walk: Walk): void {
    const n = walk.line + 1;
    const text = this.getLine(n) ?? '';
    const result = tokenizeLine(text, this.cp, walk.lineState);
    walk.interp.update(result.tokens, n, maskComments(text, this.cp));
    walk.lineState = result.state;
    walk.line = n;
  }

  /** A walk from snapshot `k`, in `interp`. */
  private walkFrom(k: number, interp: ModalInterpreter): Walk {
    const snap = this.snapshots[k];
    interp.restore(snap.interp);
    return { interp, line: k * this.every, lineState: snap.lineState };
  }

  /**
   * Builds snapshots forward from the last valid one for at most `budgetMs` and says whether
   * the whole document is covered. The service calls it from idle callbacks (≤ 16 ms each);
   * it checks the clock after every line, so it returns within the budget plus one line.
   */
  buildSome(budgetMs: number): boolean {
    if (this.ready()) {
      this.build = null;
      return true;
    }
    const deadline = now() + Math.max(0, budgetMs);
    if (this.build === null) this.build = this.walkFrom(this.valid - 1, this.builder);
    const walk = this.build;
    const target = this.lastNeeded();
    for (;;) {
      this.step(walk);
      if (walk.line % this.every === 0) {
        const k = walk.line / this.every;
        this.snapshots[k] = { interp: walk.interp.snapshot(), lineState: walk.lineState };
        this.valid = k + 1;
        if (k >= target) {
          this.build = null;
          return true;
        }
      }
      if (now() >= deadline) return false;
    }
  }

  /**
   * A walk that stands right after `line`'s base snapshot or later, but not after `line`; null
   * when none is valid. The line of a snapshot that is not valid (an edit on line k·every drops
   * snapshot k, which is the state after that very line) is read from snapshot k-1: exactly
   * `every` lines, so typing on that line never leaves it without a state.
   */
  private readerAt(line: number): Walk | null {
    let k = this.baseOf(line);
    if (k >= this.valid) {
      if (k !== this.valid || line !== k * this.every) return null;
      k -= 1;
    }
    const reader = this.reader;
    if (reader !== null && reader.line <= line && reader.line >= k * this.every) return reader;
    const walk = this.walkFrom(k, this.readerInterp);
    this.reader = walk;
    return walk;
  }

  /**
   * The state after `line` (1-based; 0 is the power-on state). Replays at most `every - 1`
   * lines from the nearest snapshot at or before it (`every` on the line of a snapshot an edit
   * has just dropped, see `readerAt`); `null` when no snapshot within that
   * distance exists yet (the idle build has not got there), so a caller never blocks for
   * more than one replay. A line past the end of the document is `null` as well.
   */
  stateAfter(line: number): ModalState | null {
    if (!Number.isInteger(line) || line < 0 || line > this.lineCount) return null;
    const walk = this.readerAt(line);
    if (walk === null) return null;
    while (walk.line < line) this.step(walk);
    return walk.interp.state();
  }

  /**
   * The states after each of the lines `first`…`last` (≤ 1,000 lines), or `null` as above.
   * `last` past the end of the document is read as the last line.
   */
  statesAfter(first: number, last: number): ModalState[] | null {
    if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
    if (last - first + 1 > STATES_MAX) throw new RangeError(`ModalIndex.statesAfter: at most ${STATES_MAX} lines, not ${last - first + 1}`);
    if (first < 0 || first > this.lineCount) return null;
    const end = Math.min(last, this.lineCount);
    if (end < first) return [];
    const walk = this.readerAt(first);
    if (walk === null) return null;
    while (walk.line < first) this.step(walk);
    const out: ModalState[] = [walk.interp.state()];
    while (walk.line < end) {
      this.step(walk);
      out.push(walk.interp.state());
    }
    return out;
  }

  /** True once every snapshot up to the end of the document exists. */
  ready(): boolean {
    return this.valid - 1 >= this.lastNeeded();
  }
}
