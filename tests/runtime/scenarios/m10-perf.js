// G7 for M10 (plan §6 M10 H10 `m10-perf`): the program checks and the extents on a 300,000
// line program within "the script budget of P1", and address arithmetic on 100,000 lines.
//
// **What "the script budget of P1" is.** The Phase 1 plan budgets the transforms (100k lines:
// 1 s to run, 2 s to apply) and gives a script a limit of its own: the run is killed after
// `scripts.timeoutSeconds`, 60 by default (P1 §7.11, AD-13), **unless the script's header
// asks for more** (`# timeout = N`, which wins over the setting: `runner.rs`
// `timeout_secs`). A Python script cannot be held to the transform figures - the
// interpreter alone (tokenizing and the modal state, no check on top of it) takes about 30 s
// for 300k lines on the development Mac - so the three M10 scripts declare `# timeout = 300`
// and that is the limit a user meets: **a run on the default settings has to finish, on a
// 300k-line program, before the app kills it at 300 s.** That is `SCRIPT_LIMIT_MS`. The
// scenario does not touch `scripts.timeoutSeconds`: it would change nothing for these scripts.
//
// **The budget on the development Mac** (`SCRIPT_BUDGET_MS`, 200 s) is two thirds of that
// limit, so a machine a good deal slower than the development Mac still has its margin and a
// cold run does not fail for a reason that is no regression. **On a hosted runner** the
// budget is not stretched past the limit: `h.checkTime` multiplies by 10, so the figure
// handed to it is the limit divided by 10 and the result is the 300 s the app really grants;
// a script the app kills is a failed check, not a measured time.
//
// **The apply of a replace script is the transform budget.** Address arithmetic changes
// every line with a `Z` on a 100k-line program, which is the case `m4-perf-transform` holds
// renumber to: the undo of that edit is one step and has to be back inside the 2 s of an
// apply (`APPLY_BUDGET_MS`). The run itself is the script's, and is held to the same limit
// as the other two.
//
// **Correctness at size.** A budget met by a script that stopped reading is no budget: the
// extents are compared with the minimum and maximum worked out from the text of the program
// here, and the shifted program is compared with the program it should be, line by line.
// The program checks have nothing to find in this program that the generator did not put
// there, so what is held to them is that they finished, answered with a well-formed report
// within the row cap, and changed nothing.
//
// The Output panel is never opened here: it would draw the 100,000-line result it keeps.

import { CI_TIME_FACTOR } from '../lib/api.js'
import { scenario } from '../lib/index.js'
import { largeProgram } from './m3-common.js'
import {
  SCRIPTS,
  bump,
  context,
  differences,
  extentsOf,
  fieldIds,
  fillForm,
  guard,
  linesOfText,
  message,
  openPath,
  pick,
  OPERATIONS,
  pythonProbe,
  read,
  ready,
  runFromTools,
  scriptService,
  splitLines,
  storeRows,
  ticked,
} from './m10-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** What the app kills these scripts at: their `# timeout = 300` header (it wins over `scripts.timeoutSeconds`). */
const SCRIPT_LIMIT_MS = 300000
/** The budget on the development Mac: two thirds of the limit. */
const SCRIPT_BUDGET_MS = 200000
/** P1 G7: one apply of a transform on 100k lines. */
const APPLY_BUDGET_MS = 2000

const LINES_CHECKS = 300000
const LINES_ARITHMETIC = 100000

scenario('m10-perf', { timeout: 1500 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const probe = await pythonProbe(h)
  h.check('the Python probe has answered, so the scripts can run', probe?.ok === true, probe)
  // checkTime stretches a budget by CI_TIME_FACTOR on a hosted runner; the app's own limit is
  // not stretched, so the budget handed to it there is the limit divided by that factor.
  const budget = h.cfg.ci ? SCRIPT_LIMIT_MS / CI_TIME_FACTOR : SCRIPT_BUDGET_MS
  // How long the scenario waits for a report: the limit, and a little for the app to say it killed the run.
  const wait = SCRIPT_LIMIT_MS + 30000

  // =============================================================== A. 300k lines: checks and extents
  const text = largeProgram({ lines: LINES_CHECKS })
  const lines = splitLines(text)
  const path = `${h.cfg.run}/m10-perf-300k.nc`
  await h.disk.write(path, text)
  const opened = await openPath(h, path)
  const id = opened.id
  await h.waitFor(() => ctx.editor.getLineCount(id) === lines.length + 1, { timeout: 120000, interval: 50 })
  h.check(`the program has ${lines.length} lines and ${(text.length / 1024 / 1024).toFixed(1)} MiB, and is open as a Fanuc mill program`, lines.length >= LINES_CHECKS && ctx.editor.getLineCount(id) === lines.length + 1 && ctx.docs.get(id)?.profileId === 'fanuc-gcode', {
    lines: lines.length,
    model: ctx.editor.getLineCount(id),
    profile: ctx.docs.get(id)?.profileId,
  })
  await h.idle({ timeout: 60000 })
  const original = h.app.text()

  await guard(h, 'A1. program checks', async () => {
    const run = await runFromTools(
      h,
      SCRIPTS.checks,
      () => {
        for (const field of fieldIds(h)) if (!ticked(h, field)) fillForm(h, { [field]: true })
      },
      wait,
    )
    const report = read(ctx.results.current)
    const rows = storeRows(h)
    h.checkTime(`program checks on ${lines.length} lines finish within the script budget (inside the 300 s the app grants)`, run.ms, budget, { rows: rows.length, status: message(h) })
    h.check('the run ended with a report, not with the app\'s own timeout message', report !== null && !/timed out|stopped/i.test(message(h)), { title: report?.title, status: message(h) })
    h.check('the report is well formed and inside the row cap', Array.isArray(rows) && rows.length <= 5000 && rows.every((r) => typeof r.checkId === 'string'), rows.slice(0, 3))
    h.check('and a report script changed nothing: the program is as it was', h.app.text() === original && !ctx.docs.get(id)?.dirty, { dirty: ctx.docs.get(id)?.dirty })
    h.log(`program checks: ${run.ms} ms, ${rows.length} rows${report?.dropped ? `, ${report.dropped} dropped` : ''}: ${message(h)}`)
  })

  await guard(h, 'A2. extents', async () => {
    const run = await runFromTools(h, SCRIPTS.extents, () => {}, wait)
    const rows = storeRows(h).filter((r) => r.scope === 'program')
    h.checkTime(`extents on ${lines.length} lines finish within the script budget (inside the 300 s the app grants)`, run.ms, budget, { status: message(h) })
    const want = extentsOf(lines, ['X', 'Y', 'Z'])
    const got = Object.fromEntries(rows.map((r) => [r.axisId, r]))
    const near = (/** @type {unknown} */ value, /** @type {number} */ expected) => Math.abs(Number(value) - expected) < 1e-6
    h.check(
      'the extents are the ones the program\'s text gives: X, Y and Z minimum and maximum',
      ['X', 'Y', 'Z'].every((axis) => got[axis] && near(got[axis].min, want[axis].min) && near(got[axis].max, want[axis].max)),
      { want, got: Object.fromEntries(Object.entries(got).map(([axis, r]) => [axis, [r.min, r.max]])) },
    )
    h.check('and nothing is unresolved: every word of the program has a point', rows.every((r) => Number(r.unresolved) === 0), rows.map((r) => `${r.axisId}:${r.unresolved}`))
    h.check('a report script changed nothing', h.app.text() === original)
    h.log(`extents: ${run.ms} ms`)
  })

  // =============================================================== B. 100k lines: address arithmetic
  await guard(h, 'B. address arithmetic', async () => {
    // One 300k-line document is enough to keep open; the next one is measured on its own.
    await ctx.commands.run('file.close')
    await h.waitFor(() => !ctx.docs.get(id), { timeout: 15000 })
    const big = largeProgram({ lines: LINES_ARITHMETIC })
    const bigLines = splitLines(big)
    const bigPath = `${h.cfg.run}/m10-perf-100k.nc`
    await h.disk.write(bigPath, big)
    const doc = await openPath(h, bigPath)
    await h.waitFor(() => ctx.editor.getLineCount(doc.id) === bigLines.length + 1, { timeout: 60000, interval: 50 })
    await h.idle({ timeout: 60000 })
    const before = linesOfText(h.app.text())
    const beforeText = h.app.text()
    h.check(`the second program has ${bigLines.length} lines and is the active document`, ctx.docs.get(doc.id)?.profileId === 'fanuc-gcode' && before.length >= LINES_ARITHMETIC, { lines: before.length })

    const service = scriptService(h)
    const running = service.run(SCRIPTS.arithmetic)
    if (!(await h.waitFor(() => h.q('modal'), { timeout: 20000 }))) throw new Error(`address arithmetic opened no form (status: ${message(h)})`)
    fillForm(h, { operation: pick('add', OPERATIONS.indexOf('add')), operand: 0.5, addresses: ['Z'] })
    await h.frame()
    const started = performance.now()
    h.click(h.q('modal-ok'))
    await running
    await h.idle({ timeout: 60000 })
    const ms = Math.round(performance.now() - started)
    h.checkTime(`address arithmetic on ${before.length} lines finishes within the script budget, apply included`, ms, budget, { status: message(h) })

    const after = linesOfText(h.app.text())
    const wanted = before.map((line) => bump(line, 'paren', 'Z', 0.5))
    const wrong = differences(before, after, wanted)
    h.check('every Z of the program is 0.5 higher and no other word of any line changed', after.length === before.length && wrong.length === 0, { lines: after.length, first: wrong.slice(0, 4), wrong: wrong.length })

    // The undo of a 100k-line edit is one step, and as cheap as the apply of a transform.
    const instance = /** @type {any} */ (ctx.editor.editorInstance())
    const probeLine = before.findIndex((line, i) => line !== after[i]) + 1
    const started2 = performance.now()
    instance.trigger('m10', 'undo', null)
    await h.waitFor(() => ctx.editor.getLines(doc.id, probeLine, probeLine)[0] === before[probeLine - 1], { timeout: 30000, interval: 1 })
    const undoMs = Math.round(performance.now() - started2)
    h.checkTime('one undo takes the whole run back within the apply budget (G7: 2 s)', undoMs, APPLY_BUDGET_MS, { probeLine })
    h.check('and it was all of it, not the visible lines', h.app.text() === beforeText, { lines: ctx.editor.getLineCount(doc.id) })
    h.log(`address arithmetic: ${ms} ms for ${before.length} lines, undo ${undoMs} ms`)
  })
})
