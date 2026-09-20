// `parseNumber`: the written form of an NC number (plan §7.4, WP3.2).

import { describe, expect, it } from 'vitest';
import { parseNumber } from './numbers';

describe('parseNumber', () => {
  it('reads a plain integer', () => {
    expect(parseNumber('10')).toEqual({ raw: '10', sign: '', intPart: '10', fracPart: null, hasPoint: false });
  });

  it('keeps the trailing point that makes a Fanuc value a millimetre value', () => {
    expect(parseNumber('10.')).toEqual({ raw: '10.', sign: '', intPart: '10', fracPart: '', hasPoint: true });
  });

  it('reads a fraction without a leading zero (F.15)', () => {
    expect(parseNumber('.15')).toEqual({ raw: '.15', sign: '', intPart: '', fracPart: '15', hasPoint: true });
  });

  it('keeps both signs as they were written', () => {
    expect(parseNumber('+3')).toMatchObject({ sign: '+', intPart: '3', fracPart: null });
    expect(parseNumber('-0.5')).toMatchObject({ sign: '-', intPart: '0', fracPart: '5', hasPoint: true });
    expect(parseNumber('3')).toMatchObject({ sign: '' });
  });

  it('keeps leading and trailing zeros, which carry the programmer’s intent', () => {
    expect(parseNumber('007')).toMatchObject({ intPart: '007', fracPart: null });
    expect(parseNumber('10.500')).toMatchObject({ intPart: '10', fracPart: '500' });
    expect(parseNumber('-0.0')).toMatchObject({ sign: '-', intPart: '0', fracPart: '0' });
  });

  it('reads numbers that no double could hold exactly', () => {
    expect(parseNumber('12345678901234567890.12345678901234567890')).toMatchObject({
      intPart: '12345678901234567890',
      fracPart: '12345678901234567890',
    });
  });

  it('refuses anything that is not the whole number', () => {
    for (const raw of ['', '+', '-', '.', '+.', 'X10', '10mm', '1.2.3', '1 0', ' 10', '10 ', '1e5', '2,5', '#101', '[1]']) {
      expect(parseNumber(raw), raw).toBeNull();
    }
  });

  it('refuses a comma, which is not a decimal separator in either dialect', () => {
    expect(parseNumber('2,5')).toBeNull();
  });

  it('gives back the text it was handed', () => {
    for (const raw of ['10', '10.', '.5', '-10.5', '+0']) expect(parseNumber(raw)?.raw).toBe(raw);
  });
});
