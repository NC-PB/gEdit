// What the machine contribution declares, what its picker does, and what the status item
// shows (plan §5 WP6.10, §7.12, §7.13, AD-31).
//
// The command ids are contracts: §7.13 gives `file.setMachine`, `machines.manage` and
// `machines.openFile`, none of them with a default shortcut, and the runtime scenarios
// call them by name.
//
// `activate()` re-reads `machines.json` when the *machines document* is saved — the same
// guard `contrib/settings.ts` has for `settings.json`, and the reason a hand edit is never
// overwritten by the next action of the Machines page (AD-31). The document store is the
// real one, so the path comparison really is `docs.byPath`.
//
// The status item is rendered with `svelte/server`: no DOM, no `$effect`, and what a
// scenario reads (`data-item`, `data-machine-id`, `data-choice`, `data-assumed`) is in the
// markup.

import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocId, NewDocMeta, QuickPickItem } from '$lib/app/types';
import type { EffectiveProfile, MachineConfig } from '$lib/core/machines/types';

const MACHINES_FILE = '/home/u/Library/Application Support/com.pburg.gedit/machines.json';

const LATHE_2: MachineConfig = {
  id: 'lathe-2',
  name: 'Lathe 2',
  profile: 'fanuc-lathe',
  params: { variants: { gcodeSystem: 'B' }, units: 'inch' },
};
const MILL_1: MachineConfig = { id: 'mill-1', name: 'Mill 1', profile: 'fanuc-gcode', params: {} };

const fake = vi.hoisted(() => {
  const subscribers = new Set<(value: unknown) => void>();
  let list: unknown[] = [];
  return {
    /** Every record the file gave, broken ones included — that is what `list` publishes. */
    setList(next: unknown[]): void {
      list = next;
      for (const run of subscribers) run(next);
    },
    getList: (): unknown[] => list,
    /** Ids the base profile did **not** understand: in `list`, out of `compatibleWith`. */
    unusable: new Set<string>(),
    listStore: {
      subscribe(run: (value: unknown) => void) {
        subscribers.add(run);
        run(list);
        return (): void => void subscribers.delete(run);
      },
    },
    /** The machine `effective()` answers with; null is "no machine". */
    chosen: { value: null as unknown },
    choice: { value: 'none' as 'document' | 'default' | 'none' },
    defaultId: { value: null as string | null },
    reloadFromDisk: vi.fn(async (): Promise<void> => {}),
    openFile: vi.fn(async (): Promise<void> => {}),
    setForDoc: vi.fn((): void => {}),
    setProfile: vi.fn((): void => {}),
    disposeSave: vi.fn((): void => {}),
    shown: [] as { text: string; error: boolean }[],
    opened: [] as unknown[],
    openedWith: [] as unknown[],
    /** Every quick pick that was raised, and what the next one answers. */
    picks: [] as unknown[][],
    answers: [] as unknown[],
    saved: null as ((id: string, path: string) => void) | null,
    save(id: string, path: string): void {
      this.saved?.(id, path);
    },
  };
});

vi.mock('$lib/app/fileOps', () => ({
  files: {
    onDidSave: (cb: (id: string, path: string) => void) => {
      fake.saved = cb;
      return fake.disposeSave;
    },
    setProfile: (...args: unknown[]) => fake.setProfile(...(args as [])),
  },
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    quickPick: async (items: QuickPickItem<unknown>[]): Promise<unknown> => {
      fake.picks.push(items);
      return fake.answers.shift();
    },
    open: async (component: unknown, props?: unknown): Promise<undefined> => {
      fake.opened.push(component);
      fake.openedWith.push(props);
      return undefined;
    },
  },
}));

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean }) => fake.shown.push({ text, error: o?.error === true }),
  },
}));

vi.mock('$lib/stores/machines', async () => {
  const { effectiveMachine } = await import('$lib/core/machines/effective');
  const { profiles } = await import('$lib/stores/profiles');
  const { docs } = await import('$lib/stores/documents');
  return {
    machines: {
      list: fake.listStore,
      revision: writable(0),
      load: (): void => {},
      reloadFromDisk: fake.reloadFromDisk,
      isMachinesDocument: (id: DocId) => docs.byPath(MACHINES_FILE)?.id === id,
      problems: () => [],
      blocked: () => false,
      replaceWithEmpty: async (): Promise<void> => {},
      get: (id: string) => (fake.getList() as MachineConfig[]).find((m) => m.id === id),
      compatibleWith: (profileId: string) => {
        const chain = profiles.get(profileId)?.chain ?? [];
        return (fake.getList() as MachineConfig[]).filter(
          (m) => chain.includes(m.profile) && !fake.unusable.has(m.id),
        );
      },
      defaultFor: () => fake.defaultId.value,
      add: async (): Promise<string> => 'x',
      update: async (): Promise<void> => {},
      duplicate: async (): Promise<string> => 'x',
      remove: async (): Promise<void> => {},
      setDefault: async (): Promise<void> => {},
      openFile: fake.openFile,
      effective: (id: DocId): EffectiveProfile => {
        const profileId = docs.get(id)?.profileId ?? 'fanuc-gcode';
        const profile = profiles.profile(profileId);
        return {
          machine: effectiveMachine(
            profile,
            fake.chosen.value as MachineConfig | null,
            fake.choice.value,
            {},
          ),
        } as unknown as EffectiveProfile;
      },
      setForDoc: (...args: unknown[]) => fake.setForDoc(...(args as [])),
    },
  };
});

const contrib = (await import('./machineSelect')).default;
const { pickItems } = await import('./machineSelect');
const MachineStatus = (await import('$lib/components/status/MachineStatus.svelte')).default;
const SettingsDialog = (await import('$lib/components/dialogs/SettingsDialog.svelte')).default;
const { docs } = await import('$lib/stores/documents');
const { hasKey, t } = await import('$lib/i18n');

function addDoc(path: string | null, profileId = 'fanuc-lathe'): DocId {
  const meta: NewDocMeta = {
    path,
    untitledIndex: path === null ? 1 : null,
    profileId,
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
  };
  const id = docs.add(meta);
  docs.activate(id);
  return id;
}

const item = (): string => render(MachineStatus).body;

beforeEach(() => {
  fake.setList([]);
  fake.chosen.value = null;
  fake.choice.value = 'none';
  fake.defaultId.value = null;
  fake.shown.length = 0;
  fake.opened.length = 0;
  fake.openedWith.length = 0;
  fake.picks.length = 0;
  fake.answers.length = 0;
  fake.reloadFromDisk.mockClear();
  fake.openFile.mockClear();
  fake.setForDoc.mockClear();
  fake.setProfile.mockClear();
  fake.disposeSave.mockClear();
});

afterEach(() => {
  for (const doc of docs.all()) docs.remove(doc.id);
});

describe('what it declares', () => {
  it('registers §7.13’s three commands and claims no shortcut', () => {
    expect(contrib.commands.map((c) => c.id)).toEqual([
      'file.setMachine',
      'machines.manage',
      'machines.openFile',
    ]);
    for (const command of contrib.commands) {
      expect(command).not.toHaveProperty('keys');
      expect(command.global).toBe(true);
    }
  });

  it('has an id that matches its file name, and every title has a message', () => {
    expect(contrib.id).toBe('machineSelect');
    const keys = contrib.commands.flatMap((c) => [c.title, c.category]);
    expect(keys.filter((key): key is string => typeof key === 'string').filter((key) => !hasKey(key))).toEqual([]);
  });

  it('puts the machine item next to the dialect item, before the encoding items', () => {
    expect(contrib.statusItems).toEqual([
      { id: 'machine', side: 'right', order: 15, component: MachineStatus },
    ]);
  });

  it('offers the picker only while a document is open', () => {
    const setMachine = contrib.commands[0];
    expect(setMachine.enabled?.({ activeDocId: null } as never)).toBe(false);
    expect(setMachine.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
  });
});

describe('the machines file as a document', () => {
  it('re-reads the machines when that document is saved', () => {
    const dispose = contrib.activate();
    const id = addDoc(MACHINES_FILE);
    fake.save(id, MACHINES_FILE);
    expect(fake.reloadFromDisk).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('ignores the save of any other document', () => {
    const dispose = contrib.activate();
    addDoc(MACHINES_FILE);
    const other = addDoc('/nc/prog.nc');
    fake.save(other, '/nc/prog.nc');
    expect(fake.reloadFromDisk).not.toHaveBeenCalled();
    dispose();
  });

  it('hands back the disposer of the listener it installed', () => {
    contrib.activate()();
    expect(fake.disposeSave).toHaveBeenCalledTimes(1);
  });

  it('reports a failed reload while the file is still open, instead of throwing', async () => {
    fake.reloadFromDisk.mockRejectedValueOnce(new Error('machines.json is not JSON'));
    const dispose = contrib.activate();
    const id = addDoc(MACHINES_FILE);
    fake.save(id, MACHINES_FILE);
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.reloadFailed'), error: true });
    dispose();
  });
});

describe('the entries of the picker', () => {
  it('starts with None, lists the compatible machines and ends with the two ways out', () => {
    const items = pickItems([LATHE_2], null, null, true);
    expect(items.map((entry) => entry.label)).toEqual([
      t('machines.pick.none'),
      'Lathe 2',
      t('machines.pick.other'),
      t('machines.pick.manage'),
    ]);
    // Nothing chosen: the tick is on None.
    expect(items[0].description).toBe(t('machines.pick.current'));
  });

  it('ticks the machine in effect and marks the dialect’s default', () => {
    const items = pickItems([LATHE_2], 'lathe-2', 'lathe-2', false);
    expect(items[0].description).toBeUndefined();
    expect(items[1].description).toBe(t('machines.pick.current'));
    expect(items[1].detail).toBe(t('machines.pick.default'));
    // No machines of another dialect: no "Other machines…" entry.
    expect(items.map((entry) => entry.label)).not.toContain(t('machines.pick.other'));
  });
});

describe('picking a machine', () => {
  it('sets it on the document and says so', async () => {
    fake.setList([LATHE_2]);
    const id = addDoc('/nc/part.nc');
    fake.answers.push({ kind: 'machine', id: 'lathe-2' });
    await contrib.commands[0].run();
    expect(fake.setForDoc).toHaveBeenCalledWith(id, 'lathe-2');
    expect(fake.shown.at(-1)?.text).toContain('Lathe 2');
  });

  it('records an explicit "none"', async () => {
    fake.setList([LATHE_2]);
    fake.chosen.value = LATHE_2;
    fake.choice.value = 'document';
    const id = addDoc('/nc/part.nc');
    fake.answers.push({ kind: 'none' });
    await contrib.commands[0].run();
    expect(fake.setForDoc).toHaveBeenCalledWith(id, null);
    expect(fake.shown.at(-1)?.text).toBe(t('machines.changedNone', { name: 'part.nc' }));
  });

  it('switches the dialect too when the machine belongs to another one', async () => {
    fake.setList([LATHE_2, MILL_1]);
    // A mill document: the lathe machine is the one that does not fit (its base profile is
    // not in the document's chain), while a mill machine fits a lathe document, because
    // `fanuc-lathe` extends `fanuc-gcode` (AD-31 compatibility).
    const id = addDoc('/nc/part.nc', 'fanuc-gcode');
    fake.answers.push({ kind: 'other' }, 'lathe-2');
    await contrib.commands[0].run();
    expect(fake.setProfile).toHaveBeenCalledWith(id, 'fanuc-lathe');
    expect(fake.setForDoc).toHaveBeenCalledWith(id, 'lathe-2');
    expect(fake.shown.at(-1)?.text).toContain('Lathe 2');
    // The second pick only offered the machines that do not fit this document.
    expect(fake.picks[1].map((entry) => (entry as QuickPickItem<string>).value)).toEqual(['lathe-2']);
  });

  it('offers no way to the other machines when every machine already fits', async () => {
    fake.setList([MILL_1]);
    addDoc('/nc/part.nc');
    await contrib.commands[0].run();
    expect((fake.picks[0] as QuickPickItem<unknown>[]).map((entry) => entry.label)).not.toContain(
      t('machines.pick.other'),
    );
  });

  it('never offers a record its own dialect refused', async () => {
    // G8 M6. `list` publishes every record the file gave, broken ones included, because
    // the Machines page has to show them; `compatibleWith` publishes the ones a profile
    // understood. "Other machines…" was the difference between the two, so a broken
    // record of the document's **own** dialect landed in the list of the other dialects —
    // picking it switched the document's dialect and reported success, and the service
    // then refused the machine and contradicted the message. §7.15: never silently
    // selectable.
    const broken: MachineConfig = {
      id: 'lathe-c',
      name: 'Lathe C',
      profile: 'fanuc-lathe',
      params: { variants: { gcodeSystem: 'C' } },
    };
    fake.setList([LATHE_2, broken]);
    fake.unusable.add('lathe-c');
    addDoc('/nc/part.nc', 'fanuc-lathe');
    await contrib.commands[0].run();
    const labels = (fake.picks[0] as QuickPickItem<unknown>[]).map((entry) => entry.label);
    expect(labels).toContain('Lathe 2');
    expect(labels).not.toContain('Lathe C');
    expect(labels).not.toContain(t('machines.pick.other'));
    expect(fake.setProfile).not.toHaveBeenCalled();
    fake.unusable.clear();
  });

  it('says so instead of picking anything for a dialect with no machine parameters', async () => {
    addDoc('/nc/part.h', 'heidenhain-klartext');
    await contrib.commands[0].run();
    expect(fake.picks).toHaveLength(0);
    expect(fake.shown.at(-1)?.text).toBe(
      t('machines.noParams', { profile: 'Heidenhain Klartext' }),
    );
  });

  it('changes nothing when the pick is dismissed', async () => {
    fake.setList([LATHE_2]);
    addDoc('/nc/part.nc');
    await contrib.commands[0].run();
    expect(fake.setForDoc).not.toHaveBeenCalled();
    expect(fake.shown).toEqual([]);
  });

  it('opens the settings dialog when the user asks to manage the machines', async () => {
    addDoc('/nc/part.nc');
    fake.answers.push({ kind: 'manage' });
    await contrib.commands[0].run();
    expect(fake.opened).toEqual([SettingsDialog]);
  });
});

describe('the management commands', () => {
  it('opens the settings dialog', async () => {
    await contrib.commands[1].run();
    expect(fake.opened).toEqual([SettingsDialog]);
  });

  it('asks the service for the machines file, and reports a refusal', async () => {
    await contrib.commands[2].run();
    expect(fake.openFile).toHaveBeenCalledTimes(1);
    fake.openFile.mockRejectedValueOnce(new Error('no permission'));
    await contrib.commands[2].run();
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.openFileFailed'), error: true });
  });

  it('opens the dialog on the Machines tab, not on the first page', async () => {
    // I6 replaced WP6.10's tab press with a prop, so the tab is part of the request and
    // there is nothing to poll for.
    await contrib.commands[1].run();
    expect(fake.openedWith.at(-1)).toEqual({ initialTab: 'machines' });
  });
});

describe('the status item', () => {
  it('is not there at all for a dialect without machine parameters', () => {
    addDoc('/nc/part.h', 'heidenhain-klartext');
    expect(item()).not.toContain('data-item="machine"');
  });

  it('is not there while no document is open', () => {
    expect(item()).not.toContain('data-item="machine"');
  });

  it('says "none" and marks it assumed while no machine is chosen', () => {
    addDoc('/nc/part.nc');
    const html = item();
    expect(html).toContain('data-item="machine"');
    expect(html).toContain('data-machine-id=""');
    expect(html).toContain('data-choice="none"');
    expect(html).toContain('data-assumed="1"');
    expect(html).toContain('Machine: none');
    expect(html).toContain(t('machines.assumed'));
  });

  it('names the machine, carries its id and drops the assumed marker', () => {
    fake.setList([LATHE_2]);
    fake.chosen.value = LATHE_2;
    fake.choice.value = 'document';
    addDoc('/nc/part.nc');
    const html = item();
    expect(html).toContain('Machine: Lathe 2');
    expect(html).toContain('data-machine-id="lathe-2"');
    expect(html).toContain('data-choice="document"');
    expect(html).toContain('data-assumed="0"');
  });

  it('puts every effective parameter and its source in the tooltip', () => {
    fake.setList([LATHE_2]);
    fake.chosen.value = LATHE_2;
    fake.choice.value = 'default';
    addDoc('/nc/part.nc');
    const html = item();
    // `title` is HTML-escaped, so the em dash and the newlines are checked by their pieces.
    expect(html).toContain('G-code system B');
    expect(html).toContain(t('machines.source.machine'));
    expect(html).toContain(t('machines.source.profile'));
    expect(html).toContain(t('machines.tooltip.hint'));
  });
});
