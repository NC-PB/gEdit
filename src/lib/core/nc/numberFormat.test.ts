// `formatNumber` (plan §7.4, WP3.2).
//
// The table lives in `tests/fixtures/numberformat.cases.json` because `gedit_nc.py`
// (§7.10) has to answer every case the same way; the cases below the table are the ones
// that are about the function's own edges rather than about a rule. Every case was
// written for gEdit; the values come from the arithmetic, not from anyone's manual.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { NumberFormatOptions } from '$lib/core/profiles/types';
import { formatNumber } from './numberFormat';
import { parseNumber } from './numbers';

interface FormatCase {
  note?: string;
  decimal: string;
  original: string | null;
  fmt: NumberFormatOptions;
  significant: boolean;
  expected: string;
}

const CASES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/numberformat.cases.json', import.meta.url)), 'utf8'),
) as FormatCase[];

const KEEP: NumberFormatOptions = { decimals: 'keep', trailingZeros: 'keep', keepPoint: true, plusSign: 'keep' };

describe('numberformat.cases.json', () => {
  it('holds the cases the plan asks for', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });

  it.each(CASES.map((c, i) => [`${i + 1}. ${c.note ?? `${c.decimal} → ${c.expected}`}`, c] as const))('%s', (_name, c) => {
    const original = c.original === null ? null : parseNumber(c.original);
    expect(c.original === null || original !== null, `original ${c.original} does not parse`).toBe(true);
    expect(formatNumber(c.decimal, original, c.fmt, { decimalPointSignificant: c.significant })).toBe(c.expected);
  });
});

describe('formatNumber', () => {
  it('leaves a literal alone when nothing about it changes', () => {
    for (const raw of ['10', '10.', '.15', '-0.5', '+3', '1234.5678', '0.000', '10.500', '+0']) {
      const original = parseNumber(raw);
      expect(original, raw).not.toBeNull();
      expect(formatNumber(raw, original, KEEP), raw).toBe(raw);
    }
  });

  it('treats the decimal point as significant unless told otherwise', () => {
    const original = parseNumber('10.');
    expect(formatNumber('10', original, { ...KEEP, keepPoint: false })).toBe('10.');
    expect(formatNumber('10', original, { ...KEEP, keepPoint: false }, { decimalPointSignificant: false })).toBe('10');
  });

  it('rounds half away from zero, never to the even digit', () => {
    const fmt: NumberFormatOptions = { decimals: 0, trailingZeros: 'drop', keepPoint: false, plusSign: 'never' };
    expect([0.5, 1.5, 2.5, 3.5, 4.5].map((n) => formatNumber(String(n), null, fmt))).toEqual(['1', '2', '3', '4', '5']);
    expect([-0.5, -1.5, -2.5].map((n) => formatNumber(String(n), null, fmt))).toEqual(['-1', '-2', '-3']);
  });

  it('works on the digits, so a value beyond double precision stays exact', () => {
    const fmt: NumberFormatOptions = { decimals: 2, trailingZeros: 'keep', keepPoint: true, plusSign: 'never' };
    expect(formatNumber('9007199254740993.005', null, fmt)).toBe('9007199254740993.01');
    // A double would have lost the last digit long before the rounding.
    expect(String(Number('9007199254740993'))).toBe('9007199254740992');
  });

  it('accepts a value with surrounding whitespace and refuses one that is not a number', () => {
    expect(formatNumber('  1.5  ', null, KEEP)).toBe('1.5');
    for (const bad of ['', '.', 'X10', '1e5', '2,5']) expect(() => formatNumber(bad, null, KEEP), bad).toThrow(RangeError);
  });

  it('drops leading zeros of the integer part', () => {
    expect(formatNumber('007.5', null, KEEP)).toBe('7.5');
    expect(formatNumber('000', null, KEEP)).toBe('0');
    expect(formatNumber('000.0', null, KEEP)).toBe('0.0');
  });

  it('keeps a point but never adds one', () => {
    const fmt: NumberFormatOptions = { decimals: 0, trailingZeros: 'drop', keepPoint: true, plusSign: 'never' };
    expect(formatNumber('10.4', parseNumber('9.9'), fmt, { decimalPointSignificant: false })).toBe('10.');
    expect(formatNumber('10.4', parseNumber('9'), fmt, { decimalPointSignificant: false })).toBe('10');
  });

  it('never writes a bare point', () => {
    const fmt: NumberFormatOptions = { decimals: 0, trailingZeros: 'drop', keepPoint: true, plusSign: 'never' };
    expect(formatNumber('0.4', null, fmt)).toBe('0.');
    expect(formatNumber('0.4', parseNumber('.0'), fmt)).toBe('0.');
  });
});
