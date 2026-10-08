// Dialect profile status item, picker and dialog filters (WP1.6: `stores/profiles.ts`,
// `contrib/profileSelect.ts`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Profile names ('Fanuc', 'Heidenhain Klartext') are data, not UI strings, and stay
// untranslated (contrib README rule 3).

import type { Messages } from '../types';

export default {
  category: 'File',

  // Command
  setProfile: 'Change Dialect…',

  // Status item
  tooltip: 'Dialect: {name}. Click to change it.',

  // Picker
  placeholder: 'Read this document as…',
  extensions: 'Extensions: {list}',
  // A dialect and the one it builds on are offered as one family, so "Fanuc (ISO) mill"
  // and "Fanuc (ISO) lathe" read as two machines of the same control and not as two
  // unrelated entries (M6, AD-16). `{group}` is what the two names have in common.
  grouped: '{group} · {name}',

  // Status message
  changed: '{name} now uses the {profile} dialect',

  // M12.5, owner decision of 2026-10-08: no profile fits the program well (plan §7.16 #177).
  // `{name}` is the short name of the guessed dialect (data, untranslated).
  uncertain: {
    // The status item: the guess, marked as one.
    label: '{name}?',
    tooltip: 'Dialect uncertain: this program fits none of the dialects well. It is read as {name}, the closest guess. Click to choose the dialect, or keep the guess.',
    // The picker, opened on an uncertain document.
    placeholder: 'The control that wrote this program is not clear. Read it as…',
    keep: 'Keep {name} (the guess)',
    keepDetail: 'Remembered for this file; the warning goes away',
    // Once, in the status line, when such a file is opened.
    opened: '{file}: the dialect is uncertain; read as {name} for now. Click the dialect in the status bar to choose.',
    kept: '{file} keeps the {name} dialect',
  },

  // Dialog filters (Windows and Linux only; macOS gets none, AD-7 / F7)
  filterNc: 'NC programs',
  filterAll: 'All files',
} as const satisfies Messages;
