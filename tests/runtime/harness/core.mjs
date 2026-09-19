// Shared node code of the harness scripts: paths, the run lock, scenario discovery,
// the page bundle, and running one scenario against the synced test build.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RUNTIME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO = path.resolve(RUNTIME_DIR, '../..')

// Console output every run may produce (see README.md). Anything else fails the run.
export const KNOWN_NOISE = [
  // Monaco's clipboard workaround under synthetic (untrusted) events.
  /NotAllowedError/,
  // Monaco cancels pending async work (e.g. hovers, delayed tokenization) with this.
  /^unhandledrejection: (Canceled|Error: Canceled)/,
]

/** The harness state folder: builds, run folders, results. */
export function rhDir() {
  const dir = process.env.GEDIT_RH_DIR || path.join(os.tmpdir(), 'gedit-rh')
  fs.mkdirSync(dir, { recursive: true })
  // Canonical, so paths the app sees match the fs scope (no /var vs /private/var mix).
  return fs.realpathSync(dir)
}

export const binaryPath = (rh) => path.join(rh, 'target', 'debug', 'gedit')

// ---------------------------------------------------------------- lock

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/**
 * Serializes syncs and runs: the window takes over the screen, and a sync replaces
 * the binary. Stale locks (dead owner) are taken over.
 */
export async function withLock(rh, what, fn) {
  const lock = path.join(rh, 'lock')
  const waitSecs = Number(process.env.GEDIT_RH_LOCK_WAIT || 1800)
  const deadline = Date.now() + waitSecs * 1000
  let told = false
  for (;;) {
    try {
      fs.mkdirSync(lock)
      fs.writeFileSync(path.join(lock, 'owner'), `${process.pid} ${what}\n`)
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const owner = readOwner(lock)
      if (owner && !alive(owner.pid)) {
        fs.rmSync(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error(`lock ${lock} still held by ${owner?.text ?? '?'}`)
      if (!told) {
        console.error(`waiting for the harness lock (held by ${owner?.text ?? 'unknown'})`)
        told = true
      }
      await sleep(1000)
    }
  }
  const release = () => fs.rmSync(lock, { recursive: true, force: true })
  const onSignal = (sig) => {
    release()
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    return await fn()
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    release()
  }
}

function readOwner(lock) {
  try {
    const text = fs.readFileSync(path.join(lock, 'owner'), 'utf8').trim()
    return { pid: Number(text.split(' ')[0]), text }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- scenarios

/** name -> { file, options } for every scenario in scenarios/*.js. */
export async function loadScenarios() {
  const { scenarios } = await import(pathToFileURL(path.join(RUNTIME_DIR, 'lib/index.js')).href)
  const found = new Map()
  const dir = path.join(RUNTIME_DIR, 'scenarios')
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const before = new Set(scenarios.keys())
    await import(pathToFileURL(path.join(dir, file)).href)
    for (const [name, s] of scenarios) {
      if (!before.has(name)) found.set(name, { file: path.join(dir, file), options: s.options })
    }
  }
  return found
}

/** Scenario names from suite files (one per line, `#` comments) and plain names. */
export function expandSuiteArgs(args) {
  const names = []
  for (const arg of args) {
    if (arg.endsWith('.txt') || fs.existsSync(arg)) {
      for (const line of fs.readFileSync(arg, 'utf8').split('\n')) {
        const name = line.replace(/#.*/, '').trim()
        if (name) names.push(name)
      }
    } else {
      names.push(arg)
    }
  }
  return names
}

// ---------------------------------------------------------------- bundle

let esbuildPromise
function loadEsbuild() {
  // esbuild comes with vite (a direct dev dependency); resolve it from there.
  const require = createRequire(path.join(REPO, 'package.json'))
  const vite = path.dirname(require.resolve('vite/package.json'))
  const entry = createRequire(path.join(vite, 'package.json')).resolve('esbuild')
  esbuildPromise ??= import(pathToFileURL(entry).href)
  return esbuildPromise
}

/** The page script for one run: recorder, helper API, the scenario's file, then start(cfg). */
export async function bundle(scenarioFile, cfg) {
  const esbuild = await loadEsbuild()
  const imp = (p) => JSON.stringify('./' + path.relative(RUNTIME_DIR, p).split(path.sep).join('/'))
  const result = await esbuild.build({
    stdin: {
      contents: [
        `import { start } from ${imp(path.join(RUNTIME_DIR, 'lib/runner.js'))}`,
        `import ${imp(scenarioFile)}`,
        `start(${JSON.stringify(cfg)})`,
      ].join('\n'),
      resolveDir: RUNTIME_DIR,
      sourcefile: 'rh-entry.js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'safari15',
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

// ---------------------------------------------------------------- one run

/** The interpreter runs use for GEDIT_PYTHON unless a scenario says otherwise. */
export function harnessPython() {
  if (process.env.GEDIT_RH_PYTHON) return process.env.GEDIT_RH_PYTHON
  const r = spawnSync('/bin/sh', ['-c', 'command -v python3'], { encoding: 'utf8' })
  const found = r.stdout.trim().split('\n').pop()
  return found && path.isAbsolute(found) ? found : '/usr/bin/python3'
}

function fill(text, vars) {
  return text.replace(/\{(run|home|python|repo)\}/g, (_, k) => vars[k])
}

function appVersion(rh) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rh, 'app', 'package.json'), 'utf8')).version
  } catch {
    return ''
  }
}

function killMatching(pattern) {
  spawnSync('/usr/bin/pkill', ['-f', pattern])
}

/**
 * Runs one scenario and writes out/<name>.json. Options: home, keepHome, env (extra
 * K=V), timeout (seconds).
 */
export async function runScenario(rh, name, known, opts = {}) {
  const t0 = Date.now()
  const entry = known.get(name)
  const outDir = path.join(rh, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  const result = {
    scenario: name,
    pass: false,
    checks: [],
    violations: [],
    errors: [],
    allowedErrors: [],
    warnings: [],
    unexpectedDialogs: [],
    events: [],
    exit: null,
    timedOut: false,
    durationMs: 0,
    log: null,
    notes: [],
  }
  const finish = () => {
    result.durationMs = Date.now() - t0
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(result, null, 2) + '\n')
    return result
  }
  if (!entry) {
    result.notes.push(`unknown scenario ${name}`)
    return finish()
  }
  const bin = binaryPath(rh)
  if (!fs.existsSync(bin)) {
    result.notes.push(`no test build at ${bin}; run tests/runtime/sync.sh first`)
    return finish()
  }
  // The scenario comes from this checkout, the binary from the last sync; say so when
  // they are not the same, because then the run tests someone else's code.
  try {
    const sync = JSON.parse(fs.readFileSync(path.join(rh, 'sync.json'), 'utf8'))
    if (sync.repo !== REPO) {
      const note = `the build in ${rh} was synced from ${sync.repo}, not from ${REPO}`
      result.notes.push(note)
      console.error(`warning: ${note}`)
    }
  } catch {
    result.notes.push('no sync.json; run tests/runtime/sync.sh')
  }

  const o = entry.options
  const runDir = path.join(rh, 'runs', name)
  fs.rmSync(runDir, { recursive: true, force: true })
  fs.mkdirSync(runDir, { recursive: true })
  const run = fs.realpathSync(runDir)
  const home = opts.home ? path.resolve(opts.home) : path.join(run, 'home')
  fs.mkdirSync(home, { recursive: true })
  const python = harnessPython()
  const vars = { run, home, python, repo: REPO }

  for (const [rel, spec] of Object.entries(o.files ?? {})) {
    const file = path.join(run, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const { text, mode } = typeof spec === 'string' ? { text: spec, mode: undefined } : spec
    fs.writeFileSync(file, fill(text, vars))
    if (mode !== undefined) fs.chmodSync(file, mode)
  }

  const timeout = Number(opts.timeout ?? o.timeout ?? 90)
  const cfg = { scenario: name, run, home, python, appVersion: appVersion(rh) }
  const bundlePath = path.join(run, 'bundle.js')
  fs.writeFileSync(bundlePath, await bundle(entry.file, cfg))

  const base =
    o.env === 'finder'
      ? {
          HOME: home,
          USER: process.env.USER ?? '',
          LOGNAME: process.env.LOGNAME ?? process.env.USER ?? '',
          TMPDIR: process.env.TMPDIR ?? '/tmp',
          SHELL: process.env.SHELL ?? '/bin/zsh',
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        }
      : { ...process.env, HOME: home }
  const env = { ...base }
  delete env.GEDIT_PYTHON
  const py = o.python === undefined ? '{python}' : o.python
  if (py !== null) env.GEDIT_PYTHON = fill(py, vars)
  for (const [k, v] of Object.entries(o.vars ?? {})) env[k] = fill(v, vars)
  for (const kv of opts.env ?? []) {
    const i = kv.indexOf('=')
    if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1)
  }
  Object.assign(env, {
    HARNESS_BUNDLE: bundlePath,
    HARNESS_RUN_DIR: run,
    HARNESS_REPO: REPO,
    HARNESS_TIMEOUT: String(timeout + 5),
  })
  result.notes.push(`GEDIT_PYTHON=${env.GEDIT_PYTHON ?? '(unset)'}`)

  const logPath = path.join(run, 'app.log')
  result.log = logPath
  const logFile = fs.openSync(logPath, 'w')
  const records = []
  let buf = ''
  const child = spawn(bin, [], { cwd: o.env === 'finder' ? '/' : run, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => {
    fs.writeSync(logFile, chunk)
    buf += chunk.toString('utf8')
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.startsWith('RH ')) continue
      try {
        records.push(JSON.parse(line.slice(3)))
      } catch {
        records.push({ kind: 'diag', msg: `unparsable: ${line.slice(0, 200)}` })
      }
    }
  })
  child.stderr.on('data', (chunk) => fs.writeSync(logFile, chunk))
  const killer = setTimeout(() => {
    result.timedOut = true
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 3000).unref()
  }, (timeout + 10) * 1000)
  const [code, signal] = await new Promise((resolve) => child.on('close', (c, s) => resolve([c, s])))
  clearTimeout(killer)
  fs.closeSync(logFile)
  // Scripts, shells and background jobs the run started all carry the run folder in their arguments.
  killMatching(run)
  result.exit = { code, signal }

  judge(result, records)
  if (!opts.home && !opts.keepHome) fs.rmSync(home, { recursive: true, force: true })
  return finish()
}

/** Turns the records of one run into checks and the pass/fail verdict. */
function judge(result, records) {
  const allow = [...KNOWN_NOISE]
  let expectExit = null
  let done = false
  let started = false
  for (const r of records) {
    switch (r.kind) {
      case 'start':
        started = true
        break
      case 'check':
        result.checks.push({ name: r.name, pass: r.pass, detail: r.detail })
        break
      case 'csp':
        result.violations.push(r)
        break
      case 'console-error':
        result.errors.push(r.text)
        break
      case 'console-warn':
        result.warnings.push(r.text)
        break
      case 'allow-errors':
        allow.push(new RegExp(r.source, r.flags))
        break
      case 'expect-exit':
        expectExit = r
        break
      case 'unexpected-dialog':
        result.unexpectedDialogs.push({ dialog: r.dialog, args: r.args })
        break
      case 'event':
        result.events.push([r.event, r.id ?? r.label].filter(Boolean).join(' '))
        break
      case 'done':
        done = true
        break
      case 'timeout':
        result.timedOut = true
        break
    }
  }
  const unexpectedErrors = result.errors.filter((e) => !allow.some((re) => re.test(e)))
  result.allowedErrors = result.errors.filter((e) => allow.some((re) => re.test(e)))
  result.errors = unexpectedErrors
  const unexpectedViolations = result.violations.filter((v) => !v.expected)

  const add = (name, pass, detail) => result.checks.push({ name, pass, detail, runner: true })
  if (!started) add('the page bundle started', false, 'no start record (bundle not injected?)')
  if (expectExit) {
    const code = expectExit.code ?? 0
    add(`the app exited with code ${code}`, result.exit.code === code && !done && !result.timedOut, {
      exit: result.exit,
      exitEventSeen: result.events.includes('Exit'),
    })
    for (const f of expectExit.files ?? []) checkFile(add, f)
    for (const e of expectExit.events ?? []) {
      add(`after exit: the app saw the run event ${e}`, result.events.includes(e), result.events)
    }
  } else if (!done) {
    add('the scenario ran to the end', false, { exit: result.exit, timedOut: result.timedOut })
  }
  add('no CSP violations', unexpectedViolations.length === 0, unexpectedViolations)
  add('no unexpected console errors', unexpectedErrors.length === 0, unexpectedErrors)
  add('no unexpected file dialogs', result.unexpectedDialogs.length === 0, result.unexpectedDialogs)
  result.pass = result.checks.every((c) => c.pass) && !result.timedOut
}

function checkFile(add, f) {
  let bytes = null
  try {
    bytes = fs.readFileSync(f.path)
  } catch {
    bytes = null
  }
  if (f.missing) {
    add(`after exit: ${f.path} does not exist`, bytes === null)
    return
  }
  if (bytes === null) {
    add(`after exit: ${f.path} exists`, false)
    return
  }
  if (f.excludes !== undefined) {
    add(`after exit: ${path.basename(f.path)} does not contain ${JSON.stringify(f.excludes)}`, !bytes.toString('utf8').includes(f.excludes))
  }
  if (f.includes !== undefined) {
    add(`after exit: ${path.basename(f.path)} contains ${JSON.stringify(f.includes)}`, bytes.toString('utf8').includes(f.includes), {
      text: bytes.toString('utf8').slice(0, 400),
    })
  }
  if (f.hex !== undefined) {
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    add(`after exit: ${path.basename(f.path)} has the expected bytes`, hex === f.hex, { hex: hex.slice(0, 400) })
  }
}

/** One line per run for the console. */
export function summarize(r) {
  const failed = r.checks.filter((c) => !c.pass).map((c) => c.name)
  return `${r.pass ? 'PASS' : 'FAIL'} ${r.scenario} (${(r.durationMs / 1000).toFixed(1)} s, ${r.checks.filter((c) => c.pass).length}/${r.checks.length} checks)${failed.length ? '\n  failed: ' + failed.join('\n  failed: ') : ''}${r.notes.length && !r.pass ? '\n  notes: ' + r.notes.join('; ') : ''}`
}
