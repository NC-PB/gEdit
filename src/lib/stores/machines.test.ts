// The machine service (plan §7.15, AD-31). Owner: WP6.8 (P6 wrote the stub this replaces).
//
// The cases that matter here are the ones where a wrong answer misreads a program:
//
//   - the selection order, including every way a chosen machine can go away;
//   - detection only without a machine, and a disagreement said once and acted on never;
//   - a write refused while the file could not be read;
//   - a hand edit of `machines.json` that survives the next click on the Machines page.
//
// The service is built over fakes (AD-2), but the profiles and the code databases are the
// real ones: a test that checked the selection order against an invented profile would not
// notice that the lathe's variant is called `gcodeSystem`.

import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { profiles } from './profiles';
import { codes } from './codes';
import { createMachineService, slugOf } from './machines';
import type { ConfigLoad } from '$lib/platform/commands';
import type { DocId, MachineService } from '$lib/app/types';
import type { EffectiveMachine } from '$lib/core/machines/types';

const FILES = fileURLToPath(new URL('../../../tests/fixtures/machines/files/', import.meta.url));

function sample(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${FILES}${name}.json`, 'utf8')) as Record<string, unknown>;
}

const PATHS: ConfigLoad['paths'] = {
  configDir: '/cfg',
  dataDir: '/data',
  settingsFile: '/cfg/settings.json',
  stateFile: '/data/state.json',
  userScriptsDir: '/cfg/scripts',
  machinesFile: '/cfg/machines.json',
};

interface FakeDoc {
  id: DocId;
  profileId: string;
  machineId?: string | null;
  path?: string;
  text?: string;
  /** Monaco's version id in the real service; any number that moves with the text. */
  version?: number;
}

interface Harness {
  machines: MachineService;
  /** Every payload `machines_save` was given, newest last. */
  saved: Record<string, unknown>[];
  /** Every status message the service showed. */
  notes: string[];
  /** What `config_load` would answer now. */
  disk: Record<string, unknown>;
  /** Replaces the file on disk without telling the service, as a hand edit does. */
  handEdit(file: Record<string, unknown>): void;
  setProfile(id: DocId, profileId: string): void;
  /** Replaces a document's text, as a paste or a revert does; the version moves with it. */
  setText(id: DocId, text: string): void;
  detect: Record<string, Record<string, { value: string; margin: number }>>;
  failNextSave: (reason: string | null) => void;
  /** Every `remember` call, in order: what M7's per-file memory was told (WP7.5). */
  remembered: { path: string; machineId: string | null | undefined }[];
  /** The memo table those calls build up, so "is it still remembered" reads as one line. */
  memory: Record<string, string | null>;
}

function harness(o: { docs?: FakeDoc[]; file?: Record<string, unknown>; machinesError?: string } = {}): Harness {
  const list = new Map<DocId, FakeDoc>((o.docs ?? []).map((doc) => [doc.id, { ...doc }]));
  const state: Harness = {
    machines: undefined as unknown as MachineService,
    saved: [],
    notes: [],
    disk: o.file ?? { $version: 1, machines: [], defaults: {} },
    handEdit(file) {
      state.disk = file;
    },
    setProfile(id, profileId) {
      const doc = list.get(id);
      if (doc) doc.profileId = profileId;
    },
    setText(id, text) {
      const doc = list.get(id);
      if (doc) {
        doc.text = text;
        doc.version = (doc.version ?? 0) + 1;
      }
    },
    detect: {},
    failNextSave: (reason) => {
      failure = reason;
    },
    remembered: [],
    memory: {},
  };
  let failure: string | null = null;

  state.machines = createMachineService({
    docs: {
      get: (id) => list.get(id),
      byPath: (path) => [...list.values()].find((doc) => doc.path === path),
      all: () => [...list.values()],
      update: (id, patch) => {
        const doc = list.get(id);
        if (doc && patch.machineId !== undefined) doc.machineId = patch.machineId;
      },
    },
    remember: (path, machineId) => {
      state.remembered.push({ path, machineId });
      if (machineId === undefined) delete state.memory[path];
      else state.memory[path] = machineId;
    },
    profiles: {
      defaultId: () => profiles.defaultId(),
      get: (id) => profiles.get(id),
      profile: (id) => profiles.profile(id),
      effective: (id, eff) => profiles.effective(id, eff),
      detectVariants: (id) => state.detect[id] ?? {},
    },
    codeDb: (dialect) => codes.byId(dialect),
    text: (id) => list.get(id)?.text ?? '',
    version: (id) => list.get(id)?.version ?? 0,
    save: async (file) => {
      if (failure !== null) {
        const reason = failure;
        failure = null;
        throw new Error(reason);
      }
      state.saved.push(file);
      state.disk = { $version: 1, ...file };
    },
    reload: async () => load(state.disk, null),
    openFile: async () => PATHS.machinesFile,
    open: async () => [],
    notify: (text) => {
      state.notes.push(text);
    },
    isTauri: () => true,
  });

  state.machines.load(load(state.disk, o.machinesError ?? null));
  state.notes.length = 0;
  return state;
}

function load(machines: Record<string, unknown>, machinesError: string | null): ConfigLoad {
  return {
    settings: {},
    settingsError: null,
    ui: {},
    stateError: null,
    machines: machinesError === null ? machines : {},
    machinesError,
    paths: PATHS,
  };
}

/** The effective machine of a document, which is what every consumer reads. */
function eff(h: Harness, id: DocId): EffectiveMachine {
  return h.machines.effective(id).machine;
}

/**
 * Lets the messages a **read** raises reach `notify`. `effective()` defers them by a
 * microtask (`notifyFromRead`), because a read happens inside a Svelte derivation and
 * writing to state from there throws. A test that asserts on `h.notes` after a read
 * awaits this first; the answer `effective()` returns needs no waiting.
 */
const said = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

const LATHE_DOC: FakeDoc = { id: 'd1', profileId: 'fanuc-lathe' };

describe('the effective view with nothing chosen', () => {
  it('answers the profile defaults, with every source "profile"', () => {
    const h = harness({ docs: [LATHE_DOC] });
    const view = h.machines.effective('d1');
    expect(view.profile.id).toBe('fanuc-lathe');
    expect(view.codes.dialect).toBe('fanuc-lathe');
    expect(view.machine.choice).toBe('none');
    expect(view.machine.id).toBeNull();
    expect(view.machine.source.numberInput).toBe('profile');
    // §8.1: the lathe's default preset reads numbers as written, so a point-less word is
    // not divided by a thousand behind the user's back.
    expect(view.profile.syntax.decimalPointSignificant).toBe(false);
    expect(view.profile.modal?.sources?.units).toBe('profile');
  });

  it('reuses one view per document, so hover does not re-merge a profile per keystroke', () => {
    const h = harness({ docs: [{ id: 'd1', profileId: 'fanuc-gcode' }] });
    expect(h.machines.effective('d1')).toBe(h.machines.effective('d1'));
  });

  it('falls back to the default profile for a document nobody knows', () => {
    const h = harness();
    expect(h.machines.effective('gone').profile.id).toBe(profiles.defaultId());
  });

  it('gives a stale profile id the default profile rather than throwing', () => {
    const h = harness({ docs: [{ id: 'd1', profileId: 'siemens-840d' }] });
    expect(h.machines.effective('d1').profile.id).toBe(profiles.defaultId());
  });
});

describe('which machine a document uses (AD-31 order)', () => {
  const FILE = {
    $version: 1,
    machines: [
      { id: 'lathe-b', name: 'Lathe B', profile: 'fanuc-lathe', params: { variants: { gcodeSystem: 'B' } } },
      { id: 'lathe-a', name: 'Lathe A', profile: 'fanuc-lathe', params: { variants: { gcodeSystem: 'A' } } },
      { id: 'mill-1', name: 'Mill 1', profile: 'fanuc-gcode', params: { units: 'inch' } },
    ],
    defaults: { 'fanuc-lathe': 'lathe-a' },
  };

  it('takes an explicit choice before the profile default', () => {
    const h = harness({ docs: [LATHE_DOC], file: FILE });
    h.machines.setForDoc('d1', 'lathe-b');
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', choice: 'document' });
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'B' });
    expect(h.machines.effective('d1').codes.dialect).toBe('fanuc-lathe-b');
  });

  it('takes an explicit "none" before the profile default, and says the source is the profile', () => {
    const h = harness({ docs: [LATHE_DOC], file: FILE });
    h.machines.setForDoc('d1', null);
    expect(eff(h, 'd1')).toMatchObject({ id: null, choice: 'document' });
    expect(eff(h, 'd1').source.variants.gcodeSystem).toBe('profile');
  });

  it('takes the profile default when nothing was chosen', () => {
    const h = harness({ docs: [LATHE_DOC], file: FILE });
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-a', choice: 'default' });
  });

  it('goes back to following the profile default when the choice is taken back', () => {
    // §7.15 gives `setForDoc` three arguments: an id, `null` = an explicit "none", and
    // `undefined` = "no choice of my own, follow the profile's default". The third only
    // deleted the service's own entry, and `choiceOf` then fell through to the mirror in
    // `DocMeta.machineId`, which still held the id — so "forget my choice for this file"
    // did nothing at all (G8 M6). It is latent today, and it is what M7/WP7.5 persists.
    const h = harness({ docs: [LATHE_DOC], file: FILE });
    h.machines.setForDoc('d1', 'lathe-b');
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', choice: 'document' });
    h.machines.setForDoc('d1', undefined);
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-a', choice: 'default' });
    // …and an explicit "none" is still a different answer from following the default.
    h.machines.setForDoc('d1', null);
    expect(eff(h, 'd1')).toMatchObject({ id: null, choice: 'document' });
    h.machines.setForDoc('d1', undefined);
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-a', choice: 'default' });
  });

  it('answers "none" when there is no default either', () => {
    const h = harness({ docs: [{ id: 'd1', profileId: 'fanuc-gcode' }], file: FILE });
    expect(eff(h, 'd1')).toMatchObject({ id: null, choice: 'none' });
  });

  // -- M7, AD-22: the choice survives a restart (WP7.5) ---------------------
  //
  // The memo is written from the **argument** of `setForDoc` and not from the mirror in
  // `DocMeta.machineId`, which `docs.update` cannot put back to `undefined`. Reading the
  // mirror would make "follow the profile default" last exactly until the next start.

  it('remembers an explicit machine for the file', () => {
    const h = harness({ docs: [{ ...LATHE_DOC, path: '/jobs/welle.nc' }], file: FILE });
    h.machines.setForDoc('d1', 'lathe-b');
    expect(h.memory).toEqual({ '/jobs/welle.nc': 'lathe-b' });
  });

  it('remembers an explicit "none" as null, not as "nothing chosen"', () => {
    const h = harness({ docs: [{ ...LATHE_DOC, path: '/jobs/welle.nc' }], file: FILE });
    h.machines.setForDoc('d1', null);
    expect(h.remembered).toEqual([{ path: '/jobs/welle.nc', machineId: null }]);
    expect(h.memory['/jobs/welle.nc']).toBeNull();
  });

  it('forgets the machine when the document goes back to the profile default', () => {
    const h = harness({ docs: [{ ...LATHE_DOC, path: '/jobs/welle.nc' }], file: FILE });
    h.machines.setForDoc('d1', 'lathe-b');
    h.machines.setForDoc('d1', undefined);
    expect(h.remembered.at(-1)).toEqual({ path: '/jobs/welle.nc', machineId: undefined });
    expect(h.memory).toEqual({});
    // The mirror still carries the old id, which is exactly why it may not be the source.
    expect(h.machines.get('lathe-b')?.id).toBe('lathe-b');
  });

  it('remembers nothing for an untitled document', () => {
    const h = harness({ docs: [LATHE_DOC], file: FILE });
    h.machines.setForDoc('d1', 'lathe-b');
    expect(h.remembered).toEqual([]);
  });

  it('a machine that was sold since is ignored, and said once', async () => {
    // A memo is never load-bearing: `fileOps.open` (WP7.3) puts the remembered id into
    // `DocMeta.machineId` without checking it, and the fallback and the message are
    // this service's job.
    const h = harness({
      docs: [{ ...LATHE_DOC, path: '/jobs/welle.nc', machineId: 'sold-last-year' }],
      file: FILE,
    });
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-a', choice: 'default' });
    await said();
    expect(h.notes).toHaveLength(1);
    h.machines.effective('d1');
    await said();
    expect(h.notes).toHaveLength(1);
  });

  it('falls back to the default when the chosen id is gone, and says so once', async () => {
    const h = harness({ docs: [{ ...LATHE_DOC, machineId: 'vanished' }], file: FILE });
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-a', choice: 'default' });
    await said();
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]).toContain('no longer available');
    h.machines.effective('d1');
    await said();
    expect(h.notes).toHaveLength(1);
  });

  it('reads the choice a document already carries, which is what per-file memory sets (M7)', () => {
    const h = harness({ docs: [{ ...LATHE_DOC, machineId: 'lathe-b' }], file: FILE });
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', choice: 'document' });
  });

  it('drops an incompatible machine after a profile switch, with one message', async () => {
    const h = harness({
      docs: [LATHE_DOC],
      file: { ...FILE, defaults: { 'fanuc-lathe': 'lathe-a', 'fanuc-gcode': 'mill-1' } },
    });
    h.machines.setForDoc('d1', 'lathe-b');
    expect(eff(h, 'd1')).toMatchObject({ id: 'lathe-b', choice: 'document' });

    // The document becomes a mill program: a lathe machine is not in the mill's chain, so
    // it is dropped for the mill's default rather than reading the file with lathe rules.
    h.setProfile('d1', 'fanuc-gcode');
    expect(eff(h, 'd1')).toMatchObject({ id: 'mill-1', choice: 'default' });
    await said();
    expect(h.notes.filter((note) => note.includes('not for this profile'))).toHaveLength(1);
  });

  it('offers a machine whose base profile is in the document profile\'s chain (AD-31)', () => {
    const h = harness({ file: FILE });
    // `fanuc-lathe` extends `fanuc-gcode`, so a lathe document may use a machine of either
    // — that is the same rule that lets a user profile (M12) use its parent's machines.
    // A mill document may not use a lathe machine: the lathe is not in the mill's chain.
    expect(h.machines.compatibleWith('fanuc-lathe').map((m) => m.id)).toEqual([
      'lathe-a',
      'lathe-b',
      'mill-1',
    ]);
    expect(h.machines.compatibleWith('fanuc-gcode').map((m) => m.id)).toEqual(['mill-1']);
    expect(h.machines.compatibleWith('heidenhain-klartext')).toEqual([]);
  });

  it('lists the machines by name and finds one by id', () => {
    const h = harness({ file: FILE });
    expect(get(h.machines.list).map((m) => m.name)).toEqual(['Lathe A', 'Lathe B', 'Mill 1']);
    expect(h.machines.get('lathe-b')?.name).toBe('Lathe B');
    expect(h.machines.get('nope')).toBeUndefined();
  });

  it('ignores a default that names a machine nobody has', () => {
    const h = harness({ file: { ...FILE, defaults: { 'fanuc-lathe': 'gone' } } });
    expect(h.machines.defaultFor('fanuc-lathe')).toBeNull();
  });

  it('ignores a default that names a machine the profile cannot use', () => {
    const h = harness({ file: { ...FILE, defaults: { 'fanuc-gcode': 'lathe-a' } } });
    expect(h.machines.defaultFor('fanuc-gcode')).toBeNull();
  });

  it('takes the parent profile\'s default when the document\'s own profile has none', () => {
    const h = harness({
      docs: [LATHE_DOC],
      file: { ...FILE, defaults: { 'fanuc-gcode': 'mill-1' } },
    });
    expect(h.machines.defaultFor('fanuc-lathe')).toBe('mill-1');
  });
});

describe('variant detection', () => {
  const B_TEXT = { gcodeSystem: { value: 'B', margin: 5 } };
  const FILE = {
    $version: 1,
    machines: [{ id: 'lathe-a', name: 'Lathe A', profile: 'fanuc-lathe', params: { variants: { gcodeSystem: 'A' } } }],
    defaults: {},
  };

  it('decides the variant when no machine is chosen, and records the source', () => {
    const h = harness({ docs: [LATHE_DOC] });
    h.detect['fanuc-lathe'] = B_TEXT;
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'B' });
    expect(eff(h, 'd1').source.variants.gcodeSystem).toBe('detected');
    expect(h.machines.effective('d1').codes.dialect).toBe('fanuc-lathe-b');
  });

  it('is read again when the program is replaced, and is never remembered from no text', () => {
    // G8 M6. The answer was cached per document and per profile id and nothing else, so a
    // program that was pasted over, reverted or rewritten by a script was still read in
    // the G-code system of the program that had stood there — and a consumer that reached
    // `effective()` before the model had any content pinned the variant to the profile
    // default for the life of the document.
    const h = harness({ docs: [{ ...LATHE_DOC, text: '' }] });
    h.detect['fanuc-lathe'] = B_TEXT;
    // The model has no content yet: the answer is used and not remembered.
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'B' });
    h.detect['fanuc-lathe'] = {};
    h.setText('d1', 'G50 S2500\nG96 S220 M03\n');
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'A' });

    // Now a real program, and a real replacement of it.
    h.detect['fanuc-lathe'] = B_TEXT;
    h.setText('d1', 'G92 S2500\nG96 S220 M03\n');
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'B' });
    expect(eff(h, 'd1').source.variants.gcodeSystem).toBe('detected');
    h.detect['fanuc-lathe'] = {};
    h.setText('d1', 'G50 S2500\nG96 S220 M03\n');
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'A' });
    // A read that changes nothing still costs one detection at most, not one per call.
    expect(h.machines.effective('d1')).toBe(h.machines.effective('d1'));
  });

  it('is ignored the moment a machine says otherwise, and disagrees once', async () => {
    const h = harness({ docs: [LATHE_DOC], file: FILE });
    h.detect['fanuc-lathe'] = B_TEXT;
    h.machines.setForDoc('d1', 'lathe-a');

    const machine = eff(h, 'd1');
    expect(machine.params.variants).toEqual({ gcodeSystem: 'A' });
    expect(machine.source.variants.gcodeSystem).toBe('machine');
    expect(machine.mismatch).toEqual({ variant: 'gcodeSystem', detected: 'B', chosen: 'A' });
    expect(h.machines.effective('d1').codes.dialect).toBe('fanuc-lathe');

    await said();
    const warnings = h.notes.filter((note) => note.includes('looks like'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('G-code system');
    h.machines.effective('d1');
    await said();
    expect(h.notes.filter((note) => note.includes('looks like'))).toHaveLength(1);
  });

  it('is ignored below the margin of 3, so an unusual program changes nothing', () => {
    const h = harness({ docs: [LATHE_DOC] });
    h.detect['fanuc-lathe'] = { gcodeSystem: { value: 'B', margin: 2 } };
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'A' });
    expect(eff(h, 'd1').source.variants.gcodeSystem).toBe('profile');
  });

  it('still runs for an explicit "none", which is what the status item shows as assumed', () => {
    const h = harness({ docs: [LATHE_DOC] });
    h.detect['fanuc-lathe'] = B_TEXT;
    h.machines.setForDoc('d1', null);
    expect(eff(h, 'd1').params.variants).toEqual({ gcodeSystem: 'B' });
    expect(eff(h, 'd1').source.variants.gcodeSystem).toBe('detected');
  });
});

describe('a file that could not be read', () => {
  it('gives no machines, one notice and a reason', () => {
    const h = harness({ machinesError: 'machines.json: invalid JSON (line 4)' });
    expect(get(h.machines.list)).toEqual([]);
    expect(h.machines.blocked()).toBe(true);
    expect(h.machines.problems()[0].message).toContain('invalid JSON');
  });

  it('refuses every write while it is unreadable, and keeps the file as it was', async () => {
    const h = harness({ machinesError: 'machines.json: invalid JSON' });
    await expect(h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} })).rejects.toThrow();
    await expect(h.machines.setDefault('fanuc-lathe', 'lathe-2')).rejects.toThrow();
    await expect(h.machines.remove('lathe-2')).rejects.toThrow();
    expect(h.saved).toEqual([]);
  });

  it('still opens the file and still replaces it with an empty one (AD-31 Management)', async () => {
    const h = harness({ machinesError: 'machines.json: invalid JSON' });
    await h.machines.openFile();
    await h.machines.replaceWithEmpty();
    expect(h.saved).toEqual([{ machines: [], defaults: {} }]);
    expect(h.machines.blocked()).toBe(false);
  });

  it('reads a file from a newer gEdit and never writes it', async () => {
    const h = harness({ file: sample('newer-version') });
    expect(get(h.machines.list).map((m) => m.id)).toEqual(['lathe-2']);
    expect(h.machines.blocked()).toBe(true);
    expect(h.machines.problems().some((problem) => problem.path === '$version')).toBe(true);
    await expect(h.machines.setDefault('fanuc-lathe', 'lathe-2')).rejects.toThrow();
    expect(h.saved).toEqual([]);
  });
});

describe('a record the profile does not understand', () => {
  it('is kept, listed with its problem, and never selectable', () => {
    const h = harness({ file: sample('invalid-record') });
    expect(get(h.machines.list).map((m) => m.id)).toEqual(['lathe-c', 'lathe-ok']);
    // `lathe-c` asks for a G-code system the profile does not have.
    expect(h.machines.compatibleWith('fanuc-lathe').map((m) => m.id)).toEqual(['lathe-ok']);
    // The paths point into the **file**, not into the list of usable records: `lathe-c` is
    // the first machine the page shows and the second record in the file.
    const paths = h.machines.problems().map((problem) => problem.path);
    expect(paths).toContain('machines[0].id');
    expect(paths).toContain('machines[1].params.variants.gcodeSystem');
  });

  it('is not chosen for a document that names it; the document falls back and is told why', async () => {
    const h = harness({ docs: [{ ...LATHE_DOC, machineId: 'lathe-c' }], file: sample('invalid-record') });
    expect(eff(h, 'd1')).toMatchObject({ id: null, choice: 'none' });
    await said();
    // The reason is "the file says something I cannot use", not "it is gone" and not
    // "it is for another profile": each of the three sends the user somewhere else.
    expect(h.notes).toEqual(['Machine "Lathe C" cannot be used as machines.json writes it; the defaults are assumed']);
  });

  it('is written back when something else is saved', async () => {
    const h = harness({ file: sample('invalid-record') });
    await h.machines.setDefault('fanuc-lathe', 'lathe-ok');
    const written = h.saved[0].machines as { id: string }[];
    expect(written.map((m) => m.id)).toEqual(['Lathe 2', 'lathe-c', 'lathe-ok']);
    expect(h.saved[0].workshop).toBe('hall 2');
  });
});

describe('editing the set', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness({ docs: [LATHE_DOC] });
  });

  it('adds a machine with an id made from its name, and saves at once', async () => {
    const id = await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: { units: 'inch' } });
    expect(id).toBe('lathe-2');
    expect(h.saved).toHaveLength(1);
    expect(get(h.machines.list).map((m) => m.id)).toEqual(['lathe-2']);
    expect(eff(h, 'd1').choice).toBe('none');
  });

  it('gives a second machine of the same name its own id', async () => {
    await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
    await h.machines.add({ name: 'Lathe 2 (inch)', profile: 'fanuc-lathe', params: {} });
    expect(get(h.machines.list).map((m) => m.id)).toEqual(['lathe-2', 'lathe-2-inch']);
    expect(slugOf('Drehmaschine Ö')).toBe('drehmaschine-o');
    expect(slugOf('***')).toBe('machine');
  });

  it('refuses to write a record its profile would report as broken', async () => {
    await expect(
      h.machines.add({ name: 'Lathe C', profile: 'fanuc-lathe', params: { variants: { gcodeSystem: 'C' } } }),
    ).rejects.toThrow(/gcodeSystem/);
    expect(h.saved).toEqual([]);
  });

  it('edits a machine and keeps everything the patch does not mention', async () => {
    const id = await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: { units: 'inch' }, notes: 'hall 2' });
    await h.machines.update(id, { name: 'Lathe two' });
    expect(h.machines.get(id)).toMatchObject({ name: 'Lathe two', notes: 'hall 2', params: { units: 'inch' } });
  });

  it('duplicates a machine with every parameter and a fresh id', async () => {
    const id = await h.machines.add({
      name: 'Lathe 2',
      profile: 'fanuc-lathe',
      params: { numberInput: { mode: 'increment', incrementMm: '0.001' } },
    });
    const copy = await h.machines.duplicate(id, 'Lathe 2 calc');
    expect(copy).toBe('lathe-2-calc');
    expect(h.machines.get(copy)?.params.numberInput).toEqual({ mode: 'increment', incrementMm: '0.001' });
    // A copy is its own record: editing it never reaches back into the original.
    await h.machines.update(copy, { params: { units: 'inch' } });
    expect(h.machines.get(id)?.params.numberInput).toBeDefined();
  });

  it('refuses to duplicate past the hundred a machines file holds', async () => {
    // G8 M6. `add` checked the cap and `duplicate` did not, so the 101st record was
    // written and then reported as invalid the next time the file was read — it vanished
    // from the list without the action having failed.
    const many = {
      $version: 1,
      machines: Array.from({ length: 100 }, (_unused, i) => ({
        id: `m-${i}`,
        name: `Machine ${i}`,
        profile: 'fanuc-lathe',
        params: {},
      })),
      defaults: {},
    };
    const full = harness({ docs: [LATHE_DOC], file: many });
    await expect(full.machines.add({ name: 'One more', profile: 'fanuc-lathe', params: {} })).rejects.toThrow(/100/);
    await expect(full.machines.duplicate('m-0', 'One more')).rejects.toThrow(/100/);
    expect(full.saved).toEqual([]);
    expect(get(full.machines.list)).toHaveLength(100);
  });

  it('keeps a generated id inside the 64 characters an id may have', async () => {
    // G8 M6. The slug was cut to a fixed 61 characters and the suffix appended, so the
    // hundredth collision produced a 65-character id that `validateMachine` then refused
    // with a message about the file rather than about the name the user had typed.
    const long = 'a'.repeat(70);
    const first = await h.machines.add({ name: long, profile: 'fanuc-lathe', params: {} });
    expect(first).toHaveLength(64);
    // The hundredth record is the one whose suffix needs three digits, which is where the
    // fixed cut ran over. A file holds a hundred, so that is exactly as far as this goes.
    for (let n = 2; n <= 100; n += 1) {
      const id = await h.machines.add({ name: long, profile: 'fanuc-lathe', params: {} });
      expect(id.length, id).toBeLessThanOrEqual(64);
      expect(id.endsWith(`-${n}`), id).toBe(true);
    }
    expect(new Set(get(h.machines.list).map((m) => m.id)).size).toBe(100);
  });

  it('sets and clears the default for a profile', async () => {
    const id = await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
    await h.machines.setDefault('fanuc-lathe', id);
    expect(h.machines.defaultFor('fanuc-lathe')).toBe(id);
    expect(eff(h, 'd1')).toMatchObject({ id, choice: 'default' });
    await h.machines.setDefault('fanuc-lathe', null);
    expect(h.machines.defaultFor('fanuc-lathe')).toBeNull();
    expect(eff(h, 'd1').choice).toBe('none');
  });

  it('refuses a default the profile cannot use', async () => {
    const id = await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
    await expect(h.machines.setDefault('fanuc-gcode', id)).rejects.toThrow();
    await expect(h.machines.setDefault('fanuc-lathe', 'nope')).rejects.toThrow();
  });

  it('re-evaluates the documents that used a removed machine, with one message', async () => {
    const id = await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
    h.machines.setForDoc('d1', id);
    expect(eff(h, 'd1').id).toBe(id);

    h.notes.length = 0;
    await h.machines.remove(id);
    expect(eff(h, 'd1')).toMatchObject({ id: null, choice: 'none' });
    expect(h.notes).toEqual(['Machine "Lathe 2" was removed; one open document falls back to the defaults']);
  });

  it('drops a default that named the removed machine', async () => {
    const id = await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
    await h.machines.setDefault('fanuc-lathe', id);
    await h.machines.remove(id);
    expect(h.saved.at(-1)).toEqual({ machines: [], defaults: {} });
  });

  it('keeps the file as it was when the save fails, and says so', async () => {
    const id = await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
    h.failNextSave('machines.json: read-only file system');
    await expect(h.machines.update(id, { name: 'Lathe two' })).rejects.toThrow('read-only');
    expect(h.machines.get(id)?.name).toBe('Lathe 2');
    expect(h.notes.at(-1)).toContain('could not be saved');
  });

  it('bumps the revision on every change, so the outline is rebuilt', async () => {
    const before = get(h.machines.revision);
    await h.machines.add({ name: 'Lathe 2', profile: 'fanuc-lathe', params: {} });
    expect(get(h.machines.revision)).toBeGreaterThan(before);
    const after = get(h.machines.revision);
    h.machines.setForDoc('d1', 'lathe-2');
    expect(get(h.machines.revision)).toBeGreaterThan(after);
  });
});

describe('a hand edit of machines.json', () => {
  it('is read again on save and is what the next page action writes back', async () => {
    const h = harness({
      docs: [LATHE_DOC],
      file: {
        $version: 1,
        machines: [{ id: 'lathe-2', name: 'Lathe 2', profile: 'fanuc-lathe', params: {} }],
        defaults: {},
      },
    });
    h.machines.setForDoc('d1', 'lathe-2');
    expect(eff(h, 'd1').params.numberInput?.mode).toBe('calculator');

    // The user opens the file, adds a per-class value by hand and saves the document.
    h.handEdit({
      $version: 1,
      machines: [
        {
          id: 'lathe-2',
          name: 'Lathe 2',
          profile: 'fanuc-lathe',
          params: {
            numberInput: {
              mode: 'increment',
              incrementMm: '0.001',
              classes: { feedPerRev: { mode: 'calculator' } },
            },
          },
        },
      ],
      defaults: {},
    });
    await h.machines.reloadFromDisk();

    // The open document follows the hand edit at once.
    expect(eff(h, 'd1').params.numberInput?.mode).toBe('increment');
    expect(eff(h, 'd1').params.numberInput?.classes?.feedPerRev?.mode).toBe('calculator');
    expect(h.machines.effective('d1').profile.syntax.decimalPointSignificant).toBe(true);

    // And the next page action writes the hand edit back, not the stale copy.
    await h.machines.setDefault('fanuc-lathe', 'lathe-2');
    const written = h.saved.at(-1)?.machines as { params: { numberInput?: { mode: string } } }[];
    expect(written[0].params.numberInput?.mode).toBe('increment');
  });

  it('reports a parse error found on reload instead of throwing', async () => {
    const h = harness();
    h.handEdit({ machines: 'not a list' });
    await expect(h.machines.reloadFromDisk()).resolves.toBeUndefined();
    expect(h.machines.blocked()).toBe(true);
    expect(h.notes.at(-1)).toContain('could not be read');
  });
});

describe('the machines document', () => {
  it('is the one at the configured path, and only once the config is loaded', () => {
    const h = harness({
      docs: [
        { id: 'd1', profileId: 'fanuc-lathe' },
        { id: 'd-machines', profileId: 'fanuc-gcode', path: '/cfg/machines.json' },
      ],
    });
    expect(h.machines.isMachinesDocument('d-machines')).toBe(true);
    expect(h.machines.isMachinesDocument('d1')).toBe(false);
  });

  it('opens the file through the command that grants it', async () => {
    const h = harness();
    await expect(h.machines.openFile()).resolves.toBeUndefined();
  });
});
