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
    /** M10 review (NC-5): Fanuc G15/G16, end points as a radius and an angle. */
    polarCommand: 'Polar coordinate command',
    /** WP8.5: exact stop against continuous path (Sinumerik G60, G64, G641, G642, G645). */
    pathmode: 'Path mode',
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
