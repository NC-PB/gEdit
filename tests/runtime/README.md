# Runtime harness

The harness builds a test variant of gEdit and drives it like a user: real key presses
and mouse clicks, the real unsaved-changes alert, real quit handling, and stubbed file
dialogs that grant paths exactly as the dialog plugin does. A scenario reads the app
through `data-testid` attributes and the `window.__gedit` test hook (plan §7.9), never
through visible text.

It is the only test layer that runs the whole app, so it is what proves the behaviour
of the window, the file operations and the backend. It is **not** part of CI: it needs
a real macOS desktop.

## Prerequisites

- macOS, with a screen you are not using while a run is in progress: the window is
  visible, takes over the keyboard focus and receives native events.
- Node and Rust as for a normal build (`npm install` once; `cargo` on PATH).
- Python 3 for the script scenarios. Every run passes an explicit `GEDIT_PYTHON`
  unless the scenario tests the lookup itself, so your shell setup does not change
  the result.

## Usage

```sh
tests/runtime/sync.sh                                # copy the repo, patch the harness in, build
tests/runtime/run.sh m0-main                         # run one scenario; exits 0 when it passes
tests/runtime/suite.sh tests/runtime/suites/m0.txt   # run a suite and print a PASS/FAIL table
```

- `sync.sh [--repo DIR]` copies the working tree (including uncommitted changes) to
  `$GEDIT_RH_DIR/app`, symlinks `node_modules` back to the repo, patches `lib.rs`,
  `Cargo.toml` and `tauri.conf.json`, and builds. Run it again after every change to
  the app or to `harness/harness.rs`; scenarios and `lib/` are read fresh on each run.
- `run.sh <scenario> [--home DIR] [--keep-home] [--env K=V]… [--timeout S]`.
- `suite.sh <suite.txt | scenario>…` runs them one after another.
- Everything lives under `$GEDIT_RH_DIR` (default `$TMPDIR/gedit-rh`): the build in
  `app/` and `target/`, one folder per run under `runs/<scenario>/` with `app.log`,
  and the result as `out/<scenario>.json`.
- Runs and syncs take a lock (`$GEDIT_RH_DIR/lock`), so two of them never fight over
  the screen. A lock whose owner died is taken over.
- The repository is never modified. The patched copy is.

## What makes a run fail

`out/<scenario>.json` holds `{ pass, checks, violations, errors, … }`. A run fails when

- a `h.check(...)` failed, or the scenario threw,
- the page reported a CSP violation that the scenario did not ask for,
- a console error turned up that is neither expected (`h.allowErrors(...)`) nor known
  noise (see below),
- the app asked for a file dialog nobody queued, or left a queued answer unused,
- the app exited when it should not have, or did not exit when it should.

Known console noise, allowed in every run:

- `NotAllowedError` from Monaco's clipboard workaround under synthetic events.
- `Canceled` rejections: how Monaco ends work it no longer needs.
- `ResizeObserver loop completed with undelivered notifications`, from Monaco's
  `automaticLayout` while a panel toggle resizes the editor. It is a spec notification
  that the loop deferred callbacks to the next frame, not an exception; startup itself
  is clean.

## Writing a scenario

```js
import { scenario } from '../lib/index.js'

scenario('m1-example', { timeout: 90 }, async (h) => {
  const file = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  await h.dialogs.queue('open', file)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'f01-mill-3tools.nc — gEdit')
  h.check('the file is open', h.app.text().startsWith('(WRITTEN FOR GEDIT'))
})
```

- One file per topic under `scenarios/`; a file may register several scenarios, and
  `run.sh` selects by name, so names are unique across all files.
- Find elements with `h.q('<test id>', { attr: 'value' })`. The test ids are the
  contract in §7.9 of the plan; a new one belongs in that table in the same change.
- Read app state through `h.app` (the test hook) where it offers it, and through test
  ids otherwise. Never through visible text.
- Trigger through real input (`h.nativeKeys`, `h.nativeType`, `h.nativeClick`) or a
  click on a test id (`h.click`). `h.insertText()` is for characters no US key press
  can produce.
- Every scenario starts a fresh app with an empty `HOME`, so runs never see each
  other's settings, and a file a scenario writes lives in its run folder (`h.cfg.run`).

The options of `scenario(name, options, fn)`:

| Option | What it does |
|---|---|
| `timeout` | seconds before the run is killed (default 90) |
| `env` | `'finder'` starts the app with the minimal environment of a Finder launch; default `'inherit'` |
| `python` | `GEDIT_PYTHON` for the app; `null` leaves it unset so the backend resolves it |
| `vars` | extra environment variables |
| `files` | files written into the run folder before the app starts |

`vars`, `python` and `files` may use `{run}`, `{home}`, `{python}` and `{repo}`.

## The helper API

| Call | What it does |
|---|---|
| `h.check(name, cond, detail?)` | records a check; a false `cond` fails the scenario |
| `h.waitFor(fn, { timeout, interval })` | first truthy value, or the last one on timeout |
| `h.q(testid, attrs?)`, `h.qa(testid, attrs?)` | element(s) by test id; `{ docId: 'd2' }` matches `data-doc-id="d2"`, `true`/`false` require the attribute to be there or gone |
| `h.click(el)`, `h.select(el, value)` | a DOM click, and picking an option |
| `h.nativeKeys([{ key: 's', mods: ['cmd'] }])`, `h.nativeType(text)`, `h.nativeClick(el)` | real NSEvents |
| `h.focusEditor()`, `h.insertText(text)` | focus the editor; insert text as an input method would |
| `h.title()` | the native window title |
| `h.dialogs.queue('open' \| 'save' \| 'folder', result)` | the answer of the next file dialog (a path, a list, or `null` for Cancel); the stub grants it like the plugin |
| `h.dialogs.calls()` | every dialog the app asked for, with its arguments |
| `h.alert.visible()`, `h.alert.wait()`, `h.alert.click(label)` | the real NSAlert (`'OK\|Ok'` accepts either label) |
| `h.disk.read/hex/write/touch/stat/copy` | the file system, from outside the app |
| `h.drop(paths)` | grants like tauri-plugin-fs, then emits `tauri://drag-drop` |
| `h.pgrep(pattern)`, `h.children()` | processes |
| `h.fixture(rel, { from })` | a fresh copy of `tests/fixtures/<rel>` in the run folder (`from: 'runtime'` for `tests/runtime/fixtures/<rel>`) |
| `h.app` | `window.__gedit`: `ready`, `version`, `text()`, `cursor()`, `activeProfile()`, `setProfile()` |
| `h.window.close/performClose/quitKey/terminate/state` | the ways an app ends, and what AppKit sees |
| `h.expectExit({ code, files, events })` | say the app is about to exit; the runner then judges the exit and checks the files afterwards |
| `h.allowErrors(re)`, `h.expectViolations(fn)` | expected console errors and CSP violations |
| `h.invoke(cmd, args)`, `h.attempt(cmd, args)` | a backend command, raw or without throwing |
| `h.cfg` | `scenario`, `run`, `home`, `python`, `appVersion` |
| `h.rec` | what the recorder saw: `violations`, `errors`, `warnings`, `ipc`, `workers`, `dialogCalls` |

## How it is put together

- `harness/harness.rs` is a Tauri plugin with the `h_*` commands. `sync.sh` copies it
  into the app copy and adds two lines to `lib.rs`: `.plugin(harness::plugin())` after
  the single `tauri::Builder::default()`, and the command list after the single
  `generate_handler![`. Those two anchors are the only places the app is touched, so a
  change to either of them in `lib.rs` breaks the sync loudly (plan AD-15).
- `lib/` is the page side: the recorder installs at document start, `api.js` builds
  `h`, and `runner.js` runs the scenario and reports.
- `run.sh` bundles `lib/` and the scenario's file into one script, and the plugin
  injects it into the page before the app loads (`HARNESS_BUNDLE`).
- Results come back as `RH <json>` lines on stdout, which the runner turns into
  `out/<scenario>.json`.
- The build is a normal debug build with `VITE_GEDIT_TEST=1`, so it has the test hook,
  the production CSP and the embedded `tauri://` assets. A release build never
  contains `__gedit`; CI checks that.

Two things a run cannot isolate: WebKit's own storage lives in the real
`~/Library/WebKit/gedit` (only `HOME`, and with it the app's config folder, is
redirected), and a scenario that leaves a process behind is cleaned up by matching the
run folder in its command line.
