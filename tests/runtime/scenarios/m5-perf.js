// G7 for M5 (plan §5 M5 H5 `m5-perf-open`, "Gates: G7 — every budget again"): the M1 open
// budget, repeated with everything Phase 1 added switched on.
//
// `m1-perf-open` measured a 10 MB / 300k-line program against an app that had a ribbon,
// tabs and an editor. Since then the same open also runs the dialect detection, the
// tokenizer and the generated grammar, the incremental outline and the program map, the
// code database behind hover and completion, the external-change poll, the bookmark
// decorations, the transform and script registries and the Python probe. The budget did
// not move, so this scenario asks the same question of the app as it ships.
//
// It is deliberately a **copy of the M1 measurement**, not an import of it: the file it
// opens is generated here with the same shape (`.perf/` is gitignored and the harness
// copies only `tests/fixtures`), so the two numbers describe one document and can be put
// next to each other in the hand-off.
//
// The checks in front of the measurement are what make it a *M5* number: if a feature had
// quietly failed to load, the open would be fast for the wrong reason.

import { scenario } from '../lib/index.js'
import { largeProgram } from './m3-common.js'
import { context, pythonProbe, read, ready, scriptService } from './m5-common.js'

/** The budgets this gate enforces — the same two numbers M1 was held to. */
const OPEN_BUDGET_MS = 2000
const SWITCH_BUDGET_MS = 100

const MIN_LINES = 300000
const MIN_BYTES = 10 * 1024 * 1024

scenario('m5-perf-open', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const host = () => h.q('editor-host')

  /** The text of the top line Monaco has drawn, or null while nothing is drawn. */
  const firstDrawn = () => {
    const lines = [...(host()?.querySelectorAll('.view-lines .view-line') ?? [])]
    if (lines.length === 0) return null
    let top = /** @type {HTMLElement} */ (lines[0])
    for (const line of lines) if (parseFloat(/** @type {HTMLElement} */ (line).style.top) < parseFloat(top.style.top)) top = /** @type {HTMLElement} */ (line)
    return top.textContent
  }

  // ------------------------------------------------ everything is actually switched on
  const probe = await pythonProbe(h)
  h.check('the Python probe has answered, so the script feature is live', probe !== null, probe)
  h.check('the script list was read', read(scriptService(h).list).length >= 3, read(scriptService(h).list).length)
  h.check('both dialect profiles are registered', ctx.profiles.list().length >= 2, ctx.profiles.list().map((/** @type {any} */ p) => p.id))
  h.check('the code database answers for the active dialect', (ctx.codes.forScripts('fanuc-gcode') ?? []).length > 0, (ctx.codes.forScripts('fanuc-gcode') ?? []).length)
  for (const id of ['nc.renumber', 'nc.removeComments', 'bookmark.toggle', 'nav.nextTool', 'compare.with', 'script.runPicker', 'settings.open']) {
    h.check(`\`${id}\` is registered, so this is the app as it ships`, ctx.commands.has(id))
  }

  // ------------------------------------------------------------ the file
  const text = largeProgram({ lines: MIN_LINES })
  const lineCount = text.split('\r\n').length - 1
  const bytes = text.length
  const path = `${h.cfg.run}/m5-perf-300k.nc`
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
  await ctx.files.open()
  await h.waitFor(() => !!h.q('doc-tab', { path: small, active: '1' }), { timeout: 15000 })
  const smallId = h.q('doc-tab', { path: small })?.dataset.docId ?? ''
  // The tab being active is not the same as Monaco having drawn it: `firstDrawn()` reads
  // the `.view-line` elements, and there are none for a frame or two after the open. A
  // baseline captured too early is `null`, and `switchTo(smallId, null)` then waits for a
  // line that can never be drawn again — which is exactly how this read fails: not with a
  // wrong number but with five 30 s timeouts, while the switches onto the big document
  // (whose expected line is the literal `'%'`) all pass. So it is waited for and checked.
  const smallFirst = (await h.waitFor(() => (host()?.dataset.docId === smallId ? firstDrawn() : null), { timeout: 15000, interval: 5 })) ?? null
  h.check('the small program is drawn, so there is a line to switch back to', typeof smallFirst === 'string' && smallFirst.length > 0, { smallFirst, smallId })

  // ------------------------------------------------------------ open to first render
  await h.dialogs.queue('open', path)
  const started = performance.now()
  void ctx.files.open()
  const drawn = await h.waitFor(
    () => {
      const id = h.q('doc-tab', { path })?.dataset.docId
      return !!id && host()?.dataset.docId === id && firstDrawn() === '%' ? id : undefined
    },
    { timeout: 120000, interval: 5 },
  )
  const openMs = Math.round(performance.now() - started)
  const bigId = drawn ?? ''
  h.check('the 10 MB program is open and drawn', !!drawn && ctx.docs.get(bigId)?.path === path, { docId: bigId, firstLine: firstDrawn() })
  h.check(`it renders within ${OPEN_BUDGET_MS} ms with every M2–M5 feature on (G7): ${openMs} ms`, openMs <= OPEN_BUDGET_MS, { openMs, budgetMs: OPEN_BUDGET_MS, lines: lineCount, bytes })
  h.check('the whole file is in the editor', ctx.editor.getLineCount(bigId) === lineCount + 1, { modelLines: ctx.editor.getLineCount(bigId), fileLines: lineCount })
  h.check('the dialect was detected and the status bar describes the file', ctx.docs.get(bigId)?.profileId === 'fanuc-gcode' && h.q('status-item', { item: 'eol' })?.textContent === 'CRLF', {
    profile: ctx.docs.get(bigId)?.profileId,
    eol: h.q('status-item', { item: 'eol' })?.textContent,
    encoding: h.q('status-item', { item: 'encoding' })?.textContent,
  })

  // The program map re-parses the whole document after the change settles; `T1 M6` is
  // line 4 of the generated program and its only tool change, so this entry can only come
  // from a parse of the 10 MB document.
  const mapStart = performance.now()
  const mapped = await h.waitFor(() => h.q('program-map-item', { kind: 'tool', line: 4 }), { timeout: 120000, interval: 20 })
  const mapMs = Math.round(performance.now() - mapStart)
  h.check('the program map parsed the 10 MB document', !!mapped, { entries: h.qa('program-map-item').length, ms: mapMs })
  await h.sleep(1500)

  // ------------------------------------------------------------ tab switch
  /**
   * @param {string} docId
   * @param {string | null} expectFirst
   */
  const switchTo = async (docId, expectFirst) => {
    const tab = h.q('doc-tab', { docId })
    const at = performance.now()
    h.click(tab)
    const ok = await h.waitFor(() => (host()?.dataset.docId === docId && firstDrawn() === expectFirst ? true : undefined), { timeout: 30000, interval: 1 })
    return { ms: Math.round(performance.now() - at), ok: !!ok }
  }

  /** @type {{ ms: number, ok: boolean }[]} */
  const toSmall = []
  /** @type {{ ms: number, ok: boolean }[]} */
  const toBig = []
  for (let i = 0; i < 5; i++) {
    toSmall.push(await switchTo(smallId, smallFirst))
    await h.sleep(250)
    toBig.push(await switchTo(bigId, '%'))
    await h.sleep(250)
  }
  const ms = (/** @type {{ ms: number }[]} */ list) => list.map((r) => r.ms)
  const worst = Math.max(...ms(toBig))
  const median = [...ms(toBig)].sort((a, b) => a - b)[Math.floor(toBig.length / 2)]
  h.check('every tab switch showed the document it was asked for', [...toSmall, ...toBig].every((r) => r.ok), { toSmall, toBig })
  h.check(`switching away from the 10 MB document is cheap: worst ${Math.max(...ms(toSmall))} ms`, Math.max(...ms(toSmall)) <= SWITCH_BUDGET_MS, { toSmall: ms(toSmall) })
  h.check(`a tab switch onto the 10 MB document takes at most ${SWITCH_BUDGET_MS} ms (G7): median ${median}, worst ${worst} ms`, worst <= SWITCH_BUDGET_MS, {
    ontoBigMs: ms(toBig),
    awayMs: ms(toSmall),
    medianMs: median,
    worstMs: worst,
    budgetMs: SWITCH_BUDGET_MS,
  })

  // ------------------------------------------- the M5 surface on a document this size
  //
  // The Tools group is built from `scripts.list` and the *active* profile, not from the
  // document, so it must cost nothing to draw over a 10 MB program; and the picker has to
  // open at once. Both are what an operator would actually reach for on a posted file.
  const ribbonStart = performance.now()
  h.click(h.qa('ribbon-tab').find((e) => e.dataset.tab === 'tools'))
  await h.waitFor(() => h.qa('script-item').length > 0, { timeout: 10000 })
  const ribbonMs = Math.round(performance.now() - ribbonStart)
  h.check(`the Tools group draws over a 10 MB program in ${ribbonMs} ms`, ribbonMs <= 1000, { ribbonMs })

  h.log(`G7 (M5): open ${openMs} ms (${lineCount} lines, ${(bytes / 1024 / 1024).toFixed(2)} MiB); switch onto it ${ms(toBig).join('/')} ms; switch away ${ms(toSmall).join('/')} ms; program map ${mapMs} ms; Tools group ${ribbonMs} ms`)
})
