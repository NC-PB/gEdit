// The program map, in the left panel (plan §5 WP1.5). Owner: WP1.5.
// One feature per file (plan AD-3); see ./README.md.
//
// M3 (WP3.5) replaces the legacy parser behind the panel with the incremental
// OutlineIndex; the registration below stays as it is.

import ProgramMapPanel from '$lib/components/panels/ProgramMapPanel.svelte';
import type { Contribution } from '$lib/app/types';

export default {
  id: 'programMap',
  panels: [
    {
      id: 'programMap',
      region: 'left',
      title: 'programMap.title',
      component: ProgramMapPanel,
      order: 10,
    },
  ],
} satisfies Contribution;
