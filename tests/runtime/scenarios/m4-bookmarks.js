// Bookmarks (plan §5 M4 H4 `m4-bookmarks`, WP4.4, §7.11): toggle, next and previous
// with wrap, driven by the three real key presses, plus the two Monaco actions those
// keys used to belong to.
//
// F2 and Mod+F2 are Monaco's Rename Symbol and Change All Occurrences. `contrib/bookmarks.ts`
// removes both keybindings rather than overlapping them, because two commands on one key
// is a conflict the registry reports as a `console.error` — which fails this run anyway.
// So the interesting half of this scenario is negative: after F2 there is no rename box,
// and after Mod+F2 there is still exactly one cursor.
//
// The glyph margin is switched on by the first bookmark and off again by the last
// (`monaco/bookmarks.ts` `syncGlyphMargin`), because the standalone Monaco build ships
// it disabled and an empty margin is a gutter nobody asked for. Both directions are
// checked here, on the drawn elements rather than on the option.

import { scenario } from '../lib/index.js'
import { BOOKMARK_COMMANDS, bookmarkGlyphs, bookmarkLines, context, message, newDoc, ready, revealLine } from './m4-common.js'

const PROGRAM = ['%', 'O1001 (BRACKET)', 'N10 G21 G17 G40', 'N20 T1 M6', 'N30 G43 H1 Z50.', 'N40 G1 Z-2. F150.', 'N50 G0 Z50.', 'N60 M30', '%', ''].join('\n')

scenario('m4-bookmarks', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const line = () => h.app.cursor().line
  const selections = () => /** @type {any} */ (ctx.editor.editorInstance())?.getSelections()?.length ?? 0

  const id = await newDoc(h, PROGRAM)
  const registered = ctx.commands.list().map((c) => c.id)
  h.check('the four bookmark commands are registered', BOOKMARK_COMMANDS.every((cmd) => registered.includes(cmd)), BOOKMARK_COMMANDS.filter((cmd) => !registered.includes(cmd)))
  h.check('only three of them carry a key, and `bookmark.clear` carries none', ctx.commands.get('bookmark.clear')?.keys === undefined, ctx.commands.get('bookmark.clear')?.keys)
  h.check('no bookmark glyph is drawn before there is a bookmark', bookmarkGlyphs(h).length === 0, bookmarkGlyphs(h).length)

  // ------------------------------------------------------------------- nothing yet
  await revealLine(h, id, 4, 1)
  h.check('the editor is focused', h.focusEditor())
  await h.nativeKeys([{ key: 'F2' }])
  await h.idle()
  h.check('F2 in a document without bookmarks says so and does not move the cursor', message(h) === 'This document has no bookmarks.' && line() === 4, { message: message(h), line: line() })

  // --------------------------------------------------------------------- Mod+F2 sets
  await h.nativeKeys([{ key: 'F2', mods: ['cmd'] }])
  await h.waitFor(() => ctx.bookmarks.lines(id).length === 1, { timeout: 5000 })
  h.check('Mod+F2 sets a bookmark on the cursor line and says so', JSON.stringify(ctx.bookmarks.lines(id)) === '[4]' && message(h) === 'Bookmark set.', {
    lines: ctx.bookmarks.lines(id),
    message: message(h),
  })
  h.check('Mod+F2 did not select every occurrence: there is still one cursor', selections() === 1, selections())
  await h.waitFor(() => bookmarkGlyphs(h).length === 1, { timeout: 5000 })
  h.check('the glyph margin appears with the first bookmark', bookmarkGlyphs(h).length === 1 && bookmarkLines(h).length === 1, {
    glyphs: bookmarkGlyphs(h).length,
    lines: bookmarkLines(h).length,
  })

  await h.nativeKeys([{ key: 'F2', mods: ['cmd'] }])
  await h.waitFor(() => ctx.bookmarks.lines(id).length === 0, { timeout: 5000 })
  h.check('Mod+F2 on a bookmarked line removes it again', ctx.bookmarks.lines(id).length === 0 && message(h) === 'Bookmark removed.', {
    lines: ctx.bookmarks.lines(id),
    message: message(h),
  })
  await h.waitFor(() => bookmarkGlyphs(h).length === 0, { timeout: 5000 })
  h.check('and the margin goes away with the last one', bookmarkGlyphs(h).length === 0, bookmarkGlyphs(h).length)

  // ------------------------------------------------------- three bookmarks, by keyboard
  for (const at of [3, 6, 8]) {
    await revealLine(h, id, at, 1)
    h.focusEditor()
    await h.nativeKeys([{ key: 'F2', mods: ['cmd'] }])
    await h.waitFor(() => ctx.bookmarks.lines(id).includes(at), { timeout: 5000 })
  }
  h.check('three bookmarks, ascending whatever order they were set in', JSON.stringify(ctx.bookmarks.lines(id)) === '[3,6,8]', ctx.bookmarks.lines(id))

  // ------------------------------------------------------------------ next, with wrap
  await revealLine(h, id, 1, 1)
  h.focusEditor()
  /** Presses a key and waits for the cursor to land on `want`. */
  const press = async (/** @type {any} */ key, /** @type {number} */ want) => {
    await h.nativeKeys([key])
    await h.waitFor(() => line() === want, { timeout: 5000 })
    return line()
  }
  const forward = [await press({ key: 'F2' }, 3), await press({ key: 'F2' }, 6), await press({ key: 'F2' }, 8), await press({ key: 'F2' }, 3)]
  h.check('F2 walks the bookmarks in order and wraps at the end', JSON.stringify(forward) === '[3,6,8,3]', forward)

  const back = [await press({ key: 'F2', mods: ['shift'] }, 8), await press({ key: 'F2', mods: ['shift'] }, 6), await press({ key: 'F2', mods: ['shift'] }, 3)]
  h.check('Shift+F2 walks them backwards and wraps at the start', JSON.stringify(back) === '[8,6,3]', back)

  // Monaco's Rename Symbol is gone: F2 moved the cursor and opened nothing.
  const renameBox = document.querySelector('.rename-box')
  h.check('F2 opens no rename widget', renameBox === null || getComputedStyle(renameBox).display === 'none', renameBox?.outerHTML?.slice(0, 120) ?? null)

  // ------------------------------------------------------------- one set per document
  const other = await newDoc(h, 'N10 G0 X0\nN20 M30\n')
  h.check('a second document starts without bookmarks', ctx.bookmarks.lines(other).length === 0, ctx.bookmarks.lines(other))
  h.check('and the first document keeps its own', JSON.stringify(ctx.bookmarks.lines(id)) === '[3,6,8]', ctx.bookmarks.lines(id))
  await ctx.commands.run('bookmark.next')
  await h.idle()
  h.check('next in the document without bookmarks says so', message(h) === 'This document has no bookmarks.', message(h))

  // ---------------------------------------------------------------------- clear
  ctx.docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 5000 })
  await ctx.commands.run('bookmark.clear')
  await h.waitFor(() => ctx.bookmarks.lines(id).length === 0, { timeout: 5000 })
  h.check('clear removes all of them and counts what it removed', ctx.bookmarks.lines(id).length === 0 && message(h) === 'Removed 3 bookmarks.', {
    lines: ctx.bookmarks.lines(id),
    message: message(h),
  })
  await h.waitFor(() => bookmarkGlyphs(h).length === 0, { timeout: 5000 })
  h.check('nothing is drawn in the margin any more', bookmarkGlyphs(h).length === 0 && bookmarkLines(h).length === 0, {
    glyphs: bookmarkGlyphs(h).length,
    lines: bookmarkLines(h).length,
  })
  await ctx.commands.run('bookmark.clear')
  await h.idle()
  h.check('clearing again says there is nothing to clear', message(h) === 'This document has no bookmarks.', message(h))
})
