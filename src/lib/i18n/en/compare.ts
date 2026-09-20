// Compare: the diff overlay, its toolbar and the pickers. Owner: WP2.5.
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
  diffFailed: 'The comparison could not be opened: {error}',
} as const satisfies Messages;
