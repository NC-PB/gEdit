// The program map panel. Owner: WP1.5.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  title: 'Program Map',
  empty: 'No tool calls or independent comments found in this program.',
  noDocument: 'Open a program to see its structure.',
  tool: 'Tool call',
  comment: 'Comment',
  lineTooltip: 'Line {line}',
} as const satisfies Messages;
