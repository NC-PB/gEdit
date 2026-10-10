// P3.2a: the inspector's rows (Phase 3 plan §6.3, AD-27, AD-35). Every state is built by hand
// the way the modal interpreter leaves it after the block; nothing depends on P3.1. The
// integration test against the real index on `nc/fanuc-lathe/l01-turning-a.nc` is Wave A's
// integration (plan §5, "Integration of Wave A").

import { describe, expect, it } from 'vitest';
import type { Msg } from '$lib/app/types';
import { hasKey } from '$lib/i18n';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import type { MachineConfig, MachineParams, NumberInput } from '$lib/core/machines/types';
import { rewriteWord } from '$lib/core/nc/rewriteWord';
import { ModalIndex } from '$lib/core/nc/modal';
import type { ModalState, ModalValue } from '$lib/core/nc/types';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { expectWithin, fastest } from '../../../../tests/unit/helpers/budget';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import {
  blockRange,
  callArguments,
  checkEdit,
  checkValue,
  inspectBlock,
  INSPECTOR_STATE_KEYS,
  type BlockInspection,
  type InspectInput,
  type InspectView,
  type InspectedWord,
} from './inspect';

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

function preset(profileId: string, id: string): NumberInput {
  const found = profileOf(profileId).machineParams?.numberInput?.presets.find((p) => p.id === id);
  if (!found) throw new Error(`${profileId}: no preset ${id}`);
  return found.value;
}

function viewOf(profileId: string, o: { name?: string; params?: Partial<MachineParams> } | null = null): InspectView {
  const base = profileOf(profileId);
  const machine: MachineConfig | null = o ? { id: 'm', name: o.name ?? 'Machine', profile: profileId, params: o.params ?? {} } : null;
  const eff = effectiveMachine(base, machine, machine ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return { profile: checked.profile, cp: compileProfile(checked.profile), db: loadCodeDb(DBS[applied.codes]), machine: eff };
}

/**
 * B1: the view with every `CodeParam.block` taken out, as a user database written before it would
 * have them: one declaration per address (the first), so the inspector has to fall back to
 * pairing neighbouring blocks.
 */
function withoutBlocks(view: InspectView): InspectView {
  const codes = view.db.codes.map((entry) => {
    if (entry.blocks !== 2 || !entry.params) return entry;
    const seen = new Set<string>();
    const params = entry.params
      .filter((p) => !seen.has(p.address) && (seen.add(p.address), true))
      .map(({ block: _block, ...p }) => p);
    return { ...entry, params };
  });
  return { ...view, db: { ...view.db, codes } };
}

function mv(code: string, line = 0, from: ModalValue['from'] = 'profile'): ModalValue {
  return line === 0 ? { code, line, assumed: true, from } : { code, line, assumed: false };
}

function state(o: Partial<Omit<ModalState, 'block'>> & { block?: Partial<ModalState['block']> } = {}): ModalState {
  const { block, ...rest } = o;
  return {
    groups: {},
    feedUnit: 'unknown',
    speedUnit: 'unknown',
    distance: 'unknown',
    units: { value: 'mm', line: 0, assumed: true, from: 'profile' },
    plane: 'unknown',
    diameter: null,
    tool: null,
    feed: null,
    speed: null,
    speedLimit: null,
    activeCycle: null,
    definedCycle: null,
    modalCall: null,
    frame: null,
    tcp: null,
    pitchFeedAmbiguous: null,
    ...rest,
    block: { cycle: null, pitchFeed: false, speedLimit: false, fNotFeed: false, toolChange: false, ...block },
  };
}

function doc(text: string, line: number): InspectInput {
  const lines = text.split('\n');
  return { line, lineCount: lines.length, getLine: (n) => lines[n - 1] ?? '' };
}

function row(inspection: BlockInspection, written: string): InspectedWord {
  const found = inspection.words.find((w) => w.written === written);
  if (!found) throw new Error(`no row ${written}: ${inspection.words.map((w) => w.written).join(' | ')}`);
  return found;
}

const keys = (msgs: readonly Msg[]): string[] => msgs.map((m) => m.key.replace(/^inspector\./, ''));

/** Every message an inspection answers has an English text. */
function expectKnownKeys(inspection: BlockInspection): void {
  const all: Msg[] = [
    ...inspection.words.flatMap((w) => [...w.notes, ...(w.edit.ok ? [] : [w.edit.reason])]),
    ...inspection.state.map((s) => s.label),
  ];
  for (const msg of all) expect(hasKey(msg.key), msg.key).toBe(true);
}

// ---------------------------------------------------------------------------

describe('a packed Fanuc mill block', () => {
  const text = 'O1000\nG21 G94\nN10G0G90X50Y-20.5Z+3.F200\nG1 X50. F150';
  const after = state({
    groups: { feedmode: mv('G94', 2), units: mv('G21', 2), motion: mv('G0', 3), distance: mv('G90', 3) },
    feedUnit: 'per-minute',
    distance: 'absolute',
    units: { value: 'mm', line: 2, assumed: false },
    feed: { valueText: '200', line: 3, variable: false },
  });
  const before = state({
    groups: { feedmode: mv('G94', 2), units: mv('G21', 2) },
    feedUnit: 'per-minute',
    units: { value: 'mm', line: 2, assumed: false },
  });

  it('has one row per word, in written order, with what each one is', () => {
    const r = inspectBlock(doc(text, 3), viewOf('fanuc-gcode'), before, after);
    expect(r.firstLine).toBe(3);
    expect(r.lastLine).toBe(3);
    expect(r.words.map((w) => [w.written, w.kind, w.meaning])).toEqual([
      ['N10', 'address', 'Block number'],
      ['G0', 'code', 'Rapid positioning'],
      ['G90', 'code', 'Absolute positions'],
      ['X50', 'address', 'X axis'],
      ['Y-20.5', 'address', 'Y axis'],
      ['Z+3.', 'address', 'Z axis'],
      ['F200', 'address', 'Feed'],
    ]);
    expectKnownKeys(r);
  });

  it('shows X50 with no machine as the list of readings, not editable, and says why; Y as its value', () => {
    const r = inspectBlock(doc(text, 3), viewOf('fanuc-gcode'), before, after);
    const x = row(r, 'X50');
    expect(x.value?.effective).toBeNull();
    expect(x.value?.readings.map((reading) => [reading.preset, reading.value])).toEqual([
      ['is-b', '0.05'],
      ['is-c', '0.005'],
      ['calculator', '50'],
    ]);
    expect(x.edit).toEqual({ ok: false, reason: { key: 'inspector.why.needsMachine' } });
    expect(keys(x.notes)).toContain('note.needsMachine');
    expect(x.how).toBeUndefined();
    const y = row(r, 'Y-20.5');
    expect(y.value).toMatchObject({ cls: 'length', effective: '-20.5', unit: 'mm', readings: [] });
    expect(y.edit).toEqual({ ok: true });
    expect(y.how).toMatchObject({ cls: 'length', units: 'mm', readings: [] });
  });

  it('shows the same X50 under IS-B and under calculator input, each with the machine as the source', () => {
    const isb = inspectBlock(doc(text, 3), viewOf('fanuc-gcode', { name: 'Mill IS-B', params: { numberInput: preset('fanuc-gcode', 'is-b') } }), before, after);
    const x = row(isb, 'X50');
    expect(x.value).toMatchObject({ effective: '0.05', unit: 'mm', source: 'machine', readings: [] });
    expect(x.notes).toEqual([
      { key: 'inspector.note.noPoint', params: { step: '0.001', unit: 'mm' } },
      { key: 'inspector.note.machine', params: { name: 'Mill IS-B' } },
    ]);
    expect(x.edit.ok).toBe(true);
    const calc = inspectBlock(doc(text, 3), viewOf('fanuc-gcode', { name: 'Mill calc', params: { numberInput: preset('fanuc-gcode', 'calculator') } }), before, after);
    expect(row(calc, 'X50').value).toMatchObject({ effective: '50', source: 'machine' });
    expect(row(calc, 'X50').notes).toEqual([{ key: 'inspector.note.machine', params: { name: 'Mill calc' } }]);
  });

  it('shows X50. as editable with no machine: every preset reads it alike', () => {
    const g1 = state({ ...after, groups: { ...after.groups, motion: mv('G1', 4) } });
    const x = row(inspectBlock(doc(text, 4), viewOf('fanuc-gcode'), after, g1), 'X50.');
    expect(x.value).toMatchObject({ effective: '50', readings: [], source: 'profile' });
    expect(x.edit.ok).toBe(true);
  });

  it('notes the feed unit and the code that set it', () => {
    const f = row(inspectBlock(doc(text, 3), viewOf('fanuc-gcode'), before, after), 'F200');
    expect(f.value).toMatchObject({ cls: 'feedPerMin', effective: '200', unit: 'mm/min' });
    expect(f.notes).toEqual([{ key: 'inspector.note.feedPerMinute' }, { key: 'inspector.note.setBy', params: { code: 'G94', line: 2 } }]);
  });

  it('never lets G, M, N or O be edited', () => {
    const r = inspectBlock(doc('O1000\nN10 G0 X1. M8', 2), viewOf('fanuc-gcode'), null, state({ distance: 'absolute' }));
    expect(row(r, 'N10').edit).toEqual({ ok: false, reason: { key: 'inspector.why.blockNumber' } });
    expect(row(r, 'G0').edit).toEqual({ ok: false, reason: { key: 'inspector.why.code' } });
    expect(row(r, 'M8').edit).toEqual({ ok: false, reason: { key: 'inspector.why.code' } });
    const o = inspectBlock(doc('O1000\nN10 G0 X1. M8', 1), viewOf('fanuc-gcode'), null, state());
    expect(row(o, 'O1000').edit).toEqual({ ok: false, reason: { key: 'inspector.why.programNumber' } });
    // An unknown G code is no address word either.
    expect(row(inspectBlock(doc('G12 X1.', 1), viewOf('fanuc-gcode'), null, state()), 'G12')).toMatchObject({
      kind: 'unknown',
      edit: { ok: false, reason: { key: 'inspector.why.unknown' } },
    });
  });

  it('shows the words while the state is not known, and waits for it with the values', () => {
    const r = inspectBlock(doc(text, 3), viewOf('fanuc-gcode'), null, null);
    expect(r.stateReady).toBe(false);
    expect(r.state).toEqual([]);
    expect(r.words).toHaveLength(7);
    const y = row(r, 'Y-20.5');
    expect(y.value).toBeNull();
    expect(y.notes).toEqual([]);
    expect(y.edit).toEqual({ ok: false, reason: { key: 'inspector.why.waiting' } });
  });

  it('lists the state after the block in the fixed order, with lines, sources and what the block set', () => {
    const r = inspectBlock(doc(text, 3), viewOf('fanuc-gcode'), before, after);
    expect(r.stateReady).toBe(true);
    expect(r.state.map((s) => [s.key, s.value, s.line, s.assumed, s.setHere])).toEqual([
      ['motion', 'G0', 3, false, true],
      ['distance', 'G90', 3, false, true],
      ['units', 'G21', 2, false, false],
      ['feed', 'G94 F200', 2, false, true],
    ]);
    const order = r.state.map((s) => INSPECTOR_STATE_KEYS.indexOf(s.key as (typeof INSPECTOR_STATE_KEYS)[number]));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(r.state[0].label).toEqual({ key: 'inspector.state.motion' });
  });
});

// ---------------------------------------------------------------------------

describe('a Fanuc lathe (G-code system A)', () => {
  const text = [
    'O2001',
    'T0101 (OD ROUGH)',
    'G50 S2500',
    'G96 S220 M03',
    'G0 X52. Z2.',
    'G0 U-2. W1.',
    'G76 P020060 Q100 R0.05',
    'G76 X27.6 Z-30. R0 P1200 Q300 F1.5',
    'G0 X100. Z100.',
  ].join('\n');
  const base = {
    groups: { feedmode: mv('G99'), spindlemode: mv('G96', 4), plane: mv('G18'), motion: mv('G0', 5), spindle: mv('M3', 4) },
    feedUnit: 'per-rev' as const,
    speedUnit: 'surface' as const,
    distance: 'absolute' as const,
    plane: 'ZX' as const,
    diameter: { mode: 'on' as const, line: 0, assumed: true, from: 'profile' as const },
    tool: { station: '1', written: 'T0101', line: 2 },
    speed: { valueText: '220', line: 4, variable: false },
    speedLimit: { valueText: '2500', line: 3, variable: false },
  };
  const view = viewOf('fanuc-lathe');

  it('reads U as incremental X in diameter, W as incremental Z', () => {
    const after = state({ ...base, groups: { ...base.groups, motion: mv('G0', 6) } });
    const r = inspectBlock(doc(text, 6), view, state(base), after);
    const u = row(r, 'U-2.');
    expect(u.value).toMatchObject({ effective: '-2', unit: 'mm' });
    expect(u.notes).toEqual([
      { key: 'inspector.note.incrementalOf', params: { axis: 'X' } },
      { key: 'inspector.note.diameter' },
      { key: 'inspector.note.assumedProfile' },
    ]);
    expect(keys(row(r, 'W1.').notes)).toEqual(['note.incrementalOf']);
    expectKnownKeys(r);
  });

  it('reads X as a diameter, absolute', () => {
    const r = inspectBlock(doc(text, 5), view, state(base), state(base));
    expect(keys(row(r, 'X52.').notes)).toEqual(['note.diameter', 'note.assumedProfile']);
  });

  it('reads S under constant surface speed with its clamp, and the clamp itself', () => {
    const r = inspectBlock(doc(text, 4), view, state({ ...base, groups: { feedmode: mv('G99'), spindlemode: mv('G97') }, speedUnit: 'rpm' }), state(base));
    expect(row(r, 'S220').notes).toEqual([
      { key: 'inspector.note.surfaceSpeed' },
      { key: 'inspector.note.setBy', params: { code: 'G96', line: 4 } },
      { key: 'inspector.note.clamp', params: { value: '2500', line: 3 } },
    ]);
    const clamp = inspectBlock(doc(text, 3), view, null, state({ ...base, block: { speedLimit: true } }));
    expect(row(clamp, 'S2500').notes).toEqual([{ key: 'inspector.note.speedLimit' }]);
  });

  it('shows the two blocks of G76, each with its own parameters, the thread height among them, and F as the lead', () => {
    const first = inspectBlock(doc(text, 7), view, state(base), state({ ...base, block: { cycle: 'G76', pitchFeed: true } }));
    expect(first.cycle).toMatchObject({ code: 'G76', line: 7, role: 'runs', part: { index: 1, of: 2 } });
    // B1 (`CodeParam.block`): the first block lists the parameters of the first block only.
    const written1 = Object.fromEntries(first.cycle!.params.map((p) => [p.param.address, p.written]));
    expect(written1).toEqual({ P: '020060', Q: '100', R: '0.05' });
    expect(row(first, 'P020060')).toMatchObject({ kind: 'cycleParam', value: { cls: 'count', effective: null } });
    expect(row(first, 'P020060').meaning).toMatch(/packed/);
    expect(row(first, 'R0.05').meaning).toMatch(/^Finishing allowance/);

    const after2 = state({ ...base, block: { cycle: 'G76', pitchFeed: true } });
    const second = inspectBlock(doc(text, 8), view, state(base), after2);
    expect(second.cycle).toMatchObject({ code: 'G76', line: 8, role: 'runs', part: { index: 2, of: 2 } });
    const params2 = second.cycle!.params.map((p) => [p.param.address, p.written, p.line]);
    expect(params2).toEqual([
      ['X', '27.6', 8],
      ['U', null, null],
      ['Z', '-30.', 8],
      ['W', null, null],
      ['R', '0', 8],
      ['P', '1200', 8],
      ['Q', '300', 8],
      ['F', '1.5', 8],
    ]);
    // The second block's P is the thread height, its R the taper (B1: one label per block).
    expect(second.cycle!.params.find((p) => p.param.address === 'P')?.param.label).toMatch(/^Thread height/);
    expect(row(second, 'P1200').meaning).toMatch(/^Thread height/);
    expect(row(second, 'R0').meaning).toMatch(/^Taper/);
    const f = row(second, 'F1.5');
    expect(f).toMatchObject({ kind: 'cycleParam', value: { cls: 'feedPerRev', effective: '1.5', unit: 'mm/rev' } });
    expect(f.notes).toEqual([{ key: 'inspector.note.lead', params: { code: 'G76' } }]);
    expect(keys(row(second, 'X27.6').notes)).toEqual(['note.diameter', 'note.assumedProfile']);
    expectKnownKeys(second);
  });

  it('knows a second block that stands alone by its own words (its first block is in the machine parameters)', () => {
    const r = inspectBlock(doc('G76 X27.6 Z-30. P1200 Q300 F1.5', 1), view, null, state({ ...base, block: { cycle: 'G76', pitchFeed: true } }));
    expect(r.cycle?.part).toEqual({ index: 2, of: 2 });
    expect(row(r, 'P1200').meaning).toMatch(/^Thread height/);
  });

  it('pairs neighbouring blocks only for an entry that does not say which block a word belongs to', () => {
    const r = inspectBlock(doc('G76 X27.6 Z-30. P1200 Q300 F1.5', 1), withoutBlocks(view), null, state({ ...base, block: { cycle: 'G76', pitchFeed: true } }));
    expect(r.cycle?.part).toBeUndefined();
  });

  it('takes whole numbers for T and a count parameter, and holds a parameter to its min, never correcting', () => {
    const t = row(inspectBlock(doc(text, 2), view, null, state(base)), 'T0101');
    expect(t.edit.ok).toBe(true);
    expect(checkValue(t, '2.5', view)).toEqual({ key: 'inspector.why.wholeNumber' });
    expect(checkValue(t, '202', view)).toBeNull();
    expect(checkValue(t, '2.0', view)).toBeNull();
    const second = inspectBlock(doc(text, 8), view, null, state({ ...base, block: { cycle: 'G76', pitchFeed: true } }));
    const p = row(second, 'P1200');
    expect(checkValue(p, '1200.5', view)).toEqual({ key: 'inspector.why.wholeNumber' });
    const f = row(second, 'F1.5');
    expect(checkValue(f, '-1', view)).toEqual({ key: 'inspector.why.min', params: { min: '0' } });
    expect(checkValue(f, 'x', view)).toEqual({ key: 'inspector.why.notANumber' });
    expect(checkValue(f, '1,75', view)).toBeNull();
  });

  it('edits a value end to end: checkValue, then rewriteWord with the row\'s how', () => {
    const after = state({ ...base, groups: { ...base.groups, motion: mv('G0', 6) } });
    const u = row(inspectBlock(doc(text, 6), view, state(base), after), 'U-2.');
    expect(checkValue(u, '-2.5', view)).toBeNull();
    expect(rewriteWord('G0 U-2. W1.', u.token, '-2.5', u.how!)).toMatchObject({ ok: true, line: 'G0 U-2.5 W1.' });
  });

  it('lists the lathe state with the assumed power-on values and their source', () => {
    const r = inspectBlock(doc(text, 5), view, state(base), state(base));
    expect(r.state.map((s) => [s.key, s.value, s.line, s.assumed, s.from ?? null])).toEqual([
      ['motion', 'G0', 5, false, null],
      ['plane', 'G18', 0, true, 'profile'],
      ['distance', 'absolute', 0, false, null],
      ['units', 'mm', 0, true, 'profile'],
      ['diameter', 'on', 0, true, 'profile'],
      ['tool', 'T0101', 2, false, null],
      ['spindle', 'M3', 4, false, null],
      ['speed', 'G96 S220', 4, false, null],
      ['speedLimit', '2500', 3, false, null],
      ['feed', 'G99', 0, true, 'profile'],
    ]);
    expectKnownKeys(r);
  });
});

// ---------------------------------------------------------------------------

describe('a Klartext cycle defined over several lines', () => {
  const text = [
    '0 BEGIN PGM DRILL MM',
    '4 TOOL CALL 5 Z S3000',
    '5 CYCL DEF 200 DRILLING ~',
    '  Q200=2 ;SET-UP CLEARANCE ~',
    '  Q201=-15 ;DEPTH ~',
    '  Q206=150 ;PLUNGING FEED',
    '6 L X+10 Y+20 R0 FMAX M99',
    '7 CYCL CALL',
  ].join('\n');
  const view = viewOf('heidenhain-klartext');
  const defined = { code: 'CYCL DEF 200', line: 3, pitchFeed: false };

  it('is one block from the CYCL DEF line to the last line without ~', () => {
    for (const line of [3, 4, 5, 6]) expect(blockRange(doc(text, line), view.cp)).toEqual({ first: 3, last: 6 });
    expect(blockRange(doc(text, 7), view.cp)).toEqual({ first: 7, last: 7 });
  });

  it('shows the definition with each parameter, its value and its line', () => {
    const r = inspectBlock(doc(text, 4), view, state(), state({ definedCycle: defined }));
    expect(r.firstLine).toBe(3);
    expect(r.lastLine).toBe(6);
    expect(r.cycle).toMatchObject({ code: 'CYCL DEF 200', line: 3, role: 'defines' });
    expect(r.cycle!.params.slice(0, 4).map((p) => [p.param.address, p.written, p.line])).toEqual([
      ['Q200', '2', 4],
      ['Q201', '-15', 5],
      ['Q206', '150', 6],
      ['Q202', null, null],
    ]);
    expect(r.words.map((w) => [w.written, w.kind, w.line])).toEqual([
      ['CYCL DEF 200', 'code', 3],
      ['Q200=2', 'cycleParam', 4],
      ['Q201=-15', 'cycleParam', 5],
      ['Q206=150', 'cycleParam', 6],
    ]);
    const q201 = row(r, 'Q201=-15');
    expect(q201.meaning).toBe('Depth, negative into the material');
    expect(q201.edit.ok).toBe(true);
    // The edit writes the number only.
    expect(rewriteWord('  Q201=-15 ;DEPTH ~', q201.token, '-18', q201.how!)).toMatchObject({ ok: true, line: '  Q201=-18 ;DEPTH ~' });
    expectKnownKeys(r);
  });

  it('shows the defined cycle with its parameters where a block calls it', () => {
    const called = state({ definedCycle: defined, block: { cycle: 'CYCL DEF 200' } });
    for (const line of [7, 8]) {
      const r = inspectBlock(doc(text, line), view, state({ definedCycle: defined }), called);
      expect(r.cycle).toMatchObject({ code: 'CYCL DEF 200', line: 3, role: 'calls' });
      expect(r.cycle!.params[0]).toMatchObject({ written: '2', line: 4 });
    }
  });

  it('reads the incremental prefix and the rapid marker', () => {
    const r = inspectBlock(doc('7 L IX+10 Y+5,5 R0 FMAX', 1), view, null, state({ distance: 'absolute', feedUnit: 'per-minute' }));
    expect(row(r, 'IX+10')).toMatchObject({ kind: 'address', value: { effective: '10' } });
    expect(keys(row(r, 'IX+10').notes)).toEqual(['note.incremental']);
    expect(row(r, 'Y+5,5').value?.effective).toBe('5.5');
    expect(row(r, 'L').kind).toBe('code');
  });
});

// ---------------------------------------------------------------------------

describe('Okuma', () => {
  const view = viewOf('okuma-osp');

  it('shows SB= as an assignment with its meaning, editable as written', () => {
    const r = inspectBlock(doc('N100 G96 SB=800 S200 M13', 1), view, null, state({ feedUnit: 'per-rev', speedUnit: 'surface' }));
    const sb = row(r, 'SB=800');
    expect(sb).toMatchObject({ kind: 'assignment', meaning: 'Driven-tool speed', address: 'SB', value: { cls: null, effective: null } });
    expect(sb.edit.ok).toBe(true);
    expect(checkValue(sb, '1200', view)).toBeNull();
    expectKnownKeys(r);
  });

  it('joins a $ line to the block above and reads its F as the lead of the thread cycle', () => {
    const text = 'G0 X30 Z5\nG71 X27.55 Z-30 B60 D0.7 U0.1\n$ H2.45 L2 F2 M23\nG0 X100';
    expect(blockRange(doc(text, 3), view.cp)).toEqual({ first: 2, last: 3 });
    const after = state({ feedUnit: 'per-rev', distance: 'absolute', block: { cycle: 'G71', pitchFeed: true } });
    const r = inspectBlock(doc(text, 2), view, null, after);
    expect(r.words.map((w) => w.written)).toEqual(['G71', 'X27.55', 'Z-30', 'B60', 'D0.7', 'U0.1', 'H2.45', 'L2', 'F2', 'M23']);
    expect(row(r, 'F2')).toMatchObject({ kind: 'cycleParam', line: 3 });
    expect(keys(row(r, 'F2').notes)).toEqual(['note.lead', 'note.needsMachine']);
    expect(r.cycle?.part).toBeUndefined();
  });

  it('refuses a value finer than the 10 µm unit, never rounding it', () => {
    const tenUm = viewOf('okuma-osp', { name: 'Lathe 10um', params: { numberInput: preset('okuma-osp', 'okuma-10um') } });
    const r = inspectBlock(doc('G0 X50 Z2', 1), tenUm, null, state({ distance: 'absolute', diameter: { mode: 'on', line: 0, assumed: true, from: 'profile' } }));
    const x = row(r, 'X50');
    expect(x.value).toMatchObject({ effective: '0.5', source: 'machine' });
    // A unit that scales a word with a point too counts every number in it (the hover's wording).
    expect(keys(x.notes)).toEqual(['note.diameter', 'note.scaled', 'note.machine', 'note.assumedProfile']);
    expect(x.notes).toContainEqual({ key: 'inspector.note.scaled', params: { step: '0.01', unit: 'mm' } });
    expect(checkValue(x, '0.015', tenUm)).toBeNull();
    expect(rewriteWord('G0 X50 Z2', x.token, '0.015', x.how!)).toEqual({
      ok: false,
      reason: { key: 'machines.numbers.rounded', params: { increment: '0.01' } },
    });
  });
});

// ---------------------------------------------------------------------------

describe('Sinumerik', () => {
  const view = viewOf('sinumerik');

  it('shows a cycle call as one row and its arguments by position', () => {
    const r = inspectBlock(doc('N10 CYCLE83(50,0,1,-20,,5,,1,0,0,1,0) ; drill', 1), view, null, state({ block: { cycle: 'CYCLE83' } }));
    expect(r.words.map((w) => [w.written, w.kind])).toEqual([
      ['N10', 'address'],
      ['CYCLE83(50,0,1,-20,,5,,1,0,0,1,0)', 'call'],
    ]);
    expect(row(r, 'CYCLE83(50,0,1,-20,,5,,1,0,0,1,0)').edit).toEqual({ ok: false, reason: { key: 'inspector.why.call' } });
    expect(r.cycle).toMatchObject({ code: 'CYCLE83', line: 1, role: 'runs' });
    expect(r.cycle!.params.slice(0, 12).map((p) => [p.param.address, p.written])).toEqual([
      ['RTP', '50'],
      ['RFP', '0'],
      ['SDIS', '1'],
      ['DP', '-20'],
      ['DPR', null],
      ['FDEP', '5'],
      ['FDPR', null],
      ['_DAM', '1'],
      ['DTB', '0'],
      ['DTS', '0'],
      ['FRF', '1'],
      ['VARI', '0'],
    ]);
    expect(r.cycle!.params.slice(12).every((p) => p.written === null && p.line === null)).toBe(true);
    expectKnownKeys(r);
  });

  it('labels X a radius under DIAMOF', () => {
    const after = state({ feedUnit: 'per-rev', distance: 'absolute', diameter: { mode: 'off', line: 1, assumed: false }, groups: { diametermode: mv('DIAMOF', 1) } });
    const r = inspectBlock(doc('DIAMOF\nG1 X20 Z-3', 2), view, after, after);
    expect(keys(row(r, 'X20').notes)).toEqual(['note.radius']);
    expect(r.state.find((s) => s.key === 'diameter')).toMatchObject({ value: 'DIAMOF', line: 1, setHere: false });
  });

  it('labels X a radius under DIAM90 with G91, and a diameter under DIAM90 with G90', () => {
    const d90 = { mode: 'absolute-only' as const, line: 1, assumed: false };
    const g91 = state({ distance: 'incremental', diameter: d90, groups: { diametermode: mv('DIAM90', 1), distance: mv('G91', 1) } });
    const r = inspectBlock(doc('DIAM90 G91 X5', 1), view, null, g91);
    expect(keys(row(r, 'X5').notes)).toEqual(['note.incremental', 'note.radius']);
    const g90 = state({ distance: 'absolute', diameter: d90, groups: { diametermode: mv('DIAM90', 1), distance: mv('G90', 1) } });
    expect(keys(row(inspectBlock(doc('DIAM90 G90 X5', 1), view, null, g90), 'X5').notes)).toEqual(['note.diameter']);
  });

  it('shows S1= and LIMS= as values, M1=3 as a code', () => {
    const r = inspectBlock(doc('LIMS=3000 S1=2400 M1=3', 1), view, null, state({ speedUnit: 'rpm' }));
    expect(row(r, 'LIMS=3000')).toMatchObject({ kind: 'assignment' });
    expect(keys(row(r, 'LIMS=3000').notes)).toEqual(['note.speedLimit']);
    expect(row(r, 'S1=2400')).toMatchObject({ kind: 'assignment', meaning: 'Spindle speed' });
    expect(row(r, 'M1=3')).toMatchObject({ kind: 'code', edit: { ok: false } });
  });

  it('shows an expression as a variable, not editable', () => {
    const r = inspectBlock(doc('G1 X=IC(5) Z-3', 1), view, null, state({ distance: 'absolute' }));
    expect(row(r, 'X=IC(5)')).toMatchObject({ kind: 'variable', edit: { ok: false, reason: { key: 'inspector.why.variable' } } });
  });
});

// ---------------------------------------------------------------------------

describe('checkEdit and checkValue', () => {
  const view = viewOf('fanuc-gcode');
  const r = inspectBlock(doc('G43 H1 D2 X10. T3 M6', 1), view, null, state({ distance: 'absolute' }));

  it('takes whole numbers for the register words written as numbers', () => {
    for (const written of ['H1', 'D2', 'T3']) {
      const w = row(r, written);
      expect(checkEdit(w)).toEqual({ ok: true });
      expect(checkValue(w, '1.5', view)).toEqual({ key: 'inspector.why.wholeNumber' });
      expect(checkValue(w, '4', view)).toBeNull();
    }
    expect(checkValue(row(r, 'X10.'), '1.5', view)).toBeNull();
  });

  it('answers the refusal of a row that cannot be edited', () => {
    expect(checkValue(row(r, 'G43'), '44', view)).toEqual({ key: 'inspector.why.code' });
  });

  it('holds a parameter to its max', () => {
    const w = { ...row(r, 'X10.'), param: { address: 'X', label: 'test', min: -1.5, max: 2.25 } };
    expect(checkValue(w, '2.25', view)).toBeNull();
    expect(checkValue(w, '2.2501', view)).toEqual({ key: 'inspector.why.max', params: { max: '2.25' } });
    expect(checkValue(w, '-1.6', view)).toEqual({ key: 'inspector.why.min', params: { min: '-1.5' } });
  });
});

describe('callArguments', () => {
  it('splits at top-level commas only', () => {
    expect(callArguments('50,0,1,-20,,5')).toEqual(['50', '0', '1', '-20', '', '5']);
    expect(callArguments('R1*(2,3), "A,B" ,7')).toEqual(['R1*(2,3)', '"A,B"', '7']);
    expect(callArguments('')).toEqual([]);
  });
});

describe('the budget (X17: the inspector updates within 30 ms per cursor move)', () => {
  it('inspects a block deep in a 300k-line program in a few milliseconds', () => {
    const view = viewOf('fanuc-lathe');
    const lines = Array.from({ length: 300_000 }, (_, i) => `N${i + 1} G1 X${(i % 90) + 10}.5 Z-${i % 50}. F0.2`);
    const input: InspectInput = { line: 150_000, lineCount: lines.length, getLine: (n) => lines[n - 1] };
    const after = state({ feedUnit: 'per-rev', distance: 'absolute', groups: { motion: mv('G1', 150_000), feedmode: mv('G99') } });
    const ms = fastest(5, () => inspectBlock(input, view, after, after));
    expectWithin(ms, 10, 'inspectBlock at line 150,000 of 300,000');
  });

  it('stops a block that never ends after MAX_BLOCK_LINES each way', () => {
    const view = viewOf('heidenhain-klartext');
    const lines = Array.from({ length: 5_000 }, (_, i) => `  Q${200 + (i % 100)}=${i} ~`);
    const input: InspectInput = { line: 2_500, lineCount: lines.length, getLine: (n) => lines[n - 1] };
    expect(blockRange(input, view.cp)).toEqual({ first: 2_000, last: 3_000 });
    const ms = fastest(3, () => inspectBlock(input, view, null, state()));
    expectWithin(ms, 30, 'inspectBlock over 1,001 continued lines');
  });
});

// ---------------------------------------------------------------------------
// Words read in the state the interpreter reaches (the index built over the whole text)
// ---------------------------------------------------------------------------

/** The inspection of the block at `line`, with the states the real index answers. */
function inspectReal(
  profileId: string,
  text: string,
  line: number,
  o: Parameters<typeof viewOf>[1] = null,
  change: (view: InspectView) => InspectView = (v) => v,
): BlockInspection {
  const view = change(viewOf(profileId, o));
  const lines = text.split('\n');
  const index = new ModalIndex(view.cp, view.db);
  index.reset(lines.length, (n) => lines[n - 1] ?? '');
  while (!index.buildSome(1_000)) {
    // until the whole text is read
  }
  const input = doc(text, line);
  const { first, last } = blockRange(input, view.cp);
  const r = inspectBlock(input, view, index.stateAfter(first - 1), index.stateAfter(last));
  expectKnownKeys(r);
  return r;
}

const noteKeys = (r: BlockInspection, written: string): string[] => keys(row(r, written).notes);

describe('reference returns: the words are an intermediate point in the program', () => {
  const text = 'G90 G54 G00 X0. Y0.\nG28 G91 Z0.\nG90 G28 X0. Y0.\nG53 Z0.';

  it('names G28 words an intermediate point, absolute or incremental, and G53 machine coordinates', () => {
    const z = noteKeys(inspectReal('fanuc-gcode', text, 2), 'Z0.');
    expect(z).toContain('note.incremental');
    expect(z).toContain('note.axisVia');
    expect(z).not.toContain('note.axisMachine');
    expect(noteKeys(inspectReal('fanuc-gcode', text, 3), 'X0.')).toEqual(['note.axisVia']);
    expect(noteKeys(inspectReal('fanuc-gcode', text, 4), 'Z0.')).toEqual(['note.axisMachine']);
  });

  it('keeps the incremental twin of a lathe and calls it no machine position either', () => {
    const u = noteKeys(inspectReal('fanuc-lathe', 'G0 X50. Z2.\nG28 U0. W0.', 2), 'U0.');
    expect(u).toContain('note.incrementalOf');
    expect(u).toContain('note.axisVia');
    expect(u).not.toContain('note.axisMachine');
  });
});

describe('a value of a code whose axis words are data is no move and no diameter', () => {
  it('never calls the depth of cut of a G71 first block a diameter or an incremental X', () => {
    const u = noteKeys(inspectReal('fanuc-lathe', 'G71 U2. R1.\nG71 P10 Q20 U0.5 W0.1 F0.25', 1), 'U2.');
    expect(u).not.toContain('note.diameter');
    expect(u).not.toContain('note.incrementalOf');
  });

  it('never calls a dwell time a diameter, and keeps the diameter of a coordinate setting', () => {
    for (const [text, written] of [['G04 U1.5', 'U1.5'], ['G04 X1.5', 'X1.5']]) {
      const notes = noteKeys(inspectReal('fanuc-lathe', text, 1), written);
      expect(notes, text).not.toContain('note.diameter');
      expect(notes, text).not.toContain('note.incrementalOf');
    }
    expect(noteKeys(inspectReal('fanuc-lathe', 'G50 X100. Z200.', 1), 'X100.')).toContain('note.diameter');
  });

  it('notes a diameter on a length only, as the hover does', () => {
    // A code that reads X as a time without making the axis words data: the class says it.
    const lathe = viewOf('fanuc-lathe');
    const db = loadCodeDb({
      dialect: 'x',
      version: 1,
      codes: [{ code: 'G4', group: 'nonmodal', label: 'Dwell', params: [{ address: 'X', unit: 'dwell', label: 'Dwell time' }] }],
    });
    const after = state({ distance: 'absolute', diameter: { mode: 'on', line: 0, assumed: true, from: 'profile' } });
    const x = row(inspectBlock(doc('G4 X1.5', 1), { ...lathe, db }, null, after), 'X1.5');
    expect(x.value?.cls).toBe('dwell');
    expect(keys(x.notes)).not.toContain('note.diameter');
  });

  it('leaves the radius of a milling profile unsaid, as the hover does', () => {
    expect(noteKeys(inspectReal('sinumerik-mill', 'G0 X0 Y0 Z50', 1), 'X0')).not.toContain('note.radius');
  });
});

describe('a cycle made modal by MCALL', () => {
  const text = 'G0 X0 Y0 Z5\nMCALL CYCLE83(5,0,2,-18,,-5,,2,0,0.5,1,0)\nX20 Y20\nMCALL';

  it('defines the cycle on the MCALL line and runs it at the positions, with the parameters written there', () => {
    const at = inspectReal('sinumerik-mill', text, 2);
    expect(at.cycle).toMatchObject({ code: 'CYCLE83', role: 'defines', line: 2 });
    const pos = inspectReal('sinumerik-mill', text, 3);
    expect(pos.cycle).toMatchObject({ code: 'CYCLE83', role: 'runs', line: 2 });
    expect(pos.cycle?.params[0]).toMatchObject({ written: '5', line: 2 });
    expect(pos.state.find((s) => s.key === 'cycle')).toMatchObject({ value: 'CYCLE83', line: 2 });
    expect(inspectReal('sinumerik-mill', text, 4).state.find((s) => s.key === 'cycle')).toBeUndefined();
  });
});

describe('Klartext words that are no numbers', () => {
  it('reads the sign of DR+ as a direction, not a variable', () => {
    const dr = row(inspectReal('heidenhain-klartext', 'CC X+0 Y+0\nC X+0 Y+50 DR+', 2), 'DR+');
    expect(dr.kind).toBe('address');
    expect(keys(dr.notes)).not.toContain('note.variable');
    expect(dr.edit).toEqual({ ok: false, reason: { key: 'inspector.why.noValue' } });
  });

  it('reads a cycle feed written as a word as written, not a variable', () => {
    const text = ['5 CYCL DEF 203 UNIVERSAL DRILLING ~', '  Q200=2 ;SET-UP CLEARANCE ~', '  Q206=FAUTO ;PLUNGING FEED ~', '  Q208=+FMAX ;RETRACTION FEED'].join('\n');
    const r = inspectReal('heidenhain-klartext', text, 1);
    expect(r.cycle?.params.find((p) => p.param.address === 'Q206')).toMatchObject({ written: 'FAUTO', line: 3 });
    expect(r.cycle?.params.find((p) => p.param.address === 'Q208')).toMatchObject({ written: '+FMAX', line: 4 });
    const q206 = r.words.find((w) => w.address === 'Q206')!;
    expect(q206.kind).toBe('cycleParam');
    expect(keys(q206.notes)).not.toContain('note.variable');
    expect(q206.edit).toEqual({ ok: false, reason: { key: 'inspector.why.noValue' } });
    // An expression stays a variable.
    const expr = inspectReal('heidenhain-klartext', '5 CYCL DEF 200 DRILLING ~\n  Q206=Q1+5 ;PLUNGING FEED', 1);
    expect(expr.cycle?.params.find((p) => p.param.address === 'Q206')?.written).toBeNull();
  });
});

describe('the code a feed unit comes from', () => {
  it('never names a feed-unit code that says the opposite of the class (Okuma G101 under G95)', () => {
    const f = row(inspectReal('okuma-osp', 'G95\nG101 X40 C90 F100', 2), 'F100');
    expect(f.value?.cls).toBe('feedPerMin');
    expect(f.notes).toContainEqual({ key: 'inspector.note.setBy', params: { code: 'G101', line: 2 } });
    expect(f.notes.some((n) => n.params?.code === 'G95')).toBe(false);
    const g94 = row(inspectReal('okuma-osp', 'G94\nG101 X40 C90 F100', 2), 'F100');
    expect(g94.notes).toContainEqual({ key: 'inspector.note.setBy', params: { code: 'G94', line: 1 } });
  });
});

describe('a threading move in force is no cycle', () => {
  it('shows the move in the motion row and leaves the cycle row to the cycle group', () => {
    const r = inspectReal('fanuc-lathe', 'G99\nG32 Z-20. F1.5\nX40.', 3);
    expect(r.state.find((s) => s.key === 'motion')?.value).toBe('G32');
    expect(r.state.find((s) => s.key === 'cycle')?.value).not.toBe('G32');
  });
});

describe('the two blocks of a lathe cycle over a comment or a blank line', () => {
  for (const between of ['(ROUGH)', '', '   ', '(A)\n(B)']) {
    it(`pairs across ${JSON.stringify(between)}`, () => {
      const text = `G71 U2. R1.\n${between}\nG71 P10 Q20 U0.5 W0.1 F0.25`;
      const lastLine = text.split('\n').length;
      expect(inspectReal('fanuc-lathe', text, 1).cycle?.part).toEqual({ index: 1, of: 2 });
      expect(inspectReal('fanuc-lathe', text, lastLine).cycle?.part).toEqual({ index: 2, of: 2 });
    });
  }

  it('does not pair across a block that moves (an entry without CodeParam.block)', () => {
    const text = 'G71 U2. R1.\nG00 X40.\nG71 P10 Q20 U0.5 W0.1 F0.25';
    expect(inspectReal('fanuc-lathe', text, 1, null, withoutBlocks).cycle?.part).toBeUndefined();
    expect(inspectReal('fanuc-lathe', text, 3, null, withoutBlocks).cycle?.part).toBeUndefined();
  });

  it('tells the blocks apart by their own words wherever they stand (B1, CodeParam.block)', () => {
    const text = 'G71 U2. R1.\nG00 X40.\nG71 P10 Q20 U0.5 W0.1 F0.25';
    const first = inspectReal('fanuc-lathe', text, 1);
    const second = inspectReal('fanuc-lathe', text, 3);
    expect(first.cycle?.part).toEqual({ index: 1, of: 2 });
    expect(second.cycle?.part).toEqual({ index: 2, of: 2 });
    // The same U is the depth of cut in the first block and the allowance on X in the second.
    expect(row(first, 'U2.').meaning).toMatch(/^Depth of cut per pass, a radius value/);
    expect(row(second, 'U0.5').meaning).toMatch(/^Finishing allowance on X, read like X/);
    expect(first.cycle?.params.map((p) => p.param.address)).toEqual(['U', 'R']);
    expect(second.cycle?.params.map((p) => p.param.address)).toEqual(['P', 'Q', 'U', 'W', 'F']);
    // A first block without R (its retract stays in force) is still the first: U alone.
    expect(inspectReal('fanuc-lathe', 'G71 U1.5', 1).cycle?.part).toEqual({ index: 1, of: 2 });
  });

  it('reads the R of G74 by block: the back-off in the first, the relief at the bottom in the second', () => {
    const text = 'G74 R0.5\nG74 X0 Z-30. Q5000 R0.2 F0.1\nG74 Z-30. Q5000 F0.1';
    expect(row(inspectReal('fanuc-lathe', text, 1), 'R0.5').meaning).toMatch(/^Back-off after each peck/);
    expect(row(inspectReal('fanuc-lathe', text, 2), 'R0.2').meaning).toMatch(/^Relief at the bottom/);
    // Without X and P it is a peck drilling block, still the second (it writes Z, Q and F).
    expect(inspectReal('fanuc-lathe', text, 3).cycle?.part).toEqual({ index: 2, of: 2 });
  });
});

describe('register numbers are never negative', () => {
  it('refuses a minus sign on the tool, D and H words', () => {
    const lathe = viewOf('fanuc-lathe');
    const t = row(inspectBlock(doc('T0101', 1), lathe, null, state()), 'T0101');
    expect(checkValue(t, '-202', lathe)).toEqual({ key: 'inspector.why.min', params: { min: '0' } });
    expect(checkValue(t, '-0', lathe)).toEqual({ key: 'inspector.why.min', params: { min: '0' } });
    expect(checkValue(t, '+202', lathe)).toBeNull();
    const mill = viewOf('fanuc-gcode');
    const r = inspectBlock(doc('G43 H1 D2 T3 M6', 1), mill, null, state({ distance: 'absolute' }));
    for (const written of ['D2', 'T3', 'H1']) {
      expect(checkValue(row(r, written), '-3', mill), written).toMatchObject({ key: 'inspector.why.min' });
      expect(checkValue(row(r, written), '3', mill), written).toBeNull();
    }
  });
});
