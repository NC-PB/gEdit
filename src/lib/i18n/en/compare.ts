// Compare: the diff overlay, its toolbar and the pickers. Owner: WP2.5; M11: WP11.3.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Compare',
  title: 'Compare',
  group: 'Compare',

  // Commands
  with: 'Compare With…',
  withDocument: 'Compare with Open Document…',
  withFile: 'Compare with File…',
  withSaved: 'Compare with Saved Version',
  close: 'Close Comparison',
  nextDiff: 'Next Difference',
  prevDiff: 'Previous Difference',
  toggleInline: 'Inline View',
  // M11 (§7.13): the commands P11 pinned.
  /** `compare.copyToModified`, `Mod+Alt+Right` while a comparison is open (original → current). */
  copyToModified: 'Copy Change to Current Document',
  /** `compare.copyToOriginal`, `Mod+Alt+Left` while a comparison is open (current → original). */
  copyToOriginal: 'Copy Change to Original',
  exportDiff: 'Export Differences…',
  /** `compare.files`: two picks, both opened as documents, then compared. */
  files: 'Compare Two Files…',
  /** `compare.toggleReview`: raw ↔ review mode. */
  toggleReview: 'Review Mode',

  // Pickers
  pickSource: 'Compare the current document with…',
  pickDocument: 'Compare with which document?',
  pickFileTitle: 'Choose a file to compare with',
  sourceSaved: 'Saved version',
  sourceSavedDetail: 'The file on disk, as it was last saved',
  sourceDocument: 'Open document…',
  sourceDocumentDetail: 'Another tab',
  sourceFile: 'File…',
  sourceFileDetail: 'Any file on disk',

  // Titles of an open comparison
  titleSaved: '{name} ↔ saved version',
  titleDocument: '{name} ↔ {other}',
  titleFile: '{name} ↔ {file}',

  // Review mode (M11, AD-26)
  modeRaw: 'Raw',
  modeReview: 'Review',
  reviewBar: 'Review options',
  optionIgnoreBlockNumbers: 'Block numbers',
  optionIgnoreWhitespace: 'Whitespace',
  optionIgnoreComments: 'Comments',
  optionIgnoreCase: 'Case',
  optionIgnoreNumberFormat: 'Number format',
  /** §7.16 #148: the Klartext cycle names (`CYCL DEF 200 BOHREN`), offered only where a profile declares them. */
  optionIgnoreCycleNames: 'Cycle names',
  optionHint: 'Ignore differences in: {what}',
  profileDefaults: 'Profile defaults',
  profileDefaultsHint: 'Back to what the {profile} profile ignores',
  gotoLine: 'Go to line',
  gotoLineHint: 'Line of the file, as numbered before review; Shift+Enter for the original side',
  copyToModifiedShort: '→',
  copyToOriginalShort: '←',
  copyTitle: '{action}. Shift+click copies only the line at the cursor.',
  labelOriginal: 'the original',
  labelModified: 'the current document',
  machineNone: 'no machine',
  noteMachines: 'The two sides use different machines ({original} and {modified}); each is read with its own.',
  noteProfiles: 'The two sides are different dialects ({original} and {modified}); each is read with its own.',
  noteNoMachine: 'No machine for {side}: it is a file that is not open as a document.',
  noteBlockNumbers: 'Block numbers kept in {side}: line {line} jumps to a computed target.',
  notePointWithoutMachine: 'No machine is chosen for {side}: a decimal point counts, because the profile\'s number readings differ on it.',

  // Toolbar
  sideBySide: 'Side by side',
  inline: 'Inline',
  ignoreWhitespace: 'Ignore whitespace',
  original: 'Original (read-only)',
  modified: 'Current document',
  empty: 'There is nothing to compare.',

  // Failures
  noDocument: 'There is no document to compare.',
  noOtherDocument: 'Open a second document to compare with.',
  sameDocument: 'A document cannot be compared with itself.',
  untitled: 'An unsaved document has no saved version yet.',
  readFailed: 'Could not read {file}.',
  tooLarge: 'Files above {limit} cannot be compared.',
  copyReview: 'Changes can be copied in raw mode only.',
  copyNotDocument: 'The original is not an open document, so it cannot be changed.',
  copyLocked: 'The document to copy into is read-only.',
  copyBusy: 'The comparison is still updating. Try again in a moment.',
  copyNoChange: 'There is no change at the cursor to copy.',
  noSuchLine: 'There is no such line in this comparison.',
  noDifferences: 'There are no differences.',
  sideSaved: '{name} (saved version)',
  pickOriginalTitle: 'Choose the original file',
  pickModifiedTitle: 'Choose the file to compare it with',
  sameFile: 'Choose two different files.',
  diffFailed: 'The comparison could not be opened: {error}',
} as const satisfies Messages;
