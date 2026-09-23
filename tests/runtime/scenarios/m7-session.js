// Coming back the way it was left (plan §5 M7 H7 `m7-session-1/2`, AD-22, WP7.5).
//
//   run 1  three programs open, each with its own place in the text and its own
//          bookmarks; a mill-looking program told by hand that it is a turning program;
//          one lathe tab given a machine that is **not** the default, and another told
//          explicitly to use **none** while a default exists. A clean quit.
//   run 2  the same HOME, and every one of those answers back.
//
// The explicit "none" is the check this pair turns on. `undefined` (follow the profile's
// default machine), `null` (none, on purpose) and an id are three different answers about
// one document (AD-31), and the cheap implementation of "remember the machine" collapses
// the first two — after which a programmer who deliberately read a program with no
// machine gets the shop's default control applied to it at the next start, and every
// number in it is read on a different ruler. So one tab is left following the default and
// one is told "none", and run 2 has to tell them apart.
//
// Three things about how this is driven:
//
//   1. **The machines are made through the service**, as in `m6-machines-select`: this
//      pair is about what survives a restart, and `m6-machines-manage` already proves the
//      page that writes them.
//   2. **Each tab is visited and then left.** The memo of a document is written when it
//      is closed, when the user switches away from it, and before quit (AD-22) — so the
//      three are set in turn, and the last switch is what captures the one before it.
//   3. **Run 1 ends with a real quit**, not with the runner's SIGTERM: the memos, the
//      session list and the clear of the recovery snapshots all hang from
//      `files.onWillQuit`, and only a quit fires it.

import { scenario } from '../lib/index.js'
import { LATHE, MILL, activeDoc, configPaths, context, copyFile, docIdFor, otherRun, quitCleanly, read, ready, requireFirstRun } from './m7-common.js'
import { machineItem, pickMachine, waitForMachine } from './m6-common.js'

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../m7-session-1/state-home'

/** The rule set a machine of this shop's lathe carries (as `m6-machines-select`). */
const IS_B_RULES = {
  mode: 'increment',
  incrementMm: '0.001',
  incrementInch: '0.0001',
  incrementDeg: '0.001',
  incrementSec: '0.001',
  classes: { feedPerMin: { mode: 'calculator' }, feedPerRev: { mode: 'calculator' } },
}
const AS_WRITTEN_RULES = { mode: 'calculator', incrementMm: '0.001' }

const DEFAULT_MACHINE = 'Turret One'
const OTHER_MACHINE = 'Turret Two'

/** The three programs of this pair, with the place and the marks each one keeps. */
const PROGRAMS = [
  { name: 'mill.nc', fixture: 'nc/fanuc/f01-mill-3tools.nc', line: 40, bookmarks: [5, 12, 33] },
  { name: 'turn-a.nc', fixture: 'nc/fanuc-lathe/l01-turning-a.nc', line: 25, bookmarks: [7] },
  { name: 'turn-b.nc', fixture: 'nc/fanuc-lathe/l05-system-b.nc', line: 20, bookmarks: [3, 18] },
]

/** Where the three live: run 1's folder, which outlives run 1. */
const pathsIn = (/** @type {string} */ run) => PROGRAMS.map((p) => `${run}/keep/${p.name}`)

/** The machine status item's two answers about one document (§7.12). */
const machineOf = (/** @type {any} */ h) => ({
  id: machineItem(h)?.dataset.machineId ?? null,
  choice: machineItem(h)?.dataset.choice ?? null,
})

scenario('m7-session-1', { timeout: 300, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  h.check('the app runs on the shared home of this pair', paths.stateFile.startsWith(`${h.cfg.run}/state-home/`), paths.stateFile)

  // --- the shop's two controls, one of them the default for turning programs ---------
  // Untyped, as `m6-machines-select` takes it: a machine record is a `Partial<MachineParams>`
  // of unions the scenario spells as plain strings, and annotating every preset here would
  // pull `core/machines/types.ts` into a file the node runner also imports.
  const machines = /** @type {any} */ (ctx).machines
  const turretOne = await machines.add({ name: DEFAULT_MACHINE, profile: LATHE, notes: '', params: { numberInput: IS_B_RULES, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A' } } })
  const turretTwo = await machines.add({ name: OTHER_MACHINE, profile: LATHE, notes: '', params: { numberInput: AS_WRITTEN_RULES, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'B' } } })
  await machines.setDefault(LATHE, turretOne)
  await h.idle()
  h.check('the shop has two controls and one of them is the default for turning', machines.defaultFor(LATHE) === turretOne && turretOne !== turretTwo, { turretOne, turretTwo, default: machines.defaultFor(LATHE) })

  // --- the three programs ------------------------------------------------------------
  const files = pathsIn(h.cfg.run)
  for (const [at, program] of PROGRAMS.entries()) await copyFile(h, await h.fixture(program.fixture), files[at])

  await h.dialogs.queue('open', files)
  await ctx.files.open()
  await h.waitFor(() => files.every((path) => !!ctx.docs.byPath(path)), { timeout: 20000 })
  const ids = files.map((path) => docIdFor(ctx, path))
  h.check('the three programs are open, in the order they were picked', JSON.stringify(h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path)) === JSON.stringify(files), h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path))

  /** Brings a tab to the front and waits for Monaco to be showing it. */
  const show = async (/** @type {string} */ id) => {
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 10000 })
    await h.idle()
  }

  // --- mill.nc: the dialect chosen by hand --------------------------------------------
  await show(ids[0])
  h.check('the mill program was detected as a milling program', ctx.docs.get(ids[0])?.profileId === MILL, ctx.docs.get(ids[0])?.profileId)
  const latheLabel = pickerLabelFor(ctx, LATHE)
  await pickLathe(h, latheLabel)
  await h.waitFor(() => ctx.docs.get(ids[0])?.profileId === LATHE, { timeout: 10000 })
  h.check('a hand-picked dialect takes on the document', ctx.docs.get(ids[0])?.profileId === LATHE, ctx.docs.get(ids[0])?.profileId)
  await waitForMachine(h, turretOne)
  h.check('and since nothing was said about a machine, it follows the shop default', machineOf(h).choice === 'default' && machineOf(h).id === turretOne, machineOf(h))
  await place(h, ids[0], PROGRAMS[0])

  // --- turn-a.nc: a machine that is not the default ------------------------------------
  await show(ids[1])
  h.check('a turning program is detected as one', ctx.docs.get(ids[1])?.profileId === LATHE, ctx.docs.get(ids[1])?.profileId)
  await pickMachine(h, OTHER_MACHINE)
  await waitForMachine(h, turretTwo)
  h.check('picking a machine for this document is a choice of its own', machineOf(h).choice === 'document' && machineOf(h).id === turretTwo, machineOf(h))
  await place(h, ids[1], PROGRAMS[1])

  // --- turn-b.nc: none, deliberately, while a default exists ---------------------------
  await show(ids[2])
  await pickMachine(h, 'None (dialect defaults)')
  await waitForMachine(h, '')
  h.check('"none" is a choice too, and it is not the same as following the default', machineOf(h).choice === 'document' && machineOf(h).id === '', machineOf(h))
  await place(h, ids[2], PROGRAMS[2])

  // Back to the middle tab, which both captures turn-b's memo and decides what is in
  // front at the next start.
  await show(ids[1])

  // --- what is written ----------------------------------------------------------------
  await ctx.uiState.flush()
  const memos = files.map((path) => ctx.fileMemory.get(path))
  h.check('every file has a memo', memos.every((memo) => memo !== undefined), memos)
  h.check('the mill program remembers the dialect that was chosen for it', memos[0]?.profileId === LATHE, memos[0])
  h.check('and nothing about a machine, because nothing was chosen', memos[0]?.machineId === undefined, memos[0])
  h.check('the first lathe program remembers its machine', memos[1]?.machineId === turretTwo, memos[1])
  h.check('the second remembers "none" as null, which is not the same as remembering nothing', memos[2]?.machineId === null && 'machineId' in (memos[2] ?? {}), memos[2])
  h.check('each remembers where the cursor was', PROGRAMS.every((program, at) => memos[at]?.line === program.line), memos.map((memo) => memo?.line))
  h.check('and which lines were bookmarked', PROGRAMS.every((program, at) => JSON.stringify(memos[at]?.bookmarks) === JSON.stringify(program.bookmarks)), memos.map((memo) => memo?.bookmarks))

  const state = JSON.parse(await h.disk.read(paths.stateFile))
  h.check('the memos are in the state file the webview owns half of', files.every((path) => state.ui?.files?.[path] !== undefined), Object.keys(state.ui?.files ?? {}))

  // The list reaches Rust `SESSION_DEBOUNCE_MS` after the *last* open or activation, so
  // the first write of this run says "three files, the first one in front" and is then
  // overwritten. Waiting for the length alone would read that intermediate write.
  const session = await h.waitFor(
    async () => {
      const stored = JSON.parse(await h.disk.read(paths.stateFile)).session
      return stored?.paths?.length === 3 && stored.active === 1 ? stored : null
    },
    { timeout: 15000 },
  )
  h.check('and Rust owns the session list: the three files in tab order, with the front one marked', JSON.stringify(session?.paths) === JSON.stringify(files) && session?.active === 1, session ?? JSON.parse(await h.disk.read(paths.stateFile)).session)

  h.check('not one program was changed', ids.every((id) => ctx.docs.get(id)?.dirty === false), ids.map((id) => `${ctx.docs.get(id)?.title}:${ctx.docs.get(id)?.dirty}`))
  await quitCleanly(h)
})

scenario('m7-session-2', { timeout: 300, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await requireFirstRun(h, 'm7-session-1')
  const files = pathsIn(otherRun(h.cfg.run, 'm7-session-1'))

  await h.waitFor(() => files.every((path) => !!ctx.docs.byPath(path)), { timeout: 30000 })
  await h.idle()
  const ids = files.map((path) => docIdFor(ctx, path))

  h.check('the three programs are open again, in the order they were left in', JSON.stringify(h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path)) === JSON.stringify(files), h.qa('doc-tab').map((/** @type {any} */ e) => e.dataset.path))
  h.check('the tab that was in front is in front again', activeDoc(ctx)?.path === files[1], activeDoc(ctx)?.path)
  h.check('no file dialog was needed for any of it', h.dialogs.calls().length === 0, h.dialogs.calls())
  h.check('and nothing came back unsaved', ids.every((id) => ctx.docs.get(id)?.dirty === false), ids.map((id) => `${ctx.docs.get(id)?.title}:${ctx.docs.get(id)?.dirty}`))

  const machines = /** @type {any} */ (ctx).machines
  const turretOne = machines.defaultFor(LATHE)
  const turretTwo = read(machines.list).find((/** @type {any} */ m) => m.name === OTHER_MACHINE)?.id
  h.check('the shop’s machines came back with their default', typeof turretOne === 'string' && typeof turretTwo === 'string' && turretOne !== turretTwo, { turretOne, turretTwo, machines: read(machines.list).map((/** @type {any} */ m) => m.id) })

  /** Brings a tab to the front, waits for Monaco, and lets the memo be applied. */
  const show = async (/** @type {string} */ id) => {
    ctx.docs.activate(id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 10000 })
    await h.idle()
  }

  // --- mill.nc -------------------------------------------------------------------------
  await show(ids[0])
  h.check('the program that was told it is a turning program still is one — the hand beats the detector', ctx.docs.get(ids[0])?.profileId === LATHE, ctx.docs.get(ids[0])?.profileId)
  h.check('and it still follows the shop default rather than having been given a machine of its own', machineOf(h).choice === 'default' && machineOf(h).id === turretOne, machineOf(h))
  await expectPlace(h, ids[0], PROGRAMS[0])

  // --- turn-a.nc -----------------------------------------------------------------------
  await show(ids[1])
  await waitForMachine(h, turretTwo)
  h.check('the machine picked for this program came back with it', machineOf(h).choice === 'document' && machineOf(h).id === turretTwo, machineOf(h))
  await expectPlace(h, ids[1], PROGRAMS[1])

  // --- turn-b.nc -----------------------------------------------------------------------
  await show(ids[2])
  await waitForMachine(h, '')
  h.check(
    'and the program that was to have no machine still has none, although a default exists',
    machineOf(h).choice === 'document' && machineOf(h).id === '',
    { ...machineOf(h), default: turretOne },
  )
  await expectPlace(h, ids[2], PROGRAMS[2])

  // Nothing in AD-22 writes to a program: a cursor, a set of marks, a dialect and a
  // machine are all remembered beside the file and never in it.
  const same = []
  for (const [at, path] of files.entries()) {
    same.push((await h.disk.hex(path)) === (await h.disk.hex(await h.fixture(PROGRAMS[at].fixture))))
  }
  h.check('and not one byte was written into any of the three programs', same.every(Boolean), same)
})

// ---------------------------------------------------------------- shared steps

/** The label the dialect picker offers a profile under (`contrib/profileSelect.ts`). */
function pickerLabelFor(/** @type {any} */ ctx, /** @type {string} */ profileId) {
  const millName = ctx.profiles.profile(MILL).name
  const latheName = ctx.profiles.profile(profileId).name
  const head = millName.split(' ').filter((/** @type {string} */ word, /** @type {number} */ i) => latheName.split(' ')[i] === word).join(' ')
  return head === '' ? latheName : `${head} · ${latheName.slice(head.length).trim()}`
}

/** Picks a dialect by its label in the quick pick, the way a user does. */
async function pickLathe(/** @type {any} */ h, /** @type {string} */ label) {
  const ctx = context(h)
  const running = ctx.commands.run('file.setProfile')
  if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 10000 }))) throw new Error('file.setProfile opened no picker')
  const row = h.qa('quick-pick-item').find((/** @type {any} */ e) => e.querySelector('.label')?.textContent?.trim() === label)
  if (!row) throw new Error(`no dialect entry ${JSON.stringify(label)} in ${JSON.stringify(h.qa('quick-pick-item').map((/** @type {any} */ e) => e.querySelector('.label')?.textContent?.trim()))}`)
  h.click(row)
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 10000 })
  await running
  await h.idle()
}

/** Puts the cursor where the programmer left it and marks the blocks he marked. */
async function place(/** @type {any} */ h, /** @type {string} */ id, /** @type {{ line: number, bookmarks: number[] }} */ program) {
  const ctx = context(h)
  for (const line of program.bookmarks) ctx.bookmarks.toggle(id, line)
  ctx.editor.reveal(id, program.line, 1)
  await h.idle()
  if (JSON.stringify(ctx.bookmarks.lines(id)) !== JSON.stringify(program.bookmarks)) {
    throw new Error(`bookmarks did not take on ${id}: ${JSON.stringify(ctx.bookmarks.lines(id))}`)
  }
}

/** The same place, read back. */
async function expectPlace(/** @type {any} */ h, /** @type {string} */ id, /** @type {{ name: string, line: number, bookmarks: number[] }} */ program) {
  const ctx = context(h)
  const line = await h.waitFor(() => (ctx.editor.cursor()?.line === program.line ? program.line : null), { timeout: 10000 })
  h.check(`${program.name}: the cursor is back on the line it was left on`, line === program.line, { want: program.line, got: ctx.editor.cursor()?.line })
  h.check(`${program.name}: and the bookmarked blocks are marked again`, JSON.stringify(ctx.bookmarks.lines(id)) === JSON.stringify(program.bookmarks), { want: program.bookmarks, got: ctx.bookmarks.lines(id) })
}
