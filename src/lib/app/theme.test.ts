// Light, dark and "follow the system" (plan §7.3, WP2.6). The controller is tested with
// fakes for the three things it drives, so no DOM and no webview are needed.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createTheme, type MediaQueryLike, type ResolvedTheme, type ThemeDeps } from './theme';

class FakeMedia implements MediaQueryLike {
  matches: boolean;
  listeners = new Set<(event: { matches: boolean }) => void>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: 'change', listener: (event: { matches: boolean }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: (event: { matches: boolean }) => void): void {
    this.listeners.delete(listener);
  }

  /** What the OS does when the user switches appearance. */
  change(matches: boolean): void {
    this.matches = matches;
    for (const listener of [...this.listeners]) listener({ matches });
  }
}

function harness(o: { systemDark?: boolean; noMedia?: boolean } = {}) {
  const media = new FakeMedia(o.systemDark ?? true);
  const dataTheme: ResolvedTheme[] = [];
  const monaco: ResolvedTheme[] = [];
  const windowTheme: (ResolvedTheme | null)[] = [];
  const deps: ThemeDeps = {
    darkMedia: () => (o.noMedia ? null : media),
    setDataTheme: (mode) => dataTheme.push(mode),
    setMonacoTheme: (mode) => monaco.push(mode),
    setWindowTheme: (mode) => windowTheme.push(mode),
  };
  return { media, dataTheme, monaco, windowTheme, theme: createTheme(deps) };
}

describe('createTheme', () => {
  it('starts in "system" mode and answers with what the system says', () => {
    const h = harness({ systemDark: true });
    expect(h.theme.mode()).toBe('system');
    expect(get(h.theme.effectiveTheme)).toBe('dark');
    // Reading the store applies nothing: `applyTheme` is still the only writer.
    expect(h.dataTheme).toEqual([]);
    expect(h.monaco).toEqual([]);

    expect(get(harness({ systemDark: false }).theme.effectiveTheme)).toBe('light');
    expect(get(harness({ noMedia: true }).theme.effectiveTheme)).toBe('dark');
  });

  it('applies a fixed choice to the document, Monaco and the window', () => {
    const h = harness();
    h.theme.applyTheme('light');
    expect(h.dataTheme).toEqual(['light']);
    expect(h.monaco).toEqual(['light']);
    expect(h.windowTheme).toEqual(['light']);
    expect(get(h.theme.effectiveTheme)).toBe('light');
    expect(h.theme.mode()).toBe('light');
  });

  it('tells the native window to follow the system for "system"', () => {
    const h = harness({ systemDark: false });
    h.theme.applyTheme('system');
    expect(h.windowTheme).toEqual([null]);
    expect(h.dataTheme).toEqual(['light']);
    expect(get(h.theme.effectiveTheme)).toBe('light');
  });

  it('resolves "system" from matchMedia', () => {
    const dark = harness({ systemDark: true });
    dark.theme.applyTheme('system');
    expect(get(dark.theme.effectiveTheme)).toBe('dark');

    const light = harness({ systemDark: false });
    light.theme.applyTheme('system');
    expect(get(light.theme.effectiveTheme)).toBe('light');
  });

  it('follows a system change while "system" is selected', () => {
    const h = harness({ systemDark: true });
    h.theme.applyTheme('system');
    h.media.change(false);
    expect(h.dataTheme).toEqual(['dark', 'light']);
    expect(h.monaco).toEqual(['dark', 'light']);
    expect(get(h.theme.effectiveTheme)).toBe('light');
    // The window already follows the system; it is not told again.
    expect(h.windowTheme).toEqual([null]);
  });

  it('ignores the system once a fixed theme is chosen', () => {
    const h = harness({ systemDark: true });
    h.theme.applyTheme('system');
    h.theme.applyTheme('dark');
    h.media.change(false);
    expect(get(h.theme.effectiveTheme)).toBe('dark');
    expect(h.media.listeners.size).toBe(0);
  });

  it('listens again when "system" comes back', () => {
    const h = harness({ systemDark: true });
    h.theme.applyTheme('light');
    expect(h.media.listeners.size).toBe(0);
    h.theme.applyTheme('system');
    expect(h.media.listeners.size).toBe(1);
    h.media.change(false);
    expect(get(h.theme.effectiveTheme)).toBe('light');
  });

  it('does no work when the resolved theme does not change', () => {
    const h = harness({ systemDark: true });
    h.theme.applyTheme('system');
    h.theme.applyTheme('dark');
    // Same palette, different choice: the document and Monaco are left alone, the
    // window is told because the *choice* is no longer "follow the system".
    expect(h.dataTheme).toEqual(['dark']);
    expect(h.monaco).toEqual(['dark']);
    expect(h.windowTheme).toEqual([null, 'dark']);
  });

  it('applying the same choice twice changes nothing', () => {
    const h = harness();
    h.theme.applyTheme('light');
    h.theme.applyTheme('light');
    expect(h.dataTheme).toEqual(['light']);
    expect(h.windowTheme).toEqual(['light']);
  });

  it('falls back to dark where matchMedia is missing', () => {
    const h = harness({ noMedia: true });
    h.theme.applyTheme('system');
    expect(h.dataTheme).toEqual(['dark']);
    expect(get(h.theme.effectiveTheme)).toBe('dark');
  });

  it('drops the system listener when it is disposed', () => {
    const h = harness();
    h.theme.applyTheme('system');
    expect(h.media.listeners.size).toBe(1);
    h.theme.dispose();
    expect(h.media.listeners.size).toBe(0);
  });
});
