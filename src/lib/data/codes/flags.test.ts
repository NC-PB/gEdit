// What the shipped code databases flag, and what the flags say (plan M9 WP9.2, roadmap R3,
// §7.2, §7.16 #47 and #48; gate G10). Owner: WP9.2.
//
// The flags are `wordsAreData` and `axisWords` (are the axis words of this block positions
// in the program's frame, values, or machine positions?), `frame` (does this code open or
// close a coordinate frame that is not the program's own?) and `sets.speedLimit` with its
// bound. Extents (WP10.3) and address arithmetic (WP10.4) read them instead of a hard-coded
// `G53`/`G28` list, so a flag that goes missing changes what a script does to a program
// without anything failing. Three things stop that here:
//
//   - `tests/fixtures/codes/flags.json` lists every flagged entry of every database file,
//     with the members the file declares and the answers the readers must give. The shipped
//     data has to equal it, in both directions: an entry that loses a flag fails, and so
//     does one that gains a flag nobody reviewed. `tests/python/test_code_flags.py` holds
//     the Python readers to the same list.
//   - a child database that overrides an entry of its parent must not drop a flag silently
//     (the Fanuc lathe replaces `G4`, `G50`, `G92`); the golden lists each drop with its
//     reason.
//   - the decisions that are not obvious from a list are stated as sentences below.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { axisWordsOf, frameOf, lookupCode, normalizeCode, speedLimitBoundOf, tcpOf } from '$lib/core/codes/lookup';
import { resolveCodeDbFiles, resolveCodeDbs } from '$lib/core/codes/resolve';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import type { LineState } from '$lib/core/nc/types';
import type { Profile } from '$lib/core/profiles/types';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';
import { FIXTURES_DIR } from '../../../../tests/unit/helpers/fixtures';

interface Reads {
  axisWords: 'data' | 'machine' | null;
  frame: 'open' | 'close' | null;
  speedLimitBound: 'upper' | 'lower' | null;
  /** P10: tool centre point control on or off (`sets.tcp`). */
  tcp: 'on' | 'off' | null;
}
interface Row {
  code: string;
  declared: Record<string, unknown>;
  reads: Reads;
}
interface Golden {
  databases: Record<string, Row[]>;
  droppedByOverride: Record<string, { code: string; why: string }[]>;
}

const GOLDEN = JSON.parse(readFileSync(join(FIXTURES_DIR, 'codes', 'flags.json'), 'utf8')) as Golden;

/** The databases as the app resolves them: parents merged in, every entry validated. */
const LOADED: Record<string, CodeDb> = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
/** The same, as written in JSON. */
const FILES = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON) as Record<string, { codes: CodeEntry[]; extends?: string }>;
/** Each database file on its own, before its parent is merged in. */
const OWN = BUILTIN_CODE_DB_JSON as Record<string, { codes: CodeEntry[]; extends?: string }>;
const DIALECTS = Object.keys(OWN);

/** The flag members one entry declares, in the shape the golden uses. */
function declaredOf(entry: CodeEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry.wordsAreData !== undefined) out.wordsAreData = entry.wordsAreData;
  if (entry.axisWords !== undefined) out.axisWords = entry.axisWords;
  if (entry.frame !== undefined) out.frame = entry.frame;
  if (entry.frameWithoutValues !== undefined) out.frameWithoutValues = entry.frameWithoutValues;
  // M10 review: the pole (NC-2), a program call (NC-6) and a coordinate shift (NC-7).
  if (entry.pole !== undefined) out.pole = entry.pole;
  if (entry.call !== undefined) out.call = entry.call;
  if (entry.shift !== undefined) out.shift = entry.shift;
  const sets: Record<string, unknown> = {};
  if (entry.sets?.speedLimit !== undefined) sets.speedLimit = entry.sets.speedLimit;
  if (entry.sets?.speedLimitBound !== undefined) sets.speedLimitBound = entry.sets.speedLimitBound;
  if (entry.sets?.tcp !== undefined) sets.tcp = entry.sets.tcp;
  if (Object.keys(sets).length > 0) out.sets = sets;
  return out;
}

const readsOf = (entry: CodeEntry): Reads => ({
  axisWords: axisWordsOf(entry),
  frame: frameOf(entry),
  speedLimitBound: speedLimitBoundOf(entry),
  tcp: tcpOf(entry),
});

const loadedEntry = (dialect: string, code: string): CodeEntry => {
  const found = lookupCode(LOADED[dialect], code);
  if (!found) throw new Error(`no entry ${code} in ${dialect}`);
  return found;
};

describe('the flagged entries of the shipped databases', () => {
  it('has one list per database file, in the golden and in the data', () => {
    expect(Object.keys(GOLDEN.databases).sort()).toEqual([...DIALECTS].sort());
  });

  it.each(DIALECTS)('%s declares exactly the flags the golden lists, in file order', (dialect) => {
    const shipped = OWN[dialect].codes
      .map((entry) => ({ code: entry.code, declared: declaredOf(entry) }))
      .filter((row) => Object.keys(row.declared).length > 0);
    expect(shipped).toEqual(GOLDEN.databases[dialect].map(({ code, declared }) => ({ code, declared })));
  });

  it.each(DIALECTS)('%s: the readers give the answers the golden lists, through the loader', (dialect) => {
    for (const row of GOLDEN.databases[dialect]) {
      expect(readsOf(loadedEntry(dialect, row.code)), `${dialect} ${row.code}`).toEqual(row.reads);
    }
  });

  it('is not empty where the contract needs it: the two milling databases that this package fills', () => {
    expect(GOLDEN.databases.fanuc.length).toBeGreaterThanOrEqual(24);
    expect(GOLDEN.databases.heidenhain.length).toBeGreaterThanOrEqual(18);
  });

  it('keeps a flag when a child database overrides a flagged entry, or says why not', () => {
    const dropped: string[] = [];
    for (const dialect of DIALECTS) {
      const parent = OWN[dialect].extends;
      if (parent === undefined) continue;
      for (const entry of OWN[dialect].codes) {
        const before = FILES[parent].codes.find((e) => normalizeCode(e.code) === normalizeCode(entry.code));
        if (!before) continue;
        const was = readsOf(before);
        const now = readsOf(entry);
        const lost =
          (was.axisWords !== null && now.axisWords !== was.axisWords) ||
          (was.frame !== null && now.frame !== was.frame) ||
          (was.speedLimitBound !== null && now.speedLimitBound !== was.speedLimitBound) ||
          (was.tcp !== null && now.tcp !== was.tcp);
        if (lost) dropped.push(`${dialect} ${normalizeCode(entry.code)}`);
      }
    }
    const listed = Object.entries(GOLDEN.droppedByOverride).flatMap(([dialect, rows]) =>
      rows.map((row) => `${dialect} ${normalizeCode(row.code)}`),
    );
    expect(dropped.sort()).toEqual(listed.sort());
    for (const rows of Object.values(GOLDEN.droppedByOverride)) {
      for (const row of rows) expect(row.why.length, row.code).toBeGreaterThan(20);
    }
  });
});

describe('what the flags decide (the reasons are in the entries and in the G10 table)', () => {
  const codesWith = (dialect: string, predicate: (e: CodeEntry) => boolean): string[] =>
    OWN[dialect].codes.filter(predicate).map((e) => e.code);

  it('Fanuc mill: the machine-position codes are the reference-point returns and G53', () => {
    // G28 and G30: the block's words are the intermediate point, and the block ends at a
    // reference point, so no word of it is a position the program's frame can list.
    expect(codesWith('fanuc', (e) => e.axisWords === 'machine')).toEqual(['G28', 'G30', 'G53']);
  });

  it('Fanuc mill: the codes whose axis words are values, not positions', () => {
    expect(codesWith('fanuc', (e) => e.axisWords === 'data')).toEqual([
      'G4', // the X is a time
      'G5.1', // X0 Y0 Z0 name the axes of the mode
      'G7.1', // the rotary axis word is the cylinder radius
      'G12.1', // the centre of the rotary axis on the plane
      'G50', // lathe A: the coordinates it sets (and, on the mill, nothing)
      'G50.1',
      'G51',
      'G51.1',
      'G52',
      'G68',
      'G68.2',
      'G68.3',
      'G68.4',
      'G92',
    ]);
  });

  it('Fanuc mill: every code that opens a frame has a code that closes it', () => {
    expect(codesWith('fanuc', (e) => e.frame === 'open')).toEqual([
      'G7.1', 'G12.1', 'G16', 'G51', 'G51.1', 'G68', 'G68.2', 'G68.3', 'G68.4',
    ]);
    // G69 ends the rotations and tilts, G69.1 is the lathe spelling; G50 and G50.1 end the
    // scaling and the mirror; G13.1 ends the polar interpolation and G15 the polar coordinate
    // command of G16 (M10 review, NC-5). G7.1 ends itself (a zero radius), which is why it is
    // only ever `open`.
    expect(codesWith('fanuc', (e) => e.frame === 'close')).toEqual(['G13.1', 'G15', 'G50', 'G50.1', 'G69', 'G69.1']);
  });

  it('tool centre point control is no frame: the positions under it are tool tip positions of the program', () => {
    // Plan M10 WP10.4 refuses "simultaneous rotary moves *without* a TCP mode" and a block
    // inside a tilted frame, which presupposes that a block under tool centre point control
    // can be judged: its X, Y and Z are the tool tip in the workpiece, so a shift moves the
    // tip by the shift. Flagging these codes `frame: open` would refuse all of them.
    for (const code of ['G43.4', 'G43.5', 'G49']) expect(loadedEntry('fanuc', code).frame, code).toBeUndefined();
    for (const code of ['FUNCTION TCPM', 'FUNCTION RESET TCPM', 'M128', 'M129']) {
      expect(loadedEntry('heidenhain', code).frame, code).toBeUndefined();
    }
    // P10 (decision of 2026-10-04): Sinumerik TRAORI is the same control and is no frame
    // either; one shared flag, `sets.tcp`, says on or off in all three dialects. TRAFOOF
    // keeps its close, because it also ends TRANSMIT, TRACYL and TRAANG, which are frames.
    expect(loadedEntry('sinumerik', 'TRAORI').frame).toBeUndefined();
    expect(loadedEntry('sinumerik', 'TRAFOOF').frame).toBe('close');
    const switching = (dialect: string, value: 'on' | 'off') => codesWith(dialect, (e) => tcpOf(e) === value);
    expect([switching('fanuc', 'on'), switching('fanuc', 'off')]).toEqual([['G43.4', 'G43.5'], ['G49']]);
    expect([switching('heidenhain', 'on'), switching('heidenhain', 'off')]).toEqual([
      ['FUNCTION TCPM', 'M128'],
      ['FUNCTION RESET TCPM', 'M129'],
    ]);
    expect([switching('sinumerik', 'on'), switching('sinumerik', 'off')]).toEqual([['TRAORI'], ['TRAFOOF']]);
    // The lathe has no G49 to end it (no length offset on a turret lathe), so it has neither
    // of the codes that would start it: tool centre point control can never read as on there.
    for (const code of ['G43.4', 'G43.5', 'G49']) expect(lookupCode(LOADED['fanuc-lathe'], code), code).toBeNull();
    for (const dialect of ['okuma', 'fanuc-lathe', 'fanuc-lathe-b']) {
      expect([switching(dialect, 'on'), switching(dialect, 'off')], dialect).toEqual([[], []]);
    }
  });

  it('Fanuc mill: the macro calls stay the whole-block data they were, G66.1 joins them', () => {
    expect(codesWith('fanuc', (e) => e.wordsAreData === true)).toEqual(['G10', 'G65', 'G66', 'G66.1']);
    // G67 ends the modal call; its block has no arguments.
    expect(loadedEntry('fanuc', 'G67').wordsAreData).toBeUndefined();
  });

  it('Fanuc mill: the 5-axis entries are there, with the readings of their parameters', () => {
    for (const code of ['G43.4', 'G43.5', 'G53.1', 'G68', 'G68.2', 'G68.3', 'G68.4', 'G69', 'G69.1', 'G5', 'G5.1', 'G7.1', 'G12.1', 'G13.1']) {
      expect(lookupCode(LOADED.fanuc, code), code).not.toBeNull();
    }
    // The control's own alternative spellings.
    expect(lookupCode(LOADED.fanuc, 'G107')?.code).toBe('G7.1');
    expect(lookupCode(LOADED.fanuc, 'G112')?.code).toBe('G12.1');
    expect(lookupCode(LOADED.fanuc, 'G113')?.code).toBe('G13.1');
    const unit = (code: string, address: string) =>
      loadedEntry('fanuc', code).params?.find((p) => p.address === address)?.unit;
    // A tool direction, a scale factor and a rotation axis direction are plain numbers; the
    // arc-centre reading of I, J and K (a length) would turn `I1` into a thousandth under IS-B.
    for (const code of ['G43.5', 'G51', 'G68', 'G68.2', 'G68.4']) {
      for (const address of ['I', 'J', 'K']) expect(unit(code, address), `${code} ${address}`).toBe('count');
    }
    // A rotation or a tilt is an angle, not the length that R means on a G2 block.
    for (const code of ['G68', 'G68.2', 'G68.3', 'G68.4']) expect(unit(code, 'R'), `${code} R`).toBe('angle');
    expect(unit('G43.5', 'Q')).toBe('angle');
    // The tool length offset register of the tool centre point codes is required.
    for (const code of ['G43.4', 'G43.5']) {
      expect(loadedEntry('fanuc', code).params?.find((p) => p.address === 'H')?.required, code).toBe(true);
      expect(loadedEntry('fanuc', code).group, code).toBe('lengthComp');
    }
  });

  it('Fanuc mill: nothing here changes which S word is a clamp', () => {
    expect(codesWith('fanuc', (e) => e.sets?.speedLimit === true)).toEqual(['G50', 'G92']);
    for (const e of OWN.fanuc.codes) {
      if (e.axisWords === 'machine') expect(e.sets?.speedLimit, e.code).toBeUndefined();
    }
  });

  it('Klartext: the machine-position M codes, and the datum shift as values', () => {
    expect(codesWith('heidenhain', (e) => e.axisWords === 'machine')).toEqual(['M91', 'M92']);
    // M9 review F5/F11: the stock form's corners and the pole are values too, so a CC under
    // M89 is no positioning block and runs no cycle.
    expect(codesWith('heidenhain', (e) => e.axisWords === 'data')).toEqual([
      'BLK FORM',
      'CC',
      'CYCL DEF 7',
      'CYCL DEF 8',
      'CYCL DEF 19',
      'CYCL DEF 26',
      'PLANE AXIAL',
      'TRANS DATUM',
    ]);
  });

  it('Klartext: every way to tilt, rotate, mirror or scale opens a frame, and the resets close it', () => {
    expect(codesWith('heidenhain', (e) => e.frame === 'open')).toEqual([
      'CYCL DEF 8',
      'CYCL DEF 10',
      'CYCL DEF 11',
      'CYCL DEF 19',
      'CYCL DEF 26',
      'PLANE SPATIAL',
      'PLANE PROJECTED',
      'PLANE EULER',
      'PLANE VECTOR',
      'PLANE POINTS',
      'PLANE RELATIV',
      'PLANE AXIAL',
    ]);
    // Cycle 247 resets the datum shift, the mirror image, the rotation and the scaling; a
    // datum shift (cycle 7) and a dwell (cycle 9) open nothing.
    expect(codesWith('heidenhain', (e) => e.frame === 'close')).toEqual(['CYCL DEF 247', 'PLANE RESET']);
  });

  it('Klartext: a cycle that acts where it is defined is never called, so it starts and cancels nothing', () => {
    // §7.4: such a cycle carries none of the cycle values of `sets`, and it stays out of the
    // `cycle` group, which `scale_speed` and the modal interpreter read as "runs when called".
    const defined = ['CYCL DEF 7', 'CYCL DEF 8', 'CYCL DEF 9', 'CYCL DEF 10', 'CYCL DEF 11', 'CYCL DEF 19', 'CYCL DEF 26', 'CYCL DEF 247'];
    for (const code of defined) {
      const entry = loadedEntry('heidenhain', code);
      expect(entry.sets, code).toBeUndefined();
      expect(entry.group, code).not.toBe('cycle');
    }
    for (const code of ['PLANE SPATIAL', 'PLANE PROJECTED', 'PLANE EULER', 'PLANE VECTOR', 'PLANE POINTS', 'PLANE RELATIV', 'PLANE AXIAL', 'PLANE RESET']) {
      expect(loadedEntry('heidenhain', code).sets, code).toBeUndefined();
      expect(loadedEntry('heidenhain', code).group, code).toBe('tilt');
    }
    const preset = loadedEntry('heidenhain', 'CYCL DEF 247').params?.find((p) => p.address === 'Q339');
    expect(preset).toMatchObject({ required: true, min: 0, max: 65535, unit: 'count' });
  });

  it('Fanuc lathe: the dwell and the coordinate set keep the mill\'s reading, the mirror image is its own', () => {
    // M9 hand-off: the lathe overrides replaced G4, G50 and G92 before the flags existed.
    // M9 review F10: the U and W of the roughing and pattern cycles are a depth of cut, a
    // relief and the finishing allowances, never an incremental X or Z move.
    expect(codesWith('fanuc-lathe', (e) => e.axisWords === 'data')).toEqual(['G4', 'G50', 'G71', 'G72', 'G73']);
    expect(codesWith('fanuc-lathe', (e) => e.frame !== undefined)).toEqual(['G68', 'G69']);
    expect(codesWith('fanuc-lathe-b', (e) => e.axisWords === 'data')).toEqual(['G50', 'G92']);
    // System A's G92 is the threading cycle: its X and Z are positions.
    expect(loadedEntry('fanuc-lathe', 'G92').axisWords).toBeUndefined();
  });

  it('Okuma: the coordinate conversion of the mill-turn codes is a frame, the G-code macros are data', () => {
    expect(codesWith('okuma', (e) => e.axisWords === 'data')).toEqual(['G50']);
    expect(codesWith('okuma', (e) => e.frame === 'open')).toEqual(['G137', 'G138']);
    expect(codesWith('okuma', (e) => e.frame === 'close')).toEqual(['G136']);
    expect(codesWith('okuma', (e) => e.wordsAreData === true)).toEqual(
      ['G161', 'G162', 'G163', 'G164', 'G165', 'G166', 'G167', 'G168', 'G169', 'G170'],
    );
    expect(lookupCode(LOADED.okuma, 'CALRG')).not.toBeNull();
  });

  it('Sinumerik (WP9.1): machine positions, shifts as data, the transformations and rotations as frames', () => {
    expect(codesWith('sinumerik', (e) => e.axisWords === 'machine')).toEqual(['G53', 'G153', 'G74', 'G75', 'SUPA']);
    // M9 review F10: G25/G26 with axis words limit the working area; the words are limits.
    expect(codesWith('sinumerik', (e) => e.axisWords === 'data')).toEqual(
      ['G25', 'G26', 'TRANS', 'ATRANS', 'ROT', 'AROT', 'SCALE', 'ASCALE', 'MIRROR', 'AMIRROR'],
    );
    // TRANS and ATRANS shift the program's own frame (like Fanuc G52): data words, no frame of their own.
    expect(loadedEntry('sinumerik', 'TRANS').frame).toBeUndefined();
    expect(codesWith('sinumerik', (e) => e.frame === 'open')).toEqual(
      ['CYCLE800', 'TRANSMIT', 'TRACYL', 'TRAANG', 'ROT', 'AROT', 'SCALE', 'ASCALE', 'MIRROR', 'AMIRROR'],
    );
    expect(codesWith('sinumerik', (e) => e.frame === 'close')).toEqual(['TRAFOOF']);
    // P10 (decided 2026-10-04, the open question M9 left): TRAORI is tool centre point
    // control, as G43.4 and M128 are, so it carries `sets.tcp: 'on'` and no frame. Address
    // arithmetic judges a block under it, and refuses a simultaneous rotary move without it.
    expect(loadedEntry('sinumerik', 'TRAORI').frame).toBeUndefined();
    expect(tcpOf(loadedEntry('sinumerik', 'TRAORI'))).toBe('on');
    // P10 (§7.4 rule 13): written without values these close the frames of their group, as
    // the Siemens manuals say — CYCLE800() clears the swivel, a frame instruction without an
    // axis the programmable frame. CYCLE800 is in its own group ('tilt'), so CYCLE800() does
    // not end a ROT, and TRANS alone ends ROT, SCALE and MIRROR but not the swivel.
    expect(codesWith('sinumerik', (e) => e.frameWithoutValues === 'close')).toEqual(['CYCLE800', 'TRANS', 'ROT', 'SCALE', 'MIRROR']);
    expect(loadedEntry('sinumerik', 'CYCLE800').group).toBe('tilt');
    for (const code of ['TRANS', 'ROT', 'SCALE', 'MIRROR', 'AROT', 'ASCALE', 'AMIRROR']) {
      expect(loadedEntry('sinumerik', code).group, code).toBe('frame');
    }
    for (const dialect of DIALECTS.filter((d) => d !== 'sinumerik')) {
      expect(codesWith(dialect, (e) => e.frameWithoutValues !== undefined), dialect).toEqual([]);
    }
  });

  it('Fanuc mill (P10): each frame family has a group of its own, so a close ends only its own family', () => {
    // §7.4 rule 13: a close ends the open frames of its group. G69 ends the rotations and
    // tilts; G50 the scaling; G50.1 the mirror; G13.1 the polar interpolation. In one group,
    // G69 would have ended the scaling of G51 too, and a later shift would have moved
    // positions that the control still scales.
    const groupOf = (code: string) => loadedEntry('fanuc', code).group;
    expect(['G68', 'G68.2', 'G68.3', 'G68.4', 'G69', 'G69.1'].map(groupOf)).toEqual(Array(6).fill('frame'));
    expect(['G51', 'G50'].map(groupOf)).toEqual(['scaling', 'scaling']);
    expect(['G51.1', 'G50.1'].map(groupOf)).toEqual(['mirror', 'mirror']);
    expect(['G12.1', 'G13.1'].map(groupOf)).toEqual(['polar', 'polar']);
    // Ended by G7.1 with a zero radius only, a value: so nothing closes it, the safe reading.
    expect(groupOf('G7.1')).toBe('cylindrical');
    for (const code of ['G7.1', 'G12.1', 'G13.1', 'G50', 'G50.1', 'G51', 'G51.1', 'G68', 'G69']) {
      expect(loadedEntry('fanuc', code).modal, code).toBeUndefined();
    }
  });
});

describe('X13: the 5-axis programs of the owner-public set name no unknown code', () => {
  // A G or M code that no entry describes, or a Klartext word that is a keyword and no
  // entry describes. Unknown tokens that are no codes (program names, cycle names in the
  // dialog language) are WP9.3's and WP9.6's.
  const PROFILE_OF: Record<string, string> = {
    'fanuc-gcode': 'fanuc-gcode',
    'heidenhain-klartext': 'heidenhain-klartext',
    'okuma-osp': 'okuma-osp',
  };
  const publicDir = join(FIXTURES_DIR, 'nc', 'owner-public');

  function unknownCodes(folder: string, files: string[]): string[] {
    const raw = BUILTIN_PROFILE_JSON.find((p) => (p as Profile).id === PROFILE_OF[folder]) as Profile;
    const cp = compileProfile(raw);
    const db = LOADED[raw.codes as string];
    const unknown = new Set<string>();
    for (const file of files) {
      let state: LineState | undefined;
      for (const line of readFileSync(join(publicDir, folder, file), 'latin1').split(/\r?\n/)) {
        const result = tokenizeLine(line, cp, state);
        state = result.state;
        const tokens = result.tokens.filter((t) => t.kind !== 'whitespace');
        tokens.forEach((token, i) => {
          if (token.kind === 'word' && /^[GM]$/.test(token.address ?? '') && token.valueText !== undefined) {
            if (!lookupCode(db, `${token.address}${token.valueText}`)) unknown.add(`${token.address}${token.valueText}`);
          } else if (token.kind === 'keyword') {
            const name = token.address ?? token.text;
            if (!lookupCode(db, name)) unknown.add(name);
            // A cycle is known by its number, whole or with a sub-block (`CYCL DEF 7.1`).
            const next = tokens[i + 1];
            const number = next && next.address === undefined ? /^(\d+)(?:\.\d+)?$/.exec(next.text) : null;
            if (name === 'CYCL DEF' && number && !lookupCode(db, `${name} ${number[1]}`)) unknown.add(`${name} ${number[1]}`);
          }
        });
      }
    }
    return [...unknown].sort();
  }

  it('Fanuc mill: G43.4 and G69 are there now', () => {
    expect(unknownCodes('fanuc-gcode', ['2.5D_MILLING.NC', '5X_MILLING.NC', '5-Axis.NC'])).toEqual([]);
  });

  it('Klartext: the tilt and datum cycles (7, 19, 247) and the PLANE and TCPM words are there', () => {
    expect(
      unknownCodes('heidenhain-klartext', ['2.5D_MILLING.H', '5X_MILLING.H', '5X_MILLING_VECTOR.H', '5-Axis-1.H', 'Demo_1.H']),
    ).toEqual([]);
  });

  it('Klartext: the drilling program names no unknown cycle (P10 added 202, 208 and 262)', () => {
    // §10.2 / P10 item 4: a CYCL CALL after a definition the database lacked read as
    // "nothing defined", which the program check (WP10.2) would have reported, and address
    // arithmetic could not judge the call. P10 added the three cycles the M9 review named,
    // with their R8 roles (§7.16 #110).
    expect(unknownCodes('heidenhain-klartext', ['DRILLING.H'])).toEqual([]);
  });

  it('Okuma milling: only G56 and M54 are left, and they are R9', () => {
    // `G56 H` and `M54` in the machining-centre programs are the Okuma milling control, which
    // the manuals at hand do not describe (the lathe manuals give both other meanings): R9,
    // not M9.
    expect(unknownCodes('okuma-osp', ['2.5D_MILLING.min', '5X_MILLING.min', 'DRILLING.min'])).toEqual(['G56', 'M54']);
  });
});
