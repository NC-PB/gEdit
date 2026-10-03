// Which Python runs a script. All four scenarios start the app the way Finder does,
// with a minimal environment, and let the backend resolve the interpreter itself.
//
// **Ported to the v2 backend at M5** (plan D14): `run_python_script` is gone, so the probe
// script is written into the **user scripts folder** — a root the backend already knows —
// and run by its id. `script_run` resolves an id against the roots on every call, so no
// listing has to happen first and the timings below are the interpreter lookup and the
// process, exactly as they were under v1.
//
// **What did change, and why two scenarios start with `GEDIT_PYTHON` set.** M5 runs
// `pythonCheck()` after the first render (`bootstrap.ts`), and that probe resolves the
// interpreter — so by the time a scenario asks for anything, the `OnceLock` in
// `python.rs` would already hold the answer and "how long does the first lookup take"
// would be unmeasurable. `interpreter()` short-circuits on `GEDIT_PYTHON` **without**
// filling that cache, so an app started with the override has not resolved anything yet:
// clearing the variable with `h.setenv` puts the lookup back in front of the first run,
// where it can still be timed. The two scenarios that do not time it (`stub`, `override`)
// are unchanged and let the startup probe do the resolving, which is also what proves the
// shell is asked exactly once per app.

import { scenario } from '../lib/index.js'
import { configPaths } from './m2-common.js'

/**
 * A stand-in interpreter that marks the run and hands over to the real Python.
 * @param {string} via
 */
const wrapper = (via) => `#!/bin/sh
# Written for gEdit's runtime harness: marks how it was found, then runs Python.
GEDIT_RH_VIA=${via}
export GEDIT_RH_VIA
exec "{python}" "$@"
`

/**
 * A login shell profile that puts the stand-in interpreter on PATH, and counts how often a
 * shell read it (one line in profile.log per login shell).
 */
const PROFILE = 'export PATH="{run}/pybin:$PATH"\necho sourced >> "{run}/profile.log"\n'

/** What the profile is changed to once the first lookup is done: it would pick another interpreter. */
const CHANGED_PROFILE = 'export PATH="{run}/pybin2:$PATH"\necho sourced >> "{run}/profile.log"\n'

// These scenarios write a **zsh** profile (`.zprofile`, `ZDOTDIR`), so they need zsh as the
// login shell whatever the machine's own `SHELL` is: the owner's Mac has zsh, a hosted CI
// runner has bash. The backend runs `$SHELL -l -c ...`, so pinning `SHELL` here is what makes
// the profile get read. The lookup through an arbitrary `SHELL` is `m0-py3-stub`'s business.
const ZSH = '/bin/zsh'

/** The same, plus the two things that used to stall the lookup. */
const NOISY_PROFILE = `export PATH="{run}/pybin:$PATH"
# A background job that keeps stdout open long after the shell is gone.
/usr/bin/perl -e 'sleep 8' {run} &
# Output without a trailing newline, as a prompt or title escape would leave it.
printf "\\033]0;harness\\007"
`

/** A login shell that only knows the macOS python3 stub, and records how it was called. */
const FAKE_SHELL = `#!/bin/sh
# Written for gEdit's runtime harness: answers like a profile that sees only the stub.
echo "args: $*" >> "$(dirname "$0")/fakeshell.log"
echo
echo /usr/bin/python3
`

const STUB = '/usr/bin/python3'
// Where the backend looks when the login shell has no answer of its own.
const WELL_KNOWN = [
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
]

const files = (extra = {}) => ({
  'pybin/python3': { text: wrapper('profile'), mode: 0o755 },
  'pybin2/python3': { text: wrapper('profile-changed'), mode: 0o755 },
  'alt/python3': { text: wrapper('override'), mode: 0o755 },
  ...extra,
})

/** The id the probe script runs under once it is in the user folder. */
const PROBE_ID = 'user:pyexe.py'

/** A second probe: the real paths of the running interpreter and of the one the stub scenario expects. */
const REAL_ID = 'user:pyreal.py'
/** @param {string} expected */
const realProbe = (expected) => `# Written for gEdit's runtime harness: real paths of the running and the expected interpreter.
import json
import os
import sys

sys.stdin.read()
print(json.dumps({"executable": os.path.realpath(sys.executable), "expected": os.path.realpath(${JSON.stringify(expected)})}))
`

/**
 * Copies `tests/runtime/fixtures/scripts/pyexe.py` into the user scripts folder, which is
 * a script root, so it can be reached by id. Nothing else about the folder matters: the
 * scenarios below never list it, because `script_run` resolves an id on its own.
 * @param {import('../lib/api.js').Harness} h
 */
async function installProbe(h) {
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })
  const ctx = /** @type {any} */ (h.app.ctx)
  const dir = await h.waitFor(() => {
    try {
      return configPaths(ctx).userScriptsDir
    } catch {
      return null
    }
  }, { timeout: 20000 })
  if (!dir) throw new Error('the user scripts folder was never reported')
  const scripts = await h.fixture('scripts', { from: 'runtime' })
  await h.disk.write(`${dir}/pyexe.py`, await h.disk.read(`${scripts}/pyexe.py`))
  return dir
}

/**
 * Runs pyexe.py and reports what it saw, with how long the call took.
 * @param {import('../lib/api.js').Harness} h
 * @param {string} [scriptId]
 */
async function runScript(h, scriptId = PROBE_ID) {
  const t0 = performance.now()
  const r = await h.attempt('script_run', {
    req: { runId: `m0py-${Date.now()}-${Math.random().toString(36).slice(2)}`, scriptId, stdin: 'G0 X0\n', context: {}, timeoutSecs: 30 },
  })
  const ms = Math.round(performance.now() - t0)
  /** @type {any} */
  let data = {}
  try {
    data = JSON.parse(r.ok ? r.value.stdout : 'null') ?? {}
  } catch {
    data = {}
  }
  return {
    ms,
    ok: r.ok,
    error: r.ok ? undefined : r.error,
    success: r.ok && r.value.success === true,
    stderr: r.ok ? r.value.stderr : '',
    data,
  }
}

scenario('m0-py3-default', { timeout: 120, env: 'finder', python: '{run}/alt/python3', vars: { SHELL: ZSH }, files: files({ 'home/.zprofile': PROFILE }) }, async (h) => {
  await installProbe(h)

  // The app started with the override, so nothing has been resolved yet (see the header).
  const overridden = await runScript(h)
  h.check('GEDIT_PYTHON decides for every call', overridden.success && overridden.data.via === 'override' && overridden.data.geditPython === `${h.cfg.run}/alt/python3`, overridden)

  await h.setenv('GEDIT_PYTHON', null)
  const first = await runScript(h)
  h.check('without it, the login shell profile decides which python3 runs a script', first.success && first.data.via === 'profile' && !first.data.geditPython, first)
  h.check('the lookup does not delay the first run', first.ms < 3000, { ms: first.ms })

  // With the profile changed, a second lookup would find another interpreter (`profile-changed`)
  // and read the profile a second time; neither may happen. This used to compare two run times
  // (`cached.ms < first.ms`), which a loaded CI runner turns into noise; the number of times a
  // login shell read the profile says the same thing exactly.
  const sourced = async () => (await h.disk.read(`${h.cfg.run}/profile.log`).catch(() => '')).split('\n').filter((l) => l.trim() !== '').length
  h.check('the first lookup asked the login shell once', (await sourced()) === 1, { sourced: await sourced() })
  await h.disk.write(`${h.cfg.home}/.zprofile`, CHANGED_PROFILE)
  const cached = await runScript(h)
  h.check('the interpreter is resolved once and then reused', cached.success && cached.data.via === 'profile' && (await sourced()) === 1, {
    first: first.ms,
    cached: cached.ms,
    via: cached.data.via,
    sourced: await sourced(),
  })

  await h.setenv('GEDIT_PYTHON', `${h.cfg.run}/alt/python3`)
  const again = await runScript(h)
  h.check('setting it again wins over the cached interpreter', again.success && again.data.via === 'override', again)
  await h.setenv('GEDIT_PYTHON', null)
  const back = await runScript(h)
  h.check('removing it brings the cached interpreter back', back.success && back.data.via === 'profile' && (await sourced()) === 1, { back, sourced: await sourced() })
})

scenario('m0-py3-zdotdir', { timeout: 120, env: 'finder', python: '{run}/alt/python3', vars: { SHELL: ZSH, ZDOTDIR: '{run}/zdot' }, files: files({ 'zdot/.zprofile': NOISY_PROFILE }) }, async (h) => {
  await installProbe(h)
  await h.setenv('GEDIT_PYTHON', null)
  const first = await runScript(h)
  const second = await runScript(h)
  h.check('a profile with a background job still answers', first.success && first.data.via === 'profile', first)
  h.check(
    'a job that holds the shell output open does not stall the lookup',
    first.ms < 3000 && first.ms - second.ms < 1000,
    { first: first.ms, second: second.ms },
  )
  const held = await h.pgrep(`perl -e sleep 8 ${h.cfg.run}`)
  h.check('the background job is indeed still running', held.length > 0, held)
})

scenario('m0-py3-stub', { timeout: 120, env: 'finder', python: null, vars: { SHELL: '{run}/fakeshell.sh' }, files: files({ 'fakeshell.sh': { text: FAKE_SHELL, mode: 0o755 } }) }, async (h) => {
  await installProbe(h)
  /** @param {string} p */
  const executable = async (p) => {
    const s = await h.disk.stat(p)
    return !!s && s.isFile && (s.mode & 0o111) !== 0
  }
  let expected = STUB
  for (const p of WELL_KNOWN) {
    if (await executable(p)) {
      expected = p
      break
    }
  }
  const userDir = await h.waitFor(() => configPaths(/** @type {any} */ (h.app.ctx)).userScriptsDir, { timeout: 20000 })
  await h.disk.write(`${userDir}/pyreal.py`, realProbe(expected))
  const run = await runScript(h)
  // The interpreter is compared by its real path: `expected` is the well-known link
  // (/opt/homebrew/bin/python3), and `sys.executable` may come back as the resolved target
  // (/opt/homebrew/opt/python@3.14/bin/python3.14 on a hosted runner, whose Homebrew layout
  // differs from the owner's). Both are the same file, which is what the claim is about.
  const real = await runScript(h, REAL_ID)
  h.check(
    'the shell answer is only the macOS stub, so a real install is used instead',
    run.success && real.success && (expected === STUB || real.data.executable === real.data.expected),
    { expected, run, real },
  )
  // The startup probe (`bootstrap.ts` → `python_check`) is the one that asked; the run
  // above used what it cached. One app, one login shell.
  //
  // **This check is intermittently red, and it is the app, not the scenario** — see the
  // H5 hand-off. `crate::python::interpreter` calls `resolve()` (which spawns the login
  // shell) *before* `PYTHON.get_or_init`, so two callers who both miss the cache both
  // shell out and only one of them wins the cache. M5 made that reachable by adding the
  // startup probe next to the first `script_run`. Left asserting the real claim rather
  // than the current behaviour: the shell is meant to be asked once per app.
  const log = await h.disk.read(`${h.cfg.run}/fakeshell.log`).catch(() => '')
  const asked = log.trim() === '' ? 0 : log.trim().split('\n').length
  h.check('the login shell was asked once, without an interactive session', /args: -l -c echo; command -v python3/.test(log) && asked === 1, {
    asked,
    log,
    note: asked > 1
      ? 'the login shell was asked more than once: src-tauri/src/python.rs `interpreter()` resolves outside `OnceLock::get_or_init`, so the startup probe and the first run can race'
      : undefined,
  })
})

scenario('m0-py3-override', { timeout: 120, env: 'finder', python: '{run}/alt/python3', vars: { SHELL: '{run}/fakeshell.sh' }, files: files({ 'fakeshell.sh': { text: FAKE_SHELL, mode: 0o755 } }) }, async (h) => {
  await installProbe(h)
  const run = await runScript(h)
  h.check('GEDIT_PYTHON is used as it is', run.success && run.data.via === 'override' && run.data.geditPython === `${h.cfg.run}/alt/python3`, run)
  h.check('the login shell is never asked, not even by the startup probe', (await h.disk.stat(`${h.cfg.run}/fakeshell.log`)) === null)
})
