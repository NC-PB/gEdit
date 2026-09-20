// The cursor / selection status item (plan §7.9: `status-item` with `data-item="cursor"`).
// One feature per file (plan AD-3); see ./README.md.
//
// The right-hand side of the status bar reads, in order: profile, encoding, EOL, cursor
// (§7.9), so this item takes the last slot.

import CursorStatus from '$lib/components/status/CursorStatus.svelte';
import type { Contribution } from '$lib/app/types';

export default {
  id: 'cursor',
  statusItems: [{ id: 'cursor', side: 'right', order: 40, component: CursorStatus }],
} satisfies Contribution;
