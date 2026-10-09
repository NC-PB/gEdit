// Phase 2 exit criterion X6, "Search" (plan §2.2; `tests/fixtures/exit2/README.md`, X6).
//
// `search-a.nc`, `search-b.nc` and `search-c.nc` are open. Find-all `T1` (whole address, scope "all
// open documents") gives the golden rows (no `T10`, `T12` or comment hit; `T01` counts); `S>2000`
// gives the golden rows; `M8` the four hits. Replace-all `M8` to `M88` in the active `search-a.nc`
// reports the golden count and is one undo step, and "into a new tab" leaves the source untouched.
// `search-a.nc` is saved with the replacement at the end and equals `search-a.replaced.nc`.

import { scenario } from '../lib/index.js'
import { ALL_OPEN, context, docIds, message, pick, ready, report, runForm } from './m11-common.js'
import { activate, exitDir, firstDifference, gold, goldText, openIn, undo } from './exit2-common.js'

/** The rows of the report on show as `{ document, line, text }`. @param {import('../lib/api.js').Harness} h */
const rowsShown = (h) => ((/** @type {any} */ (report(h)))?.rows ?? []).map((/** @type {any} */ r) => ({ document: r.document, line: Number(r.line), text: r.text }))

/**
 * @param {import('../lib/api.js').Harness} h
 */
export async function runX6(h) {
  const ctx = context(h)
  await ready(h)
  const dir = await exitDir(h)
  /** @type {Record<string, { id: string, path: string }>} */
  const files = {}
  for (const name of ['search-a.nc', 'search-b.nc', 'search-c.nc']) files[name] = await openIn(h, dir, name)
  const a = files['search-a.nc']
  await activate(h, a.id)
  h.check('the three programs are open as Fanuc mill programs', Object.values(files).every((f) => ctx.docs.get(f.id)?.profileId === 'fanuc-gcode'), null)
  const inputA = ctx.editor.getText(a.id)

  // ============================================================ find all
  /** The rows the T1 report showed, kept because the loop goes on to the next query. @type {any[]} */
  let shownT1 = []
  for (const name of ['search-T1.json', 'search-S-gt-2000.json', 'search-M8.json']) {
    const g = await gold(h, dir, name)
    await runForm(h, 'search.findAll', { query: g.query, wholeAddress: g.flags.wholeAddress, caseSensitive: g.flags.caseSensitive, regex: g.flags.regex, inComments: g.flags.inComments, scope: ALL_OPEN })
    const r = /** @type {any} */ (report(h))
    h.check(`${g.query}: the rows are the golden's`, JSON.stringify(rowsShown(h)) === JSON.stringify(g.rows), { got: rowsShown(h), want: g.rows })
    h.check(`${g.query}: and so is the title`, r?.title === g.title, { got: r?.title, want: g.title })
    if (name === 'search-T1.json') shownT1 = rowsShown(h)
  }
  const t1 = await gold(h, dir, 'search-T1.json')
  const rep = await gold(h, dir, 'replace-M8-M88.json')
  const m8 = await gold(h, dir, 'search-M8.json')
  h.check(`M8 is in ${rep.m8InAllDocuments} places over the three documents, of which search-a.nc holds ${rep.count}`, m8.rows.length === rep.m8InAllDocuments && m8.rows.filter((/** @type {any} */ r) => r.document === rep.document).length === rep.count, m8.rows)
  h.check('T1 as a whole address finds neither T10 nor T12 and no comment: its report has exactly the two rows (T1 in a, T01 in c), and none of them is a T1x word or a comment', shownT1.length === 2 && shownT1.every((/** @type {any} */ r) => !/T1[0-9]/.test(r.text) && !r.text.startsWith('(')), shownT1)

  // ============================================================ replace all, into a new tab first
  await activate(h, a.id)
  const tabs = docIds(h).length
  await runForm(h, 'search.replace', { ...rep.options, output: pick('In a new', 1) })
  await h.waitFor(() => docIds(h).length === tabs + 1, { timeout: 8000 })
  const fresh = ctx.docs.getActiveId() ?? ''
  const replacedText = await goldText(h, dir, 'search-a.replaced.nc')
  h.check('"into a new tab" opens one new document holding the replaced text', fresh !== a.id && ctx.editor.getText(fresh) === replacedText, { diff: firstDifference(ctx.editor.getText(fresh), replacedText) })
  h.check('and leaves search-a.nc untouched, not dirty', ctx.editor.getText(a.id) === inputA && ctx.docs.get(a.id)?.dirty !== true, ctx.docs.get(a.id)?.dirty)
  h.check('the count is reported then too', message(h).includes(String(rep.count)), message(h))
  await activate(h, a.id)

  // ============================================================ replace all in place
  await runForm(h, 'search.replace', { ...rep.options, output: pick('In place', 0) })
  h.check('Replace All gives the golden document', ctx.editor.getText(a.id) === replacedText, { diff: firstDifference(ctx.editor.getText(a.id), replacedText) })
  h.check(`and reports the golden count: "${rep.message}"`, message(h).endsWith(rep.message) || message(h) === rep.message, message(h))
  h.check('only search-a.nc changed', ctx.editor.getText(files['search-b.nc'].id) === (await h.disk.read(files['search-b.nc'].path)) && ctx.editor.getText(files['search-c.nc'].id) === (await h.disk.read(files['search-c.nc'].path)))
  await undo(h)
  h.check('one undo takes the whole replace back', ctx.editor.getText(a.id) === inputA, { diff: firstDifference(ctx.editor.getText(a.id), inputA) })
  await runForm(h, 'search.replace', { ...rep.options, output: pick('In place', 0) })
  h.check('the replace is applied again before the save', ctx.editor.getText(a.id) === replacedText)

  // ============================================================ the saved bytes
  if ((await ctx.files.save(a.id)) !== true) throw new Error('saving search-a.nc failed')
  await h.idle()
  const saved = await h.disk.read(a.path)
  h.check('the saved search-a.nc is search-a.replaced.nc, byte for byte', saved === replacedText, { diff: firstDifference(saved, replacedText) })
}

scenario('exit2-x6', { timeout: 240 }, async (h) => {
  await runX6(h)
})
