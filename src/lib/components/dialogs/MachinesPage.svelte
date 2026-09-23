<!--
  Settings ▸ Machines (plan §7.15, AD-31 "Management"). Owner: WP6.10.

  A page of its own rather than a group of settings keys because machine configurations are
  records, not settings: `pagesOf` only builds pages from `SETTING_FIELDS` (F47), and no
  machine data lives in `settings.json` (D50).

  Four rules this page exists to keep:

   1. **While the machines file could not be read, nothing may be written.** Every write
      action is disabled and only "Open machines file" and "Replace with an empty file" are
      offered, so a broken hand edit is never overwritten behind the user's back (AD-31).
   2. **A record the form cannot express is kept.** Number rules written by hand that match
      no preset show as "Custom (edited in the file)" and survive an edit of the name; so
      does anything a later version adds (`core/machines/fields.ts`).
   3. **Nothing is corrected in silence.** Switching the G-code system re-offers the
      power-on codes of the database that system actually uses, and a code the new system
      does not have is dropped **with a message saying so**.
   4. **The form is the app's one form engine.** `FormRenderer` over a generated
      `FieldSpec[]` (F46, §7.5), with no machine-shaped control anywhere.

  Why the form is rendered *in the page* rather than through `modals.form`: the settings
  dialog is itself the open modal, and `app/modals.ts` allows one at a time — a nested
  `modals.form()` resolves `undefined` instead of opening. §7.15 offers `FormRenderer` as
  the other half of that sentence, and rendering here buys the thing a one-shot dialog
  could not do at all: the fields follow the variant while the user edits it.

  Machine names, dialect names, preset labels and code labels are data and are not
  translated (AD-14).
-->
<script module lang="ts">
  import {
    FIELD_NAME,
    machineFields,
    machineFromValues,
    pruneModalValues,
    variantIdOf,
  } from '$lib/core/machines/fields';
  import { initialValues } from '$lib/core/forms/values';
  import { validateFields } from '$lib/core/forms/validate';
  import type { CodeDb } from '$lib/core/codes/types';
  import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
  import type { MachineConfig, MachineParams, MachineProblem } from '$lib/core/machines/types';
  import type {
    CodeDbService,
    DocumentStore,
    MachineService,
    Msg,
    NativeDialogs,
    ProfileRegistry,
    StatusService,
    Translate,
  } from '$lib/app/types';

  /** What the page needs from the outside world, so every action is testable with a fake. */
  export interface MachinesDeps {
    machines: MachineService;
    profiles: Pick<ProfileRegistry, 'list' | 'get' | 'profile'>;
    codes: Pick<CodeDbService, 'byId'>;
    docs: Pick<DocumentStore, 'all'>;
    dialogs: Pick<NativeDialogs, 'confirm'>;
    status: Pick<StatusService, 'show'>;
    t: Translate;
  }

  /** One row of the list. An entry with problems is one the file kept but gEdit cannot use. */
  export interface MachineRow {
    id: string;
    /** The machine's own name, or its id while only its problems are known. */
    name: string;
    profileId: string;
    profileName: string;
    isDefault: boolean;
    /** Already formatted, one per problem of this record. */
    problems: string[];
    /** False for a record that failed validation: it is kept in the file, not editable here. */
    usable: boolean;
  }

  export type DraftKind = 'add' | 'edit' | 'duplicate';

  /** The machine being added or edited, as the form holds it. */
  export interface Draft {
    kind: DraftKind;
    /** The record being edited or duplicated; null while adding. */
    id: string | null;
    profileId: string;
    values: Record<string, unknown>;
  }

  /** The field of the first Add step: which dialect this machine runs. */
  export const FIELD_PROFILE = 'profile';

  const problemText = (deps: MachinesDeps, problem: MachineProblem): string =>
    deps.t('machines.page.problem', { path: problem.path, message: problem.message });

  /** The dialects a machine can be built for: the ones that declare machine parameters. */
  export function profileChoices(deps: MachinesDeps): FieldChoice[] {
    return deps.profiles
      .list()
      .filter((info) => info.hasMachineParams)
      // Dialect names are data.
      .map((info) => ({ label: info.name, value: info.id }));
  }

  export function profileField(deps: MachinesDeps): FieldSpec[] {
    const choices = profileChoices(deps);
    return [
      {
        id: FIELD_PROFILE,
        type: 'choice',
        label: deps.t('machines.param.profile'),
        help: deps.t('machines.param.profileHelp'),
        required: true,
        choices,
        default: choices[0]?.value,
      },
    ];
  }

  /**
   * The rows: every usable record, then every record the file kept but gEdit could not
   * read. A problem that names no record belongs to the file itself and is shown above the
   * list instead (`fileProblems`).
   */
  export function rowsOf(list: readonly MachineConfig[], deps: MachinesDeps): MachineRow[] {
    const problems = deps.machines.problems();
    const rows: MachineRow[] = list.map((machine) => ({
      id: machine.id,
      name: machine.name,
      profileId: machine.profile,
      profileName: deps.profiles.get(machine.profile)?.name ?? machine.profile,
      isDefault: deps.machines.defaultFor(machine.profile) === machine.id,
      problems: problems.filter((p) => p.machineId === machine.id).map((p) => problemText(deps, p)),
      usable: true,
    }));
    const known = new Set(rows.map((row) => row.id));
    for (const problem of problems) {
      const id = problem.machineId;
      if (id === null || known.has(id)) continue;
      const existing = rows.find((row) => row.id === id && !row.usable);
      if (existing) {
        existing.problems.push(problemText(deps, problem));
        continue;
      }
      rows.push({
        id,
        name: id,
        profileId: '',
        profileName: '',
        isDefault: false,
        problems: [problemText(deps, problem)],
        usable: false,
      });
    }
    return rows;
  }

  /** Problems of the file itself (a parse error, a version from the future). */
  export function fileProblems(deps: MachinesDeps): string[] {
    return deps.machines
      .problems()
      .filter((problem) => problem.machineId === null)
      .map((problem) => problemText(deps, problem));
  }

  /**
   * The code database the form's power-on codes come from: the one the **chosen** variant
   * names, exactly as `applyMachine` picks it. A system-B machine is offered `G94`/`G95`
   * as feed modes, a system-A machine `G98`/`G99` — offering both would let a machine
   * power up in a mode no code of its own database can produce.
   */
  export function codeDbFor(
    profileId: string,
    params: Partial<MachineParams> | undefined,
    deps: MachinesDeps,
  ): CodeDb {
    const profile = deps.profiles.profile(profileId);
    let dialect = typeof profile.codes === 'string' ? profile.codes : '';
    for (const variant of profile.machineParams?.variants ?? []) {
      const value = params?.variants?.[variant.id] ?? variant.default;
      const choice = (variant.choices ?? []).find((entry) => entry.value === value);
      if (typeof choice?.codes === 'string' && choice.codes !== '') dialect = choice.codes;
    }
    return deps.codes.byId(dialect);
  }

  /** The record a draft edits, or undefined while adding. */
  export function currentOf(draft: Draft, deps: MachinesDeps): MachineConfig | undefined {
    return draft.kind === 'edit' && draft.id !== null ? deps.machines.get(draft.id) : undefined;
  }

  /** The form of a draft, rebuilt from its own values, so a variant switch moves the fields. */
  export function fieldsFor(draft: Draft, deps: MachinesDeps): FieldSpec[] {
    const decl = deps.profiles.profile(draft.profileId).machineParams;
    if (decl === undefined) return [];
    const current = currentOf(draft, deps);
    if (draft.kind === 'duplicate') {
      return [
        {
          id: FIELD_NAME,
          type: 'text',
          label: deps.t('machines.param.name'),
          help: deps.t('machines.param.nameHelp'),
          required: true,
          default: '',
        },
      ];
    }
    const { params } = machineFromValues(decl, draft.values, current);
    return machineFields(decl, codeDbFor(draft.profileId, params, deps), current);
  }

  /** Every name in use, lower-cased, except the record itself. */
  export function takenNames(list: readonly MachineConfig[], selfId: string | null): Set<string> {
    return new Set(
      list.filter((machine) => machine.id !== selfId).map((machine) => machine.name.toLowerCase()),
    );
  }

  /** `validateFields`, plus the two rules a `FieldSpec` cannot carry (§7.15 name rules). */
  export function draftErrors(
    fields: readonly FieldSpec[],
    draft: Draft,
    list: readonly MachineConfig[],
  ): Record<string, Msg> {
    const errors = validateFields(fields as FieldSpec[], draft.values);
    const name = typeof draft.values[FIELD_NAME] === 'string' ? (draft.values[FIELD_NAME] as string).trim() : '';
    if (errors[FIELD_NAME] === undefined && name !== '') {
      if (name.length > 64) errors[FIELD_NAME] = { key: 'machines.page.nameLong' };
      else if (takenNames(list, draft.kind === 'edit' ? draft.id : null).has(name.toLowerCase())) {
        errors[FIELD_NAME] = { key: 'machines.page.nameTaken' };
      }
    }
    return errors;
  }

  /** The draft for "Add", once the dialect is known. */
  export function addDraft(profileId: string, deps: MachinesDeps): Draft {
    const values = initialValues(fieldsFor({ kind: 'add', id: null, profileId, values: {} }, deps));
    return { kind: 'add', id: null, profileId, values };
  }

  /** The draft for "Edit": the stored record, through the form's own defaults. */
  export function editDraft(machine: MachineConfig, deps: MachinesDeps): Draft {
    const draft: Draft = { kind: 'edit', id: machine.id, profileId: machine.profile, values: {} };
    return { ...draft, values: initialValues(fieldsFor(draft, deps)) };
  }

  /** The draft for "Duplicate": one field, the new name. */
  export function duplicateDraft(machine: MachineConfig, deps: MachinesDeps): Draft {
    return {
      kind: 'duplicate',
      id: machine.id,
      profileId: machine.profile,
      values: { [FIELD_NAME]: deps.t('machines.page.duplicateName', { name: machine.name }) },
    };
  }

  /** English detail for anything thrown across the IPC boundary. */
  function detailOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** True when the write went through; the page keeps the form open otherwise. */
  export async function submitDraft(draft: Draft, deps: MachinesDeps): Promise<boolean> {
    if (deps.machines.blocked()) {
      deps.status.show(deps.t('machines.page.blockedAction'), { error: true });
      return false;
    }
    const decl = deps.profiles.profile(draft.profileId).machineParams;
    if (decl === undefined) return false;
    try {
      if (draft.kind === 'duplicate' && draft.id !== null) {
        const name = String(draft.values[FIELD_NAME] ?? '').trim();
        await deps.machines.duplicate(draft.id, name);
        deps.status.show(deps.t('machines.page.duplicated', { name }));
        return true;
      }
      const built = machineFromValues(decl, draft.values, currentOf(draft, deps));
      if (draft.kind === 'add') {
        await deps.machines.add({
          name: built.name,
          profile: draft.profileId,
          params: built.params,
          notes: built.notes,
        });
        deps.status.show(deps.t('machines.page.added', { name: built.name }));
        return true;
      }
      if (draft.kind === 'edit' && draft.id !== null) {
        await deps.machines.update(draft.id, {
          name: built.name,
          params: built.params,
          notes: built.notes,
        });
        deps.status.show(deps.t('machines.page.updated', { name: built.name }));
        return true;
      }
      // A draft that names no record and is not an "add" would write nothing; saying so is
      // better than reporting a save that never happened.
      return false;
    } catch (err) {
      deps.status.show(deps.t('machines.page.saveFailed'), { error: true, detail: detailOf(err) });
      return false;
    }
  }

  /** Open documents that use this machine; they fall back when it goes (AD-31). */
  export function usersOf(id: string, deps: MachinesDeps): number {
    return deps.docs.all().filter((doc) => doc.machineId === id).length;
  }

  export async function removeRow(row: MachineRow, deps: MachinesDeps): Promise<boolean> {
    if (deps.machines.blocked()) {
      deps.status.show(deps.t('machines.page.blockedAction'), { error: true });
      return false;
    }
    const count = usersOf(row.id, deps);
    const confirmed = await deps.dialogs.confirm({
      title:
        count > 0
          ? deps.t('machines.page.removeInUse', { name: row.name, count })
          : deps.t('machines.page.removeTitle', { name: row.name }),
      message: deps.t('machines.page.removeMessage'),
      ok: deps.t('machines.page.remove'),
      kind: 'warning',
    });
    if (!confirmed) return false;
    try {
      await deps.machines.remove(row.id);
    } catch (err) {
      deps.status.show(deps.t('machines.page.saveFailed'), { error: true, detail: detailOf(err) });
      return false;
    }
    deps.status.show(deps.t('machines.page.removed', { name: row.name }));
    return true;
  }

  /** "Default for its dialect", and the same button again to take it away. */
  export async function toggleDefault(row: MachineRow, deps: MachinesDeps): Promise<void> {
    if (deps.machines.blocked()) {
      deps.status.show(deps.t('machines.page.blockedAction'), { error: true });
      return;
    }
    try {
      await deps.machines.setDefault(row.profileId, row.isDefault ? null : row.id);
    } catch (err) {
      deps.status.show(deps.t('machines.page.saveFailed'), { error: true, detail: detailOf(err) });
      return;
    }
    deps.status.show(
      row.isDefault
        ? deps.t('machines.page.defaultCleared', { profile: row.profileName })
        : deps.t('machines.page.defaultSet', { name: row.name, profile: row.profileName }),
    );
  }

  export async function openMachinesFile(deps: MachinesDeps): Promise<void> {
    try {
      await deps.machines.openFile();
    } catch (err) {
      deps.status.show(deps.t('machines.openFileFailed'), { error: true, detail: detailOf(err) });
    }
  }

  /** The one path that moves an unusable file aside (AD-31 Management). */
  export async function replaceMachinesFile(deps: MachinesDeps): Promise<boolean> {
    const confirmed = await deps.dialogs.confirm({
      title: deps.t('machines.page.replaceTitle'),
      message: deps.t('machines.page.replaceMessage'),
      ok: deps.t('machines.page.replaceFile'),
      kind: 'warning',
    });
    if (!confirmed) return false;
    try {
      await deps.machines.replaceWithEmpty();
    } catch (err) {
      deps.status.show(deps.t('machines.page.saveFailed'), { error: true, detail: detailOf(err) });
      return false;
    }
    deps.status.show(deps.t('machines.page.replaced'));
    return true;
  }
</script>

<script lang="ts">
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { dialogs } from '$lib/app/dialogs';
  import { status } from '$lib/app/status';
  import { docs } from '$lib/stores/documents';
  import { codes } from '$lib/stores/codes';
  import { machines } from '$lib/stores/machines';
  import { profiles } from '$lib/stores/profiles';
  import { t } from '$lib/i18n';

  const deps: MachinesDeps = { machines, profiles, codes, docs, dialogs, status, t };

  const list = machines.list;
  const revision = machines.revision;

  /** Re-read the service's answers whenever the set or a document's choice changed. */
  const view = $derived.by(() => {
    void $revision;
    return {
      rows: rowsOf($list, deps),
      problems: fileProblems(deps),
      blocked: machines.blocked(),
    };
  });

  /** null while the list is shown; a dialect id while Add asks which dialect. */
  let profileStep = $state<Record<string, unknown> | null>(null);
  let draft = $state<Draft | null>(null);
  let busy = $state(false);
  let form = $state<HTMLElement | undefined>(undefined);

  const profileFields = $derived(profileField(deps));
  const fields = $derived(draft ? fieldsFor(draft, deps) : []);
  const errors = $derived(draft ? draftErrors(fields, draft, $list) : {});
  const blockedSave = $derived(Object.keys(errors).length > 0 || busy);

  const title = $derived.by(() => {
    if (!draft) return '';
    if (draft.kind === 'add') return t('machines.page.addTitle');
    const name = draft.id !== null ? (machines.get(draft.id)?.name ?? draft.id) : '';
    return draft.kind === 'duplicate'
      ? t('machines.page.duplicateTitle', { name })
      : t('machines.page.editTitle', { name });
  });

  function startAdd(): void {
    if (view.blocked) return;
    const choices = profileChoices(deps);
    if (choices.length === 0) {
      status.show(t('machines.page.noProfiles'));
      return;
    }
    profileStep = { [FIELD_PROFILE]: choices[0].value };
  }

  function continueAdd(): void {
    const profileId = String(profileStep?.[FIELD_PROFILE] ?? '');
    if (profileId === '') return;
    profileStep = null;
    draft = addDraft(profileId, deps);
  }

  function startEdit(row: MachineRow): void {
    const machine = machines.get(row.id);
    if (!machine || view.blocked) return;
    draft = editDraft(machine, deps);
  }

  function startDuplicate(row: MachineRow): void {
    const machine = machines.get(row.id);
    if (!machine || view.blocked) return;
    draft = duplicateDraft(machine, deps);
  }

  /**
   * A variant switch rebuilds the form, so a power-on code the newly chosen database does
   * not have is taken away — with a message naming it, never in silence.
   */
  function set(id: string, value: unknown): void {
    if (!draft) return;
    const values = { ...draft.values, [id]: value };
    if (variantIdOf(id) !== null) {
      const dropped = pruneModalValues(values, fieldsFor({ ...draft, values }, deps));
      if (dropped.length > 0) status.show(t('machines.page.modalDropped', { codes: dropped.join(', ') }));
    }
    draft = { ...draft, values };
  }

  function cancel(): void {
    draft = null;
    profileStep = null;
  }

  async function save(): Promise<void> {
    if (!draft || blockedSave) return;
    busy = true;
    const ok = await submitDraft(draft, deps);
    busy = false;
    if (ok) draft = null;
  }

  /**
   * Enter and Esc belong to the form while it is open.
   *
   * The settings dialog's own frame confirms on Enter and cancels on Esc, and it would
   * save the settings and close with a half-filled machine in front of the user. The
   * listener is attached by hand, as `Modal` attaches its own: a key handler written on a
   * plain element would trip the a11y check for a non-interactive element.
   */
  $effect(() => {
    const el = form;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== 'Enter' || e.isComposing) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (profileStep) continueAdd();
      else void save();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  });

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }
</script>

<div class="machines" data-testid="settings-machines">
  {#if view.blocked}
    <p class="notice" data-testid="machines-notice">{t('machines.page.blocked')}</p>
  {/if}
  {#each view.problems as problem (problem)}
    <p class="notice" data-testid="machines-notice">{problem}</p>
  {/each}

  {#if profileStep}
    <!-- Add, step one: which dialect. The parameter form then always matches it (§7.15). -->
    <div class="form" bind:this={form} data-testid="machine-form" data-step="profile">
      <h3 class="form-title">{t('machines.page.addProfileTitle')}</h3>
      <FormRenderer
        fields={profileFields}
        values={profileStep}
        onChange={(id, value) => (profileStep = { ...profileStep, [id]: value })}
      />
      <div class="actions">
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="next"
          onclick={continueAdd}>{t('machines.page.next')}</button
        >
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="cancel"
          onclick={cancel}>{t('machines.page.cancel')}</button
        >
      </div>
    </div>
  {:else if draft}
    <div
      class="form"
      bind:this={form}
      data-testid="machine-form"
      data-step="params"
      data-kind={draft.kind}
    >
      <h3 class="form-title">{title}</h3>
      <FormRenderer {fields} values={draft.values} {errors} onChange={set} />
      <div class="actions">
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="save"
          data-disabled={blockedSave ? '1' : '0'}
          disabled={blockedSave}
          onclick={() => void save()}>{t('machines.page.save')}</button
        >
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="cancel"
          onclick={cancel}>{t('machines.page.cancel')}</button
        >
      </div>
    </div>
  {:else}
    {#if view.rows.length === 0}
      <p class="form-help">{t('machines.page.empty')}</p>
    {:else}
      <ul class="list">
        {#each view.rows as row (row.id)}
          <li
            class="row"
            class:broken={!row.usable}
            data-testid="machine-row"
            data-machine-id={row.id}
            data-profile-id={row.profileId}
            data-default={row.isDefault ? '1' : '0'}
            data-problems={row.problems.length}
          >
            <span class="name">{row.name}</span>
            <span class="profile">{row.profileName}</span>
            {#if row.isDefault}<span class="badge">{t('machines.page.defaultMark')}</span>{/if}
            <span class="row-actions">
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="edit"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => startEdit(row)}>{t('machines.page.edit')}</button
              >
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="duplicate"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => startDuplicate(row)}>{t('machines.page.duplicate')}</button
              >
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="default"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => void run(() => toggleDefault(row, deps))}
                >{row.isDefault ? t('machines.page.defaultClear') : t('machines.page.default')}</button
              >
              <button
                type="button"
                class="action"
                data-testid="machine-action"
                data-action="remove"
                data-disabled={view.blocked || !row.usable ? '1' : '0'}
                disabled={view.blocked || !row.usable}
                onclick={() => void run(() => removeRow(row, deps))}>{t('machines.page.remove')}</button
              >
            </span>
            {#if row.problems.length > 0}
              <ul class="problems">
                {#each row.problems as problem (problem)}
                  <li class="problem">{problem}</li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="actions">
      <button
        type="button"
        class="action"
        data-testid="machine-action"
        data-action="add"
        data-disabled={view.blocked ? '1' : '0'}
        disabled={view.blocked}
        onclick={startAdd}>{t('machines.page.add')}</button
      >
      <button
        type="button"
        class="action"
        data-testid="machine-action"
        data-action="open-file"
        data-disabled="0"
        onclick={() => void run(() => openMachinesFile(deps))}>{t('machines.page.openFile')}</button
      >
      {#if view.blocked}
        <button
          type="button"
          class="action"
          data-testid="machine-action"
          data-action="replace-file"
          data-disabled="0"
          onclick={() => void run(() => replaceMachinesFile(deps))}
          >{t('machines.page.replaceFile')}</button
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .machines {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .notice {
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--danger-text);
    font-size: 12px;
  }

  .form-help {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .form-title {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 4px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }

  .row.broken {
    border-color: var(--danger-text);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-main);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .profile {
    color: var(--text-muted);
    font-size: 12px;
  }

  .badge {
    padding: 0 5px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .row-actions,
  .actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    align-items: center;
  }

  .problems {
    flex: 1 1 100%;
    margin: 0;
    padding: 0 0 0 14px;
    color: var(--danger-text);
    font-size: 12px;
  }

  .problem {
    margin: 0;
  }

  .action {
    padding: 3px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }

  .action:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .action:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
