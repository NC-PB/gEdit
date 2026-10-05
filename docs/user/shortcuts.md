# Keyboard

**Cmd** is written below for macOS and **Ctrl** for Windows and Linux; where the table
says `Cmd/Ctrl`, use the one for your machine. Plain `Ctrl` means the Control key on every
platform, macOS included.

The same list, with the keys as they are on the machine you are sitting at, is in the
program: **View ▸ Keyboard Shortcuts**. That dialog is generated from the commands
themselves, so for every key gEdit assigns — everything on this page except the Editing
table and Quick outline — it is right, and this page is stale if the two ever disagree.
The editing keys come with the editor component: the dialog lists those commands without
a key, and the keys work all the same.

**F1** opens the command palette, which finds any command by name — including the many
that have no shortcut at all.

On a Mac laptop the F-keys may need the `fn` key, depending on your keyboard settings.

## Files

| Keys | |
|---|---|
| `Cmd/Ctrl+N` | New |
| `Cmd/Ctrl+O` | Open… |
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+Shift+S` | Save As… |
| `Cmd/Ctrl+Alt+S` | Save All |
| `Cmd/Ctrl+W` | Close the tab |
| `Cmd/Ctrl+Shift+W` | Close the window |

Close All, Open Recent…, Clear Recent Files, Lock Against Editing, Show Recovered Work,
Manage Machines…, Open Machines File and the four status-bar pickers (dialect, machine,
encoding, line ending) have no shortcut. All of them are in the palette; Open Recent and
Clear Recent Files are also in the Home tab's Recent list, and the pickers are in the
status bar. Lock Against Editing has no key on purpose: an accidental one would look like
a broken keyboard.

## Tabs and panels

| Keys | |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Cmd/Ctrl+Alt+O` | Switch tab… (pick from a list) |
| `F1` | Command palette |

The side panel, the bottom panel, the Output panel, the display switches and the zoom are
on the View tab, without shortcuts.

## Moving around the program

| Keys | |
|---|---|
| `Ctrl+G` | Go to line or block — type `120` for the line, `N120` for the block |
| `F7` / `Shift+F7` | Next / previous tool change |
| `Cmd/Ctrl+F7` | Select the lines of a tool: the segment the cursor is in, or the tool you pick — see [Tool segments](transformations.md#tool-segments) |
| `Cmd/Ctrl+F2` | Set or clear a bookmark |
| `F2` / `Shift+F2` | Next / previous bookmark |
| `Cmd/Ctrl+Shift+O` | Quick outline — jump to a tool call or section |

`Ctrl+G` is the Control key even on a Mac: `Cmd+G` is "find next" there, and `Ctrl+G` is
the editor component's own key for going to a line, which gEdit takes over so that it
finds a block number too. Clear Bookmarks has no shortcut.

**Two editor defaults were taken over:** `F2` and `Cmd/Ctrl+F2` are bookmark keys here,
not *Rename Symbol* and *Change All Occurrences*. Selecting every occurrence of a word is
still `Cmd/Ctrl+Shift+L`.

## Editing

These come from the editor component and are the ones you already know:

| Keys | |
|---|---|
| `Cmd/Ctrl+Z` | Undo — one press undoes a whole transformation or script run |
| `Cmd+Shift+Z` (macOS), `Ctrl+Y` (Windows, Linux) | Redo |
| `Cmd/Ctrl+F` | Find |
| `F3` / `Shift+F3`, or `Cmd+G` / `Cmd+Shift+G` on macOS | Find next / previous |
| `Ctrl+H` (Windows, Linux), `Cmd+Alt+F` (macOS) | Replace |
| `Cmd/Ctrl+A` | Select all |
| `Cmd/Ctrl+Shift+L` | Select every occurrence of the selection |
| `Cmd/Ctrl+/` | Comment or uncomment the line, in the dialect's own comment syntax |
| `Alt+Up` / `Alt+Down` | Move the line up or down |
| `Shift+Alt+Down` (`Ctrl+Shift+Alt+Down` on Linux) | Duplicate the line |
| `Cmd/Ctrl+Shift+K` | Delete the line |

Upper case, lower case, folding and the zoom are buttons on the Home and View tabs.

## Search

| Keys | |
|---|---|
| `Cmd/Ctrl+Shift+F` | Find All… — every hit of an address, a value or some text, in a list in the Results panel |

**Replace All…** and **Find Whole Address…** have no shortcut; they are on the Home tab (*Search*)
and in the palette. See [Searching](README.md#searching). `Cmd/Ctrl+F` and the replace keys in
the Editing table are the editor's own find box, which takes a [regular expression](regex.md)
too.

## NC

Only one command on the NC tab has a key: **Select Tool Segment**, `Cmd/Ctrl+F7`, listed
under [Moving around the program](#moving-around-the-program). Renumbering, the cleanups and
Insert and Remove Block Skip are deliberate, one-at-a-time operations and are reached from
the ribbon or from `F1`. See [transformations.md](transformations.md).

## Scripts

| Keys | |
|---|---|
| `F9` | Pick a script and run it |
| `Cmd/Ctrl+F9` | Run the last script again, straight away, with the values you used last time — it does not open the parameter form |

**Run Script**, **Stop**, **New Script**, **Edit Script**, **Rescan** and **Add Folder**
are on the Tools tab and in the palette; so is each bundled script, **Program checks**,
**Extents** and **Address arithmetic** included. **Copy to My Scripts** is in the palette only;
**Edit Script** on a bundled script offers the same copy (*Copy and edit*). See
[scripts.md](scripts.md).

## Compare, settings, help

| Keys | |
|---|---|
| `Cmd/Ctrl+Alt+C` | Compare with… |
| `Cmd/Ctrl+Alt+Right` | Copy Change to Current Document — while a comparison is open: the other side's version of the difference goes into your document |
| `Cmd/Ctrl+Alt+Left` | Copy Change to Original — while a comparison is open: your version goes into the other side |
| `Cmd/Ctrl+,` | Settings |

Next and previous difference (the arrow buttons), the inline view, the **Raw** and **Review**
buttons (the command is called Review Mode), the copy buttons ← and →, Export Differences… and closing
a comparison are buttons in the comparison itself; **Compare Two Files…** is on the Tools tab. None of them has a key,
and all are in the palette. See [Comparing two programs](README.md#comparing-two-programs).
On Windows and Linux some graphics drivers and desktops take `Ctrl+Alt+Arrow` for
themselves (they rotate the screen, or switch the workspace); if the copy keys do nothing,
that is the reason, and the buttons in the comparison do the same. `About gEdit` and this shortcut list are on the View tab.

## Custom shortcuts

Not in this version. The keys above are fixed; being able to change them is planned for a
later phase (Phase 4 of the roadmap).
