// Phase 2 exit criterion X11, "Machine configurations and how numbers are read" (plan §2.2;
// `tests/fixtures/exit2/README.md`, X11). A pair: `exit2-x11-1` does the work and quits, `exit2-x11-2`
// is the restart.
//
//   (a) Settings > Machines: "Lathe IS-B" (`fanuc-lathe`, the IS-B number preset, G-code system B,
//       power-on feed mode `G95`) is added and duplicated as "Lathe calc" with the calculator
//       preset; `machines.json` is the golden (ids masked, keys sorted); Edit and "default for its
//       dialect" work, and the default is cleared again before (b) (README: it must read `{}`).
//   (b) On `decimal-lathe.nc` the status item reads "Machine: none (assumed)" and its tooltip lists
//       every effective parameter with its source; picking "Lathe IS-B" changes it; "None" returns to
//       the defaults. `-2` finds the choice back after the restart.
//   (c) Under IS-B, calc and none: address arithmetic `Z - 0.5`, the program check and scale feed
//       90 % give the golden documents, reports and summaries (the same feed bytes under all three).
//   (d) The user script that reports `gedit_nc.machine_params(ctx)` shows the effective values and
//       their sources in each case.
//   (e) The explicit choice wins: `fanuc-lathe-b.nc` (detected system B) under a machine set to system
//       A reads as system A in the tool list, scale feed and hover, with one status warning that names
//       the mismatch; nothing switches by itself.
//
// The hover and inspector halves of (c) are Phase 3 (plan, X11 last sentence); address arithmetic and
// the program check carry them here.

import { scenario } from '../lib/index.js'
import { OPERATIONS, SCRIPTS, fillForm, pick, runFromTools, runReplace } from './m10-common.js'
import { clickMachineAction, closeSettings, machineAction, machineField, machineRows, openMachinesPage, sameJson, tooltipLine } from './m6-common.js'
import { quitCleanly, otherRun, requireFirstRun } from './m7-common.js'
import { startAdd, saveMachineForm } from './m8-common.js'
import { setField } from './m4-common.js'
import {
  activate,
  checkHovers,
  checkStoredReport,
  checkToolList,
  context,
  everyRowJumps,
  exitDir,
  firstDifference,
  gold,
  goldText,
  lf,
  machineItem,
  machineText,
  machinesNow,
  message,
  openIn,
  read,
  ready,
  runAndCompare,
  runScript,
  textNow,
  undo,
  useMachine,
  useNone,
  walkTools,
  writeUserScript,
} from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const HOME_1 = '{run}/x11-home'
const HOME_2 = '{run}/../exit2-x11-1/x11-home'

/** The label of the option that starts with `start`, in a choice field of the open machine form. @param {Harness} h @param {string} field @param {string} start */
function optionStarting(h, field, start) {
  const select = /** @type {HTMLSelectElement | null} */ (machineField(h, field)?.querySelector('select') ?? null)
  const option = [...(select?.options ?? [])].find((o) => (o.textContent ?? '').trim().startsWith(start))
  if (!option) throw new Error(`${field} has no option starting ${JSON.stringify(start)}: ${[...(select?.options ?? [])].map((o) => o.textContent?.trim()).join(' | ')}`)
  return (option.textContent ?? '').trim()
}

/** `machines.json` with the ids masked, from the golden or from the app. */
const masked = (/** @type {any} */ file) => ({ ...file, machines: (file?.machines ?? []).map((/** @type {any} */ m) => ({ ...m, id: '*' })) })

/**
 * The tooltip lines that name a parameter and its source, one per effective value.
 * @param {Harness} h
 */
const tooltipLines = (h) => (machineItem(h)?.getAttribute('title') ?? '').split('\n').filter((line) => / — /.test(line))

/** The words of the tooltip for each parameter key of `machine-params.*.json`: the label, and how the value reads. */
const PARAM_WORDS = {
  numberInput: { label: 'How the control reads numbers', value: (/** @type {string} */ v) => { const n = JSON.parse(v); return n.mode === 'calculator' ? 'As written' : `Increments of ${n.incrementMm} mm (${{ '0.001': 'IS-B', '0.0001': 'IS-C' }[/** @type {'0.001'} */ (n.incrementMm)]})` } },
  units: { label: 'Units at power-on', value: (/** @type {string} */ v) => ({ mm: 'Millimetres (mm)', inch: 'Inches' })[/** @type {'mm'} */ (v)] },
  diameter: { label: 'X and U are diameters at power-on', value: (/** @type {string} */ v) => v },
  'variant gcodeSystem': { label: 'G-code system', value: (/** @type {string} */ v) => `G-code system ${v}` },
  'variant incrementalAddresses': { label: 'U, W, V and H move incrementally', value: (/** @type {string} */ v) => ({ uw: 'U and W are incremental X and Z' })[/** @type {'uw'} */ (v)] },
  'variant toolWord': { label: 'Tool word: offset digits', value: (/** @type {string} */ v) => ({ byLength: 'By length' })[/** @type {'byLength'} */ (v)] },
  'power-on feedmode': { label: 'Feed mode at power-on', value: (/** @type {string} */ v) => v },
  'power-on plane': { label: 'Plane at power-on', value: (/** @type {string} */ v) => v },
  'power-on spindlemode': { label: 'Spindle-speed mode at power-on', value: (/** @type {string} */ v) => v },
}

/** The phrase the tooltip ends a line with for each source the report names (the report's `document` source is the machine row, not a parameter). */
const SOURCE_PHRASE = { machine: 'set by the machine', detected: 'detected in this program', profile: 'dialect default, assumed' }

/**
 * (b): the tooltip lists every effective parameter of a `machine-params.*.json` golden with its source,
 * and nothing else: one line per parameter row, `label: value — source`, in any order.
 * @param {Harness} h
 * @param {any} want the golden
 * @param {string} label
 */
function checkTooltipLists(h, want, label) {
  const rows = want.report.rows.filter((/** @type {any} */ r) => r.key !== 'machine')
  const lines = tooltipLines(h)
  const missing = []
  for (const r of rows) {
    const words = /** @type {Record<string, any>} */ (PARAM_WORDS)[r.key]
    const source = /** @type {Record<string, string>} */ (SOURCE_PHRASE)[r.source]
    if (!words || !source) throw new Error(`the golden row ${JSON.stringify(r)} has no tooltip words in this scenario`)
    const start = `${words.label}: ${words.value(r.value)}`
    if (lines.filter((l) => l.startsWith(start) && l.endsWith(` — ${source}`)).length !== 1) missing.push(`${start} … — ${source}`)
  }
  h.check(`${label}: its tooltip lists each of the golden's ${rows.length} parameters once, with its source, power-on feed mode included, and no other line`, missing.length === 0 && lines.length === rows.length, { missing, lines })
}

scenario('exit2-x11-1', { timeout: 900, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await exitDir(h)
  const x11 = await gold(h, dir, 'machines.x11.json')
  const checks = { 'is-b': await gold(h, dir, 'decimal-lathe.checks.is-b.json'), calc: await gold(h, dir, 'decimal-lathe.checks.calc.json'), none: await gold(h, dir, 'decimal-lathe.checks.none.json') }
  const params = { 'is-b': await gold(h, dir, 'machine-params.is-b.json'), calc: await gold(h, dir, 'machine-params.calc.json'), none: await gold(h, dir, 'machine-params.none.json') }
  const feed = await gold(h, dir, 'decimal-lathe.feed90.report.json')
  const feedText = await goldText(h, dir, 'decimal-lathe.feed90.nc')
  const under = await gold(h, dir, 'fanuc-lathe-b.under-a.json')
  const [spec, specCalc] = x11.machines
  h.check('no machine exists at all: this is where the criterion starts', (await machinesNow(h)) === null)

  // ============================================================ (a) Settings > Machines
  const page = await openMachinesPage(h)
  await startAdd(h, 'fanuc-lathe')
  // The power-on feed codes depend on the G-code system, so the system is set first and the form allowed to redraw.
  setField(h, 'variant.gcodeSystem', optionStarting(h, 'variant.gcodeSystem', 'G-code system B'))
  await h.frame()
  await h.idle()
  await saveMachineForm(h, {
    name: spec.name,
    numberInput: optionStarting(h, 'numberInput', 'Increments of 0.001 mm (IS-B)'),
    'modal.feedmode': optionStarting(h, 'modal.feedmode', 'G95'),
  })
  await clickMachineAction(h, 'duplicate', machineRows(h)[0].id)
  await saveMachineForm(h, { name: specCalc.name })
  await clickMachineAction(h, 'edit', machineRows(h).find((r) => r.name === specCalc.name)?.id)
  await saveMachineForm(h, { numberInput: optionStarting(h, 'numberInput', 'As written') })
  const written = await machinesNow(h)
  h.check('adding "Lathe IS-B" and duplicating it as "Lathe calc" writes the golden machines.json (ids masked, keys sorted, $version 1)', sameJson(masked(written), x11), { got: masked(written), want: x11 })
  const ids = Object.fromEntries(machineRows(h).map((r) => [r.name, r.id]))
  h.check('and the page lists both', machineRows(h).length === 2 && !!ids['Lathe IS-B'] && !!ids['Lathe calc'] && machineRows(h).every((r) => r.problems === 0), machineRows(h).map((r) => `${r.id}|${r.name}`))
  await clickMachineAction(h, 'default', ids['Lathe IS-B'])
  await h.waitFor(() => machineRows(h).find((r) => r.id === ids['Lathe IS-B'])?.isDefault === true, { timeout: 8000 })
  h.check('"default for its dialect" is recorded per dialect', sameJson((await machinesNow(h)).defaults, { 'fanuc-lathe': ids['Lathe IS-B'] }), (await machinesNow(h)).defaults)
  // X11 (a), README: the default is cleared before (b) reads "Machine: none".
  await /** @type {any} */ (ctx.machines).setDefault('fanuc-lathe', null)
  await h.waitFor(() => machineRows(h).every((r) => r.isDefault === false), { timeout: 8000 })
  h.check('the default is cleared again, so `defaults` reads {} as the golden does', sameJson((await machinesNow(h)).defaults, {}) && sameJson(masked(await machinesNow(h)), x11), (await machinesNow(h)).defaults)
  h.check('Edit and Remove are offered on each row', machineRows(h).every((r) => !!machineAction(h, 'edit', r.id) && !!machineAction(h, 'remove', r.id) && !!machineAction(h, 'default', r.id)), null)
  await closeSettings(h, page)

  // ============================================================ (b) decimal-lathe.nc: none first
  const file = await openIn(h, dir, 'decimal-lathe.nc')
  const id = file.id
  const input = textNow(h)
  h.check('decimal-lathe.nc is a Fanuc lathe program', ctx.docs.get(id)?.profileId === 'fanuc-lathe', ctx.docs.get(id)?.profileId)
  h.check('the status item reads "Machine: none (assumed)", marked assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1' && machineItem(h)?.dataset.choice === 'none', machineText(h))
  const noneLines = tooltipLines(h)
  h.check('its tooltip carries the labels of numbers, units, diameter, G-code system and power-on feed mode', ['How the control reads numbers', 'Units at power-on', 'X and U are diameters at power-on', 'G-code system', 'Feed mode at power-on'].every((l) => tooltipLine(h, l) !== ''), noneLines)
  checkTooltipLists(h, params.none, 'with no machine')
  h.check('with none, the G-code system is system B, detected in the program', tooltipLine(h, 'G-code system') === 'G-code system: G-code system B — detected in this program', tooltipLine(h, 'G-code system'))
  /** (b), the rest: picking a machine changes the item, "None" returns to the defaults. Run once the no-machine case of (c) is done, because an explicit None is a choice of its own. */
  const pickAndReturn = async () => {
    await useMachine(h, ids['Lathe IS-B'], 'Lathe IS-B')
    h.check('picking "Lathe IS-B" changes the item: the machine is named and its values are set by the machine', machineText(h).includes('Lathe IS-B') && machineItem(h)?.dataset.assumed !== '1' && tooltipLine(h, 'How the control reads numbers').endsWith('set by the machine'), { text: machineText(h), line: tooltipLine(h, 'How the control reads numbers') })
    h.check('and the tooltip differs from the none case', JSON.stringify(tooltipLines(h)) !== JSON.stringify(noneLines), tooltipLines(h))
    checkTooltipLists(h, params['is-b'], 'with "Lathe IS-B"')
    await useNone(h)
    h.check('"None" returns to the dialect defaults', machineText(h) === 'Machine: none (assumed)' && JSON.stringify(tooltipLines(h)) === JSON.stringify(noneLines), machineText(h))
  }

  // ============================================================ (c) and (d) under IS-B, calc, none
  const scriptId = await writeUserScript(h, 'exit2_machine_params.py', await h.disk.read(`${dir}/scripts/report_machine_params.py`))
  const arith = {
    'is-b': await gold(h, dir, 'decimal-lathe.arith-z-0.5.is-b.report.json'),
    calc: await gold(h, dir, 'decimal-lathe.arith-z-0.5.calc.report.json'),
    none: await gold(h, dir, 'decimal-lathe.arith-z-0.5.none.report.json'),
  }
  for (const variant of /** @type {const} */ (['none', 'is-b', 'calc'])) {
    const label = { 'is-b': 'Lathe IS-B', calc: 'Lathe calc', none: 'no machine' }[variant]
    await activate(h, id)
    // The no-machine case comes first, with nothing chosen for the document (its choice is "none", not an explicit None).
    if (variant === 'is-b') await pickAndReturn()
    if (variant !== 'none') await useMachine(h, ids[label], label)
    h.check(`(${variant}) the golden names ${variant === 'none' ? 'no machine' : label}`, (variant === 'none') === (checks[variant].machine === null) && (variant === 'none' || checks[variant].machine.name === label), checks[variant].machine?.name)

    // (c) address arithmetic Z - 0.5
    const goldArith = await goldText(h, dir, `decimal-lathe.arith-z-0.5.${variant}.nc`)
    const { envelope } = await runReplace(h, SCRIPTS.arithmetic, () => fillForm(h, { operation: pick('subtract', OPERATIONS.indexOf('subtract')), operand: arith[variant].params.operand, addresses: arith[variant].params.addresses }))
    h.check(`(${variant}) address arithmetic Z - 0.5 gives the golden document`, textNow(h) === lf(goldArith), { diff: firstDifference(textNow(h), lf(goldArith)) })
    h.check(`(${variant}) and the golden summary`, envelope?.message === arith[variant].message, { got: envelope?.message, want: arith[variant].message })
    const asRows = (/** @type {any[]} */ list) => (list ?? []).map((f) => `${f.line}|${f.severity}|${f.reason}|${f.message}`)
    h.check(`(${variant}) and the golden findings (the W words${variant === 'none' ? ', and the point-less Z1000 as depending on the machine' : ''})`, JSON.stringify(asRows(envelope?.findings)) === JSON.stringify(asRows(arith[variant].findings)), { got: asRows(envelope?.findings), want: asRows(arith[variant].findings) })
    h.check(`(${variant}) Z1000 ${variant === 'is-b' ? 'became Z500' : variant === 'calc' ? 'became Z999.5' : 'is left alone'} and Z10. became Z9.5`, textNow(h).includes(variant === 'is-b' ? 'Z500' : variant === 'calc' ? 'Z999.5' : 'Z1000') && textNow(h).includes('Z9.5'), textNow(h).split('\n').slice(9, 12))
    await undo(h)
    h.check(`(${variant}) one undo takes the arithmetic back`, textNow(h) === input)

    // (c) the program check
    await runFromTools(h, SCRIPTS.checks, () => {})
    checkStoredReport(h, checks[variant].report, `(${variant}) program checks`)
    await everyRowJumps(h, `(${variant}) program checks`)

    // (c) scale feed 90 %: the same bytes under all three
    await runAndCompare(h, { id, scriptId: 'bundled:scale_feed.py', fields: { percent: feed.params.percent }, golden: feedText, report: { message: feed.runs[variant].message, findings: feed.runs[variant].findings }, label: `(${variant}) scale feed 90 % (F155 under G94 becomes F140: every Fanuc preset reads feeds as written)` })

    // (d) the user script
    await runScript(h, scriptId)
    await h.waitFor(() => /** @type {any} */ (read(ctx.results.current))?.title === params[variant].report.title, { timeout: 30000 })
    await h.idle()
    checkStoredReport(h, params[variant].report, `(${variant}) effective machine parameters`)
    h.check(`(${variant}) the document is as it was`, textNow(h) === input && ctx.docs.get(id)?.dirty !== true)
  }

  // ============================================================ (e) the explicit choice wins
  const b = await openIn(h, dir, 'fanuc-lathe-b.nc')
  h.check('fanuc-lathe-b.nc is detected as system B, margin 12 (the golden)', tooltipLine(h, 'G-code system') === 'G-code system: G-code system B — detected in this program' && under.detected.value === 'B' && under.detected.margin === 12, tooltipLine(h, 'G-code system'))
  const aMachine = await (async () => {
    const machines = /** @type {any} */ (ctx).machines
    const idA = await machines.add({ name: under.machine.name, profile: under.machine.profile, notes: under.machine.notes, params: structuredClone(under.machine.params) })
    await h.idle()
    return idA
  })()
  await useMachine(h, aMachine, under.machine.name)
  h.check('one status warning names the mismatch, and nothing was changed', message(h) === under.statusWarning || message(h).includes(under.statusWarning), message(h))
  h.check('the machine wins: the G-code system is system A, set by the machine', tooltipLine(h, 'G-code system') === 'G-code system: G-code system A — set by the machine', tooltipLine(h, 'G-code system'))
  h.check('and the program is still detected as B: the item did not switch by itself', ctx.docs.get(b.id)?.profileId === 'fanuc-lathe' && textNow(h).includes('G92 S2200'), null)
  await walkTools(h, b.id, under.toolLines, 'machine A on a system B program')
  await checkToolList(h, under.toolList, 'machine A on a system B program')
  await runAndCompare(h, {
    id: b.id,
    scriptId: 'bundled:scale_feed.py',
    fields: { percent: under.scaleFeed.params.percent },
    golden: lf(textNow(h)).split('\n').map((l, i) => under.scaleFeed.changedLines.find((/** @type {any} */ c) => c.line === i + 1)?.after ?? l).join('\n'),
    report: under.scaleFeed,
    label: 'machine A on a system B program: scale feed 90 % (the G78 lead is kept as a threading cycle in another G-code system)',
  })
  await checkHovers(h, b.id, under.hovers, 'machine A on a system B program')

  // ============================================================ the choices that must survive the restart
  await activate(h, id)
  await useMachine(h, ids['Lathe IS-B'], 'Lathe IS-B')
  await activate(h, b.id)
  await ctx.uiState.flush()
  await quitCleanly(h)
})

scenario('exit2-x11-2', { timeout: 300, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await requireFirstRun(h, 'exit2-x11-1')
  const run1 = otherRun(h.cfg.run, 'exit2-x11-1')
  const x11 = await gold(h, `${run1}/fixtures/exit2`, 'machines.x11.json')
  const decimal = `${run1}/fixtures/exit2/decimal-lathe.nc`
  await h.waitFor(() => !!ctx.docs.byPath(decimal), { timeout: 30000 })
  await h.idle()

  const file = await machinesNow(h)
  h.check('machines.json is still the golden (Lathe IS-B, Lathe calc, no default) after the restart, plus the machine of (e)', sameJson(masked({ ...file, machines: file.machines.filter((/** @type {any} */ m) => m.name !== 'X11 Lathe A') }), x11), file)
  const page = await openMachinesPage(h)
  const rows = machineRows(h)
  h.check('both machines are listed after the restart', ['Lathe IS-B', 'Lathe calc'].every((n) => rows.some((r) => r.name === n && r.problems === 0)), rows.map((r) => `${r.id}|${r.name}`))
  await closeSettings(h, page)

  const id = ctx.docs.byPath(decimal)?.id ?? ''
  await activate(h, id)
  const isB = rows.find((r) => r.name === 'Lathe IS-B')?.id
  h.check('the restart brought the machine back for that file: Lathe IS-B', machineItem(h)?.dataset.machineId === isB && machineText(h).includes('Lathe IS-B'), { text: machineText(h), id: machineItem(h)?.dataset.machineId })
  h.check('as a choice of the document, with the values set by the machine', machineItem(h)?.dataset.choice === 'document' && tooltipLine(h, 'How the control reads numbers').endsWith('set by the machine'), machineItem(h)?.dataset.choice)
  await useNone(h)
  h.check('"None" returns to the profile defaults', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', machineText(h))
})
