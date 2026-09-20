<!--
  The Results panel (plan §5 WP4.1, §7.9: `results-panel`, `results-row`,
  `results-finding`). Owner: WP4.1.

  One report at a time, exactly as `stores/results.ts` holds it: a title, a message, an
  optional table and an optional list of findings. A transform fills the findings with the
  lines it refused to touch; a script's `report` output (M5) fills the table. Both are
  display text already — a script writes its own labels and is not translated (AD-14) —
  so this component formats and never interprets.

  **Why buttons and not a `<table>`.** Every row and every finding that carries a line is
  a real `<button>`: clicking it reveals the line, and that has to work with the keyboard
  as well. A `<tr>` cannot carry an interactive role without lying to a screen reader
  (`a11y_no_noninteractive_element_to_interactive_role`), so the table is a CSS grid of
  buttons, the same shape `ProgramMapPanel` uses. A row with no line stays a plain `<div>`
  — not clickable, not focusable, and it still carries its test id.

  Revealing switches documents: `Located.document` (a script naming a file) wins, then the
  report's `docId`, then the active document.
-->
<script module lang="ts">
  import { t } from '$lib/i18n';
  import type { Located, ReportData } from '$lib/app/types';

  /** CSV line terminator; RFC 4180 says CRLF and Excel agrees. */
  const CSV_EOL = '\r\n';

  /** The columns a report of bare findings is exported with. */
  function findingColumns(findings: Located[]): { key: string; label: string }[] {
    const columns = [
      { key: 'line', label: t('results.columnLine') },
      { key: 'severity', label: t('results.columnSeverity') },
      { key: 'message', label: t('results.columnMessage') },
    ];
    if (findings.some((f) => f.document !== undefined)) {
      columns.push({ key: 'document', label: t('results.columnDocument') });
    }
    return columns;
  }

  /** A finding as a row, so one formatter serves the table and the findings list. */
  function findingRow(finding: Located): Record<string, unknown> {
    return {
      line: finding.line,
      severity: severityLabel(finding.severity),
      message: finding.message,
      ...(finding.document === undefined ? {} : { document: finding.document }),
    };
  }

  /** The display name of a severity; `info` is the default a finding without one gets. */
  export function severityLabel(severity: Located['severity']): string {
    if (severity === 'error') return t('results.severityError');
    if (severity === 'warning') return t('results.severityWarning');
    return t('results.severityInfo');
  }

  /** A cell as text: `null` and `undefined` are empty, an object is JSON, the rest is `String`. */
  export function cellText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * One CSV field (RFC 4180).
   *
   * Quoted whenever the text carries a separator, a quote, a line break or an edge space,
   * and every quote inside is doubled. A field that starts with `=`, `+`, `-` or `@` is
   * quoted *and* prefixed with a `'`: a spreadsheet treats those as formulas, and a line
   * of NC code that begins with `-` is not a formula (CSV injection).
   */
  export function csvField(value: unknown): string {
    let text = cellText(value);
    const formula = /^[=+\-@\t\r]/.test(text);
    if (formula) text = `'${text}`;
    if (formula || /["\n\r,]/.test(text) || text !== text.trim()) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  /** The report's table as CSV; a report with findings only exports those instead. */
  export function reportToCsv(report: ReportData): string {
    const findings = report.findings ?? [];
    const columns = report.columns.length > 0 ? report.columns : findingColumns(findings);
    const rows =
      report.columns.length > 0 ? report.rows : findings.map((finding) => findingRow(finding));
    const lines = [columns.map((c) => csvField(c.label)).join(',')];
    for (const row of rows) lines.push(columns.map((c) => csvField(row[c.key])).join(','));
    return lines.join(CSV_EOL) + CSV_EOL;
  }

  /** The whole report as plain text: the heading, the table, then the findings. */
  export function reportToText(report: ReportData): string {
    const blocks: string[] = [report.title];
    if (report.message !== undefined && report.message !== '') blocks.push(report.message);

    if (report.columns.length > 0) {
      const table = [report.columns.map((c) => cellText(c.label)).join('\t')];
      for (const row of report.rows) {
        table.push(report.columns.map((c) => cellText(row[c.key])).join('\t'));
      }
      blocks.push(table.join('\n'));
    }

    const findings = report.findings ?? [];
    if (findings.length > 0) {
      const columns = findingColumns(findings);
      const list = [t('results.findings'), columns.map((c) => cellText(c.label)).join('\t')];
      for (const finding of findings) {
        const row = findingRow(finding);
        list.push(columns.map((c) => cellText(row[c.key])).join('\t'));
      }
      blocks.push(list.join('\n'));
    }
    return blocks.join('\n\n') + '\n';
  }

  /** A cell with nothing in it; those sort last whichever way the column is sorted. */
  export function isEmptyCell(value: unknown): boolean {
    return value === null || value === undefined || value === '';
  }

  /** Sort order for one cell: numbers numerically, everything else as natural text. */
  export function compareCells(a: unknown, b: unknown): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
    // `numeric` so T2 comes before T10, which is how a machinist reads a tool list.
    return cellText(a).localeCompare(cellText(b), 'en', { numeric: true, sensitivity: 'base' });
  }

  /** The rows of `report`, in the order `sort` asks for. */
  export function sortRows(
    rows: Record<string, unknown>[],
    key: string | null,
    dir: 1 | -1,
  ): Record<string, unknown>[] {
    if (key === null) return rows;
    // `sort` is stable in every engine this ships on, so equal cells keep report order.
    return [...rows].sort((a, b) => {
      const left = a[key];
      const right = b[key];
      // The direction is not applied to emptiness: reversing a column must not float
      // the rows that have no value in it to the top.
      if (isEmptyCell(left) || isEmptyCell(right)) {
        if (isEmptyCell(left) && isEmptyCell(right)) return 0;
        return isEmptyCell(left) ? 1 : -1;
      }
      return compareCells(left, right) * dir;
    });
  }

  /** The line a row points at, or null when it names none. */
  export function rowLine(row: Record<string, unknown>): number | null {
    const value = row.line;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 1) return Math.floor(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number(value);
      return parsed >= 1 ? parsed : null;
    }
    return null;
  }
</script>

<script lang="ts">
  import { files } from '$lib/app/fileOps';
  import { status } from '$lib/app/status';
  import { editor } from '$lib/monaco/editorService';
  import { docs } from '$lib/stores/documents';
  import { results } from '$lib/stores/results';
  import type { DocId } from '$lib/app/types';

  const current = results.current;
  const docList = docs.list;

  /** The sort is per report: a new report starts unsorted, in the order it was built. */
  let sort = $state<{ report: ReportData | null; key: string | null; dir: 1 | -1 }>({
    report: null,
    key: null,
    dir: 1,
  });

  const report = $derived($current);
  const active = $derived(
    sort.report === report ? sort : { report, key: null, dir: 1 as const },
  );
  const rows = $derived(sortRows(report?.rows ?? [], active.key, active.dir));
  const findings = $derived(report?.findings ?? []);
  const hasTable = $derived((report?.columns.length ?? 0) > 0);

  function sortBy(key: string): void {
    const dir: 1 | -1 = active.key === key && active.dir === 1 ? -1 : 1;
    sort = { report, key, dir };
  }

  /** Which document a line belongs to: the named one, the report's, then the active one. */
  function documentOf(name: unknown): DocId | null {
    void $docList; // re-resolve when a document opens, closes or is renamed
    if (typeof name === 'string' && name !== '') {
      const wanted = name.toLowerCase();
      const byTitle = docs.all().find((doc) => doc.title.toLowerCase() === wanted);
      if (byTitle) return byTitle.id;
      const byPath = docs.all().find((doc) => (doc.path ?? '').toLowerCase() === wanted);
      if (byPath) return byPath.id;
    }
    return report?.docId ?? docs.getActiveId();
  }

  function reveal(line: number | null, docId: DocId | null): void {
    if (line === null || docId === null) return;
    editor.reveal(docId, line);
  }

  /** `navigator.clipboard` where it exists, the old selection trick where it does not. */
  async function copyText(text: string): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Denied or unavailable: fall through to the fallback rather than give up.
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }

  async function copyCsv(): Promise<void> {
    if (!report) return;
    const count = hasTable ? report.rows.length : findings.length;
    if (await copyText(reportToCsv(report))) status.show(t('results.copied', { count }));
    else status.show(t('results.copyFailed'), { error: true });
  }

  function openAsText(): void {
    if (!report) return;
    files.newUntitled({ text: reportToText(report), activate: true });
  }
</script>

{#snippet cells(row: Record<string, unknown>, columns: { key: string; label: string }[])}
  {#each columns as column (column.key)}
    <span class="cell" data-column={column.key}>{cellText(row[column.key])}</span>
  {/each}
{/snippet}

<div class="results" data-testid="results-panel">
  {#if !report}
    <p class="hint">{t('results.empty')}</p>
  {:else}
    <header class="head">
      <div class="heading">
        <h3 class="title">{report.title}</h3>
        {#if report.message}<p class="message">{report.message}</p>{/if}
      </div>
      <div class="actions">
        <button type="button" class="action" data-testid="results-copy" onclick={copyCsv}
          >{t('results.copyCsv')}</button
        >
        <button type="button" class="action" data-testid="results-open" onclick={openAsText}
          >{t('results.openAsText')}</button
        >
      </div>
    </header>

    {#if hasTable}
      <div class="grid" style="--columns: {report.columns.length}">
        <div class="row header">
          {#each report.columns as column (column.key)}
            <button
              type="button"
              class="cell sort"
              title={t('results.sortBy', { column: column.label })}
              onclick={() => sortBy(column.key)}
            >
              <span class="label">{column.label}</span>
              {#if active.key === column.key}<span class="arrow" aria-hidden="true"
                  >{active.dir === 1 ? '▲' : '▼'}</span
                >{/if}
            </button>
          {/each}
        </div>
        {#each rows as row, index (index)}
          {@const line = rowLine(row)}
          {@const docId = documentOf(row.document)}
          {#if line !== null && docId !== null}
            <button
              type="button"
              class="row link"
              data-testid="results-row"
              data-line={line}
              data-doc-id={docId}
              title={t('results.goToLine', { line })}
              onclick={() => reveal(line, docId)}
            >
              {@render cells(row, report.columns)}
            </button>
          {:else}
            <div class="row" data-testid="results-row" data-line="" data-doc-id="">
              {@render cells(row, report.columns)}
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    {#if findings.length > 0}
      <section class="findings">
        {#if hasTable}<h4 class="subtitle">{t('results.findings')}</h4>{/if}
        <ul class="list">
          {#each findings as finding, index (index)}
            {@const docId = documentOf(finding.document)}
            <li>
              {#if docId !== null && finding.line >= 1}
                <button
                  type="button"
                  class="finding link"
                  class:warn={finding.severity === 'warning'}
                  class:err={finding.severity === 'error'}
                  data-testid="results-finding"
                  data-line={finding.line}
                  data-doc-id={docId}
                  data-severity={finding.severity ?? 'info'}
                  title={t('results.goToLine', { line: finding.line })}
                  onclick={() => reveal(finding.line, docId)}
                >
                  <span class="badge">{severityLabel(finding.severity)}</span>
                  <span class="line">{t('common.lineNumber', { line: finding.line })}</span>
                  <span class="text">{finding.message}</span>
                </button>
              {:else}
                <div
                  class="finding"
                  class:warn={finding.severity === 'warning'}
                  class:err={finding.severity === 'error'}
                  data-testid="results-finding"
                  data-line=""
                  data-doc-id=""
                  data-severity={finding.severity ?? 'info'}
                >
                  <span class="badge">{severityLabel(finding.severity)}</span>
                  <span class="line">{t('results.noLine')}</span>
                  <span class="text">{finding.message}</span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
  }

  .hint {
    margin: 6px 2px;
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .heading {
    min-width: 0;
  }

  .title {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
  }

  .message {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 11px;
  }

  .actions {
    display: flex;
    flex: 0 0 auto;
    gap: 4px;
  }

  .action {
    padding: 2px 8px;
    color: var(--text-main);
    font: inherit;
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    cursor: pointer;
  }
  .action:hover {
    background-color: var(--surface-hover);
  }

  .grid {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, auto));
    gap: 8px;
    width: 100%;
    padding: 2px 4px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 2px;
  }

  .row.header {
    grid-template-columns: repeat(var(--columns), minmax(0, auto));
    padding: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .cell {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .sort {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    color: var(--text-muted);
    font: inherit;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .sort:hover {
    color: var(--text-main);
  }

  .arrow {
    font-size: 8px;
  }

  .link {
    cursor: pointer;
  }
  .link:hover {
    background-color: var(--surface-hover);
  }

  .findings {
    min-width: 0;
  }

  .subtitle {
    margin: 0 0 4px;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.8;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .finding {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 2px 4px;
    color: var(--text-main);
    font: inherit;
    font-size: 12px;
    text-align: left;
    background: transparent;
    border: 0;
    border-radius: 2px;
  }

  .badge {
    flex: 0 0 auto;
    color: var(--info);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .warn .badge {
    color: var(--warning);
  }
  .err .badge {
    color: var(--danger-text);
  }

  .line {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
