// Phase 2 exit criterion X8, "Checks and transformations" (plan §2.2; `tests/fixtures/exit2/README.md`, X8).
//
// Four deliberately wrong programs, `checks-mill.nc`, `checks-lathe.nc`, `checks-okuma.MIN` and
// `checks-sinumerik.MPF`. `program_checks` and `extents` return the golden reports, each run with the
// machine its golden names (`none`, `X8 Lathe IS-B`, `X8 Okuma 1um`); with none, a word whose reading
// depends on the machine is listed as not resolved and the header says so; every row with a line
// jumps to it. Address arithmetic `Z - 0.5` on the lathe program (no machine) changes only the
// absolute `Z` words written with a decimal point and reports the `W` words and the point-less `Z`.
// Block skip insert and remove on the selection of lines 18-23 of the mill program are one undo step
// each. The two machines are removed at the end of the scenario, and the edited programs are saved
// and compared with the golden bytes.

import { scenario } from '../lib/index.js'
import { selectLines } from './m4-common.js'
import { OPERATIONS, SCRIPTS, fillForm, pick, runFromTools, runReplace } from './m10-common.js'
import {
  activate,
  checkStoredReport,
  context,
  everyRowJumps,
  exitDir,
  expectNoPython,
  firstDifference,
  gold,
  goldText,
  machineItem,
  machineText,
  machinesNow,
  makeMachine,
  message,
  openIn,
  read,
  ready,
  removeMachine,
  textNow,
  undo,
  useMachine,
  useNone,
} from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The programs with the machine variants of their goldens. */
const PROGRAMS = [
  { file: 'checks-mill.nc', key: 'checks-mill', machines: ['none'] },
  { file: 'checks-lathe.nc', key: 'checks-lathe', machines: ['none', 'x8-lathe-is-b'] },
  { file: 'checks-okuma.MIN', key: 'checks-okuma', machines: ['none', 'x8-okuma-1um'] },
  { file: 'checks-sinumerik.MPF', key: 'checks-sinumerik', machines: ['none'] },
]

/**
 * Runs a block-skip command over the selection, answering its form as it opens.
 * @param {Harness} h
 * @param {string} commandId
 */
async function runSkip(h, commandId) {
  const running = context(h).commands.run(commandId)
  const first = await Promise.race([running.then(() => 'done'), h.waitFor(() => h.q('modal'), { timeout: 8000 }).then((m) => (m ? 'form' : 'timeout'))])
  if (first === 'form') {
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  }
  await running
  await h.idle()
}

/**
 * X8 over the four programs.
 * @param {Harness} h
 * @param {{ noPython?: boolean }} [o]
 */
export async function runX8(h, { noPython = false } = {}) {
  const ctx = context(h)
  await ready(h)
  const dir = await exitDir(h)
  /** @type {Record<string, { id: string, path: string }>} */
  const files = {}
  for (const p of PROGRAMS) files[p.file] = await openIn(h, dir, p.file)
  /** @type {Record<string, string>} */
  const inputs = {}
  for (const p of PROGRAMS) inputs[p.file] = await h.disk.read(files[p.file].path)
  h.check('the four programs open on their own profiles', ['fanuc-gcode', 'fanuc-lathe', 'okuma-osp', 'sinumerik'].every((id, i) => ctx.docs.get(files[PROGRAMS[i].file].id)?.profileId === id), PROGRAMS.map((p) => ctx.docs.get(files[p.file].id)?.profileId))

  /** @type {Record<string, { id: string, name: string }>} */
  const made = {}
  // ============================================================ program checks and extents
  for (const p of PROGRAMS) {
    const { id } = files[p.file]
    await activate(h, id)
    for (const variant of p.machines) {
      const findingsGold = await gold(h, dir, `${p.key}.findings.${variant}.json`)
      const extentsGold = await gold(h, dir, `${p.key}.extents.${variant}.json`)
      const label = `${p.file} / ${variant}`
      if (variant === 'none') {
        await useNone(h)
      } else {
        const spec = findingsGold.machine
        if (!made[spec.name]) made[spec.name] = { id: await makeMachine(h, spec), name: spec.name }
        await useMachine(h, made[spec.name].id, spec.name)
      }
      h.check(`${label}: the golden names ${variant === 'none' ? 'no machine' : findingsGold.machine.name}`, (variant === 'none') === (findingsGold.machine === null), findingsGold.machine?.name)
      const before = textNow(h)
      if (noPython) {
        await expectNoPython(h, SCRIPTS.checks, id, `${label}: program checks`, {})
        await expectNoPython(h, SCRIPTS.extents, id, `${label}: extents`, undefined)
        continue
      }
      await runFromTools(h, SCRIPTS.checks, () => {})
      checkStoredReport(h, findingsGold.report, `${label}: program checks`)
      if (variant === 'none' && p.key !== 'checks-sinumerik') {
        h.check(`${label}: with no machine the finding lists every reading`, /No machine/i.test(findingsGold.report.message), findingsGold.report.message)
      }
      await everyRowJumps(h, `${label}: program checks`)
      await runFromTools(h, SCRIPTS.extents, () => {})
      checkStoredReport(h, extentsGold.report, `${label}: extents`)
      if (variant === 'none' && /not resolved/.test(extentsGold.report.message)) {
        h.check(`${label}: with no machine the header says words are not resolved`, /not resolved/.test(String(/** @type {any} */ (read(context(h).results.current))?.message)), /** @type {any} */ (read(context(h).results.current))?.message)
      }
      await everyRowJumps(h, `${label}: extents`)
      h.check(`${label}: a report changes nothing`, textNow(h) === before && ctx.docs.get(id)?.dirty !== true, null)
    }
  }

  // ============================================================ address arithmetic Z - 0.5, no machine
  const lathe = files['checks-lathe.nc']
  await activate(h, lathe.id)
  await useNone(h)
  const arith = await gold(h, dir, 'checks-lathe.arith-z-0.5.none.report.json')
  const arithText = await goldText(h, dir, 'checks-lathe.arith-z-0.5.none.nc', noPython)
  if (noPython) {
    await expectNoPython(h, SCRIPTS.arithmetic, lathe.id, 'address arithmetic', { operation: 'subtract', operand: 0.5 })
  } else {
    const input = textNow(h)
    const { envelope } = await runReplace(h, SCRIPTS.arithmetic, () => fillForm(h, { operation: pick(arith.params.operation, OPERATIONS.indexOf(arith.params.operation)), operand: arith.params.operand, addresses: arith.params.addresses }))
    h.check('address arithmetic Z - 0.5 gives the golden document', textNow(h) === arithText.replace(/\r\n/g, '\n'), { diff: firstDifference(textNow(h), arithText) })
    h.check('and the golden summary', envelope?.message === arith.message, { got: envelope?.message, want: arith.message })
    const asRows = (/** @type {any[]} */ list) => (list ?? []).map((f) => `${f.line}|${f.severity}|${f.reason}|${f.message}`)
    h.check('and the golden findings, with the W words, the point-less Z2000, the frame and the cycles not reviewed', JSON.stringify(asRows(envelope?.findings)) === JSON.stringify(asRows(arith.findings)), { got: asRows(envelope?.findings), want: asRows(arith.findings) })
    const lines = textNow(h).split('\n')
    const was = input.split('\n')
    const changed = lines.map((l, i) => (l === was[i] ? null : i + 1)).filter((x) => x !== null)
    const zOnly = (/** @type {string} */ line) => line.replace(/(?<![A-Za-z0-9])Z-?\d*\.?\d*/gi, 'Z#')
    h.check('only Z words changed, each on a line that had one written with a decimal point; the W words and the point-less Z2000 are as written', changed.every((n) => zOnly(was[/** @type {number} */ (n) - 1]) === zOnly(lines[/** @type {number} */ (n) - 1]) && /(?<![A-Za-z0-9])Z-?\d*\.\d*/i.test(was[/** @type {number} */ (n) - 1])) && lines.some((l) => l.includes('Z2000')) && was.filter((l) => /(?<![A-Za-z0-9])W-?\d/.test(l)).every((l) => lines.includes(l) || /(?<![A-Za-z0-9])Z-?\d*\.\d*/i.test(l)), { changed })
    h.check('and the golden counts: 15 words on 15 blocks', changed.length === 15 && /in 15 words on 15 blocks/.test(arith.message), changed.length)
    await undo(h)
    h.check('one undo takes the run back', textNow(h) === input, firstDifference(textNow(h), input))
    await runReplace(h, SCRIPTS.arithmetic, () => fillForm(h, { operation: pick('subtract', 1), operand: 0.5, addresses: ['Z'] }))
    h.check('the run is applied again before the save', textNow(h) === arithText.replace(/\r\n/g, '\n'))
  }

  // ============================================================ block skip on the selection of lines 18 to 23
  const mill = files['checks-mill.nc']
  await activate(h, mill.id)
  const skip = await gold(h, dir, 'checks-mill.blockskip.json')
  const skipText = await goldText(h, dir, 'checks-mill.blockskip.nc')
  const millInput = textNow(h)
  await selectLines(h, skip.selection.startLine, skip.selection.endLine)
  await runSkip(h, 'nc.blockSkip.add')
  h.check('block skip insert on the selection gives the golden document', textNow(h) === skipText, { diff: firstDifference(textNow(h), skipText) })
  h.check(`and says "${skip.insert.status}"`, message(h).includes(skip.insert.status) || message(h) === skip.insert.status, message(h))
  await undo(h)
  h.check('one undo takes the insert back', textNow(h) === millInput, firstDifference(textNow(h), millInput))
  await selectLines(h, skip.selection.startLine, skip.selection.endLine)
  await runSkip(h, 'nc.blockSkip.add')
  await selectLines(h, skip.selection.startLine, skip.selection.endLine)
  await runSkip(h, 'nc.blockSkip.remove')
  h.check('block skip remove on the same selection gives the input back', skip.remove.givesTheInputBack && textNow(h) === millInput, firstDifference(textNow(h), millInput))
  h.check(`and says "${skip.remove.status}"`, message(h).includes(skip.remove.status), message(h))
  await undo(h)
  h.check('one undo of the remove gives the marked blocks back', textNow(h) === skipText, firstDifference(textNow(h), skipText))

  // ============================================================ the machines go, then the saved bytes
  for (const m of Object.values(made)) await removeMachine(h, m.id)
  h.check('the X8 machines are removed from machines.json', ((await machinesNow(h))?.machines ?? []).length === 0, await machinesNow(h))
  await activate(h, files['checks-okuma.MIN'].id)
  h.check('and the Okuma program, which used one, reads none again', machineItem(h)?.dataset.machineId === '' && machineText(h) === 'Machine: none (assumed)', machineText(h))
  for (const p of PROGRAMS) {
    const { id, path } = files[p.file]
    if (ctx.docs.get(id)?.dirty === true) {
      await activate(h, id)
      if ((await ctx.files.save(id)) !== true) throw new Error(`saving ${p.file} failed`)
      await h.idle()
    }
    const saved = await h.disk.read(path)
    const want =
      p.file === 'checks-mill.nc' ? skipText : p.file === 'checks-lathe.nc' ? arithText : inputs[p.file]
    h.check(`${p.file}: saved ${p.file === 'checks-mill.nc' ? 'with the golden block skip' : p.file === 'checks-lathe.nc' ? `as the golden of the last run${noPython ? ' (the input: an unedited document is never rewritten)' : ''}` : 'as its input, byte for byte'}`, saved === want, { diff: firstDifference(saved, want) })
  }
}

scenario('exit2-x8', { timeout: 900 }, async (h) => {
  await runX8(h)
})
