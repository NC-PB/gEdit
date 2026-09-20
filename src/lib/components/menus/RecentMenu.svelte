<!--
  The Home tab's "Recent" dropdown (plan §5 WP2.3). Owner: WP2.3.

  A custom ribbon group, because its content is data rather than commands: the entries
  come from Rust and change on every open and save. File names are data and stay
  untranslated (AD-14); everything around them goes through `t()`.

  A `<select>`, like the Insert tab's "more blocks" control: it is one tab stop, works
  with the keyboard on every platform, and needs no click-outside or focus trap. Missing
  entries are marked in their label, and the last option clears the list.

  The commands behind the two special entries are `contrib/recent.ts`'s, so the picker
  (`file.openRecent`) and Clear behave the same wherever they are started from.
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { recent } from '$lib/stores/recent';
  import { baseName } from '$lib/utils/platform';
  import { t } from '$lib/i18n';

  /** The option that is an action rather than a path. Recent entries are absolute paths, so this can never collide with one. */
  const CLEAR = 'gedit:clear-recent';

  const list = recent.list;

  let choice = $state('');

  function labelOf(entry: { path: string; exists: boolean }): string {
    const name = baseName(entry.path);
    return entry.exists ? name : t('recent.missingLabel', { name });
  }

  /**
   * `exists` is only as fresh as the last `recent_list`, and that runs at startup. A file
   * deleted while the app ran would otherwise still be offered without its "(not found)"
   * label, so the list is re-read as the control takes the focus — before the popup opens
   * (G8 M2). `file.openRecent` re-reads it again before it decides.
   */
  function onFocus(): void {
    void recent.refresh();
  }

  function onChange(e: Event & { currentTarget: HTMLSelectElement }): void {
    const value = e.currentTarget.value;
    choice = '';
    if (value === '') return;
    // Both go through the registry, so a pick takes the same lock — and runs the same
    // "the file is gone, remove it?" question — as the palette's Open Recent.
    void commands.run(value === CLEAR ? 'file.clearRecent' : 'file.openRecent', value === CLEAR ? undefined : value);
  }
</script>

<label class="recent-menu" data-testid="recent-menu">
  <span class="sr-only">{t('recent.menuLabel')}</span>
  <select
    class="ribbon-select"
    title={t('recent.menuLabel')}
    bind:value={choice}
    onfocus={onFocus}
    onchange={onChange}
    disabled={$list.length === 0}
  >
    <option value="" disabled selected>{t('recent.menuPlaceholder')}</option>
    {#each $list as entry (entry.path)}
      <option value={entry.path} title={entry.path}>{labelOf(entry)}</option>
    {/each}
    {#if $list.length > 0}
      <option value={CLEAR}>{t('recent.clearItem')}</option>
    {/if}
  </select>
</label>

<style>
  .recent-menu {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .ribbon-select {
    width: 150px;
    padding: 4px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    background-color: var(--bg-app);
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: pointer;
  }
  .ribbon-select:hover:not(:disabled) {
    border-color: var(--text-muted);
  }
  .ribbon-select:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
