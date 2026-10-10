// The editor behaviours of the B1 bug-fix round that need the real Monaco and the real window.
//
//   b1-edits-1000     (A4) A transform that changes 1,500 separate lines: bookmarks on the lines it did not touch stay
//                     on their lines, and one Undo gives the whole program back. (The unit tests prove the batching
//                     against a fake model; only Monaco can say what happens to the marks.)
//   b1-map-scroll     (A4) The cursor moves far down a long program (with the keyboard): the program map scrolls to the
//                     row that holds it.
//   b1-convert-case   (A5) Convert Case to upper case leaves the program name `o1001` as it is and says so: a row on
//                     its line and the count in the Results panel.
//   b1-colorbox       (A9) `#101=5` and `#2000=1` get no colour box: the option is off in the editor, and no swatch is
//                     drawn after the text has been typed.
//   b1-hover-line1    (A9, owner decision) A hover on a word in the first lines is placed the way Monaco places it and is
//                     fully visible: inside the window, not cut off, nothing drawn over it (it may cover the ribbon).

import { scenario } from '../lib/index.js'
import { hoverAt } from './m3-common.js'
import { runTransform, transformCase } from './m4-common.js'
import { undo } from './m5-common.js'
import { context, hoverBox, message, newDoc, ready, revealLine, rowVisible } from './b1-common.js'

/**
 * A program of `count` lines with a comment on every second one, a Remove Comments run over it, one Undo.
 * @param {import('../lib/api.js').Harness} h
 * @param {number} count
 */
async function removeCommentsAndUndo(h, count) {
  const ctx = context(h)
  /** @type {string[]} */
  const lines = []
  for (let i = 1; i <= count; i++) lines.push(i % 2 === 0 ? `N${i} G1 Y${i}. (C${i})` : `N${i} G1 X${i}.`)
  const program = `${lines.join('\n')}\n`
  const id = await newDoc(h, program)
  const comments = lines.filter((l) => l.includes('(')).length
  const marks = [3, count / 2 + 1, count - 1]
  for (const line of marks) ctx.bookmarks.toggle(id, line)
  await revealLine(h, id, 2, 1)
  const placed = JSON.stringify(ctx.bookmarks.lines(id)) === JSON.stringify(marks)

  const ran = await runTransform(h, 'nc.removeComments', { form: true })
  const after = h.app.text().split('\n')
  const changed = lines.filter((l, i) => after[i] !== l).length
  const edited = { ran, comments, changed, lines: after.length, status: message(h), onlyComments: lines.every((l, i) => l.includes('(') || after[i] === l) && !h.app.text().includes('(') }
  const keptMarks = ctx.bookmarks.lines(id)

  await undo(h)
  const restored = h.app.text() === program
  const marksAfterUndo = ctx.bookmarks.lines(id)
  return { marks, placed, edited, keptMarks, restored, marksAfterUndo, count }
}

scenario('b1-edits-1000', { timeout: 300 }, async (h) => {
  await ready(h)
  // ------------------------------------------------------------ 1,500 separate edits (before B1 A4: one whole hunk)
  const big = await removeCommentsAndUndo(h, 3000)
  h.check('three bookmarks sit on lines without a comment of a 3,000-line program', big.placed, { marks: big.marks })
  h.check('Remove Comments changed 1,500 separate lines and nothing else: no comment is left, every other line is as it was', big.edited.ran === true && big.edited.changed === 1500 && big.edited.comments === 1500 && big.edited.lines === 3001 && big.edited.onlyComments, big.edited)
  h.check('the bookmarks stayed on their lines', JSON.stringify(big.keptMarks) === JSON.stringify(big.marks), big.keptMarks)
  h.check('one Undo gives the whole program back', big.restored)
  // Known limit, not pinned: Monaco applies the undo of 1,000 or more edits as one edit again, so the bookmarks between
  // the first and the last of them move on Undo (seen: [3, 1501, 2999] became [2, 1241, 2454]). Logged for the record.
  h.log('b1-edits-1000: bookmarks after the Undo of 1,500 edits', JSON.stringify(big.marksAfterUndo), 'were', JSON.stringify(big.marks))

  // ------------------------------------------------------------ 900 separate edits: below the limit both ways
  const small = await removeCommentsAndUndo(h, 1800)
  h.check('with 900 edits the same holds, and the bookmarks are where they were after the Undo too', small.placed && small.edited.changed === 900 && small.edited.onlyComments && JSON.stringify(small.keptMarks) === JSON.stringify(small.marks) && small.restored && JSON.stringify(small.marksAfterUndo) === JSON.stringify(small.marks), small)
})

scenario('b1-map-scroll', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const TOOLS = 400
  const lines = ['%', 'O2000 (LONG MAP)']
  for (let i = 1; i <= TOOLS; i++) lines.push(`N${i * 10} T${i} M6`, `G0 X${i}. Y${i}.`, `G1 Z-${i}. F100.`)
  lines.push('M30', '%', '')
  const id = await newDoc(h, lines.join('\n'))
  await h.waitFor(() => h.qa('program-map-item', { kind: 'tool' }).length >= TOOLS, { timeout: 20000 })
  // Line 2 is the program row (`O2000`); line 1 is before every row, so no row holds the cursor there.
  await revealLine(h, id, 2, 1)
  const active = () => h.q('program-map-item', { active: '1' })
  if (!(await h.waitFor(() => !!active(), { timeout: 8000 }))) throw new Error('no map row holds the cursor on line 2')
  const top = rowVisible(/** @type {Element} */ (active()))
  h.check('the map is longer than its panel, and at the start it shows the top', top.scrolls && top.scrollTop === 0 && top.visible, top)

  // Real keys: Cmd+Down moves the cursor to the end of the program.
  h.check('the editor is focused', h.focusEditor())
  await h.nativeKeys([{ key: 'ArrowDown', mods: ['cmd'] }])
  await h.waitFor(() => Number(active()?.dataset.line ?? 0) > 1000, { timeout: 8000 })
  await h.idle()
  const row = active()
  const state = rowVisible(/** @type {Element} */ (row))
  h.check('with the cursor at the end the active row is far down the map', Number(row?.dataset.line ?? 0) > 1000, { line: row?.dataset.line, cursor: h.app.cursor() })
  h.check('and the map has scrolled to it: the row is inside the visible part of the panel', state.visible && state.scrollTop > 0, state)

  // Back to the top with the keyboard: the map follows in the other direction too.
  await h.nativeKeys([{ key: 'ArrowUp', mods: ['cmd'] }, { key: 'ArrowDown' }])
  await h.waitFor(() => Number(active()?.dataset.line ?? 99999) <= 2, { timeout: 8000 })
  await h.idle()
  const back = rowVisible(/** @type {Element} */ (active()))
  h.check('Cmd+Up and one Down bring the map back to its top row', back.visible && back.scrollTop < 20, back)
  void ctx
})

scenario('b1-convert-case', { timeout: 120 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const fixture = await transformCase(h, 'convert-case', 'fanuc-upper')
  const id = await newDoc(h, fixture.input, fixture.profile)
  const ran = await runTransform(h, 'nc.convertCase', { form: true, fields: { case: 'UPPER CASE' } })
  h.check('Convert Case to upper case gives the golden: the program name o1001 is kept as it was', ran === true && h.app.text() === fixture.expected && h.app.text().split('\n')[1] === 'o1001 (bracket)', h.app.text().split('\n'))
  await h.waitFor(() => h.q('results-panel'), { timeout: 8000 })
  const panel = h.q('results-panel')?.textContent?.replace(/ /g, ' ') ?? ''
  const rows = h.qa('results-finding')
  h.check('the Results panel says how many names were left: "1 program name or number was left as written."', panel.includes(ctx.t('ncCleanup.convertCase.programNamesKept', { count: 1 })), panel.slice(0, 300))
  h.check('and one row sits on the line of the program name, in this document, with the reason', rows.some((r) => r.dataset.line === '2' && r.dataset.docId === id && (r.textContent ?? '').includes(ctx.t('ncCleanup.convertCase.programNameKept'))), rows.map((r) => `${r.dataset.line}:${r.dataset.severity}:${(r.textContent ?? '').slice(0, 60)}`))
  await undo(h)
  h.check('one Undo gives the program back', h.app.text() === fixture.input)
})

scenario('b1-colorbox', { timeout: 120 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const id = await newDoc(h, '%\nO1001 (COLOUR)\nG0 X0\n', 'fanuc-gcode')
  await revealLine(h, id, 3, 1)
  h.check('the editor is focused', h.focusEditor())
  // `#101` and `#2000` read like colours (`#RGB`, `#RRGGBB`); a variable assignment has none.
  ctx.editor.replaceAll(id, '%\nO1001 (COLOUR)\n#101=5\n#2000=1\n#3=#101+#2000\nG0 X#101\n')
  await h.waitFor(() => h.app.text().includes('#2000=1'), { timeout: 8000 })
  await h.sleep(1500)
  const raw = /** @type {any} */ (ctx.editor.editorInstance())?.getRawOptions?.() ?? {}
  h.check('the editor is created with the colour boxes off', raw.colorDecorators === false && raw.defaultColorDecorators === 'never', { colorDecorators: raw.colorDecorators, defaultColorDecorators: raw.defaultColorDecorators })
  const swatches = document.querySelectorAll('.colorpicker-color-decoration, .colorpicker-widget, [class*="colorpicker-color"]')
  h.check('no colour box is drawn beside #101=5 or #2000=1', swatches.length === 0, [...swatches].map((e) => e.className))
  h.check('the lines are in the editor as written', h.app.text().includes('#101=5\n#2000=1'), h.app.text())
})

scenario('b1-hover-line1', { timeout: 120 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const id = await newDoc(h, 'G0 X10. Y10.\nG1 X20. F100.\nG2 X30. Y30. R10.\nM30\n', 'fanuc-gcode')
  /** @type {[number, string][]} */
  const words = [[1, 'G0'], [2, 'G1'], [3, 'G2']]
  for (const [line, word] of words) {
    const text = await hoverAt(h, id, line, 2)
    const box = hoverBox()
    const inside = !!box && box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth
    h.check(`hover on ${word} (line ${line}) has its text`, text.includes(word) && !!box && box.text.length > 10, { text: text.slice(0, 80), box })
    h.check(`and is fully visible: inside the window, not cut off (line ${line})`, inside && box?.clipped === false, box)
    const x = box ? Math.round((box.left + box.right) / 2) : 0
    const y = box ? box.top + 3 : 0
    const hit = document.elementFromPoint(x, y)
    h.check(`and nothing is drawn over it: the point just inside its top edge belongs to the hover (line ${line})`, !!hit && !!hit.closest('.monaco-hover'), hit?.className)
  }
  void ctx
})
