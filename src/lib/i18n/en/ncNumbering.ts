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

    /**
     * Confirmation before the run; the user may still say no.
     *
     * M6: the references this run *can* follow are rewritten and are not asked about. What
     * is left is the ones it cannot — a target that is not there, one that is there twice,
     * one outside the renumbered lines, a pointer from outside them into them, or a rule
     * that says the block may be in the calling program.
     */
    references_one:
      'This program has {count} line that points at a block number this run cannot follow ({first}). It is left as it is, so the jump would end up somewhere else. Renumber anyway?',
    references_other:
      'This program has {count} lines that point at block numbers this run cannot follow (the first is line {first}). They are left as they are, so the jumps would end up somewhere else. Renumber anyway?',
    consecutiveSelection:
      'This dialect numbers every block consecutively from {start}, so numbering only the selection does not fit the blocks around it. Renumber the selection anyway?',
    /** The run has only a fragment and the dialect joins blocks across lines. */
    fragmentUnknown:
      'This run cannot see the lines above the selection, and in this dialect a block may continue over several lines. The first selected lines could be the tail of a block above, which must not get a number of its own. Renumber anyway?',
    /** The scan could not look outside the selection at all. */
    referencesUnchecked:
      'This run cannot see the rest of the program, so a jump into these blocks could neither be looked for nor rewritten. Renumber anyway?',
    /** M6 (G8): the numbering may run past the maximum, and then no rewritten value is unique. */
    referencesMayWrap:
      'This run may need more block numbers than the maximum ({max}) allows. The numbering would start over at {start}, the same number would end up on several blocks, and a control takes the first one it finds — so the {count} jumps and cycle calls of this program are reported instead of rewritten. Give a larger maximum, a smaller increment or "Stop and warn". Renumber anyway?',

    /** Warnings, shown next to the results table. */
    overflowStopped:
      'Stopped at line {line}: the next number would be above {max}. The lines from there on keep the numbers they had.',
    wrapped_one:
      'The numbers passed {max} once and started over at {start} (first at line {line}), so the program now has duplicate block numbers. A control takes the first match, and block search, GOTO and M99 P become ambiguous. Use a larger maximum, a smaller increment, or "Stop and warn".',
    wrapped_other:
      'The numbers passed {max} {count} times and started over at {start} (the first at line {line}), so the program now has duplicate block numbers. A control takes the first match, and block search, GOTO and M99 P become ambiguous. Use a larger maximum, a smaller increment, or "Stop and warn".',
    skippedTruncated: 'The table lists the first {shown} of {total} skipped lines.',
    /** M6: the three outcomes of a reference. Rewritten is good news and says so plainly. */
    referencesRewritten_one: '{count} jump, return or cycle was rewritten with the new block number.',
    referencesRewritten_other: '{count} jumps, returns and cycles were rewritten with the new block numbers.',
    referencesKept_one: '{count} reference names a block of the calling program and was left as it is; check it.',
    referencesKept_other: '{count} references name blocks of the calling program and were left as they are; check them.',
    referencesUnresolved_one: '{count} reference could not be followed and was left as it is; check it.',
    referencesUnresolved_other: '{count} references could not be followed and were left as they are; check them.',

    /** Row text in the results table (display text, not keys). */
    skippedByPrefix: 'Skipped: the line starts with one of the skipped prefixes.',
    skippedName: 'Skipped: the block carries a name, not a number.',
    skippedNotNumbered: 'Skipped: the block had no number and only numbered blocks are renumbered.',
    skippedStopped: 'Skipped: numbering stopped at the maximum.',
    skippedProgramMarker: 'Skipped: this is a program marker, not a block.',
    referenceKeptRow: 'This block number may be in the calling program, which this file does not show, so it was left as it is.',
    referenceMissingRow: 'This line points at a block number that this program does not have, so it was left as it is.',
    referenceDuplicateRow: 'This line points at a block number that this program uses more than once, so it was left as it is.',
    referenceOutsideRow: 'This line points at a block outside the renumbered lines, which keeps the number it has.',
    referenceIncomingRow: 'This line is outside the renumbered lines and points into them, so its target now has a different number.',
    referenceNotNumberRow: 'This reference is a variable or an expression, not a block number, so it was left as it is.',
    referenceAmbiguousRow:
      'This block carries the same address twice, so which of the two words names a block number cannot be told from the line; both were left as they are.',
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
    /** M6: every number in the scope is pointed at, so `keepReferenced` left them all. */
    allKept_one: 'Kept {count} block number: a jump, a return or a cycle points at it.',
    allKept_other: 'Kept all {count} block numbers: a jump, a return or a cycle points at each of them.',
    nothing: 'No block numbers to remove here.',

    /**
     * Confirmations. Removing a block number deletes the jump target outright, which is
     * worse than renumbering it, so the wording is blunter than the renumber one. M6:
     * asked only when "Keep numbers that are pointed at" is off, because with it on there
     * is no jump target left to delete.
     */
    references_one:
      'This program has {count} line that points at a block number ({first}). Removing the numbers deletes the block it points at, and the control will alarm. Remove them anyway?',
    references_other:
      'This program has {count} lines that point at block numbers (the first is line {first}). Removing the numbers deletes the blocks they point at, and the control will alarm. Remove them anyway?',
    referencesUnchecked:
      'This run cannot see the rest of the program, so a jump into these blocks could not be looked for and their numbers cannot be kept for it. Remove them anyway?',
    /**
     * M6 (G8): asked with "Keep numbers that are pointed at" **on**, for the one kind of
     * reference it cannot keep — `GOTO #100`, whose target is worked out while the
     * program runs and is therefore not a number this run can hold on to.
     */
    computed_one:
      'This program has {count} line whose jump is worked out while the program runs ({first}), so the block it lands on cannot be named here and its number cannot be kept. Remove the block numbers anyway?',
    computed_other:
      'This program has {count} lines whose jumps are worked out while the program runs (the first is line {first}), so the blocks they land on cannot be named here and their numbers cannot be kept. Remove the block numbers anyway?',
    fragmentUnknown:
      'This run cannot see the lines above the selection, and in this dialect a block may continue over several lines. Remove the block numbers anyway?',

    emptied_one: '{count} line held nothing but its block number and is now empty.',
    emptied_other: '{count} lines held nothing but their block number and are now empty.',
    emptiedRow: 'This line held nothing but its block number and is now empty.',
    referencesKept_one: '{count} line still points at a block number that is now gone; fix it before sending the program.',
    referencesKept_other: '{count} lines still point at block numbers that are now gone; fix them before sending the program.',
    referenceRow: 'This line points at a block number, and that number has been removed.',
    keptReferenced_one: '{count} block number was kept because a jump, a return or a cycle points at it.',
    keptReferenced_other: '{count} block numbers were kept because a jump, a return or a cycle points at them.',
    keptReferencedRow: 'Kept: a jump, a return or a cycle points at this block number.',
    referencesComputed_one:
      '{count} jump is worked out while the program runs, so the block number it lands on could not be kept; fix it before sending the program.',
    referencesComputed_other:
      '{count} jumps are worked out while the program runs, so the block numbers they land on could not be kept; fix them before sending the program.',
    computedRow:
      'This jump is worked out while the program runs, so the block it lands on cannot be named here and its number was not kept.',
    skippedTruncated: 'The table lists the first {shown} of {total} lines.',

    fields: {
      keepReferenced: {
        label: 'Keep numbers that are pointed at',
        help: 'A block number that a jump, a return or a turning cycle names stays where it is. Switch it off to remove every number; the program will then need its jumps fixed by hand.',
      },
    },
  },
} as const satisfies Messages;
