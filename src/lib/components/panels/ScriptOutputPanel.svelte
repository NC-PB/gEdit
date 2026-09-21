<!--
  The Output panel, v2 (plan §5 WP5.2, §7.9: `output-panel` with `data-running`,
  `output-stdout`, `output-stderr`, `output-json`, `output-cancel`). Owner: **WP5.2**.

  This replaced the v1 panel in place: the test ids are a contract with the runtime
  harness (M0's `m0-main` reads `output-json`, `m1-layout` and `m1-smoke` look for
  `output-panel`), so the panel keeps them and only its source of truth changed — from
  `panels/scriptsV1State.ts` to `stores/scripts.ts`, whose only writer is
  `ScriptService`. I5 deleted the v1 state module.

  **What the panel is for.** Every run ends here, whatever its output mode: a run that
  replaced the program still has stderr worth reading, and a run that failed has *only*
  stderr. The panel is therefore the one place where a failure is visible in full, which
  is the fourth rule of the safety bar (`core/scripting/types.ts`) — the status bar carries
  the summary, this carries the evidence.

  **The panel never decides anything.** It shows what the run produced; whether any of it
  was applied was decided by `decideApply` before the panel saw it.

  **Cancel is always in the DOM** and disabled while nothing runs, so a scenario can find
  `output-cancel` before the run it is about to stop even exists. It goes through
  `script.cancel` rather than `ScriptService.cancel` directly, so the status message and
  the enablement rule are the command's, in one place.
-->
<script module lang="ts">
  import { jsonFromStdout } from '$lib/stores/scripts';

  /** An object or a non-empty array: the only shapes worth a "Structured result" section. */
  export function isStructured(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
  }

  /**
   * stdout parsed as JSON, or null.
   *
   * `ScriptOutput.json` is filled by the service and this is only the fallback for an
   * output set with none. It exists because `output-json` is an M0 seam: a script that
   * prints a JSON blob and has no header still runs in panel mode, and its structured
   * result has to keep showing up there.
   *
   * It delegates to `jsonFromStdout`, which is **the** rule, including its size cap — at
   * I5 this function was a second copy without one, so the panel re-parsed, on the UI
   * thread and on every render, the tens of megabytes the service had deliberately
   * skipped (a `replace` run's stdout is a program, not a result).
   */
  export function parseStructured(stdout: string): unknown {
    const value = jsonFromStdout(stdout);
    return isStructured(value) ? value : null;
  }

  /** Whether `stdout` is just `data` written out, in which case showing both is noise. */
  export function stdoutIsJson(stdout: string, data: unknown): boolean {
    if (data === null) return false;
    try {
      return JSON.stringify(JSON.parse(stdout.trim())) === JSON.stringify(data);
    } catch {
      return false;
    }
  }

  /** Seconds with one decimal, so a 40 ms run does not read as "0 s". */
  export function seconds(ms: number): string {
    return (Math.max(0, ms) / 1000).toFixed(1);
  }
</script>

<script lang="ts">
  import { commands } from '$lib/app/registry/commands';
  import { scripts } from '$lib/app/scripts';
  import { scriptLabel } from '$lib/core/scripting/filter';
  import { scriptOutput } from '$lib/stores/scripts';
  import { t } from '$lib/i18n';

  const running = scripts.running;
  const list = scripts.list;
  const output = scriptOutput;

  const isRunning = $derived($running !== null);
  // The running store carries the id; the name is the script's own (AD-14). A script that
  // has left the list since the run started falls back to its id rather than to nothing.
  const runningLabel = $derived.by(() => {
    const run = $running;
    if (run === null) return '';
    const entry = $list.find((candidate) => candidate.id === run.scriptId);
    return entry ? scriptLabel(entry) : run.scriptId;
  });

  const out = $derived($output);
  const data = $derived(out === null ? null : (out.json ?? parseStructured(out.stdout)));
  const hasJson = $derived(isStructured(data));
  const json = $derived(hasJson ? JSON.stringify(data, null, 2) : '');
  const showStdout = $derived(
    out !== null && out.stdout !== '' && !(hasJson && stdoutIsJson(out.stdout, data)),
  );
  const showStderr = $derived(out !== null && out.stderr !== '');
  const hasOutput = $derived(hasJson || showStdout || showStderr);

  // How much of each stream the store cut away (`MAX_OUTPUT_PREVIEW`). A `replace` run's
  // stdout is a whole program — up to the runner's 64 MiB cap — and a `<pre>` with
  // `white-space: pre-wrap` would lay every byte of it out on the UI thread.
  const stdoutCut = $derived(out === null ? 0 : out.stdoutLength - out.stdout.length);
  const stderrCut = $derived(out === null ? 0 : out.stderrLength - out.stderr.length);

  /** The outcome line: what ran, how it ended, how long it took and with which Python. */
  const flags = $derived.by(() => {
    if (out === null) return [];
    const parts: string[] = [];
    if (out.cancelled) parts.push(t('scripts.outputCancelled'));
    if (out.timedOut) parts.push(t('scripts.outputTimedOut'));
    if (out.stdoutTruncated) parts.push(t('scripts.outputTruncated'));
    parts.push(
      out.exitCode === null
        ? t('scripts.outputSignal')
        : t('scripts.outputExit', { code: out.exitCode }),
    );
    parts.push(t('scripts.outputDuration', { seconds: seconds(out.durationMs) }));
    return parts;
  });
</script>

<div class="output" data-testid="output-panel" data-running={isRunning ? '1' : '0'}>
  <header class="head">
    <p class="state" class:busy={isRunning} class:failed={!isRunning && out !== null && !out.success}>
      {#if isRunning}
        {t('scripts.outputRunningNamed', { script: runningLabel })}
      {:else if out !== null}
        <span class="name">{out.scriptName}</span>
        <span class="flags">{flags.join(' · ')}</span>
      {:else}
        {t('scripts.outputHint')}
      {/if}
    </p>
    <button
      type="button"
      class="cancel"
      data-testid="output-cancel"
      disabled={!isRunning}
      title={t('scripts.outputCancel')}
      onclick={() => void commands.run('script.cancel')}>{t('scripts.outputCancel')}</button
    >
  </header>

  {#if !isRunning && out !== null}
    <p class="interpreter" title={out.interpreter}>
      {t('scripts.outputInterpreter', { interpreter: out.interpreter })}
    </p>
  {/if}

  {#if isRunning}
    <p class="hint">{t('scripts.outputRunning')}</p>
  {:else if hasOutput}
    {#if hasJson}
      <section class="block json">
        <h3 class="label">{t('scripts.labelJson')}</h3>
        <pre data-testid="output-json">{json}</pre>
      </section>
    {/if}
    {#if showStdout}
      <section class="block stdout">
        <h3 class="label">{t('scripts.labelStdout')}</h3>
        <pre data-testid="output-stdout">{out?.stdout ?? ''}</pre>
        {#if stdoutCut > 0}
          <p class="cut">{t('scripts.outputCut', { count: stdoutCut })}</p>
        {/if}
      </section>
    {/if}
    {#if showStderr}
      <section class="block stderr">
        <h3 class="label">{t('scripts.labelStderr')}</h3>
        <pre data-testid="output-stderr">{out?.stderr ?? ''}</pre>
        {#if stderrCut > 0}
          <p class="cut">{t('scripts.outputCut', { count: stderrCut })}</p>
        {/if}
      </section>
    {/if}
  {:else if out !== null}
    <p class="hint">{t('scripts.outputNoStdout')}</p>
  {:else}
    <p class="hint">{t('scripts.outputEmpty')}</p>
  {/if}
</div>

<style>
  .output {
    padding: 8px 12px;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .state {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
    margin: 0;
    color: var(--text-muted);
    font-size: 11px;
  }
  .state.busy {
    color: var(--info);
    font-style: italic;
  }
  .state.failed .name {
    color: var(--danger-text);
  }

  .name {
    color: var(--text-main);
    font-weight: 700;
  }

  .flags {
    font-family: var(--font-mono);
  }

  .cancel {
    flex: 0 0 auto;
    padding: 2px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    cursor: pointer;
  }
  .cancel:hover:not(:disabled) {
    background-color: var(--surface-hover);
  }
  .cancel:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  .interpreter {
    margin: 2px 0 0;
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .hint {
    margin: 8px 0;
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
  }

  .cut {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    font-style: italic;
  }

  .block {
    margin-top: 12px;
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
