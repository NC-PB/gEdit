// The View tab: panel toggles (plan §5 WP1.5). Owner: WP1.5.
// One feature per file (plan AD-3); see ./README.md.
//
// No shortcuts: §7.11 lists every default binding in M1, and anything else would log a
// key conflict that fails the runtime harness.

import LayoutList from 'lucide-svelte/icons/layout-list';
import PanelBottom from 'lucide-svelte/icons/panel-bottom';
import Terminal from 'lucide-svelte/icons/terminal';
import { asIcon } from '$lib/app/icons';
import { panels } from '$lib/app/registry/panels';
import { status } from '$lib/app/status';
import { layout } from '$lib/stores/layout';
import { t } from '$lib/i18n';
import { get } from 'svelte/store';
import type { Contribution } from '$lib/app/types';

/** The id the script output panel registers under (`contrib/scripts.ts`, §7.9 `output-*`). */
const OUTPUT_PANEL = 'output';

function hasPanels(region: 'left' | 'bottom'): boolean {
  return get(panels.panels).some((panel) => panel.region === region);
}

export default {
  id: 'view',
  commands: [
    {
      id: 'view.toggleSidePanel',
      title: 'view.toggleSidePanel',
      category: 'view.category',
      icon: asIcon(LayoutList),
      global: true,
      enabled: () => hasPanels('left'),
      run: () => layout.toggle('left'),
    },
    {
      id: 'view.toggleBottomPanel',
      title: 'view.toggleBottomPanel',
      category: 'view.category',
      icon: asIcon(PanelBottom),
      global: true,
      enabled: () => hasPanels('bottom'),
      run: () => layout.toggle('bottom'),
    },
    {
      id: 'view.showOutput',
      title: 'view.showOutput',
      category: 'view.category',
      icon: asIcon(Terminal),
      global: true,
      enabled: () => get(panels.panels).some((panel) => panel.id === OUTPUT_PANEL),
      run: () => {
        if (!get(panels.panels).some((panel) => panel.id === OUTPUT_PANEL)) {
          status.show(t('view.noOutputPanel'), { error: true });
          return;
        }
        layout.show(OUTPUT_PANEL);
      },
    },
  ],
  ribbon: [
    { tab: 'view', group: 'view.groupPanels', command: 'view.toggleSidePanel', order: 10 },
    { tab: 'view', group: 'view.groupPanels', command: 'view.toggleBottomPanel', order: 20 },
    { tab: 'view', group: 'view.groupPanels', command: 'view.showOutput', order: 30 },
  ],
} satisfies Contribution;
