<!--
  One parameter of a template in the template manager (Phase 3 plan §6.11, P3.9): every member the
  loader allows for its type, as a plain form. Owner: P3.9.

  The fields shown follow `PARAM_MEMBERS[type]`, so a member the loader would refuse for the type is
  never offered. A built-in template's parameter is shown with the same fields, locked.

  A number the user is typing (a minimum of `1.`, a half-typed `-`) is kept as typed in this component
  and only committed when it reads as a number; a field with a text that is not one says so. Texts of
  the file (labels, help, choices) are data and are shown as text.
-->
<script lang="ts">
  import { PARAM_MEMBERS, PARAM_TYPES, type TemplateManager } from '$lib/app/templateManager';
  import { t } from '$lib/i18n';
  import { TEMPLATE_LIMITS, TEMPLATE_TEST_IDS, type TemplateParam } from '$lib/core/templates';

  interface Props {
    model: TemplateManager;
    rowKey: string;
    index: number;
    param: TemplateParam;
    locked: boolean;
    formulaProblem: string | null;
  }

  let { model, rowKey, index, param, locked, formulaProblem }: Props = $props();

  const shown = $derived(new Set(PARAM_MEMBERS[param.type]));

  /** The text of a number field while it is being typed. */
  let typed = $state<Record<string, string>>({});

  // Another parameter or template: what was half typed is gone.
  $effect(() => {
    void rowKey;
    void index;
    typed = {};
  });

  function set(name: string, value: unknown): void {
    model.setParam(rowKey, index, name, value);
  }

  function numberText(name: 'min' | 'max'): string {
    return typed[name] ?? (param[name] === undefined ? '' : String(param[name]));
  }

  function numberBad(name: 'min' | 'max'): boolean {
    const text = typed[name];
    return text !== undefined && text.trim() !== '' && !Number.isFinite(Number(text));
  }

  function typeNumber(name: 'min' | 'max', text: string): void {
    typed[name] = text;
    if (text.trim() === '') set(name, undefined);
    else if (Number.isFinite(Number(text))) set(name, Number(text));
  }

  const decimalsValue = $derived(param.decimals === undefined ? '' : String(param.decimals));

  function setDecimals(text: string): void {
    if (text === '') set('decimals', undefined);
    else if (text === 'as-entered' || text === 'min1') set('decimals', text);
    else set('decimals', Number(text));
  }

  function setDigits(text: string): void {
    set('digits', text === '' ? undefined : Number(text));
  }

  const decimalChoices = [0, 1, 2, 3, 4, 5, 6];
  const digitChoices = [1, 2, 3, 4, 5, 6, 7, 8, 9];
</script>

<div class="pe" data-testid={TEMPLATE_TEST_IDS.param} data-param-id={param.id} data-type={param.type} data-locked={locked}>
  <div class="grid">
    <label>
      <span>{t('templateManager.field.label')}</span>
      <input type="text" data-testid="template-param-field" data-field="label" value={param.label} disabled={locked} maxlength={TEMPLATE_LIMITS.label} oninput={(e) => set('label', e.currentTarget.value)} />
    </label>
    <label>
      <span>{t('templateManager.field.paramId')}</span>
      <input type="text" data-testid="template-param-field" data-field="id" value={param.id} disabled={locked} maxlength="32" spellcheck="false" oninput={(e) => set('id', e.currentTarget.value)} />
    </label>
    <label>
      <span>{t('templateManager.field.type')}</span>
      <select data-testid="template-param-field" data-field="type" value={param.type} disabled={locked} onchange={(e) => model.setParamType(rowKey, index, PARAM_TYPES.find((p) => p === e.currentTarget.value) ?? 'number')}>
        {#each PARAM_TYPES as type (type)}
          <option value={type}>{t(`templateManager.type.${type}`)}</option>
        {/each}
      </select>
    </label>
    <label class="wide">
      <span>{t('templateManager.field.help')}</span>
      <input type="text" data-testid="template-param-field" data-field="help" value={param.help ?? ''} disabled={locked} maxlength={TEMPLATE_LIMITS.help} oninput={(e) => set('help', e.currentTarget.value)} />
    </label>

    {#if shown.has('prefix')}
      <label>
        <span>{t('templateManager.field.prefix')}</span>
        <input type="text" data-testid="template-param-field" data-field="prefix" value={param.prefix ?? ''} disabled={locked} maxlength={TEMPLATE_LIMITS.affix} spellcheck="false" oninput={(e) => set('prefix', e.currentTarget.value)} />
      </label>
    {/if}
    {#if shown.has('suffix')}
      <label>
        <span>{t('templateManager.field.suffix')}</span>
        <input type="text" data-testid="template-param-field" data-field="suffix" value={param.suffix ?? ''} disabled={locked} maxlength={TEMPLATE_LIMITS.affix} spellcheck="false" oninput={(e) => set('suffix', e.currentTarget.value)} />
      </label>
    {/if}
    {#if shown.has('min')}
      <label>
        <span>{t('templateManager.field.min')}</span>
        <input type="text" inputmode="decimal" data-testid="template-param-field" data-field="min" data-bad={numberBad('min')} value={numberText('min')} disabled={locked} oninput={(e) => typeNumber('min', e.currentTarget.value)} />
        {#if numberBad('min')}<em class="bad">{t('templateManager.param.notANumber')}</em>{/if}
      </label>
    {/if}
    {#if shown.has('max')}
      <label>
        <span>{t('templateManager.field.max')}</span>
        <input type="text" inputmode="decimal" data-testid="template-param-field" data-field="max" data-bad={numberBad('max')} value={numberText('max')} disabled={locked} oninput={(e) => typeNumber('max', e.currentTarget.value)} />
        {#if numberBad('max')}<em class="bad">{t('templateManager.param.notANumber')}</em>{/if}
      </label>
    {/if}
    {#if shown.has('default')}
      <label>
        <span>{t('templateManager.field.default')}</span>
        {#if param.type === 'choice'}
          <select data-testid="template-param-field" data-field="default" value={param.default === undefined ? '' : String(param.default)} disabled={locked} onchange={(e) => set('default', e.currentTarget.value)}>
            <option value="">{t('templateManager.param.noDefault')}</option>
            {#each param.choices ?? [] as choice, c (c)}
              <option value={choice.value}>{choice.label}</option>
            {/each}
          </select>
        {:else}
          <input type="text" data-testid="template-param-field" data-field="default" value={param.default === undefined ? '' : String(param.default)} disabled={locked} maxlength={TEMPLATE_LIMITS.text} spellcheck="false" oninput={(e) => set('default', e.currentTarget.value)} />
        {/if}
      </label>
    {/if}
    {#if shown.has('decimals')}
      <label>
        <span>{t('templateManager.field.decimals')}</span>
        <select data-testid="template-param-field" data-field="decimals" value={decimalsValue} disabled={locked} onchange={(e) => setDecimals(e.currentTarget.value)}>
          <option value="">{t('templateManager.decimals.unset')}</option>
          <option value="as-entered">{t('templateManager.decimals.asEntered')}</option>
          <option value="min1">{t('templateManager.decimals.min1')}</option>
          {#each decimalChoices as n (n)}
            <option value={String(n)}>{t('templateManager.decimals.fixed', { n })}</option>
          {/each}
        </select>
      </label>
    {/if}
    {#if shown.has('digits')}
      <label>
        <span>{t('templateManager.field.digits')}</span>
        <select data-testid="template-param-field" data-field="digits" value={param.digits === undefined ? '' : String(param.digits)} disabled={locked} onchange={(e) => setDigits(e.currentTarget.value)}>
          <option value="">{t('templateManager.digits.unset')}</option>
          {#each digitChoices as n (n)}
            <option value={String(n)}>{n}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if shown.has('formula')}
      <label class="wide">
        <span>{t('templateManager.field.formula')}</span>
        <input type="text" class="mono" data-testid="template-param-field" data-field="formula" value={param.formula ?? ''} disabled={locked} maxlength="400" spellcheck="false" oninput={(e) => set('formula', e.currentTarget.value)} />
        {#if formulaProblem !== null}<em class="bad" data-testid="template-formula-problem">{formulaProblem}</em>{/if}
      </label>
    {/if}
  </div>

  <div class="flags">
    {#each [['required', 'templateManager.flag.required'], ['plusSign', 'templateManager.flag.plusSign'], ['uppercase', 'templateManager.flag.uppercase'], ['comment', 'templateManager.flag.comment'], ['remember', 'templateManager.flag.remember'], ['hidden', 'templateManager.flag.hidden']] as const as [name, label] (name)}
      {#if shown.has(name)}
        <label class="check">
          <input type="checkbox" data-testid="template-param-field" data-field={name} checked={(param as unknown as Record<string, unknown>)[name] === true} disabled={locked} onchange={(e) => set(name, e.currentTarget.checked)} />
          <span>{t(label)}</span>
        </label>
      {/if}
    {/each}
  </div>

  {#if shown.has('choices')}
    <fieldset class="choices">
      <legend>{t('templateManager.field.choices')}</legend>
      {#each param.choices ?? [] as choice, c (c)}
        <div class="choice" data-testid="template-choice">
          <input type="text" aria-label={t('templateManager.choice.label')} placeholder={t('templateManager.choice.label')} value={choice.label} disabled={locked} maxlength={TEMPLATE_LIMITS.label} oninput={(e) => model.setChoice(rowKey, index, c, 'label', e.currentTarget.value)} />
          <input type="text" class="mono" aria-label={t('templateManager.choice.value')} placeholder={t('templateManager.choice.value')} value={choice.value} disabled={locked} maxlength={TEMPLATE_LIMITS.value} spellcheck="false" oninput={(e) => model.setChoice(rowKey, index, c, 'value', e.currentTarget.value)} />
          {#if !locked}
            <button type="button" class="small" aria-label={t('templateManager.choice.remove')} title={t('templateManager.choice.remove')} onclick={() => model.removeChoice(rowKey, index, c)}>×</button>
          {/if}
        </div>
      {/each}
      {#if !locked}
        <button type="button" class="small" data-testid="template-action" data-action="add-choice" onclick={() => model.addChoice(rowKey, index)}>{t('templateManager.choice.add')}</button>
      {/if}
    </fieldset>
  {/if}
</div>

<style>
  .pe {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px 10px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 12px;
  }

  label.wide {
    grid-column: 1 / -1;
  }

  label span {
    color: var(--text-muted);
  }

  input[type='text'],
  select {
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
    font-size: 13px;
  }

  input[data-bad='true'] {
    border-color: var(--danger-text);
  }

  .mono {
    font-family: var(--font-mono);
  }

  input:disabled,
  select:disabled {
    color: var(--text-disabled);
  }

  .flags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }

  label.check {
    flex-direction: row;
    gap: 5px;
    align-items: center;
  }

  label.check span {
    color: var(--text-main);
  }

  .bad {
    color: var(--danger-text);
    font-style: normal;
  }

  fieldset.choices {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    font-size: 12px;
  }

  .choice {
    display: grid;
    grid-template-columns: 1fr 120px auto;
    gap: 6px;
  }

  button.small {
    padding: 2px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  button.small:hover {
    background: var(--surface-hover);
  }
</style>
