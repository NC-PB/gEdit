// Encoding and line-ending status items and pickers (WP1.6: `contrib/encoding.ts`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// The encoding names themselves ('UTF-8', 'Windows-1252', …) come from
// `encodingLabel()` in `core/text`: they are standard identifiers, not prose, and stay
// untranslated the way profile names do (contrib README rule 3). The same holds for
// 'CRLF', 'LF' and 'CR'.

import type { Messages } from '../types';

export default {
  category: 'File',

  // Commands
  setEncoding: 'Change Encoding…',
  setEol: 'Change Line Endings…',

  // Status items
  encodingTooltip: 'File encoding: {name}. Click to change it.',
  eolTooltip: 'Line endings: {name}. Click to change them.',
  /** Shown while the file that was opened had more than one kind of line break (AD-7). */
  mixed: '{eol} (mixed)',

  // Pickers
  encodingPlaceholder: 'Write this document as…',
  eolPlaceholder: 'End the lines of this document with…',

  // Encoding descriptions
  utf8: 'Any character, no byte order mark',
  utf8Bom: 'Any character, with a byte order mark',
  cp1252: 'Western European single byte, what most CAM posts write',
  utf16le: 'Two bytes per character, little endian',
  utf16be: 'Two bytes per character, big endian',

  // Line-ending descriptions
  crlf: 'Windows and most controls',
  lf: 'Unix and macOS',
  cr: 'Classic Mac and some punched-tape posts',

  // Status messages
  encodingChanged: '{name} will be written as {encoding}',
  eolChanged: '{name} will be written with {eol} line endings',
} as const satisfies Messages;
