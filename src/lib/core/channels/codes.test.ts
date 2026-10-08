// The plain wait-code list (the owner's decision of 2026-10-07, §10.1; §7.17).

import { describe, expect, it } from 'vitest';
import { describeWaitCodes, isWaitCode, parseWaitCodes, waitCodeId, waitCodeWordRe } from './codes';

const keys = (text: string, letters?: string[]) => parseWaitCodes(text, { letters }).errors.map((e) => [e.key, e.params?.item]);

describe('parseWaitCodes', () => {
  it('reads codes and ranges, with commas, blanks and a letter-less second end', () => {
    expect(parseWaitCodes('M100-M199, M300 M350').ranges).toEqual([
      { letter: 'M', from: 100, to: 199 },
      { letter: 'M', from: 300, to: 300 },
      { letter: 'M', from: 350, to: 350 },
    ]);
    expect(parseWaitCodes('m100 - 199').ranges).toEqual([{ letter: 'M', from: 100, to: 199 }]);
    expect(parseWaitCodes('M100\u2013M199, M300 \u2014 M310').ranges).toEqual([
      { letter: 'M', from: 100, to: 199 },
      { letter: 'M', from: 300, to: 310 },
    ]);
    expect(parseWaitCodes('M0100').ranges).toEqual([{ letter: 'M', from: 100, to: 100 }]);
    expect(parseWaitCodes('P1-9999; M100').ranges).toEqual([
      { letter: 'M', from: 100, to: 100 },
      { letter: 'P', from: 1, to: 9999 },
    ]);
  });

  it('joins overlapping and touching ranges', () => {
    expect(parseWaitCodes('M100-M150 M140-M199 M200').ranges).toEqual([{ letter: 'M', from: 100, to: 200 }]);
  });

  it('names the bad item in plain words', () => {
    expect(keys('M2O0')).toEqual([['channels.codes.notNumber', 'M2O0']]);
    expect(keys('M300-M200')).toEqual([['channels.codes.backwards', 'M300-M200']]);
    expect(keys('M100-P200')).toEqual([['channels.codes.letterMismatch', 'M100-P200']]);
    expect(keys('100')).toEqual([['channels.codes.noLetter', '100']]);
    expect(keys('G4', ['M'])).toEqual([['channels.codes.letter', 'G4']]);
    expect(keys('M101.5')).toEqual([['channels.codes.notNumber', 'M101.5']]);
    expect(keys('M999999999')).toEqual([['channels.codes.tooLarge', 'M999999999']]);
    expect(keys('  ')).toEqual([['channels.codes.empty', undefined]]);
  });

  it('uses no range of a list with an error', () => {
    expect(parseWaitCodes('M100-M199, M2O0').ranges).toEqual([]);
  });
});

describe('describeWaitCodes', () => {
  it('is the preview line: the ranges and how many codes', () => {
    expect(describeWaitCodes(parseWaitCodes('M100-M199, M300').ranges)).toEqual({ text: 'M100 … M199, M300', count: 101 });
  });
});

describe('matching a word', () => {
  const ranges = parseWaitCodes('M100-M199').ranges;
  const words = (line: string) => [...line.matchAll(waitCodeWordRe(ranges)!)].filter((m) => isWaitCode(ranges, m[1], Number(m[2]))).map((m) => m[0]);
  it('finds packed and spaced words, never a decimal or a longer number', () => {
    expect(words('N10M101P12')).toEqual(['M101']);
    expect(words('N10 M0150')).toEqual(['M0150']);
    expect(words('M1001 M101.5 M99 XM101')).toEqual([]);
  });
  it('allows blanks after the letter, as the tokenizer does, and never an assignment', () => {
    expect(words('N10 M 150 P12')).toEqual(['M 150']);
    expect(words('M150=1 M 150 = 2 M[150]')).toEqual([]);
  });
  it('names a code by its value', () => {
    expect([waitCodeId('m', '0150'), waitCodeId('M', '150'), waitCodeId('P', '0')]).toEqual(['M150', 'M150', 'P0']);
  });
});
