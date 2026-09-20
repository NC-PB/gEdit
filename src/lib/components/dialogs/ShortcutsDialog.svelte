<!--
  The keyboard shortcut reference (plan §5 WP2.4). Owner: WP2.4.

  Every registered command with the shortcut it has on *this* platform, grouped by the
  command category and filterable. Opened by `help.shortcuts` through `modals.open`, so it
  is rendered inside ModalHost and never mounted directly.

  `shortcutRows` and `groupRows` are pure and live in the module script, so the ordering
  and the grouping are unit tested without a DOM (ShortcutsDialog.test.ts).
-->
<script module lang="ts">
  import { formatKey, resolveKeys } from '$lib/core/keys/keySpec';
  import type { CommandDef } from '$lib/app/types';

  /** One command in the table. `title` and `category` are i18n keys, `keys` is display text. */
  export interface ShortcutRow {
    id: string;
    /** i18n key of the command title. */
    title: string;
    /** i18n key of the command category, or undefined when the command has none. */
    category?: string;
    /** The platform label of the shortcut ('⇧⌘S', 'Ctrl+Shift+S'), or undefined. */
    keys?: string;
  }

  /** Rows that share one heading. */
  export interface ShortcutGroup {
    /** Already translated, because two category keys can carry the same label. */
    label: string;
    rows: ShortcutRow[];
  }

  /** Locale-independent, so the order is the same on every machine. */
  function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /**
   * Every command as one row, sorted by category key and then by command id. Commands
   * without a category sort last. A command whose key spec does not parse is listed
   * without a shortcut instead of throwing: `commands.register` already reported it.
   */
  export function shortcutRows(defs: readonly CommandDef[], isMac: boolean): ShortcutRow[] {
    const rows = defs.map((def) => {
      const spec = resolveKeys(def.keys, isMac);
      let keys: string | undefined;
      if (spec) {
        try {
          keys = formatKey(spec, isMac);
        } catch {
          keys = undefined;
        }
      }
      const row: ShortcutRow = { id: def.id, title: def.title, keys };
      if (def.category) row.category = def.category;
      return row;
    });
    return rows.sort(
      (a, b) =>
        compareStrings(a.category ?? '￿', b.category ?? '￿') || compareStrings(a.id, b.id),
    );
  }

  /**
   * The rows grouped under their translated heading, sorted by heading. Two category keys
   * with the same label (for example 'core.categoryView' and 'view.category') become one
   * group. The rows without a category end up last, whatever their heading is.
   */
  export function groupRows(
    rows: readonly ShortcutRow[],
    labelOf: (row: ShortcutRow) => string,
  ): ShortcutGroup[] {
    const groups = new Map<string, { group: ShortcutGroup; uncategorized: boolean }>();
    for (const row of rows) {
      const label = labelOf(row);
      let entry = groups.get(label);
      if (!entry) {
        entry = { group: { label, rows: [] }, uncategorized: true };
        groups.set(label, entry);
      }
      if (row.category) entry.uncategorized = false;
      entry.group.rows.push(row);
    }
    return [...groups.values()]
      .sort(
        (a, b) =>
          Number(a.uncategorized) - Number(b.uncategorized) ||
          compareStrings(a.group.label, b.group.label),
      )
      .map((entry) => entry.group);
  }
</script>

<script lang="ts">
  import Modal from '$lib/components/common/Modal.svelte';
  import { commands } from '$lib/app/registry/commands';
  import { t } from '$lib/i18n';
  import { isMacPlatform } from '$lib/utils/platform';

  interface Props {
    /** Supplied by ModalHost; the dialog only ever closes. */
    close: (value?: unknown) => void;
  }

  let { close }: Props = $props();

  let query = $state('');
  let input = $state<HTMLInputElement | undefined>(undefined);

  // The registry does not change while a modal is open, so one snapshot is enough.
  const rows = shortcutRows(commands.list(), isMacPlatform());

  function labelOf(row: ShortcutRow): string {
    return row.category ? t(row.category) : t('help.otherGroup');
  }

  /** Case-insensitive substring match over the heading, the title, the id and the keys. */
  function haystack(row: ShortcutRow): string {
    return `${labelOf(row)}\n${t(row.title)}\n${row.id}\n${row.keys ?? ''}`.toLowerCase();
  }

  const needle = $derived(query.trim().toLowerCase());
  const matching = $derived(needle ? rows.filter((row) => haystack(row).includes(needle)) : rows);
  const groups = $derived(groupRows(matching, labelOf));

  $effect(() => {
    input?.focus();
  });
</script>

<Modal id="shortcuts" title={t('help.shortcutsTitle')} hideOk cancelLabel={t('common.close')} onCancel={() => close()}>
  <div class="shortcuts">
    <label class="filter" for="shortcuts-filter">{t('help.filter')}</label>
    <input
      bind:this={input}
      id="shortcuts-filter"
      class="filter-input"
      data-testid="shortcuts-filter"
      type="text"
      autocomplete="off"
      spellcheck="false"
      placeholder={t('help.filterPlaceholder')}
      bind:value={query}
    />

    <p class="hint">
      {t('help.platformHint')}
      {t('help.commands', { count: matching.length })}
    </p>

    <div class="list">
      {#each groups as group (group.label)}
        <section data-testid="shortcuts-group" data-group={group.label}>
          <h3>{group.label}</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('help.columnCommand')}</th>
                <th scope="col" class="keys">{t('help.columnShortcut')}</th>
              </tr>
            </thead>
            <tbody>
              {#each group.rows as row (row.id)}
                <tr data-testid="shortcuts-row" data-command={row.id} data-keys={row.keys}>
                  <td>{t(row.title)}</td>
                  <td class="keys">
                    {#if row.keys}<kbd>{row.keys}</kbd>{:else}<span class="none">{t('help.noShortcut')}</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/each}
      {#if groups.length === 0}
        <p class="empty" data-testid="shortcuts-empty">{t('help.noMatches')}</p>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .shortcuts {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .filter {
    margin-bottom: 4px;
    color: var(--text-muted, #808080);
    font-size: 12px;
  }

  .filter-input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-color, #3e3e42);
    border-radius: 3px;
    background: var(--bg-app, #1e1e1e);
    color: var(--text-main, #cccccc);
    font: inherit;
    font-size: 13px;
  }

  .filter-input:focus {
    border-color: var(--accent, #0078d4);
    outline: none;
  }

  .hint {
    margin: 6px 0;
    color: var(--text-muted, #808080);
    font-size: 12px;
  }

  .list {
    max-height: 46vh;
    overflow-y: auto;
  }

  h3 {
    position: sticky;
    top: 0;
    margin: 0;
    padding: 6px 0 4px;
    background: var(--bg-panel, #252526);
    color: var(--text-active, #ffffff);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    padding: 2px 6px;
    color: var(--text-muted, #808080);
    font-weight: 400;
    font-size: 11px;
    text-align: left;
  }

  td {
    padding: 3px 6px;
    border-top: 1px solid var(--border-color, #3e3e42);
    color: var(--text-main, #cccccc);
  }

  .keys {
    width: 34%;
    text-align: right;
  }

  kbd {
    padding: 1px 5px;
    border: 1px solid var(--border-color, #3e3e42);
    border-radius: 3px;
    background: var(--bg-app, #1e1e1e);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    white-space: nowrap;
  }

  .none {
    color: var(--text-disabled, #5a5a5a);
  }

  .empty {
    margin: 0;
    padding: 12px 6px;
    color: var(--text-muted, #808080);
    font-size: 13px;
  }
</style>
