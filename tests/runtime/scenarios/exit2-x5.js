// Phase 2 exit criterion X5, "Compare" (plan §2.2; `tests/fixtures/exit2/README.md`, X5).
//
// `repost-old.nc` and `repost-new.nc` (byte copies of `compare/x5-repost/`) are picked as two
// files on disk through "Compare Two Files…". In **review mode** with the `fanuc-gcode` defaults and
// no machine, exactly the two changed lines of `repost.review.json` show, and "go to line" lands on
// the original lines (11 and 19 in the old file, 13 and 22 in the new one). In **raw mode** copying a
// change left to right and right to left is one undo step in each target. **Export** gives the golden
// unified diff (`repost.review.diff`, no newline after the last line) in a new tab, the sources
// untouched. The two documents are saved at the end and are the inputs, byte for byte.

import { scenario } from '../lib/index.js'
import { FANUC_DEFAULTS, closeCompare, context, docIds, lineChanges, message, monacoRegistry, notes, paneLine, paneText, paneUndo, read, ready, setMode, spans, toggles, view } from './m11-common.js'
import { exitDir, firstDifference, gold, goldText } from './exit2-common.js'

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * @param {import('../lib/api.js').Harness} h
 */
export async function runX5(h) {
  const ctx = context(h)
  const compare = /** @type {any} */ (ctx.compare)
  await ready(h)
  const reg = monacoRegistry(h)
  const dir = await exitDir(h)
  const golden = await gold(h, dir, 'repost.review.json')
  const goldenDiff = await goldText(h, dir, 'repost.review.diff')
  const oldPath = `${dir}/repost-old.nc`
  const newPath = `${dir}/repost-new.nc`
  const oldBytes = await h.disk.hex(oldPath)
  const newBytes = await h.disk.hex(newPath)
  h.check('the two programs are the byte copies of compare/x5-repost/', (await h.disk.hex(`${await h.fixture('compare/x5-repost')}/original.nc`)) === oldBytes && (await h.disk.hex(`${await h.fixture('compare/x5-repost')}/reposted.nc`)) === newBytes)

  // ============================================================ two files on disk open and compare
  await h.dialogs.queue('open', oldPath)
  await h.dialogs.queue('open', newPath)
  void ctx.commands.run('compare.files')
  await h.waitFor(() => !!view(h)?.querySelector('.monaco-diff-editor'), { timeout: 20000 })
  await h.waitFor(() => lineChanges(reg) !== null, { timeout: 30000, interval: 20 })
  await h.idle()
  const oldId = ctx.docs.byPath(oldPath)?.id ?? ''
  const newId = ctx.docs.byPath(newPath)?.id ?? ''
  h.check('both files opened as tabs, the new one is the active document, no machine is involved', !!oldId && !!newId && ctx.docs.getActiveId() === newId && ctx.docs.get(oldId)?.profileId === golden.profile && ctx.docs.get(newId)?.profileId === golden.profile, [oldId, newId, ctx.docs.getActiveId()])
  const oldText = ctx.editor.getText(oldId)
  const newText = ctx.editor.getText(newId)
  h.check('a fresh install compares raw', view(h)?.dataset.mode === 'raw', view(h)?.dataset.mode)

  // ============================================================ review mode: exactly two changes
  await setMode(h, 'review')
  h.check('the five toggles are the fanuc-gcode defaults of the golden', same(toggles(h), FANUC_DEFAULTS) && Object.entries(golden.options).filter(([k]) => k in FANUC_DEFAULTS).every(([k, v]) => /** @type {any} */ (FANUC_DEFAULTS)[k] === v), toggles(h))
  await h.waitFor(() => lineChanges(reg)?.length === golden.changes.length, { timeout: 15000, interval: 20 })
  const changes = (lineChanges(reg) ?? []).map(spans)
  h.check(`exactly ${golden.changes.length} changed lines, one against one`, changes.length === golden.changes.length && changes.every((c) => c.o[1] === c.o[0] && c.m[1] === c.m[0]), changes)
  const rv = /** @type {any} */ (read(compare.review))
  const reviewLines = (/** @type {'original' | 'modified'} */ side) => (paneText(reg, side) ?? '').split('\n')
  for (const change of golden.changes) {
    for (const side of /** @type {const} */ (['original', 'modified'])) {
      const want = change[side]
      const at = reviewLines(side).filter((_, i) => rv[side].lineMap[i] === want.line)
      h.check(`${want.document} line ${want.line} reads as the golden's normalized text in the review pane`, same(at, want.normalized), { at, want: want.normalized })
    }
  }
  h.check('the bar says that no machine is chosen', notes(h).includes('noMachine'), notes(h))
  /** Go to line, and the file line the review line maps back to. */
  const landed = async (/** @type {'original' | 'modified'} */ side, /** @type {number} */ line) => {
    compare.goToLine(line, side)
    await h.idle()
    const at = paneLine(reg, side) ?? 0
    return rv[side].lineMap[at - 1]
  }
  for (const change of golden.changes) {
    for (const side of /** @type {const} */ (['original', 'modified'])) {
      const want = change[side].line
      h.check(`go to line ${want} in ${change[side].document} lands on line ${want}`, (await landed(side, want)) === want, null)
    }
  }
  h.check('going to a line changed no text', ctx.editor.getText(oldId) === oldText && ctx.editor.getText(newId) === newText)

  // ============================================================ export: the golden diff, in a new tab
  const before = docIds(h)
  h.click(h.q('compare-export'))
  await h.waitFor(() => docIds(h).length === before.length + 1 && !view(h), { timeout: 10000 })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === ctx.docs.getActiveId(), { timeout: 5000 })
  await h.idle()
  const exportId = docIds(h).find((id) => !before.includes(id)) ?? ''
  const exported = ctx.editor.getText(exportId)
  h.check('the new tab holds the golden unified diff, byte for byte, with no newline after the last line', exported === goldenDiff && !exported.endsWith('\n'), { diff: firstDifference(exported, goldenDiff) })
  h.check('its headers are the two document titles', exported.startsWith('--- repost-old.nc\n+++ repost-new.nc\n'), exported.slice(0, 60))
  h.check('the comparison ended and the sources are untouched', !view(h) && ctx.editor.getText(oldId) === oldText && ctx.editor.getText(newId) === newText && !ctx.docs.get(oldId)?.dirty && !ctx.docs.get(newId)?.dirty)

  // ============================================================ raw mode: copy both ways, one undo each
  ctx.docs.activate(newId)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === newId, { timeout: 5000 })
  await h.dialogs.queue('open', oldPath)
  await h.dialogs.queue('open', newPath)
  void ctx.commands.run('compare.files')
  await h.waitFor(() => !!view(h)?.querySelector('.monaco-diff-editor'), { timeout: 20000 })
  await h.waitFor(() => lineChanges(reg) !== null, { timeout: 30000, interval: 20 })
  await setMode(h, 'raw')
  await h.idle()
  h.check('raw mode shows every spelling as a difference', (lineChanges(reg)?.length ?? 0) > 2, lineChanges(reg)?.length)

  const copy = async (/** @type {'toModified' | 'toOriginal'} */ direction, /** @type {'original' | 'modified'} */ side, /** @type {number} */ line) => {
    compare.goToLine(line, side)
    await h.idle()
    h.click(h.q('compare-copy', { direction }))
    await h.idle()
  }
  // left to right: the change at the new program's feed line (13) is replaced by the original's text
  await copy('toModified', 'modified', 13)
  const afterRight = ctx.editor.getText(newId)
  h.check('left to right: the new program changed, the old did not', afterRight !== newText && ctx.editor.getText(oldId) === oldText && afterRight.includes('N70 X130. F600.'), { diff: firstDifference(afterRight, newText) })
  paneUndo(reg, 'modified', 'undo')
  await h.idle()
  h.check('left to right: ONE undo in the target gives the bytes back', ctx.editor.getText(newId) === newText, { diff: firstDifference(ctx.editor.getText(newId), newText) })
  // right to left: the same change, the new program's text goes into the old one
  await copy('toOriginal', 'modified', 13)
  const afterLeft = ctx.editor.getText(oldId)
  h.check('right to left: the old program changed, the new did not', afterLeft !== oldText && ctx.editor.getText(newId) === newText && afterLeft.includes('F650.0'), { diff: firstDifference(afterLeft, oldText) })
  paneUndo(reg, 'original', 'undo')
  await h.idle()
  h.check('right to left: ONE undo in the target gives the bytes back', ctx.editor.getText(oldId) === oldText, { diff: firstDifference(ctx.editor.getText(oldId), oldText) })
  await closeCompare(h)

  // ============================================================ the saved bytes
  for (const [id, path, hex, name] of [[oldId, oldPath, oldBytes, 'repost-old.nc'], [newId, newPath, newBytes, 'repost-new.nc']]) {
    if (ctx.docs.get(id)?.dirty === true) await ctx.files.save(id)
    await h.idle()
    h.check(`${name}: compare, review, export and the undone copies left the file as its input, byte for byte`, (await h.disk.hex(path)) === hex && !ctx.docs.get(id)?.dirty, { dirty: ctx.docs.get(id)?.dirty })
  }
  h.check('the status line has no error', h.q('status-message')?.dataset.error !== '1', message(h))
}

scenario('exit2-x5', { timeout: 300 }, async (h) => {
  await runX5(h)
})
