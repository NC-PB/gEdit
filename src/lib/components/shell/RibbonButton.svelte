<!--
  One ribbon control (plan §7.9: `cmd-button` with `data-command`). Owner: WP1.5.

  Both the registry-driven groups and the custom groups (blocks, v1 scripts) use this, so
  every ribbon control looks and behaves the same. The icon is rendered without props and
  sized in CSS: `CommandDef.icon` is a plain Svelte `Component` (§7.1), so passing a
  `size` would not type-check.
-->
<script lang="ts">
  import type { Component } from 'svelte';

  interface Props {
    label: string;
    title?: string;
    /** Command id for `data-command`; omitted from the DOM when there is none. */
    command?: string;
    icon?: Component;
    disabled?: boolean;
    testid?: string;
    onclick: () => void;
  }

  let {
    label,
    title = '',
    command = undefined,
    icon = undefined,
    disabled = false,
    testid = 'cmd-button',
    onclick,
  }: Props = $props();
</script>

<button
  class="ribbon-btn"
  type="button"
  data-testid={testid}
  data-command={command}
  title={title || label}
  {disabled}
  {onclick}
>
  {#if icon}
    {@const Icon = icon}
    <span class="btn-icon"><Icon /></span>
  {/if}
  <span class="btn-label">{label}</span>
</button>

<style>
  .ribbon-btn {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 56px;
    padding: 4px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 11px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    cursor: pointer;
  }
  .ribbon-btn:hover:not(:disabled) {
    background-color: var(--surface-hover);
    border-color: var(--surface-hover-border);
  }
  .ribbon-btn:active:not(:disabled) {
    background-color: var(--surface-active);
  }
  .ribbon-btn:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
  .btn-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 24px;
    color: var(--accent-hover);
  }
  .ribbon-btn:disabled .btn-icon {
    color: var(--text-disabled);
  }
  /* Icon components bring their own 24px svg; keep every ribbon icon the same size. */
  .btn-icon :global(svg) {
    width: 22px;
    height: 22px;
  }
  .btn-label {
    max-width: 96px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
