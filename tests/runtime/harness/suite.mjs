// suite.sh: runs suite files and/or scenario names one after another under one lock,
// prints a PASS/FAIL table and exits nonzero when anything failed.
// Usage: suite.sh <suite.txt | scenario>…

import fs from 'node:fs'
import path from 'node:path'
import { expandSuiteArgs, loadScenarios, rhDir, runScenario, summarize, withLock } from './core.mjs'

const args = process.argv.slice(2)
if (!args.length) {
  console.error('usage: tests/runtime/suite.sh <suite.txt | scenario>…')
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

const results = await withLock(rh, `suite ${args.join(' ')}`, async () => {
  const out = []
  for (const name of names) {
    console.log(`--- ${name}`)
    const r = await runScenario(rh, name, known)
    console.log(summarize(r))
    out.push(r)
  }
  return out
})

const rows = results.map((r) => [
  r.scenario,
  r.pass ? 'PASS' : 'FAIL',
  `${r.checks.filter((c) => c.pass).length}/${r.checks.length}`,
  String(r.violations.filter((v) => !v.expected).length),
  String(r.errors.length),
  `${(r.durationMs / 1000).toFixed(1)} s`,
])
const head = ['Scenario', 'Result', 'Checks', 'CSP', 'Errors', 'Time']
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
console.log('\n' + line(head))
console.log(widths.map((w) => '-'.repeat(w)).join('  '))
for (const r of rows) console.log(line(r))
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
fs.writeFileSync(
  path.join(rh, 'out', 'suite.json'),
  JSON.stringify({ args, results: results.map((r) => ({ scenario: r.scenario, pass: r.pass, durationMs: r.durationMs })) }, null, 2) + '\n',
)
process.exit(failed ? 1 : 0)
