// The Results panel (contrib/results.ts, components/panels/ResultsPanel.svelte).
// Owner: WP4.1. One namespace per feature (plan AD-14); the namespace name is this
// file's name.
//
// A report's own title, message, column labels and finding texts arrive already
// translated — a script writes them itself and is not translated (AD-14) — so what is
// here is the frame around them: the panel's chrome, the two export actions, and the
// column labels the panel invents when a report has findings but no table of its own.

import type { Messages } from '../types';

export default {
  title: 'Results',
  empty: 'Nothing to report yet. Transforms and scripts list what they skipped here.',
  findings: 'Findings',
  copyCsv: 'Copy CSV',
  copied_one: 'Copied 1 row.',
  copied_other: 'Copied {count} rows.',
  copyFailed: 'Nothing could be copied to the clipboard.',
  openAsText: 'Open as text',
  sortBy: 'Sort by {column}',
  goToLine: 'Go to line {line}',
  noLine: 'No line',
  columnLine: 'Line',
  columnSeverity: 'Severity',
  columnMessage: 'Message',
  columnDocument: 'Document',
  severityInfo: 'Info',
  severityWarning: 'Warning',
  severityError: 'Error',
} as const satisfies Messages;
