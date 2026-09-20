// Convert case (plan §5 WP4.3).
//
// Goldens in `tests/fixtures/transforms/convert-case/<case>/` (plan §8.2); a case named
// `klartext-…` is read with the Heidenhain profile, anything else with the Fanuc one.
// Every line in them is synthetic, written for gEdit from `docs/planning/syntax/`.
//
// `klartext-tool-names` is the case that matters: `TOOL CALL "mill_d10"` keeps the tool
// name exactly as written, because the control matches it literally against the tool
// table and an upper-cased name is a tool the machine does not have.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CodeDb } from '$lib/core/codes/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { convertCase } from './convertCase';
import type { TransformContext } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);
const NO_CODES: CodeDb = { dialect: 'test', version: 1, addresses: {}, codes: [] };

const CASES = fileURLToPath(new URL('../../../../tests/fixtures/transforms/convert-case/', import.meta.url));

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

describe('convertCase goldens', () => {
  const cases = goldens();

  it('has a case per dialect and direction', () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  it.each(cases.map((golden) => [golden.name, golden] as const))('%s', (_name, golden) => {
    const result = convertCase.run(golden.input.split('\n'), context(golden.cp, golden.options));
    expect(result.lines.join('\n')).toBe(golden.expected);
  });

  // Case is the only thing that may differ, character for character: no line grows, no
  // line shrinks, and the two texts are equal once both are upper-cased.
  it.each(cases.map((golden) => [golden.name, golden] as const))('%s only changes case', (_name, golden) => {
    const result = convertCase.run(golden.input.split('\n'), context(golden.cp, golden.options)).lines.join('\n');
    expect(result).toHaveLength(golden.input.length);
    expect(result.toUpperCase()).toBe(golden.input.toUpperCase());
  });
});

describe('convertCase options', () => {
  it('offers the direction and the comment switch', () => {
    const fields = convertCase.options?.(fanuc) ?? [];
    expect(fields.map((field) => field.id)).toEqual(['case', 'excludeComments']);
    expect(fields[0].default).toBe('upper');
    expect(fields[0].choices?.map((choice) => choice.value)).toEqual(['upper', 'lower']);
    expect(fields[1].default).toBe(true);
  });

  it('asks before writing lower case for a control that only reads upper case', () => {
    // G8 M4: `Convert case -> lower case` on a Fanuc program produces `o1002`, `n10 g0`
    // and `m30`, which the control refuses on load. `fanuc-gcode` says as much in
    // `editing.forceUppercase`, and the editor already upper-cases what the user types.
    expect(fanuc.profile.editing).toEqual({ forceUppercase: true, preventLineJoin: true, tabWidth: 4 });
    expect(convertCase.preflight?.([], context(fanuc, { case: 'lower' }))).toEqual({
      key: 'ncCleanup.convertCase.lowerOnUppercaseControl',
      params: { profile: fanuc.profile.name },
    });
    // Upper case is what the control wants, and Klartext does not set the flag at all.
    expect(convertCase.preflight?.([], context(fanuc, { case: 'upper' }))).toBeNull();
    expect(convertCase.preflight?.([], context(klartext, { case: 'lower' }))).toBeNull();
  });

  it('reports a token it could not convert because the length would change', () => {
    // `ß` upper-cases to `SS`, which moves every offset behind it, so the comment is
    // left as written. It used to be left silently (G8 M4).
    const result = convertCase.run(['n10 g0 (MASSE STRASSE ß)'], context(fanuc, { case: 'upper', excludeComments: false }));
    expect(result.lines[0]).toBe('N10 G0 (MASSE STRASSE ß)');
    expect(result.skipped.map((s) => ({ line: s.line, severity: s.severity }))).toEqual([{ line: 1, severity: 'info' }]);
    expect(result.skipped[0].message.startsWith('ncCleanup.')).toBe(false);
  });

  it('is not available where case carries meaning', () => {
    expect(convertCase.available(fanuc)).toBe(true);
    expect(convertCase.available(klartext)).toBe(true);
    const strict = compileProfile({
      ...(fanucJson as unknown as Profile),
      syntax: { ...(fanucJson as unknown as Profile).syntax, caseSensitive: true },
    });
    expect(convertCase.available(strict)).toEqual({
      key: 'ncCleanup.convertCase.unavailable',
      params: { profile: strict.profile.name },
    });
  });
});

describe('convertCase rules', () => {
  const run = (line: string, options: Record<string, unknown> = {}, cp = fanuc): string =>
    convertCase.run([line], context(cp, options)).lines[0];

  it('leaves comments alone by default and converts them when asked', () => {
    expect(run('n10 g0 (setup)', { case: 'upper' })).toBe('N10 G0 (setup)');
    expect(run('n10 g0 (setup)', { case: 'upper', excludeComments: false })).toBe('N10 G0 (SETUP)');
  });

  it('never converts a string, whatever the options say', () => {
    const line = '2 TOOL CALL "mill_d10" Z S5000';
    expect(run(line, { case: 'upper' }, klartext)).toBe(line);
    expect(run(line, { case: 'upper', excludeComments: false }, klartext)).toBe(line);
    expect(run(line, { case: 'lower' }, klartext)).toBe('2 tool call "mill_d10" z s5000');
  });

  it('leaves a token whose conversion would change its length', () => {
    // 'ß'.toUpperCase() is 'SS': two characters where the control counted one.
    expect(run('n10 (straße)', { case: 'upper', excludeComments: false })).toBe('N10 (straße)');
  });

  it('goes both ways', () => {
    expect(run('n10 g0 x0', { case: 'upper' })).toBe('N10 G0 X0');
    expect(run('N10 G0 X0', { case: 'lower' })).toBe('n10 g0 x0');
  });

  it('reports nothing to do when the case is already as asked', () => {
    const result = convertCase.run(['N10 G0 X0'], context(fanuc, { case: 'upper' }));
    expect(result.summary).toEqual({ key: 'ncCleanup.convertCase.summaryNone' });
    expect(result.lines).toEqual(['N10 G0 X0']);
  });

  it('names the direction in the summary', () => {
    expect(convertCase.run(['n10'], context(fanuc, { case: 'upper' })).summary).toEqual({
      key: 'ncCleanup.convertCase.summaryUpper',
      params: { count: 1 },
    });
    expect(convertCase.run(['N10'], context(fanuc, { case: 'lower' })).summary).toEqual({
      key: 'ncCleanup.convertCase.summaryLower',
      params: { count: 1 },
    });
  });
});

describe('convertCase performance', () => {
  const SOURCE = [
    '%',
    'o1001 (bracket)',
    'n10 g0 g90 x0 y0',
    'n20 t1 m6',
    'g1 x10. y-5. f500',
    '/n100 g0 x10.',
    '#101=[#1+2.]',
    'n200 m99',
    '',
  ];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = convertCase.run(lines, context(fanuc, { case: 'upper' }));
    const ms = performance.now() - started;
    expect(result.lines).toHaveLength(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
