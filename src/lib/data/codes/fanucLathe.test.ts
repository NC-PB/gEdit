// What the shipped Fanuc databases say about turning (plan §8.2, §8.3, AD-17, AD-19,
// AD-31; gate G10 §8.7 items 3 and 5a). Owner: WP6.2.
//
// The assertions are about **data**, and every one of them decides what the editor tells a
// machinist. `pitchFeed` on the wrong entry scraps a thread; a repeat count read as an arc
// centre puts a wrong number in a hover; a `sets` member nobody spelled right leaves the
// modal interpreter without a feed unit.
//
// Everything is read through `resolveCodeDbFiles`, not off the files: `fanuc-lathe`
// extends `fanuc` and `fanuc-lathe-b` extends `fanuc-lathe` (AD-17), and it is the merge
// result the app uses. The **file** form is what is checked rather than the loaded
// `CodeDb`, because `loadCodeDb` does not carry `sets` and `CodeParam.unit` through yet
// (P6 hand-off gap G1, WP6.1); the data is in the files, the resolved fixtures and the
// Python side today, and reading the files here keeps this test honest about all four.

import { describe, expect, it } from 'vitest';
import { resolveCodeDbFiles, resolveCodeDbs } from '$lib/core/codes/resolve';
import { normalizeCode } from '$lib/core/codes/lookup';
import { addressNames, wordCodes } from '$lib/core/grammar/shared';
import { unionCodeDb, variantDialects } from '$lib/monaco/languages';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { BUILTIN_PROFILE_JSON } from '$lib/data/profiles';
import type { CodeDb, CodeEntry, CodeParam, CodeSets } from '$lib/core/codes/types';
import type { Profile } from '$lib/core/profiles/types';

const MILL = 'fanuc';
const A = 'fanuc-lathe';
const B = 'fanuc-lathe-b';

const problems: string[] = [];
const FILES = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, p) => problems.push(`${dialect}: ${p.path}: ${p.message}`));
const LOADED: Record<string, CodeDb> = resolveCodeDbs(BUILTIN_CODE_DB_JSON);

/** The resolved entries of one database, as they are written in JSON. */
function entriesOf(dialect: string): CodeEntry[] {
  const file = FILES[dialect];
  if (!file) throw new Error(`no database ${dialect}`);
  return (file.codes as CodeEntry[]).map((entry) => ({ ...entry, code: normalizeCode(entry.code) }));
}

function entry(dialect: string, code: string): CodeEntry | undefined {
  return entriesOf(dialect).find((e) => e.code === normalizeCode(code));
}

function addressesOf(dialect: string): Record<string, { label: string; description?: string }> {
  return (FILES[dialect]?.addresses ?? {}) as Record<string, { label: string; description?: string }>;
}

const FANUC_DIALECTS = [MILL, A, B];

// ---------------------------------------------------------------------------
// The parameter-unit table of §8.2
// ---------------------------------------------------------------------------
//
// §8.2 is the **one** place these are written down, so the table is repeated here as data
// and checked in both directions: every parameter it names carries exactly that unit, and
// no other parameter carries one at all. A `K` repeat count that keeps the arc-centre
// class of its address is read as a distance, which is the mistake the table exists to
// stop (`G83 … K3` is three holes, not three millimetres).
//
// The mill rows of the table say "`G81`–`G89`"; they are read here as the mill's canned
// cycles, which is the set `G73`, `G74`, `G76` and `G81`–`G89` (syntax-fanuc §6.1 lists
// them together). `G73 R` is one row the table does not have — see the hand-off note.

/** The mill's canned cycles: the `G81`–`G89` rows of §8.2 cover all of them. */
// 2026-09: with the older-format rigid tapping cycles `G84.2` and `G84.3`.
const MILL_CYCLES = ['G73', 'G74', 'G76', 'G81', 'G82', 'G83', 'G84', 'G84.2', 'G84.3', 'G85', 'G86', 'G87', 'G88', 'G89'];

type Unit = NonNullable<CodeParam['unit']>;

/** The unit §8.2 gives `<dialect>` `<code>` `<address>`, or undefined for "by class". */
function tableUnit(dialect: string, code: string, address: string): Unit | undefined {
  // Rows without a dialect in §8.2 hold wherever the code is defined.
  if (code === 'G4') return address === 'P' ? 'count' : address === 'X' || address === 'U' ? 'dwell' : undefined;
  if (code === 'M98') return address === 'P' || address === 'L' ? 'count' : undefined;
  // M9 (WP9.5a): the F of a code that cuts a thread is its lead, a feed per revolution
  // whatever the feed mode says, and the database says so (`numberClassOf` rule 1). A tap's
  // F is not a lead (`G84`, `G74`, `G63`): it follows the feed unit in force.
  if (address === 'F' && ['G32', 'G33', 'G34'].includes(code)) return 'feedPerRev';
  if (address === 'F' && dialect !== MILL && code === 'G76') return 'feedPerRev';
  if (address === 'F' && ((dialect === A && code === 'G92') || (dialect === B && code === 'G78'))) return 'feedPerRev';
  // M9 (WP9.2), the 5-axis entries, wherever they are defined: a tool direction, a scale factor
  // and a rotation axis direction are plain numbers that no reading touches, and a rotation
  // or tilt is an angle.
  if (['G43.5', 'G51', 'G68', 'G68.2', 'G68.4'].includes(code) && ['I', 'J', 'K'].includes(address)) return 'count';
  if (code === 'G43.5' && address === 'Q') return 'angle';
  if (['G68', 'G68.2', 'G68.3', 'G68.4'].includes(code) && address === 'R') return 'angle';
  // B1 (the 30i manuals): the lathe's coordinate rotation, NURBS (order, knots and weights are
  // plain numbers no reading touches) and the tilt angle of the five-axis compensation G41.6/G42.6.
  if (code === 'G68.1') return address === 'R' ? 'angle' : ['I', 'J', 'K'].includes(address) ? 'count' : undefined;
  if (code === 'G6.2') return ['P', 'K', 'R'].includes(address) ? 'count' : undefined;
  if ((code === 'G41.6' || code === 'G42.6') && address === 'Q') return 'angle';

  if (dialect === A || dialect === B) {
    // M9 (WP9.2): the other face and side cycles count their dwell and repeats too, like G83 and G87.
    if (['G84', 'G85', 'G88', 'G89'].includes(code)) return address === 'P' || address === 'K' ? 'count' : undefined;
    if (code === 'G74' || code === 'G75') return address === 'P' || address === 'Q' ? 'increment' : undefined;
    if (code === 'G76') return address === 'Q' ? 'increment' : address === 'P' ? 'count' : undefined;
    if (code === 'G83' || code === 'G87') {
      if (address === 'Q') return 'increment';
      if (address === 'P' || address === 'K') return 'count';
      return undefined;
    }
    if (['G70', 'G71', 'G72', 'G73'].includes(code)) {
      if (address === 'P' || address === 'Q') return 'count';
      // Added by WP6.2 and not in the §8.2 table: the `R` of the first `G73` block is the
      // number of passes, and every other cycle `R` is a length (syntax-fanuc §6.4).
      if (code === 'G73' && address === 'R') return 'count';
      return undefined;
    }
    return undefined;
  }

  if (dialect === MILL && MILL_CYCLES.includes(code)) {
    if (address === 'Q' && ['G73', 'G76', 'G83', 'G84', 'G87'].includes(code)) return 'length';
    return address === 'P' || address === 'K' || address === 'L' ? 'count' : undefined;
  }
  return undefined;
}

describe('the shipped Fanuc databases', () => {
  it('resolve without a problem, and hold the three Fanuc dialects', () => {
    expect(problems).toEqual([]);
    expect(Object.keys(FILES).sort()).toEqual([
      'fanuc',
      'fanuc-lathe',
      'fanuc-lathe-b',
      'heidenhain',
      'okuma',
      'sinumerik',
    ]);
  });

  it.each(FANUC_DIALECTS)('%s has no duplicate code and no duplicate alias after resolution', (dialect) => {
    const keys = entriesOf(dialect).flatMap((e) => [e.code, ...(e.aliases ?? []).map(normalizeCode)]);
    expect(new Set(keys).size, keys.filter((k, i) => keys.indexOf(k) !== i).join(', ')).toBe(keys.length);
  });

  it.each(FANUC_DIALECTS)('%s gives every entry a label and a group', (dialect) => {
    for (const e of entriesOf(dialect)) {
      expect(typeof e.label, e.code).toBe('string');
      expect(e.label.length, e.code).toBeGreaterThan(0);
      expect(typeof e.group, e.code).toBe('string');
    }
  });

  it.each(FANUC_DIALECTS)('%s ties the feed to a pitch only in a cycle or a motion block', (dialect) => {
    // Anything that scales a feed refuses a `pitchFeed` block (AD-19). A flag on an entry
    // that is neither a cycle nor a motion — a coolant code, a work offset — would refuse
    // a whole program's feeds for no reason, and a missing one scraps a thread.
    for (const e of entriesOf(dialect)) {
      if (e.pitchFeed !== true) continue;
      // 2026-09: or a modal **mode** of its own group, the tapping mode `G63` (in force
      // until `G61`, `G62` or `G64` replaces it; `FeedModeTracker.pitch_mode`).
      if (e.code === 'G63') {
        expect(e.group, `${dialect} ${e.code}`).toBe('pathmode');
        expect(e.modal, `${dialect} ${e.code}`).toBe(true);
        continue;
      }
      expect(e.group, `${dialect} ${e.code}`).toMatch(/^(cycle|motion)$/);
      // A cycle that cuts a thread starts one; a motion that does is one block.
      if (e.group === 'cycle') expect(e.sets?.cycle, `${dialect} ${e.code}`).toBe('start');
    }
    // `pitchFeedAmbiguous` is the other half: the entry says what the code means **here**
    // and warns that another G-code system of the same dialect cuts a thread with it. The
    // mill's `G92` is a non-modal coordinate set, which is why it is ambiguous and not
    // certain, so its group is the mill meaning and not the lathe one (§8.3).
    for (const e of entriesOf(dialect)) {
      if (e.pitchFeedAmbiguous !== true) continue;
      expect(e.pitchFeed, `${dialect} ${e.code}`).toBeUndefined();
      expect(e.group, `${dialect} ${e.code}`).toMatch(/^(cycle|motion|nonmodal)$/);
    }
    // 2026-09 (review finding NC1): of those, the lathe's G74 is a tap on the other kind of
    // machine (the mill's left-hand tapping cycle), so its speed is left like its feed. The
    // mill's G76 and G92 are threads on a lathe, whose speed stays scaled with a warning.
    const elsewhere = entriesOf(dialect).filter((e) => e.tappingElsewhere === true).map((e) => e.code);
    expect(elsewhere, dialect).toEqual(dialect === MILL ? [] : ['G74']);
    for (const code of elsewhere) expect(entry(dialect, code)?.pitchFeedAmbiguous, code).toBe(true);
  });

  // Owner decision of 2026-09-27: scale_speed leaves the speed of a tap as written, and it
  // knows a tap by this flag alone. System B inherits the tapping cycles of system A.
  it.each(FANUC_DIALECTS)('%s marks its tapping codes, and only them, as tapping', (dialect) => {
    const tapping = entriesOf(dialect).filter((e) => e.tapping === true).map((e) => e.code).sort();
    const want =
      dialect === 'fanuc'
        ? ['G63', 'G74', 'G84', 'G84.2', 'G84.3', 'M29']
        : ['G63', 'G84', 'G84.2', 'G88', 'M29'];
    expect(tapping, dialect).toEqual(want);
    // A tap that is not a mode or an M code takes its lead from F.
    for (const code of tapping) {
      if (code === 'M29') continue;
      expect(entry(dialect, code)?.pitchFeed, `${dialect} ${code}`).toBe(true);
    }
  });

  it.each(FANUC_DIALECTS)('%s spells every sets member the way §7.2 does', (dialect) => {
    const allowed: Record<keyof CodeSets, readonly unknown[]> = {
      feedUnit: ['per-minute', 'per-rev', 'per-tooth', 'inverse-time'],
      speedUnit: ['rpm', 'surface'],
      distance: ['absolute', 'incremental'],
      units: ['mm', 'inch'],
      plane: ['XY', 'ZX', 'YZ'],
      cycle: ['start', 'cancel'],
      speedLimit: [true],
      // P9 (§7.2): spelled here because the map lists every member of `CodeSets`.
      speedLimitBound: ['upper', 'lower'],
      diameter: ['on', 'off', 'absolute-only'],
      // P10 (§7.2): tool centre point control (G43.4, G43.5 on, G49 off), and the Klartext
      // tool-axis plane, which no Fanuc entry sets.
      tcp: ['on', 'off'],
      planeFromAxisWord: [],
      // M10 (WP10.2): what the program checks read. No Fanuc code drives a tool spindle of
      // its own, leaves a zero speed behind or switches the language.
      spindle: ['on', 'off'],
      toolSpindle: [],
      motion: ['rapid', 'feed'],
      radiusComp: ['on', 'off'],
      lengthComp: ['on', 'off'],
      exitSpeed: [],
      language: [],
      // Phase 3 (P3a prelude; P3.7 sets it on G2 and G3): an arc, for the motion colours; a
      // single-pass turning or facing cycle (A G90, G94; B G77, G79), a cycle to the colours.
      path: ['arc', 'cycle'],
    };
    for (const e of entriesOf(dialect)) {
      for (const [member, value] of Object.entries(e.sets ?? {})) {
        const choices = allowed[member as keyof CodeSets];
        expect(choices, `${dialect} ${e.code}: sets.${member}`).toBeDefined();
        expect(choices, `${dialect} ${e.code}: sets.${member}`).toContain(value);
      }
    }
  });

  it.each(FANUC_DIALECTS)('%s carries exactly the parameter units of §8.2, and no others', (dialect) => {
    for (const e of entriesOf(dialect)) {
      for (const param of e.params ?? []) {
        expect(param.unit, `${dialect} ${e.code} ${param.address}`).toBe(tableUnit(dialect, e.code, param.address));
      }
    }
  });

  it('covers every parameter the table names that the database really defines', () => {
    // The other direction: the table must not point at a code or an address that is not
    // there any more, which is how a unit quietly stops being applied.
    const covered: string[] = [];
    for (const dialect of FANUC_DIALECTS) {
      for (const e of entriesOf(dialect)) {
        for (const param of e.params ?? []) {
          if (tableUnit(dialect, e.code, param.address) !== undefined) covered.push(`${dialect} ${e.code} ${param.address}`);
        }
      }
    }
    // `G4 X/U/P`, `M98 P/L` and the cycle rows, in all three databases.
    expect(covered.length).toBeGreaterThan(40);
    expect(covered).toContain('fanuc-lathe G83 Q');
    expect(covered).toContain('fanuc-lathe-b G83 Q');
    expect(covered).toContain('fanuc G83 K');
    expect(covered).toContain('fanuc-lathe G4 U');
  });
});

describe('the mill corrections of §8.3', () => {
  it('gives the tool length offset a group of its own', () => {
    // F25: `G43`/`G44`/`G49` sat with `G40`–`G42`, so switching the length offset looked
    // like cancelling radius compensation to anything that reads modal groups.
    for (const code of ['G43', 'G44', 'G49']) expect(entry(MILL, code)?.group, code).toBe('lengthComp');
    for (const code of ['G40', 'G41', 'G42']) expect(entry(MILL, code)?.group, code).toBe('compensation');
    // The source review (2026-09): the control's G-code list confirms G44.
    expect(entry(MILL, 'G44')?.verify).toBeUndefined();
  });

  it('keeps reading the S of a mill G50 or G92 block as a clamp', () => {
    // The control's G-code list settles both mill meanings (source review, 2026-09): G50
    // cancels scaling, G92 sets the coordinate system or clamps the top speed. A lathe
    // program opened with the mill profile by hand has to stay protected all the same:
    // the `S` clamp and the pitch-feed warning are what protect it (§8.3).
    for (const code of ['G50', 'G92']) {
      expect(entry(MILL, code)?.sets, code).toEqual({ speedLimit: true });
      expect(entry(MILL, code)?.verify, code).toBeUndefined();
    }
    expect(entry(MILL, 'G50')?.label).toBe('Scaling cancel');
    expect(entry(MILL, 'G92')?.pitchFeedAmbiguous).toBe(true);
    expect(entry(MILL, 'G76')?.pitchFeedAmbiguous).toBe(true);
    // Ambiguous, not certain: the mill entries must not claim to know it is a pitch.
    expect(entry(MILL, 'G92')?.pitchFeed).toBeUndefined();
    expect(entry(MILL, 'G76')?.pitchFeed).toBeUndefined();
  });

  it('counts the repeats and dwells of the mill cycles instead of measuring them', () => {
    const unitOf = (code: string, address: string): Unit | undefined =>
      entry(MILL, code)?.params?.find((p) => p.address === address)?.unit;
    expect(unitOf('G83', 'K')).toBe('count');
    expect(unitOf('G82', 'P')).toBe('count');
    expect(unitOf('G4', 'P')).toBe('count');
    expect(unitOf('G4', 'X')).toBe('dwell');
    expect(unitOf('M98', 'P')).toBe('count');
    expect(unitOf('M98', 'L')).toBe('count');
    // An R plane is a length by class (`R` is one by name). A peck and a shift (`Q`) are lengths
    // too, but no class names `Q`, so the database says so outright (P3b intA): a point-less
    // `Q` is read the way the machine reads any other length (input increments on an IS-B
    // control), never as a bare number. On the lathe `Q` is micrometres (`increment`).
    for (const code of ['G73', 'G76', 'G83', 'G84', 'G87']) expect(unitOf(code, 'Q'), code).toBe('length');
    expect(unitOf('G83', 'R')).toBeUndefined();
  });
});

describe('the lathe database of G-code system A (§8.2)', () => {
  it('drops the mill codes a turret lathe does not have', () => {
    // P10: the tool centre point codes are length offsets too, and the lathe has no G49 to
    // end them, so their tool centre point control would never read as off (§7.16 #107).
    for (const code of ['G43', 'G43.4', 'G43.5', 'G44', 'G49', 'G81', 'G82', 'G86', 'G91', 'G95']) {
      expect(entry(A, code), code).toBeUndefined();
      expect(entry(MILL, code), code).toBeDefined();
    }
    // The source review (2026-09): the lathe's own G-code list has the extended work
    // offsets and inverse-time feed in all three G-code systems, so they stay.
    for (const code of ['G54.1', 'G93']) expect(entry(A, code), code).toEqual(entry(MILL, code));
  });

  it('reads G98 and G99 as the feed modes, and G94 and G90 as single cycles', () => {
    expect(entry(A, 'G98')?.sets).toEqual({ feedUnit: 'per-minute' });
    expect(entry(A, 'G99')?.sets).toEqual({ feedUnit: 'per-rev' });
    expect(entry(A, 'G98')?.group).toBe('feedmode');
    expect(entry(A, 'G99')?.group).toBe('feedmode');
    for (const code of ['G90', 'G92', 'G94']) expect(entry(A, code)?.group, code).toBe('motion');
    // M10 (WP10.2): single cycles cut, so they are feed moves to the program checks; each
    // block is a whole pass, which the motion colours show as a cycle (`path: 'cycle'`).
    expect(entry(A, 'G90')?.sets).toEqual({ motion: 'feed', path: 'cycle' });
    expect(entry(A, 'G94')?.sets).toEqual({ motion: 'feed', path: 'cycle' });
  });

  it('knows that G92 is a thread here and not a coordinate set', () => {
    // The one entry that decides whether a thread survives feed scaling on this dialect.
    expect(entry(A, 'G92')?.pitchFeed).toBe(true);
    expect(entry(A, 'G92')?.pitchFeedAmbiguous).toBeUndefined();
    expect(entry(A, 'G32')?.pitchFeed).toBe(true);
    expect(entry(A, 'G50')?.sets).toEqual({ speedLimit: true });
    // G8 M6: and the S of a G92 block is read as a clamp here as well. A threading pass
    // carries no S word, so this costs nothing in system A — and it is what keeps a
    // system-B program opened with a system-A machine from having its `G92 S3000` top
    // speed multiplied by a speed scaling run.
    expect(entry(A, 'G92')?.sets).toEqual({ speedLimit: true, motion: 'feed' });
  });

  it('protects a system-B thread lead even while the program is read as system A', () => {
    // G8 M6. `G78` is the single-pass threading cycle of G-code system B and its `F` is
    // the lead (syntax-fanuc §6.3). A B program whose post writes no `G92 S` clamp can
    // miss the variant margin and be read as A — and system A has no G77/G78/G79 at all,
    // so the lead used to be scaled as an ordinary feed with nothing said. The three
    // entries below make that refusal independent of which system detection picked.
    for (const code of ['G77', 'G78', 'G79']) expect(entry(A, code), code).toBeDefined();
    expect(entry(A, 'G78')?.pitchFeedAmbiguous).toBe(true);
    expect(entry(A, 'G78')?.pitchFeed).toBeUndefined();
    expect(entry(A, 'G77')?.pitchFeedAmbiguous).toBeUndefined();
    expect(entry(A, 'G79')?.pitchFeedAmbiguous).toBeUndefined();
    // They describe a system this database is not, so they stay out of hover.
    for (const code of ['G77', 'G78', 'G79']) expect(entry(A, code)?.verify, code).toBe(true);
    // In system B they are the real thing, and B says so without the hedge.
    expect(entry(B, 'G78')?.pitchFeed).toBe(true);
    expect(entry(B, 'G78')?.pitchFeedAmbiguous).toBeUndefined();
  });

  it('does not call the face pecking cycle a tapping cycle', () => {
    // On a mill `G74` cuts a left-hand thread and its `F` is the pitch; on a lathe in
    // system A it pecks or grooves a face and its `F` is an ordinary feed (§8.2). Keeping
    // the mill's `pitchFeed` here would silently refuse to scale a real feed.
    expect(entry(MILL, 'G74')?.pitchFeed).toBe(true);
    expect(entry(A, 'G74')?.pitchFeed).toBeUndefined();
    expect(entry(A, 'G75')?.pitchFeed).toBeUndefined();
    // G8 M6: the other direction of the same problem. A mill-turn program opened with
    // this profile writes `G74 … F1.25` for a left-hand tap, and here that number is an
    // ordinary pecking feed — so gEdit refuses it and says why, exactly as the mill
    // database refuses the lathe's `G76` and `G92`. Refusing a real pecking feed costs
    // one edit by hand; scaling a tapping pitch cuts a different thread.
    expect(entry(A, 'G74')?.pitchFeedAmbiguous).toBe(true);
    expect(entry(A, 'G75')?.pitchFeedAmbiguous).toBeUndefined();
    // G8 M6 (the same review, recorded as a decision rather than a fix): `G76`'s `P` is
    // six packed digits in the first block of the cycle and the thread height in microns
    // in the second. B1: each block has its own `P` with its own label (`CodeParam.block`),
    // and both stay a `count` (the two blocks' units have to agree), so the packed digits
    // can never be converted and the thread height is only ever shown as written — a
    // missing value, which is the safe half of the trade.
    const p76 = entry(A, 'G76')?.params?.filter((param) => param.address === 'P') ?? [];
    expect(p76.map((p) => [p.block, p.unit])).toEqual([
      [1, 'count'],
      [2, 'count'],
    ]);
    expect(p76[0].label).toContain('Counted, never converted');
    expect(p76[1].label).toMatch(/^Thread height.*shown as written$/);
    // Tapping and threading are the only lathe entries that carry it. The source review
    // (2026-09) added the variable-lead thread G34 and the older-format rigid tap G84.2,
    // both in the lathe's own G-code list, and the 2026-09 scaling pass the tapping mode
    // G63, which the lathe's list has in all three G-code systems.
    expect(
      entriesOf(A)
        .filter((e) => e.pitchFeed === true)
        .map((e) => e.code)
        .sort(),
    ).toEqual(['G32', 'G33', 'G34', 'G63', 'G76', 'G84', 'G84.2', 'G88', 'G92']);
    // The left-hand older-format tap is a mill code only.
    expect(entry(A, 'G84.3')).toBeUndefined();
  });

  it('starts a cycle on every code that starts one, and only there', () => {
    const starts = entriesOf(A)
      .filter((e) => e.sets?.cycle === 'start')
      .map((e) => e.code)
      .sort();
    expect(starts).toEqual(['G70', 'G71', 'G72', 'G73', 'G74', 'G75', 'G76', 'G83', 'G84', 'G84.2', 'G85', 'G87', 'G88', 'G89']);
    expect(entriesOf(A).filter((e) => e.sets?.cycle === 'cancel').map((e) => e.code)).toEqual(['G80']);
    // AD-19 rule 2: the multi-pass cycles are one-shot, so their `start` applies to their
    // own block only; the drilling cycles stay active until `G80`.
    for (const code of ['G70', 'G71', 'G72', 'G73', 'G74', 'G75', 'G76']) {
      expect(entry(A, code)?.modal, code).toBeUndefined();
    }
    for (const code of ['G80', 'G83', 'G84', 'G84.2', 'G85', 'G87', 'G88', 'G89']) {
      expect(entry(A, code)?.modal, code).toBe(true);
    }
    // The source review (2026-09): the lathe list confirms both boring cycles.
    for (const code of ['G85', 'G89']) expect(entry(A, code)?.verify, code).toBeUndefined();
  });

  it('declares no distance code at all, which is what makes its positions absolute', () => {
    // AD-19 rule 8: system A has no `G91`, so "absolute" is the only reading the database
    // allows and the interpreter states it instead of assuming it. One `sets.distance`
    // anywhere in this database would turn that certainty back into a guess.
    expect(entriesOf(A).filter((e) => e.sets?.distance !== undefined)).toEqual([]);
    expect(entriesOf(MILL).filter((e) => e.sets?.distance !== undefined).map((e) => e.code)).toEqual(['G90', 'G91']);
  });

  it('describes the addresses that mean something else on a lathe', () => {
    const mill = addressesOf(MILL);
    const lathe = addressesOf(A);
    for (const letter of ['X', 'U', 'W', 'C', 'P', 'Q', 'R', 'F', 'T', 'H', 'D']) {
      expect(lathe[letter]?.label, letter).toBeDefined();
      expect(lathe[letter], letter).not.toEqual(mill[letter]);
    }
    // `E` is a lathe-only address; the mill database never had one.
    expect(mill.E).toBeUndefined();
    expect(lathe.E?.label).toBeDefined();
    // A letter the lathe says nothing about keeps the mill's text (AD-17).
    expect(lathe.N).toEqual(mill.N);
  });
});

describe('the system-B variant database (§8.2)', () => {
  it('renumbers the codes that B numbers differently, and nothing else', () => {
    expect(entry(B, 'G94')?.sets).toEqual({ feedUnit: 'per-minute' });
    expect(entry(B, 'G95')?.sets).toEqual({ feedUnit: 'per-rev' });
    expect(entry(B, 'G94')?.group).toBe('feedmode');
    expect(entry(B, 'G98')?.group).toBe('cyclereturn');
    expect(entry(B, 'G99')?.group).toBe('cyclereturn');
    expect(entry(B, 'G98')?.sets).toBeUndefined();
    expect(entry(B, 'G90')?.sets).toEqual({ distance: 'absolute' });
    expect(entry(B, 'G91')?.sets).toEqual({ distance: 'incremental' });
    // The single cycles move from G90/G92/G94 to G77/G78/G79 …
    for (const code of ['G77', 'G78', 'G79']) expect(entry(B, code)?.group, code).toBe('motion');
    expect(entry(B, 'G78')?.pitchFeed).toBe(true);
    expect(entry(B, 'G77')?.pitchFeed).toBeUndefined();
    expect(entry(B, 'G33')?.pitchFeed).toBe(true);
    // … and the clamp moves from G50 to G92.
    expect(entry(B, 'G92')?.sets).toEqual({ speedLimit: true });
    expect(entry(B, 'G92')?.pitchFeed).toBeUndefined();
    // G8 M6, the two mirror cases of a system-A program opened with a system-B machine.
    //
    // `G92 X… Z… F1.5` is the single-pass threading cycle in system A and its F is the
    // lead. Here the same number is the coordinate set, so nothing marked the F and a
    // feed scaling run multiplied a thread lead without a word.
    expect(entry(B, 'G92')?.pitchFeedAmbiguous).toBe(true);
    // `G50 S2500` is the top-speed clamp in system A. Dropping the entry took the
    // `speedLimit` flag with it, and a speed scaling run **raised** the clamp of a
    // constant-surface-speed program — the change that lets the spindle run away as the
    // diameter falls. In B the number cancels scaling (the control's G-code list, source
    // review 2026-09), so the entry says so and keeps the conservative reading.
    expect(entry(B, 'G50')?.sets).toEqual({ speedLimit: true });
    expect(entry(B, 'G50')?.verify).toBeUndefined();
    expect(entry(B, 'G50')?.label).toMatch(/^Scaling cancel/);
    // The multi-pass cycles are the same as in A (syntax-fanuc §4.1).
    for (const code of ['G70', 'G71', 'G72', 'G73', 'G74', 'G75', 'G76', 'G83', 'G87']) {
      expect(entry(B, code), code).toEqual(entry(A, code));
    }
  });

  it('changes no address and no word code, so one grammar serves both systems', () => {
    // The Monarch rules are generated from the addresses and the word-shaped codes of the
    // **union** of a profile's databases (`variantDialects`), because a document is
    // painted before anybody has picked a machine. If a variant added an address or a
    // keyword, one system's file would be painted with the other one's alphabet.
    const profile = BUILTIN_PROFILE_JSON.map((raw) => {
      const checked = validateProfile(raw);
      if (!checked.ok) throw new Error(checked.errors.join('; '));
      return checked.profile;
    }).find((p: Profile) => p.id === 'fanuc-lathe');
    expect(profile).toBeDefined();
    expect(variantDialects(profile as Profile)).toEqual([A, B]);

    expect(addressesOf(B)).toEqual(addressesOf(A));
    const union = unionCodeDb([LOADED[A], LOADED[B]]);
    const letters = ['G', 'M', 'N', 'O', 'T'];
    for (const db of [LOADED[A], LOADED[B]]) {
      expect(addressNames(db)).toEqual(addressNames(union));
      expect(wordCodes(db, letters).sort()).toEqual(wordCodes(union, letters).sort());
    }
    // Only numeric G-codes differ between the two.
    const codesOf = (dialect: string): string[] => entriesOf(dialect).map((e) => e.code).sort();
    const changed = [...new Set([...codesOf(A), ...codesOf(B)])].filter(
      (code) => JSON.stringify(entry(A, code)) !== JSON.stringify(entry(B, code)),
    );
    expect(changed.every((code) => /^G\d+(\.\d+)?$/.test(code)), changed.join(', ')).toBe(true);
    // B1: the work coordinate system preset is G50.3 in system A and G92.1 in system B.
    expect(changed.sort()).toEqual(['G33', 'G50', 'G50.3', 'G77', 'G78', 'G79', 'G90', 'G91', 'G92', 'G92.1', 'G94', 'G95', 'G98', 'G99']);
  });
});

describe('the profile and its databases agree', () => {
  const profiles = BUILTIN_PROFILE_JSON.map((raw) => {
    const checked = validateProfile(raw);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return checked.profile;
  });

  it.each(profiles.map((p) => [p.id, p] as const))('%s names groups and codes its databases have', (_id, profile) => {
    for (const dialect of variantDialects(profile)) {
      const groups = new Set(entriesOf(dialect).map((e) => e.group));
      for (const group of profile.machineParams?.modalGroups ?? []) {
        expect(groups, `${profile.id}/${dialect}: modalGroups ${group}`).toContain(group);
      }
      const codes = new Set(entriesOf(dialect).map((e) => e.code));
      // The power-on state of a variant is the profile's with the choice's overlay on top.
      const overlay = profile.machineParams?.variants
        ?.flatMap((v) => v.choices)
        .find((c) => c.codes === dialect)?.overlay?.modal?.initial;
      const initial = { ...(profile.modal?.initial ?? {}), ...(overlay ?? {}) };
      for (const [group, code] of Object.entries(initial)) {
        const found = entriesOf(dialect).find((e) => e.code === normalizeCode(code));
        expect(codes, `${profile.id}/${dialect}: modal.initial.${group} = ${code}`).toContain(normalizeCode(code));
        expect(found?.group, `${profile.id}/${dialect}: modal.initial.${group} = ${code}`).toBe(group);
      }
    }
  });
});
