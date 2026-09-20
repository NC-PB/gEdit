<!--
  The whole window (plan AD-6, §5 WP1.5, §7.9). Owner: WP1.5.

  Top to bottom: ribbon, tab bar, a row with the left panel and the center, the bottom
  panel, the status bar. The center shows either the banner region plus the editor, or the
  overlay panel in its place (compare, M2). Exactly one ModalHost is mounted here.

  `src/routes/+page.svelte` renders this and nothing else. The shell starts the app in
  `onMount`: the children (EditorHost above all) have mounted by then, so `editor.ready`
  is already on its way and awaiting it cannot deadlock startup.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { appReady, startApp } from '$lib/app/bootstrap';
  import { panels } from '$lib/app/registry/panels';
  import { layout, SIZE_LIMITS } from '$lib/stores/layout';
  import { status } from '$lib/app/status';
  import { t } from '$lib/i18n';
  import ModalHost from '$lib/components/common/ModalHost.svelte';
  import EditorHost from '$lib/components/editor/EditorHost.svelte';
  import TabBar from '$lib/components/editor/TabBar.svelte';
  import PanelHost from './PanelHost.svelte';
  import Ribbon from './Ribbon.svelte';
  import Splitter from './Splitter.svelte';
  import StatusBar from './StatusBar.svelte';
  import type { Disposable } from '$lib/app/types';

  const all = panels.panels;
  const layoutState = layout.state;

  const banners = $derived($all.filter((panel) => panel.region === 'banner'));
  const hasLeft = $derived($all.some((panel) => panel.region === 'left'));
  const hasBottom = $derived($all.some((panel) => panel.region === 'bottom'));
  const overlay = $derived(
    $layoutState.overlay === null
      ? undefined
      : $all.find((panel) => panel.id === $layoutState.overlay && panel.region === 'overlay'),
  );

  const leftOpen = $derived(hasLeft && $layoutState.left.visible);
  const bottomOpen = $derived(hasBottom && $layoutState.bottom.visible);

  onMount(() => {
    let dispose: Disposable | undefined;
    let cancelled = false;
    startApp().then(
      (d) => {
        if (cancelled) d();
        else dispose = d;
      },
      (err: unknown) => {
        console.error('gEdit failed to start', err);
        status.show(t('shell.startFailed', { error: err instanceof Error ? err.message : String(err) }), {
          error: true,
          sticky: true,
        });
      },
    );
    return () => {
      cancelled = true;
      dispose?.();
    };
  });
</script>

<div class="app-shell" data-testid="app-shell" data-ready={$appReady ? '1' : '0'}>
  <Ribbon />
  <TabBar />

  <div class="body">
    {#if leftOpen}
      <div class="left-panel" style="width: {$layoutState.left.width}px">
        <PanelHost region="left" />
      </div>
      <Splitter
        orientation="vertical"
        label={t('shell.resizeSidePanel')}
        value={$layoutState.left.width}
        min={SIZE_LIMITS.left.min}
        max={SIZE_LIMITS.left.max}
        onresize={(px) => layout.setSize('left', px)}
      />
    {/if}

    <div class="center">
      {#if overlay}
        <PanelHost region="overlay" />
      {:else}
        {#each banners as banner (banner.id)}
          {@const Banner = banner.component}
          <Banner />
        {/each}
        <EditorHost />
      {/if}
    </div>
  </div>

  {#if bottomOpen}
    <Splitter
      orientation="horizontal"
      label={t('shell.resizeBottomPanel')}
      value={$layoutState.bottom.height}
      min={SIZE_LIMITS.bottom.min}
      max={SIZE_LIMITS.bottom.max}
      invert
      onresize={(px) => layout.setSize('bottom', px)}
    />
    <div class="bottom-panel" style="height: {$layoutState.bottom.height}px">
      <PanelHost region="bottom" />
    </div>
  {/if}

  <StatusBar />
  <ModalHost />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background-color: var(--bg-app);
    color: var(--text-main);
  }

  .body {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* The width comes from the layout store; the cap keeps a panel that was sized on a
     wider screen (or restored from an old ui.layout) from swallowing the editor. */
  .left-panel {
    display: flex;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 60%;
  }

  .center {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .bottom-panel {
    display: flex;
    flex: 0 1 auto;
    min-height: 0;
    max-height: 60%;
  }
</style>
