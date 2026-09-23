// The settings dialog and every setting's label, help text and choices (plan §5 WP2.7,
// §7.7). Owner: WP2.7.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// `SETTING_FIELDS` in `core/settings/schema.ts` is a static table, so it carries i18n
// **keys** rather than text: `settings.<key>.label`, `settings.<key>.help` and
// `settings.<key>.choices.<value>`. A dotted setting key therefore becomes nested objects
// here (`appearance: { theme: { label, help, choices } }`), because a key segment has to
// be an identifier (`i18n/keys.test.ts`). `SettingsDialog.test.ts` checks that every row
// of the table finds all three.
//
// The help text says what the setting does, not what the control is: the label already
// names the control.

import type { Messages } from '../types';

export default {
  // Ribbon, palette and the command itself
  category: 'Settings',
  group: 'Settings',
  open: 'Settings',

  // The dialog frame
  title: 'Settings',
  categoriesLabel: 'Settings categories',
  categories: {
    appearance: 'Appearance',
    editor: 'Editor',
    assistance: 'Assistance',
    files: 'Files',
    scripts: 'Scripts',
    machines: 'Machines',
  },
  saved: 'Settings saved',
  saveFailed: 'The settings could not be saved',
  reset: 'Reset category',
  resetTitle: 'Reset {category}?',
  resetMessage:
    'Put every {category} setting back to its default? This is written to settings.json right away, whether or not you save the rest.',
  resetFailed: 'The settings could not be reset',
  resetDone: '{category} settings were reset',
  // The Machines page (M6, AD-31). A machine configuration says how one control reads its
  // programs; without one, gEdit uses the profile's documented defaults and says so.
  machinesEmpty:
    'No machines yet. Documents are read with the defaults their dialect profile documents, and anything that depends on the machine is shown as assumed.',
  openFile: 'Open settings file',
  openFileFailed: 'The settings file could not be opened',
  reloadFailed: 'The saved settings file could not be read again',
  readOnly:
    'settings.json was written by a newer version of gEdit. It is read but never overwritten, so nothing here can be saved.',
  problemError: 'The settings file could not be read, so the defaults are in use: {detail}',
  problemIgnored_one: 'One value in settings.json was ignored and its default is in use: {detail}',
  problemIgnored_other: '{count} values in settings.json were ignored and their defaults are in use: {detail}',

  // The Scripts page's folder list and the user scripts folder
  listAdd: 'Add folder…',
  listRemove: 'Remove {path}',
  listEmpty: 'No extra folders.',
  pickScriptFolder: 'Choose a script folder',
  folderAlready: 'That folder is already in the list',
  scriptsFolder: 'Your scripts folder',
  scriptsFolderHelp: 'gEdit always reads this folder. Select the path to copy it.',
  pathUnknown: 'Not available',

  // --- one entry per key of §7.7 -------------------------------------------

  appearance: {
    theme: {
      label: 'Color theme',
      help: 'System follows the light or dark setting of the operating system.',
      choices: { system: 'System', light: 'Light', dark: 'Dark' },
    },
    editorFontFamily: {
      label: 'Editor font',
      help: 'A list of font families; the first one installed on this computer is used.',
    },
    editorFontSize: { label: 'Editor font size', help: 'In pixels, from 8 to 32.' },
  },

  editor: {
    tabWidth: { label: 'Tab width', help: 'How many columns one tab stands for.' },
    insertSpaces: {
      label: 'Insert spaces instead of tabs',
      help: 'The Tab key then writes spaces. Controls that reject tabs need this.',
    },
    renderWhitespace: {
      label: 'Show spaces and tabs',
      help: 'Makes blanks visible as dots and arrows.',
      choices: { none: 'Never', boundary: 'Between words', all: 'Always' },
    },
    wordWrap: { label: 'Wrap long lines', help: 'A block too long for the window continues on the next screen line.' },
    minimap: { label: 'Show the minimap', help: 'The scaled-down overview on the right edge of the editor.' },
    lineNumbers: { label: 'Show line numbers', help: 'The editor line numbers, which are not the N numbers of the program.' },
    highlightCurrentLine: { label: 'Highlight the current line', help: 'Marks the line the cursor is on.' },
    stickyScroll: {
      label: 'Keep the current section in view',
      help: 'While you scroll, the tool or section heading the lines belong to stays at the top.',
    },
    dragAndDrop: {
      label: 'Move selected text by dragging it',
      help: 'Off by default, because dragging inside the editor competes with dropping a file into the window.',
    },
    emptySelectionClipboard: {
      label: 'Copy the whole line when nothing is selected',
      help: 'Copy and Cut without a selection then take the cursor line.',
    },
    rulers: {
      label: 'Column rulers',
      help: 'Vertical lines at these columns. Edit settings.json to change them.',
    },
  },

  assist: {
    hover: { label: 'Explain a code when the mouse rests on it', help: 'The hover card with the meaning of the word under the pointer.' },
    completion: {
      label: 'Code completion',
      help: 'Suggestions for addresses and codes of the current dialect.',
      choices: { auto: 'While typing', manual: 'Only when asked', off: 'Off' },
    },
  },

  files: {
    recentLength: { label: 'Recent files to remember', help: 'Zero turns the recent list off.' },
    externalChange: {
      label: 'When a file changes outside gEdit',
      help: 'A document with unsaved changes always asks, whatever is set here.',
      choices: { ask: 'Ask what to do', reload: 'Reload it' },
    },
    defaultProfile: {
      label: 'Default dialect',
      help: 'Used for a new file and for a file whose dialect cannot be recognized.',
    },
    backup: {
      label: 'Keep a copy before saving',
      help: 'The copy is made from what is on disk just before gEdit writes over it, so the previous version of the program is never gone.',
      choices: {
        history: 'In gEdit (keeps several versions)',
        sibling: 'Next to the file (.bak)',
        off: 'Do not keep one',
      },
    },
    backupCount: {
      label: 'Versions to keep',
      help: 'How many earlier versions of each file gEdit keeps. Only for copies kept in gEdit.',
    },
    recovery: {
      label: 'Recover unsaved changes after a crash',
      help: 'Unsaved work is written aside every half minute and offered back the next time gEdit starts. Nothing is sent anywhere.',
    },
    restoreSession: {
      label: 'Reopen the last files at start',
      help: 'The files that were open when gEdit was closed come back, with the one you were on in front.',
    },
    rememberPerFile: {
      label: 'Remember where you were in each file',
      help: 'The cursor line, the bookmarks, and a dialect or machine you chose by hand come back when you open the file again.',
    },
  },

  scripts: {
    python: {
      label: 'Python interpreter',
      help: 'The interpreter scripts run in. Leave it empty to let gEdit find one.',
    },
    folders: {
      label: 'Extra script folders',
      help: 'Searched for scripts as well as your own scripts folder.',
    },
    timeoutSeconds: {
      label: 'Script timeout',
      help: 'Seconds a script may run before it is stopped.',
    },
    showBundled: {
      label: 'Show the scripts that ship with gEdit',
      help: 'Turn this off to see only your own scripts.',
    },
  },
} as const satisfies Messages;
