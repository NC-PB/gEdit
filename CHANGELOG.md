# Changelog

What changed in each release of gEdit, written for the person who edits NC programs. The release workflow publishes the entry of a version as the notes of its draft release, so the top of each entry has to make sense on its own. The entry called `Unreleased` is what has been fixed or added on `main` since v1.0.0 was prepared; it has no date and no release of its own yet.

## Unreleased

A round of fixes after the v1.0.0 preparation: files, recovery and backups report and bound themselves honestly, scripts behave on Windows and when started from the Dock, the ribbon has seven tabs, the code help is filled in from the control manuals for all four control families, and a number of small readings of Klartext, Sinumerik, Okuma and Fanuc programs are corrected. The plan of record is [bugfix-round-1.md](docs/planning/bugfix-round-1.md); the guide pages are linked below.

### New

- **Ribbon with seven tabs:** File · Edit · Insert · NC · Tools · Scripts · View. The old Home tab is gone: New, Open, Save, Close and the recent list are on File, the editing, search, Go To and typing commands on Edit, the scripts that come with gEdit under Tools (group *Built-in Scripts*), and Run, Stop, your own scripts (*My Scripts*), New Script, Edit Script, Rescan and Add Folder on Scripts. Program start is on the Insert tab only. See [The window](docs/user/README.md#the-window).
- **Reload** on the File tab reads the open file again from disk; with unsaved changes it asks first, and the reload is one undo step. See [Reload from disk](docs/user/README.md#reload-from-disk).
- **Two settings for the backup history** (Settings, Files): *Most space for earlier versions (MB)* (default 500, 0 for no limit) and *Delete earlier versions of deleted files after (days)* (default 90, 0 to keep for ever). The newest version of every file is always kept. See [Before a save](docs/user/README.md#before-a-save-the-backup-copy).
- **A status item *Crash recovery is not saving*** stays on the left of the status bar while snapshots cannot be written; click it to try again.
- **Settings asks before losing input:** *Unsaved changes — Discard changes* when you close the dialog, press Open settings file or Save, or click another page while a value is typed or a machine form is half filled in.
- **Shortcuts:** the commands without a key are hidden behind *Show commands without a key*, and a line says how many are hidden.
- **Machines:** a preset that is not yet checked against a machine says *(unconfirmed)* in the choice; the notice that a program and its machine disagree has a *Choose Machine…* button; the name (64) and notes (500) have length limits in the form. See [Machines](docs/user/machines.md).
- **Scale Speed scales the Klartext cutting speed `VC:`** (`FUNCTION TURNDATA SPIN VCONST:ON VC:120`) under the constant-surface-speed choice, like `SVC=`.
- **Scale Feed leaves the `F` of a function** — Klartext `M128 F…`, `M140 … F…`, `PLANE … F…` and cycle 19 — as written and says so; the tool list does not count it as a feed, and the inspector keeps showing the feed of the path.
- **Code help from the control manuals, marked for review** (see [Codes added from the control manuals](docs/user/dialects.md#codes-added-from-the-control-manuals)): Fanuc `G5.4`, `G6.2`, `G29`, `G30.1`, `G41.2`–`G42.6`, `G43.1`, `G92.1` and on the lathe `G50.3`, `G68.1`, `G69.1`; Sinumerik `CYCLE61`, `POCKET3`, `POCKET4`, `SLOT1`, the arguments of `CYCLE93` and `CYCLE97`, `G601`–`G603`, `G643`–`G645`, `CUT3DCC`, `COMPSURF`, `CTOL=`, `OTOL=` and the channel commands `WAITM`, `WAITE`, `SETM`, `CLEARM`; Klartext cycles 251–254, 256, 257, 14 and 21–25, `VC` and the points `P1X`–`P3Z`; Okuma `G93`, `G119`, `G132`/`G133`, `G313` and `M85`. gEdit does not show the review mark in the hover: read them with your manual.
- **Lathe cycles `G71`–`G76` are read per block:** the inspector and the hover say which of the two blocks a line is (also a second block written alone) and give every word the meaning it has there; code files can say `"block": 1` or `2` for a word. See [Understanding a block](docs/user/inspector.md#cycles).
- **Klartext `PLANE POINTS P1X+0 …` and the FK points** are words with a value, not unknown text; double-clicking `241,781` selects the whole number.
- **Linux:** the installed program is `gedit-nc` (`/usr/bin/gedit-nc`), so it does not clash with the GNOME text editor `gedit`; macOS and Windows are unchanged.
- **Scripts started from the Dock or Finder** get the folders of your login shell's `PATH` added to their own (not when `GEDIT_PYTHON` or the interpreter setting is set); a program started by a script ends with the script on Windows too (Stop, timeout, Quit).

### Changed

- **Convert Case keeps program names and numbers** (`<name>`, `O1234`, `:1234`, file headers, the target of an Okuma `CALL`): the control may tell upper from lower case in them. Converting to upper case leaves an `o1001` as it is, and the results panel says so. See [Convert Case](docs/user/transformations.md#convert-case).
- **A file under two spellings is one tab** (a symbolic link, a `..` path, on Windows a mapped drive or a short name); Save As onto a file another tab holds is refused whatever its spelling.
- **A restored session shows the tab you were on first** and opens the others in the background in their old order.
- **Saving compares content** when the file's size and time are unchanged, so a program another tool rewrote on a USB stick inside the two-second step is noticed.
- **Open and Reload refuse a file whose size the file system will not tell** (*The file system did not answer for …*).
- **Backups of files on a USB stick, a network share or another disk are never deleted because the file seems to be missing;** only the oldest copies beyond the space limit go, and the newest copy of every file stays. The folder is looked at at most every 10 minutes, and not at all while `settings.json` cannot be read.
- **Recovery:** a restored snapshot is deleted only after the restored document has its own new snapshot, so a partial restore offers only what is missing; a restore onto a file another tab holds goes to an untitled tab with a message that stays.
- **`files.recentLength: 0`** stops recording and hides the list but keeps it; a failed write of the list is reported.
- **Replace on `machines.json`** always keeps the old file as `machines.json.bak` (or with the date in its name), is not offered for a file from a newer gEdit, and the settings-file rescue copy no longer overwrites an older `.bak`.
- **Scripts:** editing a script's `input` or `output` header and running it without Rescan reloads the list and runs it with the new header; quitting waits a third of a second for a running script instead of one and a half; error output that was cut is marked *Error messages cut off*; a script whose output was cut is refused with a reason; `/ \ : < > " | ? *` are not allowed in a new script's name.
- **Hover placement:** a hover opens above the word, or below when there is no room, so near the top it can be drawn over the ribbon; the tips of the search box buttons are no longer cut off. No colour swatch is drawn for `#101=5`. The ribbon scrollbar sits below the group names, and there is no second title row inside the window.
- **Program checks, Brackets:** an unclosed string or `[` runs to the end of its line and the finding says *a string is opened with " and not closed on its line* / *a [ is opened and not closed on its line*.
- **Okuma:** a `$` line is never numbered by Renumber, even with `$` removed from the skip list; the program map lists `G171`–`G176` as calls and names up to 16 characters (`O1000ABC` is not a name); `G17`, `G18` and `G119` under radius compensation are reported; `G20` and `G21` are moves to machine positions.
- **Fanuc lathe:** the turret mirror (`G68`/`G69`) and the coordinate rotation (`G68.1`/`G69.1`) are separate, so `G69` no longer ends a rotation in the state or in address arithmetic.
- **Klartext:** a modal cycle call (`M89`) runs on polar moves (`LP`, `CP`, `CTP`) too; address arithmetic leaves the absolute FK points as written and warns; cycles 22 and 23 no longer demand `Q208`.
- **Inspector and cycle form accept decimals** for words that are real numbers although the database counts them (Euler angles and direction components of `G68.2`, `G43.5`, `G41.6`, the knots of `G6.2`).
- **Colours match the reading:** Klartext cycle names, program names and paths are one piece of text, `VC:120` and `#5` are one word, Fanuc free text and four-digit G/M codes are coloured right, Okuma names and block numbers are whole, and the Sinumerik jump target and `DEF` names are coloured.
- **The Fanuc mill's *As written* preset** is labelled *As written: X50 and X50. are both 50 mm*; the Machines page no longer promises a backup that it did not always make.
- **Faster scripts:** the lexer is about a third faster, so Program checks, Extents and the tool list take about two thirds of the time on a 300,000-line program; the program map is built in short slices that keep typing smooth.
- **The program map scrolls to the cursor's row;** an expanding completion carries the snippet icon.

### Fixed

- **Two tabs could own one file** (a link, a `..`, a mapped drive) and the later save overwrote the earlier.
- **A same-size rewrite on FAT32 or exFAT** was not noticed before a save.
- **A transform of 1,000 or more separate edits moved bookmarks and folds,** on the run and on Undo; they now stay where they are, and one Undo still takes the whole run back.
- **Recovery:** failing snapshots had one message and no lasting sign; a partial restore offered the restored snapshots again; a lone surrogate in a Windows file name lost that document's snapshot.
- **`state.json` write errors** went to the console only; a saved config file lost a narrowed `chmod`; the backups had no overall bound.
- **Settings lost typed input** on Open settings file and on Save with a half-filled machine form; a machine note over 500 characters made the machine unusable at the next start.
- **Sinumerik `GOTOF:20`** was read as a label named `GOTOF`; Remove Block Numbers wrote no row for `GOTOB :20`; the Klartext `PLANE POINTS` word was unknown text.
- **A wrong status message** appeared when a machine of another control was picked through *Other machines…*; the stale-result dialog could be skipped when another dialog was open; a failed save showed two messages.
- **Windows:** what a script started survived Stop, timeout and Quit.
- **A script switched to `panel`** could still replace the document until Rescan.
- **The first build of the program map** stalled the window for 90 to 150 ms at a time on a big program; the longest stall is now about 50 ms. A Fanuc lathe detection rule took 34 ms on a very long line.
- **The feed in force** showed the `F` of `M128`, `M140`, `PLANE` or cycle 19 as the path feed.

### Known limits

- A file with CRLF line endings that holds a single stray CR is saved with a CRLF there, so that one spot is not byte for byte; the guide says so under [Files](docs/user/README.md#files).
- The Windows and Linux changes (the job object, the file-name rules, a mapped drive, the `gedit-nc` name) are proved by the project's builds only and not yet tried on a real machine. The ribbon scrollbar on a Mac with overlay scrollbars has not been looked at.
- The code entries listed under *New* are marked for review inside the project; a wrong hover text or label is a bug to report.
- Absolute FK points are left as written when you shift an axis; they are not moved.

## v1.0.0 (2026-10-10)

The first full release, 1.0: gEdit is an editor for the NC programs that come out of a CAM post-processor, for Fanuc milling and turning, Heidenhain Klartext, Okuma turning and Sinumerik 840D turning and milling. It works in three layers, one for each phase of the plan. The editor (Phase 1): open a program, find your way around it, clean it up, renumber it, scale feeds, list the tools, compare it with the last version and save it without changing a byte you did not ask to change. The programs of your posts, safely (Phase 2): they are read right, you run checks before the machine, move a Z shift with the cycle depths, compare and merge two versions, search by the value of a word, and tell gEdit about your machine, your multi-channel control and your own dialect. Understand and write (Phase 3): see what a block means and what is in force, and write cycles from templates. It works offline, and Python is needed only for the script features. The installers are unsigned, as before; see "Installing an unsigned build" under v0.2.0. The built-in templates are marked "review pending": nobody has yet checked their text against a real control, so read what they insert before you send it to a machine.

This is everything since v0.5.0, in five parts.

Multi-channel programs: gEdit knows the channels of a twin-turret lathe or a multi-path control, shows the map and the tool list for each channel, and checks that the wait codes of the channels fit each other. It runs nothing and synchronizes nothing. See the [Channels](docs/user/channels.md) page.

Real programs, second pass: programs from real CAM posts are recognised more reliably, a program that fits no dialect is marked as a guess, and the tool word, channel presets, checks and names follow what real posts write. See [Dialects](docs/user/dialects.md), [Machines](docs/user/machines.md) and [Channels](docs/user/channels.md).

Your own dialects and codes (the end of Phase 2): you can write profiles and code files of your own, test a profile on the open program, move machine configurations between computers, and type without lower case or joined blocks. See [Your own profiles and code files](docs/user/profiles.md).

Understanding a block (Phase 3, first half): a code inspector for the block at the cursor, hover help with a cycle's parameters and what the word means in its block, and a coloured mark beside every line that moves. It reads and explains; the one thing it writes is a value you change yourself. See the new [Understanding a block](docs/user/inspector.md) page.

Writing with templates (Phase 3, second half): the Insert tab offers parameterized templates (a program start, a tool change, a drilling or turning cycle) for all six dialects instead of the old fixed code blocks, written with the dialect's number style and the block numbers carried on; **Edit Cycle** changes a cycle in a form; a field can be a formula; and you can keep templates of your own. The templates that ship are marked "review pending": check what they insert against your machine. See the new [Writing with templates](docs/user/templates.md) page.

### New

- **Templates in the Insert tab:** the templates of the program you are in, by group, as buttons and a *More Templates…* list, with *Insert Template…* and one command for each template in the palette. A short form asks for the values and shows the text that will be written; it is inserted after the block the cursor is in (it replaces an empty line) as one undo step. Values are written exactly as typed in the form the template says, refused with the reason when they do not fit, and never rounded.
- **Program start on the Home tab** writes the first lines of a program in the dialect's own style (it replaces the old Program Header button).
- **49 built-in templates**, every one marked *Review pending* ("Not yet reviewed" in the tooltip, a note in the form): Fanuc mill (drilling, peck drilling, chip breaking, rigid tapping, boring), Fanuc lathe (tool start, roughing and finishing, threading, grooving, face drilling) with its own version for G-code system B, Heidenhain Klartext (cycles 200, 203, 207, 240, tool call, moves), Okuma (threading, LAP, face and driven-tool drilling) and Sinumerik turning and milling (`CYCLE81`–`84`, `CYCLE95`, `CYCLE99`).
- **Block numbers continue** from the nearest number above the cursor in the program's step, and stay off in an unnumbered program. In Klartext every block is numbered and the blocks behind the insertion are renumbered in the same edit. In the other dialects the blocks behind keep their numbers.
- **Templates in completion:** on a line with nothing before the word, type the start of a template's name (`peck`) and accept it with `Tab`; a template with values opens its form.
- **Favorites:** star the templates you use most; they form a first group on the Insert tab.
- **Edit Cycle…** (Insert tab, or the palette): the cycle at the cursor in a form of its parameters with the values as written. Only the words you change are rewritten, each in its own number form; nothing changed means nothing written; a cycle word you clear is taken out; Klartext `Q` lines and Sinumerik arguments are handled by their own rules. A lathe cycle written in two blocks (`G71`–`G76`), a position line under a modal cycle, and a value that is a variable are refused with the reason. With no cycle at the cursor it inserts a new one. One undo step.
- **Formula fields:** a field can be worked out from the others (the rigid tapping feed is the pitch times the speed). The language is small (`+ - * / %`, brackets, `abs floor ceil round sign sqrt ln log sin cos tan asin acos atan` in degrees), exact on decimal digits (`0.1 + 0.2` is `0.3`), rounded only to the field's own decimals, and never run as code.
- **Template manager** (*Manage Templates…*): the templates of the program's code set with a search box; the built-in ones read-only; **New**, **Duplicate**, **Change a copy** (a copy with the same id replaces the built-in template; deleting it brings the built-in back), **Delete**, move up and down, a text box with buttons for the block number, the system values and each field, a form for every setting of a field, and a live preview. **Save** checks everything, refuses all of it with the places of the problems when one is wrong, and then writes the `templates` list of your code file (`<config>/codes/`), through the file's tab with a backup and one undo step; a file with unsaved changes is refused. Closing the manager with unsaved changes asks first.
- **New Template from Selection…:** the selected lines become a draft in the manager; block numbers become the next block number, and you tick the numbers that should become values (a value written twice becomes one field). Codes, comments, calls and expressions stay as they are.
- **Your templates are in your code files** (`templates` list); an id that matches a built-in template replaces it, a template gEdit cannot read is left out and listed with its place in the file, and it never hides the built-in template.
- **Faster typing in large programs:** the modal index is now built in slices of 8 ms (was 16 ms), so a keystroke waits for at most one of them.
- **Code inspector** (`Cmd/Ctrl+Alt+A`, View tab, Panels, or the palette): a panel beside the Program Map that lists the words of the block at the cursor with what each one means, and what is in force after the block (motion, plane, distance, units, work offset, tool, spindle, speed, feed, coolant, compensation, active cycle), each with the line that set it. It is closed until you open it.
- **Assumed values say where the assumption comes from:** *machine*, *detected from the program* or *profile default*; *set here* marks what the block itself changed; a mode the program never set is shown as at power-on.
- **A number that depends on the machine** shows its effective value on the document's machine (`X50` is `0.05 mm` on an IS-B lathe), and with no machine it lists every reading and picks none.
- **Change a value from the inspector** (double-click or Enter on a row, or *Inspector: Edit Value at Cursor…* in the palette): you type the real value, gEdit writes it the way the machine reads it and keeps the form of the number, as one undo step.
- **A value is refused, with the reason, rather than guessed:** a number the word cannot hold exactly (nothing is rounded), a whole-number word given a decimal, a value outside the allowed range, a block or program number, a code, a call, a variable, a word that depends on a machine you have not chosen, and a locked document.
- **Cycle parameters** in the inspector: the parameters of the cycle a block starts, defines, calls or runs under, each with the value written or *not written*; a lathe cycle written in two blocks (`G76`) shows which block it is and the thread height.
- **Hover in context:** a cycle word shows a table of its parameters with the values written (a Klartext cycle defined over several lines included); an address word shows one line of context (target, absolute or incremental, diameter or radius, work offset, feed per minute or per revolution, thread lead, surface speed and its clamp); and a machine-dependent number shows its effective value and why, or every reading with *choose a machine*. Until the program has been read up to the line, the hover is the plain one.
- **Motion colours:** a narrow mark beside the line numbers in one of five colours, for rapid, straight feed move, arc, thread or tapping, and canned cycle. A line that moves nothing, a dwell, and a line whose motion mode the program never set get no mark. On by default; switch it off in View, Lines, *Motion Colors* or in Settings, Assistance, *Color lines by how they move*.
- **Keys:** `Cmd/Ctrl+Alt+A` shows or hides the inspector. On Windows and Linux some keyboard layouts use `AltGr+A` for a letter; the ribbon button and the palette do the same.
- **Reference returns read right:** the axis words of `G28` and `G30` are the intermediate point in the program's coordinates, absolute or incremental as the distance mode says (`G28 G91 Z0.` moves up from where the tool is); only `G53` reads them in machine coordinates. `G28`, `G30` and `G53` are colored as rapids.
- **Cycle values are not positions:** the depth of cut `U` of a lathe roughing cycle and the dwell time of `G04 X` or `U` are no longer called a diameter or an incremental move.
- **Sinumerik `MCALL`:** the `MCALL` line itself runs nothing and gets no mark; every positioning block after it is marked as the cycle (a tapping cycle as a thread), and the hover and the inspector say which cycle is in force.
- **Lathe single-pass cycles** (`G90`, `G94` in G-code system A; `G77`, `G79` in system B) are colored as cycles, and Klartext `F MAX` is a rapid like `FMAX`.
- **A Klartext cycle feed written as a word** (`Q206=FAUTO`, `Q208=+FMAX`) is shown as written, not as "not written"; the sign of `DR+` is read as a direction.
- **The note next to a feed names the code that gave it its unit** (an Okuma `G101 … F` is a feed per minute, never "set by `G95`"); a threading move in force (`G33`, `G32`) is called a thread pass and is no cycle row.
- **The two blocks of a lathe cycle** are recognised with up to three comment or blank lines between them, and the inspector and the hover use the same words for a number that counts in units of 0.01 mm; a tool, `D` or `H` number cannot be made negative.
- **The inspector keeps up while you type:** it and the colors no longer redraw for every slice of the index, a row you double-click or press Enter on opens its prompt once (not for the "line" link or a held key), the prompt opens with the value selected, and the focus stays on the row after an edit that changes the width of the word.
- **Big files:** a program that is only queued at start-up is not read or indexed until it is shown, and a profile, a code file or a script gets no index.
- **Repository:** an MIT `LICENSE` file, a `repository` field in the package metadata, Dependabot for GitHub Actions (weekly, one pull request), a placeholder app icon, and Close Window in the macOS menu shows its shortcut, Shift+Cmd+W.
- **Compare review mode, Cycle names** (Heidenhain Klartext only, off by default): leaves out the cycle name in the control's dialog language (`CYCL DEF 200 BOHREN` against `CYCL DEF 200 DRILLING`) and the label of an old numbered cycle (`V.ZEIT` against `DWELL` in `CYCL DEF 9.1 … 1.5`), so a program posted again in another language compares clean; the cycle number, the values and the parameter lines are still compared. Saved with the other review options.
- **Channels, set up for each machine** (Settings, Machines, a new *Channels* step): say whether the channels are sections of one program or one program for each channel, name them, and say which codes are the waits. You write the waits as a plain list, such as `M900-M999, M300`, and a live preview shows the codes you meant. A mistake gets a plain message that quotes the item. Nothing is switched on for a machine you did not set up.
- **The `P` word of a wait** is a dropdown with an example for each choice: path numbers (`P12`), a bit sum (`P3`), or no `P`, with what a wait without `P` means. A checkbox makes stops and ends (`M00`, `M01`, `M02`, `M30`) count as waits. **Advanced patterns** (regular expressions, with a link to the regex help page) stay closed unless you open them.
- **Presets, all marked *verify*:** Fanuc lathe with two or three paths (one file for each path, `P` as a bit sum or as path numbers), Okuma with two turrets in one program (`G13`/`G14`), and Sinumerik with two channels (`WAITM`, `WAITMC`, `SETM`, `CLEARM`). A preset is offered on the Channels step and applied only when you press *Use this preset*. They are starting points from the manuals; check them on a program of your machine that runs.
- **Try these settings on a program** (on the Channels step, and *Test Channel Rules on Document* in the palette): shows the sections, the waits and their partners that your settings find, before you save.
- **Channel item in the status bar:** the channel of the cursor, which file of a set you are in, and when the other file is open, not open, not found or could not be checked. Click it to jump to a channel, open the other channels, or assign a program to a channel by hand.
- **Program map for each channel:** each channel lists its tools and its wait codes, all its sections together in program order; lines that belong to no channel are under *Outside the channels*. A channel with more than 250 waits shows them as one entry with their number, so a huge program stays fast. A program without channels shows the map as before.
- **Next Sync Point and Previous Sync Point** (`Alt+F7`, `Shift+Alt+F7`) step through the waits of the channel the cursor is in, and start over with a message at the end.
- **Go to the Matching Mark** (`Mod+Alt+P`) jumps from a wait to the wait that answers it in the other channel, in the other tab when each channel is its own file. On macOS this key replaces the editor's *Preserve Case* key in the find box; the button still works.
- **Check Wait Codes** (Tools tab): lists the waits that do not fit: no answer in the other channel, a different count, a different order, a wait that names a path that does not exist, a Fanuc wait whose paths name different sets, and a wait outside every channel. Each row jumps to its line. A wait inside a loop is judged only as information, and what could not be checked is said so.
- **Tool list per channel:** on a program with channels the rows are grouped by channel and the list has a *Channel* column; with one file for each channel the list is for the file in front of you.
- **Split into Channel Documents** (NC tab): one new untitled document for each channel of a one-file program, for reading or printing. It is a one-way copy and writes no file.
- **Channels in scripts:** a script on a machine with channels sees `channels` in its context: the layout, the line ranges of every channel, the lines outside them and the waits. `gedit_nc` has helpers for it. A script on a program without channels runs unchanged.
- **Klartext `M98`** in code help: complete machining of open contour corners, for its own block only.
- **Dialect uncertain:** a program that fits none of the dialects well shows its guess with a question mark in the status bar (`Fanuc T?`) and says so once when it opens; the picker offers *Keep Fanuc (ISO) lathe (the guess)*, which remembers the choice for the file. Nothing is blocked. See [When gEdit is not sure](docs/user/dialects.md#when-gedit-is-not-sure).
- **Tool word by length** (Fanuc lathe, the new default of *Tool word: offset digits*): one or two digits are the station, three or four digits the station and a two-digit offset, five digits a two-digit station and a three-digit offset (`T12012` is tool 12); machines can still choose 3 + 2 (`T12345` is tool 123) or 2 + 3.
- **Sinumerik milling, Tool change** (Machines): `M6` loads the tool selected with `T` (default), or a `T` alone changes the tool for a machine set up that way; with no machine, a program that never writes `M6` is read the second way.
- **Channel presets:** Fanuc lathe with two paths tied by hand (waits without `P`), three paths named `<name>_<path>` with `M190-M199`, and two heads with `M100-M197` (where `M198` is no wait); Sinumerik with two channels in one archive file, files named `<name>_C1.MPF`, or tagged sections. All marked *verify*.
- **Wait-code hover:** on a machine whose channel settings list a code as a wait, the hover says *Wait code on this machine* and leaves out the code database's text, so `M198` is a wait where the machine says so.
- **Program checks at the end of a file:** a Klartext program with no `END PGM`, or an `END PGM` with another name, and a Sinumerik main program with no `M30`, `M2`, `M17` or `RET`, give one error on the last line; a Sinumerik subprogram is not judged.
- **Names read as names:** Klartext cycle and program names, `CALL PGM` paths and `FN 16:` text are text (no hover, Convert Case leaves them); Sinumerik jump targets are labels and `DEF` names variables; Okuma `CALL O<name>` names a program and `VTLL`/`VTLD` are variables; `;%_N_NAME_MPF` starts the program in the map.
- **New keywords:** Sinumerik `SBLOF`, `SBLON`, `DISPLOF`, `DISPLON`, `NORM`, `KONT`, `KONTC`, `KONTT`; Okuma `NOEX`, `DRAW`, `CLEAR`; the Klartext colon words `VCONST`, `VC` and `HSC-MODE`.
- **User profiles:** a profile of your own starts from one of the six or from another profile of yours and changes only what differs (folder, extension and content rules for detection, block numbering, outline rules, tool-call patterns, typing options). It is one JSON file in the `profiles` folder next to the settings, and a saved file is loaded at once, without a restart and without closing a document.
- **User code files:** a file in the `codes` folder adds your own G and M codes (a builder M-code table, say) to the hover and completion of a built-in set, or makes a set of its own that starts from a built-in one. An entry for a code that exists changes only the members it writes; write `"replace": true` to replace the entry whole. Every change of meaning is listed as a notice.
- **Profiles page** (Settings, Profiles; *Manage Profiles…* in the palette): your files with their problems, New Profile From…, New Code File, Open, Import, Export, Remove (asks first) and Reload.
- **Test Profile on Document** (Profiles page and Tools tab): shows what every rule of a profile finds on the open program, line by line, with the time each took, and which dialect would be detected; a rule that takes too long is stopped and said so.
- **A broken file is a row, not a crash:** the file, the place in it and the reason are shown on the Profiles page and in Results; everything else keeps working. Files are limited in size, count, nesting and pattern length, and a pattern that could run away is refused.
- **Your profile is picked on its own rules only:** when it and a built-in profile score the same, the built-in profile wins, whatever the priority; yours is chosen by its own folder, extension or content rules, or by hand (remembered for the file).
- **Machine import and export** (*Import Machines…*, *Export Machines…*, and buttons on the Machines page): move all machine configurations to another computer; imported machines get new ids and a name with ` (2)` where one exists, and a count of what was refused is shown.
- **Upper-Case Typing** (Home tab): a session switch for the profile's typing option.
- **Typing options on every control:** letters typed in code come out in upper case on all six built-in profiles, Klartext included; comments, strings and names (Klartext program and cycle names, Fanuc `<name>`, `MSG("…")`, `T="…"`) stay as typed. Not applied in `.json` and `.py` files.
- **Blocks are not joined by accident:** Backspace at the start of a line and Delete at the end of a line (also with Ctrl, Alt or Cmd) do nothing when both lines hold text. Empty lines can still be deleted, and a selected line break can be removed.
- **Scripts:** address arithmetic, scale feed and scale speed name a word whose number cannot be read (a dash pasted for the minus sign) instead of passing it over.
- **Check Wait Codes** shows the channel prefix of a mark in every message, and the count text reads "…, T2 has 1; both need the same number."
- **Renumber** tells you when a jump left as written now lands on another block, or on none.

### Changed

- **Fanuc mill, `Q` of the peck and shift cycles** (`G73`, `G76`, `G83`, `G84`, `G87`) is a length: a `Q` without a decimal point depends on the machine (input increments), so with no machine chosen the inspector lists every reading, and on a machine in IS-B `Q4000` is 4 mm. The lathe's `Q` is unchanged.
- **Fanuc mill:** in a block with two `T` words and `M6` (`T01 T00 M6`) the first `T` is the tool loaded, so the program map and the tool list show tool 1 there.
- **Sinumerik:** a program that never writes `G90` starts in absolute positions (assumed, a machine can say otherwise), so address arithmetic and extents read it instead of refusing every word.
- **Klartext:** cycle 19 and `PLANE SPATIAL`, `PROJECTED` or `EULER` with every angle at zero end the tilt, so address arithmetic and extents no longer treat the rest of the program as tilted.
- **Sinumerik:** a name alone in its block (`CYCLE800`, `HOME`) is read as a call, no longer as an unknown mark; `CYCLE800` alone ends the swivel like `CYCLE800()`.
- **Klartext:** the datum-table row of cycle 7 (`CYCL DEF 7.1 #5`, `#Q5`) is read as one word, no longer as an unknown `#`.
- **Code help** describes Klartext `M89` (the modal cycle call) and the Sinumerik `M6` (the tool change) instead of leaving them out as unverified.
- **Remove Spaces** is not offered on Sinumerik, whose names and long addresses need their spaces; on Okuma it keeps the space around a word such as `SB=1200`.
- **Change Dialect suggestion:** a Siemens milling program that writes `G97 S…` or `DIAMOF` is no longer suggested the turning dialect.
- **Detection of programs without a header:** an Okuma program with only numbered blocks and a `G13`/`G14`, `NOEX VTL…[` or `MT=1` marker opens as Okuma (a `G28` with an axis word or a `G15` alone in a block is Fanuc, and a `DEF` line with `MT=` is Siemens; a lone `G13`/`G14` is Okuma but not a certain marker, and `MT=`, `OS=` and `HP=` count only with a whole number); a header-less Siemens milling program with `Y` moves opens as Siemens milling; a five-axis Fanuc mill with `T1205 T1310 M6` is no longer taken for a lathe; a `$` comment line of another control no longer makes a file Okuma.
- **Five-digit `T` without a machine** is read 2 + 3 (`T12000` cancels, `T12012` is tool 12); before, it was read 3 + 2. A machine that chose *The last two digits* keeps 3 + 2.
- **A zero offset next to `M6` is a tool change** (`M06 T21000` loads tool 21), and a block with a three-digit `G` code (`G183 Z-5. T5`) has no tool change, except the control's own aliases (`G107`, `G112`, `G113`, `G250`, `G251`).
- **A tool part of zeros** (`T00100`, `T0001`; under 2 + 3 also `T0101`) keeps the tool and changes only the offset: no tool change on any setting.
- **Klartext, empty `CYCL DEF 19.1`:** ends the tilt, so address arithmetic and extents stop treating the rest of the program as tilted.
- **Fanuc:** the machine-builder range `M900-M999` is now named as one builder's range in the two- and three-path presets, and the `_<n>` file-name presets warn that a version file such as `SHAFT_2.NC` is read as a path too.
- **Convert Case to lower case asks first on every built-in profile** (before: only on Fanuc), because the control expects upper case.
- **Program checks, tool list and extents:** a subprogram written behind the main program is charged to no tool (it was charged to the main program's last tool); the extents label a tool as it is written (`T1 (T010101, line 9)`); a thread's `F` that is not its lead is said so; a feed range in another unit than the program's says which.

### Removed

- **The Phase 1 code blocks** (the *Program Header* button, the drilling block and the Klartext header on the Insert tab, and their `insert.block:*` commands) are replaced by the templates, which cover the same ground for all six dialects. There is no setting to bring the old blocks back.

### Fixed

- **Machine item tooltip, feed mode at power-on:** on a lathe program read as G-code system B with no machine chosen, the tooltip said G99 while naming the program as its source. It now lists G95, the feed mode the detected system powers up in.
- Switching tabs away from a very large program is cheap again.
- **Program checks:** `spindleOff` no longer reports the words of a cycle definition behind a bare `L` (`L CYCL DEF 32.1 T0.05`); `blockWords` accepts `T<a> T<b> M6` on the lathe profile; the Sinumerik end check skips an untitled document, a main program ending in an unconditional jump, a file that starts with a commented subprogram header (`;%_N_<name>_SPF`) and an archive's data section.
- **Klartext:** `TOOL CALL "name"` followed directly by a digit is a tool change; a tool number with more than one decimal is read as its whole number.
- When gEdit cannot look in the folder for the other channel file (the computer refuses it), the channel item says *could not be checked*, not *not found*.
- A machine of the same control can now be chosen for a mill or a lathe program whichever type it is; when the type differs, the machine picker, the status bar item and its hover warn that the machine's diameter and G-code system settings do not apply.
- A file that was plain ASCII and gets a character outside it (`Ø`, `°`) asks once at the first save: UTF-8, Windows-1252 or cancel; the answer is kept for that document.
- A file of more than 10 % NUL bytes opens read-only, with the reason in the status bar, instead of being refused; transforms and scripts do not run on it.
- A pattern in a machine's channel settings that could make gEdit hang on a long line is refused when you save it, with a plain message; lines over 1,000 characters are not read for channels and are counted in a problem.
- A very large program with thousands of waits no longer makes the program map, typing or the first reading of the channels slow: the map froze for seconds on every edit before, and now answers in a fraction of a second.
- When gEdit cannot read the channels in time, the status bar says *Channels: too slow to read* and Check Wait Codes says it did not check, instead of showing nothing.
- A machine whose channel settings are broken, or were edited by hand and are missing a part, no longer breaks the Machines page: it lists the problem, keeps the other machines usable, and leaves the broken record as it was.
- A Sinumerik `SETM` now answers a `WAITM` of its mark, a variable mark such as `WAITM(_M,1,2)` is read, and a Fanuc wait that is written with different paths in the two channels is reported.
- A wait in a loop, even with the label on the same line, is no longer reported as a count error.
- Go to the Matching Mark goes only to the channels a wait names, so on three paths `M901 P12` and `M901 P13` find their own partners.
- A wait list written as `M 900` or `M900 to M999` gets a plain message ("write a range with a dash") instead of a wrong reading.
- No more false alarms from the program checks: `T7 T8 M6` in one block, a bare Klartext `L`, a jump to a computed target (`GOTOF "STEP_"<<COUNTER`), a `%` in a Klartext comment, and the words of a message in a Fanuc block.
- A Klartext `TOOL CALL "END MILL 10"` with the name at the end of the line is now in the program map and the tool list.
- No more missing-word or alone-in-block rows on a line that the machine's channel settings count as a wait.

### Known limits

- **The installers are unsigned** (see "Installing an unsigned build" under v0.2.0).
- **The 49 built-in templates are marked "review pending".** They are written from the manuals and have not been checked against a real control. The same goes for the channel presets (marked *verify*) and for the defaults gEdit assumes until you set up a machine: they are starting points, so check them on a program of your machine that runs.
- **gEdit reads and writes text.** No backplot, simulation or 3D display; no DNC or machine communication; no program management.
- **Six dialects.** Milling on an Okuma control is not covered: such a program opens with the Okuma turning profile, which reads some of its codes wrongly. A program for any other control opens with the profile that fits best, marked as a guess.
- **Channels are read, not run.** A clean wait-code check is no proof that the program runs on the machine. Showing two channels side by side is not there yet; Split into Channel Documents makes copies for reading only.
- **A profile of your own describes; it does not compute.** It changes how a dialect's programs are recognised, numbered and explained and what typing does; it cannot run code.
- **Left for later:** advanced renumber options, word-level marking in compare, bookmark names, selecting or extracting a block range, insert and append file and per-profile colours. A numeric tolerance in compare is cut.
- Python 3.9 or newer is needed for the script features only; without it those commands are disabled with a message, and everything else works. Scripts are ordinary programs running with your rights, and gEdit cannot sandbox them. Run only scripts you have read and trust.
- On Windows and Linux, logging out or shutting down skips the unsaved-changes prompt; the half-minute snapshot is what catches that work.
- Every text in the program is English.

The [user guide](https://github.com/NC-PB/gEdit/blob/v1.0.0/docs/user/README.md#what-gedit-does-not-do) lists the limits in full.

## v0.5.0 (2026-10-05)

Compare and search: this release makes a re-posted program comparable without numbering noise, merges the differences in both directions, and finds and replaces any word by its value. The installers are unsigned, as before; see "Installing an unsigned build" under v0.2.0.

### New

- **NC-aware search and replace** (Home tab, *Search*; `Mod+Shift+F` for Find All): the form reads each line the way the dialect does, so it knows a comment from a block.
- A **word query** finds an address by its value as written: `G1` finds `G01` and `G1.` but not `G10`; `T01` finds `T1`; `S>12000` and `X<=-5.5` are conditions; `SB=500` and `S1=` work on Okuma and Sinumerik; `Q206` finds a variable. A word is never found in a comment or a string.
- **Whole address** finds every use of an address; **Regular expression** and plain text work as in the editor, with the text also searched in comments when you tick *Also in comments*.
- **Scope:** the active document or all open documents; the hits go to the Results panel with a count, and a click jumps to the line.
- **Program-number references:** `O2000` finds the program and the calls that name it (`M98 P2000`, `G65 P2000`, the macro calls), including the packed Fanuc form `M98 P52000`.
- **Replace All** changes the hits in place or into a new tab, as one undo step, and says how many it changed. A word typed without a value replaces only the address and keeps the value.
- **Find Whole Address** puts the pattern of an address into the editor's own find box, so you can step through the hits.
- **Compare review mode:** compares the program as the control reads it, not as it is spelled. Five options (block numbers, whitespace, comments, case, number format), each profile with its own defaults, and what review mode will not hide is kept and noted in the bar: a block number that a jump points at, a decimal point the machine reads, a comment the control shows the operator.
- **Merge in both directions:** `Mod+Alt+Right` copies the difference at the cursor into the current document, `Mod+Alt+Left` into the original. Each copy is one undo step; a copy refuses while the comparison is still updating.
- **Export Differences** writes the differences as a unified diff into a new tab, raw or from the review mode text.
- **Compare Two Files** (Tools tab) opens two files from disk and compares them.
- **Saved options:** the compare mode and the changed review options are remembered per profile across sessions.
- **Regular expressions** help page in the user guide, with NC examples, the differences between the editor's flavour and Python's, and what to do about a slow pattern.

### Fixed

- Closing a comparison while the diff is still updating no longer races: the temporary models are reused and filled only while the diff editor is detached.
- Sinumerik `GOTOF :200` and `GOTOF 200` now count as references to the block, so Renumber follows them and review mode keeps the number; a jump to a name that is no label (`GOTOF WERKZEUG`) is reported, not guessed.
- Okuma `MSG` and `G215` comments are kept by review mode, since the operator sees them.
- Fanuc mill `G70.7` to `G73.7` are references to the contour blocks they name; `M198 P` names a program.
- Klartext `IX+10` is its own address in search, so a search for `X10` no longer finds or changes it.

## v0.4.0 (2026-10-05)

Check before the machine: this release adds the checks you run on a program before it goes to the machine, and makes the daily position edits safe. The installers are unsigned, as before; see "Installing an unsigned build" under v0.2.0.

### New

- **Program checks** (Tools tab): a report of what would stop or harm a program at the machine, each check switchable: a cut with the spindle stopped or never started, a tool change without a spindle start or inside a cycle, the `M0`/`M1` stops, the program's start and end, a number whose meaning depends on the machine (`X50` without a decimal point), and the rules the control manuals make certain for each dialect. Every row jumps to its line.
- **Extents** (Tools tab): the minimum and maximum of every axis, per tool and for the whole program, in real values: a lathe's X as a diameter, arcs included, incremental moves resolved, work offsets and coordinate shifts kept apart, machine-coordinate moves listed separately. A value gEdit cannot be sure of is counted as "not resolved", never guessed.
- **Address arithmetic** (Tools tab): add, subtract, multiply or divide chosen addresses, for example a Z shift. Hole depths inside drilling cycles move with the shift (Fanuc `R`, Klartext `Q203`, Sinumerik `RTP`/`RFP`/`DP`). Cycles whose positions gEdit cannot judge, unknown calls, incremental and machine-coordinate blocks, a tilted plane, and rotary moves without tool centre point control are left as written and listed, never shifted in part. A Klartext pole `CC` moves with the polar moves around it; Sinumerik `I=AC()`/`J=AC()` arc centres and `CIP` points move with their arcs.
- **Block skip** (NC tab): insert or remove `/` on the selected blocks, with the level where the control has levels; a block is never marked twice, and a `/` that divides is never touched.
- **Select Tool Segment** (`Mod+F7`): selects the tool at the cursor from its tool change to the next.

### Changed

- On a Sinumerik, `S1=` counts as the main spindle in the tool list too.

## v0.3.0 (2026-10-04)

Real programs read right: this release is about gEdit reading the owner's published programs the way the machines read it, so that every later feature (checks, extents, a Z shift, compare) works on the right values. The installers are unsigned, as in v0.2.0; see "Installing an unsigned build" under v0.2.0.

### New

- **Sinumerik milling.** A new built-in profile, "Sinumerik milling": `M6` is the tool change and a `T` alone only preselects the next tool, so the program map and the tool list show one row per tool with its own feeds and speeds. The plane and feed at power-on are `G17`/`G94`, and diameter programming is off. A Siemens program with any turning word (`DIAMON`, `LIMS=`, `SETMS`, `TRANSMIT`, a spindle written as `S3=`) stays on the turning profile, so mill-turn programs read as turning.
- **5-axis and high-speed codes** in the code help for Fanuc and Klartext: tool centre point control, tilted working planes, polar and cylindrical interpolation, the Klartext cycles 7, 8, 9, 10, 11, 19, 26 and 247, and the `PLANE` forms. No more "unknown code" on a typical 5-axis or 3+2 program.
- **Machine settings for Fanuc lathes and Okuma:** whether `U`/`W` (and `V`/`H`) are incremental, and how a tool word splits into tool and offset (Fanuc: the last one, two or three digits; Okuma: two or three digits, two by default). The defaults read programs exactly as before.

### Read correctly now

- Fanuc macro functions and print commands (`FIX[`, `POPEN`, …), Okuma words such as `TL=` and four-digit option M codes, Sinumerik main blocks (`:20`), indexed words (`LIMS[2]=`), numbers like `1.5EX3`, several skip levels on one block (`/1 /3`), and the Klartext `PLANE`/TCPM words are each one word, not a string of address letters.
- `A`, `B` and `C` are angles on the Fanuc mill (`C90000` is 90°). A tap's feed follows the feed unit in force. Feeds without a decimal point follow the machine's number setting.
- A Y-axis lathe with five-digit tool words opens as a lathe, not a mill.

### Safer edits

- **Renumber** keeps a Sinumerik main block's colon (`:20` becomes `:110`) and rewrites the jumps to it (`GOTOB :20` and `GOTOB:20`); a block with several skip marks gets exactly one number. Remove Block Numbers keeps a main block that a jump names.
- **Scale Feed:** the "Only feeds above/below" filters never scale a feed they cannot compare (a feed in the other unit, or one without a value because no machine is chosen); such a feed is left and reported. The limits are given in one feed unit, chosen in a new field. A Fanuc-lathe `G71`/`G72`/`G73` with an `F` but no `P` is left alone while no machine is chosen, because on an Okuma that `F` is a thread lead. A Sinumerik `G931` feed (a travel time) is left and reported.
- **Scale Spindle Speed** never scales a lower speed limit (Sinumerik `G25`).
- **Remove Comments** keeps Sinumerik's `;$PATH=` line. **Save As** to another extension re-detects the dialect, unless you chose the dialect by hand.

### Known limits

As listed under v0.2.0, except that Sinumerik milling is now covered. Okuma milling (machining centres) still opens with the turning profile.

## v0.2.0 (2026-10-01)

The first release with installers for macOS, Windows and Linux, and the first with release notes (v0.1.0 was a Windows-only build without notes). The lists below describe gEdit as it is now, not only what is new. It is an editor for the output of a CAM post-processor: open the program, find your way around it, clean it up, renumber it, scale the feeds, list the tools, compare it with the last version, and save it without changing a byte you did not ask to change. It works offline, and Python is needed only for the script features.

**These installers are not signed.** Your system will warn you the first time; see "Installing an unsigned build" below for the one step each system needs. Checksums are in the `SHA256SUMS` file attached to the release.

### What you can do

**Open and save programs safely**

- Open several files at once, in tabs, by dialog or by drag and drop. A file that is already open is brought forward instead of being opened twice.
- Encoding (UTF-8, UTF-8 with BOM, UTF-16, Windows-1252), line endings and the punched-tape NUL leader and trailer are detected and written back unchanged. A program you open and save without editing is byte for byte the file you started with.
- Unsaved changes are marked and asked about before they are lost, including when you quit from the Dock on a Mac. A file changed on disk by the CAM system is noticed while you work.
- Before a save overwrites a file, the version on disk is copied aside, by default into a history of five versions in gEdit's own data folder. If that copy cannot be made you are asked; gEdit does not save silently without it.
- Unsaved work is snapshotted every half minute and whenever the window loses focus, so after a crash or a power cut it is offered back the next time you start. Restoring only reopens the text; nothing on disk is written until you save. A file that changed on disk since the snapshot is flagged so you can compare first.
- Your tabs come back the next time you start, each file with its cursor, its bookmarks and a dialect or machine you chose by hand.
- A file you may not write opens locked, and Save goes to Save As. You can also lock a tab yourself to keep your keystrokes out of a proven program.

**Five dialects**

- Fanuc (ISO) mill, Fanuc (ISO) lathe, Heidenhain Klartext, Okuma OSP lathe and Sinumerik 840D turning. The dialect is detected from the extension and the content and can be changed in the status bar.
- Fanuc lathe: turret tool changes, the lathe meanings of the cycle and threading codes, `U`/`W` incremental and `X` as a diameter, G-code systems A and B.
- Okuma OSP: sequence names, four- and six-digit turret tool words, `CALL`/`RTS`, and the machine's unit system.
- Sinumerik 840D turning: `;` comments and strings, labels, cycle calls, tools by number or by name, and diameter programming on from the start.

**Machine configurations**

- Tell gEdit once how your control reads a number: whether `X50` is millimetres or the smallest input increment (on an Okuma, which unit system every number is counted in), which G-code system a lathe uses, whether `X` is a diameter, and what is already in effect when a program starts. Pick one machine per file.
- Without a machine, gEdit says which defaults it is assuming, and where the possible readings disagree it refuses to convert rather than guess.

**Reading a program**

- Syntax highlighting, a program map of tool calls, sections, comments, labels, stops and subprogram calls, go to line or block number (`Ctrl+G`), next and previous tool change (`F7`), bookmarks, folding and a sticky section heading.
- Hover help and completion from a code database written for the subset of code CAM systems emit.

**NC transformations**

- Renumber blocks, remove block numbers, insert or remove the spaces between words, remove empty lines, remove comments (keeping the program name and, if you ask, your header), convert case. Each runs on the selection or the whole program, is one undo step, and lists in a Results panel every line it refused to touch and why.
- Renumbering rewrites the jumps, subprogram calls and cycle references whose target block it can prove, and asks before it leaves one behind. Removing block numbers keeps the numbers something points at.

**Compare**

- Compare the document with the version on disk, another tab, or any file, side by side or inline.

**Python scripts**

- Run a script over the program or the selection. Its result can replace the input as one undo step, open in a new tab, or come back as a clickable table of findings. Parameters declared in the script become a form. Runs have a time limit and a Stop button.
- Three scripts ship with the app: scale feed rates, scale spindle speeds, and tool list. They work on all five dialects and use the same contract as a script you write yourself.

**Everything else**

- Ready-made code blocks (program header, drilling cycle) for Fanuc mill and Klartext; light, dark or system theme; a settings dialog; recent files; a command palette (`F1`) and a shortcut list.

### Things to know about the new behaviour

- **Detection that cannot wreck a program.** A header that only one control writes (`BEGIN PGM` on a numbered block, a `%_N_` or `;$PATH=` line, a `$NAME.MIN%` line) settles the dialect on its own, and an Okuma extension no longer outvotes clear Fanuc content. When a program's content contradicts its dialect, the NC transformations that could damage it and the scripts that replace the text refuse to run, and say why.
- **Tap speeds are left alone.** Scale Spindle Speed does not change the `S` of a tapping block (or of a tapping cycle), nor the `S` in force when a tapping block has none of its own. It reports them instead. Thread feeds are still scaled, with a warning.
- **Named Fanuc programs.** A program name in angle brackets, `<NAME>`, is one token: its line is never numbered, no digit inside it is scaled, a `T` in it is no tool change, and `M98`/`G65 <NAME>` calls appear in the program map.
- **The Klartext decimal comma.** A number written with a comma is read everywhere and written back with its comma.
- Feeds under a G code the database does not know are reported rather than scaled; the arguments of `G65`/`G66` and the data of `G10` are left alone. A five-digit Fanuc lathe `T` word is read as a 3-digit tool and a 2-digit offset; on a Sinumerik the main spindle is spindle 1.

### Windows

- One spelling per path: a file opened as `c:\x`, `C:/x` or `\\?\C:\x` is one tab. Long file names work in the backup history, Windows device names (`CON`, `NUL`, …) are refused as file names, and the Python lookup never takes the Microsoft Store placeholders that a clean Windows has on its `PATH`.

### Known limits

- **The installers are unsigned** (see below).
- Milling on an Okuma or a Siemens control is not covered yet. Such a program opens with the Okuma or Sinumerik turning profile, which reads some of its codes wrongly (a preselected tool shows as a tool change, for example). A Sinumerik milling profile is planned for the next release.
- The Insert tab has ready-made blocks for Fanuc mill and Klartext only.
- No backplot, simulation or 3D display; no DNC or machine communication; no program management.
- Python 3.9 or newer is needed for the script features only. Without it those commands are disabled with a message; everything else works.
- Scripts are ordinary programs running with your rights, and gEdit cannot sandbox them. Run only scripts you have read and trust.
- On Windows and Linux, logging out or shutting down skips the unsaved-changes prompt; the half-minute snapshot is what catches that work.
- Every text in the program is English.

The [user guide](https://github.com/NC-PB/gEdit/blob/v0.2.0/docs/user/README.md#what-gedit-does-not-do) lists the limits in full.

### Installing an unsigned build

These builds are not signed or notarized, so each system asks you to confirm once that you want to run them. Check the download against `SHA256SUMS` first if you like (`shasum -a 256 <file>` on a Mac, `sha256sum <file>` on Linux, `certutil -hashfile <file> SHA256` on Windows).

- **macOS** (one `.dmg` for Apple Silicon and Intel). Drag gEdit to Applications and try to open it; macOS will refuse. Then go to **System Settings > Privacy & Security**, scroll down to the message about gEdit and click **Open Anyway**, and confirm. You only have to do this the first time. (On macOS 14 and earlier, right-clicking the app and choosing **Open** works as well; macOS 15 removed that.) If macOS offers no **Open Anyway**, run `xattr -dr com.apple.quarantine /Applications/gEdit.app` in Terminal once, and open the app again.
- **Windows** (`.msi` and `-setup.exe`). When SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. If Smart App Control is on (Windows 11), Windows blocks unsigned installers outright and offers no such button; this build cannot be installed on such a machine until it is signed.
- **Linux** (`.deb`, `.rpm`, `.AppImage`). Install the `.deb` or `.rpm` with your package manager. For the AppImage, make it executable (`chmod +x gEdit_*.AppImage`) and run it. If the AppImage does not start, install FUSE 2 (`sudo apt install libfuse2`, or `libfuse2t64` on Ubuntu 24.04), or use the `.deb` or `.rpm`.

## v0.1.0 (2026-07-06)

A Windows-only build (`.msi` and `-setup.exe`), published without release notes. v0.2.0 replaces it.
