<!--
  The settings dialog (plan §5 WP2.7, §7.7). Owner: WP2.7.

  Five pages - Appearance, Editor, Assistance, Files, Scripts - built from
  `SETTING_FIELDS` and drawn by `FormRenderer`, so a new setting needs one row in
  `core/settings/schema.ts` plus its three i18n keys and nothing here.

  What this dialog adds on top of `FormRenderer`:
    - `SETTING_FIELDS` carries i18n **keys** (it is a static table); `specOf` resolves the
      label, the help text and the choice labels through `t()` before a `FieldSpec` is
      built (AD-14).
    - `files.defaultProfile` has no choices of its own: they are the profile registry's,
      and profile names are data and stay untranslated.
    - `scripts.folders` is a list, and §7.5 has no list field type, so it is left out of
      the `FieldSpec[]` and rendered by the control below - handing an array to a `folder`
      field would only produce `forms.errors.invalid` (WP2.2 §6).

  Opened by `settings.open` through `modals.open`, so ModalHost renders it inside the
  `Modal` frame (which is where `data-testid="modal"` comes from) and it is never mounted
  directly.

  Save writes a patch of the values that actually changed; the store turns that into a
  file holding only the non-default values. "Reset category" is the store's `reset()` and
  therefore hits the file immediately, which the confirmation says.
-->
<script module lang="ts">
  import {
    DEFAULTS,
    SETTING_FIELDS,
    type SettingCategory,
    type SettingFieldMeta,
    type Settings,
  } from '$lib/core/settings/schema';
  import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
  import type { Translate } from '$lib/app/types';

  /** The pages, in the order §7.7 lists them. */
  export const CATEGORY_ORDER: readonly SettingCategory[] = [
    'appearance',
    'editor',
    'assistance',
    'files',
    'scripts',
  ];

  /**
   * Keys whose value is a list. `FieldType` has none, so these are rendered by this
   * dialog's own add-and-remove control and never reach `FormRenderer` or
   * `validateFields`.
   */
  export const LIST_KEYS: readonly string[] = ['scripts.folders'];

  export function isListKey(key: string): boolean {
    return LIST_KEYS.includes(key);
  }

  /** One page of the dialog. */
  export interface SettingsPage {
    category: SettingCategory;
    /** Every row of that category with `dialog: true`, in table order. */
    metas: SettingFieldMeta[];
  }

  /**
   * The Machines page (M6, AD-31). It is **not** a settings category: machine
   * configurations are records in `machines.json`, not keys in `settings.json` (D50), and
   * `pagesOf` only builds pages from `SETTING_FIELDS` (F47). So it is a tab of its own,
   * after the schema pages, and the page component owns everything inside it.
   */
  // Typed with its own literal so an importer keeps it (svelte2tsx widens a plain `const`
  // export to `string`, and `machines.manage` passes it as a `DialogTab`).
  export const MACHINES_TAB: 'machines' = 'machines';

  /** A tab of the dialog: a settings category, or the Machines page. */
  export type DialogTab = SettingCategory | typeof MACHINES_TAB;

  /** The tabs, in order: the schema pages, then Machines. */
  export function tabsOf(pages: readonly SettingsPage[]): DialogTab[] {
    return [...pages.map((page) => page.category), MACHINES_TAB];
  }

  /** The pages that have something to show, in `CATEGORY_ORDER`. */
  export function pagesOf(metas: readonly SettingFieldMeta[] = SETTING_FIELDS): SettingsPage[] {
    return CATEGORY_ORDER.map((category) => ({
      category,
      metas: metas.filter((meta) => meta.dialog && meta.category === category),
    })).filter((page) => page.metas.length > 0);
  }

  /** What `specOf` needs from the outside world, so it stays pure and testable. */
  export interface SpecDeps {
    translate: Translate;
    /** `t()` answers with the key itself when there is no message; this keeps that off the screen. */
    hasKey: (key: string) => boolean;
    /** Options for a field whose choices are data rather than schema (`files.defaultProfile`). */
    choicesFor?: (key: keyof Settings) => FieldChoice[] | undefined;
  }

  /** `t(key)`, or nothing when the namespace has no message for it. */
  function message(key: string | undefined, deps: SpecDeps): string | undefined {
    if (key === undefined) return undefined;
    return deps.hasKey(key) ? deps.translate(key) : undefined;
  }

  /**
   * The `FieldSpec` for one row: `field` with its i18n keys resolved. `field.id` is the
   * setting key, so the values record of the form **is** a settings patch.
   */
  export function specOf(meta: SettingFieldMeta, deps: SpecDeps): FieldSpec {
    const spec: FieldSpec = {
      ...meta.field,
      id: meta.key,
      label: message(meta.labelKey, deps) ?? meta.key,
    };
    const help = message(meta.helpKey, deps);
    if (help !== undefined) spec.help = help;
    const own = meta.field.choices ?? [];
    if (own.length > 0) {
      spec.choices = own.map((choice) => ({
        ...choice,
        label: message(choice.label, deps) ?? choice.label,
      }));
    } else if (meta.field.type === 'choice' || meta.field.type === 'address-list') {
      spec.choices = deps.choicesFor?.(meta.key) ?? [];
    }
    return spec;
  }

  /** Copies the container of a list value, so editing the form cannot touch `DEFAULTS`. */
  function detach(value: unknown): unknown {
    return Array.isArray(value) ? [...value] : value;
  }

  /** Values of the same shape? Arrays compare entry by entry; everything else is `Object.is`. */
  export function sameValue(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) {
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((entry, i) => Object.is(entry, b[i]))
      );
    }
    return Object.is(a, b);
  }

  /** The dialog's starting values: the effective settings, with every list copied. */
  export function snapshotValues(
    effective: Settings,
    metas: readonly SettingFieldMeta[] = SETTING_FIELDS,
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const meta of metas) if (meta.dialog) values[meta.key] = detach(effective[meta.key]);
    return values;
  }

  /** The keys of `metas` put back to their defaults, as a patch for the pending values. */
  export function defaultValues(metas: readonly SettingFieldMeta[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const meta of metas) values[meta.key] = detach(DEFAULTS[meta.key]);
    return values;
  }

  /**
   * Only what the user changed. Sending the untouched values as well would write the same
   * file - the store diffs against the defaults - but a minimal patch is what "save writes
   * only the changed keys" means, and it keeps a value this build does not understand from
   * travelling through a form.
   */
  export function changedValues(
    values: Record<string, unknown>,
    effective: Settings,
    metas: readonly SettingFieldMeta[] = SETTING_FIELDS,
  ): Partial<Settings> {
    const patch: Record<string, unknown> = {};
    for (const meta of metas) {
      if (!meta.dialog) continue;
      if (!Object.prototype.hasOwnProperty.call(values, meta.key)) continue;
      if (!sameValue(values[meta.key], effective[meta.key])) patch[meta.key] = values[meta.key];
    }
    return patch as Partial<Settings>;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import Modal from '$lib/components/common/Modal.svelte';
  import MachinesPage from '$lib/components/dialogs/MachinesPage.svelte';
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { dialogs } from '$lib/app/dialogs';
  import { files } from '$lib/app/fileOps';
  import { status } from '$lib/app/status';
  import { validateFields } from '$lib/core/forms/validate';
  import { settingsOpenFile } from '$lib/platform/commands';
  import { profiles } from '$lib/stores/profiles';
  import { settings } from '$lib/stores/settings';
  import { hasKey, t } from '$lib/i18n';
  import type { Msg } from '$lib/app/types';

  interface Props {
    /** Supplied by ModalHost. Resolves `settings.open`; the value is unused. */
    close: (value?: unknown) => void;
    /**
     * The tab to open on (I6, M6). `settings.open` leaves it out and gets the first page;
     * `machines.manage` asks for `MACHINES_TAB`, so the command that means "manage my
     * machines" does not land on Appearance. An unknown value is ignored rather than
     * shown as an empty dialog.
     */
    initialTab?: DialogTab;
  }

  let { close, initialTab }: Props = $props();

  const paths = settings.paths;

  const pages = pagesOf();
  const tabs = tabsOf(pages);
  const readOnly = settings.isReadOnly();
  const report = settings.report();

  /** Literal `t()` keys, so `i18n/keys.test.ts` can scan them. */
  function categoryLabel(category: DialogTab): string {
    switch (category) {
      case 'appearance':
        return t('settings.categories.appearance');
      case 'editor':
        return t('settings.categories.editor');
      case 'assistance':
        return t('settings.categories.assistance');
      case 'files':
        return t('settings.categories.files');
      case MACHINES_TAB:
        return t('settings.categories.machines');
      default:
        return t('settings.categories.scripts');
    }
  }

  /** Profile names are data and stay untranslated (AD-14). */
  const specDeps: SpecDeps = {
    translate: t,
    hasKey,
    choicesFor: (key) =>
      key === 'files.defaultProfile'
        ? profiles.list().map((info) => ({ label: info.name, value: info.id }))
        : undefined,
  };

  /** Every page's `FieldSpec`s, built once: the schema and the profiles do not change here. */
  const specs = new Map<SettingCategory, FieldSpec[]>(
    pages.map((page) => [
      page.category,
      page.metas.filter((meta) => !isListKey(meta.key)).map((meta) => specOf(meta, specDeps)),
    ]),
  );

  /** The list-valued rows of a page, with their labels resolved the same way. */
  const listSpecs = new Map<SettingCategory, FieldSpec[]>(
    pages.map((page) => [
      page.category,
      page.metas.filter((meta) => isListKey(meta.key)).map((meta) => specOf(meta, specDeps)),
    ]),
  );

  const everySpec = pages.flatMap((page) => specs.get(page.category) ?? []);

  // Seeded once, on purpose: the dialog owns the pending values until Save or Cancel.
  let current = $state<Record<string, unknown>>(untrack(() => snapshotValues(get(settings.values))));
  // Read once, like `current` above: the caller says where the dialog opens, and from then
  // on the tab belongs to the user.
  let active = $state<DialogTab>(
    untrack(() =>
      initialTab !== undefined && tabs.includes(initialTab) ? initialTab : (pages[0]?.category ?? 'appearance'),
    ),
  );
  let tablist = $state<HTMLElement | undefined>(undefined);
  let busy = $state(false);

  const errors = $derived(validateFields(everySpec, current));
  const blocked = $derived(Object.keys(errors).length > 0);

  /** Pages that hold a field the user has to fix before anything can be saved. */
  const invalid = $derived(
    new Set<string>(
      pages
        .filter((page) => page.metas.some((meta) => errors[meta.key] !== undefined))
        .map((page) => page.category),
    ),
  );

  const activeSpecs = $derived(specs.get(active as SettingCategory) ?? []);
  const activeLists = $derived(listSpecs.get(active as SettingCategory) ?? []);

  function set(id: string, value: unknown): void {
    current = { ...current, [id]: value };
  }

  function errorsFor(list: FieldSpec[]): Record<string, Msg> {
    const shown: Record<string, Msg> = {};
    for (const spec of list) {
      const problem = errors[spec.id];
      if (problem) shown[spec.id] = problem;
    }
    return shown;
  }

  /** English detail for anything thrown across the IPC boundary. */
  function detailOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  // --- the category tabs ----------------------------------------------------

  function selectCategory(category: DialogTab): void {
    active = category;
    tablist?.querySelector<HTMLElement>(`[data-category="${category}"]`)?.focus();
  }

  /** Arrow keys, Home and End move between the pages, as a tab list is expected to. */
  function onTabKey(e: KeyboardEvent): void {
    const index = tabs.indexOf(active);
    let next = index;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    selectCategory(tabs[next]);
  }

  // --- the list control (scripts.folders) -----------------------------------

  function listOf(id: string): string[] {
    const value = current[id];
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  }

  async function addToList(spec: FieldSpec): Promise<void> {
    const picked = await dialogs.exclusive(() =>
      dialogs.pickFolder({ title: t('settings.pickScriptFolder') }),
    );
    if (typeof picked !== 'string') return;
    const entries = listOf(spec.id);
    if (entries.includes(picked)) {
      status.show(t('settings.folderAlready'));
      return;
    }
    set(spec.id, [...entries, picked]);
  }

  function removeFromList(spec: FieldSpec, index: number): void {
    set(
      spec.id,
      listOf(spec.id).filter((_entry, i) => i !== index),
    );
  }

  // --- the footer -----------------------------------------------------------

  async function resetCategory(): Promise<void> {
    const page = pages.find((entry) => entry.category === active);
    if (!page || busy) return;
    const label = categoryLabel(page.category);
    const confirmed = await dialogs.confirm({
      title: t('settings.resetTitle', { category: label }),
      message: t('settings.resetMessage', { category: label }),
      ok: t('common.reset'),
      cancel: t('common.cancel'),
      kind: 'warning',
    });
    if (!confirmed) return;
    busy = true;
    try {
      await settings.reset(page.metas.map((meta) => meta.key));
    } catch (err) {
      status.show(t('settings.resetFailed'), { error: true, detail: detailOf(err) });
      return;
    } finally {
      busy = false;
    }
    // The written values are the defaults, so the form can follow without re-reading.
    current = { ...current, ...defaultValues(page.metas) };
    status.show(t('settings.resetDone', { category: label }));
  }

  /**
   * Hands the file to `files.open`, which needs no dialog: `settings_open_file` creates it
   * if it has to and grants that one path. The dialog closes first, because the file is a
   * document from then on and editing it there is the point.
   */
  async function openSettingsFile(): Promise<void> {
    if (busy) return;
    busy = true;
    let path: string;
    try {
      path = await settingsOpenFile();
    } catch (err) {
      status.show(t('settings.openFileFailed'), { error: true, detail: detailOf(err) });
      return;
    } finally {
      busy = false;
    }
    close();
    await files.open([path]);
  }

  async function save(): Promise<void> {
    if (blocked || readOnly || busy) return;
    const patch = changedValues(current, get(settings.values));
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    busy = true;
    try {
      await settings.save(patch);
    } catch (err) {
      status.show(t('settings.saveFailed'), { error: true, detail: detailOf(err) });
      return;
    } finally {
      busy = false;
    }
    // A value the store could not use has already been reported by `settings.save()`
    // itself, as a status error naming what was dropped. Saying "Settings saved" on top of
    // that would replace the warning with a success message, and §7.5 is explicit that a
    // form never corrects a value behind the user's back (G8 M2). The fields that could
    // reach this are `required` in `SETTING_FIELDS`, so Save is normally blocked first;
    // this is the second line, for a patch no control produced.
    if (settings.lastWriteWarnings().length === 0) status.show(t('settings.saved'));
    close();
  }
</script>

<Modal
  id="settings"
  title={t('settings.title')}
  okLabel={t('common.save')}
  okDisabled={blocked || readOnly || busy}
  onOk={() => void save()}
  onCancel={() => close()}
>
  {#snippet footer()}
    <button
      type="button"
      class="footer-action"
      data-testid="settings-reset"
      disabled={readOnly || busy || active === MACHINES_TAB}
      onclick={() => void resetCategory()}
    >
      {t('settings.reset')}
    </button>
    <button
      type="button"
      class="footer-action"
      data-testid="settings-open-file"
      disabled={busy}
      onclick={() => void openSettingsFile()}
    >
      {t('settings.openFile')}
    </button>
  {/snippet}

  <div class="settings">
    {#if readOnly}
      <p class="notice" data-testid="settings-readonly">{t('settings.readOnly')}</p>
    {/if}
    {#if report.error !== undefined}
      <p class="notice" data-testid="settings-notice">
        {t('settings.problemError', { detail: report.error })}
      </p>
    {:else if report.warnings.length > 0}
      <p class="notice" data-testid="settings-notice">
        {t('settings.problemIgnored', {
          count: report.warnings.length,
          detail: report.warnings.join(' · '),
        })}
      </p>
    {/if}

    <div class="panes">
      <div
        class="tabs"
        role="tablist"
        aria-orientation="vertical"
        aria-label={t('settings.categoriesLabel')}
        bind:this={tablist}
      >
        {#each tabs as tab (tab)}
          <button
            type="button"
            role="tab"
            id="settings-tab-{tab}"
            class="tab"
            class:selected={tab === active}
            data-testid="settings-category"
            data-category={tab}
            data-invalid={invalid.has(tab) ? '1' : '0'}
            aria-selected={tab === active}
            aria-controls="settings-page-{tab}"
            tabindex={tab === active ? 0 : -1}
            onclick={() => selectCategory(tab)}
            onkeydown={onTabKey}
          >
            {categoryLabel(tab)}
          </button>
        {/each}
      </div>

      <div
        class="page"
        role="tabpanel"
        id="settings-page-{active}"
        aria-labelledby="settings-tab-{active}"
        data-testid="settings-page"
        data-category={active}
      >
        {#if active === MACHINES_TAB}
          <MachinesPage />
        {:else}
          <FormRenderer
            fields={activeSpecs}
            values={current}
            errors={errorsFor(activeSpecs)}
            onChange={set}
          />
        {/if}

        {#each activeLists as spec (spec.id)}
          {@const entries = listOf(spec.id)}
          <div class="form-field" data-testid="form-field" data-field={spec.id}>
            <span class="form-label">{spec.label}</span>
            {#if entries.length === 0}
              <p class="form-help">{t('settings.listEmpty')}</p>
            {:else}
              <ul class="list">
                {#each entries as entry, index (entry)}
                  <li class="list-row" data-testid="settings-list-item" data-index={index}>
                    <code class="path">{entry}</code>
                    <button
                      type="button"
                      class="list-remove"
                      data-testid="settings-list-remove"
                      aria-label={t('settings.listRemove', { path: entry })}
                      onclick={() => removeFromList(spec, index)}
                    >
                      ×
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <button
              type="button"
              class="list-add"
              data-testid="settings-list-add"
              onclick={() => void addToList(spec)}
            >
              {t('settings.listAdd')}
            </button>
            {#if spec.help}<p class="form-help">{spec.help}</p>{/if}
          </div>
        {/each}

        {#if active === 'scripts'}
          <div class="form-field">
            <span class="form-label">{t('settings.scriptsFolder')}</span>
            <code class="path" data-testid="settings-scripts-folder">
              {$paths?.userScriptsDir ?? t('settings.pathUnknown')}
            </code>
            <p class="form-help">{t('settings.scriptsFolderHelp')}</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</Modal>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-size: 13px;
  }

  .notice {
    margin: 0 0 10px;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--danger-text);
    font-size: 12px;
  }

  .panes {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    min-height: 0;
  }

  .tabs {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 2px;
    width: 130px;
  }

  .tab {
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .tab:hover {
    background: var(--surface-hover);
  }

  .tab.selected {
    background: var(--accent);
    /* On --accent, not on a surface: --text-active would be black here in the light
       theme, which is under AA (G8 M2). */
    color: var(--text-on-accent);
  }

  .tab[data-invalid='1']::after {
    content: ' !';
    color: var(--danger-text);
    font-weight: 700;
  }

  .tab.selected[data-invalid='1']::after {
    color: var(--text-active);
  }

  .page {
    flex: 1 1 auto;
    min-width: 0;
    max-height: 48vh;
    padding-right: 4px;
    overflow-y: auto;
  }

  /* The list control mirrors FormRenderer's field layout, whose styles are scoped to it. */
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 14px;
  }

  .form-label {
    color: var(--text-main);
    font-size: 13px;
  }

  .form-help {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .list-row {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 2px 4px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }

  .path {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-main);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    user-select: text;
    cursor: text;
  }

  .list-remove {
    flex: 0 0 auto;
    width: 20px;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 14px;
    line-height: 18px;
    cursor: pointer;
  }

  .list-remove:hover {
    background: var(--surface-hover);
    color: var(--danger-text);
  }

  .list-add,
  .footer-action {
    align-self: flex-start;
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }

  .list-add:hover,
  .footer-action:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .footer-action:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
