// Typing options: upper case while typing and no accidental join of two blocks (plan §6 M13,
// AD-30, §7.13). Owner: WP13.4; the category, the ribbon group and the command title were
// pinned by the M13 prelude (P13); WP13.4 adds the rest.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Edit',
  /** Caption of the Edit-tab group (`{ tab: 'edit', group: 'typing.group' }`), after Go To. */
  group: 'Typing',
  /** `edit.toggleForceUppercase`: upper-case typing off or on again, for this session only. */
  toggleForceUppercase: 'Upper-Case Typing',
  /** Status message after the toggle; comments, strings and kept text are named so the rule is not a surprise. */
  upperOn: 'Upper-case typing is on for this session. Comments, strings and kept text stay as typed.',
  upperOff: 'Upper-case typing is off for this session.',
  /** The toggle on a document that is not an NC program (a profile, a settings file or a script). */
  notHere: 'Upper-case typing is for NC programs. It does not act in .json and .py files.',
  /** Shown when Backspace in column 1 or Delete at the end of a line was refused (`editing.preventLineJoin`). */
  noJoin: 'Not joined: that would run two blocks together. Select the line break to delete it.',
} as const satisfies Messages;
