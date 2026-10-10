// Helpers the P3b scenarios share (Phase 3 plan H3b: `p3-templates`, `p3-cycleforms`, `p3-template-manager`).
// This file registers no scenario: `loadScenarios()` imports it like any other file under `scenarios/` and
// finds nothing new in it.
//
// What to know before reading a check that uses these:
//
//   1. **Expected text comes from the goldens, the data files or the program, never from what the app
//      shows.** `tests/fixtures/templates/<code set>/<id>.json` holds the text of a template for its default
//      values and a stated environment (`env.prevBlockNumber`), `tests/fixtures/cycleforms/<profile>/<case>.json`
//      holds the edit a cycle form makes; both were written before the UI existed and the unit tests hold the
//      engines to them. A scenario builds the program the golden states (its last numbered block is the golden's
//      `prevBlockNumber`), drives the real UI and compares the text that ended up in the document. The wording of
//      a message is `ctx.t(...)`; a template's own label, group and text are data and are read from
//      `src/lib/data/codes/*.json` through the `{repo}` placeholder (`REPO_FILE`), as `loadPalette` reads the
//      colours.
//   2. **The Insert tab is read through its test ids** (`template-group`, `template-more`, `cmd-button` with
//      `data-command="insert.template:<id>"` and `data-review`), the group captions from the ribbon's own
//      `.group-label`. The forms are the app's one form dialog (`modal[data-modal=form]`, `form-field`,
//      `template-preview`, `form-note` or `cycle-form`).
//   3. **The OK and Cancel of a dialog are pressed with a real mouse click.** A click can be lost when another
//      app took the keyboard a moment before; `press` tries the real click up to three times (window brought to
//      the front first) and only then falls back to a DOM click, counting which one it was (`clicks`), so a
//      scenario can demand `clicks.dom === 0` and fail loudly instead of being silently green (H3a's rule).

import { ribbonTab } from './m4-common.js'
import { context, plain } from './m3-common.js'

export { context, plain }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** How the buttons of the dialogs were pressed in this run: `real` (native click) or `dom` (fallback). */
export const clicks = { real: 0, dom: 0 }

/** The code database files the scenarios read through `{repo}`; the placeholder needs `files: REPO_FILE` in the options. */
export const REPO_FILE = { 'repo-path.txt': '{repo}' }

/**
 * A code database file of the repository, parsed.
 * @param {Harness} h
 * @param {string} id file name without `.json`
 * @returns {Promise<any>}
 */
export async function codeFile(h, id) {
  const repo = (await h.disk.read(`${h.cfg.run}/repo-path.txt`)).trim()
  return JSON.parse(await h.disk.read(`${repo}/src/lib/data/codes/${id}.json`))
}

/**
 * A golden of `tests/fixtures/<rel>.json`, parsed.
 * @param {Harness} h
 * @param {string} rel
 * @returns {Promise<any>}
 */
export async function golden(h, rel) {
  return JSON.parse(await h.disk.read(await h.fixture(`${rel}.json`)))
}

/** All the lines of a document. @param {Harness} h @param {string} id */
export const linesOf = (h, id) => {
  const ctx = context(h)
  return ctx.editor.getLines(id, 1, ctx.editor.getLineCount(id))
}

// ---------------------------------------------------------------- the ribbon

/**
 * The groups of the active ribbon tab, in order: the caption under the group and the commands of its
 * buttons. A custom group (the Insert tab's templates) shows its own captions inside.
 * @param {Harness} h
 */
export function ribbonGroups(h) {
  return [...document.querySelectorAll('.ribbon-body .ribbon-group')].map((group) => ({
    label: plain(group.querySelector(':scope > .group-label')?.textContent).trim(),
    commands: [...group.querySelectorAll('[data-testid="cmd-button"]')].map((b) => /** @type {HTMLElement} */ (b).dataset.command ?? ''),
    element: group,
  }))
}

/**
 * The template blocks of the Insert tab (`template-group`): the caption, the buttons (command, label, tooltip,
 * review mark) and the options of the "More Templates…" list.
 * @param {Harness} h
 */
export function templateBlocks(h) {
  return h.qa('template-group').map((block) => ({
    key: block.dataset.group ?? '',
    caption: plain(block.querySelector('.tcaption')?.textContent).trim(),
    buttons: [...block.querySelectorAll('[data-testid="cmd-button"]')].map((b) => {
      const el = /** @type {HTMLElement} */ (b)
      return { element: el, command: el.dataset.command ?? '', id: (el.dataset.command ?? '').replace(/^insert\.template:/, ''), label: plain(el.querySelector('.btn-label')?.textContent).trim(), title: el.title, review: el.dataset.review ?? '', disabled: /** @type {HTMLButtonElement} */ (el).disabled }
    }),
    more: /** @type {HTMLSelectElement | null} */ (block.querySelector('[data-testid="template-more"]')),
    moreOptions: [...block.querySelectorAll('[data-testid="template-more"] option:not([disabled])')].map((o) => ({ id: /** @type {HTMLOptionElement} */ (o).value, label: plain(o.textContent).trim(), review: /** @type {HTMLElement} */ (o).dataset.review ?? '' })),
  }))
}

/** Opens a ribbon tab and returns its button for a command (or null). @param {Harness} h @param {string} tab @param {string} command */
export async function ribbonButton(h, tab, command) {
  await ribbonTab(h, tab)
  return h.q('cmd-button', { command })
}

/** Runs a template from the Insert tab: its button when it has one, else the option of its "More Templates…" list. @param {Harness} h @param {string} id */
export async function runFromInsertTab(h, id) {
  await ribbonTab(h, 'insert')
  const blocks = templateBlocks(h)
  const button = blocks.flatMap((b) => b.buttons).find((b) => b.id === id)
  if (button) {
    h.click(button.element)
    return 'button'
  }
  const block = blocks.find((b) => b.moreOptions.some((o) => o.id === id))
  if (!block?.more) throw new Error(`the Insert tab offers no template ${id}`)
  h.select(block.more, id)
  return 'more'
}

// ---------------------------------------------------------------- the form dialog

/** The form dialog, or null. @param {Harness} h */
export const formDialog = (h) => h.q('modal', { modal: 'form' })

/**
 * Waits for the form dialog.
 * @param {Harness} h
 * @param {number} [timeout]
 */
export async function waitForm(h, timeout = 8000) {
  const dialog = await h.waitFor(() => formDialog(h), { timeout })
  await h.idle()
  return dialog ?? null
}

/**
 * What the open form shows: title, OK label and state, the fields with their control values, the note and
 * the preview.
 * @param {Harness} h
 */
export function formState(h) {
  const dialog = formDialog(h)
  if (!dialog) return null
  /** @type {Map<string, { value: string, readOnly: boolean, error: string, kind: string, element: HTMLElement, options?: string[] }>} */
  const fields = new Map()
  for (const wrapper of h.qa('form-field')) {
    const id = wrapper.dataset.field ?? ''
    const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (wrapper.querySelector('input, select, textarea'))
    let value = ''
    let kind = ''
    /** @type {string[] | undefined} */
    let options
    if (control instanceof HTMLSelectElement) {
      value = plain(control.selectedOptions[0]?.textContent).trim()
      kind = 'select'
      options = [...control.options].map((o) => plain(o.textContent).trim())
    } else if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      value = String(control.checked)
      kind = 'checkbox'
    } else if (control) {
      value = control.value
      kind = 'text'
    }
    fields.set(id, { value, kind, options, readOnly: wrapper.dataset.readonly === 'true' || (control instanceof HTMLInputElement && control.readOnly), error: wrapper.dataset.error ?? '', element: wrapper })
  }
  const ok = /** @type {HTMLButtonElement | null} */ (dialog.querySelector('[data-testid="modal-ok"]'))
  const preview = h.q('template-preview')
  const note = h.q('form-note') ?? h.q('cycle-form')
  return {
    dialog,
    title: plain(dialog.querySelector('.modal-title')?.textContent).trim(),
    okLabel: plain(ok?.textContent).trim(),
    okDisabled: ok?.disabled === true,
    fields,
    values: Object.fromEntries([...fields].map(([id, f]) => [id, f.value])),
    note: plain(note?.textContent).trim(),
    noteElement: note,
    preview: preview ? plain(preview.textContent).trim() : '',
    previewError: preview?.dataset.error ?? '',
    hasPreview: preview !== null,
  }
}

/**
 * The open form, or a thrown error (inside a `guard` that is one failed check, "the section ran to its end"): for the
 * places where the scenario has just opened a form and a missing one is the failure.
 * @param {Harness} h
 */
export function formNow(h) {
  const state = formState(h)
  if (!state) throw new Error('no form dialog is open')
  return state
}

/**
 * Sets one control of the form, the way `m4-common`'s `setField` does, then waits for the live preview.
 * @param {Harness} h
 * @param {string} field
 * @param {string} value
 */
export async function typeInField(h, field, value) {
  const wrapper = h.q('form-field', { field })
  const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (wrapper?.querySelector('input, select, textarea'))
  if (!control) throw new Error(`typeInField: no field ${field}`)
  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((o) => plain(o.textContent).trim() === value)
    if (!option) throw new Error(`typeInField: no option ${value} in ${field}`)
    h.select(control, option.value)
  } else {
    control.focus()
    control.value = value
    control.dispatchEvent(new Event('input', { bubbles: true }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await h.frame()
  await h.idle({ quiet: 60 })
}

/**
 * Presses a button of a dialog with a real mouse click (see the header, item 3); resolves true when the
 * button's effect arrived (`done` became true).
 * @param {Harness} h
 * @param {() => HTMLElement | null} find the button (looked up again for every try)
 * @param {() => boolean} done what the press must have done
 * @param {number} [timeout]
 * @returns {Promise<boolean>}
 */
export async function press(h, find, done, timeout = 8000) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const button = find()
    if (!button) break
    await h.window.ensureFront()
    await h.nativeClick(button)
    if (await h.waitFor(done, { timeout: attempt === 0 ? timeout : 2500 })) {
      clicks.real++
      return true
    }
    h.log(`press: the real click ${attempt + 1} had no effect`)
  }
  const button = find()
  if (button) {
    h.click(button)
    clicks.dom++
    return !!(await h.waitFor(done, { timeout }))
  }
  return !!done()
}

/** OK of the form, then waits until the dialog is gone. @param {Harness} h */
export async function pressOk(h) {
  const closed = await press(h, () => h.q('modal-ok'), () => !formDialog(h))
  await h.idle()
  return closed
}

/** Cancel of the form. @param {Harness} h */
export async function pressCancel(h) {
  const closed = await press(h, () => h.q('modal-cancel'), () => !formDialog(h))
  await h.idle()
  return closed
}

// ---------------------------------------------------------------- the suggest widget and the quick pick

/**
 * The rows of Monaco's suggest widget: label, detail text, whether the row has the focus.
 * @returns {{ label: string, detail: string, text: string, focused: boolean }[]}
 */
export function suggestItems() {
  return [...document.querySelectorAll('.suggest-widget .monaco-list-row')].map((row) => ({
    label: plain(row.querySelector('.label-name')?.textContent).trim(),
    detail: plain(row.querySelector('.details-label, .signature-label')?.textContent).trim(),
    text: plain(row.textContent).trim(),
    focused: row.classList.contains('focused'),
  }))
}

/** The rows of the quick pick (label and description). @param {Harness} h */
export function pickRows(h) {
  return h.qa('quick-pick-item').map((element) => ({ element, label: plain(element.querySelector('.label')?.textContent).trim(), description: plain(element.querySelector('.description')?.textContent).trim(), detail: plain(element.querySelector('.detail')?.textContent).trim() }))
}

/**
 * The quick pick, answered by a click on the row whose label is `label`.
 * @param {Harness} h
 * @param {string} label
 */
export async function pickByLabel(h, label) {
  if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 }))) throw new Error('no quick pick opened')
  await h.idle()
  const row = pickRows(h).find((r) => r.label === label)
  if (!row) throw new Error(`pickByLabel: no ${JSON.stringify(label)} in ${JSON.stringify(pickRows(h).map((r) => r.label))}`)
  h.click(row.element)
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await h.idle()
}

/** Closes the quick pick with a real Esc. @param {Harness} h */
export async function pickCancelled(h) {
  await h.window.ensureFront()
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await h.idle()
}

/**
 * The text of the lines of a golden's expected template text with every block number moved by `delta`
 * (the golden is written for `prevBlockNumber` 100).
 * @param {string} expected
 * @param {number} delta
 */
export function shiftNumbers(expected, delta) {
  return expected.replace(/^N(\d+)/gm, (_all, n) => `N${Number(n) + delta}`)
}
