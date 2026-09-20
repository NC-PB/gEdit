// Navigation (plan §5 M3 H3 `m3-nav`, §7.11, WP3.5): F7 and Shift+F7 step through the
// tool changes and wrap, and Ctrl+G opens gEdit's own prompt, which understands a line
// number and a block number — and is not Monaco's go-to-line.
//
// This one uses **real key presses**, because the binding is what is under test: F7,
// Shift+F7 and Ctrl+G are plain keys rather than main-menu key equivalents, so the window
// server delivers them even when the app is not frontmost (WP3.0 §1). The keybinding
// removal in `contrib/navigation.ts` is only observable from the outside as "Monaco's
// quick input stayed shut while our prompt opened", which is what the checks below read.
//
// The prompt is `modals.prompt`, so `nav.goto` does not settle until it is answered: the
// command form is started with `void` and the modal waited for (mergeB §4.1).

import { scenario } from '../lib/index.js'
import { setInput } from './m2-common.js'
import { context, openFixture, revealLine } from './m3-common.js'

/** The tool changes of the two fixtures, as `expected/outline/**` records them. */
const FANUC_TOOLS = [11, 30, 49]
const KLARTEXT_TOOLS = [6, 17, 35]

/** A program with no tool change at all, so the "nothing to step to" path has a document. */
const NO_TOOLS = ['%', 'O4000 (NO TOOL CHANGE)', 'G21 G90', 'G0 X0. Y0.', 'G1 Z-1. F200.', 'M30', '%'].join('\n')

/**
 * A program whose only tool change is past the first chunk of the outline build.
 *
 * `CHUNK_LINES` is 20 000, so a synchronous read of the index right after the document
 * opens cannot see line 24 990 — which is the point: F7 has to wait for the build rather
 * than answer from what is there.
 */
const LATE_TOOL_LINE = 24990
function lateToolProgram() {
  const lines = ['%', 'O4100 (TOOL AT THE END)', 'G21 G17 G40 G49 G80 G90 G94']
  while (lines.length < LATE_TOOL_LINE - 2) lines.push(`G1 X${(lines.length * 0.01).toFixed(2)} F800.`)
  lines.push('(FINISH BORE)', 'T7 M6', 'S3000 M3', 'G0 Z25.', 'M30', '%')
  return lines.join('\n')
}

/** Whether Monaco's own quick input (the palette, its go-to-line) is on screen. */
function quickInputShowing() {
  for (const widget of document.querySelectorAll('.quick-input-widget')) {
    const box = widget.getBoundingClientRect()
    if (box.height > 0 && box.width > 0 && getComputedStyle(widget).display !== 'none') return true
  }
  return false
}

scenario('m3-nav', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })

  const message = () => h.q('status-message')?.textContent?.trim() ?? ''
  const cursor = () => h.app.cursor().line

  /**
   * Steps with a real key and waits for the cursor to land.
   * @param {'F7' | 'Shift+F7'} key
   * @param {number} expected
   */
  const step = async (key, expected) => {
    await h.nativeKeys([{ key: 'F7', mods: key === 'Shift+F7' ? ['shift'] : [] }])
    await h.waitFor(() => cursor() === expected, { timeout: 4000 })
    return cursor()
  }

  // ------------------------------------------------------------ F7 on a Fanuc program
  const fanuc = await openFixture(h, 'nc/fanuc/f01-mill-3tools.nc')
  await h.waitFor(() => ctx.outline.toolLines(fanuc.id).length === FANUC_TOOLS.length, { timeout: 10000 })
  h.check('the tool changes navigation walks are the ones the outline found', JSON.stringify(ctx.outline.toolLines(fanuc.id)) === JSON.stringify(FANUC_TOOLS), ctx.outline.toolLines(fanuc.id))

  await revealLine(h, fanuc.id, 1, 1)
  h.check('the editor has the focus for the key presses', h.focusEditor())
  h.check('F7 goes to the first tool change', (await step('F7', 11)) === 11, h.app.cursor())
  h.check('F7 goes on to the second', (await step('F7', 30)) === 30, h.app.cursor())
  h.check('and to the third', (await step('F7', 49)) === 49, h.app.cursor())
  h.check('F7 wraps to the first and says so', (await step('F7', 11)) === 11 && message() === 'Wrapped around to the first tool change.', { cursor: h.app.cursor(), message: message() })
  h.check('Shift+F7 wraps the other way and says so', (await step('Shift+F7', 49)) === 49 && message() === 'Wrapped around to the last tool change.', { cursor: h.app.cursor(), message: message() })
  h.check('Shift+F7 keeps stepping backwards', (await step('Shift+F7', 30)) === 30, h.app.cursor())

  // The binding is `global: true`, so it must work from outside the editor as well.
  const ribbonButton = h.q('cmd-button', { command: 'file.saveAll' })
  ribbonButton?.focus()
  h.check('a ribbon button can take the focus away from the editor', document.activeElement === ribbonButton, document.activeElement?.tagName)
  h.check('F7 still steps when the editor does not have the focus', (await step('F7', 49)) === 49, h.app.cursor())

  // ------------------------------------------------------------ the other dialect
  const klartext = await openFixture(h, 'nc/heidenhain/h01-3tools.h')
  await h.waitFor(() => ctx.outline.toolLines(klartext.id).length === KLARTEXT_TOOLS.length, { timeout: 10000 })
  await revealLine(h, klartext.id, 1, 1)
  h.focusEditor()
  h.check('F7 reads the Klartext tool calls', (await step('F7', 6)) === 6, ctx.outline.toolLines(klartext.id))
  h.check('and steps through them', (await step('F7', 17)) === 17 && (await step('F7', 35)) === 35, ctx.outline.toolLines(klartext.id))

  // ------------------------------------------------------------ a program with no tool change
  const bare = ctx.files.newUntitled({ profileId: 'fanuc-gcode', text: NO_TOOLS })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === bare, { timeout: 10000 })
  await revealLine(h, bare, 3, 1)
  h.focusEditor()
  await h.nativeKeys([{ key: 'F7' }])
  await h.waitFor(() => message() === 'This program has no tool changes.', { timeout: 4000 })
  h.check('F7 in a program without a tool change says so and leaves the cursor', message() === 'This program has no tool changes.' && cursor() === 3, { message: message(), cursor: h.app.cursor() })

  // ------------------------------------------------------------ F7 with the program map hidden
  // The outline index is built by whoever asks for it first, and that is normally the
  // program map. With the left region hidden the panel never mounts (a state M2 persists
  // across restarts), so F7 is the first caller — and reading the index it has just
  // created reported "This program has no tool changes." on a program full of them.
  await ctx.commands.run('view.toggleSidePanel')
  await h.waitFor(() => !h.q('program-map'), { timeout: 5000 })
  h.check('the program map is not mounted, so nothing else starts the outline', !h.q('program-map'), h.qa('panel').map((e) => e.dataset.panel))

  const late = ctx.files.newUntitled({ profileId: 'fanuc-gcode', text: lateToolProgram() })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === late, { timeout: 20000 })
  await revealLine(h, late, 1, 1)
  h.focusEditor()
  // The "no tool changes" message of the previous section is still on screen for a few
  // seconds; clearing it is what makes the check below read *this* F7.
  ctx.status.clear()
  await h.waitFor(() => message() === '', { timeout: 4000 })
  await h.nativeKeys([{ key: 'F7' }])
  const landed = await h.waitFor(() => (cursor() === LATE_TOOL_LINE ? cursor() : undefined), { timeout: 30000 })
  h.check('the first F7 waits for the build instead of reporting an empty program', landed === LATE_TOOL_LINE && message() !== 'This program has no tool changes.', {
    cursor: h.app.cursor(),
    message: message(),
    toolLines: ctx.outline.toolLines(late),
  })

  await ctx.commands.run('view.toggleSidePanel')
  await h.waitFor(() => !!h.q('program-map'), { timeout: 5000 })
  h.check('the program map is back', !!h.q('program-map'))

  // ------------------------------------------------------------ Ctrl+G
  const packed = await openFixture(h, 'nc/fanuc/f02-packed.nc')
  const prompt = () => h.q('modal', { modal: 'prompt' })
  const input = () => h.q('form-field', { field: 'value' })
  const okButton = () => /** @type {HTMLButtonElement} */ (h.q('modal-ok'))

  /** Opens the prompt with the shortcut, or with the command when `viaKey` is false. */
  const open = async (/** @type {boolean} */ viaKey) => {
    if (viaKey) {
      h.focusEditor()
      await h.nativeKeys([{ key: 'g', mods: ['ctrl'] }])
    } else {
      // `nav.goto` only settles when the prompt is answered, so it must not be awaited.
      void ctx.commands.run('nav.goto')
    }
    if (!(await h.waitFor(() => !!prompt(), { timeout: 5000 }))) throw new Error('the go-to prompt did not open')
  }
  /** Types an answer and confirms it. */
  const answer = async (/** @type {string} */ text) => {
    setInput(input(), text)
    await h.waitFor(() => okButton().disabled === false, { timeout: 3000 })
    h.click(okButton())
    await h.waitFor(() => !prompt(), { timeout: 5000 })
    await h.idle()
  }

  await revealLine(h, packed.id, 1, 1)
  await open(true)
  h.check('Ctrl+G opens the gEdit prompt', !!prompt(), h.qa('modal').map((e) => e.dataset.modal))
  h.check("Monaco's own go-to-line did not open: the binding is removed", !quickInputShowing(), [...document.querySelectorAll('.quick-input-widget')].map((e) => getComputedStyle(e).display))
  h.check('it is the only modal on screen', h.qa('modal').length === 1)
  h.check('an empty prompt cannot be confirmed', okButton().disabled === true, input()?.dataset.error)
  setInput(input(), 'nonsense')
  await h.waitFor(() => !!input()?.dataset.error, { timeout: 3000 })
  h.check('something that is neither a line nor a block is reported, not guessed at', okButton().disabled === true && input()?.dataset.error === 'navigation.gotoInvalid', input()?.dataset.error)

  await answer('N120')
  h.check('N120 goes to the block, not to line 120', cursor() === 17, { cursor: h.app.cursor(), line: ctx.editor.getLines(packed.id, 17, 17) })

  await open(true)
  await answer('12')
  h.check('a bare number goes to the line', cursor() === 12, h.app.cursor())

  // `N10` is on lines 4 and 5 (`N10G0G90X0Y0` and `N10T1M6`): the search starts at the
  // cursor, so repeating Ctrl+G walks the duplicates instead of finding the same one.
  await revealLine(h, packed.id, 1, 1)
  await open(true)
  await answer('N10')
  h.check('a duplicated block number finds the first one after the cursor', cursor() === 4, h.app.cursor())
  await open(true)
  await answer('N10')
  h.check('asking again walks to the next one', cursor() === 5, h.app.cursor())
  await open(true)
  await answer('N10')
  h.check('and then wraps back to the first', cursor() === 4, h.app.cursor())

  // ------------------------------------------------------------ what is not there
  await open(false)
  h.check('the command opens the same prompt as the shortcut', !!prompt())
  await answer('N9999')
  await h.waitFor(() => message().includes('9999'), { timeout: 4000 })
  h.check('a block that is nowhere says so and leaves the cursor alone', cursor() === 4 && message() === 'No block 9999 in this program.' && h.q('status-message')?.dataset.error === '1', {
    cursor: h.app.cursor(),
    message: message(),
    error: h.q('status-message')?.dataset.error,
  })

  await open(true)
  await answer('9999')
  await h.waitFor(() => message().includes('ends at line'), { timeout: 4000 })
  h.check('a line past the end says where the program ends and does not move', cursor() === 4 && message() === `The program ends at line ${ctx.editor.getLineCount(packed.id)}.` && h.q('status-message')?.dataset.error === '1', {
    cursor: h.app.cursor(),
    message: message(),
    lineCount: ctx.editor.getLineCount(packed.id),
  })

  // ------------------------------------------------------------ Esc
  await open(true)
  setInput(input(), '2')
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !prompt(), { timeout: 5000 })
  h.check('Esc closes the prompt and the cursor stays where it was', !prompt() && cursor() === 4, h.app.cursor())

  h.check('navigation moved cursors only: no file was modified', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
