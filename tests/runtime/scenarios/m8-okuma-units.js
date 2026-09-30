// The Okuma unit system as a machine parameter, end to end (plan §5 M8: WP8.3's presets,
// WP8.7's feed limits, WP8.8's warning in `docs/user/machines.md`; the owner's decision that
// how a control reads a number is set per machine). An additive scenario of H8: the plan's
// `m8-okuma` asks that the machine item *offers* the three unit systems, and this one
// proves that picking one changes what the program means to everything downstream.
//
// **The fact under test is F52: on this control the unit system multiplies every number,
// a decimal point included.** `X50.` is 50 mm under the 1 mm system and 0.05 mm under the
// 1 µm one, so a machine nobody chose leaves *every* number of an Okuma program without a
// value — and a script that compares a feed with a limit must then say so rather than
// guess. Three steps, each against a golden:
//
//   1. **No machine.** A report of what written words are worth answers "depends on the
//      machine" for every one of them, and scale feed with a largest feed of 0.2 mm/rev
//      scales but applies no limit, and reports each feed it could not check
//      (`scale_feed/okuma-feed-limit-no-machine`).
//   2. **A machine set to the 1 µm system, made on Settings ▸ Machines.** The record holds
//      exactly the unit table the Python golden runs with, the report reads `F250` as
//      0.25 mm/rev, and the same run now clamps two feeds to `F200`
//      (`scale_feed/okuma-feed-limit-1um`) — saved, byte for byte.
//   3. **The other two presets.** Each one reads the words of its own label the way the
//      label says: that label is what a user picks by, so it has to be true.

import { scenario } from '../lib/index.js'
import { ready } from './m4-common.js'
import { undo } from './m5-common.js'
import { machineItem, machineRows, machinesFile, machineText, pickMachine, sameJson, tooltipLine, waitForMachine } from './m6-common.js'
import {
  MACHINE_REPORT,
  OKUMA,
  REPORT_KEYS,
  REPORT_ROWS,
  choiceOf,
  closeSettingsDialog,
  context,
  findings,
  goldenFindings,
  lineOf,
  message,
  openCaseAs,
  runReport,
  runScript,
  saveMachineForm,
  scriptCase,
  startAdd,
  summaryIs,
  writeUserScript,
} from './m8-common.js'

/** The two feed-limit goldens: the same program, run without a machine and with one. */
const CASES = {
  none: 'scale_feed/okuma-feed-limit-no-machine',
  micron: 'scale_feed/okuma-feed-limit-1um',
}

/** The head of the report: the machine and where each of its values came from. */
const head = (/** @type {string} */ machine, /** @type {string} */ choice, /** @type {string} */ mode, /** @type {string} */ increment, /** @type {string} */ source) => [
  `machine|${machine}|${choice}`,
  `numberInput.mode|${mode}|${source}`,
  `numberInput.incrementMm|${increment}|${source}`,
  `units|mm|${source}`,
  `diameter|on|${source}`,
]

/**
 * What the words of the report are worth, in the report's order (`MACHINE_REPORT`):
 * X50, X50., X50000, X0.1 (mm), F250, F25, F0.25 (mm/rev), and the dwells G04 F200,
 * G04 F20, G04 F2 (s).
 * @param {string[]} values
 */
const worth = (values) =>
  ['X50|mm', 'X50.|mm', 'X50000|mm', 'X0.1|mm', 'F250|mm/rev', 'F25|mm/rev', 'F0.25|mm/rev', 'G04 F200|s', 'G04 F20|s', 'G04 F2|s'].map((row, i) => {
    const [key, unit] = row.split('|')
    return `${key}|${values[i]}|${unit}`
  })

/** No machine: every preset reads every one of these words differently. */
const DEPENDS = '(depends on the machine)'
const NO_MACHINE = [...head('(none)', 'none', 'calculator', '1', 'profile'), ...worth(Array(10).fill(DEPENDS))]

/** 1 mm: "X50 and X50. are both 50 mm, F0.25 is 0.25 mm/rev, G04 F2 waits 2 s". */
const ONE_MM = worth(['50', '50', '50000', '0.1', '250', '25', '0.25', '200', '20', '2'])
/** 1 µm: "X50 and X50. are both 0.05 mm, X50000 is 50 mm, F250 is 0.25 mm/rev, G04 F200 waits 2 s". */
const ONE_MICRON = worth(['0.05', '0.05', '50', '0.0001', '0.25', '0.025', '0.00025', '2', '0.2', '0.02'])
/** 10 µm: "X50 and X50. are both 0.5 mm, X0.1 is 0.001 mm, F25 is 0.25 mm/rev, G04 F20 waits 2 s". */
const TEN_MICRON = worth(['0.5', '0.5', '500', '0.001', '2.5', '0.25', '0.0025', '20', '2', '0.2'])

scenario('m8-okuma-units', { timeout: 480 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const machines = /** @type {any} */ (ctx).machines
  const profile = ctx.profiles.profile(OKUMA)
  const presets = profile.machineParams?.numberInput?.presets ?? []
  /** @param {string} id */
  const preset = (id) => presets.find((entry) => entry.id === id)
  h.check('the profile declares the three unit systems', ['okuma-1mm', 'okuma-1um', 'okuma-10um'].every((id) => preset(id) !== undefined), presets.map((entry) => entry.id))

  const reportId = await writeUserScript(h, 'rh_machine_report.py', MACHINE_REPORT)
  const report = async () => (await runReport(h, reportId, REPORT_KEYS, REPORT_ROWS)).rows

  // =============================================================== A. no machine
  const none = await scriptCase(h, CASES.none)
  const micron = await scriptCase(h, CASES.micron)
  h.check('the two goldens run the same program, the second one with a machine', none.input === micron.input && none.options.machine === undefined && micron.options.machine !== undefined, {
    none: none.options,
    micron: micron.options,
  })
  const doc = await openCaseAs(h, none, 'O06-UNIT.MIN')
  const original = await h.disk.read(doc.path)
  h.check('the program opened as Okuma, with no machine', ctx.docs.get(doc.id)?.profileId === OKUMA && machineText(h) === 'Machine: none (assumed)', {
    profile: ctx.docs.get(doc.id)?.profileId,
    machine: machineText(h),
  })

  const nothing = await report()
  h.check(
    'with no machine every written number depends on the machine — a decimal point settles nothing on this control',
    JSON.stringify(nothing) === JSON.stringify(NO_MACHINE),
    { got: nothing, want: NO_MACHINE },
  )

  await runScript(h, 'bundled:scale_feed.py', { form: true, fields: none.params })
  h.check('scale feed with a largest feed and no machine gives the golden bytes: every feed scaled, none clamped', h.app.text() === none.expected, {
    got: h.app.text().split('\n'),
    want: (none.expected ?? '').split('\n'),
    status: message(h),
  })
  h.check('and it says so: three feeds scaled without a limit check', summaryIs(h, none.envelope.message), { got: message(h), want: none.envelope.message })
  h.check(
    'each of them is reported with what every unit system would make of it',
    JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(none.envelope.findings)),
    { got: findings(h), want: goldenFindings(none.envelope.findings) },
  )
  const dwell = none.input.split('\n').findIndex((line) => /^G04 F/.test(line)) + 1
  h.check('the dwell G04 F200 is not a feed in any unit system', dwell > 0 && lineOf(h, doc.id, dwell) === 'G04 F200', lineOf(h, doc.id, dwell))
  await undo(h)
  h.check('one undo puts the program back', h.app.text() === none.input, ctx.docs.get(doc.id)?.dirty)

  // =============================================================== B. a 1 µm machine, made on the page
  const opened = ctx.commands.run('machines.manage')
  await h.waitFor(() => h.q('settings-machines'), { timeout: 10000 })
  await startAdd(h, OKUMA)
  h.check('the form starts on the documented default, 1 mm', choiceOf(h, 'numberInput').selected === preset('okuma-1mm')?.label, choiceOf(h, 'numberInput').selected)
  await saveMachineForm(h, { name: /** @type {string} */ (micron.options.machineName), numberInput: /** @type {string} */ (preset('okuma-1um')?.label) })
  const onDisk = /** @type {any} */ (await machinesFile(h))
  const record = onDisk?.machines?.[0]
  h.check('the machine is written to machines.json under the Okuma profile', onDisk?.machines?.length === 1 && record?.profile === OKUMA && record?.name === micron.options.machineName, onDisk)
  h.check('it stores the whole 1 µm rule set of the preset, not the preset’s name', sameJson(record?.params?.numberInput, preset('okuma-1um')?.value), {
    stored: record?.params?.numberInput,
    preset: preset('okuma-1um')?.value,
  })
  h.check(
    'which is exactly the unit table the Python golden runs with, so the run below is the golden’s run',
    sameJson(record?.params?.numberInput, micron.options.machine.numberInput),
    { stored: record?.params?.numberInput, golden: micron.options.machine.numberInput },
  )
  h.check('the page lists it, not broken', machineRows(h).length === 1 && machineRows(h)[0].profileId === OKUMA && machineRows(h)[0].problems === 0, machineRows(h).map((row) => `${row.id}|${row.profileId}|${row.problems}`))
  await closeSettingsDialog(h)
  await opened

  const micronId = /** @type {string} */ (record?.id)
  await pickMachine(h, /** @type {string} */ (micron.options.machineName))
  await waitForMachine(h, micronId)
  const numberLabel = ctx.t('machines.param.numberInput')
  h.check('the document now reads its numbers with the 1 µm system, and the item says the machine set it', machineText(h) === `Machine: ${micron.options.machineName}` && machineItem(h)?.dataset.assumed === '0' && tooltipLine(h, numberLabel) === `${numberLabel}: ${preset('okuma-1um')?.label} — ${ctx.t('machines.source.machine')}`, {
    item: machineText(h),
    line: tooltipLine(h, numberLabel),
  })

  const micronReport = await report()
  const wantMicron = [...head(/** @type {string} */ (micron.options.machineName), 'document', 'scale', '0.001', 'machine'), ...ONE_MICRON]
  h.check('a script now reads X50 as 0.05 mm and F250 as 0.25 mm/rev: the machine decides, not the program', JSON.stringify(micronReport) === JSON.stringify(wantMicron), {
    got: micronReport,
    want: wantMicron,
  })

  await runScript(h, 'bundled:scale_feed.py', { form: true, fields: micron.params })
  h.check('the same run on the 1 µm machine gives the golden bytes: F250 and F234.56 clamped to 0.2 mm/rev, written as F200 and F200.00', h.app.text() === micron.expected, {
    got: h.app.text().split('\n'),
    want: (micron.expected ?? '').split('\n'),
    status: message(h),
  })
  h.check('with the golden summary, which names the machine', summaryIs(h, micron.envelope.message), { got: message(h), want: micron.envelope.message })
  h.check('and the two clamps are reported in the program’s own unit', JSON.stringify(findings(h)) === JSON.stringify(goldenFindings(micron.envelope.findings)), {
    got: findings(h),
    want: goldenFindings(micron.envelope.findings),
  })
  h.check('the dwell is still G04 F200', lineOf(h, doc.id, dwell) === 'G04 F200', lineOf(h, doc.id, dwell))
  if ((await ctx.files.save(doc.id)) !== true) throw new Error('saving the Okuma program failed')
  await h.idle()
  const saved = await h.disk.read(doc.path)
  h.check('what was saved is the golden, byte for byte', saved === micron.expected && saved !== original)

  // =============================================================== C. the other two unit systems
  const oneMm = await machines.add({ name: 'Lathe 1', profile: OKUMA, notes: '', params: { numberInput: preset('okuma-1mm')?.value, units: 'mm', diameter: 'on' } })
  const tenMicron = await machines.add({ name: 'Lathe 4', profile: OKUMA, notes: '', params: { numberInput: preset('okuma-10um')?.value, units: 'mm', diameter: 'on' } })
  await h.idle()

  await pickMachine(h, 'Lathe 1')
  await waitForMachine(h, oneMm)
  const oneMmReport = await report()
  const wantOneMm = [...head('Lathe 1', 'document', 'calculator', '1', 'machine'), ...ONE_MM]
  h.check('a machine set to 1 mm reads every number as written, point or not — and now that is a fact about the machine, not an assumption', JSON.stringify(oneMmReport) === JSON.stringify(wantOneMm), {
    got: oneMmReport,
    want: wantOneMm,
  })

  await pickMachine(h, 'Lathe 4')
  await waitForMachine(h, tenMicron)
  const tenReport = await report()
  const wantTen = [...head('Lathe 4', 'document', 'scale', '0.01', 'machine'), ...TEN_MICRON]
  h.check('a machine set to 10 µm reads X0.1 as 0.001 mm and F25 as 0.25 mm/rev, as its label says', JSON.stringify(tenReport) === JSON.stringify(wantTen), {
    got: tenReport,
    want: wantTen,
  })

  await pickMachine(h, ctx.t('machines.pick.none'))
  await waitForMachine(h, '')
  const back = await report()
  const wantBack = [`machine|(none)|document`, ...NO_MACHINE.slice(1)]
  h.check('and back on None, nothing is worth anything certain again', JSON.stringify(back) === JSON.stringify(wantBack), { got: back, want: wantBack })
  h.check('no document is left unsaved', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
})
