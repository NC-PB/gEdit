<!--
  The single modal host (plan AD-6, §7.9). Owner: WP1.1.

  It renders whatever `modals` has open - QuickPick in M1, prompt / form / custom dialogs
  from M2 - one at a time, keeps focus inside the panel, closes on Esc or a click outside (asking the dialog first when it has a `mayClose` hook),
  and drives `modals.isOpen`, which suspends the key dispatcher.
  AppShell (WP1.5) mounts exactly one of these.
-->
<script module lang="ts">
  /**
   * True when a press at `target` is outside `panel` (the press dismisses the modal). A target that is
   * no DOM node (the window) is not outside; no panel yet is not outside either.
   */
  export function pressedOutside(panel: { contains(node: unknown): boolean } | undefined, target: unknown): boolean {
    if (panel === undefined) return false;
    const isNode = typeof target === 'object' && target !== null && 'nodeType' in target;
    return isNode && !panel.contains(target);
  }
</script>

<script lang="ts">
  import QuickPick from './QuickPick.svelte';
  import { currentModal, dismissModal } from '$lib/app/modals';

  let panel = $state<HTMLElement | undefined>(undefined);

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Visible tab stops inside the panel. `tabindex="-1"` rows (QuickPick items) are not stops. */
  function focusable(): HTMLElement[] {
    if (!panel) return [];
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.tabIndex >= 0 && (el.offsetParent !== null || el === document.activeElement),
    );
  }

  /** Esc dismisses; Tab cycles inside the panel, so focus cannot escape the modal. */
  function onKeyDown(e: KeyboardEvent): void {
    const request = $currentModal;
    if (!request) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      void dismissModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const stops = focusable();
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panel?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panel?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  /**
   * A press outside the panel dismisses the modal, like a native popover, unless the dialog has a
   * `mayClose` hook that says no (a dialog with unsaved edits asks first).
   */
  function onMouseDown(e: MouseEvent): void {
    const request = $currentModal;
    if (!request || !panel) return;
    if (pressedOutside(panel, e.target)) void dismissModal();
  }
</script>

<svelte:window onkeydown={onKeyDown} onmousedown={onMouseDown} />

{#if $currentModal}
  {@const request = $currentModal}
  <!--
    `data-modal` names the modal kind for the runtime harness (kebab-case, like the test
    ids). mergeA: only a QuickPick is addressed on the backdrop. A component modal draws
    its own `Modal` frame (WP2.2), which carries `data-testid="modal"` with the dialog's
    own `data-modal` ("about", "form", …); putting the id here as well nested two `modal`
    elements and made a bare `h.q('modal')` find the backdrop instead of the dialog. The
    backdrop keeps a test id of its own for the click-outside check.
  -->
  <div
    class="modal-backdrop"
    data-testid={request.kind === 'quickPick' ? 'modal' : 'modal-backdrop'}
    data-modal={request.kind === 'quickPick' ? 'quick-pick' : undefined}
  >
    <div class="modal-panel" class:wide={request.kind === 'component' && request.wide === true} bind:this={panel}>
      <!--
        One dialog per request. Without the key, a request that replaces another before the host has
        drawn the empty state in between (a dialog that closes and one that opens in one update) is
        given to the dialog that is already there: the same component with new props. The form dialog
        seeds its values from its props once, so the second form would then show the first one's.
      -->
      {#key request}
        {#if request.kind === 'quickPick'}
          <QuickPick
            items={request.items}
            placeholder={request.placeholder}
            initialIndex={request.initialIndex}
            close={(value?: unknown) => request.resolve(value)}
          />
        {:else}
          {@const Dialog = request.component}
          <Dialog {...request.props} close={(value?: unknown) => request.resolve(value)} />
        {/if}
      {/key}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    z-index: 100;
    display: flex;
    /* Without this the panel stretches to the full height of the backdrop. */
    align-items: flex-start;
    justify-content: center;
    inset: 0;
    padding-top: 12vh;
    background: rgb(0 0 0 / 35%);
  }

  /* `modals.open(..., { wide: true })`: a list and an editor side by side. */
  .modal-panel.wide {
    width: min(1100px, 94vw);
    max-height: 86vh;
  }

  .modal-panel {
    width: min(620px, 90vw);
    max-height: 70vh;
    padding: 10px;
    border: 1px solid var(--border-color, #3e3e42);
    border-radius: 4px;
    background: var(--bg-panel, #252526);
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
    overflow: hidden;
  }
</style>
