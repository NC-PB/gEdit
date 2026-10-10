// Edit Cycle (Phase 3 plan §5 P3.5, AD-39): the command around the engine of P3.8.
//
// The program is a public fixture text behind a fake editor, the modal states come from the real
// modal index, and the edit goes through the real `applyLinesTo` on a fake model, so "one undo
// step" is the application's own, counted on the model. The form is scripted.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { blockRange } from '$lib/core/codes/inspect';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import type { FieldSpec } from '$lib/core/forms/types';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import type { EffectiveProfile } from '$lib/core/machines/types';
import { ModalIndex } from '$lib/core/nc/modal';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { applyLinesTo, type LineOperation } from '$lib/monaco/applyLines';
import { createDocumentStore } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import { profileOf } from '../../../tests/unit/helpers/profiles';
import cycleForms, { createCycleEditor, textFields, type CycleEditDeps } from './cycleForms';
import type { DocId, FormLiveResult, NewDocMeta, QuickPickItem } from '$lib/app/types';

const NC = join(__dirname, '../../../tests/fixtures/nc');
const read = (path: string): string[] => readFileSync(join(NC, path), 'utf8').replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

function effectiveOf(profileId: string, numberInput?: string): EffectiveProfile {
  const base = profileOf(profileId);
  const preset = numberInput === undefined ? undefined : base.machineParams?.numberInput?.presets.find((p) => p.id === numberInput);
  const config = preset ? { id: 'm', name: 'Machine', profile: profileId, params: { numberInput: preset.value } } : null;
  const eff = effectiveMachine(base, config, config ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  return { profile: checked.profile, cp: compileProfile(checked.profile), codes: loadCodeDb(DBS[applied.codes]), machine: eff };
}

function applyOperations(lines: string[], operations: LineOperation[]): string[] {
  let text = lines.join('\n');
  const offsetOf = (line: number, column: number): number => {
    let at = 0;
    for (let i = 1; i < line; i++) at += lines[i - 1].length + 1;
    return at + column - 1;
  };
  const sorted = [...operations].sort((a, b) => b.range.startLineNumber - a.range.startLineNumber || b.range.startColumn - a.range.startColumn);
  for (const op of sorted) {
    text = text.slice(0, offsetOf(op.range.startLineNumber, op.range.startColumn)) + op.text + text.slice(offsetOf(op.range.endLineNumber, op.range.endColumn));
  }
  return text.split('\n');
}

interface FormCall {
  title: string;
  fields: FieldSpec[];
  values?: Record<string, unknown>;
  okLabel?: string;
  note?: string;
  marker?: { testid: string; data: Record<string, string> };
  live?: (values: Record<string, unknown>) => FormLiveResult;
}

interface Rig {
  lines: string[];
  editor: { editCycle(): Promise<string> };
  forms: FormCall[];
  picks: { items: QuickPickItem<unknown>[]; placeholder?: string }[];
  /** What the form answers: values, `undefined` for Cancel, or a function of the call. */
  answer: { value: Record<string, unknown> | undefined | ((call: FormCall) => Record<string, unknown> | undefined) };
  /** Index of the pick, or undefined for Esc. */
  choose: { index: number | undefined };
  statuses: { text: string; error: boolean }[];
  model: { stack: string[]; ops: LineOperation[][] };
  docs: ReturnType<typeof createDocumentStore>;
  id: DocId;
  cursor: { line: number };
  reveals: number[];
}

function meta(patch: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: '/nc/f01.nc',
    untitledIndex: null,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'lf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    readOnly: false,
    readOnlyReason: null,
    ...patch,
  };
}

function rig(o: { lines: string[]; line: number; profile?: string; doc?: Partial<NewDocMeta>; numberInput?: string }): Rig {
  const profile = o.profile ?? 'fanuc-gcode';
  const view = effectiveOf(profile, o.numberInput);
  const r = {} as Rig;
  r.lines = [...o.lines];
  r.forms = [];
  r.picks = [];
  r.answer = { value: undefined };
  r.choose = { index: 0 };
  r.statuses = [];
  r.model = { stack: [], ops: [] };
  r.docs = createDocumentStore({ caseInsensitivePaths: false });
  r.id = r.docs.add(meta({ profileId: profile, ...o.doc }));
  r.cursor = { line: o.line };
  r.reveals = [];

  const lines = r.lines;
  let index!: ModalIndex;
  const rebuild = (): void => {
    index = new ModalIndex(view.cp, view.codes);
    index.reset(lines.length, (n) => lines[n - 1] ?? '');
    while (!index.buildSome(1_000)) {
      /* until the whole text is read */
    }
  };
  rebuild();
  const model = {
    getLineCount: () => lines.length,
    getLineContent: (n: number) => lines[n - 1],
    getLineMaxColumn: (n: number) => lines[n - 1].length + 1,
    pushStackElement: () => void r.model.stack.push('stack'),
    pushEditOperations: (_before: null, operations: LineOperation[]) => {
      r.model.stack.push('edit');
      r.model.ops.push(operations);
      lines.splice(0, lines.length, ...applyOperations(lines, operations));
    },
  };

  const deps: CycleEditDeps = {
    docs: r.docs,
    editor: {
      cursor: () => ({ line: r.cursor.line, column: 1, selectedChars: 0, selections: 1 }),
      getLineCount: () => lines.length,
      getLines: (_id: string, s: number, e: number) => lines.slice(s - 1, e),
      reveal: (_id: string, line: number) => void r.reveals.push(line),
    },
    effective: () => view,
    modal: { stateAfter: (_id: string, n: number) => index.stateAfter(n) },
    modals: {
      form: async (call) => {
        r.forms.push(call as FormCall);
        const a = r.answer.value;
        return typeof a === 'function' ? a(call as FormCall) : a;
      },
      quickPick: async <T,>(items: QuickPickItem<T>[], opts?: { placeholder?: string }) => {
        r.picks.push({ items: items as QuickPickItem<unknown>[], placeholder: opts?.placeholder });
        return r.choose.index === undefined ? undefined : items[r.choose.index].value;
      },
    },
    applyLines: (_id, start, end, newLines) => {
      const done = applyLinesTo(model, start, end, newLines);
      rebuild();
      return done;
    },
    status: { show: (text: string, opts?: { error?: boolean }) => void r.statuses.push({ text, error: opts?.error === true }) },
    now: () => new Date(2026, 9, 9, 14, 5),
    t,
  };
  r.editor = createCycleEditor(deps);
  return r;
}

let f01: string[];
beforeEach(() => {
  f01 = read('fanuc/f01-mill-3tools.nc');
});

describe('Edit Cycle on a cycle block', () => {
  it('opens the form of the cycle with the block’s values, edits only what changed, and writes one undo step', async () => {
    const r = rig({ lines: f01, line: 39 });
    r.answer.value = (call) => ({ ...(call.values as Record<string, unknown>), Q: '5', K: '2' });
    expect(await r.editor.editCycle()).toBe('edited');

    const form = r.forms[0];
    expect(form.title).toBe('G83: Peck drilling cycle');
    expect(form.okLabel).toBe(t('cycleForm.okEdit'));
    expect(form.values).toMatchObject({ X: '20.', Y: '60.', Z: '-18.', R: '3.', Q: '4.', F: '240.', K: '' });
    // The values are text as written: the control keeps `4.` and `4` apart.
    expect(form.fields.map((f) => f.type)).toEqual(Array(form.fields.length).fill('text'));
    expect(form.marker).toEqual({ testid: 'cycle-form', data: { cycle: 'G83', mode: 'edit' } });

    expect(r.lines[38]).toBe('G98 G83 X20. Y60. Z-18. R3. Q5. F240. K2');
    expect(r.lines.length).toBe(f01.length);
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
    expect(r.model.ops).toHaveLength(1);
    expect(r.statuses.pop()).toEqual({ text: 'Changed the G83 block.', error: false });
  });

  it('writes nothing when it is confirmed with nothing changed', async () => {
    const r = rig({ lines: f01, line: 39 });
    r.answer.value = (call) => ({ ...(call.values as Record<string, unknown>) });
    expect(await r.editor.editCycle()).toBe('unchanged');
    expect(r.model.stack).toEqual([]);
    expect(r.statuses.pop()).toEqual({ text: t('cycleForm.unchanged'), error: false });
  });

  it('writes nothing when it is cancelled', async () => {
    const r = rig({ lines: f01, line: 39 });
    r.answer.value = undefined;
    expect(await r.editor.editCycle()).toBe('cancelled');
    expect(r.model.stack).toEqual([]);
  });

  it('its live hook shows the block as it would be written, and the engine’s refusal beside the field', async () => {
    const r = rig({ lines: f01, line: 39 });
    await r.editor.editCycle();
    const live = r.forms[0].live!;
    const base = r.forms[0].values as Record<string, unknown>;
    expect(live({ ...base, Q: '6.' }).preview).toBe('G98 G83 X20. Y60. Z-18. R3. Q6. F240.');
    const cleared = live({ ...base, Z: '' });
    expect(cleared.preview).toBeUndefined();
    expect(Object.keys(cleared.fieldErrors ?? {})).toEqual(['Z']);
    expect(cleared.fieldErrors!.Z.key).toBe('cycleForm.refused.required');
  });

  it('refuses a cycle written on another line and names that line', async () => {
    const r = rig({ lines: f01, line: 40 });
    expect(await r.editor.editCycle()).toBe('refused');
    expect(r.forms).toEqual([]);
    expect(r.model.stack).toEqual([]);
    expect(r.statuses.pop()).toEqual({ text: t('cycleForm.refused.elsewhere', { line: 39 }), error: true });
  });

  it('refuses a cycle that is written in two blocks, in plain words', async () => {
    const r = rig({ lines: read('fanuc-lathe/l01-turning-a.nc'), line: 15, profile: 'fanuc-lathe' });
    expect(await r.editor.editCycle()).toBe('refused');
    expect(r.forms).toEqual([]);
    expect(r.statuses.pop()).toEqual({ text: t('cycleForm.refused.twoBlocks'), error: true });
  });

  it('refuses a locked program before it asks anything', async () => {
    const r = rig({ lines: f01, line: 39, doc: { readOnly: true, readOnlyReason: 'user' } });
    expect(await r.editor.editCycle()).toBe('refused');
    expect(r.forms).toEqual([]);
    const status = r.statuses.pop()!;
    expect(status.error).toBe(true);
    expect(status.text).toContain('Edit Cycle');
    expect(status.text).toContain('locked against editing');
  });

  it('refuses when no program is open and in a file that is no program', async () => {
    const none = rig({ lines: f01, line: 39 });
    none.docs.remove(none.id);
    expect(await none.editor.editCycle()).toBe('refused');
    expect(none.statuses.pop()).toEqual({ text: t('cycleForm.noDocument'), error: true });
    const json = rig({ lines: ['{}'], line: 1, doc: { path: '/cfg/profiles/p.json' } });
    expect(await json.editor.editCycle()).toBe('refused');
    expect(json.statuses.pop()).toEqual({ text: t('cycleForm.notProgram'), error: true });
  });

  it('reads the program again after the form: a value the engine now refuses is not written', async () => {
    const r = rig({ lines: f01, line: 39 });
    r.answer.value = (call) => ({ ...(call.values as Record<string, unknown>), Z: '' });
    expect(await r.editor.editCycle()).toBe('refused');
    expect(r.model.stack).toEqual([]);
    expect(r.statuses.pop()).toEqual({ text: t('cycleForm.refused.required'), error: true });
  });
});

describe('Edit Cycle on a line with no cycle', () => {
  it('offers the database’s cycles and inserts the one chosen, numbered by the program, as one undo step', async () => {
    const lines = ['%', 'O1000', 'N10 G90 G0 X0 Y0', 'N20 G43 Z25. H1', 'N30 M5'];
    const r = rig({ lines, line: 4 });
    r.choose.index = undefined;
    expect(await r.editor.editCycle()).toBe('cancelled');
    const pick = r.picks[0];
    expect(pick.placeholder).toBe(t('cycleForm.pickPlaceholder'));
    const codes = pick.items.map((item) => item.label);
    expect(codes).toContain('G83');
    expect(codes).not.toContain('G71');
    expect(r.forms).toEqual([]);

    r.choose.index = codes.indexOf('G83');
    r.answer.value = { X: '5', Y: '6', Z: '-7.5', R: '2', Q: '3.', F: '120' };
    expect(await r.editor.editCycle()).toBe('inserted');
    expect(r.forms[0].marker).toEqual({ testid: 'cycle-form', data: { cycle: 'G83', mode: 'insert' } });
    expect(r.forms[0].okLabel).toBe(t('cycleForm.okInsert'));
    // P3b fix NC-05: the modal cycle comes with its G80, and the form says so.
    expect(r.lines).toEqual(['%', 'O1000', 'N10 G90 G0 X0 Y0', 'N20 G43 Z25. H1', 'N30 G83 X5. Y6. Z-7.5 R2. Q3. F120.', 'N40 G80', 'N30 M5']);
    expect(r.forms[0].note).toBe(t('cycleForm.cancelAdded', { cancel: 'G80' }));
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
    expect(r.reveals).toEqual([6]);
  });

  it('numbers a Klartext cycle and renumbers the blocks behind it in the same edit', async () => {
    const lines = [
      '0 BEGIN PGM H01_3TOOLS MM',
      '1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
      '2 TOOL CALL 2 Z S2400',
      '3 L Z+100 R0 FMAX M3',
      '4 L X-30 Y-20 R0 FMAX M8',
      '5 CYCL CALL',
      '6 END PGM H01_3TOOLS MM',
    ];
    const r = rig({ lines, line: 4, profile: 'heidenhain-klartext' });
    const pick = async (): Promise<void> => {
      r.choose.index = undefined;
      await r.editor.editCycle();
      r.choose.index = r.picks[r.picks.length - 1].items.findIndex((item) => item.label === 'CYCL DEF 200');
    };
    await pick();
    r.answer.value = { Q200: '2', Q201: '-15', Q206: '150', Q202: '5', Q210: '0', Q203: '+0', Q204: '50', Q211: '0.2' };
    expect(await r.editor.editCycle()).toBe('inserted');
    expect(r.lines.slice(0, 5)).toEqual([...lines.slice(0, 4), '4 CYCL DEF 200 DRILLING CYCLE ~']);
    expect(r.lines[12]).toBe('   Q211=0.2 ;DWELL AT THE HOLE BOTTOM');
    expect(r.lines.slice(13)).toEqual(['5 L X-30 Y-20 R0 FMAX M8', '6 CYCL CALL', '7 END PGM H01_3TOOLS MM']);
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
  });
});

describe('the fields of the form', () => {
  it('turns a number into a text field and leaves a read-only field as it is', () => {
    const fields: FieldSpec[] = [
      { id: 'Z', type: 'number', label: 'Z', required: true, min: -9, max: 9, decimals: 3, default: '1.' },
      { id: 'H', type: 'integer', label: 'H', min: 0 },
      { id: 'V', type: 'text', label: 'V', readOnly: true, default: '#101' },
    ];
    expect(textFields(fields)).toEqual([
      { id: 'Z', type: 'text', label: 'Z', required: true, default: '1.' },
      { id: 'H', type: 'text', label: 'H' },
      { id: 'V', type: 'text', label: 'V', readOnly: true, default: '#101' },
    ]);
  });
});

describe('the contribution', () => {
  it('declares nc.editCycle with no key, on the Insert tab in the Cycles group', () => {
    const command = cycleForms.commands.find((c) => c.id === 'nc.editCycle')!;
    expect(command.title).toBe('cycleForm.edit');
    expect(command.category).toBe('cycleForm.category');
    expect((command as { keys?: unknown }).keys).toBeUndefined();
    expect(cycleForms.ribbon).toEqual([{ tab: 'insert', group: 'cycleForm.group', command: 'nc.editCycle', order: 20 }]);
    expect(command.enabled?.({ activeDocId: null } as never)).toBe(false);
    expect(command.enabled?.({ activeDocId: 'd1' } as never)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// P3b fix NC (plan §7 #253 ff.)
// ---------------------------------------------------------------------------------------------

describe('P3b fix NC: what the form says', () => {
  it('SK-03: a Sinumerik drilling cycle inserted as a call says that it drills at once, with the feed in force', async () => {
    const r = rig({ lines: ['N10 G0 X0 Z5', 'N20 M30'], line: 1, profile: 'sinumerik' });
    r.choose.index = undefined;
    await r.editor.editCycle();
    r.choose.index = r.picks[0].items.findIndex((item) => item.label === 'CYCLE81');
    r.answer.value = undefined;
    await r.editor.editCycle();
    expect(r.forms[0].note).toBe(t('cycleForm.runsAtOnce'));
    // Rigid tapping takes the pitch, not the feed: no such note.
    r.choose.index = r.picks[0].items.findIndex((item) => item.label === 'CYCLE84');
    await r.editor.editCycle();
    expect(r.forms[1].note).toBeUndefined();
  });

  it('NC-08: a field of a word written without a point says what the machine reads', async () => {
    const lines = ['%', 'O1000', 'N10 G90 G0 X0. Y0.', 'N20 G98 G83 X1. Y1. Z-5. R2. Q4000 F100.', 'N30 G80'];
    const r = rig({ lines, line: 4, numberInput: 'is-b' });
    await r.editor.editCycle();
    const q = r.forms[0].fields.find((f) => f.id === 'Q');
    expect(q?.help).toBe(t('cycleForm.withoutPoint', { literal: '4000', value: '4 mm' }));
    expect(r.forms[0].fields.find((f) => f.id === 'Z')?.help).toBeUndefined();
  });

  it('CODE-16: a program locked while the form is open is refused, and nothing is written', async () => {
    const r = rig({ lines: f01, line: 39 });
    r.answer.value = (call) => {
      r.docs.update(r.id, { readOnly: true, readOnlyReason: 'user' });
      return { ...(call.values as Record<string, unknown>), Q: '5' };
    };
    expect(await r.editor.editCycle()).toBe('refused');
    expect(r.model.stack).toEqual([]);
    expect(r.lines).toEqual(f01);
    expect(r.statuses.pop()).toMatchObject({ error: true });
  });
});
