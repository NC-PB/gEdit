<!--
  The v1 Python script controls on the Tools tab (plan §5 WP1.5, §7.9). Owner: WP1.5.

  A custom ribbon group, because the three controls keep the M0 test ids
  (`scripts-folder`, `script-select`, `script-run`) rather than the generic `cmd-button`,
  and because the script list is a `<select>`, not a button. M5 replaces all of it.
-->
<script lang="ts">
  import FolderCog from 'lucide-svelte/icons/folder-cog';
  import Play from 'lucide-svelte/icons/play';
  import { commands } from '$lib/app/registry/commands';
  import { asIcon } from '$lib/app/icons';
  import { t } from '$lib/i18n';
  import { baseName } from '$lib/utils/platform';
  import {
    availableScripts,
    scriptRunning,
    scriptsFolder,
    selectedScript,
  } from '$lib/components/panels/scriptsV1State';
  import RibbonButton from './RibbonButton.svelte';

  const folderIcon = asIcon(FolderCog);
  const runIcon = asIcon(Play);

  const folderTitle = $derived(
    $scriptsFolder ? t('scripts.folderTooltip', { folder: $scriptsFolder }) : t('scripts.pickFolderTitle'),
  );
  const runTitle = $derived(
    $selectedScript ? t('scripts.runTooltip', { script: $selectedScript }) : t('scripts.selectScriptFirst'),
  );
  const canRun = $derived($selectedScript !== '' && !$scriptRunning);
</script>

<RibbonButton
  testid="scripts-folder"
  command="scripts.pickFolder"
  label={t('scripts.pickFolder')}
  title={folderTitle}
  icon={folderIcon}
  onclick={() => void commands.run('scripts.pickFolder')}
/>

{#if $availableScripts.length > 0}
  <label class="picker">
    <span class="sr-only">{t('scripts.selectScript')}</span>
    <select class="ribbon-select" data-testid="script-select" bind:value={$selectedScript}>
      <option value="" disabled>{t('scripts.selectScript')}</option>
      {#each $availableScripts as script (script)}
        <option value={script}>{script}</option>
      {/each}
    </select>
  </label>
  <RibbonButton
    testid="script-run"
    command="scripts.run"
    label={t('scripts.run')}
    title={runTitle}
    icon={runIcon}
    disabled={!canRun}
    onclick={() => void commands.run('scripts.run')}
  />
{:else}
  <p class="hint">
    {$scriptsFolder ? t('scripts.noScripts') : t('scripts.noFolder')}
    {#if $scriptsFolder}<span class="folder">{baseName($scriptsFolder)}</span>{/if}
  </p>
{/if}

<style>
  .picker {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    margin: 0 4px;
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
    width: 160px;
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

  .hint {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 4px;
    margin: 0;
    padding: 0 8px;
    color: var(--text-muted);
    font-size: 11px;
    font-style: italic;
  }
  .folder {
    color: var(--text-main);
    font-style: normal;
  }
</style>
