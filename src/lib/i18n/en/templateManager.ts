// The template manager and "New Template from Selection" (Phase 3 plan §6.7, §6.11, P3.9;
// `docs/planning/code-assistant.md` "Template files and management"). Owner: P3.9; the category,
// the command titles and the ribbon group were pinned by the P3b prelude.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// A template's name, group, description, text and parameters, and the JSON paths of a problem, are
// data from the user's file: shown as text, never translated and never as markup.

import type { Messages } from '../types';

export default {
  category: 'Templates',
  /** `templates.manage`: the manager dialog for the active document's code set. */
  manage: 'Manage Templates…',
  /** `templates.fromSelection`: the selected lines become a new template, in the manager. */
  fromSelection: 'New Template from Selection…',
  /** The Insert tab's group of the two buttons, after the templates. */
  group: 'Manage',

  /** Why a command does nothing (status bar). */
  noDocument: 'Open a program first. Its templates are the ones you manage.',
  selectFirst: 'Select the blocks to turn into a template first.',
  tooManyLines: 'Select at most {max} lines for a template.',
  noCodeSet: 'This program has no code set to keep templates in.',
  failed: 'The template manager could not be opened: {detail}',

  title: 'Templates',
  close: 'Close',
  database: 'Code set',
  search: 'Search',
  searchPlaceholder: 'Name, group or id',
  actions: 'Template actions',
  btn: {
    add: 'New',
    duplicate: 'Duplicate',
    override: 'Change a copy',
    delete: 'Delete',
    up: 'Move up',
    down: 'Move down',
    favorite: 'Add to Favorites',
    unfavorite: 'Remove from Favorites',
    addParam: 'Add parameter',
    removeParam: 'Remove parameter',
    save: 'Save',
    revert: 'Revert',
    openFile: 'Open file',
  },
  hint: {
    duplicate: 'Copy this template under a new id, into your file',
    override: 'Copy this built-in template with the same id: your copy replaces it',
    openFile: 'Open your templates file in a tab',
  },
  empty: 'No templates in this code set.',
  noMatch: 'No template matches.',
  pick: 'Pick a template in the list.',
  reviewPending: 'Review pending',
  problems_one: '{count} problem',
  problems_other: '{count} problems',
  origin: {
    builtin: 'Built-in',
    user: 'Yours',
    override: 'Yours, replaces the built-in',
    unreadable: 'Cannot be read',
    unreadableLabel: '(unreadable entry)',
  },
  file: {
    yours: 'Your templates are kept in {name}.',
    none: 'Your templates will be kept in {name}, a new file in your code files folder.',
    notThere: '{name} does not exist yet. It is created when you save.',
    unreadable: '{name} cannot be read: {detail}',
    notJson: '{name} is not valid JSON ({detail}). Open the file and fix it first.',
    notObject: '{name} must hold one JSON object. Open the file and fix it first.',
    notList: 'The templates in {name} must be a list. Open the file and fix it first.',
  },

  builtinNote: 'A built-in template. It cannot be changed here; use Duplicate for a copy of your own, or Change a copy to replace it.',
  reviewNote: 'Review pending: this built-in template has not been checked against the manuals and a machine yet.',
  variantNote: '{variant} documents use their own version of this template ({id}).',
  overrideNote: 'This template has the id of a built-in one and replaces it. Delete it to get the built-in one back.',
  readNote: 'It is written without it when you save.',
  body: 'Text',
  placeholders: 'Placeholders',
  insertPlaceholder: 'Insert at the cursor:',
  placeholderBlockNumber: 'The next block number, at the start of a line',
  placeholderSystem: 'Filled in when the template is inserted',
  placeholderParam: 'The value of this parameter',
  params: 'Parameters',
  noParams: 'No parameters: the text is inserted as it is.',

  unreadable: {
    title: 'This entry cannot be read as a template',
    hint: 'It stays in the file as it is. Delete it here, or open the file and correct it.',
  },

  field: {
    id: 'Id',
    label: 'Name',
    group: 'Group',
    description: 'Description',
    body: 'Text',
    machineType: 'Machine type',
    toolbar: 'Button on the Insert tab',
    snippet: 'Snippet',
    review: 'Review',
    params: 'Parameters',
    paramId: 'Id (used in the text)',
    type: 'Kind of value',
    help: 'Help text',
    required: 'Required',
    min: 'Smallest value',
    max: 'Largest value',
    default: 'Starting value',
    choices: 'Choices',
    prefix: 'Written before',
    suffix: 'Written after',
    decimals: 'Decimals',
    digits: 'Digits',
    plusSign: 'Plus sign',
    uppercase: 'Upper case',
    comment: 'Comment',
    remember: 'Remember',
    formula: 'Formula',
    hidden: 'Hidden',
  },
  flag: {
    toolbar: 'Button on the Insert tab',
    snippet: 'Snippet (tab stops, no form)',
    required: 'Required',
    plusSign: 'Write + before a positive number',
    uppercase: 'Only upper case',
    comment: 'Write in a comment',
    remember: 'Remember the last value',
    hidden: 'Not shown in the form',
  },
  machine: {
    any: 'Any machine',
    mill: 'Milling machines only',
    lathe: 'Lathes only',
  },
  type: {
    number: 'Number',
    integer: 'Whole number',
    text: 'Text',
    choice: 'Choice',
    formula: 'Calculated',
  },
  decimals: {
    unset: 'Not set (as typed)',
    asEntered: 'As typed',
    min1: 'At least a decimal point (10 becomes 10.)',
    fixed: '{n} decimals',
  },
  digits: {
    unset: 'No padding',
  },
  choice: {
    label: 'Name',
    value: 'Value',
    add: 'Add choice',
    remove: 'Remove choice',
  },
  param: {
    newLabel: 'Value {n}',
    newChoice: 'Choice {n}',
    notANumber: 'Not a number.',
    noDefault: 'None',
  },

  where: {
    unreadable: 'Unreadable entry',
    param: 'Parameter {n}',
    paramNamed: 'Parameter {n} ({label})',
    list: 'The list of templates',
  },
  problem: {
    idTwice: 'Another template of yours already has the id "{id}".',
    dropped: 'A template could not be read back. Nothing was saved.',
  },

  new: {
    label: 'New template',
    group: 'My templates',
    body: '(NEW TEMPLATE)',
  },
  duplicate: {
    suffix: '(copy)',
    alreadyOverridden: 'You already have a copy of "{label}" with the same id. It is selected.',
  },
  leave: {
    title: 'Unsaved changes',
    message: 'The changes to {name} are not saved. Leave without saving them?',
    ok: 'Discard changes',
    draftMessage: 'The new template is not added yet. Leave without adding it?',
  },
  delete: {
    title: 'Delete template',
    message: 'Delete "{label}"? It is removed from your file when you save.',
    overrideMessage: 'Delete your version of "{label}"? The built-in template comes back when you save.',
    ok: 'Delete',
  },

  preview: {
    title: 'Preview with the starting values',
    none: 'No preview without an open program.',
    problems: 'Fix the problems of this template to see the preview.',
    needsDefault: '{label} has no starting value. Give it one to see it here.',
    failed: 'The preview could not be made.',
  },

  save: {
    nothing: 'There is nothing to save.',
    invalid_one: 'Not saved: {count} problem in your templates. Fix it and save again.',
    invalid_other: 'Not saved: {count} problems in your templates. Fix them and save again.',
    saveFirst: 'Save or close {name} first.',
    changed: '{name} has changed since the manager read it. Reload it with Revert.',
    locked: '{name} cannot be changed here (it is locked). Unlock it or use Save As.',
    notSaved: '{name} could not be saved, so nothing in it was changed. Try again.',
    openFailed: '{name} could not be opened.',
    /** The action named in the read-only refusal ("... so saving the templates did not run"). */
    lockAction: 'saving the templates',
    tooBig: '{name} would be larger than {max} MiB, which is more than the program reads. Delete templates you do not need and save again. Nothing was written.',
    rereadFailed: '{name} was saved, but the list could not be read again: {detail}. Close the manager and open it again.',
    failed: '{name} could not be written: {detail}',
    done: 'Saved {name}.',
  },

  favorite: {
    tooMany: 'At most {max} favorites per code set.',
  },

  draft: {
    title: 'New template from the selection',
    hint: 'Click the numbers that should become values you fill in when you insert the template. The block numbers become the next block number.',
    candidateHint: 'Becomes the value {id} ({label})',
    all: 'Select all',
    none: 'Select none',
    // Two counts in one line: each phrase has its own singular and plural (`{count}` picks the form).
    count: '{numbers}, {params}',
    numbers_one: '{count} number selected',
    numbers_other: '{count} numbers selected',
    values_one: '{count} value in the template',
    values_other: '{count} values in the template',
    noCandidates: 'No numbers in the selection can become values. The lines are kept as they are.',
    result: 'The template text',
    apply: 'Add template',
    cancel: 'Cancel',
    needsName: 'Give the template a name.',
    needsGroup: 'Give the template a group.',
    badId: 'The id has to be lower-case letters, digits and -, up to 64 characters.',
    idTaken: 'A template with the id "{id}" exists already. Choose another id.',
    refused: 'The template cannot be saved like this: {detail}',
  },
} as const satisfies Messages;
