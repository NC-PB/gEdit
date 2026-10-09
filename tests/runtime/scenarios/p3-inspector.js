// The code inspector (Phase 3 plan H3a `p3-inspector`; X7 and the inspector half of X11 (c)):
//
//   A. Opening. The panel is not there at the start; the View tab offers Code Inspector and Motion Colors;
//      `Mod+Alt+A` (a real key press) shows it in the left region next to the Program Map, and a second press
//      takes it away again.
//   B. X7, the state. At every golden line of `l01-turning-a.nc` (the lines of
//      `tests/fixtures/modal/fanuc-lathe/turning-a.json`), with the cursor on that line, the panel's "in force
//      after this block" rows say what the golden says: the feed unit (G99), the speed unit (G97/G96), the tool,
//      the active cycle, the speed clamp, the plane, the units and the diameter mode, each assumed value marked
//      as assumed with where it comes from. The source line of a few values and the "set here" marks are pinned
//      by hand, from the program's own lines.
//   C. Edit a value. A real double click on the row of `F0.12` opens the prompt; typing 0.15 and OK rewrites
//      only that word, in the number style around it (`Z3` becomes `Z3.` where the line writes `Z2.`); one Undo
//      puts everything back and leaves the document clean; Enter on a row opens the prompt as well.
//   D. Refusals. A code row says why it cannot be edited and opens nothing; a typed value that is not a number
//      is refused in the prompt with its message key and OK stays disabled; a tool word refuses 1.5; Esc leaves
//      the line as it was with nothing to undo.
//   E. X11 (c), the inspector half, on `PROBE_X50.NC`:
//        - no machine: `X50` lists every reading, the assumed default first, and cannot be edited ("choose a
//          machine"); `Z1000` is refused the same way; `X50.` and `Z10.` are editable;
//        - "Lathe IS-B": the row of `X50` says 0.05 mm (0.050), and `0.0505` is refused with
//          `machines.numbers.rounded`, `0.051` becomes `X51`, with one undo;
//        - "Lathe calc": the row says 50 mm.

import { scenario } from '../lib/index.js'
import { machineMaker } from './m10-common.js'
import { message, ready, ribbonTab } from './m4-common.js'
import { undo } from './m5-common.js'
import { openFixture } from './m3-common.js'
import { openProbe } from './m9-common.js'
import { context, inspectLine, inspectorPanel, L01, openEdit, opened, plain, showInspector, stateRows, typeInPrompt, wordRow } from './p3-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The model group (the golden's name) behind each state row of the panel. */
const ROW_OF_GROUP = { feedmode: 'feed', spindlemode: 'speed', plane: 'plane', motion: 'motion', distance: 'distance', offset: 'workOffset', coolant: 'coolant', diametermode: 'diameter', cycle: 'cycle', units: 'units' }

/** What a golden value says: `=G99@machine` -> `{ code: 'G99', assumed: true, from: 'machine' }`. @param {string} text */
function golden(text) {
  const assumed = text.startsWith('=')
  const [code, from] = (assumed ? text.slice(1) : text).split('@')
  return { code, assumed, from: from ?? '' }
}

/**
 * Compares the panel's state rows with one golden claim (`after`), key by key. Only the keys the golden lists
 * are compared (a golden says what it is about). Returns the differences.
 * @param {any} after
 * @param {Map<string, import('./p3-common.js').StateRow>} rows
 * @param {Element[]} cycles
 */
function differences(after, rows, cycles) {
  /** @type {string[]} */
  const out = []
  const want = (/** @type {string} */ what, /** @type {unknown} */ ok, /** @type {unknown} */ got) => {
    if (!ok) out.push(`${what}: ${JSON.stringify(got)}`)
  }
  for (const [group, value] of Object.entries(after.groups ?? {})) {
    const key = /** @type {Record<string, string>} */ (ROW_OF_GROUP)[group] ?? `group:${group}`
    const row = rows.get(key)
    const g = golden(String(value))
    want(`group ${group} -> row ${key} starts with ${g.code}`, !!row && row.value.startsWith(g.code), row)
    want(`group ${group} is ${g.assumed ? 'assumed' : 'set by the program'}`, !!row && row.assumed === g.assumed, row)
    if (g.assumed && g.from) want(`group ${group} is assumed from ${g.from}`, !!row && row.from === g.from, row)
    // An assumed value has no source line: it is the power-on state.
    if (g.assumed) want(`group ${group} has no source line`, !!row && row.line === 0, row)
    else want(`group ${group} has a source line`, !!row && row.line > 0, row)
  }
  // The units: the group's code (G21) or the derived word, mm; assumed values are marked.
  if (after.units !== undefined) {
    const g = golden(String(after.units))
    const row = rows.get('units')
    want(`units ${g.code}`, !!row && [g.code, g.code === 'mm' ? 'G21' : 'G20'].includes(row.value) && row.assumed === g.assumed, row)
  }
  if (after.diameter !== undefined) {
    const g = golden(String(after.diameter))
    const row = rows.get('diameter')
    want(`diameter ${g.code}`, !!row && row.value === g.code && row.assumed === g.assumed, row)
  }
  if (after.distance !== undefined) want(`distance ${after.distance}`, rows.get('distance')?.value === after.distance, rows.get('distance'))
  // The unit of the feed and of the speed are the group's code on this control: G99 per revolution, G97 rpm.
  if (after.feedUnit !== undefined) want(`feed unit ${after.feedUnit}`, rows.get('feed')?.value.startsWith(/** @type {Record<string, string>} */ ({ 'per-rev': 'G99', 'per-min': 'G98' })[after.feedUnit] ?? '?'), rows.get('feed'))
  if (after.speedUnit !== undefined) want(`speed unit ${after.speedUnit}`, rows.get('speed')?.value.startsWith(/** @type {Record<string, string>} */ ({ rpm: 'G97', surface: 'G96' })[after.speedUnit] ?? '?'), rows.get('speed'))
  if (after.plane !== undefined) want(`plane ${after.plane}`, rows.get('plane')?.value === /** @type {Record<string, string>} */ ({ ZX: 'G18', XY: 'G17', YZ: 'G19' })[after.plane], rows.get('plane'))
  if ('tool' in after) {
    const row = rows.get('tool')
    if (after.tool === null) want('no tool yet', row === undefined, row)
    else want(`tool station ${after.tool}`, !!row && row.value.replace(/^T/i, '').startsWith(after.tool), row)
  }
  if ('speed' in after) {
    const row = rows.get('speed')
    if (after.speed === null) want('no speed written yet', !!row && !/S\d/.test(row.value), row)
    else want(`speed S${after.speed}`, !!row && row.value.endsWith(`S${after.speed}`), row)
  }
  if ('feed' in after) {
    const row = rows.get('feed')
    if (after.feed === null) want('no feed written yet', !!row && !/F\d/.test(row.value), row)
    else want(`feed F${after.feed}`, !!row && row.value.endsWith(`F${after.feed}`), row)
  }
  if ('speedLimit' in after) {
    const row = rows.get('speedLimit')
    if (after.speedLimit === null) want('no speed clamp', row === undefined, row)
    else want(`speed clamp ${after.speedLimit}`, row?.value === after.speedLimit, row)
  }
  if ('activeCycle' in after) {
    const row = rows.get('cycle')
    // A cancelled cycle may still show its cancel code (G80) as the group's value; no cycle in force is not a code.
    if (after.activeCycle === null) want('no cycle in force', row === undefined || row.value === 'G80', row)
    else if (rows.get('motion')?.value === after.activeCycle) {
      // A threading move that is the golden's active cycle (G92, G32 of system A) is a motion code: the panel shows it
      // as the motion in force and gives it no cycle row (review fix NC-13, on purpose).
      want(`${after.activeCycle} in force as the motion, with no cycle row`, row === undefined || row.value !== after.activeCycle, row)
    } else want(`cycle ${after.activeCycle} in force`, row?.value === after.activeCycle, row)
  }
  // The cycle the block runs is the cycle section of the panel.
  if (after.block && typeof after.block.cycle === 'string') {
    const codes = cycles.map((c) => /** @type {HTMLElement} */ (c).dataset.code)
    want(`the block runs ${after.block.cycle}`, codes.includes(after.block.cycle), codes)
  }
  return out
}

scenario('p3-inspector', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // ============================================================ A. opening
  h.check('the inspector is not open at the start: the left region shows the program map', !inspectorPanel(h) && !!h.q('panel', { region: 'left', panel: 'programMap' }), h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`))
  await ribbonTab(h, 'view')
  h.check('the View tab offers Code Inspector and Motion Colors', !!h.q('cmd-button', { command: 'view.toggleInspector' }) && !!h.q('cmd-button', { command: 'view.toggleMotionColors' }), h.qa('cmd-button').map((e) => e.dataset.command))
  await ribbonTab(h, 'home')

  const { id } = await openFixture(h, L01)
  h.check('l01-turning-a.nc opens as a Fanuc lathe program', ctx.docs.get(id)?.profileId === 'fanuc-lathe', ctx.docs.get(id)?.profileId)
  await ctx.modal.whenReady(id)
  h.focusEditor()
  await h.nativeKeys([{ key: 'a', mods: ['cmd', 'alt'] }])
  await h.waitFor(() => inspectorPanel(h), { timeout: 5000 })
  h.check('Mod+Alt+A shows the inspector in the left region', !!inspectorPanel(h) && !!h.q('inspector-panel'), h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`))
  await h.nativeKeys([{ key: 'a', mods: ['cmd', 'alt'] }])
  await h.waitFor(() => !inspectorPanel(h), { timeout: 5000 })
  h.check('a second Mod+Alt+A takes it away again and the Program Map is back', !inspectorPanel(h) && !!h.q('panel', { region: 'left', panel: 'programMap' }) && !h.q('inspector-panel'), h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`))
  await ribbonTab(h, 'view')
  h.click(h.q('cmd-button', { command: 'view.toggleInspector' }))
  await h.waitFor(() => inspectorPanel(h), { timeout: 5000 })
  h.check('the View tab button shows it too', !!inspectorPanel(h) && !!h.q('inspector-panel'))
  await ribbonTab(h, 'home')

  // ============================================================ B. X7: the state at every golden line
  const goldenPath = await h.fixture('modal/fanuc-lathe/turning-a.json')
  const gold = JSON.parse(await h.disk.read(goldenPath))
  h.check('the golden has the lines the claim is made on', Array.isArray(gold.states) && gold.states.length >= 15, gold.states?.length)
  let compared = 0
  for (const state of gold.states) {
    const there = await inspectLine(h, id, state.line)
    const rows = stateRows(h)
    const diffs = differences(state.after, rows, h.qa('inspector-cycle'))
    h.check(`line ${state.line}: the inspector's modal state is the golden's`, there && diffs.length === 0, { diffs, rows: [...rows.values()].map((r) => `${r.key}=${r.value}@${r.line}${r.assumed ? ' assumed:' + r.from : ''}`) })
    compared++
  }
  h.check('every golden line was compared', compared === gold.states.length, compared)

  // Source lines and the "set here" marks, from the program's own lines (the golden does not carry them).
  await inspectLine(h, id, 11)
  let rows = stateRows(h)
  h.check('line 11 (G50 S2500): the speed clamp is 2500, set on line 11, and it is the only value set here', rows.get('speedLimit')?.value === '2500' && rows.get('speedLimit')?.line === 11 && [...rows.values()].filter((r) => r.setHere).map((r) => r.key).join() === 'speedLimit', [...rows.values()])
  await inspectLine(h, id, 12)
  rows = stateRows(h)
  h.check('line 12 (G96 S220 M03): the speed is G96 S220 from line 12, the clamp still comes from line 11, the tool from line 10', rows.get('speed')?.line === 12 && rows.get('speed')?.setHere === true && rows.get('speedLimit')?.line === 11 && rows.get('speedLimit')?.setHere === false && rows.get('tool')?.line === 10, [...rows.values()])
  h.check('and the power-on rows say so: the plane is assumed from the profile', rows.get('plane')?.assumed === true && rows.get('plane')?.from === 'profile' && rows.get('plane')?.line === 0, rows.get('plane'))
  await inspectLine(h, id, 38)
  rows = stateRows(h)
  // G92 of system A is a threading move (a motion-group code): the motion row says G92 from line 35, and the panel has no
  // cycle row for it (review fix NC-13: a threading move in force is no canned cycle).
  h.check('line 38 (a pass of the modal G92): the motion in force is G92 from line 35, not set here, and there is no cycle row', rows.get('motion')?.value === 'G92' && rows.get('motion')?.line === 35 && rows.get('motion')?.setHere === false && rows.get('cycle')?.value !== 'G92', [rows.get('motion'), rows.get('cycle')])
  await inspectLine(h, id, 59)
  rows = stateRows(h)
  h.check('line 59 (M30): the tool is the last one called, from line 47', rows.get('tool')?.line === 47 && rows.get('tool')?.value.includes('0505'), rows.get('tool'))

  // The words of a block: what the row says is the golden's reading of the cycle (X7 names the lead).
  await inspectLine(h, id, 33)
  const lead = wordRow(h, 'F', 33)
  h.check('line 33 (the second block of G76): F is a cycle parameter with the value 1.5, and its note names the thread lead', !!lead && lead.kind === 'cycleParam' && lead.value === '1.5' && /lead/i.test(lead.text), lead?.text)
  h.check('and the cycle section says G76 runs, block 2 of 2', h.qa('inspector-cycle').some((c) => c.dataset.code === 'G76' && c.dataset.role === 'runs' && plain(c.textContent).includes(ctx.t('inspector.cycle.part', { index: 2, of: 2 }))), h.qa('inspector-cycle').map((c) => plain(c.textContent).slice(0, 60)))

  // ============================================================ C. edit a value
  const original = ctx.editor.getText(id)
  await inspectLine(h, id, 18)
  const f = wordRow(h, 'F', 18)
  h.check('line 18 (N110 G01 Z0. F0.12): the F row is editable and holds 0.12', !!f && f.editable && f.value === '0.12', f?.text)
  const dirtyBefore = ctx.docs.get(id)?.dirty === true
  const input = f ? await openEdit(h, f.element, 'doubleClick') : null
  h.check('a real double click on the row opens the prompt, which holds the effective value', !!input && input.value === '0.12' && input.dataset.address === 'F' && !!h.q('modal', { modal: 'inspector-edit' }) && opened.how === 'real', { value: input?.value, how: opened.how })
  // CODE-10 (a real window only): the prompt opens with the value selected and the field focused, so typing replaces it.
  h.check('the prompt opens with its whole value selected and the field focused', !!input && document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length && input.value.length > 0, input && { active: document.activeElement === input, from: input.selectionStart, to: input.selectionEnd, length: input.value.length })
  if (input) {
    await typeInPrompt(h, '0.15')
    h.check('typing 0.15: no error, OK is enabled', input.value === '0.15' && input.dataset.error === undefined && h.q('modal-ok')?.hasAttribute('disabled') === false, { value: input.value, error: input.dataset.error })
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal', { modal: 'inspector-edit' }), { timeout: 5000 })
    await h.idle()
  }
  const lines = ctx.editor.getText(id).split('\n')
  const originalLines = original.split('\n')
  h.check('only that word changed: F0.12 is F0.15 and every other line is as it was', lines[17] === 'N110 G01 Z0. F0.15' && lines.every((line, i) => i === 17 || line === originalLines[i]), lines[17])
  h.check('the status bar says what changed', /F0\.12/.test(message(h)) && /F0\.15/.test(message(h)), message(h))
  await undo(h)
  h.check('one Undo puts the program back exactly and the document is clean again', ctx.editor.getText(id) === original && ctx.docs.get(id)?.dirty === dirtyBefore, { dirty: ctx.docs.get(id)?.dirty })

  // The number style around the word is kept: `Z2.` is written with a point, so the typed 3 becomes Z3.
  await inspectLine(h, id, 14)
  const z = wordRow(h, 'Z', 14)
  const zInput = z ? await openEdit(h, z.element, 'enter') : null
  h.check('Enter on the Z row of G00 X32. Z2. opens the prompt too', !!zInput && zInput.dataset.address === 'Z', zInput?.dataset.address)
  if (zInput) {
    await typeInPrompt(h, '3')
    await h.nativeKeys([{ key: 'Enter' }])
    await h.waitFor(() => !h.q('modal', { modal: 'inspector-edit' }), { timeout: 5000 })
    await h.idle()
  }
  h.check('Z2. typed over with 3 is written Z3., in the style of the line, and nothing else changed', ctx.editor.getText(id).split('\n')[13] === 'G00 X32. Z3.' && ctx.editor.getText(id).split('\n').filter((line, i) => line !== originalLines[i]).length === 1, ctx.editor.getText(id).split('\n')[13])
  await undo(h)
  h.check('one Undo again restores the program', ctx.editor.getText(id) === original, ctx.editor.getText(id).split('\n')[13])

  // CODE-10 (a real window only): an edit that changes the width of the word keeps the row and the focus on it (the row key is the
  // line and the start of the word, not its end).
  await inspectLine(h, id, 14)
  const zWide = wordRow(h, 'Z', 14)
  const zWideInput = zWide ? await openEdit(h, zWide.element, 'enter') : null
  if (zWideInput) {
    await typeInPrompt(h, '12')
    await h.nativeKeys([{ key: 'Enter' }])
    await h.waitFor(() => !h.q('modal', { modal: 'inspector-edit' }), { timeout: 5000 })
    await h.idle()
  }
  const zAfter = wordRow(h, 'Z', 14)
  const focused = /** @type {HTMLElement | null} */ (document.activeElement)
  h.check('Z2. typed over with 12 (a wider word) is written Z12., and the focus is still on the Z row of the panel', ctx.editor.getText(id).split('\n')[13] === 'G00 X32. Z12.' && !!zAfter && !!focused && focused.isConnected && focused.dataset.testid === 'inspector-row' && focused.dataset.address === 'Z', { line: ctx.editor.getText(id).split('\n')[13], focus: focused && `${focused.tagName}[${focused.dataset.testid}] ${focused.dataset.address}`, kept: zAfter?.element === focused })
  await undo(h)
  h.check('and one Undo restores the program', ctx.editor.getText(id) === original, ctx.editor.getText(id).split('\n')[13])

  // ============================================================ D. refusals
  await inspectLine(h, id, 16)
  const g71 = wordRow(h, 'G', 16)
  h.check('the G71 row cannot be edited, and its tooltip says why', !!g71 && !g71.editable && (g71.element.getAttribute('title') ?? '') === ctx.t('inspector.why.code'), g71?.element.getAttribute('title'))
  if (g71) {
    /** @type {HTMLElement} */ (g71.element).focus()
    await h.nativeKeys([{ key: 'Enter' }])
    await h.idle()
  }
  h.check('Enter on it opens no prompt and the status bar says why', !h.q('modal', { modal: 'inspector-edit' }) && message(h) === ctx.t('inspector.why.code'), message(h))

  await inspectLine(h, id, 18)
  const f2 = wordRow(h, 'F', 18)
  const prompt2 = f2 ? await openEdit(h, f2.element, 'doubleClick') : null
  if (prompt2) {
    await typeInPrompt(h, 'abc')
    h.check('a word that is not a number is refused in the prompt with the message key, and OK is disabled', prompt2.dataset.error === 'inspector.why.notANumber' && h.q('modal-ok')?.hasAttribute('disabled') === true, prompt2.dataset.error)
    await typeInPrompt(h, '0.2')
    h.check('typing a number clears the refusal', prompt2.dataset.error === undefined && h.q('modal-ok')?.hasAttribute('disabled') === false, prompt2.dataset.error)
    await typeInPrompt(h, '0.3')
    await h.nativeKeys([{ key: 'Escape' }])
    await h.waitFor(() => !h.q('modal', { modal: 'inspector-edit' }), { timeout: 5000 })
    await h.idle()
  }
  h.check('Esc closes the prompt and writes nothing: the program is as it was and the document is clean', ctx.editor.getText(id) === original && ctx.docs.get(id)?.dirty === dirtyBefore, ctx.editor.getText(id).split('\n')[17])
  await undo(h)
  h.check('and there is nothing to undo (the text is unchanged)', ctx.editor.getText(id) === original)

  await inspectLine(h, id, 10)
  const tool = wordRow(h, 'T', 10)
  const toolPrompt = tool ? await openEdit(h, tool.element, 'doubleClick') : null
  if (toolPrompt) {
    await typeInPrompt(h, '1.5')
    h.check('the tool word takes a whole number: 1.5 is refused with its message key', toolPrompt.dataset.error === 'inspector.why.wholeNumber', toolPrompt.dataset.error)
    await h.nativeKeys([{ key: 'Escape' }])
    await h.waitFor(() => !h.q('modal', { modal: 'inspector-edit' }), { timeout: 5000 })
  } else h.check('the T row opens a prompt', false, tool?.text)

  // ============================================================ E. X11 (c), the inspector half
  const probe = await openProbe(h, 'PROBE_X50.NC', ['G21 G99', 'G00 X50 Z1000', 'G00 X50. Z10.', 'M30', ''].join('\n'), 'fanuc-lathe')
  const maker = machineMaker(h)
  await maker.add('Lathe IS-B', 'fanuc-lathe', 'is-b')
  await maker.add('Lathe calc', 'fanuc-lathe', 'calculator')
  await maker.none()
  await ctx.modal.whenReady(probe.id)
  await showInspector(h)
  const probeText = ctx.editor.getText(probe.id)

  await inspectLine(h, probe.id, 2)
  const x50 = wordRow(h, 'X', 2, 'X50')
  h.check('no machine: the row of X50 lists three readings and cannot be edited', !!x50 && x50.readings === 3 && !x50.editable && x50.value === '', x50 && { readings: x50.readings, editable: x50.editable, value: x50.value })
  h.check('the assumed default comes first: 50 mm as written (the profile default), then 0.05 mm (IS-B) and 0.005 mm (IS-C)', !!x50 && x50.readingLines.length === 3 && /: 50 mm$/.test(x50.readingLines[0]) && /^Increments of 0\.001 mm \(IS-B\).*: 0\.05 mm$/.test(x50.readingLines[1]) && /^Increments of 0\.0001 mm \(IS-C\).*: 0\.005 mm$/.test(x50.readingLines[2]), x50?.readingLines)
  h.check('and the heading of the list says the value depends on the machine', !!x50 && x50.text.includes(ctx.t('inspector.panel.readingsHeading')), x50?.text)
  const z1000 = wordRow(h, 'Z', 2, 'Z1000')
  h.check('Z1000 is refused for the same reason: not editable, its tooltip says choose a machine', !!z1000 && !z1000.editable && z1000.element.getAttribute('title') === ctx.t('inspector.why.needsMachine'), z1000?.element.getAttribute('title'))
  if (z1000) {
    /** @type {HTMLElement} */ (z1000.element).focus()
    await h.nativeKeys([{ key: 'Enter' }])
    await h.idle()
  }
  h.check('Enter on it opens no prompt; the status bar gives the reason', !h.q('modal', { modal: 'inspector-edit' }) && message(h) === ctx.t('inspector.why.needsMachine'), message(h))
  await inspectLine(h, probe.id, 3)
  const x50p = wordRow(h, 'X', 3, 'X50.')
  const z10 = wordRow(h, 'Z', 3, 'Z10.')
  h.check('X50. and Z10. (with a point) are editable under no machine', !!x50p && x50p.editable && x50p.value === '50' && !!z10 && z10.editable && z10.value === '10', [x50p?.text, z10?.text])

  await maker.use('Lathe IS-B')
  await ctx.modal.whenReady(probe.id)
  await inspectLine(h, probe.id, 2)
  const isb = wordRow(h, 'X', 2, 'X50')
  h.check('Lathe IS-B: the row of X50 says 0.05 mm (0.050) and names the rule and the machine', !!isb && isb.editable && Number(isb.value) === 0.05 && /0\.05\d* mm/.test(isb.text) && isb.notes.some((n) => /0\.001/.test(n)) && isb.notes.some((n) => n.includes('Lathe IS-B')), isb && { value: isb.value, notes: isb.notes, text: isb.text })
  const prompt3 = isb ? await openEdit(h, isb.element, 'doubleClick') : null
  if (prompt3) {
    await typeInPrompt(h, '0.0505')
    h.check('0.0505 into a point-less IS-B word is refused (machines.numbers.rounded) and OK is disabled', prompt3.dataset.error === 'machines.numbers.rounded' && h.q('modal-ok')?.hasAttribute('disabled') === true, prompt3.dataset.error)
    await typeInPrompt(h, '0.051')
    h.check('0.051 is accepted', prompt3.dataset.error === undefined && h.q('modal-ok')?.hasAttribute('disabled') === false, prompt3.dataset.error)
    await h.nativeKeys([{ key: 'Enter' }])
    await h.waitFor(() => !h.q('modal', { modal: 'inspector-edit' }), { timeout: 5000 })
    await h.idle()
  } else h.check('the X50 row opens a prompt under IS-B', false, isb?.text)
  h.check('0.051 became X51 (not X51. and nothing else changed)', ctx.editor.getText(probe.id).split('\n')[1] === 'G00 X51 Z1000' && ctx.editor.getText(probe.id).split('\n').filter((line, i) => line !== probeText.split('\n')[i]).length === 1, ctx.editor.getText(probe.id).split('\n')[1])
  await undo(h)
  h.check('one Undo restores X50', ctx.editor.getText(probe.id) === probeText, ctx.editor.getText(probe.id).split('\n')[1])

  await maker.use('Lathe calc')
  await ctx.modal.whenReady(probe.id)
  await inspectLine(h, probe.id, 2)
  const calc = wordRow(h, 'X', 2, 'X50')
  h.check('Lathe calc: the row of X50 says 50 mm and is editable', !!calc && calc.editable && Number(calc.value) === 50 && /50 mm/.test(calc.text), calc?.text)
  await maker.none()
})
