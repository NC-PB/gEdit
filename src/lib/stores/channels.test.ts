// The channel service (plan §7.17, WP12.5): the resolution order with a fake machine
// service, re-resolution on a content change, a machine change, a sibling opening and an
// assignment, and the check with siblings on another machine and on none.

import { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cpOf } from '../../../tests/unit/helpers/profiles';
import type { ChannelParams, SyncHit } from '$lib/core/channels/types';
import type { MachineConfig } from '$lib/core/machines/types';
import type { ChannelBlock } from '$lib/core/machines/validate';
import type { SiblingInfo } from '$lib/platform/commands';
import type { DocId, DocMeta, FileMemo } from '$lib/app/types';

const seen: { perChannel: Record<string, SyncHit[]>; jump: Record<string, number[]> | undefined; documents?: Record<string, string>; deadline?: number }[] = [];
vi.mock('$lib/core/channels/check', () => ({
  checkSyncMarksReport: (perChannel: Record<string, SyncHit[]>, _p: unknown, o: { jumpLines?: Record<string, number[]>; documents?: Record<string, string>; deadline?: number } = {}) => {
    seen.push({ perChannel, jump: o.jumpLines, documents: o.documents, deadline: o.deadline });
    return { findings: [], truncated: false };
  },
  checkSyncMarks: (perChannel: Record<string, SyncHit[]>, _p: unknown, o: { jumpLines?: Record<string, number[]> } = {}) => {
    seen.push({ perChannel, jump: o.jumpLines });
    return [];
  },
}));
vi.mock('$lib/monaco/editorService', () => ({ editor: {} }));
vi.mock('$lib/stores/machines', () => ({ machines: {} }));
vi.mock('$lib/stores/fileMemory', () => ({ fileMemory: {} }));
vi.mock('$lib/stores/documents', () => ({ docs: {} }));

const { createChannelService } = await import('./channels');
type Service = ReturnType<typeof createChannelService>;

const cp = cpOf('fanuc-lathe');

const WAIT = { id: 'wait', label: 'Waits', match: { kind: 'codes' as const, codes: 'M900-M999' }, partners: { kind: 'all' as const } };

const single: ChannelParams = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Turret A', aliases: ['G13'] },
    { id: '2', name: 'Turret B', aliases: ['G14'] },
  ],
  sectionStart: '(?<![A-Z0-9.])(?<channel>G1[34])(?![\\d.])',
  syncMarks: [WAIT],
};

const multi: ChannelParams = {
  layout: 'multi-file',
  list: [
    { id: '1', name: 'Path 1' },
    { id: '2', name: 'Path 2' },
  ],
  fileName: '^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$',
  syncMarks: [WAIT],
};

const PROGRAM = ['%', 'O1', 'G13', 'M901', 'G0 X1', 'G14', 'M901', 'G0 X2'];

interface World {
  svc: Service;
  docs: DocMeta[];
  lines: Map<DocId, string[]>;
  machinesById: Map<string, MachineConfig>;
  blocks: Map<string, ChannelBlock>;
  docMachine: Map<DocId, string | null>;
  revision: ReturnType<typeof writable<number>>;
  timers: (() => void)[];
  runTimers(): void;
  open(title: string, lines: string[], path?: string | null, machine?: string | null): DocId;
  close(id: DocId): void;
  memory: Map<string, Partial<FileMemo>>;
  siblingAnswer: SiblingInfo[] | 'reject';
  siblingCalls: { path: string; names: string[] }[];
  listStore: ReturnType<typeof writable<DocMeta[]>>;
  /** The fake clock: each `now()` call advances it by `step`. */
  clock: { t: number; step: number };
  /** Every `getLines` call: document, from, to. */
  readCalls: [DocId, number, number][];
  /** While set, `siblingInfo` waits for it (a call that is still out). */
  siblingHold: Promise<void> | null;
}

function world(): World {
  const docs: DocMeta[] = [];
  const listStore = writable<DocMeta[]>(docs);
  const lines = new Map<DocId, string[]>();
  const handlers: ((id: DocId, c: never) => void)[] = [];
  const timers: (() => void)[] = [];
  const revision = writable(0);
  const memory = new Map<string, Partial<FileMemo>>();
  const w = {
    docs,
    lines,
    machinesById: new Map<string, MachineConfig>(),
    blocks: new Map<string, ChannelBlock>(),
    docMachine: new Map<DocId, string | null>(),
    revision,
    timers,
    memory,
    siblingAnswer: [] as SiblingInfo[] | 'reject',
    siblingCalls: [] as { path: string; names: string[] }[],
    listStore,
    clock: { t: 0, step: 0 },
    readCalls: [] as [DocId, number, number][],
    siblingHold: null,
  } as unknown as World;
  let next = 1;
  w.open = (title, text, path = null, machine = 'm1') => {
    const id = `d${next++}`;
    docs.push({ id, title, path } as DocMeta);
    lines.set(id, text);
    w.docMachine.set(id, machine);
    listStore.set([...docs]);
    return id;
  };
  w.close = (id) => {
    docs.splice(docs.findIndex((d) => d.id === id), 1);
    lines.delete(id);
    listStore.set([...docs]);
  };
  w.runTimers = () => {
    while (timers.length > 0) timers.shift()?.();
  };
  w.svc = createChannelService({
    docs: { get: (id) => docs.find((d) => d.id === id), all: () => docs, list: listStore },
    editor: {
      hasModel: (id) => lines.has(id),
      getLineCount: (id) => lines.get(id)?.length ?? 0,
      getLines: (id, a, b) => {
        w.readCalls.push([id, a, b]);
        return (lines.get(id) ?? []).slice(a - 1, b);
      },
      onDidChangeContent: (cb) => {
        handlers.push(cb);
        return () => {};
      },
    },
    effective: (id) => {
      const mid = w.docMachine.get(id);
      if (mid === undefined) return null;
      return { cp, key: `k-${mid}`, machineId: mid, machineName: mid === null ? null : `Machine ${mid}` };
    },
    machine: (id) => w.machinesById.get(id),
    block: (m) => w.blocks.get(m.id) ?? { state: 'absent' },
    machineRevision: revision,
    memory: {
      get: (path) => memory.get(path) as FileMemo | undefined,
      remember: (path, patch) => {
        const merged = { ...(memory.get(path) ?? {}) } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete merged[k];
          else merged[k] = v;
        }
        memory.set(path, merged as Partial<FileMemo>);
      },
    },
    siblingInfo: async (path, names) => {
      w.siblingCalls.push({ path, names });
      if (w.siblingHold !== null) await w.siblingHold;
      if (w.siblingAnswer === 'reject') throw new Error('out of scope');
      return w.siblingAnswer;
    },
    schedule: (fn) => {
      timers.push(fn);
      return () => {
        const at = timers.indexOf(fn);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    now: () => (w.clock.t += w.clock.step),
    caseInsensitive: false,
    delayMs: 150,
  });
  w.svc.start();
  // A content change: the edited span, or (by default) a flush of the whole text.
  (w as unknown as { change: (id: DocId, span?: { startLine: number; endLineOld: number; endLineNew: number }) => void }).change = (id, span) => {
    const count = lines.get(id)?.length ?? 1;
    const change = span ? { ...span, flush: false, versionId: 0 } : { startLine: 1, endLineOld: count, endLineNew: count, flush: true, versionId: 0 };
    handlers.forEach((h) => h(id, change as never));
  };
  return w;
}

const machine = (id: string): MachineConfig => ({ id, name: `Machine ${id}`, profile: 'fanuc-lathe', params: {} });
const valid = (params: ChannelParams): ChannelBlock => ({ state: 'valid', params });

let w: World;
beforeEach(() => {
  w = world();
  seen.length = 0;
});

describe('the resolution order', () => {
  it('answers none without a machine', () => {
    const id = w.open('a.nc', PROGRAM, null, null);
    expect(w.svc.forDoc(id).layout).toBe('none');
  });

  it('answers none for a machine without channels', () => {
    w.machinesById.set('m1', machine('m1'));
    const id = w.open('a.nc', PROGRAM);
    expect(w.svc.forDoc(id).layout).toBe('none');
    expect(w.svc.params(id)).toBeNull();
  });

  it('answers none, with the reason, for a broken block', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', { state: 'invalid', problems: [{ machineId: 'm1', path: 'channels.list', message: 'two channels at least' }] });
    const set = w.svc.forDoc(w.open('a.nc', PROGRAM));
    expect(set.layout).toBe('none');
    expect(set.problems[0].message.key).toBe('channels.problems.blockBroken');
  });

  it('answers none for a machine with channels and no match', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(single));
    const id = w.open('a.nc', ['%', 'O1', 'G0 X1']);
    expect(w.svc.forDoc(id).layout).toBe('none');
  });

  it('finds the sections, the marks and the channel at a line', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(single));
    const id = w.open('a.nc', PROGRAM);
    const set = w.svc.forDoc(id);
    expect(set.layout).toBe('single-file');
    expect(set.members.map((m) => [m.channel.id, m.kind === 'section' ? m.ranges : null])).toEqual([
      ['1', [{ startLine: 3, endLine: 5 }]],
      ['2', [{ startLine: 6, endLine: 8 }]],
    ]);
    expect(set.outside).toEqual([{ startLine: 1, endLine: 2 }]);
    expect(set.marks.map((m) => [m.line, m.mark, m.channel])).toEqual([[4, 'M901', '1'], [7, 'M901', '2']]);
    expect(w.svc.channelAt(id, 4)?.name).toBe('Turret A');
    expect(w.svc.channelAt(id, 1)).toBeNull();
  });
});

describe('re-resolution', () => {
  beforeEach(() => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(single));
  });

  it('keeps answering from the cache while a content change waits for its 150 ms', () => {
    const id = w.open('a.nc', PROGRAM);
    const before = w.svc.forDoc(id);
    let bumps = 0;
    w.svc.revision.subscribe(() => bumps++);
    w.lines.set(id, [...PROGRAM, 'G13', 'M902']);
    (w as unknown as { change(id: DocId): void }).change(id);
    expect(w.svc.forDoc(id)).toBe(before);
    w.runTimers();
    const after = w.svc.forDoc(id);
    expect(after.marks).toHaveLength(3);
    expect(bumps).toBe(2); // the subscribe call itself, then the change
  });

  it('does not bump the revision when a change alters nothing about the channels', () => {
    const id = w.open('a.nc', PROGRAM);
    w.svc.forDoc(id);
    let bumps = 0;
    w.svc.revision.subscribe(() => bumps++);
    w.lines.set(id, PROGRAM.map((l) => (l === 'G0 X2' ? 'G0 X3' : l)));
    (w as unknown as { change(id: DocId): void }).change(id);
    w.runTimers();
    expect(bumps).toBe(1);
  });

  it('patches the resolution from the edited lines only, and reads everything when a section start is edited (F2)', () => {
    const change = (w as unknown as { change(id: DocId, span?: { startLine: number; endLineOld: number; endLineNew: number }): void }).change;
    const id = w.open('a.nc', PROGRAM);
    w.svc.forDoc(id);
    w.readCalls.length = 0;
    // A wait typed as a new line after line 5 ('G0 X1'), in channel 1.
    w.lines.set(id, ['%', 'O1', 'G13', 'M901', 'G0 X1', 'M902', 'G14', 'M901', 'G0 X2']);
    change(id, { startLine: 5, endLineOld: 5, endLineNew: 6 });
    w.runTimers();
    const set = w.svc.forDoc(id);
    expect(set.marks.map((m) => [m.mark, m.line, m.channel])).toEqual([
      ['M901', 4, '1'],
      ['M902', 6, '1'],
      ['M901', 8, '2'],
    ]);
    expect(set.members.map((m) => (m.kind === 'section' ? [m.channel.id, m.ranges] : null))).toEqual([
      ['1', [{ startLine: 3, endLine: 6 }]],
      ['2', [{ startLine: 7, endLine: 9 }]],
    ]);
    expect(w.readCalls).toEqual([[id, 5, 6]]); // the edited lines, not the document
    // The section start of channel 2 edited away: only the whole document can say.
    w.readCalls.length = 0;
    w.lines.set(id, ['%', 'O1', 'G13', 'M901', 'G0 X1', 'M902', 'G0 X9', 'M901', 'G0 X2']);
    change(id, { startLine: 7, endLineOld: 7, endLineNew: 7 });
    w.runTimers();
    expect(w.readCalls.some(([, a, b]) => a === 1 && b === 9)).toBe(true);
    expect(w.svc.forDoc(id).members.map((m) => m.channel.id)).toEqual(['1']);
  });

  it('says an abandoned resolution and tries once more (F4)', () => {
    w.clock.step = 400; // every reading of the clock is 400 ms later: past the 500 ms budget at once
    const id = w.open('a.nc', PROGRAM);
    const set = w.svc.forDoc(id);
    expect(set.layout).toBe('none');
    expect(set.problems.map((p) => p.message.key)).toEqual(['channels.problems.tooSlow']);
    expect(w.timers).toHaveLength(1); // the one retry
    w.clock.step = 0;
    w.runTimers();
    expect(w.svc.forDoc(id).layout).toBe('single-file');
    expect(w.timers).toHaveLength(0);
  });

  it('retries a resolution that runs out of time after a successful retry, also when `fresh` runs it (PERF-3)', () => {
    const change = (w as unknown as { change(id: DocId): void }).change;
    w.clock.step = 400;
    const id = w.open('a.nc', PROGRAM);
    w.svc.forDoc(id); // abandoned, one retry pending
    w.clock.step = 0;
    w.runTimers(); // the retry succeeds
    expect(w.svc.forDoc(id).layout).toBe('single-file');
    // An edit, and Alt+F7 (`fresh`) before its 150 ms, under load again.
    w.lines.set(id, [...PROGRAM, 'G0 X3']);
    change(id);
    w.clock.step = 400;
    expect(w.svc.fresh(id).problems.map((p) => p.message.key)).toEqual(['channels.problems.tooSlow']);
    expect(w.timers).toHaveLength(1); // its own retry
    w.clock.step = 0;
    w.runTimers();
    expect(w.svc.forDoc(id).layout).toBe('single-file');
    // `fresh` that runs a pending retry early runs it as the retry: no second one.
    w.lines.set(id, [...PROGRAM, 'G0 X4']);
    change(id);
    w.clock.step = 400;
    w.timers.shift()?.(); // the edit's resolution runs out of time: one retry pending
    expect(w.timers).toHaveLength(1);
    w.svc.fresh(id); // runs the retry now, out of time again
    expect(w.timers).toHaveLength(0);
  });

  it('re-reads the machine on a machine revision', () => {
    const id = w.open('a.nc', PROGRAM);
    expect(w.svc.forDoc(id).layout).toBe('single-file');
    w.blocks.set('m1', { state: 'absent' });
    w.revision.update((n) => n + 1);
    expect(w.svc.forDoc(id).layout).toBe('none');
  });
});

describe('one file per channel', () => {
  beforeEach(() => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(multi));
  });

  const MARKS = ['O1', 'M901 P12'];

  it('ties the document to its channel by the file name and asks about the sibling once', async () => {
    const id = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    const first = w.svc.forDoc(id);
    expect(first.layout).toBe('multi-file');
    expect(first.self?.id).toBe('1');
    expect(first.missing.map((c) => c.id)).toEqual(['2']);
    w.siblingAnswer = [{ name: 'part_CH2.nc', exists: true, bytes: 3, modified: null, error: null }];
    w.runTimers();
    await Promise.resolve();
    await Promise.resolve();
    const second = w.svc.forDoc(id);
    expect(w.siblingCalls).toEqual([{ path: '/jobs/part_CH1.nc', names: ['part_CH2.nc'] }]);
    expect(second.missing).toEqual([]);
    expect(second.members[1]).toMatchObject({ kind: 'file', name: 'part_CH2.nc', exists: true, docId: null, by: 'fileName', path: '/jobs/part_CH2.nc' });
    // Not asked again.
    w.svc.forDoc(id);
    w.runTimers();
    expect(w.siblingCalls).toHaveLength(1);
  });

  it('treats an unavailable answer as unknown, not as missing for good', async () => {
    const id = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    w.svc.forDoc(id);
    w.siblingAnswer = [{ name: 'part_CH2.nc', exists: false, bytes: 0, modified: null, error: 'unavailable' }];
    await w.svc.siblings(id);
    const set = w.svc.forDoc(id);
    expect(set.problems.map((p) => p.message.key)).toContain('channels.problems.siblingUnknown');
  });

  it('reads a refused call as "could not be checked", not "not found"', async () => {
    const id = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    w.svc.forDoc(id);
    w.siblingAnswer = 'reject';
    await w.svc.siblings(id);
    const set = w.svc.forDoc(id);
    expect(set.missing.map((c) => c.id)).toEqual(['2']);
    expect(set.problems.map((p) => p.message.key)).toContain('channels.problems.siblingUnknown');
  });

  it('finds the sibling when it opens, and loses it when it closes', () => {
    const one = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    expect(w.svc.forDoc(one).members).toHaveLength(1);
    const two = w.open('part_CH2.nc', ['O2', 'M901 P12'], '/jobs/part_CH2.nc');
    const set = w.svc.forDoc(one);
    expect(set.members.map((m) => (m.kind === 'file' ? [m.channel.id, m.docId] : null))).toEqual([['1', one], ['2', two]]);
    w.close(two);
    expect(w.svc.forDoc(one).members).toHaveLength(1);
  });

  it('does not pair files of two different jobs', () => {
    const a = w.open('a_CH1.nc', MARKS, '/jobs/a_CH1.nc');
    w.open('b_CH2.nc', MARKS, '/jobs/b_CH2.nc');
    expect(w.svc.forDoc(a).members).toHaveLength(1);
  });

  it('an assignment ties a document no pattern claims, and survives in the file memory', () => {
    const odd = w.open('odd.nc', MARKS, '/jobs/odd.nc');
    expect(w.svc.forDoc(odd).layout).toBe('none');
    expect(w.svc.unassigned(odd)).toBe(true);
    const one = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    w.svc.assign(odd, '2');
    expect(w.memory.get('/jobs/odd.nc')).toMatchObject({ channelId: '2' });
    expect(w.svc.forDoc(odd).self?.id).toBe('2');
    expect(w.svc.forDoc(one).members.map((m) => m.channel.id)).toEqual(['1', '2']);
    w.svc.assign(odd, null);
    expect(w.svc.forDoc(odd).layout).toBe('none');
    expect(w.memory.get('/jobs/odd.nc')).not.toHaveProperty('channelId');
  });

  it('refuses an assignment to a channel the machine does not declare', () => {
    const odd = w.open('odd.nc', MARKS, '/jobs/odd.nc');
    w.svc.assign(odd, '9');
    expect(w.svc.forDoc(odd).layout).toBe('none');
  });
});

describe('check', () => {
  it('groups the marks of one program per channel, outside marks under ""', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(single));
    const id = w.open('a.nc', ['M909', ...PROGRAM]);
    const result = w.svc.check(id);
    expect(result.checked).toEqual(['1', '2']);
    expect(Object.keys(seen[0].perChannel).sort()).toEqual(['', '1', '2']);
    expect(result.notChecked).toEqual([]);
  });

  it('checks a sibling on another machine, and on none, under the initiating machine, and names both', () => {
    w.machinesById.set('m1', machine('m1'));
    w.machinesById.set('m2', machine('m2'));
    w.blocks.set('m1', valid(multi));
    w.blocks.set('m2', { state: 'absent' });
    const one = w.open('p_CH1.nc', ['M901 P12'], '/j/p_CH1.nc', 'm1');
    const two = w.open('p_CH2.nc', ['M901 P12'], '/j/p_CH2.nc', 'm2');
    let r = w.svc.check(one);
    expect(r.checked).toEqual(['1', '2']);
    expect(r.otherMachines).toEqual([{ channel: '2', docId: two, machineName: 'Machine m2' }]);
    expect(seen[0].perChannel['2']).toHaveLength(1);
    expect(seen[0].documents).toEqual({ '1': 'p_CH1.nc', '2': 'p_CH2.nc' });
    expect(seen[0].deadline).toBe(1000);
    w.docMachine.set(two, null);
    r = w.svc.check(one);
    expect(r.otherMachines).toEqual([{ channel: '2', docId: two, machineName: null }]);
    expect(r.checked).toEqual(['1', '2']);
  });

  it('lists the marks of a shared section under every channel it names', () => {
    const shared: ChannelParams = {
      layout: 'single-file',
      list: [
        { id: 's1', name: 'S1' },
        { id: 's3', name: 'S3' },
      ],
      sectionStart: '^\\+(?<channel>[A-Z0-9/]+)$',
      syncMarks: [WAIT],
    };
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(shared));
    const id = w.open('a.nc', ['+S1/S3', 'M901', '+S1', 'G0 X1']);
    const set = w.svc.forDoc(id);
    expect(set.marks.map((m) => m.channel)).toEqual(['s1', 's3']);
    w.svc.check(id);
    expect(seen[0].perChannel.s1).toHaveLength(1);
    expect(seen[0].perChannel.s3).toHaveLength(1);
  });

  it('says so when two header markers name different channels', () => {
    const marked: ChannelParams = { ...multi, marker: '^\\(CHANNEL (?<channel>\\d+)\\)' };
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(marked));
    const id = w.open('p.nc', ['(CHANNEL 1)', '(CHANNEL 2)', 'M901 P12'], '/j/p.nc');
    const set = w.svc.forDoc(id);
    expect(set.layout).toBe('none');
    expect(set.problems.map((p) => p.message.key)).toContain('channels.problems.markerConflict');
  });

  it('names the channels that are not open', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(multi));
    const one = w.open('p_CH1.nc', ['M901 P12'], '/j/p_CH1.nc');
    const r = w.svc.check(one);
    expect(r.checked).toEqual(['1']);
    expect(r.notChecked.map((c) => c.id)).toEqual(['2']);
  });

  it('hands the jump lines of the provider to the check', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(single));
    w.svc.useJumpLines((_id, _cp, channelOf) => ({ [String(channelOf(4))]: [4] }));
    w.svc.check(w.open('a.nc', PROGRAM));
    expect(seen[0].jump).toEqual({ '1': [4] });
  });

  it('answers nothing for a document without channels', () => {
    expect(w.svc.check(w.open('a.nc', PROGRAM, null, null))).toEqual({ truncated: false, findings: [], checked: [], notChecked: [], otherMachines: [] });
  });
});

describe('fixes of the M12 review', () => {
  const MARKS = ['O1', 'M901 P12'];

  it('fresh() applies a change that still waits for its 150 ms (CODE-5)', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(single));
    const id = w.open('a.nc', PROGRAM);
    expect(w.svc.forDoc(id).marks).toHaveLength(2);
    w.lines.set(id, ['G13', 'M902', 'M903', ...PROGRAM]);
    (w as unknown as { change(id: DocId): void }).change(id);
    expect(w.svc.forDoc(id).marks).toHaveLength(2); // the stale answer, as before
    const now = w.svc.fresh(id);
    expect(now.marks).toHaveLength(4);
    expect(now.members[0].kind === 'section' && now.members[0].ranges[0].startLine).toBe(1);
    expect(w.svc.forDoc(id)).toBe(now);
    w.runTimers(); // nothing is left to run
    expect(w.svc.forDoc(id)).toBe(now);
  });

  it('reads at most the marker window of a sibling, and each sibling once per assembly (CODE-6)', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid({ ...multi, list: [...multi.list, { id: '3', name: 'Path 3' }, { id: '4', name: 'Path 4' }] }));
    const big = Array.from({ length: 5000 }, (_, i) => `G1 X${i}`);
    const one = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    const other = w.open('other.nc', big, '/jobs/other.nc');
    w.open('more.nc', big, '/jobs/more.nc');
    w.readCalls.length = 0;
    w.svc.forDoc(one);
    const sibling = w.readCalls.filter(([id]) => id === other);
    expect(sibling).toHaveLength(1);
    expect(Math.max(...w.readCalls.filter(([id]) => id !== one).map(([, , to]) => to))).toBeLessThanOrEqual(400);
  });

  it('asks again when the first answer was never asked for the name the file has now (CODE-7 a)', async () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(multi));
    const id = w.open('x.nc', MARKS, '/jobs/x.nc');
    w.svc.assign(id, '1');
    w.svc.forDoc(id);
    w.runTimers();
    await Promise.resolve();
    expect(w.siblingCalls).toHaveLength(0); // not a channel file name: nothing to ask
    w.docs[0].path = '/jobs/part_CH1.nc';
    w.listStore.set([...w.docs]);
    w.svc.forDoc(id);
    w.runTimers();
    await Promise.resolve();
    expect(w.siblingCalls).toEqual([{ path: '/jobs/part_CH1.nc', names: ['part_CH2.nc'] }]);
  });

  it('asks again when the path changed while the call was out (CODE-7 b)', async () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(multi));
    const id = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    w.svc.forDoc(id);
    let release: () => void = () => {};
    w.siblingHold = new Promise<void>((resolve) => (release = resolve));
    w.runTimers();
    await Promise.resolve();
    expect(w.siblingCalls.map((c) => c.path)).toEqual(['/jobs/part_CH1.nc']);
    w.docs[0].path = '/jobs/job2_CH1.nc'; // Save As while the call is out
    w.listStore.set([...w.docs]);
    w.svc.forDoc(id);
    w.siblingHold = null;
    release();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    w.runTimers();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(w.siblingCalls.map((c) => c.path)).toEqual(['/jobs/part_CH1.nc', '/jobs/job2_CH1.nc']);
  });

  it('gives the sibling reads of check() a budget and says so (CODE-1 part 3)', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(multi));
    const one = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    const long = Array.from({ length: 3000 }, (_, i) => (i === 0 ? 'O2' : `G1 X${i}`));
    w.open('part_CH2.nc', long, '/jobs/part_CH2.nc');
    expect(w.svc.check(one).truncated).toBe(false);
    w.clock.step = 400; // each reading of the clock costs 400 ms: the 500 ms budget is gone after two
    expect(w.svc.check(one).truncated).toBe(true);
  });

  it('reports the lines of another open channel that were too long to read', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(multi));
    const one = w.open('part_CH1.nc', MARKS, '/jobs/part_CH1.nc');
    w.open('part_CH2.nc', ['O2', 'M901 ' + 'X'.repeat(1500), 'M30'], '/jobs/part_CH2.nc');
    expect(w.svc.check(one).longLines).toEqual([{ channel: '2', count: 1 }]);
  });
});

describe('waitCodeRule (M12.5, §7.16 #178)', () => {
  const builder: ChannelParams = {
    ...multi,
    syncMarks: [
      { id: 'waitm', label: 'WAITM', match: { kind: 'regex', pattern: '\\bWAITM\\((?<mark>\\d+)' }, partners: { kind: 'all' } },
      { id: 'wait', label: 'Waiting M-code of this builder', match: { kind: 'codes', codes: 'M190-M199' }, partners: { kind: 'all' } },
    ],
  };

  it('names the codes rule of the document’s machine that lists the word, with the machine', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(builder));
    const id = w.open('PART_1.ISO', ['M198']);
    expect(w.svc.waitCodeRule(id, 'M', 198)).toEqual({ ruleId: 'wait', label: 'Waiting M-code of this builder', machineName: 'Machine m1', semantics: 'rendezvous' });
    expect(w.svc.waitCodeRule(id, 'm', 190)?.ruleId).toBe('wait');
  });

  it('answers null for a word the list does not name, and without a machine or a valid block', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid(builder));
    const id = w.open('PART_1.ISO', ['M198']);
    expect(w.svc.waitCodeRule(id, 'M', 98)).toBeNull();
    expect(w.svc.waitCodeRule(id, 'M', 200)).toBeNull();
    expect(w.svc.waitCodeRule(w.open('b.nc', ['M198'], null, null), 'M', 198)).toBeNull();
    w.machinesById.set('m2', machine('m2'));
    w.blocks.set('m2', { state: 'invalid', problems: [] });
    expect(w.svc.waitCodeRule(w.open('c.nc', ['M198'], null, 'm2'), 'M', 198)).toBeNull();
  });

  it('answers without waiting for a resolution, and a blank rule label is null', () => {
    w.machinesById.set('m1', machine('m1'));
    w.blocks.set('m1', valid({ ...builder, syncMarks: [{ ...builder.syncMarks[1], label: '  ' }] }));
    const id = w.open('PART_1.ISO', ['M198']);
    expect(w.svc.waitCodeRule(id, 'M', 195)).toEqual({ ruleId: 'wait', label: null, machineName: 'Machine m1', semantics: 'rendezvous' });
  });
});
