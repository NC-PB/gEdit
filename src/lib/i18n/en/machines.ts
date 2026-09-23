// Machine configurations: everything gEdit says about a machine (plan §7.15, AD-31).
// One namespace per feature (plan AD-14), so three work packages share this file:
// WP6.10 (the status item, the picker and the Settings ▸ Machines page), WP6.8 (what the
// service in `stores/machines.ts` says out loud, grouped at the bottom) and WP6.9 (the
// three refusals of `core/machines/numbers.ts`). I6 merged the WP6.8 and WP6.10 files and
// added the `numbers` block; `reloadFailed` and `openFileFailed` were written twice with
// the same text and are kept once.
//
// Machine names, profile names, preset labels, variant labels and code labels are **data**
// and stay untranslated (contrib README rule 3): a preset label such as "Increments of
// 0.001 mm (IS-B): X50 is 0.050 mm, X50. is 50 mm" is written in the profile JSON, reviewed
// by G10, and shown here as it stands.
//
// Two wordings are deliberate and should not be softened:
//   - "assumed" for everything that does not come from a machine the user chose. Without a
//     machine, how the control reads a written number is a documented default of the
//     dialect, not a fact about the machine on the shop floor (AD-31 "No machine, no
//     guess").
//   - every parameter in the tooltip names its source, so a value can be checked rather
//     than believed.

import type { Messages } from '../types';

export default {
  category: 'Machines',

  // Commands (§7.13: no default shortcuts)
  setMachine: 'Change Machine…',
  manage: 'Manage Machines…',
  openFile: 'Open Machines File',

  // Status item
  item: 'Machine: {name}',
  itemNone: 'Machine: none',
  assumed: 'assumed',
  noParams: 'The {profile} dialect has no machine parameters, so there is nothing to choose.',

  // Tooltip (one line per effective parameter, each with where it came from)
  tooltip: {
    machine: 'Machine: {name}',
    none: 'No machine. The values below are what the dialect documents, and they are assumed.',
    hint: 'Click to choose a machine.',
  },

  // Parameter labels, shared by the tooltip and the form
  param: {
    numberInput: 'How the control reads numbers',
    numberInputHelp:
      'It decides what a written number means — above all whether a word without a decimal point is a count of input increments.',
    units: 'Units at power-on',
    unitsHelp: 'What the control measures in until the program says otherwise.',
    diameter: 'X and U are diameters at power-on',
    diameterHelp: 'Turn this off for a control that is set to radius programming.',
    name: 'Name',
    nameHelp: 'What this machine is called in the status bar and the picker.',
    notes: 'Notes',
    notesHelp: 'Your own note about this machine; gEdit only stores it.',
    profile: 'Dialect',
    profileHelp: 'The dialect this machine runs. It cannot be changed afterwards.',
    modal: 'Power-on code, group {group}',
    modalHelp: 'What is in effect before the program sets it.',
  },

  // Group names we have a word for; anything else falls back to `param.modal`
  groups: {
    feedmode: 'Feed mode at power-on',
    spindlemode: 'Spindle-speed mode at power-on',
    plane: 'Plane at power-on',
    distance: 'Positioning at power-on',
    motion: 'Motion at power-on',
  },

  // Values
  value: {
    mm: 'Millimetres (mm)',
    inch: 'Inches',
    on: 'on',
    off: 'off',
    profileDefault: 'Dialect default',
    custom: 'Custom (edited in the file)',
    customDetail:
      'The file holds number rules that match no preset. They are kept until a preset is picked here.',
  },

  // Where a value comes from (`ParamSource`)
  source: {
    machine: 'set by the machine',
    detected: 'detected in this program',
    profile: 'dialect default, assumed',
  },

  // The picker (`file.setMachine`)
  pick: {
    placeholder: 'Read this document as written for…',
    none: 'None (dialect defaults)',
    noneDetail: 'Everything the machine would decide is shown as assumed.',
    other: 'Other machines…',
    otherDetail: 'Machines of another dialect. Picking one also changes this document’s dialect.',
    otherPlaceholder: 'A machine of another dialect…',
    manage: 'Manage machines…',
    manageDetail: 'Add, edit and remove machine configurations.',
    current: '✓',
    default: 'Default for this dialect',
    otherEmpty: 'There is no machine of another dialect.',
  },

  // Status messages
  changed: '{name} now uses machine {machine}',
  changedNone: '{name} now uses no machine: the dialect defaults are assumed',
  changedProfile: '{name} now uses machine {machine} and the {profile} dialect',
  reloadFailed: 'The machines file could not be read again',
  openFileFailed: 'The machines file could not be opened',

  // ---------------------------------------------------------------------------
  // What `stores/machines.ts` says out loud (WP6.8). `reloadFailed` and `openFileFailed`
  // above are the same sentences and serve both.
  // ---------------------------------------------------------------------------

  // While it reads or writes `machines.json`.
  fileUnreadable: 'The machines file could not be read, so no machine configuration is in use',
  fileReadOnly:
    'machines.json was written by a newer version of gEdit. It is read as it is and never overwritten.',
  fileBlocked: 'The machines file could not be read, so it is not overwritten',
  saveFailed: 'The machine configurations could not be saved',

  // About a document's choice.
  removedNone: 'Machine "{name}" was removed',
  removed_one: 'Machine "{name}" was removed; one open document falls back to the defaults',
  removed_other: 'Machine "{name}" was removed; {count} open documents fall back to the defaults',
  gone: 'The machine of this document is no longer available; the defaults are assumed',
  incompatible: 'Machine "{name}" is not for this profile; the defaults are assumed',
  unusable: 'Machine "{name}" cannot be used as machines.json writes it; the defaults are assumed',
  // AD-31: detection disagrees with the chosen machine. Nothing switches by itself.
  mismatch:
    'This program looks like {label} "{detected}"; machine "{name}" is set to "{chosen}". Nothing was changed.',

  // ---------------------------------------------------------------------------
  // Why a number could not be written back (WP6.9, `WRITE_BACK_ERRORS`). The Python twin
  // carries the same three codes as plain sentences, so a script and the UI refuse for
  // the same reason in the same words.
  // ---------------------------------------------------------------------------
  numbers: {
    rounded: 'The value does not fit the form this word is written in; it would have to be rounded.',
    noReading: 'This word has no value on this machine, so nothing can be written back into it.',
    notANumber: 'That is not a decimal number.',
  },

  // The Settings ▸ Machines page
  page: {
    empty:
      'No machines yet. Documents are read with the defaults their dialect documents, and anything that depends on the machine is shown as assumed.',
    // Worded for both cases the service blocks on: a file it could not read, and one from
    // a newer gEdit that it can read and must not write.
    blocked:
      'The machines file cannot be used as it is, so nothing here may be changed: a hand edit is never overwritten behind your back. Open the file and fix it, or replace it with an empty one.',
    blockedAction: 'The machines file cannot be used as it is.',
    problem: '{path}: {message}',
    add: 'Add…',
    edit: 'Edit…',
    duplicate: 'Duplicate…',
    remove: 'Remove',
    default: 'Default for its dialect',
    defaultClear: 'Not the default any more',
    defaultMark: 'Default',
    openFile: 'Open machines file',
    replaceFile: 'Replace with an empty file',
    save: 'Save',
    cancel: 'Cancel',
    next: 'Continue',
    addTitle: 'New machine',
    addProfileTitle: 'Which dialect does this machine run?',
    editTitle: 'Machine {name}',
    duplicateTitle: 'Duplicate {name}',
    duplicateName: '{name} copy',
    removeTitle: 'Remove {name}?',
    removeMessage: 'The machine is deleted from the machines file. This cannot be undone.',
    removeInUse_one: 'Remove {name}? {count} open document uses it and will fall back to the dialect defaults.',
    removeInUse_other: 'Remove {name}? {count} open documents use it and will fall back to the dialect defaults.',
    replaceTitle: 'Replace the machines file?',
    replaceMessage:
      'The unreadable file is kept as machines.json.bak and a new, empty one takes its place.',
    nameTaken: 'Another machine is already called that.',
    nameLong: 'A name may be at most 64 characters long.',
    added: 'Machine {name} added',
    updated: 'Machine {name} saved',
    duplicated: 'Machine {name} added',
    removed: 'Machine {name} removed',
    defaultSet: '{name} is now the default for the {profile} dialect',
    defaultCleared: 'The {profile} dialect has no default machine any more',
    replaced: 'The machines file was replaced; the old one is machines.json.bak',
    saveFailed: 'The machines file could not be written',
    modalDropped:
      'The power-on codes {codes} do not exist in what you just chose, so those groups follow the dialect again.',
    noProfiles: 'No dialect declares machine parameters, so no machine can be added.',
  },
} as const satisfies Messages;
