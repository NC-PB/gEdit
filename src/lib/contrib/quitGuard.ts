// Telling the backend whether anything is unsaved (plan §5 WP6.5, AD-20, D27).
// One feature per file (plan AD-3); see ./README.md.
//
// macOS asks the application whether it may terminate — Dock → Quit, ⌘Q from another
// app's menu, a logout, a shutdown — and wants the answer before the call returns. None
// of those go through the window, so none of them reach `contrib/files.ts`, and there is
// no time to ask the webview once the question has been put. The backend therefore keeps
// a flag it can answer from (`src-tauri/src/quit.rs`), and this file is the one thing
// that knows what belongs in it: whether *any* open document has unsaved changes.
//
// Three rules shape it:
//
//   1. **Flips only.** `docs.list` fires on every keystroke that turns a document dirty
//      and on every tab switch; the answer to "is anything unsaved" changes far less
//      often. Sending only the flips keeps an IPC call off the typing path.
//   2. **Once at start**, whatever the answer is. The backend starts the flag `false`,
//      so the first report usually says nothing new — but a session restored with a
//      dirty document (M7) would otherwise never be reported at all.
//   3. **`false` before the quit goes through.** `files.onWillQuit` runs after the user
//      has answered the unsaved-changes alert and before the window is destroyed, so it
//      is the last honest moment: from there on the app is leaving whatever the
//      documents say. The send is unconditional, not a flip, because this one is the
//      safety net — a stale `true` here is an app that refuses to quit.
//
// Nothing else on the platform needs this: Windows and Linux cannot veto a session end
// (F29), where the command only stores the flag and the M7 recovery snapshots are the
// protection (D28). The contribution runs there anyway; one cheap call on a flip is not
// worth a platform branch, and M7's snapshots will want the same signal.

import { files } from '$lib/app/fileOps';
import { quitGuardSetDirty } from '$lib/platform/commands';
import { docs } from '$lib/stores/documents';
import { isTauriRuntime } from '$lib/utils/platform';
import type { Contribution, Disposable, DocMeta } from '$lib/app/types';
import type { Readable } from 'svelte/store';

/** What the guard needs, injected so a unit test needs no Tauri runtime (AD-2). */
export interface QuitGuardDeps {
  /** The document list; the guard only ever reads `dirty`. */
  list: Readable<DocMeta[]>;
  /** `files.onWillQuit`: runs between "yes, quit" and `destroy()`. */
  onWillQuit(cb: () => Promise<void> | void): Disposable;
  /** The `quit_guard_set_dirty` command. */
  setDirty(dirty: boolean): Promise<void>;
}

/** Whether anything would be lost by quitting right now. */
export function anyDirty(list: readonly DocMeta[]): boolean {
  return list.some((doc) => doc.dirty);
}

/**
 * Starts reporting. Returns the disposer that stops it again.
 *
 * A failed call is a console *warning*, not an error: the flag is an optimisation of the
 * native quit path, and a runtime scenario must not fail because one IPC call did not
 * land. The worst case of a lost `true` is the Phase 1 behaviour it replaces; the worst
 * case of a lost `false` is one extra unsaved-changes alert, which the user can answer.
 */
export function startQuitGuard(deps: QuitGuardDeps): Disposable {
  /** What the backend was last told. `null` until the first report, so it always sends. */
  let reported: boolean | null = null;

  function send(dirty: boolean): Promise<void> {
    reported = dirty;
    return deps.setDirty(dirty).catch((err: unknown) => {
      console.warn('the quit guard could not be updated', err);
    });
  }

  const stopDocs = deps.list.subscribe((list) => {
    const dirty = anyDirty(list);
    if (dirty === reported) return;
    void send(dirty);
  });

  // Awaited by `runWillQuit`, so the flag is stored before the window is destroyed.
  const offQuit = deps.onWillQuit(() => send(false));

  return () => {
    offQuit();
    stopDocs();
  };
}

export default {
  id: 'quitGuard',
  activate(): Disposable {
    return startQuitGuard({
      list: docs.list,
      onWillQuit: (cb) => files.onWillQuit(cb),
      // `npm run dev` in a plain browser has no command to call, and a warning per flip
      // would bury the console the developer is reading (`app/external.ts` does the
      // same for its poll).
      setDirty: (dirty) => (isTauriRuntime() ? quitGuardSetDirty(dirty) : Promise.resolve()),
    });
  },
} satisfies Contribution;
