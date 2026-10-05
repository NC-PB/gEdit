// X5, review mode (plan §6 M11 H11 `m11-compare-review`, §2.2 X5, WP11.2/WP11.3): the Raw/Review
// switch and its five toggles, the profile defaults, "exactly two changed lines" on the re-post pair
// of `tests/fixtures/compare/x5-repost/` (renumbered... no: reformatted numbers, new header comments,
// one feed and one Z change), "go to line" landing on the original lines, the bar's notes, and the
// saved options (`state.json` `ui.lastParams.compare`: the mode, and per profile only the toggles
// changed away from its defaults).
//
// The pair, by line (the fixture's README is the source):
//   original.nc  line 11  `N70 X130. F600.`           reposted.nc  line 13  `X130.000 F650.0`
//   original.nc  line 19  `N140 G81 ... Z-15.25 ...`  reposted.nc  line 22  `G81 ... Z-15.000 ...`
// Every other difference of the raw view is a spelling the machine reads alike (Fanuc keeps the
// decimal point's presence: `X-30.` and `X-30.000` are both pointed), so review mode ignores it.

import { scenario } from '../lib/index.js'
import { FANUC_DEFAULTS, OPTION_KEYS, closeCompare, context, guard, lineChanges, message, monacoRegistry, notes, openCompare, openPath, paneLine, paneText, read, ready, setInput, setMode, spans, toggles, view } from './m11-common.js'

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b)
const changed = (/** @type {{ editors: any }} */ reg) => lineChanges(reg)?.length ?? -1
/** Lines inside the changed blocks (the larger side of each): Monaco joins neighbouring lines into one block. */
const changedLines = (/** @type {{ editors: any }} */ reg) => (lineChanges(reg) ?? []).map(spans).reduce((n, c) => n + Math.max(c.o[1] ? c.o[1] - c.o[0] + 1 : 0, c.m[1] ? c.m[1] - c.m[0] + 1 : 0), 0)

scenario('m11-compare-review', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  const compare = /** @type {any} */ (ctx.compare)
  await ready(h)
  const reg = monacoRegistry(h)
  const dir = await h.fixture('compare/x5-repost')
  const orig = await openPath(h, `${dir}/original.nc`)
  const post = await openPath(h, `${dir}/reposted.nc`)
  h.check('both programs are open as Fanuc mill programs', ctx.docs.get(orig.id)?.profileId === 'fanuc-gcode' && ctx.docs.get(post.id)?.profileId === 'fanuc-gcode', [ctx.docs.get(orig.id)?.profileId, ctx.docs.get(post.id)?.profileId])
  ctx.docs.activate(post.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === post.id, { timeout: 5000 })
  const origText = ctx.editor.getText(orig.id)
  const postText = ctx.editor.getText(post.id)
  const source = { kind: 'document', docId: orig.id }
  const memo = () => /** @type {any} */ (ctx.uiState.getLastParams('compare'))

  await openCompare(h, reg, post.id, /** @type {any} */ (source))

  await guard(h, 'A. raw mode', async () => {
    h.check('a fresh install opens raw', view(h)?.dataset.mode === 'raw' && h.q('compare-mode', { mode: 'raw' })?.getAttribute('aria-pressed') === 'true' && h.q('compare-mode', { mode: 'review' })?.getAttribute('aria-pressed') === 'false', view(h)?.dataset.mode)
    h.check('no review bar in raw mode', h.qa('compare-option').length === 0 && !h.q('compare-defaults'))
    h.check('the toolbar has the copy, export and go-to-line controls', h.qa('compare-copy').map((e) => e.dataset.direction).sort().join() === 'toModified,toOriginal' && !!h.q('compare-export') && !!h.q('compare-goto'))
    h.check('the raw whitespace checkbox is there in raw mode', !!view(h)?.querySelector('input[type="checkbox"]'))
    const raw = changed(reg)
    h.check('raw mode shows every spelling as a difference: many changed blocks, not two', raw > 2, raw)
    h.check('and the panes show the two documents as they are', paneText(reg, 'original')?.replace(/\r\n/g, '\n') === origText && paneText(reg, 'modified')?.replace(/\r\n/g, '\n') === postText)
  })

  await guard(h, 'B. review mode with the profile defaults: exactly two changed lines (X5)', async () => {
    await setMode(h, 'review')
    h.check('the view says review', view(h)?.dataset.mode === 'review' && h.q('compare-mode', { mode: 'review' })?.getAttribute('aria-pressed') === 'true')
    h.check('five toggles, in the order of the plan', same(h.qa('compare-option').map((e) => e.dataset.option), OPTION_KEYS), h.qa('compare-option').map((e) => e.dataset.option))
    h.check('they are at the Fanuc defaults: all on but the case', same(toggles(h), FANUC_DEFAULTS), toggles(h))
    h.check('every one says it is at its default', h.qa('compare-option').every((e) => e.dataset.default === 'true'), h.qa('compare-option').map((e) => e.dataset.default))
    h.check('the profile-defaults control names the profile', h.q('compare-defaults')?.dataset.profileId === 'fanuc-gcode', h.q('compare-defaults')?.dataset.profileId)
    await h.waitFor(() => changed(reg) === 2, { timeout: 15000, interval: 20 })
    const changes = (lineChanges(reg) ?? []).map(spans)
    h.check('the diff editor shows exactly two changes', changes.length === 2, changes)
    h.check('each is one line against one line', changes.every((c) => c.o[1] - c.o[0] === 0 && c.m[1] - c.m[0] === 0), changes)
    const rv = /** @type {any} */ (read(compare.review))
    const o = rv.original.text.split('\n')
    const m = rv.modified.text.split('\n')
    const different = o.map((/** @type {string} */ line, /** @type {number} */ i) => [line, m[i]]).filter((/** @type {string[]} */ [a, b]) => a !== b)
    h.check('the normalized sides have the same number of lines and differ in two', o.length === m.length && different.length === 2, { o: o.length, m: m.length, different })
    h.check('the two lines are the feed and the depth: F600. against F650., Z-15.25 against Z-15. (the point is kept on Fanuc)', /F600/.test(different[0]?.[0] ?? '') && /F650/.test(different[0]?.[1] ?? '') && /Z-15\.25/.test(different[1]?.[0] ?? '') && /Z-15\.(?!\d)/.test(different[1]?.[1] ?? ''), different)
    h.check('the panes hold the normalized text', paneText(reg, 'original') === rv.original.text && paneText(reg, 'modified') === rv.modified.text)
    h.check('and the documents were not touched', ctx.editor.getText(orig.id) === origText && ctx.editor.getText(post.id) === postText && !ctx.docs.get(post.id)?.dirty)
    h.check('no machine is chosen for either file, and the bar says so', notes(h).includes('noMachine'), notes(h))
  })

  await guard(h, 'C. go to line lands on the original lines', async () => {
    const rv = /** @type {any} */ (read(compare.review))
    const landed = async (/** @type {'original' | 'modified'} */ side, /** @type {number} */ line) => {
      compare.goToLine(line, side)
      await h.idle()
      const at = paneLine(reg, side) ?? 0
      return { at, file: rv[side].lineMap[at - 1], text: (paneText(reg, side) ?? '').split('\n')[at - 1] }
    }
    const f1 = await landed('original', 11)
    h.check('original line 11 (N70 X130. F600.) lands on its review line, which maps back to 11', f1.file === 11 && /F600/.test(f1.text), f1)
    const f2 = await landed('modified', 13)
    h.check('modified line 13 (X130.000 F650.0) lands on the review line with F650', f2.file === 13 && /F650/.test(f2.text), f2)
    const f3 = await landed('original', 19)
    h.check('original line 19 (the G81) lands on the line with Z-15.25', f3.file === 19 && /Z-15\.25/.test(f3.text), f3)
    const f4 = await landed('modified', 22)
    h.check('modified line 22 lands on the line with Z-15.', f4.file === 22 && /Z-15\.(?!\d)/.test(f4.text), f4)
    // The same through the toolbar's box: Enter goes to the modified side, Shift+Enter to the original.
    const box = /** @type {HTMLInputElement} */ (h.q('compare-goto'))
    setInput(box, '11')
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    await h.idle()
    const viaBox = paneLine(reg, 'original') ?? 0
    h.check('Shift+Enter in the box goes to the original side’s line 11', rv.original.lineMap[viaBox - 1] === 11, { viaBox })
    setInput(box, '22')
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await h.idle()
    const viaBox2 = paneLine(reg, 'modified') ?? 0
    h.check('Enter goes to the modified side’s line 22', rv.modified.lineMap[viaBox2 - 1] === 22, { viaBox2 })
    h.check('going to a line changes no text', ctx.editor.getText(orig.id) === origText && ctx.editor.getText(post.id) === postText)
  })

  await guard(h, 'D. each toggle, and back to the defaults', async () => {
    const press = async (/** @type {string} */ option) => {
      h.click(h.q('compare-option', { option }))
      await h.idle()
    }
    const settled = async (/** @type {() => boolean} */ ok) => {
      await h.waitFor(ok, { timeout: 15000, interval: 20 })
      return changed(reg)
    }
    await press('ignoreComments')
    const c1 = await settled(() => changedLines(reg) === 4)
    h.check('comments no longer ignored: the two new header comments appear, besides the two changed lines (four lines in all)', changedLines(reg) === 4, { blocks: c1, lines: changedLines(reg), changes: (lineChanges(reg) ?? []).map(spans) })
    h.check('the toggle says it is off and no longer the default', h.q('compare-option', { option: 'ignoreComments' })?.getAttribute('aria-pressed') === 'false' && h.q('compare-option', { option: 'ignoreComments' })?.dataset.default === 'false')
    h.check('one block is the insertion of the two comment lines on the modified side', (lineChanges(reg) ?? []).some((c) => c.originalEndLineNumber === 0 && c.modifiedEndLineNumber - c.modifiedStartLineNumber === 1), (lineChanges(reg) ?? []).map(spans))
    await press('ignoreComments')
    await settled(() => changedLines(reg) === 2)

    await press('ignoreNumberFormat')
    await settled(() => changedLines(reg) > 6)
    h.check('number format no longer ignored: the reformatted numbers and the G00/M06 spellings show up (many lines)', changedLines(reg) > 6, { lines: changedLines(reg) })
    await press('ignoreNumberFormat')
    await settled(() => changedLines(reg) === 2)

    await press('ignoreBlockNumbers')
    await settled(() => changedLines(reg) > 6)
    h.check('block numbers no longer ignored: the original’s N words show as differences', changedLines(reg) > 6, { lines: changedLines(reg) })

    await press('ignoreCase')
    h.check('with two toggles away from the defaults the bar says which', h.qa('compare-option').filter((e) => e.dataset.default === 'false').map((e) => e.dataset.option).sort().join() === 'ignoreBlockNumbers,ignoreCase', h.qa('compare-option').map((e) => `${e.dataset.option}:${e.dataset.default}`))
    h.click(h.q('compare-defaults'))
    await h.idle()
    h.check('Profile defaults puts all five back', same(toggles(h), FANUC_DEFAULTS) && h.qa('compare-option').every((e) => e.dataset.default === 'true'), toggles(h))
    await settled(() => changedLines(reg) === 2)
    h.check('and the diff is the two lines again', changedLines(reg) === 2, { lines: changedLines(reg) })
  })

  await guard(h, 'E. the command, and the saved options', async () => {
    await ctx.commands.run('compare.toggleReview')
    await h.waitFor(() => view(h)?.dataset.mode === 'raw', { timeout: 5000 })
    h.check('compare.toggleReview switches back to raw', view(h)?.dataset.mode === 'raw' && h.qa('compare-option').length === 0)
    await setMode(h, 'review')
    h.click(h.q('compare-option', { option: 'ignoreCase' }))
    await h.idle()
    h.check('Match case is the one change from the defaults', h.q('compare-option', { option: 'ignoreCase' })?.dataset.default === 'false')
    const m1 = memo()
    h.check('the memory holds the mode and, for Fanuc, only the toggle that differs: { ignoreCase: true }', m1?.mode === 'review' && same(m1?.review?.['fanuc-gcode'], { ignoreCase: true }), m1)
    const onDisk = await h.waitFor(async () => {
      const state = /** @type {any} */ (await h.config.read('state.json'))
      const saved = state?.ui?.lastParams?.compare
      return saved?.review?.['fanuc-gcode']?.ignoreCase === true ? saved : null
    }, { timeout: 10000, interval: 250 })
    h.check('and it reaches state.json: ui.lastParams.compare', !!onDisk, onDisk)

    await closeCompare(h)
    await openCompare(h, reg, post.id, /** @type {any} */ (source))
    h.check('a new comparison opens in the mode it was left in (review) with the saved toggle', view(h)?.dataset.mode === 'review' && h.q('compare-option', { option: 'ignoreCase' })?.getAttribute('aria-pressed') === 'true', { mode: view(h)?.dataset.mode, toggles: toggles(h) })
    await setMode(h, 'raw')
    await closeCompare(h)
    await openCompare(h, reg, post.id, /** @type {any} */ (source))
    h.check('left in raw, it opens in raw again', view(h)?.dataset.mode === 'raw')
    await setMode(h, 'review')
    h.click(h.q('compare-defaults'))
    await h.idle()
    const m2 = memo()
    h.check('Profile defaults forgets the profile’s saved toggles', !m2?.review?.['fanuc-gcode'] || Object.keys(m2.review['fanuc-gcode']).length === 0, m2)
    h.check('and the toggles are the defaults', same(toggles(h), FANUC_DEFAULTS), toggles(h))
  })

  await guard(h, 'F. two dialects: the bar names it', async () => {
    await closeCompare(h)
    const k = await openPath(h, await h.fixture('nc/heidenhain/h01-3tools.h'))
    ctx.docs.activate(k.id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === k.id, { timeout: 5000 })
    await openCompare(h, reg, k.id, { kind: 'document', docId: orig.id })
    await setMode(h, 'review')
    h.check('comparing a Klartext program with a Fanuc one shows the "profiles" note', notes(h).includes('profiles'), notes(h))
    h.check('the toggles are the Klartext profile’s own (its defaults, not Fanuc’s)', h.q('compare-defaults')?.dataset.profileId === 'heidenhain-klartext', h.q('compare-defaults')?.dataset.profileId)
    await closeCompare(h)
  })

  h.check('no status error was left on screen', h.q('status-message')?.dataset.error !== '1', message(h))
})
