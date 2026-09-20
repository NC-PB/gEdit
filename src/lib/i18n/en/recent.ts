// The recent-files list: the Home "Recent" dropdown and the two commands
// (`contrib/recent.ts`, `components/menus/RecentMenu.svelte`, `stores/recent.ts`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  // Ribbon and palette
  category: 'File',
  groupRecent: 'Recent',
  openRecent: 'Open Recent…',
  clearRecent: 'Clear Recent Files',

  // The dropdown in the Home tab
  menuLabel: 'Recent files',
  menuPlaceholder: 'Recent…',
  clearItem: 'Clear recent files',

  // The picker behind `file.openRecent`
  placeholder: 'Open a recent file',
  missing: 'Not found',
  missingLabel: '{name} (not found)',

  // Messages
  empty: 'There are no recent files yet.',
  missingTitle: 'File not found',
  missingMessage:
    '{name} is no longer at {path}.\n\nRemove it from the recent files?',
  removeButton: 'Remove',
  removed: 'Removed {name} from the recent files.',
  cleared: 'The recent files were cleared.',
} as const satisfies Messages;
