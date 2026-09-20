// The external-change decision table (plan §5 WP2.3, AD-10), with a fake clock, a fake
// stat and a fake read.
//
// The table the plan asks for:
//
//   own write               → silent   (the save restamped the document)
//   touch, same content     → silent   (the hash is what decides, not the mtime)
//   changed                 → event    (banner, or a reload for a clean document)
//   deleted                 → event    (marker + metaDirty, the buffer is kept)
//   unfocused               → no poll
//   clean, `reload` policy  → reload
//
// The document store is the real one (it is a plain svelte/store module); Monaco, Tauri
// and `app/fileOps.ts`'s disk half are replaced by `deps`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExternalChangeService, POLL_INTERVAL_MS, type ExternalChangeDeps } from './external';
import { createDocumentStore } from '$lib/stores/documents';
import { fnv1a32 } from '$lib/core/text';
import { MAX_OPEN_BYTES } from '$lib/app/fileOps';
import type { DiskStamp, DocId, DocumentStore, ExternalChangeService, StatusService } from '$lib/app/types';
import type { FileStat } from '$lib/platform/commands';

const PATH = '/nc/prog.nc';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function stampOf(text: string, mtimeMs: number | null): DiskStamp {
  const bytes = bytesOf(text);
  return { mtimeMs, size: bytes.length, hash: fnv1a32(bytes) };
}

interface Disk {
  /** null: the file is not there. */
  text: string | null;
  mtimeMs: number | null;
  /** Overrides the size the stat reports, for the "too large to hash" case. */
  size?: number;
  allowed?: boolean;
  /** `decodeFile` refuses these bytes, so `reloadFromDisk` changes nothing at all. */
  undecodable?: boolean;
}

interface Harness {
  docs: DocumentStore;
  service: ExternalChangeService;
  disk: Map<string, Disk>;
  messages: { text: string; error: boolean }[];
  reloaded: DocId[];
  stats: number;
  reads: number;
  focused: boolean;
  fireFocus(): void;
  add(o?: { text?: string; mtimeMs?: number; dirty?: boolean }): DocId;
}

function harness(over: Partial<ExternalChangeDeps> = {}): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const disk = new Map<string, Disk>();
  const messages: { text: string; error: boolean }[] = [];
  const reloaded: DocId[] = [];
  let onFocus: () => void = () => {};

  const h = {
    docs,
    disk,
    messages,
    reloaded,
    stats: 0,
    reads: 0,
    focused: true,
    fireFocus: () => onFocus(),
  } as Harness;

  const status: StatusService = {
    current: { subscribe: () => () => {} },
    show: (text, o) => void messages.push({ text, error: o?.error === true }),
    clear: () => {},
  };

  const deps: ExternalChangeDeps = {
    docs,
    files: {
      // What `fileOps.reloadFromDisk` does, reduced to what this module can observe.
      async reloadFromDisk(id) {
        reloaded.push(id);
        const doc = docs.get(id);
        const entry = doc?.path === undefined || doc.path === null ? undefined : disk.get(doc.path);
        // `Promise<void>` either way: the real one reports the failure to the user and
        // leaves `disk` and `external` exactly as they were (fileOps.ts §7.2).
        if (!doc || !entry || entry.text === null || entry.undecodable) return;
        docs.update(id, {
          textDirty: false,
          metaDirty: false,
          external: 'none',
          disk: stampOf(entry.text, entry.mtimeMs),
        });
      },
    },
    status,
    async filesStat(paths) {
      h.stats++;
      return paths.map((path): FileStat => {
        const entry = disk.get(path);
        const allowed = entry?.allowed !== false;
        if (!allowed) {
          return { path, allowed: false, exists: false, isDir: false, mtimeMs: null, size: null, readonly: false };
        }
        const exists = entry !== undefined && entry.text !== null;
        return {
          path,
          allowed: true,
          exists,
          isDir: false,
          mtimeMs: exists ? (entry?.mtimeMs ?? null) : null,
          size: exists ? (entry?.size ?? bytesOf(entry?.text ?? '').length) : null,
          readonly: false,
        };
      });
    },
    async readFile(path) {
      h.reads++;
      const entry = disk.get(path);
      if (!entry || entry.text === null) throw new Error(`ENOENT ${path}`);
      return bytesOf(entry.text);
    },
    policy: () => 'ask',
    hasFocus: () => h.focused,
    watchFocus: (check) => {
      onFocus = check;
      return () => {
        onFocus = () => {};
      };
    },
    intervalMs: POLL_INTERVAL_MS,
    ...over,
  };

  h.service = createExternalChangeService(deps);
  h.add = ({ text = 'O1000', mtimeMs = 1000, dirty = false } = {}) => {
    disk.set(PATH, { text, mtimeMs });
    return docs.add({
      path: PATH,
      untitledIndex: null,
      profileId: 'fanuc-gcode',
      encoding: { encoding: 'utf-8', hasBom: false },
      eol: 'crlf',
      eolMixedOnLoad: false,
      nul: { leader: 0, trailer: 0, stripped: 0 },
      textDirty: dirty,
      metaDirty: false,
      disk: stampOf(text, mtimeMs),
      external: 'none',
    });
  };
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the decision table', () => {
  it('own write → silent: the stamp the save left matches the file', async () => {
    const h = harness();
    const id = h.add();
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('none');
    expect(h.reads).toBe(0);
    expect(h.messages).toEqual([]);
  });

  it('touch with the same content → silent, and the new mtime is recorded', async () => {
    const h = harness();
    const id = h.add({ text: 'O1000', mtimeMs: 1000 });
    h.disk.set(PATH, { text: 'O1000', mtimeMs: 5000 });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('none');
    expect(h.messages).toEqual([]);
    expect(h.reads).toBe(1);
    expect(h.docs.get(id)?.disk?.mtimeMs).toBe(5000);

    // …and the next tick costs nothing, because the stamp is up to date again.
    await h.service.checkNow();
    expect(h.reads).toBe(1);
  });

  it('changed → event: the tab is marked and the status bar says so', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: 'O2000 (posted again)', mtimeMs: 6000 });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('changed');
    expect(h.docs.get(id)?.dirty).toBe(false);
    expect(h.messages.map((m) => m.error)).toEqual([false]);
  });

  it('reads the changed file once, not on every tick', async () => {
    const h = harness();
    h.add();
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    await h.service.checkNow();
    await h.service.checkNow();
    expect(h.reads).toBe(1);
    expect(h.stats).toBe(3);
  });

  it('reads it again once the file changes a second time', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    h.disk.set(PATH, { text: 'O3000', mtimeMs: 7000 });
    await h.service.checkNow();
    expect(h.reads).toBe(2);
    expect(h.docs.get(id)?.external).toBe('changed');
  });

  it('deleted → event: the marker, metaDirty, and the buffer is kept', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: null, mtimeMs: null });
    await h.service.checkNow();
    const doc = h.docs.get(id);
    expect(doc?.external).toBe('deleted');
    expect(doc?.metaDirty).toBe(true);
    expect(doc?.dirty).toBe(true);
    expect(h.messages.map((m) => m.error)).toEqual([true]);

    // Said once, not every two seconds.
    await h.service.checkNow();
    expect(h.messages).toHaveLength(1);
  });

  it('clean document with `reload` → silent reload, no banner', async () => {
    const h = harness({ policy: () => 'reload' });
    const id = h.add();
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    expect(h.reloaded).toEqual([id]);
    expect(h.docs.get(id)?.external).toBe('none');
    expect(h.docs.get(id)?.disk?.mtimeMs).toBe(6000);
  });

  it('dirty document always asks, whatever the policy says (AD-10)', async () => {
    const h = harness({ policy: () => 'reload' });
    const id = h.add({ dirty: true });
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    expect(h.reloaded).toEqual([]);
    expect(h.docs.get(id)?.external).toBe('changed');
  });

  it('a file that comes back to what it was clears the marker again', async () => {
    const h = harness();
    const id = h.add({ text: 'O1000' });
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('changed');
    h.disk.set(PATH, { text: 'O1000', mtimeMs: 7000 });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('none');
  });
});

describe('what is watched', () => {
  it('leaves untitled documents alone: there is nothing to compare them against', async () => {
    const h = harness();
    h.docs.add({
      path: null,
      untitledIndex: 1,
      profileId: 'fanuc-gcode',
      encoding: { encoding: 'utf-8', hasBom: false },
      eol: 'crlf',
      eolMixedOnLoad: false,
      nul: { leader: 0, trailer: 0, stripped: 0 },
      textDirty: false,
      metaDirty: false,
      disk: null,
      external: 'none',
    });
    await h.service.checkNow();
    expect(h.stats).toBe(0);
  });

  it('says nothing about a path the fs scope does not answer for', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: null, mtimeMs: null, allowed: false });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('none');
    expect(h.messages).toEqual([]);
  });

  it('reports a change it cannot hash, rather than pulling a huge file through IPC', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000, size: MAX_OPEN_BYTES + 1 });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('changed');
    expect(h.reads).toBe(0);
  });

  it('tries again next tick when the file cannot be read (a write in flight)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({
      readFile: () => Promise.reject(new Error('EBUSY')),
    });
    const id = h.add();
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('none');
    expect(warn).toHaveBeenCalled();
  });

  it('survives a failing files_stat', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness({ filesStat: () => Promise.reject(new Error('not implemented')) });
    const id = h.add();
    await expect(h.service.checkNow()).resolves.toBeUndefined();
    expect(h.docs.get(id)?.external).toBe('none');
    expect(warn).toHaveBeenCalled();
  });
});

describe('the poll', () => {
  it('runs every 2 s while the window has focus', async () => {
    const h = harness();
    h.add();
    const stop = h.service.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(h.stats).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(h.stats).toBe(3);
  });

  it('unfocused → no poll', async () => {
    const h = harness();
    h.add();
    h.focused = false;
    const stop = h.service.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(h.stats).toBe(0);
    stop();
  });

  it('checks at once when the window comes back to the front', async () => {
    const h = harness();
    h.add();
    h.focused = false;
    const stop = h.service.start();
    h.fireFocus();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.stats).toBe(1);
    stop();
  });

  it('stops listening for focus when it is disposed', async () => {
    const h = harness();
    h.add();
    h.service.start()();
    h.fireFocus();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.stats).toBe(0);
  });

  it('runs one sweep at a time: a tick during a slow sweep is dropped', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const h = harness({
      async filesStat(paths) {
        calls++;
        await gate;
        return paths.map((path) => ({
          path,
          allowed: true,
          exists: true,
          isDir: false,
          mtimeMs: 1000,
          size: bytesOf('O1000').length,
          readonly: false,
        }));
      },
    });
    h.add();
    const stop = h.service.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(calls).toBe(2);
    stop();
  });
});

describe('keepMine', () => {
  it('keeps the buffer, marks the document modified and stops the banner coming back', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('changed');

    h.service.keepMine(id);
    const doc = h.docs.get(id);
    expect(doc?.external).toBe('none');
    expect(doc?.metaDirty).toBe(true);
    // The document now claims the file as it is on disk, so the next tick is quiet.
    expect(doc?.disk).toEqual(stampOf('O2000', 6000));

    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('none');
  });

  it('stops watching a document whose file is gone', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: null, mtimeMs: null });
    await h.service.checkNow();
    h.service.keepMine(id);
    const doc = h.docs.get(id);
    expect(doc?.external).toBe('none');
    expect(doc?.metaDirty).toBe(true);
    expect(doc?.disk).toBeNull();

    const before = h.stats;
    await h.service.checkNow();
    expect(h.stats).toBe(before); // nothing left to stat
  });

  it('does nothing for a document that is already closed', () => {
    const h = harness();
    expect(() => h.service.keepMine('d99')).not.toThrow();
  });
});

describe('a reload that cannot be carried out', () => {
  // G8 M2: `reload()` used to `forget(id)` *before* the await. When `reloadFromDisk` then
  // changed nothing — bytes that do not decode, a document that went dirty while the file
  // was being read — the `seen` guard was gone and the stamp had not moved, so the next
  // tick read the file and reloaded it again. With the default
  // `files.externalChange = 'reload'` that is a native modal error dialog every 2 s.
  it('raises the banner once and does not try again on the next tick', async () => {
    const h = harness({ policy: () => 'reload' });
    const id = h.add();
    h.disk.set(PATH, { text: '\u0000\u0000binary\u0000\u0000', mtimeMs: 6000, undecodable: true });

    const stop = h.service.start();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    stop();

    expect(h.reloaded).toEqual([id]);
    expect(h.reads).toBe(1);
    expect(h.docs.get(id)?.external).toBe('changed');
    // One notice, and it is the banner's, not five "could not be reloaded".
    expect(h.messages).toHaveLength(1);
  });

  it('still reacts when the file changes again', async () => {
    const h = harness({ policy: () => 'reload' });
    const id = h.add();
    h.disk.set(PATH, { text: 'junk', mtimeMs: 6000, undecodable: true });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('changed');

    h.disk.set(PATH, { text: 'O2000 (good again)', mtimeMs: 7000 });
    await h.service.checkNow();

    expect(h.reloaded).toEqual([id, id]);
    expect(h.docs.get(id)?.external).toBe('none');
    expect(h.docs.get(id)?.disk).toEqual(stampOf('O2000 (good again)', 7000));
  });

  it('keeps the stamp a Keep mine would apply', async () => {
    // `forget()` used to run before the await, which dropped `pending` as well: a failed
    // reload followed by "Keep mine" then stopped watching the document altogether.
    const h = harness({ policy: () => 'reload' });
    const id = h.add();
    h.disk.set(PATH, { text: 'junk', mtimeMs: 6000, undecodable: true });
    await h.service.checkNow();

    h.service.keepMine(id);

    expect(h.docs.get(id)?.disk).toEqual(stampOf('junk', 6000));
    expect(h.docs.get(id)?.external).toBe('none');
  });

  it('leaves the banner up when the explicit Reload fails', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: 'junk', mtimeMs: 6000, undecodable: true });
    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('changed');

    await h.service.reload(id);

    expect(h.docs.get(id)?.external).toBe('changed');
  });
});

describe('reload', () => {
  it('goes through fileOps and clears the marker', async () => {
    const h = harness();
    const id = h.add();
    h.disk.set(PATH, { text: 'O2000', mtimeMs: 6000 });
    await h.service.checkNow();
    await h.service.reload(id);
    expect(h.reloaded).toEqual([id]);
    expect(h.docs.get(id)?.external).toBe('none');

    await h.service.checkNow();
    expect(h.docs.get(id)?.external).toBe('none');
    expect(h.messages.filter((m) => m.error)).toEqual([]);
  });
});
