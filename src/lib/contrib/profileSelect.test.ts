// How the dialect picker offers the profiles (plan §5 WP6.1, §7.3, AD-16).
//
// The names themselves are data (contrib README rule 3); what is tested here is the
// grouping around them, which is the app's: a lathe profile that extends a mill one is the
// same control, and the picker has to show it as one family instead of two entries whose
// relationship the user has to guess.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import profileSelect, { pickerEntries } from './profileSelect';
import ProfileStatus from '$lib/components/status/ProfileStatus.svelte';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { files } from '$lib/app/fileOps';
import { docs } from '$lib/stores/documents';
import { fileMemory } from '$lib/stores/fileMemory';
import { t } from '$lib/i18n';
import type { CommandDef, ProfileInfo, QuickPickItem } from '$lib/app/types';

/** A `ProfileInfo` with only the members the picker reads. */
function info(id: string, parent: string | null = null): ProfileInfo {
  return {
    id,
    name: `${id} files`,
    shortName: id,
    extensions: ['nc'],
    defaultFileName: 'program.nc',
    newFileEol: 'crlf',
    machineType: 'mill',
    origin: 'builtin',
    parent,
    file: null,
    chain: parent === null ? [id] : [id, parent],
    hasMachineParams: false,
  };
}

/** The names of the built-ins, as `Profile.name` gives them. */
const NAMES: Record<string, string> = {
  'fanuc-gcode': 'Fanuc (ISO) mill',
  'fanuc-lathe': 'Fanuc (ISO) lathe',
  'heidenhain-klartext': 'Heidenhain Klartext',
};

const nameOf = (id: string): string => NAMES[id] ?? id;

describe('the picker entries', () => {
  it('offer a family under the part of the name it shares', () => {
    const entries = pickerEntries(
      [info('fanuc-gcode'), info('fanuc-lathe', 'fanuc-gcode'), info('heidenhain-klartext')],
      nameOf,
    );
    expect(entries).toEqual([
      { id: 'fanuc-gcode', label: 'Fanuc (ISO) · mill' },
      { id: 'fanuc-lathe', label: 'Fanuc (ISO) · lathe' },
      { id: 'heidenhain-klartext', label: 'Heidenhain Klartext' },
    ]);
  });

  it('put a child right after its parent, wherever it was declared', () => {
    const entries = pickerEntries(
      [info('fanuc-gcode'), info('heidenhain-klartext'), info('fanuc-lathe', 'fanuc-gcode')],
      nameOf,
    );
    expect(entries.map((entry) => entry.id)).toEqual([
      'fanuc-gcode',
      'fanuc-lathe',
      'heidenhain-klartext',
    ]);
  });

  it('keep a whole line together, a grandchild included (M12 user profiles)', () => {
    const names: Record<string, string> = {
      'fanuc-gcode': 'Fanuc (ISO) mill',
      'fanuc-lathe': 'Fanuc (ISO) lathe',
      mine: 'Fanuc (ISO) lathe 2',
    };
    const entries = pickerEntries(
      [info('fanuc-gcode'), info('heidenhain-klartext'), info('mine', 'fanuc-lathe'), info('fanuc-lathe', 'fanuc-gcode')],
      (id) => names[id] ?? NAMES[id],
    );
    expect(entries).toEqual([
      { id: 'fanuc-gcode', label: 'Fanuc (ISO) · mill' },
      { id: 'fanuc-lathe', label: 'Fanuc (ISO) · lathe' },
      { id: 'mine', label: 'Fanuc (ISO) · lathe 2' },
      { id: 'heidenhain-klartext', label: 'Heidenhain Klartext' },
    ]);
  });

  it('leave a profile with no relatives exactly as it is called', () => {
    expect(pickerEntries([info('heidenhain-klartext')], nameOf)).toEqual([
      { id: 'heidenhain-klartext', label: 'Heidenhain Klartext' },
    ]);
  });

  it('name the family after what every member of it shares', () => {
    const names: Record<string, string> = {
      a: 'Maker 900 mill',
      b: 'Maker 900 lathe',
      c: 'Maker 900 grinder',
    };
    const entries = pickerEntries([info('a'), info('b', 'a'), info('c', 'a')], (id) => names[id]);
    expect(entries.map((entry) => entry.label)).toEqual([
      'Maker 900 · mill',
      'Maker 900 · lathe',
      'Maker 900 · grinder',
    ]);
  });

  it('write both names out when they share nothing, or one is inside the other', () => {
    const names: Record<string, string> = { a: 'Fanuc', b: 'Fanuc lathe', c: 'Something else' };
    // "Fanuc" and "Fanuc lathe": there is no part left to call the parent by.
    expect(pickerEntries([info('a'), info('b', 'a')], (id) => names[id]).map((e) => e.label)).toEqual([
      'Fanuc',
      'Fanuc lathe',
    ]);
    expect(pickerEntries([info('a'), info('c', 'a')], (id) => names[id]).map((e) => e.label)).toEqual([
      'Fanuc',
      'Something else',
    ]);
  });

  it('list a child whose parent this build does not have, and one that names itself', () => {
    const entries = pickerEntries([info('orphan', 'gone'), info('self', 'self')], (id) => id);
    expect(entries.map((entry) => entry.id)).toEqual(['orphan', 'self']);
  });

  it('list a cycle between two user profiles rather than losing them', () => {
    const entries = pickerEntries([info('a', 'b'), info('b', 'a')], (id) => id);
    expect(entries.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('answer nothing when nothing loaded', () => {
    expect(pickerEntries([], nameOf)).toEqual([]);
  });
});

// M12.5 (WP-RP6): a dialect that is only a guess.
describe('an uncertain dialect', () => {
  function addDoc(over: { dialectUncertain?: boolean; path?: string | null } = {}) {
    return docs.add({
      path: over.path === undefined ? '/nc/a.nc' : over.path,
      untitledIndex: null,
      profileId: 'fanuc-lathe',
      ...(over.dialectUncertain ? { dialectUncertain: true } : {}),
      encoding: { encoding: 'utf-8', hasBom: false },
      eol: 'lf',
      eolMixedOnLoad: false,
      nul: { leader: 0, trailer: 0, stripped: 0 },
      textDirty: false,
      metaDirty: false,
      disk: null,
      external: 'none',
      readOnly: false,
      readOnlyReason: null,
    });
  }

  /** Runs the picker with `choose` picking an item; returns what it was offered. */
  async function runPicker(choose: (items: QuickPickItem<string>[]) => string | undefined) {
    const seen: { items: QuickPickItem<string>[]; placeholder?: string; initialIndex?: number } = { items: [] };
    vi.spyOn(modals, 'quickPick').mockImplementation(((items: QuickPickItem<string>[], o?: { placeholder?: string; initialIndex?: number }) => {
      seen.items = items;
      seen.placeholder = o?.placeholder;
      seen.initialIndex = o?.initialIndex;
      return Promise.resolve(choose(items));
    }) as never);
    const command = (profileSelect.commands as CommandDef[]).find((c) => c.id === 'file.setProfile');
    await command?.run({} as never);
    return seen;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const doc of [...docs.all()]) docs.remove(doc.id);
  });

  it('shows the guess with a question mark and a plain tooltip', () => {
    addDoc({ dialectUncertain: true });
    const html = render(ProfileStatus).body;
    expect(html).toContain(t('profiles.uncertain.label', { name: 'Fanuc T' }));
    expect(html).toContain('data-uncertain="true"');
    expect(html).toContain('Dialect uncertain');
  });

  it('shows a sure dialect as before', () => {
    addDoc();
    const html = render(ProfileStatus).body;
    expect(html).not.toContain('?');
    expect(html).not.toContain('data-uncertain');
  });

  it('offers "Keep … (the guess)" first and remembers it though nothing changes', async () => {
    const id = addDoc({ dialectUncertain: true });
    const remember = vi.spyOn(fileMemory, 'remember').mockImplementation(() => {});
    const setProfile = vi.spyOn(files, 'setProfile');
    const show = vi.spyOn(status, 'show').mockImplementation(() => {});
    const seen = await runPicker((items) => items[0].value);
    expect(seen.items[0].label).toMatch(/^Keep .* \(the guess\)$/);
    expect(seen.placeholder).toBe(t('profiles.uncertain.placeholder'));
    expect(seen.initialIndex).toBe(0);
    expect(remember).toHaveBeenCalledWith('/nc/a.nc', { profileId: 'fanuc-lathe' });
    expect(setProfile).not.toHaveBeenCalled();
    expect(docs.get(id)?.dialectUncertain).toBe(false);
    expect(show).toHaveBeenCalledOnce();
  });

  it('is cleared and remembered by picking the same dialect from the list', async () => {
    const id = addDoc({ dialectUncertain: true });
    const remember = vi.spyOn(fileMemory, 'remember').mockImplementation(() => {});
    vi.spyOn(status, 'show').mockImplementation(() => {});
    await runPicker(() => 'fanuc-lathe');
    expect(remember).toHaveBeenCalledWith('/nc/a.nc', { profileId: 'fanuc-lathe' });
    expect(docs.get(id)?.dialectUncertain).toBe(false);
  });

  it('is cleared by picking another dialect', async () => {
    const id = addDoc({ dialectUncertain: true });
    const remember = vi.spyOn(fileMemory, 'remember').mockImplementation(() => {});
    vi.spyOn(status, 'show').mockImplementation(() => {});
    vi.spyOn(files, 'setProfile').mockImplementation((docId, profileId) => {
      docs.update(docId, { profileId });
    });
    await runPicker(() => 'heidenhain-klartext');
    expect(remember).toHaveBeenCalledWith('/nc/a.nc', { profileId: 'heidenhain-klartext' });
    expect(docs.get(id)?.dialectUncertain).toBe(false);
    expect(docs.get(id)?.profileId).toBe('heidenhain-klartext');
  });

  it('stays uncertain when the picker is dismissed', async () => {
    const id = addDoc({ dialectUncertain: true });
    await runPicker(() => undefined);
    expect(docs.get(id)?.dialectUncertain).toBe(true);
  });

  it('has no "Keep" entry on a sure dialect, and an unchanged pick does nothing', async () => {
    addDoc();
    const remember = vi.spyOn(fileMemory, 'remember').mockImplementation(() => {});
    const seen = await runPicker(() => 'fanuc-lathe');
    expect(seen.items.some((item) => item.label.startsWith('Keep '))).toBe(false);
    expect(seen.placeholder).toBe(t('profiles.placeholder'));
    expect(remember).not.toHaveBeenCalled();
  });
});
