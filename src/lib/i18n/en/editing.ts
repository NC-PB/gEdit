// Monaco's editing features in the ribbon (contrib/editing.ts). Owner: WP4.4.
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// The button labels are deliberately short: they sit under a 22px icon in a ribbon button
// whose label is clipped at 96px, and the tooltip carries the full title anyway.

import type { Messages } from '../types';

export default {
  /** The palette prefix of the Home-tab commands, and of the View-tab ones. */
  category: 'Edit',
  categoryView: 'View',

  groupEdit: 'Edit',
  undo: 'Undo',
  redo: 'Redo',
  find: 'Find',
  replace: 'Replace',
  toggleComment: 'Comment',
  duplicateLine: 'Duplicate',
  moveLineUp: 'Move Up',
  moveLineDown: 'Move Down',
  deleteLine: 'Delete Line',
  selectAll: 'Select All',
  upperCase: 'Upper Case',
  lowerCase: 'Lower Case',

  groupCode: 'Code',
  foldAll: 'Fold All',
  unfoldAll: 'Unfold All',
  quickOutline: 'Quick Outline',

  groupDisplay: 'Display',
  toggleWhitespace: 'Whitespace',
  toggleWordWrap: 'Word Wrap',
  toggleMinimap: 'Minimap',
  toggleStickyScroll: 'Sticky Scroll',

  groupZoom: 'Zoom',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  zoomReset: 'Reset Zoom',

  /** The names the two messages below are built with. */
  whitespace: 'Whitespace',
  wordWrap: 'Word wrap',
  minimap: 'Minimap',
  stickyScroll: 'Sticky scroll',
  turnedOn: '{name} is on.',
  turnedOff: '{name} is off.',
} as const satisfies Messages;
