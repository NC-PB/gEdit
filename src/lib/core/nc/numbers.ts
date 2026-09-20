// Parsing NC numbers (plan §7.4, AD-12). Owner: WP3.2.
//
// NC numbers are kept as text. `10.` and `10` differ on a control with a significant
// decimal point, trailing zeros carry intent, and the Python side has to reach the same
// result with `Decimal`, so nothing here goes through a JS `number`.
//
// The accepted grammar is the one both dialects use (`syntax-fanuc` §3.2,
// `syntax-heidenhain` §3.2):
//
//     [+-] ( digits [ '.' [digits] ] | '.' digits )
//
// No exponent, no thousands separator, no comma: `F2,5` is not a number. A profile that
// writes decimals with a comma would need its separator passed in; `parseNumber` takes no
// profile (§7.4 pins the signature), so it reads the point, and the tokenizer scans the
// value with the separator from the profile before handing the text over.

import type { NumericLiteral } from './types';

const PLUS = 0x2b;
const MINUS = 0x2d;
const POINT = 0x2e;

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

/**
 * Parses a written number (`'-10.'`, `'.5'`, `'+0'`), or returns null when it is not one.
 *
 * The whole string has to be the number: leading or trailing spaces, a second point, a
 * unit or a stray letter all give null. `'10.'` keeps its empty fraction (`fracPart` is
 * `''`, not `null`), because the point is what makes it a millimetre value on a Fanuc
 * control; `'10'` has no fraction at all (`fracPart` is `null`).
 */
export function parseNumber(raw: string): NumericLiteral | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  let i = 0;
  let sign: '+' | '-' | '' = '';
  const first = raw.charCodeAt(0);
  if (first === PLUS || first === MINUS) {
    sign = first === PLUS ? '+' : '-';
    i = 1;
  }

  const intStart = i;
  while (i < raw.length && isDigit(raw.charCodeAt(i))) i++;
  const intPart = raw.slice(intStart, i);

  let fracPart: string | null = null;
  let hasPoint = false;
  if (i < raw.length && raw.charCodeAt(i) === POINT) {
    hasPoint = true;
    i++;
    const fracStart = i;
    while (i < raw.length && isDigit(raw.charCodeAt(i))) i++;
    fracPart = raw.slice(fracStart, i);
  }

  if (i !== raw.length) return null; // trailing text: '10mm', '1.2.3', '10 '
  if (intPart === '' && (fracPart === null || fracPart === '')) return null; // '', '+', '.', '-.'

  return { raw, sign, intPart, fracPart, hasPoint };
}
