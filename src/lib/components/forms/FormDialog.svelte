<!--
  The dialog behind `modals.form()` (plan §5 WP2.2, §7.2). Owner: WP2.2.

  `Modal` plus `FormRenderer`: it owns the pending values, revalidates on every keystroke
  and keeps OK disabled while anything is wrong, so a transform or a script never starts
  with a value that `validateFields` rejected. Opened through `modals.form(...)`, which is
  what transform options (M4) and script parameters (M5) call; never mounted directly.

  `data-modal` is `form`, so a scenario finds it as `[data-testid=modal][data-modal=form]`
  and its controls as `form-field` with `data-field=<field id>`.

  Phase 3 (P3.5; Phase 3 plan §7 #226): the optional `live` hook is called with the current
  values and answers the text of the read-only fields (a template's formulas), a plain-text
  `preview` of what OK would insert (`template-preview`, `data-error` = the message key while
  the values are refused) and the field errors of the template engine, which replace the form's
  own message for that field. It is a derived value, so it runs once per update of the values.
  A `note` (a template's "review pending") is shown above the fields; a `marker` gives the note's
  element a test id and data attributes (the cycle form's `cycle-form`). Nothing is drawn for a
  form without `live`, `note` and `marker`: the P2 form, unchanged.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '$lib/components/common/Modal.svelte';
  import FormRenderer from './FormRenderer.svelte';
  import { validateFields } from '$lib/core/forms/validate';
  import { initialValues } from '$lib/core/forms/values';
  import { t } from '$lib/i18n';
  import type { FieldSpec } from '$lib/core/forms/types';
  import type { FormLiveResult, Msg } from '$lib/app/types';

  interface Props {
    /** Already translated. */
    title: string;
    fields: FieldSpec[];
    /** Remembered or caller-supplied values; missing ids fall back to the field default. */
    values?: Record<string, unknown>;
    /** Already translated; `common.ok` otherwise. */
    okLabel?: string;
    context?: { addresses?: string[] };
    /** See the header: the template form's live values, preview and errors. */
    live?: (values: Record<string, unknown>) => FormLiveResult;
    /** Already translated. */
    note?: string;
    marker?: { testid: string; data: Record<string, string> };
    /** Called once, with the values or undefined when the dialog is dismissed. */
    close: (values?: Record<string, unknown>) => void;
  }

  let { title, fields, values, okLabel, context, live, note, marker, close }: Props = $props();

  // The dialog is built fresh for every call, so the starting values are seeded once here
  // on purpose; `untrack` says so, instead of leaving a "referenced locally" warning.
  let current = $state<Record<string, unknown>>(untrack(() => initialValues(fields, values)));

  const answer = $derived<FormLiveResult | null>(live ? live(current) : null);

  /** The values the fields show: the typed ones, and the computed ones in the read-only fields. */
  const shown = $derived.by((): Record<string, unknown> => {
    const computed = answer?.values;
    if (!computed) return current;
    const out = { ...current };
    for (const field of fields) {
      if (field.readOnly === true && Object.prototype.hasOwnProperty.call(computed, field.id)) out[field.id] = computed[field.id];
    }
    return out;
  });

  const errors = $derived<Record<string, Msg>>({ ...validateFields(fields, current), ...(answer?.fieldErrors ?? {}) });
  const blocked = $derived(Object.keys(errors).length > 0 || answer?.error !== undefined);
  /** What a scenario reads from the preview: the first message key that refuses the values. */
  const refusedKey = $derived(answer?.error?.key ?? Object.values(errors)[0]?.key);
  const noteData = $derived(
    Object.fromEntries(Object.entries(marker?.data ?? {}).map(([name, value]) => [`data-${name}`, value])),
  );

  function set(id: string, value: unknown): void {
    current = { ...current, [id]: value };
  }

  function accept(): void {
    close({ ...shown });
  }
</script>

<Modal
  id="form"
  {title}
  {okLabel}
  okDisabled={blocked}
  onOk={accept}
  onCancel={() => close(undefined)}
>
  {#if note || marker}
    <p class="form-dialog-note" data-testid={marker?.testid ?? 'form-note'} {...noteData}>{note ?? ''}</p>
  {/if}
  {#if fields.length === 0}
    <p class="form-dialog-empty">{t('forms.noFields')}</p>
  {:else}
    <FormRenderer {fields} values={shown} {errors} {context} onChange={set} />
  {/if}
  {#if answer}
    {#if answer.error}
      <p class="form-dialog-preview form-dialog-preview-error" data-testid="template-preview" data-error={refusedKey}>
        {t(answer.error.key, answer.error.params)}
      </p>
    {:else if refusedKey !== undefined}
      <p class="form-dialog-preview form-dialog-preview-error" data-testid="template-preview" data-error={refusedKey}>
        {t('forms.previewBlocked')}
      </p>
    {:else if answer.preview !== undefined}
      <pre class="form-dialog-preview" data-testid="template-preview">{answer.preview}</pre>
    {/if}
  {/if}
</Modal>

<style>
  .form-dialog-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }

  .form-dialog-note {
    margin: 0 0 12px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .form-dialog-note:empty {
    display: none;
  }

  .form-dialog-preview {
    /* A long form scrolls; the text it would write stays in view under the fields. */
    position: sticky;
    bottom: 0;
    box-sizing: border-box;
    max-height: 180px;
    margin: 4px 0 0;
    padding: 6px 8px;
    overflow: auto;
    color: var(--text-main);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    white-space: pre;
    background: var(--bg-app);
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }

  .form-dialog-preview-error {
    color: var(--danger-text);
    font-family: inherit;
    white-space: normal;
  }
</style>
