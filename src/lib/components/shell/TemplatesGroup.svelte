<!--
  The Insert tab's template buttons (Phase 3 plan §5 P3.5, AD-28). Owner: P3.5.

  A custom ribbon group, because the buttons follow the active program's own templates: its
  effective database and machine type decide which are offered, and "Tool start" is not the
  same text in a Fanuc lathe program under G-code system A and under B. The labels, groups and
  descriptions are the database's data (AD-14): shown as text, never translated.

  One block per template group: the `toolbar` templates as buttons, the rest in the group's
  "More templates…" list, with the group's name under it. A "Favorites" block first when the
  database has starred templates (those are shown as buttons wherever they come from, and are
  not repeated in their own group).

  Test ids: every button is the §7.9 `cmd-button` with `data-command="insert.template:<id>"`
  and, on a template the owner has not reviewed yet, `data-review="pending"`; a block is
  `template-group` (`data-group`: the group's name, or `favorites`), its list is `template-more`
  (`data-group`).
-->
<script lang="ts">
  import FilePlus from 'lucide-svelte/icons/file-plus';
  import { commands } from '$lib/app/registry/commands';
  import { asIcon } from '$lib/app/icons';
  import { templateGroups, templates } from '$lib/app/templateService';
  import { templateCommandId, TEMPLATE_TEST_IDS } from '$lib/core/templates';
  import type { TemplateDef } from '$lib/core/templates';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';
  import RibbonButton from './RibbonButton.svelte';

  const active = docs.active;
  const changed = templates.changed;
  const icon = asIcon(FilePlus);

  // The document's id is a primitive, so typing (which re-emits the document's metadata) does
  // not rebuild the groups; a profile or machine switch arrives through `templates.changed`.
  const docId = $derived($active?.id ?? null);

  const groups = $derived.by(() => {
    void $changed;
    if (docId === null) return [];
    const dialect = templates.dialectOf(docId);
    return templateGroups(templates.list(docId), dialect === null ? [] : templates.favorites(dialect));
  });

  function titleOf(tpl: TemplateDef): string {
    const parts = [tpl.description, tpl.review === 'pending' ? t('templates.reviewPendingShort') : undefined];
    return parts.filter(Boolean).join(' · ') || tpl.label;
  }

  function insert(id: string): void {
    void commands.run(templateCommandId(id));
  }

  function onMore(e: Event & { currentTarget: HTMLSelectElement }): void {
    const id = e.currentTarget.value;
    e.currentTarget.value = '';
    if (id) insert(id);
  }
</script>

{#each groups as group (group.favorites ? '*favorites' : group.key)}
  <div class="tgroup" data-testid="template-group" data-group={group.favorites ? 'favorites' : group.key}>
    <div class="tcontrols">
      {#each group.buttons as tpl (tpl.id)}
        <RibbonButton
          command={templateCommandId(tpl.id)}
          label={tpl.label}
          title={titleOf(tpl)}
          {icon}
          review={tpl.review}
          disabled={!commands.has(templateCommandId(tpl.id))}
          onclick={() => insert(tpl.id)}
        />
      {/each}
      {#if group.more.length > 0}
        <label class="more">
          <span class="sr-only">{t('templates.more')}</span>
          <select
            class="ribbon-select"
            data-testid={TEMPLATE_TEST_IDS.more}
            data-group={group.key}
            onchange={onMore}
          >
            <option value="" disabled selected>{t('templates.more')}</option>
            {#each group.more as tpl (tpl.id)}
              <option value={tpl.id} title={titleOf(tpl)} data-review={tpl.review}>{tpl.label}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
    <div class="tcaption">{group.favorites ? t('templates.favorites') : group.key}</div>
  </div>
{/each}

<style>
  .tgroup {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    min-width: 0;
    padding: 0 6px;
    border-left: 1px solid var(--border-color);
  }
  .tgroup:first-child {
    padding-left: 0;
    border-left: none;
  }

  .tcontrols {
    display: flex;
    flex: 1 1 auto;
    align-items: stretch;
  }

  .tcaption {
    padding-top: 2px;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 10px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .more {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    margin-left: 4px;
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
    width: 140px;
    padding: 4px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    background-color: var(--bg-app);
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: pointer;
  }
  .ribbon-select:hover {
    border-color: var(--text-muted);
  }
</style>
