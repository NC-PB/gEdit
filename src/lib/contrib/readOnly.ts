// Read-only documents: the `file.toggleReadOnly` command and the lock in the status bar
// (plan §5 WP7.3, §7.13, AD-23). One feature per file (plan AD-3); see ./README.md.
//
// Everything the lock actually does lives elsewhere, and deliberately so:
//
//   - `app/fileOps.ts` decides it (the file's attribute at open, this command later) and
//     sends Save of a locked document to Save As;
//   - `monaco/editorService.ts` puts it on the editor, in the same block as the model
//     switch, so no paint ever shows a locked program in an editable editor;
//   - `components/editor/TabBar.svelte` and `ReadOnlyStatus.svelte` show it.
//
// This file is only the way a user reaches it. The command is deliberately **not** on a
// shortcut (§7.13 gives it none): locking is rare, and an accidental one would look like
// a broken keyboard.

import ReadOnlyStatus from '$lib/components/status/ReadOnlyStatus.svelte';
import { files } from '$lib/app/fileOps';
import { status } from '$lib/app/status';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { Contribution, DocId } from '$lib/app/types';

/** The tab bar passes a document id; anything else means "the active one". */
function docArg(arg: unknown): DocId | null {
  if (typeof arg === 'string' && arg.length > 0) return arg;
  return docs.getActiveId();
}

/**
 * Locks an editable document and unlocks a locked one, and says which it did.
 *
 * Unlocking a document whose *file* carries the read-only attribute frees the buffer and
 * nothing else (AD-23): gEdit never changes a file's attributes, so the next Save still
 * goes to Save As. The message therefore names the tab, not the file.
 */
function toggle(arg: unknown): void {
  const id = docArg(arg);
  const doc = id === null ? undefined : docs.get(id);
  if (!doc) return;
  files.setReadOnly(doc.id, !doc.readOnly);
  status.show(doc.readOnly ? t('readOnly.unlocked', { name: doc.title }) : t('readOnly.locked', { name: doc.title }));
}

export default {
  id: 'readOnly',
  commands: [
    {
      id: 'file.toggleReadOnly',
      title: 'readOnly.toggle',
      category: 'files.category',
      global: true,
      enabled: (c) => c.activeDocId !== null,
      run: (_c, arg) => toggle(arg),
    },
  ],
  // Right of the cursor position (40), at the end of the row: it appears and disappears,
  // and an item that comes and goes in the middle would shift the ones beside it.
  statusItems: [{ id: 'readonly', side: 'right', order: 60, component: ReadOnlyStatus }],
} satisfies Contribution;
