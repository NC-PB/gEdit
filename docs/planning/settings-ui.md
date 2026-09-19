# Settings and UI

Preferences, where they are stored, themes, keyboard shortcuts and the principles for the UI layout. Per-dialect settings live in profiles ([dialect-profiles.md](dialect-profiles.md)). This page only covers how they are edited.

Tag format: `Priority · Size · Delivery`.

## Storage layout
`P1 · S · Core`

All configuration is human-readable JSON in the Tauri app config directory (`appConfigDir()`). Machine-written state goes in the app data directory, so the config files stay clean for backup and sharing.

```
<config>/
  settings.json        global preferences (only values that differ from defaults)
  keybindings.json     user shortcut overrides (P3)
  profiles/*.json      user dialect profiles
  codes/*.json         user code dictionary entries and templates
  scripts/             user scripts (created on first start)
  packages/            script packages (P3)
<data>/
  state.json           recent files, session, window, per-file cursor and bookmarks, last parameters
  recovery/            auto-saved copies of modified buffers
```

- Defaults are in code (and the settings schema), not copied into `settings.json`, so new defaults reach existing users.
- Invalid JSON never blocks startup. gEdit starts with defaults and shows which file failed and why.
- Writes are atomic (write to a temp file, then rename).

## Settings dialog
`P1 · S · Core` (basic page) · `P2 · M · Core` (full dialog)

- **P1:** a simple dialog for the most needed options: theme, font, font size, tab width, Python interpreter, script folders, recent-files length. It replaces the "Settings (TBD)" ribbon button. There is also "Open settings file" for everything else.
- **P2:** full dialog with a category list on the left, a search box that filters categories and fields, and the form on the right. Forms are generated from a JSON Schema that has a title and a help text per field. The help text shows next to the field (info icon or on focus). The same schema validates `settings.json` on load.
- Changes apply when the user presses Save. Cancel discards them. Each category has "Reset to defaults" (with confirmation). A single field can be reset from its context menu.
- The profile editor is a category of the same dialog ([dialect-profiles.md](dialect-profiles.md#profile-editor)).

## Settings reference

| Category | Settings | Priority |
|---|---|---|
| Appearance | Theme (system/light/dark), editor font and size, UI font size, [role colors](#themes-and-colors) | P1 (theme, font), P2 (colors) |
| Editor | Tab width, insert spaces on Tab, show whitespace, rulers, highlight current line, word wrap, minimap, line numbers, drag and drop of text (off by default: accidental drags reorder blocks), copy the whole line when nothing is selected | P1 |
| Assistance | Hover help on/off, completion auto/manual/off, code inspector panel on/off, assistant master switch ([code-assistant.md](code-assistant.md#code-inspector-panel)) | P1 (hover, completion), P2 (panel) |
| Files | Recent-files length, restore last session, remember cursor per file, default profile for new documents, reaction to external changes (ask/reload), backup on save (off/one/N copies), recovery auto-save interval, open read-only for all files (viewer mode), "All files" as the default open filter | P1 (recent, external changes), P2 (rest) |
| Profiles | List and editor of dialect profiles | P2 |
| Scripts | Python interpreter path, script folders, default timeout, show bundled scripts | P1 |
| External commands | List of commands ([scripting.md](scripting.md#external-commands)) | P2 |
| Compare | Default view (side-by-side/inline). Ignore options are per profile. | P2 |
| Keyboard | [Shortcut overrides](#keyboard-shortcuts) | P3 |
| General | Confirm before quit (the unsaved-changes prompt always appears regardless), full path in window title, update check (off by default), UI language | P2, P3 (language) |

## Themes and colors
`P1 · S · Core` (light/dark/system) · `P2 · M · Core` (role color editor)

- Theme follows the OS by default, with a manual override. Today the editor is fixed to `vs-dark`. Both the app chrome (CSS variables, already used by the ribbon and panels) and Monaco switch together.
- Syntax colors are defined per token role ([dialect-profiles.md](dialect-profiles.md#tokenizer-and-colors)) with a light and a dark palette. P2 adds an editor: a color picker per role with a live preview and reset per role. Per-profile overrides are edited on the profile page.
- Fixed UI roles in the same palette: selection, current line, bookmark, find match, compare inserted/removed/changed, finding severities.
- Contrast of every default role color is checked against its background (WCAG AA) in both themes.

## Keyboard shortcuts
`P1 · S · Core` (defaults, shown everywhere) · `P3 · M · Core` (user rebinding)

Principles:

- Platform-aware modifiers: Cmd on macOS, Ctrl elsewhere (`platform.ts` already has this). Tooltips and the command palette show the shortcut in platform form.
- Every command is registered as a Monaco action, so it appears in the command palette (F1) with its shortcut.
- Do not break Monaco defaults users expect (find, replace, go to line, multi-cursor, move/copy line, comment toggle). NC navigation uses function keys, which Monaco mostly leaves free.
- P3: `keybindings.json` overrides (command id → key), plus an editor in the settings dialog with conflict warnings.

Proposed defaults (check against Monaco defaults during implementation):

| Command | Shortcut |
|---|---|
| New / Open / Save / Save As | Mod+N / Mod+O / Mod+S / Mod+Shift+S |
| Close tab / next tab / previous tab | Mod+W / Ctrl+Tab / Ctrl+Shift+Tab |
| Go to line or block number | Mod+G (replaces Monaco's go to line) |
| Next / previous tool change | F7 / Shift+F7 |
| Toggle bookmark / next / previous | Mod+F2 / F2 / Shift+F2 |
| Run script… / run last script | F9 / Mod+F9 |
| Compare with… | Mod+Alt+C |
| Toggle code inspector panel | Mod+Alt+A |

`Mod+F2` and `F2` replace Monaco's "select all occurrences" and "rename" bindings. Rename is unused for NC code, and select all occurrences stays available as Mod+Shift+L.

## Session and state
`P1 · S · Core` (recent files, window state) · `P2 · S · Core` (session restore, per-file memory)

- Window size, position and maximized state are restored (Tauri window-state plugin).
- Session restore (setting): reopen the tabs of the last session, with the active tab and cursor positions. Missing files are skipped with a notice.
- Per-file memory, capped at the most recent 500 files: cursor and scroll position, bookmarks, manual profile choice.
- Last-used parameters of transforms and scripts.

## Configuration portability
`P2 · S · Core` (single profile import/export) · `P3 · S · Core` (full config)

- Export or import one profile or code database file (P2).
- Export the whole configuration as a zip archive, and import it with a preview of what will be replaced (P3). This is how a shop sets up several PCs the same way.
- Relocatable config directory (P3), for a shared network folder or a portable install.

## Internationalization
`P3 · M · Core`

All UI strings are kept in message files from the start (P1 rule for new code), with English only at first. Translations are community contributions. The code dictionary descriptions are translatable in the same way (`description` per locale, English fallback).

## UI layout principles

- **Regions:** ribbon at the top, document tabs, editor in the center, left panel (program map, bookmarks), right panel (code inspector), bottom panel (results: script output, find results, findings), status bar. Every panel can be collapsed, and its size is remembered.
- **Ribbon groups:** Home (file, edit, navigation), Insert (templates), NC (transformations), Tools (scripts, compare, external commands), View (panels, theme). This extends today's Home/Insert/Tools tabs.
- **Status bar:** messages (as today) and profile selector, encoding, line ending, cursor and selection, read-only lock, running-script indicator. Clicking an item changes it.
- **Keyboard-first:** everything in the ribbon is also in the command palette and reachable without a mouse. Visible focus.
- **One form engine:** settings, script parameters, template parameters and transform options all use the same schema-driven form component with the same validation and help display.
- **Non-blocking:** long operations show progress in the status bar and can be cancelled. Errors show in the status bar with details on click. Modal dialogs are only used for decisions (unsaved changes, overwrite).
- **Native menu:** File, Edit, View and Help mirror the main commands on every platform (today only a macOS app menu exists).
- **Small screens:** usable at 1366×768, because shop-floor PCs are often small. Panels collapse to icons.
- **Accessibility:** readable contrast in both themes, UI font scaling, and screen-reader labels on icon-only buttons.

## Not planned

Password-locking the settings, warning sounds, cursor-repeat acceleration, virtual space past the line end, and keeping the cursor at the start of pasted text. These add configuration surface for little value.
