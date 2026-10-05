// NC-aware search (plan §7.6, AD-25, §6 WP11.1): what a word query finds and what it leaves
// alone, text queries and comments, the replace, the program-number references, and the
// 300k-line budget.

import { describe, expect, it } from 'vitest';
import { expectWithin } from '../../../../tests/unit/helpers/budget';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { resolveCodeDbs } from '$lib/core/codes/resolve';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import okumaJson from '$lib/data/profiles/okuma-osp.json';
import sinumerikJson from '$lib/data/profiles/sinumerik.json';
import { findInLines, parseQuery, replaceInLines, wholeAddressRegex } from './index';
import type { SearchFlags, SearchQuery } from './types';

const compile = (json: unknown): CompiledProfile => compileProfile(json as Profile);
const fanuc = compile(fanucJson);
const klartext = compile(heidenhainJson);
const okuma = compile(okumaJson);
const sinumerik = compile(sinumerikJson);
const CODES = resolveCodeDbs(BUILTIN_CODE_DB_JSON);

const WORD: SearchFlags = { wholeAddress: true, regex: false, caseSensitive: false, inComments: false };

function word(text: string, cp = fanuc): SearchQuery {
  const q = parseQuery(text, cp, WORD);
  if ('error' in q) throw new Error(q.error.key);
  return q;
}

/** The text of every hit of a word query, per line, joined. */
function found(lines: string[], text: string, cp = fanuc, codes?: (typeof CODES)[string]): string[] {
  return findInLines(lines, cp, word(text, cp), { codes }).hits.map((h) => h.text.slice(h.start, h.end));
}

describe('parseQuery', () => {
  it('reads a word with an address, an operator and a value', () => {
    expect(word('G1')).toEqual({ kind: 'word', address: 'G', value: '1' });
    expect(word('s>12000')).toEqual({ kind: 'word', address: 'S', op: '>', value: '12000' });
    expect(word('SB=500', okuma)).toEqual({ kind: 'word', address: 'SB', op: '=', value: '500' });
    expect(word('S1=', sinumerik)).toEqual({ kind: 'word', address: 'S1', op: '=' });
    expect(word('X')).toEqual({ kind: 'word', address: 'X' });
    expect(word('X<=-5.5')).toEqual({ kind: 'word', address: 'X', op: '<=', value: '-5.5' });
  });

  it('refuses what is not a word, a condition without a number and a broken regex', () => {
    expect(parseQuery('G1 X2', fanuc, WORD)).toMatchObject({ error: { key: 'search.errorWord' } });
    expect(parseQuery('S>', fanuc, WORD)).toMatchObject({ error: { key: 'search.errorValue' } });
    expect(parseQuery('  ', fanuc, WORD)).toMatchObject({ error: { key: 'search.errorEmpty' } });
    expect(parseQuery('(', fanuc, { ...WORD, wholeAddress: false, regex: true })).toMatchObject({
      error: { key: 'search.errorRegex' },
    });
  });

  it('makes text of anything else', () => {
    expect(parseQuery('(G1', fanuc, { ...WORD, wholeAddress: false })).toEqual({
      kind: 'text',
      text: '(G1',
      regex: false,
      caseSensitive: false,
      inComments: false,
    });
  });
});

describe('a word query', () => {
  it('finds G1 as G1, G01 and G1. and not G10, G100 or G1.5', () => {
    const lines = ['G1 X1', 'G01 X2', 'G1. X3', 'G10 L2', 'G100', 'G1.5', 'N10G1X5'];
    expect(found(lines, 'G1')).toEqual(['G1', 'G01', 'G1.', 'G1']);
    expect(found(lines, 'G01')).toEqual(['G1', 'G01', 'G1.', 'G1']);
  });

  it('finds T1 as T1 and T01 and not T10 or T0101', () => {
    const lines = ['T1 M6', 'T01 M6', 'T10 M6', 'T0101', 'T1.'];
    expect(found(lines, 'T1')).toEqual(['T1', 'T01', 'T1.']);
  });

  it('compares a condition on the value as written', () => {
    const lines = ['S12000.', 'S12000', 'S12001', 'S11999.5', 'S#5', 'S-1'];
    expect(found(lines, 'S>12000')).toEqual(['S12001']);
    expect(found(lines, 'S>=12000')).toEqual(['S12000.', 'S12000', 'S12001']);
    expect(found(lines, 'S<12000')).toEqual(['S11999.5', 'S-1']);
    expect(found(lines, 'S!=12000')).toEqual(['S12001', 'S11999.5', 'S-1']);
    expect(found(lines, 'S')).toEqual(['S12000.', 'S12000', 'S12001', 'S11999.5', 'S#5', 'S-1']);
  });

  it('does not convert by the decimal mode: X>50 finds X60 and X60. alike', () => {
    expect(found(['X60', 'X60.', 'X.5', 'X50.', 'X5000'], 'X>50')).toEqual(['X60', 'X60.', 'X5000']);
  });

  it('finds nothing in comments or strings', () => {
    expect(found(['G1 (G1 FINISH) X5', '(G1)', 'G0 X1'], 'G1')).toEqual(['G1']);
    expect(found(['G1 MSG("G1 X2")'], 'G1', sinumerik)).toEqual(['G1']);
    expect(found(['G1 ; G1 here', '; G1', 'X5 G1'], 'G1', sinumerik)).toEqual(['G1', 'G1']);
  });

  it('finds block numbers and program numbers by their address', () => {
    expect(found(['N10 G1', 'N100 G1', 'O1234 (N10)'], 'N10')).toEqual(['N10']);
    expect(found(['O1234 (HELLO)', 'O12345'], 'O1234')).toEqual(['O1234']);
  });

  it('reports the line, the columns and the line as written', () => {
    const { hits, truncated } = findInLines(['X1', '  G1 X2'], fanuc, word('G1'));
    expect(hits).toEqual([{ line: 2, start: 2, end: 4, text: '  G1 X2' }]);
    expect(truncated).toBe(false);
  });

  it('stops at the cap and says so', () => {
    const lines = Array.from({ length: 10 }, () => 'G1 G1');
    const r = findInLines(lines, fanuc, word('G1'), { max: 7 });
    expect(r.hits).toHaveLength(7);
    expect(r.truncated).toBe(true);
    expect(findInLines(lines, fanuc, word('G1'), { max: 20 }).truncated).toBe(false);
  });

  it('reads Klartext words, signs and the tail of a ~ block included', () => {
    const lines = ['1 L X+10 Y-5 R0 F100 M3 ~', '  Z+5 FMAX', '2 L X10. Z-5'];
    expect(found(lines, 'X10', klartext)).toEqual(['X+10', 'X10.']);
    expect(found(lines, 'Z>-6', klartext)).toEqual(['Z+5', 'Z-5']);
    expect(found(lines, 'FMAX', klartext)).toEqual(['FMAX']);
    expect(found(lines, 'M3', klartext)).toEqual(['M3']);
    // Q parameters: found by name, and by value when they are assigned.
    const q = ['Q200=2 ;SET-UP', 'L X+Q206', 'Q200=5'];
    expect(found(q, 'Q200', klartext)).toEqual(['Q200', 'Q200']);
    expect(found(q, 'Q200=5', klartext)).toEqual(['Q200=5']);
  });

  it('reads an Okuma assignment word: SB= is one address, S is another', () => {
    const lines = ['G01 X10 SB=500 S=300 F100', 'S1000 SB=300'];
    expect(found(lines, 'SB=', okuma)).toEqual(['SB=500', 'SB=300']);
    expect(found(lines, 'SB=500', okuma)).toEqual(['SB=500']);
    expect(found(lines, 'SB>400', okuma)).toEqual(['SB=500']);
    expect(found(lines, 'S', okuma)).toEqual(['S=300', 'S1000']);
  });

  it('reads a Sinumerik assignment word: S1= is one address, S another', () => {
    const lines = ['G1 X10 S1=500 S2=300 F100', 'S3000 M3', 'R1=5 CYCLE81(1,2)'];
    expect(found(lines, 'S1=', sinumerik)).toEqual(['S1=500']);
    expect(found(lines, 'S1', sinumerik)).toEqual(['S1=500']);
    expect(found(lines, 'S2>200', sinumerik)).toEqual(['S2=300']);
    expect(found(lines, 'S', sinumerik)).toEqual(['S3000']);
    expect(found(lines, 'R1=5', sinumerik)).toEqual(['R1=5']);
  });
});

describe('program-number references (§7.16 #136)', () => {
  const codes = CODES.fanuc;
  const lines = ['O2000 (SUB)', 'M98 P2000 L2', 'M98 P52000', 'M98 P3000', 'G65 P2000 A1', 'G66 P2000', 'X2000 P2000', 'N10 M98 P12000'];

  it('finds the program and every call that names it', () => {
    expect(found(lines, 'O2000', fanuc, codes)).toEqual(['O2000', 'P2000', 'P52000', 'P2000', 'P2000', 'P12000']);
  });

  it('finds a packed call under the packed number too', () => {
    expect(found(lines, 'O52000', fanuc, codes)).toEqual(['P52000']);
  });

  // Review NC-12: the external call `M198 P…` names the program too, never packed.
  it('finds an external call', () => {
    expect(found(['O2000', 'M198 P2000', 'M198 P52000'], 'O2000', fanuc, codes)).toEqual(['O2000', 'P2000']);
  });

  it('finds only the program itself without a database', () => {
    expect(found(lines, 'O2000')).toEqual(['O2000']);
  });

  it('is only for the program address: P2000 is a P word', () => {
    expect(found(lines, 'P2000', fanuc, codes)).toEqual(['P2000', 'P2000', 'P2000', 'P2000']);
  });

  it('is never followed by a replace', () => {
    const r = replaceInLines(lines, fanuc, word('O2000'), 'O2100');
    expect(r.count).toBe(1);
    expect(r.lines[0]).toBe('O2100 (SUB)');
    expect(r.lines.slice(1)).toEqual(lines.slice(1));
  });
});

describe('a text query', () => {
  const text = (t: string, o: Partial<SearchFlags> = {}): SearchQuery => {
    const q = parseQuery(t, fanuc, { wholeAddress: false, regex: false, caseSensitive: false, inComments: false, ...o });
    if ('error' in q) throw new Error(q.error.key);
    return q;
  };
  const hits = (lines: string[], q: SearchQuery): string[] =>
    findInLines(lines, fanuc, q).hits.map((h) => `${h.line}:${h.start}`);

  it('is literal unless it is a regex, and ignores case unless asked', () => {
    expect(hits(['a.b', 'axb', 'A.B'], text('a.b'))).toEqual(['1:0', '3:0']);
    expect(hits(['a.b', 'axb', 'A.B'], text('a.b', { regex: true }))).toEqual(['1:0', '2:0', '3:0']);
    expect(hits(['a.b', 'A.B'], text('a.b', { caseSensitive: true }))).toEqual(['1:0']);
  });

  it('leaves out hits in comments unless asked, and keeps a hit in code on the same line', () => {
    const lines = ['X1 (X1 TEST) X1', '(X1)'];
    expect(hits(lines, text('X1'))).toEqual(['1:0', '1:13']);
    expect(hits(lines, text('X1', { inComments: true }))).toEqual(['1:0', '1:4', '1:13', '2:1']);
    expect(hits(['G1 (rough'], text('(rough'))).toEqual([]);
  });

  it('skips empty matches', () => {
    expect(hits(['abc'], text('x*', { regex: true }))).toEqual([]);
  });
});

describe('replaceInLines', () => {
  it('replaces a whole word and counts', () => {
    const r = replaceInLines(['T1 M6', 'G1 T01 (T1)', 'T10'], fanuc, word('T1'), 'T5');
    expect(r).toEqual({ lines: ['T5 M6', 'G1 T5 (T1)', 'T10'], count: 2 });
  });

  it('replaces by condition', () => {
    const r = replaceInLines(['F100 S500', 'F300 S500'], fanuc, word('F>200'), 'F200');
    expect(r.lines).toEqual(['F100 S500', 'F200 S500']);
  });

  it('uses regex groups, $& and $$', () => {
    const q = parseQuery('X(\\d+)Y(\\d+)', fanuc, { ...WORD, wholeAddress: false, regex: true });
    if ('error' in q) throw new Error('parse');
    expect(replaceInLines(['G1 X10Y20', 'X1Y2 X3Y4'], fanuc, q, 'Y$2X$1').lines).toEqual(['G1 Y20X10', 'Y2X1 Y4X3']);
    expect(replaceInLines(['X10Y20'], fanuc, q, '[$&]$$$3').lines).toEqual(['[X10Y20]$$3']);
  });

  it('takes a literal replacement literally', () => {
    const q = parseQuery('G1', fanuc, { ...WORD, wholeAddress: false });
    if ('error' in q) throw new Error('parse');
    expect(replaceInLines(['G1 G1'], fanuc, q, '$1').lines).toEqual(['$1 $1']);
  });

  it('keeps comments out of a replace unless asked', () => {
    const q = parseQuery('X1', fanuc, { ...WORD, wholeAddress: false });
    if ('error' in q) throw new Error('parse');
    expect(replaceInLines(['X1 (X1)'], fanuc, q, 'X2').lines).toEqual(['X2 (X1)']);
  });

  it('replaces an assignment word whole when the query has a value', () => {
    expect(replaceInLines(['G1 SB=500 F10'], okuma, word('SB=500', okuma), 'SB=300').lines).toEqual(['G1 SB=300 F10']);
    expect(replaceInLines(['R1=5'], sinumerik, word('R1=5', sinumerik), 'R1=6').lines).toEqual(['R1=6']);
    expect(replaceInLines(['G1 X1'], fanuc, word('G1'), 'G2').lines).toEqual(['G2 X1']);
  });

  // Review NC-4: renaming an address used to throw every value away (`S1=1000` → `S2`).
  it('replaces the address alone and keeps the value when the query names none', () => {
    expect(replaceInLines(['S1=1000', 'S1=500 M1=3'], sinumerik, word('S1', sinumerik), 'S2').lines).toEqual(['S2=1000', 'S2=500 M1=3']);
    expect(replaceInLines(['R1=5'], sinumerik, word('R1=', sinumerik), 'R2').lines).toEqual(['R2=5']);
    expect(replaceInLines(['G1 SB=500 F10'], okuma, word('SB=', okuma), 'SA').lines).toEqual(['G1 SA=500 F10']);
    expect(replaceInLines(['G1 X10.', 'G1 X#1', 'G1 X 5.'], fanuc, word('X'), 'Y').lines).toEqual(['G1 Y10.', 'G1 Y#1', 'G1 Y 5.']);
    expect(replaceInLines(['X10.,R2.'], fanuc, word(',R'), ',C').lines).toEqual(['X10.,C2.']);
  });

  // Review NC-1: a Klartext `IX` is an incremental X, never an X.
  it('keeps a Klartext incremental axis apart from the absolute one', () => {
    const lines = ['5 L IX+10 Y+0', '6 L X+10'];
    expect(found(lines, 'X10', klartext)).toEqual(['X+10']);
    expect(found(lines, 'X', klartext)).toEqual(['X+10']);
    expect(found(lines, 'X>5', klartext)).toEqual(['X+10']);
    expect(found(lines, 'IX10', klartext)).toEqual(['IX+10']);
    expect(found(lines, 'IX', klartext)).toEqual(['IX+10']);
    expect(replaceInLines(['5 L IX+10'], klartext, word('X10', klartext), 'X+20').lines).toEqual(['5 L IX+10']);
    expect(replaceInLines(lines, klartext, word('IX10', klartext), 'IX+20').lines).toEqual(['5 L IX+20 Y+0', '6 L X+10']);
    expect(replaceInLines(lines, klartext, word('IX', klartext), 'IY').lines).toEqual(['5 L IY+10 Y+0', '6 L X+10']);
  });

  // Review NC-5: a parameter used inside a word is found and renamed with its definition.
  it('finds a parameter inside the value of a word, and renames it there', () => {
    const lines = ['  Q206=+150 ;FEED ~', '5 L X+Q206 FQ206', '5 Q206 = 5', '6 L X+Q2060'];
    expect(found(lines, 'Q206', klartext)).toEqual(['Q206', 'Q206', 'Q206', 'Q206']);
    expect(replaceInLines(lines, klartext, word('Q206', klartext), 'Q207').lines).toEqual([
      '  Q207=+150 ;FEED ~',
      '5 L X+Q207 FQ207',
      '5 Q207 = 5',
      '6 L X+Q2060',
    ]);
    expect(found(['X=R1', 'X=R1*2+R10', 'X=R10', 'MSG("R1")'], 'R1', sinumerik)).toEqual(['R1', 'R1']);
    expect(replaceInLines(['R1=5', 'G1 X=R1*2+R10'], sinumerik, word('R1', sinumerik), 'R2').lines).toEqual(['R2=5', 'G1 X=R2*2+R10']);
  });
});

describe('a regex replacement (review CODE-6, CODE-8)', () => {
  const regex = (t: string, inComments = false): SearchQuery => {
    const q = parseQuery(t, fanuc, { wholeAddress: false, regex: true, caseSensitive: false, inComments });
    if ('error' in q) throw new Error(q.error.key);
    return q;
  };

  it('leaves the blanks inside a comment alone unless asked', () => {
    expect(replaceInLines(['G1 X1 (A  B)  Y2'], fanuc, regex('\\s{2,}'), ' ').lines).toEqual(['G1 X1 (A  B) Y2']);
    expect(replaceInLines(['G1 X1 (A  B)  Y2'], fanuc, regex('\\s{2,}', true), ' ').lines).toEqual(['G1 X1 (A B) Y2']);
    expect(replaceInLines(['G1  X1 ; A  B'], sinumerik, regex('\\s{2,}'), ' ').lines).toEqual(['G1 X1 ; A  B']);
  });

  it('expands $10 and $<name> the JavaScript way', () => {
    expect(replaceInLines(['X5'], fanuc, regex('X(\\d)'), '$10').lines).toEqual(['X5'.replace(/X(\d)/, '$10')]);
    expect(replaceInLines(['X5'], fanuc, regex('X(\\d)'), '$10').lines).toEqual(['50']);
    expect(replaceInLines(['X5'], fanuc, regex('X(\\d)'), '$<n>').lines).toEqual(['$<n>']);
    expect(replaceInLines(['X5'], fanuc, regex('X(?<n>\\d)'), '$<n>$<m>').lines).toEqual(['5']);
    expect(replaceInLines(['X5'], fanuc, regex('X(\\d)'), '$2').lines).toEqual(['$2']);
  });
});

describe('wholeAddressRegex', () => {
  const matches = (re: string, text: string): string[] => [...text.matchAll(new RegExp(re, 'gi'))].map((m) => m[0]);

  it('is the corrected form of the plan', () => {
    expect(wholeAddressRegex('G', '1')).toBe('(?<![A-Z_])G\\+?0*1(?:\\.0*)?(?![\\d.])');
  });

  // Review NC-9.
  it('finds a signed positive value and nothing inside a name', () => {
    expect(matches(wholeAddressRegex('X', '10'), '5 L X+10 X10 IX+10 X+100')).toEqual(['X+10', 'X10']);
    expect(matches(wholeAddressRegex('G', '1'), 'MY_G1=5 N10G1X1')).toEqual(['G1']);
  });

  it('finds G1, G01, G1. and G1.0 and not G10, G1.5 or XG1', () => {
    expect(matches(wholeAddressRegex('G', '1'), 'G1 G01 G1. G1.0 G10 G1.5 XG1 g1')).toEqual(['G1', 'G01', 'G1.', 'G1.0', 'g1']);
  });

  it('takes a fraction, a zero, a sign and no value', () => {
    expect(matches(wholeAddressRegex('G', '84.2'), 'G84.2 G84.20 G84 G842')).toEqual(['G84.2', 'G84.20']);
    expect(matches(wholeAddressRegex('G', '0'), 'G0 G00 G0. G10 G01')).toEqual(['G0', 'G00', 'G0.']);
    expect(matches(wholeAddressRegex('X', '-5'), 'X-5 X-5. X5 X-50')).toEqual(['X-5', 'X-5.']);
    expect(matches(wholeAddressRegex('S', ''), 'S1000 SB=5 S#3 S-2.5')).toEqual(['S1000', 'S#3', 'S-2.5']);
  });
});

describe('the budget', () => {
  it('300k lines of a Fanuc program in a second', () => {
    const block = ['N10 G1 X10.5 Y20. F300', 'G0 Z5.', 'X-12.345 Y8.', '(COMMENT G1)', 'T1 M6', 'S12000 M3', 'G2 X5. Y5. I2. J0.', 'M98 P2000'];
    const lines = Array.from({ length: 300_000 }, (_, i) => block[i % block.length]);
    const q = word('T1');
    const started = performance.now();
    const r = findInLines(lines, fanuc, q, { max: Infinity, codes: CODES.fanuc });
    expectWithin(performance.now() - started, 1000, 'find T1 in 300k lines');
    expect(r.hits).toHaveLength(37_500);

    const text = parseQuery('g2 x', fanuc, { wholeAddress: false, regex: false, caseSensitive: false, inComments: false });
    if ('error' in text) throw new Error('parse');
    const started2 = performance.now();
    findInLines(lines, fanuc, text, { max: Infinity });
    expectWithin(performance.now() - started2, 1000, 'text find in 300k lines');

    const started3 = performance.now();
    const replaced = replaceInLines(lines, fanuc, q, 'T2');
    expectWithin(performance.now() - started3, 1000, 'replace T1 in 300k lines');
    expect(replaced.count).toBe(37_500);
  });
});
