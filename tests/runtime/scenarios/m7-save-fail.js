// A save that cannot be carried out (plan §5 M7, AD-21, WP7.3; H7's "a save that fails
// midway"). The other half of `m7-backup`: there the copy is made, here it is the only
// thing between a programmer and a program that is gone.
//
// gEdit writes **in place** (P1 AD-7: identity and ACLs on a share), and an in-place
// write truncates before the first byte lands. So a write that fails can leave the file
// shorter than it was — which is why the copy is taken immediately before it, and why
// the failure names the copy instead of apologising. Two failures, each with both
// answers:
//
//   1. **the write fails** — the copy was made, the message says where it is, Cancel
//      leaves the tab exactly as it was, and Save As gets the work onto another file.
//      Reached by **Save As onto a file this user may not write**, and it has to be:
//      plain Save never gets there any more. The file is made unwritable with `chflags
//      uchg`, and since the G8 M7 fix `files_stat` answers "may **this user** write
//      it" rather than "may nobody write it" — so AD-23 catches the immutable flag the
//      same way it catches mode 444, and Save goes to Save As before a copy is made or
//      a byte is truncated. (Part A checks that too, on the way past.) A target the
//      user has just picked and confirmed in the native dialog is deliberately not
//      pre-checked (§7.2: the guard asks about the file the document *owns*), so that
//      is the one path left to `open(2)`'s refusal — and it is the real one: Save As
//      onto a released program that is locked.
//   2. **the copy fails** — the question is asked before anything is written, and
//      **Cancel writes nothing at all**: the file on disk is still the last good
//      version and the buffer still holds the new one. That sentence is what makes
//      Cancel safe to press, and it is the one this scenario exists for. Then the same
//      question answered with "Save Without a Backup", which must save.
//
// Produced with a **directory** at `prog.nc.bak` in `sibling` mode: `backup.rs` refuses
// to overwrite anything that is not a plain file there, which is a refusal a user can
// really run into (a folder watcher's spool, a `.bak` directory from another tool) and
// needs no flag at all.
//
// Every "nothing was written" check is `h.disk.hex` of the whole file: a truncation that
// left the first kilobyte in place would pass a `includes()` and fail this.

import { scenario } from '../lib/index.js'
import { context, copyFile, historyOf, openPath, osOp, ready, whileImmutable } from './m7-common.js'

const version = (/** @type {string} */ mark) => `%\nO0200 (VERSION ${mark})\nG0 X1.\nM30\n%\n`

scenario('m7-save-fail', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  const source = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const prog = `${h.cfg.run}/work/prog.nc`
  await copyFile(h, source, prog)
  const { id } = await openPath(h, prog)
  const onDisk = await h.disk.hex(prog)

  // =============================================================== A. the write fails
  ctx.editor.replaceAll(id, version('UNWRITTEN'))
  await h.waitFor(() => !!h.q('doc-tab', { docId: id, dirty: '1' }), { timeout: 8000 })
  const typed = ctx.editor.getText(id)

  await whileImmutable(h, prog, async () => {
    // --- Save never reaches the write at all (AD-23) ------------------------------
    // The immutable flag makes this a file this user may not write, and `files_stat`
    // now says so, so Save goes to Save As **before** a copy is made and before an
    // in-place write can truncate anything. The Save As is cancelled, so nothing at
    // all happens — which is the point of the two checks under it.
    await h.dialogs.queue('save', null)
    h.check('Save on a file this user may not write goes to Save As', (await ctx.files.save(id)) === false)
    await h.idle()
    h.check(
      'and nothing was copied or written on the way there',
      (await historyOf(h, prog)).length === 0 && (await h.disk.hex(prog)) === onDisk,
      { copies: (await historyOf(h, prog)).map((e) => e.name) },
    )

    // --- Cancel -------------------------------------------------------------------
    // Save As **onto** that same file: the one path left to a write that fails. The
    // alert is answered before anything else is asked of the app: listing a folder
    // goes through the script backend (`m2-common.js`), and running a script while a
    // native modal owns the main thread is a race this scenario does not need to take.
    await h.dialogs.queue('save', prog)
    const saving = ctx.files.saveAs(id)
    const alert = await h.alert.wait({ timeout: 20000 })
    h.check('it offers to put the work somewhere else', (alert?.buttons ?? []).includes('Save As…'), alert?.buttons)

    await h.alert.click('Cancel')
    h.check('the save reports that it did not happen', (await saving) === false)
    await h.idle()

    const copies = await historyOf(h, prog)
    h.check('the copy was made before the write was attempted', copies.length === 1 && copies[0].hex === onDisk, { entries: copies.map((e) => e.name) })
    h.check(
      'and the failure said where that copy is, in the message itself',
      copies.length === 1 && (alert?.texts ?? []).some((/** @type {string} */ text) => text.includes(copies[0].path)),
      { path: copies[0]?.path, texts: alert?.texts },
    )

    h.check('the file on disk is untouched — the same bytes, not a shorter file', (await h.disk.hex(prog)) === onDisk, { now: (await h.disk.hex(prog)).length, before: onDisk.length })
    h.check('the tab still holds the work, still unsaved', ctx.editor.getText(id) === typed && ctx.docs.get(id)?.dirty === true, { dirty: ctx.docs.get(id)?.dirty })

    // --- Save As ------------------------------------------------------------------
    // The same failure, taken up on its offer: the buffer is the only full copy of the
    // new version, and this is the way out the message points at.
    const elsewhere = `${h.cfg.run}/work/rescued.nc`
    // Two answers: the locked file again for the Save As that fails, and the rescue
    // path for the Save As the failure itself offers.
    await h.dialogs.queue('save', prog)
    await h.dialogs.queue('save', elsewhere)
    const retry = ctx.files.saveAs(id)
    await h.alert.wait({ timeout: 20000 })
    await h.alert.click('Save As…')
    h.check('Save As from the failure saves', (await retry) === true)
    await h.idle()
    h.check('the work is on the other file', (await h.disk.read(elsewhere)).includes('(VERSION UNWRITTEN)'), (await h.disk.read(elsewhere)).slice(0, 40))
    h.check('and the file that could not be written is still its old self', (await h.disk.hex(prog)) === onDisk)
  })

  // The document now belongs to the rescued file. Open the original again for part B.
  const second = await openPath(h, prog)
  h.check('the program reopens as what it always was', ctx.editor.getText(second.id).includes('(WRITTEN FOR GEDIT'), ctx.editor.getText(second.id).slice(0, 40))

  // =============================================================== B. the copy fails
  await ctx.settings.save({ 'files.backup': 'sibling' })
  await h.waitFor(() => ctx.settings.get('files.backup') === 'sibling', { timeout: 5000 })
  const blocked = await osOp(h, 'mkdir', `${prog}.bak`)
  h.check('there is a directory where the sibling copy would go', blocked.isDir === true, blocked)

  ctx.editor.replaceAll(second.id, version('AFTER THE QUESTION'))
  await h.waitFor(() => !!h.q('doc-tab', { docId: second.id, dirty: '1' }), { timeout: 8000 })
  const wanted = ctx.editor.getText(second.id)

  // --- Cancel: nothing at all is written ---------------------------------------
  const asking = ctx.files.save(second.id)
  const question = await h.alert.wait({ timeout: 20000 })
  h.check('a copy that cannot be made is a question, not a silent save', (question?.buttons ?? []).includes('Save Without a Backup'), question?.buttons)
  h.check('and Cancel is offered beside it', (question?.buttons ?? []).includes('Cancel'), question?.buttons)

  await h.alert.click('Cancel')
  h.check('cancelling the question cancels the save', (await asking) === false)
  await h.idle()
  h.check('and writes nothing at all: the file on disk is the last good version', (await h.disk.hex(prog)) === onDisk, { now: (await h.disk.hex(prog)).length, before: onDisk.length })
  h.check('the new version is still in the tab, unsaved', ctx.editor.getText(second.id) === wanted && ctx.docs.get(second.id)?.dirty === true)
  h.check('and the directory in the way was not written over', (await osOp(h, 'stat', `${prog}.bak`)).isDir === true, await osOp(h, 'stat', `${prog}.bak`))

  // --- Save Without a Backup ----------------------------------------------------
  const anyway = ctx.files.save(second.id)
  await h.alert.wait({ timeout: 20000 })
  await h.alert.click('Save Without a Backup')
  h.check('answering "save anyway" saves', (await anyway) === true)
  await h.idle()
  h.check('the file on disk is the new version', (await h.disk.read(prog)).includes('(VERSION AFTER THE QUESTION)'), (await h.disk.read(prog)).slice(0, 40))
  h.check('the tab is clean again', ctx.docs.get(second.id)?.dirty === false)
  h.check('and the copy really was skipped — the folder in the way is still a folder', (await osOp(h, 'stat', `${prog}.bak`)).isDir === true)
  // Nothing was added to the history folder here: this file backs up as a sibling now.
  // What is in it is part A's two attempts — each one copied the file before it tried to
  // write it, which is the rule, and both copies are of the same good version because
  // neither write ever landed.
  const kept = await historyOf(h, prog)
  h.check('the history folder holds one copy per attempted write, and no more', kept.length === 2, kept.map((e) => e.name))
  h.check('and every one of them is the good version', kept.every((e) => e.hex === onDisk), kept.map((e) => e.name))
})
