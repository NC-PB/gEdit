# Contributing to gEdit

Thanks for helping. gEdit is a small project run by part-time contributors, so focused pull requests with tests are the easiest to review.

Four documents to know about before you start: [docs/user](docs/user/README.md) is what the app does today, from a CNC programmer's point of view; [docs/planning](docs/planning/README.md) is what we plan to build and why; [phase-1-implementation.md](docs/planning/phase-1-implementation.md) is the executed plan for Phase 1 — architecture, the binding contracts in §7, and the decisions behind them; and [phase-2-implementation.md](docs/planning/phase-2-implementation.md) is the plan being executed now (M6–M13, re-cut on 2026-09-30): the contracts it adds (its §7, with the test ids in §7.12 and the deviations in §7.16), the dialect and machine data (§8) and the owner decisions (§10). What is still open, in the code and in the decisions, is collected in [TODO.md](TODO.md).

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
| `npm run check` | Type check (svelte-check). Must report 0 errors and 0 warnings. |
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
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

Python tests (the bundled scripts and their shared library): `python3 -m unittest discover -s tests/python -t .`

A unit test that asserts a wall-clock budget goes through `tests/unit/helpers/budget.ts`: the budget is measured on the development machine, and CI multiplies it by a fixed factor (see [phase-2-implementation.md](docs/planning/phase-2-implementation.md) §5.2, rule 13).

### Before you open a pull request

Run what CI runs: `npm run check`, `npm test`, `npm run build`, `npm run licenses:check`, `npm run versions:check`, and the three cargo commands above. `npm run check` must report **0 errors and 0 warnings**. If you touched `src-tauri/resources/scripts/` or `tests/python/`, run the Python tests too. If your change touches the window, dialogs, file handling or keyboard handling, also run the runtime harness on a Mac (see below), or push to a branch and start the Harness workflow by hand (Actions tab), or ask a maintainer to run it. Since M9 the runtime suite runs on GitHub on every push to `main`, so the owner's Mac is no longer needed for it.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request:

- **checks** (Linux): type check, unit tests, frontend build, license notices, versions, a scan of the built bundle for `eval`, `Function(…)` and the test hook, and `rustfmt --check` on the harness source.
- **python** (Linux, on 3.9 and 3.12): the bundled scripts' tests. The 3.9 leg is what keeps the oldest supported interpreter honest.
- **rust** (macOS, Windows, Linux): `cargo fmt`, `clippy` with warnings as errors, `cargo test`.
- **bundle** (macOS, Windows, Linux): an unsigned debug build of the installers, uploaded as workflow artifacts for manual smoke tests.

The runtime harness has a workflow of its own, `.github/workflows/harness.yml`: it builds the patched app on a GitHub-hosted macOS 14 runner (which has a live desktop session) and runs the cumulative suite m0 to m10 (92 scenarios). It is not part of `ci.yml` and does not run on pull requests, because it takes about 25 minutes of macOS runner time; it runs on every push to `main` and on demand (Actions tab, Harness, Run workflow), and uploads the result files and app logs as the `harness-results` artifact.

## Releases

`.github/workflows/release.yml` builds the release installers and puts them on a **draft** GitHub release; the owner publishes it by hand after the checklist in [docs/releases/checklist.md](docs/releases/checklist.md). To cut a release, set the version everywhere (see Versions below), add a `## vX.Y.Z (date)` entry to `CHANGELOG.md` (the draft takes its notes from it, and GitHub shows every line break of release notes, so write each paragraph and each bullet on one line), merge to `main`, and push the tag `vX.Y.Z`. The workflow then:

- fails unless the tag equals `v` plus the version `npm run versions:check` agrees on, the commit is on `main`, and the CHANGELOG has the entry;
- runs `ci.yml` on the tagged commit (by `workflow_call`, without the debug bundles), in parallel with the bundles;
- builds unsigned release bundles: one universal `.dmg` on macOS, `.msi` and NSIS `.exe` on Windows, `.deb`, `.rpm` and `.AppImage` on Linux;
- creates the draft release, or refreshes the draft already there, with the bundles and a `SHA256SUMS` file. It never publishes, and it fails if the tag already has a published release.

Run it by hand from the Actions tab (Release > Run workflow) for a dry run: the bundles come out as workflow artifacts and no release is read or changed. Only the last job can write (`contents: write`), and only for a tag push.

A tag run uses the `release.yml` of the tagged commit, so the workflow's own "is on `main`" check guards against mistakes, not against someone who may push tags. What limits who can cut a release is repository settings, which the owner keeps in place: a **tag ruleset** on `refs/tags/v*` that restricts creation, update and deletion to the owner (bypass list: admin), and **branch protection** on `main`.

## Folder layout

```
src/lib/
  core/        Pure TypeScript: no Svelte, Monaco or Tauri at runtime (type imports are fine).
               Text codecs, key specs, NC tokenizer, profiles, grammar, codes, navigation,
               transforms, forms, settings, scripting, machines (number rules and the
               effective profile of a machine). Unit tested in node.
  app/         Services and wiring: contracts (types.ts), bootstrap, contribution loader,
               registries, file operations, dialogs, status, test hook.
  stores/      svelte/store modules for shared state (documents, layout, settings, ...).
  monaco/      Everything that talks to Monaco: setup, editor service, languages, themes, providers.
  platform/    commands.ts: typed wrappers for every custom Tauri command.
  contrib/     One file per feature. Features plug into the app only from here.
  components/  Svelte components (shell, editor, panels, status, menus, forms, dialogs).
  i18n/        t() and the English message files, one namespace per feature.
  data/        Profiles, code database, blocks, and the generated licenses.json.
  utils/       Small helpers: platform detection, path spelling (plainPath), the code-block lookup.
src-tauri/src/ Rust: a thin lib.rs plus one module per concern (menu, files, config, state, scripts, ...).
src-tauri/resources/scripts/  Bundled Python scripts and gedit_nc.py (see its README.md).
tests/         fixtures/ gen/ unit/ python/ runtime/ real/ (real/ is gitignored except its README)
docs/user/     The user guide. docs/planning/ is the design and roadmap notes.
```

## Conventions

### Svelte and state

- Components use runes (`$props`, `$state`, `$derived`) and callback props.
- Shared state lives in `svelte/store` stores inside plain `.ts` modules, not in `.svelte.ts` classes. Such modules can be imported anywhere and tested in node without the compiler.
- Monaco objects (models, editors, decorations) never go into a store.
- A service with dependencies is a factory, `createX(deps)`, plus a default instance wired to the real modules. Tests pass fakes to the factory.

### Features are contributions

- A feature is one file in `src/lib/contrib/` that default-exports a `Contribution` (commands, ribbon items, ribbon groups, panels, status items, keybinding removals, `activate()`).
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
- **One file is one string.** A path is put into one spelling before it is compared or stored — `paths::plain` in Rust, `plainPath` in `src/lib/utils/platform.ts` — because `canonicalize` on Windows answers with the `\\?\` form while other paths arrive in the ordinary one, and the two spellings must still be one tab, one recent entry and one backup history. Script and snapshot names are checked against the Windows device names (`CON`, `NUL`, `COM1`…), which name a device whatever the extension. CI runs the Rust tests on Windows, so gate a test to Unix only when the behaviour itself is Unix-only.

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

`src-tauri/resources/scripts/` ships with the app, and a script there is a user-visible feature with a public contract. Read [its README](src-tauri/resources/scripts/README.md) before adding or changing one. In short: standard library only, it has to run on Python 3.9 as well as on the newest release, work on tokens from `gedit_nc.tokenize_line` rather than on a regex over raw lines, and use `scale_decimal` / `format_number` for every number. The tokenizer and number formatting of `gedit_nc` are ports of `src/lib/core/nc/*.ts`, and its number rules a port of `src/lib/core/machines/numbers.ts`; they are held to the same goldens under `tests/fixtures/` (`tokens/`, `numberformat.cases.json`, `machines/numbers.json`), and the Python modal interpreter to `tests/fixtures/modal/`. When one side changes, the fixture changes with it and **both** sides are re-run.

### Documentation

Three audiences, three places. Keep them apart.

- **`docs/user/`** — the user guide, written for a CNC programmer, not for a developer. No file paths, no module names, no milestone numbers. It describes what the shipped app does, and it is honest about what it does not do: the limits section is as much a part of it as the feature list. A pull request that changes behaviour a user can see updates it in the same change.
- **`docs/planning/`** — design notes and the roadmap: what we intend, why, and what is deferred. [phase-1-implementation.md](docs/planning/phase-1-implementation.md) and [phase-2-implementation.md](docs/planning/phase-2-implementation.md) additionally carry the binding contracts (§7 in each) and the record of where the implementation deviated from them (§7.12 in Phase 1, §7.16 in Phase 2).
- **Module headers** — why this code is shaped this way. They are the first thing to read before changing a module, and the place a decision belongs when it would otherwise be lost.

The generated surfaces are not documentation to maintain by hand: the shortcut dialog is built from the command registry, and the About dialog's notices from `licenses.json`. `docs/user/shortcuts.md` mirrors the dialog for people who want to read it before installing, and adds the editor component's own editing keys, which the dialog lists without a key (the gEdit commands that wrap them deliberately carry none). For every key gEdit assigns, the dialog wins if the two disagree.

### Test fixtures are synthetic

- Every NC program under `tests/fixtures/` is written for gEdit and says so in a comment at the top. Never commit real customer or shop programs, not even anonymized ones. The rules and a description of every file are in [tests/fixtures/README.md](tests/fixtures/README.md). The one exception is reserved: `tests/fixtures/nc/owner-public/`, for the few programs the owner hands over as safe to publish. Each one needs a permission line in that README and goes in only after the owner has gone through what `node tests/gen/check-anonymized.mjs` flags in it (a reading aid, not a filter; Phase 2 plan §9.2).
- Your own programs belong in `tests/real/` (gitignored except its README) or in a folder named by `GEDIT_REAL_FIXTURES`. `npm test -- realFixtures` and `tests/python/test_real_fixtures.py` check them on your machine and print counts only, never a file name or program text; without such a folder they skip. By default they fail only on a crash; `GEDIT_G11=strict` fails on every failure, `GEDIT_G11_REPORT=<file>` writes the report as JSON, and `GEDIT_PYTHON` names the Python 3.9+ the script checks use. See [tests/real/README.md](tests/real/README.md).
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

Scripts go through `src-tauri/src/scripts/`, whose module documentation states both what those rules buy (no path traversal, no editable bundled script, no shell, a bounded deadline, capped output, killed on exit) and what they do not: a script is an ordinary program with the user's rights, and gEdit cannot sandbox it. Do not restate that guarantee more strongly than the module does — the user guide's "only run scripts you trust" is the actual security model, and the CSP is the primary barrier. The first script runner (`run_python_script` and `list_python_scripts`, which took a folder) predated rules 3 and 6 and was removed at the end of Phase 1 (plan D14); `m0-main` checks that neither command answers any more.

## Tests

- **Unit tests (vitest):** `*.test.ts` next to the module under `src/`, or under `tests/unit/`. They run in node; never import Monaco or the Tauri API in a unit test. Test services through their `createX(deps)` factory with fakes.
- **Rust:** `cargo test` in `src-tauri/`.
- **Python:** standard-library `unittest` under `tests/python/`, with the same golden files as the TypeScript side where both implement the same logic.
- **Runtime harness (macOS):** see the next section.

## Runtime harness (macOS)

The harness in `tests/runtime/` builds a test variant of the app and drives it like a user would: native key and mouse events, stubbed file dialogs that grant paths like the real ones, real alerts, and real quit handling. It reads the app state through `data-testid` attributes and the `window.__gedit` test hook. Prerequisites and the full reference are in `tests/runtime/README.md`. A maintainer can run the same suite on a runner with the Harness workflow (see Continuous integration).

```sh
tests/runtime/sync.sh                                # copy the repo to $GEDIT_RH_DIR/app (default $TMPDIR/gedit-rh/app), patch in the harness, build
tests/runtime/run.sh m0-main                         # run one scenario; exits 0 on pass
tests/runtime/suite.sh tests/runtime/suites/m0.txt   # run a suite; prints a PASS/FLAKY/FAIL/BLOCKED table (non-zero exit on FAIL or BLOCKED)
```

- Your working tree is not modified; the harness is patched into the copy.
- The app window is visible and receives native input, so do not use the Mac while a run is in progress. Runs and syncs are serialized with a lock; two harness folders on one Mac share one lock through `GEDIT_RH_LOCK`.
- Each run gets a fresh `HOME` and an explicit `GEDIT_PYTHON`, so your real settings and recent files are never touched and results do not depend on your shell setup. Two exceptions are deliberate: a numbered scenario (`…-2`) reads the `HOME` its predecessors wrote, and the scenarios that test the interpreter lookup itself leave `GEDIT_PYTHON` unset.
- A run fails on any failed check, on a CSP violation the scenario did not ask for, and on a console error that is neither expected nor known noise. It also fails when the app asks for a file dialog nobody queued, when a queued dialog answer is left unused, when the app exits when it should not have (or does not exit when it should), or when an alert is left open. A run that could not get the keyboard (a locked screen, another app in front) is BLOCKED rather than failed, and `suite.sh` runs a failed scenario once more and reports a pass on the retry as FLAKY.

Writing scenarios:

- Find elements by `data-testid` (the lists are §7.9 of phase-1-implementation.md and §7.12 of phase-2-implementation.md), never by visible text. If you need a new test id, add it to the Phase 2 table in the same pull request.
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

The app version is set in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Change all three together, let `npm install` and a cargo build refresh the lockfiles, and run `npm run versions:check`. (`npm version X.Y.Z --no-git-tag-version` does `package.json` and its lockfile; `cargo update -p gedit --offline` in `src-tauri/` does `Cargo.lock`.) The release workflow refuses a tag that differs from this version.

## License

gEdit is MIT licensed. By contributing you agree that your contribution is released under the same license.
