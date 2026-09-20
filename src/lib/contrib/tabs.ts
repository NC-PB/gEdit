// Moving between the open documents (plan §7.11: Ctrl+Tab, Ctrl+Shift+Tab, Mod+Alt+O).
// One feature per file (plan AD-3); see ./README.md.
//
// The tab bar itself is `components/editor/TabBar.svelte`, which the shell renders as
// part of the layout (AD-6); this file only contributes the commands.

import { modals } from '$lib/app/modals';
import { editor } from '$lib/monaco/editorService';
import { docs } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import type { Contribution, DocId, QuickPickItem } from '$lib/app/types';

/** More than one document is open, so there is somewhere to go. */
function manyDocs(): boolean {
  return docs.all().length > 1;
}

/** Activates the document `delta` tabs along, wrapping at both ends. */
function step(delta: number): void {
  const all = docs.all();
  if (all.length < 2) return;
  const at = all.findIndex((doc) => doc.id === docs.getActiveId());
  const next = all[(((at < 0 ? 0 : at) + delta) % all.length + all.length) % all.length];
  docs.activate(next.id);
  editor.focus();
}

async function switchTab(): Promise<void> {
  const all = docs.all();
  if (all.length === 0) return;
  const items: QuickPickItem<DocId>[] = all.map((doc) => ({
    label: doc.title,
    description: doc.path ?? undefined,
    value: doc.id,
  }));
  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.value === docs.getActiveId()),
  );
  const picked = await modals.quickPick(items, {
    placeholder: t('tabs.switchPlaceholder'),
    initialIndex,
  });
  if (picked === undefined) return;
  docs.activate(picked);
  editor.focus();
}

export default {
  id: 'tabs',
  commands: [
    {
      id: 'view.nextTab',
      title: 'tabs.nextTab',
      category: 'tabs.category',
      keys: 'Ctrl+Tab',
      global: true,
      enabled: manyDocs,
      run: () => step(1),
    },
    {
      id: 'view.prevTab',
      title: 'tabs.prevTab',
      category: 'tabs.category',
      keys: 'Ctrl+Shift+Tab',
      global: true,
      enabled: manyDocs,
      run: () => step(-1),
    },
    {
      id: 'view.switchTab',
      title: 'tabs.switchTab',
      category: 'tabs.category',
      keys: 'Mod+Alt+O',
      global: true,
      enabled: manyDocs,
      run: () => switchTab(),
    },
  ],
} satisfies Contribution;
