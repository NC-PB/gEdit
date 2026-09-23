// Crash recovery across a real kill (plan §5 M7 H7 `m7-recovery-1/2`, AD-21, WP7.2 and
// WP7.4).
//
// The promise under test is the hardest one gEdit makes: *the process dies without
// warning and at most the last thirty seconds of typing are gone.* Nothing but a real
// `SIGKILL` can test it — `h.crash()` sends one to the app's own pid, so no destructor,
// no `RunEvent::Exit` and no flush runs on the way out, and whatever run 2 finds on disk
// was already there before the process stopped existing. (`abort()` would raise SIGABRT,
// which macOS answers with a crash reporter that can put a window in front of the
// harness; the plan says SIGKILL for that reason.)
//
//   run 1  three programs, all three edited and none saved; one `flushNow()`; SIGKILL.
//   run 2  the same HOME. The session comes back, the killed run's folder is still
//          there, nothing is offered while its heartbeat still looks fresh, and once it
//          is old enough to be called dead the dialog offers the work with **what a
//          restore would do to each file** written in the row.
//
// Four things run 2 proves that nothing else in the suite does:
//
//   1. **A restore never overwrites a file that moved on.** `beta.nc` is rewritten on
//      disk between the crash and the dialog, exactly as a CAM post or a colleague
//      would. Its row says `changed` before anything is opened, the restore still
//      writes nothing, and the P1 external-change banner is up over the recovered tab
//      before the user can save over the newer file.
//   2. **A partial restore keeps the rest.** `gamma.nc` is left unticked; its snapshot
//      is still on disk afterwards and is offered again, instead of disappearing with
//      the session its neighbours were restored from. The session is kept *whole* —
//      §7.10 has no per-entry drop for a dead session — so the two that were restored
//      are offered a second time as well; that is the shape of the guarantee and the
//      scenario says so rather than wishing it were tidier.
//   3. **A save drops the snapshot it makes pointless**, and only that one.
//   4. **Discard really deletes**, after the one irreversible question in this feature,
//      and it deletes the snapshot and not the program.
//
// The 200 s backdating of `alive` is AD-21's liveness rule seen from outside: a session
// counts as a leftover only once its heartbeat is `STALE_AFTER_SECS` (120 s) old,
// because anything fresher cannot be told from a gEdit that is merely slow. Backdating
// is how a test gets there in one second; `contrib/recovery.ts` gets there by waiting
// 150 s (`LEFTOVER_RECHECK_MS`), which no scenario can afford to sit through.

import { scenario } from '../lib/index.js'
import {
  activeDoc,
  configPaths,
  context,
  dismissStartupRestore,
  docIdFor,
  makeStale,
  openRestoreDialog,
  otherRun,
  read,
  ready,
  recoveryAction,
  recoveryRows,
  requireFirstRun,
  sessionFiles,
  sessionFolders,
  waitForLeftovers,
} from './m7-common.js'

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../m7-recovery-1/state-home'

/** The three programs, as they are on disk: written by run 1, never saved over. */
const onDisk = (/** @type {string} */ name) => `%\nO0300 (${name} ON DISK)\nG0 X1.\nG1 Z-1. F200.\nM30\n%\n`
/** What is in the tab when the process is killed: the work only the snapshot holds. */
const typed = (/** @type {string} */ name) => `${onDisk(name)}(UNSAVED ${name})\n`
/** What a CAM post writes over `beta.nc` while gEdit is not running. */
const REPOSTED = '%\nO0300 (BETA REPOSTED BY THE CAM)\nG0 X9.\nM30\n%\n'

const NAMES = ['ALPHA', 'BETA', 'GAMMA']

scenario('m7-recovery-1', { timeout: 300, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)

  h.check('the app runs on the shared home of this pair', paths.stateFile.startsWith(`${h.cfg.run}/state-home/`), paths.stateFile)

  const files = NAMES.map((name) => `${h.cfg.run}/keep/${name.toLowerCase()}.nc`)
  for (const [at, path] of files.entries()) await h.disk.write(path, onDisk(NAMES[at]))

  await h.dialogs.queue('open', files)
  await ctx.files.open()
  await h.waitFor(() => files.every((path) => !!ctx.docs.byPath(path)), { timeout: 20000 })
  const ids = files.map((path) => docIdFor(ctx, path))
  h.check('the three programs are open', ids.length === 3 && new Set(ids).size === 3, h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path))

  for (const [at, id] of ids.entries()) {
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
    ctx.editor.replaceAll(id, typed(NAMES[at]))
    await h.waitFor(() => !!h.q('doc-tab', { docId: id, dirty: '1' }), { timeout: 8000 })
  }
  h.check('all three hold work that is on no disk anywhere', ids.every((id) => ctx.docs.get(id)?.dirty === true), ids.map((id) => `${ctx.docs.get(id)?.title}:${ctx.docs.get(id)?.dirty}`))

  // The snapshot pass the 30 s ticker would have taken by itself, taken now so the run
  // does not have to sit through it.
  await ctx.recovery.flushNow()

  const folders = await sessionFolders(h)
  h.check('this run has exactly one recovery session folder', folders.length === 1, folders)
  const mine = await sessionFiles(h, folders[0])
  h.check('with a heartbeat in it', mine.alive, mine.names)
  h.check('and a text/metadata pair for each of the three documents', mine.keys.length === 3 && ids.every((id) => mine.keys.includes(id)), { keys: mine.keys, ids })

  // The session list has to be on disk before the kill, or run 2 has nothing to reopen.
  await h.waitFor(async () => (JSON.parse(await h.disk.read(paths.stateFile)).session?.paths ?? []).length === 3, { timeout: 10000 })
  const stored = JSON.parse(await h.disk.read(paths.stateFile)).session
  h.check('and the session list holds the three files, with the active one marked', JSON.stringify(stored.paths) === JSON.stringify(files) && stored.active === 2, stored)

  h.check('not one of them has been written to disk', (await Promise.all(files.map((path, at) => h.disk.read(path).then((text) => text === onDisk(NAMES[at]))))).every(Boolean))

  // A kill, not a quit: a quit clears the snapshots (that is `files.onWillQuit`'s job),
  // which is exactly what must not happen here.
  await h.crash()
})

scenario('m7-recovery-2', { timeout: 420, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = await requireFirstRun(h, 'm7-recovery-1')
  const previous = otherRun(h.cfg.run, 'm7-recovery-1')
  const files = NAMES.map((name) => `${previous}/keep/${name.toLowerCase()}.nc`)
  const [alpha, beta, gamma] = files

  // =============================================================== A. what the kill left
  h.check(
    'every program on disk is exactly what run 1 left there: the crash cost the disk nothing',
    (await Promise.all(files.map((path, at) => h.disk.read(path).then((text) => text === onDisk(NAMES[at]))))).every(Boolean),
    await h.disk.read(alpha),
  )

  const dismissed = await dismissStartupRestore(h)

  const folders = await sessionFolders(h)
  h.check('the killed run’s folder is still there, beside this run’s own', folders.length === 2, { folders, startupDialog: dismissed })
  /** The dead session is the one holding the snapshots; this run has taken none yet. */
  const contents = []
  for (const name of folders) contents.push({ name, ...(await sessionFiles(h, name)) })
  const dead = contents.find((one) => one.keys.length === 3)
  const current = contents.find((one) => one !== dead)
  h.check('and it still holds all three snapshots, a SIGKILL later', dead !== undefined && dead.keys.length === 3, contents.map((one) => `${one.name}:${one.keys.length}`))

  // The liveness rule, driven rather than waited for: a heartbeat that says "a few
  // seconds ago" hides the session, and one that says "over two minutes ago" offers it.
  // Run 2 normally starts inside that window anyway, but the window is wall clock and a
  // scenario may not depend on how long its predecessor's retry took.
  const aliveFile = `${await h.recoveryDir()}/${dead?.name}/alive`
  await h.disk.touch(aliveFile, Date.now() / 1000)
  h.check('nothing is offered while its heartbeat still looks fresh', (await ctx.recovery.leftovers()).length === 0, await ctx.recovery.leftovers())

  // =============================================================== B. the session first
  // AD-22 runs after AD-21's dialog, and with a fresh heartbeat there is no dialog at
  // all — so the stored session simply reopens the three files from disk.
  await h.waitFor(() => files.every((path) => !!ctx.docs.byPath(path)), { timeout: 30000 })
  await h.idle()
  h.check('the last session came back', h.qa('doc-tab').length === 3, h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path))
  h.check('with the tab that was in front in front again', activeDoc(ctx)?.path === gamma, activeDoc(ctx)?.path)
  h.check('and each one holding what is on disk, not what was typed', files.every((path, at) => ctx.editor.getText(docIdFor(ctx, path)) === onDisk(NAMES[at])))

  // A restore cannot bind a path a second tab already owns — that guard is
  // `bindRestored`'s and it is right (mergeA §5.2). The reopened tabs are closed, which
  // is what a user does when the dialog comes after the blind window.
  for (const path of files) {
    if ((await ctx.files.close(docIdFor(ctx, path))) !== true) throw new Error(`closing ${path} failed`)
  }
  await h.waitFor(() => files.every((path) => !ctx.docs.byPath(path)), { timeout: 10000 })
  await h.idle()

  // =============================================================== C. the file moves on
  await h.disk.write(beta, REPOSTED)
  await makeStale(h)

  const leftovers = await waitForLeftovers(h, 3)
  h.check('once the dead session is old enough to be called dead, its work is offered', leftovers.length === 3, leftovers.map((e) => e.path))
  h.check('every entry names the file it came from and the session it was in', leftovers.every((e) => files.includes(e.path ?? '') && e.session === dead?.name), leftovers.map((e) => `${e.session}:${e.path}`))

  // =============================================================== D. the dialog
  const first = await openRestoreDialog(h)
  const rows = recoveryRows(h)
  h.check('the dialog lists all three', rows.length === 3, rows.map((r) => r.path))
  const rowFor = (/** @type {string} */ path) => recoveryRows(h).find((r) => r.path === path)
  h.check('a file nobody touched is announced as unchanged', rowFor(alpha)?.outlook === 'unchanged' && rowFor(gamma)?.outlook === 'unchanged', rows.map((r) => `${r.path}:${r.outlook}`))
  h.check(
    'and the one a post rewrote says so, in its own row, before anything is opened',
    rowFor(beta)?.outlook === 'changed',
    rows.map((r) => `${r.path}:${r.outlook}`),
  )
  h.check('everything is ticked to begin with: after a crash the common answer is "all of it"', rows.every((r) => r.selected), rows.map((r) => `${r.path}:${r.selected}`))

  // Leave gamma behind, deliberately.
  h.click(/** @type {HTMLElement} */ (rowFor(gamma)?.checkbox))
  await h.idle()
  h.check('unticking one row leaves the others ticked', rowFor(gamma)?.selected === false && rowFor(alpha)?.selected === true && rowFor(beta)?.selected === true, recoveryRows(h).map((r) => `${r.path}:${r.selected}`))

  h.click(/** @type {HTMLElement} */ (recoveryAction(h, 'restore')))
  await first.answered
  await h.idle()

  // =============================================================== E. what came back
  const restoredAlpha = await h.waitFor(() => ctx.docs.all().find((/** @type {any} */ d) => d.path === alpha), { timeout: 15000 })
  const restoredBeta = ctx.docs.all().find((/** @type {any} */ d) => d.path === beta)
  h.check('the two that were ticked are back, on their own paths', !!restoredAlpha && !!restoredBeta, ctx.docs.all().map((/** @type {any} */ d) => d.path))
  // Everything below reads these two; without them there is nothing left to say, and a
  // stack of "possibly undefined" checks would only bury the one that failed.
  if (!restoredAlpha || !restoredBeta) throw new Error('the restore did not bring both documents back')
  h.check('the one that was not is not', !ctx.docs.all().some((/** @type {any} */ d) => d.path === gamma), ctx.docs.all().map((/** @type {any} */ d) => d.path))
  h.check('each holds the text exactly as it was typed', ctx.editor.getText(restoredAlpha.id) === typed('ALPHA') && ctx.editor.getText(restoredBeta.id) === typed('BETA'), JSON.stringify(ctx.editor.getText(restoredAlpha.id)))
  h.check('and comes back unsaved, so nobody can mistake it for what is on disk', restoredAlpha.dirty === true && restoredBeta.dirty === true, { alpha: restoredAlpha.dirty, beta: restoredBeta.dirty })
  h.check('restoring wrote nothing: the untouched file is still untouched', (await h.disk.read(alpha)) === onDisk('ALPHA'), await h.disk.read(alpha))
  h.check('and the file the post rewrote is still the post’s version', (await h.disk.read(beta)) === REPOSTED, await h.disk.read(beta))

  // The banner of AD-10, over the recovered tab, before a single keystroke: the snapshot
  // carries the stamp it was taken with, so the document knows its file moved on.
  ctx.docs.activate(restoredBeta.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === restoredBeta.id, { timeout: 8000 })
  await ctx.external.checkNow()
  const banner = await h.waitFor(() => h.q('external-banner'), { timeout: 10000 })
  h.check('the recovered program whose file changed says so at once', banner?.dataset.docId === restoredBeta.id && banner?.dataset.external === 'changed', {
    docId: banner?.dataset.docId,
    external: banner?.dataset.external,
  })
  h.check('and its tab carries the marker', h.q('doc-tab', { docId: restoredBeta.id })?.dataset.external === 'changed', h.q('doc-tab', { docId: restoredBeta.id })?.dataset.external)

  // =============================================================== F. the rest is kept
  // A leftover session is deleted whole or not at all: `recovery_drop` addresses the
  // *current* session (§7.10), so the only way to forget one restored snapshot of a dead
  // one would be to delete the folder it sits in and its neighbours with it. The service
  // therefore keeps the session as soon as anything in it was not restored — and the
  // price is that the two that *were* restored are still in there and will be offered
  // again. Nothing is lost either way, which is the direction this milestone errs in.
  h.check('the dead session was not discarded with the two that were restored', (await sessionFolders(h)).includes(dead?.name ?? ''), await sessionFolders(h))
  const left = await sessionFiles(h, dead?.name ?? '')
  h.check('and it is kept whole, snapshots and all', left.keys.length === 3, left.names)
  const still = await waitForLeftovers(h, 3)
  h.check('so the work nobody asked for is offered again rather than lost with the work that was', still.some((e) => e.path === gamma), still.map((e) => e.path))

  // =============================================================== G. a save drops one
  await ctx.recovery.flushNow()
  const before = await sessionFiles(h, current?.name ?? '')
  h.check('this run snapshots the two recovered documents as its own', before.keys.includes(restoredAlpha.id) && before.keys.includes(restoredBeta.id), before.keys)

  h.check('saving the recovered program saves it', (await ctx.files.save(restoredAlpha.id)) === true)
  await h.idle()
  h.check('the work is on disk now', (await h.disk.read(alpha)) === typed('ALPHA'), await h.disk.read(alpha))
  const after = await h.waitFor(async () => {
    const now = await sessionFiles(h, current?.name ?? '')
    return now.keys.includes(restoredAlpha.id) ? null : now
  }, { timeout: 10000 })
  h.check('and its snapshot is dropped, because a saved file needs none', !(after?.keys ?? [restoredAlpha.id]).includes(restoredAlpha.id), after?.keys)
  h.check('the other document’s snapshot is untouched', (after?.keys ?? []).includes(restoredBeta.id), after?.keys)

  // =============================================================== H. discard
  const second = await openRestoreDialog(h)
  h.check('the dialog offers the session again, the snapshot nobody asked for included', recoveryRows(h).length === 3 && recoveryRows(h).some((r) => r.path === gamma), recoveryRows(h).map((r) => r.path))

  h.click(/** @type {HTMLElement} */ (recoveryAction(h, 'discard')))
  const question = await h.alert.wait({ timeout: 15000 })
  h.check('the one irreversible action in this feature asks first', (question?.buttons ?? []).includes('Delete it') && (question?.buttons ?? []).includes('Cancel'), question?.buttons)
  await h.alert.click('Delete it')
  await second.answered
  await h.idle()

  h.check('the dead session folder is gone', !(await sessionFolders(h)).includes(dead?.name ?? ''), await sessionFolders(h))
  h.check('and there is nothing left to offer', (await ctx.recovery.leftovers()).length === 0, await ctx.recovery.leftovers())
  h.check('discarding deleted the snapshot and not the program', (await h.disk.read(gamma)) === onDisk('GAMMA'), await h.disk.read(gamma))
  h.check('the state file is still the app’s own', typeof JSON.parse(await h.disk.read(paths.stateFile)).$version === 'number')
})
