<!--
  The program map (plan §5 WP1.5, §7.9: `program-map`, `program-map-item`). Owner: WP1.5.

  Still the legacy `parseProgramStructure` over the whole document, behind a 300 ms
  debounce; M3 (WP3.5) replaces it with the incremental OutlineIndex and adds
  `data-active`. Clicking a row calls `editor.reveal`, which activates the document,
  moves the cursor, centres the line and focuses the editor.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import MessageSquare from 'lucide-svelte/icons/message-square';
  import Wrench from 'lucide-svelte/icons/wrench';
  import { editor } from '$lib/monaco/editorService';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';
  import { parseProgramStructure, type StructureItem } from '$lib/utils/gcodeParser';
  import type { DocId } from '$lib/app/types';

  /** Long enough that typing does not re-parse a large program on every keystroke. */
  const REFRESH_DELAY_MS = 300;

  const active = docs.active;

  let items = $state<StructureItem[]>([]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The last parse of each open document. Switching tabs must not re-parse text that has
   * not changed: on a 10 MB program that cost ~36 ms per switch and was most of the G7
   * budget (§4.3 G7). `versionId` is Monaco's `alternativeVersionId`, which returns to an
   * earlier value when an edit is undone, so equal ids really do mean equal text.
   */
  const parsed = new Map<DocId, { versionId: number; profileId: string; items: StructureItem[] }>();

  /** The document and the language the map is built for; a change re-parses at once. */
  const source = $derived(`${$active?.id ?? ''}\u0000${$active?.profileId ?? ''}`);

  function refresh(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const id = docs.getActiveId();
    const doc = id === null ? undefined : docs.get(id);
    // A closed document must not keep its parse alive.
    for (const key of parsed.keys()) if (!docs.get(key)) parsed.delete(key);
    if (!doc || !editor.hasModel(doc.id)) {
      items = [];
      return;
    }
    const versionId = editor.versionId(doc.id);
    const cached = parsed.get(doc.id);
    if (cached && cached.versionId === versionId && cached.profileId === doc.profileId) {
      items = cached.items;
      return;
    }
    const next = parseProgramStructure(editor.getText(doc.id), doc.profileId);
    parsed.set(doc.id, { versionId, profileId: doc.profileId, items: next });
    items = next;
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(refresh, REFRESH_DELAY_MS);
  }

  function reveal(item: StructureItem): void {
    const id = docs.getActiveId();
    if (id !== null) editor.reveal(id, item.line);
  }

  onMount(() => {
    const stops = [
      editor.onDidChangeContent(schedule),
      // A fresh model restarts `alternativeVersionId`, so its cached parse must go.
      editor.onDidCreateModel((id) => {
        parsed.delete(id);
        refresh();
      }),
      // No `onDidActivate` here: `source` already covers a document switch, and
      // subscribing to both parsed the whole document twice for one switch — 2 × 36 ms
      // on a 10 MB program, which was the entire G7 tab-switch budget (§4.3 G7).
    ];
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      for (const stop of stops) stop();
    };
  });

  // Switching document or profile re-parses immediately; `items` is not read here, so
  // writing it inside `refresh()` cannot re-trigger this effect.
  $effect(() => {
    void source;
    refresh();
  });
</script>

<div class="program-map" data-testid="program-map">
  {#if $active === null}
    <p class="hint">{t('programMap.noDocument')}</p>
  {:else if items.length === 0}
    <p class="hint">{t('programMap.empty')}</p>
  {:else}
    <ul class="items">
      {#each items as item (item.id)}
        <li>
          <button
            type="button"
            class="item {item.type}"
            data-testid="program-map-item"
            data-line={item.line}
            data-kind={item.type}
            title={t('programMap.lineTooltip', { line: item.line })}
            onclick={() => reveal(item)}
          >
            <span class="icon" aria-hidden="true">
              {#if item.type === 'tool'}<Wrench size={13} />{:else}<MessageSquare size={13} />{/if}
            </span>
            <span class="kind">{item.type === 'tool' ? t('programMap.tool') : t('programMap.comment')}</span>
            <span class="text">{item.text}</span>
          </button>
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

  .icon {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
  }
  .item.tool .icon {
    color: var(--nc-tool);
  }
  .item.comment .icon {
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
  .item.comment .text {
    color: var(--text-muted);
    font-style: italic;
  }
</style>
