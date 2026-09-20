// run.sh: runs one scenario against the synced test build.
// Usage: run.sh <scenario> [--home DIR] [--keep-home] [--env K=V]… [--timeout S]

import { loadScenarios, rhDir, runScenario, summarize, withLock } from './core.mjs'

const args = process.argv.slice(2)
const opts = { env: [] }
let name = null
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--home') opts.home = args[++i]
  else if (a === '--keep-home') opts.keepHome = true
  else if (a === '--env') opts.env.push(args[++i])
  else if (a === '--timeout') opts.timeout = Number(args[++i])
  else if (a === '-h' || a === '--help') name = null
  else if (!a.startsWith('-') && !name) name = a
  else {
    console.error(`unknown argument ${a}`)
    process.exit(2)
  }
}
if (!name) {
  console.error('usage: tests/runtime/run.sh <scenario> [--home DIR] [--keep-home] [--env K=V]… [--timeout S]')
  process.exit(2)
}

const rh = rhDir()
const known = await loadScenarios()
if (!known.has(name)) {
  console.error(`unknown scenario ${name}; known: ${[...known.keys()].join(', ')}`)
  process.exit(2)
}
const result = await withLock(rh, `run ${name}`, () => runScenario(rh, name, known, opts))
console.log(summarize(result))
console.log(`result: ${rh}/out/${name}.json`)
// One run is one run: it is never retried here, so a failure stays a failure. A run that
// could not take the keyboard is BLOCKED, and exits nonzero as well - nothing was proven.
process.exit(result.status === 'pass' ? 0 : 1)
