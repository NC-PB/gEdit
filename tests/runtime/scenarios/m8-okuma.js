// The Okuma OSP lathe profile in the running app (plan §5 M8 H8 `m8-okuma`, WP8.1–WP8.3,
// WP8.7): a posted Okuma program opens as Okuma, is painted without a single `invalid`
// token, F7 walks its turret indexes and nothing else, hover explains the codes whose
// meaning differs from a Fanuc lathe, the tool list and scale feed give their golden
// bytes — the dwell `G04 F1` untouched — and the machine item offers the three unit
// systems the control can be set to.
//
// **What would scrap a part here is reading Okuma code as Fanuc code.** `G71` is a
// multi-pass *thread* cycle on this control, not the roughing cycle it is on a Fanuc lathe,
// so its `F2` is a lead; `U` is a finish allowance, not an incremental X; `G04 F1` waits one
// second; `SB=` is the driven-tool spindle; and a `T0203` inside a `G74` block changes an
// offset, it does not index the turret. Every one of those is checked below where a user
// meets it — in the hover, in F7, in the map and in what a script changes — and every
// expected answer is read out of the fixtures (`expected/detect`, `expected/outline`,
// `scripts/**`) rather than retyped, so what G10 reviewed is what runs.
//
// `m8-okuma-units` carries the other half of the Okuma story: that the unit system is a
// machine parameter which decides every number, end to end.

import { scenario } from '../lib/index.js'
import { hoverAt, lineTokens, loadPalette, mapRows, REPO_FILE, rgbOf, rolesByColor, roleOf, setTheme } from './m3-common.js'
import { ready } from './m4-common.js'
import { undo } from './m5-common.js'
import { clickMachineAction, machineItem, machineRows, machineText, tooltipLine } from './m6-common.js'
import {
  OKUMA,
  choiceOf,
  closeSettingsDialog,
  context,
  detectGolden,
  findings,
  goldenFindings,
  goldenRows,
  lineOf,
  message,
  openCaseAs,
  openCopy,
  openFixtureAs,
  openPath,
  outlineGolden,
  pickFromItem,
  plain,
  reportRows,
  revealLine,
  runScript,
  scriptCase,
  startAdd,
  summaryIs,
  ticked,
} from './m8-common.js'

/**
 * Words painted with the role the Okuma grammar gives them (`core/grammar/okuma.ts`, whose
 * tests pin the same roles in node): the file header and the program name frame the
 * program, a sequence name is a `section` so it can never be mistaken for the block number
 * a renumber rewrites (§7.16 #13), `SB=` is a keyword because it is not the main spindle.
 */
const PAINT = [
  { rel: 'o01-flange.MIN', line: 1, words: [['$O01-FLANGE.MIN%', 'programMarker']] },
  { rel: 'o01-flange.MIN', line: 3, words: [['O1001', 'programMarker']] },
  { rel: 'o01-flange.MIN', line: 5, words: [['N1', 'blockNumber'], ['(FACE AND OD ROUGH)', 'comment']] },
  { rel: 'o01-flange.MIN', line: 8, words: [['T010101', 'tool']] },
  { rel: 'o01-flange.MIN', line: 9, words: [['G96', 'gcode'], ['S180', 'spindle'], ['M03', 'mcode']] },
  { rel: 'o01-flange.MIN', line: 11, words: [['G95', 'gcode'], ['F0.25', 'feed']] },
  { rel: 'o01-flange.MIN', line: 29, words: [['T0202', 'tool']] },
  { rel: 'o02-thread.MIN', line: 25, words: [['G04', 'gcode'], ['F1', 'feed']] },
  { rel: 'o03-live-tool.MIN', line: 13, words: [['SB', 'keyword'], ['M13', 'mcode']] },
  { rel: 'o04-sub.SUB', line: 6, words: [['NLOOP', 'section']] },
  { rel: 'o04-sub.SUB', line: 12, words: [['CALL', 'keyword'], ['O2345', 'programMarker']] },
  { rel: 'o04-sub.SUB', line: 16, words: [['G85', 'gcode'], ['NLAP1', 'section']] },
  { rel: 'o04-sub.SUB', line: 13, words: [['RTS', 'keyword']] },
]

/** The two script goldens of this scenario (WP8.7's hand-off names them for H8). */
const CASES = {
  feed: 'scale_feed/okuma-turning',
  tools: 'tool_list/okuma-turret',
}

scenario('m8-okuma', { timeout: 540, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  const palette = await loadPalette(h)
  const dark = rolesByColor(palette.dark)
  const invalidColor = rgbOf(palette.dark.invalid)
  const profile = ctx.profiles.profile(OKUMA)

  // =============================================================== A. detection
  const answers = await detectGolden(h, 'okuma')
  const rels = Object.keys(answers).sort()
  h.check('the Okuma detection golden lists its fixtures, every one of them for this profile', rels.length >= 6 && rels.every((rel) => answers[rel] === OKUMA), answers)

  /** @type {Record<string, string>} file name → document id */
  const opened = {}
  /** @type {Record<string, string>} file name → the copy in the run folder */
  const paths = {}
  for (const rel of rels) {
    // `h.fixture` copies afresh on every call, so each fixture is copied exactly once and
    // its path kept: a second copy would change the mtime under an open document.
    const { id, path } = await openPath(h, await h.fixture(rel))
    opened[rel.split('/').pop() ?? rel] = id
    paths[rel.split('/').pop() ?? rel] = path
    const got = ctx.docs.get(id)?.profileId
    h.check(`${rel} opens as ${answers[rel]}`, got === answers[rel], { got, want: answers[rel] })
    h.check(`${rel}: the profile id is the Monaco language id`, ctx.editor.model(id)?.getLanguageId() === answers[rel], ctx.editor.model(id)?.getLanguageId())
  }
  h.check(
    'the two files no extension speaks for — no extension at all, and .txt — are Okuma by their content alone',
    ctx.docs.get(opened['SHAFT-OP2'])?.profileId === OKUMA && ctx.docs.get(opened['detect-okuma.txt'])?.profileId === OKUMA,
    { noExtension: ctx.docs.get(opened['SHAFT-OP2'])?.profileId, txt: ctx.docs.get(opened['detect-okuma.txt'])?.profileId },
  )

  // The intentional M8 change: `.min`, `.sub` and `.ssb` are this control's own extensions
  // and decide on their own, because line by line an Okuma program looks like Fanuc lathe
  // code, and a `G71` thread read as the Fanuc roughing cycle would have its lead scaled.
  const ssb = await openCopy(h, paths['o04-sub.SUB'], 'O04-SUB.SSB')
  h.check('a .SSB file opens as Okuma', ctx.docs.get(ssb.id)?.profileId === OKUMA, ctx.docs.get(ssb.id)?.profileId)
  const lower = await openCopy(h, paths['o02-thread.MIN'], 'o02-thread.min')
  h.check('and so does a lower-case .min', ctx.docs.get(lower.id)?.profileId === OKUMA, ctx.docs.get(lower.id)?.profileId)
  const fanucAsMin = await openFixtureAs(h, 'nc/fanuc/f01-mill-3tools.nc', 'F01-MILL.MIN')
  h.check(
    'a Fanuc mill program saved as .MIN opens as Okuma too: the extension decides, as docs/user/dialects.md says (the remedy is to pick the dialect once, per-file memory keeps it)',
    ctx.docs.get(fanucAsMin.id)?.profileId === OKUMA,
    ctx.docs.get(fanucAsMin.id)?.profileId,
  )

  // =============================================================== B. the status bar
  const flange = opened['o01-flange.MIN']
  ctx.docs.activate(flange)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === flange, { timeout: 8000 })
  await h.idle()
  h.check('the dialect item names the Okuma profile', h.q('status-item', { item: 'profile' })?.textContent?.trim() === ctx.profiles.get(OKUMA)?.shortName, {
    item: h.q('status-item', { item: 'profile' })?.textContent?.trim(),
    shortName: ctx.profiles.get(OKUMA)?.shortName,
  })
  h.check('with no machine defined the machine item says none, and marks it assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1' && machineItem(h)?.dataset.choice === 'none', {
    text: machineText(h),
    assumed: machineItem(h)?.dataset.assumed,
    choice: machineItem(h)?.dataset.choice,
  })
  const presets = profile.machineParams?.numberInput?.presets ?? []
  const defaultPreset = presets.find((preset) => preset.id === profile.machineParams?.numberInput?.default)
  const numberLabel = ctx.t('machines.param.numberInput')
  const assumed = ctx.t('machines.source.profile')
  h.check(
    'the tooltip reads the numbers with the 1 mm unit system, and says it is the dialect default, assumed — not a fact about any machine',
    defaultPreset?.id === 'okuma-1mm' && tooltipLine(h, numberLabel) === `${numberLabel}: ${defaultPreset?.label} — ${assumed}`,
    { line: tooltipLine(h, numberLabel), preset: defaultPreset?.id },
  )
  const feedLabel = ctx.t('machines.groups.feedmode')
  h.check(
    'and it names the power-on feed mode the dialect assumes, per revolution',
    tooltipLine(h, feedLabel) === `${feedLabel}: ${profile.modal?.initial?.feedmode} — ${assumed}` && profile.modal?.initial?.feedmode === 'G95',
    tooltipLine(h, feedLabel),
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
  h.check(`no token of the ${Object.keys(opened).length} Okuma fixtures is painted invalid`, marked.length === 0, marked)

  // =============================================================== D. F7 and the program map
  const outline = await outlineGolden(h, 'okuma/o01-flange.MIN')
  const tools = outline.items.filter((item) => item.kind === 'tool')
  const toolLines = tools.map((item) => item.line)
  h.check('the outline golden gives o01-flange four turret indexes', outline.profile === OKUMA && toolLines.length === 4, toolLines)

  await h.waitFor(() => ctx.outline.toolLines(flange).length === toolLines.length, { timeout: 15000 })
  h.check('the running app finds exactly those lines', JSON.stringify(ctx.outline.toolLines(flange)) === JSON.stringify(toolLines), {
    got: ctx.outline.toolLines(flange),
    want: toolLines,
  })
  const offsetChanges = [31, 38]
  h.check(
    'a T word inside a G74 block changes the offset at the end point and is not a tool change',
    offsetChanges.every((line) => /\bG74\b.*\bT0\d0\d\b/.test(lineOf(h, flange, line)) && !ctx.outline.toolLines(flange).includes(line)),
    offsetChanges.map((line) => `${line}: ${lineOf(h, flange, line)}`),
  )

  await revealLine(h, flange, 1, 1)
  const message7 = () => h.q('status-message')?.textContent?.trim() ?? ''
  /** @param {boolean} back @param {number} expected */
  const step = async (back, expected) => {
    await h.nativeKeys([{ key: 'F7', mods: back ? ['shift'] : [] }])
    await h.waitFor(() => h.app.cursor().line === expected, { timeout: 5000 })
    return h.app.cursor().line
  }
  h.check('the editor has the focus for the key presses', h.focusEditor())
  for (const line of toolLines) h.check(`F7 goes to the turret index on line ${line}`, (await step(false, line)) === line, h.app.cursor())
  h.check('F7 wraps to the first and says so', (await step(false, toolLines[0])) === toolLines[0] && message7() === 'Wrapped around to the first tool change.', { cursor: h.app.cursor(), message: message7() })
  h.check('Shift+F7 wraps the other way', (await step(true, toolLines[3])) === toolLines[3], h.app.cursor())

  const labels = h
    .qa('program-map-item')
    .filter((element) => element.dataset.kind === 'tool')
    .map((element) => element.querySelector('.text')?.textContent?.trim() ?? '')
  h.check(
    'the map labels each index with its station and the sequence comment above it, as the outline golden writes it',
    JSON.stringify(labels) === JSON.stringify(tools.map((item) => item.text)),
    { got: labels, want: tools.map((item) => item.text), rows: mapRows(h) },
  )
  h.check(
    'the station is the middle two digits of a six-digit T word and the first two of a four-digit one',
    tools.map((item) => item.text.split(' ')[0]).join(',') === 'T1,T3,T2,T7',
    tools.map((item) => `${lineOf(h, flange, item.line)} → ${item.text}`),
  )

  // Sequence names are labels in the map, not tool changes and not block numbers.
  const sub = opened['o04-sub.SUB']
  ctx.docs.activate(sub)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === sub, { timeout: 8000 })
  await ctx.outline.whenReady(sub)
  await h.idle()
  const subOutline = await outlineGolden(h, 'okuma/o04-sub.SUB')
  const subLabels = subOutline.items.filter((item) => item.kind === 'label').map((item) => `${item.line}:label`)
  const subRows = mapRows(h).map((row) => row.split(':').slice(0, 2).join(':'))
  h.check('the sequence names NLOOP and NLAP1 are labels in the map', subLabels.length === 2 && subLabels.every((row) => subRows.includes(row)), { want: subLabels, rows: mapRows(h) })
  // G10 M8: `NEND RTS` names the block and ends the subprogram. A line gives the map one
  // item, and the end is the one that must not go missing; its text keeps the name.
  const subEnd = subOutline.items.find((item) => item.kind === 'end' && item.line === 25)
  h.check('NEND RTS is listed as the end of the subprogram, with its name', subEnd?.text === 'NEND RTS' && subRows.includes('25:end'), { want: subEnd, rows: mapRows(h) })

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
  const thread = opened['o02-thread.MIN']
  const g71 = await hoverOn(thread, 11, 'G71')
  h.check(
    'G71 is the multi-pass thread cycle on this control, whose F is the lead — not the roughing cycle it is on a Fanuc lathe',
    /^G71 — Multi-pass thread cycle/.test(g71) && /F is the lead/.test(g71) && !/Roughing cycle along/.test(g71),
    g71.slice(0, 300),
  )
  const u = await hoverOn(thread, 11, 'U0.1')
  h.check('U is a finish allowance here, not the incremental X of a Fanuc lathe', /Finish allowance on X/.test(u) && !/Incremental X/.test(u), u.slice(0, 300))
  const g04 = await hoverOn(thread, 25, 'G04')
  h.check('G04 is a dwell whose F is a time, which nothing that scales feeds may touch', /Dwell/.test(g04) && /time/.test(g04) && /not a feed/.test(g04), g04.slice(0, 300))
  const sb = await hoverOn(opened['o03-live-tool.MIN'], 13, 'SB')
  h.check('SB= is the driven-tool speed, not the main spindle', /SB/.test(sb) && /Driven-tool speed/.test(sb), sb.slice(0, 300))
  // `IF [DIA1 GT 50] N100`: inside the brackets the name stands on its own. (Behind `X=` it
  // is part of the X word's value, and the hover there is rightly the X axis.)
  const name = await hoverOn(sub, 22, 'DIA1')
  h.check('a variable the program names itself (DIA1) stays silent: its letters are not a D word and an I word', name === '', { hover: name, line: lineOf(h, sub, 22) })

  // =============================================================== F. the tool list
  const toolsCase = await scriptCase(h, CASES.tools)
  const turret = await openCaseAs(h, toolsCase, 'O09-TOOLS.MIN')
  h.check('the tool-list golden runs on Okuma, and its program opened as Okuma', toolsCase.options.profile === OKUMA && ctx.docs.get(turret.id)?.profileId === OKUMA, {
    golden: toolsCase.options.profile,
    opened: ctx.docs.get(turret.id)?.profileId,
  })
  await runScript(h, 'bundled:tool_list.py', { form: true })
  await h.waitFor(() => h.qa('results-row').length >= toolsCase.report.rows.length, { timeout: 30000 })
  const keys = toolsCase.report.columns.map((/** @type {any} */ column) => column.key)
  const columns = h.qa('results-row')[0] ? [...h.qa('results-row')[0].querySelectorAll('.cell')].map((cell) => /** @type {HTMLElement} */ (cell).dataset.column) : []
  h.check('the tool list has the golden columns, the turret offsets second', JSON.stringify(columns) === JSON.stringify(keys) && columns[1] === 'offsets', { got: columns, want: keys })
  h.check(
    'one row per station, six-digit and four-digit T words alike, the offset change T070708 folded into T7',
    JSON.stringify(reportRows(h, keys)) === JSON.stringify(goldenRows(toolsCase.report)),
    { got: reportRows(h, keys), want: goldenRows(toolsCase.report) },
  )
  h.check('the panel heads the table with the golden summary', (h.q('results-panel')?.textContent ?? '').includes(toolsCase.report.message), {
    panel: h.q('results-panel')?.textContent?.trim().slice(0, 200),
    want: toolsCase.report.message,
  })
  h.check(
    'the thread pitch and the surface speed are kept out of the ranges, and it says why',
    JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(toolsCase.report.findings)),
    { got: findings(h), want: goldenFindings(toolsCase.report.findings) },
  )
  h.check('a report changes nothing', h.app.text() === toolsCase.input && ctx.docs.get(turret.id)?.dirty !== true, { dirty: ctx.docs.get(turret.id)?.dirty })

  // =============================================================== G. scale feed, and the golden bytes
  const feedCase = await scriptCase(h, CASES.feed)
  const scale = await openCaseAs(h, feedCase, 'O05-SCALE.MIN')
  const original = await h.disk.hex(scale.path)
  h.check('the scale-feed golden runs on Okuma, and its program opened as Okuma, with no machine', feedCase.options.profile === OKUMA && ctx.docs.get(scale.id)?.profileId === OKUMA && machineText(h) === 'Machine: none (assumed)', {
    golden: feedCase.options.profile,
    opened: ctx.docs.get(scale.id)?.profileId,
    machine: machineText(h),
  })
  const dwell = feedCase.input.split('\n').findIndex((line) => /^G04 F\d/.test(line)) + 1
  h.check('the program carries a G04 dwell with an F', dwell > 0 && lineOf(h, scale.id, dwell) === 'G04 F1', { line: dwell, text: lineOf(h, scale.id, dwell) })

  await runScript(h, 'bundled:scale_feed.py', { form: true, fields: feedCase.params })
  h.check(`scale feed to ${feedCase.params.percent} % gives the golden bytes`, h.app.text() === feedCase.expected, {
    got: h.app.text().split('\n'),
    want: (feedCase.expected ?? '').split('\n'),
    status: message(h),
  })
  h.check('G04 F1 is still G04 F1: the F of a dwell is a time, never a feed', lineOf(h, scale.id, dwell) === 'G04 F1', lineOf(h, scale.id, dwell))
  h.check('and the summary is the golden’s, the dwell counted as left alone', summaryIs(h, feedCase.envelope.message), { got: message(h), want: feedCase.envelope.message })
  h.check(
    'the G71 and G33 leads and the G184 tapping feed are reported and left, and F=V1 is reported as a variable',
    JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(feedCase.envelope.findings)),
    { got: findings(h), want: goldenFindings(feedCase.envelope.findings) },
  )
  await undo(h)
  h.check('one undo takes the whole run back', h.app.text() === feedCase.input, ctx.docs.get(scale.id)?.dirty)

  await runScript(h, 'bundled:scale_feed.py', { form: true, fields: feedCase.params })
  h.check('the run is applied again', h.app.text() === feedCase.expected, message(h))
  if ((await ctx.files.save(scale.id)) !== true) throw new Error('saving the Okuma program failed')
  await h.idle()
  h.check('what was saved is the golden, byte for byte', (await h.disk.read(scale.path)) === feedCase.expected)
  h.check('and the bytes really changed, so that is not a comparison of the file with itself', (await h.disk.hex(scale.path)) !== original)

  // =============================================================== H. the machine item offers the three unit systems
  // The way a user gets there: the item, "Manage machines…", Add, the dialect.
  const offered = await pickFromItem(h, ctx.t('machines.pick.manage'))
  h.check(
    'the machine item opens the picker, which offers None and the way to the page, and no machine yet',
    JSON.stringify(offered.map((row) => row.label)) === JSON.stringify([ctx.t('machines.pick.none'), ctx.t('machines.pick.manage')]),
    offered.map((row) => row.label),
  )
  await h.waitFor(() => h.q('settings-machines'), { timeout: 10000 })
  h.check('“Manage machines…” opens Settings ▸ Machines', !!h.q('settings-machines') && machineRows(h).length === 0, { rows: machineRows(h).length })
  await startAdd(h, OKUMA)
  const fields = h.qa('form-field').map((element) => element.dataset.field)
  const numberInput = choiceOf(h, 'numberInput')
  h.check(
    'the Okuma form offers exactly the three unit systems of the profile, in its order: 1 mm, 1 µm and 10 µm',
    presets.length === 3 && JSON.stringify(numberInput.labels) === JSON.stringify(presets.map((preset) => preset.label)) && JSON.stringify(presets.map((preset) => preset.id)) === JSON.stringify(['okuma-1mm', 'okuma-1um', 'okuma-10um']),
    { offered: numberInput.labels, presets: presets.map((preset) => preset.id) },
  )
  h.check('with the 1 mm system picked, the documented default', numberInput.selected === defaultPreset?.label, numberInput.selected)
  h.check('each label says that the unit scales every number, a decimal point included', presets.slice(1).every((preset) => /every number scaled, point or not/.test(preset.label)), presets.map((preset) => preset.label))
  h.check('and X is a diameter unless the machine says otherwise', ticked(h, 'diameter') === true, ticked(h, 'diameter'))
  h.check('an Okuma machine has no G-code system to choose', fields.includes('numberInput') && !fields.some((field) => field?.startsWith('variant.')), fields)

  await clickMachineAction(h, 'cancel')
  await closeSettingsDialog(h)
  h.check('looking at the form wrote nothing: there is still no machines file', (await h.config.read('machines.json')) === null && machineText(h) === 'Machine: none (assumed)', machineText(h))

  h.check('the only document this scenario changed is the one it saved', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
