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
| `bookmarks.ts` | WP4.4 | `bookmark.toggle` / `next` / `prev` / `clear` and the F2 removals |
| `channels.ts` | WP12.5 | multi-channel programs: channel status item, sync-point navigation (`Alt+F7`, `Shift+Alt+F7`, `Mod+Alt+P`), `channels.checkSync`, `channels.assign`, `channels.splitToDocuments`, the `togglePreserveCase` removal |
| `compare.ts` | WP2.5 | compare with a document, a file or the saved version (overlay) |
| `cursor.ts` | WP1.2 | cursor status item |
| `cycleForms.ts` | P3.5 | Edit Cycle: the form of the cycle at the cursor, or a new cycle, `nc.editCycle` (Phase 3, P3b; the prelude pinned it; engine `core/templates/cycleForm.ts`, P3.8) |
| `editing.ts` | WP4.4 | Home "Edit" and View-tab wrappers around Monaco actions |
| `encoding.ts` | WP1.6 | encoding and EOL status items and pickers |
| `externalChange.ts` | WP2.3 | the external-change banner and the poll |
| `files.ts` | WP1.6 | file commands, close guard, drag and drop, window title |
| `help.ts` | WP2.4 | About and the shortcut reference |
| `layoutPersist.ts` | WP2.3 | restores `ui.layout` and then follows it |
| `inspector.ts` | P3.2b | the code inspector (left panel): `view.toggleInspector` (Mod+Alt+A), `inspector.editValue` (Phase 3, P3a; the prelude pinned them) |
| `machineSelect.ts` | WP6.10 | machine status item and picker, `file.setMachine`, `machines.manage`, `machines.openFile` |
| `modal.ts` | P3.1 | starts the modal service (`app/modalService.ts`), which keeps the modal state of every open document for the inspector, the hover and the motion colors (Phase 3, P3a) |
| `motionColors.ts` | P3.7 | the motion colors beside every line that moves, `view.toggleMotionColors` (Phase 3, P3a; the prelude pinned it) |
| `navigation.ts` | WP3.5 | `nav.goto` (Ctrl+G), `nav.nextTool` / `nav.prevTool` (F7 / Shift+F7) |
| `ncBlockSkip.ts` | WP10.1 | NC tab "Block Skip": `nc.blockSkip.add` / `nc.blockSkip.remove` |
| `ncCleanup.ts` | WP4.3 | NC tab "Cleanup": spaces, empty lines, comments, case |
| `ncNumbering.ts` | WP4.2 | NC tab "Numbering": `nc.renumber`, `nc.removeBlockNumbers` |
| `palette.ts` | WP1.1 | `view.commandPalette` (F1) |
| `profileSelect.ts` | WP1.6 | dialect profile status item and picker |
| `programMap.ts` | WP1.5 | program map (left panel) |
| `quitGuard.ts` | WP6.5 | reports "any document dirty" to the macOS quit guard |
| `readOnly.ts` | WP7.3 | `file.toggleReadOnly` and the read-only status item |
| `recent.ts` | WP2.3 | Recent dropdown, `file.openRecent`, `file.clearRecent` |
| `recovery.ts` | WP7.4 | crash-recovery snapshots, the restore dialog, `recovery.showPending` |
| `results.ts` | WP4.1 | the Results panel (bottom region) |
| `scripts.ts` | WP5.2 | the script UI: Tools group, `script.*` commands, Output panel, status item |
| `search.ts` | WP11.1 | Home tab "Search": `search.findAll` (Mod+Shift+F), `search.replace`, `search.wholeAddressInFind` |
| `segments.ts` | WP10.1 | `nav.selectToolSegment` (Mod+F7): select from one tool change to the next |
| `session.ts` | WP7.5 | session restore at start, and the per-file memory that follows the tabs |
| `settings.ts` | WP2.7 | the settings dialog, `settings.open` (Mod+,), `profile.manage` (Settings on the Profiles page, no key; M13 integration), reload on save |
| `tabs.ts` | WP1.2 | next/previous/switch tab |
| `templates.ts` | P3.5 | the Insert tab's templates of the active document's effective database, `insert.template:<id>` per template, `templates.insert`, the Home tab's program start, templates in completion (Phase 3, P3b; the prelude pinned them) |
| `templateManager.ts` | P3.9 | the template manager and New Template from Selection: `templates.manage`, `templates.fromSelection` (Phase 3, P3b; the prelude pinned them) |
| `theme.ts` | WP2.6 | `view.setTheme`, the settings → editor-option bridge |
| `typing.ts` | WP13.4 | upper-case typing and no join of two blocks (AD-30), `edit.toggleForceUppercase` (M13; P13 pinned it) |
| `userConfig.ts` | WP13.3 | the user's own profiles and code files: `profile.*`, `machines.import` / `machines.export`, the reload after a save in either folder (M13; P13 pinned them) |
| `view.ts` | WP1.5 | panel toggles |
