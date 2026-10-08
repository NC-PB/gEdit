import { describe, expect, it, vi } from 'vitest';
import { capRows, createDebouncedRun, TESTER_DELAY_MS, TESTER_MAX_ROWS } from './testerRun';

function clock() {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  return {
    timers,
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return () => {
        t.live = false;
      };
    },
    advance: () => timers.splice(0).forEach((t) => t.live && t.fn()),
  };
}

describe('the tester run (CODE-15)', () => {
  it('does not run on each of ten changes, only once after the last (debounce)', () => {
    const c = clock();
    const run = vi.fn();
    const runner = createDebouncedRun(run, c.schedule);
    for (let i = 0; i < 10; i++) runner.request(i);
    expect(run).not.toHaveBeenCalled();
    expect(c.timers.every((t) => t.ms === TESTER_DELAY_MS)).toBe(true);
    c.advance();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(9);
  });

  it('can be cancelled', () => {
    const c = clock();
    const run = vi.fn();
    const runner = createDebouncedRun(run, c.schedule);
    runner.request(1);
    runner.cancel();
    c.advance();
    expect(run).not.toHaveBeenCalled();
  });

  it('caps the rows and counts the rest', () => {
    const rows = Array.from({ length: TESTER_MAX_ROWS + 7 }, (_, i) => i);
    const capped = capRows(rows);
    expect(capped.shown).toHaveLength(TESTER_MAX_ROWS);
    expect(capped.more).toBe(7);
    expect(capRows([1, 2])).toEqual({ shown: [1, 2], more: 0 });
  });
});
