// `decideApply` (plan §5 WP5.1 "Tests", §7.5): every rule of the safety bar, as a pure
// function of one finished run. No Monaco, no store, no Tauri.
//
// The cases the plan names are all here — exit ≠ 0 applies nothing, empty stdout in
// replace mode is an error, a changed version gives stale, truncated output, envelope and
// report validation, the v1 fallback — and so is the thing that makes them trustworthy:
// the **order** of the checks, asserted on runs that failed in two ways at once.

import { describe, expect, it } from 'vitest';
import {
  APPLY_ERROR_KEYS,
  MAX_FINDINGS,
  MAX_ROWS,
  decideApply,
  parseEnvelope,
  parseReport,
} from './apply';
import type { RunResult, ScriptMeta, ScriptOutputMode } from '$lib/platform/commands';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    exitCode: 0,
    success: true,
    stdout: '',
    stderr: '',
    timedOut: false,
    cancelled: false,
    stdoutTruncated: false,
    durationMs: 12,
    interpreter: '/usr/bin/python3',
    ...over,
  };
}

function meta(output: ScriptOutputMode, over: Partial<ScriptMeta> = {}): ScriptMeta {
  return {
    name: 'Scale feed rates',
    description: '',
    profiles: null,
    input: 'selection-or-document',
    output,
    timeout: null,
    envelope: false,
    documents: 'active',
    params: [],
    warnings: [],
    ...over,
  };
}

/** The common shape: a replace script, the document untouched, stdin without a final LF. */
function decide(m: ScriptMeta | null, r: RunResult, o: { at?: number; now?: number; lf?: boolean } = {}) {
  return decideApply(m, r, o.at ?? 7, o.now ?? o.at ?? 7, o.lf ?? false);
}

// ---------------------------------------------------------------------------
// 1-3. The run itself
// ---------------------------------------------------------------------------

describe('decideApply: a run that is not usable', () => {
  it('applies nothing on a non-zero exit, and names the code', () => {
    const decision = decide(meta('replace'), result({ exitCode: 2, success: false, stdout: 'G0 X0' }));
    expect(decision).toEqual({ kind: 'error', reason: { key: 'scripts.errExitCode', params: { code: 2 } } });
  });

  it('keeps stderr for the output panel, and out of the reason', () => {
    const decision = decide(
      meta('replace'),
      result({ exitCode: 1, success: false, stderr: 'Traceback…\n' }),
    );
    expect(decision).toMatchObject({ kind: 'error', stderr: 'Traceback…\n' });
    expect(decision).toMatchObject({ reason: { key: 'scripts.errExitCode' } });
  });

  it('separates a signal from an exit code', () => {
    const decision = decide(meta('replace'), result({ exitCode: null, success: false }));
    expect(decision).toEqual({ kind: 'error', reason: { key: 'scripts.errKilled' } });
  });

  it('calls a cancelled run cancelled, although it also exited non-zero', () => {
    const decision = decide(
      meta('replace'),
      result({ cancelled: true, timedOut: false, success: false, exitCode: null }),
    );
    expect(decision).toEqual({ kind: 'error', reason: { key: 'scripts.errCancelled' } });
  });

  it('calls a timed-out run timed out, although it was killed and truncated', () => {
    const decision = decide(
      meta('replace'),
      result({ timedOut: true, success: false, exitCode: null, stdoutTruncated: true, durationMs: 60_400 }),
    );
    expect(decision).toEqual({
      kind: 'error',
      reason: { key: 'scripts.errTimeout', params: { seconds: 60 } },
    });
  });

  it('prefers the cancel over the timeout when a cancel raced the deadline', () => {
    const decision = decide(meta('replace'), result({ cancelled: true, timedOut: true, success: false }));
    expect(decision).toMatchObject({ reason: { key: 'scripts.errCancelled' } });
  });
});

// ---------------------------------------------------------------------------
// 4-5. The v1 fallback
// ---------------------------------------------------------------------------

describe('decideApply: the v1 fallback', () => {
  it('a script with no header is a panel run, whatever stdout holds', () => {
    expect(decide(null, result({ stdout: '{"text":"G0 X0"}' }))).toEqual({ kind: 'panel' });
  });

  it('never reads a headerless script as replace, not even with a changed document', () => {
    expect(decide(null, result({ stdout: 'G0 X0' }), { at: 1, now: 9 })).toEqual({ kind: 'panel' });
  });

  it('an explicit panel script is a panel run', () => {
    expect(decide(meta('panel'), result({ stdout: 'anything at all' }))).toEqual({ kind: 'panel' });
  });

  it('a panel run with empty stdout is still a panel run, not an error', () => {
    expect(decide(meta('panel'), result({ stdout: '' }))).toEqual({ kind: 'panel' });
  });
});

// ---------------------------------------------------------------------------
// 6. Reports
// ---------------------------------------------------------------------------

const REPORT = {
  title: 'Tool list',
  message: '8 tools, 2 without description',
  columns: [
    { key: 'tool', label: 'T' },
    { key: 'line', label: 'Line' },
  ],
  rows: [{ tool: 1, line: 12 }],
  findings: [{ line: 250, severity: 'warning', message: 'Feed move while the spindle is stopped' }],
};

describe('decideApply: report validation', () => {
  it('passes a well-formed report through, without a document id', () => {
    const decision = decide(meta('report'), result({ stdout: JSON.stringify(REPORT) }));
    expect(decision).toEqual({
      kind: 'report',
      report: {
        title: 'Tool list',
        message: '8 tools, 2 without description',
        columns: REPORT.columns,
        rows: REPORT.rows,
        findings: [{ line: 250, severity: 'warning', message: 'Feed move while the spindle is stopped' }],
      },
    });
  });

  it('refuses stdout that is not JSON', () => {
    expect(decide(meta('report'), result({ stdout: 'Traceback (most recent call last)' }))).toEqual({
      kind: 'error',
      reason: { key: 'scripts.errReport' },
    });
  });

  it('refuses empty stdout', () => {
    expect(decide(meta('report'), result({ stdout: '' }))).toMatchObject({
      reason: { key: 'scripts.errReport' },
    });
  });

  it.each([
    ['no title', { ...REPORT, title: undefined }],
    ['a title that is not a string', { ...REPORT, title: 7 }],
    ['columns that are not a list', { ...REPORT, columns: { tool: 'T' } }],
    ['a column without a label', { ...REPORT, columns: [{ key: 'tool' }] }],
    ['rows that are not a list', { ...REPORT, rows: 'none' }],
    ['a row that is not an object', { ...REPORT, rows: [['tool', 1]] }],
    ['findings that are not a list', { ...REPORT, findings: 'none' }],
    ['a finding without a line', { ...REPORT, findings: [{ message: 'x' }] }],
    ['a finding whose line is not a number', { ...REPORT, findings: [{ line: '250', message: 'x' }] }],
    ['a finding without a message', { ...REPORT, findings: [{ line: 250 }] }],
    ['a top-level list', [REPORT]],
  ])('refuses a report with %s', (_name, payload) => {
    expect(decide(meta('report'), result({ stdout: JSON.stringify(payload) }))).toMatchObject({
      kind: 'error',
      reason: { key: 'scripts.errReport' },
    });
  });

  it('accepts a report with no message and no findings', () => {
    const decision = decide(
      meta('report'),
      result({ stdout: JSON.stringify({ title: 'Empty', columns: [], rows: [] }) }),
    );
    expect(decision).toEqual({ kind: 'report', report: { title: 'Empty', columns: [], rows: [] } });
  });

  it('drops a severity it does not know rather than the whole report', () => {
    const report = parseReport(
      JSON.stringify({ ...REPORT, findings: [{ line: 3, message: 'x', severity: 'fatal' }] }),
    );
    expect(report?.findings).toEqual([{ line: 3, message: 'x' }]);
  });

  it('keeps a finding pointing at another document', () => {
    const report = parseReport(
      JSON.stringify({ ...REPORT, findings: [{ line: 3, message: 'x', document: 'op2.nc' }] }),
    );
    expect(report?.findings).toEqual([{ line: 3, message: 'x', document: 'op2.nc' }]);
  });

  it('shows a report even when the document changed while it ran', () => {
    const decision = decide(meta('report'), result({ stdout: JSON.stringify(REPORT) }), { at: 1, now: 4 });
    expect(decision).toMatchObject({ kind: 'report' });
  });
});

// ---------------------------------------------------------------------------
// 7a. Envelopes
// ---------------------------------------------------------------------------

describe('decideApply: envelope validation', () => {
  const enveloped = meta('replace', { envelope: true });

  it('carries the text, the message and the findings', () => {
    const stdout = JSON.stringify({
      text: 'N10 G1 F90.\n',
      message: '3 feeds scaled',
      findings: [{ line: 12, message: 'G84: pitch feed', severity: 'info' }],
    });
    expect(decide(enveloped, result({ stdout }))).toEqual({
      kind: 'replace',
      text: 'N10 G1 F90.\n',
      message: '3 feeds scaled',
      findings: [{ line: 12, message: 'G84: pitch feed', severity: 'info' }],
    });
  });

  it('does not drop the envelope text’s trailing newline: the script chose it', () => {
    const stdout = JSON.stringify({ text: 'N10\n' });
    expect(decide(enveloped, result({ stdout }), { lf: false })).toMatchObject({ text: 'N10\n' });
  });

  it.each([
    ['plain text', 'N10 G1 F90.'],
    ['a list', '["N10"]'],
    ['an object without text', '{"message":"done"}'],
    ['a text that is not a string', '{"text":["N10"]}'],
    ['a broken finding', '{"text":"N10","findings":[{"line":1}]}'],
    ['nothing at all', ''],
  ])('refuses %s', (_name, stdout) => {
    expect(decide(enveloped, result({ stdout }))).toMatchObject({
      kind: 'error',
      reason: { key: 'scripts.errEnvelope' },
    });
  });

  it('an empty envelope text in replace mode is still the empty-output error', () => {
    expect(decide(enveloped, result({ stdout: '{"text":""}' }))).toMatchObject({
      reason: { key: 'scripts.errEmptyOutput' },
    });
  });

  it('parses an envelope on its own', () => {
    expect(parseEnvelope('{"text":"A\\r\\nB"}')).toEqual({ text: 'A\nB' });
    expect(parseEnvelope('not json')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7b-e. Text that goes back into a document
// ---------------------------------------------------------------------------

describe('decideApply: replace and new-document', () => {
  it('replaces with plain stdout', () => {
    expect(decide(meta('replace'), result({ stdout: 'N10\nN20' }))).toEqual({
      kind: 'replace',
      text: 'N10\nN20',
    });
  });

  it('drops the one newline print() added when the input had none', () => {
    expect(decide(meta('replace'), result({ stdout: 'N10\nN20\n' }), { lf: false })).toMatchObject({
      text: 'N10\nN20',
    });
  });

  it('keeps the trailing newline when the input ended with one', () => {
    expect(decide(meta('replace'), result({ stdout: 'N10\nN20\n' }), { lf: true })).toMatchObject({
      text: 'N10\nN20\n',
    });
  });

  it('drops only one newline, so a deliberate empty last block survives', () => {
    expect(decide(meta('replace'), result({ stdout: 'N10\n\n' }), { lf: false })).toMatchObject({
      text: 'N10\n',
    });
  });

  it('puts CRLF into the LF form a document is held in', () => {
    expect(decide(meta('replace'), result({ stdout: 'N10\r\nN20\r\n' }), { lf: false })).toMatchObject({
      text: 'N10\nN20',
    });
  });

  it('turns a lone CR into a line break too', () => {
    expect(decide(meta('replace'), result({ stdout: 'N10\rN20' }))).toMatchObject({ text: 'N10\nN20' });
  });

  it('refuses empty stdout in replace mode instead of deleting the selection', () => {
    expect(decide(meta('replace'), result({ stdout: '' }))).toEqual({
      kind: 'error',
      reason: { key: 'scripts.errEmptyOutput' },
    });
  });

  it('refuses stdout that was only the one newline in replace mode', () => {
    expect(decide(meta('replace'), result({ stdout: '\n' }), { lf: false })).toMatchObject({
      reason: { key: 'scripts.errEmptyOutput' },
    });
  });

  it('refuses truncated output: a prefix of a program ends mid-cut', () => {
    expect(decide(meta('replace'), result({ stdout: 'N10\nN2', stdoutTruncated: true }))).toEqual({
      kind: 'error',
      reason: { key: 'scripts.errTruncated' },
    });
  });

  it('refuses truncated output for a new document as well', () => {
    expect(
      decide(meta('new-document'), result({ stdout: 'N10', stdoutTruncated: true })),
    ).toMatchObject({ reason: { key: 'scripts.errTruncated' } });
  });

  it('opens a new document even with empty stdout: nothing is overwritten', () => {
    expect(decide(meta('new-document'), result({ stdout: '' }))).toEqual({
      kind: 'new-document',
      text: '',
    });
  });
});

describe('decideApply: the stale guard', () => {
  it('refuses to replace a document that changed while the script ran', () => {
    const decision = decide(meta('replace'), result({ stdout: 'N10 G1 F90.' }), { at: 4, now: 5 });
    expect(decision).toEqual({ kind: 'stale', text: 'N10 G1 F90.' });
  });

  it('keeps the text, so it can still be opened in a new tab', () => {
    const stdout = JSON.stringify({ text: 'N10 G1 F90.', message: 'ignored while stale' });
    const decision = decide(meta('replace', { envelope: true }), result({ stdout }), { at: 1, now: 2 });
    expect(decision).toEqual({ kind: 'stale', text: 'N10 G1 F90.' });
  });

  it('does not apply to new-document, which overwrites nothing', () => {
    const decision = decide(meta('new-document'), result({ stdout: 'N10' }), { at: 1, now: 2 });
    expect(decision).toEqual({ kind: 'new-document', text: 'N10' });
  });

  it('is checked after the empty and the truncated refusals, so the cause wins', () => {
    expect(decide(meta('replace'), result({ stdout: '' }), { at: 1, now: 2 })).toMatchObject({
      reason: { key: 'scripts.errEmptyOutput' },
    });
    expect(
      decide(meta('replace'), result({ stdout: 'N10', stdoutTruncated: true }), { at: 1, now: 2 }),
    ).toMatchObject({ reason: { key: 'scripts.errTruncated' } });
  });
});

// ---------------------------------------------------------------------------
// Output that was cut off is named as that, whatever mode it was in (G8 M5)
// ---------------------------------------------------------------------------

describe('decideApply: truncated output is checked before anything is parsed', () => {
  // The envelope parse used to run first, so a script that wrote more than the runner's
  // cap was told its output "was not a valid result" — a different problem with a
  // different fix. Nothing was applied either way; the message named the wrong cause.
  it('names the cut, not the broken JSON, for an envelope that was cut mid-object', () => {
    const cut = JSON.stringify({ text: 'N10 G1 F90.', message: 'scaled' }).slice(0, 20);
    expect(
      decide(meta('replace', { envelope: true }), result({ stdout: cut, stdoutTruncated: true })),
    ).toEqual({ kind: 'error', reason: { key: 'scripts.errTruncated' } });
  });

  it('does the same for a report that was cut mid-object', () => {
    const cut = JSON.stringify({ title: 'Tool list', columns: [], rows: [] }).slice(0, 15);
    expect(decide(meta('report'), result({ stdout: cut, stdoutTruncated: true }))).toEqual({
      kind: 'error',
      reason: { key: 'scripts.errTruncated' },
    });
  });

  // Still after the three reasons the run itself gives: a timed-out run is usually
  // truncated too, and "it ran out of time" is the cause the user can act on.
  it('stays below cancelled, timed out and a non-zero exit', () => {
    expect(
      decide(meta('report'), result({ stdoutTruncated: true, timedOut: true, success: false })),
    ).toMatchObject({ reason: { key: 'scripts.errTimeout' } });
    expect(
      decide(meta('report'), result({ stdoutTruncated: true, cancelled: true, success: false })),
    ).toMatchObject({ reason: { key: 'scripts.errCancelled' } });
  });

  // A panel run *is* its raw output, and the panel flags the cut itself.
  it('still shows a truncated panel run', () => {
    expect(decide(meta('panel'), result({ stdout: 'a lot of', stdoutTruncated: true }))).toEqual({
      kind: 'panel',
    });
  });
});

// ---------------------------------------------------------------------------
// The boundary cap on what one run may hand to the Results panel (G8 M5)
// ---------------------------------------------------------------------------

describe('decideApply: findings and rows are bounded', () => {
  /** `count` findings, each on its own line, as a script would write them. */
  const manyFindings = (count: number): { line: number; message: string }[] =>
    Array.from({ length: count }, (_, i) => ({ line: i + 1, message: `F${i + 1}` }));

  it('keeps an envelope’s findings under the cap and counts the rest', () => {
    const stdout = JSON.stringify({ text: 'N10', findings: manyFindings(MAX_FINDINGS + 42) });
    const decision = decide(meta('replace', { envelope: true }), result({ stdout }));
    expect(decision).toMatchObject({ kind: 'replace', dropped: 42 });
    if (decision.kind !== 'replace') return;
    expect(decision.findings).toHaveLength(MAX_FINDINGS);
    // The ones that are shown are the first ones, in the order the script wrote them.
    expect(decision.findings?.[0]).toEqual({ line: 1, message: 'F1' });
  });

  it('says nothing about dropping when everything fitted', () => {
    const stdout = JSON.stringify({ text: 'N10', findings: manyFindings(3) });
    expect(decide(meta('replace', { envelope: true }), result({ stdout }))).toEqual({
      kind: 'replace',
      text: 'N10',
      findings: manyFindings(3),
    });
  });

  it('caps a report’s rows and its findings, and reports the total left out', () => {
    const rows = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({ tool: i + 1 }));
    const stdout = JSON.stringify({
      title: 'Tool list',
      columns: [{ key: 'tool', label: 'T' }],
      rows,
      findings: manyFindings(MAX_FINDINGS + 2),
    });
    const decision = decide(meta('report'), result({ stdout }));
    expect(decision.kind).toBe('report');
    if (decision.kind !== 'report') return;
    expect(decision.report.rows).toHaveLength(MAX_ROWS);
    expect(decision.report.findings).toHaveLength(MAX_FINDINGS);
    expect(decision.report.dropped).toBe(7);
  });

  it('leaves a report that fits exactly as it was', () => {
    const stdout = JSON.stringify({
      title: 'Tool list',
      columns: [{ key: 'tool', label: 'T' }],
      rows: [{ tool: 1 }, { tool: 2 }],
    });
    expect(parseReport(stdout)).toEqual({
      title: 'Tool list',
      columns: [{ key: 'tool', label: 'T' }],
      rows: [{ tool: 1 }, { tool: 2 }],
    });
  });

  // The cap is not a licence to accept rubbish: everything that *is* shown is still
  // validated, and one bad finding inside the cap still refuses the whole payload.
  it('still refuses a malformed finding inside the cap', () => {
    const findings = [...manyFindings(5), { line: 'six', message: 'F6' }];
    expect(parseEnvelope(JSON.stringify({ text: 'N10', findings }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The closed list WP5.2 writes its namespace against
// ---------------------------------------------------------------------------

describe('APPLY_ERROR_KEYS', () => {
  it('is the set of reasons decideApply can actually give', () => {
    const runs: [ScriptMeta | null, RunResult, { at?: number; now?: number }][] = [
      [meta('replace'), result({ cancelled: true, success: false }), {}],
      [meta('replace'), result({ timedOut: true, success: false }), {}],
      [meta('replace'), result({ success: false, exitCode: 3 }), {}],
      [meta('replace'), result({ success: false, exitCode: null }), {}],
      [meta('replace'), result({ stdout: '' }), {}],
      [meta('replace'), result({ stdout: 'N10', stdoutTruncated: true }), {}],
      [meta('replace', { envelope: true }), result({ stdout: 'no' }), {}],
      [meta('report'), result({ stdout: 'no' }), {}],
    ];
    const seen = runs.map(([m, r, o]) => {
      const decision = decide(m, r, o);
      return decision.kind === 'error' ? decision.reason.key : decision.kind;
    });
    expect([...new Set(seen)].sort()).toEqual([...APPLY_ERROR_KEYS].sort());
  });

  it('names only keys of the scripts namespace', () => {
    expect(APPLY_ERROR_KEYS.every((key) => key.startsWith('scripts.'))).toBe(true);
    expect(new Set(APPLY_ERROR_KEYS).size).toBe(APPLY_ERROR_KEYS.length);
  });
});
