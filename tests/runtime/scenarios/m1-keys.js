// Keyboard handling (plan §5 M1 H1 `m1-keys`, §7.11, AD-4): the default shortcuts are
// the ones §7.11 lists and nothing else, they reach the command registry from inside
// Monaco as well as from a focused ribbon button, and they fire exactly once.
//
// Two shortcuts are also regression guards for decisions:
//   - Cmd+W closes a TAB and leaves the window open (WP1.4 D-WP1.4-1: the macOS Close
//     Window item carries no accelerator, because muda would give it Cmd+W).
//   - Cmd+Shift+W is the webview's Close Window and goes through the unsaved guard.
//
// Note on the macOS main menu: the predefined Edit items own Cmd+Z/X/C/V/A as key
// equivalents, so those never reach the page under posted NSEvents. Nothing below uses
// them; see the H1 hand-off note.

import { scenario } from '../lib/index.js'

/**
 * §7.11 verbatim, for every command M1 **and M2** register with a key. The check below is
 * two-way, so every new default binding has to be added here (mergeA; WP2.5 §4.1).
 * M2 is complete: `settings.open` (WP2.7) was the last unclaimed binding of §7.11.
 */
const SHORTCUTS = [
  ['file.new', 'Mod+N'],
  ['file.open', 'Mod+O'],
  ['file.save', 'Mod+S'],
  ['file.saveAs', 'Mod+Shift+S'],
  ['file.saveAll', 'Mod+Alt+S'],
  ['file.close', 'Mod+W'],
  ['file.closeWindow', 'Mod+Shift+W'],
  ['view.nextTab', 'Ctrl+Tab'],
  ['view.prevTab', 'Ctrl+Shift+Tab'],
  ['view.switchTab', 'Mod+Alt+O'],
  ['view.commandPalette', 'F1'],
  ['compare.with', 'Mod+Alt+C'],
  ['settings.open', 'Mod+,'],
  ['nav.goto', 'Ctrl+G'],
  ['nav.nextTool', 'F7'],
  ['nav.prevTool', 'Shift+F7'],
]

scenario('m1-keys', { timeout: 180 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  const tabs = () => h.qa('doc-tab')

  // ------------------------------------------------------------ the registered table
  const bound = ctx.commands
    .list()
    .filter((c) => c.keys !== undefined)
    .map((c) => [c.id, typeof c.keys === 'string' ? c.keys : JSON.stringify(c.keys)])
    .sort((a, b) => a[0].localeCompare(b[0]))
  const expected = [...SHORTCUTS].sort((a, b) => a[0].localeCompare(b[0]))
  h.check('every default shortcut is §7.11, and §7.11 is every default shortcut', JSON.stringify(bound) === JSON.stringify(expected), { bound, expected })
  h.check('no two commands claim the same keys', new Set(bound.map(([, k]) => k)).size === bound.length, bound.map(([, k]) => k))
  h.check('the registry loaded without a conflict or a broken contribution', h.rec.errors.length === 0, h.rec.errors)

  // WP1.4 D-WP1.4-1: no menu item may carry a Cmd+W-shaped accelerator.
  const menu = await h.menu()
  h.check(
    'Close Window is a custom item in two menus and carries no accelerator',
    !/Predefined text="Close Window"/.test(menu) && (menu.match(/MenuItem id="close_window"/g) ?? []).length === 2 && (menu.match(/MenuItem id="quit"/g) ?? []).length === 1,
    menu.split('\n').filter((line) => /close_window|quit/.test(line)),
  )

  // ------------------------------------------------------------ Cmd+S fires exactly once
  // An untitled buffer asks for a path, so a second dispatch of the same shortcut would
  // ask a second time — which the runner reports as a dialog nobody queued.
  h.check('the window starts with one untitled buffer', tabs().length === 1)
  h.focusEditor()
  await h.nativeType('T1 M6\n')
  await h.waitFor(() => !!h.q('doc-tab', { dirty: '1' }), { timeout: 4000 })
  const first = `${h.cfg.run}/from-editor.nc`
  let calls = h.dialogs.calls().length
  await h.dialogs.queue('save', first)
  await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'from-editor.nc — gEdit', { timeout: 6000 })
  await h.sleep(600)
  h.check(
    'Cmd+S with the editor focused saves once, through the Monaco action',
    h.dialogs.calls().slice(calls).filter((c) => c.kind === 'save').length === 1 && (await h.disk.read(first)).includes('T1 M6'),
    { dialogs: h.dialogs.calls().slice(calls).map((c) => c.kind), disk: (await h.disk.read(first)).slice(0, 20) },
  )

  await h.nativeKeys([{ key: 'n', mods: ['cmd'] }])
  await h.waitFor(() => tabs().length === 2, { timeout: 4000 })
  h.focusEditor()
  await h.nativeType('T2 M6\n')
  await h.waitFor(() => h.qa('doc-tab', { dirty: '1' }).length === 1, { timeout: 4000 })
  // Focus a ribbon button, so the window dispatcher is the only handler that can run.
  const ribbonButton = h.q('cmd-button', { command: 'file.saveAll' })
  ribbonButton?.focus()
  h.check('a ribbon button can take the focus', document.activeElement === ribbonButton, document.activeElement?.tagName)
  const second = `${h.cfg.run}/from-ribbon.nc`
  calls = h.dialogs.calls().length
  await h.dialogs.queue('save', second)
  await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'from-ribbon.nc — gEdit', { timeout: 6000 })
  await h.sleep(600)
  h.check(
    'Cmd+S with a ribbon button focused saves once, through the window dispatcher',
    h.dialogs.calls().slice(calls).filter((c) => c.kind === 'save').length === 1 && (await h.disk.read(second)).includes('T2 M6'),
    { dialogs: h.dialogs.calls().slice(calls).map((c) => c.kind), active: document.activeElement?.tagName },
  )

  // ------------------------------------------------------------ Ctrl+Tab
  h.focusEditor()
  const before = ctx.docs.getActiveId()
  await h.nativeKeys([{ key: 'Tab', mods: ['ctrl'] }])
  await h.waitFor(() => ctx.docs.getActiveId() !== before, { timeout: 3000 })
  h.check('Ctrl+Tab reaches the app: the webview does not swallow it', ctx.docs.getActiveId() !== before, {
    before,
    now: ctx.docs.getActiveId(),
  })
  h.check('no Tab character was typed into the buffer', !h.app.text().includes('\t'), h.app.text().slice(0, 20))
  await h.nativeKeys([{ key: 'Tab', mods: ['ctrl', 'shift'] }])
  await h.waitFor(() => ctx.docs.getActiveId() === before, { timeout: 3000 })
  h.check('Ctrl+Shift+Tab comes back', ctx.docs.getActiveId() === before, ctx.docs.getActiveId())

  // ------------------------------------------------------------ F1: the command palette
  h.focusEditor()
  await h.nativeKeys([{ key: 'F1' }])
  const widget = await h.waitFor(() => document.querySelector('.quick-input-widget'), { timeout: 5000 })
  h.check("F1 opens Monaco's command palette", !!widget && getComputedStyle(/** @type {Element} */ (widget)).display !== 'none')

  // Fixed in I1: the bridge adds its actions with `IStandaloneCodeEditor.addAction`.
  // The static `monaco.editor.addEditorAction()` it used before registers a command and
  // a global keybinding but never an `InternalEditorAction`, so the editor's own action
  // list — what `getSupportedActions()` returns and what F1 reads — stayed empty.
  //
  // `addAction` stores the action under `gedit.<id>` (so `getAction('gedit.<id>')`
  // resolves) but gives the action the per-editor unique id `<editorId>:gedit.<id>`;
  // there is no public API that yields a bare id, so the check compares the suffix.
  const instance = /** @type {any} */ (ctx.editor.editorInstance())
  const supported = instance?.getSupportedActions?.() ?? []
  const inEditor = supported
    .map((/** @type {any} */ a) => String(a.id))
    .filter((/** @type {string} */ id) => id.includes('gedit.'))
    .map((/** @type {string} */ id) => id.slice(id.indexOf('gedit.')))
    .sort()
  const shouldBeInEditor = ctx.commands
    .list()
    .filter((c) => c.palette !== false)
    .map((c) => `gedit.${c.id}`)
    .sort()
  const missingByName = shouldBeInEditor.filter((id) => !instance?.getAction?.(id))
  h.check(
    'every command with `palette` is a Monaco editor action, so F1 can list it',
    JSON.stringify(inEditor) === JSON.stringify(shouldBeInEditor) && missingByName.length === 0,
    { expected: shouldBeInEditor, actual: inEditor, missingByName, monacoActions: supported.length },
  )

  await h.nativeType('Save')
  await h.sleep(600)
  const rows = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map((r) => ({
    label: r.querySelector('.label-name')?.textContent?.trim() ?? r.textContent?.trim() ?? '',
    keys: [...r.querySelectorAll('.monaco-keybinding-key')].map((k) => k.textContent).join(''),
  }))
  const save = rows.find((r) => r.label === 'File: Save')
  const saveAs = rows.find((r) => r.label === 'File: Save As…')
  h.check(
    'the palette lists the gedit commands as "<Category>: <Title>" with their shortcut',
    !!save && save.keys === '⌘S' && !!saveAs && saveAs.keys === '⇧⌘S',
    { rows, filter: /** @type {HTMLInputElement | null} */ (document.querySelector('.quick-input-box input'))?.value },
  )
  await h.nativeKeys([{ key: 'Escape' }])
  await h.sleep(500)
  h.check(
    'Esc closes the palette and types nothing into the buffer',
    getComputedStyle(/** @type {Element} */ (document.querySelector('.quick-input-widget'))).display === 'none' && !h.app.text().includes('Save'),
    { display: getComputedStyle(/** @type {Element} */ (document.querySelector('.quick-input-widget'))).display, text: h.app.text().slice(0, 20) },
  )

  // ------------------------------------------------------------ Cmd+W closes a tab
  const paths = tabs().map((e) => e.dataset.path)
  const closing = h.q('doc-tab', { active: '1' })?.dataset.path
  await h.nativeKeys([{ key: 'w', mods: ['cmd'] }])
  await h.waitFor(() => tabs().length === 1, { timeout: 4000 })
  const state = await h.window.state()
  h.check(
    'Cmd+W closes exactly one tab — the active one — and leaves the window open (D-WP1.4-1)',
    tabs().length === 1 && state.exists && state.visible && tabs()[0].dataset.path !== closing && paths.includes(closing ?? ''),
    { before: paths, closed: closing, after: tabs().map((e) => e.dataset.path), state },
  )

  // ------------------------------------------------------------ Cmd+Shift+W, guarded
  h.focusEditor()
  await h.nativeType('(UNSAVED)\n')
  await h.waitFor(() => !!h.q('doc-tab', { dirty: '1' }), { timeout: 4000 })
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
  const prompt = await h.alert.wait()
  h.check('Cmd+Shift+W goes through the unsaved-changes guard', JSON.stringify(prompt?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']), prompt)
  await h.alert.click('Cancel')
  await h.sleep(900)
  h.check('Cancel keeps the window', (await h.window.state()).exists, await h.window.state())

  // Cmd+Shift+W is the webview's own command: it confirms, then destroys the window, so
  // there is no CloseRequested to prevent (unlike Cmd+Q and the red button).
  h.expectExit({ events: ['WindowDestroyed main', 'Exit'] })
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
  await h.alert.wait()
  await h.alert.click("Don't Save").catch(() => {})
})
