// App shell: ribbon tabs, panel chrome and the status bar. Owner: WP1.5.
// One namespace per feature (plan AD-14); the namespace name is this file's name.

import type { Messages } from '../types';

export default {
  workspace: 'gEdit / Workspace',
  ribbon: 'Ribbon',
  ribbonTabs: 'Ribbon tabs',
  statusBar: 'Status bar',

  // Ribbon tabs, in the order of AD-6. Looked up through a map in Ribbon.svelte,
  // so shell.test.ts checks that each of these keys exists.
  tabHome: 'Home',
  tabInsert: 'Insert',
  tabNc: 'NC',
  tabTools: 'Tools',
  tabView: 'View',

  // Panel chrome
  panels: 'Panels',
  hidePanel: 'Hide the {panel} panel',
  resizeSidePanel: 'Resize the side panel',
  resizeBottomPanel: 'Resize the bottom panel',

  // Status bar. The file name lives in the `files` namespace: it is `contrib/files.ts`
  // that registers that item (I2), and the shell only renders the message slot.
  startFailed: 'gEdit could not finish starting up: {error}',
} as const satisfies Messages;
