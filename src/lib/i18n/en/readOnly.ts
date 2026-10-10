// Read-only documents: the lock in the tab and the status bar, the message Monaco shows
// a refused keystroke, the Save that goes to Save As, and the transform, script or block
// the lock refuses (WP7.3: `app/fileOps.ts`, `monaco/editorService.ts`,
// `contrib/readOnly.ts`, `app/readOnlyLock.ts`).
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
  editorMessage:
    'This document is locked against editing. To unlock it, click Read-only in the status bar or use Lock Against Editing in the command palette (F1).',

  // Status bar (`data-item="readonly"`) and the tab
  item: 'Read-only',
  itemAttribute: '{name} is marked read-only on disk. The text can be unlocked here, but saving it always asks where to put it: gEdit never changes a file’s attributes.',
  itemUser: '{name} is locked against editing in this tab. Nothing on disk was changed.',
  itemBinary:
    '{name} is more than 10 % NUL bytes, so it is data rather than a program. It is open to look at only: it cannot be edited or changed by a transform or script, and it cannot be unlocked.',
  tabTitle: 'Read-only',
  /** The status message when such a file opens. */
  openedBinary: '{name} is {percent} % NUL bytes: opened read-only, because it is data rather than a program',
  /** Lock Against Editing on such a document. */
  binaryStaysLocked: '{name} is mostly NUL bytes and stays read-only',
  binarySaveAsSame: '{name} is read-only data. Choose another file name to save a copy.',

  // Status messages
  opened: '{name} is read-only and opened locked',
  locked: '{name} is locked against editing',
  unlocked: '{name} can be edited again',
  /** The file itself is read-only, so the save needs a different file (AD-23). */
  saveAsInstead: '{name} is read-only, so choose where to save it',

  // A change that is not typing, refused before it runs (`app/readOnlyLock.ts`). `action`
  // is display text: a transform's title, a script's name, `insertTemplate` below.
  refusedUser:
    '{name} is locked against editing, so {action} did not run. To unlock it, click Read-only in the status bar or use Lock Against Editing in the command palette (F1).',
  refusedAttribute:
    '{name} is read-only on disk and opened locked, so {action} did not run. To unlock the text, click Read-only in the status bar or use Lock Against Editing in the command palette (F1); saving it then asks where to put it.',
  refusedBinary:
    '{name} is mostly NUL bytes (data, not a program) and is open read-only, so {action} did not run.',
  /** P3.5: the action of a template insert; {template} is the template's label (data). */
  insertTemplate: 'Insert {template}',
  /** P3.5: the action of Edit Cycle. */
  editCycle: 'Edit Cycle',
  /** The document was locked while the script ran; its result goes nowhere without asking. */
  lockedDuringRunTitle: 'The program was locked while the script ran',
  lockedDuringRunMessage:
    '{name} was locked while {script} was running, so its result was not written into it. Open the result in a new tab instead?',
} as const satisfies Messages;
