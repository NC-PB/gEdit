// The copy that is made before a save overwrites a program (plan §5 M7 H7 `m7-backup`,
// AD-21, WP7.1 and WP7.3).
//
// This is the first half of the milestone's promise — *a backup exists before the save
// that would overwrite it* — and it is checked where it has to be true: on disk, in
// bytes. Every claim below is `h.disk.hex` of the file taken **before** a save compared
// with `h.disk.hex` of the copy afterwards, because a copy that was re-encoded, given
// different line endings or written from the buffer instead of from the file would pass
// a text comparison and still be the wrong bytes to hand a machine.
//
// What the scenario walks through, in the order a user would meet it:
//
//   1. the defaults of §7.11 (`history`, 5) are what the app really starts with;
//   2. a save of an existing file leaves the previous version in
//      `<data>/backups/<fnv(folder)>/<name>/<UTC stamp>-<name>`, and a second save adds
//      a second entry beside it rather than replacing the first;
//   3. `files.backupCount` prunes the oldest away and keeps the newest — the direction
//      that matters, since the newest is the version somebody actually wants back;
//   4. a file that does not exist yet has nothing to copy, and the save goes through
//      without a copy and without a question (`Ok(None)`, not an error);
//   5. `sibling` writes `<name>.bak` next to the program and overwrites it on the next
//      save, which is the mode a shop with a folder watcher must **not** use and the
//      docs say so;
//   6. `off` writes no copy anywhere — and still saves the file.
//
// The program is a copy of a committed fixture, so the bytes that go through this are a
// real posted program with its own encoding and line endings, not a string built here.

import { scenario } from '../lib/index.js'
import { MILL, context, copyFile, historyOf, openPath, ready, siblingOf } from './m7-common.js'

/** The name of the history entry of a file called `prog.nc`: `<UTC stamp>-prog.nc`. */
const ENTRY_NAME = /^\d{8}-\d{6}\.\d{3}(-\d+)?-prog\.nc$/

/** A version of the program, marked so the file on disk can be named in one check. */
const version = (/** @type {string} */ mark) => `%\nO0100 (VERSION ${mark})\nG0 X1.\nM30\n%\n`

scenario('m7-backup', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  const source = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const prog = `${h.cfg.run}/work/prog.nc`
  await copyFile(h, source, prog)
  const { id } = await openPath(h, prog)

  h.check(
    'a new profile backs up into the history folder, five versions deep (§7.11)',
    ctx.settings.get('files.backup') === 'history' && ctx.settings.get('files.backupCount') === 5,
    { mode: ctx.settings.get('files.backup'), count: ctx.settings.get('files.backupCount') },
  )
  h.check('and nothing has been copied yet', (await historyOf(h, prog)).length === 0)

  /** Replaces the text, saves, and answers with the bytes that were on disk before. */
  const saveAs = async (/** @type {string} */ mark) => {
    const before = await h.disk.hex(prog)
    ctx.editor.replaceAll(id, version(mark))
    await h.waitFor(() => !!h.q('doc-tab', { docId: id, dirty: '1' }), { timeout: 8000 })
    if ((await ctx.files.save(id)) !== true) throw new Error(`the save of version ${mark} failed`)
    await h.idle()
    return before
  }

  // =============================================================== A. the first save
  const wasA = await saveAs('B')
  h.check('the file on disk is the version that was just saved', (await h.disk.read(prog)).includes('(VERSION B)'), (await h.disk.read(prog)).slice(0, 40))

  let history = await historyOf(h, prog)
  h.check('the save left exactly one copy behind', history.length === 1, history.map((e) => e.name))
  h.check('named after the moment it was taken, in UTC', ENTRY_NAME.test(history[0]?.name ?? ''), history[0]?.name)
  h.check('and it holds the version the save overwrote, byte for byte', history[0]?.hex === wasA, { copy: history[0]?.hex?.slice(0, 60), file: wasA.slice(0, 60) })

  // =============================================================== B. a second save
  const wasB = await saveAs('C')
  history = await historyOf(h, prog)
  h.check('a second save adds a second copy rather than replacing the first', history.length === 2, history.map((e) => e.name))
  h.check('the older entry is still the first version', history[0]?.hex === wasA, history[0]?.name)
  h.check('and the newer one is the version that was on disk a moment ago', history[1]?.hex === wasB, history[1]?.name)
  h.check('the two are in the order their names sort in', (history[0]?.name ?? '') < (history[1]?.name ?? ''), history.map((e) => e.name))

  // =============================================================== C. how many are kept
  // `files.backupCount` bounds the history of *this file*; there is no cap on the folder
  // as a whole (WP7.1, and `docs/user/README.md` says so in as many words).
  await ctx.settings.save({ 'files.backupCount': 1 })
  await h.waitFor(() => ctx.settings.get('files.backupCount') === 1, { timeout: 5000 })
  const wasC = await saveAs('D')
  history = await historyOf(h, prog)
  h.check('lowering the count prunes the history to it', history.length === 1, history.map((e) => e.name))
  h.check('and what survives is the newest version, not the oldest', history[0]?.hex === wasC, { kept: history[0]?.name })

  // =============================================================== D. a file that is new
  // Save As onto a path that does not exist yet: there is nothing to copy, and that is
  // an answer (`Ok(None)`), not a failure — no question, no error, no empty folder.
  const fresh = `${h.cfg.run}/work/fresh.nc`
  const freshId = ctx.files.newUntitled({ profileId: MILL, text: version('FRESH') })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === freshId, { timeout: 8000 })
  await h.dialogs.queue('save', fresh)
  h.check('a file that never existed saves without a word', (await ctx.files.save(freshId)) === true)
  await h.idle()
  h.check('the new file is on disk', (await h.disk.read(fresh)).includes('(VERSION FRESH)'))
  h.check('and no copy was made of a file that had no previous version', (await historyOf(h, fresh)).length === 0, (await historyOf(h, fresh)).map((e) => e.name))
  h.check('no alert was raised anywhere in this', (await h.alert.visible()) === null)

  // =============================================================== E. the sibling mode
  await ctx.settings.save({ 'files.backup': 'sibling' })
  await h.waitFor(() => ctx.settings.get('files.backup') === 'sibling', { timeout: 5000 })
  ctx.docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })

  const wasD = await saveAs('E')
  const bak1 = await siblingOf(h, prog)
  h.check('sibling mode writes the copy next to the program, as prog.nc.bak', bak1 !== null, bak1?.path)
  h.check('and it holds the version the save overwrote', bak1?.hex === wasD, { copy: bak1?.hex?.slice(0, 60), file: wasD.slice(0, 60) })
  h.check('the history folder gained nothing: one mode writes one copy', (await historyOf(h, prog)).length === 1)

  const wasE = await saveAs('F')
  const bak2 = await siblingOf(h, prog)
  h.check('the next save overwrites that one copy — sibling keeps one version, not a history', bak2?.hex === wasE && bak2?.hex !== wasD, { now: bak2?.hex?.slice(0, 60), before: bak1?.hex?.slice(0, 60) })

  // =============================================================== F. off
  await ctx.settings.save({ 'files.backup': 'off' })
  await h.waitFor(() => ctx.settings.get('files.backup') === 'off', { timeout: 5000 })
  const historyBefore = await historyOf(h, prog)
  const siblingBefore = await siblingOf(h, prog)

  await saveAs('G')
  h.check('with backups off the file is still saved', (await h.disk.read(prog)).includes('(VERSION G)'), (await h.disk.read(prog)).slice(0, 40))
  const historyAfter = await historyOf(h, prog)
  const siblingAfter = await siblingOf(h, prog)
  h.check('and no copy is made anywhere: the history is untouched', JSON.stringify(historyAfter.map((e) => e.name)) === JSON.stringify(historyBefore.map((e) => e.name)) && historyAfter[0]?.hex === historyBefore[0]?.hex, {
    before: historyBefore.map((e) => e.name),
    after: historyAfter.map((e) => e.name),
  })
  h.check('and the sibling copy still holds what it held before', siblingAfter?.hex === siblingBefore?.hex, { before: siblingBefore?.hex?.slice(0, 60), after: siblingAfter?.hex?.slice(0, 60) })
})
