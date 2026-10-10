<!--
  The ribbon, built from the registries (plan §5 WP1.5, §7.1, §7.9). Owner: WP1.5.

  Nothing about a feature is known here: tabs, groups and buttons all come from
  `ribbon.entries` and `commands`, so adding a feature never touches this file (AD-3).
  Enablement is re-read whenever `commands.changed` bumps, which happens on every
  (un)registration and on every context change.

  Test ids: `ribbon`, `ribbon-tab` (`data-tab`, `aria-selected`), and `cmd-button`
  (`data-command`, `disabled`) from RibbonButton.
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { ribbon } from '$lib/app/registry/ribbon';
  import { formatKey, resolveKeys } from '$lib/core/keys/keySpec';
  import { t } from '$lib/i18n';
  import { isMacPlatform } from '$lib/utils/platform';
  import RibbonButton from './RibbonButton.svelte';
  import { groupsOf, resolveTab, TAB_LABEL, tabsOf } from './ribbonModel';
  import type { CommandDef, RibbonItemDef, RibbonTab } from '$lib/app/types';

  const entries = ribbon.entries;
  const changed = commands.changed;
  const isMac = isMacPlatform();

  let activeTab = $state<RibbonTab>('file');

  const tabs = $derived(tabsOf($entries));
  // A tab can disappear when its contribution is disposed (HMR, tests), and a retired id
  // ('home') falls back to the File tab.
  const currentTab = $derived(resolveTab(activeTab, tabs));

  interface Button {
    item: RibbonItemDef;
    def: CommandDef | undefined;
    label: string;
    title: string;
    enabled: boolean;
  }

  /** Tooltip: the command title plus its shortcut in the platform's notation. */
  function tooltipOf(def: CommandDef): string {
    const spec = resolveKeys(def.keys, isMac);
    const label = t(def.title);
    return spec ? `${label} (${formatKey(spec, isMac)})` : label;
  }

  const groups = $derived.by(() => {
    // `changed` bumps on every (un)registration and context change; reading it here is
    // what re-evaluates the labels and the disabled state.
    void $changed;
    return groupsOf($entries, currentTab).map((group) => ({
      key: group.key,
      customs: group.customs,
      buttons: group.items.map((item): Button => {
        const def = commands.get(item.command);
        return {
          item,
          def,
          label: def ? t(def.title) : item.command,
          title: def ? tooltipOf(def) : item.command,
          enabled: commands.isEnabled(item.command),
        };
      }),
    }));
  });

  /** ARIA tab pattern: the strip is one tab stop and the arrows move and select inside it. */
  function onTabKey(e: KeyboardEvent & { currentTarget: HTMLElement }, index: number): void {
    const targets: Record<string, number> = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = targets[e.key];
    if (next === undefined) return;
    e.preventDefault();
    activeTab = tabs[next];
    const sibling = e.currentTarget.parentElement?.children[next];
    if (sibling instanceof HTMLElement) sibling.focus();
  }
</script>

<div class="ribbon" data-testid="ribbon">
  <div class="ribbon-tabs" role="tablist" aria-label={t('shell.ribbonTabs')}>
    {#each tabs as tab, i (tab)}
      <button
        id="ribbon-tab-{tab}"
        type="button"
        class="ribbon-tab"
        class:active={tab === currentTab}
        role="tab"
        tabindex={tab === currentTab ? 0 : -1}
        aria-selected={tab === currentTab}
        aria-controls="ribbon-panel"
        data-testid="ribbon-tab"
        data-tab={tab}
        onclick={() => (activeTab = tab)}
        onkeydown={(e) => onTabKey(e, i)}
      >{t(TAB_LABEL[tab])}</button>
    {/each}
  </div>

  <div
    class="ribbon-body"
    id="ribbon-panel"
    role="tabpanel"
    aria-labelledby="ribbon-tab-{currentTab}"
  >
    {#each groups as group (group.key)}
      <div class="ribbon-group">
        <div class="group-controls">
          {#each group.buttons as button (button.item.command)}
            <RibbonButton
              command={button.item.command}
              label={button.label}
              title={button.title}
              icon={button.def?.icon}
              disabled={!button.enabled}
              onclick={() => void commands.run(button.item.command)}
            />
          {/each}
          {#each group.customs as custom, i (custom.group + i)}
            {@const Group = custom.component}
            <Group />
          {/each}
        </div>
        <div class="group-label">{t(group.key)}</div>
      </div>
    {/each}
  </div>
</div>

<style>
  .ribbon {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--border-color);
    user-select: none;
  }

  .ribbon-tabs {
    display: flex;
    padding: 6px 12px 0;
    overflow-x: auto;
    background-color: var(--bg-app);
    scrollbar-width: none;
  }

  .ribbon-tab {
    flex: 0 0 auto;
    margin-right: 2px;
    margin-bottom: -1px;
    padding: 4px 16px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    text-transform: uppercase;
    background: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    cursor: pointer;
  }
  .ribbon-tab:hover:not(.active) {
    background-color: var(--surface-hover);
  }
  .ribbon-tab.active {
    color: var(--text-active);
    background-color: var(--bg-ribbon);
    border-color: var(--border-color);
  }

  /* 1366x768: the body scrolls instead of squeezing the buttons (plan AD-6).

     The scrollbar has to take its own room below the group labels and never lie over
     them, on every tab and at every width. Three rules carry that, and a test pins them:

     1. A styled `::-webkit-scrollbar` (never an overlay, in WebKit and in Chromium/WebView2)
        sets the height; `scrollbar-width` is deliberately left alone, because Chromium
        lets it win over the styled one and a thin native scrollbar is an overlay on macOS.
     2. `overflow-x: scroll`, not `auto`: the bar is part of the box from the first layout
        on. With `auto` it appears only once the row overflows, and on a tab whose height
        was settled before that (the File tab, the first one drawn after the window was
        narrowed) the bar was cut out of the box and lay over the label row (B1 round).
        The track is invisible, so a window that is wide enough shows an empty strip only.
     3. No `min-height` on the row itself: it counts the bar and the padding in, and then
        the content got what was left. The groups carry their own minimum height instead,
        so the row is always the tallest group plus the padding plus the bar. */
  .ribbon-body {
    display: flex;
    align-items: stretch;
    padding: 4px 8px;
    overflow-x: scroll;
    overflow-y: hidden;
  }
  .ribbon-body::-webkit-scrollbar {
    height: 10px;
  }
  .ribbon-body::-webkit-scrollbar-track {
    background: transparent;
  }
  .ribbon-body::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 5px;
  }
  .ribbon-body::-webkit-scrollbar-thumb:hover {
    background: var(--text-muted);
  }
  /* A browser without the styled scrollbar: the standard thin one, which leaves room. */
  @supports not selector(::-webkit-scrollbar) {
    .ribbon-body {
      scrollbar-width: thin;
    }
  }

  .ribbon-group {
    display: flex;
    position: relative;
    flex: 0 0 auto;
    flex-direction: column;
    min-height: 72px;
    padding: 0 8px;
    border-right: 1px solid var(--border-color);
  }
  .ribbon-group:last-child {
    border-right: none;
  }

  .group-controls {
    display: flex;
    flex: 1 1 auto;
    align-items: stretch;
    gap: 2px;
  }

  .group-label {
    flex: 0 0 auto;
    padding-top: 2px;
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
  }
</style>
