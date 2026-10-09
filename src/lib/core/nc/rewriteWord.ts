// Rewriting one word of a line (Phase 3 plan §6.4; Phase 2 plan AD-27). Owner: P3.2a (the
// Phase 3 prelude wrote the contract).
//
// The inspector's "edit value" ends here. The rules, all binding:
//
//   1. Only the characters of `token`'s value change; everything before and after it — the
//      address, the other words, the spacing, a trailing comment, the line ending — stays
//      byte for byte.
//   2. The address is kept as written (its case, `,R`, `SB=`), and so is the form of the
//      number: a point stays a point, a point-less word stays point-less, the sign style
//      (`+`), the written decimals (`10.500` → `12.300`), zero padding (`T0101` → `T0202`,
//      `P020060` → `P010060`) and the decimal comma are kept, and decimals the user typed
//      beyond them are kept too: a typed value is never rounded (`12.3450` stays `12.3450`).
//   3. `typed` is the **effective** value (mm or inch, degrees, seconds) for a word with a
//      class (`how.cls`): it goes back through `writeBack` (AD-31) with `refuseRounding`,
//      so a value that is not a whole number of increments for a point-less word — or of
//      units in a `scale` unit system — is refused with the reason (`0.0505` into `X50` under
//      IS-B), never rounded (`0.051` becomes `X51`). A word with no class or a count takes
//      `typed` as the literal; a point-less one gains a point only where the typed value has
//      a fraction (the caller's `checkValue` refuses a fraction where a whole number is due).
//   4. A word whose reading depends on a machine that is not chosen has no reading to write
//      back into: refused (`WRITE_BACK_ERRORS.noReading`), as the inspector already says.
//      The caller says so with `how.readings` (the readings `readWord` answered); a word
//      whose value is a variable or an expression has nothing to write into either.
//   5. Not a number: refused (`WRITE_BACK_ERRORS.notANumber`). A decimal comma is read as
//      the point.
//
// The caller applies the new line with `applyLines` (one undo step) and validates the value
// against the code database first (`core/codes/inspect.ts` `checkValue`).

import type { Msg } from '$lib/app/types';
import { WRITE_BACK_ERRORS, writeBack } from '$lib/core/machines/numbers';
import type { MachineParams, Reading, ResolvedClass } from '$lib/core/machines/types';
import type { NumberFormatOptions } from '$lib/core/profiles/types';
import { formatNumber } from './numberFormat';
import { parseNumber } from './numbers';
import type { NcToken, NumericLiteral } from './types';

/** How the word's value is read and written. */
export interface RewriteHow {
  /** The word's class as the inspector resolved it (`numberClassOf`). */
  cls: ResolvedClass;
  /** The document's effective machine parameters (AD-31). */
  params: MachineParams;
  /** The units in force after the block (`ModalState.units`, AD-35); `unknown` reads as the machine's. */
  units: 'mm' | 'inch';
  /**
   * The profile's number format (`profile.numberFormat`). The written form of the word wins
   * over it (rule 2), so it decides nothing the word itself shows.
   */
  fmt: NumberFormatOptions;
  /** P3.2a: the readings `readWord` answered; non-empty means "needs a machine" (rule 4). */
  readings?: readonly Reading[];
}

export type RewriteResult =
  | {
      ok: true;
      /** The whole new line. */
      line: string;
      /** The new text of the word alone, and where it stands in the new line (UTF-16 offsets). */
      text: string;
      start: number;
      end: number;
    }
  | { ok: false; reason: Msg };

/** Digits a converted value is carried to before the trailing zeros are dropped. */
const EXACT_DECIMALS = 24;

/** A typed number: optional sign, digits, one point or comma. Spaces around it are trimmed. */
function parseTyped(typed: string): NumericLiteral | null {
  if (typeof typed !== 'string') return null;
  const text = typed.trim().replace(',', '.');
  return parseNumber(text);
}

/** `-012.500` → `-12.5`, `-0` → `0`: the value without its spelling. */
function canonical(lit: NumericLiteral): string {
  const int = lit.intPart.replace(/^0+/, '');
  const frac = (lit.fracPart ?? '').replace(/0+$/, '');
  if (int === '' && frac === '') return '0';
  return `${lit.sign === '-' ? '-' : ''}${int === '' ? '0' : int}${frac === '' ? '' : `.${frac}`}`;
}

/** Pads the fraction of `text` to `decimals` places (only when it has a separator) and the integer to `width`. */
function padForm(text: string, decimals: number, width: number): string {
  const m = /^([+-]?)(\d*)([.,]?)(\d*)$/.exec(text);
  if (!m) return text;
  const [, sign, int, sep, frac] = m;
  const fraction = sep !== '' ? frac.padEnd(decimals, '0') : frac;
  const integer = int.length > 0 && int.length < width ? int.padStart(width, '0') : int;
  return `${sign}${integer}${sep}${fraction}`;
}

function needsLiteral(cls: ResolvedClass): boolean {
  return cls === null || cls === 'count';
}

/** The line with `token`'s value replaced by `typed`, or why not (rules 1–5 above). */
export function rewriteWord(line: string, token: NcToken, typed: string, how: RewriteHow): RewriteResult {
  const original = token.value ?? null;
  const valueText = token.valueText;
  if (original === null || valueText === undefined || valueText === '') return { ok: false, reason: WRITE_BACK_ERRORS.noReading };
  const valueStart = token.end - valueText.length;
  if (valueStart < token.start || line.slice(valueStart, token.end) !== valueText) {
    return { ok: false, reason: WRITE_BACK_ERRORS.noReading };
  }
  if (how.readings && how.readings.length > 0) return { ok: false, reason: WRITE_BACK_ERRORS.noReading };

  const wanted = parseTyped(typed);
  if (wanted === null) return { ok: false, reason: WRITE_BACK_ERRORS.notANumber };
  const typedDecimals = wanted.fracPart?.length ?? 0;
  const writtenDecimals = original.fracPart?.length ?? 0;
  // `keep` keeps the `+` the word was written with, never adds one, and never removes a `-`.
  const exact = (decimals: number, trailingZeros: 'keep' | 'drop'): NumberFormatOptions => ({
    decimals,
    trailingZeros,
    keepPoint: true,
    plusSign: 'keep',
  });

  let text: string;
  if (needsLiteral(how.cls)) {
    text = formatNumber(wanted.raw, original, exact(Math.max(typedDecimals, writtenDecimals), 'keep'), {
      decimalPointSignificant: true,
    });
  } else {
    const back = writeBack(wanted.raw, original, how.cls as Exclude<ResolvedClass, null | 'count'>, how.params, how.units, exact(EXACT_DECIMALS, 'drop'), {
      refuseRounding: true,
    });
    if ('error' in back) return { ok: false, reason: back.error };
    text = back.text;
    // Read as written (calculator, or a word with a point under increments): the literal is
    // the typed value, so the typed decimals are the user's and are kept.
    const literal = parseNumber(text.replace(',', '.'));
    const asTyped = literal !== null && canonical(literal) === canonical(wanted);
    text = padForm(text, asTyped ? Math.max(typedDecimals, writtenDecimals) : writtenDecimals, 0);
  }
  // Zero padding of the integer part, as written (`T0101`, `P020060`).
  const width = /^0\d/.test(original.intPart) ? original.intPart.length : 0;
  text = padForm(text, 0, width);

  const word = line.slice(token.start, valueStart) + text;
  return {
    ok: true,
    line: line.slice(0, valueStart) + text + line.slice(token.end),
    text: word,
    start: token.start,
    end: token.start + word.length,
  };
}
