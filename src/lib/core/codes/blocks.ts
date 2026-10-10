// The two blocks of a two-block cycle (B1, plan "Two-block schema"; `CodeEntry.blocks`,
// `CodeParam.block`). Pure, no dialect name: everything comes from the entry.
//
// A lathe roughing or threading cycle is written in two blocks with the same code, and the
// same address can mean two different things in them (`G71 U2. R.5` / `G71 P10 Q20 U.4 W.1
// F.25`: `U` is the depth of cut in the first block and the finishing allowance in the
// second). The manuals decide which block is which by the words written: the second block is
// the one with `P` and `Q` (`G71`–`G73`), with an axis word (`G74`, `G75`), with `X`(`U`) and
// `Z`(`W`) (`G76`). The database says the same with `CodeParam.block`, and this module reads
// it:
//
//   - **second** when the block writes an address declared for the second block only;
//   - else **first** when it writes an address declared for the first block (or for both);
//   - else unknown (`null`): the block writes nothing the entry declares, or the entry
//     declares no `block` at all (a user database written before B1). The inspector then
//     pairs neighbouring blocks (`inspect.ts` `isPair`), as it did before.
//
// The Python twin is `_nc_modal.cycle_block_of` / `params_of_block` (exported by `gedit_nc`);
// both are held to the same cases.

import type { CodeEntry, CodeParam } from './types';

/** Which of the two blocks of a two-block cycle. */
export type CycleBlock = 1 | 2;

function upper(text: unknown): string {
  return typeof text === 'string' ? text.toUpperCase() : '';
}

function paramsOf(entry: CodeEntry | null | undefined): CodeParam[] {
  const params = entry?.params;
  return Array.isArray(params) ? params.filter((p) => p && typeof p.address === 'string' && p.address !== '') : [];
}

/** The entry is a two-block cycle that says which parameter belongs to which block. */
export function declaresBlocks(entry: CodeEntry | null | undefined): boolean {
  return entry?.blocks === 2 && paramsOf(entry).some((p) => p.block === 1 || p.block === 2);
}

/**
 * Which block of `entry` a block is that writes the addresses `written` (`X`, `P`, …, any
 * case), or null when that cannot be said from the entry (see the header).
 */
export function cycleBlockOf(entry: CodeEntry | null | undefined, written: Iterable<string>): CycleBlock | null {
  if (!declaresBlocks(entry)) return null;
  const first = new Set<string>();
  const second = new Set<string>();
  for (const p of paramsOf(entry)) {
    const address = upper(p.address);
    if (p.block !== 2) first.add(address);
    if (p.block !== 1) second.add(address);
  }
  let wroteFirst = false;
  for (const word of written) {
    const address = upper(word);
    if (second.has(address) && !first.has(address)) return 2;
    if (first.has(address)) wroteFirst = true;
  }
  return wroteFirst ? 1 : null;
}

/**
 * The parameters of `entry` that belong to `block`: those declared for it and those declared
 * for both. With `block` null, or an entry that does not declare blocks, every parameter.
 */
export function paramsOfBlock(entry: CodeEntry | null | undefined, block: CycleBlock | null): CodeParam[] {
  const all = paramsOf(entry);
  if (block === null || !declaresBlocks(entry)) return all;
  return all.filter((p) => p.block === undefined || p.block === block);
}

/** The parameter of `entry` written with `address` in `block` (the first one with `block` null), or null. */
export function paramOfBlock(entry: CodeEntry | null | undefined, address: string, block: CycleBlock | null): CodeParam | null {
  const want = upper(address);
  return paramsOfBlock(entry, block).find((p) => upper(p.address) === want) ?? null;
}
