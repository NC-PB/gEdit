# Bug-fix round 1 (B1): the plan of record

Status: **done on the integration branch, not yet released** (2026-10-10). The round fixed the bugs and risks that `TODO.md` collected after Phase 3, filled the code databases from the control manuals, updated the documentation and tidied the code. It lands on `main` under `## Unreleased` in the [CHANGELOG](../../CHANGELOG.md); the owner decided that this round gets no release of its own. The open points it leaves are in [What remains](#7-what-remains).

This page is the record of the round: why it was done, what the owner decided, which package did what, where the work deviated from the plan, and what the reviews found. The user guide describes the behaviour; this page is for whoever reads the history. Evidence from real programs appears here as counts only.

## 1. Context

Phases 1 to 3 were on `main` (`037acb7`) and v1.0.0 was prepared as a draft. The owner asked on 2026-10-10 to fix the bugs and risks first, then update the documents and tidy up. The source was the "Bugs and risks" and "Tech debt and test gaps" parts of [TODO.md](../../TODO.md), re-checked against the code by three surveys (one item was already fixed: the Fanuc lathe `G65`; several line links had drifted).

The work ran in two waves of packages, each in its own worktree and branch, then one integration branch, two independent reviews, a skeptic pass and three fix batches. The machine was shared with other work, so the owner added a rule in the middle of the round: no heavy runs (see [CONTRIBUTING.md](../../CONTRIBUTING.md#running-the-tests-lightly)).

## 2. Owner decisions and the defaults taken

### Answered by the owner

| Question | Answer |
|---|---|
| Linux command name | `gedit-nc`; macOS and Windows unchanged |
| The stray CR in a CRLF file | Document it, no code change |
| Release at the end | None; the fixes stay on `main` under `## Unreleased` |
| Local branches | Delete all but `main` (tags and the remote `spike/harness-ci` stay) |
| Code databases | Fill them from the local manuals (Fanuc 30i, Sinumerik 840D, TNC 640, Okuma lathe), with per-block labels for the lathe `G71`–`G76`; the content is marked for the owner's later review, like the templates |
| Convert Case and program names | Names and `O`/`:` numbers stay unchanged; the results panel says how many |
| Scale Speed on Klartext `VC:` | Scale it |
| Klartext function `F` words (`M128 F`, `M140 … F`, `PLANE … F`, cycle 19 `F`) | Not path feeds, for Scale Feed and the tool list |
| Ribbon layout (added during the round) | Seven tabs: File · Edit · Insert · NC · Tools · Scripts · View; no colour box for `#101=5`; no "gEdit" title row inside the window; hover and find-widget tips not clipped; Program start only on Insert; Settings asks before dropping a half-filled machine form |
| Hover placement (added during the round) | Monaco's normal placement (above the word, below when there is no room in the window); near the first lines it may be drawn over the ribbon. The package had set it to open below; the integration removed that |

### Defaults taken for the remaining choices

Reversible; the owner can veto any of them. "Outcome" says what was built.

| Item | Default | Outcome |
|---|---|---|
| Unclosed string or `[` | Both lexers read to the line end; the program check says so | Done. The `brackets` check has plain wording; the comment mask follows the tokenizer where a bracket holds a comment marker |
| Okuma renumber with `$` out of `skipStartingWith` | Also protect lines through `syntax.continuationStart` | Done; the row reads "Skipped: this line continues the block above it." |
| Okuma `CALL`/`O` names above 4 characters | Up to 16 in the outline and `callTargets`; detection unchanged | Done, then narrowed by the NC fix batch to `O` plus letters and digits, or `O` plus digits only (`O1000ABC` is no name); the program start follows |
| Okuma `NEND M02` | Unchanged (an end, not a label) | Unchanged |
| `G195`/`G241`, IS-A, tool-word variants, contradiction guard, M12.5 deferrals, comment mask | Stay in the backlog (no manual, no real program) | Unchanged; see [TODO.md](../../TODO.md) |
| Two-block schema | Keep `blocks: 2`, add `CodeParam.block?: 1 \| 2`; `inspect.ts` uses it, `isPair` only as fallback | Done, with the interpretation and the "readings agree" rule in [section 4](#4-deviations-from-the-plan) |
| Recovery | A lasting status item while snapshots fail; a restore onto a path another tab owns gives an untitled tab with a message; a partial restore discards per entry | Done. The review added: an entry is discarded only after the new document's own snapshot has been written |
| FAT32 same-size rewrite | Hash compare on every save when size and mtime are equal; the 2 s poll hashes only inside the racy window | Done. The code review proposed dropping the hash on save; the skeptic rejected that (a lagging clock on a share defeats the racy test) and the default stays |
| Script header changed since the scan | Rescan automatically, then run with the new header | Done for `input` and `output` (the header fields that decide whether a script may replace text) |
| `files.recentLength: 0` | Stop recording, keep the stored list | Done; the list is hidden while 0 |
| Backups | A global cap (500 MB, oldest first) and expiry of orphaned histories after 90 days, both settings | Done, then redesigned after the reviews: see [section 4](#4-deviations-from-the-plan) |
| Script `PATH` | Add the login shell's folders that are missing; `~/.zshrc` not read | Done; the harness package added: never when `GEDIT_PYTHON` or `scripts.python` is set |
| Unknown file size at open and at Reload | Refuse ("the file system did not answer") | Done |
| Program map, first build | Time-sliced like the modal index | Done, then re-tuned after the harness measured it ([section 4](#4-deviations-from-the-plan)) |
| Settings with unsaved input, half-filled machine form | Ask "Discard changes?" | Done, tab switches included |
| Shortcuts dialog | Unbound commands behind a toggle | Done ("Show commands without a key") |
| Stale-result dialog | Waits for the dialog in front | Done (`dialogs.whenFree`) |
| Machine mismatch notice | A notice with a "Choose Machine…" button | Done |

## 3. Packages

Wave A ran in parallel from `037acb7`; each package owned disjoint files. Model and effort follow the rule in the owner's memory: Opus for NC-critical work and manual reading, Sonnet for well-scoped implementation, the cheapest model for mechanical lists.

| Package | Model | What it did |
|---|---|---|
| **A1** Files and documents | Sonnet | One tab per file under two spellings (the real path from Rust, `docs.byIdentity`); content compare on save when size and time agree, a racy-stamp poll; Open and Reload refuse a file of unknown size; session restore opens the front tab first and fills in the rest in the background |
| **A2** Recovery and app data | Sonnet | The "Crash recovery is not saving" status item; the message for a restore onto a taken path; per-snapshot discard (`recovery_discard_entry`); failed `state.json` writes shown; `recentLength: 0`; `write_atomic` keeps a narrowed mode; the backup cap and orphan expiry with their two settings |
| **A3** Scripts and platform | Sonnet | A Windows Job Object for what a script starts; the login-shell `PATH` fill-in; quit waits 300 ms instead of 1.5 s; cut error output marked; the header re-check at run; forbidden Windows name characters; lone surrogates in recovery headers; Linux `gedit-nc` and a release-workflow check |
| **A4** Machines, settings and UI | Sonnet | Length limits in the machine form; Replace on `machines.json` always keeps a backup and is not offered for a newer file; honest texts; one-step machine and dialect change; Settings asks before losing input; transforms of 1,000 or more edits in batches; the map scrolls to the cursor; the stale-result dialog waits; the snippet icon; the Shortcuts toggle; "(unconfirmed)" presets; the mismatch button; one message on a failed save |
| **A5** NC tokens and transforms | Opus | `GOTOF:20` as a jump; Klartext `PLANE POINTS P1X+0`; unclosed string and `[`; Convert Case keeps program names; Remove Block Numbers and `GOTOB :20`; Okuma renumber and `$` lines; the Klartext `wordPattern` for `241,781` |
| **A6** NC modal and scripts | Opus | Polar moves count under `M89` (both interpreters, new golden); `G63` in force for the feed class; `_apply_tool` fallback dropped; Scale Speed reads `VC:`; the `ownWords` attribute for function `F` words; Okuma `G171`–`G176` and names up to 16 characters |
| **A7** Code data from the manuals | Opus | **F**: Fanuc codes and the `CodeParam.block` schema, `CodeEntry.review`; **S**: Sinumerik and Klartext cycles and words; **O**: Okuma lathe codes. All new or changed entries carry `review: "pending"` |
| **A8** Docs-only housekeeping | Sonnet | Status banners and corrected passages in the design notes; superseded notes in the Phase 1 and 2 plans; user-guide wording ("Phase 4" became "a later version") |
| **A9** Ribbon and editor UI (added) | Sonnet | The seven tabs, Reload and Go To, colour boxes off, scrollbar below the group labels, no title row, unclipped hovers, Program start only on Insert, the Settings tab switch |

Wave B followed the integration of wave A:

| Package | Model | What it did |
|---|---|---|
| **B1-G** Grammar matches tokens | Sonnet | Monarch rules for `freeText`, `colonWords`, `callTargets`, `labelAfter`, `declareAfter`, `plainTextRun`, name-shaped keywords; a differential test of grammar against tokens over the fixtures, plus a test that runs Monaco's own tokenizer |
| **B2** Faster lexer and detection | Sonnet | A fast path in `_nc_lex.py` (a differential fuzz of 61.6 million reads against the full path, no difference; the NC review checked it again over the whole clean-room corpus: 0 differences in 4.08 million lines in program order and in 7.66 million distinct-line reads); the Fanuc lathe thread-cycle detection rule made linear; the first build of the program map time-sliced |
| **B3** Code housekeeping | cheapest model, checked | Dead `config::read_settings`, the `fNotFeed` cast and `settings.machinesEmpty` removed; package descriptions; stale "stub", "prelude" and "Next up" comments in 88 files; `TODO.md` line links refreshed |
| **B4** Harness | Sonnet | Triage of the 20 scenarios that failed in the hosted spike run (all intended changes except one regression, fixed); 16 new scenarios in the suite `b1` (the cumulative list is now 149 scenarios); the stall check of `p3-perf` re-based on the sliced build |
| **B5** User docs and records | Sonnet | The user guide, `CHANGELOG.md`, `TODO.md`, `CONTRIBUTING.md`, this page |

Integration (`intA`) merged wave A, joined the pieces the packages could not do alone (the taken-path message across spellings, the stale-result dialog, regenerated fixtures, the data documentation) and ran the gates.

### Reviews and fix batches

An NC-correctness review (Opus) of the lexer, modal, transforms, data and grammar changes; a code review (Sonnet) of the Rust, recovery, file and scheduling changes, including security; a skeptic pass (Opus) that re-ran the probes and judged every finding; then three fix batches, each regression test shown failing without its fix.

## 4. Deviations from the plan

What was done differently from the plan or from a package's brief, and why.

- **Backups, redesigned after review.** The first version treated a file that could not be found as "certainly gone". The code review showed that an unplugged USB stick, an offline share or an empty mount point looks exactly like that, and the skeptic showed the proposed repair still deleted when a second stick of the same name was plugged in. The final design: only histories of the backups' own volume can expire; each history's `.folder` note records the folder and whether it is local; the cap never takes the newest copy of any history; a history is checked twice before it is deleted; two folders that share a key make the note ambiguous and never expire; no pass runs while `settings.json` is unreadable (a limit set to 0 must not turn back into the default); at most one pass every 10 minutes. The settings help texts carry the user wording.
- **Recovery discard order.** Discarding each restored snapshot at once left a window with no copy of the work. A restored entry is now discarded only after the new session has written that document's snapshot; if snapshots fail, nothing is discarded.
- **The racy-stamp poll.** A1 hashes a racy stamp until a look past the step has confirmed it (more than the plan's "about 2 s"); the review found the banner flapped on every tick; the fix keeps the banner up while the same size and time are seen, reads once and says it once.
- **Two-block schema.** The owner's wording ("a block is the second one when it writes an address declared with `block: 2`") was read as "an address declared for the second block only", because `U` is declared for both blocks of `G71`. The first-match readers of unit and position (`declaredUnit`, `paramOf`) stay as they are, which is right only because two declarations of one address must agree on everything but the label (the loader reports a breaking one). A consequence: the `G76` second-block `P` (thread height) is shown as written and never converted. Edit Cycle still refuses a two-block cycle.
- **`ownWords` and the feed in force.** A6 added the attribute and applied it to Scale Feed and the tool list; the NC review found the state of the interpreters (inspector, hover, the `feed` that scripts read) still took `M128 F800` as the path feed, in 41 of 150 Klartext programs of the corpus. The fix batch moved ownership into both interpreters, skipping the whole word so a feed per tooth stays in force.
- **`PLANE POINTS P1X+0`.** Solved in the tokenizer's address rule, not as a profile field: the same shape as the existing `DR2+0.05` rule, no new schema.
- **Convert Case.** The owner asked for program names and `O`/`:` numbers; the rule was widened to every program marker (file headers, Okuma `CALL` targets), because converting a call and not its target breaks the call.
- **Okuma names.** The outline and program start take 16 characters although the manual allows them for subprogram names only (by option); lenient, not wrong.
- **Time-sliced program map.** B2's slices waited for idle time between slices, which the macOS web view does not offer, so the first build took three to four times as long as before (Fanuc 300,000 lines: 1.46 s became 4.1 s) and a tab switch onto the 10 MB document got slower while it ran. The performance fix chains the slices in the next turn while no input is pending, sizes a run from the measured cost, builds the active document first and leaves a 150 ms quiet window after a tab switch. The new ready time is back near the old one in Node measurements; the web view figures are for the next harness run.
- **Undo of 1,000 or more edits.** A4 kept bookmarks on the forward run by batching; the harness found they moved on Undo. Each batch is now its own undo element and the elements of one transform share an undo group. The group object imitates a class inside Monaco, which is why a test runs Monaco's real undo service; this is on the upgrade watch list.
- **Windows job.** When a script ends by itself the job is released, so a program the script left running on purpose survives, as on Unix; only Stop, timeout and Quit end the tree. The `Win32_Security` feature was needed besides the three the plan named. The Windows tests run on CI only.
- **`PATH` fill-in.** A3 asked the login shell even when an interpreter was configured, which defeats the setting meant for a broken or slow login shell; the harness package fixed it (`scripts.python` or `GEDIT_PYTHON` means the login shell is never started).
- **Hover.** See the owner decisions above: the package's `hover.above: false` was removed at integration.
- **Files outside a package's list.** A4 added `machines_replace` (Rust, `commands.ts`); A1 asked for `files_stat` to resolve the real path (later only on request); A7 changed `hoverText.ts` and `resolve.ts`; A5 changed the Sinumerik outline patterns; the NC fix batch touched test and fixture files for its data changes. The integration merged them.

## 5. Review, skeptic and fix outcomes

| Stage | Result |
|---|---|
| NC review | 11 findings: 1 High, 3 Medium, 7 Low. The High was the feed in force after a function's own `F`. Every new or changed manual-based entry was checked against the manuals |
| Code review | 13 findings: 1 High, 2 Medium, 9 Low, 1 information. The High was the backup sweep treating an absent volume as a deleted file |
| Skeptic | Of the 24 findings: 20 confirmed (four of them amended: the feed fix, the backup repair, the banner fix, the recovery discard), 2 partly, 1 rejected (the hash on every save stays), 1 no action. Four new findings (SK-01 to SK-04): three fixed, one backlog (SK-04, `I`/`J`/`K` after `G41.6`/`G43.5`). One finding was upgraded from Low to Medium (decimals refused for real-number words) and one downgraded from Medium to Low (`G41.6` labels) |
| Owner questions | The review raised 15; the skeptic settled all 15 from the manuals or by the project's own rules, so none went to the owner. Decisions taken that the owner may veto: backups of files on another volume never expire and the cap keeps the newest copy of every file; the hash check on every save stays |
| NC fix batch | Both interpreters share one ownership rule for function `F` words; the Fanuc lathe turret mirror and the coordinate rotation are separate groups; FK points are refused and listed under address arithmetic; real-number words are accepted (`CodeParam.decimals`); Okuma name patterns and plane conflicts; `S`/`T` for the roughing cycles; four-digit G/M codes coloured whole. Modal parity stays at 0 differing lines on all goldens and the owner-public programs, and on the clean-room corpus (Klartext 150 programs and 2.7 million lines, Fanuc mill 86 and 1.0 million, Fanuc lathe 76 and 0.18 million) |
| Code fix batch | The backup redesign, atomic temp-file retry, canonical path only on request, the banner fix, the session write order, recovery discard order, the `whenFree` caution. 16 Rust and 13 TypeScript mutants of the fixes were all caught by the new tests |
| Performance fix batch | The undo group and the program-map pump, with the measurements in the previous section |

Clean-room corpus facts used by the work (counts only): 393 programs opened, 390 detected stably; the polar-move change altered the cycle state of 0 lines in 152 Klartext programs; the two-block rule chose the same block as before for every `G71`–`G76` line; `G68.1` and `G69.1` appear in 7 of 76 Fanuc lathe programs, `G68` and `G69` in 2, none mix them.

## 6. Verification

Run on the integration branch before the reviews: type check 0 errors and 0 warnings; the unit tests 236 files with 8,768 passed (a later tree: 238 files, 8,805); the Python suite 923 tests on 3.13, 3.12 and 3.9; 359 cargo tests; the build; licences and versions; modal parity and the evidence gate. The wall-clock tests failed only while other work loaded the machine and passed alone and in the integration runs; no budget was loosened. The runtime harness: the 20 scenarios that failed in the hosted spike run all pass (one was a regression, fixed in the app; the others pinned behaviour this round changed on purpose, and two of them were data goldens that were regenerated); the cumulative non-perf suite passed 136 of 136 twice on the merged tree; the cumulative list is 149 scenarios. The numbers of the final tree, the hosted harness run and the CI run on the landing branch are in the landing commit.

Not proved locally, only by CI: the Windows job-object tests, the Windows half of the file-name rules, the real-path behaviour of a mapped drive, and the Linux `gedit-nc` name (a check in `release.yml`).

### Manual sources of the data

Facts only, in the project's own words; titles, sections and printed pages.

- **Fanuc.** FANUC Series 30i/31i/32i Model A, User's Manual, common functions lathe and machining centre (B-63944GE/02): G-code tables 3.1(a) and 3.2(a), pp. 40–46; §4.14 NURBS pp. 118–122; §6.1 and §6.2 reference position returns pp. 159–166; §7.2.4 pp. 178; §14.2 p. 306; §15.4 pp. 337–338; §21.2 p. 709; §21.4 pp. 735–778. The lathe system manual (B-63944GE-1/02): §4.2 multiple repetitive cycles pp. 49–89; §5.9 coordinate system rotation pp. 246–248; chapter 6, Series 15 program format p. 257.
- **Sinumerik.** SINUMERIK 840D sl NC programming, programming manual 06/2019: §2.11 exact stop and continuous path pp. 296–300; §3.1.8 channel coordination pp. 490–493; §3.7.4 p. 617; §3.13.5.3 pp. 778–779; §3.14.10 pp. 884–886; §3.25.1 cycles pp. 1043–1064; §4.3 G groups pp. 1230–1236. Cycles programming manual 01/2008: §3.5 SLOT1, §3.9 POCKET3, §3.10 POCKET4, §4.3 CYCLE93, §4.7 CYCLE97 (cross-checked with the external-cycles manual 03/2009).
- **Klartext.** TNC 640 user's manual, cycle programming (NC software 34059x-08, 10/2017): new and changed functions pp. 15–17; §5.2–§5.7 cycles 251–257 pp. 161–193; §7.1–§7.9 SL cycles pp. 222–246; §10.9 cycle 19 pp. 313–316. Klartext programming (10/2017): FK auxiliary points p. 330; M140 p. 501; PLANE POINTS pp. 606–607; PLANE positioning pp. 611–613; M128 pp. 625–626; TURNDATA SPIN pp. 682–683.
- **Okuma.** OSP-P200L/P20L programming manual (3rd ed., 2007): code table and §15-1 p. P-331; §6 planes pp. P-90–P-95; §9 contour generation pp. P-247–P-250; §5 and §8 LAP pp. P-48, P-174–P-220. OSP-P300 programming manual (6th ed. 2014, 22nd ed. 2020): G-code lists, macro calls G171–G176, name length §1-2, contour generation §9-2. MACTURN and special-functions manuals for the home position and turret codes.

## 7. What remains

For the owner:

- **Review the code data.** Every new or changed code entry carries `review: "pending"` (not shown in the app): 10 Okuma entries, 24 Sinumerik, 24 Klartext, and the Fanuc entries and the six lathe cycles. Questions the manuals left open: Okuma `G21` at rapid or not (no motion is claimed), the format of `F` under `G93`, the wording of `G85`/`G86` (only `M85` allowed in the block), the arcs of `M15`/`M16`; Fanuc `G29` as a machine position, `G43.1` left off the lathe; Sinumerik `_ZFS` as a tool-axis position, `CYCLE93 SPD` not called a diameter; Klartext `Q338` against `Q386` in 256/257.
- **Look at the ribbon scrollbar once on a Mac with overlay scrollbars** (narrow the window until the ribbon scrolls; the group names must stay fully visible). The harness Mac shows classic bars, so this could not be reproduced.
- **Retake `docs/screenshots/main-window.png`**: it still shows the old Home tab and the title row.
- **Windows and Linux checks** wait for CI: the job-object tests, the file-name rules, a mapped drive, the `gedit-nc` name. If the Linux package is still called `gedit`, decide a package name (the Debian package `gedit` is GNOME's).
- Publish v1.0.0 as planned; this round does not change that.

Open in the code (all in [TODO.md](../../TODO.md) with their reasons): the backlog of data gaps and syntax variants (`G195`/`G241`, IS-A, tool-word variants, the contradiction guard, the M12.5 deferrals, the comment mask, Klartext cycle 20, `G61.1`, Okuma `G56 H`/`M54`/`WORK`/`PS`/`LC`, lathe `G81` in the Series 15 format), SK-04, moving FK points instead of refusing them, the `G76` thread height as an increment once the readers know the block, an upgrade watch on the undo group, a vitest group for the slow tests, and the first-build time of the program map in the web view. The lexer fast path was checked twice: by the package's own differential fuzz (61.6 million reads) and by the NC review over the whole clean-room corpus (0 differences).
