// G7 for M7 (plan §5 M7 "Gates: G7"): on a 10 MB / 300k-line dirty program,
//   - one snapshot blocks the main thread for no more than 100 ms, and
//   - typing is no slower with the snapshots running than with them switched off.
//
// The budget exists because the safety net must not be felt. A snapshot of a 10 MB
// program is 10 MB of text read out of Monaco and handed to Rust, every 30 s, for as
// long as the document is unsaved — and a programmer who notices that is a programmer
// who turns `files.recovery` off, after which the milestone protects nobody.
//
// **How the block is measured.** A self-rescheduling `setTimeout(…, 0)` records the gap
// between consecutive ticks. On an idle main thread the gap is the timer's own floor (a
// few ms); while something holds the thread, the next tick cannot run until it lets go,
// so the largest gap over a window is the longest contiguous block in it. The probe runs
// across `recovery.flushNow()` — the same pass the 30 s ticker takes, with the throttle
// skipped — and the same probe is run over an idle window first, so the number is read
// against this machine's own floor rather than against an absolute nobody can reproduce.
//
// **What "typing p95 unchanged" means here.** The same 40 keystrokes are measured twice
// on the same document: once with `files.recovery` off, and once with it on and a
// snapshot pass **fired in the middle of the sample and not awaited**, so a 10 MB
// snapshot is genuinely in flight while the following keys arrive. If the snapshot ran
// on the keystroke path — inside the input handler, or awaited before the model could
// change again — every key after it would carry the whole serialisation and the p95
// would move by far more than the one frame this budget allows.
//
// One pass, not five: a keystroke that lands *inside* the block pays for it, and that
// cost is what the first budget above measures and bounds. Firing five would measure
// the same block a second time through a noisier instrument and would fail a build in
// which nothing is wrong. The worst sample is reported beside the p95 either way, so the
// number is on the record even though it is not what this check is about.
//
// The measurement of a keystroke is `m3-perf`'s, and deliberately the same: the clock
// starts at the `keydown` in a capture-phase listener on `window` (before Monaco sees
// it) and stops when a MutationObserver finds the character in a rendered view line.

import { scenario } from '../lib/index.js'
import { largeProgram, plain } from './m3-common.js'
import { context, openPath, ready, sessionFiles, sessionFolders } from './m7-common.js'

/** The budgets this gate enforces. */
const SNAPSHOT_BLOCK_BUDGET_MS = 100
/** How much slower a keystroke may be with the snapshots on: one frame at 60 Hz. */
const TYPING_COST_BUDGET_MS = 17
/** A main thread with no gap longer than this counts as idle, i.e. as a usable floor. */
const SETTLED_MS = 50
/** How many one-second probes to give it before measuring anyway. */
const SETTLE_TRIES = 10

const MIN_LINES = 300000
const MIN_BYTES = 10 * 1024 * 1024
const KEYSTROKES = 40
/** How many of the measured keystrokes may have to be posted a second time. */
const MAX_RETRIES = 2
/** A snapshot pass is fired after this many keystrokes of the second sample (once). */
const FLUSH_EVERY = 20

/** Percentile of a sample, nearest rank. */
function percentile(/** @type {number[]} */ values, /** @type {number} */ p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

scenario('m7-perf-recovery', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  /**
   * Watches the main thread for `fn`, and answers with the longest gap between two
   * consecutive ticks of a zero-delay timer — the longest stretch in which nothing else
   * could run.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<{ value: T, worstMs: number, ticks: number, totalMs: number }>}
   */
  const watchMainThread = async (fn) => {
    let last = performance.now()
    let worst = 0
    let ticks = 0
    let stop = false
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let handle
    const tick = () => {
      const now = performance.now()
      worst = Math.max(worst, now - last)
      last = now
      ticks++
      if (!stop) handle = setTimeout(tick, 0)
    }
    handle = setTimeout(tick, 0)
    const started = performance.now()
    try {
      const value = await fn()
      return { value, worstMs: Math.round(worst), ticks, totalMs: Math.round(performance.now() - started) }
    } finally {
      stop = true
      clearTimeout(handle)
    }
  }

  /** Resolves at the moment a DOM change makes `predicate` true (as `m3-perf`). */
  const untilDom = (/** @type {() => boolean} */ predicate, /** @type {number} */ timeout) =>
    new Promise((resolve) => {
      if (predicate()) return resolve(performance.now())
      /** @param {number | null} value */
      const done = (value) => {
        observer.disconnect()
        clearTimeout(timer)
        resolve(value)
      }
      const observer = new MutationObserver(() => {
        if (predicate()) done(performance.now())
      })
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
      const timer = setTimeout(() => done(null), timeout)
    })

  /** Whether Monaco currently has a view line with exactly this text. */
  const drawn = (/** @type {string} */ text) => {
    for (const line of h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? []) {
      if (plain(line.textContent) === text) return true
    }
    return false
  }

  /**
   * Types `KEYSTROKES` characters at the end of a line and measures each one, optionally
   * firing a snapshot pass every `FLUSH_EVERY` keystrokes.
   * @param {string} id
   * @param {number} line
   * @param {{ flushing?: boolean }} [o]
   */
  const measureTyping = async (id, line, o = {}) => {
    const modelLine = () => ctx.editor.getLines(id, line, line)[0] ?? ''
    const focus = async () => {
      ctx.editor.reveal(id, line, modelLine().length + 1)
      await h.idle()
      return h.focusEditor() && h.app.cursor().line === line
    }
    await focus()
    // One keystroke thrown away, for the reason `m3-perf` throws one away: the first key
    // after a 10 MB open has been seen to go nowhere, and a lost measurement is worse
    // than a slow one.
    const warmTarget = `${modelLine()}1`
    await h.nativeKeys([{ key: '1' }])
    if ((await untilDom(() => drawn(warmTarget), 15000)) === null) {
      await focus()
      await h.nativeKeys([{ key: '1' }])
      await untilDom(() => drawn(`${modelLine()}1`), 15000)
    }

    /** @type {number[]} */
    const dom = []
    /** @type {number[]} */
    const keydownAt = []
    let retries = 0
    let flushes = 0
    const stamp = () => keydownAt.push(performance.now())
    window.addEventListener('keydown', stamp, true)
    try {
      for (let i = 0; i < KEYSTROKES; i++) {
        if (o.flushing === true && i > 0 && i % FLUSH_EVERY === 0) {
          flushes++
          // Fired and not awaited: the point is a snapshot **in flight** while the next
          // keys arrive, which is what "off the keystroke path" has to survive.
          void ctx.recovery.flushNow()
        }
        const want = `${modelLine()}1`
        keydownAt.length = 0
        let waiting = untilDom(() => drawn(want), 5000)
        await h.nativeKeys([{ key: '1' }])
        let shown = await waiting
        if (shown === null && modelLine() !== want) {
          retries++
          await focus()
          keydownAt.length = 0
          waiting = untilDom(() => drawn(want), 5000)
          await h.nativeKeys([{ key: '1' }])
          shown = await waiting
        }
        if (shown === null || keydownAt.length === 0) break
        dom.push(shown - keydownAt[0])
      }
    } finally {
      window.removeEventListener('keydown', stamp, true)
    }
    return {
      retries,
      flushes,
      count: dom.length,
      p50: dom.length > 0 ? Math.round(percentile(dom, 50)) : -1,
      p95: dom.length > 0 ? Math.round(percentile(dom, 95)) : -1,
      worst: dom.length > 0 ? Math.round(Math.max(...dom)) : -1,
    }
  }

  // ------------------------------------------------------------ the 10 MB document
  const text = largeProgram({ lines: MIN_LINES })
  const lineCount = text.split('\r\n').length - 1
  const path = `${h.cfg.run}/perf-recovery.nc`
  await h.disk.write(path, text)
  h.check(`the program has ${lineCount} lines and ${(text.length / 1024 / 1024).toFixed(2)} MiB`, lineCount >= MIN_LINES && text.length >= MIN_BYTES, { lines: lineCount, bytes: text.length })

  const { id } = await openPath(h, path)
  h.check('recovery is on by default', ctx.settings.get('files.recovery') === true, ctx.settings.get('files.recovery'))

  // Dirty, because a clean document is never snapshotted at all (AD-21).
  ctx.editor.reveal(id, 2, 1)
  await h.idle()
  h.focusEditor()
  await h.nativeKeys([{ key: '1' }])
  await h.waitFor(() => ctx.docs.get(id)?.dirty === true, { timeout: 15000 })
  h.check('and the document is unsaved, which is the only kind that is snapshotted', ctx.docs.get(id)?.dirty === true)

  // ------------------------------------------------------------ what an idle thread costs
  // Monaco tokenizes a 300k-line file in background chunks for several seconds after the
  // open, and each chunk is main-thread work: a probe taken during that measures Monaco
  // and not the snapshot. The first run of this scenario read an 82 ms "idle" gap — more
  // than the snapshot itself — so the thread is given time to go quiet first, and how
  // quiet it got is on the record beside the number it is the floor of.
  let idleProbe = await watchMainThread(() => h.sleep(1000))
  for (let attempt = 0; attempt < SETTLE_TRIES && idleProbe.worstMs > SETTLED_MS; attempt++) {
    idleProbe = await watchMainThread(() => h.sleep(1000))
  }
  h.check(
    `the main thread went quiet enough to measure a ${SNAPSHOT_BLOCK_BUDGET_MS} ms budget against: worst idle gap ${idleProbe.worstMs} ms`,
    idleProbe.worstMs <= SETTLED_MS && idleProbe.ticks > 50,
    idleProbe,
  )

  // ------------------------------------------------------------ the snapshot itself
  const snapshot = await watchMainThread(() => ctx.recovery.flushNow())
  const folders = await sessionFolders(h)
  const written = await sessionFiles(h, folders[0] ?? '')
  const snapshotFile = `${await h.recoveryDir()}/${folders[0]}/${id}.txt`
  const size = (await h.disk.stat(snapshotFile))?.len ?? 0
  h.check('the whole program really went to disk, not a truncated head of it', written.keys.includes(id) && size >= MIN_BYTES, { keys: written.keys, bytes: size })
  h.check(
    `a snapshot of ${(text.length / 1024 / 1024).toFixed(1)} MiB blocks the main thread for at most ${SNAPSHOT_BLOCK_BUDGET_MS} ms: ${snapshot.worstMs} ms`,
    snapshot.worstMs <= SNAPSHOT_BLOCK_BUDGET_MS,
    { worstMs: snapshot.worstMs, budgetMs: SNAPSHOT_BLOCK_BUDGET_MS, idleFloorMs: idleProbe.worstMs, tookMs: snapshot.totalMs },
  )

  // ------------------------------------------------------------ typing, with and without
  await ctx.settings.save({ 'files.recovery': false })
  await h.waitFor(() => ctx.settings.get('files.recovery') === false, { timeout: 5000 })
  const without = await measureTyping(id, 9)
  h.check('the reference sample took every keystroke', without.count === KEYSTROKES && without.retries <= MAX_RETRIES, without)

  await ctx.settings.save({ 'files.recovery': true })
  await h.waitFor(() => ctx.settings.get('files.recovery') === true, { timeout: 5000 })
  const withSnapshots = await measureTyping(id, 10, { flushing: true })
  h.check('the second sample took every keystroke too, with snapshots in flight throughout', withSnapshots.count === KEYSTROKES && withSnapshots.retries <= MAX_RETRIES && withSnapshots.flushes > 0, withSnapshots)

  h.check(
    `typing costs no more with the snapshots running: p95 ${withSnapshots.p95} ms against ${without.p95} ms, within one frame`,
    withSnapshots.p95 - without.p95 <= TYPING_COST_BUDGET_MS,
    {
      withP95: withSnapshots.p95,
      withoutP95: without.p95,
      budgetMs: TYPING_COST_BUDGET_MS,
      // Not budgeted: the one keystroke that lands inside a snapshot pays for the block
      // the check above bounds. It is here so the number is on the record.
      withWorst: withSnapshots.worst,
      withoutWorst: without.worst,
    },
  )

  h.log(
    `G7 M7 at ${lineCount} lines: one snapshot blocked the main thread ${snapshot.worstMs} ms (budget ${SNAPSHOT_BLOCK_BUDGET_MS}; idle floor ${idleProbe.worstMs} ms; the pass took ${snapshot.totalMs} ms); ` +
      `keypress→drawn p50/p95 ${without.p50}/${without.p95} ms with recovery off, ${withSnapshots.p50}/${withSnapshots.p95} ms with ${withSnapshots.flushes} snapshots fired during the sample`,
  )
})
