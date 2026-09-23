// How the control reads a written number (plan §7.15, AD-31). Owner: WP6.9.
//
// `X50` is 50 mm on one control and 0.050 mm on the next, and which it is is a parameter
// of the machine, not a property of the dialect. Everything in this file exists so that
// nothing in gEdit ever guesses which of the two it is looking at:
//
//   `numberClassOf`  what kind of number this word carries (a length, an angle, a feed per
//                    minute, a feed per revolution, a dwell — or nothing at all)
//   `valueOf`        that word's value in mm, inch, degrees or seconds, on one machine
//   `writeBack`      a value written back into the word's own form
//   `readingsOf`     what every preset the profile declares would make of the word
//   `resolveValue`   what a consumer gets: a value, or the readings to show instead
//
// Two rules run through all five, and both are about not being wrong:
//
//  1. **No machine, no guess** (AD-31). Without a machine a literal has a value only when
//     every preset the profile declares reads it the same way. `X50.` survives that test
//     on the Fanuc presets and is 50 mm; point-less `X50` does not, and it gets no value
//     at all. A word without a value is reported by every consumer, never converted.
//  2. **Nothing here names a dialect.** Which addresses are angular, which word is the
//     feed, which cycle parameter is a count of micrometres — all of it is profile and
//     code-database data (§8.2, §8.8), reviewed by G10. The one address this file spells
//     out is `R` (see `EXTRA_LENGTH_ADDRESSES`), because the contract's class order names
//     it and no profile field carries it yet.
//
// Decimal text only, never a JS `number`: `0.1` is not representable in binary floating
// point, and the Python twin (`_nc_machine.py`) has to reach the same digits with
// `Decimal`. The arithmetic below is exact integer arithmetic on `bigint` digits, and
// rounding is half away from zero, as everywhere else in gEdit.
//
// The golden set `tests/fixtures/machines/numbers.json` is the contract between the two
// implementations: a disagreement is a failure, not a rounding detail.

import type { Msg } from '$lib/app/types';
import type { CodeEntry, CodeParam } from '$lib/core/codes/types';
import { formatNumber } from '$lib/core/nc/numberFormat';
import { parseNumber } from '$lib/core/nc/numbers';
import type { NumericLiteral } from '$lib/core/nc/types';
import type {
  FeedUnit,
  MachineParamsDecl,
  NumberFormatOptions,
  NumberInputPreset,
  Profile,
} from '$lib/core/profiles/types';
import type {
  EffectiveMachine,
  MachineParams,
  NumberClass,
  NumberInput,
  NumberReading,
  Reading,
  ResolvedClass,
  ResolvedValue,
} from './types';

/**
 * Addresses that are lengths although no profile field lists them.
 *
 * `R` is an arc radius, a cycle return plane and a lathe taper, and it is a length in all
 * three. The contract's class order (AD-31, step 6) names it outright; a cycle that reads
 * its `R` differently says so with `CodeParam.unit`, which is step 1 and wins.
 */
const EXTRA_LENGTH_ADDRESSES = ['R'] as const;

/** Decimals the division in `writeBack` is carried to before the format rounds it. */
const DIVISION_SCALE = 24;

/**
 * Why `writeBack` refused. Exported so a caller can tell the cases apart without matching
 * text, and so the Python twin (`_nc_machine.WRITE_BACK_ERRORS`) can be checked against
 * the same three codes on the same golden cases.
 *
 * The keys belong to the `machines` i18n namespace, which WP6.10 owns; until it ships
 * them, a caller that shows one of these gets the key back from `t()`.
 */
export const WRITE_BACK_ERRORS = {
  /** The value does not fit the word's form and would have to be rounded. */
  rounded: { key: 'machines.numbers.rounded' } as Msg,
  /** This word has no reading on this machine, so there is nothing to write back into. */
  noReading: { key: 'machines.numbers.noReading' } as Msg,
  /** The value handed in is not a decimal number. */
  notANumber: { key: 'machines.numbers.notANumber' } as Msg,
} as const;

// ---------------------------------------------------------------------------
// Exact decimal arithmetic
//
// A decimal is kept as a sign, a string of digits and a scale: `-0.050` is
// `{ negative: true, digits: 50n, scale: 3 }`. Multiplying adds the scales, dividing is
// integer division with a remainder, and nothing is ever a float.
// ---------------------------------------------------------------------------

interface Dec {
  negative: boolean;
  digits: bigint;
  scale: number;
}

const TEN = BigInt(10);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function pow10(n: number): bigint {
  let out = ONE;
  for (let i = 0; i < n; i++) out *= TEN;
  return out;
}

/** A written number as an exact decimal, or null when it is not one. */
function toDec(text: string): Dec | null {
  const parsed = parseNumber(typeof text === 'string' ? text.trim() : '');
  if (!parsed) return null;
  const fraction = parsed.fracPart ?? '';
  const digits = `${parsed.intPart}${fraction}`;
  if (digits.length === 0) return null;
  return { negative: parsed.sign === '-', digits: BigInt(digits), scale: fraction.length };
}

function isZeroDec(value: Dec): boolean {
  return value.digits === ZERO;
}

/**
 * The canonical text of a decimal: no trailing zeros in the fraction, no trailing point,
 * and zero is always `'0'` and never `'-0'`.
 *
 * Canonical because `resolveValue` decides whether two presets agree by comparing these
 * strings, and because the golden set has to pin one spelling per value for both
 * languages.
 */
function decText(value: Dec): string {
  let digits = value.digits.toString();
  let scale = value.scale;
  while (scale > 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale--;
  }
  if (digits === '' || /^0+$/.test(digits)) return '0';
  const padded = digits.padStart(scale + 1, '0');
  const cut = padded.length - scale;
  const text = scale === 0 ? padded : `${padded.slice(0, cut)}.${padded.slice(cut)}`;
  return value.negative ? `-${text}` : text;
}

function mulDec(a: Dec, b: Dec): Dec {
  return { negative: a.negative !== b.negative, digits: a.digits * b.digits, scale: a.scale + b.scale };
}

/** `value / 10`, exactly: the digits stay, the point moves. */
function tenthOf(text: string): string | null {
  const value = toDec(text);
  return value === null ? null : decText({ ...value, scale: value.scale + 1 });
}

/** `a / b`, rounded half away from zero at `scale` decimals. `b` must not be zero. */
function divDec(a: Dec, b: Dec, scale: number): Dec {
  const shift = scale + b.scale - a.scale;
  const numerator = shift >= 0 ? a.digits * pow10(shift) : a.digits;
  const denominator = shift >= 0 ? b.digits : b.digits * pow10(-shift);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  // Half away from zero. The sign is carried separately, so both sides are positive here
  // and "half or more" is `2 × remainder >= denominator`.
  const digits = remainder * TWO >= denominator ? quotient + ONE : quotient;
  return { negative: a.negative !== b.negative, digits, scale };
}

// ---------------------------------------------------------------------------
// The class of a word (AD-31, the fixed order)
// ---------------------------------------------------------------------------

function upper(text: string): string {
  return typeof text === 'string' ? text.toUpperCase() : '';
}

function addressesOf(profile: Profile | undefined): Profile['addresses'] | undefined {
  const addresses = profile?.addresses;
  return addresses && typeof addresses === 'object' ? addresses : undefined;
}

/** `addresses.feedUnitWords` with upper-case keys (Klartext `FU`, Okuma `E`). */
function feedUnitWordsOf(profile: Profile | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [word, unit] of Object.entries(addressesOf(profile)?.feedUnitWords ?? {})) {
    if (typeof word === 'string' && typeof unit === 'string') out.set(upper(word), unit);
  }
  return out;
}

/** The words that carry a feed: the profile's feed address and every `feedUnitWords` key. */
function feedWordsOf(profile: Profile | undefined, unitWords: Map<string, string>): Set<string> {
  const words = new Set<string>(unitWords.keys());
  const feed = addressesOf(profile)?.feed;
  if (typeof feed === 'string' && feed !== '') words.add(upper(feed));
  return words;
}

/** The feed class of a feed unit, or null while the unit says nothing about a length. */
function feedClassOf(unit: FeedUnit | string | undefined): NumberClass | null {
  if (unit === 'per-minute') return 'feedPerMin';
  if (unit === 'per-rev') return 'feedPerRev';
  // 'per-tooth' has no class of its own, 'inverse-time' is not a length per time at all,
  // and 'unknown' is the honest answer of a tracker that has not seen a feed mode yet.
  // All three get no value rather than the wrong one.
  return null;
}

function paramsOf(entry: CodeEntry | undefined): readonly CodeParam[] {
  const params = entry?.params;
  return Array.isArray(params) ? params : [];
}

/**
 * The number class of one word of one block, or null when it has none.
 *
 * The order is fixed by AD-31 and the first match wins:
 *
 *  1. `CodeParam.unit` of a code in this block — a cycle parameter is often the one place
 *     a control breaks its own convention (§8.2 is where these are written down);
 *  2. the feed word of an `fNotFeed` block → `dwell` (the `F` of Okuma's and Sinumerik's
 *     `G4` is a time, M8);
 *  3. the feed word under a pitch feed → `feedPerRev`: a thread lead is per revolution
 *     whatever the modal feed mode says;
 *  4. `addresses.angular` → `angle`;
 *  5. the feed word → the class of the modal feed unit (or of the word's own unit, for a
 *     `feedUnitWords` word such as Klartext `FU`);
 *  6. axes, their incremental twins, arc centres and `R` → `length`;
 *  7. everything else has no class: `S`, `T`, `D`, `H`, `N`, `O`, `G`, `M` and every
 *     `unit: 'count'` word are never converted.
 *
 * `null` also means "undecidable": a feed while the feed unit is unknown, and the feed of
 * a block whose code is `pitchFeedAmbiguous` (the same number is a threading cycle in
 * another G-code system, so nothing in the block says whether the `F` is a feed or a
 * lead). Both get no value instead of a wrong one.
 */
export function numberClassOf(
  address: string,
  o: {
    profile: Profile;
    feedUnit: FeedUnit;
    blockCodes: readonly CodeEntry[];
    /** This block, or the cycle that is active, carries a pitch feed. */
    pitchFeed: boolean;
  },
): ResolvedClass {
  const word = upper(address);
  if (word === '') return null;
  const codes = Array.isArray(o.blockCodes) ? o.blockCodes : [];

  // 1. what the code database says about this parameter of this code
  for (const entry of codes) {
    for (const param of paramsOf(entry)) {
      if (upper(param?.address ?? '') === word && param?.unit !== undefined) return param.unit;
    }
  }

  const unitWords = feedUnitWordsOf(o.profile);
  const feedWords = feedWordsOf(o.profile, unitWords);
  if (feedWords.has(word)) {
    // 2. a block where the feed word is a time
    if (codes.some((entry) => (entry as { fNotFeed?: boolean })?.fNotFeed === true)) return 'dwell';
    // 3. a thread lead, whatever the modal feed mode says
    if (o.pitchFeed === true || codes.some((entry) => entry?.pitchFeed === true)) return 'feedPerRev';
    // …and a code that may be a threading cycle in another G-code system tells us nothing.
    if (codes.some((entry) => entry?.pitchFeedAmbiguous === true)) return null;
  }

  const addresses = addressesOf(o.profile);

  // 4. rotary axes
  const angular = Array.isArray(addresses?.angular) ? addresses.angular : [];
  if (angular.some((entry) => upper(entry) === word)) return 'angle';

  // 5. the feed word, by the unit in force
  if (feedWords.has(word)) {
    return feedClassOf(unitWords.get(word) ?? o.feedUnit);
  }

  // 6. positions
  const axes = Array.isArray(addresses?.axes) ? addresses.axes : [];
  if (axes.some((entry) => upper(entry) === word)) return 'length';
  for (const twin of Object.keys(addresses?.incremental ?? {})) if (upper(twin) === word) return 'length';
  const arcCenter = Array.isArray(addresses?.arcCenter) ? addresses.arcCenter : [];
  if (arcCenter.some((entry) => upper(entry) === word)) return 'length';
  if (EXTRA_LENGTH_ADDRESSES.some((entry) => entry === word)) return 'length';

  // 7. no class
  return null;
}

// ---------------------------------------------------------------------------
// Reading a literal
// ---------------------------------------------------------------------------

/** How one class is read on one machine: the reading, and the unit of a written "1". */
interface ClassReading {
  mode: NumberReading;
  /** Decimal text; the increment (`increment`) or the value of "1" (`scale`). */
  unit: string;
}

/** The classes whose unit follows the program's mm/inch state. Angles and dwell do not. */
function followsUnits(cls: NumberClass): boolean {
  return cls === 'length' || cls === 'feedPerMin' || cls === 'feedPerRev';
}

function unitOf(cls: NumberClass, input: NumberInput, units: 'mm' | 'inch'): string | null {
  const entry = input.classes?.[cls];
  if (followsUnits(cls)) {
    if (typeof entry?.increment === 'string') {
      if (units === 'inch') return entry.incrementInch ?? tenthOf(entry.increment);
      return entry.increment;
    }
    if (units === 'inch') return input.incrementInch ?? tenthOf(input.incrementMm);
    return input.incrementMm;
  }
  if (cls === 'angle') return entry?.increment ?? input.incrementDeg ?? input.incrementMm;
  // Dwell: `incrementSec`, else the digits of `incrementMm` (§7.15). The angular
  // increment is not a step on that chain — a control that declares one and no dwell
  // increment would have read `G4 X2500` as a time in degrees (G8 M6).
  return entry?.increment ?? input.incrementSec ?? input.incrementMm;
}

/**
 * How this class is read on this machine, or null when it has no reading at all.
 *
 * `'increment'` is not a class but a `CodeParam.unit`: a parameter that is **always** a
 * count of least input increments, whatever its address suggests (the micrometre depths
 * and pecks of §8.2). It is the length class read as a **count**, and it keeps that
 * reading whatever the control does with an ordinary length word: syntax-fanuc.md §3.2
 * describes one machine on which `X50` is 50 mm *and* `Q6000` is 6 mm, so "as written"
 * is a statement about positions and not about the micrometre parameters of a cycle.
 *
 * That is the G10 decision of M6 (the WP6.9 hand-off set out the two ways). Before it,
 * the increment class borrowed the length class's **mode** as well, so under a
 * `calculator` preset — the lathe's default — every `G83 Q`, `G74`/`G75 P`/`Q` and
 * `G76 Q` of a turning program had no value at all, which is most of the lathe data M6
 * added. The unit still has to be **declared**, never guessed: a preset that names no
 * increment gives such a word no value and it is reported.
 */
function readingFor(cls: NumberClass | 'increment', input: NumberInput | null, units: 'mm' | 'inch'): ClassReading | null {
  // No declaration: the profile's own JSON decides, and it says what it says — as written.
  if (input === null || typeof input !== 'object') return { mode: 'calculator', unit: '1' };

  const key: NumberClass = cls === 'increment' ? 'length' : cls;
  const mode = input.classes?.[key]?.mode ?? input.mode;
  const unit = unitOf(key, input, units);
  if (typeof unit !== 'string') return null;

  if (cls === 'increment') return { mode: mode === 'scale' ? 'scale' : 'increment', unit };
  if (mode !== 'increment' && mode !== 'calculator' && mode !== 'scale') return null;
  return { mode, unit };
}

/** The unit as an exact decimal, or null when the declaration cannot be used. */
function unitDec(reading: ClassReading): Dec | null {
  const unit = toDec(reading.unit);
  return unit === null || isZeroDec(unit) ? null : unit;
}

/**
 * The value of one literal in mm, inch, degrees or seconds, as decimal text, or null when
 * this word has no value on this machine.
 *
 * - `increment` — with a decimal point as written, without one a count of increments;
 * - `calculator` — as written, with or without a point;
 * - `scale` — the literal times the class's unit, with or without a point.
 *
 * The `angle` and `dwell` classes ignore `units`: an IS-B control reads `C90000` as 90° in
 * a metric and in an inch program alike.
 */
export function valueOf(
  lit: NumericLiteral,
  cls: NumberClass | 'increment',
  m: MachineParams,
  units: 'mm' | 'inch',
): string | null {
  if (!lit || typeof lit.raw !== 'string') return null;
  // A count and a word with no class are never converted. The type says so, but a caller
  // driven by JSON (a script, a golden) can still ask, and it gets the same answer.
  if (cls === null || (cls as string) === 'count') return null;
  const reading = readingFor(cls, m?.numberInput ?? null, units);
  if (reading === null) return null;

  const literal = toDec(lit.raw);
  if (literal === null) return null;
  if (reading.mode === 'calculator') return decText(literal);
  if (reading.mode === 'increment' && lit.hasPoint) return decText(literal);

  const unit = unitDec(reading);
  if (unit === null) return null;
  return decText(mulDec(literal, unit));
}

/**
 * A value written back into the word's own form.
 *
 * A point stays a point, and a point-less word stays point-less — which is only possible
 * while the value is a whole number of increments (or of units, in a `scale` system).
 * Otherwise the literal is rounded half away from zero and `rounded` says so; with
 * `refuseRounding` the write is refused instead, which is what the inspector does rather
 * than change a value behind the programmer's back.
 *
 * `rounded` is decided by reading the result back: the text is rounded exactly when the
 * machine would not read the value asked for out of it again. No tolerance, no epsilon.
 */
export function writeBack(
  value: string,
  original: NumericLiteral,
  cls: NumberClass | 'increment',
  m: MachineParams,
  units: 'mm' | 'inch',
  fmt: NumberFormatOptions,
  o?: { refuseRounding?: boolean },
): { text: string; rounded: boolean } | { error: Msg } {
  if (!original || typeof original.raw !== 'string') return { error: WRITE_BACK_ERRORS.noReading };
  if (cls === null || (cls as string) === 'count') return { error: WRITE_BACK_ERRORS.noReading };
  const reading = readingFor(cls, m?.numberInput ?? null, units);
  if (reading === null) return { error: WRITE_BACK_ERRORS.noReading };

  const wanted = toDec(value);
  if (wanted === null) return { error: WRITE_BACK_ERRORS.notANumber };

  const asWritten = reading.mode === 'calculator' || (reading.mode === 'increment' && original.hasPoint);
  let literal = wanted;
  if (!asWritten) {
    const unit = unitDec(reading);
    if (unit === null) return { error: WRITE_BACK_ERRORS.noReading };
    literal = divDec(wanted, unit, DIVISION_SCALE);
  }

  // A word without a point cannot carry a fraction, so a count is written as a count. In
  // `calculator` mode the profile's own number format decides, as it did in Phase 1.
  const useFmt: NumberFormatOptions = !asWritten && !original.hasPoint ? { ...fmt, decimals: 0 } : fmt;
  const text = formatNumber(decText(literal), original, useFmt, { decimalPointSignificant: true });

  const back = parseNumber(text);
  const readBack = back === null ? null : valueOf(back, cls, m, units);
  const rounded = readBack === null || readBack !== decText(wanted);
  if (rounded && o?.refuseRounding === true) {
    return { error: { key: WRITE_BACK_ERRORS.rounded.key, params: { increment: reading.unit } } };
  }
  return { text, rounded };
}

// ---------------------------------------------------------------------------
// With no machine: every reading the profile offers
// ---------------------------------------------------------------------------

function presetsOf(decl: MachineParamsDecl | undefined): NumberInputPreset[] {
  const presets = decl?.numberInput?.presets;
  return (Array.isArray(presets) ? presets : []).filter(
    (preset): preset is NumberInputPreset => preset !== null && typeof preset === 'object',
  );
}

/**
 * What every preset the profile declares makes of this literal, the default first.
 *
 * The list is what the user is shown when nothing is settled: "0.050 mm (increments of
 * 0.001 mm)", "50 mm (as written)". A preset that gives the word no value carries `null`,
 * which is also a difference — it is never quietly left out.
 */
export function readingsOf(
  lit: NumericLiteral,
  cls: NumberClass | 'increment',
  decl: MachineParamsDecl | undefined,
  units: 'mm' | 'inch',
): Reading[] {
  const presets = presetsOf(decl);
  if (presets.length === 0) return [];
  const defaultId = decl?.numberInput?.default;
  const ordered = [
    ...presets.filter((preset) => preset.id === defaultId),
    ...presets.filter((preset) => preset.id !== defaultId),
  ];
  return ordered.map((preset) => ({
    preset: typeof preset.id === 'string' ? preset.id : '',
    label: typeof preset.label === 'string' ? preset.label : '',
    value: valueOf(lit, cls, { numberInput: preset.value ?? null } as MachineParams, units),
  }));
}

/**
 * What a consumer asks for one word: a value, or the readings to show instead.
 *
 * With the machine's own number input the machine decides and there is nothing to show.
 * Otherwise the word keeps a value only while **every** preset the profile declares reads
 * it the same way (AD-31 "No machine, no guess"); where they differ, the value is null and
 * the readings say what each preset would make of it, the assumed default first.
 *
 * `readings` is empty whenever the value is settled or the word has no class, so a caller
 * can treat a non-empty list as "this needs a machine" without looking at anything else.
 */
export function resolveValue(
  lit: NumericLiteral,
  cls: ResolvedClass,
  eff: EffectiveMachine,
  decl: MachineParamsDecl | undefined,
  units: 'mm' | 'inch',
): ResolvedValue {
  if (cls === null || cls === 'count') return { value: null, readings: [] };
  const params = eff?.params ?? ({ numberInput: null } as MachineParams);
  if (eff?.source?.numberInput === 'machine') return { value: valueOf(lit, cls, params, units), readings: [] };

  const readings = readingsOf(lit, cls, decl, units);
  // A profile that declares no presets has nothing to disagree about: its JSON is the
  // answer, which is exactly what every Phase 1 document had.
  if (readings.length === 0) return { value: valueOf(lit, cls, params, units), readings: [] };

  const first = readings[0].value;
  if (first !== null && readings.every((reading) => reading.value === first)) return { value: first, readings: [] };
  return { value: null, readings };
}
