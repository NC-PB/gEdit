// G7 for M4 (plan §5 M4 "Gates: G7"): on a 100,000-line program, a transform runs in
// under a second, its edit lands in under two, and one undo takes the whole thing back.
//
// **What is measured, and what is not.** The pure functions are timed by the vitest
// suites, which each ship a 100k-line case; there is nothing this scenario could add to
// that number. What only the app can say is the cost of the *rest*: the scope, reading
// 100,000 lines out of the model, the minimal-edit diff, `pushEditOperations`, the
// re-tokenization Monaco does afterwards, the status bar and the panel. So the clock
// here runs from the moment the user's last click lands to the moment `TransformService`
// answers, and the budget it is held to is the two halves of G7 together (RUN_BUDGET_MS
// plus APPLY_BUDGET_MS) — an honest whole-run figure rather than a sum of parts that
// were never measured on the same document.
//
// The two transforms are picked for their shapes. `remove-block-numbers` *shortens* every
// line, which is the case a same-length line-by-line diff cannot take; `renumber` rewrites
// every line to the same length, which is the fast path, and it is the transform the plan
// names.
//
// **Both clocks start after the form is answered.** At M4 `remove-block-numbers` had no
// options at all; M6 (WP6.3) gave it `keepReferenced`, so it now opens the same dialog
// `renumber` does. What G7 budgets is the run and the edit, not how long a modal took to
// draw, so both sections do what the renumber section always did: wait for the dialog,
// start the clock, click OK. The two numbers stay comparable with the M4 ones.
//
// **One undo step** is the check the milestone actually rests on (AD-12): a run that
// left 100,000 undo entries behind would still be within budget and would still be
// unusable. It is checked by comparing the whole text after a single Cmd+Z — 3 MB of
// string comparison, which is why it is done once rather than inside a `waitFor`.

import { scenario } from '../lib/index.js'
import { context, message, newDoc, numberedProgram, ready } from './m4-common.js'

const LINES = 100000

/** G7: the pure transform on 100k lines, and the edit that applies it. */
const RUN_BUDGET_MS = 1000
const APPLY_BUDGET_MS = 2000
const WHOLE_RUN_BUDGET_MS = RUN_BUDGET_MS + APPLY_BUDGET_MS

/** The undo of one transform is one edit, so it may not cost more than applying it did. */
const UNDO_BUDGET_MS = APPLY_BUDGET_MS

scenario('m4-perf-transform', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  const program = numberedProgram(LINES)
  const lineCount = program.split('\n').length
  const id = await newDoc(h, program)
  await h.waitFor(() => ctx.editor.getLineCount(id) === lineCount, { timeout: 60000 })
  await h.idle({ timeout: 30000 })
  h.check(`the document holds ${lineCount} lines`, ctx.editor.getLineCount(id) === lineCount, {
    lines: ctx.editor.getLineCount(id),
    bytes: program.length,
  })
  const line = (/** @type {number} */ n) => ctx.editor.getLines(id, n, n)[0]
  const firstBlock = line(3)

  // ------------------------------------------------- renumber: the transform G7 names
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 10000 })
  const running = ctx.commands.run('nc.renumber')
  await h.waitFor(() => h.q('modal'), { timeout: 20000 })
  const startedRenumber = performance.now()
  h.click(h.q('modal-ok'))
  await running
  const renumberMs = Math.round(performance.now() - startedRenumber)
  await h.idle({ timeout: 30000 })
  h.check(
    `renumber on ${lineCount} lines answers within ${WHOLE_RUN_BUDGET_MS} ms (G7: ${RUN_BUDGET_MS} ms to run, ${APPLY_BUDGET_MS} ms to apply)`,
    renumberMs <= WHOLE_RUN_BUDGET_MS,
    { ms: renumberMs, budget: WHOLE_RUN_BUDGET_MS, status: message(h) },
  )
  h.check('it renumbered the whole program from the profile defaults and changed no line count', ctx.editor.getLineCount(id) === lineCount && firstBlock === 'N1000 G21 G17 G40 G49 G80 G90 G94' && line(3) === 'N10 G21 G17 G40 G49 G80 G90 G94', {
    lines: ctx.editor.getLineCount(id),
    third: line(3),
    last: line(lineCount - 2),
  })

  // ------------------------------------------------------------------ one undo step
  h.check('the editor is focused, so Cmd+Z goes to the document', h.focusEditor())
  const startedUndo = performance.now()
  await h.nativeKeys([{ key: 'z', mods: ['cmd'] }])
  await h.waitFor(() => line(3) === firstBlock, { timeout: 30000 })
  const undoMs = Math.round(performance.now() - startedUndo)
  h.check(`one Cmd+Z answers within ${UNDO_BUDGET_MS} ms`, undoMs <= UNDO_BUDGET_MS, { ms: undoMs, budget: UNDO_BUDGET_MS })
  h.check('and it restored all 100,000 lines, not the visible ones', h.app.text() === program, {
    lines: ctx.editor.getLineCount(id),
    expected: lineCount,
    third: line(3),
  })

  // ------------------------------- remove-block-numbers: `keepReferenced`, shorter lines
  // The program has no GOTO and no `M98 Q`, so the default (keep what is referenced) keeps
  // nothing: every one of the 100,000 numbers still goes, and the check below is the same
  // one M4 made.
  const removing = ctx.commands.run('nc.removeBlockNumbers')
  await h.waitFor(() => h.q('modal'), { timeout: 20000 })
  const startedRemove = performance.now()
  h.click(h.q('modal-ok'))
  await removing
  const removeMs = Math.round(performance.now() - startedRemove)
  await h.idle({ timeout: 30000 })
  h.check(
    `remove-block-numbers on ${lineCount} lines answers within ${WHOLE_RUN_BUDGET_MS} ms`,
    removeMs <= WHOLE_RUN_BUDGET_MS,
    { ms: removeMs, budget: WHOLE_RUN_BUDGET_MS, status: message(h) },
  )
  h.check('every block number is gone and the program is otherwise as it was', line(3) === 'G21 G17 G40 G49 G80 G90 G94' && ctx.editor.getLineCount(id) === lineCount, {
    third: line(3),
    lines: ctx.editor.getLineCount(id),
  })

  h.focusEditor()
  const startedSecondUndo = performance.now()
  await h.nativeKeys([{ key: 'z', mods: ['cmd'] }])
  await h.waitFor(() => line(3) === firstBlock, { timeout: 30000 })
  h.check('one undo takes that run back as well', h.app.text() === program, { ms: Math.round(performance.now() - startedSecondUndo), third: line(3) })
})
