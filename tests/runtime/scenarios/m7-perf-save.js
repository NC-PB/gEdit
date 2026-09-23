// G7 for M7 (plan §5 M7 "Gates: G7"): a save of a 10 MB program with the `history`
// backup switched on is at most one second slower than the same save with backups off.
//
// The budget exists for the same reason the snapshot budget does, and it is the more
// dangerous of the two. A backup is the mechanism that makes "you saved over a good
// program" survivable, and it is on by default — but it is also the only part of the
// milestone a programmer can feel on the one keystroke they press most often. A save
// that visibly stalls on a big program is a save the programmer turns the backup off
// for, and after that the milestone protects nobody. One second is the line: the copy
// may cost something, it may not cost enough to be worth avoiding.
//
// **What is actually being compared.** `history` copies the *previous version on disk*
// (`src-tauri/src/backup.rs`) before the write, so the save does two passes over 10 MB
// instead of one: a copy of the old file, then the write of the new one. `off` does the
// write alone. Everything else on the path — reading 10 MB out of Monaco, encoding it,
// the stat afterwards — is the same in both, so the difference between the two numbers
// is the copy and nothing else.
//
// **Why three rounds and a median.** One pair of numbers on a machine that is also
// running a browser, an indexer and a build is a coin toss: a single unlucky `off` save
// makes the backup look free, a single unlucky `history` save makes it look ruinous.
// Three of each, alternating so any drift affects both equally, and the median of each
// is what the budget is measured against. The whole spread is logged, because a median
// that passes while the worst case is seconds out is worth seeing.
//
// The first save of all is thrown away: it is the one that pays for the cold page cache
// and for Monaco's first full text extraction, and charging that to whichever mode
// happens to go first would measure the machine rather than the backup.

import { scenario } from '../lib/index.js'
import { largeProgram } from './m3-common.js'
import { backupsRoot, context, listDir, openPath, ready } from './m7-common.js'

/** How much longer a save may take with the copy than without it. */
const BACKUP_COST_BUDGET_MS = 1000
/** Measured saves per mode. */
const ROUNDS = 3

const MIN_LINES = 300000
const MIN_BYTES = 10 * 1024 * 1024

/** The middle value of a sample (the samples here are odd-sized). */
const median = (/** @type {number[]} */ values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

scenario('m7-perf-save', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // ------------------------------------------------------------ the 10 MB program
  const text = largeProgram({ lines: MIN_LINES })
  const lineCount = text.split('\r\n').length - 1
  const path = `${h.cfg.run}/work/perf-save.nc`
  await h.disk.write(path, text)
  h.check(
    `the program has ${lineCount} lines and ${(text.length / 1024 / 1024).toFixed(2)} MiB`,
    lineCount >= MIN_LINES && text.length >= MIN_BYTES,
    { lines: lineCount, bytes: text.length },
  )

  const { id } = await openPath(h, path)
  h.check('history backups are what a new profile saves with (§7.11)', ctx.settings.get('files.backup') === 'history', ctx.settings.get('files.backup'))

  // The document is unsaved for most of this scenario, so the 30 s snapshot ticker would
  // fire during it — a few tens of milliseconds of main thread, landing in whichever save
  // happens to be running. It is bounded by `m7-perf-recovery`, which is where it belongs;
  // here it is only noise in the one number this scenario exists to report.
  await ctx.settings.save({ 'files.recovery': false })
  await h.waitFor(() => ctx.settings.get('files.recovery') === false, { timeout: 5000 })

  /** Switches the backup mode and waits until the app has really taken it. */
  const useMode = async (/** @type {'off' | 'history'} */ mode) => {
    await ctx.settings.save({ 'files.backup': mode })
    await h.waitFor(() => ctx.settings.get('files.backup') === mode, { timeout: 5000 })
  }

  /** How many copies of this program are in the history folder, and how big they are. */
  const history = async () => {
    const root = backupsRoot(ctx)
    if ((await h.disk.stat(root)) === null) return []
    /** @type {number[]} */
    const sizes = []
    for (const key of await listDir(h, root)) {
      const folder = `${root}/${key}/perf-save.nc`
      if ((await h.disk.stat(folder)) === null) continue
      for (const entry of await listDir(h, folder)) sizes.push((await h.disk.stat(`${folder}/${entry}`))?.len ?? 0)
    }
    return sizes
  }

  /**
   * One small edit and one save of the whole 10 MB, timed.
   *
   * The edit is three characters at the top of the file and not a `replaceAll` of the
   * text: rewriting 10 MB through Monaco would take longer than the save and would be
   * charged to whichever mode ran it.
   * @param {number} round
   * @returns {Promise<number>} milliseconds the save took
   */
  const timeOneSave = async (round) => {
    ctx.editor.reveal(id, 2, 1)
    await h.idle()
    ctx.editor.insertText(`(R${round})`)
    await h.waitFor(() => ctx.docs.get(id)?.dirty === true, { timeout: 15000 })
    const started = performance.now()
    const saved = await ctx.files.save(id)
    const took = Math.round(performance.now() - started)
    if (saved !== true) throw new Error(`the save of round ${round} failed`)
    await h.waitFor(() => ctx.docs.get(id)?.dirty === false, { timeout: 15000 })
    return took
  }

  // ------------------------------------------------------------ the throw-away save
  await useMode('off')
  const warm = await timeOneSave(0)
  h.check('the warm-up save went through and left no copy', (await history()).length === 0, { warmMs: warm })

  // ------------------------------------------------------------ the measurement
  /** @type {number[]} */
  const off = []
  /** @type {number[]} */
  const withBackup = []
  for (let round = 1; round <= ROUNDS; round++) {
    await useMode('off')
    off.push(await timeOneSave(round))
    await useMode('history')
    withBackup.push(await timeOneSave(round + ROUNDS))
  }

  // Without this the budget could be met by a backup that never happened.
  const copies = await history()
  h.check(
    `each of the ${ROUNDS} history saves really copied the whole program first`,
    copies.length === ROUNDS && copies.every((size) => size >= MIN_BYTES),
    { copies: copies.length, sizes: copies },
  )
  h.check(
    'and the file on disk is the version the last save wrote',
    (await h.disk.read(path)).includes(`(R${ROUNDS * 2})`),
    (await h.disk.stat(path))?.len,
  )

  const withoutMs = median(off)
  const withMs = median(withBackup)
  const cost = withMs - withoutMs
  h.check(
    `the copy costs at most ${BACKUP_COST_BUDGET_MS} ms on a ${(text.length / 1024 / 1024).toFixed(1)} MiB program: ${cost} ms (${withMs} ms against ${withoutMs} ms)`,
    cost <= BACKUP_COST_BUDGET_MS,
    { costMs: cost, withBackupMs: withMs, withoutMs, budgetMs: BACKUP_COST_BUDGET_MS, allWith: withBackup, allWithout: off },
  )

  h.log(
    `G7 M7 at ${lineCount} lines / ${(text.length / 1024 / 1024).toFixed(2)} MiB: save with history backup ${withBackup.join('/')} ms ` +
      `(median ${withMs}), save with backups off ${off.join('/')} ms (median ${withoutMs}); ` +
      `the copy costs ${cost} ms of the ${BACKUP_COST_BUDGET_MS} ms budget; the thrown-away first save took ${warm} ms`,
  )
})
