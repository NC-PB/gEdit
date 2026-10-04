// Block skip: insert and remove the skip mark on a selection (contrib/ncBlockSkip.ts,
// core/transforms/blockSkip.ts). Owner: WP10.1 (plan §6 M10); the keys `category`, `group`,
// `add` and `remove` were pinned by the M10 prelude (P10, §7.13) so the ribbon entries and
// their titles were agreed before the contribution existed.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'NC',
  /** Caption of the NC-tab ribbon group (`{ tab: 'nc', group: 'ncBlockSkip.group' }`). */
  group: 'Block Skip',
  /** `nc.blockSkip.add`: no default key (§7.13). */
  add: 'Insert Block Skip…',
  /** `nc.blockSkip.remove`: no default key (§7.13). */
  remove: 'Remove Block Skip…',

  /** `profile` is the dialect's name. */
  unavailable: '{profile} has no block skip mark.',
  plain: 'Plain (/)',
  allLevels: 'All levels',

  fields: {
    level: {
      label: 'Skip level',
      addHelp: 'Plain writes the mark without a level. A level writes /1 to /9, for controls with several skip switches.',
      removeHelp: 'Only marks of this level are removed; marks of other levels stay.',
    },
  },

  addRun: {
    /** The confirmation before a run on the whole program. */
    wholeProgram:
      'Nothing is selected, so every line of the program will be marked as skipped. Select the lines to mark, or continue to mark them all.',
    summary_one: 'Marked 1 block as skipped.',
    summary_other: 'Marked {count} blocks as skipped.',
    nothing: 'Nothing to mark: the selection has no block that can take a skip mark.',
    already_one: '1 block already had a skip mark and was left as it is.',
    already_other: '{count} blocks already had a skip mark and were left as they are.',
    startsInside:
      'The selection starts inside a block that begins above it. That block was not marked; select from its first line to skip it.',
    programRow: 'Left unmarked: a skipped program number or file header would hide the program from the control.',
    /** `level` is the mark the line carries, e.g. `/1`. */
    otherLevelRow: 'Already skipped at another level ({level}); left as it is.',
  },
  removeRun: {
    summary_one: 'Removed the skip mark from 1 block.',
    summary_other: 'Removed the skip mark from {count} blocks.',
    nothing: 'Nothing to remove: no block in the selection carries a skip mark of that level.',
    keptLevels_one: '1 skip mark of another level was kept.',
    keptLevels_other: '{count} skip marks of other levels were kept.',
    /** `level` is the mark that stays, e.g. `/3`. */
    keptRow: 'Kept: still skipped at {level}.',
  },
} as const satisfies Messages;
