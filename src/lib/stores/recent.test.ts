// The recent-files mirror (plan §5 WP2.3, §7.3, AD-9).
//
// Rust owns the list, so there is very little here — and that is the point: the store may
// never invent an entry, never reorder one, and never let a failed call break the caller.
// `touch` reads `files.recentLength` per call, which is the one number this side owns.

import { get, writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecentService, type RecentServiceDeps } from './recent';
import { DEFAULTS } from '$lib/core/settings/schema';
import type { RecentEntry } from '$lib/platform/commands';

const A: RecentEntry = { path: '/nc/a.nc', exists: true };
const B: RecentEntry = { path: '/nc/b.nc', exists: true };
const GONE: RecentEntry = { path: '/nc/gone.nc', exists: false };

interface Calls {
  touch: { path: string; max: number }[];
  remove: string[];
  clear: number;
  list: number;
}

function harness(over: Partial<RecentServiceDeps> = {}) {
  const calls: Calls = { touch: [], remove: [], clear: 0, list: 0 };
  let held: RecentEntry[] = [A, B];
  const deps: RecentServiceDeps = {
    list: async () => {
      calls.list++;
      return held;
    },
    touch: async (path, max) => {
      calls.touch.push({ path, max });
      held = [{ path, exists: true }, ...held.filter((e) => e.path !== path)].slice(0, max);
      return held;
    },
    remove: async (path) => {
      calls.remove.push(path);
      held = held.filter((e) => e.path !== path);
      return held;
    },
    clear: async () => {
      calls.clear++;
      held = [];
      return held;
    },
    maxLength: () => 15,
    ...over,
  };
  return { service: createRecentService(deps), calls, held: () => held };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the list', () => {
  it('starts empty and mirrors whatever Rust answers, in order', async () => {
    const h = harness();
    expect(get(h.service.list)).toEqual([]);
    await h.service.refresh();
    expect(get(h.service.list)).toEqual([A, B]);
  });

  it('takes the answer of every call, not just of refresh', async () => {
    const h = harness();
    await h.service.touch('/nc/new.nc');
    expect(get(h.service.list).map((e) => e.path)).toEqual(['/nc/new.nc', '/nc/a.nc', '/nc/b.nc']);
    await h.service.remove('/nc/a.nc');
    expect(get(h.service.list).map((e) => e.path)).toEqual(['/nc/new.nc', '/nc/b.nc']);
    await h.service.clear();
    expect(get(h.service.list)).toEqual([]);
  });

  it('keeps entries that no longer exist, with their flag (the picker offers to remove them)', async () => {
    const h = harness({ list: async () => [GONE, A] });
    await h.service.refresh();
    expect(get(h.service.list)).toEqual([GONE, A]);
  });
});

describe('touch', () => {
  it('passes the cap from files.recentLength', async () => {
    const h = harness({ maxLength: () => 3 });
    await h.service.touch('/nc/x.nc');
    expect(h.calls.touch).toEqual([{ path: '/nc/x.nc', max: 3 }]);
  });

  it('re-reads the setting on every call, so a change takes effect at once', async () => {
    let max = 5;
    const h = harness({ maxLength: () => max });
    await h.service.touch('/nc/x.nc');
    max = 20;
    await h.service.touch('/nc/y.nc');
    expect(h.calls.touch.map((c) => c.max)).toEqual([5, 20]);
  });

  it('clamps a hand-edited cap to the 0-50 of §7.7', async () => {
    for (const [value, expected] of [
      [7.9, 7],
      [999, 50],
    ] as const) {
      const h = harness({ maxLength: () => value });
      await h.service.touch('/nc/x.nc');
      expect(h.calls.touch[0].max).toBe(expected);
    }
    // A cap that clamps to 0 is "off": no call at all (see below).
    for (const value of [-4, 0]) {
      const h = harness({ maxLength: () => value });
      await h.service.touch('/nc/x.nc');
      expect(h.calls.touch).toEqual([]);
    }
  });

  it('falls back to the default when the setting is not a number at all', async () => {
    const h = harness({ maxLength: () => Number.NaN });
    await h.service.touch('/nc/x.nc');
    expect(h.calls.touch[0].max).toBe(DEFAULTS['files.recentLength']);
  });
});

describe('failures', () => {
  it('keeps the last good list and warns rather than throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ touch: () => Promise.reject(new Error('not implemented: WP2.1')) });
    await h.service.refresh();
    await expect(h.service.touch('/nc/x.nc')).resolves.toBeUndefined();
    expect(get(h.service.list)).toEqual([A, B]);
    // A warning, not an error: a console error fails a runtime scenario, and a file that
    // could not be recorded must never take an Open down with it.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('covers every method', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = () => Promise.reject(new Error('nope'));
    const h = harness({ list: boom, touch: boom, remove: boom, clear: boom });
    await h.service.refresh();
    await h.service.touch('/x');
    await h.service.remove('/x');
    await h.service.clear();
    expect(warn).toHaveBeenCalledTimes(4);
    expect(get(h.service.list)).toEqual([]);
  });
});

describe('files.recentLength: 0 is off, not a wipe (B1 A2)', () => {
  it('records nothing and never asks Rust to forget the stored list', async () => {
    const h = harness({ maxLength: () => 0 });
    await h.service.refresh();
    await h.service.touch('/nc/new.nc');
    // Rust would answer a touch with max 0 by truncating to nothing (it used to);
    // the stored list is the owner's to keep, so the call is not even made.
    expect(h.calls.touch).toEqual([]);
    expect(h.held()).toEqual([A, B]);
  });

  it('hides the list while it is 0 and brings the same list back when it is not', async () => {
    const max = writable(15);
    const h = harness({ maxLength: () => get(max), maxLengthStore: max });
    await h.service.refresh();
    expect(get(h.service.list)).toEqual([A, B]);
    max.set(0);
    expect(get(h.service.list)).toEqual([]);
    max.set(10);
    expect(get(h.service.list)).toEqual([A, B]);
  });

  it('hides the list without a store too, by the number read at the time', async () => {
    let max = 15;
    const h = harness({ maxLength: () => max });
    await h.service.refresh();
    max = 0;
    const seen: RecentEntry[][] = [];
    const off = h.service.list.subscribe((value) => seen.push(value));
    off();
    expect(seen).toEqual([[]]);
  });
});

describe('a list that cannot be saved is said so (B1 A2)', () => {
  it('tells once with the detail, again after a call that worked, and keeps the list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const told: { text: string; detail: string }[] = [];
    let failing = true;
    const h = harness({
      touch: async (path) => {
        if (failing) throw new Error('state.json is read-only');
        return [{ path, exists: true }];
      },
      notify: (text, detail) => void told.push({ text, detail }),
    });
    await h.service.refresh();
    await h.service.touch('/nc/x.nc');
    await h.service.touch('/nc/y.nc');
    expect(told).toHaveLength(1);
    expect(told[0].text).toBe('The list of recent files could not be saved.');
    expect(told[0].detail).toBe('state.json is read-only');
    expect(get(h.service.list)).toEqual([A, B]);

    failing = false;
    await h.service.touch('/nc/z.nc');
    failing = true;
    await h.service.touch('/nc/w.nc');
    expect(told).toHaveLength(2);
  });

  it('answers false for a removal or a clear that failed, and re-reads the list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const told: string[] = [];
    let list = 0;
    const h = harness({
      list: async () => {
        list++;
        return [A];
      },
      remove: () => Promise.reject(new Error('read-only')),
      clear: () => Promise.reject(new Error('read-only')),
      notify: (text) => void told.push(text),
    });
    expect(await h.service.remove('/nc/a.nc')).toBe(false);
    expect(await h.service.clear()).toBe(false);
    // One message for both; the mirror was re-read each time.
    expect(told).toHaveLength(1);
    expect(list).toBe(2);
    expect(get(h.service.list)).toEqual([A]);
  });

  it('answers true when it worked', async () => {
    const h = harness();
    await h.service.refresh();
    expect(await h.service.remove('/nc/a.nc')).toBe(true);
    expect(await h.service.clear()).toBe(true);
  });
});
