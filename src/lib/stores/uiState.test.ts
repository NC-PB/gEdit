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
      files: {},
    });
  });

  // M7, AD-22: `ui.files` is the per-file memory. It is a convenience, so a broken
  // entry is dropped rather than repaired — but an entry that is whole is kept whole,
  // unknown members included, because a later milestone writes some (§7.14).
  describe('the per-file memory of ui.files', () => {
    const memo = { line: 12, column: 3, top: 8, bookmarks: [4, 12], at: 1_700_000_000_000 };

    it('keeps a whole memo, its manual choices included', () => {
      const state = sanitizeUiState({
        files: {
          '/nc/a.nc': { ...memo, profileId: 'fanuc-lathe', machineId: 'lathe-2' },
          // An explicit "none" is a different answer from "nothing remembered"
          // (AD-31), so the null has to survive the round trip.
          '/nc/b.nc': { ...memo, machineId: null },
        },
      });
      expect(state.files['/nc/a.nc']).toEqual({ ...memo, profileId: 'fanuc-lathe', machineId: 'lathe-2' });
      expect(state.files['/nc/b.nc']).toEqual({ ...memo, machineId: null });
      expect('machineId' in state.files['/nc/b.nc']).toBe(true);
    });

    it('keeps members it does not know, so a later build does not lose them', () => {
      // M10 writes `channelId` into the same record; a user who runs that build, then
      // this one, then that one again must get the assignment back.
      const state = sanitizeUiState({ files: { '/nc/a.nc': { ...memo, channelId: 'ch2', future: 7 } } });
      expect(state.files['/nc/a.nc']).toEqual({ ...memo, channelId: 'ch2', future: 7 });
    });

    it('drops an entry that is missing what every reader needs', () => {
      const state = sanitizeUiState({
        files: {
          '/nc/no-line.nc': { column: 1, top: 1, bookmarks: [], at: 1 },
          '/nc/zero.nc': { ...memo, line: 0 },
          '/nc/fractional.nc': { ...memo, top: 2.5 },
          '/nc/no-at.nc': { line: 1, column: 1, top: 1, bookmarks: [] },
          '/nc/not-a-record.nc': 'nope',
          '/nc/good.nc': memo,
        },
      });
      expect(Object.keys(state.files)).toEqual(['/nc/good.nc']);
    });

    it('drops bookmark lines that are not lines, and defaults a missing list', () => {
      const state = sanitizeUiState({
        files: {
          '/nc/a.nc': { ...memo, bookmarks: [3, 0, -1, 2.5, 'x', 9] },
          '/nc/b.nc': { ...memo, bookmarks: 'all of them' },
        },
      });
      expect(state.files['/nc/a.nc'].bookmarks).toEqual([3, 9]);
      expect(state.files['/nc/b.nc'].bookmarks).toEqual([]);
    });

    it('cannot be used to reach Object.prototype through a path', () => {
      // A file literally called `__proto__` is silly but legal, and `state.json` is a
      // hand-editable file: a bracket assignment would hand it to the prototype's
      // setter rather than store it (the G8 M2 finding on `lastParams`).
      const raw = JSON.parse(`{"files":{"__proto__":${JSON.stringify(memo)}}}`) as Record<string, unknown>;
      const state = sanitizeUiState(raw);
      expect(Object.getPrototypeOf(state.files)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(state.files, '__proto__')).toBe(true);
      expect(({} as Record<string, unknown>).line).toBeUndefined();
    });

    it('is empty when the member is missing or the wrong type', () => {
      expect(sanitizeUiState({}).files).toEqual({});
      expect(sanitizeUiState({ files: [] }).files).toEqual({});
      expect(sanitizeUiState({ files: 'a' }).files).toEqual({});
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
      {
        layout: {},
        lastParams: { 'transform:nc.renumber': { start: 10, step: 10 } },
        lastScript: null,
        files: {},
      },
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

  // G8 M7. A write that fails used to reach the console and nothing else, on the
  // reasoning that a red status bar after every splitter drag would hide the messages
  // that matter. True — but `state.json` is the one file the session list, the recent
  // list, the layout and the per-file memory share, and Rust refuses the whole of it
  // once it is over 1 MiB, so "nothing gEdit remembers is being remembered" could be
  // true for weeks with nothing on screen to say so. Once, therefore, and once only.
  it('survives a write that fails, and says so exactly once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({
      save: () => Promise.reject('state.json: 1631525 bytes exceed the 1048576 byte limit'),
    });
    h.store.update((s) => ({ ...s, lastScript: 'a' }));
    await expect(h.store.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(h.notices).toHaveLength(1);
    // Rust's own English text is the tooltip, and it names the limit (AD-14).
    expect(h.notices[0].detail).toContain('1048576');

    // The next twenty drags of a splitter say nothing more.
    for (const value of ['b', 'c', 'd', 'e']) {
      h.store.update((s) => ({ ...s, lastScript: value }));
      await expect(h.store.flush()).resolves.toBeUndefined();
    }
    expect(h.notices).toHaveLength(1);
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
