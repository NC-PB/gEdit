# Roadmap

A phased plan for a small team of part-time contributors. The phases are ordered by value for people who edit CAM output. Within a phase, items are listed roughly in build order. Dates are deliberately left out. A phase is done when its exit criteria are met, not when every item is finished.

Legend: size **S / M / L**, delivery **Core / Script / Monaco / Profile** (see [README](README.md#conventions-used-in-these-documents)). Status in Phase 2: **shipped** (on `main`), **implemented** (built and tested, about to land on `main`), **planned** (a later Phase 2 milestone), **deferred** (moved to Phase 3 or the backlog), **cut** (no plan to build it). The milestones M6–M12 are those of [phase-2-implementation.md](phase-2-implementation.md#6-milestones).

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

## Phase 2: NC-aware power features (in progress)

Exit criteria: users can describe their own machines (machine configurations) and dialects (user profiles), understand and edit any block through the inspector, insert parameterized templates, compare re-posted programs without numbering noise, check that the wait codes of a multi-channel program match, and run the common checks and transformations as bundled scripts. Fanuc lathe output and Okuma OSP and Sinumerik turning are supported. The testable version is §2.2 of [phase-2-implementation.md](phase-2-implementation.md#22-phase-2-exit-criteria-testable), which also records the scope decision for every row below (§2.1) and what was deferred or cut (§11).

Status, milestone by milestone:

| Milestone | What it delivers | Status |
|---|---|---|
| M6 | The Fanuc lathe profile (G-code systems A and B), profile inheritance for the built-in profiles, machine configurations, the Python modal interpreter, reference-aware renumbering, lathe-aware bundled scripts, and the macOS quit guard | shipped |
| M7 | A backup before a save overwrites a file, crash recovery, session restore, per-file memory (cursor, bookmarks, a dialect or machine chosen by hand), read-only files and a lock per tab | shipped |
| Windows pass | One spelling per path, long file names in the backup history, Windows device names refused, an interpreter lookup that never takes the Microsoft Store placeholders; the Rust tests run on Windows in CI | shipped |
| M8 | Okuma OSP lathe and Sinumerik 840D turning: profiles, grammars and code databases, the Okuma unit systems as machine presets, the Sinumerik diameter default, and both dialects in the bundled scripts | implemented, about to land |
| M9 | Compare and search: review mode, merge in both directions, export, two files on disk; NC-aware search and replace; block skip; selecting a tool segment; program checks and extents; a regex help page; its prelude also adds a built-in Sinumerik milling profile, 5-axis/high-speed code entries and data flags, remaining tokenizer rules, and per-machine tool-word and `U`/`W` choices, plus manual-certain program checks in WP9.4 (roadmap R2, R3, R4, R6 and R7, accepted 2026-09-27) | planned |
| M10 | Multi-channel programs: channels and wait codes in the machine configuration, the wait-code check, the map and tool list per channel, sync-point navigation, a one-way split into channel documents | planned |
| M11 | The TypeScript modal interpreter, the code inspector with value editing, hover with cycle parameters and modal context, address arithmetic | planned |
| M12 | Templates in place of the code blocks, user profiles and code files, the Profiles page, import and export of profiles and machines, typing options, and the Phase 2 exit | planned |

Row by row:

| Area | Item | Size | Delivery | Status |
|---|---|---|---|---|
| Profiles | [User profiles with `extends`](dialect-profiles.md#built-in-and-user-profiles), [profile editor](dialect-profiles.md#profile-editor) with pattern tester | M | Core | `extends` for the built-in profiles shipped (M6); user profiles and a lean editor (the JSON in a tab, and a test of the profile on the open document) planned (M12) |
| Profiles | [Editing options](dialect-profiles.md#editing), [load and save formatting](dialect-profiles.md#load-and-save-formatting), per-profile colors | S | Core | editing options planned (M12); load and save formatting deferred (backlog); per-profile colors deferred (Phase 3) |
| Profiles | [Fanuc lathe child profile](syntax/syntax-fanuc.md#41-profiles-the-same-code-means-different-things); Sinumerik and Okuma OSP profiles, grammars and code databases ([Sinumerik](syntax/syntax-sinumerik.md), [Okuma](syntax/syntax-okuma.md)) | L | Core + Profile | Fanuc lathe shipped (M6); Okuma and Sinumerik, turning only, implemented (M8); Sinumerik milling planned (M9 prelude, R2); Okuma milling still waits for a machining-centre programming manual (R9) |
| Machines | [Machine configurations](../user/machines.md): how a control reads numbers (or its unit system), the G-code system, diameter programming and the power-on modes, with one machine chosen per document | L | Core + Profile | shipped (M6; the Okuma and Sinumerik data in M8); used by compare and the checks (M9), channels (M10) and the inspector (M11); import and export planned (M12) |
| NC | [Modal interpreter](nc-transformations.md#nc-tokenizer-and-modal-interpreter) (TypeScript + `gedit_nc.py`) | M | Core + Script | Python shipped (M6); TypeScript planned (M11) |
| NC | [Reference-aware renumbering](nc-transformations.md#reference-aware-renumbering) (pulled forward from Phase 3) | L | Core | shipped (M6) for references inside the program; `M99 P`, `M98 P… Q…` and references across files stay in Phase 3 |
| NC | [Renumber advanced options](nc-transformations.md#renumber-blocks), [block skip](nc-transformations.md#insert-and-remove-block-skip) | S | Core | advanced options deferred (Phase 3), except keeping the referenced numbers when block numbers are removed, shipped (M6); block skip planned (M9) |
| NC | [Insert](nc-transformations.md#insert-text-by-rule) / [remove text by rule](nc-transformations.md#remove-text-by-rule), [batch replace](nc-transformations.md#batch-replace-from-a-mapping-file), [address arithmetic](nc-transformations.md#arithmetic-on-address-values), [character cleanup](nc-transformations.md#character-cleanup) | M | Script | text by rule and batch replace deferred (backlog); address arithmetic planned (M11); character cleanup cut, its reporting part goes into the program checks (M9) |
| NC | [Split by tool](nc-transformations.md#split-program-by-tool), [join programs](nc-transformations.md#join-programs) | M | Script | deferred (backlog or Phase 3) |
| NC | [Extents](nc-transformations.md#extents), [program checks](nc-transformations.md#program-checks), [combined tool list](nc-transformations.md#combined-tool-list) | M | Script | extents and program checks planned (M9); combined tool list deferred (backlog or Phase 3) |
| NC | [Multi-channel programs](phase-2-implementation.md#m10-multi-channel-programs-channels-wait-codes-per-channel-views) (from the backlog): the channels and wait-code patterns of a machine in its configuration, a check that the wait codes of the channels match, the map and tool list per channel, sync-point navigation, a split into channel documents | L | Core + Script | planned (M10); the side-by-side channel view is Phase 3 |
| Assistant | [Hover with cycle parameters and modal context](code-assistant.md#hover-explanations-for-codes) | S | Core | planned (M11) |
| Assistant | [Code inspector panel](code-assistant.md#code-inspector-panel), [edit values](code-assistant.md#edit-values-in-the-inspector) | M | Core | planned (M11), without a template list |
| Assistant | [Parametric templates](code-assistant.md#parametric-templates), [placeholders](code-assistant.md#placeholders), [file-based templates](code-assistant.md#template-files-and-management), [templates in completion](code-assistant.md#templates-in-completion); migrate blocks JSON | M | Core | planned (M12); formula parameters stay in Phase 3 |
| Editor | [NC-aware whole-address match](editor-core.md#nc-aware-whole-address-match), [find-all results panel](editor-core.md#find-all-results-panel), [search in open documents](editor-core.md#search-in-all-open-documents), [replace into new document](editor-core.md#replace-into-a-new-document) | M | Core | planned (M9), with a replace count and word conditions (`S>2000`) |
| Editor | [Next and previous NC event](editor-core.md#next-and-previous-nc-event), [bookmarks v2](editor-core.md#bookmarks) (names, panel, persistence) | M | Core | bookmark persistence shipped (M7); names and panel deferred (Phase 3); NC event deferred (Phase 3, if asked for) |
| Editor | [Block range](editor-core.md#select-or-delete-a-block-range), [tool segment](editor-core.md#select-or-extract-a-tool-segment), [insert/append file](editor-core.md#insert-file-and-append-file) | S | Core | selecting a tool segment planned (M9); the rest deferred (Phase 3) |
| Editor | [Read-only files](editor-core.md#read-only-files), [backup and recovery](editor-core.md#backup-on-save-and-crash-recovery) | S | Core | shipped (M7) |
| Editor | [OS file associations](editor-core.md#os-file-associations) | S | Core | deferred (Phase 3) |
| Editor | macOS quit guard: Dock → Quit and logout stop at the unsaved-changes prompt (deferred from Phase 1) | S | Core | shipped (M6) |
| Editor | [Forced uppercase](editor-core.md#forced-uppercase), [prevent joining blocks](editor-core.md#prevent-joining-blocks) | S | Core | planned (M12) |
| Editor | [Bundled user guide](editor-core.md#bundled-user-guide), [regex help](editor-core.md#regular-expression-help) | S | Core | in-app guide cut (the guide is `docs/user`); regex help planned as a page there (M9) |
| Compare | [Ignore options](file-compare.md#ignore-options) via [review mode](file-compare.md#nc-aware-review-mode), [word-level marking](file-compare.md#word-level-marking) | M | Core | review mode planned (M9), without a numeric tolerance (cut); word-level marking deferred (Phase 3) |
| Compare | [Merge in both directions](file-compare.md#copy-differences-in-both-directions), [export differences](file-compare.md#export-differences), two files on disk | M | Core | planned (M9) |
| Scripting | [External commands](scripting.md#external-commands) | M | Core | cut: a script can start a program itself |
| Settings | [Full settings dialog](settings-ui.md#settings-dialog), [role color editor](settings-ui.md#themes-and-colors), [session restore and per-file memory](settings-ui.md#session-and-state), [profile import/export](settings-ui.md#configuration-portability) | M | Core | session restore and per-file memory shipped (M7); the dialog grows by pages (Machines in M6, Profiles in M12), without a search box; import and export of profiles and machines planned (M12); role color editor deferred (Phase 3) |

## Phase 3: Comfort and advanced transformations

Exit criteria: geometry transforms and cycle expansion work reliably on the fixture set, and the editor has the comfort features long-time users expect.

| Area | Item | Size | Delivery |
|---|---|---|---|
| NC | [Translate](nc-transformations.md#translate-coordinates), [rotate](nc-transformations.md#rotate-coordinates), [mirror](nc-transformations.md#mirror-coordinates) | L | Script |
| NC | [Expand drilling cycles](nc-transformations.md#expand-drilling-cycles), [statistics and time estimate](nc-transformations.md#statistics-and-time-estimate) | M | Script |
| Assistant | [Cycle forms](code-assistant.md#cycle-forms), [formula parameters](code-assistant.md#formula-parameters), [template manager UI and create from selection](code-assistant.md#template-files-and-management) | M | Core |
| Compare | [Aligned NC-aware diff with merge](file-compare.md#aligned-nc-aware-diff-with-merge) (only if review mode proves too limited) | L | Core |
| Editor | [Split view](editor-core.md#split-view), [printing](editor-core.md#printing), [find files in folders](editor-core.md#find-files-in-folders) | M | Core |
| Editor | [Side-by-side channel view](phase-2-implementation.md#11-deferred-or-cut-items-phase-2--phase-3-or-backlog): the channels of a program in parallel editable panes, lined up at their wait codes (deferred from Phase 2's multi-channel milestone) | L | Core |
| Editor | [Auto-space while typing](editor-core.md#auto-space-while-typing), [automatic block number on Enter](editor-core.md#automatic-block-number-on-enter) | M | Core |
| Profiles | Motion-mode line coloring from the modal interpreter ([tokenizer and colors](dialect-profiles.md#tokenizer-and-colors)) | M | Core |
| Scripting | [Script packages](scripting.md#plugins) enable/disable, per-script shortcuts | S | Core |
| Settings | [Keyboard shortcut customization](settings-ui.md#keyboard-shortcuts), [full config export/import and relocation](settings-ui.md#configuration-portability), [UI translations](settings-ui.md#internationalization) | M | Core |

Reference-aware renumbering, once a Phase 3 row, was pulled forward and shipped in Phase 2 (M6). The Phase 2 rows marked "deferred (Phase 3)" join this table when Phase 2 closes; §11 of [phase-2-implementation.md](phase-2-implementation.md#11-deferred-or-cut-items-phase-2--phase-3-or-backlog) lists them with the reasons.

## Backlog (unscheduled)

Good candidates for contributed scripts. See [nc-transformations backlog](nc-transformations.md#backlog).

- Chart of axis positions and feed over the program
- Apply a tool radius offset to the path
- Klartext ↔ ISO and ISO ↔ ISO conversion for simple motion code
- Template-based (HTML) tool list and setup sheet output
- Multi-level outline from keywords in comments (tool → operation → step)
- Illustrations for templates and cycle parameters
- Findings from check scripts shown as editor markers while typing (live lint)

Splitting multi-channel lathe programs by channel and checking their wait codes moved into Phase 2 (M10). The Phase 2 rows marked "deferred (backlog)" join this list when Phase 2 closes.

## Not planned

Out of scope for gEdit for now. We may revisit them later, but no design work is planned.

- **Toolpath display and simulation:** backplot and 3D toolpath view, animation, material-removal simulation, comparison against a design model, machine kinematics and collision checks, machine and tool geometry libraries, simulation setup data (stock, fixtures, tool dimensions), toolpath export to drawing formats.
- **Machine communication (DNC):** sending and receiving programs over serial lines, network or FTP transfer, and transfer monitors.
- **Program management:** program databases with machine assignment, revision servers, check-in/check-out, and ERP/PDM integration.
- **Conversational and proprietary formats:** conversational shop-floor formats and viewers for them, machine-builder-specific cycles, and built-in wait-code sets per machine builder. (The channels and wait codes of your own machines are a machine setting you write yourself, planned for M10.)
- **Legacy conveniences:** line-printer output, punched-tape length display, serial print statements for data collection, launching the OS calculator, auto-exit when idle, lock files for concurrent access, a settings password, warning sounds, and virtual space past the line end.
- **Cut from Phase 2:** external commands (a script can start a program itself), a numeric tolerance in compare, an in-app copy of the user guide, and character cleanup with transliteration tables.
