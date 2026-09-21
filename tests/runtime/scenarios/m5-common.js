// Helpers the M5 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Four things are worth knowing before reading a check that uses these:
//
//   1. **A script is driven through `ScriptService`, never through the backend.** M4's
//      `m4-scripts-backend` already calls `script_run` at the IPC level; what M5 adds is
//      the eight steps in front of it (`app/scripts.ts`): the profile filter, the
//      parameter form, the input scope, the context, the version guard, `decideApply` and
//      the apply. So every run here goes through `ctx.scripts.run(id)` or through a
//      command, and a check that reads `script_run` directly would be testing M4 again.
//   2. **`scripts.run` must not be awaited while its form is up.** Like a transform, it
//      only settles after the modal is answered, and the scenario is the one who answers
//      it — `runScript` holds the promise, fills the form, clicks OK and awaits after.
//   3. **A script the scenario writes goes into the user folder and is found by id.** The
//      webview never sends a path (§3, AD-13), so a throw-away script has to be somewhere
//      discovery looks. `writeUserScript` writes it and waits for `scripts.rescan()` to
//      see it, because discovery is a backend round trip and not a file system event.
//   4. **Everything here is a DOM click or an IPC call.** No `h.nativeClick` and no Cmd
//      key, both of which need the app to own the keyboard; the plain keys the scenarios
//      do press (F9, F7, Ctrl+G) are posted whether or not it does. That is what lets the
//      M5 scenarios run on a machine whose screen has locked halfway through a suite.

import { setInput } from './m2-common.js'
import { context, ready, ribbonTab, setField } from './m4-common.js'

export { context, ready, ribbonTab, setField, setInput }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The three scripts `src-tauri/resources/scripts` ships, sorted. */
export const BUNDLED = ['bundled:scale_feed.py', 'bundled:scale_speed.py', 'bundled:tool_list.py']

/** Every `script.*` command `contrib/scripts.ts` registers, in its own order. */
export const SCRIPT_COMMANDS = [
  'script.runPicker',
  'script.runLast',
  'script.cancel',
  'script.new',
  'script.copyToUser',
  'script.openSource',
  'script.rescan',
  'script.addFolder',
]

/** The two commands the removed v1 UI carried (plan D14); neither may exist any more. */
export const V1_COMMANDS = ['scripts.pickFolder', 'scripts.run']

/** The two v1 backend commands (plan D14); neither may answer any more. */
export const V1_IPC = ['run_python_script', 'list_python_scripts']

/** `ScriptService` on the live app context. @param {Harness} h */
export const scriptService = (h) => /** @type {any} */ (context(h)).scripts

/**
 * Reads a Svelte store once, synchronously.
 * @template T
 * @param {{ subscribe: (run: (value: T) => void) => () => void }} store
 * @returns {T}
 */
export function read(store) {
  /** @type {any} */
  let value
  const stop = store.subscribe((/** @type {any} */ v) => {
    value = v
  })
  stop()
  return value
}

/** The status bar's message line, trimmed. @param {Harness} h */
export const message = (h) => h.q('status-message')?.textContent?.trim() ?? ''

/** Whether the status bar is showing that message as an error. @param {Harness} h */
export const messageIsError = (h) => h.q('status-message')?.getAttribute('data-error') === '1'

/** The `status-item[data-item="script"]` element (always in the DOM). @param {Harness} h */
export const scriptStatus = (h) => h.q('status-item', { item: 'script' })

/** The script ids the Tools group is offering right now. @param {Harness} h */
export const menuScriptIds = (h) => h.qa('script-item').map((e) => e.getAttribute('data-script-id'))

/**
 * Waits until the startup Python probe has answered, and returns it.
 * `bootstrap.ts` fires it detached after the first render, so it is null for a moment.
 * @param {Harness} h
 * @returns {Promise<{ ok: boolean, interpreter: string | null, version: string | null, message: string | null } | null>}
 */
export async function pythonProbe(h) {
  // `waitFor` answers `undefined` when it gives up; the probe's own "no interpreter" answer
  // is an object with `ok: false`, and `null` is "has not answered yet", so a timeout is
  // folded into `null` rather than adding a third empty value for every caller to handle.
  return (await h.waitFor(() => read(scriptService(h).python), { timeout: 30000 })) ?? null
}

/**
 * Waits until `scripts.list` holds `scriptId`.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {number} [timeout]
 * @returns {Promise<boolean>}
 */
export async function waitForScript(h, scriptId, timeout = 15000) {
  const found = await h.waitFor(
    () => (read(scriptService(h).list).some((/** @type {any} */ e) => e.id === scriptId) ? true : null),
    { timeout, interval: 100 },
  )
  return found === true
}

/**
 * Writes a script into the user scripts folder and waits until discovery sees it.
 *
 * The user folder is a script **root**, which is the only reason an id exists for it; a
 * file in the run folder cannot be run at all (AD-13). It is left behind on purpose —
 * every scenario gets a fresh HOME, so nothing outlives the run — which is the difference
 * from `m2-common.python()`, whose scripts delete themselves because its callers run
 * several of them in one app.
 * @param {Harness} h
 * @param {string} name bare `*.py` file name
 * @param {string} source
 * @returns {Promise<string>} the script id
 */
export async function writeUserScript(h, name, source) {
  const paths = read(context(h).settings.paths)
  if (!paths) throw new Error('settings.paths is null: config_load did not answer')
  await h.disk.write(`${paths.userScriptsDir}/${name}`, source)
  await scriptService(h).rescan()
  const id = `user:${name}`
  if (!(await waitForScript(h, id))) throw new Error(`${name}: never appeared in the script list`)
  return id
}

/**
 * Runs a script through `ScriptService` and waits until it has finished.
 *
 * `form` says whether this script declares parameters: one that declares none runs
 * immediately and waiting for a modal would cost a timeout. `fields` are filled by their
 * `data-field`, exactly as `m4-common.runTransform` fills a transform's options.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {{ form?: boolean, fields?: Record<string, string | number | boolean>, cancelForm?: boolean }} [o]
 */
export async function runScript(h, scriptId, o = {}) {
  const running = scriptService(h).run(scriptId)
  if (o.form === true) {
    await h.waitFor(() => h.q('modal'), { timeout: 20000 })
    for (const [field, value] of Object.entries(o.fields ?? {})) setField(h, field, value)
    await h.frame()
    h.click(h.q(o.cancelForm === true ? 'modal-cancel' : 'modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  }
  await running
  await h.idle()
}

/**
 * Starts a run without waiting for it, answering its form if it has one.
 *
 * Used by the scenarios that have to look at the app *while* a script is running: the
 * status item, the panel's Cancel, a timeout, an edit made under a run.
 *
 * **The run's own promise comes back inside an object, and that is not a style choice.**
 * An `async` function that `return`s a promise *adopts* it, so `await startScript(...)`
 * would wait for the whole script — which is the opposite of what this helper is for, and
 * it fails quietly: the scenario carries on once the run is already over, and every check
 * about the running state then reads an idle app. Wrapping it keeps `await` on the helper
 * and leaves `done` to be awaited when the scenario is ready for it.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {{ form?: boolean, fields?: Record<string, string | number | boolean> }} [o]
 * @returns {Promise<{ done: Promise<void> }>}
 */
export async function startScript(h, scriptId, o = {}) {
  // The service is read once, and the run is given a rendered frame before the flag is
  // looked for: `ScriptService.run` awaits the Python status before it sets `running`, so
  // the flag is never up in the same tick as the call.
  const service = scriptService(h)
  const running = service.run(scriptId)
  if (o.form === true) {
    await h.waitFor(() => h.q('modal'), { timeout: 20000 })
    for (const [field, value] of Object.entries(o.fields ?? {})) setField(h, field, value)
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  }
  await h.frame()
  const started = await h.waitFor(() => read(service.running) !== null, { timeout: 20000, interval: 20 })
  if (started !== true) {
    h.log(`startScript: ${scriptId} never reported a run in flight (status: ${message(h)})`)
  }
  return { done: running }
}

/**
 * Shows a bottom panel and waits for it. Both M5 panels name their root `<id>-panel`
 * (§7.9: `output-panel`, `results-panel`).
 * @param {Harness} h
 * @param {'output' | 'results'} id
 */
export async function showPanel(h, id) {
  context(h).layout.show(id)
  await h.waitFor(() => h.q(`${id}-panel`), { timeout: 5000 })
}

/** The whole text of a document, LF. @param {Harness} h @param {string} docId */
export const textOf = (h, docId) =>
  context(h).editor.getLines(docId, 1, context(h).editor.getLineCount(docId)).join('\n')

/** One undo through Monaco's own action, so no native key is needed. @param {Harness} h */
export async function undo(h) {
  /** @type {any} */ (context(h).editor.editorInstance())?.trigger('m5', 'undo', null)
  await h.idle()
}

/** One redo, the same way. @param {Harness} h */
export async function redo(h) {
  /** @type {any} */ (context(h).editor.editorInstance())?.trigger('m5', 'redo', null)
  await h.idle()
}

// ---------------------------------------------------------------------------------
// Throw-away scripts
// ---------------------------------------------------------------------------------

/** In a grandchild's command line, so `pgrep -f` can find it. No regex characters. */
export const GRANDCHILD = 'GEDITRHM5GRANDCHILD'

/**
 * A script that sleeps, with a header the scenario chooses.
 *
 * It leaves a grandchild behind, because the interesting half of AD-13 is `killpg`: a
 * script that spawned something of its own must not survive a timeout, a cancel or a
 * window that closed under it either.
 * @param {{ seconds?: number, header?: string }} [o]
 */
export function sleeper({ seconds = 300, header = '# output = "panel"' } = {}) {
  return `# /// gedit
# name = "Harness sleeper"
# description = "Sleeps, so a timeout, a cancel and a quit have something to kill."
${header}
# ///
"""Written for gEdit's runtime harness (H5). Not a bundled script."""

import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CHILD = "import time  # ${GRANDCHILD}\\ntime.sleep(${seconds})\\n"

child = subprocess.Popen([sys.executable, "-c", CHILD])
with open(os.path.join(HERE, "started.txt"), "w", encoding="utf-8") as handle:
    handle.write("{} {}\\n".format(os.getpid(), child.pid))
sys.stderr.write("sleeping\\n")
sys.stderr.flush()
time.sleep(${seconds})
print("the harness sleeper was not stopped")
`
}

/**
 * A `replace`-mode script that sleeps first and then prints the input back, upper-cased.
 * Long enough for the scenario to type into the document while it runs, which is what
 * `decideApply`'s stale check is for.
 * @param {number} seconds
 */
export function slowReplacer(seconds) {
  return `# /// gedit
# name = "Harness slow replace"
# description = "Waits, then hands the program back in upper case."
# input = "selection-or-document"
# output = "replace"
# ///
"""Written for gEdit's runtime harness (H5). Not a bundled script."""

import sys
import time

data = sys.stdin.read()
time.sleep(${seconds})
sys.stdout.write(data.upper())
`
}
