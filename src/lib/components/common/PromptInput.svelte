<!--
  The one-line prompt behind `modals.prompt()` (plan §5 WP2.2, §7.2). Owner: WP2.2.

  Props are unchanged from the M2 prelude's stub. It is a `Modal` with a single input, so
  Esc, Enter, the focus trap and the OK / Cancel test ids all come from there: Enter
  confirms only while `validate` is happy, because `Modal` ignores it when OK is disabled.

  Rendered by `ModalHost` from a `component` request, never mounted directly.

  `validate` answers with a `Msg`, not with display text: `data-error` on a `form-field`
  carries the message **key** everywhere in the app (§7.9, `FormRenderer`), so a scenario
  can assert `forms.errors.required` against a prompt and a generated form alike. The
  translated text goes under the input, where a person reads it.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import { t } from '$lib/i18n';
  import type { Msg } from '$lib/app/types';

  interface Props {
    /** Already translated. */
    title: string;
    placeholder?: string;
    initial?: string;
    /** A message key (with params) while the value is not acceptable, else null. */
    validate?: (v: string) => Msg | null;
    /** Called once, with the value or undefined when the prompt is dismissed. */
    close: (value?: string) => void;
  }

  let { title, placeholder, initial = '', validate, close }: Props = $props();

  // The prompt is built fresh for every call, so the initial value is seeded once here
  // on purpose; `untrack` says so, instead of leaving a "referenced locally" warning.
  let value = $state(untrack(() => initial));
  const error = $derived(validate ? validate(value) : null);
  const errorText = $derived(error === null ? null : t(error.key, error.params));
</script>

<Modal
  id="prompt"
  {title}
  okDisabled={error !== null}
  onOk={() => close(value)}
  onCancel={() => close(undefined)}
>
  <input
    class="prompt-input"
    data-testid="form-field"
    data-field="value"
    data-error={error?.key}
    type="text"
    autocomplete="off"
    spellcheck="false"
    aria-label={t('forms.promptValue')}
    aria-invalid={error === null ? undefined : 'true'}
    aria-describedby={error === null ? undefined : 'prompt-error'}
    {placeholder}
    bind:value
  />
  {#if errorText !== null}<p class="prompt-error" id="prompt-error">{errorText}</p>{/if}
</Modal>

<style>
  .prompt-input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
  }

  .prompt-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .prompt-input[aria-invalid='true'] {
    border-color: var(--danger);
  }

  .prompt-error {
    margin: 6px 0 0;
    color: var(--danger-text);
    font-size: 12px;
  }
</style>
