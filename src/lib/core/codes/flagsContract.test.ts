// The M9 code-database flags as a contract (plan §7.2, §7.16; P9). Written in the M9
// prelude and kept by WP9.2 with `load.ts` and `lookup.ts`. The M10 prelude
// (P10) adds three: the R8 parameter role (`CodeParam.position`), tool centre point control
// (`CodeSets.tcp`) and the Klartext tool-axis plane (`CodeSets.planeFromAxisWord`).
//
// What is pinned here is how a flag is **read**, not which entry carries it: the content
// work packages set the flags (WP9.1, WP9.2, WP9.5), and `flags.test.ts` lists every
// flagged entry so that none can be dropped silently. The Python twins
// (`gedit_nc.axis_words_of`, `frame_of`, `speed_limit_bound_of`) are held to the same
// cases in `tests/python/test_code_flags.py`.

import { describe, expect, it } from 'vitest';
import { loadCodeDb, type CodeDbProblem } from './load';
import { axisWordsOf, frameOf, lookupCode, positionOf, speedLimitBoundOf, tcpOf } from './lookup';
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

  it('accepts the word that makes the cycle written behind it modal', () => {
    const { db, problems } = load([
      { code: 'MCALL', label: 'Modal call', group: 'cycle', sets: { cycle: 'call-modal-next' } },
      { code: 'MCALL2', label: 'Typo', group: 'cycle', sets: { cycle: 'call-modal-later' } },
    ]);
    expect(db.codes.map((e) => e.sets?.cycle ?? null)).toEqual(['call-modal-next', null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[1].sets.cycle']);
  });
});

describe('R8: the parameter role (P10, §7.2, §7.16 #106)', () => {
  it('carries the four roles through the loader and drops one it does not know', () => {
    const { db, problems } = load([
      {
        code: 'CYCLE81',
        label: 'Drilling',
        sets: { cycle: 'start' },
        params: [
          { address: 'RTP', label: 'Retraction plane', position: 'tool-axis' },
          { address: 'SDIS', label: 'Safety distance', position: 'none' },
          { address: 'DP', label: 'Depth', position: 'absolute' },
          { address: '_AMODE', label: 'Mode', unit: 'count', position: 'mode' },
          { address: 'DPR', label: 'Relative depth' },
        ],
      },
      { code: 'CYCLE800', label: 'Swivel', frame: 'open', params: [{ address: '_Z0', label: 'Pivot', position: 'other' }] },
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[0].params[2].position']);
    expect(db.codes[0].params?.map(positionOf)).toEqual(['tool-axis', 'none', null, 'mode', null]);
    // A dropped role leaves the parameter itself: it is then "not reviewed", which address
    // arithmetic refuses, so a typo can only make it refuse more, never move a value.
    expect(db.codes[0].params?.[2]).toEqual({ address: 'DP', label: 'Depth' });
    expect(db.codes[0].params?.[3].unit).toBe('count');
    expect(positionOf(db.codes[1].params?.[0])).toBe('other');
  });

  it('reads nothing into a role it does not know when handed a raw parameter', () => {
    expect(positionOf(null)).toBeNull();
    expect(positionOf(undefined)).toBeNull();
    expect(positionOf({ address: 'Q203', label: 'x', position: 'TOOL-AXIS' as 'tool-axis' })).toBeNull();
  });
});

describe('tool centre point control (P10, decision of 2026-10-04, §7.16 #107)', () => {
  it('is a sets member, on or off, and no frame', () => {
    const { db, problems } = load([
      { code: 'TRAORI', label: 'Five-axis transformation', sets: { tcp: 'on' } },
      { code: 'TRAFOOF', label: 'Transformation off', frame: 'close', sets: { tcp: 'off' } },
      { code: 'M128', label: 'Tool tip', modal: true, group: 'tcpm', sets: { tcp: 'yes' } },
      { code: 'G1', label: 'Feed' },
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[2].sets.tcp']);
    expect(db.codes.map((e) => [tcpOf(e), frameOf(e)])).toEqual([
      ['on', null],
      ['off', 'close'],
      [null, null],
      [null, null],
    ]);
    expect(tcpOf(null)).toBeNull();
    expect(tcpOf({ code: 'X', label: 'x', sets: { tcp: 'ON' as 'on' } })).toBeNull();
  });
});

describe('the plane from the tool axis (P10, §7.16 #108)', () => {
  it('is a flag: true or nothing', () => {
    const { db, problems } = load([
      { code: 'TOOL CALL', label: 'Tool call', sets: { planeFromAxisWord: true } },
      { code: 'TOOL DEF', label: 'Tool def', sets: { planeFromAxisWord: false } },
      { code: 'X', label: 'x', sets: { planeFromAxisWord: 'Z' } },
    ]);
    expect(db.codes.map((e) => e.sets ?? null)).toEqual([{ planeFromAxisWord: true }, null, null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[2].sets.planeFromAxisWord']);
  });
});

describe('the close of a frame code written without values (P10, §7.4 rule 13, §7.16 #109)', () => {
  it('is close or nothing', () => {
    const { db, problems } = load([
      { code: 'CYCLE800', label: 'Swivel', group: 'tilt', frame: 'open', frameWithoutValues: 'close' },
      { code: 'TRANS', label: 'Shift', group: 'frame', axisWords: 'data', frameWithoutValues: 'close' },
      { code: 'ROT', label: 'Rotation', group: 'frame', frame: 'open', frameWithoutValues: 'open' },
    ]);
    expect(db.codes.map((e) => e.frameWithoutValues ?? null)).toEqual(['close', 'close', null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[2].frameWithoutValues']);
    // It is a second answer beside `frame`, not a change of it.
    expect(db.codes.map(frameOf)).toEqual(['open', null, 'open']);
  });
});

describe('what the program checks read (M10, WP10.2)', () => {
  it('carries the new sets members through the loader and drops a value it does not know', () => {
    const { db, problems } = load([
      { code: 'M3', label: 'On', group: 'spindle', modal: true, sets: { spindle: 'on' } },
      { code: 'M13', label: 'Tool on', group: 'spindle', sets: { toolSpindle: 'on' } },
      { code: 'G0', label: 'Rapid', group: 'motion', modal: true, sets: { motion: 'rapid' } },
      { code: 'G41', label: 'Left', group: 'compensation', modal: true, sets: { radiusComp: 'on' } },
      { code: 'G49', label: 'Off', group: 'lengthComp', modal: true, sets: { lengthComp: 'off', tcp: 'off' } },
      { code: 'G332', label: 'Out', group: 'motion', modal: true, sets: { motion: 'feed', exitSpeed: 'zero' } },
      { code: 'G291', label: 'ISO', group: 'language', modal: true, sets: { language: 'iso' } },
      { code: 'M5', label: 'Off', group: 'spindle', modal: true, sets: { spindle: 'stop', motion: 'fast' } },
    ]);
    expect(db.codes.map((e) => e.sets ?? null)).toEqual([
      { spindle: 'on' },
      { toolSpindle: 'on' },
      { motion: 'rapid' },
      { radiusComp: 'on' },
      { lengthComp: 'off', tcp: 'off' },
      { motion: 'feed', exitSpeed: 'zero' },
      { language: 'iso' },
      null,
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[7].sets.spindle', 'codes[7].sets.motion']);
  });

  it('reads conflicts, alone, requires and contour, and drops what it does not know', () => {
    const { db, problems } = load([
      { code: 'G43.4', label: 'TCP', group: 'lengthComp', modal: true, conflicts: ['cycle', 'frame:frame', '!tcp'] },
      { code: 'G53.1', label: 'Axis', alone: true, conflicts: ['frame:', 'tool', 7] },
      { code: 'PLANE RESET', label: 'Reset', group: 'tilt', frame: 'close', requires: ['move', 'TURN', ''] },
      { code: 'G81', label: 'Shape', group: 'lap', contour: 'open' },
      { code: 'G80', label: 'End', group: 'lap', contour: 'shut', alone: 'yes' },
    ]);
    expect(db.codes.map((e) => e.conflicts ?? null)).toEqual([['cycle', 'frame:frame', '!tcp'], null, null, null, null]);
    expect(db.codes.map((e) => e.alone ?? null)).toEqual([null, true, null, null, null]);
    expect(db.codes.map((e) => e.requires ?? null)).toEqual([null, null, ['MOVE', 'TURN'], null, null]);
    expect(db.codes.map((e) => e.contour ?? null)).toEqual([null, null, null, 'open', null]);
    expect(problems.map((p) => p.path)).toEqual([
      'codes[1].conflicts[0]',
      'codes[1].conflicts[1]',
      'codes[1].conflicts[2]',
      'codes[2].requires[2]',
      'codes[4].alone',
      'codes[4].contour',
    ]);
  });

  it('reports a flag that is written as anything but true or false, and drops it', () => {
    const { db, problems } = load([
      { code: 'G80', label: 'End', alone: 'yes', modal: 1, call: 'true', shift: 'x', verify: [], wordsAreData: 'on' },
      { code: 'G81', label: 'Fine', alone: true, modal: false, params: [{ address: 'R', label: 'Plane', required: 'yes' }] },
    ]);
    expect(db.codes[0]).toEqual({ code: 'G80', label: 'End' });
    expect(db.codes[1].alone).toBe(true);
    expect(db.codes[1].modal).toBeUndefined();
    expect(db.codes[1].params?.[0].required).toBeUndefined();
    expect(problems.map((p) => p.path).sort()).toEqual(
      ['codes[0].alone', 'codes[0].call', 'codes[0].modal', 'codes[0].shift', 'codes[0].verify', 'codes[0].wordsAreData', 'codes[1].params[0].required'].sort(),
    );
  });
});

describe('M10 review: the pole, a program call, a coordinate shift and an axis parameter', () => {
  it('carries the members through the loader and drops what it does not know', () => {
    const { db, problems } = load([
      { code: 'CC', label: 'Pole', axisWords: 'data', pole: 'set' },
      { code: 'C', label: 'Arc', pole: 'use' },
      { code: 'G65', label: 'Macro call', wordsAreData: true, call: true },
      { code: 'G52', label: 'Local shift', axisWords: 'data', shift: true },
      {
        code: 'CIP',
        label: 'Arc through a point',
        params: [
          { address: 'I1', label: 'Point, X', axis: 'x' },
          { address: 'J1', label: 'Point, Y', axis: 'YY' },
        ],
      },
      { code: 'G1', label: 'Line', pole: 'centre', call: 'yes', shift: 1 },
    ]);
    expect(db.codes.map((e) => [e.code, e.pole ?? null, e.call ?? null, e.shift ?? null])).toEqual([
      ['CC', 'set', null, null],
      ['C', 'use', null, null],
      ['G65', null, true, null],
      ['G52', null, null, true],
      ['CIP', null, null, null],
      ['G1', null, null, null],
    ]);
    expect(db.codes[4].params?.map((p) => p.axis ?? null)).toEqual(['X', null]);
    expect(problems.map((p) => p.path)).toEqual(['codes[4].params[1].axis', 'codes[5].pole', 'codes[5].call', 'codes[5].shift']);
  });
});

describe('the path of a feed move (Phase 3 prelude P3a, plan §6.6; the motion colours of P3.7)', () => {
  it('carries an arc and a single-pass cycle through the loader and drops any other value', () => {
    const { db, problems } = load([
      { code: 'G2', label: 'Arc', group: 'motion', modal: true, sets: { motion: 'feed', path: 'arc' } },
      { code: 'G1', label: 'Line', group: 'motion', modal: true, sets: { motion: 'feed' } },
      { code: 'G3', label: 'Arc', group: 'motion', modal: true, sets: { motion: 'feed', path: 'circle' } },
      { code: 'G90', label: 'Turning pass', group: 'motion', modal: true, sets: { motion: 'feed', path: 'cycle' } },
    ]);
    expect(db.codes.map((e) => [e.code, e.sets?.path ?? null, e.sets?.motion ?? null])).toEqual([
      ['G2', 'arc', 'feed'],
      ['G1', null, 'feed'],
      ['G3', null, 'feed'],
      ['G90', 'cycle', 'feed'],
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[2].sets.path']);
  });
});
