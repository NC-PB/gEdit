<!--
  The Insert tab's block buttons (plan §5 WP1.5). Owner: WP1.5.

  A custom ribbon group, because the buttons follow the active document's profile: the
  same block id is "Cancel cycle" in Fanuc and "Centering" in Klartext. Those labels and
  descriptions come from `src/lib/data/blocks/*.json` and are dialect data, which AD-14
  does not translate; the command titles behind the buttons are i18n keys
  (`blocks.name.<id>`) and are what the F1 palette lists.

  Every button carries the §7.9 `cmd-button` / `data-command="insert.block:<id>"` pair, so
  the M0 scenarios keep working.
-->
<script lang="ts">
  import Plus from 'lucide-svelte/icons/plus';
  import { commands } from '$lib/app/registry/commands';
  import { asIcon } from '$lib/app/icons';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';
  import { blocksFor } from '$lib/utils/insertBlock';
  import RibbonButton from './RibbonButton.svelte';

  const active = docs.active;
  const icon = asIcon(Plus);

  const blocks = $derived(blocksFor($active?.profileId ?? ''));
  const primary = $derived(blocks.filter(([, block]) => block.Button));
  const secondary = $derived(blocks.filter(([, block]) => !block.Button));

  let more = $state('');

  function insert(id: string): void {
    void commands.run(`insert.block:${id}`);
  }

  function onMore(e: Event & { currentTarget: HTMLSelectElement }): void {
    const id = e.currentTarget.value;
    more = '';
    if (id) insert(id);
  }
</script>

{#each primary as [id, block] (id)}
  <RibbonButton
    command={'insert.block:' + id}
    label={block.Text}
    title={block.Description}
    {icon}
    disabled={!commands.has('insert.block:' + id)}
    onclick={() => insert(id)}
  />
{/each}

{#if secondary.length > 0}
  <label class="more">
    <span class="sr-only">{t('blocks.moreBlocks')}</span>
    <select class="ribbon-select" bind:value={more} onchange={onMore}>
      <option value="" disabled selected>{t('blocks.moreBlocks')}</option>
      {#each secondary as [id, block] (id)}
        <option value={id} title={block.Description}>{block.Text}</option>
      {/each}
    </select>
  </label>
{/if}

<style>
  .more {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    margin-left: 6px;
    padding-left: 8px;
    border-left: 1px solid var(--border-color);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .ribbon-select {
    width: 140px;
    padding: 4px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    background-color: var(--bg-app);
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: pointer;
  }
  .ribbon-select:hover {
    border-color: var(--text-muted);
  }
</style>
