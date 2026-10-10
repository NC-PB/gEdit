// B1 A4 and A9: Settings asks before it throws away what was typed.
//
//   b1-settings-leave   A value typed on a settings page: Cancel, "Open settings file" and Esc ask ("Unsaved changes",
//                       "Discard changes" or "Cancel"); Cancel keeps the dialog and the typed value, "Discard changes"
//                       closes it and the setting stays as it was; with nothing typed the dialog closes at once.
//                       A machine form that is open (Add, the dialect, Continue, a name typed) asks before the dialog
//                       closes and before another settings tab is shown (A9); a dialect step that nothing has been
//                       typed into does not.
//
// The question is the real NSAlert, answered with real clicks on its buttons.

import { scenario } from '../lib/index.js'
import { configPaths, setInput } from './m2-common.js'
import { setField } from './m4-common.js'
import { clickMachineAction, machineField, openMachinesPage } from './m6-common.js'
import { OKUMA, startAdd } from './m8-common.js'
import { context, ready } from './b1-common.js'

const field = (/** @type {any} */ h, /** @type {string} */ id) => h.q('form-field', { field: id })
const control = (/** @type {any} */ h, /** @type {string} */ id) => /** @type {HTMLInputElement | HTMLSelectElement | null} */ (field(h, id)?.querySelector('input, select') ?? null)

scenario('b1-settings-leave', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const dialog = () => h.q('modal', { modal: 'settings' })
  const noAlert = async () => (await h.alert.visible()) === null
  /** @type {Promise<unknown> | null} */
  let closing = null
  const open = async () => {
    closing = ctx.commands.run('settings.open')
    if (!(await h.waitFor(() => !!dialog(), { timeout: 8000 }))) throw new Error('the settings dialog did not open')
  }
  const goTo = async (/** @type {string} */ category) => {
    h.click(h.q('settings-category', { category }))
    await h.waitFor(() => !!h.q('settings-page', { category }), { timeout: 5000 })
  }
  /** The question, read whole: its texts and buttons. */
  const question = async () => {
    const box = await h.alert.wait({ timeout: 8000 })
    return box
  }
  const isLeaveQuestion = (/** @type {any} */ box, /** @type {string} */ messageKey) =>
    !!box && box.texts.join(' ').includes(ctx.t('settings.leave.title')) && box.texts.join(' ').includes(ctx.t(messageKey)) && box.buttons.includes(ctx.t('settings.leave.ok')) && box.buttons.includes('Cancel')

  // ================================================================ A. a value typed on a page
  await open()
  await goTo('editor')
  const original = ctx.settings.get('editor.tabWidth')
  setInput(control(h, 'editor.tabWidth'), '8')
  h.click(h.q('modal-cancel'))
  const first = await question()
  h.check('Cancel with a value typed asks "Unsaved changes": Discard changes or Cancel', isLeaveQuestion(first, 'settings.leave.valuesMessage'), first)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('answering Cancel keeps the dialog open with the typed value in it, and the setting is not changed', !!dialog() && control(h, 'editor.tabWidth')?.value === '8' && ctx.settings.get('editor.tabWidth') === original, { open: !!dialog(), typed: control(h, 'editor.tabWidth')?.value, setting: ctx.settings.get('editor.tabWidth') })

  h.click(h.q('settings-open-file'))
  const second = await question()
  h.check('"Open settings file" asks the same question, because opening the file closes the dialog', isLeaveQuestion(second, 'settings.leave.valuesMessage'), second)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel keeps the dialog and opens no document', !!dialog() && !h.q('doc-tab', { path: paths.settingsFile }), { open: !!dialog(), tab: !!h.q('doc-tab', { path: paths.settingsFile }) })

  await h.nativeKeys([{ key: 'Escape' }])
  const third = await question()
  h.check('Esc asks too', isLeaveQuestion(third, 'settings.leave.valuesMessage'), third)
  await h.alert.click(ctx.t('settings.leave.ok'))
  await h.waitFor(() => !dialog(), { timeout: 8000 })
  await closing
  h.check('"Discard changes" closes the dialog and the setting stays as it was', !dialog() && ctx.settings.get('editor.tabWidth') === original && /** @type {any} */ ((await h.config.read('settings.json')) ?? {})['editor.tabWidth'] === undefined, { setting: ctx.settings.get('editor.tabWidth') })

  // ================================================================ B. nothing typed
  await open()
  await goTo('editor')
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !dialog(), { timeout: 8000 })
  await closing
  h.check('with nothing typed Cancel closes the dialog at once, with no question', !dialog() && (await noAlert()))

  // ================================================================ C. a machine form that is open
  const opened = await openMachinesPage(h)
  await startAdd(h, OKUMA)
  setField(h, 'name', 'Half-made machine')
  await h.frame()
  h.check('Machines: Add, the dialect and Continue have put the machine form on screen, with the typed name in it', h.q('machine-form')?.dataset.step === 'params' && /** @type {HTMLInputElement | null} */ (machineField(h, 'name')?.querySelector('input'))?.value === 'Half-made machine', h.q('machine-form')?.dataset.step)

  h.click(h.q('settings-category', { category: 'editor' }))
  const tab = await question()
  h.check('clicking another settings tab asks first, in the machine wording (A9)', isLeaveQuestion(tab, 'settings.leave.draftMessage'), tab)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel keeps the Machines tab, the form and the typed name', !!h.q('settings-machines') && !h.q('settings-page', { category: 'editor' }) && /** @type {HTMLInputElement | null} */ (machineField(h, 'name')?.querySelector('input'))?.value === 'Half-made machine', { machines: !!h.q('settings-machines') })

  h.click(h.q('modal-cancel'))
  const close = await question()
  h.check('Cancel of the dialog asks in the machine wording too', isLeaveQuestion(close, 'settings.leave.draftMessage'), close)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('and Cancel keeps the dialog', !!dialog() && !!h.q('machine-form'))

  h.click(h.q('settings-category', { category: 'editor' }))
  await question()
  await h.alert.click(ctx.t('settings.leave.ok'))
  await h.waitFor(() => !!h.q('settings-page', { category: 'editor' }), { timeout: 8000 })
  h.check('"Discard changes" shows the other tab, and the half-made machine is gone', !!h.q('settings-page', { category: 'editor' }) && !h.q('machine-form'), { machines: !!h.q('settings-machines') })
  h.click(h.q('settings-category', { category: 'machines' }))
  await h.waitFor(() => !!h.q('settings-machines'), { timeout: 5000 })
  h.check('back on Machines there is no form, and the file was never written', !h.q('machine-form') && (await h.config.read('machines.json')) === null, await h.config.read('machines.json'))

  // The dialect step alone is not a draft: nothing has been typed into a form yet.
  await clickMachineAction(h, 'add')
  h.check('Add shows the dialect step first', h.q('machine-form')?.dataset.step === 'profile', h.q('machine-form')?.dataset.step)
  h.click(h.q('settings-category', { category: 'editor' }))
  await h.waitFor(() => !!h.q('settings-page', { category: 'editor' }), { timeout: 5000 })
  h.check('leaving from the dialect step asks nothing: no form with a draft is open', !!h.q('settings-page', { category: 'editor' }) && (await noAlert()))

  // And closing the dialog with the draft discarded asks nothing either.
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !dialog(), { timeout: 8000 })
  await opened.closed
  h.check('so Cancel closes the dialog at once', !dialog() && (await noAlert()))
})
