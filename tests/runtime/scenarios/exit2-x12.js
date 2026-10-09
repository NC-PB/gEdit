// Phase 2 exit criterion X12, "Channels and wait codes" (plan §2.2; `tests/fixtures/exit2/README.md`,
// X12), which runs last in the order of the exit criteria because its machines carry channel blocks.
//
// The four machines of `machines.x12.json` are defined first, none chosen. (c) `fanuc-lathe-a.nc` shows
// no channel item and its map equals the X1 golden. (a) `twin-single.nc` under "Twin 31i": the channel
// item, the program map of the golden (a row per channel with the tools of both sections and its sync
// rows, one "Outside the channels" group), the tool list's Channel column, "Check wait codes" with the
// four golden findings in order, Alt+F7 / Shift+Alt+F7 / Mod+Alt+P over both sections, and "Split into
// channel documents" with the golden texts and nothing written. (a2) "Twin 31i lines" adds the golden
// "names a channel the machine does not have" finding. (b) `twin_CH1.nc` alone, then with `twin_CH2.nc`
// opened through the file dialog: the golden findings, each row jumping into its own document. (d) "Twin
// broken": the channel block is reported with its path, read as layout none, and the rest of the machine
// is in force (address arithmetic gives the same text as under the valid machine).
//
// With `noPython` everything but the tool list and address arithmetic runs (plan §2.2, the
// `exit2-nopython` scenario).

import { scenario } from '../lib/index.js'
import { listDir } from './m2-common.js'
import { OPERATIONS, SCRIPTS, fillForm, pick, runReplace } from './m10-common.js'
import { closeSettings, machineRows, openMachinesPage, pickEntry } from './m6-common.js'
import { ribbonTab } from './m4-common.js'
import {
  activeId,
  channelMachines,
  channelState,
  goto,
  keys,
  mapRows,
  open,
  press,
  report,
  resultRows,
  waitChannel,
  waitReport,
} from './m12-common.js'
import { activate, checkToolList, context, exitDir, expectNoPython, firstDifference, gold, goldText, hoverAt, mapTools, ready, textNow, undo } from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const OPEN_OTHERS = 'Open the other channels…'

/**
 * Presses "Check wait codes" on the Tools tab and waits for the new report.
 * @param {Harness} h
 */
async function checkSync(h) {
  const before = report(h)
  await ribbonTab(h, 'tools')
  h.click(h.q('cmd-button', { command: 'channels.checkSync' }))
  return waitReport(h, before)
}

/**
 * Compares the report on show with a wait-code golden.
 * @param {Harness} h
 * @param {any} want the golden
 * @param {Record<string, string>} docs the golden's document names to the open ids
 * @param {string} label
 */
function checkWaitReport(h, want, docs, label) {
  const got = /** @type {any} */ (report(h))
  h.check(`${label}: the title is "${want.title}"`, got?.title === want.title, got?.title)
  h.check(`${label}: it lists the channels it checked: "${want.message}"`, got?.message === want.message || (got?.message ?? '').startsWith(want.message), got?.message)
  const rows = (got?.rows ?? []).map((/** @type {any} */ r) => ({ channel: r.channel, docId: r.docId, line: r.line, text: r.text }))
  const wanted = want.rows.map((/** @type {any} */ r) => ({ channel: `Channel ${r.channel}`, docId: docs[r.document], line: r.line, text: r.text }))
  h.check(`${label}: exactly the golden findings in order (${want.rows.map((/** @type {any} */ r) => `${r.kind}@${r.line}`).join(', ')})`, JSON.stringify(rows) === JSON.stringify(wanted), { got: rows, want: wanted })
}

/**
 * The hover on three words whose text depends on the machine's parameters (X a diameter, S the speed, F the feed),
 * one further in than the word's first character, as `checkHovers` asks.
 * @param {Harness} h
 * @param {string} id
 * @returns {Promise<string[]>}
 */
async function hoversOfMachineWords(h, id) {
  const out = []
  for (const [line, word] of /** @type {const} */ ([[11, 'X52.'], [9, 'S200'], [13, 'F0.25']])) {
    const text = (textNow(h).split('\n')[line - 1] ?? '')
    const column = text.indexOf(word) + 1
    if (column === 0) throw new Error(`line ${line} of twin-single.nc has no ${word}: ${text}`)
    out.push(await hoverAt(h, id, line, column + 1))
  }
  return out
}

/**
 * Alt+F7 and the like through real keys.
 * @param {Harness} h
 * @param {ReadonlyArray<{ key: string, mods?: string[] }>} combo
 * @param {number} expected
 */
async function stepTo(h, combo, expected) {
  await press(h, combo)
  await h.waitFor(() => h.app.cursor().line === expected, { timeout: 4000 })
  return h.app.cursor().line
}

/**
 * @param {Harness} h
 * @param {{ noPython?: boolean }} [o]
 */
export async function runX12(h, { noPython = false } = {}) {
  const ctx = context(h)
  await ready(h)
  const dir = await exitDir(h)
  const specs = (await gold(h, dir, 'machines.x12.json')).machines
  const x1a = await gold(h, dir, 'fanuc-lathe-a.tools.json')
  const mapGold = await gold(h, dir, 'twin-single.map.json')
  const toolsGold = await gold(h, dir, 'twin-single.tools.json')
  const checkGold = await gold(h, dir, 'twin-single.check.json')
  const linesGold = await gold(h, dir, 'twin-single.lines.check.json')
  const navGold = await gold(h, dir, 'twin-single.nav.json')
  const multiGold = await gold(h, dir, 'twin-multi.check.json')
  const brokenGold = await gold(h, dir, 'twin-broken.json')
  const split1 = await goldText(h, dir, 'twin-single.split-1.nc', noPython)
  const split2 = await goldText(h, dir, 'twin-single.split-2.nc', noPython)

  // ============================================================ the four machines, none chosen
  const machines = channelMachines(h)
  for (const spec of specs) {
    const { channels, ...rest } = spec.params
    await machines.add(spec.name, channels, { profile: spec.profile, params: rest })
  }
  h.check('the four machines of the golden are defined', specs.length === 4 && machineNames(ctx).length === 4, machineNames(ctx))

  // ============================================================ (c) nothing else changes
  const a = await open(h, `${dir}/fanuc-lathe-a.nc`)
  h.check('(c) with the X12 machines defined but none chosen, fanuc-lathe-a.nc shows no channel item', !channelState(h).present, channelState(h))
  await h.waitFor(() => mapTools(h).length === x1a.mapTools.length, { timeout: 10000 })
  h.check('(c) and its map is the X1 map: the same tool rows, no channel or sync row', JSON.stringify(mapTools(h)) === JSON.stringify(x1a.mapTools) && !mapRows(h).some((r) => r.kind === 'channel' || r.kind === 'sync'), { tools: mapTools(h), kinds: mapRows(h).map((r) => r.kind) })

  // ============================================================ (a) one file, two channels
  const path = `${dir}/twin-single.nc`
  const single = await open(h, path)
  const text = textNow(h)
  h.check('twin-single.nc is a Fanuc lathe program with no channel item until a machine is chosen', ctx.docs.get(single)?.profileId === 'fanuc-lathe' && !channelState(h).present, channelState(h))
  await machines.use('Twin 31i')
  const item = await waitChannel(h, (s) => s.present)
  h.check('under "Twin 31i" the channel item shows the layout and the two channels', item.layout === 'single-file' && item.count === '2', item)
  await goto(h, single, 6)
  h.check('the item follows the cursor: line 6 is channel 1', (await waitChannel(h, (s) => s.id === '1')).id === '1')
  await goto(h, single, 22)
  h.check('line 22 is channel 2', (await waitChannel(h, (s) => s.id === '2')).id === '2')
  await goto(h, single, 36)
  h.check('line 36, in the second section of channel 1, is channel 1 again', (await waitChannel(h, (s) => s.id === '1')).id === '1')
  await goto(h, single, 62)
  h.check('line 62 (the shared subprogram) is in no channel', (await waitChannel(h, (s) => s.id === '')).id === '')

  // ---- the program map
  await goto(h, single, 1)
  await h.waitFor(() => mapRows(h).filter((r) => r.kind === 'channel').length === 3, { timeout: 10000 })
  await h.idle()
  const rows = mapRows(h)
  const base = Math.min(...rows.map((r) => r.depth))
  const shown = rows.map((r) => ({ depth: r.depth - base, kind: r.kind, line: r.line, channelId: r.kind === 'channel' ? (r.channelId ?? '') : null, text: r.text }))
  const goldRows = mapGold.rows.map((/** @type {any} */ r) => ({ depth: r.depth, kind: r.kind, line: r.line, channelId: r.kind === 'channel' ? (r.channelId ?? '') : null, text: r.text }))
  const brief = (/** @type {any[]} */ list) => list.map((r) => `${r.depth}|${r.kind}|${r.line}|${r.channelId ?? ''}`)
  h.check('the program map has the golden rows: a group per channel with the tools, programs and sync rows of both its sections, then "Outside the channels"', JSON.stringify(brief(shown)) === JSON.stringify(brief(goldRows)), { got: brief(shown), want: brief(goldRows) })
  h.check('and each row reads as the golden text (the channel names, the tool labels, the wait ids)', goldRows.every((/** @type {any} */ r, /** @type {number} */ i) => shown[i] && shown[i].text.includes(r.text)), goldRows.map((/** @type {any} */ r, /** @type {number} */ i) => (shown[i]?.text.includes(r.text) ? null : [r.text, shown[i]?.text])).filter(Boolean))

  // ---- the tool list with its Channel column
  if (noPython) {
    await expectNoPython(h, 'bundled:tool_list.py', single, 'the tool list', {})
  } else {
    await checkToolList(h, toolsGold.toolList, 'twin-single tool list')
  }

  // ---- Check wait codes
  await checkSync(h)
  checkWaitReport(h, checkGold, { d1: single }, 'Check wait codes under Twin 31i')
  h.check('every row jumps to its line', (await jumpsAll(h)) === true, await jumpsAll(h))
  h.check('the ids that legitimately repeat (M110, M120) produce no finding', !(report(h)?.rows ?? []).some((/** @type {any} */ r) => /\b(10|20)\b: /.test(r.text)), (report(h)?.rows ?? []).map((/** @type {any} */ r) => r.text))

  // ---- Alt+F7 / Shift+Alt+F7 / Mod+Alt+P
  for (const channel of /** @type {const} */ (['channel1', 'channel2'])) {
    const walk = navGold[channel].next
    await goto(h, single, walk[0].from)
    const got = []
    for (const step of walk) got.push(await stepTo(h, keys.next, step.to))
    h.check(`Alt+F7 walks the marks of ${channel} across both its sections and wraps (${walk.map((/** @type {any} */ s) => s.to).join(', ')})`, JSON.stringify(got) === JSON.stringify(walk.map((/** @type {any} */ s) => s.to)), got)
    const back = navGold[channel].previousFromFirst
    await goto(h, single, back.from)
    h.check(`Shift+Alt+F7 from the first mark of ${channel} goes round to ${back.to}`, (await stepTo(h, keys.prev, back.to)) === back.to, h.app.cursor())
  }
  /** @type {string[]} */
  const wrongPartner = []
  for (const mark of navGold.partners) {
    await goto(h, single, mark.line)
    await press(h, keys.partner)
    const line = h.app.cursor().line
    const want = mark.partner === 'none' ? mark.line : mark.partner.line
    if (line !== want) wrongPartner.push(`line ${mark.line} (${mark.mark}) -> ${line}, want ${want}`)
  }
  h.check(`"Go to the matching mark" lands on the golden line from each of the ${navGold.partners.length} marks (and stays where the check reports the mark)`, wrongPartner.length === 0, wrongPartner)

  // ---- Split into channel documents
  await goto(h, single, 1)
  const before = await listDir(h, dir).catch(() => null)
  const docsBefore = ctx.docs.all().length
  const running = ctx.commands.run('channels.splitToDocuments')
  const alert = await h.alert.wait({ timeout: 8000 })
  h.check('the split warns that it is a one-way copy', !!alert && /do not come back/i.test((alert.texts ?? []).join(' ')), alert)
  await h.alert.click('Split')
  await running
  await h.idle()
  const made = ctx.docs.all().slice(docsBefore)
  const got = made.map((d) => ctx.editor.getLines(d.id, 1, ctx.editor.getLineCount(d.id)).join('\n'))
  h.check('it opens two untitled documents with the golden texts (header and that channel’s two sections, no newline at the end)', made.length === 2 && made.every((d) => !d.path) && got[0] === split1 && got[1] === split2, { count: made.length, diff1: firstDifference(got[0] ?? '', split1), diff2: firstDifference(got[1] ?? '', split2) })
  h.check('and writes nothing to disk', before === null || JSON.stringify(await listDir(h, dir)) === JSON.stringify(before), null)
  await activate(h, single)
  h.check('twin-single.nc is as it was', textNow(h) === text && ctx.docs.get(single)?.dirty !== true)

  // ============================================================ (a2) the partners from the line
  await machines.use('Twin 31i lines')
  await waitChannel(h, (s) => s.present)
  await checkSync(h)
  checkWaitReport(h, linesGold, { d1: single }, '(a2) Twin 31i lines')
  h.check('(a2) among them the finding that a mark names a channel the machine does not have', linesGold.rows.some((/** @type {any} */ r) => r.kind === 'unknown-channel') && (report(h)?.rows ?? []).some((/** @type {any} */ r) => r.line === 44), (report(h)?.rows ?? []).map((/** @type {any} */ r) => r.line))

  // ============================================================ (d) a broken channel block
  await machines.use('Twin broken')
  await h.idle()
  h.check('(d) under "Twin broken" the block reads as layout none: no channel, no layout, no count; at most the notice that the rules are broken', !channelState(h).present || (channelState(h).id === '' && channelState(h).layout === '' && channelState(h).count === '0' && /broken/i.test(channelState(h).text)), channelState(h))
  const brokenItem = channelState(h)
  const hoversBroken = await hoversOfMachineWords(h, single)
  const wantProblems = brokenGold.serviceProblems
  const wantPrefix = wantProblems[1].text.slice(0, wantProblems[1].text.indexOf('is not a valid pattern') + 'is not a valid pattern'.length)
  h.check('(d) whose tooltip says that the channel rules are broken and why (the engine’s own words aside)', !brokenItem.present || (brokenItem.title.includes(wantProblems[0].text) && brokenItem.title.includes(wantPrefix)), brokenItem.title)
  const page = await openMachinesPage(h)
  const broken = machineRows(h).find((r) => r.name === 'Twin broken')
  h.check('(d) the Machines page lists the machine with a problem', (broken?.problems ?? 0) >= 1, machineRows(h).map((r) => `${r.name}:${r.problems}`))
  const problemText = [...(broken?.element.querySelectorAll('.problem') ?? [])].map((p) => (p.textContent ?? '').trim())
  const wantProblem = brokenGold.problems[0]
  const prefix = wantProblem.message.slice(0, wantProblem.message.indexOf('is not a valid pattern') + 'is not a valid pattern'.length)
  h.check(`(d) naming the path "${wantProblem.path}" (the page adds the record's place: machines[3]...) and "${prefix}" (the rest is the engine's own wording)`, problemText.some((t) => t.includes(wantProblem.path.replace(/^machines\./, '')) && t.includes(prefix)), problemText)
  await closeSettings(h, page)
  const checkHoverUnderValid = async () => {
    await machines.use('Twin 31i')
    await h.idle()
    const hoversValid = await hoversOfMachineWords(h, single)
    h.check('(d) the hover on X, S and F is the same words under "Twin 31i" as under "Twin broken", byte for byte', hoversValid.every((x) => x !== '') && JSON.stringify(hoversValid) === JSON.stringify(hoversBroken), { broken: hoversBroken, valid: hoversValid })
  }
  if (noPython) await checkHoverUnderValid()
  else {
    const { envelope: broke } = await runReplace(h, SCRIPTS.arithmetic, () => fillForm(h, { operation: pick('subtract', OPERATIONS.indexOf('subtract')), operand: 0.5, addresses: ['Z'] }))
    h.check('(d) address arithmetic under the broken machine says what the golden says', broke?.message === brokenGold.arithMessage.broken, { got: broke?.message, want: brokenGold.arithMessage.broken })
    const afterBroken = textNow(h)
    await undo(h)
    await checkHoverUnderValid()
    const { envelope: valid } = await runReplace(h, SCRIPTS.arithmetic, () => fillForm(h, { operation: pick('subtract', OPERATIONS.indexOf('subtract')), operand: 0.5, addresses: ['Z'] }))
    h.check('(d) and the document and the arithmetic text are byte-identical to the run under the valid channel block', textNow(h) === afterBroken && valid?.message === brokenGold.arithMessage.valid, { diff: firstDifference(textNow(h), afterBroken), message: valid?.message })
    await undo(h)
  }

  // ============================================================ (b) one file per channel
  const dirCh = await exitDir(h)
  const ch1 = await open(h, `${dirCh}/twin_CH1.nc`)
  await machines.use('Twin 31i multi')
  const lone = await waitChannel(h, (s) => s.present && s.layout === 'multi-file')
  h.check('(b) twin_CH1.nc alone shows "Channel 1 of 2" and that channel 2 is found, not open', lone.id === '1' && /1 of 2/.test(lone.text) && lone.open === '1' && lone.missing === '' && /not open/.test(lone.text), lone)
  await h.dialogs.queue('open', [`${dirCh}/twin_CH2.nc`])
  await pickEntry(h, 'channels.select', OPEN_OTHERS)
  const ch2 = ctx.docs.byPath(`${dirCh}/twin_CH2.nc`)?.id
  h.check('(b) "Open the other channels…" opens the file the user picks', ch2 !== undefined, ctx.docs.all().map((d) => d.title))
  if (ch2 === undefined) throw new Error('channel 2 did not open')
  await activate(h, ch1)
  await machines.use('Twin 31i multi')
  await waitChannel(h, (s) => s.open === '1 2' && s.id === '1')
  await checkSync(h)
  checkWaitReport(h, multiGold, { d1: ch1, d2: ch2 }, '(b) Twin 31i multi')
  h.check('(b) each row jumps into its own document', (await jumpsAll(h)) === true, await jumpsAll(h))
}

/** @param {import('$lib/app/types').AppContext} ctx */
const machineNames = (ctx) => /** @type {any[]} */ ((/** @type {any} */ (ctx)).machines.compatibleWith('fanuc-lathe')).map((m) => m.name)

/**
 * Clicks every row of the report that names a line and checks that the cursor lands on that line in that document.
 * @param {Harness} h
 */
async function jumpsAll(h) {
  const rows = resultRows(h)
  /** @type {string[]} */
  const wrong = []
  for (const row of rows) {
    h.click(row.element)
    const ok = await h.waitFor(() => h.app.cursor().line === row.line && (row.docId === '' || activeId(h) === row.docId), { timeout: 3000 })
    if (!ok) wrong.push(`${row.docId}:${row.line} -> ${activeId(h)}:${h.app.cursor().line}`)
  }
  return rows.length > 0 && wrong.length === 0 ? true : wrong.length === 0 ? 'no rows' : wrong
}

scenario('exit2-x12', { timeout: 900 }, async (h) => {
  await runX12(h)
})
