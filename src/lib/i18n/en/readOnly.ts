// Read-only documents: the lock in the tab and the status bar, the message Monaco shows
// a refused keystroke, and the Save that goes to Save As (WP7.3: `app/fileOps.ts`,
// `monaco/editorService.ts`, `contrib/readOnly.ts`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Two locks, two wordings, and they must not be confused (AD-23): `attribute` is the
// file's own read-only bit, which gEdit never changes, and `user` is the lock the
// programmer put on this tab to keep a hand off a proven program. Unlocking an
// `attribute` document frees the buffer and nothing else, so every message about it says
// where the text will go instead.

import type { Messages } from '../types';

export default {
  // Command and palette
  category: 'File',
  toggle: 'Lock Against Editing',

  /** Monaco's own message on a refused keystroke; it is markdown, so no line breaks. */
  editorMessage: 'This document is locked against editing. Use File ▸ Lock Against Editing to unlock it.',

  // Status bar (`data-item="readonly"`) and the tab
  item: 'Read-only',
  itemAttribute: '{name} is marked read-only on disk. The text can be unlocked here, but saving it always asks where to put it: gEdit never changes a file’s attributes.',
  itemUser: '{name} is locked against editing in this tab. Nothing on disk was changed.',
  tabTitle: 'Read-only',

  // Status messages
  opened: '{name} is read-only and opened locked',
  locked: '{name} is locked against editing',
  unlocked: '{name} can be edited again',
  /** The file itself is read-only, so the save needs a different file (AD-23). */
  saveAsInstead: '{name} is read-only, so choose where to save it',
} as const satisfies Messages;
