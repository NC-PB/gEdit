<!--
  The v1 script output, now a bottom-region panel (plan §5 WP1.5, §7.9). Owner: WP1.5.

  Intentional M1 behaviour change: the output moved from a right-hand drawer into the
  bottom panel. The test ids are unchanged - `output-panel` with `data-running`,
  `output-stdout`, `output-stderr`, `output-json` - so the M0 scenarios still find it.
  M5 replaces this panel together with the rest of the v1 script flow.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { scriptData, scriptRunning, scriptStderr, scriptStdout } from './scriptsV1State';

  const isDataObject = $derived(
    Array.isArray($scriptData)
      ? $scriptData.length > 0
      : $scriptData !== null && typeof $scriptData === 'object'
        ? Object.keys($scriptData).length > 0
        : false,
  );
  const json = $derived(isDataObject ? JSON.stringify($scriptData, null, 2) : '');
  // The v1 scripts print their JSON on stdout too; showing it twice is just noise.
  const showStdout = $derived($scriptStdout !== '' && $scriptStdout !== JSON.stringify($scriptData));
  const hasOutput = $derived(isDataObject || showStdout || $scriptStderr !== '');
</script>

<div class="output" data-testid="output-panel" data-running={$scriptRunning ? '1' : '0'}>
  {#if $scriptRunning}
    <p class="hint">{t('scripts.outputRunning')}</p>
  {:else if hasOutput}
    {#if isDataObject}
      <section class="block json">
        <h3 class="label">{t('scripts.labelJson')}</h3>
        <pre data-testid="output-json">{json}</pre>
      </section>
    {/if}
    {#if showStdout}
      <section class="block stdout">
        <h3 class="label">{t('scripts.labelStdout')}</h3>
        <pre data-testid="output-stdout">{$scriptStdout}</pre>
      </section>
    {/if}
    {#if $scriptStderr}
      <section class="block stderr">
        <h3 class="label">{t('scripts.labelStderr')}</h3>
        <pre data-testid="output-stderr">{$scriptStderr}</pre>
      </section>
    {/if}
  {:else}
    <p class="hint">{t('scripts.outputEmpty')}</p>
  {/if}
</div>

<style>
  .output {
    padding: 8px 12px;
  }

  .hint {
    margin: 8px 0;
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
  }

  .block {
    margin-bottom: 12px;
  }
  .block:last-child {
    margin-bottom: 0;
  }

  .label {
    margin: 0 0 4px;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.8;
  }

  pre {
    margin: 0;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    border-radius: 3px;
  }

  .stdout .label,
  .stdout pre {
    color: var(--success);
  }
  .json .label,
  .json pre {
    color: var(--info);
  }
  .json pre {
    background: var(--info-surface);
  }
  .stderr .label,
  .stderr pre {
    color: var(--danger-text);
  }
  .stderr pre {
    background: var(--danger-surface);
  }
</style>
