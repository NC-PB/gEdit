// Theme and editor appearance. Owner: WP2.6.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// The two `settings…` messages belong to the settings *file*, not to the theme. They live
// here because `contrib/theme.ts` is what applies the effective settings, and because the
// `settings` namespace is WP2.7's file; moving them there once the dialog lands is a
// rename in two places.

import type { Messages } from '../types';

export default {
  category: 'Appearance',
  group: 'Appearance',
  setTheme: 'Theme',
  placeholder: 'Select a color theme',
  system: 'System',
  systemDetail: 'Follow the operating system',
  light: 'Light',
  lightDetail: 'Always use the light theme',
  dark: 'Dark',
  darkDetail: 'Always use the dark theme',
  changed: 'Theme: {name}',
  settingsUnreadable: 'The settings could not be read; the defaults are in use',
  settingsIgnored_one: 'One setting was ignored; its default is in use',
  settingsIgnored_other: '{count} settings were ignored; their defaults are in use',
} as const satisfies Messages;
