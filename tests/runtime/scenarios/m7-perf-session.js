// G7 for M7 (plan §5 M7 "Gates: G7"): a session of ten programs comes back in under
// three seconds.
//
// AD-22 puts the session restore in front of everything the programmer wants to do:
// until it has finished, the window is not the window they left. It is also the one
// part of the milestone that scales with how hard somebody works — ten tabs is a normal
// Friday, not a stress test — and it is the part that does the most per file: a stat to
// see whether the file is still there and still allowed, a read, a decode, dialect
// detection, a Monaco model, and the per-file memo (cursor, top line, bookmarks) put
// back on top. Three seconds is the line between "it starts" and "it hangs".
//
// **What is measured, and what is deliberately not.** The clock runs across
// `session.restore()` — the call `contrib/session.ts` makes — and then on until all ten
// tabs are in the DOM, because a promise that has resolved while the window is still
// blank is not a restored session. It does **not** include starting the process or the
// first render: P1 already budgets those, they are the same with or without a session,
// and charging them here would make the number impossible to compare between runs.
//
// **Why one run and not a pair.** A `-1`/`-2` pair would restore at a real start, but
// the restore would then be over before the scenario's first line ran and the clock
// could only be started after the fact. Driving `session.restore()` in one run measures
// exactly the same code on exactly the same stored list — `state.json` is written by
// the real tracker here, not by the scenario — and it can be timed from both ends.
//
// **The one race, and how it is closed.** Closing the ten tabs schedules an *empty*
// session write one second later (`SESSION_DEBOUNCE_MS`); every close reschedules it, so
// nothing is written while the tabs are going, and the clock that matters starts at the
// **last** close. The restore is fired from there with nothing awaited in between — see
// the comment at that line — so it reads the stored list in one IPC round trip, long
// inside the second; and by the time the timer does fire, the ten files are open again
// and the write is a no-op. Should the race ever be lost anyway, `restore()` answers 0
// and the check below fails loudly rather than reporting a very fast empty restore.

import { scenario } from '../lib/index.js'
import { largeProgram } from './m3-common.js'
import { configPaths, context, docIdFor, ready } from './m7-common.js'

/** How long a session of `TABS` programs may take to come back. */
const RESTORE_BUDGET_MS = 3000
const TABS = 10
/**
 * Lines per program. Ten programs of this size are about 7 MB of NC in total — a real
 * morning's work rather than ten toy files, which a three-second budget would not say
 * anything about.
 */
const LINES = 20000

scenario('m7-perf-session', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  h.check('coming back to the last session is what a new profile does (§7.11)', ctx.settings.get('files.restoreSession') === true, ctx.settings.get('files.restoreSession'))

  // ------------------------------------------------------------ ten programs
  /** @type {string[]} */
  const files = []
  let bytes = 0
  for (let at = 0; at < TABS; at++) {
    const path = `${h.cfg.run}/work/job-${String(at + 1).padStart(2, '0')}.nc`
    // A different length each time, so no two files are the same bytes: a restore that
    // somehow shared work between identical documents would be measuring itself.
    const text = largeProgram({ lines: LINES + at })
    await h.disk.write(path, text)
    bytes += text.length
    files.push(path)
  }
  h.check(
    `${TABS} programs of about ${Math.round(LINES / 1000)}k lines each, ${(bytes / 1024 / 1024).toFixed(1)} MiB in all`,
    files.length === TABS && bytes > TABS * 400 * 1024,
    { files: files.length, bytes },
  )

  await h.dialogs.queue('open', files)
  await ctx.files.open()
  await h.waitFor(() => files.every((path) => !!ctx.docs.byPath(path)), { timeout: 60000 })
  await h.idle()
  const openedIds = files.map((path) => docIdFor(ctx, path))
  h.check(`all ${TABS} are open`, h.qa('doc-tab').length === TABS, h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path))

  // The tracker writes one second after the last change (`SESSION_DEBOUNCE_MS`), so this
  // waits for the app's own write rather than putting a list there itself.
  const stateFile = configPaths(ctx).stateFile
  /** The stored session, as Rust wrote it. */
  const storedPaths = async () => {
    if ((await h.disk.stat(stateFile)) === null) return []
    try {
      return JSON.parse(await h.disk.read(stateFile))?.session?.paths ?? []
    } catch {
      return []
    }
  }
  const stored = await h.waitFor(
    async () => {
      const paths = await storedPaths()
      return paths.length === TABS ? paths : null
    },
    { timeout: 20000 },
  )
  h.check(`the session on disk is the ${TABS} programs, in tab order`, JSON.stringify(stored) === JSON.stringify(files), stored)

  // ------------------------------------------------------------ close them all
  for (const id of openedIds) {
    if ((await ctx.files.close(id)) !== true) throw new Error(`closing ${id} failed`)
  }
  // ------------------------------------------------------------ the restore
  // **Nothing may be awaited between the last close and the restore.** Each close
  // reschedules the session write for a second later, so no write happens while the tabs
  // are going; the last one leaves an *empty* write pending, and the restore has to have
  // read the stored list before it lands. Once it has, that write is harmless — the ten
  // files are open again long before the timer fires. So the state of the window is read
  // synchronously out of the store here and only reported further down, and there is no
  // `h.idle()` on this line: an idle wait is exactly the unbounded thing that could hand
  // the second away under load.
  const emptied = ctx.docs.all().every((doc) => doc.path === null)
  const started = performance.now()
  const opened = await ctx.session.restore()
  const resolvedMs = Math.round(performance.now() - started)
  const drawn = await h.waitFor(
    () => (files.every((path) => !!h.q('doc-tab', { path })) ? performance.now() : undefined),
    { timeout: 30000, interval: 5 },
  )
  const tabsMs = Math.round((drawn ?? performance.now()) - started)

  h.check('the window really was empty when the clock started, on the fresh buffer that always remains', emptied, { emptied })
  h.check(`the restore reopened all ${TABS} programs`, opened === TABS, { opened, expected: TABS })
  h.check(
    'every one of them came back on its own path, in the order they were left in',
    JSON.stringify(h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path)) === JSON.stringify(files),
    h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path),
  )
  h.check('and the fresh buffer they replaced is gone, as AD-22 asks', h.qa('doc-tab').length === TABS, h.qa('doc-tab').length)
  h.check(
    `a ${TABS}-tab session comes back within ${RESTORE_BUDGET_MS} ms (G7): ${tabsMs} ms to the last tab`,
    tabsMs <= RESTORE_BUDGET_MS,
    { tabsMs, resolvedMs, budgetMs: RESTORE_BUDGET_MS, tabs: TABS, bytes },
  )

  h.log(
    `G7 M7: ${TABS} programs (${(bytes / 1024 / 1024).toFixed(1)} MiB) restored in ${tabsMs} ms to the last tab ` +
      `(session.restore() resolved after ${resolvedMs} ms), budget ${RESTORE_BUDGET_MS} ms`,
  )
})
