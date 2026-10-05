// X6, search (plan §6 M11 H11 `m11-search`, §2.2 X6, WP11.1): find-all with a word query and with
// a condition over three open documents, "whole address" in the editor's own find widget
// opening on the regex, replace with its count (in place: one undo step; into a new tab: the
// source untouched), and the scope "all open documents".
//
// Every expected row below is read off the three programs' text by hand (the numbers in the
// comments are line numbers), never taken from what the search answers.
//
//   doc 1                      doc 2                    doc 3
//   1 (TOOL T1 FOR FACE)       1 T01 M6                 1 N10 T1.
//   2 T1 M6                    2 S12000 M3              2 M3 S2000
//   3 S1500 M3                 3 G1 X5. F200.           3 S2001 M8
//   4 G0 X0. Y0.               4 (T1 BACK)              4 G1 X1. M8 (M8 NOTE)
//   5 T10 M6                   5 T11                    5 M88
//   6 S2500                    6 M8                     6 M30
//   7 M8                       7 M9
//   8 M30

import { scenario } from '../lib/index.js'
import { ALL_OPEN, ACTIVE_ONLY, context, docIds, fillForm, guard, message, monacoRegistry, newDoc, pick, ready, report, rowsOf, runForm } from './m11-common.js'
import { undo } from './m5-common.js'

const D1 = '(TOOL T1 FOR FACE)\nT1 M6\nS1500 M3\nG0 X0. Y0.\nT10 M6\nS2500\nM8\nM30\n'
const D2 = 'T01 M6\nS12000 M3\nG1 X5. F200.\n(T1 BACK)\nT11\nM8\nM9\n'
const D3 = 'N10 T1.\nM3 S2000\nS2001 M8\nG1 X1. M8 (M8 NOTE)\nM88\nM30\n'

/** The widget text of a doc as the document holds it, with a trailing newline of the model. */
const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b)

scenario('m11-search', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const reg = monacoRegistry(h)
  const d1 = await newDoc(h, D1)
  const d2 = await newDoc(h, D2)
  const d3 = await newDoc(h, D3)
  h.check('three documents are open, as Fanuc mill programs', docIds(h).length >= 3 && [d1, d2, d3].every((id) => ctx.docs.get(id)?.profileId === 'fanuc-gcode'), { tabs: docIds(h) })
  const find = (/** @type {Record<string, unknown>} */ values) => runForm(h, 'search.findAll', values)
  const rows = () => rowsOf(report(h))

  await guard(h, 'A. the key and the form', async () => {
    h.focusEditor()
    await h.nativeKeys([{ key: 'f', mods: ['cmd', 'shift'] }])
    const opened = await h.waitFor(() => h.q('modal'), { timeout: 8000 })
    h.check('Mod+Shift+F opens the find-all form', !!opened)
    const fields = h.qa('form-field').map((e) => e.dataset.field)
    h.check('the form has the six fields of §7.12', same(fields, ['query', 'wholeAddress', 'caseSensitive', 'regex', 'inComments', 'scope']), fields)
    h.click(h.q('modal-cancel'))
    await h.waitFor(() => !h.q('modal'), { timeout: 5000 })
    h.check('Cancel leaves no report behind', report(h) === null)
  })

  await guard(h, 'B. whole address T1 over three documents', async () => {
    await find({ query: 'T1', wholeAddress: true, scope: ALL_OPEN })
    const r = report(h)
    h.check('T1 as a whole address finds T1, T01 and T1. and no T10, T11 or comment: three rows, one per document', same(rows(), [{ docId: d1, line: 2 }, { docId: d2, line: 1 }, { docId: d3, line: 1 }]), rows())
    h.check('the report carries the document column and the count in its title', (r?.columns ?? []).some((c) => c.key === 'document') && /\b3\b/.test(r?.title ?? ''), { title: r?.title, columns: r?.columns })
    h.check('the rows hold the text of their lines', same((r?.rows ?? []).map((x) => /** @type {any} */ (x).text), ['T1 M6', 'T01 M6', 'N10 T1.']), (r?.rows ?? []).map((x) => /** @type {any} */ (x).text))
    h.check('the status bar counts them', /3/.test(message(h)), message(h))
    // the rows are links to their own document, even when two documents share a name
    await h.waitFor(() => h.qa('results-row').length === 3, { timeout: 8000 })
    const row = h.qa('results-row').find((e) => e.dataset.docId === d2)
    h.check('every row of the panel names its document and line', h.qa('results-row').map((e) => `${e.dataset.docId}:${e.dataset.line}`).join() === `${d1}:2,${d2}:1,${d3}:1`, h.qa('results-row').map((e) => `${e.dataset.docId}:${e.dataset.line}`))
    h.click(row)
    await h.waitFor(() => ctx.docs.getActiveId() === d2 && h.app.cursor().line === 1, { timeout: 8000 })
    h.check('a click on a row of another document switches to it and puts the cursor on the line', ctx.docs.getActiveId() === d2 && h.app.cursor().line === 1, { active: ctx.docs.getActiveId(), cursor: h.app.cursor() })

    // A word is what the tokenizer reads as a word, and a comment holds none: "also in comments" is a
    // text-search option. A text query for T1 finds the substring (T10, T11 too), comments left out.
    await find({ query: 'T1', wholeAddress: false, scope: ALL_OPEN })
    h.check('a text search for T1 finds the text of T1, T10, T11 and T1., and none inside a comment', same(rows(), [{ docId: d1, line: 2 }, { docId: d1, line: 5 }, { docId: d2, line: 5 }, { docId: d3, line: 1 }]), rows())
    await find({ query: 'T1', wholeAddress: false, inComments: true, scope: ALL_OPEN })
    h.check('"Also in comments" adds the two comment hits', same(rows(), [{ docId: d1, line: 1 }, { docId: d1, line: 2 }, { docId: d1, line: 5 }, { docId: d2, line: 4 }, { docId: d2, line: 5 }, { docId: d3, line: 1 }]), rows())

    await find({ query: 'T10', wholeAddress: true, scope: ALL_OPEN })
    h.check('T10 finds only T10', same(rows(), [{ docId: d1, line: 5 }]), rows())
  })

  await guard(h, 'C. a condition: S>2000', async () => {
    await find({ query: 'S>2000', wholeAddress: true, scope: ALL_OPEN })
    h.check('S>2000 gives S2500, S12000 and S2001, not S2000 and not S1500', same(rows(), [{ docId: d1, line: 6 }, { docId: d2, line: 2 }, { docId: d3, line: 3 }]), rows())
    await find({ query: 'S<=2000', wholeAddress: true, scope: ALL_OPEN })
    h.check('S<=2000 gives S1500 and S2000', same(rows(), [{ docId: d1, line: 3 }, { docId: d3, line: 2 }]), rows())
  })

  await guard(h, 'D. the scope', async () => {
    ctx.docs.activate(d1)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === d1, { timeout: 5000 })
    await find({ query: 'M8', wholeAddress: true, scope: ACTIVE_ONLY })
    h.check('the default scope is the active document: M8 of document 1 only', same(rows(), [{ docId: d1, line: 7 }]), rows())
    h.check('and the report has no document column', !(report(h)?.columns ?? []).some((c) => c.key === 'document'), report(h)?.columns)
    await find({ query: 'M8', wholeAddress: true, scope: ALL_OPEN })
    h.check('all open documents: M8 of every one (comments left out: M8 NOTE is not a hit)', same(rows(), [{ docId: d1, line: 7 }, { docId: d2, line: 6 }, { docId: d3, line: 3 }, { docId: d3, line: 4 }]), rows())
    await find({ query: 'NOT-ANYWHERE', wholeAddress: false, scope: ALL_OPEN })
    h.check('a text with no hit gives no rows and says so', rows().length === 0 && /^No hits/.test(message(h)), { rows: rows(), status: message(h) })
    await find({ query: 'T\\d+ M6', regex: true, scope: ALL_OPEN })
    h.check('a regular expression is a text search on the lines: T1 M6, T01 M6 and T10 M6', same(rows(), [{ docId: d1, line: 2 }, { docId: d1, line: 5 }, { docId: d2, line: 1 }]), rows())
  })

  await guard(h, 'E. replace M8 with M88: the count, one undo, a new tab', async () => {
    ctx.docs.activate(d3)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === d3, { timeout: 5000 })
    const before = ctx.editor.getText(d3)
    await runForm(h, 'search.replace', { query: 'M8', replacement: 'M88', wholeAddress: true })
    const after = ctx.editor.getText(d3)
    h.check('Replace All turns the two M8 of document 3 into M88, leaves M88, the comment and the other lines alone', after === 'N10 T1.\nM3 S2000\nS2001 M88\nG1 X1. M88 (M8 NOTE)\nM88\nM30\n', after)
    h.check('and the status bar reports the count: 2', /\b2\b/.test(message(h)) && !/\b[13-9]\b/.test(message(h)), message(h))
    h.check('only the active document changed', ctx.editor.getText(d1) === D1 && ctx.editor.getText(d2) === D2)
    await undo(h)
    h.check('one undo takes the whole replace back', ctx.editor.getText(d3) === before, ctx.editor.getText(d3))

    const tabs = docIds(h).length
    await runForm(h, 'search.replace', { query: 'M8', replacement: 'M88', wholeAddress: true, output: pick('In a new', 1) })
    await h.waitFor(() => docIds(h).length === tabs + 1, { timeout: 8000 })
    const fresh = ctx.docs.getActiveId() ?? ''
    h.check('"in a new tab" opens one new document with the replaced text', docIds(h).length === tabs + 1 && fresh !== d3 && ctx.editor.getText(fresh) === 'N10 T1.\nM3 S2000\nS2001 M88\nG1 X1. M88 (M8 NOTE)\nM88\nM30\n', { tabs: docIds(h).length, text: ctx.editor.getText(fresh) })
    h.check('the source is untouched and not dirty', ctx.editor.getText(d3) === before && !ctx.docs.get(d3)?.dirty, { dirty: ctx.docs.get(d3)?.dirty })
    h.check('the count is reported then too', /\b2\b/.test(message(h)), message(h))

    // Replacing where there is nothing to replace says so and changes nothing.
    ctx.docs.activate(d2)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === d2, { timeout: 5000 })
    await runForm(h, 'search.replace', { query: 'M777', replacement: 'M1', wholeAddress: true })
    h.check('a replace with no hit changes nothing', ctx.editor.getText(d2) === D2 && /nothing|0/i.test(message(h)), message(h))
  })

  await guard(h, 'F. Find Whole Address opens the editor’s find widget on the regex', async () => {
    const text = 'G1 X1.\nG01 X2.\nG1. X3\nG10 X4\nG100\nG1.5\n(G1 NOTE)\nM3\n'
    const id = await newDoc(h, text)
    h.focusEditor()
    const instance = /** @type {any} */ (ctx.editor.editorInstance())
    const state = () => instance.getContribution('editor.contrib.findController')?.getState?.()
    const run = async (/** @type {string} */ address) => {
      const running = ctx.commands.run('search.wholeAddressInFind')
      await h.waitFor(() => h.q('modal'), { timeout: 10000 })
      fillForm(h, { query: address })
      await h.frame()
      h.click(h.q('modal-ok'))
      await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
      await running
      await h.waitFor(() => state()?.isRevealed === true, { timeout: 8000 })
      await h.idle()
    }
    const looksRight = (/** @type {string} */ label) => {
      const search = String(state()?.searchString ?? '')
      let pattern = /(?!)/
      try {
        pattern = new RegExp(search, 'i')
      } catch {}
      const fires = (/** @type {string} */ s) => pattern.test(s)
      h.check(`${label}: the widget is open on a regular expression`, state()?.isRevealed === true && state()?.isRegex === true, { revealed: state()?.isRevealed, isRegex: state()?.isRegex, searchString: search })
      h.check(`${label}: the pattern matches G1, G01 and G1.`, fires('G1 X1.') && fires('G01 X2.') && fires('G1. X3'), search)
      h.check(`${label}: and not G10, G100 or G1.5`, !fires('G10 X4') && !fires('G100') && !fires('G1.5'), search)
    }
    // The cursor is on the word G1 of line 1, the way a user's often is. Monaco's own "Find with
    // Arguments" seeds an empty search from the word at the cursor and lets that win over the
    // argument (findController.js `_start`), so the first use shows whether the app got round it.
    await run('G1')
    looksRight('the first use, cursor on a word')
    await h.waitFor(() => state()?.matchesCount === 4, { timeout: 8000 })
    h.check('the first use: the widget counts G1, G01, G1. and the G1 of the comment (it has no idea of comments)', state()?.matchesCount === 4, { count: state()?.matchesCount, searchString: state()?.searchString })
    await h.nativeKeys([{ key: 'Escape' }])
    await h.waitFor(() => state()?.isRevealed === false, { timeout: 5000 })
    h.check('Esc closes the widget', state()?.isRevealed === false)
    // With a search already in the widget, the argument is not overridden.
    await run('G1')
    looksRight('the second use')
    await h.waitFor(() => state()?.matchesCount === 4, { timeout: 8000 })
    h.check('the second use: the same four matches', state()?.matchesCount === 4, { count: state()?.matchesCount })
    h.check('the document is untouched', ctx.editor.getText(id) === text && !ctx.docs.get(id)?.dirty)
    await h.nativeKeys([{ key: 'Escape' }])
    await h.waitFor(() => state()?.isRevealed === false, { timeout: 5000 })
  })

})
