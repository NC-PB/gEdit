# gEdit: final implementation plan for Phase 0 cleanup and Phase 1

Scope: the roadmap's Phase 0 "Remaining cleanup" and every Phase 1 row, finished when the Phase 1 exit criteria pass (`docs/planning/roadmap.md`).

Status: this plan replaces `plan-A.md` and `plan-B.md`. It uses Plan B's execution skeleton (6 milestones; each one runs a serial prelude, parallel waves, then integration and gates) and Plan B's feature layout (one contribution file per feature). Most of the technical content comes from Plan A, whose claims held up against the installed sources. The details and scores are in §0.

Path shorthands:
- `R` = `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f`
- `NM` = `node_modules`
- `SP` = a scratch directory outside the repo (worktrees, cargo target dirs, hand-off notes)

All other paths are relative to the repo root, `/Users/peterburgener/Repositories/gEdit`.

---

## 0. Verdict and grafts

| Criterion (1–10) | Plan A | Plan B | Notes |
|---|---|---|---|
| Technical claims are correct | 9 | 6 | B's central drag-and-drop claim is wrong. `tauri-plugin-fs` already grants dropped files, and dropped folders recursively, in its own `on_event` (`R/tauri-plugin-fs-2.5.2/src/lib.rs:514-530`). That grant runs before the JS `tauri://drag-drop` event is emitted (`R/tauri-runtime-wry-2.11.4/src/lib.rs:4251-4260`). B's Rust `dnd` module and its "folders are ignored" security argument therefore rest on a false premise. B's objc2 Dock-quit hook is unverified. A's claims all check out. |
| Fit to the spec | 8 | 8 | A refuses UTF-16, although the spec asks for UTF-16 BOM detection, and keeps `recent.json` outside `state.json`. B supports UTF-16, follows the spec's `state.json` and `newFileLineEnding`, but replaces the window-state plugin the spec names and moves blocks to templates early (a P2 item). |
| Can be split into parallel work | 7 | 9 | B's glob-loaded contributions and i18n files, prelude contracts with stubs, worktrees and waves remove shared-file edits. A needs aggregator owners and 8 milestones. |
| Verification quality | 9 | 7 | A adds test seams before the rewrite, ports the whole existing harness as a regression suite, commits the harness to the repo, and has performance budgets at each gate. B keeps the harness in the scratchpad with only a `smoke` scenario at M0 and checks performance only at the end. |
| Simplicity and risk | 7 | 6 | A uses simpler mechanisms (stores, no native File menu, the window-state plugin, Dock quit deferred), but its headless-then-switch-over split duplicates work. B adds its own drag-and-drop, window state, native File menu (double-dispatch risk), objc2 injection and a big-bang M1. |
| **Total** | **40** | **36** | A's content is stronger and B's skeleton is stronger. This plan combines the two. |

**Taken from Plan A:**
1. Drag and drop relies on the fs plugin's own grant. There is no Rust `dnd` module and no custom event.
2. Test seams go into the current app in M0: `data-testid` attributes and a stable `window.__gedit` hook. The M1 rewrite is then gated by a regression suite that stays unchanged.
3. The harness is committed to `tests/runtime/`, and every existing scenario is ported as the regression suite.
4. The webview handles Cmd+W. The menu's Close Window moves to Cmd+Shift+W, and P1 has no native File menu. The Dock-quit hook is deferred.
5. Window geometry uses the official `tauri-plugin-window-state`, which is what the spec names.
6. External changes are shown in an in-app banner, which the harness can test through the DOM.
7. The program map uses an incremental `OutlineIndex` rather than a debounce plus an optional worker.
8. Shared state lives in `svelte/store` modules in plain TS. Services are `createX(deps)` factories plus a default singleton.
9. One settings schema is written by the M2 prelude.
10. Every milestone gate has performance budgets.
11. Blocks JSON stays until the P2 templates.
12. Compare moves to M2, so the external-change banner can link to it directly.

**Kept from Plan B:**
- The contribution glob and the glob-loaded i18n namespaces.
- Preludes with contracts, stubs and Rust command stubs; worktrees; waves.
- UTF-16 LE/BE with BOM.
- NUL leader and trailer kept outside the editor text.
- A Rust `files_stat` command instead of `fs:allow-stat`.
- `state.json`, with the recent list owned by Rust.
- The `eval` grep gate and `licenses --check`.
- Unix process-group kill.
- `script_copy_to_user`.
- The generic QuickPick.
- The i18n key-scan test.

---

## 1. Verified facts this plan relies on

| # | Fact | Evidence |
|---|---|---|
| F1 | The app is single-document. `src/routes/+page.svelte` is 661 lines, and the whole app is about 2.5k lines of TS and Svelte. `svelte-check` currently reports **0 errors and 6 warnings**. No TS test runner is installed. | `npm run check` (run for this plan) |
| F2 | A dropped file is granted with `allow_file`, and a dropped folder with `allow_directory(path, true)`, by the fs plugin's `on_event`. The plugin callback runs before the window listeners that emit `tauri://drag-drop` to JS, so there is no race. | `R/tauri-plugin-fs-2.5.2/src/lib.rs:514-530`; `R/tauri-runtime-wry-2.11.4/src/lib.rs:4244-4260`; `R/tauri-2.11.5/src/app.rs:2644-2648` |
| F3 | A multi-file `open()` grants each picked file, the same as a single pick. `save()` grants the chosen path. | `R/tauri-plugin-dialog-2.7.3/src/commands.rs:187-255` |
| F4 | `FsExt::fs_scope()` provides `allow_file`, `allow_directory` and `is_allowed`. It works in `setup` and in commands. | `R/tauri-plugin-fs-2.5.2/src/lib.rs:434-446`; `R/tauri-2.11.5/src/scope/fs.rs:351,370,419` |
| F5 | Custom commands need no ACL entry, as long as the app has no permission manifest and no `src-tauri/permissions/` directory. | `SP/r_tauri.md` §A6 |
| F6 | The CSP's `connect-src` is `ipc: http://ipc.localhost` with no `'self'`, so `fetch()` of bundled files is blocked. There is no `unsafe-eval`, so `ajv`-style code generation cannot run. Bundled data must use static imports, `?raw`, or dynamic `import()`. | `src-tauri/tauri.conf.json`; `SP/r_tauri.md` §B |
| F7 | On macOS, rfd merges every dialog filter into one `allowedFileTypes` list. Any filter therefore blocks files without an extension (`O1234`) and files with unlisted extensions (`.tap`). | `R/rfd-0.16.0/src/backend/macos/file_dialog/panel_ffi.rs:107-121` |
| F8 | Monaco 0.55 stops tokenizing above 20 MB or 300k lines. Models above 50 MB are not synced to the worker, so the diff editor cannot compute diffs for them. | `NM/monaco-editor/esm/vs/editor/common/model/textModel.js:116-119`; `editorWorkerService.js:40-48` |
| F9 | Monaco's go-to-line is Ctrl+G on every platform (WinCtrl+G on macOS). On macOS, Cmd+G is Find Next. | `…/standaloneGotoLineQuickAccess.js:50-51` |
| F10 | `monaco.editor.addEditorAction` exists and registers an action globally. `addKeybindingRules` accepts a `-command` rule, which removes a default binding. | `editor.api.d.ts:1003,1018`; `standaloneEditor.js:150-172` |
| F11 | Monarch appends `.<languageId>` to every token, so `feed` becomes `feed.fanuc-gcode`. | `monarchCompile.js:412` |
| F12 | Resources listed in `bundle.resources` are copied into `target/<profile>`. `resource_dir()` resolves to the exe folder when the binary sits under a `target/<profile>` folder, so a `CARGO_TARGET_DIR` path must end in `/target`. | `R/tauri-build-2.6.3/src/lib.rs:554-572`; `R/tauri-utils-2.9.3/src/platform.rs:264-302` |
| F13 | `dirs` honors `$HOME` on macOS, so `app_config_dir()` and `app_data_dir()` can be isolated through `HOME`. Both resolve to `~/Library/Application Support/com.pburg.gedit`. | `R/dirs-sys-0.5.0/src/lib.rs:33-37`; `R/tauri-2.11.5/src/path/desktop.rs:238-251` |
| F14 | These crates are in the local registry: `toml` 0.9.12, `libc` 0.2.189, `objc2` 0.6.4, `tempfile`. `tauri-plugin-window-state` (2.4.1 requires tauri ^2.8.2) and `notify` are not. Network access to crates.io and npm works. | `ls R`; the crates.io index; npm returns HTTP 200 |
| F15 | `.gitattributes` is `* text=auto`, which would rewrite CRLF, CR-only and Latin-1 fixtures. | `.gitattributes` |
| F16 | Cmd+Q uses a custom menu item that calls `window.close()`, which goes through the guard. Dock → Quit and logout call `terminate:` and skip the guard, because tao has no `applicationShouldTerminate`. | `src-tauri/src/lib.rs:417-512`; `SP/fix_runtime.md` gap 1 |
| F17 | The harness patches `lib.rs` by exact whole-block string replacement and calls `.setup()` and `.run(harness::on_event)`. It finds UI elements by visible text. | `SP/rh3-sync.sh`; `SP/runtime-harness/src-tauri/src/harness.{rs,js}` |
| F18 | `@tauri-apps/api` 2.11.1 has `Window.setTheme` (needs `core:window:allow-set-theme`) and `onDragDropEvent`, which is a `listen` call already allowed by `core:event:allow-listen`. | `NM/@tauri-apps/api/window.js:1557,1667`; `webview.js:548` |
| F19 | `CommandExt::process_group` is stable. rustc here is 1.90. | rustc |

---

## 2. Architecture decisions

**AD-1: Folder layout.**

```
src/lib/
  core/        pure TS: no Svelte runtime, no Monaco runtime, no Tauri (type-only imports allowed). Unit tested with vitest in node.
               text/ keys/ nc/ profiles/ grammar/ codes/ nav/ transforms/ forms/ settings/ scripting/
  app/         services and wiring: types.ts (contracts), context.ts (ctx aggregate for tests),
               bootstrap.ts, contributions.ts, registry/, keys/, fileOps.ts, dialogs.ts, modals.ts, status.ts,
               external.ts, compare.ts, theme.ts, transforms.ts, outlineService.ts, scripts.ts, testHook.ts
  stores/      svelte/store modules: documents, layout, profiles, settings, uiState, recent, codes, results, scripts
  monaco/      Monaco adapters only: core, setup, editorService, languages, theme, editorOptions, diff, applyLines,
               bookmarks, providers/*
  platform/    commands.ts: typed invoke wrappers for every custom Rust command (written by preludes)
  contrib/     ONE FILE PER FEATURE, loaded by import.meta.glob. Features plug in only here.
  components/  common/ shell/ editor/ panels/ status/ menus/ forms/ dialogs/
  i18n/        index.ts + en/<namespace>.ts (glob)
  data/        profiles/*.json, codes/*.json, blocks/*.json (kept), licenses.json (generated)
src-tauri/src/ lib.rs (thin) + menu.rs python.rs scripts_v1.rs files.rs paths.rs atomic.rs config.rs state.rs scripts/*
src-tauri/resources/scripts/   bundled Python
tests/         fixtures/ gen/ unit/ python/ runtime/ perf/
```

**AD-2: Svelte and state.**
- Every component uses runes (`$props`, `$state`, `$derived`, callback props). M1 rewrites the three legacy components.
- Shared state lives in `svelte/store` (`writable`/`derived`) inside plain `.ts` modules, never in `.svelte.ts` classes. Such modules can be imported anywhere, tested in node without the compiler, and never deep-proxy Monaco objects or large arrays.
- Monaco objects (models, editors, decorations) never go into stores.
- A service that has dependencies is written as `createX(deps)`, plus a default singleton wired to the real modules (`export const files = createFileOps({...})`). This lets vitest inject fakes.

**AD-3: Contributions.**
- Each feature is `src/lib/contrib/<name>.ts`, which default-exports a `Contribution` (§7.1).
- `app/contributions.ts` loads them with `import.meta.glob('../contrib/*.ts', { eager: true })`, sorted by file name. It registers the commands, ribbon items, panels, status items and keybinding removals, then calls `activate()`. A contribution that throws is logged and skipped.
- A contribution imports the service modules it needs directly. `ctx` (`app/context.ts`) only aggregates the singletons for the test hook.
- The i18n namespaces are glob-loaded the same way.
- Adding a feature therefore never touches the Ribbon, the StatusBar, `+page`, or any central list.

**AD-4: Command registry.**
- One registry drives the ribbon, the window key dispatcher, Monaco's F1 palette and the harness.
- Palette: each command with `palette !== false` becomes a Monaco action through `monaco.editor.addEditorAction({ id: 'gedit.'+id, label: '<Category>: <Title>', keybindings, run })`.
- Default Monaco bindings that are taken over are removed with `addKeybindingRules([{ keybinding, command: '-<monacoId>' }])`.
- Key specs are written as `Mod+S`, `Ctrl+G`, `F7`, `Shift+F7`, `Mod+Alt+S` or `Mod+,`. `Mod` means Cmd on macOS and Ctrl elsewhere. `Ctrl` always means the literal Control key.
- The window dispatcher (bubble phase) runs `global` commands when focus is outside Monaco. It ignores events that are `defaultPrevented`, `isComposing`, carry the `AltGraph` state, or whose target is a text input or sits inside `.monaco-editor`. It is suspended while a modal is open.
- The registry logs `console.error` when a key conflict is registered. The harness fails on unexpected console errors, so conflicts cannot ship.
- Commands that only wrap a Monaco action F1 already lists get `palette: false`, so the palette shows no duplicates.

**AD-5: Documents and editor.**
- There is one `IStandaloneCodeEditor`, and one model per document with URI `inmemory://doc/<id>`.
- `monaco/editorService.ts` subscribes to `docs.activeId` at module level and switches models synchronously (it saves the view state, calls `setModel`, then restores the view state). A `reveal()` right after `activate()` is therefore safe.
- Text is LF-normalized before `createModel`. The model EOL is CRLF when the document EOL is `crlf`, and LF otherwise (so `lf` and `cr` both use LF models).
- Saving writes `getValue(LF)` joined with the document's EOL. This keeps CR-only files intact.
- `textDirty` is `alternativeVersionId !== cleanVersionId`. The store is only updated when that value flips. The store derives `dirty = textDirty || metaDirty`.
- **One undo step rule:** every rewrite (transforms, scripts, reload, inserts) goes through `pushStackElement`, then `pushEditOperations`, then `pushStackElement`. `setValue` is used only when a model is created.

**AD-6: Layout.**
- Top to bottom: ribbon (Home, Insert, NC, Tools, View), then the tab bar, then a row with the left panel (program map) and the center, then the bottom panel (Output, Results), then the status bar.
- The center shows either the banner region plus the editor, or the `overlay` panel (compare) in its place.
- Panels are `PanelDef`s in the regions `left`, `bottom`, `overlay` and `banner`. Splitters use pointer events; HTML5 drag and drop conflicts with native file drop on Windows.
- Modal UIs go through `ModalHost` (quickPick, prompt, form, and custom dialogs), one at a time.
- Native `message()` dialogs are used only for decisions: unsaved changes, quit, and the encoding fallback.
- The window must be usable at 1366×768. The ribbon scrolls horizontally and panels collapse.

**AD-7: Text I/O.**
- Bytes are read and written with plugin-fs `readFile`/`writeFile`, using the existing permissions. Decoding and encoding live in `core/text`.
- Supported encodings: UTF-8 with or without BOM, Windows-1252, and UTF-16 LE/BE with BOM.
- EOL detection covers CRLF, LF, CR and mixed. A mixed file takes the majority ending, and a tie goes to CRLF.
- NUL runs at the very start and end (tape leader and trailer) are counted, removed from the editor text, and written back unchanged on save.
- NULs inside the text are stripped when `profile.onLoad.stripNul` is set (the default). The count is shown and the document is marked modified.
- A file is refused as binary when inner NULs make up more than 10 % of the remaining bytes.
- Documents are written in place, which keeps file identity and ACLs on shares. Config and state are written atomically by Rust.
- New documents are UTF-8 without BOM and use the profile's `newFileLineEnding` (CRLF).
- Dialog filters: macOS gets **none** (F7). Windows and Linux get `[NC programs (union of profile extensions), All files (*)]`.

**AD-8: Settings and state.**
- Rust owns every read and write of `<config>/settings.json` and `<data>/state.json` through fixed-name commands. Writes are atomic, limited to 1 MiB and to JSON objects.
- `settings.json` has flat dotted keys, stores only non-default values, and carries `"$version": 1`.
- `state.json` has the shape `{ "$version":1, "recent":[…], "ui":{…} }`. Rust owns `recent`; the webview owns `ui`, which Rust merges in.
- Invalid JSON never blocks startup: the defaults are used and a notice is shown. The bad file is renamed to `<name>.bak` before the next write.
- A file whose `$version` is newer than supported is read but never written.
- The defaults and field metadata are in `core/settings/schema.ts`, written by the M2 prelude.
- Rust reads the script settings (`scripts.python`, `scripts.folders`, `scripts.timeoutSeconds`, `scripts.showBundled`) itself. They are never passed over IPC.

**AD-9: Recent files and window.**
- Rust owns the recent list. `recent_touch` accepts only paths where `fs_scope().is_allowed(path)` is already true.
- `setup` re-grants existing entries (at most 50, both the given and the canonical path), so recent files reopen after a restart without a dialog.
- Window size, position and maximized state use `tauri-plugin-window-state` (Rust side only, flags without `VISIBLE`). It writes `.window-state.json` in the config folder. This deviates from "`state.json` holds window" and is recorded as D5.

**AD-10: External change detection.**
- Rust `files_stat(paths)` is batched and answers only for allowed paths. It reports `exists`, `isDir`, `mtimeMs`, `size` and `readonly`.
- The webview polls every 2 s while the window has focus, and immediately on `focus` and `visibilitychange`.
- When `(mtime, size)` differs from the document's disk stamp, the file is read and its hash compared. Equal content only updates the stamp. A `null` mtime is recorded without raising an event.
- Behavior:
  - Clean document with `files.externalChange = reload`: silent reload as one undo step, keeping the cursor line.
  - Otherwise: an in-app banner with Reload, Keep mine and Compare.
  - Deleted file: a tab marker, the buffer is kept, and the document is marked modified.
- fs watch is not used: it needs non-local crates and extra permissions, is unreliable on SMB/NFS, and CAM atomic-rename saves produce remove/create pairs.

**AD-11: Dialect profiles.**
- The built-ins are `src/lib/data/profiles/{fanuc-gcode,heidenhain-klartext}.json`, following the P1 schema subset (§7.4). They are imported statically, and the ids stay the same.
- `validate.ts` is a hand-written validator (no ajv, because of F6).
- `compile.ts` precompiles each regex once, with the `i` flag unless `caseSensitive` is set.
- Detection follows the spec: a matching folder wins; otherwise the score is the extension weight plus the strongest content weight per line over the first 400 non-empty lines; ties go to `priority`, then to the current or default profile.
- The grammar generators are `iso` (generated) and `klartext` (hand-written, parameterized). They emit role tokens, Monarch appends the profile id, and `defaultToken` is `''`.
- Themes are `gedit-dark` and `gedit-light`, built from role palettes that pass WCAG AA.
- **Pattern rule:** profile patterns stay within the common subset of ECMAScript and Python `re`. No variable-width lookbehind, no `\p{}`, no `\k<>`, and code patterns use `(?<![A-Z])` and `(?!\d)` instead of `\b`.

**AD-12: NC core.**
- `core/nc`:
  - A stateful line tokenizer (Klartext `~` continuation), `maskComments` and `blockNumberOf`.
  - Number parsing and formatting on **decimal strings**, rounding half away from zero, so TS and Python agree.
- `OutlineIndex` caches the classification of each line and splices it on content changes, followed by a cheap linear aggregation. It is built in 20k-line chunks after the first render. No worker.
- Transforms are pure functions `(lines, ctx) => TransformResult` with an optional `lineMap`.
- `monaco/applyLines.ts` applies minimal edits within each line and deletes whole lines, so bookmarks and folds on untouched lines survive. Above 20k changed lines it switches to chunked hunks.

**AD-13: Scripting.**
- In Rust `scripts/*`:
  - The TOML header is parsed with `toml` 0.9.
  - Discovery covers `bundled:`, `user:` and `extra<N>:` roots. One level of subfolders becomes a group. A user script shadows a bundled one with the same name.
  - JS sends only a script **id**, never a path or interpreter.
  - Context goes into a 0700 temp folder that is deleted after the run.
  - Environment: `PYTHONUTF8`, `PYTHONIOENCODING`, `PYTHONDONTWRITEBYTECODE`, and `PYTHONPATH=<bundled>`.
  - The runner checks `try_wait` every 20 ms against a deadline and a cancel flag. stdout is capped at 64 MiB (above `MAX_OPEN_BYTES`, and small enough that the four copies on the way to the webview cannot fill memory — G8 M4) and stderr at 1 MiB.
  - On Unix the script runs in its own process group, and `killpg` kills the group. On Windows only the child is killed.
  - `kill_all` runs on `RunEvent::Exit`.
  - Interpreter order: the `GEDIT_PYTHON` environment variable, then `scripts.python` from settings (must be an existing file), then the existing resolver.
- In TS: the context, the output modes and the safe-apply decisions.
- Bundled scripts live in `src-tauri/resources/scripts/` (bundle resources). Their tests live in `tests/python/`.

**AD-14: UI strings.**
- Strings are looked up with `t('ns.key', params)`, using `{name}` interpolation and `key_one`/`key_other` plurals.
- One namespace file per feature.
- A key-scan test checks every literal `t('…')` key.
- Rust returns English detail text, which is shown under a translated summary. Script and profile labels are data and are not translated.

**AD-15: Test seams.**
- `data-testid` attributes follow the contract in §7.9.
- `window.__gedit` (§7.9) exists only when `import.meta.env.VITE_GEDIT_TEST === '1'`.
- `lib.rs` keeps exactly one `tauri::Builder::default()` and one `generate_handler![`. These are the only two harness anchors. The harness plugin owns its own `setup` and `on_event`.

---

## 3. Security and capability changes

The CSP stays unchanged in every milestone. `freezePrototype` stays false.

The **only** capability change is **`core:window:allow-set-theme`** (M2), which keeps the native title bar in step with a manual theme choice. No `fs:allow-stat`, `fs:allow-watch`, `fs:default`, opener, shell, `core:app:*` or persisted-scope.

| Feature (milestone) | How the path gets into the fs scope | Capability | Notes |
|---|---|---|---|
| Open, single or multiple (M1) | The dialog plugin grants each pick (F3). | none | |
| Drag and drop (M1) | The fs plugin grants dropped files, and folders recursively, before the JS event (F2). | none | The UI ignores folders. The recursive folder grant is an accepted residual risk. |
| Stat, no-op save, external change (M1/M2) | Rust `files_stat` answers only for `is_allowed` paths. | none | |
| Settings, state, window (M2) | Rust commands with fixed file names. The webview never gets fs scope on the config or data folders. | none | |
| Recent files (M2) | Rust re-grants recent entries at startup. `recent_touch` requires `is_allowed`. | none | This is a bounded widening of the scope (D6). |
| Open settings file, new script, copy script, script source (M2/M5) | Rust grants that one file. | none | Bundled scripts are never granted. |
| Theme (M2) | — | **+ `core:window:allow-set-theme`** | |
| Scripts (M4/M5) | Rust resolves an id against known roots and rejects `..`, separators and symlink escapes. | none | The v1 command that takes any folder is removed in M5. |
| About (M2) | `licenses.json` is loaded through dynamic `import()`. Links are shown as copyable text. | none | No opener plugin. |

Standing rules, checked by the review gate:
1. Never add `src-tauri/permissions/` or an app ACL manifest (F5).
2. Every new Rust command that takes a path checks `fs_scope().is_allowed`, or resolves an id against fixed roots.
3. No `{@html}` with file, script or profile content. Hovers use `isTrusted:false` and `supportHtml:false`.
4. No dependency that uses `eval` or `Function(…)`, with or without `new`. Gate G5 greps the build for both.
5. Scripts never run automatically.

Residual risk: `settings.json` can be written through `settings_save`, so an XSS could add a script folder or an interpreter. This is the same class of risk as today's v1 `run_python_script(folder)`. The CSP is the primary barrier. Rust checks that the interpreter is an existing file and that the folders are existing directories.

---

## 4. Execution protocol for the orchestrator

### 4.1 Branches and worktrees

- Base branch: `feat/phase-1`.
- For milestone N, create `mN/base` from `feat/phase-1`. The prelude commits to `mN/base`.
- Each work package gets its own worktree: `git worktree add $SP/wt/<wp> -b mN/<wp> mN/base`.
  - `node_modules` is a symlink to the main checkout's `node_modules`.
  - Rust WPs use `CARGO_TARGET_DIR=$SP/cargo/<wp>/target`. The last segment must be `target` (F12).
- Wave A branches start from `mN/base`. After all Wave A branches are merged into `mN/int`, Wave B branches start from `mN/int`.
- The integration agent works on `mN/int`. After the gates pass, the orchestrator runs:
  ```
  git checkout feat/phase-1
  git merge --squash mN/int
  git commit
  ```
  That gives one commit per milestone, with the title given per milestone and the attribution lines. The temporary branches and worktrees are then removed.

### 4.2 Roles

- **Prelude** (one agent, serial). It is the only agent that edits these files in a milestone:
  - `package.json` and its lockfile, `src-tauri/Cargo.toml` and `Cargo.lock`, `tauri.conf.json`, `capabilities/*`.
  - `src/lib/app/types.ts`, `src/lib/app/context.ts`, `src/lib/app/bootstrap.ts` (from M2 on), `src/lib/platform/commands.ts`.
  - `src-tauri/src/lib.rs` (from M2 on), `.github/workflows/*`, `.gitattributes`, `.gitignore`, `vite.config.js`, `vitest.config.ts`, `src/app.d.ts`.
  - The contract type files the milestone lists.

  One exception: in M0, WP0.2 owns `.github/workflows/ci.yml` and `README.md`, and WP0.4 owns `+page.svelte`.

  It also creates a **stub** for every new module that another WP imports. The stub has the pinned signature and returns defaults, a no-op, or throws `Error('not implemented: <wp>')`. The owning WP later replaces the body and keeps the signature. The prelude registers Rust command stubs that return `Err("not implemented")`, runs `npm install` or `cargo fetch` (with network) when dependencies change, runs `npm run licenses`, checks that `npm run check` and `cargo check` pass, and commits.
- **Work package agents** edit only their owned paths. They may read anything.
  - A change needed in a shared file is written into the hand-off note, and the integration agent applies it.
  - Contracts in §7 are binding. A deviation needs a hand-off note and integration approval.
  - Done means:
    - The code and its tests are written.
    - Strings are in the WP's own i18n namespace.
    - `npm run check` and `npm test` pass in the worktree; `cargo`/`python` gates too when the WP touches those areas.
    - `git diff --name-only mN/base...HEAD` lies inside the owned globs.
    - A hand-off note is written: public API, deviations, known gaps, and the harness checks to run.
- **Harness WP `Hn`** runs in Wave B.
  - It owns `tests/runtime/scenarios/**` and `tests/runtime/suites/mN.txt`. In M5 it also owns `tests/fixtures/exit/**`.
  - It writes the milestone's scenarios against the test-id contract and `window.__gedit`.
  - It updates earlier scenarios only for the intentional behavior changes listed in that milestone.
  - Changes to `tests/runtime/lib/**` or `tests/runtime/harness/**` (new `h_*` commands) are made by the prelude.
- **Integration** (one agent):
  - Merges the branches.
  - Makes only wiring, compile and cross-WP fixes (any file). The fix list goes into the commit message body.
  - Removes shims.
  - Runs all gates, including the harness, and fixes failures, or sends them back to the owning WP.

### 4.3 Gates (all must pass before the milestone commit)

| Gate | Command or check |
|---|---|
| G0 ownership | For each WP, `git diff --name-only mN/base...mN/<wp>` ⊆ owned globs. |
| G1 types | `npm run check`: 0 errors. In M0, warnings ≤ 6 (baseline). **From M1 on, 0 warnings.** |
| G2 unit | `npm test` (vitest) |
| G3 rust | `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --offline -- -D warnings && cargo test --offline` |
| G4 python (from M4) | `python3 -m unittest discover -s tests/python -t .` |
| G5 build | The command below the table. |
| G6 runtime | `tests/runtime/suite.sh tests/runtime/suites/m0.txt … mN.txt` (cumulative). Every scenario PASS, 0 CSP violations, 0 unexpected console errors. |
| G7 performance | The budgets listed for the milestone, measured in `perf-*` scenarios or vitest. |
| G8 review | A code review of the milestone diff, plus a security review against §3: capability diff, new commands that take paths, `{@html}`, CSP unchanged, and no `src-tauri/permissions/`. |
| G9 commit | Squash commit with the milestone title and the attribution lines. |

G5 command:

```sh
npm run build && npm run licenses:check && npm run versions:check \
  && ! grep -rE '(^|[^a-zA-Z0-9_.$])(Function|eval)[[:space:]]*\(' build/_app \
  && ! grep -rq '__gedit' build/_app
```

Harness runs need the Mac's screen: the window is visible, native events are sent, and native alerts are clicked. Runs are serialized by `tests/runtime/suite.sh` with a lock. The owner should not use the machine during G6.

---

## 5. Milestones

Order: M0 → M1 → M2 → M3 → M4 → M5. Inside a milestone: prelude, Wave A, merge, Wave B, integration, gates, commit.

### M0: Foundations (the Phase 0 cleanup, no behavior change)

**Prelude P0:**
1. Add `vitest@^3.2` with `npm install -D` (needs network).
2. Add the scripts:
   - `"test": "vitest run"` and `"test:watch": "vitest"`
   - `"licenses": "node scripts/gen-licenses.mjs"` and `"licenses:check": "node scripts/gen-licenses.mjs --check"`
   - `"versions:check": "node scripts/check-versions.mjs"`
3. Write `vitest.config.ts` with `plugins:[sveltekit()]`, `test.environment:'node'`, and `test.include:['src/**/*.test.ts','tests/unit/**/*.test.ts']`.
4. In `.gitattributes`, add `tests/fixtures/** -text` and `tests/runtime/fixtures/** -text`. In `.gitignore`, add `.perf/`.
5. In `vite.config.js`, add `define: { __APP_VERSION__: JSON.stringify(<package.json version>) }`.
6. Create `src/app.d.ts`: the standard SvelteKit `App` namespace, `declare const __APP_VERSION__: string`, and `interface Window { __gedit?: import('$lib/app/testHook').GeditTestHook }`.
7. Commit.

#### WP0.1 Test setup, fixtures and characterization tests

- **Owns:**
  - `tests/fixtures/**`, `tests/gen/**`, `tests/unit/**`
  - `src/lib/utils/{detectLanguage,gcodeParser,textCodec}.test.ts`
- **Depends on:** P0.
- **Deliver:**
  - The fixtures from §8.2. They are synthetic, and each starts with a comment saying it was written for gEdit.
  - `tests/fixtures/README.md` (provenance).
  - `tests/gen/gen-encoding.mjs`, which writes `tests/fixtures/nc/encoding/*` deterministically.
  - `tests/gen/gen-large.mjs --lines N --dialect fanuc|heidenhain [--mb 50] --out .perf/<name>`, which builds realistic programs from fixture segments.
  - Characterization tests that freeze today's behavior of `detectLanguage` (every fixture), `parseProgramStructure` (a snapshot per fixture), and `textCodec` (a byte round trip for each supported encoding fixture, plus `unsupportedContent`). Known misses are marked `// KNOWN GAP (M3)`.
- **Acceptance:**
  - `npm test` passes.
  - `git check-attr text tests/fixtures/nc/encoding/cr-only.nc` prints `unset`.
  - `tests/unit/fixtures.test.ts` shows that the committed encoding bytes equal the generator output and that `cr-only.nc` contains no 0x0A.
- **Covers:** P0 "Test setup: fixture folder …; unit tests for detection and program map".

#### WP0.2 CI, contributor guide and license notices

- **Owns:**
  - `.github/workflows/ci.yml`, `CONTRIBUTING.md`, `README.md`
  - `scripts/gen-licenses.mjs`, `scripts/check-versions.mjs`
  - `src/lib/data/licenses.json`
- **Depends on:** P0.
- **Deliver:**
  - `ci.yml`, with three jobs:
    - `checks` on ubuntu-22.04: `npm ci`, check, test, build, `licenses:check`, `versions:check`.
    - `rust` matrix on macos-14, windows-latest and ubuntu-22.04. Linux needs `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`. Steps: `npm ci && npm run build` (the `build/` folder is needed by `generate_context!`), then `cargo fmt --check`, `clippy -D warnings`, `cargo test`, using the rust cache.
    - `bundle` matrix: `npx tauri build --debug`, with the artifacts uploaded.
  - `gen-licenses.mjs`, dependency-free and deterministic:
    - npm runtime dependencies come from `npm ls --omit=dev --all --json` plus their LICENSE files, with `monaco-editor/ThirdPartyNotices.txt` included verbatim.
    - Rust crates come from `cargo metadata --format-version 1 --offline` (normal dependency kinds, all platforms): name, version, SPDX id and repository, with one canonical text per SPDX id.
    - Output: `{packages:[{name,version,license,repository,source,textId}], texts:{…}}`. `--check` fails when the output is stale.
  - `check-versions.mjs` checks that the versions in `package.json`, `tauri.conf.json` and `Cargo.toml` are equal.
  - `CONTRIBUTING.md` covers:
    - setup and commands
    - the folder layout (AD-1)
    - the conventions (AD-2 to AD-5, one-undo rule, i18n, no `eval` dependencies, own-words content, synthetic fixtures)
    - the §3 standing rules
    - how to use the harness (macOS)
  - `README.md` links to CONTRIBUTING.
- **Acceptance:**
  - Running `npm run licenses` twice gives identical output.
  - Every CI command passes locally on macOS.
  - The YAML is reviewed. GitHub itself cannot be run here.
- **Covers:** P0 "CI builds …; contributor guide; third-party license notices".

#### WP0.3 i18n and English content

- **Owns:** `src/lib/i18n/**`, `src/lib/languages/*.ts`, `src/lib/data/blocks/*.json`.
- **Depends on:** P0.
- **Deliver:**
  - `t()` per §7.8, with the glob loader and the `common` namespace.
  - The key-scan test `src/lib/i18n/keys.test.ts`.
  - The completion `documentation`/`detail` texts and the blocks `Description`/`Text` rewritten in English, in our own words.
- **Acceptance:**
  - The tests pass.
  - `grep -nP '[äöüÄÖÜß]' src/lib/languages src/lib/data/blocks` finds nothing.
- **Covers:** P0 "Rewrite completion texts in English"; P0 "Keep UI strings in one place".

#### WP0.4 Test seams in the current app

- **Owns:**
  - `src/routes/+page.svelte`
  - `src/lib/components/{Ribbon,MonacoEditor,ScriptOutputPanel}.svelte`
  - `src/lib/app/testHook.ts`
- **Depends on:** P0.
- **Deliver:**
  - The `data-testid` attributes marked "M0" in §7.9.
  - `installTestHook()`, and the stable hook `{ready, version, text, cursor, activeProfile, setProfile}` registered from `+page`.
  - No behavior change.
- **Acceptance:**
  - `svelte-check` warnings ≤ 6.
  - The production build contains no `__gedit`.
  - The M0 harness suite passes.
- **Covers:** verification infrastructure.

#### WP0.5 Runtime harness v2 in the repo

- **Owns:** `tests/runtime/**`.
- **Depends on:** P0. It codes against the §7.9 test-id contract.
- **Deliver:** a port of `SP/runtime-harness/src-tauri/src/harness.{rs,js}` and the `SP/rh3-*.sh` scripts:
  - `tests/runtime/harness/harness.rs`:
    - The plugin, with the former `setup` and `on_event` moved into the plugin builder's hooks.
    - All existing `h_*` commands, plus `h_write_disk(path, text|base64)`, `h_touch_mtime(path, secs)`, `h_pgrep(pattern)`, and `h_drop(paths)`. `h_drop` grants each path exactly as the fs plugin does, then emits `tauri://drag-drop` `{paths, position}` to `main`.
  - `tests/runtime/lib/*.js`: the helper API in §7.9.
  - `tests/runtime/scenarios/*.js`.
  - `sync.sh [--repo DIR]`:
    - Copies the repo to `$GEDIT_RH_DIR` (default `$TMPDIR/gedit-rh`) and symlinks `node_modules`.
    - Prepends `mod harness;` to `lib.rs`.
    - Inserts `.plugin(harness::plugin())` after the single `tauri::Builder::default()`, and the `harness::h_*` list after the single `generate_handler![`. Each anchor must match exactly once, or the script fails.
    - Adds `objc2 = "0.6"` as a macOS dependency if it is missing, and sets `visible:false`.
    - Runs `VITE_GEDIT_TEST=1 npm run build`, then `cargo build --features tauri/custom-protocol` with `CARGO_TARGET_DIR=$GEDIT_RH_DIR/target`.
  - `run.sh <scenario> [--home DIR] [--keep-home] [--env K=V]… [--timeout S]`:
    - Uses a fresh `HOME=<run>/home` (F13) and an explicit `GEDIT_PYTHON`.
    - Writes `out/<scenario>.json` `{pass, checks[], violations, errors, durationMs}` and exits 0 or 1.
  - `suite.sh <suite files|scenarios…>`: serial (locked), prints a PASS/FAIL table, and exits nonzero on any failure.
  - `suites/m0.txt`.
  - `README.md`: prerequisites, usage, how to add scenarios, and the allow-list of known console noise (Monaco clipboard `NotAllowedError` under synthetic events, `Canceled` rejections).
  - The M0 scenarios, all driven by test ids, the hook and native events (no visible text): `m0-main`, `m0-trusted`, `m0-native-answer`, `m0-dirty-close`, `m0-dirty-close-save`, `m0-double-close`, `m0-dirty-quit` (Cmd+Q), `m0-clean-quit`, `m0-encoding`, `m0-fix3`, `m0-py3-default`, `m0-py3-override`, `m0-py3-stub`, `m0-py3-zdotdir`.
- **Acceptance:**
  - The suite passes on the M0 build.
  - Sanity check: renaming one test id makes the matching scenario fail (then revert it).

**Integration I0:** merge, run the gates, and record the baselines in the commit body (svelte-check 0/6, clippy clean).

**Gates:** G0 to G3, G5, and G6 (`m0`), then G8.

**Commit:** `M0: Test setup, CI, license notices, i18n and runtime harness (Phase 0 cleanup)`

---

### M1: Multi-document core (registries, documents and tabs, shell, file operations, encodings)

**Prelude P1:**
- Write `src/lib/app/types.ts` with the M1 contracts in §7.1 to §7.3, and `src/lib/platform/commands.ts` with the `filesStat` wrapper (§7.6).
- Write `src/lib/app/context.ts` and extend `src/lib/app/testHook.ts` with `ctx`.
- Create stubs for every module listed as owned below, and `src/lib/contrib/README.md`.
- The prelude does **not** touch Rust in M1; WP1.4 owns `src-tauri/**`.

**Intentional behavior changes in M1:**
- Open adds a tab instead of replacing the document, so the "open with unsaved changes" prompt is gone.
- Script output moves to the bottom panel.
- The profile selector becomes a status-bar item.

H1 updates the M0 scenarios for exactly these changes.

**Wave A**

#### WP1.1 Registries, keys and palette

- **Owns:**
  - `src/lib/app/registry/**`, `src/lib/app/contributions.ts`, `src/lib/core/keys/**`, `src/lib/app/keys/**`, `src/lib/app/modals.ts`
  - `src/lib/components/common/{QuickPick,ModalHost}.svelte`
  - `src/lib/utils/platform.ts` (and its test)
  - `src/lib/contrib/palette.ts`, `src/lib/i18n/en/core.ts`
- **Depends on:** P1.
- **Deliver:**
  - The command, ribbon, panel and status-item registries (§7.1), with disposers, the `changed` store and `setContextProvider`.
  - The contribution loader (AD-3).
  - `core/keys/keySpec.ts`: `parse`, `format` (`⇧⌘S` / `Ctrl+Shift+S`, and `⌃` for Ctrl on macOS), `toMonaco` (with `KeyMod`/`KeyCode` injected), `matches` and `conflicts`.
  - The dispatcher (AD-4).
  - The Monaco bridge (`addEditorAction` and the removals, re-synced when `commands.changed` fires).
  - `modals.quickPick`; `prompt` and `form` throw until M2.
  - QuickPick: substring filter, arrow keys, Enter, Esc and mouse.
  - `view.commandPalette`, which focuses the editor and then triggers `editor.action.quickCommand`.
  - `platform.ts` drops `shortcutLabel` (replaced by `keySpec.format`).
- **Tests:**
  - keySpec: macOS and other labels, F-keys, Ctrl vs Mod, Monaco numbers.
  - Dispatcher, with fake events: `defaultPrevented`, composing, `AltGraph`, inputs, a Monaco ancestor, modal open.
  - Registry: a duplicate id throws, dispose works, enablement gates `run` (a disabled run returns false and shows a status message), and a conflict logs an error.
- **Covers:** "Monaco features exposed in the command palette" (base); "default shortcuts" (mechanism).

#### WP1.2 Documents and editor

- **Owns:**
  - `src/lib/stores/documents.ts` (and its test)
  - `src/lib/monaco/{core,setup,types,editorService}.ts`
  - `src/lib/components/editor/{EditorHost,TabBar}.svelte`
  - `src/lib/contrib/{tabs,cursor}.ts`, `src/lib/i18n/en/tabs.ts`
- **Depends on:** P1.
- **Deliver:**
  - `DocumentStore` (§7.2).
  - `EditorService` (§7.2) following AD-5, including the single spanning `ContentChange` and a rAF-throttled cursor.
  - EditorHost: the container, `attach` on mount, and the load error message.
  - TabBar:
    - name, dirty dot, full-path tooltip, close button
    - middle-click runs `file.close`
    - pointer-event reorder, overflow scroll
    - `external` markers
    - test ids
  - `contrib/tabs.ts`: `view.nextTab` (Ctrl+Tab), `view.prevTab` (Ctrl+Shift+Tab), and `view.switchTab` (Mod+Alt+O, a QuickPick of the open documents).
  - `contrib/cursor.ts`: the cursor status item.
  - `setup.ts` keeps the legacy grammars.
- **Tests:** the store (dirty derivation, reuse of untitled indices, activation on remove, move, `byPath` case rules with the platform injected).
- **Covers:** "Multiple documents in tabs"; P0 "Move document state out of `+page.svelte`".

#### WP1.3 Text codec

- **Owns:** `src/lib/core/text/**`, and `src/lib/utils/textCodec.ts` with its test (it becomes a re-export shim of the old API).
- **Depends on:** P1.
- **Deliver:** `decodeFile`, `encodeFile`, `detectEol` and `fnv1a32` (§7.2), implementing AD-7.
- **Tests:**
  - A byte-exact round trip for every encoding fixture except `nul-inside` and `mixed-eol`.
  - An edited save keeps CR, LF and CRLF.
  - A mixed file takes the majority ending, and a tie goes to CRLF.
  - A Windows-1252 character that cannot be encoded reports its line and column.
  - UTF-16 LE and BE round trip.
  - More than 10 % inner NUL is refused; the leader and trailer are kept.
  - A 5 MB decode takes ≤ 200 ms in node.
- **Covers:** "Encoding and line endings" (logic).

#### WP1.4 Rust shell

- **Owns:** `src-tauri/src/**`. No dependency changes.
- **Depends on:** P1.
- **Deliver:**
  - Split `lib.rs` into `python.rs` (the resolver and its tests), `scripts_v1.rs` (the v1 commands, `resolve_script` and their tests), `menu.rs` (the macOS menu, `request_quit`, `request_close_window`) and `files.rs` (`files_stat`, §7.6).
  - `lib.rs` keeps one `tauri::Builder::default()`, one `generate_handler![`, `fn setup_app`, and `.build(ctx).run(on_run_event)`.
  - Menu:
    - Remove both predefined `close_window` items.
    - Add a custom "Close Window" item with `CmdOrCtrl+Shift+W` in File and Window. It calls `request_close_window`, which is the guarded `window.close()`.
    - Keep Quit, Edit, View and Window otherwise.
- **Tests (cargo):**
  - The menu has no predefined `close_window` and has the custom item with its accelerator.
  - `request_close_window` emits `CloseRequested` (a mock, like the existing quit test).
  - The quit test still passes.
  - The `files_stat` core, with a scope predicate injected: allowed, forbidden, missing, a directory, read-only.
- **Covers:** "Close …" (Cmd+W now closes the tab); prepares external change detection.

**Wave B** (after Wave A is merged)

#### WP1.5 Shell, panels and status

- **Owns:**
  - `src/routes/+page.svelte`, `src/lib/app/{bootstrap,status}.ts`, `src/lib/stores/layout.ts`
  - `src/lib/components/shell/**`, `src/lib/components/panels/**`
  - `src/lib/contrib/{programMap,blocks,scriptsV1,view}.ts`, `src/lib/utils/insertBlock.ts`
  - `src/lib/i18n/en/{shell,programMap,scripts,view,blocks}.ts`, `src/app.css`
  - Deletes `src/lib/components/{Ribbon,MonacoEditor,ScriptOutputPanel}.svelte`.
- **Depends on:** WP1.1, WP1.2.
- **Deliver:**
  - `+page.svelte` is at most 10 lines and renders `<AppShell/>`.
  - `bootstrap.ts`:
    1. Sets the context provider.
    2. Loads the contributions.
    3. Installs the dispatcher.
    4. After `editor.ready`, installs the Monaco bridge.
    5. Installs the test hook.
    6. Sets `data-ready="1"` on the app shell.
  - AppShell with the AD-6 regions and splitters.
  - The Ribbon, built from the registry: tabs, groups, custom groups, tooltips with platform shortcuts, disabled state, horizontal scroll.
  - The StatusBar, built from the status items.
  - `LayoutStore` and `StatusService` (§7.2). Messages clear after 4 s, errors after 8 s.
  - `ProgramMapPanel`, still on the legacy `parseProgramStructure` with a 300 ms debounce. A click calls `editor.reveal`.
  - ScriptOutputPanel (v1) in the bottom region.
  - `contrib/view.ts`: toggles for the left and bottom panels, and show Output.
  - `contrib/blocks.ts`: the Insert tab from the blocks JSON; `insert.block:<id>` calls `editor.insertText`.
  - `contrib/scriptsV1.ts`: pick folder, list, run, with the same `scripts-*` test ids.
  - `app.css`: every chrome color becomes a CSS variable (dark values for now).
  - Every UI string goes through `t()`.
- **Acceptance:**
  - svelte-check reports 0 warnings.
  - Keyboard focus is visible.
  - At 1366×768 every ribbon control can be reached.
- **Covers:** P0 "document store" (UI part); layout principles.

#### WP1.6 File operations

- **Owns:**
  - `src/lib/app/{fileOps,dialogs}.ts` (and their tests), `src/lib/stores/profiles.ts` (the legacy adapter)
  - `src/lib/contrib/{files,encoding,profileSelect}.ts`, `src/lib/components/status/**`
  - `src/lib/i18n/en/{files,encoding,profiles}.ts`
- **Depends on:** WP1.1 to WP1.4.
- **Deliver:**
  - `NativeDialogs` (§7.2). Its filters follow AD-7.
  - `FileOps` (§7.2):
    - Open: multi-select; focuses a document that is already open; decode; a refused file gets an error dialog and a status message; detection through `profiles.detect`; stripped NULs set `metaDirty` and show a notice; a mixed EOL shows a notice; the disk stamp comes from `filesStat`.
    - Save: an untitled document goes to Save As; saving a clean document that exists is a no-op; an unencodable character asks "Save as UTF-8" or Cancel; then write, mark clean and stamp.
    - Save As: rejects the path of another open document.
    - Save All: untitled documents get Save As one after another, and Cancel aborts the rest.
    - Close: asks Save / Don't Save / Cancel. Closing the last document opens a fresh untitled one.
    - Close All and `confirmQuit`: **one** dialog that names up to 10 documents and adds "+N more", with Save All / Discard All / Cancel.
    - `setEncoding`; `setEol` (crlf and lf use `setModelEol`, which is undoable; `cr` only changes the metadata); `setProfile`; `reloadFromDisk`; `readDisk`.
    - Events: `onDidOpen`, `onDidSave`, `onWillQuit`.
  - `contrib/files.ts`:
    - Commands `file.new` (Mod+N), `file.open` (Mod+O), `file.save` (Mod+S), `file.saveAs` (Mod+Shift+S), `file.saveAll` (Mod+Alt+S), `file.close` (Mod+W) and `file.closeAll`, all `global`, in the Home "File" group.
    - `activate()` installs:
      - the close guard: `onCloseRequested`, then `preventDefault`, then `dialogs.exclusive(confirmQuit)`, then the `onWillQuit` handlers, then `destroy()`
      - the window title `● name — gEdit`
      - the drag-and-drop listener: `getCurrentWebview().onDragDropEvent` on drop runs `filesStat`, then `files.open(files only)`; folders are ignored with a status message
      - the initial untitled document
  - `contrib/encoding.ts`: status items for encoding and EOL (`CRLF (mixed)`) that open a QuickPick, and the commands `file.setEncoding` and `file.setEol`.
  - `contrib/profileSelect.ts`: the profile status item, a QuickPick, and `file.setProfile`.
  - `stores/profiles.ts`: a `ProfileRegistry` adapter (M1 subset) over `DIALECTS` and `detectLanguage`.
- **Tests (vitest with fake dialogs, fs and editor):**
  - focusing an existing document
  - untitled numbering
  - the close decision table
  - the combined quit dialog text and the Save All order, including an untitled chain and Cancel
  - the save pipeline keeps encoding, EOL, BOM and NUL leader/trailer
  - the UTF-8 fallback
  - the no-op save
  - filters per platform
- **Covers:** "New untitled document"; "Close, close all, save all"; "Open files" (multi-select, drag and drop, focus if already open); "Encoding and line endings" (UI).

#### H1 Harness M1

- **Owns:** `tests/runtime/scenarios/**`, `tests/runtime/suites/m1.txt`.
- **Depends on:** Wave A.
- **Scenarios:**
  - `m1-open-multi`: a fake multi-select of 3 files gives 3 tabs; opening one again focuses it; the title follows.
  - `m1-tabs`:
    - 2 untitled documents plus files
    - undo and cursor are kept per tab
    - middle-click close, pointer reorder, Ctrl+Tab
    - closing a dirty tab shows the real alert with Save / Don't Save / Cancel
  - `m1-encoding2`, for every encoding fixture:
    - An unedited save does not write (the mtime is unchanged).
    - An edit and save gives the expected bytes (checked with `h_hex`): CR-only, CRLF, LF, UTF-8 BOM, Windows-1252, UTF-16LE, and NUL leader and trailer.
    - A mixed file saves with the majority ending.
    - Inner NULs are counted and the document is marked modified.
    - A binary file is refused.
  - `m1-quit-multi`: with 2 dirty documents, native Cmd+Q, the red button and `window.close()` each show exactly one combined alert. Cancel keeps the window; Discard All exits.
  - `m1-keys`:
    - native Cmd+W closes exactly one tab
    - Cmd+S saves exactly once, with the editor focused and with a ribbon button focused
    - Cmd+Shift+W closes the window through the guard
    - Ctrl+Tab switches tabs
    - F1 lists the `gedit.*` commands with their shortcuts
  - `m1-dnd`: `h_drop([a.nc, b.h, dir])` gives 2 tabs and a status message for the folder.
  - `m1-layout`: at 1366×768 the ribbon scrolls, panels collapse and expand, and Output is in the bottom panel.
  - `m1-perf-open`: a generated 10 MB, 300k-line file.
  - Updates to the M0 scenarios for the intentional changes listed above.

**Integration I1:** merge, wire, and delete the `textCodec` shim if it is no longer used.

**Gates:**
- G0 to G3, G5, and G6 (`m0` + `m1`).
- G7:
  - 10 MB / 300k-line open in ≤ 2 s to first render
  - tab switch on that document in ≤ 100 ms
- G8.

**Commit:** `M1: Multi-document core: tabs, registries, file operations and encodings`

---

### M2: Persistence and chrome (settings, state, recent files, external changes, compare, themes, About)

**Prelude P2:**
- `cd src-tauri && cargo add tauri-plugin-window-state@2` (needs network).
  - Register it in `lib.rs` with all state flags except `VISIBLE`.
  - **Verify** the flags type and the builder method names in `R/tauri-plugin-window-state-2.*/src/lib.rs`, and adapt.
  - Record where its file is written.
- Rust stub modules `paths.rs`, `atomic.rs`, `config.rs` and `state.rs` with the M2 commands (§7.6), registered in the handler.
- `setup_app` calls `paths::ensure_dirs` and `state::grant_recent_on_startup`.
- Capability: `+ core:window:allow-set-theme`.
- TS:
  - Extend `app/types.ts` (§7.3), write `core/settings/schema.ts` in full (§7.7) and `core/forms/types.ts` (§7.5), and add the M2 wrappers to `platform/commands.ts`.
  - Stubs: `stores/{settings,uiState,recent}.ts`, `app/{external,compare,theme}.ts`, `monaco/{editorOptions,theme,diff}.ts`.
  - In `bootstrap.ts`, `await settings.load(); await uiState.load()` before the contributions load.
- `npm run licenses`, then commit.

**Wave A**

#### WP2.1 Rust persistence

- **Owns:** `src-tauri/src/{paths,atomic,config,state}.rs`.
- **Depends on:** P2.
- **Deliver:** everything in AD-8 and AD-9 on the Rust side, following the §7.6 signatures:
  - Atomic writes: a temp file in the same folder, fsync, then rename.
  - A 1 MiB cap, JSON objects only, `.bak` for a bad file, read-only mode for a newer `$version`.
  - `recent_touch`: the `is_allowed` check, dedupe (case-insensitive on macOS and Windows), newest first, and the cap.
  - Startup grants: both the given and the canonical path, at most 50.
  - `ensure_dirs` creates `<config>/scripts`.
- **Tests (cargo):**
  - A simulated failure leaves no partial file and no temp file.
  - Invalid JSON gives the defaults plus an error, and `.bak` is written on the next save.
  - A newer version is not written.
  - A non-object is refused, and the size cap holds.
  - The pure functions for the recent list (dedupe, cap, case).
  - After a grant through a mock app with the fs plugin, `is_allowed` is true.
- **Covers:** "Storage layout"; "Recent files" (backend); "window state".

#### WP2.2 Forms and modals

- **Owns:**
  - `src/lib/core/forms/{validate,values}.ts` (and their tests)
  - `src/lib/components/forms/**`
  - `src/lib/components/common/{Modal,PromptInput}.svelte`
  - `src/lib/app/modals.ts`, `src/lib/i18n/en/forms.ts`
- **Depends on:** P2.
- **Deliver:**
  - `validateFields` and `initialValues` (§7.5). Values are never corrected silently.
  - `FormRenderer` with every field type:
    - `file` and `folder` use the native dialogs
    - `address-list` shows checkboxes from `choices`
    - help text and errors appear next to each field
  - `Modal`: a focus trap; Esc cancels; Enter confirms.
  - `modals.prompt` and `modals.form`.
  - Test ids.
- **Tests:** every field type, `required`, `min`/`max`, integer, decimals, choices, and remembered values.
- **Covers:** "One form engine" (settings, transform options, script parameters).

#### WP2.3 Recent files, external changes and UI state

- **Owns:**
  - `src/lib/stores/{uiState,recent}.ts` and `src/lib/app/external.ts` (and their tests)
  - `src/lib/components/editor/ExternalChangeBanner.svelte`, `src/lib/components/menus/RecentMenu.svelte`
  - `src/lib/contrib/{recent,externalChange,layoutPersist}.ts`
  - `src/lib/i18n/en/{recent,external}.ts`
- **Depends on:** P2.
- **Deliver:**
  - `UiStateStore`: saved with a 1 s debounce, and flushed in `files.onWillQuit`.
  - `layoutPersist`: restores the layout, then persists it.
  - Recent files:
    - `files.onDidOpen` and `onDidSave` call `recentTouch(path, files.recentLength)`.
    - A Home "Recent" dropdown, with missing entries marked and a Clear entry.
    - `file.openRecent` (a QuickPick; a missing entry offers to remove it) and `file.clearRecent`.
  - External changes, following AD-10:
    - The banner lives in the `banner` region and has buttons with `data-action=reload|keep|compare`.
    - Compare runs `compare.withSaved`.
    - Keep mine sets `metaDirty` and updates the stamp, so the banner does not repeat.
    - A deleted file gets the marker, `metaDirty`, and a banner with Keep.
- **Tests:**
  - The external decision table, with a fake clock, stat and read:
    - own write → silent
    - touch with the same content → silent
    - changed → event
    - deleted → event
    - unfocused → no poll
    - clean with `reload` → reload
  - uiState debounce and flush.
- **Covers:** "Recent files"; "External change detection"; "Last-used parameters" (storage).

#### WP2.4 About and shortcuts

- **Owns:**
  - `src/lib/components/dialogs/{AboutDialog,ShortcutsDialog}.svelte`
  - `src/lib/contrib/help.ts`, `src/lib/i18n/en/help.ts`
- **Depends on:** P2.
- **Deliver:**
  - About:
    - `__APP_VERSION__` and the MIT license
    - third-party notices loaded with a lazy `import()` of `licenses.json`, with expandable texts
    - the repository and issue URLs as copyable text
    - "No update check"
  - Shortcuts: every command with its platform keys, grouped and filterable.
  - The commands `help.about` and `help.shortcuts` in a View "Help" group.
- **Tests:** the pure function `shortcutRows(commands, isMac)`.
- **Covers:** "About and licenses"; "default shortcuts, shown everywhere".

#### WP2.5 Compare

- **Owns:**
  - `src/lib/monaco/diff.ts`, `src/lib/components/editor/CompareView.svelte`
  - `src/lib/app/compare.ts` (and its test)
  - `src/lib/contrib/compare.ts`, `src/lib/i18n/en/compare.ts`
- **Depends on:** P2.
- **Deliver:**
  - `CompareService` (§7.3), in the overlay region.
  - Original side: the other document's live model, or a temporary model from `files.readDisk`, read-only. Modified side: the active model, editable.
  - Toolbar: side by side or inline, ignore trim whitespace, next and previous difference (`goToDiff`), and close (Esc).
  - If either side is larger than 50 MB, a status error is shown and no diff is built (F8).
  - The commands:
    - `compare.with` (Mod+Alt+C: a QuickPick of Open document… / File… / Saved version)
    - `compare.withDocument` (a QuickPick when more than 2 documents are open)
    - `compare.withFile`
    - `compare.withSaved` (argument `{docId}`; disabled for untitled documents)
    - `compare.close`, `compare.nextDiff`, `compare.prevDiff`, `compare.toggleInline`
  - Temporary models are disposed. The documents are never modified. The view state is restored on close.
- **Tests:** target selection (pure).
- **Covers:** "Compare with an open document, a file or the saved version"; "What Monaco's diff editor provides".

#### WP2.6 Settings store, theme and editor options

- **Owns:**
  - `src/lib/core/settings/{merge,migrate}.ts` (and their tests), `src/lib/stores/settings.ts`
  - `src/lib/monaco/{editorOptions,theme}.ts`, `src/lib/app/theme.ts`
  - `src/lib/contrib/theme.ts`, `src/app.css`, `src/lib/i18n/en/theme.ts`
- **Depends on:** P2.
- **Deliver:**
  - `SettingsStore` (§7.3):
    - Effective values are the defaults merged with the user file. Invalid values fall back to the default with a warning. Unknown keys are kept.
    - `save` writes only non-default values, with sorted keys.
  - `editorOptions`: maps the settings to editor options and model options (the latter via `onDidCreateModel` and for existing models), live:
    - `stickyScroll: {enabled, defaultModel: 'outlineModel'}`
    - `assist.completion` → `quickSuggestions`
  - `app/theme.ts`:
    - `system` follows `matchMedia` with a listener
    - sets `data-theme`
    - calls `setMonacoTheme(mode)` (`vs`/`vs-dark` in M2; M3 switches to the generated themes)
    - calls `getCurrentWindow().setTheme(mode === 'system' ? null : mode)`
  - Light-theme variables in `app.css`.
  - `view.setTheme(mode)`.
- **Tests:** merge, diff to defaults, migrate, unknown keys kept, invalid values dropped.
- **Covers:** "Light/dark/system theme"; the editor settings.

**Wave B**

#### WP2.7 Settings dialog

- **Owns:**
  - `src/lib/components/dialogs/SettingsDialog.svelte`
  - `src/lib/contrib/settings.ts`, `src/lib/i18n/en/settings.ts`
- **Depends on:** WP2.2, WP2.6.
- **Deliver:**
  - Categories Appearance, Editor, Assistance, Files and Scripts, rendered by `FormRenderer` from `SETTING_FIELDS` (the fields marked `dialog: true`).
  - Save and Cancel; "Reset category" with a confirmation.
  - "Open settings file" (`settingsOpenFile`, then `files.open`).
  - The Scripts page shows the user scripts folder (copyable).
  - The `files.defaultProfile` choices come from the profile registry.
  - `settings.open` (Mod+,) replaces "Settings (TBD)".
  - When `files.onDidSave` fires for the settings file path, `settings.reloadFromDisk()` runs.
- **Tests:** every `SETTING_FIELDS` label and help key exists in the `settings` namespace.
- **Covers:** "Basic settings dialog".

#### H2 Harness M2

- **Scenarios:**
  - `m2-settings`:
    - save writes only the changed keys
    - the font size applies live
    - a broken `settings.json` at startup gives the defaults plus a notice, and `.bak` after a save
  - `m2-recent-restart`: two runs share `--home`. In run 2 the file opens from the recent list without a dialog, and a missing entry is marked.
  - `m2-external`:
    - `h_write_disk` on a clean document reloads it, and one undo restores the old text
    - a dirty document shows the banner, and Reload, Keep mine and Compare all work
    - deleting the file shows the marker
  - `m2-window-state`: resize and move in run 1; the geometry is restored in run 2.
  - `m2-theme`: system, light and dark change the computed `--bg` and the Monaco theme.
  - `m2-compare`:
    - compare with the saved version, with another document and with a file
    - closing restores the editor
    - the model count is unchanged
    - the 50 MB guard works (generated file)
  - `m2-about`: the version and the notices are present.

**Gates:**
- G0 to G3, G5, and G6 (`m0` to `m2`).
- G7: no regression of the M1 budgets.
- G8, which also checks that the capability diff is exactly `+core:window:allow-set-theme`.

**Commit:** `M2: Settings, state, recent files, external changes, compare, themes and About`

---

### M3: Dialect profiles and the NC language (profiles, tokenizer, code database, grammar, program map, navigation, hover, completion)

**Prelude P3:**
- Write `core/profiles/types.ts` (§7.4) and implement `core/profiles/compile.ts` (small).
- Write `src/lib/data/profiles/{fanuc-gcode,heidenhain-klartext}.json` from the examples in `docs/planning/dialect-profiles.md`, adding `shortName` and `filterName`. Fanuc keeps `min` (weight 2) until the Okuma profile exists.
- Write `core/nc/types.ts` and `core/codes/types.ts`, and extend `app/types.ts` (§7.3).
- Stubs: `stores/codes.ts`, `app/outlineService.ts`, `core/nc/tokenizer.ts`, `core/grammar/index.ts`.
- Update `context.ts`, then commit.

**Wave A**

#### WP3.1 Profiles and detection

- **Owns:**
  - `src/lib/data/profiles/**`
  - `src/lib/core/profiles/{validate,detect,compile}.ts` (and their tests)
  - `src/lib/stores/profiles.ts`, `src/lib/contrib/profileSelect.ts`
  - `src/lib/utils/{detectLanguage,dialects}.ts` and their tests (they become shims)
  - `tests/fixtures/expected/detect/**`, `src/lib/i18n/en/profiles.ts`
- **Depends on:** P3.
- **Deliver:**
  - The validator. Errors carry the path, such as `outline[2].pattern`. Unknown fields are kept.
  - Detection following AD-11.
  - The real `ProfileRegistry` (§7.3), validated at startup. Open and save filters, default names and the new-file EOL come from the profiles. The default id comes from `files.defaultProfile`.
  - The status picker uses the registry.
- **Tests:**
  - The built-ins validate, and a bad regex is reported with its path.
  - Detection on every fixture, ties, folders, the 400-line limit, and the strongest pattern per line.
  - The M0 characterization results are the same or listed as improvements.
  - The pattern-subset scan (AD-11).
- **Covers:** "Built-in profiles as JSON"; "Detection … replace hardcoded logic".

#### WP3.2 NC tokenizer and number format

- **Owns:**
  - `src/lib/core/nc/{tokenizer,numbers,numberFormat,mask}.ts` (and their tests)
  - `tests/fixtures/tokens/**`, `tests/fixtures/numberformat.cases.json`
- **Depends on:** P3.
- **Deliver:** everything in §7.4 (tokens and numbers). The tokenizer handles:
  - packed words (`N10T1M6`)
  - `( )` comments, where an unclosed one runs to the end of the line
  - `;` comments that leave a trailing `~` as `continuation`
  - N-prefix or leading-integer block numbers
  - skip marks `/`, `/1` before or after the number
  - `,R` and `,C` words
  - macro keywords before single-letter addresses (`GOTO`, `IF`, `WHILE`, …)
  - `#` variables, `#[…]` and bracket expressions, and `Q`/`QL`/`QR`/`QS` variables
  - strings
  - Klartext multi-word keywords (`TOOL CALL`, `CYCL DEF`, `BEGIN PGM`, `BLK FORM`, `CALL LBL`, `LBL`, `FN n:`, …)
  - the `I` incremental prefix, `FMAX` and `FAUTO`, `DR±`
  - `%` and `O`/`:` program numbers

  `formatNumber` works on decimal strings and rounds half away from zero.
- **Tests:**
  - Golden files with at least 60 lines per profile, covering every line class in `syntax-fanuc` §3 and `syntax-heidenhain` §3, for example `X10.`, `F.15`, `G54.1`, `(A) X10 (B)`, unclosed `(`, `/1`, `N120/`, `#1=[#2+1]`, `GOTO10`, `,R1.`, `TOOL CALL "D10" Z S5000`, `Q200=2 ;TEXT ~`, `IX+10`, `FMAX`, `DR-`, `LBL "A"`.
  - At least 40 number-format cases.
  - 300k lines tokenize in under 1 s in node (the assertion allows < 3 s).
- **Covers:** "NC tokenizer"; "Number formatting".

#### WP3.3 Code database

- **Owns:**
  - `src/lib/data/codes/**`
  - `src/lib/core/codes/{load,lookup}.ts` (and their tests), `src/lib/stores/codes.ts`
- **Depends on:** P3.
- **Deliver:**
  - `fanuc.json` and `heidenhain.json` in the spec format (§7.4), written in our own words. Uncertain entries get `verify: true` and are left out of hover.
  - Fanuc CAM subset: G0–G4, G17–G19, G20/G21, G28, G40–G43, G49, G53–G59, G54.1, G73, G74, G76, G80–G89, G90/G91, G94/G95, G96/G97, G98/G99, and G32/G33 (`pitchFeed`); M0–M9, M19, M30, M98, M99; the address letters.
  - Klartext subset: L, C, CC, CR, CT, RND, CHF, LBL, CALL LBL, CALL PGM, TOOL CALL, TOOL DEF, CYCL DEF 200/201/203/205/206/207/209/240, CYCL CALL, FMAX, FAUTO, R0/RL/RR, BEGIN/END PGM, BLK FORM, and the common M codes. PLANE and FUNCTION TCPM are marked `verify`.
  - `pitchFeed` on G74, G84, G32, G33, G76 and the Klartext tapping cycles.
  - Cycle `params`.
  - The lookup normalizes case and zero padding (`G01` → `G1`) and keeps decimal parts.
- **Tests:**
  - No duplicate codes or aliases.
  - Every `pitchFeed` code is in the cycle or motion group.
  - `G01` finds G1, `g83` finds G83, `G54.1` and `CYCL DEF 200` are found.
  - `completions('G8')` returns G80–G89.
- **Covers:** "Hover explanations" (data); P0 "move completions toward the code database".

**Wave B**

#### WP3.4 Grammar, themes and language registration

- **Owns:**
  - `src/lib/core/grammar/**`
  - `src/lib/monaco/{languages,theme,setup,core}.ts`
  - Deletes `src/lib/languages/**`.
- **Depends on:** WP3.1, WP3.3.
- **Deliver:**
  - The `iso` generator (rule order from `syntax-fanuc` §3.8) and the `klartext` generator (`syntax-heidenhain` §3.2). Both emit role tokens with `defaultToken ''`.
  - `ROLE_COLORS` (dark and light) and the generated `gedit-dark` / `gedit-light` themes.
  - `languages.registerAll()`: `register`, `setLanguageConfiguration` (Fanuc `blockComment ['(', ')']`, Klartext `lineComment ';'`, brackets, a `wordPattern` suited to NC words) and `setMonarchTokensProvider`.
  - `setMonacoTheme` switches to the generated themes.
  - `setup.ts` loses the legacy registrations.
- **Tests:**
  - Every generated regex compiles, with a snapshot per profile.
  - Every role color passes WCAG AA against the editor background, in both themes.
- **Covers:** "Generated grammar and role colors".

#### WP3.5 Outline, navigation and program map v2

- **Owns:**
  - `src/lib/core/profiles/outline.ts` (and its test), `src/lib/core/nav/**`, `src/lib/app/outlineService.ts`
  - `src/lib/monaco/providers/{symbols,folding}.ts`
  - `src/lib/components/panels/ProgramMapPanel.svelte`
  - `src/lib/contrib/{programMap,navigation}.ts`
  - `tests/fixtures/expected/outline/**`, `src/lib/i18n/en/{programMap,navigation}.ts`
  - Deletes `src/lib/utils/gcodeParser.ts` and its test.
- **Depends on:** WP3.1, WP3.2.
- **Deliver:**
  - `OutlineIndex` (§7.4):
    - Rules: the first matching rule wins. `comment` and `section` rules see the raw line; code rules see the masked line.
    - `toolFrom: same-line-or-last` takes the tool from the same line or the last `T` before it, and a bare `T` is not a tool change.
    - A two-level tree, with comments and sections as children of their tool segment.
    - Tool labels are `T<n>` plus the nearest descriptive comment: trailing on the line, otherwise within 3 lines above, otherwise within 2 lines below, filtered by `toolList.commentFilter`.
    - `endLine` for folding.
  - `OutlineService`:
    - The first build runs after the first render, in 20k-line chunks.
    - `applyChange` runs on every content change; aggregation is debounced by 150 ms.
  - The symbol provider (quick outline) and the folding provider (tool segments, programs, sections), registered per profile.
  - The program map:
    - kind icons, tool rows, the two-level tree
    - the active row follows the cursor
    - a click reveals the line
  - `nav.goto` (Ctrl+G) removes Monaco's `editor.action.gotoLine` binding and opens a PromptInput:
    - `120` is a line
    - `N120` is a block number: the profile's prefix, or the leading integer for Klartext
    - with duplicates, the next occurrence after the cursor
    - if not found, a message is shown and the cursor does not move
  - `nav.nextTool` (F7) and `nav.prevTool` (Shift+F7), which wrap with a status message.
- **Tests:**
  - Outline goldens per fixture. They include the cases M0 marked as known gaps: `T1M6`, `N10T1M06`, `M06T1`, `T1 G43 M6`, a `T` alone and then `M6`, `(T1 M6)` inside a comment (ignored), and Klartext `TOOL CALL Z S5000` (not a tool change).
  - A property test: `applyChange` gives the same result as `reset` over 1,000 random edits.
  - A single-line change on 300k lines updates in ≤ 10 ms.
  - Go-to cases, and the tool navigation wrap.
- **Covers:** "Program map from profile rules, plus quick outline, folding and sticky scroll"; "Go to line or block number"; "Next and previous tool change"; "outline runner replaces hardcoded logic".

#### WP3.6 Assistant

- **Owns:**
  - `src/lib/monaco/providers/{hover,completion}.ts`
  - `src/lib/core/codes/{hoverText,completionItems}.ts` (and their tests)
  - `src/lib/contrib/assistant.ts`, `src/lib/i18n/en/assistant.ts`
- **Depends on:** WP3.2, WP3.3.
- **Deliver:**
  - Hover:
    - shows the code or address label and description, and group or modal
    - variables show only their kind
    - an unknown code is shown as unknown
    - text is escaped markdown, untrusted
    - the `assist.hover` setting is respected
  - Completion:
    - from the dictionary, filtered by prefix
    - Klartext keywords at the start of a block
    - nothing inside comments (checked with the tokenizer)
    - cycles insert snippets with tab stops built from their required `params`
    - `assist.completion` set to `off` disables the provider
- **Tests:** the pure functions (hover for G83 and M8, `G8` → G80–G89, no suggestions in a comment, variables show their kind only).
- **Covers:** "Hover explanations for codes and addresses"; "Dictionary-driven completion".

#### H3 Harness M3

- **Scenarios:**
  - `m3-profiles`:
    - detection on the fixtures
    - `monaco.editor.tokenize` on sample lines gives the expected roles
    - no `invalid` tokens on valid lines, including whitespace
    - tool, feed and axis get distinct colors
  - `m3-assistant`: hover text on `G83` and `M8`; the suggestions for `G8` include G81; none inside `( )`.
  - `m3-nav`: F7 cycles the tool lines and wraps; Ctrl+G with `N120`, `120`, and a missing number; Monaco's own go-to-line does not open.
  - `m3-outline`:
    - the tree kinds
    - the highlight follows the cursor
    - Mod+Shift+O lists the tools
    - a tool segment folds
    - sticky scroll shows the tool line
  - `m3-perf`: typing in a 300k-line document.

**Integration I3:** delete the `detectLanguage` and `dialects` shims once nothing imports them.

**Gates:**
- G0 to G3, G5, and G6 (`m0` to `m3`).
- G7:
  - keypress to render p95 < 50 ms at 300k lines
  - outline update after an edit ≤ 200 ms
  - 10 MB open still ≤ 2 s
- G8.

**Commit:** `M3: Dialect profiles, NC tokenizer, generated grammars, program map, navigation, hover and completion`

---

### M4: NC editing and the scripting backend (transforms, bookmarks, editor commands, Rust runner, bundled scripts)

**Prelude P4:**
- `cargo add toml@0.9`, and `libc@0.2` under `[target.'cfg(unix)'.dependencies]`. Both build offline.
- Stub `src-tauri/src/scripts/{mod,meta,discovery,runner,context}.rs` with the §7.6 commands, register them, and call `scripts::kill_all` from `on_run_event` on `Exit`.
- In `tauri.conf.json`, add `bundle.resources: { "resources/scripts/": "scripts/" }`.
- Write `src-tauri/resources/scripts/gedit_nc.py` as an **API stub** (§7.10), plus its README.
- Write the `tests/python/helpers.py` skeleton, and add a Python 3.9 and 3.12 unittest job to CI.
- `app/types.ts`: `TransformService`, `ResultsService`, `BookmarkService`. Write `core/transforms/types.ts` (§7.5) and add the script command wrappers to `platform/commands.ts`.
- Stubs, `context.ts`, `npm run licenses`, then commit.

**Wave A**

#### WP4.1 Transform framework, apply, and results

- **Owns:**
  - `src/lib/core/transforms/{scope,lineDiff}.ts` (and their tests)
  - `src/lib/monaco/applyLines.ts`, `src/lib/app/transforms.ts`, `src/lib/stores/results.ts`
  - `src/lib/components/panels/ResultsPanel.svelte`
  - `src/lib/contrib/results.ts`, `src/lib/i18n/en/{transforms,results}.ts`
- **Depends on:** P4.
- **Deliver:**
  - Scope: a selection is extended to whole lines; without one, the whole document.
  - `computeLineEdits`:
    - the same length compares line by line
    - with a `lineMap`: deletions plus changed lines
    - otherwise: trim the common prefix and suffix, then a Myers diff capped at D = 2000, falling back to one hunk
  - `applyLines` (AD-12).
  - `TransformService.run`, in order:
    1. availability, with the reason shown in the status bar
    2. the options form, pre-filled from `uiState.lastParams['transform:'+id]`
    3. the preflight confirmation
    4. the run
    5. the output: replace, or a new untitled document with the same profile (only the selected lines are copied)
    6. the summary in the status bar
    7. skipped lines shown in Results
  - `ResultsPanel`:
    - a sortable table and findings
    - a click with `line` reveals it, switching document by `docId` or by the `document` name
    - Copy CSV (`navigator.clipboard`, with an `execCommand` fallback)
    - Open as text (in a new document)
- **Tests:**
  - scope; `lineDiff` in every branch; CSV escaping
  - 100k same-length lines in < 200 ms
- **Covers:** "Transform framework"; the results panel.

#### WP4.2 Numbering

- **Owns:**
  - `src/lib/core/transforms/{renumber,removeBlockNumbers}.ts` (and their tests)
  - `src/lib/contrib/ncNumbering.ts`
  - `tests/fixtures/transforms/{renumber,remove-block-numbers}/**`
  - `src/lib/i18n/en/ncNumbering.ts`
- **Depends on:** P4 (tokenizer from M3).
- **Deliver:**
  - Renumber with the basic options: start, step, digits, max with wrap or stop, `spacesAfter`, `skipStartingWith`, `skipEmpty`, `restartAtProgramStart`, `onlyNumbered`, `altPrefixes`.
    - Only the number at the start of a block is touched, after an optional skip mark. Nothing inside comments or strings. Alphanumeric names are left alone.
    - Klartext: consecutive from 0, skipping continuation lines, with no options form.
    - Preflight: if `numbering.references` match, a warning asks for confirmation.
  - Remove block numbers:
    - `/N100 G0` becomes `/G0`, and the space after the number is removed
    - not available when `blockNumber.mandatory` is set
  - An NC tab "Numbering" group.
- **Tests:**
  - At least 12 golden cases, including `/N100`, `N100 /`, `(N50)` inside a comment, the `GOTO` reference warning, a multi-program restart, digit padding, wrap and stop, and Klartext `~`.
  - 100k lines in < 1 s.
- **Covers:** "Renumber blocks (basic)"; "Remove block numbers".

#### WP4.3 Cleanup transforms

- **Owns:**
  - `src/lib/core/transforms/{insertSpaces,removeSpaces,removeEmptyLines,removeComments,convertCase}.ts` (and their tests)
  - `src/lib/contrib/ncCleanup.ts`
  - `tests/fixtures/transforms/{insert-spaces,remove-spaces,remove-empty-lines,remove-comments,convert-case}/**`
  - `src/lib/i18n/en/ncCleanup.ts`
- **Depends on:** P4.
- **Deliver:** follows the spec for each transform:
  - Insert spaces leaves comments, strings, expressions, keywords, `,R` and signs intact.
  - Remove spaces is unavailable when `wordSeparatorRequired` is set and never removes a keyword's space.
  - Remove empty lines on Klartext offers `nc.renumber` afterwards.
  - Remove comments options: drop emptied lines (on by default), keep the program-name comment, keep the first N lines, keep Klartext sections, keep a trailing `~`.
  - Convert case, upper or lower, excludes comments and strings (the default for upper).
  - An NC tab "Cleanup" group.
- **Tests:**
  - Goldens for every "stays intact" case in the spec.
  - 100k lines in < 1 s for each transform.
- **Covers:** "Insert spaces, remove spaces, remove empty lines, remove comments, convert case".

#### WP4.4 Bookmarks and editor commands

- **Owns:**
  - `src/lib/monaco/bookmarks.{ts,css}`
  - `src/lib/core/nav/bookmarks.ts` (and its test)
  - `src/lib/contrib/{bookmarks,editing}.ts`
  - `src/lib/i18n/en/{bookmarks,editing}.ts`
- **Depends on:** P4.
- **Deliver:**
  - Bookmarks:
    - per-model whole-line decorations with a glyph-margin codicon and an overview-ruler mark
    - `NeverGrowsWhenTypingAtEdges`
    - session only
  - Commands:
    - `bookmark.toggle` (Mod+F2), `bookmark.next` (F2), `bookmark.prev` (Shift+F2) and `bookmark.clear`
    - next and previous wrap
    - the removals of `editor.action.rename` (F2) and `editor.action.changeAll` (Mod+F2)
  - Home "Edit" and View-tab commands that wrap Monaco actions:
    - undo, redo, find, replace, toggle comment, duplicate, move and delete line, select all, upper and lower case of the selection
    - fold all, unfold all, quick outline
    - toggles for whitespace, word wrap, minimap and sticky scroll (these write the settings)
    - font zoom
  - All of these have `palette: false` where F1 already lists the Monaco action.
- **Tests:** next and previous with wrap (pure).
- **Covers:** "Bookmarks: toggle, next/previous"; "Monaco features exposed in ribbon and command palette".

#### WP4.5 Rust scripting backend

- **Owns:** `src-tauri/src/scripts/**`, `src-tauri/src/python.rs`.
- **Depends on:** P4.
- **Deliver:** everything in AD-13 and §7.6:
  - Header block:
    - the first non-empty line after an optional shebang and coding line must be `# /// gedit`, and the block ends at `# ///`
    - the header is TOML
    - an unknown field gives a warning
    - an invalid value gives `headerError`, and the script is still listed and runs in panel (v1) mode
    - `documents` other than `active` gives a warning and is treated as `active`
  - Discovery:
    - roots: bundled `resource_dir()/scripts` (read-only, hidden when `scripts.showBundled` is false), user `<config>/scripts`, and `extra<N>` from `scripts.folders` (only existing folders)
    - one subfolder level becomes a group
    - `gedit_nc.py` and files starting with `_` are skipped
    - a user script with the same file name shadows the bundled one
  - Id resolution: `root:name.py` or `root:group/name.py`; the segments are validated; the canonical path must stay under the canonical root.
  - The runner:
    - cwd is the script's folder
    - the environment from AD-13
    - on Unix, `process_group(0)` and `killpg`
    - stdout capped at 64 MiB (it keeps draining past the cap) and stderr at 1 MiB
    - `try_wait` every 20 ms
    - timeout and cancel through `RunRegistry`
    - a 300 ms drain grace
    - the temp folder is removed by an RAII guard
  - `python_check`:
    - runs `-c` with a 5 s timeout
    - requires 3.9 or newer
    - exit 9009 on Windows means Python was not found
  - `script_new` (a commented template from `include_str!`), `script_copy_to_user` and `script_source_path`. These grant only non-bundled files.
- **Tests (cargo; Unix tests use `/bin/sh` through an injectable interpreter):**
  - Header parsing: valid, missing, bad TOML, unknown field, invalid enum.
  - Discovery: groups, shadowing, `..`, absolute paths, symlink escape, a missing bundled folder.
  - Runner:
    - stdin echo, a non-zero exit
    - a timeout kills the child and its grandchild within timeout + 0.5 s
    - cancel from another thread
    - the stdout cap sets `stdoutTruncated`
    - the environment variables are present
    - the temp folder is removed
    - `kill_all` leaves no live process
  - `python_check` against a fake interpreter.
- **Covers:** "Metadata header"; "timeout and cancel"; "security rules"; "script folders" (backend).

#### WP4.6 `gedit_nc.py` and the tool list

- **Owns:**
  - `src-tauri/resources/scripts/{gedit_nc.py,tool_list.py,README.md}`
  - `tests/python/{helpers.py,test_gedit_nc.py,test_tool_list.py}`
  - `tests/fixtures/scripts/tool_list/**`
- **Depends on:** P4 (the M3 goldens).
- **Deliver:**
  - `gedit_nc.py`: the §7.10 API (standard library only, Python 3.9 syntax).
    - `to_py_regex` turns `(?<name>` into `(?P<name>` and uses `re.ASCII`, adding `re.IGNORECASE` unless `caseSensitive` is set.
    - The tokenizer and the number formatting mirror the TS versions.
    - `FeedModeTracker`: G93/G94/G95, G96/G97, the active `pitchFeed` cycle from the context `codes`, and Klartext `FU`/`FZ`.
    - `report()` and `envelope()`.
  - `tool_list.py` produces a report:
    - tools in order of first use, with the description, the line of the first call, the number of calls, and optionally the feed and speed range
    - `toolCall` with `same-line-or-last`
    - descriptions `auto`, `above`, `below` or `trailing`, with `commentFilter`
    - `dropLeadingZeros`
- **Tests:**
  - The token and number-format goldens match the TS versions.
  - Every pattern of every built-in profile compiles in Python.
  - `FeedModeTracker`.
  - Tool-list cases:
    - a preselect `T2` after `T1 M6` is not a tool change
    - `M06T1`
    - the description modes
    - Klartext by number and by name
    - `TOOL CALL Z S5000` is not a tool change
- **Covers:** "Bundled: tool list"; "NC tokenizer … Python shares the fixtures".

**Wave B**

#### WP4.7 Feed and speed scaling

- **Owns:**
  - `src-tauri/resources/scripts/{scale_feed.py,scale_speed.py}`
  - `tests/python/{test_scale_feed,test_scale_speed}.py`
  - `tests/fixtures/scripts/{scale_feed,scale_speed}/**`
- **Depends on:** WP4.6.
- **Deliver:** every edge case in `nc-transformations.md`.
  - Scale feed:
    - Klartext `FMAX` and `FAUTO` are left alone.
    - G95 and G93 are skipped by default, with an option to scale them.
    - `pitchFeed` blocks are never scaled and are reported.
    - Variables and expressions are skipped and reported.
    - Klartext cycle Q feeds are listed and left unchanged.
  - Scale speed:
    - G96 and `G50`/`G92 S` are skipped by default, with options to scale them.
    - Tapping blocks get a warning.
    - Klartext `S` in `TOOL CALL` is scaled.
    - Speeds are integers by default.
  - Decimal arithmetic uses `decimal.Decimal` with `ROUND_HALF_UP`, formatted like the TS version.
  - The header declares the parameters: percentage, decimals, min, max, only above, only below, and the options.
  - Output is `envelope` with `message` and `findings`.
- **Tests:** golden cases for each edge case.
- **Covers:** "Bundled: scale feed rates, scale spindle speeds".

#### H4 Harness M4

- **Scenarios:**
  - `m4-transforms`:
    - each transform on its fixture gives the golden output
    - one Cmd+Z restores the text exactly
    - the new-tab target works
    - a bookmark on an untouched line survives remove-empty-lines and renumber
  - `m4-bookmarks`: toggle, next and previous with wrap; F2 does not open the rename widget.
  - `m4-editing-cmds`: every ribbon button runs its command; F1 lists the gEdit commands; clipboard copy and paste round-trip.
  - `m4-perf-transform`: renumber on 100k lines.
  - `m4-scripts-backend`, at the IPC level:
    - `scripts_list` shows the 3 bundled scripts with their metadata
    - `script_run tool_list` on a fixture returns the report JSON
    - timeout and cancel work, and `h_pgrep` then finds nothing
    - ids with `../`, absolute paths and an unknown root are refused

**Gates:**
- G0 to G5, and G6 (`m0` to `m4`).
- G7:
  - each transform, pure, on 100k lines ≤ 1 s
  - apply ≤ 2 s
  - one undo step
- G8.

**Commit:** `M4: NC transforms, bookmarks, editor commands, scripting backend and bundled scripts`

---

### M5: Scripting UI, performance pass and Phase 1 exit criteria

**Prelude P5:**
- `app/types.ts`: `ScriptService` (§7.3). Write `core/scripting/types.ts` (§7.5) and the stubs.
- `bootstrap.ts`: run `pythonCheck()` after the first render.
- Commit.

**Wave A**

#### WP5.1 Script runtime (TS)

- **Owns:** `src/lib/core/scripting/**` (and its tests), `src/lib/app/scripts.ts`, `src/lib/stores/scripts.ts`.
- **Depends on:** P5.
- **Deliver:**
  - `ScriptService`, in order:
    1. the profile filter
    2. the parameter form (`modals.form`, remembered in `lastParams['script:'+id]`; a script with no parameters runs immediately)
    3. the input scope (default `selection-or-document`, extended to whole lines), with stdin as LF text
    4. the context v2 (§7.10)
    5. the version at start
    6. `scriptRun`
    7. `decideApply`
    8. apply:
       - replace uses `applyLines` (one undo step)
       - new-document uses `files.newUntitled`
       - report goes to Results
       - panel goes to Output (the v1 behavior)
       - envelope carries the text, the message and the findings
       - a stale result offers "Open result in new tab"
  - Remember the last script. Keep the Python status.
  - A single trailing LF in stdout is ignored when the input did not end with one.
- **Tests:** `decideApply` over:
  - exit ≠ 0 applies nothing
  - empty stdout in replace mode is an error
  - a changed version gives stale
  - truncated output
  - envelope and report validation
  - v1 fallback

  Also `buildContext`.
- **Covers:** "Parameters"; "Script context"; "Output modes"; "Applying results safely".

#### WP5.2 Scripts UI

- **Owns:**
  - `src/lib/contrib/scripts.ts`
  - `src/lib/components/panels/ScriptOutputPanel.svelte`
  - `src/lib/components/status/ScriptStatusItem.svelte`
  - `src/lib/components/menus/ScriptsMenu.svelte`
  - `src/lib/i18n/en/scripts.ts`
- **Depends on:** P5.
- **Deliver:**
  - A Tools ribbon group: grouped by folder, filtered by profile, with the description as tooltip. When Python is missing, a notice is shown and the commands are disabled.
  - Commands:
    - F9 opens `script.runPicker`; Mod+F9 runs `script.runLast`
    - a dynamic `script.run:<id>` command per script
    - `script.cancel`, `script.new` (prompts for a name, then opens the file), `script.copyToUser`, `script.openSource`, `script.rescan`, `script.addFolder` (folder picker, then `scripts.folders`)
  - Output panel v2: stdout, stderr and JSON, a Cancel button, the running state.
  - A running indicator in the status bar with Cancel.
- **Covers:** "Script folders and menu"; "timeout and cancel" (UI).

#### WP5.3 Docs

- **Owns:** `README.md`, `CONTRIBUTING.md`, `docs/planning/README.md`, `docs/user/**`.
- **Depends on:** P5.
- **Deliver:**
  - The README feature list and an "only run scripts you trust" note.
  - CONTRIBUTING updates.
  - The planning README's "current state" section and status marks.
  - `docs/user/{shortcuts,scripts}.md`: the shortcut table, and a pointer to the script contract.
- **Covers:** the documentation part of the exit criteria.

**Wave B**

#### H5 Harness M5 and the exit criteria

- **Owns:** `tests/runtime/scenarios/**`, `tests/runtime/suites/m5.txt`, `tests/fixtures/exit/**`.
- **Scenarios:**
  - `m5-scripts-ui`:
    - the parameter form, then scale feed, then one undo reverts it
    - tool-list rows jump to their line
    - timeout and cancel from the UI
    - a non-zero exit applies nothing
  - `m5-scripts-guard`: an edit during the run means nothing is applied, and a new tab is offered.
  - `m5-scripts-timeout`: a script with `timeout = 1` in its header is killed.
  - `m5-scripts-cancel`.
  - `m5-scripts-exitkill`: quit while a script runs; `h_pgrep` then finds nothing.
  - `m5-scripts-security`.
  - `m5-no-python`: `GEDIT_PYTHON=/nonexistent`. The script commands are disabled with a message, and everything else works.
  - `m5-perf-open`: repeat the open budget with everything enabled.
  - Update the `m0-py3-*` scenarios to v2, since v1 is removed.
  - **`m5-exit-criteria`:**
    1. Multi-select open of `exit/fanuc-cp1252-crlf.nc`, `exit/fanuc-utf8-lf-packed-nul.nc` (NUL leader and trailer) and `exit/klartext-utf8bom-crlf.h`.
    2. In the Fanuc file: F7 through the tools, then Ctrl+G `N120`.
    3. Remove empty lines, remove comments (keeping the program name), then renumber. Each is one undo step (undo, then redo).
    4. Scale feeds to 90 % and speeds to 110 % with the bundled scripts, in the Fanuc and the Klartext files.
    5. Tool list for the Klartext file. A row click jumps to its line.
    6. Compare with the saved version shows the differences. Close it.
    7. Save All. With `h_hex`, the bytes equal `exit/expected/*`: same encoding, same EOL, BOM and NUL leader/trailer kept.
  - **`m5-exit-criteria-nopython`:** steps 1–3, 6 and 7 against `exit/expected-nopython/*`. The script commands show the "Python not found" message.

**Integration I5:**
- Remove v1: `scripts_v1.rs`, its lines in `lib.rs`, `contrib/scriptsV1.ts`, and its i18n keys.
- Run the full regression.
- Put the performance numbers in the commit body.

**Gates:**
- G0 to G6, with the full cumulative suite.
- G7: every budget again.
- G8.
- **Phase 1 is done** when `m5-exit-criteria` and `m5-exit-criteria-nopython` pass on macOS and the owner confirms that the CI bundle builds on all three platforms (§12).

**Commit:** `M5: Scripting UI, performance pass and Phase 1 exit criteria`

---

## 6. Coverage: roadmap item → work package

| Roadmap item | WPs |
|---|---|
| P0: English completion texts; move them toward the code database | 0.3; 3.3, 3.6 |
| P0: move document state into a document store | 1.2, 1.5, 1.6 |
| P0: test setup, fixtures, detection and program-map tests | 0.1; 3.1, 3.5 |
| P0: CI for 3 platforms, contributor guide, license notices | 0.2; 2.4; 4 prelude (Python job) |
| P0: UI strings in one place | 0.3 (the rule applies to every WP) |
| Tabs | 1.2, 1.5 |
| New untitled; close, close all, save all | 1.6 |
| Open files (multi-select, drag and drop, focus if already open) | 1.6, 1.4 |
| Recent files | 2.1, 2.3 |
| Encoding and line endings | 1.3, 1.6 |
| External change detection | 1.4 (`files_stat`), 2.3, 2.5 |
| Go to line or block number; next and previous tool change | 3.5 |
| Program map from profiles, plus quick outline, folding and sticky scroll | 3.5, 2.6 (sticky option) |
| Bookmarks | 4.4 |
| Monaco features in ribbon and command palette | 1.1, 4.4 |
| About and licenses | 0.2, 2.4 |
| Built-in profiles as JSON; detection and outline runner; generated grammar and role colors | 3.1; 3.1, 3.5; 3.4 |
| Transform framework and number formatting; NC tokenizer | 4.1; 3.2 |
| Renumber (basic), remove block numbers; spaces, empty lines, comments, case | 4.2; 4.3 |
| Hover; dictionary-driven completion | 3.3, 3.6 |
| Compare (open document, file, saved version) | 2.5 |
| Script header, parameters, context, output modes; safe apply, timeout and cancel, security, folders and menu | 4.5, 5.1, 5.2 |
| Bundled scale feed, scale speed, tool list | 4.6, 4.7 |
| Storage layout, basic settings dialog | 2.1, 2.6, 2.7 |
| Light/dark/system theme; default shortcuts; window state | 2.6, 3.4; 1.1, 2.4; P2 + 2.1 |

---

## 7. Shared contracts (binding; written by the preludes)

The M1 contracts refer to types that only arrive in later milestones: `Profile` and `CompiledProfile` (P3), `FieldSpec` (P2), and the command result types (`ConfigPaths`, `RecentEntry`, `ScriptEntry`, `ScriptMeta`, `RunResult`, `PythonStatus`, all in `platform/commands.ts`).
- P1 creates their files as placeholders, for example `export interface Profile { id: string; [k: string]: unknown }`, so every import resolves.
- The later prelude replaces each placeholder with the full definition below, at the same path.
- A type may be imported only from its home file.

### 7.1 Registries and contributions: `src/lib/app/types.ts` (P1)

```ts
import type { Readable } from 'svelte/store';
import type { Component } from 'svelte';

export type Disposable = () => void;
export interface Msg { key: string; params?: Record<string, string | number> }
export interface Located { line: number; message: string; severity?: 'info' | 'warning' | 'error'; document?: string }
export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface CommandContext {
  activeDocId: string | null; profileId: string | null; hasSelection: boolean;
  editorFocused: boolean; compareOpen: boolean; modalOpen: boolean; scriptRunning: boolean;
}
export type KeySpec = string;   // 'Mod+S' | 'Ctrl+G' | 'F7' | 'Shift+F7' | 'Mod+Alt+S' | 'Mod+,'  (Mod = Cmd on macOS, Ctrl elsewhere)
export interface CommandDef {
  id: string;                                   // stable dotted id, e.g. 'file.save'; palette action id = 'gedit.' + id
  title: string;                                // i18n key
  category?: string;                            // i18n key; palette label = `${t(category)}: ${t(title)}`
  icon?: Component;
  keys?: KeySpec | { mac?: KeySpec; other?: KeySpec };
  global?: boolean;                             // also dispatched by the window handler when focus is outside Monaco
  palette?: boolean;                            // default true
  enabled?: (c: CommandContext) => boolean;     // default: always
  run: (c: CommandContext, arg?: unknown) => unknown | Promise<unknown>;
}
export type RibbonTab = 'home' | 'insert' | 'nc' | 'tools' | 'view';
export interface RibbonItemDef { tab: RibbonTab; group: string /* i18n key */; command: string; order: number; size?: 'large' | 'small' }
export interface RibbonGroupDef { tab: RibbonTab; group: string; order: number; component: Component }   // custom group
export type PanelRegion = 'left' | 'bottom' | 'overlay' | 'banner';
export interface PanelDef { id: string; region: PanelRegion; title: string /* i18n key */; icon?: Component; component: Component; order: number }
export interface StatusItemDef { id: string; side: 'left' | 'right'; order: number; component: Component }

export interface Contribution {
  id: string;
  commands?: CommandDef[];
  ribbon?: RibbonItemDef[];
  ribbonGroups?: RibbonGroupDef[];
  panels?: PanelDef[];
  statusItems?: StatusItemDef[];
  keybindingRemovals?: { keys: KeySpec; command: string }[];  // e.g. { keys: 'F2', command: 'editor.action.rename' }
  activate?(): void | Disposable | Promise<void | Disposable>;
}
// src/lib/contrib/<name>.ts:  export default { id: '<name>', ... } satisfies Contribution;

export interface CommandRegistry {
  register(defs: CommandDef | CommandDef[]): Disposable;   // duplicate id throws; key conflict → console.error
  has(id: string): boolean;
  get(id: string): CommandDef | undefined;
  list(): CommandDef[];
  isEnabled(id: string): boolean;
  run(id: string, arg?: unknown): Promise<boolean>;         // false if unknown or disabled (status message); errors → status error + console.error
  context(): CommandContext;
  readonly changed: Readable<number>;                        // bumps on (un)register and context changes
}
export function setContextProvider(fn: () => CommandContext): void;   // app/registry/commands.ts
export interface RibbonRegistry { add(items: RibbonItemDef[]): Disposable; addGroup(g: RibbonGroupDef): Disposable; readonly entries: Readable<(RibbonItemDef | RibbonGroupDef)[]> }
export interface PanelRegistry { add(p: PanelDef): Disposable; readonly panels: Readable<PanelDef[]> }
export interface StatusItemRegistry { add(s: StatusItemDef): Disposable; readonly items: Readable<StatusItemDef[]> }
```

Module exports:
- `app/registry/{commands,ribbon,panels,statusItems}.ts` export `commands`, `ribbon`, `panels` and `statusItems`.
- `app/contributions.ts` exports `loadContributions(): Promise<Disposable>`.
- `app/keys/dispatcher.ts` exports `installDispatcher(): Disposable`.
- `app/keys/monacoBridge.ts` exports `installMonacoBridge(monaco: Monaco): Disposable`.
- `core/keys/keySpec.ts` exports:
  - `parseKey(spec)`
  - `formatKey(spec, isMac)`
  - `toMonacoKeybinding(spec, isMac, KeyMod, KeyCode): number`
  - `matchesKey(spec, e: {key, code, metaKey, ctrlKey, altKey, shiftKey}, isMac): boolean`
  - `findConflicts(defs, isMac): [string, string][]`

### 7.2 Documents, editor, files, dialogs, status, layout (P1)

```ts
export type DocId = string;                         // 'd1','d2',… never reused in a session
export type Eol = 'crlf' | 'lf' | 'cr';
export type EncodingName = 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';
export interface FileEncoding { encoding: EncodingName; hasBom: boolean }     // utf-16*: hasBom is always true
export interface NulInfo { leader: number; trailer: number; stripped: number }
export interface DiskStamp { mtimeMs: number | null; size: number; hash: number }   // hash = fnv1a32(bytes)
export interface CursorInfo { line: number; column: number; selectedChars: number; selections: number }

export interface DocMeta {
  id: DocId; path: string | null; untitledIndex: number | null;
  title: string;                   // derived by the store: basename(path) or `Untitled-${n}`
  profileId: string;               // = Monaco language id
  encoding: FileEncoding; eol: Eol; eolMixedOnLoad: boolean; nul: NulInfo;
  textDirty: boolean;              // written by EditorService on flips only
  metaDirty: boolean;              // encoding/EOL change, NUL strip, keep-mine, deleted on disk
  dirty: boolean;                  // derived by the store: textDirty || metaDirty
  disk: DiskStamp | null; external: 'none' | 'changed' | 'deleted';
}
export type NewDocMeta = Omit<DocMeta, 'id' | 'title' | 'dirty'>;

// stores/documents.ts → export const docs: DocumentStore
export interface DocumentStore {
  readonly list: Readable<DocMeta[]>;               // tab order
  readonly activeId: Readable<DocId | null>;
  readonly active: Readable<DocMeta | null>;
  all(): DocMeta[]; get(id: DocId): DocMeta | undefined; getActiveId(): DocId | null;
  add(meta: NewDocMeta, o?: { activate?: boolean; index?: number }): DocId;
  update(id: DocId, patch: Partial<NewDocMeta>): void;
  remove(id: DocId): void;                          // activates the right neighbour, else the left, else null
  activate(id: DocId): void; move(id: DocId, toIndex: number): void;
  byPath(path: string): DocMeta | undefined;        // case-insensitive on macOS and Windows
  nextUntitledIndex(): number;                      // lowest free index ≥ 1
}

// monaco/editorService.ts → export const editor: EditorService
export interface ContentChange { startLine: number; endLineOld: number; endLineNew: number; flush: boolean; versionId: number }
// One spanning range per Monaco content event, 1-based inclusive, in old/new coordinates. flush=true for setValue-like events.
export interface EditorService {
  attach(container: HTMLElement): Promise<void>; readonly ready: Promise<void>;
  createModel(id: DocId, textLF: string, languageId: string, eol: Eol): void;
  disposeModel(id: DocId): void; hasModel(id: DocId): boolean;
  getText(id: DocId): string;                       // LF-joined
  getLineCount(id: DocId): number;
  getLines(id: DocId, startLine: number, endLine: number): string[];   // 1-based inclusive
  versionId(id: DocId): number;                     // alternativeVersionId
  markClean(id: DocId): void;
  setLanguage(id: DocId, languageId: string): void;
  setModelEol(id: DocId, eol: Eol): void;           // pushEOL (undoable) between crlf and lf; 'cr' keeps an LF model
  replaceAll(id: DocId, textLF: string, o?: { keepCursorLine?: boolean }): void;   // one undo step
  insertText(text: string): void;                   // active doc, at the selections, one undo step
  focus(): void; hasFocus(): boolean;
  reveal(id: DocId, line: number, column?: number): void;   // activates the doc if needed, sets the cursor, centers, focuses
  cursor(): CursorInfo | null;
  selectionLines(): { startLine: number; endLine: number; empty: boolean } | null;
  selectedText(): string;
  triggerAction(actionId: string, payload?: unknown): void;
  updateOptions(o: Record<string, unknown>): void;
  onDidChangeContent(cb: (id: DocId, c: ContentChange) => void): Disposable;
  onDidChangeCursor(cb: (c: CursorInfo) => void): Disposable;
  onDidCreateModel(cb: (id: DocId) => void): Disposable;
  onDidActivate(cb: (id: DocId | null) => void): Disposable;
  /** Escape hatches: only src/lib/monaco/** may call these. */
  model(id: DocId): import('$lib/monaco/core').editor.ITextModel | undefined;
  editorInstance(): import('$lib/monaco/core').editor.IStandaloneCodeEditor | undefined;
}

// core/text/codec.ts, eol.ts, hash.ts
export type DecodeResult =
  | { ok: true; text: string /* LF */; encoding: FileEncoding; eol: Eol | null /* null: no line break */; eolMixed: boolean; nul: NulInfo }
  | { ok: false; reason: 'binary'; message: Msg };
export function decodeFile(bytes: Uint8Array, o?: { stripNul?: boolean /* default true */ }): DecodeResult;
export type EncodeResult = { ok: true; bytes: Uint8Array } | { ok: false; badChar: string; line: number; column: number };
export function encodeFile(textLF: string, m: { encoding: FileEncoding; eol: Eol; nul: Pick<NulInfo, 'leader' | 'trailer'> }): EncodeResult;
export function detectEol(text: string): { eol: Eol | null; mixed: boolean; counts: { crlf: number; lf: number; cr: number } };
export function fnv1a32(bytes: Uint8Array): number;
export function encodingLabel(e: FileEncoding): string;   // 'UTF-8', 'UTF-8 BOM', 'Windows-1252', 'UTF-16 LE', 'UTF-16 BE'

// app/dialogs.ts → export const dialogs: NativeDialogs
export interface DialogFilter { name: string; extensions: string[] }
export interface NativeDialogs {
  ask3(o: { title: string; message: string; yes: string; no: string; cancel: string; kind?: 'warning' | 'info' }): Promise<'yes' | 'no' | 'cancel'>;
  confirm(o: { title: string; message: string; ok: string; cancel?: string; kind?: 'warning' | 'info' }): Promise<boolean>;
  error(summary: string, detail: unknown): Promise<void>;
  openFiles(o?: { multiple?: boolean }): Promise<string[]>;               // filters per AD-7
  saveFile(o: { defaultPath: string; profileId?: string }): Promise<string | null>;
  pickFolder(o?: { title?: string }): Promise<string | null>;
  pickFile(o?: { title?: string }): Promise<string | null>;
  exclusive<T>(op: () => Promise<T>): Promise<T | undefined>;            // one chain at a time; a re-entrant call resolves undefined
}

// app/modals.ts → export const modals: Modals   (quickPick M1; prompt/form M2)
export interface QuickPickItem<T> { label: string; description?: string; detail?: string; value: T }
export interface Modals {
  quickPick<T>(items: QuickPickItem<T>[], o?: { placeholder?: string; initialIndex?: number }): Promise<T | undefined>;
  prompt(o: { title: string; placeholder?: string; initial?: string; validate?: (v: string) => string | null }): Promise<string | undefined>;
  form(o: { title: string; fields: FieldSpec[]; values?: Record<string, unknown>; okLabel?: string; context?: { addresses?: string[] } }): Promise<Record<string, unknown> | undefined>;
  open<P extends Record<string, unknown>, R>(c: Component<P & { close: (r?: R) => void }>, props: P): Promise<R | undefined>;
  readonly isOpen: Readable<boolean>;
}

// app/fileOps.ts → export const files: FileOps  (createFileOps(deps) + default instance)
export interface FileOps {
  newUntitled(o?: { profileId?: string; text?: string; activate?: boolean }): DocId;
  open(paths?: string[]): Promise<DocId[]>;          // no paths → multi-select dialog; focuses already-open docs
  save(id?: DocId): Promise<boolean>; saveAs(id?: DocId): Promise<boolean>; saveAll(): Promise<boolean>;
  close(id?: DocId): Promise<boolean>; closeAll(): Promise<boolean>; confirmQuit(): Promise<boolean>;
  setEncoding(id: DocId, e: FileEncoding): void; setEol(id: DocId, eol: Eol): void; setProfile(id: DocId, profileId: string): void;
  reloadFromDisk(id: DocId): Promise<void>;         // one undo step, keeps the cursor line, marks clean, restamps
  readDisk(path: string): Promise<DecodeResult | null>;
  onDidOpen(cb: (id: DocId, path: string) => void): Disposable;
  onDidSave(cb: (id: DocId, path: string) => void): Disposable;
  onWillQuit(cb: () => Promise<void> | void): Disposable;
}

// app/status.ts → export const status: StatusService
export interface StatusService {
  readonly current: Readable<{ text: string; error: boolean; detail?: string } | null>;
  show(text: string, o?: { error?: boolean; sticky?: boolean; detail?: string }): void;   // text is already translated
  clear(): void;
}

// stores/layout.ts → export const layout: LayoutStore
export interface LayoutState { left: { visible: boolean; width: number; active: string | null }; bottom: { visible: boolean; height: number; active: string | null }; overlay: string | null }
export interface LayoutStore {
  readonly state: Readable<LayoutState>;
  show(panelId: string): void; hide(region: 'left' | 'bottom'): void; toggle(region: 'left' | 'bottom'): void;
  setSize(region: 'left' | 'bottom', px: number): void; openOverlay(panelId: string): void; closeOverlay(): void;
  restore(s: Partial<LayoutState>): void;
}

// stores/profiles.ts → export const profiles: ProfileRegistry   (M1 adapter; M3 real)
export interface ProfileInfo { id: string; name: string; shortName: string; extensions: string[]; defaultFileName: string; newFileEol: Eol }
export interface ProfileRegistry {
  readonly all: Readable<ProfileInfo[]>; list(): ProfileInfo[]; get(id: string): ProfileInfo | undefined;
  defaultId(): string;
  detect(path: string | null, text: string, fallback: string): string;
  openFilters(): DialogFilter[]; saveFilters(id: string): DialogFilter[];   // [] on macOS
  profile(id: string): Profile;               // M3 (throws in M1)
  compiled(id: string): CompiledProfile;      // M3 (throws in M1)
}

// app/context.ts → export const ctx: AppContext   (aggregate for the test hook; grows per prelude)
export interface AppContext {
  commands: CommandRegistry; ribbon: RibbonRegistry; panels: PanelRegistry; statusItems: StatusItemRegistry;
  docs: DocumentStore; editor: EditorService; files: FileOps; dialogs: NativeDialogs; modals: Modals;
  status: StatusService; layout: LayoutStore; profiles: ProfileRegistry; t: Translate;
  // P2: settings, uiState, recent, external, compare   P3: codes, outline   P4: transforms, results, bookmarks   P5: scripts
}
```

### 7.3 Services added in M2 to M5

```ts
// stores/settings.ts (P2) → export const settings: SettingsStore
export interface SettingsStore {
  readonly values: Readable<Settings>;
  get<K extends keyof Settings>(k: K): Settings[K];
  load(): Promise<{ error?: string; warnings: string[] }>;
  save(patch: Partial<Settings>): Promise<void>;           // writes only non-defaults, sorted, with $version
  reset(keys: (keyof Settings)[]): Promise<void>;
  reloadFromDisk(): Promise<void>;
  readonly paths: Readable<ConfigPaths | null>;
}
// stores/uiState.ts (P2) → export const uiState: UiStateStore
export interface UiState { layout: Partial<LayoutState>; lastParams: Record<string, Record<string, unknown>>; lastScript: string | null }
export interface UiStateStore {
  readonly state: Readable<UiState>; load(): Promise<void>;
  update(fn: (s: UiState) => UiState): void;               // 1 s debounced save
  getLastParams(key: string): Record<string, unknown> | undefined;
  setLastParams(key: string, v: Record<string, unknown>): void;
  flush(): Promise<void>;
}
// stores/recent.ts (P2) → export const recent: RecentService
export interface RecentService { readonly list: Readable<RecentEntry[]>; refresh(): Promise<void>; touch(path: string): Promise<void>; remove(path: string): Promise<void>; clear(): Promise<void> }
// app/external.ts (P2) → export const external: ExternalChangeService
export interface ExternalChangeService { start(): Disposable; checkNow(): Promise<void>; reload(id: DocId): Promise<void>; keepMine(id: DocId): void }
// app/compare.ts (P2) → export const compare: CompareService
export type CompareSource = { kind: 'document'; docId: DocId } | { kind: 'file'; path: string } | { kind: 'saved' };
export interface CompareService {
  readonly session: Readable<{ docId: DocId; source: CompareSource; title: string } | null>;
  open(docId: DocId, source: CompareSource): Promise<boolean>;   // false: guard hit (>50 MB), missing file, …
  close(): void;
}
// app/theme.ts (P2)
export function applyTheme(mode: 'system' | 'light' | 'dark'): void; export const effectiveTheme: Readable<'light' | 'dark'>;
// monaco/theme.ts (P2 stub → M3 generated)
export function setMonacoTheme(mode: 'light' | 'dark'): void;

// stores/codes.ts (P3) → export const codes: CodeDbService
export interface CodeDbService {
  forProfile(profileId: string): CodeDb;
  lookupWord(profileId: string, token: NcToken): CodeLookup | null;
  completions(profileId: string, prefix: string, atBlockStart: boolean): CodeEntry[];
  forScripts(profileId: string): CodeEntry[];
}
// app/outlineService.ts (P3) → export const outline: OutlineService
export interface OutlineService {
  items(id: DocId): Readable<OutlineItem[]>; toolLines(id: DocId): number[];
  itemAt(id: DocId, line: number): OutlineItem | null; whenReady(id: DocId): Promise<void>;
}

// app/transforms.ts, stores/results.ts, monaco/bookmarks.ts (P4)
export interface TransformService {
  run(def: TransformDef, o?: { target?: 'replace' | 'new-document'; options?: Record<string, unknown>; skipForm?: boolean }): Promise<TransformResult | null>;
}
export interface ReportData { title: string; message?: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; findings?: Located[]; docId?: DocId }
export interface ResultsService { readonly current: Readable<ReportData | null>; show(r: ReportData): void; clear(): void }
export interface BookmarkService { toggle(id?: DocId, line?: number): void; next(): void; prev(): void; clear(id?: DocId): void; lines(id: DocId): number[] }
// monaco/applyLines.ts (P4)
export function applyLines(id: DocId, startLine: number, endLine: number, newLines: string[], lineMap?: Int32Array): { changedLines: number };

// app/scripts.ts, stores/scripts.ts (P5) → export const scripts: ScriptService
export interface ScriptService {
  readonly list: Readable<ScriptEntry[]>; readonly python: Readable<PythonStatus | null>;
  readonly running: Readable<{ runId: string; scriptId: string; startedAt: number } | null>;
  rescan(): Promise<void>; run(scriptId: string, o?: { params?: Record<string, unknown>; skipForm?: boolean }): Promise<void>;
  runLast(): Promise<void>; cancel(): Promise<void>;
}
```

### 7.4 Profiles, NC tokens, outline and code database (P3)

```ts
// core/profiles/types.ts
export type Pattern = string;                 // ECMAScript source, common subset with Python re (AD-11); flags added by compile
export type OutlineKind = 'tool' | 'program' | 'section' | 'comment' | 'label' | 'stop' | 'end' | 'subprogram-call';
export interface NumberingOptions {
  mode?: 'free' | 'consecutive'; start: number; step: number; digits?: number; max?: number; onOverflow?: 'wrap' | 'stop';
  spacesAfter?: number; skipStartingWith?: string[]; skipEmpty?: boolean; restartAtProgramStart?: boolean; onlyNumbered?: boolean;
  references?: { trigger: Pattern; addresses: string[] }[];
}
export interface NumberFormatOptions { decimals: 'keep' | number; trailingZeros: 'keep' | 'drop'; keepPoint: boolean; plusSign: 'keep' | 'always' | 'never' }
export interface Profile {
  id: string; name: string; shortName: string; version: number; grammar: 'iso' | 'klartext'; codes: string;
  files: { extensions: string[]; defaultExtension: string; filterName: string; encoding: 'keep'; lineEnding: 'keep'; newFileLineEnding: Eol };
  detect: { extensions: Record<string, number>; content: { pattern: Pattern; weight: number }[]; folders?: string[]; priority?: number };
  syntax: {
    caseSensitive?: boolean; comments: { start: string; end: string | null }[]; sectionHeading?: Pattern; continuation?: Pattern;
    blockSkip?: { chars: string; position: 'before-number' | 'after-number' | 'either'; levels?: boolean };
    blockNumber: { mode: 'prefix' | 'leading-integer'; prefix?: string; altPrefixes?: string[]; mandatory: boolean };
    decimalSeparator: '.' | ','; decimalPointSignificant: boolean; wordSeparatorRequired: boolean;
    incrementalPrefix?: string; variables?: Pattern; keywords?: string[]; maxLineLength?: number;
  };
  addresses: { tool?: string; feed?: string; rapid?: string; spindle?: string; axes: string[]; arcCenter?: string[]; arcCenterMode?: 'incremental' | 'absolute' };
  toolCall: { trigger: Pattern; tool: Pattern; toolFrom: 'same-line' | 'same-line-or-last' };
  program: { start: Pattern[]; end: Pattern[] };
  outline: { kind: OutlineKind; pattern: Pattern }[];
  numbering: NumberingOptions;
  numberFormat?: NumberFormatOptions;
  onLoad?: { stripNul?: boolean };
  toolList?: { description: 'auto' | 'above' | 'below' | 'trailing'; commentFilter?: Pattern; dropLeadingZeros?: boolean; collapseOffsetDigits?: boolean };
  [p2Field: string]: unknown;               // editing, compare, highlight, colors … preserved, unused in P1
}
export interface CompiledProfile {
  profile: Profile; flags: 'i' | '';
  re: {
    detectContent: { re: RegExp; weight: number }[]; sectionHeading?: RegExp; continuation?: RegExp; variables?: RegExp;
    toolTrigger: RegExp; tool: RegExp; programStart: RegExp[]; programEnd: RegExp[];
    outline: { kind: OutlineKind; re: RegExp }[]; references: { trigger: RegExp; addresses: string[] }[]; commentFilter?: RegExp;
  };
  keywords: string[];                        // uppercase, longest first
}
export function compileProfile(p: Profile): CompiledProfile;            // throws ProfileError { path, message }
export function validateProfile(raw: unknown): { ok: true; profile: Profile } | { ok: false; errors: string[] };
export function detectProfile(profiles: CompiledProfile[], path: string | null, text: string, fallback: string): string;

// core/nc/types.ts
export type TokenKind = 'blockNumber' | 'skip' | 'word' | 'keyword' | 'comment' | 'string' | 'variable' | 'expression'
  | 'operator' | 'continuation' | 'programMarker' | 'whitespace' | 'unknown';
export interface NumericLiteral { raw: string; sign: '+' | '-' | ''; intPart: string; fracPart: string | null; hasPoint: boolean }
export interface NcToken {
  kind: TokenKind; start: number; end: number; text: string;
  address?: string;            // 'G','X',',R','F' …  (word); keyword text for keywords
  valueText?: string;          // text after the address ('10.', '#101')
  value?: NumericLiteral | null;   // null when the value is a variable or expression
  incremental?: boolean;       // Klartext I-prefix
}
export interface LineState { continuation: boolean }
export function tokenizeLine(line: string, cp: CompiledProfile, prev?: LineState): { tokens: NcToken[]; state: LineState };
export function maskComments(line: string, cp: CompiledProfile): string;                       // same length
export function blockNumberOf(line: string, cp: CompiledProfile): { value: number; text: string; start: number; end: number } | null;
export function parseNumber(raw: string): NumericLiteral | null;
export function formatNumber(decimal: string /* exact decimal, e.g. '1111.05' */, original: NumericLiteral | null,
  fmt: NumberFormatOptions, o?: { decimalPointSignificant?: boolean }): string;               // half away from zero, string-based

// core/profiles/outline.ts
export interface OutlineItem { kind: OutlineKind; line: number; endLine?: number; text: string; tool?: string; children?: OutlineItem[] }
export class OutlineIndex {
  constructor(cp: CompiledProfile);
  reset(lines: string[]): void;
  applyChange(startLine: number, endLineOld: number, newLines: string[]): void;   // 1-based; old range replaced by newLines
  items(): OutlineItem[]; toolLines(): number[]; itemAt(line: number): OutlineItem | null;
}

// core/nav
export function parseGotoInput(input: string): { kind: 'line'; line: number } | { kind: 'block'; number: number } | null;
export function findBlock(getLine: (n: number) => string, lineCount: number, n: number, fromLine: number, cp: CompiledProfile): number | null;
export function nextInList(sorted: number[], current: number, dir: 1 | -1): { line: number; wrapped: boolean } | null;

// core/codes/types.ts  (file format = code-assistant.md "Code database format", without templates in P1)
export interface CodeParam { address: string; label: string; required?: boolean; min?: number; max?: number }
export interface CodeEntry { code: string; aliases?: string[]; group?: string; modal?: boolean; pitchFeed?: boolean; label: string; description?: string; params?: CodeParam[]; verify?: boolean }
export interface CodeDb { dialect: string; version: number; addresses: Record<string, { label: string; description?: string }>; codes: CodeEntry[] }
export interface CodeLookup { entry: CodeEntry | null; address?: { letter: string; label: string; description?: string }; unknown?: boolean }

// core/grammar
export type Role = 'blockNumber' | 'skip' | 'gcode' | 'mcode' | 'axis' | 'arcCenter' | 'feed' | 'spindle' | 'tool' | 'variable'
  | 'keyword' | 'comment' | 'section' | 'programMarker' | 'number' | 'string' | 'operator' | 'invalid';
export function generateGrammar(p: Profile, db: CodeDb): Record<string, unknown>;   // IMonarchLanguage; tokens are Role names
export const ROLE_COLORS: { dark: Record<Role, string>; light: Record<Role, string> };
export function generateThemes(profiles: Profile[]): { dark: unknown; light: unknown }; // IStandaloneThemeData for gedit-dark / gedit-light
```

Token golden format, shared by vitest and Python, in `tests/fixtures/tokens/<profileId>.json`:

```json
[{ "line": "N10G0X10.", "prev": {"continuation": false},
   "tokens": [{"kind":"blockNumber","text":"N10"},{"kind":"word","address":"G","valueText":"0"},{"kind":"word","address":"X","valueText":"10."}] }]
```

Whitespace tokens are left out of the comparison. `numberformat.cases.json` looks like this:

```json
[{"decimal":"1111.05","original":"1234.5","fmt":{…},"significant":true,"expected":"1111.1"}]
```

### 7.5 Forms, transforms and scripting (P2, P4, P5)

```ts
// core/forms/types.ts (P2)
export type FieldType = 'number' | 'integer' | 'text' | 'bool' | 'choice' | 'file' | 'folder' | 'address-list';
export interface FieldSpec {
  id: string; type: FieldType; label: string /* display text */; help?: string; default?: unknown; required?: boolean;
  min?: number; max?: number; decimals?: number; choices?: { label: string; value: unknown }[];
}
export function validateFields(fields: FieldSpec[], values: Record<string, unknown>): Record<string, Msg>;   // never corrects
export function initialValues(fields: FieldSpec[], remembered?: Record<string, unknown>): Record<string, unknown>;

// core/transforms/types.ts (P4)
export interface TransformContext { cp: CompiledProfile; codes: CodeDb; options: Record<string, unknown>; firstLine: number /* doc line of lines[0] */ }
export interface TransformResult {
  lines: string[];
  lineMap?: Int32Array;        // length = input lines; old index → new index, or -1 if deleted
  summary: Msg; skipped: Located[]; warnings: Msg[];
}
export interface TransformDef {
  id: string; title: string;   // i18n key
  available(cp: CompiledProfile): true | Msg;
  options?(cp: CompiledProfile): FieldSpec[];                    // defaults from the profile (e.g. numbering)
  preflight?(lines: string[], ctx: TransformContext): Msg | null; // → confirm dialog
  run(lines: string[], ctx: TransformContext): TransformResult;
}
// core/transforms/lineDiff.ts (P4)
export interface LineEdit { oldStart: number; oldEnd: number /* 0-based, exclusive */; newLines: string[] }
export function computeLineEdits(oldLines: string[], newLines: string[], lineMap?: Int32Array, o?: { maxD?: number }): LineEdit[];
export function charSpan(oldLine: string, newLine: string): { start: number; endOld: number; text: string } | null;

// core/scripting/types.ts (P5)
export interface ScriptContextV2 {
  contract: 2;
  document: { path: string | null; name: string; profile: string; encoding: EncodingName; hasBom: boolean; lineEnding: Eol; modified: boolean };
  input: { scope: 'selection' | 'document' | 'none'; startLine: number; endLine: number };
  cursor: { line: number; column: number };
  params: Record<string, unknown>;
  profile: Profile;            // resolved built-in (no extends in P1)
  codes: CodeEntry[];          // forScripts(profileId)
}
export type ApplyDecision =
  | { kind: 'error'; reason: Msg; stderr?: string }
  | { kind: 'replace'; text: string; message?: string; findings?: Located[] }
  | { kind: 'new-document'; text: string; message?: string; findings?: Located[] }
  | { kind: 'report'; report: ReportData }
  | { kind: 'panel' }
  | { kind: 'stale'; text: string };
export function buildContext(i: { doc: DocMeta; profile: Profile; codes: CodeEntry[]; input: ScriptContextV2['input']; cursor: { line: number; column: number }; params: Record<string, unknown> }): ScriptContextV2;
export function decideApply(meta: ScriptMeta | null, r: RunResult, versionAtStart: number, versionNow: number, inputEndedWithLf: boolean): ApplyDecision;
```

### 7.6 Tauri commands and TS wrappers

All structs use `#[serde(rename_all = "camelCase")]`. The TS wrappers in `src/lib/platform/commands.ts` have the same names in camelCase (for example `filesStat(paths)` and `scriptRun(req)`). They pass an object argument as `{ req }`.

```rust
// M1 files.rs
#[tauri::command] fn files_stat(app: AppHandle, paths: Vec<String>) -> Vec<FileStat>;
//   FileStat { path, allowed: bool, exists: bool, isDir: bool, mtimeMs: Option<f64>, size: Option<u64>, readonly: bool }
//   not allowed → allowed:false and every other field false/None

// M2 paths.rs, config.rs, state.rs
#[tauri::command] fn config_load(app: AppHandle) -> Result<ConfigLoad, String>;
//   ConfigLoad { settings: Value /* object; {} if missing or invalid */, settingsError: Option<String>, ui: Value, stateError: Option<String>, paths: ConfigPaths }
//   ConfigPaths { configDir, dataDir, settingsFile, stateFile, userScriptsDir }
#[tauri::command] fn settings_save(app: AppHandle, settings: Value) -> Result<(), String>;  // object, ≤1 MiB, atomic; refuses when the file's $version > 1
#[tauri::command] fn ui_state_save(app: AppHandle, ui: Value) -> Result<(), String>;       // merges into state.json
#[tauri::command] fn settings_open_file(app: AppHandle) -> Result<String, String>;         // ensures the file exists, allow_file, returns path
#[tauri::command] fn recent_list(app: AppHandle) -> Vec<RecentEntry>;                      // RecentEntry { path, exists }
#[tauri::command] fn recent_touch(app: AppHandle, path: String, max: u32) -> Result<Vec<RecentEntry>, String>;  // Err unless is_allowed
#[tauri::command] fn recent_remove(app: AppHandle, path: String) -> Vec<RecentEntry>;
#[tauri::command] fn recent_clear(app: AppHandle) -> Vec<RecentEntry>;
pub fn ensure_dirs(app: &AppHandle);            // config, data, <config>/scripts
pub fn grant_recent_on_startup(app: &AppHandle); // ≤50 existing entries; given + canonical path

// M4 scripts/*
#[tauri::command(async)] fn scripts_list(app: AppHandle) -> Result<ScriptList, String>;
//   ScriptList { scripts: Vec<ScriptEntry>, folders: Vec<FolderInfo { root, path, exists }> }
//   ScriptEntry { id /* "bundled:x.py" | "user:grp/x.py" | "extra0:x.py" */, root, group: Option<String>, fileName,
//                 meta: Option<ScriptMeta>, headerError: Option<String>, shadowed: bool, editable: bool }
//   ScriptMeta { name, description, profiles: Option<Vec<String>>, input /* default selection-or-document */, output /* default panel */,
//                timeout: Option<u64>, envelope: bool, documents /* "active" */, params: Vec<FieldSpec-shaped>, warnings: Vec<String> }
#[tauri::command(async)] fn script_run(app: AppHandle, runs: State<RunRegistry>, req: RunRequest) -> Result<RunResult, String>;
//   RunRequest { runId, scriptId, stdin: String, context: Value, timeoutSecs: Option<u64> }
//   RunResult { exitCode: Option<i32>, success, stdout, stderr, timedOut, cancelled, stdoutTruncated, durationMs, interpreter }
#[tauri::command] fn script_cancel(runs: State<RunRegistry>, run_id: String) -> bool;
#[tauri::command(async)] fn python_check(app: AppHandle) -> PythonStatus;   // { ok, interpreter: Option, version: Option, message: Option }
#[tauri::command] fn script_new(app: AppHandle, name: String) -> Result<String, String>;          // in the user folder, granted
#[tauri::command] fn script_copy_to_user(app: AppHandle, script_id: String) -> Result<String, String>;
#[tauri::command] fn script_source_path(app: AppHandle, script_id: String) -> Result<String, String>;  // user/extra only (granted); bundled → Err
pub fn kill_all(app: &AppHandle);               // from on_run_event(Exit)

// removed in M5: list_python_scripts, run_python_script
```

Capabilities: M2 adds `core:window:allow-set-theme`. Nothing else is added.

### 7.7 Settings keys and file formats (P2, `core/settings/schema.ts`)

| Key | Type | Default | In the dialog |
|---|---|---|---|
| `appearance.theme` | `system` \| `light` \| `dark` | `system` | yes |
| `appearance.editorFontFamily` | string | `Menlo, Consolas, 'DejaVu Sans Mono', monospace` | yes |
| `appearance.editorFontSize` | int 8–32 | 14 | yes |
| `editor.tabWidth` | int 1–16 | 4 | yes |
| `editor.insertSpaces` | bool | true | yes |
| `editor.renderWhitespace` | `none` \| `boundary` \| `all` | `none` | yes |
| `editor.wordWrap` | bool | false | yes |
| `editor.minimap` | bool | false | yes |
| `editor.lineNumbers` | bool | true | yes |
| `editor.highlightCurrentLine` | bool | true | yes |
| `editor.stickyScroll` | bool | true | yes |
| `editor.dragAndDrop` | bool | false | yes |
| `editor.emptySelectionClipboard` | bool | true | yes |
| `editor.rulers` | int[] | `[]` | no (edit the file) |
| `assist.hover` | bool | true | yes |
| `assist.completion` | `auto` \| `manual` \| `off` | `auto` | yes |
| `files.recentLength` | int 0–50 | 15 | yes |
| `files.externalChange` | `ask` \| `reload` | `reload` (clean documents only; dirty documents always ask) | yes |
| `files.defaultProfile` | profile id | `fanuc-gcode` | yes |
| `scripts.python` | path | `""` (automatic) | yes |
| `scripts.folders` | string[] | `[]` | yes (list with add and remove) |
| `scripts.timeoutSeconds` | int 1–3600 | 60 | yes |
| `scripts.showBundled` | bool | true | yes |

```ts
export interface Settings { /* one property per key above, typed as listed */ }
export const SETTINGS_VERSION = 1;
export const DEFAULTS: Settings;
export interface SettingFieldMeta { key: keyof Settings; category: 'appearance' | 'editor' | 'assistance' | 'files' | 'scripts';
  field: Omit<FieldSpec, 'label' | 'help'>; labelKey: string; helpKey?: string; dialog: boolean }
export const SETTING_FIELDS: SettingFieldMeta[];
```

Files:
- `<config>/settings.json`: `{"$version":1,"editor.tabWidth":2}`, holding only the non-default values.
- `<data>/state.json`: `{"$version":1,"recent":["/abs/a.nc"],"ui":{"layout":{…},"lastParams":{"transform:nc.renumber":{…},"script:bundled:scale_feed.py":{…}},"lastScript":"bundled:scale_feed.py"}}`.
- `.window-state.json` in the config folder, written by the plugin.

### 7.8 i18n (M0)

```ts
// src/lib/i18n/index.ts
export function t(key: string, params?: Record<string, string | number>): string;   // key = '<ns>.<path>'; plural via params.count → key_one/key_other
export function hasKey(key: string): boolean;
// src/lib/i18n/en/<ns>.ts: export default { cmd: { save: 'Save' }, … } as const;   // namespace = file name
```

### 7.9 Test seams, test ids and the harness API

```ts
// src/lib/app/testHook.ts (M0; ctx from M1). Installed only when import.meta.env.VITE_GEDIT_TEST === '1'.
export interface GeditTestHook {
  ready: Promise<void>; version: string;
  text(): string;                              // active document, LF
  cursor(): { line: number; column: number };
  activeProfile(): string; setProfile(id: string): void;
  ctx?: AppContext;                            // M1+
}
export function installTestHook(h: GeditTestHook): void;
```

| `data-testid` | Element | Extra attributes | Since |
|---|---|---|---|
| `app-shell` | root | `data-ready` | M0 |
| `ribbon`, `ribbon-tab` | ribbon, tab | `data-tab`, `aria-selected` | M0 |
| `cmd-button` | every command button | `data-command`, `disabled` | M0 (legacy buttons get fixed ids: `file.open`, `file.save`, `file.saveAs`, `insert.block:<id>`) |
| `profile-select` | legacy `<select>` | value = profile id | M0 only |
| `scripts-folder`, `script-select`, `script-run` | v1 script UI | | M0–M4 |
| `editor-host` | editor container | `data-doc-id` | M0 |
| `program-map`, `program-map-item` | map and row | `data-line`, `data-kind`, `data-active` (M3) | M0 |
| `output-panel`, `output-stdout`, `output-stderr`, `output-json`, `output-cancel` | output | `data-running` | M0 (cancel M5) |
| `status-bar`, `status-item` | status bar | `data-item` = `file` \| `message` \| `profile` \| `encoding` \| `eol` \| `cursor` \| `script` | M0 |
| `status-message` | message | `data-error` | M0 |
| `tab-bar`, `doc-tab`, `doc-tab-close` | tabs | `data-doc-id`, `data-path`, `data-dirty`, `data-active`, `data-external` | M1 |
| `panel` | panel host | `data-region`, `data-panel` | M1 |
| `quick-pick`, `quick-pick-input`, `quick-pick-item` | QuickPick | `data-index`, `aria-selected` | M1 |
| `modal`, `modal-ok`, `modal-cancel`, `form-field` | modals | `data-modal`, `data-field`, `data-error` | M2 |
| `external-banner` | banner | `data-doc-id`; buttons `data-action=reload\|keep\|compare` | M2 |
| `compare-view` | diff | `data-source` | M2 |
| `results-panel`, `results-row`, `results-finding` | results | `data-line`, `data-doc-id` | M4 |
| `scripts-group`, `script-item` | v2 script UI | `data-script-id` | M5 |

Harness helper API (`tests/runtime/lib`, pinned in M0 for the `Hn` WPs):

```js
scenario(name, async (h) => { … })             // one or more per scenarios/<file>.js; selected by run.sh
h.check(name, cond, detail?)                   // records a check; a false cond fails the scenario
h.waitFor(fn, { timeout = 5000, interval = 50 })
h.q(testid, attrs?) / h.qa(testid, attrs?)     // [data-testid] with optional attribute filters
h.click(el) / h.nativeKeys([{ key: 's', mods: ['cmd'] }]) / h.nativeType(text)
h.dialogs.queue('open' | 'save' | 'folder', result)    // fake native file dialogs; the stub grants like the plugin
h.alert.visible() / h.alert.click(label)               // the real NSAlert
h.disk.read(p) / h.disk.hex(p) / h.disk.write(p, text | { base64 }) / h.disk.touch(p, secs) / h.disk.stat(p) / h.disk.copy(a, b)
h.drop(paths)                                   // grants like tauri-plugin-fs, then emits tauri://drag-drop
h.pgrep(pattern) → pids
h.fixture(relPath) → absolute path of a fresh copy of tests/fixtures/<relPath> in the run folder
h.app → window.__gedit
```

### 7.10 Python `gedit_nc` API (P4 stub, implemented by WP4.6)

```python
def load_context() -> dict            # reads GEDIT_CONTEXT; {} when missing (v1 run)
def read_input() -> list[str]         # stdin split on "\n"
def to_py_regex(pattern: str) -> str  # (?<name> → (?P<name>; use with re.ASCII (+ re.IGNORECASE unless caseSensitive)
def compile_profile(profile: dict) -> "CompiledProfile"
def tokenize_line(line: str, cp, prev_state=None) -> tuple[list["Token"], "LineState"]
    # Token(kind, start, end, text, address, value_text, value, incremental) — same fields as NcToken
def parse_number(raw: str) -> "NumericLiteral | None"
def format_number(decimal: str, original, fmt: dict, decimal_point_significant: bool = True) -> str
def scale_decimal(raw: str, percent: str) -> str   # exact Decimal arithmetic, returns a decimal string
class FeedModeTracker:                  # update(tokens) per line; .feed_mode ('G94'|'G95'|'G93'|'FZ'|'FU'), .css, .active_cycle, .pitch_feed
def report(title: str, columns: list, rows: list, message: str | None = None, findings: list | None = None) -> None
def envelope(text: str, message: str | None = None, findings: list | None = None) -> None
```

### 7.11 Command ids and default shortcuts

| Keys | Command | WP |
|---|---|---|
| Mod+N / Mod+O / Mod+S / Mod+Shift+S / Mod+Alt+S | `file.new` / `file.open` / `file.save` / `file.saveAs` / `file.saveAll` | 1.6 |
| Mod+W / (none) | `file.close` / `file.closeAll` | 1.6 |
| Cmd+Shift+W (macOS menu) | Close Window (guarded) | 1.4 |
| Ctrl+Tab / Ctrl+Shift+Tab / Mod+Alt+O | `view.nextTab` / `view.prevTab` / `view.switchTab` | 1.2 |
| F1 | Monaco command palette (`view.commandPalette` button) | 1.1 |
| Ctrl+G (all platforms) | `nav.goto` (replaces `editor.action.gotoLine`) | 3.5 |
| F7 / Shift+F7 | `nav.nextTool` / `nav.prevTool` | 3.5 |
| Mod+F2 / F2 / Shift+F2 | `bookmark.toggle` / `bookmark.next` / `bookmark.prev` (removes rename and changeAll; select-all-occurrences stays on Mod+Shift+L) | 4.4 |
| F9 / Mod+F9 | `script.runPicker` / `script.runLast` | 5.2 |
| Mod+Alt+C | `compare.with` | 2.5 |
| Mod+, | `settings.open` | 2.7 |
| Mod+Shift+O (Monaco) | quick outline | 3.5 (provider) |

The other command ids are listed in each WP.

The dispatcher ignores `AltGraph`, because Ctrl+Alt equals AltGr on some Windows layouts (D21).

---

## 8. Test infrastructure

### 8.1 Layers

- **vitest** (node environment, `sveltekit()` plugin):
  - Covers `core/**`, the stores, and the `createX(deps)` services with fakes.
  - Monaco is never imported in unit tests.
  - Tests sit next to their modules, so ownership follows the module.
- **cargo test:**
  - menu, `files_stat`, config/state/recent, and the scripts (meta, discovery, runner with an injectable interpreter)
  - the macOS quit and close-window mock tests
- **Python unittest** (`tests/python`, standard library only; CI runs 3.9 and 3.12):
  - `gedit_nc` parity with the shared goldens
  - golden cases per bundled script
- **Runtime harness** (`tests/runtime`, macOS, run by integration):
  - `window.__gedit`, test ids, and native NSEvents, alerts and quit
  - every run checks for 0 CSP violations and 0 unexpected console errors
  - it is not part of CI
- **Performance:** `tests/gen/gen-large.mjs` writes to `.perf/` (gitignored). The budgets are enforced by the `perf-*` scenarios and by vitest timing tests (loose limits on CI).

### 8.2 Fixtures

All fixtures are synthetic, written for gEdit, and marked `-text`.

- `tests/fixtures/nc/fanuc/`:
  - `f01-mill-3tools.nc`: CRLF; `%`, `O1001 (BRACKET)`, header comments, `T1 M6` followed by a preselect `T2`, `G43 H`, G81/G83/G84, `G80`, `M8`, `M98 P2000`, `M30`, `%`.
  - `f02-packed.nc`: `N10G0G90X0Y0`, `N10T1M6`, `/N100`, `N120/G0`, `/1`, `#101=[#1+2.]`, `IF […] GOTO 100`, `N100`.
  - `f03-multi-program.nc`: two O programs, `M99`.
  - `f04-feed-modes.nc`: G93/G94/G95, G96/G97, `G50 S`, `G84` pitch feed, `F#101`.
  - `f05-comments-edge.nc`: `(T1 M6)` inside a comment, an unclosed `(`, trailing comments.
  - `O1234` (no extension), `f07.tap`, `detect-fanuc.txt`.
- `tests/fixtures/nc/heidenhain/`:
  - `h01-3tools.h`: `BEGIN PGM`, `BLK FORM`, `* - ROUGH`, `;` comments, `TOOL CALL 1 Z S3000`, `CYCL DEF 200 ~` with continuation lines, `CYCL CALL`, `FMAX`, `LBL`/`CALL LBL`, `END PGM`.
  - `h02-tool-names.h`: `TOOL CALL "MILL_D10" Z S5000 F800 DL+0.1`, `QS`.
  - `h03-speed-only.h`: `TOOL CALL Z S5000`, which is not a tool change.
  - `h04-cycle-feeds.h`: Q206, `FAUTO`, `FU`/`FZ`.
  - `detect-heidenhain.txt`.
- `tests/fixtures/nc/ambiguous/`: a `.txt` of each dialect, an empty file, and a comment-only file.
- `tests/fixtures/nc/encoding/`, generated by `tests/gen/gen-encoding.mjs`: `utf8-lf.nc`, `utf8-bom-crlf.nc`, `cp1252-crlf.nc`, `cr-only.nc`, `mixed-eol.nc`, `nul-leader-trailer.nc`, `nul-inside.nc`, `nul-heavy.bin`, `utf16le-bom.nc`, `utf16be-bom.nc`.
- `tests/fixtures/expected/{detect,outline}/`
- `tests/fixtures/tokens/`, `tests/fixtures/numberformat.cases.json`
- `tests/fixtures/transforms/<id>/<case>/{input.nc,options.json,expected.nc}`
- `tests/fixtures/scripts/<script>/<case>/{input.nc,params.json,expected.*}`
- `tests/fixtures/exit/**`

---

## 9. Owner decisions (defaults in bold; the plan runs with the defaults unless the owner changes them)

| # | Decision | Default |
|---|---|---|
| D1 | Shortcut for Go to line or block. The spec says Mod+G, but Cmd+G is Find Next on macOS. | **Ctrl+G on every platform**, which is Monaco's own binding |
| D2 | NUL bytes | **Keep leader and trailer byte-exact outside the text; strip inner NULs with a count and mark the document modified; refuse as binary above 10 % inner NUL** |
| D3 | Mixed line endings | **Majority ending on the first edited save; notice at open; an unedited file is never rewritten** |
| D4 | External changes | **Poll every 2 s while focused and on focus; in-app banner; clean documents reload silently (`files.externalChange=reload`)** |
| D5 | Window state | **`tauri-plugin-window-state`** (as the spec says). Its file goes into the config folder, not `state.json`. Alternative: about 120 lines of our own code. |
| D6 | Recent files after a restart | **Rust-owned list in `state.json`, re-granted at startup (≤50)**. This is a bounded widening of the scope. |
| D7 | Open and save dialogs on macOS | **No filters** (rfd merges them). Windows and Linux get "NC programs" plus "All files". |
| D8 | Cmd+W | **Closes the tab**. Close Window moves to Cmd+Shift+W. No native File menu in P1. |
| D9 | Native menus on Windows and Linux; recent files in the native menu | **Defer to P2** |
| D10 | Dock → Quit, logout and shutdown skip the unsaved-changes prompt | **Accept for P1 and document it**; fix it in P2 together with recovery. Alternative: an isolated objc2 `applicationShouldTerminate:` hook. |
| D11 | Harness location | **Commit it to `tests/runtime/`** (a macOS-only developer tool; the scratchpad is ephemeral) |
| D12 | Svelte style | **Runes in every component; shared state in `svelte/store`** |
| D13 | Blocks JSON (Insert tab) | **Keep it, in English, until the P2 templates** |
| D14 | v1 script commands | **Remove them at the end of M5.** Scripts without a header run through v2 in panel mode, and "Scripts Dir" becomes `scripts.folders`. |
| D15 | Interpreter and script folders | **Read by Rust from the environment and `settings.json`, never passed over IPC** |
| D16 | The script `documents` field | **Only `active` in P1** (`all-open` and `pick` come with the P2 scripts that need them) |
| D17 | New documents | **UTF-8 without BOM, with the profile's `newFileLineEnding` (CRLF)** |
| D18 | Large files | **Keep Monaco's thresholds** (no highlighting above 20 MB or 300k lines). A later option could add a setting. |
| D19 | Theme and title bar | **Add `core:window:allow-set-theme`** |
| D20 | Killing script child processes | **Unix: the whole process group; Windows: the direct child only** |
| D21 | Save All, quick switcher, compare, settings | **Mod+Alt+S, Mod+Alt+O, Mod+Alt+C, Mod+,**. AltGr combinations are ignored on Windows. |
| D22 | UTF-16 | **Read and write UTF-16 LE/BE with a BOM** |

---

## 10. Deferred or simplified items

1. Native menu mirroring on every platform, and recent files in the native menu: P2 (D9).
2. Mixed EOL preserved per line: simplified to the majority ending (D3).
3. NUL-heavy files opened read-only: they are refused instead. The read-only viewer is P2.
4. Script `documents: all-open | pick`: P2 (D16).
5. Killing the whole process tree on Windows: direct child only (D20).
6. JSON Schema files for profiles, codes and settings; user profiles and `extends`: P2. P1 has hand-written validators.
7. Hover delay and modifier modes; completion mode per profile: P2.
8. Load and save formatting (`insertSpaces` on open, `onSave`), and `files.encoding` conversion to ascii or latin1: P2.
9. Klartext comment toggle after a block number: Monaco's default in P1.
10. fs watch: replaced by polling (D4).
11. Opening the About links: they are copyable text (no opener plugin).
12. Clipboard on Windows and Linux: manual check.
13. Blocks turned into parametric templates: P2 (D13).
14. Session restore, per-file memory, bookmark persistence and names: P2.
15. The Dock-quit and logout guard: P2 (D10).
16. Atomic document saves: P2, together with backup on save. Documents are written in place.
17. Report findings as editor markers: backlog.
18. Parsing in a web worker: replaced by the incremental `OutlineIndex`.
19. Profile `highlight` rules and per-profile `colors`: P2.
20. Quick switcher in most-recently-used order: P1 uses tab order.
21. Command palette while the editor is not focused: the palette button focuses the editor first.
22. The harness in CI: macOS native UI only, so it stays out of CI.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The M1 rewrite breaks behavior that works today (close guard, encoding round trip, Cmd+Q) | M0 decouples the harness first (test ids and the stable hook). The M0 regression suite gates M1, and only the listed intentional changes may edit it. |
| Parallel WPs drift apart | Contracts and stubs come from the preludes; ownership is disjoint and checked (G0); contributions are glob-loaded; integration is limited to wiring. |
| Keybinding conflicts (Monaco defaults, macOS menu, WKWebView: Cmd+W, Cmd+G, F2, Ctrl+Tab) | Explicit `-command` removals; the registry reports conflicts as console errors; native-key harness checks (`m1-keys`, `m3-nav`, `m4-bookmarks`); D1 and D8. |
| Double dispatch between Monaco actions and the window handler | The dispatcher skips `defaultPrevented` and Monaco targets; "Cmd+S saves exactly once" is checked with native events. |
| Large files of 5–50 MB | Monaco thresholds (F8); the compare guard at 50 MB; the incremental outline built in chunks; minimal edits within lines with a chunked fallback; budgets at every gate. |
| 300k single-line edit operations | Chunking above 20k changed lines; `m4-perf-transform`. Bookmarks inside a merged hunk may shift (documented). |
| WKWebView quirks (timers throttled when hidden, HTML5 drag and drop, sheet dialogs) | The harness turns off occlusion detection; pointer events for reorder and splitters; every native dialog goes through `exclusive()`. |
| The drag-and-drop grant, or a real Finder drag, cannot be tested | F2 is verified in source; `h_drop` reproduces the plugin grant; the owner does a manual Finder drag (§12). |
| The fs scope compares paths that are not canonicalized (`/tmp` vs `/private/tmp`) | Rust grants both the given and the canonical path. |
| Offline builds | Only `vitest` (M0) and `tauri-plugin-window-state` (M2) need network, and only in the preludes. |
| TS and Python tokenizers drift apart; ECMAScript vs Python regex | Shared goldens tested on both sides; the pattern-subset rule; every profile pattern is compiled in Python. |
| Rounding differences between TS and Python | Formatting on decimal strings, half away from zero, with shared cases. |
| A dependency breaks the CSP | No new runtime JS dependencies; the `eval` grep gate; 0 violations required in every harness run. |
| Script processes leak (timeout, cancel, quit) | Rust deadline and cancel; `kill_all` on Exit; Unix process groups; `h_pgrep` checks. |
| Windows `python` is the Store alias stub | `python_check` treats exit 9009 as "not found"; script features are disabled. |
| External-change false positives (own writes, coarse mtime on SMB or FAT) | Stamp after every own write; `(mtime, size)`, then the content hash; a `null` mtime only records; poll only while focused. |
| The harness pollutes the real config folder | `HOME` isolation per run (F13); an explicit `GEDIT_PYTHON`. |
| The code database content is wrong for some controls | CAM subset only; `verify: true` entries are left out of hover; unknown codes are shown as unknown; the owner reviews the content at M3. |
| Integration becomes a bottleneck | WPs ship their tests and hand-off notes; the `Hn` scenarios are written in parallel with Wave B; integration fixes are limited to wiring. |

---

## 12. Manual checks for the owner (cannot be automated here)

- Drop real files from Finder or Explorer onto the window. They open, and a dropped folder is ignored with a message.
- In the macOS Open dialog, the extensionless `O1234` and a `.tap` file can be selected, and Save As does not force an extension.
- Smoke-test the CI debug bundles on Windows and Linux: open, edit, byte-exact save, the close guard, Ctrl+W and Ctrl+Tab, and a script run with and without Python.
- On Windows with an AltGr layout (for example Swiss German), Mod+Alt shortcuts do not steal AltGr characters.
- F-key shortcuts on a Mac laptop keyboard (Fn behavior).
- Review the code database content (M3) and the exit-criteria goldens (M5).
