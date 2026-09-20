// File commands, the save and close dialogs, drag and drop (WP1.6: `app/fileOps.ts`,
// `app/dialogs.ts`, `contrib/files.ts`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// The button labels `common.save`, `common.dontSave` and `common.cancel` are shared, so
// the unsaved-changes alert keeps the exact wording the M0 runtime scenarios assert.

import type { Messages } from '../types';

export default {
  // Ribbon and palette
  category: 'File',
  groupFile: 'File',
  new: 'New',
  open: 'Open…',
  save: 'Save',
  saveAs: 'Save As…',
  saveAll: 'Save All',
  close: 'Close',
  closeAll: 'Close All',
  closeWindow: 'Close Window',

  // Native dialog titles
  openTitle: 'Open',
  saveAsTitle: 'Save As',

  // Window title: "● program.nc — gEdit"
  windowTitle: '{name} — gEdit',
  windowTitleDirty: '● {name} — gEdit',

  // Status bar
  modified: 'Modified',
  noDocument: 'No document',

  // Status messages
  opened: 'Opened {name}',
  openedMany_one: 'Opened {count} file',
  openedMany_other: 'Opened {count} files',
  focused: '{name} is already open',
  saved: 'Saved {name}',
  savedAsUtf8: 'Saved {name} as UTF-8',
  savedAll_one: 'Saved {count} document',
  savedAll_other: 'Saved {count} documents',
  unchanged: '{name} is unchanged since it was last opened or saved',
  reloaded: 'Reloaded {name}',
  nulStripped_one: 'Removed {count} NUL byte from {name}; save it to write the change',
  nulStripped_other: 'Removed {count} NUL bytes from {name}; save it to write the change',
  eolMixed: '{name} has mixed line endings and will be saved with {eol}',
  folderIgnored_one: '{count} folder was ignored: only files can be opened',
  folderIgnored_other: '{count} folders were ignored: only files can be opened',
  desktopOnly: 'File operations are only available in the gEdit desktop app',

  /** A UTF-16 file has to start with its byte order mark, so it cannot carry a tape leader. */
  tapeDropped: 'the punched-tape leader and trailer were not written: UTF-16 cannot carry them',

  /** A drop or a multi-select that this app cannot reach at all (G8 F3). */
  dropRefused_one: '{count} item could not be opened: it is gone, or gEdit was not given access to it',
  dropRefused_other: '{count} items could not be opened: they are gone, or gEdit was not given access to them',
  tooManyAtOnce: 'Only the first {count} of {total} files were opened',

  // Errors
  openFailed: 'Could not open {name}',
  saveFailed: 'Could not save {name}',
  tooLarge: '{name} is {size}, which is more than the {limit} gEdit can open',
  reloadFailed: 'Could not reload {name}',
  dialogFailed: 'Could not open the file dialog',
  saveDialogFailed: 'Could not open the save dialog',
  guardFailed: 'Could not install the unsaved-changes guard',
  dropFailed: 'Could not open the dropped files',
  alreadyOpen: 'Another tab already holds {name}. Close it first or pick a different file.',

  /** A file whose NUL share is above the 10 % limit is data, not a program (AD-7). */
  binaryRefused: 'This file is {percent}% NUL bytes, so it is data rather than a program.',

  // Unsaved changes: one document (the M0 wording) and the combined dialog for several
  unsavedTitle: 'Unsaved Changes',
  unsavedMessage:
    "Do you want to save the changes you made to {name}?\n\nYour changes will be lost if you don't save them.",
  unsavedManyMessage:
    "Do you want to save the changes you made to these documents?\n\n{list}\n\nYour changes will be lost if you don't save them.",
  unsavedMore: '+{count} more',
  saveAllButton: 'Save All',
  discardAllButton: 'Discard All',

  // The file changed on disk since it was opened or last saved (G8 F5; the poll and the
  // banner of AD-10 are M2, this is the guard on the write itself)
  changedOnDiskTitle: 'Changed on Disk',
  changedOnDiskMessage:
    '{name} has changed on disk since it was opened or last saved.\n\nSaving now replaces what is on disk with the text in this tab.',
  overwriteButton: 'Overwrite',

  // A write that failed partway: the file was truncated before the new content was
  // written, so the buffer may hold the only complete copy (AD-7 writes in place)
  saveFailedTitle: 'Save Failed',
  saveFailedMessage:
    '{name} could not be written:\n{detail}\n\nThe file on disk may now be incomplete. This tab still holds the full text — save it somewhere else?',

  // Windows-1252 cannot store a character the buffer holds (AD-7)
  encodingTitle: 'Encoding',
  encodingFallback:
    '{name} uses the Windows-1252 encoding, which cannot store "{char}" ({code}, line {line}, column {column}).\n\nSave it as UTF-8 instead? Software that expects Windows-1252 may then show accented characters incorrectly.',
  saveAsUtf8Button: 'Save as UTF-8',
} as const satisfies Messages;
