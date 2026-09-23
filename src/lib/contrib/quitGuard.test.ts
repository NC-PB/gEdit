// What the backend is told about unsaved changes, and when (plan §5 WP6.5, AD-20, D27).
//
// The command is a fake and the document list is the real store, because the thing under
// test is the *timing*: the native quit path answers from a flag, so a report that never
// arrives is a Dock quit that throws work away, and one that arrives too often is an IPC
// call on the typing path. Both are counted here.
//
// The `onWillQuit` reset is the one report that is not a flip: it has to go out even when
// the flag is already `false`, because it is the promise `runWillQuit` awaits and the
// last chance to unstick a guard that would otherwise refuse the quit.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import quitGuardContrib, { anyDirty, startQuitGuard } from './quitGuard';
import { createDocumentStore } from '$lib/stores/documents';
import type { Contribution, Disposable, DocMeta, DocumentStore, NewDocMeta } from '$lib/app/types';

function meta(patch: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
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
    ...patch,
  };
}

let docs: DocumentStore;
/** Every value the fake command was called with, in order. */
let sent: boolean[];
let setDirty: (dirty: boolean) => Promise<void>;
/** What `files.onWillQuit` registered, so a test can run the quit path. */
let willQuit: (() => Promise<void> | void) | null;
let offQuit: () => void;

beforeEach(() => {
  docs = createDocumentStore({ caseInsensitivePaths: false });
  sent = [];
  setDirty = vi.fn(async (dirty: boolean): Promise<void> => {
    sent.push(dirty);
  });
  willQuit = null;
  offQuit = vi.fn();
});

function start(): Disposable {
  return startQuitGuard({
    list: docs.list,
    onWillQuit: (cb) => {
      willQuit = cb;
      return offQuit;
    },
    setDirty: (dirty) => setDirty(dirty),
  });
}

describe('anyDirty', () => {
  it('is false for no documents at all', () => {
    expect(anyDirty([])).toBe(false);
  });

  it('follows the derived flag, so an encoding change counts as much as typing', () => {
    docs.add(meta({ metaDirty: true }));
    const list = get(docs.list);
    expect(list[0].textDirty).toBe(false);
    expect(anyDirty(list)).toBe(true);
  });
});

describe('reporting', () => {
  it('reports once at start, even when there is nothing to report', () => {
    const stop = start();
    expect(sent).toEqual([false]);
    stop();
  });

  it('reports the state a restored session starts in', () => {
    docs.add(meta({ textDirty: true }));
    const stop = start();
    expect(sent).toEqual([true]);
    stop();
  });

  it('sends one call per flip, not per change', () => {
    const stop = start();
    const first = docs.add(meta({ untitledIndex: 1 }));
    const second = docs.add(meta({ untitledIndex: 2 }));
    expect(sent).toEqual([false]);

    docs.update(first, { textDirty: true });
    expect(sent).toEqual([false, true]);

    // A second dirty document, a tab move and a metadata change on an already dirty
    // document all leave the answer at "something is unsaved".
    docs.update(second, { textDirty: true });
    docs.move(second, 0);
    docs.update(first, { metaDirty: true });
    expect(sent).toEqual([false, true]);

    // Still one dirty document left: nothing to report.
    docs.update(second, { textDirty: false });
    expect(sent).toEqual([false, true]);

    docs.update(first, { textDirty: false, metaDirty: false });
    expect(sent).toEqual([false, true, false]);
    stop();
  });

  it('reports again when the last dirty document is closed rather than saved', () => {
    const stop = start();
    const id = docs.add(meta({ textDirty: true }));
    expect(sent).toEqual([false, true]);
    docs.remove(id);
    expect(sent).toEqual([false, true, false]);
    stop();
  });

  it('says nothing more once it is disposed', () => {
    const stop = start();
    stop();
    const id = docs.add(meta({ textDirty: true }));
    expect(sent).toEqual([false]);
    expect(offQuit).toHaveBeenCalledOnce();
    // And the quit handler it registered is gone with it.
    docs.remove(id);
    expect(sent).toEqual([false]);
  });

  it('keeps going after a failed call, and warns instead of erroring', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    setDirty = vi.fn(async (dirty: boolean): Promise<void> => {
      sent.push(dirty);
      throw new Error('no backend');
    });
    const stop = start();
    const id = docs.add(meta({ textDirty: true }));
    await Promise.resolve();
    expect(sent).toEqual([false, true]);
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    // The failure is not retried: the next report is the next flip.
    docs.update(id, { textDirty: false });
    expect(sent).toEqual([false, true, false]);
    await Promise.resolve(); // let that rejection be swallowed before the spy goes
    stop();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe('the quit path', () => {
  it('clears the flag once the user has answered the alert', async () => {
    const stop = start();
    docs.add(meta({ textDirty: true }));
    expect(sent).toEqual([false, true]);

    await willQuit?.();

    expect(sent).toEqual([false, true, false]);
    stop();
  });

  it('clears it unconditionally, so a flag that is already false is re-stated', async () => {
    const stop = start();
    expect(sent).toEqual([false]);

    await willQuit?.();

    expect(sent).toEqual([false, false]);
    stop();
  });

  it('is awaited, so the flag is stored before the window is destroyed', async () => {
    let release: (() => void) | null = null;
    setDirty = vi.fn((dirty: boolean): Promise<void> => {
      sent.push(dirty);
      return new Promise<void>((done) => {
        release = done;
      });
    });
    const stop = start();
    let finished = false;
    const pending = Promise.resolve(willQuit?.()).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);

    (release as unknown as () => void)();
    await pending;
    expect(finished).toBe(true);
    stop();
  });

  it('does not reject when the last call fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setDirty = vi.fn(async (): Promise<void> => {
      throw new Error('the window is already going');
    });
    const stop = start();

    await expect(Promise.resolve(willQuit?.())).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    stop();
    warn.mockRestore();
  });
});

describe('the contribution', () => {
  it('has the id its file name promises and declares nothing else', () => {
    // Widened on purpose: `satisfies Contribution` keeps the literal type, and the point
    // here is that the *declared* surface is empty — no command, no ribbon entry, no
    // panel, no status item. This feature is wiring, and §7.11 stays as it is.
    const contrib: Contribution = quitGuardContrib;
    expect(contrib.id).toBe('quitGuard');
    expect(contrib.commands ?? []).toEqual([]);
    expect(contrib.ribbon ?? []).toEqual([]);
    expect(contrib.ribbonGroups ?? []).toEqual([]);
    expect(contrib.panels ?? []).toEqual([]);
    expect(contrib.statusItems ?? []).toEqual([]);
    expect(contrib.keybindingRemovals ?? []).toEqual([]);
  });
});
