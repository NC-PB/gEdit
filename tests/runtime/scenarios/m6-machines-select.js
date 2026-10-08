// Choosing a machine for a document, and what that changes (plan §5 M6 H6
// `m6-machines-select`, §7.15, AD-31): the status item, the picker, the numbers a script
// really gets, the mismatch that is reported and not acted on, and the machine of another
// dialect that brings its dialect with it.
//
// **The report rows are the point of the milestone, in three lines.** `X50` on this lathe
// with no machine is 50 mm, because the dialect's default preset is calculator-type input;
// on a control set to IS-B increments the same four characters are **0.05 mm** — a factor
// of a thousand, decided by a machine parameter and by nothing in the program. A script
// that asks `gedit_nc.machine_params(ctx)` has to see that, or every M6 script is reading
// turning programs with the wrong ruler. The same machine reads `F12` as 12, because
// Fanuc's increment presets read feeds as written — which is why the row is in the golden
// next to the length one.
//
// Three things about how this is driven:
//
//   1. **The machines are created through the service, not through the page.**
//      `m6-machines-manage` is the scenario that proves Settings ▸ Machines; this one is
//      about selection, and building two records through nine clicks each would only make
//      it slower to fail.
//   2. **The script is written into the user scripts folder**, like every throw-away script
//      since M5 (`m5-common.writeUserScript`). It is not put under
//      `tests/runtime/fixtures/scripts/`, because `m0-main` asserts the exact contents of
//      that folder.
//   3. **A mismatch changes nothing.** gEdit does not switch a machine setting because a
//      program looks unusual; it says so once and reads the program the way the machine
//      says. That is the check, not the warning text.

import { scenario } from '../lib/index.js'
import { read, runScript, writeUserScript } from './m5-common.js'
import {
  LATHE,
  MILL,
  context,
  machineItem,
  machineText,
  openFixture,
  pickMachine,
  pickerRows,
  readPicker,
  ready,
  tooltipLine,
  waitForMachine,
} from './m6-common.js'

/** The `is-b` and `calculator` preset rule sets, as a machine stores them. */
const IS_B_RULES = {
  mode: 'increment',
  incrementMm: '0.001',
  incrementInch: '0.0001',
  incrementDeg: '0.001',
  incrementSec: '0.001',
  classes: { feedPerMin: { mode: 'calculator' }, feedPerRev: { mode: 'calculator' } },
}
// G8 M6: the increment is the one a `CodeParam.unit: "increment"` word is counted in —
// the micron parameters of a cycle — and it applies even where positions are as written.
const AS_WRITTEN_RULES = { mode: 'calculator', incrementMm: '0.001' }

/**
 * A user script that reports `gedit_nc.machine_params(ctx)` and what two written numbers
 * mean under it. Nothing is computed here that the app could hand over: the values come
 * from `gedit_nc.value_of`, which is the function every bundled script uses.
 */
const MACHINE_REPORT = `# /// gedit
# name = "Harness machine report"
# description = "Reports the effective machine of the document and what a written number means under it."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H6). Not a bundled script."""

import gedit_nc

ctx = gedit_nc.load_context()
machine = gedit_nc.machine_params(ctx)
params = machine["params"]
source = machine["source"]
units = params["units"]
rules = params["numberInput"] or {}


def value(raw, has_point, number_class):
    answer = gedit_nc.value_of({"raw": raw, "has_point": has_point}, number_class, machine, units)
    return "(no value)" if answer is None else answer


rows = [
    {"key": "machine", "value": machine["name"] or "(none)", "source": machine["choice"]},
    {"key": "numberInput.mode", "value": rules.get("mode") or "(none)", "source": source["numberInput"]},
    {"key": "numberInput.incrementMm", "value": rules.get("incrementMm") or "(none)", "source": source["numberInput"]},
    {"key": "units", "value": units, "source": source["units"]},
    {"key": "diameter", "value": params["diameter"] or "(none)", "source": source["diameter"]},
    {"key": "gcodeSystem", "value": params["variants"].get("gcodeSystem") or "(none)", "source": source["variants"].get("gcodeSystem") or "(none)"},
    {"key": "X50 is", "value": value("50", False, "length"), "source": "mm"},
    {"key": "X50. is", "value": value("50.", True, "length"), "source": "mm"},
    {"key": "F12 is", "value": value("12", False, "feedPerRev"), "source": "mm/rev"},
]

gedit_nc.report("Machine report", [{"key": "key", "label": "Parameter"}, {"key": "value", "label": "Value"}, {"key": "source", "label": "Source"}], rows)
`

/**
 * `key|value|source` for every row, which is what the goldens below are.
 *
 * `machine`'s source column is `EffectiveMachine.choice`, and it has three values that
 * matter here: `none` (nothing was ever chosen), `document` (chosen for this document —
 * including an explicit "None"), and `default` (the dialect's default machine). The first
 * two read the same program the same way and are still different facts, so they are two
 * goldens and not one.
 */
const NONE_A = [
  'machine|(none)|none',
  'numberInput.mode|calculator|profile',
  'numberInput.incrementMm|0.001|profile',
  'units|mm|profile',
  'diameter|on|profile',
  'gcodeSystem|A|detected',
  'X50 is|50|mm',
  'X50. is|50|mm',
  'F12 is|12|mm/rev',
]

/** The same, after an explicit "None (dialect defaults)": every value identical, the choice not. */
const NONE_CHOSEN = ['machine|(none)|document', ...NONE_A.slice(1)]

const IS_B = [
  'machine|Lathe IS-B|document',
  'numberInput.mode|increment|machine',
  'numberInput.incrementMm|0.001|machine',
  'units|mm|machine',
  'diameter|on|machine',
  'gcodeSystem|A|machine',
  // The whole milestone in one row: the same four characters, a thousandth of the value.
  'X50 is|0.05|mm',
  'X50. is|50|mm',
  // And a feed is still read as written, because that is what the IS-B preset says.
  'F12 is|12|mm/rev',
]

const CALC = [
  'machine|Lathe calc|document',
  'numberInput.mode|calculator|machine',
  'numberInput.incrementMm|0.001|machine',
  'units|mm|machine',
  'diameter|on|machine',
  'gcodeSystem|A|machine',
  'X50 is|50|mm',
  'X50. is|50|mm',
  'F12 is|12|mm/rev',
]

/**
 * The report rows on screen, in order, as `key|value|source`.
 *
 * `ResultsPanel` draws one `span.cell[data-column]` per column of the report, so the cells
 * are read by the column keys the script declared rather than by their position.
 */
function reportRows(/** @type {import('../lib/api.js').Harness} */ h) {
  return h.qa('results-row').map((row) =>
    ['key', 'value', 'source']
      .map((column) => row.querySelector(`.cell[data-column="${column}"]`)?.textContent?.trim() ?? '')
      .join('|'),
  )
}

scenario('m6-machines-select', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const machines = /** @type {any} */ (ctx).machines

  const scriptId = await writeUserScript(h, 'rh_machine_report.py', MACHINE_REPORT)

  /**
   * Runs the report and reads its rows.
   * @returns {Promise<string[]>}
   */
  const report = async () => {
    await runScript(h, scriptId)
    await h.waitFor(() => h.qa('results-row').length >= 9, { timeout: 30000 })
    return reportRows(h)
  }

  // ==================================================================== A. no machine
  const lathe = await openFixture(h, 'nc/fanuc-lathe/l01-turning-a.nc')
  h.check('the turning program opened on the lathe dialect', ctx.docs.get(lathe.id)?.profileId === LATHE, ctx.docs.get(lathe.id)?.profileId)
  h.check('with no machine, and the item says the values below are assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', {
    text: machineText(h),
    assumed: machineItem(h)?.dataset.assumed,
  })

  const none = await report()
  h.check('a script with no machine is handed the dialect defaults, every value marked as the dialect’s', JSON.stringify(none) === JSON.stringify(NONE_A), { got: none, want: NONE_A })

  // ==================================================================== B. the picker
  await machines.add({ name: 'Lathe IS-B', profile: LATHE, notes: '', params: { numberInput: IS_B_RULES, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A' } } })
  await machines.add({ name: 'Lathe calc', profile: LATHE, notes: '', params: { numberInput: AS_WRITTEN_RULES, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A' } } })
  await machines.add({ name: 'Mill 1', profile: MILL, notes: '', params: { numberInput: IS_B_RULES, units: 'mm' } })
  await h.idle()

  // The lathe profile inherits from the mill one, so a machine declared for the mill is in
  // this document's profile chain and is offered here (AD-31 "Compatibility"). The other
  // way round it is not, which §G uses.
  const entries = await readPicker(h)
  h.check(
    'the picker offers None, every machine this document’s dialect chain allows, and a way to the page',
    JSON.stringify(entries.map((e) => e.label)) === JSON.stringify(['None (dialect defaults)', 'Lathe calc', 'Lathe IS-B', 'Mill 1', 'Manage machines…']),
    entries.map((e) => e.label),
  )
  h.check('there is no "Other machines…" entry, because no machine is outside that chain', !entries.some((e) => e.label === 'Other machines…'), entries.map((e) => e.label))
  h.check('and None is marked as what this document uses', entries[0].description === '✓', entries.map((e) => `${e.label}|${e.description}`))

  // ==================================================================== C. IS-B
  await pickMachine(h, 'Lathe IS-B')
  await waitForMachine(h, 'lathe-is-b')
  h.check('the item names the machine and drops the assumed marker', machineText(h) === 'Machine: Lathe IS-B' && machineItem(h)?.dataset.assumed === '0' && machineItem(h)?.dataset.choice === 'document', {
    text: machineText(h),
    assumed: machineItem(h)?.dataset.assumed,
    choice: machineItem(h)?.dataset.choice,
  })
  h.check('and every parameter in the tooltip now says it was set by the machine', tooltipLine(h, 'How the control reads numbers').endsWith('— set by the machine') && tooltipLine(h, 'G-code system').endsWith('— set by the machine'), [
    tooltipLine(h, 'How the control reads numbers'),
    tooltipLine(h, 'G-code system'),
  ])

  const isb = await report()
  h.check('a script now reads X50 as 0.05 mm — the machine parameter, not the program, decides that', JSON.stringify(isb) === JSON.stringify(IS_B), { got: isb, want: IS_B })

  // ==================================================================== D. calculator
  await pickMachine(h, 'Lathe calc')
  await waitForMachine(h, 'lathe-calc')
  const calc = await report()
  h.check('a control with calculator-type input reads the same word as 50 mm again', JSON.stringify(calc) === JSON.stringify(CALC), { got: calc, want: CALC })

  // ==================================================================== E. back to none
  await pickMachine(h, 'None (dialect defaults)')
  await waitForMachine(h, '')
  h.check('picking None puts the document back on the dialect defaults, and says they are assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.choice === 'document', {
    text: machineText(h),
    choice: machineItem(h)?.dataset.choice,
  })
  const backToNone = await report()
  h.check('and a script is handed the dialect defaults again, now as this document’s own choice', JSON.stringify(backToNone) === JSON.stringify(NONE_CHOSEN), { got: backToNone, want: NONE_CHOSEN })

  // ==================================================================== F. another type, another control
  // Owner answer 2026-10-08: every machine of the same control is offered whatever its
  // machine type (a lathe machine on a mill program and the reverse), with a warning that the
  // type differs - in the picker, in the status message after picking (sticky) and on the
  // status-bar item. A machine of another control still goes through "Other machines...",
  // and picking one moves the document to that dialect as well.
  const okumaProfile = ctx.profiles.profile('okuma-osp')
  const okumaRules = okumaProfile.machineParams?.numberInput?.presets?.find((/** @type {any} */ p) => p.id === 'okuma-1mm')?.value
  const okuma = await machines.add({ name: 'Okuma 1', profile: 'okuma-osp', notes: '', params: { numberInput: okumaRules, units: 'mm', diameter: 'on' } })
  await h.idle()

  const mill = await openFixture(h, 'nc/fanuc/f01-mill-3tools.nc')
  h.check('the mill document starts on the mill dialect, with no machine', ctx.docs.get(mill.id)?.profileId === MILL && machineText(h) === 'Machine: none (assumed)', {
    profile: ctx.docs.get(mill.id)?.profileId,
    item: machineText(h),
  })
  h.check('and the item shows no type warning', machineItem(h)?.dataset.typeMismatch === '0', machineItem(h)?.dataset.typeMismatch)

  const running = ctx.commands.run('file.setMachine')
  await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
  const rowsHere = pickerRows(h)
  h.check(
    'here the lathe machines of the same control are offered directly, and "Other machines..." is still there for the other control',
    JSON.stringify(rowsHere.map((r) => r.label)) === JSON.stringify(['None (dialect defaults)', 'Lathe calc', 'Lathe IS-B', 'Mill 1', 'Other machines…', 'Manage machines…']),
    rowsHere.map((r) => r.label),
  )
  h.check('the Okuma machine is not among the machines offered directly', !rowsHere.some((r) => r.label === 'Okuma 1'))
  const detailOf = (/** @type {string} */ label) => rowsHere.find((r) => r.label === label)?.detail ?? ''
  h.check(
    'a lathe machine carries the warning in the picker, the mill machine does not',
    detailOf('Lathe IS-B').includes('Machine type differs') && detailOf('Lathe calc').includes('Machine type differs') && !detailOf('Mill 1').includes('Machine type differs'),
    rowsHere.map((r) => `${r.label}|${r.detail}`),
  )
  h.click(/** @type {HTMLElement} */ (rowsHere.find((r) => r.label === 'Lathe IS-B')?.element))
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await running
  await waitForMachine(h, 'lathe-is-b')
  h.check('picking it keeps the document on the mill dialect', ctx.docs.get(mill.id)?.profileId === MILL && machineText(h).startsWith('Machine: Lathe IS-B'), {
    profile: ctx.docs.get(mill.id)?.profileId,
    item: machineText(h),
  })
  const stuck = h.q('status-message')?.textContent?.trim() ?? ''
  h.check('the status message says the type differs, naming both', /Lathe IS-B/.test(stuck) && /is for a lathe, this program is for a mill/.test(stuck), stuck)
  await h.idle()
  await h.sleep(1500)
  h.check('and it is sticky: it is still there a moment later', (h.q('status-message')?.textContent?.trim() ?? '') === stuck, h.q('status-message')?.textContent?.trim())
  h.check('the status-bar item carries the warning sign', machineItem(h)?.dataset.typeMismatch === '1' && /⚠/.test(machineItem(h)?.textContent ?? ''), machineItem(h)?.textContent)
  h.check('and its hover text repeats the warning', (machineItem(h)?.getAttribute('title') ?? '').includes('is for a lathe, this program is for a mill'), machineItem(h)?.getAttribute('title'))

  // The reverse: a mill machine on the lathe program.
  ctx.docs.activate(lathe.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === lathe.id, { timeout: 8000 })
  await pickMachine(h, 'Mill 1')
  await waitForMachine(h, 'mill-1')
  h.check('a mill machine on the turning program warns the same way', machineItem(h)?.dataset.typeMismatch === '1' && /is for a mill, this program is for a lathe/.test(h.q('status-message')?.textContent ?? ''), h.q('status-message')?.textContent)
  await pickMachine(h, 'Lathe IS-B')
  await waitForMachine(h, 'lathe-is-b')
  h.check('and the matching machine does not', machineItem(h)?.dataset.typeMismatch === '0', machineItem(h)?.dataset.typeMismatch)
  ctx.docs.activate(mill.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === mill.id, { timeout: 8000 })

  // (With a machine of this control still chosen, the status line ends on the transient
  // "not for this profile" notice of the profile switch instead of the message below:
  // recorded in the hand-off. The document goes back to None first.)
  await pickMachine(h, 'None (dialect defaults)')
  await waitForMachine(h, '')

  // A machine of another control: still behind "Other machines...", and it brings its dialect.
  const running2 = ctx.commands.run('file.setMachine')
  await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
  h.click(/** @type {HTMLElement} */ (h.qa('quick-pick-item').find((row) => row.querySelector('.label')?.textContent?.trim() === 'Other machines…')))
  await h.waitFor(() => h.qa('quick-pick-item').some((row) => row.querySelector('.label')?.textContent?.trim() === 'Okuma 1'), { timeout: 8000 })
  const second = pickerRows(h)
  h.check('the second list holds only the machine of the other control, naming its dialect', second.length === 1 && second[0].label === 'Okuma 1' && second[0].detail === ctx.profiles.get('okuma-osp')?.name, second.map((r) => `${r.label}|${r.detail}`))
  h.click(second[0].element)
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await running2
  await waitForMachine(h, okuma)
  h.check('picking it moved the document to that machine’s dialect as well', ctx.docs.get(mill.id)?.profileId === 'okuma-osp' && machineText(h) === 'Machine: Okuma 1', {
    profile: ctx.docs.get(mill.id)?.profileId,
    item: machineText(h),
  })
  h.check('the status bar says both halves of what just happened', /Okuma 1/.test(h.q('status-message')?.textContent ?? '') && new RegExp(okumaProfile.shortName).test(h.q('status-message')?.textContent ?? ''), h.q('status-message')?.textContent?.trim())

  // ==================================================================== G. nothing was written
  h.check('no document was modified by any of this', ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty), ctx.docs.all().map((d) => `${d.title}:${d.dirty}`))
  h.check('and the machines are the four that were added', read(machines.list).length === 4, read(machines.list).map((/** @type {any} */ m) => m.id))

  // ==================================================================== H. the mismatch
  // `l05-system-b.nc` is written for G-code system B (`G92 S` clamp, `G95`, `G77`/`G78`).
  // Reading it with a machine set to A is a real mistake a user can make, and the one thing
  // gEdit must not do about it is change the setting: `G92 S2200` would then be a thread
  // cut at 2200 rpm instead of the spindle clamp it is.
  //
  // The machine is made the **default for the dialect** rather than picked, for two
  // reasons: it is the way a user meets this (the default reaches a document nobody set up
  // by hand), and picking would put "… now uses machine Lathe IS-B" in the status bar on
  // top of the warning, so the scenario would be racing two messages for one line.
  await machines.setDefault(LATHE, 'lathe-is-b')
  await h.idle()
  ctx.status.clear()
  await h.waitFor(() => (h.q('status-message')?.textContent?.trim() ?? '') === '', { timeout: 5000 })

  const systemB = await openFixture(h, 'nc/fanuc-lathe/l05-system-b.nc')
  // Waited on `data-choice`, not on the machine id: the document that was active a moment
  // ago already had this very machine picked for it, so waiting for the id would match
  // before the new document is on screen at all.
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === systemB.id, { timeout: 10000 })
  await h.waitFor(() => machineItem(h)?.dataset.choice === 'default', { timeout: 8000 })
  await h.idle()
  h.check('a document nobody set up gets the dialect’s default machine', machineText(h) === 'Machine: Lathe IS-B' && machineItem(h)?.dataset.choice === 'default', {
    text: machineText(h),
    choice: machineItem(h)?.dataset.choice,
  })
  const warning = h.q('status-message')?.textContent?.trim() ?? ''
  h.check(
    'the disagreement is reported, naming what was read, what is set and that nothing changed',
    warning.includes('G-code system') && warning.includes('"B"') && warning.includes('"A"') && warning.includes('Nothing was changed'),
    warning,
  )
  h.check('and the machine wins: the document is read as system A, set by the machine', tooltipLine(h, 'G-code system') === 'G-code system: G-code system A — set by the machine', tooltipLine(h, 'G-code system'))

  // Once per document, not once per render: the item re-reads on every revision bump.
  ctx.status.clear()
  await h.waitFor(() => (h.q('status-message')?.textContent?.trim() ?? '') === '', { timeout: 5000 })
  ctx.docs.activate(lathe.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === lathe.id, { timeout: 8000 })
  ctx.docs.activate(systemB.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === systemB.id, { timeout: 8000 })
  await h.idle()
  h.check('and it is said once, not on every look at the document', (h.q('status-message')?.textContent?.trim() ?? '') === '', h.q('status-message')?.textContent?.trim())

  await machines.setDefault(LATHE, null)
  await h.idle()
})
