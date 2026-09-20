// Registries, key dispatch, the command palette and the QuickPick (WP1.1).
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  // Ribbon
  categoryView: 'View',
  groupCommands: 'Commands',

  // Commands
  commandPalette: 'Command Palette',
  commandUnknown: 'Unknown command: {id}',
  commandDisabled: '{title} is not available right now',
  commandFailed: '{title} failed',

  // QuickPick
  quickPickLabel: 'Quick pick',
  quickPickPlaceholder: 'Type to filter…',
  quickPickEmpty: 'No matching items',
} as const satisfies Messages;
