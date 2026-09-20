// Page side of a run: installs the recorder at document start, waits for the app,
// runs the selected scenario and reports everything to the node runner (run.sh)
// through harness.rs, which prints it as `RH <json>` lines.

import { createHarness, invoke, sleep } from './api.js'
import { scenarios } from './index.js'
import { describe, installRecorder } from './recorder.js'

/** @typedef {import('./api.js').RunConfig} RunConfig */

const MAX_DETAIL = 20000

/** JSON that survives cycles, DOM nodes, errors and huge values. @param {unknown} value */
function toJson(value) {
  const seen = new WeakSet()
  return JSON.stringify(value, (_key, v) => {
    if (v instanceof Error) return { error: `${v.name}: ${v.message}`, stack: v.stack }
    if (typeof Element !== 'undefined' && v instanceof Element) {
      return `<${v.tagName.toLowerCase()} ${[...v.attributes].map((a) => `${a.name}="${a.value}"`).join(' ')}>`
    }
    if (typeof v === 'string' && v.length > MAX_DETAIL) return v.slice(0, MAX_DETAIL) + '…'
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[cycle]'
      seen.add(v)
    }
    return v
  })
}

/** Sends records to harness.rs; queues them until Tauri's IPC is available. */
function createSender() {
  /** @type {string[]} */
  const queue = []
  let flushing = false
  const ipcReady = () => !!(/** @type {any} */ (window).__TAURI_INTERNALS__?.invoke)
  async function flush() {
    if (flushing || !ipcReady()) return
    flushing = true
    try {
      while (queue.length) {
        const msg = /** @type {string} */ (queue.shift())
        try {
          await invoke('h_report', { msg })
        } catch {
          // Nothing to report to; never log here (the recorder would forward it again).
        }
      }
    } finally {
      flushing = false
    }
  }
  /** @param {Record<string, unknown>} record */
  const send = (record) => {
    let msg
    try {
      msg = toJson(record)
    } catch (e) {
      msg = JSON.stringify({ kind: 'log', msg: `unserializable record: ${describe(e)}` })
    }
    queue.push(msg)
    void flush()
  }
  return {
    send,
    /** Resolves once everything queued so far has been handed to Rust. */
    async drain() {
      for (let i = 0; i < 100 && (queue.length || flushing); i++) {
        void flush()
        await sleep(20)
      }
    },
  }
}

/**
 * Called by the generated bundle at document start.
 * @param {RunConfig} cfg
 */
export function start(cfg) {
  const { send, drain } = createSender()
  const rec = installRecorder(send)
  if (!rec) return
  send({ kind: 'start', scenario: cfg.scenario, url: location.href })

  const run = async () => {
    const entry = scenarios.get(cfg.scenario)
    const h = createHarness(cfg, rec, send)
    if (!entry) {
      h.check(`scenario ${cfg.scenario} exists in the bundle`, false)
    } else {
      try {
        await waitForApp(h)
        await entry.fn(h)
      } catch (e) {
        const err = /** @type {any} */ (e)
        h.check('scenario finished without an exception', false, {
          error: describe(e),
          stack: typeof err?.stack === 'string' ? err.stack : undefined,
        })
      }
      await endOfRunChecks(h)
    }
    const exit = h.exitExpectation()
    if (exit) {
      // The app should be on its way out; if it is still here, say so and end the run.
      await sleep(exit.within ?? 10000)
      h.check('the app exited as expected', false, { stillRunningAfterMs: exit.within })
    }
    send({ kind: 'done' })
    await drain()
    await invoke('h_done', { code: 0 })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void run())
  else void run()
}

/**
 * Waits until the test hook is ready and Monaco has drawn the first document.
 * @param {import('./api.js').Harness} h
 */
async function waitForApp(h) {
  const t0 = performance.now()
  const app = await h.waitFor(() => window.__gedit, { timeout: 30000 })
  if (!app) throw new Error('window.__gedit did not appear within 30 s (not a VITE_GEDIT_TEST=1 build?)')
  const ready = await Promise.race([app.ready.then(() => true), sleep(30000).then(() => false)])
  if (!ready) throw new Error('window.__gedit.ready did not resolve within 30 s')
  // Generous, because the first paint is the part of startup a loaded Mac slows down
  // most, and waiting longer costs nothing when it is already there.
  const shell = await h.waitFor(() => h.q('app-shell', { ready: '1' }), { timeout: 20000 })
  const painted = await h.waitFor(() => h.q('editor-host')?.querySelector('.view-line'), { timeout: 20000 })
  if (!shell || !painted) throw new Error('app-shell is not ready or the editor did not paint')
  h.log(`app ready after ${Math.round(performance.now() - t0)} ms (document ${document.visibilityState})`)
  // Say who owns the keyboard at the start of every run, whether or not this scenario
  // posts native input: it is the first thing to look at when one of them misbehaves.
  const focus = await h.window.focus().catch(() => null)
  if (focus) h.log(`focus at start: ${focus.deliverable ? 'ours' : `not ours - ${focus.reason}`} (${focus.frontApp}, key ${focus.keyWindow || 'none'})`)
}

/**
 * Checks every scenario gets for free.
 * @param {import('./api.js').Harness} h
 */
async function endOfRunChecks(h) {
  if (h.exitExpectation()) return
  const left = await h.dialogs.clear().catch(() => [])
  h.check('every queued file-dialog answer was used', left.length === 0, { unused: left })
  const alert = await h.alert.visible().catch(() => null)
  h.check('no alert is left open', !alert, alert)
}
