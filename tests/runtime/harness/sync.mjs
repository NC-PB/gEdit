// sync.sh: copies the repo to $GEDIT_RH_DIR/app, patches the harness in and builds the
// test variant. The repo itself is never modified.
// Usage: sync.sh [--repo DIR]

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO, RUNTIME_DIR, binaryPath, rhDir, withLock } from './core.mjs'

const args = process.argv.slice(2)
let repo = REPO
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo') repo = path.resolve(args[++i])
  else {
    console.error('usage: tests/runtime/sync.sh [--repo DIR]')
    process.exit(2)
  }
}

const rh = rhDir()
const app = path.join(rh, 'app')
const logs = path.join(rh, 'logs')
const HARNESS_RS = path.join(RUNTIME_DIR, 'harness/harness.rs')

// The only two anchors in lib.rs (plan AD-15); each must occur exactly once.
const BUILDER = 'tauri::Builder::default()'
const HANDLER = 'generate_handler!['

function fail(msg) {
  console.error(`sync: ${msg}`)
  process.exit(1)
}

function step(label, cmd, argv, opts) {
  const t = Date.now()
  const log = path.join(logs, `sync-${label}.log`)
  const r = spawnSync(cmd, argv, { ...opts, encoding: 'utf8', maxBuffer: 1 << 28 })
  fs.writeFileSync(log, `$ ${cmd} ${argv.join(' ')}\n${r.stdout ?? ''}${r.stderr ?? ''}`)
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n')
    fail(`${label} failed (see ${log}):\n${tail || r.error}`)
  }
  console.log(`${label}: ok (${((Date.now() - t) / 1000).toFixed(1)} s)`)
}

/** Writes only when the content changes, so unchanged files keep their mtime (no rebuild). */
function writeIfChanged(file, text) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false
  fs.writeFileSync(file, text)
  return true
}

function once(src, anchor) {
  const n = src.split(anchor).length - 1
  if (n !== 1) fail(`lib.rs must contain ${JSON.stringify(anchor)} exactly once (found ${n})`)
}

/** The h_* command names declared in harness.rs. */
function harnessCommands(rs) {
  const names = [...rs.matchAll(/#\[tauri::command[^\]]*\]\s*pub\s+(?:async\s+)?fn\s+(h_\w+)/g)].map((m) => m[1])
  if (!names.length) fail('no h_* commands found in harness.rs')
  return names
}

function patchLibRs(src, commands) {
  once(src, BUILDER)
  once(src, HANDLER)
  let out = src.replace(BUILDER, `${BUILDER}\n        .plugin(harness::plugin())`)
  out = out.replace(HANDLER, `${HANDLER}\n${commands.map((c) => `            harness::${c},`).join('\n')}`)
  // `mod` goes after any inner attributes and module docs at the top.
  const lines = out.split('\n')
  let i = 0
  while (i < lines.length && /^(\/\/!|#!\[)/.test(lines[i])) i++
  lines.splice(i, 0, 'mod harness; // runtime harness (tests/runtime/sync.sh); test builds only')
  return lines.join('\n')
}

function patchCargoToml(src) {
  if (/^\s*objc2\s*=/m.test(src)) return src
  const header = `[target.'cfg(target_os = "macos")'.dependencies]`
  if (src.includes(header)) return src.replace(header, `${header}\nobjc2 = "0.6"`)
  return `${src.trimEnd()}\n\n${header}\nobjc2 = "0.6"\n`
}

function patchTauriConf(src) {
  const cfg = JSON.parse(src)
  for (const w of cfg.app?.windows ?? []) w.visible = false
  return JSON.stringify(cfg, null, 2) + '\n'
}

await withLock(rh, 'sync', async () => {
  const t0 = Date.now()
  fs.mkdirSync(app, { recursive: true })
  fs.mkdirSync(logs, { recursive: true })
  if (!fs.existsSync(path.join(repo, 'src-tauri/src/lib.rs'))) fail(`${repo} is not a gEdit checkout`)
  if (!fs.existsSync(path.join(repo, 'node_modules'))) fail(`${repo}/node_modules is missing; run npm install`)

  // Patched files are excluded here and written below only when they change.
  step('copy', 'rsync', [
    '-a',
    '--delete',
    ...[
      '/node_modules',
      '/.git',
      '/build',
      '/.svelte-kit',
      '/.perf',
      '/src-tauri/target',
      '/src-tauri/gen',
      '/src-tauri/src/lib.rs',
      '/src-tauri/src/harness.rs',
      '/src-tauri/Cargo.toml',
      '/src-tauri/tauri.conf.json',
    ].map((p) => `--exclude=${p}`),
    `${repo}/`,
    `${app}/`,
  ])

  const nm = path.join(app, 'node_modules')
  const target = path.join(repo, 'node_modules')
  let link = null
  try {
    link = fs.readlinkSync(nm)
  } catch {
    link = null
  }
  if (link !== target) {
    fs.rmSync(nm, { recursive: true, force: true })
    fs.symlinkSync(target, nm)
  }

  const rs = fs.readFileSync(HARNESS_RS, 'utf8')
  const commands = harnessCommands(rs)
  const tauriDir = path.join(app, 'src-tauri')
  const changed = [
    writeIfChanged(path.join(tauriDir, 'src/harness.rs'), rs),
    writeIfChanged(path.join(tauriDir, 'src/lib.rs'), patchLibRs(fs.readFileSync(path.join(repo, 'src-tauri/src/lib.rs'), 'utf8'), commands)),
    writeIfChanged(path.join(tauriDir, 'Cargo.toml'), patchCargoToml(fs.readFileSync(path.join(repo, 'src-tauri/Cargo.toml'), 'utf8'))),
    writeIfChanged(path.join(tauriDir, 'tauri.conf.json'), patchTauriConf(fs.readFileSync(path.join(repo, 'src-tauri/tauri.conf.json'), 'utf8'))),
  ]
  console.log(`patch: ${commands.length} h_* commands; ${changed.filter(Boolean).length} patched file(s) changed`)

  step('npm-build', 'npm', ['run', 'build'], { cwd: app, env: { ...process.env, VITE_GEDIT_TEST: '1' } })
  const hook = spawnSync('grep', ['-rlq', '__gedit', path.join(app, 'build/_app')])
  if (hook.status !== 0) fail('the test build does not contain window.__gedit (VITE_GEDIT_TEST not applied?)')

  step('cargo-build', 'cargo', ['build', '--features', 'tauri/custom-protocol'], {
    cwd: tauriDir,
    env: { ...process.env, CARGO_TARGET_DIR: path.join(rh, 'target') },
  })
  if (!fs.existsSync(binaryPath(rh))) fail(`no binary at ${binaryPath(rh)}`)

  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).stdout?.trim() ?? ''
  fs.writeFileSync(
    path.join(rh, 'sync.json'),
    JSON.stringify(
      { repo, head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '', syncedAt: new Date().toISOString(), binary: binaryPath(rh) },
      null,
      2,
    ) + '\n',
  )
  console.log(`synced ${repo} -> ${app} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  console.log(`binary: ${binaryPath(rh)}`)
})
