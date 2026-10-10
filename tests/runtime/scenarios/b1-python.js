// B1 A3 and B4: which folders a script finds its tools in, and when the login shell is started.
//
//   b1-py3-loginpath   (A3) An app started the way Finder starts it has launchd's short PATH. The login shell is asked once
//                      (together with the interpreter) and the folders it reports that the app does not have are added
//                      *behind* the app's own, so a script finds `git`, `ffmpeg` or a Homebrew tool by name.
//   b1-py3-setting     (B4) `scripts.python` in the settings file is the way out for a login shell that is broken or slow:
//                      with it set, gEdit never starts the login shell, not for the interpreter and not for the PATH.
//                      (The first hosted run of the round found A3 asking the shell for the PATH even then.)
//
// Both start the app with the minimal environment of a Finder launch and a stand-in login shell that records how it was
// called. `m0-py3-override` holds the same claim for `GEDIT_PYTHON`.

import { scenario } from '../lib/index.js'
import { configPaths } from './m2-common.js'
import { context, ready } from './b1-common.js'

const CONFIG = 'home/Library/Application Support/com.pburg.gedit'
const LOGIN_EXTRA = '/opt/gedit-rh-login-bin'

/** A stand-in interpreter that marks the run and hands over to the real Python. */
const WRAPPER = `#!/bin/sh
# Written for gEdit's runtime harness: marks how it was found, then runs Python.
GEDIT_RH_VIA=setting
export GEDIT_RH_VIA
exec "{python}" "$@"
`

/** A login shell that answers the way a profile would, and records every call. */
const FAKE_SHELL = `#!/bin/sh
# Written for gEdit's runtime harness: names the real Python and a PATH with one folder more.
echo "called" >> "$(dirname "$0")/fakeshell.log"
echo
echo "{python}"
printf '\\n%s%s\\n' 'GEDIT_LOGIN_PATH=' "/usr/bin:/bin:${LOGIN_EXTRA}"
`

const PROBE_ID = 'user:pyexe.py'

/**
 * @param {import('../lib/api.js').Harness} h
 */
async function installAndRun(h) {
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })
  const ctx = context(h)
  const dir = configPaths(ctx).userScriptsDir
  const scripts = await h.fixture('scripts', { from: 'runtime' })
  await h.disk.write(`${dir}/pyexe.py`, await h.disk.read(`${scripts}/pyexe.py`))
  const r = await h.attempt('script_run', {
    req: { runId: `b1py-${Date.now()}`, scriptId: PROBE_ID, stdin: 'G0 X0\n', context: {}, timeoutSecs: 30 },
  })
  /** @type {any} */
  let data = {}
  try {
    data = JSON.parse(r.ok ? r.value.stdout : 'null') ?? {}
  } catch {
    data = {}
  }
  return { ok: r.ok && r.value.success === true, error: r.ok ? undefined : r.error, stderr: r.ok ? r.value.stderr : '', data }
}

scenario(
  'b1-py3-loginpath',
  { timeout: 120, env: 'finder', python: null, vars: { SHELL: '{run}/fakeshell.sh' }, files: { 'fakeshell.sh': { text: FAKE_SHELL, mode: 0o755 } } },
  async (h) => {
    await ready(h)
    const run = await installAndRun(h)
    const path = String(run.data.path ?? '')
    const folders = path.split(':')
    h.check('the script ran', run.ok, run)
    h.check('its PATH has the folder only the login shell reported', folders.includes(LOGIN_EXTRA), path)
    h.check('and that folder comes behind the ones the app was started with, which keep their order', folders.indexOf(LOGIN_EXTRA) === folders.length - 1 && folders.indexOf('/usr/bin') < folders.indexOf(LOGIN_EXTRA), folders)
    h.check('no folder is there twice', new Set(folders).size === folders.length, folders)
    const calls = (await h.disk.read(`${h.cfg.run}/fakeshell.log`).catch(() => '')).split('\n').filter((line) => line === 'called').length
    h.check('the login shell was asked once for both the interpreter and the PATH', calls === 1, calls)
  },
)

scenario(
  'b1-py3-setting',
  {
    timeout: 120,
    env: 'finder',
    python: null,
    vars: { SHELL: '{run}/fakeshell.sh' },
    files: {
      'fakeshell.sh': { text: FAKE_SHELL, mode: 0o755 },
      'alt/python3': { text: WRAPPER, mode: 0o755 },
      [`${CONFIG}/settings.json`]: '{"$version":1,"scripts.python":"{run}/alt/python3"}\n',
    },
  },
  async (h) => {
    await ready(h)
    const ctx = context(h)
    h.check('the setting is read', ctx.settings.get('scripts.python') === `${h.cfg.run}/alt/python3`, ctx.settings.get('scripts.python'))
    const run = await installAndRun(h)
    h.check('the script ran with the interpreter of the setting', run.ok && run.data.via === 'setting', run)
    const path = String(run.data.path ?? '')
    h.check('its PATH is the one the app has: nothing was added from a login shell', !path.split(':').includes(LOGIN_EXTRA), path)
    h.check('the login shell was never started: not by the startup probe, not by the script run', (await h.disk.stat(`${h.cfg.run}/fakeshell.log`)) === null)
  },
)
