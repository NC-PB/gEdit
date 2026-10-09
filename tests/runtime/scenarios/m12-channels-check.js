// Check Wait Codes (plan §6 M12 H12 `m12-channels-check`; X12, WP12.2, WP12.5, §7.17): the report
// in the Results panel, a row that jumps to the right line **in the right document**, and what
// the check refuses to conclude.
//
// **The expected findings are written out from the programs**, never read from the check:
//
//   - `c02-mismatch-single.nc` (README of `tests/fixtures/channels/`): `M902` on line 14 only in
//     channel 1 (missing); `M903` once in channel 1 and twice in channel 2 (a count mismatch,
//     reported on the surplus wait, line 39); `M905`/`M906` in one order in channel 1 (lines 19
//     and 22) and the other in channel 2 (a swapped pair, reported on line 19); `M907 P13` on 24
//     names path 3, which the machine does not have; `M908` on 25 has no `P` and names nobody
//     (unmatched). Clean on purpose, and so no row: `M901 P12` against `M901 P21` (the order of
//     the digits is free) and `M0909 P12` against `M909P12` (a leading zero is not read).
//   - `c11-repeat-ids.nc`: a label on every wait line, `M910` twice and `M920` three times in
//     BOTH channels, same counts and order: the shape of a real program, and no finding.
//   - `c03-jump.nc`: `M901`/`M902` swapped across a plain label (an order that can be judged:
//     line 9) and `M903`/`M904` swapped across a jump target and a backward jump (an order the
//     check refuses to judge, and says so: line 13).
//   - `dpair_CH1.nc` / `dpair_CH2.nc` (`tests/runtime/fixtures/channels/`): one file per channel,
//     `M902` in channel 1 only (its line 13), `M904` in channel 2 only (its line 13).
//   - `o10-two-turret.MIN` / `o11-count-mismatch.MIN` through the Okuma preset: the **ordered** P
//     codes (a number on one side only is legal) and the **counted** M100.
//
// A clean result is not a proof (the docs say so); it is "all match" for the codes the machine
// was told about, and the report says which channels it could read.

import { scenario } from '../lib/index.js'
import { pickerRows } from './m6-common.js'
import { ribbonTab } from './m4-common.js'
import {
  NC_DIR,
  OKUMA,
  REPO_FILE,
  activate,
  activeId,
  blockOf,
  channelMachines,
  context,
  goto,
  open,
  presetBlock,
  ready,
  report,
  resultRows,
  waitReport,
} from './m12-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/**
 * Presses "Check Wait Codes" on the Tools tab and waits for the new report.
 * @param {Harness} h
 */
async function check(h) {
  const before = report(h)
  await ribbonTab(h, 'tools')
  h.click(h.q('cmd-button', { command: 'channels.checkSync' }))
  return waitReport(h, before)
}

/** `line:text` of the rows of a report, to compare. @param {any} r */
const lineList = (r) => (r.rows ?? []).map((/** @type {any} */ row) => row.line)

scenario('m12-channels-check', { timeout: 420, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await h.fixture(NC_DIR)
  const pairDir = await h.fixture('channels', { from: 'runtime' })
  const okumaDir = await h.fixture('channels/nc/okuma')
  const machines = channelMachines(h)

  // ==================================================================== A. one program, five defects
  await machines.add('Waits', await blockOf(h, 'c02-mismatch-single'))
  const c02 = await open(h, `${dir}/c02-mismatch-single.nc`)
  await machines.use('Waits')
  const a = await check(h)
  h.check('the report names the machine and how many things to look at', /Waits/.test(a.title) && /5 to look at/.test(a.title), a.title)
  h.check('it lists the channels it checked', /Checked: Channel 1, Channel 2\./.test(a.message), a.message)
  h.check(
    'it has exactly the five defects of the program, on their lines: 14 (M902 missing), 19 (M905/M906 swapped), 24 (M907 names path 3), 25 (M908 names nobody), 39 (M903 counted 2 against 1)',
    JSON.stringify(lineList(a)) === JSON.stringify([14, 19, 24, 25, 39]),
    lineList(a),
  )
  const kinds = /** @type {Record<number, RegExp>} */ ({
    14: /M902.*Channel 1.*waits for Channel 2.*no M902/,
    19: /M905.*line 19.*M906.*line 22.*other order.*Channel 2/,
    24: /M907.*Channel 1.*not a channel/,
    25: /M908.*names no other channel/,
    // M13 review NC-10: "…, Channel 1 has 1; both need the same number." (no "1 times").
    39: /M903.*Channel 2 waits on it 2 times.*Channel 1 has 1; both need the same number/,
  })
  for (const row of a.rows) {
    h.check(`the finding on line ${row.line} says the right thing (${row.channel})`, kinds[row.line]?.test(row.text) === true, row.text)
  }
  h.check('nothing is reported for the waits that match: M901 (the digits of P in either order) and M0909 against M909', !a.rows.some((/** @type {any} */ r) => /M901|M0909|M909/.test(r.text)), a.rows.map((/** @type {any} */ r) => r.text))
  const rows = resultRows(h)
  h.check('every finding is a row of the Results panel that knows its line and its document', rows.length === 5 && rows.every((r) => r.docId === c02) && JSON.stringify(rows.map((r) => r.line)) === JSON.stringify([14, 19, 24, 25, 39]), rows.map((r) => `${r.docId}:${r.line}`))
  for (const row of rows) {
    await goto(h, c02, 1)
    h.click(row.element)
    await h.waitFor(() => h.app.cursor().line === row.line, { timeout: 4000 })
    h.check(`a click on the row for line ${row.line} goes to line ${row.line}`, h.app.cursor().line === row.line && activeId(h) === c02, { line: h.app.cursor().line })
  }
  h.check('the check changed nothing', !ctx.docs.get(c02)?.dirty)

  // ==================================================================== B. a clean program in the shape of a real one
  await machines.add('Repeats', await blockOf(h, 'c11-repeat-ids'))
  await open(h, `${dir}/c11-repeat-ids.nc`)
  await machines.use('Repeats')
  const b = await check(h)
  h.check('a label on every wait line and the ids repeated in both channels: nothing to look at', /all match/.test(b.title) && (b.rows ?? []).length === 0, { title: b.title, rows: b.rows })
  h.check('and the report says which channels it read', /Checked: Channel 1, Channel 2\./.test(b.message), b.message)
  h.check('no row of the panel is left over from the previous report', resultRows(h).length === 0)

  // ==================================================================== C. a jump between two waits
  await machines.add('Jumps', await blockOf(h, 'c03-jump'))
  await open(h, `${dir}/c03-jump.nc`)
  await machines.use('Jumps')
  const c = await check(h)
  h.check('across a plain label the order is judged (line 9), across a jump target and a backward jump it is not (line 13)', JSON.stringify(lineList(c)) === JSON.stringify([9, 13]), lineList(c))
  h.check('and the second says it is not checked, instead of staying silent', /M901.*M902.*other order/.test(c.rows[0].text) && /not checked.*jump target or a backward jump/.test(c.rows[1].text), c.rows.map((/** @type {any} */ r) => r.text))

  // ==================================================================== D. one file per channel
  const pairBlock = await blockOf(h, 'c06-part_CH1')
  await machines.add('Pair A', pairBlock)
  await machines.add('Pair B', pairBlock)
  const one = await open(h, `${pairDir}/dpair_CH1.nc`)
  await machines.use('Pair A')
  // Only channel 1 is open: the report names the channel it did not check.
  const lonely = await check(h)
  h.check('with only channel 1 open the report names the channel it could not check', /Not checked \(not open or not found\): Channel 2\./.test(lonely.message) && /Checked: Channel 1\./.test(lonely.message), lonely.message)
  h.check('and finds nothing to complain about in one channel alone', (lonely.rows ?? []).length === 0, lonely.rows)

  const two = await open(h, `${pairDir}/dpair_CH2.nc`)
  await machines.use('Pair B')
  await activate(h, one)
  await h.waitFor(() => h.q('status-item', { item: 'channel' })?.dataset.open === '1 2', { timeout: 8000 })
  // The pair is set to two different machines.
  const before = report(h)
  await ribbonTab(h, 'tools')
  h.click(h.q('cmd-button', { command: 'channels.checkSync' }))
  const d = await waitReport(h, before)
  h.check('both open: exactly the two findings, one in each document', d.rows.length === 2 && d.rows[0].docId === one && d.rows[1].docId === two && d.rows[0].line === 13 && d.rows[1].line === 13, d.rows.map((/** @type {any} */ r) => `${r.docId}:${r.line}`))
  h.check('channel 1\'s says M902 has no partner in channel 2, channel 2\'s says the same of M904', /M902.*Channel 1.*no M902/.test(d.rows[0].text) && /M904.*Channel 2.*no M904/.test(d.rows[1].text), d.rows.map((/** @type {any} */ r) => r.text))
  h.check('when the sibling carries another machine the report says so, naming it, and which rules were used', /Channel 2 is set to machine “Pair B”\. It was checked with the rules of “Pair A”\./.test(d.message), d.message)
  const rows2 = resultRows(h)
  h.check('the panel shows the two rows with their own documents', rows2.length === 2 && rows2[0].docId === one && rows2[1].docId === two, rows2.map((r) => `${r.docId}:${r.line}`))
  // A row jumps into the right document.
  await activate(h, one)
  h.click(rows2[1].element)
  await h.waitFor(() => activeId(h) === two && h.app.cursor().line === 13, { timeout: 5000 })
  h.check('the row for channel 2 opens channel 2\'s file at its line 13', activeId(h) === two && h.app.cursor().line === 13, { doc: activeId(h), line: h.app.cursor().line })
  h.click(rows2[0].element)
  await h.waitFor(() => activeId(h) === one && h.app.cursor().line === 13, { timeout: 5000 })
  h.check('and the row for channel 1 goes back to channel 1\'s, line 13', activeId(h) === one && h.app.cursor().line === 13, { doc: activeId(h), line: h.app.cursor().line })

  // It offers to use one machine for both. "Leave as it is" changes nothing.
  const answerPick = async (/** @type {RegExp} */ label) => {
    await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
    const row = pickerRows(h).find((entry) => label.test(entry.label))
    if (!row) throw new Error(`no entry ${label} in ${JSON.stringify(pickerRows(h).map((e) => e.label))}`)
    h.click(row.element)
    await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
    await h.idle()
  }
  const first = report(h)
  await ribbonTab(h, 'tools')
  h.click(h.q('cmd-button', { command: 'channels.checkSync' }))
  await waitReport(h, first)
  await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
  const offers = pickerRows(h).map((entry) => entry.label)
  h.check('it offers "Use “Pair A” for Channel 2" and "Leave as it is"', offers.length === 2 && /Use “Pair A” for Channel 2/.test(offers[0]) && /Leave as it is/.test(offers[1]), offers)
  await answerPick(/Leave as it is/)
  h.check('leaving it changes nothing: channel 2 still has its own machine', ctx.machines.effective(two).machine.name === 'Pair B', ctx.machines.effective(two).machine.name)

  const second = report(h)
  await ribbonTab(h, 'tools')
  h.click(h.q('cmd-button', { command: 'channels.checkSync' }))
  await waitReport(h, second)
  const reported = report(h)
  await answerPick(/Use “Pair A” for Channel 2/)
  await h.waitFor(() => ctx.machines.effective(two).machine.name === 'Pair A', { timeout: 8000 })
  const e = await waitReport(h, reported)
  h.check('choosing it sets channel 2 to the machine of channel 1', ctx.machines.effective(two).machine.name === 'Pair A', ctx.machines.effective(two).machine.name)
  h.check('and checks again: the same two findings, and no note about another machine', e.rows.length === 2 && !/is set to machine/.test(e.message), { rows: e.rows.length, message: e.message })
  h.check('the pair\'s files on disk were not touched', (await h.disk.read(`${pairDir}/dpair_CH1.nc`)).endsWith('M30\n%\n') && !ctx.docs.get(one)?.dirty && !ctx.docs.get(two)?.dirty)

  // ==================================================================== E. a clean pair
  const cleanDir = dir
  const pOne = await open(h, `${cleanDir}/c06-part_CH1.nc`)
  await machines.use('Pair A')
  await open(h, `${cleanDir}/c06-part_CH2.nc`)
  await machines.use('Pair A')
  await activate(h, pOne)
  const f = await check(h)
  h.check('a complete, correct pair (P as a bit sum, a wait with no P naming both) reports nothing to look at', /all match/.test(f.title) && (f.rows ?? []).length === 0 && /Checked: Channel 1, Channel 2\./.test(f.message), { title: f.title, message: f.message })

  // ==================================================================== F. count and ordered semantics (Okuma)
  const okumaBlock = presetBlock(h, OKUMA, 'okuma-2turret')
  await machines.add('Turrets', okumaBlock, { profile: OKUMA })
  const o10 = await open(h, `${okumaDir}/o10-two-turret.MIN`)
  if (ctx.docs.get(o10)?.profileId !== OKUMA) throw new Error(`o10 was read as ${ctx.docs.get(o10)?.profileId}`)
  await machines.use('Turrets')
  const g = await check(h)
  h.check('the ordered P codes (P5, P15, P35 against P5, P25, P35: a number on one side only is legal) and the counted M100 (twice on each side): all match', /all match/.test(g.title) && (g.rows ?? []).length === 0, { title: g.title, rows: g.rows })
  await open(h, `${okumaDir}/o11-count-mismatch.MIN`)
  await machines.use('Turrets')
  const i = await check(h)
  h.check('with one M100 fewer on turret B the counted rule gives one finding', (i.rows ?? []).length === 1 && /1 to look at/.test(i.title) && /M100/.test(i.rows[0].text), { title: i.title, rows: i.rows })
  // An ordered rule: P12 after P15 in turret A is a number that does not increase. Written here, not a fixture.
  const original = await h.disk.read(`${okumaDir}/o10-two-turret.MIN`)
  const decreasing = original.replace('\nP35\nG00 X600 Z400\nM02\nG14', '\nP12\nG00 X600 Z400\nM02\nG14')
  if (decreasing === original) throw new Error('the Okuma program changed: P35 of turret A is not where this scenario edits it')
  await h.disk.write(`${okumaDir}/o12-decreasing.MIN`, decreasing)
  await open(h, `${okumaDir}/o12-decreasing.MIN`)
  await machines.use('Turrets')
  const j = await check(h)
  h.check('an ordered code that goes down (P12 after P15 in turret A) gives exactly one finding, on its line', (j.rows ?? []).length === 1 && j.rows[0].line === 38 && /P12.*P15.*(increase)/.test(j.rows[0].text), { title: j.title, rows: j.rows })
})
