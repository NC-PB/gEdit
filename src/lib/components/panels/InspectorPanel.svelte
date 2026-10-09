<!--
  The code inspector (Phase 3 plan P3.2b, AD-27, §6.8: `inspector-panel`, `inspector-row`,
  `inspector-cycle`, `inspector-state`). Owner: P3.2b.

  The panel draws what `app/inspectorService.ts` publishes and nothing else: which block the
  cursor is in, a row for every word of it with its effective value and what it means, the
  cycle with its parameters, and what is in force after the block. No parsing and no modal
  state are read here. The service updates once per animation frame while this panel is
  mounted (`follow()`); a hidden panel is not mounted, so it costs nothing.

  A row is edited with a double-click or Enter, which opens the value prompt
  (`InspectorEdit.svelte`); a row that cannot be edited says why in the status bar. A source
  line ("line 12") is a link that moves the cursor there.

  Every text from a profile, a code database or the program (a word's meaning, a state value, a
  parameter label) is shown as text, never as markup.
-->
<script module lang="ts">
  /** The parts of a key event the rule reads. */
  export interface EditKeyEvent {
    key: string;
    isComposing: boolean;
    /** A key held down: only its first press acts. */
    repeat: boolean;
    target: unknown;
    currentTarget: unknown;
  }

  /**
   * Enter on a row edits its value. Not a key of an input method's composition, not a key
   * held down, and not an Enter that was pressed on something inside the row (the "line 12"
   * link: Enter there follows the link).
   */
  export function isEditKey(e: EditKeyEvent): boolean {
    return e.key === 'Enter' && !e.isComposing && !e.repeat && e.target === e.currentTarget;
  }

  /** A double-click in a row edits its value, but not one that began on the "line 12" link. */
  export const LINK_CLICK_WINDOW_MS = 500;

  /**
   * The double-click of a row edits. A click on the link inside it does not, nor does the
   * second click of a double-click on the link (the first click moved the cursor, the link is
   * gone by then and the second click lands on the row): `sinceLinkClickMs` is the time since
   * the last click on a link of this panel.
   */
  export function isEditDoubleClick(
    e: { target: unknown },
    sinceLinkClickMs: number,
  ): boolean {
    const target = e.target as { closest?: (selector: string) => unknown } | null;
    if (target !== null && typeof target.closest === 'function' && target.closest('button') !== null) return false;
    return sinceLinkClickMs >= LINK_CLICK_WINDOW_MS;
  }

  /**
   * The key of a word's row: its line and where it starts, not where it ends. An edit that
   * changes the value's width (X5 to X10) would give the row a new key, and the row that has
   * the focus would be destroyed with it.
   */
  export function rowKey(word: { line: number; token: { start: number } }): string {
    return `${word.line}:${word.token.start}`;
  }

  /**
   * Keys for a keyed `{#each}` whose items can repeat their natural key (a user code file may
   * list a parameter address twice, M13): the natural key plus the item's place.
   */
  export function uniqueKeys<T>(items: readonly T[], keyOf: (item: T) => string): { item: T; key: string }[] {
    return items.map((item, index) => ({ item, key: `${keyOf(item)}#${index}` }));
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { inspector } from '$lib/app/inspectorService';
  import { INSPECTOR_TEST_IDS } from '$lib/core/codes/inspect';
  import { docs } from '$lib/stores/documents';
  import { t } from '$lib/i18n';
  import type { InspectedCycle, InspectedState, InspectedWord } from '$lib/core/codes/inspect';
  import type { ParamSource } from '$lib/core/machines/types';

  /** When a link of the panel was last clicked (`performance.now()`), for `isEditDoubleClick`. */
  let linkClickedAt = -Infinity;

  const snapshot = inspector.snapshot;
  const active = docs.active;

  onMount(() => inspector.follow());

  const block = $derived($snapshot.kind === 'block' ? $snapshot : null);
  const inspection = $derived(block?.inspection ?? null);

  /** "0.05 mm" for a word that has a value; empty otherwise. */
  function valueText(word: InspectedWord): string {
    const value = word.value;
    if (value === null || value.effective === null) return '';
    return value.unit === null ? value.effective : `${value.effective} ${value.unit}`;
  }

  /** Written out per source, so `i18n/keys.test.ts` sees every key. */
  function assumedText(from: ParamSource | undefined): string {
    switch (from) {
      case 'machine':
        return t('inspector.note.assumedMachine');
      case 'detected':
        return t('inspector.note.assumedDetected');
      case 'profile':
        return t('inspector.note.assumedProfile');
      default:
        return t('inspector.panel.assumed');
    }
  }

  function cycleTitle(cycle: InspectedCycle): string {
    switch (cycle.role) {
      case 'defines':
        return t('inspector.cycle.defines', { code: cycle.code });
      case 'calls':
        return t('inspector.cycle.calls', { code: cycle.code });
      default:
        return t('inspector.cycle.runs', { code: cycle.code });
    }
  }

  function stateKey(row: InspectedState): string {
    return row.key;
  }

  /** `group:<name>` rows carry the group in `data-group`. */
  function groupOf(row: InspectedState): string | undefined {
    return row.key.startsWith('group:') ? row.key.slice('group:'.length) : undefined;
  }

  function onRowKey(e: KeyboardEvent, word: InspectedWord): void {
    if (!isEditKey(e)) return;
    e.preventDefault();
    void inspector.edit(word);
  }

  function onRowDoubleClick(e: MouseEvent, word: InspectedWord): void {
    if (!isEditDoubleClick(e, performance.now() - linkClickedAt)) return;
    void inspector.edit(word);
  }
</script>

{#snippet lineLink(line: number)}
  <button
    type="button"
    class="link"
    title={t('inspector.panel.goTo', { line })}
    onclick={() => {
      linkClickedAt = performance.now();
      inspector.reveal(line);
    }}
  >{t('inspector.panel.sourceLine', { line })}</button>
{/snippet}

<div
  class="inspector"
  data-testid={INSPECTOR_TEST_IDS.panel}
  data-doc-id={block?.docId ?? ''}
  data-first-line={inspection?.firstLine ?? ''}
  data-last-line={inspection?.lastLine ?? ''}
  data-ready={inspection?.stateReady ? '1' : '0'}
>
  {#if $active === null || $snapshot.kind === 'none'}
    <p class="hint">{t('inspector.panel.noDocument')}</p>
  {:else if $snapshot.kind === 'notProgram'}
    <p class="hint">{t('inspector.panel.notProgram')}</p>
  {:else if $snapshot.kind === 'tooLong'}
    <p class="hint">{t('inspector.panel.tooLong', { line: $snapshot.line })}</p>
  {:else if inspection !== null}
    <h3 class="heading">
      {#if inspection.firstLine === inspection.lastLine}
        {t('inspector.panel.lineOne', { line: inspection.firstLine })}
      {:else}
        {t('inspector.panel.lineRange', { first: inspection.firstLine, last: inspection.lastLine })}
      {/if}
    </h3>

    {#if inspection.words.length === 0}
      <p class="hint">{t('inspector.panel.empty')}</p>
    {:else}
      <ul class="words" aria-label={t('inspector.panel.words')}>
        {#each inspection.words as word (rowKey(word))}
          <li>
            <div
              class="row"
              role="button"
              tabindex="0"
              data-testid={INSPECTOR_TEST_IDS.row}
              data-address={word.address ?? ''}
              data-line={word.line}
              data-kind={word.kind}
              data-editable={word.edit.ok ? '1' : '0'}
              data-value={word.value?.effective ?? ''}
              data-readings={word.value?.readings.length ?? 0}
              title={word.edit.ok ? t('inspector.panel.editable') : t(word.edit.reason.key, word.edit.reason.params)}
              ondblclick={(e) => onRowDoubleClick(e, word)}
              onkeydown={(e) => onRowKey(e, word)}
            >
              <span class="head">
                <code class="written">{word.written}</code>
                {#if word.meaning}<span class="meaning">{word.meaning}</span>{/if}
                {#if valueText(word)}<span class="value">{valueText(word)}</span>{/if}
              </span>
              {#if word.value && word.value.readings.length > 0}
                <span class="readings">
                  <span class="notes">{t('inspector.panel.readingsHeading')}</span>
                  <ul>
                    {#each uniqueKeys(word.value.readings, (r) => r.preset) as { item: reading, key } (key)}
                      <li>
                        {#if reading.value === null}
                          {t('inspector.panel.readingNone', { label: reading.label })}
                        {:else}
                          {t('inspector.panel.reading', {
                            label: reading.label,
                            value: reading.value,
                            unit: word.value.unit ?? '',
                          })}
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </span>
              {/if}
              {#if word.notes.length > 0}
                <ul class="notes">
                  {#each word.notes as note, i (i)}<li>{t(note.key, note.params)}</li>{/each}
                </ul>
              {/if}
              {#if word.line !== block?.cursorLine}
                <span class="notes">{@render lineLink(word.line)}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      <p class="footnote">{t('inspector.panel.hint')}</p>
    {/if}

    {#if inspection.cycle}
      {@const cycle = inspection.cycle}
      <section
        class="cycle"
        data-testid={INSPECTOR_TEST_IDS.cycle}
        data-code={cycle.code}
        data-role={cycle.role}
      >
        <h3 class="heading">
          {cycleTitle(cycle)}
          {#if cycle.part}<span class="part">{t('inspector.cycle.part', { index: cycle.part.index, of: cycle.part.of })}</span>{/if}
        </h3>
        <table>
          <tbody>
            {#each uniqueKeys(cycle.params, (p) => p.param.address) as { item: entry, key } (key)}
              <tr data-address={entry.param.address} data-written={entry.written === null ? '0' : '1'}>
                <th scope="row"><code>{entry.param.address}</code> {entry.param.label}</th>
                <td>
                  {#if entry.written === null}
                    <span class="muted">{t('inspector.cycle.notWritten')}</span>
                  {:else}
                    <code>{entry.written}</code>
                    {#if entry.line !== null && entry.line !== block?.cursorLine}{@render lineLink(entry.line)}{/if}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    <section class="state">
      <h3 class="heading">{t('inspector.panel.state')}</h3>
      {#if !inspection.stateReady}
        <p class="hint" data-testid="inspector-waiting">{t('inspector.why.waiting')}</p>
      {:else}
        <ul class="states">
          {#each uniqueKeys(inspection.state, stateKey) as { item: row, key } (key)}
            <li
              class="state-row"
              data-testid={INSPECTOR_TEST_IDS.state}
              data-key={row.key}
              data-group={groupOf(row)}
              data-line={row.line}
              data-assumed={row.assumed ? '1' : '0'}
              data-from={row.from}
              data-set-here={row.setHere ? '1' : '0'}
            >
              <span class="caption">{t(row.label.key, row.label.params)}</span>
              <span class="state-value">{row.value || '—'}</span>
              {#if row.setHere}<span class="mark">{t('inspector.panel.setHere')}</span>{/if}
              {#if row.assumed}<span class="notes">{assumedText(row.from)}</span>{/if}
              {#if row.line > 0}
                {@render lineLink(row.line)}
              {:else if !row.assumed}
                <span class="notes">{t('inspector.panel.atPowerOn')}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .inspector {
    padding: 6px 8px;
    font-size: 12px;
    color: var(--text-main);
  }

  .hint {
    margin: 6px 2px;
    color: var(--text-muted);
    font-style: italic;
  }

  .heading {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 8px 2px 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .heading:first-child {
    margin-top: 2px;
  }

  .part {
    font-weight: 400;
    letter-spacing: normal;
    text-transform: none;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px 6px;
    border-radius: 2px;
    cursor: default;
  }
  .row:hover {
    background-color: var(--surface-hover);
  }
  .row:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .row[data-editable='1'] .value {
    border-bottom: 1px dotted var(--text-muted);
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
  }

  .written {
    font-family: var(--font-mono, monospace);
    font-weight: 600;
    color: var(--text-active);
  }

  .meaning {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text-muted);
  }

  .value {
    font-family: var(--font-mono, monospace);
  }

  .notes {
    color: var(--text-muted);
    font-size: 11px;
  }
  ul.notes li::before {
    content: '· ';
  }

  .readings ul {
    padding-left: 10px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }

  .footnote {
    margin: 6px 2px 0;
    color: var(--text-muted);
    font-size: 11px;
  }

  .link {
    padding: 0;
    color: var(--accent);
    font: inherit;
    font-size: 11px;
    text-decoration: underline;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    padding: 1px 6px 1px 2px;
    font-weight: 400;
    text-align: left;
    vertical-align: top;
  }
  td {
    padding: 1px 2px;
    text-align: right;
    vertical-align: top;
  }
  th code,
  td code {
    font-family: var(--font-mono, monospace);
  }
  .muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .states {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .state-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 8px;
    padding: 2px 6px;
  }
  .state-row[data-set-here='1'] {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .caption {
    min-width: 6.5em;
    color: var(--text-muted);
  }
  .state-value {
    font-family: var(--font-mono, monospace);
  }
  .mark {
    color: var(--accent);
    font-size: 11px;
  }
</style>
