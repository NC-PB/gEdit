// Words shared by several features: dialog buttons, generic labels and counts.
// Feature-specific strings belong in the feature's own namespace file.

import type { Messages } from '../types';

export default {
  ok: 'OK',
  cancel: 'Cancel',
  close: 'Close',
  apply: 'Apply',
  reset: 'Reset',
  yes: 'Yes',
  no: 'No',
  open: 'Open',
  save: 'Save',
  saveAs: 'Save As…',
  dontSave: "Don't Save",
  browse: 'Browse…',
  run: 'Run',
  untitled: 'Untitled',
  none: 'None',
  error: 'Error',
  warning: 'Warning',
  unknownError: 'Unknown error',
  lineNumber: 'Line {line}',
  lines_one: '{count} line',
  lines_other: '{count} lines',
  files_one: '{count} file',
  files_other: '{count} files',
} as const satisfies Messages;
