// Remove empty lines (plan §5 WP4.3).
//
// Goldens in `tests/fixtures/transforms/remove-empty-lines/<case>/` (plan §8.2); a case
// named `klartext-…` is read with the Heidenhain profile, anything else with the Fanuc
// one. Every line in them is synthetic, written for gEdit from `docs/planning/syntax/`.
//
// Two rules carry the risk here. `fanuc-trailing-newline` is the trailing-state rule of
// `types.ts`: `['N10 G0', '', '', '']` is a file that ends with one newline and three
// blank lines, and it has to come back as `['N10 G0', '']` — not as `['N10 G0']`, which
// would drop the final newline the file had. `klartext-blanks` is the other: on a control
// that needs consecutive block numbers, deleting lines leaves a program it rejects, so
// the run warns and `contrib/ncCleanup.ts` offers `nc.renumber`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CodeDb } from '$lib/core/codes/types';
import fanucJson from '$lib/data/profiles/fanuc-gcode.json';
import heidenhainJson from '$lib/data/profiles/heidenhain-klartext.json';
import { compileProfile } from '$lib/core/profiles/compile';
import type { CompiledProfile, Profile } from '$lib/core/profiles/types';
import { removeEmptyLines } from './removeEmptyLines';
import type { TransformContext } from './types';

const fanuc = compileProfile(fanucJson as unknown as Profile);
const klartext = compileProfile(heidenhainJson as unknown as Profile);
const NO_CODES: CodeDb = { dialect: 'test', version: 1, addresses: {}, codes: [] };

const CASES = fileURLToPath(new URL('../../../../tests/fixtures/transforms/remove-empty-lines/', import.meta.url));

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

describe('removeEmptyLines goldens', () => {
  const cases = goldens();

  it('has a case per dialect and edge', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  it.each(cases.map((golden) => [golden.name, golden] as const))('%s', (_name, golden) => {
    const result = removeEmptyLines.run(golden.input.split('\n'), context(golden.cp, golden.options));
    expect(result.lines.join('\n')).toBe(golden.expected);
  });

  // The kept lines are the input's lines, in order and unchanged: this transform only
  // ever deletes.
  it.each(cases.map((golden) => [golden.name, golden] as const))('%s keeps the lines it kept', (_name, golden) => {
    const input = golden.input.split('\n');
    const result = removeEmptyLines.run(input, context(golden.cp, golden.options));
    const lineMap = result.lineMap as Int32Array;
    expect(lineMap).toHaveLength(input.length);
    for (let i = 0; i < input.length; i++) {
      if (lineMap[i] === -1) expect(input[i].trim()).toBe('');
      else expect(result.lines[lineMap[i]]).toBe(input[i]);
    }
    expect(lineMap.filter((to) => to !== -1)).toHaveLength(result.lines.length);
  });
});

describe('removeEmptyLines rules', () => {
  it('runs on every profile', () => {
    expect(removeEmptyLines.available(fanuc)).toBe(true);
    expect(removeEmptyLines.available(klartext)).toBe(true);
  });

  it('never deletes the last line, which carries the trailing newline', () => {
    expect(removeEmptyLines.run(['N10 G0', '', '', ''], context(fanuc)).lines).toEqual(['N10 G0', '']);
    expect(removeEmptyLines.run([''], context(fanuc)).lines).toEqual(['']);
    expect(removeEmptyLines.run(['', ''], context(fanuc)).lines).toEqual(['']);
  });

  it('counts a line with only whitespace as empty and one with a block number as code', () => {
    const result = removeEmptyLines.run(['N10 G0', ' \t ', 'N20', '(C)', 'x'], context(fanuc));
    expect(result.lines).toEqual(['N10 G0', 'N20', '(C)', 'x']);
    expect(result.summary).toEqual({ key: 'ncCleanup.removeEmptyLines.summary', params: { count: 1 } });
  });

  it('maps the surviving lines to their new index', () => {
    const result = removeEmptyLines.run(['a', '', 'b', '', '', 'c'], context(fanuc));
    expect([...(result.lineMap as Int32Array)]).toEqual([0, -1, 1, -1, -1, 2]);
  });

  it('asks for a renumber only where the numbers must stay consecutive', () => {
    const lines = ['0 BEGIN PGM TEST MM', '', '1 END PGM TEST MM'];
    expect(removeEmptyLines.run(lines, context(klartext)).warnings).toEqual([{ key: 'ncCleanup.renumberNeeded' }]);
    expect(removeEmptyLines.run(lines, context(fanuc)).warnings).toEqual([]);
    // Nothing removed, nothing to renumber.
    expect(removeEmptyLines.run(['0 BEGIN PGM TEST MM'], context(klartext)).warnings).toEqual([]);
  });

  it('reports nothing to do when there is no empty line', () => {
    const result = removeEmptyLines.run(['N10 G0', 'N20 G1'], context(fanuc));
    expect(result.summary).toEqual({ key: 'ncCleanup.removeEmptyLines.summaryNone' });
    expect(result.lines).toEqual(['N10 G0', 'N20 G1']);
  });
});

describe('removeEmptyLines performance', () => {
  const SOURCE = ['N10 G0 X0', '', 'N20 G1 X10.', '   ', 'N30 M30', ''];

  it('rewrites 100k lines in well under a second', () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => SOURCE[i % SOURCE.length]);
    const started = performance.now();
    const result = removeEmptyLines.run(lines, context(fanuc));
    const ms = performance.now() - started;
    expect(result.lines.length).toBeLessThan(100_000);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
