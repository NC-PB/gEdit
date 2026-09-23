<!--
  The machine configuration of the active document (plan §7.12: `status-item` with
  `data-item="machine"`, AD-31 "Selection UI"). Registered by `contrib/machineSelect.ts`.

  Three things it has to get right:

    - **It is hidden for a dialect that has no machine parameters** (Klartext). Showing
      "Machine: none" there would suggest a setting that does not exist.
    - **"none" is marked assumed.** Without a machine every value below comes from what the
      dialect documents, not from the control on the shop floor (AD-31 "No machine, no
      guess"), and the tooltip names the source of each one.
    - It re-reads on `machines.revision`, which bumps for a changed set **and** for a
      changed choice of one document, so the item follows a machine that was renamed,
      removed or picked elsewhere.

  Machine names are data and stay untranslated (contrib README rule 3).
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { machineTooltip } from '$lib/core/machines/fields';
  import { docs } from '$lib/stores/documents';
  import { machines } from '$lib/stores/machines';
  import { profiles } from '$lib/stores/profiles';
  import { t } from '$lib/i18n';

  const active = docs.active;
  const revision = machines.revision;

  const view = $derived.by(() => {
    // Read the revision, so a machine change re-runs this even though the document did not.
    void $revision;
    const doc = $active;
    if (!doc) return null;
    if (profiles.get(doc.profileId)?.hasMachineParams !== true) return null;
    const eff = machines.effective(doc.id).machine;
    const profile = profiles.profile(doc.profileId);
    const assumed = eff.id === null;
    return {
      id: eff.id ?? '',
      choice: eff.choice,
      assumed,
      label: assumed ? t('machines.itemNone') : t('machines.item', { name: eff.name ?? '' }),
      // The dialect's own power-on state as well: without a machine it is every one of
      // those values, and it is the assumption that decides how an `F` is read (G8 M6).
      tooltip: machineTooltip(eff, profile.machineParams, profile.modal?.initial),
    };
  });
</script>

{#if view}
  <button
    class="item"
    type="button"
    title={view.tooltip}
    onclick={() => void commands.run('file.setMachine')}
    data-testid="status-item"
    data-item="machine"
    data-machine-id={view.id}
    data-choice={view.choice}
    data-assumed={view.assumed ? '1' : '0'}
  >
    {view.label}{#if view.assumed}<span class="assumed">&nbsp;({t('machines.assumed')})</span>{/if}
  </button>
{/if}

<style>
  .item {
    padding: 0 4px;
    color: inherit;
    font: inherit;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
  }
  .item:hover:enabled {
    background-color: rgb(255 255 255 / 20%);
  }
  .item:focus-visible {
    outline: 1px solid currentcolor;
    outline-offset: -1px;
  }
  .assumed {
    opacity: 0.75;
  }
</style>
