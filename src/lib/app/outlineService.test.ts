// The outline service (plan §5 WP3.5, §7.3, AD-12), with a fake editor and a fake clock:
// the chunked first build, the incremental updates, the 150 ms debounce in front of the
// published items, and the lifecycle (profile change, flush, close).
//
// The document store is the real one (a plain svelte/store module); Monaco is replaced by
// a fake that only holds lines and fires the two events the service listens to.

import { get, writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { createDocumentStore } from '$lib/stores/documents';
import { cpOf, profileOf } from '../../../tests/unit/helpers/profiles';
import { computeJumpLines, createOutlineService, groupByChannel, reuseRows, SYNC_ROWS_MAX, type OutlineServiceDeps, type OutlineServiceInternals } from './outlineService';
import { expectWithin, fastest } from '../../../tests/unit/helpers/budget';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { ChannelParams, ChannelSet } from '$lib/core/channels/types';
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
  readOnly: false,
  readOnlyReason: null,
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
    // The document's effective view (AD-31). Without a machine the key is the profile id,
    // so a profile switch still rebuilds the index — and so does a machine switch, which
    // is what the key is there for.
    effective: (id: DocId) => {
      const profileId = docs.get(id)?.profileId;
      const cp = profileId === undefined ? undefined : COMPILED.get(profileId);
      return cp === undefined ? null : { cp, key: profileId as string };
    },
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
    const id = h.add(PROGRAM, 'no-such-profile');
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

// --- M12: the grouped program map, the channel's tool lines, the jump lines --------------

const SECTIONS: ChannelSet = {
  layout: 'single-file',
  self: null,
  members: [
    { kind: 'section', channel: { id: '1', name: 'Turret A', index: 0 }, docId: 'd1', ranges: [{ startLine: 3, endLine: 6 }] },
    { kind: 'section', channel: { id: '2', name: 'Turret B', index: 1 }, docId: 'd1', ranges: [{ startLine: 7, endLine: 9 }, { startLine: 11, endLine: 12 }] },
  ],
  missing: [],
  outside: [{ startLine: 1, endLine: 2 }, { startLine: 10, endLine: 10 }],
  marks: [
    { ruleId: 'w', mark: 'M901', line: 5, channel: '1', partners: ['2'], blocking: true },
    { ruleId: 'w', mark: 'M902', line: 8, channel: '2', partners: ['1'], blocking: false },
    { ruleId: 'w', mark: 'M903', line: 12, channel: '2', partners: ['1'], blocking: true },
    { ruleId: 'stops-and-ends', mark: '', line: 12, channel: '2', partners: ['1'], blocking: true },
  ],
  problems: [],
  truncated: false,
};

describe('the program map with channels', () => {
  const lines = ['O1000 (MAIN)', '(HEAD)', 'G13', 'T1 M6', 'M901', 'X1.', 'G14', 'T2 M6', 'M902', '(SHARED)', 'G14', 'M903'].join('\n');

  it('groups the items by channel, from every range, with the blocking marks as sync rows', () => {
    const h = harness({
      channels: { forDoc: () => SECTIONS, revision: writable(0), ruleLabel: () => 'Waits' },
    });
    const id = h.add(lines);
    h.flush();
    const rows = get(h.outline.items(id));
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ['channel', 'Turret A'],
      ['channel', 'Turret B'],
      ['channel', 'Outside the channels'],
    ]);
    const kids = (n: number): string[] => (rows[n].children ?? []).map((c) => `${c.kind}:${c.line}`);
    expect(kids(0)).toEqual(['tool:4', 'sync:5']);
    expect(kids(1)).toEqual(['tool:8', 'sync:12']);
    expect(kids(2)).toContain('program:1');
    expect((rows[2] as { channelId?: string }).channelId).toBe('');
    // The stops-and-ends mark is the program-end row already; the non-blocking mark is not a row.
    expect(groupByChannel([], SECTIONS, (m) => m.mark)[1].children?.map((c) => c.text)).toEqual(['M903']);
  });

  it('is the P1 tree for a document without channels, and republishes when the channels change', () => {
    const revision = writable(0);
    let set: ChannelSet = { ...SECTIONS, layout: 'none', members: [] };
    const h = harness({ channels: { forDoc: () => set, revision, ruleLabel: () => '' } });
    const id = h.add(lines);
    h.flush();
    expect(get(h.outline.items(id))[0].kind).toBe('program');
    set = SECTIONS;
    revision.update((n) => n + 1);
    h.flush();
    expect(get(h.outline.items(id))[0].kind).toBe('channel');
  });

  it('M13 review NC-10: names a prefix rule\'s marks with the prefix, and an id-less mark by its rule', () => {
    // `M1` + two digits keys `M130` as `30`; the row reads `M130`, not `30`, which looks like a block number.
    const params: ChannelParams = {
      layout: 'single-file',
      list: [
        { id: '1', name: 'Turret A' },
        { id: '2', name: 'Turret B' },
      ],
      syncMarks: [{ id: 'p', label: 'Waits', match: { kind: 'prefix', prefix: 'M1', idDigits: { min: 2, max: 2 } }, partners: { kind: 'all' } }],
    };
    const set: ChannelSet = {
      ...SECTIONS,
      marks: [
        { ruleId: 'p', mark: '30', line: 5, channel: '1', partners: ['2'], blocking: true },
        { ruleId: 'p', mark: '30', line: 12, channel: '2', partners: ['1'], blocking: true },
        { ruleId: 'other', mark: '', line: 8, channel: '2', partners: ['1'], blocking: true },
      ],
    };
    const h = harness({ channels: { forDoc: () => set, revision: writable(0), ruleLabel: (_id, ruleId) => (ruleId === 'other' ? 'Other waits' : ''), params: () => params } });
    const id = h.add(lines);
    h.flush();
    const rows = get(h.outline.items(id));
    const syncs = (n: number): string[] => (rows[n].children ?? []).filter((c) => c.kind === 'sync').map((c) => c.text);
    expect([...syncs(0), ...syncs(1)]).toEqual(['M130', 'Other waits', 'M130']);
    // Without the machine's channel block the ids show as they are keyed. (A copy of the set:
    // the sync rows are cached per set object.)
    const bareSet: ChannelSet = { ...set };
    const bare = harness({ channels: { forDoc: () => bareSet, revision: writable(0), ruleLabel: () => '' } });
    const b = bare.add(lines);
    bare.flush();
    expect((get(bare.outline.items(b))[0].children ?? []).filter((c) => c.kind === 'sync').map((c) => c.text)).toEqual(['30']);
  });

  it('toolLines(id) is the P1 list and toolLines(id, channel) the lines inside that channel', () => {
    const plain = harness();
    const a = plain.add(lines);
    plain.flush();
    const h = harness({ channels: { forDoc: () => SECTIONS, revision: writable(0), ruleLabel: () => '' } });
    const id = h.add(lines);
    h.flush();
    expect(h.outline.toolLines(id)).toEqual(plain.outline.toolLines(a));
    expect(h.outline.toolLines(id)).toEqual([4, 8]);
    expect(h.outline.toolLines(id, '1')).toEqual([4]);
    expect(h.outline.toolLines(id, '2')).toEqual([8]);
  });
});

describe('the program map of a big program with channels (M12 performance fix F1)', () => {
  /** Two sections of `perChannel` lines each, a wait every 15th line, a tool every 3,000th. */
  function big(perChannel: number): { lines: string[]; set: ChannelSet } {
    const lines = ['%'];
    const marks: ChannelSet['marks'] = [];
    const ranges: { startLine: number; endLine: number }[] = [];
    for (const channel of ['1', '2']) {
      const start = lines.length + 1;
      lines.push(`O210${channel}`);
      for (let i = 1; i <= perChannel; i++) {
        if (i % 3000 === 1) lines.push(`T0${channel}01 M6`);
        else if (i % 15 === 0) {
          lines.push(`M${900 + (i % 100)} P12`);
          marks.push({ ruleId: 'w', mark: `M${900 + (i % 100)}`, line: lines.length, channel, partners: [channel === '1' ? '2' : '1'], blocking: true });
        } else lines.push(`G01 X${i % 80}.25 Z-1. F0.2`);
      }
      ranges.push({ startLine: start, endLine: lines.length });
    }
    const set: ChannelSet = {
      layout: 'single-file',
      self: null,
      members: [
        { kind: 'section', channel: { id: '1', name: 'Channel 1', index: 0 }, docId: 'd', ranges: [ranges[0]] },
        { kind: 'section', channel: { id: '2', name: 'Channel 2', index: 1 }, docId: 'd', ranges: [ranges[1]] },
      ],
      missing: [],
      outside: [{ startLine: 1, endLine: 1 }],
      marks,
      problems: [],
      truncated: false,
    };
    return { lines, set };
  }

  it('lists a channel’s waits up to the cap, and past it one row with their number on the first wait', () => {
    const few = big(SYNC_ROWS_MAX * 15);
    const rows = groupByChannel([], few.set, (m) => m.mark);
    expect(rows[0].children?.filter((c) => c.kind === 'sync')).toHaveLength(SYNC_ROWS_MAX);
    const many = big(150_000);
    const grouped = groupByChannel([], many.set, (m) => m.mark);
    for (const [n, channel] of [[0, '1'], [1, '2']] as const) {
      const sync = (grouped[n].children ?? []).filter((c) => c.kind === 'sync');
      const first = many.set.marks.find((m) => m.channel === channel);
      expect(sync).toEqual([{ kind: 'sync', line: first?.line, text: '10000 wait codes (Alt+F7 steps through them)', count: 10_000 }]);
    }
  });

  it('keeps the rows an edit did not change, so the panel redraws only the changed ones', () => {
    const { lines, set } = big(150_000);
    const h = harness({ channels: { forDoc: () => set, revision: writable(0), ruleLabel: () => '' }, chunkLines: 20_000 });
    const id = h.add(lines.join('\n'));
    h.flush();
    const before = get(h.outline.items(id));
    expect(before[0].children?.length).toBeLessThan(SYNC_ROWS_MAX);
    // A tool written over a motion line of channel 1 (no line moves).
    h.edit(id, 20_000, 'T09 M6');
    h.flush();
    const after = get(h.outline.items(id));
    const tools = (n: number, rows: typeof after) => (rows[n].children ?? []).filter((c) => c.kind === 'tool').map((c) => c.line);
    expect(tools(0, after)).toContain(20_000);
    expect(after[1]).toBe(before[1]); // channel 2 untouched: the same object
    expect(after[0].children?.[0]).toBe(before[0].children?.[0]); // the rows before the edit too
    expect(reuseRows(after, groupByChannel([], set, (m) => m.mark))).not.toBe(after);
  });

  it('does not push an edit’s publish back when the channels change while it waits', () => {
    const revision = writable(0);
    const queue: { fn: () => void; ms: number; cancelled: boolean }[] = [];
    const schedule = (fn: () => void, ms: number) => {
      const task = { fn, ms, cancelled: false };
      queue.push(task);
      return () => {
        task.cancelled = true;
      };
    };
    const drain = (): void => {
      for (let task = queue.find((t) => !t.cancelled); task !== undefined; task = queue.find((t) => !t.cancelled)) {
        queue.splice(queue.indexOf(task), 1);
        task.fn();
      }
    };
    const h = harness({ schedule, channels: { forDoc: () => SECTIONS, revision, ruleLabel: () => '' } });
    const id = h.add(['O1000 (MAIN)', 'G13', 'T1 M6', 'M901', 'X1.'].join('\n'));
    drain();
    h.edit(id, 5, 'T3 M6');
    const waiting = queue.filter((t) => !t.cancelled && t.ms === 150);
    expect(waiting).toHaveLength(1);
    // The channels re-resolve on their own 150 ms, just before the map's publish runs.
    revision.update((n) => n + 1);
    expect(waiting[0].cancelled).toBe(false);
    expect(queue.filter((t) => !t.cancelled && t.ms === 150)).toEqual(waiting);
  });

  it('publishes the grouped map of 300k lines with 20,000 waits after an edit within the outline budget (G7)', () => {
    const { lines, set } = big(150_000);
    const h = harness({ channels: { forDoc: () => set, revision: writable(0), ruleLabel: () => '' }, chunkLines: 20_000 });
    const id = h.add(lines.join('\n'));
    h.flush();
    let n = 0;
    const ms = fastest(3, () => {
      h.edit(id, 20_000 + (n++ % 2), n % 2 === 0 ? 'T09 M6' : 'G01 X1.');
      h.flush();
    });
    // The index's own aggregation is P1's; the grouping and the row reuse add little to it.
    expectWithin(ms, 200, 'grouped map after an edit, 300k lines, 20,000 waits');
  });
});

describe('computeJumpLines', () => {
  const lathe = cpOf('fanuc-lathe');
  const channelOf = (line: number): string => (line <= 6 ? 'a' : 'b');

  it('names a targeted block number and a backward jump, and not a plain number', () => {
    const lines = ['N10 G0 X1.', 'N20 M901 P12', 'N30 G1 X2.', 'GOTO 10', 'N40 M902 P12', 'N50 G0'];
    expect(computeJumpLines(lines, lathe, () => 'a')).toEqual({ a: [1, 4] });
  });

  it('keeps a jump inside its own channel', () => {
    const lines = ['N10 G0', 'M901', 'GOTO 10', 'M902', 'G0', 'M903', 'N10 G1', 'M904'];
    expect(computeJumpLines(lines, lathe, channelOf)).toEqual({ a: [1, 3] });
  });

  it('counts a line of a shared section in each of its channels', () => {
    const lines = ['N10 G0', 'M901', 'GOTO 10', 'M902'];
    expect(computeJumpLines(lines, lathe, () => ['a', 'b'])).toEqual({ a: [1, 3], b: [1, 3] });
    // An empty list is "outside every section".
    expect(computeJumpLines(lines, lathe, () => [])).toEqual({ '': [1, 3] });
  });

  it('is empty for a program with no jump', () => {
    expect(computeJumpLines(['N10 M901', 'N20 M902'], lathe, () => 'a')).toEqual({});
  });

  it('names the first and the last line of a Fanuc WHILE/DO/END loop (NC-04)', () => {
    const lines = ['G0 X1.', 'WHILE[#1LT2]DO1', 'M901', '#1=#1+1', 'END1', 'M902'];
    expect(computeJumpLines(lines, lathe, () => 'a')).toEqual({ a: [2, 5] });
  });

  it('names the loop lines of a Sinumerik REPEAT, WHILE, FOR and LOOP, per channel', () => {
    const sinu = cpOf('sinumerik');
    const lines = ['REPEAT', 'WAITM(1,1,2)', 'UNTIL R1>3', 'N10 WHILE R1<3', 'R1=R1+1', 'ENDWHILE', 'LOOP', 'ENDLOOP', 'FOR R1=1 TO 3', 'ENDFOR', '; WHILE in a comment'];
    expect(computeJumpLines(lines, sinu, (line) => (line <= 6 ? 'a' : 'b'))).toEqual({ a: [1, 3, 4, 6], b: [7, 8, 9, 10] });
  });
});

// M13 (WP13.2, AD-29): a reload compiles every profile again. The index is rebuilt for a
// document whose profile reads differently, and only for that one.
describe('a profile reload', () => {
  /** The program map of a Fanuc profile whose comment rule is gone. */
  function withoutStops(): CompiledProfile {
    const profile = structuredClone(profileOf(FANUC));
    profile.outline = profile.outline.filter((rule) => rule.kind !== 'comment');
    return compileProfile(profile);
  }

  function reloading() {
    const revision = writable(0);
    const views = new Map<string, CompiledProfile>(COMPILED);
    const h = harness({
      effective: (id: DocId) => {
        const profileId = h.docs.get(id)?.profileId;
        const cp = profileId === undefined ? undefined : views.get(profileId);
        return cp === undefined ? null : { cp, key: profileId as string };
      },
      profileRevision: revision,
    });
    return { h, views, bump: () => revision.update((n) => n + 1) };
  }

  it('rebuilds the index of a document whose profile reads differently', () => {
    const { h, views, bump } = reloading();
    const id = h.add(PROGRAM);
    h.flush();
    expect(get(h.outline.items(id)).some((item) => item.kind === 'comment')).toBe(true);

    views.set(FANUC, withoutStops());
    bump();
    h.flush();
    expect(get(h.outline.items(id)).some((item) => item.kind === 'comment')).toBe(false);
  });

  it('keeps the index when a reload made an equal profile (a new object, the same content)', () => {
    const { h, views, bump } = reloading();
    const id = h.add(PROGRAM);
    h.flush();
    const before = get(h.outline.items(id));

    views.set(FANUC, cpOf(FANUC));
    bump();
    expect(h.pending()).toBe(0);
    expect(get(h.outline.items(id))).toBe(before);
  });

  it('survives a document whose profile has gone for the moment of the bump', () => {
    const { h, views, bump } = reloading();
    const id = h.add(PROGRAM);
    h.flush();
    views.delete(FANUC);
    expect(() => bump()).not.toThrow();
    expect(get(h.outline.items(id)).length).toBeGreaterThan(0);
  });
});
