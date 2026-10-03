// The M9 code-database flags as a contract (plan §7.2, §7.16; P9). Written by the M9
// prelude; WP9.2 owns it with `load.ts` and `lookup.ts` from Wave A on.
//
// What is pinned here is how a flag is **read**, not which entry carries it: the content
// work packages set the flags (WP9.1, WP9.2, WP9.5), and `flags.test.ts` lists every
// flagged entry so that none can be dropped silently. The Python twins
// (`gedit_nc.axis_words_of`, `frame_of`, `speed_limit_bound_of`) are held to the same
// cases in `tests/python/test_code_flags.py`.

import { describe, expect, it } from 'vitest';
import { loadCodeDb, type CodeDbProblem } from './load';
import { axisWordsOf, frameOf, lookupCode, speedLimitBoundOf } from './lookup';
import type { CodeDb } from './types';

function load(codes: unknown[]): { db: CodeDb; problems: CodeDbProblem[] } {
  const problems: CodeDbProblem[] = [];
  const db = loadCodeDb({ dialect: 'x', version: 1, codes }, (p) => problems.push(p));
  return { db, problems };
}

describe('R3: the axis-words flag and the frame flag', () => {
  it('carries both flags through the loader', () => {
    const { db, problems } = load([
      { code: 'G92', label: 'Set coordinates', axisWords: 'data' },
      { code: 'G53', label: 'Machine coordinates', axisWords: 'machine' },
      { code: 'G68.2', label: 'Tilted plane', frame: 'open', axisWords: 'data' },
      { code: 'G69', label: 'Tilt off', frame: 'close' },
    ]);
    expect(problems).toEqual([]);
    expect(db.codes.map((e) => [e.code, e.axisWords ?? null, e.frame ?? null])).toEqual([
      ['G92', 'data', null],
      ['G53', 'machine', null],
      ['G68.2', 'data', 'open'],
      ['G69', null, 'close'],
    ]);
  });

  it('drops and reports a value it does not know, and keeps the entry', () => {
    const { db, problems } = load([
      { code: 'G52', label: 'Local shift', axisWords: 'shift', frame: 'tilt' },
      { code: 'G54', label: 'Offset', axisWords: true, frame: 1 },
    ]);
    expect(db.codes.map((e) => e.code)).toEqual(['G52', 'G54']);
    expect(db.codes.every((e) => e.axisWords === undefined && e.frame === undefined)).toBe(true);
    expect(problems.map((p) => p.path)).toEqual([
      'codes[0].axisWords',
      'codes[0].frame',
      'codes[1].axisWords',
      'codes[1].frame',
    ]);
  });

  it('refuses to call the axis words of a data block a machine position', () => {
    const { db, problems } = load([
      { code: 'G10', label: 'Data', wordsAreData: true, axisWords: 'machine' },
      { code: 'G65', label: 'Macro call', wordsAreData: true, axisWords: 'data' },
    ]);
    expect(db.codes[0].wordsAreData).toBe(true);
    expect(db.codes[0].axisWords).toBeUndefined();
    expect(db.codes[1].axisWords).toBe('data');
    expect(problems.map((p) => p.path)).toEqual(['codes[0].axisWords']);
  });

  it('reads wordsAreData as data for the axis words too', () => {
    const { db } = load([
      { code: 'G10', label: 'Data', wordsAreData: true },
      { code: 'G92', label: 'Set', axisWords: 'data' },
      { code: 'G53', label: 'Machine', axisWords: 'machine' },
      { code: 'G1', label: 'Feed' },
    ]);
    expect(db.codes.map(axisWordsOf)).toEqual(['data', 'data', 'machine', null]);
    expect(axisWordsOf(null)).toBeNull();
    expect(frameOf(undefined)).toBeNull();
  });
});

describe('WP9.2: more of how a flag reads', () => {
  it('reads wordsAreData: false as no flag at all, and a value in the wrong case as none', () => {
    // The loader would have dropped such a value; the readers must not guess when handed a
    // raw entry (a user database loaded elsewhere, a test double).
    expect(axisWordsOf({ code: 'G1', label: 'x', wordsAreData: false })).toBeNull();
    expect(axisWordsOf({ code: 'G1', label: 'x', axisWords: 'DATA' as 'data' })).toBeNull();
    expect(frameOf({ code: 'G1', label: 'x', frame: 'OPEN' as 'open' })).toBeNull();
  });

  it('gives an alias the flags of its entry', () => {
    const { db, problems } = load([
      { code: 'G7.1', aliases: ['G107'], label: 'Cylindrical interpolation', axisWords: 'data', frame: 'open' },
      { code: 'G13.1', aliases: ['G113'], label: 'Polar interpolation off', frame: 'close' },
    ]);
    expect(problems).toEqual([]);
    expect([axisWordsOf(lookupCode(db, 'G107')), frameOf(lookupCode(db, 'G107'))]).toEqual(['data', 'open']);
    expect([axisWordsOf(lookupCode(db, 'g113')), frameOf(lookupCode(db, 'g113'))]).toEqual([null, 'close']);
  });

  it('lets a block of data also open a frame, and a machine position carry a speed limit', () => {
    // No pair of flags excludes the other except `wordsAreData` with `axisWords: 'machine'`;
    // a content package that combines the two others is not told off by the loader.
    const { db, problems } = load([
      { code: 'X1', label: 'x', wordsAreData: true, frame: 'open' },
      { code: 'X2', label: 'x', axisWords: 'machine', sets: { speedLimit: true, speedLimitBound: 'lower' } },
    ]);
    expect(problems).toEqual([]);
    expect(db.codes.map((e) => [axisWordsOf(e), frameOf(e), speedLimitBoundOf(e)])).toEqual([
      ['data', 'open', null],
      ['machine', null, 'lower'],
    ]);
  });
});

describe('the bound of a speed limit', () => {
  it('reads a limit without a bound as the upper one, the clamp it always was', () => {
    const { db, problems } = load([
      { code: 'G50', label: 'Clamp', sets: { speedLimit: true } },
      { code: 'G26', label: 'Upper limit', sets: { speedLimit: true, speedLimitBound: 'upper' } },
      { code: 'G25', label: 'Lower limit', sets: { speedLimit: true, speedLimitBound: 'lower' } },
      { code: 'G97', label: 'rpm', sets: { speedUnit: 'rpm' } },
    ]);
    expect(problems).toEqual([]);
    expect(db.codes.map(speedLimitBoundOf)).toEqual(['upper', 'upper', 'lower', null]);
  });

  it('drops a bound that has no limit to bound, or a value it does not know', () => {
    const { db, problems } = load([
      { code: 'G25', label: 'Lower limit', sets: { speedLimitBound: 'lower' } },
      { code: 'G26', label: 'Upper limit', sets: { speedLimit: true, speedLimitBound: 'max' } },
    ]);
    expect(db.codes[0].sets).toBeUndefined();
    expect(db.codes[1].sets).toEqual({ speedLimit: true });
    expect(problems.map((p) => p.path)).toEqual(['codes[0].sets.speedLimitBound', 'codes[1].sets.speedLimitBound']);
  });
});

describe('the defined cycle (§7.4)', () => {
  it('accepts the three values of a control that defines a cycle and calls it later', () => {
    const { db, problems } = load([
      { code: 'CYCL DEF 200', label: 'Drilling', sets: { cycle: 'define' } },
      { code: 'CYCL CALL', label: 'Call', sets: { cycle: 'call' } },
      { code: 'M89', label: 'Modal call', sets: { cycle: 'call-modal' } },
      { code: 'G81', label: 'Drill', sets: { cycle: 'start' } },
      { code: 'G80', label: 'Cancel', sets: { cycle: 'cancel' } },
      { code: 'M99', label: 'Call once', sets: { cycle: 'calls' } },
    ]);
    expect(db.codes.map((e) => e.sets?.cycle ?? null)).toEqual(['define', 'call', 'call-modal', 'start', 'cancel', null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[5].sets.cycle']);
  });
});
