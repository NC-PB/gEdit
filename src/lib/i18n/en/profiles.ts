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

  // Status message
  changed: '{name} now uses the {profile} dialect',

  // Dialog filters (Windows and Linux only; macOS gets none, AD-7 / F7)
  filterNc: 'NC programs',
  filterAll: 'All files',
} as const satisfies Messages;
