// Closing and quitting: every path that ends the app has to go through the
// unsaved-changes guard, ask exactly once, and honour the answer.

import { scenario } from '../lib/index.js'

const BUTTONS = JSON.stringify(['Save', "Don't Save", 'Cancel'])

/**
 * Types something so the buffer is modified.
 * @param {import('../lib/api.js').Harness} h
 */
async function makeDirty(h) {
  h.check('the editor takes focus', h.focusEditor())
  await h.nativeType('T9 M6\n')
  await h.waitFor(async () => (await h.title()) === '● Untitled — gEdit')
  return h.app.text()
}

scenario('m0-native-answer', { timeout: 90 }, async (h) => {
  await makeDirty(h)
  await h.window.close()
  const prompt = await h.alert.wait()
  h.check('window.close() on a modified buffer asks first', JSON.stringify(prompt?.buttons) === BUTTONS, prompt)
  await h.alert.click('Cancel')
  await h.sleep(1000)
  h.check('Cancel keeps the window and the changes', (await h.window.state()).exists && (await h.title()) === '● Untitled — gEdit')

  h.expectExit({ events: ['MenuEvent quit', 'CloseRequested main', 'Exit'] })
  await h.window.quitKey()
  await h.alert.wait()
  await h.alert.click("Don't Save").catch(() => {})
})

scenario('m0-dirty-close', { timeout: 90 }, async (h) => {
  await makeDirty(h)
  await h.window.performClose()
  const prompt = await h.alert.wait()
  h.check('the red close button asks before closing', JSON.stringify(prompt?.buttons) === BUTTONS, prompt)
  await h.sleep(1500)
  const state = await h.window.state()
  h.check('the window stays open while the prompt is up', state.exists && state.sheet === true && state.alerts === 1, state)
  await h.alert.click('Cancel')
  await h.sleep(800)
  h.check('Cancel keeps the window', (await h.window.state()).exists && (await h.title()) === '● Untitled — gEdit')

  h.expectExit({ events: ['CloseRequested main', 'WindowDestroyed main', 'Exit'] })
  await h.window.close()
  await h.alert.wait()
  await h.alert.click("Don't Save").catch(() => {})
})

scenario('m0-dirty-close-save', { timeout: 90 }, async (h) => {
  const text = await makeDirty(h)
  const target = `${h.cfg.run}/saved-on-close.nc`
  await h.dialogs.queue('save', target)
  await h.window.close()
  const prompt = await h.alert.wait()
  h.check('closing the untitled buffer asks first', JSON.stringify(prompt?.buttons) === BUTTONS, prompt)
  h.expectExit({ files: [{ path: target, includes: text }], events: ['CloseRequested main', 'Exit'] })
  await h.alert.click('Save').catch(() => {})
})

scenario('m0-double-close', { timeout: 90 }, async (h) => {
  await makeDirty(h)
  // Three close requests in a row; the guard must ask only once.
  await h.window.close()
  await h.alert.wait()
  await h.window.quitKey()
  await h.sleep(800)
  await h.window.performClose()
  await h.sleep(1200)
  const state = await h.window.state()
  const prompts = h.dialogs.calls().filter((c) => c.kind === 'message')
  h.check('repeated close requests produce a single prompt', state.alerts === 1 && prompts.length === 1, { state, prompts: prompts.length })
  h.check('the window is still there', state.exists && (await h.title()) === '● Untitled — gEdit', state)

  h.expectExit({ events: ['CloseRequested main', 'Exit'] })
  await h.alert.click("Don't Save").catch(() => {})
})

scenario('m0-dirty-quit', { timeout: 90 }, async (h) => {
  await makeDirty(h)
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  const prompt = await h.alert.wait()
  h.check('Cmd+Q on a modified buffer asks before quitting', JSON.stringify(prompt?.buttons) === BUTTONS, prompt)
  h.expectExit({ events: ['MenuEvent quit', 'CloseRequested main', 'WindowDestroyed main', 'Exit'] })
  await h.alert.click("Don't Save").catch(() => {})
})

scenario('m0-clean-quit', { timeout: 90 }, async (h) => {
  h.check('the buffer starts unmodified', (await h.title()) === 'Untitled — gEdit')
  h.check('no alert is up', (await h.alert.visible()) === null)
  h.expectExit({ within: 8000, events: ['MenuEvent quit', 'CloseRequested main', 'WindowDestroyed main', 'Exit'] })
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  // Nothing to save, so the app must exit without asking.
  await h.sleep(1500)
  h.check('quitting a clean buffer asks nothing', (await h.alert.visible()) === null)
})
