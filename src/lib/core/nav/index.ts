// Go to line, go to block number, and stepping through a sorted list of lines
// (plan §7.4, §7.11). Owner: WP3.5.
//
// Pure functions only: the editor side (reading lines, moving the cursor, the status
// message) lives in `contrib/navigation.ts`.
//
//   - `parseGotoInput`: `'120'` is a line, `'N120'` is a block number. The prefix is not
//     checked against the profile — `parseGotoInput` has none, and the profiles that
//     number blocks with a letter do not agree on which one (Klartext has no prefix at
//     all and still accepts `N120`, because that is how a user asks for a block). Which
//     line carries the number is `findBlock`'s business, and that one does read the
//     profile.
//   - `findBlock`: the next occurrence after `fromLine`, wrapping around the document;
//     null when the number is nowhere, so the cursor does not move.
//   - `nextInList`: the next or previous entry, reporting whether it wrapped, so F7 can
//     show "wrapped to the first tool".

import { blockNumberOf } from '$lib/core/nc/tokenizer';
import type { CompiledProfile } from '$lib/core/profiles/types';

/** What the user typed into the go-to prompt. */
export type GotoTarget = { kind: 'line'; line: number } | { kind: 'block'; number: number };

/** `120`, `N120`, `n 120`; up to three letters, so `ALT120` on some controls still reads. */
const GOTO = /^(?:([A-Za-z]{1,3})\s*)?(\d{1,9})$/;

/** Reads the go-to input, or returns null when it is neither a line nor a block number. */
export function parseGotoInput(input: string): GotoTarget | null {
  const match = GOTO.exec(input.trim());
  if (match === null) return null;
  const value = Number.parseInt(match[2], 10);
  if (!Number.isFinite(value)) return null;
  if (match[1] === undefined) return value >= 1 ? { kind: 'line', line: value } : null;
  return { kind: 'block', number: value };
}

/**
 * The 1-based line that carries block number `n`, searching after `fromLine` first and
 * wrapping; null when no line has it. `getLine` is 1-based.
 *
 * Duplicate numbers are normal — a program with subprograms restarts at `N10` — so the
 * search starts below the cursor and comes back around to it, which is what "the next
 * occurrence after the cursor" means.
 */
export function findBlock(
  getLine: (n: number) => string,
  lineCount: number,
  n: number,
  fromLine: number,
  cp: CompiledProfile,
): number | null {
  if (lineCount < 1) return null;
  const start = Math.max(0, Math.min(fromLine, lineCount));
  for (let i = 0; i < lineCount; i++) {
    const line = ((start + i) % lineCount) + 1;
    if (blockNumberOf(getLine(line), cp)?.value === n) return line;
  }
  return null;
}

/**
 * Steps through an ascending list of lines; `wrapped` is true when it started over.
 *
 * `current` does not have to be in the list: from anywhere in a tool segment, F7 goes to
 * the next tool call and Shift+F7 back to the one that opened the segment.
 */
export function nextInList(sorted: number[], current: number, dir: 1 | -1): { line: number; wrapped: boolean } | null {
  if (sorted.length === 0) return null;
  if (dir === 1) {
    for (const line of sorted) if (line > current) return { line, wrapped: false };
    return { line: sorted[0], wrapped: true };
  }
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < current) return { line: sorted[i], wrapped: false };
  return { line: sorted[sorted.length - 1], wrapped: true };
}
