// Multi-channel programs (plan §6 M12, §7.17, AD-32). Owner: WP12.5. The command titles,
// the ribbon group, the category, the program problems of the resolution and the wait-code
// list messages were written by the M12 prelude (P12, §7.13); WP12.5 adds the rest.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Channels',
  /** Caption of the NC-tab ribbon group (`{ tab: 'nc', group: 'channels.group' }`). */
  group: 'Channels',
  /** Caption of the Tools-tab group of the check (`{ tab: 'tools', group: 'channels.toolsGroup' }`),
   *  beside the Scripts group that runs the M10 program checks. */
  toolsGroup: 'Channels',

  /** `channels.nextSyncPoint`, `Alt+F7`: the next mark of the channel at the cursor, wrapping. */
  nextSyncPoint: 'Next Sync Point',
  /** `channels.prevSyncPoint`, `Shift+Alt+F7`. */
  prevSyncPoint: 'Previous Sync Point',
  /** `channels.gotoPartner`, `Mod+Alt+P`: the same id in the next channel that has it. */
  gotoPartner: 'Go to the Matching Mark',
  /** `channels.select`: the channel status item's click. */
  select: 'Channel…',
  /** `channels.assign`: tie an open document to a channel by hand (`multi-file` only). */
  assign: 'Assign to Channel…',
  /** `channels.checkSync`: Tools tab, `channels.toolsGroup`, next to the M10 checks. */
  checkSync: 'Check Wait Codes',
  /** `channels.splitToDocuments`: `single-file` only; a one-way copy for reading. */
  splitToDocuments: 'Split into Channel Documents',
  /** `channels.testOnDocument`: the Channels tester's report in the Results panel. */
  testOnDocument: 'Test Channel Rules on Document',

  /** Problems of the resolution (`ChannelProblem.message`). */
  problems: {
    tooLong: 'The pattern is longer than {max} characters.',
    badPattern: 'The pattern is not a valid regular expression: {error}',
    noChannelInStart: 'Line {line} starts a section but names no channel.',
    unknownChannel: 'Line {line} names “{token}”, which is not a channel or alias of this machine.',
    tooManyStarts: 'Line {line} starts a section, but this machine has only {count} channels.',
    channelNotFound: 'Channel “{channel}” has no section in this program.',
    blockBroken: 'The channel rules of this machine are broken.',
    detail: '{text}',
    tooSlow: 'This program took too long to read for channels, so channels are off for it.',
    markerDisagrees: 'The header (line {line}) names {marker}, but the file name says {fileName}. The header is used.',
    markerConflict: 'Line {line} names {channel}, line {other} names {otherChannel}, so the channel of this program is not set.',
    siblingUnknown: 'Could not check whether the file for {channel} exists.',
    longLines: '{count} lines longer than {max} characters were not read for channels and wait codes.',
  },

  /** The program map. */
  map: {
    outside: 'Outside the channels',
    /** One row for all waits of a channel with more than `SYNC_ROWS_MAX` (outlineService). */
    waits_one: '{count} wait code (Alt+F7 steps through them)',
    waits_other: '{count} wait codes (Alt+F7 steps through them)',
  },

  /** The status item (`data-item="channel"`). */
  status: {
    channel: 'Channel: {name}',
    outside: 'Outside the channels',
    multi: '{name} ({index} of {count})',
    notOpen: '{name} not open',
    notFound: '{name} not found',
    unknown: '{name} could not be checked',
    unassigned: 'Channel: not set',
    broken: 'Channel rules are broken',
    tooltipSingle: 'One program holds all the channels.',
    tooltipMulti: 'One file for each channel.',
    foundSections: 'in this program, {count} sections',
    foundFileName: 'found by its file name',
    foundMarker: 'found by the marker in the program',
    foundAssigned: 'set by you',
    stateOpen: 'open',
    stateNotOpen: 'exists, not open',
    stateNotFound: 'not found',
    stateUnknown: 'could not be checked',
    unassignedTooltip: 'This program is not tied to a channel yet. Click to choose one.',
    /** The resolution ran out of its time (`channels.problems.tooSlow`): said, never silent (M12 fix F4). */
    tooSlow: 'Channels: too slow to read',
  },

  pick: {
    placeholder: 'Channels',
    thisDocument: 'this document',
    lines: 'Lines {lines}',
    open: 'Open the other channels…',
    openDetail: 'Opens the file dialog in this folder; pick every file you want.',
    assign: 'Assign this document to {name}',
    clear: 'Remove the assignment',
    clearDetail: 'Go back to what the file name and the program say.',
  },

  /** Navigation. */
  nav: {
    noChannels: 'This program has no channels.',
    noMarks: 'No wait codes in this program.',
    noMarksChannel: 'No wait codes in {channel}.',
    syncAt: 'Wait code {mark}, line {line}',
    syncWrapped: 'Started over: wait code {mark}, line {line}',
    putCursorOnMark: 'Put the cursor on a wait code first.',
    partnerFound: 'Matching wait code in {channel}, line {line}',
    partnerSwitched: 'Matching wait code in {channel} ({document}), line {line}',
    partnerNone: 'No matching wait code in the other channels.',
    partnerNotOpen: '{channel} is not open, so its wait code cannot be shown.',
    openedNone: 'No files were opened.',
  },

  assignDialog: {
    placeholder: 'Which channel is this program?',
    set: '{title} is now {channel}.',
    cleared: '{title} is no longer set to a channel.',
    unavailable: 'The machine of this document has no channel files to assign.',
  },

  /** What the wait-code check says (messages of `checkSyncMarks`; channel and other are names). */
  findings: {
    outside: '{mark} on line {line} is outside every channel section.',
    unknownChannel: '{mark} in {channel} names “{token}”, which is not a channel of this machine.',
    unknownChannels: '{mark} in {channel} names channels this machine does not have: {tokens}.',
    missing: '{mark} in {channel} waits for {other}, but {other} has no {mark} that waits for {channel}.',
    /** `count` is at least 2 here (the other side has at least one), `otherCount` may be 1:
     *  no noun behind it (M13 review NC-10, "Channel 2 1 times"). */
    countMismatch: '{mark}: {channel} waits on it {count} times for {other}, {other} has {otherCount}; both need the same number.',
    countMismatchRule: '{rule}: {channel} has {count}, {other} has {otherCount}; both sides need the same number.',
    countMismatchStops: 'Stops and ends: {channel} has {count}, {other} has {otherCount}; both sides need the same number.',
    countNotChecked:
      '{mark}: {channel} has it {count} times for {other}, {other} has {otherCount}, but it is inside a loop or a jump, so the count is not checked.',
    countNotCheckedRule:
      '{rule}: {channel} has {count}, {other} has {otherCount}, but one of them is inside a loop or a jump, so the count is not checked.',
    countNotCheckedStops:
      'Stops and ends: {channel} has {count}, {other} has {otherCount}, but one of them is inside a loop or a jump, so the count is not checked.',
    partnersDiffer:
      '{mark} in {channel} waits for {names}, but the {mark} in {other} it meets (line {otherLine}) waits for {otherNames}; both must name the same channels.',
    partnersDifferAbsent:
      '{mark} is written without a channel list in {without} and with one in the other channel ({channel} line {line}, {other} line {otherLine}); write both the same way.',
    outOfOrder: '{mark} (line {line}) and {crossed} (line {crossedLine}) are in the other order in {other} (lines {otherLine} and {otherCrossedLine}).',
    /** `outOfOrder` with more pairs the other way round (`rest` > 0; M12 fix F5: never "0 more"). */
    outOfOrderMore:
      '{mark} (line {line}) and {crossed} (line {crossedLine}) are in the other order in {other} (lines {otherLine} and {otherCrossedLine}). {rest} more out of order.',
    orderNotChecked: 'The order of {mark} and {crossed} against {other} is not checked: a jump target or a backward jump lies between them.',
    /** `orderNotChecked` with more such pairs (`rest` > 0). */
    orderNotCheckedMore:
      'The order of {mark} and {crossed} against {other} is not checked: a jump target or a backward jump lies between them. {rest} more not checked.',
    orderNotCheckedOrdered:
      'The order of {previous} (line {previousLine}) and {mark} in {channel} is not checked: a jump target or a backward jump lies between them.',
    notIncreasing: '{mark} comes after {previous} (line {previousLine}) in {channel}; the numbers must increase.',
    unmatched: '{mark} in {channel} names no other channel, so nothing can answer it.',
    truncated: 'The check took too long and was stopped; the findings below are incomplete.',
  },

  /** The check's report in the Results panel. */
  report: {
    noChannels: 'The machine of this document has no channel settings, so there is nothing to check.',
    title: 'Wait codes, {machine}: {count} to look at',
    titleNone: 'Wait codes, {machine}: all match',
    /** The program could not be read in time, so nothing was checked (M12 fix F4). */
    titleSlow: 'Wait codes, {machine}: not checked',
    slow: 'This program took too long to read for channels, so nothing was checked. Try again when gEdit is less busy.',
    noMachine: 'no machine',
    checked: 'Checked: {channels}.',
    notChecked: 'Not checked (not open or not found): {channels}.',
    longLines: '{channel}: {count} lines longer than {max} characters were not read for wait codes.',
    otherMachine: '{channel} is set to machine “{machine}”. It was checked with the rules of “{current}”.',
    otherMachineNone: '{channel} is set to no machine. It was checked with the rules of “{current}”.',
    columnChannel: 'Channel',
    columnLine: 'Line',
    columnText: 'Finding',
    useMachinePlaceholder: 'Use the same machine for the other channel?',
    useMachine: 'Use “{machine}” for {channel}',
    useMachineDetail: 'Then check again.',
    leave: 'Leave as it is',
  },

  /** `channels.testOnDocument`. */
  test: {
    title: 'Channel rules on {document}',
    titleNone: 'Channel rules on {document}: no channels found',
    columnWhat: 'What',
    columnText: 'Found',
    channel: 'Channel',
    mark: 'Wait code',
    problem: 'Problem',
    marks: '{count} wait codes found.',
    machineNone: 'This document has no machine with channel settings.',
  },

  split: {
    notSingleFile: 'The channels are already separate documents.',
    nothing: 'No channel sections were found.',
    confirmTitle: 'Split into channel documents',
    confirm:
      'This makes one new document for each channel, for reading. Changes you make in them do not come back into this program.',
    ok: 'Split',
    done: 'Made {count} documents for reading. Changes in them do not come back into the program.',
    name: '{title} — {channel}',
  },

  /** The plain wait-code list (`parseWaitCodes`); `item` is quoted as the user wrote it. */
  codes: {
    empty: 'Enter at least one code, for example M100-M199.',
    tooMany: 'Use at most {max} codes or ranges.',
    noLetter: '“{item}”: a code starts with its address letter, for example M100.',
    notNumber: '“{item}”: not a number.',
    letterMismatch: '“{item}”: both ends of a range need the same letter.',
    letter: '“{item}”: wait codes on this control use {letters}.',
    tooLarge: '“{item}”: a code is at most {max}.',
    backwards: '“{item}”: the range runs backwards.',
    rangeWord: '“{item}”: write a range with a dash, for example {example}.',
  },
} as const satisfies Messages;
