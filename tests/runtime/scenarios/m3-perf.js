// G7 for M3 (plan §5 M3 "Gates: G7"): on a 10 MB / 300k-line program,
//   - a keypress reaches the screen with a p95 under 50 ms, and
//   - the outline is up to date within 200 ms of an edit.
// The 2 s open budget of the same gate belongs to `m1-perf-open`; it is measured again
// here because this scenario has to open the file anyway, and one number covering both
// milestones is worth more than two taken on different days.
//
// **How keypress to render is taken.** The clock starts when the `keydown` arrives in the
// page — a capture-phase listener on `window`, so it stamps before Monaco sees the event —
// which leaves out the harness's own cost of posting an NSEvent through Rust and the IPC
// bridge. That cost is measured as well, and reported beside the number. Two ends are
// recorded:
//
//   - `dom`: a MutationObserver fires as soon as the rendered view line carries the new
//     character. Monaco writes the DOM inside its own `requestAnimationFrame` render, and
//     the observer's callback is a microtask straight after that write — so this is the
//     frame that shows the character, timed just before its paint.
//   - `paint`: the first `requestAnimationFrame` after the observer fired. This one is an
//     **upper bound that overcounts**: a callback registered from that microtask cannot
//     run in the frame that is already being painted, so it lands a frame or two later.
//     The evidence that it is the apparatus and not the editor is in the run itself — a
//     12-line buffer reports the same ~49 ms while its `dom` number is the same ~17 ms.
//
// The budget is therefore checked against `dom` plus one whole frame (`FRAME_MS`), which
// is the worst the compositor can still add after the DOM write. Both raw numbers stay in
// the check's detail, so the gate can be re-read without re-running it.
//
// **Why a small document is measured too.** The budget exists so that a 300k-line document
// does not choke the editor, and an absolute millisecond figure cannot say that on its
// own: a constant a 12-line buffer pays as well is the input pipeline and the frame time,
// not the size of the program. That comparison is the check that actually speaks about M3.
//
// **Outline after an edit** runs from the edit — `editor.insertText`, the app's own
// one-undo-step path — to the frame in which the program map draws the new tool row. It
// contains the whole chain: `applyChange`, the 150 ms aggregation debounce
// (`AGGREGATE_DELAY_MS`), the store publish and the Svelte render. 150 ms of the 200 ms
// budget is that debounce by design.

import { scenario } from '../lib/index.js'
import { context, largeProgram, plain, revealLine } from './m3-common.js'

/** The budgets this gate enforces. */
const KEYPRESS_P95_BUDGET_MS = 50
const OUTLINE_BUDGET_MS = 200
const OPEN_BUDGET_MS = 2000

/** How much slower than a small buffer the big document may be: one frame at 60 Hz. */
const SIZE_COST_BUDGET_MS = 17

/** One frame at 60 Hz, rounded up: the most the compositor can add after the DOM write. */
const FRAME_MS = 17

/** How many of the measured keystrokes may have to be posted a second time. */
const MAX_RETRIES = 2

const MIN_LINES = 300000
const MIN_BYTES = 10 * 1024 * 1024

/** How many keystrokes each latency sample is taken over, and how many outline edits. */
const KEYSTROKES = 40
const EDITS = 6

/** A short program to measure the same keystroke on. */
const SMALL = ['%', 'O6000 (REFERENCE)', 'G21 G90 G94', 'T1 M6', 'S3000 M3', 'G0 X0. Y0.', 'G43 Z25. H1 M8', 'G1 Z-1. F200.', 'G1 X50. F800.', 'G0 Z25.', 'M30', '%'].join('\n')

/** Percentile of a sample, nearest rank. */
function percentile(/** @type {number[]} */ values, /** @type {number} */ p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

const round = (/** @type {number[]} */ values) => values.map((value) => Math.round(value))

scenario('m3-perf', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })

  /**
   * Resolves at the moment a DOM change makes `predicate` true, sampling on every
   * mutation rather than on a timer: a poll would add its own interval to a number whose
   * whole budget is three frames.
   * @param {() => boolean} predicate
   * @param {number} timeout
   * @returns {Promise<number | null>} when it became true
   */
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

  /** The next animation frame, i.e. the moment the change that just landed is on screen. */
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())))

  /** Whether Monaco currently has a view line with exactly this text. */
  const drawn = (/** @type {string} */ text) => {
    for (const line of h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? []) {
      if (plain(line.textContent) === text) return true
    }
    return false
  }

  /**
   * Types `KEYSTROKES` characters at the end of a line and measures each one.
   *
   * One keystroke is typed first and thrown away. Its job is to prove the keyboard
   * reaches *this* document before a number is taken from it: the very first key after a
   * 10 MB open was seen to go nowhere once in fifteen runs, and a warm-up with a long
   * deadline turns that into a slower run instead of a lost measurement. A measured key
   * that still does not arrive is typed again after the editor has been given the focus
   * back, and `retries` is reported — this recovers a dropped NSEvent without hiding an
   * app that drops input, because a systematic loss would blow the retry budget.
   * @param {string} id
   * @param {number} line
   */
  const measureTyping = async (id, line) => {
    const modelLine = () => ctx.editor.getLines(id, line, line)[0] ?? ''
    const focus = async () => {
      ctx.editor.reveal(id, line, modelLine().length + 1)
      await h.idle()
      return h.focusEditor() && h.app.cursor().line === line
    }
    const focused = await focus()

    const warmTarget = `${modelLine()}1`
    await h.nativeKeys([{ key: '1' }])
    let warmed = (await untilDom(() => drawn(warmTarget), 15000)) !== null
    if (!warmed) {
      await focus()
      await h.nativeKeys([{ key: '1' }])
      warmed = (await untilDom(() => drawn(`${modelLine()}1`), 15000)) !== null
    }

    const original = modelLine()
    /** @type {number[]} */
    const dom = []
    /** @type {number[]} */
    const paint = []
    /** @type {number[]} */
    const posted = []
    /** @type {number[]} */
    const keydownAt = []
    let retries = 0
    const stamp = () => keydownAt.push(performance.now())
    window.addEventListener('keydown', stamp, true)
    try {
      for (let i = 0; i < KEYSTROKES; i++) {
        const want = `${modelLine()}1`
        keydownAt.length = 0
        let sent = performance.now()
        let waiting = untilDom(() => drawn(want), 5000)
        await h.nativeKeys([{ key: '1' }])
        let shown = await waiting
        if (shown === null && modelLine() !== want) {
          // The key never reached the model: hand the editor the focus back and retry it.
          retries++
          await focus()
          keydownAt.length = 0
          sent = performance.now()
          waiting = untilDom(() => drawn(want), 5000)
          await h.nativeKeys([{ key: '1' }])
          shown = await waiting
        }
        if (shown === null || keydownAt.length === 0) break
        const painted = await nextPaint()
        dom.push(shown - keydownAt[0])
        paint.push(painted - keydownAt[0])
        posted.push(shown - sent)
      }
    } finally {
      window.removeEventListener('keydown', stamp, true)
    }
    return {
      focused,
      warmed,
      retries,
      count: paint.length,
      typed: modelLine().length - original.length,
      domP95: dom.length > 0 ? Math.round(percentile(dom, 95)) : -1,
      p50: paint.length > 0 ? Math.round(percentile(paint, 50)) : -1,
      p95: paint.length > 0 ? Math.round(percentile(paint, 95)) : -1,
      worst: paint.length > 0 ? Math.round(Math.max(...paint)) : -1,
      samples: round(paint),
      domSamples: round(dom),
      postingP95: posted.length > 0 ? Math.round(percentile(posted, 95)) : -1,
    }
  }

  // ------------------------------------------------------------ the reference document
  const smallId = ctx.files.newUntitled({ profileId: 'fanuc-gcode', text: SMALL })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === smallId, { timeout: 10000 })
  const small = await measureTyping(smallId, 9)
  h.check('the reference buffer took every keystroke', small.count === KEYSTROKES && small.typed === KEYSTROKES && small.warmed && small.retries <= MAX_RETRIES, small)

  // ------------------------------------------------------------ the 10 MB document
  const text = largeProgram({ lines: MIN_LINES })
  const lineCount = text.split('\r\n').length - 1
  const bytes = text.length
  const path = `${h.cfg.run}/perf-300k.nc`
  await h.disk.write(path, text)
  h.check(`the program has ${lineCount} lines and ${(bytes / 1024 / 1024).toFixed(2)} MiB`, lineCount >= MIN_LINES && bytes >= MIN_BYTES, { lines: lineCount, bytes })

  await h.dialogs.queue('open', path)
  const startedOpen = performance.now()
  const openedIds = await ctx.files.open()
  const bigId = openedIds[0] ?? ''
  const rendered = await untilDom(() => h.q('editor-host')?.dataset.docId === bigId && drawn('%'), 60000)
  const openMs = Math.round((rendered ?? performance.now()) - startedOpen)
  h.check('the 10 MB program is open and drawn', !!bigId && rendered !== null && ctx.docs.get(bigId)?.path === path, { docId: bigId, profile: ctx.docs.get(bigId)?.profileId })
  h.check(`it opens and renders within ${OPEN_BUDGET_MS} ms: ${openMs} ms`, openMs <= OPEN_BUDGET_MS, { openMs, budgetMs: OPEN_BUDGET_MS })
  h.check('it is the profile the grammar and the outline are driven from', ctx.docs.get(bigId)?.profileId === 'fanuc-gcode' && ctx.editor.model(bigId)?.getLanguageId() === 'fanuc-gcode', {
    profile: ctx.docs.get(bigId)?.profileId,
    language: ctx.editor.model(bigId)?.getLanguageId(),
  })

  // The first outline build runs after the first render, in 20k-line chunks (AD-12): no
  // budget names it, but it is the number that says whether that design holds up.
  const outlineStart = performance.now()
  await ctx.outline.whenReady(bigId)
  const firstOutlineMs = Math.round(performance.now() - outlineStart)
  await h.waitFor(() => !!h.q('program-map-item', { kind: 'tool', line: 4 }), { timeout: 60000 })
  h.check('the outline of the whole 300k-line program is built', ctx.outline.toolLines(bigId).length === 1 && !!h.q('program-map-item', { kind: 'tool', line: 4 }), {
    toolLines: ctx.outline.toolLines(bigId),
    rows: h.qa('program-map-item').length,
    firstBuildMs: firstOutlineMs,
  })

  // ------------------------------------------------------------ keypress to render
  const big = await measureTyping(bigId, 150000)
  h.check(`every one of the ${KEYSTROKES} keystrokes reached the screen`, big.count === KEYSTROKES && big.focused && big.warmed, big)
  h.check('the editor dropped no input: at most a stray NSEvent had to be sent again', big.retries <= MAX_RETRIES && small.retries <= MAX_RETRIES, { big: big.retries, small: small.retries, allowed: MAX_RETRIES })
  h.check('the typing really landed in the document', big.typed === KEYSTROKES, big)
  const onScreenP95 = big.domP95 + FRAME_MS
  h.check(
    `keypress to render at ${lineCount} lines: drawn ${big.domP95} ms after the keydown, on screen within ${onScreenP95} ms, under the ${KEYPRESS_P95_BUDGET_MS} ms budget (G7)`,
    big.count === KEYSTROKES && onScreenP95 < KEYPRESS_P95_BUDGET_MS,
    {
      toDomP95: big.domP95,
      onScreenP95,
      budgetMs: KEYPRESS_P95_BUDGET_MS,
      domSamples: big.domSamples,
      rafP50: big.p50,
      rafP95: big.p95,
      rafWorstMs: big.worst,
      rafSamples: big.samples,
      note: '`toDom` is the frame that drew the character, `onScreen` adds a whole frame for its paint; the `raf*` numbers are the upper bound that overcounts by a frame or two (see the header, and the reference buffer below)',
      harnessPostingP95: big.postingP95,
    },
  )
  h.check(
    `and the size costs nothing: drawn in ${big.domP95} ms against ${small.domP95} ms in a ${SMALL.split('\n').length}-line buffer`,
    big.domP95 - small.domP95 <= SIZE_COST_BUDGET_MS && big.p95 - small.p95 <= SIZE_COST_BUDGET_MS,
    {
      bigDomP95: big.domP95,
      smallDomP95: small.domP95,
      differenceMs: big.domP95 - small.domP95,
      allowedMs: SIZE_COST_BUDGET_MS,
      bigRafP95: big.p95,
      smallRafP95: small.p95,
      note: 'the ~32 ms the raf numbers add over the dom numbers is paid by both documents, so it is the measurement and the frame clock, not the 300k lines',
    },
  )

  // ------------------------------------------------------------ the outline after an edit
  /** @type {number[]} */
  const outlineMs = []
  for (let i = 0; i < EDITS; i++) {
    const at = 100000 + i * 1000
    await revealLine(h, bigId, at, 1)
    const waiting = untilDom(() => !!h.q('program-map-item', { kind: 'tool', line: at }), 10000)
    const edited = performance.now()
    ctx.editor.insertText('T9 M6\n')
    const shown = await waiting
    if (shown === null) break
    outlineMs.push((await nextPaint()) - edited)
    ctx.editor.triggerAction('undo')
    await h.waitFor(() => !h.q('program-map-item', { kind: 'tool', line: at }), { timeout: 10000 })
  }

  const outlineWorst = outlineMs.length > 0 ? Math.round(Math.max(...outlineMs)) : -1
  const outlineMedian = outlineMs.length > 0 ? Math.round(percentile(outlineMs, 50)) : -1
  h.check(`all ${EDITS} edits were picked up by the outline`, outlineMs.length === EDITS, { measured: outlineMs.length, of: EDITS })
  h.check(
    `the outline is up to date ${outlineWorst} ms after an edit, within the ${OUTLINE_BUDGET_MS} ms budget (G7)`,
    outlineMs.length === EDITS && outlineWorst <= OUTLINE_BUDGET_MS,
    {
      worstMs: outlineWorst,
      medianMs: outlineMedian,
      budgetMs: OUTLINE_BUDGET_MS,
      samples: round(outlineMs),
      note: 'edit to the frame the program map drew the new tool row; 150 ms of it is the aggregation debounce',
    },
  )

  h.log(
    `G7 M3 at ${lineCount} lines: open ${openMs} ms (budget ${OPEN_BUDGET_MS}); first outline build ${firstOutlineMs} ms; ` +
      `keypress→drawn p95 ${big.domP95} ms, on screen within ${big.domP95 + FRAME_MS} ms (budget p95 ${KEYPRESS_P95_BUDGET_MS}; raf upper bound p50 ${big.p50} / p95 ${big.p95} / worst ${big.worst} ms); ` +
      `the same in a 12-line buffer: drawn ${small.domP95} ms, raf ${small.p95} ms; ` +
      `outline after an edit median ${outlineMedian} / worst ${outlineWorst} ms (budget ${OUTLINE_BUDGET_MS})`,
  )

  // Leave the document as it is on disk, so nothing can ask about unsaved changes while
  // the run is being torn down.
  await ctx.files.reloadFromDisk(bigId)
  await h.waitFor(() => !ctx.docs.get(bigId)?.dirty, { timeout: 30000 })
  h.check('the measured document is back to what is on disk', !ctx.docs.get(bigId)?.dirty, ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
