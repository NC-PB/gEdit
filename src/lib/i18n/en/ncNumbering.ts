// Block numbering: renumber and remove block numbers (contrib/ncNumbering.ts,
// core/transforms/{renumber,removeBlockNumbers}.ts). Owner: WP4.2.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Three kinds of message live here, and they reach the user by three different routes:
//
//   - command and transform titles, resolved by the ribbon and the palette
//   - `Msg` keys returned by `available`, `preflight`, `summary` and `warnings`, resolved
//     by `TransformService` (WP4.1)
//   - the `label`, `help` and `Located.message` strings a transform resolves itself,
//     because those two contract fields are display text and not keys (plan §7.5, §7.1)

import type { Messages } from '../types';

export default {
  category: 'NC',
  /** Caption of the NC-tab ribbon group. */
  group: 'Numbering',

  renumber: {
    title: 'Renumber Blocks…',
    /** Shown while the transform cannot run on this dialect. Unused today; kept with `available()`. */
    unavailable: 'This dialect does not number blocks.',

    summary_one: 'Renumbered {count} block.',
    summary_other: 'Renumbered {count} blocks.',
    summarySkipped_one: 'Renumbered {count} block, skipped {skipped} lines.',
    summarySkipped_other: 'Renumbered {count} blocks, skipped {skipped} lines.',
    nothing: 'Nothing to renumber here.',

    /** Confirmation before the run; the user may still say no. */
    references_one:
      'This program has {count} line that points at a block number ({first}). Renumbering does not rewrite it, so the jump would end up somewhere else. Renumber anyway?',
    references_other:
      'This program has {count} lines that point at block numbers (the first is line {first}). Renumbering does not rewrite them, so the jumps would end up somewhere else. Renumber anyway?',
    consecutiveSelection:
      'This dialect numbers every block consecutively from {start}, so numbering only the selection does not fit the blocks around it. Renumber the selection anyway?',
    /** The run has only a fragment and the dialect joins blocks across lines. */
    fragmentUnknown:
      'This run cannot see the lines above the selection, and in this dialect a block may continue over several lines. The first selected lines could be the tail of a block above, which must not get a number of its own. Renumber anyway?',
    /** The scan could not look outside the selection at all. */
    referencesUnchecked:
      'This run cannot see the rest of the program, so a jump to one of these block numbers could not be looked for. Renumbering does not rewrite a jump. Renumber anyway?',

    /** Warnings, shown next to the results table. */
    overflowStopped:
      'Stopped at line {line}: the next number would be above {max}. The lines from there on keep the numbers they had.',
    wrapped_one:
      'The numbers passed {max} once and started over at {start} (first at line {line}), so the program now has duplicate block numbers. A control takes the first match, and block search, GOTO and M99 P become ambiguous. Use a larger maximum, a smaller increment, or "Stop and warn".',
    wrapped_other:
      'The numbers passed {max} {count} times and started over at {start} (the first at line {line}), so the program now has duplicate block numbers. A control takes the first match, and block search, GOTO and M99 P become ambiguous. Use a larger maximum, a smaller increment, or "Stop and warn".',
    skippedTruncated: 'The table lists the first {shown} of {total} skipped lines.',
    referencesKept_one: '{count} block-number reference was left as it was; check it.',
    referencesKept_other: '{count} block-number references were left as they were; check them.',

    /** Row text in the results table (display text, not keys). */
    skippedByPrefix: 'Skipped: the line starts with one of the skipped prefixes.',
    skippedName: 'Skipped: the block carries a name, not a number.',
    skippedNotNumbered: 'Skipped: the block had no number and only numbered blocks are renumbered.',
    skippedStopped: 'Skipped: numbering stopped at the maximum.',
    skippedProgramMarker: 'Skipped: this is a program marker, not a block.',
    referenceKept: 'This line points at a block number, which was not rewritten.',
    wrappedRow: 'The numbering started over here: this block number is used twice in the program.',

    fields: {
      start: { label: 'Start at', help: 'The number the first block gets.' },
      step: { label: 'Increment' },
      digits: { label: 'Digits', help: 'Pad with leading zeros to this many digits. 0 writes the number as short as it is.' },
      max: { label: 'Maximum', help: 'Leave empty for no maximum.' },
      onOverflow: {
        label: 'Above the maximum',
        wrap: 'Start over at the start value',
        stop: 'Stop and warn',
      },
      spacesAfter: { label: 'Spaces after the number' },
      skipStartingWith: {
        label: 'Skip lines starting with',
        help: 'Separated by spaces. Leave empty to number every line.',
      },
      skipEmpty: { label: 'Skip empty lines' },
      restartAtProgramStart: { label: 'Start over at each program start' },
      onlyNumbered: { label: 'Only renumber blocks that already have a number' },
      altPrefixes: {
        label: 'Also read these as a block number',
        help: 'Separated by spaces. The new numbers are always written with the profile prefix.',
      },
    },
  },

  removeBlockNumbers: {
    title: 'Remove Block Numbers',
    /** `available()`: a control that needs numbers would refuse the whole program. */
    mandatory: 'This dialect needs a number on every block, so they cannot be removed.',

    summary_one: 'Removed {count} block number.',
    summary_other: 'Removed {count} block numbers.',
    nothing: 'No block numbers to remove here.',

    /**
     * Confirmations. Removing a block number deletes the jump target outright, which is
     * worse than renumbering it, so the wording is blunter than the renumber one.
     */
    references_one:
      'This program has {count} line that points at a block number ({first}). Removing the numbers deletes the block it points at, and the control will alarm. Remove them anyway?',
    references_other:
      'This program has {count} lines that point at block numbers (the first is line {first}). Removing the numbers deletes the blocks they point at, and the control will alarm. Remove them anyway?',
    referencesUnchecked:
      'This run cannot see the rest of the program, so a jump to one of these block numbers could not be looked for. Removing a number deletes the block it points at. Remove them anyway?',
    fragmentUnknown:
      'This run cannot see the lines above the selection, and in this dialect a block may continue over several lines. Remove the block numbers anyway?',

    emptied_one: '{count} line held nothing but its block number and is now empty.',
    emptied_other: '{count} lines held nothing but their block number and are now empty.',
    emptiedRow: 'This line held nothing but its block number and is now empty.',
    referencesKept_one: '{count} line still points at a block number that is now gone; fix it before sending the program.',
    referencesKept_other: '{count} lines still point at block numbers that are now gone; fix them before sending the program.',
    referenceRow: 'This line points at a block number, and that number has been removed.',
    skippedTruncated: 'The table lists the first {shown} of {total} lines.',
  },
} as const satisfies Messages;
