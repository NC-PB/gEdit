// The Monaco features the ribbon exposes (plan §5 M4 H4 `m4-editing-cmds`, WP4.4).
//
// Every one of the 22 wrappers in `contrib/editing.ts` is clicked as a ribbon button and
// judged by what it did to the document, the settings or the editor — not by whether the
// click threw. A wrapper that focused nothing would pass a "the command ran" check and
// still be broken, because `undo`, `redo` and `selectAll` resolve through Monaco's
// `getFocusedCodeEditor()`: without the `editor.focus()` those three do the *browser's*
// undo on the ribbon button (rule 3 of the file header there).
//
// Two of the checks are about the palette rather than the ribbon. `m1-keys` already
// proves the general rule — every command with `palette !== false` is a Monaco editor
// action, and only those. What is left for M4 is which side of that rule this file's
// commands are on: three of the 22 carry `palette: true` because Monaco's own palette
// does not list `MultiCommand`s, and the other 19 must not appear twice.
//
// The clipboard round trip goes through the real Cmd+C and Cmd+V. On macOS those are key
// equivalents of the predefined Edit menu, so they never arrive in the page as a keydown
// (`m1-keys` header) — they reach the webview as `copy:` and `paste:` on the first
// responder, which is exactly how a user's copy and paste reach Monaco. **This overwrites
// the clipboard of the Mac the suite runs on**, with one line of NC code.

import { scenario } from '../lib/index.js'
import { openFixture, plain } from './m3-common.js'
import { EDITING_COMMANDS, cmdButton, context, message, newDoc, ready, revealLine, ribbonTab, selectLines } from './m4-common.js'

const PROGRAM = ['N10 G0 X0', 'N20 G1 X10.', 'N30 G1 X20.', 'N40 G1 X30.', 'N50 M30', ''].join('\n')

/** `f01-mill-3tools.nc`: the `T1 M6` segment on line 11 runs to line 29 (`m3-outline`). */
const SEGMENT = { start: 11, end: 29, after: 30 }

scenario('m4-editing-cmds', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  const text = () => h.app.text()
  const lines = () => text().split('\n')
  const instance = () => /** @type {any} */ (ctx.editor.editorInstance())
  const gutter = () => [...(h.q('editor-host')?.querySelectorAll('.margin-view-overlays .line-numbers') ?? [])].map((e) => Number(e.textContent)).filter((n) => n > 0)
  const fontSize = () => parseFloat(getComputedStyle(/** @type {Element} */ (h.q('editor-host')?.querySelector('.view-lines'))).fontSize)

  /** Clicks a ribbon button and lets the editor settle. @param {string} id */
  const click = async (id) => {
    const button = cmdButton(h, id)
    if (!button) throw new Error(`no ribbon button for ${id}`)
    h.click(button)
    await h.idle()
  }

  // ============================================================= A. the two ribbon tabs
  await ribbonTab(h, 'home')
  const homeButtons = h.qa('cmd-button').map((e) => e.dataset.command)
  h.check('the Home tab carries the twelve Edit commands', EDITING_COMMANDS.home.every((id) => homeButtons.includes(id)), EDITING_COMMANDS.home.filter((id) => !homeButtons.includes(id)))

  await ribbonTab(h, 'view')
  const viewButtons = h.qa('cmd-button').map((e) => e.dataset.command)
  h.check('the View tab carries the ten View commands', EDITING_COMMANDS.view.every((id) => viewButtons.includes(id)), EDITING_COMMANDS.view.filter((id) => !viewButtons.includes(id)))

  const wrappers = [...EDITING_COMMANDS.home, ...EDITING_COMMANDS.view]
  const listed = ctx.commands.list().filter((c) => wrappers.includes(c.id))
  h.check('all 22 wrappers are registered', listed.length === wrappers.length, wrappers.filter((id) => !ctx.commands.has(id)))
  // What is in the palette is what F1 does not already list: `undo`, `redo` and
  // `selectAll` are Monaco `MultiCommand`s, which its palette leaves out, and the four
  // display toggles are settings with no Monaco action behind them at all. The fifteen
  // that do wrap an editor action carry `palette: false`, so F1 lists each of them once.
  const inPalette = listed.filter((c) => c.palette !== false).map((c) => c.id).sort()
  h.check(
    'the palette carries the three MultiCommands and the four settings toggles, and no action twice',
    JSON.stringify(inPalette) === JSON.stringify(['edit.redo', 'edit.selectAll', 'edit.undo', 'view.toggleMinimap', 'view.toggleStickyScroll', 'view.toggleWhitespace', 'view.toggleWordWrap']),
    inPalette,
  )

  // ============================================================ B. the twelve line tools
  await ribbonTab(h, 'home')
  const id = await newDoc(h, PROGRAM)
  // Only the active tab's buttons are in the DOM, so enablement is asked of the registry
  // and the Home buttons are checked where they are drawn.
  h.check('every wrapper is enabled with a document open', wrappers.every((cmd) => ctx.commands.isEnabled(cmd)), wrappers.filter((cmd) => !ctx.commands.isEnabled(cmd)))
  h.check(
    'and the Home buttons are drawn enabled',
    EDITING_COMMANDS.home.every((cmd) => cmdButton(h, cmd) !== null && !(/** @type {HTMLButtonElement} */ (cmdButton(h, cmd)).disabled)),
    EDITING_COMMANDS.home.filter((cmd) => cmdButton(h, cmd) === null || /** @type {HTMLButtonElement} */ (cmdButton(h, cmd)).disabled),
  )

  await revealLine(h, id, 2, 1)
  await click('edit.duplicateLine')
  h.check('Duplicate copies the cursor line below itself', lines().length === 7 && lines()[1] === 'N20 G1 X10.' && lines()[2] === 'N20 G1 X10.', lines())

  await click('edit.deleteLine')
  h.check('Delete Line takes the copy away again', text() === PROGRAM, lines())

  await revealLine(h, id, 2, 1)
  await click('edit.moveLineDown')
  h.check('Move Down swaps the cursor line with the one below', lines()[1] === 'N30 G1 X20.' && lines()[2] === 'N20 G1 X10.', lines())
  await click('edit.moveLineUp')
  h.check('Move Up puts it back', text() === PROGRAM, lines())

  await revealLine(h, id, 2, 1)
  await click('edit.toggleComment')
  const commented = lines()[1]
  h.check('Comment wraps the line in the dialect comment characters', commented !== 'N20 G1 X10.' && commented.includes('N20 G1 X10.'), commented)
  await click('edit.toggleComment')
  h.check('and toggles it off again', text() === PROGRAM, lines())

  await selectLines(h, 2, 2)
  await click('edit.lowerCase')
  h.check('Lower Case converts the selection', lines()[1] === 'n20 g1 x10.', lines()[1])
  await click('edit.undo')
  h.check('Undo takes the ribbon edit back', text() === PROGRAM, lines()[1])
  await click('edit.redo')
  h.check('Redo puts it back', lines()[1] === 'n20 g1 x10.', lines()[1])
  await selectLines(h, 2, 2)
  await click('edit.upperCase')
  h.check('Upper Case converts it back', text() === PROGRAM, lines()[1])

  await click('edit.selectAll')
  const all = instance()?.getSelection()
  h.check(
    'Select All selects the whole document, so the focus went to the editor first',
    !!all && all.startLineNumber === 1 && all.endLineNumber === lines().length,
    all && { start: all.startLineNumber, end: all.endLineNumber, count: lines().length },
  )
  await revealLine(h, id, 1, 1)

  // ---------------------------------------------------------------- find and replace
  await click('edit.find')
  const findWidget = await h.waitFor(() => h.q('editor-host')?.querySelector('.find-widget.visible'), { timeout: 5000 })
  h.check('Find opens the find widget inside the editor', !!findWidget, h.q('editor-host')?.querySelector('.find-widget')?.className ?? null)
  await click('edit.replace')
  const replaceShown = () => {
    const widget = h.q('editor-host')?.querySelector('.find-widget')
    const part = widget?.querySelector('.replace-part')
    return !!widget && (widget.className.includes('replaceToggled') || (!!part && part.getBoundingClientRect().height > 0))
  }
  await h.waitFor(replaceShown, { timeout: 5000 })
  h.check('Replace opens the same widget with its replace row', replaceShown(), h.q('editor-host')?.querySelector('.find-widget')?.className ?? null)
  ctx.editor.triggerAction('closeFindWidget')
  await h.idle()

  // F1: a wrapper that carries `palette` arrives with its category in front of it. The
  // fifteen that wrap an editor action are listed by Monaco itself, which is what
  // `palette: false` on them is for; `m1-keys` checks that correspondence both ways.
  h.focusEditor()
  await h.nativeKeys([{ key: 'F1' }])
  await h.waitFor(() => document.querySelector('.quick-input-widget'), { timeout: 5000 })
  await h.nativeType('Undo')
  await h.waitFor(() => document.querySelectorAll('.quick-input-list .monaco-list-row').length > 0, { timeout: 5000 })
  const paletteRows = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map((r) => plain(r.querySelector('.label-name')?.textContent ?? r.textContent).trim())
  h.check('F1 lists the gEdit wrapper as "Edit: Undo"', paletteRows.includes('Edit: Undo'), paletteRows)
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => getComputedStyle(/** @type {Element} */ (document.querySelector('.quick-input-widget'))).display === 'none', { timeout: 5000 })
  h.check('Esc closes the palette and types nothing into the program', text() === PROGRAM, lines())

  // ======================================================== C. the clipboard round trip
  await selectLines(h, 2, 2)
  h.check('the editor holds the focus for the copy', h.focusEditor())
  await h.nativeKeys([{ key: 'c', mods: ['cmd'] }])
  await h.sleep(300)
  // The last line of the program is the empty one its trailing newline stands for, so a
  // paste there adds the block without moving anything else.
  await revealLine(h, id, 6, 1)
  h.focusEditor()
  await h.nativeKeys([{ key: 'v', mods: ['cmd'] }])
  await h.waitFor(() => lines()[5] === 'N20 G1 X10.', { timeout: 5000 })
  h.check('Cmd+C and Cmd+V round-trip a block through the system clipboard', lines()[5] === 'N20 G1 X10.' && lines().length === 6, lines())
  for (let i = 0; i < 4 && text() !== PROGRAM; i++) await click('edit.undo')
  h.check('the pasted block is undone again', text() === PROGRAM, lines())

  // ================================================================ D. the View tab
  await ribbonTab(h, 'view')

  // The four display toggles are settings, which is what makes the ribbon button, the
  // settings dialog and settings.json agree.
  const toggles = [
    { command: 'view.toggleWhitespace', key: 'editor.renderWhitespace', on: 'all', off: 'none', name: 'Whitespace' },
    { command: 'view.toggleWordWrap', key: 'editor.wordWrap', on: true, off: false, name: 'Word wrap' },
    { command: 'view.toggleMinimap', key: 'editor.minimap', on: true, off: false, name: 'Minimap' },
    { command: 'view.toggleStickyScroll', key: 'editor.stickyScroll', on: true, off: false, name: 'Sticky scroll' },
  ]
  for (const toggle of toggles) {
    const before = ctx.settings.get(/** @type {any} */ (toggle.key))
    await click(toggle.command)
    await h.waitFor(() => ctx.settings.get(/** @type {any} */ (toggle.key)) !== before, { timeout: 5000 })
    const now = ctx.settings.get(/** @type {any} */ (toggle.key))
    const turnedOn = now === toggle.on
    h.check(`${toggle.command} writes the setting and says which way it went`, now !== before && message(h) === `${toggle.name} is ${turnedOn ? 'on' : 'off'}.`, {
      key: toggle.key,
      before,
      now,
      message: message(h),
    })
    await click(toggle.command)
    await h.waitFor(() => ctx.settings.get(/** @type {any} */ (toggle.key)) === before, { timeout: 5000 })
    h.check(`${toggle.command} toggles back`, ctx.settings.get(/** @type {any} */ (toggle.key)) === before, ctx.settings.get(/** @type {any} */ (toggle.key)))
  }

  // Monaco's font zoom is session only: it writes no setting, it changes the rendering.
  const baseFont = fontSize()
  await click('view.zoomIn')
  await h.waitFor(() => fontSize() > baseFont, { timeout: 5000 })
  h.check('Zoom In makes the editor font bigger', fontSize() > baseFont, { base: baseFont, now: fontSize() })
  await click('view.zoomOut')
  await h.waitFor(() => fontSize() === baseFont, { timeout: 5000 })
  h.check('Zoom Out takes it back', fontSize() === baseFont, fontSize())
  await click('view.zoomIn')
  await click('view.zoomIn')
  await click('view.zoomReset')
  await h.waitFor(() => fontSize() === baseFont, { timeout: 5000 })
  h.check('Reset Zoom goes back to the configured size', fontSize() === baseFont, { base: baseFont, now: fontSize() })
  h.check('none of the three wrote a setting', ctx.settings.get('appearance.editorFontSize') === baseFont, {
    setting: ctx.settings.get('appearance.editorFontSize'),
    rendered: fontSize(),
  })

  // ------------------------------------------------- folding, on a program that folds
  const fanuc = await openFixture(h, 'nc/fanuc/f01-mill-3tools.nc')
  await h.waitFor(() => h.qa('program-map-item').length > 0, { timeout: 10000 })
  await revealLine(h, fanuc.id, SEGMENT.start, 1)
  const shownLines = () => [...new Set(gutter())].sort((a, b) => a - b)
  const openedViewport = shownLines()
  h.check('before folding, the viewport shows a run of consecutive lines', openedViewport.length > 15 && openedViewport[1] === openedViewport[0] + 1, openedViewport)
  await click('view.foldAll')
  await h.waitFor(() => shownLines().length < openedViewport.length / 2, { timeout: 8000 })
  const folded = shownLines()
  // Fold All collapses every range the outline provides, including the ones around the
  // tool segments, so what is left is the handful of top-level lines.
  h.check('Fold All folds the outline ranges: the tool segment is not on screen any more', folded.length < 10 && !folded.includes(SEGMENT.start + 1) && !folded.includes(SEGMENT.end), folded)
  await click('view.unfoldAll')
  await h.waitFor(() => shownLines().length >= openedViewport.length, { timeout: 8000 })
  h.check('Unfold All opens them again', JSON.stringify(shownLines()) === JSON.stringify(openedViewport), { now: shownLines(), before: openedViewport })

  // ------------------------------------------------------------------ the quick outline
  await click('view.quickOutline')
  const widget = await h.waitFor(() => (document.querySelectorAll('.quick-input-list .monaco-list-row').length > 0 ? document.querySelector('.quick-input-widget') : null), { timeout: 8000 })
  h.check('Quick Outline opens the symbol picker with the outline in it', !!widget && document.querySelectorAll('.quick-input-list .monaco-list-row').length > 0, document.querySelectorAll('.quick-input-list .monaco-list-row').length)
  // The picker has the focus (`runAction` focuses the editor and the action moves it on),
  // so Esc goes to it. Taking the focus back first would leave it open.
  const hidden = () => !!widget && getComputedStyle(/** @type {Element} */ (widget)).display === 'none'
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(hidden, { timeout: 5000 })
  h.check('Esc closes it and types nothing into the program', hidden() && h.q('doc-tab', { docId: fanuc.id })?.dataset.dirty !== '1', {
    display: widget ? getComputedStyle(/** @type {Element} */ (widget)).display : null,
    dirty: h.q('doc-tab', { docId: fanuc.id })?.dataset.dirty,
  })
})
