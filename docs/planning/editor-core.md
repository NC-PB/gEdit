# Editor core

Core editing, file handling and navigation. NC-specific text transformations are in [nc-transformations.md](nc-transformations.md), and preferences are in [settings-ui.md](settings-ui.md).

Tag format: `Priority · Size · Delivery` (see [README](README.md#conventions-used-in-these-documents)).

> **Status.** Design note from 2026-09-21. What shipped is described in the [user guide](../user/README.md); where this note and the guide differ, the guide is right. The [roadmap](roadmap.md) gives the status of every item (its rows link to the sections below), and a *Status* line under a heading below says where this note was brought up to date. In short: Phases 1 and 2 shipped everything tagged P1 and P2 except the items the roadmap lists as deferred (bookmark names and panel, block range, insert and append file, OS file associations, next and previous NC event) or cut (a global viewer mode, an in-app user guide); the P3 items (split view, printing, find files in folders, auto-space, automatic block number) are Phase 4 and not built.

## What Monaco gives us

Monaco already provides many standard editor functions. Our work is to expose them (ribbon, command palette, shortcuts, settings) and to check they behave well with NC code.

| Function | Monaco | What we still do |
|---|---|---|
| Clipboard, select all, column (box) selection, multi-cursor | Built in | Test with the Tauri clipboard on all three platforms |
| Unlimited undo/redo | Built in | Apply all transforms and script results with `executeEdits`/`pushEditOperations`, never `setValue`, so each one is one undo step |
| Find/replace with case, whole word, regex, `$1` groups, preserve case, in-selection, wrap-around, multi-line | Built in (find widget) | The replace count and the NC-aware options, built in M11 (see [Search](#search)) |
| Go to line | Built in | Add block-number mode ([Go to line or block number](#go-to-line-or-block-number)) |
| Command palette (F1) | Built in | Register every gEdit command as a Monaco action with its shortcut |
| Quick outline / go to symbol | Built in, needs a `DocumentSymbolProvider` | Feed it from the program map: tool calls, operations, sections |
| Folding | Built in, needs a `FoldingRangeProvider` | Fold by tool change or operation |
| Sticky scroll | Built in, uses symbols/folding | Shows the current tool call at the top while scrolling |
| Case transforms, move/duplicate/delete line, comment toggle | Built in actions | Comment toggle needs the profile's comment syntax |
| Whitespace rendering, rulers, word wrap, current-line highlight, minimap | Editor options | Expose in settings |
| Hover, completion, code actions, markers (squiggles) | Provider APIs | Used by [code-assistant.md](code-assistant.md) |
| Side-by-side diff with navigation | `createDiffEditor` | Used by [file-compare.md](file-compare.md) |
| Large-file mode | Built in (turns off some features for very large models) | Keep our own parsers fast (see [Performance](#performance)) |

Not provided: tabs and multi-document state, bookmarks, block-number navigation, NC-aware search, a find-all result list, printing, file encoding and line-ending handling.

## Documents and tabs

### Multiple documents in tabs
`P1 · M · Core`

**Status:** shipped in Phase 1. The quick switcher is *Switch tab…* (`Cmd/Ctrl+Alt+O`).

Several files open at the same time, one tab each. The tab shows the file name, a modified marker and the full path as a tooltip. Tabs can be reordered by dragging and closed with a middle-click. Each document keeps its own Monaco model, view state (cursor, scroll, folding), dialect, undo stack and bookmarks. Switching tabs swaps the model in the single editor instance. A quick switcher (keyboard) lists open documents.

This is the base of save all, close all, search in open documents, bookmark lists and compare. The document state lives in a document store (`path`, `model`, `dialect`, `encoding`, `lineEnding`, `readOnly`, `bookmarks`, `viewState`), not in the page component.

### New untitled document
`P1 · S · Core`

**Status:** shipped in Phase 1.

Creates an empty buffer named `Untitled-1`, `Untitled-2` and so on. It uses the default dialect from settings, or the dialect of the active document. Saving an untitled buffer goes to Save As.

### Close, close all, save all
`P1 · S · Core`

**Status:** shipped in Phase 1.

Closing a modified document asks Save / Don't Save / Cancel. Close all and app quit show one dialog that lists all modified documents with Save all / Discard all / Cancel. Save all saves every modified document; untitled ones prompt for a name one after another.

### Split view
`P3 · M · Core`

**Status:** not built (Phase 4).

Two editor groups side by side or stacked. The same document can be shown in both, sharing one model, for example to view the header while editing further down. Overlapping child windows are not needed.

## File handling

### Open files
`P1 · S · Core`

**Status:** shipped in Phase 1.

Open one or more files from the dialog (multi-select) or by dropping them on the window. If a file is already open, focus its tab. The dialect is chosen by the profile's detection rules ([dialect-profiles.md](dialect-profiles.md#detection)). The open dialog always offers an "All files" filter, because post-processors use many extensions (`.nc`, `.tap`, `.eia`, `.min`, `.h`, numbers only, none).

### Recent files
`P1 · S · Core`

**Status:** shipped in Phase 1.

Most-recently-used list in the ribbon and the native menu. Length is configurable (default 15). Entries whose file no longer exists are marked, and the list can be cleared. Stored in the state file ([settings-ui.md](settings-ui.md#storage-layout)).

### OS file associations
`P2 · S · Core`

**Status:** not built (deferred to Phase 4).

The installer registers gEdit for the built-in profile extensions (Tauri bundle `fileAssociations`), so a double-click in the file browser opens the file in gEdit. The app handles "open file" events: macOS sends them to the running app, and Windows and Linux pass the file path as a command-line argument. Changing associations at runtime from the profiles is not planned.

### Encoding and line endings
`P1 · M · Core`

**Status:** shipped in Phase 1; the NUL rules above are those of the user guide.

Read the file as bytes in Rust instead of using `readTextFile`:

- Detect a BOM (UTF-8, UTF-16). Without a BOM, use UTF-8 if the bytes are valid UTF-8, otherwise Latin-1 (Windows-1252).
- Detect the line ending (CRLF, LF, CR, mixed).
- Remember both per document and write back the same on save. Show them in the status bar. A click on either lets the user convert.
- NUL bytes: those at the very start and end of the file are the tape leader and trailer; they are kept out of the text and written back unchanged. NULs inside the program are removed on load (profile option `onLoad.stripNul`), and the status bar reports how many. A file in which more than 10 % of the bytes between leader and trailer are NUL is data, not a program: it opens read-only, as it is ([read-only files](#read-only-files)). Details: [Files](../user/README.md#files) in the user guide.
- Characters the control cannot handle (non-ASCII in comments, for example umlauts) are not changed silently. A check script reports them ([nc-transformations.md](nc-transformations.md#character-cleanup)).

New files use the encoding and line ending from the profile, with ASCII and CRLF as the default.

### Insert file and append file
`P2 · S · Core`

**Status:** not built (deferred to Phase 4).

Insert the content of another file at the cursor, or at the end of the document. Line endings are normalized to the document's, and the insert is one undo step. When appending after a program-end marker (`M30`, `%`, `END PGM`), warn because the appended code would never run. For Heidenhain, offer to renumber afterwards.

### External change detection
`P1 · M · Core`

**Status:** shipped in Phase 1.

Watch open files on disk (Tauri fs watch). When another program changes a file, for example because the CAM system re-posted it:

- No local edits: reload automatically, or ask first (setting). Keep the cursor line.
- Local edits: ask Keep mine / Reload / Compare. Compare opens the diff view between the buffer and the disk version.
- File deleted: mark the tab and keep the buffer.

### Read-only files
`P2 · S · Core`

**Status:** shipped in M7 (Phase 2), without the viewer mode.

Files with the read-only attribute open locked, and a lock icon is shown in the tab and status bar. Save As still works. An explicit unlock command is available (*Lock Against Editing* locks a tab by hand). A global viewer mode (all files read-only) was planned here and was cut by the owner on 2026-10-08 (roadmap, [Not planned](roadmap.md#not-planned)).

A file that is data rather than a program (more than 10 % NUL bytes between the tape leader and trailer) opens read-only, as it is, so a wrong decoding cannot be saved over the original; it cannot be unlocked. A rule on long lines was not built. Details: [Read-only programs](../user/README.md#read-only-programs) in the user guide.

### Backup on save and crash recovery
`P2 · S · Core`

**Status:** shipped in M7 (Phase 2), with more than is described here: see [Never losing work](../user/README.md#never-losing-work).

- Backup: before overwriting, copy the previous file to `name.ext.bak` (setting: off / one backup / N timestamped copies in a backup folder).
- Recovery: modified buffers are written to a recovery folder every 30 s (never over the original). After a crash, gEdit offers to restore them on the next start.

### Printing
`P3 · M · Core`

**Status:** not built (Phase 4).

Print the document or the selection. Render a print-only HTML view with syntax colors (or monochrome), optional line numbers, and a header with file name, date and page number. Use the webview's print dialog, which also saves PDF on most platforms. Margins and font size are set in the print dialog. Multi-column layouts and raw line-printer output are not planned.

### Find files in folders
`P3 · M · Core`

**Status:** not built (Phase 4).

Search a folder tree for NC files by name pattern, contained text or regex, and modified-date range. The search runs in Rust, streams results and can be cancelled. The result list shows path, date and the first matching line, and a double-click opens the file. Typical use: "which program uses T17" or "what was posted yesterday". The result list reuses the [find results panel](#find-all-results-panel).

## Navigation

### Go to line or block number
`P1 · S · Core`

**Status:** shipped in Phase 1 (`Ctrl+G`).

Extends Monaco's go-to-line. Input `120` goes to line 120, and `N120` goes to the block with that number (using the profile's block-number prefix, or the leading integer for Heidenhain). With duplicate block numbers, go to the next occurrence after the cursor. If the number is not found, show a message and do not move.

### Next and previous tool change
`P1 · S · Core`

**Status:** shipped in Phase 1 (`F7`, `Shift+F7`).

Jump to the next or previous tool call with shortcuts, wrapping at the file end. It uses the profile's tool-call rule (`T.. M6` vs. `TOOL CALL`) and shares the parser with the program map.

### Next and previous NC event
`P2 · M · Core`

**Status:** not built (deferred to Phase 4, if asked for).

A generalization of tool-change navigation. Jump to the next feed change, spindle-speed change, program stop (`M0`/`M1`), work-offset change or subprogram call. An optional condition filters the matches, for example spindle speed above 12000 or `F0`. It works on parsed words, not plain text, so `S12000` and `S 12000.` both match.

### Program map
`P1 · S · Core` (exists; extend)

**Status:** shipped in Phase 1, extended per channel in M12.

The existing panel lists tool calls and comments. Changes:

- Rules come from the profile's `outline` section ([dialect-profiles.md](dialect-profiles.md#outline-program-map)); the hardcoded regexes are gone.
- Add kinds: program start/end, section headings (Klartext `* - ...`), subprogram labels, stops.
- Tool entries show the tool number and the nearest descriptive comment.
- Highlight the entry that contains the cursor.
- The same data feeds quick outline, folding ranges and sticky scroll.

### Bookmarks
`P1 · M · Core` (toggle, next/previous) · `P2 · S · Core` (names, list panel, bookmark all matches, persistence)

**Status:** toggle, next and previous shipped in Phase 1; persistence per file in M7; names, the bookmark panel and *bookmark all matches* are deferred to Phase 4.

- Toggle a bookmark on the current line (shortcut). An optional variant asks for a name.
- Bookmarks are Monaco decorations with a gutter icon, so they move with edits.
- Next/previous bookmark wraps at the file end.
- Bookmark panel (P2): all bookmarks of all open documents with file, line, name and line text. Click to jump, delete one, or clear all.
- Bookmark all matches (P2): puts a bookmark on every line that matches the current search, for example every `M1`.
- Persistence (P2): stored per file path in the state file. Untitled documents keep them only for the session.

## Search

Monaco's find widget covers the basics (see the table above). The following features are NC-specific, except the first, which is a gap in what Monaco exposes rather than an NC feature.

### The replace count
`P2 · S · Core`

**Status:** built in M11: Replace All is a transformation like the NC ones (one undo step), puts the count in the status bar, and can write into a new tab.

After a replace-all the editor says nothing about how many blocks it changed, so a programmer who replaced every `M8` with `M88` across a program cannot check the number against the tool count. Monaco's find widget has no public event for a completed replace-all: the action is not a standalone editor action, and an `onDidChangeModelContent` heuristic cannot tell one replacement from ordinary typing. Doing it properly means either reaching into the `editor.contrib.findController` contribution (not in the public typings) or gEdit running the replace itself through `executeEdits`, which is the same path the transforms already take and would also give ["Replace into a new document"](#replace-into-a-new-document) for free. Phase 1 exposes the widget and leaves both to Phase 2 (plan §10 item 23).

### NC-aware whole-address match
`P2 · S · Core`

**Status:** built in M11 as *Find Whole Address…* ([Searching](../user/README.md#searching)).

Packed code like `G1X10Y5` has no word separators, so Monaco's whole-word option fails. A "whole address" toggle matches an address word by value: `G1` finds `G1`, `G01` and `G1.` but not `G10` or `G100`, and `T5` does not find `T50`. It is implemented as a generated regex, for example `(?<![A-Z])G0*1(?![\d.])`, handed to the find widget or used by the results panel. It is case-insensitive by default.

### Find-all results panel
`P2 · M · Core`

**Status:** built in M11 (*Find All…*, `Cmd/Ctrl+Shift+F`); the Results panel is shared with transforms and scripts.

Lists all matches in the bottom panel: document, line number, line text with the match highlighted. Click to jump. It shows the match count and stays until the next search. The panel is a generic "located results" list. File search, check scripts and script reports use the same component ([scripting.md](scripting.md#output-modes)).

### Search in all open documents
`P2 · S · Core`

**Status:** built in M11 (a scope of Find All and Replace All).

A scope option for the find-all panel: active document or all open documents. It is useful for a main program and its subprograms.

### Replace into a new document
`P2 · S · Core`

**Status:** built in M11.

A replace-all can write its result to a new untitled tab and leave the original unchanged. This is the same "output target" option that all transforms have ([nc-transformations.md](nc-transformations.md#transform-framework)).

### Regular expression help
`P2 · S · Core`

**Status:** built in M11 as a page of the user guide, [Regular expressions](../user/regex.md).

The editor uses ECMAScript regular expressions (Monaco), and scripts use Python `re`. A short cheat sheet in the bundled help shows NC-oriented examples: a feed word `F\d+(\.\d*)?`, the value after an address with lookbehind `(?<=S)\d+`, a whole-line comment `^\s*\(.*\)\s*$`. It also lists the main differences between JS and Python regex.

## Selection and range operations

### Select or delete a block range
`P2 · S · Core`

**Status:** not built (deferred to Phase 4).

A dialog with from/to values, given as line numbers or block numbers, and an action (select or delete). The range is inclusive. If a block number does not exist, report it instead of guessing. The selection can then be copied, deleted, or passed to a script.

### Select or extract a tool segment
`P2 · S · Core` (select) · `P2 · S · Script` (extract/delete)

**Status:** selecting is built (M10, `Cmd/Ctrl+F7`); extracting and deleting a segment is deferred (split by tool, backlog).

Select the lines from one tool call up to the next one, either the segment at the cursor or the segment for a given tool number. Extracting a segment to a new document, or deleting it, is a bundled script so the rules for header and trailer lines stay adjustable ([nc-transformations.md](nc-transformations.md#split-program-by-tool)).

## Typing behavior for NC code

Per-profile options (see [dialect-profiles.md](dialect-profiles.md#editing)).

### Forced uppercase
`P2 · S · Core`

**Status:** shipped in M13 for every control.

Letters typed outside comments are entered in uppercase. Comments keep their case (Klartext comments often contain lowercase text).

### Prevent joining blocks
`P2 · S · Core`

**Status:** shipped in M13.

Backspace at the start of a line, and Delete at the end of a line, do not merge two blocks. An accidental merge changes machine behavior. Selecting the line break and deleting it still works.

### Auto-space while typing
`P3 · M · Core`

**Status:** not built (Phase 4).

When a letter that starts a new address word is typed directly after a number, a space is inserted first (`G1X` becomes `G1 X`). It is not active inside comments, strings, variable expressions or multi-letter keywords.

### Automatic block number on Enter
`P3 · M · Core`

**Status:** not built (Phase 4).

A new line gets the previous block number plus the profile's increment. A line inserted between two numbered lines gets a number between them. If there is no gap left, the line stays unnumbered and the status bar suggests renumbering. For Heidenhain, the following lines are renumbered automatically, because the numbering must stay consecutive.

## Help and about

### About and licenses
`P1 · S · Core`

**Status:** shipped in Phase 1.

Version, project license, third-party license notices (Monaco, Tauri, Svelte, lucide and others), and links to the repository and issue tracker. Update checks are optional and off by default, because shop-floor PCs are often offline.

### Bundled user guide
`P2 · S · Core`

**Status:** cut (see above); the regex help was built as a guide page.

Offline help (Markdown rendered in a panel) with the regex cheat sheet, the script contract and the profile reference. The settings dialog shows each field's help text from the settings schema ([settings-ui.md](settings-ui.md#settings-dialog)). Cut in Phase 2: the guide is the Markdown in `docs/user`, not a copy inside the program.

## Performance

CAM output can have hundreds of thousands of lines. Targets:

- Open a 10 MB / 300k-line file in under 2 s. Typing stays responsive.
- Program map, bookmarks and navigation parse incrementally or in a web worker, with debouncing (as the current 300 ms tree refresh does).
- Every transform finishes in about 1 s on 100k lines and stays undoable. There is never a "cannot undo, file too large" case.
- Highlighting may turn off above a size threshold (Monaco large-file mode). Navigation and transforms keep working.
