// Real (trusted) input: mouse clicks and key presses that macOS delivers exactly like
// hardware input, including Cmd+S and Cmd+Q through the main menu.
//
// This scenario needs a free screen: its first check is that macOS activated the
// harness window, and nothing below works without that.
//
// M1: the window's first buffer is `Untitled-1`, and a new document is written with the
// profile's CRLF line endings while the hook reports LF (§7.9, owner decision D17).

import { scenario } from '../lib/index.js'

/** The bytes a new document is written with: the hook's LF text, with CRLF breaks. */
const onDisk = (/** @type {string} */ text) => text.replace(/\n/g, '\r\n')

scenario('m0-trusted', { timeout: 120 }, async (h) => {
  const state = await h.window.state()
  h.check('the harness window is active, so it receives real input', state.active === true && state.key === true, state)

  const lines = () => [...(h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? [])]
  const byTop = () => lines().sort((a, b) => parseFloat(/** @type {HTMLElement} */ (a).style.top) - parseFloat(/** @type {HTMLElement} */ (b).style.top))
  /** @param {number} n */
  const line = (n) => /** @type {HTMLElement} */ (byTop()[n - 1])

  // The line element is wider than its text, so its center is past the end of line 3.
  await h.nativeClick(line(3))
  await h.waitFor(() => h.app.cursor().line === 3)
  h.check('a real click puts the cursor at the end of the clicked line', JSON.stringify(h.app.cursor()) === '{"line":3,"column":9}', {
    cursor: h.app.cursor(),
    status: h.q('status-item', { item: 'cursor' })?.textContent,
  })

  const first = line(1)
  await h.nativeClick(first, { dx: -first.getBoundingClientRect().width / 2 + 2 })
  await h.waitFor(() => h.app.cursor().line === 1)
  h.check('a real click at the start of line 1 goes there', JSON.stringify(h.app.cursor()) === '{"line":1,"column":1}', h.app.cursor())

  await h.nativeType('T7 M6\n')
  await h.waitFor(async () => (await h.title()) === '● Untitled-1 — gEdit')
  h.check('real key presses type into the editor and mark it modified', h.app.text().startsWith('T7 M6\n% \n'), {
    text: h.app.text().slice(0, 20),
    title: await h.title(),
  })
  const mapped = await h.waitFor(() => h.q('program-map-item', { line: 1, kind: 'tool' }), { timeout: 3000 })
  h.check('the typed tool call shows up in the program map', !!mapped)

  const saved = `${h.cfg.run}/trusted.nc`
  const before = h.dialogs.calls().length
  await h.dialogs.queue('save', saved)
  await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'trusted.nc — gEdit')
  h.check(
    'a real Cmd+S saves once and types no "s" into the buffer',
    h.dialogs.calls().length === before + 1 && (await h.disk.read(saved)) === onDisk(h.app.text()) && h.app.text().startsWith('T7 M6\n'),
    { dialogs: h.dialogs.calls().slice(before).map((c) => c.kind), text: h.app.text().slice(0, 20) },
  )

  await h.nativeType('(Q)\n')
  await h.waitFor(async () => (await h.title()) === '● trusted.nc — gEdit')
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  const prompt = await h.alert.wait()
  h.check('a real Cmd+Q on a modified buffer asks before quitting', JSON.stringify(prompt?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']), prompt)
  await h.alert.click('Cancel')
  await h.sleep(1000)
  h.check('Cancel keeps the app running', (await h.window.state()).exists && (await h.title()) === '● trusted.nc — gEdit')

  h.expectExit({ files: [{ path: saved, includes: 'T7 M6', excludes: '(Q)' }], events: ['MenuEvent quit', 'CloseRequested main', 'Exit'] })
  await h.nativeKeys([{ key: 'q', mods: ['cmd'] }])
  await h.alert.wait()
  await h.alert.click("Don't Save").catch(() => {})
})
