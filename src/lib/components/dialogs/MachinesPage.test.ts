// Settings ▸ Machines (plan §5 WP6.10, §7.12, §7.15, AD-31 "Management").
//
// The page's actions are pure functions over a `MachinesDeps`, so they are tested against
// a **fake `MachineService`**: what matters is which call each button makes, what it
// refuses, and what it says — not how a store publishes it.
//
// The one rule with teeth is the error state: while `machines.json` could not be read,
// every write is refused and only "Open machines file" and "Replace with an empty file"
// are offered, so a broken hand edit is never overwritten behind the user's back.
//
// The markup is rendered with `svelte/server` (no DOM), which is where the `machine-row`
// and `machine-action` test ids of §7.12 are checked.

import { render } from 'svelte/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocId, NewDocMeta } from '$lib/app/types';
import type { EffectiveProfile, MachineConfig, MachineProblem } from '$lib/core/machines/types';

const LATHE_2: MachineConfig = {
  id: 'lathe-2',
  name: 'Lathe 2',
  profile: 'fanuc-lathe',
  params: { variants: { gcodeSystem: 'B' }, units: 'mm', diameter: 'on' },
};
const MILL_1: MachineConfig = { id: 'mill-1', name: 'Mill 1', profile: 'fanuc-gcode', params: {} };

const fake = vi.hoisted(() => {
  const subscribers = new Set<(value: unknown) => void>();
  let list: unknown[] = [];
  return {
    setList(next: unknown[]): void {
      list = next;
      for (const run of subscribers) run(next);
    },
    getList: (): unknown[] => list,
    listStore: {
      subscribe(run: (value: unknown) => void) {
        subscribers.add(run);
        run(list);
        return (): void => void subscribers.delete(run);
      },
    },
    blocked: { value: false },
    problems: { value: [] as MachineProblem[] },
    defaults: { value: {} as Record<string, string> },
    add: vi.fn(async (_machine: unknown): Promise<string> => 'new-id'),
    update: vi.fn(async (): Promise<void> => {}),
    duplicate: vi.fn(async (): Promise<string> => 'copy-id'),
    remove: vi.fn(async (): Promise<void> => {}),
    setDefault: vi.fn(async (): Promise<void> => {}),
    openFile: vi.fn(async (): Promise<void> => {}),
    replaceWithEmpty: vi.fn(async (): Promise<void> => {}),
    confirm: vi.fn(async (_o: unknown): Promise<boolean> => true),
    shown: [] as { text: string; error: boolean }[],
  };
});

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean }) =>
      fake.shown.push({ text, error: o?.error === true }),
  },
}));

vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    confirm: (o: unknown) => fake.confirm(o),
    exclusive: async (op: () => Promise<unknown>) => op(),
  },
}));

vi.mock('$lib/stores/machines', async () => {
  const { writable } = await import('svelte/store');
  const { noMachine } = await import('$lib/core/machines/effective');
  const { profiles } = await import('$lib/stores/profiles');
  const { docs } = await import('$lib/stores/documents');
  return {
    machines: {
      list: fake.listStore,
      revision: writable(0),
      load: (): void => {},
      reloadFromDisk: async (): Promise<void> => {},
      isMachinesDocument: () => false,
      problems: () => fake.problems.value,
      blocked: () => fake.blocked.value,
      replaceWithEmpty: fake.replaceWithEmpty,
      get: (id: string) => (fake.getList() as MachineConfig[]).find((m) => m.id === id),
      compatibleWith: () => fake.getList() as MachineConfig[],
      defaultFor: (profileId: string) => fake.defaults.value[profileId] ?? null,
      add: fake.add,
      update: fake.update,
      duplicate: fake.duplicate,
      remove: fake.remove,
      setDefault: fake.setDefault,
      openFile: fake.openFile,
      effective: (id: DocId): EffectiveProfile =>
        ({
          machine: noMachine(profiles.profile(docs.get(id)?.profileId ?? 'fanuc-gcode')),
        }) as unknown as EffectiveProfile,
      setForDoc: (): void => {},
    },
  };
});

const MachinesPage = (await import('./MachinesPage.svelte')).default;
const {
  FIELD_PROFILE,
  addDraft,
  codeDbFor,
  draftErrors,
  duplicateDraft,
  editDraft,
  fieldsFor,
  fileProblems,
  openMachinesFile,
  profileChoices,
  profileField,
  removeRow,
  replaceMachinesFile,
  rowsOf,
  submitDraft,
  toggleDefault,
  usersOf,
} = await import('./MachinesPage.svelte');
const { machines } = await import('$lib/stores/machines');
const { codes } = await import('$lib/stores/codes');
const { profiles } = await import('$lib/stores/profiles');
const { docs } = await import('$lib/stores/documents');
const { dialogs } = await import('$lib/app/dialogs');
const { status } = await import('$lib/app/status');
const { t } = await import('$lib/i18n');
const {
  FIELD_DIAMETER,
  FIELD_NAME,
  FIELD_NOTES,
  FIELD_NUMBER_INPUT,
  FIELD_UNITS,
  modalFieldId,
  variantFieldId,
} = await import('$lib/core/machines/fields');
const { initialValues } = await import('$lib/core/forms/values');

const deps = { machines, profiles, codes, docs, dialogs, status, t };

const page = (): string => render(MachinesPage).body;

/** The `data-action`s the page offers, with `!` on the ones it disabled. */
function actions(html: string): string[] {
  return [...html.matchAll(/data-action="([a-z-]+)"[^>]*data-disabled="([01])"/g)].map(
    ([, action, disabled]) => (disabled === '1' ? `${action}!` : action),
  );
}

function addDoc(profileId: string, machineId?: string | null): DocId {
  const meta: NewDocMeta = {
    path: `/nc/${profileId}.nc`,
    untitledIndex: null,
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
  if (machineId !== undefined) docs.update(id, { machineId });
  return id;
}

beforeEach(() => {
  fake.setList([]);
  fake.blocked.value = false;
  fake.problems.value = [];
  fake.defaults.value = {};
  fake.shown.length = 0;
  fake.confirm.mockClear().mockResolvedValue(true);
  for (const spy of [
    fake.add,
    fake.update,
    fake.duplicate,
    fake.remove,
    fake.setDefault,
    fake.openFile,
    fake.replaceWithEmpty,
  ]) {
    spy.mockClear();
  }
});

afterEach(() => {
  for (const doc of docs.all()) docs.remove(doc.id);
});

describe('the list', () => {
  it('says what "no machine" means instead of showing an empty box', () => {
    const html = page();
    expect(html).toContain('data-testid="settings-machines"');
    expect(html).toContain(t('machines.page.empty'));
    expect(actions(html)).toEqual(['add', 'open-file']);
  });

  it('shows one row per machine with its dialect and its default marker', () => {
    fake.setList([LATHE_2, MILL_1]);
    fake.defaults.value = { 'fanuc-lathe': 'lathe-2' };
    const rows = rowsOf([LATHE_2, MILL_1], deps);
    expect(rows.map((row) => [row.id, row.profileName, row.isDefault])).toEqual([
      // `ProfileInfo.name` is the dialect's own display name, the one the dialect picker
      // shows as well (P1 §7.2).
      ['lathe-2', 'Fanuc lathe G-Code', true],
      ['mill-1', 'Fanuc G-Code', false],
    ]);
    const html = page();
    expect(html).toContain('data-machine-id="lathe-2"');
    expect(html).toContain('data-profile-id="fanuc-lathe"');
    expect(html).toContain('data-default="1"');
    expect(html).toContain('Lathe 2');
    expect(actions(html)).toEqual([
      'edit',
      'duplicate',
      'default',
      'remove',
      'edit',
      'duplicate',
      'default',
      'remove',
      'add',
      'open-file',
    ]);
  });

  it('keeps a record it could not read as a row of its own, with its problems', () => {
    fake.problems.value = [
      { machineId: 'broken', path: 'machines[2].params.units', message: 'unknown value "metric"' },
      { machineId: 'broken', path: 'machines[2].name', message: 'is empty' },
      { machineId: null, path: '$version', message: 'is newer than this build' },
    ];
    const rows = rowsOf([LATHE_2], deps);
    expect(rows.map((row) => [row.id, row.usable, row.problems.length])).toEqual([
      ['lathe-2', true, 0],
      ['broken', false, 2],
    ]);
    // A problem about the file itself is not a machine's problem.
    expect(fileProblems(deps)).toEqual([
      t('machines.page.problem', { path: '$version', message: 'is newer than this build' }),
    ]);

    fake.setList([LATHE_2]);
    const html = page();
    expect(html).toContain('data-problems="2"');
    expect(html).toContain('is newer than this build');
    // A record gEdit cannot read is not editable here; the file is the way to fix it.
    expect(actions(html)).toEqual([
      'edit',
      'duplicate',
      'default',
      'remove',
      'edit!',
      'duplicate!',
      'default!',
      'remove!',
      'add',
      'open-file',
    ]);
  });
});

describe('while the machines file could not be read', () => {
  beforeEach(() => {
    fake.blocked.value = true;
  });

  it('disables every write and offers the two ways out (AD-31)', () => {
    const html = page();
    expect(html).toContain(t('machines.page.blocked'));
    expect(actions(html)).toEqual(['add!', 'open-file', 'replace-file']);
  });

  it('refuses a save, a remove and a default, and writes nothing', async () => {
    const draft = addDraft('fanuc-lathe', deps);
    expect(await submitDraft({ ...draft, values: { ...draft.values, name: 'Lathe 2' } }, deps)).toBe(false);
    expect(await removeRow(rowsOf([LATHE_2], deps)[0], deps)).toBe(false);
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.add).not.toHaveBeenCalled();
    expect(fake.remove).not.toHaveBeenCalled();
    expect(fake.setDefault).not.toHaveBeenCalled();
    expect(fake.confirm).not.toHaveBeenCalled();
    expect(fake.shown.map((entry) => entry.text)).toEqual([
      t('machines.page.blockedAction'),
      t('machines.page.blockedAction'),
      t('machines.page.blockedAction'),
    ]);
  });

  it('still opens the file and still replaces it', async () => {
    await openMachinesFile(deps);
    expect(fake.openFile).toHaveBeenCalledTimes(1);
    expect(await replaceMachinesFile(deps)).toBe(true);
    expect(fake.replaceWithEmpty).toHaveBeenCalledTimes(1);
    expect(fake.shown.at(-1)?.text).toBe(t('machines.page.replaced'));
  });

  it('replaces nothing when the confirmation is declined', async () => {
    fake.confirm.mockResolvedValueOnce(false);
    expect(await replaceMachinesFile(deps)).toBe(false);
    expect(fake.replaceWithEmpty).not.toHaveBeenCalled();
  });
});

describe('Add', () => {
  it('offers exactly the dialects that declare machine parameters', () => {
    const choices = profileChoices(deps);
    expect(choices.map((choice) => choice.value)).toEqual(['fanuc-gcode', 'fanuc-lathe']);
    const field = profileField(deps)[0];
    expect(field.id).toBe(FIELD_PROFILE);
    expect(field.type).toBe('choice');
    expect(field.required).toBe(true);
  });

  it('builds the parameter form of the dialect that was picked', () => {
    const draft = addDraft('fanuc-lathe', deps);
    const ids = fieldsFor(draft, deps).map((field) => field.id);
    expect(ids).toEqual([
      FIELD_NAME,
      FIELD_NUMBER_INPUT,
      FIELD_UNITS,
      FIELD_DIAMETER,
      variantFieldId('gcodeSystem'),
      modalFieldId('feedmode'),
      modalFieldId('spindlemode'),
      modalFieldId('plane'),
      FIELD_NOTES,
    ]);
    // The mill has no diameter parameter and no variant.
    const mill = fieldsFor(addDraft('fanuc-gcode', deps), deps).map((field) => field.id);
    expect(mill).not.toContain(FIELD_DIAMETER);
    expect(mill).not.toContain(variantFieldId('gcodeSystem'));
  });

  it('saves what the form holds, under the dialect it was built for', async () => {
    const draft = addDraft('fanuc-lathe', deps);
    const values = { ...draft.values, [FIELD_NAME]: ' Lathe 2 ', [FIELD_NOTES]: 'turret 1' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(true);
    expect(fake.add).toHaveBeenCalledTimes(1);
    const saved = fake.add.mock.calls[0][0] as unknown as MachineConfig;
    expect(saved.name).toBe('Lathe 2');
    expect(saved.profile).toBe('fanuc-lathe');
    expect(saved.notes).toBe('turret 1');
    // The preset's whole rule set is stored, not its id (§7.15).
    expect(saved.params.numberInput).toMatchObject({ mode: expect.any(String) });
    expect(saved.params.variants).toEqual({ gcodeSystem: 'A' });
    expect(fake.shown.at(-1)?.text).toBe(t('machines.page.added', { name: 'Lathe 2' }));
  });

  it('keeps the form open and says why when the file cannot be written', async () => {
    fake.add.mockRejectedValueOnce(new Error('disk full'));
    const draft = addDraft('fanuc-lathe', deps);
    const values = { ...draft.values, [FIELD_NAME]: 'Lathe 2' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(false);
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.page.saveFailed'), error: true });
  });
});

describe('Edit', () => {
  it('starts from what the record holds', () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    expect(draft.kind).toBe('edit');
    expect(draft.values[FIELD_NAME]).toBe('Lathe 2');
    expect(draft.values[variantFieldId('gcodeSystem')]).toBe('B');
    expect(draft.values[FIELD_DIAMETER]).toBe(true);
  });

  it('sends only the record’s own members to the service', async () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    const values = { ...draft.values, [FIELD_NAME]: 'Lathe 2a' };
    expect(await submitDraft({ ...draft, values }, deps)).toBe(true);
    expect(fake.update).toHaveBeenCalledWith('lathe-2', {
      name: 'Lathe 2a',
      params: expect.objectContaining({ variants: { gcodeSystem: 'B' }, diameter: 'on' }),
      notes: '',
    });
  });

  it('re-offers the power-on codes of the G-code system the form now names', () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    const inB = fieldsFor(draft, deps).find((field) => field.id === modalFieldId('feedmode'));
    const inA = fieldsFor(
      { ...draft, values: { ...draft.values, [variantFieldId('gcodeSystem')]: 'A' } },
      deps,
    ).find((field) => field.id === modalFieldId('feedmode'));
    expect(inB?.choices?.map((choice) => choice.value)).toContain('G95');
    expect(inB?.choices?.map((choice) => choice.value)).not.toContain('G99');
    expect(inA?.choices?.map((choice) => choice.value)).toContain('G99');
  });

  it('reads the power-on codes out of the database the chosen variant names', () => {
    expect(codeDbFor('fanuc-lathe', { variants: { gcodeSystem: 'B' } }, deps).dialect).toBe(
      'fanuc-lathe-b',
    );
    expect(codeDbFor('fanuc-lathe', { variants: { gcodeSystem: 'A' } }, deps).dialect).toBe(
      'fanuc-lathe',
    );
    // Nothing chosen: the variant's own default decides, as `applyMachine` does.
    expect(codeDbFor('fanuc-lathe', undefined, deps).dialect).toBe('fanuc-lathe');
    expect(codeDbFor('fanuc-gcode', undefined, deps).dialect).toBe('fanuc');
  });
});

describe('a name', () => {
  const lathe = () => addDraft('fanuc-lathe', deps);

  it('is required, and the form says so before anything is written', () => {
    const draft = lathe();
    expect(draftErrors(fieldsFor(draft, deps), draft, [])[FIELD_NAME]).toEqual({
      key: 'forms.errors.required',
    });
  });

  it('may not be another machine’s, ignoring case', () => {
    const draft = { ...lathe(), values: { ...lathe().values, [FIELD_NAME]: 'lathe 2' } };
    expect(draftErrors(fieldsFor(draft, deps), draft, [LATHE_2])[FIELD_NAME]).toEqual({
      key: 'machines.page.nameTaken',
    });
  });

  it('may stay its own while the record is edited', () => {
    fake.setList([LATHE_2]);
    const draft = editDraft(LATHE_2, deps);
    expect(draftErrors(fieldsFor(draft, deps), draft, [LATHE_2])[FIELD_NAME]).toBeUndefined();
  });

  it('may not be longer than the file allows', () => {
    const draft = { ...lathe(), values: { ...lathe().values, [FIELD_NAME]: 'x'.repeat(65) } };
    expect(draftErrors(fieldsFor(draft, deps), draft, [])[FIELD_NAME]).toEqual({
      key: 'machines.page.nameLong',
    });
  });
});

describe('Duplicate', () => {
  it('asks for one thing, the new name, and proposes one', () => {
    const draft = duplicateDraft(LATHE_2, deps);
    const fields = fieldsFor(draft, deps);
    expect(fields.map((field) => field.id)).toEqual([FIELD_NAME]);
    expect(draft.values[FIELD_NAME]).toBe(t('machines.page.duplicateName', { name: 'Lathe 2' }));
  });

  it('copies the record through the service, so everything in it comes along', async () => {
    const draft = duplicateDraft(LATHE_2, deps);
    expect(await submitDraft(draft, deps)).toBe(true);
    expect(fake.duplicate).toHaveBeenCalledWith('lathe-2', 'Lathe 2 copy');
    expect(fake.add).not.toHaveBeenCalled();
  });
});

describe('Remove', () => {
  it('names the open documents that use the machine before it goes', async () => {
    fake.setList([LATHE_2]);
    addDoc('fanuc-lathe', 'lathe-2');
    addDoc('fanuc-lathe', 'lathe-2');
    addDoc('fanuc-lathe', null);
    expect(usersOf('lathe-2', deps)).toBe(2);
    expect(await removeRow(rowsOf([LATHE_2], deps)[0], deps)).toBe(true);
    expect((fake.confirm.mock.calls[0][0] as unknown as { title: string }).title).toBe(
      t('machines.page.removeInUse', { name: 'Lathe 2', count: 2 }),
    );
    expect(fake.remove).toHaveBeenCalledWith('lathe-2');
    expect(fake.shown.at(-1)?.text).toBe(t('machines.page.removed', { name: 'Lathe 2' }));
  });

  it('asks plainly when no open document uses it, and removes nothing on a No', async () => {
    fake.setList([LATHE_2]);
    fake.confirm.mockResolvedValueOnce(false);
    expect(await removeRow(rowsOf([LATHE_2], deps)[0], deps)).toBe(false);
    expect((fake.confirm.mock.calls[0][0] as unknown as { title: string }).title).toBe(
      t('machines.page.removeTitle', { name: 'Lathe 2' }),
    );
    expect(fake.remove).not.toHaveBeenCalled();
  });
});

describe('Default for its dialect', () => {
  it('sets the default, and the same button takes it away again', async () => {
    fake.setList([LATHE_2]);
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.setDefault).toHaveBeenCalledWith('fanuc-lathe', 'lathe-2');

    fake.defaults.value = { 'fanuc-lathe': 'lathe-2' };
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.setDefault).toHaveBeenLastCalledWith('fanuc-lathe', null);
    expect(fake.shown.at(-1)?.text).toBe(
      t('machines.page.defaultCleared', { profile: 'Fanuc lathe G-Code' }),
    );
  });

  it('reports a refused write instead of pretending it worked', async () => {
    fake.setList([LATHE_2]);
    fake.setDefault.mockRejectedValueOnce(new Error('read-only volume'));
    await toggleDefault(rowsOf([LATHE_2], deps)[0], deps);
    expect(fake.shown.at(-1)).toEqual({ text: t('machines.page.saveFailed'), error: true });
  });
});

describe('the form values a draft starts from', () => {
  it('are the fields’ own defaults, which is what the renderer seeds itself with', () => {
    const draft = addDraft('fanuc-lathe', deps);
    expect(draft.values).toEqual(initialValues(fieldsFor(draft, deps)));
  });
});
