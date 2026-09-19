# Roadmap

A phased plan for a small team of part-time contributors. The phases are ordered by value for people who edit CAM output. Within a phase, items are listed roughly in build order. Dates are deliberately left out. A phase is done when its exit criteria are met, not when every item is finished.

Legend: size **S / M / L**, delivery **Core / Script / Monaco / Profile** (see [README](README.md#conventions-used-in-these-documents)).

## Phase 0: Foundation (done / in progress)

Done:

- Tauri 2 + SvelteKit app with a locally bundled Monaco (no CDN)
- Fanuc and Heidenhain Klartext highlighting (Monarch grammars), basic cycle completions
- Program map with tool calls and comments, click to jump
- Code blocks from JSON, inserted from the ribbon
- Python script runner: text on stdin, stdout and JSON shown in the output panel
- Open / Save / Save As with unsaved-changes tracking and a close guard (including macOS Quit)
- Dialect detection on open (extension, then content), dialect selector, status bar with cursor info
- Platform-aware shortcut labels

Remaining cleanup:

| Item | Size | Link |
|---|---|---|
| Rewrite completion texts in English (currently German) and move them toward the code database | S | [code-assistant](code-assistant.md#dictionary-driven-completion) |
| Move document state out of `+page.svelte` into a document store (prepares tabs) | M | [editor-core](editor-core.md#multiple-documents-in-tabs) |
| Test setup: fixture folder with sample CAM programs; unit tests for detection and program map | S | [dialect-profiles](dialect-profiles.md#migration-steps) |
| CI builds for macOS, Windows and Linux; contributor guide; third-party license notices | S | [editor-core](editor-core.md#about-and-licenses) |
| Keep UI strings in one place for later translation (rule for all new code) | S | [settings-ui](settings-ui.md#internationalization) |

## Phase 1: MVP editor for CAM output

Exit criteria: a user can open several posted programs, navigate them by tool and block number, clean up and renumber them, scale feeds and speeds, list the tools, compare with the previous version, and save without changing encoding or line endings. Python is only needed for the script features.

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

## Phase 2: NC-aware power features

Exit criteria: users can define their own machine profiles, understand and edit any block through the inspector, insert parameterized templates, compare re-posted programs without numbering noise, and run the common checks and transformations as bundled scripts. Fanuc lathe output, Sinumerik and Okuma OSP are supported.

| Area | Item | Size | Delivery |
|---|---|---|---|
| Profiles | [User profiles with `extends`](dialect-profiles.md#built-in-and-user-profiles), [profile editor](dialect-profiles.md#profile-editor) with pattern tester | M | Core |
| Profiles | [Editing options](dialect-profiles.md#editing), [load and save formatting](dialect-profiles.md#load-and-save-formatting), per-profile colors | S | Core |
| Profiles | [Fanuc lathe child profile](syntax/syntax-fanuc.md#41-profiles-the-same-code-means-different-things); Sinumerik and Okuma OSP profiles, grammars and code databases ([Sinumerik](syntax/syntax-sinumerik.md), [Okuma](syntax/syntax-okuma.md)) | L | Core + Profile |
| NC | [Modal interpreter](nc-transformations.md#nc-tokenizer-and-modal-interpreter) (TypeScript + `gedit_nc.py`) | M | Core + Script |
| NC | [Renumber advanced options](nc-transformations.md#renumber-blocks), [block skip](nc-transformations.md#insert-and-remove-block-skip) | S | Core |
| NC | [Insert](nc-transformations.md#insert-text-by-rule) / [remove text by rule](nc-transformations.md#remove-text-by-rule), [batch replace](nc-transformations.md#batch-replace-from-a-mapping-file), [address arithmetic](nc-transformations.md#arithmetic-on-address-values), [character cleanup](nc-transformations.md#character-cleanup) | M | Script |
| NC | [Split by tool](nc-transformations.md#split-program-by-tool), [join programs](nc-transformations.md#join-programs) | M | Script |
| NC | [Extents](nc-transformations.md#extents), [program checks](nc-transformations.md#program-checks), [combined tool list](nc-transformations.md#combined-tool-list) | M | Script |
| Assistant | [Hover with cycle parameters and modal context](code-assistant.md#hover-explanations-for-codes) | S | Core |
| Assistant | [Code inspector panel](code-assistant.md#code-inspector-panel), [edit values](code-assistant.md#edit-values-in-the-inspector) | M | Core |
| Assistant | [Parametric templates](code-assistant.md#parametric-templates), [placeholders](code-assistant.md#placeholders), [file-based templates](code-assistant.md#template-files-and-management), [templates in completion](code-assistant.md#templates-in-completion); migrate blocks JSON | M | Core |
| Editor | [NC-aware whole-address match](editor-core.md#nc-aware-whole-address-match), [find-all results panel](editor-core.md#find-all-results-panel), [search in open documents](editor-core.md#search-in-all-open-documents), [replace into new document](editor-core.md#replace-into-a-new-document) | M | Core |
| Editor | [Next and previous NC event](editor-core.md#next-and-previous-nc-event), [bookmarks v2](editor-core.md#bookmarks) (names, panel, persistence) | M | Core |
| Editor | [Block range](editor-core.md#select-or-delete-a-block-range), [tool segment](editor-core.md#select-or-extract-a-tool-segment), [insert/append file](editor-core.md#insert-file-and-append-file) | S | Core |
| Editor | [Read-only files](editor-core.md#read-only-files), [backup and recovery](editor-core.md#backup-on-save-and-crash-recovery), [OS file associations](editor-core.md#os-file-associations) | S | Core |
| Editor | [Forced uppercase](editor-core.md#forced-uppercase), [prevent joining blocks](editor-core.md#prevent-joining-blocks) | S | Core |
| Editor | [Bundled user guide](editor-core.md#bundled-user-guide), [regex help](editor-core.md#regular-expression-help) | S | Core |
| Compare | [Ignore options](file-compare.md#ignore-options) via [review mode](file-compare.md#nc-aware-review-mode), [word-level marking](file-compare.md#word-level-marking) | M | Core |
| Compare | [Merge in both directions](file-compare.md#copy-differences-in-both-directions), [export differences](file-compare.md#export-differences), two files on disk | M | Core |
| Scripting | [External commands](scripting.md#external-commands) | M | Core |
| Settings | [Full settings dialog](settings-ui.md#settings-dialog), [role color editor](settings-ui.md#themes-and-colors), [session restore and per-file memory](settings-ui.md#session-and-state), [profile import/export](settings-ui.md#configuration-portability) | M | Core |

## Phase 3: Comfort and advanced transformations

Exit criteria: geometry transforms and cycle expansion work reliably on the fixture set, and the editor has the comfort features long-time users expect.

| Area | Item | Size | Delivery |
|---|---|---|---|
| NC | [Translate](nc-transformations.md#translate-coordinates), [rotate](nc-transformations.md#rotate-coordinates), [mirror](nc-transformations.md#mirror-coordinates) | L | Script |
| NC | [Expand drilling cycles](nc-transformations.md#expand-drilling-cycles), [statistics and time estimate](nc-transformations.md#statistics-and-time-estimate) | M | Script |
| NC | [Reference-aware renumbering](nc-transformations.md#reference-aware-renumbering) | L | Core |
| Assistant | [Cycle forms](code-assistant.md#cycle-forms), [formula parameters](code-assistant.md#formula-parameters), [template manager UI and create from selection](code-assistant.md#template-files-and-management) | M | Core |
| Compare | [Aligned NC-aware diff with merge](file-compare.md#aligned-nc-aware-diff-with-merge) (only if review mode proves too limited) | L | Core |
| Editor | [Split view](editor-core.md#split-view), [printing](editor-core.md#printing), [find files in folders](editor-core.md#find-files-in-folders) | M | Core |
| Editor | [Auto-space while typing](editor-core.md#auto-space-while-typing), [automatic block number on Enter](editor-core.md#automatic-block-number-on-enter) | M | Core |
| Profiles | Motion-mode line coloring from the modal interpreter ([tokenizer and colors](dialect-profiles.md#tokenizer-and-colors)) | M | Core |
| Scripting | [Script packages](scripting.md#plugins) enable/disable, per-script shortcuts | S | Core |
| Settings | [Keyboard shortcut customization](settings-ui.md#keyboard-shortcuts), [full config export/import and relocation](settings-ui.md#configuration-portability), [UI translations](settings-ui.md#internationalization) | M | Core |

## Backlog (unscheduled)

Good candidates for contributed scripts. See [nc-transformations backlog](nc-transformations.md#backlog).

- Split multi-channel lathe programs by channel and check wait codes (generic patterns only)
- Chart of axis positions and feed over the program
- Apply a tool radius offset to the path
- Klartext ↔ ISO and ISO ↔ ISO conversion for simple motion code
- Template-based (HTML) tool list and setup sheet output
- Multi-level outline from keywords in comments (tool → operation → step)
- Illustrations for templates and cycle parameters
- Findings from check scripts shown as editor markers while typing (live lint)

## Not planned

Out of scope for gEdit for now. We may revisit them later, but no design work is planned.

- **Toolpath display and simulation:** backplot and 3D toolpath view, animation, material-removal simulation, comparison against a design model, machine kinematics and collision checks, machine and tool geometry libraries, simulation setup data (stock, fixtures, tool dimensions), toolpath export to drawing formats.
- **Machine communication (DNC):** sending and receiving programs over serial lines, network or FTP transfer, and transfer monitors.
- **Program management:** program databases with machine assignment, revision servers, check-in/check-out, and ERP/PDM integration.
- **Conversational and proprietary formats:** conversational shop-floor formats and viewers for them, machine-builder-specific cycles, and machine-specific multi-channel sync code sets.
- **Legacy conveniences:** line-printer output, punched-tape length display, serial print statements for data collection, launching the OS calculator, auto-exit when idle, lock files for concurrent access, a settings password, warning sounds, and virtual space past the line end.
