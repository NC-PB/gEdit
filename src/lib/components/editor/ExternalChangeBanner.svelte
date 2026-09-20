<!--
  "This file changed on disk" (plan §5 WP2.3, §7.9, AD-10). Owner: WP2.3.

  A `banner` panel, so `AppShell` renders it above the editor whenever the active document
  carries an external change; it takes no layout state and disappears with the flag.

  Test ids (§7.9): `external-banner` with `data-doc-id`, and buttons with
  `data-action="reload" | "keep" | "compare"`.

  Compare goes through the command registry rather than through `app/compare.ts`, because
  `compare.withSaved` is WP2.5's: the button only appears once that command is registered,
  so a click can never reach an unknown id (which would be a `console.error`).
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { external } from '$lib/app/external';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';

  const active = docs.active;
  const changed = commands.changed;

  const doc = $derived($active && $active.external !== 'none' ? $active : null);
  const canCompare = $derived.by(() => {
    // `changed` bumps on every (un)registration, which is what re-reads `has()`.
    void $changed;
    return commands.has('compare.withSaved');
  });
</script>

{#if doc}
  <div
    class="external-banner"
    class:deleted={doc.external === 'deleted'}
    data-testid="external-banner"
    data-doc-id={doc.id}
    data-external={doc.external}
    role="status"
  >
    <span class="message">
      {doc.external === 'deleted'
        ? t('external.deleted', { name: doc.title })
        : t('external.changed', { name: doc.title })}
    </span>

    <div class="actions">
      {#if doc.external === 'changed'}
        <button
          type="button"
          data-action="reload"
          title={t('external.reloadHint')}
          onclick={() => void external.reload(doc.id)}
        >{t('external.reload')}</button>
      {/if}

      <button
        type="button"
        data-action="keep"
        title={t('external.keepHint')}
        onclick={() => external.keepMine(doc.id)}
      >{t('external.keep')}</button>

      {#if doc.external === 'changed' && canCompare}
        <button
          type="button"
          data-action="compare"
          title={t('external.compareHint')}
          onclick={() => void commands.run('compare.withSaved', { docId: doc.id })}
        >{t('external.compare')}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .external-banner {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text-main);
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--warning);
  }
  .external-banner.deleted {
    border-bottom-color: var(--danger-text);
  }

  .message {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
  }

  .actions button {
    padding: 2px 10px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    background-color: var(--bg-app);
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: pointer;
  }
  .actions button:hover {
    color: var(--text-active);
    background-color: var(--surface-hover);
  }
</style>
