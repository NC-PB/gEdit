// Edit Cycle (Phase 3 plan §5 P3.5, AD-39; the engine is `core/templates/cycleForm.ts`, P3.8).
// One feature per file (plan AD-3); see ./README.md. Owner: P3.5.
//
// `nc.editCycle` (Insert tab, group `cycleForm.group`; palette; no key):
//
//   1. On a block that writes a cycle, the form of that cycle: one field per parameter of the
//      code database, filled in from the block as it is written. OK rewrites only the words that
//      changed (`applyCycleForm`), as one undo step; confirming without a change writes nothing.
//   2. On a line with no cycle, a quick pick of the database's cycles (`cycleEntries`) and the
//      empty form of the one chosen; OK inserts a new block after the cursor's block (in place of
//      a blank cursor line), numbered by the template rule, and in Klartext the blocks behind it
//      are renumbered in the same edit.
//   3. A block the form cannot edit (a cycle written in two blocks, a cycle that is not
//      confirmed in the database yet, a block that runs a cycle written on another line…) is
//      refused in the status bar with the reason in plain words, and nothing is written.
//
// P3b fix NC (plan §7 #253 ff.): a modal cycle is inserted with its cancel and the note says so
// (review NC-05; the engine refuses an insert inside a cycle that is on, SK-01); a Sinumerik
// drilling cycle inserted as a call says that it drills at once, with the feed in force (SK-03);
// a field of a word written without a point shows what the machine reads (NC-08) as its help.
//
// The values are typed as they are written (`10.` is not `10` on a control that reads a point),
// so the fields are text fields; the engine checks every value (bounds, whole numbers, the
// reading on the machine) and the form shows its answers as they are typed (`live`: the errors
// beside the fields and the resulting block under them). Every list reads the document's
// **effective** view (AD-31).

import PencilRuler from 'lucide-svelte/icons/pencil-ruler';
import { asIcon } from '$lib/app/icons';
import { modal as appModal } from '$lib/app/modalService';
import { modals as appModals } from '$lib/app/modals';
import { lockRefusal } from '$lib/app/readOnlyLock';
import { status as appStatus } from '$lib/app/status';
import { planInsertion, templateEnv } from '$lib/app/templateService';
import { blockRange, type InspectInput, type InspectView } from '$lib/core/codes/inspect';
import type { FieldSpec } from '$lib/core/forms/types';
import { blockNumberOf } from '$lib/core/nc/tokenizer';
import { isNcDocumentPath } from '$lib/core/profiles/ncDocument';
import {
  applyCycleForm,
  cycleEntries,
  cycleFormAt,
  cycleFormFor,
  CYCLE_FORM_WHOLE,
  TEMPLATE_TEST_IDS,
  type CycleForm,
} from '$lib/core/templates';
import { cancelOf } from '$lib/core/templates/cycleForm';
import { applyLines as applyLinesToModel } from '$lib/monaco/applyLines';
import { editor as appEditor } from '$lib/monaco/editorService';
import { docs as appDocs } from '$lib/stores/documents';
import { machines as appMachines } from '$lib/stores/machines';
import { t as translate } from '$lib/i18n';
import type { EffectiveProfile } from '$lib/core/machines/types';
import type {
  DocId,
  DocumentStore,
  EditorService,
  FormLiveResult,
  Modals,
  ModalService,
  Msg,
  StatusService,
  Translate,
} from '$lib/app/types';
import type { Contribution } from '$lib/app/types';

export interface CycleEditDeps {
  docs: Pick<DocumentStore, 'getActiveId' | 'get'>;
  editor: Pick<EditorService, 'cursor' | 'getLineCount' | 'getLines' | 'reveal'>;
  effective(id: DocId): EffectiveProfile;
  modal: Pick<ModalService, 'stateAfter'>;
  modals: Pick<Modals, 'form' | 'quickPick'>;
  applyLines(id: DocId, startLine: number, endLine: number, newLines: string[]): { changedLines: number; locked?: true };
  status: Pick<StatusService, 'show'>;
  now(): Date;
  t: Translate;
}

/**
 * The Sinumerik drilling cycles that run where they are called, with the feed in force (SK-03;
 * the cycles manual's sequence of CYCLE81 and the cycles after it). `CYCLE84` and `CYCLE840`
 * tap with the pitch, not the feed.
 */
const DRILLS_AT_ONCE = /^CYCLE8[1235-9]$/i;

/** How an Edit Cycle ended. */
export type CycleOutcome = 'edited' | 'inserted' | 'unchanged' | 'cancelled' | 'refused';

/** The form's fields for the control: values are typed as written, so a number is a text field. */
export function textFields(fields: readonly FieldSpec[]): FieldSpec[] {
  return fields.map((field) => {
    if (field.readOnly === true) return field;
    const { min: _min, max: _max, decimals: _decimals, ...rest } = field;
    void [_min, _max, _decimals];
    return { ...rest, type: 'text' };
  });
}

export function createCycleEditor(deps: CycleEditDeps): { editCycle(): Promise<CycleOutcome> } {
  const { t } = deps;
  const say = (text: string, error = false): void => deps.status.show(text, error ? { error: true } : undefined);
  const sayMsg = (msg: Msg, error = false): void => say(t(msg.key, msg.params), error);

  const lineOf = (id: DocId, n: number): string => deps.editor.getLines(id, n, n)[0] ?? '';

  function inputOf(id: DocId, line: number): InspectInput {
    const lineCount = Math.max(1, deps.editor.getLineCount(id));
    return { line: Math.min(Math.max(1, Math.trunc(line) || 1), lineCount), lineCount, getLine: (n) => lineOf(id, n) };
  }

  async function editCycle(): Promise<CycleOutcome> {
    const id = deps.docs.getActiveId();
    const doc = id === null ? undefined : deps.docs.get(id);
    if (id === null || doc === undefined) {
      say(t('cycleForm.noDocument'), true);
      return 'refused';
    }
    if (!isNcDocumentPath(doc.path)) {
      say(t('cycleForm.notProgram'), true);
      return 'refused';
    }
    // The editor's own `readOnly` refuses the edit as well, but silently (AD-23).
    const locked = lockRefusal(doc, t('readOnly.editCycle'));
    if (locked !== null) {
      sayMsg(locked, true);
      return 'refused';
    }

    let effective: EffectiveProfile;
    try {
      effective = deps.effective(id);
    } catch {
      say(t('cycleForm.noDocument'), true);
      return 'refused';
    }
    const view: InspectView = { profile: effective.profile, cp: effective.cp, db: effective.codes, machine: effective.machine };
    const cursorLine = deps.editor.cursor()?.line ?? 1;
    const input = inputOf(id, cursorLine);
    const stateAfter = (): ReturnType<ModalService['stateAfter']> => deps.modal.stateAfter(id, blockRange(inputOf(id, cursorLine), view.cp).last);

    // 1. The cycle at the cursor, or a refusal, or a cycle chosen for a new block.
    let form: CycleForm;
    const found = cycleFormAt(input, view, stateAfter());
    if (found === null) {
      const entries = cycleEntries(view.db, view.profile.machineType);
      if (entries.length === 0) {
        say(t('cycleForm.noCycles'), true);
        return 'refused';
      }
      const chosen = await deps.modals.quickPick(
        entries.map((entry) => ({ label: entry.code, description: entry.label, value: entry })),
        { placeholder: t('cycleForm.pickPlaceholder') },
      );
      if (chosen === undefined) return 'cancelled';
      form = cycleFormFor(chosen, view);
    } else if (!found.ok) {
      sayMsg(found.reason, true);
      return 'refused';
    } else {
      form = found.form;
    }

    const envFor = (): ReturnType<typeof templateEnv> => templateEnv(deps, id, view.cp, cursorLine);
    const attempt = (values: Record<string, unknown>) => applyCycleForm(form, values, inputOf(id, cursorLine), view, stateAfter(), envFor());

    // 2. The form: the engine's answer to the values as they stand, shown as they are typed.
    const live = (values: Record<string, unknown>): FormLiveResult => {
      const edit = attempt(values);
      if (edit.ok) return { preview: edit.lines.join('\n') };
      const answer: FormLiveResult = {};
      const fieldErrors: Record<string, Msg> = {};
      for (const [address, msg] of Object.entries(edit.errors)) {
        if (address === CYCLE_FORM_WHOLE) answer.error = msg;
        else fieldErrors[address] = msg;
      }
      if (Object.keys(fieldErrors).length > 0) answer.fieldErrors = fieldErrors;
      return answer;
    };
    // What the form says besides the fields (P3b fix NC-05, SK-03, NC-08).
    const notes: string[] = [];
    if (form.kept.length > 0) notes.push(t('cycleForm.kept', { words: form.kept.join(' ') }));
    if (form.mode === 'insert') {
      const cancel = cancelOf(form.entry, view.db);
      if (cancel !== null) notes.push(t('cycleForm.cancelAdded', { cancel }));
      if (DRILLS_AT_ONCE.test(form.entry.code) && form.entry.modal !== true) notes.push(t('cycleForm.runsAtOnce'));
    }
    const readings = form.readings ?? {};
    const fields = textFields(form.fields).map((field) => {
      const reading = Object.prototype.hasOwnProperty.call(readings, field.id) ? readings[field.id] : undefined;
      return reading === undefined ? field : { ...field, help: t(reading.key, reading.params) };
    });
    const answered = await deps.modals.form({
      title: t('cycleForm.title', { code: form.entry.code, label: form.entry.label }),
      fields,
      values: form.values,
      okLabel: form.mode === 'edit' ? t('cycleForm.okEdit') : t('cycleForm.okInsert'),
      note: notes.length > 0 ? notes.join(' ') : undefined,
      marker: { testid: TEMPLATE_TEST_IDS.cycleForm, data: { cycle: form.entry.code, mode: form.mode } },
      live,
    });
    if (answered === undefined) return 'cancelled';

    // 3. The edit, from the program as it is now.
    const current = deps.docs.get(id);
    const stillLocked = current === undefined ? null : lockRefusal(current, t('readOnly.editCycle'));
    if (stillLocked !== null) {
      sayMsg(stillLocked, true);
      return 'refused';
    }
    const edit = attempt(answered);
    if (!edit.ok) {
      const first = Object.values(edit.errors)[0];
      if (first !== undefined) sayMsg(first, true);
      return 'refused';
    }

    const code = form.entry.code;
    if (form.mode === 'edit') {
      const old = deps.editor.getLines(id, edit.first, edit.last);
      if (old.length === edit.lines.length && old.every((line, i) => line === edit.lines[i])) {
        say(t('cycleForm.unchanged'));
        return 'unchanged';
      }
      const done = deps.applyLines(id, edit.first, edit.last, edit.lines);
      return finish(id, done, code, 'edited');
    }

    // A new block goes after line `edit.first - 1`, as a template does.
    const blocks = edit.lines.filter((line) => blockNumberOf(line, view.cp) !== null).length;
    const env = envFor();
    const plan = planInsertion(deps, id, view.cp, { last: edit.first - 1, text: edit.lines, blocks, prevBlockNumber: env.prevBlockNumber });
    const done = deps.applyLines(id, plan.start, plan.end, plan.lines);
    const outcome = finish(id, done, code, 'inserted');
    if (outcome === 'inserted') deps.editor.reveal(id, plan.lastInserted, (edit.lines[edit.lines.length - 1] ?? '').length + 1);
    return outcome;
  }

  function finish(id: DocId, done: { changedLines: number; locked?: true }, code: string, outcome: 'edited' | 'inserted'): CycleOutcome {
    if (done.locked === true) {
      const doc = deps.docs.get(id);
      const locked = doc === undefined ? null : lockRefusal(doc, t('readOnly.editCycle'));
      if (locked !== null) sayMsg(locked, true);
      return 'refused';
    }
    if (done.changedLines === 0) return 'unchanged';
    say(t(outcome === 'edited' ? 'cycleForm.edited' : 'cycleForm.inserted', { code }));
    return outcome;
  }

  return { editCycle };
}

/** The application-wide Edit Cycle. */
export const cycleEditor = createCycleEditor({
  docs: appDocs,
  editor: appEditor,
  effective: (id) => appMachines.effective(id),
  modal: appModal,
  modals: appModals,
  applyLines: applyLinesToModel,
  status: appStatus,
  now: () => new Date(),
  t: translate,
});

export default {
  id: 'cycleForms',
  commands: [
    {
      id: 'nc.editCycle',
      title: 'cycleForm.edit',
      category: 'cycleForm.category',
      icon: asIcon(PencilRuler),
      enabled: (c) => c.activeDocId !== null,
      run: () => cycleEditor.editCycle(),
    },
  ],
  ribbon: [{ tab: 'insert', group: 'cycleForm.group', command: 'nc.editCycle', order: 20 }],
} satisfies Contribution;
