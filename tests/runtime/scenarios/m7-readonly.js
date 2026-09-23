// Read-only programs (plan §5 M7 H7 `m7-readonly`, AD-23, WP7.3).
//
// Two locks that look alike and are not the same thing, which is the whole of AD-23:
//
//   `attribute`  the **file** carries the read-only bit. gEdit never changes a file's
//                attributes, so unlocking the tab frees the buffer and nothing else —
//                and a Save still has to go somewhere else, for ever.
//   `user`       the **tab** is locked by the programmer, to keep a hand off a proven
//                program. Nothing on disk was touched, so unlocking it makes Save an
//                ordinary save again.
//
// The difference is invisible until somebody presses Cmd+S over a proven program, and
// then it is the difference between "choose where to put it" and a file overwritten on
// the machine's own share. So every claim below is made twice, once per lock.
//
// The refused keystroke is checked as a *model* that did not change plus Monaco's own
// message element — not as a translated sentence: the message's wording is `i18n`'s to
// change, while "the editor put a message on screen and the text is unchanged" is the
// behaviour.

import { scenario } from '../lib/index.js'
import { context, copyFile, openPath, osOp, ready } from './m7-common.js'

/** Monaco's overlay for a keystroke it refused (`readOnlyMessage`). */
const refusalShowing = () => document.querySelector('.monaco-editor-overlaymessage') !== null

/** The lock in the status bar; absent while the document is editable. */
const lockItem = (/** @type {any} */ h) => h.q('status-item', { item: 'readonly' })

scenario('m7-readonly', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  const source = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const locked = `${h.cfg.run}/work/proven.nc`
  const normal = `${h.cfg.run}/work/normal.nc`
  await copyFile(h, source, locked)
  await copyFile(h, source, normal)

  const mode = await osOp(h, 'chmod', locked, { mode: '444' })
  h.check('the program on disk is read-only before it is opened', mode.mode === '444', mode)
  const untouched = await h.disk.hex(locked)

  // =============================================================== A. the file's own bit
  const { id } = await openPath(h, locked)
  h.check('it opens locked', ctx.docs.get(id)?.readOnly === true, { readOnly: ctx.docs.get(id)?.readOnly })
  h.check('and says which lock it is: the file’s own attribute', ctx.docs.get(id)?.readOnlyReason === 'attribute', ctx.docs.get(id)?.readOnlyReason)
  h.check('the tab carries it', h.q('doc-tab', { docId: id })?.dataset.readonly === '1', h.q('doc-tab', { docId: id })?.dataset.readonly)
  h.check('the status bar shows the lock, with the reason (§7.12)', lockItem(h)?.dataset.reason === 'attribute', lockItem(h)?.dataset.reason)
  h.check('and the editor itself is read-only, not just the chrome', ctx.editor.editorInstance()?.getRawOptions().readOnly === true, ctx.editor.editorInstance()?.getRawOptions().readOnly)

  // A real keystroke, because "the editor option is set" and "the program cannot be
  // changed" are two different claims and only the second one matters.
  const before = ctx.editor.getText(id)
  h.focusEditor()
  await h.idle()
  await h.nativeType('G0X99')
  await h.idle()
  h.check('typing into it changes nothing', ctx.editor.getText(id) === before, ctx.editor.getText(id).slice(0, 40))
  h.check('the document stays clean', ctx.docs.get(id)?.dirty === false)
  h.check('and the editor says why rather than swallowing the key', refusalShowing(), document.querySelector('.monaco-editor-overlaymessage')?.textContent)

  // Cmd+S over a program that was opened to be read. There is nothing to write, and
  // `fileOps.saveOutcome` answers that **before** the read-only branch on purpose — a
  // Save As dialog over a program nobody changed would be a question about nothing.
  const calls = h.dialogs.calls().length
  h.check('Save of a locked program that nobody could change is a no-op', (await ctx.files.save(id)) === true)
  await h.idle()
  h.check('and it puts no dialog in the way of a keystroke that meant nothing', h.dialogs.calls().length === calls, h.dialogs.calls().at(-1))
  h.check('the file on disk is untouched', (await h.disk.hex(locked)) === untouched)

  // =============================================================== B. unlocking the tab
  // The unlock frees the buffer and **not** the file: gEdit never changes a file's
  // attributes, so this save has to go somewhere else too. That sentence is AD-23, and
  // this is where "Save goes to Save As" is really put to the test — a *locked* document
  // can never become unsaved in the first place, because every keystroke into it was
  // refused a moment ago.
  await ctx.commands.run('file.toggleReadOnly')
  await h.waitFor(() => ctx.docs.get(id)?.readOnly === false, { timeout: 8000 })
  h.check('unlocking the tab clears the reason with it', ctx.docs.get(id)?.readOnlyReason === null, ctx.docs.get(id)?.readOnlyReason)
  h.check('the lock leaves the status bar', lockItem(h) === null)
  h.check('and the editor takes text again', ctx.editor.editorInstance()?.getRawOptions().readOnly === false)

  h.focusEditor()
  await h.idle()
  await h.nativeType('(EDITED)')
  await h.waitFor(() => ctx.docs.get(id)?.dirty === true, { timeout: 8000 })
  h.check('the buffer is editable now', ctx.editor.getText(id) !== before && ctx.docs.get(id)?.dirty === true, ctx.editor.getText(id).slice(0, 40))

  await h.dialogs.queue('save', null)
  const calls2 = h.dialogs.calls().length
  h.check('but saving it still does not write that file', (await ctx.files.save(id)) === false)
  await h.idle()
  h.check('it asks where to put it, again', h.dialogs.calls().length === calls2 + 1 && h.dialogs.calls().at(-1)?.kind === 'save', h.dialogs.calls().at(-1))
  h.check('and the read-only file on disk is still byte for byte what it was', (await h.disk.hex(locked)) === untouched)

  // =============================================================== C. the tab lock
  const plain = await openPath(h, normal)
  const plainBytes = await h.disk.hex(normal)
  h.check('an ordinary program opens editable, with no lock in the status bar', ctx.docs.get(plain.id)?.readOnly === false && lockItem(h) === null)

  await ctx.commands.run('file.toggleReadOnly')
  await h.waitFor(() => ctx.docs.get(plain.id)?.readOnly === true, { timeout: 8000 })
  h.check('the command locks it', h.q('doc-tab', { docId: plain.id })?.dataset.readonly === '1')
  h.check('and says this lock is the user’s, not the file’s', lockItem(h)?.dataset.reason === 'user', lockItem(h)?.dataset.reason)

  const plainText = ctx.editor.getText(plain.id)
  h.focusEditor()
  await h.idle()
  await h.nativeType('M30')
  await h.idle()
  h.check('a locked tab refuses the keyboard as well', ctx.editor.getText(plain.id) === plainText && ctx.docs.get(plain.id)?.dirty === false)

  await ctx.commands.run('file.toggleReadOnly')
  await h.waitFor(() => ctx.docs.get(plain.id)?.readOnly === false, { timeout: 8000 })
  h.focusEditor()
  await h.idle()
  await h.nativeType('(OK)')
  await h.waitFor(() => ctx.docs.get(plain.id)?.dirty === true, { timeout: 8000 })
  const dialogsBefore = h.dialogs.calls().length
  h.check('unlocking a tab the user locked makes Save an ordinary save again', (await ctx.files.save(plain.id)) === true)
  await h.idle()
  h.check('with no dialog in the way', h.dialogs.calls().length === dialogsBefore, h.dialogs.calls().at(-1))
  h.check('and the change is on disk', (await h.disk.hex(normal)) !== plainBytes && (await h.disk.read(normal)).includes('(OK)'))
})
