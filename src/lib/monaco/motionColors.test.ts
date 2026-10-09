// The motion marks in the editor (Phase 3 plan AD-34, §6.6; P3.7) with a fake editor, a fake
// modal service, a manual animation frame and manual timers: only the visible range plus the
// margin, at most `maxMarks`, nothing for a state that is not known, the setting off removing
// every mark, one update per frame, no work on the keystroke path, the CSS variables on a
// theme change, and the update budget at 300k lines with the states known.

import { get, writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, noMachine } from '$lib/core/machines/effective';
import { ModalIndex } from '$lib/core/nc/modal';
import { MOTION_BUDGETS, MOTION_COLORS, MOTION_KINDS } from '$lib/core/nc/motion';
import { compileProfile } from '$lib/core/profiles/compile';
import { resolveProfiles } from '$lib/core/profiles/resolve';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_SOURCES } from '$lib/data/profiles';
import { expectWithin, fastest } from '../../../tests/unit/helpers/budget';
import {
  createMotionColors,
  LOOKBACK_LINES,
  MAX_LINES,
  motionVariable,
  VIEW_CHECK_DELAY_MS,
  type MotionColorsDeps,
  type MotionDecoration,
  type MotionEditor,
  type MotionView,
} from './motionColors';
import type { ModalState } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';
import type { ContentChange, DocId, DocMeta } from '$lib/app/types';

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

function viewOf(profileId: string): MotionView {
  const profile = PROFILES.get(profileId) as Profile;
  const applied = applyMachine(profile, noMachine(profile));
  return { cp: compileProfile(applied.profile), db: loadCodeDb(CODE_DBS[applied.codes]) };
}

const MILL = viewOf('fanuc-gcode');
const KLARTEXT = viewOf('heidenhain-klartext');

/** A mill program of `n` lines: a rapid, a feed move, an arc and a comment, over and over. */
function millProgram(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    switch (i % 5) {
      case 0:
        out.push(i === 0 ? 'G90 G0 X0 Y0' : `G0 X${i % 90}. Y${i % 70}.`);
        break;
      case 1:
        out.push(`G1 Z-${(i % 9) + 1}. F200.`);
        break;
      case 2:
        out.push(`X${(i % 80) + 1}.`);
        break;
      case 3:
        out.push(`G2 X${(i % 80) + 2}. Y${i % 60}. I1. J0.`);
        break;
      default:
        out.push('M8 (COOLANT)');
    }
  }
  return out;
}

interface Harness {
  deps: MotionColorsDeps;
  lines: { current: string[] };
  /** What the collection was last set to, and how often. */
  sets: MotionDecoration[][];
  clears: { count: number };
  visible: { first: number; last: number };
  enabled: ReturnType<typeof writable<boolean>>;
  theme: ReturnType<typeof writable<'light' | 'dark'>>;
  changed: ReturnType<typeof writable<number>>;
  /** `modal.revisionOf` of every document. */
  revision: { value: number };
  /** The index moved in a way a mark can show: the revision and `changed` both move. */
  reach(): void;
  machineRevision: ReturnType<typeof writable<number>>;
  docsList: ReturnType<typeof writable<DocMeta[]>>;
  statesCalls: { first: number; last: number }[];
  effectiveCalls: { count: number };
  props: Map<string, string>;
  frames: (() => void)[];
  timers: { fn: () => void; ms: number }[];
  runFrames(): void;
  fireTimers(): void;
  scrollTo(first: number, last: number): void;
  edit(): void;
  setStatesNull(value: boolean): void;
  swapEditor(): FakeEditor;
  instances: FakeEditor[];
  active: { id: DocId | null };
  model: { current: object | undefined };
  profileIdOf: { current: string };
  nc: { current: boolean };
  view: { current: MotionView };
  hooks: { scroll: Set<() => void>; layout: Set<() => void>; model: Set<() => void>; content: Set<(id: DocId, c: ContentChange) => void>; activate: Set<(id: DocId | null) => void>; attach: Set<() => void> };
}

interface FakeEditor extends MotionEditor {
  collectionSets: MotionDecoration[][];
  hookCount(): number;
}

function doc(id: DocId, profileId: string): DocMeta {
  return { id, profileId, path: null, title: id } as unknown as DocMeta;
}

function harness(program: string[], o?: { view?: MotionView; index?: ModalIndex; visible?: { first: number; last: number } }): Harness {
  const lines = { current: program };
  const sets: MotionDecoration[][] = [];
  const clears = { count: 0 };
  const visible = o?.visible ?? { first: 400, last: 420 };
  const enabled = writable(true);
  const theme = writable<'light' | 'dark'>('dark');
  const changed = writable(0);
  const revision = { value: 1 };
  const machineRevision = writable(0);
  const docsList = writable<DocMeta[]>([doc('a', 'fanuc-gcode')]);
  const statesCalls: { first: number; last: number }[] = [];
  const effectiveCalls = { count: 0 };
  const props = new Map<string, string>();
  const frames: (() => void)[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const active: { id: DocId | null } = { id: 'a' };
  const model: { current: object | undefined } = { current: {} };
  const profileIdOf = { current: 'fanuc-gcode' };
  const nc = { current: true };
  const view = { current: o?.view ?? MILL };
  let statesNull = false;
  let built: { view: MotionView; index: ModalIndex } | null = null;
  const hooks: Harness['hooks'] = { scroll: new Set(), layout: new Set(), model: new Set(), content: new Set(), activate: new Set(), attach: new Set() };
  const instances: FakeEditor[] = [];

  function makeEditor(): FakeEditor {
    const editorHooks = { count: 0 };
    const collectionSets: MotionDecoration[][] = [];
    const hook = (set: Set<() => void>) => (cb: () => void) => {
      set.add(cb);
      editorHooks.count++;
      return {
        dispose: () => {
          set.delete(cb);
          editorHooks.count--;
        },
      };
    };
    return {
      collectionSets,
      hookCount: () => editorHooks.count,
      getModel: () => model.current,
      getVisibleRanges: () => (model.current === undefined ? [] : [{ startLineNumber: visible.first, endLineNumber: visible.last }]),
      onDidScrollChange: hook(hooks.scroll),
      onDidLayoutChange: hook(hooks.layout),
      onDidChangeModel: hook(hooks.model),
      createDecorationsCollection: () => ({
        set: (decorations) => {
          sets.push(decorations);
          collectionSets.push(decorations);
        },
        clear: () => {
          clears.count++;
        },
      }),
    };
  }
  instances.push(makeEditor());

  const deps: MotionColorsDeps = {
    editor: {
      getLines: (_id, from, to) => lines.current.slice(from - 1, to),
      getLineCount: () => lines.current.length,
      onDidAttach: (cb) => {
        hooks.attach.add(cb);
        return () => hooks.attach.delete(cb);
      },
      onDidActivate: (cb) => {
        hooks.activate.add(cb);
        return () => hooks.activate.delete(cb);
      },
      onDidChangeContent: (cb) => {
        hooks.content.add(cb);
        return () => hooks.content.delete(cb);
      },
      model: () => model.current,
      editorInstance: () => instances[instances.length - 1],
    },
    docs: {
      getActiveId: () => active.id,
      get: (id) => (id === 'a' ? doc('a', profileIdOf.current) : undefined),
      list: { subscribe: docsList.subscribe },
    },
    modal: {
      statesAfter: (_id, first, last) => {
        statesCalls.push({ first, last });
        if (statesNull) return null;
        if (o?.index !== undefined) return o.index.statesAfter(first, last);
        if (built === null || built.view !== view.current) built = { view: view.current, index: fakeIndex(lines.current, view.current) };
        return built.index.statesAfter(first, last);
      },
      changed: { subscribe: changed.subscribe },
      revisionOf: () => revision.value,
    },
    effective: () => {
      effectiveCalls.count++;
      return view.current;
    },
    isNc: () => nc.current,
    enabled: { subscribe: enabled.subscribe },
    theme: { subscribe: theme.subscribe },
    machineRevision: { subscribe: machineRevision.subscribe },
    frame: (fn) => {
      frames.push(fn);
      return () => {
        const at = frames.indexOf(fn);
        if (at >= 0) frames.splice(at, 1);
      };
    },
    schedule: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return () => {
        const at = timers.indexOf(timer);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    setProperty: (name, value) => {
      props.set(name, value);
    },
  };

  return {
    deps,
    lines,
    sets,
    clears,
    visible,
    enabled,
    theme,
    changed,
    revision,
    reach() {
      revision.value++;
      changed.update((n) => n + 1);
    },
    machineRevision,
    docsList,
    statesCalls,
    effectiveCalls,
    props,
    frames,
    timers,
    runFrames() {
      const pending = frames.splice(0);
      for (const fn of pending) fn();
    },
    fireTimers() {
      const pending = timers.splice(0);
      for (const timer of pending) timer.fn();
    },
    scrollTo(first, last) {
      visible.first = first;
      visible.last = last;
      for (const cb of [...hooks.scroll]) cb();
    },
    edit() {
      for (const cb of [...hooks.content]) cb('a', { startLine: 1, endLine: 1 } as unknown as ContentChange);
    },
    setStatesNull(value) {
      statesNull = value;
    },
    swapEditor() {
      const next = makeEditor();
      instances.push(next);
      for (const cb of [...hooks.attach]) cb();
      return next;
    },
    instances,
    active,
    model,
    profileIdOf,
    nc,
    view,
    hooks,
  };
}

/** A built index over `lines`, ready; the states are real. */
function fakeIndex(lines: string[], view: MotionView): ModalIndex {
  const index = new ModalIndex(view.cp, view.db);
  index.reset(lines.length, (n) => lines[n - 1]);
  while (!index.buildSome(1000)) {
    /* build to the end */
  }
  return index;
}

/** The lines marked by the last `set`, with their classes. */
function marked(h: Harness): Map<number, string> {
  const last = h.sets[h.sets.length - 1] ?? [];
  return new Map(last.map((d) => [d.range.startLineNumber, d.options.linesDecorationsClassName]));
}

function started(h: Harness): { stop: () => void; colors: ReturnType<typeof createMotionColors> } {
  const colors = createMotionColors(h.deps);
  const stop = colors.start();
  return { stop, colors };
}

describe('the marks in the editor', () => {
  it('marks only the visible lines plus the margin, with the class of the kind', () => {
    const program = millProgram(1000);
    const h = harness(program, { visible: { first: 400, last: 420 } });
    const { colors } = started(h);
    colors.flush();
    const marks = marked(h);
    const lines = [...marks.keys()];
    expect(Math.min(...lines)).toBeGreaterThanOrEqual(400 - MOTION_BUDGETS.marginLines);
    expect(Math.max(...lines)).toBeLessThanOrEqual(420 + MOTION_BUDGETS.marginLines);
    expect(lines.some((n) => n >= 400 && n <= 420)).toBe(true);
    expect(lines.length).toBeGreaterThan(50);
    // Line 401 of the pattern is `G1 Z-…` (index 400 % 5 = 0 → a rapid); the class is mark + kind.
    expect(program[400]).toMatch(/^G0 /);
    expect(marks.get(401)).toBe('gedit-motion-mark gedit-motion-rapid');
    expect(program[401]).toMatch(/^G1 /);
    expect(marks.get(402)).toBe('gedit-motion-mark gedit-motion-linear');
    expect(marks.get(403)).toBe('gedit-motion-mark gedit-motion-linear'); // `X…` under G1
    expect(marks.get(404)).toBe('gedit-motion-mark gedit-motion-arc');
    expect(marks.has(405)).toBe(false); // M8 and a comment
    // One decoration per line, an empty range at column 1.
    const last = h.sets[h.sets.length - 1];
    expect(last.every((d) => d.range.startColumn === 1 && d.range.endColumn === 1 && d.range.startLineNumber === d.range.endLineNumber)).toBe(true);
    // One `statesAfter` call: from the line above the first marked line to the last.
    expect(h.statesCalls).toEqual([{ first: 400 - MOTION_BUDGETS.marginLines - 1, last: 420 + MOTION_BUDGETS.marginLines }]);
  });

  it('keeps the first line of the document in range and clamps the end at the last line', () => {
    const h = harness(millProgram(30), { visible: { first: 1, last: 20 } });
    const { colors } = started(h);
    colors.flush();
    expect(h.statesCalls).toEqual([{ first: 0, last: 30 }]);
    expect(marked(h).get(1)).toBe('gedit-motion-mark gedit-motion-rapid');
    expect(Math.max(...marked(h).keys())).toBeLessThanOrEqual(30);
  });

  it('never makes more than maxMarks marks, even for a very tall editor', () => {
    const h = harness(millProgram(5000), { visible: { first: 1000, last: 4000 } });
    const { colors } = started(h);
    colors.flush();
    const last = h.sets[h.sets.length - 1];
    expect(last.length).toBeLessThanOrEqual(MOTION_BUDGETS.maxMarks);
    const call = h.statesCalls[0];
    expect(call.last - call.first + 1).toBeLessThanOrEqual(1000); // the limit of one `statesAfter` call
    expect(MAX_LINES).toBeLessThanOrEqual(MOTION_BUDGETS.maxMarks);
    // The visible lines come first.
    expect(Math.min(...last.map((d) => d.range.startLineNumber))).toBeGreaterThanOrEqual(1000 - MOTION_BUDGETS.marginLines);
  });

  it('marks nothing for a state that is not known, and marks when the index reaches it', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    h.setStatesNull(true);
    colors.flush();
    expect(h.sets.length).toBe(0);
    expect(h.clears.count).toBeGreaterThan(0);
    h.setStatesNull(false);
    h.reach(); // the service: the index reached the lines
    expect(h.frames.length).toBe(1);
    h.runFrames();
    expect(marked(h).size).toBeGreaterThan(0);
  });

  it('paints a line with an assumed motion mode in no colour', () => {
    // The first moves of a program, before any motion code: nothing is in force.
    const program = ['G90', 'X10. Y10.', 'Z5.', 'G1 X20. F100.', 'X30.'];
    const h = harness(program, { visible: { first: 1, last: 5 } });
    const { colors } = started(h);
    colors.flush();
    expect([...marked(h).keys()]).toEqual([4, 5]);
  });

  it('removes every mark when the setting goes off and brings them back when it goes on', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    expect(marked(h).size).toBeGreaterThan(0);
    const clearsBefore = h.clears.count;
    h.enabled.set(false);
    h.runFrames();
    expect(h.clears.count).toBeGreaterThan(clearsBefore);
    const callsOff = h.statesCalls.length;
    h.scrollTo(300, 320);
    h.runFrames();
    expect(h.statesCalls.length, 'no work while it is off').toBe(callsOff);
    const setsBefore = h.sets.length;
    h.enabled.set(true);
    h.runFrames();
    expect(h.sets.length).toBe(setsBefore + 1);
    expect(marked(h).size).toBeGreaterThan(0);
  });

  it('marks nothing in a document that is no NC program, or whose model is not the editor\'s', () => {
    const h = harness(millProgram(600));
    h.nc.current = false;
    const { colors } = started(h);
    colors.flush();
    expect(h.sets.length).toBe(0);
    h.nc.current = true;
    h.deps.editor.model = () => ({}); // another model than the editor shows
    colors.flush();
    expect(h.sets.length).toBe(0);
  });

  it('CODE-2: the slices of other documents, or that reach nothing this editor waits for, repaint nothing', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const sets = h.sets.length;
    const calls = h.statesCalls.length;
    for (let i = 0; i < 50; i++) h.changed.update((n) => n + 1);
    expect(h.frames.length).toBe(0);
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls);
    expect(h.sets.length).toBe(sets);
  });

  it('CODE-2: a repaint that would set the marks that are already there sets nothing, but one after an edit does', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const sets = h.sets.length;
    const calls = h.statesCalls.length;
    h.reach(); // the index moved, and the marks come out the same
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 1);
    expect(h.sets.length).toBe(sets);
    // An edit lets the editor move its decorations, so the same list is set again.
    h.edit();
    h.runFrames();
    expect(h.sets.length).toBe(sets + 1);
  });

  it('updates once per frame however many things changed', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    h.changed.update((n) => n + 1);
    h.changed.update((n) => n + 1);
    h.edit();
    h.edit();
    h.scrollTo(380, 400);
    expect(h.frames.length).toBe(1);
    expect(h.statesCalls.length, 'nothing ran yet').toBe(calls);
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 1);
  });

  it('does no work on the keystroke path beyond scheduling', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    const effective = h.effectiveCalls.count;
    const lineReads = { count: 0 };
    const getLines = h.deps.editor.getLines;
    h.deps.editor.getLines = (id, a, b) => {
      lineReads.count++;
      return getLines(id, a, b);
    };
    for (let i = 0; i < 200; i++) h.edit();
    expect(h.statesCalls.length).toBe(calls);
    expect(h.effectiveCalls.count).toBe(effective);
    expect(lineReads.count).toBe(0);
    expect(h.frames.length).toBe(1);
    expect(h.timers.length).toBe(1); // the view check, one timer however many keys
  });

  it('asks for the effective view once, and again after a pause in typing, a machine change or a dialect switch', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    expect(h.effectiveCalls.count).toBe(1);
    for (let i = 0; i < 20; i++) {
      h.edit();
      h.runFrames();
    }
    expect(h.effectiveCalls.count, 'typing does not ask').toBe(1);
    expect(h.timers[0].ms).toBe(VIEW_CHECK_DELAY_MS);
    h.fireTimers();
    h.runFrames();
    expect(h.effectiveCalls.count).toBe(2);
    h.machineRevision.update((n) => n + 1);
    h.runFrames();
    expect(h.effectiveCalls.count).toBe(3);
    h.profileIdOf.current = 'heidenhain-klartext';
    h.view.current = KLARTEXT;
    h.docsList.update((list) => [...list]);
    h.runFrames();
    expect(h.effectiveCalls.count).toBe(4);
  });

  it('recolours from the new state after a dialect switch', () => {
    const h = harness(['4 L X+1 FMAX', '5 L X+2 F100', '6 C X+3 Y+3 DR+', 'G1 X1.'], { visible: { first: 1, last: 4 } });
    const { colors } = started(h);
    colors.flush();
    expect([...marked(h).values()].map((c) => c.split(' ')[1])).toEqual(['gedit-motion-linear']); // read as a mill: only `G1 X1.` is known
    h.profileIdOf.current = 'heidenhain-klartext';
    h.view.current = KLARTEXT;
    h.docsList.update((list) => [...list]);
    h.runFrames();
    expect([...marked(h).values()].map((c) => c.split(' ')[1])).toEqual(['gedit-motion-rapid', 'gedit-motion-linear', 'gedit-motion-arc']);
  });

  it('needs no update for a short scroll and recentres before the marks run out', () => {
    const h = harness(millProgram(2000), { visible: { first: 800, last: 840 } });
    const { colors } = started(h);
    colors.flush();
    const calls = h.statesCalls.length;
    h.scrollTo(810, 850); // well inside the margin
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls);
    h.scrollTo(870, 910); // 20 lines from the end of the marks
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 1);
    expect(h.statesCalls[calls].last).toBe(910 + MOTION_BUDGETS.marginLines);
    h.scrollTo(1500, 1540); // a jump
    h.runFrames();
    expect(h.statesCalls.length).toBe(calls + 2);
    expect(Math.min(...marked(h).keys())).toBeGreaterThanOrEqual(1500 - MOTION_BUDGETS.marginLines);
  });

  it('reads a few lines above the first mark, so the tokenizer\'s line state is the index\'s', () => {
    // A tail line of a continued block is tokenized differently from a head (a leading number
    // is a block number only at the head); the lines above the range tell which one it is.
    const h = harness(millProgram(1000), { visible: { first: 400, last: 420 } });
    const reads: [number, number][] = [];
    const getLines = h.deps.editor.getLines;
    h.deps.editor.getLines = (id, a, b) => {
      reads.push([a, b]);
      return getLines(id, a, b);
    };
    const { colors } = started(h);
    colors.flush();
    expect(LOOKBACK_LINES).toBeGreaterThan(0);
    expect(reads).toEqual([[400 - MOTION_BUDGETS.marginLines - LOOKBACK_LINES, 420 + MOTION_BUDGETS.marginLines]]);
    // At the top of the document there is nothing above to read.
    const top = harness(millProgram(100), { visible: { first: 1, last: 20 } });
    const topReads: [number, number][] = [];
    const topGet = top.deps.editor.getLines;
    top.deps.editor.getLines = (id, a, b) => {
      topReads.push([a, b]);
      return topGet(id, a, b);
    };
    started(top).colors.flush();
    expect(topReads).toEqual([[1, 100]]);
  });

  it('hooks a new editor instance and lets go of the old one', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    const first = h.instances[0];
    expect(first.hookCount()).toBe(3);
    const next = h.swapEditor();
    h.runFrames();
    expect(first.hookCount()).toBe(0);
    expect(next.hookCount()).toBe(3);
    expect(next.collectionSets.length).toBe(1);
  });

  it('removes the marks and every listener when it stops', () => {
    const h = harness(millProgram(600));
    const { colors, stop } = started(h);
    colors.flush();
    const clears = h.clears.count;
    stop();
    expect(h.clears.count).toBeGreaterThan(clears);
    expect(h.hooks.content.size + h.hooks.activate.size + h.hooks.attach.size + h.hooks.scroll.size).toBe(0);
    h.changed.update((n) => n + 1);
    h.edit();
    expect(h.frames.length).toBe(0);
  });

  it('ignores an edit in a document that is not the one on screen', () => {
    const h = harness(millProgram(600));
    const { colors } = started(h);
    colors.flush();
    for (const cb of [...h.hooks.content]) cb('other', { startLine: 1, endLine: 1 } as unknown as ContentChange);
    expect(h.frames.length).toBe(0);
  });
});

describe('the colours', () => {
  it('sets the custom properties of the theme in force and again when it changes', () => {
    const h = harness(millProgram(100));
    started(h);
    for (const kind of MOTION_KINDS) expect(h.props.get(motionVariable(kind))).toBe(MOTION_COLORS.dark[kind]);
    expect(motionVariable('arc')).toBe('--gedit-motion-arc');
    h.theme.set('light');
    for (const kind of MOTION_KINDS) expect(h.props.get(motionVariable(kind))).toBe(MOTION_COLORS.light[kind]);
    expect(get(h.theme)).toBe('light');
  });
});

describe('the budget at 300k lines', () => {
  it('one update with the states known costs at most 4 ms, and marks at most 1,000 lines', () => {
    const program = millProgram(MOTION_BUDGETS.lines);
    const index = fakeIndex(program, MILL);
    const h = harness(program, { index, visible: { first: 150_000, last: 150_060 } });
    const { colors } = started(h);
    colors.flush();
    expect(marked(h).size).toBeGreaterThan(100);
    expect(marked(h).size).toBeLessThanOrEqual(MOTION_BUDGETS.maxMarks);
    // The harness's modal answer is the real index (one reader walk), the lines are sliced from the array.
    const ms = fastest(15, () => {
      h.edit();
      colors.flush();
    });
    expectWithin(ms, MOTION_BUDGETS.updateMs, 'one update of the motion marks at 300k lines');
    // Near the end of the document, where the walk is the longest from a snapshot.
    h.scrollTo(299_900, 299_960);
    const end = fastest(15, () => {
      h.edit();
      colors.flush();
    });
    expectWithin(end, MOTION_BUDGETS.updateMs, 'one update at the end of a 300k-line program');
  });
});

describe('a state that is typed as the index gives it', () => {
  it('reads before and after from consecutive states', () => {
    // A sanity check of the harness: statesAfter(first - 1, last) has one more state than lines.
    const program = millProgram(50);
    const states: ModalState[] | null = fakeIndex(program, MILL).statesAfter(9, 20);
    expect(states?.length).toBe(12);
  });
});
