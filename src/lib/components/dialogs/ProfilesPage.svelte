<!--
  Settings ▸ Profiles (plan §6 M13 WP13.3, AD-29, §7.12). Owner: WP13.3.

  The list of the dialects gEdit knows and of the files you made yourself: where each came
  from, what it extends, which file it is in and what is wrong with it. Beside the list, the
  buttons of the commands (`profile.newFrom`, `.open`, `.import`, `.export`, `.reload`,
  `.testOnDocument`), so the page and the palette do exactly the same thing.

  Rules this page keeps:

   1. **Every action is a command.** The page decides nothing about files: it runs the
      command with all its arguments filled in. (A modal cannot open over this dialog, so a
      command called from here must never need to ask; the New form below is the page's own.)
   2. **A broken file is a row, not a missing one.** A user file that could not be read or
      did not load is listed with its reason, so the user knows why a profile is not offered.
   3. **Removing asks first**, and only your own files can be removed.
   4. **Names are the user's data** and stay untranslated.
   5. **Notes are not problems.** A problem with `severity: 'info'` (a code entry that changes
      what a built-in code means) is listed under its file as a note and does not mark the row
      broken or count in `data-problems`.
   6. **A list is bounded.** A row lists at most [`MAX_ROW_LINES`] problems and as many notes,
      then says how many more there are.
-->
<script module lang="ts">
  import { displayName, nameProblem, parentChoices, stemOf } from '$lib/contrib/userConfig';
  import { validateFields } from '$lib/core/forms/validate';
  import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
  import type { ProfileProblem } from '$lib/core/profiles/types';
  import type { UserFileKind } from '$lib/platform/commands';
  import type {
    Msg,
    NativeDialogs,
    ProfileInfo,
    StatusService,
    Translate,
    UserConfigService,
    UserFileEntry,
  } from '$lib/app/types';

  /** What the page needs from the outside world, so every action is testable with a fake. */
  export interface ProfilesDeps {
    /** Runs a command by id with an argument (`commands.run`). */
    run(id: string, arg?: unknown): Promise<boolean>;
    /** `user_file_delete`. */
    deleteFile(kind: UserFileKind, name: string): Promise<void>;
    userConfig: Pick<UserConfigService, 'load'>;
    dialogs: Pick<NativeDialogs, 'confirm'>;
    status: Pick<StatusService, 'show'>;
    t: Translate;
    /** Whether the file is in its folder now; `createFile` keeps the form when it is not. Unset: believe `run`. */
    exists?(kind: UserFileKind, name: string): boolean;
  }

  /** The most problems, and the most notes, one row lists. */
  export const MAX_ROW_LINES = 50;

  /** One row of the list. */
  export interface ProfileRow {
    /** Unique within the list. */
    key: string;
    kind: 'profile' | 'codes';
    /** The profile id (or the code set's id); the file's name without `.json` for a file that did not load. */
    id: string;
    name: string;
    origin: 'builtin' | 'user';
    /** What it extends; null for a built-in root or where the file is not read here. */
    parent: string | null;
    /** The file name; null for a built-in. */
    file: string | null;
    /** Already formatted, one per problem. */
    problems: string[];
    /** Already formatted, one per note (`severity: 'info'`). */
    notices: string[];
    /** The profile is loaded and can be tested. */
    loaded: boolean;
  }

  const folderKind = (kind: ProfileRow['kind']): UserFileKind => (kind === 'profile' ? 'profiles' : 'codes');

  function problemText(problem: ProfileProblem, t: Translate): string {
    return problem.path === '' ? problem.message : t('userConfig.page.problem', { path: problem.path, message: problem.message });
  }

  const isNote = (problem: ProfileProblem): boolean => problem.severity === 'info';

  /** The first [`MAX_ROW_LINES`] lines and a last one that counts the rest. */
  function bounded(lines: string[], t: Translate): string[] {
    if (lines.length <= MAX_ROW_LINES) return lines;
    return [...lines.slice(0, MAX_ROW_LINES), t('userConfig.load.more', { count: lines.length - MAX_ROW_LINES })];
  }

  /** The problems and the notes of one file, formatted and bounded. */
  function linesOf(
    entryError: string | null,
    own: readonly ProfileProblem[],
    t: Translate,
  ): { problems: string[]; notices: string[] } {
    return {
      problems: bounded(
        [...(entryError === null ? [] : [entryError]), ...own.filter((p) => !isNote(p)).map((p) => problemText(p, t))],
        t,
      ),
      notices: bounded(own.filter(isNote).map((p) => problemText(p, t)), t),
    };
  }

  /**
   * The rows: your profile files, your code files, then the built-in profiles.
   *
   * A problem belongs to the row of its file in its own folder (`problem.kind`): a profile
   * file and a code file of one name never show each other's problems. A code problem that
   * names no file (a built-in database that fails after a user overlay) names its dialect,
   * the file's name without `.json`. A file whose profile did not load has no `ProfileInfo`
   * and is still a row.
   */
  export function rowsOf(
    infos: readonly ProfileInfo[],
    fileList: readonly UserFileEntry[],
    problems: readonly ProfileProblem[],
    t: Translate,
    nameOf: (info: ProfileInfo) => string = (info) => info.name,
  ): ProfileRow[] {
    const rows: ProfileRow[] = [];
    for (const entry of fileList.filter((e) => e.kind === 'profiles')) {
      const info = infos.find((i) => i.origin === 'user' && i.file === entry.name);
      rows.push({
        key: `profiles/${entry.name}`,
        kind: 'profile',
        id: info?.id ?? entry.name.replace(/\.json$/, ''),
        name: info === undefined ? entry.name : nameOf(info),
        origin: 'user',
        parent: info?.parent ?? null,
        file: entry.name,
        ...linesOf(
          entry.error,
          problems.filter((p) => p.origin === 'user' && p.kind === 'profiles' && p.file === entry.name),
          t,
        ),
        loaded: info !== undefined,
      });
    }
    for (const entry of fileList.filter((e) => e.kind === 'codes')) {
      const stem = entry.name.replace(/\.json$/, '');
      rows.push({
        key: `codes/${entry.name}`,
        kind: 'codes',
        id: stem,
        name: entry.name,
        origin: 'user',
        parent: null,
        file: entry.name,
        ...linesOf(
          entry.error,
          problems.filter((p) => p.origin === 'user' && p.kind === 'codes' && (p.file === null ? p.profileId === stem : p.file === entry.name)),
          t,
        ),
        loaded: entry.error === null,
      });
    }
    for (const info of infos.filter((i) => i.origin === 'builtin')) {
      rows.push({
        key: `builtin/${info.id}`,
        kind: 'profile',
        id: info.id,
        name: nameOf(info),
        origin: 'builtin',
        parent: info.parent,
        file: null,
        problems: [],
        notices: [],
        loaded: true,
      });
    }
    return rows;
  }

  /**
   * Problems that name no file of the list (a folder that could not be read), shown above it;
   * `notes` picks the notes instead of the problems.
   */
  export function looseProblems(
    fileList: readonly UserFileEntry[],
    problems: readonly ProfileProblem[],
    t: Translate,
    notes = false,
  ): string[] {
    const names = (kind: UserFileKind): Set<string> => new Set(fileList.filter((e) => e.kind === kind).map((e) => e.name));
    const profileNames = names('profiles');
    const codeNames = names('codes');
    const stems = new Set([...codeNames].map((name) => name.replace(/\.json$/, '')));
    const shown = (p: ProfileProblem): boolean => {
      if (p.kind === 'profiles') return p.file !== null && profileNames.has(p.file);
      if (p.kind === 'codes') return p.file === null ? p.profileId !== null && stems.has(p.profileId) : codeNames.has(p.file);
      return false;
    };
    return bounded(
      problems.filter((p) => p.origin === 'user' && !shown(p) && isNote(p) === notes).map((p) => problemText(p, t)),
      t,
    );
  }

  export const FIELD_PARENT = 'parent';
  export const FIELD_NAME = 'name';

  /** A form for a new file: which one to start from, and what to call it. */
  export interface NewDraft {
    kind: UserFileKind;
    values: Record<string, unknown>;
  }

  /** The draft for "New…", with `parent` preselected where the row it comes from says. */
  export function newDraft(kind: UserFileKind, parent?: string): NewDraft {
    const choices = parentChoices(kind);
    const first = parent !== undefined && choices.some((c) => c.value === parent) ? parent : (choices[0]?.value ?? '');
    return { kind, values: { [FIELD_PARENT]: first, [FIELD_NAME]: kind === 'codes' ? first : `my-${first}` } };
  }

  export function newFields(draft: NewDraft, t: Translate): FieldSpec[] {
    const choices: FieldChoice[] = parentChoices(draft.kind).map((c) => ({
      // Names are data; the id disambiguates two profiles with one name.
      label: c.description === undefined ? c.label : `${c.label} (${c.description})`,
      value: c.value,
    }));
    return [
      {
        id: FIELD_PARENT,
        type: 'choice',
        label: t(draft.kind === 'profiles' ? 'userConfig.page.parentProfile' : 'userConfig.page.parentCodes'),
        help: t(draft.kind === 'profiles' ? 'userConfig.page.parentProfileHelp' : 'userConfig.page.parentCodesHelp'),
        required: true,
        choices,
        default: choices[0]?.value,
      },
      {
        id: FIELD_NAME,
        type: 'text',
        label: t('userConfig.page.fileName'),
        help: t(draft.kind === 'profiles' ? 'userConfig.page.fileNameHelp' : 'userConfig.page.fileNameHelpCodes'),
        required: true,
        default: '',
      },
    ];
  }

  export function newErrors(draft: NewDraft, fields: FieldSpec[]): Record<string, Msg> {
    const errors = validateFields(fields, draft.values);
    const typed = typeof draft.values[FIELD_NAME] === 'string' ? (draft.values[FIELD_NAME] as string) : '';
    if (errors[FIELD_NAME] === undefined && typed.trim() !== '') {
      const problem = nameProblem(draft.kind, String(draft.values[FIELD_PARENT] ?? ''), stemOf(typed));
      if (problem !== null) errors[FIELD_NAME] = problem;
    }
    return errors;
  }

  /**
   * "Create": the command with everything filled in. True when the file is there afterwards;
   * false when the command failed or the file was not made, and the form keeps what was typed.
   */
  export async function createFile(draft: NewDraft, deps: ProfilesDeps): Promise<boolean> {
    const name = String(draft.values[FIELD_NAME] ?? '');
    const ran = await deps.run('profile.newFrom', {
      kind: draft.kind,
      parent: String(draft.values[FIELD_PARENT] ?? ''),
      name,
    });
    return ran && (deps.exists?.(draft.kind, `${stemOf(name)}.json`) ?? true);
  }

  /** English detail for anything thrown across the IPC boundary. */
  function detailOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** Asks, removes the file from its folder and reads the folders again. True when it is gone. */
  export async function removeRow(row: ProfileRow, deps: ProfilesDeps): Promise<boolean> {
    if (row.file === null) return false;
    const confirmed = await deps.dialogs.confirm({
      title: deps.t('userConfig.page.removeTitle', { name: row.file }),
      message: deps.t(row.kind === 'profile' ? 'userConfig.page.removeMessageProfile' : 'userConfig.page.removeMessageCodes'),
      ok: deps.t('userConfig.page.remove'),
      kind: 'warning',
    });
    if (!confirmed) return false;
    try {
      await deps.deleteFile(folderKind(row.kind), row.file);
      await deps.userConfig.load();
    } catch (err) {
      deps.status.show(deps.t('userConfig.page.removeFailed', { name: row.file }), { error: true, detail: detailOf(err) });
      return false;
    }
    deps.status.show(deps.t('userConfig.page.removed', { name: row.file }));
    return true;
  }

  /** The command a row's button runs, and what it is told. */
  export function rowCommand(action: 'open' | 'export' | 'test', row: ProfileRow): { id: string; arg: Record<string, unknown> } {
    if (action === 'test') return { id: 'profile.testOnDocument', arg: { profileId: row.id } };
    return { id: action === 'open' ? 'profile.open' : 'profile.export', arg: { kind: folderKind(row.kind), name: row.file } };
  }
</script>

<script lang="ts">
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { get } from 'svelte/store';
  import { commands } from '$lib/app/registry/commands';
  import { dialogs } from '$lib/app/dialogs';
  import { status } from '$lib/app/status';
  import { userConfig } from '$lib/app/userConfig';
  import { userFileDelete } from '$lib/platform/commands';
  import { profiles } from '$lib/stores/profiles';
  import { t } from '$lib/i18n';

  const deps: ProfilesDeps = {
    run: (id, arg) => commands.run(id, arg),
    deleteFile: userFileDelete,
    userConfig,
    dialogs,
    status,
    t,
    exists: (kind, name) => get(userConfig.files).some((entry) => entry.kind === kind && entry.name === name),
  };

  const revision = profiles.revision;
  const fileStore = userConfig.files;
  const problemStore = userConfig.problems;

  /** Re-read whenever the registry reloaded, a folder listing changed or a problem was found. */
  const view = $derived.by(() => {
    void $revision;
    const fileList = $fileStore;
    const problems = $problemStore;
    const rows = rowsOf(profiles.list(), fileList, problems, t, displayName);
    return {
      yourProfiles: rows.filter((row) => row.origin === 'user' && row.kind === 'profile'),
      yourCodes: rows.filter((row) => row.kind === 'codes'),
      builtin: rows.filter((row) => row.origin === 'builtin'),
      loose: looseProblems(fileList, problems, t),
      looseNotes: looseProblems(fileList, problems, t, true),
    };
  });

  let draft = $state<NewDraft | null>(null);
  let busy = $state(false);

  const fields = $derived(draft ? newFields(draft, t) : []);
  const errors = $derived(draft ? newErrors(draft, fields) : {});
  const blockedSave = $derived(Object.keys(errors).length > 0 || busy);

  function startNew(kind: UserFileKind, parent?: string): void {
    draft = newDraft(kind, parent);
  }

  function set(id: string, value: unknown): void {
    if (!draft) return;
    const values = { ...draft.values, [id]: value };
    // A new parent suggests a new name, until the user has typed one of their own.
    if (id === FIELD_PARENT) {
      const previous = String(draft.values[FIELD_PARENT] ?? '');
      const suggested = (parent: string): string => (draft?.kind === 'codes' ? parent : `my-${parent}`);
      if (draft.values[FIELD_NAME] === suggested(previous)) values[FIELD_NAME] = suggested(String(value));
    }
    draft = { ...draft, values };
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
    } finally {
      busy = false;
    }
  }

  async function create(): Promise<void> {
    if (!draft || blockedSave) return;
    const current = draft;
    let made = false;
    await run(async () => {
      made = await createFile(current, deps);
    });
    // A refused create (the name was taken meanwhile) keeps the form, with what was typed.
    if (made) draft = null;
  }

  function rowAction(action: 'open' | 'export' | 'test', row: ProfileRow): void {
    const command = rowCommand(action, row);
    void run(() => deps.run(command.id, command.arg));
  }

  /** Enter creates and Esc leaves the form, instead of saving and closing the whole dialog. */
  let form = $state<HTMLElement | undefined>(undefined);
  $effect(() => {
    const el = form;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        draft = null;
        return;
      }
      if (e.key !== 'Enter' || e.isComposing) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void create();
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  });
</script>

{#snippet rowView(row: ProfileRow)}
  <li
    class="row"
    class:broken={row.problems.length > 0}
    data-testid="profile-row"
    data-profile-id={row.id}
    data-origin={row.origin}
    data-problems={row.problems.length}
    data-notices={row.notices.length}
    data-kind={row.kind}
    data-file={row.file ?? ''}
  >
    <span class="name">{row.name}</span>
    <span class="meta">{t(row.origin === 'user' ? 'userConfig.origin.user' : 'userConfig.origin.builtin')}</span>
    {#if row.parent !== null}<span class="meta">{t('userConfig.page.extends', { parent: row.parent })}</span>{/if}
    {#if row.file !== null}<span class="meta file">{row.file}</span>{/if}
    <span class="row-actions">
      {#if row.kind === 'profile'}
        <button
          type="button"
          class="action"
          data-testid="profile-action"
          data-action="test"
          data-disabled={row.loaded ? '0' : '1'}
          disabled={!row.loaded}
          onclick={() => rowAction('test', row)}>{t('userConfig.page.test')}</button
        >
      {/if}
      {#if row.origin === 'builtin'}
        <button
          type="button"
          class="action"
          data-testid="profile-action"
          data-action="new"
          data-kind="profiles"
          data-disabled="0"
          onclick={() => startNew('profiles', row.id)}>{t('userConfig.page.newFromThis')}</button
        >
      {:else}
        <button
          type="button"
          class="action"
          data-testid="profile-action"
          data-action="open"
          data-disabled="0"
          onclick={() => rowAction('open', row)}>{t('userConfig.page.open')}</button
        >
        <button
          type="button"
          class="action"
          data-testid="profile-action"
          data-action="export"
          data-disabled="0"
          onclick={() => rowAction('export', row)}>{t('userConfig.page.export')}</button
        >
        <button
          type="button"
          class="action"
          data-testid="profile-action"
          data-action="remove"
          data-disabled="0"
          onclick={() => void run(() => removeRow(row, deps))}>{t('userConfig.page.remove')}</button
        >
      {/if}
    </span>
    {#if row.problems.length > 0}
      <ul class="problems">
        {#each row.problems as problem, k (k)}
          <li class="problem">{problem}</li>
        {/each}
      </ul>
    {/if}
    {#if row.notices.length > 0}
      <ul class="notes" data-testid="profile-notes">
        {#each row.notices as note, k (k)}
          <li class="note">{t('userConfig.page.note', { message: note })}</li>
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="profiles" data-testid="settings-profiles">
  <p class="form-help">{t('userConfig.page.intro')}</p>
  {#each view.loose as problem, k (k)}
    <p class="notice" data-testid="profiles-notice">{problem}</p>
  {/each}
  {#each view.looseNotes as note, k (k)}
    <p class="note-line" data-testid="profiles-note">{t('userConfig.page.note', { message: note })}</p>
  {/each}

  {#if draft}
    <div class="form" bind:this={form} data-testid="profile-form" data-kind={draft.kind}>
      <h3 class="form-title">{t(draft.kind === 'profiles' ? 'userConfig.page.newProfileTitle' : 'userConfig.page.newCodesTitle')}</h3>
      <FormRenderer {fields} values={draft.values} {errors} onChange={set} />
      <div class="actions">
        <button
          type="button"
          class="action"
          data-testid="profile-action"
          data-action="create"
          data-disabled={blockedSave ? '1' : '0'}
          disabled={blockedSave}
          onclick={() => void create()}>{t('userConfig.page.create')}</button
        >
        <button
          type="button"
          class="action"
          data-testid="profile-action"
          data-action="cancel"
          onclick={() => (draft = null)}>{t('userConfig.page.cancel')}</button
        >
      </div>
    </div>
  {:else}
    <div class="actions">
      <button
        type="button"
        class="action"
        data-testid="profile-action"
        data-action="reload"
        data-disabled="0"
        onclick={() => void run(() => deps.run('profile.reload'))}>{t('userConfig.page.reload')}</button
      >
    </div>

    <h3 class="section">{t('userConfig.page.yourProfiles')}</h3>
    {#if view.yourProfiles.length === 0}
      <p class="form-help">{t('userConfig.page.noProfiles')}</p>
    {:else}
      <ul class="list">
        {#each view.yourProfiles as row (row.key)}{@render rowView(row)}{/each}
      </ul>
    {/if}
    <div class="actions">
      <button
        type="button"
        class="action"
        data-testid="profile-action"
        data-action="new"
        data-kind="profiles"
        data-disabled="0"
        onclick={() => startNew('profiles')}>{t('userConfig.page.newProfile')}</button
      >
      <button
        type="button"
        class="action"
        data-testid="profile-action"
        data-action="import"
        data-kind="profiles"
        data-disabled="0"
        onclick={() => void run(() => deps.run('profile.import', { kind: 'profiles' }))}>{t('userConfig.page.importProfile')}</button
      >
    </div>

    <h3 class="section">{t('userConfig.page.yourCodes')}</h3>
    {#if view.yourCodes.length === 0}
      <p class="form-help">{t('userConfig.page.noCodes')}</p>
    {:else}
      <ul class="list">
        {#each view.yourCodes as row (row.key)}{@render rowView(row)}{/each}
      </ul>
    {/if}
    <div class="actions">
      <button
        type="button"
        class="action"
        data-testid="profile-action"
        data-action="new"
        data-kind="codes"
        data-disabled="0"
        onclick={() => startNew('codes')}>{t('userConfig.page.newCodes')}</button
      >
      <button
        type="button"
        class="action"
        data-testid="profile-action"
        data-action="import"
        data-kind="codes"
        data-disabled="0"
        onclick={() => void run(() => deps.run('profile.import', { kind: 'codes' }))}>{t('userConfig.page.importCodes')}</button
      >
    </div>

    <h3 class="section">{t('userConfig.page.builtin')}</h3>
    <ul class="list">
      {#each view.builtin as row (row.key)}{@render rowView(row)}{/each}
    </ul>
  {/if}
</div>

<style>
  .profiles {
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

  .form-title,
  .section {
    margin: 4px 0 0;
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

  .meta {
    color: var(--text-muted);
    font-size: 12px;
  }

  .file {
    font-family: var(--font-mono, monospace);
  }

  .row-actions,
  .actions {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
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

  .problem,
  .note {
    margin: 0;
  }

  .notes {
    flex: 1 1 100%;
    margin: 0;
    padding: 0 0 0 14px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .note-line {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
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
