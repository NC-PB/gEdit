// X5, two files on disk (plan §6 M11 H11 `m11-compare-files`, §2.2 X5, WP11.3): "Compare Two Files…"
// asks for the original, then for the modified file, opens both as documents (the dialog grants the
// paths) and compares them: the first pick is the left side, the second the right side and the active
// tab. Cancelling either pick, or picking one file twice, ends it without opening anything. Files that are
// already open are reused, not opened again. The pair is the re-post of
// `tests/fixtures/compare/x5-repost/`, so review mode shows exactly two changed lines.

import { scenario } from '../lib/index.js'
import { closeCompare, context, docIds, guard, lineChanges, message, monacoRegistry, read, ready, ribbonTab, setMode, view } from './m11-common.js'

scenario('m11-compare-files', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  const compare = /** @type {any} */ (ctx.compare)
  await ready(h)
  const reg = monacoRegistry(h)
  const dir = await h.fixture('compare/x5-repost')
  const a = `${dir}/original.nc`
  const b = `${dir}/reposted.nc`
  const opens = () => h.dialogs.calls().filter((c) => c.kind === 'open').length
  
  await guard(h, 'A. from the Tools tab: first pick the original, then the modified file', async () => {
    await ribbonTab(h, 'tools')
    const button = h.q('cmd-button', { command: 'compare.files' })
    h.check('the Tools tab offers Compare Two Files', !!button && button.getAttribute('disabled') === null, !!button)
    const calls = opens()
    await h.dialogs.queue('open', a)
    await h.dialogs.queue('open', b)
    h.click(button)
    await h.waitFor(() => !!view(h)?.querySelector('.monaco-diff-editor'), { timeout: 20000 })
    await h.waitFor(() => lineChanges(reg) !== null, { timeout: 30000, interval: 20 })
    h.check('exactly two file dialogs were asked, one pick each', opens() - calls === 2, h.dialogs.calls().slice(calls))
    h.check('both files are open as tabs and the untouched untitled document made room for the first (two tabs in all)', docIds(h).length === 2 && !!ctx.docs.byPath(a) && !!ctx.docs.byPath(b), docIds(h))
    const left = ctx.docs.byPath(a)?.id
    const right = ctx.docs.byPath(b)?.id
    h.check('the second pick is the active document (the right side)', ctx.docs.getActiveId() === right && /** @type {any} */ (compare && view(h))?.dataset.source === 'document')
    const caption = view(h)?.querySelector('.caption')?.textContent ?? ''
    h.check('the caption names both files, the modified one first (it is the compared document)', /reposted\.nc/.test(caption) && /original\.nc/.test(caption) && caption.indexOf('reposted') < caption.indexOf('original'), caption)
    h.check('the original is on the left: the session’s other side is the first pick', JSON.stringify(/** @type {any} */ (read(compare.session))?.source) === JSON.stringify({ kind: 'document', docId: left }), left)
    h.check('opening and comparing left both files unchanged', !ctx.docs.get(/** @type {string} */ (left))?.dirty && !ctx.docs.get(/** @type {string} */ (right))?.dirty)
    await setMode(h, 'review')
    await h.waitFor(() => lineChanges(reg)?.length === 2, { timeout: 15000, interval: 20 })
    h.check('review mode with the Fanuc defaults: exactly two changes, one line each (X5)', lineChanges(reg)?.length === 2 && lineChanges(reg)?.every((c) => c.originalEndLineNumber === c.originalStartLineNumber && c.modifiedEndLineNumber === c.modifiedStartLineNumber), (lineChanges(reg) ?? []).length)
    await setMode(h, 'raw')
    await closeCompare(h)
    h.check('closing leaves both tabs open', docIds(h).length === 2)
  })

  await guard(h, 'B. a re-run reuses the open tabs', async () => {
    const calls = opens()
    await h.dialogs.queue('open', a)
    await h.dialogs.queue('open', b)
    void ctx.commands.run('compare.files')
    await h.waitFor(() => !!view(h), { timeout: 20000 })
    h.check('picking two files that are already open opens no second tab for either', docIds(h).length === 2 && opens() - calls === 2, { tabs: docIds(h).length })
    await closeCompare(h)
  })

  await guard(h, 'C. cancelling, and one file twice', async () => {
    // Close both tabs again so "nothing opened" can be told from "already open".
    for (const path of [a, b]) {
      const id = ctx.docs.byPath(path)?.id
      if (id) {
        ctx.docs.activate(id)
        await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 5000 })
        await ctx.commands.run('file.close')
        await h.waitFor(() => !ctx.docs.get(id), { timeout: 10000 })
      }
    }
    const tabs = docIds(h).length
    await h.dialogs.queue('open', null)
    await ctx.commands.run('compare.files')
    await h.idle()
    h.check('cancelling the first pick does nothing: no comparison, no tab', !view(h) && docIds(h).length === tabs, { tabs: docIds(h).length })
    await h.dialogs.queue('open', a)
    await h.dialogs.queue('open', null)
    await ctx.commands.run('compare.files')
    await h.idle()
    h.check('cancelling the second pick opens nothing either, not even the first file', !view(h) && docIds(h).length === tabs && !ctx.docs.byPath(a), { tabs: docIds(h).length })
    await h.dialogs.queue('open', a)
    await h.dialogs.queue('open', a)
    await ctx.commands.run('compare.files')
    await h.idle()
    h.check('one file twice is refused with a status error, and opens nothing', !view(h) && docIds(h).length === tabs && !ctx.docs.byPath(a) && h.q('status-message')?.dataset.error === '1', { status: message(h), tabs: docIds(h).length })
    h.dialogs.clear()
  })
})
