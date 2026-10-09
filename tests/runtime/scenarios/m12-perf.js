// G7 for M12 (plan §6 M12 H12 `m12-perf`): a document with channels at the size that matters
// (F54: over 300,000 lines), and the wait-code check at the contract cap.
//
// **The program** is generated here: lines 1-4 are a header, then two sections `O2101` (channel 1)
// and `O2102` (channel 2) of 150,000 motion lines each, with a wait `M9xx P12` every fifteenth line
// (the ids cycle through M900-M999, the same sequence in both channels) and a tool change every 3,000
// lines. That is exactly 10,000 waits per channel, 20,000 marks: the cap of the contract (§7.17,
// "≤ 20,000 marks per document"), so a check that is fast on a comfortable sample and slow at the cap
// shows here. The two channels are identical in their waits, so the check has nothing to find, and
// the scenario holds it to that: a budget met by a check that gave up (`truncated`) is no budget.
//
// **What is measured, and against which number**
//
//   - open: the P1 open budget (2 s), with the channel machine already the dialect's default;
//   - first resolution: from choosing the machine on an open 300k-line document to the channel item
//     showing the result, ≤ 150 ms (the plan's figure for "300k lines with two rules"). This is the end
//     to end figure a user waits, the resolution included but also the render of the item;
//   - typing: the P1 keypress budget (p95 under 50 ms on screen, `m3-perf`'s way of measuring it),
//     with channels on, and no more than one frame slower than with channels off on the same document;
//   - the program map: the outline after an edit, grouped by channel, inside the P1 outline budget
//     (200 ms from the edit to the frame that draws the new tool row);
//   - the check at the cap: ≤ 1,000 ms, the contract's own limit after which it truncates (§7.17),
//     and it must not have truncated.
//
// The correctness of what is measured is checked from the text: both channels' ranges, 20,000 marks,
// no finding.

import { scenario } from '../lib/index.js'
import { plain } from './m3-common.js'
import { guard, splitLines } from './m10-common.js'
import { ribbonTab } from './m4-common.js'
import { channelMachines, channelState, context, mapRows, ready, report, waitChannel } from './m12-common.js'

/** The budgets this gate enforces. */
const OPEN_BUDGET_MS = 2000
const RESOLUTION_BUDGET_MS = 150
const KEYPRESS_P95_BUDGET_MS = 50
const OUTLINE_BUDGET_MS = 200
const CHECK_BUDGET_MS = 1000
/** How much slower than without channels typing may be: one frame at 60 Hz. */
const TYPING_COST_BUDGET_MS = 17
const FRAME_MS = 17
const KEYSTROKES = 40
const EDITS = 6
const MAX_RETRIES = 2

const PER_CHANNEL = 150000
const WAIT_EVERY = 15

/** The channel block of the generated program: two sections by program number, the `M9xx` waits. */
const BLOCK = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  sectionStart: '^O21\\d\\d(?![\\d.])',
  syncMarks: [
    {
      id: 'wait',
      label: 'Wait M900-M999, P = path numbers',
      match: { kind: 'codes', codes: 'M900-M999' },
      partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' } },
    },
  ],
}

/** @returns {{ text: string, ranges: Record<string, [number, number]>, marks: number }} */
function generate() {
  const lines = ['(WRITTEN FOR GEDIT - SYNTHETIC PERFORMANCE PROGRAM, NOT FOR A MACHINE)', '(TWO CHANNELS IN ONE FILE, 10000 WAITS EACH)', '%', 'G21 G40 G99']
  /** @type {Record<string, [number, number]>} */
  const ranges = {}
  let marks = 0
  for (const channel of ['1', '2']) {
    const start = lines.length + 1
    lines.push(`O210${channel} (CHANNEL ${channel})`)
    let wait = 0
    let x = 0
    for (let i = 1; i <= PER_CHANNEL; i++) {
      if (i % 3000 === 1) lines.push(`T0${channel}0${1 + (i / 3000 | 0) % 8} (TOOL)`)
      else if (i % WAIT_EVERY === 0) {
        lines.push(`M${900 + (wait++ % 100)} P12`)
        marks++
      } else {
        x = (x + 0.25) % 80
        lines.push(`G01 X${x.toFixed(3)} Z-${(i % 40).toFixed(3)} F0.2`)
      }
    }
    lines.push(channel === '1' ? 'M99' : 'M30')
    ranges[channel] = [start, lines.length]
  }
  lines.push('%')
  return { text: lines.join('\n') + '\n', ranges, marks }
}

/** Percentile of a sample, nearest rank. @param {number[]} values @param {number} p */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

scenario('m12-perf', { timeout: 1200 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const program = generate()
  const lines = splitLines(program.text)
  const path = `${h.cfg.run}/m12-perf-300k.nc`
  await h.disk.write(path, program.text)
  h.check(`the generated program has ${lines.length} lines (over 300,000), two sections and ${program.marks} waits`, lines.length > 300000 && program.marks === 20000, { lines: lines.length, marks: program.marks, ranges: program.ranges })

  const machines = channelMachines(h)
  const machineId = await machines.add('Perf lathe', BLOCK)

  /** Resolves at the moment a DOM change makes `predicate` true, sampling on every mutation. @param {() => boolean} predicate @param {number} timeout @returns {Promise<number | null>} */
  const untilDom = (predicate, timeout) =>
    new Promise((resolve) => {
      if (predicate()) return resolve(performance.now())
      /** @param {number | null} value */
      const done = (value) => {
        observer.disconnect()
        clearTimeout(timer)
        resolve(value)
      }
      const observer = new MutationObserver(() => {
        if (predicate()) done(performance.now())
      })
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
      const timer = setTimeout(() => done(null), timeout)
    })
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())))
  const drawn = (/** @type {string} */ text) => {
    for (const line of h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? []) if (plain(line.textContent) === text) return true
    return false
  }

  /**
   * Types `KEYSTROKES` characters at the end of a line and measures each one (`m3-perf`'s way).
   * @param {string} id @param {number} line
   */
  const measureTyping = async (id, line) => {
    const modelLine = () => ctx.editor.getLines(id, line, line)[0] ?? ''
    const focus = async () => {
      ctx.editor.reveal(id, line, modelLine().length + 1)
      await h.idle()
      return h.focusEditor() && h.app.cursor().line === line
    }
    const focused = await focus()
    await h.nativeKeys([{ key: '1' }])
    let warmed = (await untilDom(() => drawn(modelLine()), 15000)) !== null
    if (!warmed) {
      await focus()
      await h.nativeKeys([{ key: '1' }])
      warmed = (await untilDom(() => drawn(modelLine()), 15000)) !== null
    }
    /** @type {number[]} */
    const dom = []
    /** @type {number[]} */
    const keydownAt = []
    let retries = 0
    const stamp = () => keydownAt.push(performance.now())
    window.addEventListener('keydown', stamp, true)
    try {
      for (let i = 0; i < KEYSTROKES; i++) {
        const want = `${modelLine()}1`
        keydownAt.length = 0
        let waiting = untilDom(() => drawn(want), 5000)
        await h.nativeKeys([{ key: '1' }])
        let shown = await waiting
        if (shown === null && modelLine() !== want) {
          retries++
          await focus()
          keydownAt.length = 0
          waiting = untilDom(() => drawn(want), 5000)
          await h.nativeKeys([{ key: '1' }])
          shown = await waiting
        }
        if (shown === null || keydownAt.length === 0) break
        await nextPaint()
        dom.push(shown - keydownAt[0])
      }
    } finally {
      window.removeEventListener('keydown', stamp, true)
    }
    return { focused, warmed, retries, count: dom.length, domP95: dom.length > 0 ? Math.round(percentile(dom, 95)) : -1, samples: dom.map(Math.round) }
  }

  // ==================================================================== A. open, with the channel machine the default
  /** @type {string} */
  let id = ''
  await guard(h, 'A. open', async () => {
    await ctx.machines.setDefault('fanuc-lathe', machineId)
    await h.dialogs.queue('open', path)
    const started = performance.now()
    const opened = await ctx.files.open()
    id = opened[0] ?? ''
    const rendered = await untilDom(() => h.q('editor-host')?.dataset.docId === id && drawn('%'), 60000)
    const openMs = Math.round((rendered ?? performance.now()) - started)
    h.check('the program is open and drawn, as a Fanuc lathe program', !!id && rendered !== null && ctx.docs.get(id)?.profileId === 'fanuc-lathe', { profile: ctx.docs.get(id)?.profileId })
    h.checkTime(`it opens and renders within the open budget, with a channel machine, at ${lines.length} lines`, openMs, OPEN_BUDGET_MS)
    h.log(`open: ${openMs} ms`)
    await h.waitFor(() => ctx.editor.getLineCount(id) === lines.length, { timeout: 120000, interval: 50 })
    await waitChannel(h, (s) => s.present, 30000)
    await ctx.outline.whenReady(id)
    // Phase 3 (P3a, an intentional change): an opened program is also read by the modal index in idle slices of up to
    // 16 ms (about 2.4 s at this size), and a measurement that starts while it is still going (section C chooses a
    // machine next) would time the index's slices as well: first resolution read 437 ms on the first attempt of a
    // cumulative run, 74 ms on the retry. The steady state is what these budgets are about, as with the outline above.
    await ctx.modal.whenReady(id)
    await h.idle({ timeout: 60000 })
  })
  if (id === '') throw new Error('the program did not open')

  // ==================================================================== B. what was resolved
  await guard(h, 'B. the resolution is right', async () => {
    const set = ctx.channels.forDoc(id)
    const sections = set.members.filter((m) => m.kind === 'section')
    const got = Object.fromEntries(sections.map((m) => [m.channel.id, m.kind === 'section' ? m.ranges.map((r) => [r.startLine, r.endLine]) : []]))
    h.check(
      'both sections are found, each channel on the lines it was generated on, as one range (the last runs to the end of the document, the closing "%" and the empty last line with it)',
      JSON.stringify(got) === JSON.stringify({ 1: [program.ranges['1']], 2: [[program.ranges['2'][0], ctx.editor.getLineCount(id)]] }),
      { got, want: program.ranges, lineCount: ctx.editor.getLineCount(id) },
    )
    h.check(`the ${program.marks} waits are all found (the contract cap), none dropped, none outside`, set.marks.length === program.marks && set.marks.every((m) => m.channel === '1' || m.channel === '2'), { marks: set.marks.length, problems: set.problems.map((p) => p.message.key) })
    h.check('and there is no problem to report', set.problems.length === 0, set.problems.map((p) => p.message.key))
  })

  // ==================================================================== C. the first resolution
  await guard(h, 'C. first resolution', async () => {
    ctx.machines.setForDoc(id, null)
    await waitChannel(h, (s) => !s.present, 30000)
    await h.idle({ timeout: 30000 })
    const started = performance.now()
    ctx.machines.setForDoc(id, machineId)
    const shown = await untilDom(() => channelState(h).present && channelState(h).layout === 'single-file', 30000)
    const ms = Math.round((shown ?? performance.now()) - started)
    h.checkTime(`choosing the machine on the open ${lines.length}-line document shows its channel in the status item`, ms, RESOLUTION_BUDGET_MS, { shown: shown !== null, state: channelState(h) }, { also: shown !== null })
    h.log(`first resolution: ${ms} ms`)
    await h.idle({ timeout: 30000 })
  })

  // ==================================================================== D. typing
  await guard(h, 'D. typing', async () => {
    const line = program.ranges['1'][0] + 70000
    ctx.machines.setForDoc(id, null)
    await waitChannel(h, (s) => !s.present, 30000)
    await h.idle({ timeout: 30000 })
    const without = await measureTyping(id, line)
    ctx.machines.setForDoc(id, machineId)
    await waitChannel(h, (s) => s.present, 30000)
    await h.idle({ timeout: 30000 })
    const withChannels = await measureTyping(id, line)
    h.check('every keystroke reached the screen, with and without channels', without.count === KEYSTROKES && withChannels.count === KEYSTROKES && without.warmed && withChannels.warmed && withChannels.retries <= MAX_RETRIES && without.retries <= MAX_RETRIES, { without, withChannels })
    h.checkTime(`keypress to render at ${lines.length} lines with channels on: drawn ${withChannels.domP95} ms after the keydown, on screen within`, withChannels.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { withChannels, without }, { also: withChannels.count === KEYSTROKES, strict: true })
    h.checkTime(`and channels cost typing nothing: drawn in ${withChannels.domP95} ms against ${without.domP95} ms with no machine`, withChannels.domP95 - without.domP95, TYPING_COST_BUDGET_MS, { withChannels: withChannels.domP95, without: without.domP95 })
    h.log(`typing p95 (drawn): ${withChannels.domP95} ms with channels, ${without.domP95} ms without`)
    // The channels hold after the typing: the same waits are found.
    await h.waitFor(() => ctx.channels.forDoc(id).marks.length === program.marks + 0, { timeout: 20000 })
    h.check('after the typing the channels are still resolved: same waits, same sections', ctx.channels.forDoc(id).marks.length === program.marks && ctx.channels.forDoc(id).layout === 'single-file', { marks: ctx.channels.forDoc(id).marks.length })
  })

  // ==================================================================== E. the check at the cap
  await guard(h, 'E. the check at the cap', async () => {
    await h.idle({ timeout: 60000 })
    const started = performance.now()
    const result = ctx.channels.check(id)
    const ms = Math.round(performance.now() - started)
    h.checkTime(`the wait-code check over ${program.marks} waits (the contract cap) and two channels`, ms, CHECK_BUDGET_MS, { findings: result.findings.length, truncated: result.truncated }, { also: result.truncated === false })
    h.check('and it finished and found nothing, as the two channels wait on the same codes in the same order', result.truncated === false && result.findings.length === 0 && result.checked.length === 2, { truncated: result.truncated, findings: result.findings.length, checked: result.checked })
    // The same through the button, to the Results panel.
    const before = report(h)
    await ribbonTab(h, 'tools')
    const clicked = performance.now()
    h.click(h.q('cmd-button', { command: 'channels.checkSync' }))
    await h.waitFor(() => report(h) !== before, { timeout: 60000, interval: 5 })
    const endToEnd = Math.round(performance.now() - clicked)
    h.log(`check at the cap: ${ms} ms in the service, ${endToEnd} ms from the click to the report`)
    h.check('the button reports it too: all match, no row', report(h) !== before && /all match/.test(/** @type {any} */ (report(h))?.title ?? '') && (/** @type {any} */ (report(h))?.rows ?? []).length === 0, { endToEndMs: endToEnd, title: /** @type {any} */ (report(h))?.title })
  })

  // ==================================================================== F. the map, grouped (last: an edit here keeps the app busy for a long time)
  await guard(h, 'F. the program map', async () => {
    await h.waitFor(() => mapRows(h).some((r) => r.kind === 'channel'), { timeout: 60000 })
    h.check('the map of the whole program is grouped by channel', mapRows(h).filter((r) => r.kind === 'channel').map((r) => r.channelId).join() === '1,2,', mapRows(h).filter((r) => r.kind === 'channel').map((r) => `${r.channelId}`))
    h.log(`program map rows in the DOM: ${mapRows(h).length} (${mapRows(h).filter((r) => r.kind === 'sync').length} sync rows)`)
    // M12 fix F1: 10,000 waits per channel are one row each with their number, on the first wait,
    // not 20,000 rows (which took 7-14 s to redraw on every edit).
    const syncRows = h.qa('program-map-item').filter((e) => e.dataset.kind === 'sync')
    const firstWait = (/** @type {string} */ channel) => ctx.channels.forDoc(id).marks.find((m) => m.channel === channel)?.line
    h.check(
      'each channel’s 10,000 waits are one map row with their number, on the channel’s first wait',
      syncRows.length === 2 && syncRows.every((e) => e.dataset.count === '10000') && syncRows.map((e) => Number(e.dataset.line)).join() === [firstWait('1'), firstWait('2')].join(),
      syncRows.map((e) => `${e.dataset.line}:${e.dataset.count}`),
    )
    /** @type {number[]} */
    const outlineMs = []
    for (let i = 0; i < EDITS; i++) {
      const at = program.ranges['1'][0] + 20000 + i * 1000
      ctx.editor.reveal(id, at, 1)
      await h.idle()
      const waiting = untilDom(() => !!h.q('program-map-item', { kind: 'tool', line: at }), 15000)
      const edited = performance.now()
      ctx.editor.insertText('T9 M6\n')
      const shown = await waiting
      if (shown === null) break
      outlineMs.push((await nextPaint()) - edited)
      ctx.editor.triggerAction('undo')
      await h.waitFor(() => !h.q('program-map-item', { kind: 'tool', line: at }), { timeout: 15000 })
    }
    const worst = outlineMs.length > 0 ? Math.round(Math.max(...outlineMs)) : -1
    h.check(`all ${EDITS} edits were picked up by the grouped map`, outlineMs.length === EDITS, { measured: outlineMs.length })
    h.checkTime('the grouped map is up to date after an edit, worst (the P1 outline budget)', worst, OUTLINE_BUDGET_MS, { samples: outlineMs.map(Math.round) }, { also: outlineMs.length === EDITS })
    h.log(`grouped map after an edit: worst ${worst} ms`)
  })

})
