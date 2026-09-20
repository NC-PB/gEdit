// Recent files: the Home "Recent" dropdown and the two commands (plan §5 WP2.3, AD-9).
// One feature per file (plan AD-3); see ./README.md.
//
// The list itself lives in Rust (`stores/recent.ts` only mirrors it), because reopening a
// file from the last session must need no dialog: `recent_touch` accepts a path only when
// the fs scope already allows it, and `setup` re-grants the entries at startup.
//
// No shortcut: §7.11 assigns none to either command, and anything else would log a key
// conflict that fails the runtime harness.

import Clock from 'lucide-svelte/icons/clock';
import Trash2 from 'lucide-svelte/icons/trash-2';
import RecentMenu from '$lib/components/menus/RecentMenu.svelte';
import { asIcon } from '$lib/app/icons';
import { dialogs } from '$lib/app/dialogs';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { recent } from '$lib/stores/recent';
import { baseName } from '$lib/utils/platform';
import { t } from '$lib/i18n';
import { get } from 'svelte/store';
import type { Contribution, Disposable, QuickPickItem } from '$lib/app/types';
import type { RecentEntry } from '$lib/platform/commands';

/** `file.openRecent` takes a path from the ribbon dropdown; anything else means "ask". */
function pathArg(arg: unknown): string | undefined {
  return typeof arg === 'string' && arg.length > 0 ? arg : undefined;
}

function entries(): RecentEntry[] {
  return get(recent.list);
}

/**
 * A file that is no longer there. Opening it would only produce an error dialog, so the
 * entry is offered for removal instead — which is the only way a stale entry ever leaves
 * the list short of clearing all of it.
 */
async function offerRemoval(path: string): Promise<void> {
  const name = baseName(path);
  const remove = await dialogs.confirm({
    title: t('recent.missingTitle'),
    message: t('recent.missingMessage', { name, path }),
    ok: t('recent.removeButton'),
    cancel: t('common.cancel'),
    kind: 'warning',
  });
  if (!remove) return;
  await recent.remove(path);
  status.show(t('recent.removed', { name }));
}

/** Opens `path`, or asks which entry to open when there is none. */
async function openRecent(path?: string): Promise<void> {
  // Rust re-stats every entry, so this is what makes `exists` mean "now" rather than
  // "when the list was last read". Without it a file deleted while the app ran was opened
  // and failed with the generic error dialog instead of being offered for removal, and the
  // dropdown kept showing it without the "(not found)" label (G8 M2). One IPC round trip,
  // at most `MAX_RECENT` stats, and only when the user actually asks for a recent file.
  await recent.refresh();
  const list = entries();
  let wanted = path;
  if (wanted === undefined) {
    if (list.length === 0) {
      status.show(t('recent.empty'));
      return;
    }
    const items: QuickPickItem<string>[] = list.map((entry) => ({
      label: baseName(entry.path),
      description: entry.path,
      detail: entry.exists ? undefined : t('recent.missing'),
      value: entry.path,
    }));
    wanted = await modals.quickPick(items, { placeholder: t('recent.placeholder') });
    if (wanted === undefined) return;
  }
  // Checked against the list that was just re-read. A file that goes away between that
  // stat and the read below still fails to open, with the error dialog `files.open` shows.
  if (list.some((entry) => entry.path === wanted && !entry.exists)) {
    await offerRemoval(wanted);
    return;
  }
  await files.open([wanted]);
}

async function clearRecent(): Promise<void> {
  await recent.clear();
  status.show(t('recent.cleared'));
}

export default {
  id: 'recent',
  commands: [
    {
      id: 'file.openRecent',
      title: 'recent.openRecent',
      category: 'recent.category',
      icon: asIcon(Clock),
      global: true,
      // The dropdown passes a path, so the command stays usable while the list is empty
      // only through the picker, which says so instead of opening an empty modal.
      run: (_c, arg) => dialogs.exclusive(() => openRecent(pathArg(arg))),
    },
    {
      id: 'file.clearRecent',
      title: 'recent.clearRecent',
      category: 'recent.category',
      icon: asIcon(Trash2),
      global: true,
      enabled: () => entries().length > 0,
      run: () => clearRecent(),
    },
  ],
  ribbonGroups: [
    // Between the File group (order 10) and the Program group (order 20) of the Home tab.
    { tab: 'home', group: 'recent.groupRecent', order: 15, component: RecentMenu },
  ],
  activate(): Disposable {
    // The list is Rust's; read it once so the dropdown has something on the first render.
    void recent.refresh();
    const off: Disposable[] = [
      files.onDidOpen((_id, path) => void recent.touch(path)),
      files.onDidSave((_id, path) => void recent.touch(path)),
    ];
    return () => {
      for (const dispose of off.reverse()) dispose();
    };
  },
} satisfies Contribution;
