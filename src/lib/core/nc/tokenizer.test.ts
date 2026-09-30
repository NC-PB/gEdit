// The NC tokenizer (plan §7.4, WP3.2).
//
// The goldens in `tests/fixtures/tokens/<profileId>.json` are the contract `gedit_nc.py`
// (§7.10) has to reproduce: one entry per line, the tokens without the whitespace ones,
// and each entry compared on the fields it lists. Everything below the goldens is about a
// rule that is easier to read as a sentence than as a fixture line.
//
// Every line in the goldens is synthetic: it was written for gEdit from the lexical rules
// in `docs/planning/syntax/syntax-fanuc.md` §3, `syntax-heidenhain.md` §3, and for the
// turning dialects `syntax-okuma.md` §3 and `syntax-sinumerik.md` §3; none of it was
// copied from a control manual or from a customer program.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import okumaJson from '$lib/data/profiles/okuma-osp.json';
import sinumerikJson from '$lib/data/profiles/sinumerik.json';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { blockNumberOf, tokenizeLine } from './tokenizer';
import type { LineState, NcToken } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);
const okuma = compileProfile(okumaJson as unknown as Profile);
const sinumerik = compileProfile(sinumerikJson as unknown as Profile);
// The lathe is a child profile (AD-16), so it is compiled from the **resolved** list:
// its own file says only what differs from the mill.
const lathe = compileProfile(
  (BUILTIN_PROFILE_JSON.find((raw) => (raw as Profile).id === 'fanuc-lathe') ?? {}) as Profile,
);

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
  // M6: the lathe inherits the mill's whole `syntax`, so it tokenizes the same lines the
  // same way. WP6.2 replaces this golden with lathe lines (`T0101`, `U`/`W`, `G96 S`).
  ['fanuc-lathe', lathe],
  ['heidenhain-klartext', klartext],
  // M8: the two turning dialects. Their goldens are also what `_nc_lex.py` is held to
  // (WP8.6), and the two above them are the regression gate for the opt-in fields of
  // AD-24: every one of those is off on the Fanuc and Klartext profiles, so their lines
  // have to come back exactly as they did in M3.
  ['okuma-osp', okuma],
  ['sinumerik', sinumerik],
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

  // M8 integration: `/0` is the level `/` stands for on a Sinumerik control, and read as
  // `/` plus a value it left the block number behind it unread, so a renumber would have
  // put a second number in front of the block.
  it('takes level 0 as a skip level, so the number behind it is still the block number', () => {
    expect(blockNumberOf('/0 N10 G0 X10', sinumerik)).toMatchObject({ value: 10, start: 3, end: 6 });
    expect(code(tokenizeLine('/0 N10 G0 X10', sinumerik).tokens).map((token) => [token.kind, token.text])).toEqual([
      ['skip', '/0'],
      ['blockNumber', 'N10'],
      ['word', 'G0'],
      ['word', 'X10'],
    ]);
    expect(blockNumberOf('/9 N20 G0', sinumerik)).toMatchObject({ value: 20 });
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

// ---------------------------------------------------------------------------
// P8, AD-24: the six opt-in `syntax` fields. Every test below names the rule, not the
// control: the tokenizer is driven by the profile, and the two dialects only happen to be
// the first that switch these fields on.
// ---------------------------------------------------------------------------

describe('a dialect that names its blocks (`sequenceNames`)', () => {
  const tokens = (line: string): NcToken[] => code(tokenizeLine(line, okuma).tokens);

  it('reads the prefix with a name behind it as a label and reports the name', () => {
    expect(tokens('NLAP1 G85')[0]).toMatchObject({ kind: 'label', text: 'NLAP1', address: 'LAP1' });
    expect(tokens('nlap1 g85')[0]).toMatchObject({ kind: 'label', address: 'LAP1' });
    expect(tokens('NT01 G00 X100')[0]).toMatchObject({ kind: 'label', address: 'T01' });
  });

  it('keeps the prefix with digits behind it a block number', () => {
    expect(tokens('N0010 G00 X400')[0]).toMatchObject({ kind: 'blockNumber', address: 'N', valueText: '0010' });
  });

  // The control insists on a separator behind the name, and so does this rule: without
  // one there is no way to tell a name from packed words. Four characters is what the
  // control accepts, so a longer run is not a name either.
  it('needs a separator behind the name, and takes at most four characters', () => {
    expect(tokens('NLAP1G85').every((token) => token.kind !== 'label')).toBe(true);
    expect(tokens('NTOOLING G00').every((token) => token.kind !== 'label')).toBe(true);
    expect(tokens('NLAP1')[0]).toMatchObject({ kind: 'label', address: 'LAP1' });
  });

  it('reads a name behind a jump as one label and a number behind one as a word', () => {
    expect(tokens('GOTO NLAP1').map((token) => token.kind)).toEqual(['keyword', 'label']);
    expect(tokens('GOTO N200').map((token) => [token.kind, token.address])).toEqual([
      ['keyword', 'GOTO'],
      ['word', 'N'],
    ]);
    // Letter by letter a name would turn into words a script acts on: `NFED1` would hand
    // `scale_feed` a feed of 1.
    expect(tokens('GOTO NFED1')).toHaveLength(2);
    expect(tokens('GOTO NFED1')[1]).toMatchObject({ kind: 'label', address: 'FED1' });
    // Away from the head a name needs whitespace in front of it, or the `NG` inside a
    // packed word would become one.
    expect(tokens('X10NLAP1 G85').every((token) => token.kind !== 'label')).toBe(true);
  });

  it('never offers a name as a block number, so a renumber leaves it alone', () => {
    expect(blockNumberOf('NLAP1 G85', okuma)).toBeNull();
    expect(blockNumberOf('/NLAP1 G85', okuma)).toBeNull();
    expect(blockNumberOf('N0010 G00', okuma)).toMatchObject({ value: 10, text: '0010' });
  });

  // The control takes the skip at the start of the block or directly behind the name,
  // and nowhere else.
  it('reads the block skip in front of a name and behind one', () => {
    expect(tokens('/NLAP1 G85').map((token) => token.kind)).toEqual(['skip', 'label', 'word']);
    expect(tokens('NLAP1 /G00 X400').map((token) => token.kind)).toEqual(['label', 'skip', 'word', 'word']);
  });
});

describe('a dialect that labels its blocks (`labels`)', () => {
  const tokens = (line: string): NcToken[] => code(tokenizeLine(line, sinumerik).tokens);

  it('reads a label definition at the head of a block and reports the bare name', () => {
    expect(tokens('LOOP_A:')[0]).toMatchObject({ kind: 'label', text: 'LOOP_A:', address: 'LOOP_A' });
    expect(tokens('LOOP_A: G1 X10').map((token) => token.kind)).toEqual(['label', 'word', 'word']);
  });

  // A label may start with the block-number prefix, which is why the label rule runs in
  // front of the block-number rule — and once more behind a block number.
  it('tells a label that starts with the prefix from a block number', () => {
    expect(tokens('NEXT_PART: G0 X5')[0]).toMatchObject({ kind: 'label', address: 'NEXT_PART' });
    expect(blockNumberOf('NEXT_PART: G0 X5', sinumerik)).toBeNull();
    expect(tokens('N10 LOOP_A: G1 X10').map((token) => token.kind)).toEqual(['blockNumber', 'label', 'word', 'word']);
    expect(tokens('/1 N20 NEXT_PART: G0 X5').map((token) => token.kind)).toEqual(['skip', 'blockNumber', 'label', 'word', 'word']);
    // The block number on a labelled block is still a block number a renumber rewrites.
    expect(blockNumberOf('N10 LOOP_A: G1 X10', sinumerik)).toMatchObject({ value: 10, start: 0, end: 3 });
  });

  it('leaves an assignment alone, because `:=` is not a label', () => {
    expect(tokens('R1=5')[0]).toMatchObject({ kind: 'variable', text: 'R1' });
    expect(tokens('X=10')[0]).toMatchObject({ kind: 'word', address: 'X', valueText: '10' });
  });
});

describe('an identifier in front of brackets (`calls`)', () => {
  const tokens = (line: string): NcToken[] => code(tokenizeLine(line, sinumerik).tokens);

  it('reads the call and its arguments as one token and does not look inside', () => {
    expect(tokens('CYCLE83(50,0,2,-25,,-5)')).toEqual([
      expect.objectContaining({ kind: 'call', address: 'CYCLE83', valueText: '50,0,2,-25,,-5' }),
    ]);
    expect(tokens('L10(1)')[0]).toMatchObject({ kind: 'call', address: 'L10', valueText: '1' });
    expect(tokens('MCALL CYCLE83(10,0,2,-12)').map((token) => token.kind)).toEqual(['keyword', 'call']);
  });

  it('keeps a comment marker that stands inside a string of the arguments', () => {
    expect(tokens('MSG("ROUGH;FINISH")')).toEqual([
      expect.objectContaining({ kind: 'call', address: 'MSG', valueText: '"ROUGH;FINISH"' }),
    ]);
    expect(tokens('MSG("A;B") ;NOTE').map((token) => token.kind)).toEqual(['call', 'comment']);
  });

  // An unclosed bracket may not swallow a comment: the mask blanks the comment either
  // way, and the two have to agree on every line (`mask.test.ts`).
  it('ends an unclosed argument list where a comment begins', () => {
    expect(tokens('MSG(A;B').map((token) => [token.kind, token.text])).toEqual([
      ['call', 'MSG(A'],
      ['comment', ';B'],
    ]);
  });

  it('leaves a keyword the profile declares a keyword', () => {
    expect(tokens('IF(R1==1)')[0]).toMatchObject({ kind: 'keyword', address: 'IF' });
    expect(tokens('SETMS(3)')[0]).toMatchObject({ kind: 'call', address: 'SETMS' });
  });

  it('reports the call with no value when it has no arguments', () => {
    expect(tokens('SETMS()')[0]).toMatchObject({ kind: 'call', address: 'SETMS' });
    expect(tokens('SETMS()')[0].valueText).toBeUndefined();
  });

  // G8 M8 review: the control reads a name and its argument list with blanks between them
  // as the same call, and the grammar and the detection rules did too. The tokenizers did
  // not: `CYCLE840 (…)` came out as a name and loose values, and the tapping cycle was one
  // no script saw — its feed was scaled without a word.
  it('reads a name with blanks in front of its bracket as the same call', () => {
    expect(tokens('N60 CYCLE840 (5,0,2,-15,,0.5,3,3,1,,1.5)')).toEqual([
      expect.objectContaining({ kind: 'blockNumber', text: 'N60' }),
      expect.objectContaining({
        kind: 'call',
        text: 'CYCLE840 (5,0,2,-15,,0.5,3,3,1,,1.5)',
        address: 'CYCLE840',
        valueText: '5,0,2,-15,,0.5,3,3,1,,1.5',
      }),
    ]);
    expect(tokens('N20 MSG ("A;B")').map((token) => token.kind)).toEqual(['blockNumber', 'call']);
    expect(tokens('MSG\t("A;B") ;NOTE').map((token) => token.kind)).toEqual(['call', 'comment']);
    // The value behind an `=` is read the same way.
    expect(tokens('X=AC (10)')[0]).toMatchObject({ kind: 'word', address: 'X', valueText: 'AC (10)' });
    // A declared keyword is still a keyword, bracket or not.
    expect(tokens('IF (R1==1)')[0]).toMatchObject({ kind: 'keyword', address: 'IF' });
  });

  // A letter with a number is an address word. It is a call only with its bracket touching
  // it (`L10(1)`), so `M30 (END)` in a program written for a control that reads `( … )` as
  // a comment stays the M30 it says, and is not a call of a program named `M30`.
  it('keeps a letter and a number the word it is when a blank stands before the bracket', () => {
    expect(tokens('N90 M30 (END)').map((token) => [token.kind, token.text])).toEqual([
      ['blockNumber', 'N90'],
      ['word', 'M30'],
      ['operator', '('],
      ['unknown', 'END'],
      ['operator', ')'],
    ]);
    expect(tokens('L10(1)')[0]).toMatchObject({ kind: 'call', address: 'L10', valueText: '1' });
    expect(tokens('L10 (1)')[0]).toMatchObject({ kind: 'word', address: 'L', valueText: '10' });
  });
});

describe('an address that takes `=` and an expression (`assignment`)', () => {
  const okumaTokens = (line: string): NcToken[] => code(tokenizeLine(line, okuma).tokens);
  const siemensTokens = (line: string): NcToken[] => code(tokenizeLine(line, sinumerik).tokens);

  it('keeps the token a word: the address in front of the `=`, the value behind it', () => {
    expect(okumaTokens('SB=1200 M13')[0]).toMatchObject({ kind: 'word', address: 'SB', valueText: '1200' });
    expect(siemensTokens('CR=15')[0]).toMatchObject({ kind: 'word', address: 'CR', valueText: '15' });
    expect(siemensTokens('LIMS=3000')[0]).toMatchObject({ kind: 'word', address: 'LIMS', valueText: '3000' });
  });

  it('reads the extension as part of the address, so a second spindle is not the first', () => {
    expect(siemensTokens('G26 S3=2500')[1]).toMatchObject({ address: 'S3', valueText: '2500' });
    expect(siemensTokens('S3000')[0]).toMatchObject({ address: 'S', valueText: '3000' });
    expect(okumaTokens('SB=1200')[0].address).toBe('SB');
    expect(okumaTokens('S1200')[0].address).toBe('S');
  });

  it('allows whitespace around the `=`', () => {
    expect(okumaTokens('SB = 1200')[0]).toMatchObject({ address: 'SB', valueText: '1200', text: 'SB = 1200' });
  });

  // G8 M8 review: a block pasted from a word processor can carry a no-break space in front
  // of the `=`. It is whitespace to the tokenizer, so `S3` is another spindle's address —
  // and `gedit_nc` has to read it the same way, or a script scales it as the main
  // spindle's `S3` and writes `S2` (the golden line of `tokens/sinumerik.json`).
  it('reads a no-break space in front of the `=` as whitespace', () => {
    expect(siemensTokens('N20 S3\u00a0=2500 M3=3').slice(1)).toEqual([
      expect.objectContaining({ kind: 'word', address: 'S3', valueText: '2500' }),
      expect.objectContaining({ kind: 'word', address: 'M3', valueText: '3' }),
    ]);
    expect(okumaTokens('SB\u00a0=1200 M13')[0]).toMatchObject({ kind: 'word', address: 'SB', valueText: '1200' });
  });

  // The address is the whole identifier in front of the `=`, and the pattern only decides
  // which identifiers take one: it is asked where an identifier has an `=` behind it, and
  // nowhere inside a run of packed words (which is what keeps such a run linear, below).
  it('takes the whole identifier in front of the `=` as the address', () => {
    expect(siemensTokens('XNOW=62')[0]).toMatchObject({ kind: 'word', address: 'XNOW', valueText: '62' });
    expect(siemensTokens('G1 X1=5')[1]).toMatchObject({ kind: 'word', address: 'X1', valueText: '5' });
    // Okuma's pattern takes at most four characters, so a longer name takes no `=`.
    expect(okumaTokens('DIAMETER=5').map((token) => [token.kind, token.text])).toEqual([
      ['unknown', 'DIAMETER'],
      ['operator', '='],
      ['word', '5'],
    ]);
  });

  // This is the case that matters for everything that computes with NC numbers: a value
  // that is not a literal has to be null, or a transform would scale the text.
  it('gives a value only when the whole right-hand side is a number', () => {
    expect(okumaTokens('SB=1200')[0].value).toMatchObject({ raw: '1200', hasPoint: false });
    expect(okumaTokens('DA=1.5')[0].value).toMatchObject({ raw: '1.5', fracPart: '5' });
    expect(okumaTokens('X=V1+V2')[0]).toMatchObject({ address: 'X', valueText: 'V1+V2', value: null });
    expect(okumaTokens('F=V10')[0]).toMatchObject({ address: 'F', valueText: 'V10', value: null });
    expect(siemensTokens('F=R10*2')[0]).toMatchObject({ address: 'F', valueText: 'R10*2', value: null });
  });

  it('takes a string, a bracket expression and a call whole, whitespace included', () => {
    expect(siemensTokens('T="DRILL_D8" D1')[0]).toMatchObject({ address: 'T', valueText: '"DRILL_D8"', value: null });
    expect(siemensTokens('X=AC(10)')[0]).toMatchObject({ address: 'X', valueText: 'AC(10)' });
    expect(siemensTokens('X=AC(10, 5)')[0]).toMatchObject({ address: 'X', valueText: 'AC(10, 5)' });
    expect(okumaTokens('X=SIN[30]')[0]).toMatchObject({ address: 'X', valueText: 'SIN[30]' });
    expect(okumaTokens('X=[V1 + 2]')[0]).toMatchObject({ address: 'X', valueText: '[V1 + 2]' });
  });

  it('stops at the end of the word and never reads into a comment', () => {
    expect(okumaTokens('G00 X=V1 (MOVE) Z=V2').map((token) => token.kind)).toEqual(['word', 'word', 'comment', 'word']);
    expect(okumaTokens('X= (SET LATER)')[0]).toMatchObject({ address: 'X', text: 'X=' });
    expect(okumaTokens('X= (SET LATER)')[0].valueText).toBeUndefined();
    expect(okumaTokens('X=')[0]).toMatchObject({ kind: 'word', address: 'X', text: 'X=' });
  });

  // Both dialects propose the same order for themselves: the variable rule runs first, so
  // a parameter that is written stays a parameter instead of becoming an address the code
  // database has never heard of — the shape Fanuc `#1=#2-5` and Klartext `Q200=2` have.
  it('leaves a variable a variable', () => {
    expect(siemensTokens('R1=R2*2').map((token) => [token.kind, token.text])).toEqual([
      ['variable', 'R1'],
      ['operator', '='],
      ['variable', 'R2'],
      ['operator', '*'],
      ['word', '2'],
    ]);
    expect(okumaTokens('V5=V5+1')[0]).toMatchObject({ kind: 'variable', text: 'V5' });
  });

  // Without the `=` the letters are not an address: `CR15` is not a radius of 15. Nor is
  // it the C axis at `R15` — a value that is not a plain number needs the `=` (`C=R15`) —
  // so on a profile that declares `names` it is a name, one token (M8 integration).
  it('does not fire without an `=`, and not on `==`', () => {
    expect(siemensTokens('CR15')).toEqual([expect.objectContaining({ kind: 'unknown', text: 'CR15' })]);
    expect(siemensTokens('IF R1==1 GOTOF N10')[2]).toMatchObject({ kind: 'operator', text: '=' });
  });
});

// M8 integration (§7.16): `syntax.names`, the seventh opt-in field.
describe('a name the program gives itself (`names`)', () => {
  const siemens = (line: string): NcToken[] => code(tokenizeLine(line, sinumerik).tokens);
  const osp = (line: string): NcToken[] => code(tokenizeLine(line, okuma).tokens);
  const shape = (tokens: NcToken[]): string[][] => tokens.map((token) => [token.kind, token.text]);

  // Letter by letter `XNOW` is an X word and `PASS2` an S word of 2: a hover explained
  // them as an axis and a speed, and "insert spaces" pulled them apart into `X N O W`.
  it('reads a name as one token, never as a run of one-letter words', () => {
    expect(shape(siemens('N70 IF XNOW<=XBOT GOTOF LAST_CUT'))).toEqual([
      ['blockNumber', 'N70'],
      ['keyword', 'IF'],
      ['unknown', 'XNOW'],
      ['operator', '<'],
      ['operator', '='],
      ['unknown', 'XBOT'],
      ['keyword', 'GOTOF'],
      ['unknown', 'LAST_CUT'],
    ]);
    expect(shape(siemens('DEF REAL XNOW'))).toEqual([
      ['keyword', 'DEF'],
      ['keyword', 'REAL'],
      ['unknown', 'XNOW'],
    ]);
    expect(shape(siemens('GOTOF PASS2'))).toEqual([
      ['keyword', 'GOTOF'],
      ['unknown', 'PASS2'],
    ]);
    expect(shape(osp('V1=DIA1*2'))).toEqual([
      ['variable', 'V1'],
      ['operator', '='],
      ['unknown', 'DIA1'],
      ['operator', '*'],
      ['word', '2'],
    ]);
    expect(shape(osp('V1=SIN[30]*2'))).toEqual([
      ['variable', 'V1'],
      ['operator', '='],
      ['unknown', 'SIN'],
      ['expression', '[30]'],
      ['operator', '*'],
      ['word', '2'],
    ]);
  });

  // `LOOP_N2` read as `LOOP` + `_` + `N2` handed a renumber a block number that is part of
  // a label, and `LOOP` became a keyword in the middle of a name.
  it('leaves no keyword and no block number inside a name', () => {
    expect(shape(siemens('GOTOB LOOP_N2'))).toEqual([
      ['keyword', 'GOTOB'],
      ['unknown', 'LOOP_N2'],
    ]);
    expect(siemens('LOOP')[0]).toMatchObject({ kind: 'keyword', address: 'LOOP' });
    expect(siemens('DIAM90')[0]).toMatchObject({ kind: 'keyword', address: 'DIAM90' });
    expect(siemens('IF(R1==1)')[0]).toMatchObject({ kind: 'keyword', address: 'IF' });
    expect(osp('IF[V1 EQ 5] GOTO N10').map((token) => token.kind)).toEqual(['keyword', 'expression', 'keyword', 'word']);
  });

  it('leaves one letter with a number a word, so packed code still splits', () => {
    expect(shape(siemens('N10G18G90G95 DIAMON'))).toEqual([
      ['blockNumber', 'N10'],
      ['word', 'G18'],
      ['word', 'G90'],
      ['word', 'G95'],
      ['keyword', 'DIAMON'],
    ]);
    expect(shape(siemens('T1D1 M3S1000'))).toEqual([
      ['word', 'T1'],
      ['word', 'D1'],
      ['word', 'M3'],
      ['word', 'S1000'],
    ]);
    expect(shape(osp('G00X50Z150'))).toEqual([
      ['word', 'G00'],
      ['word', 'X50'],
      ['word', 'Z150'],
    ]);
    expect(siemens('L20')[0]).toMatchObject({ kind: 'word', address: 'L', valueText: '20' });
    expect(siemens('R10')[0]).toMatchObject({ kind: 'variable', text: 'R10' });
  });

  it('gives every other rule its turn first', () => {
    expect(siemens('XNOW=62')[0]).toMatchObject({ kind: 'word', address: 'XNOW', valueText: '62' });
    expect(siemens('PROBE_DIA(1,,3)')[0]).toMatchObject({ kind: 'call', address: 'PROBE_DIA' });
    expect(siemens('LAST_CUT:')[0]).toMatchObject({ kind: 'label', address: 'LAST_CUT' });
    expect(siemens('$AA_IM[X]')[0]).toMatchObject({ kind: 'variable', text: '$AA_IM' });
    expect(osp('NLAP1 G85')[0]).toMatchObject({ kind: 'label', address: 'LAP1' });
    expect(osp('GOTO NLOOP')[1]).toMatchObject({ kind: 'label', address: 'LOOP' });
    expect(osp('VZOFZ=10.')[0]).toMatchObject({ kind: 'variable', text: 'VZOFZ' });
    expect(osp('O1234')[0]).toMatchObject({ kind: 'programMarker', text: 'O1234' });
  });

  it('reads a name as an operand, so a sign behind it subtracts', () => {
    expect(shape(siemens('IF XNOW-2>0 GOTOF LAST_CUT')).slice(1, 5)).toEqual([
      ['unknown', 'XNOW'],
      ['operator', '-'],
      ['word', '2'],
      ['operator', '>'],
    ]);
  });

  it('matches whatever the case', () => {
    expect(siemens('gotof last_cut')[1]).toMatchObject({ kind: 'unknown', text: 'last_cut' });
  });
});

describe('system variables and file headers', () => {
  it('reads a system variable before an ordinary one', () => {
    expect(code(tokenizeLine('VZOFZ=10.', okuma).tokens).map((token) => [token.kind, token.text])).toEqual([
      ['variable', 'VZOFZ'],
      ['operator', '='],
      ['word', '10.'],
    ]);
    expect(code(tokenizeLine('V5', okuma).tokens)[0]).toMatchObject({ kind: 'variable', text: 'V5' });
    expect(code(tokenizeLine('$AA_IM[X]', sinumerik).tokens).map((token) => [token.kind, token.text])).toEqual([
      ['variable', '$AA_IM'],
      ['expression', '[X]'],
    ]);
  });

  it('reads the file header as one program marker and not as a tape marker', () => {
    expect(code(tokenizeLine('$FLANGE.MIN%', okuma).tokens)).toEqual([
      expect.objectContaining({ kind: 'programMarker', text: '$FLANGE.MIN%' }),
    ]);
    expect(code(tokenizeLine('%_N_PART_MPF', sinumerik).tokens)).toEqual([
      expect.objectContaining({ kind: 'programMarker', text: '%_N_PART_MPF' }),
    ]);
    // A header carries no address and no value: the program's name is `program.start`'s
    // answer, and reading `$FLANGE` as an address would invent one.
    expect(code(tokenizeLine('$FLANGE.MIN%', okuma).tokens)[0].address).toBeUndefined();
  });

  it('reads a bare tape marker where there is no header', () => {
    expect(code(tokenizeLine('%', okuma).tokens)[0]).toMatchObject({ kind: 'programMarker', text: '%' });
    expect(code(tokenizeLine('%', sinumerik).tokens)[0]).toMatchObject({ kind: 'programMarker', text: '%' });
  });

  it('reads a header only at the head of a line', () => {
    const tokens = code(tokenizeLine('G00 X10 $A.MIN%', okuma).tokens);
    expect(tokens.every((token) => token.kind !== 'programMarker')).toBe(true);
  });
});

describe('the new fields are opt-in', () => {
  it.each([
    ['fanuc-gcode', fanuc],
    ['heidenhain-klartext', klartext],
  ])('%s declares none of them and its spec stays as it was', (_id, cp: CompiledProfile) => {
    expect(cp.profile.syntax.sequenceNames).toBeUndefined();
    expect(cp.profile.syntax.labels).toBeUndefined();
    expect(cp.profile.syntax.calls).toBeUndefined();
    expect(cp.profile.syntax.assignment).toBeUndefined();
    expect(cp.profile.syntax.systemVariables).toBeUndefined();
    expect(cp.profile.syntax.header).toBeUndefined();
    expect(cp.profile.syntax.names).toBeUndefined();
  });

  it('never produces a label or a call for a profile that declares neither', () => {
    const lines = ['N10 G0 X10.', 'NLAP1 G85', 'LOOP_A: G1 X10', 'CYCLE83(10,0)', 'SB=1200', '$FLANGE.MIN%'];
    for (const cp of [fanuc, klartext]) {
      for (const line of lines) {
        const kinds = code(tokenizeLine(line, cp).tokens).map((token) => token.kind);
        expect(kinds, `${line}`).not.toContain('label');
        expect(kinds, `${line}`).not.toContain('call');
      }
    }
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

// G8 M8 review (WP8.6's open item): a `variables` or `systemVariables` pattern that can
// match the empty string pushed a token of no characters and left the scanner where it
// was, so the first line tokenized hung the editor. `validate.ts` refuses such a pattern
// now (from M12 a user profile can carry one); the tokenizer does not rely on that.
describe('a variable pattern that can match nothing', () => {
  const loose = compileProfile({
    ...sinumerikJson,
    syntax: { ...sinumerikJson.syntax, systemVariables: '\\$?[A-Z_]*', variables: 'R?\\d*' },
  } as unknown as Profile);

  it.each(['N10 G1 X10 F0.2', '$AA_IM[X]', 'R1=R2*2', 'G0 ;TEXT', '(', ''])('reads %j to its end', (line) => {
    const { tokens } = tokenizeLine(line, loose);
    let at = 0;
    for (const token of tokens) {
      expect(token.end, dump(tokens)).toBeGreaterThan(token.start);
      expect(token.start).toBe(at);
      at = token.end;
    }
    expect(at).toBe(line.length);
  });

  it('still reads what the pattern does match', () => {
    expect(code(tokenizeLine('$AA_IM[X]', loose).tokens)[0]).toMatchObject({ kind: 'variable', text: '$AA_IM' });
    // Where the pattern matches nothing the rules behind it have their turn, and a bare
    // number is a variable to it: the reason `validate.ts` refuses such a pattern.
    expect(code(tokenizeLine('(1)', loose).tokens).map((token) => token.kind)).toEqual(['operator', 'variable', 'operator']);
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

  // The turning dialects run more rules per token than the two above (a label pattern per
  // line, a system-variable and an assignment probe per token), so they carry their own
  // 300k-line budget: the opt-in fields may not cost a second.
  const OKUMA_SOURCE = [
    'N%N% G00 X400 Z300',
    'NLAP1 G85 (BAR TURNING)',
    'N%N% G96 S180 M03',
    'N%N% T0202 (55 DEG INSERT)',
    'N%N% G01 X56.123 Z-40.5 F0.28',
    'N%N% SB=1200 M13',
    'N%N% X=V1+V2 Z=V3',
    '/N%N% IF [V1 EQ 5] GOTO NLAP1',
    'N%N% G04 F2',
    '',
  ];
  const SINUMERIK_SOURCE = [
    'N%N% G18 G95 G90',
    'N%N% T="DRILL_D8" D1',
    'N%N% MSG("ROUGH;FINISH")',
    'N%N% CYCLE83(50,0,2,-25,,-5)',
    'N%N% G1 X56.123 Z-40.5 F0.28 ;CUT',
    'N%N% G26 S3=2500 LIMS=3000',
    'N%N% R1=R2*2 X=AC(10)',
    'LOOP_A: G0 X200 Z200',
    '/1 N%N% $AA_IM[X]',
    '',
  ];

  it.each([
    ['fanuc-gcode', fanuc, FANUC_SOURCE],
    ['heidenhain-klartext', klartext, KLARTEXT_SOURCE],
    ['okuma-osp', okuma, OKUMA_SOURCE],
    ['sinumerik', sinumerik, SINUMERIK_SOURCE],
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

  // G8 M8 review: the same class of cost in a packed dialect. `p` stops at every letter of
  // `G1X1G1X1…`, and the call and the assignment rules each read to the end of the run from
  // there: 32k characters took over three seconds on Sinumerik. The budget is the one
  // above, and the shapes are the runs that no rule takes whole.
  it.each([
    ['G1X1', (n: number) => 'G1X1'.repeat(n / 4)],
    ['R1', (n: number) => 'R1'.repeat(n / 2)],
    ['A1', (n: number) => 'A1'.repeat(n / 2)],
    ['A_1', (n: number) => 'A_1'.repeat(Math.floor(n / 3))],
    ['G1X1 and a bracket behind blanks', (n: number) => `${'G1X1'.repeat(n / 4 - 2)}   (1)`],
    ['G1X1 and an `=` behind blanks', (n: number) => `${'G1X1'.repeat(n / 4 - 2)}   =1`],
    ['V1 in Okuma', (n: number) => 'V1'.repeat(n / 2)],
  ])('stays linear on a long run of packed words: %s', (_name, make) => {
    const lengths = [4000, 8000, 16000, 32000];
    for (const cp of [sinumerik, okuma]) {
      const ms: number[] = [];
      for (const length of lengths) {
        const line = make(length);
        const started = performance.now();
        const { tokens } = tokenizeLine(line, cp);
        ms.push(performance.now() - started);
        expect(tokens[tokens.length - 1].end).toBe(line.length);
      }
      const worst = Math.max(...ms);
      const report = `${cp.profile.id}: ${lengths.map((n, i) => `${n}: ${ms[i].toFixed(1)} ms`).join(', ')}`;
      expect(worst, report).toBeLessThan(250);
    }
  });
});
