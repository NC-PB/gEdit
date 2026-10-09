// Helpers the Phase 2 exit scenarios (`exit2-*`) share. This file registers no scenario:
// `loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Six things are worth knowing before reading a check that uses these:
//
//   1. **The programs and the goldens are `tests/fixtures/exit2/`**, copied once into the run
//      folder (`exitDir`). The README there is the contract: which program, which golden, in
//      which order, what is compared how. A scenario never retypes an expected answer; it reads
//      the golden and compares what the running app shows with it. A golden is read from
//      `expected/`, or from `expected-nopython/` for the run without Python.
//   2. **One scenario per criterion** (X1, X2, X5, X6, X8, X9, X11, X12), in the order of the
//      README. Every scenario starts a fresh app with an empty HOME, so "no machine exists at
//      all" (X1, X2) holds by construction; the rest of the README's order is kept *inside* a
//      scenario where it matters (X8 removes its machines at its end, X9 removes its user files
//      and its machine and reloads, X11 (a) clears the default machine before (b), X12 comes
//      with all its machines defined). X3, X4, X7, X10 and X13 have no file here (README).
//   3. **CRLF.** `fanuc-lathe-a.*` are CRLF on disk and in their goldens. The editor text is
//      LF, so a golden is compared with its CRLF folded to LF (`lf`), and the saved file is
//      compared byte for byte (`sameBytes`).
//   4. **A script run is compared on four things**: the document text (the golden bytes), the
//      end of the status line (the golden `message`), the findings in the Results panel and one
//      undo step back to the input. `runAndCompare` does all four.
//   5. **Hover is compared by its words**, not by its markdown: `mdPlain` strips the markdown
//      the hover provider writes (`**`, `_`, a backslash before punctuation) and each paragraph
//      of the golden must be in the rendered hover.
//   6. **Machines are made through the service** (`ctx.machines.add`, as `m10-common.js`) from
//      the `machine` member of a golden, and chosen through the real picker.

import { setField } from './m4-common.js'
import { context, hoverAt, openPath, revealLine } from './m3-common.js'
import { message, ready, runTransform } from './m4-common.js'
import { pythonProbe, read, runScript, scriptService, undo, writeUserScript } from './m5-common.js'
import { machineItem, machineText, pickMachine, tooltipLine, waitForMachine } from './m6-common.js'
import { findings, goldenFindings, summaryIs } from './m8-common.js'

export { context, findings, goldenFindings, hoverAt, machineItem, machineText, message, openPath, pickMachine, read, ready, revealLine, runScript, runTransform, summaryIs, tooltipLine, undo, waitForMachine, writeUserScript }

/** @typedef {import('../lib/api.js').Harness} Harness */

export const LATHE = 'fanuc-lathe'
export const MILL = 'fanuc-gcode'
export const OKUMA = 'okuma-osp'
export const SINUMERIK = 'sinumerik'

/** `GEDIT_PYTHON` that points at nothing: the run without Python (plan §2.2). */
export const NO_PYTHON = '/nonexistent/python3'

/** The Phase 1 message of a script command when no interpreter is found (`app/scripts.ts`). */
export const NO_PYTHON_MESSAGE = /Python .*not found/

// ---------------------------------------------------------------- the fixtures

/**
 * `tests/fixtures/exit2/` copied into the run folder.
 * @param {Harness} h
 * @returns {Promise<string>} the folder
 */
export async function exitDir(h) {
  // One copy per run: a scenario that runs several criteria in one app (`exit2-nopython`) must not
  // copy the folder over documents it already has open.
  if (copied.run !== h.cfg.run) {
    copied.run = h.cfg.run
    copied.dir = await h.fixture('exit2')
  }
  return copied.dir
}

/** The run the folder was copied for, and where. @type {{ run: string, dir: string }} */
const copied = { run: '', dir: '' }

/**
 * A golden, parsed.
 * @param {Harness} h
 * @param {string} dir
 * @param {string} name file name under `expected/`
 * @returns {Promise<any>}
 */
export async function gold(h, dir, name) {
  return JSON.parse(await h.disk.read(`${dir}/expected/${name}`))
}

/**
 * The text of a golden program, from `expected/` or from `expected-nopython/`.
 * @param {Harness} h
 * @param {string} dir
 * @param {string} name
 * @param {boolean} [noPython]
 * @returns {Promise<string>} the bytes as a string (CRLF kept)
 */
export async function goldText(h, dir, name, noPython = false) {
  return h.disk.read(`${dir}/${noPython ? 'expected-nopython' : 'expected'}/${name}`)
}

/** CRLF folded to LF. @param {string} text */
export const lf = (text) => text.replace(/\r\n/g, '\n')

/**
 * Opens a program of the folder through the dialog.
 * @param {Harness} h
 * @param {string} dir
 * @param {string} name
 */
export async function openIn(h, dir, name) {
  return openPath(h, `${dir}/${name}`)
}

/**
 * Whether two files are the same bytes.
 * @param {Harness} h
 * @param {string} a
 * @param {string} b
 */
export async function sameBytes(h, a, b) {
  return (await h.disk.hex(a)) === (await h.disk.hex(b))
}

/** One line of a document. @param {Harness} h @param {string} id @param {number} line */
export const lineOf = (h, id, line) => context(h).editor.getLines(id, line, line)[0] ?? ''

/** The whole text of the active document, LF. @param {Harness} h */
export const textNow = (h) => h.app.text()

/** Switches to a document and waits for the editor. @param {Harness} h @param {string} id */
export async function activate(h, id) {
  context(h).docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  await h.idle()
}

// ---------------------------------------------------------------- hover

/**
 * What a hover says, in words: the markdown the provider writes without its markup.
 * @param {string} markdown
 * @returns {string[]} the paragraphs
 */
export function mdPlain(markdown) {
  return markdown
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1')
        .replace(/\*\*/g, '')
        .replace(/^_(.*)_$/s, '$1')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((paragraph) => paragraph !== '')
}

/** A string with every run of white space removed, for "the words are there" checks. @param {string} text */
const squashed = (text) => text.replace(/\s+/g, '')

/**
 * Whether a rendered hover holds every paragraph of a golden hover.
 * @param {string} rendered
 * @param {string} markdown
 * @returns {string[]} the paragraphs that are missing
 */
export function hoverMissing(rendered, markdown) {
  const text = squashed(rendered)
  return mdPlain(markdown).filter((paragraph) => !text.includes(squashed(paragraph)))
}

/**
 * Checks the hovers of a golden (`line`, `column`, `markdown`) against the running editor.
 * @param {Harness} h
 * @param {string} id
 * @param {{ line: number, column?: number, lineText?: string, word: string, markdown: string }[]} hovers
 * @param {string} label
 */
export async function checkHovers(h, id, hovers, label) {
  for (const hover of hovers) {
    // The golden's column is the word's first character; the hover is asked for one further in,
    // which is inside every word the goldens name (the same position `m6-lathe-nav` asks).
    const column = hover.column ?? (hover.lineText ?? '').indexOf(hover.word.trim()) + 1
    const rendered = await hoverAt(h, id, hover.line, column + 1)
    const missing = hoverMissing(rendered, hover.markdown)
    h.check(`${label}: hover on ${hover.word.trim()} (line ${hover.line}) says what the golden says`, rendered !== '' && missing.length === 0, { rendered: rendered.slice(0, 300), missing })
  }
}

// ---------------------------------------------------------------- tools

/**
 * The tool rows of the program map as `{ line, text }`, in document order.
 * @param {Harness} h
 */
export function mapTools(h) {
  return h
    .qa('program-map-item')
    .filter((element) => element.dataset.kind === 'tool')
    .map((element) => ({ line: Number(element.dataset.line), text: (element.querySelector('.text')?.textContent ?? '').replace(/\s+/g, ' ').trim() }))
}

/**
 * Steps with a real key press and waits for the cursor to land.
 * @param {Harness} h
 * @param {'F7' | 'Shift+F7'} key
 * @param {number} expected
 */
export async function stepTool(h, key, expected) {
  await h.nativeKeys([{ key: 'F7', mods: key === 'Shift+F7' ? ['shift'] : [] }])
  await h.waitFor(() => h.app.cursor().line === expected, { timeout: 5000 })
  return h.app.cursor().line
}

/**
 * F7 round the tool lines of the golden and Shift+F7 back, with the wrap.
 * @param {Harness} h
 * @param {string} id
 * @param {number[]} toolLines
 * @param {string} label
 */
export async function walkTools(h, id, toolLines, label) {
  const ctx = context(h)
  await h.waitFor(() => JSON.stringify(ctx.outline.toolLines(id)) === JSON.stringify(toolLines), { timeout: 15000 })
  h.check(`${label}: the outline finds exactly the golden tool lines`, JSON.stringify(ctx.outline.toolLines(id)) === JSON.stringify(toolLines), { got: ctx.outline.toolLines(id), want: toolLines })
  await revealLine(h, id, 1, 1)
  h.check(`${label}: the editor has the focus for the key presses`, h.focusEditor())
  const walked = []
  for (const line of toolLines) walked.push(await stepTool(h, 'F7', line))
  h.check(`${label}: F7 visits ${toolLines.join(', ')}`, JSON.stringify(walked) === JSON.stringify(toolLines), walked)
  const wrapped = await stepTool(h, 'F7', toolLines[0])
  h.check(`${label}: F7 wraps to the first tool change`, wrapped === toolLines[0], { cursor: h.app.cursor(), status: message(h) })
  const back = await stepTool(h, 'Shift+F7', toolLines[toolLines.length - 1])
  h.check(`${label}: Shift+F7 wraps to the last`, back === toolLines[toolLines.length - 1], { cursor: h.app.cursor(), status: message(h) })
  const down = []
  for (const line of [...toolLines].reverse().slice(1)) down.push(await stepTool(h, 'Shift+F7', line))
  h.check(`${label}: and steps back through the rest`, JSON.stringify(down) === JSON.stringify([...toolLines].reverse().slice(1)), down)
}

// ---------------------------------------------------------------- scripts

/**
 * Runs a bundled `replace` script with the fields of its form, compares the document with the
 * golden, the status line's end with the golden message and the Results findings with the
 * golden's, then takes the run back with one undo and checks the input is back.
 * @param {Harness} h
 * @param {object} o
 * @param {string} o.id the document
 * @param {string} o.scriptId
 * @param {Record<string, string | number | boolean>} [o.fields]
 * @param {string} o.golden the expected text (CRLF or LF)
 * @param {any} o.report `{ message, findings }`
 * @param {string} o.label
 * @param {boolean} [o.undoAfter] default true
 */
export async function runAndCompare(h, { id, scriptId, fields, golden, report, label, undoAfter = true }) {
  const input = textNow(h)
  await runScript(h, scriptId, { form: true, fields: fields ?? {} })
  const got = textNow(h)
  h.check(`${label}: the document is the golden`, got === lf(golden), { diff: firstDifference(got, lf(golden)) })
  h.check(`${label}: the status line ends with the golden summary`, summaryIs(h, report.message), { got: message(h), want: report.message })
  h.check(`${label}: the findings are the golden's`, JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(report.findings)), { got: findings(h), want: goldenFindings(report.findings) })
  if (undoAfter) {
    await undo(h)
    h.check(`${label}: one undo takes the whole run back`, textNow(h) === input, { dirty: context(h).docs.get(id)?.dirty, diff: firstDifference(textNow(h), input) })
  }
}

/**
 * The first line that differs between two texts, for a failing check's detail.
 * @param {string} a
 * @param {string} b
 */
export function firstDifference(a, b) {
  if (a === b) return null
  const x = a.split('\n')
  const y = b.split('\n')
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return { line: i + 1, got: x[i], want: y[i], gotLines: x.length, wantLines: y.length }
  return null
}

/**
 * What a script command shows when no interpreter exists: the Phase 1 message, and the
 * document is as it was.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {string} id the document
 * @param {string} label
 * @param {Record<string, string | number | boolean>} [fields]
 */
export async function expectNoPython(h, scriptId, id, label, fields) {
  const before = textNow(h)
  const dirtyBefore = context(h).docs.get(id)?.dirty === true
  const running = scriptService(h).run(scriptId)
  // The Phase 1 message may come before the form or after it: take whichever happens.
  const first = await Promise.race([running.then(() => 'done'), h.waitFor(() => h.q('modal'), { timeout: 15000 }).then((m) => (m ? 'form' : 'timeout'))])
  if (first === 'form') {
    for (const [field, value] of Object.entries(fields ?? {})) setField(h, field, value)
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  }
  await running
  await h.idle()
  const status = message(h)
  const alert = await h.alert.visible().catch(() => null)
  if (alert !== null) {
    h.log(`${label}: an alert is up: ${JSON.stringify(alert)}`)
    await h.alert.click('OK|Ok').catch(() => {})
  }
  h.check(`${label}: says that Python was not found`, NO_PYTHON_MESSAGE.test(status) || alert !== null, { status, alert, first })
  h.check(`${label}: and changed nothing`, textNow(h) === before && (context(h).docs.get(id)?.dirty === true) === dirtyBefore, { dirty: context(h).docs.get(id)?.dirty })
}

/**
 * The tool list of the active document: its rows by the golden's columns, its message in the
 * panel and its findings. A report changes nothing.
 * @param {Harness} h
 * @param {any} toolList the golden's `toolList`
 * @param {string} label
 */
export async function checkToolList(h, toolList, label) {
  const before = textNow(h)
  await runScript(h, 'bundled:tool_list.py', { form: true })
  await h.waitFor(() => h.qa('results-row').length > 0, { timeout: 30000 })
  const columns = toolList.columns.map((/** @type {any} */ c) => c.key)
  const shown = h.qa('results-row')[0] ? [...h.qa('results-row')[0].querySelectorAll('.cell')].map((cell) => /** @type {HTMLElement} */ (cell).dataset.column) : []
  h.check(`${label}: the tool list has the golden columns`, JSON.stringify(shown) === JSON.stringify(columns), { got: shown, want: columns })
  const rows = h.qa('results-row').map((row) => columns.map((/** @type {string} */ key) => row.querySelector(`.cell[data-column="${key}"]`)?.textContent?.trim() ?? '').join('|'))
  const want = toolList.rows.map((/** @type {any} */ row) => columns.map((/** @type {string} */ key) => String(row[key] ?? '')).join('|'))
  h.check(`${label}: and the golden rows`, JSON.stringify(rows) === JSON.stringify(want), { got: rows, want })
  h.check(`${label}: the panel heads the table with the golden summary`, (h.q('results-panel')?.textContent ?? '').includes(toolList.message), { panel: h.q('results-panel')?.textContent?.trim().slice(0, 160), want: toolList.message })
  h.check(`${label}: and lists the golden findings`, JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(toolList.findings)), { got: findings(h), want: goldenFindings(toolList.findings) })
  h.check(`${label}: a report changes nothing`, textNow(h) === before, null)
}

// ---------------------------------------------------------------- the machine item

/**
 * The effective value a golden's `variants` names, read off the tooltip the way the user reads
 * it: `G-code system: G-code system A — detected in this program`.
 * @param {Harness} h
 * @param {string} label the tooltip's label, `G-code system`
 * @param {string} choice the choice's label, `G-code system A`
 * @param {'detected' | 'profile' | 'machine'} source
 */
export function variantLine(h, label, choice, source) {
  const ending = { detected: 'detected in this program', profile: 'dialect default, assumed', machine: 'set by the machine' }[source]
  return { line: tooltipLine(h, label), want: `${label}: ${choice} — ${ending}` }
}

/** The effective machine's attributes off the status item. @param {Harness} h */
export const machineState = (h) => ({ text: machineText(h), id: machineItem(h)?.dataset.machineId, choice: machineItem(h)?.dataset.choice, assumed: machineItem(h)?.dataset.assumed })

// ---------------------------------------------------------------- machines

/**
 * Makes a machine from a golden's `machine` member through the service.
 * @param {Harness} h
 * @param {{ name: string, profile: string, notes?: string, params: object }} spec
 * @returns {Promise<string>} the id
 */
export async function makeMachine(h, spec) {
  const machines = /** @type {any} */ (context(h)).machines
  const id = await machines.add({ name: spec.name, profile: spec.profile, notes: spec.notes ?? '', params: structuredClone(spec.params) })
  await h.idle()
  return id
}

/**
 * Picks a machine of the golden for the active document and waits for the status item.
 * @param {Harness} h
 * @param {string} id
 * @param {string} name
 */
export async function useMachine(h, id, name) {
  await pickMachine(h, name)
  await waitForMachine(h, id)
}

/** Picks "None" for the active document. @param {Harness} h */
export async function useNone(h) {
  await pickMachine(h, 'None (dialect defaults)')
  await waitForMachine(h, '')
}

/**
 * Removes a machine by id through the service.
 * @param {Harness} h
 * @param {string} id
 */
export async function removeMachine(h, id) {
  await /** @type {any} */ (context(h)).machines.remove(id)
  await h.idle()
}

// ---------------------------------------------------------------- reports of user scripts

/**
 * Compares the report the Results panel holds with a golden report: title, columns, rows, and
 * (when the golden has them) the summary message and the findings the panel lists.
 * @param {Harness} h
 * @param {{ title: string, columns: any[], rows: any[], message?: string, findings?: any[] }} want
 * @param {string} label
 */
export function checkStoredReport(h, want, label) {
  const got = /** @type {any} */ (read(context(h).results.current))
  h.check(`${label}: the title`, got?.title === want.title, { got: got?.title, want: want.title })
  h.check(`${label}: the columns`, JSON.stringify(got?.columns?.map((/** @type {any} */ c) => [c.key, c.label])) === JSON.stringify(want.columns.map((c) => [c.key, c.label])), { got: got?.columns, want: want.columns })
  const rows = (got?.rows ?? []).map((/** @type {any} */ row) => JSON.stringify(row))
  const wanted = want.rows.map((row) => JSON.stringify(row))
  h.check(`${label}: and every row (${want.rows.length})`, JSON.stringify(rows) === JSON.stringify(wanted), { got: (got?.rows ?? []).slice(0, 3), want: want.rows.slice(0, 3), count: got?.rows?.length, wantCount: want.rows.length, firstDifferent: rows.findIndex((/** @type {string} */ r, /** @type {number} */ i) => r !== wanted[i]) })
  if (want.message !== undefined) h.check(`${label}: the summary line`, got?.message === want.message, { got: got?.message, want: want.message })
  if (want.findings !== undefined) h.check(`${label}: the findings the panel lists`, JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(want.findings)), { got: findings(h), want: goldenFindings(want.findings) })
}

/**
 * Clicks every row of the report on show that names a line and checks the cursor lands on it.
 * @param {Harness} h
 * @param {string} label
 */
export async function everyRowJumps(h, label) {
  const rows = h.qa('results-row').filter((e) => (e.dataset.line ?? '') !== '')
  /** @type {string[]} */
  const wrong = []
  for (const row of rows) {
    const line = Number(row.dataset.line)
    context(h).editor.reveal(context(h).docs.getActiveId() ?? '', line === 1 ? 2 : 1, 1)
    await h.idle()
    h.click(row)
    const landed = await h.waitFor(() => h.app.cursor().line === line, { timeout: 3000 })
    if (landed !== true) wrong.push(`line ${line} -> ${h.app.cursor().line}`)
  }
  h.check(`${label}: every row with a line jumps to it (${rows.length} rows)`, rows.length > 0 ? wrong.length === 0 : true, wrong)
  return rows.length
}

/** Sets one control of the form on screen. @param {Harness} h @param {string} field @param {string | number | boolean} value */
export const setFormField = (h, field, value) => setField(h, field, value)

// ---------------------------------------------------------------- the tokenizer's unknown tokens

/**
 * A user script that lists the tokenizer's `unknown` tokens of the document (comments are a
 * token kind of their own, so "outside comments" holds by construction), then one marker row.
 */
export const UNKNOWN_TOKENS = `# /// gedit
# name = "Exit2 unknown tokens"
# description = "Lists the tokens the tokenizer reads as unknown."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's Phase 2 exit criteria (X2). Not a bundled script."""

import gedit_nc

ctx = gedit_nc.load_context()
cp = gedit_nc.compile_profile(ctx.get("profile") or {})
rows = []
state = None
lines = gedit_nc.read_input()
for number, line in enumerate(lines, 1):
    tokens, state = gedit_nc.tokenize_line(line, cp, state)
    for token in tokens:
        if token.kind == "unknown":
            rows.append({"line": str(number), "text": token.text})
rows.append({"line": "end", "text": "%d lines" % len(lines)})
gedit_nc.report("Unknown tokens", [{"key": "line", "label": "Line"}, {"key": "text", "label": "Token"}], rows)
`

/**
 * Runs the unknown-token script on the active document and answers the tokens it listed.
 * @param {Harness} h
 * @param {string} scriptId
 * @returns {Promise<string[]>} `line:text`
 */
export async function unknownTokens(h, scriptId) {
  const before = read(context(h).results.current)
  await runScript(h, scriptId)
  const rows = await h.waitFor(() => {
    const report = /** @type {any} */ (read(context(h).results.current))
    const list = report?.rows ?? []
    return report !== before && list.length > 0 && list[list.length - 1].line === 'end' ? list : null
  }, { timeout: 30000 })
  return (rows ?? []).filter((/** @type {any} */ r) => r.line !== 'end').map((/** @type {any} */ r) => `${r.line}:${r.text}`)
}

/**
 * The painted tokens of a document that are drawn in the `invalid` colour, sampled every
 * ten lines as `m8-okuma` does.
 * @param {Harness} h
 * @param {string} id
 * @param {string} invalidColor `rgb(...)`
 * @returns {Promise<string[]>}
 */
export async function invalidPainted(h, id, invalidColor) {
  /** @type {string[]} */
  const marked = []
  const count = context(h).editor.getLineCount(id)
  for (let line = 1; line <= count; line += 10) {
    await revealLine(h, id, Math.min(line, count), 1)
    for (const span of h.q('editor-host')?.querySelectorAll('.view-lines .view-line span > span') ?? []) {
      if (getComputedStyle(span).color === invalidColor) marked.push(`${line}: ${(span.textContent ?? '').replace(/ /g, ' ')}`)
    }
  }
  return marked
}

// ---------------------------------------------------------------- your own profiles and code files

/**
 * The user-config folders of this run: `<config>/profiles` and `<config>/codes`.
 * @param {Harness} h
 * @returns {{ profilesDir: string, codesDir: string }}
 */
export function userDirs(h) {
  const paths = /** @type {any} */ (read(context(h).settings.paths))
  if (!paths?.profilesDir || !paths?.codesDir) throw new Error(`settings.paths has no profilesDir/codesDir: ${JSON.stringify(paths)}`)
  return { profilesDir: paths.profilesDir, codesDir: paths.codesDir }
}

/** Reloads both folders through the command a user has (Reload Profiles). @param {Harness} h */
export async function reloadProfiles(h) {
  await context(h).commands.run('profile.reload')
  await h.idle()
}

/**
 * Deletes one of the user's files through the backend command the Profiles page uses.
 * @param {Harness} h
 * @param {'profiles' | 'codes'} kind
 * @param {string} name
 */
export async function deleteUserFile(h, kind, name) {
  await h.invoke('user_file_delete', { kind, name })
}

/**
 * Opens Settings on the Profiles tab (Manage Profiles…) and waits for the page.
 * @param {Harness} h
 * @returns {Promise<{ closed: Promise<unknown> }>}
 */
export async function openProfilesPage(h) {
  const closed = context(h).commands.run('profile.manage')
  if (!(await h.waitFor(() => h.q('settings-profiles'), { timeout: 10000 }))) throw new Error('Settings > Profiles did not open')
  await h.idle()
  return { closed }
}

/**
 * Closes the settings dialog with Cancel.
 * @param {Harness} h
 * @param {{ closed: Promise<unknown> }} opened
 */
export async function closeProfilesPage(h, opened) {
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !h.q('modal', { modal: 'settings' }), { timeout: 8000 })
  await opened.closed
  await h.idle()
}

/** The rows of the Profiles page. @param {Harness} h */
export function profileRows(h) {
  return h.qa('profile-row').map((element) => ({
    element,
    id: element.dataset.profileId ?? '',
    origin: element.dataset.origin ?? '',
    kind: element.dataset.kind ?? '',
    file: element.dataset.file ?? '',
    problems: Number(element.dataset.problems ?? '0'),
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    problemTexts: [...element.querySelectorAll('.problem')].map((p) => (p.textContent ?? '').trim()),
  }))
}

/** A `profile-action` button by its action (and kind), optionally inside a row. @param {Harness} h @param {string} action @param {{ row?: Element, kind?: string }} [o] */
export function profileAction(h, action, o = {}) {
  const scope = o.row ?? document
  return /** @type {HTMLElement[]} */ ([...scope.querySelectorAll('[data-testid="profile-action"]')]).find((e) => e.dataset.action === action && (o.kind === undefined || e.dataset.kind === o.kind))
}

/**
 * The interpreter probe's answer (`ok: false` when none was found), or null while it has not answered.
 * @param {Harness} h
 */
export const pythonStatus = (h) => pythonProbe(h)

/** `machines.json` as the backend reads it (null while it does not exist), untyped. @param {Harness} h @returns {Promise<any>} */
export const machinesNow = async (h) => /** @type {any} */ (await h.config.read('machines.json'))
