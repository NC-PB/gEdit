// G7 for M11 (plan §6 M11 H11 `m11-perf`): find-all on 300,000 lines, review-mode normalization on
// 100,000 lines, and a merge in under 100 ms. Every wall-clock budget goes through `h.checkTime`
// (budget x10 on a hosted runner, README "On a hosted runner").
//
// The budgets and what they cover:
//   - find-all: from OK in the form to the report in the store, 300,000 lines, hits capped at
//     `SEARCH_MAX_HITS` and the rest counted (so the search runs twice over the lines, once to
//     list and once to count). `FIND_BUDGET_MS`.
//   - review normalization: from `compare.open` in review mode to the normalized sides being
//     there, two documents of 100,000 lines each. `REVIEW_BUDGET_MS`. The scenario also holds the
//     result to what it must be: the sides' lines equal one another except the 100 feed words
//     the second program changes, block numbers and all.
//   - merge: one `copyChange` between two 100,000-line documents, in raw mode, from the call to its
//     return (the copy is one edit in the target; the diff that follows is Monaco's and not counted
//     here, but it is waited for). The plan's figure: 100 ms. One undo then takes it back.
//
// Correctness at size comes first: a budget met by a search that stopped reading is no budget, so the
// find-all totals are compared with the totals worked out from the program text here.

import { scenario } from '../lib/index.js'
import { largeProgram } from './m3-common.js'
import { closeCompare, context, guard, lineChanges, message, monacoRegistry, openCompare, openPath, paneUndo, read, ready, report, runForm, spans, view } from './m11-common.js'
import { ACTIVE_ONLY } from './m11-common.js'

const FIND_BUDGET_MS = 4000
const REVIEW_BUDGET_MS = 5000
const MERGE_BUDGET_MS = 100
const SEARCH_MAX_HITS = 10000

const LINES_FIND = 300000
const LINES_COMPARE = 100000

const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b)
const joined = (/** @type {string[]} */ lines) => lines.join('\r\n') + '\r\n'

scenario('m11-perf', { timeout: 1200 }, async (h) => {
  const ctx = context(h)
  const compare = /** @type {any} */ (ctx.compare)
  await ready(h)
  const reg = monacoRegistry(h)

  // =============================================================== A. find-all on 300,000 lines
  await guard(h, 'A. find-all on 300,000 lines', async () => {
    const text = largeProgram({ lines: LINES_FIND })
    const lines = text.split('\r\n')
    const path = `${h.cfg.run}/m11-perf-300k.nc`
    await h.disk.write(path, text)
    const doc = await openPath(h, path)
    await h.waitFor(() => ctx.editor.getLineCount(doc.id) === lines.length, { timeout: 120000, interval: 50 })
    await h.idle({ timeout: 60000 })
    h.check(`the program has ${lines.length - 1} lines and is open as a Fanuc mill program`, lines.length - 1 >= LINES_FIND && ctx.docs.get(doc.id)?.profileId === 'fanuc-gcode', { lines: lines.length })

    // 1. a whole address with a lot of hits: capped, the rest counted.
    const g1 = lines.filter((line) => /^G1 /.test(line)).length
    let started = performance.now()
    await runForm(h, 'search.findAll', { query: 'G1', wholeAddress: true, scope: ACTIVE_ONLY })
    const ms1 = Math.round(performance.now() - started)
    const r1 = report(h)
    const shown = r1?.rows.length ?? 0
    const dropped = Number(r1?.dropped ?? 0)
    h.checkTime(`find-all G1 on ${lines.length - 1} lines (${g1} hits) reaches the Results panel`, ms1, FIND_BUDGET_MS, { status: message(h) })
    h.check(`the report lists ${SEARCH_MAX_HITS} rows and counts the rest: ${g1} in all`, shown === SEARCH_MAX_HITS && shown + dropped === g1, { shown, dropped, want: g1 })
    h.check('the first and the last listed rows are the first G1 lines of the program', Number(/** @type {any} */ (r1?.rows[0]).line) === lines.findIndex((l) => /^G1 /.test(l)) + 1, /** @type {any} */ (r1?.rows[0]))
    h.log(`find-all G1: ${ms1} ms, ${shown} shown, ${dropped} dropped`)

    // 2. a condition: few hits, and it must find every one of them.
    const wantZ = lines.map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => /Z(-\d+\.\d+)/.test(line) && Number(/Z(-?\d+\.\d+)/.exec(line)?.[1]) < -2.9).map(({ n }) => n)
    started = performance.now()
    await runForm(h, 'search.findAll', { query: 'Z<-2.9', wholeAddress: true, scope: ACTIVE_ONLY })
    const ms2 = Math.round(performance.now() - started)
    const r2 = report(h)
    const got = (r2?.rows ?? []).map((row) => Number(/** @type {any} */ (row).line))
    h.checkTime(`find-all Z<-2.9 on ${lines.length - 1} lines (${wantZ.length} hits) reaches the Results panel`, ms2, FIND_BUDGET_MS, { status: message(h) })
    h.check(`and finds exactly the ${wantZ.length} lines whose Z is below -2.9, from the program text`, wantZ.length > 0 && same(got.slice(0, SEARCH_MAX_HITS), wantZ.slice(0, SEARCH_MAX_HITS)) && got.length + Number(r2?.dropped ?? 0) === wantZ.length, { got: got.length, want: wantZ.length, dropped: r2?.dropped })
    h.log(`find-all Z<-2.9: ${ms2} ms, ${wantZ.length} hits`)

    // 3. a text search with a regular expression on the same program.
    started = performance.now()
    // the form remembers the last answers: whole address was ticked, and it would win over a regex
    await runForm(h, 'search.findAll', { query: 'F800\\.$', wholeAddress: false, regex: true, scope: ACTIVE_ONLY })
    const ms3 = Math.round(performance.now() - started)
    const r3 = report(h)
    const f800 = lines.filter((line) => /F800\.$/.test(line)).length
    h.checkTime(`a regular expression over ${lines.length - 1} lines reaches the Results panel`, ms3, FIND_BUDGET_MS, { status: message(h) })
    h.check(`and the total is right: ${f800}`, (r3?.rows.length ?? 0) + Number(r3?.dropped ?? 0) === f800, { rows: r3?.rows.length, dropped: r3?.dropped, want: f800 })
    h.log(`find-all regex: ${ms3} ms`)
    h.check('the document was not touched by any of them', !ctx.docs.get(doc.id)?.dirty)
    ctx.docs.activate(doc.id)
    await ctx.commands.run('file.close')
    await h.waitFor(() => !ctx.docs.get(doc.id), { timeout: 20000 })
  })

  // =============================================================== B. review normalization on 100,000 lines
  const base = largeProgram({ lines: LINES_COMPARE }).split('\r\n')
  base.pop() // the empty element of the final CRLF
  const feedLines = base.map((line, i) => (/F800\.$/.test(line) && i % 1000 === 500 ? i : -1)).filter((i) => i >= 0)
  /** The same program with a block number on every line and a changed feed on `feedLines`. */
  // (Not the `%` lines and the program number: a block number in front of `O9001 (TITLE)` is not a
  // thing a post writes, and the title comment is only kept where it starts the line.)
  const renumbered = base.map((line, i) => {
    const changed = feedLines.includes(i) ? line.replace(/F800\.$/, 'F900.') : line
    return /^[%O]/.test(line) ? changed : `N${i + 1} ${changed}`
  })
  /** The same program with only the feed changed (the raw diff has no more than the 100 changes). */
  const tweaked = base.map((line, i) => (feedLines.includes(i) ? line.replace(/F800\.$/, 'F900.') : line))
  h.check('the generated programs differ in about a hundred feed words', feedLines.length >= 90 && feedLines.length <= 110, feedLines.length)
  let a = ''
  let b = ''

  await guard(h, 'B. review normalization on 100,000 lines', async () => {
    const pa = `${h.cfg.run}/m11-perf-a.nc`
    const pb = `${h.cfg.run}/m11-perf-b.nc`
    await h.disk.write(pa, joined(base))
    await h.disk.write(pb, joined(renumbered))
    a = (await openPath(h, pa)).id
    b = (await openPath(h, pb)).id
    await h.waitFor(() => ctx.editor.getLineCount(a) === base.length + 1 && ctx.editor.getLineCount(b) === base.length + 1, { timeout: 120000, interval: 50 })
    await h.idle({ timeout: 60000 })
    ctx.docs.activate(b)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === b, { timeout: 10000 })
    compare.setMode('review')
    const started = performance.now()
    const opening = compare.open(b, { kind: 'document', docId: a })
    await h.waitFor(() => read(compare.review) !== null, { timeout: 120000, interval: 5 })
    const ms = Math.round(performance.now() - started)
    await opening
    h.checkTime(`review-mode normalization of two ${base.length}-line documents (block numbers on every line of one)`, ms, REVIEW_BUDGET_MS, { mode: view(h)?.dataset.mode })
    const rv = /** @type {any} */ (read(compare.review))
    const oa = rv.original.text.split('\n')
    const ob = rv.modified.text.split('\n')
    /** @type {{ line: number, a: string, b: string }[]} */
    const odd = []
    for (let i = 0; i < Math.max(oa.length, ob.length); i++) if (oa[i] !== ob[i] && !feedLines.includes(Number(rv.modified.lineMap[i]) - 1)) odd.push({ line: i + 1, a: oa[i], b: ob[i] })
    let different = 0
    for (let i = 0; i < Math.max(oa.length, ob.length); i++) if (oa[i] !== ob[i]) different += 1
    h.check('every differing line is one of the feed lines: no other line of the two programs differs once block numbers are ignored', odd.length === 0, odd.slice(0, 5))
    h.check(`the normalized sides have ${base.length} lines each and differ in exactly the ${feedLines.length} feed lines`, oa.length === ob.length && oa.length >= base.length && different === feedLines.length, { a: oa.length, b: ob.length, different })
    h.check('the block numbers are gone and no line of the modified side starts with N', !ob.some((/** @type {string} */ l, /** @type {number} */ i) => i < 2000 && /^N\d/.test(l)))
    h.check('the line map points back to the files’ own lines', rv.modified.lineMap[10] >= 1 && rv.modified.lineMap[rv.modified.lineMap.length - 1] <= base.length + 1)
    await h.waitFor(() => lineChanges(reg) !== null, { timeout: 180000, interval: 100 })
    const total = Math.round(performance.now() - started)
    h.check(`Monaco then shows ${feedLines.length} one-line changes`, (lineChanges(reg) ?? []).length === feedLines.length && (lineChanges(reg) ?? []).map(spans).every((c) => c.o[0] === c.o[1] && c.m[0] === c.m[1]), { changes: (lineChanges(reg) ?? []).length })
    h.log(`review normalization: ${ms} ms; with the diff on screen: ${total} ms; ${different} different lines`)
    compare.setMode('raw')
    await closeCompare(h)
    for (const id of [a, b]) {
      ctx.docs.activate(id)
      await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 10000 })
      await ctx.commands.run('file.close')
      await h.waitFor(() => !ctx.docs.get(id), { timeout: 20000 })
    }
  })

  // =============================================================== C. a merge in 100 ms
  await guard(h, 'C. a merge on 100,000 lines', async () => {
    const pa = `${h.cfg.run}/m11-perf-c-original.nc`
    const pb = `${h.cfg.run}/m11-perf-c-modified.nc`
    await h.disk.write(pa, joined(base))
    await h.disk.write(pb, joined(tweaked))
    const left = (await openPath(h, pa)).id
    const right = (await openPath(h, pb)).id
    await h.waitFor(() => ctx.editor.getLineCount(left) === base.length + 1 && ctx.editor.getLineCount(right) === base.length + 1, { timeout: 120000, interval: 50 })
    await h.idle({ timeout: 60000 })
    ctx.docs.activate(right)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === right, { timeout: 10000 })
    compare.setMode('raw')
    await openCompare(h, reg, right, { kind: 'document', docId: left })
    h.check(`raw mode: the ${feedLines.length} changed feed words are ${feedLines.length} changes`, (lineChanges(reg) ?? []).length === feedLines.length, (lineChanges(reg) ?? []).length)
    const target = feedLines[Math.floor(feedLines.length / 2)] + 1
    const before = ctx.editor.getLines(right, target, target)[0]
    const want = ctx.editor.getLines(left, target, target)[0]
    compare.goToLine(target, 'modified')
    await h.idle()
    const started = performance.now()
    const ok = await compare.copyChange('toModified')
    const ms = performance.now() - started
    h.checkTime(`one merge (copyChange) between two ${base.length}-line documents`, ms, MERGE_BUDGET_MS, { ok })
    h.check('the change at the cursor was copied: that one line is the original’s again', ok === true && ctx.editor.getLines(right, target, target)[0] === want && before !== want, { target, before, now: ctx.editor.getLines(right, target, target)[0], want })
    h.check('and nothing else in the document changed', ctx.editor.getLineCount(right) === base.length + 1)
    await h.waitFor(() => (lineChanges(reg) ?? []).length === feedLines.length - 1, { timeout: 120000, interval: 50 })
    h.check('the diff follows: one change fewer', (lineChanges(reg) ?? []).length === feedLines.length - 1)
    paneUndo(reg, 'modified', 'undo')
    await h.waitFor(() => ctx.editor.getLines(right, target, target)[0] === before, { timeout: 20000, interval: 5 })
    h.check('one undo takes the merge back', ctx.editor.getLines(right, target, target)[0] === before)
    h.log(`merge: ${ms.toFixed(1)} ms`)
    await closeCompare(h)
  })
})
