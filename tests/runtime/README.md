# Runtime harness

The harness builds a test variant of gEdit and drives it like a user: real key presses
and mouse clicks, the real unsaved-changes alert, real quit handling, and stubbed file
dialogs that grant paths exactly as the dialog plugin does. A scenario reads the app
through `data-testid` attributes and the `window.__gedit` test hook (phase 1 plan §7.9),
never through visible text.

It is the only test layer that runs the whole app, so it is what proves the behaviour
of the window, the file operations and the backend. It is **not** part of CI: it needs
a real macOS desktop.

## Prerequisites

- macOS, with a screen you are not using while a run is in progress: the window is
  visible, takes over the keyboard focus and receives native events. An **unlocked**
  screen — a locked one gives the keyboard to `loginwindow`, and every scenario that
  posts input is reported BLOCKED.

  Check it before starting a cumulative suite; half an hour of BLOCKED answers nothing:

  ```sh
  ioreg -n Root -d1 -r -k IOConsoleUsers | grep -qE 'CGSSessionScreenIsLocked"[[:space:]]*=[[:space:]]*Yes' && echo locked || echo unlocked
  ```

  This is the query and the pattern the harness itself uses (`screenLocked()` in
  `harness/core.mjs`). The key is absent while the screen is unlocked, so "no match" is the
  good answer. The spaces around `=` are not always there, which is why the pattern allows
  any number of them: one that requires them reports an unlocked screen while it is locked.
- Node and Rust as for a normal build (`npm install` once; `cargo` on PATH).
- Python 3 for the script scenarios. Every run passes an explicit `GEDIT_PYTHON`
  unless the scenario tests the lookup itself, so your shell setup does not change
  the result.

## Usage

```sh
tests/runtime/sync.sh                                # copy the repo, patch the harness in, build
tests/runtime/run.sh m0-main                         # run one scenario; exits 0 when it passes
tests/runtime/suite.sh tests/runtime/suites/m0.txt   # run a suite and print the result table
```

- `sync.sh [--repo DIR]` copies the working tree (including uncommitted changes) to
  `$GEDIT_RH_DIR/app`, symlinks `node_modules` back to the repo, patches `lib.rs`,
  `Cargo.toml` and `tauri.conf.json`, and builds. Run it again after every change to
  the app or to `harness/harness.rs`; scenarios and `lib/` are read fresh on each run.
- `run.sh <scenario> [--home DIR] [--keep-home] [--env K=V]… [--timeout S]` runs one
  scenario exactly once, so a failure here is a failure.
  - `--home DIR` runs the app with that HOME and never deletes it. Without it the run gets
    `runs/<scenario>/home`, which is deleted afterwards unless `--keep-home` is given.
  - `--env K=V` sets an environment variable of the app. It is applied after the
    scenario's `vars` and takes no placeholders.
  - `--timeout S` replaces the scenario's timeout: the app's own watchdog ends the run
    after S+5 seconds, and the runner kills it after S+10.
- `suite.sh <suite.txt | scenario>… [--no-retry] [--retry] [--repeat N]` runs them one
  after another; see **PASS, FLAKY, FAIL, BLOCKED** below.
- A usage error — an unknown flag or an unknown scenario — exits with code 2.
- Everything lives under `$GEDIT_RH_DIR` (default `$TMPDIR/gedit-rh`):
  - the build in `app/` and `target/`, with `sync.json` (which checkout was synced, and
    when) and one log per build step in `logs/sync-<step>.log`;
  - one folder per run under `runs/<scenario>/`, wiped at the start of every run of that
    scenario, with `app.log` and the page script `bundle.js`;
  - the results: `out/<scenario>.json` per run, and `out/suite.json` for a suite.
- Runs and syncs take a lock (`$GEDIT_RH_DIR/lock`), so two of them never fight over
  the screen. A lock whose owner died is taken over, and a run waits for a held lock for
  `GEDIT_RH_LOCK_WAIT` seconds (default 1800) before it gives up. The lock guards the
  *screen*, not the build, so two harness folders on one Mac must share one:
  `GEDIT_RH_LOCK=<dir>` points them both at the same lock.
- While a run or suite holds the lock, `caffeinate` keeps the display awake, because a
  cumulative suite outlasts a short idle timer and a screen that locks halfway through
  blocks every scenario left. It is a child process that exits with the run and changes
  no setting; `GEDIT_RH_NO_CAFFEINATE=1` leaves the idle timer alone.
- `GEDIT_RH_PYTHON=<path>` is the interpreter behind `{python}` (see the options below);
  without it the harness takes the first `python3` on `PATH`, else `/usr/bin/python3`.
- `HARNESS_VISIBLE=0` skips the window preparation described under
  [How it is put together](#how-it-is-put-together): the window is never sized, centred or
  shown, and stays hidden.
- The repository is never modified. The patched copy is.

## Suites

One file per milestone, `suites/m0.txt` … `suites/m8.txt`: one scenario name per line, `#`
starts a comment. A cumulative run is all of them in order:

```sh
tests/runtime/suite.sh tests/runtime/suites/m{0,1,2,3,4,5,6,7,8}.txt
```

## PASS, FLAKY, FAIL, BLOCKED

The harness drives a real desktop, so one run is not proof. `suite.sh` runs a scenario
again when it failed and reports:

| Result | What it means | Exit code |
|---|---|---|
| `PASS` | passed the first time | 0 |
| `FLAKY` | failed, passed on the retry — the harness's problem, not the app's; the first failure is kept in `out/<scenario>.attempt1.json` | 0 |
| `FAIL` | failed twice | 1 |
| `BLOCKED` | could not be carried out: an input the scenario needed could not be delivered, because another app held the keyboard (a locked screen is one of those). Not retried — a second run would say the same — and never silently green | 1 |

`--no-retry` runs each scenario once, and `--retry` turns the retry back on where
`GEDIT_RH_ROBUST=0` switched it off. `--repeat N` runs the whole list N times and prints how
many runs were flaky, which is how a flake rate is measured. The table's `Focus` column
counts how often the app had to take the keyboard back during a run; `out/suite.json`
holds the same numbers per scenario, with `firstAttempt` for the flakes.

A numbered scenario (`…-2`) reads the HOME its predecessors wrote, so retrying it alone
would test a home that has already been through a run: the whole `…-1 … -n` group is
re-run in order instead — as long as every member of the group is in the same list;
otherwise only the failed scenario is re-run.

## What makes a run fail

`out/<scenario>.json` holds `{ status, pass, checks, violations, errors, blocked, focus, … }`,
and `status` is `pass`, `fail` or `blocked`; FLAKY exists only in the suite table.
A run fails when

- a `h.check(...)` failed, or the scenario threw,
- the page reported a CSP violation that the scenario did not ask for,
- a console error turned up that is neither expected (`h.allowErrors(...)`) nor known
  noise (see below),
- the app asked for a file dialog nobody queued, or left a queued answer unused,
- a native alert was still open when the scenario ended,
- the page never sent its `start` record — the bundle was not injected, or never ran,
- the run hit its timeout,
- the app exited when it should not have, or did not exit when it should.

It is **blocked** instead of failed when `blocked` is not empty: something outside the
app stopped it. The harness says so when a click or a Cmd key cannot be delivered; a
scenario can say so itself with `h.blocked(reason)`; and `suite.sh` says so for a `…-2`
whose `…-1` was blocked and so never wrote the HOME it reads.

A locked screen is a *reason*, not a verdict: it is added to a blocked run's reasons, and
it never turns a failure into a block on its own — a scenario that needs no keyboard can
still find a real bug while the screen is locked, and that bug must not be filed as an
environment problem.

Known console noise, allowed in every run:

- `NotAllowedError` from Monaco's clipboard workaround under synthetic events.
- `Canceled` rejections: how Monaco ends work it no longer needs.
- `ResizeObserver loop completed with undelivered notifications` and `ResizeObserver loop
  limit exceeded`, from Monaco's `automaticLayout` while a panel toggle resizes the
  editor. It is a spec notification that the loop deferred callbacks to the next frame,
  not an exception; startup itself is clean.

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
- Helpers several scenarios need live in `scenarios/m<N>-common.js`, which register no
  scenario of their own: `m3-common.js` opens files through the dialog (`openPath`,
  `openFixture`), `m6-common.js` drives the machine picker and the Machines page,
  `m7-common.js` changes file modes and flags (`osOp`), ages a heartbeat (`makeStale`),
  finds backups (`backupsRoot`, `historyOf`) and quits cleanly (`quitCleanly`), and
  `m8-common.js` walks the fixture goldens (`detectGolden`, `outlineGolden`, `scriptCase`).
- Find elements with `h.q('<test id>', { attr: 'value' })`. The test ids are a contract:
  §7.9 of `docs/planning/phase-1-implementation.md` (Phase 1) and §7.12 of
  `docs/planning/phase-2-implementation.md` (from M6 on). A new one goes into the Phase 2
  table in the same change.
- Read app state through `h.app` (the test hook) where it offers it, and through test
  ids otherwise. Never through visible text.
- Trigger through real input (`h.nativeKeys`, `h.nativeType`, `h.nativeClick`) or a
  click on a test id (`h.click`). `h.insertText()` is for characters no US key press
  can produce.
- Every scenario starts a fresh app with an empty `HOME`, so runs never see each
  other's settings, and a file a scenario writes lives in its run folder (`h.cfg.run`).
- **State across a restart is a numbered pair.** `…-1` sets
  `vars: { HOME: '{run}/state-home' }`, a folder in its own run folder, which is wiped
  before every run of `…-1`; `…-2` sets `vars: { HOME: '{run}/../<name>-1/state-home' }`,
  the folder `…-1` left behind (`m7-common.js` `otherRun()` builds such a path). `h.cfg.home`
  does not follow a `vars.HOME` override, so read the app's real folders through
  `h.config.read()`, `h.recoveryDir()` or `ctx.settings.paths`, never through `h.cfg.home`.
- **Open through the dialog even when the scenario drives `ctx.files` directly.** The file
  system scope holds only what a dialog picked or a drop granted. Queue the answer and call
  `open()` without a path — `await h.dialogs.queue('open', path); await h.app.ctx.files.open()`
  — so the stub answers the dialog and grants the path, as `scenarios/m3-common.js`
  `openPath()` does. `ctx.files.open([path])` skips the dialog: the path is never granted,
  the backend refuses the read, `fileOps` shows a native error dialog nobody is there to
  click, and the scenario hangs until its timeout.
- Wait for the thing, not for a number of milliseconds: `h.waitFor(...)` for a state you
  can name, `h.idle()` for an effect with no single element to watch. `h.sleep(n)` is a
  guess, and a guess is what turns into a flake on a loaded machine.

`scenario(name, options, fn)` takes these options; `scenario(name, fn)` runs with the
defaults:

| Option | What it does |
|---|---|
| `timeout` | seconds before the run is killed (default 90) |
| `env` | `'finder'` starts the app with the minimal environment of a Finder launch; default `'inherit'` |
| `python` | `GEDIT_PYTHON` for the app (default `'{python}'`); `null` leaves it unset so the backend resolves it |
| `vars` | extra environment variables |
| `files` | files written into the run folder before the app starts: a path and its text, or `{ text, mode }` to set the file mode as well |

`vars`, `python` and `files` may use `{run}`, `{home}`, `{python}` and `{repo}`.

## The helper API

| Call | What it does |
|---|---|
| `h.check(name, cond, detail?)` | records a check; a false `cond` fails the scenario |
| `h.checks()` | the checks recorded so far |
| `h.blocked(reason, detail?)` | this run could not be carried out; the runner reports BLOCKED |
| `h.log(...args)` | a line in the run's `app.log` |
| `h.waitFor(fn, { timeout, interval })` | first truthy value, or the last one on timeout; every sample after the first is taken **after a rendered frame** |
| `h.frame()` | resolves once the browser has rendered a frame |
| `h.idle({ quiet, timeout })` | resolves once the DOM has stopped changing and no backend call is in flight; use it instead of a fixed sleep |
| `h.sleep(ms)` | a fixed wait; the last resort |
| `h.q(testid, attrs?)`, `h.qa(testid, attrs?)` | element(s) by test id; `{ docId: 'd2' }` matches `data-doc-id="d2"`, `true`/`false` require the attribute to be there or gone |
| `h.click(el)`, `h.select(el, value)` | a DOM click, and picking an option |
| `h.nativeKeys([{ key: 's', mods: ['cmd'] }])`, `h.nativeType(text)`, `h.nativeClick(el, { dx, dy, clickCount })` | real NSEvents; `dx`/`dy` move the click away from the element's centre |
| `h.focusEditor()`, `h.insertText(text)` | focus the editor; insert text as an input method would |
| `h.title()` | the native window title |
| `h.dialogs.queue('open' \| 'save' \| 'folder', result)` | the answer of the next file dialog (a path, a list, or `null` for Cancel); the stub grants it like the plugin |
| `h.dialogs.calls()`, `h.dialogs.clear()` | every dialog the app asked for, with its arguments; drop the queued answers, resolving to the ones nobody used |
| `h.alert.visible()`, `h.alert.wait()`, `h.alert.click(label)` | the real NSAlert (`'OK\|Ok'` accepts either label) |
| `h.disk.read/hex/write/touch/stat/copy` | the file system, from outside the app |
| `h.config.read('settings.json' \| 'machines.json' \| 'state.json')` | one of the app's own files, parsed, from the folder the app really uses; `null` while it does not exist |
| `h.recoveryDir()` | `<data>/recovery`, where the crash-recovery snapshots live |
| `h.drop(paths, { x, y })` | grants like tauri-plugin-fs, then emits `tauri://drag-drop` at that position |
| `h.pgrep(pattern)`, `h.children()` | processes |
| `h.fixture(rel, { from })` | a fresh copy of `tests/fixtures/<rel>` in the run folder (`from: 'runtime'` for `tests/runtime/fixtures/<rel>`) |
| `h.app` | `window.__gedit`: `ready`, `version`, `text()`, `cursor()`, `activeProfile()`, `setProfile()`, and `ctx`, the service aggregate (`src/lib/app/context.ts`: commands, docs, editor, files, dialogs, settings, machines, fileMemory, session, recovery, …) |
| `h.window.close/performClose/quitKey/terminate/state` | the ways an app ends, and what AppKit sees |
| `h.window.focus()`, `h.window.ensureFront()` | who owns the keyboard; take it back and wait for the confirmation |
| `h.expectExit({ code, signal, within, files, events })` | say the app is about to exit; the runner then judges the exit — the code (default 0) or the `signal`, within `within` ms (default 10000) — and checks the `files` afterwards, each `{ path, includes, excludes, hex, missing }` |
| `h.exitExpectation()` | the exit expectation declared so far, or `null` |
| `h.crash({ files })` | kills the app with SIGKILL, the way a power cut does; it declares the exit itself and never resolves, so snapshot first (`h.app.ctx.recovery.flushNow()`) |
| `h.allowErrors(re)`, `h.expectViolations(fn)` | expected console errors and CSP violations |
| `h.invoke(cmd, args, options)`, `h.attempt(cmd, args, options)` | a backend command, raw or without throwing |
| `h.setenv(name, value)` | sets an environment variable of the running app; `null` removes it |
| `h.menu()` | the native menu as text |
| `h.cfg` | `scenario`, `run`, `home`, `python`, `appVersion`, `robust` |
| `h.rec` | what the recorder saw: `violations`, `errors`, `warnings`, `ipc`, `otherFetches`, `workers`, `dialogCalls` |

## How it is put together

- `harness/harness.rs` is a Tauri plugin with the `h_*` commands. `sync.sh` copies it into
  the app copy as `src-tauri/src/harness.rs` and patches `lib.rs` in three places: `mod
  harness;` at the top, `.plugin(harness::plugin())` after the single
  `tauri::Builder::default()`, and one `harness::h_…,` line per command after the single
  `generate_handler![`. The last two are the only anchors in the app's code, so a change to
  either of them in `lib.rs` breaks the sync loudly (phase 1 plan AD-15). It also adds
  `objc2` to `Cargo.toml` and starts the window hidden in `tauri.conf.json`; on every run
  the plugin sizes the window to 1100×700, centres it, turns WebKit's occlusion detection
  off (an occluded page stops drawing) and shows it.
- `harness.rs` is compiled only inside the patched copy, so `cargo fmt` and `clippy` in
  `src-tauri/` never see it. Run `rustfmt --edition 2021 tests/runtime/harness/harness.rs`
  after editing it; CI checks the formatting.
- The Node side is in `harness/`: `core.mjs` (paths, the run lock, finding scenarios,
  bundling the page script, running one scenario and judging it), `run.mjs`, `suite.mjs`
  and `sync.mjs`. The three `.sh` files only start them.
- `lib/` is the page side: `index.js` is what a scenario file imports (`scenario()`), the
  recorder installs at document start, `api.js` builds `h`, `keys.js` turns key specs into
  native events, and `runner.js` runs the scenario and reports.
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

## Native input and the keyboard

Not every posted event needs the app to be in front, and the difference was measured
rather than assumed — a whole cumulative suite run against a locked screen, where the
app is running and drawing but owns no keyboard. The evidence below was measured at M3,
when the activation gate was written:

| Event | Behind another app | Evidence |
|---|---|---|
| plain key | **arrives** — it carries our window number and `NSApp.sendEvent` takes it to that window's first responder | `m1-tabs` typed and moved the cursor through 53 key events with `isActive == false` and no key window, and passed all 36 checks |
| Cmd key | **not reliable** — it is a main-menu key equivalent, and the menu is only offered the event while the app is active | `m0-fix3` lost exactly its two Cmd+S checks |
| click | **not reliable** — a click on a window that is not key is spent on activating it | `m0-trusted` lost the cursor position its click was to set |

So `h_native_input` brings the app to the front and waits for the confirmation — 2.5 s
(`FOCUS_TIMEOUT_MS` in `harness.rs`; override it with `GEDIT_RH_FOCUS_TIMEOUT_MS=<ms>`) —
before a click or a Cmd key, and posts every event in the same main-thread hop that
re-reads the focus, so nothing slips in between the check and the post. A plain key is
never held up: it asks for the keyboard for the events that follow and goes out
immediately. Each rescue is a `focus` record in `out/<scenario>.json`.

What it cannot do is take the keyboard from an app that is genuinely using it: since
macOS 14 an app in the background is not allowed to activate itself over the one in
front, and no API the harness may use changes that. Then the run is **BLOCKED**, naming
the event and the app that holds the keyboard (`key cmd+"o" cannot be delivered:
loginwindow (pid 411) is frontmost`) — which is the honest answer, and the reason the run
lock exists.

Events are handed to our own `NSApplication` and our own `NSWindow`, never to the window
server, so nothing the harness posts can reach another app's window: a run that loses the
keyboard loses its own input, it does not type into whatever you are doing.

`GEDIT_RH_ROBUST=0` turns the activation gate, the frame-synced waits and the retry off
together. It is not for normal use: it exists so a run can be measured against the harness
without its robustness layer; `suite.sh --repeat N` prints the flake rate.
