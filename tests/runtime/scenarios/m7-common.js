// Helpers the M7 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// M7 is the milestone whose promise is "an edit is never lost and a file is never left
// damaged", so nearly everything here reads the *file system* rather than the app: a
// backup that only exists in a store is not a backup. Five things are worth knowing
// before reading a check that uses these:
//
//   1. **The three folders are resolved the way the app resolves them.** `<data>/backups`
//      comes from `settings.paths.dataDir` (`config_load` answered with it) and the
//      recovery root from `h.recoveryDir()`, which asks the backend. Neither is built
//      out of `HOME` in the scenario, so a change to `paths.rs` fails a check instead of
//      quietly testing a folder nobody writes to.
//   2. **Listing a folder and changing a file's mode need a Python script.** `h.disk`
//      can stat, read, write, copy and touch one path; it cannot list a folder, chmod,
//      set a file flag or make a directory, and §7.9 gives the harness no command for
//      any of them. `m2-common.js` already fills the listing gap with a throw-away
//      script through the script backend, and [`osOp`] fills the rest the same way.
//   3. **`lock`/`unlock` are `chflags(2)`, not `chmod`.** A save over a `chmod 444` file
//      never reaches the write at all: `fileOps.saveOutcome` reads `stat.readonly` first
//      and sends it to Save As (AD-23), which is the *right* behaviour and the opposite
//      of the case `m7-save-fail` has to produce. `UF_IMMUTABLE` leaves the permission
//      bits alone, so the copy is made, the write is attempted, and `open(2)` refuses it
//      — a write that fails after the backup exists, which is the branch the milestone's
//      repair instruction lives in. **Anything that locks a file must unlock it again**
//      in a `finally`: `run.sh` wipes the run folder before the next run of the same
//      scenario, and an immutable file left behind would break that wipe rather than
//      that run.
//   4. **A backup entry is compared as bytes.** `h.disk.hex` on the file *before* the
//      save and on the copy afterwards is the whole claim of AD-21 — "the previous
//      version, byte for byte" — and it catches a re-encoded or re-terminated copy that
//      a text comparison would call equal.
//   5. **A recovery session folder is `s-<millis>-<pid>`** (`src-tauri/src/recovery.rs`
//      `new_session_id`), so the `s-` prefix is how a session folder is told apart from
//      anything else that might be under `<data>/recovery`.

import { configPaths, listDir, python, read } from './m2-common.js'
import { context, openFixture, openPath, revealLine } from './m3-common.js'
import { message, ready } from './m4-common.js'

export { configPaths, context, listDir, message, openFixture, openPath, read, ready, revealLine }

/** @typedef {import('../lib/api.js').Harness} Harness */
/** @typedef {import('$lib/app/types').AppContext} AppContext */

/** The three shipped dialects, by id (as `m6-common.js` spells them). */
export const MILL = 'fanuc-gcode'
export const LATHE = 'fanuc-lathe'

// ---------------------------------------------------------------- the documents

/**
 * The id of the document open on `path`, or a loud failure.
 *
 * Every M7 scenario works in paths — a session is a list of them, a snapshot names one,
 * a backup is a copy of one — and a `byPath` that answered `undefined` halfway through a
 * chain of checks would show up as a confusing type error rather than as "that file is
 * not open".
 * @param {AppContext} ctx
 * @param {string} path
 * @returns {string}
 */
export function docIdFor(ctx, path) {
  const doc = ctx.docs.byPath(path)
  if (doc === undefined) throw new Error(`no document is open on ${path}`)
  return doc.id
}

/**
 * The document that is in front, or `undefined` when the window has none.
 * @param {AppContext} ctx
 */
export function activeDoc(ctx) {
  const id = read(ctx.docs.activeId)
  return id === null ? undefined : ctx.docs.get(id)
}

// ---------------------------------------------------------------- the file system

/**
 * One file-system operation the helper API has no call for, run outside the app.
 *
 * The script is written into the user scripts folder and run by its id, exactly as
 * `m2-common.js` `listDir` does; it deletes itself at the top, so nothing is left in the
 * profile for a later scenario to discover.
 *
 * @param {Harness} h
 * @param {'chmod' | 'lock' | 'unlock' | 'mkdir' | 'rmtree' | 'stat'} op `stat` changes nothing
 * @param {string} path
 * @param {{ mode?: string }} [o] `mode` is octal, e.g. `'444'`
 * @returns {Promise<{ exists: boolean, mode: string | null, flags: number | null, isDir: boolean }>}
 *   the state of `path` afterwards
 */
export async function osOp(h, op, path, o = {}) {
  const request = JSON.stringify({ op, path, mode: o.mode ?? '644' })
  const result = await python(h, 'rh_osop.py', OS_OP, request)
  if (result.data === null) throw new Error(`osOp ${op} ${path}: ${result.stdout || result.stderr}`)
  return result.data
}

const OS_OP = `import json, os, shutil, stat, sys
req = json.loads(sys.stdin.read())
op, path = req["op"], req["path"]
if op == "chmod":
    os.chmod(path, int(req["mode"], 8))
elif op == "lock":
    os.chflags(path, os.stat(path).st_flags | stat.UF_IMMUTABLE)
elif op == "unlock":
    os.chflags(path, os.stat(path).st_flags & ~stat.UF_IMMUTABLE)
elif op == "mkdir":
    os.makedirs(path, exist_ok=True)
elif op == "rmtree":
    shutil.rmtree(path, ignore_errors=True)
elif op == "stat":
    pass
else:
    raise SystemExit("unknown op " + op)
if os.path.lexists(path):
    st = os.lstat(path)
    print(json.dumps({"exists": True, "mode": oct(st.st_mode & 0o777)[2:], "flags": getattr(st, "st_flags", 0), "isDir": os.path.isdir(path)}))
else:
    print(json.dumps({"exists": False, "mode": None, "flags": None, "isDir": False}))
`

/**
 * A byte-for-byte copy of `src` at `dst`, creating the folder on the way.
 *
 * `h.disk.copy` is `std::fs::copy` and fails with ENOENT when the folder is not there,
 * while `h.disk.write` creates it — so an empty file is written first and the copy lands
 * over it. Reading the source into a string and writing it back would be the obvious
 * alternative and is not one: it is a byte → UTF-8 → byte round trip, and the fixtures
 * this is used on are the ones whose exact bytes are the subject of the check.
 * @param {Harness} h
 * @param {string} src
 * @param {string} dst
 * @returns {Promise<string>} `dst`
 */
export async function copyFile(h, src, dst) {
  await h.disk.write(dst, '')
  await h.disk.copy(src, dst)
  return dst
}

/**
 * `chflags uchg`, and `chflags nouchg` however the caller leaves.
 *
 * The unlock is in a `finally` for the reason in rule 3 above: a scenario that throws
 * while the file is immutable would leave a run folder `run.sh` cannot wipe, and the
 * *next* run of that scenario would be the one that failed.
 * @template T
 * @param {Harness} h
 * @param {string} path
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function whileImmutable(h, path, fn) {
  await osOp(h, 'lock', path)
  try {
    return await fn()
  } finally {
    await osOp(h, 'unlock', path)
  }
}

// ---------------------------------------------------------------- the backups folder

/** `<data>/backups`, the root of the `history` mode (§7.11). */
export const backupsRoot = (/** @type {AppContext} */ ctx) => `${configPaths(ctx).dataDir}/backups`

/**
 * Every history entry kept for one file, oldest first, with its bytes.
 *
 * The shape is `<data>/backups/<fnv(folder)>/<file name>/<UTC stamp>-<file name>`
 * (`src-tauri/src/backup.rs`), and the stamp sorts in order by name — which is what the
 * UTC in it is for, so the ordering below is the file's own and not the scenario's idea
 * of one.
 * @param {Harness} h
 * @param {string} path the program's path
 * @returns {Promise<{ name: string, path: string, hex: string }[]>}
 */
export async function historyOf(h, path) {
  const ctx = context(h)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const root = backupsRoot(ctx)
  if ((await h.disk.stat(root)) === null) return []
  /** @type {{ name: string, path: string, hex: string }[]} */
  const out = []
  for (const key of await listDir(h, root)) {
    const folder = `${root}/${key}/${name}`
    if ((await h.disk.stat(folder)) === null) continue
    for (const entry of (await listDir(h, folder)).sort()) {
      out.push({ name: entry, path: `${folder}/${entry}`, hex: await h.disk.hex(`${folder}/${entry}`) })
    }
  }
  return out
}

/**
 * The `<name>.bak` a `sibling` backup writes, or `null` when there is none.
 * @param {Harness} h
 * @param {string} path
 */
export async function siblingOf(h, path) {
  const at = `${path}.bak`
  return (await h.disk.stat(at)) === null ? null : { path: at, hex: await h.disk.hex(at) }
}

// ---------------------------------------------------------------- the recovery folder

/**
 * The session folders under `<data>/recovery`, by name.
 * @param {Harness} h
 * @returns {Promise<string[]>}
 */
export async function sessionFolders(h) {
  const root = await h.recoveryDir()
  if ((await h.disk.stat(root)) === null) return []
  return (await listDir(h, root)).filter((/** @type {string} */ name) => name.startsWith('s-')).sort()
}

/**
 * What is in one session folder: the heartbeat and the `<key>.txt` / `<key>.json` pairs.
 * @param {Harness} h
 * @param {string} session the folder's name
 * @returns {Promise<{ names: string[], alive: boolean, keys: string[] }>}
 */
export async function sessionFiles(h, session) {
  const root = await h.recoveryDir()
  const names = await listDir(h, `${root}/${session}`)
  return {
    names: names.sort(),
    alive: names.includes('alive'),
    keys: names
      .filter((/** @type {string} */ name) => name.endsWith('.txt'))
      .map((/** @type {string} */ name) => name.slice(0, -4))
      .filter((/** @type {string} */ key) => names.includes(`${key}.json`))
      .sort(),
  }
}

/**
 * Backdates every heartbeat past `STALE_AFTER_SECS`, so a session that was killed
 * seconds ago is old enough for AD-21's liveness rule to call it dead.
 *
 * This is the only way a two-run test can reach the state a user reaches by making
 * coffee: a session counts as a leftover only once its `alive` file is 120 s old
 * (`src-tauri/src/recovery.rs`), and the current run's own folder is never listed
 * whatever its file says — so backdating all of them changes nothing but the clock.
 * @param {Harness} h
 * @param {number} [ageSecs]
 */
export async function makeStale(h, ageSecs = 200) {
  const root = await h.recoveryDir()
  for (const session of await sessionFolders(h)) {
    const alive = `${root}/${session}/alive`
    if ((await h.disk.stat(alive)) !== null) await h.disk.touch(alive, Date.now() / 1000 - ageSecs)
  }
}

// ---------------------------------------------------------------- the restore dialog

/** The rows of the restore dialog, in the order it lists them. */
export function recoveryRows(/** @type {Harness} */ h) {
  return h.qa('recovery-item').map((element) => ({
    element,
    session: element.dataset.session ?? '',
    key: element.dataset.key ?? '',
    path: element.dataset.path ?? '',
    outlook: element.dataset.outlook ?? '',
    selected: element.dataset.selected === '1',
    checkbox: /** @type {HTMLInputElement | null} */ (element.querySelector('input[type="checkbox"]')),
  }))
}

/** One of the dialog's three named actions (§7.12). */
export const recoveryAction = (/** @type {Harness} */ h, /** @type {string} */ action) =>
  /** @type {HTMLElement | null} */ (h.q('recovery-dialog')?.querySelector(`[data-action="${action}"]`) ?? null)

/**
 * Opens the restore dialog through `recovery.showPending` and waits for it.
 *
 * `commands.run` settles only when the dialog is answered, so the promise is handed
 * back rather than awaited — the same rule `pickEntry` follows for a quick pick.
 * @param {Harness} h
 * @returns {Promise<{ answered: Promise<unknown> }>}
 */
export async function openRestoreDialog(h) {
  const answered = context(h).commands.run('recovery.showPending')
  if (!(await h.waitFor(() => h.q('modal', { modal: 'recovery' }), { timeout: 15000 }))) {
    throw new Error('recovery.showPending opened no dialog')
  }
  await h.idle()
  return { answered }
}

/**
 * Answers the restore dialog with **Later** if startup put one on screen, and says so.
 *
 * A `-2` run normally starts inside AD-21's blind window — its predecessor was killed
 * seconds ago and the heartbeat still looks fresh — so nothing is offered and the
 * session restore goes ahead. But the window is 120 s of wall clock, and a suite that
 * was interrupted, retried or driven by hand can start run 2 outside it; then the dialog
 * is up before the scenario's first line, `contrib/session.ts` is waiting for it, and
 * every `waitFor` on a tab would sit there until the timeout.
 *
 * Later is the one answer that loses nothing: the snapshots stay exactly where they are,
 * and the scenario drives the dialog itself afterwards through `recovery.showPending`.
 * @param {Harness} h
 * @returns {Promise<boolean>} whether a dialog had to be dismissed
 */
export async function dismissStartupRestore(h) {
  const dialog = await h.waitFor(() => h.q('modal', { modal: 'recovery' }), { timeout: 2000, interval: 100 })
  if (!dialog) return false
  const later = recoveryAction(h, 'later')
  if (!later) throw new Error('the startup restore dialog has no later button')
  h.click(later)
  await h.waitFor(() => !h.q('modal', { modal: 'recovery' }), { timeout: 10000 })
  await h.idle()
  return true
}

/**
 * Waits until `leftovers()` answers with `count` entries.
 * @param {Harness} h
 * @param {number} count
 * @returns {Promise<import('$lib/app/types').RecoveryEntry[]>}
 */
export async function waitForLeftovers(h, count) {
  const list = await h.waitFor(
    async () => {
      const entries = await context(h).recovery.leftovers()
      return entries.length === count ? entries : null
    },
    { timeout: 15000 },
  )
  return list ?? (await context(h).recovery.leftovers())
}

// ---------------------------------------------------------------- two runs, one HOME

/** The run folder of another scenario of the same pair. */
export const otherRun = (/** @type {string} */ run, /** @type {string} */ name) => run.replace(/\/[^/]+$/, `/${name}`)

/**
 * Fails loudly when the `-2` half was started without its `-1`.
 * @param {Harness} h
 * @param {string} first the name of the scenario that writes the shared HOME
 */
export async function requireFirstRun(h, first) {
  const paths = configPaths(context(h))
  if (!(await h.disk.stat(paths.stateFile))) {
    throw new Error(`no state.json in ${paths.stateFile}: run ${first} first (it writes the shared home)`)
  }
  return paths
}

/**
 * Ends a run the way a user ends one, so everything that is written at quit is written.
 *
 * The memos, the session list and the clear of this run's recovery snapshots all hang
 * from `files.onWillQuit`, which only a real quit fires — the runner's own SIGTERM at
 * the end of a scenario does not. A `-1` that wants its state read by a `-2` therefore
 * has to go out through the window close, as `m2-recent-restart-1` does.
 * @param {Harness} h
 */
export async function quitCleanly(h) {
  h.expectExit({ within: 15000 })
  // `h.expectExit` only queues its record; the flush is an IPC round trip of its own and
  // the window can be gone before it lands (see `m2-recent-restart-1`).
  await h.sleep(500)
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
}
