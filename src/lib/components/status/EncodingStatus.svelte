<!--
  The encoding of the active document (plan §7.9: `status-item` with
  `data-item="encoding"`). Registered by `contrib/encoding.ts`.

  A button, not a span: clicking it opens the encoding QuickPick, so it must be reachable
  with the keyboard too. The text is `encodingLabel()` ('UTF-8', 'UTF-8 BOM',
  'Windows-1252', 'UTF-16 LE', 'UTF-16 BE'), which the M0 runtime scenarios read.
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { encodingLabel } from '$lib/core/text';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';

  const active = docs.active;

  const label = $derived($active ? encodingLabel($active.encoding) : '');
</script>

<button
  class="item"
  type="button"
  disabled={!$active}
  title={t('encoding.encodingTooltip', { name: label })}
  onclick={() => void commands.run('file.setEncoding')}
  data-testid="status-item"
  data-item="encoding">{label}</button
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
