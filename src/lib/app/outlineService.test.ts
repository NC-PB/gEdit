// The outline service (plan §5 WP3.5, §7.3, AD-12), with a fake editor and a fake clock:
// the chunked first build, the incremental updates, the 150 ms debounce in front of the
// published items, and the lifecycle (profile change, flush, close).
//
// The document store is the real one (a plain svelte/store module); Monaco is replaced by
// a fake that only holds lines and fires the two events the service listens to.

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { createDocumentStore } from '$lib/stores/documents';
import { createOutlineService, type OutlineServiceDeps, type OutlineServiceInternals } from './outlineService';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { ContentChange, Disposable, DocId, DocumentStore, Eol, FileEncoding, NewDocMeta } from '$lib/app/types';

const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

const COMPILED = new Map<string, CompiledProfile>(
  BUILTIN_PROFILE_JSON.map((raw) => {
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const cp = compileProfile(checked.profile);
    return [cp.profile.id, cp] as const;
  }),
);

/** A queued `setTimeout`, so a test can run the timers by hand. */
interface Task {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

interface Harness {
  docs: DocumentStore;
  outline: OutlineServiceInternals;
  /** Adds a document with `text` and returns its id. */
  add(text: string, profileId?: string): DocId;
  setText(id: DocId, text: string, change?: Partial<ContentChange>): void;
  /** Replaces one line and fires the matching change event. */
  edit(id: DocId, line: number, text: string): void;
  createModel(id: DocId): void;
  /** Runs every queued task, repeatedly, until nothing is left (the whole build). */
  flush(): number;
  /** Runs only the tasks queued with `ms === 0` (the build chunks), once. */
  runChunks(): number;
  pending(): number;
  stop: Disposable;
}

const META: NewDocMeta = {
  path: null,
  untitledIndex: 1,
  profileId: FANUC,
  encoding: { encoding: 'utf-8', hasBom: false } satisfies FileEncoding,
  eol: 'lf' satisfies Eol,
  eolMixedOnLoad: false,
  nul: { leader: 0, trailer: 0, stripped: 0 },
  textDirty: false,
  metaDirty: false,
  disk: null,
  external: 'none',
};

function harness(over: Partial<OutlineServiceDeps> = {}): Harness {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const lines = new Map<DocId, string[]>();
  const tasks: Task[] = [];
  let onContent: (id: DocId, change: ContentChange) => void = () => {};
  let onCreate: (id: DocId) => void = () => {};
  let version = 1;

  const deps: OutlineServiceDeps = {
    docs,
    editor: {
      hasModel: (id) => lines.has(id),
      getLineCount: (id) => lines.get(id)?.length ?? 0,
      getLines: (id, from, to) => (lines.get(id) ?? []).slice(Math.max(1, from) - 1, to),
      onDidChangeContent: (cb) => {
        onContent = cb;
        return () => {
          onContent = () => {};
        };
      },
      onDidCreateModel: (cb) => {
        onCreate = cb;
        return () => {
          onCreate = () => {};
        };
      },
    },
    compiled: (profileId) => COMPILED.get(profileId) ?? null,
    schedule: (fn, ms) => {
      const task: Task = { fn, ms, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    chunkLines: 4,
    delayMs: 150,
    ...over,
  };

  const outline = createOutlineService(deps);

  function run(only?: number): number {
    const queued = tasks.splice(0, tasks.length).filter((task) => !task.cancelled);
    let ran = 0;
    for (const task of queued) {
      if (only !== undefined && task.ms !== only) {
        tasks.push(task);
        continue;
      }
      ran++;
      task.fn();
    }
    return ran;
  }

  return {
    docs,
    outline,
    stop: outline.start(),
    add(text, profileId = FANUC) {
      const id = docs.add({ ...META, profileId });
      lines.set(id, text.split('\n'));
      // What the program map does when a document becomes the active one, and what
      // starts the index (AD-12: after the first render).
      outline.items(id);
      return id;
    },
    setText(id, text, change) {
      const before = lines.get(id)?.length ?? 0;
      lines.set(id, text.split('\n'));
      onContent(id, {
        startLine: 1,
        endLineOld: Math.max(before, 1),
        endLineNew: text.split('\n').length,
        flush: true,
        versionId: ++version,
        ...change,
      });
    },
    edit(id, line, text) {
      const own = lines.get(id) ?? [];
      own[line - 1] = text;
      onContent(id, { startLine: line, endLineOld: line, endLineNew: line, flush: false, versionId: ++version });
    },
    createModel(id) {
      onCreate(id);
    },
    flush() {
      let total = 0;
      for (let i = 0; i < 1000 && tasks.some((task) => !task.cancelled); i++) total += run();
      return total;
    },
    runChunks() {
      return run(0);
    },
    pending() {
      return tasks.filter((task) => !task.cancelled).length;
    },
  };
}

const PROGRAM = ['O1000 (MAIN)', '(ROUGH)', 'T1 M6', 'G0 X0.', 'M1', 'T2 M6', 'X10.', 'M30'].join('\n');

describe('the first build', () => {
  it('is empty until it has run, and never starts inside the call that asked', () => {
    const h = harness();
    const id = h.add(PROGRAM);
    expect(get(h.outline.items(id))).toEqual([]);
    expect(h.pending()).toBeGreaterThan(0);
    h.flush();
    expect(get(h.outline.items(id)).map((item) => item.line)).toEqual([1, 2, 3, 6]);
  });

  it('reads the document in chunks', () => {
    const h = harness();
    const id = h.add(PROGRAM); // 8 lines, 4 per chunk
    h.outline.items(id);
    expect(h.runChunks()).toBe(1);
    // The first chunk alone knows the program and the first tool call, not the second.
    expect(h.outline.toolLines(id)).toEqual([3]);
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([3, 6]);
  });

  it('resolves whenReady once it has finished', async () => {
    const h = harness();
    const id = h.add(PROGRAM);
    let done = false;
    const ready = h.outline.whenReady(id).then(() => {
      done = true;
    });
    h.runChunks();
    expect(done).toBe(false);
    h.flush();
    await ready;
    expect(done).toBe(true);
  });

  it('waits for the model of a document that has none yet', async () => {
    const h = harness();
    const id = h.docs.add(META);
    h.outline.items(id);
    expect(h.flush()).toBe(0);
    expect(get(h.outline.items(id))).toEqual([]);

    const withText = h.add(PROGRAM);
    expect(withText).not.toBe(id);
  });

  it('builds when the Monaco model is created later', () => {
    const h = harness();
    const id = h.docs.add(META);
    h.outline.items(id);
    h.flush();
    expect(get(h.outline.items(id))).toEqual([]);

    const second = h.add(PROGRAM);
    h.createModel(second);
    h.flush();
    expect(h.outline.toolLines(second)).toEqual([3, 6]);
  });
});

describe('updates', () => {
  it('applies a content change and publishes it after the debounce', () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([3, 6]);

    h.edit(id, 4, 'T7 M6');
    // The index is current at once: F7 must not step to a stale line.
    expect(h.outline.toolLines(id)).toEqual([3, 4, 6]);
    // The published store is not, until the 150 ms have passed.
    expect(get(h.outline.items(id)).map((item) => item.line)).toEqual([1, 2, 3, 6]);
    h.flush();
    expect(get(h.outline.items(id)).map((item) => item.line)).toEqual([1, 2, 3, 4, 6]);
  });

  it('coalesces a burst of keystrokes into one publish', () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    let published = 0;
    const stop = h.outline.items(id).subscribe(() => published++);
    published = 0;

    for (let i = 0; i < 10; i++) h.edit(id, 4, `G1 X${i}.`);
    expect(published).toBe(0);
    h.flush();
    expect(published).toBe(1);
    stop();
  });

  it('rebuilds on a flush (setValue, reload, compare)', () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    h.setText(id, ['O2000', 'T9 M6', 'M30'].join('\n'));
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([2]);
    expect(get(h.outline.items(id)).map((item) => item.text)).toEqual(['O2000', 'T9']);
  });

  // A flush empties the index and starts over, so the promise the *first* build resolved
  // must not go on answering: the symbol and folding providers await it and would read an
  // empty tree, which drops every fold arrow and empties the quick outline until the next
  // keystroke.
  it('arms whenReady again on a flush, instead of answering from the emptied index', async () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    await h.outline.whenReady(id);

    h.setText(id, ['O2000', 'T9 M6', 'M30'].join('\n'));
    let done = false;
    const ready = h.outline.whenReady(id).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done, 'whenReady resolved while the index was empty').toBe(false);
    expect(h.outline.snapshot(id)).toEqual([]);

    h.flush();
    await ready;
    expect(done).toBe(true);
    expect(h.outline.toolLines(id)).toEqual([2]);
  });

  it('keeps the pending promise when a flush interrupts an unfinished build', async () => {
    const h = harness();
    const id = h.add(PROGRAM);
    let done = false;
    const ready = h.outline.whenReady(id).then(() => {
      done = true;
    });
    h.runChunks(); // the build has read the first chunk only
    h.setText(id, ['O2000', 'T9 M6', 'M30'].join('\n'));
    h.flush();
    await ready;
    expect(done, 'a waiter from before the flush was stranded').toBe(true);
  });

  // The same window opens on a profile change, which throws the index away as well.
  it('arms whenReady again when the profile changes', async () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    await h.outline.whenReady(id);

    h.docs.update(id, { profileId: KLARTEXT });
    let done = false;
    void h.outline.whenReady(id).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    h.flush();
    await h.outline.whenReady(id);
  });

  it('ignores an edit below what the first build has read', () => {
    const h = harness();
    const id = h.add([...PROGRAM.split('\n'), 'T3 M6', 'M30'].join('\n'));
    h.outline.items(id);
    h.runChunks(); // lines 1..4 are indexed

    // Line 9 is not in the index yet; the build reads it in a later chunk.
    h.edit(id, 9, 'T8 M6');
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([3, 6, 9]);
  });

  it('shifts the build cursor for an edit inside what it has read', () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.outline.items(id);
    h.runChunks(); // lines 1..4

    // An insertion inside the built prefix moves every later line down by one.
    const own = ['O1000 (MAIN)', '(ROUGH)', 'T1 M6', '(EXTRA)', 'G0 X0.', 'M1', 'T2 M6', 'X10.', 'M30'];
    h.setText(id, own.join('\n'), { startLine: 4, endLineOld: 3, endLineNew: 4, flush: false });
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([3, 7]);
    expect(get(h.outline.items(id)).map((item) => item.line)).toEqual([1, 2, 3, 7]);
  });
});

describe('lifecycle', () => {
  it('rebuilds when the document changes its profile', () => {
    const h = harness();
    const id = h.add(['0 BEGIN PGM A MM', '1 * - ROUGH', '2 TOOL CALL 1 Z S100', '3 END PGM A MM'].join('\n'));
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([]); // read as Fanuc: nothing matches

    h.docs.update(id, { profileId: KLARTEXT });
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([3]);
  });

  it('classifies nothing when the profile id is unknown', () => {
    const h = harness();
    const id = h.add(PROGRAM, 'okuma-osp');
    h.flush();
    expect(get(h.outline.items(id))).toEqual([]);
    expect(h.outline.itemAt(id, 3)).toBeNull();
  });

  it('drops the index when the document closes', async () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    expect(h.outline.toolLines(id)).toEqual([3, 6]);

    const ready = h.outline.whenReady(id);
    h.docs.remove(id);
    // A closed document resolves its waiters instead of leaving them hanging.
    await ready;
    expect(h.pending()).toBe(0);
    // Asking again starts from nothing, because the model is gone with the document.
    expect(get(h.outline.items(id))).toEqual([]);
  });

  it('stops listening when the service is stopped', () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    h.stop();
    h.edit(id, 4, 'T7 M6');
    expect(h.pending()).toBe(0);
  });
});

describe('itemAt', () => {
  it('answers the innermost item, live', () => {
    const h = harness();
    const id = h.add(PROGRAM);
    h.flush();
    expect(h.outline.itemAt(id, 4)?.line).toBe(3);
    expect(h.outline.itemAt(id, 5)?.kind).toBe('stop');
    expect(h.outline.itemAt(id, 7)?.line).toBe(6);

    h.edit(id, 4, '(FINISH)');
    expect(h.outline.itemAt(id, 4)?.kind).toBe('comment');
  });
});
