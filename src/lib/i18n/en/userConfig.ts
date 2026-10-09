// The user's own profiles and code files: the Profiles page and its commands (plan §6 M13,
// AD-29, §7.13). Owner: WP13.3; the category, the ribbon group and the command titles were
// pinned by the M13 prelude (P13); WP13.3 adds the rest (the page, the prompts, the
// messages of a load and of the Results report).
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  category: 'Profiles',
  /** Caption of the Tools-tab group of the tester (`{ tab: 'tools', group: 'userConfig.toolsGroup' }`). */
  toolsGroup: 'Profiles',

  /** `profile.newFrom`: a new user profile (or code file) that extends one you pick, opened. */
  newFrom: 'New Profile From…',
  /** `profile.open`: a user profile or code file, opened as a document. */
  open: 'Open Profile File…',
  /** `profile.import`: a picked file copied into your profiles or code files. */
  import: 'Import Profile File…',
  /** `profile.export`: a user profile or code file saved where you choose. */
  export: 'Export Profile File…',
  /** `profile.manage`: the Settings dialog, on the Profiles page. */
  manage: 'Manage Profiles…',
  /** `profile.reload`: both folders read again. */
  reload: 'Reload Profiles',
  /** `profile.testOnDocument`: what every rule of the document's profile finds, per line, in Results. */
  testOnDocument: 'Test Profile on Document',

  // --- where a set comes from ----------------------------------------------------------
  origin: {
    builtin: 'Built in',
    user: 'Yours',
  },

  // --- asking (from the palette) -------------------------------------------------------
  kind: {
    placeholder: 'What do you want to work with?',
    profiles: 'A profile',
    profilesDetail: 'How the programs of one machine or post are read, numbered and found',
    codes: 'A code file',
    codesDetail: 'Your own G and M codes with their descriptions, for hover and completion',
  },
  name: {
    invalid: 'Use lower-case letters, digits, "-", "_" and "." (at most 64 characters, starting with a letter or a digit).',
    device: 'That name is reserved by Windows. Choose another.',
    taken: '{name} already exists. Choose another name.',
    profileExists: 'A profile with that name already exists. Choose another name.',
    codesBuiltin:
      '"{name}" is the name of a built-in code set. Use it only to add to that set; to start a new one, choose another name.',
  },
  noProfileFiles: 'You have no profile files yet. Use New Profile From… to make one.',
  noCodeFiles: 'You have no code files yet. Use New Profile From… to make one.',
  pickProfileFile: 'Which profile file?',
  pickCodeFile: 'Which code file?',

  create: {
    parentProfile: 'Start from which profile?',
    parentCodes: 'Start from which code set?',
    nameProfile: 'Name of the new profile file (starts from {parent})',
    nameCodes:
      'Name of the new code file. The name "{parent}" adds to that set; another name makes a new set that starts from it.',
    namePlaceholder: 'File name, without .json',
    created: '{name} was created and opened. Save it to use it.',
    createdNotOpened: '{name} was created, but it could not be opened. Use Open Profile File… to edit it.',
    failed: 'The file could not be created',
  },
  openFailed: '{name} could not be opened',
  importer: {
    pickProfile: 'Choose a profile file to import',
    pickCodes: 'Choose a code file to import',
    done: '{name} was imported.',
    doneProblems: '{name} was imported, but it has problems (see Results).',
    failed: 'The file could not be imported',
  },
  exporter: {
    done: '{name} was saved as {file}.',
    failed: '{name} could not be exported',
  },
  reloaded: {
    done: 'Profiles reloaded: {profiles} of yours, {codes} code files.',
    problems_one: 'Profiles reloaded, with {count} problem (see Results).',
    problems_other: 'Profiles reloaded, with {count} problems (see Results).',
  },

  // --- Test Profile on Document ---------------------------------------------------------
  test: {
    title: '{profile} on {document}',
    titleNone: '{profile} on {document}: nothing found',
    shown_one: '{count} finding in Results.',
    shown_other: '{count} findings in Results.',
    unknownProfile: 'There is no profile called {id}.',
    detected: 'gEdit would open this text as {profile}.',
    detectedUncertain: 'gEdit would open this text as {profile}, but it is not sure.',
    truncated: 'Only the first {max} lines were tested.',
    running: 'A test is already running.',
    slow_one: 'A rule needed more than {limit} ms on one line (the slowest: {ms} ms, line {line}): {rule}. Such a pattern slows down opening a large program; make it more specific.',
    slow_other: '{count} rules needed more than {limit} ms on one line (the slowest: {ms} ms, line {line}): {rule}. Such patterns slow down opening a large program; make them more specific.',
    total: 'All rules together: {ms} ms.',
    time: '{ms} ms',
    timeTiny: '< 0.01 ms',
    columnLine: 'Line',
    columnWhat: 'What',
    columnRule: 'Rule',
    columnFound: 'Found',
    columnTime: 'Time',
    what: {
      detect: 'Finding the dialect',
      veto: 'Ruled out',
      toolCall: 'Tool change',
      programStart: 'Program start',
      programEnd: 'Program end',
      outline: 'Program map',
      reference: 'Block-number reference',
      numbering: 'Renumbering leaves it',
      variant: 'Setting read from the program',
      variantResult: 'Setting chosen',
      stopped: 'Test stopped',
    },
    found: {
      detect: '"{text}" counts {weight} for this profile',
      detectVetoed: '"{text}" would count {weight}, but line {line} rules this profile out, so it does not count',
      stopped: 'The rules needed more than {seconds} seconds in all, so the test stopped after {count} lines. Make the slow rules more specific and test again.',
      veto: '"{text}" rules this profile out for the program',
      toolChange: '"{text}" changes to tool {tool}',
      toolChangeNoTool: '"{text}" changes the tool, but no tool number was read',
      toolIgnored: '"{text}" looks like a tool change but "{by}" cancels it, so it is not counted',
      toolWord: 'tool {tool} is named here, without a tool change',
      programStart: 'A program starts here: {text}',
      programEnd: 'The program ends here: {text}',
      outline: 'Shown as {kind}: {text}',
      reference: '{text} points at block {target}; renumbering updates it',
      referenceKept: '{text} points at block {target}; renumbering does not touch it',
      referenceComputed: '{text} is not a plain block number; renumbering cannot follow it',
      variant: '{label}: "{text}" speaks for {choice} (counts {weight})',
      variantActs: '{label}: {choice}, ahead by {margin} (at least {needed} is needed to act on it)',
      variantUnsure: '{label}: leans to {choice}, ahead by only {margin} (at least {needed} is needed), so {default} stays',
    },
    outlineKind: {
      tool: 'a tool change',
      program: 'a program',
      section: 'a section heading',
      comment: 'a comment',
      label: 'a label',
      stop: 'a stop',
      end: 'an end',
      subprogramCall: 'a subprogram call',
      channel: 'a channel',
      sync: 'a wait mark',
    },
  },

  // --- Settings ▸ Profiles ---------------------------------------------------------------
  page: {
    intro:
      'Profiles say how the programs of one control or post are read. Yours start from a built-in one and change only what differs. Code files add your own G and M codes. A change takes effect when you save the file.',
    problem: '{path}: {message}',
    note: 'Note: {message}',
    extends: 'starts from {parent}',
    yourProfiles: 'Your profiles',
    noProfiles: 'You have no profiles of your own yet.',
    newProfile: 'New profile from…',
    importProfile: 'Import profile…',
    yourCodes: 'Your code files',
    noCodes: 'You have no code files of your own yet.',
    newCodes: 'New code file from…',
    importCodes: 'Import code file…',
    builtin: 'Built-in profiles',
    newFromThis: 'New profile from this…',
    open: 'Open',
    export: 'Export…',
    remove: 'Remove…',
    test: 'Test on document',
    reload: 'Reload',
    create: 'Create',
    cancel: 'Cancel',
    newProfileTitle: 'New profile',
    newCodesTitle: 'New code file',
    parentProfile: 'Start from',
    parentProfileHelp: 'The new profile reads programs the way this one does, until you change something.',
    parentCodes: 'Start from',
    parentCodesHelp: 'The built-in set the new code file adds to.',
    fileName: 'File name',
    fileNameHelp: 'Without .json. It is also the profile\'s name until you change it in the file.',
    fileNameHelpCodes: 'Without .json. The name of the set you start from adds to that set; another name makes a new set.',
    removeTitle: 'Remove {name}?',
    removeMessageProfile: 'The file is deleted from your profiles folder. Documents that use this profile are opened again as the dialect gEdit detects. This cannot be undone.',
    removeMessageCodes: 'The file is deleted from your code files folder. This cannot be undone.',
    removed: '{name} was removed.',
    removeFailed: '{name} could not be removed',
  },

  // --- loading your files (app/userConfig.ts) ------------------------------------------
  load: {
    /** The one status message of a load that moved documents off a profile that is gone. */
    redetected_one: 'The dialect of {count} open document is gone; it is read as the detected one',
    redetected_other: 'The dialect of {count} open documents is gone; they are read as the detected ones',
    /** The one status message of a load that put documents back on a profile that is loaded again. */
    restored_one: '{count} open document is back on its own dialect',
    restored_other: '{count} open documents are back on their own dialects',
    /** A file whose data nests too deeply to be read safely. */
    tooDeep: 'The file is nested too deeply (more than {max} levels) and was not loaded.',
    /** The last row of a file or a load that had more problems than are listed. */
    more_one: 'and {count} more not listed',
    more_other: 'and {count} more not listed',
    /** The Results report of a load that found problems. */
    report: {
      title: 'Profiles and code files',
      summary_one: '{count} problem in your profiles and code files. Everything else loaded.',
      summary_other: '{count} problems in your profiles and code files. Everything else loaded.',
      notes_one: 'And {count} note.',
      notes_other: 'And {count} notes.',
      onlyNotes_one: '{count} note on your profiles and code files. Everything loaded.',
      onlyNotes_other: '{count} notes on your profiles and code files. Everything loaded.',
      note: 'Note:',
      file: 'File',
      at: 'Where',
      problem: 'Problem',
    },
  },
} as const satisfies Messages;
