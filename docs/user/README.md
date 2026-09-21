# gEdit user guide

gEdit is a desktop editor for NC code. It is meant for the program you get back from the
post-processor: read it, find your way around it, correct a few things, clean it up,
renumber it, scale the feeds, list the tools, compare it with the last version, and save
it without changing a single byte you did not ask to change.

This guide describes what the program does today. It is written for the person who runs
the machine, not for the person who builds the editor — the build and design notes are in
[../planning](../planning/README.md).

| Page | What is in it |
|---|---|
| This page | The window, files, navigation, code help, comparing, settings, and the limits |
| [dialects.md](dialects.md) | Dialect profiles: what they decide, which two ship, how the dialect is picked |
| [transformations.md](transformations.md) | The NC tab: renumbering and the five cleanups |
| [scripts.md](scripts.md) | Running Python scripts, and how to write one |
| [shortcuts.md](shortcuts.md) | The keyboard |

---

## The window

Across the top is the **ribbon**, with five tabs:

| Tab | What it holds |
|---|---|
| **Home** | New, Open, Save, Save As, Save All, Close · the recent-files list · a program header block · undo, redo, find, replace, comment, duplicate, move, delete line, upper and lower case |
| **Insert** | The ready-made blocks of the active dialect |
| **NC** | Renumbering and the cleanups — see [transformations.md](transformations.md) |
| **Tools** | Compare, and the scripts — see [scripts.md](scripts.md) |
| **View** | The command palette, the panels, folding, display switches, zoom, theme, settings, the shortcut list and About |

Below it are the **tabs**, one per open program, then the editor, and at the bottom the
**status bar**: the file on the left, and on the right the dialect, the encoding, the line
ending, the cursor position and — while one runs — the script.

Three of those status fields are buttons. Click the dialect to change it, the encoding to
change what the file is written as, the line ending to change that.

There are three panels:

- **Program Map**, on the left (`View ▸ Side Panel`) — the structure of the program.
- **Results**, at the bottom — what a transformation skipped, and the tables and findings
  a script reports. A row with a line number jumps there when you click it.
- **Output**, at the bottom (`View ▸ Script Output`) — the raw output of a script run.

If you cannot find a command, press **F1**. That opens the command palette, which lists
every command by name. **View ▸ Keyboard Shortcuts** lists them with their keys.

## Files

**Open** (`Cmd/Ctrl+O`) takes several files at once, up to 50. You can also drag files
onto the window from Finder or Explorer; folders are ignored with a message. A file that
is already open is brought forward instead of being opened twice.

gEdit reads the file as bytes and works out three things for itself:

- **The dialect**, from the extension and from the content — see [dialects.md](dialects.md).
- **The encoding**: UTF-8, UTF-8 with a byte-order mark, UTF-16 (LE or BE, with its mark),
  or Windows-1252. A file that is valid UTF-8 is read as UTF-8; anything else is read as
  Windows-1252, which never fails — that is where the umlauts in comments from older
  controls come from.
- **The line ending**: CRLF, LF or CR. A file with mixed endings is reported in the status
  bar and saved with the ending that was in the majority.

**NUL bytes** at the very start and the very end of a file are the punched-tape leader and
trailer. They are kept out of the text, counted, and written back unchanged. NULs in the
middle are removed, and the status bar says how many — save the file to write that change.
A file that is more than 10 % NUL bytes is data, not a program, and is refused. So is a
file above 50 MB.

**Saving** writes the same encoding, the same line ending and the same leader and trailer
back. A program you open and save without editing is byte-for-byte the file you started
with.

The title bar and the tab show a dot while a document has unsaved changes. Closing a tab,
closing the window, or quitting asks about them first.

### Changing encoding or line ending

The two status-bar buttons change how the file is **written**, and mark the document as
modified so the change actually reaches the disk on the next save.

They do not re-read the file. There is no "reopen with this encoding": if a file came in
as Windows-1252 and you switch it to UTF-8, the characters you see stay as they are and
are written out as UTF-8. UTF-16 always carries its byte-order mark, and it cannot carry a
tape leader — saving a file with one as UTF-16 drops the leader and says so.

### When the file changes on disk

gEdit checks the files you have open while the window has focus. If the CAM system
re-posts a program you have open:

- With no unsaved edits it is reloaded, keeping your position. (Set
  `Settings ▸ Files ▸ When a file changes outside gEdit` to **Ask what to do** if you
  would rather be asked every time.)
- With unsaved edits a bar appears above the editor with **Reload**, **Keep mine** and
  **Compare**.
- If the file is deleted, the tab is marked and your text stays. Saving writes it back.

### Recent files

The Home tab has the recent-files list, and `File ▸ Open Recent…` opens the same list as a
picker. Entries that no longer exist are marked; opening one offers to drop it from the
list. The length is a setting (0 to 50, default 15).

## Finding your way around a program

| What you want | How |
|---|---|
| A line, or a block number | `Ctrl+G`, then `120` for the line or `N120` for the block |
| The next or previous tool change | `F7` / `Shift+F7`, wrapping around with a message |
| The structure of the program | The Program Map panel |
| A place you keep coming back to | A bookmark: `Cmd/Ctrl+F2` to set or clear it, `F2` and `Shift+F2` to step through them |
| Text | `Cmd/Ctrl+F`, the editor's own find and replace |
| A section, collapsed | `View ▸ Fold All` / `Unfold All`, and the sticky heading at the top of the editor |

**Ctrl+G** is the Control key on every platform, not Cmd — that is the key the controls
themselves use, and Cmd+G stays with "find next" on a Mac.

The **Program Map** lists what the dialect's profile says is worth listing: the program
start, tool calls, section headings, comments, labels, program stops, subprogram calls and
the program end. Click an entry to jump to it. It follows the program as you type.

Bookmarks live for as long as the document is open; they are not saved with the file.

## Code help

Hold the pointer over a word and gEdit explains it: what the code does, which group it
belongs to, whether it stays active until something replaces it, and which addresses it
needs. Where the feed carries a thread pitch rather than a feed rate, the hover says so —
that is exactly the place where scaling a feed would cut a different thread.

Typing offers completions from the same database: the codes of the active dialect with
their descriptions. Both are switched in `Settings ▸ Assistance`, and completion can be
set to appear automatically, only when you ask for it, or not at all.

The descriptions are written by the project, in its own words, for the subset of code that
CAM systems emit. A code the database does not describe says so rather than guessing. An
entry the project has written but not yet checked against a control's documentation is
**not shown in the hover at all** — the hover says the database does not describe the word,
which is the honest answer while nobody has confirmed it; the completion list shows it with
a "Not verified yet" note instead. **Your control's manual is the authority, not this
editor.**

## Comparing two programs

`Cmd/Ctrl+Alt+C` compares the current document with the version on disk, another open tab,
or any file you pick. The comparison opens over the editor, side by side or inline, with
buttons for the next and previous difference.

The current document stays editable in the comparison; the other side is read-only. Files
above 50 MB are refused.

## Settings

`Cmd/Ctrl+,` opens the settings dialog. Five pages:

| Page | What you can set |
|---|---|
| **Appearance** | Theme (System, Light or Dark), editor font and size |
| **Editor** | Tab width, spaces or tabs, whitespace display, word wrap, minimap, line numbers, current-line highlight, sticky scroll, text drag and drop, copy without a selection |
| **Assistance** | Hover help on or off; completion automatic, manual or off |
| **Files** | Length of the recent list, what happens when a file changes outside gEdit, the dialect new files start in |
| **Scripts** | The Python interpreter, extra script folders, the time limit for a run, whether the bundled scripts are listed — and the path of your own scripts folder |

Settings are stored as a small JSON file that holds only what you changed, so a default
that improves in a later version reaches you. `Open settings file` in the dialog opens it
as a document, for the few keys that are not in the dialog (column rulers, for example).

On macOS the file is `~/Library/Application Support/com.pburg.gedit/settings.json`, with
the equivalent folder on Windows and Linux. Your own scripts live next to it, in
`scripts/`.

## What gEdit does not do

Being clear about this saves disappointment on the shop floor.

- **No backplot, no 3D display, no simulation.** gEdit reads and writes text. It does not
  know where the tool is.
- **No machine communication.** No DNC, no serial, no FTP, no drip feed.
- **No program management.** No library, no job list, no PDM or ERP link.
- **One mill dialect and one Klartext dialect.** A lathe program opens and edits fine, but
  it is read with a mill profile — see [dialects.md](dialects.md).
- **Python is needed only for the script features.** Everything on this page, and
  everything in [transformations.md](transformations.md), works without it. If Python is
  missing, the script commands are disabled with a message and nothing else changes.
- **Scripts are not sandboxed.** A script is an ordinary program running with your rights.
  See the security section of [scripts.md](scripts.md).
- **Quitting from the Dock icon's menu, logging out or shutting down skips the
  unsaved-changes prompt.** Quit from the application menu or with `Cmd+Q` and you are
  asked; quit from the Dock and the app is terminated with the changes still unsaved. Save
  before you log out.
- **Nothing is restored between sessions** except the window size and position, the panel
  layout, the recent files and your settings. Open tabs, bookmarks and cursor positions
  are not remembered.
- **Saves are written in place**, not written to a temporary file and moved. A crash or a
  power cut in the middle of a save can leave a partial file. There is no backup copy.
- **English only.** Every text in the program is English.

## Where things are

| | |
|---|---|
| Settings | `<config>/settings.json` |
| Your own scripts | `<config>/scripts/` |
| Recent files, panel sizes, remembered form values | `<data>/state.json` |
| Window size and position | `<config>/.window-state.json` |

`<config>` and `<data>` are the standard application folders of your operating system; on
macOS both are `~/Library/Application Support/com.pburg.gedit`. The settings dialog shows
the script folder, and `About gEdit` shows the version and the third-party notices.
