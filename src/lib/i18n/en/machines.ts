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
    diameter: 'Diameter programming at power-on',
    diameterWords_one: '{words} is a diameter at power-on',
    diameterWords_other: '{words} are diameters at power-on',
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
    // What Replace actually does (`config.rs::save_json_object_versioned`): a new, empty
    // file takes its place; the old one is kept as `machines.json.bak` only when it could
    // not be read as JSON at all — a file that parsed but could not be used as machine
    // records is replaced with no backup. A file written by a newer gEdit is not touched:
    // Replace is refused for it, same as every other write.
    replaceMessage:
      'A new, empty file takes its place. The old one is kept as machines.json.bak only if it could not be read as JSON at all; if it could be read but not used, it is replaced with no backup. A file written by a newer gEdit is left as it is — Replace is refused for it, like any other write.',
    nameTaken: 'Another machine is already called that.',
    nameLong: 'A name may be at most 64 characters long.',
    added: 'Machine {name} added',
    updated: 'Machine {name} saved',
    duplicated: 'Machine {name} added',
    removed: 'Machine {name} removed',
    defaultSet: '{name} is now the default for the {profile} dialect',
    defaultCleared: 'The {profile} dialect has no default machine any more',
    replaced:
      'The machines file was replaced with an empty one. The file that was there is kept as machines.json.bak only if it could not be read as JSON.',
    saveFailed: 'The machines file could not be written',
    modalDropped:
      'The power-on codes {codes} do not exist in what you just chose, so those groups follow the dialect again.',
    noProfiles: 'No dialect declares machine parameters, so no machine can be added.',
  },

  // ---------------------------------------------------------------------------
  // The Channels step of the machine form (WP12.3, plan §7.15, §7.17, AD-32).
  //
  // The owner's rule (2026-10-07): "something that makes sense but does not overwhelm the
  // user. The average user will be a NC-Programmer and not a Software Engineer." So the
  // plain controls come first and say what they do in the words of the shop floor; the
  // regular expressions sit behind "Advanced". `{noun}` / `{nouns}` are the word this control
  // uses for one stream of blocks ("channel", "path", "turret"), read from the channel
  // names (`channelNoun`); `{address}` is the address letter (P). Codes, ids and presets'
  // labels are data and are never translated.
  // ---------------------------------------------------------------------------
  channels: {
    title: 'Channels',
    intro:
      'A channel is one stream of blocks the control runs on its own, for example the two turrets of a lathe. Tell gEdit how this machine lays them out and which codes make one wait for another, and it can show them apart and check the waits. gEdit never changes the program.',
    none: 'No channels: programs for this machine are read as one stream.',
    problemsTitle: 'To fix before saving',
    unreadable:
      'The channel settings stored for this machine are not in a form this page can show. They are listed below and kept in the file. Remove them to start again, or fix them in the machines file.',
    removeUnreadable: 'Remove the channel settings',
    regexHelpAt: 'Help with patterns: docs/user/regex.md in the gEdit folder, or {url}',
    problemsKept:
      'These channel settings cannot be used as they are written. They are kept in the file and the channels are off; everything else about the machine still works.',
    assignOnly:
      'Nothing here tells gEdit which file is which channel. Open the files and assign each one to its channel by hand.',

    // Try the settings on a program
    tester: {
      title: 'Try these settings on a program',
      help: 'Paste a program, or take the one open now, to see how the settings above read it. Nothing is changed or saved.',
      take: 'Take the active document',
      noDocument: 'No document is open.',
      fileName: 'File name (to tell which channel a file is)',
      paste: 'Paste a program here',
      none: 'These settings find no channel in this program.',
      channel: 'Channel',
      sections: 'Sections',
      lines: 'Lines',
      noSection: 'no section found',
      self: 'This program is {channel} (found {how}).',
      byName: 'by its file name',
      byMarker: 'by the marker in the program',
      outside: 'Lines that belong to no channel: {lines}',
      line: 'Line',
      code: 'Code',
      rule: 'Rule',
      inChannel: 'In',
      waitsFor: 'Waits for',
      noMarks: 'No wait codes found.',
      dropped: '{count} more wait codes were found and not listed.',
      moreRows: '… {count} more',
      found: 'Found',
      time: 'Time',
      slow: 'Slower than {ms} ms; shorten the pattern.',
    },

    // Start from a preset
    preset: {
      title: 'Start from a preset',
      help: 'A starting point taken from the control’s documentation. It is copied into this machine only when you press the button, and you can change everything afterwards.',
      choose: 'Choose a preset…',
      use: 'Use this preset',
      replaceAsk: 'Replace the channel settings below with this preset?',
      replace: 'Replace',
      keep: 'Keep mine',
      verify: 'verify',
      verifyNote: 'Check this against your own machine before relying on it.',
      source: 'Source: {source}',
      applied: 'The preset was copied. Check it against your machine.',
    },

    // The layout
    layout: {
      label: 'How are the channels stored?',
      help: 'Either everything is in one program, one section per {noun}, or each {noun} has a program of its own.',
      none: 'No channels',
      singleFile: 'All in one program, one section for each {noun}',
      multiFile: 'One program for each {noun}',
    },
    stopsAndEnds: {
      label: 'Stops and ends count as waits',
      help: 'Tick this if a program stop or end (M0, M1, M2, M30) makes a {noun} wait for the others. Leave it off when unsure.',
    },

    // The list of channels
    list: {
      title: 'The channels',
      help: 'In the order they are shown.',
      id: 'Short name',
      idHelp: 'Letters, digits, - or _; the check and the scripts use it.',
      name: 'Name',
      aliases: 'Also written as',
      aliasesHelp: 'Other spellings of this {noun} in programs, separated by commas, for example G13.',
      fileName: 'File name',
      fileNameHelp: 'The name of this {noun}’s program; {stem} is the part all programs share.',
      add: 'Add a {noun}',
      remove: 'Remove {name}',
      up: 'Move {name} up',
      down: 'Move {name} down',
      newName: '{Noun} {number}',
    },

    // Wait rules
    rules: {
      title: 'Wait codes',
      help: 'The codes that make one {noun} wait for another. gEdit compares them between the {nouns}.',
      none: 'No wait codes yet.',
      add: 'Add wait codes',
      remove: 'Remove this rule',
      up: 'Move this rule up',
      down: 'Move this rule down',
      newLabel: 'Wait codes {number}',
      patternRule:
        'This rule finds its codes with a pattern. It can be changed under Advanced.',
      usePlain: 'Use a list of codes instead',
    },
    rule: {
      label: 'Name of this rule',
      labelHelp: 'Shown in reports, for example “Path wait”.',
      codes: 'Wait codes',
      codesHelp: 'Codes and ranges, separated by commas or blanks: M100-M199, M300.',
      semantics: 'What is checked',
      semanticsHelp: 'Pick the one that fits how these codes work.',
      blocking: 'These codes make a {noun} wait',
      blockingHelp: 'Untick for a code that only sets a flag. It is still shown, but never checked.',
      partners: '{Noun}s named by',
      partnersHelp: 'Which {nouns} a wait waits for.',
      partnerChannels: 'Which {nouns}',
      absent: 'A wait without a {address} word means',
      absentHelp: 'What to assume when the line has no {address} word.',
      absentChannels: 'Which {nouns} then',
    },
    semantics: {
      rendezvous: 'Numbered waits: the same number must meet in the same order in the other {noun}',
      count: 'Waits without a number: every {noun} needs the same number of them',
      ordered: 'Order numbers: a number must not go down inside a {noun}, and may be missing on one side',
    },
    partners: {
      all: 'Every {noun}',
      fixed: 'These {nouns}',
      digits: 'The {address} word as {noun} numbers: {address}12 = {nouns} 1 and 2, 0 = {noun} 10',
      bitmask: 'The {address} word as a bit sum: {address}3 = {nouns} 1 and 2 (1 + 2)',
      line: 'Found by a pattern on the line (Advanced)',
    },
    absent: {
      none: 'No partner (reported as not matched)',
      all: 'Every {noun}',
      fixed: 'These {nouns}',
    },

    // The wait-code field's live preview
    codes: {
      matches: 'Matches {items}',
      all: '{count} codes in all',
      one: '1 code',
      many: '{count} codes',
      empty: 'Enter at least one code, for example M100-M199.',
    },

    // Advanced
    advanced: {
      title: 'Advanced',
      help: 'Patterns for the cases the plain settings cannot describe. Most machines never need this.',
      regexHelp: 'Help with patterns',
      sectionStart: 'A section starts at the line matching',
      sectionStartHelp: 'A pattern. Capture the {noun} as (?<channel>…); without it the first start is the first {noun}, and so on.',
      sectionStartFromNames: 'Use the names above',
      sectionEnd: 'A section ends at the line matching',
      sectionEndHelp: 'Optional. Without it a section runs to the next start.',
      sectionSeparator: 'Separator inside one start line',
      sectionSeparatorHelp: 'Optional. One character, for example /, when one line starts several {nouns}.',
      fileName: 'File names match',
      fileNameHelp: 'A pattern for the name, with (?<stem>…) and (?<channel>…). Optional.',
      fileNameFor: 'The other files are named',
      fileNameForHelp: 'A template with {stem} and {channel}, for example {stem}_CH{channel}.nc. Optional.',
      marker: 'A line in the program names its {noun}',
      markerHelp: 'A pattern with (?<channel>…), looked for in the first 400 lines. Optional.',
      matchKind: 'These codes are found by',
      matchCodes: 'A list of codes',
      matchPrefix: 'A start and some digits',
      matchRegex: 'A pattern',
      prefix: 'Starts with',
      prefixHelp: 'For example M1.',
      idMin: 'At least this many digits',
      idMax: 'At most this many digits',
      pattern: 'Pattern',
      patternHelp: 'Capture the wait’s number as (?<mark>…); a rule that checks by count has none.',
      address: 'Address letter',
      addressHelp: 'The letter of the word that names the {nouns}, usually P.',
      linePattern: 'Pattern for the {nouns} on the line',
      linePatternHelp: 'Capture them as (?<channels>…).',
      lineSeparator: 'Separator',
      lineSeparatorHelp: 'Between {nouns} in the capture; a comma when empty.',
      lineDecode: 'The capture is read as',
      decodeSplit: 'A list of names',
      decodeDigits: '{Noun} numbers, 0 = {noun} 10',
      decodeBitmask: 'A bit sum',
    },
  },
} as const satisfies Messages;
