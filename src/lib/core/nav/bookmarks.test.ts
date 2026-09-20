// The pure half of bookmarks (plan §5 WP4.4: "next and previous with wrap (pure)").
//
// Everything F2 and Shift+F2 promise is decided here, so it is checked here: the cursor
// does not have to sit on a bookmark, stepping wraps at both ends, and a list Monaco
// handed back out of order or with a duplicate (two bookmarks an edit merged onto one
// line) still behaves.

import { describe, expect, it } from 'vitest';
import { stepBookmark, toggleBookmark } from './bookmarks';

describe('toggleBookmark', () => {
  it('adds a line and keeps the list sorted', () => {
    expect(toggleBookmark([], 12)).toEqual([12]);
    expect(toggleBookmark([20, 4], 12)).toEqual([4, 12, 20]);
  });

  it('removes a line that is already bookmarked', () => {
    expect(toggleBookmark([4, 12, 20], 12)).toEqual([4, 20]);
    expect(toggleBookmark([12], 12)).toEqual([]);
  });

  it('removes every copy of a line that an edit duplicated', () => {
    expect(toggleBookmark([4, 12, 12], 12)).toEqual([4]);
  });

  it('never leaves a duplicate behind', () => {
    expect(toggleBookmark([4, 4, 20], 12)).toEqual([4, 12, 20]);
  });

  it('does not mutate the input', () => {
    const lines = [4, 20];
    expect(toggleBookmark(lines, 12)).toEqual([4, 12, 20]);
    expect(lines).toEqual([4, 20]);
  });
});

describe('stepBookmark', () => {
  const lines = [4, 12, 20];

  it('answers null when there is no bookmark', () => {
    expect(stepBookmark([], 1, 1)).toBeNull();
    expect(stepBookmark([], 1, -1)).toBeNull();
  });

  it('goes to the next bookmark below the cursor', () => {
    expect(stepBookmark(lines, 1, 1)).toBe(4);
    expect(stepBookmark(lines, 4, 1)).toBe(12);
    expect(stepBookmark(lines, 7, 1)).toBe(12);
  });

  it('goes to the previous bookmark above the cursor', () => {
    expect(stepBookmark(lines, 21, -1)).toBe(20);
    expect(stepBookmark(lines, 20, -1)).toBe(12);
    expect(stepBookmark(lines, 7, -1)).toBe(4);
  });

  it('wraps at the end and at the start', () => {
    expect(stepBookmark(lines, 20, 1)).toBe(4);
    expect(stepBookmark(lines, 999, 1)).toBe(4);
    expect(stepBookmark(lines, 4, -1)).toBe(20);
    expect(stepBookmark(lines, 0, -1)).toBe(20);
  });

  it('walks the whole list in both directions and comes back to where it started', () => {
    const forwards: number[] = [];
    let at = 1;
    for (let i = 0; i < lines.length; i += 1) {
      at = stepBookmark(lines, at, 1) ?? at;
      forwards.push(at);
    }
    expect(forwards).toEqual([4, 12, 20]);
    expect(stepBookmark(lines, at, 1)).toBe(4);

    const backwards: number[] = [];
    at = 21;
    for (let i = 0; i < lines.length; i += 1) {
      at = stepBookmark(lines, at, -1) ?? at;
      backwards.push(at);
    }
    expect(backwards).toEqual([20, 12, 4]);
    expect(stepBookmark(lines, at, -1)).toBe(20);
  });

  it('reveals the only bookmark even when the cursor is already on it', () => {
    expect(stepBookmark([12], 12, 1)).toBe(12);
    expect(stepBookmark([12], 12, -1)).toBe(12);
  });

  it('sorts and de-duplicates a list Monaco handed back after an edit', () => {
    expect(stepBookmark([20, 4, 12], 4, 1)).toBe(12);
    expect(stepBookmark([12, 12, 4], 4, 1)).toBe(12);
    expect(stepBookmark([12, 12, 4], 12, 1)).toBe(4);
  });
});
