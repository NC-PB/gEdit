// The recent files across a restart (plan §5 M2 H2 `m2-recent-restart`, AD-9, WP2.1 and
// WP2.3). Run 1 opens two files through the real dialog; run 2 starts with the same HOME
// and reopens one of them from the Recent menu **without a file dialog**, which is the
// whole point of AD-9: `state::grant_recent_on_startup` puts the remembered paths back
// into the fs scope before the webview can ask for one.
//
// The harness runs one app per scenario, so the restart is two scenarios that share a
// HOME. `vars.HOME` overrides the run's own home (`h.cfg.home` is then stale — the paths
// come from `settings.paths`, which is what the backend actually resolved):
//
//   run 1  HOME = <its own run folder>/state-home   (wiped and rebuilt on every run 1)
//   run 2  HOME = <run 1's run folder>/state-home
//
// Two files are opened for a reason. One lives in run 1's folder and is still there in
// run 2; the other lives in **run 2's** folder, which `run.sh` wipes before run 2 starts,
// so it is the entry that has gone missing — the second half of what the plan asks for.
//
// Running `m2-recent-restart-2` on its own cannot work; it says so instead of failing
// with something unrelated.

import { scenario } from '../lib/index.js'
import { configPaths, read } from './m2-common.js'

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../m2-recent-restart-1/state-home'

/** The run folder of the other half of the pair. */
const otherRun = (/** @type {string} */ run, /** @type {string} */ name) => run.replace(/\/[^/]+$/, `/${name}`)

const menu = (/** @type {any} */ h) => /** @type {HTMLSelectElement | null} */ (h.q('recent-menu')?.querySelector('select') ?? null)
const optionFor = (/** @type {any} */ h, /** @type {string} */ path) =>
  [...(menu(h)?.options ?? [])].find((o) => o.value === path)

scenario('m2-recent-restart-1', { timeout: 180, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const paths = configPaths(ctx)

  h.check('the app runs on the shared home of this pair', paths.settingsFile.startsWith(`${h.cfg.run}/state-home/`), paths.settingsFile)
  h.check('nothing is remembered yet', read(ctx.recent.list).length === 0 && (await h.disk.stat(paths.stateFile)) === null, read(ctx.recent.list))

  // `keep` outlives this run; `gone` sits in run 2's folder, which run.sh wipes.
  const source = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const keep = `${h.cfg.run}/keep/f01-mill-3tools.nc`
  const gone = `${otherRun(h.cfg.run, 'm2-recent-restart-2')}/gone.nc`
  await h.disk.write(keep, await h.disk.read(source))
  await h.disk.write(gone, '%\nO0002 (GONE)\nM30\n%\n')

  await h.dialogs.queue('open', [keep, gone])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => h.qa('doc-tab').length === 2, { timeout: 15000 })
  await h.waitFor(() => read(ctx.recent.list).length === 2, { timeout: 5000 })

  const list = read(ctx.recent.list)
  h.check('opening a file remembers it, newest first', list[0].path === gone && list[1].path === keep, list)
  h.check('both entries are there and both exist', list.every((/** @type {any} */ e) => e.exists === true), list)
  h.check('the Home tab offers them in the Recent dropdown', !!optionFor(h, keep) && !!optionFor(h, gone), [...(menu(h)?.options ?? [])].map((o) => o.textContent))

  const state = JSON.parse(await h.disk.read(paths.stateFile))
  h.check('Rust wrote them into state.json, which it owns', JSON.stringify(state.recent) === JSON.stringify([gone, keep]), state)
  h.check('the file carries its version and nothing about the window', state.$version === 1 && state.width === undefined && state.x === undefined, Object.keys(state))

  // A clean exit, so run 2 starts from a settled state file.
  h.expectExit({ within: 15000 })
  // `h.expectExit` only *queues* its record for the runner; the flush is an IPC round
  // trip of its own. Under load the window can be gone before it lands, and the run is
  // then judged as "the scenario never finished" (seen once in a full suite). A moment
  // here is enough — see the h2 hand-off.
  await h.sleep(500)
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})

scenario('m2-recent-restart-2', { timeout: 180, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const paths = configPaths(ctx)
  const previous = otherRun(h.cfg.run, 'm2-recent-restart-1')
  const keep = `${previous}/keep/f01-mill-3tools.nc`
  const gone = `${h.cfg.run}/gone.nc`

  if (!(await h.disk.stat(paths.stateFile))) {
    throw new Error(`no state.json in ${paths.stateFile}: run m2-recent-restart-1 first (it writes the shared home)`)
  }

  // M7, AD-22: this pair shares a HOME, so run 2 now begins by restoring run 1's session.
  // `keep` comes back as a tab; `gone` is not there any more and is skipped with one
  // message instead of a dialog. Waiting for that first is what makes the list below
  // stable — an open is an open, so `contrib/recent.ts` touches the file it reopened.
  await h.waitFor(() => !!ctx.docs.byPath(keep), { timeout: 20000 })
  h.check('the last session came back: the file that still exists is open again', h.qa('doc-tab').length === 1 && !!h.q('doc-tab', { path: keep }), h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path))
  h.check('the file that went away was skipped, not opened', !ctx.docs.byPath(gone), ctx.docs.all().map((/** @type {any} */ d) => d.title))

  await h.waitFor(() => read(ctx.recent.list).length === 2 && read(ctx.recent.list)[0]?.path === keep, { timeout: 10000 })
  const list = read(ctx.recent.list)
  h.check('the recent files came back from the last session, the reopened one in front', JSON.stringify(list.map((/** @type {any} */ e) => e.path)) === JSON.stringify([keep, gone]), list)
  h.check('the file that is still there is marked as existing', list.find((/** @type {any} */ e) => e.path === keep)?.exists === true, list)
  h.check('the one that went away is marked as missing', list.find((/** @type {any} */ e) => e.path === gone)?.exists === false && (await h.disk.stat(gone)) === null, list)
  h.check('the dropdown says so in its label', /not found/.test(optionFor(h, gone)?.textContent ?? '') && !/not found/.test(optionFor(h, keep)?.textContent ?? ''), [...(menu(h)?.options ?? [])].map((o) => o.textContent))

  // The point of AD-9: no dialog, because `grant_recent_on_startup` re-granted the path.
  h.select(menu(h), keep)
  await h.waitFor(() => !!h.q('doc-tab', { path: keep }), { timeout: 15000 })
  h.check('picking it opens the file again', !!ctx.docs.byPath(keep) && ctx.editor.getText(ctx.docs.byPath(keep).id).startsWith('(WRITTEN FOR GEDIT'), ctx.editor.getText(ctx.docs.byPath(keep).id).slice(0, 30))
  h.check('and it needed no file dialog at all', h.dialogs.calls().length === 0, h.dialogs.calls())

  // M7: the tab was already on screen when this pick started, because the session
  // restored it — so the `waitFor` above is no longer the end of the action, only its
  // beginning. `file.openRecent` runs inside `dialogs.exclusive`, and a second pick
  // while the first chain is still in flight resolves `undefined` and opens nothing at
  // all. Wait for the app to go quiet instead.
  await h.idle()

  // A missing entry offers to leave the list rather than failing to open.
  h.select(menu(h), gone)
  const alert = await h.alert.wait({ timeout: 8000 })
  h.check('a missing entry asks whether to forget it', !!alert && /gone\.nc/.test((alert?.texts ?? []).join(' ')), alert)
  await h.alert.click('Remove')
  await h.waitFor(() => read(ctx.recent.list).length === 1, { timeout: 5000 })
  h.check('Remove takes it out of the list', read(ctx.recent.list)[0]?.path === keep, read(ctx.recent.list))
  h.check('no document was opened for it', !ctx.docs.byPath(gone) && h.qa('doc-tab').length === 1, ctx.docs.all().map((/** @type {any} */ d) => d.title))
  await h.waitFor(async () => JSON.parse(await h.disk.read(paths.stateFile)).recent.length === 1, { timeout: 5000 })
  h.check('and out of state.json', JSON.stringify(JSON.parse(await h.disk.read(paths.stateFile)).recent) === JSON.stringify([keep]), await h.disk.read(paths.stateFile))

  // Clear, from the same dropdown.
  h.select(menu(h), 'gedit:clear-recent')
  await h.waitFor(() => read(ctx.recent.list).length === 0, { timeout: 5000 })
  h.check('Clear empties the list and disables the dropdown', read(ctx.recent.list).length === 0 && menu(h)?.disabled === true)
  await h.waitFor(async () => JSON.parse(await h.disk.read(paths.stateFile)).recent.length === 0, { timeout: 5000 })
  h.check('and empties it on disk too', JSON.parse(await h.disk.read(paths.stateFile)).recent.length === 0, await h.disk.read(paths.stateFile))
})
