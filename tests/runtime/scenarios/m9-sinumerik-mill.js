// The Sinumerik 840D milling profile in the running app (plan §6 M9 H9 `m9-sinumerik-mill`,
// WP9.1, roadmap R2): an owner-public milling `.MPF` opens as `sinumerik-mill` and a turning
// `.MPF` still opens as `sinumerik`; F7 visits the `M6` changes only, and not the `T` that
// preselects the next tool; the program map and the tool list give one row per tool; the
// milling words are described and painted; the machine item starts the program in `G17` and
// `G94` with diameter programming off; Save As offers the milling filter.
//
// **The fact under test is the preselect.** On a turning control `T1` is the tool change; on
// a milling one `T1` only fetches the next tool to the changer and `M6` puts it in the
// spindle. Read with the turning rule the published drilling program has four preselects
// more than tools (the old plan counted nine segments for five tools), a tool list with a
// call count of 2 for a tool that was used once, and a feed that belongs to the wrong
// tool. Every expected answer is read out of a fixture: the outline golden for F7 and the
// map, and, for the tool list, the rows the Python test of WP9.1 pins for the same
// program (`tests/python/test_sinumerik_mill.py`), which are the claim of the milestone and
// are written out below.

import { scenario } from '../lib/index.js'
import { hoverAt, lineTokens, loadPalette, mapRows, REPO_FILE, revealLine, rgbOf, rolesByColor, roleOf, setTheme } from './m3-common.js'
import { ready } from './m4-common.js'
import { machineItem, machineText, tooltipLine } from './m6-common.js'
import { lineOf, openFixtureAs, outlineGolden, plain, reportRows, runScript } from './m8-common.js'
import { SINUMERIK, SINUMERIK_MILL, context, knownUnknowns, openPath } from './m9-common.js'

const DRILLING = 'nc/owner-public/sinumerik-mill/DRILLING.mpf'
const TURNING = 'nc/owner-public/sinumerik/TURN_1.mpf'
const PLATE = 'nc/sinumerik-mill/m01-plate.MPF'
const FIVE_AXIS = 'nc/sinumerik-mill/m02-five-axis.MPF'

/** The columns of the tool list, in its order. */
const TOOL_KEYS = ['tool', 'line', 'calls', 'feed', 'speed']

/**
 * The tool list of the published drilling program: one row per tool, each with the feed
 * and the speed it was given after its own `M6`. The same five rows as
 * `ToolListTest.test_the_drilling_program_gives_one_row_per_tool_with_its_own_feed_and_speed`.
 */
const DRILLING_ROWS = ['T1|8|1|637|6366', 'T2|746|1|443|295', 'T3|2406|1|637|6366', 'T5|2435|1|557|1114', 'T4|2457|1|557|1114']

/** The synthetic plate: tools by name, each preselected by the line above its `M6`, and `T0` is no row. */
const PLATE_ROWS = ['FACEMILL_D50|11|1', 'DRILL_D8|24|1', 'ENDMILL_D10|40|1']

scenario('m9-sinumerik-mill', { timeout: 540, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  const palette = await loadPalette(h)
  const dark = rolesByColor(palette.dark)
  const invalidColor = rgbOf(palette.dark.invalid)
  const mill = ctx.profiles.get(SINUMERIK_MILL)
  const turn = ctx.profiles.get(SINUMERIK)

  // =============================================================== A. detection
  h.check('the registry has the milling profile, next to the turning one', mill !== undefined && turn !== undefined && mill.shortName !== turn.shortName, { mill: mill?.shortName, turn: turn?.shortName })

  const drilling = await openPath(h, await h.fixture(DRILLING))
  const turning = await openPath(h, await h.fixture(TURNING))
  const plate = await openPath(h, await h.fixture(PLATE))
  const five = await openPath(h, await h.fixture(FIVE_AXIS))
  /** @param {string} id */
  const profileOf = (id) => ctx.docs.get(id)?.profileId
  h.check('the published drilling program, a milling post, opens as the milling profile', profileOf(drilling.id) === SINUMERIK_MILL, profileOf(drilling.id))
  h.check('the published turning program stays on the turning profile', profileOf(turning.id) === SINUMERIK, profileOf(turning.id))
  h.check('the synthetic plate and the five-axis program open as milling', profileOf(plate.id) === SINUMERIK_MILL && profileOf(five.id) === SINUMERIK_MILL, [profileOf(plate.id), profileOf(five.id)])
  h.check(
    'the profile id is the Monaco language id of each',
    [drilling, turning, plate, five].every((doc) => ctx.editor.model(doc.id)?.getLanguageId() === profileOf(doc.id)),
    [drilling, turning, plate, five].map((doc) => `${profileOf(doc.id)}|${ctx.editor.model(doc.id)?.getLanguageId()}`),
  )

  // =============================================================== B. the status bar and the machine item
  ctx.docs.activate(drilling.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === drilling.id, { timeout: 8000 })
  await h.idle()
  h.check('the dialect item names the milling profile', h.q('status-item', { item: 'profile' })?.textContent?.trim() === mill?.shortName, h.q('status-item', { item: 'profile' })?.textContent?.trim())
  h.check('with no machine defined the machine item says none, and marks it assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', machineText(h))
  const assumed = ctx.t('machines.source.profile')
  const planeLabel = ctx.t('machines.groups.plane')
  const feedLabel = ctx.t('machines.groups.feedmode')
  h.check(
    'a milling program starts in G17 and in feed per minute: the two power-on codes the turning profile does not assume',
    tooltipLine(h, planeLabel) === `${planeLabel}: G17 — ${assumed}` && tooltipLine(h, feedLabel) === `${feedLabel}: G94 — ${assumed}`,
    [tooltipLine(h, planeLabel), tooltipLine(h, feedLabel)],
  )
  const diameterLine = (machineItem(h)?.getAttribute('title') ?? '').split('\n').find((line) => /diameter/i.test(line)) ?? ''
  h.check('and X is not a diameter at power-on, the setting a turning machine has on', diameterLine.endsWith(`: ${ctx.t('machines.value.off')} — ${assumed}`), diameterLine)

  // =============================================================== C. F7 and the map
  const outline = await outlineGolden(h, 'owner-public/sinumerik-mill/DRILLING.mpf')
  const tools = outline.items.filter((item) => item.kind === 'tool')
  const toolLines = tools.map((item) => item.line)
  h.check('the outline golden gives the drilling program five tool changes, each at its M6', outline.profile === SINUMERIK_MILL && toolLines.length === 5 && toolLines.every((line) => /\bM6\b/.test(lineOf(h, drilling.id, line))), toolLines.map((line) => `${line}: ${lineOf(h, drilling.id, line)}`))
  await h.waitFor(() => ctx.outline.toolLines(drilling.id).length === toolLines.length, { timeout: 15000 })
  h.check('the running app finds exactly those lines: the five M6, not the five T that preselect', JSON.stringify(ctx.outline.toolLines(drilling.id)) === JSON.stringify(toolLines), { got: ctx.outline.toolLines(drilling.id), want: toolLines })
  const preselects = toolLines.map((line) => line + 1)
  h.check(
    'the line under each M6 is a T on a line of its own — a preselect of the next tool, or T0, the tool put away — and none of them is a tool change',
    preselects.every((line) => /^N\d+ T\d+$/.test(lineOf(h, drilling.id, line)) && !ctx.outline.toolLines(drilling.id).includes(line)),
    preselects.map((line) => `${line}: ${lineOf(h, drilling.id, line)}`),
  )

  await revealLine(h, drilling.id, 1, 1)
  /** @param {boolean} back @param {number} expected */
  const step = async (back, expected) => {
    await h.nativeKeys([{ key: 'F7', mods: back ? ['shift'] : [] }])
    await h.waitFor(() => h.app.cursor().line === expected, { timeout: 5000 })
    return h.app.cursor().line
  }
  h.check('the editor has the focus for the key presses', h.focusEditor())
  for (const line of toolLines) h.check(`F7 goes to the M6 on line ${line}: ${lineOf(h, drilling.id, line)}`, (await step(false, line)) === line, h.app.cursor())
  h.check('F7 on the last one wraps to the first', (await step(false, toolLines[0])) === toolLines[0], h.app.cursor())
  h.check('and Shift+F7 from there wraps back to the last', (await step(true, toolLines[toolLines.length - 1])) === toolLines[toolLines.length - 1], h.app.cursor())

  const labels = h
    .qa('program-map-item')
    .filter((element) => element.dataset.kind === 'tool')
    .map((element) => element.querySelector('.text')?.textContent?.trim() ?? '')
  h.check('the map shows one segment per tool, each labelled with the tool and the comment above it', JSON.stringify(labels) === JSON.stringify(tools.map((item) => item.text)), {
    got: labels,
    want: tools.map((item) => item.text),
    rows: mapRows(h).length,
  })

  // =============================================================== D. the tool list
  await runScript(h, 'bundled:tool_list.py', { form: true })
  await h.waitFor(() => h.qa('results-row').length >= DRILLING_ROWS.length, { timeout: 30000 })
  const drillingRows = reportRows(h, TOOL_KEYS)
  h.check('the tool list gives one row per tool — five, not nine — each with the feed and the speed of its own M6', JSON.stringify(drillingRows) === JSON.stringify(DRILLING_ROWS), { got: drillingRows, want: DRILLING_ROWS })
  h.check('and a call count of 1 for a tool used once', drillingRows.every((row) => row.split('|')[2] === '1'), drillingRows)

  ctx.docs.activate(plate.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === plate.id, { timeout: 8000 })
  await runScript(h, 'bundled:tool_list.py', { form: true })
  await h.waitFor(() => reportRows(h, TOOL_KEYS.slice(0, 3)).length === PLATE_ROWS.length && reportRows(h, TOOL_KEYS.slice(0, 3))[0].startsWith('FACEMILL_D50'), { timeout: 30000 })
  const plateRows = reportRows(h, TOOL_KEYS.slice(0, 3))
  h.check('tools named in a T="NAME" word give one row each, at their M6, and T0 is no row', JSON.stringify(plateRows) === JSON.stringify(PLATE_ROWS), { got: plateRows, want: PLATE_ROWS })

  // =============================================================== E. hover and paint
  /**
   * The hover on a word, found by its text in the line so no column is retyped.
   * @param {string} id
   * @param {number} line
   * @param {string} word
   */
  const hoverOn = async (id, line, word) => {
    const at = lineOf(h, id, line).indexOf(word)
    if (at < 0) return `(no ${word} on line ${line})`
    return hoverAt(h, id, line, at + 2)
  }
  /**
   * The first line of a document that matches.
   * @param {string} id
   * @param {RegExp} pattern
   */
  const lineWith = (id, pattern) => ctx.editor.getLines(id, 1, ctx.editor.getLineCount(id)).findIndex((text) => pattern.test(text)) + 1
  const cycle800 = await hoverOn(five.id, lineWith(five.id, /CYCLE800/), 'CYCLE800')
  h.check('CYCLE800, the swivel cycle every 3+2 program calls, is described', /^CYCLE800 — \S/.test(cycle800), cycle800.slice(0, 200))
  const traori = await hoverOn(five.id, lineWith(five.id, /TRAORI/), 'TRAORI')
  h.check('TRAORI, the transformation a five-axis program switches on, is described', /^TRAORI — \S/.test(traori), traori.slice(0, 200))

  const gaps = await knownUnknowns(h)
  /** @type {string[]} */
  const marked = []
  for (const [rel, doc, allow] of /** @type {[string, { id: string }, string[]][]} */ ([
    [DRILLING, drilling, gaps.get(DRILLING) ?? []],
    [PLATE, plate, []],
    [FIVE_AXIS, five, []],
  ])) {
    const lines = ctx.editor.getLineCount(doc.id)
    for (let line = 1; line <= lines; line += 20) {
      await revealLine(h, doc.id, Math.min(line, lines), 1)
      for (const span of h.q('editor-host')?.querySelectorAll('.view-lines .view-line span > span') ?? []) {
        const text = plain(span.textContent)
        if (getComputedStyle(span).color === invalidColor && !allow.some((known) => text.includes(known))) marked.push(`${rel}: ${text}`)
      }
    }
  }
  h.check('no token of the milling programs is painted invalid, but the ones the known-gaps file lists for the published one', marked.length === 0, marked.slice(0, 10))
  await revealLine(h, plate.id, 8, 1)
  const callTokens = lineTokens(h, plate.id, 8, dark)
  h.check('CYCLE800() is painted as a keyword, like every cycle call', roleOf(callTokens, 'CYCLE800') === 'keyword', callTokens)
  const toolLine = lineWith(plate.id, /^N\d+ T="FACEMILL_D50"/)
  await revealLine(h, plate.id, toolLine, 1)
  const toolTokens = lineTokens(h, plate.id, toolLine, dark)
  h.check('and the T of T="FACEMILL_D50" as the tool word, its name as a string', roleOf(toolTokens, 'T') === 'tool' && roleOf(toolTokens, '"FACEMILL_D50"') === 'string', toolTokens)

  // =============================================================== F. Save As keeps the dialect
  // macOS gives the dialog no filter list (rfd would merge them, AD-7), so the milling
  // profile's own filter is a Windows and Linux matter: `stores/profiles.test.ts` holds it.
  const target = `${h.cfg.run}/plate-copy.MPF`
  await h.dialogs.queue('save', target)
  ctx.docs.activate(plate.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === plate.id, { timeout: 8000 })
  const saved = await ctx.files.saveAs(plate.id)
  await h.idle()
  h.check('Save As writes the plate to the file it was given', saved === true && (await h.disk.read(target)).startsWith('%_N_PLATE_MPF'), { saved })
  h.check('and a program saved under the extension it already has stays on the milling profile', profileOf(plate.id) === SINUMERIK_MILL, profileOf(plate.id))

  // =============================================================== G. a turning program is not read as milling
  const copy = await openFixtureAs(h, 'nc/sinumerik/s01-shaft.MPF', 'SHAFT-COPY.MPF')
  h.check('the synthetic turning shaft, a program with DIAMON, G96 and a tool change at the T word, stays turning', profileOf(copy.id) === SINUMERIK, profileOf(copy.id))
  h.check('no document was changed by any of this', ctx.docs.all().filter((doc) => doc.path !== null).every((doc) => !doc.dirty), ctx.docs.all().map((doc) => `${doc.title}:${doc.dirty}`))
})

