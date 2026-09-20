// Formatting NC numbers (plan §7.4, AD-12). Owner: WP3.2.
//
// `decimal` is an exact decimal string (for example the result of scaling `1234.5` by
// 90 %), `original` is the literal that stood in the file, and `fmt` is the profile's
// `numberFormat`. The result is a string: rounding is done on the digits, half away from
// zero, so TypeScript and `gedit_nc.py` agree to the last digit.
//
// `decimalPointSignificant` (from `syntax`) decides whether a value may lose its point:
// on a Fanuc control `X10` and `X10.` are different positions, so the point stays.
//
// What each option does, in the order they are applied:
//
//   decimals      'keep' rounds to the number of decimals `original` was written with
//                 (none at all when it had no point), or, without an `original`, to the
//                 decimals of `decimal`. A number rounds half away from zero, so 1111.05
//                 to one decimal is 1111.1 and -1111.05 is -1111.1.
//   trailingZeros 'drop' removes zeros at the end of the fraction, 'keep' leaves the
//                 fraction at its full width (`10.500` stays `10.500`).
//   keepPoint     when the fraction ends up empty: keep the point the value was written
//                 with (`10.`) or drop it (`10`). It never adds one, because a value
//                 written without a point is a count of increments, not millimetres.
//   plusSign      'keep' writes `+` when `original` had one, 'always' on every value that
//                 is not negative (Klartext writes `X+0`), 'never' on none of them.
//
// With `decimalPointSignificant` and an `original`, the point follows the original: a
// value written without one never gains one and a value written with one never loses it,
// whatever `keepPoint` says. The one exception is a fraction that is not empty — it needs
// the point to be readable at all.
//
// Two further rules keep a reformat that changes nothing a no-op: leading zeros in the
// integer part are dropped (`007` → `7`), but a value the file wrote without its leading
// zero (`F.15`) keeps that style when the result is still below one.

import type { NumberFormatOptions } from '$lib/core/profiles/types';
import { parseNumber } from './numbers';
import type { NumericLiteral } from './types';

/** Adds one to a string of digits, carrying to the left: `'199'` → `'200'`. */
function increment(digits: string): string {
  const out = digits.split('');
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === '9') {
      out[i] = '0';
      continue;
    }
    out[i] = String.fromCharCode(out[i].charCodeAt(0) + 1);
    return out.join('');
  }
  return `1${out.join('')}`;
}

/** Rounds `intPart.fracPart` to `decimals` places, half away from zero, on the digits. */
function round(intPart: string, fracPart: string, decimals: number): { intPart: string; fracPart: string } {
  if (fracPart.length <= decimals) return { intPart, fracPart: fracPart.padEnd(decimals, '0') };

  const head = (intPart === '' ? '0' : intPart) + fracPart.slice(0, decimals);
  const digits = fracPart.charCodeAt(decimals) - 0x30 >= 5 ? increment(head) : head;
  const cut = digits.length - decimals;
  return { intPart: digits.slice(0, cut), fracPart: digits.slice(cut) };
}

function isZero(digits: string): boolean {
  for (let i = 0; i < digits.length; i++) if (digits.charCodeAt(i) !== 0x30) return false;
  return true;
}

/** Formats `decimal` the way `fmt` asks, keeping the style of `original` where `fmt` says `keep`. */
export function formatNumber(
  decimal: string,
  original: NumericLiteral | null,
  fmt: NumberFormatOptions,
  o?: { decimalPointSignificant?: boolean },
): string {
  const parsed = parseNumber(typeof decimal === 'string' ? decimal.trim() : '');
  if (!parsed) throw new RangeError(`formatNumber: not a decimal number: ${JSON.stringify(decimal)}`);

  const pointSignificant = o?.decimalPointSignificant ?? true;
  const written = original ? (original.fracPart?.length ?? 0) : (parsed.fracPart?.length ?? 0);
  const decimals = fmt.decimals === 'keep' ? written : Math.max(0, Math.trunc(fmt.decimals));

  const rounded = round(parsed.intPart, parsed.fracPart ?? '', decimals);
  let fraction = rounded.fracPart;
  if (fmt.trailingZeros === 'drop') fraction = fraction.replace(/0+$/, '');

  // The point: needed by a fraction, otherwise the profile and the written form decide.
  const hadPoint = original ? original.hasPoint : parsed.hasPoint;
  const point = fraction.length > 0 || (pointSignificant && original ? original.hasPoint : fmt.keepPoint === true && hadPoint);

  let integer = rounded.intPart.replace(/^0+(?=\d)/, '');
  // `F.15` was written without its leading zero; keep that as long as it stays below one.
  if (original && original.intPart === '' && (integer === '' || integer === '0')) integer = '';
  else if (integer === '') integer = '0';
  if (integer === '' && fraction === '') integer = '0';

  const negative = parsed.sign === '-' && !(isZero(integer) && isZero(fraction));
  let sign = '';
  if (negative) sign = '-';
  else if (fmt.plusSign === 'always') sign = '+';
  else if (fmt.plusSign === 'keep' && (original ? original.sign : parsed.sign) === '+') sign = '+';

  return `${sign}${integer}${point ? '.' : ''}${fraction}`;
}
