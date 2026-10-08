// The channel tester runs the user's patterns over a pasted program. It must not run on every
// keystroke while a pattern is being typed (a slow pattern would freeze the window mid-word),
// and a program with thousands of waits must not become thousands of table rows.

/** Idle time after the last change before the tester runs. */
export const TESTER_DELAY_MS = 300;

/** Rows of the wait table that are drawn; the rest is one "… n more" line. */
export const TESTER_MAX_ROWS = 500;

/** `request` (re)starts the timer; only the last request runs, `delay` ms after it. */
export function createDebouncedRun<A>(
  run: (args: A) => void,
  schedule: (fn: () => void, ms: number) => () => void,
  delay = TESTER_DELAY_MS,
): { request(args: A): void; cancel(): void } {
  let cancelTimer: (() => void) | null = null;
  const cancel = (): void => {
    cancelTimer?.();
    cancelTimer = null;
  };
  return {
    request(args) {
      cancel();
      cancelTimer = schedule(() => {
        cancelTimer = null;
        run(args);
      }, delay);
    },
    cancel,
  };
}

/** The first `cap` rows and how many were left out. */
export function capRows<T>(rows: readonly T[], cap = TESTER_MAX_ROWS): { shown: T[]; more: number } {
  return rows.length <= cap ? { shown: [...rows], more: 0 } : { shown: rows.slice(0, cap), more: rows.length - cap };
}
