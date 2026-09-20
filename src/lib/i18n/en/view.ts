// View tab: panel toggles. Owner: WP1.5.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'View',
  groupPanels: 'Panels',
  toggleSidePanel: 'Side Panel',
  toggleBottomPanel: 'Bottom Panel',
  showOutput: 'Script Output',
  noOutputPanel: 'There is no output panel to show',
} as const satisfies Messages;
