<!--
  The line ending of the active document (plan §7.9: `status-item` with `data-item="eol"`).
  Registered by `contrib/encoding.ts`.

  A file that arrived with more than one kind of line break reads "CRLF (mixed)" until it
  is saved once, which is when the whole file takes the majority ending (AD-7).
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { EOL_LABELS } from '$lib/app/fileOps';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';

  const active = docs.active;

  const label = $derived.by(() => {
    if (!$active) return '';
    const name = EOL_LABELS[$active.eol];
    return $active.eolMixedOnLoad ? t('encoding.mixed', { eol: name }) : name;
  });
</script>

<button
  class="item"
  type="button"
  disabled={!$active}
  title={t('encoding.eolTooltip', { name: label })}
  onclick={() => void commands.run('file.setEol')}
  data-testid="status-item"
  data-item="eol">{label}</button
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
