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
  import { groupsOf, TAB_LABEL, tabsOf } from './ribbonModel';
  import type { CommandDef, RibbonItemDef, RibbonTab } from '$lib/app/types';

  const entries = ribbon.entries;
  const changed = commands.changed;
  const isMac = isMacPlatform();

  let activeTab = $state<RibbonTab>('home');

  const tabs = $derived(tabsOf($entries));
  // A tab can disappear when its contribution is disposed (HMR, tests).
  const currentTab = $derived(tabs.includes(activeTab) ? activeTab : (tabs[0] ?? 'home'));

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
  <div class="app-header">
    <span class="app-title">{t('shell.workspace')}</span>
  </div>

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

  .app-header {
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    background-color: var(--bg-app);
  }
  .app-title {
    color: var(--text-muted);
    font-size: 11px;
  }

  .ribbon-tabs {
    display: flex;
    padding: 4px 12px 0;
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

  /* 1366x768: the body scrolls instead of squeezing the buttons (plan AD-6). */
  .ribbon-body {
    display: flex;
    align-items: stretch;
    min-height: 84px;
    padding: 4px 8px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  .ribbon-group {
    display: flex;
    position: relative;
    flex: 0 0 auto;
    flex-direction: column;
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
