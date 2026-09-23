// Session restore and per-file memory (`contrib/session.ts`, `app/session.ts`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Two messages, and both are about something the user cannot otherwise see. Everything
// else about a restore is either silent (the tabs are simply back) or already said by
// `files.*` ("Opened 3 files").
//
//  - `missing`: the session held files gEdit could not reopen, so a missing program is
//    noticed now and not next week. It says "moved or deleted" because a path the fs
//    scope no longer answers for and one that was deleted look identical from here —
//    and gEdit keeps both in the stored list, so a share that mounts late costs nothing.
//  - `saveFailed`: the list is not being stored at all. Said once per run.

import type { Messages } from '../types';

export default {
  missing_one: '1 file from the last session could not be reopened; it has been moved or deleted.',
  missing_other:
    '{count} files from the last session could not be reopened; they have been moved or deleted.',
  saveFailed: 'The list of open files could not be stored, so these tabs will not come back.',
} as const satisfies Messages;
