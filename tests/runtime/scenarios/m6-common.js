// Helpers the M6 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Five things are worth knowing before reading a check that uses these:
//
//   1. **The machine is read off the status item, not off the service.** `machines.effective()`
//      is what the item renders, so asserting on the service would be asserting that a
//      function returns what it returns. The item carries `data-machine-id`, `data-choice`
//      and `data-assumed`, and its `title` is one line per effective parameter with the
//      source of each (`core/machines/fields.ts` `machineTooltip`) — which is the whole of
//      AD-31 "every effective value names its source", visible to a user.
//   2. **The item is absent on a dialect without machine parameters.** `MachineStatus.svelte`
//      renders nothing for Klartext, so `machineItem()` answers `null` there and a check
//      has to say which of the two it expects. "No item" and "an item saying none" are
//      different claims.
//   3. **The Machines page lives inside the settings dialog**, which is itself the one
//      modal `app/modals.ts` allows. `machines.manage` opens the dialog on the Machines
//      tab (I6's `initialTab` prop), so nothing here presses a tab afterwards.
//   4. **`machines.json` is read through the backend, never off a path the page built.**
//      `h.config.read('machines.json')` resolves the config folder exactly as the app
//      does, so a golden is compared against what the app really wrote.
//   5. **A picker entry is chosen by its label.** `pickItems` builds "None (dialect
//      defaults)", one entry per compatible machine (the machine's own name, data), "Other
//      machines…" and "Manage machines…". Clicking the row is what a user does, and the
//      row's `.label` span is the entry's label with no description or detail glued on.

import { context, openFixture, openPath, revealLine } from './m3-common.js'
import { message, ready } from './m4-common.js'

export { context, message, openFixture, openPath, ready, revealLine }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The three shipped dialects, by id. */
export const MILL = 'fanuc-gcode'
export const LATHE = 'fanuc-lathe'
export const KLARTEXT = 'heidenhain-klartext'

/** The one lathe fixture nearly every M6 scenario opens: system A, three tools, threads. */
export const L01 = 'nc/fanuc-lathe/l01-turning-a.nc'

// ---------------------------------------------------------------- the status item

/** The machine status item, or `null` on a dialect that has no machine parameters. */
export const machineItem = (/** @type {Harness} */ h) => h.q('status-item', { item: 'machine' })

/** Its visible text, with the non-breaking space of the "(assumed)" suffix normalised. */
export const machineText = (/** @type {Harness} */ h) =>
  (machineItem(h)?.textContent ?? '').replace(/ /g, ' ').trim()

/**
 * The tooltip of the machine item, one line per effective parameter.
 * Each reads `<label>: <value> — <where it came from>`.
 * @param {Harness} h
 * @returns {string[]}
 */
export const machineTooltip = (h) => (machineItem(h)?.getAttribute('title') ?? '').split('\n')

/**
 * One tooltip line by its label, or `''` when the parameter is not shown at all.
 * @param {Harness} h
 * @param {string} label e.g. `'G-code system'`
 */
export function tooltipLine(h, label) {
  return machineTooltip(h).find((line) => line.startsWith(`${label}: `)) ?? ''
}

/**
 * Waits until the machine item describes `machineId` (`''` for none).
 *
 * The item re-reads on `machines.revision`, which is bumped after the write, so a check
 * made in the same tick as the click would read the previous machine.
 * @param {Harness} h
 * @param {string} machineId
 */
export async function waitForMachine(h, machineId) {
  await h.waitFor(() => machineItem(h)?.dataset.machineId === machineId, { timeout: 8000 })
  await h.idle()
}

// ---------------------------------------------------------------- the picker

/**
 * Runs a command that opens a quick pick and clicks the entry whose label is `label`.
 *
 * `commands.run` only settles once the pick is answered, so the promise is held and
 * awaited after the click — the same rule `runTransform` follows for an options form.
 * @param {Harness} h
 * @param {string} command `file.setMachine` or `file.setProfile`
 * @param {string} label the entry's own label
 */
export async function pickEntry(h, command, label) {
  const running = context(h).commands.run(command)
  if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 }))) throw new Error(`${command} opened no picker`)
  const row = pickerRows(h).find((entry) => entry.label === label)
  if (!row) throw new Error(`pickEntry: no entry ${JSON.stringify(label)} in ${JSON.stringify(pickerRows(h).map((e) => e.label))}`)
  h.click(row.element)
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await running
  await h.idle()
}

/**
 * `file.setMachine`, answered with the entry called `label`.
 * @param {Harness} h
 * @param {string} label
 */
export const pickMachine = (h, label) => pickEntry(h, 'file.setMachine', label)

/** Every row of the picker that is on screen: its label, its description and its element. */
export function pickerRows(/** @type {Harness} */ h) {
  return h.qa('quick-pick-item').map((element) => ({
    element,
    label: element.querySelector('.label')?.textContent?.trim() ?? '',
    description: element.querySelector('.description')?.textContent?.trim() ?? '',
    detail: element.querySelector('.detail')?.textContent?.trim() ?? '',
  }))
}

/**
 * Opens a picker, reads it and closes it again with Escape, changing nothing.
 * @param {Harness} h
 * @param {string} [command]
 * @returns {Promise<ReturnType<typeof pickerRows>>}
 */
export async function readPicker(h, command = 'file.setMachine') {
  const running = context(h).commands.run(command)
  if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 }))) throw new Error(`${command} opened no picker`)
  const rows = pickerRows(h)
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await running
  await h.idle()
  return rows
}

// ---------------------------------------------------------------- Settings ▸ Machines

/** The settings dialog, whichever tab is open. */
export const settingsDialog = (/** @type {Harness} */ h) => h.q('modal', { modal: 'settings' })

/**
 * Opens Settings ▸ Machines through `machines.manage`.
 *
 * `modals.open` settles only when the dialog closes, so the promise is returned rather
 * than awaited; `closeSettings` awaits it.
 * @param {Harness} h
 * @returns {Promise<{ closed: Promise<unknown> }>}
 */
export async function openMachinesPage(h) {
  const closed = context(h).commands.run('machines.manage')
  if (!(await h.waitFor(() => h.q('settings-machines'), { timeout: 10000 }))) {
    throw new Error('Settings ▸ Machines did not open')
  }
  await h.idle()
  return { closed }
}

/**
 * Closes the settings dialog with Cancel, which writes no settings key.
 * @param {Harness} h
 * @param {{ closed: Promise<unknown> }} opened
 */
export async function closeSettings(h, opened) {
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
  await opened.closed
  await h.idle()
}

/** The rows of the Machines page, in the order it lists them. */
export function machineRows(/** @type {Harness} */ h) {
  return h.qa('machine-row').map((element) => ({
    element,
    id: element.dataset.machineId ?? '',
    profileId: element.dataset.profileId ?? '',
    isDefault: element.dataset.default === '1',
    problems: Number(element.dataset.problems ?? '0'),
    name: element.querySelector('.name')?.textContent?.trim() ?? '',
  }))
}

/**
 * A `machine-action` button by its action, optionally the one inside a row.
 * @param {Harness} h
 * @param {string} action `add` | `edit` | `duplicate` | `default` | `remove` | `next` | `save` | `cancel` | `open-file` | `replace-file`
 * @param {string} [machineId] the row it belongs to; omitted for the page's own actions
 * @returns {HTMLElement | undefined}
 */
export function machineAction(h, action, machineId) {
  const scope = machineId === undefined ? document : (machineRows(h).find((row) => row.id === machineId)?.element ?? null)
  if (scope === null) throw new Error(`machineAction: no row ${JSON.stringify(machineId)}`)
  return /** @type {HTMLElement[]} */ ([...scope.querySelectorAll('[data-testid="machine-action"]')]).find((element) => element.dataset.action === action)
}

/**
 * Clicks a `machine-action` and lets the page settle.
 * @param {Harness} h
 * @param {string} action
 * @param {string} [machineId]
 */
export async function clickMachineAction(h, action, machineId) {
  const button = machineAction(h, action, machineId)
  if (!button) throw new Error(`clickMachineAction: no ${action} button`)
  h.click(/** @type {HTMLElement} */ (button))
  await h.idle()
}

/** A field of the machine form, by its `data-field`. */
export const machineField = (/** @type {Harness} */ h, /** @type {string} */ field) => h.q('form-field', { field })

/** `machines.json` as the backend reads it, or `null` while the file does not exist. */
export const machinesFile = (/** @type {Harness} */ h) => h.config.read('machines.json')

// ---------------------------------------------------------------- the machines file

/**
 * The record shape `machines.json` holds, spelled out once so a golden is written the
 * way Rust writes it: `$version` first, then every key sorted (`serde_json` without
 * `preserve_order`), `machines` in file order and `defaults` keyed by profile id.
 * @param {{ machines?: unknown[], defaults?: Record<string, string> }} o
 */
export const machinesJson = ({ machines = [], defaults = {} } = {}) => ({
  $version: 1,
  defaults,
  machines,
})

/**
 * Deep, key-order-insensitive comparison, so a golden describes content and not spelling.
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameJson(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}

/**
 * @param {unknown} value
 * @returns {unknown} the same value with every object key sorted
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of Object.keys(/** @type {Record<string, unknown>} */ (value)).sort()) {
    out[key] = sortKeys(/** @type {Record<string, unknown>} */ (value)[key])
  }
  return out
}
