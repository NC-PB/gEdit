// Go to line or block, next and previous tool change (contrib/navigation.ts). Owner: WP3.5.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Navigate',
  goto: 'Go to Line or Block…',
  gotoTitle: 'Go to line or block',
  gotoPlaceholder: '120 or N120',
  /** Shown under the input while it does not hold something to go to. */
  gotoInvalid: 'Type a line number, or a block number with its letter: N120.',
  noLine: 'The program ends at line {last}.',
  noBlock: 'No block {number} in this program.',
  nextTool: 'Next Tool Change',
  prevTool: 'Previous Tool Change',
  noTools: 'This program has no tool changes.',
  wrappedToFirst: 'Wrapped around to the first tool change.',
  wrappedToLast: 'Wrapped around to the last tool change.',
} as const satisfies Messages;
