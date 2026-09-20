// Line-ending detection and normalisation (plan §7.2, AD-7).

import { describe, expect, it } from 'vitest';
import { detectEol, joinEol, toLf } from './eol';

describe('detectEol', () => {
  it('reports no line ending for a text without a break', () => {
    expect(detectEol('O1234 (ONE LINE)')).toEqual({ eol: null, mixed: false, counts: { crlf: 0, lf: 0, cr: 0 } });
    expect(detectEol('')).toEqual({ eol: null, mixed: false, counts: { crlf: 0, lf: 0, cr: 0 } });
  });

  it('recognises a file that uses one ending throughout', () => {
    expect(detectEol('a\r\nb\r\nc')).toEqual({ eol: 'crlf', mixed: false, counts: { crlf: 2, lf: 0, cr: 0 } });
    expect(detectEol('a\nb\nc')).toEqual({ eol: 'lf', mixed: false, counts: { crlf: 0, lf: 2, cr: 0 } });
    expect(detectEol('a\rb\rc')).toEqual({ eol: 'cr', mixed: false, counts: { crlf: 0, lf: 0, cr: 2 } });
  });

  it('counts a CRLF as one break, not as a CR and an LF', () => {
    const { counts } = detectEol('a\r\nb\rc\nd\r\n');
    expect(counts).toEqual({ crlf: 2, lf: 1, cr: 1 });
  });

  it('takes the majority ending of a mixed file and marks it mixed', () => {
    expect(detectEol('a\r\nb\r\nc\nd')).toMatchObject({ eol: 'crlf', mixed: true });
    expect(detectEol('a\nb\nc\r\nd')).toMatchObject({ eol: 'lf', mixed: true });
    expect(detectEol('a\rb\rc\nd')).toMatchObject({ eol: 'cr', mixed: true });
  });

  it('gives a tie to CRLF', () => {
    expect(detectEol('a\r\nb\nc').eol).toBe('crlf');
    expect(detectEol('a\r\nb\rc').eol).toBe('crlf');
    expect(detectEol('a\r\nb\nc\rd').eol).toBe('crlf');
  });

  // The plan only settles a tie that CRLF takes part in; LF wins over CR so that the
  // chosen ending is always one the file actually uses.
  it('gives a tie between LF and CR to LF', () => {
    expect(detectEol('a\nb\rc').eol).toBe('lf');
  });

  it('sees a break at the very start and at the very end', () => {
    expect(detectEol('\r\n')).toEqual({ eol: 'crlf', mixed: false, counts: { crlf: 1, lf: 0, cr: 0 } });
    expect(detectEol('\r')).toEqual({ eol: 'cr', mixed: false, counts: { crlf: 0, lf: 0, cr: 1 } });
  });
});

describe('joinEol and toLf', () => {
  const lf = 'O1234\nG0 X0.\nM30\n';

  it('writes the requested ending after every line', () => {
    expect(joinEol(lf, 'crlf')).toBe('O1234\r\nG0 X0.\r\nM30\r\n');
    expect(joinEol(lf, 'lf')).toBe(lf);
    expect(joinEol(lf, 'cr')).toBe('O1234\rG0 X0.\rM30\r');
  });

  it('is the exact inverse of toLf for a text with one kind of ending', () => {
    for (const eol of ['crlf', 'lf', 'cr'] as const) {
      expect(toLf(joinEol(lf, eol))).toBe(lf);
    }
  });

  it('turns CRLF and a lone CR into LF, and leaves LF alone', () => {
    expect(toLf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('gives the same text with and without the counts shortcut', () => {
    for (const text of ['a\nb', 'a\r\nb', 'a\rb', 'a\r\nb\rc\nd', 'no break']) {
      expect(toLf(text, detectEol(text).counts)).toBe(toLf(text));
    }
  });
});
