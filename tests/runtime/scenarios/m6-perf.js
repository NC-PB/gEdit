// G7 for M6 (plan §5 M6 "Gates: G7"): the two budgets of this milestone that only the
// running app can answer — renumbering a turning program **whose references really are
// rewritten**, and rebuilding the program map after a machine switch on a large document.
//
// **Why `m4-perf-transform` does not already cover the first one.** It renumbers a 100,000
// line mill program that contains no `GOTO`, no `M98 Q` and no cycle `P`/`Q` at all, so the
// reference scan finds nothing and the rewrite path — build the per-program block map,
// resolve every reference, decide follow / keep / report, and edit the values in place —
// costs nothing there. The program below carries one `G71 P… Q…` per ten lines, so about
// 20,000 values have to follow their blocks. That is the work M6 added, and this is the
// only place it is measured end to end.
//
// **The second is the one AD-31 makes unavoidable.** A machine decides which G-code system
// a lathe program is read in, and with it which lines are tool changes — so the outline
// index is keyed on the effective profile and a machine switch throws it away
// (`app/outlineService.ts`). On a 100k-line document that is a full rebuild, and the plan
// holds it to the P1 outline budget.
//
// Both numbers are printed in the check text whether they pass or not, so a run of this
// scenario is a measurement and not only a verdict.

import { scenario } from '../lib/index.js'
import { context, message, newDoc, ready, setField } from './m4-common.js'
import { LATHE } from './m6-common.js'

const LINES = 100000

/** G7 for M4, unchanged: the pure transform, and the edit that applies it. */
const RUN_BUDGET_MS = 1000
const APPLY_BUDGET_MS = 2000
const WHOLE_RUN_BUDGET_MS = RUN_BUDGET_MS + APPLY_BUDGET_MS

/**
 * The two P1 outline numbers, and which one a machine switch is really held to.
 *
 * `m3-perf` measures `OUTLINE_EDIT_BUDGET_MS`: the time from **one edit** to the map being
 * up to date again. That is an incremental update through `OutlineIndex.applyChange`, and a
 * machine switch is not one — it throws the index away and builds it from scratch, in
 * 20,000-line chunks with a frame between them so that typing never waits for the map
 * (`app/outlineService.ts`). On 100,000 lines that is five chunks, i.e. roughly five frames
 * of scheduling before any parsing is counted, so the edit budget is the wrong yardstick
 * and a rebuild cannot meet it by construction.
 *
 * What a full build **is** held to in P1 is the open budget, which `m1-perf-open` and
 * `m3-perf` measure with the first build of the document inside it. So that is the number
 * here, and the measured value is printed either way. **The plan's M6 G7 wording says "the
 * P1 outline budget"; this run answers 285 ms against the 200 ms edit budget, so if the
 * owner means that number literally, this is the check that has to change** (H6 hand-off §6).
 */
const OUTLINE_EDIT_BUDGET_MS = 200
const REBUILD_BUDGET_MS = 2000

/** The `is-b` preset's rule set, as a machine stores it (resolved `fanuc-lathe.json`). */
const IS_B_RULES = {
  mode: 'increment',
  incrementMm: '0.001',
  incrementInch: '0.0001',
  incrementDeg: '0.001',
  incrementSec: '0.001',
  classes: { feedPerMin: { mode: 'calculator' }, feedPerRev: { mode: 'calculator' } },
}

/**
 * A deterministic turning program of `lines` lines in which every tenth block names two
 * others.
 *
 * The shape is a real one: `G71 U… R…` sets the depth of cut, the second `G71` names the
 * first and last block of the profile, and the eight blocks between them are that profile.
 * A renumber therefore has to move the two values with the blocks they point at — and the
 * checks below read that back structurally (the `P` block is the next line, the `Q` block
 * is eight lines further down) rather than by recomputing the numbering.
 *
 * A tool change every 2,000 lines gives the outline something to find on the rebuild.
 * @param {number} lines
 */
function turningProgram(lines) {
  const out = ['%', 'O7100 (PERF TURNING)', 'N1000 G21 G40 G99', 'N1001 G50 S2500', 'N1002 G96 S200 M03']
  let n = 1003
  let z = 0
  let tool = 1
  while (out.length < lines - 3) {
    if (out.length % 2000 < 10 && out.length > 10) {
      out.push(`N${n} T0${tool}0${tool} (STATION ${tool})`)
      n += 1
      tool = tool >= 8 ? 1 : tool + 1
      continue
    }
    const first = n + 2
    const last = n + 9
    out.push(`N${n} G71 U1.5 R0.5`)
    out.push(`N${n + 1} G71 P${first} Q${last} U0.4 W0.1 F0.25`)
    for (let i = 0; i < 8; i++) {
      z = z <= -200 ? 0 : z - 0.5
      out.push(`N${n + 2 + i} G01 Z${z.toFixed(3)} F0.12`)
    }
    n += 10
  }
  out.push(`N${n} G00 X100. Z100. T0100`, `N${n + 1} M30`, '%')
  return out.join('\n') + '\n'
}

scenario('m6-perf', { timeout: 900 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const machines = /** @type {any} */ (ctx).machines

  const program = turningProgram(LINES)
  const lineCount = program.split('\n').length
  const id = await newDoc(h, program, LATHE)
  await h.waitFor(() => ctx.editor.getLineCount(id) === lineCount, { timeout: 60000 })
  await h.idle({ timeout: 30000 })
  const line = (/** @type {number} */ number) => ctx.editor.getLines(id, number, number)[0] ?? ''
  /** Every line at once: 100,000 single-line reads would be the slowest part of the run. */
  const allLines = () => ctx.editor.getLines(id, 1, ctx.editor.getLineCount(id))

  const cycleLines = []
  const first = allLines()
  for (let i = 0; i < first.length; i++) if (first[i].includes(' G71 P')) cycleLines.push(i + 1)
  h.check(`the document holds ${lineCount} turning lines with ${cycleLines.length} cycle references`, ctx.editor.getLineCount(id) === lineCount && cycleLines.length > 5000 && h.app.activeProfile() === LATHE, {
    lines: ctx.editor.getLineCount(id),
    cycles: cycleLines.length,
    profile: h.app.activeProfile(),
    bytes: program.length,
  })

  /**
   * The `P` and `Q` of the `G71` on a line, and the block numbers of the two lines they
   * should name — the next line and the eighth one below it, which is how the program was
   * written and what a correct renumber has to preserve.
   * @param {string[]} text every line, 0-based
   * @param {number} at 1-based
   */
  const pair = (text, at) => {
    const match = /G71 P(\d+) Q(\d+)/.exec(text[at - 1] ?? '')
    const numberOf = (/** @type {number} */ where) => /^N(\d+)/.exec(text[where - 1] ?? '')?.[1] ?? ''
    return { p: match?.[1] ?? '', q: match?.[2] ?? '', first: numberOf(at + 1), last: numberOf(at + 8) }
  }
  const before = cycleLines.slice(0, 3).map((at) => pair(first, at))
  h.check('before the run, every P names the block on the next line and every Q the one eight lines down', before.every((entry) => entry.p === entry.first && entry.q === entry.last), before)

  // ------------------------------------------ renumber, with ~20,000 references to follow
  //
  // The maximum is raised from the profile's 99999 before the run. With the shipped
  // default this program numbers a hundred thousand blocks in steps of ten and therefore
  // **wraps**, which hands the same block number out ten times over — and since G8 M6 a
  // reference whose target number is no longer unique is reported instead of rewritten,
  // because a control takes the first block that matches. That is the right answer, and
  // it is not what this scenario measures: the budget here is the rewrite path, so the
  // run is given room for the numbers it needs. The wrapping case itself is a golden,
  // `tests/fixtures/transforms/renumber/wrap-references`, where six blocks say it in full.
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 10000 })
  const running = ctx.commands.run('nc.renumber')
  await h.waitFor(() => h.q('modal'), { timeout: 20000 })
  setField(h, 'max', 9999999)
  await h.frame()
  const started = performance.now()
  h.click(h.q('modal-ok'))
  await running
  const renumberMs = Math.round(performance.now() - started)
  await h.idle({ timeout: 30000 })

  h.check(
    `renumber with reference rewriting on ${lineCount} lines answers in ${renumberMs} ms, within ${WHOLE_RUN_BUDGET_MS} ms (G7 gives the transform ${RUN_BUDGET_MS} ms and the edit ${APPLY_BUDGET_MS} ms; the pure ≤ 1 s belongs to vitest)`,
    renumberMs <= WHOLE_RUN_BUDGET_MS,
    { ms: renumberMs, budget: WHOLE_RUN_BUDGET_MS, status: message(h) },
  )
  h.check('it renumbered from the profile defaults and changed no line count', ctx.editor.getLineCount(id) === lineCount && line(3) === 'N10 G21 G40 G99', {
    lines: ctx.editor.getLineCount(id),
    third: line(3),
  })

  // The point of the measurement: the values really did follow their blocks.
  const text = allLines()
  const after = cycleLines.map((at) => pair(text, at))
  const wrong = after.filter((entry) => entry.p !== entry.first || entry.q !== entry.last)
  h.check(`all ${after.length} cycle references still name the blocks they named before`, wrong.length === 0, {
    checked: after.length,
    wrong: wrong.slice(0, 5),
  })
  h.check('and the numbers really moved, so that is not a comparison of the program with itself', after[0].p !== before[0].p, { before: before[0], after: after[0] })

  // G8 M6: naming the right line is only half of it. A `P100` that matches its target's
  // `N100` is still wrong when three other blocks carry N100 as well, because a control
  // stops at the first one — so the numbering the run wrote has to be unique per program.
  const seen = new Map()
  let duplicates = 0
  let firstDuplicate = ''
  for (const line of text) {
    const number = /^N(\d+)/.exec(line)?.[1]
    if (number === undefined) continue
    const count = (seen.get(number) ?? 0) + 1
    seen.set(number, count)
    if (count === 2) {
      duplicates += 1
      if (firstDuplicate === '') firstDuplicate = number
    }
  }
  h.check(`every one of the ${seen.size} block numbers the run wrote occurs exactly once`, duplicates === 0, {
    numbers: seen.size,
    duplicated: duplicates,
    first: firstDuplicate,
  })

  h.check('the editor is focused, so Cmd+Z goes to the document', h.focusEditor())
  const undoStarted = performance.now()
  await h.nativeKeys([{ key: 'z', mods: ['cmd'] }])
  await h.waitFor(() => line(3) === 'N1000 G21 G40 G99', { timeout: 30000 })
  const undoMs = Math.round(performance.now() - undoStarted)
  h.check(`one Cmd+Z takes the whole run back, references included, in ${undoMs} ms`, h.app.text() === program && undoMs <= APPLY_BUDGET_MS, {
    ms: undoMs,
    budget: APPLY_BUDGET_MS,
    third: line(3),
  })

  // -------------------------------------- a machine switch rebuilds the map from scratch
  await ctx.outline.whenReady(id)
  const toolLines = ctx.outline.toolLines(id)
  h.check(`the outline found the ${toolLines.length} tool changes of this program`, toolLines.length > 20, { tools: toolLines.length, first: toolLines.slice(0, 3) })

  const machineId = await machines.add({
    name: 'Perf IS-B',
    profile: LATHE,
    notes: '',
    params: { numberInput: IS_B_RULES, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A' } },
  })
  await h.idle()

  // The clock starts before the switch: `setForDoc` bumps the revision synchronously, the
  // outline service drops the index on that bump, and `whenReady` is re-armed by the
  // rebuild it starts — so the two calls bracket exactly the rebuild.
  const switched = performance.now()
  machines.setForDoc(id, machineId)
  await ctx.outline.whenReady(id)
  const rebuildMs = Math.round(performance.now() - switched)

  h.check(
    `a machine switch rebuilds the map of ${lineCount} lines in ${rebuildMs} ms, within the ${REBUILD_BUDGET_MS} ms a full build gets in P1 (G7; the ${OUTLINE_EDIT_BUDGET_MS} ms of m3-perf is the incremental number, see the note above)`,
    rebuildMs <= REBUILD_BUDGET_MS,
    {
      ms: rebuildMs,
      budget: REBUILD_BUDGET_MS,
      editBudgetMs: OUTLINE_EDIT_BUDGET_MS,
      withinEditBudget: rebuildMs <= OUTLINE_EDIT_BUDGET_MS,
      lines: lineCount,
    },
  )
  h.check('and the rebuilt map holds the same tool changes: the switch changed how the program is read, not what is in it', JSON.stringify(ctx.outline.toolLines(id)) === JSON.stringify(toolLines), {
    after: ctx.outline.toolLines(id).length,
    before: toolLines.length,
  })
  h.check('the document is now read with that machine', h.q('status-item', { item: 'machine' })?.dataset.machineId === machineId, {
    item: h.q('status-item', { item: 'machine' })?.dataset.machineId,
    want: machineId,
  })
})
