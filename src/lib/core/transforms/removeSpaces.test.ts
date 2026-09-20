// Remove spaces (plan §5 WP4.3).
//
// Goldens in `tests/fixtures/transforms/remove-spaces/<case>/` (plan §8.2); a case named
// `klartext-…` is read with the Heidenhain profile, anything else with the Fanuc one.
// Every line in them is synthetic, written for gEdit from `docs/planning/syntax/`.
//
// The case that matters most is `fanuc-would-merge`: `N10 G0 X10 5` would join into
// `N10G0X105`, one word instead of two, so the guard keeps the line and the results panel
// says why. A transform that got that one wrong would produce a file that looks fine and
// cuts in the wrong place.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CodeDb } from '$lib/core/codes/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { removeSpaces } from './removeSpaces';
import type { TransformContext } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);
const NO_CODES: CodeDb = { dialect: 'test', version: 1, addresses: {}, codes: [] };

const CASES = fileURLToPath(new URL('../../../../tests/fixtures/transforms/remove-spaces/', import.meta.url));

interface Golden {
  name: string;
  cp: CompiledProfile;
  input: string;
  options: Record<string, unknown>;
  expected: string;
}

function goldens(): Golden[] {
  return readdirSync(CASES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      cp: name.startsWith('klartext') ? klartext : fanuc,
      input: readFileSync(join(CASES, name, 'input.nc'), 'utf8'),
      options: JSON.parse(readFileSync(join(CASES, name, 'options.json'), 'utf8')) as Record<string, unknown>,
      expected: readFileSync(join(CASES, name, 'expected.nc'), 'utf8'),
    }));
}

function context(cp: CompiledProfile, options: Record<string, unknown> = {}): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine: 1 };
}

describe('removeSpaces goldens', () => {
  const cases = goldens();

  it('has a case per edge', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  it.each(cases.map((golden) => [golden.name, golden] as const))('%s', (_name, golden) => {
    const result = removeSpaces.run(golden.input.split('\n'), context(golden.cp, golden.options));
    expect(result.lines.join('\n')).toBe(golden.expected);
  });

  // Only spaces and tabs may go, and nothing else may move: with the blanks taken out of
  // both sides the two texts are the same string.
  it.each(cases.map((golden) => [golden.name, golden] as const))('%s only removes blanks', (_name, golden) => {
    const strip = (text: string): string => text.replace(/[ \t]/g, '');
    const result = removeSpaces.run(golden.input.split('\n'), context(golden.cp, golden.options));
    expect(strip(result.lines.join('\n'))).toBe(strip(golden.input));
  });

  it('keeps the trailing empty element a final newline produces', () => {
    const result = removeSpaces.run('N10 G0\n'.split('\n'), context(fanuc));
    expect(result.lines).toEqual(['N10G0', '']);
  });
});

describe('removeSpaces rules', () => {
  const run = (line: string, cp = fanuc): string => removeSpaces.run([line], context(cp)).lines[0];

  it('is not available where spaces separate the words', () => {
    expect(removeSpaces.available(fanuc)).toBe(true);
    expect(removeSpaces.available(klartext)).toEqual({
      key: 'ncCleanup.removeSpaces.unavailable',
      params: { profile: klartext.profile.name },
    });
  });

  it('never removes the space a keyword needs', () => {
    expect(run('N10 GOTO 100')).toBe('N10 GOTO 100');
    expect(run('IF [#1 EQ 1] THEN #2=3')).toBe('IF [#1 EQ 1] THEN #2=3');
  });

  it('leaves the space next to a block-skip mark', () => {
    expect(run('N120 / G0 Z-1.')).toBe('N120 / G0Z-1.');
    expect(run('/N100 G0 X10.')).toBe('/N100G0X10.');
  });

  it('keeps every space inside a comment', () => {
    expect(run('N10 G0 (TWO  SPACES) X0')).toBe('N10G0(TWO  SPACES)X0');
  });

  it('keeps a line whose words would merge, and says so', () => {
    const result = removeSpaces.run(['N10 G0 X10 5'], context(fanuc));
    expect(result.lines).toEqual(['N10 G0 X10 5']);
    expect(result.skipped).toEqual([
      { line: 1, message: expect.any(String) as unknown as string, severity: 'warning' },
    ]);
  });

  it('numbers a skipped line by the document line it came from', () => {
    const result = removeSpaces.run(['N10 G0 X10 5'], { ...context(fanuc), firstLine: 42 });
    expect(result.skipped[0].line).toBe(42);
  });

  it('trims indentation and trailing blanks', () => {
    expect(run('   N130 G1 X5.  ')).toBe('N130G1X5.');
    expect(run('   ')).toBe('');
  });

  it('reports nothing to do on a line that is already compact', () => {
    const result = removeSpaces.run(['N10G0X0'], context(fanuc));
    expect(result.summary).toEqual({ key: 'ncCleanup.removeSpaces.summaryNone' });
  });
});

describe('removeSpaces performance', () => {
  const SOURCE = [
    '%',
    'O1001 (BRACKET)',
    'N10 G0 G90 X0 Y0',
    'N20 T1 M6',
    'G1 X10. Y-5. F500',
    '/N100 G0 X10.',
    '#101 = [#1 + 2.]',
    'N200 M99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = removeSpaces.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines).toHaveLength(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
