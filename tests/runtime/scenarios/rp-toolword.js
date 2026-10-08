// The tool word of M12.5 in the running app (plan §6 M12.5, decisions 1 and 5; WP-RP3).
//
// Three things changed what a `T` word means, and each is read off the program map (F7 and the
// map rows are the same outline) and the tool list, which must agree:
//
//   A. **A five-digit lathe `T` is read by its length** when no machine says otherwise: `T12012`
//      is tool 12 offset 012 (2 + 3), `T0101` is tool 1 offset 01. A machine can say the other
//      way - "3 + 2" reads `T12012` as tool 120 offset 12, "2 + 3" is the choice that reads
//      every length as two digits of tool and three of offset - and the choice moves the map.
//      The machine form offers four choices and pre-selects "By length", which is what a new
//      machine stores.
//   B. **A Siemens milling program with no `M6`** (a control whose builder makes `T` the change)
//      lists its `T` tools; a machine says which: "M6 loads the tool" makes `T` a preselect
//      again, "T changes the tool" lists them.
//
// **Every expected row is written out** from the committed outline goldens
// (`expected/outline/fanuc-lathe/variants/toolWord-byLength.json` for the lathe program) or from
// the program text below; the app is asked, never copied.

import { scenario } from '../lib/index.js'
import { closeSettings, machinesFile, openMachinesPage, pickMachine, waitForMachine } from './m6-common.js'
import { ready } from './m4-common.js'
import { choiceOf, saveMachineForm, startAdd } from './m8-common.js'
import { toolSegments } from './m10-common.js'
import { SINUMERIK_MILL, context, openProbe, reportRows, runScript } from './m9-common.js'

const LATHE = 'fanuc-lathe'

/** The program of the by-length golden: five-digit T, a pre-selected next tool, a G-cycle that carries a T. */
const GOLDEN = 'expected/outline/fanuc-lathe/variants/toolWord-byLength.json'

/** A Siemens milling program with no `M6` anywhere: the tools are changed by `T` (synthetic). */
const T_ONLY = [
  '%_N_TCHANGE_MPF',
  '; WRITTEN FOR GEDIT - SYNTHETIC, THE CHANGE IS THE T WORD',
  'N10 G17 G90 G94 G54',
  'N20 T5',
  'N30 G0 X0 Y0 Z50 S3000 M3',
  'N40 G1 Z-2 F300',
  'N50 G0 Z50',
  'N60 T7',
  'N70 G0 X10 Y10',
  'N80 G1 Z-2 F300',
  'N90 M30',
  '',
].join('\n')

/** The machine record a lathe machine stores, with its tool word. @param {string} toolWord */
const latheParams = (toolWord) => ({ numberInput: { mode: 'calculator', incrementMm: '0.001' }, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A', incrementalAddresses: 'uw', toolWord } })

scenario('rp-toolword', { timeout: 540 }, async (h) => {
  const ctx = context(h)
  const machines = /** @type {any} */ (ctx).machines
  await ready(h)
  const golden = JSON.parse(await h.disk.read(await h.fixture(GOLDEN)))
  const tools = /** @type {{ kind: string, line: number, tool: string }[]} */ (golden.items).filter((item) => item.kind === 'tool')
  const toolLines = tools.map((item) => item.line)

  /**
   * The tool items (line → tool word) the outline holds, once it holds `lines`.
   * @param {string} id
   * @param {number[]} lines
   */
  const toolsOf = async (id, lines) => {
    await h.waitFor(() => JSON.stringify(toolSegments(h, id).map((s) => s.line)) === JSON.stringify(lines), { timeout: 15000 })
    return Object.fromEntries(toolSegments(h, id).map((s) => [s.line, s.tool]))
  }

  // =============================================================== A. the lathe: no machine
  const doc = await openProbe(h, 'TOOLWORD.NC', `${golden.program.join('\n')}\n`, LATHE)
  h.check('the five-digit program is a Fanuc lathe program', ctx.docs.get(doc.id)?.profileId === LATHE, ctx.docs.get(doc.id)?.profileId)
  const none = await toolsOf(doc.id, toolLines)
  h.check(
    'with no machine the map lists the tools of the golden: T12000 M6 and T12012 are station 12 (2 + 3), T0101 is 01, the T5 of the G183 cycle is no tool',
    JSON.stringify(none) === JSON.stringify(Object.fromEntries(tools.map((t) => [t.line, t.tool]))) && none[3] === '12' && none[4] === '12' && none[6] === '01',
    { got: none, want: tools },
  )

  await runScript(h, 'bundled:tool_list.py', { form: true })
  await h.waitFor(() => h.qa('results-row').length >= 1, { timeout: 30000 })
  const listed = reportRows(h, ['tool']).map((row) => row.trim())
  h.check('and the tool list agrees: a row for T12, none for T120 or T12012', listed.some((row) => /^T?12$/.test(row)) && !listed.some((row) => /120|12012/.test(row)), listed)

  // =============================================================== B. the lathe: a machine says
  /** @type {Record<string, string>} */
  const ids = {}
  for (const choice of ['byLength', 'offset2', 'offset3']) {
    ids[choice] = await machines.add({ name: `Lathe ${choice}`, profile: LATHE, notes: '', params: latheParams(choice) })
  }
  await h.idle()

  await pickMachine(h, 'Lathe offset2')
  await waitForMachine(h, ids.offset2)
  const threeTwo = await h.waitFor(() => toolSegments(h, doc.id).find((s) => s.line === 4)?.tool === '120', { timeout: 15000 })
  const at32 = Object.fromEntries(toolSegments(h, doc.id).map((s) => [s.line, s.tool]))
  h.check('a machine set to 3 + 2 reads T12012 as tool 120 (offset 12)', !!threeTwo && at32[4] === '120', at32)
  h.check('and four-digit T0101 is still tool 01, offset 01', at32[6] === '01' && at32[8] === '05', at32)

  await pickMachine(h, 'Lathe offset3')
  await waitForMachine(h, ids.offset3)
  const twoThree = await h.waitFor(() => toolSegments(h, doc.id).find((s) => s.line === 4)?.tool === '12', { timeout: 15000 })
  const at23 = Object.fromEntries(toolSegments(h, doc.id).map((s) => [s.line, s.tool]))
  h.check('a machine set to 2 + 3 reads T12012 as tool 12', !!twoThree && at23[4] === '12', at23)
  h.check('and reads T0101 differently from the by-length default (offset 101, tool 0 - the reason it is never the default)', at23[6] !== '01', at23)

  await pickMachine(h, 'Lathe byLength')
  await waitForMachine(h, ids.byLength)
  const back = await toolsOf(doc.id, toolLines)
  h.check('a machine set to "by length" reads the program exactly as no machine does', JSON.stringify(back) === JSON.stringify(none), { got: back, want: none })

  // =============================================================== C. the machine form
  const page = await openMachinesPage(h)
  await startAdd(h, LATHE)
  const choice = choiceOf(h, 'variant.toolWord')
  h.check('the machine form offers four tool-word choices and pre-selects "By length"', choice.labels.length === 4 && /^By length/.test(choice.selected), choice)
  h.check('the others are the 3 + 2, last-digit and 2 + 3 readings', choice.labels.some((l) => /3 \+ 2/.test(l)) && choice.labels.some((l) => /2 \+ 3/.test(l)) && choice.labels.some((l) => /last digit/i.test(l)), choice.labels)
  await saveMachineForm(h, { name: 'Lathe form default' })
  const file = /** @type {any} */ (await machinesFile(h))
  const saved = file?.machines?.find((/** @type {any} */ m) => m.name === 'Lathe form default')
  h.check('a machine saved without touching it stores toolWord byLength', saved?.params?.variants?.toolWord === 'byLength', saved?.params?.variants)
  await closeSettings(h, page)

  // =============================================================== D. Siemens milling, T alone
  const mill = await openProbe(h, 'TCHANGE.MPF', T_ONLY, SINUMERIK_MILL)
  h.check('the Siemens milling program is read as milling', ctx.docs.get(mill.id)?.profileId === SINUMERIK_MILL, ctx.docs.get(mill.id)?.profileId)
  const tOnly = await toolsOf(mill.id, [4, 8])
  h.check('with no machine a program with no M6 lists its T tools: T5 on line 4 and T7 on line 8', tOnly[4] === '5' && tOnly[8] === '7', tOnly)

  const millIds = {
    m6: await machines.add({ name: 'Mill M6', profile: SINUMERIK_MILL, notes: '', params: { units: 'mm', diameter: 'off', variants: { toolChange: 'm6' } } }),
    t: await machines.add({ name: 'Mill T', profile: SINUMERIK_MILL, notes: '', params: { units: 'mm', diameter: 'off', variants: { toolChange: 't' } } }),
  }
  await h.idle()
  await pickMachine(h, 'Mill M6')
  await waitForMachine(h, millIds.m6)
  await h.waitFor(() => toolSegments(h, mill.id).length === 0, { timeout: 15000 })
  h.check('a machine whose tool change is M6 treats the same T words as preselects: no tool on the map', toolSegments(h, mill.id).length === 0, toolSegments(h, mill.id))
  await pickMachine(h, 'Mill T')
  await waitForMachine(h, millIds.t)
  const viaMachine = await toolsOf(mill.id, [4, 8])
  h.check('a machine whose tool change is T lists them again', viaMachine[4] === '5' && viaMachine[8] === '7', viaMachine)
})
