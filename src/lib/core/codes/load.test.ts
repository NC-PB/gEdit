// The loader and the shipped databases (plan §5, WP3.3). Owner: WP3.3.
//
// Two jobs here: the built-in files must come through without a single problem, and a
// hand-written user database must lose only the broken parts, never the whole file.

import { describe, expect, it } from 'vitest';
import fanucJson from '$lib/data/codes/fanuc.json';
import heidenhainJson from '$lib/data/codes/heidenhain.json';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import { compileProfile } from '$lib/core/profiles/compile';
import { detectProfile } from '$lib/core/profiles/detect';
import { validateProfile } from '$lib/core/profiles/validate';
import { tokenizeLine } from '$lib/core/nc/tokenizer';
import { t } from '$lib/i18n';
import { editorText, listFixtures, openFixture } from '../../../../tests/unit/helpers/fixtures';
import { CodeDbError, emptyCodeDb, loadCodeDb, type CodeDbProblem } from './load';
import { resolveCodeDbs } from './resolve';
import { unionCodeDb, variantDialects } from '$lib/monaco/languages';
import { lookupCode } from './lookup';
import type { CompiledProfile } from '$lib/core/profiles/types';
import type { LineState } from '$lib/core/nc/types';
import type { CodeDb } from './types';

/** Loads a database and hands back everything the loader had to say about it. */
function load(raw: unknown): { db: CodeDb; problems: CodeDbProblem[] } {
  const problems: CodeDbProblem[] = [];
  const db = loadCodeDb(raw, (p) => problems.push(p));
  return { db, problems };
}

const fanuc = load(fanucJson);
const heidenhain = load(heidenhainJson);

describe('built-in code databases', () => {
  it('ships one database per dialect, keyed by profile.codes', () => {
    // M6 adds the two Fanuc lathe databases: the system-A one a lathe document reads, and
    // the system-B variant a machine can switch to (AD-17, AD-31).
    expect(Object.keys(BUILTIN_CODE_DB_JSON).sort()).toEqual([
      'fanuc',
      'fanuc-lathe',
      'fanuc-lathe-b',
      'heidenhain',
    ]);
    expect(fanuc.db.dialect).toBe('fanuc');
    expect(heidenhain.db.dialect).toBe('heidenhain');
  });

  it('loads without a single problem', () => {
    expect(fanuc.problems).toEqual([]);
    expect(heidenhain.problems).toEqual([]);
  });

  // M6: the loader used to drop `sets`, so the data said one thing and `codes.byId()`
  // another. The interpreter reads the loaded database, not the file (AD-19).
  it('carries what a code sets through to the loaded database', () => {
    const setsOf = (db: CodeDb, code: string) => db.codes.find((entry) => entry.code === code)?.sets;
    expect(setsOf(fanuc.db, 'G94')).toEqual({ feedUnit: 'per-minute' });
    expect(setsOf(fanuc.db, 'G21')).toEqual({ units: 'mm' });
    expect(setsOf(fanuc.db, 'G18')).toEqual({ plane: 'ZX' });
    expect(setsOf(fanuc.db, 'G91')).toEqual({ distance: 'incremental' });
    expect(setsOf(fanuc.db, 'G80')).toEqual({ cycle: 'cancel' });
    expect(setsOf(fanuc.db, 'G83')).toEqual({ cycle: 'start' });
    expect(setsOf(fanuc.db, 'G50')).toEqual({ speedLimit: true });
    expect(setsOf(fanuc.db, 'G96')).toEqual({ speedUnit: 'surface' });
    expect(setsOf(fanuc.db, 'G0')).toBeUndefined();
  });

  it('has no duplicate code and no duplicate alias', () => {
    for (const { db } of [fanuc, heidenhain]) {
      const keys = db.codes.flatMap((e) => [e.code, ...(e.aliases ?? [])]);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('gives every entry a label and every address a label', () => {
    for (const { db } of [fanuc, heidenhain]) {
      for (const entry of db.codes) {
        expect(entry.label.length, entry.code).toBeGreaterThan(0);
        expect(entry.code).toBe(entry.code.toUpperCase());
      }
      for (const [letter, address] of Object.entries(db.addresses)) {
        expect(address.label.length, letter).toBeGreaterThan(0);
      }
    }
  });

  it('gives every modal code a group, and never one that two modal groups share', () => {
    for (const { db } of [fanuc, heidenhain]) {
      for (const entry of db.codes.filter((e) => e.modal)) {
        expect(entry.group, entry.code).toBeTruthy();
      }
    }
    // The spindle direction (M3/M4/M5) and the spindle speed mode (G96/G97) replace each
    // other only within their own group, so they do not share a group name.
    const spindle = fanuc.db.codes.find((e) => e.code === 'M3')?.group;
    expect(fanuc.db.codes.find((e) => e.code === 'G96')?.group).not.toBe(spindle);
  });

  it('keeps every pitchFeed code in the cycle or motion group', () => {
    for (const { db } of [fanuc, heidenhain]) {
      const pitch = db.codes.filter((e) => e.pitchFeed);
      expect(pitch.length).toBeGreaterThan(0);
      for (const entry of pitch) {
        expect(['cycle', 'motion'], entry.code).toContain(entry.group);
      }
    }
  });

  // G76 is not in the `pitchFeed` list although the plan names it: the entry shipped
  // here is the *mill* fine-boring cycle, whose F is a boring feed. It is in the
  // `pitchFeedAmbiguous` list below instead, which is what a scaling script needs to
  // refuse it while no lathe profile exists.
  it('marks the tapping and threading codes the plan names as pitchFeed', () => {
    const fanucPitch = fanuc.db.codes.filter((e) => e.pitchFeed).map((e) => e.code);
    expect(fanucPitch.sort()).toEqual(['G32', 'G33', 'G74', 'G84']);
    expect(fanuc.db.codes.find((e) => e.code === 'G76')?.pitchFeed).toBeUndefined();

    const klartextPitch = heidenhain.db.codes.filter((e) => e.pitchFeed).map((e) => e.code);
    expect(klartextPitch.sort()).toEqual(['CYCL DEF 206', 'CYCL DEF 207', 'CYCL DEF 209']);
  });

  it('marks the codes whose number is a threading cycle in another G-code system', () => {
    // G8 M4: `scale_feed` multiplied the thread lead of every G76 and G92 block on a
    // lathe program, because the hazard was written in the entry's prose and nowhere a
    // machine could read it. `fanuc-gcode` is the only G-code profile that ships, so a
    // lathe program lands on it.
    const ambiguous = fanuc.db.codes.filter((e) => e.pitchFeedAmbiguous).map((e) => e.code);
    expect(ambiguous.sort()).toEqual(['G76', 'G92']);
    // Every one of them says so in its own description as well, which is where the
    // reviewer found it.
    for (const code of ambiguous) {
      const entry = fanuc.db.codes.find((e) => e.code === code);
      expect(entry?.description, code).toMatch(/system A/);
    }
    // The flag is about a code that means two things, not about a code that is a pitch:
    // the two lists do not overlap, and Klartext has no second G-code system.
    expect(fanuc.db.codes.some((e) => e.pitchFeed && e.pitchFeedAmbiguous)).toBe(false);
    expect(heidenhain.db.codes.some((e) => e.pitchFeedAmbiguous)).toBe(false);
  });

  it('ships the Fanuc CAM subset the plan lists', () => {
    const codes = new Set(fanuc.db.codes.map((e) => e.code));
    const want = [
      'G0', 'G1', 'G2', 'G3', 'G4',
      'G17', 'G18', 'G19', 'G20', 'G21', 'G28',
      'G32', 'G33',
      'G40', 'G41', 'G42', 'G43', 'G49',
      'G53', 'G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G54.1',
      'G73', 'G74', 'G76',
      'G80', 'G81', 'G82', 'G83', 'G84', 'G85', 'G86', 'G87', 'G88', 'G89',
      'G90', 'G91', 'G94', 'G95', 'G96', 'G97', 'G98', 'G99',
      'M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9',
      'M19', 'M30', 'M98', 'M99',
    ];
    for (const code of want) expect(codes, code).toContain(code);
    for (const letter of ['X', 'Y', 'Z', 'I', 'J', 'K', 'F', 'S', 'T', 'H', 'D', 'P', 'Q', 'N', 'O', 'G', 'M']) {
      expect(fanuc.db.addresses[letter], letter).toBeDefined();
    }
  });

  it('ships the Klartext subset the plan lists', () => {
    const codes = new Set(heidenhain.db.codes.map((e) => e.code));
    const want = [
      'L', 'C', 'CC', 'CR', 'CT', 'RND', 'CHF',
      'LBL', 'CALL LBL', 'CALL PGM',
      'TOOL CALL', 'TOOL DEF',
      'CYCL DEF 200', 'CYCL DEF 201', 'CYCL DEF 203', 'CYCL DEF 205',
      'CYCL DEF 206', 'CYCL DEF 207', 'CYCL DEF 209', 'CYCL DEF 240',
      'CYCL CALL', 'FMAX', 'FAUTO', 'R0', 'RL', 'RR',
      'BEGIN PGM', 'END PGM', 'BLK FORM',
      'M0', 'M3', 'M5', 'M8', 'M9', 'M30',
    ];
    for (const code of want) expect(codes, code).toContain(code);
  });

  it('marks PLANE and FUNCTION TCPM as unverified and leaves the rest of Klartext confirmed', () => {
    const verify = new Set(heidenhain.db.codes.filter((e) => e.verify).map((e) => e.code));
    for (const code of ['PLANE SPATIAL', 'PLANE RESET', 'FUNCTION TCPM', 'FUNCTION RESET TCPM']) {
      expect(verify, code).toContain(code);
    }
    // The 200-series cycles whose parameter list the syntax notes flag.
    for (const code of ['CYCL DEF 200', 'CYCL DEF 201']) expect(verify, code).not.toContain(code);
    for (const code of ['L', 'CC', 'TOOL CALL', 'FMAX', 'R0', 'M8']) {
      expect(verify, code).not.toContain(code);
    }
  });

  it('leaves the codes the assistant explains out of the unverified set', () => {
    const verify = new Set(fanuc.db.codes.filter((e) => e.verify).map((e) => e.code));
    for (const code of ['G0', 'G1', 'G43', 'G54', 'G81', 'G83', 'G84', 'M6', 'M8', 'M30']) {
      expect(verify, code).not.toContain(code);
    }
  });

  it('gives the drilling cycles their parameters', () => {
    const g83 = fanuc.db.codes.find((e) => e.code === 'G83');
    expect(g83?.params?.map((p) => p.address)).toEqual(['X', 'Y', 'Z', 'R', 'Q', 'F', 'K']);
    expect(g83?.params?.filter((p) => p.required).map((p) => p.address)).toEqual(['Z', 'R', 'Q', 'F']);

    const cycle200 = heidenhain.db.codes.find((e) => e.code === 'CYCL DEF 200');
    expect(cycle200?.params?.map((p) => p.address)).toEqual([
      'Q200', 'Q201', 'Q206', 'Q202', 'Q210', 'Q203', 'Q204', 'Q211', 'Q395',
    ]);
  });

  it('writes every parameter of a Klartext cycle block, so a snippet is complete', () => {
    // A Q-style cycle definition carries one line per parameter, so all of them are
    // required. Q395 is the exception: older controls do not know it.
    for (const entry of heidenhain.db.codes.filter((e) => e.code.startsWith('CYCL DEF '))) {
      for (const param of entry.params ?? []) {
        const label = `${entry.code} ${param.address}`;
        if (param.address === 'Q395') expect(param.required, label).toBeUndefined();
        else expect(param.required, label).toBe(true);
      }
    }
  });
});

describe('loadCodeDb', () => {
  it('refuses a file that is not a code database', () => {
    expect(() => loadCodeDb(null)).toThrow(CodeDbError);
    expect(() => loadCodeDb([])).toThrow(CodeDbError);
    expect(() => loadCodeDb({ version: 1, codes: [] })).toThrow(/dialect/);
    expect(() => loadCodeDb({ dialect: 'x', codes: {} })).toThrow(/codes/);
  });

  it('carries the JSON path on the error', () => {
    try {
      loadCodeDb({ dialect: 'x' });
      expect.unreachable('expected a CodeDbError');
    } catch (err) {
      expect(err).toBeInstanceOf(CodeDbError);
      expect((err as CodeDbError).path).toBe('codes');
    }
  });

  it('normalises the stored code and drops padding aliases without a word', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [{ code: 'g01', aliases: ['G01', 'G001'], label: 'Line' }],
    });
    expect(db.codes[0].code).toBe('G1');
    expect(db.codes[0].aliases).toBeUndefined();
    expect(problems).toEqual([]);
  });

  it('keeps an alias that is a different spelling', () => {
    const { db } = load({
      dialect: 'x',
      version: 1,
      codes: [{ code: 'FMAX', aliases: ['F MAX'], label: 'Rapid' }],
    });
    expect(db.codes[0].aliases).toEqual(['F MAX']);
  });

  it('drops a duplicate code and names the entry that owns it', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G0', label: 'Rapid' },
        { code: 'G00', label: 'Rapid again' },
      ],
    });
    expect(db.codes).toHaveLength(1);
    expect(db.codes[0].label).toBe('Rapid');
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe('codes[1]');
    expect(problems[0].message).toMatch(/duplicate code G0/);
  });

  it('drops an alias that another entry already owns and keeps the entry', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G0', label: 'Rapid' },
        { code: 'G1', aliases: ['G0', 'GLIN'], label: 'Line' },
      ],
    });
    expect(db.codes).toHaveLength(2);
    expect(db.codes[1].aliases).toEqual(['GLIN']);
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe('codes[1].aliases');
  });

  it('drops a broken entry, address and parameter but loads the rest of the file', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      addresses: { X: { label: 'X axis' }, Y: { description: 'no label' }, Z: 7 },
      codes: [
        { code: 'G0', label: 'Rapid' },
        { label: 'no code' },
        { code: 'G1' },
        'not an object',
        { code: 'G81', label: 'Drill', params: [{ address: 'Z', label: 'Bottom' }, { label: 'no address' }] },
      ],
    });
    expect(db.codes.map((e) => e.code)).toEqual(['G0', 'G81']);
    expect(Object.keys(db.addresses)).toEqual(['X']);
    expect(db.codes[1].params?.map((p) => p.address)).toEqual(['Z']);
    expect(problems.map((p) => p.path)).toEqual([
      'addresses.Y',
      'addresses.Z',
      'codes[1]',
      'codes[2].label',
      'codes[3]',
      'codes[4].params[1]',
    ]);
  });

  it('reads a missing version as 1 and says so', () => {
    const { db, problems } = load({ dialect: 'x', codes: [] });
    expect(db.version).toBe(1);
    expect(problems.map((p) => p.path)).toEqual(['version']);
  });

  it('keeps only the flags that are set', () => {
    const { db } = load({
      dialect: 'x',
      version: 1,
      codes: [
        { code: 'G84', label: 'Tap', modal: true, pitchFeed: true, verify: true, group: 'cycle' },
        { code: 'G0', label: 'Rapid', modal: false, pitchFeed: 'yes', pitchFeedAmbiguous: 1 },
        { code: 'G76', label: 'Bore', pitchFeedAmbiguous: true, group: 'cycle' },
      ],
    });
    expect(db.codes[0]).toMatchObject({ modal: true, pitchFeed: true, verify: true, group: 'cycle' });
    expect(db.codes[1].modal).toBeUndefined();
    expect(db.codes[1].pitchFeed).toBeUndefined();
    expect(db.codes[1].pitchFeedAmbiguous).toBeUndefined();
    expect(db.codes[1].group).toBeUndefined();
    expect(db.codes[2].pitchFeedAmbiguous).toBe(true);
  });

  it('builds an empty database for a dialect with no file', () => {
    const db = emptyCodeDb('okuma');
    expect(db).toEqual({ dialect: 'okuma', version: 0, addresses: {}, codes: [] });
  });

  // M6 (§7.2, AD-19): what a code switches on is the whole of what the modal interpreter
  // reads, so a value it does not know has to be dropped and reported rather than carried
  // into the interpreter, where it would silently leave the state unknown.
  it('reads what a code sets, and drops a member it does not know', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        {
          code: 'G99',
          label: 'Feed per revolution',
          group: 'feedmode',
          modal: true,
          sets: { feedUnit: 'per-rev' },
        },
        { code: 'G18', label: 'ZX plane', sets: { plane: 'ZX', units: 'mm', distance: 'incremental' } },
        { code: 'G50', label: 'Speed clamp', sets: { speedLimit: true } },
        { code: 'G80', label: 'Cancel cycle', sets: { cycle: 'cancel' } },
        { code: 'G96', label: 'Constant surface speed', sets: { speedUnit: 'surface', diameter: 'on' } },
        { code: 'G1', label: 'Line', sets: { feedUnit: 'per-second', tool: 'next' } },
        { code: 'G2', label: 'Arc', sets: 'per-rev' },
        { code: 'G3', label: 'Arc', sets: { speedLimit: 'yes' } },
      ],
    });
    expect(db.codes[0].sets).toEqual({ feedUnit: 'per-rev' });
    expect(db.codes[1].sets).toEqual({ plane: 'ZX', units: 'mm', distance: 'incremental' });
    expect(db.codes[2].sets).toEqual({ speedLimit: true });
    expect(db.codes[3].sets).toEqual({ cycle: 'cancel' });
    expect(db.codes[4].sets).toEqual({ speedUnit: 'surface', diameter: 'on' });
    // The broken ones keep their label and lose only what was wrong.
    expect(db.codes[5]).toEqual({ code: 'G1', label: 'Line' });
    expect(db.codes[6]).toEqual({ code: 'G2', label: 'Arc' });
    expect(db.codes[7]).toEqual({ code: 'G3', label: 'Arc' });
    expect(problems.map((p) => p.path)).toEqual([
      'codes[5].sets.feedUnit',
      'codes[5].sets.tool',
      'codes[6].sets',
      'codes[7].sets.speedLimit',
    ]);
  });

  // AD-31: the class of a cycle parameter wins over its address, because a cycle is where
  // a control most often breaks its own convention (the µm pecks of §8.2).
  it('reads how a cycle parameter is meant to be read, and reports an unknown reading', () => {
    const { db, problems } = load({
      dialect: 'x',
      version: 1,
      codes: [
        {
          code: 'G83',
          label: 'Peck drilling',
          params: [
            { address: 'Q', label: 'Peck', unit: 'increment' },
            { address: 'P', label: 'Dwell', unit: 'count' },
            { address: 'Z', label: 'Depth', unit: 'length' },
            { address: 'F', label: 'Feed', unit: 'feedPerRev' },
            { address: 'R', label: 'Plane' },
            { address: 'K', label: 'Repeat', unit: 'times' },
          ],
        },
      ],
    });
    expect(db.codes[0].params?.map((param) => param.unit)).toEqual([
      'increment',
      'count',
      'length',
      'feedPerRev',
      undefined,
      undefined,
    ]);
    expect(problems.map((p) => p.path)).toEqual(['codes[0].params[5].unit']);
  });
});

// ---------------------------------------------------------------------------
// The database against the rest of the app
// ---------------------------------------------------------------------------
//
// A code database is only worth having where it answers. These checks tie it to the three
// things that decide whether it does: the words the profile tokenizes, the codes the
// project's own fixtures contain, and the group catalogue hover renders.

describe('the database against the rest of the app', () => {
  const profiles = BUILTIN_PROFILE_JSON.map((raw) => {
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return compileProfile(checked.profile);
  });
  // The **resolved** databases (AD-17): a child file holds only what differs from its
  // parent, so a profile's real database is the merge, not the file.
  const RESOLVED = resolveCodeDbs(BUILTIN_CODE_DB_JSON);
  const dbOf = (cp: CompiledProfile): CodeDb => RESOLVED[cp.profile.codes] ?? emptyCodeDb(cp.profile.codes);
  /**
   * M6: every database a profile can end up with, as one lookup table.
   *
   * A profile may offer a machine parameter that swaps the database (the Fanuc lathe's
   * G-code system A or B, AD-31), and which one a document gets is decided per document.
   * "Is this code described anywhere the profile might use it?" is therefore a question
   * about the union, and only that union covers a system-B program such as
   * `l05-system-b.nc`, whose `G77`, `G78` and `G95` live in the variant database.
   */
  const anyDbOf = (cp: CompiledProfile): CodeDb =>
    unionCodeDb(variantDialects(cp.profile).map((dialect) => RESOLVED[dialect] ?? emptyCodeDb(dialect)));

  it('describes every keyword its profile tokenizes', () => {
    // A keyword the tokenizer hands over as a keyword token and the database has never
    // heard of hovers as "not described yet" — on `MM`, that is the first line of every
    // Klartext program.
    for (const cp of profiles) {
      const db = dbOf(cp);
      const missing = (cp.profile.syntax.keywords ?? []).filter((keyword) => lookupCode(db, keyword) === null);
      expect(missing, `${cp.profile.id} keywords without an entry`).toEqual([]);
    }
  });

  it('describes every G and M word the shipped fixtures contain', () => {
    const missing = new Map<string, string[]>();
    for (const rel of listFixtures('nc')) {
      const opened = openFixture(rel);
      if (opened.refused !== null) continue;
      const text = editorText(opened.text);
      const id = detectProfile(profiles, `/work/${rel}`, opened.text, 'fanuc-gcode');
      const cp = profiles.find((p) => p.profile.id === id);
      if (!cp) continue;
      const db = anyDbOf(cp);
      let state: LineState | undefined;
      for (const line of text.split('\n')) {
        const result = tokenizeLine(line, cp, state);
        state = result.state;
        for (const token of result.tokens) {
          if (token.kind !== 'word' || token.address === undefined) continue;
          if (token.address !== 'G' && token.address !== 'M') continue;
          const code = `${token.address}${token.valueText ?? ''}`;
          if (lookupCode(db, code) !== null) continue;
          missing.set(code, [...(missing.get(code) ?? []), rel]);
        }
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it('has a group name for every group the databases use', () => {
    for (const { db } of [fanuc, heidenhain]) {
      for (const entry of db.codes) {
        if (entry.group === undefined) continue;
        const key = `assistant.group.${entry.group}`;
        expect(t(key), `${entry.code} is in group "${entry.group}"`).not.toBe(key);
      }
    }
  });

  it('keeps tool centre point management out of the working-plane group', () => {
    // TCPM holds the tool tip on the path while rotary axes move; it neither selects nor
    // tilts a plane, and `plane` is what Fanuc G17 to G19 mean.
    const groupOf = (code: string) => heidenhain.db.codes.find((e) => e.code === code)?.group;
    for (const code of ['FUNCTION TCPM', 'FUNCTION RESET TCPM', 'M128', 'M129']) {
      expect(groupOf(code), code).toBe('tcpm');
    }
    expect(groupOf('PLANE SPATIAL')).toBe('plane');
    expect(fanuc.db.codes.find((e) => e.code === 'G17')?.group).toBe('plane');
  });

  it('does not tell the reader to distrust the M codes it describes itself', () => {
    // The `M` address used to say that everything above M9 is machine specific, four
    // entries above M19, M30, M98 and M99.
    const text = fanuc.db.addresses.M.description ?? '';
    for (const code of ['M19', 'M29', 'M30', 'M98', 'M99']) expect(text, code).toContain(code);
  });

  it('does not claim a feed unit the program header can contradict', () => {
    // `INCH` makes F tenths of an inch per minute, and a rotary axis makes it deg/min.
    const text = heidenhain.db.addresses.F.description ?? '';
    expect(text).toContain('INCH');
    expect(text.toLowerCase()).toContain('degrees per minute');
  });
});
