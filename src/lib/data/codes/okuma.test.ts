// What the shipped Okuma OSP database says (plan §8.4, AD-19, AD-31; gate G10 §8.7 items 3
// and 5a). Owner: WP8.3.
//
// Every assertion here decides what the editor tells a machinist, and most of them decide
// whether a program survives a script. This control reuses the Fanuc numbers for other
// things, and each of those is a trap:
//
//   - `G71`/`G72` are **thread** cycles here, not roughing cycles: their `F` is a lead.
//   - `G75`/`G76` add a chamfer or a round to a `G01` move; they are not cycles at all.
//   - `G80`–`G88` define and call the automatic roughing (LAP); `G80` cancels nothing.
//   - `G20`/`G21` return to a home position; they do not switch inch and millimetres.
//   - `G04` takes its time in `F`, so the `F` of a dwell block is not a feed.
//   - `U`/`W` are allowances, and `SB=` is the driven-tool spindle, not the main one.
//   - `M98`/`M99` set the pushing force of the tailstock quill; they call and end nothing
//     (G10 M8). `G92` has no function at all, and is a thread pass on a Fanuc lathe.
//
// `pitchFeed` on the wrong entry, or missing from the right one, scraps a thread, so those
// lists are written out in full and compared, not spot-checked. The parameter units are
// written out the same way: they are what AD-31 reads first when it decides what a number
// is worth in the machine's unit system (syntax-okuma.md §3.3).
//
// The file form comes through `resolveCodeDbFiles` (AD-17), so it is the merge result the
// app uses that is checked, and the loaded form through `loadCodeDb`.

import { describe, expect, it } from 'vitest';
import okumaJson from '$lib/data/codes/okuma.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { numberClassOf } from '$lib/core/machines/numbers';
import { t } from '$lib/i18n';
import { loadCodeDb, type CodeDbProblem } from '$lib/core/codes/load';
import { lookupCode, normalizeCode } from '$lib/core/codes/lookup';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { CodeDb, CodeEntry, CodeParam } from '$lib/core/codes/types';
import type { FeedUnit, Profile } from '$lib/core/profiles/types';

const DIALECT = 'okuma';

const problems: CodeDbProblem[] = [];
const db: CodeDb = loadCodeDb(okumaJson, (p) => problems.push(p));

const fileProblems: string[] = [];
const FILES = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, p) =>
  fileProblems.push(`${dialect}: ${p.path}: ${p.message}`),
);

/** The resolved entries as they are written in JSON, codes normalised. */
const ENTRIES: CodeEntry[] = ((FILES[DIALECT]?.codes ?? []) as CodeEntry[]).map((entry) => ({
  ...entry,
  code: normalizeCode(entry.code),
}));

function entry(code: string): CodeEntry {
  const found = ENTRIES.find((e) => e.code === normalizeCode(code));
  if (!found) throw new Error(`no entry ${code}`);
  return found;
}

const codesWith = (predicate: (e: CodeEntry) => boolean): string[] =>
  ENTRIES.filter(predicate)
    .map((e) => e.code)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const range = (from: number, to: number, prefix = 'G'): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

const OKUMA_PROFILE: Profile = (() => {
  const raw = BUILTIN_PROFILE_JSON.find((p) => (p as { id?: string }).id === 'okuma-osp');
  const checked = validateProfile(raw);
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return checked.profile;
})();

/** The modal group names §7.2 fixes; a modal entry may use no other. */
const MODAL_GROUPS = [
  'motion',
  'plane',
  'units',
  'distance',
  'feedmode',
  'spindlemode',
  'spindle',
  'coolant',
  'compensation',
  'lengthComp',
  'offset',
  'cycle',
  'cyclereturn',
  'diametermode',
];

describe('the shipped Okuma database', () => {
  it('loads and resolves without a single problem', () => {
    expect(problems).toEqual([]);
    expect(fileProblems).toEqual([]);
    expect(db.dialect).toBe(DIALECT);
    // It stands on its own: sharing numbers with the Fanuc databases is exactly what it
    // must not do, so it extends nothing (AD-17).
    expect((FILES[DIALECT] as { extends?: string }).extends).toBeUndefined();
    expect(db.codes.length).toBe(ENTRIES.length);
  });

  it('has no duplicate code and no duplicate alias', () => {
    const keys = ENTRIES.flatMap((e) => [e.code, ...(e.aliases ?? []).map(normalizeCode)]);
    expect(new Set(keys).size, keys.filter((key, i) => keys.indexOf(key) !== i).join(', ')).toBe(keys.length);
  });

  it('gives every entry and every address a label, and every parameter one too', () => {
    for (const e of ENTRIES) {
      expect(e.label?.length, e.code).toBeGreaterThan(0);
      expect(e.code, e.code).toBe(e.code.toUpperCase());
      for (const param of e.params ?? []) expect(param.label.length, `${e.code} ${param.address}`).toBeGreaterThan(0);
    }
    for (const [letter, address] of Object.entries(db.addresses)) {
      expect(address.label.length, letter).toBeGreaterThan(0);
    }
  });

  it('puts every modal code in a modal group §7.2 names', () => {
    for (const e of ENTRIES.filter((row) => row.modal)) {
      expect(MODAL_GROUPS, `${e.code} is modal in "${String(e.group)}"`).toContain(e.group);
    }
    // The profile's machine may set the power-on code of exactly these groups (§8.8).
    for (const group of OKUMA_PROFILE.machineParams?.modalGroups ?? []) {
      expect(ENTRIES.some((e) => e.modal && e.group === group), group).toBe(true);
    }
  });

  it('names every group hover shows', () => {
    // A code the owner has not confirmed never reaches hover (WP3.6), so its group needs no
    // message yet. Since G10 M8 the turret selection and the LAP codes are confirmed by the
    // manual and shown, so their groups have to be named like every other.
    for (const e of ENTRIES) {
      if (e.group === undefined) continue;
      const key = `assistant.group.${e.group}`;
      if (e.verify) continue;
      expect(t(key), `${e.code} is in group "${e.group}"`).not.toBe(key);
    }
    for (const group of ['turret', 'lap', 'pathmode']) {
      const shown = ENTRIES.filter((e) => e.group === group && e.verify !== true);
      expect(shown.length, group).toBeGreaterThan(0);
    }
  });

  it('describes every keyword the profile tokenizes', () => {
    const cp = compileProfile(OKUMA_PROFILE);
    const missing = (cp.profile.syntax.keywords ?? []).filter((keyword) => lookupCode(db, keyword) === null);
    expect(missing, 'keywords without an entry').toEqual([]);
  });

  it('ships the lathe subset of §8.4', () => {
    const codes = new Set(ENTRIES.map((e) => e.code));
    const expected = [
      'G0', 'G1', 'G2', 'G3', 'G4', 'G13', 'G14', 'G20', 'G21', ...range(31, 35),
      'G40', 'G41', 'G42', 'G50', 'G64', 'G65', ...range(71, 78), ...range(80, 88),
      'G90', 'G91', 'G94', 'G95', 'G96', 'G97', ...range(180, 189),
      'CALL', 'RTS', 'GOTO', 'IF', 'MODIN', 'MODOUT',
    ];
    expect(expected.filter((code) => !codes.has(code))).toEqual([]);
  });

  it('ships every M code of syntax-okuma.md §4.2, under its own meaning', () => {
    const expected = [
      'M0', 'M1', 'M2', 'M30', 'M3', 'M4', 'M5', 'M6', 'M8', 'M9', 'M12', 'M13', 'M14', 'M15', 'M16',
      'M17', 'M19', 'M22', 'M23', 'M24', 'M25', 'M26', 'M27', 'M32', 'M33', 'M34', ...range(40, 44, 'M'),
      'M48', 'M49', 'M55', 'M56', 'M60', 'M61', 'M73', 'M74', 'M75', 'M83', 'M84', 'M88', 'M89',
      'M98', 'M99', 'M109', 'M110', 'M146', 'M147',
    ];
    const codes = new Set(ENTRIES.map((e) => e.code));
    expect(expected.filter((code) => !codes.has(code))).toEqual([]);
    // Nothing a machine builder numbers for themselves: every other M number stays "machine
    // specific" in hover, never an error and never a guess (§8 header).
    expect(codesWith((e) => e.code.startsWith('M') && /^M\d+$/.test(e.code) && !expected.includes(e.code))).toEqual([]);
  });

  it('names no control maker and no machine builder in what it shows', () => {
    const brands = /\b(?:okuma|fanuc|siemens|sinumerik|heidenhain|mazak|dmg|haas|doosan|nakamura|traub|emco|biglia|mitsubishi|hurco|hardinge|tsugami)\b/i;
    const texts = [
      ...ENTRIES.flatMap((e) => [e.label, e.description ?? '', ...(e.params ?? []).map((p) => p.label)]),
      ...Object.values(db.addresses).flatMap((a) => [a.label, a.description ?? '']),
    ];
    expect(texts.filter((text) => brands.test(text))).toEqual([]);
  });
});

describe('the numbers this control uses for something else', () => {
  it('reads G71 and G72 as thread cycles whose F is a lead', () => {
    for (const code of ['G71', 'G72']) {
      expect(entry(code).pitchFeed, code).toBe(true);
      expect(entry(code).group, code).toBe('cycle');
      expect(entry(code).sets, code).toEqual({ cycle: 'start' });
    }
    expect(entry('G71').description).toMatch(/not a roughing cycle/);
  });

  it('reads G75 and G76 as a chamfer and a round of a G01 move, not as cycles', () => {
    for (const code of ['G75', 'G76']) {
      expect(entry(code).group, code).toBe('nonmodal');
      expect(entry(code).modal, code).toBeUndefined();
      expect(entry(code).sets, code).toBeUndefined();
      expect(entry(code).pitchFeed, code).toBeUndefined();
    }
    expect(entry('G75').description).toMatch(/not a grooving cycle/);
    expect(entry('G76').description).toMatch(/not a threading cycle here/);
  });

  it('reads G80 to G88 as the LAP shape and its calls, which cancel and drill nothing', () => {
    for (const code of range(80, 88)) {
      expect(entry(code).group, code).toBe('lap');
      expect(entry(code).sets, code).toBeUndefined();
      expect(entry(code).modal, code).toBeUndefined();
      // G10 M8: the manual describes LAP in full (its Section 8), so hover shows it.
      expect(entry(code).verify, code).toBeUndefined();
    }
    // The change of cutting conditions stands on the `$` lines of the G85 block, and its
    // new feeds are FA= and FB=, not F (syntax-okuma.md §3.1, §6.4).
    expect(entry('G84').description).toMatch(/starts with \$ and continues the G85 block/);
    expect((entry('G84').params ?? []).map((p) => p.address)).toEqual(['XA', 'ZA', 'DA', 'FA', 'XB', 'ZB', 'DB', 'FB']);
    expect(entry('G85').description).toMatch(/start with \$/);
    expect(entry('G80').description).toMatch(/does not cancel a drilling cycle/);
    for (const code of ['G81', 'G82', 'G83']) expect(entry(code).description, code).toMatch(/not a drilling cycle/);
    // G89 is no code of this control at all.
    expect(ENTRIES.some((e) => e.code === 'G89')).toBe(false);
  });

  it('reads G20 and G21 as home returns, and has no inch/metric code at all', () => {
    expect(entry('G20').description).toMatch(/not the inch switch/);
    expect(entry('G21').description).toMatch(/not the metric switch/);
    // The unit is the machine's parameter on this control (§8.8), never a program's code.
    expect(codesWith((e) => e.sets?.units !== undefined)).toEqual([]);
  });

  it('has no work-offset codes: the zero point lives in the control and G50 shifts it', () => {
    for (const code of range(54, 59)) expect(ENTRIES.some((e) => e.code === code), code).toBe(false);
    expect(entry('G50').description).toMatch(/shifts the zero point/);
  });
});

describe('what a code does to the modal state', () => {
  it('switches the distance mode, the feed unit and the speed unit', () => {
    expect(entry('G90').sets).toEqual({ distance: 'absolute' });
    expect(entry('G91').sets).toEqual({ distance: 'incremental' });
    expect(entry('G94').sets).toEqual({ feedUnit: 'per-minute' });
    expect(entry('G95').sets).toEqual({ feedUnit: 'per-rev' });
    expect(entry('G96').sets).toEqual({ speedUnit: 'surface' });
    expect(entry('G97').sets).toEqual({ speedUnit: 'rpm' });
    for (const code of ['G90', 'G91', 'G94', 'G95', 'G96', 'G97']) expect(entry(code).modal, code).toBe(true);
    // Nothing on this control switches the plane in a way the notes confirm. Diameter
    // programming is switched off by coordinate conversion (G137) and the Y-axis mode
    // (G138), where X is a radius, and back on by G136 (source review 2026-09, §4.1).
    expect(codesWith((e) => e.sets?.plane !== undefined)).toEqual([]);
    expect(codesWith((e) => e.sets?.diameter !== undefined)).toEqual(['G136', 'G137', 'G138']);
    expect(entry('G136').sets).toEqual({ diameter: 'on' });
    for (const code of ['G137', 'G138']) expect(entry(code).sets, code).toEqual({ diameter: 'off' });
    for (const code of ['G136', 'G137', 'G138']) {
      expect(entry(code).modal, code).toBe(true);
      expect(entry(code).group, code).toBe('diametermode');
    }
  });

  it('marks G50 as the spindle clamp, and nothing else', () => {
    expect(codesWith((e) => e.sets?.speedLimit === true)).toEqual(['G50']);
    expect(entry('G50').group).toBe('nonmodal');
  });

  it('keeps the moves and the thread passes in one modal group', () => {
    // A thread pass is a mode: the blocks after `G33 X29.4 Z-30 F2` that only change X cut
    // the next passes (syntax-okuma.md §6.2). `G00` or `G01` ends it. The synchronized feed
    // G36/G37 and the arc threads G112/G113 are motions of the same kind (G10 M8).
    expect(codesWith((e) => e.group === 'motion')).toEqual(['G0', 'G1', 'G2', 'G3', ...range(31, 37), 'G112', 'G113']);
    for (const code of codesWith((e) => e.group === 'motion')) expect(entry(code).modal, code).toBe(true);
  });

  it('starts a cycle on every cycle entry and cancels the driven-tool cycles with G180', () => {
    expect(codesWith((e) => e.sets?.cycle === 'start')).toEqual([
      'G71', 'G72', 'G73', 'G74', 'G77', 'G78', 'G107', 'G108', 'G178', 'G179',
      ...range(181, 191),
    ]);
    expect(codesWith((e) => e.sets?.cycle === 'cancel')).toEqual(['G180']);
    // The turning cycles run once from their block; the driven-tool cycles repeat at every
    // following position until G180 (§6.3 of the notes).
    for (const code of ['G71', 'G72', 'G73', 'G74', 'G77', 'G78']) expect(entry(code).modal, code).toBeUndefined();
    for (const code of ['G107', 'G108', 'G178', 'G179', 'G180', ...range(181, 191)]) {
      expect(entry(code).modal, code).toBe(true);
      expect(entry(code).group, code).toBe('cycle');
    }
  });
});

describe('the words a script must not scale', () => {
  it('marks every thread and tapping code as pitchFeed, and nothing else', () => {
    expect(codesWith((e) => e.pitchFeed === true)).toEqual([
      ...range(31, 37), 'G71', 'G72', 'G77', 'G78', 'G107', 'G108', 'G112', 'G113', 'G178', 'G179', ...range(184, 188),
    ]);
    for (const code of codesWith((e) => e.pitchFeed === true)) {
      expect(['motion', 'cycle'], code).toContain(entry(code).group);
    }
  });

  // Owner decision of 2026-09-27: the speed of a tap is not scaled. The OSP manuals name
  // G77/G78 (compound tapping), G107/G108 (spindle synchronized tapping), G178/G179 and
  // G184 (driven-tool tapping) and G36/G37 (synchronized tapping of the driven tool); the
  // driven-tool threads G185–G188 and the thread passes are threading, not tapping.
  it('marks the tapping codes, and no threading code, as tapping', () => {
    expect(codesWith((e) => e.tapping === true)).toEqual([
      'G36', 'G37', 'G77', 'G78', 'G107', 'G108', 'G178', 'G179', 'G184',
    ]);
    for (const code of codesWith((e) => e.tapping === true)) {
      expect(entry(code).pitchFeed, code).toBe(true);
    }
  });

  it('refuses the F of a code that is a thread or a tap on other lathe controls', () => {
    // A Fanuc lathe program opened as Okuma — a `.MIN` file decides on its extension — would
    // otherwise have the lead of its G76 threading cycle scaled as a corner-round feed.
    // G10 M8: and of its G92 thread passes, a code this control does not assign at all.
    expect(codesWith((e) => e.pitchFeedAmbiguous === true)).toEqual(['G76', 'G84', 'G88', 'G92']);
    // 2026-09 (review finding NC1): G84 is the tapping cycle of the machining centres, whose
    // programs open with this profile (their `G15 H`/`G56 H` offsets), and G88 a tapping
    // cycle on other lathe controls. Their feed is refused, so their speed is left too;
    // G76 and G92 are threads elsewhere, whose speed stays scaled with a warning.
    expect(codesWith((e) => e.tappingElsewhere === true)).toEqual(['G84', 'G88']);
    expect(entry('G92').label).toBe('Not assigned on this control');
    expect(entry('G92').group).toBeUndefined();
    expect(entry('G92').modal).toBeUndefined();
    expect(entry('G92').verify).toBeUndefined();
  });

  it('reads the tailstock codes M98 and M99 as what they are here, not as a call and a return', () => {
    // G10 M8: a misdetected file used to show them as subprogram calls, and hover here said
    // nothing. On this control a subprogram is CALL and RTS.
    for (const code of ['M98', 'M99']) {
      expect(entry(code).label, code).toMatch(/^Tailstock quill/);
      expect(entry(code).verify, code).toBeUndefined();
      expect(entry(code).group, code).toBeUndefined();
    }
    expect(entry('M98').description).toMatch(/not a subprogram call/);
    expect(entry('M99').description).toMatch(/does not end a subprogram/);
    // M17 is an optional function; the lathe manual of 2020 describes it (source review).
    expect(entry('M17').verify).toBeUndefined();
    expect(entry('M17').description).toMatch(/does not end a subprogram/);
  });

  it('keeps the optional synchronized and arc-thread feeds away from the feed script', () => {
    // G36/G37 tie the feed to the driven tool, G112/G113 cut a thread along an arc. Their
    // F is never scaled. The special-functions manual gives the format of G112/G113, so
    // they are shown; no manual gives the format of G36/G37, so they stay out of hover.
    for (const code of ['G36', 'G37', 'G112', 'G113']) {
      expect(entry(code).pitchFeed, code).toBe(true);
      expect(entry(code).modal, code).toBe(true);
      expect(entry(code).group, code).toBe('motion');
    }
    for (const code of ['G36', 'G37']) expect(entry(code).verify, code).toBe(true);
    for (const code of ['G112', 'G113']) expect(entry(code).verify, code).toBeUndefined();
  });

  it('names the spindle selection of multi-spindle machines without making it a spindle state', () => {
    // G140-G143 decide which spindle the following words drive (compare Sinumerik SETMS).
    // Not modal: a modal entry in `spindle` would replace M3 as the main spindle's state.
    for (const code of ['G140', 'G141', 'G142', 'G143']) {
      expect(entry(code).group, code).toBe('spindle');
      expect(entry(code).modal, code).toBeUndefined();
    }
    // The multi-tasking operation manual describes G140/G141; G142/G143 appear only in the
    // code table of the older lathe manual (source review 2026-09).
    for (const code of ['G140', 'G141']) expect(entry(code).verify, code).toBeUndefined();
    for (const code of ['G142', 'G143']) expect(entry(code).verify, code).toBe(true);
  });

  it('marks G4 as the one code whose F is a time', () => {
    expect(codesWith((e) => e.fNotFeed === true)).toEqual(['G4']);
    expect(entry('G4').group).toBe('nonmodal');
    expect(entry('G4').description).toMatch(/not a feed/);
    expect(db.addresses.F.description).toMatch(/With G04 it is the dwell time/);
  });

  it('keeps the driven-tool speed away from the main spindle', () => {
    expect(db.addresses.SB.label).toBe('Driven-tool speed');
    expect(db.addresses.SB.description).toMatch(/not of the main spindle/);
    expect(db.addresses.S.description).toMatch(/unit system of the machine does not change it/);
    for (const code of ['M12', 'M13', 'M14']) {
      expect(entry(code).label, code).toMatch(/^Driven-tool spindle/);
      // Not modal: a modal entry would replace `M3` as the state of the *main* spindle.
      expect(entry(code).modal, code).toBeUndefined();
    }
    for (const code of ['M3', 'M4', 'M5']) expect(entry(code).modal, code).toBe(true);
  });

  it('reads U and W as allowances and L as the arc radius', () => {
    expect(db.addresses.U.description).toMatch(/not an incremental move/);
    expect(db.addresses.W.description).toMatch(/not an incremental move/);
    expect(db.addresses.L.description).toMatch(/does not take R/);
    expect(db.addresses.T.description).toMatch(/Four digits .* six digits/);
  });
});

// ---------------------------------------------------------------------------
// The parameter units (AD-31 step 1, syntax-okuma.md §3.3)
// ---------------------------------------------------------------------------
//
// The unit table of the notes gives every kind of word its own unit — lengths `X Z I K D
// H L U W`, feeds `F E`, angles `A B C`, times `F E` — and only the address classes of the
// profile (`X Z C Y`, `I K`) reach a class on their own. Everything else gets it here,
// per code, and this table is the one place it is written down, checked in both
// directions: every parameter it names carries exactly that unit, and no other one does.

type Unit = NonNullable<CodeParam['unit']>;

const DRIVEN_TOOL: Record<string, Unit> = { Q: 'count', E: 'dwell' };

const PARAM_UNITS: Record<string, Record<string, Unit>> = {
  G2: { L: 'length' },
  G3: { L: 'length' },
  G4: { F: 'dwell' },
  G31: { A: 'angle', L: 'length', J: 'count' },
  G32: { A: 'angle', L: 'length', J: 'count' },
  G33: { A: 'angle', L: 'length', J: 'count' },
  G34: { E: 'feedPerRev', J: 'count' },
  G35: { E: 'feedPerRev', J: 'count' },
  G71: { A: 'angle', B: 'angle', D: 'length', U: 'length', H: 'length', L: 'length', E: 'feedPerRev', J: 'count', Q: 'count' },
  G72: { A: 'angle', B: 'angle', D: 'length', W: 'length', H: 'length', L: 'length', E: 'feedPerRev', J: 'count', Q: 'count' },
  G73: { D: 'length', L: 'length', DA: 'length', E: 'dwell' },
  G74: { D: 'length', L: 'length', DA: 'length', E: 'dwell' },
  G75: { L: 'length' },
  G76: { L: 'length' },
  G84: { XA: 'length', ZA: 'length', DA: 'length', XB: 'length', ZB: 'length', DB: 'length' },
  G85: { D: 'length', U: 'length', W: 'length' },
  G86: { D: 'length', U: 'length', W: 'length' },
  G87: { U: 'length', W: 'length' },
  G88: { D: 'length', H: 'length', B: 'angle', U: 'length', W: 'length' },
  G181: DRIVEN_TOOL,
  G182: DRIVEN_TOOL,
  G183: { ...DRIVEN_TOOL, D: 'length', L: 'length' },
  G184: DRIVEN_TOOL,
  G189: DRIVEN_TOOL,
  CALL: { Q: 'count' },
  MODIN: { Q: 'count' },
};

describe('the parameter units', () => {
  it('carries exactly the unit of the table on every parameter, and none elsewhere', () => {
    const found: Record<string, Record<string, Unit>> = {};
    for (const e of ENTRIES) {
      for (const param of e.params ?? []) {
        if (param.unit === undefined) continue;
        (found[e.code] ??= {})[param.address] = param.unit;
      }
    }
    expect(found).toEqual(PARAM_UNITS);
  });

  it('uses no micron parameter: this control has none', () => {
    // `increment` is the Fanuc cycles' micron step (§8.2); here every length is read in the
    // machine's unit system like any other.
    expect(codesWith((e) => (e.params ?? []).some((p) => p.unit === 'increment'))).toEqual([]);
  });

  /** The class AD-31 gives `address` in a block of `codes` under `feedUnit`. */
  function classOf(address: string, codes: string[], feedUnit: FeedUnit = 'per-rev'): string | null {
    const blockCodes = codes.map((code) => {
      const found = lookupCode(db, code);
      if (!found) throw new Error(`no entry ${code}`);
      return found;
    });
    return numberClassOf(address, { profile: OKUMA_PROFILE, feedUnit, blockCodes, pitchFeed: false });
  }

  it.each([
    // Lengths: the profile's axes and arc centres on their own, the rest through a code.
    ['X', [], 'length'],
    ['Z', [], 'length'],
    ['I', [], 'length'],
    ['K', ['G77'], 'length'],
    ['D', ['G71'], 'length'],
    ['H', ['G72'], 'length'],
    ['L', ['G2'], 'length'],
    ['U', ['G71'], 'length'],
    ['W', ['G72'], 'length'],
    ['DA', ['G74'], 'length'],
    ['R', ['G181'], 'length'],
    // Feeds, by the feed mode — and a thread lead is per revolution whatever it says.
    ['F', [], 'feedPerRev'],
    ['E', ['G34'], 'feedPerRev'],
    // Angles.
    ['C', [], 'angle'],
    ['A', ['G71'], 'angle'],
    ['B', ['G71'], 'angle'],
    // Times: the F of G04 and the E of a cycle bottom.
    ['F', ['G4'], 'dwell'],
    ['E', ['G74'], 'dwell'],
    ['E', ['G181'], 'dwell'],
    // Counts, which no unit system touches.
    ['Q', ['CALL'], 'count'],
    ['Q', ['G181'], 'count'],
    ['J', ['G33'], 'count'],
    // No class at all: never converted.
    ['S', [], null],
    ['SB', [], null],
    ['SA', ['G185'], null],
    ['T', ['G74'], null],
    ['P', [], null],
    ['E', [], null],
  ] as const)('%s in a block of %j reads as %s', (address, codes, expected) => {
    expect(classOf(address, [...codes])).toBe(expected);
  });

  it('reads F by the feed mode, and as a lead in a thread block whatever the mode', () => {
    expect(classOf('F', [], 'per-minute')).toBe('feedPerMin');
    expect(classOf('F', ['G181'], 'per-minute')).toBe('feedPerMin');
    expect(classOf('F', ['G33'], 'per-minute')).toBe('feedPerRev');
    expect(classOf('F', ['G71'], 'per-minute')).toBe('feedPerRev');
    expect(classOf('F', [], 'unknown')).toBeNull();
    // The dwell is a time under any feed mode.
    expect(classOf('F', ['G4'], 'per-minute')).toBe('dwell');
  });
});

describe('what is confirmed and what is not', () => {
  it('marks for verification exactly what the notes do not settle', () => {
    // G10 M8: the manual settles the turret selection (its Section 11), droop control
    // (Section 4), LAP (Section 8), the turret the constant cutting speed follows, and the
    // driven-tool tapping and threading cycles (Section 7 §8). The source review (2026-09)
    // read the 2020 lathe manual and two option manuals, which settle G17-G21, G112/G113,
    // G140/G141, G190/G191, M17 and the schedule and serial-line statements. Left: the
    // format of G36/G37, the modality of G107/G108, and G142/G143, which only the older
    // code table names.
    expect(codesWith((e) => e.verify === true)).toEqual(['G36', 'G37', 'G107', 'G108', 'G142', 'G143']);
  });

  it('keeps the turning core in hover', () => {
    // The words of every program the notes show (§2.1, §6): a hover that stayed silent on
    // G71 or G95 would be no help where help matters most.
    for (const code of [
      'G0', 'G1', 'G2', 'G3', 'G4', 'G33', 'G40', 'G42', 'G50', 'G71', 'G74', 'G77', 'G90', 'G94', 'G95',
      'G96', 'G97', 'G180', 'G181', 'G183', 'G184', 'M3', 'M8', 'M13', 'M110', 'CALL', 'RTS', 'GOTO', 'IF',
      // G10 M8: confirmed by the manual.
      'G13', 'G14', 'G64', 'G65', 'G81', 'G84', 'G85', 'G87', 'G88', 'G92', 'G110', 'G111', 'G178', 'G185', 'M98', 'M99',
    ]) {
      expect(entry(code).verify, code).toBeUndefined();
    }
  });
});
