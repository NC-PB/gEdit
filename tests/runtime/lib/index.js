// Entry point for scenario files: `import { scenario } from '../lib/index.js'`.
//
// Scenario files are loaded twice: by the node runner, which only reads the options,
// and bundled into the page, where the selected scenario runs. Keep module top levels
// free of DOM access and side effects.

/** @typedef {import('./api.js').Harness} Harness */

/**
 * How run.sh prepares a run. Strings in `vars`, `python` and `files` may use the
 * placeholders `{run}` (run folder), `{home}` (the app's HOME), `{python}` (the harness
 * interpreter) and `{repo}` (repository root).
 * @typedef {object} ScenarioOptions
 * @property {number} [timeout] seconds before the run is killed (default 90)
 * @property {'inherit' | 'finder'} [env] `finder` starts the app with the minimal
 *   environment of a Finder or Dock launch (HOME, USER, LOGNAME, TMPDIR, SHELL and
 *   PATH=/usr/bin:/bin:/usr/sbin:/sbin) and cwd `/`; default `inherit`
 * @property {string | null} [python] GEDIT_PYTHON for the app; `null` leaves it unset;
 *   default `{python}`
 * @property {Record<string, string>} [vars] extra environment variables
 * @property {Record<string, string | { text: string, mode?: number }>} [files] files
 *   written relative to the run folder before the app starts
 */

/** @typedef {(h: Harness) => Promise<void>} ScenarioFn */
/** @typedef {{ name: string, options: ScenarioOptions, fn: ScenarioFn }} Scenario */

/** @type {Map<string, Scenario>} */
export const scenarios = new Map()

/**
 * Registers a scenario. run.sh selects it by name, so names are unique across files.
 * @param {string} name
 * @param {ScenarioOptions | ScenarioFn} optionsOrFn
 * @param {ScenarioFn} [fn]
 */
export function scenario(name, optionsOrFn, fn) {
  const run = typeof optionsOrFn === 'function' ? optionsOrFn : fn
  const options = typeof optionsOrFn === 'function' ? {} : optionsOrFn
  if (!run) throw new Error(`scenario ${name}: missing function`)
  if (scenarios.has(name)) throw new Error(`scenario ${name} is registered twice`)
  scenarios.set(name, { name, options, fn: run })
}
