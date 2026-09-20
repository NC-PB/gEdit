// Tab bar and tab-switching commands (contrib/tabs.ts).
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'View',
  nextTab: 'Next Tab',
  prevTab: 'Previous Tab',
  switchTab: 'Switch Tab…',
  switchPlaceholder: 'Go to an open document',
  close: 'Close',
  unsaved: 'Unsaved changes',
  externalChanged: 'Changed on disk',
  externalDeleted: 'Deleted on disk',
} as const satisfies Messages;
