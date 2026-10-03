// The Sinumerik 840D turning profile in the running app (plan §5 M8 H8 `m8-sinumerik`,
// WP8.1, WP8.4, WP8.5, WP8.7): a turning `.MPF` opens as Sinumerik, is painted without an
// `invalid` token — `CYCLE81(…)` as a keyword — F7 walks every form of its tool call and
// nothing that only looks like one, completion offers the `CYCLE8x` cycles from the code
// database (behind `MCALL` too), hover reads the spindle-addressed words for what they are,
// and the three bundled scripts give their golden bytes.
//
// **The words that decide this dialect are the ones that look like another word.**
// `M3=3` is M3 for spindle 3, not a code M33; `S3=2400` drives spindle 3 and is not the
// main spindle's speed; `LIMS=3000` is a clamp; `G4 S2` waits two revolutions and `G4 F1.5`
// waits one and a half seconds; `T0 D0` takes the tool away and `MSG("T1 ROUGH")` is a
// message; `XNOW` is a name, not an X word. Each of them is checked where the user meets
// it: in the paint, the hover, F7, the map and what a script changes. The expected answers
// are read out of the fixtures, the database and the profile, never retyped.

import { scenario } from '../lib/index.js'
import { hoverAt, lineTokens, loadPalette, mapRows, REPO_FILE, rgbOf, rolesByColor, roleOf, setTheme, suggestAt } from './m3-common.js'
import { ready } from './m4-common.js'
import { undo } from './m5-common.js'
import { machineItem, machineText, tooltipLine } from './m6-common.js'
import {
  SINUMERIK,
  context,
  detectGolden,
  findings,
  goldenFindings,
  goldenRows,
  lineOf,
  message,
  openCaseAs,
  openFixtureAs,
  openPath,
  outlineGolden,
  plain,
  reportRows,
  revealLine,
  runScript,
  scriptCase,
  summaryIs,
} from './m8-common.js'

/**
 * Words painted with the role the Sinumerik grammar gives them (`core/grammar/sinumerik.ts`,
 * whose tests pin the same roles in node). A call is a keyword, cycle or not; a word that
 * drives another spindle (`S3=`) is a keyword too, so it never reads as the speed a script
 * may scale; `LIMS=` keeps the plain colour of a value word; a label is a `section`.
 */
const PAINT = [
  { rel: 's01-shaft.MPF', line: 1, words: [['%_N_SHAFT_MPF', 'programMarker']] },
  // Monaco draws a long token in several spans of the same colour, so a comment is found by its head.
  { rel: 's01-shaft.MPF', line: 2, words: [['; WRITTEN FOR GEDIT', 'comment']] },
  { rel: 's01-shaft.MPF', line: 10, words: [['N10', 'blockNumber'], ['G18', 'gcode'], ['DIAMON', 'keyword']] },
  { rel: 's01-shaft.MPF', line: 12, words: [['MSG', 'keyword'], ['"OD ROUGH"', 'string']] },
  { rel: 's01-shaft.MPF', line: 13, words: [['T', 'tool'], ['"ROUGH"', 'string']] },
  { rel: 's01-shaft.MPF', line: 14, words: [['S200', 'spindle'], ['LIMS', 'number'], ['M4', 'mcode']] },
  { rel: 's01-shaft.MPF', line: 16, words: [['CYCLE95', 'keyword']] },
  { rel: 's02-drill.MPF', line: 21, words: [['S3', 'keyword'], ['M3', 'mcode']] },
  { rel: 's02-drill.MPF', line: 24, words: [['MCALL', 'keyword'], ['CYCLE83', 'keyword']] },
  { rel: 's03-sub.SPF', line: 4, words: [['PROC', 'keyword']] },
  { rel: 's03-sub.SPF', line: 8, words: [['R10', 'variable']] },
  { rel: 's03-sub.SPF', line: 12, words: [['NEXT_PECK:', 'section']] },
  { rel: 's04-packed.MPF', line: 9, words: [['/1', 'skip'], ['N70', 'blockNumber']] },
]

/** The script goldens of this scenario (WP8.7's hand-off names them for H8). */
const CASES = {
  tools: 'tool_list/sinumerik-tools',
  feed: 'scale_feed/sinumerik-turning',
  speed: 'scale_speed/sinumerik-spindles',
}

/** A scratch program for completion: a cycle half typed alone, behind `MCALL`, behind a move, and in prose. */
const COMPLETION = [
  'N10 G18 G90 G95 DIAMON',
  'N80 CYCLE8',
  'N200 MCALL CYCLE8',
  'N210 G0 X10 CYCLE8',
  'N220 ; CYCLE8',
  'N230 MSG("OD ROUGH")',
  'N240 M30',
].join('\n')

scenario('m8-sinumerik', { timeout: 540, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  const palette = await loadPalette(h)
  const dark = rolesByColor(palette.dark)
  const invalidColor = rgbOf(palette.dark.invalid)
  const profile = ctx.profiles.profile(SINUMERIK)

  // =============================================================== A. detection
  const answers = await detectGolden(h, 'sinumerik')
  const rels = Object.keys(answers).sort()
  h.check('the Sinumerik detection golden lists its fixtures, every one of them for this profile', rels.length >= 7 && rels.every((rel) => answers[rel] === SINUMERIK), answers)

  /** @type {Record<string, string>} file name → document id */
  const opened = {}
  for (const rel of rels) {
    const { id } = await openPath(h, await h.fixture(rel))
    opened[rel.split('/').pop() ?? rel] = id
    const got = ctx.docs.get(id)?.profileId
    h.check(`${rel} opens as ${answers[rel]}`, got === answers[rel], { got, want: answers[rel] })
    h.check(`${rel}: the profile id is the Monaco language id`, ctx.editor.model(id)?.getLanguageId() === answers[rel], ctx.editor.model(id)?.getLanguageId())
  }
  h.check(
    'the two files no extension speaks for — none at all, and .txt — are Sinumerik by their content alone, although Klartext writes ; comments too',
    ctx.docs.get(opened['SHAFT_OP20'])?.profileId === SINUMERIK && ctx.docs.get(opened['detect-sinumerik.txt'])?.profileId === SINUMERIK,
    { noExtension: ctx.docs.get(opened['SHAFT_OP20'])?.profileId, txt: ctx.docs.get(opened['detect-sinumerik.txt'])?.profileId },
  )
  // `.mpf` is a hint, not a verdict (docs/user/dialects.md): a Fanuc program under it is
  // still Fanuc, which is what keeps a Siemens control's ISO-mode program on a Fanuc profile.
  const isoAsMpf = await openFixtureAs(h, 'nc/fanuc/f01-mill-3tools.nc', 'F01-MILL.MPF')
  h.check('a Fanuc program saved as .MPF still opens as Fanuc: the extension only points', ctx.docs.get(isoAsMpf.id)?.profileId === 'fanuc-gcode', ctx.docs.get(isoAsMpf.id)?.profileId)

  // =============================================================== B. the status bar
  const shaft = opened['s01-shaft.MPF']
  ctx.docs.activate(shaft)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === shaft, { timeout: 8000 })
  await h.idle()
  h.check('the dialect item names the Sinumerik profile', h.q('status-item', { item: 'profile' })?.textContent?.trim() === ctx.profiles.get(SINUMERIK)?.shortName, h.q('status-item', { item: 'profile' })?.textContent?.trim())
  h.check('with no machine defined the machine item says none, and marks it assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', machineText(h))
  const assumed = ctx.t('machines.source.profile')
  const numberLabel = ctx.t('machines.param.numberInput')
  const defaultPreset = profile.machineParams?.numberInput?.presets?.find((preset) => preset.id === profile.machineParams?.numberInput?.default)
  h.check('the tooltip reads numbers as written, as the dialect default, assumed', tooltipLine(h, numberLabel) === `${numberLabel}: ${defaultPreset?.label} — ${assumed}`, tooltipLine(h, numberLabel))
  const planeLabel = ctx.t('machines.groups.plane')
  const feedLabel = ctx.t('machines.groups.feedmode')
  h.check(
    'and it names the two power-on codes the turning profile assumes: G18, and feed per revolution',
    tooltipLine(h, planeLabel) === `${planeLabel}: G18 — ${assumed}` && tooltipLine(h, feedLabel) === `${feedLabel}: G95 — ${assumed}`,
    [tooltipLine(h, planeLabel), tooltipLine(h, feedLabel)],
  )

  // =============================================================== C. the grammar paints, and never `invalid`
  for (const { rel, line, words } of PAINT) {
    const id = opened[rel]
    await revealLine(h, id, line, 1)
    const tokens = lineTokens(h, id, line, dark)
    for (const [text, role] of words) {
      h.check(`${rel}:${line} — ${text} is painted as ${role}`, roleOf(tokens, text) === role, { got: roleOf(tokens, text), want: role, line: tokens })
    }
  }

  /** @type {string[]} */
  const marked = []
  for (const [name, id] of Object.entries(opened)) {
    const lines = ctx.editor.getLineCount(id)
    for (let line = 1; line <= lines; line += 10) {
      await revealLine(h, id, Math.min(line, lines), 1)
      for (const span of h.q('editor-host')?.querySelectorAll('.view-lines .view-line span > span') ?? []) {
        if (getComputedStyle(span).color === invalidColor) marked.push(`${name}: ${plain(span.textContent)}`)
      }
    }
  }
  h.check(`no token of the ${Object.keys(opened).length} Sinumerik fixtures is painted invalid`, marked.length === 0, marked)

  // =============================================================== D. F7 and the program map
  const packed = opened['s04-packed.MPF']
  const outline = await outlineGolden(h, 'sinumerik/s04-packed.MPF')
  const tools = outline.items.filter((item) => item.kind === 'tool')
  const toolLines = tools.map((item) => item.line)
  h.check('the outline golden gives s04-packed four tool changes, one per form of the T word', outline.profile === SINUMERIK && toolLines.length === 4, tools.map((item) => `${item.line}: ${item.text}`))
  await h.waitFor(() => ctx.outline.toolLines(packed).length === toolLines.length, { timeout: 15000 })
  h.check('the running app finds exactly those lines', JSON.stringify(ctx.outline.toolLines(packed)) === JSON.stringify(toolLines), { got: ctx.outline.toolLines(packed), want: toolLines })
  const lookalikes = [5, 12, 13]
  h.check(
    'T0 D0 takes the tool away and a message that names a tool is a message: neither is a tool change',
    lookalikes.every((line) => /T\d/.test(lineOf(h, packed, line)) && !ctx.outline.toolLines(packed).includes(line)),
    lookalikes.map((line) => `${line}: ${lineOf(h, packed, line)}`),
  )

  await revealLine(h, packed, 1, 1)
  /** @param {boolean} back @param {number} expected */
  const step = async (back, expected) => {
    await h.nativeKeys([{ key: 'F7', mods: back ? ['shift'] : [] }])
    await h.waitFor(() => h.app.cursor().line === expected, { timeout: 5000 })
    return h.app.cursor().line
  }
  h.check('the editor has the focus for the key presses', h.focusEditor())
  for (const line of toolLines) h.check(`F7 goes to the tool change on line ${line}: ${lineOf(h, packed, line)}`, (await step(false, line)) === line, h.app.cursor())
  h.check('F7 on the last one wraps to the first', (await step(false, toolLines[0])) === toolLines[0], h.app.cursor())
  h.check('and Shift+F7 from there wraps back to the last', (await step(true, toolLines[3])) === toolLines[3], h.app.cursor())

  const labels = h
    .qa('program-map-item')
    .filter((element) => element.dataset.kind === 'tool')
    .map((element) => element.querySelector('.text')?.textContent?.trim() ?? '')
  h.check('the map labels each tool change as the outline golden writes it, a named tool by its name', JSON.stringify(labels) === JSON.stringify(tools.map((item) => item.text)), {
    got: labels,
    want: tools.map((item) => item.text),
    rows: mapRows(h),
  })

  // =============================================================== E. hover
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
  const drill = opened['s02-drill.MPF']
  const m3 = await hoverOn(drill, 21, 'M3=3')
  h.check('M3=3 is M3 for spindle 3 — spindle on, clockwise — and not a code M33', /^M3=3 — Spindle on, clockwise/.test(m3) && /spindle 3/.test(m3) && !/M33/.test(m3), m3.slice(0, 300))
  const m5 = await hoverOn(drill, 30, 'M3=5')
  h.check('and M3=5 stops that spindle', /^M3=5 — Spindle stop/.test(m5), m5.slice(0, 300))
  const s3 = await hoverOn(drill, 21, 'S3=2400')
  h.check('S3=2400 is read as the S address — a speed, for the spindle its number names — and not as a word S32400', /^S — Spindle speed/.test(s3) && !/S32400/.test(s3), s3.slice(0, 300))
  const lims = await hoverOn(shaft, 14, 'LIMS')
  h.check('LIMS= is the spindle speed limit', /^LIMS — Spindle speed limit/.test(lims), lims.slice(0, 300))
  const msg = await hoverOn(shaft, 12, 'MSG')
  h.check('a call the database knows is explained by its name: MSG', /^MSG — Operator message/.test(msg), msg.slice(0, 300))
  const cycle = await hoverOn(drill, 12, 'CYCLE83')
  h.check('CYCLE83 is confirmed by the 840D sl programming manual, so the hover says what it does', /^CYCLE83 — Deep-hole drilling cycle/.test(cycle), cycle.slice(0, 300))
  const diamon = await hoverOn(shaft, 10, 'DIAMON')
  h.check('DIAMON switches diameter programming on', /^DIAMON — Diameter programming on/.test(diamon), diamon.slice(0, 300))
  const sub = opened['s03-sub.SPF']
  const xnow = await hoverOn(sub, 14, 'XNOW')
  const label = await hoverOn(sub, 14, 'LAST_CUT')
  h.check('a name the program gives itself stays silent: XNOW is not an X word, LAST_CUT is not a code', xnow === '' && label === '', { xnow, label, line: lineOf(h, sub, 14) })

  // =============================================================== F. completion
  const cycles = ctx.codes.forProfile(SINUMERIK).codes.filter((entry) => /^CYCLE8/.test(entry.code)).map((entry) => entry.code)
  h.check('the database holds the CYCLE8x cycles', cycles.length >= 10 && cycles.includes('CYCLE81') && cycles.includes('CYCLE840'), cycles)
  const scratch = ctx.files.newUntitled({ profileId: SINUMERIK, text: COMPLETION })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === scratch, { timeout: 10000 })
  /** @param {number} line */
  const endOf = (line) => lineOf(h, scratch, line).length + 1
  const alone = await suggestAt(h, scratch, 2, endOf(2))
  const aloneLabels = alone.db.map((row) => row.label)
  h.check('CYCLE8 offers the CYCLE8x cycles of the database, and nothing else', alone.showing && aloneLabels.length === cycles.length && cycles.every((code) => aloneLabels.includes(code)), { got: aloneLabels, want: cycles })
  // M9 (WP9.1) added CYCLE800 and CYCLE832 to the database; by number they come after
  // CYCLE89 and before CYCLE840.
  h.check('in the order of their numbers: CYCLE89, then CYCLE800, CYCLE832 and CYCLE840', JSON.stringify(aloneLabels.slice(-4)) === JSON.stringify(['CYCLE89', 'CYCLE800', 'CYCLE832', 'CYCLE840']), aloneLabels)
  const behindMcall = await suggestAt(h, scratch, 3, endOf(3))
  h.check('behind MCALL, the same cycles', JSON.stringify(behindMcall.db.map((row) => row.label)) === JSON.stringify(aloneLabels), behindMcall.db.map((row) => row.label))
  const behindMove = await suggestAt(h, scratch, 4, endOf(4))
  h.check('behind a move in the same block, the same cycles', JSON.stringify(behindMove.db.map((row) => row.label)) === JSON.stringify(aloneLabels), behindMove.db.map((row) => row.label))
  const inComment = await suggestAt(h, scratch, 5, endOf(5))
  h.check('inside a ; comment the database offers nothing', inComment.db.length === 0, inComment.rows)
  // The rule of WP3.6 is "nothing inside a comment or a string", and a message is prose. The
  // cursor sits in the middle of the text, where a user writing a message would be.
  const inMessage = await suggestAt(h, scratch, 6, lineOf(h, scratch, 6).indexOf('ROUGH') + 1)
  h.check('inside the text of MSG("…") the database offers nothing either', inMessage.db.length === 0, { line: lineOf(h, scratch, 6), offered: inMessage.db.map((row) => row.label) })

  // =============================================================== G. the tool list
  const toolsCase = await scriptCase(h, CASES.tools)
  const toolsDoc = await openCaseAs(h, toolsCase, 'TOOLS.MPF')
  h.check('the tool-list golden runs on Sinumerik, and its program opened as Sinumerik', toolsCase.options.profile === SINUMERIK && ctx.docs.get(toolsDoc.id)?.profileId === SINUMERIK, ctx.docs.get(toolsDoc.id)?.profileId)
  await runScript(h, 'bundled:tool_list.py', { form: true })
  await h.waitFor(() => h.qa('results-row').length >= toolsCase.report.rows.length, { timeout: 30000 })
  const keys = toolsCase.report.columns.map((/** @type {any} */ column) => column.key)
  h.check(
    'one row per tool — T1, a tool by its name, a tool on a numbered spindle, and the part-off tool — and none for T0 or the message that names T1',
    JSON.stringify(reportRows(h, keys)) === JSON.stringify(goldenRows(toolsCase.report)),
    { got: reportRows(h, keys), want: goldenRows(toolsCase.report) },
  )
  h.check('the panel heads the table with the golden summary', (h.q('results-panel')?.textContent ?? '').includes(toolsCase.report.message), h.q('results-panel')?.textContent?.trim().slice(0, 160))
  h.check('with the golden findings', JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(toolsCase.report.findings)), { got: findings(h), want: goldenFindings(toolsCase.report.findings) })

  // =============================================================== H. scale feed
  const feedCase = await scriptCase(h, CASES.feed)
  const feedDoc = await openCaseAs(h, feedCase, 'SCALE.MPF')
  h.check('the scale-feed golden runs on Sinumerik, and its program opened as Sinumerik', feedCase.options.profile === SINUMERIK && ctx.docs.get(feedDoc.id)?.profileId === SINUMERIK, ctx.docs.get(feedDoc.id)?.profileId)
  const dwells = feedCase.input.split('\n').flatMap((text, i) => (/\bG4 [FS]/.test(text) ? [i + 1] : []))
  h.check('the program carries both dwells, G4 F and G4 S', dwells.length === 2, dwells.map((line) => lineOf(h, feedDoc.id, line)))
  await runScript(h, 'bundled:scale_feed.py', { form: true, fields: feedCase.params })
  h.check(`scale feed to ${feedCase.params.percent} % gives the golden bytes`, h.app.text() === feedCase.expected, {
    got: h.app.text().split('\n'),
    want: (feedCase.expected ?? '').split('\n'),
    status: message(h),
  })
  h.check('G4 F1.5 and G4 S2 are untouched: a dwell in seconds and a dwell in revolutions, neither a feed', dwells.every((line) => lineOf(h, feedDoc.id, line) === feedCase.input.split('\n')[line - 1]), dwells.map((line) => lineOf(h, feedDoc.id, line)))
  h.check('the golden summary: the dwell, the parameter feed, the cycle feeds and the tapping cycle each accounted for', summaryIs(h, feedCase.envelope.message), { got: message(h), want: feedCase.envelope.message })
  h.check(
    'F=R1 is reported as a variable, the CYCLE85 feeds are listed and left, and the F750 that CYCLE840 taps with is left and flagged',
    JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(feedCase.envelope.findings)),
    { got: findings(h), want: goldenFindings(feedCase.envelope.findings) },
  )
  await undo(h)
  h.check('one undo takes the whole run back', h.app.text() === feedCase.input, ctx.docs.get(feedDoc.id)?.dirty)

  // =============================================================== I. scale speed, and the golden bytes
  const speedCase = await scriptCase(h, CASES.speed)
  const speedDoc = await openCaseAs(h, speedCase, 'SPINDLES.MPF')
  h.check('the scale-speed golden runs on Sinumerik, and its program opened as Sinumerik', speedCase.options.profile === SINUMERIK && ctx.docs.get(speedDoc.id)?.profileId === SINUMERIK, ctx.docs.get(speedDoc.id)?.profileId)
  // The plan's paint check, on a turning program that calls it: `CYCLE81(…)` is a keyword.
  const cycleLine = speedCase.input.split('\n').findIndex((text) => /CYCLE81\(/.test(text)) + 1
  await revealLine(h, speedDoc.id, cycleLine, 1)
  const cycleTokens = lineTokens(h, speedDoc.id, cycleLine, dark)
  h.check('CYCLE81(…) is painted as a keyword', cycleLine > 0 && roleOf(cycleTokens, 'CYCLE81') === 'keyword', { line: lineOf(h, speedDoc.id, cycleLine), tokens: cycleTokens })

  // Each word that is not the main spindle's speed, by the line it stands on: the line
  // itself may also carry a speed that is scaled, so the word is what is compared.
  const before = speedCase.input.split('\n')
  const untouched = before.flatMap((text, i) => [...text.matchAll(/G26 S3?=?\d+|LIMS=\d+|S3=\d+|SF=\d+|G4 S\d+|S=R\d+/g)].map((match) => ({ line: i + 1, word: match[0] })))
  const original = await h.disk.hex(speedDoc.path)
  await runScript(h, 'bundled:scale_speed.py', { form: true, fields: speedCase.params })
  h.check(`scale spindle speeds to ${speedCase.params.percent} % gives the golden bytes`, h.app.text() === speedCase.expected, {
    got: h.app.text().split('\n'),
    want: (speedCase.expected ?? '').split('\n'),
    status: message(h),
  })
  h.check(
    'the clamps G26 S and LIMS=, the other spindle’s S3=, the thread start angle SF=, the dwell G4 S2 and S=R2 are all as they were',
    untouched.length >= 7 && untouched.every(({ line, word }) => lineOf(h, speedDoc.id, line).includes(word)),
    untouched.map(({ line, word }) => `${word} → ${lineOf(h, speedDoc.id, line)}`),
  )
  h.check('the golden summary', summaryIs(h, speedCase.envelope.message), { got: message(h), want: speedCase.envelope.message })
  h.check('and the golden findings: three limits (S3= of the G26 block among them), the thread flagged, S3= reported, S=R2 a variable, and SF= not mentioned', JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(speedCase.envelope.findings)), {
    got: findings(h),
    want: goldenFindings(speedCase.envelope.findings),
  })
  if ((await ctx.files.save(speedDoc.id)) !== true) throw new Error('saving the Sinumerik program failed')
  await h.idle()
  h.check('what was saved is the golden, byte for byte', (await h.disk.read(speedDoc.path)) === speedCase.expected && (await h.disk.hex(speedDoc.path)) !== original)

  h.check('no file on disk was left unsaved', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
