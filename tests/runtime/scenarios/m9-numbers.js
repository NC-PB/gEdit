// What a number is worth after M9, through a machine and a report script (plan §6 M9 H9
// `m9-numbers`, WP9.5a, WP9.4): the decimal-point and number-class cases the way
// `m6-machines-select` and `m8-okuma-units` take them, and the `U`/`W` choice and the `T`
// split of the Fanuc lathe and the Okuma reaching the scripts and the program map.
//
// **A machine decides what a number is worth, and the class decides which rule applies.**
// `NUMBER_WALK` (`m9-common.js`) is handed the document's effective profile and machine by
// the app, exactly as a bundled script is, and reports the class and the value of every
// number word it finds. Four things are then true, and each used to be wrong:
//
//   1. **`C90000` on a Fanuc milling machine under IS-B is 90 degrees**, whatever the
//      length unit is. The mill declared no angular address, so the word was a length:
//      90 mm on a metric machine and 9 in on an inch one. (`A` and `B` are rotary axes of
//      the same kind.)
//   2. **A tap's `F` follows the feed unit in force**, it is not a pitch by default. Under
//      `G94` the `F` of `G84 … F1.25` is a feed per minute (spindle speed times the pitch),
//      under `G95` it is the pitch per revolution; on an Okuma 1 µm machine the `F1500` of
//      `G184` under `G94` is read like the `F500` of the driven-tool drilling `G181` beside
//      it, in the feed per minute's unit (150 mm/min), where the old reading took it as a
//      lead and was a hundred times off. Only a code the database declares as a lead (a
//      thread cut) makes its `F` a feed per revolution whatever the mode says.
//   3. **The Okuma 10 µm preset knows no inch.** The control has no 10 µm inch system, so
//      on an inch machine a word under that preset has no value unless the preset says
//      what the unit is. The old reading made one up (a tenth of the metric unit).
//   4. **A point-less feed per revolution follows the preset.** A control without
//      calculator-type input counts `F25` in its least increment of the feed, so under
//      IS-B it is 0.25 mm/rev and not 25 (a hundred times the feed). The expected value of
//      each preset is worked out from the rules the preset itself declares, so the label
//      and the data cannot drift apart without this failing; the IS-B claim is written
//      out. With a point, or under calculator input, the word is as written.
//
// The second half is about the two machine choices of R6. The Fanuc lathe machine says
// which of `U W V H` are incremental, and a script reads that from the profile it is
// handed (`incremental_axes`); the `T` split of the Fanuc lathe and the Okuma decides which
// lines the program map and F7 call a tool change, and each choice has an outline golden
// (`tests/fixtures/expected/outline/**/variants/`) holding the program and its map.

import { scenario } from '../lib/index.js'
import { clickMachineAction } from './m6-common.js'
import { FANUC_LATHE, FANUC_MILL, INCREMENTAL_KEYS, INCREMENTAL_REPORT, NUMBER_WALK, OKUMA, context, mapItems, numberWalk, openProbe, pickMachine, ready, reportRows, runScript, waitForMachine, writeUserScript } from './m9-common.js'

/**
 * Exact decimal product of two non-negative decimal texts.
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function times(a, b) {
  const [ai, af = ''] = a.split('.')
  const [bi, bf = ''] = b.split('.')
  const digits = af.length + bf.length
  const product = (BigInt(ai + af) * BigInt(bi + bf)).toString().padStart(digits + 1, '0')
  return normal(`${product.slice(0, product.length - digits)}.${product.slice(product.length - digits)}`)
}

/**
 * A decimal text without a plus, a trailing point or trailing zeros.
 * @param {string} text
 */
function normal(text) {
  const bare = text.replace(/^\+/, '')
  return bare.includes('.') ? bare.replace(/0+$/, '').replace(/\.$/, '') : bare
}

/**
 * What a point-less or pointed literal of a feed-per-revolution word is worth on a metric
 * machine whose number rules are `rules` (§7.15: `calculator` reads it as written,
 * `increment` reads a word without a point as a count of increments, `scale` multiplies
 * every word). `null` when the rules declare no unit for it.
 * @param {any} rules a machine's `numberInput`
 * @param {string} raw the literal as written
 * @returns {string | null}
 */
function feedPerRev(rules, raw) {
  const entry = rules.classes?.feedPerRev ?? {}
  const mode = entry.mode ?? rules.mode
  const unit = typeof entry.increment === 'string' ? entry.increment : rules.incrementMm
  if (mode === 'calculator' || (mode === 'increment' && raw.includes('.'))) return normal(raw)
  return typeof unit === 'string' ? times(raw.replace(/^\+/, ''), unit) : null
}

/**
 * The inch unit a metric-only preset declares for a class, or `undefined` when it declares
 * none, so a value in inches is not worth anything.
 * @param {any} rules
 * @param {'length' | 'feedPerRev'} cls
 * @returns {string | undefined}
 */
function inchUnit(rules, cls) {
  const entry = rules.classes?.[cls]
  if (cls === 'length') return rules.incrementInch
  return entry?.incrementInch ?? (typeof entry?.increment === 'string' ? undefined : rules.incrementInch)
}

scenario('m9-numbers', { timeout: 540 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const machines = /** @type {any} */ (ctx).machines
  const walkId = await writeUserScript(h, 'rh_number_walk.py', NUMBER_WALK)
  const incrementalId = await writeUserScript(h, 'rh_incremental_report.py', INCREMENTAL_REPORT)

  /**
   * The rules of a preset, as the profile declares them.
   * @param {string} profileId
   * @param {string} presetId
   */
  const rulesOf = (profileId, presetId) => {
    const found = ctx.profiles.profile(profileId).machineParams?.numberInput?.presets?.find((entry) => entry.id === presetId)
    if (found === undefined) throw new Error(`${profileId} has no number preset ${presetId}`)
    return /** @type {any} */ (found.value)
  }

  /** @type {Record<string, string>} machine name → id */
  const ids = {}
  /**
   * Makes a machine through the service and remembers its id.
   * @param {string} name
   * @param {string} profile
   * @param {object} params
   */
  const addMachine = async (name, profile, params) => {
    ids[name] = await machines.add({ name, profile, notes: '', params })
  }
  /** @param {string} profile @param {string} preset @param {'mm' | 'inch'} units */
  const params = (profile, preset, units = 'mm') => ({ numberInput: rulesOf(profile, preset), units, ...(profile === FANUC_MILL ? {} : { diameter: 'on' }) })

  await addMachine('Mill IS-B', FANUC_MILL, params(FANUC_MILL, 'is-b'))
  await addMachine('Mill IS-B inch', FANUC_MILL, params(FANUC_MILL, 'is-b', 'inch'))
  await addMachine('Mill IS-C', FANUC_MILL, params(FANUC_MILL, 'is-c'))
  await addMachine('Mill calc', FANUC_MILL, params(FANUC_MILL, 'calculator'))
  await addMachine('Lathe IS-B', FANUC_LATHE, params(FANUC_LATHE, 'is-b'))
  await addMachine('Lathe IS-C', FANUC_LATHE, params(FANUC_LATHE, 'is-c'))
  await addMachine('Lathe calc', FANUC_LATHE, params(FANUC_LATHE, 'calculator'))
  await addMachine('Okuma 1 um', OKUMA, params(OKUMA, 'okuma-1um'))
  await addMachine('Okuma 10 um inch', OKUMA, params(OKUMA, 'okuma-10um', 'inch'))
  await h.idle()

  /** How many probe files were written, so every one has a name of its own. */
  let count = 0
  /**
   * Opens a program under a machine and reports what its number words are worth.
   * @param {string} machine the machine's name
   * @param {string} profile
   * @param {string} extension
   * @param {string} text
   */
  const walk = async (machine, profile, extension, text) => {
    count += 1
    const doc = await openProbe(h, `PROBE${count}.${extension}`, text, profile)
    h.check(`probe ${count} is a ${profile} program`, ctx.docs.get(doc.id)?.profileId === profile, ctx.docs.get(doc.id)?.profileId)
    await pickMachine(h, machine)
    await waitForMachine(h, ids[machine])
    return numberWalk(h, walkId, text, machine)
  }
  /** @param {Map<string, string>} answers @param {string} key */
  const at = (answers, key) => answers.get(key) ?? '(not reported)'

  // =============================================================== A. an angle is not a length
  const MILL_ANGLES = 'G21 G90 G94\nG0 A45000 B30000 C90000\nG84 Z-10. R2. F1.25\nG80\nG1 X10. F200.\n'
  const metric = await walk('Mill IS-B', FANUC_MILL, 'NC', MILL_ANGLES)
  h.check('C90000 on a milling machine set to IS-B is an angle of 90 degrees', at(metric, '2:C90000') === 'angle|90', at(metric, '2:C90000'))
  h.check('and A45000 and B30000, the other rotary axes, are 45 and 30', at(metric, '2:A45000') === 'angle|45' && at(metric, '2:B30000') === 'angle|30', [at(metric, '2:A45000'), at(metric, '2:B30000')])
  const inch = await walk('Mill IS-B inch', FANUC_MILL, 'NC', MILL_ANGLES)
  h.check('the unit of length does not enter into it: on an inch machine C90000 is still 90 degrees, not 9 in', at(inch, '2:C90000') === 'angle|90' && at(inch, '2:A45000') === 'angle|45', [at(inch, '2:C90000'), at(inch, '2:A45000')])
  h.check('an ordinary position is still a length: X10. is 10', at(metric, '5:X10.') === 'length|10', at(metric, '5:X10.'))

  // =============================================================== B. a thread pitch is a lead, a feed is a feed
  h.check('G84 … F1.25 under G94 is a feed per minute of 1.25: a tap’s F follows the feed unit in force', at(metric, '3:F1.25') === 'feedPerMin|1.25', at(metric, '3:F1.25'))
  const perRev = await walk('Mill IS-B', FANUC_MILL, 'NC', 'G21 G90 G95\nG84 Z-10. R2. F1.25\nG80\n')
  h.check('and the same tap under G95 is a feed per revolution of 1.25, the pitch', at(perRev, '2:F1.25') === 'feedPerRev|1.25', at(perRev, '2:F1.25'))
  h.check('and the F200. of the move after the cycle is cancelled is a feed per minute', at(metric, '5:F200.') === 'feedPerMin|200', at(metric, '5:F200.'))

  const OKUMA_TAP = 'G94\nG184 X10000 Z-20000 F1500\nG180\nG181 X10000 Z-20000 F500\nG180\n'
  const micron = await walk('Okuma 1 um', OKUMA, 'MIN', OKUMA_TAP)
  h.check('on an Okuma 1 µm machine the tap G184 … F1500 under G94 is read as a feed per minute (150 mm/min), not as a pitch', at(micron, '2:F1500') === 'feedPerMin|150', at(micron, '2:F1500'))
  h.check('and the driven-tool drilling feed G181 … F500 under G94 is 50 mm per minute', at(micron, '4:F500') === 'feedPerMin|50', at(micron, '4:F500'))

  // =============================================================== C. the Okuma 10 µm preset has no inch
  const tenRules = rulesOf(OKUMA, 'okuma-10um')
  const TEN = 'G20\nG1 X50 F25\n'
  const ten = await walk('Okuma 10 um inch', OKUMA, 'MIN', TEN)
  const lengthUnit = inchUnit(tenRules, 'length')
  const feedUnit = inchUnit(tenRules, 'feedPerRev')
  h.check(
    'on an inch machine the 10 µm preset gives X50 a value only if the preset declares an inch unit — it made one up before (0.05)',
    at(ten, '2:X50') === (lengthUnit === undefined ? 'length|(no value)' : `length|${times('50', lengthUnit)}`) && at(ten, '2:X50') !== 'length|0.05',
    { got: at(ten, '2:X50'), declared: lengthUnit ?? '(none)' },
  )
  h.check(
    'and the same for a feed per revolution: F25 (0.025 before)',
    at(ten, '2:F25') === (feedUnit === undefined ? 'feedPerRev|(no value)' : `feedPerRev|${times('25', feedUnit)}`) && at(ten, '2:F25') !== 'feedPerRev|0.025',
    { got: at(ten, '2:F25'), declared: feedUnit ?? '(none)' },
  )

  // =============================================================== D. a point-less feed per revolution
  const FEED = (/** @type {string} */ code) => `G21 ${code}\nG1 Z-5 F25\nG1 Z-6. F25.\nG1 Z-7 F0.25\n`
  /** @type {Record<string, Map<string, string>>} */
  const perPreset = {}
  for (const [profile, extension, code, names] of /** @type {[string, string, string, string[]][]} */ ([
    [FANUC_LATHE, 'NC', 'G99', ['Lathe IS-B', 'Lathe IS-C', 'Lathe calc']],
    [FANUC_MILL, 'NC', 'G95', ['Mill IS-B', 'Mill IS-C', 'Mill calc']],
  ])) {
    for (const name of names) {
      const preset = name.endsWith('IS-B') ? 'is-b' : name.endsWith('IS-C') ? 'is-c' : 'calculator'
      const rules = rulesOf(profile, preset)
      const answers = await walk(name, profile, extension, FEED(code))
      perPreset[name] = answers
      const pointless = feedPerRev(rules, '25')
      h.check(
        `${name}: F25 is worth what the preset’s own rules make of it (${pointless ?? 'no value'}), F25. and F0.25 are as written`,
        at(answers, '2:F25') === `feedPerRev|${pointless ?? '(no value)'}` && at(answers, '3:F25.') === 'feedPerRev|25' && at(answers, '4:F0.25') === 'feedPerRev|0.25',
        { got: [at(answers, '2:F25'), at(answers, '3:F25.'), at(answers, '4:F0.25')], rules: rules.classes?.feedPerRev ?? rules.mode },
      )
    }
  }
  h.check(
    'under IS-B, a control without calculator input, a point-less F25 is no longer read as 25 mm/rev — on the lathe nor on the mill',
    ['Lathe IS-B', 'Mill IS-B'].every((name) => at(perPreset[name], '2:F25') !== 'feedPerRev|25'),
    ['Lathe IS-B', 'Mill IS-B'].map((name) => `${name}: ${at(perPreset[name], '2:F25')}`),
  )
  h.check('while under calculator-type input it is, and F25. is 25 under every preset', ['Lathe calc', 'Mill calc'].every((name) => at(perPreset[name], '2:F25') === 'feedPerRev|25'), ['Lathe calc', 'Mill calc'].map((name) => at(perPreset[name], '2:F25')))

  // =============================================================== E. which of U W V H are incremental
  /** @type {[string, string, string, string][]} choice, machine, incremental, diameter */
  const CHOICES = [
    ['uw', 'Lathe U W', 'U:X W:Z', 'X U'],
    ['uwvh', 'Lathe U W V H', 'H:C U:X V:Y W:Z', 'X U'],
    ['none', 'Lathe G91 only', '(none)', 'X'],
  ]
  for (const [choice, name] of CHOICES) await addMachine(name, FANUC_LATHE, { variants: { incrementalAddresses: choice } })
  await h.idle()
  count += 1
  const lathe = await openProbe(h, `PROBE${count}.NC`, 'G21 G99\nG0 X50. Z2.\nM30\n', FANUC_LATHE)
  h.check('the probe lathe program is a Fanuc lathe program', ctx.docs.get(lathe.id)?.profileId === FANUC_LATHE, ctx.docs.get(lathe.id)?.profileId)
  for (const [choice, name, incremental, diameter] of CHOICES) {
    await pickMachine(h, name)
    await waitForMachine(h, ids[name])
    await runScript(h, incrementalId)
    await h.waitFor(() => reportRows(h, INCREMENTAL_KEYS).includes(`machine|${name}`), { timeout: 20000 })
    const rows = reportRows(h, INCREMENTAL_KEYS)
    h.check(
      `the machine “${name}” hands a script U/W/V/H as the ${choice} choice says: ${incremental}, and X and U are diameters only as far as ${diameter}`,
      rows.includes(`incrementalAddresses|${choice}`) && rows.includes(`incremental|${incremental}`) && rows.includes(`diameter|${diameter}`),
      rows,
    )
  }

  // =============================================================== F. the T split decides the tool changes
  /** @type {[string, string, string][]} golden folder, profile, extension */
  const FOLDERS = [
    ['fanuc-lathe', FANUC_LATHE, 'NC'],
    ['okuma', OKUMA, 'MIN'],
  ]
  for (const [folder, profile, extension] of FOLDERS) {
    for (const choice of folder === 'okuma' ? ['offset2', 'offset3'] : ['byLength', 'offset2', 'offset1', 'offset3']) {
      const golden = JSON.parse(await h.disk.read(await h.fixture(`expected/outline/${folder}/variants/toolWord-${choice}.json`)))
      const name = `${profile} T ${choice}`
      await addMachine(name, profile, { variants: { toolWord: choice } })
      await h.idle()
      count += 1
      const text = `${golden.program.join('\n')}\n`
      const doc = await openProbe(h, `PROBE${count}.${extension}`, text, profile)
      await pickMachine(h, name)
      await waitForMachine(h, ids[name])
      const tools = /** @type {{ kind: string, line: number, text: string }[]} */ (golden.items).filter((item) => item.kind === 'tool')
      const lines = tools.map((item) => item.line)
      await h.waitFor(() => JSON.stringify(ctx.outline.toolLines(doc.id)) === JSON.stringify(lines), { timeout: 15000 })
      h.check(`${profile}, tool word ${choice}: the tool changes are on the lines of the golden — ${lines.join(', ') || 'none'}`, JSON.stringify(ctx.outline.toolLines(doc.id)) === JSON.stringify(lines), {
        got: ctx.outline.toolLines(doc.id),
        want: lines,
        program: golden.program,
      })
      const labels = mapItems(h)
        .filter((item) => item.kind === 'tool')
        .map((item) => item.text)
      h.check(`and the map names them as the golden does: ${tools.map((item) => item.text).join(', ')}`, JSON.stringify(labels) === JSON.stringify(tools.map((item) => item.text)), { got: labels, want: tools.map((item) => item.text) })
    }
  }

  // =============================================================== G. the form offers the choices
  const opened = ctx.commands.run('machines.manage')
  await h.waitFor(() => h.q('settings-machines'), { timeout: 10000 })
  const rows = h.qa('machine-row').map((row) => row.dataset.machineId)
  h.check('every machine of this run is listed on the Machines page, none of them broken', rows.length === Object.keys(ids).length && h.qa('machine-row').every((row) => row.dataset.problems === '0'), { rows, problems: h.qa('machine-row').map((row) => row.dataset.problems) })
  await clickMachineAction(h, 'edit', ids['Lathe U W V H'])
  const field = h.q('form-field', { field: 'variant.incrementalAddresses' })
  const select = /** @type {HTMLSelectElement | null} */ (field?.querySelector('select') ?? null)
  const declared = ctx.profiles.profile(FANUC_LATHE).machineParams?.variants?.find((variant) => variant.id === 'incrementalAddresses')
  h.check(
    'editing the machine that was set to U, W, V and H shows that choice picked',
    select?.selectedOptions[0]?.textContent?.trim() === declared?.choices.find((choice) => choice.value === 'uwvh')?.label,
    select?.selectedOptions[0]?.textContent?.trim(),
  )
  await clickMachineAction(h, 'cancel')
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !h.q('settings-machines'), { timeout: 8000 })
  await opened
  await h.idle()
  h.check('no document was changed by any of this', ctx.docs.all().filter((doc) => doc.path !== null).every((doc) => !doc.dirty), ctx.docs.all().map((doc) => `${doc.title}:${doc.dirty}`))
})
