// Applying a transform's lines (plan §5 WP4.1, §7.3, AD-12).
//
// Monaco is not here: `FakeModel` is a text buffer with the five methods `applyLinesTo`
// uses, and it applies the operations the way Monaco does — by offset, from the last to
// the first — so the assertions are about the resulting program text and not about the
// shape of a range. It also refuses overlapping operations, which is the one thing that
// would make Monaco throw at runtime and a unit test miss.
//
// It also runs each range through Monaco's `validateRange` first. A range whose boundary
// has a high surrogate in front of it is *widened* by the real editor, not refused, so a
// plan that ends a span in the middle of a surrogate pair silently loses a character. A
// FakeModel that applied ranges by raw offset could not see that, and did not: the end
// guard in `charSpan` tested the wrong character and `(a😀)` → `(A😀)` came back as a
// lone high surrogate (G8 M4).
//
// Importing this module in node is a guard as well: `applyLines` reaches the editor
// service, which must keep Monaco behind a dynamic import.

import { describe, expect, it } from 'vitest';
import {
  applyLines,
  applyLinesTo,
  planLineEdits,
  CHUNK_LINES,
  MONACO_REDUCES_AT,
  type EditableModel,
  type LineOperation,
} from './applyLines';

class FakeModel implements EditableModel {
  lines: string[];
  /** How often `pushStackElement` was called; one undo step means exactly two. */
  stackElements = 0;
  /** Every `pushEditOperations` batch, so "one call" can be asserted. */
  batches: LineOperation[][] = [];

  constructor(text: string) {
    this.lines = text.split('\n');
  }

  get text(): string {
    return this.lines.join('\n');
  }

  getLineCount(): number {
    return this.lines.length;
  }

  getLineContent(line: number): string {
    return this.lines[line - 1];
  }

  getLineMaxColumn(line: number): number {
    return this.lines[line - 1].length + 1;
  }

  pushStackElement(): void {
    this.stackElements++;
  }

  pushEditOperations(_before: null, operations: LineOperation[]): unknown {
    this.batches.push(operations);
    const spans = operations
      .map((op) => {
        const range = this.validateRange(op.range);
        return {
          start: this.offsetOf(range.startLineNumber, range.startColumn),
          end: this.offsetOf(range.endLineNumber, range.endColumn),
          text: op.text,
        };
      })
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < spans.length; i++) {
      expect(spans[i].end).toBeGreaterThanOrEqual(spans[i].start);
      if (i > 0) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    }

    let text = this.text;
    for (const span of [...spans].reverse()) {
      text = text.slice(0, span.start) + span.text + text.slice(span.end);
    }
    this.lines = text.split('\n');
    return null;
  }

  private offsetOf(line: number, column: number): number {
    let offset = 0;
    for (let i = 1; i < line; i++) offset += this.lines[i - 1].length + 1;
    return offset + column - 1;
  }

  /**
   * Monaco's `TextModel.validateRange`, the surrogate half of it.
   *
   * A boundary counts as *inside a surrogate pair* when the character in front of it is
   * a high surrogate, and the range is then pushed outwards at that end — the start to
   * the left, the end to the right. The end is only examined while it is not past the
   * last character of the line, which is Monaco's `endColumn <= lineLength` condition.
   */
  private validateRange(range: LineOperation['range']): LineOperation['range'] {
    const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
    const startLine = this.lines[range.startLineNumber - 1] ?? '';
    const endLine = this.lines[range.endLineNumber - 1] ?? '';
    const startInsidePair = range.startColumn > 1 && isHigh(startLine.charCodeAt(range.startColumn - 2));
    const endInsidePair =
      range.endColumn > 1 && range.endColumn <= endLine.length && isHigh(endLine.charCodeAt(range.endColumn - 2));
    if (!startInsidePair && !endInsidePair) return range;
    return {
      ...range,
      startColumn: startInsidePair ? range.startColumn - 1 : range.startColumn,
      endColumn: endInsidePair ? range.endColumn + 1 : range.endColumn,
    };
  }
}

/** The whole document as lines, which is what a transform hands back. */
function linesOf(text: string): string[] {
  return text.split('\n');
}

describe('applyLinesTo: what lands in the model', () => {
  it('rewrites the changed lines and leaves the rest byte for byte', () => {
    const model = new FakeModel('N10 G0 X0\nN20 G1 X10.5\nN30 M30');
    const result = applyLinesTo(model, 1, 3, ['N10 G0 X0', 'N25 G1 X10.5', 'N30 M30']);
    expect(model.text).toBe('N10 G0 X0\nN25 G1 X10.5\nN30 M30');
    expect(result.changedLines).toBe(1);
  });

  it('narrows a single-line rewrite to the characters that moved', () => {
    const model = new FakeModel('N100 G1 X12.5 F200\nN110 M30');
    applyLinesTo(model, 1, 2, ['N90 G1 X12.5 F200', 'N110 M30']);
    const [operation] = model.batches[0];
    expect(model.batches[0]).toHaveLength(1);
    // Only "10" -> "0" is touched; the cursor and a bookmark at the end of the line stay.
    expect(operation.range).toEqual({
      startLineNumber: 1,
      startColumn: 2,
      endLineNumber: 1,
      endColumn: 4,
    });
    expect(operation.text).toBe('9');
    expect(model.text).toBe('N90 G1 X12.5 F200\nN110 M30');
  });

  it('keeps an astral character whole when the edit ends right in front of it', () => {
    // G8 M4: convert-case with comments included, on `(a😀)`. The span ended between the
    // two units of the emoji, Monaco widened the range, and the low surrogate was
    // dropped — a lone high surrogate where the character had been.
    const model = new FakeModel('(a\u{1F600})\nN20 M30');
    applyLinesTo(model, 1, 2, ['(A\u{1F600})', 'N20 M30']);
    expect(model.text).toBe('(A\u{1F600})\nN20 M30');
  });

  it('keeps an astral character whole when the edit surrounds it', () => {
    const model = new FakeModel('X1\u{1F600}Y2\nN20 M30');
    applyLinesTo(model, 1, 2, ['X9\u{1F600}Y2', 'N20 M30']);
    expect(model.text).toBe('X9\u{1F600}Y2\nN20 M30');
  });

  it('rewrites an astral character itself without leaving half of one', () => {
    const model = new FakeModel('(\u{1F600})\nN20 M30');
    applyLinesTo(model, 1, 2, ['(\u{1F601})', 'N20 M30']);
    expect(model.text).toBe('(\u{1F601})\nN20 M30');
  });

  it('narrows every line of a run of changed lines, not just a lone one', () => {
    // A renumber changes every block, so the blocks of a program are one hunk. Until the
    // hunk is split back into its lines the narrowing never runs and every decoration
    // inside the run is moved by Monaco (H4, m4-apply).
    const model = new FakeModel('N10 G0 X0\nN20 G1 X10.\nN30 M30');
    applyLinesTo(model, 1, 3, ['N100 G0 X0', 'N105 G1 X10.', 'N110 M30']);
    expect(model.text).toBe('N100 G0 X0\nN105 G1 X10.\nN110 M30');
    expect(model.batches[0]).toHaveLength(3);
    for (const operation of model.batches[0]) {
      expect(operation.range.startLineNumber).toBe(operation.range.endLineNumber);
      // Every one of them stops short of the end of its line, so a bookmark, a fold or a
      // cursor sitting after the block number is outside the replaced span.
      expect(operation.range.endColumn).toBeLessThan(
        model.getLineMaxColumn(operation.range.startLineNumber),
      );
    }
  });

  it('splits a run and leaves the lone changes and the untouched lines as they were', () => {
    const oldLines = ['N10', 'N20', 'N30', '(KEEP)', 'N40', '(KEEP TOO)'];
    const newLines = ['N100', 'N110', 'N120', '(KEEP)', 'N130', '(KEEP TOO)'];
    const plan = planLineEdits({
      oldLines,
      newLines,
      startLine: 1,
      modelLineCount: oldLines.length,
      maxColumn: (line) => oldLines[line - 1].length + 1,
    });
    // One operation per changed line — the run of three and the lone fifth — and none on
    // the two comments.
    expect(plan.operations.map((op) => op.range.startLineNumber)).toEqual([1, 2, 3, 5]);
    expect(plan.changedLines).toBe(4);
  });

  it('still merges into hunks above the threshold, where the narrowing is not the point', () => {
    const size = 2000;
    const oldLines = Array.from({ length: size }, (_, i) => `N${i * 10} G1`);
    const newLines = oldLines.map((_, i) => `N${i * 5 + 1} G1`);
    const plan = planLineEdits({
      oldLines,
      newLines,
      startLine: 1,
      modelLineCount: size,
      maxColumn: (line) => oldLines[line - 1].length + 1,
      chunkLines: 500,
    });
    expect(plan.changedLines).toBe(size);
    expect(plan.operations.length).toBeLessThan(10);
  });

  it('is one undo step, whatever the plan looks like', () => {
    const model = new FakeModel('a\nb\nc\nd\ne');
    applyLinesTo(model, 1, 5, ['A', 'b', 'C', 'd', 'E']);
    expect(model.stackElements).toBe(2);
    expect(model.batches).toHaveLength(1);
    expect(model.batches[0]).toHaveLength(3);
  });

  it('does nothing at all when nothing differs', () => {
    const model = new FakeModel('N10\nN20');
    expect(applyLinesTo(model, 1, 2, ['N10', 'N20'])).toEqual({ changedLines: 0 });
    expect(model.stackElements).toBe(0);
    expect(model.batches).toHaveLength(0);
  });

  it('deletes lines in the middle, line break and all', () => {
    const model = new FakeModel('a\n\nb\n\nc');
    const map = Int32Array.from([0, -1, 1, -1, 2]);
    const result = applyLinesTo(model, 1, 5, ['a', 'b', 'c'], map);
    expect(model.text).toBe('a\nb\nc');
    expect(result.changedLines).toBe(2);
  });

  it('deletes the last lines by taking the line break before them', () => {
    const model = new FakeModel('a\nb\nc');
    applyLinesTo(model, 1, 3, ['a'], Int32Array.from([0, -1, -1]));
    expect(model.text).toBe('a');
  });

  it('leaves one empty line when everything goes', () => {
    const model = new FakeModel('a\nb');
    applyLinesTo(model, 1, 2, [''], Int32Array.from([-1, -1]));
    expect(model.text).toBe('');
  });

  it('inserts lines in the middle', () => {
    const model = new FakeModel('a\nb');
    applyLinesTo(model, 1, 2, ['a', 'x', 'y', 'b']);
    expect(model.text).toBe('a\nx\ny\nb');
  });

  it('appends after the last line', () => {
    const model = new FakeModel('a\nb');
    applyLinesTo(model, 1, 2, ['a', 'b', 'c']);
    expect(model.text).toBe('a\nb\nc');
  });

  it('keeps the trailing empty line a final newline produces', () => {
    const model = new FakeModel('N10\nN20\n');
    expect(model.getLineCount()).toBe(3);
    applyLinesTo(model, 1, 3, ['N10', 'N25', '']);
    expect(model.text).toBe('N10\nN25\n');
  });

  it('only touches the scope it was given', () => {
    const model = new FakeModel('keep 1\nkeep 2\nN10\nN20\nkeep 3');
    applyLinesTo(model, 3, 4, ['N100', 'N200']);
    expect(model.text).toBe('keep 1\nkeep 2\nN100\nN200\nkeep 3');
  });

  it('deletes inside a scope without eating the line after it', () => {
    const model = new FakeModel('head\na\n\nb\ntail');
    applyLinesTo(model, 2, 4, ['a', 'b'], Int32Array.from([0, -1, 1]));
    expect(model.text).toBe('head\na\nb\ntail');
  });

  it('deletes the end of a scope that ends at the end of the document', () => {
    const model = new FakeModel('head\na\nb');
    applyLinesTo(model, 2, 3, ['a'], Int32Array.from([0, -1]));
    expect(model.text).toBe('head\na');
  });

  it('clamps a range that no longer fits the model', () => {
    const model = new FakeModel('a\nb');
    applyLinesTo(model, 0, 99, ['A', 'B']);
    expect(model.text).toBe('A\nB');
  });
});

describe('planLineEdits: chunking', () => {
  const maxColumn = (lines: string[]) => (line: number) => lines[line - 1].length + 1;

  it('keeps per-line edits below the threshold', () => {
    const oldLines = Array.from({ length: 200 }, (_, i) => `N${i}`);
    const newLines = oldLines.map((line, i) => (i % 2 === 0 ? `${line} G1` : line));
    const plan = planLineEdits({
      oldLines,
      newLines,
      startLine: 1,
      modelLineCount: oldLines.length,
      maxColumn: maxColumn(oldLines),
    });
    expect(plan.changedLines).toBe(100);
    expect(plan.operations).toHaveLength(100);
  });

  it('merges into a handful of hunks above it, with the same text', () => {
    const size = 4000;
    const oldLines = Array.from({ length: size }, (_, i) => `N${i}`);
    const newLines = oldLines.map((line, i) => (i % 2 === 0 ? `${line} G1` : line));
    const plan = planLineEdits({
      oldLines,
      newLines,
      startLine: 1,
      modelLineCount: size,
      maxColumn: maxColumn(oldLines),
      chunkLines: 500,
    });
    expect(plan.changedLines).toBe(size / 2);
    expect(plan.operations.length).toBeLessThan(10);

    const model = new FakeModel(oldLines.join('\n'));
    applyLinesTo(model, 1, size, newLines, undefined);
    expect(model.lines).toEqual(newLines);
  });

  it('chunks a real 100k-line rewrite into a bounded number of operations', () => {
    const size = 100_000;
    const oldLines = Array.from({ length: size }, (_, i) => `N${i * 10} G1 X${i}`);
    const newLines = oldLines.map((line) => line.replace('G1', 'G01'));
    const model = new FakeModel(oldLines.join('\n'));
    const started = performance.now();
    const result = applyLinesTo(model, 1, size, newLines);
    const elapsed = performance.now() - started;
    expect(result.changedLines).toBe(size);
    expect(model.batches[0].length).toBeLessThanOrEqual(Math.ceil(size / CHUNK_LINES));
    expect(linesOf(model.text)).toEqual(newLines);
    // G7 budget for the apply step is 2 s; the plan itself has to be far cheaper.
    expect(elapsed).toBeLessThan(2000);
  });

  it('switches at the documented threshold', () => {
    expect(CHUNK_LINES).toBe(20_000);
  });

  it('plans the biggest run it will still split in well under the budget', () => {
    // One operation short of `MONACO_REDUCES_AT`: the most operations a plan can carry,
    // and every one of them narrowed. The apply budget is 2 s and Monaco still has to do
    // its half, so the planning has to be a small fraction of it.
    const size = MONACO_REDUCES_AT - 1;
    const oldLines = Array.from({ length: size }, (_, i) => `N${i * 10} G1 X${i}.`);
    const newLines = oldLines.map((_, i) => `N${i * 5 + 1} G1 X${i}.`);
    const started = performance.now();
    const plan = planLineEdits({
      oldLines,
      newLines,
      startLine: 1,
      modelLineCount: size,
      maxColumn: (line) => oldLines[line - 1].length + 1,
    });
    const elapsed = performance.now() - started;
    expect(plan.operations).toHaveLength(size);
    expect(plan.operations.every((op) => op.range.startLineNumber === op.range.endLineNumber)).toBe(
      true,
    );
    expect(elapsed).toBeLessThan(200);
  });

  it('stops splitting where Monaco would collapse the batch anyway', () => {
    // One line more, and the split would reach 1000 operations: Monaco's
    // `_reduceOperations` turns those into a single edit over the whole span, which is
    // what the un-split hunk already is — at none of the cost.
    const size = MONACO_REDUCES_AT;
    const oldLines = Array.from({ length: size }, (_, i) => `N${i * 10} G1 X${i}.`);
    const newLines = oldLines.map((_, i) => `N${i * 5 + 1} G1 X${i}.`);
    const plan = planLineEdits({
      oldLines,
      newLines,
      startLine: 1,
      modelLineCount: size,
      maxColumn: (line) => oldLines[line - 1].length + 1,
    });
    expect(plan.operations).toHaveLength(1);
    expect(plan.changedLines).toBe(size);

    const model = new FakeModel(oldLines.join('\n'));
    applyLinesTo(model, 1, size, newLines);
    expect(linesOf(model.text)).toEqual(newLines);
  });

  it('names the threshold Monaco actually uses', () => {
    expect(MONACO_REDUCES_AT).toBe(1000);
  });
});

describe('applyLines', () => {
  it('does nothing for a document that has no model', () => {
    // The real editor service holds no models in node, which is also the proof that
    // importing this module did not pull Monaco in.
    expect(applyLines('d404', 1, 10, ['anything'])).toEqual({ changedLines: 0 });
  });
});
