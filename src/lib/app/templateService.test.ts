// The template service (Phase 3 plan §5 P3.5, §6.11, AD-28): what a document offers, the text an
// insert gives, the one edit that writes it, the form behind it, the remembered values, the
// favourites and `changed`.
//
// Everything runs on fakes: a text of lines behind a fake editor, the real `applyLinesTo` on a
// fake model (so "one undo step" is the application's own, counted on the model), a scripted
// form, a map for `state.json`, and a real document store. The effective view of a document is
// the real one (`effectiveMachine` + `applyMachine` + the built-in databases), so a system-B
// lathe document sees the database `applyMachine` names.

import { get, writable } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCodeDb } from '$lib/core/codes/load';
import { resolveCodeDbFiles } from '$lib/core/codes/resolve';
import { applyMachine, effectiveMachine } from '$lib/core/machines/effective';
import type { EffectiveProfile, MachineConfig } from '$lib/core/machines/types';
import { compileProfile } from '$lib/core/profiles/compile';
import { validateProfile } from '$lib/core/profiles/validate';
import { initialValues } from '$lib/core/forms/values';
import { draftToTemplate, loadTemplates, templateFields, templateFromSelection, type TemplateDef } from '$lib/core/templates';
import { BUILTIN_CODE_DB_JSON } from '$lib/data/codes';
import { applyLinesTo, type LineOperation } from '$lib/monaco/applyLines';
import { createDocumentStore } from '$lib/stores/documents';
import { t } from '$lib/i18n';
import { profileOf } from '../../../tests/unit/helpers/profiles';
import {
  createTemplateService,
  formulaValues,
  planInsertion,
  renumberFollowing,
  sysClock,
  templateGroups,
  FAVORITES_KEY,
  type TemplateServiceDeps,
} from './templateService';
import type { DocId, FormLiveResult, Msg, NewDocMeta, TemplateService } from '$lib/app/types';
import type { FieldSpec } from '$lib/core/forms/types';
import { blockNumberOf } from '$lib/core/nc/tokenizer';

// The singleton imports the real Monaco-facing modules; the dialogs it never opens here.
vi.mock('$lib/components/forms/FormDialog.svelte', () => ({ default: {} }));

const DBS = resolveCodeDbFiles(BUILTIN_CODE_DB_JSON, (dialect, problem) => {
  throw new Error(`${dialect}: ${problem.path}: ${problem.message}`);
});

/** The document's effective view as `machines.effective` answers it; `gcodeSystem` picks a variant of the lathe. */
function effectiveOf(profileId: string, o: { gcodeSystem?: 'A' | 'B'; extra?: unknown[]; numberInput?: string } = {}): EffectiveProfile {
  const base = profileOf(profileId);
  const preset = o.numberInput === undefined ? undefined : base.machineParams?.numberInput?.presets.find((p) => p.id === o.numberInput);
  if (o.numberInput !== undefined && preset === undefined) throw new Error(`${profileId}: no preset ${o.numberInput}`);
  const config: MachineConfig | null =
    o.gcodeSystem || preset
      ? {
          id: 'm',
          name: 'Machine',
          profile: profileId,
          params: { ...(o.gcodeSystem ? { variants: { gcodeSystem: o.gcodeSystem } } : {}), ...(preset ? { numberInput: preset.value } : {}) },
        }
      : null;
  const eff = effectiveMachine(base, config, config ? 'document' : 'none', {});
  const applied = applyMachine(base, eff);
  const checked = validateProfile(applied.profile, { applied: true });
  if (!checked.ok) throw new Error(checked.errors.join('; '));
  const db = loadCodeDb(DBS[applied.codes]);
  const extra = o.extra === undefined ? [] : loadTemplates(o.extra);
  return {
    profile: checked.profile,
    cp: compileProfile(checked.profile),
    codes: extra.length === 0 ? db : { ...db, templates: [...(db.templates ?? []).filter((x) => !extra.some((e) => e.id === x.id)), ...extra] },
    machine: eff,
  };
}

interface FormCall {
  title: string;
  fields: FieldSpec[];
  values?: Record<string, unknown>;
  okLabel?: string;
  note?: string;
  live?: (values: Record<string, unknown>) => FormLiveResult;
}

interface Rig {
  lines: string[];
  service: TemplateService;
  docs: ReturnType<typeof createDocumentStore>;
  id: DocId;
  deps: TemplateServiceDeps;
  cursor: { line: number };
  forms: FormCall[];
  /** What the form answers: values, `undefined` for Cancel, or a function of the call. */
  answer: { value: Record<string, unknown> | undefined | ((call: FormCall) => Record<string, unknown> | undefined) };
  statuses: { text: string; error: boolean }[];
  model: { stack: string[]; ops: LineOperation[][] };
  memo: Map<string, Record<string, unknown>>;
  revisions: { machines: ReturnType<typeof writable<number>>; profiles: ReturnType<typeof writable<number>> };
  reveals: { id: string; line: number; column?: number }[];
  snippets: { template: string; at?: { line: number; replace: boolean } }[];
  view: { current: EffectiveProfile };
  now: { value: Date };
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

function meta(patch: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: '/nc/Welle.nc',
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

function rig(o: { lines?: string[]; profile?: string; view?: EffectiveProfile; doc?: Partial<NewDocMeta>; line?: number } = {}): Rig {
  const profile = o.profile ?? 'fanuc-gcode';
  const r = {} as Rig;
  r.lines = [...(o.lines ?? ['O0001', 'N10 G21 G90', 'N20 G0 X0 Y0', 'N30 M30'])];
  r.docs = createDocumentStore({ caseInsensitivePaths: false });
  r.id = r.docs.add(meta({ profileId: profile, ...o.doc }));
  r.cursor = { line: o.line ?? 3 };
  r.forms = [];
  r.answer = { value: undefined };
  r.statuses = [];
  r.model = { stack: [], ops: [] };
  r.memo = new Map();
  r.revisions = { machines: writable(0), profiles: writable(0) };
  r.reveals = [];
  r.snippets = [];
  r.view = { current: o.view ?? effectiveOf(profile) };
  r.now = { value: new Date(2026, 9, 9, 14, 5) };

  const lines = r.lines;
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

  r.deps = {
    docs: r.docs,
    editor: {
      cursor: () => ({ line: r.cursor.line, column: 1, selectedChars: 0, selections: 1 }),
      getLineCount: () => lines.length,
      getLines: (_id: string, s: number, e: number) => lines.slice(s - 1, e),
      insertSnippet: (template: string, at?: { line: number; replace: boolean }) => void r.snippets.push({ template, at }),
      reveal: (id: string, line: number, column?: number) => void r.reveals.push({ id, line, column }),
      focus: () => {},
    },
    effective: () => r.view.current,
    revisions: [r.revisions.machines, r.revisions.profiles],
    modals: {
      form: async (call) => {
        r.forms.push(call as FormCall);
        const a = r.answer.value;
        return typeof a === 'function' ? a(call as FormCall) : a;
      },
    },
    uiState: {
      getLastParams: (key: string) => r.memo.get(key),
      setLastParams: (key: string, v: Record<string, unknown>) => void r.memo.set(key, v),
    },
    applyLines: (_id, start, end, newLines) => applyLinesTo(model, start, end, newLines),
    status: { show: (text: string, o2?: { error?: boolean }) => void r.statuses.push({ text, error: o2?.error === true }) },
    now: () => r.now.value,
    t,
  };
  r.service = createTemplateService(r.deps);
  return r;
}

const ids = (list: TemplateDef[]): string[] => list.map((x) => x.id);
const text = (msg: Msg): string => t(msg.key, msg.params);

describe('which templates a document offers', () => {
  it('reads the effective database: a G-code system B lathe document gets the fanuc-lathe-b "Tool start" (G92 S), the same document under A the fanuc-lathe one', () => {
    const a = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe', { gcodeSystem: 'A' }) });
    const b = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe', { gcodeSystem: 'B' }) });
    expect(a.service.dialectOf(a.id)).toBe('fanuc-lathe');
    expect(b.service.dialectOf(b.id)).toBe('fanuc-lathe-b');
    const toolStart = (r: Rig): string => {
      const tpl = r.service.list(r.id).find((x) => x.id === 'tool-start')!;
      const out = r.service.render(r.id, 'tool-start', initialValues(templateFields(tpl)), 1);
      if (!out.ok) throw new Error(JSON.stringify(out.errors));
      return out.text;
    };
    expect(ids(a.service.list(a.id))).toContain('tool-start');
    expect(toolStart(b)).toContain('G92 S');
    expect(toolStart(a)).not.toContain('G92 S');
    expect(toolStart(a)).toContain('G50 S');
  });

  it('one document switches from A to B and back: the list follows the view and `changed` says so', () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe', { gcodeSystem: 'A' }) });
    const seen: number[] = [];
    const stop = r.service.changed.subscribe((n) => seen.push(n));
    const before = r.service.dialectOf(r.id);
    r.view.current = effectiveOf('fanuc-lathe', { gcodeSystem: 'B' });
    r.revisions.machines.update((n) => n + 1);
    expect([before, r.service.dialectOf(r.id)]).toEqual(['fanuc-lathe', 'fanuc-lathe-b']);
    expect(seen.length).toBeGreaterThan(1);
    stop();
  });

  it('only offers a template of a machine type to a profile of that type', () => {
    const mill = rig({ profile: 'fanuc-gcode' });
    const lathe = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe') });
    expect(ids(mill.service.list(mill.id))).toContain('tapping');
    expect(ids(mill.service.list(mill.id))).not.toContain('threading');
    expect(ids(lathe.service.list(lathe.id))).toContain('threading');
    expect(ids(lathe.service.list(lathe.id))).not.toContain('tapping');
    const turning = rig({ profile: 'sinumerik' });
    const milling = rig({ profile: 'sinumerik-mill' });
    expect(ids(turning.service.list(turning.id))).toContain('stock-removal');
    expect(ids(turning.service.list(turning.id))).not.toContain('peck-drill');
    expect(ids(milling.service.list(milling.id))).toContain('peck-drill');
    expect(ids(milling.service.list(milling.id))).not.toContain('stock-removal');
    // The shared program start serves both.
    expect(ids(turning.service.list(turning.id))).toContain('program-start');
    expect(ids(milling.service.list(milling.id))).toContain('program-start');
  });

  it('is empty for an unknown document and when the view is gone for a moment', () => {
    const r = rig();
    expect(r.service.list('nope')).toEqual([]);
    expect(r.service.dialectOf('nope')).toBeNull();
    r.deps.effective = () => {
      throw new Error('no such profile');
    };
    expect(r.service.list(r.id)).toEqual([]);
  });
});

describe('rendering with the document around the cursor', () => {
  it('continues the block numbers of the program above the cursor', () => {
    const r = rig({ lines: ['O0001', 'N10 G21 G90', 'N20 G0 X0 Y0', 'N30 M30'], line: 3 });
    const out = r.service.render(r.id, 'tool-end', { stop: 'M1' }, 3);
    expect(out).toEqual({ ok: true, text: 'N30 M9\nN40 M5\nN50 G91 G28 Z0.\nN60 G90\nN70 M1', blocks: 5 });
    // Higher up the program, the numbers continue from there.
    const higher = r.service.render(r.id, 'tool-end', { stop: 'M1' }, 2);
    expect(higher.ok && higher.text.startsWith('N20 M9')).toBe(true);
  });

  it('writes no block numbers into a program that has none', () => {
    const r = rig({ lines: ['O0001', 'G21 G90', 'G0 X0 Y0', 'M30'], line: 3 });
    const out = r.service.render(r.id, 'tool-end', { stop: 'M1' }, 3);
    expect(out).toEqual({ ok: true, text: 'M9\nM5\nG91 G28 Z0.\nG90\nM1', blocks: 0 });
  });

  it('finds out that a program is numbered from the blocks below when there is none above', () => {
    const r = rig({ lines: ['O0001', '(HEADER)', 'N10 G21 G90', 'N20 M30'], line: 2 });
    const out = r.service.render(r.id, 'tool-end', { stop: 'M1' }, 2);
    expect(out.ok && out.text.startsWith('N10 M9')).toBe(true);
  });

  it('gives the engine the date, the time, the file name and its stem of the user’s clock', () => {
    const extra = [{ id: 'stamp', label: 'Stamp', group: 'Program', body: '({{sys.date}} {{sys.time}} {{sys.file}} {{sys.stem}})' }];
    const r = rig({ view: effectiveOf('fanuc-gcode', { extra }) });
    expect(r.service.render(r.id, 'stamp', {}, 1)).toEqual({ ok: true, text: '(2026-10-09 14:05 Welle.nc Welle)', blocks: 0 });
    const untitled = rig({ view: effectiveOf('fanuc-gcode', { extra }), doc: { path: null, untitledIndex: 1 } });
    expect(untitled.service.render(untitled.id, 'stamp', {}, 1)).toEqual({ ok: true, text: '(2026-10-09 14:05  )', blocks: 0 });
  });

  it('answers an error, not a throw, for a template the document does not offer', () => {
    const r = rig();
    const out = r.service.render(r.id, 'threading', {}, 1);
    expect(out.ok).toBe(false);
  });

  it('formats the clock in two digits', () => {
    expect(sysClock(new Date(2026, 0, 2, 3, 4))).toEqual({ date: '2026-01-02', time: '03:04' });
  });
});

describe('inserting a template: the edit', () => {
  it('writes a numbered template after the cursor’s line as one undo step', async () => {
    const r = rig({ line: 3 });
    expect(await r.service.insert('tool-end', { stop: 'M1' })).toBe(true);
    expect(r.lines).toEqual([
      'O0001',
      'N10 G21 G90',
      'N20 G0 X0 Y0',
      'N30 M9',
      'N40 M5',
      'N50 G91 G28 Z0.',
      'N60 G90',
      'N70 M1',
      'N30 M30',
    ]);
    // One batch between two stack elements: one Ctrl+Z puts everything back.
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
    expect(r.model.ops).toHaveLength(1);
    expect(r.reveals).toEqual([{ id: r.id, line: 8, column: 'N70 M1'.length + 1 }]);
    expect(r.forms).toEqual([]);
  });

  it('writes an unnumbered template into an unnumbered program', async () => {
    const r = rig({ lines: ['O0001', 'G21 G90', 'G0 X0 Y0', 'M30'], line: 3 });
    expect(await r.service.insert('tool-end', { stop: 'M0' })).toBe(true);
    expect(r.lines).toEqual(['O0001', 'G21 G90', 'G0 X0 Y0', 'M9', 'M5', 'G91 G28 Z0.', 'G90', 'M0', 'M30']);
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
  });

  it('puts the template in place of a blank cursor line, so a new file starts with the template', async () => {
    const r = rig({ lines: [''], line: 1 });
    expect(await r.service.insert('program-start', { prog: '1', title: 'DEMO', units: 'G21', offset: 'G54' })).toBe(true);
    expect(r.lines[0]).not.toBe('');
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.every((line) => line !== '')).toBe(true);
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
  });

  it('keeps a blank line that is not under the cursor', async () => {
    const r = rig({ lines: ['G21', '', 'M30'], line: 1 });
    await r.service.insert('tool-end', { stop: 'M1' });
    expect(r.lines).toEqual(['G21', 'M9', 'M5', 'G91 G28 Z0.', 'G90', 'M1', '', 'M30']);
  });

  it('renumbers the blocks behind it in the same edit when the control wants consecutive numbers (Klartext)', async () => {
    const r = rig({
      profile: 'heidenhain-klartext',
      lines: ['0 BEGIN PGM TEST MM', '1 BLK FORM 0.1 Z X+0 Y+0 Z-20', '2 L Z+100 R0 FMAX', '3 L X+10 Y+10 R0 FMAX', '4 END PGM TEST MM'],
      line: 3,
    });
    expect(await r.service.insert('stop', { note: 'CHECK' })).toBe(true);
    expect(r.lines).toEqual([
      '0 BEGIN PGM TEST MM',
      '1 BLK FORM 0.1 Z X+0 Y+0 Z-20',
      '2 L Z+100 R0 FMAX',
      '3 STOP ;CHECK',
      '4 L X+10 Y+10 R0 FMAX',
      '5 END PGM TEST MM',
    ]);
    // Insert and renumber are one edit.
    expect(r.model.stack).toEqual(['stack', 'edit', 'stack']);
    expect(r.model.ops).toHaveLength(1);
  });

  it('goes behind the last line of a Klartext block, never into its `~` lines, and renumbers what follows', async () => {
    const r = rig({
      profile: 'heidenhain-klartext',
      lines: ['0 BEGIN PGM T MM', '1 CYCL DEF 200 DRILLING ~', '   Q200=2 ;SET-UP ~', '   Q201=-15 ;DEPTH', '2 CYCL CALL', '3 END PGM T MM'],
      line: 3,
    });
    expect(await r.service.insert('stop', { note: 'X' })).toBe(true);
    expect(r.lines).toEqual([
      '0 BEGIN PGM T MM',
      '1 CYCL DEF 200 DRILLING ~',
      '   Q200=2 ;SET-UP ~',
      '   Q201=-15 ;DEPTH',
      '2 STOP ;X',
      '3 CYCL CALL',
      '4 END PGM T MM',
    ]);
  });

  it('refuses a locked program in plain words and writes nothing, not even the form', async () => {
    const r = rig({ doc: { readOnly: true, readOnlyReason: 'user' } });
    expect(await r.service.insert('tool-end')).toBe(false);
    expect(r.forms).toEqual([]);
    expect(r.model.stack).toEqual([]);
    expect(r.statuses).toHaveLength(1);
    expect(r.statuses[0]).toMatchObject({ error: true });
    expect(r.statuses[0].text).toContain('Insert Tool end');
    expect(r.statuses[0].text).toContain('locked against editing');
  });

  it('refuses when nothing is open, in a file that is no program, and for a template the program does not offer', async () => {
    const r = rig();
    expect(await r.service.insert('threading', {})).toBe(false);
    expect(r.statuses.pop()?.text).toBe(t('templates.notOffered', { id: 'threading' }));

    const json = rig({ doc: { path: '/cfg/profiles/mine.json' } });
    expect(await json.service.insert('tool-end', {})).toBe(false);
    expect(json.statuses.pop()?.text).toBe(t('templates.notProgram'));

    const none = rig();
    none.docs.remove(none.id);
    expect(await none.service.insert('tool-end', {})).toBe(false);
    expect(none.statuses.pop()).toEqual({ text: t('templates.noDocument'), error: true });
  });

  it('writes nothing when the values do not fit, and says which', async () => {
    const r = rig();
    expect(await r.service.insert('tool-end', { stop: 'M99' })).toBe(false);
    expect(r.statuses[0].error).toBe(true);
    expect(r.model.stack).toEqual([]);
  });

  it('plans a Klartext insertion: the tail line stays, the blocks behind move up, the result ends at the last change', () => {
    const cp = effectiveOf('heidenhain-klartext').cp;
    const doc = ['0 A', '1 B ~', '   Q1=2', '2 C', '3 D'];
    const io = { editor: { getLineCount: () => doc.length, getLines: (_id: string, s: number, e: number) => doc.slice(s - 1, e) } };
    const plan = planInsertion(io as never, 'd1', cp, { last: 3, text: ['2 X'], blocks: 1, prevBlockNumber: 1 });
    expect(plan).toEqual({ start: 3, end: 5, lines: ['   Q1=2', '2 X', '3 C', '4 D'], lastInserted: 4 });
    // Nothing behind it that is numbered: nothing else changes.
    expect(planInsertion(io as never, 'd1', cp, { last: 5, text: ['9 X'], blocks: 1, prevBlockNumber: 3 })).toEqual({ start: 5, end: 5, lines: ['3 D', '9 X'], lastInserted: 6 });
  });
})

describe('renumbering what follows', () => {
  const cp = effectiveOf('heidenhain-klartext').cp;
  const numberOf = (line: string) => blockNumberOf(line, cp);

  it('numbers the following blocks one after the other from `next`', () => {
    expect(renumberFollowing(['4 L X+1', '5 L X+2', '6 END PGM T MM'], 7, numberOf)).toEqual(['7 L X+1', '8 L X+2', '9 END PGM T MM']);
  });

  it('leaves a tail line alone and cuts the result after the last line that changed', () => {
    expect(renumberFollowing(['3 L X+1 ~', '   Y+2', '4 L X+3', '5 L X+4'], 3, numberOf)).toEqual([]);
    expect(renumberFollowing(['3 L X+1 ~', '   Y+2', '4 L X+3', '5 L X+4'], 4, numberOf)).toEqual(['4 L X+1 ~', '   Y+2', '5 L X+3', '6 L X+4']);
    expect(renumberFollowing(['3 L X+1', '4 L X+2', '9 L X+3'], 4, numberOf)).toEqual(['4 L X+1', '5 L X+2', '6 L X+3']);
  });
});

describe('the form', () => {
  it('opens with the template’s label, one field per parameter, its defaults and the review note', async () => {
    const r = rig();
    r.answer.value = undefined;
    expect(await r.service.insert('tool-end')).toBe(false);
    expect(r.forms).toHaveLength(1);
    const form = r.forms[0];
    expect(form.title).toBe('Tool end');
    expect(form.fields.map((f) => f.id)).toEqual(['stop']);
    expect(form.values).toEqual({ stop: 'M1' });
    expect(form.okLabel).toBe(t('templates.insertOk'));
    expect(form.note).toBe(t('templates.reviewPending'));
    expect(r.model.stack).toEqual([]);
  });

  it('says nothing about a review when the template carries no mark', async () => {
    const extra = [{ id: 'plain', label: 'Plain', group: 'Program', body: 'M0' }];
    const r = rig({ view: effectiveOf('fanuc-gcode', { extra }) });
    await r.service.insert('plain');
    // No parameter: still a form (the user confirms), without a note.
    expect(r.forms[0].note).toBeUndefined();
  });

  it('inserts what the form answered', async () => {
    const r = rig();
    r.answer.value = { stop: 'M0' };
    expect(await r.service.insert('tool-end')).toBe(true);
    expect(r.lines).toContain('N70 M0');
  });

  it('its live hook refuses a value in plain words, beside its field, with no preview', async () => {
    const r = rig();
    await r.service.insert('drill');
    const live = r.forms[0].live!;
    const bad = live({ ret: 'G98', x: '10', y: '10', z: '', r: '2', f: '150' });
    expect(Object.keys(bad.fieldErrors ?? {})).toEqual(['z']);
    expect(text(bad.fieldErrors!.z)).toBe(t('templates.value.required'));
    expect(bad.preview).toBeUndefined();
    const worse = live({ ret: 'G98', x: '10', y: '10', z: 'abc', r: '2', f: '150' });
    expect(text(worse.fieldErrors!.z)).toBe(t('templates.value.notANumber'));
  });

  it('its live hook previews the text with the numbers of the program the cursor is in', async () => {
    const r = rig({ line: 3 });
    await r.service.insert('drill');
    const live = r.forms[0].live!;
    const ok = live({ ret: 'G98', x: '10', y: '20.', z: '-18', r: '2', f: '150' });
    expect(ok.fieldErrors).toBeUndefined();
    expect(ok.error).toBeUndefined();
    expect(ok.preview).toBe('N30 G98 G81 X10. Y20. Z-18. R2. F150.\nN40 G80');
  });

  it('its live hook computes the formulas: a formula field updates, a failing one is an error and no preview', async () => {
    const extra = [
      {
        id: 'feed',
        label: 'Feed from tooth load',
        group: 'Milling',
        body: '{{N}}G1 F{{feed}}',
        params: [
          { id: 'n', label: 'Spindle speed', type: 'integer', required: true, default: 3000 },
          { id: 'fz', label: 'Feed per tooth', type: 'number', required: true, default: '0.05' },
          { id: 'z', label: 'Teeth', type: 'integer', required: true, default: 4 },
          { id: 'feed', label: 'Feed (mm/min)', type: 'formula', formula: 'n * fz * z', decimals: 'min1' },
          { id: 'check', label: 'Hidden', type: 'formula', formula: '1 / z', decimals: 3, hidden: true },
        ],
      },
    ];
    const r = rig({ view: effectiveOf('fanuc-gcode', { extra }), lines: ['N10 G21'], line: 1 });
    await r.service.insert('feed');
    const form = r.forms[0];
    // The visible formula is a read-only field; the hidden one is not a field at all.
    expect(form.fields.map((f) => f.id)).toEqual(['n', 'fz', 'z', 'feed']);
    expect(form.fields[3].readOnly).toBe(true);
    const ok = form.live!({ n: '3000', fz: '0.05', z: '4', feed: '' });
    expect(ok.values).toEqual({ feed: '600' });
    expect(ok.preview).toBe('N20 G1 F600.');
    const changed = form.live!({ n: '4000', fz: '0.05', z: '4', feed: '' });
    expect(changed.values).toEqual({ feed: '800' });
    // A value that makes the formula fail (the hidden one divides by Z): an error, no preview.
    const broken = form.live!({ n: '3000', fz: '0.05', z: '0', feed: '' });
    expect(broken.preview).toBeUndefined();
    expect(broken.error ?? broken.fieldErrors).toBeDefined();
  });

  it('a snippet template has no form: the snippet controller gets its text', async () => {
    const extra = [{ id: 'quick', label: 'Quick hole', group: 'Drilling', snippet: true, body: '{{N}}G81 Z${1:-5.} R${2:2.} F${3:100}' }];
    const r = rig({ view: effectiveOf('fanuc-gcode', { extra }), line: 3 });
    expect(await r.service.insert('quick')).toBe(true);
    expect(r.forms).toEqual([]);
    expect(r.snippets).toEqual([{ template: 'N30 G81 Z${1:-5.} R${2:2.} F${3:100}', at: { line: 3, replace: false } }]);
    expect(r.model.stack).toEqual([]);
    const blank = rig({ view: effectiveOf('fanuc-gcode', { extra }), lines: [''], line: 1 });
    await blank.service.insert('quick');
    expect(blank.snippets[0].at).toEqual({ line: 1, replace: true });
  });
});

describe('remembered values', () => {
  const extra = [
    {
      id: 'program-start',
      label: 'Program start',
      group: 'Program',
      toolbar: true,
      body: '{{N}}T{{t}} {{name}}',
      params: [
        { id: 't', label: 'Tool', type: 'integer', required: true, default: 1, remember: true },
        { id: 'name', label: 'Name', type: 'text', default: 'FIRST' },
      ],
    },
  ];

  it('saves the parameters that ask for it under the database and the template, and starts the next form with them', async () => {
    const r = rig({ view: effectiveOf('fanuc-gcode', { extra }) });
    r.answer.value = { t: '7', name: 'SECOND' };
    expect(await r.service.insert('program-start')).toBe(true);
    expect([...r.memo.keys()]).toEqual(['template:fanuc:program-start']);
    expect(r.memo.get('template:fanuc:program-start')).toEqual({ t: '7' });
    r.answer.value = undefined;
    await r.service.insert('program-start');
    expect(r.forms[1].values).toEqual({ t: '7', name: 'FIRST' });
  });

  it('keeps each database’s values apart: the program start of a system-B lathe does not read the A one', async () => {
    const a = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe', { gcodeSystem: 'A', extra }) });
    a.answer.value = { t: '4', name: 'X' };
    await a.service.insert('program-start');
    expect([...a.memo.keys()]).toEqual(['template:fanuc-lathe:program-start']);

    const b = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe', { gcodeSystem: 'B', extra }) });
    b.memo.set('template:fanuc-lathe:program-start', { t: '4' });
    b.answer.value = undefined;
    await b.service.insert('program-start');
    expect(b.forms[0].values).toEqual({ t: '1', name: 'FIRST' });
    b.answer.value = { t: '9', name: 'Y' };
    await b.service.insert('program-start');
    expect([...b.memo.keys()].sort()).toEqual(['template:fanuc-lathe-b:program-start', 'template:fanuc-lathe:program-start']);
  });

  it('ignores a remembered value that no longer suits its field, and asks nothing and remembers nothing when it is given the values', async () => {
    const r = rig({ view: effectiveOf('fanuc-gcode', { extra }) });
    r.memo.set('template:fanuc:program-start', { t: 5, gone: 'x' });
    r.answer.value = undefined;
    await r.service.insert('program-start');
    expect(r.forms[0].values).toEqual({ t: '1', name: 'FIRST' });
    const before = r.forms.length;
    expect(await r.service.insert('program-start', { t: '2', name: 'Z' })).toBe(true);
    expect(r.forms).toHaveLength(before);
    expect(r.memo.get('template:fanuc:program-start')).toEqual({ t: 5, gone: 'x' });
  });
});

describe('favourites', () => {
  it('keeps the starred ids per database in state.json and reads them as untrusted', () => {
    const r = rig();
    r.service.setFavorite('fanuc', 'drill', true);
    r.service.setFavorite('fanuc', 'tapping', true);
    r.service.setFavorite('fanuc', 'drill', true);
    r.service.setFavorite('okuma', 'tool-end', true);
    expect(r.service.favorites('fanuc')).toEqual(['drill', 'tapping']);
    expect(r.memo.get(FAVORITES_KEY)).toEqual({ fanuc: ['drill', 'tapping'], okuma: ['tool-end'] });
    r.service.setFavorite('fanuc', 'drill', false);
    expect(r.service.favorites('fanuc')).toEqual(['tapping']);
    expect(r.service.favorites('heidenhain')).toEqual([]);

    r.memo.set(FAVORITES_KEY, { fanuc: ['ok', 7, 'Bad Id', 'ok', '', null], other: 'x', __proto__x: 1 } as never);
    expect(r.service.favorites('fanuc')).toEqual(['ok']);
    expect(r.service.favorites('other')).toEqual([]);
    expect(r.service.favorites('constructor')).toEqual([]);
    r.memo.set(FAVORITES_KEY, 'nonsense' as never);
    expect(r.service.favorites('fanuc')).toEqual([]);
  });

  it('refuses an id that is no template id and a dialect called __proto__ is only a name', () => {
    const r = rig();
    r.service.setFavorite('fanuc', 'Not An Id', true);
    expect(r.memo.has(FAVORITES_KEY)).toBe(false);
    r.service.setFavorite('__proto__', 'drill', true);
    expect(r.service.favorites('__proto__')).toEqual(['drill']);
    expect(({} as Record<string, unknown>).drill).toBeUndefined();
  });

  it('keeps at most 200 and drops the oldest', () => {
    const r = rig();
    for (let i = 0; i < 205; i++) r.service.setFavorite('fanuc', `t${i}`, true);
    const stars = r.service.favorites('fanuc');
    expect(stars).toHaveLength(200);
    expect(stars[0]).toBe('t5');
  });
});

describe('changed', () => {
  it('bumps on a machine or profile revision, on a profile or machine switch of a document and on a favourite, not on typing', () => {
    const r = rig();
    const seen: number[] = [];
    const stop = r.service.changed.subscribe((n) => seen.push(n));
    const count = (): number => seen.length;
    const start = count();
    r.revisions.machines.update((n) => n + 1);
    expect(count()).toBe(start + 1);
    r.revisions.profiles.update((n) => n + 1);
    expect(count()).toBe(start + 2);
    r.docs.update(r.id, { textDirty: true });
    expect(count()).toBe(start + 2);
    r.docs.update(r.id, { profileId: 'fanuc-lathe' });
    expect(count()).toBe(start + 3);
    r.docs.update(r.id, { machineId: 'm1' });
    expect(count()).toBe(start + 4);
    r.service.setFavorite('fanuc', 'drill', true);
    expect(count()).toBe(start + 5);
    r.service.setFavorite('fanuc', 'drill', true);
    expect(count()).toBe(start + 5);
    expect(get(r.service.changed)).toBeGreaterThan(0);
    stop();
  });
});

describe('the formula values shown in the form', () => {
  it('has none for a template without a formula', () => {
    const [tpl] = loadTemplates([{ id: 'a', label: 'A', group: 'G', body: 'M0' }]);
    expect(formulaValues(tpl, {}, {})).toBeUndefined();
  });
});

describe('the groups of the Insert tab', () => {
  const list = loadTemplates([
    { id: 'a1', label: 'A1', group: 'Program', toolbar: true, body: 'x' },
    { id: 'a2', label: 'A2', group: 'Program', body: 'x' },
    { id: 'b1', label: 'B1', group: 'Drilling', body: 'x' },
    { id: 'b2', label: 'B2', group: 'Drilling', toolbar: true, body: 'x' },
    { id: 'c1', label: 'C1', group: 'Program', toolbar: true, body: 'x' },
  ]);
  const shape = (groups: ReturnType<typeof templateGroups>) => groups.map((g) => [g.key, g.favorites, ids(g.buttons), ids(g.more)]);

  it('shows the toolbar templates as buttons and the rest in the group’s list, groups in order of appearance', () => {
    expect(shape(templateGroups(list, []))).toEqual([
      ['Program', false, ['a1', 'c1'], ['a2']],
      ['Drilling', false, ['b2'], ['b1']],
    ]);
  });

  it('puts the starred templates first as buttons, once, and skips a star that is no template', () => {
    expect(shape(templateGroups(list, ['b1', 'gone', 'a2', 'b1']))).toEqual([
      ['', true, ['b1', 'a2'], []],
      ['Program', false, ['a1', 'c1'], []],
      ['Drilling', false, ['b2'], []],
    ]);
  });

  it('has no group for an empty list', () => {
    expect(templateGroups([], ['a'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// P3b fix NC (plan §7 #253 ff.)
// ---------------------------------------------------------------------------------------------

describe('P3b fix NC: block numbers a template names (NC-01, SK-02)', () => {
  const LATHE = ['%', 'O1000', 'N10 G50 S2000', 'N100 G0 X50.', 'N200 G1 Z-10.', 'N210 M30'];

  it('NC-01: the form offers contour numbers the program does not use, and they differ', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: LATHE, line: 4 });
    await r.service.insert('rough-finish');
    const values = r.forms[0].values ?? {};
    expect(['100', '200']).not.toContain(String(values.ns));
    expect(['100', '200']).not.toContain(String(values.nf));
    expect(values.ns).not.toBe(values.nf);
    // Neither may be a number the template writes with {{N}} after N100 (N110 … N140).
    expect(['110', '120', '130', '140']).not.toContain(String(values.ns));
    const ok = r.forms[0].live!(values);
    expect(ok.fieldErrors).toBeUndefined();
    expect(ok.preview).toContain(`G71 P${String(values.ns)} Q${String(values.nf)}`);
  });

  it('NC-01: a typed number that the program uses is refused beside its field, and not inserted', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: LATHE, line: 4 });
    await r.service.insert('rough-finish');
    const values = { ...(r.forms[0].values ?? {}), ns: '100' };
    const bad = r.forms[0].live!(values);
    expect(bad.fieldErrors?.ns).toEqual({ key: 'templates.value.blockNumberUsed', params: { number: 'N100', line: 4 } });
    expect(bad.preview).toBeUndefined();
    expect(text(bad.fieldErrors!.ns)).toBe('N100 is already on line 4. P and Q need a block number of their own.');
    const own = r.forms[0].live!({ ...values, ns: '120' });
    expect(own.fieldErrors?.ns?.key).toBe('templates.value.blockNumberOwn');
    const twice = r.forms[0].live!({ ...values, ns: '900', nf: '900' });
    expect(twice.fieldErrors?.nf?.key).toBe('templates.value.blockNumberTwice');
    // The insert reads the program again and refuses too.
    const before = [...r.lines];
    expect(await r.service.insert('rough-finish', values)).toBe(false);
    expect(r.lines).toEqual(before);
    expect(r.statuses.pop()?.text).toContain('N100 is already on line 4');
  });

  it('NC-01: in an empty unnumbered program the defaults stay', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: [''], line: 1 });
    await r.service.insert('rough-finish');
    expect(r.forms[0].values).toMatchObject({ ns: '100', nf: '200' });
  });

  it('NC-01: a remembered value never overrides a free contour number', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: LATHE, line: 4 });
    r.memo.set('template:fanuc-lathe:rough-finish', { ns: '100', nf: '200' });
    await r.service.insert('rough-finish');
    expect(['100', '200']).not.toContain(String(r.forms[0].values?.ns));
  });

  it('NC-01: an Okuma contour name already in the program is not offered again', async () => {
    const lines = ['$O1.MIN%', 'O1001', 'N10 G50 S2500', 'NLAP1 G81', 'G0 X16', 'G1 X34', 'G80', 'N20 G0 X80 Z5', 'N30 G85 NLAP1 D3 F0.3 U0.4 W0.2', 'N40 G87 NLAP1', 'M30'];
    const r = rig({ profile: 'okuma-osp', view: effectiveOf('okuma-osp'), lines, line: 10 });
    await r.service.insert('lap-rough-finish');
    expect(r.forms[0].values?.name).toBe('NLAP2');
    const bad = r.forms[0].live!({ ...(r.forms[0].values ?? {}), name: 'NLAP1' });
    expect(bad.fieldErrors?.name).toEqual({ key: 'templates.value.blockNameUsed', params: { number: 'NLAP1', line: 4 } });
  });

  it('NC-01 with NC-02: a template made from a selection, inserted back into its own program, gets numbers of its own', async () => {
    const source = ['N100 G71 U1.5 R0.5', 'N110 G71 P120 Q140 U0.4 W0.1 F0.25', 'N120 G0 X16.', 'N130 G1 Z-20.', 'N140 X34.', 'N150 G70 P120 Q140'];
    const base = effectiveOf('fanuc-lathe');
    const draft = templateFromSelection(source, base.cp, base.codes);
    const tpl = draftToTemplate(draft, new Set(), { id: 'my-rough', label: 'My roughing', group: 'Mine', machineType: 'lathe' });
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe', { extra: [tpl] }), lines: ['%', 'O1000', ...source, 'N160 M30'], line: 9 });
    await r.service.insert('my-rough');
    const values = r.forms[0].values ?? {};
    expect(['120', '140']).not.toContain(String(values.p));
    expect(['120', '140']).not.toContain(String(values.q));
    expect(r.forms[0].live!({ ...values, p: '120' }).fieldErrors?.p?.key).toBe('templates.value.blockNumberUsed');
  });

  it('SK-02: the form says when a number its {{N}} writes is one a P, Q or GOTO of the program names', async () => {
    const lines = ['%', 'O1000', 'N100 G0 X50.', 'N110 G71 U1. R0.5', 'N120 G71 P130 Q170 U0.4 W0.1 F0.2', 'N130 G0 X20.', 'N170 G1 X40.', 'N180 G70 P130 Q170', 'M30'];
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines, line: 3 });
    await r.service.insert('tool-start');
    expect(r.forms[0].note).toContain('P130');
    expect(r.forms[0].note).toContain('line 5');
    // Nothing named: no such note.
    const plain = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: LATHE, line: 4 });
    await plain.service.insert('tool-start');
    expect(plain.forms[0].note).toBe(t('templates.reviewPending'));
  });
});

describe('P3b fix NC: the machine behind the form (NC-09, NC-13)', () => {
  it('NC-09: on an Okuma machine set to 1 µm the form says that the sample values are for the 1 mm setting', async () => {
    const lines = ['$O1.MIN%', 'O1001', 'N10 G50 S2500'];
    const um = rig({ profile: 'okuma-osp', view: effectiveOf('okuma-osp', { numberInput: 'okuma-1um' }), lines, line: 3 });
    await um.service.insert('tool-start');
    expect(um.forms[0].note).toContain(t('templates.unitScaled', { unit: '1 µm' }));
    const mm = rig({ profile: 'okuma-osp', view: effectiveOf('okuma-osp', { numberInput: 'okuma-1mm' }), lines, line: 3 });
    await mm.service.insert('tool-start');
    expect(mm.forms[0].note).toBe(t('templates.reviewPending'));
  });

  it('NC-13: with an IS-B machine, a length with more decimals than the machine has is refused; without a machine it is not', async () => {
    const values = { ret: 'G98', x: '10.1234', y: '10', z: '-18', r: '2', f: '150' };
    const isb = rig({ view: effectiveOf('fanuc-gcode', { numberInput: 'is-b' }) });
    await isb.service.insert('drill');
    const bad = isb.forms[0].live!(values);
    expect(bad.fieldErrors?.x).toEqual({ key: 'templates.value.tooManyDecimals', params: { decimals: 3 } });
    expect(isb.forms[0].live!({ ...values, x: '10.123' }).fieldErrors).toBeUndefined();
    expect(await isb.service.insert('drill', values)).toBe(false);
    const none = rig();
    await none.service.insert('drill');
    expect(none.forms[0].live!(values).fieldErrors).toBeUndefined();
  });
});

describe('P3b fix NC: the edit (CODE-06, CODE-16)', () => {
  it('CODE-06: plans an insertion in front of 200,000 Klartext lines without running out of stack', () => {
    const cp = effectiveOf('heidenhain-klartext').cp;
    const doc = ['0 BEGIN PGM BIG MM', ...Array.from({ length: 200_000 }, (_, i) => `${i + 1} L X+${i % 100} R0 FMAX`), '200001 END PGM BIG MM'];
    const io = { editor: { getLineCount: () => doc.length, getLines: (_id: string, s: number, e: number) => doc.slice(s - 1, e) } };
    const plan = planInsertion(io as never, 'd1', cp, { last: 1, text: ['1 STOP'], blocks: 1, prevBlockNumber: 0 });
    expect(plan.lines.length).toBe(doc.length + 1);
    expect(plan.lines[2]).toBe('2 L X+0 R0 FMAX');
    expect(plan.lines[plan.lines.length - 1]).toBe('200002 END PGM BIG MM');
  });

  it('CODE-16: a program locked while the form is open is refused, and nothing is written', async () => {
    const r = rig();
    r.answer.value = (call) => {
      r.docs.update(r.id, { readOnly: true, readOnlyReason: 'user' });
      return call.values;
    };
    expect(await r.service.insert('tool-end')).toBe(false);
    expect(r.model.stack).toEqual([]);
    expect(r.statuses.pop()).toMatchObject({ error: true });
  });
});

describe('P3b fix H: the scan behind the form (known gap 23)', () => {
  const COUNT = 5000;
  const numbered = (): string[] => ['%', 'O1000', ...Array.from({ length: COUNT - 2 }, (_, i) => `N${(i + 1) * 10} G1 X${i % 100}.5 Z-${i % 50}.`)];
  const unnumbered = (): string[] => ['%', 'O1000', ...Array.from({ length: COUNT - 2 }, (_, i) => `G1 X${i % 100}.5 Z-${i % 50}.`)];

  /** Counts what the service reads of the document: whole-program reads and all lines. */
  function metered(r: Rig, version?: { value: number }): { whole: number; lines: number } {
    const seen = { whole: 0, lines: 0 };
    const read = r.deps.editor.getLines;
    r.deps.editor.getLines = (id, from, to) => {
      const out = read(id, from, to);
      seen.lines += out.length;
      if (from <= 1 && out.length >= r.lines.length) seen.whole++;
      return out;
    };
    if (version !== undefined) r.deps.editor.versionId = () => version.value;
    return seen;
  }

  it('a program without block numbers is not scanned: the template has no number of its own to keep apart', async () => {
    const r = rig({ lines: unnumbered(), line: COUNT });
    const seen = metered(r, { value: 1 });
    r.answer.value = (call) => call.values;
    // "Tool change" writes {{N}}, but in a program that has no numbers it writes none.
    expect(await r.service.insert('tool-change')).toBe(true);
    expect(seen.whole).toBe(0);
    expect(seen.lines).toBeLessThan(COUNT);
    expect(r.lines.some((l) => /^N\d/.test(l))).toBe(false);
  });

  it('the form and the Insert read a numbered program once while it stays at the same version', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: numbered(), line: COUNT });
    const seen = metered(r, { value: 1 });
    r.answer.value = (call) => call.values;
    expect(await r.service.insert('rough-finish')).toBe(true);
    expect(seen.whole).toBe(1);
    // The numbers are the ones a scan finds: the contour numbers are free in a program that runs to N49970.
    const written = r.lines.slice(COUNT).join('\n');
    expect(written).toMatch(/G71 P\d+ Q\d+/);
  });

  it('a second insertion reads the program again (the answer is not kept past the insertion)', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: numbered(), line: COUNT });
    const seen = metered(r, { value: 1 });
    r.answer.value = (call) => call.values;
    await r.service.insert('rough-finish');
    r.cursor.line = r.lines.length;
    await r.service.insert('rough-finish');
    expect(seen.whole).toBe(2);
  });

  it('a change of the program while the form is open is seen by the Insert: the number it took is refused', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: numbered(), line: COUNT });
    const version = { value: 1 };
    const seen = metered(r, version);
    let taken = '';
    r.answer.value = (call) => {
      taken = String(call.values?.ns);
      // Somebody types a block with that number elsewhere in the program.
      r.lines[10] = `N${taken} G0 X1.`;
      version.value = 2;
      return call.values;
    };
    const before = [...r.lines];
    expect(await r.service.insert('rough-finish')).toBe(false);
    expect(seen.whole).toBe(2);
    expect(r.lines.slice(0, 10)).toEqual(before.slice(0, 10));
    expect(r.lines.length).toBe(before.length);
    expect(r.statuses.pop()?.text).toContain(`N${taken} is already on line 11`);
  });

  it('a version source answering 0 (no model) is not trusted: a block typed while the form is open is refused at Insert', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: numbered(), line: COUNT });
    const seen = metered(r, { value: 0 });
    r.answer.value = (call) => {
      // The text changes at the same "version" 0 and the line count stays.
      r.lines[10] = `N${String(call.values?.ns)} G0 X1.`;
      return call.values;
    };
    const before = [...r.lines];
    expect(await r.service.insert('rough-finish')).toBe(false);
    expect(seen.whole).toBe(2);
    expect(r.lines.length).toBe(before.length);
    expect(r.statuses.pop()?.text).toContain('is already on line 11');
  });

  it('a negative or non-numeric version is no version either', async () => {
    for (const bad of [-1, Number.NaN]) {
      const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: numbered(), line: COUNT });
      const seen = metered(r, { value: bad });
      r.answer.value = (call) => call.values;
      expect(await r.service.insert('rough-finish')).toBe(true);
      expect(seen.whole).toBe(2);
    }
  });

  it('without a version from the editor nothing is kept: the Insert scans again and still sees the change', async () => {
    const r = rig({ profile: 'fanuc-lathe', view: effectiveOf('fanuc-lathe'), lines: numbered(), line: COUNT });
    const seen = metered(r);
    r.answer.value = (call) => {
      r.lines[10] = `N${String(call.values?.ns)} G0 X1.`;
      return call.values;
    };
    expect(await r.service.insert('rough-finish')).toBe(false);
    expect(seen.whole).toBe(2);
  });
});
