// Helpers the M4 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Five things are worth knowing before reading a check that uses these:
//
//   1. **A transform is driven through its command, never through its def.** The
//      `TransformDef` objects live in `core/transforms/**` and nothing on `h.app.ctx`
//      hands them out, so a scenario runs `ctx.commands.run('nc.…')` and answers the
//      options form through `modal` / `form-field` / `modal-ok` (§7.9). The one
//      exception is `PREFIX_DEF` below, which is a def written here because no shipped
//      command asks for `target: 'new-document'`.
//   2. **`commands.run` must not be awaited while the form is up.** It only settles
//      after the dialog is answered, and the scenario is the one who has to answer it,
//      so `runTransform` holds the promise, fills the form, clicks OK and awaits
//      afterwards.
//   3. **The goldens are read off disk, never retyped.** `transformCase` copies
//      `tests/fixtures/transforms/<id>/<case>/` into the run folder and reads
//      `input.nc` and `expected.nc`, so a fixture that changes fails the scenario rather
//      than quietly disagreeing with it. Both carry a final newline, which is the
//      document's trailing empty line — rule 5 of `core/transforms/types.ts`, and the
//      reason the comparison is on the whole text and not line by line.
//   4. **A fixture golden carries no `(WRITTEN FOR GEDIT` marker**, unlike the `nc/`
//      fixtures: `remove-comments` and `convert-case` would rewrite the marker into
//      their own golden (`tests/fixtures/README.md`).
//   5. **`options.json` comes in two shapes** (`tests/fixtures/README.md`): WP4.2 wraps
//      the run (`{ note, profile, firstLine, options, expect }`) and WP4.3 stores the
//      bare `TransformContext.options`. `caseOptions` and `caseProfile` read both, so a
//      scenario can say "these are the fixture's options" without knowing which work
//      package wrote the folder.

import { context, revealLine } from './m3-common.js'

export { context, revealLine }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** Every `nc.*` transform command, in ribbon order (WP4.2 10…20, WP4.3 10…50). */
export const NC_COMMANDS = [
  'nc.renumber',
  'nc.removeBlockNumbers',
  'nc.insertSpaces',
  'nc.removeSpaces',
  'nc.removeEmptyLines',
  'nc.removeComments',
  'nc.convertCase',
]

/** The four `bookmark.*` commands (WP4.4); only the first three carry keys (§7.11). */
export const BOOKMARK_COMMANDS = ['bookmark.toggle', 'bookmark.next', 'bookmark.prev', 'bookmark.clear']

/** The 22 Monaco wrappers of `contrib/editing.ts`, by ribbon tab. */
export const EDITING_COMMANDS = {
  home: [
    'edit.undo',
    'edit.redo',
    'edit.find',
    'edit.replace',
    'edit.toggleComment',
    'edit.duplicateLine',
    'edit.moveLineUp',
    'edit.moveLineDown',
    'edit.deleteLine',
    'edit.selectAll',
    'edit.upperCase',
    'edit.lowerCase',
  ],
  view: [
    'view.foldAll',
    'view.unfoldAll',
    'view.quickOutline',
    'view.toggleWhitespace',
    'view.toggleWordWrap',
    'view.toggleMinimap',
    'view.toggleStickyScroll',
    'view.zoomIn',
    'view.zoomOut',
    'view.zoomReset',
  ],
}

/** The status bar's message line, trimmed. @param {Harness} h */
export const message = (h) => h.q('status-message')?.textContent?.trim() ?? ''

/** A ribbon button by command id. @param {Harness} h @param {string} id */
export const cmdButton = (h, id) => h.q('cmd-button', { command: id })

/**
 * Waits until the app has rendered and Monaco holds a document.
 * @param {Harness} h
 */
export async function ready(h) {
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId, { timeout: 15000 })
  await h.idle()
}

/**
 * Switches the ribbon to a tab and waits for its buttons.
 * @param {Harness} h
 * @param {string} tab
 */
export async function ribbonTab(h, tab) {
  const button = h.qa('ribbon-tab').find((e) => e.dataset.tab === tab)
  if (!button) throw new Error(`ribbonTab: no ${tab} tab`)
  h.click(button)
  await h.waitFor(() => h.qa('ribbon-tab').find((e) => e.dataset.tab === tab)?.getAttribute('aria-selected') === 'true', { timeout: 5000 })
  await h.idle()
}

/**
 * A new untitled document holding `text`, with the profile named rather than detected.
 * @param {Harness} h
 * @param {string} text LF
 * @param {string} [profileId]
 * @returns {Promise<string>} the document id
 */
export async function newDoc(h, text, profileId = 'fanuc-gcode') {
  const id = context(h).files.newUntitled({ profileId, text })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 10000 })
  await h.idle()
  return id
}

/** @typedef {{ input: string, expected: string, sidecar: any, options: Record<string, unknown>, profile: string }} TransformCase */

/**
 * `tests/fixtures/transforms/<id>/<name>/`, copied into the run folder and read.
 * @param {Harness} h
 * @param {string} id transform id, which is also the folder name
 * @param {string} name case folder
 * @returns {Promise<TransformCase>}
 */
export async function transformCase(h, id, name) {
  const dir = await h.fixture(`transforms/${id}/${name}`)
  const raw = await h.disk.read(`${dir}/options.json`).catch(() => '{}')
  const sidecar = JSON.parse(raw)
  return {
    input: await h.disk.read(`${dir}/input.nc`),
    expected: await h.disk.read(`${dir}/expected.nc`),
    sidecar,
    options: caseOptions(sidecar),
    profile: caseProfile(sidecar, name),
  }
}

/** True for the WP4.2 sidecar, which wraps the run instead of being the options. */
const isWrapped = (/** @type {any} */ sidecar) =>
  sidecar !== null && typeof sidecar === 'object' && ('expect' in sidecar || 'profile' in sidecar || 'firstLine' in sidecar)

/**
 * The `TransformContext.options` a case runs with, whichever sidecar shape it uses.
 * @param {any} sidecar
 * @returns {Record<string, unknown>}
 */
export function caseOptions(sidecar) {
  return isWrapped(sidecar) ? (sidecar.options ?? {}) : (sidecar ?? {})
}

/**
 * The dialect a case runs on: named by the WP4.2 sidecar, taken from the folder name by
 * WP4.3 (`klartext-…` is Klartext, anything else Fanuc).
 * @param {any} sidecar
 * @param {string} name the case folder
 * @returns {string}
 */
export function caseProfile(sidecar, name) {
  if (isWrapped(sidecar) && typeof sidecar.profile === 'string') return sidecar.profile
  return name.startsWith('klartext') ? 'heidenhain-klartext' : 'fanuc-gcode'
}

/**
 * Sets one control of the options form that is on screen.
 *
 * A choice control's option *values* are the indices of `choices` (a choice value may be
 * any type — `components/forms/FormRenderer.svelte`), so a choice is picked by its label.
 * @param {Harness} h
 * @param {string} field the `data-field` of the wrapper
 * @param {string | number | boolean} value
 */
export function setField(h, field, value) {
  const wrapper = h.q('form-field', { field })
  if (!wrapper) throw new Error(`setField: no field ${JSON.stringify(field)} in the form`)
  const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (wrapper.querySelector('input, select, textarea'))
  if (!control) throw new Error(`setField: ${field} has no control`)
  if (control instanceof HTMLInputElement && control.type === 'checkbox') {
    if (control.checked !== Boolean(value)) h.click(control)
    return
  }
  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((o) => o.textContent?.trim() === String(value))
    if (!option) throw new Error(`setField: no option ${JSON.stringify(value)} in ${[...control.options].map((o) => o.textContent).join('|')}`)
    h.select(control, option.value)
    return
  }
  control.value = String(value)
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Runs a transform command and waits until it has finished.
 *
 * `form` says whether this transform has options: a transform with none opens no dialog
 * (`app/transforms.ts` step 2 — an empty field list is the contract's way of saying "no
 * form"), so waiting for one would cost a timeout on every run. `confirm` is the native
 * alert of a preflight or of the Klartext renumber follow-up, answered with that label.
 * @param {Harness} h
 * @param {string} commandId
 * @param {{ form?: boolean, fields?: Record<string, string | number | boolean>, confirm?: string, cancelForm?: boolean }} [o]
 * @returns {Promise<boolean>} what `commands.run` answered
 */
export async function runTransform(h, commandId, o = {}) {
  const running = context(h).commands.run(commandId)
  if (o.form === true) {
    await h.waitFor(() => h.q('modal'), { timeout: 10000 })
    for (const [field, value] of Object.entries(o.fields ?? {})) setField(h, field, value)
    await h.frame()
    h.click(h.q(o.cancelForm === true ? 'modal-cancel' : 'modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  }
  if (o.confirm !== undefined) {
    await h.alert.wait()
    await h.alert.click(o.confirm)
  }
  const answer = await running
  await h.idle()
  return answer
}

/**
 * A `TransformDef` written here rather than imported: `core/transforms/**` is TypeScript,
 * which a scenario file cannot import (it is loaded by the node runner as well as
 * bundled into the page), and no shipped command asks for `target: 'new-document'`. The
 * two `Msg` keys are real ones, so `t()` reports nothing missing.
 *
 * It prefixes every non-empty line, which leaves the trailing empty element alone.
 */
export const PREFIX_DEF = {
  id: 'zz-harness-prefix',
  title: 'results.title',
  // `true` and not `boolean`: `TransformDef.available` answers `true | Msg`.
  available: () => /** @type {true} */ (true),
  /** @param {string[]} lines */
  run: (lines) => ({
    lines: lines.map((line) => (line === '' ? line : `(Z) ${line}`)),
    summary: { key: 'results.findings' },
    skipped: [],
    warnings: [],
  }),
}

/**
 * The document ids that are open, in tab order.
 * @param {Harness} h
 */
export const openDocIds = (h) => h.qa('doc-tab').map((e) => e.dataset.docId)

/**
 * Selects whole lines in the active editor. `EditorService` has no `setSelection`, and a
 * run over a selection is what proves the scope is taken from the editor and the report
 * lines are document lines.
 * @param {Harness} h
 * @param {number} startLine 1-based
 * @param {number} endLine inclusive
 */
export async function selectLines(h, startLine, endLine) {
  const instance = /** @type {any} */ (context(h).editor.editorInstance())
  if (!instance) throw new Error('selectLines: no editor instance')
  instance.setSelection({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: 1 + (instance.getModel()?.getLineLength(endLine) ?? 0),
  })
  await h.idle()
}

/** The bookmark glyphs Monaco has drawn in the margin (WP4.4 `monaco/bookmarks.css`). */
export const bookmarkGlyphs = (/** @type {Harness} */ h) => [...(h.q('editor-host')?.querySelectorAll('.gedit-bookmark-glyph') ?? [])]

/** The bookmarked whole-line decorations Monaco has drawn. */
export const bookmarkLines = (/** @type {Harness} */ h) => [...(h.q('editor-host')?.querySelectorAll('.gedit-bookmark-line') ?? [])]

/**
 * A deterministic numbered Fanuc program of `lines` lines (plus the trailing newline),
 * for the G7 budgets. Every block carries a number, so `renumber` and
 * `removeBlockNumbers` both have work to do on every one of them.
 *
 * The numbers run from 1000 in steps of 1, which is **not** what the profile defaults
 * would write (10 in steps of 10): a run with the defaults therefore has to rewrite every
 * line, and an undo has something to take back.
 * @param {number} lines
 */
export function numberedProgram(lines) {
  const out = ['%', 'O7000 (PERF)', 'N1000 G21 G17 G40 G49 G80 G90 G94', 'N1001 T1 M6', 'N1002 S3000 M3', 'N1003 G0 X0. Y0.']
  let n = 1004
  let x = 0
  let y = 0
  let direction = 1
  const fixed = (/** @type {number} */ value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(3)
  while (out.length < lines - 3) {
    x += 0.5 * direction
    if (x > 100 || x < 0) {
      direction = -direction
      x += 0.5 * direction
      y = y >= 80 ? 0 : y + 1
    }
    out.push(`N${n} G1 X${fixed(x)} Y${fixed(y)} F800.`)
    n += 1
  }
  out.push(`N${n} G0 Z50.`, `N${n + 1} M30`, '%')
  return out.join('\n') + '\n'
}
