// G7 for P3a (Phase 3 plan H3a `p3-perf`; X17): the modal index, the inspector, the hover and the motion
// colours on a 300,000-line program (the program of `m1-perf-open`, 10 MB, CRLF, a Fanuc mill).
//
// **What is measured, and against which number.** Every wall-clock figure goes through `h.checkTime`, which
// holds it to the development Mac's budget locally and to 10 times that on a hosted runner.
//
//   A. The index build never blocks the UI. From the moment the opened program is drawn until the modal
//      index covers it (`ctx.modal.whenReady`), a 4 ms timer keeps ticking; the longest gap between two ticks is
//      the longest stall, held to `STALL_BUDGET_MS` (the plan: idle slices of 8 ms since P3b, 16 ms in P3a, plus a frame).
//   B. Hover at line 300,000: the context line is there, and the hover costs at most `HOVER_BUDGET_MS` more
//      than the same hover at line 10 of the same document. Right after an edit at line 1 the index has
//      dropped its later snapshots, so the same far hover is the Phase 2 text and nothing stale; the inspector
//      says it is waiting; when the index has caught up both are in context.
//   C. The inspector open while typing. The Phase 1 typing budget (p95 of keypress to screen under 50 ms)
//      holds with the inspector open and the colours on, and costs at most a frame more than with both off.
//      Moving the cursor with the panel open updates the panel within `INSPECTOR_BUDGET_MS` of the cursor move
//      (one animation frame and two state reads), also while typing.
//   D. The colours follow a scroll to the middle of the program: marks on the visible lines within
//      `COLOR_BUDGET_MS` of the scroll, only on the visible lines and `marginLines` above and below, never
//      more than `MAX_MARKS` in all.
//   E. A machine switch rebuilds the index in idle chunks: the same stall budget while it rebuilds, the hover
//      is the Phase 2 text until it has caught up, and the colours come back.
//   F. (H3b, plan P3a known gap 9 and P3b known gap 15) A 300,000-line Klartext program, the dialect whose index is the
//      most expensive to build: the same stall budget while it builds in 8 ms slices, how long the build takes on the
//      wall clock (nothing waits for it, so the budget only catches a build that stops finishing), and the hover at the
//      far end once it has.

import { scenario } from '../lib/index.js'
import { largeProgram, plain, revealLine } from './m3-common.js'
import { guard, machineMaker, splitLines } from './m10-common.js'
import { ready } from './m4-common.js'
import { clickMotionColors, context, drawn, hoverLatency, hoverOn, inspectorPanel, markCount, markDecorations, measureTyping, nextPaint, showInspector, untilDom, watchRebuild } from './p3-common.js'

/** The budgets this gate enforces. */
const STALL_BUDGET_MS = 64
const HOVER_BUDGET_MS = 50
const INSPECTOR_BUDGET_MS = 30
const COLOR_BUDGET_MS = 100
const KEYPRESS_P95_BUDGET_MS = 50
const FRAME_MS = 17
/** The cost of the inspector and the colours for typing: one frame (the same allowance as `m12-perf`). */
const TYPING_COST_BUDGET_MS = 17
/**
 * The wall-clock time from the opened program to a finished index of a 300,000-line Klartext program (idle slices of
 * 8 ms). Nothing waits for it (AD-33), so the budget is not a user-visible figure: it is twice what the development
 * Mac measured on the P3b build (2.8-3.8 s after the open, as long as the mill program's 2.7-3.9 s: the wall time of
 * an idle build is the idle callbacks, not the work, which is 0.9-1.6 s of CPU in node), so that a build which has
 * become much slower, or no longer finishes, is caught.
 */
const KLARTEXT_BUILD_BUDGET_MS = 8000
const KEYSTROKES = 40
const MOVES = 20
const MAX_RETRIES = 2
/** `MOTION_BUDGETS` of `core/nc/motion.ts`: lines of margin above and below the visible ones, and the cap. */
const MARGIN_LINES = 100
const MAX_MARKS = 1000

/**
 * The stall check of one rebuild: the longest gap after the outline's own build was done (see `watchRebuild`),
 * held to the budget; and a check that such a window existed, so a rebuild the outline hid is not a pass.
 * @param {import('../lib/api.js').Harness} h
 * @param {string} what
 * @param {Awaited<ReturnType<typeof watchRebuild>>} r
 */
function checkStall(h, what, r) {
  h.log(`${what}: outline ready at ${r.done.outline} ms, index at ${r.done.modal} ms; worst gap ${r.worstAll} ms, after the outline ${r.worstAfterOutline}; gaps over 30 ms: ${r.gaps.map((g) => `${g.at}:${g.gap}`).join(' ')}`)
  h.check(`${what}: the index outlasted the outline's own build, so its chunks can be told apart (index ${r.done.modal} ms, outline ${r.done.outline} ms)`, r.isolated, r.done)
  h.checkTime(`${what}: the page is never stalled by the index, the longest gap between two 4 ms ticks after the outline was done`, r.worstAfterOutline ?? r.worstAll, STALL_BUDGET_MS, { done: r.done, gaps: r.gaps.slice(0, 20) }, { also: r.isolated })
}

/**
 * A deterministic 300,000-line Klartext program: a header, a tool call and a long run of numbered straight moves,
 * CRLF throughout (the shape of `largeProgram`, in the dialect whose tokenizer is the most expensive).
 * @param {number} [minLines]
 */
function largeKlartext(minLines = 300000) {
  const lines = ['0 BEGIN PGM PERF MM', '1 BLK FORM 0.1 Z X+0 Y+0 Z-20', '2 BLK FORM 0.2 X+100 Y+80 Z+0', '3 TOOL CALL 1 Z S3000', '4 L Z+25 R0 FMAX M3', '5 L X+0 Y+0 R0 FMAX', '6 L Z-1 R0 F200']
  let n = lines.length
  let x = 0
  let y = 0
  let direction = 1
  const signed = (/** @type {number} */ value) => `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(3)}`
  while (lines.length < minLines - 1) {
    x += 0.5 * direction
    if (x > 100 || x < 0) {
      direction = -direction
      x += 0.5 * direction
      y = y >= 80 ? 0 : y + 1
    }
    const z = -2 + Math.sin(x / 7) * Math.cos(y / 5)
    lines.push(`${n++} L X${signed(x)} Y${signed(y)} Z${signed(z)} R0 F800`)
  }
  lines.push(`${n} END PGM PERF MM`)
  return lines.join('\r\n') + '\r\n'
}

scenario('p3-perf', { timeout: 1500 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const text = largeProgram()
  const lines = splitLines(text)
  const path = `${h.cfg.run}/p3-perf-300k.nc`
  await h.disk.write(path, text)
  h.check(`the generated program has ${lines.length} lines (300,000 or more)`, lines.length >= 300000, lines.length)
  const FAR = lines.length - 20
  const far = (/** @type {string} */ what) => `${what} at line ${FAR}`

  // ==================================================================== A. open, then the index build
  /** @type {string} */
  let id = ''
  await guard(h, 'A. open and the index build', async () => {
    await h.dialogs.queue('open', path)
    const started = performance.now()
    const opened = await ctx.files.open()
    id = opened[0] ?? ''
    const shown = await untilDom(() => h.q('editor-host')?.dataset.docId === id && drawn(h, '%'), 60000)
    h.log(`open: ${Math.round((shown ?? performance.now()) - started)} ms`)
    h.check('the program is open, drawn, and read as a Fanuc mill program', shown !== null && ctx.docs.get(id)?.profileId === 'fanuc-gcode', ctx.docs.get(id)?.profileId)
    await h.waitFor(() => ctx.editor.getLineCount(id) >= lines.length, { timeout: 120000, interval: 50 })
    // From here on nothing but the background work is going on; the timer measures what it does to the page.
    // The opened program's first outline build and the index build run side by side; see `watchRebuild`.
    const first = await watchRebuild(h, id, async () => {})
    checkStall(h, `the index of ${lines.length} lines after the open`, first)
    h.check('the index answers at the far end: a state after the last lines', ctx.modal.stateAfter(id, FAR) !== null && ctx.modal.stateAfter(id, 0) !== null)
  })
  if (id === '') throw new Error('the program did not open')
  await ctx.outline.whenReady(id)
  await h.idle({ timeout: 60000 })

  // ==================================================================== B. the hover at the far end
  await guard(h, 'B. hover', async () => {
    /** The fastest of a few hovers at a line, trigger to content, and the last hover read. @param {number} line @param {string} word */
    const hoverMs = async (line, word) => {
      const text = ctx.editor.getLines(id, line, line)[0] ?? ''
      const column = text.indexOf(word) + 2
      let best = Infinity
      for (let i = 0; i < 4; i++) {
        // Another word in between, so each hover is a new content to wait for.
        await hoverOn(h, id, line, text.split(' ').at(-1) ?? word)
        const ms = await hoverLatency(h, id, line, column)
        if (ms >= 0) best = Math.min(best, ms)
      }
      return { best: Math.round(best * 10) / 10, last: await hoverOn(h, id, line, word) }
    }
    const near = await hoverMs(3, 'G21')
    const farText = ctx.editor.getLines(id, FAR, FAR)[0] ?? ''
    const word = farText.split(' ')[1] // the X word
    const atFar = await hoverMs(FAR, word)
    h.log(`hover: line 2 ${near.best} ms, line ${FAR} ${atFar.best} ms`)
    h.check(`the hover at line ${FAR} has its context line: ${word} is a target, absolute`, atFar.last.last.startsWith('X — ') && atFar.last.last.includes(ctx.t('assistant.context.target')) && atFar.last.last.includes(ctx.t('assistant.context.absolute')), atFar.last.last)
    h.checkTime(`${far('hover')}, from the trigger to the content with the context (line 3: ${near.best} ms)`, atFar.best, HOVER_BUDGET_MS, { near: near.best, far: atFar.best }, { also: atFar.best > 0 })
    const feed = await hoverOn(h, id, FAR, 'F800.')
    h.check(`F800. at line ${FAR} is a feed per minute (G94)`, feed.last === `F — ${ctx.t('assistant.context.withCode', { what: ctx.t('assistant.context.feedPerMinute'), code: 'G94' })}`, feed.last)
  })

  // ==================================================================== B2. an edit at the top drops the later states
  await guard(h, 'B2. nothing stale', async () => {
    const wordOf = () => ctx.editor.getLines(id, FAR, FAR)[0].split(' ')[1]
    // The far hover as it is with the index: the text to compare with.
    const withContext = await hoverOn(h, id, FAR, wordOf())
    ctx.editor.reveal(id, 1, 1)
    await h.idle()
    const insert = await watchRebuild(h, id, () => {
      ctx.editor.insertText('G55\n')
    })
    checkStall(h, 'an edit at line 1 (the index drops every later snapshot and rebuilds)', insert)
    const caught = await hoverOn(h, id, FAR, wordOf())
    // The inserted G55 is the work offset of every move after it (the header never sets one).
    h.check('the far hover is in context again and the context is the new one: the inserted G55 is the work offset of the far X, which it did not say before', caught.last.startsWith('X — ') && caught.last.includes(ctx.t('assistant.context.workOffset', { code: 'G55' })) && !withContext.last.includes(ctx.t('assistant.context.workOffset', { code: 'G55' })), { before: withContext.last, after: caught.last })
    // Now the other way, looked at while it is happening: the Undo is an edit at line 1 too.
    await showInspector(h)
    ctx.editor.triggerAction('undo')
    const dropped = ctx.modal.stateAfter(id, FAR) === null
    h.check('the Undo drops the later snapshots at once: the state at the far end is not there until it is rebuilt', dropped, dropped)
    ctx.editor.reveal(id, FAR, 1)
    await h.frame()
    await h.waitFor(() => h.q('inspector-panel')?.dataset.docId === id && Number(h.q('inspector-panel')?.dataset.firstLine) >= FAR - 5, { timeout: 8000 })
    const waiting = h.q('inspector-panel')?.dataset.ready === '0'
    if (dropped && waiting) h.check('while the index has not reached it the inspector says it is waiting, and lists no state rows', !!h.q('inspector-waiting') && h.qa('inspector-state').length === 0, h.q('inspector-panel')?.textContent?.slice(0, 120))
    else h.log(`the inspector was ${waiting ? 'waiting' : 'already ready'}; the build was faster than the check (not a failure)`)
    if (dropped) {
      const stale = await hoverOn(h, id, FAR, wordOf())
      const reached = ctx.modal.stateAfter(id, FAR) !== null
      // The Phase 2 text is the explanation without the context line; a hover that arrives after the build has
      // got there may be in context, and then it must be the context of the program as it is now (no G55).
      h.check('the far hover right after the Undo never carries the old offset: it is the Phase 2 text, or the new context', stale.paragraphs[0] === withContext.paragraphs[0] && !stale.last.includes(ctx.t('assistant.context.workOffset', { code: 'G55' })) && (reached || stale.paragraphs.length === withContext.paragraphs.length - 1), { now: stale.paragraphs.slice(-2), before: withContext.paragraphs.slice(-2) })
    }
    await ctx.modal.whenReady(id)
    await h.waitFor(() => h.q('inspector-panel')?.dataset.ready === '1', { timeout: 10000 })
    const back = await hoverOn(h, id, FAR, wordOf())
    h.check('when the index has caught up the hover is in context again and the inspector shows the state', back.last === withContext.last && h.qa('inspector-state').length > 0, { last: back.last, rows: h.qa('inspector-state').length })
    await ctx.outline.whenReady(id)
    await h.idle({ timeout: 30000 })
  })

  // ==================================================================== C. typing with the inspector open and the colours on
  await guard(h, 'C. typing', async () => {
    const line = 150000
    // First: both off.
    await ctx.settings.save({ 'assist.motionColors': false })
    await h.waitFor(() => markCount(h) === 0, { timeout: 5000 })
    if (inspectorPanel(h)) await ctx.commands.run('view.toggleInspector')
    await h.waitFor(() => !inspectorPanel(h), { timeout: 5000 })
    await ctx.modal.whenReady(id)
    await h.idle({ timeout: 30000 })
    const without = await measureTyping(h, id, line, KEYSTROKES)
    // Then: the inspector open on that line, the colours on.
    await ctx.settings.save({ 'assist.motionColors': true })
    await showInspector(h)
    await ctx.modal.whenReady(id)
    await h.idle({ timeout: 30000 })
    ctx.editor.reveal(id, line, 1)
    await h.waitFor(() => markCount(h) > 0 && h.q('inspector-panel')?.dataset.ready === '1', { timeout: 10000 })
    const withBoth = await measureTyping(h, id, line + 1, KEYSTROKES)
    h.check('every keystroke reached the screen, with and without', without.count === KEYSTROKES && withBoth.count === KEYSTROKES && without.warmed && withBoth.warmed && without.retries <= MAX_RETRIES && withBoth.retries <= MAX_RETRIES, { without, withBoth })
    h.checkTime(`keypress to render at ${lines.length} lines with the inspector open and the colours on: drawn ${withBoth.domP95} ms after the keydown, on screen within`, withBoth.domP95 + FRAME_MS, KEYPRESS_P95_BUDGET_MS, { withBoth, without }, { also: withBoth.count === KEYSTROKES, strict: true })
    h.checkTime(`and they cost typing at most a frame: drawn in ${withBoth.domP95} ms against ${without.domP95} ms with both off`, withBoth.domP95 - without.domP95, TYPING_COST_BUDGET_MS, { withBoth: withBoth.domP95, without: without.domP95 })
    h.log(`typing p95 (drawn): ${withBoth.domP95} ms with the inspector and colours, ${without.domP95} ms without`)

    // The panel followed the typing: it shows the line typed on, and the word has the typed digits.
    await ctx.modal.whenReady(id)
    await h.waitFor(() => h.q('inspector-panel')?.dataset.ready === '1', { timeout: 10000 })
    const typedLine = ctx.editor.getLines(id, line + 1, line + 1)[0]
    h.check('after the typing the inspector shows the typed line, with the digits in its feed word', h.q('inspector-panel')?.dataset.firstLine === String(line + 1) && h.qa('inspector-row').some((r) => r.dataset.address === 'F' && plain(r.textContent).startsWith('F800.1')), { line: typedLine, first: h.q('inspector-panel')?.dataset.firstLine })

    // Cursor moves with the panel open: the time from the cursor change to the panel showing the new block.
    const editor = /** @type {any} */ (ctx.editor.editorInstance())
    /** @type {number[]} */
    const lags = []
    for (let i = 0; i < MOVES; i++) {
      const target = line + 50 + i
      const panelHasIt = () => {
        const p = h.q('inspector-panel')
        return !!p && Number(p.dataset.firstLine) === target && p.dataset.ready === '1'
      }
      let cursorAt = 0
      const sub = editor.onDidChangeCursorPosition((/** @type {any} */ e) => {
        if (e.position.lineNumber === target) cursorAt = performance.now()
      })
      const shown = untilDom(panelHasIt, 3000)
      editor.setPosition({ lineNumber: target, column: 1 })
      const t = await shown
      sub.dispose()
      if (t === null || cursorAt === 0) break
      lags.push(t - cursorAt)
      await h.sleep(30)
    }
    const worstLag = lags.length > 0 ? Math.round(Math.max(...lags)) : -1
    const p95 = lags.length > 0 ? Math.round(lags.slice().sort((a, b) => a - b)[Math.min(lags.length - 1, Math.ceil(0.95 * lags.length) - 1)]) : -1
    h.check(`all ${MOVES} cursor moves reached the panel`, lags.length === MOVES, lags.length)
    h.checkTime(`the inspector shows the new block within one frame and two state reads of a cursor move at line ~${line}, p95 (worst ${worstLag} ms)`, p95, INSPECTOR_BUDGET_MS, { samples: lags.map(Math.round) }, { also: lags.length === MOVES })
    h.log(`inspector lag: p95 ${p95} ms, worst ${worstLag} ms`)
  })

  // ==================================================================== D. the colours follow a scroll
  await guard(h, 'D. scroll', async () => {
    await ctx.modal.whenReady(id)
    await h.idle({ timeout: 30000 })
    const stops = [200000, 100000, 250000, 50000]
    /** @type {number[]} */
    const times = []
    for (const stop of stops) {
      const started = performance.now()
      ctx.editor.reveal(id, stop, 1)
      // Marks on the line at the middle of the screen: the program is moves from the header on.
      const shown = await untilDom(() => {
        const rows = [...(h.q('editor-host')?.querySelectorAll('.margin-view-overlays > div') ?? [])]
        const numbers = rows.map((r) => Number(plain(r.querySelector('.line-numbers')?.textContent).trim())).filter((n) => n > 0)
        return numbers.includes(stop) && rows.some((r) => Number(plain(r.querySelector('.line-numbers')?.textContent).trim()) === stop && r.querySelector('.cldr.gedit-motion-mark') !== null)
      }, 5000)
      if (shown !== null) times.push(shown - started)
      await h.idle()
      await ctx.modal.whenReady(id)
      const visible = /** @type {any} */ (ctx.editor.editorInstance()).getVisibleRanges()
      const first = visible[0]?.startLineNumber ?? stop
      const lastLine = visible.at(-1)?.endLineNumber ?? stop
      const marks = markDecorations(h)
      const outside = marks.filter((m) => m.line < first - MARGIN_LINES - 1 || m.line > lastLine + MARGIN_LINES + 1)
      h.check(`scrolled to line ${stop}: ${marks.length} marks, none further than ${MARGIN_LINES} lines from the visible ${first}-${lastLine}, at most ${MAX_MARKS}`, marks.length > 0 && marks.length <= MAX_MARKS && outside.length === 0, { marks: marks.length, outside: outside.slice(0, 3), visible: [first, lastLine] })
    }
    const worst = times.length > 0 ? Math.round(Math.max(...times)) : -1
    h.check(`every scroll showed marks (${times.length} of ${stops.length})`, times.length === stops.length, times)
    h.checkTime(`marks are on the lines within this long of a scroll across ${lines.length} lines, worst of ${stops.length}`, worst, COLOR_BUDGET_MS, { samples: times.map(Math.round) }, { also: times.length === stops.length })
    h.log(`colours after a scroll: ${times.map(Math.round).join(', ')} ms`)
  })

  // ==================================================================== E. a machine switch rebuilds in idle chunks
  await guard(h, 'E. machine switch', async () => {
    const maker = machineMaker(h)
    await maker.add('Perf mill', 'fanuc-gcode', 'calculator')
    const machineId = maker.ids['Perf mill']
    await h.idle()
    const wordAt = ctx.editor.getLines(id, FAR, FAR)[0].split(' ')[1]
    ctx.editor.reveal(id, 3000, 1)
    await h.idle()
    const rebuild = await watchRebuild(h, id, () => {
      ctx.machines.setForDoc(id, machineId)
    })
    checkStall(h, `a machine switch on ${lines.length} lines`, rebuild)
    await nextPaint()
    const caught = await hoverOn(h, id, FAR, wordAt)
    h.check('after it the hover is in context again', caught.last.startsWith('X — ') && caught.last.includes(ctx.t('assistant.context.target')), caught.last)
    await ctx.modal.whenReady(id)
    await revealLine(h, id, 150000, 1)
    await clickMotionColors(h)
    await clickMotionColors(h)
    await h.waitFor(() => markCount(h) > 0, { timeout: 5000 })
    h.check('and the colours are back on the lines of the new state', markCount(h) > 0 && markDecorations(h).length <= MAX_MARKS, markCount(h))
  })
  // ==================================================================== F. a Klartext program of 300,000 lines
  await guard(h, 'F. Klartext', async () => {
    const text = largeKlartext()
    const klines = splitLines(text)
    const kpath = `${h.cfg.run}/p3-perf-300k-klartext.h`
    await h.disk.write(kpath, text)
    h.check(`the generated Klartext program has ${klines.length} lines (300,000 or more)`, klines.length >= 300000, klines.length)
    await h.dialogs.queue('open', kpath)
    const opened = await ctx.files.open()
    const kid = opened[0] ?? ''
    const shown = await untilDom(() => h.q('editor-host')?.dataset.docId === kid && drawn(h, '0 BEGIN PGM PERF MM'), 60000)
    h.check('the program is open, drawn, and read as a Klartext program', shown !== null && ctx.docs.get(kid)?.profileId === 'heidenhain-klartext', ctx.docs.get(kid)?.profileId)
    await h.waitFor(() => ctx.editor.getLineCount(kid) >= klines.length, { timeout: 120000, interval: 50 })
    const build = await watchRebuild(h, kid, async () => {})
    checkStall(h, `the Klartext index of ${klines.length} lines after the open`, build)
    h.log(`Klartext index: ready ${build.done.modal} ms after the open (outline ${build.done.outline} ms)`)
    h.checkTime(`the Klartext index of ${klines.length} lines is complete`, build.done.modal, KLARTEXT_BUILD_BUDGET_MS, { done: build.done })
    const FARK = klines.length - 20
    const farLine = ctx.editor.getLines(kid, FARK, FARK)[0]
    // Another word in between, so the hover to time is a new content to wait for (as in section B).
    await hoverOn(h, kid, FARK, 'F800')
    const ms = await hoverLatency(h, kid, FARK, farLine.indexOf(' X') + 3)
    const hover = await hoverOn(h, kid, FARK, farLine.split(' ')[2])
    h.log(`Klartext hover at line ${FARK}: ${Math.round(ms)} ms`)
    h.check(`the hover at line ${FARK} has its context line: an axis word is a target`, hover.last.startsWith('X — ') && hover.last.includes(ctx.t('assistant.context.target')), hover.last)
    h.checkTime(`Klartext hover at line ${FARK}, from the trigger to the content with the context`, ms, HOVER_BUDGET_MS, {}, { also: ms > 0 })
  })
})
