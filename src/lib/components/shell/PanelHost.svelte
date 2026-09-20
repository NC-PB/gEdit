<!--
  One panel region (plan AD-6, §7.9: `panel` with `data-region` and `data-panel`).
  Owner: WP1.5.

  Every region renders the panels the registry holds for it; the layout store decides
  which one is active. With more than one panel the header becomes a small tab strip, so
  Output and Results share the bottom region from M4 on without any change here.
-->
<script lang="ts">
  import { panels } from '$lib/app/registry/panels';
  import { layout } from '$lib/stores/layout';
  import { t } from '$lib/i18n';
  import type { PanelDef } from '$lib/app/types';

  interface Props {
    region: 'left' | 'bottom' | 'overlay';
  }

  let { region }: Props = $props();

  const all = panels.panels;
  const layoutState = layout.state;

  const list = $derived($all.filter((panel) => panel.region === region));
  const activeId = $derived(
    region === 'overlay' ? $layoutState.overlay : $layoutState[region].active,
  );
  const active = $derived<PanelDef | undefined>(
    list.find((panel) => panel.id === activeId) ?? list[0],
  );
</script>

{#if active}
  <section class="panel-host {region}" data-testid="panel" data-region={region} data-panel={active.id}>
    <header class="panel-header">
      <div class="panel-tabs" role="tablist" aria-label={t('shell.panels')}>
        {#each list as panel (panel.id)}
          <button
            type="button"
            class="panel-tab"
            class:active={panel.id === active.id}
            role="tab"
            aria-selected={panel.id === active.id}
            onclick={() => layout.show(panel.id)}
          >{t(panel.title)}</button>
        {/each}
      </div>
      {#if region !== 'overlay'}
        <button
          type="button"
          class="panel-close"
          aria-label={t('shell.hidePanel', { panel: t(active.title) })}
          title={t('shell.hidePanel', { panel: t(active.title) })}
          onclick={() => layout.hide(region)}
        >✕</button>
      {:else}
        <button
          type="button"
          class="panel-close"
          aria-label={t('common.close')}
          title={t('common.close')}
          onclick={() => layout.closeOverlay()}
        >✕</button>
      {/if}
    </header>
    <div class="panel-body">
      {#key active.id}
        {@const Panel = active.component}
        <Panel />
      {/key}
    </div>
  </section>
{/if}

<style>
  .panel-host {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background-color: var(--bg-panel);
  }
  .panel-host.left {
    width: 100%;
    height: 100%;
    border-right: 1px solid var(--border-color);
  }
  .panel-host.bottom {
    width: 100%;
    height: 100%;
    border-top: 1px solid var(--border-color);
  }
  .panel-host.overlay {
    flex: 1 1 auto;
  }

  .panel-header {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 26px;
    padding: 0 4px 0 8px;
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--border-color);
  }

  .panel-tabs {
    display: flex;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .panel-tab {
    flex: 0 0 auto;
    padding: 2px 8px;
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .panel-tab:hover {
    color: var(--text-main);
  }
  .panel-tab.active {
    color: var(--text-active);
    border-bottom-color: var(--accent);
  }

  .panel-close {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    color: var(--text-muted);
    font: inherit;
    font-size: 10px;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
  }
  .panel-close:hover {
    color: var(--text-active);
    background-color: var(--surface-hover);
  }

  .panel-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
</style>
