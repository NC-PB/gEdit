// The IPC contract between the webview and the Rust commands (plan §7.6). The wrapper is
// the only caller, so pinning the command name and the argument shape here is what keeps
// the TS side and `src-tauri/src/files.rs` (WP1.4) in step.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const {
  filesStat,
  configLoad,
  settingsSave,
  uiStateSave,
  settingsOpenFile,
  recentList,
  recentTouch,
  recentRemove,
  recentClear,
} = await import('./commands');

beforeEach(() => {
  invoke.mockReset();
});

describe('filesStat', () => {

  it('calls files_stat with the paths as a named argument', async () => {
    invoke.mockResolvedValue([]);
    await filesStat(['/nc/a.nc', '/nc/b.h']);
    expect(invoke).toHaveBeenCalledWith('files_stat', { paths: ['/nc/a.nc', '/nc/b.h'] });
  });

  it('passes the result through unchanged', async () => {
    const stats = [
      { path: '/nc/a.nc', allowed: true, exists: true, isDir: false, mtimeMs: 1, size: 2, readonly: false },
      { path: '/nope', allowed: false, exists: false, isDir: false, mtimeMs: null, size: null, readonly: false },
    ];
    invoke.mockResolvedValue(stats);
    await expect(filesStat(['/nc/a.nc', '/nope'])).resolves.toEqual(stats);
  });
});

// M2 (plan §7.6): the config, state and recent-files commands. The argument keys are the
// Rust parameter names of `src-tauri/src/{config,state}.rs`; a rename on either side has
// to break here rather than at runtime.
describe('the M2 config, state and recent commands', () => {
  it('passes no arguments where the command takes none', async () => {
    invoke.mockResolvedValue(undefined);
    await configLoad();
    expect(invoke).toHaveBeenCalledWith('config_load');
    invoke.mockReset();

    invoke.mockResolvedValue('/cfg/settings.json');
    await expect(settingsOpenFile()).resolves.toBe('/cfg/settings.json');
    expect(invoke).toHaveBeenCalledWith('settings_open_file');
    invoke.mockReset();

    invoke.mockResolvedValue([]);
    await recentList();
    expect(invoke).toHaveBeenCalledWith('recent_list');
    invoke.mockReset();

    invoke.mockResolvedValue([]);
    await recentClear();
    expect(invoke).toHaveBeenCalledWith('recent_clear');
  });

  it('names the object it writes after the Rust parameter', async () => {
    invoke.mockResolvedValue(undefined);
    await settingsSave({ $version: 1, 'editor.tabWidth': 2 });
    expect(invoke).toHaveBeenCalledWith('settings_save', {
      settings: { $version: 1, 'editor.tabWidth': 2 },
    });
    invoke.mockReset();

    invoke.mockResolvedValue(undefined);
    await uiStateSave({ layout: { overlay: null } });
    expect(invoke).toHaveBeenCalledWith('ui_state_save', { ui: { layout: { overlay: null } } });
  });

  it('sends the path and the cap of a recent-list update', async () => {
    const list = [{ path: '/nc/a.nc', exists: true }];
    invoke.mockResolvedValue(list);
    await expect(recentTouch('/nc/a.nc', 15)).resolves.toEqual(list);
    expect(invoke).toHaveBeenCalledWith('recent_touch', { path: '/nc/a.nc', max: 15 });
    invoke.mockReset();

    invoke.mockResolvedValue([]);
    await recentRemove('/nc/gone.nc');
    expect(invoke).toHaveBeenCalledWith('recent_remove', { path: '/nc/gone.nc' });
  });
});
