// Wall-clock budgets in unit tests, and what they mean on CI.
//
// The budgets of gate G7 are measured on the development machine (phase-2-implementation.md
// §5.2). A unit test that asserts one of them is a cheap early warning, but CI is another
// machine: a small shared VM that runs many test files in parallel and is several times
// slower for this kind of work. So on CI (`CI` set, as GitHub Actions does) a budget is
// multiplied by `CI_FACTOR`; locally it is the budget itself, and G7 still bites where it
// was measured. CI then catches a gross regression and never the development machine's
// budget.
//
// Use `expectWithin` for a budget below about 100 ms, or with less than tenfold room over what
// the development machine measures. A budget that is already generous (seconds, for a few
// hundred milliseconds of work) needs no scaling and stays a plain `expect`. The test timeout
// (`testTimeout` in vitest.config.ts) is a wall-clock limit as well, and a scaled budget must
// stay under it.
//
// A test that times a steady state warms up first (one untimed call: regexes compile on
// their first use) and keeps the fastest of a few runs; `fastest` does both.
//
// `BUDGET_LOG=<file>` appends one line per checked budget (measured, scaled budget, test, what),
// to report how much room the tests have on a given machine.

import { appendFileSync } from 'node:fs';
import { expect } from 'vitest';

/**
 * The CI slowdown allowed for. The one measurement that failed there (400 lines, detection,
 * 1.1 ms here when it ran alone, 7 ms on the runner, no warm-up) was six times slower. The
 * bulk work is not: the same CI log has the 300k-line tokenizer at about 1 s and the 100k-line
 * renumber at 0.5 to 0.9 s, the speed of the development machine. So only the tight budgets
 * are scaled, by 5: that covers the six-fold slowdown of a sub-millisecond measurement
 * once the best of several runs keeps the worst noise out. A regression that matters is an
 * order of magnitude, not a factor of five.
 */
export const CI_FACTOR = 5;

/** `CI` as GitHub Actions sets it (`true`); empty, `0` and `false` mean a local run. */
export function onCi(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.CI ?? '').toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}

/** A budget in milliseconds as this machine has to meet it: `ms` locally, `ms * CI_FACTOR` on CI. */
export function budgetMs(ms: number): number {
  return onCi() ? ms * CI_FACTOR : ms;
}

/** The text that says which budget a failed assertion was held to. */
export function describeBudget(ms: number): string {
  return onCi() ? `budget ${ms} ms x ${CI_FACTOR} on CI = ${budgetMs(ms)} ms` : `budget ${ms} ms`;
}

function log(measured: number, ms: number, what: string): void {
  const file = process.env.BUDGET_LOG;
  if (!file) return;
  try {
    appendFileSync(file, `${measured.toFixed(3)}\t${budgetMs(ms)}\t${expect.getState().currentTestName}\t${what}\n`);
  } catch {
    // The report is optional.
  }
}

/** Asserts that `measured` (ms) is under the budget `ms`, scaled on CI; `what` names the measurement. */
export function expectWithin(measured: number, ms: number, what: string): void {
  log(measured, ms, what);
  expect(measured, `${what}; ${describeBudget(ms)}`).toBeLessThan(budgetMs(ms));
}

/**
 * The fastest of `runs` timed calls of `work`, in milliseconds, after one untimed call:
 * the first call pays for regex compilation and cold caches, which is not what a budget
 * for the steady state means, and one run on a loaded machine says nothing.
 */
export function fastest(runs: number, work: () => void): number {
  work();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    work();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}
