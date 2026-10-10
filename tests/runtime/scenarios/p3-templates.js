// Templates in the window (Phase 3 plan H3b `p3-templates`; X9t, the templates half of X9, and the Insert tab of P3.5):
// the Insert tab shows the active program's templates in groups, a template is inserted through its form with the
// program's own block numbers as one undo step, completion offers the templates on an empty line, and a star puts a
// template first. The blocks of Phase 1 are gone.
//
//   A. The ribbon. The seven tabs (B1 A9: no Home tab); the program-start template has one button, on the Insert tab
//      (B1 A9: the Home tab's "Program" group is gone); no `insert.block:*` command, no "Blocks" group and no
//      "More Blocks…" list is left on any tab; the Insert tab reads Templates, Cycles, Manage.
//      On a Fanuc lathe program the template blocks are the lathe code set's groups, the buttons its `toolbar`
//      templates, the rest in each group's "More Templates…" list, every one marked "review pending"; a mill program
//      shows the mill set and none of the lathe's. (Expected: `src/lib/data/codes/*.json`, read through `{repo}`.)
//   B. Program start from the Insert tab on an empty new program and on one that is numbered below the cursor: the
//      golden `templates/fanuc/program-start` (numbered) and the same text without its block numbers (a program with
//      no number anywhere is not numbered by a template). The form has the fields of the data, with their defaults.
//   C. Tool start on a numbered lathe program (X9t): the form (fields, defaults, the "review pending" note, a live
//      preview that is the golden text), a refused value (the preview says so, OK is disabled), a changed value in the
//      text with the next block numbers, one Undo per insertion, Cancel writes nothing. G-code system B: the same
//      button gives `G92 S` (golden `templates/fanuc-lathe-b/tool-start`), system A gives `G50 S`.
//   D. A formula: the mill's rigid tapping from the "More Templates…" list; its feed is read-only and follows pitch
//      times speed in the preview and in the text.
//   E. Completion: on an empty last line `tool` lists "Tool start" with its group; Tab accepts it, the form opens, the
//      typed word is gone and the template takes the blank line.
//   F. Stars: a starred template is a button in the first block, "Favorites", and is not repeated in its own group;
//      the star is in state.json; the quick pick lists starred templates first; removing the star puts it back.
//   G. Klartext: the cycle 200 template after block 4 gets blocks 5 and 6 and the blocks behind it move up, in one edit.
//   H. A locked program refuses an insertion in plain words and writes nothing.
//   I. The cost of the form's live preview on a 300,000-line program (plan known gap 8): a keystroke in a field of the
//      template form (live renders the template with the environment read from the document) and in a cycle form (the
//      live re-reads the block) reaches the preview within the typing budget; opening the form and the Insert on that
//      program within the freeze threshold.
//   I2. The same open and Insert on a 300,000-line program with a block number on every line (the whole-program scan
//      for the numbers a template must not collide with, plan known gap 23).
//
// Expected wording is `ctx.t(...)`; block numbers and texts come from the goldens, labels and groups from the data.

import { scenario } from '../lib/index.js'
import { guard, machineMaker, splitLines } from './m10-common.js'
import { largeProgram } from './m3-common.js'
import { message, newDoc, ready, ribbonTab } from './m4-common.js'
import { undo } from './m5-common.js'
import { context, drawn, percentile, untilDom } from './p3-common.js'
import { suggestShowing } from './m3-common.js'
import { clicks, codeFile, formDialog, formNow, formState, golden, linesOf, pickRows, pickCancelled, pressCancel, pressOk, REPO_FILE, ribbonGroups, runFromInsertTab, shiftNumbers, suggestItems, templateBlocks, typeInField, waitForm } from './p3b-common.js'
import { revealLine } from './m3-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The wall-clock budgets of section I; the reasons are in the comments of that section. */
const LIVE_P95_BUDGET_MS = 17
const LIVE_COST_BUDGET_MS = 17
/**
 * Open and Insert of a template at 300,000 lines: from the click to the form's first live text, and from the click on
 * OK to the text in the program. 200 ms is where a click starts to feel like a freeze (the coordinator's flag for P3b
 * known gap 23: the service reads the whole program for free block numbers). They failed on purpose on the
 * development Mac until P3b fix H (305-425 ms measured on the unnumbered program, plan §7 #287): the budget is the
 * visibility threshold, not the measured value. Section I runs on a program without block numbers (nothing to
 * compare, no scan), section I2 on the same program with a block number on every line (the scan, 300,000 of them).
 */
const OPEN_BUDGET_MS = 200
const INSERT_BUDGET_MS = 200

/** A numbered Fanuc lathe program whose last block before the cursor is N100 (the goldens' `prevBlockNumber`). */
const LATHE_PROGRAM = ['%', 'O1000 (SHOP)', 'N10 G21 G40 G99', 'N20 G28 U0. W0.', 'N100 G0 X100. Z100.', 'M30', '%']
/** The same for a mill. */
const MILL_PROGRAM = ['%', 'O1000 (SHOP)', 'N10 G21 G17 G40 G49 G80 G90 G94', 'N100 G0 X0. Y0.', 'M30', '%']
/** A Klartext program: the last block before the cursor is block 4 (the golden of `heidenhain` `drill`). */
const KLARTEXT_PROGRAM = ['0 BEGIN PGM T1 MM', '1 BLK FORM 0.1 Z X-50 Y-50 Z-20', '2 BLK FORM 0.2 X+50 Y+50 Z+0', '3 TOOL CALL 1 Z S3000', '4 L Z+100 R0 FMAX M3', '5 L X+0 Y+0 R0 FMAX', '6 END PGM T1 MM']

/** The program with `lines` stood after line `after`. @param {string[]} program @param {number} after @param {string[]} lines */
const inserted = (program, after, lines) => [...program.slice(0, after), ...lines, ...program.slice(after)]

/** What a form control reads for a parameter's default. @param {any} p */
function shownDefault(p) {
  if (p.type === 'choice') return p.choices.find((/** @type {any} */ c) => c.value === p.default)?.label ?? ''
  return p.default === undefined ? '' : String(p.default)
}

/**
 * The fields of a template form against the data: one per parameter, in order, the formula read-only, every control at
 * the default. Numbers are compared as numbers (the form may show `34` for the default "34").
 * @param {ReturnType<typeof formState>} state
 * @param {any} def the template of the data file
 */
function formMatches(state, def) {
  if (!state) return { ok: false, why: 'no form' }
  const params = def.params.filter((/** @type {any} */ p) => p.hidden !== true)
  const ids = [...state.fields.keys()]
  if (JSON.stringify(ids) !== JSON.stringify(params.map((/** @type {any} */ p) => p.id))) return { ok: false, why: `fields ${ids.join()} against ${params.map((/** @type {any} */ p) => p.id).join()}` }
  for (const p of params) {
    const f = state.fields.get(p.id)
    const want = shownDefault(p)
    const same = p.type === 'number' || p.type === 'integer' ? Number(f?.value) === Number(want) : p.type === 'formula' ? true : f?.value === want
    if (!same) return { ok: false, why: `${p.id}: ${JSON.stringify(f?.value)} against ${JSON.stringify(want)}` }
    if ((p.type === 'formula') !== (f?.readOnly === true)) return { ok: false, why: `${p.id} read-only is ${f?.readOnly}` }
  }
  return { ok: true, why: '' }
}

/**
 * The Insert tab of the active program against its code set's data: the groups, the toolbar buttons and the More lists.
 * @param {Harness} h
 * @param {string} what
 * @param {any[]} data the templates the program must be offered
 * @param {string[]} absent template ids that must not be offered
 */
async function checkInsertTab(h, what, data, absent) {
  const ctx = context(h)
  await ribbonTab(h, 'insert')
  await h.idle()
  const blocks = templateBlocks(h)
  const groups = [...new Set(data.map((t) => t.group))]
  h.check(`${what}: one block per group of the code set, no other (${groups.join(', ')})`, [...blocks.map((b) => b.key)].sort().join('|') === [...groups].sort().join('|'), blocks.map((b) => b.key))
  h.check(`${what}: each block's caption is its group's name`, blocks.every((b) => b.caption === b.key), blocks.map((b) => b.caption))
  /** @type {string[]} */
  const wrong = []
  for (const group of groups) {
    const block = blocks.find((b) => b.key === group)
    const members = data.filter((t) => t.group === group)
    const buttons = members.filter((t) => t.toolbar === true)
    const more = members.filter((t) => t.toolbar !== true)
    if (!block) {
      wrong.push(`${group}: no block`)
      continue
    }
    if (block.buttons.map((b) => b.id).sort().join() !== buttons.map((t) => t.id).sort().join()) wrong.push(`${group}: buttons ${block.buttons.map((b) => b.id)} against ${buttons.map((t) => t.id)}`)
    if (block.moreOptions.map((o) => o.id).sort().join() !== more.map((t) => t.id).sort().join()) wrong.push(`${group}: more ${block.moreOptions.map((o) => o.id)} against ${more.map((t) => t.id)}`)
    if ((more.length > 0) !== (block.more !== null)) wrong.push(`${group}: the More list is ${block.more === null ? 'missing' : 'there'}`)
    for (const b of block.buttons) {
      const t = buttons.find((x) => x.id === b.id)
      if (t && (b.label !== t.label || b.title !== `${t.description} · ${ctx.t('templates.reviewPendingShort')}` || b.review !== 'pending')) wrong.push(`${b.id}: label ${b.label}, title ${b.title}, review ${b.review}`)
    }
    for (const o of block.moreOptions) {
      const t = more.find((x) => x.id === o.id)
      if (t && (o.label !== t.label || o.review !== 'pending')) wrong.push(`${o.id}: option ${o.label} ${o.review}`)
    }
  }
  h.check(`${what}: the toolbar templates are buttons with their label, description and "${ctx.t('templates.reviewPendingShort')}", the others are in the group's More list`, wrong.length === 0, wrong)
  const offered = new Set([...blocks.flatMap((b) => b.buttons.map((x) => x.id)), ...blocks.flatMap((b) => b.moreOptions.map((o) => o.id))])
  h.check(`${what}: the other machine type's templates are not offered (${absent.join(', ')})`, absent.every((id) => !offered.has(id)), [...offered])
  h.check(`${what}: every button is enabled`, blocks.flatMap((b) => b.buttons).every((b) => !b.disabled))
}

scenario('p3-templates', { timeout: 900, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const fanuc = (await codeFile(h, 'fanuc')).templates
  const lathe = (await codeFile(h, 'fanuc-lathe')).templates
  const latheB = (await codeFile(h, 'fanuc-lathe-b')).templates
  const byId = (/** @type {any[]} */ list, /** @type {string} */ id) => list.find((t) => t.id === id)
  const maker = machineMaker(h)

  // ============================================================ A. the ribbon
  await guard(h, 'A. the ribbon', async () => {
    const first = ctx.docs.getActiveId() ?? ''
    h.check('the first program is a Fanuc mill program', ctx.docs.get(first)?.profileId === 'fanuc-gcode', ctx.docs.get(first)?.profileId)
    // B1 A9 (owner decision): the Home tab is gone and Program start is offered on the Insert tab only,
    // in the Templates group. The ribbon has the seven tabs File, Edit, Insert, NC, Tools, Scripts, View.
    const tabIds = h.qa('ribbon-tab').map((e) => e.dataset.tab)
    h.check('the ribbon has the seven tabs File, Edit, Insert, NC, Tools, Scripts and View, and no Home tab', JSON.stringify(tabIds) === JSON.stringify(['file', 'edit', 'insert', 'nc', 'tools', 'scripts', 'view']), tabIds)
    /** @type {string[]} */
    const programStartOn = []
    for (const tab of tabIds) {
      await ribbonTab(h, /** @type {string} */ (tab))
      if (h.q('cmd-button', { command: 'insert.template:program-start' })) programStartOn.push(/** @type {string} */ (tab))
      if (ribbonGroups(h).some((g) => g.label === 'Program')) programStartOn.push(`${tab}: a group called Program`)
    }
    h.check('Program start has one button, on the Insert tab, and no group "Program" on any other tab', programStartOn.join() === 'insert', programStartOn)
    await ribbonTab(h, 'insert')
    const button = h.q('cmd-button', { command: 'insert.template:program-start' })
    h.check('and its button is enabled and reads the template\'s own label', !!button && !(/** @type {HTMLButtonElement} */ (button).disabled) && button.querySelector('.btn-label')?.textContent?.trim() === byId(fanuc, 'program-start').label, button?.textContent)
    const ids = ctx.commands.list().map((c) => c.id)
    h.check('no Phase 1 block is left: not one insert.block:* command is registered', ids.every((id) => !id.startsWith('insert.block:')) && ids.includes('insert.template:program-start'), ids.filter((id) => id.startsWith('insert.')))
    /** @type {string[]} */
    const leftovers = []
    for (const tab of tabIds) {
      await ribbonTab(h, /** @type {string} */ (tab))
      for (const b of h.qa('cmd-button')) if ((b.dataset.command ?? '').startsWith('insert.block:')) leftovers.push(`${tab}: ${b.dataset.command}`)
      for (const g of ribbonGroups(h)) if (['Blocks', 'More Blocks…'].includes(g.label)) leftovers.push(`${tab}: group ${g.label}`)
      for (const o of document.querySelectorAll('.ribbon-body option')) if (/More Blocks/.test(o.textContent ?? '')) leftovers.push(`${tab}: ${o.textContent}`)
      for (const b of h.qa('cmd-button')) if (['Program Header', 'Drilling Cycle', 'Example Block'].includes(b.querySelector('.btn-label')?.textContent?.trim() ?? '')) leftovers.push(`${tab}: ${b.textContent}`)
    }
    h.check('no tab has a button, a group or a list of the old blocks ("Blocks", "More Blocks…", "Program Header")', leftovers.length === 0, leftovers)
    await ribbonTab(h, 'insert')
    const insert = ribbonGroups(h)
    h.check('Insert tab: the groups are Templates, Cycles, Manage, in that order', insert.map((g) => g.label).join('|') === [ctx.t('templates.groupTemplates'), ctx.t('cycleForm.group'), ctx.t('templateManager.group')].join('|'), insert.map((g) => g.label))
    h.check('Cycles holds Edit Cycle; Manage holds New Template from Selection, then Manage Templates', insert[1]?.commands.join() === 'nc.editCycle' && insert[2]?.commands.join() === 'templates.fromSelection,templates.manage', insert.map((g) => g.commands))
    h.check('the buttons read their command titles', h.q('cmd-button', { command: 'nc.editCycle' })?.textContent?.includes(ctx.t('cycleForm.edit')) === true && h.q('cmd-button', { command: 'templates.manage' })?.textContent?.includes(ctx.t('templateManager.manage')) === true)
    await checkInsertTab(h, 'mill program', fanuc, ['tool-start', 'rough-finish', 'threading', 'grooving', 'face-drill'])
    h.check('the command palette titles of the templates are their labels, as data (no key leaks)', ctx.commands.list().find((c) => c.id === 'insert.template:peck-drill')?.title === byId(fanuc, 'peck-drill').label && ctx.commands.list().find((c) => c.id === 'insert.template:peck-drill')?.category === 'templates.category', ctx.commands.list().find((c) => c.id === 'insert.template:peck-drill')?.title)

    const doc = await newDoc(h, LATHE_PROGRAM.join('\n'), 'fanuc-lathe')
    h.check('a Fanuc lathe program', ctx.docs.get(doc)?.profileId === 'fanuc-lathe')
    await checkInsertTab(h, 'lathe program', lathe, ['peck-drill', 'drill', 'tapping', 'tool-change', 'boring', 'chip-break-drill', 'drill-dwell'])
    h.check('the lathe\'s Program start is the lathe\'s (one button, the lathe text)', templateBlocks(h).find((b) => b.key === 'Program')?.buttons.filter((b) => b.id === 'program-start').length === 1 && ctx.templates.list(doc).find((t) => t.id === 'program-start')?.machineType === 'lathe')
  })

  // ============================================================ B. Program start on the Insert tab
  await guard(h, 'B. Program start', async () => {
    const g = await golden(h, 'templates/fanuc/program-start')
    const def = byId(fanuc, 'program-start')
    // 1. An empty new program: no block number anywhere, so the template writes none.
    const empty = await newDoc(h, '', 'fanuc-gcode')
    await revealLine(h, empty, 1, 1)
    await ribbonTab(h, 'insert')
    const button = h.q('cmd-button', { command: 'insert.template:program-start' })
    if (!button) throw new Error('no Program start button')
    await h.window.ensureFront()
    await h.nativeClick(button)
    h.check('Program start opens the form of the template', (await waitForm(h)) !== null)
    let state = formNow(h)
    const match = formMatches(state, def)
    h.check(`the form has the template's parameters in order, each at its default (${def.params.map((/** @type {any} */ p) => p.id).join(', ')})`, match.ok, match.why)
    h.check('the title is the template\'s label, the button says Insert, the note says review pending', state?.title === def.label && state.okLabel === ctx.t('templates.insertOk') && state.note === ctx.t('templates.reviewPending'), { title: state?.title, ok: state?.okLabel, note: state?.note })
    const bare = g.expected.replace(/^N\d+ /gm, '')
    h.check('the live text is the golden without its block numbers (the program has none)', state?.preview === bare && !state.okDisabled, { preview: state?.preview, want: bare })
    await pressOk(h)
    h.check('OK replaces the blank first line: the program is exactly the golden\'s lines, unnumbered', JSON.stringify(linesOf(h, empty)) === JSON.stringify(bare.split('\n')), linesOf(h, empty))
    await undo(h)
    h.check('one Undo gives the empty program back', linesOf(h, empty).join('\n') === '', linesOf(h, empty))

    // 2. A program that is numbered below the cursor: the template numbers its blocks from the start (golden).
    const numbered = await newDoc(h, '\nN10 G0 X0. Y0.\nM30', 'fanuc-gcode')
    await revealLine(h, numbered, 1, 1)
    await ribbonTab(h, 'insert')
    h.click(h.q('cmd-button', { command: 'insert.template:program-start' }))
    await waitForm(h)
    state = formNow(h)
    h.check('in a program that has block numbers the live text is the golden with N10 and N20', state?.preview === g.expected, { preview: state?.preview, want: g.expected })
    // A changed program number: the digits are padded and the text follows.
    await typeInField(h, 'prog', '77')
    h.check('program number 77 is written O0077 (the data says four digits)', formState(h)?.preview.split('\n')[1] === 'O0077 (NEW PROGRAM)', formState(h)?.preview)
    await pressOk(h)
    const after = linesOf(h, numbered)
    h.check('the blank line is replaced and the old blocks follow unchanged', JSON.stringify(after.slice(4)) === JSON.stringify(['N10 G0 X0. Y0.', 'M30']) && after.length === 6 && after[1] === 'O0077 (NEW PROGRAM)', after)
  })

  // ============================================================ C. Tool start on a numbered lathe program
  await guard(h, 'C. Tool start', async () => {
    const g = await golden(h, 'templates/fanuc-lathe/tool-start')
    const gB = await golden(h, 'templates/fanuc-lathe-b/tool-start')
    const def = byId(lathe, 'tool-start')
    const id = await newDoc(h, LATHE_PROGRAM.join('\n'), 'fanuc-lathe')
    await ctx.modal.whenReady(id)
    await revealLine(h, id, 5, 1)
    const how = await runFromInsertTab(h, 'tool-start')
    h.check('Tool start is a button of the Insert tab', how === 'button')
    h.check('its form opens', (await waitForm(h)) !== null)
    let state = formNow(h)
    const match = formMatches(state, def)
    h.check(`the form has the parameters of the data in order, at their defaults (${def.params.length} fields)`, match.ok, match.why)
    h.check('each field is labelled as in the data', def.params.every((/** @type {any} */ p) => state?.fields.get(p.id)?.element.querySelector('label')?.textContent?.trim() === p.label))
    h.check('the title is "Tool start", OK says Insert, and the note is the review-pending text', state?.title === def.label && state.okLabel === ctx.t('templates.insertOk') && state.note === ctx.t('templates.reviewPending'), { title: state?.title, ok: state?.okLabel, note: state?.note })
    h.check('the live text is the golden (N110 G50 S2500 ... N140), continuing from N100', state?.preview === g.expected && !state.okDisabled, { preview: state?.preview, want: g.expected })
    // A refused value: the text is not shown, the field says why, OK is off.
    await typeInField(h, 'vc', '')
    state = formNow(h)
    h.check('an empty required value is refused: the field carries the message key, the preview says the values are refused, OK is disabled', state?.fields.get('vc')?.error === 'templates.value.required' && state.previewError !== '' && state.okDisabled, { field: state?.fields.get('vc')?.error, preview: state?.preview, error: state?.previewError, disabled: state?.okDisabled })
    await typeInField(h, 'smax', '12.5')
    state = formNow(h)
    h.check('a fraction in a whole-number field is refused and never corrected', state?.fields.get('smax')?.error === 'templates.value.notAnInteger' && state.fields.get('smax')?.value === '12.5' && state.okDisabled, { error: state?.fields.get('smax')?.error, value: state?.fields.get('smax')?.value })
    await typeInField(h, 'smax', '3000')
    await typeInField(h, 'vc', '180')
    state = formNow(h)
    const second = g.expected.replace('G50 S2500', 'G50 S3000').replace('G96 S220', 'G96 S180')
    h.check('with 3000 and 180 the live text has those values and nothing else changed', state?.preview === second && !state.okDisabled, { preview: state?.preview, want: second })
    await pressCancel(h)
    h.check('Cancel writes nothing', JSON.stringify(linesOf(h, id)) === JSON.stringify(LATHE_PROGRAM) && !ctx.docs.get(id)?.dirty, linesOf(h, id))

    // The insertion itself: golden defaults, then the changed values after it, block numbers carried on.
    await runFromInsertTab(h, 'tool-start')
    await waitForm(h)
    await pressOk(h)
    const want1 = inserted(LATHE_PROGRAM, 5, g.expected.split('\n'))
    h.check('OK inserts the golden after the cursor block N100 (N110-N140); the rest of the program is as it was', JSON.stringify(linesOf(h, id)) === JSON.stringify(want1), linesOf(h, id))
    h.check('the cursor stands at the end of the last inserted line', h.app.cursor().line === 9, h.app.cursor())
    await runFromInsertTab(h, 'tool-start')
    await waitForm(h)
    await typeInField(h, 'smax', '3000')
    await typeInField(h, 'vc', '180')
    await pressOk(h)
    const second2 = shiftNumbers(second, 40).split('\n')
    const want2 = inserted(want1, 9, second2)
    h.check('a second insertion continues the numbering from the block it follows (N150-N180) with the changed values', JSON.stringify(linesOf(h, id)) === JSON.stringify(want2), linesOf(h, id).slice(8))
    await undo(h)
    h.check('one Undo takes back the second insertion whole', JSON.stringify(linesOf(h, id)) === JSON.stringify(want1), linesOf(h, id).slice(8))
    await undo(h)
    h.check('the next Undo takes back the first, and the program is the one we started with', JSON.stringify(linesOf(h, id)) === JSON.stringify(LATHE_PROGRAM), linesOf(h, id))

    // G-code system B: the same button, the other text.
    await maker.add('Lathe system B', 'fanuc-lathe', 'calculator', { variants: { gcodeSystem: 'B' } })
    await maker.use('Lathe system B')
    await ctx.modal.whenReady(id)
    await revealLine(h, id, 5, 1)
    await runFromInsertTab(h, 'tool-start')
    await waitForm(h)
    state = formNow(h)
    h.check('under a system B machine the form is the lathe-b one and its text is the golden with G92 S', state?.preview === gB.expected && state.preview.includes('G92 S2500') && !state.preview.includes('G50'), state?.preview)
    h.check('and its fields are the same as the data of the override', formMatches(state, byId(latheB, 'tool-start')).ok, formMatches(state, byId(latheB, 'tool-start')).why)
    await pressOk(h)
    h.check('inserted: N110 G92 S2500 ... N140', JSON.stringify(linesOf(h, id)) === JSON.stringify(inserted(LATHE_PROGRAM, 5, gB.expected.split('\n'))), linesOf(h, id))
    await undo(h)
    await maker.none()
    await ctx.modal.whenReady(id)
    await revealLine(h, id, 5, 1)
    await runFromInsertTab(h, 'tool-start')
    await waitForm(h)
    h.check('with no machine (system A) the text is the golden with G50 S again', formState(h)?.preview === g.expected, formState(h)?.preview)
    await pressCancel(h)
  })

  // ============================================================ D. a formula
  await guard(h, 'D. a formula', async () => {
    const g = await golden(h, 'templates/fanuc/tapping')
    const id = await newDoc(h, MILL_PROGRAM.join('\n'), 'fanuc-gcode')
    await revealLine(h, id, 4, 1)
    const how = await runFromInsertTab(h, 'tapping')
    h.check('Rigid tapping is not on the toolbar: it is chosen from the group\'s "More Templates…" list', how === 'more')
    await waitForm(h)
    let state = formNow(h)
    const f = state?.fields.get('f')
    h.check('its feed is a calculated field: read-only, and it shows pitch x speed (1 x 1000)', f?.readOnly === true && Number(f.value) === 1000, { f: f && { value: f.value, readOnly: f.readOnly }, errors: state && [...state.fields].filter(([, x]) => x.error !== '').map(([k, x]) => `${k}: ${x.error}`), values: state?.values, previewError: state?.previewError })
    h.check('the live text is the golden of tapping (F1000.)', state?.preview === g.expected, { preview: state?.preview, want: g.expected })
    await typeInField(h, 'pitch', '1.5')
    await typeInField(h, 's', '800')
    state = formNow(h)
    h.check('pitch 1.5 and 800 rpm: the feed field shows 1200, still read-only', Number(state?.fields.get('f')?.value) === 1200 && state?.fields.get('f')?.readOnly === true, state?.fields.get('f'))
    const want = g.expected.replace('M29 S1000', 'M29 S800').replace('F1000.', 'F1200.')
    h.check('the live text follows: S800 and F1200.', state?.preview === want, { preview: state?.preview, want })
    await typeInField(h, 'pitch', '')
    state = formNow(h)
    h.check('without a pitch the form is refused and the feed is empty (no stale value)', state?.okDisabled === true && state.fields.get('pitch')?.error !== '' && state.fields.get('f')?.value === '', { pitch: state?.fields.get('pitch')?.error, f: state?.fields.get('f')?.value })
    await typeInField(h, 'pitch', '1.5')
    await pressOk(h)
    h.check('OK writes the computed feed after the cursor block (N110-N130)', JSON.stringify(linesOf(h, id)) === JSON.stringify(inserted(MILL_PROGRAM, 4, want.split('\n'))), linesOf(h, id))
  })

  // ============================================================ E. completion
  await guard(h, 'E. completion', async () => {
    const g = await golden(h, 'templates/fanuc-lathe/tool-start')
    const program = [...LATHE_PROGRAM.slice(0, 5), '']
    const id = await newDoc(h, program.join('\n'), 'fanuc-lathe')
    await ctx.modal.whenReady(id)
    await revealLine(h, id, 6, 1)
    h.check('the cursor is on the empty last line', h.app.cursor().line === 6, h.app.cursor())
    h.focusEditor()
    await h.idle()
    await h.nativeType('tool')
    const shown = await h.waitFor(() => suggestItems().some((i) => i.label === 'Tool start'), { timeout: 8000 })
    const items = suggestItems()
    h.check('typing "tool" on an empty line offers the templates whose name starts with it: Tool start and Tool end', !!shown && items.some((i) => i.label === 'Tool start') && items.some((i) => i.label === 'Tool end'), items.map((i) => i.text))
    const start = items.find((i) => i.label === 'Tool start')
    h.check('the item names its group: "Template: Tool change"', !!start && start.text.includes(ctx.t('templates.completionDetail', { group: byId(lathe, 'tool-start').group })), start?.text)
    // The list is the widget's own and goes away when the editor loses the keyboard for a moment (another app in
    // front); the keys that follow are only meaningful with it up, so it is asked for again, and counted.
    let reopened = 0
    const listUp = async () => {
      for (let i = 0; i < 3 && !(suggestShowing() && suggestItems().some((x) => x.label === 'Tool start')); i++) {
        reopened++
        await h.window.ensureFront()
        h.focusEditor()
        ctx.editor.triggerAction('editor.action.triggerSuggest')
        await h.waitFor(() => suggestShowing() && suggestItems().some((x) => x.label === 'Tool start'), { timeout: 3000 })
      }
      await h.idle({ quiet: 60 })
    }
    for (let i = 0; i < 6 && suggestItems().find((x) => x.focused)?.label !== 'Tool start'; i++) {
      await listUp()
      await h.nativeKeys([{ key: 'ArrowDown' }])
      await h.idle({ quiet: 60 })
    }
    await listUp()
    h.check('Tool start is the selected row', suggestItems().find((x) => x.focused)?.label === 'Tool start', { rows: suggestItems().map((x) => `${x.focused ? '*' : ''}${x.label}`), reopened })
    await h.nativeKeys([{ key: 'Tab' }])
    const opened = await waitForm(h)
    h.check('Tab accepts it: the Tool start form opens', opened !== null && formState(h)?.title === 'Tool start', formState(h)?.title)
    h.check('and the typed word is gone from the program', linesOf(h, id)[5] === '', linesOf(h, id)[5])
    h.check('the live text is the golden, numbered on from N100', formState(h)?.preview === g.expected, formState(h)?.preview)
    await pressOk(h)
    h.check('OK puts the template where the typed word was: it takes the blank line, nothing else moves', JSON.stringify(linesOf(h, id)) === JSON.stringify([...program.slice(0, 5), ...g.expected.split('\n')]), linesOf(h, id))
  })

  // ============================================================ F. stars
  await guard(h, 'F. stars', async () => {
    const id = await newDoc(h, LATHE_PROGRAM.join('\n'), 'fanuc-lathe')
    await revealLine(h, id, 5, 1)
    const dialect = ctx.templates.dialectOf(id) ?? ''
    h.check('the program\'s code set is fanuc-lathe', dialect === 'fanuc-lathe', dialect)
    ctx.templates.setFavorite(dialect, 'threading', true)
    ctx.templates.setFavorite(dialect, 'grooving', true)
    await ribbonTab(h, 'insert')
    await h.waitFor(() => templateBlocks(h)[0]?.key === 'favorites', { timeout: 5000 })
    let blocks = templateBlocks(h)
    h.check('the first block is Favorites and holds both starred templates as buttons, in the order they were starred', blocks[0]?.key === 'favorites' && blocks[0].caption === ctx.t('templates.favorites') && blocks[0].buttons.map((b) => b.id).join() === 'threading,grooving' && blocks[0].moreOptions.length === 0, blocks[0] && { key: blocks[0].key, caption: blocks[0].caption, ids: blocks[0].buttons.map((b) => b.id) })
    h.check('their labels are the data\'s and Grooving, which is not a toolbar template, is a button now', blocks[0]?.buttons.map((b) => b.label).join('|') === [byId(lathe, 'threading').label, byId(lathe, 'grooving').label].join('|'), blocks[0]?.buttons.map((b) => b.label))
    h.check('a starred template is not repeated in its own group: Threading is gone (its only template is starred), Turning keeps Roughing and finishing and no longer lists Grooving', !blocks.some((b) => b.key === 'Threading') && !!blocks.find((b) => b.key === 'Turning') && !blocks.find((b) => b.key === 'Turning')?.moreOptions.some((o) => o.id === 'grooving'), blocks.map((b) => `${b.key}: ${b.buttons.map((x) => x.id)} / ${b.moreOptions.map((x) => x.id)}`))
    const file = await h.waitFor(async () => {
      const state = /** @type {any} */ (await h.config.read('state.json'))
      const kept = state?.ui?.lastParams?.['templates:favorites']?.[dialect]
      return Array.isArray(kept) && kept.length === 2 ? kept : null
    }, { timeout: 8000 })
    h.check('the stars are kept in state.json, per code set', JSON.stringify(file) === JSON.stringify(['threading', 'grooving']), file)

    const running = ctx.commands.run('templates.insert')
    await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
    await h.idle()
    const rows = pickRows(h)
    h.check('Insert Template… in the palette lists the starred templates first, marked as favourites, then the groups', rows.length === ctx.templates.list(id).length && rows[0]?.label === byId(lathe, 'threading').label && rows[1]?.label === byId(lathe, 'grooving').label && rows[0].description.startsWith(ctx.t('templates.favorites')) && !rows[2].description.startsWith(ctx.t('templates.favorites')), rows.map((r) => `${r.label} (${r.description})`))
    h.check('and notes "not yet reviewed" under each', rows.every((r) => r.detail.includes(ctx.t('templates.reviewPendingShort'))), rows.map((r) => r.detail))
    await pickCancelled(h)
    await running

    // The starred button works like any other.
    h.click(templateBlocks(h)[0].buttons[0].element)
    await waitForm(h)
    h.check('the starred Threading button opens the Threading form', formState(h)?.title === byId(lathe, 'threading').label, formState(h)?.title)
    await pressCancel(h)

    ctx.templates.setFavorite(dialect, 'threading', false)
    ctx.templates.setFavorite(dialect, 'grooving', false)
    await h.waitFor(() => templateBlocks(h)[0]?.key !== 'favorites', { timeout: 5000 })
    blocks = templateBlocks(h)
    h.check('removing the stars puts the templates back into their groups and drops the Favorites block', blocks.every((b) => b.key !== 'favorites') && blocks.some((b) => b.key === 'Threading') && !!blocks.find((b) => b.key === 'Turning')?.moreOptions.some((o) => o.id === 'grooving'), blocks.map((b) => b.key))
  })

  // ============================================================ G. Klartext
  await guard(h, 'G. Klartext', async () => {
    const g = await golden(h, 'templates/heidenhain/drill')
    const id = await newDoc(h, KLARTEXT_PROGRAM.join('\n'), 'heidenhain-klartext')
    await ctx.modal.whenReady(id)
    await revealLine(h, id, 5, 1)
    await runFromInsertTab(h, 'drill')
    await waitForm(h)
    h.check('the cycle 200 form\'s text is the golden: blocks 5 and 6 after block 4', formState(h)?.preview === g.expected, { preview: formState(h)?.preview, want: g.expected })
    await pressOk(h)
    const block = g.expected.split('\n')
    const behind = ['7 L X+0 Y+0 R0 FMAX', '8 END PGM T1 MM']
    const want = [...KLARTEXT_PROGRAM.slice(0, 5), ...block, ...behind]
    h.check('inserted after block 4, and the two blocks behind it move up to 7 and 8 in the same edit', JSON.stringify(linesOf(h, id)) === JSON.stringify(want), linesOf(h, id).slice(4))
    await undo(h)
    h.check('one Undo takes back the template and the renumbering together', JSON.stringify(linesOf(h, id)) === JSON.stringify(KLARTEXT_PROGRAM), linesOf(h, id))
  })

  // ============================================================ H. a locked program
  await guard(h, 'H. locked', async () => {
    const id = await newDoc(h, LATHE_PROGRAM.join('\n'), 'fanuc-lathe')
    await revealLine(h, id, 5, 1)
    await ctx.commands.run('file.toggleReadOnly')
    await h.waitFor(() => ctx.docs.get(id)?.readOnly === true, { timeout: 5000 })
    await runFromInsertTab(h, 'tool-start')
    const want = ctx.t('readOnly.refusedUser', { name: ctx.docs.get(id)?.title ?? '', action: ctx.t('readOnly.insertTemplate', { template: byId(lathe, 'tool-start').label }) })
    const said = await h.waitFor(() => message(h) === want, { timeout: 5000 })
    h.check('Tool start on a locked program says why in plain words', !!said, { status: message(h), want })
    await h.idle()
    h.check('no form opens and the program is untouched', formDialog(h) === null && JSON.stringify(linesOf(h, id)) === JSON.stringify(LATHE_PROGRAM))
    await ctx.commands.run('file.toggleReadOnly')
    await h.waitFor(() => ctx.docs.get(id)?.readOnly === false, { timeout: 5000 })
  })

  // ============================================================ H2. a choice with no default (the review fixes)
  await guard(h, 'H2. Sinumerik Program start', async () => {
    const g = await golden(h, 'templates/sinumerik/program-start')
    const sinumerik = (await codeFile(h, 'sinumerik')).templates
    const setup = byId(sinumerik, 'program-start').params.find((/** @type {any} */ p) => p.id === 'setup')
    const program = ['', 'N10 G0 X0 Z0', 'M30']
    const id = await newDoc(h, program.join('\n'), 'sinumerik')
    await revealLine(h, id, 1, 1)
    await ribbonTab(h, 'insert')
    h.click(h.q('cmd-button', { command: 'insert.template:program-start' }))
    await waitForm(h)
    let state = formNow(h)
    h.check('the Machining choice of the shared Sinumerik Program start has no default: nothing is chosen, the field is marked, OK is off', setup.default === undefined && state.fields.get('setup')?.error !== '' && state.okDisabled && state.previewError !== '', { error: state.fields.get('setup')?.error, shown: state.fields.get('setup')?.value, ok: state.okDisabled })
    await typeInField(h, 'setup', setup.choices[0].label)
    state = formNow(h)
    h.check('after the turning line is picked the live text is the golden (G18 G90 G95 DIAMON) and OK is on', state.preview === g.expected && !state.okDisabled, { preview: state.preview, want: g.expected })
    await pressOk(h)
    h.check('OK replaces the blank first line and leaves the numbered blocks below', JSON.stringify(linesOf(h, id)) === JSON.stringify([...g.expected.split('\n'), ...program.slice(1)]), linesOf(h, id))
  })

  // ============================================================ I. the cost of live at 300,000 lines
  // The plan's known gap 8: the template form's `live` renders the template with the environment read from the
  // document on every change (the block number above the cursor, up to 2,000 lines up and 200 down), and the cycle
  // form's `live` re-reads the block and the modal state before it. Both are measured on the 10 MB program of
  // `m1-perf-open` with a G83 block in the middle, as the time from a real key press in a field to the frame that
  // shows the new live text.
  //
  // The budgets. Typing: the text of the live preview is part of what the user sees while typing, so a key must show
  // in it within a frame (`LIVE_P95_BUDGET_MS`, 17 ms, the allowance of m12-perf and p3-perf for what a feature may add
  // to typing; the Phase 1 rule of 50 ms is for the editor itself and is held by m3-perf and p3-perf). Measured here:
  // 1-5 ms, because the scan reads at most 2,200 lines and tokenizes a block number in each. The size is held to the
  // same frame on top of the same form in a small program (`LIVE_COST_BUDGET_MS`): more would mean the live text has
  // started to depend on the program's size. Opening: from the click to the form's first live text within
  // `OPEN_BUDGET_MS` (200 ms, the threshold of a visible freeze), the dialog mount included; the Insert (click on OK to
  // the text in the program) likewise within `INSERT_BUDGET_MS`. Section I2 holds the same two to the same budgets on a program that is numbered.
  await guard(h, 'I. 300,000 lines', async () => {
    const lines = splitLines(largeProgram())
    const MID = Math.floor(lines.length / 2)
    lines[MID - 1] = 'G98 G83 X20. Y60. Z-18. R3. Q4. F240.'
    const path = `${h.cfg.run}/p3-templates-300k.nc`
    await h.disk.write(path, lines.join('\r\n') + '\r\n')
    await h.dialogs.queue('open', path)
    const opened = await ctx.files.open()
    const id = opened[0] ?? ''
    const shown = await untilDom(() => h.q('editor-host')?.dataset.docId === id && drawn(h, '%'), 60000)
    h.check(`the ${lines.length}-line program is open and drawn as a Fanuc mill program`, shown !== null && ctx.docs.get(id)?.profileId === 'fanuc-gcode', ctx.docs.get(id)?.profileId)
    await h.waitFor(() => ctx.editor.getLineCount(id) >= lines.length, { timeout: 120000, interval: 50 })
    await ctx.outline.whenReady(id)
    await ctx.modal.whenReady(id)
    await h.idle({ timeout: 60000 })
    const AT = lines.length - 30

    /**
     * Types `count` keys into a field of the open form with real key presses and measures each one from the keydown
     * to the frame that shows a new live text.
     * @param {string} field
     * @param {number} count
     * @param {(i: number) => string} key
     * @param {boolean} [replace] select the field's text first
     */
    const typeInto = async (field, count, key, replace = false) => {
      const control = /** @type {HTMLInputElement} */ (h.q('form-field', { field })?.querySelector('input'))
      control.focus()
      if (replace) control.select()
      else control.setSelectionRange(control.value.length, control.value.length)
      /** @type {number[]} */
      const samples = []
      let previous = formState(h)?.preview ?? ''
      let downAt = 0
      const stamp = () => (downAt = performance.now())
      window.addEventListener('keydown', stamp, true)
      try {
        for (let i = 0; i < count; i++) {
          const before = previous
          const changed = untilDom(() => (formState(h)?.preview ?? '') !== before, 4000)
          await h.nativeKeys([{ key: key(i) }])
          const when = await changed
          if (when === null) break
          samples.push(when - downAt)
          previous = formState(h)?.preview ?? ''
        }
      } finally {
        window.removeEventListener('keydown', stamp, true)
      }
      return { count: samples.length, p95: Math.round(percentile(samples, 95)), worst: Math.round(Math.max(...samples)), samples: samples.map(Math.round) }
    }
    /** Clicks a button that opens a form and returns the time to its first live text. @param {HTMLElement} button */
    const openForm = async (button) => {
      const started = performance.now()
      h.click(button)
      const at = await untilDom(() => {
        const s = formState(h)
        return !!s && (s.preview !== '' || s.previewError !== '')
      }, 5000)
      await h.idle()
      return at === null ? -1 : at - started
    }
    const letter = (/** @type {number} */ i) => String.fromCharCode(97 + (i % 8))
    const digit = (/** @type {number} */ i) => String((i % 8) + 1)

    // 1. The template form (Tool change of the mill, text field "Tool description" appended to).
    await revealLine(h, id, AT, 1)
    await ribbonTab(h, 'insert')
    const tc = templateBlocks(h).flatMap((b) => b.buttons).find((b) => b.id === 'tool-change')
    if (!tc) throw new Error('no Tool change button')
    const formMs = await openForm(tc.element)
    h.check(`the template form opens at line ${AT} of ${lines.length} and shows its text (G43 ... H01), no block number in a program that has none`, (formState(h)?.preview ?? '').includes('G43 Z25. H01') && !/^N\d/m.test(formState(h)?.preview ?? ''), formState(h)?.preview)
    h.checkTime(`opening the template form at line ${AT}: click to its first live text`, formMs, OPEN_BUDGET_MS, { formMs }, { also: formMs > 0 })
    const typed = await typeInto('name', 24, letter)
    h.check('every keystroke of the 24 reached the preview', typed.count === 24, typed)
    h.checkTime(`typing in the template form at ${lines.length} lines: keydown to the new live text, p95`, typed.p95, LIVE_P95_BUDGET_MS, typed, { also: typed.count === 24 })

    // Insert: from the real click on OK to the text in the program and the form gone.
    const countBefore = ctx.editor.getLineCount(id)
    await h.window.ensureFront()
    const okButton = h.q('modal-ok')
    if (!okButton) throw new Error('no OK button')
    const clickedAt = performance.now()
    const landed = untilDom(() => formDialog(h) === null && ctx.editor.getLineCount(id) > countBefore, 8000)
    await h.nativeClick(okButton)
    const doneAt = await landed
    const insertMs = doneAt === null ? -1 : doneAt - clickedAt
    h.check(`OK inserted the three lines of Tool change after line ${AT} of ${lines.length}`, doneAt !== null && ctx.editor.getLineCount(id) === countBefore + 3, { before: countBefore, after: ctx.editor.getLineCount(id) })
    h.checkTime(`inserting a template at line ${AT}: click on OK to the text in the program (the real click's own delivery included)`, insertMs, INSERT_BUDGET_MS, { insertMs }, { also: insertMs > 0 })
    await undo(h)
    h.check('and one Undo takes it back', ctx.editor.getLineCount(id) === countBefore, ctx.editor.getLineCount(id))

    // The same form in a small program: what the size costs.
    const small = await newDoc(h, MILL_PROGRAM.join('\n'), 'fanuc-gcode')
    await revealLine(h, small, 4, 1)
    await runFromInsertTab(h, 'tool-change')
    await waitForm(h)
    const base = await typeInto('name', 24, letter)
    await pressCancel(h)
    h.log(`template form: p95 ${typed.p95} ms (worst ${typed.worst}) at ${lines.length} lines, ${base.p95} ms (worst ${base.worst}) in a small program`)
    h.checkTime(`and the size adds at most a frame to the template form's live text: p95 ${typed.p95} ms against ${base.p95} ms in a ${MILL_PROGRAM.length}-line program`, typed.p95 - base.p95, LIVE_COST_BUDGET_MS, { large: typed, small: base }, { also: base.count === 24 })

    // 2. The cycle form: Edit Cycle on the G83 in the middle; `live` re-reads the block and the state before it.
    ctx.editor.reveal(id, MID, 1)
    await h.idle()
    await ribbonTab(h, 'insert')
    const edit = h.q('cmd-button', { command: 'nc.editCycle' })
    if (!edit) throw new Error('no Edit Cycle button')
    const cycleMs = await openForm(edit)
    h.check(`Edit Cycle at line ${MID} of ${lines.length} reads the block: the form is the G83 form with the block's Q and F`, formState(h)?.title.startsWith('G83:') === true && formState(h)?.values.Q === '4.' && formState(h)?.values.F === '240.', formState(h)?.values)
    h.checkTime(`opening Edit Cycle at line ${MID}: click to the form with the block's live text (the state before the block comes from the modal index)`, cycleMs, OPEN_BUDGET_MS, { cycleMs }, { also: cycleMs > 0 })
    const cyc = await typeInto('F', 8, digit, true)
    h.check('every keystroke of the 8 reached the cycle form\'s live text', cyc.count === 8, cyc)
    await pressCancel(h)
    h.checkTime(`typing in the cycle form at ${lines.length} lines: keydown to the new live text, p95`, cyc.p95, LIVE_P95_BUDGET_MS, cyc, { also: cyc.count === 8 })
    h.log(`cycle form: open ${Math.round(cycleMs)} ms, p95 ${cyc.p95} ms (worst ${cyc.worst}); template form: open ${Math.round(formMs)} ms`)
  })

  // ============================================================ I2. the same program with a block number on every line
  // The scan of the program's block numbers (P3b fix H, plan §7 #287): the tool change writes {{N}}, so in a numbered
  // program the form needs the numbers the program uses and the Insert checks them again. The program is the one of
  // section I with `N1`, `N2`, ... in front of every block after the first two lines (restarting at N1 after N99000).
  await guard(h, 'I2. 300,000 numbered lines', async () => {
    const lines = splitLines(largeProgram()).map((line, i) => (i < 2 || line === '%' || line === '' ? line : `N${((i - 2) % 99000) + 1} ${line}`))
    const path = `${h.cfg.run}/p3-templates-300k-numbered.nc`
    await h.disk.write(path, lines.join('\r\n') + '\r\n')
    await h.dialogs.queue('open', path)
    const opened = await ctx.files.open()
    const id = opened[0] ?? ''
    const shown = await untilDom(() => h.q('editor-host')?.dataset.docId === id && drawn(h, '%'), 60000)
    h.check(`the numbered ${lines.length}-line program is open and drawn as a Fanuc mill program`, shown !== null && ctx.docs.get(id)?.profileId === 'fanuc-gcode', ctx.docs.get(id)?.profileId)
    await h.waitFor(() => ctx.editor.getLineCount(id) >= lines.length, { timeout: 120000, interval: 50 })
    await ctx.outline.whenReady(id)
    await ctx.modal.whenReady(id)
    await h.idle({ timeout: 60000 })
    const AT = lines.length - 30
    const prev = Number(/^N(\d+)/.exec(lines[AT - 1])?.[1])
    await revealLine(h, id, AT, 1)
    await ribbonTab(h, 'insert')
    const tc = templateBlocks(h).flatMap((b) => b.buttons).find((b) => b.id === 'tool-change')
    if (!tc) throw new Error('no Tool change button')
    const started = performance.now()
    h.click(tc.element)
    const at = await untilDom(() => {
      const state = formState(h)
      return !!state && (state.preview !== '' || state.previewError !== '')
    }, 5000)
    await h.idle()
    const formMs = at === null ? -1 : at - started
    h.check(`the template form opens at line ${AT} of the numbered program and its text continues the numbers: N${prev + 10}`, (formState(h)?.preview ?? '').startsWith(`N${prev + 10} `) && (formState(h)?.preview ?? '').includes('G43 Z25. H01'), formState(h)?.preview)
    h.checkTime(`opening the template form at line ${AT} of the numbered program: click to its first live text`, formMs, OPEN_BUDGET_MS, { formMs }, { also: formMs > 0 })
    const countBefore = ctx.editor.getLineCount(id)
    await h.window.ensureFront()
    const okButton = h.q('modal-ok')
    if (!okButton) throw new Error('no OK button')
    const clickedAt = performance.now()
    const landed = untilDom(() => formDialog(h) === null && ctx.editor.getLineCount(id) > countBefore, 8000)
    await h.nativeClick(okButton)
    const doneAt = await landed
    const insertMs = doneAt === null ? -1 : doneAt - clickedAt
    h.check(`OK inserted the three lines of Tool change after line ${AT} of the numbered program`, doneAt !== null && ctx.editor.getLineCount(id) === countBefore + 3 && ctx.editor.getLines(id, AT + 1, AT + 1)[0]?.startsWith(`N${prev + 10} `) === true, { before: countBefore, after: ctx.editor.getLineCount(id), line: ctx.editor.getLines(id, AT + 1, AT + 1)[0] })
    h.checkTime(`inserting a template at line ${AT} of the numbered program: click on OK to the text in the program (the real click's own delivery included)`, insertMs, INSERT_BUDGET_MS, { insertMs }, { also: insertMs > 0 })
    await undo(h)
    h.check('and one Undo takes it back', ctx.editor.getLineCount(id) === countBefore, ctx.editor.getLineCount(id))
    h.log(`numbered program: template form open ${Math.round(formMs)} ms, Insert ${Math.round(insertMs)} ms at ${lines.length} lines`)
  })

  h.check('every OK and Cancel of a dialog was a real mouse click', clicks.dom === 0 && clicks.real > 0, clicks)
})
