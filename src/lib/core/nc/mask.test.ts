// `maskComments` (plan §7.4, AD-11, WP3.2).
//
// The mask is what keeps `(T1 M6)` from being a tool change. It has to agree with the
// tokenizer on where a comment is, and it has to keep every offset, because the outline
// runner matches on the masked line and reveals the position in the real one.

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import okumaJson from '$lib/data/profiles/okuma-osp.json';
import sinumerikJson from '$lib/data/profiles/sinumerik.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { maskComments } from './mask';
import { tokenizeLine } from './tokenizer';
import type { NcToken } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);
const okuma = compileProfile(okumaJson as unknown as Profile);
const sinumerik = compileProfile(sinumerikJson as unknown as Profile);

describe('maskComments with a block comment', () => {
  it('blanks the comment and keeps every other character where it was', () => {
    expect(maskComments('G0 X0. (A) Z25. (B)', fanuc)).toBe('G0 X0.     Z25.    ');
    expect(maskComments('(A)(B)', fanuc)).toBe('      ');
  });

  it('blanks an unclosed comment to the end of the line', () => {
    expect(maskComments('X10. (UNCLOSED', fanuc)).toBe('X10.          ');
  });

  it('ends at the first closing parenthesis, because comments do not nest', () => {
    // `(A (B)` is the comment, so the second `)` stays on the masked line.
    expect(maskComments('G1 (A (B) ) X10.', fanuc)).toBe('G1        ) X10.');
  });

  it('takes the tool change out of a comment but leaves the one next to it', () => {
    const line = '(T1 M6) N10 T1 M6';
    const masked = maskComments(line, fanuc);
    expect(masked).toBe('        N10 T1 M6');
    expect(fanuc.re.toolTrigger.test(masked)).toBe(true);
    expect(masked.indexOf('T1')).toBe(line.lastIndexOf('T1'));
    expect(fanuc.re.toolTrigger.test(maskComments('(T1 M6)', fanuc))).toBe(false);
  });

  it('leaves a line without a comment exactly as it was', () => {
    const line = 'N10 G0 X10. Y-20.';
    expect(maskComments(line, fanuc)).toBe(line);
    expect(maskComments('', fanuc)).toBe('');
  });
});

describe('maskComments with a line comment', () => {
  it('blanks from the marker to the end of the line', () => {
    expect(maskComments('5 TOOL CALL 1 Z S3000 ; D10 END MILL', klartext)).toBe('5 TOOL CALL 1 Z S3000               ');
  });

  it('keeps the continuation marker, which is not part of the comment', () => {
    expect(maskComments('   Q200=2 ;CLEARANCE ~', klartext)).toBe('   Q200=2            ~');
  });

  it('does not start a comment inside a string', () => {
    expect(maskComments('6 TOOL CALL "D;10" Z S5000', klartext)).toBe('6 TOOL CALL "D;10" Z S5000');
  });

  // Fanuc has no strings (`syntax-fanuc` §3.7): a stray `"` is an ordinary character. A
  // profile that reads it as a string opener stops the mask there, and a tool change that
  // is commented out behind it is reported as a real one — the invariant this module is
  // for. The tokenizer is gated on the same flag, so the two stay in step.
  it('reads a quote as a string only where the dialect has strings', () => {
    expect(maskComments('G0 X1. " (T2 M6)', fanuc)).toBe('G0 X1. "        ');
    expect(fanuc.re.toolTrigger.test(maskComments('G0 X1. " (T2 M6)', fanuc))).toBe(false);
    expect(tokenizeLine('G0 X1. " (T2 M6)', fanuc).tokens.some((token) => token.kind === 'string')).toBe(false);
    expect(tokenizeLine('6 TOOL CALL "D10" Z', klartext).tokens.some((token) => token.kind === 'string')).toBe(true);
  });

  it('blanks the text of a structure block, which is a heading and not code', () => {
    expect(maskComments('7 * - TOOL CALL 5', klartext)).toBe('7                ');
    expect(klartext.re.toolTrigger.test(maskComments('7 * - TOOL CALL 5', klartext))).toBe(false);
    // The section rule itself reads the raw line, so the heading is still an outline item.
    expect(klartext.re.sectionHeading?.test('7 * - TOOL CALL 5')).toBe(true);
  });
});

// P8, AD-24. A dialect that ends its comment at the line end and has strings has to read
// the string first, or a message stops being a message: on the Sinumerik line
// `MSG("ROUGH;FINISH")` the `;` is text the operator sees on the screen, and a mask that
// started a comment there would hide the rest of the block from every code pattern.
describe('maskComments where a string may hold the comment marker', () => {
  it('does not start a comment inside a string', () => {
    const line = 'MSG("ROUGH;FINISH") G1 X10';
    expect(maskComments(line, sinumerik)).toBe(line);
  });

  it('still blanks the comment that follows the string', () => {
    expect(maskComments('MSG("A;B") ;NOTE', sinumerik)).toBe('MSG("A;B")      ');
    expect(maskComments('T="DRILL_D8" ;TOOL 8', sinumerik)).toBe('T="DRILL_D8"        ');
  });

  it('leaves a quote inside a comment alone, because the comment came first', () => {
    expect(maskComments('G1 X10 ;SAY "HI"', sinumerik)).toBe('G1 X10          ');
  });

  it('keeps a tool name out of a comment and a commented-out tool out of the code', () => {
    const named = maskComments('T="DRILL_D8" D1 ;WAS T="MILL_D10"', sinumerik);
    expect(named).toBe('T="DRILL_D8" D1                  ');
    expect(sinumerik.re.toolTrigger.test(named)).toBe(true);
    expect(sinumerik.re.toolTrigger.test(maskComments(';T="MILL_D10"', sinumerik))).toBe(false);
  });

  it('reads the Okuma comment brackets and never a quote', () => {
    expect(maskComments('N100 G00 X200 (ROUGH)', okuma)).toBe('N100 G00 X200        ');
    expect(maskComments('G00 X="A" (ROUGH)', okuma)).toBe('G00 X="A"        ');
  });

  // The file header is one program marker, not a block, and detection reads it off the
  // masked line: a comment marker inside the file name may not blank half of it.
  it('steps over a file header instead of reading inside it', () => {
    expect(maskComments('$FLANGE.MIN%', okuma)).toBe('$FLANGE.MIN%');
    expect(maskComments('$FLANGE(2).MIN%', okuma)).toBe('$FLANGE(2).MIN%');
    expect(maskComments('%_N_PART_MPF', sinumerik)).toBe('%_N_PART_MPF');
    // M9: the short transfer header is a header as well, and a comment behind it is blanked.
    expect(maskComments('%MYPROG_MPF', sinumerik)).toBe('%MYPROG_MPF');
    expect(maskComments('%MYPROG_MPF ;NOTE', sinumerik)).toBe('%MYPROG_MPF      ');
    // Only at the head of the line: further along, the comment rule applies as always.
    expect(maskComments('G00 X10 (ROUGH) $A.MIN%', okuma)).toBe('G00 X10         $A.MIN%');
  });
});

// `syntax.programNames` (§7.16): the control reads a name's characters like comment text.
describe('maskComments over a program name', () => {
  it('writes `_` for each letter and digit and keeps the rest, same length', () => {
    expect(maskComments('<SHAFT-T12.A> (OD PIN)', fanuc)).toBe('<_____-___._>         ');
    expect(maskComments('N10 M98<SUB+M30>L2', fanuc)).toBe('N10 M98<___+___>L2');
  });

  it('leaves nothing a tool, end or feed rule could match, and no blank run a comment reader would take', () => {
    const masked = maskComments('M98 <PART_T12_M30_F12> L2', fanuc);
    expect(masked).not.toMatch(/T\d|M30|F\d/);
    expect(masked).toBe('M98 <________________> L2');
  });

  it('masks a name inside a comment as the comment it is part of', () => {
    expect(maskComments('G1 X1. (<SUB_T1>)', fanuc)).toBe('G1 X1.           ');
  });

  it('leaves a line alone on a profile without the field', () => {
    expect(maskComments('IF R1<R2 GOTOF END_A', sinumerik)).toBe('IF R1<R2 GOTOF END_A');
  });
});

describe('maskComments and the tokenizer', () => {
  const lines: [CompiledProfile, string][] = [
    [fanuc, '%'],
    [fanuc, 'O1001 (BRACKET)'],
    [fanuc, 'N10 G0 X10. (A) Y20. (B'],
    [fanuc, '(A)(B)'],
    [fanuc, 'G1 (A (B) ) X10.'],
    [fanuc, '/(SKIPPED COMMENT)'],
    [fanuc, 'N10T1M6'],
    [fanuc, '<SHAFT_T12> (OD PIN)'],
    [fanuc, 'N10 M98 <SUB-F12.1> L2 (X)'],
    [fanuc, '<A B>'],
    [klartext, '5 TOOL CALL 1 Z S3000 ; D10'],
    [klartext, '   Q200=2 ;CLEARANCE ~'],
    [klartext, '7 * - ROUGHING'],
    [klartext, '8 L X+10 Y+20 R0 FMAX M3'],
    [klartext, '9 LBL "A;B"'],
    [okuma, '$FLANGE.MIN%'],
    [okuma, 'NLAP1 G85 (BAR TURNING)'],
    [okuma, 'G00 X=V1 (MOVE) Z=V2'],
    [okuma, 'X= (SET LATER)'],
    [okuma, 'SB=1200 M13 (LIVE TOOL'],
    [sinumerik, '%_N_PART_MPF'],
    [sinumerik, ';$PATH=/_N_WKS_DIR/_N_PART_WPD'],
    [sinumerik, 'N10 LOOP_A: G1 X10 ;FEED IN'],
    [sinumerik, 'MSG("ROUGH;FINISH") ;OPERATOR NOTE'],
    [sinumerik, 'T="DRILL_D8" D1'],
    [sinumerik, 'MSG("A;B'],
    [sinumerik, 'CYCLE83(50,0,2,-25,,-5)'],
  ];

  /** True for a program marker that is a program name (`<SHAFT_T12>`), not `O1234` or `%`. */
  const isName = (token: NcToken, cp: CompiledProfile): boolean => {
    const source = cp.profile.syntax.programNames;
    return token.kind === 'programMarker' && typeof source === 'string' && new RegExp(`^(?:${source})$`, cp.flags).test(token.text);
  };

  it.each(lines)('blanks exactly what the tokenizer calls a comment: %#', (cp, line) => {
    const masked = maskComments(line, cp);
    expect(masked).toHaveLength(line.length);

    const { tokens } = tokenizeLine(line, cp);
    for (const token of tokens) {
      const span = masked.slice(token.start, token.end);
      if (token.kind === 'comment') expect(span, token.text).toBe(' '.repeat(token.text.length));
      else if (isName(token, cp)) expect(span, token.text).toBe(token.text.replace(/[A-Za-z0-9]/g, '_'));
      else expect(span, token.text).toBe(token.text);
    }
  });
});
