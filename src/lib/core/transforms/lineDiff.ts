// Minimal line edits (plan §7.5, AD-12). Owner: **WP4.1**.
//
// A transform hands back the whole new range. Replacing the range wholesale would work,
// but it would also move every bookmark, collapse every fold and reset the cursor, so
// `applyLines` asks this module which lines actually changed and edits only those.
//
// Three strategies, in the order `computeLineEdits` tries them:
//
//  1. **Same length** — compare line by line and emit one edit per changed run. This is
//     what a renumber or a case conversion looks like, and it is O(n).
//  2. **With a `lineMap`** — the transform already said which input line became which
//     output line, so the edits are the deletions plus the changed survivors. No diff at
//     all. Every transform that can should provide one.
//  3. **Otherwise** — trim the common prefix and suffix, then a Myers diff capped at
//     `maxD` (2000 by default). Past the cap the answer is one hunk covering the rest,
//     which is correct, just not minimal: a 100k-line file that changed everywhere must
//     not spend a minute looking for an elegant diff.
//
// Correctness before minimality, always. Applying the returned edits in order, from the
// last to the first, has to reproduce `newLines` exactly — including the trailing empty
// element that a final newline produces.
//
// Two invariants every strategy keeps, because `applyLines` builds Monaco ranges from
// them and Monaco refuses overlapping edits:
//
//  - the edits are in ascending order of `oldStart`;
//  - consecutive edits are separated by at least one untouched line
//    (`next.oldStart > prev.oldEnd`), so a deletion may take the line break of the line
//    after it without reaching into the next edit.

/**
 * One replacement, in **0-based** indices into the old array, `oldEnd` exclusive.
 * A pure deletion has an empty `newLines`; a pure insertion has `oldStart === oldEnd`.
 */
export interface LineEdit {
  oldStart: number;
  oldEnd: number;
  newLines: string[];
}

/** The default cap on the Myers search; past it the answer is one hunk (AD-12). */
export const DEFAULT_MAX_D = 2000;

// ---------------------------------------------------------------------------
// Strategy 1: the same number of lines
// ---------------------------------------------------------------------------

/** One edit per run of differing lines. Only valid when both arrays are the same length. */
function sameLengthEdits(oldLines: string[], newLines: string[]): LineEdit[] {
  const edits: LineEdit[] = [];
  const n = oldLines.length;
  let i = 0;
  while (i < n) {
    if (oldLines[i] === newLines[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < n && oldLines[i] !== newLines[i]) i++;
    edits.push({ oldStart: start, oldEnd: i, newLines: newLines.slice(start, i) });
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Strategy 2: the transform told us what became what
// ---------------------------------------------------------------------------

/**
 * The edits a `lineMap` implies.
 *
 * An old line is left alone only when it maps to a new line that is *also* still equal to
 * it and keeps the order of the lines before it; everything between two such anchors is
 * one edit. A map that claims more than it delivers therefore costs a bigger edit, never
 * a wrong one, and a map that is the wrong length is refused by the caller.
 */
function lineMapEdits(oldLines: string[], newLines: string[], lineMap: Int32Array): LineEdit[] {
  const edits: LineEdit[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let lastAnchor = -1;

  const push = (oldEnd: number, newEnd: number): void => {
    if (oldIndex < oldEnd || newIndex < newEnd) {
      edits.push({ oldStart: oldIndex, oldEnd, newLines: newLines.slice(newIndex, newEnd) });
    }
  };

  for (let i = 0; i < oldLines.length; i++) {
    const j = lineMap[i];
    if (j < 0 || j <= lastAnchor || j >= newLines.length) continue;
    if (oldLines[i] !== newLines[j]) continue;
    push(i, j);
    lastAnchor = j;
    oldIndex = i + 1;
    newIndex = j + 1;
  }
  push(oldLines.length, newLines.length);
  return edits;
}

// ---------------------------------------------------------------------------
// Strategy 3: Myers, capped
// ---------------------------------------------------------------------------

/** One atomic step of the edit script, in the order it applies. */
interface Op {
  oldStart: number;
  oldEnd: number;
  line?: string;
}

/**
 * The classic greedy Myers diff (O((n+m)·D)), returning null once the edit distance
 * passes `maxD`. `a` and `b` are already trimmed of their common prefix and suffix.
 *
 * `trace[d]` is the furthest-reaching state *before* round `d` ran, which is what the
 * backtrack needs to know which of the two neighbouring diagonals each step came from.
 */
function myersOps(a: string[], b: string[], maxD: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(maxD, n + m);
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, offset, b, n, m);
    }
  }
  return null;
}

/** Walks the trace back to the origin and returns the edit script in forward order. */
function backtrack(
  trace: Int32Array[],
  dEnd: number,
  offset: number,
  b: string[],
  n: number,
  m: number,
): Op[] {
  const reversed: Op[] = [];
  // The search always stops on (n, m); every round before it is read off the trace.
  let x = n;
  let y = m;

  for (let d = dEnd; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    // The diagonal run at the end of this round costs nothing: those lines are equal.
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (down) reversed.push({ oldStart: x, oldEnd: x, line: b[prevY] });
    else reversed.push({ oldStart: prevX, oldEnd: prevX + 1 });
    x = prevX;
    y = prevY;
  }
  reversed.reverse();
  return reversed;
}

/** Merges atomic ops into `LineEdit`s, keeping them ascending and never touching. */
function mergeOps(ops: Op[], offset: number): LineEdit[] {
  const edits: LineEdit[] = [];
  for (const op of ops) {
    const last = edits[edits.length - 1];
    if (last && op.oldStart + offset <= last.oldEnd) {
      last.oldEnd = Math.max(last.oldEnd, op.oldEnd + offset);
      if (op.line !== undefined) last.newLines.push(op.line);
      continue;
    }
    edits.push({
      oldStart: op.oldStart + offset,
      oldEnd: op.oldEnd + offset,
      newLines: op.line === undefined ? [] : [op.line],
    });
  }
  return edits;
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * The edits that turn `oldLines` into `newLines`, in ascending order and never
 * overlapping.
 *
 * `lineMap` is `TransformResult.lineMap`: `lineMap[i]` is the index in `newLines` that
 * `oldLines[i]` became, or -1 when it was deleted. `o.maxD` caps the Myers search.
 */
export function computeLineEdits(
  oldLines: string[],
  newLines: string[],
  lineMap?: Int32Array,
  o?: { maxD?: number },
): LineEdit[] {
  if (oldLines.length === newLines.length) return sameLengthEdits(oldLines, newLines);
  if (lineMap && lineMap.length === oldLines.length) return lineMapEdits(oldLines, newLines, lineMap);

  // Trim what both sides share, so the diff only sees the part that moved.
  const limit = Math.min(oldLines.length, newLines.length);
  let prefix = 0;
  while (prefix < limit && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const a = oldLines.slice(prefix, oldLines.length - suffix);
  const b = newLines.slice(prefix, newLines.length - suffix);
  if (a.length === 0 && b.length === 0) return [];
  // A pure insertion or a pure deletion needs no search at all.
  if (a.length === 0 || b.length === 0) {
    return [{ oldStart: prefix, oldEnd: prefix + a.length, newLines: b }];
  }

  const ops = myersOps(a, b, Math.max(1, o?.maxD ?? DEFAULT_MAX_D));
  if (ops === null) {
    // Past the cap: one hunk over everything that is not shared. Correct, not minimal.
    return [{ oldStart: prefix, oldEnd: prefix + a.length, newLines: b }];
  }
  return mergeOps(ops, prefix);
}

/**
 * The single changed span inside one line, or null when the whole line has to be
 * replaced (or nothing changed at all).
 *
 * `start` is the first differing UTF-16 offset, `endOld` is one past the last differing
 * offset **in the old line**, and `text` is what goes there. Replacing just that span
 * keeps the decorations and the cursor at the untouched ends of the line, which is what
 * makes a renumber leave a bookmark's column alone.
 *
 * ## Why both ends ask the same question
 *
 * A span is handed to Monaco as a range, and Monaco validates a range before it applies
 * it (`TextModel.validateRange`). Its rule is stated once and used at both ends: a
 * boundary is *inside a surrogate pair* when the character **immediately before it** is a
 * high surrogate, and such a boundary is pushed outwards — `startColumn - 1` at the
 * start, `endColumn + 1` at the end. A widened end swallows a character the replacement
 * text does not carry, so the character is deleted: `(a😀)` → `(A😀)` came back as
 * `(A\uD83D)`, a lone high surrogate where the emoji was (G8 M4).
 *
 * So both guards below test `isHighSurrogate(oldLine.charCodeAt(boundary - 1))` and move
 * the boundary the way Monaco would have — the start left, the end right — which makes
 * the range one Monaco accepts as written. Widening is always safe: the characters it
 * takes in are part of the common prefix or suffix, so they are equal on both sides and
 * `text` grows by exactly the same characters.
 *
 * The loops walk, rather than stepping once, so the invariant holds whatever the line
 * contains — a run of lone high surrogates included.
 */
export function charSpan(
  oldLine: string,
  newLine: string,
): { start: number; endOld: number; text: string } | null {
  if (oldLine === newLine) return null;

  const limit = Math.min(oldLine.length, newLine.length);
  let start = 0;
  while (start < limit && oldLine.charCodeAt(start) === newLine.charCodeAt(start)) start++;
  // Never cut a surrogate pair in half: an emoji in a comment is one character, and half
  // of one is not text any more.
  while (start > 0 && isHighSurrogate(oldLine.charCodeAt(start - 1))) start--;

  let end = 0;
  while (
    end < limit - start &&
    oldLine.charCodeAt(oldLine.length - 1 - end) === newLine.charCodeAt(newLine.length - 1 - end)
  ) {
    end++;
  }
  // `oldLine.length - end` is where the kept suffix starts, so the character before the
  // boundary is at `oldLine.length - end - 1`. Dropping one from the suffix moves the
  // boundary to the right, past the low surrogate.
  while (end > 0 && isHighSurrogate(oldLine.charCodeAt(oldLine.length - end - 1))) end--;

  if (start === 0 && end === 0) return null;
  return {
    start,
    endOld: oldLine.length - end,
    text: newLine.slice(start, newLine.length - end),
  };
}

/**
 * Monaco's own test for "this boundary is inside a surrogate pair", applied to the
 * character in front of the boundary (`strings.isHighSurrogate` in `textModel.ts`).
 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
