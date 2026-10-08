<!--
  The Channels step of the machine form (plan §7.15, §7.17, AD-32). Owner: WP12.3.

  The owner's design rule (2026-10-07): "something that makes sense but does not overwhelm
  the user. The average user will be a NC-Programmer and not a Software Engineer." So:

    - the wait codes are one text field, `M100-M199, M300`, with a live preview under it
      ("Matches M100 … M199 (100 codes), M300") and a plain error that quotes the bad item;
    - the `P` word is a short dropdown with an example in each choice, and what a wait
      without it means is a second dropdown;
    - "Stops and ends count as waits" is a tick;
    - the patterns (section start, file names, marker, a rule found by pattern) sit behind
      "Advanced", closed unless the settings already use one, with a link to the help page;
    - presets are offered as a starting point and copied only by a button press (and a
      second press when there are settings to replace), never silently.

  The component edits one `ChannelParams` and nothing else: the page owns the draft, passes
  `value` and takes the new block from `onChange` (`undefined` = "No channels", the block is
  removed). It renders inline — no nested modal — because the Settings dialog is itself the
  open modal (`app/modals.ts`). Fields are the app's one form engine, `FormRenderer`, over
  the specs of `core/machines/channelFields.ts`; there is no machine-shaped control here
  except the channel and rule lists, which are lists of those same fields.

  What a stored block that is broken looks like (X12 d): the page shows `problems` the way
  `validateChannels` words them, each with its JSON path as the tooltip, and the machine's
  other settings are untouched. Machine, channel and preset names are data, not translated.
-->
<script lang="ts">
  import FormRenderer from '$lib/components/forms/FormRenderer.svelte';
  import { t } from '$lib/i18n';
  import {
    CF,
    TEMPLATE_WORDS,
    aliasesFromText,
    applyLayoutEdit,
    applyRuleEdit,
    moveIn,
    aliasesToText,
    codesPreview,
    layoutAdvancedFor,
    layoutFieldsFor,
    layoutToValues,
    newChannel,
    newRule,
    nounParams,
    ruleAdvancedFor,
    ruleFieldsFor,
    ruleFromValues,
    ruleToValues,
    sectionStartFromNames,
  } from '$lib/core/machines/channelFields';
  import { isAssignOnly, validateChannels } from '$lib/core/machines/validate';
  import { CHANNEL_CAPS } from '$lib/core/channels/types';
  import type { ChannelParams, SyncRule } from '$lib/core/channels/types';
  import type { ChannelPreset } from '$lib/core/profiles/types';

  interface Props {
    /** The block being edited; `undefined` while the machine has no channels. */
    value: ChannelParams | undefined;
    onChange: (next: ChannelParams | undefined) => void;
    /** The profile's wait letters (`machineParams.channels.waitLetters`). */
    waitLetters?: readonly string[];
    /** The profile's presets (`machineParams.channels.presets`). */
    presets?: readonly ChannelPreset[];
    /** Opens `docs/user/regex.md`; the link is left out when absent. */
    onOpenRegexHelp?: () => void;
    /** Pass true while the machines file cannot be written: every control is disabled. */
    disabled?: boolean;
  }

  let { value, onChange, waitLetters, presets = [], onOpenRegexHelp, disabled = false }: Props = $props();

  const lettersOf = (): readonly string[] | undefined => waitLetters;

  // --- derived ---------------------------------------------------------------------
  const noun = $derived(nounParams(value));
  const problems = $derived(value === undefined ? [] : validateChannels(value, 'channels', null, { waitLetters }));
  const assignOnly = $derived(value !== undefined && problems.length === 0 && isAssignOnly(value));
  const layoutValues = $derived(layoutToValues(value));

  /** A stored block may lack `syncMarks` (it is valid and means no rules). */
  function rulesOf(p: ChannelParams): SyncRule[] {
    return Array.isArray(p.syncMarks) ? p.syncMarks : [];
  }

  /** Advanced starts open when the settings already need it. */
  function needsAdvanced(p: ChannelParams | undefined): boolean {
    if (p === undefined) return false;
    if (p.layout === 'single-file' && (typeof p.sectionStart !== 'string' || p.sectionStart === '')) return true;
    return rulesOf(p).some((r) => r.match.kind !== 'codes' || r.partners.kind === 'line');
  }
  // svelte-ignore state_referenced_locally
  let advancedOpen = $state(needsAdvanced(value));

  // --- presets ---------------------------------------------------------------------
  let presetId = $state('');
  let confirming = $state(false);
  let applied = $state(false);
  const preset = $derived(presets.find((p) => p.id === presetId));

  function usePreset(): void {
    if (!preset || disabled) return;
    if (value !== undefined && !confirming) {
      confirming = true;
      return;
    }
    confirming = false;
    applied = true;
    onChange(structuredClone($state.snapshot(preset.value)) as ChannelParams);
  }

  // --- layout ----------------------------------------------------------------------
  function editLayout(id: string, v: unknown): void {
    applied = false;
    onChange(applyLayoutEdit(value, id, v));
  }

  // --- channels --------------------------------------------------------------------
  function setChannels(list: ChannelParams['list']): void {
    if (value) onChange({ ...value, list });
  }
  function editChannel(i: number, patch: Partial<ChannelParams['list'][number]>): void {
    if (!value) return;
    setChannels(
      value.list.map((c, k) => {
        if (k !== i) return c;
        const next = { ...c, ...patch };
        if (next.aliases !== undefined && next.aliases.length === 0) delete next.aliases;
        if (next.fileName === '') delete next.fileName;
        return next;
      }),
    );
  }
  function addChannel(): void {
    if (!value || value.list.length >= CHANNEL_CAPS.channels) return;
    setChannels([...value.list, newChannel(value)]);
  }
  function removeChannel(i: number): void {
    if (value) setChannels(value.list.filter((_, k) => k !== i));
  }
  function moveChannel(i: number, by: -1 | 1): void {
    if (value) setChannels(moveIn(value.list, i, by));
  }

  // --- rules -----------------------------------------------------------------------
  function setRules(syncMarks: SyncRule[]): void {
    if (value) onChange({ ...value, syncMarks });
  }
  function editRule(i: number, id: string, v: unknown): void {
    if (value) onChange(applyRuleEdit(value, i, id, v));
  }
  function addRule(): void {
    if (!value || rulesOf(value).length >= CHANNEL_CAPS.rules) return;
    setRules([...rulesOf(value), newRule(value)]);
  }
  function removeRule(i: number): void {
    if (value) setRules(rulesOf(value).filter((_, k) => k !== i));
  }
  function moveRule(i: number, by: -1 | 1): void {
    if (value) setRules(moveIn(rulesOf(value), i, by));
  }
  /** "Use a list of codes instead" on a rule found by pattern: back to the plain form. */
  function usePlain(i: number): void {
    editRule(i, CF.matchKind, 'codes');
  }
</script>

<section class="channels" data-testid="channels-form" aria-labelledby="channels-title">
  <h3 id="channels-title" class="title">{t('machines.channels.title')}</h3>
  <p class="intro">{t('machines.channels.intro')}</p>

  {#if presets.length > 0}
    <div class="presets" data-testid="channels-presets">
      <label class="label" for="channels-preset">{t('machines.channels.preset.title')}</label>
      <p class="help">{t('machines.channels.preset.help')}</p>
      <div class="row">
        <select
          id="channels-preset"
          class="control"
          data-testid="channels-preset"
          {disabled}
          bind:value={presetId}
          onchange={() => {
            confirming = false;
            applied = false;
          }}
        >
          <option value="">{t('machines.channels.preset.choose')}</option>
          {#each presets as p (p.id)}
            <option value={p.id}>{p.label}{p.verify ? ` (${t('machines.channels.preset.verify')})` : ''}</option>
          {/each}
        </select>
        {#if !confirming}
          <button type="button" class="button" data-testid="channels-preset-use" disabled={disabled || !preset} onclick={usePreset}>
            {t('machines.channels.preset.use')}
          </button>
        {/if}
      </div>
      {#if preset}
        <p class="help" data-testid="channels-preset-note">
          {#if preset.verify}<strong class="verify">{t('machines.channels.preset.verify')}</strong>
            {t('machines.channels.preset.verifyNote')}{/if}
          {#if preset.source}{t('machines.channels.preset.source', { source: preset.source })}{/if}
        </p>
      {/if}
      {#if confirming}
        <div class="confirm" role="alert" data-testid="channels-preset-confirm">
          <span>{t('machines.channels.preset.replaceAsk')}</span>
          <button type="button" class="button" data-testid="channels-preset-replace" onclick={usePreset}>
            {t('machines.channels.preset.replace')}
          </button>
          <button type="button" class="button" onclick={() => (confirming = false)}>
            {t('machines.channels.preset.keep')}
          </button>
        </div>
      {/if}
      {#if applied}<p class="help" data-testid="channels-preset-applied">{t('machines.channels.preset.applied')}</p>{/if}
    </div>
  {/if}

  {#each layoutFieldsFor(value) as field (field.id)}
    <FormRenderer fields={[field]} values={layoutValues} onChange={editLayout} />
  {/each}

  {#if value === undefined}
    <p class="help" data-testid="channels-none">{t('machines.channels.none')}</p>
  {:else}
    {#if problems.length > 0}
      <div class="problems" role="alert" data-testid="channels-problems">
        <strong>{t('machines.channels.problemsTitle')}</strong>
        <ul>
          {#each problems as problem, k (k)}
            <li title={problem.path} data-path={problem.path}>{problem.message}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if assignOnly}
      <p class="help" data-testid="channels-assign-only">{t('machines.channels.assignOnly')}</p>
    {/if}

    <!-- The channels -->
    <fieldset class="group" data-testid="channels-list">
      <legend class="label">{t('machines.channels.list.title')}</legend>
      <p class="help">{t('machines.channels.list.help')}</p>
      {#each value.list as channel, i (i)}
        <div class="item" data-testid="channel-row" data-channel={channel.id}>
          <div class="row">
            <label class="small">
              <span>{t('machines.channels.list.id')}</span>
              <input class="control narrow" type="text" {disabled} value={channel.id}
                aria-label={t('machines.channels.list.id')}
                oninput={(e) => editChannel(i, { id: e.currentTarget.value })} />
            </label>
            <label class="small grow">
              <span>{t('machines.channels.list.name')}</span>
              <input class="control" type="text" {disabled} value={channel.name}
                aria-label={t('machines.channels.list.name')}
                oninput={(e) => editChannel(i, { name: e.currentTarget.value })} />
            </label>
            <label class="small grow">
              <span>{t('machines.channels.list.aliases')}</span>
              <input class="control" type="text" {disabled} value={aliasesToText(channel.aliases)}
                aria-label={t('machines.channels.list.aliases')}
                title={t('machines.channels.list.aliasesHelp', noun)}
                oninput={(e) => editChannel(i, { aliases: aliasesFromText(e.currentTarget.value) })} />
            </label>
            <span class="buttons">
              <button type="button" class="icon" data-testid="channel-up"
                aria-label={t('machines.channels.list.up', { name: channel.name })}
                disabled={disabled || i === 0} onclick={() => moveChannel(i, -1)}>↑</button>
              <button type="button" class="icon" data-testid="channel-down"
                aria-label={t('machines.channels.list.down', { name: channel.name })}
                disabled={disabled || i === value.list.length - 1} onclick={() => moveChannel(i, 1)}>↓</button>
              <button type="button" class="icon" data-testid="channel-remove" {disabled}
                aria-label={t('machines.channels.list.remove', { name: channel.name })}
                onclick={() => removeChannel(i)}>✕</button>
            </span>
          </div>
        </div>
      {/each}
      <button type="button" class="button" data-testid="channel-add" disabled={disabled || value.list.length >= CHANNEL_CAPS.channels} onclick={addChannel}>
        {t('machines.channels.list.add', noun)}
      </button>
    </fieldset>

    <!-- The wait codes -->
    <fieldset class="group" data-testid="rules-list">
      <legend class="label">{t('machines.channels.rules.title')}</legend>
      <p class="help">{t('machines.channels.rules.help', noun)}</p>
      {#if rulesOf(value).length === 0}
        <p class="help" data-testid="rules-none">{t('machines.channels.rules.none')}</p>
      {/if}
      {#each rulesOf(value) as rule, i (i)}
        {@const values = ruleToValues(rule)}
        {@const address = rule.partners.kind === 'word' ? rule.partners.address : 'P'}
        <div class="item" data-testid="rule-card" data-rule={rule.id}>
          {#if rule.match.kind !== 'codes'}
            <p class="help" data-testid="rule-pattern-note">
              {t('machines.channels.rules.patternRule')}
              <button type="button" class="link" {disabled} onclick={() => usePlain(i)}>{t('machines.channels.rules.usePlain')}</button>
            </p>
          {/if}
          {#each ruleFieldsFor(value, values, { address }) as field (field.id)}
            <FormRenderer fields={[field]} {values} onChange={(id, v) => editRule(i, id, v)} />
            {#if field.id === CF.codes}
              {@const preview = codesPreview(String(values[CF.codes] ?? ''), lettersOf())}
              <div class="preview" data-testid="codes-preview" data-state={preview.state} aria-live="polite">
                {#if preview.state === 'ok'}
                  <span class="ok">{preview.text}</span>
                {:else}
                  {#each preview.errors as error, k (k)}<span class="bad">{error}</span>{/each}
                {/if}
              </div>
            {/if}
          {/each}
          <span class="buttons">
            <button type="button" class="icon" data-testid="rule-up" aria-label={t('machines.channels.rules.up')}
              disabled={disabled || i === 0} onclick={() => moveRule(i, -1)}>↑</button>
            <button type="button" class="icon" data-testid="rule-down" aria-label={t('machines.channels.rules.down')}
              disabled={disabled || i === rulesOf(value).length - 1} onclick={() => moveRule(i, 1)}>↓</button>
            <button type="button" class="icon" data-testid="rule-remove" {disabled}
              aria-label={t('machines.channels.rules.remove')} onclick={() => removeRule(i)}>✕</button>
          </span>
        </div>
      {/each}
      <button type="button" class="button" data-testid="rule-add" disabled={disabled || rulesOf(value).length >= CHANNEL_CAPS.rules} onclick={addRule}>
        {t('machines.channels.rules.add')}
      </button>
    </fieldset>

    <!-- Advanced -->
    <details class="advanced" data-testid="channels-advanced" bind:open={advancedOpen}>
      <summary>{t('machines.channels.advanced.title')}</summary>
      <p class="help">{t('machines.channels.advanced.help')}</p>
      {#if onOpenRegexHelp}
        <p>
          <button type="button" class="link" data-testid="channels-regex-help" onclick={onOpenRegexHelp}>
            {t('machines.channels.advanced.regexHelp')}
          </button>
        </p>
      {/if}
      {#each layoutAdvancedFor(value) as field (field.id)}
        <FormRenderer fields={[field]} values={layoutValues} onChange={editLayout} />
        {#if field.id === CF.sectionStart}
          <button type="button" class="link" data-testid="section-from-names" {disabled}
            onclick={() => editLayout(CF.sectionStart, sectionStartFromNames(value))}>
            {t('machines.channels.advanced.sectionStartFromNames')}
          </button>
        {/if}
      {/each}
      {#if value.layout === 'multi-file'}
        {#each value.list as channel, i (i)}
          <label class="small">
            <span>{channel.name}: {t('machines.channels.list.fileName')}</span>
            <input class="control" type="text" {disabled} value={channel.fileName ?? ''}
              title={t('machines.channels.list.fileNameHelp', { ...noun, ...TEMPLATE_WORDS })}
              data-testid="channel-file-name"
              oninput={(e) => editChannel(i, { fileName: e.currentTarget.value })} />
          </label>
        {/each}
      {/if}
      {#each rulesOf(value) as rule, i (i)}
        {@const values = ruleToValues(rule)}
        {@const fields = ruleAdvancedFor(value, values, { address: rule.partners.kind === 'word' ? rule.partners.address : 'P' })}
        {#if fields.length > 0}
          <div class="item" data-testid="rule-advanced" data-rule={rule.id}>
            <strong class="small">{rule.label || rule.id}</strong>
            {#each fields as field (field.id)}
              <FormRenderer fields={[field]} {values} onChange={(id, v) => editRule(i, id, v)} />
            {/each}
          </div>
        {/if}
      {/each}
    </details>
  {/if}
</section>

<style>
  .channels {
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--text-main);
    font-size: 13px;
  }
  .title {
    margin: 0;
    font-size: 14px;
  }
  .intro,
  .help {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .label {
    color: var(--text-main);
    font-size: 13px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .small {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
  .grow {
    flex: 1 1 140px;
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
  .control:focus {
    border-color: var(--accent);
    outline: none;
  }
  .narrow {
    width: 80px;
  }
  .buttons {
    display: inline-flex;
    gap: 4px;
  }
  .button,
  .icon {
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
  .icon {
    padding: 4px 8px;
  }
  .button:disabled,
  .icon:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    text-decoration: underline;
    cursor: pointer;
  }
  .preview {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: -8px 0 6px;
    font-size: 12px;
  }
  .ok {
    color: var(--text-dim);
  }
  .bad {
    color: var(--danger);
  }
  .problems {
    padding: 8px;
    border: 1px solid var(--danger);
    border-radius: 3px;
    color: var(--danger);
    font-size: 12px;
  }
  .problems ul {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  .confirm {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding: 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }
  .verify {
    color: var(--danger);
  }
  .advanced {
    border-top: 1px solid var(--border-color);
    padding-top: 8px;
  }
  .advanced summary {
    cursor: pointer;
  }
</style>
