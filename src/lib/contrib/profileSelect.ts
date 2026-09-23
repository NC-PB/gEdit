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
import { fileMemory } from '$lib/stores/fileMemory';
import { profiles } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import type { Contribution, ProfileInfo, QuickPickItem } from '$lib/app/types';

/** What the picker offers for one profile: its id and the name it is offered under. */
export interface PickerEntry {
  id: string;
  label: string;
}

/**
 * The leading words every name in a family shares (`''` when there are none).
 *
 * A head that is one of the names whole is no head at all: "Fanuc" and "Fanuc lathe" would
 * leave the first with nothing to be called, so those two are written out in full.
 */
function familyHead(names: readonly string[]): string {
  if (names.length < 2) return '';
  const words = names.map((name) => name.split(' '));
  let n = 0;
  while (words.every((parts) => n < parts.length && parts[n] === words[0][n])) n++;
  if (n === 0 || words.some((parts) => parts.length === n)) return '';
  return words[0].slice(0, n).join(' ');
}

/**
 * The picker's entries: every child right after the profile it extends (M6), and a family
 * that shares the start of its name offered under that shared part.
 *
 * The names are **data**, not UI strings (contrib README rule 3) — what this builds is the
 * grouping around them, so that a lathe profile that inherits from a mill one is visibly
 * the same control and not a second, unrelated dialect.
 *
 * `nameOf` gives a profile's display name (`Profile.name`), which is what a user calls the
 * dialect; `ProfileInfo.name` is the file-dialog filter and reads like one.
 */
export function pickerEntries(
  all: readonly ProfileInfo[],
  nameOf: (id: string) => string,
): PickerEntry[] {
  const known = new Set(all.map((info) => info.id));
  const childrenOf = new Map<string, ProfileInfo[]>();
  const roots: ProfileInfo[] = [];
  for (const info of all) {
    const parent = info.parent !== null && known.has(info.parent) && info.parent !== info.id ? info.parent : null;
    if (parent === null) roots.push(info);
    else childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), info]);
  }

  const out: PickerEntry[] = [];
  const seen = new Set<string>();
  const push = (info: ProfileInfo, head: string): void => {
    if (seen.has(info.id)) return;
    seen.add(info.id);
    const name = nameOf(info.id);
    const tail = head === '' ? name : name.slice(head.length).trim();
    const label = head === '' || tail === '' ? name : t('profiles.grouped', { group: head, name: tail });
    out.push({ id: info.id, label });
    for (const child of childrenOf.get(info.id) ?? []) push(child, head);
  };

  for (const root of roots) {
    // One head for the whole family, the parent's own children and theirs included: the
    // part every name in it starts with.
    const family: ProfileInfo[] = [root];
    for (let i = 0; i < family.length; i++) family.push(...(childrenOf.get(family[i].id) ?? []));
    push(root, familyHead(family.map((info) => nameOf(info.id))));
  }
  // A cycle among user profiles (M12) would leave someone out; the picker still lists it.
  for (const info of all) push(info, '');
  return out;
}

async function pickProfile(): Promise<void> {
  const id = docs.getActiveId();
  const doc = id === null ? undefined : docs.get(id);
  if (!doc) return;

  const all = profiles.list();
  const entries = pickerEntries(all, (profileId) => profiles.profile(profileId).name);
  const items: QuickPickItem<string>[] = entries.map((entry) => ({
    // Profile names are data, not UI strings (contrib README rule 3).
    label: entry.label,
    description: entry.id === doc.profileId ? '✓' : undefined,
    detail: t('profiles.extensions', {
      list: (profiles.get(entry.id)?.extensions ?? []).map((e) => `.${e}`).join(', '),
    }),
    value: entry.id,
  }));
  const picked = await modals.quickPick(items, {
    placeholder: t('profiles.placeholder'),
    initialIndex: Math.max(
      0,
      entries.findIndex((entry) => entry.id === doc.profileId),
    ),
  });
  if (picked === undefined || picked === doc.profileId) return;
  files.setProfile(doc.id, picked);
  // AD-22: a dialect picked by hand is remembered for the file and wins over detection
  // the next time it is opened (M7). It is recorded **here** and not in
  // `files.setProfile`, because only this path is a decision the user made — the same
  // call also carries a detection result and a restored session, and remembering either
  // of those would turn a guess into a setting.
  if (doc.path !== null) fileMemory.remember(doc.path, { profileId: picked });
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
