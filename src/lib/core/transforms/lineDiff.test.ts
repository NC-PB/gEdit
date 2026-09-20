// Minimal line edits (plan §5 WP4.1, §7.5, AD-12): each of the three strategies, the
// invariants `applyLines` relies on, and the budget a 100k-line renumber has to fit in.
//
// Every case ends with the same question: do the edits reproduce `newLines`? A diff that
// is small but wrong rewrites a program, so `applyEdits` below is the real assertion and
// the edit shapes are only there to prove which strategy answered.

import { describe, expect, it } from 'vitest';
import { charSpan, computeLineEdits, DEFAULT_MAX_D, type LineEdit } from './lineDiff';

/** Applies the edits from the last to the first, exactly as Monaco applies a batch. */
function applyEdits(oldLines: string[], edits: LineEdit[]): string[] {
  const out = [...oldLines];
  for (const edit of [...edits].reverse()) {
    out.splice(edit.oldStart, edit.oldEnd - edit.oldStart, ...edit.newLines);
  }
  return out;
}

/** The two invariants `monaco/applyLines.ts` builds its ranges on. */
function expectWellFormed(edits: LineEdit[], oldLength: number): void {
  let previousEnd = -1;
  for (const edit of edits) {
    expect(edit.oldStart).toBeGreaterThanOrEqual(0);
    expect(edit.oldEnd).toBeGreaterThanOrEqual(edit.oldStart);
    expect(edit.oldEnd).toBeLessThanOrEqual(oldLength);
    // Strictly after the previous edit: a deletion may take the line break of the line
    // that follows it, and that line must not belong to the next edit.
    expect(edit.oldStart).toBeGreaterThan(previousEnd);
    previousEnd = edit.oldEnd;
  }
}

/** Runs one case through both the diff and the check that it reproduces the text. */
function roundTrip(oldLines: string[], newLines: string[], lineMap?: Int32Array): LineEdit[] {
  const edits = computeLineEdits(oldLines, newLines, lineMap);
  expectWellFormed(edits, oldLines.length);
  expect(applyEdits(oldLines, edits)).toEqual(newLines);
  return edits;
}

describe('computeLineEdits: the same number of lines', () => {
  it('reports nothing when nothing changed', () => {
    expect(computeLineEdits(['N10 G0', 'N20 G1'], ['N10 G0', 'N20 G1'])).toEqual([]);
  });

  it('emits one edit per run of changed lines', () => {
    const edits = roundTrip(
      ['N10 G0', 'N20 G1', 'N30 G1', 'N40 M30'],
      ['N10 G0', 'N25 G1', 'N35 G1', 'N40 M30'],
    );
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 3, newLines: ['N25 G1', 'N35 G1'] }]);
  });

  it('separates two runs by the untouched line between them', () => {
    const edits = roundTrip(
      ['a', 'b', 'c', 'd', 'e'],
      ['A', 'b', 'C', 'd', 'E'],
    );
    expect(edits).toEqual([
      { oldStart: 0, oldEnd: 1, newLines: ['A'] },
      { oldStart: 2, oldEnd: 3, newLines: ['C'] },
      { oldStart: 4, oldEnd: 5, newLines: ['E'] },
    ]);
  });

  it('prefers the line-by-line walk even when a lineMap is offered', () => {
    // Same length wins: it is O(n) and needs no trust in the map.
    const map = Int32Array.from([-1, -1, -1]);
    const edits = roundTrip(['a', 'b', 'c'], ['a', 'B', 'c'], map);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 2, newLines: ['B'] }]);
  });

  it('keeps the trailing empty element a final newline produces', () => {
    const edits = roundTrip(['N10', 'N20', ''], ['N10', 'N25', '']);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 2, newLines: ['N25'] }]);
  });
});

describe('computeLineEdits: with a lineMap', () => {
  it('turns a deletion into one edit and leaves the survivors alone', () => {
    // remove-empty-lines: 'a', '', 'b', '', 'c'  ->  'a', 'b', 'c'
    const oldLines = ['a', '', 'b', '', 'c'];
    const newLines = ['a', 'b', 'c'];
    const map = Int32Array.from([0, -1, 1, -1, 2]);
    const edits = roundTrip(oldLines, newLines, map);
    expect(edits).toEqual([
      { oldStart: 1, oldEnd: 2, newLines: [] },
      { oldStart: 3, oldEnd: 4, newLines: [] },
    ]);
  });

  it('reports a deletion and a change in the same run as one edit', () => {
    const oldLines = ['a', '(note)', 'b', 'c'];
    const newLines = ['a', 'B', 'c'];
    const map = Int32Array.from([0, -1, 1, 2]);
    const edits = roundTrip(oldLines, newLines, map);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 3, newLines: ['B'] }]);
  });

  it('handles an insertion the map does not account for', () => {
    const oldLines = ['a', 'b'];
    const newLines = ['a', 'inserted', 'b'];
    const map = Int32Array.from([0, 2]);
    const edits = roundTrip(oldLines, newLines, map);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 1, newLines: ['inserted'] }]);
  });

  it('refuses to trust a map that claims a line survived unchanged when it did not', () => {
    const oldLines = ['a', 'b', 'c'];
    const newLines = ['a', 'B'];
    // The map says old 'b' became new[1], which now reads 'B'; the anchor is dropped.
    const map = Int32Array.from([0, 1, -1]);
    const edits = roundTrip(oldLines, newLines, map);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 3, newLines: ['B'] }]);
  });

  it('refuses a map that runs backwards', () => {
    const oldLines = ['a', 'b', 'c'];
    const newLines = ['b', 'a'];
    const map = Int32Array.from([1, 0, -1]);
    roundTrip(oldLines, newLines, map);
  });

  it('ignores a map of the wrong length and diffs instead', () => {
    const oldLines = ['a', 'b', 'c'];
    const newLines = ['a', 'c'];
    roundTrip(oldLines, newLines, Int32Array.from([0, -1]));
  });

  it('deletes everything a map empties out', () => {
    const edits = roundTrip(['a', 'b'], [], Int32Array.from([-1, -1]));
    expect(edits).toEqual([{ oldStart: 0, oldEnd: 2, newLines: [] }]);
  });
});

describe('computeLineEdits: the Myers fallback', () => {
  it('trims the common prefix and suffix before diffing', () => {
    const oldLines = ['head', 'a', 'b', 'tail'];
    const newLines = ['head', 'a', 'x', 'b', 'tail'];
    const edits = roundTrip(oldLines, newLines);
    expect(edits).toEqual([{ oldStart: 2, oldEnd: 2, newLines: ['x'] }]);
  });

  it('reports a pure insertion without searching', () => {
    const edits = roundTrip(['a', 'b'], ['a', 'x', 'y', 'b']);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 1, newLines: ['x', 'y'] }]);
  });

  it('reports a pure deletion without searching', () => {
    const edits = roundTrip(['a', 'x', 'y', 'b'], ['a', 'b']);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 3, newLines: [] }]);
  });

  it('finds several hunks across a document', () => {
    const oldLines = ['1', '2', '3', '4', '5', '6', '7'];
    const newLines = ['1', '3', '4', 'new', '5', '6', '7', '8'];
    const edits = roundTrip(oldLines, newLines);
    expect(edits.length).toBeGreaterThan(1);
  });

  it('merges a deletion and an insertion at the same place into one edit', () => {
    const edits = roundTrip(['a', 'b', 'c'], ['a', 'x', 'y', 'c']);
    expect(edits).toEqual([{ oldStart: 1, oldEnd: 2, newLines: ['x', 'y'] }]);
  });

  it('falls back to one hunk once the search passes maxD', () => {
    const oldLines = ['keep', ...Array.from({ length: 40 }, (_, i) => `old-${i}`), 'tail'];
    const newLines = ['keep', ...Array.from({ length: 41 }, (_, i) => `new-${i}`), 'tail'];
    const edits = computeLineEdits(oldLines, newLines, undefined, { maxD: 2 });
    expect(edits).toEqual([
      { oldStart: 1, oldEnd: 41, newLines: newLines.slice(1, 42) },
    ]);
    expect(applyEdits(oldLines, edits)).toEqual(newLines);
  });

  it('answers the same content with or without the cap', () => {
    const oldLines = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const newLines = oldLines.filter((_, i) => i % 7 !== 0);
    const capped = computeLineEdits(oldLines, newLines, undefined, { maxD: 1 });
    expect(applyEdits(oldLines, capped)).toEqual(newLines);
    expect(applyEdits(oldLines, roundTrip(oldLines, newLines))).toEqual(newLines);
  });

  it('caps at 2000 by default', () => {
    expect(DEFAULT_MAX_D).toBe(2000);
  });

  it('reproduces a hundred random edit scripts', () => {
    // A deterministic pseudo-random walk: the shapes a transform produces are not the
    // shapes that break a diff, so the coverage has to come from somewhere else.
    let seed = 20240401;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 100; round++) {
      const oldLines = Array.from({ length: 1 + Math.floor(next() * 30) }, (_, i) => `l${i}`);
      const newLines: string[] = [];
      for (const line of oldLines) {
        const roll = next();
        if (roll < 0.2) continue;
        if (roll < 0.3) newLines.push(`${line}!`);
        else newLines.push(line);
        if (roll > 0.9) newLines.push(`extra-${round}`);
      }
      roundTrip(oldLines, newLines);
    }
  });
});

describe('computeLineEdits: performance', () => {
  it('walks 100k same-length lines in well under 200 ms', () => {
    const oldLines = Array.from({ length: 100_000 }, (_, i) => `N${i * 10} G1 X${i}.5`);
    const newLines = oldLines.map((line, i) => (i % 3 === 0 ? line.replace('G1', 'G01') : line));
    const started = performance.now();
    const edits = computeLineEdits(oldLines, newLines);
    const elapsed = performance.now() - started;
    expect(edits.length).toBe(33_334);
    expect(elapsed).toBeLessThan(200);
  });

  it('answers a 100k-line deletion from a lineMap in well under 200 ms', () => {
    const oldLines = Array.from({ length: 100_000 }, (_, i) => (i % 5 === 0 ? '' : `N${i} G1`));
    const newLines: string[] = [];
    const map = new Int32Array(oldLines.length);
    oldLines.forEach((line, i) => {
      if (line === '') {
        map[i] = -1;
        return;
      }
      map[i] = newLines.length;
      newLines.push(line);
    });
    const started = performance.now();
    const edits = computeLineEdits(oldLines, newLines, map);
    const elapsed = performance.now() - started;
    expect(edits.length).toBe(20_000);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('charSpan', () => {
  it('answers null when the lines are equal', () => {
    expect(charSpan('N10 G0 X1', 'N10 G0 X1')).toBeNull();
  });

  it('narrows a renumber to the digits that moved', () => {
    expect(charSpan('N100 G1 X12.5', 'N110 G1 X12.5')).toEqual({
      start: 2,
      endOld: 3,
      text: '1',
    });
  });

  it('narrows a growing block number', () => {
    expect(charSpan('N90 G1', 'N100 G1')).toEqual({ start: 1, endOld: 2, text: '10' });
  });

  it('reports a pure deletion inside a line', () => {
    // The shared run is trimmed from both ends, so the span is the one extra space.
    expect(charSpan('N10  G0', 'N10 G0')).toEqual({ start: 4, endOld: 5, text: '' });
  });

  it('reports a pure insertion inside a line', () => {
    expect(charSpan('G0X10', 'G0 X10')).toEqual({ start: 2, endOld: 2, text: ' ' });
  });

  it('answers null when the whole line has to be replaced', () => {
    expect(charSpan('G0 X1', 'M98 P2')).toBeNull();
  });

  it('still narrows when only the last character is shared', () => {
    expect(charSpan('G0 X10', 'M30')).toEqual({ start: 0, endOld: 5, text: 'M3' });
  });

  it('answers null for a line that became empty', () => {
    expect(charSpan('(setup)', '')).toBeNull();
  });

  it('keeps a surrogate pair whole', () => {
    // The emoji is two UTF-16 units; cutting between them would leave half a character.
    const span = charSpan('(pass \u{1F600} one)', '(pass \u{1F600} two)');
    expect(span).not.toBeNull();
    const rebuilt =
      '(pass \u{1F600} one)'.slice(0, span?.start) +
      (span?.text ?? '') +
      '(pass \u{1F600} one)'.slice(span?.endOld);
    expect(rebuilt).toBe('(pass \u{1F600} two)');
  });

  // -- the span as Monaco will actually apply it -------------------------------
  //
  // The round trip above is not the whole story. A span becomes a Monaco range, and
  // Monaco *validates* a range before applying it: a boundary whose preceding character
  // is a high surrogate is pushed outwards (`TextModel.validateRange`). The end guard
  // used to test the wrong character, so `(a😀)` → `(A😀)` produced a range Monaco
  // widened, and the emoji came back as a lone high surrogate (G8 M4). These cases
  // apply the span the way the editor does, not the way a string slice does.

  /**
   * `oldLine` with `span` applied through Monaco's range validation.
   *
   * The rule is `node_modules/monaco-editor/esm/vs/editor/common/model/textModel.js`
   * (`validateRange`): a start or end boundary is "inside a surrogate pair" when the
   * character in front of it is a high surrogate, and the range is widened by one
   * character at that end. The end check only applies while the boundary is not the end
   * of the line, which is the `endColumn <= lineLength` half of Monaco's condition.
   */
  function applyThroughMonaco(oldLine: string, span: { start: number; endOld: number; text: string }): string {
    const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
    let { start, endOld } = span;
    const startInsidePair = start > 0 && isHigh(oldLine.charCodeAt(start - 1));
    const endInsidePair = endOld > 0 && endOld < oldLine.length && isHigh(oldLine.charCodeAt(endOld - 1));
    if (startInsidePair) start--;
    if (endInsidePair) endOld++;
    return oldLine.slice(0, start) + span.text + oldLine.slice(endOld);
  }

  const NON_BMP: [string, string, string][] = [
    // The finding's own cases: an edit that ends immediately in front of an emoji.
    ['(a\u{1F600})', '(A\u{1F600})', 'an edit ending in front of an emoji inside a comment'],
    ['X1\u{1F600}Y2', 'X9\u{1F600}Y2', 'an edit ending in front of an emoji between two words'],
    // And the mirror: an edit that starts immediately behind one.
    ['(\u{1F600}a)', '(\u{1F600}A)', 'an edit starting behind an emoji'],
    ['(\u{1F600}a\u{1F601})', '(\u{1F600}A\u{1F601})', 'an edit between two emoji'],
    // The pair itself changes: both ends land inside a pair, so the whole of it moves.
    ['\u{1F600}', '\u{1F601}', 'the astral character itself'],
    ['N10 (\u{1F600})', 'N20 (\u{1F600})', 'a renumber in front of an emoji'],
    // Lone surrogates: Monaco widens on a high one wherever it stands, pair or not.
    ['(\ud83da)', '(\ud83dA)', 'an edit behind a lone high surrogate'],
    ['(a\ud83d)', '(A\ud83d)', 'an edit in front of a lone high surrogate'],
    ['(a\udc00)', '(A\udc00)', 'an edit in front of a lone low surrogate'],
  ];

  it.each(NON_BMP)('applies %s → %s through Monaco unchanged (%s)', (oldLine, newLine) => {
    const span = charSpan(oldLine, newLine);
    if (span === null) return; // a null span replaces the whole line, which is always safe
    expect(applyThroughMonaco(oldLine, span)).toBe(newLine);
  });

  it('never leaves a boundary with a high surrogate in front of it', () => {
    const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
    for (const [oldLine, newLine] of NON_BMP) {
      const span = charSpan(oldLine, newLine);
      if (span === null) continue;
      expect(isHigh(oldLine.charCodeAt(span.start - 1)), `start of ${oldLine}`).toBe(false);
      // The end boundary only matters while it is not the end of the line, which is
      // where Monaco stops looking.
      if (span.endOld < oldLine.length) {
        expect(isHigh(oldLine.charCodeAt(span.endOld - 1)), `end of ${oldLine}`).toBe(false);
      }
      // The plain string round trip has to keep working too.
      expect(oldLine.slice(0, span.start) + span.text + oldLine.slice(span.endOld)).toBe(newLine);
    }
  });

  it('rebuilds the new line from the span in every case', () => {
    const cases: [string, string][] = [
      ['', 'N10'],
      ['N10', ''],
      ['aaa', 'aa'],
      ['aa', 'aaa'],
      ['N10 G1 F100', 'N10 G1 F200.'],
      ['(a)', '(a) (b)'],
      ['X-0.5', 'X-.5'],
    ];
    for (const [oldLine, newLine] of cases) {
      const span = charSpan(oldLine, newLine);
      if (span === null) continue;
      expect(oldLine.slice(0, span.start) + span.text + oldLine.slice(span.endOld)).toBe(newLine);
    }
  });
});
