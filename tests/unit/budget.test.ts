// The helper the wall-clock budgets of the unit tests go through (tests/unit/helpers/budget.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { budgetMs, CI_FACTOR, describeBudget, expectWithin, fastest, onCi } from './helpers/budget';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the CI factor', () => {
  it('leaves a budget alone on a local run', () => {
    vi.stubEnv('CI', '');
    expect(onCi()).toBe(false);
    expect(budgetMs(5)).toBe(5);
    expect(describeBudget(5)).toBe('budget 5 ms');
  });

  it('multiplies a budget by the factor when CI is set, as GitHub Actions sets it', () => {
    vi.stubEnv('CI', 'true');
    expect(onCi()).toBe(true);
    expect(budgetMs(5)).toBe(5 * CI_FACTOR);
    expect(describeBudget(5)).toBe(`budget 5 ms x ${CI_FACTOR} on CI = ${5 * CI_FACTOR} ms`);
  });

  it.each(['', '0', 'false', 'FALSE'])('reads CI=%j as a local run', (value) => {
    expect(onCi({ CI: value })).toBe(false);
  });

  it('reads an unset CI as a local run and any other value as CI', () => {
    expect(onCi({})).toBe(false);
    expect(onCi({ CI: '1' })).toBe(true);
  });
});

describe('expectWithin', () => {
  it('holds a measurement to the scaled budget and says which budget it was', () => {
    vi.stubEnv('CI', 'true');
    expectWithin(5 * CI_FACTOR - 0.1, 5, 'inside');
    expect(() => expectWithin(5 * CI_FACTOR + 0.1, 5, 'outside')).toThrow(`outside; budget 5 ms x ${CI_FACTOR} on CI`);
    vi.stubEnv('CI', '');
    expect(() => expectWithin(6, 5, 'outside')).toThrow('outside; budget 5 ms');
  });
});

describe('fastest', () => {
  it('calls the work once untimed and then once per run', () => {
    let calls = 0;
    const best = fastest(4, () => void calls++);
    expect(calls).toBe(5);
    expect(best).toBeGreaterThanOrEqual(0);
  });
});
