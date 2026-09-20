// The scripting backend at the IPC level (plan §5 M4 H4 `m4-scripts-backend`, WP4.5 to
// WP4.7, AD-13, §7.6). Four scenarios, because three of them need an app of their own:
//
//   m4-scripts-backend   discovery, the bundled scripts against their own goldens, the
//                        refused ids, the timeout and the cancel
//   m4-python-missing    a `GEDIT_PYTHON` that points at nothing
//   m4-scripts-quit-1/-2 a script that is still running when the window closes
//
// **Why the goldens are re-run here.** `tests/python/test_tool_list.py` runs the same
// fixtures, but it runs them with the interpreter of the person running the tests, a
// hand-built context and `PYTHONPATH` set by the test. What this scenario adds is the
// path nobody else takes: the Rust runner resolving the id, choosing the interpreter,
// writing `GEDIT_CONTEXT` into a temp folder, putting the bundled folder on
// `PYTHONPATH` so `import gedit_nc` finds ours and not someone else's, and the context
// coming from the **live** profile registry and code database rather than from a copy.
//
// **How the process checks are made.** A run's child is `<interpreter> <script>`, so
// `h.pgrep('rh_sleeper.py')` finds it. The script also starts a grandchild that carries
// a marker in its command line, because the interesting half of AD-13 is `killpg`: a
// script that spawned something of its own must not leave it behind either. The marker
// has no regular-expression characters in it, since `pgrep -f` takes a pattern.
//
// The quit pair keeps its script **outside both run folders**, in `runs/m4-quit-scripts`,
// and reaches it through the `scripts.folders` setting. That matters: when a run ends,
// the harness kills everything whose command line matches that run's folder, which would
// clean up the very process `-2` is looking for and turn a real leak into a pass.

import { scenario } from '../lib/index.js'
import { configPaths } from './m2-common.js'
import { context, ready } from './m4-common.js'

/** The three scripts `src-tauri/resources/scripts` ships, sorted. */
const BUNDLED = ['bundled:scale_feed.py', 'bundled:scale_speed.py', 'bundled:tool_list.py']

/** In the grandchild's command line, so `pgrep -f` can find it. No regex characters. */
const GRANDCHILD = 'GEDITRHGRANDCHILD'

/**
 * A script that marks that it started, leaves a grandchild behind and then sleeps.
 * `output = "panel"` keeps it in the v1 shape, which is all the backend needs in M4.
 * @param {number} seconds
 */
const sleeper = (seconds) => `# /// gedit
# name = "Harness sleeper"
# description = "Sleeps, so a timeout, a cancel and a quit have something to kill."
# output = "panel"
# ///
"""Written for gEdit's runtime harness (H4). Not a bundled script."""

import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CHILD = "import time  # ${GRANDCHILD}\\ntime.sleep(${seconds})\\n"

child = subprocess.Popen([sys.executable, "-c", CHILD])
with open(os.path.join(HERE, "started.txt"), "w", encoding="utf-8") as handle:
    handle.write("{} {}\\n".format(os.getpid(), child.pid))
sys.stderr.write("sleeping\\n")
sys.stderr.flush()
time.sleep(${seconds})
print("the harness sleeper was not stopped")
`

/**
 * What a backend call answered, or null when it did not. `h.attempt` hands back a
 * discriminated union, and a check that reads one field out of it in three places is
 * easier to read than three `r.ok && r.value…`.
 * @param {{ ok: true, value: any } | { ok: false, error: string }} r
 * @returns {any}
 */
const valueOf = (r) => (r.ok ? r.value : null)

/**
 * A `ScriptContextV2` built from the live registries, the way `WP5.1` will build it.
 * @param {any} ctx
 * @param {string} text
 * @param {Record<string, unknown>} params
 * @param {string} [profileId]
 */
function scriptContext(ctx, text, params, profileId = 'fanuc-gcode') {
  return {
    contract: 2,
    document: { path: null, name: 'Untitled-1', profile: profileId, encoding: 'utf-8', hasBom: false, lineEnding: 'lf', modified: false },
    input: { scope: 'document', startLine: 1, endLine: text.split('\n').length },
    cursor: { line: 1, column: 1 },
    params,
    profile: ctx.profiles.profile(profileId),
    codes: ctx.codes.forScripts(profileId),
  }
}

/**
 * JSON on stdout, or the parse error, so a failing check says what came back.
 * @param {{ ok: true, value: any } | { ok: false, error: string }} run
 * @returns {any}
 */
function payloadOf(run) {
  try {
    return JSON.parse(run.ok ? run.value.stdout : '')
  } catch (err) {
    return { parseError: String(err), stdout: run.ok ? run.value.stdout.slice(0, 400) : run }
  }
}

scenario('m4-scripts-backend', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)

  // ================================================================ A. python_check
  const python = await h.attempt('python_check')
  h.check(
    'python_check finds the interpreter the run was given, and it is new enough',
    python.ok && python.value.ok === true && python.value.interpreter === h.cfg.python && /^3\.(9|1\d)\b/.test(python.value.version ?? ''),
    python,
  )

  // ================================================================== B. discovery
  const list = await h.attempt('scripts_list')
  h.check('scripts_list answers', list.ok, list)
  /** @type {any[]} */
  const scripts = list.ok ? list.value.scripts : []
  const bundled = scripts.filter((s) => s.root === 'bundled').map((s) => s.id).sort()
  h.check('the three bundled scripts are listed and nothing else is bundled', JSON.stringify(bundled) === JSON.stringify(BUNDLED), bundled)
  h.check('the library module is not offered as a script', !scripts.some((s) => s.id.includes('gedit_nc')), scripts.map((s) => s.id))
  h.check(
    'every bundled header parsed, with no warning, and none of them is editable',
    scripts.filter((s) => s.root === 'bundled').every((s) => s.headerError === null && s.meta !== null && s.meta.warnings.length === 0 && s.editable === false),
    scripts.filter((s) => s.root === 'bundled').map((s) => ({ id: s.id, err: s.headerError, editable: s.editable, warnings: s.meta?.warnings })),
  )
  const toolList = scripts.find((s) => s.id === 'bundled:tool_list.py') ?? null
  h.check(
    'the tool list declares a report with its three parameters',
    !!toolList && toolList.meta.output === 'report' && toolList.meta.params.length === 3 && toolList.meta.documents === 'active',
    toolList?.meta,
  )
  /** @type {any[]} */
  const folders = list.ok ? list.value.folders : []
  h.check(
    'the folder list names the bundled and the user root, and the user folder exists',
    folders.some((f) => f.root === 'bundled') && folders.some((f) => f.root === 'user' && f.path === paths.userScriptsDir && f.exists === true),
    folders,
  )

  // ============================================== C. the bundled scripts on their goldens
  const toolCase = await h.fixture('scripts/tool_list/fanuc-preselect')
  const toolInput = await h.disk.read(`${toolCase}/input.nc`)
  const toolGolden = JSON.parse(await h.disk.read(`${toolCase}/expected.json`))
  const toolRun = await h.attempt('script_run', {
    req: { runId: 'm4-tool', scriptId: 'bundled:tool_list.py', stdin: toolInput, context: scriptContext(ctx, toolInput, {}), timeoutSecs: 30 },
  })
  h.check('tool_list.py runs to a clean exit through the real runner', toolRun.ok && toolRun.value.success === true && toolRun.value.stderr === '', {
    ok: toolRun.ok,
    code: toolRun.ok ? toolRun.value.exitCode : null,
    stderr: toolRun.ok ? toolRun.value.stderr.slice(0, 400) : toolRun,
  })
  h.check('and its report is the golden of its own fixture', JSON.stringify(payloadOf(toolRun)) === JSON.stringify(toolGolden), {
    got: JSON.stringify(payloadOf(toolRun)).slice(0, 600),
    want: JSON.stringify(toolGolden).slice(0, 600),
  })
  h.check('the interpreter it reports is the one python_check named', toolRun.ok && toolRun.value.interpreter === h.cfg.python, toolRun.ok ? toolRun.value.interpreter : null)

  for (const script of ['scale_feed', 'scale_speed']) {
    const dir = await h.fixture(`scripts/${script}/fanuc-basic`)
    const input = await h.disk.read(`${dir}/input.nc`)
    const expected = await h.disk.read(`${dir}/expected.nc`)
    const envelope = JSON.parse(await h.disk.read(`${dir}/envelope.json`))
    const params = JSON.parse(await h.disk.read(`${dir}/params.json`).catch(() => '{}'))
    const run = await h.attempt('script_run', {
      req: { runId: `m4-${script}`, scriptId: `bundled:${script}.py`, stdin: input, context: scriptContext(ctx, input, params), timeoutSecs: 30 },
    })
    const payload = payloadOf(run)
    h.check(`${script}.py runs to a clean exit`, run.ok && run.value.success === true && run.value.stderr === '', {
      ok: run.ok,
      stderr: run.ok ? run.value.stderr.slice(0, 400) : run,
    })
    h.check(`${script}.py answers with the envelope its fixture expects`, payload?.text === expected && payload?.message === envelope.message && JSON.stringify(payload?.findings) === JSON.stringify(envelope.findings), {
      text: payload?.text,
      expected,
      message: payload?.message,
      findings: payload?.findings,
    })
  }

  // ======================================================== D. the ids that are refused
  /** @type {Record<string, { ok: true, value: any } | { ok: false, error: string }>} */
  const refusals = {}
  for (const id of ['user:../../../etc/passwd', 'bundled:/etc/passwd', 'bundled:sub/../tool_list.py', 'nowhere:tool_list.py', 'tool_list.py', 'bundled:a/b/c.py', 'bundled:', 'user:.py']) {
    refusals[id] = await h.attempt('script_run', { req: { runId: `m4-bad-${id}`, scriptId: id, stdin: '', context: {}, timeoutSecs: 5 } })
  }
  h.check('a traversing, absolute, unknown-root or malformed id is refused before anything runs', Object.values(refusals).every((r) => !r.ok), refusals)
  const sourceOfBundled = await h.attempt('script_source_path', { scriptId: 'bundled:tool_list.py' })
  h.check('a bundled script is never granted to the webview', !sourceOfBundled.ok, sourceOfBundled)

  // ============================================== E. the timeout, and what it leaves
  const scriptPath = `${paths.userScriptsDir}/rh_sleeper.py`
  await h.disk.write(scriptPath, sleeper(300))
  const userScripts = async () => /** @type {any[]} */ (valueOf(await h.attempt('scripts_list'))?.scripts ?? [])
  await h.waitFor(async () => (await userScripts()).some((s) => s.id === 'user:rh_sleeper.py'), { timeout: 10000 })
  const user = (await userScripts()).find((s) => s.id === 'user:rh_sleeper.py') ?? null
  h.check('a script in the user folder is found, and it is editable', !!user && user.editable === true && user.headerError === null, user)

  const started = performance.now()
  const timedOut = await h.attempt('script_run', {
    req: { runId: 'm4-timeout', scriptId: 'user:rh_sleeper.py', stdin: '', context: scriptContext(ctx, '', {}), timeoutSecs: 1 },
  })
  const tookMs = Math.round(performance.now() - started)
  h.check('a run that outstays its deadline comes back as timed out, not as a success', timedOut.ok && timedOut.value.timedOut === true && timedOut.value.success === false, {
    ok: timedOut.ok,
    value: timedOut.ok ? { timedOut: timedOut.value.timedOut, success: timedOut.value.success, code: timedOut.value.exitCode, cancelled: timedOut.value.cancelled } : timedOut,
  })
  h.check('it is killed at the deadline rather than run to the end', tookMs < 10000 && timedOut.ok && timedOut.value.durationMs >= 900, { tookMs, durationMs: timedOut.ok ? timedOut.value.durationMs : null })
  h.check('what it printed before the deadline is still reported', timedOut.ok && timedOut.value.stderr.includes('sleeping'), timedOut.ok ? timedOut.value.stderr.slice(0, 200) : null)
  h.check('the script did not finish, so nothing it prints at the end came back', timedOut.ok && !timedOut.value.stdout.includes('not stopped'), timedOut.ok ? timedOut.value.stdout.slice(0, 200) : null)

  const leftAfterTimeout = { script: await h.pgrep('rh_sleeper.py'), grandchild: await h.pgrep(GRANDCHILD) }
  h.check('neither the script nor the grandchild it started is left running (killpg)', leftAfterTimeout.script.length === 0 && leftAfterTimeout.grandchild.length === 0, leftAfterTimeout)

  // ====================================================================== F. cancel
  const running = h.attempt('script_run', {
    req: { runId: 'm4-cancel', scriptId: 'user:rh_sleeper.py', stdin: '', context: scriptContext(ctx, '', {}), timeoutSecs: 120 },
  })
  const alive = await h.waitFor(async () => {
    const pids = await h.pgrep('rh_sleeper.py')
    return pids.length > 0 ? pids : null
  }, { timeout: 15000, interval: 100 })
  h.check('the run really started a process', (alive ?? []).length > 0, alive)
  const grandchildAlive = await h.waitFor(async () => {
    const pids = await h.pgrep(GRANDCHILD)
    return pids.length > 0 ? pids : null
  }, { timeout: 15000, interval: 100 })
  h.check('and the grandchild it spawned is running too', (grandchildAlive ?? []).length > 0, grandchildAlive)

  const cancelled = await h.attempt('script_cancel', { runId: 'm4-cancel' })
  h.check('cancel answers true for a run that was still going', cancelled.ok && cancelled.value === true, cancelled)
  const result = await running
  h.check('the cancelled run comes back as cancelled', result.ok && result.value.cancelled === true && result.value.success === false && result.value.timedOut === false, {
    ok: result.ok,
    value: result.ok ? { cancelled: result.value.cancelled, success: result.value.success, timedOut: result.value.timedOut } : result,
  })
  const leftAfterCancel = await h.waitFor(async () => {
    const script = await h.pgrep('rh_sleeper.py')
    const grandchild = await h.pgrep(GRANDCHILD)
    return script.length === 0 && grandchild.length === 0 ? { script, grandchild } : null
  }, { timeout: 10000, interval: 200 })
  h.check('cancel leaves no process behind either', leftAfterCancel !== null, {
    script: await h.pgrep('rh_sleeper.py'),
    grandchild: await h.pgrep(GRANDCHILD),
  })
  const cancelledAgain = await h.attempt('script_cancel', { runId: 'm4-cancel' })
  h.check('cancelling a run that is over answers false', cancelledAgain.ok && cancelledAgain.value === false, cancelledAgain)
})

// ---------------------------------------------------------------------------------
// A Python that is not there
// ---------------------------------------------------------------------------------

scenario('m4-python-missing', { timeout: 180, python: '{run}/no-such-folder/python3' }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // `h.cfg.python` is the harness's own interpreter, whatever the scenario handed the
  // app; what this run set is the `python` option above, spelled out again here.
  const missing = `${h.cfg.run}/no-such-folder/python3`
  const python = await h.attempt('python_check')
  h.check('python_check says there is no usable interpreter, and names the one it tried', python.ok && python.value.ok === false && python.value.interpreter === missing && typeof python.value.message === 'string' && python.value.message.includes(missing), python)
  h.check('it reports no version for an interpreter it could not run', python.ok && (python.value.version === null || python.value.version === undefined), python.ok ? python.value.version : null)

  const run = await h.attempt('script_run', {
    req: {
      runId: 'm4-nopython',
      scriptId: 'bundled:tool_list.py',
      stdin: 'T1 M6\nM30\n',
      context: scriptContext(ctx, 'T1 M6\nM30\n', {}),
      timeoutSecs: 10,
    },
  })
  h.check('a run refuses with a message instead of hanging or pretending to succeed', !run.ok && typeof run.error === 'string' && run.error !== '', run)
  h.check('the app is still usable afterwards', h.q('app-shell')?.dataset.ready === '1' && h.qa('doc-tab').length >= 1, h.qa('doc-tab').length)
})

// ---------------------------------------------------------------------------------
// A script that is still running when the window closes
// ---------------------------------------------------------------------------------

/** `<rh>/runs/m4-quit-scripts`: beside both run folders, inside neither. */
const quitScripts = (/** @type {string} */ run) => run.replace(/\/[^/]+$/, '/m4-quit-scripts')

scenario('m4-scripts-quit-1', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  const dir = quitScripts(h.cfg.run)
  await h.disk.write(`${dir}/rh_quit_sleeper.py`, sleeper(120))
  await h.disk.write(`${dir}/started.txt`, '')
  await ctx.settings.save({ 'scripts.folders': [dir] })
  const roots = async () => /** @type {any[]} */ (valueOf(await h.attempt('scripts_list'))?.scripts ?? [])
  const listed = await h.waitFor(async () => (await roots()).some((s) => s.id === 'extra0:rh_quit_sleeper.py'), { timeout: 15000 })
  h.check('the extra folder from the settings is a script root', listed === true, (await roots()).map((s) => s.id))

  // Started and deliberately not awaited: the app is about to go away under it.
  void h.attempt('script_run', {
    req: { runId: 'm4-quit', scriptId: 'extra0:rh_quit_sleeper.py', stdin: '', context: scriptContext(ctx, '', {}), timeoutSecs: 120 },
  })

  const pids = await h.waitFor(async () => {
    const found = await h.pgrep('rh_quit_sleeper.py')
    return found.length > 0 ? found : null
  }, { timeout: 20000, interval: 100 })
  h.check('the script is running when the window is asked to close', (pids ?? []).length > 0, pids)
  const grandchildren = await h.waitFor(async () => {
    const found = await h.pgrep(GRANDCHILD)
    return found.length > 0 ? found : null
  }, { timeout: 20000, interval: 100 })
  h.check('so is the grandchild it started', (grandchildren ?? []).length > 0, grandchildren)
  h.check('the script wrote down which processes it owns, for the next run to look for', ((await h.disk.read(`${dir}/started.txt`)) ?? '').trim() !== '', await h.disk.read(`${dir}/started.txt`))

  // No unsaved document, so nothing asks: the window closes and `on_run_event(Exit)`
  // calls `scripts::kill_all`.
  h.expectExit({ events: ['CloseRequested main', 'Exit'], within: 20000 })
  await h.window.close()
})

scenario('m4-scripts-quit-2', { timeout: 180 }, async (h) => {
  await ready(h)
  const dir = quitScripts(h.cfg.run)

  const started = await h.disk.read(`${dir}/started.txt`).catch(() => '')
  if (started.trim() === '') {
    await h.blocked('m4-scripts-quit-1 never started a script, so there is nothing to look for', { dir })
    return
  }
  h.check('the previous run started a script and a grandchild', started.trim().split(/\s+/).length === 2, started.trim())

  const script = await h.pgrep('rh_quit_sleeper.py')
  const grandchild = await h.pgrep(GRANDCHILD)
  h.check('the script did not outlive the window that started it (AD-13, F19)', script.length === 0, script)
  h.check('neither did the grandchild it spawned', grandchild.length === 0, grandchild)
})
