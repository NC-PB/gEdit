// The NC tab's "Cleanup" group: insert and remove spaces, remove empty lines, remove
// comments, convert case (contrib/ncCleanup.ts and core/transforms/*). Owner: WP4.3.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'NC',
  group: 'Cleanup',
  /** Shown after a run that broke a dialect's consecutive block numbers (Klartext). */
  renumberNeeded: 'The block numbers are no longer consecutive. Renumber the program before sending it.',
  renumberTitle: 'Renumber the program?',
  renumberMessage:
    'This control needs consecutive block numbers, and lines were removed. Renumber the program now?',
  renumberOk: 'Renumber',

  insertSpaces: {
    title: 'Insert Spaces',
    /** `count` is the number of lines the transform rewrote. */
    summary_one: 'Inserted spaces in 1 line.',
    summary_other: 'Inserted spaces in {count} lines.',
    summaryNone: 'Nothing to do: the words are already separated.',
    skipped: 'Left as written: the spaced line would not read back the same way.',
  },

  removeSpaces: {
    title: 'Remove Spaces',
    unavailable: '{profile} separates its words with spaces, so they cannot be removed.',
    summary_one: 'Removed spaces in 1 line.',
    summary_other: 'Removed spaces in {count} lines.',
    summaryNone: 'Nothing to do: there is no space that may go.',
    skipped: 'Left as written: joining the words would change them.',
  },

  removeEmptyLines: {
    title: 'Remove Empty Lines',
    summary_one: 'Removed 1 empty line.',
    summary_other: 'Removed {count} empty lines.',
    summaryNone: 'Nothing to do: there is no empty line.',
  },

  removeComments: {
    title: 'Remove Comments…',
    unavailable: '{profile} has no comment syntax.',
    dropEmptied: 'Remove lines that become empty',
    dropEmptiedHelp: 'A line that held nothing but a comment is removed instead of left blank.',
    keepProgramName: 'Keep the program-name comment',
    keepProgramNameHelp: 'The comment on the program-number line, which the control shows in its directory.',
    keepFirstLines: 'Keep comments in the first lines',
    keepFirstLinesHelp: 'The header block, counted from the start of the document. 0 keeps none.',
    keepSectionHeadings: 'Keep section headings',
    keepSectionHeadingsHelp: 'Structure blocks such as * - ROUGH, which the control lists as sections.',
    summary_one: 'Removed 1 comment.',
    summary_other: 'Removed {count} comments.',
    summaryNone: 'Nothing to do: no comment was removed.',
    keptHeader: 'Comment kept: it is inside the header.',
    keptProgramName: 'Comment kept: it is the program name.',
    keptSection: 'Comment kept: it is a section heading.',
  },

  convertCase: {
    title: 'Convert Case…',
    unavailable: '{profile} reads upper and lower case as different code.',
    case: 'Convert to',
    upper: 'UPPER CASE',
    lower: 'lower case',
    excludeComments: 'Leave comments as they are',
    excludeCommentsHelp: 'Tool names and other text in quotes are always left alone.',
    summaryUpper_one: 'Converted 1 line to upper case.',
    summaryUpper_other: 'Converted {count} lines to upper case.',
    summaryLower_one: 'Converted 1 line to lower case.',
    summaryLower_other: 'Converted {count} lines to lower case.',
    summaryNone: 'Nothing to do: the case is already as asked.',
    skipped: 'Left as written: the converted line would read back differently.',
    /** Confirmation before writing lower case for a control that only reads upper case. */
    lowerOnUppercaseControl:
      '{profile} expects programs in upper case, and a control that expects it may refuse a program written any other way. Convert to lower case anyway?',
    /** Results row: `ß` → `SS` and the like, where the conversion would change the length. */
    lengthChanged: 'Left as written: converting the case of this text would change its length, and the offsets behind it.',
  },
} as const satisfies Messages;
