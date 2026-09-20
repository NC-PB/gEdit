// The IPC contract between the webview and the Rust commands (plan §7.6). The wrapper is
// the only caller, so pinning the command name and the argument shape here is what keeps
// the TS side and `src-tauri/src/files.rs` (WP1.4) in step.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const { filesStat } = await import('./commands');

describe('filesStat', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

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
