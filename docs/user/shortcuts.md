# Keyboard

**Cmd** is written below for macOS and **Ctrl** for Windows and Linux; where the table
says `Cmd/Ctrl`, use the one for your machine. Plain `Ctrl` means the Control key on every
platform, macOS included.

The same list, with the keys as they are on the machine you are sitting at, is in the
program: **View ▸ Keyboard Shortcuts**. That dialog is generated from the commands
themselves, so if it ever disagrees with this page, it is right and this page is stale.

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

Close All, Open Recent, Clear Recent Files, and the three status-bar pickers (dialect,
encoding, line ending) have no shortcut — they are on the Home tab, in the palette, or in
the status bar.

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
| `Cmd/Ctrl+F2` | Set or clear a bookmark |
| `F2` / `Shift+F2` | Next / previous bookmark |
| `Cmd/Ctrl+Shift+O` | Quick outline — jump to a tool call or section |

`Ctrl+G` is the Control key even on a Mac, because `Cmd+G` is "find next" and because
`Ctrl+G` is the combination the controls themselves use. Clear Bookmarks has no shortcut.

**Two editor defaults were taken over:** `F2` and `Cmd/Ctrl+F2` are bookmark keys here,
not rename and rename-all. Selecting every occurrence of a word is still
`Cmd/Ctrl+Shift+L`.

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

## NC

Nothing on the NC tab has a shortcut: renumbering and the cleanups are deliberate,
one-at-a-time operations and are reached from the ribbon or from `F1`. See
[transformations.md](transformations.md).

## Scripts

| Keys | |
|---|---|
| `F9` | Pick a script and run it |
| `Cmd/Ctrl+F9` | Run the last script again, straight away, with the values you used last time — it does not open the parameter form |

**Stop**, **New Script**, **Copy to My Scripts**, **Edit Script**, **Rescan** and
**Add Folder** are on the Tools tab and in the palette. See [scripts.md](scripts.md).

## Compare, settings, help

| Keys | |
|---|---|
| `Cmd/Ctrl+Alt+C` | Compare with… |
| `Cmd/Ctrl+,` | Settings |

Next and previous difference, the inline view and closing a comparison are buttons in the
comparison itself. `About gEdit` and this shortcut list are on the View tab.

## Custom shortcuts

Not in this version. The keys above are fixed; being able to change them is planned for a
later phase.
