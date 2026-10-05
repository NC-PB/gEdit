// X5, merge (plan §6 M11 H11 `m11-compare-merge`, §2.2 X5, WP11.3): copying a change left to right and
// right to left in raw mode, each one undo step in its target; the keys `Mod+Alt+Right` and
// `Mod+Alt+Left` through real key events; one line only; and the refusals (review mode, a file as the
// original, a locked target).
//
// The pair (original on the left, modified = the active tab on the right), by line:
//
//   original                    modified
//   1 G0 X0.                    1 G0 X0.
//   2 G1 X10. F100.             2 G1 X10. F150.             <- a changed line
//   3 G1 X20.                   3 G1 X20.
//   4 G4 P1                     (none)                      <- a line the modified side lacks
//   5 G1 X30.                   4 G1 X30.
//   6 G1 X40.                   5 G1 X40.
//   (none)                      6 G2 X45. R5.               <- a line the original lacks
//   7 M9                        7 M9
//   8 M30                       8 M30

import { scenario } from '../lib/index.js'
import { closeCompare, context, docIds, guard, lineChanges, message, diffEditor, monacoRegistry, newDoc, openCompare, openPath, paneText, paneUndo, read, ready, setMode, spans, view } from './m11-common.js'

const ORIGINAL = 'G0 X0.\nG1 X10. F100.\nG1 X20.\nG4 P1\nG1 X30.\nG1 X40.\nM9\nM30\n'
const ORIGINAL_ABCDE = 'A\nB\nC\nD\nE\n'
const MODIFIED = 'G0 X0.\nG1 X10. F150.\nG1 X20.\nG1 X30.\nG1 X40.\nG2 X45. R5.\nM9\nM30\n'

scenario('m11-compare-merge', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  const compare = /** @type {any} */ (ctx.compare)
  await ready(h)
  const reg = monacoRegistry(h)
  const orig = await newDoc(h, ORIGINAL)
  const mod = await newDoc(h, MODIFIED)
  const text = (/** @type {string} */ id) => ctx.editor.getText(id)
  const blocks = () => (lineChanges(reg) ?? []).length
  const settled = async (/** @type {number} */ n) => (await h.waitFor(() => lineChanges(reg)?.length === n, { timeout: 15000, interval: 20 })) === true
  /** Cursor into a pane, on a line, and the focus with it (the keys read the pane that has it). */
  const cursorAt = async (/** @type {'original' | 'modified'} */ side, /** @type {number} */ line) => {
    compare.goToLine(line, side)
    await h.idle()
  }
  const copyKey = async (/** @type {'Right' | 'Left'} */ arrow) => {
    await h.nativeKeys([{ key: arrow === 'Right' ? 'ArrowRight' : 'ArrowLeft', mods: ['cmd', 'alt'] }])
    await h.idle()
  }
  /** The "Ignore whitespace" checkbox of the toolbar. */
  const setIgnore = async (/** @type {boolean} */ on) => {
    const box = /** @type {HTMLInputElement | null} */ (view(h)?.querySelector('input[type="checkbox"]') ?? null)
    if (box && box.checked !== on) h.click(box)
    await h.idle()
  }
  const undoPane = async (/** @type {'original' | 'modified'} */ side) => {
    paneUndo(reg, side, 'undo')
    await h.idle()
  }
  const redoPane = async (/** @type {'original' | 'modified'} */ side) => {
    paneUndo(reg, side, 'redo')
    await h.idle()
  }

  await openCompare(h, reg, mod, { kind: 'document', docId: orig })
  await guard(h, 'A. the starting point', async () => {
    h.check('raw mode, three changes: the changed line, the missing line, the extra line', view(h)?.dataset.mode === 'raw' && blocks() === 3, { mode: view(h)?.dataset.mode, changes: (lineChanges(reg) ?? []).map(spans) })
    h.check('both copy controls are enabled: the original is an open document', h.qa('compare-copy').every((e) => e.dataset.disabled === 'false' || e.dataset.disabled === undefined || e.getAttribute('data-disabled') !== 'true'), h.qa('compare-copy').map((e) => `${e.dataset.direction}:${e.getAttribute('data-disabled')}`))
    h.check('the two documents are as written', text(orig) === ORIGINAL && text(mod) === MODIFIED)
  })

  await guard(h, 'B. a changed line, left to right (Mod+Alt+Right)', async () => {
    await cursorAt('modified', 2)
    await copyKey('Right')
    const want = MODIFIED.replace('F150', 'F100')
    await h.waitFor(() => text(mod) === want, { timeout: 8000 })
    h.check('the original’s line 2 is now in the modified document: F100', text(mod) === want, text(mod))
    h.check('the modified document is dirty and the original is not', !!ctx.docs.get(mod)?.dirty && !ctx.docs.get(orig)?.dirty)
    h.check('the original was not touched', text(orig) === ORIGINAL)
    await settled(2)
    h.check('the diff updates: two changes left', blocks() === 2, (lineChanges(reg) ?? []).map(spans))
    await undoPane('modified')
    h.check('ONE undo takes the copy back, byte for byte', text(mod) === MODIFIED, text(mod))
    await settled(3)
    await redoPane('modified')
    h.check('and one redo does it again', text(mod) === want, text(mod))
    await settled(2)
  })

  await guard(h, 'C. a line the modified side lacks, left to right', async () => {
    const before = text(mod)
    // The change has no lines on the modified side; its place is on the original's line 4.
    await cursorAt('original', 4)
    await copyKey('Right')
    const want = 'G0 X0.\nG1 X10. F100.\nG1 X20.\nG4 P1\nG1 X30.\nG1 X40.\nG2 X45. R5.\nM9\nM30\n'
    await h.waitFor(() => text(mod) === want, { timeout: 8000 })
    h.check('G4 P1 is inserted into the modified document at its place, between X20 and X30', text(mod) === want, text(mod))
    await settled(1)
    await undoPane('modified')
    h.check('one undo takes the insertion back', text(mod) === before, text(mod))
    await settled(2)
    await redoPane('modified')
    await settled(1)
  })

  await guard(h, 'D. a line the original lacks, right to left (Mod+Alt+Left)', async () => {
    const before = text(orig)
    await cursorAt('modified', 7)
    await copyKey('Left')
    const want = 'G0 X0.\nG1 X10. F100.\nG1 X20.\nG4 P1\nG1 X30.\nG1 X40.\nG2 X45. R5.\nM9\nM30\n'
    await h.waitFor(() => text(orig) === want, { timeout: 8000 })
    h.check('G2 X45. R5. is inserted into the original document', text(orig) === want, text(orig))
    h.check('the original is dirty now, and it is the one that changed', !!ctx.docs.get(orig)?.dirty)
    await settled(0)
    h.check('the two sides are now the same: no change is left', blocks() === 0 && paneText(reg, 'original') === paneText(reg, 'modified'), { blocks: blocks() })
    await undoPane('original')
    h.check('ONE undo in the original takes the copy back', text(orig) === before, text(orig))
    await settled(1)
  })

  await guard(h, 'E. toOriginal on a changed line; one line of a block', async () => {
    // After D's undo: the original lacks the G2 line, and everything else agrees except F100 (both).
    // Make a two-line block in both documents by hand to check the one-line copy.
    await closeCompare(h)
    const a = await newDoc(h, 'A\nB1\nB2\nC\n')
    const b = await newDoc(h, 'A\nX1\nX2\nC\n')
    await openCompare(h, reg, b, { kind: 'document', docId: a })
    h.check('a two-line block is one change', blocks() === 1, (lineChanges(reg) ?? []).map(spans))
    await cursorAt('modified', 2)
    await ctx.commands.run('compare.copyToModified', { lineOnly: true })
    await h.waitFor(() => text(b) !== 'A\nX1\nX2\nC\n', { timeout: 8000 })
    h.check('"one line" copies the cursor’s line only: B1 replaces X1, X2 stays', text(b) === 'A\nB1\nX2\nC\n', text(b))
    await undoPane('modified')
    h.check('and that is one undo step as well', text(b) === 'A\nX1\nX2\nC\n', text(b))
    await settled(1)
    await cursorAt('modified', 2)
    await ctx.commands.run('compare.copyToOriginal')
    await h.waitFor(() => text(a) !== 'A\nB1\nB2\nC\n', { timeout: 8000 })
    h.check('the whole block goes with the command: the original is now like the modified side', text(a) === 'A\nX1\nX2\nC\n', text(a))
    await undoPane('original')
    h.check('undone in one step', text(a) === 'A\nB1\nB2\nC\n', text(a))
    await closeCompare(h)
    h.check('closing the comparison leaves both documents open', docIds(h).includes(a) && docIds(h).includes(b))
  })

  await guard(h, 'F. refused: review mode, a file as the original', async () => {
    await openCompare(h, reg, mod, { kind: 'document', docId: orig })
    const before = [text(orig), text(mod)]
    await setMode(h, 'review')
    h.check('in review mode both copy controls are marked disabled', h.qa('compare-copy').length === 2 && h.qa('compare-copy').every((e) => e.getAttribute('data-disabled') === 'true'), h.qa('compare-copy').map((e) => `${e.dataset.direction}:${e.getAttribute('data-disabled')}`))
    await cursorAt('modified', 2)
    const answer = await ctx.commands.run('compare.copyToModified')
    await h.idle()
    h.check('and the copy is refused with a status error', h.q('status-message')?.dataset.error === '1', { answer, status: message(h) })
    h.check('nothing changes', text(orig) === before[0] && text(mod) === before[1])
    await setMode(h, 'raw')
    await closeCompare(h)

    // A file as the original: only the copy into the modified side is possible.
    const file = await h.fixture('nc/fanuc/f02-packed.nc')
    await h.dialogs.queue('open', file)
    await ctx.commands.run('compare.withFile')
    await h.waitFor(() => !!view(h)?.querySelector('.monaco-diff-editor'), { timeout: 15000 })
    await h.waitFor(() => lineChanges(reg) !== null, { timeout: 20000 })
    h.check('the comparison opened in raw mode, the mode it was left in', view(h)?.dataset.mode === 'raw', view(h)?.dataset.mode)
    h.check('with a file as the original the copy to the original is disabled and the other one is not', h.q('compare-copy', { direction: 'toOriginal' })?.getAttribute('data-disabled') === 'true' && h.q('compare-copy', { direction: 'toModified' })?.getAttribute('data-disabled') !== 'true', h.qa('compare-copy').map((e) => `${e.dataset.direction}:${e.getAttribute('data-disabled')}`))
    const docBefore = text(/** @type {any} */ (read(compare.session)).docId)
    const key = await ctx.commands.run('compare.copyToOriginal')
    await h.idle()
    h.check('Mod+Alt+Left is refused with a status error', h.q('status-message')?.dataset.error === '1', { key, status: message(h) })
    h.check('and nothing was written: the file on disk is as it was', !ctx.docs.byPath(file) && text(mod) === docBefore)
    await closeCompare(h)
  })

  await guard(h, 'H. CODE-1: two quick copies insert once, the second is refused while the diff updates', async () => {
    const a = await newDoc(h, 'A\nB\nC\nD\nE\n')
    const b = await newDoc(h, 'A\nC\nE\n')
    await openCompare(h, reg, b, { kind: 'document', docId: a })
    h.check('two insertion blocks (B and D)', blocks() === 2, (lineChanges(reg) ?? []).map(spans))
    await cursorAt('original', 2)
    // Two real key presses back to back: the second one arrives before Monaco has recomputed.
    await h.nativeKeys([{ key: 'ArrowRight', mods: ['cmd', 'alt'] }, { key: 'ArrowRight', mods: ['cmd', 'alt'] }])
    await h.idle()
    await h.waitFor(() => text(b) !== 'A\nC\nE\n', { timeout: 8000 })
    h.check('exactly one copy: B is inserted once', text(b) === 'A\nB\nC\nE\n', text(b))
    h.check('the second press was refused with the "still updating" status', h.q('status-message')?.dataset.error === '1' && /still updating/i.test(message(h)), { status: message(h), error: h.q('status-message')?.dataset.error })
    await settled(1)
    await cursorAt('original', 4)
    await copyKey('Right')
    await h.waitFor(() => text(b) === ORIGINAL_ABCDE, { timeout: 8000 })
    h.check('after the diff updated, copying works again: D is inserted', text(b) === ORIGINAL_ABCDE, text(b))
    await settled(0)
    await closeCompare(h)

    // An edit that changes the text but not what Monaco reports under "Ignore whitespace": the
    // diff is recomputed to the same blocks, and the update event must still arrive, or the
    // keys stay refused for good.
    const c = await newDoc(h, 'A\nB\nC\n')
    const d = await newDoc(h, 'A\nX\nC\n')
    await openCompare(h, reg, d, { kind: 'document', docId: c })
    await setIgnore(true)
    await h.waitFor(() => lineChanges(reg)?.length === 1, { timeout: 15000, interval: 20 })
    const before = (lineChanges(reg) ?? []).map(spans)
    const pane = /** @type {any} */ (diffEditor(reg)).getModel().modified
    pane.pushEditOperations(null, [{ range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 }, text: '  ' }], () => null)
    h.check('trailing blanks were added to line 1 of the modified document', text(d) === 'A  \nX\nC\n', text(d))
    await h.idle()
    await cursorAt('original', 2)
    let ok = false
    for (let i = 0; i < 60 && !ok; i++) {
      await cursorAt('modified', 2)
      await ctx.commands.run('compare.copyToModified')
      ok = text(d) === 'A  \nB\nC\n'
      if (!ok) await h.sleep(100)
    }
    h.check('under Ignore whitespace the blocks were the same as before the edit, and the next copy works (not stuck on "still updating")', ok, { before, after: (lineChanges(reg) ?? []).map(spans), text: text(d), status: message(h) })
    await setIgnore(false)
    await closeCompare(h)
  })

  await guard(h, 'G. keys with no comparison', async () => {
    h.focusEditor()
    const before = text(mod)
    await h.nativeKeys([{ key: 'ArrowRight', mods: ['cmd', 'alt'] }])
    await h.idle()
    h.check('Mod+Alt+Right with no comparison opens none and writes nothing', !view(h) && text(mod) === before && !h.q('compare-view'), { status: message(h) })
  })
})
