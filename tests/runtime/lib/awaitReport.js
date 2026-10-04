// How a scenario waits for the report of a script it started from the Tools tab, as a
// function of a small set of probes so a unit test can drive it with a fake clock. The
// harness's `runFromTools` (scenarios/m10-common.js) is this plus the real probes.
//
// A script with a form shows it within a moment; a script without one shows nothing until
// it is done, which on a 300,000-line program is a minute or more. So there is **one**
// wait for "the form or the report", for the whole timeout: a short wait for the form would
// tell "no form" from "slow" by guessing, and the first version of the M10 perf scenario
// guessed 20 s and threw on a script that was simply still running.
//
// This module has no imports: the harness bundles it, Node reads it.

/**
 * @typedef {object} Probes
 * @property {<T>(fn: () => T, options: { timeout: number, interval?: number }) => Promise<T | undefined>} waitFor
 * @property {() => number} now ms, any origin
 * @property {() => boolean} formOpen whether a form is on screen
 * @property {() => unknown} arrived the report that came after the click, or a falsy value
 * @property {() => Promise<number>} answerForm fills the form and clicks OK; the time of the click
 */

/**
 * @param {Probes} io
 * @param {number} timeout ms to wait for the report, counted from the click or, with a form, from OK
 * @returns {Promise<{ form: boolean, report: unknown, ms: number, how: 'form' | 'report' | 'nothing' }>}
 *   `report` is falsy (and `how` is `nothing` or `form`) when it did not come in time
 */
export async function awaitReport(io, timeout) {
  let started = io.now()
  const first = await io.waitFor(() => (io.formOpen() ? 'form' : io.arrived() ? 'report' : null), { timeout, interval: 25 })
  if (first === 'report') return { form: false, report: io.arrived(), ms: Math.round(io.now() - started), how: 'report' }
  if (first !== 'form') return { form: false, report: null, ms: Math.round(io.now() - started), how: 'nothing' }
  started = await io.answerForm()
  const report = await io.waitFor(() => io.arrived(), { timeout, interval: 25 })
  return { form: true, report: report || null, ms: Math.round(io.now() - started), how: 'form' }
}
