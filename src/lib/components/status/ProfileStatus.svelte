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

  const label = $derived($active ? (profiles.get($active.profileId)?.shortName ?? $active.profileId) : '');
</script>

<button
  class="item"
  type="button"
  disabled={!$active}
  title={t('profiles.tooltip', { name: label })}
  onclick={() => void commands.run('file.setProfile')}
  data-testid="status-item"
  data-item="profile">{label}</button
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
