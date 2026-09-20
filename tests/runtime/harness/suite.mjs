// suite.sh: runs suite files and/or scenario names one after another under one lock,
// prints a PASS / FLAKY / FAIL / BLOCKED table and exits nonzero when anything failed or
// was blocked.
//
// A scenario that fails is run once more, because the harness drives a real desktop and
// a single run is not proof: a second failure is the app's, a pass on the retry is the
// harness's and is reported as FLAKY with the first failure kept. A run that could not
// take the keyboard (screen locked, another app frontmost) is BLOCKED - retrying it
// would prove nothing, so it is not retried and it never passes silently.
//
// Usage: suite.sh <suite.txt | scenario>… [--no-retry] [--repeat N]

import fs from 'node:fs'
import path from 'node:path'
import { expandSuiteArgs, focusStats, loadScenarios, rhDir, robustEnabled, runScenario, screenLocked, summarize, withLock } from './core.mjs'

const argv = process.argv.slice(2)
const args = []
let retry = robustEnabled()
let repeat = 1
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--no-retry') retry = false
  else if (a === '--retry') retry = true
  else if (a === '--repeat') repeat = Number(argv[++i])
  else args.push(a)
}
if (!args.length || !Number.isInteger(repeat) || repeat < 1) {
  console.error('usage: tests/runtime/suite.sh <suite.txt | scenario>… [--no-retry] [--repeat N]')
  process.exit(2)
}
const names = expandSuiteArgs(args)
const rh = rhDir()
const known = await loadScenarios()
const unknown = names.filter((n) => !known.has(n))
if (unknown.length) {
  console.error(`unknown scenarios: ${unknown.join(', ')}`)
  process.exit(2)
}

/** Keeps the first attempt's result file so a FLAKY row can still be read afterwards. */
function keepFirstAttempt(name) {
  const from = path.join(rh, 'out', `${name}.json`)
  const to = path.join(rh, 'out', `${name}.attempt1.json`)
  try {
    fs.copyFileSync(from, to)
    return to
  } catch {
    return null
  }
}

/**
 * What has to be re-run to retry `name`. A numbered scenario (`…-2`) reads the HOME that
 * its predecessors wrote, so retrying it alone would test a home that has already been
 * through one run; the whole `…-1 … -n` group is re-run in order instead.
 * @returns {string[]}
 */
function retryGroup(name, all) {
  const m = /^(.+)-(\d+)$/.exec(name)
  if (!m) return [name]
  const n = Number(m[2])
  const group = []
  for (let i = 1; i <= n; i++) {
    const member = `${m[1]}-${i}`
    if (!all.includes(member)) return [name]
    group.push(member)
  }
  return group
}

/**
 * Runs one scenario, once more if it failed.
 * @param {string} name
 * @param {Set<string>} blockedSoFar scenarios this round could not be carried out
 * @returns {{ status: string, result: any, first: any | null }}
 */
async function runOnce(name, blockedSoFar) {
  const first = await runScenario(rh, name, known)
  console.log(summarize(first))
  // `…-2` reads the HOME `…-1` wrote. When `…-1` was blocked that HOME was never
  // written, so what `…-2` reports is the block, not the app.
  if (first.status === 'fail') {
    const blocker = retryGroup(name, names).find((m) => m !== name && blockedSoFar.has(m))
    if (blocker) {
      first.status = 'blocked'
      first.blocked.push({ reason: `${blocker}, which writes its HOME, was blocked`, where: 'suite' })
      // runScenario wrote the file before this was known; keep the two in step.
      fs.writeFileSync(path.join(rh, 'out', `${name}.json`), JSON.stringify(first, null, 2) + '\n')
      console.log(`  (blocked, not failed: ${blocker} never ran)`)
    }
  }
  if (first.status === 'pass' || first.status === 'blocked' || !retry) {
    return { status: first.status.toUpperCase(), result: first, first: null }
  }
  const kept = keepFirstAttempt(name)
  const group = retryGroup(name, names)
  const also = group.length > 1 ? ` with ${group.slice(0, -1).join(', ')}, which write its HOME` : ''
  console.log(`--- ${name} (retry${also}; the first failure is in ${kept ?? 'out/'})`)
  let second = first
  for (const member of group) {
    second = await runScenario(rh, member, known, { attempt: 2 })
    if (member !== name) console.log(summarize(second))
  }
  console.log(summarize(second))
  if (second.status === 'pass') return { status: 'FLAKY', result: second, first }
  return { status: second.status.toUpperCase(), result: second, first }
}

const rounds = []
await withLock(rh, `suite ${args.join(' ')}`, async () => {
  for (let round = 1; round <= repeat; round++) {
    if (repeat > 1) console.log(`\n===== round ${round}/${repeat} =====`)
    const runs = []
    const blockedSoFar = new Set()
    for (const name of names) {
      console.log(`--- ${name}`)
      const run = await runOnce(name, blockedSoFar)
      if (run.status === 'BLOCKED') blockedSoFar.add(name)
      runs.push(run)
    }
    rounds.push(runs)
  }
})

// ---------------------------------------------------------------- the table

const ORDER = { FAIL: 0, BLOCKED: 1, FLAKY: 2, PASS: 3 }
let exitCode = 0

for (const [i, runs] of rounds.entries()) {
  const rows = runs.map(({ status, result: r, first }) => [
    r.scenario,
    status,
    `${r.checks.filter((c) => c.pass).length}/${r.checks.length}`,
    String(r.violations.filter((v) => !v.expected).length),
    String(r.errors.length),
    String(focusStats(r).lost + (first ? focusStats(first).lost : 0)),
    `${((r.durationMs + (first?.durationMs ?? 0)) / 1000).toFixed(1)} s`,
  ])
  const head = ['Scenario', 'Result', 'Checks', 'CSP', 'Errors', 'Focus', 'Time']
  const widths = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)))
  const line = (cells) => cells.map((c, j) => c.padEnd(widths[j])).join('  ')
  console.log(`\n${rounds.length > 1 ? `round ${i + 1}: ` : ''}${line(head)}`)
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const r of rows) console.log(line(r))

  const count = (s) => runs.filter((r) => r.status === s).length
  const [pass, flaky, fail, blocked] = [count('PASS'), count('FLAKY'), count('FAIL'), count('BLOCKED')]
  console.log(`\n${pass} passed, ${flaky} flaky (passed on the retry), ${fail} failed, ${blocked} blocked`)
  if (fail || blocked) exitCode = 1
  const worst = runs.map((r) => r.status).sort((a, b) => ORDER[a] - ORDER[b])[0]
  if (rounds.length > 1) console.log(`round ${i + 1}: worst result ${worst}`)
}

if (rounds.length > 1) {
  const flaky = rounds.flat().filter((r) => r.status === 'FLAKY')
  const byName = new Map()
  for (const r of flaky) byName.set(r.result.scenario, (byName.get(r.result.scenario) ?? 0) + 1)
  const total = rounds.flat().length
  console.log(`\nover ${rounds.length} rounds: ${flaky.length}/${total} runs were flaky` + (byName.size ? ` (${[...byName].map(([n, c]) => `${n} ×${c}`).join(', ')})` : ''))
}

const summary = {
  args,
  robust: robustEnabled(),
  retry,
  repeat,
  screenLocked: screenLocked(),
  rounds: rounds.map((runs) => ({
    counts: {
      pass: runs.filter((r) => r.status === 'PASS').length,
      flaky: runs.filter((r) => r.status === 'FLAKY').length,
      fail: runs.filter((r) => r.status === 'FAIL').length,
      blocked: runs.filter((r) => r.status === 'BLOCKED').length,
    },
    results: runs.map(({ status, result: r, first }) => ({
      scenario: r.scenario,
      status,
      attempts: first ? 2 : 1,
      durationMs: r.durationMs + (first?.durationMs ?? 0),
      focus: focusStats(r),
      blocked: r.blocked,
      failedChecks: r.checks.filter((c) => !c.pass).map((c) => c.name),
      firstAttempt: first
        ? { status: first.status, failedChecks: first.checks.filter((c) => !c.pass).map((c) => c.name), focus: focusStats(first), result: `out/${r.scenario}.attempt1.json` }
        : null,
    })),
  })),
}
fs.mkdirSync(path.join(rh, 'out'), { recursive: true })
fs.writeFileSync(path.join(rh, 'out', 'suite.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(`\nsummary: ${path.join(rh, 'out', 'suite.json')}`)
process.exit(exitCode)
