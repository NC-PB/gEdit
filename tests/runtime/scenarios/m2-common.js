// Helpers the M2 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Everything here is either a Svelte-store read or a gap in the helper API (§7.9 has no
// "list a folder" and no "delete a file"), which the v1 script runner fills: it is the
// one command that can run arbitrary code outside the webview, and every M2 scenario that
// needs to take a file away from under the editor or look for a leftover temp file goes
// through it.

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
 * @returns {{ configDir: string, dataDir: string, settingsFile: string, stateFile: string, userScriptsDir: string }}
 */
export function configPaths(ctx) {
  const paths = read(ctx.settings.paths)
  if (!paths) throw new Error('settings.paths is null: config_load did not answer')
  return paths
}

/**
 * Runs a throw-away Python script from the run folder through the v1 runner.
 * @param {import('../lib/api.js').Harness} h
 * @param {string} name bare `*.py` file name
 * @param {string} source
 * @param {string} [input] stdin
 * @returns {Promise<{ stdout: string, stderr: string, success: boolean, data: any }>}
 */
export async function python(h, name, source, input = '') {
  await h.disk.write(`${h.cfg.run}/${name}`, source)
  const r = await h.attempt('run_python_script', { folderPath: h.cfg.run, scriptName: name, inputText: input })
  if (!r.ok) throw new Error(`${name}: ${r.error}`)
  if (!r.value?.success) throw new Error(`${name} failed: ${r.value?.stderr ?? '(no stderr)'}`)
  return r.value
}

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
