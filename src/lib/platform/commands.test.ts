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
  scriptsList,
  scriptRun,
  scriptCancel,
  pythonCheck,
  scriptNew,
  scriptCopyToUser,
  scriptSourcePath,
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

// M4 (plan §7.6): the scripting commands. Two things are pinned here, and both are
// security properties rather than conveniences: the argument of `script_run` is named
// `req` (the struct Rust deserializes), and every other command takes a script **id** —
// never a path, never a folder and never an interpreter (plan §3, AD-13).
describe('the M4 scripting commands', () => {
  it('asks for the script list and the Python probe without arguments', async () => {
    invoke.mockResolvedValue({ scripts: [], folders: [] });
    await expect(scriptsList()).resolves.toEqual({ scripts: [], folders: [] });
    expect(invoke).toHaveBeenCalledWith('scripts_list');
    invoke.mockReset();

    const status = { ok: true, interpreter: '/usr/bin/python3', version: '3.12.4', message: null };
    invoke.mockResolvedValue(status);
    await expect(pythonCheck()).resolves.toEqual(status);
    expect(invoke).toHaveBeenCalledWith('python_check');
  });

  it('wraps a run request in the `req` argument', async () => {
    const req = {
      runId: 'r1',
      scriptId: 'bundled:tool_list.py',
      stdin: 'G0 X0\n',
      context: { contract: 2 },
      timeoutSecs: null,
    };
    invoke.mockResolvedValue({ success: true });
    await scriptRun(req);
    expect(invoke).toHaveBeenCalledWith('script_run', { req });
  });

  it('cancels by run id', async () => {
    invoke.mockResolvedValue(true);
    await expect(scriptCancel('r1')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('script_cancel', { runId: 'r1' });
  });

  it('sends only ids and names to the three path commands', async () => {
    invoke.mockResolvedValue('/cfg/scripts/mine.py');
    await expect(scriptNew('mine')).resolves.toBe('/cfg/scripts/mine.py');
    expect(invoke).toHaveBeenCalledWith('script_new', { name: 'mine' });
    invoke.mockReset();

    invoke.mockResolvedValue('/cfg/scripts/tool_list.py');
    await scriptCopyToUser('bundled:tool_list.py');
    expect(invoke).toHaveBeenCalledWith('script_copy_to_user', { scriptId: 'bundled:tool_list.py' });
    invoke.mockReset();

    invoke.mockResolvedValue('/cfg/scripts/grp/mine.py');
    await scriptSourcePath('user:grp/mine.py');
    expect(invoke).toHaveBeenCalledWith('script_source_path', { scriptId: 'user:grp/mine.py' });
  });
});
