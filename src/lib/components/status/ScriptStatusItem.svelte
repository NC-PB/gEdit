<!--
  The running-script indicator (plan §5 WP5.2 "A running indicator in the status bar with
  Cancel", §7.9: `status-item` with `data-item="script"`). Owner: WP5.2.
  Registered by `contrib/scripts.ts`.

  It replaces `panels/ScriptStatus.svelte`, which I5 deletes with the rest of v1, and it
  keeps that component's two decisions because scenarios depend on them:

   - the element is **always in the DOM**, so `status-item[data-item="script"]` can be read
     before, during and after a run;
   - it is **empty while nothing runs** (hidden by `:empty`), so the status bar does not
     carry a permanent "no script running" slot.

  **Why the indicator is itself the Cancel control.** A long run has to be stoppable from
  wherever the user is looking, and the status bar is where they look to find out that
  something is still running. A second button beside the label would need a test id §7.9
  does not define, so the label *is* the button: it says what is running and how long for,
  its tooltip says that clicking stops it, and it runs `script.cancel` — the same command
  as the panel's Cancel, so there is one enablement rule and one status message.

  The elapsed time ticks once a second while a run is in flight and the interval is torn
  down as soon as it ends, so an idle window has no timer (WKWebView throttles them while
  hidden anyway, which only makes the reading late, never wrong: it is recomputed from
  `startedAt` and not accumulated).
-->
<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { scripts } from '$lib/app/scripts';
  import { scriptLabel } from '$lib/core/scripting/filter';
  import { t } from '$lib/i18n';

  const running = scripts.running;
  const list = scripts.list;

  let now = $state(Date.now());

  const label = $derived.by(() => {
    const run = $running;
    if (run === null) return '';
    const entry = $list.find((candidate) => candidate.id === run.scriptId);
    return entry ? scriptLabel(entry) : run.scriptId;
  });

  const elapsed = $derived($running === null ? 0 : Math.max(0, now - $running.startedAt));
  const text = $derived(
    $running === null
      ? ''
      : `${t('scripts.statusRunning', { script: label })} ${t('scripts.outputDuration', { seconds: (elapsed / 1000).toFixed(0) })}`,
  );

  $effect(() => {
    if ($running === null) return;
    now = Date.now();
    const ticker = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(ticker);
  });
</script>

<button
  class="script-status"
  type="button"
  disabled={$running === null}
  title={$running === null ? t('scripts.statusIdle') : t('scripts.cancelTooltip', { script: label })}
  onclick={() => void commands.run('script.cancel')}
  data-testid="status-item"
  data-item="script"
  data-running={$running === null ? '0' : '1'}
  data-script-id={$running?.scriptId ?? ''}>{text}</button
>

<style>
  .script-status {
    padding: 0 4px;
    color: inherit;
    font: inherit;
    font-style: italic;
    background: transparent;
    border: 0;
    border-radius: 2px;
    cursor: pointer;
  }
  /* Nothing is running: no label, no slot in the status bar. */
  .script-status:empty {
    display: none;
  }
  .script-status:hover:enabled {
    background-color: rgb(255 255 255 / 20%);
  }
  .script-status:disabled {
    cursor: default;
  }
  .script-status:focus-visible {
    outline: 1px solid currentcolor;
    outline-offset: -1px;
  }
</style>
