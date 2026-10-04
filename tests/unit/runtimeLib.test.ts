// The pure helpers of the runtime harness's scenarios (tests/runtime/lib), held to the
// cases a hosted run found, so a scenario's expectation is wrong in `npm test` first and
// not only on the runner.

import { describe, expect, it } from 'vitest';
import { expectedEnd, selectsSegment } from '../runtime/lib/segments.js';
import { awaitReport } from '../runtime/lib/awaitReport.js';
import { trimBlankEnd } from '$lib/contrib/segments';

type Selection = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
const select = (a: number, b: number, c: number, d: number): Selection => ({ startLineNumber: a, startColumn: b, endLineNumber: c, endColumn: d });

describe('the tool-segment expectation of m10-blockskip', () => {
  // tests/fixtures/nc/fanuc/f01-mill-3tools.nc: 67 lines, the last is `%`, and the file ends in
  // CRLF, so the editor has an empty line 68 and the outline's third tool item ends on it.
  const lines = Array.from({ length: 68 }, (_v, i) => (i === 66 ? '%' : i === 67 ? '' : `G1 X${i}`));
  const lineAt = (n: number): string => lines[n - 1] ?? '';

  it('ends the last segment on the last line with text, as the command does', () => {
    expect(expectedEnd(49, 68, lineAt)).toBe(67);
    expect(expectedEnd(49, 68, lineAt)).toBe(trimBlankEnd(49, 68, lineAt));
  });

  it('accepts the selection the CI run recorded for tool 3: 49:1 to 67:2', () => {
    expect(selectsSegment(select(49, 1, 67, 2), 49, 68, lineAt)).toBe(true);
  });

  it('refuses a selection that includes the blank line, or stops short', () => {
    expect(selectsSegment(select(49, 1, 68, 1), 49, 68, lineAt)).toBe(false);
    expect(selectsSegment(select(49, 1, 66, 7), 49, 68, lineAt)).toBe(false);
    expect(selectsSegment(select(50, 1, 67, 2), 49, 68, lineAt)).toBe(false);
  });

  it('keeps the end of a segment that is followed by the next tool change', () => {
    expect(expectedEnd(5, 14, lineAt)).toBe(14);
    expect(selectsSegment(select(5, 1, 14, 'G1 X13'.length + 1), 5, 14, lineAt)).toBe(true);
  });

  it('never ends above its first line', () => {
    expect(expectedEnd(68, 68, lineAt)).toBe(68);
    expect(expectedEnd(70, 40, () => '')).toBe(70);
  });
});

describe('awaiting the report of a script started from the Tools tab', () => {
  // A fake clock: waitFor advances it by the interval until the probe answers or the timeout is over.
  const world = (reportAt: number, formAt: number | null = null) => {
    let clock = 0;
    let answered: number | null = null;
    const io = {
      now: () => clock,
      waitFor: async <T>(fn: () => T, options: { timeout: number; interval?: number }): Promise<T | undefined> => {
        const end = clock + options.timeout;
        for (;;) {
          const v = fn();
          if (v || clock >= end) return v;
          clock += options.interval ?? 50;
        }
      },
      formOpen: () => formAt !== null && answered === null && clock >= formAt,
      arrived: () => (clock >= reportAt && (formAt === null || answered !== null) ? { title: 'report' } : null),
      answerForm: async () => {
        answered = clock;
        return clock;
      },
    };
    return io;
  };

  it('waits as long as a script without a form takes: 90 s on 300,000 lines is not "no report"', async () => {
    const got = await awaitReport(world(90000), 330000);
    expect(got.how).toBe('report');
    expect(got.report).toEqual({ title: 'report' });
    expect(got.form).toBe(false);
    expect(got.ms).toBeGreaterThanOrEqual(90000);
  });

  it('answers a form when one comes, and times the run from OK', async () => {
    const got = await awaitReport(world(12000, 500), 60000);
    expect(got.form).toBe(true);
    expect(got.report).toEqual({ title: 'report' });
    expect(got.ms).toBeGreaterThanOrEqual(11000);
    expect(got.ms).toBeLessThan(12000);
  });

  it('says it was neither a form nor a report when the whole timeout passes', async () => {
    const got = await awaitReport(world(1e9), 60000);
    expect(got.how).toBe('nothing');
    expect(got.report).toBeNull();
  });

  it('gives a form its own full timeout after OK', async () => {
    const got = await awaitReport(world(5e5, 500), 100000);
    expect(got.how).toBe('form');
    expect(got.report).toBeNull();
    expect(got.ms).toBeGreaterThanOrEqual(100000);
  });
});
