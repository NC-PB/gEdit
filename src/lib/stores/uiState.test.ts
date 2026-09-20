// The `ui` member of `state.json` (plan §5 WP2.3, §7.3, §7.7, AD-8).
//
// Two things have to hold, and neither is visible from the outside: a change reaches the
// disk exactly once per second of activity, and `flush()` — what `files.onWillQuit` awaits
// while the window is closing — leaves nothing behind. A third is what a hand-edited or
// outdated file may do to the running window: nothing.
//
// The clock is `vi.useFakeTimers()`, so the debounce is exercised for real rather than
// through an injected scheduler.

import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Only `loadConfigOnce` reaches the IPC layer; the store itself is driven through `deps`. */
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import {
  createUiStateStore,
  emptyUiState,
  loadConfigOnce,
  resetConfigOnceForTest,
  sanitizeUiState,
  SAVE_DEBOUNCE_MS,
  type UiStateDeps,
} from './uiState';
import { DEFAULT_LAYOUT } from './layout';
import type { UiState, UiStateStore } from '$lib/app/types';

interface Harness {
  store: UiStateStore;
  saved: Record<string, unknown>[];
  notices: { text: string; detail?: string }[];
  deps: UiStateDeps;
}

function harness(over: Partial<UiStateDeps> = {}): Harness {
  const saved: Record<string, unknown>[] = [];
  const notices: { text: string; detail?: string }[] = [];
  const deps: UiStateDeps = {
    load: async () => ({ ui: {}, error: null }),
    save: async (ui) => void saved.push(structuredClone(ui)),
    notify: (text, detail) => void notices.push({ text, detail }),
    debounceMs: SAVE_DEBOUNCE_MS,
    ...over,
  };
  return { store: createUiStateStore(deps), saved, notices, deps };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sanitizeUiState', () => {
  it('turns anything at all into an empty state', () => {
    for (const raw of [undefined, null, 42, 'ui', [], { layout: 7, lastParams: 'x', lastScript: 3 }]) {
      expect(sanitizeUiState(raw)).toEqual(emptyUiState());
    }
  });

  it('keeps the members a saved layout may carry', () => {
    const state = sanitizeUiState({
      layout: {
        left: { visible: false, width: 320, active: 'programMap' },
        bottom: { visible: true, height: 180, active: null },
        overlay: null,
      },
      lastParams: { 'transform:nc.renumber': { start: 10 } },
      lastScript: 'bundled:scale_feed.py',
    });
    expect(state).toEqual({
      layout: {
        left: { visible: false, width: 320, active: 'programMap' },
        bottom: { visible: true, height: 180, active: null },
        overlay: null,
      },
      lastParams: { 'transform:nc.renumber': { start: 10 } },
      lastScript: 'bundled:scale_feed.py',
    });
  });

  it('drops the members whose type is wrong and keeps the rest', () => {
    const state = sanitizeUiState({
      layout: { left: { visible: 'yes', width: 'wide', active: 7 }, bottom: { height: 120 }, overlay: 5 },
      lastParams: { good: { a: 1 }, bad: 'not an object' },
      lastScript: 17,
    });
    expect(state.layout).toEqual({ bottom: { height: 120 } });
    expect(state.lastParams).toEqual({ good: { a: 1 } });
    expect(state.lastScript).toBeNull();
  });

  it('is safe to hand to layout.restore(): a junk width leaves the default alone', () => {
    // `restore` clamps what it is given, so the sanitizer only has to make sure it is
    // never handed a string where a number belongs.
    const { layout } = sanitizeUiState({ layout: { left: { width: 'wide', visible: false } } });
    expect(layout.left).toEqual({ visible: false });
    expect(DEFAULT_LAYOUT.left.width).toBe(260);
  });
});

describe('load', () => {
  it('starts from an empty state and takes what the file holds', async () => {
    const h = harness({
      load: async () => ({ ui: { lastScript: 'user:mine.py' }, error: null }),
    });
    expect(get(h.store.state)).toEqual(emptyUiState());
    await h.store.load();
    expect(get(h.store.state).lastScript).toBe('user:mine.py');
    expect(h.notices).toEqual([]);
  });

  it('reads the file once, however often it is called', async () => {
    const load = vi.fn(async () => ({ ui: {}, error: null }));
    const h = harness({ load });
    await h.store.load();
    await h.store.load();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows a notice for a broken file and still leaves a usable state (AD-8)', async () => {
    const h = harness({ load: async () => ({ ui: {}, error: 'expected value at line 1 column 1' }) });
    await h.store.load();
    expect(get(h.store.state)).toEqual(emptyUiState());
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0].detail).toContain('expected value');
  });

  it('never throws when the command itself fails, and says so only in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ load: () => Promise.reject(new Error('not implemented')) });
    await expect(h.store.load()).resolves.toBeUndefined();
    expect(get(h.store.state)).toEqual(emptyUiState());
    // A backend that is not there is not something the user can act on; AD-8's notice is
    // for a file that could not be parsed. A warning, not an error: a console error fails
    // a runtime scenario.
    expect(h.notices).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('does not undo a change that was made while the read was in flight', async () => {
    let answer: () => void = () => {};
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const h = harness({
      load: async () => {
        await gate;
        return { ui: { lastScript: 'from:disk' }, error: null };
      },
    });
    const loading = h.store.load();
    h.store.setLastParams('script:x', { n: 1 });
    answer();
    await loading;
    expect(get(h.store.state).lastScript).toBeNull();
    expect(get(h.store.state).lastParams).toEqual({ 'script:x': { n: 1 } });
  });
});

describe('the 1 s debounce', () => {
  it('writes once for a burst of changes, a second after the last one', async () => {
    const h = harness();
    for (let width = 200; width < 210; width++) {
      h.store.update((s) => ({ ...s, layout: { ...s.layout, left: { visible: true, width, active: null } } }));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(h.saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(h.saved).toHaveLength(1);
    expect((h.saved[0].layout as { left: { width: number } }).left.width).toBe(209);
  });

  it('writes the whole ui member, so Rust can merge it in one go', async () => {
    const h = harness();
    h.store.setLastParams('transform:nc.renumber', { start: 10, step: 10 });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(h.saved).toEqual([
      { layout: {}, lastParams: { 'transform:nc.renumber': { start: 10, step: 10 } }, lastScript: null },
    ]);
  });

  it('writes again for a change made after the first write', async () => {
    const h = harness();
    h.store.update((s) => ({ ...s, lastScript: 'a' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    h.store.update((s) => ({ ...s, lastScript: 'b' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(h.saved.map((ui) => ui.lastScript)).toEqual(['a', 'b']);
  });

  it('publishes the change at once, whatever the disk is doing', () => {
    const h = harness();
    h.store.update((s) => ({ ...s, lastScript: 'now' }));
    expect(get(h.store.state).lastScript).toBe('now');
    expect(h.saved).toEqual([]);
  });
});

describe('flush', () => {
  it('writes the pending change immediately and cancels the timer', async () => {
    const h = harness();
    h.store.update((s) => ({ ...s, lastScript: 'quitting' }));
    await h.store.flush();
    expect(h.saved).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(h.saved).toHaveLength(1);
  });

  it('writes nothing when nothing changed', async () => {
    const h = harness();
    await h.store.flush();
    await h.store.flush();
    expect(h.saved).toEqual([]);
  });

  it('waits for a write that is already in flight, and never overtakes it', async () => {
    const order: string[] = [];
    let finishFirst: () => void = () => {};
    let call = 0;
    const h = harness({
      save: async () => {
        const n = ++call;
        order.push(`start ${n}`);
        // Only the first write is held open, so the flush has something to wait for.
        if (n === 1) await new Promise<void>((resolve) => (finishFirst = resolve));
        order.push(`end ${n}`);
      },
    });
    h.store.update((s) => ({ ...s, lastScript: 'a' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(order).toEqual(['start 1']);

    h.store.update((s) => ({ ...s, lastScript: 'b' }));
    const flushed = h.store.flush().then(() => order.push('flush returned'));
    finishFirst();
    await vi.advanceTimersByTimeAsync(0);
    await flushed;
    expect(order).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'flush returned']);
  });

  it('survives a write that fails, with a warning and no status notice', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ save: () => Promise.reject(new Error('read-only volume')) });
    h.store.update((s) => ({ ...s, lastScript: 'a' }));
    await expect(h.store.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    // This runs a second after every splitter drag; a red status bar on repeat would hide
    // the messages that matter, and the user loses a remembered layout, not their work.
    expect(h.notices).toEqual([]);

    // And the next change is still written.
    h.store.update((s) => ({ ...s, lastScript: 'b' }));
    await expect(h.store.flush()).resolves.toBeUndefined();
  });
});

describe('getLastParams / setLastParams', () => {
  it('remembers values per form key and leaves the others alone', async () => {
    const h = harness();
    expect(h.store.getLastParams('script:x')).toBeUndefined();
    h.store.setLastParams('script:x', { feed: 100 });
    h.store.setLastParams('transform:y', { start: 1 });
    expect(h.store.getLastParams('script:x')).toEqual({ feed: 100 });
    expect(h.store.getLastParams('transform:y')).toEqual({ start: 1 });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(h.saved).toHaveLength(1);
  });

  it('never answers with something inherited from Object.prototype', () => {
    // G8 M2: `lastParams['__proto__']` used to hand out `Object.prototype` itself, and a
    // `__proto__` member read from `state.json` was swallowed by bracket assignment
    // instead of being stored.
    const h = harness();
    expect(h.store.getLastParams('__proto__')).toBeUndefined();
    expect(h.store.getLastParams('toString')).toBeUndefined();

    h.store.setLastParams('__proto__', { feed: 100 });
    expect(h.store.getLastParams('__proto__')).toEqual({ feed: 100 });
    expect(Object.getPrototypeOf(h.store.getLastParams('__proto__'))).toBe(Object.prototype);
  });

  it('keeps a __proto__ key read from state.json', () => {
    const raw = JSON.parse('{"lastParams":{"__proto__":{"feed":100}}}') as Record<string, unknown>;
    const state = sanitizeUiState(raw);
    expect(Object.prototype.hasOwnProperty.call(state.lastParams, '__proto__')).toBe(true);
    expect(JSON.stringify(state.lastParams)).toBe('{"__proto__":{"feed":100}}');
  });

  it('replaces the values of a key rather than merging them', () => {
    const h = harness();
    h.store.setLastParams('script:x', { feed: 100, speed: 2 });
    h.store.setLastParams('script:x', { feed: 200 });
    expect(h.store.getLastParams('script:x')).toEqual({ feed: 200 });
  });
});

describe('the state store', () => {
  it('publishes every change to its subscribers', () => {
    const h = harness();
    const seen: UiState[] = [];
    const stop = h.store.state.subscribe((s) => seen.push(s));
    h.store.update((s) => ({ ...s, lastScript: 'one' }));
    h.store.update((s) => ({ ...s, lastScript: 'two' }));
    stop();
    expect(seen.map((s) => s.lastScript)).toEqual([null, 'one', 'two']);
  });
});

describe('loadConfigOnce', () => {
  it('makes exactly one `config_load` round trip, however many callers there are', async () => {
    // WP2.6's settings store and this one both need `config_load`; AD-8 allows one call
    // at startup, so whichever gets there first pays for it and the other waits.
    const answer = {
      settings: {},
      settingsError: null,
      ui: { lastScript: 'bundled:a.py' },
      stateError: null,
      paths: {
        configDir: '/cfg',
        dataDir: '/data',
        settingsFile: '/cfg/settings.json',
        stateFile: '/data/state.json',
        userScriptsDir: '/cfg/scripts',
      },
    };
    invoke.mockResolvedValue(answer);
    resetConfigOnceForTest();
    const [a, b] = await Promise.all([loadConfigOnce(), loadConfigOnce()]);
    expect(invoke.mock.calls).toEqual([['config_load']]);
    expect(a).toBe(answer);
    expect(b).toBe(answer);
    resetConfigOnceForTest();
    invoke.mockReset();
  });
});
