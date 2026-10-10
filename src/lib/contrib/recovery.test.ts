// What the recovery contribution declares, and what the restore dialog's four answers
// really do (plan §5 WP7.4, §7.13, AD-21).
//
// The service, the modal host, the native alert and the status bar are all fakes: what
// is under test is the decision flow around them, and three of its rules are the reason
// this file exists at all —
//
//   * Esc, a click outside and "Later" are the same answer, and that answer deletes
//     nothing and opens nothing;
//   * "Discard" asks in the system's own alert first, and a declined alert brings the
//     list back instead of dropping the user out of a decision they never made;
//   * whatever happens, `markRestoreDecided()` runs, so `contrib/session.ts` is never
//     left waiting behind a dialog that failed to open.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiskStamp, RecoveryEntry } from '$lib/app/types';

const STAMP: DiskStamp = { mtimeMs: 1000, size: 12, hash: 42 };

function entry(over: Partial<RecoveryEntry> = {}): RecoveryEntry {
  return {
    session: 's-1',
    key: 'd1',
    path: '/nc/prog.nc',
    title: 'prog.nc',
    profileId: 'fanuc-gcode',
    encoding: { encoding: 'utf-8', hasBom: false },
    eol: 'crlf',
    nul: { leader: 0, trailer: 0, stripped: 0 },
    diskStamp: STAMP,
    savedAt: 1_700_000_000_000,
    bytes: 12,
    ...over,
  };
}

const fake = vi.hoisted(() => ({
  leftovers: [] as unknown[],
  listFails: false,
  /** What the dialog answers, one per time it is opened. */
  answers: [] as (unknown | undefined)[],
  opened: 0,
  confirmed: true,
  confirms: 0,
  restore: vi.fn(async (entries: unknown[]): Promise<string[]> => entries.map((_, i) => `r${i + 1}`)),
  discard: vi.fn(async (_session: string): Promise<void> => {}),
  started: 0,
  decided: 0,
  claimed: 0,
  shown: [] as { text: string; error: boolean; sticky: boolean }[],
  /** Paths another tab has open right now. */
  openPaths: [] as string[],
  /** Canonical paths of the files other tabs hold, however they were spelled (B1 integration). */
  openIdentities: [] as string[],
  /** What `files_stat` answers: path -> canonical path. */
  canonical: {} as Record<string, string>,
  /** The calls `files_stat` got, with the options of each. */
  statCalls: [] as { paths: string[]; partial?: boolean; canonical?: boolean }[],
  statFails: false,
}));

vi.mock('$lib/app/recovery', () => ({
  recovery: {
    start: () => {
      fake.started += 1;
      return () => {};
    },
    flushNow: async () => {},
    leftovers: async () => {
      if (fake.listFails) throw new Error('unreadable');
      return fake.leftovers;
    },
    restore: fake.restore,
    discard: fake.discard,
  },
  // The dialog module imports these at load time, so the mock has to carry them.
  entryKey: (e: { session: string; key: string }) => `${e.session}/${e.key}`,
  takenText: () => 'Snapshot',
  outlookFor: async (entries: { session: string; key: string }[]) =>
    Object.fromEntries(entries.map((e) => [`${e.session}/${e.key}`, 'unchanged'])),
  markRestoreDecided: () => {
    fake.decided += 1;
  },
  claimRestoreDecision: () => {
    fake.claimed += 1;
  },
}));

vi.mock('$lib/app/modals', () => ({
  modals: {
    open: async () => {
      const answer = fake.answers[fake.opened];
      fake.opened += 1;
      return answer;
    },
  },
}));

vi.mock('$lib/app/dialogs', () => ({
  dialogs: {
    confirm: async () => {
      fake.confirms += 1;
      return fake.confirmed;
    },
    exclusive: async (op: () => Promise<unknown>) => op(),
  },
}));

vi.mock('$lib/app/status', () => ({
  status: {
    show: (text: string, o?: { error?: boolean; sticky?: boolean }) =>
      fake.shown.push({ text, error: o?.error === true, sticky: o?.sticky === true }),
  },
}));

vi.mock('$lib/stores/documents', () => ({
  docs: {
    byPath: (path: string) => (fake.openPaths.includes(path) ? { id: 'd9' } : undefined),
    byIdentity: (canonical: string | null | undefined) =>
      canonical && fake.openIdentities.includes(canonical) ? { id: 'd9' } : undefined,
  },
}));

vi.mock('$lib/platform/commands', () => ({
  // Like the real command: `canonical` comes back only when the caller asks for it
  // (`platform/commands.ts`), so a caller that forgets the argument sees no identity.
  filesStat: async (paths: string[], o: { partial?: boolean; canonical?: boolean } = {}) => {
    if (fake.statFails) throw new Error('no answer');
    fake.statCalls.push({ paths, ...o });
    return paths.map((path) => ({
      path,
      exists: true,
      ...(o.canonical === true ? { canonical: fake.canonical[path] ?? null } : {}),
    }));
  },
}));

const { default: contribution, showLeftovers, LEFTOVER_RECHECK_MS } = await import('./recovery');

/** Lets the detached startup flow of `activate()` run to its end. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  fake.leftovers = [];
  fake.listFails = false;
  fake.answers = [];
  fake.opened = 0;
  fake.confirmed = true;
  fake.confirms = 0;
  fake.started = 0;
  fake.decided = 0;
  fake.claimed = 0;
  fake.shown = [];
  fake.openPaths = [];
  fake.openIdentities = [];
  fake.canonical = {};
  fake.statCalls = [];
  fake.statFails = false;
  fake.restore.mockClear();
  fake.discard.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what it declares', () => {
  it('registers the command the plan names, with no shortcut of its own', () => {
    expect(contribution.id).toBe('recovery');
    expect(contribution.commands.map((c) => c.id)).toEqual(['recovery.showPending']);
    expect(contribution.commands[0]).toMatchObject({
      title: 'recovery.showPending',
      category: 'recovery.category',
    });
    // The lasting sign for snapshots that cannot be written (B1 A2).
    expect(contribution.statusItems.map((item) => item.id)).toEqual(['recovery']);
    expect('keys' in contribution.commands[0]).toBe(false);
  });

  it('starts the snapshot loop and hands back its disposer', async () => {
    const stop = contribution.activate();
    await flush();
    expect(fake.started).toBe(1);
    expect(typeof stop).toBe('function');
  });
});

describe('startup', () => {
  it('claims the restore decision synchronously, before anything that can throw', () => {
    contribution.activate();
    // Not awaited on purpose: `contrib/session.ts` waits only for a decider that really
    // started, and the claim has to be in place by the time its own `activate()` runs.
    expect(fake.claimed).toBe(1);
  });

  it('asks nothing and says nothing when there is nothing to recover', async () => {
    contribution.activate();
    await flush();
    expect(fake.opened).toBe(0);
    expect(fake.shown).toEqual([]);
    // And the session restore is let go at once.
    expect(fake.decided).toBe(1);
  });

  it('lets the session restore go even when the dialog itself fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.listFails = true;
    contribution.activate();
    await flush();
    // Waiting for ever on a dialog that never opened would cost the user their tabs.
    expect(fake.decided).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('the four answers', () => {
  it('restores exactly what came back from the dialog', async () => {
    const kept = entry({ key: 'd2' });
    fake.leftovers = [entry(), kept];
    fake.answers = [{ action: 'restore', entries: [kept] }];

    await showLeftovers();
    expect(fake.restore).toHaveBeenCalledWith([kept]);
    expect(fake.shown[0].text).toContain('restored');
    expect(fake.discard).not.toHaveBeenCalled();
  });

  // B1 A2. A snapshot whose file another tab has open still restores, into an untitled
  // tab (two tabs on one file would each think they own it). Nothing said so: the text
  // appeared in a tab with the file's name and the first Save went to a Save As dialog.
  it('says which restored files stayed untitled because another tab has them open', async () => {
    const taken = entry({ key: 'd2', path: '/nc/open.nc', title: 'open.nc' });
    fake.leftovers = [entry(), taken];
    fake.openPaths = ['/nc/open.nc'];
    fake.answers = [{ action: 'restore', entries: [entry(), taken] }];

    await showLeftovers();
    expect(fake.shown).toHaveLength(1);
    const [message] = fake.shown;
    expect(message.text).toContain('2 documents were restored');
    expect(message.text).toContain('open.nc is already open in another tab');
    expect(message.text).toContain('Save As');
    // The file that nobody else has open is not named.
    expect(message.text).not.toContain('prog.nc');
    // What it asks for is not done in four seconds.
    expect(message.sticky).toBe(true);
  });

  // B1 integration (A1 x A2). `bindRestored` refuses a twin by canonical path, so a
  // snapshot of another spelling of an open file also stays untitled: that has to be said.
  it('names a file another tab holds under another spelling (same canonical path)', async () => {
    const taken = entry({ key: 'd2', path: '/link/open.nc', title: 'open.nc' });
    fake.leftovers = [entry(), taken];
    fake.canonical = { '/link/open.nc': '/real/open.nc', '/nc/prog.nc': '/nc/prog.nc' };
    fake.openIdentities = ['/real/open.nc'];
    fake.answers = [{ action: 'restore', entries: [entry(), taken] }];

    await showLeftovers();
    expect(fake.shown).toHaveLength(1);
    expect(fake.shown[0].text).toContain('open.nc is already open in another tab');
    expect(fake.shown[0].text).not.toContain('prog.nc');
    expect(fake.shown[0].sticky).toBe(true);
  });

  // B1 harness (b1-recovery-2): the taken-path check read `canonical` from a `files_stat`
  // that returns it only when asked, and did not ask: a symlink spelling went unnamed.
  it('asks files_stat for the real path, because it is not sent unasked', async () => {
    const taken = entry({ key: 'd2', path: '/link/open.nc', title: 'open.nc' });
    fake.leftovers = [taken];
    fake.canonical = { '/link/open.nc': '/real/open.nc' };
    fake.openIdentities = ['/real/open.nc'];
    fake.answers = [{ action: 'restore', entries: [taken] }];

    await showLeftovers();
    expect(fake.statCalls.length).toBeGreaterThan(0);
    expect(fake.statCalls.every((call) => call.canonical === true)).toBe(true);
    expect(fake.shown[0].text).toContain('open.nc is already open in another tab');
  });

  it('names the second of two snapshots that are one file under two spellings', async () => {
    const a = entry({ key: 'd1', path: '/real/x.nc', title: 'x.nc' });
    const b = entry({ key: 'd2', path: '/link/x.nc', title: 'x.nc' });
    fake.leftovers = [a, b];
    fake.canonical = { '/real/x.nc': '/real/x.nc', '/link/x.nc': '/real/x.nc' };
    fake.answers = [{ action: 'restore', entries: [a, b] }];

    await showLeftovers();
    expect(fake.shown[0].text).toContain('x.nc is already open in another tab');
  });

  it('falls back to the written path when the file system gives no canonical path', async () => {
    const taken = entry({ key: 'd2', path: '/nc/open.nc', title: 'open.nc' });
    fake.leftovers = [taken];
    fake.openPaths = ['/nc/open.nc'];
    fake.statFails = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.answers = [{ action: 'restore', entries: [taken] }];

    await showLeftovers();
    expect(fake.shown[0].text).toContain('open.nc is already open in another tab');
  });

  it('names a file once when two snapshots of it come back together', async () => {
    const first = entry({ key: 'd1' });
    const second = entry({ key: 'd2', session: 's-2' });
    fake.leftovers = [first, second];
    fake.answers = [{ action: 'restore', entries: [first, second] }];

    await showLeftovers();
    expect(fake.shown[0].text).toContain('prog.nc is already open in another tab');
  });

  it('keeps the plain message when no restored file is taken', async () => {
    fake.leftovers = [entry(), entry({ key: 'd2', path: null, title: 'Untitled-1' })];
    fake.answers = [{ action: 'restore', entries: fake.leftovers }];

    await showLeftovers();
    expect(fake.shown[0].text).not.toContain('already open');
    expect(fake.shown[0].sticky).toBe(false);
  });

  it('treats Esc and a click outside as Later: nothing opens, nothing is deleted', async () => {
    fake.leftovers = [entry()];
    fake.answers = [undefined];

    await showLeftovers();
    expect(fake.opened).toBe(1);
    expect(fake.restore).not.toHaveBeenCalled();
    expect(fake.discard).not.toHaveBeenCalled();
    expect(fake.shown).toEqual([]);
  });

  it('asks before it deletes, and deletes every session that was offered', async () => {
    fake.leftovers = [entry(), entry({ session: 's-2', key: 'd9' })];
    fake.answers = [{ action: 'discard' }];

    await showLeftovers();
    expect(fake.confirms).toBe(1);
    expect(fake.discard.mock.calls.map(([s]) => s)).toEqual(['s-1', 's-2']);
    expect(fake.shown[0].text).toContain('discarded');
  });

  it('puts the list back when the delete question is declined', async () => {
    fake.leftovers = [entry()];
    fake.confirmed = false;
    fake.answers = [{ action: 'discard' }, { action: 'later' }];

    await showLeftovers();
    // Discard is never a one-way trip: the second open is the list coming back.
    expect(fake.opened).toBe(2);
    expect(fake.confirms).toBe(1);
    expect(fake.discard).not.toHaveBeenCalled();
  });

  it('says so when a failed delete leaves the work where it was', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.leftovers = [entry()];
    fake.answers = [{ action: 'discard' }];
    fake.discard.mockRejectedValueOnce(new Error('read-only folder'));

    await showLeftovers();
    expect(fake.shown[0]).toMatchObject({ error: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the command', () => {
  it('answers the person who asked, even when there is nothing', async () => {
    await showLeftovers({ announceEmpty: true });
    expect(fake.opened).toBe(0);
    expect(fake.shown[0].text).toContain('no unsaved work');
  });
});

describe('the late re-check (M7 integration, mergeA)', () => {
  // AD-21 decides "is that session dead?" by a timestamp, so for the first two minutes
  // after a crash the snapshots are on disk and `recovery_list` answers nothing. Coming
  // back right after a crash is the normal case, and without one late look the work is
  // offered only at some later start.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers what only became stale after the window had opened', async () => {
    const stop = contribution.activate();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.opened).toBe(0);
    // The session the app came back too quickly to see is now old enough to be listed.
    fake.leftovers = [entry()];
    fake.answers = [{ action: 'later' }];

    await vi.advanceTimersByTimeAsync(LEFTOVER_RECHECK_MS);
    expect(fake.opened).toBe(1);
    stop();
  });

  it('keeps quiet when the user was already asked and said Later', async () => {
    fake.leftovers = [entry()];
    fake.answers = [{ action: 'later' }];
    const stop = contribution.activate();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.opened).toBe(1);

    // Later means later, not "in two and a half minutes".
    await vi.advanceTimersByTimeAsync(LEFTOVER_RECHECK_MS * 2);
    expect(fake.opened).toBe(1);
    stop();
  });

  it('is called off when the window goes away', async () => {
    const stop = contribution.activate();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    fake.leftovers = [entry()];

    await vi.advanceTimersByTimeAsync(LEFTOVER_RECHECK_MS);
    expect(fake.opened).toBe(0);
  });
});
