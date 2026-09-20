<!--
  The Monaco container (plan §5 WP1.2, §7.9).

  The host owns nothing but the element: `editor.attach()` creates the one editor, and
  the document store decides which model it shows. `data-doc-id` mirrors the active
  document so the runtime harness can tell the documents apart.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { editor } from '$lib/monaco/editorService';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';

  const activeId = docs.activeId;

  let container = $state<HTMLElement | undefined>(undefined);
  let loadError = $state('');

  onMount(() => {
    if (!container) return;
    editor.attach(container).catch((err: unknown) => {
      console.error('Failed to load the Monaco editor', err);
      loadError = t('editor.loadFailed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
</script>

<div
  class="editor-wrapper"
  data-testid="editor-host"
  data-doc-id={$activeId ?? ''}
>
  <div class="editor-container" bind:this={container}></div>
  {#if loadError}
    <div class="editor-error" role="alert">{loadError}</div>
  {/if}
</div>

<style>
  .editor-wrapper {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background-color: var(--bg-app);
  }
  .editor-container {
    width: 100%;
    height: 100%;
  }
  .editor-error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: #f38ba8;
    font-size: 13px;
    text-align: center;
  }
</style>
