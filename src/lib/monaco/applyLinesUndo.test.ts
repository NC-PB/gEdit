// Undo of a transform that made 1,000 or more separate edits, against the REAL Monaco
// text model and undo stack (B1 fixperf; `realModel.ts`).
//
// Found by the runtime harness: Remove Comments on a 3,000-line program (1,500 separate
// edits) kept bookmarks on lines 3, 1501, 2999, but one Undo put them on 2, 1241, 2454,
// while the text came back exactly. With 900 edits they stayed.

import { describe, expect, it } from 'vitest';
import { realModel, type RealModel } from './realModel';
import { applyLinesTo } from './applyLines';

/**
 * 3,000 lines with a comment on exactly `comments` of them, spread over the program. Up to
 * 1,500 comments go on even lines only, so the odd lines the marks sit on are never edited.
 */
function program(comments: number): string[] {
  const commented = new Set<number>();
  for (let j = 0; j < comments; j++) {
    commented.add(comments <= 1500 ? 2 * Math.floor((j * 1500) / comments) + 2 : j + 1);
  }
  const out: string[] = [];
  for (let i = 1; i <= 3000; i++) out.push(commented.has(i) ? `G1 X${i} (note ${i})` : `G1 X${i}`);
  return out;
}

function stripComments(lines: string[]): string[] {
  return lines.map((line) => line.replace(/ \([^)]*\)$/, ''));
}

/** Marks a line the way the bookmarks do: a whole-line decoration that does not grow. */
function mark(model: RealModel, line: number): string {
  return model.deltaDecorations([], [
    {
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: { isWholeLine: true, stickiness: 1 /* NeverGrowsWhenTypingAtEdges */ },
    },
  ])[0];
}

/** A fold-shaped decoration: it spans several lines. */
function markSpan(model: RealModel, first: number, last: number): string {
  return model.deltaDecorations([], [
    {
      range: { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: 1 },
      options: { stickiness: 1 },
    },
  ])[0];
}

function lineOf(model: RealModel, id: string): number {
  return model.getDecorationRange(id)!.startLineNumber;
}

describe('undo of a transform with many separate edits (real Monaco model)', () => {
  const MARKS = [3, 1501, 2999];

  function run(comments: number) {
    const before = program(comments);
    const model = realModel(before.join('\n'));
    const ids = MARKS.map((line) => mark(model, line));
    const span = markSpan(model, 1200, 1210);
    const edits = before.filter((line) => line.includes('(')).length;
    applyLinesTo(model, 1, 3000, stripComments(before));
    return { before, model, ids, span, edits };
  }

  it.each([900, 999, 1000, 1500, 3000])('%i edits: marks stay where they are through the run, one Undo and one Redo', (comments) => {
    const { before, model, ids, span, edits } = run(comments);
    expect(edits).toBe(comments);
    const after = stripComments(before).join('\n');
    expect(model.getValue()).toBe(after);
    expect(ids.map((id) => lineOf(model, id))).toEqual(MARKS);

    model.undo();
    expect(model.getValue()).toBe(before.join('\n'));
    expect(ids.map((id) => lineOf(model, id))).toEqual(MARKS);
    expect([lineOf(model, span), model.getDecorationRange(span)!.endLineNumber]).toEqual([1200, 1210]);

    model.redo();
    expect(model.getValue()).toBe(after);
    expect(ids.map((id) => lineOf(model, id))).toEqual(MARKS);
  });

  it('is one undo step: one Undo takes back the transform and not what came before it', () => {
    const before = program(1500);
    const model = realModel(before.join('\n'));
    // Something typed first, as its own undo step.
    model.pushStackElement();
    model.pushEditOperations(null, [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '(typed) ' }], () => null);
    model.pushStackElement();
    const typed = model.getValue();
    expect(typed.startsWith('(typed) G1 X1')).toBe(true);

    applyLinesTo(model, 1, 3000, stripComments(typed.split('\n')));
    expect(model.getValue()).toBe(stripComments(typed.split('\n')).join('\n'));

    model.undo();
    expect(model.getValue()).toBe(typed);
    model.undo();
    expect(model.getValue()).toBe(before.join('\n'));
  });

  it('Undo, Redo, Undo again: still one step each way, still in place', () => {
    const { before, model, ids } = run(1500);
    const after = stripComments(before).join('\n');
    for (let round = 0; round < 3; round++) {
      model.undo();
      expect(model.getValue()).toBe(before.join('\n'));
      expect(ids.map((id) => lineOf(model, id))).toEqual(MARKS);
      model.redo();
      expect(model.getValue()).toBe(after);
      expect(ids.map((id) => lineOf(model, id))).toEqual(MARKS);
    }
  });

  it('a mark follows its line when the transform deletes lines, on the way there and back', () => {
    // 1,200 comment-only lines go; marks on untouched lines move with their text, and
    // come back to where they were on Undo.
    const before: string[] = [];
    for (let i = 1; i <= 3000; i++) before.push(i % 2 === 0 && i <= 2400 ? `(note ${i})` : `G1 X${i}`);
    const keep = (line: string) => !line.startsWith('(');
    const after = before.filter(keep);
    const model = realModel(before.join('\n'));
    const marked = [3, 1501, 2999];
    const ids = marked.map((line) => mark(model, line));
    applyLinesTo(model, 1, 3000, after);
    const there = marked.map((line) => after.indexOf(before[line - 1]) + 1);
    expect(model.getValue()).toBe(after.join('\n'));
    expect(ids.map((id) => lineOf(model, id))).toEqual(there);

    model.undo();
    expect(model.getValue()).toBe(before.join('\n'));
    expect(ids.map((id) => lineOf(model, id))).toEqual(marked);
    model.redo();
    expect(ids.map((id) => lineOf(model, id))).toEqual(there);
  });

  it('a long plan (25,000 edits, 26 calls) still undoes in one step with the marks in place', () => {
    const before = Array.from({ length: 30_000 }, (_, i) => `G1 X${i} (n)`);
    const model = realModel(before.join('\n'));
    const ids = [3, 15_001, 29_999].map((line) => mark(model, line));
    const after = before.map((line, i) => (i % 6 === 5 ? line : line.replace(' (n)', '')));
    const edits = after.filter((line, i) => line !== before[i]).length;
    expect(edits).toBeGreaterThan(24_000);
    applyLinesTo(model, 1, 30_000, after);
    expect(model.getValue()).toBe(after.join('\n'));
    model.undo();
    expect(model.getValue()).toBe(before.join('\n'));
    expect(ids.map((id) => lineOf(model, id))).toEqual([3, 15_001, 29_999]);
  });
});
