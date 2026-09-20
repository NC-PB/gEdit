<!--
  The program map (plan §5 WP3.5, §7.9: `program-map`, `program-map-item`). Owner: WP3.5.

  The panel draws what `app/outlineService.ts` publishes and nothing else: no parsing, no
  debounce and no per-document cache live here any more. The service keeps one incremental
  `OutlineIndex` per document, so switching tabs only swaps which store this component
  subscribes to — the M1 panel re-parsed the whole text on every switch and paid ~36 ms on
  a 10 MB program (§4.3 G7).

  Two levels: tool calls and program starts at the top, everything inside a tool segment
  nested under it. The row that holds the cursor carries `data-active="1"`, and clicking a
  row calls `editor.reveal`, which activates the document, moves the cursor, centres the
  line and focuses the editor.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import CirclePause from 'lucide-svelte/icons/circle-pause';
  import CornerDownRight from 'lucide-svelte/icons/corner-down-right';
  import FileCode from 'lucide-svelte/icons/file-code';
  import Flag from 'lucide-svelte/icons/flag';
  import Heading from 'lucide-svelte/icons/heading';
  import MessageSquare from 'lucide-svelte/icons/message-square';
  import Tag from 'lucide-svelte/icons/tag';
  import Wrench from 'lucide-svelte/icons/wrench';
  import { outline } from '$lib/app/outlineService';
  import { editor } from '$lib/monaco/editorService';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';
  import type { OutlineItem } from '$lib/core/profiles/outline';
  import type { OutlineKind } from '$lib/core/profiles/types';

  const active = docs.active;

  let items = $state<OutlineItem[]>([]);
  /** The line the cursor is on; 0 before the first cursor event. */
  let cursorLine = $state(0);

  const docId = $derived($active?.id ?? null);

  // One subscription at a time, dropped and replaced when the active document changes.
  // `outline.items()` is what starts the document's first build (AD-12: after the first
  // render), so asking for the store here is also what schedules the work.
  $effect(() => {
    const id = docId;
    if (id === null) {
      items = [];
      return;
    }
    return outline.items(id).subscribe((next) => {
      items = next;
    });
  });

  /**
   * The line of the row that holds the cursor.
   *
   * `itemAt` answers from the live index while `items` is the published one, so the rows
   * are matched by line: no line carries two items, because a tool change outranks every
   * outline rule.
   */
  const activeLine = $derived.by(() => {
    void items;
    const id = docId;
    if (id === null || cursorLine < 1) return null;
    return outline.itemAt(id, cursorLine)?.line ?? null;
  });

  /** Written out per kind, so `i18n/keys.test.ts` sees every key. */
  function kindLabel(kind: OutlineKind): string {
    switch (kind) {
      case 'tool':
        return t('programMap.kinds.tool');
      case 'program':
        return t('programMap.kinds.program');
      case 'section':
        return t('programMap.kinds.section');
      case 'comment':
        return t('programMap.kinds.comment');
      case 'label':
        return t('programMap.kinds.label');
      case 'stop':
        return t('programMap.kinds.stop');
      case 'end':
        return t('programMap.kinds.end');
      default:
        return t('programMap.kinds.subprogramCall');
    }
  }

  function reveal(item: OutlineItem): void {
    if (docId !== null) editor.reveal(docId, item.line);
  }

  onMount(() =>
    editor.onDidChangeCursor((info) => {
      cursorLine = info.line;
    }),
  );
</script>

{#snippet row(item: OutlineItem)}
  <button
    type="button"
    class="item {item.kind}"
    data-testid="program-map-item"
    data-line={item.line}
    data-kind={item.kind}
    data-active={item.line === activeLine ? '1' : '0'}
    title={t('programMap.lineTooltip', { line: item.line })}
    onclick={() => reveal(item)}
  >
    <span class="icon" aria-hidden="true">
      {#if item.kind === 'tool'}<Wrench size={13} />
      {:else if item.kind === 'program'}<FileCode size={13} />
      {:else if item.kind === 'section'}<Heading size={13} />
      {:else if item.kind === 'comment'}<MessageSquare size={13} />
      {:else if item.kind === 'label'}<Tag size={13} />
      {:else if item.kind === 'stop'}<CirclePause size={13} />
      {:else if item.kind === 'end'}<Flag size={13} />
      {:else}<CornerDownRight size={13} />{/if}
    </span>
    <span class="kind">{kindLabel(item.kind)}</span>
    <span class="text">{item.text}</span>
  </button>
{/snippet}

<div class="program-map" data-testid="program-map">
  {#if $active === null}
    <p class="hint">{t('programMap.noDocument')}</p>
  {:else if items.length === 0}
    <p class="hint">{t('programMap.empty')}</p>
  {:else}
    <ul class="items">
      {#each items as item (`${item.kind}:${item.line}`)}
        <li>
          {@render row(item)}
          {#if item.children && item.children.length > 0}
            <ul class="items children">
              {#each item.children as child (`${child.kind}:${child.line}`)}
                <li>{@render row(child)}</li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .program-map {
    padding: 6px 8px;
  }

  .hint {
    margin: 6px 2px;
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .children {
    margin-left: 13px;
    border-left: 1px solid var(--border-color);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 6px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
  }
  .item:hover {
    background-color: var(--surface-hover);
  }
  .item[data-active='1'] {
    background-color: var(--surface-active);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .icon {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
  }
  .item.tool .icon {
    color: var(--nc-tool);
  }
  .item.comment .icon,
  .item.section .icon {
    color: var(--nc-comment);
  }

  /* The kind is for screen readers; the icon carries it visually. */
  .kind {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .item.comment .text,
  .item.section .text {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
