// About and keyboard shortcuts (plan §5 WP2.4). Owner: WP2.4.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  // Ribbon and command palette
  category: 'Help',
  group: 'Help',
  about: 'About gEdit',
  shortcuts: 'Keyboard Shortcuts',

  // About dialog
  aboutTitle: 'About gEdit',
  tagline: 'An editor for NC programs.',
  version: 'Version',
  license: 'License',
  licenseName: 'MIT',
  repository: 'Repository',
  issues: 'Issue tracker',
  copyHint: 'Select the address to copy it.',
  updates: 'Updates',
  noUpdateCheck: 'gEdit never checks for updates. New versions are published in the repository.',
  thirdParty: 'Third-party notices',
  showThirdParty: 'Show third-party notices',
  thirdPartyLoading: 'Loading the third-party notices…',
  thirdPartyFailed: 'The third-party notices could not be loaded.',
  thirdPartyIntro: 'gEdit ships the following packages. Each one keeps its own license.',
  packages_one: '{count} package',
  packages_other: '{count} packages',
  showLicenseText: 'Show the license text of {name}',
  hideLicenseText: 'Hide the license text of {name}',
  sourceNpm: 'npm',
  sourceCargo: 'Rust',

  // Shortcuts dialog
  shortcutsTitle: 'Keyboard Shortcuts',
  filter: 'Filter',
  filterPlaceholder: 'Type to filter…',
  columnCommand: 'Command',
  columnShortcut: 'Shortcut',
  noShortcut: '—',
  noMatches: 'No matching commands',
  otherGroup: 'Other',
  platformHint: 'The keys are shown for this computer.',
  commands_one: '{count} command',
  commands_other: '{count} commands',
} as const satisfies Messages;
