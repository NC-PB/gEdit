<!--
  The single modal host (plan AD-6, §7.9). Owner: WP1.1.

  It renders whatever `modals` has open - QuickPick in M1, prompt / form / custom dialogs
  from M2 - one at a time, keeps focus inside the panel, closes on Esc or a click outside,
  and drives `modals.isOpen`, which suspends the key dispatcher.
  AppShell (WP1.5) mounts exactly one of these.
-->
<script lang="ts">
  import QuickPick from './QuickPick.svelte';
  import { currentModal } from '$lib/app/modals';

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
      request.resolve(undefined);
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

  /** A press outside the panel dismisses the modal, like a native popover. */
  function onMouseDown(e: MouseEvent): void {
    const request = $currentModal;
    if (!request || !panel) return;
    if (e.target instanceof Node && !panel.contains(e.target)) request.resolve(undefined);
  }
</script>

<svelte:window onkeydown={onKeyDown} onmousedown={onMouseDown} />

{#if $currentModal}
  {@const request = $currentModal}
  <!-- `data-modal` names the modal kind for the runtime harness (kebab-case, like the test ids). -->
  <div
    class="modal-backdrop"
    data-testid="modal"
    data-modal={request.kind === 'quickPick' ? 'quick-pick' : 'component'}
  >
    <div class="modal-panel" bind:this={panel}>
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
