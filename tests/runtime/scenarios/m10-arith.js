// Address arithmetic in the running app (plan §6 M10 H10 `m10-arith`, WP10.4; X8, X11 c;
// roadmap R8 as the owner accepted it on 2026-10-01 and the prelude P10 built it).
//
// **A shift that moves a hole depth wrongly scraps a part.** So two things are asked of every
// block, and a third is never allowed:
//
//   - a word the script can judge moves by exactly the operand, in the word's own form;
//   - a block it cannot judge is left as written **and listed** (R8: a cycle parameter
//     without the tool-axis role, `CYCL CALL POS`, a machine position, a block in a tilted
//     frame, a simultaneous rotary move without tool centre point control, a mode argument);
//   - **a block is never changed in part.** `outcomeOf` names the result of a cycle block
//     `unchanged`, `moved` or `partial`; `partial` fails whatever else is true.
//
// **Where the decision says "move", the scenario demands the move.** R8's drilling cycles
// are Fanuc mill `R`, Klartext `Q203`, Sinumerik `RTP`/`RFP`/`DP`/`FDEP`
// (`tests/fixtures/codes/positions.json` is the list); a plain `G81`, a `CYCL DEF 200` and a
// plain `CYCLE81(…)` call must move, all four parameters of a `CYCLE83` with them. Where
// the prelude says refuse - `CYCL CALL POS`, `CYCLE800` and the blocks in its frame, the
// lathe's own cycles, `M91`, `G75`, `G28` - the scenario demands the block as written and
// a finding on its line. Two forms are left to the script with either answer allowed, and
// the choice is logged: a modal `MCALL CYCLE83(…)` and the block after a Sinumerik cycle
// call. Whatever it chooses, it may not do half.
//
// **The first half is X11 c.** `l06-decimal.nc` under "Lathe IS-B", "Lathe calc" and no
// machine: `Z1000` is 1 mm, 1000 mm, or not known; `Z10.` is 10 mm on all three.
//
// The finding `reason` ids and the hidden members of an envelope come from the Output
// panel's structured result (`m10-common.js`, point 4); the vocabulary is the one in
// `tests/fixtures/scripts/address_arithmetic/README.md`.

import { scenario } from '../lib/index.js'
import {
  FANUC_LATHE,
  FANUC_MILL,
  KLARTEXT,
  OKUMA,
  OPERATIONS,
  SCRIPTS,
  SINUMERIK_MILL,
  bump,
  canon,
  context,
  differences,
  fillForm,
  guard,
  linesOfText,
  lineWith,
  machineMaker,
  openPath,
  openProbe,
  outcomeOf,
  pick,
  ready,
  runReplace,
  textOf,
  undo,
} from './m10-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */
/** @typedef {{ line: number, severity?: string, message?: string, reason?: string }} Finding */

scenario('m10-arith', { timeout: 720 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const maker = machineMaker(h)

  /**
   * Runs address arithmetic on the active document.
   * @param {string} operation
   * @param {number} operand
   * @param {string[]} addresses
   * @param {Record<string, unknown>} [extra]
   * @returns {Promise<{ envelope: any, findings: Finding[], message: string }>}
   */
  const arithmetic = async (operation, operand, addresses, extra = {}) => {
    const { envelope } = await runReplace(h, SCRIPTS.arithmetic, () => fillForm(h, { operation: pick(operation, OPERATIONS.indexOf(operation)), operand, addresses, ...extra }))
    return { envelope, findings: /** @type {Finding[]} */ (envelope?.findings ?? []), message: String(envelope?.message ?? '') }
  }

  /** The reasons a finding on `line` carries. @param {Finding[]} findings @param {number} line */
  const reasonsAt = (findings, line) => findings.filter((f) => f.line === line).map((f) => f.reason)

  /**
   * One cycle block against the three results (point 3 of the header).
   * @param {string} label
   * @param {number} line 1-based
   * @param {string[]} before
   * @param {string[]} after
   * @param {string} wanted the block as it reads when it moves
   * @param {Finding[]} findings
   * @param {{ allowRefuse: boolean, reason?: string }} o
   */
  const judge = (label, line, before, after, wanted, findings, o) => {
    const result = outcomeOf(before[line - 1], after[line - 1], wanted)
    const listed = findings.some((f) => f.line === line)
    const reasonOk = o.reason === undefined || reasonsAt(findings, line).includes(o.reason)
    h.log(`${label}: line ${line} ${result}${listed ? `, listed (${reasonsAt(findings, line).join(',')})` : ''}`)
    const ok = result === 'moved' || (o.allowRefuse && result === 'unchanged' && listed && reasonOk)
    h.check(
      `${label}: ${o.allowRefuse ? 'moved, or left as written and listed - never in part' : 'moved'}`,
      ok,
      { line, was: before[line - 1], got: after[line - 1], want: wanted, result, listed, reasons: reasonsAt(findings, line) },
    )
  }

  /**
   * A block that must come back as written, with a finding on its line.
   * @param {string} label
   * @param {number} line
   * @param {string[]} before
   * @param {string[]} after
   * @param {Finding[]} findings
   * @param {string} [reason] the vocabulary id the README gives
   */
  const refused = (label, line, before, after, findings, reason) => {
    const listed = findings.some((f) => f.line === line)
    const reasonOk = reason === undefined || reasonsAt(findings, line).includes(reason)
    h.check(`${label}: left as written and listed${reason ? ` (${reason})` : ''}`, line > 0 && after[line - 1] === before[line - 1] && listed && reasonOk, { line, was: before[line - 1], got: after[line - 1], reasons: reasonsAt(findings, line) })
  }

  // =============================================================== 0. the plumbing, proved on a Phase 1 replace script
  //
  // `scale_feed` has shipped since M4, has a form with a number field and returns an
  // envelope, so this part passes whether or not address arithmetic is there; a failure
  // further down that this section did not share is the script's, not the harness's.
  await guard(h, '0. the plumbing', async () => {
    const program = ['%', 'O5400 (PLUMBING)', 'G21 G17 G90 G94', 'T1 M6', 'S3000 M3', 'G0 X0. Y0.', 'G1 Z-2. F200.', 'X40. F300.', 'M30', '%', ''].join('\n')
    const id = await openProbe(h, 'PROBE_PLUMBING.NC', program, FANUC_MILL).then((opened) => opened.id)
    const original = linesOfText(textOf(h, id))
    const { envelope } = await runReplace(h, 'bundled:scale_feed.py', () => fillForm(h, { percent: 90, decimals: pick('As', 0) }))
    const after = linesOfText(textOf(h, id))
    h.check('the plumbing: a form filled with fillForm reaches the script and the envelope is read back from the Output panel', typeof envelope?.text === 'string' && envelope.text.includes('F180.') && Array.isArray(envelope.findings ?? []), envelope && { keys: Object.keys(envelope), message: envelope.message })
    h.check('and the document holds the same text: F200. is F180. and F300. is F270.', after[6] === 'G1 Z-2. F180.' && after[7] === 'X40. F270.' && after.filter((line, i) => line !== original[i]).length === 2, after)
    await undo(h)
    h.check('and one undo takes it back', JSON.stringify(linesOfText(textOf(h, id))) === JSON.stringify(original), linesOfText(textOf(h, id)))

    // The machines the lathe sections use are made and picked here, so a machine that cannot be
    // made or picked fails once and by name, not in every section that needs it.
    await maker.add('Lathe IS-B', FANUC_LATHE, 'is-b')
    await maker.add('Lathe calc', FANUC_LATHE, 'calculator')
    const lathe = await openProbe(h, 'PROBE_PLUMBING_L.NC', ['G21 G99', 'G00 X50. Z10.', 'M30', ''].join('\n'), FANUC_LATHE)
    await maker.use('Lathe IS-B')
    h.check('the plumbing: a machine made through the service is picked for a lathe document, and the status item shows it', ctx.docs.get(lathe.id)?.profileId === FANUC_LATHE && h.q('status-item', { item: 'machine' })?.dataset.machineId === maker.ids['Lathe IS-B'], h.q('status-item', { item: 'machine' })?.dataset.machineId)
    await maker.use('Lathe calc')
    await maker.none()
    h.check('and "None" takes it away again', h.q('status-item', { item: 'machine' })?.dataset.machineId === '', h.q('status-item', { item: 'machine' })?.dataset.machineId)
  })

  // =============================================================== A. X11 c: Z 0.5 less on a lathe, three machines
  await guard(h, 'A. the decimal point', async () => {
    const opened = await openPath(h, await h.fixture('nc/fanuc-lathe/l06-decimal.nc'))
    const id = opened.id
    h.check('l06-decimal.nc opens as a Fanuc lathe program', ctx.docs.get(id)?.profileId === FANUC_LATHE, ctx.docs.get(id)?.profileId)
    const original = linesOfText(textOf(h, id))
    const L = {
      pointless: 'G00 X50 Z1000',
      pointlessCut: 'G01 Z-10 F155',
      pointed: 'G00 X50. Z1000.',
      pointedCut: 'G01 Z-10. F155.',
      far: 'G00 X100. Z100. T0100',
      home: 'G00 X100. Z100. T0500',
    }
    const at = Object.fromEntries(Object.entries(L).map(([key, text]) => [key, original.indexOf(text) + 1]))
    h.check('the lines the plan names are there: Z1000, Z-10 and their pointed twins', Object.values(at).every((n) => n > 0), at)
    const drills = original.map((line, i) => (/^G83 /.test(line) ? i + 1 : 0)).filter((n) => n > 0)
    h.check('and two G83 drilling cycles', drills.length === 2, drills)
    const ambiguous = original.map((line, i) => (/ C90/.test(line) ? i + 1 : 0)).filter((n) => n > 0)

    /** @type {{ name: string | null, words: Record<string, string>, sentence: RegExp }[]} */
    const machines = [
      { name: 'Lathe IS-B', words: { [L.pointless]: 'G00 X50 Z500', [L.pointlessCut]: 'G01 Z-510 F155' }, sentence: /Machine 'Lathe IS-B'/ },
      { name: 'Lathe calc', words: { [L.pointless]: 'G00 X50 Z999.5', [L.pointlessCut]: 'G01 Z-10.5 F155' }, sentence: /Machine 'Lathe calc'/ },
      { name: null, words: {}, sentence: /No machine/ },
    ]
    for (const { name, words, sentence } of machines) {
      if (name === null) await maker.none()
      else await maker.use(name)
      const label = name ?? 'no machine'
      const { findings, message } = await arithmetic('subtract', 0.5, ['Z'])
      const after = linesOfText(textOf(h, id))
      /** @type {Record<string, string>} */
      const map = {
        ...words,
        [L.pointed]: 'G00 X50. Z999.5',
        [L.pointedCut]: 'G01 Z-10.5 F155.',
        [L.far]: 'G00 X100. Z99.5 T0100',
        [L.home]: 'G00 X100. Z99.5 T0500',
      }
      const wanted = original.map((line, i) => (ambiguous.includes(i + 1) ? after[i] : (map[line] ?? line)))
      const wrong = differences(original, after, wanted)
      h.check(`${label}: Z less 0.5 - Z1000 is ${words[L.pointless] ?? 'left alone'}, Z10. is Z9.5, the rest as the plan says`, wrong.length === 0, wrong.slice(0, 6))
      h.check(`${label}: both G83 face-drilling cycles are left as written and listed: a lathe's own cycle has no tool-axis role`, drills.every((n) => after[n - 1] === original[n - 1] && findings.some((f) => f.line === n)), drills.map((n) => ({ n, got: after[n - 1], reasons: reasonsAt(findings, n) })))
      h.check(`${label}: the report ends with the machine: ${sentence}`, sentence.test(message), message)
      if (name === null) {
        const pointless = [at.pointless, at.pointlessCut]
        h.check('with no machine the point-less words are reported - "the reading depends on the machine; choose a machine"', pointless.every((n) => findings.some((f) => f.line === n && f.reason === 'machine-dependent' && /choose a machine/.test(String(f.message)))), pointless.map((n) => findings.filter((f) => f.line === n)))
      } else {
        h.check(`${label}: no word is reported for the machine's sake: the reading is known`, !findings.some((f) => f.reason === 'machine-dependent'), findings.filter((f) => f.reason === 'machine-dependent'))
      }
      await undo(h)
      h.check(`${label}: one undo takes the run back`, JSON.stringify(linesOfText(textOf(h, id))) === JSON.stringify(original), linesOfText(textOf(h, id)).slice(8, 14))
    }

    // ---- IS-B rounds: Z1000 + 0.0005 is 1.0005 mm, a whole number of 0.001 mm is 1001 half away from zero
    await maker.use('Lathe IS-B')
    const rounding = await arithmetic('add', 0.0005, ['Z'])
    const rounded = linesOfText(textOf(h, id))
    h.check('IS-B: Z1000 + 0.0005 is Z1001 (rounded half away from zero) and the rounding is reported', rounded[at.pointless - 1].includes('Z1001') && rounding.findings.some((f) => f.line === at.pointless && f.reason === 'rounded'), { line: rounded[at.pointless - 1], findings: rounding.findings.filter((f) => f.line === at.pointless) })
    await undo(h)
  })

  // =============================================================== B. W reported; Okuma 10 µm
  await guard(h, 'B. W words and Okuma', async () => {
    await maker.add('Lathe U W', FANUC_LATHE, 'calculator', { variants: { incrementalAddresses: 'uw' } })
    const lathe = await openProbe(h, 'PROBE_UW.NC', ['G21 G99', 'G00 X50. Z10.', 'G01 W-5. F0.1', 'G01 Z-2. F0.1', 'M30', ''].join('\n'), FANUC_LATHE)
    await maker.use('Lathe U W')
    const original = linesOfText(textOf(h, lathe.id))
    const { findings } = await arithmetic('subtract', 0.5, ['Z'])
    const after = linesOfText(textOf(h, lathe.id))
    h.check('a lathe Z less 0.5 moves both Z words and leaves the W word, which is a distance from where the tool is', after[1] === 'G00 X50. Z9.5' && canon(after[3]) === canon('G01 Z-2.5 F0.1') && after[2] === original[2], after)
    h.check('and reports the W word as an incremental word skipped', findings.some((f) => f.line === 3 && f.reason === 'incremental'), findings)
    await undo(h)

    await maker.add('Okuma 10 um', OKUMA, 'okuma-10um')
    const okuma = await openProbe(h, 'PROBE10.MIN', ['G00 X10000 Z1000', 'G01 Z10. F100', 'M30', ''].join('\n'), OKUMA)
    await maker.use('Okuma 10 um')
    const plainLines = linesOfText(textOf(h, okuma.id))
    await arithmetic('subtract', 0.5, ['Z'])
    const now = linesOfText(textOf(h, okuma.id))
    h.check('an Okuma 10 µm machine: Z1000 less 0.5 is Z950', now[0].includes('Z950') && now[0] !== plainLines[0], now[0])
    h.check('and Z10. less 0.5 is Z-40.: the unit scales a word with a point too', canon(now[1]) === canon('G01 Z-40. F100'), now[1])
    await undo(h)
  })

  // =============================================================== C. R8 on the Fanuc mill
  await guard(h, 'C. Fanuc mill', async () => {
    const opened = await openPath(h, await h.fixture('nc/fanuc/f01-mill-3tools.nc'))
    const id = opened.id
    h.check('f01-mill-3tools.nc opens as a Fanuc mill program', ctx.docs.get(id)?.profileId === FANUC_MILL, ctx.docs.get(id)?.profileId)
    const original = linesOfText(textOf(h, id))
    const { findings } = await arithmetic('add', 1, ['Z'])
    const after = linesOfText(textOf(h, id))
    const wanted = original.map((line) => {
      if (/\bG28\b|\bG53\b/.test(line)) return line
      const moved = bump(line, 'paren', 'Z', 1)
      return /\bG8[1-9]\b/.test(line) ? bump(moved, 'paren', 'R', 1) : moved
    })
    const wrong = differences(original, after, wanted)
    h.check('Z up by 1: every absolute Z moves, the R of G81, G83 and G84 with it (R8: the retract plane is a position on the tool axis), nothing else changes', wrong.length === 0, wrong.slice(0, 6))
    const drills = original.map((line, i) => (/\bG8[134]\b.*\bR\d/.test(line) ? i + 1 : 0)).filter((n) => n > 0)
    h.check('and there are three such cycle blocks in the program', drills.length === 3, drills)
    for (const n of drills) judge(`${original[n - 1]}`, n, original, after, wanted[n - 1], findings, { allowRefuse: false })
    const machine = original.map((line, i) => (/\bG28\b/.test(line) ? i + 1 : 0)).filter((n) => n > 0)
    for (const n of machine) refused(`${original[n - 1]} (a machine position)`, n, original, after, findings, 'machine-position')
    await undo(h)
    h.check('one undo', JSON.stringify(linesOfText(textOf(h, id))) === JSON.stringify(original))

    // ---- multiply: a count and an arc centre are not what a scale moves
    const probe = await openProbe(h, 'PROBE_K.NC', ['G21 G90 G94', 'G17 G2 X10. Y10. I5. J0. F100.', 'G81 X10. Y10. Z-5. R2. K3 F100.', 'G80', 'M30', ''].join('\n'), FANUC_MILL)
    const before = linesOfText(textOf(h, probe.id))
    await arithmetic('multiply', 2, ['X', 'Z'])
    const scaled = linesOfText(textOf(h, probe.id))
    h.check('multiply by 2 on a G81 … K3 block leaves K3 alone: a repeat count is not a position', /\bK3\b/.test(scaled[2]) && canon(scaled[2]).includes('X20'), { was: before[2], got: scaled[2] })
    await undo(h)
  })

  // =============================================================== D. R8 on Klartext
  await guard(h, 'D. Klartext', async () => {
    const opened = await openPath(h, await h.fixture('nc/heidenhain/h04-cycle-feeds.h'))
    const id = opened.id
    h.check('h04-cycle-feeds.h opens as Klartext', ctx.docs.get(id)?.profileId === KLARTEXT, ctx.docs.get(id)?.profileId)
    const original = linesOfText(textOf(h, id))
    const { findings } = await arithmetic('add', 1, ['Z'])
    const after = linesOfText(textOf(h, id))
    const wanted = original.map((line) => {
      const moved = bump(line, 'star', 'Z', 1)
      return moved.replace(/(Q203=)([+-]?\d+(?:\.\d*)?)(?=\s|~|$)/, (_all, head, number) => `${head}${Math.round((Number(number) + 1) * 1e6) / 1e6}`)
    })
    const wrong = differences(original, after, wanted)
    h.check('Z up by 1: Q203 (the surface coordinate) of the cycles and every Z word of the L blocks move, TOOL CALL 6 Z S2000 does not, no other Q changes', wrong.length === 0, wrong.slice(0, 6))
    const surface = original.map((line, i) => (/Q203=/.test(line) ? i + 1 : 0)).filter((n) => n > 0)
    h.check('there are three Q203 lines (cycles 200, 200 and 207)', surface.length === 3, surface)
    for (const n of surface) judge(`${original[n - 1].trim()}`, n, original, after, wanted[n - 1], findings, { allowRefuse: false })
    await undo(h)

    // ---- CYCL CALL POS and M91
    const probe = await openProbe(
      h,
      'PROBE_POS.H',
      [
        '0 BEGIN PGM POS MM',
        '1 TOOL CALL 1 Z S2000',
        '2 L Z+100 R0 FMAX M3',
        '3 CYCL DEF 200 DRILLING ~',
        '   Q200=2 ~',
        '   Q201=-10 ~',
        '   Q206=150 ~',
        '   Q202=5 ~',
        '   Q210=0 ~',
        '   Q203=+0 ~',
        '   Q204=50 ~',
        '   Q211=0 ~',
        '   Q395=0',
        '4 CYCL CALL POS X+10 Y+10 Z+0 FMAX M3',
        '5 L Z+0 R0 FMAX M91',
        '6 L Z+100 R0 FMAX M9',
        '7 END PGM POS MM',
        '',
      ].join('\n'),
      KLARTEXT,
    )
    const before = linesOfText(textOf(h, probe.id))
    const result = await arithmetic('add', 1, ['Z'])
    const now = linesOfText(textOf(h, probe.id))
    const callLine = lineWith(before, 'CYCL CALL POS')
    const m91Line = lineWith(before, 'M91')
    refused('CYCL CALL POS X+10 Y+10 Z+0: its tool-axis coordinate acts on top of Q203, so it is not moved on its own', callLine, before, now, result.findings, 'cycle-position')
    refused('L Z+0 R0 FMAX M91 (a machine coordinate)', m91Line, before, now, result.findings, 'machine-position')
    const plain = [lineWith(before, '2 L Z+100'), lineWith(before, '6 L Z+100')]
    h.check('the plain L blocks move: Z+100 is Z+101', plain.every((n) => canon(now[n - 1]) === canon(bump(before[n - 1], 'star', 'Z', 1))), plain.map((n) => now[n - 1]))
    const q = lineWith(before, 'Q203')
    const qResult = outcomeOf(before[q - 1], now[q - 1], before[q - 1].replace('+0', '+1'))
    h.log(`the Q203 of the cycle in front of a CYCL CALL POS: ${qResult}`)
    h.check('the surface coordinate of the cycle is moved or listed, never in part', qResult !== 'partial', { was: before[q - 1], got: now[q - 1] })
    h.check('and no other parameter of the definition changed', before.every((line, i) => i === q - 1 || !/Q\d+=/.test(line) || now[i] === line), now.slice(3, 13))
    await undo(h)
  })

  // =============================================================== E. R8 on Sinumerik milling
  await guard(h, 'E. Sinumerik milling', async () => {
    // ---- the plate: CYCLE83 under MCALL, a cycle the database lacks, plain Z words
    const plate = await openPath(h, await h.fixture('nc/sinumerik-mill/m01-plate.MPF'))
    h.check('m01-plate.MPF opens as the Sinumerik milling profile', ctx.docs.get(plate.id)?.profileId === SINUMERIK_MILL, ctx.docs.get(plate.id)?.profileId)
    const before = linesOfText(textOf(h, plate.id))
    const { findings } = await arithmetic('add', 1, ['Z'])
    const after = linesOfText(textOf(h, plate.id))
    const mcall = lineWith(before, 'MCALL CYCLE83(')
    const cycle61 = lineWith(before, 'CYCLE61(')
    /** @param {string} line */
    const shiftCycle83 = (line) =>
      line.replace(/CYCLE83\(([^)]*)\)/, (_all, args) => {
        const parts = String(args).split(',')
        for (const index of [0, 1, 3, 5]) if (parts[index] !== undefined && parts[index].trim() !== '') parts[index] = String(Math.round((Number(parts[index]) + 1) * 1e6) / 1e6)
        return `CYCLE83(${parts.join(',')})`
      })
    const wanted = before.map((line, i) => (i + 1 === mcall ? shiftCycle83(line) : bump(line, 'semicolon', 'Z', 1)))
    const skip = new Set([mcall, cycle61])
    const wrong = differences(
      before,
      after,
      wanted.map((line, i) => (skip.has(i + 1) ? after[i] : line)),
    )
    h.check('Z up by 1 on the plate: every Z word moves (Z5 is Z6, G1 Z-4 is Z-3, G0 Z50 is Z51) and no other line changes', wrong.length === 0, wrong.slice(0, 6))
    judge('MCALL CYCLE83(5,0,2,-18,,-5,,2,0,0.5,1,0): RTP, RFP, DP and FDEP', mcall, before, after, wanted[mcall - 1], findings, { allowRefuse: true })
    refused('CYCLE61(…), a cycle with absolute positions and no role (R8: refuse and list)', cycle61, before, after, findings)
    await undo(h)

    // ---- the five-axis program: CYCLE800 is a frame, TRAORI is not
    const five = await openPath(h, await h.fixture('nc/sinumerik-mill/m02-five-axis.MPF'))
    h.check('m02-five-axis.MPF opens as the Sinumerik milling profile', ctx.docs.get(five.id)?.profileId === SINUMERIK_MILL, ctx.docs.get(five.id)?.profileId)
    const fiveBefore = linesOfText(textOf(h, five.id))
    const n = (/** @type {string} */ label) => lineWith(fiveBefore, new RegExp(`^${label}\\b`))
    const inFrame = ['N140', 'N150', 'N170'].map(n)
    const underTcp = ['N260', 'N270', 'N280', 'N290'].map(n)
    h.check('the program has what the checks need: three Z blocks in the swivelled plane, four under TRAORI', inFrame.every((x) => x > 0) && underTcp.every((x) => x > 0) && n('N210') > 0, { inFrame, underTcp })
    const first = await arithmetic('add', 1, ['Z'])
    const fiveAfter = linesOfText(textOf(h, five.id))
    for (const line of inFrame) refused(`${fiveBefore[line - 1]} (inside the CYCLE800 frame)`, line, fiveBefore, fiveAfter, first.findings, 'frame')
    for (const line of underTcp) h.check(`${fiveBefore[line - 1]}: under TRAORI the Z is the tool tip in the workpiece, so it moves, rotary words and all (decision 2: TRAORI is no frame)`, canon(fiveAfter[line - 1]) === canon(bump(fiveBefore[line - 1], 'semicolon', 'Z', 1)), { was: fiveBefore[line - 1], got: fiveAfter[line - 1], reasons: reasonsAt(first.findings, line) })
    refused(`${fiveBefore[n('N40') - 1]} (a fixed machine point)`, n('N40'), fiveBefore, fiveAfter, first.findings, 'machine-position')
    refused(`${fiveBefore[n('N330') - 1]} (a fixed machine point)`, n('N330'), fiveBefore, fiveAfter, first.findings, 'machine-position')
    const wantedAll = fiveBefore.map((line, i) => (underTcp.includes(i + 1) ? bump(line, 'semicolon', 'Z', 1) : line))
    const wrongFive = differences(fiveBefore, fiveAfter, wantedAll)
    h.check('and nothing else changed in the whole program', wrongFive.length === 0, wrongFive.slice(0, 6))
    await undo(h)

    // ---- the same program with TRAORI left out: the rotary moves are no longer judged
    const text = fiveBefore.join('\n').replace(/^N210 TRAORI$/m, 'N210 ; TRAORI LEFT OUT') + '\n'
    const bare = await openProbe(h, 'PROBE_NOTCP.MPF', text, SINUMERIK_MILL)
    const bareBefore = linesOfText(textOf(h, bare.id))
    const second = await arithmetic('add', 1, ['Z'])
    const bareAfter = linesOfText(textOf(h, bare.id))
    // M10 review (NC-4): a rotary position stays in force after the block that wrote it, so
    // the Z alone at N290 is still a machine pivot position while A stands at 12; N260 ends at
    // A0 C0, where Z is a height above the part again, and moves.
    for (const line of [n('N270'), n('N280')]) refused(`${bareBefore[line - 1]} (X Y Z and the rotary axes together, tool centre point control off)`, line, bareBefore, bareAfter, second.findings, 'rotary-without-tcp')
    refused(`${bareBefore[n('N290') - 1]} (Z alone while A stands turned, tool centre point control off)`, n('N290'), bareBefore, bareAfter, second.findings, 'rotary-without-tcp')
    h.check('N260 ends at A0 C0, where Z is a height above the part, and moves', canon(bareAfter[n('N260') - 1]) === canon(bump(bareBefore[n('N260') - 1], 'semicolon', 'Z', 1)), bareAfter[n('N260') - 1])
    await undo(h)

    // ---- a plain call, and one with a mode argument
    const probe = await openProbe(
      h,
      'PROBE_C81.MPF',
      ['%_N_PROBE_C81_MPF', 'N10 G17 G90 G94', 'N20 T="DRILL" D1', 'N30 M6', 'N40 S2000 M3', 'N50 G0 X10 Y10', 'N60 G0 Z20', 'N70 CYCLE81(10,0,2,-12)', 'N80 CYCLE81(10,0,2,-12,0,0,0,0,1)', 'N90 G0 Z50', 'N100 M30', ''].join('\n'),
      SINUMERIK_MILL,
    )
    const cBefore = linesOfText(textOf(h, probe.id))
    const third = await arithmetic('add', 1, ['Z'])
    const cAfter = linesOfText(textOf(h, probe.id))
    const l = (/** @type {string} */ label) => lineWith(cBefore, new RegExp(`^${label}\\b`))
    h.check('a plain G0 Z20 moves', canon(cAfter[l('N60') - 1]) === canon('N60 G0 Z21'), cAfter[l('N60') - 1])
    judge('CYCLE81(10,0,2,-12): RTP, RFP and DP move, SDIS does not', l('N70'), cBefore, cAfter, 'N70 CYCLE81(11,1,2,-11)', third.findings, { allowRefuse: false })
    refused('CYCLE81(10,0,2,-12,0,0,0,0,1): _AMODE is 1, a mode the script cannot judge', l('N80'), cBefore, cAfter, third.findings, 'cycle-mode')
    judge('G0 Z50 after the cycle call', l('N90'), cBefore, cAfter, 'N90 G0 Z51', third.findings, { allowRefuse: true })
    await undo(h)
  })
})
