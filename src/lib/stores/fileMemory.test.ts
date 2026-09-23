// Per-file memory (plan §7.9, AD-22). Owner: WP7.5.
//
// The bar for M7 is that nothing is ever lost quietly, and a memo is the one place in
// the milestone where "lost" means a *setting* rather than text: a dialect the user
// picked by hand, or a machine they deliberately set to "none". So the cases here are
// the ones where a wrong answer changes how a program is read:
//
//   - the three states of `machineId` (an id, an explicit "none", nothing remembered);
//   - a choice that is reset actually being forgotten, not just overwritten;
//   - a remembered dialect that no longer exists being ignored rather than handed out;
//   - the caps, which decide which memos survive at all;
//   - and the round trip through `stores/uiState.ts`, because a memo that this module
//     writes and that module drops on the way back in is the same as no memo at all.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_REMEMBERED_BOOKMARKS,
  MAX_REMEMBERED_BYTES,
  MAX_REMEMBERED_FILES,
  createFileMemory,
} from './fileMemory';
import { sanitizeUiState } from './uiState';
import type { FileMemo, FileMemoryStore } from '$lib/app/types';

interface Harness {
  memory: FileMemoryStore;
  /** What would be in `state.json`. */
  files: Record<string, FileMemo>;
  /** Moves the clock, so the LRU has something to sort by. */
  tick(ms?: number): void;
  setEnabled(value: boolean): void;
  /** Profile ids the registry knows; anything else is a dialect that went away. */
  known: Set<string>;
  /** How often the store wrote the table, so a no-op write is visible. */
  writes: number;
}

function harness(o: { files?: Record<string, FileMemo>; enabled?: boolean } = {}): Harness {
  let now = 1_000;
  let enabled = o.enabled ?? true;
  const state: Harness = {
    memory: undefined as unknown as FileMemoryStore,
    files: o.files ?? {},
    tick: (ms = 1) => {
      now += ms;
    },
    setEnabled: (value) => {
      enabled = value;
    },
    known: new Set(['fanuc-gcode', 'fanuc-lathe', 'heidenhain']),
    writes: 0,
  };
  state.memory = createFileMemory({
    read: () => state.files,
    write: (files) => {
      state.writes += 1;
      state.files = files;
    },
    enabled: () => enabled,
    knownProfile: (id) => state.known.has(id),
    now: () => now,
  });
  return state;
}

/** A memo as `stores/uiState.ts` would hand one back from disk. */
function memo(patch: Partial<FileMemo> = {}): FileMemo {
  return { line: 1, column: 1, top: 1, bookmarks: [], at: 1, ...patch };
}

describe('what is remembered', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('stamps a memo and hands the place back', () => {
    h.memory.remember('/jobs/welle.nc', { line: 42, column: 7, top: 30, bookmarks: [12, 40] });
    expect(h.memory.get('/jobs/welle.nc')).toEqual({
      line: 42,
      column: 7,
      top: 30,
      bookmarks: [12, 40],
      at: 1000,
    });
  });

  it('merges a patch into the memo and leaves the members it does not mention', () => {
    h.memory.remember('/a.nc', { line: 42, column: 7, top: 30, bookmarks: [5] });
    h.tick();
    h.memory.remember('/a.nc', { profileId: 'fanuc-lathe' });
    expect(h.memory.get('/a.nc')).toEqual({
      line: 42,
      column: 7,
      top: 30,
      bookmarks: [5],
      profileId: 'fanuc-lathe',
      at: 1001,
    });
  });

  it('keeps a member a later milestone added', () => {
    // M10 writes `channelId` (§7.14). A user who runs that build, then this one, then
    // that one again must get their channel assignments back.
    h.files = { '/a.nc': memo({ line: 9, channelId: 'ch2' } as Partial<FileMemo>) };
    h.memory.remember('/a.nc', { line: 10 });
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 10, channelId: 'ch2' });
  });

  it('does not store a memo that would restore nothing', () => {
    h.memory.remember('/a.nc', { line: 1, column: 1, top: 1, bookmarks: [] });
    expect(h.files).toEqual({});
    expect(h.writes).toBe(0);
  });

  it('drops a memo that has become empty', () => {
    h.memory.remember('/a.nc', { line: 8, bookmarks: [3] });
    h.memory.remember('/a.nc', { line: 1, bookmarks: [] });
    expect(h.memory.get('/a.nc')).toBeUndefined();
    expect(h.files).toEqual({});
  });

  it('forgets a path', () => {
    h.memory.remember('/a.nc', { line: 8 });
    h.memory.forget('/a.nc');
    expect(h.memory.get('/a.nc')).toBeUndefined();
  });

  it('cannot reach Object.prototype through a path spelled __proto__', () => {
    h.memory.remember('__proto__', { line: 5 });
    expect(Object.prototype).not.toHaveProperty('line');
    expect(h.memory.get('__proto__')).toMatchObject({ line: 5 });
    // And a path that was never remembered answers nothing, not an inherited member.
    expect(h.memory.get('constructor')).toBeUndefined();
    expect(h.memory.get('toString')).toBeUndefined();
  });

  it('repairs a patch that is not a place in a file', () => {
    h.memory.remember('/a.nc', {
      line: 0,
      column: -4,
      top: 2.5,
      bookmarks: [3, 3, 1, 0, Number.NaN, 9.5, 12],
    });
    // Nothing usable in the position, so it falls back to line 1 — and the bookmarks
    // are what keeps the memo worth storing at all.
    expect(h.memory.get('/a.nc')).toMatchObject({
      line: 1,
      column: 1,
      top: 1,
      bookmarks: [1, 3, 12],
    });
  });
});

describe('the dialect and the machine', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('hands back a dialect that was picked by hand', () => {
    h.memory.remember('/a.nc', { profileId: 'fanuc-lathe' });
    expect(h.memory.profileFor('/a.nc')).toBe('fanuc-lathe');
  });

  it('ignores a dialect that no longer exists', () => {
    h.memory.remember('/a.nc', { profileId: 'fanuc-lathe' });
    h.known.delete('fanuc-lathe');
    // The file is detected the way it would have been without a memo; handing the id
    // out would set a Monaco language nobody has registered.
    expect(h.memory.profileFor('/a.nc')).toBeUndefined();
    // The memo itself is kept: reinstalling the dialect brings the choice back.
    expect(h.memory.get('/a.nc')).toMatchObject({ profileId: 'fanuc-lathe' });
  });

  it('keeps the three states of a machine choice apart', () => {
    h.memory.remember('/chosen.nc', { machineId: 'lathe-is-b' });
    h.memory.remember('/none.nc', { machineId: null });
    h.memory.remember('/untouched.nc', { line: 5 });

    expect(h.memory.machineFor('/chosen.nc')).toBe('lathe-is-b');
    // `null` is "the user said none" and may never be collapsed into "nothing
    // remembered", or the profile's default machine would take the document over.
    expect(h.memory.machineFor('/none.nc')).toBeNull();
    expect(h.memory.machineFor('/untouched.nc')).toBeUndefined();
    expect(h.memory.machineFor('/never-seen.nc')).toBeUndefined();
  });

  it('an explicit "none" is worth a memo of its own', () => {
    h.memory.remember('/none.nc', { machineId: null });
    expect(h.files['/none.nc']).toBeDefined();
  });

  it('forgets the machine when the document goes back to the profile default', () => {
    h.memory.remember('/a.nc', { line: 4, machineId: 'lathe-is-b' });
    // A member that is present with the value `undefined` is deleted; this is what
    // `machines.setForDoc(id, undefined)` records.
    h.memory.remember('/a.nc', { machineId: undefined });
    expect(h.memory.machineFor('/a.nc')).toBeUndefined();
    expect(h.files['/a.nc']).not.toHaveProperty('machineId');
    // The rest of the memo survives the reset.
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 4 });
  });

  it('hands back an id no machine has any more, and lets the machine service judge it', () => {
    // AD-31: `stores/machines.ts` is the authority on whether a machine fits a document
    // and says so once when it falls back. A second check here would race the load of
    // `machines.json` and silently drop a choice the user had made.
    h.memory.remember('/a.nc', { machineId: 'sold-last-year' });
    expect(h.memory.machineFor('/a.nc')).toBe('sold-last-year');
  });
});

describe('the caps', () => {
  it('keeps at most the bookmark limit, lowest lines first', () => {
    const h = harness();
    const many = Array.from({ length: MAX_REMEMBERED_BOOKMARKS + 50 }, (_, i) => i + 1);
    h.memory.remember('/a.nc', { bookmarks: [...many].reverse() });
    const kept = h.memory.get('/a.nc')?.bookmarks ?? [];
    expect(kept).toHaveLength(MAX_REMEMBERED_BOOKMARKS);
    expect(kept[0]).toBe(1);
    expect(kept.at(-1)).toBe(MAX_REMEMBERED_BOOKMARKS);
  });

  it('keeps at most the file limit and drops the least recently written', () => {
    const h = harness();
    // Line 2 and up: a memo that says "line 1, no bookmarks, nothing chosen" restores
    // nothing and is not stored at all, so it would never take one of the 500 slots.
    for (let n = 0; n < MAX_REMEMBERED_FILES; n += 1) {
      h.memory.remember(`/p${n}.nc`, { line: n + 2 });
      h.tick();
    }
    expect(Object.keys(h.files)).toHaveLength(MAX_REMEMBERED_FILES);

    h.memory.remember('/new.nc', { line: 7 });
    expect(Object.keys(h.files)).toHaveLength(MAX_REMEMBERED_FILES);
    expect(h.memory.get('/p0.nc')).toBeUndefined();
    expect(h.memory.get('/p1.nc')).toBeDefined();
    expect(h.memory.get('/new.nc')).toBeDefined();
  });

  it('a file that is touched again keeps its place in the queue', () => {
    const h = harness();
    for (let n = 0; n < MAX_REMEMBERED_FILES; n += 1) {
      h.memory.remember(`/p${n}.nc`, { line: n + 2 });
      h.tick();
    }
    h.memory.remember('/p0.nc', { line: 99 });
    h.tick();
    h.memory.remember('/new.nc', { line: 7 });

    expect(h.memory.get('/p0.nc')).toMatchObject({ line: 99 });
    expect(h.memory.get('/p1.nc')).toBeUndefined();
  });

  it('a hand-edited stamp from the future does not outlive the files that were used', () => {
    const files: Record<string, FileMemo> = {};
    for (let n = 0; n < MAX_REMEMBERED_FILES; n += 1) {
      files[`/p${n}.nc`] = memo({ line: n + 2, at: n === 0 ? 8.64e15 : 10 + n });
    }
    const h = harness({ files });
    h.memory.remember('/new.nc', { line: 3 });
    expect(h.memory.get('/p0.nc')).toBeDefined();
    expect(h.memory.get('/p1.nc')).toBeUndefined();
    expect(Object.keys(h.files)).toHaveLength(MAX_REMEMBERED_FILES);
  });

  // G8 M7. The entry count was the only bound, and it is no bound on the size of the
  // file: Rust pretty-prints `state.json`, so every bookmark is a line of its own with
  // ten spaces in front of it, and 500 files × 200 bookmarks is 1.56 MiB against a
  // 1 MiB cap. Past that point Rust refuses **every** write of `state.json` — the
  // session list, the recent list and the window layout with it — and the table never
  // shrinks below 500 entries, so there is no way back from inside the app.
  describe('the byte budget', () => {
    /** What `serde_json::to_vec_pretty` really writes for a `state.json` holding these. */
    function prettyBytes(files: Record<string, FileMemo>): number {
      const whole = { $version: 1, recent: [], ui: { layout: {}, lastParams: {}, lastScript: null, files } };
      return JSON.stringify(whole, null, 2).length + 1;
    }

    /** A heavily bookmarked program with a path of the length a job folder produces. */
    function heavy(n: number, bookmarks: number): [string, FileMemo] {
      return [
        `/Users/peter/NC/Auftraege/2026/job-${String(n).padStart(4, '0')}/welle-${n}.nc`,
        memo({
          line: 12345,
          column: 42,
          top: 12300,
          at: 10 + n,
          bookmarks: Array.from({ length: bookmarks }, (_, i) => 100 + i * 7),
        }),
      ];
    }

    it('stays well under the 1 MiB state.json cap at the caps it enforces', () => {
      const h = harness();
      for (let n = 0; n < MAX_REMEMBERED_FILES; n += 1) {
        const [path, one] = heavy(n, MAX_REMEMBERED_BOOKMARKS);
        h.tick();
        h.memory.remember(path, { line: one.line, column: one.column, top: one.top, bookmarks: one.bookmarks });
      }
      // Without the budget this is 1.56 MiB and every writer of the file stops working.
      expect(prettyBytes(h.files)).toBeLessThan(MAX_REMEMBERED_BYTES + 4096);
      expect(prettyBytes(h.files)).toBeLessThan(1024 * 1024);
      // And it is not empty: the recent files keep everything they had.
      expect(Object.keys(h.files).length).toBeGreaterThan(50);
    });

    it('is crossed by ordinary bookmarking, not only by the caps', () => {
      // The reviewer's threshold: 500 files × ~130 bookmarks was already over 1 MiB.
      const h = harness();
      for (let n = 0; n < MAX_REMEMBERED_FILES; n += 1) {
        const [path, one] = heavy(n, 130);
        h.tick();
        h.memory.remember(path, { bookmarks: one.bookmarks, line: one.line });
      }
      expect(prettyBytes(h.files)).toBeLessThan(1024 * 1024);
    });

    it('gives up the least recently written memo, and keeps the one just written', () => {
      const files: Record<string, FileMemo> = {};
      for (let n = 0; n < 300; n += 1) {
        const [path, one] = heavy(n, MAX_REMEMBERED_BOOKMARKS);
        files[path] = one;
      }
      const h = harness({ files });
      const oldest = heavy(0, 0)[0];
      const newest = heavy(299, 0)[0];
      h.tick(1_000_000);
      h.memory.remember('/nc/just-edited.nc', { line: 7 });

      expect(h.memory.get('/nc/just-edited.nc')?.line).toBe(7);
      expect(h.memory.get(oldest)).toBeUndefined();
      expect(h.memory.get(newest)).toBeDefined();
      expect(prettyBytes(h.files)).toBeLessThan(1024 * 1024);
    });

    it('leaves a table that already fits exactly as it was', () => {
      const h = harness();
      h.memory.remember('/a.nc', { line: 4 });
      const before = h.files;
      h.tick();
      h.memory.remember('/b.nc', { line: 5 });
      expect(Object.keys(h.files)).toEqual(['/a.nc', '/b.nc']);
      expect(before['/a.nc']).toEqual(h.files['/a.nc']);
    });
  });
});

describe('files.rememberPerFile', () => {
  it('answers nothing and writes nothing while it is off', () => {
    const h = harness({
      files: { '/a.nc': memo({ line: 42, profileId: 'fanuc-lathe', machineId: null }) },
      enabled: false,
    });

    // The gate is here and not at the call sites, so `fileOps.open` (WP7.3) needs none
    // of its own and no path can restore a dialect the user asked gEdit to forget.
    expect(h.memory.get('/a.nc')).toBeUndefined();
    expect(h.memory.profileFor('/a.nc')).toBeUndefined();
    expect(h.memory.machineFor('/a.nc')).toBeUndefined();

    h.memory.remember('/a.nc', { line: 1, bookmarks: [] });
    expect(h.writes).toBe(0);

    // Nothing was thrown away either: switching the setting back on brings it back.
    h.setEnabled(true);
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 42, profileId: 'fanuc-lathe' });
  });

  it('still forgets a path while it is off', () => {
    const h = harness({ files: { '/a.nc': memo({ line: 42 }) }, enabled: false });
    h.memory.forget('/a.nc');
    expect(h.files).toEqual({});
  });
});

describe('the round trip through state.json', () => {
  it('everything this store writes survives the way uiState reads it back', () => {
    const h = harness();
    h.memory.remember('/jobs/welle.nc', {
      line: 120,
      column: 3,
      top: 100,
      bookmarks: [4, 120],
      profileId: 'fanuc-lathe',
      machineId: null,
    });
    h.memory.remember('/jobs/flansch.nc', { line: 5, machineId: 'lathe-is-b' });

    // `sanitizeUiState` drops a memo that is missing one of the four members every
    // reader relies on, so a store that wrote a half memo would lose it at the next
    // start without a word.
    const back = sanitizeUiState({ files: h.files }).files;
    expect(back).toEqual(h.files);
    expect(back['/jobs/welle.nc'].machineId).toBeNull();
    expect(back['/jobs/flansch.nc'].machineId).toBe('lathe-is-b');
  });

  it('a memo hand-edited into the file is repaired rather than trusted', () => {
    // What `sanitizeUiState` lets through is not yet what this store promises: it keeps
    // an entry whole, unknown members included, and only insists on the four required
    // ones. The bookmarks are filtered here.
    const raw = sanitizeUiState({
      files: { '/a.nc': { line: 3, column: 1, top: 1, at: 5, bookmarks: [2, 'x', 4, 2] } },
    }).files;
    const h = harness({ files: raw });
    h.memory.remember('/a.nc', { line: 4 });
    expect(h.memory.get('/a.nc')).toMatchObject({ line: 4, bookmarks: [2, 4] });
  });
});
