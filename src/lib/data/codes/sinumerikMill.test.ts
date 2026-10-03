// The milling and 5-axis entries of the shared Sinumerik database (plan §6 M9 WP9.1,
// roadmap R2 and R3; gate G10 §8.7 item 3). Owner: WP9.1.
//
// There is no milling database: P9 put these entries into `sinumerik.json`, which both
// Siemens profiles read, because a mill-turn program (turning profile) writes CYCLE800,
// TRAORI and CYCLE832 as much as a milling program does (§6 M9 "What P9 decided").
//
// Two kinds of assertion, and both decide something a later feature does with a value:
//
//   - **The flags of §7.2** (P9, §7.16 #47). `axisWords: 'machine'` says that the axis
//     words of the block are a position outside the program's frame, or no position at
//     all (G53, G153, SUPA; G74 and G75, whose values only name the axes); `'data'` that
//     they are a shift, an angle, a factor or a mirror axis (the frame instructions).
//     `frame` says that a code opens or closes a frame the program's own positions are not
//     in: the transformations, the rotations, scaling and mirroring, CYCLE800. Extents
//     (WP10.3) list and address arithmetic (WP10.4) refuses on these, so the lists are
//     written out in full: a flag cannot be dropped, or added, without this file failing.
//     A code whose values decide whether it opens or closes (`CYCLE800()`, `ROT` on its
//     own) is `'open'`, the reading that refuses where it could have worked (P9).
//   - **The parameter classes.** A cycle takes its values in brackets, by position, as
//     numbers of the program's unit, so its positions, angles and tolerances carry no class
//     (as the drilling cycles' do not, `sinumerik.test.ts`) and its mode codes are `count`.
//
// The same lists are read in Python by `tests/python/test_sinumerik_mill.py`.

import { describe, expect, it } from 'vitest';
import sinumerikJson from '$lib/data/codes/sinumerik.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { axisWordsOf, frameOf, lookupCode, normalizeCode } from '$lib/core/codes/lookup';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { CodeEntry } from '$lib/core/codes/types';

const problems: CodeDbProblem[] = [];
const db = loadCodeDb(sinumerikJson, (p) => problems.push(p));
const FILES = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON);
const ENTRIES: CodeEntry[] = ((FILES.sinumerik?.codes ?? []) as CodeEntry[]).map((e) => ({ ...e, code: normalizeCode(e.code) }));

const entry = (code: string): CodeEntry | null => lookupCode(db, code);
const codesWith = (predicate: (e: CodeEntry) => boolean): string[] => ENTRIES.filter(predicate).map((e) => e.code).sort();

/** What R2 names, sized as the source review sizes it: about twenty entries. */
const MILLING = [
  'CYCLE800', 'CYCLE832', 'TRAORI', 'TRAFOOF', 'G74', 'G75',
  'ORIWKS', 'ORIMKS', 'ORIAXES', 'ORIVECT', 'ORIPLANE', 'ORIPATH', 'ORIEULER', 'ORIRPY', 'ORIRPY2', 'ORIVIRT1', 'ORIVIRT2', 'ORIRESET',
  'DYNNORM', 'DYNPOS', 'DYNROUGH', 'DYNSEMIFIN', 'DYNFINISH', 'DYNPREC',
];

/** The flag tables, written out (and read the same in Python). */
const AXIS_WORDS = {
  machine: ['G153', 'G53', 'G74', 'G75', 'SUPA'],
  // G25 and G26 (M9 review F10): with axis words they limit the working area.
  data: ['AMIRROR', 'AROT', 'ASCALE', 'ATRANS', 'G25', 'G26', 'MIRROR', 'ROT', 'SCALE', 'TRANS'],
};
const FRAME = {
  open: ['AMIRROR', 'AROT', 'ASCALE', 'CYCLE800', 'MIRROR', 'ROT', 'SCALE', 'TRAANG', 'TRACYL', 'TRANSMIT', 'TRAORI'],
  close: ['TRAFOOF'],
};

describe('the milling and 5-axis entries', () => {
  it('load without a problem, the flags included', () => {
    expect(problems).toEqual([]);
  });

  it('are all there, each with a label and a description', () => {
    for (const code of MILLING) {
      const e = entry(code);
      expect(e, code).not.toBeNull();
      expect(e?.label.length, code).toBeGreaterThan(0);
      expect(e?.description?.length ?? 0, code).toBeGreaterThan(0);
    }
    expect(MILLING.length).toBeGreaterThanOrEqual(20);
  });

  it('switch nothing the modal interpreter reads, and leave nothing to verify', () => {
    // None of them starts a machining cycle, changes the plane, the feed type or the units:
    // CYCLE800 swivels the plane it finds, CYCLE832 sets tolerances. The meanings are the
    // programming manual's (06/2019), so none is held back from hover.
    for (const code of MILLING) {
      const e = entry(code);
      expect(e?.sets, code).toBeUndefined();
      expect(e?.verify, code).toBeUndefined();
      expect(e?.modal, code).toBeUndefined();
      expect(e?.pitchFeed, code).toBeUndefined();
      expect(e?.fNotFeed, code).toBeUndefined();
    }
    expect(entry('G74')?.group).toBe('nonmodal');
    expect(entry('G75')?.group).toBe('nonmodal');
    expect(entry('CYCLE800')?.group).toBe('frame');
  });
});

describe('the flags of §7.2', () => {
  it('mark the machine positions and the frame data, and nothing else', () => {
    expect(codesWith((e) => axisWordsOf(e) === 'machine')).toEqual(AXIS_WORDS.machine);
    expect(codesWith((e) => axisWordsOf(e) === 'data')).toEqual(AXIS_WORDS.data);
    // No Siemens code makes every word of its block data: a frame instruction's axis words
    // are data, and nothing else stands in its block (`TRANS X10` alone).
    expect(codesWith((e) => e.wordsAreData === true)).toEqual([]);
  });

  it('mark the frames that open and the one that closes them', () => {
    expect(codesWith((e) => frameOf(e) === 'open')).toEqual(FRAME.open);
    expect(codesWith((e) => frameOf(e) === 'close')).toEqual(FRAME.close);
  });

  it('read through the loaded database as written', () => {
    for (const code of [...AXIS_WORDS.machine]) expect(axisWordsOf(entry(code)), code).toBe('machine');
    for (const code of [...AXIS_WORDS.data]) expect(axisWordsOf(entry(code)), code).toBe('data');
    for (const code of FRAME.open) expect(frameOf(entry(code)), code).toBe('open');
    expect(frameOf(entry('TRAFOOF'))).toBe('close');
    // A work offset selects the program's own frame, and a translation shifts it, as G52
    // does on Fanuc (§7.2): neither opens one of another kind.
    for (const code of ['G54', 'G500', 'TRANS', 'ATRANS', 'G0', 'G17', 'DIAMON', 'CYCLE832']) expect(frameOf(entry(code)), code).toBeNull();
  });
});

describe('the parameters of CYCLE800 and CYCLE832', () => {
  const params = (code: string) => entry(code)?.params ?? [];
  const unitOf = (code: string, address: string) => params(code).find((p) => p.address === address)?.unit;

  it('list CYCLE800 in the order of the 4.92 signature, 16 of them', () => {
    expect(params('CYCLE800').map((p) => p.address)).toEqual([
      '_FR', '_TC', '_ST', '_MODE', '_X0', '_Y0', '_Z0', '_A', '_B', '_C', '_X1', '_Y1', '_Z1', '_DIR', '_FR_I', '_DMODE',
    ]);
    for (const p of params('CYCLE800')) expect(p.label.length, p.address).toBeGreaterThan(0);
  });

  it('read the mode codes as plain numbers and leave positions, angles and tolerances as written', () => {
    for (const address of ['_FR', '_ST', '_MODE', '_DIR', '_DMODE']) expect(unitOf('CYCLE800', address), address).toBe('count');
    for (const address of ['_TC', '_X0', '_Y0', '_Z0', '_A', '_B', '_C', '_X1', '_Y1', '_Z1', '_FR_I']) {
      expect(unitOf('CYCLE800', address), address).toBeUndefined();
    }
    expect(params('CYCLE832').map((p) => p.address)).toEqual(['S_TOL', 'S_TOLM', 'S_OTOL']);
    expect(unitOf('CYCLE832', 'S_TOLM')).toBe('count');
    expect(unitOf('CYCLE832', 'S_TOL')).toBeUndefined();
    expect(unitOf('CYCLE832', 'S_OTOL')).toBeUndefined();
  });

  it('name no feed, so no script scales a tolerance or a retract distance', () => {
    // Scale feed finds a cycle's feeds by a parameter label that names a feed.
    for (const code of ['CYCLE800', 'CYCLE832']) {
      expect(params(code).filter((p) => /\bfeed\b/i.test(p.label)).map((p) => p.address), code).toEqual([]);
    }
  });

  it('say that CYCLE800() clears the swivel and that the second argument of CYCLE832 is shown as written', () => {
    expect(entry('CYCLE800')?.description).toMatch(/CYCLE800\(\) clears/);
    expect(entry('CYCLE832')?.description).toMatch(/shown as written/);
    expect(entry('G75')?.description).toMatch(/not positions/);
  });
});
