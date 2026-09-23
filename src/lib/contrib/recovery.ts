// Crash recovery: the snapshot loop and the restore dialog (plan §5 WP7.4, §7.13,
// AD-21). One feature per file (plan AD-3); see ./README.md.
//
// `activate()` does three things, and the second one is deliberately **not** awaited:
//
//  1. `recovery.start()` — the throttle, the blur and `visibilitychange` triggers, the
//     drops on save and close, and the one clear in `files.onWillQuit`.
//  2. `showLeftovers()` — the restore dialog for snapshots a previous run left behind.
//  3. One late look at the list, 150 s in, for the crash this run came back from too
//     quickly for AD-21's liveness rule to have declared it dead yet — the normal case
//     after a crash, not an exotic one. See `LEFTOVER_RECHECK_MS`.
//
// The contributions are loaded before `data-ready`, and each `activate()` is awaited,
// so awaiting a dialog here would hold the start of the app on a human. The ordering
// AD-21 asks for — restore dialog first, session restore after — is kept by the
// promise `app/recovery.ts` exports instead: this file settles `restoreDecided` when
// the dialog has been answered, and `contrib/session.ts` (WP7.5) waits on it before it
// reopens the stored session. The settle is in a `finally`, so a failure anywhere in
// here costs the dialog and never the session.
//
// Why the dialog loops: "Discard" is the one action that cannot be taken back, so it
// asks in the system's own alert first, and a declined alert puts the list back on
// screen rather than quietly dropping the user out of a decision they never made.
//
// Titles and paths in the list are the files' own names and stay untranslated (AD-14).

import RecoveryDialog, { type RecoveryChoice } from '$lib/components/dialogs/RecoveryDialog.svelte';
import {
  claimRestoreDecision,
  markRestoreDecided,
  outlookFor,
  recovery,
  type RestoreOutlook,
} from '$lib/app/recovery';
import { dialogs } from '$lib/app/dialogs';
import { modals } from '$lib/app/modals';
import { status } from '$lib/app/status';
import { t } from '$lib/i18n';
import type { Contribution, Disposable, RecoveryEntry } from '$lib/app/types';

/** English detail for anything thrown across the IPC boundary. */
function detailOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Deletes every offered snapshot, session by session.
 *
 * One failed session does not stop the others, and a failure is *reported*: the point
 * of the message is that the user asked for this work to be gone and it is not, so it
 * will be offered again next time.
 */
async function discardAll(entries: readonly RecoveryEntry[]): Promise<void> {
  let failed = 0;
  for (const session of new Set(entries.map((entry) => entry.session))) {
    try {
      await recovery.discard(session);
    } catch (err) {
      failed += 1;
      console.warn(`the recovery session ${session} could not be discarded`, err);
    }
  }
  if (failed > 0) status.show(t('recovery.discardFailed'), { error: true });
  else status.show(t('recovery.discarded', { count: entries.length }));
}

/** The native alert in front of the one irreversible action this feature has. */
async function confirmDiscard(entries: readonly RecoveryEntry[]): Promise<boolean> {
  // `exclusive` resolves undefined when another dialog chain already owns the screen,
  // and undefined is read as "no": nothing is deleted on a question nobody answered.
  const answer = await dialogs.exclusive(() =>
    dialogs.confirm({
      title: t('recovery.discardTitle'),
      message: t('recovery.discardMessage', { count: entries.length }),
      ok: t('recovery.discardOk'),
      kind: 'warning',
    }),
  );
  return answer === true;
}

async function restoreThem(entries: RecoveryEntry[]): Promise<void> {
  const ids = await recovery.restore(entries);
  if (ids.length > 0) status.show(t('recovery.restored', { count: ids.length }));
}

/**
 * Whether the user has already been shown a list of leftovers in this run.
 *
 * It is what keeps the late re-check below from turning "Later" into "in two and a half
 * minutes": once somebody has been asked, this run does not ask again on its own.
 */
let asked = false;

/**
 * When the one late re-check runs (M7 integration, mergeA).
 *
 * AD-21's liveness rule is a timestamp and nothing else: a session counts as a leftover
 * only once its `alive` file is `STALE_AFTER_SECS` (120 s, `src-tauri/src/recovery.rs`)
 * old, because anything fresher cannot be told apart from a gEdit that is merely slow.
 * So for up to two minutes after a crash the snapshots are on disk and `recovery_list`
 * does not list them — and restarting **right after** a crash is the normal case, not
 * the exotic one. Without this, the work is offered only at some later start.
 *
 * 150 s = the 120 s staleness window plus the 30 s heartbeat, so a session whose last
 * beat landed just before the kill is certainly stale by the time this fires.
 */
export const LEFTOVER_RECHECK_MS = 150_000;

/**
 * Offers whatever previous runs left behind, until the user has decided.
 *
 * `announceEmpty` is on for the `recovery.showPending` command — somebody who asks for
 * this deserves an answer — and off at startup, where "nothing to recover" is the
 * normal case and a status message about it would be noise.
 */
export async function showLeftovers(o?: { announceEmpty?: boolean }): Promise<void> {
  for (;;) {
    const entries = await recovery.leftovers();
    if (entries.length === 0) {
      if (o?.announceEmpty === true) status.show(t('recovery.none'));
      return;
    }
    // From here the user is being asked, which is what the late re-check below is for.
    asked = true;
    const outlook = await outlookFor(entries);
    // `modals.open` resolves undefined on Esc, on a click outside, and when another
    // modal already owns the host. All three mean "not now", which is Later.
    const choice: RecoveryChoice =
      (await modals.open<
        { entries: RecoveryEntry[]; outlook: Record<string, RestoreOutlook> },
        RecoveryChoice
      >(RecoveryDialog, { entries, outlook })) ?? { action: 'later' };

    if (choice.action === 'later') return;
    if (choice.action === 'restore') {
      await restoreThem(choice.entries);
      return;
    }
    if (await confirmDiscard(entries)) {
      await discardAll(entries);
      return;
    }
    // The alert was declined: back to the list. Discard is never a one-way trip.
  }
}

/** Startup: ask, then let `contrib/session.ts` go, whatever happened. */
async function askOnStartup(): Promise<void> {
  try {
    await showLeftovers();
  } catch (err) {
    console.error('the restore dialog failed', detailOf(err));
  } finally {
    markRestoreDecided();
  }
}

export default {
  id: 'recovery',
  commands: [
    {
      id: 'recovery.showPending',
      title: 'recovery.showPending',
      category: 'recovery.category',
      global: true,
      run: () => showLeftovers({ announceEmpty: true }),
    },
  ],
  activate(): Disposable {
    // Synchronously, before anything that can throw: from here on `contrib/session.ts`
    // waits for the answer, and the `finally` in `askOnStartup` is what it waits for.
    claimRestoreDecision();
    asked = false;
    // Fired, not awaited: see the header. The `finally` inside makes it impossible for
    // the session restore to be left waiting on a dialog that never opened.
    void askOnStartup();
    // The one late look, for the crash the app came back from too quickly to see
    // (see `LEFTOVER_RECHECK_MS`). It asks only if nobody has been asked yet, so
    // "Later" stays later.
    const recheck = setTimeout(() => {
      if (asked) return;
      void showLeftovers().catch((err: unknown) => {
        console.error('the restore dialog failed', detailOf(err));
      });
    }, LEFTOVER_RECHECK_MS);
    const stop = recovery.start();
    return () => {
      clearTimeout(recheck);
      stop();
    };
  },
} satisfies Contribution;
