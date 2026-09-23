// Reading a turning program (plan §5 M6 H6 `m6-lathe-nav`, WP6.2 and WP6.4): F7 and
// Shift+F7 walk the turret's tool changes, the program map labels them, and hover explains
// the cycles and the two X words a lathe has.
//
// **The T word is the thing to get right.** On a turret lathe `T0101` is tool 1 with offset
// 01 and `T0100` is the same tool cancelling its offset — a retract, not a tool change. A
// dialect that read every `T` as a tool change would give this 60-line program six tool
// stops instead of three, and F7 would land on the retract blocks. The outline goldens say
// three, so that is what navigation has to visit, and the retracts have to be absent from
// the map.
//
// Real key presses, for the same reason `m3-nav` uses them: F7 and Shift+F7 are the
// binding under test, and they are plain keys, so they are delivered whether or not the app
// is frontmost (WP3.0 §1).

import { scenario } from '../lib/index.js'
import { hoverAt, mapRows, revealLine } from './m3-common.js'
import { L01, LATHE, context, openFixture, ready } from './m6-common.js'

/** The tool changes of `l01-turning-a.nc`, from `expected/outline/fanuc-lathe/`. */
const GOLDEN = 'expected/outline/fanuc-lathe/l01-turning-a.nc.json'

/** Lines that carry a `T` word but are **not** a tool change: the offset-cancel retracts. */
const RETRACTS = [25, 44, 55]

scenario('m6-lathe-nav', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  const message = () => h.q('status-message')?.textContent?.trim() ?? ''
  const cursor = () => h.app.cursor().line

  /**
   * Steps with a real key press and waits for the cursor to land.
   * @param {'F7' | 'Shift+F7'} key
   * @param {number} expected
   */
  const step = async (key, expected) => {
    await h.nativeKeys([{ key: 'F7', mods: key === 'Shift+F7' ? ['shift'] : [] }])
    await h.waitFor(() => cursor() === expected, { timeout: 5000 })
    return cursor()
  }

  const outline = JSON.parse(await h.disk.read(await h.fixture(GOLDEN)))
  /** @type {{ line: number, text: string, tool: string }[]} */
  const tools = outline.items.filter((/** @type {any} */ item) => item.kind === 'tool')
  const toolLines = tools.map((item) => item.line)
  h.check('the outline golden says this program has three tool changes', outline.profile === LATHE && toolLines.length === 3, { profile: outline.profile, toolLines })

  const lathe = await openFixture(h, L01)
  await h.waitFor(() => ctx.outline.toolLines(lathe.id).length === toolLines.length, { timeout: 15000 })
  h.check('the running app finds exactly those lines, and no retract among them', JSON.stringify(ctx.outline.toolLines(lathe.id)) === JSON.stringify(toolLines), {
    got: ctx.outline.toolLines(lathe.id),
    want: toolLines,
  })
  h.check(
    'T0100, T0300 and T0500 are offset cancels on a retract block, not tool changes',
    RETRACTS.every((line) => !ctx.outline.toolLines(lathe.id).includes(line) && /T0\d00/.test(ctx.editor.getLines(lathe.id, line, line)[0] ?? '')),
    RETRACTS.map((line) => `${line}: ${ctx.editor.getLines(lathe.id, line, line)[0]}`),
  )

  // ------------------------------------------------------------ F7 and Shift+F7
  await revealLine(h, lathe.id, 1, 1)
  h.check('the editor has the focus for the key presses', h.focusEditor())
  h.check(`F7 goes to the first tool change (line ${toolLines[0]})`, (await step('F7', toolLines[0])) === toolLines[0], h.app.cursor())
  h.check(`F7 goes on to the second (line ${toolLines[1]})`, (await step('F7', toolLines[1])) === toolLines[1], h.app.cursor())
  h.check(`and to the third (line ${toolLines[2]})`, (await step('F7', toolLines[2])) === toolLines[2], h.app.cursor())
  h.check('F7 wraps to the first and says so', (await step('F7', toolLines[0])) === toolLines[0] && message() === 'Wrapped around to the first tool change.', { cursor: h.app.cursor(), message: message() })
  h.check('Shift+F7 wraps the other way and says so', (await step('Shift+F7', toolLines[2])) === toolLines[2] && message() === 'Wrapped around to the last tool change.', { cursor: h.app.cursor(), message: message() })
  h.check('Shift+F7 keeps stepping backwards', (await step('Shift+F7', toolLines[1])) === toolLines[1], h.app.cursor())

  // ------------------------------------------------------------ the program map
  const rows = mapRows(h)
  h.check('the map draws a row for every tool change and none for a retract', toolLines.every((line) => rows.includes(`${line}:tool:0`) || rows.includes(`${line}:tool:1`)) && !RETRACTS.some((line) => rows.some((row) => row.startsWith(`${line}:tool`))), rows)

  const labels = h.qa('program-map-item')
    .filter((element) => element.dataset.kind === 'tool')
    .map((element) => element.querySelector('.text')?.textContent?.trim() ?? '')
  h.check(
    'each one is labelled with the turret station and the comment beside it, as the outline golden writes it',
    JSON.stringify(labels) === JSON.stringify(tools.map((item) => item.text)),
    { got: labels, want: tools.map((item) => item.text) },
  )
  h.check('the station is the tool number and not the four digits of the T word', tools.every((item) => /^T\d+ /.test(item.text)) && tools[0].text.startsWith('T1 ') && tools[1].text.startsWith('T3 ') && tools[2].text.startsWith('T5 '), tools.map((item) => `${item.text}|${item.tool}`))

  // Clicking the third row goes there, which is what the map is for.
  const third = h.qa('program-map-item').filter((element) => element.dataset.kind === 'tool')[2]
  await revealLine(h, lathe.id, 1, 1)
  h.click(third)
  await h.waitFor(() => cursor() === toolLines[2], { timeout: 5000 })
  h.check('clicking a tool row reveals its line', cursor() === toolLines[2], h.app.cursor())

  // ------------------------------------------------------------ hover
  // Four words whose meaning is the lathe's and not the mill's. The checks read what the
  // hover says rather than the whole text, because the descriptions are reviewed data
  // (G10) and would otherwise have to be retyped here.
  const g71 = await hoverAt(h, lathe.id, 16, 2)
  h.check('G71 is the roughing cycle along Z, and the hover says it is written in two blocks', /Roughing cycle along Z/.test(g71) && /two blocks/i.test(g71) && /Cycle/.test(g71), g71.slice(0, 400))

  const g76 = await hoverAt(h, lathe.id, 33, 2)
  h.check('G76 is the multi-pass threading cycle, and the hover warns that its F is a lead', /Multi-pass threading cycle/.test(g76) && /lead/i.test(g76), g76.slice(0, 400))

  // `G00 X32. Z2.` — X on a lathe is a diameter, which is the difference that scraps parts.
  const x = await hoverAt(h, lathe.id, 14, 5)
  h.check('X is described as a diameter', /X axis, a diameter/.test(x), x.slice(0, 300))

  // `G71 U2. R0.5` — U is the incremental X, and inside a cycle it is a depth of cut.
  const u = await hoverAt(h, lathe.id, 15, 5)
  h.check('U is the incremental X, also a diameter, and the hover says what it means inside a cycle', /Incremental X, a diameter/.test(u) && /depth of cut/i.test(u), u.slice(0, 300))

  h.check('navigation and hover moved the cursor only: nothing was edited', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
