// The outline (plan §5 M3 H3 `m3-outline`, §7.4, WP3.5): one index per document feeds the
// program map, the quick outline, the folding ranges and sticky scroll, so all four are
// checked against the same fixture and the same golden.
//
// Which document lines are on screen is read from the **line-number gutter**
// (`.margin-view-overlays .line-numbers`) rather than from the text of the view lines.
// That is what makes the folding check exact: a folded range is simply absent from the
// gutter, so "lines 12 to 29 went away and 11 and 30 stayed" is one reading, with no
// guessing which `.view-line` belongs to which document line.
//
// Sticky scroll needs a tool segment taller than the viewport, which no fixture has (f01
// is 67 lines), so that one part runs on a generated program instead.

import { scenario } from '../lib/index.js'
import { context, mapRows, openFixture, plain, revealLine } from './m3-common.js'

/** The golden the map has to agree with, read at run time so the two cannot drift. */
const GOLDEN = 'expected/outline/fanuc/f01-mill-3tools.nc.json'

/** Rows that belong under a tool segment, and the tool rows they belong to. */
const NESTED = [28, 29, 47, 48]
const TOOLS = [11, 30, 49]

/** The tool segment that is folded: `T1 M6` on line 11 runs to line 29. */
const SEGMENT = { start: 11, end: 29, after: 30 }

/** A program whose one tool segment is taller than any viewport, for sticky scroll. */
function tallProgram() {
  const lines = ['%', 'O5000 (STICKY)', 'T1 M6', 'S3000 M3', 'G43 Z25. H1 M8']
  for (let i = 0; i < 240; i++) lines.push(`G1 X${(i * 0.5).toFixed(3)} Y${(i * 0.25).toFixed(3)} F800.`)
  lines.push('G0 Z25.', 'M30', '%')
  return lines.join('\n')
}

scenario('m3-outline', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })

  /** The document lines Monaco currently has on screen, from the gutter. */
  const gutter = () => [...(h.q('editor-host')?.querySelectorAll('.margin-view-overlays .line-numbers') ?? [])].map((e) => Number(e.textContent)).filter((n) => n > 0)
  const rows = () => mapRows(h)

  const golden = JSON.parse(await h.disk.read(await h.fixture(GOLDEN)))
  /** @type {{ line: number, kind: string }[]} */
  const expected = golden.items.map((/** @type {any} */ item) => ({ line: item.line, kind: item.kind }))

  const fanuc = await openFixture(h, 'nc/fanuc/f01-mill-3tools.nc')
  await h.waitFor(() => h.qa('program-map-item').length >= expected.length, { timeout: 10000 })

  // ------------------------------------------------------------ the tree
  h.check('the map is the panel the plan names', !!h.q('program-map'), h.qa('panel').map((e) => e.dataset.panel))
  h.check('the fixture is on the profile the golden was written for', ctx.docs.get(fanuc.id)?.profileId === golden.profile, { got: ctx.docs.get(fanuc.id)?.profileId, want: golden.profile })
  h.check(
    'the map draws exactly the outline golden, in line order',
    JSON.stringify(h.qa('program-map-item').map((e) => ({ line: Number(e.dataset.line), kind: e.dataset.kind }))) === JSON.stringify(expected),
    { drawn: rows(), golden: expected },
  )
  h.check('the kinds M3 adds are all there: program start, comment and stop beside the tools', ['program', 'comment', 'stop', 'tool'].every((kind) => !!h.q('program-map-item', { kind })), rows())

  // Two levels: what belongs to a tool segment hangs under it.
  const nestedUnderTool = (/** @type {number} */ line) => h.q('program-map-item', { line })?.closest('li')?.parentElement?.classList.contains('children') === true
  h.check('what happens inside a tool segment is a child row', NESTED.every((line) => nestedUnderTool(line)), NESTED.map((line) => `${line}:${nestedUnderTool(line)}`))
  h.check('a tool change itself is a top-level row', TOOLS.every((line) => !nestedUnderTool(line)), TOOLS.map((line) => `${line}:${nestedUnderTool(line)}`))
  h.check('so is everything before the first tool change', !nestedUnderTool(1) && !nestedUnderTool(3) && !nestedUnderTool(10), [1, 3, 10].map((line) => `${line}:${nestedUnderTool(line)}`))
  h.check('a tool row is labelled with its number and the comment next to it', h.q('program-map-item', { line: 11 })?.textContent?.includes('T1 — CONTOUR ROUGH') === true, h.q('program-map-item', { line: 11 })?.textContent?.trim())

  // ------------------------------------------------------------ the highlight follows the cursor
  await revealLine(h, fanuc.id, 15, 1)
  await h.waitFor(() => h.q('program-map-item', { line: 11 })?.dataset.active === '1', { timeout: 4000 })
  h.check('a line inside a tool segment lights that segment up', h.q('program-map-item', { line: 11 })?.dataset.active === '1' && h.qa('program-map-item', { active: '1' }).length === 1, rows())

  await revealLine(h, fanuc.id, 29, 1)
  await h.waitFor(() => h.q('program-map-item', { line: 29 })?.dataset.active === '1', { timeout: 4000 })
  h.check('a row of its own takes over when the cursor is on it', h.q('program-map-item', { line: 29 })?.dataset.active === '1' && h.q('program-map-item', { line: 11 })?.dataset.active === '0', rows())

  await revealLine(h, fanuc.id, 40, 1)
  await h.waitFor(() => h.q('program-map-item', { line: 30 })?.dataset.active === '1', { timeout: 4000 })
  h.check('and it moves on with the cursor', h.q('program-map-item', { line: 30 })?.dataset.active === '1', rows())

  // ------------------------------------------------------------ clicking a row
  h.click(h.q('program-map-item', { line: 49 }))
  await h.waitFor(() => h.app.cursor().line === 49, { timeout: 4000 })
  h.check('clicking a row reveals its line and focuses the editor', h.app.cursor().line === 49 && ctx.editor.hasFocus(), h.app.cursor())

  // ------------------------------------------------------------ an edit updates the map
  // `OutlineService.applyChange` runs on every content change, so a new tool change has to
  // turn up without the document being re-opened.
  await revealLine(h, fanuc.id, 24, 1)
  ctx.editor.insertText('T9 M6\n')
  await h.waitFor(() => !!h.q('program-map-item', { line: 24, kind: 'tool' }), { timeout: 5000 })
  h.check('a tool change typed into the program appears in the map', !!h.q('program-map-item', { line: 24, kind: 'tool' }), rows())
  h.check('and the tool changes below it moved down by a line', !!h.q('program-map-item', { line: 31, kind: 'tool' }) && !!h.q('program-map-item', { line: 50, kind: 'tool' }), rows())
  ctx.editor.triggerAction('undo')
  await h.waitFor(() => !h.q('program-map-item', { line: 24, kind: 'tool' }) && !!h.q('program-map-item', { line: 30, kind: 'tool' }), { timeout: 5000 })
  h.check('undo takes it out again', !h.q('program-map-item', { line: 24, kind: 'tool' }) && !ctx.docs.get(fanuc.id)?.dirty, { rows: rows(), dirty: ctx.docs.get(fanuc.id)?.dirty })

  // ------------------------------------------------------------ Mod+Shift+O
  await revealLine(h, fanuc.id, 1, 1)
  h.check('the editor has the focus for the shortcut', h.focusEditor())
  await h.nativeKeys([{ key: 'o', mods: ['cmd', 'shift'] }])
  const listed = await h.waitFor(() => {
    const items = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map((e) => e.textContent ?? '')
    return items.length > 0 ? items : undefined
  }, { timeout: 6000 })
  h.check('Mod+Shift+O opens the quick outline', (listed?.length ?? 0) > 0, listed)
  h.check('it lists the three tool changes', ['T1', 'T2', 'T3'].every((tool) => (listed ?? []).some((entry) => entry.includes(tool))), listed)
  h.check('and the program it belongs to', (listed ?? []).some((entry) => entry.includes('O1001')), listed)
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => document.querySelectorAll('.quick-input-list .monaco-list-row').length === 0, { timeout: 4000 })

  // ------------------------------------------------------------ folding
  // The viewport holds about 22 lines, so a 19-line segment plus its surroundings never
  // fits: what proves the fold is the *jump* in the gutter, from the line the segment
  // starts on straight to the line after it.
  await revealLine(h, fanuc.id, SEGMENT.start, 1)
  const after = (/** @type {number} */ line) => {
    const shown = [...new Set(gutter())].sort((a, b) => a - b)
    return shown[shown.indexOf(line) + 1]
  }
  h.check('before folding, the line after the tool change is the next line', after(SEGMENT.start) === SEGMENT.start + 1, [...new Set(gutter())].sort((a, b) => a - b))
  ctx.editor.triggerAction('editor.fold')
  await h.waitFor(() => after(SEGMENT.start) !== SEGMENT.start + 1, { timeout: 5000 })
  h.check(
    'folding on a tool change hides its segment: the gutter jumps to the next tool change',
    after(SEGMENT.start) === SEGMENT.after,
    { start: SEGMENT.start, next: after(SEGMENT.start), expected: SEGMENT.after, gutter: [...new Set(gutter())].sort((a, b) => a - b) },
  )
  h.check('the range ends where the outline says it does, not at the end of the file', gutter().includes(SEGMENT.after) && gutter().includes(SEGMENT.after + 1), [...new Set(gutter())].sort((a, b) => a - b))
  ctx.editor.triggerAction('editor.unfoldAll')
  await h.waitFor(() => after(SEGMENT.start) === SEGMENT.start + 1, { timeout: 5000 })
  h.check('unfolding brings the segment back', after(SEGMENT.start) === SEGMENT.start + 1, [...new Set(gutter())].sort((a, b) => a - b))

  // ------------------------------------------------------------ sticky scroll
  const stickyId = ctx.files.newUntitled({ profileId: 'fanuc-gcode', text: tallProgram() })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === stickyId, { timeout: 10000 })
  await h.waitFor(() => ctx.outline.toolLines(stickyId).length === 1, { timeout: 8000 })
  await revealLine(h, stickyId, 180, 1)
  const sticky = () => /** @type {HTMLElement | null} */ (h.q('editor-host')?.querySelector('.sticky-widget'))
  const stickyText = () => plain(sticky()?.textContent)
  await h.waitFor(() => stickyText().includes('T1'), { timeout: 6000 })
  // The widget draws the line number and the line itself, so the text reads `3T1 M6`.
  h.check('sticky scroll pins the tool line while the cursor is deep in its segment', stickyText().includes('T1 M6'), { sticky: stickyText(), cursor: h.app.cursor(), height: sticky()?.getBoundingClientRect().height })
  h.check('the tool line is genuinely off screen, so that text can only be the sticky one', !gutter().includes(3), gutter().slice(0, 4))
  h.check('sticky scroll is on because the symbol provider answers, not the indentation model', ctx.settings.get('editor.stickyScroll') === true && ctx.outline.toolLines(stickyId).length === 1, {
    setting: ctx.settings.get('editor.stickyScroll'),
    toolLines: ctx.outline.toolLines(stickyId),
  })

  await revealLine(h, stickyId, 1, 1)
  await h.waitFor(() => !stickyText().includes('T1 M6'), { timeout: 6000 })
  h.check('and it goes away at the top of the program', !stickyText().includes('T1 M6'), stickyText())

  h.check('the outline moved nothing on disk', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
