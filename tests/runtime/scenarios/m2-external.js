// Files that change under the editor (plan §5 M2 H2 `m2-external`, AD-10, WP2.3): the
// silent reload of a clean document, the banner of a dirty one with all three answers,
// and the file that is taken away.
//
// The first change is left to the 2 s poll, because that is the mechanism AD-10 chose
// over an fs watch and nothing else proves it runs; the later ones go through
// `external.checkNow()`, so the scenario does not spend two seconds per step.
//
// The undo check is the other half of "silent": a reload is one undo step (AD-5), so the
// text the user had is one Cmd+Z away. It is triggered through the editor action, because
// the macOS Edit menu owns Cmd+Z as a key equivalent and a posted NSEvent never reaches
// the page (m1-keys).

import { scenario } from '../lib/index.js'
import { removeFile } from './m2-common.js'

scenario('m2-external', { timeout: 240 }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const file = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const tab = () => h.q('doc-tab', { path: file })
  const banner = () => h.q('external-banner')
  const action = (/** @type {string} */ name) => /** @type {HTMLElement | null} */ (banner()?.querySelector(`[data-action="${name}"]`) ?? null)

  await h.dialogs.queue('open', [file])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => !!tab(), { timeout: 10000 })
  const id = ctx.docs.byPath(file).id
  const original = ctx.editor.getText(id)
  h.check('the file is open and clean', tab()?.dataset.dirty === '0' && tab()?.dataset.external === 'none', { dirty: tab()?.dataset.dirty, external: tab()?.dataset.external })
  h.check('the default policy is to reload', ctx.settings.get('files.externalChange') === 'reload', ctx.settings.get('files.externalChange'))

  // ------------------------------------------------------------ clean: silent reload
  await h.disk.write(file, `${original}\n(POST RAN AGAIN)\n`)
  // No checkNow: this is the 2 s poll of AD-10 doing its job while the window has focus.
  const reloaded = await h.waitFor(() => ctx.editor.getText(id).includes('(POST RAN AGAIN)'), { timeout: 8000 })
  h.check('the poll notices a change to a clean document on its own', reloaded === true, { text: ctx.editor.getText(id).slice(-40) })
  h.check('and reloads it silently: no banner, no marker, still clean', !banner() && tab()?.dataset.dirty === '0' && tab()?.dataset.external === 'none', {
    banner: banner()?.outerHTML?.slice(0, 120),
    dirty: tab()?.dataset.dirty,
    external: tab()?.dataset.external,
  })

  ctx.editor.triggerAction('undo')
  await h.waitFor(() => ctx.editor.getText(id) === original, { timeout: 5000 })
  h.check('one undo brings the text the user had back (AD-5: the reload is one step)', ctx.editor.getText(id) === original)
  ctx.editor.triggerAction('redo')
  await h.waitFor(() => tab()?.dataset.dirty === '0', { timeout: 5000 })
  h.check('redo puts the file back and the document is clean again', ctx.editor.getText(id).includes('(POST RAN AGAIN)') && tab()?.dataset.dirty === '0', { dirty: tab()?.dataset.dirty })

  // ------------------------------------------------------------ an auto-reload that cannot be done
  // G8 M2: `external.reload()` cleared the "a change is already reported for this
  // (mtime, size)" guard *before* awaiting `files.reloadFromDisk`, which reports the
  // failure and changes nothing when the bytes do not decode. The stamp had not moved and
  // the guard was gone, so the next tick read the file and auto-reloaded it again — a
  // native modal error dialog every two seconds, for ever, under the default `reload`
  // policy. The reload now falls back to the banner and is not retried for those bytes.
  const kept = ctx.editor.getText(id)
  // `dialogs.error` logs before it shows the native dialog, so this one console error is
  // part of the behaviour being tested. The pattern names this failure and no other.
  h.allowErrors(/Could not reload .*NUL bytes/)
  // 40 NUL bytes in the middle of 50: `decodeFile` calls that binary (AD-7), which is what
  // a partially written post output or a binary file copied over the .nc looks like.
  await h.disk.write(file, { base64: btoa(`G1 X1${'\u0000'.repeat(40)}Y2 Z3\n`) })
  void ctx.external.checkNow()
  const failure = await h.alert.wait({ timeout: 10000 })
  h.check('bytes that cannot be decoded are reported once', !!failure && /f01-mill-3tools\.nc/.test((failure?.texts ?? []).join(' ')), failure)
  await h.alert.click('OK|Ok')
  await h.waitFor(() => !!banner(), { timeout: 5000 })
  h.check('and the banner asks instead, with the buffer untouched', tab()?.dataset.external === 'changed' && ctx.editor.getText(id) === kept, {
    external: tab()?.dataset.external,
    banner: !!banner(),
  })

  // Three poll intervals with no further dialog: the retry loop is what is being checked.
  await ctx.external.checkNow()
  await h.sleep(6500)
  h.check('the following polls do not try it again', (await h.alert.visible()) === null && tab()?.dataset.external === 'changed' && ctx.editor.getText(id) === kept, {
    alert: await h.alert.visible(),
    external: tab()?.dataset.external,
  })

  // A file that decodes again is picked up normally: the guard is per (mtime, size).
  await h.disk.write(file, `${original}\n(POST RAN AGAIN)\n`)
  await ctx.external.checkNow()
  await h.waitFor(() => tab()?.dataset.external === 'none' && !banner(), { timeout: 8000 })
  h.check('a file that decodes again reloads as usual', ctx.editor.getText(id).includes('(POST RAN AGAIN)') && tab()?.dataset.dirty === '0' && !banner(), {
    external: tab()?.dataset.external,
    dirty: tab()?.dataset.dirty,
  })

  // ------------------------------------------------------------ dirty: the banner
  const mine = '(MINE)\n'
  ctx.editor.reveal(id, 1, 1)
  ctx.editor.insertText(mine)
  await h.waitFor(() => tab()?.dataset.dirty === '1', { timeout: 5000 })
  await h.disk.write(file, `${original}\n(POST RAN A THIRD TIME)\n`)
  await ctx.external.checkNow()
  await h.waitFor(() => !!banner(), { timeout: 5000 })
  h.check('a dirty document gets the banner instead of a reload', banner()?.dataset.docId === String(id) && banner()?.dataset.external === 'changed', {
    docId: banner()?.dataset.docId,
    external: banner()?.dataset.external,
  })
  h.check('the tab carries the marker', tab()?.dataset.external === 'changed', tab()?.dataset.external)
  h.check('the buffer is untouched', ctx.editor.getText(id).startsWith(mine))
  const actions = [...(banner()?.querySelectorAll('[data-action]') ?? [])].map((e) => /** @type {HTMLElement} */ (e).dataset.action)
  h.check('it offers reload, keep mine and compare', JSON.stringify(actions) === JSON.stringify(['reload', 'keep', 'compare']), actions)

  // Compare, from the banner: the overlay opens on the saved version of that document.
  h.click(action('compare'))
  await h.waitFor(() => !!h.q('compare-view'), { timeout: 15000 })
  h.check('Compare opens the diff against the saved version', h.q('compare-view')?.dataset.source === 'saved' && !h.q('editor-host'), h.q('compare-view')?.dataset.source)
  // Wait for a rendered change, not just for the overlay: the buffer and the file really
  // differ here, so a decoration is the signal that the worker has answered. Closing
  // before that is the "closed before its first diff" case, which `m2-compare` owns and
  // checks on purpose — riding it here by accident only made this scenario flaky (I2 §2.3,
  // and see the M2 fixes hand-off: it is deterministic while the diff worker is cold).
  const diffShown = () => !!h.q('compare-view')?.querySelector('.line-insert, .line-delete, .char-insert, .char-delete')
  await h.waitFor(diffShown, { timeout: 15000 })
  h.check('and shows the difference it found', diffShown())
  await ctx.commands.run('compare.close')
  await h.waitFor(() => !!h.q('editor-host'), { timeout: 10000 })
  h.check('closing it comes back to the editor with the banner still up', !!banner() && ctx.editor.getText(id).startsWith(mine), { banner: !!banner() })

  // Reload: the disk wins, the document is clean and the banner is gone.
  h.click(action('reload'))
  await h.waitFor(() => !banner(), { timeout: 5000 })
  h.check('Reload takes the file as it is on disk', ctx.editor.getText(id).includes('(POST RAN A THIRD TIME)') && !ctx.editor.getText(id).startsWith(mine))
  h.check('and the document is clean, with no marker left', tab()?.dataset.dirty === '0' && tab()?.dataset.external === 'none', { dirty: tab()?.dataset.dirty, external: tab()?.dataset.external })

  // ------------------------------------------------------------ Keep mine
  ctx.editor.reveal(id, 1, 1)
  ctx.editor.insertText(mine)
  await h.waitFor(() => tab()?.dataset.dirty === '1', { timeout: 5000 })
  await h.disk.write(file, `${original}\n(POST RAN A FOURTH TIME)\n`)
  await ctx.external.checkNow()
  await h.waitFor(() => !!banner(), { timeout: 5000 })
  h.click(action('keep'))
  await h.waitFor(() => !banner(), { timeout: 5000 })
  h.check('Keep mine keeps the buffer and closes the banner', ctx.editor.getText(id).startsWith(mine) && !banner())
  h.check('the document stays modified', tab()?.dataset.dirty === '1' && tab()?.dataset.external === 'none', { dirty: tab()?.dataset.dirty, external: tab()?.dataset.external })
  await ctx.external.checkNow()
  await h.sleep(400)
  h.check('and the next poll does not raise it again (the stamp was kept)', !banner())

  await ctx.files.save(id)
  await h.waitFor(async () => (await h.disk.read(file)).startsWith(mine), { timeout: 5000 })
  h.check('saving after Keep mine overwrites what was on disk', (await h.disk.read(file)).startsWith(mine) && tab()?.dataset.dirty === '0', { dirty: tab()?.dataset.dirty })

  // ------------------------------------------------------------ the file is taken away
  await removeFile(h, file)
  await ctx.external.checkNow()
  await h.waitFor(() => tab()?.dataset.external === 'deleted', { timeout: 5000 })
  h.check('a deleted file marks the tab', tab()?.dataset.external === 'deleted', tab()?.dataset.external)
  h.check('the buffer is kept and the document is modified again', ctx.editor.getText(id).startsWith(mine) && tab()?.dataset.dirty === '1', { dirty: tab()?.dataset.dirty })
  h.check('the status bar says so', h.q('status-message')?.dataset.error === '1' && /f01-mill-3tools\.nc/.test(h.q('status-message')?.textContent ?? ''), h.q('status-message')?.textContent)
  await h.waitFor(() => !!banner(), { timeout: 5000 })
  const goneActions = [...(banner()?.querySelectorAll('[data-action]') ?? [])].map((e) => /** @type {HTMLElement} */ (e).dataset.action)
  h.check('the banner offers only Keep for a file that is gone', JSON.stringify(goneActions) === JSON.stringify(['keep']), goneActions)
  h.check('the banner names the deleted document', banner()?.dataset.external === 'deleted' && banner()?.dataset.docId === String(id), banner()?.dataset.external)

  h.click(action('keep'))
  await h.waitFor(() => !banner(), { timeout: 5000 })
  await ctx.external.checkNow()
  await h.sleep(400)
  h.check('Keep stops the watch for a file that is gone', !banner() && ctx.docs.get(id).disk === null && ctx.editor.getText(id).startsWith(mine), {
    disk: ctx.docs.get(id).disk,
    external: tab()?.dataset.external,
  })
})
