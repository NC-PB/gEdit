<!--
  The prompt for one value of the code inspector (Phase 3 plan P3.2b, §6.8: `inspector-edit`).
  Owner: P3.2b.

  A `Modal` with one input, so Esc cancels, Enter confirms while the value is accepted and the
  focus trap is the same as everywhere else. `validate` answers with a `Msg` for every
  keystroke (`checkValue`, then `rewriteWord`): the key goes into `data-error` of the input and
  the plain-words text under it, and OK stays disabled while there is one. Nothing is
  corrected: a refused value stays in the field until the user changes it.

  Rendered by `modals.open()` from `app/inspectorService.ts`, never mounted directly.
-->
<script module lang="ts">
  /**
   * Enter held down on a row of the panel opens this prompt and goes on repeating into the field,
   * where the dialog would confirm the value nobody has looked at yet. Only a fresh press confirms.
   */
  export function isHeldEnter(e: { key: string; repeat: boolean }): boolean {
    return e.key === 'Enter' && e.repeat;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '$lib/components/common/Modal.svelte';
  import { t } from '$lib/i18n';
  import type { Msg } from '$lib/app/types';

  interface Props {
    /** Already translated. */
    title: string;
    /** Already translated: what the field holds, with its unit. */
    label: string;
    /** The word's address; `data-address`. */
    address: string;
    initial: string;
    /** A message while the typed value is refused, else null. */
    validate: (typed: string) => Msg | null;
    /** The value, or undefined when the prompt is dismissed. */
    close: (value?: string) => void;
  }

  let { title, label, address, initial, validate, close }: Props = $props();

  // Built fresh for every call, so the initial value is seeded once on purpose.
  let value = $state(untrack(() => initial));
  const error = $derived(validate(value));
  const errorText = $derived(error === null ? null : t(error.key, error.params));

  let field = $state<HTMLInputElement | undefined>(undefined);

  // The value is selected when the prompt opens, so typing replaces it.
  $effect(() => {
    field?.focus();
    field?.select();
  });

  function onKey(e: KeyboardEvent): void {
    if (!isHeldEnter(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<Modal
  id="inspector-edit"
  {title}
  okDisabled={error !== null}
  onOk={() => close(value)}
  onCancel={() => close(undefined)}
>
  <label class="field">
    <span class="label">{label}</span>
    <input
      class="input"
      data-testid="inspector-edit"
      data-address={address}
      data-error={error?.key}
      type="text"
      autocomplete="off"
      spellcheck="false"
      aria-invalid={error === null ? undefined : 'true'}
      aria-describedby={error === null ? undefined : 'inspector-edit-error'}
      bind:this={field}
      bind:value
      onkeydown={onKey}
    />
  </label>
  {#if errorText !== null}<p class="error" id="inspector-edit-error" role="alert">{errorText}</p>{/if}
</Modal>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    color: var(--text-muted);
    font-size: 12px;
  }

  .input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font-family: var(--font-mono, monospace);
    font-size: 13px;
  }

  .input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .input[aria-invalid='true'] {
    border-color: var(--danger);
  }

  .error {
    margin: 6px 0 0;
    color: var(--danger-text);
    font-size: 12px;
  }
</style>
