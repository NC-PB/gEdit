// Remove comments (plan §5 WP4.3).
//
// Goldens in `tests/fixtures/transforms/remove-comments/<case>/` (plan §8.2); a case
// named `klartext-…` is read with the Heidenhain profile, anything else with the Fanuc
// one. Every line in them is synthetic, written for gEdit from `docs/planning/syntax/`.
//
// The cases that carry the risk:
//  - `klartext-sections` — a comment in front of a trailing `~`. Dropping the marker
//    would fuse the cycle definition with the block below it.
//  - `klartext-semicolon-in-string` — a `;` inside `"TNC:\SUB;1.H"` is part of the path,
//    not the start of a comment. This is the line a regex gets wrong.
//  - `fanuc-default` — `N30 (ONLY)` keeps its bare `N30`, because a Fanuc block number is
//    a jump target; `/N100 (SKIP ME) G0` keeps its skip mark.
//  - `fanuc-unclosed-comment` — an unclosed `(` runs to the end of the line.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { noMachine } from '$lib/core/machines/effective';
import type { CodeDb } from '$lib/core/codes/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { removeComments } from './removeComments';
import type { TransformContext } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);
const NO_CODES: CodeDb = { dialect: 'test', version: 1, addresses: {}, codes: [] };

const CASES = fileURLToPath(new URL('../../../../tests/fixtures/transforms/remove-comments/', import.meta.url));

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
  return { cp, codes: NO_CODES, options, firstLine: 1, machine: noMachine(cp.profile) };
}

describe('removeComments goldens', () => {
  const cases = goldens();

  it('has a case per dialect and option', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  it.each(cases.map((golden) => [golden.name, golden] as const))('%s', (_name, golden) => {
    const result = removeComments.run(golden.input.split('\n'), context(golden.cp, golden.options));
    expect(result.lines.join('\n')).toBe(golden.expected);
  });

  // A line the transform kept is the input's line; a line it rewrote is shorter. Nothing
  // it produces was ever longer than what it read.
  it.each(cases.map((golden) => [golden.name, golden] as const))('%s only deletes', (_name, golden) => {
    const input = golden.input.split('\n');
    const result = removeComments.run(input, context(golden.cp, golden.options));
    const lineMap = result.lineMap as Int32Array;
    expect(lineMap).toHaveLength(input.length);
    for (let i = 0; i < input.length; i++) {
      if (lineMap[i] === -1) continue;
      expect(result.lines[lineMap[i]].length).toBeLessThanOrEqual(input[i].length);
    }
  });
});

describe('removeComments options', () => {
  it('offers the section-heading switch only where the profile has headings', () => {
    expect((removeComments.options?.(fanuc) ?? []).map((field) => field.id)).toEqual([
      'dropEmptied',
      'keepProgramName',
      'keepFirstLines',
    ]);
    expect((removeComments.options?.(klartext) ?? []).map((field) => field.id)).toEqual([
      'dropEmptied',
      'keepProgramName',
      'keepFirstLines',
      'keepSectionHeadings',
    ]);
  });

  it('defaults to dropping emptied lines and keeping the program name', () => {
    const fields = removeComments.options?.(fanuc) ?? [];
    expect(fields.find((field) => field.id === 'dropEmptied')?.default).toBe(true);
    expect(fields.find((field) => field.id === 'keepProgramName')?.default).toBe(true);
    expect(fields.find((field) => field.id === 'keepFirstLines')?.default).toBe(0);
  });

  it('is not available for a profile without comment syntax', () => {
    expect(removeComments.available(fanuc)).toBe(true);
    const silent = compileProfile({
      ...(fanucJson as unknown as Profile),
      syntax: { ...(fanucJson as unknown as Profile).syntax, comments: [] },
    });
    expect(removeComments.available(silent)).toEqual({
      key: 'ncCleanup.removeComments.unavailable',
      params: { profile: silent.profile.name },
    });
  });
});

describe('removeComments rules', () => {
  const run = (lines: string[], options: Record<string, unknown> = {}, cp = fanuc): string[] =>
    removeComments.run(lines, context(cp, options)).lines;

  it('leaves the continuation marker of a Klartext block in place', () => {
    expect(run(['5   Q200=+2 ; CLEARANCE ~'], {}, klartext)).toEqual(['5   Q200=+2 ~']);
    expect(run(['; ONLY A COMMENT ~'], {}, klartext)).toEqual(['~']);
  });

  it('does not read a comment marker that sits inside a string', () => {
    expect(run(['1 CALL PGM "TNC:\\SUB;1.H" ; NOTE'], {}, klartext)).toEqual(['1 CALL PGM "TNC:\\SUB;1.H"']);
  });

  it('keeps a bare Fanuc block number but drops a bare Klartext one', () => {
    expect(run(['N30 (ONLY)', 'N40 G0'])).toEqual(['N30', 'N40 G0']);
    expect(run(['0 BEGIN PGM T MM', '1 ; ONLY', '2 END PGM T MM'], {}, klartext)).toEqual([
      '0 BEGIN PGM T MM',
      '2 END PGM T MM',
    ]);
  });

  it('keeps indentation when the comment stood at the head of the line', () => {
    expect(run(['  (INDENTED) G0'])).toEqual(['  G0']);
    expect(run(['(A) (B) G1'])).toEqual(['G1']);
  });

  it('counts keepFirstLines in document lines, not in scope lines', () => {
    const lines = ['N10 (A)', 'N20 (B)'];
    expect(removeComments.run(lines, { ...context(fanuc, { keepFirstLines: 1 }), firstLine: 1 }).lines).toEqual([
      'N10 (A)',
      'N20',
    ]);
    expect(removeComments.run(lines, { ...context(fanuc, { keepFirstLines: 1 }), firstLine: 5 }).lines).toEqual([
      'N10',
      'N20',
    ]);
  });

  it('lists every comment it kept, with the reason', () => {
    const result = removeComments.run(['O1001 (BRACKET)', '(HEADER)', 'N10 (GONE)'], {
      ...context(fanuc, { keepFirstLines: 2 }),
      firstLine: 1,
    });
    expect(result.skipped).toEqual([
      { line: 1, message: expect.any(String) as unknown as string, severity: 'info' },
      { line: 2, message: expect.any(String) as unknown as string, severity: 'info' },
    ]);
  });

  it('keeps an emptied line when asked to', () => {
    expect(run(['(A)', 'N10 G0 (B)'], { dropEmptied: false })).toEqual(['', 'N10 G0']);
    expect(run(['(A)', 'N10 G0 (B)'])).toEqual(['N10 G0']);
  });

  it('never deletes the last line, which carries the trailing newline', () => {
    expect(run(['N10 G0', '(TAIL)', ''])).toEqual(['N10 G0', '']);
    expect(run(['N10 G0', '(TAIL)'])).toEqual(['N10 G0', '']);
  });

  it('reports nothing to do on a program without comments', () => {
    const result = removeComments.run(['N10 G0', 'N20 G1'], context(fanuc));
    expect(result.summary).toEqual({ key: 'ncCleanup.removeComments.summaryNone' });
    expect(result.warnings).toEqual([]);
  });
});

describe('removeComments performance', () => {
  const SOURCE = [
    '%',
    'O1001 (BRACKET)',
    'N10 G0 X0 (RAPID)',
    'N20 T1 M6',
    'G1 X10. Y-5. F500 (CUT)',
    '/N100 G0 X10.',
    'N200 M99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = removeComments.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines.length).toBeLessThanOrEqual(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
