// Bookmark arithmetic (plan §5 WP4.4). Owner: WP4.4.
//
// The pure half of bookmarks: a sorted list of 1-based line numbers, and what toggling
// and stepping through it mean. Monaco's decorations live next door in
// `monaco/bookmarks.ts`; keeping the arithmetic here is what makes "next and previous
// wrap" testable without an editor.
//
// `core/nav/index.ts` already has `nextInList(sorted, current, dir)` for the tool-change
// list (F7 / Shift+F7), which does **not** wrap. Bookmarks do, which is why they get
// their own function rather than a flag on that one.
//
// Both functions normalize their input (sorted, without duplicates) instead of trusting
// it. The caller is `monaco/bookmarks.ts`, which reads the lines back from Monaco's
// decorations: two bookmarks whose lines an edit has merged arrive as a duplicate, and a
// decoration that moved up past its neighbour arrives out of order. Normalizing here is
// one `Set` and one sort over a handful of numbers, and it is the difference between F2
// visiting every bookmark and F2 getting stuck.

/** `lines` sorted ascending and without duplicates. */
function normalize(lines: readonly number[]): number[] {
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * `lines` with `line` added or removed, kept sorted and without duplicates.
 * The input is never mutated.
 */
export function toggleBookmark(lines: readonly number[], line: number): number[] {
  const rest = lines.filter((other) => other !== line);
  return normalize(rest.length === lines.length ? [...rest, line] : rest);
}

/**
 * The next bookmark after `current` (`dir` 1) or before it (`dir` -1), wrapping around
 * the ends. Null when there are no bookmarks at all.
 *
 * `current` is the cursor's line and need not be a bookmark itself. A single bookmark on
 * the cursor's own line answers with that line, so F2 always reveals something.
 */
export function stepBookmark(lines: readonly number[], current: number, dir: 1 | -1): number | null {
  const sorted = normalize(lines);
  if (sorted.length === 0) return null;
  if (dir === 1) {
    for (const line of sorted) if (line > current) return line;
    return sorted[0];
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) if (sorted[i] < current) return sorted[i];
  return sorted[sorted.length - 1];
}
