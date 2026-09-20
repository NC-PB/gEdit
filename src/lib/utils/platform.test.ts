// Platform helpers. `isMacPlatform` decides which half of a `{ mac, other }` KeySpec
// applies, so it is worth pinning against both a real webview and a bare environment.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseName, isMacPlatform, isTauriRuntime } from './platform';

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
