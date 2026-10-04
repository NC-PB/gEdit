// Insert and remove block skip (plan §6 M10, WP10.1).
//
// The goldens live in `tests/fixtures/transforms/block-skip/<case>/`: `input.nc`,
// `expected.nc` and `options.json` (`mode` is `add` or `remove`; `scope` makes it a
// selection run on a whole-program input, as `app/transforms.ts` would call it). A case is
// added by adding a folder. The tests after the goldens pin the rules the goldens cannot
// say: the result keeps the line count, adding then removing gives the program back, and a
// `/` that divides is never a mark.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { noMachine } from '$lib/core/machines/effective';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { hasKey } from '$lib/i18n';
import { blockSkipAdd, blockSkipRemove } from './blockSkip';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext, TransformDef } from './types';

const CASES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/transforms/block-skip/', import.meta.url));

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

function context(cp: CompiledProfile, options: Record<string, unknown> = {}, firstLine = 1, document?: readonly string[]): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine, document, machine: noMachine(cp.profile) };
}

interface CaseMeta {
  note: string;
  profile: string;
  mode: 'add' | 'remove';
  options: Record<string, unknown>;
  scope?: { startLine: number; endLine: number };
  expect: { summary: string; skipped: { line: number; severity: string }[]; warnings: string[] };
}

interface Golden {
  name: string;
  meta: CaseMeta;
  input: string[];
  expected: string[];
  firstLine: number;
  document: string[];
}

const GOLDENS: Golden[] = readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((name) => {
    const meta = JSON.parse(readFileSync(join(CASES_DIR, name, 'options.json'), 'utf8')) as CaseMeta;
    const document = readFileSync(join(CASES_DIR, name, 'input.nc'), 'utf8').split('\n');
    const expectedDocument = readFileSync(join(CASES_DIR, name, 'expected.nc'), 'utf8').split('\n');
    const { startLine, endLine } = meta.scope ?? { startLine: 1, endLine: document.length };
    return {
      name,
      meta,
      input: document.slice(startLine - 1, endLine),
      expected: expectedDocument.slice(startLine - 1, endLine),
      firstLine: startLine,
      document,
    };
  });

const defOf = (meta: CaseMeta): TransformDef => (meta.mode === 'add' ? blockSkipAdd : blockSkipRemove);

describe('block-skip goldens', () => {
  it('has a note on every case and enough of them', () => {
    expect(GOLDENS.length).toBeGreaterThanOrEqual(15);
    expect(GOLDENS.every((g) => g.meta.note.trim() !== '')).toBe(true);
  });

  it.each(GOLDENS.map((g) => [g.name, g] as const))('%s', (_name, golden) => {
    const cp = compiled(golden.meta.profile);
    const ctx = context(cp, golden.meta.options, golden.firstLine, golden.document);
    const result = defOf(golden.meta).run(golden.input, ctx);
    expect(result.lines).toEqual(golden.expected);
    expect(result.lineMap).toEqual(Int32Array.from(golden.input.map((_line, i) => i)));
    expect(result.summary.key).toBe(golden.meta.expect.summary);
    expect(result.skipped.map((s) => ({ line: s.line, severity: s.severity }))).toEqual(golden.meta.expect.skipped);
    expect(result.skipped.every((s) => s.message.trim() !== '' && !s.message.startsWith('ncBlockSkip.'))).toBe(true);
    expect(result.warnings.map((w) => w.key)).toEqual(golden.meta.expect.warnings);
    for (const key of [result.summary.key, ...result.warnings.map((w) => w.key)]) {
      expect(hasKey(key) || hasKey(`${key}_other`), key).toBe(true);
    }
  });

  it('applied to the document, only the scope changes', () => {
    for (const golden of GOLDENS) {
      const cp = compiled(golden.meta.profile);
      const result = defOf(golden.meta).run(golden.input, context(cp, golden.meta.options, golden.firstLine, golden.document));
      const applied = [...golden.document];
      applied.splice(golden.firstLine - 1, result.lines.length, ...result.lines);
      const expectedDocument = readFileSync(join(CASES_DIR, golden.name, 'expected.nc'), 'utf8').split('\n');
      expect(applied, golden.name).toEqual(expectedDocument);
    }
  });

  it('is idempotent: a second add and a second remove change nothing', () => {
    for (const golden of GOLDENS) {
      const cp = compiled(golden.meta.profile);
      const whole = readFileSync(join(CASES_DIR, golden.name, 'expected.nc'), 'utf8').split('\n');
      const again = defOf(golden.meta).run(golden.expected, context(cp, golden.meta.options, golden.firstLine, whole));
      expect(again.lines, golden.name).toEqual(golden.expected);
    }
  });
});

describe('the pinned cases of the plan', () => {
  const fanuc = compiled('fanuc-gcode');

  it('marks /N100, never N100 /', () => {
    const result = blockSkipAdd.run(['N100 G0 X0'], context(fanuc));
    expect(result.lines).toEqual(['/N100 G0 X0']);
  });

  it('writes a level as /1', () => {
    const result = blockSkipAdd.run(['N100 G0'], context(fanuc, { level: '1' }));
    expect(result.lines).toEqual(['/1 N100 G0']);
  });

  it('leaves #1=#2/2 and R1=R2/2 alone when removing', () => {
    const fan = blockSkipRemove.run(['#1=#2/2', 'N10 #1=#2/2'], context(fanuc));
    expect(fan.lines).toEqual(['#1=#2/2', 'N10 #1=#2/2']);
    expect(fan.summary.key).toBe('ncBlockSkip.removeRun.nothing');
    const sin = compiled('sinumerik');
    const sres = blockSkipRemove.run(['R1=R2/2', 'N10 R1=R2/2'], context(sin));
    expect(sres.lines).toEqual(['R1=R2/2', 'N10 R1=R2/2']);
  });

  it('puts the Klartext mark after the number', () => {
    const result = blockSkipAdd.run(['12 L X+0'], context(compiled('heidenhain-klartext')));
    expect(result.lines).toEqual(['12 /L X+0']);
  });

  it('never marks a line twice', () => {
    for (const id of ['fanuc-gcode', 'heidenhain-klartext', 'sinumerik', 'okuma-osp']) {
      const cp = compiled(id);
      const once = blockSkipAdd.run(['10 G0 X0', ''], context(cp));
      const twice = blockSkipAdd.run(once.lines, context(cp));
      expect(twice.lines, id).toEqual(once.lines);
    }
  });

  it('adding and then removing gives the program back', () => {
    const programs: [string, string[]][] = [
      ['fanuc-gcode', ['N10 G0 X0', '  G1 X10.', 'N30G2 X1 R1', '#1=#2/2', '(NOTE)', '']],
      ['heidenhain-klartext', ['1 L X+0', '2 L X+1 ~', 'F100', '3 L X+2', '']],
      ['sinumerik', ['N10 G0 X0', 'R1=R2/2', 'MSG("A")', '']],
      ['okuma-osp', ['N10 G0 X0', 'NLAP1 G1 Z-5.', '']],
    ];
    for (const [id, lines] of programs) {
      const cp = compiled(id);
      const added = blockSkipAdd.run(lines, context(cp));
      const removed = blockSkipRemove.run(added.lines, context(cp));
      expect(removed.lines, id).toEqual(lines);
    }
  });

  it('refuses a dialect without a skip mark', () => {
    const bare = {
      ...fanuc,
      profile: { ...fanuc.profile, syntax: { ...fanuc.profile.syntax, blockSkip: undefined } },
    } as CompiledProfile;
    expect(blockSkipAdd.available(bare)).not.toBe(true);
    expect(blockSkipRemove.available(bare)).not.toBe(true);
    expect(blockSkipAdd.available(fanuc)).toBe(true);
  });

  it('offers the level only where the profile has levels', () => {
    expect(blockSkipAdd.options?.(fanuc).map((f) => f.id)).toEqual(['level']);
    expect(blockSkipRemove.options?.(fanuc).map((f) => f.id)).toEqual(['level']);
    expect(blockSkipAdd.options?.(compiled('heidenhain-klartext'))).toEqual([]);
    expect(blockSkipRemove.options?.(compiled('okuma-osp'))).toEqual([]);
  });

  it('asks before marking the whole program, never before marking a selection', () => {
    const lines = ['G0 X0', 'G1 X1'];
    expect(blockSkipAdd.preflight?.(lines, context(fanuc, {}, 1, lines))?.key).toBe('ncBlockSkip.addRun.wholeProgram');
    const document = ['O1', 'G0 X0', 'G1 X1', 'M30'];
    expect(blockSkipAdd.preflight?.(lines, context(fanuc, {}, 2, document))).toBeNull();
    expect(blockSkipAdd.preflight?.([''], context(fanuc, {}, 1, ['']))).toBeNull();
    expect(blockSkipRemove.preflight).toBeUndefined();
  });
});

describe('M10 review: the closing record and the plain level', () => {
  it('leaves the Klartext END PGM unmarked and lists it, as BEGIN PGM (NC-8)', () => {
    const cp = compiled('heidenhain-klartext');
    const result = blockSkipAdd.run(['0 BEGIN PGM K1 MM', '1 L X+0 R0 FMAX', '5 END PGM K1 MM'], context(cp));
    expect(result.lines).toEqual(['0 BEGIN PGM K1 MM', '1 /L X+0 R0 FMAX', '5 END PGM K1 MM']);
    expect(result.skipped.map((row) => row.line)).toEqual([1, 3]);
  });

  it('still marks an ordinary end block (M30) where the profile has no closing record', () => {
    const result = blockSkipAdd.run(['N10 G0 X0', 'N20 M30'], context(compiled('fanuc-gcode')));
    expect(result.lines).toEqual(['/N10 G0 X0', '/N20 M30']);
    expect(result.skipped).toEqual([]);
  });

  it('reads the bare mark on Fanuc as BDT1: / and /1 are one level (NC-9)', () => {
    const fanuc = compiled('fanuc-gcode');
    const removed = blockSkipRemove.run(['/N10 G0', '/1N20 G0', '/2N30 G0'], context(fanuc, { level: '1' }));
    expect(removed.lines).toEqual(['N10 G0', 'N20 G0', '/2N30 G0']);
    expect(removed.skipped.map((row) => row.line)).toEqual([3]);
    const plain = blockSkipRemove.run(['/N10 G0', '/1N20 G0'], context(fanuc, { level: 'plain' }));
    expect(plain.lines).toEqual(['N10 G0', 'N20 G0']);
    const added = blockSkipAdd.run(['/N10 G0', '/1 N20 G0'], context(fanuc, { level: '1' }));
    expect(added.lines).toEqual(['/N10 G0', '/1 N20 G0']);
    expect(added.skipped).toEqual([]);
  });

  it('keeps / and /0 one level on Sinumerik, and /1 another', () => {
    const sin = compiled('sinumerik');
    const removed = blockSkipRemove.run(['/N10 G0', '/0 N20 G1', '/1 N30 G2'], context(sin, { level: 'plain' }));
    expect(removed.lines).toEqual(['N10 G0', 'N20 G1', '/1 N30 G2']);
    const one = blockSkipRemove.run(['/N10 G0', '/1 N30 G2'], context(sin, { level: '1' }));
    expect(one.lines).toEqual(['/N10 G0', 'N30 G2']);
  });
});
