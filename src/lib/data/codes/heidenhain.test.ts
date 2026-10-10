// What the shipped Klartext database says about the entries B1 (package a7s) added from the
// TNC 640 manuals: the cycle manual (Zyklenprogrammierung, 10/2017: ch. 5 pocket, slot and
// stud cycles, ch. 7 SL cycles, §10.9 cycle 19) and the Klartext manual (10/2017: PLANE
// POINTS p. 606–607, the PLANE positioning p. 611, M128 p. 625, M140 p. 501, FK auxiliary
// points p. 330, FUNCTION TURNDATA SPIN p. 682–683).
//
// Three things here decide what a script does with a program:
//   - the parameter **order and names** of a cycle (a Klartext cycle is written one Q
//     parameter per line, in this order; a snippet writes them so);
//   - which parameters are labelled as **feeds** (Scale Feed lists them by their label,
//     `scale_feed.FEED_PARAM_LABEL`, so a mode or a factor must not say "feed");
//   - the `VC` cutting speed (`sets.speedUnit: 'surface'`), which Scale Speed reads.
// The R8 position roles are held by `positions.test.ts` and `tests/fixtures/codes/positions.json`.

import { describe, expect, it } from 'vitest';
import heidenhainJson from '$lib/data/codes/heidenhain.json';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { lookupCode } from '$lib/core/codes/lookup';
import type { CodeEntry } from '$lib/core/codes/types';

const problems: CodeDbProblem[] = [];
const db = loadCodeDb(heidenhainJson, (p) => problems.push(p));
/** The entries as written, so members the loader does not read yet (`review`) are visible. */
const RAW = (heidenhainJson as { codes: (CodeEntry & { review?: string })[] }).codes;
const raw = (code: string) => RAW.find((e) => e.code === code);
const entry = (code: string) => lookupCode(db, code);
const order = (code: string) => entry(code)?.params?.map((p) => p.address);
/** The same test as `scale_feed.FEED_PARAM_LABEL`. */
const feeds = (code: string) => (entry(code)?.params ?? []).filter((p) => /\bfeed/i.test(p.label)).map((p) => p.address);

const CYCLES = ['14', '21', '22', '23', '24', '25', '251', '252', '253', '254', '256', '257'].map((n) => `CYCL DEF ${n}`);
const CHANGED = ['M128', 'M140', 'PLANE SPATIAL', 'PLANE PROJECTED', 'PLANE EULER', 'PLANE VECTOR', 'PLANE POINTS', 'PLANE RELATIV', 'PLANE AXIAL', 'PLANE RESET', 'CYCL DEF 19'];

describe('B1 (a7s): the Klartext entries from the TNC 640 manuals', () => {
  it('load without a problem, and every new or changed entry is marked for the owner\'s review', () => {
    expect(problems).toEqual([]);
    for (const code of [...CYCLES, 'VC', ...CHANGED]) {
      expect(raw(code), code).toBeDefined();
      expect(raw(code)?.review, code).toBe('pending');
      expect(entry(code)?.verify, code).toBeUndefined();
      expect(entry(code)?.description?.length ?? 0, code).toBeGreaterThan(0);
    }
  });

  it('defines the call-active cycles and leaves cycle 14 acting where it stands', () => {
    // §7.2: cycle 14 CONTOUR is DEF-active; 21–25 and 251–257 run when they are called.
    for (const code of CYCLES.filter((c) => c !== 'CYCL DEF 14')) expect(entry(code)?.sets?.cycle, code).toBe('define');
    expect(entry('CYCL DEF 14')?.sets).toBeUndefined();
    expect(entry('CYCL DEF 14')?.group).toBe('cycle');
    expect(entry('CYCL DEF 14')?.params).toBeUndefined();
    // Cycle 20 CONTOUR DATA is DEF-active too but holds tool-axis positions (Q5, Q7) that a
    // shift would have to move: it stays out until a DEF-active cycle can be judged.
    expect(entry('CYCL DEF 20')).toBeNull();
  });

  it('lists the Q parameters of each cycle in the order the control writes them', () => {
    expect(order('CYCL DEF 251')).toEqual([
      'Q215', 'Q218', 'Q219', 'Q220', 'Q368', 'Q224', 'Q367', 'Q207', 'Q351', 'Q201', 'Q202', 'Q369', 'Q206', 'Q338', 'Q200',
      'Q203', 'Q204', 'Q370', 'Q366', 'Q385', 'Q439',
    ]);
    expect(order('CYCL DEF 252')).toEqual([
      'Q215', 'Q223', 'Q368', 'Q207', 'Q351', 'Q201', 'Q202', 'Q369', 'Q206', 'Q338', 'Q200', 'Q203', 'Q204', 'Q370', 'Q366',
      'Q385', 'Q439',
    ]);
    expect(order('CYCL DEF 253')).toEqual([
      'Q215', 'Q218', 'Q219', 'Q368', 'Q374', 'Q367', 'Q207', 'Q351', 'Q201', 'Q202', 'Q369', 'Q206', 'Q338', 'Q200', 'Q203',
      'Q204', 'Q366', 'Q385', 'Q439',
    ]);
    expect(order('CYCL DEF 254')).toEqual([
      'Q215', 'Q219', 'Q368', 'Q375', 'Q367', 'Q216', 'Q217', 'Q376', 'Q248', 'Q378', 'Q377', 'Q207', 'Q351', 'Q201', 'Q202',
      'Q369', 'Q206', 'Q338', 'Q200', 'Q203', 'Q204', 'Q366', 'Q385', 'Q439',
    ]);
    expect(order('CYCL DEF 256')).toEqual([
      'Q218', 'Q424', 'Q219', 'Q425', 'Q220', 'Q368', 'Q224', 'Q367', 'Q207', 'Q351', 'Q201', 'Q202', 'Q206', 'Q200', 'Q203',
      'Q204', 'Q370', 'Q437', 'Q215', 'Q369', 'Q338', 'Q385',
    ]);
    expect(order('CYCL DEF 257')).toEqual([
      'Q223', 'Q222', 'Q368', 'Q207', 'Q351', 'Q201', 'Q202', 'Q206', 'Q200', 'Q203', 'Q204', 'Q370', 'Q376', 'Q215', 'Q369',
      'Q338', 'Q385',
    ]);
    expect(order('CYCL DEF 21')).toEqual(['Q10', 'Q11', 'Q13']);
    expect(order('CYCL DEF 22')).toEqual(['Q10', 'Q11', 'Q12', 'Q18', 'Q19', 'Q208', 'Q401', 'Q404']);
    expect(order('CYCL DEF 23')).toEqual(['Q11', 'Q12', 'Q208']);
    expect(order('CYCL DEF 24')).toEqual(['Q9', 'Q10', 'Q11', 'Q12', 'Q14']);
    expect(order('CYCL DEF 25')).toEqual(['Q1', 'Q3', 'Q5', 'Q7', 'Q10', 'Q11', 'Q12', 'Q15', 'Q18', 'Q446', 'Q447', 'Q448']);
  });

  it('labels as feeds exactly the parameters that are feeds', () => {
    // Q439 (what the feeds refer to) and Q401 (a percentage of the milling feed) are not feeds.
    expect(feeds('CYCL DEF 251')).toEqual(['Q207', 'Q206', 'Q385']);
    expect(feeds('CYCL DEF 252')).toEqual(['Q207', 'Q206', 'Q385']);
    expect(feeds('CYCL DEF 254')).toEqual(['Q207', 'Q206', 'Q385']);
    expect(feeds('CYCL DEF 257')).toEqual(['Q207', 'Q206', 'Q385']);
    expect(feeds('CYCL DEF 21')).toEqual(['Q11']);
    expect(feeds('CYCL DEF 22')).toEqual(['Q11', 'Q12', 'Q19', 'Q208']);
    expect(feeds('CYCL DEF 25')).toEqual(['Q11', 'Q12']);
    for (const code of CYCLES) {
      expect(entry(code)?.pitchFeed, code).toBeUndefined();
      expect(entry(code)?.tapping, code).toBeUndefined();
    }
  });

  it('writes every depth as a negative number into the material, as the 200-series cycles do', () => {
    for (const code of ['CYCL DEF 251', 'CYCL DEF 252', 'CYCL DEF 253', 'CYCL DEF 254', 'CYCL DEF 256', 'CYCL DEF 257']) {
      expect(entry(code)?.params?.find((p) => p.address === 'Q201')?.max, code).toBe(0);
    }
    expect(entry('CYCL DEF 25')?.params?.find((p) => p.address === 'Q1')?.max).toBe(0);
  });

  it('marks the cutting speed of FUNCTION TURNDATA SPIN for Scale Speed', () => {
    // `VC:120` is a colon word; Scale Speed takes it like Sinumerik SVC= (package A6).
    const vc = entry('VC');
    expect(vc?.sets).toEqual({ speedUnit: 'surface' });
    expect(vc?.modal).toBeUndefined();
    expect(/^[A-Z]+$/.test(vc?.code ?? '')).toBe(true);
    expect(db.addresses.VC?.label).toMatch(/cutting speed/i);
  });

  it('describes the nine point words of PLANE POINTS, and their free-contour use', () => {
    for (const n of [1, 2, 3]) {
      for (const axis of ['X', 'Y', 'Z']) {
        const address = db.addresses[`P${n}${axis}`];
        expect(address?.label, `P${n}${axis}`).toBe(`Point ${n}, ${axis} coordinate`);
        expect(address?.description, `P${n}${axis}`).toMatch(/PLANE POINTS/);
        // FK blocks are two-dimensional: only X and Y have a free-contour meaning.
        expect(/free-contour/.test(address?.description ?? ''), `P${n}${axis}`).toBe(axis !== 'Z');
      }
    }
  });

  it('gives the PLANE functions and cycle 19 a feed of their own', () => {
    for (const code of CHANGED.filter((c) => c.startsWith('PLANE '))) {
      expect(entry(code)?.params?.find((p) => p.address === 'F')?.label, code).toBe('Feed for the tilting move');
    }
    expect(entry('CYCL DEF 19')?.params?.find((p) => p.address === 'F')?.label).toMatch(/rotary axes/);
    expect(entry('M128')?.params?.find((p) => p.address === 'F')?.label).toMatch(/compensating moves/);
    expect(entry('M140')?.params?.find((p) => p.address === 'F')?.label).toMatch(/retract/);
  });
});

describe('B1 fix NC (NC-08): cycles 22 and 23, cycle 19', () => {
  it('leaves Q208 optional on cycles 22 and 23, never negative, and says it may be rapid', () => {
    for (const code of ['CYCL DEF 22', 'CYCL DEF 23']) {
      const q208 = entry(code)?.params?.find((p) => p.address === 'Q208');
      expect(q208?.required, code).toBeUndefined();
      expect(q208?.min, code).toBe(0);
      expect(q208?.label, code).toMatch(/FMAX: rapid/);
    }
  });

  it('describes ABST of cycle 19 as a clearance, no position', () => {
    const abst = entry('CYCL DEF 19')?.params?.find((p) => p.address === 'ABST');
    expect(abst?.label).toMatch(/clearance/i);
    expect(abst?.position).toBe('none');
  });
});
