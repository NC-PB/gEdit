// Edit Cycle on real cycle lines (Phase 3 plan H3b `p3-cycleforms`; X18 a and b): the Insert tab's "Edit Cycle…"
// reads the cycle at the cursor into a form, rewrites only the words that changed, and touches nothing else.
//
// Every case is a golden of `tests/fixtures/cycleforms/<profile>/<case>.json` (written before the form existed;
// `core/templates/cycleForm.test.ts` holds the engine to them). The scenario opens the golden's program (a fixture
// file, or the lines the golden states), puts the cursor on the golden's line, presses the Insert tab's Edit
// Cycle button and checks, with the real UI:
//
//   - the form reads the block back: its fields are the golden's addresses with the golden's values, and its
//     title, OK label and note are the app's own wording (`ctx.t`);
//   - one value changed (and others cleared or added, as the golden says): the live text under the fields is the
//     golden's new lines;
//   - Apply (a real click) writes exactly those lines: the whole program equals the original with the golden's
//     lines replaced, so every other word, comment and block number is kept byte for byte; the status bar says so;
//   - one Undo gives the original program back.
//
// Cases: a mill G83 (the Q changed, K added), the same confirmed unchanged (nothing written, nothing dirty), a
// G81 with a comment after it (K before the comment, Y cleared), a packed G81, a point-less Z under an IS-B machine
// (the literal stays), a ten-line Klartext definition, an Okuma G181 and a Sinumerik CYCLE83 (by position) and an
// MCALL. Refusals say why in plain words and write nothing (a two-block lathe cycle, a position under a modal
// cycle that runs the cycle written on another line). Insert mode: with the cursor on no cycle a picker lists the
// cycles of the dialect; the chosen one opens the empty form, and OK writes a new block after the cursor's
// block, numbered by the template rule - and in Klartext the blocks behind it are renumbered in the same edit.

import { scenario } from '../lib/index.js'
import { guard, machineMaker } from './m10-common.js'
import { message, newDoc, ready, ribbonTab } from './m4-common.js'
import { undo } from './m5-common.js'
import { context, openPath, revealLine } from './m3-common.js'
import { clicks, formDialog, formNow, formState, golden, linesOf, pickByLabel, pickCancelled, pickRows, pressCancel, pressOk, typeInField, waitForm } from './p3b-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** A golden's program: the fixture it names, or the lines it states. */
async function openProgram(/** @type {Harness} */ h, /** @type {any} */ g, /** @type {string} */ profile) {
  if (typeof g.input === 'string') {
    const rel = g.input.replace(/^(\.\.\/)+/, '')
    const { id } = await openPath(h, await h.fixture(rel))
    return { id, lines: linesOf(h, id) }
  }
  const id = await newDoc(h, g.input.join('\n'), profile)
  return { id, lines: linesOf(h, id) }
}

/** Opens the form on the cursor line with the Insert tab's button. @param {Harness} h */
async function pressEditCycle(h) {
  await ribbonTab(h, 'insert')
  const button = h.q('cmd-button', { command: 'nc.editCycle' })
  if (!button) throw new Error('the Insert tab has no Edit Cycle button')
  h.click(button)
}

/**
 * One edit case.
 * @param {Harness} h
 * @param {{ golden: string, profile: string, code: string, preset?: string, noop?: boolean }} spec
 * @param {ReturnType<typeof machineMaker>} maker
 */
async function editCase(h, spec, maker) {
  const ctx = context(h)
  const g = await golden(h, `cycleforms/${spec.golden}`)
  const name = spec.golden
  const { id, lines } = await openProgram(h, g, spec.profile)
  h.check(`${name}: the program opens as ${spec.profile}`, ctx.docs.get(id)?.profileId === spec.profile, ctx.docs.get(id)?.profileId)
  if (g.machine?.numberInput) {
    await maker.add(`m-${name}`, spec.profile, g.machine.numberInput)
    await maker.use(`m-${name}`)
  }
  await ctx.modal.whenReady(id)
  await revealLine(h, id, g.line, 1)
  await pressEditCycle(h)
  const dialog = await waitForm(h)
  h.check(`${name}: Edit Cycle at line ${g.line} opens the form`, dialog !== null)
  if (dialog === null) return
  let state = formNow(h)
  if (!state) return
  h.check(`${name}: the title is "${spec.code}: <the code database's label>" and the button says Apply`, state.title.startsWith(`${spec.code}:`) && state.okLabel === ctx.t('cycleForm.okEdit'), { title: state.title, ok: state.okLabel })
  if (g.form) {
    const want = g.form.values
    const got = Object.fromEntries(Object.keys(want).map((a) => [a, state?.values[a]]))
    h.check(`${name}: the form reads the block back, address by address, and has no other field`, JSON.stringify(got) === JSON.stringify(want) && state.fields.size === Object.keys(want).length, { got, want, fields: [...state.fields.keys()] })
    h.check(`${name}: the words it keeps are named in the note`, g.form.kept.length === 0 ? state.note === '' : state.note === ctx.t('cycleForm.kept', { words: g.form.kept.join(' ') }), state.note)
  }
  h.check(`${name}: the note carries the cycle and the mode (test id)`, state.noteElement?.getAttribute('data-cycle') === spec.code && state.noteElement?.getAttribute('data-mode') === 'edit', { cycle: state.noteElement?.getAttribute('data-cycle'), mode: state.noteElement?.getAttribute('data-mode') })

  for (const [address, value] of Object.entries(g.values)) await typeInField(h, address, /** @type {string} */ (value))
  state = formNow(h)
  const expectedLines = /** @type {string[]} */ (g.expected.lines)
  h.check(`${name}: the live text under the fields is the golden's new block`, state?.preview === expectedLines.join('\n') && state.previewError === '' && !state.okDisabled, { preview: state?.preview, want: expectedLines.join('\n') })
  const dirtyBefore = ctx.docs.get(id)?.dirty === true
  const closed = await pressOk(h)
  h.check(`${name}: Apply closes the form`, closed)

  const want = [...lines.slice(0, g.expected.first - 1), ...expectedLines, ...lines.slice(g.expected.last)]
  const after = linesOf(h, id)
  h.check(`${name}: the program is the original with lines ${g.expected.first}-${g.expected.last} replaced, every other byte as it was`, JSON.stringify(after) === JSON.stringify(want), { first: g.expected.first, got: after.slice(g.expected.first - 2, g.expected.first + expectedLines.length), want: want.slice(g.expected.first - 2, g.expected.first + expectedLines.length) })
  if (spec.noop) {
    h.check(`${name}: confirming without a change says so and writes nothing (not even a dirty flag)`, message(h) === ctx.t('cycleForm.unchanged') && JSON.stringify(after) === JSON.stringify(lines) && (ctx.docs.get(id)?.dirty === true) === dirtyBefore, { status: message(h), dirty: ctx.docs.get(id)?.dirty })
    return
  }
  h.check(`${name}: the status bar says the block was changed`, message(h) === ctx.t('cycleForm.edited', { code: spec.code }), message(h))
  await undo(h)
  h.check(`${name}: one Undo gives the original program back`, JSON.stringify(linesOf(h, id)) === JSON.stringify(lines), linesOf(h, id).slice(g.expected.first - 2, g.expected.first + expectedLines.length))
}

/**
 * A refusal case: the status bar says why, no form opens, nothing is written.
 * @param {Harness} h
 * @param {{ golden: string, profile: string }} spec
 */
async function refusalCase(h, spec) {
  const ctx = context(h)
  const g = await golden(h, `cycleforms/${spec.golden}`)
  const { id, lines } = await openProgram(h, g, spec.profile)
  await ctx.modal.whenReady(id)
  await revealLine(h, id, g.line, 1)
  await pressEditCycle(h)
  const said = await h.waitFor(() => message(h) === ctx.t(g.expected.refused, g.expected.params), { timeout: 5000 })
  h.check(`${spec.golden}: line ${g.line} is refused in plain words (${g.expected.refused})`, !!said, { status: message(h), want: ctx.t(g.expected.refused, g.expected.params) })
  await h.idle()
  h.check(`${spec.golden}: no form opens and nothing is written`, formDialog(h) === null && JSON.stringify(linesOf(h, id)) === JSON.stringify(lines))
}

/** The program with `lines` inserted after line `after`. @param {string[]} program @param {number} after @param {string[]} lines */
const inserted = (program, after, lines) => [...program.slice(0, after), ...lines, ...program.slice(after)]

scenario('p3-cycleforms', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const maker = machineMaker(h)

  // ============================================================ A. edit mode, the controls one by one
  await guard(h, 'A. Fanuc mill', async () => {
    await editCase(h, { golden: 'fanuc-gcode/f01-g83-edit', profile: 'fanuc-gcode', code: 'G83' }, maker)
    await editCase(h, { golden: 'fanuc-gcode/f01-g83-noop', profile: 'fanuc-gcode', code: 'G83', noop: true }, maker)
    await editCase(h, { golden: 'fanuc-gcode/k-before-comment', profile: 'fanuc-gcode', code: 'G81' }, maker)
    await editCase(h, { golden: 'fanuc-gcode/f02-packed-g81', profile: 'fanuc-gcode', code: 'G81' }, maker)
    await editCase(h, { golden: 'fanuc-gcode/pointless-isb-whole', profile: 'fanuc-gcode', code: 'G83' }, maker)
  })
  await guard(h, 'B. Klartext', async () => {
    await editCase(h, { golden: 'heidenhain-klartext/h01-cycl-def-200-edit', profile: 'heidenhain-klartext', code: 'CYCL DEF 200' }, maker)
  })
  await guard(h, 'C. Okuma', async () => {
    await editCase(h, { golden: 'okuma-osp/o03-g181-edit', profile: 'okuma-osp', code: 'G181' }, maker)
  })
  await guard(h, 'D. Sinumerik', async () => {
    await editCase(h, { golden: 'sinumerik/s02-cycle83-edit', profile: 'sinumerik', code: 'CYCLE83' }, maker)
    await editCase(h, { golden: 'sinumerik/s02-mcall-edit', profile: 'sinumerik', code: 'CYCLE83' }, maker)
  })

  // ============================================================ E. refusals
  await guard(h, 'E. refusals', async () => {
    await refusalCase(h, { golden: 'fanuc-lathe/l01-g71-first-refused', profile: 'fanuc-lathe' })
    await refusalCase(h, { golden: 'fanuc-lathe/l01-g76-second-refused', profile: 'fanuc-lathe' })
    await refusalCase(h, { golden: 'fanuc-gcode/f01-position-refused', profile: 'fanuc-gcode' })
  })

  // ============================================================ F. cancel writes nothing
  await guard(h, 'F. cancel', async () => {
    const g = await golden(h, 'cycleforms/fanuc-gcode/f01-g83-edit')
    const { id, lines } = await openProgram(h, g, 'fanuc-gcode')
    await ctx.modal.whenReady(id)
    await revealLine(h, id, g.line, 1)
    await pressEditCycle(h)
    await waitForm(h)
    await typeInField(h, 'Q', '9')
    h.check('Cancel after a change: the form closes, the program is as it was, no status of a change', (await pressCancel(h)) && JSON.stringify(linesOf(h, id)) === JSON.stringify(lines) && !ctx.docs.get(id)?.dirty && message(h) !== ctx.t('cycleForm.edited', { code: 'G83' }), message(h))
  })

  // ============================================================ G. insert mode
  await guard(h, 'G. insert, Fanuc', async () => {
    const g = await golden(h, 'cycleforms/fanuc-gcode/insert-g83-numbered')
    const id = await newDoc(h, g.input.join('\n'), 'fanuc-gcode')
    const lines = linesOf(h, id)
    await ctx.modal.whenReady(id)
    await revealLine(h, id, g.line, 1)
    await pressEditCycle(h)
    await pickByLabel(h, g.insert.code)
    const dialog = await waitForm(h)
    h.check('insert: with the cursor on no cycle a picker lists the cycles, and the chosen one opens an empty form', dialog !== null)
    let state = formNow(h)
    h.check('insert: the form is the cycle form of G83 in insert mode (button Insert, every field empty)', !!state && state.title.startsWith('G83:') && state.okLabel === ctx.t('cycleForm.okInsert') && state.noteElement?.getAttribute('data-mode') === 'insert' && [...state.fields.values()].every((f) => f.value === ''), state && { title: state.title, ok: state.okLabel, values: state.values })
    for (const [address, value] of Object.entries(g.values)) await typeInField(h, address, /** @type {string} */ (value))
    state = formNow(h)
    h.check('insert: the live text is the golden block, numbered with the step after N20', state?.preview === g.expected.lines.join('\n') && !state.okDisabled, { preview: state?.preview, want: g.expected.lines })
    await pressOk(h)
    const want = inserted(lines, g.expected.first - 1, g.expected.lines)
    h.check('insert: the block stands after the cursor line and everything else is as it was', JSON.stringify(linesOf(h, id)) === JSON.stringify(want), linesOf(h, id))
    h.check('insert: the status bar says a block was inserted', message(h) === ctx.t('cycleForm.inserted', { code: 'G83' }), message(h))
    await undo(h)
    h.check('insert: one Undo removes it', JSON.stringify(linesOf(h, id)) === JSON.stringify(lines), linesOf(h, id))
  })

  await guard(h, 'H. insert, Klartext, with the renumber', async () => {
    const g = await golden(h, 'cycleforms/heidenhain-klartext/insert-cycl-def-200')
    const program = /** @type {string[]} */ (g.input)
    const id = await newDoc(h, program.join('\n'), 'heidenhain-klartext')
    const lines = linesOf(h, id)
    await ctx.modal.whenReady(id)
    // The cursor on line 2 (block 1): the new block is block 2 and the blocks behind it move up (3, 4, 5, 6).
    await revealLine(h, id, 2, 1)
    await pressEditCycle(h)
    await pickByLabel(h, g.insert.code)
    await waitForm(h)
    for (const [address, value] of Object.entries(g.values)) await typeInField(h, address, /** @type {string} */ (value))
    const block = /** @type {string[]} */ (g.expected.lines).map((line) => line.replace(/^4 /, '2 '))
    const state = formNow(h)
    h.check('Klartext insert: the live text is the golden definition as block 2', state?.preview === block.join('\n'), { preview: state?.preview, want: block.join('\n') })
    await pressOk(h)
    // The golden's program numbers its blocks 0 1 2 3 5 6 7; behind a block 2 they run on from 3.
    const behind = program.slice(2).map((line, i) => line.replace(/^\d+ /, `${3 + i} `))
    const want = [...program.slice(0, 2), ...block, ...behind]
    const got = linesOf(h, id)
    h.check('Klartext insert: the definition is block 2, every block behind it is renumbered 3, 4, 5, 6, 7 in the same edit', JSON.stringify(got) === JSON.stringify(want), { got: got.slice(0, 8), want: want.slice(0, 8) })
    await undo(h)
    h.check('Klartext insert: one Undo takes back the block and the renumbering together', JSON.stringify(linesOf(h, id)) === JSON.stringify(lines), linesOf(h, id).slice(0, 8))
  })

  await guard(h, 'I. a picker that is cancelled', async () => {
    const id = await newDoc(h, '%\nO1000\nN10 G90 G0 X0 Y0\nN20 M5', 'fanuc-gcode')
    await ctx.modal.whenReady(id)
    await revealLine(h, id, 3, 1)
    const before = linesOf(h, id)
    await pressEditCycle(h)
    h.check('Edit Cycle on a line with no cycle lists the dialect\'s cycles (G81, G83, ...)', !!(await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })) && pickRows(h).some((r) => r.label === 'G81') && pickRows(h).some((r) => r.label === 'G83'), pickRows(h).map((r) => r.label))
    await pickCancelled(h)
    h.check('Esc on the picker writes nothing and opens no form', JSON.stringify(linesOf(h, id)) === JSON.stringify(before) && formDialog(h) === null)
  })

  await guard(h, 'J. a locked program', async () => {
    const g = await golden(h, 'cycleforms/fanuc-gcode/k-before-comment')
    const id = await newDoc(h, g.input.join('\n'), 'fanuc-gcode')
    await ctx.modal.whenReady(id)
    await revealLine(h, id, g.line, 1)
    const lines = linesOf(h, id)
    await ctx.commands.run('file.toggleReadOnly')
    await h.waitFor(() => ctx.docs.get(id)?.readOnly === true, { timeout: 5000 })
    await pressEditCycle(h)
    const want = ctx.t('readOnly.refusedUser', { name: ctx.docs.get(id)?.title ?? '', action: ctx.t('readOnly.editCycle') })
    const said = await h.waitFor(() => message(h) === want, { timeout: 5000 })
    h.check('Edit Cycle on a locked program says why in plain words', !!said, { status: message(h), want })
    await h.idle()
    h.check('no form opens and the program is untouched', formDialog(h) === null && JSON.stringify(linesOf(h, id)) === JSON.stringify(lines))
    await ctx.commands.run('file.toggleReadOnly')
    await h.waitFor(() => ctx.docs.get(id)?.readOnly === false, { timeout: 5000 })
  })

  h.check('every Apply, Insert and Cancel was a real mouse click', clicks.dom === 0 && clicks.real > 0, clicks)
})
