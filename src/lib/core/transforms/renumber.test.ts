// Renumber blocks (plan §5 WP4.2). Owner: WP4.2.
//
// The cases that matter are golden files, not strings in this test:
// `tests/fixtures/transforms/renumber/<case>/{input.nc,options.json,expected.nc}` is
// input, options and result, and a case is added by adding a folder. A transform that
// corrupts a program is the worst bug this project can ship, so every rule the module
// header claims — skip marks, packed code, comments, block names, Klartext continuation
// lines, references, the trailing newline — has a file next to it that proves it.
//
// `options.json` carries the run as well as the case: `profile` picks the built-in
// dialect, `options` is what the form would have collected, and `expect` pins the summary
// key, the reported lines and the warnings. What is not listed is not checked.
//
// Two ways to place the input inside a document, and the difference is the point of half
// the cases here:
//
//  - **`scope: { startLine, endLine }`** — `input.nc` and `expected.nc` are the *whole
//    program*, and the transform is handed the slice plus the document, exactly as
//    `app/transforms.ts` does it. This is what a real selection run looks like, so a
//    `GOTO` above the selection and a Klartext block that the selection starts inside
//    are both visible to it.
//  - **`firstLine`** — the transform is handed a bare fragment and no document, which is
//    a headless caller. It is a real case too, and what it must not do is pretend it
//    checked the rest of the program.
//
// The rest of the file covers what a fixture cannot: the option fields, the preflight,
// the identity `lineMap`, and the 100k-line budget.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { renumber } from './renumber';
import type { CodeDb } from '$lib/core/codes/types';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { TransformContext } from './types';

const CASES_DIR = fileURLToPath(new URL('../../../../tests/fixtures/transforms/renumber/', import.meta.url));

const FANUC = 'fanuc-gcode';
const KLARTEXT = 'heidenhain-klartext';

/** The built-ins, through the same gate the registry uses. */
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

/** Transforms read `codes` for what a code *means*; numbering never asks. */
const NO_CODES: CodeDb = { dialect: 'none', version: 1, addresses: {}, codes: [] };

function context(
  cp: CompiledProfile,
  options: Record<string, unknown> = {},
  firstLine = 1,
  document?: readonly string[],
): TransformContext {
  return { cp, codes: NO_CODES, options, firstLine, document };
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
  /** The lines the transform is handed. */
  input: string[];
  /** The lines it has to return. */
  expected: string[];
  firstLine: number;
  /** The whole program, for a `scope` case; undefined for a bare fragment. */
  document?: string[];
  /** The whole program after the run, which is `expected` itself without a `scope`. */
  expectedDocument: string[];
}

/** Every case folder, sorted; the text is split the way `TransformService` splits it. */
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
      return {
        name,
        meta,
        input: document,
        expected: expectedDocument,
        firstLine: meta.firstLine ?? 1,
        document: undefined,
        expectedDocument,
      };
    });
}

const CASES = goldenCases();

/** The context a case runs in, whichever of the two shapes it uses. */
function contextOf(golden: GoldenCase): TransformContext {
  return context(compiled(golden.meta.profile ?? FANUC), golden.meta.options ?? {}, golden.firstLine, golden.document);
}

describe('renumber goldens', () => {
  it('has the cases the work package promised', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(12);
    expect(CASES.every((c) => c.meta.note.trim() !== '')).toBe(true);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, golden) => {
    const ctx = contextOf(golden);
    const want = golden.meta.expect ?? {};

    expect(renumber.preflight?.(golden.input, ctx)?.key ?? null).toBe(want.preflight ?? null);

    const result = renumber.run(golden.input, ctx);
    expect(result.lines).toEqual(golden.expected);
    // The line array is the document's trailing state (types.ts, rule 5).
    expect(result.lines.length).toBe(golden.input.length);
    // A selection run rewrites the selection and nothing else, so everything outside it
    // has to be the same text in `input.nc` and `expected.nc`.
    if (golden.document) {
      const applied = [...golden.document];
      applied.splice(golden.firstLine - 1, result.lines.length, ...result.lines);
      expect(applied).toEqual(golden.expectedDocument);
    }

    if (want.summary !== undefined) expect(result.summary.key).toBe(want.summary);
    if (want.skipped !== undefined) {
      expect(result.skipped.map((s) => ({ line: s.line, severity: s.severity }))).toEqual(want.skipped);
      // `Located.message` is display text (plan §7.1); an untranslated key would show up here.
      expect(result.skipped.every((s) => s.message.trim() !== '' && !s.message.startsWith('ncNumbering.'))).toBe(true);
    }
    if (want.warnings !== undefined) expect(result.warnings.map((w) => w.key)).toEqual(want.warnings);
  });

  it('is idempotent: renumbering the result changes nothing', () => {
    for (const golden of CASES) {
      const ctx = contextOf(golden);
      const again = renumber.run(golden.expected, { ...ctx, document: golden.document ? golden.expectedDocument : undefined });
      expect(again.lines, golden.name).toEqual(golden.expected);
    }
  });

  it('maps every input line to itself: nothing is inserted or deleted', () => {
    for (const golden of CASES) {
      const result = renumber.run(golden.input, contextOf(golden));
      expect(result.lineMap, golden.name).toEqual(Int32Array.from(golden.input.map((_line, i) => i)));
    }
  });
});

describe('availability and options', () => {
  it('runs on every built-in dialect', () => {
    for (const cp of BUILTINS) expect(renumber.available(cp), cp.profile.id).toBe(true);
  });

  it('offers the profile numbering as the defaults', () => {
    const fields = renumber.options?.(compiled(FANUC)) ?? [];
    const byId = new Map(fields.map((field) => [field.id, field]));
    expect([...byId.keys()]).toEqual([
      'start',
      'step',
      'digits',
      'max',
      'onOverflow',
      'spacesAfter',
      'skipStartingWith',
      'skipEmpty',
      'restartAtProgramStart',
      'onlyNumbered',
      'altPrefixes',
    ]);
    expect(byId.get('start')?.default).toBe(10);
    expect(byId.get('step')?.default).toBe(10);
    expect(byId.get('max')?.default).toBe(99999);
    expect(byId.get('onOverflow')?.default).toBe('wrap');
    expect(byId.get('skipStartingWith')?.default).toBe('% O (');
    expect(byId.get('skipEmpty')?.default).toBe(true);
    expect(byId.get('restartAtProgramStart')?.default).toBe(true);
    expect(byId.get('onlyNumbered')?.default).toBe(false);
    expect(fields.every((field) => field.label.trim() !== '' && !field.label.includes('ncNumbering.'))).toBe(true);
  });

  it('has no form at all on a dialect that numbers consecutively', () => {
    expect(renumber.options?.(compiled(KLARTEXT))).toEqual([]);
  });

  it('keeps a word-separated dialect from losing the space behind the number', () => {
    const cp = compiled(KLARTEXT);
    const result = renumber.run(['0 BEGIN PGM T MM', '5 L Z+100 R0 FMAX', '9 END PGM T MM'], context(cp, { spacesAfter: 0 }));
    expect(result.lines).toEqual(['0 BEGIN PGM T MM', '1 L Z+100 R0 FMAX', '2 END PGM T MM']);
  });
});

describe('preflight', () => {
  const fanuc = compiled(FANUC);

  it('says nothing when no line points at a block number', () => {
    expect(renumber.preflight?.(['N10 G0 X0', 'N20 M98 P2000', 'N30 M99'], context(fanuc))).toBeNull();
  });

  it('counts the lines that do and names the first', () => {
    const msg = renumber.preflight?.(['N10 G0 X0', 'GOTO 100', 'N30 M99 P20'], context(fanuc));
    expect(msg?.key).toBe('ncNumbering.renumber.references');
    expect(msg?.params).toEqual({ count: 2, first: 2 });
  });

  it('reports document lines when the run is a selection', () => {
    expect(renumber.preflight?.(['GOTO 100'], context(fanuc, {}, 30))?.params).toEqual({ count: 1, first: 30 });
  });

  it('does not see a reference inside a comment', () => {
    expect(renumber.preflight?.(['N10 G0 X0 (GOTO 100 LATER)'], context(fanuc))).toBeNull();
  });

  it('asks before numbering only part of a consecutively numbered program', () => {
    const cp = compiled(KLARTEXT);
    expect(renumber.preflight?.(['5 L X+0 R0 FMAX'], context(cp, {}, 1))).toBeNull();
    expect(renumber.preflight?.(['5 L X+0 R0 FMAX'], context(cp, {}, 5))?.key).toBe('ncNumbering.renumber.consecutiveSelection');
  });
});

describe('option values that never reach a valid form', () => {
  const fanuc = compiled(FANUC);

  it('falls back to the profile for a field left empty', () => {
    const result = renumber.run(['G0 X0', 'G0 X1.'], context(fanuc, { start: '', step: undefined, skipStartingWith: '', restartAtProgramStart: false }));
    expect(result.lines).toEqual(['N10 G0 X0', 'N20 G0 X1.']);
  });

  it('reads an empty maximum as no maximum', () => {
    const result = renumber.run(['G0 X0'], context(fanuc, { start: 999999, max: '', skipStartingWith: '', restartAtProgramStart: false }));
    expect(result.lines).toEqual(['N999999 G0 X0']);
  });

  it('says so when the shipped defaults wrap a big program into duplicate numbers', () => {
    // G8 M4, with the reviewer's own program: 12,000 blocks renumbered with the
    // `fanuc-gcode` defaults (start 10, step 10, max 99999, onOverflow 'wrap'). The
    // numbers pass the maximum at line 10,000 and 2,001 block numbers end up used twice,
    // which breaks block search and restart on the control and makes GOTO, M99 P and
    // G71 P-Q ambiguous. Only the `stop` branch used to warn.
    const lines = Array.from({ length: 12_000 }, (_v, i) => `N${i + 1} G1 X${i}.`);
    const result = renumber.run(lines, context(compiled(FANUC), { skipStartingWith: '', restartAtProgramStart: false }));

    expect(result.lines[0]).toBe('N10 G1 X0.');
    expect(result.lines[9998]).toBe('N99990 G1 X9998.');
    expect(result.lines[9999]).toBe('N10 G1 X9999.');
    expect(result.lines[11_999]).toBe('N20010 G1 X11999.');

    const numbers = result.lines.map((line) => line.slice(0, line.indexOf(' ')));
    expect(numbers.length - new Set(numbers).size).toBe(2001);

    const wrapped = result.warnings.find((w) => w.key === 'ncNumbering.renumber.wrapped');
    expect(wrapped?.params).toEqual({ count: 1, line: 10_000, start: 10, max: 99999 });
    // And the first wrapped line is in the table, where it can be clicked.
    expect(result.skipped.some((s) => s.line === 10_000 && s.severity === 'warning')).toBe(true);
  });

  it('stops instead of looping when the start value is itself above the maximum', () => {
    const result = renumber.run(['G0 X0', 'G0 X1.'], context(fanuc, { start: 100, max: 50, onOverflow: 'wrap', skipStartingWith: '', restartAtProgramStart: false }));
    expect(result.lines).toEqual(['G0 X0', 'G0 X1.']);
    expect(result.warnings.map((w) => w.key)).toEqual(['ncNumbering.renumber.overflowStopped']);
  });
});

describe('the results table', () => {
  const fanuc = compiled(FANUC);

  it('stops at 200 rows and says how many there were', () => {
    const lines = Array.from({ length: 5000 }, (_v, i) => `(COMMENT ${i})`);
    const result = renumber.run(lines, context(fanuc, { skipStartingWith: '(', restartAtProgramStart: false }));
    expect(result.skipped).toHaveLength(200);
    expect(result.summary).toEqual({ key: 'ncNumbering.renumber.summarySkipped', params: { count: 0, skipped: 5000 } });
    expect(result.warnings).toEqual([{ key: 'ncNumbering.renumber.skippedTruncated', params: { shown: 200, total: 5000 } }]);
  });

  it('says nothing happened when nothing could', () => {
    expect(renumber.run(['', '', ''], context(fanuc)).summary).toEqual({ key: 'ncNumbering.renumber.nothing' });
  });
});

describe('performance', () => {
  const fanuc = compiled(FANUC);

  it('renumbers 100k lines well inside a second', () => {
    const source = ['G0 G90 X0. Y0.', 'N5 T1 M6', 'G43 H1 Z50. (ROUGH)', 'G1 X10. Y10. F250.', '/N100 G0 Z5.', 'M98 P2000', ''];
    const lines = Array.from({ length: 100_000 }, (_v, i) => source[i % source.length]);

    const started = performance.now();
    const result = renumber.run(lines, context(fanuc, { skipStartingWith: '', restartAtProgramStart: false }));
    const ms = performance.now() - started;

    expect(result.lines).toHaveLength(lines.length);
    // The budget is 1 s; the assertion leaves room for a loaded CI machine.
    expect(ms, `${Math.round(ms)} ms for 100k lines`).toBeLessThan(3000);
  });
});
