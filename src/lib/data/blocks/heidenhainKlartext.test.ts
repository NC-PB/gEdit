// The Klartext blocks of the Insert tab (TODO Next up 4). A Q-style cycle is one logical
// block over several lines; without the `~` on every line but the last the control reads
// each Q line as an assignment of its own and runs the cycle with the old values — another
// program, and no error. So the blocks are held to the same rules as the completion
// snippet, through the same tokenizer and the same snippet builder.

import { describe, expect, it } from 'vitest';
import blocksJson from './heidenhain-klartext.json';
import profileJson from '$lib/data/profiles/heidenhain-klartext.json';
import codesJson from '$lib/data/codes/heidenhain.json';
import { compileProfile } from '$lib/core/profiles/compile';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { completionItems } from '$lib/core/codes/completionItems';
import { loadCodeDb } from '$lib/core/codes/load';
import type { Profile } from '$lib/core/profiles/types';
import type { LineState, NcToken } from '$lib/core/nc/types';
import type { BlockConfig } from './index';

const cp = compileProfile(profileJson as unknown as Profile);
const db = loadCodeDb(codesJson);
const blocks = blocksJson as Record<string, BlockConfig>;

/** One logical block: its head line and the lines that continue it. */
interface Logical {
  number: number;
  lines: { text: string; tokens: NcToken[] }[];
}

/** Tokenizes a block's text line by line, carrying the continuation state across. */
function logicalBlocks(text: string): { blocks: Logical[]; end: LineState } {
  expect(text.endsWith('\n'), 'a block ends in a newline').toBe(true);
  const out: Logical[] = [];
  let prev: LineState | undefined;
  for (const line of text.slice(0, -1).split('\n')) {
    const { tokens, state } = tokenizeLine(line, cp, prev);
    const head = tokens.find((token) => token.kind !== 'whitespace');
    if (prev?.continuation === true) {
      expect(
        head?.kind,
        `"${line}" continues a block, so it has no number`,
      ).not.toBe('blockNumber');
      expect(line, `"${line}" is indented`).toMatch(/^\s+\S/);
      out[out.length - 1].lines.push({ text: line, tokens });
    } else {
      expect(head?.kind, `"${line}" starts a block, so it has a number`).toBe(
        'blockNumber',
      );
      out.push({ number: Number(head!.text), lines: [{ text: line, tokens }] });
    }
    prev = state;
  }
  return { blocks: out, end: prev ?? { continuation: false } };
}

/**
 * The block's cycle rewritten in the completion's snippet form: no block number, the name
 * as the first tab stop, each value a numbered tab stop, the labels left out.
 */
function asSnippet(block: Logical): string {
  return block.lines
    .map(({ text }, i) => {
      if (i === 0)
        return text.replace(/^\d+ (CYCL DEF \d+) \S+/, '$1 ${1:NAME}');
      return text.replace(
        /^(\s+Q\d+)=[^ ;~]+ ;[^~]*?( ~)?$/,
        (_, q, mark) => `${q}=\${${i + 1}}${mark ?? ''}`,
      );
    })
    .join('\n');
}

/** What the completion inserts for `code` when every parameter it knows is written. */
function completionFor(code: string): string {
  const entry = db.codes.find((candidate) => candidate.code === code);
  expect(entry, code).toBeDefined();
  const all = {
    ...entry!,
    params: (entry!.params ?? []).map((param) => ({
      ...param,
      required: true,
    })),
  };
  return completionItems([all], { profile: cp })[0].insertText;
}

describe('Klartext blocks', () => {
  for (const [id, block] of Object.entries(blocks)) {
    it(`${id}: block numbers ascend and no continuation is left open`, () => {
      const { blocks: logical, end } = logicalBlocks(block.TextBlock);
      expect(end.continuation, 'the last line has no ~').toBe(false);
      const numbers = logical.map((b) => b.number);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
      expect(new Set(numbers).size).toBe(numbers.length);
    });
  }

  it('the header is a whole program frame, BEGIN PGM to a matching END PGM', () => {
    const { blocks: logical } = logicalBlocks(blocks.start.TextBlock);
    const lines = logical.map((b) => b.lines[0].text);
    expect(lines).toEqual(['0 BEGIN PGM NEW_PRG MM', '1 END PGM NEW_PRG MM']);
  });

  for (const [id, cycle] of [
    ['example', 'CYCL DEF 240'],
    ['drill', 'CYCL DEF 200'],
  ] as const) {
    it(`${id}: ${cycle} is one continuation block, laid out like the completion`, () => {
      const { blocks: logical } = logicalBlocks(blocks[id].TextBlock);
      expect(logical, 'one logical block per cycle').toHaveLength(1);
      const [only] = logical;
      only.lines.forEach(({ tokens }, i) => {
        const marks = tokens.filter((token) => token.kind === 'continuation');
        expect(marks, only.lines[i].text).toHaveLength(
          i + 1 === only.lines.length ? 0 : 1,
        );
      });
      expect(asSnippet(only)).toBe(completionFor(cycle));
    });
  }

  it('cycle 200 writes its depth reference Q395', () => {
    expect(blocks.drill.TextBlock).toMatch(/^ +Q395=0 ;\S.*\n$/m);
  });
});
