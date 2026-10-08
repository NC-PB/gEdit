<!--
  The channel tester (plan §6 M12 WP12.3; built by I12): try the channel settings on a program
  before saving them. Paste a program, or take the active document, and the table shows what
  the settings make of it: each channel with how many sections it has and which lines, the
  lines that belong to no channel, the wait codes found with the channels they name, the
  problems, and how long each wait rule took (a warning above 50 ms).

  It renders inline under the Channels step (no nested modal: the Settings dialog is the open
  modal) and runs `core/channels/tester.ts`, the app's own pure functions. Nothing is written.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import { SLOW_RULE_MS, testChannelRules } from '$lib/core/channels/tester';
  import { capRows, createDebouncedRun } from './testerRun';
  import type { ChannelParams } from '$lib/core/channels/types';
  import type { CompiledProfile } from '$lib/core/profiles/types';

  interface Props {
    /** The block being edited (already valid). */
    params: ChannelParams;
    /** The dialect's own compiled profile. */
    cp: CompiledProfile;
    /** "Take the active document": its text and base file name, or null when none is open. */
    takeDocument?: () => { name: string; text: string } | null;
  }

  let { params, cp, takeDocument }: Props = $props();

  let open = $state(false);
  let text = $state('');
  let fileName = $state('');
  let note = $state('');

  // The user's patterns run on an idle timer, not on every keystroke, and never on a closed tester.
  let ran = $state<ReturnType<typeof testChannelRules> | null>(null);
  const report = $derived(ran);
  const runner = createDebouncedRun(
    (a: { text: string; fileName: string }) => {
      ran = testChannelRules(a.text, a.fileName, cp, params);
    },
    (fn, ms) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
  );
  $effect(() => {
    void JSON.stringify(params); // every edit of the settings counts
    void cp;
    if (!open || text === '') {
      runner.cancel();
      ran = null;
      return;
    }
    runner.request({ text, fileName });
  });
  onDestroy(() => runner.cancel());
  const markRows = $derived(report === null ? { shown: [], more: 0 } : capRows(report.marks));
  const nameOf = (id: string): string => params.list.find((c) => c.id === id)?.name ?? id;

  function rangesText(ranges: { startLine: number; endLine: number }[]): string {
    return ranges.map((r) => (r.startLine === r.endLine ? `${r.startLine}` : `${r.startLine}-${r.endLine}`)).join(', ');
  }

  function take(): void {
    const doc = takeDocument?.() ?? null;
    if (doc === null) {
      note = t('machines.channels.tester.noDocument');
      return;
    }
    note = '';
    text = doc.text;
    fileName = doc.name;
  }
</script>

<details class="tester" data-testid="channels-tester" bind:open>
  <summary>{t('machines.channels.tester.title')}</summary>
  <p class="help">{t('machines.channels.tester.help')}</p>
  {#if takeDocument}
    <button type="button" class="button" data-testid="channels-tester-take" onclick={take}>
      {t('machines.channels.tester.take')}
    </button>
  {/if}
  {#if note !== ''}<p class="help" data-testid="channels-tester-note">{note}</p>{/if}
  {#if params.layout === 'multi-file'}
    <label class="small">
      {t('machines.channels.tester.fileName')}
      <input class="control" data-testid="channels-tester-name" bind:value={fileName} />
    </label>
  {/if}
  <textarea
    class="control paste"
    rows="8"
    spellcheck="false"
    data-testid="channels-tester-text"
    placeholder={t('machines.channels.tester.paste')}
    bind:value={text}
  ></textarea>

  {#if report}
    <div data-testid="channels-tester-report" data-layout={report.layout}>
      {#if report.abandoned}
        <p class="warn" data-testid="channels-tester-slow">{t('channels.problems.tooSlow')}</p>
      {:else if report.layout === 'none'}
        <p class="help" data-testid="channels-tester-none">{t('machines.channels.tester.none')}</p>
      {/if}

      {#if report.sections.length > 0}
        <table class="table" data-testid="channels-tester-sections">
          <thead>
            <tr>
              <th>{t('machines.channels.tester.channel')}</th>
              <th>{t('machines.channels.tester.sections')}</th>
              <th>{t('machines.channels.tester.lines')}</th>
            </tr>
          </thead>
          <tbody>
            {#each report.sections as s (s.channel.id)}
              <tr data-channel={s.channel.id}>
                <td>{s.channel.name}</td>
                <td>{s.ranges.length}</td>
                <td>{rangesText(s.ranges)}</td>
              </tr>
            {/each}
            {#each params.list.filter((c) => !report.sections.some((s) => s.channel.id === c.id)) as c (c.id)}
              <tr data-channel={c.id} class="dim">
                <td>{c.name}</td>
                <td>0</td>
                <td>{t('machines.channels.tester.noSection')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if report.self}
        <p data-testid="channels-tester-self">
          {t('machines.channels.tester.self', {
            channel: report.self.name,
            how: report.by === 'marker' ? t('machines.channels.tester.byMarker') : t('machines.channels.tester.byName'),
          })}
        </p>
      {/if}

      {#if report.outside.length > 0}
        <p data-testid="channels-tester-outside">
          {t('machines.channels.tester.outside', { lines: rangesText(report.outside) })}
        </p>
      {/if}

      {#if report.marks.length > 0}
        <table class="table" data-testid="channels-tester-marks">
          <thead>
            <tr>
              <th>{t('machines.channels.tester.line')}</th>
              <th>{t('machines.channels.tester.code')}</th>
              <th>{t('machines.channels.tester.rule')}</th>
              <th>{t('machines.channels.tester.inChannel')}</th>
              <th>{t('machines.channels.tester.waitsFor')}</th>
            </tr>
          </thead>
          <tbody>
            {#each markRows.shown as m, k (k)}
              <tr data-line={m.line}>
                <td>{m.line}</td>
                <td>{m.mark}</td>
                <td>{(params.syncMarks ?? []).find((r) => r.id === m.ruleId)?.label ?? m.ruleId}</td>
                <td>{m.channel === '' ? t('channels.map.outside') : nameOf(m.channel)}</td>
                <td>{m.partners.map(nameOf).join(', ')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if markRows.more > 0}<p class="help" data-testid="channels-tester-more">{t('machines.channels.tester.moreRows', { count: markRows.more })}</p>{/if}
        {#if report.dropped > 0}<p class="warn">{t('machines.channels.tester.dropped', { count: report.dropped })}</p>{/if}
      {:else if !report.abandoned}
        <p class="help" data-testid="channels-tester-nomarks">{t('machines.channels.tester.noMarks')}</p>
      {/if}

      {#if report.problems.length > 0}
        <ul class="problems" data-testid="channels-tester-problems">
          {#each report.problems as p, k (k)}
            <li>{t(p.message.key, p.message.params)}</li>
          {/each}
        </ul>
      {/if}

      {#if report.rules.length > 0}
        <table class="table" data-testid="channels-tester-rules">
          <thead>
            <tr>
              <th>{t('machines.channels.tester.rule')}</th>
              <th>{t('machines.channels.tester.found')}</th>
              <th>{t('machines.channels.tester.time')}</th>
            </tr>
          </thead>
          <tbody>
            {#each report.rules as r (r.id)}
              <tr data-rule={r.id} data-slow={r.slow ? '1' : '0'}>
                <td>{r.label}</td>
                <td>{r.marks}</td>
                <td>
                  {r.ms.toFixed(1)} ms
                  {#if r.slow}<span class="warn">{t('machines.channels.tester.slow', { ms: SLOW_RULE_MS })}</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if report.rulesAbandoned}<p class="warn" data-testid="channels-tester-rules-slow">{t('channels.problems.tooSlow')}</p>{/if}
      {/if}
    </div>
  {/if}
</details>

<style>
  .tester {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--text-main);
    font-size: 13px;
  }
  .help {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .warn {
    margin: 0;
    color: var(--danger-text);
    font-size: 12px;
  }
  .small {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
  .control {
    box-sizing: border-box;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
  }
  .paste {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }
  .button {
    padding: 5px 10px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    align-self: flex-start;
  }
  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .table th,
  .table td {
    padding: 2px 6px;
    border-bottom: 1px solid var(--border-color);
    text-align: left;
  }
  .dim {
    color: var(--text-dim);
  }
  .problems {
    margin: 0;
    padding-left: 16px;
    color: var(--danger-text);
    font-size: 12px;
  }
</style>
