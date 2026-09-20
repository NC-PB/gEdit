// What the settings contribution declares, and the one thing it does at runtime (plan §5
// WP2.7, §7.11).
//
// The command id and `Mod+,` are contracts: §7.11 assigns that key to `settings.open` and
// nothing else, the runtime scenario `m1-keys` checks the table in both directions, and a
// second claim on the same keys would be a startup console error.
//
// `activate()` re-reads `settings.json` when the *settings document* is saved. The
// document store is the real one, so the path comparison really is `docs.byPath` (and so
// really is case-insensitive on macOS); only `app/fileOps` and `stores/settings` are
// replaced, because one owns a native save and the other an IPC call.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocId, NewDocMeta } from '$lib/app/types';
import type { ConfigPaths } from '$lib/platform/commands';

const SETTINGS_FILE = '/home/u/Library/Application Support/com.pburg.gedit/settings.json';

/** A readable store of `ConfigPaths` this file can fill, plus the spies. */
const fake = vi.hoisted(() => {
  const subscribers = new Set<(value: unknown) => void>();
  let paths: unknown = null;
  let saved: ((id: string, path: string) => void) | null = null;
  return {
    reloadFromDisk: vi.fn(async (): Promise<void> => {}),
    disposeSave: vi.fn((): void => {}),
    /** The components handed to `modals.open`. */
    opened: [] as unknown[],
    setPaths(next: unknown): void {
      paths = next;
      for (const run of subscribers) run(next);
    },
    /** Fires what `files.onDidSave` registered. */
    save(id: string, path: string): void {
      saved?.(id, path);
    },
    onDidSave(cb: (id: string, path: string) => void) {
      saved = cb;
      return this.disposeSave;
    },
    pathsStore: {
      subscribe(run: (value: unknown) => void) {
        subscribers.add(run);
        run(paths);
        return (): void => void subscribers.delete(run);
      },
    },
  };
});

vi.mock('$lib/app/fileOps', () => ({
  files: {
    onDidSave: (cb: (id: string, path: string) => void) => fake.onDidSave(cb),
    onDidOpen: () => (): void => {},
    onWillQuit: () => (): void => {},
    open: async (): Promise<string[]> => [],
  },
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    open: async (component: unknown): Promise<undefined> => {
      fake.opened.push(component);
      return undefined;
    },
  },
}));

vi.mock('$lib/stores/settings', () => ({
  settings: {
    paths: fake.pathsStore,
    reloadFromDisk: fake.reloadFromDisk,
    isReadOnly: () => false,
    report: () => ({ warnings: [] }),
    save: async (): Promise<void> => {},
    reset: async (): Promise<void> => {},
  },
}));

const settingsContrib = (await import('./settings')).default;
const SettingsDialog = (await import('$lib/components/dialogs/SettingsDialog.svelte')).default;
const { docs } = await import('$lib/stores/documents');
const { hasKey } = await import('$lib/i18n');

function paths(settingsFile: string): ConfigPaths {
  return {
    configDir: '/config',
    dataDir: '/data',
    settingsFile,
    stateFile: '/data/state.json',
    userScriptsDir: '/config/scripts',
  };
}

function addDoc(path: string): DocId {
  const meta: NewDocMeta = {
    path,
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
  };
  return docs.add(meta);
}

beforeEach(() => {
  fake.reloadFromDisk.mockClear();
  fake.disposeSave.mockClear();
  fake.opened.length = 0;
  fake.setPaths(paths(SETTINGS_FILE));
});

afterEach(() => {
  for (const doc of docs.all()) docs.remove(doc.id);
});

describe('what it declares', () => {
  it('registers one command, on §7.11’s Mod+,', () => {
    expect(settingsContrib.commands).toHaveLength(1);
    const [def] = settingsContrib.commands;
    expect(def.id).toBe('settings.open');
    expect(def.keys).toBe('Mod+,');
    expect(def.global).toBe(true);
  });

  it('opens the settings dialog, and nothing else, when it runs', () => {
    // `satisfies Contribution` keeps the literal type, so the command takes no argument.
    settingsContrib.commands[0].run();
    expect(fake.opened).toEqual([SettingsDialog]);
  });

  it('has an id that matches its file name, and the i18n namespace', () => {
    expect(settingsContrib.id).toBe('settings');
    expect(settingsContrib.commands[0].title.startsWith('settings.')).toBe(true);
  });

  it('every title, category and ribbon group key has a message', () => {
    const keys = [
      settingsContrib.commands[0].title,
      settingsContrib.commands[0].category,
      ...settingsContrib.ribbon.map((item) => item.group),
    ].filter((key): key is string => typeof key === 'string');
    expect(keys.filter((key) => !hasKey(key))).toEqual([]);
  });

  it('sits in the View tab between Appearance (90) and Help (100)', () => {
    expect(settingsContrib.ribbon).toEqual([
      { tab: 'view', group: 'settings.group', command: 'settings.open', order: 95 },
    ]);
  });
});

describe('the settings file as a document', () => {
  it('re-reads the settings when that document is saved', () => {
    const dispose = settingsContrib.activate();
    const id = addDoc(SETTINGS_FILE);
    fake.save(id, SETTINGS_FILE);
    expect(fake.reloadFromDisk).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('ignores the save of any other document', () => {
    const dispose = settingsContrib.activate();
    addDoc(SETTINGS_FILE);
    const other = addDoc('/nc/prog.nc');
    fake.save(other, '/nc/prog.nc');
    expect(fake.reloadFromDisk).not.toHaveBeenCalled();
    dispose();
  });

  it('does nothing while the config paths are unknown', () => {
    fake.setPaths(null);
    const dispose = settingsContrib.activate();
    const id = addDoc(SETTINGS_FILE);
    fake.save(id, SETTINGS_FILE);
    expect(fake.reloadFromDisk).not.toHaveBeenCalled();
    dispose();
  });

  it('does not reload when the file is not open as a document at all', () => {
    const dispose = settingsContrib.activate();
    const other = addDoc('/nc/prog.nc');
    fake.save(other, SETTINGS_FILE);
    expect(fake.reloadFromDisk).not.toHaveBeenCalled();
    dispose();
  });

  it('hands back the disposer of the listener it installed', () => {
    settingsContrib.activate()();
    expect(fake.disposeSave).toHaveBeenCalledTimes(1);
  });

  it('survives a rejected reload instead of leaving an unhandled rejection', async () => {
    fake.reloadFromDisk.mockRejectedValueOnce(new Error('config_load failed'));
    const dispose = settingsContrib.activate();
    const id = addDoc(SETTINGS_FILE);
    fake.save(id, SETTINGS_FILE);
    await Promise.resolve();
    expect(fake.reloadFromDisk).toHaveBeenCalledTimes(1);
    dispose();
  });
});
