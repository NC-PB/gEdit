// Insert spaces (plan §5 WP4.3).
//
// The goldens live in `tests/fixtures/transforms/insert-spaces/<case>/`, one folder per
// case with `input.nc`, `options.json` and `expected.nc` (plan §8.2). The case name says
// which dialect it is read with: `klartext-…` uses the Heidenhain profile, anything else
// the Fanuc one. Every line in them is synthetic — written for gEdit from the lexical
// rules in `docs/planning/syntax/`, never copied from a control manual or a customer
// program.
//
// The cases are the "stays intact" list of `docs/planning/nc-transformations.md`:
// plus `klartext-keyword-values`, which is the one a guard could not catch: `REP5` split
// into `REP 5` reads back with the same tokens, so only knowing that the dialect already
// separates its words keeps the transform's hands off it (G8 M4).
// comments (including their inner double space and an unclosed one), strings, variable
// assignments (`#101=[#1+2.]`, `R1=R2*2`), multi-letter keywords, the comma-prefixed
// lathe words `,R` and `,C`, signs, a number without a leading zero (`F.15`), the
// block-skip mark before and after the number, and the tape leader and trailer.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CodeDb } from '$lib/core/codes/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { insertSpaces } from './insertSpaces';
import type { TransformContext } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);

/** The transform reads the database for nothing, but the contract hands it one. */
const NO_CODES: CodeDb = { dialect: 'test', version: 1, addresses: {}, codes: [] };

const CASES = fileURLToPath(new URL('../../../../tests/fixtures/transforms/insert-spaces/', import.meta.url));

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

describe('insertSpaces goldens', () => {
  const cases = goldens();

  it('has a case per dialect and edge', () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  it.each(cases.map((golden) => [golden.name, golden] as const))('%s', (_name, golden) => {
    const result = insertSpaces.run(golden.input.split('\n'), context(golden.cp, golden.options));
    expect(result.lines.join('\n')).toBe(golden.expected);
  });

  // The transform is "the input plus spaces" and nothing else, so taking the spaces out
  // of both sides has to give the same text. A dropped character would show up here even
  // when a golden was written from a wrong idea of what the line should look like.
  it.each(cases.map((golden) => [golden.name, golden] as const))('%s only adds spaces', (_name, golden) => {
    const result = insertSpaces.run(golden.input.split('\n'), context(golden.cp, golden.options));
    expect(result.lines.join('\n').split(' ').join('')).toBe(golden.expected.split(' ').join(''));
    expect(golden.input.split(' ').join('')).toBe(golden.expected.split(' ').join(''));
  });

  it('keeps the trailing empty element a final newline produces', () => {
    const result = insertSpaces.run('N10G0\n'.split('\n'), context(fanuc));
    expect(result.lines).toEqual(['N10 G0', '']);
  });
});

describe('insertSpaces rules', () => {
  const run = (line: string, cp = fanuc): string => insertSpaces.run([line], context(cp)).lines[0];

  it('runs on every profile', () => {
    expect(insertSpaces.available(fanuc)).toBe(true);
    expect(insertSpaces.available(klartext)).toBe(true);
  });

  it('never puts a space around the block-skip mark', () => {
    expect(run('/N100G0')).toBe('/N100 G0');
    expect(run('N120/G0')).toBe('N120/G0');
    expect(run('/1N100G0')).toBe('/1N100 G0');
  });

  it('leaves an assignment and its operators alone', () => {
    expect(run('#101=[#1+2.]')).toBe('#101=[#1+2.]');
    expect(run('#101=#102')).toBe('#101=#102');
    expect(run('R1=R2*2')).toBe('R1=R2*2');
  });

  it('keeps the comma of a lathe corner word on the value in front of it', () => {
    expect(run('G1X10.,R1.')).toBe('G1 X10.,R1.');
    expect(run('G1X10.,C0.5')).toBe('G1 X10.,C0.5');
  });

  it('does not reach into a comment or a string', () => {
    expect(run('N10G0(A  B)X0')).toBe('N10 G0 (A  B) X0');
    expect(run('N10G0(UNCLOSED')).toBe('N10 G0 (UNCLOSED');
    expect(run('2 TOOL CALL "MILL D10" Z S5000', klartext)).toBe('2 TOOL CALL "MILL D10" Z S5000');
  });

  it('reports nothing to do when the words are already separated', () => {
    const result = insertSpaces.run(['N10 G0 X0'], context(fanuc));
    expect(result.summary).toEqual({ key: 'ncCleanup.insertSpaces.summaryNone' });
    expect(result.skipped).toEqual([]);
    expect(result.lines).toEqual(['N10 G0 X0']);
  });
});

describe('insertSpaces performance', () => {
  const SOURCE = [
    '%',
    'O1001 (BRACKET)',
    'N10G0G90X0Y0',
    'N20T1M6',
    'G1X10.Y-5.F500',
    '/N100G0X10.',
    '#101=[#1+2.]',
    'IF[#101GT5.]GOTO200',
    'N200M99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = insertSpaces.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines).toHaveLength(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
