// The order this contribution exists to keep (plan §5 WP7.4/WP7.5, AD-21, AD-22).
//
// Written at M7 integration (mergeA), because the rule it guards spans two work packages
// and neither could test it alone:
//
//   * **The restore dialog decides before a single file is reopened from disk.** If the
//     session restore runs while the dialog is still on screen, the file the user is
//     about to recover is already open from disk, and the recovered document then finds
//     a second tab owning its path and stays unbound — the work is safe, but it lands in
//     an untitled tab and the user has to Save As onto their own file.
//   * **A recovery contribution that never started must not hold the session for ever.**
//     Commands are registered before `activate()` runs and a duplicate id throws there,
//     so a bare `await restoreDecided` would make one typo in a future feature silently
//     cost every user their tabs. `awaitRestoreDecision()` waits only for a decider that
//     claimed the decision.
//   * **The tracker is wired before anything opens**, or the first files back are the
//     ones that come back without their cursor and bookmarks.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  /** Every step, in the order it really happened. */
  log: [] as string[],
  /** Settles the gate `contrib/session.ts` waits on. */
  decide: undefined as (() => void) | undefined,
  /** Whether a decider claimed the decision at all. */
  claimed: true,
  restoreFails: false,
}));

vi.mock('$lib/app/recovery', () => ({
  awaitRestoreDecision: (): Promise<void> => {
    if (!fake.claimed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      fake.decide = () => {
        fake.log.push('restore dialog answered');
        resolve();
      };
    });
  },
}));

vi.mock('$lib/app/session', () => ({
  session: {
    start: () => {
      fake.log.push('session.start');
      return () => fake.log.push('session.stop');
    },
    restore: async () => {
      fake.log.push('session.restore');
      if (fake.restoreFails) throw new Error('state.json is unreadable');
      return 0;
    },
  },
  startFileTracker: () => {
    fake.log.push('tracker.start');
    return () => fake.log.push('tracker.stop');
  },
}));

const { default: contribution } = await import('./session');

/** Lets the detached startup flow run as far as it can get. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fake.log = [];
  fake.decide = undefined;
  fake.claimed = true;
  fake.restoreFails = false;
});

describe('the startup order', () => {
  it('starts the per-file memory synchronously, before anything is opened', () => {
    contribution.activate();
    // Not awaited: the tracker's `onDidOpen` handler has to exist before the restore.
    expect(fake.log).toEqual(['tracker.start']);
  });

  it('reopens nothing until the restore dialog has been answered', async () => {
    contribution.activate();
    await settle();
    // The dialog is still on screen. Reopening the crashed file from disk here is what
    // would leave the recovered document unbound.
    expect(fake.log).toEqual(['tracker.start']);

    fake.decide?.();
    await settle();
    expect(fake.log).toEqual([
      'tracker.start',
      'restore dialog answered',
      'session.restore',
      'session.start',
    ]);
  });

  it('goes ahead at once when no recovery contribution ever claimed the decision', async () => {
    fake.claimed = false;
    contribution.activate();
    await settle();
    expect(fake.log).toEqual(['tracker.start', 'session.restore', 'session.start']);
  });

  it('still follows the documents when the restore itself fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.restoreFails = true;
    contribution.activate();
    await settle();
    fake.decide?.();
    await settle();
    expect(fake.log).toContain('session.start');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('writes no session when it was disposed while the dialog was open', async () => {
    const stop = contribution.activate();
    await settle();
    stop();
    fake.decide?.();
    await settle();
    // A window that is already going away must not push its empty list over the stored
    // session on the way out.
    expect(fake.log).not.toContain('session.restore');
    expect(fake.log).not.toContain('session.start');
    expect(fake.log).toContain('tracker.stop');
  });
});
