<!--
  The script status item (plan §7.9: `status-item` with `data-item="script"`).
  Owner: WP1.5.

  It lives beside the other v1 script components rather than in `components/status/`,
  which WP1.6 owns, and it disappears with the rest of the v1 flow in M5. The element is
  always in the DOM so a scenario can read it; it is empty while nothing has run.
-->
<script lang="ts">
  import { lastScript, scriptRunning } from './scriptsV1State';
  import { t } from '$lib/i18n';

  const label = $derived($scriptRunning ? t('scripts.statusRunning', { script: $lastScript }) : '');
</script>

<span
  class="script-status"
  class:running={$scriptRunning}
  title={$scriptRunning ? label : t('scripts.statusIdle')}
  data-testid="status-item"
  data-item="script"
  data-running={$scriptRunning ? '1' : '0'}>{label}</span
>

<style>
  .script-status:empty {
    display: none;
  }
  .running {
    font-style: italic;
  }
</style>
