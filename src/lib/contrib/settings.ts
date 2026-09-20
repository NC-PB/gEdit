// The settings dialog (plan §5 WP2.7, §7.11). Owner: WP2.7.
// One feature per file (plan AD-3); see ./README.md.
//
// `settings.open` is §7.11's `Mod+,`, the platform-standard key for preferences, and the
// only M2 binding that was still unclaimed. `global: true`, so it also works while focus
// is outside Monaco.
//
// The dialog is the *second* way to edit the settings; the first is the file itself,
// which "Open settings file" opens as an ordinary document. That is why `activate()`
// watches for a save of exactly that document: without it the file on disk and the
// effective values would drift apart until the next start.

import Settings2 from 'lucide-svelte/icons/settings-2';
import SettingsDialog from '$lib/components/dialogs/SettingsDialog.svelte';
import { asIcon } from '$lib/app/icons';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { docs } from '$lib/stores/documents';
import { settings } from '$lib/stores/settings';
import { t } from '$lib/i18n';
import { get } from 'svelte/store';
import type { Contribution, Disposable, DocId } from '$lib/app/types';

/**
 * True when `id` is the document that holds `settings.json`. The lookup goes through
 * `docs.byPath`, so the platform's rule for comparing paths is the app's one rule
 * (case-insensitive on macOS and Windows) rather than a second one here.
 */
function isSettingsDocument(id: DocId): boolean {
  const file = get(settings.paths)?.settingsFile;
  if (file === undefined) return false;
  return docs.byPath(file)?.id === id;
}

export default {
  id: 'settings',
  commands: [
    {
      id: 'settings.open',
      title: 'settings.open',
      category: 'settings.category',
      icon: asIcon(Settings2),
      keys: 'Mod+,',
      global: true,
      run: () => modals.open(SettingsDialog, {}),
    },
  ],
  // A group's place in the tab is the smallest `order` its items carry, so 95 puts
  // Settings between WP2.6's Appearance group (90) and WP2.4's Help group (100).
  ribbon: [{ tab: 'view', group: 'settings.group', command: 'settings.open', order: 95 }],
  activate(): Disposable {
    return files.onDidSave((id) => {
      if (!isSettingsDocument(id)) return;
      void settings.reloadFromDisk().catch((err: unknown) => {
        status.show(t('settings.reloadFailed'), {
          error: true,
          detail: err instanceof Error ? err.message : String(err),
        });
      });
    });
  },
} satisfies Contribution;
