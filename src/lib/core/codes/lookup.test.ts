// Normalisation, lookup and completion over the shipped databases (plan §5, WP3.3).

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/codes/fanuc.json';
import heidenhainJson from '$lib/data/codes/heidenhain.json';
import { loadCodeDb } from './load';
import { completionsFor, lookupCode, lookupWord, normalizeCode } from './lookup';
import type { NcToken } from '$lib/core/nc/types';

const fanuc = loadCodeDb(fanucJson);
const heidenhain = loadCodeDb(heidenhainJson);

/** A word token as the tokenizer hands it over; the offsets do not matter here. */
function word(address: string, valueText: string): NcToken {
  return { kind: 'word', start: 0, end: 0, text: address + valueText, address, valueText };
}

function keyword(text: string): NcToken {
  return { kind: 'keyword', start: 0, end: 0, text, address: text };
}

describe('normalizeCode', () => {
  it('upper-cases and drops zero padding', () => {
    expect(normalizeCode('g01')).toBe('G1');
    expect(normalizeCode('M08')).toBe('M8');
    expect(normalizeCode('m0006')).toBe('M6');
  });

  it('leaves a code that is already canonical alone', () => {
    for (const code of ['G0', 'M0', 'R0', 'G1', 'T1']) expect(normalizeCode(code)).toBe(code);
  });

  it('keeps the decimal part', () => {
    expect(normalizeCode('g54.1')).toBe('G54.1');
    expect(normalizeCode('G012.1')).toBe('G12.1');
  });

  it('collapses the spaces of a multi-word code', () => {
    expect(normalizeCode('cycl  def  200')).toBe('CYCL DEF 200');
    expect(normalizeCode(' call lbl ')).toBe('CALL LBL');
    expect(normalizeCode('begin pgm')).toBe('BEGIN PGM');
  });

  it('joins a single address letter with its digits but not a two-word name', () => {
    expect(normalizeCode('G 83')).toBe('G83');
    expect(normalizeCode('N 120')).toBe('N120');
    expect(normalizeCode('F MAX')).toBe('F MAX');
    expect(normalizeCode('TOOL CALL')).toBe('TOOL CALL');
  });
});

describe('lookupCode', () => {
  it('finds a padded and a lower-case spelling', () => {
    expect(lookupCode(fanuc, 'G01')?.code).toBe('G1');
    expect(lookupCode(fanuc, 'g83')?.code).toBe('G83');
    expect(lookupCode(fanuc, 'M06')?.code).toBe('M6');
  });

  it('finds a code with a decimal part', () => {
    expect(lookupCode(fanuc, 'G54.1')?.label).toBe('Extended work offset');
  });

  it('finds a multi-word Klartext code', () => {
    expect(lookupCode(heidenhain, 'CYCL DEF 200')?.label).toBe('Drilling cycle');
    expect(lookupCode(heidenhain, 'cycl def 200')?.code).toBe('CYCL DEF 200');
    expect(lookupCode(heidenhain, 'tool call')?.code).toBe('TOOL CALL');
  });

  it('follows an alias', () => {
    expect(lookupCode(heidenhain, 'F MAX')?.code).toBe('FMAX');
    expect(lookupCode(heidenhain, 'f auto')?.code).toBe('FAUTO');
  });

  it('answers null for a code the database does not have', () => {
    expect(lookupCode(fanuc, 'G12.1')).toBeNull();
    expect(lookupCode(fanuc, '')).toBeNull();
    expect(lookupCode(heidenhain, 'CYCL DEF 999')).toBeNull();
  });

  it('describes G83 and M8 the way the assistant shows them', () => {
    const g83 = lookupCode(fanuc, 'G83');
    expect(g83?.label).toBe('Peck drilling cycle');
    expect(g83?.group).toBe('cycle');
    expect(g83?.modal).toBe(true);
    expect(g83?.verify).toBeUndefined();

    const m8 = lookupCode(fanuc, 'M08');
    expect(m8?.label).toBe('Coolant on');
    expect(m8?.group).toBe('coolant');
  });
});

describe('lookupWord', () => {
  it('finds the code of a G or M word and its address', () => {
    const hit = lookupWord(fanuc, word('G', '83'));
    expect(hit?.entry?.code).toBe('G83');
    expect(hit?.address?.letter).toBe('G');
    expect(hit?.unknown).toBeUndefined();
  });

  it('answers with the address alone when the value is not a code', () => {
    const hit = lookupWord(fanuc, word('X', '10.'));
    expect(hit?.entry).toBeNull();
    expect(hit?.address?.label).toBe('X axis');
    expect(hit?.unknown).toBeUndefined();
  });

  it('answers unknown when the database knows neither the code nor the address', () => {
    expect(lookupWord(fanuc, word(',R', '1.'))).toEqual({ entry: null, unknown: true });
    expect(lookupWord(heidenhain, keyword('PATTERN DEF'))).toEqual({ entry: null, unknown: true });
  });

  it('reads a Klartext keyword', () => {
    expect(lookupWord(heidenhain, keyword('TOOL CALL'))?.entry?.code).toBe('TOOL CALL');
    expect(lookupWord(heidenhain, keyword('lbl'))?.entry?.code).toBe('LBL');
  });

  it('reads a Q parameter as its parameter class', () => {
    const q = lookupWord(heidenhain, word('Q200', '=2'));
    expect(q?.address?.letter).toBe('Q');
    expect(q?.address?.label).toBe('Q parameter, global');

    expect(lookupWord(heidenhain, word('QL2', ''))?.address?.letter).toBe('QL');
    expect(lookupWord(heidenhain, word('QS3', ''))?.address?.letter).toBe('QS');
  });

  it('has nothing to say about a comment, a string, a variable or whitespace', () => {
    for (const kind of ['comment', 'string', 'variable', 'whitespace', 'blockNumber'] as const) {
      expect(lookupWord(fanuc, { kind, start: 0, end: 1, text: 'x' })).toBeNull();
    }
  });
});

describe('completionsFor', () => {
  it('offers G80 to G89 for the prefix G8', () => {
    const hits = completionsFor(fanuc, 'G8', false).map((e) => e.code);
    expect(hits).toEqual(['G80', 'G81', 'G82', 'G83', 'G84', 'G85', 'G86', 'G87', 'G88', 'G89']);
  });

  it('ignores case and zero padding in the prefix', () => {
    const g8 = ['G80', 'G81', 'G82', 'G83', 'G84', 'G85', 'G86', 'G87', 'G88', 'G89'];
    expect(completionsFor(fanuc, 'g8', false).map((e) => e.code)).toEqual(g8);
    expect(completionsFor(fanuc, 'G08', false).map((e) => e.code)).toEqual(g8);
  });

  it('sorts by number, not by text, and keeps a decimal code next to its base', () => {
    const hits = completionsFor(fanuc, 'G5', false).map((e) => e.code);
    expect(hits).toEqual(['G50', 'G53', 'G54', 'G54.1', 'G55', 'G56', 'G57', 'G58', 'G59']);
    expect(completionsFor(fanuc, 'M', false).map((e) => e.code).slice(0, 4)).toEqual([
      'M0', 'M1', 'M2', 'M3',
    ]);
  });

  it('returns the whole database for an empty prefix at the start of a block', () => {
    expect(completionsFor(fanuc, '', true)).toHaveLength(fanuc.codes.length);
  });

  it('offers the Klartext keywords only at the start of a block', () => {
    const start = completionsFor(heidenhain, '', true).map((e) => e.code);
    const middle = completionsFor(heidenhain, '', false).map((e) => e.code);
    for (const code of ['L', 'CC', 'TOOL CALL', 'CYCL DEF 200', 'BEGIN PGM']) {
      expect(start, code).toContain(code);
      expect(middle, code).not.toContain(code);
    }
  });

  it('keeps the compensation, feed and M words available inside a block', () => {
    const middle = completionsFor(heidenhain, '', false).map((e) => e.code);
    for (const code of ['R0', 'RL', 'RR', 'FMAX', 'FAUTO', 'M8', 'M99']) {
      expect(middle, code).toContain(code);
    }
  });

  it('is unaffected by the block position in a dialect whose codes are all letter plus number', () => {
    expect(completionsFor(fanuc, 'G9', true).map((e) => e.code)).toEqual(
      completionsFor(fanuc, 'G9', false).map((e) => e.code),
    );
  });

  it('answers with nothing for a prefix no code starts with', () => {
    expect(completionsFor(fanuc, 'ZZ', true)).toEqual([]);
  });
});
