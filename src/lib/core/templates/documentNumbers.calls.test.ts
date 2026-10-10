// How often `documentNumbers` asks the tokenizer (P3b fix H, known gap 23): a line whose head holds
// the block number and whose rest names no reference word is never tokenized. The call count is the
// cost model that does not depend on the machine; `documentNumbers.test.ts` holds the time.

import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ tokenizeLine: 0 }));
vi.mock('$lib/core/nc/tokenizer', async (original) => {
  const real = await original<typeof import('$lib/core/nc/tokenizer')>();
  return {
    ...real,
    tokenizeLine: (...args: Parameters<typeof real.tokenizeLine>) => {
      calls.tokenizeLine++;
      return real.tokenizeLine(...args);
    },
  };
});

import { cpOf } from '../../../../tests/unit/helpers/profiles';
import { documentNumbers, documentNumbersByTokens } from './blockNumbers';

describe('tokenizer calls of documentNumbers', () => {
  const plain = Array.from({ length: 50_000 }, (_, i) => `N${(i + 1) * 10} G1 X${i % 100}.5 Y${i % 50}.25 F1200.`);

  it('a numbered Fanuc program without P, Q or GOTO is not tokenized at all', () => {
    calls.tokenizeLine = 0;
    const doc = documentNumbers(plain, cpOf('fanuc-gcode'));
    expect(doc.blocks.size).toBe(50_000);
    expect(calls.tokenizeLine).toBe(0);
  });

  it('only the lines that hold a reference word are tokenized (and the reference is found)', () => {
    const lines = [...plain];
    lines[100] = 'N1010 G71 P1020 Q1030 U0.4';
    lines[200] = 'N2010 M98 P1000';
    calls.tokenizeLine = 0;
    const doc = documentNumbers(lines, cpOf('fanuc-lathe'));
    expect(calls.tokenizeLine).toBe(2);
    expect(doc.referenced.get('1020')).toEqual({ line: 101, word: 'P1020' });
  });

  it('without the block numbers a plain line is not even read at its head, and the references are still found', () => {
    const lines = [...plain];
    lines[300] = 'N3010 G71 P3020 Q3030 U0.4';
    calls.tokenizeLine = 0;
    const doc = documentNumbers(lines, cpOf('fanuc-lathe'), false);
    expect(doc.withBlocks).toBe(false);
    expect(doc.blocks.size).toBe(0);
    expect(calls.tokenizeLine).toBe(1);
    expect(doc.referenced.get('3020')).toEqual({ line: 301, word: 'P3020' });
    expect(doc.referenced.get('3030')).toEqual({ line: 301, word: 'Q3030' });
  });

  it('the reference reading tokenizes every line', () => {
    calls.tokenizeLine = 0;
    documentNumbersByTokens(plain, cpOf('fanuc-gcode'));
    expect(calls.tokenizeLine).toBe(50_000);
  });

  it('a gate letter in a comment sends no line to the tokenizer (FZ-02), a P or an N outside one does', () => {
    const commented: Record<string, string> = {
      'fanuc-gcode': 'G1 X1.5 Z-2. F0.2 (SPINDLE STOP P1 GOTO 5)',
      'okuma-osp': 'G1 X1.5 Z-2. (CONTOUR N7 NLAP1)',
      sinumerik: 'G1 X1.5 Z-2. ; contour P1 N7 GOTO 5',
    };
    for (const [id, text] of Object.entries(commented)) {
      const cp = cpOf(id);
      const lines = Array.from({ length: 20_000 }, (_, i) => `N${(i + 1) * 10} ${text}`);
      calls.tokenizeLine = 0;
      const found = documentNumbers(lines, cp);
      expect(calls.tokenizeLine, id).toBe(0);
      expect(found.blocks.size, id).toBe(20_000);
      expect(found.referenced.size, id).toBe(0);
      // The same words outside a comment are references and are read by the tokenizer.
      lines[5] = `N60 ${text.replace(/[();]/g, ' ')}`;
      calls.tokenizeLine = 0;
      documentNumbers(lines, cp);
      expect(calls.tokenizeLine, id).toBe(1);
    }
  });

  it('Okuma: a sequence name in the rest of a line sends that line to the tokenizer, plain lines and a letter in a comment stay out', () => {
    const lines = [...plain];
    lines[10] = 'N110 G85 NLAP1 D3';
    lines[20] = 'N210 G1 X1 (NEXT TOOL)';
    calls.tokenizeLine = 0;
    documentNumbers(lines, cpOf('okuma-osp'));
    // `(NEXT TOOL)` holds an N and a letter, in a comment: not a name, no pass.
    expect(calls.tokenizeLine).toBe(1);
  });
});
