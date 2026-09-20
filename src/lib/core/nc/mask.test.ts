// `maskComments` (plan §7.4, AD-11, WP3.2).
//
// The mask is what keeps `(T1 M6)` from being a tool change. It has to agree with the
// tokenizer on where a comment is, and it has to keep every offset, because the outline
// runner matches on the masked line and reveals the position in the real one.

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { maskComments } from './mask';
import { tokenizeLine } from './tokenizer';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);

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

describe('maskComments and the tokenizer', () => {
  const lines: [CompiledProfile, string][] = [
    [fanuc, '%'],
    [fanuc, 'O1001 (BRACKET)'],
    [fanuc, 'N10 G0 X10. (A) Y20. (B'],
    [fanuc, '(A)(B)'],
    [fanuc, 'G1 (A (B) ) X10.'],
    [fanuc, '/(SKIPPED COMMENT)'],
    [fanuc, 'N10T1M6'],
    [klartext, '5 TOOL CALL 1 Z S3000 ; D10'],
    [klartext, '   Q200=2 ;CLEARANCE ~'],
    [klartext, '7 * - ROUGHING'],
    [klartext, '8 L X+10 Y+20 R0 FMAX M3'],
    [klartext, '9 LBL "A;B"'],
  ];

  it.each(lines)('blanks exactly what the tokenizer calls a comment: %#', (cp, line) => {
    const masked = maskComments(line, cp);
    expect(masked).toHaveLength(line.length);

    const { tokens } = tokenizeLine(line, cp);
    for (const token of tokens) {
      const span = masked.slice(token.start, token.end);
      if (token.kind === 'comment') expect(span, token.text).toBe(' '.repeat(token.text.length));
      else expect(span, token.text).toBe(token.text);
    }
  });
});
