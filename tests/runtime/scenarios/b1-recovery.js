// B1 A2 "Recovery and app data" in the real window.
//
//   b1-recovery-status   While crash-recovery snapshots cannot be written, a lasting item "Crash recovery is not saving"
//                        sits in the status bar; it goes by itself when a pass writes again. The failure is real: the
//                        run's recovery folder is made read-only. The same for the list of recent files: with the
//                        configuration folder read-only, removing an entry says "The list of recent files could not be
//                        saved." instead of failing silently.
//   b1-recovery-1/-2     A restore onto a file another tab holds: run 1 edits `real.nc`, snapshots and is killed. Run 2
//                        has the file open (under the name of a symbolic link to it, which is a second spelling of the
//                        same file) when the snapshot is restored; the text must not be bound to a second tab, so it
//                        comes back in an untitled tab and one lasting message names the file.
//
// Anything that makes a folder read-only is undone in a `finally`: the run folder is wiped before the next run.

import { scenario } from '../lib/index.js'
import { openPath } from './m3-common.js'
import { configPaths, dismissStartupRestore, makeStale, openRestoreDialog, otherRun, recoveryAction, requireFirstRun, sessionFolders, waitForLeftovers } from './m7-common.js'
import { context, message, newDoc, osOp, ready, symlink } from './b1-common.js'

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../b1-recovery-1/state-home'

scenario('b1-recovery-status', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const item = () => h.q('status-item', { item: 'recovery' })
  const id = await newDoc(h, 'G0 X1\n')
  ctx.editor.replaceAll(id, 'G0 X1\n(UNSAVED WORK)\n')
  await h.waitFor(() => !!h.q('doc-tab', { docId: id, dirty: '1' }), { timeout: 8000 })
  await ctx.recovery.flushNow()
  const folders = await sessionFolders(h)
  h.check('the first pass wrote a snapshot into this run’s folder, and the status bar has no recovery item', folders.length === 1 && !item(), { folders, item: !!item() })
  const folder = `${await h.recoveryDir()}/${folders[0]}`

  // ------------------------------------------------------------ the folder cannot be written
  await osOp(h, 'chmod', folder, { mode: '555' })
  try {
    ctx.editor.replaceAll(id, 'G0 X1\n(UNSAVED WORK)\n(MORE UNSAVED WORK)\n')
    await h.idle()
    await ctx.recovery.flushNow().catch(() => undefined)
    await h.waitFor(() => !!item(), { timeout: 10000 })
    h.check('while snapshots cannot be written the status bar says "Crash recovery is not saving"', !!item() && (item()?.textContent ?? '').includes(ctx.t('recovery.failingItem')), item()?.textContent)
    h.check('the tooltip names the document', (item()?.getAttribute('title') ?? '').length > 20, item()?.getAttribute('title'))
    await h.sleep(9000)
    h.check('and it stays: the one-off message is gone after a few seconds, the item is not', !!item(), message(h))
  } finally {
    await osOp(h, 'chmod', folder, { mode: '755' })
  }

  // ------------------------------------------------------------ the folder can be written again
  h.click(item())
  await h.waitFor(() => !item(), { timeout: 10000 })
  h.check('a click tries again, and the item goes when the pass writes', !item(), !!item())
  const mine = await h.disk.read(`${folder}/${id}.txt`)
  h.check('the snapshot holds the latest text', mine.includes('(MORE UNSAVED WORK)'), mine)

  // ------------------------------------------------------------ the list of recent files
  const real = `${h.cfg.run}/recent/one.nc`
  await h.disk.write(real, 'G0 X0\n')
  await openPath(h, real)
  const config = configPaths(ctx).configDir
  await osOp(h, 'chmod', config, { mode: '555' })
  try {
    const removed = await ctx.recent.remove(real)
    await h.idle()
    h.check('removing a recent entry while the configuration folder cannot be written says so', removed === false && message(h) === ctx.t('recent.saveFailed'), { removed, message: message(h) })
  } finally {
    await osOp(h, 'chmod', config, { mode: '755' })
  }
})

scenario('b1-recovery-1', { timeout: 240, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const real = `${h.cfg.run}/keep/real.nc`
  const link = `${h.cfg.run}/keep/link.nc`
  await h.disk.write(real, '%\nO0400 (ON DISK)\nG0 X1.\nM30\n%\n')
  await symlink(h, real, link)
  const opened = await openPath(h, real)
  ctx.editor.replaceAll(opened.id, '%\nO0400 (ON DISK)\nG0 X1.\n(UNSAVED WORK)\nM30\n%\n')
  await h.waitFor(() => !!h.q('doc-tab', { docId: opened.id, dirty: '1' }), { timeout: 8000 })
  await ctx.recovery.flushNow()
  const folders = await sessionFolders(h)
  h.check('one snapshot of the edited file is on disk', folders.length === 1 && (await h.disk.read(`${await h.recoveryDir()}/${folders[0]}/${opened.id}.txt`)).includes('(UNSAVED WORK)'), folders)
  await h.waitFor(async () => (JSON.parse(await h.disk.read(paths.stateFile)).session?.paths ?? []).length === 1, { timeout: 10000 })
  await h.crash()
})

scenario('b1-recovery-2', { timeout: 300, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await requireFirstRun(h, 'b1-recovery-1')
  const previous = otherRun(h.cfg.run, 'b1-recovery-1')
  const real = `${previous}/keep/real.nc`
  const link = `${previous}/keep/link.nc`
  await dismissStartupRestore(h)

  // The stored session reopens the file (a fresh heartbeat hides the snapshot for two minutes); the scenario closes
  // that tab and opens the file again under the other name, the symbolic link.
  await h.waitFor(() => !!ctx.docs.byPath(real), { timeout: 30000 })
  await h.idle()
  const reopened = ctx.docs.byPath(real)
  h.check('the session brought the file back from disk, without the unsaved line', !!reopened && !ctx.editor.getText(reopened.id).includes('(UNSAVED WORK)'), reopened?.id)
  if ((await ctx.files.close(/** @type {any} */ (reopened).id)) !== true) throw new Error('closing the reopened file failed')
  const viaLink = await openPath(h, link)
  h.check('the file is open under the name of the link, and nothing else is bound to a file', ctx.docs.all().filter((d) => d.path !== null).length === 1 && ctx.docs.get(viaLink.id)?.path === link, ctx.docs.all().map((d) => d.path))

  await makeStale(h)
  const leftovers = await waitForLeftovers(h, 1)
  h.check('the snapshot of the edited file is offered, under the real name', leftovers.length === 1 && leftovers[0].path === real, leftovers.map((e) => e.path))
  const dialog = await openRestoreDialog(h)
  h.click(/** @type {HTMLElement} */ (recoveryAction(h, 'restore')))
  await dialog.answered
  await h.waitFor(() => ctx.docs.all().length >= 2, { timeout: 15000 })
  await h.idle()

  const withPath = ctx.docs.all().filter((d) => d.path !== null)
  const untitled = ctx.docs.all().filter((d) => d.path === null && ctx.editor.getText(d.id).includes('(UNSAVED WORK)'))
  h.check('the recovered text is in an untitled tab: no second tab is bound to the file under either name', withPath.length === 1 && withPath[0].id === viaLink.id && untitled.length === 1, ctx.docs.all().map((d) => `${d.id}:${d.path}`))
  h.check('the tab that holds the file is untouched, and the recovered text is unsaved', !ctx.editor.getText(viaLink.id).includes('(UNSAVED WORK)') && ctx.docs.get(viaLink.id)?.dirty === false && untitled[0]?.dirty === true, { dirty: untitled[0]?.dirty })
  h.check('one lasting message names the file and says where its text is', message(h).includes(ctx.t('recovery.pathTaken', { count: 1, names: 'real.nc' })), message(h))
  h.check('the file on disk was not written', (await h.disk.read(real)) === '%\nO0400 (ON DISK)\nG0 X1.\nM30\n%\n')
})
