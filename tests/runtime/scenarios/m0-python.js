// Which Python runs a script. All four scenarios start the app the way Finder does,
// with a minimal environment, and let the backend resolve the interpreter itself.

import { scenario } from '../lib/index.js'

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

/** A login shell profile that puts the stand-in interpreter on PATH. */
const PROFILE = 'export PATH="{run}/pybin:$PATH"\n'

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
  'alt/python3': { text: wrapper('override'), mode: 0o755 },
  ...extra,
})

/**
 * Runs pyexe.py and reports what it saw, with how long the call took.
 * @param {import('../lib/api.js').Harness} h
 * @param {string} scripts
 */
async function runScript(h, scripts) {
  const t0 = performance.now()
  const r = await h.attempt('run_python_script', { folderPath: scripts, scriptName: 'pyexe.py', inputText: 'G0 X0\n' })
  const ms = Math.round(performance.now() - t0)
  return {
    ms,
    ok: r.ok,
    error: r.ok ? undefined : r.error,
    success: r.ok && r.value.success === true,
    stderr: r.ok ? r.value.stderr : '',
    data: r.ok && r.value.data && typeof r.value.data === 'object' ? r.value.data : {},
  }
}

scenario('m0-py3-default', { timeout: 120, env: 'finder', python: null, files: files({ 'home/.zprofile': PROFILE }) }, async (h) => {
  const scripts = await h.fixture('scripts', { from: 'runtime' })
  const first = await runScript(h, scripts)
  h.check('the login shell profile decides which python3 runs a script', first.success && first.data.via === 'profile' && !first.data.geditPython, first)
  h.check('the lookup does not delay the first run', first.ms < 3000, { ms: first.ms })

  // With the profile gone, a second lookup would find another interpreter; it must not happen.
  await h.disk.write(`${h.cfg.home}/.zprofile`, '# the harness emptied this file\n')
  const cached = await runScript(h, scripts)
  h.check('the interpreter is resolved once and then reused', cached.success && cached.data.via === 'profile' && cached.ms < first.ms, {
    first: first.ms,
    cached: cached.ms,
    via: cached.data.via,
  })

  await h.setenv('GEDIT_PYTHON', `${h.cfg.run}/alt/python3`)
  const overridden = await runScript(h, scripts)
  h.check('GEDIT_PYTHON decides for every call', overridden.success && overridden.data.via === 'override', overridden)
  await h.setenv('GEDIT_PYTHON', null)
  const back = await runScript(h, scripts)
  h.check('removing it brings the cached interpreter back', back.success && back.data.via === 'profile' && back.ms < first.ms, back)
})

scenario('m0-py3-zdotdir', { timeout: 120, env: 'finder', python: null, vars: { ZDOTDIR: '{run}/zdot' }, files: files({ 'zdot/.zprofile': NOISY_PROFILE }) }, async (h) => {
  const scripts = await h.fixture('scripts', { from: 'runtime' })
  const first = await runScript(h, scripts)
  const second = await runScript(h, scripts)
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
  const scripts = await h.fixture('scripts', { from: 'runtime' })
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
  const run = await runScript(h, scripts)
  h.check(
    'the shell answer is only the macOS stub, so a real install is used instead',
    run.success && (expected === STUB || run.data.executable === expected),
    { expected, run },
  )
  const log = await h.disk.read(`${h.cfg.run}/fakeshell.log`).catch(() => '')
  h.check('the login shell was asked once, without an interactive session', /args: -l -c echo; command -v python3/.test(log) && log.trim().split('\n').length === 1, { log })
})

scenario('m0-py3-override', { timeout: 120, env: 'finder', python: '{run}/alt/python3', vars: { SHELL: '{run}/fakeshell.sh' }, files: files({ 'fakeshell.sh': { text: FAKE_SHELL, mode: 0o755 } }) }, async (h) => {
  const scripts = await h.fixture('scripts', { from: 'runtime' })
  const run = await runScript(h, scripts)
  h.check('GEDIT_PYTHON is used as it is', run.success && run.data.via === 'override' && run.data.geditPython === `${h.cfg.run}/alt/python3`, run)
  h.check('the login shell is never asked', (await h.disk.stat(`${h.cfg.run}/fakeshell.log`)) === null)
})
