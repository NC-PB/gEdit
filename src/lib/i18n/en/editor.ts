// The editor surface: the Monaco host and the cursor status item (contrib/cursor.ts).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// `position` must keep the shape "Ln 1, Col 1": the runtime scenarios read the cursor
// status item's text (tests/runtime/scenarios/m0-main.js).

import type { Messages } from '../types';

export default {
  loadFailed: 'The editor failed to load: {error}',
  position: 'Ln {line}, Col {column}',
  selectedChars: '({count} selected)',
  selectionCount: '({count} selections)',
} as const satisfies Messages;
