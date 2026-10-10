// Session restore and per-file memory (plan §7.9, AD-22). Owner: WP7.5.
//
// Both halves are driven over fakes (AD-2) but against the **real** per-file memory
// store, because the pair is where the interesting failures live: a tracker that writes
// a memo nobody asked for, and a store that then hands it back, look fine one at a time.
//
// The cases that would cost the owner something if they broke:
//
//   - `start()` overwriting a stored session with an empty list at startup;
//   - a restore reopening a program that was deleted, or putting up one dialog per file;
//   - the memo of a tab that was opened in the background and closed unvisited being
//     replaced with "line 1, no bookmarks";
//   - a memo being dropped because Monaco was not up yet when it was meant to be applied.

import { get, writable, type Readable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileTracker, createSessionService, snapshotOf, statSessionPaths } from './session';
import { createFileMemory } from '$lib/stores/fileMemory';
import { t } from '$lib/i18n';
import type { Disposable, DocId, FileMemo, FileMemoryStore } from '$lib/app/types';
import type { FileStat, SessionState } from '$lib/platform/commands';

// Only `statSessionPaths` reaches Tauri, through the real `filesStat` wrapper.
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

interface FakeDoc {
  id: DocId;
  path: string | null;
}

// ---------------------------------------------------------------------------
// Which files were open
// ---------------------------------------------------------------------------

interface SessionHarness {
  session: ReturnType<typeof createSessionService>;
  docs: FakeDoc[];
  setDocs(docs: FakeDoc[], active?: DocId | null): void;
  /** Every `session_save` payload, oldest first. */
  saved: { paths: string[]; active: number | null }[];
  /** Every path list handed to `files.open`. */
  openedWith: string[][];
  /** The options each of those calls carried (`activate`, `index`). */
  openOptions: ({ activate?: boolean; index?: number } | undefined)[];
  /** When set, `files.open` waits for it first: a tail that is still loading. */
  holdOpen: ((paths: string[]) => Promise<void>) | null;
  /** Paths `files.open` refuses (a file that cannot be read after all). */
  refuseOpen: Set<string>;
  /** Documents that were activated after a restore. */
  activated: DocId[];
  notes: string[];
  /** The same notices with their options, for the ones that are errors. */
  noticed: { text: string; error: boolean; detail?: string }[];
  /** The one status message on screen: `files.open` puts its summary there. */
  shown: { text: string; error: boolean; detail?: string } | null;
  stored: SessionState;
  /** Paths `files_stat` reports as a readable file. */
  onDisk: Set<string>;
  quit(): Promise<void>;
  failLoad: boolean;
  failStat: boolean;
  /** The detail of the summary the fake `files.open` shows. */
  openDetail: string | undefined;
  /** Replaces the fake `files_stat` when set. */
  statWith: ((paths: string[]) => Promise<{ allowed: boolean; exists: boolean; isDir: boolean }[]>) | null;
  /** The message `session_save` rejects with, or null when it works. */
  failSave: string | null;
  restoreEnabled: boolean;
  /** The active-document store behind `activeId`, to read what is in front. */
  activeStore: Readable<DocId | null>;
}

function sessionHarness(o: { docs?: FakeDoc[]; active?: DocId | null } = {}): SessionHarness {
  const list = writable<FakeDoc[]>(o.docs ?? []);
  const activeId = writable<DocId | null>(o.active ?? null);
  const quitHandlers = new Set<() => Promise<void> | void>();
  let nextDoc = 0;

  const state: SessionHarness = {
    session: undefined as unknown as ReturnType<typeof createSessionService>,
    get docs() {
      return get(list);
    },
    setDocs(docs, active) {
      list.set(docs);
      if (active !== undefined) activeId.set(active);
    },
    saved: [],
    openedWith: [],
    openOptions: [],
    holdOpen: null,
    refuseOpen: new Set<string>(),
    activated: [],
    notes: [],
    noticed: [],
    shown: null,
    stored: { paths: [], active: null },
    onDisk: new Set<string>(),
    quit: async () => {
      for (const handler of [...quitHandlers]) await handler();
    },
    failLoad: false,
    failStat: false,
    statWith: null,
    openDetail: undefined,
    failSave: null,
    restoreEnabled: true,
    activeStore: activeId,
  };

  state.session = createSessionService({
    docs: {
      list,
      activeId,
      all: () => get(list),
      getActiveId: () => get(activeId),
      byPath: (path) => get(list).find((doc) => doc.path === path),
    },
    save: async (paths, active) => {
      state.saved.push({ paths, active });
      if (state.failSave !== null) throw state.failSave;
    },
    load: async () => {
      if (state.failLoad) throw new Error('state.json is unreadable');
      return state.stored;
    },
    stat: async (paths) => {
      if (state.statWith !== null) return state.statWith(paths);
      if (state.failStat) throw new Error('files_stat failed');
      return paths.map((path) => ({
        allowed: state.onDisk.has(path),
        exists: state.onDisk.has(path),
        isDir: false,
      }));
    },
    open: async (paths, o) => {
      state.openedWith.push(paths);
      state.openOptions.push(o);
      if (state.holdOpen !== null) await state.holdOpen(paths);
      const opened = paths
        .filter((path) => !state.refuseOpen.has(path))
        .map((path) => ({ id: `r${nextDoc++}`, path }));
      // Like the real one: the untouched untitled tab goes, the new tabs land at `index`
      // (the first one there, the next after it) or at the end.
      const base = get(list).filter((doc) => doc.path !== null);
      const at = Math.min(Math.max(o?.index ?? base.length, 0), base.length);
      list.set([...base.slice(0, at), ...opened, ...base.slice(at)]);
      if (o?.activate !== false) {
        activeId.set(opened.at(-1)?.id ?? null);
        // What the real `files.open` does last: its summary replaces whatever was shown.
        state.shown = { text: `Opened ${opened.length} files`, error: false, detail: state.openDetail };
      }
      return opened.map((doc) => doc.id);
    },
    activate: (id) => {
      state.activated.push(id);
      activeId.set(id);
    },
    onWillQuit: (cb) => {
      quitHandlers.add(cb);
      return () => quitHandlers.delete(cb);
    },
    notify: (text, o) => {
      state.notes.push(text);
      state.noticed.push({ text, error: o?.error === true, detail: o?.detail });
      state.shown = { text, error: o?.error === true, detail: o?.detail };
    },
    shown: () => state.shown,
    restoreEnabled: () => state.restoreEnabled,
    debounceMs: 1000,
  });
  return state;
}

describe('the stored session', () => {
  it('lists the files in tab order and points at the active one', () => {
    const docs: FakeDoc[] = [
      { id: 'a', path: '/a.nc' },
      { id: 'u', path: null },
      { id: 'b', path: '/b.nc' },
    ];
    expect(snapshotOf(docs, 'b')).toEqual({ paths: ['/a.nc', '/b.nc'], active: 1 });
    // An untitled document in front is not an index into `paths`.
    expect(snapshotOf(docs, 'u')).toEqual({ paths: ['/a.nc', '/b.nc'], active: null });
    expect(snapshotOf([{ id: 'u', path: null }], 'u')).toEqual({ paths: [], active: null });
  });
});

describe('writing the session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes nothing for the state it started with', async () => {
    // The one that matters: a window that comes up with a single untitled document must
    // not replace the stored session with an empty list before the user did anything.
    const h = sessionHarness({ docs: [{ id: 'u', path: null }], active: 'u' });
    const stop = h.session.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.saved).toEqual([]);
    stop();
  });

  it('writes once, a second after the last change', async () => {
    const h = sessionHarness({ docs: [{ id: 'u', path: null }], active: 'u' });
    const stop = h.session.start();

    h.setDocs([{ id: 'a', path: '/a.nc' }], 'a');
    await vi.advanceTimersByTimeAsync(900);
    expect(h.saved).toEqual([]);

    // Ten closes are ten events and one session.
    h.setDocs(
      [
        { id: 'a', path: '/a.nc' },
        { id: 'b', path: '/b.nc' },
      ],
      'b',
    );
    h.setDocs([{ id: 'b', path: '/b.nc' }], 'b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.saved).toEqual([{ paths: ['/b.nc'], active: 0 }]);
    stop();
  });

  it('writes what is open when the write happens, not when it was scheduled', async () => {
    const h = sessionHarness({ docs: [], active: null });
    const stop = h.session.start();
    h.setDocs([{ id: 'a', path: '/a.nc' }], 'a');
    h.setDocs(
      [
        { id: 'a', path: '/a.nc' },
        { id: 'b', path: '/b.nc' },
      ],
      'a',
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.saved).toEqual([{ paths: ['/a.nc', '/b.nc'], active: 0 }]);
    stop();
  });

  it('flushes the pending list before the app quits', async () => {
    const h = sessionHarness({ docs: [], active: null });
    const stop = h.session.start();
    h.setDocs([{ id: 'a', path: '/a.nc' }], 'a');
    await h.quit();
    expect(h.saved).toEqual([{ paths: ['/a.nc'], active: 0 }]);
    // And the timer that was pending does not write a second time.
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.saved).toHaveLength(1);
    stop();
  });

  it('stops following once it is disposed', async () => {
    const h = sessionHarness({ docs: [], active: null });
    h.session.start()();
    h.setDocs([{ id: 'a', path: '/a.nc' }], 'a');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.saved).toEqual([]);
  });
});

describe('restoring the session', () => {
  it('does nothing while the setting is off', async () => {
    const h = sessionHarness();
    h.restoreEnabled = false;
    h.stored = { paths: ['/a.nc'], active: 0 };
    h.onDisk.add('/a.nc');
    expect(await h.session.restore()).toBe(0);
    expect(h.openedWith).toEqual([]);
  });

  it('reopens the files in order and fronts the one that was in front', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc', '/c.nc'], active: 1 };
    for (const path of h.stored.paths) h.onDisk.add(path);

    expect(await h.session.restore()).toBe(3);
    await h.session.settled();
    // The tab that was in front goes up first and alone, the others behind it.
    expect(h.openedWith).toEqual([['/b.nc'], ['/a.nc'], ['/c.nc']]);
    expect(h.activated).toEqual(['r0']);
    expect(h.docs.map((doc) => doc.path)).toEqual(['/a.nc', '/b.nc', '/c.nc']);
    // And it is still the one in front: the tail does not take the focus.
    expect(get(h.activeStore)).toBe('r0');
    expect(h.notes).toEqual([]);
  });

  it('puts the tail back at the tab positions it had, whichever tab was in front', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc', '/c.nc', '/d.nc', '/e.nc'], active: 2 };
    for (const path of h.stored.paths) h.onDisk.add(path);

    await h.session.restore();
    await h.session.settled();

    expect(h.openedWith).toEqual([['/c.nc'], ['/a.nc', '/b.nc'], ['/d.nc', '/e.nc']]);
    // Behind the front tab, not on top of it: the head goes in at 0, the rest after it.
    expect(h.openOptions[1]).toEqual({ activate: false, index: 0 });
    expect(h.openOptions[2]).toEqual({ activate: false, index: 3 });
    expect(h.docs.map((doc) => doc.path)).toEqual(['/a.nc', '/b.nc', '/c.nc', '/d.nc', '/e.nc']);
    expect(get(h.activeStore)).toBe('r0');
  });

  it('opens the first file that comes back first when the one that was in front is gone', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc', '/gone.nc'], active: 2 };
    h.onDisk.add('/a.nc');
    h.onDisk.add('/b.nc');

    await h.session.restore();
    await h.session.settled();

    expect(h.openedWith).toEqual([['/a.nc'], ['/b.nc']]);
    expect(h.docs.map((doc) => doc.path)).toEqual(['/a.nc', '/b.nc']);
  });

  it('goes on to the next file when the one meant for the front cannot be opened', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/bad.nc', '/c.nc'], active: 1 };
    for (const path of h.stored.paths) h.onDisk.add(path);
    h.refuseOpen.add('/bad.nc');

    await h.session.restore();
    await h.session.settled();

    expect(h.openedWith).toEqual([['/bad.nc'], ['/a.nc'], ['/c.nc']]);
    expect(h.docs.map((doc) => doc.path)).toEqual(['/a.nc', '/c.nc']);
    expect(h.activated).toEqual(['r0']);
  });

  it('skips the files that are gone, with one message and no dialog', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/gone.nc', '/a.nc', '/also-gone.nc'], active: 1 };
    h.onDisk.add('/a.nc');

    expect(await h.session.restore()).toBe(1);
    expect(h.openedWith).toEqual([['/a.nc']]);
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]).toContain('2 files');
  });

  it('joins the missing-files notice onto the summary files.open leaves on screen', async () => {
    // There is one status message, and `files.open` shows "Opened N files" last: said
    // before it, the notice was replaced before anyone could read it.
    const h = sessionHarness();
    h.stored = { paths: ['/net/gone.nc', '/a.nc', '/b.nc'], active: 1 };
    h.onDisk.add('/a.nc');
    h.onDisk.add('/b.nc');

    expect(await h.session.restore()).toBe(2);
    // The tab in front is up and said so; the missing-files notice is joined onto that.
    expect(h.shown?.text).toContain('Opened 1 files');
    expect(h.shown?.text).toContain('1 file from the last session');
    // The tooltip names the file that was skipped.
    expect(h.shown?.detail).toBe('/net/gone.nc');
  });

  it('leaves the scratch tab to the first open and does not shout about the tail', async () => {
    // The pristine untitled document is dropped by `files.open` itself, and only when
    // something took its place (`fileOps.test.ts`): that is the call for the tab in front.
    // The tail is added behind it with `activate: false` — no summary, no focus.
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc'], active: 0 };
    for (const path of h.stored.paths) h.onDisk.add(path);
    await h.session.restore();
    await h.session.settled();
    expect(h.openedWith).toEqual([['/a.nc'], ['/b.nc']]);
    expect(h.openOptions[0]).toBeUndefined();
    expect(h.openOptions[1]).toEqual({ activate: false, index: 1 });
    expect(h.shown?.text).toBe('Opened 1 files');
  });

  it('fronts the first file back when the one that was in front is gone', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/gone.nc'], active: 1 };
    h.onDisk.add('/a.nc');

    expect(await h.session.restore()).toBe(1);
    expect(h.activated).toEqual(['r0']);
  });

  it('opens nothing when every file is gone', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/gone.nc'], active: 0 };
    expect(await h.session.restore()).toBe(0);
    expect(h.openedWith).toEqual([]);
    expect(h.notes).toHaveLength(1);
  });

  it('opens nothing when the state or the files could not be read', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc'], active: 0 };
    h.onDisk.add('/a.nc');

    h.failLoad = true;
    expect(await h.session.restore()).toBe(0);
    h.failLoad = false;

    h.failStat = true;
    // The stored list stays on disk and the next start tries again — better than a
    // stack of "could not be opened" boxes over an empty editor.
    expect(await h.session.restore()).toBe(0);
    expect(h.openedWith).toEqual([]);
  });
});

/**
 * Review: the notice about skipped files, when the share behind them
 * hangs, and when something else is on screen already.
 */
describe('the missing-files notice', () => {
  const hung = (path: string): FileStat => ({
    path,
    allowed: false,
    exists: false,
    isDir: false,
    mtimeMs: null,
    size: null,
    readonly: false,
    unavailable: true,
  });

  it('names the files when every one is on a share that hangs', async () => {
    // Rust answers `unavailable` for each, and the plain wrapper rejects when nothing
    // answered — so the restore opened nothing and said nothing.
    invoke.mockImplementation(async (_cmd: string, args: { paths: string[] }) => args.paths.map(hung));
    const h = sessionHarness();
    h.stored = { paths: ['/Volumes/dnc/a.nc', '/Volumes/dnc/b.nc'], active: 0 };
    h.statWith = (paths) => statSessionPaths(paths);

    expect(await h.session.restore()).toBe(0);

    expect(invoke).toHaveBeenCalledWith('files_stat', { paths: h.stored.paths });
    expect(h.openedWith).toEqual([]);
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]).toBe(t('session.missing', { count: 2 }));
    expect(h.shown?.detail).toBe('/Volumes/dnc/a.nc\n/Volumes/dnc/b.nc');
    invoke.mockReset();
  });

  it('is not joined onto an older, unrelated message', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/net/gone.nc'], active: 0 };
    h.shown = { text: 'settings.json has errors', error: true, detail: 'line 3: bad value' };

    await h.session.restore();

    expect(h.noticed).toEqual([
      { text: t('session.missing', { count: 1 }), error: false, detail: '/net/gone.nc' },
    ]);
  });

  it('keeps the file names in the tooltip when the summary has a detail of its own', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/net/gone.nc', '/a.nc'], active: 0 };
    h.onDisk.add('/a.nc');
    h.openDetail = 'a.nc: something files.open had to say';

    await h.session.restore();

    expect(h.shown?.text).toContain('Opened 1 files');
    expect(h.shown?.detail).toBe('a.nc: something files.open had to say\n/net/gone.nc');
  });
});

/**
 * B1 A1. The tail of a restore loads in the background, and a session written meanwhile
 * must not be the half that is open: a crash or a quit in the middle would otherwise
 * store three tabs of fifty.
 */
describe('a restore whose tail is still loading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers when the tab in front is up, not when the last one is', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc', '/c.nc'], active: 0 };
    for (const path of h.stored.paths) h.onDisk.add(path);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.holdOpen = async (paths) => {
      if (paths[0] !== '/a.nc') await gate;
    };

    expect(await h.session.restore()).toBe(3);
    expect(h.docs.map((doc) => doc.path)).toEqual(['/a.nc']);
    expect(get(h.activeStore)).toBe('r0');
    release();
    await h.session.settled();
    expect(h.docs.map((doc) => doc.path)).toEqual(['/a.nc', '/b.nc', '/c.nc']);
  });

  it('keeps the paths that are still to come in every write', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc', '/c.nc', '/d.nc'], active: 1 };
    for (const path of h.stored.paths) h.onDisk.add(path);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.holdOpen = async (paths) => {
      if (paths[0] !== '/b.nc') await gate;
    };

    await h.session.restore();
    const stop = h.session.start();
    // The user does something while the tail loads: it is a write of the session.
    h.setDocs([...h.docs], 'r0');
    h.setDocs([...h.docs, { id: 'x', path: '/mine.nc' }], 'r0');
    await vi.advanceTimersByTimeAsync(1100);

    // The stored order, with the user's tab where the tab bar will have it (B1 CODE-05).
    const during = h.saved.at(-1);
    expect(during?.paths).toEqual(['/a.nc', '/b.nc', '/c.nc', '/d.nc', '/mine.nc']);
    expect(during?.paths[during.active ?? -1]).toBe('/b.nc');

    release();
    await h.session.settled();
    await vi.advanceTimersByTimeAsync(1100);

    const after = h.saved.at(-1);
    expect(after?.paths).toEqual(['/a.nc', '/b.nc', '/c.nc', '/d.nc', '/mine.nc']);
    // The tab in front is still the one the stored index points at.
    expect(after?.paths[after.active ?? -1]).toBe('/b.nc');
    stop();
  });

  // B1 CODE-05. Five stored tabs `a b c d e`, `c` in front; the user opens one file while
  // the tail loads. The write used to be `c, mine, a, b, d, e` (the open tabs first, the
  // pending ones after), and a quit or crash then stored that order for good.
  it('writes the stored order while the tail loads, whatever the user does meanwhile', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc', '/c.nc', '/d.nc', '/e.nc'], active: 2 };
    for (const path of h.stored.paths) h.onDisk.add(path);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.holdOpen = async (paths) => {
      if (paths[0] !== '/c.nc') await gate;
    };

    await h.session.restore();
    const stop = h.session.start();
    h.setDocs([...h.docs, { id: 'x', path: '/mine.nc' }], 'r0');
    await h.quit();

    const written = h.saved.at(-1);
    // The user's tab stands behind the tab in front, where the tail's `d e` will go in
    // front of it: the tab bar ends up `a b c d e mine`, and so does the stored list.
    expect(written?.paths).toEqual(['/a.nc', '/b.nc', '/c.nc', '/d.nc', '/e.nc', '/mine.nc']);
    expect(written?.paths[written.active ?? -1]).toBe('/c.nc');

    release();
    await h.session.settled();
    expect(h.docs.map((doc) => doc.path)).toEqual(written?.paths);
    stop();
  });

  it('keeps the stored order when the user switches or closes tabs during the tail', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc', '/c.nc', '/d.nc'], active: 1 };
    for (const path of h.stored.paths) h.onDisk.add(path);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.holdOpen = async (paths) => {
      if (paths[0] !== '/b.nc') await gate;
    };

    await h.session.restore();
    const stop = h.session.start();
    // The tab in front is closed and a different file takes its place.
    h.setDocs([{ id: 'x', path: '/mine.nc' }], 'x');
    await h.quit();

    const written = h.saved.at(-1);
    // The pending paths keep their stored order whatever else is open; with the front tab
    // gone the tail appends what comes after it, and so does the stored list.
    expect(written?.paths).toEqual(['/a.nc', '/mine.nc', '/c.nc', '/d.nc']);
    expect(written?.paths[written.active ?? -1]).toBe('/mine.nc');
    release();
    await h.session.settled();
    stop();
  });

  it('stops carrying a path that never opened once the tail is done', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/bad.nc'], active: 0 };
    for (const path of h.stored.paths) h.onDisk.add(path);
    h.refuseOpen.add('/bad.nc');

    await h.session.restore();
    await h.session.settled();
    const stop = h.session.start();
    h.setDocs([...h.docs, { id: 'x', path: '/mine.nc' }], 'r0');
    await vi.advanceTimersByTimeAsync(1100);

    expect(h.saved.at(-1)?.paths).toEqual(['/a.nc', '/mine.nc']);
    stop();
  });
});

/**
 * G8 M7. `restore()` dropped every path it could not reach and `start()` then seeded
 * itself from the documents that were open — which, after a restore that reached
 * nothing, is the empty window. The first file the user opened by hand became the whole
 * stored session, and the programs that were merely offline were gone for good.
 */
describe('a restore that could not reach its files', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Opens `path` by hand and lets the debounce run out. */
  async function openByHand(h: SessionHarness, path: string): Promise<void> {
    h.setDocs([{ id: 'x', path }], 'x');
    await vi.advanceTimersByTimeAsync(1100);
  }

  it('keeps the whole list when a share mounts after login', async () => {
    const h = sessionHarness();
    const share = Array.from({ length: 10 }, (_, n) => `/Volumes/cnc/job-${n}.nc`);
    h.stored = { paths: share, active: 3 };
    // Nothing is mounted yet: every path answers allowed:false / exists:false.
    expect(await h.session.restore()).toBe(0);
    expect(h.notes).toHaveLength(1);

    const stop = h.session.start();
    await openByHand(h, '/local/scratch.nc');

    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toEqual({ paths: ['/local/scratch.nc', ...share], active: 0 });
    stop();
  });

  it('keeps the files that were only briefly offline', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/net/b.nc', '/c.nc', '/net/d.nc'], active: 0 };
    h.onDisk.add('/a.nc');
    h.onDisk.add('/c.nc');

    expect(await h.session.restore()).toBe(2);
    await h.session.settled();
    const stop = h.session.start();

    // One more tab, opened by hand after the restore.
    h.setDocs([...h.docs, { id: 'x', path: '/e.nc' }], 'x');
    await vi.advanceTimersByTimeAsync(1100);

    expect(h.saved.at(-1)?.paths).toEqual(['/a.nc', '/c.nc', '/e.nc', '/net/b.nc', '/net/d.nc']);
    stop();
  });

  it('keeps the whole list when files_stat itself fails', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/a.nc', '/b.nc'], active: 0 };
    h.onDisk.add('/a.nc');
    h.failStat = true;

    expect(await h.session.restore()).toBe(0);
    const stop = h.session.start();
    await openByHand(h, '/local/scratch.nc');

    expect(h.saved.at(-1)?.paths).toEqual(['/local/scratch.nc', '/a.nc', '/b.nc']);
    stop();
  });

  it('lets go of a skipped file once it is open again, so closing its tab removes it', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/net/b.nc', '/net/c.nc'], active: 0 };
    expect(await h.session.restore()).toBe(0);

    const stop = h.session.start();
    // The share is back and the user opens one of the skipped files, then closes it.
    await openByHand(h, '/net/b.nc');
    expect(h.saved.at(-1)?.paths).toEqual(['/net/b.nc', '/net/c.nc']);
    h.setDocs([], null);
    await vi.advanceTimersByTimeAsync(1100);

    // `/net/b.nc` was closed on purpose; `/net/c.nc` is still waiting for its share.
    expect(h.saved.at(-1)?.paths).toEqual(['/net/c.nc']);
    stop();
  });

  it('does not list a file twice once it is reachable again', async () => {
    const h = sessionHarness();
    h.stored = { paths: ['/net/b.nc'], active: 0 };
    expect(await h.session.restore()).toBe(0);

    const stop = h.session.start();
    // The share comes back and the user opens the very file that was skipped.
    await openByHand(h, '/net/b.nc');

    expect(h.saved.at(-1)?.paths).toEqual(['/net/b.nc']);
    stop();
  });
});

// ---------------------------------------------------------------------------
// Where you were in each file
// ---------------------------------------------------------------------------

interface TrackerHarness {
  stop: Disposable;
  memory: FileMemoryStore;
  files: Record<string, FileMemo>;
  docs: FakeDoc[];
  /** Where the cursor is in the document on screen. */
  at: { line: number; column: number; top: number };
  marks: Map<DocId, number[]>;
  /** Documents the editor has a model for; empty before Monaco flushes the pending ones. */
  models: Set<DocId>;
  /** What `bookmarks.set` was handed, per document. */
  restoredMarks: { id: DocId; lines: number[] }[];
  /** What `reveal` was handed, per document. */
  restoredAt: { id: DocId; line: number; column: number; top: number }[];
  /** False while Monaco is not up: `reveal` and `set` would silently do nothing. */
  editorUp: boolean;
  flushes: number;
  add(doc: FakeDoc): void;
  activate(id: DocId | null): void;
  open(id: DocId, path: string): void;
  createModel(id: DocId): void;
  moveCursor(line: number, column?: number, top?: number): void;
  close(id: DocId): void;
  quit(): Promise<void>;
  /** Resolves the editor-ready promise the tracker waits on. */
  becomeReady(): Promise<void>;
  /** `files.rememberPerFile`, so a session that toggles it can be played out. */
  setEnabled(value: boolean): void;
}

function trackerHarness(
  o: { files?: Record<string, FileMemo>; ready?: boolean; enabled?: boolean } = {},
): TrackerHarness {
  let enabled = o.enabled ?? true;
  const list = writable<FakeDoc[]>([]);
  const activeId = writable<DocId | null>(null);
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const cursorListeners: (() => void)[] = [];
  const modelListeners: ((id: DocId) => void)[] = [];
  const openListeners: ((id: DocId, path: string) => void)[] = [];
  const closeListeners: ((id: DocId) => void)[] = [];
  const quitHandlers: (() => Promise<void> | void)[] = [];

  const state: TrackerHarness = {
    stop: () => {},
    memory: undefined as unknown as FileMemoryStore,
    files: o.files ?? {},
    get docs() {
      return get(list);
    },
    at: { line: 1, column: 1, top: 1 },
    marks: new Map<DocId, number[]>(),
    models: new Set<DocId>(),
    restoredMarks: [],
    restoredAt: [],
    editorUp: o.ready ?? true,
    flushes: 0,
    add: (doc) => {
      list.update((all) => [...all, doc]);
      // `fileOps` creates the model before it activates and fires; while Monaco is down
      // the model is only pending, which is what `editorUp` stands for here.
      if (state.editorUp) state.models.add(doc.id);
      activeId.set(doc.id);
    },
    activate: (id) => activeId.set(id),
    open: (id, path) => {
      // `fileOps.openOne` adds every document with `activate: true` and then fires the
      // event, so that is the order here too.
      state.add({ id, path });
      for (const cb of openListeners) cb(id, path);
    },
    createModel: (id) => {
      state.models.add(id);
      for (const cb of modelListeners) cb(id);
    },
    moveCursor: (line, column = 1, top = line) => {
      state.at = { line, column, top };
      for (const cb of cursorListeners) cb();
    },
    close: (id) => {
      for (const cb of closeListeners) cb(id);
      list.update((all) => all.filter((doc) => doc.id !== id));
    },
    quit: async () => {
      for (const handler of quitHandlers) await handler();
    },
    setEnabled: (value) => {
      enabled = value;
    },
    becomeReady: async () => {
      resolveReady();
      await ready;
      // One more turn, so the tracker's own `.then` has run.
      await Promise.resolve();
    },
  };

  state.memory = createFileMemory({
    read: () => state.files,
    write: (files) => {
      state.files = files;
    },
    enabled: () => enabled,
    knownProfile: () => true,
    now: () => 1000,
  });

  state.stop = createFileTracker({
    docs: {
      activeId,
      get: (id) => get(list).find((doc) => doc.id === id),
      all: () => get(list),
      getActiveId: () => get(activeId),
    },
    memory: state.memory,
    enabled: () => enabled,
    hasModel: (id) => state.models.has(id),
    bookmarkLines: (id) => state.marks.get(id) ?? [],
    setBookmarks: (id, lines) => {
      state.restoredMarks.push({ id, lines });
      state.marks.set(id, lines);
    },
    position: (id) => (get(activeId) === id ? { ...state.at } : null),
    applyPosition: (id, at) => {
      if (!state.editorUp || get(activeId) !== id) return false;
      state.restoredAt.push({ id, ...at });
      state.at = { ...at };
      return true;
    },
    ready,
    onDidChangeCursor: (cb) => {
      cursorListeners.push(cb);
      return () => cursorListeners.splice(cursorListeners.indexOf(cb), 1);
    },
    onDidCreateModel: (cb) => {
      modelListeners.push(cb);
      return () => modelListeners.splice(modelListeners.indexOf(cb), 1);
    },
    onDidOpen: (cb) => {
      openListeners.push(cb);
      return () => openListeners.splice(openListeners.indexOf(cb), 1);
    },
    onWillClose: (cb) => {
      closeListeners.push(cb);
      return () => closeListeners.splice(closeListeners.indexOf(cb), 1);
    },
    onWillQuit: (cb) => {
      quitHandlers.push(cb);
      return () => quitHandlers.splice(quitHandlers.indexOf(cb), 1);
    },
    flushMemory: async () => {
      state.flushes += 1;
    },
  });
  return state;
}

describe('per-file memory: what is written', () => {
  it('writes the cursor and the bookmarks when a file is closed', async () => {
    const h = trackerHarness();
    await h.becomeReady();
    h.open('a', '/a.nc');
    h.moveCursor(42, 7, 30);
    h.marks.set('a', [12, 40]);

    h.close('a');
    expect(h.memory.get('/a.nc')).toMatchObject({
      line: 42,
      column: 7,
      top: 30,
      bookmarks: [12, 40],
    });
    h.stop();
  });

  it('writes the outgoing document when the tab is switched', async () => {
    const h = trackerHarness();
    await h.becomeReady();
    h.open('a', '/a.nc');
    h.moveCursor(10);
    h.open('b', '/b.nc');
    h.moveCursor(20);

    // Back to the first tab: the second one has to be written on the way out, and by
    // then the editor already shows the other model, so its place comes from what the
    // cursor events recorded.
    h.activate('a');
    expect(h.memory.get('/b.nc')).toMatchObject({ line: 20 });
    h.stop();
  });

  it('writes every open document before the app quits and flushes the file', async () => {
    const h = trackerHarness();
    await h.becomeReady();
    h.open('a', '/a.nc');
    h.moveCursor(5);
    h.open('b', '/b.nc');
    h.moveCursor(6);

    await h.quit();
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 5 });
    expect(h.memory.get('/b.nc')).toMatchObject({ line: 6 });
    expect(h.flushes).toBe(1);
    h.stop();
  });

  it('never writes a memo for an untitled document', async () => {
    const h = trackerHarness();
    await h.becomeReady();
    h.add({ id: 'u', path: null });
    h.moveCursor(9);
    h.close('u');
    expect(h.files).toEqual({});
    h.stop();
  });

  it('leaves the memo of a tab that was never in front exactly as it was', async () => {
    // The rule that stops the milestone from losing a setting. A session restore brings
    // two files back while Monaco is still loading; only the last one is on screen, so
    // only that one ever gets its memo. Closing the other without looking at it has no
    // cursor and no decorations to read, and "line 1, no bookmarks" would replace a
    // real memo with nothing.
    const h = trackerHarness({
      files: {
        '/a.nc': { line: 80, column: 2, top: 70, bookmarks: [3, 9], at: 1 },
        '/b.nc': { line: 5, column: 1, top: 1, bookmarks: [], at: 1 },
      },
      ready: false,
    });
    h.editorUp = false;
    h.open('a', '/a.nc');
    h.open('b', '/b.nc');

    h.editorUp = true;
    await h.becomeReady();
    h.createModel('a');
    h.createModel('b');
    // `b` is in front and gets its memo; `a` is still waiting for its turn.
    expect(h.restoredAt).toEqual([{ id: 'b', line: 5, column: 1, top: 1 }]);

    h.close('a');
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 80, top: 70, bookmarks: [3, 9] });
    h.stop();
  });
});

describe('per-file memory: what is restored', () => {
  it('puts the cursor and the bookmarks back when a remembered file is opened', async () => {
    const h = trackerHarness({
      files: { '/a.nc': { line: 42, column: 7, top: 30, bookmarks: [12, 40], at: 1 } },
    });
    await h.becomeReady();
    h.open('a', '/a.nc');

    expect(h.restoredAt).toEqual([{ id: 'a', line: 42, column: 7, top: 30 }]);
    expect(h.restoredMarks).toEqual([{ id: 'a', lines: [12, 40] }]);
    h.stop();
  });

  it('holds the memo until Monaco is up, then applies it', async () => {
    // Session restore runs during startup, before the editor exists: `reveal` and
    // `bookmarks.set` would do nothing at all and the memo would be gone.
    const h = trackerHarness({
      files: { '/a.nc': { line: 42, column: 1, top: 40, bookmarks: [5], at: 1 } },
      ready: false,
    });
    h.editorUp = false;
    h.open('a', '/a.nc');
    expect(h.restoredAt).toEqual([]);

    h.editorUp = true;
    await h.becomeReady();
    h.createModel('a');
    expect(h.restoredAt).toEqual([{ id: 'a', line: 42, column: 1, top: 40 }]);
    h.stop();
  });

  it('applies a tab that was behind another one when it is brought to the front', async () => {
    // What a session restore looks like: two files come back while Monaco is still
    // loading, and only one of them can be the one on screen.
    const h = trackerHarness({
      files: {
        '/a.nc': { line: 8, column: 1, top: 1, bookmarks: [], at: 1 },
        '/b.nc': { line: 17, column: 1, top: 10, bookmarks: [2], at: 1 },
      },
    });
    h.editorUp = false;
    h.open('a', '/a.nc');
    h.open('b', '/b.nc');

    h.editorUp = true;
    await h.becomeReady();
    h.createModel('a');
    h.createModel('b');
    // `b` is the one in front, so it is the only one that could be applied.
    expect(h.restoredAt).toEqual([{ id: 'b', line: 17, column: 1, top: 10 }]);

    h.activate('a');
    expect(h.restoredAt.at(-1)).toEqual({ id: 'a', line: 8, column: 1, top: 1 });
    h.stop();
  });

  it('a restored document is written again when it is closed', async () => {
    const h = trackerHarness({
      files: { '/a.nc': { line: 42, column: 1, top: 40, bookmarks: [5], at: 1 } },
    });
    await h.becomeReady();
    h.open('a', '/a.nc');
    h.moveCursor(90, 1, 80);
    h.marks.set('a', [5, 60]);

    h.close('a');
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 90, top: 80, bookmarks: [5, 60] });
    h.stop();
  });

  it('opening a file nobody remembers restores nothing and still writes on close', async () => {
    const h = trackerHarness();
    await h.becomeReady();
    h.open('a', '/a.nc');
    expect(h.restoredAt).toEqual([]);
    expect(h.restoredMarks).toEqual([]);

    h.moveCursor(12);
    h.close('a');
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 12 });
    h.stop();
  });

  it('leaves the memo alone while the setting is off, and after it is switched on', async () => {
    // The order that used to cost a setting: the file is opened while
    // `files.rememberPerFile` is off, so the editor was never given its bookmarks; if
    // switching the setting on then let the close write, the file would come back with
    // no bookmarks at all and nothing would say why.
    const h = trackerHarness({
      files: { '/a.nc': { line: 80, column: 2, top: 70, bookmarks: [3, 9], at: 1 } },
      enabled: false,
    });
    await h.becomeReady();
    h.open('a', '/a.nc');
    expect(h.restoredAt).toEqual([]);

    h.setEnabled(true);
    h.moveCursor(4);
    h.close('a');
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 80, top: 70, bookmarks: [3, 9] });
    h.stop();
  });

  it('a file opened while the setting is on is written back as usual', async () => {
    const h = trackerHarness({ enabled: true });
    await h.becomeReady();
    h.open('a', '/a.nc');
    h.moveCursor(4);
    h.setEnabled(false);
    h.close('a');
    // The store refuses the write too, so nothing new is stored while it is off.
    expect(h.files).toEqual({});
    h.stop();
  });

  it('keeps every memo when Monaco never loads', async () => {
    const h = trackerHarness({
      files: { '/a.nc': { line: 42, column: 1, top: 40, bookmarks: [5], at: 1 } },
    });
    h.editorUp = false;
    h.open('a', '/a.nc');
    h.close('a');
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 42, bookmarks: [5] });
    h.stop();
  });
});

// G8 M7. `session_save` goes through the same `state.rs` write as the recent list and
// the window layout, and Rust refuses the whole file once it is over 1 MiB. "The tabs do
// not come back" could therefore be a condition that had been true for weeks, with one
// console warning nobody sees.
describe('a session list that cannot be stored', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('says so once, with the reason Rust gave', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = sessionHarness({ docs: [{ id: 'u', path: null }], active: 'u' });
    h.failSave = 'state.json: 1631525 bytes exceed the 1048576 byte limit';
    const stop = h.session.start();

    for (const path of ['/a.nc', '/b.nc', '/c.nc']) {
      h.setDocs([{ id: path, path }], path);
      await vi.advanceTimersByTimeAsync(1100);
    }

    expect(h.saved).toHaveLength(3);
    const errors = h.noticed.filter((note) => note.error);
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toContain('1048576');
    stop();
  });
});
