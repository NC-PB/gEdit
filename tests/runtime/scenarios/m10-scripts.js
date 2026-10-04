// The program checks and the extents, from the Tools tab (plan §6 M10 H10 `m10-scripts`,
// WP10.2, WP10.3; X8, X11 c: "program_check reports X50 as no decimal point: 0.050 mm").
//
// **What a runtime scenario can say about a script it did not write.** The goldens of both
// scripts are Python's (`tests/python/test_program_checks.py`, `test_extents.py`); what
// only the app can add is the way a user meets them: the button on the Tools tab, the form
// with one box per check, the table in the Results panel, and the click on a row that takes
// the cursor to its line. So the programs here are small, written to have one answer that
// follows from the plan and the READMEs of the two fixture folders - a cut with the spindle
// never started is a finding on the line of the cut, `M0` and `M1` are listed, an arc over
// the top of a circle reaches the radius above its centre - and the check is made on the
// rows as the script wrote them, hidden `checkId`, `scope` and `axisId` included.
//
// **A check that cries wolf is worse than none** (§6 M10): the clean program has no
// warning and no error, whatever it lists as information.
//
// **The machine decides what a point-less word is** (AD-31, X11 c). `l06-decimal.nc` is
// read three ways: under "Lathe IS-B" (increments of 0.001 mm) the check names the value
// `X50` is read as, under "Lathe calc" (calculator-type input) it has nothing to say, and
// with no machine it lists the readings. The extents are the same story told in numbers: a
// word with no resolved value is counted as not resolved, never guessed.
//
// The ids of the checks and the members of a row are the ones the READMEs pin. What is
// WP10.2's and WP10.3's own - the label of a check, the exact words of a finding - is not
// asserted beyond the numbers and names the plan puts in quotation marks.

import { scenario } from '../lib/index.js'
import {
  CHECKS_GENERAL,
  CHECKS_LATHE,
  FANUC_LATHE,
  FANUC_MILL,
  SCRIPTS,
  clickableRows,
  context,
  fieldIds,
  fillForm,
  guard,
  machineMaker,
  menuScriptIds,
  message,
  newDoc,
  openPath,
  pick,
  read,
  ready,
  ribbonTab,
  runFromTools,
  screenFindings,
  scriptService,
  showPanel,
  storeRows,
  ticked,
  writeUserScript,
} from './m10-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** Line 6 cuts with no spindle ever started; lines 9 and 10 are the optional and the program stop. */
const CHECKS_PROGRAM = [
  '%',
  'O5100 (CHECKS)',
  'G21 G17 G40 G49 G80 G90 G94',
  'T1 M6',
  'G0 X0. Y0.',
  'G1 Z-2. F200.',
  'S3000 M3',
  'G1 X10. F300.',
  'M0',
  'M1',
  'G0 Z25.',
  'M5',
  'M30',
  '%',
  '',
].join('\n')

/** Nothing in it for a check to find. */
const CLEAN_PROGRAM = [
  '%',
  'O5300 (CLEAN)',
  'G21 G17 G40 G49 G80 G90 G94',
  'T1 M6',
  'S3000 M3',
  'G54',
  'G0 X0. Y0.',
  'G43 Z25. H1 M8',
  'G1 Z-2. F200.',
  'X40. F800.',
  'G0 Z25.',
  'M9',
  'M5',
  'M30',
  '%',
  '',
].join('\n')

/** Two half circles about (5, 0): over the top (line 8), under the bottom (line 9). */
const EXTENTS_PROGRAM = [
  '%',
  'O5200 (EXTENTS)',
  'G21 G17 G90 G94',
  'T1 M6',
  'S1000 M3',
  'G0 X0. Y0. Z5.',
  'G1 Z-1. F100.',
  'G2 X10. Y0. I5. J0.',
  'G2 X0. Y0. I-5. J0.',
  'G0 Z5.',
  'M30',
  '%',
  '',
].join('\n')

/** A report script with no parameters, for the plumbing section. */
const NO_FORM_REPORT = `# /// gedit
# name = "Harness no-form report"
# description = "A report with no parameters."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H10). Not a bundled script."""

import gedit_nc

gedit_nc.report("No form", [{"key": "line", "label": "Line"}, {"key": "scope", "label": "Scope"}], [{"line": 3, "scope": "noform"}])
`

/**
 * A report script whose form has the three kinds of control address arithmetic uses - a
 * choice, a number and an address list - and which reports the parameters it was handed, so
 * `fillForm` is proved on the way from the control to the script before the new scripts rely
 * on it. The address list carries its `choices` in the header: a script form is not handed the
 * profile's addresses (`app/scripts.ts` passes no `context`), so a list without them shows none.
 */
const FORM_ECHO = `# /// gedit
# name = "Harness form echo"
# description = "Reports the parameters it was handed."
# input = "document"
# output = "report"
#
# [[params]]
# id = "operation"
# type = "choice"
# label = "Operation"
# default = "add"
# choices = [
#   { label = "Add", value = "add" },
#   { label = "Subtract", value = "subtract" },
#   { label = "Multiply", value = "multiply" }
# ]
#
# [[params]]
# id = "operand"
# type = "number"
# label = "Operand"
# default = 1
#
# [[params]]
# id = "addresses"
# type = "address-list"
# label = "Addresses"
# default = ["X"]
# choices = [{ label = "X", value = "X" }, { label = "Y", value = "Y" }, { label = "Z", value = "Z" }]
# ///
"""Written for gEdit's runtime harness (H10). Not a bundled script."""

import json

import gedit_nc

ctx = gedit_nc.load_context()
gedit_nc.report("Form echo", [{"key": "params", "label": "Parameters"}], [{"params": json.dumps(ctx.get("params"), sort_keys=True)}])
`

/** Ticks every check box of the form that is on screen. @param {Harness} h */
function tickAll(h) {
  for (const field of fieldIds(h)) {
    if (h.q('form-field', { field })?.querySelector('input[type="checkbox"]') && !ticked(h, field)) fillForm(h, { [field]: true })
  }
}

/** The rows of the report on show that belong to one check. @param {Harness} h @param {string} id */
const rowsOf = (h, id) => storeRows(h).filter((row) => row.checkId === id)
/** The findings about a spindle that is not running when the program cuts: `spindleOff` and `toolChangeSpindle`. @param {Harness} h */
const spindleRows = (h) => storeRows(h).filter((row) => row.checkId === 'spindleOff' || row.checkId === 'toolChangeSpindle')

scenario('m10-scripts', { timeout: 540 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const maker = machineMaker(h)
  await guard(h, 'the machines', async () => {
    await maker.add('Lathe IS-B', FANUC_LATHE, 'is-b')
    await maker.add('Lathe calc', FANUC_LATHE, 'calculator')
  })

  // =============================================================== 0. the plumbing, proved on a Phase 1 report script
  //
  // Everything below runs a script the way this section does. `tool_list` is a bundled
  // report script that has shipped since M4, so this part of the scenario passes whether or
  // not the M10 scripts are there, and a failure further down that this section did not
  // share is the script's, not the harness's.
  await guard(h, '0. the plumbing', async () => {
    const docId = await newDoc(h, CHECKS_PROGRAM, FANUC_MILL)
    const run = await runFromTools(h, 'bundled:tool_list.py', () => {})
    await showPanel(h, 'results')
    const rows = storeRows(h)
    const clickable = clickableRows(h)
    h.check('the plumbing: a report script run from the Tools tab leaves its rows in the store, and the program alone', run.form === true && rows.length === 1 && h.app.text() === CHECKS_PROGRAM, { form: run.form, rows: rows.length })
    h.check('and each row that names a line is a button on the screen', clickable.length === rows.filter((r) => Number.isInteger(r.line)).length && clickable.length === 1, { buttons: clickable.length, line: rows[0]?.line })
    if (clickable[0]) {
      ctx.editor.reveal(docId, 1, 1)
      await h.idle()
      h.click(clickable[0])
      await h.waitFor(() => h.app.cursor().line === Number(clickable[0].dataset.line), { timeout: 5000 })
      h.check('the plumbing: a click on a row puts the cursor on its line', h.app.cursor().line === Number(clickable[0].dataset.line) && h.app.cursor().line > 1, h.app.cursor())
    }

    // The form controls address arithmetic uses (a choice, a number, an address list), proved on
    // a user script that reports the parameters it was handed.
    const echo = await writeUserScript(h, 'rh_form_echo.py', FORM_ECHO)
    await runFromTools(h, echo, () => fillForm(h, { operation: pick('subtract', 1), operand: 0.5, addresses: ['Z'] }))
    /** @type {any} */
    let echoed = null
    try {
      echoed = JSON.parse(String(storeRows(h)[0]?.params ?? 'null'))
    } catch {
      echoed = null
    }
    h.check('the plumbing: a choice, a number and an address list filled with fillForm arrive in the script as subtract, 0.5 and ["Z"]', echoed?.operation === 'subtract' && echoed?.operand === 0.5 && JSON.stringify(echoed?.addresses) === '["Z"]', { echoed, rows: storeRows(h) })

    // A report script with no parameters runs from its button at once, with no form: the way
    // the extents may, and where the clock of a budget has to start at the click.
    const id = await writeUserScript(h, 'rh_noform_report.py', NO_FORM_REPORT)
    const quick = await runFromTools(h, id, undefined, 30000)
    h.check('the plumbing: a script with no form runs from the Tools tab at once and its report reaches the store', quick.form === false && storeRows(h).length === 1 && storeRows(h)[0].scope === 'noform' && quick.ms >= 0, { form: quick.form, rows: storeRows(h) })
  })

  // =============================================================== A. the Tools tab
  await guard(h, 'A. the Tools tab', async () => {
    await newDoc(h, CHECKS_PROGRAM, FANUC_MILL)
    await ribbonTab(h, 'tools')
    const ids = menuScriptIds(h)
    h.check('the Tools tab offers program checks, extents and address arithmetic for a Fanuc program', Object.values(SCRIPTS).every((id) => ids.includes(id)), ids)
    const items = h.qa('script-item').filter((e) => Object.values(SCRIPTS).includes(e.getAttribute('data-script-id') ?? ''))
    h.check('each carries its own run command and a description as the tooltip', items.length === 3 && items.every((e) => (e.getAttribute('data-command') ?? '').startsWith('script.run:') && (e.getAttribute('title') ?? '').length > (e.textContent ?? '').trim().length), items.map((e) => [e.getAttribute('data-command'), e.getAttribute('title')]))
    const listed = read(scriptService(h).list).filter((/** @type {any} */ e) => Object.values(SCRIPTS).includes(e.id))
    h.check('the bundled headers parsed with no warning, and none is editable', listed.length === 3 && listed.every((/** @type {any} */ e) => e.headerError === null && e.meta !== null && e.meta.warnings.length === 0 && e.editable === false), listed.map((/** @type {any} */ e) => ({ id: e.id, err: e.headerError, warnings: e.meta?.warnings })))
    const params = listed.find((/** @type {any} */ e) => e.id === SCRIPTS.checks)?.meta?.params ?? []
    h.check('program checks declare one bool parameter per check, every one on by default', params.length >= CHECKS_GENERAL.length && params.every((/** @type {any} */ p) => p.type === 'bool' && p.default === true) && CHECKS_GENERAL.every((id) => params.some((/** @type {any} */ p) => p.id === id)), params.map((/** @type {any} */ p) => `${p.id}:${p.type}:${p.default}`))
    h.check('address arithmetic is a replacement with an envelope, and its form ids are the ones its README pins', listed.find((/** @type {any} */ e) => e.id === SCRIPTS.arithmetic)?.meta?.envelope === true && ['operation', 'operand', 'addresses', 'arcCentres', 'xOperand', 'decimals'].every((id) => (listed.find((/** @type {any} */ e) => e.id === SCRIPTS.arithmetic)?.meta?.params ?? []).some((/** @type {any} */ p) => p.id === id)), (listed.find((/** @type {any} */ e) => e.id === SCRIPTS.arithmetic)?.meta?.params ?? []).map((/** @type {any} */ p) => p.id))
    h.check('and they are reports or replacements as the plan says: checks and extents report, arithmetic replaces', listed.find((/** @type {any} */ e) => e.id === SCRIPTS.checks)?.meta?.output === 'report' && listed.find((/** @type {any} */ e) => e.id === SCRIPTS.extents)?.meta?.output === 'report' && listed.find((/** @type {any} */ e) => e.id === SCRIPTS.arithmetic)?.meta?.output === 'replace', listed.map((/** @type {any} */ e) => `${e.id}:${e.meta?.output}`))
  })

  // =============================================================== B. program checks on a program with something to find
  await guard(h, 'B. program checks', async () => {
    const docId = await newDoc(h, CHECKS_PROGRAM, FANUC_MILL)
    const before = h.app.text()
    const run = await runFromTools(h, SCRIPTS.checks, () => {
      const ids = fieldIds(h)
      h.check('the form has one box per check, and the general checks are all there', CHECKS_GENERAL.every((id) => ids.includes(id)), ids)
      h.check('every box is ticked: all checks are on by default', ids.length > 0 && ids.every((id) => ticked(h, id)), ids.filter((id) => !ticked(h, id)))
    })
    h.check('the run answered with a form', run.form === true)
    await showPanel(h, 'results')
    const rows = storeRows(h)
    h.check('a report-mode script leaves the program alone', h.app.text() === before)
    h.check('the report has rows, each with a check id, a severity and a message, and a line where it points into the program', rows.length > 0 && rows.every((r) => typeof r.checkId === 'string' && ['error', 'warning', 'info'].includes(r.severity) && (r.line === undefined || r.line === null || (Number.isInteger(r.line) && r.line >= 1)) && typeof r.message === 'string' && r.message.length > 0), rows.slice(0, 5))
    const withLine = rows.filter((r) => Number.isInteger(r.line))
    h.check('they are in line order', withLine.every((r, i) => i === 0 || withLine[i - 1].line <= r.line), withLine.map((r) => r.line))
    // The cut follows a tool change (T1 M6) with no spindle start between: a machining centre's
    // tool change stops the spindle, so the script words it as `toolChangeSpindle` (the more
    // specific of the two checks, one finding per cut); a program without the tool change gets
    // `spindleOff`. Either is "a cut with no spindle started"; Python's goldens pin which.
    const spindle = spindleRows(h)
    h.check('the cut with no spindle started - G1 Z-2. F200. - is a spindle finding on line 6 (spindleOff, or toolChangeSpindle after the tool change)', spindle.some((r) => r.line === 6 && r.severity !== 'info'), spindle)
    h.check('and the cut after S3000 M3 is not one', !spindle.some((r) => r.line >= 7), spindle)
    const stops = rowsOf(h, 'stops')
    h.check('M0 and M1 are listed as information, on lines 9 and 10', stops.length === 2 && stops.some((r) => r.line === 9) && stops.some((r) => r.line === 10) && stops.every((r) => r.severity === 'info'), stops)
    h.check('the report says there is no machine, last', /No machine/i.test(String(read(ctx.results.current)?.message ?? '')), read(ctx.results.current)?.message)

    const clickable = clickableRows(h)
    h.check('every row that names a line is a button on the screen', clickable.length === rows.filter((r) => Number.isInteger(r.line)).length && clickable.length > 0, { buttons: clickable.length, rows: rows.length })
    const spindleButton = clickable.find((e) => e.dataset.line === '6')
    h.check('the spindle row is there to click', !!spindleButton, clickable.map((e) => e.dataset.line))
    if (spindleButton) {
      ctx.editor.reveal(docId, 1, 1)
      await h.idle()
      h.click(spindleButton)
      await h.waitFor(() => h.app.cursor().line === 6, { timeout: 5000 })
      h.check('a click on the row jumps to its line', h.app.cursor().line === 6, h.app.cursor())
      h.check('and names the document it points into', (spindleButton.dataset.docId ?? '') === docId, spindleButton.dataset.docId)
    }

    // ---- a box switched off: that check does not run
    await runFromTools(h, SCRIPTS.checks, () => {
      tickAll(h)
      fillForm(h, { stops: false })
    })
    h.check('with the M0/M1 box cleared there is no stops row, and the spindle finding is still there', rowsOf(h, 'stops').length === 0 && spindleRows(h).some((r) => r.line === 6), storeRows(h).map((r) => `${r.checkId}@${r.line}`))
    h.check('a run is still not an edit: the program is as it was', h.app.text() === before)
    await runFromTools(h, SCRIPTS.checks, () => tickAll(h))
  })

  // =============================================================== C. a correct program has no finding
  await guard(h, 'C. a correct program', async () => {
    await newDoc(h, CLEAN_PROGRAM, FANUC_MILL)
    await runFromTools(h, SCRIPTS.checks, () => tickAll(h))
    const rows = storeRows(h)
    const loud = rows.filter((r) => r.severity === 'warning' || r.severity === 'error')
    h.check('a correct program gets no warning and no error from any check (a check that cries wolf is worse than none)', loud.length === 0, loud)
    h.log(`clean program: ${rows.length} rows, ${JSON.stringify(rows.map((r) => `${r.checkId}@${r.line}`))}`)
  })

  // =============================================================== D. the decimal point under three machines
  await guard(h, 'D. the decimal point', async () => {
    const opened = await openPath(h, await h.fixture('nc/fanuc-lathe/l06-decimal.nc'))
    h.check('l06-decimal.nc opens as a Fanuc lathe program', ctx.docs.get(opened.id)?.profileId === FANUC_LATHE, ctx.docs.get(opened.id)?.profileId)
    const lines = h.app.text().split('\n')
    const wordLine = lines.findIndex((line) => line.startsWith('G00 X50 Z1000')) + 1
    h.check('and line ' + wordLine + ' is G00 X50 Z1000, the point-less pair', wordLine > 0, wordLine)

    await maker.use('Lathe IS-B')
    await runFromTools(h, SCRIPTS.checks, () => {
      h.check('on a lathe the form also offers the lathe checks', CHECKS_LATHE.every((id) => fieldIds(h).includes(id)), fieldIds(h))
      tickAll(h)
    })
    const isb = rowsOf(h, 'machineReading')
    h.check('under IS-B (increments of 0.001 mm) X50 is reported with the value it is read as: 0.050 mm', isb.some((r) => r.line === wordLine && /0\.05\b/.test(String(r.message)) && /X50/.test(String(r.message))), isb)
    h.check('the finding names the machine', isb.some((r) => /Lathe IS-B/.test(String(r.message))) || /Machine 'Lathe IS-B'/.test(String(read(ctx.results.current)?.message ?? '')), { rows: isb.map((r) => r.message), message: read(ctx.results.current)?.message })
    h.check('and the pointed words below it (X50. Z1000. and Z-10.) are not reported: they mean the same on every machine', !isb.some((r) => r.line === wordLine + 2 || r.line === wordLine + 3), isb.map((r) => r.line))

    await maker.use('Lathe calc')
    await runFromTools(h, SCRIPTS.checks, () => tickAll(h))
    h.check('under calculator-type input the machine reads every literal one way: no decimal-point finding', rowsOf(h, 'machineReading').length === 0, rowsOf(h, 'machineReading'))
    h.check('and the report names that machine', /Machine 'Lathe calc'/.test(String(read(ctx.results.current)?.message ?? '')), read(ctx.results.current)?.message)

    await maker.none()
    await runFromTools(h, SCRIPTS.checks, () => tickAll(h))
    const none = rowsOf(h, 'machineReading')
    h.check('with no machine the check lists the readings of the profile\'s presets instead of guessing one: 0.050 among them', none.length > 0 && none.some((r) => r.line === wordLine && /0\.05\b/.test(String(r.message))), none)
    h.check('and says there is no machine', /No machine/i.test(String(read(ctx.results.current)?.message ?? '')), read(ctx.results.current)?.message)
  })

  // =============================================================== E. extents
  await guard(h, 'E. extents', async () => {
    const docId = await newDoc(h, EXTENTS_PROGRAM, FANUC_MILL)
    const before = h.app.text()
    const run = await runFromTools(h, SCRIPTS.extents, () => {})
    await showPanel(h, 'results')
    const rows = storeRows(h)
    h.check('a report-mode script leaves the program alone', h.app.text() === before)
    const program = rows.filter((r) => r.scope === 'program')
    /** @param {string} axis */
    const at = (axis) => program.find((r) => r.axisId === axis)
    const near = (/** @type {unknown} */ value, /** @type {number} */ want) => Math.abs(Number(value) - want) < 1e-9
    h.check('the whole program has a row per axis it moves: X, Y and Z', ['X', 'Y', 'Z'].every((axis) => at(axis)), program.map((r) => r.axisId))
    h.check('X runs from 0 to 10', near(at('X')?.min, 0) && near(at('X')?.max, 10), at('X'))
    h.check('Y from -5 to 5: the two half circles reach the radius above and below their centre', near(at('Y')?.min, -5) && near(at('Y')?.max, 5), at('Y'))
    h.check('Z from -1 to 5', near(at('Z')?.min, -1) && near(at('Z')?.max, 5), at('Z'))
    h.check('the arc extremes are on the lines of the arcs (8 for the top, 9 for the bottom)', at('Y')?.maxLine === 8 && at('Y')?.minLine === 9, { max: at('Y')?.maxLine, min: at('Y')?.minLine })
    h.check('nothing is unresolved in a program written with decimal points', program.every((r) => Number(r.unresolved) === 0), program.map((r) => `${r.axisId}:${r.unresolved}`))
    h.check('the tool has rows of its own', rows.some((r) => r.scope === 'tool'), rows.map((r) => r.scope))
    h.check('the header names the machine, or says there is none', /^No machine/i.test(String(read(ctx.results.current)?.message ?? '')), read(ctx.results.current)?.message)
    h.log(`extents: form ${run.form}, ${run.ms} ms`)

    const yRow = clickableRows(h).find((e) => e.textContent?.includes('Y') && e.dataset.line === String(at('Y')?.line))
    h.check('a row names the line of its largest value, and is a button', at('Y')?.line === at('Y')?.maxLine && !!yRow, { line: at('Y')?.line, max: at('Y')?.maxLine })
    if (yRow) {
      ctx.editor.reveal(docId, 1, 1)
      await h.idle()
      h.click(yRow)
      await h.waitFor(() => h.app.cursor().line === Number(yRow.dataset.line), { timeout: 5000 })
      h.check('a click on it jumps to that line', h.app.cursor().line === Number(yRow.dataset.line), h.app.cursor())
    }
  })

  // =============================================================== F. the lathe: one X column in diameters, not resolved
  await guard(h, 'F. lathe extents', async () => {
    const opened = await openPath(h, await h.fixture('nc/fanuc-lathe/l06-decimal.nc'))
    h.check('l06-decimal.nc is a Fanuc lathe program', ctx.docs.get(opened.id)?.profileId === FANUC_LATHE, ctx.docs.get(opened.id)?.profileId)

    await maker.use('Lathe IS-B')
    await runFromTools(h, SCRIPTS.extents, () => {})
    const isb = storeRows(h).filter((r) => r.scope === 'program')
    h.check('the X column is labelled X (diameter), and there is no plain X row beside it', isb.some((r) => r.axisId === 'X' && /^X \(diameter\)$/.test(String(r.axis))) && !isb.some((r) => r.axis === 'X'), isb.map((r) => `${r.axisId}:${r.axis}`))
    h.check('under IS-B the point-less words have a value: nothing in X or Z is unresolved', isb.filter((r) => r.axisId === 'X' || r.axisId === 'Z').every((r) => Number(r.unresolved) === 0), isb.map((r) => `${r.axisId}:${r.unresolved}`))
    h.check('the header names the machine', /^Machine 'Lathe IS-B'/.test(String(read(ctx.results.current)?.message ?? '')), read(ctx.results.current)?.message)
    h.check('G28 U0 W0 is a machine position: a row of its own, not in a range', storeRows(h).some((r) => r.scope === 'machine'), storeRows(h).map((r) => r.scope))

    await maker.use('Lathe calc')
    await runFromTools(h, SCRIPTS.extents, () => {})
    const calc = storeRows(h).filter((r) => r.scope === 'program')
    h.check('under calculator-type input nothing is unresolved either', calc.filter((r) => r.axisId === 'X' || r.axisId === 'Z').every((r) => Number(r.unresolved) === 0), calc.map((r) => `${r.axisId}:${r.unresolved}`))
    await maker.none()
    await runFromTools(h, SCRIPTS.extents, () => {})
    const none = storeRows(h).filter((r) => r.scope === 'program')
    h.check('with no machine the point-less Z words are not resolved, and counted', none.some((r) => r.axisId === 'Z' && Number(r.unresolved) >= 1), none.map((r) => `${r.axisId}:${r.unresolved}`))
    h.check('the header says there is no machine', /^No machine/i.test(String(read(ctx.results.current)?.message ?? '')), read(ctx.results.current)?.message)
    await showPanel(h, 'results')
    h.check('and the finding that says why is on the screen, as a warning', screenFindings(h).some((f) => f.split('|')[1] === 'warning'), screenFindings(h))
    h.log(`status: ${message(h)}`)
  })
})
