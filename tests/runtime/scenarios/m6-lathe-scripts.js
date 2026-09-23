// The three bundled scripts on a turning program (plan §5 M6 H6 `m6-lathe-scripts`,
// WP6.6): scale feed to 90 %, scale spindle speeds to 110 %, and the tool list — each
// against the golden the vitest and Python suites use, with one undo per run.
//
// **What only this layer can say.** The Python suites already run these scripts on the same
// fixtures; what they cannot cover is everything between the user and the interpreter —
// the effective profile and machine that `app/scripts.ts` puts into the context, the
// parameter form, the envelope coming back through `decideApply`, the edit landing on a
// real Monaco model in one undo step, and the findings reaching the Results panel with
// their document lines. So the goldens are read off disk and compared whole, and what is
// checked here is that they survive that round trip.
//
// **The findings are the NC content of the run**, not decoration:
//
//   - scale feed leaves the three thread leads alone (`G76`, `G92`, `G32` all carry
//     `F1.5`, which is a lead in millimetres per revolution and not a feed rate). Scaling
//     them to 90 % would cut a 1.35 mm thread.
//   - scale speed leaves `G50 S2500` alone, because that S is the top speed the control may
//     use under constant surface speed, not a spindle speed.
//   - and it flags the three thread blocks that run at a speed it *did* scale, because on a
//     thread the feed follows from the speed and the lead together.
//
// The document is the real fixture, opened through the file dialog with its own CRLF line
// endings, so the save at the end is a byte check and not a string one.

import { scenario } from '../lib/index.js'
import { message, runScript, undo } from './m5-common.js'
import { L01, LATHE, context, machineText, openFixture, ready } from './m6-common.js'

/** `tests/fixtures/scripts/<script>/<case>/`, the goldens the Python suite runs on. */
const CASES = {
  feed: 'scale_feed/lathe-turning',
  speed: 'scale_speed/lathe-surface-speed',
  tools: 'tool_list/lathe-turning',
}

/**
 * The findings of a report or envelope on screen, as `line|severity|message`.
 *
 * `ResultsPanel` draws a severity badge and a "Line N" label beside the text, so the
 * message is read out of its own `.text` span rather than out of the row's `textContent`.
 */
const findings = (/** @type {import('../lib/api.js').Harness} */ h) =>
  h.qa('results-finding').map(
    (element) => `${element.dataset.line}|${element.dataset.severity}|${element.querySelector('.text')?.textContent?.trim() ?? ''}`,
  )

/**
 * Whether the status bar ends with the script's own summary.
 *
 * `app/scripts.ts` puts the script's name and what it did in front of it
 * ("Scale feed rates: 3 lines replaced …"), so the golden is the tail of the line.
 */
const summaryIs = (/** @type {import('../lib/api.js').Harness} */ h, /** @type {string} */ golden) =>
  message(h).endsWith(golden)

/** The same shape, from a golden's `findings` array. */
const goldenFindings = (/** @type {any[]} */ list) => list.map((f) => `${f.line}|${f.severity}|${f.message}`)

scenario('m6-lathe-scripts', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  /** Reads a case folder out of `tests/fixtures/scripts`. */
  const load = async (/** @type {string} */ rel) => {
    const dir = await h.fixture(`scripts/${rel}`)
    const read = async (/** @type {string} */ name) => h.disk.read(`${dir}/${name}`).catch(() => null)
    return {
      input: await read('input.nc'),
      expected: await read('expected.nc'),
      envelope: JSON.parse((await read('envelope.json')) ?? 'null'),
      report: JSON.parse((await read('expected.json')) ?? 'null'),
      case: JSON.parse((await read('case.json')) ?? '{}'),
    }
  }

  const feed = await load(CASES.feed)
  const speed = await load(CASES.speed)
  const tools = await load(CASES.tools)
  h.check('all three goldens run on the lathe dialect', [feed, speed, tools].every((entry) => entry.case.profile === LATHE), [feed.case, speed.case, tools.case])

  // The fixture on disk and the script goldens are the same program; the fixture keeps the
  // CRLF a post writes, which is what makes the save at the end worth doing.
  const file = await openFixture(h, L01)
  const original = await h.disk.hex(file.path)
  h.check('the turning program opened on the lathe dialect, with no machine', ctx.docs.get(file.id)?.profileId === LATHE && machineText(h) === 'Machine: none (assumed)', {
    profile: ctx.docs.get(file.id)?.profileId,
    machine: machineText(h),
  })
  h.check('and it is the program the goldens were written against', h.app.text() === feed.input, {
    document: h.app.text().split('\n').length,
    golden: (feed.input ?? '').split('\n').length,
  })

  // ==================================================================== A. scale feed 90 %
  await runScript(h, 'bundled:scale_feed.py', { form: true, fields: { percent: 90 } })
  h.check('scale feed to 90 % gives the golden bytes', h.app.text() === feed.expected, {
    got: h.app.text().split('\n'),
    want: (feed.expected ?? '').split('\n'),
    status: message(h),
  })
  h.check('and the summary is the golden’s, machine sentence included', summaryIs(h, feed.envelope.message), { got: message(h), want: feed.envelope.message })
  h.check(
    'the three thread leads are reported and left alone: F1.5 under G76, G92 and G32 is a pitch, not a feed',
    JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(feed.envelope.findings)),
    { got: findings(h), want: goldenFindings(feed.envelope.findings) },
  )
  h.check('and they really are still F1.5 in the document', [33, 35, 41].every((line) => (ctx.editor.getLines(file.id, line, line)[0] ?? '').includes('F1.5')), [33, 35, 41].map((line) => ctx.editor.getLines(file.id, line, line)[0]))
  // The three real feeds were scaled, and each keeps the number of decimals it was written
  // with (the form's default): F0.25 → F0.23, not F0.225.
  h.check('while the turning feeds were scaled, each keeping the decimals it was written with', (ctx.editor.getLines(file.id, 16, 16)[0] ?? '').includes('F0.23') && (ctx.editor.getLines(file.id, 18, 18)[0] ?? '').includes('F0.11') && (ctx.editor.getLines(file.id, 50, 50)[0] ?? '').includes('F0.07'), [16, 18, 50].map((line) => ctx.editor.getLines(file.id, line, line)[0]))

  await undo(h)
  h.check('one undo takes the whole run back', h.app.text() === feed.input, {
    text: ctx.editor.getLines(file.id, 16, 16)[0],
    dirty: ctx.docs.get(file.id)?.dirty,
  })

  // ==================================================================== B. scale speed 110 %
  await runScript(h, 'bundled:scale_speed.py', { form: true, fields: { percent: 110 } })
  h.check('scale spindle speeds to 110 % gives the golden bytes', h.app.text() === speed.expected, {
    got: h.app.text().split('\n'),
    want: (speed.expected ?? '').split('\n'),
    status: message(h),
  })
  h.check('and the golden summary', summaryIs(h, speed.envelope.message), { got: message(h), want: speed.envelope.message })
  h.check(
    'the G50 clamp is recognised as a speed limit and the three thread blocks are flagged',
    JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(speed.envelope.findings)),
    { got: findings(h), want: goldenFindings(speed.envelope.findings) },
  )
  h.check('the clamp is untouched in the document: G50 S2500 is still 2500', (ctx.editor.getLines(file.id, 11, 11)[0] ?? '').includes('S2500'), ctx.editor.getLines(file.id, 11, 11)[0])
  h.check('and the surface speed was scaled: G96 S220 became S242', (ctx.editor.getLines(file.id, 12, 12)[0] ?? '').includes('S242'), ctx.editor.getLines(file.id, 12, 12)[0])

  await undo(h)
  h.check('one undo takes that run back too', h.app.text() === speed.input, ctx.editor.getLines(file.id, 12, 12)[0])

  // ==================================================================== C. the tool list
  await runScript(h, 'bundled:tool_list.py', { form: true })
  await h.waitFor(() => h.qa('results-row').length > 0, { timeout: 30000 })
  const columns = h.qa('results-row')[0] ? [...h.qa('results-row')[0].querySelectorAll('.cell')].map((cell) => /** @type {HTMLElement} */ (cell).dataset.column) : []
  h.check('the report has the columns the golden declares, with the turret offsets second', JSON.stringify(columns) === JSON.stringify(tools.report.columns.map((/** @type {any} */ c) => c.key)) && columns[1] === 'offsets', {
    got: columns,
    want: tools.report.columns.map((/** @type {any} */ c) => c.key),
  })

  const rows = h.qa('results-row').map((row) =>
    tools.report.columns
      .map((/** @type {any} */ column) => row.querySelector(`.cell[data-column="${column.key}"]`)?.textContent?.trim() ?? '')
      .join('|'),
  )
  const wantRows = tools.report.rows.map((/** @type {any} */ row) =>
    tools.report.columns.map((/** @type {any} */ column) => String(row[column.key] ?? '')).join('|'),
  )
  h.check('one row per turret station, with its offsets, its feed range per revolution and its speed', JSON.stringify(rows) === JSON.stringify(wantRows), { got: rows, want: wantRows })
  // A report does not put its summary in the status bar — it says where the answer is —
  // so the golden's message is read off the panel's own heading.
  h.check('the panel heads the table with the golden summary', (h.q('results-panel')?.textContent ?? '').includes(tools.report.message), {
    status: message(h),
    panel: h.q('results-panel')?.textContent?.trim().slice(0, 200),
    want: tools.report.message,
  })
  h.check(
    'the S of the G50 block and the F of the thread blocks are kept out of the ranges, and it says why',
    JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(tools.report.findings)),
    { got: findings(h), want: goldenFindings(tools.report.findings) },
  )
  h.check('a report changes nothing: the document is as it was', h.app.text() === tools.input && ctx.docs.get(file.id)?.dirty !== true, {
    dirty: ctx.docs.get(file.id)?.dirty,
  })

  // ==================================================================== D. the saved bytes
  await runScript(h, 'bundled:scale_feed.py', { form: true, fields: { percent: 90 } })
  h.check('the feed run is applied again', h.app.text() === feed.expected, message(h))
  if ((await ctx.files.save(file.id)) !== true) throw new Error('saving the turning program failed')
  await h.idle()
  const saved = await h.disk.read(file.path)
  h.check('what was saved is the golden, written back in the file’s own CRLF line endings', saved.replace(/\r\n/g, '\n') === feed.expected && saved.includes('\r\n'), {
    crlf: saved.includes('\r\n'),
    head: JSON.stringify(saved.slice(0, 80)),
  })
  h.check('and the bytes really changed, so the check above is not comparing the file with itself', (await h.disk.hex(file.path)) !== original)
})
