// Help: About and the shortcut reference (plan §5 WP2.4). Owner: WP2.4.
// One feature per file (plan AD-3); see ./README.md.
//
// No shortcuts: §7.11 lists every default binding, and anything else would log a key
// conflict that fails the runtime harness. Both commands are `global`, so they also work
// while focus is outside Monaco, and both are ribbon buttons in the View tab's Help group.
// The group orders are high on purpose: the group's position inside a tab is the smallest
// order any of its entries carries, so Help sorts after Commands and Panels.

import Info from 'lucide-svelte/icons/info';
import Keyboard from 'lucide-svelte/icons/keyboard';
import AboutDialog from '$lib/components/dialogs/AboutDialog.svelte';
import ShortcutsDialog from '$lib/components/dialogs/ShortcutsDialog.svelte';
import { asIcon } from '$lib/app/icons';
import { modals } from '$lib/app/modals';
import type { Contribution } from '$lib/app/types';

export default {
  id: 'help',
  commands: [
    {
      id: 'help.about',
      title: 'help.about',
      category: 'help.category',
      icon: asIcon(Info),
      global: true,
      run: () => modals.open(AboutDialog, {}),
    },
    {
      id: 'help.shortcuts',
      title: 'help.shortcuts',
      category: 'help.category',
      icon: asIcon(Keyboard),
      global: true,
      run: () => modals.open(ShortcutsDialog, {}),
    },
  ],
  ribbon: [
    { tab: 'view', group: 'help.group', command: 'help.shortcuts', order: 100 },
    { tab: 'view', group: 'help.group', command: 'help.about', order: 110 },
  ],
} satisfies Contribution;
