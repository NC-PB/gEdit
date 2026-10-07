<!--
  The comparison overlay (plan §5 WP2.5, §7.9: `compare-view` with `data-source`; M11:
  `data-mode`, the Raw/Review switch, the review bar, copy, export and go to line).

  Mounted by `PanelHost` in the `overlay` region, which means it takes the editor's place
  in the shell (AD-6). The diff editor itself lives in `$lib/monaco/diff`; this component
  owns the container, the toolbar and the Esc key. It builds one diff editor per session
  and tells it what to show (`sides`): the documents themselves in raw mode, the
  normalized read-only copies in review mode.

  Esc is handled in the *bubble* phase on purpose, and the test is propagation, not
  `defaultPrevented`. Monaco's text area calls `preventDefault()` on *every* Escape
  unconditionally, whether or not anything handled it (an IE keypress workaround:
  `textAreaEditContextInput.js`), so `defaultPrevented` says nothing at all. What does
  say something is `stopPropagation()`: the standalone keybinding service listens on
  `diffEditor.getContainerDomNode()` — the `.diff-host` below, i.e. *inside* this
  section — and stops propagation only when a keybinding actually matched. So an Esc
  that closes the find widget never reaches this handler, and an Esc the editor did
  nothing with does.
-->
<script lang="ts">
  import { get } from 'svelte/store';
  import { compareController } from '$lib/app/compare';
  import { createDiff, currentDiff, setCurrentDiff, settleCreated, type DiffHandle } from '$lib/monaco/diff';
  import { t } from '$lib/i18n';

  import { COMPARE_OPTION_KEYS, type CompareOptions } from '$lib/core/compare/types';

  const content = compareController.content;
  const options = compareController.view;
  const mode = compareController.mode;
  const review = compareController.review;
  const reviewInfo = compareController.reviewInfo;
  const reviewOptions = compareController.options;
  const sides = compareController.sides;
  const copyBlock = compareController.copyBlock;

  let host = $state<HTMLElement | undefined>(undefined);
  let error = $state('');
  /** Deliberately not `$state`: a Monaco object never becomes a Svelte proxy (AD-2). */
  let handle: DiffHandle | null = null;

  // One diff editor per session. The options are read untracked (`get`), so toggling a
  // toolbar switch updates the live editor below instead of rebuilding it.
  $effect(() => {
    const session = $content;
    const container = host;
    if (!session || !container) return;

    let cancelled = false;
    error = '';
    const initial = get(options);
    createDiff({
      container,
      modifiedDocId: session.docId,
      sides: get(sides) ?? { original: session.original, modified: { kind: 'document', docId: session.docId } },
      inline: initial.inline,
      ignoreTrimWhitespace: initial.ignoreTrimWhitespace,
    }).then(
      (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        handle = created;
        setCurrentDiff(created);
        // A toggle may have been pressed while the editor was being built.
        settleCreated(created, { sides: get(sides), ...get(options) });
        // The comparison owns the keyboard from here: Esc then reaches this component by
        // bubbling out of Monaco, and the diff navigation works without a click first.
        created.focus();
      },
      (err: unknown) => {
        if (cancelled) return;
        console.error('compare: the diff editor could not be created', err);
        error = t('compare.diffFailed', { error: err instanceof Error ? err.message : String(err) });
      },
    );

    return () => {
      cancelled = true;
      if (handle) {
        if (currentDiff() === handle) setCurrentDiff(null);
        handle.dispose();
        handle = null;
      }
    };
  });

  // The toolbar drives the live editor; the store is the single source of truth, so the
  // commands in `contrib/compare.ts` and these buttons cannot disagree.
  $effect(() => {
    const live = $options;
    handle?.setInline(live.inline);
    handle?.setIgnoreTrimWhitespace(live.ignoreTrimWhitespace);
  });

  // What the panes show: raw documents or the normalized copies. The same editor takes
  // both, so a toggle does not rebuild it (and the scratch models are reused).
  $effect(() => {
    const live = $sides;
    if (live) handle?.show(live);
  });

  /** One review toggle's label; written out so `i18n/keys.test.ts` sees the keys. */
  function optionLabel(key: keyof CompareOptions): string {
    switch (key) {
      case 'ignoreBlockNumbers':
        return t('compare.optionIgnoreBlockNumbers');
      case 'ignoreWhitespace':
        return t('compare.optionIgnoreWhitespace');
      case 'ignoreComments':
        return t('compare.optionIgnoreComments');
      case 'ignoreCase':
        return t('compare.optionIgnoreCase');
      case 'ignoreNumberFormat':
        return t('compare.optionIgnoreNumberFormat');
      case 'ignoreCycleNames':
        return t('compare.optionIgnoreCycleNames');
    }
  }

  function copy(event: MouseEvent, direction: 'toModified' | 'toOriginal'): void {
    void compareController.copyChange(direction, { lineOnly: event.shiftKey, thenNext: !event.shiftKey });
  }

  let gotoLine = $state('');
  function onGoto(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    compareController.goToLine(Number(gotoLine), event.shiftKey ? 'original' : 'modified');
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    compareController.close();
  }
</script>

<!-- The key handler is the overlay's Esc, not an interactive control (see the header). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="compare-view"
  data-testid="compare-view"
  data-source={$content?.source.kind ?? ''}
  data-mode={$mode}
  aria-label={$content?.title ?? t('compare.title')}
  onkeydown={onKeyDown}
>
  <div class="toolbar">
    <span class="caption" title={$content?.title ?? ''}>{$content?.title ?? ''}</span>
    <div class="spacer"></div>
    <div class="group" role="group" aria-label={t('compare.title')}>
      <button
        type="button"
        class="tool"
        data-testid="compare-mode"
        data-mode="raw"
        aria-pressed={$mode === 'raw'}
        onclick={() => compareController.setMode('raw')}
      >{t('compare.modeRaw')}</button>
      <button
        type="button"
        class="tool"
        data-testid="compare-mode"
        data-mode="review"
        aria-pressed={$mode === 'review'}
        title={t('compare.toggleReview')}
        onclick={() => compareController.setMode('review')}
      >{t('compare.modeReview')}</button>
    </div>
    {#if $mode === 'raw'}
      <label class="switch">
        <input
          type="checkbox"
          checked={$options.ignoreTrimWhitespace}
          onchange={(event) => compareController.setIgnoreTrimWhitespace(event.currentTarget.checked)}
        />
        {t('compare.ignoreWhitespace')}
      </label>
    {/if}
    <button
      type="button"
      class="tool"
      aria-pressed={$options.inline}
      title={$options.inline ? t('compare.sideBySide') : t('compare.inline')}
      onclick={() => compareController.toggleInline()}
    >{$options.inline ? t('compare.inline') : t('compare.sideBySide')}</button>
    <button
      type="button"
      class="tool"
      title={t('compare.prevDiff')}
      aria-label={t('compare.prevDiff')}
      onclick={() => currentDiff()?.goToDiff('previous')}
    >↑</button>
    <button
      type="button"
      class="tool"
      title={t('compare.nextDiff')}
      aria-label={t('compare.nextDiff')}
      onclick={() => currentDiff()?.goToDiff('next')}
    >↓</button>
    <button
      type="button"
      class="tool"
      data-testid="compare-copy"
      data-direction="toOriginal"
      data-disabled={$copyBlock.toOriginal !== null}
      title={t('compare.copyTitle', { action: t('compare.copyToOriginal') })}
      aria-disabled={$copyBlock.toOriginal !== null}
      aria-label={t('compare.copyToOriginal')}
      onclick={(event) => copy(event, 'toOriginal')}
    >{t('compare.copyToOriginalShort')}</button>
    <button
      type="button"
      class="tool"
      data-testid="compare-copy"
      data-direction="toModified"
      data-disabled={$copyBlock.toModified !== null}
      title={t('compare.copyTitle', { action: t('compare.copyToModified') })}
      aria-disabled={$copyBlock.toModified !== null}
      aria-label={t('compare.copyToModified')}
      onclick={(event) => copy(event, 'toModified')}
    >{t('compare.copyToModifiedShort')}</button>
    <button
      type="button"
      class="tool"
      data-testid="compare-export"
      data-normalized={$mode === 'review'}
      title={t('compare.exportDiff')}
      aria-label={t('compare.exportDiff')}
      onclick={() => void compareController.exportDiff({ normalized: $mode === 'review' })}
    >{t('compare.exportDiff')}</button>
    <input
      type="number"
      min="1"
      class="goto"
      data-testid="compare-goto"
      placeholder={t('compare.gotoLine')}
      title={t('compare.gotoLineHint')}
      aria-label={t('compare.gotoLine')}
      bind:value={gotoLine}
      onkeydown={onGoto}
    />
    <button
      type="button"
      class="tool"
      title={t('compare.close')}
      aria-label={t('compare.close')}
      onclick={() => compareController.close()}
    >✕</button>
  </div>

  {#if $mode === 'review' && $content}
    <div class="review-bar" role="group" aria-label={t('compare.reviewBar')}>
      <!-- The toggles the compared profile offers (§7.16 #148: cycle names only where it declares them). -->
      {#each $reviewInfo?.offered ?? COMPARE_OPTION_KEYS.filter((key) => key !== 'ignoreCycleNames') as key (key)}
        <button
          type="button"
          class="tool"
          data-testid="compare-option"
          data-option={key}
          data-default={$reviewInfo ? $reviewOptions[key] === $reviewInfo.defaults[key] : true}
          aria-pressed={$reviewOptions[key]}
          title={t('compare.optionHint', { what: optionLabel(key) })}
          onclick={() => compareController.setOptions({ [key]: !$reviewOptions[key] })}
        >{optionLabel(key)}</button>
      {/each}
      <button
        type="button"
        class="tool"
        data-testid="compare-defaults"
        data-profile-id={$reviewInfo?.profileId ?? ''}
        title={t('compare.profileDefaultsHint', { profile: $reviewInfo?.profileId ?? '' })}
        onclick={() => compareController.resetOptions()}
      >{t('compare.profileDefaults')}</button>
      {#each $review?.notes ?? [] as note, index (index)}
        <span class="note" data-testid="compare-note" data-reason={note.reason}>{note.text}</span>
      {/each}
    </div>
  {/if}

  {#if $content}
    <div class="diff-host" bind:this={host}></div>
  {:else}
    <p class="empty">{t('compare.empty')}</p>
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</section>

<style>
  .compare-view {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background-color: var(--bg-app);
  }

  .toolbar {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    overflow-x: auto;
    scrollbar-width: none;
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--border-color);
  }

  .caption {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--text-main);
    font-size: 12px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .group {
    display: flex;
    flex: 0 0 auto;
    gap: 2px;
  }

  .goto {
    flex: 0 0 auto;
    width: 84px;
    padding: 2px 4px;
    color: var(--text-main);
    font: inherit;
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
  }

  .review-bar {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    padding: 4px 8px;
    background-color: var(--bg-ribbon);
    border-bottom: 1px solid var(--border-color);
  }

  .note {
    flex: 1 1 100%;
    color: var(--text-muted);
    font-size: 11px;
  }

  .tool[data-disabled='true'] {
    opacity: 0.5;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .switch {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
    align-items: center;
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
    cursor: pointer;
  }

  .tool {
    flex: 0 0 auto;
    min-width: 22px;
    padding: 2px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 11px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }
  .tool:hover {
    color: var(--text-active);
    background-color: var(--surface-hover);
    border-color: var(--surface-hover-border);
  }
  .tool[aria-pressed='true'] {
    background-color: var(--surface-active);
    border-color: var(--surface-hover-border);
  }

  .diff-host {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .empty {
    margin: 0;
    padding: 24px;
    color: var(--text-muted);
    font-size: 12px;
    text-align: center;
  }

  .error {
    flex: 0 0 auto;
    margin: 0;
    padding: 8px 12px;
    color: var(--danger-text);
    font-size: 12px;
    background-color: var(--danger-surface);
  }
</style>
