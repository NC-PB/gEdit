// What survives a restart (plan §5 M2 H2 `m2-window-state`, AD-8, AD-9, D5): the window
// geometry, which `tauri-plugin-window-state` keeps in `.window-state.json` next to
// `settings.json`, and the three independent halves of the config folder — the settings,
// the `ui` member of `state.json` and the recent list — which must not overwrite one
// another across a restart.
//
// Like `m2-recent-restart`, the restart is two scenarios sharing a HOME through
// `vars.HOME` (run 1's own run folder, which run.sh wipes before every run 1, so the
// pair always starts from the seeded state):
//
//   run 1  HOME = <its own run folder>/state-home
//   run 2  HOME = <run 1's run folder>/state-home
//
// Run 1 must end through a real window close: the plugin writes the file on
// `RunEvent::Exit`, and the harness's own end of run (`h_done`) is a `process::exit`
// that never gets there.
//
// BLOCKED, and named in the h2 hand-off: whether the saved geometry is *applied* to the
// window cannot be observed from the page. `tests/runtime/harness/harness.rs:96-102`
// (`prepare_main_window`) sets the window to 1100x700 and centres it on every start,
// after the plugin's own restore, so every run is the same size whatever the file says.
// What is checked here is everything else: the file is read at startup, the live geometry
// is written back to it at exit, it lands in the config folder and not in `state.json`,
// and it survives into the next run.

import { scenario } from '../lib/index.js'
import { configPaths, listDir, read, tempLeftovers } from './m2-common.js'

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../m2-window-state-1/state-home'
const CONFIG = 'state-home/Library/Application Support/com.pburg.gedit'

/** A geometry no default would produce, so "this file was read" is unambiguous. */
const SEED = { width: 1210, height: 810, x: 141, y: 201, prev_x: 7, prev_y: 9, maximized: false, visible: false, decorated: true, fullscreen: false }

const otherRun = (/** @type {string} */ run, /** @type {string} */ name) => run.replace(/\/[^/]+$/, `/${name}`)
const windowStateFile = (/** @type {{ configDir: string }} */ paths) => `${paths.configDir}/.window-state.json`

scenario(
  'm2-window-state-1',
  {
    timeout: 180,
    vars: { HOME: HOME_1 },
    files: { [`${CONFIG}/.window-state.json`]: `${JSON.stringify({ main: SEED }, null, 2)}\n` },
  },
  async (h) => {
    const ctx = /** @type {any} */ (h.app.ctx)
    const paths = configPaths(ctx)
    const stateFile = windowStateFile(paths)

    h.check('the app runs on the shared home of this pair', paths.settingsFile.startsWith(`${h.cfg.run}/state-home/`), paths.settingsFile)
    h.check('the window state lives in the config folder, next to settings.json (D5)', !!(await h.disk.stat(stateFile)), stateFile)
    h.log(`geometry: dpr=${window.devicePixelRatio} inner=${window.innerWidth}x${window.innerHeight} screen=${window.screenX},${window.screenY}`)
    // Living documentation of the blocked half: the day the harness stops fixing the
    // window size, this check fails and the pair can assert the real restore instead.
    h.check('BLOCKED: the harness re-sizes the window after the restore, so the seeded size never reaches the page', window.innerWidth * window.devicePixelRatio !== SEED.width, {
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      seed: [SEED.width, SEED.height],
    })

    // The three halves of the config folder, each written by a different owner.
    await ctx.commands.run('view.setTheme', 'light')
    await h.waitFor(() => ctx.settings.get('appearance.theme') === 'light', { timeout: 5000 })
    await ctx.commands.run('view.showOutput')
    await h.waitFor(() => !!h.q('panel', { region: 'bottom' }), { timeout: 5000 })
    const file = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
    const keep = `${h.cfg.run}/keep/f01-mill-3tools.nc`
    await h.disk.write(keep, await h.disk.read(file))
    await h.dialogs.queue('open', [keep])
    await ctx.commands.run('file.open')
    await h.waitFor(() => !!h.q('doc-tab', { path: keep }), { timeout: 15000 })
    await ctx.uiState.flush()

    const state = JSON.parse(await h.disk.read(paths.stateFile))
    h.check('the layout reached the ui member of state.json', state.ui?.layout?.bottom?.visible === true, state.ui)
    h.check('the recent list is beside it, and Rust owns that half', JSON.stringify(state.recent) === JSON.stringify([keep]), state.recent)
    // D5, asserted directly. The old form was `indexOf('width') === -1 || ui.layout.left.width
    // !== undefined`, and `layoutPersist` always writes `left.width`, so the second half was
    // unconditionally true and the check could never fail (G8 M2). `state.json` is Rust's
    // `recent`, the webview's `ui` and the version stamp — the geometry is the plugin's own
    // file, checked above.
    const members = Object.keys(state).sort()
    h.check('state.json holds only $version, recent and ui (D5)', JSON.stringify(members) === JSON.stringify(['$version', 'recent', 'ui']), members)
    const withoutUi = JSON.stringify({ ...state, ui: undefined })
    h.check('the only geometry in it is the side panel’s, inside ui.layout (D5)', state.ui?.layout?.left?.width !== undefined && !/width|height|maximized|fullscreen/.test(withoutUi), {
      left: state.ui?.layout?.left,
      withoutUi,
    })
    h.check('the theme is in settings.json, which holds only it', JSON.stringify(JSON.parse(await h.disk.read(paths.settingsFile))) === JSON.stringify({ $version: 1, 'appearance.theme': 'light' }), await h.disk.read(paths.settingsFile))

    // The plugin saves on RunEvent::Exit, so the run has to end through the window.
    h.expectExit({
      within: 15000,
      files: [
        { path: stateFile, includes: '"width"' },
        { path: paths.settingsFile, includes: '"appearance.theme": "light"' },
        { path: paths.stateFile, includes: '"recent"' },
      ],
    })
    // `h.expectExit` only *queues* its record for the runner; the flush is an IPC round
    // trip of its own. Under load the window can be gone before it lands, and the run is
    // then judged as "the scenario never finished" (seen once in a full suite). A moment
    // here is enough — see the h2 hand-off.
    await h.sleep(500)
    await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
  },
)

scenario('m2-window-state-2', { timeout: 180, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const paths = configPaths(ctx)
  const stateFile = windowStateFile(paths)
  const previous = otherRun(h.cfg.run, 'm2-window-state-1')
  const keep = `${previous}/keep/f01-mill-3tools.nc`

  if (!(await h.disk.stat(paths.stateFile))) {
    throw new Error(`no state.json in ${paths.stateFile}: run m2-window-state-1 first (it writes the shared home)`)
  }

  // ------------------------------------------------------------ the window geometry
  const saved = JSON.parse(await h.disk.read(stateFile)).main
  h.log(`geometry: dpr=${window.devicePixelRatio} inner=${window.innerWidth}x${window.innerHeight} saved=${JSON.stringify(saved)}`)
  h.check('the last session wrote its own geometry over the seed', saved.width !== SEED.width && saved.height !== SEED.height, saved)
  h.check('it is a real window size', saved.width > 0 && saved.height > 0 && saved.maximized === false && saved.fullscreen === false, saved)
  h.check('what was written is this window, in physical pixels', saved.width === Math.round(window.innerWidth * window.devicePixelRatio), { saved: saved.width, inner: window.innerWidth, dpr: window.devicePixelRatio })
  h.check('the seeded file was read: its position is the one the window started from', saved.prev_x === SEED.x && saved.prev_y === SEED.y, { prev: [saved.prev_x, saved.prev_y], seed: [SEED.x, SEED.y] })
  h.check('`visible` is never restored, so a window cannot come back hidden (AD-9)', saved.visible === SEED.visible && !!(await h.disk.stat(stateFile)), saved.visible)

  // ------------------------------------------------------------ the settings
  h.check('the theme came back from settings.json', ctx.settings.get('appearance.theme') === 'light', ctx.settings.get('appearance.theme'))
  h.check('and is applied to the document', document.documentElement.dataset.theme === 'light', document.documentElement.dataset.theme)
  h.check('nothing was dropped on the way', ctx.settings.report().error === undefined && ctx.settings.report().warnings.length === 0, ctx.settings.report())

  // ------------------------------------------------------------ the ui state
  h.check('the panel layout came back from state.json', !!h.q('panel', { region: 'bottom' }), h.qa('panel').map((e) => e.dataset.region))
  h.check('the layout store agrees with what is on screen', read(ctx.layout.state).bottom.visible === true, read(ctx.layout.state).bottom)

  // ------------------------------------------------------------ the recent list
  await h.waitFor(() => read(ctx.recent.list).length === 1, { timeout: 10000 })
  h.check('the recent list came back too, and knows the file is still there', read(ctx.recent.list)[0]?.path === keep && read(ctx.recent.list)[0]?.exists === true, read(ctx.recent.list))

  // ------------------------------------------------------------ crash safety (AD-8)
  const names = await listDir(h, paths.configDir)
  h.check('the config folder holds all three files and no temp file', tempLeftovers(names).length === 0 && names.includes('settings.json') && names.includes('state.json') && names.includes('.window-state.json'), names)
  const dataNames = paths.dataDir === paths.configDir ? names : await listDir(h, paths.dataDir)
  h.check('and neither does the data folder', tempLeftovers(dataNames).length === 0, dataNames)
})
