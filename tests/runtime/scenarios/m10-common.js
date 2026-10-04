// Helpers the M10 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Six things are worth knowing before reading a check that uses these:
//
//   1. **The expected answers come from the contract, not from the scripts.** The three M10
//      scripts are written by other work packages, so a scenario cannot read what they do
//      and call it right. What it may hold them to is what the plan and the prelude's
//      READMEs (`tests/fixtures/scripts/{address_arithmetic,program_checks,extents}/README.md`)
//      say: the form ids, the hidden `checkId`/`reason`/`scope`/`axisId` members, the
//      machine sentence, the R8 roles (`tests/fixtures/codes/positions.json`) and the cases
//      the plan names (X8, X11 c). Every other number is worked out from the program text
//      here (`shifted`, `extentsOf`), never typed twice.
//   2. **Numbers are compared as numbers.** Whether a result is written `Z-1.` or `Z-1.0`
//      or `Z-1` is the P1 number format and WP10.4's own goldens; a runtime scenario asks
//      whether the *value* is right, and whether a line that must not change is the same
//      bytes. `canon()` turns every number of a line into its value, so `Q203=+1` and
//      `Q203=1` are one word; a line that is expected unchanged is compared exactly.
//   3. **A refused block is a pass only where the decision says refuse.** R8 (§6 M10 P10
//      item 1): a drilling cycle's tool-axis parameter moves with the axis words, and every
//      other position address arithmetic cannot judge is left as written and listed. What
//      is never right is a cycle moved in part: `outcomeOf()` names the three results
//      (`moved`, `refused`, `partial`) and the scenarios decide which are allowed where.
//   4. **A report is read from the store, not from the screen.** `ctx.results.current`
//      holds the rows exactly as the script wrote them, hidden members included
//      (`checkId`, `scope`, `axisId`); the screen shows only the columns. The envelope of a
//      `replace` script (`text`, `message`, `findings` with their `reason`) is read from the
//      Output panel's structured result, which `m5-scripts-ui` already proves is the
//      envelope the script returned: the app keeps only `line`, `severity` and `message`
//      of a finding in the Results panel.
//   5. **A scenario section never takes the rest down with it.** `guard()` turns an
//      exception into a failed check, so one missing control costs one section and not the
//      other three; the runs on a hosted runner are few, and a run that reports one
//      failure of a dozen is worth more than a run that stops at the first.
//   6. **The machines are made through the service**, as in `m9-numbers`: the page that
//      edits them is `m6-machines-manage`'s and `m8-okuma-units`' business.

import { awaitReport } from '../lib/awaitReport.js'
import { setInput } from './m2-common.js'
import { context, openPath, revealLine } from './m3-common.js'
import { message, newDoc, ready, ribbonTab, selectLines } from './m4-common.js'
import { menuScriptIds, pythonProbe, read, scriptService, showPanel, textOf, undo, writeUserScript } from './m5-common.js'
import { findings as screenFindings } from './m8-common.js'
import { FANUC_LATHE, FANUC_MILL, KLARTEXT, OKUMA, SINUMERIK, SINUMERIK_MILL, openProbe, pickMachine, waitForMachine } from './m9-common.js'

export { FANUC_LATHE, FANUC_MILL, KLARTEXT, OKUMA, SINUMERIK, SINUMERIK_MILL, context, menuScriptIds, message, newDoc, openPath, openProbe, pickMachine, pythonProbe, read, ready, revealLine, ribbonTab, screenFindings, scriptService, selectLines, setInput, showPanel, textOf, undo, waitForMachine, writeUserScript }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The three scripts M10 adds to the bundle. */
export const SCRIPTS = {
  checks: 'bundled:program_checks.py',
  extents: 'bundled:extents.py',
  arithmetic: 'bundled:address_arithmetic.py',
}

/** The six bundled scripts after M10, sorted as the discovery lists them. */
export const BUNDLED_M10 = [
  'bundled:address_arithmetic.py',
  'bundled:extents.py',
  'bundled:program_checks.py',
  'bundled:scale_feed.py',
  'bundled:scale_speed.py',
  'bundled:tool_list.py',
]

/**
 * The check ids `program_checks/README.md` pins, in its order: the ones every profile runs,
 * and the lathe ones (a check that does not apply to the document's profile does not run).
 */
export const CHECKS_GENERAL = ['spindleOff', 'toolChangeSpindle', 'toolChangeInCycle', 'stops', 'programFrame', 'machineReading', 'lowerCase', 'unclosedComments', 'characters']
export const CHECKS_LATHE = ['cssClamp', 'offsetCancelCut', 'profileTargets', 'callInProfile', 'threadUnderCss']

/** The `operation` choices of address arithmetic, in the order its form lists them. */
export const OPERATIONS = ['add', 'subtract', 'multiply', 'divide']

// ---------------------------------------------------------------- sections that cannot take the others down

/**
 * Runs one section of a scenario. An exception becomes a failed check that carries it, so
 * the sections after this one still run (point 5 above).
 * @param {Harness} h
 * @param {string} name
 * @param {() => Promise<void>} body
 */
export async function guard(h, name, body) {
  try {
    await body()
  } catch (error) {
    const text = error instanceof Error ? `${error.message}\n${String(error.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(error)
    h.check(`${name}: the section ran to its end`, false, text.slice(0, 900))
  }
}

// ---------------------------------------------------------------- text helpers

/** A line with every run of white space taken out: "nothing else changed" apart from spacing. */
export const squash = (/** @type {string} */ line) => line.replace(/\s+/g, '')

/**
 * Every number of a line as its value, so the way a result writes it (`+1`, `1.`, `1.0`)
 * does not matter (point 2 above). A plus sign goes; a minus sign is part of the value.
 * @param {string} line
 */
export function canon(line) {
  return line.replace(/[+-]?\d+(?:\.\d*)?|\.\d+/g, (word) => {
    const value = Number(word)
    return Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : word
  })
}

/** The lines of a document text, LF, without the empty one a trailing newline leaves. */
export const linesOfText = (/** @type {string} */ text) => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')

/**
 * The text outside the comments of a line, handed to `fn`, and the comments put back.
 * @param {string} line
 * @param {'paren' | 'semicolon' | 'star'} style
 * @param {(code: string) => string} fn
 */
export function outsideComments(line, style, fn) {
  if (style === 'star' && /^\s*(?:\d+\s+)?\*/.test(line)) return line
  if (style === 'semicolon' || style === 'star') {
    const cut = line.indexOf(';')
    return cut < 0 ? fn(line) : fn(line.slice(0, cut)) + line.slice(cut)
  }
  return line
    .split(/(\([^)]*\))/)
    .map((part, index) => (index % 2 === 1 ? part : fn(part)))
    .join('')
}

/**
 * Adds `delta` to every `letter` word that carries a number, outside comments.
 * @param {string} line
 * @param {'paren' | 'semicolon' | 'star'} style
 * @param {string} letter
 * @param {number} delta
 */
export function bump(line, style, letter, delta) {
  const word = new RegExp(`(?<![A-Za-z0-9_])${letter}([+-]?\\d+(?:\\.\\d*)?)`, 'g')
  return outsideComments(line, style, (code) =>
    code.replace(word, (_all, number) => {
      const value = Math.round((Number(number) + delta) * 1e6) / 1e6
      return `${letter}${value}`
    }),
  )
}

/**
 * What the result of one block is, against the block as it was and as it should be if it
 * moved (point 3 above).
 * @param {string} before
 * @param {string} after
 * @param {string} wanted the block with the shift applied
 * @returns {'unchanged' | 'moved' | 'partial'}
 */
export function outcomeOf(before, after, wanted) {
  if (after === before) return 'unchanged'
  return canon(after) === canon(wanted) ? 'moved' : 'partial'
}

/**
 * Compares a document with the lines it should hold. An unchanged line is compared byte
 * for byte, a changed one by value. Answers the lines that differ.
 * @param {string[]} before
 * @param {string[]} after
 * @param {string[]} wanted
 * @returns {{ line: number, was: string, got: string, want: string }[]}
 */
export function differences(before, after, wanted) {
  /** @type {{ line: number, was: string, got: string, want: string }[]} */
  const out = []
  const count = Math.max(before.length, after.length, wanted.length)
  for (let i = 0; i < count; i++) {
    const was = before[i] ?? '(missing)'
    const got = after[i] ?? '(missing)'
    const want = wanted[i] ?? '(missing)'
    const same = want === was ? got === was : canon(got) === canon(want)
    if (!same) out.push({ line: i + 1, was, got, want })
  }
  return out
}

/**
 * The 1-based line of the first line that matches.
 * @param {string[]} lines
 * @param {RegExp | string} pattern
 * @returns {number} 0 when none does
 */
export function lineWith(lines, pattern) {
  const index = lines.findIndex((line) => (typeof pattern === 'string' ? line.includes(pattern) : pattern.test(line)))
  return index + 1
}

// ---------------------------------------------------------------- forms

/**
 * A choice picked by what its label starts with, else by its place in the list the script's
 * README gives (a choice control's option values are indices, `m4-common.setField`).
 * @param {string} word the value's name, `subtract`
 * @param {number} index its place in the README's list
 */
export const pick = (word, index) => ({ pick: word, index })

/**
 * Fills the controls of the form on screen. A boolean ticks or clears a checkbox, a list of
 * strings sets an address list, `pick()` chooses an option, anything else is typed.
 * @param {Harness} h
 * @param {Record<string, unknown>} values keyed by the field id
 */
export function fillForm(h, values) {
  for (const [field, value] of Object.entries(values)) {
    const wrapper = h.q('form-field', { field })
    if (!wrapper) throw new Error(`the form has no field ${JSON.stringify(field)}; it has ${h.qa('form-field').map((e) => e.dataset.field).join(', ')}`)
    if (Array.isArray(value)) {
      const boxes = /** @type {HTMLInputElement[]} */ ([...wrapper.querySelectorAll('input[type="checkbox"]')])
      // A box is named by its address; a label that adds words after it ("Z (tool axis)") is the same box.
      const nameOf = (/** @type {HTMLInputElement} */ box) => (box.closest('label')?.querySelector('span')?.textContent?.trim() ?? '').split(/\s+/)[0]
      for (const box of boxes) {
        if (box.checked !== value.includes(nameOf(box))) h.click(box)
      }
      const picked = boxes.filter((box) => box.checked).map(nameOf)
      if (JSON.stringify(picked) !== JSON.stringify(value)) throw new Error(`field ${field}: wanted ${JSON.stringify(value)}, the form shows ${JSON.stringify(picked)} of ${JSON.stringify(boxes.map(nameOf))}`)
      continue
    }
    const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (wrapper.querySelector('input, select, textarea'))
    if (!control) throw new Error(`field ${field} has no control`)
    if (typeof value === 'object' && value !== null && 'pick' in value) {
      if (!(control instanceof HTMLSelectElement)) throw new Error(`field ${field} is not a choice`)
      const { pick: word, index } = /** @type {{ pick: string, index: number }} */ (value)
      const options = [...control.options]
      const option = options.find((o) => new RegExp(`^\\s*${word}`, 'i').test(o.textContent ?? '')) ?? options[index]
      if (!option) throw new Error(`field ${field}: no option ${word} in ${options.map((o) => o.textContent?.trim()).join('|')}`)
      h.select(control, option.value)
    } else if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      if (control.checked !== Boolean(value)) h.click(control)
    } else if (control instanceof HTMLSelectElement) {
      const option = [...control.options].find((o) => o.textContent?.trim() === String(value))
      if (!option) throw new Error(`field ${field}: no option ${JSON.stringify(value)}`)
      h.select(control, option.value)
    } else {
      setInput(control, String(value))
    }
  }
}

/** The ids of the form fields on screen. @param {Harness} h */
export const fieldIds = (h) => h.qa('form-field').map((e) => e.dataset.field ?? '')

/**
 * Whether the checkbox of a form field is ticked.
 * @param {Harness} h
 * @param {string} field
 */
export const ticked = (h, field) => /** @type {HTMLInputElement | null} */ (h.q('form-field', { field })?.querySelector('input[type="checkbox"]'))?.checked === true

// ---------------------------------------------------------------- running a script

/**
 * Runs a report script from the Tools tab, the way a user does: the tab, the script's
 * button, the form if it has one, OK. Waits until the Results panel has a report that is not
 * the one from before, and answers it.
 *
 * **A script without a form is told by what does not happen, never by a short wait.** The
 * click is followed by one wait for either the form or the report, for the whole
 * `timeout`: a script with a form shows it within a moment, and a script without one (the
 * extents) shows nothing until it is done, which on a 300,000-line program is a minute or
 * more. The clock of a script without a form starts at the click; with a form, at OK, and
 * each gets the full `timeout`.
 *
 * When the report does not come, the run is cancelled before the error is thrown, so a
 * script that is still going does not overlap the section that follows.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {() => void} [fill] answers the form when the script has one
 * @param {number} [timeout] ms to wait for the report, from the click or from OK
 * @returns {Promise<{ form: boolean, report: import('$lib/app/types').ReportData, ms: number }>}
 */
export async function runFromTools(h, scriptId, fill, timeout = 60000) {
  const ctx = context(h)
  await ribbonTab(h, 'tools')
  const item = await h.waitFor(() => h.q('script-item', { scriptId }), { timeout: 10000 })
  if (!item) throw new Error(`the Tools tab offers no ${scriptId}; it offers ${JSON.stringify(menuScriptIds(h))}`)
  const before = read(ctx.results.current)
  const arrived = () => {
    const current = read(ctx.results.current)
    return current !== before ? current : null
  }
  h.click(item)
  const got = await awaitReport(
    {
      waitFor: (fn, options) => h.waitFor(fn, options),
      now: () => performance.now(),
      formOpen: () => Boolean(h.q('modal')),
      arrived,
      answerForm: () => answerFormAndTime(h, fill ?? (() => {})),
    },
    timeout,
  )
  const { report, ms } = /** @type {{ report: import('$lib/app/types').ReportData | null, ms: number }} */ (got)
  if (!report) {
    const status = message(h)
    await stopRun(h)
    throw new Error(`${scriptId}: no report within ${timeout} ms of ${got.form ? 'OK' : 'the click'}${got.how === 'nothing' ? ' (and no form)' : ''} (status: ${status})`)
  }
  await h.idle()
  return { form: got.form, report, ms }
}

/**
 * Stops the script that is running, if one is, and waits until it has ended, so that what a
 * scenario does next does not share the interpreter with it.
 * @param {Harness} h
 */
export async function stopRun(h) {
  const ctx = context(h)
  const running = () => read(scriptService(h).running) !== null
  if (!running()) return
  await ctx.commands.run('script.cancel')
  await h.waitFor(() => !running(), { timeout: 20000, interval: 50 })
  await h.idle()
}

/**
 * Runs a script that replaces the text (address arithmetic) through the service, answers
 * its form and reads back the envelope from the Output panel.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {() => void} fill
 * @returns {Promise<{ envelope: any, ms: number }>}
 */
export async function runReplace(h, scriptId, fill) {
  const service = scriptService(h)
  const running = service.run(scriptId)
  if (!(await h.waitFor(() => h.q('modal'), { timeout: 20000 }))) throw new Error(`${scriptId}: no form (status: ${message(h)})`)
  const started = (await answerFormAndTime(h, fill)) ?? performance.now()
  await running
  await h.idle()
  const ms = Math.round(performance.now() - started)
  await showPanel(h, 'output')
  const json = await h.waitFor(() => h.q('output-json'), { timeout: 5000 })
  let envelope = null
  try {
    envelope = JSON.parse(json?.textContent ?? 'null')
  } catch {
    envelope = null
  }
  return { envelope, ms }
}

/**
 * Answers the form that is on screen and clicks OK. Says when the click went out, because
 * that is where the clock of a budget starts.
 * @param {Harness} h
 * @param {() => void} fill
 */
async function answerFormAndTime(h, fill) {
  fill()
  await h.frame()
  const at = performance.now()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 15000 })
  return at
}

/**
 * The rows of the report on show, as the script wrote them. @param {Harness} h
 * @returns {Record<string, any>[]}
 */
export const storeRows = (h) => /** @type {Record<string, any>[]} */ (read(context(h).results.current)?.rows ?? [])

/**
 * The report rows on screen that point at a line. @param {Harness} h
 */
export const clickableRows = (h) => h.qa('results-row').filter((e) => (e.dataset.line ?? '') !== '')

// ---------------------------------------------------------------- machines

/**
 * Makes machines through the service and remembers their ids by name. The number rules are
 * the profile's own preset, so a label and its data cannot drift apart here.
 * @param {Harness} h
 */
export function machineMaker(h) {
  const ctx = context(h)
  const machines = /** @type {any} */ (ctx).machines
  /** @type {Record<string, string>} */
  const ids = {}
  /**
   * @param {string} name
   * @param {string} profile
   * @param {string} preset the id of one of the profile's number presets
   * @param {{ units?: 'mm' | 'inch', variants?: Record<string, string> }} [o]
   */
  const add = async (name, profile, preset, o = {}) => {
    const found = ctx.profiles.profile(profile).machineParams?.numberInput?.presets?.find((entry) => entry.id === preset)
    if (found === undefined) throw new Error(`${profile} has no number preset ${preset}`)
    const params = { numberInput: /** @type {any} */ (found.value), units: o.units ?? 'mm', ...(profile === FANUC_MILL ? {} : { diameter: 'on' }), ...(o.variants ? { variants: o.variants } : {}) }
    ids[name] = await machines.add({ name, profile, notes: '', params })
    await h.idle()
  }
  /** Picks a machine for the active document and waits until the status item shows it. @param {string} name */
  const use = async (name) => {
    await pickMachine(h, name)
    await waitForMachine(h, ids[name])
  }
  /** Picks "None" for the active document. */
  const none = async () => {
    await pickMachine(h, 'None (dialect defaults)')
    await waitForMachine(h, '')
  }
  return { ids, add, use, none }
}

// ---------------------------------------------------------------- the program map

/**
 * The tool items of a document's outline with their segments.
 * @param {Harness} h
 * @param {string} docId
 * @returns {{ line: number, endLine: number | undefined, tool: string | undefined }[]}
 */
export function toolSegments(h, docId) {
  const items = /** @type {any[]} */ (read(context(h).outline.items(docId)))
  /** @type {{ line: number, endLine: number | undefined, tool: string | undefined }[]} */
  const out = []
  const walk = (/** @type {any[]} */ list) => {
    for (const item of list) {
      if (item.kind === 'tool') out.push({ line: item.line, endLine: item.endLine, tool: item.tool })
      if (item.children) walk(item.children)
    }
  }
  walk(items)
  return out.sort((a, b) => a.line - b.line)
}

// ---------------------------------------------------------------- the large programs

/**
 * The text of a generated program as lines, for a check that works out an answer from it.
 * @param {string} text CRLF or LF
 */
export const splitLines = (text) => (text.endsWith('\n') ? text.slice(0, text.endsWith('\r\n') ? -2 : -1) : text).split(/\r?\n/)

/**
 * The smallest and largest value of every axis word the program writes, worked out from the
 * text the way the extents script must: absolute `G90`, millimetres, words with a point.
 * Only meant for programs the scenario generated (`largeProgram`), which have none of the
 * things that make the answer harder.
 * @param {string[]} lines
 * @param {string[]} axes
 * @returns {Record<string, { min: number, max: number }>}
 */
export function extentsOf(lines, axes) {
  /** @type {Record<string, { min: number, max: number }>} */
  const out = {}
  for (const line of lines) {
    for (const axis of axes) {
      const found = new RegExp(`(?<![A-Za-z0-9_])${axis}(-?\\d+(?:\\.\\d*)?)`).exec(line)
      if (!found) continue
      const value = Number(found[1])
      const known = out[axis]
      if (!known) out[axis] = { min: value, max: value }
      else {
        if (value < known.min) known.min = value
        if (value > known.max) known.max = value
      }
    }
  }
  return out
}
