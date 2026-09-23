// Crash recovery: the restore dialog and what the service says while it works
// (`app/recovery.ts`, `contrib/recovery.ts`, `components/dialogs/RecoveryDialog.svelte`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Every sentence here is written for someone who has just lost a session and wants to
// know two things before they touch anything: **what is still there**, and **what
// restoring will do to the file on disk**. So the wording never says "recover" without
// saying what happens to the saved file, and the one thing it repeats is that nothing is
// written until the user saves (AD-21).
//
// File names, paths and dialect ids are data and are not translated.

import type { Messages } from '../types';

export default {
  // --- the dialog ----------------------------------------------------------
  title: 'Unsaved work was found',

  // The lead. `count` is the number of snapshots, not the number of sessions: what the
  // user cares about is how many pieces of work are at stake.
  lead_one: 'gEdit ended without saving this document. Its unsaved text is still here.',
  lead_other: 'gEdit ended without saving these {count} documents. Their unsaved text is still here.',

  // The promise the whole dialog rests on. It is shown before the list, not after it,
  // because it is what makes "Restore" a safe thing to click.
  nothingWritten:
    'Restoring only reopens the text in the editor. No file on disk is written or changed until you save.',

  selectAll: 'Select all',

  // What each row says about the file the snapshot came from. These are the four
  // outcomes of a restore, spelled out before it happens.
  whereUntitled: 'Was never saved to a file. It reopens as an untitled document.',
  whereUnchanged: 'Reopens {path}, which has not changed since this snapshot.',
  whereChanged:
    '{path} CHANGED ON DISK after this snapshot. It reopens with your unsaved text and the file is left as it is; gEdit shows the difference, and you decide what to save.',
  whereMissing: '{path} is no longer there. It reopens with your unsaved text, and saving writes the file again.',
  whereUnknown:
    'gEdit cannot tell whether {path} changed since this snapshot. Compare it before you save over it.',
  whereUnreachable:
    'gEdit may not open {path} any more. It reopens as an untitled document, and Save As offers that path again.',
  // The snapshot's text survived but the note beside it did not — the process died in
  // between the two. The text is the only copy of that work, so it is offered; what
  // cannot be offered is any claim about where it came from, and the sentence says so
  // rather than guessing.
  whereMetaLost:
    'gEdit could not tell which file this text belongs to. It reopens as an untitled document; use Save As to put it back where it came from.',
  /** The name column for such a snapshot. Not a file name, so it is translated. */
  unnamed: 'Unsaved text',

  /** The row's second line: when the snapshot was taken and how much text it holds. */
  taken: 'Snapshot {time} · {size}',

  // --- the buttons ---------------------------------------------------------
  restoreAll: 'Restore all',
  restoreSelected: 'Restore {count} selected',
  restoreNone: 'Restore',
  restoreHint: 'Reopen the ticked documents with their unsaved text',
  discard: 'Discard',
  discardHint: 'Delete this unsaved work for good',
  later: 'Later',
  laterHint: 'Leave everything as it is and ask again next time gEdit starts',

  // --- discarding ----------------------------------------------------------
  // Deleting unsaved work is the one irreversible thing this dialog can do, so it is
  // asked about in the system's own alert and the question names what is at stake.
  discardTitle: 'Discard the unsaved work?',
  discardMessage_one: 'The unsaved text of 1 document is deleted and cannot be brought back.',
  discardMessage_other: 'The unsaved text of {count} documents is deleted and cannot be brought back.',
  discardOk: 'Delete it',
  discarded_one: 'The unsaved document was discarded.',
  discarded_other: 'The {count} unsaved documents were discarded.',
  discardFailed: 'The unsaved work could not be discarded.',

  // --- when the net is down ------------------------------------------------
  // Said once per run, in the status bar, when a snapshot cannot be written at all: the
  // data disk is full, the recovery folder could not be made, or the document has grown
  // past what a snapshot may hold. It is the one message here that is not about
  // recovering something — it is about the promise in the guide ("at worst the last 30
  // seconds of typing") no longer being true, which the user cannot see any other way.
  // So it says what stopped and what to do instead, in that order.
  snapshotFailed:
    'Unsaved changes to {name} cannot be stored for crash recovery. Save your work to a file — a crash would lose it.',

  // --- results -------------------------------------------------------------
  restored_one: '1 document was restored. It is unsaved — check it before you save.',
  restored_other: '{count} documents were restored. They are unsaved — check them before you save.',
  restoreFailed: '{name} could not be restored.',
  /** After a partial restore: the rest are still on disk, and that is deliberate. */
  keptRest_one: '1 more snapshot is kept and will be offered again next time.',
  keptRest_other: '{count} more snapshots are kept and will be offered again next time.',
  none: 'There is no unsaved work to recover.',

  // --- the command ---------------------------------------------------------
  category: 'File',
  showPending: 'Show recovered work',
} as const satisfies Messages;
