// Quitting with more than one unsaved document (plan §5 M1 H1 `m1-quit-multi`, §7.2
// `FileOps.confirmQuit`): every way out of the window has to ask ONE combined question
// that names every unsaved document, and honour the answer.
//
// The three ways in: Cmd+Q through the app menu, the red close button (`performClose:`)
// and `window.close()` from Rust. Each goes through `CloseRequested`, which the file
// contribution prevents before it asks.

import { scenario } from '../lib/index.js'

const COMBINED = JSON.stringify(['Save All', 'Discard All', 'Cancel'])

scenario('m1-quit-multi', { timeout: 180 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  const dirtyTabs = () => h.qa('doc-tab', { dirty: '1' }).map((e) => e.dataset.path)

  const fanuc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const klartext = await h.fixture('nc/heidenhain/h01-3tools.h')
  const fanucHex = await h.disk.hex(fanuc)
  const klartextHex = await h.disk.hex(klartext)

  // ------------------------------------------------------------ two unsaved documents
  await h.dialogs.queue('open', [fanuc, klartext])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => !!h.q('doc-tab', { path: klartext }) && !h.q('doc-tab', { path: '' }), { timeout: 10000 })

  for (const path of [fanuc, klartext]) {
    h.click(h.q('doc-tab', { path }))
    await h.waitFor(() => h.q('doc-tab', { path, active: '1' }) !== null)
    h.focusEditor()
    await h.nativeType('(UNSAVED)')
    await h.waitFor(() => !!h.q('doc-tab', { path, dirty: '1' }), { timeout: 4000 })
  }
  h.check('two documents are unsaved', JSON.stringify(dirtyTabs()) === JSON.stringify([fanuc, klartext]), dirtyTabs())

  /**
   * Asks the window to close and checks the one combined alert that must come back.
   * @param {string} how
   * @param {() => Promise<unknown>} request
   */
  const asksOnce = async (how, request) => {
    await request()
    const alert = await h.alert.wait()
    const state = await h.window.state()
    h.check(`${how}: one combined alert, with Save All / Discard All / Cancel`, JSON.stringify(alert?.buttons) === COMBINED && state.alerts === 1, { alert, state })
    h.check(`${how}: it names both unsaved documents`, (alert?.texts ?? []).join('\n').includes('f01-mill-3tools.nc') && (alert?.texts ?? []).join('\n').includes('h01-3tools.h'), alert?.texts)
    return alert
  }

  await asksOnce('Cmd+Q', () => h.nativeKeys([{ key: 'q', mods: ['cmd'] }]))
  // A second request while the question is up must not stack a second alert.
  await h.window.performClose()
  await h.sleep(900)
  const stacked = await h.window.state()
  h.check('a second close request while the question is up adds no second alert', stacked.alerts === 1, stacked)
  await h.alert.click('Cancel')
  await h.sleep(900)
  h.check('Cancel keeps the window and both unsaved documents', (await h.window.state()).exists && JSON.stringify(dirtyTabs()) === JSON.stringify([fanuc, klartext]), {
    state: await h.window.state(),
    dirty: dirtyTabs(),
  })

  await asksOnce('the red close button', () => h.window.performClose())
  await h.alert.click('Cancel')
  await h.sleep(900)
  h.check('Cancel after the red button keeps the window', (await h.window.state()).exists && h.qa('doc-tab').length === 2, dirtyTabs())

  await asksOnce('window.close()', () => h.window.close())
  await h.alert.click('Cancel')
  await h.sleep(900)
  h.check('Cancel after window.close() keeps the window', (await h.window.state()).exists && h.qa('doc-tab').length === 2, dirtyTabs())

  // Mod+Shift+W is the webview's Close Window; it takes the same path.
  await asksOnce('Cmd+Shift+W', () => h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }]))
  await h.alert.click('Cancel')
  await h.sleep(900)
  h.check('Cancel after Cmd+Shift+W keeps the window', (await h.window.state()).exists && h.qa('doc-tab').length === 2, dirtyTabs())

  // A single unsaved document keeps the M0 wording, so the combined dialog is only for
  // the case it is meant for.
  h.click(h.q('doc-tab', { path: fanuc }))
  await h.waitFor(() => h.q('doc-tab', { path: fanuc, active: '1' }) !== null)
  let undos = 0
  while (undos < 40 && h.q('doc-tab', { path: fanuc, dirty: '1' })) {
    ctx.editor.triggerAction('undo')
    undos++
    await h.sleep(30)
  }
  h.check('one document is unsaved again', JSON.stringify(dirtyTabs()) === JSON.stringify([klartext]), dirtyTabs())
  await h.window.close()
  const single = await h.alert.wait()
  h.check('with one unsaved document the alert is the single-document one', JSON.stringify(single?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']), single)
  h.check('it names that document', (single?.texts ?? []).join('\n').includes('h01-3tools.h'), single?.texts)
  await h.alert.click('Cancel')
  await h.sleep(900)

  // ------------------------------------------------------------ Discard All exits
  h.click(h.q('doc-tab', { path: fanuc }))
  await h.waitFor(() => h.q('doc-tab', { path: fanuc, active: '1' }) !== null)
  h.focusEditor()
  await h.nativeType('(UNSAVED AGAIN)')
  await h.waitFor(() => h.qa('doc-tab', { dirty: '1' }).length === 2, { timeout: 4000 })

  h.expectExit({
    files: [
      { path: fanuc, hex: fanucHex },
      { path: klartext, hex: klartextHex },
    ],
    events: ['MenuEvent quit', 'CloseRequested main', 'Exit'],
  })
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  await h.alert.wait()
  await h.alert.click('Discard All').catch(() => {})
})
