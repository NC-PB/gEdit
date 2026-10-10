<!--
  The template manager (Phase 3 plan §6.7, §6.11, P3.9, AD-40). Owner: P3.9.

  The templates of one code database: the built-in ones (read-only, a "review pending" mark while
  the owner has not reviewed them) and the user's own, kept in the user's code file for that database.
  A user template with the id of a built-in one replaces it. "New Template from Selection" opens the
  same dialog on a draft: the numbers of the selected blocks are shown in the text and the ones the
  user ticks become parameters.

  Everything the state holds is `app/templateManager.ts`: this component only shows it and calls it, so
  the unit tests drive the model without a DOM. Opened by `contrib/templateManager.ts` through
  `modals.open` with `{ wide: true, mayClose }`, so ModalHost renders it in a wide panel and asks
  `model.leave()` before an Esc or a press outside the panel closes it with unsaved edits.

  Texts of the templates (labels, groups, bodies, descriptions, JSON paths) are data: shown as text,
  never as markup, never translated (AD-14).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Modal from '$lib/components/common/Modal.svelte';
  import TemplateParamEditor from './TemplateParamEditor.svelte';
  import { groupRows, visibleRows, type ManagerRow, type TemplateManager } from '$lib/app/templateManager';
  import { t } from '$lib/i18n';
  import { SYS_PLACEHOLDERS, TEMPLATE_LIMITS, TEMPLATE_TEST_IDS, type SelectionCandidate } from '$lib/core/templates';

  interface Props {
    model: TemplateManager;
    /** Supplied by ModalHost. */
    close: (value?: unknown) => void;
  }

  let { model, close }: Props = $props();

  // The model is given once, when the dialog opens.
  // svelte-ignore state_referenced_locally
  const ms = model.state;

  let query = $state('');
  let paramIndex = $state(0);
  let bodyArea = $state<HTMLTextAreaElement | undefined>(undefined);

  const selected = $derived($ms.rows.find((r) => r.key === $ms.selected));
  const groups = $derived(groupRows(visibleRows($ms, query)));
  const def = $derived(selected?.def ?? null);
  const locked = $derived(selected === undefined || selected.origin === 'builtin' || selected.def === null);
  const preview = $derived(selected === undefined ? ({ kind: 'none' } as const) : model.preview(selected.key));
  const userCount = $derived($ms.rows.filter((r) => r.origin !== 'builtin').length);
  const userIndex = $derived($ms.rows.filter((r) => r.origin !== 'builtin').findIndex((r) => r.key === $ms.selected));
  const draft = $derived($ms.draft);

  // Another template: the parameter list starts at its first parameter again. A derived value
  // only changes when the key does, so an edit of the same template leaves the parameter alone.
  const selectedKey = $derived($ms.selected);
  $effect(() => {
    void selectedKey;
    paramIndex = 0;
  });

  const params = $derived(def?.params ?? []);
  const param = $derived(params[Math.min(paramIndex, Math.max(0, params.length - 1))]);
  const paramAt = $derived(Math.min(paramIndex, Math.max(0, params.length - 1)));

  async function requestClose(): Promise<void> {
    if (await model.leave()) close(undefined);
  }

  async function changeDialect(e: Event & { currentTarget: HTMLSelectElement }): Promise<void> {
    const select = e.currentTarget;
    const ok = await model.load(select.value);
    if (!ok) select.value = $ms.dialect;
  }

  function originLabel(row: ManagerRow): string {
    if (row.def === null) return t('templateManager.origin.unreadable');
    if (row.origin === 'builtin') return t('templateManager.origin.builtin');
    return row.origin === 'override' ? t('templateManager.origin.override') : t('templateManager.origin.user');
  }

  function labelOf(row: ManagerRow): string {
    if (row.def !== null) return row.def.label;
    const id = typeof row.raw === 'object' && row.raw !== null ? (row.raw as Record<string, unknown>).id : undefined;
    return typeof id === 'string' ? id : t('templateManager.origin.unreadableLabel');
  }

  function isFavorite(row: ManagerRow): boolean {
    return row.def !== null && $ms.favorites.includes(row.def.id);
  }

  async function putPlaceholder(name: string): Promise<void> {
    if (selected === undefined || bodyArea === undefined) return;
    const caret = model.insertPlaceholder(selected.key, name, bodyArea.selectionStart, bodyArea.selectionEnd);
    if (caret === null) return;
    await tick();
    bodyArea.focus();
    bodyArea.setSelectionRange(caret, caret);
  }

  /** The body line by line, the draft's candidates as their own pieces. */
  function pieces(line: string, n: number, candidates: readonly SelectionCandidate[]): { text: string; candidate?: SelectionCandidate }[] {
    const on = candidates.filter((c) => c.line === n).sort((a, b) => a.start - b.start);
    const out: { text: string; candidate?: SelectionCandidate }[] = [];
    let at = 0;
    for (const c of on) {
      if (c.start > at) out.push({ text: line.slice(at, c.start) });
      out.push({ text: line.slice(c.start, c.end), candidate: c });
      at = c.end;
    }
    if (at < line.length || out.length === 0) out.push({ text: line.slice(at) });
    return out;
  }

  const draftBody = $derived(draft === null ? '' : model.draftBody());
  const draftTicked = $derived(draft === null ? 0 : draft.chosen.length);
  const parameterCount = $derived.by(() => {
    if (draft === null) return 0;
    return new Set(draft.draft.candidates.filter((c) => draft.chosen.includes(c.key)).map((c) => c.param.id)).size;
  });

  const placeholderNames = $derived(['N', ...SYS_PLACEHOLDERS, ...params.map((p) => p.id)]);
</script>

<Modal id="template-manager" title={t('templateManager.title')} hideOk cancelLabel={t('templateManager.close')} onCancel={requestClose}>
  <div class="tm" data-testid={TEMPLATE_TEST_IDS.manager} data-dialect={$ms.dialect} data-file={$ms.fileExists ? $ms.fileName : ''} data-dirty={$ms.dirty}>
    <div class="top">
      <label class="field">
        <span>{t('templateManager.database')}</span>
        <select data-testid="template-database" value={$ms.dialect} disabled={$ms.busy || draft !== null} onchange={changeDialect}>
          {#each $ms.dialects as id (id)}
            <option value={id}>{id}</option>
          {/each}
        </select>
      </label>
      <label class="field grow">
        <span>{t('templateManager.search')}</span>
        <input type="search" data-testid="template-search" bind:value={query} placeholder={t('templateManager.searchPlaceholder')} />
      </label>
      <p class="file" data-testid="template-file">
        {#if $ms.fileExists}
          {t('templateManager.file.yours', { name: $ms.fileName })}
        {:else}
          {t('templateManager.file.none', { name: $ms.fileName })}
        {/if}
      </p>
    </div>

    {#if $ms.fileError !== null}
      <p class="banner error" role="alert" data-testid="template-file-error">{t($ms.fileError.key, $ms.fileError.params)}</p>
    {/if}

    <div class="cols">
      <div class="left">
        <div class="bar" role="toolbar" aria-label={t('templateManager.actions')}>
          <button type="button" data-testid={TEMPLATE_TEST_IDS.action} data-action="add" data-disabled={$ms.busy} disabled={$ms.busy || $ms.fileError !== null} onclick={() => model.add()}>{t('templateManager.btn.add')}</button>
          <button
            type="button"
            data-testid={TEMPLATE_TEST_IDS.action}
            data-action="duplicate"
            data-disabled={def === null}
            disabled={def === null || $ms.fileError !== null}
            title={t('templateManager.hint.duplicate')}
            onclick={() => selected && model.duplicate(selected.key, 'copy')}>{t('templateManager.btn.duplicate')}</button
          >
          {#if selected?.origin === 'builtin'}
            <button
              type="button"
              data-testid={TEMPLATE_TEST_IDS.action}
              data-action="override"
              data-disabled={$ms.fileError !== null}
              disabled={$ms.fileError !== null}
              title={t('templateManager.hint.override')}
              onclick={() => selected && model.duplicate(selected.key, 'override')}>{t('templateManager.btn.override')}</button
            >
          {/if}
          <button
            type="button"
            data-testid={TEMPLATE_TEST_IDS.action}
            data-action="delete"
            data-disabled={selected === undefined || selected.origin === 'builtin'}
            disabled={selected === undefined || selected.origin === 'builtin'}
            onclick={() => selected && model.remove(selected.key)}>{t('templateManager.btn.delete')}</button
          >
          <button
            type="button"
            data-testid={TEMPLATE_TEST_IDS.action}
            data-action="up"
            data-disabled={userIndex <= 0}
            disabled={userIndex <= 0}
            aria-label={t('templateManager.btn.up')}
            title={t('templateManager.btn.up')}
            onclick={() => selected && model.move(selected.key, -1)}>↑</button
          >
          <button
            type="button"
            data-testid={TEMPLATE_TEST_IDS.action}
            data-action="down"
            data-disabled={userIndex < 0 || userIndex >= userCount - 1}
            disabled={userIndex < 0 || userIndex >= userCount - 1}
            aria-label={t('templateManager.btn.down')}
            title={t('templateManager.btn.down')}
            onclick={() => selected && model.move(selected.key, 1)}>↓</button
          >
        </div>

        <div class="list" data-testid="template-list">
          {#each groups as group (group.group)}
            <div class="group" data-group={group.group}>
              {#if group.group !== ''}<h3>{group.group}</h3>{/if}
              {#each group.rows as row (row.key)}
                <div class="row" class:selected={row.key === $ms.selected}>
                  <button
                    type="button"
                    class="pick"
                    data-testid={TEMPLATE_TEST_IDS.row}
                    data-template-id={row.def?.id ?? ''}
                    data-origin={row.origin}
                    data-group={row.def?.group ?? ''}
                    data-review={row.def?.review === 'pending' ? 'pending' : ''}
                    data-favorite={isFavorite(row)}
                    data-problems={row.problems.length}
                    aria-pressed={row.key === $ms.selected}
                    onclick={() => model.select(row.key)}
                  >
                    <span class="name">{labelOf(row)}</span>
                    <span class="badges">
                      <span class="badge origin-{row.origin}">{originLabel(row)}</span>
                      {#if row.def?.review === 'pending'}<span class="badge review">{t('templateManager.reviewPending')}</span>{/if}
                      {#if row.problems.length > 0}<span class="badge problem">{t('templateManager.problems', { count: row.problems.length })}</span>{/if}
                    </span>
                  </button>
                  {#if row.def !== null}
                    <button
                      type="button"
                      class="star"
                      data-testid={TEMPLATE_TEST_IDS.action}
                      data-action="favorite"
                      data-template-id={row.def.id}
                      data-disabled="false"
                      aria-pressed={isFavorite(row)}
                      aria-label={isFavorite(row) ? t('templateManager.btn.unfavorite') : t('templateManager.btn.favorite')}
                      title={isFavorite(row) ? t('templateManager.btn.unfavorite') : t('templateManager.btn.favorite')}
                      onclick={() => model.setFavorite(row.key, !isFavorite(row))}>{isFavorite(row) ? '★' : '☆'}</button
                    >
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <p class="hint">{query.trim() === '' ? t('templateManager.empty') : t('templateManager.noMatch')}</p>
          {/each}
        </div>
      </div>

      <div class="right">
        {#if draft !== null}
          <section class="draft" data-testid="template-draft">
            <h2>{t('templateManager.draft.title')}</h2>
            <p class="hint">{t('templateManager.draft.hint')}</p>
            <pre class="code" data-testid="template-draft-body">{#each draft.draft.body.split('\n') as line, n (n)}{#each pieces(line, n, draft.draft.candidates) as piece, k (k)}{#if piece.candidate}<button
                    type="button"
                    class="cand"
                    class:on={draft.chosen.includes(piece.candidate.key)}
                    data-testid={TEMPLATE_TEST_IDS.candidate}
                    data-address={piece.candidate.address}
                    data-line={piece.candidate.line}
                    data-key={piece.candidate.key}
                    data-param-id={piece.candidate.param.id}
                    data-checked={draft.chosen.includes(piece.candidate.key)}
                    aria-pressed={draft.chosen.includes(piece.candidate.key)}
                    title={t('templateManager.draft.candidateHint', { id: piece.candidate.param.id, label: piece.candidate.param.label })}
                    onclick={() => model.toggleCandidate(piece.candidate?.key ?? '')}>{piece.text}</button
                  >{:else}{piece.text}{/if}{/each}{'\n'}{/each}</pre>
            <div class="inline">
              <button type="button" data-testid={TEMPLATE_TEST_IDS.action} data-action="draft-all" data-disabled="false" onclick={() => model.setAllCandidates(true)}>{t('templateManager.draft.all')}</button>
              <button type="button" data-testid={TEMPLATE_TEST_IDS.action} data-action="draft-none" data-disabled="false" onclick={() => model.setAllCandidates(false)}>{t('templateManager.draft.none')}</button>
              <span class="hint" data-testid="template-draft-count">{t('templateManager.draft.count', { numbers: t('templateManager.draft.numbers', { count: draftTicked }), params: t('templateManager.draft.values', { count: parameterCount }) })}</span>
            </div>
            {#if draft.draft.candidates.length === 0}<p class="hint">{t('templateManager.draft.noCandidates')}</p>{/if}
            <div class="grid">
              <label class="field">
                <span>{t('templateManager.field.label')}</span>
                <input type="text" data-testid="template-draft-field" data-field="label" value={draft.label} maxlength={TEMPLATE_LIMITS.label} oninput={(e) => model.setDraft('label', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>{t('templateManager.field.id')}</span>
                <input type="text" data-testid="template-draft-field" data-field="id" value={draft.id} maxlength="64" spellcheck="false" oninput={(e) => model.setDraft('id', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>{t('templateManager.field.group')}</span>
                <input type="text" data-testid="template-draft-field" data-field="group" value={draft.group} maxlength={TEMPLATE_LIMITS.group} oninput={(e) => model.setDraft('group', e.currentTarget.value)} />
              </label>
            </div>
            <h3 class="sub">{t('templateManager.draft.result')}</h3>
            <pre class="code" data-testid="template-draft-result">{draftBody}</pre>
            {#if draft.error !== null}
              <p class="banner error" role="alert" data-testid="template-draft-error" data-error={draft.error.key}>{t(draft.error.key, draft.error.params)}</p>
            {/if}
            <div class="inline">
              <button type="button" class="primary" data-testid={TEMPLATE_TEST_IDS.action} data-action="draft-apply" data-disabled="false" onclick={() => model.applyDraft()}>{t('templateManager.draft.apply')}</button>
              <button type="button" data-testid={TEMPLATE_TEST_IDS.action} data-action="draft-cancel" data-disabled="false" onclick={() => model.cancelDraft()}>{t('templateManager.draft.cancel')}</button>
            </div>
          </section>
        {:else if selected === undefined}
          <p class="hint">{t('templateManager.pick')}</p>
        {:else if def === null}
          <section class="broken" data-testid="template-unreadable">
            <h2>{t('templateManager.unreadable.title')}</h2>
            <p class="hint">{t('templateManager.unreadable.hint')}</p>
            <ul class="problem-list">
              {#each selected.problems as problem, i (i)}
                <li data-testid="template-problem" data-path={problem.path}><code>{problem.path}</code> {problem.message}</li>
              {/each}
            </ul>
            <pre class="code">{JSON.stringify(selected.raw, null, 2)}</pre>
          </section>
        {:else}
          <section class="editor" data-testid="template-editor" data-template-id={def.id} data-origin={selected.origin} data-locked={locked}>
            {#if selected.origin === 'builtin'}
              <p class="banner info" data-testid="template-note" data-kind="builtin">{t('templateManager.builtinNote')}</p>
            {/if}
            {#if def.review === 'pending'}
              <p class="banner warn" data-testid="template-note" data-kind="review">{t('templateManager.reviewNote')}</p>
            {/if}
            {#each selected.variants as variant (variant.dialect)}
              <p class="banner info" data-testid="template-note" data-kind="variant" data-variant={variant.dialect}>{t('templateManager.variantNote', { variant: variant.label, id: variant.dialect })}</p>
            {/each}
            {#if selected.origin === 'override'}
              <p class="banner info" data-testid="template-note" data-kind="override">{t('templateManager.overrideNote')}</p>
            {/if}
            {#each selected.notes as note, i (i)}
              <p class="banner warn" data-testid="template-note" data-kind="read">{note.where}: {note.message} {t('templateManager.readNote')}</p>
            {/each}

            <div class="grid">
              <label class="field">
                <span>{t('templateManager.field.label')}</span>
                <input type="text" data-testid="template-field" data-field="label" value={def.label} disabled={locked} maxlength={TEMPLATE_LIMITS.label} oninput={(e) => selected && model.setField(selected.key, 'label', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>{t('templateManager.field.id')}</span>
                <input type="text" data-testid="template-field" data-field="id" value={def.id} disabled={locked} maxlength="64" spellcheck="false" oninput={(e) => selected && model.setField(selected.key, 'id', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>{t('templateManager.field.group')}</span>
                <input type="text" data-testid="template-field" data-field="group" value={def.group} disabled={locked} maxlength={TEMPLATE_LIMITS.group} oninput={(e) => selected && model.setField(selected.key, 'group', e.currentTarget.value)} />
              </label>
              <label class="field wide">
                <span>{t('templateManager.field.description')}</span>
                <input type="text" data-testid="template-field" data-field="description" value={def.description ?? ''} disabled={locked} maxlength={TEMPLATE_LIMITS.description} oninput={(e) => selected && model.setField(selected.key, 'description', e.currentTarget.value)} />
              </label>
              <label class="field">
                <span>{t('templateManager.field.machineType')}</span>
                <select data-testid="template-field" data-field="machineType" value={def.machineType ?? ''} disabled={locked} onchange={(e) => selected && model.setField(selected.key, 'machineType', e.currentTarget.value)}>
                  <option value="">{t('templateManager.machine.any')}</option>
                  <option value="mill">{t('templateManager.machine.mill')}</option>
                  <option value="lathe">{t('templateManager.machine.lathe')}</option>
                </select>
              </label>
              <label class="check">
                <input type="checkbox" data-testid="template-field" data-field="toolbar" checked={def.toolbar === true} disabled={locked} onchange={(e) => selected && model.setField(selected.key, 'toolbar', e.currentTarget.checked)} />
                <span>{t('templateManager.flag.toolbar')}</span>
              </label>
              <label class="check">
                <input type="checkbox" data-testid="template-field" data-field="snippet" checked={def.snippet === true} disabled={locked} onchange={(e) => selected && model.setField(selected.key, 'snippet', e.currentTarget.checked)} />
                <span>{t('templateManager.flag.snippet')}</span>
              </label>
            </div>

            <h3 class="sub">{t('templateManager.body')}</h3>
            <textarea
              bind:this={bodyArea}
              class="code body"
              data-testid={TEMPLATE_TEST_IDS.body}
              aria-label={t('templateManager.body')}
              rows="7"
              spellcheck="false"
              readonly={locked}
              value={def.body}
              oninput={(e) => selected && model.setBody(selected.key, e.currentTarget.value)}
            ></textarea>
            {#if !locked}
              <div class="inline" role="toolbar" aria-label={t('templateManager.placeholders')}>
                <span class="hint">{t('templateManager.insertPlaceholder')}</span>
                {#each placeholderNames as name, i (i)}
                  <button type="button" class="small mono" data-testid={TEMPLATE_TEST_IDS.placeholder} data-placeholder={name} title={t(name === 'N' ? 'templateManager.placeholderBlockNumber' : name.startsWith('sys.') ? 'templateManager.placeholderSystem' : 'templateManager.placeholderParam')} onclick={() => putPlaceholder(name)}>{`{{${name}}}`}</button>
                {/each}
              </div>
            {/if}

            <h3 class="sub">{t('templateManager.params')}</h3>
            <div class="inline">
              {#each params as p, i (i)}
                <button type="button" class="small ptab" class:on={i === paramAt} data-testid="template-param-tab" data-param-id={p.id} aria-pressed={i === paramAt} onclick={() => (paramIndex = i)}>{p.label}</button>
              {:else}
                <span class="hint">{t('templateManager.noParams')}</span>
              {/each}
              {#if !locked}
                <button type="button" class="small" data-testid={TEMPLATE_TEST_IDS.action} data-action="add-param" data-disabled="false" onclick={() => { if (selected) { model.addParam(selected.key); paramIndex = params.length; } }}>{t('templateManager.btn.addParam')}</button>
                {#if param !== undefined}
                  <button type="button" class="small" data-testid={TEMPLATE_TEST_IDS.action} data-action="param-up" data-disabled={paramAt <= 0} disabled={paramAt <= 0} aria-label={t('templateManager.btn.up')} onclick={() => { if (selected) { model.moveParam(selected.key, paramAt, -1); paramIndex = paramAt - 1; } }}>↑</button>
                  <button type="button" class="small" data-testid={TEMPLATE_TEST_IDS.action} data-action="param-down" data-disabled={paramAt >= params.length - 1} disabled={paramAt >= params.length - 1} aria-label={t('templateManager.btn.down')} onclick={() => { if (selected) { model.moveParam(selected.key, paramAt, 1); paramIndex = paramAt + 1; } }}>↓</button>
                  <button type="button" class="small" data-testid={TEMPLATE_TEST_IDS.action} data-action="remove-param" data-disabled="false" onclick={() => { if (selected) model.removeParam(selected.key, paramAt); }}>{t('templateManager.btn.removeParam')}</button>
                {/if}
              {/if}
            </div>
            {#if selected !== undefined && param !== undefined}
              <TemplateParamEditor {model} rowKey={selected.key} index={paramAt} {param} {locked} formulaProblem={model.formulaProblem(selected.key, paramAt)} />
            {/if}

            <h3 class="sub">{t('templateManager.preview.title')}</h3>
            {#if preview.kind === 'text'}
              <pre class="code" data-testid={TEMPLATE_TEST_IDS.preview}>{preview.text}</pre>
            {:else if preview.kind === 'errors'}
              <div class="code error" data-testid={TEMPLATE_TEST_IDS.preview} data-error={preview.key}>
                {#each preview.lines as line, i (i)}<div>{line}</div>{/each}
              </div>
            {:else}
              <p class="hint" data-testid={TEMPLATE_TEST_IDS.preview}>{t('templateManager.preview.none')}</p>
            {/if}

            {#if selected.problems.length > 0}
              <ul class="problem-list" data-testid="template-row-problems">
                {#each selected.problems as problem, i (i)}
                  <li data-testid="template-problem" data-path={problem.path}>{problem.where}: {problem.message}</li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      </div>
    </div>

    {#if $ms.message !== null}
      <p class="banner {$ms.message.error ? 'error' : 'info'}" role={$ms.message.error ? 'alert' : 'status'} data-testid="template-message" data-error={$ms.message.error ? $ms.message.msg.key : ''}>{t($ms.message.msg.key, $ms.message.msg.params)}</p>
    {/if}
    {#if $ms.problems.length > 0}
      <ul class="problem-list" data-testid="template-problems">
        {#each $ms.problems as problem, i (i)}
          <li data-testid="template-problem" data-path={problem.path}>{problem.where}: {problem.message} <code>{problem.path}</code></li>
        {/each}
      </ul>
    {/if}
  </div>

  {#snippet footer()}
    <button type="button" class="primary" data-testid={TEMPLATE_TEST_IDS.action} data-action="save" data-disabled={!$ms.dirty || $ms.busy} disabled={!$ms.dirty || $ms.busy || $ms.fileError !== null} onclick={() => model.save()}>{t('templateManager.btn.save')}</button>
    <button type="button" data-testid={TEMPLATE_TEST_IDS.action} data-action="revert" data-disabled={!$ms.dirty || $ms.busy} disabled={!$ms.dirty || $ms.busy} onclick={() => model.revert()}>{t('templateManager.btn.revert')}</button>
    <button type="button" data-testid={TEMPLATE_TEST_IDS.action} data-action="open-file" data-disabled={!$ms.fileExists} disabled={!$ms.fileExists} title={t('templateManager.hint.openFile')} onclick={() => model.openFile()}>{t('templateManager.btn.openFile')}</button>
  {/snippet}
</Modal>

<style>
  .tm {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    font-size: 13px;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: flex-end;
  }

  .file {
    margin: 0 0 4px;
    color: var(--text-muted);
    font-size: 12px;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(260px, 370px) minmax(0, 1fr);
    gap: 12px;
    min-height: 0;
    height: min(62vh, 640px);
  }

  .left,
  .right {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }

  .right {
    padding-right: 4px;
    overflow-y: auto;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .list {
    flex: 1 1 auto;
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    overflow-y: auto;
  }

  .group h3 {
    margin: 0;
    padding: 4px 8px;
    background: var(--bg-ribbon);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: none;
  }

  .row {
    display: flex;
    align-items: stretch;
  }

  .row.selected {
    background: var(--surface-active);
  }

  .pick {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: 5px 8px;
    border: 0;
    background: transparent;
    color: var(--text-main);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pick:hover {
    background: var(--surface-hover);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .badge {
    padding: 0 5px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .badge.review {
    border-color: var(--warning);
    color: var(--warning);
  }

  .badge.problem {
    border-color: var(--danger-text);
    color: var(--danger-text);
  }

  .badge.origin-user,
  .badge.origin-override {
    border-color: var(--info);
    color: var(--info);
  }

  .star {
    flex: 0 0 auto;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--warning);
    font-size: 15px;
    cursor: pointer;
  }

  .star:hover {
    background: var(--surface-hover);
  }

  h2 {
    margin: 0;
    color: var(--text-active);
    font-size: 14px;
  }

  h3.sub {
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .banner {
    margin: 0;
    padding: 5px 8px;
    border-radius: 3px;
    font-size: 12px;
  }

  .banner.info {
    background: var(--info-surface);
    color: var(--text-main);
  }

  .banner.warn {
    border: 1px solid var(--warning);
    color: var(--text-main);
  }

  .banner.error {
    background: var(--danger-surface);
    color: var(--danger-text);
  }

  .editor,
  .draft,
  .broken {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px 10px;
    align-items: end;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 12px;
  }

  .field.wide {
    grid-column: 1 / -1;
  }

  .field.grow {
    flex: 1 1 200px;
  }

  .field span {
    color: var(--text-muted);
  }

  input[type='text'],
  input[type='search'],
  select {
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font: inherit;
  }

  input:disabled,
  select:disabled {
    color: var(--text-disabled);
  }

  label.check {
    display: flex;
    gap: 5px;
    align-items: center;
    font-size: 12px;
  }

  .code {
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-app);
    color: var(--text-main);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  textarea.body {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }

  .code.error {
    color: var(--danger-text);
  }

  .cand {
    margin: 0;
    padding: 0 1px;
    border: 1px dashed var(--info);
    border-radius: 2px;
    background: transparent;
    color: var(--info);
    font: inherit;
    cursor: pointer;
  }

  .cand.on {
    border-style: solid;
    background: var(--info);
    color: var(--bg-app);
  }

  .inline {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    align-items: center;
  }

  button {
    padding: 3px 10px;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    background: var(--bg-ribbon);
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  button:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  button.primary:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--text-on-accent);
  }

  button.small {
    padding: 1px 7px;
  }

  button.ptab.on {
    border-color: var(--accent);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .star,
  .pick,
  .cand {
    border-radius: 0;
  }

  .cand {
    padding: 0 1px;
  }

  .problem-list {
    margin: 0;
    padding-left: 18px;
    color: var(--danger-text);
    font-size: 12px;
  }

  code {
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
