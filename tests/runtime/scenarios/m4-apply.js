// How a transform's edit reaches the document (plan §5 M4 H4 `m4-transforms`, gate G7's
// "one undo step", AD-12). Three claims, and all three are about not losing work:
//
//   1. **One Cmd+Z restores the program exactly.** `monaco/applyLines.ts` pushes every
//      hunk of one run in a single `pushEditOperations`, so the whole transform is one
//      entry in Monaco's undo stack. A transform that renumbered 300 blocks and left 300
//      undo steps behind would be unusable, and an undo that stopped halfway would leave
//      a program that is neither the old one nor the new one.
//   2. **A bookmark on a line the transform did not touch stays on its block.** That is
//      the reason `applyLines` computes minimal edits at all (`core/transforms/lineDiff.ts`):
//      a `replaceAll` would move every decoration to wherever its offset landed. Proven
//      across `remove-empty-lines`, which deletes the lines above the bookmarks, and
//      across `renumber`, which rewrites the line the bookmark is on.
//
//      A bookmark on a line the transform *rewrites* stays on it too, which is AD-12's
//      "minimal edits **within each line**". It is checked twice, because the two shapes
//      take different paths through `monaco/applyLines.ts`: three blocks next to each
//      other, which `sameLengthEdits` hands over as one hunk and `splitEqualCountEdits`
//      splits back into its lines, and two blocks with a comment between them, which are
//      two hunks to begin with. Before the split landed the first shape moved every
//      bookmark and the cursor inside the renumbered run.
//   3. **Saving after a transform writes the file back in its own encoding and EOL.**
//      The fixture is Windows-1252 with CRLF: a transform that went through the text as a
//      string and a save that "helpfully" wrote UTF-8 would turn `MÜLLER` into mojibake
//      on the control. The check decodes the saved bytes as Windows-1252 and compares
//      them with the editor text, so it is byte-exact rather than "looks fine".
//
// The `%` and `O` lines and the comments of the fixture are skipped by the renumber
// defaults of the profile, which is why the non-ASCII lines are still there afterwards.

import { scenario } from '../lib/index.js'
import { openFixture } from './m3-common.js'
import { context, message, newDoc, ready, revealLine, runTransform } from './m4-common.js'

/** Bytes as `h.disk.hex` gives them, decoded. @param {string} hex @param {string} encoding */
function decode(hex, encoding) {
  const bytes = Uint8Array.from(hex.split(' ').map((b) => parseInt(b, 16)))
  return new TextDecoder(encoding).decode(bytes)
}

/** A Fanuc program with two blank lines above and between the bookmarked blocks. */
const BLANKS = ['%', 'O1001 (BRACKET)', '', 'N10 G0 X0', '', 'N20 G1 X10.', 'N30 M30', '%', ''].join('\n')

scenario('m4-apply', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const item = (/** @type {string} */ name) => h.q('status-item', { item: name })?.textContent?.trim()

  // ============================================ A. one undo step, on the real undo stack
  const { path, id } = await openFixture(h, 'nc/encoding/cp1252-crlf.nc')
  const original = h.app.text()
  const originalHex = await h.disk.hex(path)
  const encodingLabel = item('encoding')
  const eolLabel = item('eol')
  h.check('the fixture opened as Windows-1252 with CRLF', encodingLabel === 'Windows-1252' && !original.includes('\r'), {
    encoding: encodingLabel,
    eol: eolLabel,
  })

  await revealLine(h, id, 1, 1)
  const versionBefore = ctx.editor.versionId(id)
  await runTransform(h, 'nc.renumber', { form: true })
  const renumbered = h.app.text()
  h.check('the renumber changed the program', renumbered !== original && /(^|\n)N10 G21/.test(renumbered), {
    status: message(h),
    head: renumbered.split('\n').slice(0, 8),
  })
  h.check('the comment lines with Windows-1252 characters were left alone', renumbered.includes('(CUSTOMER: MÜLLER AG – TOOL COST 12 €)'), renumbered.split('\n')[4])
  h.check('the document is modified now', (await h.title()) === '● cp1252-crlf.nc — gEdit', await h.title())

  h.check('the editor is focused, so Cmd+Z goes to the document', h.focusEditor())
  await h.nativeKeys([{ key: 'z', mods: ['cmd'] }])
  await h.waitFor(() => h.app.text() === original, { timeout: 8000 })
  h.check('one Cmd+Z restores the program exactly (AD-12, G7)', h.app.text() === original, {
    got: h.app.text().split('\n').slice(0, 8),
    want: original.split('\n').slice(0, 8),
  })
  h.check(
    'the undo goes back to the version the file was opened at, so the document is clean again',
    ctx.editor.versionId(id) === versionBefore && (await h.title()) === 'cp1252-crlf.nc — gEdit',
    { version: ctx.editor.versionId(id), before: versionBefore, title: await h.title() },
  )
  h.check('nothing was written while undoing', (await h.disk.hex(path)) === originalHex)

  // ======================================== B. saving keeps the encoding and the EOL
  await runTransform(h, 'nc.renumber', { form: true })
  const afterTransform = h.app.text()
  h.check('the status bar still names the file encoding and line ending', item('encoding') === encodingLabel && item('eol') === eolLabel, {
    encoding: item('encoding'),
    eol: item('eol'),
  })

  const saved = await ctx.files.save(id)
  await h.waitFor(async () => (await h.title()) === 'cp1252-crlf.nc — gEdit', { timeout: 8000 })
  const savedHex = await h.disk.hex(path)
  const savedText = decode(savedHex, 'windows-1252')
  h.check('the save answered and the title lost its dot', saved === true, { saved, title: await h.title() })
  h.check(
    'the saved bytes are the transformed program in Windows-1252 with CRLF',
    savedText === afterTransform.replace(/\n/g, '\r\n'),
    { got: savedText.slice(0, 120), want: afterTransform.replace(/\n/g, '\r\n').slice(0, 120) },
  )
  h.check('no BOM was added', !savedHex.startsWith('ef bb bf') && !savedHex.startsWith('ff fe'), savedHex.slice(0, 11))
  h.check(
    'every line break is still CRLF and no lone LF was written',
    savedHex.split(' ').every((byte, i, all) => byte !== '0a' || all[i - 1] === '0d'),
    savedHex.slice(0, 80),
  )
  const highBytes = (/** @type {string} */ hex) => hex.split(' ').filter((b) => parseInt(b, 16) > 0x7f).join(' ')
  h.check('the non-ASCII bytes came back unchanged, byte for byte', highBytes(savedHex) === highBytes(originalHex), {
    got: highBytes(savedHex),
    want: highBytes(originalHex),
  })

  // ============================================== C. a bookmark survives a transform
  const marked = await newDoc(h, BLANKS)
  ctx.bookmarks.toggle(marked, 4)
  ctx.bookmarks.toggle(marked, 7)
  await h.idle()
  h.check('two bookmarks are set, on the N10 and the M30 block', JSON.stringify(ctx.bookmarks.lines(marked)) === '[4,7]', ctx.bookmarks.lines(marked))

  await runTransform(h, 'nc.removeEmptyLines')
  const compacted = h.app.text().split('\n')
  h.check('the blank lines are gone', JSON.stringify(compacted) === JSON.stringify(['%', 'O1001 (BRACKET)', 'N10 G0 X0', 'N20 G1 X10.', 'N30 M30', '%', '']), compacted)
  const afterRemove = ctx.bookmarks.lines(marked)
  h.check(
    'the bookmarks moved with their blocks rather than with their line numbers',
    JSON.stringify(afterRemove) === '[3,5]' && compacted[afterRemove[0] - 1] === 'N10 G0 X0' && compacted[afterRemove[1] - 1] === 'N30 M30',
    { lines: afterRemove, at: afterRemove.map((line) => compacted[line - 1]) },
  )

  await runTransform(h, 'nc.renumber', { form: true, fields: { start: 100, step: 5 } })
  const renumberedLines = h.app.text().split('\n')
  const afterRenumber = ctx.bookmarks.lines(marked)
  h.check('the renumber rewrote the three blocks it was given', JSON.stringify(renumberedLines) === JSON.stringify(['%', 'O1001 (BRACKET)', 'N100 G0 X0', 'N105 G1 X10.', 'N110 M30', '%', '']), renumberedLines)
  // Both bookmarks sit on lines this run rewrote, and those three lines are next to each
  // other: `sameLengthEdits` makes them one hunk and `splitEqualCountEdits` splits it back
  // into three single-line edits, each narrowed to the block number. So the bookmarks stay
  // on their own blocks rather than being pushed to wherever a replaced range put them.
  h.check(
    'the bookmarks stay on their blocks when the rewritten lines are adjacent',
    JSON.stringify(afterRenumber) === '[3,5]' && renumberedLines[2] === 'N100 G0 X0' && renumberedLines[4] === 'N110 M30',
    { lines: afterRenumber, at: afterRenumber.map((line) => renumberedLines[line - 1]) },
  )
  h.check(
    'the glyph margin carries one codicon per bookmark',
    h.q('editor-host')?.querySelectorAll('.gedit-bookmark-glyph').length === 2,
    h.q('editor-host')?.querySelectorAll('.gedit-bookmark-glyph').length,
  )

  // -------------------------------------- the narrow edit, on the other path to it
  // A comment between the two blocks is skipped by the renumber, so the two changed lines
  // are not adjacent and `sameLengthEdits` already gives each one an edit of its own — no
  // split needed. `operationFor` narrows both to `charSpan` either way, so the cursor and
  // the bookmark come through this shape as well as the adjacent one above.
  const apart = await newDoc(h, ['%', 'O1002 (SPACED)', 'N10 G0 X0', '(BETWEEN THE BLOCKS)', 'N30 M30', '%', ''].join('\n'))
  ctx.bookmarks.toggle(apart, 5)
  await h.idle()
  await revealLine(h, apart, 5, 4)
  await runTransform(h, 'nc.renumber', { form: true, fields: { start: 100, step: 5 } })
  const apartLines = h.app.text().split('\n')
  h.check('the two blocks were renumbered and the comment was left alone', JSON.stringify(apartLines) === JSON.stringify(['%', 'O1002 (SPACED)', 'N100 G0 X0', '(BETWEEN THE BLOCKS)', 'N105 M30', '%', '']), apartLines)
  h.check(
    'a bookmark on a rewritten line stays on it when the edit narrows to the characters that changed',
    JSON.stringify(ctx.bookmarks.lines(apart)) === '[5]' && apartLines[4] === 'N105 M30',
    { lines: ctx.bookmarks.lines(apart), at: apartLines[(ctx.bookmarks.lines(apart)[0] ?? 1) - 1] },
  )
  h.check('and the cursor is still in the block it was in', h.app.cursor().line === 5, h.app.cursor())
})
