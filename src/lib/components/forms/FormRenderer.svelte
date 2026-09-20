<!--
  The one form engine (plan §5 WP2.2, §7.5). Owner: WP2.2.

  Props are unchanged from the M2 prelude's stub, so WP2.7 (the settings dialog) needs no
  edit. One control per `FieldType`, the native pickers behind `file` and `folder`,
  checkboxes over `choices` for `address-list`, and help text plus the error next to each
  field. Every field is wrapped in a `form-field` with `data-field` and, while it fails,
  `data-error` carrying the message **key** (§7.9) — a stable name for a scenario.

  Values are owned by the caller (a settings dialog has Save and Cancel, so it needs the
  pending values anyway), which is why this takes `values` plus `onChange` rather than
  binding.

  Numeric controls are text inputs on purpose: `type="number"` lets the browser swallow
  and round what is typed, and a form that decides feed rates may never correct a value
  behind the user's back (§7.5). What the user types is handed to `onChange` as a number
  while it parses and as the raw string while it does not, so `validateFields` can say
  "enter a number" instead of the value vanishing.
-->
<script lang="ts">
  import { dialogs } from '$lib/app/dialogs';
  import { t } from '$lib/i18n';
  import type { FieldChoice, FieldSpec } from '$lib/core/forms/types';
  import type { Msg } from '$lib/app/types';

  interface Props {
    fields: FieldSpec[];
    /** One entry per field id; `initialValues()` builds the first set. */
    values: Record<string, unknown>;
    /** From `validateFields()`; shown next to the offending field. */
    errors?: Record<string, Msg>;
    /** Extra data a field type may need, e.g. the addresses of an `address-list`. */
    context?: { addresses?: string[] };
    onChange: (id: string, value: unknown) => void;
  }

  let { fields, values, errors = {}, context, onChange }: Props = $props();

  /**
   * What the user actually typed into a numeric control, so `1.50` and a lone `-` stay on
   * screen while the parsed value travels on. Dropped as soon as the caller replaces the
   * value with something else (a "Reset category" in the settings dialog).
   */
  let typed = $state<Record<string, string>>({});

  const controlId = (field: FieldSpec): string => `field-${field.id}`;
  const helpId = (field: FieldSpec): string => `field-${field.id}-help`;
  const errorId = (field: FieldSpec): string => `field-${field.id}-error`;

  function describedBy(field: FieldSpec): string | undefined {
    const parts: string[] = [];
    if (field.help) parts.push(helpId(field));
    if (errors[field.id]) parts.push(errorId(field));
    return parts.length ? parts.join(' ') : undefined;
  }

  /** `choice` takes its options from the field; `address-list` falls back to the context. */
  function choicesOf(field: FieldSpec): FieldChoice[] {
    if (field.choices) return field.choices;
    if (field.type === 'address-list' && context?.addresses) {
      return context.addresses.map((address) => ({ label: address, value: address }));
    }
    return [];
  }

  // --- text -----------------------------------------------------------------

  function textOf(field: FieldSpec): string {
    const value = values[field.id];
    return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  }

  // --- numbers --------------------------------------------------------------

  /** A number while the text parses, the text itself while it does not, undefined when blank. */
  function parseNumeric(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : text;
  }

  function numericText(field: FieldSpec): string {
    const value = values[field.id];
    const raw = typed[field.id];
    if (raw !== undefined && Object.is(parseNumeric(raw), value)) return raw;
    return value === undefined || value === null ? '' : String(value);
  }

  function onNumericInput(field: FieldSpec, text: string): void {
    typed[field.id] = text;
    onChange(field.id, parseNumeric(text));
  }

  // --- choice ---------------------------------------------------------------

  /** Options travel as their index, because a choice value may be any type. */
  function selectedIndex(field: FieldSpec): string {
    const index = choicesOf(field).findIndex((choice) => Object.is(choice.value, values[field.id]));
    return index < 0 ? '' : String(index);
  }

  function onChoice(field: FieldSpec, index: string): void {
    const choice = choicesOf(field)[Number(index)];
    if (choice) onChange(field.id, choice.value);
  }

  // --- address-list ---------------------------------------------------------

  function isPicked(field: FieldSpec, value: unknown): boolean {
    const current = values[field.id];
    return Array.isArray(current) && current.some((entry) => Object.is(entry, value));
  }

  /** Rebuilt in the order of `choices`, so the result does not depend on click order. */
  function onToggleAddress(field: FieldSpec, value: unknown, on: boolean): void {
    const wanted = choicesOf(field)
      .map((choice) => choice.value)
      .filter((candidate) =>
        Object.is(candidate, value) ? on : isPicked(field, candidate),
      );
    onChange(field.id, wanted);
  }

  // --- file and folder ------------------------------------------------------

  async function browse(field: FieldSpec): Promise<void> {
    const picked = await dialogs.exclusive(() =>
      field.type === 'folder'
        ? dialogs.pickFolder({ title: t('forms.pickFolder', { label: field.label }) })
        : dialogs.pickFile({ title: t('forms.pickFile', { label: field.label }) }),
    );
    // A cancelled picker (null) and a refused re-entrant call (undefined) both leave the
    // field alone.
    if (typeof picked === 'string') onChange(field.id, picked);
  }
</script>

{#each fields as field (field.id)}
  {@const error = errors[field.id]}
  {#if field.type === 'address-list'}
    <fieldset
      class="form-field"
      data-testid="form-field"
      data-field={field.id}
      data-error={error?.key}
    >
      <legend class="form-label">{field.label}</legend>
      {#each choicesOf(field) as choice, i (i)}
        <label class="form-check">
          <input
            type="checkbox"
            checked={isPicked(field, choice.value)}
            onchange={(e) => onToggleAddress(field, choice.value, e.currentTarget.checked)}
          />
          <span>{choice.label}</span>
        </label>
      {:else}
        <p class="form-empty">{t('forms.noChoices')}</p>
      {/each}
      {#if field.help}<p class="form-help" id={helpId(field)}>{field.help}</p>{/if}
      {#if error}
        <p class="form-error" id={errorId(field)}>{t(error.key, error.params)}</p>
      {/if}
    </fieldset>
  {:else}
    <div class="form-field" data-testid="form-field" data-field={field.id} data-error={error?.key}>
      {#if field.type === 'bool'}
        <label class="form-check">
          <input
            id={controlId(field)}
            type="checkbox"
            checked={values[field.id] === true}
            aria-describedby={describedBy(field)}
            onchange={(e) => onChange(field.id, e.currentTarget.checked)}
          />
          <span class="form-label">{field.label}</span>
        </label>
      {:else}
        <label class="form-label" for={controlId(field)}>{field.label}</label>
        {#if field.type === 'choice'}
          <select
            id={controlId(field)}
            class="form-control"
            value={selectedIndex(field)}
            aria-required={field.required ? 'true' : undefined}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy(field)}
            onchange={(e) => onChoice(field, e.currentTarget.value)}
          >
            {#if selectedIndex(field) === ''}
              <option value="" disabled>
                {choicesOf(field).length ? t('forms.choosePlaceholder') : t('forms.noChoices')}
              </option>
            {/if}
            {#each choicesOf(field) as choice, i (i)}
              <option value={String(i)}>{choice.label}</option>
            {/each}
          </select>
        {:else if field.type === 'number' || field.type === 'integer'}
          <input
            id={controlId(field)}
            class="form-control"
            type="text"
            inputmode={field.type === 'integer' ? 'numeric' : 'decimal'}
            autocomplete="off"
            spellcheck="false"
            value={numericText(field)}
            aria-required={field.required ? 'true' : undefined}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy(field)}
            oninput={(e) => onNumericInput(field, e.currentTarget.value)}
          />
        {:else if field.type === 'file' || field.type === 'folder'}
          <div class="form-path">
            <input
              id={controlId(field)}
              class="form-control"
              type="text"
              autocomplete="off"
              spellcheck="false"
              value={textOf(field)}
              aria-required={field.required ? 'true' : undefined}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={describedBy(field)}
              oninput={(e) => onChange(field.id, e.currentTarget.value)}
            />
            <button
              type="button"
              class="form-browse"
              aria-label={t('forms.browseFor', { label: field.label })}
              onclick={() => void browse(field)}
            >
              {t('common.browse')}
            </button>
          </div>
        {:else}
          <input
            id={controlId(field)}
            class="form-control"
            type="text"
            autocomplete="off"
            spellcheck="false"
            value={textOf(field)}
            aria-required={field.required ? 'true' : undefined}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy(field)}
            oninput={(e) => onChange(field.id, e.currentTarget.value)}
          />
        {/if}
      {/if}
      {#if field.help}<p class="form-help" id={helpId(field)}>{field.help}</p>{/if}
      {#if error}
        <p class="form-error" id={errorId(field)}>{t(error.key, error.params)}</p>
      {/if}
    </div>
  {/if}
{/each}

<style>
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 14px;
    padding: 0;
    border: 0;
  }

  .form-label {
    color: var(--text-main);
    font-size: 13px;
  }

  .form-check {
    display: flex;
    gap: 8px;
    align-items: center;
    cursor: pointer;
  }

  .form-check input {
    margin: 0;
    accent-color: var(--accent);
  }

  .form-control {
    box-sizing: border-box;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
  }

  .form-control:focus {
    border-color: var(--accent);
    outline: none;
  }

  .form-control[aria-invalid='true'] {
    border-color: var(--danger);
  }

  .form-path {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .form-browse {
    flex: 0 0 auto;
    padding: 5px 10px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    white-space: nowrap;
    cursor: pointer;
  }

  .form-browse:hover {
    background: var(--surface-hover);
  }

  .form-help,
  .form-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .form-error {
    margin: 0;
    color: var(--danger-text);
    font-size: 12px;
  }
</style>
