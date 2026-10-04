// The NC tab's "Block Skip" group: insert and remove the skip mark on the selected lines
// (plan §6 M10, WP10.1). One feature per file (plan AD-3); see ./README.md.
//
// Nothing but `transforms.run(def)` on purpose: `TransformService` is the whole sequence
// (scope, level form, the whole-program confirmation, one undo step, summary, results),
// and the rules about where the mark stands and what it must never touch live in
// `core/transforms/blockSkip.ts`. No default key (§7.13). Both commands stay enabled while
// a document is open; `available()` says why a dialect without a skip mark cannot run them.

import BanIcon from 'lucide-svelte/icons/ban';
import ListChecks from 'lucide-svelte/icons/list-checks';
import { asIcon } from '$lib/app/icons';
import { transforms } from '$lib/app/transforms';
import { blockSkipAdd, blockSkipRemove } from '$lib/core/transforms/blockSkip';
import type { CommandContext, Contribution } from '$lib/app/types';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

export default {
  id: 'ncBlockSkip',
  commands: [
    {
      id: 'nc.blockSkip.add',
      title: 'ncBlockSkip.add',
      category: 'ncBlockSkip.category',
      icon: asIcon(BanIcon),
      enabled: hasDocument,
      run: () => transforms.run(blockSkipAdd),
    },
    {
      id: 'nc.blockSkip.remove',
      title: 'ncBlockSkip.remove',
      category: 'ncBlockSkip.category',
      icon: asIcon(ListChecks),
      enabled: hasDocument,
      run: () => transforms.run(blockSkipRemove),
    },
  ],
  ribbon: [
    { tab: 'nc', group: 'ncBlockSkip.group', command: 'nc.blockSkip.add', order: 60 },
    { tab: 'nc', group: 'ncBlockSkip.group', command: 'nc.blockSkip.remove', order: 70 },
  ],
} satisfies Contribution;
