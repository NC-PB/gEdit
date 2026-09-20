// The program map panel (contrib/programMap.ts). Owner: WP1.5, kinds added by WP3.5.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// `kinds` is the screen-reader name of a row; the icon carries it for everyone else. The
// row's text is program data (a tool number, a comment) and stays untranslated (AD-14).

import type { Messages } from '../types';

export default {
  title: 'Program Map',
  empty: 'Nothing to list for this program.',
  noDocument: 'Open a program to see its structure.',
  lineTooltip: 'Line {line}',
  kinds: {
    tool: 'Tool call',
    program: 'Program',
    section: 'Section',
    comment: 'Comment',
    label: 'Label',
    stop: 'Program stop',
    end: 'Program end',
    subprogramCall: 'Subprogram call',
  },
} as const satisfies Messages;
