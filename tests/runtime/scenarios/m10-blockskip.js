// Block skip and the tool segment, in the running app (plan §6 M10 H10 `m10-blockskip`,
// WP10.1; X8: "block skip insert/remove on a selection is one undo step each").
//
// **What is held to the contract and what is left to WP10.1.** The spec (nc-transformations,
// "Insert and remove block skip") says four things, and each has a check below:
//
//   1. a selected line gets the skip mark where the profile says (`syntax.blockSkip.position`:
//      before the block number, after it, or either), and a line that is already marked is
//      not marked twice;
//   2. removal takes the mark at the head of the block and nothing else - a `/` that is a
//      division (`#1=#2/2`, `R1=R2/2`, `Q1 = Q2 / 2`) is never touched, in either direction;
//   3. a numbered level (`/1` to `/9`) is kept when the marks of another level are removed;
//   4. each command is one undo step.
//
// The position of the mark is not retyped: where the profile says `either` the scenario
// accepts the mark before or after the number and asks that *nothing else* on the line
// changed (`squash`: the line without white space and without the mark equals the line as
// it was). Where the profile says `before-number` (Sinumerik) the mark has to be the first
// character of the line.
//
// **What this cannot know yet:** the options form of the two commands is WP10.1's. The
// level control is found by its id containing `level`; when there is no such control the
// level section fails by name and the other sections still run.
//
// The tool segment (`nav.selectToolSegment`, `Mod+F7`) is checked against the outline's own
// `endLine`: the selection starts on the tool line and ends at the end of the segment's last
// line that has text. The command leaves blank lines at the end of a segment out (plan row
// 115), so the last segment of a file that ends in a newline stops above the empty line the
// outline counts (`lib/segments.js`, held to that case in `tests/unit/runtimeLib.test.ts`).

import { scenario } from '../lib/index.js'
import { selectsSegment } from '../lib/segments.js'
import { setInput } from './m2-common.js'
import { FANUC_MILL, KLARTEXT, SINUMERIK, context, fieldIds, guard, linesOfText, newDoc, openPath, ready, revealLine, ribbonTab, selectLines, squash, textOf, toolSegments, undo } from './m10-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The skip mark at the head of a block: where it sits, its level and the line without it. */
const MARK_BEFORE = /^(\s*)\/(\d?)\s*(.*)$/
const MARK_AFTER = /^(\s*(?:N\d+|:\d+|\d+)\s*)\/(\d?)\s*(.*)$/

/**
 * @param {string} line
 * @returns {{ where: 'before' | 'after', level: string, rest: string } | null}
 */
function markOf(line) {
  const before = MARK_BEFORE.exec(line)
  if (before) return { where: 'before', level: before[2], rest: before[3] }
  const after = MARK_AFTER.exec(line)
  if (after) return { where: 'after', level: after[2], rest: after[1] + after[3] }
  return null
}

/** The line without the mark at its head, or as it is when it has none. @param {string} line */
const unmarked = (line) => markOf(line)?.rest ?? line

/** How many `/` a line holds. @param {string} line */
const slashes = (line) => line.split('/').length - 1

/**
 * Runs a block-skip command over the selection, answering its form if it has one. Answers
 * whether a form came up and which of its fields were there.
 * @param {Harness} h
 * @param {string} commandId
 * @param {{ level?: number }} [o]
 */
async function runSkip(h, commandId, o = {}) {
  const running = context(h).commands.run(commandId)
  let finished = false
  running.then(
    () => {
      finished = true
    },
    () => {
      finished = true
    },
  )
  const state = await h.waitFor(() => (h.q('modal') ? 'form' : finished ? 'done' : null), { timeout: 15000, interval: 25 })
  /** @type {string[]} */
  let fields = []
  if (state === 'form') {
    fields = fieldIds(h)
    if (o.level !== undefined) setLevel(h, o.level)
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  }
  await running
  await h.idle()
  return { form: state === 'form', fields }
}

/**
 * Sets the optional level of the form that is on screen.
 * @param {Harness} h
 * @param {number} level
 */
function setLevel(h, level) {
  const id = fieldIds(h).find((field) => /level/i.test(field))
  if (id === undefined) throw new Error(`the form has no level field; it has ${JSON.stringify(fieldIds(h))}`)
  const control = /** @type {HTMLInputElement | HTMLSelectElement | null} */ (h.q('form-field', { field: id })?.querySelector('input, select'))
  if (!control) throw new Error(`field ${id} has no control`)
  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((o) => new RegExp(`(^|\\D)${level}(\\D|$)`).test(o.textContent ?? ''))
    if (!option) throw new Error(`field ${id}: no option for level ${level} in ${[...control.options].map((o) => o.textContent?.trim()).join('|')}`)
    h.select(control, option.value)
  } else if (control.type === 'checkbox') {
    if (!control.checked) h.click(control)
  } else {
    setInput(control, String(level))
  }
}

const FANUC = [
  '%',
  'O5000 (BLOCK SKIP)',
  'N10 G21 G17 G40 G49 G80 G90 G94',
  'N20 T1 M6',
  'N30 S3000 M3',
  'N40 G0 X0. Y0.',
  'N50 G1 Z-2. F250.',
  'N60 X40.',
  '#1=#2/2',
  'N70 #3=#4/2',
  '/N80 Y10.',
  'N90 / Y20.',
  'N100 G0 Z25.',
  'M30',
  '%',
  '',
].join('\n')

const LEVELS = ['%', 'O5001 (LEVELS)', 'N10 G0 X0.', '/1 N20 G1 X10. F100.', '/2 N30 G1 X20.', '/ N40 G1 X30.', 'N50 G1 X40.', 'M30', '%', ''].join('\n')

const KLARTEXT_PROGRAM = [
  '0 BEGIN PGM SKIP MM',
  '1 TOOL CALL 1 Z S3000',
  '2 L Z+100 R0 FMAX M3',
  '3 L X+0 Y+0 R0 FMAX',
  '4 L Z-2 R0 F250',
  '5 L X+40',
  '6 Q1 = Q2 / 2',
  '7 L Z+100 R0 FMAX M9',
  '8 M30',
  '9 END PGM SKIP MM',
  '',
].join('\n')

const SIEMENS = ['%_N_SKIP_MPF', '; SKIP', 'N10 G18 G90 G95', 'N20 G0 X50. Z2.', 'N30 G1 Z-5. F0.2', 'N40 R1=R2/2', 'N50 G0 Z2.', 'M30', ''].join('\n')

scenario('m10-blockskip', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const linesNow = (/** @type {string} */ id) => linesOfText(textOf(h, id))

  // =============================================================== 0. the plumbing, proved on a transform of M4
  //
  // `runSkip` (the command, its form if it has one, the selection it works on, the one undo)
  // is tried on Remove Block Numbers, which has shipped since M4, so a failure in the sections below
  // that this one did not share is the block-skip command's and not the scenario's.
  await guard(h, '0. the plumbing', async () => {
    const id = await newDoc(h, FANUC, FANUC_MILL)
    const original = linesNow(id)
    await selectLines(h, 7, 13)
    const run = await runSkip(h, 'nc.removeBlockNumbers')
    const after = linesNow(id)
    h.check('the plumbing: a transform run over a selection (its form answered with OK) changes the selected lines and only those', run.form === true && squash(after[6]) === squash('G1 Z-2. F250.') && after.every((line, i) => (i >= 6 && i <= 12) || line === original[i]), { form: run.form, line7: after[6], outside: after.filter((line, i) => !(i >= 6 && i <= 12) && line !== original[i]) })
    await undo(h)
    h.check('and one undo gives the program back', JSON.stringify(linesNow(id)) === JSON.stringify(original), linesNow(id))
  })

  // =============================================================== A. the commands are there
  await guard(h, 'A. the commands', async () => {
    h.check(
      'the three commands are registered: block skip insert and remove, and the tool segment',
      ['nc.blockSkip.add', 'nc.blockSkip.remove', 'nav.selectToolSegment'].every((id) => ctx.commands.has(id)),
      ['nc.blockSkip.add', 'nc.blockSkip.remove', 'nav.selectToolSegment'].filter((id) => !ctx.commands.has(id)),
    )
    h.check('the tool segment is on Mod+F7 (§7.13) and block skip has no default key', ctx.commands.get('nav.selectToolSegment')?.keys === 'Mod+F7' && !ctx.commands.get('nc.blockSkip.add')?.keys && !ctx.commands.get('nc.blockSkip.remove')?.keys, {
      segment: ctx.commands.get('nav.selectToolSegment')?.keys,
      add: ctx.commands.get('nc.blockSkip.add')?.keys,
      remove: ctx.commands.get('nc.blockSkip.remove')?.keys,
    })
    await newDoc(h, FANUC)
    await ribbonTab(h, 'nc')
    const buttons = h.qa('cmd-button').map((e) => e.dataset.command)
    h.check('the NC tab draws all three', ['nc.blockSkip.add', 'nc.blockSkip.remove', 'nav.selectToolSegment'].every((id) => buttons.includes(id)), buttons)
    const captions = [...document.querySelectorAll('.group-label')].map((e) => e.textContent?.trim())
    h.check('under the captions Block Skip and Segments', captions.includes('Block Skip') && captions.includes('Segments'), captions)
    h.check('and they are enabled on a Fanuc program', ['nc.blockSkip.add', 'nc.blockSkip.remove', 'nav.selectToolSegment'].every((id) => ctx.commands.isEnabled(id)), ['nc.blockSkip.add', 'nc.blockSkip.remove', 'nav.selectToolSegment'].map((id) => `${id}:${ctx.commands.isEnabled(id)}`))
  })

  // =============================================================== B. a Fanuc selection
  await guard(h, 'B. a Fanuc selection', async () => {
    const position = ctx.profiles.profile(FANUC_MILL).syntax.blockSkip?.position
    h.check('the Fanuc profile says the mark may stand before or after the number', position === 'either', position)
    const id = await newDoc(h, FANUC, FANUC_MILL)
    const original = linesNow(id)
    await selectLines(h, 7, 13)

    // ---- insert
    const added = await runSkip(h, 'nc.blockSkip.add')
    const marked = linesNow(id)
    h.check('Insert Block Skip leaves the line count alone', marked.length === original.length, { before: original.length, after: marked.length })
    const wantMarked = [7, 8, 9, 10, 13]
    h.check(
      'it marks the selected lines that were not marked, with a mark at the head of the block',
      wantMarked.every((n) => markOf(marked[n - 1]) !== null && markOf(marked[n - 1])?.level === ''),
      wantMarked.map((n) => marked[n - 1]),
    )
    h.check(
      'and changes nothing else on them: without the mark and the spacing each is the line it was',
      wantMarked.every((n) => squash(unmarked(marked[n - 1])) === squash(original[n - 1])),
      wantMarked.map((n) => `${original[n - 1]} -> ${marked[n - 1]}`),
    )
    h.check('a division is no mark and is not lost: #1=#2/2 and N70 #3=#4/2 keep their /2', slashes(marked[8]) === 2 && slashes(marked[9]) === 2 && marked[8].endsWith('#2/2') && marked[9].endsWith('#4/2'), [marked[8], marked[9]])
    h.check('a line that already has the mark - /N80 Y10. and N90 / Y20. - is not marked twice', marked[10] === original[10] && marked[11] === original[11], [marked[10], marked[11]])
    h.check('lines outside the selection are untouched, byte for byte', [1, 2, 3, 4, 5, 6, 14, 15, 16].every((n) => marked[n - 1] === original[n - 1]), marked)
    await undo(h)
    h.check('one undo gives the program back', JSON.stringify(linesNow(id)) === JSON.stringify(original), linesNow(id).join('|'))
    h.log(`blockSkip.add form: ${added.form} ${JSON.stringify(added.fields)}`)

    // ---- never twice, then remove
    await selectLines(h, 7, 13)
    await runSkip(h, 'nc.blockSkip.add')
    const once = linesNow(id)
    await selectLines(h, 7, 13)
    await runSkip(h, 'nc.blockSkip.add')
    h.check('inserting again over the same selection changes nothing: no line is marked twice', JSON.stringify(linesNow(id)) === JSON.stringify(once), linesNow(id))
    await selectLines(h, 7, 13)
    const removed = await runSkip(h, 'nc.blockSkip.remove')
    const after = linesNow(id)
    h.check(
      'Remove Block Skip takes the mark off every selected line, the ones that were marked before included',
      [7, 8, 9, 10, 11, 12, 13].every((n) => markOf(after[n - 1]) === null),
      after.slice(6, 13),
    )
    h.check(
      'and only the mark: each selected line is the line it was, apart from the spacing the mark brought',
      [7, 8, 9, 10, 13].every((n) => squash(after[n - 1]) === squash(original[n - 1])) && squash(after[10]) === squash('N80 Y10.') && squash(after[11]) === squash('N90 Y20.'),
      after.slice(6, 13),
    )
    h.check('the divisions are still there: #1=#2/2 is the line it was', after[8] === original[8] || squash(after[8]) === squash(original[8]), after[8])
    h.check('lines outside the selection are untouched', [1, 2, 3, 4, 5, 6, 14, 15, 16].every((n) => after[n - 1] === original[n - 1]), after)
    await undo(h)
    h.check('one undo takes the removal back: the marks are on again', JSON.stringify(linesNow(id)) === JSON.stringify(once), linesNow(id).slice(6, 13))
    h.log(`blockSkip.remove form: ${removed.form} ${JSON.stringify(removed.fields)}`)
  })

  // =============================================================== C. levels
  await guard(h, 'C. levels', async () => {
    const id = await newDoc(h, LEVELS, FANUC_MILL)
    const original = linesNow(id)
    await selectLines(h, 3, 7)
    await runSkip(h, 'nc.blockSkip.remove', { level: 2 })
    const after = linesNow(id)
    h.check('removing the marks of level 2 takes /2 off', markOf(after[4]) === null && squash(after[4]) === squash('N30 G1 X20.'), after[4])
    h.check('and keeps the mark of another level: /1 N20 is as it was', after[3] === original[3], after[3])
    h.check('lines outside the selection are untouched', [1, 2, 8, 9, 10].every((n) => after[n - 1] === original[n - 1]), after)
    h.log(`level 2 removal left the plain mark line as: ${after[5]}`)
    await undo(h)
    h.check('one undo', JSON.stringify(linesNow(id)) === JSON.stringify(original), linesNow(id))

    await selectLines(h, 7, 7)
    await runSkip(h, 'nc.blockSkip.add', { level: 1 })
    const marked = linesNow(id)
    h.check('inserting with level 1 writes a numbered mark: /1', markOf(marked[6])?.level === '1' && squash(unmarked(marked[6])) === squash('N50 G1 X40.'), marked[6])
    await undo(h)
  })

  // =============================================================== D. Klartext
  await guard(h, 'D. Klartext', async () => {
    const position = ctx.profiles.profile(KLARTEXT).syntax.blockSkip?.position
    h.check('the Klartext profile has a block-skip mark', position !== undefined, position)
    const id = await newDoc(h, KLARTEXT_PROGRAM, KLARTEXT)
    const original = linesNow(id)
    await selectLines(h, 5, 7)
    await runSkip(h, 'nc.blockSkip.add')
    const marked = linesNow(id)
    h.check('the selected blocks are marked, behind the block number or in front of it as the profile allows', [5, 6, 7].every((n) => markOf(marked[n - 1]) !== null), [5, 6, 7].map((n) => marked[n - 1]))
    h.check(
      'and are otherwise the blocks they were',
      [5, 6, 7].every((n) => squash(unmarked(marked[n - 1])) === squash(original[n - 1])),
      [5, 6, 7].map((n) => `${original[n - 1]} -> ${marked[n - 1]}`),
    )
    h.check('Q1 = Q2 / 2 keeps its division', slashes(marked[6]) === 2 && marked[6].endsWith('Q2 / 2'), marked[6])
    h.check('the blocks outside the selection are untouched', [1, 2, 3, 4, 8, 9, 10, 11].every((n) => marked[n - 1] === original[n - 1]), marked)
    await selectLines(h, 5, 7)
    await runSkip(h, 'nc.blockSkip.remove')
    h.check('Remove gives the program back, spacing aside, division and all', linesNow(id).every((line, i) => squash(line) === squash(original[i])), linesNow(id))
    await undo(h)
    await undo(h)
    h.check('and the two undos take both runs back', JSON.stringify(linesNow(id)) === JSON.stringify(original), linesNow(id))
  })

  // =============================================================== E. Sinumerik: the mark first
  await guard(h, 'E. Sinumerik', async () => {
    const position = ctx.profiles.profile(SINUMERIK).syntax.blockSkip?.position
    h.check('the Sinumerik profile puts the mark in front of the block number', position === 'before-number', position)
    const id = await newDoc(h, SIEMENS, SINUMERIK)
    const original = linesNow(id)
    await selectLines(h, 4, 6)
    await runSkip(h, 'nc.blockSkip.add')
    const marked = linesNow(id)
    h.check('the mark is the first character of each selected block', [4, 5, 6].every((n) => marked[n - 1].startsWith('/')), [4, 5, 6].map((n) => marked[n - 1]))
    h.check('R1=R2/2 keeps its division', slashes(marked[5]) === 2 && marked[5].endsWith('R1=R2/2'), marked[5])
    h.check('lines outside are untouched', [1, 2, 3, 7, 8, 9].every((n) => marked[n - 1] === original[n - 1]), marked)
    await selectLines(h, 4, 6)
    await runSkip(h, 'nc.blockSkip.remove')
    h.check('Remove takes exactly those marks off again', linesNow(id).every((line, i) => squash(line) === squash(original[i])), linesNow(id))
  })

  // =============================================================== F. the tool segment
  await guard(h, 'F. the tool segment', async () => {
    const opened = await openPath(h, await h.fixture('nc/fanuc/f01-mill-3tools.nc'))
    const id = opened.id
    await ctx.outline.whenReady(id)
    await h.waitFor(() => toolSegments(h, id).length >= 3, { timeout: 15000 })
    const segments = toolSegments(h, id)
    h.check('the outline holds the three tool segments with their last line (the outline\'s own endLine)', segments.length === 3 && segments.every((s) => typeof s.endLine === 'number' && s.endLine >= s.line), segments)
    const instance = /** @type {any} */ (ctx.editor.editorInstance())
    // The command leaves the blank lines at the end of a segment out (`trimBlankEnd`), so the
    // last segment of a file that ends in a newline stops at its last line with text, not at
    // the outline's `endLine` (the empty line after the final block).
    const lineAt = (/** @type {number} */ line) => ctx.editor.getLines(id, line, line)[0] ?? ''
    /** @param {number} line @param {number | undefined} endLine @param {any} selection */
    const covers = (line, endLine, selection) => selectsSegment(selection, line, endLine ?? line, lineAt)
    for (const segment of segments) {
      const middle = Math.min(segment.line + 1, segment.endLine ?? segment.line)
      await revealLine(h, id, middle, 1)
      await ctx.commands.run('nav.selectToolSegment')
      await h.idle()
      const selection = instance.getSelection()
      h.check(
        `Select Tool Segment with the cursor on line ${middle} selects tool ${segment.tool}: lines ${segment.line} to ${segment.endLine}`,
        covers(segment.line, segment.endLine, selection),
        { selection: [selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn], segment },
      )
    }
    const first = segments[0]
    await revealLine(h, id, first.line, 1)
    h.focusEditor()
    await h.nativeKeys([{ key: 'F7', mods: ['cmd'] }])
    await h.waitFor(() => covers(first.line, first.endLine, instance.getSelection()), { timeout: 5000 })
    const keyed = instance.getSelection()
    h.check('Cmd+F7 does the same, from the keyboard', covers(first.line, first.endLine, keyed), [keyed.startLineNumber, keyed.endLineNumber])
    h.check('selecting a segment changes nothing in the file', !ctx.docs.get(id)?.dirty, ctx.docs.get(id)?.dirty)
  })
})
