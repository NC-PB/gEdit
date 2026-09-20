// Files that changed under the editor: the banner and the poll behind it
// (`app/external.ts`, `components/editor/ExternalChangeBanner.svelte`,
// `contrib/externalChange.ts`). One namespace per feature (plan AD-14); the namespace
// name is this file's name.

import type { Messages } from '../types';

export default {
  // The panel the banner region registers (never shown as a tab caption, but a panel
  // title is an i18n key and the registry has no null).
  panelTitle: 'External change',

  // The banner
  changed: '{name} changed on disk.',
  deleted: '{name} was deleted on disk.',
  reload: 'Reload',
  keep: 'Keep mine',
  compare: 'Compare',
  reloadHint: 'Discard your buffer and read the file again',
  keepHint: 'Keep what is in the editor; the next save overwrites the file',
  compareHint: 'Show the differences against the saved file',

  // Status messages
  changedStatus: '{name} changed on disk.',
  deletedStatus: '{name} was deleted on disk. The text is still here; save it to write it back.',
  autoReloaded: '{name} changed on disk and was reloaded.',
  keptStatus: 'Keeping your version of {name}.',
} as const satisfies Messages;
