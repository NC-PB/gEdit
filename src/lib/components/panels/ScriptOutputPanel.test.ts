// The v2 Output panel (plan §5 WP5.2, §7.9: `output-panel` with `data-running`,
// `output-stdout`, `output-stderr`, `output-json`, `output-cancel`).
//
// Two halves, like `ResultsPanel.test.ts`. The stdout/JSON rules are pure functions out of
// `<script module>` and are tested directly, because "is this stdout the same JSON again"
// is the one piece of display logic that can silently hide a script's real output. The
// markup is rendered with `svelte/server`, so there is no DOM, no Monaco and no `$effect`,
// and what is checked is the seam the runtime harness reads.
//
// `core/scripting/filter.ts` is WP5.1's and still the P5 stub, so `scriptLabel` is faked
// here: these tests are about the panel, not about the filter.

import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunResult, ScriptEntry } from '$lib/platform/commands';

vi.mock('$lib/core/scripting/filter', () => ({
  scriptLabel: (entry: ScriptEntry) => entry.meta?.name || entry.fileName,
  scriptsForProfile: (entries: ScriptEntry[]) => entries,
  groupScripts: (entries: ScriptEntry[]) => [{ group: null, scripts: entries }],
}));

const ScriptOutputPanel = (await import('./ScriptOutputPanel.svelte')).default;
const { isStructured, parseStructured, stdoutIsJson, seconds } = await import(
  './ScriptOutputPanel.svelte'
);
const { MAX_OUTPUT_PREVIEW, outputFromRun, resetScriptsForTest, runningScript, scriptOutput } =
  await import('$lib/stores/scripts');
const { t } = await import('$lib/i18n');

afterEach(resetScriptsForTest);

const RUN: RunResult = {
  exitCode: 0,
  success: true,
  stdout: '',
  stderr: '',
  timedOut: false,
  cancelled: false,
  stdoutTruncated: false,
  durationMs: 1234,
  interpreter: '/usr/bin/python3',
};

function show(r: Partial<RunResult>, json: unknown = null): void {
  scriptOutput.set(outputFromRun('bundled:x.py', 'Scale feed', { ...RUN, ...r }, json));
}

const panel = (): string => render(ScriptOutputPanel).body;

describe('structured output', () => {
  it('counts only a non-empty object or array as a structured result', () => {
    expect(isStructured({ a: 1 })).toBe(true);
    expect(isStructured([1])).toBe(true);
    expect(isStructured({})).toBe(false);
    expect(isStructured([])).toBe(false);
    expect(isStructured(null)).toBe(false);
    expect(isStructured('text')).toBe(false);
    expect(isStructured(42)).toBe(false);
  });

  it('parses stdout only when it really is a structured result', () => {
    expect(parseStructured('{"tools": 3}')).toEqual({ tools: 3 });
    expect(parseStructured('  [1, 2]  ')).toEqual([1, 2]);
    expect(parseStructured('42')).toBeNull();
    expect(parseStructured('N10 G0 X0')).toBeNull();
    expect(parseStructured('')).toBeNull();
  });

  it('recognises stdout that is only the same JSON written out', () => {
    expect(stdoutIsJson('{"ok":true}\n', { ok: true })).toBe(true);
    expect(stdoutIsJson('{"ok":true}', { ok: false })).toBe(false);
    expect(stdoutIsJson('raw text', { ok: true })).toBe(false);
    expect(stdoutIsJson('{"ok":true}', null)).toBe(false);
  });

  it('shows a fraction of a second rather than rounding a fast run to zero', () => {
    expect(seconds(40)).toBe('0.0');
    expect(seconds(1234)).toBe('1.2');
    expect(seconds(-5)).toBe('0.0');
  });
});

describe('ScriptOutputPanel', () => {
  it('reports whether a script is running', () => {
    expect(panel()).toContain('data-running="0"');
    runningScript.set({ runId: 'r1', scriptId: 'bundled:x.py', startedAt: Date.now() });
    expect(panel()).toContain('data-running="1"');
  });

  it('keeps Cancel in the DOM and enables it only while a script runs', () => {
    expect(panel()).toContain('data-testid="output-cancel"');
    expect(panel()).toMatch(/data-testid="output-cancel"[^>]*disabled/);
    runningScript.set({ runId: 'r1', scriptId: 'bundled:x.py', startedAt: Date.now() });
    expect(panel()).not.toMatch(/data-testid="output-cancel"[^>]*disabled/);
  });

  it('shows structured data, stdout and stderr under their own test ids', () => {
    show({ stdout: 'raw text', stderr: 'boom' }, { len: 3 });
    const html = panel();
    expect(html).toContain('data-testid="output-json"');
    expect(html).toContain('data-testid="output-stdout"');
    expect(html).toContain('data-testid="output-stderr"');
    expect(html).toContain('"len": 3');
  });

  it('does not repeat the JSON a script also printed on stdout', () => {
    show({ stdout: JSON.stringify({ ok: true }) }, { ok: true });
    const html = panel();
    expect(html).toContain('data-testid="output-json"');
    expect(html).not.toContain('data-testid="output-stdout"');
  });

  it('parses stdout itself when the service left `json` null, so the M0 seam holds', () => {
    // A script with no header runs in panel mode (the v1 fallback) and prints its result
    // as JSON; `m0-main` reads it back out of `output-json`.
    show({ stdout: '{"tools": ["T1", "T2"]}' });
    const html = panel();
    expect(html).toContain('data-testid="output-json"');
    expect(html).toContain('"T1"');
    expect(html).not.toContain('data-testid="output-stdout"');
  });

  it('shows plain stdout as stdout and never as a structured result', () => {
    show({ stdout: 'N10 G0 X0\nN20 G1 Z-1\n' });
    const html = panel();
    expect(html).toContain('data-testid="output-stdout"');
    expect(html).not.toContain('data-testid="output-json"');
  });

  // G8 M5: a `replace` run's stdout is a whole program, up to the runner's 64 MiB cap,
  // and this `<pre>` wraps it. `stores/scripts.ts` cuts it; the panel says it did.
  it('says how much of a program-sized stdout it is not showing', () => {
    const length = MAX_OUTPUT_PREVIEW + 500;
    show({ stdout: 'G'.repeat(length) });
    const html = panel();
    expect(html).toContain('data-testid="output-stdout"');
    expect(html).toContain(t('scripts.outputCut', { count: 500 }));
  });

  it('says nothing about cutting when the whole run fitted', () => {
    show({ stdout: 'N10 G0 X0\n' });
    expect(panel()).not.toContain('not shown here');
  });

  it('names the script, its exit code, its duration and its interpreter', () => {
    show({ exitCode: 2, success: false, stderr: 'Traceback' });
    const html = panel();
    expect(html).toContain('Scale feed');
    expect(html).toContain('Exit code 2');
    expect(html).toContain('1.2 s');
    expect(html).toContain('/usr/bin/python3');
  });

  it('says a run timed out, was stopped or was cut off', () => {
    show({ exitCode: null, success: false, timedOut: true, stdoutTruncated: true });
    const html = panel();
    expect(html).toContain('Timed out');
    expect(html).toContain('Output cut off');
    expect(html).toContain('Stopped by a signal');
  });

  it('offers a hint before the first run and after a silent one', () => {
    expect(panel()).toContain('Run a Python script to see its output here.');
    show({});
    expect(panel()).toContain('The script printed nothing on stdout.');
  });
});
