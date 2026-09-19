<script lang="ts">
  import { FileUp, Save, FilePen, Plus, Type, Code2, Settings, FolderOpen, ChevronDown, Play, FolderCog } from 'lucide-svelte';
  import { activeBlocksLib } from '../data/blocks/index';
  import type { Dialect } from '../utils/dialects';
  import { shortcutLabel } from '../utils/platform';

  export let activeLanguage: Dialect = 'fanuc-gcode';

  export let onOpen: () => void;
  export let onSave: () => void;
  export let onSaveAs: () => void;
  export let onInsertBlock: (blockType: string) => void;
  export let onSetScriptsFolder: () => void;
  export let onRunScript: (scriptName: string) => void;
  export let scriptsFolder: string = '';
  export let availableScripts: string[] = [];
  
  const languages: { value: Dialect; label: string }[] = [
    { value: 'fanuc-gcode', label: 'Fanuc G-Code' },
    { value: 'heidenhain-klartext', label: 'Heidenhain Klartext' }
  ];

  let activeTab = 'home';
  let selectedScript = '';

  $: currentBlocks = activeBlocksLib[activeLanguage] || {};
  $: primaryBlocks = Object.entries(currentBlocks).filter(([_, b]) => b.Button);
  $: secondaryBlocks = Object.entries(currentBlocks).filter(([_, b]) => !b.Button);

  function handleMoreBlocks(e: Event & { currentTarget: HTMLSelectElement }) {
    const select = e.currentTarget;
    if (select.value) onInsertBlock(select.value);
    select.value = '';
  }
</script>

<style>
  .ribbon-container {
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    user-select: none;
  }
  
  /* Top App Header / Title bar */
  .app-header {
    display: flex;
    align-items: center;
    padding: 0 12px;
    height: 32px;
    background-color: var(--bg-app); /* Slightly darker */
  }

  /* Title tabs */
  .ribbon-tabs {
    display: flex;
    padding-top: 4px;
    padding-left: 12px;
    background-color: var(--bg-app);
  }

  .ribbon-tab {
    padding: 4px 16px;
    font-size: 12px;
    text-transform: uppercase;
    color: var(--text-main);
    cursor: default;
    border: 1px solid transparent;
    border-bottom: none;
    margin-right: 2px;
    margin-bottom: -1px;
    z-index: 10;
  }

  .ribbon-tab.active {
    background-color: var(--bg-ribbon);
    color: var(--text-active);
    border-color: var(--border-color);
  }

  .ribbon-tab:hover:not(.active) {
    background-color: rgba(255, 255, 255, 0.05);
  }

  /* Ribbon Body */
  .ribbon-body {
    display: flex;
    height: 84px;
    padding: 4px 8px;
  }

  .ribbon-group {
    display: flex;
    align-items: stretch;
    border-right: 1px solid var(--border-color);
    padding: 0 8px;
    position: relative;
    padding-bottom: 16px; /* Space for group label */
  }

  .ribbon-group:last-child {
    border-right: none;
  }

  .group-label {
    position: absolute;
    bottom: 2px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
  }

  .ribbon-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px 8px;
    min-width: 56px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-main);
    border-radius: 2px;
    cursor: pointer;
  }

  .ribbon-btn:hover {
    background-color: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .ribbon-btn:active {
    background-color: rgba(0, 0, 0, 0.2);
  }

  .btn-icon {
    margin-bottom: 4px;
  }
  
  .btn-label {
    font-size: 11px;
  }

  /* Utility controls right */
  .ribbon-utilities {
    margin-left: auto;
    display: flex;
    align-items: center;
    padding-right: 8px;
  }

  .utility-select {
    appearance: none;
    background-color: var(--bg-app);
    color: var(--text-main);
    border: 1px solid var(--border-color);
    padding: 4px 24px 4px 8px;
    font-size: 12px;
    border-radius: 2px;
    cursor: pointer;
  }
  
  .utility-select:hover {
    border-color: var(--text-muted);
  }
  
  .select-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }
</style>

<div class="ribbon-container">
  <!-- Title bar / Quick Access -->
  <div class="app-header">
    <div class="flex items-center gap-2">
      <Code2 size={16} class="text-[#0078d4]" />
      <span class="text-xs text-[#cccccc]">gEdit / Workspace</span>
    </div>
  </div>

  <!-- Tabs -->
  <div class="ribbon-tabs">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="ribbon-tab {activeTab === 'home' ? 'active' : ''}" on:click={() => activeTab = 'home'}>Home</div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="ribbon-tab {activeTab === 'insert' ? 'active' : ''}" on:click={() => activeTab = 'insert'}>Insert</div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="ribbon-tab {activeTab === 'tools' ? 'active' : ''}" on:click={() => activeTab = 'tools'}>Tools</div>
  </div>

  <!-- Body -->
  <div class="ribbon-body">
    {#if activeTab === 'home'}
      <div class="ribbon-group">
        <button class="ribbon-btn" on:click={onOpen} title="Open File ({shortcutLabel('O')})">
          <FolderOpen size={24} class="btn-icon text-[#dcb67a]" />
          <span class="btn-label">Open</span>
        </button>
        <button class="ribbon-btn" on:click={onSave} title="Save ({shortcutLabel('S')})">
          <Save size={24} class="btn-icon text-[#0078d4]" />
          <span class="btn-label">Save</span>
        </button>
        <button class="ribbon-btn" on:click={onSaveAs} title="Save As… ({shortcutLabel('S', true)})">
          <FilePen size={24} class="btn-icon text-[#0078d4]" />
          <span class="btn-label">Save As</span>
        </button>
        <div class="group-label">File</div>
      </div>

      <div class="ribbon-group">
        <button class="ribbon-btn" on:click={() => onInsertBlock('start')} title="New Program Header">
          <Plus size={24} class="btn-icon text-[#10b981]" />
          <span class="btn-label">New Prg</span>
        </button>
        <div class="group-label">Program</div>
      </div>
    {/if}

    {#if activeTab === 'insert'}
      <div class="ribbon-group">
        {#each primaryBlocks as [key, block]}
          <button class="ribbon-btn" on:click={() => onInsertBlock(key)} title={block.Description}>
            <Plus size={24} class="btn-icon text-[#10b981]" />
            <span class="btn-label">{block.Text}</span>
          </button>
        {/each}
        
        {#if secondaryBlocks.length > 0}
          <div class="flex items-center ml-2 border-l border-[var(--border-color)] pl-2 h-full pb-4">
            <div class="select-wrapper">
              <!-- svelte-ignore a11y-no-onchange -->
              <select class="utility-select" style="padding-left: 8px; width: 140px;" on:change={handleMoreBlocks}>
                <option value="" disabled selected>More Blocks...</option>
                {#each secondaryBlocks as [key, block]}
                  <option value={key} title={block.Description}>{block.Text}</option>
                {/each}
              </select>
              <ChevronDown size={14} class="absolute right-2 pointer-events-none text-[#808080]" />
            </div>
          </div>
        {/if}
        <div class="group-label">Blocks</div>
      </div>
    {/if}
    
    {#if activeTab === 'tools'}
      <div class="ribbon-group">
        <button class="ribbon-btn" on:click={onSetScriptsFolder} title={scriptsFolder ? `Scripts: ${scriptsFolder}` : 'Set Python Scripts Folder'}>
          <FolderCog size={24} class="btn-icon {scriptsFolder ? 'text-[#a6e3a1]' : 'text-[#94a3b8]'}" />
          <span class="btn-label">Scripts Dir</span>
        </button>
        <div class="group-label">Configure</div>
      </div>

      <div class="ribbon-group">
        {#if availableScripts.length > 0}
          <div class="flex items-center gap-2 h-full pb-4">
            <div class="select-wrapper">
              <select bind:value={selectedScript} class="utility-select" style="width: 160px;">
                <option value="" disabled>Select Script...</option>
                {#each availableScripts as script}
                  <option value={script}>{script}</option>
                {/each}
              </select>
              <ChevronDown size={14} class="absolute right-2 pointer-events-none text-[#808080]" />
            </div>
          </div>
          <button class="ribbon-btn" on:click={() => { if (selectedScript) onRunScript(selectedScript); }} title={selectedScript ? `Run ${selectedScript}` : 'Select a script first'}>
            <Play size={24} class="btn-icon {selectedScript ? 'text-[#a6e3a1]' : 'text-[#94a3b8]'}" />
            <span class="btn-label">Run</span>
          </button>
        {:else}
          <div class="flex items-center h-full pb-4 px-2">
            <span style="font-size: 11px; color: var(--text-muted); font-style: italic;">
              {scriptsFolder ? 'No .py files found' : 'Set scripts folder first'}
            </span>
          </div>
        {/if}
        <div class="group-label">Python Scripts</div>
      </div>

      <div class="ribbon-group">
        <button class="ribbon-btn" title="Settings (TBD)">
          <Settings size={24} class="btn-icon text-[#94a3b8]" />
          <span class="btn-label">Settings</span>
        </button>
        <div class="group-label">Settings</div>
      </div>
    {/if}

    <div class="ribbon-utilities">
      <div class="select-wrapper">
        <select bind:value={activeLanguage} class="utility-select">
          {#each languages as lang}
            <option value={lang.value}>{lang.label}</option>
          {/each}
        </select>
        <ChevronDown size={14} class="absolute right-2 pointer-events-none text-[#808080]" />
      </div>
    </div>
  </div>
</div>
