// The template manager and "New Template from Selection" (Phase 3 plan H3b `p3-template-manager`; X18 c): the user's own
// templates, made in a dialog, kept in `<config>/codes/<code set>.json`, shown on the Insert tab and in completion.
//
//   A. Open it from the Insert tab ("Manage Templates…") on a Fanuc lathe program. It manages the program's code set
//      (`fanuc-lathe`), the file does not exist yet, the built-in rows are the data's templates, every one read-only
//      and marked "Review pending", with the two notes, a locked body and parameters, and no Delete.
//   B. Add a template of your own: a name typed with real keys, an id, a group, a parameter (its id renamed after the
//      placeholder was used, which rewrites the text), the text with {{N}} and the placeholder, the "button on the
//      Insert tab" box. Save writes the file; the file holds exactly what was entered; the row stays selected; the
//      Insert tab has the button in the new group; the template inserts through its form with the program's block
//      numbers; completion offers it by its name.
//   C. Stars are one list: a star set in the manager is a Favorites button on the Insert tab, and a star set in the
//      service shows in the manager.
//   D. Unsaved edits are never lost silently: a click outside the panel, Esc with the focus inside it, Esc with the
//      focus outside it, and Close all ask first ("Discard changes" / Cancel); declining keeps the dialog open with the
//      edit; accepting closes it without writing.
//   E. Editing a saved template and saving again changes the file; the file's own tab opens, is clean, and the program
//      is the active tab again; the Insert tab shows the new name.
//   F. "New Template from Selection…": two selected lines of a mill program open the manager on a draft (the code set
//      cannot be switched), the block numbers become {{N}}, a ticked number becomes a value ({{z}}), nothing else does;
//      the template is added, saved and inserted with a different value.
//
// The files are written to the scratch config folder of the run (`settings.paths.codesDir`), never to a real one.
// Expected wording is `ctx.t(...)`; texts and ids are the scenario's own or the data's.

import { scenario } from '../lib/index.js'
import { guard } from './m10-common.js'
import { message, newDoc, ready, ribbonTab, selectLines } from './m4-common.js'
import { undo } from './m5-common.js'
import { context, revealLine, suggestShowing } from './m3-common.js'
import { userDirs } from './exit2-common.js'
import { clicks, codeFile, formState, linesOf, press, pressCancel, pressOk, REPO_FILE, runFromInsertTab, suggestItems, templateBlocks, typeInField, waitForm } from './p3b-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const LATHE_PROGRAM = ['%', 'O1000 (SHOP)', 'N10 G21 G40 G99', 'N20 G28 U0. W0.', 'N100 G0 X100. Z100.', 'M30', '%']
const MILL_PROGRAM = ['%', 'O1000 (SHOP)', 'N10 G21 G17 G40 G49 G80 G90 G94', 'N100 G98 G83 X20. Y60. Z-7.5 R2. Q3. F150.', 'N110 G80', 'M30', '%']

/** The manager's root, or null. @param {Harness} h */
const manager = (h) => h.q('template-manager')

/** The rows of the list. @param {Harness} h */
const rows = (h) =>
  h.qa('template-row').map((element) => ({ element, id: element.dataset.templateId ?? '', origin: element.dataset.origin ?? '', group: element.dataset.group ?? '', review: element.dataset.review ?? '', favorite: element.dataset.favorite ?? '', problems: Number(element.dataset.problems ?? '0'), text: (element.textContent ?? '').replace(/\s+/g, ' ').trim() }))

/** A button of the manager by its action (and template id for a star). @param {Harness} h @param {string} action @param {string} [templateId] */
const action = (h, action, templateId) => h.qa('template-action').find((b) => b.dataset.action === action && (templateId === undefined || b.dataset.templateId === templateId)) ?? null

/** Sets a text control of the dialog the way typing does (focus, value, input event). @param {Harness} h @param {Element | null | undefined} control @param {string} value */
async function setValue(h, control, value) {
  const el = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (control ?? null)
  if (!el) throw new Error('setValue: no control')
  el.focus()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await h.frame()
}

/** Types into a control with real keys, replacing what it holds. @param {Harness} h @param {Element | null | undefined} control @param {string} text */
async function typeReal(h, control, text) {
  const el = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (control ?? null)
  if (!el) throw new Error('typeReal: no control')
  await h.window.ensureFront()
  el.focus()
  el.select()
  await h.nativeKeys([{ key: 'Backspace' }])
  await h.nativeType(text)
  await h.idle({ quiet: 80 })
  return el.value
}

/** @param {Harness} h @param {string} field */
const field = (h, field) => h.q('template-field', { field })
/** @param {Harness} h @param {string} f */
const paramField = (h, f) => h.q('template-param-field', { field: f })

/** Opens the manager from the Insert tab's button and waits for it. @param {Harness} h @param {string} command */
async function openManager(h, command = 'templates.manage') {
  await ribbonTab(h, 'insert')
  const button = h.q('cmd-button', { command })
  if (!button) throw new Error(`the Insert tab has no ${command} button`)
  h.click(button)
  if (!(await h.waitFor(() => manager(h), { timeout: 10000 }))) throw new Error('the manager did not open')
  await h.idle()
}

/** Closes the manager with its Close button (it must not ask: nothing unsaved). @param {Harness} h */
async function closeManager(h) {
  if (!manager(h)) return true
  const ok = await press(h, () => h.q('modal-cancel'), () => !manager(h))
  await h.idle()
  return ok
}

/** The status text of the manager's last message: key and text. @param {Harness} h */
const managerMessage = (h) => ({ error: h.q('template-message')?.dataset.error ?? '', text: (h.q('template-message')?.textContent ?? '').trim() })

scenario('p3-template-manager', { timeout: 900, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const lathe = (await codeFile(h, 'fanuc-lathe')).templates
  const { codesDir } = userDirs(h)
  const latheFile = `${codesDir}/fanuc-lathe.json`
  const millFile = `${codesDir}/fanuc.json`
  const byId = (/** @type {any[]} */ list, /** @type {string} */ id) => list.find((t) => t.id === id)

  const program = await newDoc(h, LATHE_PROGRAM.join('\n'), 'fanuc-lathe')
  await ctx.modal.whenReady(program)
  await revealLine(h, program, 5, 1)
  h.check('the scratch config folder has no user code file yet', (await h.disk.stat(latheFile)) === null && (await h.disk.stat(millFile)) === null)

  // ============================================================ A. open it, the built-in rows
  await guard(h, 'A. built-in rows', async () => {
    await openManager(h)
    const root = manager(h)
    h.check('Manage Templates… opens the manager for the program\'s code set; it has no file yet and nothing is unsaved', root?.dataset.dialect === 'fanuc-lathe' && root.dataset.file === '' && root.dataset.dirty === 'false', root && { ...root.dataset })
    h.check('and says where the file will be', h.q('template-file')?.textContent?.trim() === ctx.t('templateManager.file.none', { name: 'fanuc-lathe.json' }), h.q('template-file')?.textContent)
    const list = rows(h)
    const builtin = list.filter((r) => r.origin === 'builtin')
    h.log(`built-in rows: ${builtin.length} (${builtin.map((r) => r.id).join(', ')})`)
    h.check(`the lathe code set's ${lathe.length} templates are the rows, built-in, and nothing else: none of the mill templates it inherits, no row of yours`, builtin.length === lathe.length && lathe.every((/** @type {any} */ t) => builtin.some((r) => r.id === t.id && r.group === t.group)) && list.every((r) => r.origin === 'builtin'), list.map((r) => `${r.id}:${r.origin}`))
    h.check('every built-in row says "Review pending" in its badge and in its data', builtin.every((r) => r.review === 'pending' && r.text.includes(ctx.t('templateManager.reviewPending'))), builtin.map((r) => `${r.id}: ${r.review}`))
    h.check('and every row has a star, none lit', builtin.every((r) => r.favorite === 'false') && h.qa('template-action').filter((b) => b.dataset.action === 'favorite').length === list.length)

    const row = builtin.find((r) => r.id === 'tool-start')
    if (!row) throw new Error('no tool-start row')
    h.click(row.element)
    await h.idle()
    const editor = h.q('template-editor')
    h.check('selecting a built-in template shows it locked', editor?.dataset.templateId === 'tool-start' && editor.dataset.origin === 'builtin' && editor.dataset.locked === 'true', editor && { ...editor.dataset })
    const notes = h.qa('template-note').map((n) => ({ kind: n.dataset.kind, text: (n.textContent ?? '').trim() }))
    h.check('with the built-in note and the review-pending note', notes.some((n) => n.kind === 'builtin' && n.text === ctx.t('templateManager.builtinNote')) && notes.some((n) => n.kind === 'review' && n.text === ctx.t('templateManager.reviewNote')), notes)
    const def = byId(lathe, 'tool-start')
    const body = /** @type {HTMLTextAreaElement} */ (h.q('template-body'))
    h.check('the text is the data\'s, in a read-only box', body.value === def.body && body.readOnly, body.value)
    const fields = ['label', 'id', 'group', 'description', 'machineType', 'toolbar', 'snippet'].map((f) => /** @type {HTMLInputElement | null} */ (field(h, f)))
    h.check('name, id, group, description, machine type and the two boxes are disabled', fields.every((f) => f !== null && f.disabled), fields.map((f) => f?.disabled))
    h.check('and show the data\'s name, id and group', /** @type {HTMLInputElement} */ (field(h, 'label')).value === def.label && /** @type {HTMLInputElement} */ (field(h, 'id')).value === def.id && /** @type {HTMLInputElement} */ (field(h, 'group')).value === def.group)
    h.check('every parameter of the template is listed, each locked', h.qa('template-param-tab').map((t) => t.dataset.paramId).join() === def.params.map((/** @type {any} */ p) => p.id).join() && h.qa('template-param').every((p) => p.dataset.locked === 'true'), h.qa('template-param-tab').map((t) => t.dataset.paramId))
    h.check('Delete is off for a built-in; Duplicate and Change a copy are on', action(h, 'delete')?.dataset.disabled === 'true' && action(h, 'duplicate')?.dataset.disabled === 'false' && action(h, 'override') !== null && action(h, 'override')?.dataset.disabled === 'false', ['delete', 'duplicate', 'override'].map((a) => `${a}: ${action(h, a)?.dataset.disabled}`))
    // A real key press into the locked text changes nothing.
    await h.window.ensureFront()
    body.focus()
    await h.nativeType('X')
    await h.idle({ quiet: 80 })
    h.check('typing into the locked text changes nothing and the manager stays clean', body.value === def.body && manager(h)?.dataset.dirty === 'false', { dirty: manager(h)?.dataset.dirty })
    h.check('Save is off while nothing changed', action(h, 'save')?.dataset.disabled === 'true')
    h.check('the preview shows the template with its starting values in this program\'s numbering (N110 ...)', (h.q('template-preview')?.textContent ?? '').startsWith('N110 G50 S2500'), h.q('template-preview')?.textContent)
  })

  // ============================================================ B. a template of your own
  await guard(h, 'B. add, save, use', async () => {
    h.click(action(h, 'add'))
    await h.waitFor(() => rows(h).some((r) => r.origin === 'user'), { timeout: 5000 })
    await h.idle()
    const mine = rows(h).filter((r) => r.origin === 'user')
    h.check('New adds one row of yours, selected, and the manager is unsaved', mine.length === 1 && h.q('template-editor')?.dataset.origin === 'user' && h.q('template-editor')?.dataset.locked === 'false' && manager(h)?.dataset.dirty === 'true', { rows: mine.length, dirty: manager(h)?.dataset.dirty })
    h.check('Save is on now', action(h, 'save')?.dataset.disabled === 'false')

    const typed = await typeReal(h, field(h, 'label'), 'Probe approach')
    h.check('the name is typed with real keys', typed === 'Probe approach', typed)
    await setValue(h, field(h, 'id'), 'probe-approach')
    await setValue(h, field(h, 'group'), 'Shop')
    await setValue(h, field(h, 'description'), 'Probe the bore before the cut.')
    h.click(field(h, 'toolbar'))
    await h.idle({ quiet: 60 })
    h.check('the box "Button on the Insert tab" is ticked', /** @type {HTMLInputElement} */ (field(h, 'toolbar')).checked === true)

    // A parameter: its starting id is replaced after the placeholder was used, which rewrites the text.
    h.click(action(h, 'add-param'))
    await h.waitFor(() => h.q('template-param'), { timeout: 5000 })
    await h.idle({ quiet: 60 })
    const startId = h.q('template-param')?.dataset.paramId ?? ''
    h.check('Add parameter adds one, with an id of its own', startId !== '' && h.qa('template-param-tab').length === 1, startId)
    const body = /** @type {HTMLTextAreaElement} */ (h.q('template-body'))
    await typeReal(h, body, '')
    body.focus()
    await h.nativeType('G65 P9810 Z')
    h.click(h.qa('template-placeholder').find((b) => b.dataset.placeholder === startId))
    await h.idle({ quiet: 60 })
    h.check('the parameter\'s placeholder button inserts {{id}} at the caret, after the typed text', body.value === `G65 P9810 Z{{${startId}}}`, body.value)
    // The placeholder for the block number goes at the very start.
    body.focus()
    body.setSelectionRange(0, 0)
    h.click(h.qa('template-placeholder').find((b) => b.dataset.placeholder === 'N'))
    await h.idle({ quiet: 60 })
    h.check('the {{N}} button puts the block number where the caret is', body.value === `{{N}}G65 P9810 Z{{${startId}}}`, body.value)
    await setValue(h, paramField(h, 'id'), 'z')
    await setValue(h, paramField(h, 'label'), 'Probe depth')
    await h.idle({ quiet: 60 })
    h.check('renaming the parameter rewrites the placeholder in the text', /** @type {HTMLTextAreaElement} */ (h.q('template-body')).value === '{{N}}G65 P9810 Z{{z}}', /** @type {HTMLTextAreaElement} */ (h.q('template-body')).value)
    await setValue(h, paramField(h, 'default'), '5')
    await h.idle({ quiet: 60 })
    const preview = h.q('template-preview')
    h.check('the preview uses the starting value and this program\'s numbering: N110 G65 P9810 Z5', preview?.getAttribute('data-error') === null && (preview?.textContent ?? '').trim() === 'N110 G65 P9810 Z5', preview?.textContent)
    h.check('no problem is listed for it', mine.length === 1 && rows(h).find((r) => r.origin === 'user')?.problems === 0, rows(h).map((r) => `${r.id}:${r.problems}`))

    h.click(action(h, 'save'))
    const saved = await h.waitFor(() => manager(h)?.dataset.file === 'fanuc-lathe.json' && manager(h)?.dataset.dirty === 'false', { timeout: 10000 })
    h.check('Save creates fanuc-lathe.json: the manager is clean and names the file', !!saved, { ...manager(h)?.dataset })
    h.check('and says "Saved fanuc-lathe.json."', managerMessage(h).error === '' && managerMessage(h).text === ctx.t('templateManager.save.done', { name: 'fanuc-lathe.json' }), managerMessage(h))
    const onDisk = JSON.parse(await h.disk.read(latheFile))
    const t = onDisk.templates?.[0]
    h.check('the file is a code file of the code set holding exactly this template', onDisk.dialect === 'fanuc-lathe' && onDisk.templates.length === 1 && t.id === 'probe-approach' && t.label === 'Probe approach' && t.group === 'Shop' && t.description === 'Probe the bore before the cut.' && t.toolbar === true && t.body === '{{N}}G65 P9810 Z{{z}}', onDisk)
    h.check('its parameter is the number "z" labelled Probe depth with the starting value 5', t.params?.length === 1 && t.params[0].id === 'z' && t.params[0].label === 'Probe depth' && t.params[0].type === 'number' && String(t.params[0].default) === '5', t.params)
    h.check('and carries no review mark (it is yours)', t.review === undefined)
    h.check('the row stays selected, now with the file behind it', h.q('template-editor')?.dataset.templateId === 'probe-approach' && rows(h).find((r) => r.id === 'probe-approach')?.origin === 'user', rows(h).map((r) => `${r.id}:${r.origin}`))
    h.check('the manager closes without a question (nothing is unsaved)', await closeManager(h))
    h.check('and no alert is up', (await h.alert.visible()) === null)

    // On the Insert tab, in the program, in completion.
    await revealLine(h, program, 5, 1)
    await ribbonTab(h, 'insert')
    await h.waitFor(() => templateBlocks(h).some((b) => b.key === 'Shop'), { timeout: 8000 })
    const shop = templateBlocks(h).find((b) => b.key === 'Shop')
    h.check('the Insert tab has a new block "Shop" with a button labelled Probe approach, no review mark', shop?.buttons.length === 1 && shop.buttons[0].id === 'probe-approach' && shop.buttons[0].label === 'Probe approach' && shop.buttons[0].review === '' && shop.buttons[0].title === 'Probe the bore before the cut.', shop?.buttons)
    await runFromInsertTab(h, 'probe-approach')
    await waitForm(h)
    const state = formState(h)
    h.check('its form has one field, Probe depth, at 5, and no review note', state?.fields.size === 1 && state.fields.get('z')?.value === '5' && state.note === '' && state.title === 'Probe approach', state && { title: state.title, values: state.values, note: state.note })
    h.check('the live text is N110 G65 P9810 Z5', state?.preview === 'N110 G65 P9810 Z5', state?.preview)
    await pressOk(h)
    h.check('OK inserts it after N100 in the program\'s numbering', JSON.stringify(linesOf(h, program)) === JSON.stringify([...LATHE_PROGRAM.slice(0, 5), 'N110 G65 P9810 Z5', ...LATHE_PROGRAM.slice(5)]), linesOf(h, program))
    await undo(h)
    h.check('one Undo takes it back', JSON.stringify(linesOf(h, program)) === JSON.stringify(LATHE_PROGRAM))

    const blank = await newDoc(h, [...LATHE_PROGRAM.slice(0, 5), ''].join('\n'), 'fanuc-lathe')
    await ctx.modal.whenReady(blank)
    await revealLine(h, blank, 6, 1)
    h.focusEditor()
    await h.idle()
    await h.nativeType('probe')
    const offered = await h.waitFor(() => suggestItems().some((i) => i.label === 'Probe approach'), { timeout: 8000 })
    const item = suggestItems().find((i) => i.label === 'Probe approach')
    h.check('completion offers it by its name on an empty line, with its group', !!offered && !!item && suggestShowing() && item.text.includes(ctx.t('templates.completionDetail', { group: 'Shop' })), suggestItems().map((i) => i.text))
    h.check('and the template has no review note in its documentation', !(item?.text ?? '').includes(ctx.t('templates.reviewPending')), item?.text)
    await h.window.ensureFront()
    await h.nativeKeys([{ key: 'Tab' }])
    const form = await waitForm(h)
    h.check('Tab accepts it: the form opens', form !== null && formState(h)?.title === 'Probe approach', formState(h)?.title)
    await pressCancel(h)
    h.check('cancelling the form gives the typed word back (completion\'s replacement is undone) and writes nothing else', linesOf(h, blank).length === 6 && linesOf(h, blank)[5].toLowerCase() === 'probe' && !linesOf(h, blank).join('\n').includes('G65'), linesOf(h, blank))
    await revealLine(h, program, 5, 1)
  })

  // ============================================================ C. one list of stars
  await guard(h, 'C. stars', async () => {
    const active = ctx.docs.getActiveId() ?? ''
    // The active program is the lathe program again (section B ended by putting its cursor back); the manager and the
    // Insert tab read the active program's code set.
    const dialect = ctx.templates.dialectOf(active) ?? ''
    await openManager(h)
    const star = (/** @type {string} */ id) => action(h, 'favorite', id)
    h.check('the user template\'s row is there, with a star that is not lit', rows(h).find((r) => r.id === 'probe-approach')?.favorite === 'false' && star('probe-approach')?.getAttribute('aria-pressed') === 'false')
    h.click(star('probe-approach'))
    h.click(star('threading'))
    await h.idle({ quiet: 80 })
    h.check('a click on the stars of Probe approach and Threading lights both rows', rows(h).find((r) => r.id === 'probe-approach')?.favorite === 'true' && rows(h).find((r) => r.id === 'threading')?.favorite === 'true' && star('threading')?.getAttribute('aria-pressed') === 'true', rows(h).map((r) => `${r.id}:${r.favorite}`))
    h.check('and does not make the manager unsaved (a star is not in the file)', manager(h)?.dataset.dirty === 'false')
    h.check('the service has the same two stars in the order they were set', JSON.stringify(ctx.templates.favorites(dialect)) === JSON.stringify(['probe-approach', 'threading']), ctx.templates.favorites(dialect))
    await closeManager(h)
    await ribbonTab(h, 'insert')
    await h.waitFor(() => templateBlocks(h)[0]?.key === 'favorites', { timeout: 5000 })
    const first = templateBlocks(h)[0]
    h.check('the Insert tab\'s first block is Favorites with those two as buttons', first?.key === 'favorites' && first.buttons.map((b) => b.id).join() === 'probe-approach,threading', first?.buttons.map((b) => b.id))

    // The other way: removed through the service, gone from the manager.
    ctx.templates.setFavorite(dialect, 'threading', false)
    await openManager(h)
    h.check('a star removed elsewhere is not lit when the manager is opened again', rows(h).find((r) => r.id === 'threading')?.favorite === 'false' && rows(h).find((r) => r.id === 'probe-approach')?.favorite === 'true', rows(h).map((r) => `${r.id}:${r.favorite}`))
    h.click(star('probe-approach'))
    await h.idle({ quiet: 80 })
    h.check('and the last star removed in the manager empties the list', ctx.templates.favorites(dialect).length === 0 && rows(h).find((r) => r.id === 'probe-approach')?.favorite === 'false', ctx.templates.favorites(dialect))
    await closeManager(h)
  })

  // ============================================================ D. unsaved edits
  await guard(h, 'D. unsaved edits', async () => {
    const before = await h.disk.read(latheFile)
    await openManager(h)
    h.click(rows(h).find((r) => r.id === 'probe-approach')?.element)
    await h.idle()
    const label = field(h, 'label')
    await typeReal(h, label, 'Probe approach 2')
    h.check('typing a new name makes the manager unsaved', manager(h)?.dataset.dirty === 'true', manager(h)?.dataset.dirty)
    const asked = async (/** @type {string} */ what) => {
      const alert = await h.alert.wait({ timeout: 8000 })
      h.check(`${what}: asks "Leave without saving?" naming the file, with Discard changes and Cancel`, !!alert && alert.texts.join(' ').includes(ctx.t('templateManager.leave.message', { name: 'fanuc-lathe.json' })) && alert.buttons.includes(ctx.t('templateManager.leave.ok')) && alert.buttons.includes('Cancel'), alert)
      return alert
    }
    const declined = async (/** @type {string} */ what) => {
      await h.alert.click('Cancel')
      await h.idle({ quiet: 120 })
      h.check(`${what}: Cancel keeps the dialog open with the edit in it, still unsaved`, manager(h)?.dataset.dirty === 'true' && /** @type {HTMLInputElement} */ (field(h, 'label'))?.value === 'Probe approach 2' && (await h.alert.visible()) === null, { dirty: manager(h)?.dataset.dirty, label: /** @type {HTMLInputElement} */ (field(h, 'label'))?.value })
    }

    // 1. A click outside the panel.
    const backdrop = h.q('modal-backdrop')
    if (!backdrop) throw new Error('no modal backdrop')
    const box = backdrop.getBoundingClientRect()
    await h.window.ensureFront()
    await h.nativeClick(backdrop, { dx: -(box.width / 2 - 6), dy: -(box.height / 2 - 6) })
    await asked('a click outside the panel')
    await declined('a click outside the panel')

    // 2. Esc with the focus in the dialog.
    await h.window.ensureFront()
    const labelBox = /** @type {HTMLElement} */ (field(h, 'label'))
    labelBox.focus()
    await h.nativeKeys([{ key: 'Escape' }])
    await asked('Esc with the focus inside')
    await declined('Esc with the focus inside')

    // 3. Esc with the focus outside it.
    const active = /** @type {HTMLElement | null} */ (document.activeElement)
    active?.blur()
    h.focusEditor()
    await h.window.ensureFront()
    await h.nativeKeys([{ key: 'Escape' }])
    await asked('Esc with the focus outside the panel')
    await declined('Esc with the focus outside the panel')

    // 4. The Close button, answered Discard changes.
    await h.window.ensureFront()
    await h.nativeClick(h.q('modal-cancel'))
    await asked('Close')
    await h.alert.click(ctx.t('templateManager.leave.ok'))
    const gone = await h.waitFor(() => !manager(h), { timeout: 8000 })
    h.check('Discard changes closes the manager', !!gone)
    h.check('and nothing was written: the file is byte for byte as it was', (await h.disk.read(latheFile)) === before)
    await openManager(h)
    h.click(rows(h).find((r) => r.id === 'probe-approach')?.element)
    await h.idle()
    h.check('opened again, the template has its saved name', /** @type {HTMLInputElement} */ (field(h, 'label'))?.value === 'Probe approach' && manager(h)?.dataset.dirty === 'false', /** @type {HTMLInputElement} */ (field(h, 'label'))?.value)
    await closeManager(h)
  })

  // ============================================================ E. edit and save again
  await guard(h, 'E. edit and save', async () => {
    const active = ctx.docs.getActiveId() ?? ''
    await openManager(h)
    h.click(rows(h).find((r) => r.id === 'probe-approach')?.element)
    await h.idle()
    await typeReal(h, field(h, 'label'), 'Probe the bore')
    await setValue(h, field(h, 'group'), 'Shop floor')
    h.click(action(h, 'save'))
    await h.waitFor(() => manager(h)?.dataset.dirty === 'false', { timeout: 10000 })
    h.check('Save over the existing file says it saved', managerMessage(h).error === '' && managerMessage(h).text === ctx.t('templateManager.save.done', { name: 'fanuc-lathe.json' }), managerMessage(h))
    const onDisk = JSON.parse(await h.disk.read(latheFile))
    h.check('the file has the new name and group, still one template, its text and parameter unchanged', onDisk.templates.length === 1 && onDisk.templates[0].label === 'Probe the bore' && onDisk.templates[0].group === 'Shop floor' && onDisk.templates[0].body === '{{N}}G65 P9810 Z{{z}}' && onDisk.templates[0].params?.[0]?.id === 'z', onDisk.templates)
    const tab = ctx.docs.byPath(latheFile)
    h.check('the file is open in a tab of its own, clean, with the text that is on disk', !!tab && ctx.docs.get(tab.id)?.dirty === false && ctx.editor.getText(tab.id).replace(/\r\n/g, '\n') === (await h.disk.read(latheFile)).replace(/\r\n/g, '\n'), { open: !!tab, dirty: tab && ctx.docs.get(tab.id)?.dirty })
    h.check('and the program is the active tab again', ctx.docs.getActiveId() === active, ctx.docs.getActiveId())
    await closeManager(h)
    await ribbonTab(h, 'insert')
    await h.waitFor(() => templateBlocks(h).some((b) => b.key === 'Shop floor'), { timeout: 8000 })
    const block = templateBlocks(h).find((b) => b.key === 'Shop floor')
    h.check('the Insert tab shows the new name in the new group, and the old group is gone', block?.buttons[0]?.label === 'Probe the bore' && !templateBlocks(h).some((b) => b.key === 'Shop'), templateBlocks(h).map((b) => b.key))
  })

  // ============================================================ F. New Template from Selection
  await guard(h, 'F. from a selection', async () => {
    const mill = await newDoc(h, MILL_PROGRAM.join('\n'), 'fanuc-gcode')
    await ctx.modal.whenReady(mill)
    await selectLines(h, 4, 5)
    await openManager(h, 'templates.fromSelection')
    const root = manager(h)
    h.check('New Template from Selection opens the manager on the mill\'s code set (fanuc) with a draft, and the code set cannot be switched', root?.dataset.dialect === 'fanuc' && !!h.q('template-draft') && /** @type {HTMLSelectElement} */ (h.q('template-database')).disabled, root && { ...root.dataset })
    const candidates = h.qa('template-candidate')
    const addresses = candidates.map((c) => c.dataset.address)
    h.check('the numbers of the two lines that can become values are offered (X, Y, Z, R, Q, F), none of the block numbers, none of G80', ['X', 'Y', 'Z', 'R', 'Q', 'F'].every((a) => addresses.includes(a)) && !addresses.includes('N') && !addresses.some((a) => a === 'G'), addresses)
    h.check('nothing is a value until it is ticked', candidates.every((c) => c.dataset.checked === 'false') && (h.q('template-draft-result')?.textContent ?? '').includes('Z-7.5'), candidates.map((c) => c.dataset.checked))
    const result = () => (h.q('template-draft-result')?.textContent ?? '').trim()
    h.check('the block numbers are already {{N}} in the text', result().split('\n').every((l) => l.startsWith('{{N}}')) && result().split('\n').length === 2, result())
    const z = candidates.find((c) => c.dataset.address === 'Z')
    h.click(z)
    await h.idle({ quiet: 80 })
    h.check('ticking Z-7.5 makes it a value: the text now has {{z}} where Z-7.5 was, the rest is as it was', h.qa('template-candidate').find((c) => c.dataset.address === 'Z')?.dataset.checked === 'true' && result() === '{{N}}G98 G83 X20. Y60. {{z}} R2. Q3. F150.\n{{N}}G80', result())
    // Singular on both counts (finding 3): the words come from ctx.t, the sentence is pinned in full.
    const ONE = ctx.t('templateManager.draft.count', { numbers: ctx.t('templateManager.draft.numbers', { count: 1 }), params: ctx.t('templateManager.draft.values', { count: 1 }) })
    h.check('the count says one number, one value', (h.q('template-draft-count')?.textContent ?? '').trim() === ONE && ONE === '1 number selected, 1 value in the template', h.q('template-draft-count')?.textContent)
    await typeReal(h, h.q('template-draft-field', { field: 'label' }), 'Peck hole')
    await setValue(h, h.q('template-draft-field', { field: 'group' }), 'Shop')
    const id = /** @type {HTMLInputElement} */ (h.q('template-draft-field', { field: 'id' }))?.value
    h.check('the id is made from the name', id === 'peck-hole', id)
    h.click(action(h, 'draft-apply'))
    await h.waitFor(() => !h.q('template-draft') && rows(h).some((r) => r.id === 'peck-hole'), { timeout: 5000 })
    h.check('Add template closes the draft: the template is a row of yours, selected', rows(h).find((r) => r.id === 'peck-hole')?.origin === 'user' && h.q('template-editor')?.dataset.templateId === 'peck-hole' && manager(h)?.dataset.dirty === 'true', rows(h).map((r) => `${r.id}:${r.origin}`))
    h.click(action(h, 'save'))
    await h.waitFor(() => manager(h)?.dataset.file === 'fanuc.json' && manager(h)?.dataset.dirty === 'false', { timeout: 10000 })
    const onDisk = JSON.parse(await h.disk.read(millFile))
    const t = onDisk.templates?.[0]
    h.check('fanuc.json holds the template: text with {{N}}, group Shop, machine type of the program (mill)', onDisk.dialect === 'fanuc' && t?.id === 'peck-hole' && t.label === 'Peck hole' && t.group === 'Shop' && t.body === '{{N}}G98 G83 X20. Y60. {{z}} R2. Q3. F150.\n{{N}}G80' && t.machineType === 'mill', onDisk)
    const p = t?.params?.[0]
    h.check('with one parameter z: written "Z" before the number, a number, required, starting value -7.5', t?.params?.length === 1 && p.id === 'z' && p.prefix === 'Z' && p.type === 'number' && p.required === true && String(p.default) === '-7.5', t?.params)
    await closeManager(h)

    // Insert it with another value, after N110.
    await revealLine(h, mill, 5, 1)
    const how = await runFromInsertTab(h, 'peck-hole')
    h.check('it is not a toolbar template (the manager made it so), so it is in the group\'s More list', how === 'more')
    await waitForm(h)
    const state = formState(h)
    h.check('its form has the one field, at the starting value', state?.fields.size === 1 && state.fields.get('z')?.value === '-7.5', state?.values)
    await typeInField(h, 'z', '-9.25')
    h.check('the live text has the new depth and the next block numbers (N120, N130)', formState(h)?.preview === 'N120 G98 G83 X20. Y60. Z-9.25 R2. Q3. F150.\nN130 G80', formState(h)?.preview)
    await pressOk(h)
    h.check('inserted after the cursor block N110', JSON.stringify(linesOf(h, mill)) === JSON.stringify([...MILL_PROGRAM.slice(0, 5), 'N120 G98 G83 X20. Y60. Z-9.25 R2. Q3. F150.', 'N130 G80', ...MILL_PROGRAM.slice(5)]), linesOf(h, mill))
    h.check('the status line did not report an error', message(h) === '' || !/not inserted/i.test(message(h)), message(h))
  })

  h.check('every button press of the dialogs was a real mouse click', clicks.dom === 0 && clicks.real > 0, clicks)
})
