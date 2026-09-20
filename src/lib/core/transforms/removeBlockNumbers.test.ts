// Remove block numbers (plan §5 WP4.2). Owner: WP4.2.
//
// Same shape as `renumber.test.ts`: the cases live in
// `tests/fixtures/transforms/remove-block-numbers/<case>/`, and a case is added by adding
// a folder. This transform has no options, so `options.json` only carries the profile,
// the note and what to expect.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { removeBlockNumbers } from './removeBlockNumbers';
import { renumber } from './renumber';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

const CASES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/transforms/remove-block-numbers/', import.meta.url));

const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

const BUILTINS: CompiledProfile[] = BUILTIN_PROFILE_JSON.map((raw) => {
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(`a built-in profile does not validate: ${checked.errors.join('; ')}`);
  return compileProfile(checked.profile);
});

function compiled(id: string): CompiledProfile {
  const found = BUILTINS.find((cp) => cp.profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
}

const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

function context(cp: CompiledProfile, firstLine = 1, document?: readonly string[]): TransformContext {
  return { cp, codes: NO_CODES, options: {}, firstLine, document };
}

interface CaseMeta {
  note: string;
  profile?: string;
  /** A real selection run: `input.nc` is the whole program and this is the scope. */
  scope?: { startLine: number; endLine: number };
  /** A bare fragment with no document behind it. */
  firstLine?: number;
  expect?: {
    summary?: string;
    skipped?: { line: number; severity: string }[];
    warnings?: string[];
    preflight?: string | null;
  };
}

interface GoldenCase {
  name: string;
  meta: CaseMeta;
  input: string[];
  expected: string[];
  firstLine: number;
  document?: string[];
  expectedDocument: string[];
}

function goldenCases(): GoldenCase[] {
  return readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const meta = JSON.parse(readFileSync(join(CASES_DIR, name, 'options.json'), 'utf8')) as CaseMeta;
      const document = readFileSync(join(CASES_DIR, name, 'input.nc'), 'utf8').split('\n');
      const expectedDocument = readFileSync(join(CASES_DIR, name, 'expected.nc'), 'utf8').split('\n');
      if (meta.scope) {
        const { startLine, endLine } = meta.scope;
        return {
          name,
          meta,
          input: document.slice(startLine - 1, endLine),
          expected: expectedDocument.slice(startLine - 1, endLine),
          firstLine: startLine,
          document,
          expectedDocument,
        };
      }
      return { name, meta, input: document, expected: expectedDocument, firstLine: meta.firstLine ?? 1, document: undefined, expectedDocument };
    });
}

const CASES = goldenCases();

function contextOf(golden: GoldenCase): TransformContext {
  return context(compiled(golden.meta.profile ?? FANUC), golden.firstLine, golden.document);
}

describe('remove-block-numbers goldens', () => {
  it('has a note on every case', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(CASES.every((c) => c.meta.note.trim() !== '')).toBe(true);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, golden) => {
    const ctx = contextOf(golden);
    const want = golden.meta.expect ?? {};

    expect(removeBlockNumbers.preflight?.(golden.input, ctx)?.key ?? null).toBe(want.preflight ?? null);

    const result = removeBlockNumbers.run(golden.input, ctx);
    expect(result.lines).toEqual(golden.expected);
    expect(result.lines.length).toBe(golden.input.length);
    expect(result.lineMap).toEqual(Int32Array.from(golden.input.map((_line, i) => i)));
    if (golden.document) {
      const applied = [...golden.document];
      applied.splice(golden.firstLine - 1, result.lines.length, ...result.lines);
      expect(applied).toEqual(golden.expectedDocument);
    }

    if (want.summary !== undefined) expect(result.summary.key).toBe(want.summary);
    if (want.skipped !== undefined) {
      expect(result.skipped.map((s) => ({ line: s.line, severity: s.severity }))).toEqual(want.skipped);
      expect(result.skipped.every((s) => s.message.trim() !== '' && !s.message.startsWith('ncNumbering.'))).toBe(true);
    }
    if (want.warnings !== undefined) expect(result.warnings.map((w) => w.key)).toEqual(want.warnings);
  });

  it('is idempotent: there is nothing left to remove', () => {
    for (const golden of CASES) {
      const cp = compiled(golden.meta.profile ?? FANUC);
      const again = removeBlockNumbers.run(golden.expected, context(cp));
      expect(again.lines, golden.name).toEqual(golden.expected);
      expect(again.summary.key, golden.name).toBe('ncNumbering.removeBlockNumbers.nothing');
      // And it says nothing else either: a run that removed no number must not report
      // that the jumps point at numbers it removed.
      expect(again.warnings, golden.name).toEqual([]);
      expect(again.skipped, golden.name).toEqual([]);
    }
  });

  it('asks nothing before a run that has no block number to remove', () => {
    // The confirmation is about the jump targets this run deletes. A program whose
    // numbers are already gone deletes none, so the question does not arise — and a
    // dialog that asks it anyway is one people learn to click through.
    const cp = compiled(FANUC);
    const gone = ['O1006', 'IF [#1 EQ 1] GOTO 100', 'G1 X10.', 'M99 P100', 'M30'];
    expect(removeBlockNumbers.preflight?.(gone, context(cp))).toBeNull();
    // With the numbers still there, the same program does ask.
    const numbered = ['O1006', 'N10 IF [#1 EQ 1] GOTO 100', 'N100 G1 X10.', 'N300 M99 P100', 'N400 M30'];
    expect(removeBlockNumbers.preflight?.(numbered, context(cp))?.key).toBe('ncNumbering.removeBlockNumbers.references');
  });
});

describe('availability', () => {
  it('is refused where every block needs a number', () => {
    expect(removeBlockNumbers.available(compiled(KLARTEXT))).toEqual({ key: 'ncNumbering.removeBlockNumbers.mandatory' });
  });

  it('runs where numbers are optional', () => {
    expect(removeBlockNumbers.available(compiled(FANUC))).toBe(true);
  });

  it('has no options', () => {
    expect(removeBlockNumbers.options).toBeUndefined();
  });

  it('has a preflight, because it deletes the blocks a jump points at', () => {
    expect(typeof removeBlockNumbers.preflight).toBe('function');
  });
});

describe('together with renumber', () => {
  it('undoes what renumber wrote, down to the skip marks', () => {
    const cp = compiled(FANUC);
    const bare = ['/G0 X0', 'G1 X10. F100', '(A COMMENT)', 'M30'];
    const numbered = renumber.run(bare, { cp, codes: NO_CODES, options: { skipStartingWith: '(', restartAtProgramStart: false }, firstLine: 1 });
    expect(numbered.lines).toEqual(['/N10 G0 X0', 'N20 G1 X10. F100', '(A COMMENT)', 'N30 M30']);
    expect(removeBlockNumbers.run(numbered.lines, context(cp)).lines).toEqual(bare);
  });
});

describe('performance', () => {
  it('strips 100k lines well inside a second', () => {
    const cp = compiled(FANUC);
    const source = ['N10 G0 G90 X0. Y0.', 'N20 T1 M6', 'N30 G43 H1 Z50. (ROUGH)', '/N40 G0 Z5.', 'N50G1X10.Y10.F250.', ''];
    const lines = Array.from({ length: 100_000 }, (_v, i) => source[i % source.length]);

    const started = performance.now();
    const result = removeBlockNumbers.run(lines, context(cp));
    const ms = performance.now() - started;

    expect(result.lines).toHaveLength(lines.length);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
