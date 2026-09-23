// Settings ▸ Machines, and the file it writes (plan §5 M6 H6 `m6-machines-manage`, §7.15,
// AD-31, WP6.8 and WP6.10): add, duplicate, edit, make one the default, remove — and after
// every one of those, `machines.json` on disk is the golden, read back through the backend
// rather than off a path the page made up.
//
// **The file is the contract, not the list on screen.** A machine configuration is what a
// turning program is read with; it outlives the session, it is hand-editable, and M7 will
// refer to a machine by its id. So every step here is judged by `h.config.read('machines.json')`
// against a golden written out in full. Three things about those goldens:
//
//   1. **Rust writes the file**, so `$version` is added and every object key comes back
//      sorted (`serde_json` with no `preserve_order`). The comparison sorts both sides, so
//      a golden describes content rather than spelling — but `machines` is an *array* and
//      its order is content: an edit keeps its position, an addition goes to the end.
//   2. **A machine stores the whole rule set of the preset it was given**, never the
//      preset's name (`core/machines/fields.ts`). That is why the goldens spell out
//      `numberInput` — a later change to the dialect's preset data must not silently
//      change a machine the owner set up last year.
//   3. **A hand edit is never overwritten.** Saving `machines.json` as a document reloads
//      it (`contrib/machineSelect.ts`), so the next write from the page goes on top of what
//      is on disk. The run proves it with a per-class number rule the form cannot express.
//
// The restart is two scenarios sharing a HOME, exactly as `m2-recent-restart` does it:
// run 1 writes the file, run 2 starts a second app on the same home and reads it.
// `m6-machines-broken` is a third scenario, because a file that cannot be read has to be
// there *before* the app starts.

import { scenario } from '../lib/index.js'
import { configPaths } from './m2-common.js'
import {
  clickMachineAction,
  closeSettings,
  context,
  machineAction,
  machineField,
  machineRows,
  machinesFile,
  machineText,
  openMachinesPage,
  ready,
  sameJson,
} from './m6-common.js'
import { setField } from './m4-common.js'

const HOME_1 = '{run}/machines-home'
const HOME_2 = '{run}/../m6-machines-manage-1/machines-home'

/** The three preset labels of the Fanuc number-input parameter, as the profile writes them. */
const IS_B = 'Increments of 0.001 mm (IS-B): X50 is 0.050 mm, X50. is 50 mm; feeds and speeds as written (F200 is 200)'
const AS_WRITTEN = 'As written: X50 and X50. are both 50 mm; cycle steps in microns (Q6000 is 6 mm)'

/** The `is-b` preset's rule set, as a machine stores it (resolved `fanuc-lathe.json`). */
const IS_B_RULES = {
  mode: 'increment',
  incrementMm: '0.001',
  incrementInch: '0.0001',
  incrementDeg: '0.001',
  incrementSec: '0.001',
  classes: { feedPerMin: { mode: 'calculator' }, feedPerRev: { mode: 'calculator' } },
}

/** The `calculator` preset's, which is the lathe's own default. */
const AS_WRITTEN_RULES = { mode: 'calculator', incrementMm: '0.001' }

/** A machine record, spelled the way the page writes one. */
const record = (/** @type {string} */ id, /** @type {string} */ name, /** @type {object} */ numberInput, /** @type {object} */ rest = {}) => ({
  id,
  name,
  profile: 'fanuc-lathe',
  notes: '',
  params: { numberInput, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A' }, ...rest },
})

/** The whole file, as Rust hands it back. */
const file = (/** @type {ReturnType<typeof record>[]} */ machines, /** @type {Record<string, string>} */ defaults = {}) => ({
  $version: 1,
  machines,
  defaults,
})

/**
 * Fills the machine form and saves it, waiting until the list is back.
 * @param {import('../lib/api.js').Harness} h
 * @param {Record<string, string | number | boolean>} fields
 */
async function saveForm(h, fields) {
  for (const [field, value] of Object.entries(fields)) setField(h, field, value)
  await h.frame()
  const save = /** @type {HTMLButtonElement | undefined} */ (machineAction(h, 'save'))
  if (save === undefined) throw new Error('saveForm: the form has no Save button')
  if (save.disabled) throw new Error(`saveForm: Save is disabled with ${JSON.stringify(fields)}`)
  h.click(save)
  await h.waitFor(() => !h.q('machine-form'), { timeout: 10000 })
  await h.idle()
}

scenario('m6-machines-manage-1', { timeout: 420, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)

  h.check('the app runs on the shared home of this pair', paths.machinesFile.startsWith(`${h.cfg.run}/machines-home/`), paths.machinesFile)
  h.check('there is no machines file yet, and nothing was invented in its place', (await machinesFile(h)) === null && (await h.disk.stat(paths.machinesFile)) === null, {
    read: await machinesFile(h),
    stat: await h.disk.stat(paths.machinesFile),
  })

  const page = await openMachinesPage(h)
  h.check('“Manage machines…” opens the settings dialog on its Machines page', !!h.q('settings-machines') && h.q('settings-page')?.dataset.category === 'machines', {
    page: h.q('settings-page')?.dataset.category,
    tabs: h.qa('settings-category').map((e) => e.dataset.category),
  })
  h.check('the page starts empty, and says what that means', machineRows(h).length === 0 && /Documents are read with the defaults/.test(h.q('settings-machines')?.textContent ?? ''), {
    rows: machineRows(h).length,
    text: h.q('settings-machines')?.textContent?.trim().slice(0, 120),
  })
  h.check('with nothing to act on, only Add and Open machines file are offered', ['add', 'open-file'].every((a) => !!machineAction(h, a)) && !machineAction(h, 'replace-file'), {
    actions: h.qa('machine-action').map((e) => e.dataset.action),
  })

  // ==================================================================== A. Add
  await clickMachineAction(h, 'add')
  h.check('Add asks for the dialect first, so the parameters can never belong to another one', h.q('machine-form')?.dataset.step === 'profile' && !!machineField(h, 'profile'), {
    step: h.q('machine-form')?.dataset.step,
  })
  const dialects = [...(machineField(h, 'profile')?.querySelectorAll('option') ?? [])].map((o) => o.textContent?.trim())
  h.check('only the dialects that declare machine parameters are offered — Klartext is not one', dialects.length === 2 && dialects.some((d) => d === ctx.profiles.get('fanuc-lathe')?.name) && !dialects.includes(ctx.profiles.get('heidenhain-klartext')?.name), dialects)

  setField(h, 'profile', /** @type {string} */ (ctx.profiles.get('fanuc-lathe')?.name))
  await h.frame()
  await clickMachineAction(h, 'next')
  h.check('the parameter form is the one the dialect declares', h.q('machine-form')?.dataset.step === 'params' && h.q('machine-form')?.dataset.kind === 'add', {
    step: h.q('machine-form')?.dataset.step,
    kind: h.q('machine-form')?.dataset.kind,
  })
  const formFields = h.qa('form-field').map((e) => e.dataset.field)
  h.check(
    'it offers the name, the number rules, the units, diameter, the G-code system, the three power-on groups and the notes',
    JSON.stringify(formFields) === JSON.stringify(['name', 'numberInput', 'units', 'diameter', 'variant.gcodeSystem', 'modal.feedmode', 'modal.spindlemode', 'modal.plane', 'notes']),
    formFields,
  )
  h.check('a machine with no name cannot be saved', /** @type {HTMLButtonElement} */ (machineAction(h, 'save')).disabled === true, machineAction(h, 'save')?.dataset.disabled)

  await saveForm(h, { name: 'Lathe IS-B', numberInput: IS_B })
  const afterAdd = file([record('lathe-is-b', 'Lathe IS-B', IS_B_RULES)])
  h.check('adding a machine writes machines.json, with the whole rule set of the preset it was given', sameJson(await machinesFile(h), afterAdd), {
    got: await machinesFile(h),
    want: afterAdd,
  })
  h.check('and the page lists it under its dialect', machineRows(h).length === 1 && machineRows(h)[0].id === 'lathe-is-b' && machineRows(h)[0].profileId === 'fanuc-lathe' && machineRows(h)[0].problems === 0, machineRows(h).map((r) => `${r.id}|${r.name}|${r.profileId}|${r.problems}`))

  // ==================================================================== B. Duplicate
  await clickMachineAction(h, 'duplicate', 'lathe-is-b')
  h.check('Duplicate asks for one thing only — the new name — and proposes one', h.q('machine-form')?.dataset.kind === 'duplicate' && h.qa('form-field').length === 1 && /** @type {HTMLInputElement} */ (machineField(h, 'name')?.querySelector('input')).value === 'Lathe IS-B copy', {
    kind: h.q('machine-form')?.dataset.kind,
    fields: h.qa('form-field').map((e) => e.dataset.field),
    proposed: /** @type {HTMLInputElement | null} */ (machineField(h, 'name')?.querySelector('input'))?.value,
  })
  await saveForm(h, { name: 'Lathe calc' })
  const afterDuplicate = file([record('lathe-is-b', 'Lathe IS-B', IS_B_RULES), record('lathe-calc', 'Lathe calc', IS_B_RULES)])
  h.check('the copy is appended with its own id and the same parameters', sameJson(await machinesFile(h), afterDuplicate), {
    got: await machinesFile(h),
    want: afterDuplicate,
  })

  // ==================================================================== C. Edit
  await clickMachineAction(h, 'edit', 'lathe-calc')
  h.check('Edit opens the stored record, not a blank form', h.q('machine-form')?.dataset.kind === 'edit' && /** @type {HTMLInputElement} */ (machineField(h, 'name')?.querySelector('input')).value === 'Lathe calc', {
    name: /** @type {HTMLInputElement | null} */ (machineField(h, 'name')?.querySelector('input'))?.value,
  })
  const preset = /** @type {HTMLSelectElement | null} */ (machineField(h, 'numberInput')?.querySelector('select'))
  h.check('with the preset it was duplicated from already picked', preset?.selectedOptions[0]?.textContent?.trim() === IS_B, preset?.selectedOptions[0]?.textContent?.trim())
  await saveForm(h, { numberInput: AS_WRITTEN })
  const afterEdit = file([record('lathe-is-b', 'Lathe IS-B', IS_B_RULES), record('lathe-calc', 'Lathe calc', AS_WRITTEN_RULES)])
  h.check('an edit replaces the rules whole and keeps the record where it stood', sameJson(await machinesFile(h), afterEdit), {
    got: await machinesFile(h),
    want: afterEdit,
  })

  // ==================================================================== D. the default
  await clickMachineAction(h, 'default', 'lathe-is-b')
  await h.waitFor(() => machineRows(h).find((row) => row.id === 'lathe-is-b')?.isDefault === true, { timeout: 8000 })
  const afterDefault = file(afterEdit.machines, { 'fanuc-lathe': 'lathe-is-b' })
  h.check('“Default for its dialect” is recorded per dialect, not on the machine', sameJson(await machinesFile(h), afterDefault), {
    got: await machinesFile(h),
    want: afterDefault,
  })
  h.check('and the row is marked', machineRows(h).find((row) => row.id === 'lathe-is-b')?.isDefault === true && machineRows(h).find((row) => row.id === 'lathe-calc')?.isDefault === false, machineRows(h).map((r) => `${r.id}:${r.isDefault}`))

  // ==================================================================== E. a mill machine, then Remove
  await clickMachineAction(h, 'add')
  setField(h, 'profile', /** @type {string} */ (ctx.profiles.get('fanuc-gcode')?.name))
  await h.frame()
  await clickMachineAction(h, 'next')
  const millFields = h.qa('form-field').map((e) => e.dataset.field)
  h.check('a mill machine has no G-code system and no diameter to set: those are lathe parameters', !millFields.includes('variant.gcodeSystem') && !millFields.includes('diameter'), millFields)
  await saveForm(h, { name: 'Mill 1' })
  h.check('it is listed under the mill dialect', machineRows(h).find((row) => row.id === 'mill-1')?.profileId === 'fanuc-gcode', machineRows(h).map((r) => `${r.id}:${r.profileId}`))

  await clickMachineAction(h, 'remove', 'mill-1')
  const confirm = await h.alert.wait({ timeout: 8000 })
  h.check('Remove asks first, and names the machine', !!confirm && (confirm?.texts ?? []).join(' ').includes('Mill 1'), confirm)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel keeps it', machineRows(h).some((row) => row.id === 'mill-1'), machineRows(h).map((r) => r.id))

  await clickMachineAction(h, 'remove', 'mill-1')
  await h.alert.wait({ timeout: 8000 })
  await h.alert.click('Remove')
  await h.waitFor(() => !machineRows(h).some((row) => row.id === 'mill-1'), { timeout: 8000 })
  h.check('confirming takes it out of the file again, and leaves the two lathes alone', sameJson(await machinesFile(h), afterDefault), {
    got: await machinesFile(h),
    want: afterDefault,
  })

  // ==================================================================== F. the hand edit
  // "Open machines file" opens `machines.json` as an ordinary document, and the settings
  // dialog stays in front of it (WP6.10 §5), so it is closed first.
  await clickMachineAction(h, 'open-file')
  await h.waitFor(() => !!ctx.docs.byPath(paths.machinesFile), { timeout: 15000 })
  // No **file** dialog: `machines_open_file` grants that one path itself, which is the
  // whole point of the command (`machines.rs`). The two `message` calls in the list are the
  // Remove confirmations above, which are alerts and not pickers.
  const pickers = h.dialogs.calls().filter((call) => call.kind === 'open' || call.kind === 'save' || call.kind === 'folder')
  h.check('“Open machines file” opens the real file as a document, with no file dialog', !!ctx.docs.byPath(paths.machinesFile) && pickers.length === 0, {
    doc: ctx.docs.byPath(paths.machinesFile)?.title,
    pickers,
    all: h.dialogs.calls().map((call) => call.kind),
  })
  h.check('and the settings dialog is still there, in front of it', !!h.q('settings-machines'))
  await closeSettings(h, page)

  const machinesDoc = ctx.docs.byPath(paths.machinesFile)
  if (machinesDoc === undefined) throw new Error('“Open machines file” left no document open for machines.json')
  const docId = machinesDoc.id
  ctx.docs.activate(docId)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === docId, { timeout: 8000 })
  // A per-class rule the form has no control for: this control reads a dwell as written
  // even though every length is an increment. `replaceAll` and not `setValue` — AD-5.
  const onDisk = JSON.parse(await h.disk.read(paths.machinesFile))
  onDisk.machines[0].params.numberInput.classes.dwell = { mode: 'calculator' }
  ctx.editor.replaceAll(docId, `${JSON.stringify(onDisk, null, 2)}\n`)
  await h.waitFor(() => !!h.q('doc-tab', { docId, dirty: '1' }), { timeout: 5000 })
  if ((await ctx.files.save(docId)) !== true) throw new Error('saving machines.json as a document failed')
  await h.idle()

  const handEdited = structuredClone(afterDefault)
  handEdited.machines[0].params.numberInput = { ...IS_B_RULES, classes: { ...IS_B_RULES.classes, dwell: { mode: 'calculator' } } }
  h.check('the hand edit is on disk', sameJson(await machinesFile(h), handEdited), { got: await machinesFile(h), want: handEdited })

  // The next write from the page must go on top of what was just saved, not on top of the
  // copy the service had in memory before the edit.
  const page2 = await openMachinesPage(h)
  await clickMachineAction(h, 'default', 'lathe-calc')
  await h.waitFor(() => machineRows(h).find((row) => row.id === 'lathe-calc')?.isDefault === true, { timeout: 8000 })
  const afterHandEdit = { ...handEdited, defaults: { 'fanuc-lathe': 'lathe-calc' } }
  h.check('a write after a hand edit keeps the hand edit: the save reloaded the file first', sameJson(await machinesFile(h), afterHandEdit), {
    got: await machinesFile(h),
    want: afterHandEdit,
  })
  h.check('and the page still shows both machines, neither of them broken', machineRows(h).length === 2 && machineRows(h).every((row) => row.problems === 0), machineRows(h).map((r) => `${r.id}:${r.problems}`))
  await closeSettings(h, page2)

  // A clean exit, so run 2 starts from a settled file.
  h.expectExit({ within: 15000 })
  await h.sleep(500)
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})

scenario('m6-machines-manage-2', { timeout: 300, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)

  if (!(await h.disk.stat(paths.machinesFile))) {
    throw new Error(`no machines.json in ${paths.machinesFile}: run m6-machines-manage-1 first (it writes the shared home)`)
  }

  // The file keeps the order records were written in; the page lists them by name. Both
  // are checked, because they are different promises: the first is what a hand edit sees,
  // the second is what the owner reads.
  const onDisk = /** @type {any} */ (await machinesFile(h))
  h.check('the file the last session wrote is still in its own order', JSON.stringify(onDisk.machines.map((/** @type {any} */ m) => m.id)) === JSON.stringify(['lathe-is-b', 'lathe-calc']), onDisk.machines.map((/** @type {any} */ m) => m.id))

  const page = await openMachinesPage(h)
  const rows = machineRows(h)
  h.check('a second session finds both machines, listed by name', JSON.stringify(rows.map((row) => row.id)) === JSON.stringify(['lathe-calc', 'lathe-is-b']), rows.map((r) => `${r.id}|${r.name}`))
  h.check('none of them is reported as broken, the hand-edited one included', rows.every((row) => row.problems === 0), rows.map((r) => `${r.id}:${r.problems}`))
  h.check('and the default came back with them', rows.find((row) => row.id === 'lathe-calc')?.isDefault === true && rows.find((row) => row.id === 'lathe-is-b')?.isDefault === false, rows.map((r) => `${r.id}:${r.isDefault}`))

  const edited = machineAction(h, 'edit', 'lathe-is-b')
  h.click(/** @type {HTMLElement} */ (edited))
  await h.waitFor(() => !!h.q('machine-form'), { timeout: 8000 })
  const preset = /** @type {HTMLSelectElement | null} */ (machineField(h, 'numberInput')?.querySelector('select'))
  h.check(
    'a record the form cannot express is shown as custom rather than quietly re-fitted to a preset',
    preset?.selectedOptions[0]?.textContent?.trim() === 'Custom (edited in the file)',
    preset?.selectedOptions[0]?.textContent?.trim(),
  )
  await clickMachineAction(h, 'cancel')
  await closeSettings(h, page)

  // The default reaches a document of that dialect without anything being picked.
  const lathe = await h.fixture('nc/fanuc-lathe/l01-turning-a.nc')
  await h.dialogs.queue('open', lathe)
  await ctx.files.open()
  await h.waitFor(() => !!ctx.docs.byPath(lathe), { timeout: 15000 })
  await h.idle()
  h.check('a lathe document opened in this session uses the default machine, without being asked', machineText(h) === 'Machine: Lathe calc', {
    text: machineText(h),
    machineId: h.q('status-item', { item: 'machine' })?.dataset.machineId,
    choice: h.q('status-item', { item: 'machine' })?.dataset.choice,
  })
  h.check('and it is not marked assumed, because a machine really was chosen for it', h.q('status-item', { item: 'machine' })?.dataset.assumed === '0' && h.q('status-item', { item: 'machine' })?.dataset.choice === 'default', {
    assumed: h.q('status-item', { item: 'machine' })?.dataset.assumed,
    choice: h.q('status-item', { item: 'machine' })?.dataset.choice,
  })
})
