// The machine configuration of a document: the status item, the picker and the two
// management commands (plan §5 WP6.10, §7.13, AD-31). One feature per file (plan AD-3);
// see ./README.md.
//
// It is the sibling of `contrib/profileSelect.ts`: the dialect says how a program is
// written, the machine says how the control reads it. The two are separate on purpose —
// how a written number is read, which G-code system applies and what is modal at power-on
// are properties of the machine, not of the dialect (AD-31, owner decisions D23/D24/D34).
//
// What `activate()` installs is the same guard `contrib/settings.ts` has for
// `settings.json`: saving the machines document re-reads it, so the next action of the
// Machines page writes over what is on disk and never over a stale copy in memory.
//
// Machine and dialect names are data and stay untranslated (README rule 3).

import MachineStatus from '$lib/components/status/MachineStatus.svelte';
import SettingsDialog, { MACHINES_TAB } from '$lib/components/dialogs/SettingsDialog.svelte';
import { files } from '$lib/app/fileOps';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { docs } from '$lib/stores/documents';
import { fileMemory } from '$lib/stores/fileMemory';
import { machines } from '$lib/stores/machines';
import { profiles } from '$lib/stores/profiles';
import { t } from '$lib/i18n';
import { get } from 'svelte/store';
import type { Contribution, DocId, Disposable, QuickPickItem } from '$lib/app/types';
import type { MachineConfig } from '$lib/core/machines/types';

/** What one entry of the picker stands for. */
export type MachinePick =
  | { kind: 'none' }
  | { kind: 'machine'; id: string }
  | { kind: 'other' }
  | { kind: 'manage' };

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- the picker -------------------------------------------------------------

/**
 * The entries of `file.setMachine`: "None", the machines that fit this document's dialect,
 * a way to the machines of the other dialects, and a way to the Machines page.
 *
 * `currentId` marks what is in effect right now — `null` marks "None", whether that is an
 * explicit choice or simply nothing chosen.
 */
export function pickItems(
  list: readonly MachineConfig[],
  currentId: string | null,
  defaultId: string | null,
  hasOthers: boolean,
): QuickPickItem<MachinePick>[] {
  const items: QuickPickItem<MachinePick>[] = [
    {
      label: t('machines.pick.none'),
      description: currentId === null ? t('machines.pick.current') : undefined,
      detail: t('machines.pick.noneDetail'),
      value: { kind: 'none' },
    },
  ];
  for (const machine of list) {
    items.push({
      // A machine's name is the user's own text.
      label: machine.name,
      description: machine.id === currentId ? t('machines.pick.current') : undefined,
      detail: machine.id === defaultId ? t('machines.pick.default') : undefined,
      value: { kind: 'machine', id: machine.id },
    });
  }
  if (hasOthers) {
    items.push({
      label: t('machines.pick.other'),
      detail: t('machines.pick.otherDetail'),
      value: { kind: 'other' },
    });
  }
  items.push({
    label: t('machines.pick.manage'),
    detail: t('machines.pick.manageDetail'),
    value: { kind: 'manage' },
  });
  return items;
}

/**
 * The machines that do **not** fit `profileId` and that the app could actually apply, in
 * the order the service lists them.
 *
 * `machines.list` publishes every record the **file** gave, broken ones included, because
 * the Machines page has to show them and offer to fix them. `compatibleWith` publishes
 * the ones a profile **understood**. Subtracting one from the other left the broken
 * records of the document's *own* dialect in the "machines of the other dialects" list:
 * picking one switched the document's dialect and said so, and then the service refused
 * the machine and contradicted the message it had just shown (G8 M6, §7.15 "never
 * silently selectable"). So a record is offered here only where its own profile accepts
 * it as well.
 */
function otherMachines(profileId: string): MachineConfig[] {
  const compatible = new Set(machines.compatibleWith(profileId).map((machine) => machine.id));
  return get(machines.list).filter(
    (machine) =>
      !compatible.has(machine.id) &&
      machines.compatibleWith(machine.profile).some((usable) => usable.id === machine.id),
  );
}

/**
 * Picking a machine of another dialect also switches the document to that dialect, so the
 * two choices can never contradict each other (AD-31 "Compatibility"). Both are recorded,
 * and the message names both.
 */
async function pickOther(docId: DocId, title: string, profileId: string): Promise<void> {
  const others = otherMachines(profileId);
  if (others.length === 0) {
    status.show(t('machines.pick.otherEmpty'));
    return;
  }
  const picked = await modals.quickPick(
    others.map((machine) => ({
      label: machine.name,
      detail: profiles.get(machine.profile)?.name ?? machine.profile,
      value: machine.id,
    })),
    { placeholder: t('machines.pick.otherPlaceholder') },
  );
  if (picked === undefined) return;
  const machine = machines.get(picked);
  if (!machine) return;
  files.setProfile(docId, machine.profile);
  // AD-22: picking a machine of another dialect changes the dialect too, and that is a
  // decision the user made by hand — so it is remembered for the file exactly as the
  // dialect picker's own choice is (`contrib/profileSelect.ts`). Without this line the
  // file comes back next time with a detected dialect and a machine that does not fit
  // it, and AD-31 drops the machine with a message (M7 integration, mergeA).
  const path = docs.get(docId)?.path ?? null;
  if (path !== null) fileMemory.remember(path, { profileId: machine.profile });
  machines.setForDoc(docId, machine.id);
  status.show(
    t('machines.changedProfile', {
      name: title,
      machine: machine.name,
      profile: profiles.get(machine.profile)?.shortName ?? machine.profile,
    }),
  );
}

async function pickMachine(): Promise<void> {
  const id = docs.getActiveId();
  const doc = id === null ? undefined : docs.get(id);
  if (!doc) return;
  const info = profiles.get(doc.profileId);
  if (info?.hasMachineParams !== true) {
    status.show(t('machines.noParams', { profile: info?.name ?? doc.profileId }));
    return;
  }

  const current = machines.effective(doc.id).machine;
  const list = machines.compatibleWith(doc.profileId);
  const items = pickItems(
    list,
    current.id,
    machines.defaultFor(doc.profileId),
    otherMachines(doc.profileId).length > 0,
  );
  const picked = await modals.quickPick(items, {
    placeholder: t('machines.pick.placeholder'),
    initialIndex: Math.max(
      0,
      items.findIndex((item) => item.description === t('machines.pick.current')),
    ),
  });
  if (picked === undefined) return;

  switch (picked.kind) {
    case 'none':
      machines.setForDoc(doc.id, null);
      status.show(t('machines.changedNone', { name: doc.title }));
      return;
    case 'machine': {
      if (picked.id === current.id) return;
      machines.setForDoc(doc.id, picked.id);
      status.show(
        t('machines.changed', { name: doc.title, machine: machines.get(picked.id)?.name ?? picked.id }),
      );
      return;
    }
    case 'other':
      await pickOther(doc.id, doc.title, doc.profileId);
      return;
    default:
      await openMachinesPage();
  }
}

// --- the management commands ------------------------------------------------

/**
 * "Manage machines" opens the settings dialog **on the Machines tab**. The dialog takes
 * the tab as a prop (I6), so the command says where it wants to be instead of reaching
 * into the dialog's DOM after it is on screen.
 */
async function openMachinesPage(): Promise<void> {
  await modals.open(SettingsDialog, { initialTab: MACHINES_TAB });
}

async function openMachinesFile(): Promise<void> {
  try {
    await machines.openFile();
  } catch (err) {
    status.show(t('machines.openFileFailed'), { error: true, detail: detailOf(err) });
  }
}

export default {
  id: 'machineSelect',
  commands: [
    {
      id: 'file.setMachine',
      title: 'machines.setMachine',
      category: 'machines.category',
      global: true,
      enabled: (c) => c.activeDocId !== null,
      run: () => pickMachine(),
    },
    {
      id: 'machines.manage',
      title: 'machines.manage',
      category: 'machines.category',
      global: true,
      run: () => openMachinesPage(),
    },
    {
      id: 'machines.openFile',
      title: 'machines.openFile',
      category: 'machines.category',
      global: true,
      run: () => openMachinesFile(),
    },
  ],
  // Next to the dialect item (10), before the encoding items (20): the two together say
  // how this document is read.
  statusItems: [{ id: 'machine', side: 'right', order: 15, component: MachineStatus }],
  activate(): Disposable {
    return files.onDidSave((id) => {
      if (!machines.isMachinesDocument(id)) return;
      void machines.reloadFromDisk().catch((err: unknown) => {
        // The file is open in front of the user, so the message belongs on screen while
        // they can still fix it.
        status.show(t('machines.reloadFailed'), { error: true, detail: detailOf(err) });
      });
    });
  },
} satisfies Contribution;
