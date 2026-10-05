// Helpers the M11 scenarios share (search, compare). This file registers no scenario:
// `loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Three things are worth knowing before reading a check that uses these:
//
//   1. **Expected answers are written out here, from the programs' own text.** The search
//      and compare code is written by other work packages, so a scenario never asks it what
//      the right answer is: the rows, counts and merged texts are typed from the fixtures
//      below (and from `tests/fixtures/compare/README.md` and `expected.diff` for X5).
//   2. **The diff editor is read through Monaco's own registry.** While a comparison is
//      open the page has no `monaco` global and the main editor is gone, so the two services
//      the scenarios need (`modelService`, `codeEditorService`) are found once, while the
//      editor still exists, in the editor's instantiation service (the same internals
//      `m2-compare` documents, pinned to monaco 0.55). From `codeEditorService` the diff
//      editor gives its line changes, its two panes' cursors and their models.
//   3. **Keys go through the real key path where the key is the point.** The merge keys
//      (`Mod+Alt+Right/Left`) and `Mod+Shift+F` are native key presses; everything else
//      (go to a line, the undo of a pane) is a command or a Monaco action, since a Cmd+Z
//      belongs to the native Edit menu and never reaches the page under posted events.

import { setInput, read } from './m2-common.js'
import { context, openPath } from './m3-common.js'
import { message, newDoc, ready, ribbonTab } from './m4-common.js'
import { fillForm, guard, pick } from './m10-common.js'

export { context, fillForm, guard, message, newDoc, openPath, pick, read, ready, ribbonTab, setInput }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The five review toggles, in the order the bar shows them (`COMPARE_OPTION_KEYS`). */
export const OPTION_KEYS = ['ignoreBlockNumbers', 'ignoreWhitespace', 'ignoreComments', 'ignoreCase', 'ignoreNumberFormat']

/** The review defaults of `fanuc-gcode` (plan §8.11): everything on but case. */
export const FANUC_DEFAULTS = { ignoreBlockNumbers: true, ignoreWhitespace: true, ignoreComments: true, ignoreCase: false, ignoreNumberFormat: true }

export const lines = (/** @type {string} */ text) => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')

// ---------------------------------------------------------------- Monaco's registry

/**
 * One service of the editor's instantiation tree, found by the id it was registered under.
 * @param {any} ctx
 * @param {string} id
 * @param {string} method a method the service must have
 */
function serviceOf(ctx, id, method) {
  let inst = /** @type {any} */ (ctx.editor.editorInstance())?._instantiationService
  while (inst) {
    for (const [key, service] of inst._services?._entries ?? []) {
      if (String(key) === id && typeof service?.[method] === 'function') return service
    }
    inst = inst._parent
  }
  return null
}

/**
 * Monaco's two registries. **Call while the main editor exists** (before a comparison opens).
 * @param {Harness} h
 * @returns {{ models: any, editors: any }}
 */
export function monacoRegistry(h) {
  const ctx = context(h)
  const models = serviceOf(ctx, 'modelService', 'getModels')
  const editors = serviceOf(ctx, 'codeEditorService', 'listDiffEditors')
  h.check('Monaco’s model and editor registries are reachable (monaco 0.55 internals)', models !== null && editors !== null)
  return { models, editors }
}

/** The open diff editor, or undefined. @param {{ editors: any }} reg */
export const diffEditor = (reg) => /** @type {any} */ (reg.editors?.listDiffEditors?.()[0])

/** Monaco's line changes of the open diff, null while it is not computed. @param {{ editors: any }} reg */
export const lineChanges = (reg) => /** @type {any[] | null} */ (diffEditor(reg)?.getLineChanges() ?? null)

/** `[original, modified]` start/end of a line change as plain numbers. @param {any} c */
export const spans = (c) => ({ o: [c.originalStartLineNumber, c.originalEndLineNumber], m: [c.modifiedStartLineNumber, c.modifiedEndLineNumber] })

/** The text of a pane's model. @param {{ editors: any }} reg @param {'original' | 'modified'} side */
export const paneText = (reg, side) => {
  const d = diffEditor(reg)
  return /** @type {string | undefined} */ ((side === 'original' ? d?.getOriginalEditor() : d?.getModifiedEditor())?.getModel()?.getValue())
}

/** The cursor line of a pane. @param {{ editors: any }} reg @param {'original' | 'modified'} side */
export const paneLine = (reg, side) => {
  const d = diffEditor(reg)
  return /** @type {number | undefined} */ ((side === 'original' ? d?.getOriginalEditor() : d?.getModifiedEditor())?.getPosition()?.lineNumber)
}

/**
 * Undo or redo in one pane. The original pane is read-only (its own editor refuses `undo`), so
 * that side goes through its model: the same undo stack the document's own tab would use.
 * @param {{ editors: any }} reg @param {'original' | 'modified'} side @param {'undo' | 'redo'} action
 */
export function paneUndo(reg, side, action) {
  const d = diffEditor(reg)
  if (side === 'original') d?.getOriginalEditor()?.getModel()?.[action]()
  else paneDo(reg, side, action)
}

/** Runs a Monaco action (`undo`, `redo`) in one pane. @param {{ editors: any }} reg @param {'original' | 'modified'} side @param {string} action */
export function paneDo(reg, side, action) {
  const d = diffEditor(reg)
  const pane = side === 'original' ? d?.getOriginalEditor() : d?.getModifiedEditor()
  pane?.focus()
  pane?.trigger('m11', action, null)
}

// ---------------------------------------------------------------- the comparison

export const view = (/** @type {Harness} */ h) => h.q('compare-view')

/**
 * Opens a comparison and waits until it is on screen with its diff computed.
 * @param {Harness} h
 * @param {{ editors: any }} reg
 * @param {string} docId the modified side
 * @param {import('$lib/app/types').CompareSource} source
 * @returns {Promise<boolean>} what `open` answered
 */
export async function openCompare(h, reg, docId, source) {
  const ctx = context(h)
  const ok = await /** @type {any} */ (ctx.compare).open(docId, source)
  await h.waitFor(() => !!view(h)?.querySelector('.monaco-diff-editor'), { timeout: 15000 })
  await h.waitFor(() => lineChanges(reg) !== null, { timeout: 30000, interval: 20 })
  await h.idle()
  return ok
}

/** Closes the comparison and waits for the editor to be back. @param {Harness} h */
export async function closeCompare(h) {
  /** @type {any} */ (context(h).compare).close()
  await h.waitFor(() => !view(h) && !!h.q('editor-host'), { timeout: 10000 })
  await h.idle()
}

/** A mode switch: click the toolbar button and wait for the view to say so. @param {Harness} h @param {'raw' | 'review'} mode */
export async function setMode(h, mode) {
  h.click(h.q('compare-mode', { mode }))
  await h.waitFor(() => view(h)?.dataset.mode === mode && h.q('compare-mode', { mode })?.getAttribute('aria-pressed') === 'true', { timeout: 10000 })
  await h.idle()
}

/** The review toggles as the bar shows them. @param {Harness} h */
export const toggles = (h) => Object.fromEntries(h.qa('compare-option').map((e) => [e.dataset.option ?? '', e.getAttribute('aria-pressed') === 'true']))

/** The review bar's notes: the reasons. @param {Harness} h */
export const notes = (h) => h.qa('compare-note').map((e) => e.dataset.reason)

/** The untitled tabs a comparison's export leaves behind. @param {Harness} h */
export const docIds = (h) => h.qa('doc-tab').map((e) => e.dataset.docId ?? '')

// ---------------------------------------------------------------- search forms

/**
 * Runs a command that opens a form, fills it, presses OK, and waits for the command to end.
 * @param {Harness} h
 * @param {string} command
 * @param {Record<string, unknown>} values
 * @returns {Promise<unknown>}
 */
export async function runForm(h, command, values) {
  const ctx = context(h)
  const running = ctx.commands.run(command)
  if (!(await h.waitFor(() => h.q('modal'), { timeout: 15000 }))) throw new Error(`${command} opened no form (status: ${message(h)})`)
  fillForm(h, values)
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 15000 })
  const answer = await running
  await h.idle()
  return answer
}

/** The report the Results panel holds. @param {Harness} h */
export const report = (h) => /** @type {import('$lib/app/types').ReportData | null} */ (read(context(h).results.current))

/** `{ docId, line }` of every row of a report. @param {import('$lib/app/types').ReportData | null} r */
export const rowsOf = (r) => (r?.rows ?? []).map((row) => ({ docId: /** @type {any} */ (row).docId, line: Number(/** @type {any} */ (row).line) }))

/** The "All open documents" choice of the find form. */
export const ALL_OPEN = pick('All', 1)
/** The "The active document" choice (the form remembers its last answer). */
export const ACTIVE_ONLY = pick('The active', 0)
