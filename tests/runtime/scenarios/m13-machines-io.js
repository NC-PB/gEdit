// M13 machines import and export (plan §6 M13 H13 `m13-machines-io`, WP13.3, §4, X11 (a)): the whole
// machines file is saved through the native save dialog (Settings > Machines > Export, or the command),
// every machine is removed, and the same file is imported back through the open dialog: the list, the
// default of the dialect and the machines' parameters are as before, and a document asked for its
// machine reads it again. A second import onto machines that exist gets new names (` (2)`) and new ids
// and is summarised in one status message; a record that is not valid as a hand edit is left out and
// counted; a file that is not JSON, or not a machines file, is refused with a message and changes nothing.

import { scenario } from '../lib/index.js'
import { clickMachineAction, closeSettings, machineAction, machineItem, machineRows, machineText, openMachinesPage, sameJson, waitForMachine } from './m6-common.js'
import { machineMaker } from './m10-common.js'
import { message, newDoc, ready } from './m4-common.js'
import { read } from './m5-common.js'
import { context, machineState, machinesNow, useMachine } from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** A program of the lathe dialect with a decimal point question in it, as a document of its own. */
const LATHE_TEXT = 'G21 G40 G99\nG00 X50 Z10\nG01 Z-5. F0.2\nM30\n'

scenario('m13-machines-io', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const maker = machineMaker(h)
  const service = /** @type {any} */ (ctx).machines
  const stateOf = (/** @type {string} */ id) => ({ id, machine: machineState(h) })

  // ============================================================ the machines and the choices to keep
  await maker.add('Lathe IS-B', 'fanuc-lathe', 'is-b')
  await maker.add('Lathe calc', 'fanuc-lathe', 'calculator')
  await maker.add('Mill 1', 'fanuc-gcode', 'calculator')
  await service.setDefault('fanuc-lathe', maker.ids['Lathe IS-B'])
  await h.idle()
  const before = await machinesNow(h)
  h.check('three machines and a default for the lathe dialect are in machines.json', before?.machines?.length === 3 && before.defaults['fanuc-lathe'] === maker.ids['Lathe IS-B'], before)

  const docA = await newDoc(h, LATHE_TEXT, 'fanuc-lathe')
  await maker.use('Lathe calc')
  const choiceA = stateOf(docA)
  const docB = await newDoc(h, LATHE_TEXT, 'fanuc-lathe')
  await waitForMachine(h, maker.ids['Lathe IS-B'])
  const choiceB = stateOf(docB)
  const docC = await newDoc(h, LATHE_TEXT, 'fanuc-lathe')
  await maker.none()
  const choiceC = stateOf(docC)
  h.check('the three documents read three ways: an explicit machine, the default, and an explicit none', choiceA.machine.id === maker.ids['Lathe calc'] && choiceA.machine.choice === 'document' && choiceB.machine.id === maker.ids['Lathe IS-B'] && choiceB.machine.choice === 'default' && choiceC.machine.id === '' && choiceC.machine.choice === 'document', [choiceA, choiceB, choiceC])

  // ============================================================ export through the Machines page
  let page = await openMachinesPage(h)
  const exported = `${h.cfg.run}/my-machines.json`
  await h.dialogs.queue('save', exported)
  h.click(machineAction(h, 'export'))
  await h.waitFor(async () => (await h.disk.stat(exported)) !== null, { timeout: 8000 })
  await h.idle()
  const machinesPath = /** @type {any} */ (read(ctx.settings.paths))?.machinesFile
  h.check('Export saves the whole machines file where the dialog says, byte for byte', (await h.disk.read(exported)) === (await h.disk.read(machinesPath)), null)
  h.check('and says where', /my-machines\.json/.test(message(h)), message(h))
  h.check('exporting changed nothing: three machines are listed', machineRows(h).length === 3 && sameJson(await machinesNow(h), before))

  // ============================================================ remove every machine
  for (const row of machineRows(h)) {
    await clickMachineAction(h, 'remove', row.id)
    await h.alert.wait({ timeout: 8000 })
    await h.alert.click('Remove')
    await h.waitFor(() => !machineRows(h).some((r) => r.id === row.id), { timeout: 8000 })
  }
  h.check('with no machine left, the page is empty and machines.json holds no machine and no default', machineRows(h).length === 0 && (await machinesNow(h)).machines.length === 0 && Object.keys((await machinesNow(h)).defaults).length === 0, await machinesNow(h))

  // ============================================================ import it back
  await h.dialogs.queue('open', exported)
  h.click(machineAction(h, 'import'))
  await h.waitFor(() => machineRows(h).length === 3, { timeout: 8000 })
  await h.idle()
  const after = await machinesNow(h)
  h.check('Import brings the three machines back: the file is as it was before the export', sameJson(after, before), { after, before })
  h.check('the page lists them again, none of them broken', machineRows(h).length === 3 && machineRows(h).every((r) => r.problems === 0), machineRows(h).map((r) => `${r.id}|${r.name}|${r.problems}`))
  h.check('the default of the dialect came back with them, because this installation had none', machineRows(h).find((r) => r.id === maker.ids['Lathe IS-B'])?.isDefault === true)
  h.check('one status message sums it up', /3 machines imported/.test(message(h)), message(h))
  await closeSettings(h, page)

  // The documents: the per-file choices are as before, without anyone picking again.
  /** @type {Record<string, ReturnType<typeof machineState>>} */
  const seen = {}
  for (const [name, id] of /** @type {const} */ ([['A', docA], ['B', docB], ['C', docC]])) {
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 5000 })
    await h.idle()
    seen[name] = machineState(h)
  }
  h.check('the document with an explicit machine reads it again: Lathe calc, a choice of its own', seen.A.id === choiceA.machine.id && seen.A.choice === 'document' && seen.A.text.includes('Lathe calc'), { before: choiceA.machine, after: seen.A })
  h.check('the one that follows the dialect default reads the imported default machine', seen.B.id === choiceB.machine.id && seen.B.choice === 'default', { before: choiceB.machine, after: seen.B })
  h.check('and the one told "none" on purpose still reads none, not the default', seen.C.id === '' && seen.C.choice === 'document' && seen.C.assumed === '1', { before: choiceC.machine, after: seen.C })
  ctx.docs.activate(docA)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === docA, { timeout: 5000 })
  await useMachine(h, maker.ids['Lathe calc'], 'Lathe calc')
  h.check('choosing "Lathe calc" again reads the same: set by the machine', machineText(h).includes('Lathe calc') && machineItem(h)?.dataset.choice === 'document', machineState(h))

  // ============================================================ import onto machines that exist
  page = await openMachinesPage(h)
  await h.dialogs.queue('open', exported)
  h.click(machineAction(h, 'import'))
  await h.waitFor(() => machineRows(h).length === 6, { timeout: 8000 })
  h.check('a second import adds three more: names that were taken get a suffix, ids that were taken a new id', machineRows(h).length === 6 && ['Lathe IS-B (2)', 'Lathe calc (2)', 'Mill 1 (2)'].every((n) => machineRows(h).some((r) => r.name === n)) && new Set(machineRows(h).map((r) => r.id)).size === 6, machineRows(h).map((r) => `${r.id}|${r.name}`))
  h.check('and the summary says that three were renamed', /3 machines imported/.test(message(h)) && /3 were renamed/.test(message(h)), message(h))
  h.check('the default is not taken over a second time: it stays with the first machine', machineRows(h).filter((r) => r.isDefault).map((r) => r.name).join() === 'Lathe IS-B', machineRows(h).map((r) => `${r.name}:${r.isDefault}`))

  // A record that is not valid is left out and counted; the valid one beside it is imported.
  const mixed = `${h.cfg.run}/mixed-machines.json`
  const good = structuredClone(before.machines[0])
  good.id = 'imported-good'
  good.name = 'Imported good'
  await h.disk.write(mixed, JSON.stringify({ $version: 1, defaults: {}, machines: [good, { id: 'Bad Id!', name: 'Bad', profile: 'fanuc-lathe', params: {} }, 'not an object'] }, null, 2))
  await h.dialogs.queue('open', mixed)
  h.click(machineAction(h, 'import'))
  await h.waitFor(() => machineRows(h).some((r) => r.name === 'Imported good'), { timeout: 8000 })
  h.check('a record that is not valid as a hand edit is left out and counted, the valid one is imported', machineRows(h).length === 7 && /1 machine imported/.test(message(h)) && /2 were not valid/.test(message(h)), { rows: machineRows(h).length, status: message(h) })

  // A file that is not JSON, and one that is not a machines file: refused, nothing changes.
  const snapshot = JSON.stringify(await machinesNow(h))
  const junk = `${h.cfg.run}/junk.json`
  await h.disk.write(junk, '{ not json')
  await h.dialogs.queue('open', junk)
  h.click(machineAction(h, 'import'))
  await h.waitFor(() => /not valid JSON/.test(message(h)), { timeout: 8000 })
  h.check('a file that is not JSON is refused with a message', /not valid JSON/.test(message(h)) && h.q('status-message')?.dataset.error === '1', message(h))
  await h.disk.write(junk, '[1, 2, 3]')
  await h.dialogs.queue('open', junk)
  h.click(machineAction(h, 'import'))
  await h.waitFor(() => /not a machines file/.test(message(h)), { timeout: 8000 })
  h.check('and so is JSON that is not a machines file', /not a machines file/.test(message(h)), message(h))
  h.check('neither changed machines.json', JSON.stringify(await machinesNow(h)) === snapshot)
  await h.dialogs.queue('open', null)
  h.click(machineAction(h, 'import'))
  await h.idle()
  h.check('cancelling the dialog does nothing', JSON.stringify(await machinesNow(h)) === snapshot)
  await closeSettings(h, page)
})
