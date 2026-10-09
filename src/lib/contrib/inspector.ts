// The code inspector in the left panel (Phase 3 plan P3.2b, AD-27, §6.7). One feature per file
// (plan AD-3); see ./README.md.
//
// The panel sits in the left region next to the Program Map and is hidden by default: the
// Program Map is the panel that region shows until the user asks for the inspector. Nothing
// runs while it is hidden, because the panel follows the cursor only while it is mounted
// (`app/inspectorService.ts`).
//
//   - `view.toggleInspector` (`Mod+Alt+A`, View tab, group `view.groupPanels`, after Side
//     Panel) shows the inspector in the left region, and, when it is already showing, goes back
//     to the panel that was there before (the region is hidden when there is none).
//   - `inspector.editValue` (palette, no key) edits the value of the word at the cursor, as a
//     double-click or Enter on its row does; it works with the panel hidden.

import ScanSearch from 'lucide-svelte/icons/scan-search';
import { get } from 'svelte/store';
import { asIcon } from '$lib/app/icons';
import { inspector } from '$lib/app/inspectorService';
import { panels } from '$lib/app/registry/panels';
import InspectorPanel from '$lib/components/panels/InspectorPanel.svelte';
import { layout } from '$lib/stores/layout';
import type { Contribution } from '$lib/app/types';

/** The id the panel registers under; `layout.show` takes it. */
export const INSPECTOR_PANEL_ID = 'inspector';

/** Shows the inspector, or, when it is the panel on show, the panel it replaced. */
export function toggleInspector(): void {
  const left = get(layout.state).left;
  if (left.visible && left.active === INSPECTOR_PANEL_ID) {
    const other = get(panels.panels).find((panel) => panel.region === 'left' && panel.id !== INSPECTOR_PANEL_ID);
    if (other) layout.show(other.id);
    else layout.hide('left');
    return;
  }
  layout.show(INSPECTOR_PANEL_ID);
}

export default {
  id: 'inspector',
  panels: [
    {
      id: INSPECTOR_PANEL_ID,
      region: 'left',
      title: 'inspector.title',
      component: InspectorPanel,
      order: 20,
    },
  ],
  commands: [
    {
      id: 'view.toggleInspector',
      title: 'inspector.toggle',
      category: 'inspector.category',
      icon: asIcon(ScanSearch),
      keys: 'Mod+Alt+A',
      global: true,
      run: () => toggleInspector(),
    },
    {
      id: 'inspector.editValue',
      title: 'inspector.editValue',
      category: 'inspector.category',
      enabled: (c) => c.activeDocId !== null,
      run: () => inspector.editAtCursor(),
    },
  ],
  ribbon: [{ tab: 'view', group: 'view.groupPanels', command: 'view.toggleInspector', order: 15 }],
} satisfies Contribution;
