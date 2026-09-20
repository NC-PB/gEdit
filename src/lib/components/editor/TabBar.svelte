<!--
  The document tabs (plan §5 WP1.2, §7.9).

  Reads `docs` directly, so adding a document anywhere in the app shows a tab. Closing
  goes through the command registry (`file.close`, WP1.6) so that the unsaved-changes
  guard runs exactly once, wherever the close came from.

  Reordering uses pointer events on purpose: HTML5 drag and drop swallows the native
  file drop on Windows (plan AD-6).
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';
  import type { DocId } from '$lib/app/types';

  const list = docs.list;
  const activeId = docs.activeId;

  /** How far the pointer must travel before a press turns into a reorder. */
  const DRAG_THRESHOLD = 4;

  let bar = $state<HTMLElement | undefined>(undefined);
  let press: { id: DocId; x: number; dragging: boolean } | null = null;

  function close(id: DocId): void {
    void commands.run('file.close', id);
  }

  function tabElements(): HTMLElement[] {
    return bar ? [...bar.querySelectorAll<HTMLElement>('[data-testid="doc-tab"]')] : [];
  }

  /** The slot the pointer is over: the first tab whose midpoint lies right of `x`. */
  function indexAt(x: number): number {
    const tabs = tabElements();
    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i].getBoundingClientRect();
      if (x < rect.left + rect.width / 2) return i;
    }
    return Math.max(tabs.length - 1, 0);
  }

  function onPointerDown(event: PointerEvent, id: DocId): void {
    // The close button keeps its own pointer and click: capturing here would retarget
    // the follow-up click to the tab.
    if (event.button !== 0 || (event.target as HTMLElement | null)?.closest('.close')) return;
    press = { id, x: event.clientX, dragging: false };
    capture(event.currentTarget as HTMLElement, event.pointerId, true);
  }

  /**
   * Pointer capture keeps the move and up events on the tab that started the drag.
   * A synthetic event (the runtime harness) has no live pointer, so both calls throw
   * `NotFoundError`; the reorder still works, because every tab shares this handler.
   */
  function capture(element: HTMLElement, pointerId: number, on: boolean): void {
    try {
      if (on) element.setPointerCapture(pointerId);
      else if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      // no live pointer: nothing to capture or release
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const current = press;
    if (!current) return;
    if (!current.dragging && Math.abs(event.clientX - current.x) < DRAG_THRESHOLD) return;
    current.dragging = true;
    const from = docs.all().findIndex((doc) => doc.id === current.id);
    const to = indexAt(event.clientX);
    if (from >= 0 && to !== from) docs.move(current.id, to);
  }

  function endDrag(event: PointerEvent): void {
    if (!press) return;
    capture(event.currentTarget as HTMLElement, event.pointerId, false);
    press = null;
  }

  function onClick(event: MouseEvent, id: DocId): void {
    // A reorder ends with a click on the tab; it must not also re-activate blindly.
    if (event.defaultPrevented) return;
    docs.activate(id);
  }

  function onAuxClick(event: MouseEvent, id: DocId): void {
    if (event.button !== 1) return;
    event.preventDefault();
    close(id);
  }

  function onMouseDown(event: MouseEvent): void {
    if (event.button === 1) event.preventDefault(); // no middle-click autoscroll
  }

  function onKeyDown(event: KeyboardEvent, id: DocId): void {
    const all = docs.all();
    const at = all.findIndex((doc) => doc.id === id);
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      docs.activate(id);
    } else if (event.key === 'ArrowRight' && at >= 0 && at < all.length - 1) {
      event.preventDefault();
      docs.activate(all[at + 1].id);
    } else if (event.key === 'ArrowLeft' && at > 0) {
      event.preventDefault();
      docs.activate(all[at - 1].id);
    }
  }

  function externalTitle(external: string): string {
    return external === 'deleted' ? t('tabs.externalDeleted') : t('tabs.externalChanged');
  }

  // Keep the active tab visible when it changes or the list scrolls it out of view.
  $effect(() => {
    const id = $activeId;
    if (!bar || id === null) return;
    const tab = bar.querySelector<HTMLElement>(`[data-testid="doc-tab"][data-doc-id="${id}"]`);
    tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });
</script>

<div class="tab-bar" data-testid="tab-bar" role="tablist" bind:this={bar}>
  {#each $list as doc (doc.id)}
    {@const active = doc.id === $activeId}
    <div
      class="tab"
      class:active
      role="tab"
      tabindex={active ? 0 : -1}
      aria-selected={active}
      title={doc.path ?? doc.title}
      data-testid="doc-tab"
      data-doc-id={doc.id}
      data-path={doc.path ?? ''}
      data-dirty={doc.dirty ? '1' : '0'}
      data-active={active ? '1' : '0'}
      data-external={doc.external}
      onclick={(event) => onClick(event, doc.id)}
      onauxclick={(event) => onAuxClick(event, doc.id)}
      onmousedown={onMouseDown}
      onkeydown={(event) => onKeyDown(event, doc.id)}
      onpointerdown={(event) => onPointerDown(event, doc.id)}
      onpointermove={onPointerMove}
      onpointerup={endDrag}
      onpointercancel={endDrag}
    >
      {#if doc.external !== 'none'}
        <span class="external" class:deleted={doc.external === 'deleted'} title={externalTitle(doc.external)}>
          {doc.external === 'deleted' ? '⚠' : '↻'}
        </span>
      {/if}
      <span class="name">{doc.title}</span>
      <span class="dirty" class:shown={doc.dirty} title={t('tabs.unsaved')} aria-hidden="true">●</span>
      <button
        class="close"
        type="button"
        data-testid="doc-tab-close"
        data-doc-id={doc.id}
        aria-label={t('tabs.close')}
        title={t('tabs.close')}
        onclick={(event) => {
          event.stopPropagation();
          close(doc.id);
        }}
      >
        ✕
      </button>
    </div>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    flex: 0 0 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    background-color: var(--bg-panel);
    border-bottom: 1px solid var(--border-color);
    scrollbar-width: thin;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    max-width: 220px;
    padding: 0 6px 0 10px;
    height: 30px;
    font-size: 12px;
    color: var(--text-muted);
    background-color: transparent;
    border-right: 1px solid var(--border-color);
    border-top: 2px solid transparent;
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }
  .tab:hover {
    color: var(--text-main);
  }
  .tab.active {
    color: var(--text-active);
    background-color: var(--bg-app);
    border-top-color: var(--accent);
  }
  .tab:focus-visible {
    outline: 1px solid var(--accent-hover);
    outline-offset: -2px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dirty {
    flex: 0 0 auto;
    font-size: 14px;
    line-height: 1;
    color: var(--text-main);
    visibility: hidden;
  }
  .dirty.shown {
    visibility: visible;
  }
  .external {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--accent-hover);
  }
  .external.deleted {
    color: #f38ba8;
  }
  .close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    padding: 0;
    font-size: 10px;
    line-height: 1;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.6;
  }
  .close:hover {
    opacity: 1;
    background-color: var(--border-color);
  }
</style>
