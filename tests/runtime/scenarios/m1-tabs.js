// The document tabs (plan §5 M1 H1 `m1-tabs`, §7.9 `tab-bar` / `doc-tab`):
// untitled numbering next to real files, per-document undo stack and cursor, the three
// ways to close a tab, the pointer reorder and Ctrl+Tab.
//
// The tab bar has no keyboard shortcut for "close this tab with the mouse", so the
// middle click and the pointer drag are dispatched as DOM events — they are the only
// two gestures the harness cannot post as NSEvents (`h.nativeClick` is a left click and
// there is no pointer equivalent). Everything else is real input.

import { scenario } from '../lib/index.js'

const BUTTONS = JSON.stringify(['Save', "Don't Save", 'Cancel'])
const STARTER = '% \nO1000\nG0 X0 Y0\nM30 \n%'

/** A middle click on a tab, the way a mouse delivers it (mousedown then auxclick). */
function middleClick(/** @type {HTMLElement} */ el) {
  const init = { button: 1, buttons: 4, bubbles: true, cancelable: true }
  el.dispatchEvent(new MouseEvent('mousedown', init))
  el.dispatchEvent(new MouseEvent('auxclick', init))
}

/** Drags a tab horizontally with pointer events (AD-6: no HTML5 drag and drop). */
function dragTab(/** @type {HTMLElement} */ el, /** @type {number} */ toX) {
  const rect = el.getBoundingClientRect()
  const y = rect.top + rect.height / 2
  const from = rect.left + rect.width / 2
  /** @param {string} type @param {number} x */
  const send = (type, x) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  send('pointerdown', from)
  send('pointermove', from + 8)
  send('pointermove', toX)
  send('pointerup', toX)
}

scenario('m1-tabs', { timeout: 180 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  const tabs = () => h.qa('doc-tab')
  const titles = () => ctx.docs.all().map((d) => d.title)
  const activeTitle = () => ctx.docs.get(ctx.docs.getActiveId() ?? '')?.title
  const cursor = () => JSON.stringify(h.app.cursor())

  const fanuc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const klartext = await h.fixture('nc/heidenhain/h01-3tools.h')

  // ------------------------------------------------------------ untitled numbering
  h.check('the window starts with Untitled-1', JSON.stringify(titles()) === '["Untitled-1"]', titles())
  await h.nativeKeys([{ key: 'n', mods: ['cmd'] }])
  await h.waitFor(() => tabs().length === 2, { timeout: 4000 })
  h.check('Cmd+N adds Untitled-2, empty and active', JSON.stringify(titles()) === '["Untitled-1","Untitled-2"]' && h.app.text() === '' && activeTitle() === 'Untitled-2', {
    titles: titles(),
    text: h.app.text(),
  })
  h.check('the first buffer keeps the starter program', ctx.editor.getText(ctx.docs.all()[0].id) === STARTER, ctx.editor.getText(ctx.docs.all()[0].id))

  // ------------------------------------------------------------ files next to them
  await h.dialogs.queue('open', [fanuc, klartext])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => tabs().length === 4, { timeout: 10000 })
  h.check(
    'two files open next to the two untitled buffers',
    JSON.stringify(titles()) === '["Untitled-1","Untitled-2","f01-mill-3tools.nc","h01-3tools.h"]',
    titles(),
  )
  h.check('no untitled buffer was replaced, because two documents were already open', tabs().length === 4, titles())
  const [u1, u2, fanucId, klartextId] = ctx.docs.all().map((d) => d.id)

  // ------------------------------------------------------------ cursor per tab
  h.click(h.q('doc-tab', { docId: fanucId }))
  await h.waitFor(() => ctx.docs.getActiveId() === fanucId)
  h.check('the editor host names the active document', h.q('editor-host')?.dataset.docId === fanucId, h.q('editor-host')?.dataset.docId)
  h.focusEditor()
  await h.nativeKeys([{ key: 'ArrowDown' }, { key: 'ArrowDown' }, { key: 'ArrowDown' }, { key: 'ArrowRight' }, { key: 'ArrowRight' }])
  await h.waitFor(() => h.app.cursor().line === 4 && h.app.cursor().column === 3, { timeout: 3000 })
  const fanucCursor = cursor()
  h.check('the arrow keys move the cursor in the Fanuc document', fanucCursor === '{"line":4,"column":3}', fanucCursor)
  h.check('the status bar shows it', h.q('status-item', { item: 'cursor' })?.textContent === 'Ln 4, Col 3', h.q('status-item', { item: 'cursor' })?.textContent)

  h.click(h.q('doc-tab', { docId: klartextId }))
  await h.waitFor(() => ctx.docs.getActiveId() === klartextId)
  h.check('the other document starts at its own cursor', cursor() === '{"line":1,"column":1}', cursor())
  h.click(h.q('doc-tab', { docId: fanucId }))
  await h.waitFor(() => ctx.docs.getActiveId() === fanucId)
  await h.waitFor(() => cursor() === fanucCursor, { timeout: 3000 })
  h.check('coming back restores the cursor of that tab', cursor() === fanucCursor && h.q('status-item', { item: 'cursor' })?.textContent === 'Ln 4, Col 3', {
    cursor: cursor(),
    status: h.q('status-item', { item: 'cursor' })?.textContent,
  })

  // ------------------------------------------------------------ undo per tab
  const fanucOriginal = ctx.editor.getText(fanucId)
  h.focusEditor()
  await h.nativeType('(EDIT IN FANUC)')
  await h.waitFor(() => !!h.q('doc-tab', { docId: fanucId, dirty: '1' }), { timeout: 4000 })
  h.check('typing in the Fanuc tab changed it', ctx.editor.getText(fanucId).includes('(EDIT IN FANUC)'), ctx.editor.getText(fanucId).split('\n')[3])

  h.click(h.q('doc-tab', { docId: klartextId }))
  await h.waitFor(() => ctx.docs.getActiveId() === klartextId)
  h.focusEditor()
  await h.nativeType('; EDIT IN KLARTEXT')
  await h.waitFor(() => !!h.q('doc-tab', { docId: klartextId, dirty: '1' }), { timeout: 4000 })
  const klartextEdited = ctx.editor.getText(klartextId)
  h.check('both documents are modified, each in its own tab', h.qa('doc-tab', { dirty: '1' }).length === 2, tabs().map((e) => `${e.dataset.docId}:${e.dataset.dirty}`))

  // Cmd+Z is a key equivalent of the macOS Edit menu, so a posted NSEvent never reaches
  // the page; `triggerAction('undo')` is the same Monaco command the shortcut runs.
  // Monaco splits fast typing into several undo stops, so undo until the tab is clean:
  // what is under test is that the stack belongs to this document, not its granularity.
  h.click(h.q('doc-tab', { docId: fanucId }))
  await h.waitFor(() => ctx.docs.getActiveId() === fanucId)
  let undos = 0
  while (undos < 40 && h.q('doc-tab', { docId: fanucId, dirty: '1' })) {
    ctx.editor.triggerAction('undo')
    undos++
    await h.sleep(30)
  }
  await h.waitFor(() => !h.q('doc-tab', { docId: fanucId, dirty: '1' }), { timeout: 3000 })
  h.check(
    "undo in one tab takes back that tab's edit and marks it unmodified again",
    undos < 40 && ctx.editor.getText(fanucId) === fanucOriginal && !h.q('doc-tab', { docId: fanucId, dirty: '1' }),
    { undos, reverted: ctx.editor.getText(fanucId) === fanucOriginal, dirty: h.q('doc-tab', { docId: fanucId })?.dataset.dirty },
  )
  h.check(
    'the other tab keeps its own edit and its own undo stack',
    ctx.editor.getText(klartextId) === klartextEdited && !!h.q('doc-tab', { docId: klartextId, dirty: '1' }),
    { head: ctx.editor.getText(klartextId).slice(0, 30), dirty: h.q('doc-tab', { docId: klartextId })?.dataset.dirty },
  )

  // ------------------------------------------------------------ Ctrl+Tab
  h.focusEditor()
  await h.nativeKeys([{ key: 'Tab', mods: ['ctrl'] }])
  await h.waitFor(() => ctx.docs.getActiveId() === klartextId, { timeout: 3000 })
  h.check('Ctrl+Tab moves to the next tab', ctx.docs.getActiveId() === klartextId, activeTitle())
  await h.nativeKeys([{ key: 'Tab', mods: ['ctrl'] }])
  await h.waitFor(() => ctx.docs.getActiveId() === u1, { timeout: 3000 })
  h.check('Ctrl+Tab wraps around at the end', ctx.docs.getActiveId() === u1, activeTitle())
  await h.nativeKeys([{ key: 'Tab', mods: ['ctrl', 'shift'] }])
  await h.waitFor(() => ctx.docs.getActiveId() === klartextId, { timeout: 3000 })
  h.check('Ctrl+Shift+Tab wraps the other way', ctx.docs.getActiveId() === klartextId, activeTitle())
  h.check('the tab bar marks exactly one tab active', h.qa('doc-tab', { active: '1' }).length === 1 && h.q('doc-tab', { active: '1' })?.dataset.docId === klartextId, tabs().map((e) => e.dataset.active))

  // ------------------------------------------------------------ the switch-tab picker
  await h.nativeKeys([{ key: 'o', mods: ['cmd', 'alt'] }])
  const picker = await h.waitFor(() => h.q('quick-pick'), { timeout: 4000 })
  h.check('Mod+Alt+O opens the document picker with every tab, active one preselected', !!picker && h.qa('quick-pick-item').length === 4 && h.q('quick-pick-item', { 'aria-selected': 'true' })?.dataset.index === '3', {
    items: h.qa('quick-pick-item').map((e) => e.textContent?.trim().slice(0, 40)),
    selected: h.q('quick-pick-item', { 'aria-selected': 'true' })?.dataset.index,
  })
  await h.nativeType('f01')
  await h.waitFor(() => h.qa('quick-pick-item').length === 1, { timeout: 2000 })
  h.check('typing filters the list', h.qa('quick-pick-item').length === 1 && h.qa('quick-pick-item')[0].textContent?.includes('f01-mill-3tools.nc'), h.qa('quick-pick-item').map((e) => e.textContent?.trim().slice(0, 40)))
  await h.nativeKeys([{ key: 'Enter' }])
  await h.waitFor(() => h.q('quick-pick') === null && ctx.docs.getActiveId() === fanucId, { timeout: 3000 })
  h.check('Enter activates the picked document', ctx.docs.getActiveId() === fanucId && h.q('quick-pick') === null, activeTitle())

  await h.nativeKeys([{ key: 'o', mods: ['cmd', 'alt'] }])
  await h.waitFor(() => h.q('quick-pick'), { timeout: 4000 })
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => h.q('quick-pick') === null, { timeout: 3000 })
  h.check('Esc leaves the active document alone', ctx.docs.getActiveId() === fanucId, activeTitle())

  // ------------------------------------------------------------ the pointer reorder
  const bar = h.q('tab-bar')
  const before = titles()
  dragTab(h.q('doc-tab', { docId: u1 }) ?? document.body, (bar?.getBoundingClientRect().right ?? 0) - 4)
  await h.waitFor(() => ctx.docs.all()[3]?.id === u1, { timeout: 3000 })
  h.check(
    'dragging a tab to the far right moves it there, in the store and in the DOM',
    JSON.stringify(titles()) === JSON.stringify([before[1], before[2], before[3], before[0]]) &&
      JSON.stringify(tabs().map((e) => e.dataset.docId)) === JSON.stringify([u2, fanucId, klartextId, u1]),
    { before, after: titles(), dom: tabs().map((e) => e.dataset.docId) },
  )
  h.check('the drag did not change which document is active', ctx.docs.getActiveId() === fanucId, activeTitle())

  // ------------------------------------------------------------ closing
  const cleanTab = h.q('doc-tab', { docId: u2 })
  middleClick(cleanTab ?? document.body)
  await h.waitFor(() => h.q('doc-tab', { docId: u2 }) === null, { timeout: 4000 })
  h.check('a middle click closes a clean tab without asking', tabs().length === 3 && (await h.alert.visible()) === null, titles())

  // The close button of a modified tab goes through the same guard as Mod+W.
  h.click(h.q('doc-tab-close', { docId: klartextId }))
  const prompt = await h.alert.wait()
  h.check('closing a modified tab asks Save, Don\'t Save, Cancel', JSON.stringify(prompt?.buttons) === BUTTONS, prompt)
  h.check('the question names that document, not the active one', (prompt?.texts ?? []).join(' ').includes('h01-3tools.h'), prompt?.texts)
  await h.alert.click('Cancel')
  await h.sleep(600)
  h.check('Cancel keeps the tab and its changes', !!h.q('doc-tab', { docId: klartextId, dirty: '1' }) && ctx.editor.getText(klartextId) === klartextEdited, titles())

  h.click(h.q('doc-tab-close', { docId: klartextId }))
  await h.alert.click("Don't Save")
  await h.waitFor(() => h.q('doc-tab', { docId: klartextId }) === null, { timeout: 4000 })
  h.check('Don\'t Save closes it and leaves its file alone', tabs().length === 2 && !(await h.disk.read(klartext)).includes('EDIT IN KLARTEXT'), titles())

  // Mod+W closes the active tab; the window always keeps one document.
  h.click(h.q('doc-tab', { docId: fanucId }))
  await h.waitFor(() => ctx.docs.getActiveId() === fanucId)
  await h.nativeKeys([{ key: 'w', mods: ['cmd'] }])
  await h.waitFor(() => h.q('doc-tab', { docId: fanucId }) === null, { timeout: 4000 })
  h.check('Cmd+W closes the active tab', tabs().length === 1 && ctx.docs.getActiveId() === u1, titles())
  await h.nativeKeys([{ key: 'w', mods: ['cmd'] }])
  await h.waitFor(() => ctx.docs.all().length === 1 && ctx.docs.all()[0].id !== u1, { timeout: 4000 })
  h.check(
    'closing the last document leaves a fresh untitled buffer, not an empty window',
    tabs().length === 1 && ctx.docs.all()[0].path === null && (await h.window.state()).exists,
    titles(),
  )
  h.check('the new buffer reuses the lowest free untitled number', ctx.docs.all()[0].title === 'Untitled-1', titles())

  h.expectExit({ within: 15000 })
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})
