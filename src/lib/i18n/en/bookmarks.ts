// Bookmarks: toggle, next, previous, clear (contrib/bookmarks.ts). Owner: WP4.4.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Bookmarks',
  toggle: 'Toggle Bookmark',
  next: 'Next Bookmark',
  prev: 'Previous Bookmark',
  clear: 'Clear Bookmarks',
  set: 'Bookmark set.',
  removed: 'Bookmark removed.',
  none: 'This document has no bookmarks.',
  cleared_one: 'Removed {count} bookmark.',
  cleared_other: 'Removed {count} bookmarks.',
} as const satisfies Messages;
