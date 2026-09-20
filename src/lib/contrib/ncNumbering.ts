// The NC tab, "Numbering" group: renumber blocks and remove block numbers
// (plan §5 WP4.2). Owner: WP4.2. One feature per file (plan AD-3); see ./README.md.
//
// There is no logic here on purpose. `TransformService.run` is the whole sequence —
// availability, the options form, the preflight confirmation, the run, the edit, the
// summary and the results (plan §7.3) — so a transform command is one call, and every
// transform behaves the same.
//
// No shortcuts: §7.11 lists every default binding, and neither of these is in it. Both
// commands stay enabled while a document is open even on a dialect that cannot run them;
// `available()` answers with the reason, which the status bar shows. A disabled button
// with no explanation would leave the user guessing why.

import ListOrdered from 'lucide-svelte/icons/list-ordered';
import ListX from 'lucide-svelte/icons/list-x';
import { asIcon } from '$lib/app/icons';
import { transforms } from '$lib/app/transforms';
import { removeBlockNumbers } from '$lib/core/transforms/removeBlockNumbers';
import { renumber } from '$lib/core/transforms/renumber';
import type { CommandContext, Contribution } from '$lib/app/types';

function hasDocument(context: CommandContext): boolean {
  return context.activeDocId !== null;
}

export default {
  id: 'ncNumbering',
  commands: [
    {
      id: 'nc.renumber',
      title: 'ncNumbering.renumber.title',
      category: 'ncNumbering.category',
      icon: asIcon(ListOrdered),
      global: true,
      enabled: hasDocument,
      run: () => transforms.run(renumber),
    },
    {
      id: 'nc.removeBlockNumbers',
      title: 'ncNumbering.removeBlockNumbers.title',
      category: 'ncNumbering.category',
      icon: asIcon(ListX),
      global: true,
      enabled: hasDocument,
      run: () => transforms.run(removeBlockNumbers),
    },
  ],
  // A group's place in the tab is the smallest `order` its entries carry
  // (`components/shell/ribbonModel.ts`), so 5 puts Numbering before Cleanup's 10. Both
  // groups started at 10 and the tie was broken by first appearance — the alphabetical
  // load order of `contrib/ncCleanup.ts` — which put Cleanup first for no reason anyone
  // chose and would have moved again the next time a contribution file was renamed.
  ribbon: [
    { tab: 'nc', group: 'ncNumbering.group', command: 'nc.renumber', order: 5 },
    { tab: 'nc', group: 'ncNumbering.group', command: 'nc.removeBlockNumbers', order: 15 },
  ],
} satisfies Contribution;
