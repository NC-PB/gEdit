// The modal service (Phase 3 plan §6.2, AD-33; P3.1) with a fake editor, fake idle callbacks
// and a fake clock: one index per open document, built in idle slices with the active
// document first, an edit that drops only the later snapshots, a rebuild on a new effective
// key (a machine switch, a profile reload that changed something, a variant the text now
// detects), a closed document dropped, and `null` for a line the build has not reached.
//
// The document store is the real one; the effective view is a table the test changes, the
// way `machines.effective(docId)` changes when a machine or a dialect is switched.

import { get, writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine, noMachine } from '$lib/core/machines/effective';
import { maskComments } from '$lib/core/nc/mask';
import { ModalIndex, ModalInterpreter } from '$lib/core/nc/modal';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { createDocumentStore } from '$lib/stores/documents';
import { createModalService, FALLBACK_GAP_MS, IDLE_BUDGET_MS, modal, runWhenIdle, type ModalServiceInternals, type ModalView } from './modalService';
import type { MachineConfig } from '$lib/core/machines/types';
import type { LineState, ModalState } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';
import type { ContentChange, Disposable, DocId, Eol, FileEncoding, NewDocMeta } from '$lib/app/types';

const PROFILES = new Map<string, Profile>(
  resolveProfiles(BUILTIN_PROFILE_SOURCES).resolved.map((entry) => {
    const checked = validateProfile(entry.profile);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return [checked.profile.id, checked.profile];
  }),
);
const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** A built-in profile's effective view, with no machine or a partial one. */
function viewOf(profileId: string, params?: MachineConfig['params']): ModalView {
  const profile = PROFILES.get(profileId) as Profile;
  const machine =
    params === undefined ? noMachine(profile) : effectiveMachine(profile, { id: 'm', name: 'm', profile: profileId, params }, 'document', {});
  const applied = applyMachine(profile, machine);
  return { cp: compileProfile(applied.profile), db: loadCodeDb(CODE_DBS[applied.codes]), key: `${profileId}|${JSON.stringify(params ?? null)}` };
}

const MILL = viewOf('fanuc-gcode');

/** The states of a fresh walk, power-on first. */
function walk(view: ModalView, lines: readonly string[]): ModalState[] {
  const interp = new ModalInterpreter(view.cp, view.db);
  const out = [interp.state()];
  let state: LineState | undefined;
  lines.forEach((line, i) => {
    const r = tokenizeLine(line, view.cp, state);
    state = r.state;
    interp.update(r.tokens, i + 1, maskComments(line, view.cp));
    out.push(interp.state());
  });
  return out;
}

/** `n` lines of a mill program whose state changes on most lines. */
function program(n: number, feed = 'F100.'): string[] {
  const pool = ['G0 X0. Y0.', `G1 X10. ${feed}`, 'T2 M6', 'S1200 M3', 'G81 X5. Z-3. R1.', 'G80', 'G91 X1.', 'G90 Y2.'];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

const META: NewDocMeta = {
  path: null,
  untitledIndex: 1,
  profileId: 'fanuc-gcode',
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

interface Task {
  fn: () => void;
  cancelled: boolean;
}

function harness(o: { budgetMs?: number } = {}) {
  const docs = createDocumentStore({ caseInsensitivePaths: false });
  const lines = new Map<DocId, string[]>();
  /** Documents whose text the editor only has queued (`hasModel` is true for them, `model` is undefined). */
  const queued = new Set<DocId>();
  const reads = { getLines: 0, getLineCount: 0 };
  const views = new Map<DocId, ModalView | null>();
  const idle: Task[] = [];
  const timers: Task[] = [];
  const machineRevision = writable(0);
  const profileRevision = writable(0);
  let onContent: (id: DocId, change: ContentChange) => void = () => {};
  let onCreate: (id: DocId) => void = () => {};
  let version = 1;
  let effectiveCalls = 0;
  const queue = (list: Task[], fn: () => void): Disposable => {
    const task = { fn, cancelled: false };
    list.push(task);
    return () => {
      task.cancelled = true;
    };
  };

  const service: ModalServiceInternals = createModalService({
    docs,
    editor: {
      // A realized model only: a queued one is `hasModel` for the real editor, not `model`.
      model: (id) => (lines.has(id) && !queued.has(id) ? ({} as never) : undefined),
      getLineCount: (id) => {
        reads.getLineCount++;
        return lines.get(id)?.length ?? 0;
      },
      getLines: (id, from, to) => {
        reads.getLines++;
        return (lines.get(id) ?? []).slice(Math.max(1, from) - 1, to);
      },
      onDidChangeContent: (cb) => {
        onContent = cb;
        return () => (onContent = () => {});
      },
      onDidCreateModel: (cb) => {
        onCreate = cb;
        return () => (onCreate = () => {});
      },
    },
    effective: (id) => {
      effectiveCalls++;
      return views.has(id) ? (views.get(id) ?? null) : MILL;
    },
    machineRevision,
    profileRevision,
    idle: (fn) => queue(idle, fn),
    schedule: (fn) => queue(timers, fn),
    every: 10,
    budgetMs: o.budgetMs,
  });
  const stop = service.start();

  /** Runs one idle callback; false when none was queued. */
  function idleOnce(): boolean {
    const task = idle.shift();
    if (task === undefined) return false;
    if (!task.cancelled) task.fn();
    return true;
  }

  return {
    docs,
    service,
    lines,
    views,
    machineRevision,
    profileRevision,
    queued,
    reads,
    /** Fires the created-model event for `id` (Monaco attached and realized its queued model). */
    created: (id: DocId) => onCreate(id),
    stop,
    effectiveCalls: () => effectiveCalls,
    add(text: string[], o: { model?: boolean; activate?: boolean; path?: string | null } = {}): DocId {
      const id = docs.add({ ...META, path: o.path ?? null }, { activate: o.activate ?? true });
      if (o.model !== false) {
        lines.set(id, text);
        onCreate(id);
      }
      return id;
    },
    createModel(id: DocId, text: string[]): void {
      lines.set(id, text);
      onCreate(id);
    },
    /** An edit event with explicit spans (several changes of one event: the span starts at the lowest). */
    spanEdit(id: DocId, startLine: number, apply: (own: string[]) => void): void {
      const own = lines.get(id) as string[];
      const oldCount = own.length;
      apply(own);
      onContent(id, { startLine, endLineOld: oldCount, endLineNew: own.length, flush: false, versionId: ++version });
    },
    /** Replaces line `line` (1-based) with `text`, or inserts it when `insert` is set. */
    edit(id: DocId, line: number, text: string, insert = false): void {
      const own = lines.get(id) as string[];
      if (insert) own.splice(line - 1, 0, text);
      else own[line - 1] = text;
      onContent(id, { startLine: line, endLineOld: line, endLineNew: insert ? line + 1 : line, flush: false, versionId: ++version });
    },
    setText(id: DocId, text: string[]): void {
      lines.set(id, text);
      onContent(id, { startLine: 1, endLineOld: 1, endLineNew: text.length, flush: true, versionId: ++version });
    },
    idleOnce,
    /** Runs every idle callback until nothing is queued; the number that ran. */
    idleAll(): number {
      let ran = 0;
      while (idleOnce()) ran++;
      return ran;
    },
    idlePending: () => idle.filter((task) => !task.cancelled).length,
    /** Runs the pending timers (the key check after an edit). */
    timers(): void {
      for (const task of timers.splice(0)) if (!task.cancelled) task.fn();
    },
  };
}

describe('the modal service', () => {
  it('is the singleton the app context exposes', async () => {
    const { ctx } = await import('./context');
    expect(ctx.modal).toBe(modal);
  });

  it('knows the power-on state at once and a line only once the build reaches it', async () => {
    const h = harness();
    const text = program(95);
    const id = h.add(text);
    const oracle = walk(MILL, text);
    expect(h.service.stateAfter(id, 0)).toEqual(oracle[0]);
    expect(h.service.stateAfter(id, 9)).toEqual(oracle[9]);
    expect(h.service.stateAfter(id, 50)).toBeNull();
    expect(h.service.statesAfter(id, 50, 60)).toBeNull();
    let ready = false;
    void h.service.whenReady(id).then(() => (ready = true));
    h.idleAll();
    await Promise.resolve();
    expect(ready).toBe(true);
    for (let n = 0; n <= text.length; n++) expect(h.service.stateAfter(id, n), `line ${n}`).toEqual(oracle[n]);
    expect(h.service.statesAfter(id, 40, 60)).toEqual(oracle.slice(40, 61));
  });

  it('bumps changed after every slice, so a reader asks again', () => {
    const h = harness();
    const id = h.add(program(200));
    const before = get(h.service.changed);
    h.idleOnce();
    expect(get(h.service.changed)).toBeGreaterThan(before);
    expect(h.service.stateAfter(id, 199)).not.toBeUndefined();
  });

  it('builds the active document first', () => {
    // One slice builds one document; a generous budget keeps a slow CI machine from leaving
    // the active document half built, which is not what this test is about.
    const h = harness({ budgetMs: 10_000 });
    const a = h.add(program(300), { activate: true });
    const b = h.add(program(300), { activate: true }); // b is active now
    h.idleOnce();
    expect(h.service.stateAfter(b, 299)).not.toBeNull();
    expect(h.service.stateAfter(a, 299)).toBeNull();
    h.idleAll();
    expect(h.service.stateAfter(a, 299)).not.toBeNull();
  });

  it('applies an edit at once: earlier lines still answer, later ones wait for the idle build', () => {
    const h = harness();
    const id = h.add(program(100));
    h.idleAll();
    h.edit(id, 45, 'G95 G1 X3. F.25');
    const text = h.lines.get(id) as string[];
    const oracle = walk(MILL, text);
    // Snapshots up to line 40 stand: line 49 replays from there, with the edit.
    expect(h.service.stateAfter(id, 49)).toEqual(oracle[49]);
    expect(h.service.stateAfter(id, 30)).toEqual(oracle[30]);
    expect(h.service.stateAfter(id, 80)).toBeNull();
    expect(h.idlePending()).toBe(1);
    h.idleAll();
    for (let n = 0; n <= text.length; n++) expect(h.service.stateAfter(id, n), `line ${n}`).toEqual(oracle[n]);
  });

  it('follows inserted lines and a flush', () => {
    const h = harness();
    const id = h.add(program(60));
    h.idleAll();
    h.edit(id, 12, 'G95', true);
    h.idleAll();
    expect(h.service.stateAfter(id, 61)).toEqual(walk(MILL, h.lines.get(id) as string[])[61]);
    const other = program(70, 'F.3');
    h.setText(id, other);
    expect(h.service.stateAfter(id, 65)).toBeNull();
    h.idleAll();
    expect(h.service.stateAfter(id, 65)).toEqual(walk(MILL, other)[65]);
  });

  it('rebuilds on a machine switch, from the new effective view', () => {
    const h = harness();
    const id = h.add(program(80));
    h.idleAll();
    const per95 = viewOf('fanuc-gcode', { modalInitial: { feedmode: 'G95' } });
    h.views.set(id, per95);
    h.machineRevision.set(1);
    expect(h.service.stateAfter(id, 0)?.groups.feedmode.from).toBe('machine');
    expect(h.service.stateAfter(id, 75)).toBeNull();
    h.idleAll();
    expect(h.service.stateAfter(id, 75)).toEqual(walk(per95, h.lines.get(id) as string[])[75]);
  });

  it('keeps the index over a profile reload that changed nothing, and rebuilds over one that did', () => {
    const h = harness();
    const id = h.add(program(80));
    h.idleAll();
    // A reload compiles new objects with the same content (AD-29): nothing to rebuild.
    h.views.set(id, { ...viewOf('fanuc-gcode') });
    h.profileRevision.set(1);
    expect(h.service.stateAfter(id, 75)).not.toBeNull();
    expect(h.idlePending()).toBe(0);
    // A dialect switch: the document's profile is a different one.
    h.views.set(id, viewOf('fanuc-lathe'));
    h.profileRevision.set(2);
    expect(h.service.stateAfter(id, 75)).toBeNull();
    expect(h.service.stateAfter(id, 0)?.groups.feedmode.code).toBe('G99');
  });

  it('reads the key again after a pause in typing, not on every keystroke', () => {
    const h = harness();
    const id = h.add(program(80));
    h.idleAll();
    const calls = h.effectiveCalls();
    h.edit(id, 3, 'G1 X2. F50.');
    h.edit(id, 3, 'G1 X2. F60.');
    expect(h.effectiveCalls()).toBe(calls);
    // The text now detects another variant: the key the pause reads is a new one.
    h.views.set(id, viewOf('fanuc-gcode', { modalInitial: { feedmode: 'G95' } }));
    h.timers();
    expect(h.effectiveCalls()).toBe(calls + 1);
    expect(h.service.stateAfter(id, 0)?.groups.feedmode.from).toBe('machine');
  });

  it('answers null without a profile and comes back with one', () => {
    const h = harness();
    const id = h.docs.add({ ...META });
    // The profile goes away (a reload that lost it for a moment, AD-29).
    h.views.set(id, null);
    h.machineRevision.set(4);
    h.createModel(id, program(30));
    expect(h.service.stateAfter(id, 0)).toBeNull();
    h.views.set(id, MILL);
    h.machineRevision.set(5);
    expect(h.service.stateAfter(id, 0)).toEqual(walk(MILL, [])[0]);
  });

  it('waits for the model before it builds anything, and says so', async () => {
    const h = harness();
    const id = h.add([], { model: false });
    let ready = false;
    void h.service.whenReady(id).then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(h.service.stateAfter(id, 1)).toBeNull();
    h.createModel(id, program(40));
    h.idleAll();
    await Promise.resolve();
    expect(ready).toBe(true);
    expect(h.service.stateAfter(id, 40)).toEqual(walk(MILL, program(40))[40]);
  });

  it('drops a closed document, and a waiter on it does not hang', async () => {
    const h = harness();
    const id = h.add(program(300));
    const waiting = h.service.whenReady(id);
    h.docs.remove(id);
    await expect(waiting).resolves.toBeUndefined();
    expect(h.service.stateAfter(id, 0)).toBeNull();
    expect(h.service.statesAfter(id, 0, 5)).toBeNull();
    await expect(h.service.whenReady(id)).resolves.toBeUndefined();
    expect(h.idleAll()).toBeLessThanOrEqual(1);
  });

  it('answers null for a document it does not know', async () => {
    const h = harness();
    expect(h.service.stateAfter('nope', 0)).toBeNull();
    await expect(h.service.whenReady('nope')).resolves.toBeUndefined();
  });

  it('stops listening and drops every index when stopped', () => {
    const h = harness();
    const id = h.add(program(300));
    h.stop();
    expect(h.idleAll()).toBeLessThanOrEqual(1);
    h.edit(id, 2, 'G95');
    expect(h.idlePending()).toBe(0);
  });
  // -- P3a review fixes: the code batch ---------------------------------------------------

  it('CODE-1: does not read or build a model that is only queued, and starts when Monaco realizes it', () => {
    const h = harness();
    const id = h.add([], { model: false });
    h.queued.add(id);
    h.lines.set(id, program(300));
    h.reads.getLines = 0;
    h.reads.getLineCount = 0;
    h.created(id); // `createModel` before Monaco: the editor has the text (queued), not a model
    h.setText(id, program(300));
    expect(h.reads).toEqual({ getLines: 0, getLineCount: 0 });
    expect(h.idlePending()).toBe(0);
    expect(h.service.stateAfter(id, 50)).toBeNull();

    h.queued.delete(id);
    h.created(id); // `doAttach` realized it and said so
    expect(h.idlePending()).toBe(1);
    h.idleAll();
    expect(h.service.stateAfter(id, 300)).toEqual(walk(MILL, program(300))[300]);
  });

  it('CODE-2: the revision of a document does not move for the slice of another document', () => {
    const h = harness({ budgetMs: 0 });
    const a = h.add(program(100), { activate: true });
    const b = h.add(program(100), { activate: true }); // b is built first
    const before = h.service.revisionOf(a);
    for (let i = 0; i < 30; i++) h.idleOnce();
    expect(h.service.stateAfter(b, 25)).not.toBeNull(); // b advanced
    expect(h.service.revisionOf(a)).toBe(before);
    expect(h.service.revisionOf('nope')).toBe(0);
  });

  it('CODE-2: the revision moves on an edit, a rebuild, and the slice that reaches a line a reader waited for', () => {
    const h = harness({ budgetMs: 0 });
    const id = h.add(program(100));
    const start = h.service.revisionOf(id);
    // A reader asks for line 55 and is told "not yet".
    expect(h.service.stateAfter(id, 55)).toBeNull();
    let ran = 0;
    while (h.service.revisionOf(id) === start && h.idleOnce()) ran++;
    // One line per slice and a snapshot every 10 lines: snapshot 5 (line 50) answers line 55.
    expect(ran).toBeGreaterThanOrEqual(50);
    expect(ran).toBeLessThan(60);
    expect(h.service.stateAfter(id, 55)).not.toBeNull();

    // CODE-8: the line of a snapshot is answered from the one before it, so a reader waiting for line 50 is reached by
    // snapshot 4 (after 40 lines), not by 5 (a bump that came earlier would be followed by a bump per slice).
    const h2 = harness({ budgetMs: 0 });
    const id2 = h2.add(program(100));
    const start2 = h2.service.revisionOf(id2);
    expect(h2.service.stateAfter(id2, 50)).toBeNull();
    let ran2 = 0;
    while (h2.service.revisionOf(id2) === start2 && h2.idleOnce()) ran2++;
    expect(ran2).toBeGreaterThanOrEqual(40);
    expect(ran2).toBeLessThan(50);
    expect(h2.service.stateAfter(id2, 50)).not.toBeNull();
    const after2 = h2.service.revisionOf(id2);
    for (let i = 0; i < 8; i++) h2.idleOnce();
    expect(h2.service.revisionOf(id2)).toBe(after2);

    // Slices that reach nothing a reader asked for leave it where it is.
    const settled = h.service.revisionOf(id);
    for (let i = 0; i < 20; i++) h.idleOnce();
    expect(h.service.revisionOf(id)).toBe(settled);

    h.edit(id, 3, 'G95');
    const edited = h.service.revisionOf(id);
    expect(edited).toBeGreaterThan(settled);
    h.setText(id, program(100, 'F.3'));
    expect(h.service.revisionOf(id)).toBeGreaterThan(edited);
  });

  it('CODE-2: a line beyond the end of the document is never waited for (no revision per slice)', () => {
    const h = harness({ budgetMs: 0 });
    const id = h.add(program(100));
    expect(h.service.stateAfter(id, 500)).toBeNull();
    const before = h.service.revisionOf(id);
    for (let i = 0; i < 30; i++) h.idleOnce();
    expect(h.service.revisionOf(id)).toBe(before);
  });

  it('CODE-3: a profile, a code file or a script gets no index and no idle work', async () => {
    const h = harness();
    const py = h.add(program(300), { path: '/cfg/scripts/mine.py' });
    const json = h.add(program(300), { path: 'C:\\cfg\\profiles\\mine.JSON' });
    expect(h.service.stateAfter(py, 0)).toBeNull();
    expect(h.service.statesAfter(json, 0, 5)).toBeNull();
    expect(h.idlePending()).toBe(0);
    await expect(h.service.whenReady(py)).resolves.toBeUndefined();
    // The same text in an NC file is built.
    const nc = h.add(program(300), { path: '/progs/a.nc' });
    expect(h.idlePending()).toBe(1);
    h.idleAll();
    expect(h.service.stateAfter(nc, 299)).not.toBeNull();
  });

  it('P3.4 (owner, 2026-10-09): an idle slice is 8 ms, and the service hands exactly that to the index', () => {
    expect(IDLE_BUDGET_MS).toBe(8);
    const spy = vi.spyOn(ModalIndex.prototype, 'buildSome');
    try {
      const h = harness(); // no budget of its own: the default
      h.add(program(200));
      h.idleOnce();
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls.every(([budget]) => budget === 8)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('P3.4: one idle slice of a 300k-line document returns within 8 ms plus the line it is on (wall clock, median of seven)', () => {
    const h = harness();
    h.add(program(300_000));
    h.idleOnce(); // warm up (regexes compile on first use)
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const started = performance.now();
      h.idleOnce();
      runs.push(performance.now() - started);
    }
    expect(h.idlePending(), 'the build is far from done after eight slices').toBe(1);
    runs.sort((a, b) => a - b);
    expectWithin(runs[3], 8 + 4, 'one idle slice, median of seven');
  });

  it('CODE-3: with no idle clock a slice is a frame away from the one before', () => {
    vi.useFakeTimers();
    try {
      const ran = vi.fn();
      runWhenIdle(ran);
      vi.advanceTimersByTime(15); // one frame is 16 ms
      expect(ran).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(ran).toHaveBeenCalledTimes(1);
      expect(FALLBACK_GAP_MS).toBe(16);
      // A cancelled slice never runs.
      const cancelled = vi.fn();
      runWhenIdle(cancelled)();
      vi.advanceTimersByTime(100);
      expect(cancelled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('CODE-12: an event with several changes drops the snapshots from its lowest line', () => {
    const h = harness();
    const id = h.add(program(300));
    h.idleAll();
    // Two edits in one event (undo of a multi-cursor edit): lines 10 and 250. Monaco reports the
    // span from the lowest start.
    h.spanEdit(id, 10, (own) => {
      own[9] = 'G95 G1 X3. F.25';
      own[249] = 'G94';
    });
    const oracle = walk(MILL, h.lines.get(id) as string[]);
    expect(h.service.stateAfter(id, 9)).toEqual(oracle[9]);
    expect(h.service.stateAfter(id, 60)).toBeNull(); // dropped from line 10, not from line 250
    h.idleAll();
    for (let n = 0; n <= 300; n += 7) expect(h.service.stateAfter(id, n), `line ${n}`).toEqual(oracle[n]);
  });

  it('CODE-12: the first dirty flip of the document list, before the content event, changes nothing', () => {
    const h = harness();
    const id = h.add(program(100));
    h.idleAll();
    // `syncDirty` updates the document before `onDidChangeContent` reaches the service.
    h.docs.update(id, { textDirty: true });
    h.edit(id, 40, 'G95 G1 X3. F.25');
    const oracle = walk(MILL, h.lines.get(id) as string[]);
    expect(h.service.stateAfter(id, 39)).toEqual(oracle[39]);
    h.idleAll();
    expect(h.service.stateAfter(id, 100)).toEqual(oracle[100]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
