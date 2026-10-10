<!--
  The script lists of the ribbon (plan §5 WP5.2, §7.9: `scripts-group`, `script-item` with
  `data-script-id`). Owner: WP5.2. Registered by `contrib/scripts.ts`.

  **Two lists, one component (B1 A9).** `scope="bundled"` is the Tools tab's list of the
  scripts that ship with gEdit (program checks, scale feed, tool list, ...); `scope="own"`
  is the Scripts tab's list of the user's own scripts (the user folder and any folder added
  by hand). `scope="all"` (the default) is both, as before. `BundledScriptsMenu.svelte` and
  `OwnScriptsMenu.svelte` are the two registrations, because a ribbon group component takes
  no props.

  A custom ribbon group, because its content is data rather than commands: the scripts
  come from `scripts_list` and change with every rescan, every new script and every folder
  the user adds.

  **Buttons, not a `<select>`.** `RecentMenu` can be a dropdown because every entry does
  the same thing to a different path; here each entry is a *different program* with its own
  description, its own dialect and its own enablement, and §7.9 pins `script-item` as the
  thing a scenario clicks. A `<option>` cannot carry any of that, so the group is a
  wrapping row of real buttons, grouped by the one subfolder level `ScriptEntry.group`
  gives (which is what "grouped by folder" means in the plan).

  Script names, descriptions and folder names are **data and stay untranslated** (AD-14);
  everything around them goes through `t()`.

  **The four empty states are different questions and get different answers:**

   1. Python has not been probed yet (`python === null`) — say nothing. The probe is fired
      detached after the first render, so a "not found" here would be a lie for a few
      hundred milliseconds at every start.
   2. Python is missing (`ok: false`) — the notice, with the interpreter's own English
      message as the tooltip. Every run button is off; the Manage group still works,
      because adding a folder or writing a script needs no interpreter.
   3. The folders could not be read (`scriptListError`) — that text, not "no scripts".
   4. There are scripts, but none for this dialect — say *that*, because "no scripts found"
      would send the user looking for a folder problem they do not have.
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { scripts } from '$lib/app/scripts';
  import { groupScripts, scriptLabel, scriptsForProfile } from '$lib/core/scripting/filter';
  import { docs } from '$lib/stores/documents';
  import { scriptListError } from '$lib/stores/scripts';
  import { t } from '$lib/i18n';
  import type { ScriptEntry } from '$lib/platform/commands';

  type Scope = 'all' | 'bundled' | 'own';
  let { scope = 'all' }: { scope?: Scope } = $props();

  /** Whether `entry` belongs on this list: a script of the `bundled` root, or any other. */
  function inScope(entry: ScriptEntry, scope: Scope): boolean {
    if (scope === 'all') return true;
    return (entry.root === 'bundled') === (scope === 'bundled');
  }

  const list = scripts.list;
  const python = scripts.python;
  const active = docs.active;
  const changed = commands.changed;

  const profileId = $derived($active?.profileId ?? null);

  // The empty list is short-circuited rather than filtered: there is nothing to decide,
  // and it keeps the group renderable while `core/scripting/filter.ts` is still the P5
  // stub on this branch (WP5.1 implements it).
  const mine = $derived($list.filter((entry) => inScope(entry, scope)));
  const offered = $derived(mine.length === 0 ? [] : scriptsForProfile(mine, profileId));
  const groups = $derived(offered.length === 0 ? [] : groupScripts(offered));

  const pythonMissing = $derived($python !== null && !$python.ok);
  const hasScripts = $derived(mine.some((entry) => !entry.shadowed));

  function commandId(entry: ScriptEntry): string {
    return `script.run:${entry.id}`;
  }

  /**
   * The tooltip: the script's description when it has one, the plain name when it does
   * not, and the header problem when Rust could not read one — a script whose header is
   * broken still runs, but in output mode, and the operator should know that before the
   * result does not land where they expected.
   */
  function tooltipOf(entry: ScriptEntry): string {
    const label = scriptLabel(entry);
    if (entry.headerError !== null) return t('scripts.headerProblem', { script: label });
    const description = entry.meta?.description ?? '';
    return description === '' ? label : t('scripts.scriptTooltip', { script: label, description });
  }

  /**
   * Enablement comes from the registry, not from a second copy of the rules: the button
   * and the palette entry for the same script are then never in disagreement.
   * `commands.changed` is what re-reads it.
   */
  function enabledOf(entry: ScriptEntry): boolean {
    void $changed;
    return commands.isEnabled(commandId(entry));
  }
</script>

<div class="scripts-menu" data-testid="scripts-menu" aria-label={t('scripts.menuLabel')}>
  {#if pythonMissing}
    <p class="notice" title={$python?.message ?? ''}>{t('scripts.pythonMissing')}</p>
  {:else if $scriptListError !== null}
    <p class="notice" title={$scriptListError}>{t('scripts.rescanFailed')}</p>
  {:else if groups.length === 0}
    {#if hasScripts}
      <p class="hint">{t('scripts.noneForProfile')}</p>
    {:else if scope === 'own'}
      <p class="hint">{t('scripts.noneOwn')}</p>
    {:else if scope === 'all'}
      <p class="hint">{t('scripts.noneAtAll')}</p>
    {/if}
  {:else}
    {#each groups as group (group.group ?? '')}
      <div class="group" data-testid="scripts-group" data-group={group.group ?? ''}>
        {#if group.group !== null || groups.length > 1 || scope === 'all'}
          <span class="caption">{group.group ?? t('scripts.ungrouped')}</span>
        {/if}
        <div class="items">
          {#each group.scripts as entry (entry.id)}
            <button
              type="button"
              class="item"
              data-testid="script-item"
              data-script-id={entry.id}
              data-command={commandId(entry)}
              title={tooltipOf(entry)}
              disabled={!enabledOf(entry)}
              onclick={() => void commands.run(commandId(entry))}
            >
              {scriptLabel(entry)}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .scripts-menu {
    display: flex;
    flex: 0 1 auto;
    gap: 10px;
    align-items: stretch;
    max-width: 480px;
    overflow-x: auto;
    padding: 0 4px;
  }

  .notice,
  .hint {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    max-width: 260px;
    margin: 0;
    padding: 0 8px;
    font-size: 11px;
    font-style: italic;
  }
  .notice {
    color: var(--warning);
  }
  .hint {
    color: var(--text-muted);
  }

  .group {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: 2px;
    justify-content: center;
  }

  .caption {
    color: var(--text-muted);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .items {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    max-width: 240px;
  }

  .item {
    max-width: 150px;
    overflow: hidden;
    padding: 2px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
    text-overflow: ellipsis;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: pointer;
  }
  .item:hover:not(:disabled) {
    background-color: var(--surface-hover);
    border-color: var(--surface-hover-border);
  }
  .item:active:not(:disabled) {
    background-color: var(--surface-active);
  }
  .item:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
</style>
