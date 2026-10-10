# Settings and UI

Preferences, where they are stored, themes, keyboard shortcuts and the principles for the UI layout. Per-dialect settings live in profiles ([dialect-profiles.md](dialect-profiles.md)). This page only covers how they are edited.

Tag format: `Priority · Size · Delivery`.

> **Status.** Design note from 2026-09-19. What shipped is described in the user guide ([Settings](../user/README.md#settings), [Shortcuts](../user/shortcuts.md), [Where things are](../user/README.md#where-things-are), [The window](../user/README.md#the-window)); where this note and the guide differ, the guide is right. Status per section: the storage layout, a settings dialog (seven pages, no search box), light/dark/system theme, default shortcuts, window state, session restore and per-file memory shipped in Phase 1 and Phase 2. Not built: user-rebindable shortcuts, the role color editor, a settings search box, full configuration export and relocation, UI translations (all in the Phase 4 table of the [roadmap](roadmap.md)). Cut in Phase 2: a global viewer mode and external commands (so neither is a setting).

## Storage layout
`P1 · S · Core`

**Status:** shipped in Phase 1, extended in M6 (`machines.json`) and M7 (`backups/`).

All configuration is human-readable JSON in the Tauri app config directory (`appConfigDir()`). Machine-written state goes in the app data directory, so the config files stay clean for backup and sharing.

```
<config>/
  settings.json        global preferences (only values that differ from defaults)
  machines.json        machine configurations
  profiles/*.json      user dialect profiles
  codes/*.json         user code dictionary entries and templates
  scripts/             user scripts (created on first start)
  .window-state.json   window size and position
<data>/
  state.json           recent files, panel sizes, session, per-file cursor and bookmarks, last parameters
  backups/             the copies made before a save
  recovery/            auto-saved copies of modified buffers
```

The plan also had `keybindings.json` (user shortcut overrides) and `packages/` (script packages); neither exists. `machines.json`, `backups/` and the window-state file were added later. The user guide's [Where things are](../user/README.md#where-things-are) is the current list.

- Defaults are in code, not copied into `settings.json`, so new defaults reach existing users.
- Invalid JSON never blocks startup. gEdit starts with defaults and shows which file failed and why.
- Writes are atomic (write to a temp file, then rename).

## Settings dialog
`P1 · S · Core` (basic page) · `P2 · M · Core` (full dialog)

**Status:** see the bullets: the basic page and a paged dialog shipped; the search box and per-field reset were not built.

- **P1 (shipped):** a dialog for the most needed options: theme, font, font size, tab width, Python interpreter, script folders, recent-files length. There is also "Open settings file" for everything else.
- **P2 (shipped as pages, without a search box):** a category list on the left and the form on the right, seven pages (Appearance, Editor, Assistance, Files, Scripts, Machines, Profiles). The settings are validated when `settings.json` is read, in code; a JSON Schema and a search box were not built (Phase 4 table of the roadmap).
- Changes apply when the user presses Save. Cancel discards them. Each category has "Reset to defaults" (with confirmation). A single field can be reset from its context menu.
- The profile list is a page of the same dialog (Profiles, M13), and so is the machine list (Machines, M6); both are records or files of their own, not settings ([dialect-profiles.md](dialect-profiles.md#profile-editor)). Changes apply on Save and Cancel discards them.

## Settings reference

The table is the plan; the *Shipped* column says what the dialog has now (the guide's [Settings](../user/README.md#settings) has the exact fields).

| Category | Settings | Priority | Shipped |
|---|---|---|---|
| Appearance | Theme (system/light/dark), editor font and size, UI font size, [role colors](#themes-and-colors) | P1 (theme, font), P2 (colors) | theme, editor font and size; the UI font size and the role colors are not built |
| Editor | Tab width, insert spaces on Tab, show whitespace, rulers, highlight current line, word wrap, minimap, line numbers, drag and drop of text (off by default: accidental drags reorder blocks), copy the whole line when nothing is selected | P1 | all but rulers, which are a key of the settings file only; sticky scroll was added |
| Assistance | Hover help on/off, completion auto/manual/off, code inspector panel on/off, assistant master switch ([code-assistant.md](code-assistant.md#code-inspector-panel)) | P1 (hover, completion), P2 (panel) | hover, completion, and colouring the lines by motion. The inspector panel is opened from the View tab, and there is no master switch |
| Files | Recent-files length, restore last session, remember cursor per file, default profile for new documents, reaction to external changes (ask/reload), backup on save (off/one/N copies), recovery auto-save interval, ~~open read-only for all files (viewer mode)~~, "All files" as the default open filter | P1 (recent, external changes), P2 (rest) | shipped except the viewer mode (cut) and the open filter (the dialog always offers All files) |
| Profiles | List and editor of dialect profiles | P2 | a Profiles page with a test of a profile on the open program (M13); the form editor is Phase 4 |
| Machines | (not in the plan) the machine configurations | | shipped (M6) |
| Scripts | Python interpreter path, script folders, default timeout, show bundled scripts | P1 | shipped |
| ~~External commands~~ | List of commands | P2 | cut in Phase 2 ([scripting.md](scripting.md#external-commands)) |
| Compare | Default view (side-by-side/inline). Ignore options are per profile. | P2 | not a page: the compare options are in the comparison itself and are remembered per dialect |
| Keyboard | [Shortcut overrides](#keyboard-shortcuts) | P3 | not built (Phase 4); *View ▸ Keyboard Shortcuts* lists the fixed keys |
| General | Confirm before quit (the unsaved-changes prompt always appears regardless), full path in window title, update check (off by default), UI language | P2, P3 (language) | not built; the interface is English only |

## Themes and colors
`P1 · S · Core` (light/dark/system) · `P2 · M · Core` (role color editor)

**Status:** light/dark/system shipped in Phase 1; the role color editor and per-profile colors are deferred to Phase 4.

- Theme follows the OS by default, with a manual override (shipped in Phase 1; the Phase 0 editor was fixed to `vs-dark`). Both the app chrome (CSS variables, already used by the ribbon and panels) and Monaco switch together.
- Syntax colors are defined per token role ([dialect-profiles.md](dialect-profiles.md#tokenizer-and-colors)) with a light and a dark palette. P2 adds an editor: a color picker per role with a live preview and reset per role. Per-profile overrides are edited on the profile page.
- Fixed UI roles in the same palette: selection, current line, bookmark, find match, compare inserted/removed/changed, finding severities.
- Contrast of every default role color is checked against its background (WCAG AA) in both themes.

## Keyboard shortcuts
`P1 · S · Core` (defaults, shown everywhere) · `P3 · M · Core` (user rebinding)

**Status:** the default keys shipped in Phase 1 and later; user rebinding (`keybindings.json`, an editor with conflict warnings) is deferred to Phase 4.

Principles:

- Platform-aware modifiers: Cmd on macOS, Ctrl elsewhere. Tooltips and the command palette show the shortcut in platform form.
- Every command is registered as a Monaco action, so it appears in the command palette (F1) with its shortcut.
- Do not break Monaco defaults users expect (find, replace, go to line, multi-cursor, move/copy line, comment toggle). NC navigation uses function keys, which Monaco mostly leaves free.
- P3: `keybindings.json` overrides (command id → key), plus an editor in the settings dialog with conflict warnings.

Proposed defaults (as planned; the shipped keys are in the [user guide](../user/shortcuts.md), and where this table differs the guide is right. The main differences: go to line or block number is `Ctrl+G` on every platform, because `Cmd+G` is find-next on macOS; toggle bookmark is `Mod+F2`; select tool segment, quick outline, Save All, switch tab, Find All and the sync-point keys were added):

| Command | Shortcut |
|---|---|
| New / Open / Save / Save As | Mod+N / Mod+O / Mod+S / Mod+Shift+S |
| Close tab / next tab / previous tab | Mod+W / Ctrl+Tab / Ctrl+Shift+Tab |
| Go to line or block number | Ctrl+G on every platform (replaces Monaco's go to line) |
| Next / previous tool change | F7 / Shift+F7 |
| Toggle bookmark / next / previous | Mod+F2 / F2 / Shift+F2 |
| Run script… / run last script | F9 / Mod+F9 |
| Compare with… | Mod+Alt+C |
| Toggle code inspector panel | Mod+Alt+A |

`Mod+F2` and `F2` replace Monaco's "select all occurrences" and "rename" bindings. Rename is unused for NC code, and select all occurrences stays available as Mod+Shift+L.

## Session and state
`P1 · S · Core` (recent files, window state) · `P2 · S · Core` (session restore, per-file memory)

**Status:** window state in Phase 1; session restore and per-file memory in M7.

- Window size, position and maximized state are restored (Tauri window-state plugin).
- Session restore (setting): reopen the tabs of the last session, with the active tab and cursor positions. Missing files are skipped with a notice.
- Per-file memory, capped at the most recent 500 files: cursor and scroll position, bookmarks, manual profile choice.
- Last-used parameters of transforms and scripts.

## Configuration portability
`P2 · S · Core` (single profile import/export) · `P3 · S · Core` (full config)

**Status:** import and export of profiles, code files and machines shipped in M13; the whole-configuration zip and the relocatable config directory are deferred to Phase 4.

- Export or import one profile or code database file (P2).
- Export the whole configuration as a zip archive, and import it with a preview of what will be replaced (P3). This is how a shop sets up several PCs the same way.
- Relocatable config directory (P3), for a shared network folder or a portable install.

## Internationalization
`P3 · M · Core`

**Status:** all strings are in message files (`src/lib/i18n/en`); English only; translations are a Phase 4 row.

All UI strings are kept in message files from the start (P1 rule for new code), with English only at first. Translations are community contributions. The code dictionary descriptions are translatable in the same way (`description` per locale, English fallback).

## UI layout principles

- **Regions:** ribbon at the top, document tabs, editor in the center, left panel (program map, with the code inspector beside it once opened; the bookmark list was not built), bottom panel (results: script output, find results, findings), status bar. Every panel can be collapsed, and its size is remembered.
- **Ribbon groups:** Home (file, edit, search, program start), Insert (templates), NC (transformations, channels), Tools (scripts, compare, profiles), View (panels, theme, settings, shortcut list, About). All five exist; external commands were cut.
- **Status bar:** messages and dialect and machine pickers, channel, encoding, line ending, cursor and selection, read-only lock, running-script indicator. Clicking an item changes it.
- **Keyboard-first:** everything in the ribbon is also in the command palette and reachable without a mouse. Visible focus.
- **One form engine:** settings, script parameters, template parameters and transform options all use the same schema-driven form component with the same validation and help display.
- **Non-blocking:** long operations show progress in the status bar and can be cancelled. Errors show in the status bar with details on click. Modal dialogs are only used for decisions (unsaved changes, overwrite).
- **Native menu:** File, Edit, View and Help were to mirror the main commands on every platform. Not built: the macOS menu bar holds only the standard system items, and Windows and Linux have none; native menus are in the roadmap backlog.
- **Small screens:** usable at 1366×768, because shop-floor PCs are often small. Panels collapse to icons.
- **Accessibility:** readable contrast in both themes, UI font scaling, and screen-reader labels on icon-only buttons.

## Not planned

Password-locking the settings, warning sounds, cursor-repeat acceleration, virtual space past the line end, and keeping the cursor at the start of pasted text. These add configuration surface for little value.
