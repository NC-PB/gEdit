// The macOS quit guard (plan §5 M6 H6 `m6-dock-quit-dirty` / `m6-dock-quit-clean`, §7.10,
// AD-20, owner decision D27, WP6.5).
//
// **What these two scenarios are the only proof of.** gEdit can veto a *window* close, and
// Phase 1 did. But Dock → Quit, ⌘Q pressed while another app is in front, a logout and a
// shutdown do not go through the window at all: AppKit asks the application object's
// delegate `applicationShouldTerminate:` and wants the answer on the spot. Until M6 that
// answer was always "yes", so a logout with unsaved work lost it. `quit.rs` now adds the
// method to the delegate at startup and answers from a flag the webview keeps up to date.
//
// The cargo tests prove the *decision* (`decide`) and that a class can be patched. What
// they cannot reach is the real `NSApp` delegate that tao installs — whether the method was
// added to *that* object, at the right moment, and whether AppKit calls it. `h_quit('terminate')`
// is `[NSApp terminate:]`, the same call Dock → Quit makes, so these two runs are where
// that is settled. **A failure here means the hook did not install**, not that the scenario
// is wrong: read `app.log`, where every give-up path prints a line beginning "The quit
// guard …"; silence at startup means it installed.
//
// The clean half is the regression that matters most, and it is a pair for the same reason
// `m5-scripts-exitkill` is: a guard that cancels a clean quit also cancels a logout, and a
// quit that skipped the process cleanup would leave a script running under a dead app.

import { scenario } from '../lib/index.js'
import { GRANDCHILD, message, pythonProbe, ready, scriptStatus, sleeper, startScript, waitForScript } from './m5-common.js'
import { context } from './m6-common.js'

const COMBINED = JSON.stringify(['Save All', 'Discard All', 'Cancel'])

/** `<rh>/runs/m6-quit-scripts`: beside both run folders of the clean pair, inside neither. */
const quitScripts = (/** @type {string} */ run) => run.replace(/\/[^/]+$/, '/m6-quit-scripts')

// =================================================================================
// m6-dock-quit-dirty
// =================================================================================

scenario('m6-dock-quit-dirty', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dirtyTabs = () => h.qa('doc-tab', { dirty: '1' }).map((e) => e.dataset.path)

  const fanuc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const lathe = await h.fixture('nc/fanuc-lathe/l01-turning-a.nc')
  const fanucHex = await h.disk.hex(fanuc)
  const latheHex = await h.disk.hex(lathe)

  await h.dialogs.queue('open', [fanuc, lathe])
  await ctx.files.open()
  await h.waitFor(() => !!h.q('doc-tab', { path: lathe }) && !h.q('doc-tab', { path: '' }), { timeout: 15000 })

  for (const path of [fanuc, lathe]) {
    h.click(h.q('doc-tab', { path }))
    await h.waitFor(() => h.q('doc-tab', { path, active: '1' }) !== null)
    h.focusEditor()
    await h.nativeType('(UNSAVED)')
    await h.waitFor(() => !!h.q('doc-tab', { path, dirty: '1' }), { timeout: 5000 })
  }
  h.check('two documents have unsaved changes', JSON.stringify(dirtyTabs()) === JSON.stringify([fanuc, lathe]), dirtyTabs())
  // The flag is sent on flips, so the backend has to have heard about this one before the
  // termination request; `idle()` waits for the IPC call to land.
  await h.idle()

  // ---------------------------------------------------------------- the Dock's own quit
  await h.window.terminate()
  const alert = await h.alert.wait({ timeout: 15000 })
  const state = await h.window.state()
  h.check('Dock → Quit is held, and gEdit asks its own one combined question', JSON.stringify(alert?.buttons) === COMBINED && state.alerts === 1, { alert, state })
  h.check('which names both unsaved documents', (alert?.texts ?? []).join('\n').includes('f01-mill-3tools.nc') && (alert?.texts ?? []).join('\n').includes('l01-turning-a.nc'), alert?.texts)
  h.check('and the app is still running while the question is up', state.exists === true, state)

  await h.alert.click('Cancel')
  await h.sleep(900)
  const afterCancel = await h.window.state()
  h.check('Cancel keeps the app and both unsaved documents: a logout is interrupted, not obeyed', afterCancel.exists && JSON.stringify(dirtyTabs()) === JSON.stringify([fanuc, lathe]), {
    state: afterCancel,
    dirty: dirtyTabs(),
  })
  h.check('and neither file on disk was touched', (await h.disk.hex(fanuc)) === fanucHex && (await h.disk.hex(lathe)) === latheHex)

  // A second request must behave the same way: the flag is still true, so it is held again.
  await h.window.terminate()
  const second = await h.alert.wait({ timeout: 15000 })
  h.check('asking again asks again, rather than giving up and quitting', JSON.stringify(second?.buttons) === COMBINED && (await h.window.state()).alerts === 1, {
    alert: second,
    state: await h.window.state(),
  })

  // ---------------------------------------------------------------- Discard All exits
  // This path runs `files.onWillQuit`, which sets the flag back to `false` before the
  // window is destroyed, so the guard is not re-entered on the way out.
  h.expectExit({
    files: [
      { path: fanuc, hex: fanucHex },
      { path: lathe, hex: latheHex },
    ],
    events: ['CloseRequested main', 'Exit'],
    within: 25000,
  })
  await h.sleep(500)
  await h.alert.click('Discard All').catch(() => {})
})

// =================================================================================
// m6-dock-quit-clean
// =================================================================================

scenario('m6-dock-quit-clean-1', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  h.check('the startup probe found an interpreter', (await pythonProbe(h))?.ok === true)

  // The script lives outside both run folders, so the harness's own cleanup (which kills
  // whatever names this run's folder) cannot do the guard's work for it.
  const dir = quitScripts(h.cfg.run)
  await h.disk.write(`${dir}/rh_quit_sleeper.py`, sleeper({ seconds: 180 }))
  await h.disk.write(`${dir}/started.txt`, '')
  await ctx.settings.save({ 'scripts.folders': [dir] })

  const id = 'extra0:rh_quit_sleeper.py'
  h.check('the folder became a script root', await waitForScript(h, id, 20000), id)

  const file = await h.fixture('nc/fanuc-lathe/l01-turning-a.nc')
  await h.dialogs.queue('open', file)
  await ctx.files.open()
  await h.waitFor(() => !!h.q('doc-tab', { path: file }), { timeout: 15000 })
  await h.idle()
  h.check('nothing is unsaved', h.qa('doc-tab', { dirty: '1' }).length === 0 && ctx.docs.all().every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))

  const { done: running } = await startScript(h, id)
  // Deliberately not awaited: the app is about to go away under it.
  void running.catch(() => undefined)
  const pids = await h.waitFor(async () => {
    const found = await h.pgrep('rh_quit_sleeper.py')
    return found.length > 0 ? found : null
  }, { timeout: 25000, interval: 100 })
  h.check('a script is running when the Dock quit arrives', (pids ?? []).length > 0, pids)
  // The sleeper writes the two pids **after** spawning the grandchild, so the file is
  // waited for rather than read the moment `pgrep` first sees the parent — and the next
  // run reads that file to know what to look for.
  const wrote = await h.waitFor(async () => {
    const text = await h.disk.read(`${dir}/started.txt`).catch(() => '')
    return text.trim() === '' ? null : text.trim()
  }, { timeout: 25000, interval: 100 })
  h.check('and it started a grandchild of its own, and wrote down both pids for the next run', typeof wrote === 'string' && wrote.split(/\s+/).length === 2, wrote)
  h.check('the UI shows the run as in flight', scriptStatus(h)?.getAttribute('data-running') === '1', message(h))

  // Nothing is unsaved, so the guard must answer `NSTerminateNow` and the app must go —
  // **without** an alert. A guard that asked here would also stop a logout.
  const before = await h.alert.visible()
  h.check('no alert is up before the request', before === null, before)
  h.expectExit({ events: ['Exit'], within: 25000 })
  await h.window.terminate()
})

scenario('m6-dock-quit-clean-2', { timeout: 180 }, async (h) => {
  await ready(h)
  const dir = quitScripts(h.cfg.run)

  const started = await h.disk.read(`${dir}/started.txt`).catch(() => '')
  if (started.trim() === '') {
    await h.blocked('m6-dock-quit-clean-1 never started a script, so there is nothing to look for', { dir })
    return
  }
  h.check('the previous run started a script and a grandchild', started.trim().split(/\s+/).length === 2, started.trim())

  const script = await h.pgrep('rh_quit_sleeper.py')
  const grandchild = await h.pgrep(GRANDCHILD)
  h.check('a Dock quit that went through leaves no script process behind (AD-13)', script.length === 0, script)
  h.check('nor the grandchild it spawned', grandchild.length === 0, grandchild)
})
