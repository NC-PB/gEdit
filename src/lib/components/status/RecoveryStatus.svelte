<!--
  The crash-recovery warning light (B1 A2: `status-item` with `data-item="recovery"`).
  Registered by `contrib/recovery.ts`.

  It is shown **only while snapshots cannot be written** (a full disk, a recovery folder
  that cannot be made, a document too large for a snapshot), and it goes by itself when a
  pass writes again. The one-off message that says the same (`recovery.snapshotFailed`)
  is gone after eight seconds; the trouble is not, and the guide promises that a crash
  costs half a minute, so the item stays for as long as that is not true.

  Clicking it tries again at once (`recovery.flushNow()`), which is also how it clears
  when the cause was fixed (space freed) and nothing has been typed since.
-->
<script lang="ts">
  import { recovery, snapshotTrouble } from '$lib/app/recovery';
  import { t } from '$lib/i18n';

  /** At most this many names go into the tooltip. */
  const MAX_NAMES = 3;

  const names = $derived.by(() => {
    const titles = $snapshotTrouble ?? [];
    const shown = titles.slice(0, MAX_NAMES).join(', ');
    return titles.length > MAX_NAMES ? `${shown} …` : shown;
  });
</script>

{#if $snapshotTrouble !== null}
  <button
    class="item"
    type="button"
    title={t('recovery.failingTooltip', { names })}
    onclick={() => void recovery.flushNow()}
    data-testid="status-item"
    data-item="recovery"
  >
    <span aria-hidden="true">&#9888;</span>&nbsp;{t('recovery.failingItem')}
  </button>
{/if}

<style>
  .item {
    padding: 0 4px;
    color: inherit;
    font: inherit;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
  }
  .item:hover {
    background-color: rgb(255 255 255 / 20%);
  }
  .item:focus-visible {
    outline: 1px solid currentcolor;
    outline-offset: -1px;
  }
</style>
