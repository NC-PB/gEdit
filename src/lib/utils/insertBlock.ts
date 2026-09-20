// Code blocks per dialect (plan §5 WP1.5). Owner: WP1.5.
//
// Until M0 this module reached into a Monaco component reference and inserted the text
// itself. The insert now goes through the `insert.block:<id>` command and
// `editor.insertText`, so what is left here is the pure lookup over
// `src/lib/data/blocks/*.json`, shared by `contrib/blocks.ts` and the ribbon group.
// P2 replaces the blocks JSON with templates and this file goes with it.

import { activeBlocksLib, type BlockConfig } from '$lib/data/blocks/index';

export type { BlockConfig };

/** The blocks of one profile, in JSON order; empty for a profile that has none. */
export function blocksFor(profileId: string): [string, BlockConfig][] {
  return Object.entries(activeBlocksLib[profileId] ?? {});
}

/** One block, or null when this profile does not define it. */
export function blockFor(profileId: string, blockId: string): BlockConfig | null {
  return activeBlocksLib[profileId]?.[blockId] ?? null;
}

/**
 * Every block id any profile defines, in first-seen order. The commands are registered
 * once for this union; `enabled` then hides the ones the active profile lacks.
 */
export function allBlockIds(): string[] {
  const ids: string[] = [];
  for (const blocks of Object.values(activeBlocksLib)) {
    for (const id of Object.keys(blocks)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
