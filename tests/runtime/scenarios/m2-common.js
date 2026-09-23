// Helpers the M2 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Everything here is either a Svelte-store read or a gap in the helper API (§7.9 has no
// "list a folder" and no "delete a file"), which a throw-away Python script fills: it is
// the one way to run arbitrary code outside the webview, and every M2 scenario that needs
// to take a file away from under the editor or look for a leftover temp file goes through
// it.
//
// **I5 ported `python()` from `run_python_script` to `script_run`** when the v1 command
// was removed with the rest of the v1 script surface (plan D14). The helper's signature and
// its answer are unchanged, so every caller is untouched; what changed is underneath:
//
//  - the script is written into the **user scripts folder**, because the v2 backend takes a
//    script **id** and resolves it against its own roots — the webview never sends a path
//    or a folder (§3, AD-13). `h.cfg.run` is not a root, so it cannot be used any more.
//  - discovery is asynchronous, so the helper waits for `scripts_list` to see the file
//    before it runs it.
//  - `RunResult` has no `data`, so the helper parses stdout itself, exactly as v1's runner
//    used to.
//  - it cleans the script up afterwards, since the user folder outlives the run folder.

/**
 * Reads a Svelte store synchronously.
 * @template T
 * @param {{ subscribe: (run: (value: T) => void) => () => void }} store
 * @returns {T}
 */
export function read(store) {
  /** @type {T | undefined} */
  let value
  const stop = store.subscribe((v) => {
    value = v
  })
  stop()
  // A Svelte store always calls its subscriber once, synchronously, so this is set.
  return /** @type {T} */ (value)
}

/**
 * The config paths `config_load` answered with. Every M2 scenario needs them, and a null
 * here means the backend never answered, which is worth failing loudly on.
 * @param {any} ctx `h.app.ctx`
 * @returns {{ configDir: string, dataDir: string, settingsFile: string, stateFile: string, userScriptsDir: string, machinesFile: string }}
 */
export function configPaths(ctx) {
  const paths = read(ctx.settings.paths)
  if (!paths) throw new Error('settings.paths is null: config_load did not answer')
  return paths
}

/**
 * Runs a throw-away Python script through the script backend. It is written into the user
 * scripts folder, run by its `user:` id, and deletes itself at exit.
 * @param {import('../lib/api.js').Harness} h
 * @param {string} name bare `*.py` file name
 * @param {string} source
 * @param {string} [input] stdin
 * @returns {Promise<{ stdout: string, stderr: string, success: boolean, data: any }>}
 */
export async function python(h, name, source, input = '') {
  const dir = configPaths(h.app.ctx).userScriptsDir
  const id = `user:${name}`
  await h.disk.write(`${dir}/${name}`, SELF_DELETE + source)
  const listed = await h.waitFor(async () => {
    const list = await h.attempt('scripts_list')
    return list.ok && list.value.scripts.some((/** @type {any} */ s) => s.id === id) ? true : null
  }, { timeout: 10000, interval: 100 })
  if (!listed) throw new Error(`${name}: never appeared in scripts_list`)
  const r = await h.attempt('script_run', {
    req: { runId: `rh-${name}-${Date.now()}`, scriptId: id, stdin: input, context: {}, timeoutSecs: 60 },
  })
  if (!r.ok) throw new Error(`${name}: ${r.error}`)
  if (!r.value?.success) throw new Error(`${name} failed: ${r.value?.stderr || '(no stderr)'}`)
  // v1's runner parsed stdout for the caller; `RunResult` does not, so the helper does.
  let data = null
  try {
    data = JSON.parse(r.value.stdout)
  } catch {
    data = null
  }
  return { stdout: r.value.stdout, stderr: r.value.stderr, success: true, data }
}

/**
 * Prepended to every throw-away script. The user scripts folder outlives the run folder,
 * `h.disk` has no remove (which is the very gap `removeFile` uses this helper to fill), and
 * a leftover `rh_*.py` would be listed by `scripts_list` for the rest of the profile — in
 * the picker, in the Tools group and in any later scenario's script count.
 *
 * It unlinks **at the top**, not from `atexit`: Python has already read the whole file by
 * the time line 2 runs, so the script still executes normally, and the file is gone even if
 * it then raises. (An `atexit` callback cannot be used for this — by the time it runs,
 * CPython has cleared the module globals and `__file__` raises `NameError`.)
 */
const SELF_DELETE = 'import os as _o\nif _o.path.exists(__file__): _o.unlink(__file__)\n'

const LS = 'import json, os, sys\nprint(json.dumps(sorted(os.listdir(sys.stdin.read().strip()))))\n'
const RM = 'import json, os, sys\np = sys.stdin.read().strip()\nos.remove(p)\nprint(json.dumps(not os.path.exists(p)))\n'

/**
 * The entry names of a folder. `h.disk` can stat one path but cannot list a folder, and
 * "no temp file was left behind" needs the listing.
 * @param {import('../lib/api.js').Harness} h
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function listDir(h, dir) {
  const result = await python(h, 'rh_ls.py', LS, dir)
  return result.data
}

/**
 * Deletes a file from outside the app: `h.disk` writes and copies but never removes, and
 * AD-10's "the file is gone" case needs a real deletion.
 * @param {import('../lib/api.js').Harness} h
 * @param {string} path
 */
export async function removeFile(h, path) {
  const result = await python(h, 'rh_rm.py', RM, path)
  if (result.data !== true) throw new Error(`could not remove ${path}`)
}

/**
 * The leftovers an interrupted atomic write would leave: `atomic.rs` writes
 * `.<name>.tmp-<pid>-<n>` next to the target and renames it over (AD-8).
 * @param {string[]} names
 * @returns {string[]}
 */
export function tempLeftovers(names) {
  return names.filter((name) => /^\..*\.tmp-/.test(name))
}

/**
 * Types into a text or number control the way a keystroke does (`bind:value` listens for
 * `input`). Used where a native key press would only repeat what another check covers.
 * @param {HTMLElement | null | undefined} el
 * @param {string} value
 */
export function setInput(el, value) {
  if (!el) throw new Error('setInput: no control')
  const control = /** @type {HTMLInputElement} */ (el)
  control.value = value
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Picks an option of a `FormRenderer` choice control by its visible label. The option
 * values there are the *indices* of `choices` (a choice value may be any type), so
 * `h.select(el, 'off')` would not find anything.
 * @param {import('../lib/api.js').Harness} h
 * @param {HTMLElement | null | undefined} el
 * @param {string} label
 */
export function selectChoice(h, el, label) {
  const select = /** @type {HTMLSelectElement | null} */ (el && 'options' in el ? el : null)
  const option = [...(select?.options ?? [])].find((o) => o.textContent?.trim() === label)
  if (!select || !option) throw new Error(`selectChoice: no option ${JSON.stringify(label)} in ${[...(select?.options ?? [])].map((o) => o.textContent).join('|')}`)
  h.select(select, option.value)
}
