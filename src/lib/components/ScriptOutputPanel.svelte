<script lang="ts">
  import { X, Terminal, Loader2, Database } from "lucide-svelte";

  export let stdout: string = "";
  export let stderr: string = "";
  export let data: any = null;
  export let isRunning: boolean = false;
  export let visible: boolean = false;
  export let onClose: () => void;

  $: isDataObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? Object.keys(data).length > 0
      : Array.isArray(data)
        ? data.length > 0
        : false;
  $: hasOutput = stdout || stderr || isDataObject;
</script>

{#if visible}
  <div class="output-panel">
    <div class="panel-header">
      <div class="panel-header-left">
        <Terminal size={14} class="text-[#a6e3a1]" />
        <span class="panel-title">Script Output</span>
      </div>
      <button class="close-btn" on:click={onClose} title="Close Panel">
        <X size={14} />
      </button>
    </div>

    <div class="panel-body">
      {#if isRunning}
        <div class="loading-state">
          <Loader2 size={24} class="animate-spin text-[var(--accent)]" />
          <span>Running script...</span>
        </div>
      {:else if hasOutput}
        {#if isDataObject}
          <div class="output-block output-json">
            <div class="block-label json-label">
              <Database size={10} /> Structured Result
            </div>
            <pre style="margin: 0;">{JSON.stringify(data, null, 2)}</pre>
          </div>
        {/if}

        {#if stdout && stdout !== JSON.stringify(data)}
          <div class="output-block output-stdout">
            <div class="block-label stdout-label">Raw Stdout</div>
            {stdout}
          </div>
        {/if}

        {#if stderr}
          <div class="output-block output-stderr">
            <div class="block-label stderr-label">stderr</div>
            {stderr}
          </div>
        {/if}
      {:else}
        <div class="empty-state">
          <Terminal size={28} />
          <span>Run a Python script to see output here.</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .output-panel {
    width: 380px;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-panel);
    border-left: 1px solid var(--border-color);
    flex-shrink: 0;
    overflow: hidden;
  }

  /* ... existing styles ... */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .panel-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .panel-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-main);
  }

  .close-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
  }

  .close-btn:hover {
    color: var(--text-active);
    background-color: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .output-block {
    font-family: "Fira Code", "Consolas", monospace;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    margin-bottom: 16px;
  }

  .output-stdout {
    color: #a6e3a1;
  }

  .output-json {
    color: #89b4fa;
    background: rgba(137, 180, 250, 0.05);
    padding: 8px;
    border-radius: 4px;
    border: 1px solid rgba(137, 180, 250, 0.1);
  }

  .output-stderr {
    color: #f38ba8;
    background: rgba(243, 139, 168, 0.05);
    padding: 8px;
    border-radius: 4px;
    border-top: 1px solid rgba(243, 139, 168, 0.1);
  }

  .block-label {
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0.8;
  }

  .stdout-label {
    color: #a6e3a1;
  }
  .json-label {
    color: #89b4fa;
  }
  .stderr-label {
    color: #f38ba8;
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 32px 16px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
    opacity: 0.6;
  }
</style>
