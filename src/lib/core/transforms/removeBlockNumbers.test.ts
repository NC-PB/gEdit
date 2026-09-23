// Remove block numbers (plan §5 WP4.2 and WP6.3). Owner: WP6.3.
//
// Same shape as `renumber.test.ts`: the cases live in
// `tests/fixtures/transforms/remove-block-numbers/<case>/`, and a case is added by adding
// a folder. `options` is the one option this transform has (M6, WP6.3): `keepReferenced`,
// which is on wherever the profile knows what a block-number reference looks like.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { noMachine } from '$lib/core/machines/effective';
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

function context(
  cp: CompiledProfile,
  firstLine = 1,
  document?: readonly string[],
  options: Record<string, unknown> = {},
): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine, document, machine: noMachine(cp.profile) };
}

interface CaseMeta {
  note: string;
  profile?: string;
  /** A real selection run: `input.nc` is the whole program and this is the scope. */
  scope?: { startLine: number; endLine: number };
  /** A bare fragment with no document behind it. */
  firstLine?: number;
  options?: Record<string, unknown>;
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
  return context(compiled(golden.meta.profile ?? FANUC), golden.firstLine, golden.document, golden.meta.options ?? {});
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
      const again = removeBlockNumbers.run(golden.expected, context(cp, 1, undefined, golden.meta.options ?? {}));
      expect(again.lines, golden.name).toEqual(golden.expected);
      // Either there was nothing left at all, or what is left is the numbers a jump
      // points at, which is the answer this run gives every time.
      if (again.summary.key === 'ncNumbering.removeBlockNumbers.nothing') {
        // And it says nothing else either: a run that removed no number must not report
        // that the jumps point at numbers it removed.
        expect(again.warnings, golden.name).toEqual([]);
        expect(again.skipped, golden.name).toEqual([]);
      } else {
        expect(again.summary.key, golden.name).toBe('ncNumbering.removeBlockNumbers.allKept');
        expect(again.warnings.map((w) => w.key), golden.name).toEqual(['ncNumbering.removeBlockNumbers.keptReferenced']);
      }
    }
  });

  it('asks nothing before a run that has no block number to remove', () => {
    // The confirmation is about the jump targets this run deletes. A program whose
    // numbers are already gone deletes none, so the question does not arise — and a
    // dialog that asks it anyway is one people learn to click through.
    const cp = compiled(FANUC);
    const off = { keepReferenced: false };
    const gone = ['O1006', 'IF [#1 EQ 1] GOTO 100', 'G1 X10.', 'M99 P100', 'M30'];
    expect(removeBlockNumbers.preflight?.(gone, context(cp, 1, undefined, off))).toBeNull();
    // With the numbers still there, the same program does ask.
    const numbered = ['O1006', 'N10 IF [#1 EQ 1] GOTO 100', 'N100 G1 X10.', 'N300 M99 P100', 'N400 M30'];
    expect(removeBlockNumbers.preflight?.(numbered, context(cp, 1, undefined, off))?.key).toBe('ncNumbering.removeBlockNumbers.references');
    // And with the numbers kept there is nothing left to delete, so nothing to ask.
    expect(removeBlockNumbers.preflight?.(numbered, context(cp))).toBeNull();
  });
});

describe('keeping the numbers a reference points at', () => {
  const cp = compiled(FANUC);
  const program = ['O1080', 'N10 IF [#1 EQ 1] GOTO 100', 'N20 G0 X0', 'N100 G1 X10.', 'N110 M30'];

  it('keeps the target and removes the rest', () => {
    const result = removeBlockNumbers.run(program, context(cp));
    expect(result.lines).toEqual(['O1080', 'IF [#1 EQ 1] GOTO 100', 'G0 X0', 'N100 G1 X10.', 'M30']);
    expect(result.summary).toEqual({ key: 'ncNumbering.removeBlockNumbers.summary', params: { count: 3 } });
    expect(result.warnings).toEqual([{ key: 'ncNumbering.removeBlockNumbers.keptReferenced', params: { count: 1 } }]);
    expect(result.skipped.map((s) => [s.line, s.severity])).toEqual([[4, 'info']]);
  });

  it('removes the target as well when the option is off, and lists the broken jump', () => {
    const result = removeBlockNumbers.run(program, context(cp, 1, undefined, { keepReferenced: false }));
    expect(result.lines).toEqual(['O1080', 'IF [#1 EQ 1] GOTO 100', 'G0 X0', 'G1 X10.', 'M30']);
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.removeBlockNumbers.referencesKept']);
    expect(result.skipped.map((s) => [s.line, s.severity])).toEqual([[2, 'warning']]);
  });

  it('keeps a number a jump outside the selection points at', () => {
    // The `GOTO 100` is above the selection, so only the document says that N100 has to
    // stay. A run that read its own lines only would delete it (G8 M4).
    const result = removeBlockNumbers.run(program.slice(3), context(cp, 4, program));
    expect(result.lines).toEqual(['N100 G1 X10.', 'M30']);
  });

  it('keeps the number a return names in the caller, which is another program', () => {
    // `M99 P30` names N30 of the calling program, not of the subprogram it stands in
    // (F42), so the answer is taken over the whole document and not per program.
    const both = ['O1090', 'N30 G0 X0', 'N40 M98 P1091', 'N50 M30', 'O1091', 'N60 G0 Z5.', 'N70 M99 P30'];
    const result = removeBlockNumbers.run(both, context(cp));
    expect(result.lines[1]).toBe('N30 G0 X0');
    expect(result.lines[5]).toBe('G0 Z5.');
  });

  it('says so when every number in the scope is a target', () => {
    const all = ['N100 G1 X10.', 'N200 G1 X20.', 'G71 P100 Q200 U0.4 W0.1'];
    const lathe = compiled('fanuc-lathe');
    const result = removeBlockNumbers.run(all, context(lathe));
    expect(result.lines).toEqual(all);
    expect(result.summary).toEqual({ key: 'ncNumbering.removeBlockNumbers.allKept', params: { count: 2 } });
  });
});

describe('availability', () => {
  it('is refused where every block needs a number', () => {
    expect(removeBlockNumbers.available(compiled(KLARTEXT))).toEqual({ key: 'ncNumbering.removeBlockNumbers.mandatory' });
  });

  it('runs where numbers are optional', () => {
    expect(removeBlockNumbers.available(compiled(FANUC))).toBe(true);
  });

  it('offers the one option, and only where the dialect has references', () => {
    const fields = removeBlockNumbers.options?.(compiled(FANUC)) ?? [];
    expect(fields.map((field) => field.id)).toEqual(['keepReferenced']);
    expect(fields[0].default).toBe(true);
    expect(fields[0].label.trim() !== '' && !fields[0].label.includes('ncNumbering.')).toBe(true);
    // Klartext describes no references, so there is nothing to decide and no dialog.
    expect(removeBlockNumbers.options?.(compiled(KLARTEXT))).toEqual([]);
  });

  it('has a preflight, because it deletes the blocks a jump points at', () => {
    expect(typeof removeBlockNumbers.preflight).toBe('function');
  });
});

describe('together with renumber', () => {
  it('undoes what renumber wrote, down to the skip marks', () => {
    const cp = compiled(FANUC);
    const bare = ['/G0 X0', 'G1 X10. F100', '(A COMMENT)', 'M30'];
    const numbered = renumber.run(bare, {
      cp,
      codes: NO_CODES,
      options: { skipStartingWith: '(', restartAtProgramStart: false },
      firstLine: 1,
      machine: noMachine(cp.profile),
    });
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
