// Go to line, go to block number, and the tool-change step (plan §5 WP3.5, §7.4).

import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { findBlock, nextInList, parseGotoInput } from './index';
import type { CompiledProfile } from '$lib/core/profiles/types';

function compiled(id: string): CompiledProfile {
  const raw = BUILTIN_PROFILE_JSON.find((entry) => (entry as { id?: string }).id === id);
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return compileProfile(checked.profile);
}

const FANUC = compiled('fanuc-gcode');
const KLARTEXT = compiled('heidenhain-klartext');

/** `findBlock` over a block of text. */
function find(text: string, n: number, fromLine: number, cp: CompiledProfile): number | null {
  const lines = text.split('\n');
  return findBlock((line) => lines[line - 1], lines.length, n, fromLine, cp);
}

describe('parseGotoInput', () => {
  it('reads a plain number as a line', () => {
    expect(parseGotoInput('120')).toEqual({ kind: 'line', line: 120 });
    expect(parseGotoInput('  7  ')).toEqual({ kind: 'line', line: 7 });
  });

  it('reads a letter prefix as a block number', () => {
    expect(parseGotoInput('N120')).toEqual({ kind: 'block', number: 120 });
    expect(parseGotoInput('n120')).toEqual({ kind: 'block', number: 120 });
    expect(parseGotoInput('N 120')).toEqual({ kind: 'block', number: 120 });
    // Klartext numbers blocks with a leading integer and still answers `N120`.
    expect(parseGotoInput('N0')).toEqual({ kind: 'block', number: 0 });
  });

  it('refuses anything else', () => {
    for (const input of ['', '   ', 'N', 'abc', '12.5', '-3', '1 2', 'N12X', '0', '1234567890']) {
      expect(parseGotoInput(input), input).toBeNull();
    }
  });
});

describe('findBlock', () => {
  const fanuc = ['(HEADER)', 'N10 G0 X0.', 'N20 G1 Z-1.', 'M98 P1000', 'N10 G0 Z25.', 'N30 M30'].join('\n');

  it('finds the block after the cursor and wraps around', () => {
    expect(find(fanuc, 20, 1, FANUC)).toBe(3);
    expect(find(fanuc, 30, 1, FANUC)).toBe(6);
    // Two lines carry N10: from the top the first one, from below it the second.
    expect(find(fanuc, 10, 1, FANUC)).toBe(2);
    expect(find(fanuc, 10, 2, FANUC)).toBe(5);
    expect(find(fanuc, 10, 5, FANUC)).toBe(2);
  });

  it('finds the block the cursor is already on only after a full turn', () => {
    expect(find(fanuc, 20, 3, FANUC)).toBe(3);
  });

  it('answers null when no line carries the number', () => {
    expect(find(fanuc, 99, 1, FANUC)).toBeNull();
    expect(find('', 10, 1, FANUC)).toBeNull();
    expect(findBlock(() => '', 0, 10, 1, FANUC)).toBeNull();
  });

  it('does not take a P or a line number for a block number', () => {
    // `M98 P1000` calls program 1000; it is not block 1000.
    expect(find(fanuc, 1000, 1, FANUC)).toBeNull();
  });

  it('reads the leading integer of a Klartext block', () => {
    const klartext = ['0 BEGIN PGM A MM', '1 TOOL CALL 1 Z S100', '2 L X+0', '3 END PGM A MM'].join('\n');
    expect(find(klartext, 2, 1, KLARTEXT)).toBe(3);
    expect(find(klartext, 0, 2, KLARTEXT)).toBe(1);
    expect(find(klartext, 9, 1, KLARTEXT)).toBeNull();
  });

  it('sees through a block skip in front of the number', () => {
    expect(find(['N10 X0.', '/N20 X1.', '/1 N30 X2.'].join('\n'), 20, 1, FANUC)).toBe(2);
    expect(find(['N10 X0.', '/N20 X1.', '/1 N30 X2.'].join('\n'), 30, 1, FANUC)).toBe(3);
  });
});

describe('nextInList', () => {
  const tools = [11, 30, 49];

  it('steps forward and wraps at the end', () => {
    expect(nextInList(tools, 1, 1)).toEqual({ line: 11, wrapped: false });
    expect(nextInList(tools, 11, 1)).toEqual({ line: 30, wrapped: false });
    expect(nextInList(tools, 40, 1)).toEqual({ line: 49, wrapped: false });
    expect(nextInList(tools, 49, 1)).toEqual({ line: 11, wrapped: true });
    expect(nextInList(tools, 99, 1)).toEqual({ line: 11, wrapped: true });
  });

  it('steps back and wraps at the start', () => {
    expect(nextInList(tools, 49, -1)).toEqual({ line: 30, wrapped: false });
    expect(nextInList(tools, 40, -1)).toEqual({ line: 30, wrapped: false });
    expect(nextInList(tools, 11, -1)).toEqual({ line: 49, wrapped: true });
    expect(nextInList(tools, 1, -1)).toEqual({ line: 49, wrapped: true });
  });

  it('answers null for an empty list and stays put with a single entry', () => {
    expect(nextInList([], 5, 1)).toBeNull();
    expect(nextInList([], 5, -1)).toBeNull();
    expect(nextInList([7], 7, 1)).toEqual({ line: 7, wrapped: true });
    expect(nextInList([7], 7, -1)).toEqual({ line: 7, wrapped: true });
  });
});
