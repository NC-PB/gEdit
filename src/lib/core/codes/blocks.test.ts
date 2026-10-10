// B1 (plan "Two-block schema"): which block of a two-block lathe cycle a block is, and its
// parameters. The cases of `tests/fixtures/codes/blocks.json` run against the shipped databases
// as the app resolves them; `tests/python/test_code_blocks.py` holds the Python twins to the same.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { FIXTURES_DIR } from '../../../../tests/unit/helpers/fixtures';
import { cycleBlockOf, declaresBlocks, paramOfBlock, paramsOfBlock } from './blocks';
import { lookupCode } from './lookup';
import { resolveCodeDbs } from './resolve';
import type { CodeEntry } from './types';

interface Case {
  dialect: string;
  code: string;
  written: string[];
  block: 1 | 2 | null;
  params: string[];
}

const CASES = (JSON.parse(readFileSync(join(FIXTURES_DIR, 'codes', 'blocks.json'), 'utf8')) as { cases: Case[] }).cases;
const LOADED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);

function entry(dialect: string, code: string): CodeEntry {
  const found = lookupCode(LOADED[dialect], code);
  if (!found) throw new Error(`no ${code} in ${dialect}`);
  return found;
}

describe('the blocks of a two-block cycle in the shipped databases', () => {
  it.each(CASES.map((c) => [`${c.dialect} ${c.code} ${c.written.join(' ') || '(nothing)'}`, c] as const))('%s', (_name, c) => {
    const e = entry(c.dialect, c.code);
    expect(cycleBlockOf(e, c.written)).toBe(c.block);
    expect(paramsOfBlock(e, c.block).map((p) => p.address)).toEqual(c.params);
  });

  it('marks every lathe roughing, pecking and threading cycle as two blocks that say which parameter is where', () => {
    for (const dialect of ['fanuc-lathe', 'fanuc-lathe-b']) {
      for (const code of ['G71', 'G72', 'G73', 'G74', 'G75', 'G76']) expect(declaresBlocks(entry(dialect, code)), `${dialect} ${code}`).toBe(true);
      expect(declaresBlocks(entry(dialect, 'G70')), `${dialect} G70`).toBe(false);
    }
    expect(declaresBlocks(entry('fanuc', 'G76')), 'the mill G76 is a fine boring cycle').toBe(false);
  });

  it('gives an address of both blocks its own label in each, and the same reading', () => {
    const g71 = entry('fanuc-lathe', 'G71');
    expect(paramOfBlock(g71, 'U', 1)?.label).toMatch(/^Depth of cut per pass, a radius value/);
    expect(paramOfBlock(g71, 'U', 2)?.label).toMatch(/^Finishing allowance on X/);
    // With the block unknown, the first declaration (the first block's).
    expect(paramOfBlock(g71, 'U', null)?.label).toMatch(/^Depth of cut/);
    expect(paramOfBlock(g71, 'R', 2)).toBeNull();
    const g76 = entry('fanuc-lathe', 'G76');
    expect([paramOfBlock(g76, 'P', 1)?.unit, paramOfBlock(g76, 'P', 2)?.unit]).toEqual(['count', 'count']);
    expect(paramOfBlock(g76, 'R', 2)?.label).toMatch(/^Taper/);
    expect(paramOfBlock(g76, 'F', 1)).toBeNull();
  });
});

describe('cycleBlockOf on entries written by hand', () => {
  const base: CodeEntry = { code: 'G71', label: 'x', blocks: 2 };

  it('says nothing for an entry without blocks: 2 or without any CodeParam.block', () => {
    expect(cycleBlockOf({ ...base, blocks: undefined, params: [{ address: 'P', label: 'p', block: 2 }] }, ['P'])).toBeNull();
    expect(cycleBlockOf({ ...base, params: [{ address: 'P', label: 'p' }] }, ['P'])).toBeNull();
    expect(cycleBlockOf(null, ['P'])).toBeNull();
    expect(paramsOfBlock({ ...base, params: [{ address: 'P', label: 'p' }] }, 2).map((p) => p.address)).toEqual(['P']);
  });

  it('reads the addresses in any case, and a parameter of both blocks as one of the first', () => {
    const e: CodeEntry = {
      ...base,
      params: [
        { address: 'U', label: 'a', block: 1 },
        { address: 'S', label: 'both' },
        { address: 'P', label: 'p', block: 2 },
      ],
    };
    expect(cycleBlockOf(e, ['p'])).toBe(2);
    expect(cycleBlockOf(e, ['s'])).toBe(1);
    expect(cycleBlockOf(e, ['X'])).toBeNull();
    expect(paramsOfBlock(e, 1).map((p) => p.label)).toEqual(['a', 'both']);
    expect(paramsOfBlock(e, 2).map((p) => p.label)).toEqual(['both', 'p']);
  });
});
