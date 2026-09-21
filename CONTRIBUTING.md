# Contributing to gEdit

Thanks for helping. gEdit is a small project run by part-time contributors, so focused pull requests with tests are the easiest to review.

Three documents to know about before you start: [docs/user](docs/user/README.md) is what the app does today, from a CNC programmer's point of view; [docs/planning](docs/planning/README.md) is what we plan to build and why; and [phase-1-implementation.md](docs/planning/phase-1-implementation.md) is the executed plan for Phase 1 — architecture, the binding contracts in §7, and the decisions behind them.

## Setup

You need:

- **Node.js 22** (the version CI uses) and npm.
- **Rust**, stable toolchain, with `rustfmt` and `clippy`.
- The **Tauri prerequisites** for your platform: <https://tauri.app/start/prerequisites/>. On Debian or Ubuntu that is:
  ```sh
  sudo apt-get install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **Python 3.9 or newer**, only for the script features and their tests. CI runs them on 3.9 and 3.12, so do not use syntax the older one rejects.

Then:

```sh
npm ci                 # install exactly what package-lock.json pins
npm run tauri dev      # start the app with hot reload
```

## Commands

| Command | What it does |
|---|---|
| `npm run tauri dev` | Runs the app in development mode. |
| `npm run check` | Type check (svelte-check). Must report 0 errors. |
| `npm test` | Unit tests (vitest, node environment). `npm run test:watch` reruns on change. |
| `npm run build` | Builds the frontend into `build/`. |
| `npm run tauri build` | Builds the installers. `npx tauri build --debug` gives a faster, unoptimized bundle. |
| `npm run licenses` | Regenerates `src/lib/data/licenses.json` (see [Third-party notices](#third-party-notices)). |
| `npm run licenses:check` | Fails if `licenses.json` is out of date. |
| `npm run versions:check` | Fails if the app version differs between `package.json`, `tauri.conf.json`, `Cargo.toml` and the lockfiles. |

Rust checks run inside `src-tauri/`. Build the frontend first, because `tauri::generate_context!` embeds the `build/` folder at compile time:

```sh
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Python tests (the bundled scripts and their shared library): `python3 -m unittest discover -s tests/python -t .`

### Before you open a pull request

Run what CI runs: `npm run check`, `npm test`, `npm run build`, `npm run licenses:check`, `npm run versions:check`, and the three cargo commands above. `npm run check` must report **0 errors and 0 warnings**. If you touched `src-tauri/resources/scripts/` or `tests/python/`, run the Python tests too. If your change touches the window, dialogs, file handling or keyboard handling, also run the runtime harness on a Mac (see below) or ask a maintainer to run it.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request:

- **checks** (Linux): type check, unit tests, frontend build, license notices, versions, a scan of the built bundle for `eval`, `Function(…)` and the test hook, and `rustfmt --check` on the harness source.
- **python** (Linux, on 3.9 and 3.12): the bundled scripts' tests. The 3.9 leg is what keeps the oldest supported interpreter honest.
- **rust** (macOS, Windows, Linux): `cargo fmt`, `clippy` with warnings as errors, `cargo test`.
- **bundle** (macOS, Windows, Linux): an unsigned debug build of the installers, uploaded as workflow artifacts for manual smoke tests.

The runtime harness is not part of CI, because it needs a real macOS desktop.

## Folder layout

```
src/lib/
  core/        Pure TypeScript: no Svelte, Monaco or Tauri at runtime (type imports are fine).
               Text codecs, key specs, NC tokenizer, profiles, grammar, codes, navigation,
               transforms, forms, settings, scripting. Unit tested in node.
  app/         Services and wiring: contracts (types.ts), bootstrap, contribution loader,
               registries, file operations, dialogs, status, test hook.
  stores/      svelte/store modules for shared state (documents, layout, settings, ...).
  monaco/      Everything that talks to Monaco: setup, editor service, languages, themes, providers.
  platform/    commands.ts: typed wrappers for every custom Tauri command.
  contrib/     One file per feature. Features plug into the app only from here.
  components/  Svelte components (shell, editor, panels, status, menus, forms, dialogs).
  i18n/        t() and the English message files, one namespace per feature.
  data/        Profiles, code database, blocks, and the generated licenses.json.
src-tauri/src/ Rust: a thin lib.rs plus one module per concern (menu, files, config, state, scripts, ...).
src-tauri/resources/scripts/  Bundled Python scripts and gedit_nc.py (see its README.md).
tests/         fixtures/ gen/ unit/ python/ runtime/ perf/
docs/user/     The user guide. docs/planning/ is the design and roadmap notes.
```

## Conventions

### Svelte and state

- Components use runes (`$props`, `$state`, `$derived`) and callback props.
- Shared state lives in `svelte/store` stores inside plain `.ts` modules, not in `.svelte.ts` classes. Such modules can be imported anywhere and tested in node without the compiler.
- Monaco objects (models, editors, decorations) never go into a store.
- A service with dependencies is a factory, `createX(deps)`, plus a default instance wired to the real modules. Tests pass fakes to the factory.

### Features are contributions

- A feature is one file in `src/lib/contrib/` that default-exports a `Contribution` (commands, ribbon items, panels, status items, keybinding removals, `activate()`).
- The files are loaded with `import.meta.glob`, sorted by name. Adding a feature therefore never means editing the ribbon, the status bar, `+page.svelte` or a central list.

### Commands and keys

- One command registry feeds the ribbon, the window key handler, Monaco's command palette (F1) and the harness.
- Key specs are written like `Mod+S`, `Ctrl+G`, `Shift+F7` or `Mod+Alt+S`. `Mod` is Cmd on macOS and Ctrl elsewhere; `Ctrl` is always the Control key.
- Registering a key that is already taken logs a console error. The harness fails on unexpected console errors, so conflicts are caught before they ship.
- A command that only wraps an action Monaco already lists in F1 sets `palette: false`, so the palette shows no duplicates.

### Documents and the editor

- There is one editor and one Monaco model per document. Model text is LF-normalized; saving joins the lines with the document's own line ending, so CRLF and CR-only files keep their bytes.
- **One undo step per operation.** Transforms, script results, reloads and inserts all apply their edits as `pushStackElement`, `pushEditOperations`, `pushStackElement`. `setValue` is only used when a model is created.
- Never change encoding, line endings or bytes the user did not ask to change.

### UI strings

- New code has no user-visible string literals in components or services. Look strings up with `t('namespace.key', params)` from `$lib/i18n`.
- Parameters use `{name}` placeholders. Plurals use `key_one` and `key_other`, selected by `params.count`.
- Each feature has its own namespace file, `src/lib/i18n/en/<namespace>.ts`. The files are glob-loaded, so no central list needs editing.
- A test scans the sources for literal `t('…')` keys and fails on keys that do not exist.
- Rust returns English detail text, shown under a translated summary. Script names and profile labels are data and are not translated.

### Dependencies

- The Content Security Policy has no `unsafe-eval`. Do not add a dependency that uses `eval` or `Function(…)`, with or without `new` (this includes schema validators that generate code, and the `Function("return this")` shape of the globalThis polyfill). CI scans the bundle for both.
- `fetch()` of bundled files is blocked by the CSP. Load bundled data with a static import, `?raw`, or a dynamic `import()`.
- New runtime dependencies need a good reason; open an issue first. After any dependency change, run `npm run licenses` and commit the result.

### Content in your own words

Completion texts, code descriptions, templates, help and documentation are written by contributors in their own words. Control manuals are a source of facts only; do not copy their text, tables or illustrations, and do not copy text from other editors' documentation.

### Bundled Python scripts

`src-tauri/resources/scripts/` ships with the app, and a script there is a user-visible feature with a public contract. Read [its README](src-tauri/resources/scripts/README.md) before adding or changing one. In short: standard library only, it has to run on Python 3.9 as well as on the newest release, work on tokens from `gedit_nc.tokenize_line` rather than on a regex over raw lines, and use `scale_decimal` / `format_number` for every number. `gedit_nc.py`'s tokenizer and number formatting are ports of `src/lib/core/nc/*.ts` and are held to the same goldens under `tests/fixtures/`: when one side changes, the fixture changes with it and **both** sides are re-run.

### Documentation

Three audiences, three places. Keep them apart.

- **`docs/user/`** — the user guide, written for a CNC programmer, not for a developer. No file paths, no module names, no milestone numbers. It describes what the shipped app does, and it is honest about what it does not do: the limits section is as much a part of it as the feature list. A pull request that changes behaviour a user can see updates it in the same change.
- **`docs/planning/`** — design notes and the roadmap: what we intend, why, and what is deferred. [phase-1-implementation.md](docs/planning/phase-1-implementation.md) additionally carries the binding contracts (§7) and the record of where the implementation deviated from them.
- **Module headers** — why this code is shaped this way. They are the first thing to read before changing a module, and the place a decision belongs when it would otherwise be lost.

The generated surfaces are not documentation to maintain by hand: the shortcut dialog is built from the command registry, and the About dialog's notices from `licenses.json`. `docs/user/shortcuts.md` mirrors the dialog for people who want to read it before installing, and says the dialog wins if the two disagree.

### Test fixtures are synthetic

- Every NC program under `tests/fixtures/` is written for gEdit and says so in a comment at the top. Never commit real customer or shop programs, not even anonymized ones. The rules and a description of every file are in [tests/fixtures/README.md](tests/fixtures/README.md).
- Fixtures are byte-exact: `.gitattributes` marks them `-text`, so git never rewrites their line endings. Encoding fixtures are produced by `tests/gen/gen-encoding.mjs`; change the generator, not the files, and run `node tests/gen/gen-encoding.mjs` to rewrite them.
- Large test programs come from `tests/gen/gen-large.mjs` and go into `.perf/`, which is not committed.

### Code style

- TypeScript is strict. Rust must be clean under `cargo fmt` and `clippy -D warnings`.
- Comments are short and explain why, not what. Everything in the repository is in English.

## Security rules

These rules are checked in review. Changing one needs a discussion first.

1. The CSP stays as it is, and capabilities are not widened. Do not add fs, shell, opener or similar permissions. (`core:window:allow-set-theme`, so the title bar follows the theme, is the only one Phase 1 added.) Paths reach the fs scope through the dialogs, drag and drop, or a Rust command that grants exactly one file.
2. Never add `src-tauri/permissions/` or an app ACL manifest. Custom commands work without one, and adding it would change how every command is authorized.
3. Every Rust command that takes a path checks `fs_scope().is_allowed(path)`, or it takes an id and resolves it against fixed roots (rejecting `..`, separators and symlink escapes).
4. No `{@html}` with content from files, scripts or profiles. Monaco hovers use `isTrusted: false` and `supportHtml: false`.
5. No dependency that uses `eval` or `Function(…)`, with or without `new`.
6. Scripts never run automatically. The webview sends a script id, never a script path or an interpreter path.

Scripts go through `src-tauri/src/scripts/`, whose module documentation states both what those rules buy (no path traversal, no editable bundled script, no shell, a bounded deadline, capped output, killed on exit) and what they do not: a script is an ordinary program with the user's rights, and gEdit cannot sandbox it. Do not restate that guarantee more strongly than the module does — the user guide's "only run scripts you trust" is the actual security model, and the CSP is the primary barrier. The first script runner (`run_python_script` and `list_python_scripts`, which take a folder) predates rules 3 and 6 and is removed at the end of Phase 1; do not build on it.

## Tests

- **Unit tests (vitest):** `*.test.ts` next to the module under `src/`, or under `tests/unit/`. They run in node; never import Monaco or the Tauri API in a unit test. Test services through their `createX(deps)` factory with fakes.
- **Rust:** `cargo test` in `src-tauri/`.
- **Python:** standard-library `unittest` under `tests/python/`, with the same golden files as the TypeScript side where both implement the same logic.
- **Runtime harness (macOS):** see the next section.

## Runtime harness (macOS)

The harness in `tests/runtime/` builds a test variant of the app and drives it like a user would: native key and mouse events, stubbed file dialogs that grant paths like the real ones, real alerts, and real quit handling. It reads the app state through `data-testid` attributes and the `window.__gedit` test hook. Prerequisites and the full reference are in `tests/runtime/README.md`.

```sh
tests/runtime/sync.sh                                # copy the repo to $GEDIT_RH_DIR (default $TMPDIR/gedit-rh), patch in the harness, build
tests/runtime/run.sh m0-main                         # run one scenario; exits 0 on pass
tests/runtime/suite.sh tests/runtime/suites/m0.txt   # run a suite and print a PASS/FAIL table
```

- Your working tree is not modified; the harness is patched into the copy.
- The app window is visible and receives native input, so do not use the Mac while a run is in progress. Runs are serialized with a lock.
- Each run gets a fresh `HOME` and an explicit `GEDIT_PYTHON`, so your real settings and recent files are never touched and results do not depend on your shell setup. The scenarios that test the interpreter lookup itself deliberately leave `GEDIT_PYTHON` unset.
- A run fails on any failed check, on a CSP violation the scenario did not ask for, and on a console error that is neither expected nor known noise. It also fails when the app asks for a file dialog nobody queued, when a queued dialog answer is left unused, or when the app exits when it should not have (or does not exit when it should).

Writing scenarios:

- Find elements by `data-testid` (the list is in §7.9 of the plan), never by visible text. If you need a new test id, add it to that table in the same pull request.
- Read state through `h.app` (the test hook) rather than by parsing the DOM where the hook offers it.
- The test hook only exists in builds made with `VITE_GEDIT_TEST=1`. The production bundle must not contain `__gedit`; CI checks this.
- `tests/runtime/harness/harness.rs` is compiled only inside the patched copy, so `cargo fmt` and `clippy` in `src-tauri/` never see it. Run `rustfmt --edition 2021 tests/runtime/harness/harness.rs` after editing it; CI checks the formatting.

## Third-party notices

`src/lib/data/licenses.json` lists every third-party package that ships with gEdit, for the About dialog. It is generated by `npm run licenses`, and CI fails when it is stale. Regenerate and commit it whenever `package-lock.json` or `src-tauri/Cargo.lock` changes.

- npm packages come from the production dependency tree, plus the few dev dependencies whose code ends up in the bundle (listed in `BUNDLED_DEV_PACKAGES` in the script) together with their own runtime dependencies.
- Rust crates are all normal dependencies of the app, for every platform.
- Every package contributes its own `LICENSE`, `COPYING` and `NOTICE` files verbatim. This is what the MIT, BSD and Apache terms ask for: the original copyright line has to travel with the code. A package that ships no license file at all falls back to the standard text for its SPDX id, whose copyright line is a placeholder; where such a package offers a choice (`MIT OR Apache-2.0`), MIT is used.
- If the script stops with "no canonical text", a dependency uses a license id the script does not know yet. Add its standard SPDX text to `CANONICAL_TEXTS` in `scripts/gen-licenses.mjs`, and check that the license is compatible with MIT distribution.
- `cargo metadata` runs offline and unpacks the crate sources the license files are read from. On a fresh machine, run `cargo fetch --locked` in `src-tauri/` once.

## Versions

The app version is set in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Change all three together, let `npm install` and a cargo build refresh the lockfiles, and run `npm run versions:check`.

## License

gEdit is MIT licensed. By contributing you agree that your contribution is released under the same license.
