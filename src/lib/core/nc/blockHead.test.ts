// `blockHeadOf` reads the head of a line (block number, labels, where the words begin) without
// building tokens. A template form on a 300,000-line program relies on it (P3b fix H, known gap
// 23), so it is held to `tokenizeLine` on random lines of every profile, the built-in ones and
// variants of them (continuation mark, case rule, a second prefix, skip positions, jump labels).

import { describe, expect, it } from 'vitest';
import { profilesToRead, random, randomLine, randomLines } from '../../../../tests/unit/helpers/randomNc';
import { blockHeadOf, tokenizeLine } from './tokenizer';
import type { LineState } from './types';

describe('blockHeadOf equals the head tokenizeLine reads', () => {
  for (const [name, cp] of profilesToRead()) {
    it(`${name}: block number, head labels, where the words begin, continuation`, () => {
      const next = random(7);
      let state: LineState | undefined;
      let continues = false;
      for (let i = 0; i < 4000; i++) {
        const line = randomLine(next);
        const r = tokenizeLine(line, cp, state);
        const head = blockHeadOf(line, cp, continues);
        const where = JSON.stringify(line);
        const number = r.tokens.find((t) => t.kind === 'blockNumber');
        expect(head.number, where).toBe(number?.valueText ?? null);
        expect(head.labels, where).toEqual(r.tokens.filter((t) => t.kind === 'label' && t.end <= head.end).map((t) => t.text));
        // No word of the block starts inside the head: what is left of the line is all there is to look at.
        for (const t of r.tokens) if (t.kind === 'word' || t.kind === 'keyword') expect(t.start, where).toBeGreaterThanOrEqual(head.end);
        // ... and the head reaches as far as the tokenizer's head does: nothing the head owns (a skip mark, a block number) ends behind it.
        for (const t of r.tokens) if (t.kind === 'skip' || t.kind === 'blockNumber') expect(t.end, where).toBeLessThanOrEqual(head.end);
        // A label that `syntax.labels` finds at the start of the line, or behind the number, and that the tokenizer reads as a label token is a label of the head, inside it.
        if (cp.re.labels) {
          const match = new RegExp(cp.re.labels.source, `${cp.flags}d`).exec(line);
          const at = match?.index === 0 ? match.indices?.groups?.name : undefined;
          if (match && at) {
            const token = r.tokens.find((t) => t.kind === 'label' && t.start === at[0] && t.end === match[0].length);
            if (token) {
              expect(token.end, where).toBeLessThanOrEqual(head.end);
              expect(head.labels, where).toContain(token.text);
            }
          }
        }
        expect(head.continues, where).toBe(r.state.continuation);
        state = r.state;
        continues = head.continues;
      }
    });
  }

  it('a line that continues the one above has no head', () => {
    const [, cp] = profilesToRead().find(([n]) => n === 'fanuc + continuation ~')!;
    const lines = ['N10 G1 X1 ~', 'N20 G1 X2', 'N30 G1 X3'];
    let state: LineState | undefined;
    let continues = false;
    for (const line of lines) {
      const r = tokenizeLine(line, cp, state);
      const head = blockHeadOf(line, cp, continues);
      expect(head.number).toBe(r.tokens.find((t) => t.kind === 'blockNumber')?.valueText ?? null);
      state = r.state;
      continues = head.continues;
    }
    expect(blockHeadOf('N20 G1 X2', cp, true).number).toBeNull();
    expect(blockHeadOf('N20 G1 X2', cp, false).number).toBe('20');
  });

  it('is the same on a run of lines read in order (state carried line by line)', () => {
    for (const [name, cp] of profilesToRead()) {
      let state: LineState | undefined;
      let continues = false;
      for (const line of randomLines(11, 800)) {
        const r = tokenizeLine(line, cp, state);
        const head = blockHeadOf(line, cp, continues);
        expect(head.number, `${name}: ${JSON.stringify(line)}`).toBe(r.tokens.find((t) => t.kind === 'blockNumber')?.valueText ?? null);
        state = r.state;
        continues = head.continues;
      }
    }
  });
});
