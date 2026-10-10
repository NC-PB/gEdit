// Templates: the Insert tab, completion, the palette and the template form (Phase 3 plan §6.7,
// §6.11; Phase 2 plan AD-28). Owner: P3.4 in Wave A (the value messages the engine answers),
// then P3.5 in Wave B (the Insert tab, the form, completion); the category, the command title and
// the ribbon groups were pinned by the P3b prelude.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// A template's label, group, description and help come from its database file: they are data,
// shown as text and never translated (AD-14), like a script's name.

import type { Messages } from '../types';

export default {
  category: 'Insert',
  /** `templates.insert`: a quick pick of the active document's templates, by group. */
  insert: 'Insert Template…',
  /** The Home tab's group with the `program-start` button (`insert.template:program-start`). */
  groupProgram: 'Program',
  /** The Insert tab's custom group of template buttons (one row of buttons and a "More" list per template group). */
  groupTemplates: 'Templates',
  /** The "More templates…" list of a template group. */
  more: 'More Templates…',
  /** Shown on a built-in template that the owner has not reviewed yet (owner decision of 2026-10-09). */
  reviewPending: 'Review pending: check the inserted code against your machine before you run it.',
  /** The same, short, for a button's tooltip and a list entry (P3.5). */
  reviewPendingShort: 'Not yet reviewed',

  // P3.5: the Insert tab, the palette, completion and the template form.
  /** The first group of the Insert tab, when the database has starred templates. */
  favorites: 'Favorites',
  /** The OK button of a template form. */
  insertOk: 'Insert',
  /** The quick pick of `templates.insert`. */
  pickPlaceholder: 'Choose a template to insert',
  /** The active document has no template to offer. */
  none: 'This kind of program has no templates yet.',
  /** The status line when a template is run with no program open. */
  noDocument: 'Open a program first to insert a template.',
  /** The status line when the active file is no NC program (a profile, a code file, the settings). */
  notProgram: 'Templates are inserted into NC programs, not into this kind of file.',
  /** The status line when the active program does not offer the template ({id} is the command's template id). */
  notOffered: 'This program has no template "{id}".',
  /** The status line when a template could not be inserted; {reason} is the first refused value. */
  refused: '{label} was not inserted: {reason}',
  /** A completion item's detail line: the template's group. */
  completionDetail: 'Template: {group}',
  /** P3b fix NC (NC-09): the form's note on a machine that scales every number; {unit} is `1 µm`, `10 µm`. */
  unitScaled: 'This machine reads every number scaled (unit setting {unit}). The sample values are for the 1 mm setting: convert every position and feed before you insert.',
  /** P3b fix NC (NC-02): what a draft "from selection" leaves as written (`TemplateDraft.notes`). */
  fromSelection: {
    referencedKept: '{words} point at blocks outside the selection; they stay as written.',
    labelsKept: 'Labels (LBL) stay as written. Check them before you insert the template twice into one program.',
    skipNumberKept: '{words}: a block number behind / stays as written. Check it before you insert the template into the same program.',
  },
  /** P3b fix NC (SK-02): the form's note when a number the template writes is one a reference of the program points at. */
  numberNamed: '{word} on line {line} points at {number}, and this template writes a block {number} as well.',

  /** P3.4: why a value is refused (`validateTemplateValues`, `renderTemplate`); never corrected. */
  value: {
    required: 'Enter a value.',
    notANumber: 'Enter a number.',
    notAnInteger: 'Enter a whole number.',
    belowMin: 'The smallest value is {min}.',
    aboveMax: 'The largest value is {max}.',
    tooManyDecimals: 'At most {decimals} decimals.',
    notUppercase: 'Write it in upper case.',
    notAChoice: 'Choose one of the values.',
    /** P3b fix NC (NC-01): a contour number or name the program already has; {number} as written (`N100`, `NLAP1`). */
    blockNumberUsed: '{number} is already on line {line}. P and Q need a block number of their own.',
    blockNameUsed: 'The name {number} is already on line {line}. Choose a name the program does not use.',
    blockNumberNamed: '{word} on line {line} already points at {number}. Choose a number nothing in the program points at.',
    blockNumberOwn: 'This template writes {number} itself. Choose another number.',
    blockNumberTwice: 'Another field already has {number}. Each block needs a number of its own.',
    commentDelimiter: 'The text cannot contain {delimiter}.',
    oneLine: 'Write it on one line.',
    control: 'Remove the invisible control character.',
    noComments: 'This dialect has no comments.',
    blockNumberMax: 'The next block number would be above {max}. Renumber the program first.',
  },
} as const satisfies Messages;
