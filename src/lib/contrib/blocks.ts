// The Insert tab: code blocks (plan §5 WP1.5). Owner: WP1.5.
// One feature per file (plan AD-3); see ./README.md.
//
// One `insert.block:<id>` command per block id, registered for the union of the ids every
// profile defines and disabled where the active profile has no such block. The ribbon
// buttons themselves are a custom group (`BlocksGroup`), because their labels are the
// profile's own block names. Blocks JSON stays until the P2 templates.

import BlocksGroup from '$lib/components/shell/BlocksGroup.svelte';
import { status } from '$lib/app/status';
import { editor } from '$lib/monaco/editorService';
import { docs } from '$lib/stores/documents';
import { hasKey, t } from '$lib/i18n';
import { allBlockIds, blockFor } from '$lib/utils/insertBlock';
import type { CommandDef, Contribution } from '$lib/app/types';

/** The block id whose button also sits in the Home tab (the M0 "New Prg" button). */
const HOME_BLOCK = 'start';

function activeProfileId(): string | null {
  const id = docs.getActiveId();
  return (id === null ? undefined : docs.get(id)?.profileId) ?? null;
}

function insert(blockId: string): void {
  const profileId = activeProfileId();
  if (profileId === null) {
    status.show(t('blocks.noDocument'), { error: true });
    return;
  }
  const block = blockFor(profileId, blockId);
  if (block === null) {
    status.show(t('blocks.noBlock', { id: blockId }), { error: true });
    return;
  }
  editor.insertText(block.TextBlock);
}

/**
 * The palette title of a block. `blocks.name.<id>` is profile-independent on purpose; a
 * block id that no namespace covers falls back to the id, which `t()` returns unchanged.
 */
function titleOf(blockId: string): string {
  const key = `blocks.name.${blockId}`;
  return hasKey(key) ? key : blockId;
}

const commands: CommandDef[] = allBlockIds().map((blockId) => ({
  id: `insert.block:${blockId}`,
  title: titleOf(blockId),
  category: 'blocks.category',
  enabled: () => {
    const profileId = activeProfileId();
    return profileId !== null && blockFor(profileId, blockId) !== null;
  },
  run: () => insert(blockId),
}));

export default {
  id: 'blocks',
  commands,
  ribbon: [
    { tab: 'home', group: 'blocks.groupProgram', command: `insert.block:${HOME_BLOCK}`, order: 20 },
  ],
  ribbonGroups: [
    { tab: 'insert', group: 'blocks.groupBlocks', order: 10, component: BlocksGroup },
  ],
} satisfies Contribution;
