// Diameter programming on Sinumerik, as a machine parameter (plan §5 M8 H8
// `m8-sinumerik-diamon`, owner decision D35, WP8.5, WP8.7): a turning `.MPF` with no machine
// is read with `DIAMON` in force, assumed from the profile; a machine whose control starts
// in radius programming changes that, and nothing else; and the program's own `DIAMOF`,
// `DIAM90` and `DIAMON` switch it block by block either way.
//
// **Why it is worth a scenario of its own.** Whether `X40` is a diameter of 40 or a radius
// of 40 is a factor of two on every X of the program, and on this control it is decided by
// machine data, not by the program. The owner decided the turning profile assumes `DIAMON`
// (D35), so the claim under test has three parts, each read where the user or a script
// meets it:
//
//   1. the status item's tooltip, which says "on — dialect default, assumed";
//   2. `gedit_nc.machine_params(ctx)`, which is what a script is told — `on`, from the
//      `profile` — and the machine report rows that print it;
//   3. the modal state a script builds from that context: the goldens
//      `tests/fixtures/modal/sinumerik/diameter.json` and `diameter-off-machine.json`, read
//      at run time and held against a walk of the running app's own context, line by line.
//
// The machine with diameter off is made on Settings ▸ Machines, because the form is where
// D35 is visible to a user: the box is ticked for a new Sinumerik machine.

import { scenario } from '../lib/index.js'
import { ready } from './m4-common.js'
import { machineItem, machinesFile, machineText, pickMachine, sameJson, tooltipLine, waitForMachine } from './m6-common.js'
import {
  MACHINE_REPORT,
  MODAL_WALK,
  REPORT_KEYS,
  REPORT_ROWS,
  SINUMERIK,
  brokenClaims,
  choiceOf,
  closeSettingsDialog,
  context,
  lineOf,
  modalWalk,
  openPath,
  runReport,
  saveMachineForm,
  startAdd,
  ticked,
  writeUserScript,
} from './m8-common.js'

/** The two modal goldens this scenario holds the running app to. */
const GOLDENS = {
  on: 'modal/sinumerik/diameter.json',
  off: 'modal/sinumerik/diameter-off-machine.json',
}

/** The name of the machine made below: a lathe whose control starts in radius programming. */
const RADIUS_LATHE = 'Radius lathe'

/**
 * What the report's words are worth on Sinumerik with no machine. Siemens mode reads a number
 * as written, with or without a point (the 840D sl programming manual, §2.15.6), and that is
 * the profile's one reading, so every word has its value — which is the Sinumerik row of
 * "What none means" in `docs/user/machines.md`.
 */
const WORDS_NONE = ['X50|50|mm', 'X50.|50|mm', 'X50000|50000|mm', 'X0.1|0.1|mm', 'F250|250|mm/rev', 'F25|25|mm/rev', 'F0.25|0.25|mm/rev', 'G04 F200|200|s', 'G04 F20|20|s', 'G04 F2|2|s']

/** And on a machine that reads them as written: every word has its value. */
const WORDS_AS_WRITTEN = ['X50|50|mm', 'X50.|50|mm', 'X50000|50000|mm', 'X0.1|0.1|mm', 'F250|250|mm/rev', 'F25|25|mm/rev', 'F0.25|0.25|mm/rev', 'G04 F200|200|s', 'G04 F20|20|s', 'G04 F2|2|s']

scenario('m8-sinumerik-diamon', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const profile = ctx.profiles.profile(SINUMERIK)
  const reportId = await writeUserScript(h, 'rh_machine_report.py', MACHINE_REPORT)
  const walkId = await writeUserScript(h, 'rh_modal_walk.py', MODAL_WALK)
  const report = async () => (await runReport(h, reportId, REPORT_KEYS, REPORT_ROWS)).rows

  const on = JSON.parse(await h.disk.read(await h.fixture(GOLDENS.on)))
  const off = JSON.parse(await h.disk.read(await h.fixture(GOLDENS.off)))
  const program = (/** @type {string} */ input) => input.replace(/^(\.\.\/)+/, '')
  h.check(
    'both modal goldens are about s05-diameter.MPF, the second on a machine whose only parameter is diameter off',
    program(on.input) === 'nc/sinumerik/s05-diameter.MPF' && program(off.input) === program(on.input) && on.machine === undefined && JSON.stringify(off.machine) === JSON.stringify({ diameter: 'off' }),
    { on: on.input, off: off.input, machine: off.machine },
  )
  h.check('the profile declares diameter programming on, as D35 decided', profile.machineParams?.diameter === 'on', profile.machineParams?.diameter)

  // =============================================================== A. no machine: on, assumed
  const doc = await openPath(h, await h.fixture(program(on.input)))
  const lines = ctx.editor.getLineCount(doc.id)
  h.check('the turning .MPF opened as Sinumerik, with no machine, and the item says so', ctx.docs.get(doc.id)?.profileId === SINUMERIK && machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', {
    profile: ctx.docs.get(doc.id)?.profileId,
    item: machineText(h),
  })
  const diameterLabel = ctx.t('machines.param.diameterWords', { words: 'X', count: 1 })
  h.check(
    'the tooltip says diameter programming is on, and that this is the dialect’s default, assumed',
    tooltipLine(h, diameterLabel) === `${diameterLabel}: ${ctx.t('machines.value.on')} — ${ctx.t('machines.source.profile')}`,
    tooltipLine(h, diameterLabel),
  )

  const none = await report()
  h.check('the machine report shows diameter: on, from the profile', none[4] === 'diameter|on|profile' && none[0] === 'machine|(none)|none', none.slice(0, 5))
  h.check('and what a written number is worth with no machine: every word, a point-less length included, has the value it is written with', JSON.stringify(none.slice(5)) === JSON.stringify(WORDS_NONE), { got: none.slice(5), want: WORDS_NONE })

  const walked = await modalWalk(h, walkId, lines)
  h.check(`the modal walk reports a state for each of the ${lines} lines`, walked.length === lines && walked.every((entry) => entry.state !== null), walked.length)
  for (const { line, after, about } of on.states) {
    const broken = brokenClaims(walked[line - 1]?.state ?? null, after)
    h.check(`no machine, line ${line} (${lineOf(h, doc.id, line)}): the state is the golden's${about ? ` — ${about}` : ''}`, broken.length === 0, { broken, after })
  }

  /**
   * Whether an `X` of each named line is a diameter or a radius, as a walk says. The
   * golden records the mode and the distance mode; this is what a consumer asks for
   * (AD-19 rule 10), so it is read off the walk as well.
   * @param {{ x: string }[]} walk
   * @param {number[]} at
   */
  const readingsAt = (walk, at) => at.map((line) => `${line}:${walk[line - 1]?.x}`)
  const program5 = ctx.editor.getLines(doc.id, 1, lines)
  const find = (/** @type {RegExp} */ re) => program5.findIndex((text) => re.test(text)) + 1
  const diamof = find(/\bDIAMOF\b/)
  const diam90 = find(/\bDIAM90\b/)
  const g91 = find(/\bG91\b/)
  const diamon = find(/\bDIAMON\b/)
  const readings = readingsAt(walked, [diamof - 1, diamof, diam90, g91, g91 + 1, diamon])
  h.check(
    'an X is a diameter at the top, a radius after DIAMOF, a diameter again after DIAM90 while absolute, a radius under G91, and a diameter after DIAMON',
    JSON.stringify(readings) === JSON.stringify([`${diamof - 1}:diameter`, `${diamof}:radius`, `${diam90}:diameter`, `${g91}:radius`, `${g91 + 1}:diameter`, `${diamon}:diameter`]),
    { readings, lines: [diamof - 1, diamof, diam90, g91, g91 + 1, diamon].map((line) => `${line}: ${lineOf(h, doc.id, line)}`) },
  )

  // =============================================================== B. the form: DIAMON is the default a new machine starts with
  const opened = ctx.commands.run('machines.manage')
  await h.waitFor(() => h.q('settings-machines'), { timeout: 10000 })
  await startAdd(h, SINUMERIK)
  h.check('a new Sinumerik machine starts with diameter programming ticked: D35 is the form’s default too', ticked(h, 'diameter') === true, ticked(h, 'diameter'))
  const presets = profile.machineParams?.numberInput?.presets ?? []
  const numberInput = choiceOf(h, 'numberInput')
  const defaultPreset = presets.find((preset) => preset.id === profile.machineParams?.numberInput?.default)
  h.check(
    'and it offers the profile’s one number reading, as written, picked',
    JSON.stringify(numberInput.labels) === JSON.stringify(presets.map((preset) => preset.label)) && numberInput.selected === defaultPreset?.label && defaultPreset?.id === 'calculator',
    numberInput,
  )
  await saveMachineForm(h, { name: RADIUS_LATHE, diameter: false })
  const record = /** @type {any} */ (await machinesFile(h))?.machines?.[0]
  h.check('the machine is written with diameter off, the rest of it the profile’s defaults', record?.profile === SINUMERIK && record?.params?.diameter === 'off' && record?.params?.units === 'mm' && sameJson(record?.params?.numberInput, defaultPreset?.value) && record?.params?.modalInitial === undefined, record)
  await closeSettingsDialog(h)
  await opened

  // =============================================================== C. the machine with diameter off
  await pickMachine(h, RADIUS_LATHE)
  await waitForMachine(h, /** @type {string} */ (record?.id))
  h.check(
    'with the machine, the tooltip says off, set by the machine',
    machineText(h) === `Machine: ${RADIUS_LATHE}` && tooltipLine(h, diameterLabel) === `${diameterLabel}: ${ctx.t('machines.value.off')} — ${ctx.t('machines.source.machine')}`,
    { item: machineText(h), line: tooltipLine(h, diameterLabel) },
  )
  const radius = await report()
  h.check('the machine report shows diameter: off, from the machine', radius[4] === 'diameter|off|machine' && radius[0] === `machine|${RADIUS_LATHE}|document`, radius.slice(0, 5))
  h.check('and every word keeps its value on the machine, which states the same reading', JSON.stringify(radius.slice(5)) === JSON.stringify(WORDS_AS_WRITTEN), { got: radius.slice(5), want: WORDS_AS_WRITTEN })

  const walkedOff = await modalWalk(h, walkId, lines)
  for (const { line, after } of off.states) {
    const broken = brokenClaims(walkedOff[line - 1]?.state ?? null, after)
    h.check(`diameter off on the machine, line ${line} (${lineOf(h, doc.id, line)}): the state is the golden's`, broken.length === 0, { broken, after })
  }
  // What did not change: every claim of the first golden that is not about the diameter mode
  // holds on this machine too — a machine parameter changes the one thing it names. The one
  // difference allowed is provenance: the form writes the units too, so a value the machine
  // now states is marked `@machine` where the profile's was not; its value is the same.
  /** @param {any} state */
  const withoutProvenance = (state) => JSON.parse(JSON.stringify(state ?? null).replace(/"(=[^"@]*)@machine"/g, '"$1"'))
  /** @type {string[]} */
  const drifted = []
  for (const { line, after } of on.states) {
    const rest = Object.fromEntries(Object.entries(after).filter(([key]) => key !== 'diameter'))
    for (const broken of brokenClaims(withoutProvenance(walkedOff[line - 1]?.state), rest)) drifted.push(`line ${line}: ${broken}`)
  }
  h.check('and nothing else in the modal state moved: units, plane, feed mode, clamps, speeds and dwells are what they were', drifted.length === 0, drifted)
  h.check(
    'the units at the top are now the machine’s, which is what the form wrote with the diameter',
    walkedOff[2]?.state?.units === '=mm@machine' && record?.params?.units === 'mm',
    { units: walkedOff[2]?.state?.units, stored: record?.params?.units },
  )
  const offReadings = readingsAt(walkedOff, [diamof - 1, diamof, diam90, g91, diamon])
  h.check(
    'an X at the top is a radius now; the program’s own DIAM90 and DIAMON switch it just as before',
    JSON.stringify(offReadings) === JSON.stringify([`${diamof - 1}:radius`, `${diamof}:radius`, `${diam90}:diameter`, `${g91}:radius`, `${diamon}:diameter`]),
    offReadings,
  )

  // =============================================================== D. back to none
  await pickMachine(h, ctx.t('machines.pick.none'))
  await waitForMachine(h, '')
  const back = await report()
  h.check('back on None the profile’s DIAMON is assumed again', back[4] === 'diameter|on|profile' && tooltipLine(h, diameterLabel).endsWith(ctx.t('machines.source.profile')), { row: back[4], line: tooltipLine(h, diameterLabel) })
  h.check('nothing was edited', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
