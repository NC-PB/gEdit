// P3.8: cycle forms (Phase 3 plan §6.11, AD-39). The goldens of `tests/fixtures/cycleforms/`
// (one per dialect: edit, no-op, clear, refusals, insert) run through the real modal index, and
// the rules the goldens do not reach are pinned here.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Msg } from '$lib/app/types';
import { hasKey } from '$lib/i18n';
import { blockRange, type InspectInput, type InspectView } from '$lib/core/codes/inspect';
import { loadCodeDb } from '$lib/core/codes/load';
import { lookupCode } from '$lib/core/codes/lookup';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { CodeDb } from '$lib/core/codes/types';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import type { MachineConfig, MachineParams } from '$lib/core/machines/types';
import { ModalIndex } from '$lib/core/nc/modal';
import type { ModalState } from '$lib/core/nc/types';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { profileOf } from '../../../../tests/unit/helpers/profiles';
import { applyCycleForm, CYCLE_FORM_REFUSALS, CYCLE_FORM_WHOLE, cycleEntries, cycleFormAt, cycleFormFor } from './cycleForm';
import type { CycleForm, TemplateEnv } from './types';

const ROOT = join(__dirname, '../../../../tests/fixtures/cycleforms');
const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** The document's effective view; `machine.numberInput` may name one of the profile's presets. */
function viewOf(profileId: string, machine: Record<string, unknown> | null = null, db?: (db: CodeDb) => CodeDb): InspectView {
  const base = profileOf(profileId);
  let params: Partial<MachineParams> | null = null;
  if (machine) {
    params = { ...machine } as Partial<MachineParams>;
    if (typeof machine.numberInput === 'string') {
      const preset = base.machineParams?.numberInput?.presets.find((p) => p.id === machine.numberInput);
      if (!preset) throw new Error(`${profileId}: no preset ${String(machine.numberInput)}`);
      params.numberInput = preset.value;
    }
  }
  const config: MachineConfig | null = params ? { id: 'm', name: 'Machine', profile: profileId, params } : null;
  const eff = effectiveMachine(base, config, config ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const loaded = loadCodeDb(DBS[applied.codes]);
  return { profile: checked.profile, cp: compileProfile(checked.profile), db: db ? db(loaded) : loaded, machine: eff };
}

interface Doc {
  input: InspectInput;
  after: ModalState | null;
  lines: string[];
}

/** The document, the cursor and the state after the cursor's block, from the real modal index. */
function docOf(view: InspectView, lines: string[], line: number): Doc {
  const index = new ModalIndex(view.cp, view.db);
  index.reset(lines.length, (n) => lines[n - 1] ?? '');
  while (!index.buildSome(1_000)) {
    // until the whole text is read
  }
  const input: InspectInput = { line, lineCount: lines.length, getLine: (n) => lines[n - 1] ?? '' };
  const { last } = blockRange(input, view.cp);
  return { input, after: index.stateAfter(last), lines };
}

function linesOf(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function envOf(view: InspectView, env: { prevBlockNumber: number | null; numbered: boolean }): TemplateEnv {
  return { cp: view.cp, prevBlockNumber: env.prevBlockNumber, numbered: env.numbered, sys: { date: '', time: '', file: '', stem: '' } };
}

function keyed(errors: Record<string, Msg>): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, v.key]));
}

// ---------------------------------------------------------------------------------------------
// The goldens
// ---------------------------------------------------------------------------------------------

interface Golden {
  $format: 1;
  about: string;
  input: string | string[];
  line: number;
  machine?: Record<string, unknown>;
  insert?: { code: string; env: { prevBlockNumber: number | null; numbered: boolean } };
  form?: { values: Record<string, string>; kept: string[] };
  values: Record<string, string>;
  expected:
    | { first: number; last: number; lines: string[] }
    | { refused: string; params?: Record<string, unknown> }
    | { errors: Record<string, string> };
}

function goldens(): { name: string; profile: string; file: string; golden: Golden }[] {
  const out: { name: string; profile: string; file: string; golden: Golden }[] = [];
  for (const profile of readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    for (const name of readdirSync(join(ROOT, profile)).filter((f) => f.endsWith('.json')).sort()) {
      const file = join(ROOT, profile, name);
      out.push({ name: `${profile}/${name}`, profile, file, golden: JSON.parse(readFileSync(file, 'utf8')) as Golden });
    }
  }
  return out;
}

describe('the cycle-form goldens (tests/fixtures/cycleforms)', () => {
  const all = goldens();

  it('has a golden for each dialect, an insert for each, and the cases the plan names', () => {
    const names = all.map((g) => g.name);
    for (const profile of ['fanuc-gcode', 'fanuc-lathe', 'heidenhain-klartext', 'sinumerik', 'okuma-osp']) {
      expect(names.some((n) => n.startsWith(`${profile}/`)), profile).toBe(true);
    }
    for (const profile of ['fanuc-gcode', 'heidenhain-klartext', 'sinumerik', 'okuma-osp']) {
      expect(all.some((g) => g.profile === profile && g.golden.insert), `${profile} insert`).toBe(true);
    }
    expect(names).toEqual(
      expect.arrayContaining([
        'fanuc-gcode/f01-g83-edit.json',
        'fanuc-gcode/f01-g83-noop.json',
        'fanuc-gcode/f02-packed-g81.json',
        'fanuc-gcode/pointless-no-machine.json',
        'fanuc-lathe/l01-g71-first-refused.json',
        'fanuc-lathe/l01-g76-second-refused.json',
        'heidenhain-klartext/h01-cycl-def-200-edit.json',
        'heidenhain-klartext/q202-added.json',
        'sinumerik/s02-cycle83-edit.json',
        'okuma-osp/o03-g181-edit.json',
      ]),
    );
  });

  it.each(all.map((g) => [g.name, g] as const))('%s', (_name, { profile, file, golden }) => {
    expect(golden.$format).toBe(1);
    const view = viewOf(profile, golden.machine ?? null);
    const lines = Array.isArray(golden.input) ? golden.input : linesOf(readFileSync(join(dirname(file), golden.input), 'utf8'));
    const doc = docOf(view, lines, golden.line);
    const expected = golden.expected;

    let form: CycleForm;
    if (golden.insert) {
      const entry = lookupCode(view.db, golden.insert.code);
      expect(entry, golden.insert.code).not.toBeNull();
      form = cycleFormFor(entry!, view);
      expect(form.mode).toBe('insert');
      expect(Object.values(form.values).every((v) => v === '')).toBe(true);
    } else {
      const at = cycleFormAt(doc.input, view, doc.after);
      expect(at, 'a cycle at the cursor').not.toBeNull();
      if ('refused' in expected) {
        expect(at).toEqual({ ok: false, reason: expected.params ? { key: expected.refused, params: expected.params } : { key: expected.refused } });
        expect(hasKey(expected.refused)).toBe(true);
        return;
      }
      if (!at!.ok) throw new Error(`refused: ${at!.reason.key}`);
      form = at!.form;
      expect(form.mode).toBe('edit');
      if (golden.form) {
        expect(form.values).toEqual(golden.form.values);
        expect(form.kept).toEqual(golden.form.kept);
      }
      // The fields: one per parameter in database order, keyed by the address.
      expect(form.fields.map((f) => f.id)).toEqual((form.entry.params ?? []).map((p) => p.address));
    }

    const env = golden.insert ? envOf(view, golden.insert.env) : undefined;
    const edit = applyCycleForm(form, golden.values, doc.input, view, doc.after, env);
    if ('errors' in expected) {
      expect(edit.ok).toBe(false);
      if (!edit.ok) {
        expect(keyed(edit.errors)).toEqual(expected.errors);
        for (const key of Object.values(expected.errors)) expect(hasKey(key), key).toBe(true);
      }
      return;
    }
    if ('refused' in expected) throw new Error('a refusal needs a cursor, not an insert');
    expect(edit).toEqual({ ok: true, first: expected.first, last: expected.last, lines: expected.lines });

    // Only the block changes; a no-op gives every byte back.
    if (!golden.insert) {
      const block = doc.lines.slice(expected.first - 1, expected.last);
      const changed = Object.entries(golden.values).some(([k, v]) => (form.values[k] ?? '') !== v.trim());
      if (!changed) expect(edit.ok && edit.lines).toEqual(block);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The rules the goldens do not reach
// ---------------------------------------------------------------------------------------------

const F01 = linesOf(readFileSync(join(ROOT, '../nc/fanuc/f01-mill-3tools.nc'), 'utf8'));

describe('which cycles (rule 1)', () => {
  it('lists the cycles with parameters in database order, without verify, two-block or parameter-less entries', () => {
    const view = viewOf('okuma-osp');
    const codes = cycleEntries(view.db).map((e) => e.code);
    expect(codes).toContain('G181');
    expect(codes).not.toContain('G107'); // verify
    expect(codes).not.toContain('G178'); // no parameters
    const order = view.db.codes.map((e) => e.code);
    expect(codes).toEqual([...codes].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(cycleEntries(viewOf('heidenhain-klartext').db).map((e) => e.code)).toContain('CYCL DEF 200');
    expect(cycleEntries(viewOf('sinumerik').db).map((e) => e.code)).toContain('CYCLE83');
    expect(cycleEntries(viewOf('sinumerik').db, 'mill').length).toBe(cycleEntries(viewOf('sinumerik').db).length);
  });

  it('leaves out a two-block cycle once the database marks it (blocks: 2, P3.6)', () => {
    const flagged = viewOf('fanuc-lathe', null, (db) => ({ ...db, codes: db.codes.map((e) => (['G71', 'G76'].includes(e.code) ? { ...e, blocks: 2 as const } : e)) }));
    const codes = cycleEntries(flagged.db).map((e) => e.code);
    expect(codes).not.toContain('G71');
    expect(codes).not.toContain('G76');
    expect(codes).toContain('G70');
  });

  it('refuses a lone G71 block through the flag, where the pairing heuristic has nothing to pair', () => {
    const lines = ['%', 'O2000', 'N10 G50 S2000', 'N20 G71 P100 Q200 U0.4 W0.1 F0.25', 'N30 G0 X100. Z100.'];
    // The shipped database carries the flag (P3.6); the unflagged copy is the pairing heuristic alone.
    const plain = viewOf('fanuc-lathe', null, (db) => ({ ...db, codes: db.codes.map((e) => (e.code === 'G71' ? { ...e, blocks: undefined } : e)) }));
    const flagged = viewOf('fanuc-lathe');
    expect(flagged.db.codes.find((e) => e.code === 'G71')?.blocks).toBe(2);
    const a = docOf(plain, lines, 4);
    expect(cycleFormAt(a.input, plain, a.after)).toMatchObject({ ok: true });
    const b = docOf(flagged, lines, 4);
    expect(cycleFormAt(b.input, flagged, b.after)).toEqual({ ok: false, reason: CYCLE_FORM_REFUSALS.twoBlocks });
  });

  it('refuses a verify entry and one without parameters, and has nothing for a block without a cycle', () => {
    const view = viewOf('okuma-osp', { numberInput: 'okuma-1mm' });
    const verify = docOf(view, ['G107 C10'], 1);
    expect(cycleFormAt(verify.input, view, verify.after)).toEqual({ ok: false, reason: CYCLE_FORM_REFUSALS.verify });
    const none = docOf(view, ['G178 X10'], 1);
    expect(cycleFormAt(none.input, view, none.after)).toEqual({ ok: false, reason: CYCLE_FORM_REFUSALS.noParams });
    const plain = docOf(view, ['G00 X50 Z5'], 1);
    expect(cycleFormAt(plain.input, view, plain.after)).toBeNull();
    const fanuc = viewOf('fanuc-gcode');
    const after = docOf(fanuc, F01, 45); // after G80
    expect(cycleFormAt(after.input, fanuc, after.after)).toBeNull();
    const empty: InspectInput = { line: 1, lineCount: 0, getLine: () => '' };
    expect(cycleFormAt(empty, fanuc, null)).toBeNull();
  });

  it('refuses a block too long to edit in a form', () => {
    const view = viewOf('fanuc-gcode');
    const long = docOf(view, [`G81 X1. Y1. Z-1. R1. F100. (${'X'.repeat(5000)})`], 1);
    expect(cycleFormAt(long.input, view, long.after)).toEqual({ ok: false, reason: CYCLE_FORM_REFUSALS.tooLong });
  });

  it('every refusal and error it answers has an English text', () => {
    for (const msg of Object.values(CYCLE_FORM_REFUSALS)) expect(hasKey(msg.key), msg.key).toBe(true);
  });
});

describe('the fields (rule 3)', () => {
  it('labels each field with its address and the database label, typed by its parameter', () => {
    const view = viewOf('fanuc-gcode');
    const doc = docOf(view, F01, 39);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    const q = at.form.fields.find((f) => f.id === 'Q');
    expect(q).toMatchObject({ id: 'Q', type: 'number', label: 'Q — Peck depth', required: true, min: 0, default: '4.' });
    expect(at.form.fields.find((f) => f.id === 'K')).toMatchObject({ type: 'integer', default: '' });
  });

  it('shows a value written as a variable, an expression or a word read-only, and keeps it', () => {
    const view = viewOf('fanuc-gcode');
    const lines = ['%', 'O1000', 'N20 G98 G83 X1. Y1. Z#101 R2. Q4. F100. H5'];
    const doc = docOf(view, lines, 3);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    expect(at.form.fields.find((f) => f.id === 'Z')).toMatchObject({ type: 'text', readOnly: true, default: '#101' });
    expect(at.form.kept).toEqual(['H5']);
    const changed = applyCycleForm(at.form, { Z: '-5.' }, doc.input, view, doc.after);
    expect(changed).toEqual({ ok: false, errors: { Z: CYCLE_FORM_REFUSALS.variable } });
    const other = applyCycleForm(at.form, { Q: '3.' }, doc.input, view, doc.after);
    expect(other).toEqual({ ok: true, first: 3, last: 3, lines: ['N20 G98 G83 X1. Y1. Z#101 R2. Q3. F100. H5'] });

    const k = viewOf('heidenhain-klartext');
    const kl = ['0 BEGIN PGM X MM', '1 CYCL DEF 200 DRILLING ~', '   Q200=2 ;C ~', '   Q201=-15 ;D ~', '   Q206=FAUTO ;F ~', '   Q202=5 ;P ~', '   Q210=0 ;T ~', '   Q203=+0 ;S ~', '   Q204=50 ;C2 ~', '   Q211=0 ;B', '2 END PGM X MM'];
    const kd = docOf(k, kl, 2);
    const ka = cycleFormAt(kd.input, k, kd.after);
    if (!ka?.ok) throw new Error('no form');
    expect(ka.form.fields.find((f) => f.id === 'Q206')).toMatchObject({ readOnly: true, default: 'FAUTO' });
  });

  it('refuses what is no number, a value under the minimum and a fraction in a count', () => {
    const view = viewOf('fanuc-gcode');
    const doc = docOf(view, F01, 39);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    const r = applyCycleForm(at.form, { Q: 'abc', F: '-5', K: '1.5' }, doc.input, view, doc.after);
    expect(r.ok === false && keyed(r.errors)).toEqual({ Q: 'inspector.why.notANumber', F: 'inspector.why.min', K: 'inspector.why.wholeNumber' });
  });

  it('a value typed as a number is taken as its text; a value not given is unchanged', () => {
    const view = viewOf('fanuc-gcode');
    const doc = docOf(view, F01, 39);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    expect(applyCycleForm(at.form, { R: 2.5, K: 3 }, doc.input, view, doc.after)).toEqual({
      ok: true,
      first: 39,
      last: 39,
      lines: ['G98 G83 X20. Y60. Z-18. R2.5 Q4. F240. K3'],
    });
    expect(applyCycleForm(at.form, { R: undefined }, doc.input, view, doc.after)).toMatchObject({ ok: true, lines: [F01[38]] });
  });
});

describe('writing back (rules 4–8)', () => {
  it('refuses when the block changed since the form was read', () => {
    const view = viewOf('fanuc-gcode');
    const doc = docOf(view, F01, 39);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    const moved = docOf(view, ['(NEW LINE)', ...F01], 39);
    expect(applyCycleForm(at.form, { Q: '5' }, moved.input, view, moved.after)).toEqual({ ok: false, errors: { [CYCLE_FORM_WHOLE]: CYCLE_FORM_REFUSALS.changed } });
    const gone = docOf(view, F01.slice(0, 20), 10);
    expect(applyCycleForm(at.form, { Q: '5' }, gone.input, view, gone.after)).toEqual({ ok: false, errors: { [CYCLE_FORM_WHOLE]: CYCLE_FORM_REFUSALS.changed } });
  });

  it('removes a cleared optional word with one space, the one after it, else the one before', () => {
    const view = viewOf('fanuc-gcode');
    const lines = ['%', 'O1000', 'N20 G98 G81 X1. Y1. Z-5. R2. F100. K2'];
    const doc = docOf(view, lines, 3);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    expect(applyCycleForm(at.form, { X: '', K: '' }, doc.input, view, doc.after)).toEqual({
      ok: true,
      first: 3,
      last: 3,
      lines: ['N20 G98 G81 Y1. Z-5. R2. F100.'],
    });
  });

  it('adds a point to a new length only where the profile point is significant', () => {
    // Fanuc mill (significant): `X5` → `X5.`; Sinumerik and Okuma: as typed.
    const view = viewOf('fanuc-gcode');
    const doc = docOf(view, ['%', 'O1000', 'N20 G98 G81 Z-5. R2. F100.'], 3);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    expect(applyCycleForm(at.form, { X: '5', Y: '-2.5' }, doc.input, view, doc.after)).toMatchObject({ ok: true, lines: ['N20 G98 G81 Z-5. R2. F100. X5. Y-2.5'] });
  });

  it('every message an edit answers has an English text', () => {
    const view = viewOf('fanuc-gcode');
    const doc = docOf(view, F01, 39);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    const r = applyCycleForm(at.form, { Q: 'x', F: '', K: '0.5', Z: '-1' }, doc.input, view, doc.after);
    expect(r.ok).toBe(false);
    if (!r.ok) for (const msg of Object.values(r.errors)) expect(hasKey(msg.key), msg.key).toBe(true);
  });

  it('is pure: the same call twice gives the same edit and leaves the form as it was', () => {
    const view = viewOf('sinumerik');
    const lines = linesOf(readFileSync(join(ROOT, '../nc/sinumerik/s02-drill.MPF'), 'utf8'));
    const doc = docOf(view, lines, 12);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error('no form');
    const before = JSON.stringify(at.form);
    const a = applyCycleForm(at.form, { DP: '-40' }, doc.input, view, doc.after);
    const b = applyCycleForm(at.form, { DP: '-40' }, doc.input, view, doc.after);
    expect(a).toEqual(b);
    expect(JSON.stringify(at.form)).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// P3b fix NC (plan §7 #253 ff.)
// ---------------------------------------------------------------------------------------------

describe('P3b fix NC', () => {
  /** The form at `line` of `lines`, or a thrown error. */
  function formAt(view: InspectView, lines: string[], line: number): { form: CycleForm; doc: Doc } {
    const doc = docOf(view, lines, line);
    const at = cycleFormAt(doc.input, view, doc.after);
    if (!at?.ok) throw new Error(`no form: ${JSON.stringify(at)}`);
    return { form: at.form, doc };
  }

  it('NC-06: Edit Cycle refuses a positive Klartext depth', () => {
    const view = viewOf('heidenhain-klartext');
    const lines = ['0 BEGIN PGM X MM', '1 CYCL DEF 200 DRILLING ~', '   Q200=2 ;C ~', '   Q201=-15 ;D ~', '   Q206=150 ;F ~', '   Q202=5 ;P ~', '   Q210=0 ;T ~', '   Q203=+0 ;S ~', '   Q204=50 ;C2 ~', '   Q211=0 ;B', '2 END PGM X MM'];
    const { form, doc } = formAt(view, lines, 2);
    const r = applyCycleForm(form, { Q201: '15' }, doc.input, view, doc.after);
    expect(r.ok === false && keyed(r.errors)).toEqual({ Q201: 'inspector.why.max' });
    expect(applyCycleForm(form, { Q201: '-20' }, doc.input, view, doc.after)).toMatchObject({ ok: true });
  });

  /** Inserts `code` with `values` at `line` of `lines`; the edit and the program after it. */
  function inserted(profile: string, lines: string[], line: number, code: string, values: Record<string, string>, env: { prevBlockNumber: number | null; numbered: boolean }, machine: Record<string, unknown> | null = null) {
    const view = viewOf(profile, machine);
    const doc = docOf(view, lines, line);
    const entry = lookupCode(view.db, code);
    if (!entry) throw new Error(code);
    const edit = applyCycleForm(cycleFormFor(entry, view), values, doc.input, view, doc.after, envOf(view, env));
    const after = edit.ok ? [...lines.slice(0, edit.first - 1), ...edit.lines, ...lines.slice(edit.first - 1)] : lines;
    return { edit, after, view };
  }

  it('NC-05: an inserted modal cycle is cancelled in a block of its own, so the next bare position is no hole', () => {
    const lines = ['O1000', 'N10 G90 G54 G0 X0. Y0.', 'N20 X5. Y6.', 'N30 X50. Y50.'];
    const { edit, after, view } = inserted('fanuc-gcode', lines, 3, 'G83', { Z: '-7.5', R: '2', Q: '3.', F: '120' }, { prevBlockNumber: 20, numbered: true });
    expect(edit).toEqual({ ok: true, first: 4, last: 3, lines: ['N30 G83 Z-7.5 R2. Q3. F120.', 'N40 G80'] });
    const next = docOf(view, after, after.indexOf('N30 X50. Y50.') + 1);
    expect(next.after?.activeCycle ?? null).toBeNull();
    // Okuma: G180, alone in its block.
    const okuma = inserted('okuma-osp', ['$O03.MIN%', 'G00 X50 Z5 C0'], 2, 'G181', { X: '50', Z: '-12', C: '0', K: '3', F: '120' }, { prevBlockNumber: null, numbered: false }, { numberInput: 'okuma-1mm' });
    expect(okuma.edit).toMatchObject({ ok: true, lines: ['G181 X50 Z-12 C0 K3 F120', 'G180'] });
    // A Sinumerik call and a Klartext definition are not modal cycles: one block, as before.
    const sin = inserted('sinumerik', ['N10 G0 X0 Z5'], 1, 'CYCLE83', { RTP: '5', RFP: '0', SDIS: '2', DP: '-30' }, { prevBlockNumber: 10, numbered: true });
    expect(sin.edit).toMatchObject({ ok: true, lines: ['N20 CYCLE83(5,0,2,-30)'] });
  });

  it('SK-01: no cycle is inserted where another one is still on', () => {
    const lines = ['O1000', 'N10 G90 G0 X0. Y0.', 'N20 G98 G83 X1. Y1. Z-5. R2. Q3. F100.', 'N30 M8', 'N40 X50. Y50.', 'N50 G80'];
    const { edit } = inserted('fanuc-gcode', lines, 4, 'G84', { Z: '-10', R: '2', F: '100' }, { prevBlockNumber: 30, numbered: true });
    expect(edit).toEqual({ ok: false, errors: { [CYCLE_FORM_WHOLE]: { key: 'cycleForm.refused.insideCycle', params: { code: 'G83', line: 3, cancel: 'G80' } } } });
    expect(hasKey('cycleForm.refused.insideCycle')).toBe(true);
    // After the G80 the same insert is taken.
    expect(inserted('fanuc-gcode', lines, 6, 'G84', { Z: '-10', R: '2', F: '100' }, { prevBlockNumber: 50, numbered: true }).edit.ok).toBe(true);
  });

  it('NC-11: an Okuma one-block cycle written in two adjacent blocks opens a form on each; the Fanuc lathe pairs stay refused', () => {
    const view = viewOf('okuma-osp', { numberInput: 'okuma-1mm' });
    const lines = ['$O1.MIN%', 'N10 G0 X0 Z5', 'N20 G74 X0 Z-5 D2', 'N30 G74 X0 Z-12 D3 F0.12', 'N40 G0 Z5'];
    for (const line of [3, 4]) {
      const doc = docOf(view, lines, line);
      expect(cycleFormAt(doc.input, view, doc.after), `line ${line}`).toMatchObject({ ok: true });
    }
    const lathe = viewOf('fanuc-lathe');
    const pair = docOf(lathe, ['%', 'O2000', 'N10 G71 U1.5 R0.5', 'N20 G71 P30 Q40 U0.4 W0.1 F0.25', 'N30 G0 X16.', 'N40 G1 X34.'], 3);
    expect(cycleFormAt(pair.input, lathe, pair.after)).toEqual({ ok: false, reason: CYCLE_FORM_REFUSALS.twoBlocks });
  });

  it('NC-16: a value written as a variable is refused when it is changed, in every layout', () => {
    const view = viewOf('sinumerik');
    const { form, doc } = formAt(view, ['N10 G0 X0 Z5', 'N30 CYCLE81(R1,0,2,-35)'], 2);
    expect(applyCycleForm(form, { RTP: '50' }, doc.input, view, doc.after)).toEqual({ ok: false, errors: { RTP: CYCLE_FORM_REFUSALS.variable } });
    expect(applyCycleForm(form, { RTP: '' }, doc.input, view, doc.after)).toEqual({ ok: false, errors: { RTP: CYCLE_FORM_REFUSALS.variable } });
    expect(applyCycleForm(form, { DP: '-40' }, doc.input, view, doc.after)).toMatchObject({ ok: true, lines: ['N30 CYCLE81(R1,0,2,-40)'] });
  });

  it('NC-13: with a machine, a value with more decimals than the increment is refused (the control would round it)', () => {
    const view = viewOf('fanuc-gcode', { numberInput: 'is-b' });
    const { form, doc } = formAt(view, F01, 39);
    const r = applyCycleForm(form, { R: '0.0005' }, doc.input, view, doc.after);
    expect(r.ok === false && keyed(r.errors)).toEqual({ R: 'machines.numbers.rounded' });
    expect(applyCycleForm(form, { R: '2.125' }, doc.input, view, doc.after)).toMatchObject({ ok: true });
    // A new word too.
    const k = applyCycleForm(form, { K: '' , Z: '-18.0001' }, doc.input, view, doc.after);
    expect(k.ok === false && keyed(k.errors)).toEqual({ Z: 'machines.numbers.rounded' });
    const ins = inserted('fanuc-gcode', ['O1000', 'N10 G0 X0. Y0.'], 2, 'G81', { Z: '-5.0005', R: '2', F: '100' }, { prevBlockNumber: 10, numbered: true }, { numberInput: 'is-b' });
    expect(ins.edit.ok === false && keyed(ins.edit.errors)).toEqual({ Z: 'machines.numbers.rounded' });
    // Without a machine nothing is guessed: as before.
    const none = viewOf('fanuc-gcode');
    const plain = formAt(none, F01, 39);
    expect(applyCycleForm(plain.form, { R: '0.0005' }, plain.doc.input, none, plain.doc.after)).toMatchObject({ ok: true });
  });

  it('NC-08: a word written without a point says what it reads as on the machine', () => {
    const view = viewOf('fanuc-gcode', { numberInput: 'is-b' });
    const { form } = formAt(view, ['%', 'O1000', 'N20 G98 G83 X1. Y1. Z-5. R2. Q4000 F100.'], 3);
    expect(form.readings?.Q).toEqual({ key: 'cycleForm.withoutPoint', params: { literal: '4000', value: '4 mm' } });
    expect(hasKey('cycleForm.withoutPoint')).toBe(true);
    const pointed = formAt(view, ['%', 'O1000', 'N20 G98 G83 X1. Y1. Z-5. R2. Q4. F100.'], 3);
    expect(pointed.form.readings?.Q).toBeUndefined();
  });
});
