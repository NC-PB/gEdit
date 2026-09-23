// Coming back the way you left it: the last session's files and the place you were in
// each of them (plan §5 WP7.5, AD-22). One feature per file (plan AD-3); see ./README.md.
//
// No commands, no ribbon, no status item: like `contrib/layoutPersist.ts` this file only
// connects things that already exist — `app/session.ts`, which owns both halves, and the
// events on `app/fileOps.ts` and the editor that they hang from.
//
// The order in `activate()` is the whole content of this file:
//
//   1. **The per-file memory starts first**, synchronously. Its `files.onDidOpen`
//      handler has to be registered before the restore opens anything, or the first
//      files back would be the ones that do not get their cursor and bookmarks.
//   2. **The restore dialog decides first.** AD-21 puts crash recovery in front of the
//      session: `contrib/recovery.ts` (WP7.4) settles `restoreDecided` once the user has
//      answered it, and nothing is reopened from disk until then. Contribution order is
//      not enough — the loader reaches `recovery` first (it loads `*.ts` sorted by file
//      name), but that file deliberately does not await its own dialog, so without this
//      gate the session would reopen a recovered file from disk **while the dialog is
//      still on screen**; the recovered document would then find a second tab owning its
//      path and stay unbound, and the user would have to Save As onto their own file to
//      get their work back (M7 integration, mergeA).
//   3. **`session.restore()` runs before `session.start()`.** `start()` seeds itself
//      from the documents that are open when it is called and writes nothing until they
//      change, so starting it first would push the empty list over the stored session
//      before the restore had a chance to read it.
//
// The restore is fired and not awaited: `activate()` runs during startup, before the
// first render (README rule 9), and reading `state.json` and stating a dozen files may
// not hold the window back. `restore()` is contracted never to reject.

import { awaitRestoreDecision } from '$lib/app/recovery';
import { session, startFileTracker } from '$lib/app/session';
import type { Contribution, Disposable } from '$lib/app/types';

export default {
  id: 'session',
  activate(): Disposable {
    const stopTracker = startFileTracker();
    let stopSession: Disposable | undefined;
    let disposed = false;

    void (async () => {
      try {
        // AD-21: crash recovery decides first. Settled in a `finally` over there, so a
        // dialog that never opened or one that failed still lets the session through —
        // and it resolves at once when `contrib/recovery.ts` never started at all.
        await awaitRestoreDecision();
        if (disposed) return;
        await session.restore();
      } catch (err) {
        // `restore()` is contracted never to reject; this is the belt to those braces,
        // and it must not stop the tracking that follows.
        console.warn('the last session could not be restored', err);
      }
      if (disposed) return;
      stopSession = session.start();
    })();

    return () => {
      disposed = true;
      stopSession?.();
      stopTracker();
    };
  },
} satisfies Contribution;
