<!--
  The generic picker (plan §5 WP1.1, §7.9). Owner: WP1.1.

  Used by tab switching, encoding, EOL, profile and (from M5) scripts: substring filter,
  arrow keys, Enter, Esc and mouse. Rendered by ModalHost, never mounted directly —
  `modals.quickPick(items, o)` is the entry point.
-->
<script lang="ts" generics="T">
  import { t } from '$lib/i18n';
  import type { QuickPickItem } from '$lib/app/types';

  interface Props {
    items: QuickPickItem<T>[];
    placeholder?: string;
    initialIndex?: number;
    /** Called once, with the picked value or undefined when the picker is dismissed. */
    close: (value?: T) => void;
  }

  let { items, placeholder, initialIndex = 0, close }: Props = $props();

  let query = $state('');
  /** null until an arrow key or a filter change moves the highlight off `initialIndex`. */
  let wanted = $state<number | null>(null);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let list = $state<HTMLElement | undefined>(undefined);

  /** Case-insensitive substring match over the label and the two subtitles. */
  function matches(item: QuickPickItem<T>, needle: string): boolean {
    if (!needle) return true;
    const haystack = `${item.label}\n${item.description ?? ''}\n${item.detail ?? ''}`;
    return haystack.toLowerCase().includes(needle);
  }

  const filtered = $derived(
    query.trim() ? items.filter((item) => matches(item, query.trim().toLowerCase())) : items,
  );
  /** The highlighted row, clamped to the filtered list (-1 when nothing matches). */
  const cursor = $derived(
    filtered.length === 0
      ? -1
      : Math.min(Math.max(wanted ?? initialIndex, 0), filtered.length - 1),
  );

  $effect(() => {
    input?.focus();
  });

  $effect(() => {
    const el = list?.querySelector(`[data-index="${cursor}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  });

  function accept(index: number): void {
    const item = filtered[index];
    close(item ? item.value : undefined);
  }

  function onInput(e: Event): void {
    query = (e.currentTarget as HTMLInputElement).value;
    wanted = 0;
  }

  function onKeyDown(e: KeyboardEvent): void {
    const count = filtered.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (count) wanted = (cursor + 1) % count;
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (count) wanted = (cursor - 1 + count) % count;
        break;
      case 'Home':
        e.preventDefault();
        wanted = 0;
        break;
      case 'End':
        e.preventDefault();
        wanted = count - 1;
        break;
      case 'Enter':
        e.preventDefault();
        if (cursor >= 0) accept(cursor);
        break;
      default:
        break;
    }
  }
</script>

<div class="quick-pick" data-testid="quick-pick">
  <input
    bind:this={input}
    class="quick-pick-input"
    data-testid="quick-pick-input"
    type="text"
    autocomplete="off"
    spellcheck="false"
    role="combobox"
    aria-expanded="true"
    aria-controls="quick-pick-list"
    aria-autocomplete="list"
    aria-activedescendant={cursor >= 0 ? `quick-pick-item-${cursor}` : undefined}
    placeholder={placeholder ?? t('core.quickPickPlaceholder')}
    value={query}
    oninput={onInput}
    onkeydown={onKeyDown}
  />

  <div
    bind:this={list}
    class="quick-pick-list"
    id="quick-pick-list"
    role="listbox"
    aria-label={placeholder ?? t('core.quickPickLabel')}
  >
    {#each filtered as item, i (i)}
      <button
        type="button"
        role="option"
        class="quick-pick-item"
        class:selected={i === cursor}
        id="quick-pick-item-{i}"
        data-testid="quick-pick-item"
        data-index={i}
        aria-selected={i === cursor}
        tabindex="-1"
        onclick={() => accept(i)}
      >
        <span class="label">{item.label}</span>
        {#if item.description}<span class="description">{item.description}</span>{/if}
        {#if item.detail}<span class="detail">{item.detail}</span>{/if}
      </button>
    {/each}
    {#if filtered.length === 0}
      <p class="quick-pick-empty">{t('core.quickPickEmpty')}</p>
    {/if}
  </div>
</div>

<style>
  .quick-pick {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .quick-pick-input {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--accent, #0078d4);
    border-radius: 3px;
    background: var(--bg-app, #1e1e1e);
    color: var(--text-main, #cccccc);
    font: inherit;
    font-size: 13px;
    outline: none;
  }

  .quick-pick-list {
    max-height: 320px;
    margin-top: 6px;
    overflow-y: auto;
  }

  .quick-pick-item {
    display: flex;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    padding: 5px 10px;
    border: 0;
    background: transparent;
    color: var(--text-main, #cccccc);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .quick-pick-item:hover {
    background: color-mix(in srgb, var(--accent, #0078d4) 25%, transparent);
  }

  .quick-pick-item.selected {
    background: var(--accent, #0078d4);
    color: var(--text-active, #ffffff);
  }

  .quick-pick-item .label {
    flex: 0 1 auto;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .quick-pick-item .description,
  .quick-pick-item .detail {
    flex: 1 1 auto;
    overflow: hidden;
    color: var(--text-muted, #808080);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .quick-pick-item.selected .description,
  .quick-pick-item.selected .detail {
    color: var(--text-active, #ffffff);
  }

  .quick-pick-empty {
    margin: 0;
    padding: 8px 10px;
    color: var(--text-muted, #808080);
    font-size: 13px;
  }
</style>
