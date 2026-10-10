# gEdit user guide

gEdit is a desktop editor for NC code. It is meant for the program you get back from the
post-processor: read it, find your way around it, correct a few things, clean it up,
renumber it, scale the feeds, list the tools, check it before it goes to the machine,
compare it with the last version, and save it without changing a single byte you did not
ask to change.

This guide describes what the program does today. It is written for the person who runs
the machine, not for the person who builds the editor — the build and design notes are in
[the planning notes](../planning/README.md).

| Page | What is in it |
|---|---|
| This page | The window, files, never losing work, navigation, searching, code help, comparing, settings, and the limits |
| [Dialects](dialects.md) | Dialect profiles: what they decide, which six ship, how the dialect is picked |
| [Machines](machines.md) | Machine configurations: what `X50` is worth on **your** control, how to tell gEdit, and how to move your machines to another computer |
| [Your own profiles and code files](profiles.md) | Profiles for one shop, machine or folder, and your own G and M codes in the help; the Profiles page; when a profile of yours is used |
| [Understanding a block](inspector.md) | The code inspector (what each word means on your machine and what is in force at the cursor, and changing a value from it), the hover with a cycle's parameters, and the motion colours |
| [Writing with templates](templates.md) | The Insert tab: program starts, tool changes and cycles from a form, templates in completion, Edit Cycle, formulas, favourites, the template manager, New Template from Selection, and where your templates are kept |
| [Transformations](transformations.md) | The NC tab: renumbering, removing block numbers, the five cleanups, block skip and selecting a tool's lines |
| [Channels](channels.md) | Twin-turret and multi-path programs: finding the channels, the wait codes, and checking that the waits fit |
| [Scripts](scripts.md) | Running Python scripts, the six that ship (feeds, speeds, tool list, program checks, extents, address arithmetic), and how to write one |
| [Regular expressions](regex.md) | Patterns for the editor's find and for Python scripts, with NC examples, and where the two differ |
| [Shortcuts](shortcuts.md) | The keyboard |

---

## The window

![The gEdit window: ribbon, tabs, program map, editor and status bar](../screenshots/main-window.png)

*The ribbon, two open programs in the tab bar, the Program Map on the left
and the status bar along the bottom. The theme here is the dark one.*

Across the top is the **ribbon**, with seven tabs:

| Tab | What it holds |
|---|---|
| **File** | New, Open, Save, Save As, Save All, Close, **Reload** (read the file again from disk, [below](#reload-from-disk)) · the recent-files list |
| **Edit** | Undo, redo, find, replace, comment, duplicate, move, delete line, select all, upper and lower case (plain text commands; on a program use **Convert Case…** on the NC tab) · **Find All…**, **Replace All…**, **Find Whole Address…** ([Searching](#searching)) · **Go to Line or Block…** (group *Go To*) · **Typing**: **Upper-Case Typing** switches [upper case while you type](#typing-forced-upper-case-and-no-accidental-joins) off or on for this session |
| **Insert** | The **templates** of the active program — **Program start** (the first lines of a program, in the dialect's own style) and end, tool change, drilling, tapping, turning and threading cycles, for all six dialects — as buttons and lists, **Favorites** first; **Edit Cycle…** for the cycle at the cursor; **Manage Templates…** and **New Template from Selection…** for your own. See [Writing with templates](templates.md) |
| **NC** | Renumbering, removing block numbers, the cleanups, block skip and selecting a tool segment — see [Transformations](transformations.md) |
| **Tools** | Compare ([Comparing two programs](#comparing-two-programs)) · the scripts that come with gEdit, in the **Built-in Scripts** group — **Program checks**, **Scale feed rates**, **Scale spindle speeds**, **Tool list**, **Extents**, **Address arithmetic** (see [Scripts](scripts.md)) · **Check Wait Codes** for [channels](channels.md#check-wait-codes) · **Test Profile on Document** for [profiles of your own](profiles.md#testing-a-profile-on-a-program) |
| **Scripts** | Run a script, stop it, your own scripts (**My Scripts**), **New Script**, **Edit Script**, **Rescan**, **Add Folder** — see [Scripts](scripts.md) |
| **View** | The command palette, the panels (Program Map, Code Inspector, Results, Script Output), the motion-colour switch, folding, display switches, zoom, theme, settings, the shortcut list and About |

The ribbon starts at the top of the window. The program's name is in the window's own title bar
(with a dot in front of it while the program has unsaved changes); there is no second title row
inside the window. When the window is too narrow for a tab, the ribbon scrolls sideways, and its
scrollbar sits below the group names instead of over them.

Below it are the **tabs**, one per open program, then the editor, and at the bottom the
**status bar**: the file on the left, and on the right the dialect, the machine, the
encoding, the line ending, the cursor position, the script while one runs, and
**Read-only** while the document is locked.

Every field but the file name and the cursor position is a button. Click the dialect to
change it, the machine to say which control this program is for ([Machines](machines.md)),
the encoding to change what the file is written as, the line ending to change that; click
the script to stop the run, and **Read-only** to unlock the document. The machine field is
not shown for a dialect that has no machine settings.

A dialect with a question mark (`Fanuc T?`) is a guess: the program fits none of the dialects
well. Click it to keep the guess or to choose the control — see [When gEdit is not
sure](dialects.md#when-gedit-is-not-sure).

There are four panels:

- **Program Map**, on the left (`View ▸ Side Panel`) — the structure of the program.
- **Inspector**, on the left beside the Program Map, closed until you open it (`View ▸ Panels ▸ Code Inspector`, `Cmd/Ctrl+Alt+A`) — what each word of the block at the cursor means on your machine, and what is in force after it; see [Understanding a block](inspector.md).
- **Results**, at the bottom — what a transformation skipped, and the tables and findings
  a script reports. A row with a line number jumps there when you click it.
- **Script Output**, at the bottom (`View ▸ Script Output`) — the raw output of a script
  run.

If you cannot find a command, press **F1**. That opens the command palette, which lists
every command by name. **View ▸ Keyboard Shortcuts** lists every command with the key gEdit
gives it; the editing keys that come with the editor (undo, find, comment, …) are in
[Shortcuts](shortcuts.md).

In this guide `View ▸ Side Panel` means the **Side Panel** button on the ribbon's View tab,
`Settings ▸ Files ▸ …` a field on a page of the settings dialog, and *File: Open Recent…* an
entry of the command palette. The macOS menu bar holds only the standard system items.

## Files

**Open** (`Cmd/Ctrl+O`) takes several files at once, up to 50; pick or drop more and only
the first 50 open, with a message. You can also drag files onto the window from Finder or
Explorer; folders are ignored with a message.

A file that is already open is brought forward instead of being opened twice, and the status
bar says *<name> is already open*. gEdit asks the file system for the file's real path, so
one tab holds one file however you reach it: in other capitals on Windows and macOS, through
a symbolic link, with a `..` in the path, and on Windows with `/` for `\` or with `\\?\` in
front, through a mapped drive or its `\\server\share` name, or through a short `PROGRA~1`
name. (The Windows cases have not been tried on a real Windows machine yet.) If the file
system gives no real path — a share that does not answer, say — gEdit falls back to comparing
the spelling, and two different routes to one file can then give two tabs: do not edit the
program in both. Save As onto a file that another tab has open, under whatever spelling, is
refused with *Another tab already holds <name>. Close it first or pick a different file.*;
the tab's own file under another spelling is fine.

gEdit reads the file as bytes and works out three things for itself:

- **The dialect**, from the extension and from the content — see [Dialects](dialects.md).
- **The encoding**: UTF-8, UTF-8 with a byte-order mark, UTF-16 (LE or BE, with its mark),
  or Windows-1252. A file that is valid UTF-8 is read as UTF-8; anything else is read as
  Windows-1252, which never fails — that is where the umlauts in comments from older
  controls come from. UTF-16 without its byte-order mark is not recognised: about half of
  its bytes are NUL, so it is refused as data.
- **The line ending**: CRLF, LF or CR. A file with mixed endings is reported in the status
  bar and saved with the ending that was in the majority; on a tie CRLF wins, and LF wins
  over CR.

**NUL bytes** at the very start and the very end of a file are the punched-tape leader and
trailer. They are kept out of the text, counted, and written back unchanged. NULs in the
middle are removed, and the status bar says how many — save the file to write that change.
A file whose NUL bytes *inside* the program — between the leader and the trailer — are more
than 10 % of those bytes is data, not a program. It opens **read-only**, exactly as it is, and the status bar says why. Transforms and scripts do not run on it, it cannot be unlocked, and Save As cannot write over the same file; choose another name to save a copy. A file above 50 MB is refused. So is a file whose size the file system will not tell — on a
share or a stick that does not answer — with *The file system did not answer for <name>, so
gEdit cannot tell how large it is. Try again.*, rather than reading it blind.

**Save As** to a file you may not write goes back to the dialog before anything is copied or
written. Saved under another extension, a file that had a name has its dialect detected
again (see [Dialects](dialects.md#which-dialect-a-file-gets)).

**Saving** writes the same encoding, the same line ending and the same leader and trailer
back. A program you open and save without editing is byte-for-byte the file you started
with. Before it writes, gEdit copies the version that is on disk aside — see
[Never losing work](#never-losing-work).

There is one rare exception to "byte-for-byte". A file whose lines end in CRLF but which holds a
single stray CR — a carriage return with no line feed behind it — in the middle of a line is read
as having mixed line endings: the stray CR counts as a line break, and it is written back as CRLF
like the others, so that one spot gains a line feed. The status bar shows *CRLF (mixed)* and says
when you open the file that it *has mixed line endings and will be saved with CRLF*. If you need
the CR exactly as it is, do not save that file from gEdit.

If the text holds a character the file's encoding cannot store — Windows-1252 has no `⌀`,
for example — the save stops and asks whether to write the file as UTF-8 instead
(**Save as UTF-8** or **Cancel**), naming the character and where it is.

A file that was plain ASCII and gets a character outside it (a typed `Ø` or `°`) asks once, at the first save that would write it: **Save as UTF-8**, **Save as Windows-1252** or **Cancel**. Cancel writes nothing, so you can take the character out first. gEdit remembers your answer for that document and does not ask again. A file you open and save unchanged is never asked.

The title bar and the tab show a dot while a document has unsaved changes. Closing a tab,
closing the window, or quitting asks about them first.

### Changing encoding or line ending

The two status-bar buttons change how the file is **written**, and mark the document as
modified so the change actually reaches the disk on the next save.

They do not re-read the file. There is no "reopen with this encoding": if a file came in
as Windows-1252 and you switch it to UTF-8, the characters you see stay as they are and
are written out as UTF-8. UTF-16 always carries its byte-order mark, and it cannot carry a
tape leader or trailer. Picking UTF-16 for a file that has one asks first — **Drop the
leader** or **Cancel**; the save then writes the program without its tape framing and says
so, and switching back after that save does not bring it back.

### When the file changes on disk

gEdit checks the files you have open every two seconds while its window has focus, and at
once when you come back to it; a file that was only touched, with the same bytes, does not
count. If the CAM system re-posts a program you have open:

- With no unsaved edits it is reloaded, with the cursor kept on its line. The reload is one
  undo step, so `Cmd/Ctrl+Z` brings your previous text back. (Set
  `Settings ▸ Files ▸ When a file changes outside gEdit` to **Ask what to do** if you
  would rather be asked every time.)
- With unsaved edits a bar appears above the editor with **Reload**, **Keep mine** and
  **Compare**.
- If the file is deleted, the bar says so (with **Keep mine**), the tab shows ⚠ and counts
  as modified, and your text stays. Saving writes it back.

Saving over a file that changed on disk since you opened or last saved it always asks
first: **Overwrite** or **Cancel**. gEdit judges that from the file's size and time. Some file
systems (FAT32 and exFAT on a USB stick, some shares) date a file only to the nearest two
seconds, or by another clock, so a program rewritten with the same size inside that time
would look untouched. When size and time agree, gEdit therefore also compares the content
before it saves, and asks if the bytes differ. The check every two seconds does the same for
a file that was changed only a moment before gEdit last looked at it.

### Reload from disk

**Reload** (File tab, or *File: Reload* in the command palette) reads the open file again from
disk. With unsaved changes it asks first — *Reload <name> from disk? The changes you made since
the last save are replaced. Undo brings them back.* — because the reload is one undo step:
`Cmd/Ctrl+Z` brings your text back. A document that was never saved to a file has nothing to
reload and says so. A file whose size the file system will not tell is not read; the box *Could
not reload <name>* gives the reason and your text is not touched.

### Recent files

The File tab has the recent-files list (the **Recent…** drop-down), and **Open Recent…** in
the command palette (**F1**; listed as *File: Open Recent…*) opens the same list as a
picker. Entries that no longer exist are marked; opening one offers to drop it from the
list. The drop-down's last entry, **Clear recent files**, empties the list. Its length is
`Settings ▸ Files ▸ Recent files to remember` (0 to 50, default 15). With 0 gEdit stops
recording and hides the list, but it keeps the list it had: the list comes back when you set a
number again. If the list cannot be written to disk, the status bar says *The list of recent
files could not be saved.*
Saving a file moves it to the top, and so does reopening the last session — see
[Coming back where you left off](#coming-back-where-you-left-off).

## Never losing work

Four different things, covering four different accidents. It is worth knowing which one
covers what:

| What happened | What covers it |
|---|---|
| You saved over a good program | The **backup copy**, made just before the save |
| The power went, or the computer crashed | The **recovery snapshot**, taken every half minute |
| You closed gEdit and want your tabs back | **Session restore** |
| You typed into a program you did not mean to touch | **Read-only** |

The backup copy, crash recovery and session restore are set on the `Settings ▸ Files`
page, together with the per-file memory, and all four are on out of the box: the backup
copy is a choice of three (in gEdit, next to the file, or none) with the number of
versions to keep, and the other three are switches. Read-only comes from the file itself
or from a command. None of them replaces your own backups — read
[What none of this protects](#what-none-of-this-protects) before you rely on any of it.

### Before a save: the backup copy

Every time gEdit is about to write over a file that already exists, it first copies **what
is on disk** aside. That copy is the *previous version of the program* — not your unsaved
text, which is what the recovery snapshot is for.

`Settings ▸ Files ▸ Keep a copy before saving`:

| Setting | Where the copy goes |
|---|---|
| **In gEdit (keeps several versions)** — the default | Inside gEdit's own data folder, several versions deep |
| **Next to the file (.bak)** | `<your program>.bak`, in the same folder, overwritten on every save |
| **Do not keep one** | Nothing is copied |

The default keeps the copies out of your program folder on purpose. A DNC folder watcher
or a CAM output folder that picks up whatever appears in it would otherwise find
`WELLE.NC.bak` and post it to a machine. Use the `.bak` setting only where the folder is
yours alone. On macOS and Linux the `.bak` copy is given the same permissions as the
program it was made from, so a program only you can read does not get a copy beside it
that everyone can.

**How many, and how much.** `Settings ▸ Files ▸ Versions to keep` (1 to 50, default 5) is how
many earlier versions gEdit keeps **per file**: save the same program six times and the oldest
of the six goes. The `.bak` setting keeps exactly one, so the second save overwrites the copy
the first made. Two more settings on the same page bound the folder as a whole. Both apply
only to copies kept in gEdit, not to `.bak` files:

| Setting | Default | What it does |
|---|---|---|
| **Most space for earlier versions (MB)** | 500; 0 means no limit | When the earlier versions of all files together take more than this, the oldest ones are deleted first. The newest version of every file is always kept, so the folder can stay over the limit |
| **Delete earlier versions of deleted files after (days)** | 90; 0 means keep for ever | Earlier versions of a file that was deleted (or whose folder was renamed or moved) on this computer's own disk are deleted this many days after the last one was made |

**What never expires.** Earlier versions of a file on a USB stick, a network share or another
disk are never deleted because the file seems to be missing: a stick that is not plugged in
looks just like a deleted file, and so does a second stick with the same name. Only the oldest
copies beyond the space limit go, and the newest copy of every file is always kept. Copies
made before these settings existed are treated the same way until the file is saved from
gEdit once more. gEdit looks for copies to delete at most every 10 minutes, after a backup
was made, and not at all while `settings.json` cannot be read — so a typing mistake in that
file never turns a limit you had switched off back on.

**Where they are.** Under `<data>/backups`: a folder per program folder, a folder per file
name, one file per version.

```
<data>/backups/3f1a9c04/WELLE.NC/20260421-134502.881-WELLE.NC
```

`3f1a9c04` is a short code for the folder the program lives in — two folders can both hold
`WELLE.NC`, so the folder has to be part of the name. What you search for is the file
name, which is the folder inside it. The time stamp is **UTC**, so the names keep sorting
in order across a clock change; it is not your local time. A small hidden file `.folder`
in that folder notes where the program was; leave it where it is, the cleanup of old copies
reads it.

A backup is an ordinary copy of the file. Open one with **Open** (`Cmd/Ctrl+O`) — on macOS
the Library folder is hidden in that dialog: press `Cmd+Shift+G` and type the path — or
compare it with what you have now (`Cmd/Ctrl+Alt+C`, then pick the file).

**A very long file name is shortened in the backup folder.** The time stamp goes in front
of the name, and a name plus a stamp can be longer than a file name is allowed to be.
gEdit counts that limit as 255 bytes on every system — 255 plain letters, fewer with
umlauts. A program whose name is longer than 205 bytes is therefore filed under the
beginning of its name, cut where the room ends, then a dash, eight hex digits worked out
from the whole name, and its extension:

```
<the first 193 bytes of the name>-3dbc6d6b.NC
```

The name is simply cut: nothing from its end survives but the extension (one longer than
eight characters is dropped), and the eight digits keep two long names that begin alike
apart. The copy itself is untouched — it is the file, byte for byte, under a name you can
still recognise. Only the backup's name is shortened; your program keeps the name you gave
it.

**On Windows, long names need one setting.** gEdit reads and writes its own backups
whatever they are called, but Windows Explorer and older programs stop at 260 characters
for a whole path. A backup's path holds the program's name twice — as its folder and in
the file name — so a name of about 90 characters is enough to pass that, whatever folder
the program itself is in, and the result is a backup you cannot reach by hand. If that
happens, switch the machine's long-path support on: `Computer
Configuration ▸ Administrative Templates ▸ System ▸ Filesystem ▸ Enable Win32 long paths`
in `gpedit.msc`, or set `LongPathsEnabled` to `1` under
`HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FileSystem` and restart. It needs
Windows 10 version 1607 or newer; on an older Windows there is no such setting, and the
way to reach the file is to copy the folder nearer the drive's root first.

**A new program has nothing to copy.** The first save of a file that is not on disk yet
writes no backup, because there is no earlier version of it.

**If the copy cannot be made** — a full disk is the usual reason — gEdit stops and asks.
**Cancel** writes nothing at all: the file on disk is still the last good version and your
text is still in the tab, so nothing is lost either way. **Save Without a Backup** goes
ahead, and the status bar says afterwards that this one save has no previous version
anywhere. gEdit never makes that choice for you.

**If the save itself fails** after the copy was made, the message names the copy. That is
the repair instruction: your last good program is that file.

### After a crash: unsaved work comes back

While a document has unsaved changes, gEdit writes its text aside **every 30 seconds**,
and again the moment you switch away from the window — which is the moment before a
computer gets put to sleep or shut down. A document with nothing unsaved is not written at
all, and neither is one you have not touched since its last snapshot. A document a script
is running on is skipped until the run has ended.

The snapshot holds the text together with the document's encoding, line ending and tape
leader, and the dialect and the machine chosen for it, so restored work saves back the same
way the original would have. It goes into gEdit's own data folder, and **nothing is sent
anywhere**.

A snapshot is dropped as soon as it cannot be needed: when you save the document, when you
close it, and — for the whole run — when you quit gEdit normally.

**What you see afterwards.** The next start says *Unsaved work was found* and lists each
document with what restoring it would do to the file on disk:

- the file has not changed since the snapshot;
- the file **changed on disk** after the snapshot — the text comes back, the file is left
  exactly as it is, and the changed-on-disk bar is already up so you can compare before
  you decide what to keep;
- gEdit **cannot tell whether the file changed**, because the snapshot holds no record of
  the file as it was — the text comes back on the file with the changed-on-disk bar up,
  and Save asks before it overwrites anything: compare first;
- gEdit **may not open the file any more** — usually because it was deleted, moved or
  renamed since the crash, or it sits on a share or a stick that is not mounted — the text
  reopens as an untitled document, and Save As offers the original path;
- the file **is no longer there**, although gEdit could still reach it earlier in this run
  (the second look or `Show Recovered Work` can show this) — it reopens with your text, and
  saving writes the file again;
- it was never saved to a file — it reopens as an untitled document;
- gEdit **could not tell which file the text belongs to** (the row is called *Unsaved
  text*). That happens when the crash landed between the two files a snapshot is made of,
  before the first one of a document had both halves. The text is all there; where it came
  from is not, so it reopens untitled — as UTF-8 with CRLF line endings, no tape leader
  and the default dialect, so check those — and Save As puts it back.

**Restoring writes nothing.** Every document in the list is ticked; untick what you do not
want back, and **Restore all** (or **Restore N selected**) reopens the rest in the editor as
unsaved documents — no file on disk is touched until you save it yourself. What you left
unticked is offered again next time. A snapshot you restored is deleted once the restored
document has been written into the new snapshot of this run (a moment later), so a partial
restore offers only what is still missing, not what you already have back. If crash
recovery is switched off, or the new snapshot cannot be written, the old one stays and is
offered again. **Later** (or `Esc`, or a click outside the dialog) leaves everything where
it is and asks again next time. **Discard** deletes all the work in the list — ticked or
not — for good, after one more question (**Delete it**, or **Cancel**, which brings the
list back).

**Two minutes of quiet.** gEdit cannot ask the operating system whether the run that wrote
a snapshot is dead, so it goes by a heartbeat: a running gEdit touches a file every 30
seconds, and a run that has been silent for **two minutes** counts as crashed. That is
also why a second gEdit never offers you the first one's documents. The cost is that a
restart within a couple of minutes of the crash sees no dialog straight away — gEdit takes
one more look about two and a half minutes in, and otherwise offers the work at the next
start. `Show Recovered Work` in the command palette (**F1**) asks at any time.

**When snapshots go.** Leftover work nobody came back for is deleted after **14 days**,
and the whole recovery folder is capped at 200 MB, oldest run first. Turning the feature
off (`Settings ▸ Files ▸ Recover unsaved changes after a crash`) stops new snapshots but
does **not** throw away what is already there: work written while it was on is still
offered back.

**What a crash costs you.** At worst the last 30 seconds of typing — and switching away
from the window costs you nothing: it adds a snapshot rather than postponing the next one.

**If a snapshot cannot be written at all** — the disk is full, the recovery folder cannot
be made, or the document has grown past 64 MB — gEdit says so, because a crash net that is
quietly off is worse than none: a message once, and then an item **Crash recovery is not
saving** on the left of the status bar for as long as it lasts (hover it to see which
documents). Click it to try again at once. It goes when the snapshots are written again, or
when you save or close the documents concerned. Save to a file when you see it.

**If the file is already open again.** At start, the last session is reopened only after
you have answered the dialog, so this happens only when the dialog comes late — the second
look after a quick restart, or `Show Recovered Work`. The program is then usually open
already, and the recovered text comes back in an *untitled* tab named after the file: the
work is all there, but Save asks where to put it, and gEdit will not save it onto a file
that another tab holds. A message that stays on screen names the file: *<name> is already open
in another tab, so its recovered text is in an untitled tab. Use Save As to keep it under
another name.* The same happens when the other tab holds the file under another spelling (a
link, a path with `..`). Close the program's other tab first, then use Save As on the
recovered tab, which offers the program's path. To get the text back on the file itself,
choose **Later**, close the program's tab, and use `Show Recovered Work`.

### Coming back where you left off

**Reopen the last files at start.** The programs that were open when gEdit was last closed
come back, up to 50 of them, with the one you were on in front. That tab opens first and
alone, so you can start working in it at once; the other files then open in the background and
take their places in the order they had. A file gEdit cannot reach
at that moment is skipped, with one line in the status bar next to the count of files that
did open, rather than one dialog per file; hover it to see which files were skipped.

**A skipped file is tried again at the next start.** It stays in the list while you work,
so a network share or a USB stick that was not mounted costs nothing: mount it, and the
file comes back at the next start (or open it yourself; from then on it is an ordinary
tab). A file that stays missing is dropped from the list once it has been missing at 5
starts in a row over at least two weeks.

An untitled document is not in the list, because there is no file to reopen — an untitled
document with unsaved text is covered by the crash snapshot instead.

Reopening a program counts as opening it, so the restored files also move to the front of
the recent list: after a restart the top of the list is your last session's tabs, the last
tab first, rather than the order in which you last opened things.

**Remember where you were in each file.** Per file, gEdit remembers:

- the cursor line and column, and the line the view was scrolled to;
- the bookmarks;
- a dialect you picked by hand, or a guessed one you chose to keep;
- the machine you picked for that program, including an explicit **none**, which is a
  different answer from never having chosen one — see [Machines](machines.md).

This is kept for the last 500 files, at most 200 bookmarks each (the first 200 in the
file), in gEdit's own state file — and all the memos together are kept under 384 KB, so
heavy bookmarking costs you the oldest memos rather than the whole state file. **Nothing is
written into your program**: a `.nc` file does not change because you set a bookmark in
it.

A memo is a convenience and never load-bearing. One that is missing is simply not used. A
remembered dialect that no longer exists is ignored, and the dialect is detected as if
nothing were remembered. A remembered machine that no longer exists falls back to the
dialect's default machine — or to no machine, where the dialect has none — and says so
each time the file is opened, until you pick a machine for it. Switching the setting off
does not erase what is stored — gEdit stops reading and writing it, and switching it back
on brings it back.

### Read-only programs

There are two different locks, and a third for data. The status bar shows **Read-only** while one of them is on;
hover it to see which, and click it to unlock. The tab shows a lock as well.

**The file is read-only on disk.** A program you may not write — one carrying the
read-only attribute on Windows, or one on macOS or Linux that belongs to another account
or sits on a share exported read-only, which is what a released program on a shop share
usually is — opens locked, and gEdit says so. Typing into it is refused with a message in
the editor. **Save** becomes **Save As**, always: gEdit never changes a file's attributes,
so the only place the text can go is a different file. Unlocking such a document frees the
editor and nothing else; Save still asks where to put it.

**You locked the tab.** **Lock Against Editing** in the command palette (**F1**; listed as
*File: Lock Against Editing*) locks a document against your own keystrokes — for the
proven program you want open for reference while you work on something else. Nothing on
disk changes. The same command unlocks it, and so does clicking the **Read-only** item in
the status bar, which is only there while something is locked. There is deliberately no
keyboard shortcut for it: an accidental one would look like a broken keyboard. While the
tab is locked, Save goes to Save As as well. The lock lasts as long as the tab: reopen the
file or restart gEdit and it opens unlocked.

**Both locks cover everything that would change the text.** Typing, pasting, a
template or Edit Cycle from the Insert tab, every command on the NC tab, a script whose result replaces the
text, a change of line endings in the status bar and the revert arrows in a comparison are
all refused, and the status bar says which lock stopped them and how to lift it. A
transformation or a script is refused before it runs, so nothing is computed and thrown
away. A script that only reports — to the Output panel, the Results panel or a new tab —
still runs. If you lock a program while a script is running on it, the result is not
written into it; gEdit offers to open it in a new tab instead.

**Reloading is not an edit.** When the file changes on disk, a locked document is reloaded
like any other (see above): the lock keeps your hand off the program, and the file on disk
is that program.

### What none of this protects

- **A program another application writes over.** gEdit backs up only the saves **it**
  makes. If the CAM system re-posts over a program, the version it replaced is gone as far
  as gEdit is concerned — you get the reload or the changed-on-disk bar, not a copy. (The
  next save *from gEdit* does back the re-posted version up.)
- **Logging out or shutting down on Windows and Linux.** gEdit has no way to hold up a
  session end there, so the unsaved-changes prompt is skipped and gEdit is killed. Only the
  crash snapshot covers that, which means up to the last 30 seconds of typing is gone. Save
  before you log out. (On macOS gEdit calls off a logout, a shutdown or a quit from the Dock
  or another application while something is unsaved, and shows its prompt instead. Once
  you have answered it, a quit goes ahead by itself; a logout or a shutdown you start
  again.)
- **Losing the computer or the disk.** Backups and snapshots live in gEdit's own folder on
  the same computer as the programs. They protect you against a mistake, not against a
  dead disk or a stolen laptop. Keep doing whatever you already do for the program folder.
- **A `.bak` you have saved over twice.** The sibling copy holds one version, so after two
  saves the version before last is gone. "In gEdit" is the setting that keeps several.
- **Anything that does not go through gEdit.** Deleting a program in Finder or Explorer, a
  script outside gEdit rewriting a file, a share that disappears mid-save — gEdit is not
  involved and has nothing to give back.
- **This is not version control.** There is no history you can browse in the program, no
  note on what changed, no merge and no "the version from Tuesday" — only dated copies in a
  folder that you open yourself.

## Finding your way around a program

| What you want | How |
|---|---|
| A line, or a block number | `Ctrl+G`, then `120` for the line or `N120` for the block |
| The next or previous tool change | `F7` / `Shift+F7`, wrapping around with a message |
| The structure of the program | The Program Map panel |
| A program start, a tool change or a cycle written for you | The Insert tab, or a word typed on an empty line — see [Writing with templates](templates.md) |
| Change one value of a cycle in a form | **Edit Cycle…** on the Insert tab — see [Edit Cycle](templates.md#edit-cycle) |
| What each word of this block means, and what is in force here | The inspector (`Cmd/Ctrl+Alt+A`) — see [Understanding a block](inspector.md) |
| Which lines are rapids, straight moves, arcs, threads or cycles | The coloured mark beside the line numbers — see [Motion colours](inspector.md#motion-colours) |
| A place you keep coming back to | A bookmark: `Cmd/Ctrl+F2` to set or clear it, `F2` and `Shift+F2` to step through them |
| Text | `Cmd/Ctrl+F`, the editor's own find and replace |
| Every hit of an address, a value or some text, in a list | `Cmd/Ctrl+Shift+F` (Find All…) — see [Searching](#searching) |
| A section, collapsed | `View ▸ Fold All` / `Unfold All`, and the sticky heading at the top of the editor |
| All the lines of one tool | `Cmd/Ctrl+F7` (Select Tool Segment): the segment the cursor is in, or the tool you pick — see [Tool segments](transformations.md#tool-segments) |

**Ctrl+G** is the Control key on every platform, not Cmd — Cmd+G stays with "find next"
on a Mac. It finds block **numbers**; names — an Okuma `NLAP1`, a Sinumerik label — are in
the Program Map. Asking again for the same block number goes to the next block that
carries it.

The **Program Map** lists what the dialect's profile says is worth listing: the program
start, tool calls, section headings, comments, labels, program stops, subprogram calls and
the program end. Click an entry to jump to it. It follows the program as you type, and scrolls so that the
entry the cursor is in stays in view as you move through the program.

On a program of a machine with [channels](channels.md), the map groups its tools and wait
codes by channel, the status bar says which channel the cursor is in, and `Alt+F7` /
`Shift+Alt+F7` step through the wait codes of that channel.

Bookmarks live in gEdit, not in the program — see
[Coming back where you left off](#coming-back-where-you-left-off), which is also where you
turn that off.

## Searching

| What you want | Command |
|---|---|
| Find text, one hit at a time, and replace it | `Cmd/Ctrl+F`, the editor's own find and replace (see [Shortcuts](shortcuts.md)) |
| Every hit in a list, in one program or in all open ones | **Find All…**, `Cmd/Ctrl+Shift+F` (Edit tab, *Search*) |
| Change what a search finds, in place or into a new tab | **Replace All…** (Edit tab, *Search*) |
| One address in the editor's own find box, so you can step through it | **Find Whole Address…** (Edit tab, *Search*) |

Find All and Replace All share one form. It reads each line the way the dialect does, so it
knows a comment from a block.

### What you type

**An address word** — tick *Whole address*. Type an address, with a value or a condition if
you like:

| Query | Finds |
|---|---|
| `G1` | `G1`, `G01` and `G1.`; not `G10`, `G100` or `G1.5` |
| `T01` | `T01` and `T1`, not `T10` |
| `S>12000` | every `S` above 12000 |
| `X<=-5.5` | every `X` at or below -5.5 |
| `SB=500` | the Okuma speed word `SB` set to 500 |
| `S1=` | `S1=` with any value; a bare `S1` finds `S1=500` as well |
| `Q206` | a variable or assignment name (`Q206=5`) |
| `FMAX`, `N10` | a keyword without a value, a block number |
| `O2000` | the program, and every call to it (below) |

The conditions are `=`, `!=`, `<`, `<=`, `>` and `>=`; all but `=` need a number. Anything
that is not an address with a value (blanks, a string) is not a word: untick *Whole
address* and search for it as text. A word is never found in a comment or a string;
*Also in comments* applies to text searches only. The letters of the address follow the
dialect, not *Match case*.

**A value is compared as written.** `X>50` finds `X60` and `X60.` alike, and `G1` finds
`G01`. gEdit does not apply your machine's number reading here: whether `X60` is 60 mm or
0.060 mm is decided on the machine, and a search that guessed would hide hits. To judge a
value by what it is worth, use [Program checks or Extents](scripts.md).

**A program number** finds the program's own line and the calls that name it. `O2000`
finds `O2000`, `M98 P2000`, `G65 P2000` and the macro calls `G66` and `G66.1`. On Fanuc
`M98 P52000` means five calls of `O2000`, so it is found under both `O2000` and `O52000`.
This works for `=` only, and only in the programs you search: a call in a file that is not
open is not seen. Replace never follows a call: renaming `O2000` does not touch
`M98 P2000`.

**Text** — leave *Whole address* unticked. The text is searched in the line as written.
Tick *Match case* to tell `Home` from `HOME`. A hit that falls in a comment is dropped
unless you tick *Also in comments* (this box is for text searches only); a Fanuc program name in `<…>` is not a comment. Tick
*Regular expression* for a pattern: see [Regular expressions](regex.md). If you tick both
*Whole address* and *Regular expression*, the word wins. A pattern that can only match
nothing (`$`, `^`) changes nothing: empty matches are skipped. gEdit cannot stop a
pattern that runs away (see [When a pattern is slow](regex.md#when-a-pattern-is-slow)), so
save your work first.

### Where it looks, and what you get

*Look in* is the active document or all open documents. Find All writes the hits into the
Results panel: the line, the text and, over several documents, the document; a click jumps
to the line. The heading holds the full count ("37 hits for G1"), and the status bar
repeats it. At most 10,000 rows are listed; if there are more, the panel says how many are
not shown.

### Replace All…

*Replace with* is the new text, and *Put the result* chooses **in place of the text** or **in a
new tab**. Into a new tab the program stays as it is.

- A word is replaced whole: replacing `G1` with `G0` turns `G01` into `G0`, not `G00`.
  A word typed **without a value** replaces only the address and keeps the value: replacing
  `S` with `SB` turns `S1000` into `SB1000`, and `X` with `Y` turns `X10.` into `Y10.`.
- With *Regular expression*, `$1` is the first group, `$&` the whole match and `$$` a dollar
  sign.
- It is a transformation like the ones on the NC tab
  ([the four rules](transformations.md#four-rules-that-hold-for-all-of-them)): it runs on
  the selection, or on the whole program when nothing is selected; it is one undo step; the
  count goes to the status bar; and a locked program refuses an in-place change. When
  the form starts from a word you had selected on one line and you keep that word as the
  query, the replace runs on the whole program, not on that line.

### Find Whole Address…

A pattern that matches an address as a whole, handed to the editor's find box, so `F3`
steps through the hits and its replace works as usual. It takes an address, or an address
with a number (`G`, `G1`, `T1`, `S12000`), not a condition like `S>12000`; Find All takes
those. It is **not** the word query: the find box knows nothing about NC code, so it also
finds the address inside a comment or a string, which Find All never does. The pattern
accepts a `+` sign on a positive number (`L X+10` on Klartext) and does not match behind a
letter or an underscore, so `G1` is not found in `MY_G1`.

For the patterns themselves see [Regular expressions](regex.md).

## Code help

Hold the pointer over a word and gEdit explains it: what the code does, which group it
belongs to, whether it stays active until something replaces it, and which addresses it
needs. Where the feed carries a thread pitch rather than a feed rate, the hover says so —
that is exactly the place where scaling a feed would cut a different thread.

The hover opens above the word, or below it when there is no room above in the window. For a
word on one of the first lines it can therefore be drawn over the tab bar and the ribbon while
it is shown. The tips of the buttons in the search box at the top right of the editor are
not cut off at the edge of the editor any more either.

gEdit draws no colour swatches in the editor: a line such as `#101=5` has no coloured square in
front of the number, whatever the number looks like.

![The hover on a G code](../screenshots/hover.png)

*`G81`: what it does, that it is a cycle and modal, and that it wants Z, R and F.*

Once gEdit has read the program up to the line, the hover also shows what the word means **in
this block**: a table of a cycle's parameters with the values written, and one line for an
address word such as `X` or `F` (target or incremental, diameter or radius, feed per minute or
per revolution, a thread lead, surface speed and its limit). For a number that depends on your
machine it shows what the number is worth on the machine chosen for the document, or, with none
chosen, every reading. See [The hover in context](inspector.md#the-hover-in-context).

Typing offers completions from the same database: the codes of the active dialect with
their descriptions, and, on a line with nothing before the word, the
[templates](templates.md#templates-in-completion) of the program. A completion that inserts more
than the code itself — a cycle with its words — shows the snippet icon; a plain code does not. Both are switched in `Settings ▸ Assistance`, and completion can be
set to appear automatically, only when you ask for it, or not at all.

The descriptions are written by the project, in its own words, for the subset of code that
CAM systems emit. That includes what five-axis and high-speed milling posts write: tool
centre point control, tilted working planes, mirror, scaling, polar and cylindrical
interpolation, the Klartext datum, plane and tilt cycles and the `PLANE` functions, and
the Fanuc macro functions. Hovering a Klartext sub-block such as `CYCL DEF 19.1` shows its
cycle. On a machine whose channel settings list a code as a wait, the hover says it is a wait
on that machine ([Channels](channels.md#the-hover-on-a-wait-code)). Names that are not codes —
a Klartext cycle or program name, for instance — get no hover. A code the database does not
describe says so rather than guessing. An
entry the project has written but not yet checked against a control's documentation is
**not shown in the hover at all** — the hover says the database does not describe the word,
which is the honest answer while nobody has confirmed it; the completion list shows it with
a "Not verified yet" note instead. **Your control's manual is the authority, not this
editor.** The codes added in this version from the control manuals
([listed in Dialects](dialects.md#codes-added-from-the-control-manuals)) are marked inside the
project as waiting for a review, but gEdit does not show that mark: read them with the manual
at hand.

## Checking a program before the machine

Two bundled scripts read a program without running it, and a third does arithmetic on it.
They are on the Tools tab (group *Built-in Scripts*) and are described in [Scripts](scripts.md):

| | What it tells you |
|---|---|
| [Program checks](scripts.md#program-checks) | What the program does that the control or the machine will not like: a cut with the spindle stopped, a tool change inside a cycle, a jump to a block that is not there, a thread under constant surface speed, a number whose value depends on how your machine reads it, the stops |
| [Extents](scripts.md#extents) | The smallest and largest value of every axis, for the program, each work offset and each tool, with the arcs counted, and how many positions could not be worked out |
| [Address arithmetic](scripts.md#address-arithmetic) | Adds to, subtracts from, multiplies or divides chosen addresses. A Z shift moves the cycle positions that go with it, or refuses a block it cannot judge and lists it |

For a control that runs several programs at once, **Check Wait Codes** on the Tools tab
compares the wait codes of the channels. It is described in [Channels](channels.md#check-wait-codes).

None of this is a backplot or a simulation: they read the text, and a result is only as
good as what gEdit is told about the machine. With no machine chosen they say "assumed" or
leave a value alone rather than guess ([Machines](machines.md)). Block skip, for marking a
prove-out section, is on the NC tab ([Transformations](transformations.md#block-skip)).

## Comparing two programs

`Cmd/Ctrl+Alt+C` compares the current document with the version on disk, another open tab,
or any file you pick. The comparison opens over the editor, side by side or inline, with
buttons for the next and previous difference.

The current document stays editable in the comparison, unless it is locked; the other side
is read-only. Files above 50 MB are refused.

A comparison has two modes.

- **Raw** shows every difference in the text. **Ignore whitespace**
  (off by default) leaves out differences in the blanks at the start and the end of a line,
  not the spaces between words.
- **Review** is for a program the CAM system posted again. It leaves out what only looks
  different and shows what the machine would read differently. The **Raw** and **Review**
  buttons in the comparison switch between the two; the command **Review Mode** (command
  palette) does the same.

Without a choice from you, a comparison opens in raw mode the first time. gEdit remembers
the mode afterwards, also after a restart.

### Review mode

Review mode tidies both sides line by line, then compares the tidied text. Five options say
how, and a sixth on Heidenhain Klartext:

| Option | What it leaves out |
|---|---|
| Block numbers | The `N` numbers (Sinumerik `:10`, the number at the start of a Klartext block) |
| Whitespace | Blanks at the ends of a line, runs of blanks (one counts as many), empty lines |
| Comments | Comments; a line that holds only a comment disappears |
| Case | The difference between `G1X10` and `g1x10`, outside strings |
| Number format | `X+05.500` against `X5.5`, `G01` against `G1`, a decimal comma against a point |
| Cycle names (Klartext only) | The cycle name in the control's dialog language: `CYCL DEF 200 BOHREN` against `CYCL DEF 200 DRILLING`, and the label of an old numbered cycle, `CYCL DEF 9.1 V.ZEIT 1.5` against `CYCL DEF 9.1 DWELL 1.5` |

**What each option never does.** Review mode never hides a difference the machine would see.
So, whatever you switch on:

- **A block number a jump points at stays** (`GOTO 100`, `G70 P100 Q200`, `M98 Q50`), and in
  a program with a jump to a computed target (`GOTO #1`) every block number stays; the
  bar says so. A jump written in another file, such as `M99 P` returning to a number in the
  main program, cannot be seen: compare raw where a subprogram returns by number.
- **Labels stay**: Okuma `NLAP1`, Sinumerik `LOOP_A:`, Klartext `LBL`. A block number
  glued to a name (`N30XNOW=62` on Sinumerik or Okuma) stays too, since the control
  may read the two as one name.
- **Whitespace** never joins two words or splits one: `G1X10` and `G1 X10` are different
  lines. Text inside strings is never touched.
- **The decimal point stays** where a reading of the machine counts it: with a machine
  that takes increment input `X10` and `X10.` are different. With **no machine** chosen,
  they are different wherever the dialect declares such a reading, which is Fanuc; the
  bar says so. Setting the machine ([Machines](machines.md)) makes this exact.
- **A number with no point on an address that is not an axis compares as written**:
  `H01` and `H1`, `T01` and `T1`, `P0010` and `P10` are different. A turning program's `T`
  word is never reformatted (`T001` is not `T1`). Program numbers, names, variable names,
  strings and comments the control reads are never reformatted. A `G84.2` keeps its
  fraction.
- **Comments the control reads stay** even with *Comments* on: see the table below.
- There is no tolerance: `X10.0001` and `X10.` are two different values.

**What is on to begin with.** When you open a review, the options start from your dialect's
defaults. Block numbers, whitespace, comments and number format are on for every dialect;
case is on only for Sinumerik; cycle names are off.

| Dialect | Case | Comments the control reads, which stay |
|---|---|---|
| Fanuc mill and lathe | off: the control has no lower case and drops it on input | The program title in the first block (`O1001 (BRACKET)`, `:1001`, `<NAME>`); an alarm or stop message (`#3000=`, `#3006=`); a `%` inside a comment, which ends the program on input |
| Heidenhain Klartext | off (switch it on if your control takes lower case; modern controls convert it to upper case when they load a program) | None. The `;` labels of the cycle parameters and the `*` structure blocks go with comments |
| Okuma OSP | off | A `%` inside a comment (kept to be safe) |
| Sinumerik (turning and milling) | on: the control does not tell case apart, except in tool names, which are strings | The `;$PATH=` header, which files the program on import; the cycle-screen markers `*RO*` and `*HD*` |

On Okuma, a block number that stays is compared as text: `N0123` is not `N123`.

**Cycle names are off to begin with.** The words after `CYCL DEF <n>` (and the label
words of the old numbered cycles, `CYCL DEF 9.1 DWELL 1.5`) are text in the control's
dialog language, not comments, and whether your control ignores them when it loads a
program is not known. So a program posted again in another language shows each cycle
header as changed, one line per cycle, with its number visible. Switch **Cycle names** on
to leave out exactly those words: the name after `CYCL DEF 200` or `CYCL DEF 7.0`, and the
label in front of a value (`V.ZEIT` in `CYCL DEF 9.1 V.ZEIT 1.5`; the `1.5` is still
compared). The cycle number, every value, axis word and `Q` parameter, and the parameter
lines below the header stay; the `;` labels of the parameter lines are comments and go with
*Comments*. A line where the name cannot be told apart from the rest (`CYCL DEF 7.1 X+10`,
`CYCL DEF 32.2 HSC-MODE:0 TA0.5`) is compared as written.

**A trailing comment on a Sinumerik cycle call is ignored**, though it changes how the
control's own editor shows that call. It does not change what the call runs.

**A block that holds only a number or a comment is not shown** in review mode (`N100`
alone, `(CHANGE INSERT)` alone). Such a block can matter, for example under cutter
compensation, which looks ahead over blocks without a move. Compare in raw mode to see
them.

### Setting the options

The options are buttons in the **review bar** (the sixth, *Cycle names*, only for a
Klartext program), the second row of buttons that appears
under the toolbar in review mode; each one switches on or off. Each side
uses the settings of **its own** program: its dialect and its machine. When the two programs
use different machines, a note in the review bar says so, and the decimal point is read for
each side by its own machine. When the two programs are **different dialects** (a Fanuc
program against a Sinumerik one), a note says that too, and each side is read as its own
dialect. A file compared by name, which is not open as a program, has no machine; the note
says that too.

gEdit keeps the options **per dialect**, also after a restart: what you switched away from the
dialect's defaults is remembered, and the rest keeps following the defaults. The **Profile defaults** button in the review bar
sets the options back to what the dialect starts with (the button says "profile" where this
guide says "dialect": it is the same thing).

### Merging

In raw mode a difference can be copied from one side to the other:

| Command | Key | Does |
|---|---|---|
| **Copy Change to Current Document** | `Cmd/Ctrl+Alt+Right` | Puts the other side's version of the difference into your document |
| **Copy Change to Original** | `Cmd/Ctrl+Alt+Left` | Puts your version into the other side |

Both are on while a comparison is open. The **←** and **→** buttons in the comparison do the
same (← copies into the original, → into the current document). A click on a button, like
the key, copies the whole difference at the cursor and then moves to the next difference;
**Shift+click** copies only the line at the cursor and stays where it is. Right after an
edit the comparison needs a moment to find the differences again; a copy asked for in that
moment is refused with a message ("still updating"), so a held key never copies twice.
A copy is one undo step in the document that received it. Copying into the other side is possible only when that side is an open
document; the version on disk is not edited this way, and a locked document refuses a
copy like any other change. Review mode is for reading: switch back to raw to merge.

### Exporting the differences

**Export Differences…** writes the differences as a standard unified diff, with three lines
of context, into a new untitled tab. The button follows the mode you are in: in raw mode it
writes the raw text, in review mode the tidied text. If nothing differs, gEdit says so instead of opening an empty tab. A
diff over a very long run of changes may show it as one large block, which is right but
not minimal.

### Two files on disk

**Compare Two Files…** (Tools tab) asks for two files, opens both as programs and compares
them. The first file you pick is the **original** (the read-only left side); the second
becomes the current, editable document. Because both are open programs, you can merge in
either direction and save them as usual. If the second file cannot be opened (it is binary
or too large, say), gEdit says why and stops; the first file stays open as a program.

### Going to a line

The number box in the comparison's toolbar takes you to a line: `Enter` goes to it in the
current document, `Shift+Enter` in the original. In review mode the number is the line of
the file as it was before the review tidied it, so the line you read in the editor is the
line you get. A line that is not in the comparison (past the end, or a line review left
out) gets a message instead.

## Checking gEdit against your own programs

gEdit is tested against programs written for it and against a few the owner published. If you
build it yourself you can also check it against your own, which never leave your disk: put
them in `tests/real/` (or the folder `GEDIT_REAL_FIXTURES` names) with a `manifest.json`, and
run `npm test -- realFixtures`. For each program it checks that the dialect is detected as
you said, that no unknown mark is left outside comments (except the ones you list with a
reason), that the program map and the tool list name the tools you expect, that the file
survives a byte-exact round trip, that Scale Feed and Scale Speed at 100 % give back every
byte, that the program checks, the extents and Address arithmetic run without a crash (adding 0 to `Z` must give back every byte), and that nothing else crashes. It prints counts only, never a file name or program text, and
for the program checks a line of how many findings each check made in how many programs, which is where a check that cries wolf shows.
The manifest and the report are described in [tests/real/README.md](../../tests/real/README.md).

## Typing: forced upper case and no accidental joins

Two options of the dialect change what a key does while you type. Both are **on for all six
shipped dialects**, and both can be changed per profile in a
[profile of your own](profiles.md#typing-options-in-a-profile).

**Upper case.** A lower-case letter you type in code comes out as a capital: `g1 x10.` becomes
`G1 X10.`. It is one keystroke and one undo step, like any other typing. It does **not**
touch:

- what is **inside a comment**, in `( )` or after `;`, so the note to the operator stays as
  you write it;
- what is **inside a string** — a tool name in quotes (`TOOL CALL "mill_d10"`,
  `T="drill_d8"`), the text of a message (`MSG("Check the clamp")`) — and text the dialect
  keeps as text, such as a path in a Klartext program;
- **paste**, drag and drop, a script's result, the text a command inserts and anything else
  that is not a key press: those arrive as they are. (To change a program afterwards, use
  [Convert Case…](transformations.md#convert-case).)
- a key with `Ctrl`, `Alt` or `Cmd` held (so `AltGr` and `Option` characters are untouched),
  a letter that has no single capital (`ß`), and text composed with an input method;
- a **`.json` or `.py` file**: your profiles, `machines.json` and scripts are not NC programs,
  and a lower-case key in them is a different key.

gEdit looks at the line as it would read with the letter in it, so a letter typed right after
the `(` of a comment is already inside the comment, and one typed after the `)` is code again.
With several cursors, each decides for itself. A line of more than 20,000 characters is not
looked at while you type. One Klartext detail: the program name in `BEGIN PGM name MM` is
kept as written: a name typed from left to right keeps its case before the unit behind it
is written. A Fanuc `<name>` in angle brackets keeps its case in the same way.

The **Upper-Case Typing** button in the **Typing** group of the Edit tab (also in the palette)
switches this off, or on, **for this session**, for every open document. It is not
remembered: the next start follows the profiles again. The status bar says which way it
went. To switch it off for good for a machine or a folder, write `"forceUppercase": false`
in a profile of your own.

**No accidental joins.** `Backspace` in the first column of a line and `Delete` at the end of
a line would join two blocks into one, which is almost never what you meant and easy to
miss. gEdit refuses these key presses **when both lines hold text**, and says *"Not joined:
that would run two blocks together. Select the line break to delete it."* in the status bar.

- **Empty lines can still be deleted** the usual way: `Backspace` on an empty line, or `Delete`
  at the end of the line above it, as long as one of the two lines is empty (a line of only
  spaces counts as empty).
- To really join two blocks, **select the line break** (shift-arrow across it) and delete it:
  a selection is always deleted normally, and so is **Delete Line**. A word delete
  (`Ctrl`, `Alt` or `Cmd` with `Backspace` or `Delete`) is refused at the join of two lines of
  text like the plain key, since it would run the two blocks together as well.
- Several cursors: the key press is refused only if one of them would join two lines of text.

There is no switch for this one on the ribbon. A profile of yours turns it off with
`"preventLineJoin": false`.

**Convert Case… asks about lower case.** Because the dialects expect upper case,
[Convert Case…](transformations.md#convert-case) asks a question before it writes a program
in lower case, on every shipped dialect.

## Settings

`Cmd/Ctrl+,` opens the settings dialog. Seven pages:

| Page | What you can set |
|---|---|
| **Appearance** | Theme (System, Light or Dark), editor font and size |
| **Editor** | Tab width, spaces or tabs, whitespace display, word wrap, minimap, line numbers, current-line highlight, sticky scroll, text drag and drop, copy without a selection |
| **Assistance** | Hover help on or off; completion automatic, manual or off; [colouring the lines by how they move](inspector.md#motion-colours) on or off |
| **Files** | Length of the recent list, what happens when a file changes outside gEdit, the dialect new files start in, and what [Never losing work](#never-losing-work) sets: where the backup copy goes, how many versions to keep, the most space they may take and when the earlier versions of deleted files go, and the switches for crash recovery, session restore and per-file memory |
| **Scripts** | The Python interpreter, extra script folders, the time limit for a run, whether the bundled scripts are listed — and the path of your own scripts folder |
| **Machines** | Your machine configurations: add, edit, duplicate, remove, import and export, and which one is the default for a dialect — see [Machines](machines.md) |
| **Profiles** | Your own profiles and code files: new, open, import, export, remove, test on the open program — see [Your own profiles and code files](profiles.md). **Manage Profiles…** in the palette opens the dialog on this page |

**Closing the dialog with something unsaved asks first.** If you typed a new value and leave
without **Save** — **Cancel**, `Esc`, a click outside the dialog, or **Open settings file** —
gEdit asks *Unsaved changes: The changes you made in Settings are not saved. Leave without
saving them?* and offers **Discard changes**. The same question comes while a machine on the
Machines page is half filled in (*The machine you are adding or editing is not saved yet. Leave
without saving it?*): when you close the dialog, press **Open settings file** or **Save**, and
also when you click another page of the dialog, because the page you leave drops the form.
With nothing typed, nothing is asked.

The Machines and Profiles pages are not pages of settings. Machine configurations are
records with names of their own, and they live in their own file (`machines.json`), not in
`settings.json`; your profiles and code files are files of their own in two folders.

Settings are stored as a small JSON file that holds only what you changed, so a default
that improves in a later version reaches you. `Open settings file` in the dialog opens it
as a document, for the few keys that are not in the dialog (column rulers, for example).

Where that file is, and your own scripts folder beside it, is listed under
[Where things are](#where-things-are).

## What gEdit does not do

Being clear about this saves disappointment on the shop floor.

- **No backplot, no 3D display, no simulation.** gEdit reads and writes text. It does not
  know where the tool is.
- **No machine communication.** No DNC, no serial, no FTP, no drip feed.
- **No program management.** No library, no job list, no PDM or ERP link.
- **Six dialects: Fanuc mill, Fanuc lathe, Heidenhain Klartext, Okuma OSP for turning, and
  Sinumerik 840D for turning and for milling.** Milling on an Okuma control is not covered:
  an Okuma milling program opens with the turning profile, which reads some of its codes
  wrongly — see [Dialects](dialects.md#milling-on-okuma-and-sinumerik). A program for any
  other control opens with the profile that fits best.
- **Channels are read, not run.** For a control with several channels (two turrets, two
  paths) gEdit can show the channels apart and check that the wait codes fit each other. It
  does not know what a wait does at the machine, it reorders and synchronizes nothing, and a
  clean check is no proof that the program runs. Showing two channels **side by side** is not
  there; it is planned for a later version, and today you step between the channels. **Split into Channel
  Documents** makes copies for reading: nothing you change in them comes back into the
  program. See [Channels](channels.md).
- **A profile of your own describes; it does not compute.** It changes how a dialect's
  programs are recognised, numbered and explained and what typing does. It cannot run code,
  and a control gEdit has no profile for is still read by the closest dialect — see
  [Your own profiles and code files](profiles.md#what-a-profile-of-yours-is-not).
- **gEdit does not know your machine unless you tell it.** Whether `X50` is 50 mm or
  0.050 mm, which G-code system a lathe uses, what is modal at power-on: all of that is a
  machine setting, and with no machine configured gEdit says "assumed" and refuses to
  compute the values that depend on it. It never reads a control, and it never imports a
  parameter file — you type it in once. See [Machines](machines.md).
- **Python is needed only for the script features.** Everything on this page, and
  everything in [Transformations](transformations.md), works without it. If Python is
  missing or older than 3.9, the commands that run a script are disabled with a message and
  nothing else changes.
- **Scripts are not sandboxed.** A script is an ordinary program running with your rights.
  See [the security section of Scripts](scripts.md#security).
- **On Windows and Linux, logging out or shutting down skips the unsaved-changes prompt** —
  only the crash snapshot catches that work; see
  [What none of this protects](#what-none-of-this-protects).
- **There are no workspaces or projects.** gEdit reopens the files that were open last
  time and your place in each of them
  ([Coming back where you left off](#coming-back-where-you-left-off)), and that is the
  whole of it: no named set of programs to switch between, nothing grouped by job or by
  machine.
- **Saves are written in place**, not written to a temporary file and moved, because on a
  share the file's identity and its rights are what the DNC drip-feeder and the CAM
  watcher see. A crash or a power cut in the middle of a save can therefore still leave a
  partial file. Unless you turned the copy off, the previous version is finished and on
  disk before the first byte is written. If the write fails while gEdit is still running,
  the message names that copy; after a crash or a power cut, look for it in
  `<data>/backups/` (or beside the program, with the `.bak` setting).
- **No version history inside the program** — the backups are dated copies in a folder;
  see [What none of this protects](#what-none-of-this-protects).
- **English only.** Every text in the program is English.

## Where things are

| | |
|---|---|
| Settings | `<config>/settings.json` |
| Machine configurations | `<config>/machines.json` |
| Your own scripts | `<config>/scripts/` |
| Your own profiles | `<config>/profiles/` |
| Your own code files, with your own templates | `<config>/codes/` |
| Recent files, panel sizes, remembered form values, the last script you ran, the last session, and your place in each file | `<data>/state.json` |
| Window size and position | `<config>/.window-state.json` |
| The copies made before a save | `<data>/backups/` |
| Unsaved work kept for a crash | `<data>/recovery/` |

`<config>` and `<data>` are the standard application folders of your operating system: on
macOS both are `~/Library/Application Support/com.pburg.gedit`, on Windows both are
`%APPDATA%\com.pburg.gedit`, and on Linux they are `~/.config/com.pburg.gedit` and
`~/.local/share/com.pburg.gedit` (under `$XDG_CONFIG_HOME` and `$XDG_DATA_HOME` when those
are set). The settings dialog shows the script folder, and `About gEdit` shows the version
and the third-party notices.

The last two folders hold the contents of your programs. On macOS and Linux gEdit
therefore narrows both, and every folder it makes inside them, to your account alone, and
puts that back on the two at every start; on Windows they sit in your own profile. A
snapshot is a plain text file, so you can copy your work out by hand if gEdit will not
start.

**Starting it from a terminal.** On macOS and Windows the program is called gEdit. On Linux
the installed program is `gedit-nc` (`/usr/bin/gedit-nc`; the entry in the application menu is
still *gEdit*), so that it does not clash with the GNOME text editor, which is also called
`gedit`.
