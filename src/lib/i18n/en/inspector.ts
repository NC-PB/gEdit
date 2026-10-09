// The code inspector: the words of the block at the cursor, what is in force after it, and
// editing one value (Phase 3 plan §6.3, §6.7; Phase 2 plan AD-27). Owner: P3.2a in Wave A (the
// row notes, the state captions, the reasons a value cannot be edited), then P3.2b in Wave B
// (the panel); the category, the command titles and the panel title were pinned by the
// Phase 3 prelude (P3a).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// `core/codes/inspect.ts` answers these keys as `Msg`s; the panel translates them. A code, a
// line, a machine name or a unit in a placeholder is data and shown as text.

import type { Messages } from '../types';

export default {
  category: 'Inspector',
  /** `view.toggleInspector` (`Mod+Alt+A`): shows or hides the panel in the left region. */
  toggle: 'Code Inspector',
  /** `inspector.editValue`: edits the value of the word at the cursor, as double-click or Enter on its row does. */
  editValue: 'Edit Value at Cursor…',
  /** The panel's title in the left region, next to the Program Map. */
  title: 'Inspector',

  /** The panel itself (P3.2b). */
  panel: {
    noDocument: 'Open a program to inspect it.',
    notProgram: 'The inspector reads NC programs; this file is not one.',
    tooLong: 'Line {line} is too long to inspect.',
    empty: 'Nothing to inspect on this line.',
    lineOne: 'Line {line}',
    lineRange: 'Lines {first}–{last}',
    words: 'This block',
    state: 'In force after this block',
    hint: 'Double-click a value, or press Enter on it, to change it.',
    setHere: 'set here',
    sourceLine: 'line {line}',
    atPowerOn: 'at power-on',
    goTo: 'Go to line {line}',
    assumed: 'Assumed',
    readingsHeading: 'Depends on the machine:',
    reading: '{label}: {value} {unit}',
    readingNone: '{label}: no reading',
    editable: 'Double-click or press Enter to change this value',
  },

  /** The cycle table (`inspector-cycle`). */
  cycle: {
    runs: 'Runs {code}',
    defines: 'Defines {code}',
    calls: 'Calls {code}',
    part: 'Block {index} of {of}',
    notWritten: 'not written',
  },

  /** Editing one value: the prompt and what it says afterwards. */
  edit: {
    title: 'Change {word}',
    /** The action named in the read-only refusal ("… so Change Value did not run"). */
    action: 'Change Value',
    labelUnit: 'New value in {unit}',
    label: 'New value',
    done: '{from} changed to {to}',
    changed: 'The program changed in the meantime; nothing was written.',
    noWord: 'There is no value to change at the cursor.',
    noDocument: 'Open a program first.',
    notProgram: 'The inspector reads NC programs; this file is not one.',
  },

  /** Notes on a word row, in the order `inspectBlock` gives them. */
  note: {
    notDescribed: 'Not described',
    variable: 'A variable: its value is known only when the program runs',
    lead: 'Thread lead ({code})',
    dwell: 'A time in seconds, not a feed ({code})',
    ambiguousFeed: 'Feed or thread lead: {code} is a threading cycle on another control or G-code system',
    feedUnknown: 'Feed unit not known yet',
    feedPerMinute: 'Feed per minute',
    feedPerRev: 'Feed per revolution',
    feedPerTooth: 'Feed per tooth',
    inverseTime: 'Inverse-time feed',
    setBy: '{code} on line {line}',
    setByAssumed: '{code} at power-on',
    speedLimit: 'Speed limit, not a speed',
    surfaceSpeed: 'Surface speed',
    rpm: 'Spindle speed in rpm',
    clamp: 'Clamped at {value} (line {line})',
    incremental: 'Incremental',
    incrementalOf: 'Incremental {axis}',
    diameter: 'Diameter',
    radius: 'Radius',
    diameterUnknown: 'Diameter or radius: not known while the distance mode is not known',
    axisData: 'A value for {code}, not a position',
    axisMachine: 'Machine coordinates ({code})',
    /** `G28 X0.`: the point the tool passes on its way to the reference point, not machine zero. */
    axisVia: "Intermediate point of {code}, in the program's coordinates",
    needsMachine: 'Depends on the machine; choose a machine',
    noPoint: 'No decimal point: steps of {step} {unit}',
    scaled: 'Every number counts in units of {step} {unit}',
    machine: "Machine '{name}'",
    assumedMachine: 'Assumed: machine',
    assumedDetected: 'Assumed: detected from the program',
    assumedProfile: 'Assumed: profile default',
  },

  /** Why a row cannot be edited, or why a typed value is refused. */
  why: {
    blockNumber: 'Block numbers are changed with Renumber.',
    programNumber: 'The program number is not a value to edit here.',
    code: 'A code is not a value; type over it in the editor.',
    call: 'A call is edited in the editor; its arguments are listed below.',
    unknown: 'This word is not described, so its value is not edited here.',
    variable: 'The value is a variable or an expression; it is known only when the program runs.',
    noValue: 'This word has no value.',
    waiting: 'Waiting for the program to be read.',
    needsMachine: 'The value depends on the machine; choose a machine first.',
    notANumber: 'That is not a decimal number.',
    wholeNumber: 'This word takes a whole number.',
    min: 'The smallest value allowed is {min}.',
    max: 'The largest value allowed is {max}.',
  },

  /** The captions of the state rows (`INSPECTOR_STATE_KEYS`). */
  state: {
    motion: 'Motion',
    plane: 'Plane',
    distance: 'Distance',
    units: 'Units',
    diameter: 'Diameter mode',
    workOffset: 'Work offset',
    tool: 'Tool',
    spindle: 'Spindle',
    speed: 'Speed',
    speedLimit: 'Speed limit',
    feed: 'Feed',
    coolant: 'Coolant',
    compensation: 'Compensation',
    cycle: 'Active cycle',
    definedCycle: 'Defined cycle',
    frame: 'Frame',
    tcp: 'Tool centre point',
    group: 'Group {name}',
  },
} as const satisfies Messages;
