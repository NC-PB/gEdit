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
  filesBackup,
  sessionSave,
  sessionLoad,
  recoveryHeader,
  recoveryPut,
  recoveryDrop,
  recoveryClearCurrent,
  recoveryList,
  recoveryRead,
  recoveryDiscard,
  RECOVERY_HEADER,
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

// M7 (plan §7.10): backup, session and crash recovery. The argument keys are the Rust
// parameter names of `src-tauri/src/{backup,session,recovery}.rs`.
describe('the M7 backup, session and recovery commands', () => {
  it('asks for a backup by path and passes the answer through', async () => {
    invoke.mockResolvedValue('/data/backups/3f2a/part.nc/20260101-101500.250-part.nc');
    await expect(filesBackup('/nc/part.nc')).resolves.toBe(
      '/data/backups/3f2a/part.nc/20260101-101500.250-part.nc',
    );
    expect(invoke).toHaveBeenCalledWith('files_backup', { path: '/nc/part.nc' });
    invoke.mockReset();

    // `null` is "there was nothing to copy", which is not a failure and must not be
    // turned into one: the save goes ahead.
    invoke.mockResolvedValue(null);
    await expect(filesBackup('/nc/new.nc')).resolves.toBeNull();
  });

  it('never sends the backup mode or count, because Rust reads them itself', async () => {
    invoke.mockResolvedValue(null);
    await filesBackup('/nc/part.nc');
    expect(Object.keys(invoke.mock.calls[0][1] as object)).toEqual(['path']);
  });

  it('saves and loads the session list', async () => {
    invoke.mockResolvedValue(undefined);
    await sessionSave(['/nc/a.nc', '/nc/b.nc'], 1);
    expect(invoke).toHaveBeenCalledWith('session_save', { paths: ['/nc/a.nc', '/nc/b.nc'], active: 1 });
    invoke.mockReset();

    invoke.mockResolvedValue({ paths: ['/nc/a.nc'], active: null });
    await expect(sessionLoad()).resolves.toEqual({ paths: ['/nc/a.nc'], active: null });
    expect(invoke).toHaveBeenCalledWith('session_load');
  });

  describe('recoveryHeader', () => {
    const meta = {
      key: 'd7',
      path: '/nc/part.nc',
      title: 'part.nc',
      profileId: 'fanuc-gcode',
      encoding: { encoding: 'utf-8' as const, hasBom: false },
      eol: 'crlf' as const,
      nul: { leader: 0, trailer: 0, stripped: 0 },
      diskStamp: null,
      savedAt: 1_700_000_000_000,
    };

    it('escapes everything a header value may not carry, and still parses back', () => {
      const header = recoveryHeader({ ...meta, path: '/Aufträge/Welle Ø20.nc', title: 'Welle Ø20.nc' });
      // A header value is visible ASCII only; an Umlaut in a program path would
      // otherwise throw at the fetch and the snapshot would never be written.
      expect(header).toMatch(/^[\x20-\x7e]*$/);
      expect(JSON.parse(header)).toEqual({ ...meta, path: '/Aufträge/Welle Ø20.nc', title: 'Welle Ø20.nc' });
    });

    it('escapes control characters and lone surrogates too', () => {
      const header = recoveryHeader({ ...meta, title: 'a\u0007b\ud800c' });
      expect(header).toMatch(/^[\x20-\x7e]*$/);
      expect((JSON.parse(header) as { title: string }).title).toBe('a\u0007b\ud800c');
    });

    it('leaves plain ASCII alone', () => {
      expect(recoveryHeader(meta)).toBe(JSON.stringify(meta));
    });

    it('sends the text as a raw body and the metadata in the header', async () => {
      invoke.mockResolvedValue(undefined);
      await recoveryPut(meta, 'G0 X0\nG1 Z-5\n');
      const [cmd, body, options] = invoke.mock.calls[0];
      expect(cmd).toBe('recovery_put');
      // Raw bytes, not a JSON argument: a 10 MB program must not be escaped and
      // re-parsed on a 30 s timer (F30).
      expect(body).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(body as Uint8Array)).toBe('G0 X0\nG1 Z-5\n');
      expect(options).toEqual({ headers: { [RECOVERY_HEADER]: recoveryHeader(meta) } });
      expect(RECOVERY_HEADER).toBe('x-gedit-recovery');
    });
  });

  it('addresses a snapshot by session and key, never by path', async () => {
    invoke.mockResolvedValue(undefined);
    await recoveryDrop('d7');
    expect(invoke).toHaveBeenCalledWith('recovery_drop', { key: 'd7' });
    invoke.mockReset();

    invoke.mockResolvedValue(undefined);
    await recoveryClearCurrent();
    expect(invoke).toHaveBeenCalledWith('recovery_clear_current');
    invoke.mockReset();

    invoke.mockResolvedValue([]);
    await expect(recoveryList()).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith('recovery_list');
    invoke.mockReset();

    invoke.mockResolvedValue(undefined);
    await recoveryDiscard('s-17');
    expect(invoke).toHaveBeenCalledWith('recovery_discard', { session: 's-17' });
  });

  it('decodes the raw bytes a snapshot read answers with', async () => {
    const bytes = new TextEncoder().encode('G0 X0\n');
    invoke.mockResolvedValue(bytes.buffer);
    await expect(recoveryRead('s-17', 'd7')).resolves.toBe('G0 X0\n');
    expect(invoke).toHaveBeenCalledWith('recovery_read', { session: 's-17', key: 'd7' });
  });
});
