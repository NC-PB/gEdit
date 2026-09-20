// The dialect of the active document: the status item and its picker
// (plan §5 WP1.6, §7.9). One feature per file (plan AD-3); see ./README.md.
//
// This replaces the M0 `profile-select` dropdown in the ribbon — one of the three
// intentional behaviour changes of M1. The profile decides the Monaco language, the
// save-dialog filters and the file name a new document is offered.

import ProfileStatus from '$lib/components/status/ProfileStatus.svelte';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { docs } from '$lib/stores/documents';
import { profiles } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import type { Contribution, QuickPickItem } from '$lib/app/types';

async function pickProfile(): Promise<void> {
  const id = docs.getActiveId();
  const doc = id === null ? undefined : docs.get(id);
  if (!doc) return;

  const all = profiles.list();
  const items: QuickPickItem<string>[] = all.map((info) => ({
    // Profile names are data, not UI strings (contrib README rule 3).
    label: info.name,
    description: info.id === doc.profileId ? '✓' : undefined,
    detail: t('profiles.extensions', { list: info.extensions.map((e) => `.${e}`).join(', ') }),
    value: info.id,
  }));
  const picked = await modals.quickPick(items, {
    placeholder: t('profiles.placeholder'),
    initialIndex: Math.max(
      0,
      all.findIndex((info) => info.id === doc.profileId),
    ),
  });
  if (picked === undefined || picked === doc.profileId) return;
  files.setProfile(doc.id, picked);
  status.show(t('profiles.changed', { name: doc.title, profile: profiles.get(picked)?.shortName ?? picked }));
}

export default {
  id: 'profileSelect',
  commands: [
    {
      id: 'file.setProfile',
      title: 'profiles.setProfile',
      category: 'profiles.category',
      global: true,
      enabled: (c) => c.activeDocId !== null,
      run: () => pickProfile(),
    },
  ],
  statusItems: [{ id: 'profile', side: 'right', order: 10, component: ProfileStatus }],
} satisfies Contribution;
