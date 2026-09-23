<!--
  The lock of the active document (plan §7.12: `status-item` with `data-item="readonly"`
  and `data-reason`, AD-23). Registered by `contrib/readOnly.ts`.

  It is shown **only while the document is locked**, like a warning light rather than a
  setting: a permanent "Read/write" would be one more thing to read past, and the state
  that matters is the one that refuses a keystroke.

  The two reasons are not the same thing and the tooltip says which one applies: an
  `attribute` lock is the file's own read-only bit, which gEdit never changes, so saving
  it always asks where to put it; a `user` lock is this tab only and nothing on disk was
  touched. Clicking unlocks (the same command the palette offers).
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';

  const active = docs.active;

  const view = $derived.by(() => {
    const doc = $active;
    if (!doc?.readOnly) return null;
    return {
      reason: doc.readOnlyReason ?? '',
      tooltip:
        doc.readOnlyReason === 'attribute'
          ? t('readOnly.itemAttribute', { name: doc.title })
          : t('readOnly.itemUser', { name: doc.title }),
    };
  });
</script>

{#if view}
  <button
    class="item"
    type="button"
    title={view.tooltip}
    onclick={() => void commands.run('file.toggleReadOnly')}
    data-testid="status-item"
    data-item="readonly"
    data-reason={view.reason}
  >
    <span aria-hidden="true">&#128274;</span>&nbsp;{t('readOnly.item')}
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
  .item:hover:enabled {
    background-color: rgb(255 255 255 / 20%);
  }
  .item:focus-visible {
    outline: 1px solid currentcolor;
    outline-offset: -1px;
  }
</style>
