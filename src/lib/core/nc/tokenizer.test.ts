// The NC tokenizer (plan §7.4, WP3.2).
//
// The goldens in `tests/fixtures/tokens/<profileId>.json` are the contract `gedit_nc.py`
// (§7.10) has to reproduce: one entry per line, the tokens without the whitespace ones,
// and each entry compared on the fields it lists. Everything below the goldens is about a
// rule that is easier to read as a sentence than as a fixture line.
//
// Every line in the goldens is synthetic: it was written for gEdit from the lexical rules
// in `docs/planning/syntax/syntax-fanuc.md` §3 and `syntax-heidenhain.md` §3, and none of
// it was copied from a control manual or from a customer program.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { blockNumberOf, tokenizeLine } from './tokenizer';
import type { LineState, NcToken } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);

interface GoldenEntry {
  line: string;
  prev?: LineState;
  tokens: Record<string, unknown>[];
  state?: LineState;
}

function golden(profileId: string): GoldenEntry[] {
  const path = fileURLToPath(new URL(`../../../../tests/fixtures/tokens/${profileId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as GoldenEntry[];
}

/** The tokens a golden entry describes: everything but whitespace. */
function code(tokens: NcToken[]): NcToken[] {
  return tokens.filter((token) => token.kind !== 'whitespace');
}

/** A short, readable dump of a line's tokens, used in failure messages. */
function dump(tokens: NcToken[]): string {
  return code(tokens)
    .map((token) => `${token.kind}:${token.text}${token.address === undefined ? '' : `[${token.address}]`}`)
    .join(' ');
}

describe.each([
  ['fanuc-gcode', fanuc],
  ['heidenhain-klartext', klartext],
])('%s goldens', (profileId, cp) => {
  const entries = golden(profileId);

  it('covers at least 60 lines', () => {
    expect(entries.length).toBeGreaterThanOrEqual(60);
  });

  it.each(entries.map((entry, i) => [`${i + 1}. ${JSON.stringify(entry.line)}`, entry] as const))('%s', (_name, entry) => {
    const { tokens, state } = tokenizeLine(entry.line, cp, entry.prev);
    const actual = code(tokens);
    expect(actual.length, dump(tokens)).toBe(entry.tokens.length);
    entry.tokens.forEach((want, i) => {
      const got = actual[i] as unknown as Record<string, unknown>;
      const projected: Record<string, unknown> = {};
      for (const key of Object.keys(want)) projected[key] = got[key];
      expect(projected, dump(tokens)).toEqual(want);
    });
    expect(state).toEqual(entry.state ?? { continuation: false });
  });

  // The comparison above reads only the fields an entry lists, which is what the Python
  // side does too (§7.10). This keeps our own file from going quiet about one of them.
  it('spells out every address, value and incremental flag', () => {
    for (const entry of entries) {
      const actual = code(tokenizeLine(entry.line, cp, entry.prev).tokens);
      actual.forEach((token, i) => {
        const listed = Object.keys(entry.tokens[i] ?? {});
        for (const key of ['address', 'valueText', 'incremental'] as const) {
          if (token[key] !== undefined) expect(listed, `${entry.line}: token ${i + 1}`).toContain(key);
        }
      });
    }
  });

  it.each(entries.map((entry) => entry.line))('tokens cover %j without a gap', (line) => {
    const { tokens } = tokenizeLine(line, cp, { continuation: false });
    let at = 0;
    for (const token of tokens) {
      expect(token.start, dump(tokens)).toBe(at);
      expect(token.end).toBeGreaterThan(token.start);
      expect(token.text).toBe(line.slice(token.start, token.end));
      at = token.end;
    }
    expect(at).toBe(line.length);
  });
});

describe('block numbers', () => {
  it('reads the N-prefix form, with or without a space and with leading zeros', () => {
    expect(blockNumberOf('N10G0', fanuc)).toEqual({ value: 10, text: '10', start: 0, end: 3 });
    expect(blockNumberOf('  N 120 X10.', fanuc)).toEqual({ value: 120, text: '120', start: 2, end: 7 });
    expect(blockNumberOf('n0010 G0', fanuc)).toEqual({ value: 10, text: '0010', start: 0, end: 5 });
  });

  it('reads a skip mark before or after the number', () => {
    expect(blockNumberOf('/1N90X0.', fanuc)).toMatchObject({ value: 90, start: 2, end: 5 });
    expect(blockNumberOf('/N100', fanuc)).toMatchObject({ value: 100, start: 1 });
    expect(blockNumberOf('N120/G0', fanuc)).toMatchObject({ value: 120, start: 0, end: 4 });
  });

  it('reads the leading integer of a Klartext block', () => {
    expect(blockNumberOf('0 BEGIN PGM TEST MM', klartext)).toEqual({ value: 0, text: '0', start: 0, end: 1 });
    expect(blockNumberOf('12 /L X+10', klartext)).toEqual({ value: 12, text: '12', start: 0, end: 2 });
    expect(blockNumberOf('7', klartext)).toEqual({ value: 7, text: '7', start: 0, end: 1 });
  });

  it('finds none where there is none', () => {
    expect(blockNumberOf('G0 X10.', fanuc)).toBeNull();
    expect(blockNumberOf('(N10 IN A COMMENT)', fanuc)).toBeNull();
    expect(blockNumberOf('', fanuc)).toBeNull();
    expect(blockNumberOf('   Q200=2', klartext)).toBeNull();
    // A leading integer needs the block behind it, so a bare value is not a block number.
    expect(blockNumberOf('12L X+10', klartext)).toBeNull();
    expect(blockNumberOf('N10', klartext)).toBeNull();
  });

  it('gives a span that covers the prefix, so a renumber can replace it', () => {
    const line = 'N120/G0X0Y0';
    const found = blockNumberOf(line, fanuc);
    expect(line.slice(found?.start, found?.end)).toBe('N120');
  });
});

describe('the packed dialect', () => {
  const tokens = (line: string): NcToken[] => code(tokenizeLine(line, fanuc).tokens);

  it('splits words that were written without a space', () => {
    expect(tokens('N10T1M6').map((t) => t.text)).toEqual(['N10', 'T1', 'M6']);
    expect(tokens('T3G43H3M6').map((t) => t.address)).toEqual(['T', 'G', 'H', 'M']);
  });

  it('allows whitespace between an address and its value but does not require it', () => {
    const [, x] = tokens('G0X 50 Z3');
    expect(x).toMatchObject({ address: 'X', valueText: '50', text: 'X 50' });
  });

  it('leaves an address without a value alone instead of eating the next word', () => {
    expect(tokens('X Y10.').map((t) => [t.address, t.valueText])).toEqual([
      ['X', undefined],
      ['Y', '10.'],
    ]);
  });

  it('parses the value into its written parts', () => {
    expect(tokens('X-0.5')[0].value).toEqual({ raw: '-0.5', sign: '-', intPart: '0', fracPart: '5', hasPoint: true });
    expect(tokens('F.15')[0].value).toMatchObject({ intPart: '', fracPart: '15' });
    expect(tokens('G54.1')[0].value).toMatchObject({ intPart: '54', fracPart: '1' });
  });

  it('reports a variable or an expression as a value without a number', () => {
    expect(tokens('Z-#101')[0]).toMatchObject({ address: 'Z', valueText: '-#101', value: null });
    expect(tokens('X[#1/2]')[0]).toMatchObject({ address: 'X', valueText: '[#1/2]', value: null });
  });

  it('reads macro keywords before the single-letter addresses they start with', () => {
    expect(tokens('GOTO100').map((t) => t.kind)).toEqual(['keyword']);
    expect(tokens('GOTO100')[0]).toMatchObject({ address: 'GOTO', valueText: '100' });
    expect(tokens('DO1')[0]).toMatchObject({ kind: 'keyword', address: 'DO' });
    expect(tokens('IF[#1EQ1]')[0]).toMatchObject({ kind: 'keyword', address: 'IF' });
    // An address is still an address when no keyword matches.
    expect(tokens('D1')[0]).toMatchObject({ kind: 'word', address: 'D' });
    expect(tokens('G0')[0]).toMatchObject({ kind: 'word', address: 'G' });
  });

  it('matches keywords and addresses whatever their case, and reports them upper case', () => {
    expect(tokens('n10 goto100').map((t) => [t.kind, t.address])).toEqual([
      ['blockNumber', 'N'],
      ['keyword', 'GOTO'],
    ]);
    expect(tokens('x10.')[0]).toMatchObject({ address: 'X', text: 'x10.' });
  });

  it('takes the comma of a drawing-input word with the address', () => {
    expect(tokens('X10.,R1.,C2.').map((t) => t.address)).toEqual(['X', ',R', ',C']);
  });

  it('ends a comment at the first closing parenthesis and runs an unclosed one to the line end', () => {
    expect(tokens('G1 (PLUNGE (NESTED?) )').map((t) => [t.kind, t.text])).toEqual([
      ['word', 'G1'],
      ['comment', '(PLUNGE (NESTED?)'],
      ['unknown', ')'],
    ]);
    expect(tokens('X10. (UNCLOSED').at(-1)).toMatchObject({ kind: 'comment', text: '(UNCLOSED' });
  });

  it('never carries a comment into the next line', () => {
    const first = tokenizeLine('(UNCLOSED', fanuc);
    expect(first.state).toEqual({ continuation: false });
    expect(code(tokenizeLine('G0X0', fanuc, first.state).tokens)[0]).toMatchObject({ kind: 'word' });
  });

  it('reads the tape marker and the program number at the head of a line only', () => {
    expect(tokens('%')[0]).toMatchObject({ kind: 'programMarker', text: '%' });
    expect(tokens('O1001 (BRACKET)')[0]).toMatchObject({ kind: 'programMarker', address: 'O', valueText: '1001' });
    expect(tokens(':1200')[0]).toMatchObject({ kind: 'programMarker', address: ':', valueText: '1200' });
    expect(tokens('G0X0 O1001').map((t) => t.kind)).toEqual(['word', 'word', 'word']);
  });

  it('reads a sign as an operator between two operands and as part of a value otherwise', () => {
    expect(tokens('#1=#2-5').map((t) => [t.kind, t.text])).toEqual([
      ['variable', '#1'],
      ['operator', '='],
      ['variable', '#2'],
      ['operator', '-'],
      ['word', '5'],
    ]);
    expect(tokens('#1= -5').at(-1)).toMatchObject({ kind: 'word', valueText: '-5' });
  });

  it('reads the indirect variable form as a variable and an expression', () => {
    expect(tokens('#[#1+1]=5').map((t) => [t.kind, t.text])).toEqual([
      ['variable', '#'],
      ['expression', '[#1+1]'],
      ['operator', '='],
      ['word', '5'],
    ]);
  });
});

describe('the dialect with separated words', () => {
  const tokens = (line: string, prev?: LineState): NcToken[] => code(tokenizeLine(line, klartext, prev).tokens);

  it('takes the longest multi-word keyword and allows any whitespace between the parts', () => {
    expect(tokens('0 BEGIN PGM TEST MM')[1]).toMatchObject({ kind: 'keyword', address: 'BEGIN PGM' });
    expect(tokens('5 TOOL  CALL 1 Z')[1]).toMatchObject({ kind: 'keyword', address: 'TOOL CALL', text: 'TOOL  CALL' });
    expect(tokens('6 CYCL CALL PAT F500')[1]).toMatchObject({ address: 'CYCL CALL PAT' });
    expect(tokens('7 FUNCTION RESET TCPM')[1]).toMatchObject({ address: 'FUNCTION RESET TCPM' });
  });

  it('reads a one-letter keyword only when whitespace or the line end follows', () => {
    expect(tokens('8 L X+10')[1]).toMatchObject({ kind: 'keyword', address: 'L' });
    expect(tokens('9 C X+50 DR-')[1]).toMatchObject({ kind: 'keyword', address: 'C' });
    // `C+45` is the C axis and `L+10` a tool length in TOOL DEF, not path functions.
    expect(tokens('10 L A+90 C+45').at(-1)).toMatchObject({ kind: 'word', address: 'C', valueText: '+45' });
    expect(tokens('11 TOOL DEF 5 L+10 R+3')[3]).toMatchObject({ kind: 'word', address: 'L', valueText: '+10' });
    // `LBL` has to win over `L`.
    expect(tokens('12 LBL 1')[1]).toMatchObject({ kind: 'keyword', address: 'LBL' });
  });

  it('splits a word at the shortest address whose value fills the rest of the word', () => {
    expect(tokens('13 L X+Q5 Y-QL2 FQ50 DR-0.02').map((t) => [t.address, t.valueText]).slice(2)).toEqual([
      ['X', '+Q5'],
      ['Y', '-QL2'],
      ['F', 'Q50'],
      ['DR', '-0.02'],
    ]);
    expect(tokens('14 LN X+0 NX+0.0000001')[2]).toMatchObject({ address: 'X' });
    expect(tokens('14 LN X+0 NX+0.0000001')[3]).toMatchObject({ address: 'NX', valueText: '+0.0000001' });
  });

  it('reads a rotation direction without a value and a delta radius with one', () => {
    expect(tokens('15 C X+50 DR-').at(-1)).toMatchObject({ address: 'DR', valueText: '-', value: null });
    expect(tokens('16 TOOL CALL 1 Z DR-0.02').at(-1)).toMatchObject({ address: 'DR', value: { sign: '-' } });
    // The delta radius of the second cutting edge takes its digit into the address.
    expect(tokens('17 TOOL CALL 1 Z DR2+0.05').at(-1)).toMatchObject({ address: 'DR2', valueText: '+0.05' });
  });

  it('takes the incremental prefix off a coordinate word and leaves a name alone', () => {
    expect(tokens('17 L IX+10 IY-20').slice(2)).toEqual([
      expect.objectContaining({ address: 'X', incremental: true, text: 'IX+10' }),
      expect.objectContaining({ address: 'Y', incremental: true, text: 'IY-20' }),
    ]);
    expect(tokens('18 CP IPA+360')[2]).toMatchObject({ address: 'PA', incremental: true });
    expect(tokens('0 BEGIN PGM INCHJOB INCH')[2]).toMatchObject({ address: 'INCHJOB' });
    expect(tokens('0 BEGIN PGM INCHJOB INCH')[2].incremental).toBeUndefined();
  });

  it('reads a tool name and a label name as strings', () => {
    expect(tokens('19 TOOL CALL "MILL_D10" Z S5000')[2]).toMatchObject({ kind: 'string', text: '"MILL_D10"' });
    expect(tokens('20 LBL "A"')[2]).toMatchObject({ kind: 'string', text: '"A"' });
  });

  it('reads Q parameters as variables and the rest of the assignment around them', () => {
    expect(tokens('   Q200=2', { continuation: true }).map((t) => [t.kind, t.text])).toEqual([
      ['variable', 'Q200'],
      ['operator', '='],
      ['word', '2'],
    ]);
    expect(tokens('21 FN 0: Q1 = +5').map((t) => t.kind)).toEqual([
      'blockNumber',
      'keyword',
      'word',
      'operator',
      'variable',
      'operator',
      'word',
    ]);
  });

  it('leaves the continuation marker outside the comment and hands it to the next line', () => {
    const first = tokenizeLine('22 CYCL DEF 200 DRILLING ~', klartext);
    expect(first.state).toEqual({ continuation: true });
    expect(code(first.tokens).at(-1)).toMatchObject({ kind: 'continuation', text: '~' });

    const second = tokenizeLine('   Q200=2 ;CLEARANCE ~', klartext, first.state);
    expect(code(second.tokens).map((t) => [t.kind, t.text])).toEqual([
      ['variable', 'Q200'],
      ['operator', '='],
      ['word', '2'],
      ['comment', ';CLEARANCE'],
      ['continuation', '~'],
    ]);
    expect(second.state).toEqual({ continuation: true });

    const third = tokenizeLine('   Q201=-15', klartext, second.state);
    expect(third.state).toEqual({ continuation: false });
  });

  it('gives a continuation line no block number', () => {
    const asBlock = tokenizeLine('23 L X+10', klartext, { continuation: false });
    expect(code(asBlock.tokens)[0].kind).toBe('blockNumber');
    const asTail = tokenizeLine('23 L X+10', klartext, { continuation: true });
    expect(code(asTail.tokens)[0].kind).not.toBe('blockNumber');
  });

  it('reads a structure block as a heading', () => {
    expect(tokens('24 * - ROUGHING')).toEqual([
      expect.objectContaining({ kind: 'blockNumber', text: '24' }),
      expect.objectContaining({ kind: 'comment', text: '* - ROUGHING' }),
    ]);
  });

  it('reads a block skip behind the block number', () => {
    expect(tokens('25 /L X+10').map((t) => t.kind)).toEqual(['blockNumber', 'skip', 'keyword', 'word']);
  });

  it('reads a word it cannot split as one unknown token, not as letter soup', () => {
    expect(tokens('26 CALL PGM TNC:\\SUB1.H').at(-1)).toMatchObject({ kind: 'unknown', text: 'TNC:\\SUB1.H' });
    expect(tokens('0 BEGIN PGM H01_3TOOLS MM')[2]).toMatchObject({ kind: 'unknown', text: 'H01_3TOOLS' });
  });
});

describe('tokenizeLine on lines that are not code', () => {
  it('returns nothing for an empty line and one token for whitespace', () => {
    expect(tokenizeLine('', fanuc).tokens).toEqual([]);
    expect(tokenizeLine('   ', fanuc).tokens).toEqual([{ kind: 'whitespace', start: 0, end: 3, text: '   ' }]);
  });

  it('never returns `invalid`, and marks what it cannot read as unknown', () => {
    const kinds = code(tokenizeLine('G0 $$$ X10.', fanuc).tokens).map((t) => t.kind);
    expect(kinds).toEqual(['word', 'unknown', 'word']);
    expect(code(tokenizeLine('G0 $$$ X10.', fanuc).tokens)[1].text).toBe('$$$');
  });

  it('defaults `prev` to a line that does not continue', () => {
    expect(tokenizeLine('0 BEGIN PGM TEST MM', klartext).tokens[0].kind).toBe('blockNumber');
  });
});

describe('performance', () => {
  function program(lines: number, source: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < lines; i++) out.push(source[i % source.length].replace('%N%', String((i % 9999) * 10)));
    return out;
  }

  const FANUC_SOURCE = [
    'N%N% G0 G90 X0. Y0.',
    'N%N%T1M6',
    'N%N% G43 Z25. H1 M8 (TOOL 1 - D10 END MILL)',
    'N%N%G1Z-1.F200.',
    'N%N% X50.123 Y-40.5 F1200.',
    'N%N%G98G81X10.Y10.Z-5.R2.F200.',
    '/N%N% #101=[#1+2.]',
    'N%N% IF[#101GT10.]GOTO100',
    'N%N%G0Z25.M9',
    '',
  ];
  const KLARTEXT_SOURCE = [
    '%N% L X+50.123 Y-40.5 Z+10 R0 FMAX M3',
    '%N% TOOL CALL 1 Z S3000 F800 ; D10 END MILL',
    '%N% CYCL DEF 200 DRILLING ~',
    '   Q200=2 ;CLEARANCE ~',
    '   Q201=-15 ;DEPTH',
    '%N% CC X+0 Y+0',
    '%N% C X+50 Y+0 DR-',
    '%N% L IX+10 IY-20 F500',
    '%N% * - ROUGHING',
    '',
  ];

  it.each([
    ['fanuc-gcode', fanuc, FANUC_SOURCE],
    ['heidenhain-klartext', klartext, KLARTEXT_SOURCE],
  ])('tokenizes 300k lines of %s in well under a second', (_id, cp: CompiledProfile, source: string[]) => {
    const lines = program(300_000, source);
    let state: LineState | undefined;
    let tokens = 0;

    const started = performance.now();
    for (const line of lines) {
      const result = tokenizeLine(line, cp, state);
      state = result.state;
      tokens += result.tokens.length;
    }
    const ms = performance.now() - started;

    expect(tokens).toBeGreaterThan(300_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 300k lines`).toBeLessThan(3000);
  });

  // A word-separated profile used to ask for the end of the chunk once per character, so
  // a long run of characters that never parses as a value was quadratic: 32k characters
  // of `+-` took 2.2 s, and hover tokenizes a line on every mouse move. The budget below
  // is three orders of magnitude above what the linear scan costs, so it says nothing
  // about the machine and everything about the algorithm.
  it('stays linear on a long line that parses as nothing', () => {
    const lengths = [4000, 8000, 16000, 32000];
    const ms: number[] = [];
    for (const length of lengths) {
      const line = '+-'.repeat(length / 2);
      const started = performance.now();
      const { tokens } = tokenizeLine(line, klartext);
      ms.push(performance.now() - started);
      expect(tokens.length, `${length} characters`).toBe(length);
    }
    const worst = Math.max(...ms);
    expect(worst, `${lengths.map((n, i) => `${n}: ${ms[i].toFixed(1)} ms`).join(', ')}`).toBeLessThan(250);
  });
});
