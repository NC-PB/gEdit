// The hover provider's modal context (Phase 3 plan §6.5; P3a review CODE-7): the context is
// built only once the pointer is on a word the hover has something to say about, and never for
// a line the inspector would not read either. Driven with a fake model and a spy for the modal
// service, so "how often the index was asked" is counted instead of timed.

import { describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { hoverAt } from '$lib/core/codes/hoverText';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import { ModalIndex } from '$lib/core/nc/modal';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { t } from '$lib/i18n';
import { MAX_INSPECT_LINE } from '$lib/app/inspectorService';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import { hoverInfoAtPosition, type HoverView } from './hover';
import type * as MonacoApi from 'monaco-editor/esm/vs/editor/editor.api.js';

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

const base = profileOf('fanuc-gcode');
const machine = effectiveMachine(base, null, 'none', {});
const applied = applyMachine(base, machine);
const checked = validateProfile(applied.profile, { applied: true });
if (!checked.ok) throw new Error(checked.errors.join('; '));
const cp = compileProfile(checked.profile);
const db = loadCodeDb(DBS[applied.codes]);
const view: HoverView = { cp, db, docId: 'd1', profile: checked.profile, machine };

function fakeModel(lines: string[]): MonacoApi.editor.ITextModel {
  return {
    getLineCount: () => lines.length,
    getLineContent: (n: number) => lines[n - 1] ?? '',
  } as unknown as MonacoApi.editor.ITextModel;
}

/** A modal service spy that answers from a real, built index. */
function spy(lines: string[]) {
  const index = new ModalIndex(cp, db, { every: 3 });
  index.reset(lines.length, (n) => lines[n - 1] ?? '');
  while (!index.buildSome(1000)) {
    /* until built */
  }
  return { stateAfter: vi.fn((_id: string, n: number) => index.stateAfter(n)) };
}

const PROGRAM = ['O0001', 'G21 G90 G54', 'G0 X50 Y10', 'G1 X50. F200', 'M30'];

describe('the hover with the modal context', () => {
  it('adds the context for a word that has a hover, from the states before and after its block', () => {
    const states = spy(PROGRAM);
    const info = hoverInfoAtPosition(fakeModel(PROGRAM), { lineNumber: 4, column: 7 }, view, states);
    const plain = hoverAt(PROGRAM[3], 6, cp, db, t, undefined, {});
    expect(info).not.toBeNull();
    expect(states.stateAfter).toHaveBeenCalled();
    expect(info!.markdown.length).toBeGreaterThan(plain!.markdown.length);
    expect(info!.markdown.startsWith(plain!.markdown)).toBe(true);
  });

  it('CODE-7: asks the index nothing when the pointer rests on a space or a comment', () => {
    const lines = ['G0 X50 (a comment here)', 'G1  X1.'];
    const states = spy(lines);
    expect(hoverInfoAtPosition(fakeModel(lines), { lineNumber: 2, column: 4 }, view, states)).toBeNull();
    expect(hoverInfoAtPosition(fakeModel(lines), { lineNumber: 1, column: 12 }, view, states)).toBeNull();
    expect(states.stateAfter).not.toHaveBeenCalled();
  });

  it('CODE-7: a line longer than the inspector reads gets the Phase 2 hover and no context', () => {
    const long = 'G1 X1. Y2. F100 ' + 'X1.5 Y2.5 '.repeat(Math.ceil(MAX_INSPECT_LINE / 10) + 1);
    expect(long.length).toBeGreaterThan(MAX_INSPECT_LINE);
    const lines = ['G90 G54', long, 'G0 X0'];
    const states = spy(lines);
    const info = hoverInfoAtPosition(fakeModel(lines), { lineNumber: 2, column: 5 }, view, states);
    expect(info).toEqual(hoverAt(long, 4, cp, db, t, undefined, {}));
    expect(info).not.toBeNull();
    expect(states.stateAfter).not.toHaveBeenCalled();
  });

  it('CODE-7: a neighbour that long is read as empty, so the block stops at it', () => {
    const long = 'G1 ' + 'X1. '.repeat(MAX_INSPECT_LINE);
    const lines = ['G90 G54', long, 'G0 X0 Y1'];
    const states = spy(lines);
    const info = hoverInfoAtPosition(fakeModel(lines), { lineNumber: 3, column: 5 }, view, states);
    expect(info).not.toBeNull();
    expect(states.stateAfter).toHaveBeenCalled();
  });
});
