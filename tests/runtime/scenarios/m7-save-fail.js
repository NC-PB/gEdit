// A save that cannot be carried out (plan §5 M7, AD-21, WP7.3; H7's "a save that fails
// midway"). The other half of `m7-backup`: there the copy is made, here it is the only
// thing between a programmer and a program that is gone.
//
// gEdit writes **in place** (P1 AD-7: identity and ACLs on a share), and an in-place
// write truncates before the first byte lands. So a write that fails can leave the file
// shorter than it was — which is why the copy is taken immediately before it, and why
// the failure names the copy instead of apologising. Three failures, each with both
// answers:
//
//   1. **the write would fail** — a file this user may not write. Since M9 (WP9.5b) the
//      app finds that out **before** anything happens to it, in both ways to reach it:
//      plain Save goes to Save As (AD-23, `files_stat` answers "may **this user** write
//      it", so the immutable flag set with `chflags uchg` counts like mode 444), and a
//      Save As **onto** such a file (the path a user picks and confirms in the native
//      dialog) is checked too and goes back to the dialog, with no copy made and no byte
//      truncated. Cancel at the dialog leaves the tab exactly as it was, and choosing
//      another file gets the work onto it.
//   1b. **the write fails once it has begun** — the branch the copy exists for. A file
//      this user may write, on a volume with no room (a 1 MB disk image, filled): the
//      stat lets the save through, the copy is made, the open truncates the file and the
//      first bytes of the new text meet `ENOSPC`. The message says where the copy is,
//      Cancel leaves the tab exactly as it was, and Save As gets the work onto another
//      file. Nothing else in the harness can fail a write after a stat that said yes, and
//      before this part M9 had left that branch to two unit tests.
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
import { context, copyFile, historyOf, openPath, osOp, ready, whileImmutable, withSmallVolume } from './m7-common.js'

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
    // Save As **onto** that same file: the target is found read-only before anything
    // happens to it (M9, WP9.5b), so the dialog comes back; cancelling it ends the save.
    await h.dialogs.queue('save', prog)
    await h.dialogs.queue('save', null)
    const saved = await ctx.files.saveAs(id)
    h.check('the save reports that it did not happen', saved === false)
    await h.idle()

    const copies = await historyOf(h, prog)
    h.check('no copy was made of a file the work was never going to replace', copies.length === 0, { entries: copies.map((e) => e.name) })
    h.check('the file on disk is untouched — the same bytes, not a shorter file', (await h.disk.hex(prog)) === onDisk, { now: (await h.disk.hex(prog)).length, before: onDisk.length })
    h.check('the tab still holds the work, still unsaved', ctx.editor.getText(id) === typed && ctx.docs.get(id)?.dirty === true, { dirty: ctx.docs.get(id)?.dirty })

    // --- Save As ------------------------------------------------------------------
    // The same pick, answered the second time with another file: the buffer is the only
    // full copy of the new version, and this is the way out.
    const elsewhere = `${h.cfg.run}/work/rescued.nc`
    await h.dialogs.queue('save', prog)
    await h.dialogs.queue('save', elsewhere)
    h.check('Save As from the locked file’s pick saves to the file chosen next', (await ctx.files.saveAs(id)) === true)
    await h.idle()
    h.check('the work is on the other file', (await h.disk.read(elsewhere)).includes('(VERSION UNWRITTEN)'), (await h.disk.read(elsewhere)).slice(0, 40))
    h.check('and the file that could not be written is still its old self', (await h.disk.hex(prog)) === onDisk)
  })

  // ============================================== A2. the write fails once it has begun
  const mount = `${h.cfg.run}/work/full`
  await withSmallVolume(h, mount, async () => {
    const target = `${mount}/full.nc`
    await copyFile(h, source, target)
    const full = await openPath(h, target)
    const before = await h.disk.hex(target)
    // The volume is full from here on; the file on it is one this user may write.
    await osOp(h, 'fill', mount)
    const text = `%\nO0300 (VERSION NO ROOM)\n${'G1 X1.\n'.repeat(30000)}M30\n%\n`
    ctx.editor.replaceAll(full.id, text)
    await h.waitFor(() => !!h.q('doc-tab', { docId: full.id, dirty: '1' }), { timeout: 20000 })
    const work = ctx.editor.getText(full.id)

    const saving = ctx.files.save(full.id)
    const alert = await h.alert.wait({ timeout: 30000 })
    h.check('a write that begins and fails is a question: the work can go somewhere else', (alert?.buttons ?? []).includes('Save As…') && (alert?.buttons ?? []).includes('Cancel'), alert?.buttons)
    await h.alert.click('Cancel')
    h.check('cancelling it reports that the save did not happen', (await saving) === false)
    await h.idle()

    const copies = await historyOf(h, target)
    h.check('the copy was made before the write was attempted: the previous version, byte for byte', copies.length === 1 && copies[0].hex === before, { entries: copies.map((e) => e.name) })
    h.check(
      'and the failure said where that copy is, in the message itself',
      copies.length === 1 && (alert?.texts ?? []).some((/** @type {string} */ line) => line.includes(copies[0].path)),
      { path: copies[0]?.path, texts: alert?.texts },
    )
    h.check('the tab still holds the work, still unsaved', ctx.editor.getText(full.id) === work && ctx.docs.get(full.id)?.dirty === true, { dirty: ctx.docs.get(full.id)?.dirty })

    // Save As, which is what the alert offered: the buffer is the only full copy of the
    // new version now that the file on the volume has been truncated.
    const rescued = `${h.cfg.run}/work/rescued-full.nc`
    await h.dialogs.queue('save', rescued)
    h.check('Save As gets the work onto another file', (await ctx.files.saveAs(full.id)) === true)
    await h.idle()
    // The source fixture is CRLF and a save keeps the document's line ending, so the file
    // holds the work with CRLF: compared whole with the endings normalized, and CRLF kept.
    const onOther = await h.disk.read(rescued)
    h.check(
      'the work is on the other file, whole, in the file\'s own line ending',
      onOther.replace(/\r\n/g, '\n') === work.replace(/\r\n/g, '\n') && onOther.includes('\r\n') && !/[^\r]\n/.test(onOther),
      { length: onOther.length, workLength: work.length, tail: JSON.stringify(onOther.slice(-12)) },
    )
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
  // Nothing was added to the history folder here: this file backs up as a sibling now, and
  // part A never reached a copy (a locked target is refused before one is made).
  const kept = await historyOf(h, prog)
  h.check('the history folder holds no copy: nothing was copied for a write that could not happen', kept.length === 0, kept.map((e) => e.name))
})
