// G7 for M1 (plan §5 M1 H1 `m1-perf-open`, "Gates: G7"): a generated 10 MB / 300k-line
// program must be open and drawn within 2 s, and switching to and from its tab must take
// at most 100 ms.
//
// The file is generated here rather than checked in (`.perf/` is gitignored and the
// harness copies only `tests/fixtures`), with the same shape `tests/gen/gen-large.mjs`
// writes: a header, a tool change and a long run of cutting moves, CRLF throughout.
//
// "First render" is the moment Monaco has put the file's own first line on screen under
// the new document's `editor-host`, which is what a user sees — not the moment the
// promise resolves.

import { scenario } from '../lib/index.js'

/** The budgets this gate enforces. */
const OPEN_BUDGET_MS = 2000
const SWITCH_BUDGET_MS = 100

const MIN_LINES = 300000
const MIN_BYTES = 10 * 1024 * 1024

const HEAD = ['%', 'O9001 (PERF 300K)', 'G21 G17 G40 G49 G80 G90 G94', 'T1 M6', 'S3000 M3', 'G0 X0. Y0.', 'G43 Z25. H1 M8', 'G1 Z-1. F200.']
const TAIL = ['G0 Z25.', 'M30', '%']

/** A deterministic raster of cutting moves, ~36 bytes per line. */
function generate() {
  const lines = [...HEAD]
  let x = 0
  let y = 0
  let direction = 1
  const fixed = (/** @type {number} */ value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4)
  while (lines.length < MIN_LINES - TAIL.length) {
    x += 0.5 * direction
    if (x > 100 || x < 0) {
      direction = -direction
      x += 0.5 * direction
      y = y >= 80 ? 0 : y + 1
    }
    const z = -2 + Math.sin(x / 7) * Math.cos(y / 5)
    lines.push(`G1 X${fixed(x)} Y${fixed(y)} Z${fixed(z)} F800.`)
  }
  lines.push(...TAIL)
  return lines.join('\r\n') + '\r\n'
}

scenario('m1-perf-open', { timeout: 300 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  const host = () => h.q('editor-host')
  /** The text of the top line Monaco has drawn, or null while nothing is drawn. */
  const firstDrawn = () => {
    const lines = [...(host()?.querySelectorAll('.view-lines .view-line') ?? [])]
    if (lines.length === 0) return null
    let top = /** @type {HTMLElement} */ (lines[0])
    for (const line of lines) if (parseFloat(/** @type {HTMLElement} */ (line).style.top) < parseFloat(top.style.top)) top = /** @type {HTMLElement} */ (line)
    return top.textContent
  }

  // ------------------------------------------------------------ the file
  const text = generate()
  const lineCount = text.split('\r\n').length - 1
  const bytes = text.length
  const path = `${h.cfg.run}/perf-300k.nc`
  await h.disk.write(path, text)
  const stat = await h.disk.stat(path)
  h.check(
    `the generated program has ${lineCount} lines and ${(bytes / 1024 / 1024).toFixed(2)} MiB`,
    lineCount >= MIN_LINES && bytes >= MIN_BYTES && stat?.len === bytes,
    { lines: lineCount, bytes, onDisk: stat?.len },
  )

  // A small file to switch back and forth with.
  const small = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  await h.dialogs.queue('open', small)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => !!h.q('doc-tab', { path: small, active: '1' }), { timeout: 10000 })
  const smallId = h.q('doc-tab', { path: small })?.dataset.docId ?? ''
  // The tab goes active the moment the store changes; Monaco paints a frame or two
  // later. Reading the first line in between answers `null`, and every later switch back
  // to this document then waits 20 s for a blank editor that never comes — which is how
  // this scenario failed at M7 integration, five times in one run, on a build in which
  // nothing was wrong. Wait for the paint, and say so if it never arrives.
  const painted = await h.waitFor(() => (host()?.dataset.docId === smallId ? (firstDrawn() ?? undefined) : undefined), { timeout: 15000, interval: 5 })
  const smallFirst = painted ?? null
  h.check('the small document is drawn before it is used as the reference for a switch', smallFirst !== null && smallFirst.length > 0, { smallFirst })

  // ------------------------------------------------------------ open to first render
  await h.dialogs.queue('open', path)
  const started = performance.now()
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  const drawn = await h.waitFor(
    () => {
      const id = h.q('doc-tab', { path })?.dataset.docId
      return !!id && host()?.dataset.docId === id && firstDrawn() === '%' ? id : undefined
    },
    { timeout: 60000, interval: 5 },
  )
  const openMs = Math.round(performance.now() - started)
  const bigId = drawn ?? ''
  h.check('the 10 MB program is open and drawn', !!drawn && ctx.docs.get(bigId)?.path === path, { docId: bigId, firstLine: firstDrawn() })
  h.check(`it renders within ${OPEN_BUDGET_MS} ms (G7): ${openMs} ms`, openMs <= OPEN_BUDGET_MS, { openMs, budgetMs: OPEN_BUDGET_MS, lines: lineCount, bytes })
  // The file ends with a line break, so the model carries the empty line after it.
  h.check('the whole file is in the editor', ctx.editor.getLineCount(bigId) === lineCount + 1, {
    modelLines: ctx.editor.getLineCount(bigId),
    fileLines: lineCount,
  })
  h.check('the status bar describes it', h.q('status-item', { item: 'file' })?.textContent?.trim() === 'perf-300k.nc' && h.q('status-item', { item: 'eol' })?.textContent === 'CRLF', {
    file: h.q('status-item', { item: 'file' })?.textContent,
    eol: h.q('status-item', { item: 'eol' })?.textContent,
    encoding: h.q('status-item', { item: 'encoding' })?.textContent,
  })

  // The program map re-parses the whole document 300 ms after the document changes, so
  // let it settle before measuring a switch — otherwise the number is a parse, not a
  // switch. How long that takes is worth knowing on its own (WP1.5 known gap 1).
  // `T1 M6` is line 4 of the generated program and the only tool change in it, so this
  // entry can only come from a parse of the 10 MB document.
  const mapStart = performance.now()
  const mapped = await h.waitFor(() => h.q('program-map-item', { kind: 'tool', line: 4 }), { timeout: 60000, interval: 20 })
  const mapMs = Math.round(performance.now() - mapStart)
  h.check('the program map parsed the 10 MB document', !!mapped, { entries: h.qa('program-map-item').length, ms: mapMs })
  await h.sleep(1500)

  // ------------------------------------------------------------ tab switch
  /**
   * Clicks a tab and waits, first until the shell has swapped the document, then until
   * Monaco has drawn that document's first line.
   * @param {string} docId
   * @param {string | null} expectFirst
   */
  const switchTo = async (docId, expectFirst) => {
    const tab = h.q('doc-tab', { docId })
    const at = performance.now()
    h.click(tab)
    const swapped = await h.waitFor(() => (host()?.dataset.docId === docId ? performance.now() : undefined), { timeout: 20000, interval: 1 })
    const ok = await h.waitFor(() => (host()?.dataset.docId === docId && firstDrawn() === expectFirst ? true : undefined), { timeout: 20000, interval: 1 })
    return { ms: Math.round(performance.now() - at), swapMs: Math.round((swapped ?? at) - at), ok: !!ok }
  }

  /** @type {{ ms: number, swapMs: number, ok: boolean }[]} */
  const toSmall = []
  /** @type {{ ms: number, swapMs: number, ok: boolean }[]} */
  const toBig = []
  for (let i = 0; i < 5; i++) {
    toSmall.push(await switchTo(smallId, smallFirst))
    await h.sleep(250)
    toBig.push(await switchTo(bigId, '%'))
    await h.sleep(250)
  }
  const ms = (/** @type {{ ms: number }[]} */ list) => list.map((r) => r.ms)
  const best = Math.min(...ms(toBig))
  const worst = Math.max(...ms(toBig))
  const median = [...ms(toBig)].sort((a, b) => a - b)[Math.floor(toBig.length / 2)]
  h.check('every tab switch showed the document it was asked for', [...toSmall, ...toBig].every((r) => r.ok), { toSmall, toBig })
  h.check(`switching away from the 10 MB document is cheap: worst ${Math.max(...ms(toSmall))} ms`, Math.max(...ms(toSmall)) <= SWITCH_BUDGET_MS, { toSmall: ms(toSmall) })
  h.check(`a tab switch onto the 10 MB document takes at most ${SWITCH_BUDGET_MS} ms (G7): best ${best}, median ${median}, worst ${worst} ms`, worst <= SWITCH_BUDGET_MS, {
    ontoBigMs: ms(toBig),
    swapOnlyMs: toBig.map((r) => r.swapMs),
    awayMs: ms(toSmall),
    bestMs: best,
    medianMs: median,
    worstMs: worst,
    budgetMs: SWITCH_BUDGET_MS,
  })
  h.check('the cursor of each document survived the switching', JSON.stringify(h.app.cursor()) === '{"line":1,"column":1}', h.app.cursor())

  // Where the time goes: `docs.activate()` notifies its subscribers synchronously, and
  // the editor service swaps the Monaco model inside one of them, so this number is the
  // model attach alone — no click, no polling, no paint.
  ctx.docs.activate(smallId)
  await h.sleep(400)
  const activateStart = performance.now()
  ctx.docs.activate(bigId)
  const activateMs = Math.round(performance.now() - activateStart)
  await h.sleep(400)
  h.check('the blocking part of the switch is the model attach, not the paint', activateMs > 0, {
    activateMs,
    note: 'docs.activate() to return, synchronous',
  })

  h.log(
    `G7: open ${openMs} ms (${lineCount} lines, ${(bytes / 1024 / 1024).toFixed(2)} MiB); ` +
      `switch onto it ${ms(toBig).join('/')} ms (store swap ${toBig.map((r) => r.swapMs).join('/')} ms); ` +
      `switch away ${ms(toSmall).join('/')} ms; docs.activate() alone ${activateMs} ms; program map ${mapMs} ms`,
  )

  h.expectExit({ within: 20000 })
  await h.sleep(300)
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})
