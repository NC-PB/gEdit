// Cycle forms and formula parameters (Phase 3 plan §6.7, §6.11; `docs/planning/code-assistant.md`
// "Cycle forms", "Formula parameters"). Owner: P3.8 in Wave A (the refusals and the formula
// errors the engine answers), then P3.5 in Wave B (the command and the form); the category, the
// command title and the ribbon group were pinned by the P3b prelude.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// A cycle's code and its parameters' labels come from the code database: data, shown as text.

import type { Messages } from '../types';

export default {
  category: 'Insert',
  /** `nc.editCycle`: the form of the cycle at the cursor, or a new cycle when the cursor is on none. */
  edit: 'Edit Cycle…',
  /** The Insert tab's group of the Edit Cycle button. */
  group: 'Cycles',

  // P3.5: the command and the form.
  /** The status line when Edit Cycle runs with no program open. */
  noDocument: 'Open a program first to edit a cycle.',
  /** The status line when the active file is no NC program. */
  notProgram: 'Cycles are edited in NC programs, not in this kind of file.',
  /** The title of the form; {code} and {label} come from the code database. */
  title: '{code}: {label}',
  /** The OK button when the form edits the cycle at the cursor / inserts a new one. */
  okEdit: 'Apply',
  okInsert: 'Insert',
  /** The quick pick shown when the cursor is on no cycle. */
  pickPlaceholder: 'There is no cycle at the cursor. Choose a cycle to insert',
  /** The database lists no cycle with parameters for this dialect. */
  noCycles: 'The code database lists no cycles for this kind of program.',
  /** The note of the form: the words of the block that the form keeps as they are. */
  kept: 'Kept as written: {words}',
  /** The form was confirmed with nothing changed. */
  unchanged: 'The cycle was not changed.',
  /** Status lines after the edit. */
  edited: 'Changed the {code} block.',
  inserted: 'Inserted a {code} block.',

  /** P3.8: why the cycle at the cursor has no form (`CYCLE_FORM_REFUSALS`). */
  refused: {
    twoBlocks: 'This cycle is written in two blocks. Edit it in the text, or insert it from a template.',
    verify: 'This cycle is not confirmed in the code database yet, so it has no form.',
    noParams: 'The code database lists no parameters for this cycle.',
    tooLong: 'The block is too long to edit in a form.',
    elsewhere: 'This block runs the cycle written on line {line}. Edit the cycle there.',
    changed: 'The block has changed since the form was opened. Open the form again.',
    required: 'This value is required; it cannot be cleared.',
    variable: 'The value is a variable or an expression; edit it in the text.',
    noWord: 'This value could not be written into the block.',
    /** P3b fix NC (SK-01): {code} is the cycle that is on, {line} where, {cancel} the code that ends it. */
    insideCycle: 'Cycle {code} on line {line} is still on here. Insert the new cycle after its {cancel}.',
  },

  // P3b fix NC: what the form says besides the fields.
  /** NC-08: the help of a field whose word is written without a point; {value} with its unit (`4 mm`). */
  withoutPoint: 'Written without a point: {literal} = {value} on this machine. Type the value as it is written.',
  /** NC-05: the note when the new cycle is inserted with its cancel. */
  cancelAdded: 'The cycle stays on until {cancel}. Put further hole positions between the two blocks.',
  /** SK-03: the note when a Sinumerik drilling cycle is inserted as a call. */
  runsAtOnce: 'The cycle drills here, at once, at the current position and with the feed in force: program F before this block.',

  /** P3.8: why a formula has no value (`evaluateFormulas`); the template is not inserted. */
  formula: {
    divisionByZero: 'Division by zero in {name}.',
    outOfRange: '{name}: {fn} cannot take {value}.',
    tooLarge: '{name} is too large.',
    syntax: 'The formula of {name} cannot be read: {detail}',
    notANumber: '{name} reads {param}, which is not a number.',
    circular: 'The formula of {name} reads itself.',
  },
} as const satisfies Messages;
