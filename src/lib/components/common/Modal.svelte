<!--
  The frame every in-app dialog sits in (plan §5 WP2.2, §7.9, AD-6). Owner: WP2.2.

  Props are unchanged from the M2 prelude's stub, so WP2.4 (About, Shortcuts) and WP2.7
  (Settings) need no edit. What WP2.2 added: focus moves into the dialog on mount and back
  to whatever had it when the dialog closes, Tab cannot leave the panel, Esc cancels and
  Enter confirms.

  Rendered through `modals.open()` / `ModalHost`, never mounted directly. `ModalHost`
  supplies the backdrop and its own Esc and Tab handling for modals that are not built on
  this component (QuickPick); the handlers here sit on the dialog element itself and stop
  the keys they consume, so the two never both act on one press.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '$lib/i18n';

  interface Props {
    /** Goes into `data-modal`, so a scenario can tell the dialogs apart. */
    id: string;
    /** Already translated. */
    title: string;
    /** Already translated; defaults come from the `common` namespace. */
    okLabel?: string;
    cancelLabel?: string;
    /** Greys out the confirm button, e.g. while a form has errors. */
    okDisabled?: boolean;
    /** Hides the confirm button, for a dialog that only has "Close" (About). */
    hideOk?: boolean;
    onOk?: () => void;
    onCancel: () => void;
    children: Snippet;
    /** Extra controls next to Cancel ("Reset category", "Open settings file"). */
    footer?: Snippet;
  }

  let {
    id,
    title,
    okLabel,
    cancelLabel,
    okDisabled = false,
    hideOk = false,
    onOk,
    onCancel,
    children,
    footer,
  }: Props = $props();

  let panel = $state<HTMLElement | undefined>(undefined);

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Visible tab stops inside the dialog, in document order. */
  function stops(): HTMLElement[] {
    if (!panel) return [];
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.tabIndex >= 0 && (el.offsetParent !== null || el === document.activeElement),
    );
  }

  function confirm(): void {
    if (hideOk || okDisabled) return;
    onOk?.();
  }

  /**
   * Enter confirms from any control that does not use the key itself, so a dialog can be
   * accepted without reaching for the mouse. A button (Cancel, Browse…) keeps Enter, and
   * a textarea keeps it for the newline.
   */
  function entersConfirm(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return true;
    if (target.isContentEditable) return false;
    const tag = target.tagName;
    return tag !== 'BUTTON' && tag !== 'TEXTAREA' && tag !== 'A';
  }

  /** Keeps Tab inside the panel; returns false when there is nothing to move to. */
  function trapTab(e: KeyboardEvent): void {
    const inside = stops();
    if (inside.length === 0) return;
    const first = inside[0];
    const last = inside[inside.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === 'Enter' && !e.isComposing && entersConfirm(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      confirm();
      return;
    }
    if (e.key === 'Tab') {
      trapTab(e);
      e.stopPropagation();
    }
  }

  // The listener is attached by hand rather than with `onkeydown`, because a `role="dialog"`
  // element with an inline key handler trips the a11y check for a non-interactive role.
  $effect(() => {
    const el = panel;
    if (!el) return;
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  });

  // Focus moves into the dialog once, and back to whatever had it when the dialog goes.
  $effect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (stops()[0] ?? panel)?.focus();
    return () => before?.focus();
  });
</script>

<div
  class="modal"
  data-testid="modal"
  data-modal={id}
  role="dialog"
  aria-modal="true"
  aria-label={title}
  tabindex="-1"
  bind:this={panel}
>
  <h2 class="modal-title">{title}</h2>
  <div class="modal-body">{@render children()}</div>
  <div class="modal-footer">
    <div class="modal-extra">{#if footer}{@render footer()}{/if}</div>
    {#if !hideOk}
      <button
        type="button"
        class="modal-action primary"
        data-testid="modal-ok"
        disabled={okDisabled}
        onclick={() => onOk?.()}
      >
        {okLabel ?? t('common.ok')}
      </button>
    {/if}
    <button type="button" class="modal-action" data-testid="modal-cancel" onclick={onCancel}>
      {cancelLabel ?? t('common.cancel')}
    </button>
  </div>
</div>

<style>
  .modal {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    min-height: 0;
    outline: none;
  }

  .modal-title {
    margin: 0 0 10px;
    color: var(--text-active);
    font-size: 15px;
    font-weight: 600;
  }

  .modal-body {
    flex: 1 1 auto;
    min-height: 0;
    padding-right: 4px;
    overflow-y: auto;
  }

  .modal-footer {
    display: flex;
    flex: 0 0 auto;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color);
  }

  /* Pushes the confirm and cancel buttons to the right, with or without extra controls. */
  .modal-extra {
    display: flex;
    flex: 1 1 auto;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .modal-action {
    padding: 5px 14px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .modal-action:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .modal-action:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  .modal-action.primary:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent);
    /* Not --text-active: that one is picked against the app surfaces and is black in the
       light theme, which is 3.3:1 on --accent (G8 M2). */
    color: var(--text-on-accent);
  }

  .modal-action.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
</style>
