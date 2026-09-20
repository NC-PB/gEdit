// The Results panel (plan §5 WP4.1, §7.9: `results-panel`, `results-row`,
// `results-finding`).
//
// Two halves. The exporters and the sort are pure functions out of `<script module>` and
// are tested directly — CSV escaping is the part that silently corrupts a report nobody
// re-reads. The markup is rendered with `svelte/server`, so there is no DOM, no Monaco
// and no `onMount`, and what is checked is the seam the runtime harness clicks.

import { render } from 'svelte/server';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import ResultsPanel, {
  cellText,
  compareCells,
  csvField,
  isEmptyCell,
  reportToCsv,
  reportToText,
  rowLine,
  severityLabel,
  sortRows,
} from './ResultsPanel.svelte';
import resultsContribution, { RESULTS_PANEL_ID } from '$lib/contrib/results';
import { panels } from '$lib/app/registry/panels';
import { docs } from '$lib/stores/documents';
import { layout } from '$lib/stores/layout';
import { results } from '$lib/stores/results';
import { hasKey, t } from '$lib/i18n';
import type { NewDocMeta, ReportData } from '$lib/app/types';

const TOOL_LIST: ReportData = {
  title: 'Tool list',
  message: '3 tools',
  columns: [
    { key: 'tool', label: 'Tool' },
    { key: 'line', label: 'Line' },
    { key: 'calls', label: 'Calls' },
  ],
  rows: [
    { tool: 'T1', line: 12, calls: 3 },
    { tool: 'T10', line: 4, calls: 1 },
    { tool: 'T2', line: 30, calls: 2 },
  ],
};

function newDoc(over: Partial<NewDocMeta> = {}): NewDocMeta {
  return {
    path: null,
    untitledIndex: 1,
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    eolMixedOnLoad: false,
    nul: { leader: 0, trailer: 0, stripped: 0 },
    textDirty: false,
    metaDirty: false,
    disk: null,
    external: 'none',
    ...over,
  };
}

afterEach(() => {
  results.clear();
  for (const doc of [...docs.all()]) docs.remove(doc.id);
  layout.hide('bottom');
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('csvField', () => {
  it('leaves an ordinary field alone', () => {
    expect(csvField('T1')).toBe('T1');
    expect(csvField(12)).toBe('12');
    expect(csvField(true)).toBe('true');
  });

  it('is empty for nothing at all', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('quotes a field that carries the separator', () => {
    expect(csvField('X10, Y20')).toBe('"X10, Y20"');
  });

  it('doubles the quotes inside a quoted field', () => {
    expect(csvField('he said "no"')).toBe('"he said ""no"""');
  });

  it('quotes a field with a line break, in either flavour', () => {
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField('a\r\nb')).toBe('"a\r\nb"');
  });

  it('quotes a field whose spaces would otherwise be eaten', () => {
    expect(csvField('  leading')).toBe('"  leading"');
    expect(csvField('trailing  ')).toBe('"trailing  "');
  });

  it('defuses a field a spreadsheet would read as a formula', () => {
    // A G-code line may legitimately start with a minus; a spreadsheet must not run it.
    expect(csvField('=1+1')).toBe(`"'=1+1"`);
    expect(csvField('-0.5')).toBe(`"'-0.5"`);
    expect(csvField('+X')).toBe(`"'+X"`);
    expect(csvField('@cmd')).toBe(`"'@cmd"`);
  });

  it('writes an object as JSON rather than [object Object]', () => {
    expect(cellText({ a: 1 })).toBe('{"a":1}');
  });
});

describe('reportToCsv', () => {
  it('writes the header and the rows, CRLF terminated', () => {
    expect(reportToCsv(TOOL_LIST)).toBe(
      'Tool,Line,Calls\r\nT1,12,3\r\nT10,4,1\r\nT2,30,2\r\n',
    );
  });

  it('leaves a missing cell empty instead of writing "undefined"', () => {
    const report: ReportData = {
      title: 'Partial',
      columns: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      rows: [{ a: 1 }],
    };
    expect(reportToCsv(report)).toBe('A,B\r\n1,\r\n');
  });

  it('exports the findings when the report has no table of its own', () => {
    const report: ReportData = {
      title: 'Renumber',
      columns: [],
      rows: [],
      findings: [{ line: 20, message: 'referenced by GOTO', severity: 'warning' }],
    };
    expect(reportToCsv(report)).toBe(
      `${t('results.columnLine')},${t('results.columnSeverity')},${t('results.columnMessage')}\r\n` +
        `20,${t('results.severityWarning')},referenced by GOTO\r\n`,
    );
  });

  it('adds a document column when the findings name one', () => {
    const report: ReportData = {
      title: 'Scan',
      columns: [],
      rows: [],
      findings: [{ line: 1, message: 'note', document: 'part.nc' }],
    };
    expect(reportToCsv(report).split('\r\n')[0]).toContain(t('results.columnDocument'));
  });
});

describe('reportToText', () => {
  it('opens with the title and the message, then the table', () => {
    const text = reportToText(TOOL_LIST);
    expect(text.startsWith('Tool list\n\n3 tools\n\n')).toBe(true);
    expect(text).toContain('Tool\tLine\tCalls');
    expect(text).toContain('T1\t12\t3');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('lists the findings under their own heading', () => {
    const report: ReportData = {
      title: 'Renumber',
      columns: [],
      rows: [],
      findings: [{ line: 20, message: 'referenced by GOTO', severity: 'warning' }],
    };
    const text = reportToText(report);
    expect(text).toContain(t('results.findings'));
    expect(text).toContain(`20\t${t('results.severityWarning')}\treferenced by GOTO`);
  });
});

// ---------------------------------------------------------------------------
// Sorting and rows
// ---------------------------------------------------------------------------

describe('sortRows', () => {
  it('keeps the report order until a column is picked', () => {
    expect(sortRows(TOOL_LIST.rows, null, 1)).toBe(TOOL_LIST.rows);
  });

  it('sorts numbers numerically, not as text', () => {
    expect(sortRows(TOOL_LIST.rows, 'line', 1).map((r) => r.line)).toEqual([4, 12, 30]);
    expect(sortRows(TOOL_LIST.rows, 'line', -1).map((r) => r.line)).toEqual([30, 12, 4]);
  });

  it('sorts tool names the way a machinist reads them', () => {
    expect(sortRows(TOOL_LIST.rows, 'tool', 1).map((r) => r.tool)).toEqual(['T1', 'T2', 'T10']);
  });

  it('never moves the source array', () => {
    const before = [...TOOL_LIST.rows];
    sortRows(TOOL_LIST.rows, 'line', -1);
    expect(TOOL_LIST.rows).toEqual(before);
  });

  it('puts an empty cell last, whichever way the column is sorted', () => {
    const rows = [{ v: 2 }, {}, { v: 1 }];
    expect(sortRows(rows, 'v', 1).map((r) => r.v)).toEqual([1, 2, undefined]);
    expect(sortRows(rows, 'v', -1).map((r) => r.v)).toEqual([2, 1, undefined]);
  });

  it('keeps equal cells in report order', () => {
    const rows = [
      { k: 1, id: 'a' },
      { k: 1, id: 'b' },
      { k: 1, id: 'c' },
    ];
    expect(sortRows(rows, 'k', 1).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('compares booleans and mixed values without throwing', () => {
    expect(compareCells(false, true)).toBeLessThan(0);
    expect(compareCells('T1', 2)).not.toBeNaN();
    expect(isEmptyCell('')).toBe(true);
    expect(isEmptyCell(0)).toBe(false);
  });
});

describe('rowLine', () => {
  it('reads a numeric line', () => {
    expect(rowLine({ line: 12 })).toBe(12);
  });

  it('reads a line a script wrote as text', () => {
    expect(rowLine({ line: '120' })).toBe(120);
  });

  it('answers null for anything that is not a line', () => {
    expect(rowLine({})).toBeNull();
    expect(rowLine({ line: 0 })).toBeNull();
    expect(rowLine({ line: 'N120' })).toBeNull();
    expect(rowLine({ line: null })).toBeNull();
  });
});

describe('severityLabel', () => {
  it('names every severity, and calls a missing one info', () => {
    expect(severityLabel('error')).toBe(t('results.severityError'));
    expect(severityLabel('warning')).toBe(t('results.severityWarning'));
    expect(severityLabel('info')).toBe(t('results.severityInfo'));
    expect(severityLabel(undefined)).toBe(t('results.severityInfo'));
  });
});

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

describe('ResultsPanel markup', () => {
  it('keeps the results-panel seam and says why it is empty', () => {
    const html = render(ResultsPanel).body;
    expect(html).toContain('data-testid="results-panel"');
    expect(html).not.toContain('data-testid="results-row"');
    expect(html).toContain(t('results.empty'));
  });

  it('shows the report title, message and the two export actions', () => {
    results.show(TOOL_LIST);
    const html = render(ResultsPanel).body;
    expect(html).toContain('Tool list');
    expect(html).toContain('3 tools');
    expect(html).toContain(t('results.copyCsv'));
    expect(html).toContain(t('results.openAsText'));
  });

  it('carries the line and the document on every row', () => {
    const docId = docs.add(newDoc());
    results.show({ ...TOOL_LIST, docId });
    const html = render(ResultsPanel).body;
    expect(html.match(/data-testid="results-row"/g)).toHaveLength(3);
    expect(html).toContain(`data-line="12"`);
    expect(html).toContain(`data-doc-id="${docId}"`);
  });

  it('leaves a row with no line unclickable', () => {
    docs.add(newDoc());
    results.show({
      title: 'Summary',
      columns: [{ key: 'what', label: 'What' }],
      rows: [{ what: 'no line here' }],
    });
    const html = render(ResultsPanel).body;
    expect(html).toContain('data-testid="results-row"');
    expect(html).toContain('data-line=""');
    expect(html).not.toContain('<button type="button" class="row link"');
  });

  it('lists the findings with their severity', () => {
    const docId = docs.add(newDoc());
    results.show({
      title: 'Renumber',
      columns: [],
      rows: [],
      findings: [
        { line: 20, message: 'referenced by GOTO', severity: 'warning' },
        { line: 44, message: 'packed block', severity: 'error' },
      ],
      docId,
    });
    const html = render(ResultsPanel).body;
    expect(html.match(/data-testid="results-finding"/g)).toHaveLength(2);
    expect(html).toContain('data-severity="warning"');
    expect(html).toContain('data-severity="error"');
    expect(html).toContain('referenced by GOTO');
    expect(html).toContain(t('common.lineNumber', { line: 20 }));
  });

  it('points a finding at the document it names', () => {
    const other = docs.add(newDoc({ path: '/tmp/part.nc', untitledIndex: null }));
    const active = docs.add(newDoc({ untitledIndex: 2 }));
    results.show({
      title: 'Scan',
      columns: [],
      rows: [],
      findings: [{ line: 3, message: 'here', document: 'part.nc' }],
      docId: active,
    });
    const html = render(ResultsPanel).body;
    expect(html).toContain(`data-doc-id="${other}"`);
    expect(html).not.toContain(`data-doc-id="${active}"`);
  });
});

// ---------------------------------------------------------------------------
// The contribution
// ---------------------------------------------------------------------------

describe('contrib/results', () => {
  /** Registers the panel, activates the feature, and hands back one disposer for both. */
  function start(): () => void {
    const stopPanel = panels.add(resultsContribution.panels[0]);
    const stopFeature = resultsContribution.activate();
    return () => {
      stopFeature();
      stopPanel();
    };
  }

  it('registers the panel in the bottom region under a translated title', () => {
    const [panel] = resultsContribution.panels;
    expect(panel.id).toBe(RESULTS_PANEL_ID);
    expect(panel.region).toBe('bottom');
    expect(hasKey(panel.title)).toBe(true);
  });

  it('reveals the panel for a new report', () => {
    const stop = start();
    expect(get(layout.state).bottom.visible).toBe(false);
    results.show({ title: 'Renumber', columns: [], rows: [] });
    expect(get(layout.state).bottom).toMatchObject({ visible: true, active: RESULTS_PANEL_ID });
    stop();
  });

  it('stops revealing once the contribution is torn down', () => {
    const stop = start();
    results.show({ title: 'Renumber', columns: [], rows: [] });
    stop();
    layout.hide('bottom');
    results.clear();
    results.show({ title: 'Again', columns: [], rows: [] });
    expect(get(layout.state).bottom.visible).toBe(false);
  });

  it('does not reveal the panel when a report is cleared', () => {
    const stop = start();
    results.clear();
    expect(get(layout.state).bottom.visible).toBe(false);
    stop();
  });

  it('clears a report whose document was closed', () => {
    const stop = start();
    const docId = docs.add(newDoc());
    results.show({ title: 'Renumber', columns: [], rows: [], docId });
    docs.remove(docId);
    expect(get(results.current)).toBeNull();
    stop();
  });

  it('keeps a report that names no document', () => {
    const stop = start();
    const docId = docs.add(newDoc());
    results.show({ title: 'Renumber', columns: [], rows: [] });
    docs.remove(docId);
    expect(get(results.current)).not.toBeNull();
    stop();
  });
});
