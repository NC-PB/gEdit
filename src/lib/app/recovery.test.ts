// Crash recovery, webview half (plan §5 WP7.4, AD-21), with a fake clock and fake
// commands.
//
// Every test here is a sentence about work that must not be lost, and each one fails if
// the mechanism behind it is removed:
//
//   a dirty document is written                    → a crash costs at most 30 s
//   a clean or unchanged one is not                → an idle window writes nothing
//   continuous typing is written every 30 s        → a long edit is never one big gap
//   `flushNow()` resolves only when it is on disk  → the harness's `kill -9` cannot win
//   the drop is ordered after the write            → a save never leaves stale text behind
//   only `onWillQuit` clears                       → a Windows logoff keeps its snapshots
//   a restore carries the snapshot's disk stamp    → the file that moved on is not
//   `outlookOf` calls that file `changed`            overwritten in silence
//   a session is discarded only when it is empty   → a partial restore loses nothing
//
// The document store is the real one (a plain svelte/store module); Monaco, Tauri and
// `app/fileOps.ts` are replaced by `deps`. `idle` is a `setTimeout(0)`, which is what
// the shipped app really uses — WebKit has no `requestIdleCallback` — so the fake clock
// drives the whole loop.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRecoveryService,
  entryKey,
  outlookFor,
  outlookOf,
  SNAPSHOT_INTERVAL_MS,
  type RecoveryDeps,
} from './recovery';
import { createDocumentStore } from '$lib/stores/documents';
import type {
  DiskStamp,
  DocId,
  DocumentStore,
  RecoveryEntry,
  RecoveryService,
} from '$lib/app/types';
import type { FileStat, RecoveryMeta } from '$lib/platform/commands';

const PATH = '/nc/prog.nc';
const STAMP: DiskStamp = { mtimeMs: 1000, size: 12, hash: 42 };

function stat(over: Partial<FileStat> = {}): FileStat {
  return {
    path: PATH,
    allowed: true,
    exists: true,
    isDir: false,
    mtimeMs: 1000,
    size: 12,
    readonly: false,
    ...over,
  };
}

function entry(over: Partial<RecoveryEntry> = {}): RecoveryEntry {
  return {
    session: 's-1',
    key: 'd1',
    path: PATH,
    title: 'prog.nc',
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    nul: { leader: 0, trailer: 0, stripped: 0 },
    diskStamp: STAMP,
    savedAt: 1_700_000_000_000,
    bytes: 12,
    ...over,
  };
}

interface Model {
  text: string;
  version: number;
}

interface Harness {
  docs: DocumentStore;
  service: RecoveryService;
  models: Map<DocId, Model>;
  puts: { meta: RecoveryMeta; text: string }[];
  drops: string[];
  discarded: string[];
  restored: Parameters<RecoveryDeps['files']['restoreDocument']>[0][];
  cleared: number;
  listed: RecoveryEntry[];
  reads: Map<string, string>;
  messages: { text: string; error: boolean }[];
  /** The `onWillQuit` handler the service registered. */
  quit(): Promise<void>;
  /** A blur or a `visibilitychange`. */
  away(): void;
  saved(id: DocId): void;
  willClose(id: DocId): void;
  add(o?: { dirty?: boolean; text?: string; path?: string | null }): DocId;
  edit(id: DocId, text?: string): void;
}

function harness(over: Partial<RecoveryDeps> = {}): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const models = new Map<DocId, Model>();
  let onAway: () => void = () => {};
  let onSave: (id: DocId, path: string) => void = () => {};
  let onClose: (id: DocId) => void = () => {};
  let onQuit: () => Promise<void> | void = () => {};
  let nextRestored = 0;

  const h: Harness = {
    docs,
    models,
    puts: [],
    drops: [],
    discarded: [],
    restored: [],
    cleared: 0,
    listed: [],
    reads: new Map<string, string>(),
    messages: [],
    quit: async () => {
      await onQuit();
    },
    away: () => onAway(),
    saved: (id: DocId) => onSave(id, PATH),
    willClose: (id: DocId) => onClose(id),
    // Filled in below: `deps` records into `h`, and the service needs `deps`, so the
    // three that depend on the finished service are wired after it exists.
    service: undefined as unknown as RecoveryService,
    add: () => {
      throw new Error('the harness is not wired yet');
    },
    edit: () => {},
  };

  const deps: RecoveryDeps = {
    docs,
    editor: {
      hasModel: (id) => models.has(id),
      getText: (id) => models.get(id)?.text ?? '',
      versionId: (id) => models.get(id)?.version ?? 0,
    },
    files: {
      restoreDocument(o) {
        h.restored.push(o);
        return `r${++nextRestored}`;
      },
      onDidSave(cb) {
        onSave = cb;
        return () => {
          onSave = () => {};
        };
      },
      onWillClose(cb) {
        onClose = cb;
        return () => {
          onClose = () => {};
        };
      },
      onWillQuit(cb) {
        onQuit = cb;
        return () => {
          onQuit = () => {};
        };
      },
    },
    status: {
      show: (text, o) => void h.messages.push({ text, error: o?.error === true }),
    },
    enabled: () => true,
    scriptTarget: () => null,
    async put(meta, text) {
      h.puts.push({ meta, text });
    },
    async drop(key) {
      h.drops.push(key);
    },
    async clearCurrent() {
      h.cleared += 1;
    },
    async list() {
      return h.listed;
    },
    async read(session, key) {
      const text = h.reads.get(`${session}/${key}`);
      if (text === undefined) throw new Error(`no snapshot ${session}/${key}`);
      return text;
    },
    async discardSession(session) {
      h.discarded.push(session);
    },
    now: () => Date.now(),
    watchAway(flush) {
      onAway = flush;
      return () => {
        onAway = () => {};
      };
    },
    idle(fn) {
      // What the macOS webview really does: WebKit has no `requestIdleCallback`, so the
      // shipped path is a task of its own — off the keystroke path either way.
      const handle = setTimeout(fn, 0);
      return () => clearTimeout(handle);
    },
    intervalMs: SNAPSHOT_INTERVAL_MS,
    ...over,
  };

  h.service = createRecoveryService(deps);
  h.add = ({ dirty = true, text = 'O1000', path = PATH } = {}) => {
    const id = docs.add({
      path,
      untitledIndex: path === null ? 1 : null,
      profileId: 'fanuc-gcode',
      encoding: { encoding: 'utf-8', hasBom: false },
      eol: 'crlf',
      eolMixedOnLoad: false,
      nul: { leader: 0, trailer: 0, stripped: 0 },
      textDirty: dirty,
      metaDirty: false,
      disk: path === null ? null : STAMP,
      external: 'none',
      readOnly: false,
      readOnlyReason: null,
    });
    models.set(id, { text, version: 1 });
    return id;
  };
  h.edit = (id, text = 'O1000\nG0 X1') => {
    const model = models.get(id);
    if (model) models.set(id, { text, version: model.version + 1 });
    docs.update(id, { textDirty: true });
  };
  return h;
}

/**
 * One full period of the ticker, plus the idle callback and the awaits behind it.
 *
 * The extra millisecond is not decoration: the ticker queues the pass from inside the
 * timer it is running in, and a timer queued at the instant the clock stops does not run
 * in that same `advanceTimersByTime`.
 */
async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) await vi.advanceTimersByTimeAsync(SNAPSHOT_INTERVAL_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('taking snapshots', () => {
  it('writes nothing at all for a clean document', async () => {
    const h = harness();
    const stop = h.service.start();
    h.add({ dirty: false });
    await tick(3);
    expect(h.puts).toEqual([]);
    stop();
  });

  it('writes a dirty document once, and not again until its version changes', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();

    await tick();
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0].text).toBe('O1000');

    // Nothing was typed: the same text must not be written again, however long we wait.
    await tick(3);
    expect(h.puts).toHaveLength(1);

    h.edit(id, 'O1000\nG1 Z-5');
    await tick();
    expect(h.puts).toHaveLength(2);
    expect(h.puts[1].text).toBe('O1000\nG1 Z-5');
    stop();
  });

  it('keeps writing every 30 s while the typing goes on', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();

    // A keystroke every five seconds for a minute and a half.
    for (let step = 0; step < 18; step++) {
      h.edit(id, `O1000\n${'G1 X1\n'.repeat(step + 1)}`);
      await vi.advanceTimersByTimeAsync(5000);
    }
    await vi.advanceTimersByTimeAsync(1);
    // Three periods of thirty seconds: one snapshot each, never one per keystroke.
    expect(h.puts).toHaveLength(3);
    stop();
  });

  it('writes at once when the window goes away, and only what is new', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();

    // No ticker period has passed; a blur is the moment before a sleep or a shutdown.
    h.away();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts).toHaveLength(1);

    // Alt-tabbing a hundred times is a hundred passes and no writes: the version gate
    // is never skipped, only the throttle is.
    for (let i = 0; i < 100; i++) h.away();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts).toHaveLength(1);

    h.edit(id);
    h.away();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts).toHaveLength(2);
    stop();
  });

  // G8 M7. The forced write used to reset the same clock the ticker reads, so a blur one
  // second into a period made the tick at 30 s skip ("only 29 s since the last write")
  // and the next write land at 60 s: a power cut at 59 s cost 58 seconds of typing, not
  // 30. The trigger that exists to make a crash cheaper was doubling the worst case, and
  // the old version of this test asserted the 59 s gap green.
  it('lets a blur add a snapshot, never postpone the scheduled one', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();

    // A blur one second in: written at once, because that may be the last moment.
    await vi.advanceTimersByTimeAsync(1000);
    h.away();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.puts).toHaveLength(1);

    // The user keeps typing, and the ticker's period is up at 30 s — measured from the
    // last *scheduled* write, which there has not been one of.
    h.edit(id);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.puts).toHaveLength(2);

    // From there the throttle is the ticker's own period again: nothing at 31 s …
    h.edit(id, 'O1000\nG1 Z-9');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.puts).toHaveLength(2);
    // … and the next one when the period is up, not a period after that.
    await vi.advanceTimersByTimeAsync(29_001);
    expect(h.puts).toHaveLength(3);
    stop();
  });

  it('still holds the ticker to one snapshot per period under repeated blurs', async () => {
    // The property the throttle exists for: a 10 MB program is not written twice by the
    // *ticker* in one period. A blur is a decision of the user's and is honoured.
    const h = harness();
    const stop = h.service.start();
    const id = h.add();

    await tick();
    expect(h.puts).toHaveLength(1);

    // Typing all through the next period, with no blur: exactly one more write.
    for (let step = 0; step < 5; step++) {
      h.edit(id, `O1000\n${'G1 X1\n'.repeat(step + 1)}`);
      await vi.advanceTimersByTimeAsync(5000);
    }
    await vi.advanceTimersByTimeAsync(5001);
    expect(h.puts).toHaveLength(2);
    stop();
  });

  it('writes nothing for the document a script is applying its result to', async () => {
    let target: DocId | null = null;
    const h = harness({ scriptTarget: () => target });
    const stop = h.service.start();
    target = h.add();

    await tick(3);
    expect(h.puts).toEqual([]);

    // The run is over: the result it wrote into the document is picked up by the next pass.
    target = null;
    await tick();
    expect(h.puts).toHaveLength(1);
    stop();
  });

  // G8 M7. The skip used to be app-wide ("is a script running"), so one script on one
  // tab stopped the snapshots of every other tab for as long as it ran — up to the 120 s
  // run timeout, for documents the run never touches. The argument for skipping is about
  // the document being rewritten, so the skip is too.
  it('keeps snapshotting the other documents while a script runs', async () => {
    let target: DocId | null = null;
    const h = harness({ scriptTarget: () => target });
    const stop = h.service.start();
    target = h.add({ path: '/nc/scripted.nc' });
    const other = h.add({ path: '/nc/other.nc' });

    for (let period = 0; period < 4; period++) {
      h.edit(other, `O2000\n${'G1 X1\n'.repeat(period + 1)}`);
      h.edit(target as DocId, `O1000\n${'G1 Z-1\n'.repeat(period + 1)}`);
      await tick();
    }

    expect(h.puts.map((p) => p.meta.path)).toEqual([
      '/nc/other.nc',
      '/nc/other.nc',
      '/nc/other.nc',
      '/nc/other.nc',
    ]);
    stop();
  });

  it('writes nothing while recovery is switched off', async () => {
    const h = harness({ enabled: () => false });
    const stop = h.service.start();
    h.add();
    await tick(3);
    expect(h.puts).toEqual([]);
    stop();
  });

  it('tries again after a write that failed, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    const h = harness({
      async put(meta, text) {
        if (fail) throw new Error('the share went away');
        h.puts.push({ meta, text });
      },
    });
    const stop = h.service.start();
    h.add();

    await tick(2);
    expect(h.puts).toEqual([]);
    // One warning for the document, not one per pass: the harness fails on console noise.
    expect(warn).toHaveBeenCalledTimes(1);

    // No "snapshotted at" was recorded, so the unchanged text is offered again.
    fail = false;
    await tick();
    expect(h.puts).toHaveLength(1);
    stop();
  });

  // G8 M7. A snapshot that can never be written used to reach the console and nothing
  // else: the tab is dirty, the status bar is quiet, the Settings toggle still says the
  // feature is on, and the guide still promises "at worst the last 30 seconds of
  // typing". The programmer finds out at the next start, when the restore dialog says
  // there is nothing to recover. The full data volume and the document a paste grew past
  // `MAX_BODY_BYTES` are both ordinary.
  it('tells the user once that snapshots are not reaching the disk', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({
      put: () => Promise.reject(new Error('recovery: the snapshot is larger than 67108864 bytes')),
    });
    const stop = h.service.start();
    const id = h.add();

    await tick(6);
    h.edit(id, 'O1000\nG1 X50');
    await tick(6);

    expect(h.puts).toEqual([]);
    const errors = h.messages.filter((m) => m.error);
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toContain('prog.nc');
    stop();
  });

  it('says it once for the window, not once per document and not once per pass', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ put: () => Promise.reject(new Error('no space left on device')) });
    const stop = h.service.start();
    h.add({ path: '/nc/a.nc' });
    h.add({ path: '/nc/b.nc' });

    await tick(4);

    expect(h.messages.filter((m) => m.error)).toHaveLength(1);
    stop();
  });

  it('carries the document metadata the restore needs, and keeps the machine choice', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();
    h.docs.update(id, { machineId: null, eol: 'lf' });
    await tick();

    const meta = h.puts[0].meta;
    expect(meta.key).toBe(id);
    expect(meta.path).toBe(PATH);
    expect(meta.title).toBe('prog.nc');
    expect(meta.eol).toBe('lf');
    expect(meta.diskStamp).toEqual(STAMP);
    // `null` is an explicit "no machine" and has to survive as such: it is a different
    // answer from "nothing was chosen" (AD-31).
    expect(meta.machineId).toBeNull();
    expect('machineId' in JSON.parse(JSON.stringify(meta))).toBe(true);
    stop();
  });

  it('leaves the machine member out when nothing was chosen', async () => {
    const h = harness();
    const stop = h.service.start();
    h.add();
    await tick();
    // Absent, not null: the three states of AD-31 have to survive the JSON round trip.
    expect('machineId' in JSON.parse(JSON.stringify(h.puts[0].meta))).toBe(false);
    stop();
  });

  it('resolves flushNow only once the snapshot is really on disk', async () => {
    let land: () => void = () => {};
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    const h = harness({
      async put(meta, text) {
        await landed;
        h.puts.push({ meta, text });
      },
    });
    const stop = h.service.start();
    h.add();

    let done = false;
    const flush = h.service.flushNow().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    // This is the whole promise of `flushNow`: the harness awaits it and then sends
    // SIGKILL. If it resolved before the write landed, the kill would win the race.
    expect(done).toBe(false);
    expect(h.puts).toEqual([]);

    land();
    await flush;
    expect(done).toBe(true);
    expect(h.puts).toHaveLength(1);
    stop();
  });
});

describe('dropping what cannot be needed', () => {
  it('drops the snapshot when the document is saved', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();
    await tick();
    expect(h.puts).toHaveLength(1);

    h.docs.update(id, { textDirty: false });
    h.saved(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.drops).toEqual([id]);

    // And the saved document is not written again.
    await tick(2);
    expect(h.puts).toHaveLength(1);
    stop();
  });

  it('drops the snapshot when the document is closed', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();
    await tick();

    h.willClose(id);
    h.docs.remove(id);
    h.models.delete(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.drops).toEqual([id]);
    stop();
  });

  it('never lets the drop overtake the write it is meant to undo', async () => {
    const order: string[] = [];
    let land: () => void = () => {};
    const landed = new Promise<void>((resolve) => {
      land = resolve;
    });
    const h = harness({
      async put() {
        await landed;
        order.push('put');
      },
      async drop() {
        order.push('drop');
      },
    });
    const stop = h.service.start();
    const id = h.add();

    // A pass is in flight, awaiting the write, when the user hits Save.
    const flush = h.service.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    h.docs.update(id, { textDirty: false });
    h.saved(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([]);

    land();
    await flush;
    await vi.advanceTimersByTimeAsync(0);
    // The other order would leave the pre-save text on disk, to be offered as
    // "unsaved work" after the next crash.
    expect(order).toEqual(['put', 'drop']);
    stop();
  });
});

describe('clearing the session', () => {
  it('clears it from the quit handler and from nowhere else', async () => {
    const h = harness();
    const stop = h.service.start();
    const id = h.add();

    // Everything a Windows logoff or a machine going to sleep looks like from in here.
    h.away();
    await vi.advanceTimersByTimeAsync(0);
    await h.service.flushNow();
    h.edit(id);
    await tick(2);
    expect(h.puts.length).toBeGreaterThan(0);
    expect(h.cleared).toBe(0);

    // Only the answer to the quit dialog clears it.
    await h.quit();
    expect(h.cleared).toBe(1);
    stop();
  });

  it('listens for nothing that a logoff or a tab teardown would fire', () => {
    // `RunEvent::Exit` covers a Windows logoff as well as a clean quit (F29), and the
    // webview's equivalents are these three. A snapshot cleared from one of them is a
    // logoff that costs the user everything they had typed.
    const source = readFileSync(fileURLToPath(new URL('./recovery.ts', import.meta.url)), 'utf8');
    const code = source.replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, '');
    for (const event of ['pagehide', 'beforeunload', "'unload'"]) {
      expect(code).not.toContain(event);
    }
  });

  it('survives a clear that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({
      clearCurrent: () => Promise.reject(new Error('gone')),
    });
    const stop = h.service.start();
    await expect(h.quit()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
  });

  // G8 M7. Cmd+Q with a dirty document puts a native alert on screen, which takes the
  // focus off the webview, which fires the blur trigger — so a forced pass is very often
  // in flight at exactly this moment. The clear went straight out instead of onto the
  // chain every other command uses, won the race, and the put landed in the folder that
  // had just been emptied. The next start then offered the user a snapshot of the work
  // they had explicitly chosen not to save, and because its disk stamp still matched the
  // untouched file `outlookOf` called it `unchanged` — the reassuring row.
  it('lets a snapshot already in flight finish before it clears', async () => {
    let release: () => void = () => {};
    const order: string[] = [];
    const h = harness({
      put: () =>
        new Promise<void>((resolve) => {
          order.push('put');
          release = resolve;
        }),
      clearCurrent: async () => {
        order.push('clear');
      },
    });
    const stop = h.service.start();
    h.add();

    // "Don't save" does not drop the documents, so no `onWillClose` runs.
    h.away();
    await vi.advanceTimersByTimeAsync(0);
    const quitting = h.quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['put']);

    release();
    await quitting;
    expect(order).toEqual(['put', 'clear']);
    stop();
  });

  // G8 M7. `contrib/files.ts` clears the session and only then calls `destroy()`. If the
  // window survives that — a rejected import of `@tauri-apps/api/window`, a future close
  // path that aborts after the handlers — every dirty tab's snapshot is gone from disk
  // while the service still believes it is there, so `due()` skips it and the next crash
  // costs everything since the last save.
  it('forgets what it wrote, so the next pass rebuilds the folder it just emptied', async () => {
    const h = harness();
    const stop = h.service.start();
    h.add();

    await tick();
    expect(h.puts).toHaveLength(1);

    await h.quit();
    expect(h.cleared).toBe(1);

    // Not one keystroke since, and the snapshot is written again.
    await tick();
    expect(h.puts).toHaveLength(2);
    stop();
  });
});

describe('what a restore will do', () => {
  it('names the five outcomes', () => {
    expect(outlookOf(entry({ path: null }), undefined)).toBe('untitled');
    expect(outlookOf(entry(), stat())).toBe('unchanged');
    expect(outlookOf(entry(), stat({ mtimeMs: 2000 }))).toBe('changed');
    expect(outlookOf(entry(), stat({ size: 99 }))).toBe('changed');
    expect(outlookOf(entry(), stat({ exists: false }))).toBe('missing');
    expect(outlookOf(entry(), stat({ allowed: false }))).toBe('unreachable');
    expect(outlookOf(entry(), undefined)).toBe('unreachable');
    expect(outlookOf(entry({ diskStamp: null }), stat())).toBe('unknown');
  });

  it('marks the file that moved on under the snapshot', async () => {
    const entries = [entry({ key: 'd1' }), entry({ key: 'd2', path: '/nc/other.nc' })];
    const asked: string[][] = [];
    const out = await outlookFor(entries, async (paths) => {
      asked.push(paths);
      return [stat({ mtimeMs: 9999 }), stat({ path: '/nc/other.nc' })];
    });
    // One round trip, one entry per distinct path.
    expect(asked).toEqual([[PATH, '/nc/other.nc']]);
    expect(out[entryKey(entries[0])]).toBe('changed');
    expect(out[entryKey(entries[1])]).toBe('unchanged');
  });

  it('promises the least when the check itself fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await outlookFor([entry()], () => Promise.reject(new Error('no')));
    expect(out[entryKey(entry())]).toBe('unreachable');
  });
});

describe('restoring', () => {
  it('reopens a snapshot with everything the document needs, machine choice included', async () => {
    const h = harness();
    h.reads.set('s-1/d1', 'O1000\nG0 X0');
    h.listed = [entry({ machineId: 'lathe-2' })];

    const ids = await h.service.restore(h.listed);
    expect(ids).toEqual(['r1']);
    expect(h.restored[0]).toEqual({
      path: PATH,
      title: 'prog.nc',
      profileId: 'fanuc-gcode',
      machineId: 'lathe-2',
      encoding: { encoding: 'utf-8', hasBom: false },
      eol: 'crlf',
      nul: { leader: 0, trailer: 0, stripped: 0 },
      textLF: 'O1000\nG0 X0',
      diskStamp: STAMP,
    });
  });

  it('keeps an explicit "no machine" as an explicit "no machine"', async () => {
    const h = harness();
    h.reads.set('s-1/d1', 'O1000');
    h.listed = [entry({ machineId: null })];
    await h.service.restore(h.listed);
    expect(h.restored[0].machineId).toBeNull();
  });

  it('hands over the stamp the snapshot was taken with, not a fresh one', async () => {
    const h = harness();
    h.reads.set('s-1/d1', 'O1000');
    h.listed = [entry()];
    await h.service.restore(h.listed);
    // This is what makes a changed file impossible to overwrite in silence: the
    // document carries the old stamp, so the external-change check raises its banner
    // before the user can save (AD-21, P1 AD-10). A fresh stamp would say "this is the
    // file your text came from" about a file it did not come from.
    expect(h.restored[0].diskStamp).toEqual(STAMP);
  });

  it('discards a session once nothing is left in it', async () => {
    const h = harness();
    h.reads.set('s-1/d1', 'a');
    h.reads.set('s-1/d2', 'b');
    h.listed = [entry({ key: 'd1' }), entry({ key: 'd2' })];

    await h.service.restore(h.listed);
    expect(h.restored).toHaveLength(2);
    expect(h.discarded).toEqual(['s-1']);
  });

  it('keeps a session that still holds something the user did not take', async () => {
    const h = harness();
    h.reads.set('s-1/d1', 'a');
    h.reads.set('s-1/d2', 'b');
    h.listed = [entry({ key: 'd1' }), entry({ key: 'd2' })];

    await h.service.restore([h.listed[0]]);
    // Discarding the session here would delete `d2`, which the user never saw restored.
    // There is no per-entry drop for a leftover session, so the session stays whole.
    expect(h.discarded).toEqual([]);
    expect(h.messages.map((m) => m.text).join(' ')).toContain('offered again');
  });

  it('keeps the session when one snapshot could not be read, and restores the rest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    h.reads.set('s-1/d2', 'b');
    h.listed = [entry({ key: 'd1' }), entry({ key: 'd2' })];

    const ids = await h.service.restore(h.listed);
    expect(ids).toEqual(['r1']);
    expect(h.restored[0].textLF).toBe('b');
    expect(h.discarded).toEqual([]);
    expect(h.messages.some((m) => m.error)).toBe(true);
  });

  it('discards a whole leftover session on request', async () => {
    const h = harness();
    await h.service.discard('s-2');
    expect(h.discarded).toEqual(['s-2']);
  });

  it('answers with an empty list rather than failing the start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ list: () => Promise.reject(new Error('unreadable')) });
    await expect(h.service.leftovers()).resolves.toEqual([]);
  });
});
