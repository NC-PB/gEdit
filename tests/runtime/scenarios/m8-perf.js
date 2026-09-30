// G7 for M8 (plan §5 M8 H8 `m8-perf`, "Gates: G7"): a generated 10 MB Okuma program and a
// generated 10 MB Sinumerik program each open and draw within 2 s, and in each of them a
// keypress reaches the screen with a p95 under 50 ms.
//
// **Why these two need their own numbers.** `m1-perf-open`, `m3-perf` and `m5-perf-open`
// measure a Fanuc mill program, and the two turning dialects are tokenized by rules the
// Fanuc one does not run: the AD-24 fields (sequence names, labels, assignments, calls,
// system variables, the file header) and, since integration step A, `syntax.names`, which
// cost Sinumerik about 4 % in node. Every Monaco line is tokenized by the generated grammar
// of its dialect as well, so both halves of the editor are on a different path here.
//
// The programs are the ones `node tests/gen/gen-large.mjs --dialect okuma|sinumerik --lines
// 300000 --mb 10` writes, byte for byte (`m8-common.turningProgram`): at least 300,000
// lines and 10 MiB, CRLF, the seed's header, footer and turret indexes repeated with new
// stations, and turning passes in between. Both have more than 300,000 lines, because a
// turning pass is a short line and the size is the budget's other half.
//
// Keypress to render is taken exactly as `m3-perf` takes it and checked the same way: the
// frame that drew the character plus one whole frame for its paint. A 12-line buffer of the
// same dialect is measured first; it is no gate here, but it is printed beside the large
// numbers, because a figure that is only high on a loaded machine is high in both.

import { scenario } from '../lib/index.js'
import { ready } from './m4-common.js'
import { FRAME_MS, OKUMA, SINUMERIK, context, drawn, measureTyping, turningProgram, untilDom } from './m8-common.js'

/** The budgets this gate enforces. */
const OPEN_BUDGET_MS = 2000
const KEYPRESS_P95_BUDGET_MS = 50

/** How large the programs are at least, as `gen-large.mjs --lines 300000 --mb 10` asks. */
const MIN_LINES = 300000
const MIN_MIB = 10

/** Keystrokes per sample, and how many may have to be sent a second time. */
const KEYSTROKES = 40
const MAX_RETRIES = 2

/** The two programs, under the extension each control writes. */
const PROGRAMS = /** @type {const} */ ([
  {
    dialect: 'okuma',
    profile: OKUMA,
    name: 'OKUMA-300K.MIN',
    small: ['(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)', 'O0001', 'G50 S2200', 'T0101', 'G96 S180 M03', 'G00 X62 Z3 M08', 'G95 G01 Z0 F0.3', 'X60.0000 Z-0.5000 F0.080', 'X60.0000 Z-1.0000 F0.100', 'G00 X400 Z300 M09', 'M02', '%'],
  },
  {
    dialect: 'sinumerik',
    profile: SINUMERIK,
    name: 'SINUMERIK_300K.MPF',
    small: ['; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE', 'G18 G90 G95 G40 DIAMON', 'T1 D1', 'G96 S220 LIMS=2500 M4', 'G0 X62 Z3 M8', 'G1 Z0 F0.3', 'X60.0000 Z-0.5000 F0.080', 'X60.0000 Z-1.0000 F0.100', 'G0 X200 Z200 M9', 'M5', 'M30', ''],
  },
])

scenario('m8-perf', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  /** @type {string[]} */
  const summary = []

  for (const program of PROGRAMS) {
    const label = ctx.profiles.get(program.profile)?.shortName ?? program.profile

    // ------------------------------------------------------------ the reference buffer
    const smallId = ctx.files.newUntitled({ profileId: program.profile, text: program.small.join('\n') })
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === smallId, { timeout: 10000 })
    const small = await measureTyping(h, smallId, 8, KEYSTROKES)
    h.check(`${label}: the 12-line reference buffer took every keystroke`, small.count === KEYSTROKES && small.typed === KEYSTROKES && small.warmed && small.retries <= MAX_RETRIES, small)

    // ------------------------------------------------------------ the file
    const text = turningProgram(program.dialect, { lines: MIN_LINES, mb: MIN_MIB })
    const lineCount = text.split('\r\n').length - 1
    const path = `${h.cfg.run}/${program.name}`
    await h.disk.write(path, text)
    const stat = await h.disk.stat(path)
    h.check(
      `${label}: the generated program has ${lineCount} lines and ${(text.length / 1024 / 1024).toFixed(2)} MiB`,
      lineCount >= MIN_LINES && text.length >= MIN_MIB * 1024 * 1024 && stat?.len === text.length,
      { lines: lineCount, bytes: text.length, onDisk: stat?.len },
    )

    // ------------------------------------------------------------ open to first render
    const firstLine = text.slice(0, text.indexOf('\r\n'))
    await h.dialogs.queue('open', path)
    const started = performance.now()
    const openedIds = await ctx.files.open()
    const bigId = openedIds[0] ?? ''
    const rendered = await untilDom(() => h.q('editor-host')?.dataset.docId === bigId && drawn(h, firstLine), 60000)
    const openMs = Math.round((rendered ?? performance.now()) - started)
    h.check(`${label}: the 10 MB program is open and drawn`, !!bigId && rendered !== null && ctx.docs.get(bigId)?.path === path, { docId: bigId, firstLine })
    h.check(`${label}: it opens and renders within ${OPEN_BUDGET_MS} ms: ${openMs} ms (G7)`, rendered !== null && openMs <= OPEN_BUDGET_MS, { openMs, budgetMs: OPEN_BUDGET_MS, lines: lineCount, bytes: text.length })
    h.check(
      `${label}: it was read as ${program.profile}, so it is this dialect's tokenizer and grammar that were measured`,
      ctx.docs.get(bigId)?.profileId === program.profile && ctx.editor.model(bigId)?.getLanguageId() === program.profile,
      { profile: ctx.docs.get(bigId)?.profileId, language: ctx.editor.model(bigId)?.getLanguageId() },
    )
    h.check(`${label}: the whole file is in the editor`, ctx.editor.getLineCount(bigId) === lineCount + 1, { model: ctx.editor.getLineCount(bigId), file: lineCount })

    // The first outline build runs after the first render, in chunks (AD-12). No budget
    // names it, but it is what the program map of a program this size costs.
    const outlineStart = performance.now()
    await ctx.outline.whenReady(bigId)
    const outlineMs = Math.round(performance.now() - outlineStart)
    const toolLines = ctx.outline.toolLines(bigId)
    const firstTool = text.split('\r\n').findIndex((line) => /^T\d/.test(line)) + 1
    h.check(`${label}: the outline of the whole program is built, its first turret index where the seed has it`, toolLines.length > 100 && toolLines[0] === firstTool, {
      tools: toolLines.length,
      first: toolLines[0],
      want: firstTool,
      buildMs: outlineMs,
    })

    // ------------------------------------------------------------ keypress to render
    const middle = Math.floor(lineCount / 2)
    const at = [middle, middle + 1, middle + 2].find((line) => /^X\d/.test(ctx.editor.getLines(bigId, line, line)[0] ?? '')) ?? middle
    const big = await measureTyping(h, bigId, at, KEYSTROKES)
    h.check(`${label}: every one of the ${KEYSTROKES} keystrokes reached the screen, at most ${MAX_RETRIES} sent again`, big.count === KEYSTROKES && big.typed === KEYSTROKES && big.focused && big.warmed && big.retries <= MAX_RETRIES, big)
    const onScreenP95 = big.domP95 + FRAME_MS
    h.check(
      `${label}: keypress to render at line ${at} of ${lineCount}: drawn ${big.domP95} ms after the keydown, on screen within ${onScreenP95} ms, under the ${KEYPRESS_P95_BUDGET_MS} ms budget (G7)`,
      big.count === KEYSTROKES && onScreenP95 < KEYPRESS_P95_BUDGET_MS,
      {
        toDomP95: big.domP95,
        onScreenP95,
        budgetMs: KEYPRESS_P95_BUDGET_MS,
        domSamples: big.domSamples,
        rafP95: big.rafP95,
        rafWorstMs: big.worst,
        reference: { lines: program.small.length, toDomP95: small.domP95, rafP95: small.rafP95 },
        note: '`toDom` is the frame that drew the character, `onScreen` adds a whole frame for its paint; `raf` is the upper bound that overcounts by a frame or two (m3-perf)',
      },
    )
    summary.push(
      `${label}: open ${openMs} ms (${lineCount} lines, ${(text.length / 1024 / 1024).toFixed(2)} MiB), first outline ${outlineMs} ms, ` +
        `keypress drawn p95 ${big.domP95} ms / on screen ${onScreenP95} ms (12-line buffer ${small.domP95} ms), raf p95 ${big.rafP95} ms`,
    )

    // Back to what is on disk, so nothing asks about unsaved changes at the end of the run,
    // and the tab closed, so the second program is measured without the first one's model.
    await ctx.files.reloadFromDisk(bigId)
    await h.waitFor(() => !ctx.docs.get(bigId)?.dirty, { timeout: 30000 })
    h.check(`${label}: the measured document is back to what is on disk`, !ctx.docs.get(bigId)?.dirty, ctx.docs.get(bigId)?.dirty)
    await ctx.commands.run('file.close')
    await h.waitFor(() => ctx.docs.get(bigId) === undefined, { timeout: 30000 })
    h.check(`${label}: and closed again`, ctx.docs.get(bigId) === undefined)
  }

  h.log(`G7 M8: ${summary.join('; ')}`)
})
