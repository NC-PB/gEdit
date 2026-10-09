// The inspector's model (Phase 3 plan P3.2b, AD-27): what the panel is given for the block at the
// cursor, how it follows the cursor, and the edit of one value from the prompt to the model.
//
// Everything is driven with fakes: a text of lines with a real `ModalIndex` behind a fake modal
// service (so the states are the interpreter's, not hand-built), a fake editor that records its
// listeners, a frame clock the test advances, a scripted prompt, and the real `applyLinesTo` on a
// fake model (so "one undo step" is the application's own, counted on the model).

import { writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import type { EffectiveProfile, MachineConfig, NumberInput } from '$lib/core/machines/types';
import { ModalIndex } from '$lib/core/nc/modal';
import type { ModalState } from '$lib/core/nc/types';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { applyLinesTo, type LineOperation } from '$lib/monaco/applyLines';
import { profileOf } from '../../../tests/unit/helpers/profiles';
import {
  createInspectorService,
  MAX_INSPECT_LINE,
  wordAt,
  type BlockSnapshot,
  type EditPromptProps,
  type InspectorDeps,
  type InspectorSnapshot,
} from './inspectorService';
import { t } from '$lib/i18n';
import type { Msg } from '$lib/app/types';

// The component the singleton opens is never rendered here; the module is only imported.
vi.mock('$lib/components/panels/InspectorEdit.svelte', () => ({ default: {} }));

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

function isB(profileId: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === 'is-b');
  if (!found) throw new Error('no IS-B preset');
  return found.value;
}

/** The document's effective view, as `machines.effective` answers it; `machine` null is "no machine". */
function effectiveOf(profileId: string, machine: { name: string; isB?: boolean } | null): EffectiveProfile {
  const base = profileOf(profileId);
  const config: MachineConfig | null = machine
    ? { id: 'm', name: machine.name, profile: profileId, params: machine.isB ? { numberInput: isB(profileId) } : {} }
    : null;
  const eff = effectiveMachine(base, config, config ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return { profile: checked.profile, cp: compileProfile(checked.profile), codes: loadCodeDb(DBS[applied.codes]), machine: eff };
}

/** Joins and splits text the way a Monaco model applies `pushEditOperations` for line ranges. */
function applyOperations(lines: string[], operations: LineOperation[]): string[] {
  let text = lines.join('\n');
  const offsetOf = (line: number, column: number): number => {
    let at = 0;
    for (let i = 1; i < line; i++) at += lines[i - 1].length + 1;
    return at + column - 1;
  };
  const sorted = [...operations].sort((a, b) => b.range.startLineNumber - a.range.startLineNumber || b.range.startColumn - a.range.startColumn);
  for (const op of sorted) {
    const from = offsetOf(op.range.startLineNumber, op.range.startColumn);
    const to = offsetOf(op.range.endLineNumber, op.range.endColumn);
    text = text.slice(0, from) + op.text + text.slice(to);
  }
  return text.split('\n');
}

const PROGRAM = [
  'O0001', // 1
  'G21 G90 G54', // 2
  'G0 X50 Y10', // 3
  'G1 X50. F200', // 4
  'G83 Z-20. R2. Q5. F100', // 5
  'M30', // 6
];

/** An editor listener; the fake fires them with no argument, as the service ignores it. */
type Listener = (...args: never[]) => void;

interface Rig {
  lines: string[];
  service: ReturnType<typeof createInspectorService>;
  deps: InspectorDeps;
  /** Moves the cursor (a listener call included). */
  moveCursor(line: number, column: number): void;
  /** Types: replaces a line, bumps the version, tells the listeners and the index. */
  typeLine(line: number, text: string): void;
  /** Runs the pending frame, if any. */
  flush(): void;
  frames: { requested: number; cancelled: number; pending: (() => void) | null };
  modalReady: { value: boolean };
  /** A slice of some index that reached nothing a reader waits for: `changed` bumps, `revisionOf` does not. */
  modalBump(): void;
  /** A slice that made a line answerable: `changed` bumps and the revision moves. */
  modalReach(): void;
  calls: { effective: number; stateAfter: number; getLines: number };
  listeners: { cursor: Set<Listener>; content: Set<Listener>; activate: Set<Listener> };
  prompts: EditPromptProps[];
  /** What the prompt answers next: a string, or undefined for Esc. */
  answer: { value: string | undefined; before?: () => void };
  statuses: { text: string; error: boolean }[];
  model: { stack: string[]; ops: LineOperation[][] };
  doc: { path: string | null; readOnly: boolean; readOnlyReason: 'user' | null; id: string | null };
  snapshots: InspectorSnapshot[];
}

function rig(o: { lines?: string[]; machine?: { name: string; isB?: boolean } | null; profile?: string } = {}): Rig {
  const lines = [...(o.lines ?? PROGRAM)];
  const effective = effectiveOf(o.profile ?? 'fanuc-gcode', o.machine === undefined ? null : o.machine);
  const index = new ModalIndex(effective.cp, effective.codes, { every: 3 });
  const rebuild = (): void => {
    while (!index.buildSome(1000)) {
      /* until built */
    }
  };
  index.reset(lines.length, (n) => lines[n - 1]);
  rebuild();

  const r = {} as Rig;
  r.lines = lines;
  r.frames = { requested: 0, cancelled: 0, pending: null };
  r.modalReady = { value: true };
  r.calls = { effective: 0, stateAfter: 0, getLines: 0 };
  r.listeners = { cursor: new Set(), content: new Set(), activate: new Set() };
  r.prompts = [];
  r.answer = { value: undefined };
  r.statuses = [];
  r.model = { stack: [], ops: [] };
  r.doc = { path: null, readOnly: false, readOnlyReason: null, id: 'd1' };
  r.snapshots = [];
  let version = 1;
  let revision = 1;
  let cursor = { line: 3, column: 5, selectedChars: 0, selections: 1 };
  const changed = writable(0);

  const model = {
    getLineCount: () => lines.length,
    getLineContent: (n: number) => lines[n - 1],
    getLineMaxColumn: (n: number) => lines[n - 1].length + 1,
    pushStackElement: () => void r.model.stack.push('stack'),
    pushEditOperations: (_before: null, operations: LineOperation[]) => {
      r.model.stack.push('edit');
      r.model.ops.push(operations);
      const next = applyOperations(lines, operations);
      lines.splice(0, lines.length, ...next);
    },
  };

  const fire = (set: Set<Listener>): void => {
    for (const cb of [...set]) cb();
  };
  const listen = (set: Set<Listener>) => (cb: Listener) => {
    set.add(cb);
    return () => void set.delete(cb);
  };

  r.moveCursor = (line, column) => {
    cursor = { ...cursor, line, column };
    fire(r.listeners.cursor);
  };
  r.typeLine = (line, text) => {
    lines[line - 1] = text;
    version++;
    revision++;
    index.applyChange(line, lines.length, (n) => lines[n - 1]);
    rebuild();
    fire(r.listeners.content);
    changed.update((n) => n + 1);
  };
  r.flush = () => {
    const run = r.frames.pending;
    r.frames.pending = null;
    run?.();
  };
  r.modalBump = () => changed.update((n) => n + 1);
  r.modalReach = () => {
    revision++;
    changed.update((n) => n + 1);
  };

  r.deps = {
    docs: {
      getActiveId: () => r.doc.id,
      get: (id: string) =>
        id === r.doc.id
          ? ({ id, title: 'Test.nc', path: r.doc.path, readOnly: r.doc.readOnly, readOnlyReason: r.doc.readOnlyReason } as never)
          : undefined,
    },
    editor: {
      cursor: () => cursor,
      getLineCount: () => lines.length,
      getLines: (_id: string, s: number, e: number) => {
        r.calls.getLines++;
        return lines.slice(s - 1, e);
      },
      versionId: () => version,
      reveal: vi.fn(),
      onDidChangeCursor: listen(r.listeners.cursor),
      onDidChangeContent: listen(r.listeners.content),
      onDidActivate: listen(r.listeners.activate),
    },
    effective: () => {
      r.calls.effective++;
      return effective;
    },
    modal: {
      stateAfter: (_id: string, n: number): ModalState | null => {
        r.calls.stateAfter++;
        return r.modalReady.value ? index.stateAfter(n) : null;
      },
      changed: { subscribe: changed.subscribe },
      revisionOf: () => revision,
    },
    revisions: [],
    frame: (fn) => {
      r.frames.requested++;
      r.frames.pending = fn;
      return () => {
        r.frames.cancelled++;
        r.frames.pending = null;
      };
    },
    applyLines: (_id, start, end, newLines) => {
      const result = applyLinesTo(model, start, end, newLines);
      version++;
      revision++;
      index.applyChange(start, lines.length, (n) => lines[n - 1]);
      rebuild();
      return result;
    },
    prompt: async (props) => {
      r.prompts.push(props);
      r.answer.before?.();
      return r.answer.value;
    },
    status: { show: (text, o2) => void r.statuses.push({ text, error: o2?.error === true }) },
    t,
  };
  r.service = createInspectorService(r.deps);
  r.service.snapshot.subscribe((s) => r.snapshots.push(s));
  return r;
}

function block(snapshot: InspectorSnapshot): BlockSnapshot {
  if (snapshot.kind !== 'block') throw new Error(`expected a block, got ${snapshot.kind}`);
  return snapshot;
}

const text = (msg: Msg): string => t(msg.key, msg.params);

describe('inspecting the block at the cursor', () => {
  it('reads the cursor line, its words and the state after it from the modal service', () => {
    const r = rig({ machine: { name: 'Mill IS-B', isB: true } });
    r.moveCursor(3, 1);
    const b = block(r.service.inspectNow());
    expect(b.docId).toBe('d1');
    expect(b.cursorLine).toBe(3);
    expect([b.inspection.firstLine, b.inspection.lastLine, b.inspection.stateReady]).toEqual([3, 3, true]);
    expect(b.inspection.words.map((w) => w.written)).toEqual(['G0', 'X50', 'Y10']);
    const x = b.inspection.words.find((w) => w.written === 'X50')!;
    expect(x.value).toMatchObject({ effective: '0.05', unit: 'mm', source: 'machine' });
    expect(b.inspection.state.find((s) => s.key === 'motion')).toMatchObject({ value: 'G0', line: 3, setHere: true });
    expect(b.inspection.state.find((s) => s.key === 'distance')).toMatchObject({ value: 'G90', line: 2, setHere: false });
  });

  it('shows the readings of a word that depends on the machine when there is none, and does not edit it', () => {
    const r = rig();
    const x = block(r.service.inspectNow()).inspection.words.find((w) => w.written === 'X50')!;
    expect(x.value?.effective).toBeNull();
    expect(x.value?.readings.length).toBeGreaterThan(1);
    expect(x.edit.ok).toBe(false);
  });

  it('shows the cycle of a cycle block with its parameters', () => {
    const r = rig();
    r.moveCursor(5, 1);
    const cycle = block(r.service.inspectNow()).inspection.cycle;
    expect(cycle?.code).toBe('G83');
    expect(cycle?.params.find((p) => p.param.address === 'Q')?.written).toBe('5.');
  });

  it('says "waiting" while the modal index has not reached the block, and still lists the words', () => {
    const r = rig();
    r.modalReady.value = false;
    const b = block(r.service.inspectNow());
    expect(b.inspection.stateReady).toBe(false);
    expect(b.inspection.state).toEqual([]);
    expect(b.inspection.words.length).toBeGreaterThan(0);
    const x = b.inspection.words.find((w) => w.written === 'X50')!;
    expect(x.edit).toEqual({ ok: false, reason: { key: 'inspector.why.waiting' } });
  });

  it('answers none without a document, notProgram for a profile or script file, tooLong for a huge line', () => {
    const r = rig();
    r.doc.id = null;
    expect(r.service.inspectNow()).toEqual({ kind: 'none' });
    r.doc.id = 'd1';
    r.doc.path = '/cfg/profiles/mine.json';
    expect(r.service.inspectNow()).toEqual({ kind: 'notProgram' });
    r.doc.path = '/progs/a.nc';
    r.lines[2] = `G1 X1 (${'x'.repeat(MAX_INSPECT_LINE)})`;
    expect(r.service.inspectNow()).toEqual({ kind: 'tooLong', line: 3 });
  });

  it('survives a document whose profile is gone for a moment', () => {
    const r = rig();
    r.deps.effective = () => {
      throw new Error('no such profile');
    };
    expect(r.service.inspectNow()).toEqual({ kind: 'none' });
  });

  it('finds the word at a column: inside it, at its end, and none in the spaces of a comment', () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    const b = block(r.service.inspectNow());
    expect(wordAt(b, 3, 6)?.written).toBe('X50'); // inside X50 (columns 4-6)
    expect(wordAt(b, 3, 7)?.written).toBe('X50'); // right after it
    expect(wordAt(b, 3, 9)?.written).toBe('Y10');
    expect(wordAt(b, 2, 1)).toBeNull(); // another line's words are not on line 3
    expect(wordAt(b, 3, 40)).toBeNull();
  });
});

describe('following the cursor', () => {
  it('listens to nothing, computes nothing and publishes nothing until the panel follows', () => {
    const r = rig();
    expect(r.listeners.cursor.size + r.listeners.content.size + r.listeners.activate.size).toBe(0);
    r.moveCursor(4, 1);
    r.typeLine(4, 'G1 X51. F200');
    expect(r.frames.requested).toBe(0);
    expect(r.calls.effective).toBe(0);
  });

  it('inspects once per frame however many things happened in it', () => {
    const r = rig();
    const stop = r.service.follow();
    expect(r.frames.requested).toBe(1); // the first look
    r.flush();
    const frames = r.frames.requested;
    const looked = r.calls.effective;

    for (let i = 0; i < 20; i++) r.moveCursor(2 + (i % 3), 1);
    for (let i = 0; i < 20; i++) r.typeLine(4, `G1 X5${i % 10}. F200`);
    r.modalBump();
    r.modalBump();
    for (const cb of r.listeners.activate) cb();
    expect(r.frames.requested - frames).toBe(1);
    expect(r.calls.effective - looked).toBe(0); // forty events, and nothing was read yet
    r.flush();
    expect(r.calls.effective - looked).toBe(1); // the block was read once, in the frame
    expect(r.snapshots.at(-1)).toMatchObject({ kind: 'block', cursorLine: expect.any(Number) });
    stop();
  });

  it('does no work on the keystroke path: a content change only asks for a frame', () => {
    const r = rig();
    const stop = r.service.follow();
    r.flush();
    const before = { ...r.calls };
    // Count only what the listener itself does: fire the content listeners 1,000 times.
    for (let i = 0; i < 1000; i++) for (const cb of [...r.listeners.content]) cb();
    expect(r.calls).toEqual(before);
    expect(r.frames.requested).toBe(2); // the first look and one for the 1,000 changes
    stop();
  });

  it('follows the cursor to the next block in the next frame', () => {
    const r = rig();
    const stop = r.service.follow();
    r.flush();
    expect(block(r.snapshots.at(-1)!).cursorLine).toBe(3);
    r.moveCursor(5, 1);
    expect(block(r.snapshots.at(-1)!).cursorLine).toBe(3); // not before the frame
    r.flush();
    expect(block(r.snapshots.at(-1)!).cursorLine).toBe(5);
    stop();
  });

  it('shows an edit of the program in the next frame', () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    const stop = r.service.follow();
    r.flush();
    r.typeLine(3, 'G0 X52 Y10');
    r.flush();
    const x = block(r.snapshots.at(-1)!).inspection.words.find((w) => w.written === 'X52');
    expect(x?.value?.effective).toBe('0.052');
    stop();
  });

  it('does not publish the same "waiting" block again for every slice of the index', () => {
    const r = rig();
    r.modalReady.value = false;
    const stop = r.service.follow();
    r.flush();
    const published = r.snapshots.length;
    for (let i = 0; i < 10; i++) {
      r.modalBump();
      r.flush();
    }
    expect(r.snapshots.length).toBe(published);
    r.modalReady.value = true;
    r.modalReach();
    r.flush();
    expect(r.snapshots.length).toBe(published + 1);
    expect(block(r.snapshots.at(-1)!).inspection.stateReady).toBe(true);
    stop();
  });

  it('CODE-2: slices that reach nothing this panel waits for ask for no frame, read nothing and publish nothing', () => {
    const r = rig();
    const stop = r.service.follow();
    r.flush();
    const published = r.snapshots.length;
    const frames = r.frames.requested;
    const looked = { ...r.calls };
    for (let i = 0; i < 50; i++) r.modalBump();
    expect(r.frames.requested).toBe(frames);
    r.flush();
    expect(r.calls).toEqual(looked);
    expect(r.snapshots.length).toBe(published);
    // A slice that did reach something asks, and the panel shows what changed.
    r.modalReach();
    expect(r.frames.requested).toBe(frames + 1);
    r.flush();
    expect(r.calls.effective).toBe(looked.effective + 1);
    expect(r.snapshots.length).toBe(published + 1);
    stop();
  });

  it('CODE-2: a frame that finds what is already published publishes nothing', () => {
    const r = rig();
    const stop = r.service.follow();
    r.flush();
    const published = r.snapshots.length;
    const looked = r.calls.effective;
    r.moveCursor(3, 2); // the same line: the cursor event asks for a frame
    r.flush();
    expect(r.calls.effective).toBe(looked + 1); // the block was read ...
    expect(r.snapshots.length).toBe(published); // ... and found the same
    r.moveCursor(4, 1);
    r.flush();
    expect(r.snapshots.length).toBe(published + 1);
    stop();
  });

  it('stops: no listener stays, a pending frame is cancelled, the panel is empty', () => {
    const r = rig();
    const stop = r.service.follow();
    const second = r.service.follow(); // two panels share one set of listeners
    expect(r.listeners.cursor.size).toBe(1);
    stop();
    expect(r.listeners.cursor.size).toBe(1);
    r.moveCursor(4, 1);
    expect(r.frames.pending).not.toBeNull();
    second();
    expect(r.listeners.cursor.size + r.listeners.content.size + r.listeners.activate.size).toBe(0);
    expect(r.frames.pending).toBeNull();
    expect(r.frames.cancelled).toBe(1);
    expect(r.snapshots.at(-1)).toEqual({ kind: 'none' });
    r.moveCursor(5, 1);
    expect(r.frames.pending).toBeNull();
    second(); // a second call of a disposer changes nothing
  });

  it('moves the cursor to a source line', () => {
    const r = rig();
    r.service.reveal(5);
    expect(r.deps.editor.reveal).toHaveBeenCalledWith('d1', 5);
  });
});

describe('editing a value', () => {
  /** The cursor inside `X50` of line 3. */
  const onX = (r: Rig): void => r.moveCursor(3, 5);

  it('prompts for the effective value, checks every keystroke, and writes the typed value as one undo step', async () => {
    const r = rig({ machine: { name: 'Mill IS-B', isB: true } });
    onX(r);
    r.answer.value = '0.051';
    // The prompt asks `validate` while it is open, before anything is written.
    const checks: Record<string, Msg | null> = {};
    r.answer.before = () => {
      for (const typed of ['0.051', 'abc', '', '0.0505']) checks[typed] = r.prompts[0].validate(typed);
    };
    expect(await r.service.editAtCursor()).toBe('applied');

    expect(r.prompts).toHaveLength(1);
    expect(r.prompts[0]).toMatchObject({ title: 'Change X50', label: 'New value in mm', initial: '0.05', address: 'X' });
    expect(checks['0.051']).toBeNull();
    expect(checks['abc']).toEqual({ key: 'inspector.why.notANumber' });
    expect(checks['']).toEqual({ key: 'inspector.why.notANumber' });
    // Not a whole number of increments: refused, not rounded (the refusal of rewriteWord).
    expect(checks['0.0505']?.key).toBe('machines.numbers.rounded');

    expect(r.lines[2]).toBe('G0 X51 Y10');
    expect(r.lines.filter((_, i) => i !== 2)).toEqual(PROGRAM.filter((_, i) => i !== 2));
    // One undo step: a stack element, one batch of edits, a stack element.
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
    expect(r.statuses.at(-1)).toEqual({ text: 'X50 changed to X51', error: false });
  });

  it('writes only the characters of the value', async () => {
    const r = rig();
    r.moveCursor(4, 6); // X50.
    r.answer.value = '12.5';
    expect(await r.service.editAtCursor()).toBe('applied');
    expect(r.lines[3]).toBe('G1 X12.5 F200');
    // One narrow edit inside line 4: the value `50.` only, so a bookmark or fold on the line stays.
    expect(r.model.ops).toHaveLength(1);
    expect(r.model.ops[0]).toHaveLength(1);
    const op = r.model.ops[0][0];
    expect([op.range.startLineNumber, op.range.endLineNumber]).toEqual([4, 4]);
    expect(PROGRAM[3].slice(op.range.startColumn - 1, op.range.endColumn - 1)).not.toContain('G1');
    expect(PROGRAM[3].slice(op.range.startColumn - 1, op.range.endColumn - 1)).not.toContain('F200');
  });

  it('edits a cycle parameter with its own label and value', async () => {
    const r = rig();
    r.moveCursor(5, 16); // Q5.
    r.answer.value = '6.5';
    expect(await r.service.editAtCursor()).toBe('applied');
    expect(r.prompts[0]).toMatchObject({ title: 'Change Q5.', initial: '5.' });
    expect(r.lines[4]).toBe('G83 Z-20. R2. Q6.5 F100');
  });

  it('cancels on Esc: nothing is written and nothing is said', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    onX(r);
    r.answer.value = undefined;
    expect(await r.service.editAtCursor()).toBe('cancelled');
    expect(r.lines).toEqual(PROGRAM);
    expect(r.model.stack).toEqual([]);
    expect(r.statuses).toEqual([]);
  });

  it('refuses a value that would have to be rounded, with the reason, and writes nothing', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    onX(r);
    r.answer.value = '0.0505'; // a prompt that let it through, e.g. a script driving the dialog
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.lines).toEqual(PROGRAM);
    expect(r.model.stack).toEqual([]);
    expect(r.statuses.at(-1)).toMatchObject({ error: true });
    expect(r.statuses.at(-1)!.text).toMatch(/round|increment|whole/i);
  });

  it('does not open the prompt for a word that depends on a machine none is chosen for, and says why', async () => {
    const r = rig();
    onX(r);
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.prompts).toEqual([]);
    expect(r.statuses.at(-1)).toEqual({ text: text({ key: 'inspector.why.needsMachine' }), error: false });
  });

  it('does not open the prompt for a code, and says why', async () => {
    const r = rig();
    r.moveCursor(3, 2); // G0
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.prompts).toEqual([]);
    expect(r.statuses.at(-1)!.text).toBe(text({ key: 'inspector.why.code' }));
  });

  it('says there is no value where the cursor is on no word', async () => {
    const r = rig();
    r.moveCursor(3, 40);
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.statuses.at(-1)!.text).toBe(text({ key: 'inspector.edit.noWord' }));
  });

  it('CODE-6: says the document is locked when it was locked while the prompt was open', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    onX(r);
    r.answer.value = '0.051';
    r.answer.before = () => {
      r.doc.readOnly = true;
      r.doc.readOnlyReason = 'user';
    };
    r.deps.applyLines = () => ({ changedLines: 0, locked: true });
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.statuses.at(-1)).toMatchObject({ error: true });
    expect(r.statuses.at(-1)!.text).toContain('locked against editing');
    expect(r.statuses.some((s) => s.text.includes('changed to'))).toBe(false);
  });

  it('CODE-6: does not say "changed" when nothing was written', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    onX(r);
    r.answer.value = '0.051';
    r.deps.applyLines = () => ({ changedLines: 0 });
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.statuses).toEqual([{ text: text({ key: 'inspector.edit.changed' }), error: true }]);
  });

  it('CODE-6: a confirmed value that equals the old one writes nothing and says nothing', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    onX(r);
    r.answer.value = '0.05'; // X50 is already 0.05 mm
    const write = vi.spyOn(r.deps, 'applyLines');
    expect(await r.service.editAtCursor()).toBe('cancelled');
    expect(write).not.toHaveBeenCalled();
    expect(r.lines).toEqual(PROGRAM);
    expect(r.model.stack).toEqual([]);
    expect(r.statuses).toEqual([]);
  });

  it('refuses a locked document before it prompts', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    r.doc.readOnly = true;
    r.doc.readOnlyReason = 'user';
    onX(r);
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.prompts).toEqual([]);
    expect(r.statuses.at(-1)).toMatchObject({ error: true });
    expect(r.statuses.at(-1)!.text).toContain('locked against editing');
  });

  it('writes nothing when the program changed while the prompt was open', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    onX(r);
    r.answer.value = '0.051';
    r.answer.before = () => r.typeLine(1, 'O0002');
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.lines[2]).toBe('G0 X50 Y10');
    expect(r.model.stack).toEqual([]);
    expect(r.statuses.at(-1)).toEqual({ text: text({ key: 'inspector.edit.changed' }), error: true });
  });

  it('edits a row of the panel, found again in a fresh reading; a row that is gone is refused', async () => {
    const r = rig({ machine: { name: 'M', isB: true } });
    const shown = block(r.service.inspectNow()).inspection.words.find((w) => w.written === 'X50')!;
    r.answer.value = '0.06';
    expect(await r.service.edit(shown)).toBe('applied');
    expect(r.lines[2]).toBe('G0 X60 Y10');

    // The row on screen is a frame old: the line changed, so the word it names is not there.
    expect(await r.service.edit(shown)).toBe('refused');
    expect(r.lines[2]).toBe('G0 X60 Y10');
    expect(r.statuses.at(-1)!.text).toBe(text({ key: 'inspector.edit.changed' }));
  });

  it('refuses without a document or in a file that is not a program', async () => {
    const r = rig();
    r.doc.path = 'a.json';
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.statuses.at(-1)!.text).toBe(text({ key: 'inspector.edit.notProgram' }));
    r.doc.id = null;
    expect(await r.service.editAtCursor()).toBe('refused');
    expect(r.statuses.at(-1)!.text).toBe(text({ key: 'inspector.edit.noDocument' }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
});
