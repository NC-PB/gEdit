// Phase 2 exit criterion X1, "Fanuc lathe" (plan §2.2; `tests/fixtures/exit2/README.md`, X1).
//
// `fanuc-lathe-a.nc` (CRLF, G-code system A) and `fanuc-lathe-b.nc` (system B) open as
// `fanuc-lathe` and, with **no machine chosen** (this scenario runs on an empty HOME, so none
// exists), the machine item shows the detected G-code system, marked as detected. F7 and
// Shift+F7 visit exactly the golden tool lines; the map's tool labels and the tool list's rows
// match; hover on `G71`, `G76`, `X` and `U` says what the golden says; scale feed 90 %, scale
// speed 110 % and renumber give the golden bytes, with the threads and the clamps untouched and
// reported, and each run is one undo step. The document is saved at the end and compared byte
// for byte with the golden of the last run (CRLF kept).
//
// With `noPython` (the `exit2-nopython` scenario) the same file is driven without an interpreter:
// detection, F7 and the map work, the renumber (TypeScript) gives its golden, every script
// command shows the Phase 1 message and leaves the document alone.

import { scenario } from '../lib/index.js'
import {
  LATHE,
  activate,
  checkHovers,
  checkToolList,
  context,
  exitDir,
  expectNoPython,
  findings,
  firstDifference,
  gold,
  goldText,
  goldenFindings,
  lf,
  machineItem,
  machineText,
  mapTools,
  message,
  openIn,
  ready,
  runAndCompare,
  runScript,
  textNow,
  undo,
  variantLine,
  walkTools,
} from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/**
 * Renumbers the active document with the form as it opens, answering the preflight with
 * Continue, and compares the result with the golden.
 * @param {Harness} h
 * @param {string} id
 * @param {{ text: string, report: any, label: string }} o
 */
export async function renumberAndCompare(h, id, { text, report, label }) {
  const input = textNow(h)
  const running = context(h).commands.run('nc.renumber')
  await h.waitFor(() => h.q('modal'), { timeout: 10000 })
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  const asked = await h.alert.click('Continue')
  await running
  await h.idle()
  h.check(`${label}: the preflight asks about the reference it cannot follow, in the golden's words`, asked.texts.some((t) => t.includes(report.preflight)), { texts: asked.texts, want: report.preflight })
  const got = textNow(h)
  h.check(`${label}: renumber gives the golden bytes (G71/G70 P/Q rewritten, M99 P left)`, got === lf(text), { diff: firstDifference(got, lf(text)) })
  const panel = h.q('results-panel')?.textContent ?? ''
  h.check(`${label}: the summary and the warnings are the golden's`, panel.includes(report.summary) && report.warnings.every((/** @type {string} */ w) => panel.includes(w)), { panel: panel.slice(0, 400), want: [report.summary, ...report.warnings] })
  h.check(`${label}: and the skipped lines are listed with the golden rows`, JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(report.skipped)), { got: findings(h), want: goldenFindings(report.skipped) })
  await undo(h)
  h.check(`${label}: one undo takes the renumber back`, textNow(h) === input, { dirty: context(h).docs.get(id)?.dirty, diff: firstDifference(textNow(h), input) })
}

/**
 * The machine item of a lathe program with no machine: none, assumed, and the G-code system
 * detected from the program.
 * @param {Harness} h
 * @param {'A' | 'B'} system
 * @param {string} label
 */
export function checkMachineItem(h, system, label) {
  h.check(`${label}: with no machine the item says so, and marks it assumed`, machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1' && machineItem(h)?.dataset.machineId === '', { text: machineText(h), assumed: machineItem(h)?.dataset.assumed })
  const v = variantLine(h, 'G-code system', `G-code system ${system}`, 'detected')
  h.check(`${label}: G-code system ${system}, marked as detected`, v.line === v.want, v)
}

/**
 * X1 over both programs.
 * @param {Harness} h
 * @param {{ noPython?: boolean }} [o]
 */
export async function runX1(h, { noPython = false } = {}) {
  const ctx = context(h)
  await ready(h)
  const dir = await exitDir(h)
  const a = await gold(h, dir, 'fanuc-lathe-a.tools.json')
  const hover = await gold(h, dir, 'fanuc-lathe-a.hover.json')
  const b = await gold(h, dir, 'fanuc-lathe-b.tools.json')
  const feedA = await gold(h, dir, 'fanuc-lathe-a.feed90.report.json')
  const speedA = await gold(h, dir, 'fanuc-lathe-a.speed110.report.json')
  const renumberA = await gold(h, dir, 'fanuc-lathe-a.renumber.report.json')
  const feedB = await gold(h, dir, 'fanuc-lathe-b.feed90.report.json')
  h.check('no machine exists at all: this is where the criterion starts', (await h.config.read('machines.json')) === null && ctx.machines.compatibleWith(LATHE).length === 0, await h.config.read('machines.json'))

  // ============================================================ A. system A, CRLF
  const fileA = await openIn(h, dir, 'fanuc-lathe-a.nc')
  const idA = fileA.id
  h.check('fanuc-lathe-a.nc opens as fanuc-lathe', ctx.docs.get(idA)?.profileId === a.profile && a.profile === LATHE, ctx.docs.get(idA)?.profileId)
  const inputA = await h.disk.read(fileA.path)
  h.check('and it is the CRLF program the golden says', inputA.includes('\r\n'))
  checkMachineItem(h, 'A', 'A')

  await walkTools(h, idA, a.toolLines, 'A')
  h.check('T0100, T0300 and the second offset are not tool changes: lines 33, 39 and 57 are not visited', [33, 39, 57].every((line) => !ctx.outline.toolLines(idA).includes(line)), ctx.outline.toolLines(idA))
  await h.waitFor(() => mapTools(h).length === a.mapTools.length, { timeout: 10000 })
  h.check('A: the map labels its tools as the golden does', JSON.stringify(mapTools(h)) === JSON.stringify(a.mapTools), { got: mapTools(h), want: a.mapTools })
  await checkHovers(h, idA, hover.hovers, 'A')
  if (noPython) {
    h.log('no Python: the tool list, scale feed and scale speed are script commands')
    await expectNoPython(h, 'bundled:tool_list.py', idA, 'A: the tool list', {})
    await expectNoPython(h, 'bundled:scale_feed.py', idA, 'A: scale feed', { percent: 90 })
    await expectNoPython(h, 'bundled:scale_speed.py', idA, 'A: scale speed', { percent: 110 })
  } else {
    await checkToolList(h, a.toolList, 'A')
    await runAndCompare(h, { id: idA, scriptId: 'bundled:scale_feed.py', fields: { percent: 90 }, golden: await goldText(h, dir, 'fanuc-lathe-a.feed90.nc'), report: feedA, label: 'A: scale feed 90 %' })
    await runAndCompare(h, { id: idA, scriptId: 'bundled:scale_speed.py', fields: { percent: 110 }, golden: await goldText(h, dir, 'fanuc-lathe-a.speed110.nc'), report: speedA, label: 'A: scale speed 110 %' })
  }
  await activate(h, idA)
  const renumberText = await goldText(h, dir, 'fanuc-lathe-a.renumber.nc', noPython)
  await renumberAndCompare(h, idA, { text: renumberText, report: renumberA, label: 'A: renumber' })
  // The last run again, so that what is saved is its golden.
  const lastA = await goldText(h, dir, 'fanuc-lathe-a.renumber.nc', noPython)
  const lastRun = context(h).commands.run('nc.renumber')
  await h.waitFor(() => h.q('modal'), { timeout: 10000 })
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  await h.alert.click('Continue')
  await lastRun
  await h.idle()
  h.check('A: the last run is applied again before the save', textNow(h) === lf(lastA), firstDifference(textNow(h), lf(lastA)))

  // ============================================================ B. system B
  const fileB = await openIn(h, dir, 'fanuc-lathe-b.nc')
  const idB = fileB.id
  h.check('fanuc-lathe-b.nc opens as fanuc-lathe', ctx.docs.get(idB)?.profileId === b.profile, ctx.docs.get(idB)?.profileId)
  checkMachineItem(h, 'B', 'B')
  await walkTools(h, idB, b.toolLines, 'B')
  await h.waitFor(() => mapTools(h).length === b.mapTools.length, { timeout: 10000 })
  h.check('B: the map labels its tools as the golden does', JSON.stringify(mapTools(h)) === JSON.stringify(b.mapTools), { got: mapTools(h), want: b.mapTools })
  if (noPython) {
    await expectNoPython(h, 'bundled:tool_list.py', idB, 'B: the tool list', {})
    await expectNoPython(h, 'bundled:scale_feed.py', idB, 'B: scale feed', { percent: 90 })
  } else {
    await checkToolList(h, b.toolList, 'B')
    const feedBText = await goldText(h, dir, 'fanuc-lathe-b.feed90.nc')
    // One undo step takes the whole run back (the default of `runAndCompare`), then the run is applied
    // again, so that what is saved is its golden, as the A branch does for the renumber.
    await runAndCompare(h, { id: idB, scriptId: 'bundled:scale_feed.py', fields: { percent: 90 }, golden: feedBText, report: feedB, label: 'B: scale feed 90 % (G95 feeds scaled, G92 S a clamp)' })
    await runScript(h, 'bundled:scale_feed.py', { form: true, fields: { percent: 90 } })
    h.check('B: the run is applied again before the save', textNow(h) === lf(feedBText), firstDifference(textNow(h), lf(feedBText)))
    h.check('B: the G92 S clamp is still S2200', textNow(h).includes('G92 S2200'), null)
  }

  // ============================================================ the saved bytes
  await activate(h, idA)
  if ((await ctx.files.save(idA)) !== true) throw new Error('saving fanuc-lathe-a.nc failed')
  await h.idle()
  const savedA = await h.disk.read(fileA.path)
  h.check('A: the saved file is the golden of the last run, byte for byte, CRLF kept', savedA === lastA && savedA.includes('\r\n'), { diff: firstDifference(lf(savedA), lf(lastA)), crlf: savedA.includes('\r\n') })
  await activate(h, idB)
  if ((await ctx.files.save(idB)) !== true && ctx.docs.get(idB)?.dirty === true) throw new Error('saving fanuc-lathe-b.nc failed')
  await h.idle()
  const goldB = await goldText(h, dir, 'fanuc-lathe-b.feed90.nc', noPython)
  const savedB = await h.disk.read(fileB.path)
  h.check(`B: the saved file is ${noPython ? 'the input, byte for byte (an unedited document is never rewritten)' : 'the golden of the last run, byte for byte'}`, savedB === goldB, { diff: firstDifference(lf(savedB), lf(goldB)) })
  h.check('A: and the bytes really changed, so the comparison is not a file with itself', savedA !== inputA, null)
}

scenario('exit2-x1', { timeout: 600 }, async (h) => {
  await runX1(h)
})
