<!--
  The restore dialog (plan §5 WP7.4, §7.12, AD-21). Owner: WP7.4.

  It is the first thing the user sees after a crash, and it has one job beyond listing
  what survived: **say what restoring will do to the file on disk, before they choose.**

  A snapshot is unsaved text plus the stamp of the file it came from. Between the crash
  and this dialog the file may have been changed by a colleague, a CAM post or a DNC
  drip, may have been deleted, or may have moved out of everything gEdit is allowed to
  open. Each of those makes a restore mean something different, so each row carries its
  own sentence (`app/recovery.ts` → `outlookOf`) rather than a single hopeful "Restore".
  A row whose file changed says so in the row, not in a banner that applies to nothing
  in particular.

  Nothing here writes to disk. Restoring reopens the text as a dirty document — the
  saved file is not touched until the user saves it themselves, and a document restored
  onto a file that moved on carries the snapshot's disk stamp, so the P1
  external-change banner is up before they can save over it.

  Opened by `contrib/recovery.ts` through `modals.open`, so ModalHost renders it — which
  is also where Esc and a click outside come from. Both resolve `undefined`, and
  `undefined` is read as **Later**: the one answer that loses nothing.

  This dialog draws its own frame instead of using `components/common/Modal.svelte`,
  because §7.12 gives it three named actions (`data-action=restore|discard|later`) and
  that frame has room for exactly one confirm and one cancel. The frame still carries
  `data-testid="modal"` and `data-modal="recovery"`, so a scenario addresses it the same
  way it addresses every other dialog.
-->
<script module lang="ts">
  import { entryKey, takenText, type RestoreOutlook } from '$lib/app/recovery';
  import { t } from '$lib/i18n';
  import type { RecoveryEntry } from '$lib/app/types';

  /** What the dialog answers with. `undefined` (Esc, click outside) means `later`. */
  export type RecoveryChoice =
    /** Reopen exactly these snapshots; the ones left out stay on disk. */
    | { action: 'restore'; entries: RecoveryEntry[] }
    /** Delete every snapshot that was offered. The caller confirms first. */
    | { action: 'discard' }
    /** Do nothing at all; ask again at the next start. */
    | { action: 'later' };

  /**
   * The row's own sentence about the file the snapshot came from.
   *
   * The keys are written out one by one rather than looked up in a table, so that
   * `i18n/keys.test.ts` — which parses literal `t()` arguments — really covers all six.
   */
  export function whereText(entry: RecoveryEntry, outlook: RestoreOutlook): string {
    const path = entry.path ?? entry.title;
    // A snapshot whose sidecar never reached the disk: Rust knows the text and nothing
    // else about it (`recovery.rs::orphan_meta`). Saying "was never saved to a file"
    // would be a guess, and the wrong one more often than not — this is the *first*
    // snapshot of a document, which is usually a file that was already open.
    if (entry.metaLost === true) return t('recovery.whereMetaLost');
    if (outlook === 'changed') return t('recovery.whereChanged', { path });
    if (outlook === 'missing') return t('recovery.whereMissing', { path });
    if (outlook === 'unknown') return t('recovery.whereUnknown', { path });
    if (outlook === 'unreachable') return t('recovery.whereUnreachable', { path });
    if (outlook === 'unchanged') return t('recovery.whereUnchanged', { path });
    return t('recovery.whereUntitled');
  }

  /** Restore all / Restore N selected / Restore (disabled). */
  export function restoreLabel(selected: number, total: number): string {
    if (selected === 0) return t('recovery.restoreNone');
    if (selected === total) return t('recovery.restoreAll');
    return t('recovery.restoreSelected', { count: selected });
  }

  /** The outlooks that mean "look at this before you save over the file". */
  export function isWarning(outlook: RestoreOutlook): boolean {
    return outlook === 'changed' || outlook === 'unknown';
  }
</script>

<script lang="ts">
  interface Props {
    /** The leftover snapshots, newest session first, as `recovery.leftovers()` gave them. */
    entries: RecoveryEntry[];
    /** `outlookFor(entries)`: what a restore would do, by `entryKey`. */
    outlook: Record<string, RestoreOutlook>;
    /** Supplied by ModalHost. */
    close: (value?: RecoveryChoice) => void;
  }

  let { entries, outlook, close }: Props = $props();

  // What the user has *un*ticked, rather than what they have ticked. Everything is
  // restored unless it was taken out by hand — the common case after a crash is "give
  // me all of it back", and an empty record says exactly that without having to be
  // built from `entries` first.
  let unticked = $state<Record<string, true>>({});

  let restoreButton = $state<HTMLButtonElement | undefined>(undefined);

  const chosen = $derived(entries.filter((entry) => unticked[entryKey(entry)] !== true));
  const allPicked = $derived(entries.length > 0 && chosen.length === entries.length);

  function setPicked(key: string, on: boolean): void {
    const next = { ...unticked };
    if (on) delete next[key];
    else next[key] = true;
    unticked = next;
  }

  function setAll(on: boolean): void {
    unticked = on ? {} : Object.fromEntries(entries.map((entry) => [entryKey(entry), true as const]));
  }

  function outlookOfRow(entry: RecoveryEntry): RestoreOutlook {
    return outlook[entryKey(entry)] ?? 'unknown';
  }

  // The primary action takes focus, so Enter and Space work without reaching for the
  // mouse. ModalHost keeps Tab inside the panel and turns Esc into `undefined`.
  $effect(() => {
    restoreButton?.focus();
  });
</script>

<div
  class="frame"
  data-testid="modal"
  data-modal="recovery"
  role="dialog"
  aria-modal="true"
  aria-labelledby="recovery-title"
  tabindex="-1"
>
  <h2 class="title" id="recovery-title">{t('recovery.title')}</h2>
  <p class="lead">{t('recovery.lead', { count: entries.length })}</p>
  <p class="promise">{t('recovery.nothingWritten')}</p>

  <div class="body" data-testid="recovery-dialog" data-count={entries.length}>
    {#if entries.length > 1}
      <label class="all">
        <input
          type="checkbox"
          checked={allPicked}
          data-testid="recovery-select-all"
          onchange={(e) => setAll(e.currentTarget.checked)}
        />
        <span>{t('recovery.selectAll')}</span>
      </label>
    {/if}

    <div class="list">
      {#each entries as entry (entryKey(entry))}
        {@const key = entryKey(entry)}
        {@const outcome = outlookOfRow(entry)}
        <label
          class="row"
          class:warn={isWarning(outcome)}
          data-testid="recovery-item"
          data-session={entry.session}
          data-key={entry.key}
          data-path={entry.path ?? ''}
          data-outlook={outcome}
          data-selected={unticked[key] === true ? '0' : '1'}
        >
          <input
            type="checkbox"
            checked={unticked[key] !== true}
            onchange={(e) => setPicked(key, e.currentTarget.checked)}
          />
          <span class="text">
            <!-- A document title is the file's own name: data, never translated (AD-14).
                 An orphan snapshot has none, so it is named rather than left blank. -->
            <span class="name">{entry.title === '' ? t('recovery.unnamed') : entry.title}</span>
            <span class="taken">{takenText(entry)}</span>
            <span class="where">{whereText(entry, outcome)}</span>
          </span>
        </label>
      {/each}
    </div>

    <div class="actions">
      <button
        type="button"
        class="action primary"
        data-action="restore"
        disabled={chosen.length === 0}
        title={t('recovery.restoreHint')}
        bind:this={restoreButton}
        onclick={() => close({ action: 'restore', entries: chosen })}
      >
        {restoreLabel(chosen.length, entries.length)}
      </button>
      <button
        type="button"
        class="action danger"
        data-action="discard"
        title={t('recovery.discardHint')}
        onclick={() => close({ action: 'discard' })}
      >
        {t('recovery.discard')}
      </button>
      <button
        type="button"
        class="action"
        data-action="later"
        title={t('recovery.laterHint')}
        onclick={() => close({ action: 'later' })}
      >
        {t('recovery.later')}
      </button>
    </div>
  </div>
</div>

<style>
  .frame {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    min-height: 0;
    color: var(--text-main, #cccccc);
    font-size: 13px;
    outline: none;
  }

  .title {
    margin: 0 0 8px;
    color: var(--text-active, #ffffff);
    font-size: 15px;
    font-weight: 600;
  }

  .lead {
    margin: 0 0 6px;
  }

  .promise {
    margin: 0 0 10px;
    color: var(--text-muted, #808080);
    font-size: 12px;
  }

  .body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .all {
    display: flex;
    flex: 0 0 auto;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
    color: var(--text-muted, #808080);
    font-size: 12px;
    cursor: pointer;
  }

  .list {
    flex: 1 1 auto;
    min-height: 0;
    border: 1px solid var(--border-color, #3e3e42);
    border-radius: 3px;
    overflow-y: auto;
  }

  .row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 8px;
    cursor: pointer;
  }

  .row + .row {
    border-top: 1px solid var(--border-color, #3e3e42);
  }

  .row:hover {
    background: var(--surface-hover, rgb(255 255 255 / 8%));
  }

  .text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    color: var(--text-active, #ffffff);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .taken {
    color: var(--text-muted, #808080);
    font-size: 11px;
  }

  .where {
    color: var(--text-muted, #808080);
    font-size: 12px;
  }

  /* The one row state that has to be visible without reading: the file on disk is not
     the file this text came from. */
  .row.warn .where {
    color: var(--danger-text, #f38ba8);
  }

  .actions {
    display: flex;
    flex: 0 0 auto;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border-color, #3e3e42);
  }

  /* Discard sits away from Restore: the two are one click apart and one of them cannot
     be undone. */
  .action.danger {
    margin-left: auto;
  }

  .action {
    padding: 5px 14px;
    border: 1px solid var(--border-color, #3e3e42);
    border-radius: 3px;
    background: var(--bg-ribbon, #2d2d30);
    color: var(--text-main, #cccccc);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .action:hover:not(:disabled) {
    background: var(--surface-hover, rgb(255 255 255 / 8%));
  }

  .action:disabled {
    color: var(--text-disabled, #6d6d6d);
    cursor: default;
  }

  .action.primary:not(:disabled) {
    border-color: var(--accent, #0e639c);
    background: var(--accent, #0e639c);
    color: var(--text-on-accent, #ffffff);
  }

  .action.primary:hover:not(:disabled) {
    background: var(--accent-hover, #1177bb);
  }
</style>
