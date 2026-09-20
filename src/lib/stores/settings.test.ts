// The settings store (plan §7.3, AD-8): what reaches the app, what reaches the file, and
// what a broken file does to startup.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore, type SettingsLoadReport, type SettingsStoreDeps } from './settings';
import { DEFAULTS } from '$lib/core/settings/schema';
import type { ConfigLoad, ConfigPaths } from '$lib/platform/commands';

const PATHS: ConfigPaths = {
  configDir: '/cfg',
  dataDir: '/data',
  settingsFile: '/cfg/settings.json',
  stateFile: '/data/state.json',
  userScriptsDir: '/cfg/scripts',
};

function load(o: Partial<ConfigLoad> = {}): ConfigLoad {
  return {
    settings: {},
    settingsError: null,
    ui: {},
    stateError: null,
    paths: PATHS,
    ...o,
  };
}

interface Harness {
  deps: SettingsStoreDeps;
  saved: Record<string, unknown>[];
  notices: SettingsLoadReport[];
  next: (result: ConfigLoad) => void;
}

function harness(o: { isTauri?: boolean; failLoad?: Error; failSave?: Error } = {}): Harness {
  let result = load();
  const saved: Record<string, unknown>[] = [];
  const notices: SettingsLoadReport[] = [];
  return {
    saved,
    notices,
    next: (r) => {
      result = r;
    },
    deps: {
      configLoad: async () => {
        if (o.failLoad) throw o.failLoad;
        return result;
      },
      settingsSave: async (settings) => {
        if (o.failSave) throw o.failSave;
        saved.push(settings);
      },
      isTauri: () => o.isTauri !== false,
      notify: (report) => notices.push(report),
    },
  };
}

describe('settings store', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  it('starts at the defaults, before anything is loaded', () => {
    const store = createSettingsStore(h.deps);
    expect(get(store.values)).toEqual(DEFAULTS);
    expect(store.get('editor.tabWidth')).toBe(4);
    expect(get(store.paths)).toBeNull();
  });

  it('applies the file over the defaults and reports the paths', async () => {
    h.next(load({ settings: { $version: 1, 'editor.tabWidth': 2 } }));
    const store = createSettingsStore(h.deps);
    const report = await store.load();
    expect(report).toEqual({ warnings: [] });
    expect(store.get('editor.tabWidth')).toBe(2);
    expect(get(store.paths)).toEqual(PATHS);
    expect(h.notices).toEqual([]);
  });

  it('falls back to the defaults and notifies when Rust could not read the file', async () => {
    h.next(load({ settings: {}, settingsError: 'settings.json: expected value at line 1' }));
    const store = createSettingsStore(h.deps);
    const report = await store.load();
    expect(report.error).toContain('expected value');
    expect(get(store.values)).toEqual(DEFAULTS);
    expect(h.notices).toHaveLength(1);
    expect(store.report().error).toBe(report.error);
  });

  it('notifies about dropped values but keeps the good ones', async () => {
    h.next(load({ settings: { 'editor.tabWidth': 'two', 'editor.minimap': true } }));
    const store = createSettingsStore(h.deps);
    const report = await store.load();
    expect(report.warnings).toHaveLength(1);
    expect(store.get('editor.tabWidth')).toBe(4);
    expect(store.get('editor.minimap')).toBe(true);
    expect(h.notices).toHaveLength(1);
  });

  it('never throws when the command itself fails', async () => {
    const broken = harness({ failLoad: new Error('config folder is not writable') });
    const store = createSettingsStore(broken.deps);
    const report = await store.load();
    expect(report.error).toBe('config folder is not writable');
    expect(get(store.values)).toEqual(DEFAULTS);
    expect(broken.notices).toHaveLength(1);
  });

  it('does not read anything outside the webview', async () => {
    const browser = harness({ isTauri: false });
    const store = createSettingsStore(browser.deps);
    expect(await store.load()).toEqual({ warnings: [] });
    expect(browser.notices).toEqual([]);
  });

  it('writes $version plus only the changed keys, sorted', async () => {
    const store = createSettingsStore(h.deps);
    await store.load();
    await store.save({ 'editor.tabWidth': 2, 'appearance.theme': 'light' });
    expect(h.saved).toHaveLength(1);
    expect(Object.keys(h.saved[0] ?? {})).toEqual([
      '$version',
      'appearance.theme',
      'editor.tabWidth',
    ]);
    expect(h.saved[0]).toEqual({ $version: 1, 'appearance.theme': 'light', 'editor.tabWidth': 2 });
    expect(store.get('editor.tabWidth')).toBe(2);
  });

  it('accumulates: a second save keeps what the first one wrote', async () => {
    const store = createSettingsStore(h.deps);
    await store.load();
    await store.save({ 'editor.tabWidth': 2 });
    await store.save({ 'editor.minimap': true });
    expect(h.saved[1]).toEqual({ $version: 1, 'editor.minimap': true, 'editor.tabWidth': 2 });
  });

  it('drops a key from the file when it is set back to its default', async () => {
    h.next(load({ settings: { 'editor.tabWidth': 2 } }));
    const store = createSettingsStore(h.deps);
    await store.load();
    await store.save({ 'editor.tabWidth': 4 });
    expect(h.saved[0]).toEqual({ $version: 1 });
    expect(store.get('editor.tabWidth')).toBe(4);
  });

  it('resets the keys it is given and leaves the others alone', async () => {
    h.next(load({ settings: { 'editor.tabWidth': 2, 'editor.minimap': true } }));
    const store = createSettingsStore(h.deps);
    await store.load();
    await store.reset(['editor.tabWidth']);
    expect(h.saved[0]).toEqual({ $version: 1, 'editor.minimap': true });
  });

  it('carries an unknown key through a save', async () => {
    h.next(load({ settings: { $version: 1, 'future.option': 'keep me' } }));
    const store = createSettingsStore(h.deps);
    await store.load();
    await store.save({ 'editor.tabWidth': 2 });
    expect(h.saved[0]).toEqual({ $version: 1, 'editor.tabWidth': 2, 'future.option': 'keep me' });
  });

  it('never writes a value the merge would reject', async () => {
    const store = createSettingsStore(h.deps);
    await store.load();
    // A caller that bypassed the form validation; the round trip is the last line.
    await store.save({ 'appearance.editorFontSize': 200 });
    expect(h.saved[0]).toEqual({ $version: 1 });
    expect(store.get('appearance.editorFontSize')).toBe(14);
    expect(h.notices).toHaveLength(1);
  });

  it('reports what a write dropped, so the caller does not claim success', async () => {
    // G8 M2: the dialog used to show "Settings saved" right after the store had raised
    // the warning, which replaced it. `lastWriteWarnings()` is what it asks now.
    const store = createSettingsStore(h.deps);
    await store.load();
    expect(store.lastWriteWarnings()).toEqual([]);

    await store.save({ 'appearance.editorFontFamily': '' });
    expect(store.lastWriteWarnings()).toHaveLength(1);
    expect(store.lastWriteWarnings()[0]).toContain('appearance.editorFontFamily');
    expect(store.get('appearance.editorFontFamily')).toBe(DEFAULTS['appearance.editorFontFamily']);

    // The next clean write clears it again.
    await store.save({ 'editor.tabWidth': 2 });
    expect(store.lastWriteWarnings()).toEqual([]);
  });

  it('refuses to overwrite a file written by a newer build', async () => {
    h.next(load({ settings: { $version: 99, 'editor.tabWidth': 2 } }));
    const store = createSettingsStore(h.deps);
    await store.load();
    expect(store.isReadOnly()).toBe(true);
    expect(store.get('editor.tabWidth')).toBe(2);
    await expect(store.save({ 'editor.minimap': true })).rejects.toThrow(/newer version/);
    expect(h.saved).toEqual([]);
  });

  it('keeps the old values when the write fails', async () => {
    const failing = harness({ failSave: new Error('disk full') });
    const store = createSettingsStore(failing.deps);
    await store.load();
    await expect(store.save({ 'editor.tabWidth': 2 })).rejects.toThrow('disk full');
    expect(store.get('editor.tabWidth')).toBe(4);
  });

  it('keeps the values in memory when there is no file to write', async () => {
    const browser = harness({ isTauri: false });
    const store = createSettingsStore(browser.deps);
    await store.save({ 'appearance.theme': 'light' });
    expect(store.get('appearance.theme')).toBe('light');
    expect(browser.saved).toEqual([]);
  });

  it('pushes every change to the subscribers', async () => {
    const store = createSettingsStore(h.deps);
    const seen = vi.fn();
    const stop = store.values.subscribe((v) => seen(v['appearance.theme']));
    expect(seen).toHaveBeenLastCalledWith('system');
    await store.save({ 'appearance.theme': 'dark' });
    expect(seen).toHaveBeenLastCalledWith('dark');
    stop();
  });

  it('re-reads the file on request', async () => {
    const store = createSettingsStore(h.deps);
    await store.load();
    h.next(load({ settings: { 'editor.tabWidth': 8 } }));
    await store.reloadFromDisk();
    expect(store.get('editor.tabWidth')).toBe(8);
  });
});
