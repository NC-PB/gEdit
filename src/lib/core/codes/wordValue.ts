// What one word of a block is worth on this document's machine (Phase 3 plan §6.3, AD-35).
// Owner: P3.2a (the Phase 3 prelude wrote the contract). The inspector's rows (`inspect.ts`),
// the hover's context line (P3.3) and the edit of a value (`core/nc/rewriteWord.ts`) all read
// a word through this one module, so they can never disagree about it.
//
// The rules, binding:
//
//   1. A word is read in the state **after** its block, in which the block's own codes are
//      in force (`G91 X10.` is incremental, `G99 F.2` a feed per revolution), the way the
//      Python scripts read it (`update`, then the state).
//   2. Its class is `numberClassOf` (AD-31) with the block's entries, the codes in force
//      (`after.activeCycle`, the cycle the block calls, the motion code: `inForce`) and the
//      pitch of the block or of the active cycle; its value is `resolveValue` with the
//      document's effective machine and the profile's `machineParams` declaration, so with no
//      machine and a reading that depends on one there is no value but the list of readings,
//      the assumed default first. A feed word while a cycle in force is `pitchFeedAmbiguous`
//      has no class: nothing says whether it is a feed or a lead.
//   3. Diameter or radius (AD-19 rule 11) for a word of `addresses.diameter`:
//      `diameterReading`, never the diameter mode alone.
//   4. Incremental: an address of `addresses.incremental` (`U`, `W`), a Klartext `I` prefix,
//      or a distance mode `incremental` for an axis word.
//   3–4 do not apply to a word the block's code declares as a parameter of its own while
//      it makes the axis words data (`axisWords: 'data'`): `G71 U2.` is a depth of cut and
//      `G04 U1.5` a dwell time, neither a move nor a diameter. Such a word has no diameter
//      reading and is not incremental; what it is says its parameter's label.
//   5. A thread lead: the feed word of a block whose feed is a lead — a code of the block or
//      in force has `pitchFeed` **and** declares the feed word with `unit: 'feedPerRev'`, as
//      the database says. A tap's feed is no lead (its code declares no such unit).
//
// Examples (Fanuc lathe, G-code system A, no machine): `X50.` → 50 mm, diameter;
// `X50` → no value, three readings (calculator first: 50 mm; IS-B 0.05 mm; IS-C 0.005 mm);
// `U-2.` → -2 mm, incremental, diameter; `G76 X27.6 Z-30. P1200 Q300 F1.5` → `F` 1.5 mm/rev,
// a lead. The units of a word are those after its block (`G20 X1.` is an inch value); while
// the state says nothing, the machine's.
//
// No dialect name anywhere: everything comes from the profile, the database and the state.

import { numberClassOf, resolveValue } from '$lib/core/machines/numbers';
import type { EffectiveMachine, ParamSource, Reading, ResolvedClass } from '$lib/core/machines/types';
import type { ModalState, ModalValue, NcToken } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';
import { axisWordsOf, isAssignmentWord, lookupCode } from './lookup';
import type { CodeDb, CodeEntry, CodeParam } from './types';

/** What `readWord` answers for a word with an address. */
export interface WordReading {
  cls: ResolvedClass;
  /** The effective value as decimal text, or null (no class, a variable, or it needs a machine). */
  value: string | null;
  /**
   * The unit `value` is in: `mm`, `inch`, `deg`, `s`, a feed unit (`mm/rev`, `mm/min`,
   * `mm/tooth`, `1/min`); null without a class. With `readings` it is the unit of every
   * reading (P3.2a: a widening of "null without a value", so the readings can be shown).
   */
  unit: string | null;
  /** Where the reading comes from: the machine, a detected variant, or the profile's default. */
  source: ParamSource | null;
  /** With no machine and a reading that depends on one: every reading, the assumed default first. */
  readings: Reading[];
  /** Rule 3; null for a word that is no diameter word. */
  diameter: 'diameter' | 'radius' | 'unknown' | null;
  /** Rule 4. */
  incremental: boolean;
  /** Rule 5. */
  lead: boolean;
}

/** The document's effective view (AD-31). */
export interface WordView {
  profile: Profile;
  db: CodeDb;
  machine: EffectiveMachine;
}

// ---------------------------------------------------------------------------
// The block's codes, as the class rules see them
// ---------------------------------------------------------------------------

function upper(text: string | undefined): string {
  return typeof text === 'string' ? text.toUpperCase() : '';
}

function contentAfter(tokens: readonly NcToken[], from: number): NcToken | null {
  for (let i = from + 1; i < tokens.length; i++) {
    const kind = tokens[i].kind;
    if (kind === 'whitespace') continue;
    return tokens[i];
  }
  return null;
}

/** The digits of a bare value word: the `200` of `CYCL DEF 200`, the `19.1` of a sub-block. */
function bareNumber(token: NcToken | null): string | null {
  if (!token || token.kind !== 'word' || token.address !== undefined) return null;
  return /^\d+(?:\.\d+)?$/.test(token.text) ? token.text : null;
}

/**
 * The entry a keyword names, joined with the number behind it where the database has the
 * pair (`CYCL DEF` + `200`), a sub-block by its cycle (`CYCL DEF 19.1` → `CYCL DEF 19`), and
 * the keyword alone otherwise (`TOOL CALL`, `LBL`). `joined` says whether the number belongs
 * to the code.
 */
export function keywordEntry(
  tokens: readonly NcToken[],
  index: number,
  db: CodeDb,
): { entry: CodeEntry | null; joined: NcToken | null } {
  const keyword = tokens[index];
  const name = keyword.address ?? keyword.text;
  const next = contentAfter(tokens, index);
  const digits = bareNumber(next);
  if (digits !== null && next) {
    const whole = /^(\d+)\.\d+$/.exec(digits)?.[1];
    for (const code of [`${name} ${digits}`, ...(whole !== undefined ? [`${name} ${whole}`] : [])]) {
      const entry = lookupCode(db, code);
      if (entry) return { entry, joined: next };
    }
  }
  return { entry: lookupCode(db, name), joined: null };
}

const ENTRIES = new WeakMap<readonly NcToken[], WeakMap<CodeDb, CodeEntry[]>>();

/**
 * The database entries of the codes the block writes, in written order (the twin of the
 * Python scripts' `block_entries`): a code word (`G76`), a keyword with its number
 * (`CYCL DEF 200`), a call by its name (`CYCLE83`). A word written with `=` is a value and
 * never a code (`M3=3` is not `M33`). Cached per token array.
 */
export function blockEntries(tokens: readonly NcToken[], db: CodeDb): CodeEntry[] {
  let perDb = ENTRIES.get(tokens);
  const cached = perDb?.get(db);
  if (cached) return cached;
  const out: CodeEntry[] = [];
  tokens.forEach((token, i) => {
    let entry: CodeEntry | null = null;
    if (token.kind === 'word' && token.address !== undefined && token.valueText !== undefined) {
      if (!isAssignmentWord(token)) entry = lookupCode(db, token.address + token.valueText);
    } else if (token.kind === 'call') {
      entry = lookupCode(db, token.address ?? '');
    } else if (token.kind === 'keyword') {
      entry = keywordEntry(tokens, i, db).entry;
    }
    if (entry && !out.includes(entry)) out.push(entry);
  });
  if (!perDb) {
    perDb = new WeakMap();
    ENTRIES.set(tokens, perDb);
  }
  perDb.set(db, out);
  return out;
}

/**
 * The entries of the codes in force that the block does not write (rule 2): the modal cycle,
 * the cycle the block calls (a defined cycle), the motion code.
 */
export function inForceEntries(after: ModalState, blockCodes: readonly CodeEntry[], db: CodeDb): CodeEntry[] {
  const out: CodeEntry[] = [];
  for (const code of [after.activeCycle?.code, after.block.cycle, after.groups.motion?.code]) {
    if (typeof code !== 'string' || code === '') continue;
    const entry = lookupCode(db, code);
    if (entry && !blockCodes.includes(entry) && !out.includes(entry)) out.push(entry);
  }
  return out;
}

/** The parameter of `entry` written with `address`, if it declares one. */
export function paramOf(entry: CodeEntry | null | undefined, address: string): CodeParam | null {
  const want = upper(address);
  for (const param of Array.isArray(entry?.params) ? entry.params : []) {
    if (upper(param?.address) === want) return param;
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the profile says about an address
// ---------------------------------------------------------------------------

function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(upper) : [];
}

/** The feed words: the profile's feed address and every `feedUnitWords` key. */
export function isFeedWord(profile: Profile, address: string): boolean {
  const a = profile.addresses;
  const word = upper(address);
  if (word !== '' && upper(a?.feed) === word) return true;
  return Object.keys(a?.feedUnitWords ?? {}).some((key) => upper(key) === word);
}

/** An axis word: `addresses.axes` or an incremental twin (`addresses.incremental`). */
export function isAxisWord(profile: Profile, address: string): boolean {
  const word = upper(address);
  if (listOf(profile.addresses?.axes).includes(word)) return true;
  return Object.keys(profile.addresses?.incremental ?? {}).some((key) => upper(key) === word);
}

/** The axis an incremental twin moves (`U` → `X`), or null. */
export function incrementalAxisOf(profile: Profile, address: string): string | null {
  const word = upper(address);
  for (const [twin, axis] of Object.entries(profile.addresses?.incremental ?? {})) {
    if (upper(twin) === word && typeof axis === 'string') return axis;
  }
  return null;
}

/** The unit of a class in a program in `units`. */
export function unitOfClass(cls: ResolvedClass, units: 'mm' | 'inch'): string | null {
  switch (cls) {
    case 'length':
    case 'increment':
      return units;
    case 'angle':
      return 'deg';
    case 'dwell':
      return 's';
    case 'feedPerMin':
      return `${units}/min`;
    case 'feedPerRev':
      return `${units}/rev`;
    case 'feedPerTooth':
      return `${units}/tooth`;
    case 'inverseTime':
      return '1/min';
    default:
      return null;
  }
}

/** The units a word is read in: those after its block, else the machine's (rule 1). */
export function unitsAfter(after: ModalState | null, machine: EffectiveMachine): 'mm' | 'inch' {
  const value = after?.units?.value;
  if (value === 'mm' || value === 'inch') return value;
  return machine?.params?.units === 'inch' ? 'inch' : 'mm';
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * The reading of `token`, one of `blockTokens` (every token of the block, over all of its
 * lines), in the state `after` the block (rule 1). Null for a token without an address or a
 * value (a comment, a keyword alone, the bare tool axis of `TOOL CALL 1 Z`). A word whose
 * value is a variable or an expression gets a reading without a value.
 */
export function readWord(
  token: NcToken,
  blockTokens: readonly NcToken[],
  after: ModalState,
  view: WordView,
): WordReading | null {
  if (token.address === undefined || token.address === '' || token.valueText === undefined) return null;
  const { profile, db, machine } = view;
  const address = upper(token.address);

  const blockCodes = blockEntries(blockTokens, db);
  const inForce = inForceEntries(after, blockCodes, db);
  const pitchFeed = after.block.pitchFeed === true || after.activeCycle?.pitchFeed === true;
  const feedWord = isFeedWord(profile, address);

  let cls = numberClassOf(address, { profile, feedUnit: after.feedUnit, blockCodes, pitchFeed, inForce });
  // Rule 2: a cycle in force whose number is a threading cycle elsewhere tells nothing about F.
  if (feedWord && after.pitchFeedAmbiguous !== null && after.pitchFeedAmbiguous !== undefined) cls = null;

  const units = unitsAfter(after, machine);
  const literal = token.value ?? null;
  const resolved =
    literal === null ? { value: null, readings: [] as Reading[] } : resolveValue(literal, cls, machine, profile.machineParams, units);
  const hasReading = resolved.value !== null || resolved.readings.length > 0;

  // Rules 3–4 do not apply to a value of a code that makes the axis words data.
  const dataParam = blockCodes.some((entry) => axisWordsOf(entry) === 'data' && paramOf(entry, address) !== null);

  const diameterWords = listOf(profile.addresses?.diameter);
  const diameter = !dataParam && diameterWords.includes(address) ? diameterReading(after, profile, address) : null;

  const incremental =
    !dataParam &&
    (incrementalAxisOf(profile, address) !== null ||
      token.incremental === true ||
      (after.distance === 'incremental' && isAxisWord(profile, address)));

  const lead =
    feedWord &&
    cls === 'feedPerRev' &&
    [...blockCodes, ...inForce].some((entry) => entry.pitchFeed === true && paramOf(entry, address)?.unit === 'feedPerRev');

  return {
    cls,
    value: resolved.value,
    unit: hasReading ? unitOfClass(cls, units) : null,
    source: hasReading && cls !== null && cls !== 'count' ? (machine?.source?.numberInput ?? 'profile') : null,
    readings: resolved.readings,
    diameter,
    incremental,
    lead,
  };
}

/** The class a feed-unit setting gives a plain feed word. */
const CLASS_OF_FEED_UNIT: Readonly<Record<string, ResolvedClass>> = {
  'per-minute': 'feedPerMin',
  'per-rev': 'feedPerRev',
  'per-tooth': 'feedPerTooth',
  'inverse-time': 'inverseTime',
};

/**
 * The code that gave a feed word of class `cls` its unit, for "feed per minute (G94)": the
 * code in force whose `sets.feedUnit` gives that class; else a code of the block or in
 * force that declares the word as a parameter with that unit (Okuma `G101 … F`, a feed per
 * minute whatever `G95` says); else null. A feed-unit code whose unit contradicts the class
 * is never named. `blockLine` is the line a code written in the block is reported on.
 */
export function feedUnitSource(
  after: ModalState,
  db: CodeDb,
  cls: ResolvedClass,
  address: string,
  blockCodes: readonly CodeEntry[],
  blockLine: number,
): ModalValue | null {
  if (cls === null) return null;
  for (const value of Object.values(after.groups)) {
    if (!value || typeof value.code !== 'string') continue;
    const unit = lookupCode(db, value.code)?.sets?.feedUnit;
    if (unit === undefined) continue;
    if (CLASS_OF_FEED_UNIT[unit] === cls) return value;
    break; // the feed-unit group says something else: never name it for this class
  }
  const owner = [...blockCodes, ...inForceEntries(after, blockCodes, db)].find((entry) => paramOf(entry, address)?.unit === cls);
  if (!owner) return null;
  for (const value of Object.values(after.groups)) {
    if (value && typeof value.code === 'string' && lookupCode(db, value.code) === owner) return value;
  }
  const active = after.activeCycle;
  if (active && lookupCode(db, active.code) === owner) return { code: owner.code, line: active.line, assumed: false };
  return { code: owner.code, line: blockLine, assumed: false };
}

/**
 * AD-19 rule 11, the twin of Python's `ModalInterpreter.diameter_reading`: whether a word of
 * `address` is a diameter or a radius value in the state `s`. A word the profile does not list
 * under `addresses.diameter` is a radius; `absolute-only` (`DIAM90`) is a diameter while the
 * distance is absolute and a radius while it is incremental; `unknown` while that is unknown.
 */
export function diameterReading(s: ModalState, profile: Profile, address?: string): 'diameter' | 'radius' | 'unknown' {
  if (address !== undefined && !listOf(profile.addresses?.diameter).includes(upper(address))) return 'radius';
  // A profile without the parameter: every coordinate is what it says it is.
  if (s.diameter === null || s.diameter === undefined) return 'radius';
  const mode = s.diameter.mode;
  if (mode === 'on') return 'diameter';
  if (mode === 'off') return 'radius';
  if (s.distance === 'absolute') return 'diameter';
  if (s.distance === 'incremental') return 'radius';
  return 'unknown';
}
