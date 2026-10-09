# Roadmap

A phased plan for a small team of part-time contributors. The phases are ordered by value for people who edit CAM output. Within a phase, items are listed roughly in build order. Dates are deliberately left out. A phase is done when its exit criteria are met, not when every item is finished.

Legend: size **S / M / L**, delivery **Core / Script / Monaco / Profile** (see [README](README.md#conventions-used-in-these-documents)). Status in Phase 2: **shipped** (on `main`), **implemented** (built and tested, about to land on `main`), **planned** (a later Phase 2 milestone), **moved** (to Phase 3), **deferred** (moved to Phase 4 or the backlog), **cut** (no plan to build it). The milestones M6–M13 are those of [phase-2-implementation.md](phase-2-implementation.md#6-milestones).

The open items and the decisions still to be made are collected in [TODO.md](../../TODO.md).

## Phase 0: Foundation (done)

- Tauri 2 + SvelteKit app with a locally bundled Monaco (no CDN)
- Fanuc and Heidenhain Klartext highlighting (Monarch grammars), basic cycle completions
- Program map with tool calls and comments, click to jump
- Code blocks from JSON, inserted from the ribbon
- Python script runner: text on stdin, stdout and JSON shown in the output panel (replaced by the v2 script contract and removed at the end of Phase 1)
- Open / Save / Save As with unsaved-changes tracking and a close guard (including macOS Quit)
- Dialect detection on open (extension, then content), dialect selector, status bar with cursor info
- Platform-aware shortcut labels

The cleanup it left was done in Phase 1 (see [phase-1-implementation.md](phase-1-implementation.md)):

| Item | Size | Link |
|---|---|---|
| Rewrite completion texts in English and move them toward the code database | S | [code-assistant](code-assistant.md#dictionary-driven-completion) |
| Move document state out of `+page.svelte` into a document store (prepares tabs) | M | [editor-core](editor-core.md#multiple-documents-in-tabs) |
| Test setup: fixture folder with sample CAM programs; unit tests for detection and program map | S | [dialect-profiles](dialect-profiles.md#migration-steps) |
| CI builds for macOS, Windows and Linux; contributor guide; third-party license notices | S | [editor-core](editor-core.md#about-and-licenses) |
| Keep UI strings in one place for later translation (rule for all new code) | S | [settings-ui](settings-ui.md#internationalization) |

## Phase 1: MVP editor for CAM output (shipped)

Exit criteria: a user can open several posted programs, navigate them by tool and block number, clean up and renumber them, scale feeds and speeds, list the tools, compare with the previous version, and save without changing encoding or line endings. Python is only needed for the script features.

Status: shipped. Every row below exists, except what §10 of [phase-1-implementation.md](phase-1-implementation.md) records as deferred. The exit scenarios pass on macOS; the last part of the exit condition, the owner's confirmation of the CI bundles on Windows and Linux, is still open.

| Area | Item | Size | Delivery |
|---|---|---|---|
| Editor | [Multiple documents in tabs](editor-core.md#multiple-documents-in-tabs) | M | Core |
| Editor | [New untitled document](editor-core.md#new-untitled-document), [close, close all, save all](editor-core.md#close-close-all-save-all) | S | Core |
| Editor | [Open files](editor-core.md#open-files) (multi-select, drag and drop, focus if already open) | S | Core |
| Editor | [Recent files](editor-core.md#recent-files) | S | Core |
| Editor | [Encoding and line endings](editor-core.md#encoding-and-line-endings) | M | Core |
| Editor | [External change detection](editor-core.md#external-change-detection) | M | Core |
| Editor | [Go to line or block number](editor-core.md#go-to-line-or-block-number) | S | Core |
| Editor | [Next and previous tool change](editor-core.md#next-and-previous-tool-change) | S | Core |
| Editor | [Program map](editor-core.md#program-map) from profile rules, plus quick outline, folding and sticky scroll | S | Core + Monaco |
| Editor | [Bookmarks](editor-core.md#bookmarks): toggle, next/previous | M | Core |
| Editor | [Monaco features exposed](editor-core.md#what-monaco-gives-us) in ribbon and command palette | S | Monaco |
| Editor | [About and licenses](editor-core.md#about-and-licenses) | S | Core |
| Profiles | [Built-in profiles as JSON](dialect-profiles.md#built-in-and-user-profiles) for Fanuc and Heidenhain | M | Core + Profile |
| Profiles | [Detection](dialect-profiles.md#detection) and [outline runner](dialect-profiles.md#outline-program-map) replace hardcoded logic | S | Core |
| Profiles | [Generated grammar and role colors](dialect-profiles.md#tokenizer-and-colors) | M | Core |
| NC | [Transform framework](nc-transformations.md#transform-framework) and [number formatting](nc-transformations.md#number-formatting) | M | Core |
| NC | [NC tokenizer](nc-transformations.md#nc-tokenizer-and-modal-interpreter) (TypeScript) | M | Core |
| NC | [Renumber blocks](nc-transformations.md#renumber-blocks) (basic options), [remove block numbers](nc-transformations.md#remove-block-numbers) | M | Core |
| NC | [Insert spaces](nc-transformations.md#insert-spaces-between-words), [remove spaces](nc-transformations.md#remove-spaces), [remove empty lines](nc-transformations.md#remove-empty-lines), [remove comments](nc-transformations.md#remove-comments), [convert case](nc-transformations.md#convert-case) | M | Core |
| Assistant | [Hover explanations](code-assistant.md#hover-explanations-for-codes) for codes and addresses | M | Core |
| Assistant | [Dictionary-driven completion](code-assistant.md#dictionary-driven-completion) | S | Core |
| Compare | [Compare with an open document, a file or the saved version](file-compare.md#compare-with-an-open-document-a-file-or-the-saved-version) using [Monaco's diff editor](file-compare.md#what-monacos-diff-editor-provides) | S | Monaco + Core |
| Scripting | [Metadata header](scripting.md#script-metadata-header), [parameters](scripting.md#parameters), [context](scripting.md#script-context), [output modes](scripting.md#output-modes) | M | Core |
| Scripting | [Safe apply](scripting.md#applying-results-safely), [timeout and cancel](scripting.md#runtime-timeout-and-cancel), [security rules](scripting.md#security), [script folders and menu](scripting.md#script-folders-and-menu) | S | Core |
| Scripting | Bundled: [scale feed rates](nc-transformations.md#scale-feed-rates), [scale spindle speeds](nc-transformations.md#scale-spindle-speeds), [tool list](nc-transformations.md#tool-list) | M | Script |
| Settings | [Storage layout](settings-ui.md#storage-layout), [basic settings dialog](settings-ui.md#settings-dialog) | S | Core |
| Settings | [Light/dark/system theme](settings-ui.md#themes-and-colors), [default shortcuts](settings-ui.md#keyboard-shortcuts), [window state](settings-ui.md#session-and-state) | S | Core |

<a id="phase-2-real-cam-output-safely-in-progress"></a>

## Phase 2: Real CAM output, safely (done)

Status: **M13 on `main`; Phase 2 done** (2026-10-09). The exit criteria of §2.2 of [phase-2-implementation.md](phase-2-implementation.md#22-phase-2-exit-criteria-testable) are checked by the cumulative runtime suite, with programs and golden results in `tests/fixtures/exit2/`. What was not built is listed under [What Phase 2 did not do](#what-phase-2-did-not-do). Release 1.0 is cut after the owner's bundle check on the three platforms.

Exit criteria: users can open the real output of their posts in all six dialects and trust what the editor reads, check a program before it goes to the machine, shift an address value without corrupting cycle depths, compare re-posted programs without numbering noise, check that the wait codes of a multi-channel program match, and describe their own machines, dialects and codes. Fanuc lathe output and Okuma OSP and Sinumerik turning are supported; Sinumerik milling is added in M9. The testable version is §2.2 of [phase-2-implementation.md](phase-2-implementation.md#22-phase-2-exit-criteria-testable), which also records the scope decision for every row below (§2.1) and what was deferred or cut (§11).

**Re-cut on 2026-09-30 (accepted 2026-10-01; [D69](phase-2-implementation.md#101-decided-by-the-owner-2026-09-22)).** Reading the owner's real programs right had no milestone of its own, although every later feature (checks, extents, address arithmetic, compare) reads values; it now comes first, as M9. Address arithmetic needs only the Python interpreter that shipped in M6, and a Z shift is a daily task that can scrap parts on Klartext and Sinumerik cycle depths, so it moved to M10 beside the checks and extents. The code inspector, hover with modal context, the TypeScript modal interpreter and the templates help understanding and writing but do not make CAM output safer, so they moved to Phase 3. Nothing has been released yet, and Phase 2's exit was four large milestones away, so the plan now releases after each milestone (table below) and real use can steer the next one.

Status, milestone by milestone:

| Milestone | What it delivers | Status |
|---|---|---|
| M6 | The Fanuc lathe profile (G-code systems A and B), profile inheritance for the built-in profiles, machine configurations, the Python modal interpreter, reference-aware renumbering, lathe-aware bundled scripts, and the macOS quit guard | shipped |
| M7 | A backup before a save overwrites a file, crash recovery, session restore, per-file memory (cursor, bookmarks, a dialect or machine chosen by hand), read-only files and a lock per tab | shipped |
| Windows pass | One spelling per path, long file names in the backup history, Windows device names refused, an interpreter lookup that never takes the Microsoft Store placeholders; the Rust tests run on Windows in CI | shipped |
| M8 | Okuma OSP lathe and Sinumerik 840D turning: profiles, grammars and code databases, the Okuma unit systems as machine presets, the Sinumerik diameter default, and both dialects in the bundled scripts | shipped |
| [M9](phase-2-implementation.md#m9-real-programs-read-right) | Real programs read right: a built-in Sinumerik milling profile, 5-axis and high-speed codes, the remaining tokenizer rules, per-machine `U`/`W` and tool-word choices, the values the editor reads wrong today, the detection leftovers and an automated check over the owner's local programs (exit X13) | shipped (on `main` since 2026-10-04; the Sinumerik milling profile is in v0.3.0) |
| [M10](phase-2-implementation.md#m10-check-before-the-machine) | Check before the machine: block skip, selecting a tool segment, program checks, extents and address arithmetic (a shift that moves cycle depths with it, or refuses) | on `main` (2026-10-05); v0.4.0 is a draft |
| [M11](phase-2-implementation.md#m11-compare-and-search) | Compare and search: review mode, merge in both directions, export, two files on disk; NC-aware search and replace; a regex help page | on `main` (2026-10-05); v0.5 follows |
| [M12](phase-2-implementation.md#m12-multi-channel-programs) | Multi-channel programs: channels and wait codes in the machine configuration, the wait-code check, the map and tool list per channel, sync-point navigation, a one-way split into channel documents | on `main` (2026-10-08); v0.6 follows |
| [M13](phase-2-implementation.md#m13-your-own-dialects-and-codes-and-the-phase-2-exit) | Your own dialects and codes, and the Phase 2 exit: user profiles and code files, the Profiles page, import and export of profiles and machines, typing options (upper case on every control) | on `main` (2026-10-09): user profiles and code files (two folders, a Profiles page, a test of a profile on the open program, reload on save, a profile of yours picked automatically only through rules it adds itself), machine import and export, and the typing options. **Phase 2 is done.** 1.0 follows the owner's bundle check |

Releases (accepted 2026-10-01; [D70](phase-2-implementation.md#101-decided-by-the-owner-2026-09-22)). A tagged release follows each milestone that lands on `main`. A new CI release workflow builds the app for macOS, Windows and Linux on a version tag and attaches the bundles to a **draft** GitHub release; publishing it is the owner's call every time. Each release comes with a short owner checklist: open, edit, save byte-exact, the close guard, and one script with and without Python, on the three platforms. That checklist is also how the open Phase 1 exit check (the bundles on Windows and Linux) finally gets done.

| Release | Contents | Status |
|---|---|---|
| v0.2 | M6–M8 with the fixes made since; the release workflow comes first (size S) | published |
| v0.3 | M9, with the Sinumerik milling profile | published |
| v0.4 | M10 | published |
| v0.5 | M11 | published |
| v0.6 | M12, the owner answers of 2026-10-07 and 2026-10-08 | next: ready on `main`, cut when the owner asks |
| 1.0 | M13, the Phase 2 exit | planned: the one release, cut at the very end after the owner's bundle check on the three platforms (the v0.6 changes go into it) |

Row by row:

| Area | Item | Size | Delivery | Status |
|---|---|---|---|---|
| Profiles | [User profiles with `extends`](dialect-profiles.md#built-in-and-user-profiles), [profile editor](dialect-profiles.md#profile-editor) with pattern tester | M | Core | `extends` for the built-in profiles shipped (M6); user profiles with a lean editor (the JSON in a tab, a Profiles page, and a test of the profile on the open document) shipped (M13) |
| Profiles | [Editing options](dialect-profiles.md#editing), [load and save formatting](dialect-profiles.md#load-and-save-formatting), per-profile colors | S | Core | editing options shipped (M13); load and save formatting deferred (backlog); per-profile colors deferred (Phase 4) |
| Profiles | [Fanuc lathe child profile](syntax/syntax-fanuc.md#41-profiles-the-same-code-means-different-things); Sinumerik and Okuma OSP profiles, grammars and code databases ([Sinumerik](syntax/syntax-sinumerik.md), [Okuma](syntax/syntax-okuma.md)) | L | Core + Profile | Fanuc lathe shipped (M6); Okuma and Sinumerik turning shipped (M8); Sinumerik milling shipped (M9, WP9.1, R2) in v0.3.0; Okuma milling still waits for a machining-centre programming manual (R9) |
| Profiles | Real programs read right: 5-axis and high-speed codes, the remaining tokenizer rules, per-machine `U`/`W` and tool words, number classes, detection leftovers, and an automated check over the owner's local programs | L | Core + Profile | shipped (M9, v0.3.0); new in the re-cut |
| Machines | [Machine configurations](../user/machines.md): how a control reads numbers (or its unit system), the G-code system, diameter programming and the power-on modes, with one machine chosen per document | L | Core + Profile | shipped (M6; the Okuma and Sinumerik data in M8); used by the checks and extents (M10), compare (M11) and channels (M12); import and export shipped (M13); the inspector follows in Phase 3 |
| NC | [Modal interpreter](nc-transformations.md#nc-tokenizer-and-modal-interpreter) (TypeScript + `gedit_nc.py`) | M | Core + Script | Python shipped (M6); the TypeScript half is in the Phase 3 table |
| NC | [Reference-aware renumbering](nc-transformations.md#reference-aware-renumbering) (pulled forward from Phase 3) | L | Core | shipped (M6) for references inside the program; `M99 P`, `M98 P… Q…` and references across files stay in Phase 4 |
| NC | [Renumber advanced options](nc-transformations.md#renumber-blocks), [block skip](nc-transformations.md#insert-and-remove-block-skip) | S | Core | advanced options deferred (Phase 4), except keeping the referenced numbers when block numbers are removed, shipped (M6); block skip implemented (M10, WP10.1) |
| NC | [Insert](nc-transformations.md#insert-text-by-rule) / [remove text by rule](nc-transformations.md#remove-text-by-rule), [batch replace](nc-transformations.md#batch-replace-from-a-mapping-file), [address arithmetic](nc-transformations.md#arithmetic-on-address-values), [character cleanup](nc-transformations.md#character-cleanup) | M | Script | text by rule and batch replace deferred (backlog); address arithmetic implemented (M10, WP10.4, on the Python interpreter, with a parameter role for hole bottoms and a refusal for every cycle it cannot judge, R8); character cleanup cut, its reporting part is in the program checks (M10) |
| NC | [Split by tool](nc-transformations.md#split-program-by-tool), [join programs](nc-transformations.md#join-programs) | M | Script | deferred (backlog or Phase 4) |
| NC | [Extents](nc-transformations.md#extents), [program checks](nc-transformations.md#program-checks), [combined tool list](nc-transformations.md#combined-tool-list) | M | Script | extents and program checks implemented (M10, WP10.2 and WP10.3); combined tool list deferred (backlog or Phase 4) |
| NC | [Multi-channel programs](phase-2-implementation.md#m12-multi-channel-programs) (from the backlog): the channels and wait-code patterns of a machine in its configuration, a check that the wait codes of the channels match, the map and tool list per channel, sync-point navigation, a split into channel documents | L | Core + Script | shipped (M12), with the wait codes as a plain list per machine and presets marked *verify*; the side-by-side channel view is Phase 4 |
| Assistant | Hover with cycle parameters and modal context, the code inspector with value editing, parametric templates | M | Core | moved to Phase 3 (table below) |
| Editor | [NC-aware whole-address match](editor-core.md#nc-aware-whole-address-match), [find-all results panel](editor-core.md#find-all-results-panel), [search in open documents](editor-core.md#search-in-all-open-documents), [replace into new document](editor-core.md#replace-into-a-new-document) | M | Core | implemented (M11), with a replace count and word conditions (`S>2000`) |
| Editor | [Next and previous NC event](editor-core.md#next-and-previous-nc-event), [bookmarks v2](editor-core.md#bookmarks) (names, panel, persistence) | M | Core | bookmark persistence shipped (M7); names and panel deferred (Phase 4); NC event deferred (Phase 4, if asked for) |
| Editor | [Block range](editor-core.md#select-or-delete-a-block-range), [tool segment](editor-core.md#select-or-extract-a-tool-segment), [insert/append file](editor-core.md#insert-file-and-append-file) | S | Core | selecting a tool segment implemented (M10, `Mod+F7`); the rest deferred (Phase 4) |
| Editor | [Read-only files](editor-core.md#read-only-files), [backup and recovery](editor-core.md#backup-on-save-and-crash-recovery) | S | Core | shipped (M7) |
| Editor | [OS file associations](editor-core.md#os-file-associations) | S | Core | deferred (Phase 4) |
| Editor | macOS quit guard: Dock → Quit and logout stop at the unsaved-changes prompt (deferred from Phase 1) | S | Core | shipped (M6) |
| Editor | [Forced uppercase](editor-core.md#forced-uppercase), [prevent joining blocks](editor-core.md#prevent-joining-blocks) | S | Core | shipped (M13): letters typed in code are made upper case on every control (comments, strings and free text as typed), Backspace and Delete do not join two blocks of text, and a session switch |
| Editor | [Bundled user guide](editor-core.md#bundled-user-guide), [regex help](editor-core.md#regular-expression-help) | S | Core | in-app guide cut (the guide is `docs/user`); regex help is a page there, `docs/user/regex.md` (M11) |
| Compare | [Ignore options](file-compare.md#ignore-options) via [review mode](file-compare.md#nc-aware-review-mode), [word-level marking](file-compare.md#word-level-marking) | M | Core | review mode implemented (M11), without a numeric tolerance (cut); word-level marking deferred (Phase 4) |
| Compare | [Merge in both directions](file-compare.md#copy-differences-in-both-directions), [export differences](file-compare.md#export-differences), two files on disk | M | Core | implemented (M11) |
| Scripting | [External commands](scripting.md#external-commands) | M | Core | cut: a script can start a program itself |
| Settings | [Full settings dialog](settings-ui.md#settings-dialog), [role color editor](settings-ui.md#themes-and-colors), [session restore and per-file memory](settings-ui.md#session-and-state), [profile import/export](settings-ui.md#configuration-portability) | M | Core | session restore and per-file memory shipped (M7); the dialog grows by pages (Machines in M6, Profiles in M13), without a search box; import and export of profiles and machines shipped (M13); role color editor deferred (Phase 4) |

### What Phase 2 did not do

The exit criteria hold, and these things the original Phase 2 listed were moved or cut on purpose; §11 of [phase-2-implementation.md](phase-2-implementation.md#11-deferred-or-cut-items-phase-2--phase-3-or-backlog) gives the reasons.

- **Moved to Phase 3:** the code inspector and editing values in it, hover with cycle parameters and modal context, the TypeScript modal interpreter, and parametric templates (exit criteria X7 and the templates half of X9).
- **Deferred to Phase 4** (the rows of the Phase 4 table): advanced renumber options, `M99 P` and cross-file references in reference-aware renumbering, word-level marking in compare, bookmark names and panel, selecting or extracting a block range, insert and append file, OS file associations, next and previous NC event (if asked for), per-profile colors and the role color editor, and the **side-by-side channel view**.
- **Deferred to the backlog** (or to Phase 4, if asked for): insert and remove text by rule, batch replace from a mapping file, a combined tool list, split by tool and join programs, and load and save formatting.
- **Cut:** external commands (a script can start a program itself), a numeric tolerance in compare, an in-app copy of the user guide, character cleanup with transliteration tables, and a global viewer mode.
- **Not covered by a profile:** Okuma milling waits for a machining-centre programming manual (R9). The channel presets are generic and marked *verify*; the owner checks them on a real machine.

The release notes of 1.0 repeat this list.

## Phase 3: Understand and write (in progress)

Exit criteria: a user can put the cursor in any block and see what each word means and what is in force there (the code inspector), change a value from the inspector, read a cycle's parameters and the modal context in the hover, see at a glance how each line moves (motion colors), and insert parameterized templates in place of the old code blocks. The TypeScript modal interpreter gives the same answers as the Python one, line by line. These are exit criteria X7 (the inspector) and the templates half of X9 of the former Phase 2 plan, plus X14–X18 (hover, parity, motion colors, no regression within the budgets, cycle forms and the template manager); X9 keeps the user-profile and code-file half in Phase 2.

Status: **the plan of record is [phase-3-implementation.md](phase-3-implementation.md)** (2026-10-09), with two milestones: **P3a "Understand a block"** (implemented on `p3a/int`, 2026-10-09: P3.1, P3.2a/b, P3.3 and P3.7 with the user guide; two reviews and a skeptic pass with both fix batches are done, the local runs of the new scenarios pass, and it **lands on `main` next**, with the runtime suite on the GitHub runner after the landing) and **P3b "Write with templates"** (designed; its prelude follows P3a). The designs that the Phase 2 plan kept for Phase 3 moved there.

| Area | Item | Size | Delivery | Plan | Status |
|---|---|---|---|---|---|
| NC | [Modal interpreter](nc-transformations.md#nc-tokenizer-and-modal-interpreter), TypeScript half, matching the Python one on the shared goldens, line by line | M | Core | [P3a](phase-3-implementation.md#p3a-understand-a-block): P3.1 | done: reviewed and fixed, on `main` |
| Assistant | [Code inspector panel](code-assistant.md#code-inspector-panel), [edit values](code-assistant.md#edit-values-in-the-inspector) | M | Core | P3a: P3.2a (reading a word, the rows, editing a value), P3.2b (the panel) | done: reviewed and fixed, on `main` |
| Assistant | [Hover with cycle parameters and modal context](code-assistant.md#hover-explanations-for-codes) | S | Core | P3a: P3.3 | done: reviewed and fixed, on `main` |
| Profiles | Motion-mode line coloring from the modal interpreter ([tokenizer and colors](dialect-profiles.md#tokenizer-and-colors)): a colored mark beside each line that moves (rapid, straight, arc, thread, cycle), with a setting | M | Core | P3a: P3.7 | done (AD-34): reviewed and fixed, on `main` |
| Assistant | [Parametric templates](code-assistant.md#parametric-templates), [placeholders](code-assistant.md#placeholders), [file-based templates](code-assistant.md#template-files-and-management): the engine | M | Core | [P3b](phase-3-implementation.md#p3b-write-with-templates): P3.4 | planned |
| Assistant | [Templates in completion](code-assistant.md#templates-in-completion) and in the Insert tab, in place of the blocks JSON | M | Core | P3b: P3.5 | planned |
| Assistant | Template content for the built-in dialects, marked "review pending" until the owner's review | M | Profile | P3b: P3.6 | planned |
| Assistant | [Cycle forms](code-assistant.md#cycle-forms), [formula parameters](code-assistant.md#formula-parameters), [template manager UI and create from selection](code-assistant.md#template-files-and-management) | M | Core | P3b: P3.8, P3.9 (designed by the P3b prelude) | planned |
| Profiles | Form-generated profile editor with a live preview, beside the template manager UI ([phase-2-implementation.md §11 item 1](phase-2-implementation.md#11-deferred-or-cut-items-phase-2--phase-3-or-backlog); D40) | M | Core | with the template manager UI | planned |

## Phase 4: Comfort and geometry

Exit criteria: geometry transforms and cycle expansion work reliably on the fixture set, and the editor has the comfort features long-time users expect. This was Phase 3 before the re-cut of 2026-09-30.

| Area | Item | Size | Delivery |
|---|---|---|---|
| NC | [Translate](nc-transformations.md#translate-coordinates), [rotate](nc-transformations.md#rotate-coordinates), [mirror](nc-transformations.md#mirror-coordinates) | L | Script |
| NC | [Expand drilling cycles](nc-transformations.md#expand-drilling-cycles), [statistics and time estimate](nc-transformations.md#statistics-and-time-estimate) | M | Script |
| Compare | [Aligned NC-aware diff with merge](file-compare.md#aligned-nc-aware-diff-with-merge) (only if review mode proves too limited), [word-level marking](file-compare.md#word-level-marking) | L | Core |
| Editor | [Split view](editor-core.md#split-view), [printing](editor-core.md#printing), [find files in folders](editor-core.md#find-files-in-folders) | M | Core |
| Editor | [Side-by-side channel view](phase-2-implementation.md#11-deferred-or-cut-items-phase-2--phase-3-or-backlog): the channels of a program in parallel editable panes, lined up at their wait codes (deferred from Phase 2's multi-channel milestone) | L | Core |
| Editor | [Auto-space while typing](editor-core.md#auto-space-while-typing), [automatic block number on Enter](editor-core.md#automatic-block-number-on-enter) | M | Core |
| Editor | [Bookmark names and panel](editor-core.md#bookmarks), [block range](editor-core.md#select-or-delete-a-block-range), [insert/append file](editor-core.md#insert-file-and-append-file), [OS file associations](editor-core.md#os-file-associations), [next and previous NC event](editor-core.md#next-and-previous-nc-event) (if asked for) | M | Core |
| NC | [Renumber advanced options](nc-transformations.md#renumber-blocks); `M99 P`, `M98 P… Q…` and cross-file references in [reference-aware renumbering](nc-transformations.md#reference-aware-renumbering) | M | Core |
| Scripting | [Script packages](scripting.md#plugins) enable/disable, per-script shortcuts | S | Core |
| Settings | [Keyboard shortcut customization](settings-ui.md#keyboard-shortcuts), [full config export/import and relocation](settings-ui.md#configuration-portability), [UI translations](settings-ui.md#internationalization) | M | Core |
| Settings | Per-profile colors and the [role color editor](settings-ui.md#themes-and-colors), a settings search box, JSON Schemas for profiles and machines | M | Core |
| Profiles | Per-profile `tabWidth`, `rulers` and completion mode; hover delay and modifier modes; a quick switcher in recently-used order (§11 item 21; or cut) | S | Core |
| Machines | The later machine parameters (§11 item 26): folder-to-machine rules, a `toolWord` variant for short lathe `T` words, machine limits (top spindle speed, travel) used by the program checks, per-block parameter units (`G76` `P`), editing per-class number input in the dialog (or when asked for) | M | Core + Profile |
| Editor | Multi-channel, the rest (§11 item 28): merging a split channel document back into its source, channel-aware compare and search scope, a sync timeline, writing the split channels to disk, a check that follows jumps, folder-aware sibling lookup, and sync presets per control | L | Core |

Reference-aware renumbering, once a Phase 3 row, was pulled forward and shipped in Phase 2 (M6). The Phase 2 rows marked "deferred (Phase 4)" are in this table; §11 of [phase-2-implementation.md](phase-2-implementation.md#11-deferred-or-cut-items-phase-2--phase-3-or-backlog) lists them with the reasons.

## Backlog (unscheduled)

Good candidates for contributed scripts. See [nc-transformations backlog](nc-transformations.md#backlog).

- Chart of axis positions and feed over the program
- Apply a tool radius offset to the path
- Klartext ↔ ISO and ISO ↔ ISO conversion for simple motion code
- Template-based (HTML) tool list and setup sheet output
- Multi-level outline from keywords in comments (tool → operation → step)
- Illustrations for templates and cycle parameters
- Findings from check scripts shown as editor markers while typing (live lint)
- Native application menus on Windows and Linux (macOS has one; the owner, 2026-10-08)
- A Klartext comment toggle that puts the `;` after the block number (the owner, 2026-10-08)
- R9, an Okuma machining-centre profile: when a programming manual of the machining-centre control arrives ([source review §5](source-review-2026-09.md#5-roadmap-proposals); moved here from the open questions on 2026-10-08)
- R10, the function feeds (`M128 F`, `M140 F`, `PLANE F`, cycle 19's `F`) and Klartext's Q-parameter feeds: when a real program shows such a feed (moved here from the open questions on 2026-10-08)
- Insert and remove text by rule, and batch replace from a mapping file (deferred from Phase 2; good first contributed scripts)
- A combined tool list over several channel files, and split by tool and join programs (deferred from Phase 2; they need scripts that take several documents, the `documents: all-open | pick` of P1 D16)
- Load and save formatting per profile (deferred from Phase 2)

Splitting multi-channel lathe programs by channel and checking their wait codes moved into Phase 2 and shipped there (M12). The Phase 2 rows marked "deferred (backlog)" joined this list when Phase 2 closed.

## Not planned

Out of scope for gEdit for now. We may revisit them later, but no design work is planned.

- **Toolpath display and simulation:** backplot and 3D toolpath view, animation, material-removal simulation, comparison against a design model, machine kinematics and collision checks, machine and tool geometry libraries, simulation setup data (stock, fixtures, tool dimensions), toolpath export to drawing formats.
- **Machine communication (DNC):** sending and receiving programs over serial lines, network or FTP transfer, and transfer monitors.
- **Program management:** program databases with machine assignment, revision servers, check-in/check-out, and ERP/PDM integration.
- **Conversational and proprietary formats:** conversational shop-floor formats and viewers for them, and machine-builder-specific cycles. gEdit ships no wait-code (sync) set of any machine builder either. The channel and wait-code patterns of your own machines, on the other hand, are a supported machine setting that you write yourself (built in M12; the presets are generic and marked *verify*), and your own M codes go in a code file of your own (M13).
- **Legacy conveniences:** line-printer output, punched-tape length display, serial print statements for data collection, launching the OS calculator, auto-exit when idle, lock files for concurrent access, a settings password, warning sounds, and virtual space past the line end.
- **Cut from Phase 2:** external commands (a script can start a program itself), a numeric tolerance in compare, an in-app copy of the user guide, character cleanup with transliteration tables, and a global viewer mode (cut by the owner, 2026-10-08).
