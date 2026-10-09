// Motion colors: a colored mark beside every line that moves, by how it moves (Phase 3 plan
// §6.6, §6.7). Owner: P3.7; the category, the ribbon group and the command title were pinned
// by the Phase 3 prelude (P3a).
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'View',
  /** Caption of the View-tab group (`{ tab: 'view', group: 'motionColors.group' }`), after Panels. */
  group: 'Lines',
  /** `view.toggleMotionColors`: switches the setting `assist.motionColors`. */
  toggle: 'Motion Colors',
  /** Status messages after the toggle. */
  on: 'Motion colors on.',
  off: 'Motion colors off.',
} as const satisfies Messages;
