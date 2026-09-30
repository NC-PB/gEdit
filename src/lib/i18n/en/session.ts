// Session restore and per-file memory (`contrib/session.ts`, `app/session.ts`).
// One namespace per feature (plan AD-14); the namespace name is this file's name.
//
// Two messages, and both are about something the user cannot otherwise see. Everything
// else about a restore is either silent (the tabs are simply back) or already said by
// `files.*` ("Opened 3 files").
//
//  - `missing`: the session held files gEdit could not reopen, so a missing program is
//    noticed now and not next week. It names the three causes gEdit cannot tell apart
//    from here (a share or a stick that is not there, a move, a delete) and says the
//    file is tried again, because gEdit keeps it in the stored list — for about two
//    weeks of starts without it (`session.rs`). It is joined onto the "Opened N files"
//    summary, which would otherwise replace it.
//  - `saveFailed`: the list is not being stored at all. Said once per run.

import type { Messages } from '../types';

export default {
  missing_one:
    '1 file from the last session could not be reopened: it is offline, moved or deleted. gEdit tries it again at the next start.',
  missing_other:
    '{count} files from the last session could not be reopened: they are offline, moved or deleted. gEdit tries them again at the next start.',
  saveFailed: 'The list of open files could not be stored, so these tabs will not come back.',
} as const satisfies Messages;
