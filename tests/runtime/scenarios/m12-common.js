// Helpers the M12 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Five things are worth knowing before reading a check that uses these:
//
//   1. **Every expected answer is written out from the programs and their goldens, never read
//      from what the app says.** The programs are `tests/fixtures/channels/nc/**`, and
//      `tests/fixtures/channels/{resolve,check}/*.json` say where their sections, marks and
//      defects are (README there). A scenario reads those goldens from disk (`golden()`,
//      needs `files: REPO_FILE`) for the machine's channel block and the section ranges; the
//      line numbers of a finding come from the README's description of the program.
//   2. **The channel is read off the status item, not off the service.** `ChannelStatus.svelte`
//      renders `channels.forDoc()`; the item carries `data-channel-id`, `data-channel-count`,
//      `data-layout`, `data-missing` (ids not found) and `data-open` (ids open). The map is read
//      off `program-map-item` rows (`data-kind=channel|sync`, `data-channel-id`), the report
//      off `results-row` (`data-doc-id`, `data-line`). Visible text is read only for the one
//      thing it is the contract of (a message the user is told), and then by a pattern.
//   3. **A machine is made through the service** (`ctx.machines.add`), as `m10-common.js`
//      `machineMaker` does, and chosen through the real picker. The Machines page is
//      `m12-channels-config`'s own business.
//   4. **The multi-file fixtures are copied as a folder** (`h.fixture('channels/nc/fanuc-lathe')`):
//      the siblings of a program are looked for next to it, so a pair has to share a folder.
//   5. **A "channel" here is the machine's.** The ids are the machine's own (`1`, `2`, `a`, `b`),
//      the names too ("Channel 1", "Turret A"); nothing is translated.

import { removeFile } from './m2-common.js'
import { REPO_FILE, repoPath } from './m3-common.js'
import { LATHE, MILL, context, pickMachine, ready, waitForMachine } from './m6-common.js'
import { message } from './m4-common.js'
import { read } from './m5-common.js'

export { LATHE, MILL, REPO_FILE, context, message, pickMachine, read, ready, removeFile, repoPath, waitForMachine }

/** @typedef {import('../lib/api.js').Harness} Harness */

export const OKUMA = 'okuma-osp'

/** The channel fixtures' programs, relative to `tests/fixtures`. */
export const NC_DIR = 'channels/nc/fanuc-lathe'

/** The machine's own number rules as the lathe default stores them (`m6-machines-manage`; the tool word is `byLength` since M12.5). */
export const LATHE_PARAMS = { numberInput: { mode: 'calculator', incrementMm: '0.001' }, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A', incrementalAddresses: 'uw', toolWord: 'byLength' } }

// ---------------------------------------------------------------- the goldens

/**
 * A golden of `tests/fixtures/channels/resolve/`, parsed. Needs `files: REPO_FILE`.
 * @param {Harness} h
 * @param {string} name without `.json`
 * @returns {Promise<any>}
 */
export async function golden(h, name) {
  return JSON.parse(await h.disk.read(`${await repoPath(h)}/tests/fixtures/channels/resolve/${name}.json`))
}

/**
 * The channel block of a golden, as a machine would hold it.
 * @param {Harness} h
 * @param {string} name
 */
export async function blockOf(h, name) {
  return (await golden(h, name)).machine.channels
}

/**
 * The channel block of a built-in preset, exactly as the profile ships it.
 * @param {Harness} h
 * @param {string} profileId
 * @param {string} presetId
 */
export function presetBlock(h, profileId, presetId) {
  const found = context(h).profiles.profile(profileId).machineParams?.channels?.presets?.find((/** @type {any} */ p) => p.id === presetId)
  if (found === undefined) throw new Error(`${profileId} has no channel preset ${presetId}`)
  return structuredClone(found.value)
}

// ---------------------------------------------------------------- machines

/**
 * Makes machines through the service and picks them for the active document through the
 * picker. A machine is a lathe machine with `channels` as its channel block, or an Okuma one.
 * @param {Harness} h
 */
export function channelMachines(h) {
  const ctx = context(h)
  const machines = /** @type {any} */ (ctx).machines
  /** @type {Record<string, string>} */
  const ids = {}
  /**
   * @param {string} name
   * @param {object | undefined} channels the block (`undefined` makes a machine without channels)
   * @param {{ profile?: string, params?: object }} [o]
   */
  const add = async (name, channels, o = {}) => {
    const profile = o.profile ?? LATHE
    const base = o.params ?? (profile === OKUMA ? okumaParams(ctx) : LATHE_PARAMS)
    ids[name] = await machines.add({ name, profile, notes: '', params: { ...structuredClone(base), ...(channels === undefined ? {} : { channels: structuredClone(channels) }) } })
    await h.idle()
    return ids[name]
  }
  /** Picks a machine for the active document and waits until the status item shows it. @param {string} name */
  const use = async (name) => {
    await pickMachine(h, name)
    await waitForMachine(h, ids[name])
  }
  return { ids, add, use }
}

/**
 * Okuma's own default parameters for a machine: the first number preset, millimetres.
 * @param {import('$lib/app/types').AppContext} ctx
 */
function okumaParams(ctx) {
  const decl = /** @type {any} */ (ctx.profiles.profile(OKUMA).machineParams)
  const preset = decl?.numberInput?.presets?.[0]?.value
  return { ...(preset === undefined ? {} : { numberInput: preset }), units: 'mm', diameter: 'on' }
}

// ---------------------------------------------------------------- opening

/**
 * Opens a file through the queued dialog (the scope holds only what a dialog granted) and
 * waits until it is the one on screen.
 * @param {Harness} h
 * @param {string} path
 * @returns {Promise<string>} the document id
 */
export async function open(h, path) {
  const ctx = context(h)
  await h.dialogs.queue('open', path)
  const opened = await ctx.files.open()
  const id = opened[0] ?? ctx.docs.byPath(path)?.id
  if (id === undefined) throw new Error(`open: ${path} did not open`)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 15000 })
  await h.idle()
  return id
}

/** Makes a document the active one and waits for the editor to show it. @param {Harness} h @param {string} id */
export async function activate(h, id) {
  context(h).docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  await h.idle()
}

/** The id of the document the editor shows. @param {Harness} h */
export const activeId = (h) => h.q('editor-host')?.dataset.docId ?? ''

/**
 * Puts the cursor on a line and waits until the status bar agrees.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 */
export async function goto(h, id, line) {
  context(h).editor.reveal(id, line, 1)
  await h.waitFor(() => h.app.cursor().line === line, { timeout: 5000 })
  await h.idle()
}

// ---------------------------------------------------------------- the status item

/** The channel status item, or `null`. @param {Harness} h */
export const channelItem = (h) => h.q('status-item', { item: 'channel' })

/**
 * What the channel item says, as its attributes.
 * @param {Harness} h
 * @returns {{ present: boolean, id: string, count: string, layout: string, missing: string, open: string, text: string, title: string }}
 */
export function channelState(h) {
  const el = channelItem(h)
  const d = el?.dataset ?? {}
  return {
    present: el !== null && el !== undefined,
    id: d.channelId ?? '',
    count: d.channelCount ?? '',
    layout: d.layout ?? '',
    missing: d.missing ?? '',
    open: d.open ?? '',
    text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    title: el?.getAttribute('title') ?? '',
  }
}

/**
 * Waits until the channel item satisfies `want`, and answers its state (also on timeout).
 * @param {Harness} h
 * @param {(s: ReturnType<typeof channelState>) => boolean} want
 * @param {number} [timeout]
 */
export async function waitChannel(h, want, timeout = 8000) {
  await h.waitFor(() => want(channelState(h)), { timeout })
  await h.idle()
  return channelState(h)
}

// ---------------------------------------------------------------- the program map

/**
 * The rows of the program map in document order of the DOM.
 * @param {Harness} h
 * @returns {{ kind: string, line: number, channelId: string | null, text: string, depth: number, element: HTMLElement }[]}
 */
export function mapRows(h) {
  return h.qa('program-map-item').map((element) => ({
    element,
    kind: element.dataset.kind ?? '',
    line: Number(element.dataset.line ?? '0'),
    channelId: element.dataset.channelId ?? null,
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    depth: depthOf(element),
  }))
}

/** How many `li` ancestors a row has inside the map. @param {HTMLElement} element */
function depthOf(element) {
  let depth = 0
  for (let node = element.parentElement; node && !node.matches('[data-testid="program-map"]'); node = node.parentElement) {
    if (node.tagName === 'UL') depth++
  }
  return depth
}

/**
 * The rows that sit under a channel row, per channel id: `{ '1': [rows…], '': [rows…] }`
 * (`''` is "Outside the channels"). A row belongs to the closest channel row above it that is
 * not deeper than it.
 * @param {Harness} h
 */
export function mapByChannel(h) {
  /** @type {Record<string, ReturnType<typeof mapRows>>} */
  const out = {}
  for (const channel of mapRows(h).filter((r) => r.kind === 'channel')) {
    const root = channel.element.closest('li')
    out[channel.channelId ?? ''] = [...(root?.querySelectorAll('[data-testid="program-map-item"]') ?? [])]
      .filter((el) => el !== channel.element)
      .map((element) => ({
        element: /** @type {HTMLElement} */ (element),
        kind: /** @type {HTMLElement} */ (element).dataset.kind ?? '',
        line: Number(/** @type {HTMLElement} */ (element).dataset.line ?? '0'),
        channelId: /** @type {HTMLElement} */ (element).dataset.channelId ?? null,
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
        depth: 0,
      }))
  }
  return out
}

// ---------------------------------------------------------------- the Results panel

/** The rows of the report on screen that point at a line. @param {Harness} h */
export const resultRows = (h) =>
  h.qa('results-row')
    .filter((e) => (e.dataset.line ?? '') !== '')
    .map((element) => ({ element, docId: element.dataset.docId ?? '', line: Number(element.dataset.line), text: (element.textContent ?? '').replace(/\s+/g, ' ').trim() }))

/** The report the store holds (title, message, rows), or null. @param {Harness} h */
export const report = (h) => read(context(h).results.current) ?? null

/** Waits for a report that is not `before`. @param {Harness} h @param {unknown} before */
export async function waitReport(h, before = null) {
  await h.waitFor(() => {
    const r = report(h)
    return r !== null && r !== before
  }, { timeout: 10000 })
  await h.idle()
  return /** @type {any} */ (report(h))
}

// ---------------------------------------------------------------- keys

/** Alt+F7 / Shift+Alt+F7 / Mod+Alt+P through real NSEvents. */
export const keys = {
  next: [{ key: 'F7', mods: ['alt'] }],
  prev: [{ key: 'F7', mods: ['shift', 'alt'] }],
  partner: [{ key: 'p', mods: ['cmd', 'alt'] }],
}

/**
 * Presses a key combination in the editor and waits for the cursor to settle.
 * @param {Harness} h
 * @param {ReadonlyArray<{ key: string, mods?: string[] }>} combo
 */
export async function press(h, combo) {
  h.focusEditor()
  await h.nativeKeys(/** @type {any} */ (combo))
  await h.idle()
}
