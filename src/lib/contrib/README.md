# `src/lib/contrib` — one file per feature

A contribution is the only place a feature plugs into the app. Adding a feature never
touches the ribbon, the status bar, `+page.svelte` or any central list (plan AD-3).

`src/lib/app/contributions.ts` loads every `*.ts` in this folder with
`import.meta.glob(['../contrib/*.ts', '!../contrib/*.test.ts'], { eager: true })`, **sorted
by file name**, registers what the default export declares, and then calls `activate()`.
A contribution that throws
is logged and skipped, so one broken feature cannot take the window down.

## Shape

```ts
import type { Contribution } from '$lib/app/types';

export default {
  id: 'files',
  commands: [ /* CommandDef[] */ ],
  ribbon: [ /* RibbonItemDef[] */ ],
  ribbonGroups: [ /* RibbonGroupDef[] — a group that renders its own component */ ],
  panels: [ /* PanelDef[] — region 'left' | 'bottom' | 'overlay' | 'banner' */ ],
  statusItems: [ /* StatusItemDef[] */ ],
  keybindingRemovals: [{ keys: 'F2', command: 'editor.action.rename' }],
  activate() {
    // Listeners, timers, the window title, …
    // Return a disposer; it runs when the app tears the contributions down.
    return () => { /* … */ };
  },
} satisfies Contribution;
```

`satisfies Contribution` (not `: Contribution`) keeps the literal types, so a typo in a
command id stays visible in this file.

## Rules

1. **One file per feature.** The file name is the feature name and, by convention, the
   contribution `id` and the i18n namespace: `contrib/files.ts` ↔ `i18n/en/files.ts` ↔
   keys `files.*`.
2. **Import services directly** (`import { files } from '$lib/app/fileOps'`). Do not reach
   for `$lib/app/context`: `ctx` exists only so the runtime harness can drive the app.
3. **Every string goes through `t()`** with a literal key, so `i18n/keys.test.ts` can scan
   it. `CommandDef.title` and `PanelDef.title` are i18n **keys**, not text — the renderer
   translates them. Script and profile labels are data and stay untranslated (AD-14).
4. **Command ids** are stable dotted names (`file.save`, `view.nextTab`). The palette
   action id is `gedit.<id>`. The ids and default shortcuts that are already assigned are
   listed in plan §7.11 — check it before inventing a new shortcut. A conflict is a
   `console.error`, and the runtime harness fails on unexpected console errors.
5. **Shortcuts** are `KeySpec` strings: `Mod+S`, `Ctrl+G`, `F7`, `Shift+F7`, `Mod+Alt+S`,
   `Mod+,`. `Mod` is Cmd on macOS and Ctrl elsewhere; `Ctrl` is always the literal Control
   key. Use `{ mac, other }` only when the two platforms really differ.
6. **`global: true`** means the window dispatcher also runs the command when focus is
   outside Monaco. Leave it off for commands that only make sense in the editor.
7. **`palette: false`** for a command that only wraps a Monaco action F1 already lists, so
   the palette shows no duplicates.
8. **`activate()` returns a disposer** for everything it installs. No global listener
   without one.
9. **Keep `activate()` cheap.** It runs during startup, before the first render. Anything
   slow belongs behind a command or a panel's own `onMount`.
10. **No Monaco import at module level.** Go through `$lib/monaco/editorService`; the
    Monaco bundle is loaded dynamically (see `monaco/core.ts`).

    A contribution that registers a *language provider* (hover, completion, symbols,
    folding) needs the Monaco namespace itself, and `await getMonaco()` from
    `$lib/monaco/setup` is the way to it: it is the same promise `EditorService` holds, so
    awaiting it inside `activate()` loads nothing early and nothing twice. What stays
    forbidden is a static `import … from '$lib/monaco/core'` (or from `monaco-editor`),
    which would put the editor in the initial bundle and evaluate it during prerender.
    `contrib/programMap.ts` and `contrib/assistant.ts` are the two examples.
11. **Icons go through `asIcon`** (`$lib/app/icons`), and are imported from
    `lucide-svelte/icons/<name>`, never from the `lucide-svelte` barrel:

    ```ts
    import Save from 'lucide-svelte/icons/save';
    import { asIcon } from '$lib/app/icons';
    // …
    { id: 'file.save', title: 'files.save', icon: asIcon(Save), run: … }
    ```

    lucide-svelte 1.0.1 still ships Svelte 4 class typings, so a bare `icon: Save` is a
    type error; `asIcon` holds that cast in one place (I1). The barrel costs seconds of
    vite transform in every test file that reaches a contribution.

## Test ids

Components a contribution registers carry the `data-testid` attributes of plan §7.9. They
are a contract with the runtime harness: renaming one breaks scenarios in `tests/runtime/`.

## Current files

Each row names the owning work package and the feature.

| File | Owner | Feature |
| --- | --- | --- |
| `assistant.ts` | WP3.6 | hover and completion providers over the code database |
| `blocks.ts` | WP1.5 | Insert tab, built from the blocks JSON |
| `bookmarks.ts` | WP4.4 | `bookmark.toggle` / `next` / `prev` / `clear` and the F2 removals |
| `compare.ts` | WP2.5 | compare with a document, a file or the saved version (overlay) |
| `cursor.ts` | WP1.2 | cursor status item |
| `editing.ts` | WP4.4 | Home "Edit" and View-tab wrappers around Monaco actions |
| `encoding.ts` | WP1.6 | encoding and EOL status items and pickers |
| `externalChange.ts` | WP2.3 | the external-change banner and the poll |
| `files.ts` | WP1.6 | file commands, close guard, drag and drop, window title |
| `help.ts` | WP2.4 | About and the shortcut reference |
| `layoutPersist.ts` | WP2.3 | restores `ui.layout` and then follows it |
| `navigation.ts` | WP3.5 | `nav.goto` (Ctrl+G), `nav.nextTool` / `nav.prevTool` (F7 / Shift+F7) |
| `ncCleanup.ts` | WP4.3 | NC tab "Cleanup": spaces, empty lines, comments, case |
| `ncNumbering.ts` | WP4.2 | NC tab "Numbering": `nc.renumber`, `nc.removeBlockNumbers` |
| `palette.ts` | WP1.1 | `view.commandPalette` (F1) |
| `profileSelect.ts` | WP1.6 | dialect profile status item and picker |
| `programMap.ts` | WP1.5 | program map (left panel) |
| `recent.ts` | WP2.3 | Recent dropdown, `file.openRecent`, `file.clearRecent` |
| `results.ts` | WP4.1 | the Results panel (bottom region) |
| `scripts.ts` | WP5.2 | the script UI: Tools group, `script.*` commands, Output panel, status item |
| `settings.ts` | WP2.7 | the settings dialog, `settings.open` (Mod+,), reload on save |
| `tabs.ts` | WP1.2 | next/previous/switch tab |
| `theme.ts` | WP2.6 | `view.setTheme`, the settings → editor-option bridge |
| `view.ts` | WP1.5 | panel toggles |
