<!--
  The dialect of the active document (plan §7.9: `status-item` with `data-item="profile"`).
  Registered by `contrib/profileSelect.ts`.

  This is the M1 replacement for the M0 `profile-select` dropdown in the ribbon, which is
  one of the three intentional behaviour changes of this milestone. The text is the
  profile's short name ('Fanuc', 'Heidenhain'), which is data and stays untranslated.
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { docs } from '$lib/stores/documents';
  import { profiles } from '$lib/stores/profiles';
  import { t } from '$lib/i18n';

  const active = docs.active;

  const name = $derived($active ? (profiles.get($active.profileId)?.shortName ?? $active.profileId) : '');
  // M12.5: a dialect that was only a guess is shown with a question mark.
  const uncertain = $derived($active?.dialectUncertain === true);
  const label = $derived(uncertain ? t('profiles.uncertain.label', { name }) : name);
  const tooltip = $derived(
    uncertain ? t('profiles.uncertain.tooltip', { name }) : t('profiles.tooltip', { name }),
  );
</script>

<button
  class="item"
  type="button"
  disabled={!$active}
  title={tooltip}
  onclick={() => void commands.run('file.setProfile')}
  data-testid="status-item"
  data-item="profile"
  data-uncertain={uncertain ? 'true' : undefined}>{label}</button
>

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
  .item:disabled {
    cursor: default;
  }
  .item:focus-visible {
    outline: 1px solid currentcolor;
    outline-offset: -1px;
  }
</style>
