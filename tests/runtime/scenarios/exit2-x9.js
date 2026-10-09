// Phase 2 exit criterion X9, "Templates and profiles", the user-profile half (plan §2.2;
// `tests/fixtures/exit2/README.md`, X9). The templates half moved to Phase 3.
//
// A user profile `exit2-lathe` (`extends: fanuc-lathe`, a folder rule on the run's copy of `shop/`,
// numbering step 5) and a user code file (a builder `M13`) are written to the config folders and
// loaded; `exit2-broken` (a `numbering.step` that is not a number) is reported with its JSON path
// and skipped. A program in that folder opens with `exit2-lathe` and renumbers in steps of 5; the
// `M13` hover appears; a machine of `fanuc-lathe` is offered for, and applies to, that document.
// Then the user files and the machine are removed and the folders reloaded, so that later criteria
// do not open their programs with the user profile.
//
// `exit2-x9-ties`, below, holds the owner's rule of 2026-10-09: a user profile that extends a
// built-in is picked only through rules it adds itself (here its folder), and a built-in wins every
// tie. It failed until the M13 review fixes (NC-2, H13a finding 3) and passes since.

import { scenario } from '../lib/index.js'
import { hoverAt, openPath } from './m3-common.js'
import { pickerRows } from './m6-common.js'
import {
  activate,
  closeProfilesPage,
  context,
  deleteUserFile,
  exitDir,
  firstDifference,
  gold,
  goldText,
  hoverMissing,
  lf,
  machineItem,
  machineText,
  machinesNow,
  makeMachine,
  openIn,
  openProfilesPage,
  profileRows,
  read,
  ready,
  reloadProfiles,
  removeMachine,
  textNow,
  tooltipLine,
  undo,
  useMachine,
  useNone,
  userDirs,
} from './exit2-common.js'

scenario('exit2-x9', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await exitDir(h)
  const want = await gold(h, dir, 'user-profile.json')
  const shop = `${dir}/shop`
  const { profilesDir, codesDir } = userDirs(h)
  h.check('no user file exists yet: the folders are empty', (await machinesNow(h)) === null && profileRows(h).length === 0)

  // ============================================================ the three files
  const lathe = (await h.disk.read(`${dir}/user/profiles/exit2-lathe.json`)).replace('{{SHOP}}', shop)
  h.check('{{SHOP}} was replaced by the absolute path of the run’s copy', lathe.includes(shop) && !lathe.includes('{{SHOP}}'), lathe)
  await h.disk.write(`${profilesDir}/exit2-lathe.json`, lathe)
  await h.disk.write(`${profilesDir}/exit2-broken.json`, await h.disk.read(`${dir}/user/profiles/exit2-broken.json`))
  await h.disk.write(`${codesDir}/exit2-lathe.json`, await h.disk.read(`${dir}/user/codes/exit2-lathe.json`))
  await ctx.userConfig.load()
  await h.idle()

  // ============================================================ the problem: its file, its JSON path, skipped
  const report = /** @type {any} */ (read(ctx.results.current))
  h.check(`the problems are reported in the Results panel: "${want.problems.title}"`, report?.title === want.problems.title && report?.message === want.problems.message, { title: report?.title, message: report?.message })
  h.check('with the one golden row: the broken file, the profile and JSON path, the reason', JSON.stringify((report?.rows ?? []).map((/** @type {any} */ r) => ({ file: r.file, at: r.at, problem: r.problem }))) === JSON.stringify(want.problems.rows), report?.rows)
  h.check('the broken profile is skipped: it is not a profile, the lathe one is', ctx.profiles.get('exit2-broken') === undefined && ctx.profiles.get(want.profile.id) !== undefined, ctx.profiles.list().map((p) => p.id))

  // ============================================================ the profile item
  const info = ctx.profiles.get(want.profile.id)
  h.check('exit2-lathe is listed as a user profile of its file, extending fanuc-lathe', info?.origin === want.profile.origin && info?.file === want.profile.file && info?.parent === want.profile.parent, info)
  h.check('its own name and short name are the file’s', ctx.profiles.profile(want.profile.id).name === want.profile.displayName && ctx.profiles.profile(want.profile.id).shortName === want.profile.shortName, ctx.profiles.profile(want.profile.id).name)
  h.check('the chain is exit2-lathe, fanuc-lathe, fanuc-gcode', JSON.stringify(info?.chain) === JSON.stringify(want.profile.chain) && info?.machineType === want.profile.machineType, { chain: info?.chain, type: info?.machineType })
  h.check('its numbering is step 5 from 10', ctx.profiles.profile(want.profile.id).numbering?.step === want.numbering.step && ctx.profiles.profile(want.profile.id).numbering?.start === want.numbering.start, ctx.profiles.profile(want.profile.id).numbering)

  // ============================================================ the Profiles page
  const opened = await openProfilesPage(h)
  const rows = profileRows(h)
  const latheRow = rows.find((r) => r.id === 'exit2-lathe' && r.kind === 'profile')
  const brokenRow = rows.find((r) => r.file === 'exit2-broken.json')
  const codeRow = rows.find((r) => r.kind === 'codes' && r.file === 'exit2-lathe.json')
  h.check('the page lists the lathe profile as a user file without problems', latheRow?.origin === 'user' && latheRow.file === 'exit2-lathe.json' && latheRow.problems === 0, latheRow)
  h.check('the broken one with its problem, naming the JSON path', brokenRow?.problems === 1 && brokenRow.problemTexts.some((t) => t.includes('numbering.step') && t.includes(want.problems.rows[0].problem)), brokenRow)
  h.check('the code file as a row of its own', codeRow?.origin === 'user' && codeRow.problems === 0, codeRow)
  h.check('and the six built-in profiles are listed after them', rows.filter((r) => r.origin === 'builtin').length === 6, rows.filter((r) => r.origin === 'builtin').map((r) => r.id))
  await closeProfilesPage(h, opened)

  // ============================================================ a file in the folder opens with it, renumbers in steps of 5
  const part = await openIn(h, dir, 'shop/part-17.nc')
  h.check(`shop/part-17.nc opens with ${want.document.opensWith}`, ctx.docs.get(part.id)?.profileId === want.document.opensWith, ctx.docs.get(part.id)?.profileId)
  const input = textNow(h)
  const renumbered = await goldText(h, dir, want.renumber.golden)
  const running = ctx.commands.run('nc.renumber')
  await h.waitFor(() => h.q('modal'), { timeout: 10000 })
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  await running
  await h.idle()
  h.check('renumber with the form as it opens gives N10, N15, ... with G71/G70 P60 Q80, the golden bytes', textNow(h) === lf(renumbered), { diff: firstDifference(textNow(h), lf(renumbered)) })
  const panel = h.q('results-panel')?.textContent ?? ''
  h.check('the summary and the warning are the golden’s', panel.includes(want.renumber.summary) && want.renumber.warnings.every((/** @type {string} */ w) => panel.includes(w)), panel.slice(0, 300))
  await undo(h)
  h.check('one undo takes the renumber back', textNow(h) === input)

  // ============================================================ the builder code
  const hover = await hoverAt(h, part.id, want.hover.line, 2)
  const missing = hoverMissing(hover, want.hover.markdown)
  h.check(`hover on ${want.hover.word} shows the user's code file text`, hover !== '' && missing.length === 0, { hover: hover.slice(0, 200), missing })

  // ============================================================ a machine of fanuc-lathe is offered for it and applies
  const spec = want.machine.made
  const machineId = await makeMachine(h, spec)
  const picked = await (async () => {
    const running2 = ctx.commands.run('file.setMachine')
    await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
    const labels = pickerRows(h).map((r) => r.label)
    await h.nativeKeys([{ key: 'Escape' }])
    await h.waitFor(() => !h.q('quick-pick'), { timeout: 5000 })
    await running2
    return labels
  })()
  h.check(`"${spec.name}" is offered for a document of the user profile`, want.machine.offered === true && picked.includes(spec.name), picked)
  h.check('before the choice the document is read with the profile defaults: numbers from the profile', tooltipLine(h, 'How the control reads numbers').endsWith('dialect default, assumed') && want.machine.none.numberInput === 'profile', tooltipLine(h, 'How the control reads numbers'))
  await useMachine(h, machineId, spec.name)
  h.check('chosen, it is the document’s machine and its number input is the machine’s', machineItem(h)?.dataset.machineId === machineId && machineText(h).includes(spec.name) && tooltipLine(h, 'How the control reads numbers').endsWith('set by the machine'), { text: machineText(h), line: tooltipLine(h, 'How the control reads numbers') })
  h.check('the document is still read as the user profile', ctx.docs.get(part.id)?.profileId === want.document.opensWith, ctx.docs.get(part.id)?.profileId)
  await useNone(h)
  h.check('None returns to the profile defaults', machineItem(h)?.dataset.machineId === '' && machineItem(h)?.dataset.assumed === '1' && tooltipLine(h, 'How the control reads numbers').endsWith('dialect default, assumed'), tooltipLine(h, 'How the control reads numbers'))

  // ============================================================ the saved bytes
  await activate(h, part.id)
  const again = ctx.commands.run('nc.renumber')
  await h.waitFor(() => h.q('modal'), { timeout: 10000 })
  await h.frame()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  await again
  await h.idle()
  if ((await ctx.files.save(part.id)) !== true) throw new Error('saving part-17.nc failed')
  await h.idle()
  h.check('the saved part-17.nc is part-17.renumber5.nc, byte for byte', (await h.disk.read(part.path)) === renumbered, { diff: firstDifference(await h.disk.read(part.path), renumbered) })

  // ============================================================ the end of X9: the user files and the machine go, the folders reload
  await removeMachine(h, machineId)
  await deleteUserFile(h, 'profiles', 'exit2-lathe.json')
  await deleteUserFile(h, 'profiles', 'exit2-broken.json')
  await deleteUserFile(h, 'codes', 'exit2-lathe.json')
  await reloadProfiles(h)
  h.check('after the reload no user profile is left: the six built-ins only', ctx.profiles.list().every((p) => p.origin === 'builtin') && ctx.profiles.get('exit2-lathe') === undefined, ctx.profiles.list().map((p) => `${p.id}:${p.origin}`))
  h.check('and the machine is gone from machines.json', ((await machinesNow(h))?.machines ?? []).length === 0, await machinesNow(h))
  h.check('the program that used the user profile reads as fanuc-lathe again', ctx.docs.get(part.id)?.profileId === 'fanuc-lathe', ctx.docs.get(part.id)?.profileId)
  const another = await openIn(h, dir, 'fanuc-lathe-b.nc')
  h.check('and a program opened now is the built-in dialect', ctx.docs.get(another.id)?.profileId === 'fanuc-lathe', ctx.docs.get(another.id)?.profileId)
})

/** The programs of the folder that a Fanuc lathe user profile with a folder rule must not take. */
const OUTSIDE = ['fanuc-lathe-a.nc', 'fanuc-lathe-b.nc', 'decimal-lathe.nc', 'twin-single.nc', 'twin_CH1.nc']

// The owner's rule of 2026-10-09 (M13 review NC-2, H13a finding 3). A user profile that `extends:
// fanuc-lathe` and adds a folder rule inherits the parent's extension and content rules, so outside
// its folder it scores exactly what its parent scores; a built-in wins that tie, and only the folder
// is the user profile's. Before the fix every check below that names "outside" failed.
scenario('exit2-x9-ties', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await exitDir(h)
  const { profilesDir, codesDir } = userDirs(h)
  await h.disk.write(`${profilesDir}/exit2-lathe.json`, (await h.disk.read(`${dir}/user/profiles/exit2-lathe.json`)).replace('{{SHOP}}', `${dir}/shop`))
  await h.disk.write(`${codesDir}/exit2-lathe.json`, await h.disk.read(`${dir}/user/codes/exit2-lathe.json`))
  await ctx.userConfig.load()
  await h.idle()
  h.check('the user profile is loaded', ctx.profiles.get('exit2-lathe') !== undefined, ctx.profiles.list().map((p) => p.id))
  const inside = await openIn(h, dir, 'shop/part-17.nc')
  h.check('a program in its folder opens with it', ctx.docs.get(inside.id)?.profileId === 'exit2-lathe', ctx.docs.get(inside.id)?.profileId)
  for (const name of OUTSIDE) {
    const outside = await openIn(h, dir, name)
    h.check(`${name}, outside the folder, opens as the built-in profile it is, not as the user profile`, ctx.docs.get(outside.id)?.profileId === 'fanuc-lathe', ctx.docs.get(outside.id)?.profileId)
  }
  const sameText = await h.disk.read(`${dir}/shop/part-17.nc`)
  const elsewhere = `${h.cfg.run}/elsewhere/part-17.nc`
  await h.disk.write(elsewhere, sameText)
  const copy = await openPath(h, elsewhere)
  h.check('the same text in another folder opens as fanuc-lathe', ctx.docs.get(copy.id)?.profileId === 'fanuc-lathe', ctx.docs.get(copy.id)?.profileId)
})
