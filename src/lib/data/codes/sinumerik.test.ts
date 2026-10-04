// What the shipped Sinumerik database says (plan §8.5, AD-19; gate G10 §8.7 item 3).
// Owner: WP8.5.
//
// Every assertion here decides what the editor tells a machinist, and four of them decide
// whether a program survives a script:
//
//   - `pitchFeed` marks a block whose `F` — or whose `I`/`K` — carries a thread lead. On a
//     cycle written as a call, which stands in a block of its own, it marks a cycle that may
//     take its lead from the feed in force (CYCLE840 without a spindle encoder); a cycle
//     whose lead is one of its arguments (CYCLE84, CYCLE97, CYCLE99) does not carry it.
//     Scaling a lead scraps the thread, so the list is written out in full and compared,
//     not spot-checked.
//   - `fNotFeed` marks `G4`, where `F` is a dwell in seconds. Scaling it changes how long
//     the tool stands still at the bottom of a hole, and reporting it as a feed puts a
//     time into the feed range of the program report.
//   - `sets.speedLimit` marks `G25` and `G26`, whose `S` is a limit and not a speed, exactly
//     as `LIMS=` is on the profile side.
//   - `sets.diameter` marks `DIAMON`, `DIAMOF` and `DIAM90`, and nothing else.
//
// Which entries carry `verify: true` follows one rule, written down here because G10
// reads it: a meaning the notes tag [M] or [P] (the 840D sl programming manual, 06/2019), a
// DIN 66025 meaning, or one the owner decided (D35) is shown in hover; what the manual
// only lists (G942, G952), what the machine sets up (M6, M19) and the cycles whose
// parameters are not described (CYCLE93, CYCLE97) is not. The source review (2026-09) read
// the cycles manual of 01/2008, which describes CYCLE87–CYCLE89.
//
// The database is read through `resolveCodeDbFiles` (AD-17) so it is the merge result the
// app uses that is checked, and through `loadCodeDb` where the loaded shape matters.

import { describe, expect, it } from 'vitest';
import sinumerikJson from '$lib/data/codes/sinumerik.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { lookupCode, normalizeCode } from '$lib/core/codes/lookup';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { CodeDb, CodeEntry } from '$lib/core/codes/types';

const DIALECT = 'sinumerik';

const problems: CodeDbProblem[] = [];
const db: CodeDb = loadCodeDb(sinumerikJson, (p) => problems.push(p));

const fileProblems: string[] = [];
const FILES = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, p) =>
  fileProblems.push(`${dialect}: ${p.path}: ${p.message}`),
);

/** The resolved entries as they are written in JSON, codes normalised. */
const ENTRIES: CodeEntry[] = ((FILES[DIALECT]?.codes ?? []) as CodeEntry[]).map((entry) => ({
  ...entry,
  code: normalizeCode(entry.code),
}));

function entry(code: string): CodeEntry | undefined {
  return ENTRIES.find((e) => e.code === normalizeCode(code));
}

const codesWith = (predicate: (e: CodeEntry) => boolean): string[] =>
  ENTRIES.filter(predicate).map((e) => e.code).sort();

/** The group names of plan §7.2, plus `pathmode`, which §8.5's table adds for G60–G645. */
const MODAL_GROUPS = [
  'motion', 'plane', 'units', 'distance', 'feedmode', 'spindlemode', 'spindle', 'coolant', 'compensation',
  'lengthComp', 'offset', 'cycle', 'cyclereturn', 'diametermode', 'pathmode',
  // M10 (WP10.2): G290/G291, the language the control reads the program in.
  'language',
];

describe('the shipped Sinumerik database', () => {
  it('loads and resolves without a single problem', () => {
    expect(problems).toEqual([]);
    expect(fileProblems).toEqual([]);
    expect(db.dialect).toBe(DIALECT);
    expect(FILES[DIALECT]).toBeDefined();
    // It stands on its own: no `extends`, because no other dialect it could extend
    // shares its comment character, its calls or its keywords (AD-17).
    expect((FILES[DIALECT] as { extends?: string }).extends).toBeUndefined();
  });

  it('has no duplicate code and no duplicate alias', () => {
    const keys = ENTRIES.flatMap((e) => [e.code, ...(e.aliases ?? []).map(normalizeCode)]);
    expect(new Set(keys).size, keys.filter((key, i) => keys.indexOf(key) !== i).join(', ')).toBe(keys.length);
  });

  it('gives every entry a label and every address a label', () => {
    for (const e of ENTRIES) {
      expect(e.label?.length, e.code).toBeGreaterThan(0);
      expect(e.code, e.code).toBe(e.code.toUpperCase());
    }
    for (const [letter, address] of Object.entries(db.addresses)) {
      expect(address.label.length, letter).toBeGreaterThan(0);
    }
  });

  it('keeps the addresses the grammar is generated from', () => {
    // The Sinumerik grammar paints every address of this database (WP8.4), so changing
    // this list changes the grammar snapshot another package owns.
    expect(Object.keys(db.addresses).sort()).toEqual(
      ['AR', 'C', 'CR', 'D', 'F', 'G', 'I', 'J', 'K', 'L', 'LIMS', 'M', 'N', 'P', 'S', 'SF', 'T', 'X', 'Y', 'Z'],
    );
  });

  it('puts every modal code in a modal group the plan names', () => {
    // §8.7 item 3: every modal group name comes from §7.2 (and §8.5's path mode); the
    // interpreter treats the group of every `modal` entry as one (§7.2).
    for (const e of ENTRIES.filter((row) => row.modal)) {
      expect(MODAL_GROUPS, `${e.code} is modal in "${String(e.group)}"`).toContain(e.group);
    }
  });

  it('calls nothing non-modal that stays in force until it is switched off', () => {
    // A hover that says "Non-modal" on `SOFT` or `TRANSMIT` tells the reader the opposite
    // of what the control does. Those entries carry no group rather than a wrong one.
    for (const code of ['SOFT', 'BRISK', 'TRANSMIT', 'TRACYL', 'TRAFOOF', 'TRAORI']) {
      expect(entry(code)?.group, code).toBeUndefined();
    }
    // M9 (WP9.1): G74 and G75, the reference-point and fixed-point approaches, act in their block only.
    expect(codesWith((e) => e.group === 'nonmodal')).toEqual([
      'G153', 'G25', 'G26', 'G4', 'G53', 'G63', 'G74', 'G75', 'G9', 'STOPRE', 'SUPA',
    ]);
  });

  it('describes every keyword the profile tokenizes', () => {
    // A keyword the tokenizer hands over as a keyword token and the database has never
    // heard of hovers as "not described yet".
    const raw = BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === DIALECT);
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    const cp = compileProfile(checked.profile);
    const missing = (cp.profile.syntax.keywords ?? []).filter((keyword) => lookupCode(db, keyword) === null);
    expect(missing, 'keywords without an entry').toEqual([]);
  });

  it('ships the CAM subset §8.5 lists', () => {
    const codes = new Set(ENTRIES.map((e) => e.code));
    const expected = [
      'G0', 'G1', 'G2', 'G3', 'CIP', 'CT',
      'G4',
      'G9', 'G60', 'G64', 'G641', 'G642',
      'G17', 'G18', 'G19',
      'G25', 'G26',
      'G33', 'G331', 'G332',
      'G40', 'G41', 'G42',
      'G53', 'G153', 'SUPA',
      'G54', 'G55', 'G56', 'G57', 'G500',
      'G70', 'G71', 'G700', 'G710',
      'G90', 'G91',
      'G93', 'G94', 'G95',
      'G96', 'G97', 'G961', 'G962', 'G971', 'G972', 'G973',
      'G34', 'G35', 'G335', 'G336', 'G63',
      'DIAMON', 'DIAMOF', 'DIAM90',
      'CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89',
      'CYCLE84', 'CYCLE840',
      'CYCLE93', 'CYCLE95', 'CYCLE97', 'CYCLE99',
      'CYCLE62', 'CYCLE92', 'CYCLE98', 'CYCLE930', 'CYCLE940', 'CYCLE951', 'CYCLE952',
      'MCALL',
      'TRANSMIT', 'TRACYL', 'TRAFOOF', 'SOFT', 'BRISK', 'STOPRE',
      'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M8', 'M9', 'M17', 'M19', 'M30',
      'GOTOF', 'GOTOB', 'GOTO', 'IF', 'ENDIF', 'WHILE', 'ENDWHILE', 'FOR', 'ENDFOR',
      'LOOP', 'ENDLOOP', 'RET', 'PROC', 'DEF', 'EXTERN', 'CALL', 'EXTCALL',
    ];
    expect(expected.filter((code) => !codes.has(code))).toEqual([]);
  });

  it('describes no machine-builder code', () => {
    // §1 of the notes and the M8 brief: a builder's own cycles show up as ordinary calls
    // (`L7xx`, `NAME(…)`) and are highlighted generically, and an M code above 30 is the
    // builder's — except the ones the control itself predefines, the gear stages M40–M45
    // and M70 (the programming manual's list of M functions, source review 2026-09).
    // Shipping a builder's code as a built-in would put a claim about somebody else's
    // machine into hover.
    expect(ENTRIES.filter((e) => /^L\d+$/.test(e.code)).map((e) => e.code)).toEqual([]);
    const mCodes = ENTRIES.filter((e) => /^M\d+$/.test(e.code)).map((e) => Number(e.code.slice(1)));
    expect(mCodes.filter((n) => n > 30)).toEqual([40, 41, 42, 43, 44, 45, 70]);
  });
});

describe('what a code does to the modal state', () => {
  it('switches the plane, the distance mode, the units, the feed and the speed', () => {
    expect(entry('G18')?.sets).toEqual({ plane: 'ZX' });
    expect(entry('G17')?.sets).toEqual({ plane: 'XY' });
    expect(entry('G90')?.sets).toEqual({ distance: 'absolute' });
    expect(entry('G91')?.sets).toEqual({ distance: 'incremental' });
    expect(entry('G70')?.sets).toEqual({ units: 'inch' });
    expect(entry('G71')?.sets).toEqual({ units: 'mm' });
    expect(entry('G700')?.sets).toEqual({ units: 'inch' });
    expect(entry('G710')?.sets).toEqual({ units: 'mm' });
    // On this control the feed type and the spindle mode are one group (G group 15): G96
    // switches to feed per revolution, G961 and G971 to feed per minute, and G94 or G95
    // end a constant cutting speed.
    expect(entry('G95')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'rpm' });
    expect(entry('G94')?.sets).toEqual({ feedUnit: 'per-minute', speedUnit: 'rpm' });
    expect(entry('G93')?.sets).toEqual({ feedUnit: 'inverse-time', speedUnit: 'rpm' });
    expect(entry('G96')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'surface' });
    expect(entry('G97')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'rpm' });
    expect(entry('G961')?.sets).toEqual({ feedUnit: 'per-minute', speedUnit: 'surface' });
    expect(entry('G971')?.sets).toEqual({ feedUnit: 'per-minute', speedUnit: 'rpm' });
    expect(entry('G973')?.sets).toEqual({ feedUnit: 'per-rev', speedUnit: 'rpm' });
    // G962 and G972 keep the feed unit they find.
    expect(entry('G962')?.sets).toEqual({ speedUnit: 'surface' });
    expect(entry('G972')?.sets).toEqual({ speedUnit: 'rpm' });
    // 2026-09: SVC= is a value word (§7.5) that switches nothing; its `speedUnit` says that
    // its own value is a cutting speed, which scale_speed reads like the S under G96.
    expect(entry('SVC')?.sets).toEqual({ speedUnit: 'surface' });
    expect(entry('SVC')?.group).toBe('tool');
    const feedType = codesWith((e) => e.code !== 'SVC' && (e.sets?.speedUnit !== undefined || e.sets?.feedUnit !== undefined));
    expect(feedType).toEqual(['G93', 'G931', 'G94', 'G942', 'G95', 'G952', 'G96', 'G961', 'G962', 'G97', 'G971', 'G972', 'G973']);
    // M9 review F8: G931's F is the time the move takes, so no script may scale it as a feed.
    expect(entry('G931')?.sets).toEqual({ feedUnit: 'travel-time', speedUnit: 'rpm' });
    for (const code of feedType) expect(entry(code)?.group, code).toBe('feedmode');
    expect(codesWith((e) => e.group === 'spindlemode')).toEqual([]);
    // G70/G71 are the unit switch on this control, not the Fanuc lathe's finishing and
    // roughing cycles. Reading them the other way round would report a cycle where the
    // program only chose millimetres.
    expect(entry('G70')?.group).toBe('units');
    expect(entry('G71')?.description).toMatch(/not a roughing cycle/);
    expect(entry('G70')?.description).toMatch(/not a finishing cycle/);
    expect(entry('G71')?.params).toBeUndefined();
  });

  it('switches diameter programming on DIAMON, DIAMOF and DIAM90 and nowhere else', () => {
    expect(codesWith((e) => e.sets?.diameter !== undefined)).toEqual(['DIAM90', 'DIAMOF', 'DIAMON']);
    expect(entry('DIAMON')?.sets).toEqual({ diameter: 'on' });
    expect(entry('DIAMOF')?.sets).toEqual({ diameter: 'off' });
    expect(entry('DIAM90')?.sets).toEqual({ diameter: 'absolute-only' });
    for (const code of ['DIAMON', 'DIAMOF', 'DIAM90']) {
      expect(entry(code)?.group, code).toBe('diametermode');
      expect(entry(code)?.modal, code).toBe(true);
      // D35 is the owner's decision about exactly these three codes.
      expect(entry(code)?.verify, code).toBeUndefined();
    }
  });

  it('keeps the spindle and the coolant switched until another code of their group', () => {
    // As in every other built-in database: M3, M4 and M5 leave the master spindle running
    // or stopped, M8 and M9 the coolant on or off. M19 and SETMS change no running state
    // of that group, and the spindle forms `M3=3` are assignment words, not these codes.
    for (const code of ['M3', 'M4', 'M5']) {
      expect(entry(code)?.group, code).toBe('spindle');
      expect(entry(code)?.modal, code).toBe(true);
    }
    for (const code of ['M8', 'M9']) {
      expect(entry(code)?.group, code).toBe('coolant');
      expect(entry(code)?.modal, code).toBe(true);
    }
    for (const code of ['M19', 'SETMS']) expect(entry(code)?.modal, code).toBeUndefined();
  });

  it('marks G25 and G26 as speed limits, and says they limit the working area with axis words', () => {
    expect(codesWith((e) => e.sets?.speedLimit === true)).toEqual(['G25', 'G26']);
    for (const code of ['G25', 'G26']) {
      expect(entry(code)?.description, code).toMatch(/limit, not a speed/);
      expect(entry(code)?.label, code).toMatch(/working area with axis words/);
      expect(entry(code)?.verify, code).toBeUndefined();
    }
  });

  it('starts a cycle on every CYCLE entry and on G63, for its own block', () => {
    const starts = codesWith((e) => e.sets?.cycle === 'start');
    expect(starts).toEqual([
      'CYCLE62', 'CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86',
      'CYCLE87', 'CYCLE88', 'CYCLE89', 'CYCLE92', 'CYCLE93', 'CYCLE930', 'CYCLE940', 'CYCLE95',
      'CYCLE951', 'CYCLE952', 'CYCLE97', 'CYCLE98', 'CYCLE99', 'G63',
    ]);
    // G63 taps once: the move type in force before it applies again after its block.
    expect(entry('G63')?.group).toBe('nonmodal');
    // None of them is modal: a `CYCLE8x(…)` call drills once, at the position it stands
    // at, and `MCALL` is what makes the next positioning blocks repeat it. The modal call
    // is tracked by the interpreter over the block it stands on (§11 item 19), so MCALL
    // itself neither starts nor cancels a cycle in the data.
    for (const code of starts) expect(entry(code)?.modal, code).toBeUndefined();
    expect(entry('MCALL')?.sets).toBeUndefined();
    expect(entry('MCALL')?.group).toBe('cycle');
    expect(codesWith((e) => e.sets?.cycle === 'cancel')).toEqual([]);
  });
});

describe('the words a script must not scale', () => {
  it('marks every code whose F is or follows a thread lead as pitchFeed, and nothing else', () => {
    expect(codesWith((e) => e.pitchFeed === true)).toEqual([
      'CYCLE840', 'G33', 'G331', 'G332', 'G335', 'G336', 'G34', 'G35', 'G63',
    ]);
    for (const code of ['G33', 'G331', 'G332', 'G34', 'G35', 'G335', 'G336']) {
      expect(entry(code)?.group, code).toBe('motion');
      expect(entry(code)?.modal, code).toBe(true);
    }
    // G34 and G35: F is the change of the lead per revolution, never a feed.
    for (const code of ['G34', 'G35']) expect(entry(code)?.description, code).toMatch(/F the change of the lead/);
    // CYCLE840 without a spindle encoder taps with the feed in force (ENC, argument 9).
    expect(entry('CYCLE840')?.description).toMatch(/ENC/);
    // A cycle whose lead is its own argument takes nothing from the feed in force.
    for (const code of ['CYCLE84', 'CYCLE97', 'CYCLE98', 'CYCLE99']) {
      expect(entry(code)?.pitchFeed, code).toBeUndefined();
      expect(entry(code)?.description, code).toMatch(/lead|pitch/i);
    }
    // The drilling, boring and turning cycles have no lead: their feed is an ordinary feed.
    for (const code of ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89', 'CYCLE92', 'CYCLE93', 'CYCLE95', 'CYCLE930', 'CYCLE951', 'CYCLE952']) {
      expect(entry(code)?.pitchFeed, code).toBeUndefined();
    }
    // On this control the lead of a `G33` block is in `I`, `J` or `K`, not in `F` (§8.5 and
    // the M8 brief): anything that ever scales an arc centre has to skip such a block.
    expect(entry('G33')?.description).toMatch(/lead, given in I, J or K/);
    expect(db.addresses.K.label).toMatch(/thread lead/);
    expect(db.addresses.I.label).toMatch(/thread lead/);
  });

  // Owner decision of 2026-09-27: the speed of a tap is not scaled. CYCLE84 taps with its
  // lead as an argument, so it is tapping without pitchFeed; G33 is threading.
  it('marks the tapping codes, and no threading code, as tapping', () => {
    expect(codesWith((e) => e.tapping === true)).toEqual(['CYCLE84', 'CYCLE840', 'G331', 'G332', 'G63']);
    expect(entry('CYCLE84')?.pitchFeed).toBeUndefined();
    for (const code of ['G33', 'G34', 'G35', 'G335', 'G336', 'CYCLE97', 'CYCLE99']) {
      expect(entry(code)?.tapping, code).toBeUndefined();
    }
  });

  it('marks G4 as the one code whose F is a time, and says its S is not a speed', () => {
    expect(codesWith((e) => e.fNotFeed === true)).toEqual(['G4']);
    expect(entry('G4')?.group).toBe('nonmodal');
    expect(entry('G4')?.description).toMatch(/in seconds/);
    expect(entry('G4')?.description).toMatch(/S is not a speed/);
    // The dwell is `F` here, never `P` as on a Fanuc control (§4.6 of the notes).
    expect(entry('G4')?.description).not.toMatch(/\bP\b/);
    expect(db.addresses.F.description).toMatch(/G4 it is a dwell/);
    expect(db.addresses.S.description).toMatch(/G4 it is a dwell in spindle revolutions/);
  });

  it('claims no second meaning for a code that has only one here', () => {
    // `pitchFeedAmbiguous` says "this number is a threading cycle in another G-code
    // system of this dialect". Sinumerik has no second system, so nothing carries it.
    expect(codesWith((e) => e.pitchFeedAmbiguous === true)).toEqual([]);
  });

  it('names LIMS a limit in the address list too', () => {
    expect(db.addresses.LIMS.description).toMatch(/limit, not a speed/);
  });
});

describe('the cycles', () => {
  const DRILLING = ['CYCLE81', 'CYCLE82', 'CYCLE83', 'CYCLE84', 'CYCLE840', 'CYCLE85', 'CYCLE86', 'CYCLE87', 'CYCLE88', 'CYCLE89'];
  const unitOf = (code: string, address: string) => entry(code)?.params?.find((p) => p.address === address)?.unit;

  it('start with the five every drilling cycle shares, in the order the control reads them', () => {
    for (const code of DRILLING) {
      const params = entry(code)?.params ?? [];
      expect(params.slice(0, 5).map((p) => p.address), code).toEqual(['RTP', 'RFP', 'SDIS', 'DP', 'DPR']);
      for (const param of params) expect(param.label.length, `${code} ${param.address}`).toBeGreaterThan(0);
    }
    // P10 (R8): the arguments a newer control writes after these are described too, so that
    // address arithmetic can tell a mode argument at 0 from one that changes the positions.
    expect(entry('CYCLE83')?.params?.map((p) => p.address)).toEqual([
      'RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'FDEP', 'FDPR', '_DAM', 'DTB', 'DTS', 'FRF', 'VARI',
      '_AXN', '_MDEP', '_VRT', '_DTD', '_DIS1', '_GMODE', '_DMODE', '_AMODE',
    ]);
    expect(entry('CYCLE84')?.params?.map((p) => p.address)).toEqual([
      'RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'DTB', 'SDAC', 'MPIT', 'PIT', 'POSS', 'SST', 'SST1',
      '_AXN', '_PITA', '_TECHNO', '_VARI', '_DAM', '_VRT', '_PITM', '_PTAB', '_PTABA', '_GMODE', '_DMODE', '_AMODE',
    ]);
  });

  it('reads a dwell as a time and a mode code as a plain number, and leaves positions as written', () => {
    // A cycle takes its values in brackets, by position, as numbers of the program's unit:
    // no machine setting that counts a point-less `X50` in increments applies to them. A
    // length or angle class would let a hypothetical increment preset turn RTP 5 into
    // 0.005 mm, so the positions carry none.
    for (const code of DRILLING) {
      for (const address of ['RTP', 'RFP', 'SDIS', 'DP', 'DPR']) expect(unitOf(code, address), `${code} ${address}`).toBeUndefined();
    }
    expect(unitOf('CYCLE86', 'POSS')).toBeUndefined();
    expect(unitOf('CYCLE82', 'DTB')).toBe('dwell');
    expect(unitOf('CYCLE83', 'DTS')).toBe('dwell');
    // A mode code is a number the control looks up, not a distance: `count` is what stops
    // every reading rule from touching it (§7.2, AD-31).
    expect(unitOf('CYCLE83', 'VARI')).toBe('count');
    expect(unitOf('CYCLE86', 'SDIR')).toBe('count');
    expect(unitOf('CYCLE840', 'ENC')).toBe('count');
    expect(unitOf('CYCLE84', 'SDAC')).toBe('count');
    // A thread pitch has no class at all, so no machine setting can rescale it; the
    // `pitchFeed` flag on the entry is what keeps a script off the whole block.
    expect(unitOf('CYCLE84', 'PIT')).toBeUndefined();
    expect(unitOf('CYCLE84', 'MPIT')).toBeUndefined();
    const units = new Set(ENTRIES.flatMap((e) => (e.params ?? []).map((p) => p.unit)).filter((u) => u !== undefined));
    // M9 (WP9.5a): the leads of the thread codes (`G33` and its kin take theirs from I, J
    // or K; `G34`/`G35` have the change of the lead in F) are declared as what they are, a
    // feed per revolution, so their I, J and K are no arc centres. The cycle pitch `PIT`
    // above is an argument and stays without a class.
    expect([...units].sort()).toEqual(['count', 'dwell', 'feedPerRev']);
    expect(
      ENTRIES.filter((e) => (e.params ?? []).some((p) => p.unit === 'feedPerRev')).map((e) => e.code),
    ).toEqual(['G33', 'G331', 'G332', 'G34', 'G35', 'G335', 'G336']);
    // CYCLE81 has a dwell too, and a dwell of the drilling cycles is seconds when positive
    // and spindle revolutions when negative.
    expect(entry('CYCLE81')?.params?.map((p) => p.address)).toEqual(['RTP', 'RFP', 'SDIS', 'DP', 'DPR', 'DTB', '_GMODE', '_DMODE', '_AMODE']);
    expect(entry('CYCLE81')?.params?.[5].label).toMatch(/revolutions when negative/);
  });

  it('lists the feeds of the turning cycles where a script can find them', () => {
    // A program cut by CYCLE95 or CYCLE952 carries its feeds as arguments: the parameter
    // labels are what scale feed lists them by (a label that names a feed).
    const feeds = (code: string) => (entry(code)?.params ?? []).filter((p) => /\bfeed\b(?!\s+factor)/i.test(p.label)).map((p) => p.address);
    expect(feeds('CYCLE95')).toEqual(['FF1', 'FF2', 'FF3']);
    expect(feeds('CYCLE951')).toEqual(['_FF1']);
    // CYCLE952 has a third feed at the very end, for the finishing cut of a call that roughs
    // and finishes.
    expect(feeds('CYCLE952')).toEqual(['_F', '_FR', '_FS']);
    expect(entry('CYCLE952')?.params?.map((p) => p.address).indexOf('_FS')).toBe(33);
    expect(feeds('CYCLE930')).toEqual(['_FF1']);
    expect(feeds('CYCLE92')).toEqual(['_FF1', '_FF2']);
    expect(feeds('CYCLE99')).toEqual([]);
    expect(entry('CYCLE95')?.label).toMatch(/stock removal/i);
    expect(entry('CYCLE930')?.label).toMatch(/groov/i);
    expect(entry('CYCLE99')?.label).toMatch(/thread/i);
    expect(entry('CYCLE99')?.label).not.toMatch(/undercut|relief/i);
    // Not in the 4.92 cycle list: recognised by name, parameters not described.
    for (const code of ['CYCLE93', 'CYCLE97']) {
      expect(entry(code)?.params, code).toBeUndefined();
      expect(entry(code)?.description, code).toMatch(/not described yet/);
      expect(entry(code)?.verify, code).toBe(true);
    }
  });
});

describe('what is confirmed and what is not', () => {
  it('leaves marked for verification only what the manual does not settle', () => {
    // The 840D sl programming manual (06/2019) settles the G groups, the cycles of its 4.92
    // list and the language. What it only lists, what the machine sets up and the cycles
    // it does not describe stay out of hover (§8.7 items 3 and 6). The flags a script
    // reads — `pitchFeed`, `sets` — work regardless.
    expect(codesWith((e) => e.verify === true)).toEqual(['CYCLE93', 'CYCLE97', 'G942', 'G952', 'M19', 'M6']);
  });

  it('shows what the notes tag [M], what DIN 66025 fixes and what the owner decided', () => {
    // The turning core: a hover that stayed silent on `G18` or `G95` would be useless.
    const shown = [
      'G0', 'G1', 'G2', 'G3', 'G4', 'G17', 'G18', 'G19', 'G25', 'G26', 'G33', 'G34', 'G35', 'G63', 'G331', 'G332', 'G40',
      'G41', 'G42', 'G53', 'G153', 'G54', 'G500', 'G70', 'G71', 'G90', 'G91', 'G93', 'G94', 'G95', 'G96', 'G97', 'G961',
      'G971', 'DIAMON', 'DIAMOF', 'DIAM90', 'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M8', 'M9', 'M17', 'M30', 'MSG', 'STOPRE',
      'SETMS', 'IF', 'ELSE', 'ENDIF', 'GOTOF', 'GOTOB', 'GOTO', 'EXTERN', 'AND', 'OR', 'CYCLE81', 'CYCLE83', 'CYCLE84',
      'CYCLE840', 'CYCLE95', 'CYCLE99', 'MCALL', 'RET', 'PROC',
    ];
    for (const code of shown) expect(entry(code)?.verify, code).toBeUndefined();
  });

  it('keeps a claim the notes mark for verification out of the text that is always shown', () => {
    // An address has no `verify` flag, so what it says is always in hover. That leading
    // zeros are part of an L number is settled by the manual; the G43 remark is not.
    expect(db.addresses.L.description).toMatch(/leading zeros/);
    expect(db.addresses.D.description).not.toMatch(/G43/);
    // An operator message is where posts often put the operation name — which the notes
    // mark for verification, so the shown text does not claim it.
    expect(entry('MSG')?.description).not.toMatch(/operation/i);
    for (const code of ['G90', 'G91']) expect(entry(code)?.description, code).not.toMatch(/AC\(|IC\(/);
    expect(entry('GOTOF')?.description).not.toMatch(/block number/);
  });
});
