<!--
  The active document's name in the status bar (plan §7.9: `status-item` with
  `data-item="file"`). Registered by `contrib/files.ts`.

  Props-free, like every other status item: it reads `docs` directly, so the shell only
  has to place what `statusItems` hands it. The text keeps the M0 shape
  "program.nc ● Modified"; the full path is the tooltip.
-->
<script lang="ts">
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';

  const active = docs.active;

  // `contrib/files.ts` always keeps one document open, so `No document` is only the
  // state between the first paint and `activate()`. It beats an empty status bar, and
  // it is what the M1 harness reads (I2: this item used to be hard-coded in StatusBar).
  const label = $derived(
    $active === null
      ? t('files.noDocument')
      : `${$active.title}${$active.dirty ? ` ● ${t('files.modified')}` : ''}`,
  );
</script>

<span
  class="file"
  title={$active?.path ?? $active?.title ?? t('files.noDocument')}
  data-testid="status-item"
  data-item="file">{label}</span>

<style>
  .file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 30ch;
  }
</style>
