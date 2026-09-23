// Platform helpers. `isMacPlatform` decides which half of a `{ mac, other }` KeySpec
// applies, so it is worth pinning against both a real webview and a bare environment.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseName, isDeviceName, isMacPlatform, isTauriRuntime, plainPath } from './platform';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isMacPlatform', () => {
  it('reads navigator.platform first, then the user agent', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'x' });
    expect(isMacPlatform()).toBe(true);
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'x' });
    expect(isMacPlatform()).toBe(false);
    vi.stubGlobal('navigator', { platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' });
    expect(isMacPlatform()).toBe(true);
    vi.stubGlobal('navigator', { platform: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(isMacPlatform()).toBe(false);
  });

  it('is false without a navigator', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isMacPlatform()).toBe(false);
  });
});

describe('isTauriRuntime', () => {
  it('is true only inside the Tauri webview', () => {
    expect(isTauriRuntime()).toBe(false);
    vi.stubGlobal('window', {});
    expect(isTauriRuntime()).toBe(false);
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isTauriRuntime()).toBe(true);
  });
});

describe('baseName', () => {
  it('takes the last segment of a POSIX or Windows path', () => {
    expect(baseName('/nc/a.h')).toBe('a.h');
    expect(baseName('C:\\nc\\a.h')).toBe('a.h');
    expect(baseName('a.h')).toBe('a.h');
    expect(baseName('')).toBe('');
    expect(baseName('/nc/')).toBe('/nc/');
  });
});

// M8. The mirror of `paths::is_device_name`; the Rust side is the authority and has
// the same cases, so a change to one that is not made to the other shows up as two
// tests disagreeing rather than as a name gEdit accepts and Windows swallows.
describe('isDeviceName', () => {
  it('sees a device whatever the extension', () => {
    // `COM0`/`LPT0` are the deliberate margin `paths::is_device_name` explains.
    for (const device of ['CON', 'PRN', 'AUX', 'NUL', 'COM0', 'COM1', 'COM9', 'LPT0', 'LPT1', 'LPT9']) {
      for (const name of [
        device,
        device.toLowerCase(),
        `${device}.py`,
        // "NUL.tar.gz ... equivalent to NUL": what counts is the first dot.
        `${device}.tar.gz`,
        // Normalization trims the trailing spaces before it matches.
        `${device} .py`,
        `${device}  `,
      ]) {
        expect(isDeviceName(name), name).toBe(true);
      }
    }
  });

  it('leaves the names that only look like one alone', () => {
    for (const name of ['CONSOLE.py', 'COM10.py', 'COM.py', 'NULL.py', 'welle.nc', ' CON.py', 'my.CON', '']) {
      expect(isDeviceName(name), name).toBe(false);
    }
  });
});

describe('plainPath', () => {
  it('drops the `\\\\?\\` of a canonicalized Windows path', () => {
    expect(plainPath('\\\\?\\C:\\nc\\WELLE.NC')).toBe('C:\\nc\\WELLE.NC');
    expect(plainPath('\\\\?\\C:\\')).toBe('C:\\');
    expect(plainPath('\\\\?\\UNC\\nas\\cam\\WELLE.NC')).toBe('\\\\nas\\cam\\WELLE.NC');
  });

  // A bare share root has the two parts the root needs and nothing below them.
  // `parts.length <= root` returned it unchanged while Rust's `plain` folds it, and
  // `pathKey` then keyed one location two ways (G8 M8).
  it('folds a bare share root, as `paths::plain` does', () => {
    expect(plainPath('\\\\?\\UNC\\nas\\cam')).toBe('\\\\nas\\cam');
    expect(plainPath('\\\\?\\UNC\\nas\\cam\\')).toBe('\\\\nas\\cam\\');
    // A server with no share still has no ordinary spelling.
    expect(plainPath('\\\\?\\UNC\\nas')).toBe('\\\\?\\UNC\\nas');
  });

  // Win32's reserved characters, which only an unparsed verbatim path can carry: a
  // share holding `2026-01-05T10:30:00.nc` is that file while the prefix is on, and
  // `\\nas\cam\2026-01-05T10:30:00.nc` asks for an alternate data stream of a file
  // called `2026-01-05T10`. `?` and `*` are not names at all (G8 M8).
  it('keeps the prefix over a name Win32 would not read as a name', () => {
    for (const path of [
      '\\\\?\\UNC\\nas\\cam\\2026-01-05T10:30:00.nc',
      '\\\\?\\C:\\nc\\what?.nc',
      '\\\\?\\C:\\nc\\star*.nc',
      '\\\\?\\C:\\nc\\quote".nc',
      '\\\\?\\C:\\nc\\lt<gt>.nc',
      '\\\\?\\C:\\nc\\pipe|.nc',
      '\\\\?\\C:\\nc\\bell\u0007.nc',
    ]) {
      expect(plainPath(path), path).toBe(path);
    }
  });

  it('leaves alone what has no ordinary spelling', () => {
    for (const path of [
      'C:\\nc\\WELLE.NC',
      '\\\\nas\\cam\\WELLE.NC',
      '\\\\?\\Volume{a5b2}\\nc\\WELLE.NC',
      '/nc/welle.nc',
      'welle.nc',
      // The prefix is the only reason these three are not normalized, so dropping
      // it would name something else.
      '\\\\?\\C:\\nc\\NUL.NC',
      '\\\\?\\C:\\nc\\welle.nc.',
      '\\\\?\\C:\\nc\\welle.nc ',
      '\\\\?\\C:\\nc\\a/b',
    ]) {
      expect(plainPath(path), path).toBe(path);
    }
  });
});
