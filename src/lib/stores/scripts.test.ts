// The script stores (plan §5 WP5.1). Written by P5 with the module; WP5.1 extends it.
//
// Two things are worth pinning before any of the runner exists, because the rest of the
// app already depends on them: `isScriptRunning()` is what `bootstrap.ts` puts in the
// command context, and `pythonStatus` starts at **null meaning "not asked yet"**, which is
// the state the UI is in between the first render and the probe coming back.

import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_JSON_PREVIEW,
  MAX_OUTPUT_PREVIEW,
  jsonFromStdout,
  isScriptRunning,
  lastScriptId,
  outputFromRun,
  pythonStatus,
  resetScriptOutput,
  resetScriptsForTest,
  runningScript,
  scriptOutput,
} from './scripts';
import type { RunResult } from '$lib/platform/commands';

const RESULT: RunResult = {
  exitCode: 0,
  success: true,
  stdout: '{"text":"G0 X0"}\n',
  stderr: 'warning: no tool found\n',
  timedOut: false,
  cancelled: false,
  stdoutTruncated: false,
  durationMs: 42,
  interpreter: '/usr/bin/python3',
};

describe('script stores', () => {
  beforeEach(() => resetScriptsForTest());

  it('starts with an unknown Python status, not a missing one', () => {
    expect(get(pythonStatus)).toBeNull();
  });

  it('reports the running flag the command context reads', () => {
    expect(isScriptRunning()).toBe(false);
    runningScript.set({ runId: 'r1', scriptId: 'bundled:tool_list.py', docId: 'd1', startedAt: 1 });
    expect(isScriptRunning()).toBe(true);
    runningScript.set(null);
    expect(isScriptRunning()).toBe(false);
  });

  it('keeps stderr and the timings of a finished run for the panel', () => {
    const out = outputFromRun('bundled:tool_list.py', 'Tool list', RESULT, { text: 'G0 X0' });
    expect(out).toMatchObject({
      scriptId: 'bundled:tool_list.py',
      scriptName: 'Tool list',
      stderr: 'warning: no tool found\n',
      json: { text: 'G0 X0' },
      durationMs: 42,
      interpreter: '/usr/bin/python3',
      success: true,
    });
  });

  it('parses nothing by itself: `json` is null unless the caller parsed stdout', () => {
    expect(outputFromRun('user:x.py', 'x.py', RESULT).json).toBeNull();
  });

  it('clears the previous output but not the rest of the state', () => {
    scriptOutput.set(outputFromRun('user:x.py', 'x.py', RESULT));
    lastScriptId.set('user:x.py');
    resetScriptOutput();
    expect(get(scriptOutput)).toBeNull();
    expect(get(lastScriptId)).toBe('user:x.py');
  });

  it('the test seam puts every store back to a fresh app', () => {
    pythonStatus.set({ ok: true, interpreter: 'python3', version: '3.12.1', message: null });
    lastScriptId.set('user:x.py');
    runningScript.set({ runId: 'r1', scriptId: 'user:x.py', docId: 'd1', startedAt: 1 });
    resetScriptsForTest();
    expect(get(pythonStatus)).toBeNull();
    expect(get(lastScriptId)).toBeNull();
    expect(get(runningScript)).toBeNull();
  });

  // I5: the service and `ScriptOutputPanel` each had their own copy of this, and the
  // panel's had no size cap — so it re-parsed, on the UI thread, the program the service
  // had skipped. One function now, and these are its rules.
  // G8 M5. A `replace` run's stdout is a whole program — the perf scenarios use 300k
  // lines and ~10 MiB, and the runner's own cap is 64 MiB — and the Output panel draws it
  // into a `<pre>` with `white-space: pre-wrap`, which is a full text-wrap layout pass on
  // the UI thread. It is cut here rather than in the component, so the 64 MiB string is
  // not held in a store for the rest of the session either.
  describe('the output preview cap', () => {
    const big = (length: number): RunResult => ({ ...RESULT, stdout: 'G'.repeat(length) });

    it('keeps a normal run whole and says nothing was left out', () => {
      const out = outputFromRun('user:x.py', 'x', RESULT);
      expect(out.stdout).toBe(RESULT.stdout);
      expect(out.stdoutLength).toBe(RESULT.stdout.length);
      expect(out.stderr).toBe(RESULT.stderr);
      expect(out.stderrLength).toBe(RESULT.stderr.length);
    });

    it('cuts a program-sized stdout and records how long it really was', () => {
      const length = MAX_OUTPUT_PREVIEW + 5000;
      const out = outputFromRun('user:x.py', 'x', big(length));
      expect(out.stdout).toHaveLength(MAX_OUTPUT_PREVIEW);
      expect(out.stdoutLength).toBe(length);
    });

    it('keeps stdout that is exactly the cap', () => {
      const out = outputFromRun('user:x.py', 'x', big(MAX_OUTPUT_PREVIEW));
      expect(out.stdout).toHaveLength(MAX_OUTPUT_PREVIEW);
      expect(out.stdoutLength).toBe(MAX_OUTPUT_PREVIEW);
    });

    it('cuts stderr by the same rule', () => {
      const length = MAX_OUTPUT_PREVIEW + 1;
      const out = outputFromRun('user:x.py', 'x', { ...RESULT, stderr: 'e'.repeat(length) });
      expect(out.stderr).toHaveLength(MAX_OUTPUT_PREVIEW);
      expect(out.stderrLength).toBe(length);
    });

    it('is the same size as the JSON cap, so the two never disagree', () => {
      expect(MAX_OUTPUT_PREVIEW).toBe(MAX_JSON_PREVIEW);
    });
  });

  describe('jsonFromStdout', () => {
    it('answers with the parsed value for a JSON object or array', () => {
      expect(jsonFromStdout('{"a": 1}')).toEqual({ a: 1 });
      expect(jsonFromStdout('  [1, 2]  ')).toEqual([1, 2]);
    });

    it('answers null for anything that is not a JSON object or array', () => {
      expect(jsonFromStdout('')).toBeNull();
      expect(jsonFromStdout('G0 X0\nG1 Y1\n')).toBeNull();
      expect(jsonFromStdout('"a string"')).toBeNull();
      expect(jsonFromStdout('42')).toBeNull();
      expect(jsonFromStdout('{not json')).toBeNull();
    });

    it('does not even try above the cap: a replace run\'s stdout is a program', () => {
      const big = `{"text": "${'G1 X1.'.repeat(MAX_JSON_PREVIEW / 6)}"}`;
      expect(big.length).toBeGreaterThan(MAX_JSON_PREVIEW);
      expect(jsonFromStdout(big)).toBeNull();
      // And the same payload under the cap does parse, so the cap is what refused it.
      expect(jsonFromStdout('{"text": "G1 X1."}')).toEqual({ text: 'G1 X1.' });
    });
  });
});
