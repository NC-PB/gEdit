// The code assistant: hover help and completion. Owner: WP3.6.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Only the frame is translated. Everything a hover or a suggestion says *about* a code —
// its label, its description and its parameter names — is data from the code database and
// stays as written there (AD-14: script and profile labels are data, and a code database
// is the same kind of content).
//
// `group.*` is looked up with a key built at runtime (`assistant.group.<group>`), because
// `group` is free text in the database and a P2 user database may bring its own. Every
// group the built-in databases use has a message here; one that has none falls back to
// the raw name, which the caller sees because `t()` answers with the key itself.
//
// `context.*` (P3.3) is looked up through one helper in `core/codes/hoverText.ts` with the key
// built there; `hoverText.test.ts` checks that every key it can build has a message.

import type { Messages } from '../types';

export default {
  hover: {
    /** Shown instead of an explanation for a word the database does not describe. */
    unknown: 'The code database does not describe this word yet.',
    /** Appended to the group line of a code that stays active until it is replaced. */
    modal: 'modal',
    pitchFeed: 'The feed carries the thread pitch here, so changing it changes the thread.',
    required: 'Required: {list}',
    variable: 'Variable',
    variableValue: 'Only the control knows the value; the editor does not calculate it.',
    incremental: 'Incremental: the value is measured from the current position.',
    /**
     * M12.5 (§7.16 #178): a code word the document's machine lists as a wait code. It replaces
     * the database's explanation, which describes the control's own meaning of the code.
     */
    waitCode: 'Wait code on this machine ({machine}): {rule}',
    waitCodeNoLabel: 'Wait code on this machine ({machine})',
    syncCode: 'Sync code on this machine ({machine}): {rule}',
    syncCodeNoLabel: 'Sync code on this machine ({machine})',
    syncCodeNote: 'The machine settings list this code as a synchronisation code; the code database describes the control\'s own meaning, which this machine does not use.',
    waitCodeNote: 'The machine settings list this code as a wait; the code database describes the control\'s own meaning, which this machine does not use.',
  },
  /**
   * P3.3: what the modal context adds to a hover (`core/codes/hoverText.ts`). A code, a line,
   * a value, a unit, a parameter's meaning and a machine name in a placeholder are data.
   */
  context: {
    /** The one context line of an address word: `X — target, diameter, absolute (G90)`. */
    line: '{address} — {parts}',
    target: 'target',
    /** `G50 X100.`: the axis word is a value for the code, not a place to move to. */
    data: 'a value for {code}, not a position',
    machineCoordinates: 'machine coordinates ({code})',
    /** `U` on a lathe. */
    incrementalOf: 'incremental {axis}',
    incremental: 'incremental',
    absolute: 'absolute',
    diameter: 'diameter',
    radius: 'radius',
    diameterUnknown: 'diameter or radius: not known while the distance mode is not known',
    workOffset: 'work offset {code}',
    frame: 'inside {code} (line {line})',
    /** A position under a modal cycle. */
    cycleInForce: 'cycle {code} in force (line {line})',
    /** A block after a threading move that stays in force (`G33`, `G32`): another pass, not a cycle. */
    threadInForce: 'thread pass {code} in force (line {line})',
    /** A parameter of a code in the block: its meaning from the code database, and the code. */
    param: '{label} ({code})',
    lead: 'thread lead ({code})',
    dwell: 'a time in seconds, not a feed ({code})',
    ambiguousFeed: 'feed or thread lead: {code} is a threading cycle on another control or G-code system',
    feedUnknown: 'feed unit not known yet',
    feedPerMinute: 'feed per minute',
    feedPerRev: 'feed per revolution',
    feedPerTooth: 'feed per tooth',
    inverseTime: 'inverse-time feed',
    surfaceSpeed: 'surface speed',
    rpm: 'spindle speed in rpm',
    speedLimit: 'speed limit, not a speed',
    speedLimitBy: 'speed limit, not a speed ({code})',
    /** The top spindle speed in force under constant surface speed. */
    clamp: 'clamp {value} rpm (line {line})',
    /** A mode and the code that set it: `feed per revolution (G99)`. */
    withCode: '{what} ({code})',
    /** A mode the program never set: where the assumption comes from. */
    assumed: 'assumed: {source}',
    source: {
      machine: 'machine',
      detected: 'detected from the program',
      profile: 'profile default',
    },
    value: {
      /** The effective value under the document's machine, and why. */
      machine: "{word} — {value} {unit}: {why} (machine '{name}')",
      asWritten: 'as written',
      noPoint: 'no decimal point, increments of {step} {unit}',
      scaled: 'every number counts in units of {step} {unit}',
      /** No machine: the list of readings follows, one per line. */
      readings: '{word} — depends on the machine; choose a machine:',
      readingsUnset: "{word} — depends on how numbers are read, which machine '{name}' does not set:",
      reading: '{value} {unit}: {label}',
      readingDefault: '{value} {unit}: {label} (profile default)',
      noValue: 'no value: {label}',
    },
    /** The parameters of the cycle on a cycle word. */
    table: {
      title: 'Parameters of {code}',
      calls: 'Parameters of {code}, defined on line {line}',
      withPart: '{title}, {part}',
      /** A cycle written in two blocks (the lathe `G71`, `G76`). */
      part: 'block {index} of {of}',
      word: 'Word',
      meaning: 'Meaning',
      written: 'Written',
      notWritten: 'not written',
    },
  },
  completion: {
    /** Documentation note on an entry that still carries `verify: true`. */
    unverified: 'Not verified yet. Check it against the documentation of your control.',
    required: 'Required: {list}',
    modal: 'modal',
  },
  /** Database group ids. The key is built at runtime; an unknown group keeps its raw name. */
  group: {
    motion: 'Motion',
    nonmodal: 'Non-modal',
    plane: 'Working plane',
    /** Klartext `PLANE …`: a tilted working plane, kept apart from the G17–G19 plane group. */
    tilt: 'Tilted working plane',
    /** Keeping the tool tip on the path while rotary axes move: not a plane at all. */
    tcpm: 'Tool centre point',
    units: 'Units',
    distance: 'Distance mode',
    /** P8: turning. Whether the cross axis is written as a diameter or as a radius. */
    diametermode: 'Diameter programming',
    /** P8: a programmable offset, rotation, scaling or mirroring — not a work offset. */
    frame: 'Programmable frame',
    /**
     * P10: the Fanuc frame families, each in a group of its own, because a frame code closes
     * the frames of its own group only (G69 does not end the scaling of G51).
     */
    scaling: 'Scaling',
    mirror: 'Mirror image',
    polar: 'Polar coordinate interpolation',
    cylindrical: 'Cylindrical interpolation',
    /** B1 (NC-02): Fanuc lathe G68/G69, a modal group of its own apart from G68.1/G69.1. */
    turretMirror: 'Mirror image for the second turret',
    /** M10 review (NC-5): Fanuc G15/G16, end points as a radius and an angle. */
    polarCommand: 'Polar coordinate command',
    /** WP8.5: exact stop against continuous path (Sinumerik G60, G64, G641, G642, G645). */
    pathmode: 'Path mode',
    /** B1 (a7s): Sinumerik G601–G603, when the next block starts under an exact stop (G60, G9). */
    exactstop: 'Exact stop criterion',
    /** WP8.3: which turret a block is for (Okuma G13, G14). */
    turret: 'Turret selection',
    /** WP8.3: the Okuma LAP codes that describe and run an automatic roughing contour. */
    lap: 'LAP (automatic roughing)',
    feedmode: 'Feed mode',
    spindlemode: 'Spindle mode',
    cyclereturn: 'Cycle return',
    offset: 'Work offset',
    compensation: 'Tool compensation',
    /** M6/F25: the tool **length** offset is its own modal group, not radius compensation. */
    lengthComp: 'Tool length offset',
    /** M10 (WP10.2): Sinumerik G290/G291, the language the control reads the program in. */
    language: 'Programming language',
    cycle: 'Cycle',
    spindle: 'Spindle',
    coolant: 'Coolant',
    tool: 'Tool',
    program: 'Program flow',
    subprogram: 'Subprogram',
    rotaryfeed: 'Rotary axis feed',
    rotarypath: 'Rotary axis path',
    macro: 'Macro program',
    parameter: 'Q parameter',
  },
} as const satisfies Messages;
