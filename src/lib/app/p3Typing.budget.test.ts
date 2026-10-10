// X17, the line "the Phase 1 typing budget holds with the inspector open and the colours on"
// (Phase 3 plan §9; P3a review CODE-12). The pieces have budgets of their own; this runs them
// together, as the app does while someone types in a large program:
//
//   the real `ModalIndex` behind the real `createModalService`, the real
//   `createInspectorService` following the cursor and the real `createMotionColors` painting
//   the visible lines, on a 300k-line program, 200 keystrokes at line 150,999, with one idle
//   slice of the index build between two keystrokes (an edit drops the snapshots behind it, so
//   the build has to start again every time).
//
// What a keystroke costs the main thread is the edit handlers (the three listeners), the
// inspector's frame and the colours' frame; the idle slice is a task of its own, so it is
// timed separately. Nothing here is the application's WebKit (that is `p3-perf`); it is the
// work of the code, which is where a reader that republishes or repaints for every slice
// (CODE-2) or a slice that is not bounded would show.
//
// A wall-clock test on a shared machine: one stall of the machine (the macOS storage scan, a
// browser, another test file) is not the code's. The 200 keystrokes run in three rounds and each
// measure is judged on its **best** round, the way the repo's `fastest` judges a steady state
// (`tests/unit/helpers/budget.ts`); the budgets are the same as for one round. A real slowdown is
// in every round.

import { writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { compileProfile } from '$lib/core/profiles/compile';
import { createDocumentStore } from '$lib/stores/documents';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { createMotionColors, type MotionDecoration, type MotionEditor } from '$lib/monaco/motionColors';
import { expectWithin } from '../../../tests/unit/helpers/budget';
import { profileOf } from '../../../tests/unit/helpers/profiles';
import { createInspectorService, type InspectorSnapshot } from './inspectorService';
import { createModalService } from './modalService';
import type { ContentChange, Disposable, DocId, Eol, FileEncoding, NewDocMeta } from '$lib/app/types';
import type { EffectiveProfile } from '$lib/core/machines/types';

const CODE_DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

const LINES = 300_000;
const CURSOR_LINE = 150_999;
const KEYSTROKES = 200;
/** Rounds of KEYSTROKES keystrokes; a measure counts with its best round. */
const ROUNDS = 3;

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

/** A mill program: moves, a cycle, a tool change, a comment, over and over. */
function program(n: number): string[] {
  const pool = ['G0 X0. Y0.', 'G1 X10. Y5. F100.', 'T2 M6', 'S1200 M3', 'G81 X5. Z-3. R1.', 'G80', 'G2 X20. Y5. I5. J0.', '(NEXT)'];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

function emitter<A extends unknown[]>() {
  const listeners = new Set<(...args: A) => void>();
  return {
    on: (cb: (...args: A) => void): Disposable => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    fire: (...args: A): void => {
      for (const cb of [...listeners]) cb(...args);
    },
  };
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe('typing in a 300k-line program with the inspector open and the colours on', () => {
  it('keeps every keystroke frame within the typing budget, and a slice that reaches nothing new asks for no frame', () => {
    const lines = program(LINES);
    const docs = createDocumentStore({ caseInsensitivePaths: false });
    const id: DocId = docs.add({ ...META }, { activate: true });

    const profile = profileOf('fanuc-gcode');
    const applied = applyMachine(profile, noMachine(profile));
    const cp = compileProfile(applied.profile);
    const codes = loadCodeDb(CODE_DBS[applied.codes]);
    const machine = noMachine(profile);
    const effective: EffectiveProfile = { profile: applied.profile, cp, codes, machine };

    const content = emitter<[DocId, ContentChange]>();
    const created = emitter<[DocId]>();
    const cursorMoved = emitter<[]>();
    const activated = emitter<[DocId | null]>();
    const attached = emitter<[]>();
    let version = 1;

    // -- the modal service, on a manual idle queue ---------------------------------------
    const idleQueue: (() => void)[] = [];
    const modal = createModalService({
      docs,
      editor: {
        model: () => ({}) as never,
        getLineCount: () => lines.length,
        getLines: (_id, from, to) => lines.slice(Math.max(1, from) - 1, to),
        onDidChangeContent: content.on,
        onDidCreateModel: created.on,
      },
      effective: () => ({ cp, db: codes, key: 'fanuc-gcode' }),
      idle: (fn) => {
        idleQueue.push(fn);
        return () => void idleQueue.splice(idleQueue.indexOf(fn), 1);
      },
      schedule: () => () => {},
    });
    modal.start();

    // -- the inspector, following the cursor -----------------------------------------------
    let inspected = 0;
    let inspectorFrame: (() => void) | null = null;
    const published: InspectorSnapshot[] = [];
    const inspector = createInspectorService({
      docs,
      editor: {
        cursor: () => ({ line: CURSOR_LINE, column: 3, selectedChars: 0, selections: 1 }),
        getLineCount: () => lines.length,
        getLines: (_id, from, to) => lines.slice(Math.max(1, from) - 1, to),
        versionId: () => version,
        reveal: () => {},
        onDidChangeCursor: (cb) => cursorMoved.on(() => cb({ line: CURSOR_LINE, column: 3, selectedChars: 0, selections: 1 })),
        onDidChangeContent: (cb) => content.on((docId, change) => cb(docId, change)),
        onDidActivate: (cb) => activated.on((docId) => cb(docId)),
      },
      effective: () => {
        inspected++;
        return effective;
      },
      modal,
      revisions: [],
      frame: (fn) => {
        inspectorFrame = fn;
        return () => {
          inspectorFrame = null;
        };
      },
      applyLines: () => ({ changedLines: 0 }),
      prompt: async () => undefined,
      status: { show: () => {} },
      t: (key) => key,
    });
    inspector.snapshot.subscribe((s) => published.push(s));
    inspector.follow();

    // -- the colours, on a fake editor showing the lines around the cursor -----------------
    let colourFrame: (() => void) | null = null;
    const painted: MotionDecoration[][] = [];
    let paintedFrames = 0;
    const model = {};
    const editor: MotionEditor = {
      getModel: () => model,
      getVisibleRanges: () => [{ startLineNumber: CURSOR_LINE - 25, endLineNumber: CURSOR_LINE + 25 }],
      onDidScrollChange: () => ({ dispose() {} }),
      onDidChangeModel: () => ({ dispose() {} }),
      onDidLayoutChange: () => ({ dispose() {} }),
      createDecorationsCollection: () => ({
        set: (marks) => {
          painted.push(marks);
        },
        clear: () => {},
      }),
    };
    const colours = createMotionColors({
      editor: {
        getLines: (_id, from, to) => lines.slice(Math.max(1, from) - 1, to),
        getLineCount: () => lines.length,
        onDidAttach: attached.on,
        onDidActivate: (cb) => activated.on((docId) => cb(docId)),
        onDidChangeContent: (cb) => content.on((docId, change) => cb(docId, change)),
        model: () => model,
        editorInstance: () => editor,
      },
      docs,
      modal,
      effective: () => ({ cp, db: codes }),
      isNc: () => true,
      enabled: writable(true),
      theme: writable<'light' | 'dark'>('dark'),
      frame: (fn) => {
        colourFrame = () => {
          paintedFrames++;
          fn();
        };
        return () => {
          colourFrame = null;
        };
      },
      schedule: () => () => {},
      setProperty: () => {},
    });
    colours.start();

    // -- build the whole index once, as an idle app would, then type ---------------------
    created.fire(id);
    while (idleQueue.length > 0) idleQueue.shift()!();
    const runFrames = (): void => {
      const a = inspectorFrame;
      inspectorFrame = null;
      a?.();
      const b = colourFrame;
      colourFrame = null;
      b?.();
    };
    runFrames();
    const last = published.at(-1)!;
    expect(last.kind === 'block' && last.inspection.stateReady).toBe(true);
    expect(painted.length).toBeGreaterThan(0);

    const inspectedBefore = inspected;
    const publishedBefore = published.length;
    const paintedBefore = paintedFrames;
    const rounds: { p95: number; max: number; slice: number; sliceFrame: number; slices: number }[] = [];

    for (let round = 0; round < ROUNDS; round++) {
      const keystrokeFrames: number[] = [];
      const slices: number[] = [];
      const sliceFrames: number[] = [];

      for (let i = 0; i < KEYSTROKES; i++) {
        // The keystroke: the model changes, every listener hears it, the frames run.
        const started = performance.now();
        lines[CURSOR_LINE - 1] = `G1 X${i % 90}. Y${i % 70}. F${100 + ((i + round) % 9)}.`;
        version++;
        content.fire(id, { startLine: CURSOR_LINE, endLineOld: CURSOR_LINE, endLineNew: CURSOR_LINE, flush: false, versionId: version });
        runFrames();
        keystrokeFrames.push(performance.now() - started);

        // One slice of the rebuild between two keystrokes, and whatever it asks for.
        const slice = idleQueue.shift();
        if (slice !== undefined) {
          const sliceStarted = performance.now();
          slice();
          slices.push(performance.now() - sliceStarted);
          const framesStarted = performance.now();
          runFrames();
          sliceFrames.push(performance.now() - framesStarted);
        }
      }
      rounds.push({
        p95: p95(keystrokeFrames),
        max: Math.max(...keystrokeFrames),
        slice: Math.max(...slices, 0),
        sliceFrame: Math.max(...sliceFrames, 0),
        slices: slices.length,
      });
    }
    const best = (measure: (r: (typeof rounds)[number]) => number): number => Math.min(...rounds.map(measure));

    // The Phase 1 typing budget is keypress-to-render p95 < 50 ms; no single frame may take more than 30 ms.
    expectWithin(best((r) => r.p95), 50, `keystroke frames, p95 of ${KEYSTROKES}, best of ${ROUNDS} rounds`);
    expectWithin(best((r) => r.max), 30, `the slowest keystroke frame, best of ${ROUNDS} rounds`);
    // The idle slice is a task of its own and stays within its 8 ms budget (plus the line it is on).
    for (const r of rounds) expect(r.slices).toBeGreaterThan(KEYSTROKES / 2);
    expectWithin(best((r) => r.slice), 30, `the slowest idle slice, best of ${ROUNDS} rounds`);
    expectWithin(best((r) => r.sliceFrame), 30, `the slowest frame after a slice, best of ${ROUNDS} rounds`);

    // CODE-2: the slices moved the build on 600 times and no reader had anything to look at again.
    expect(inspected - inspectedBefore, 'block readings of the inspector').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));
    expect(published.length - publishedBefore, 'snapshots the panel was given').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));
    expect(paintedFrames - paintedBefore, 'colour updates').toBeLessThanOrEqual(ROUNDS * (KEYSTROKES + 2));

    // And what is on screen is the edited program's.
    const shown = published.at(-1)!;
    expect(shown.kind).toBe('block');
    if (shown.kind === 'block') {
      expect(shown.cursorLine).toBe(CURSOR_LINE);
      expect(shown.inspection.stateReady).toBe(true);
    }
  }, 120_000);
});
