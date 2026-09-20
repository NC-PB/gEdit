<!--
  The dialog behind `modals.form()` (plan §5 WP2.2, §7.2). Owner: WP2.2.

  `Modal` plus `FormRenderer`: it owns the pending values, revalidates on every keystroke
  and keeps OK disabled while anything is wrong, so a transform or a script never starts
  with a value that `validateFields` rejected. Opened through `modals.form(...)`, which is
  what transform options (M4) and script parameters (M5) call; never mounted directly.

  `data-modal` is `form`, so a scenario finds it as `[data-testid=modal][data-modal=form]`
  and its controls as `form-field` with `data-field=<field id>`.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '$lib/components/common/Modal.svelte';
  import FormRenderer from './FormRenderer.svelte';
  import { validateFields } from '$lib/core/forms/validate';
  import { initialValues } from '$lib/core/forms/values';
  import { t } from '$lib/i18n';
  import type { FieldSpec } from '$lib/core/forms/types';

  interface Props {
    /** Already translated. */
    title: string;
    fields: FieldSpec[];
    /** Remembered or caller-supplied values; missing ids fall back to the field default. */
    values?: Record<string, unknown>;
    /** Already translated; `common.ok` otherwise. */
    okLabel?: string;
    context?: { addresses?: string[] };
    /** Called once, with the values or undefined when the dialog is dismissed. */
    close: (values?: Record<string, unknown>) => void;
  }

  let { title, fields, values, okLabel, context, close }: Props = $props();

  // The dialog is built fresh for every call, so the starting values are seeded once here
  // on purpose; `untrack` says so, instead of leaving a "referenced locally" warning.
  let current = $state<Record<string, unknown>>(untrack(() => initialValues(fields, values)));

  const errors = $derived(validateFields(fields, current));
  const blocked = $derived(Object.keys(errors).length > 0);

  function set(id: string, value: unknown): void {
    current = { ...current, [id]: value };
  }

  function accept(): void {
    close({ ...current });
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
  {#if fields.length === 0}
    <p class="form-dialog-empty">{t('forms.noFields')}</p>
  {:else}
    <FormRenderer {fields} values={current} {errors} {context} onChange={set} />
  {/if}
</Modal>

<style>
  .form-dialog-empty {
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
  }
</style>
