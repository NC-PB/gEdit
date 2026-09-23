// Reference-aware renumbering on a turning program (plan §5 M6 H6 `m6-lathe-renumber`,
// WP6.3): the block numbers a `G70`/`G71`/`G73` cycle names follow the blocks they point
// at, an `M99 P` is reported and never touched, and one undo takes the whole run back.
//
// **Why this is the milestone's sharpest edit.** A turning cycle does not carry a distance:
// `G71 P100 Q200` says "rough the profile written between block N100 and block N200". Move
// those two blocks' numbers without moving the `P` and the `Q` with them and the control
// either alarms or — worse, and this is the case that scraps a part — finds different
// blocks and roughs a different profile. Phase 1 could only warn; M6 rewrites them.
//
// And the other half, which matters just as much: `M99 P30` returns to block 30 of the
// **calling** program, not of the subprogram it stands in. A run that resolved it locally
// would write the subprogram's new number into it and the return would land in the wrong
// place. The rule says `rewrite: false`, so that value is reported and left alone, and the
// user is asked before the run rather than told afterwards.
//
// Both cases come out of `tests/fixtures/transforms/renumber/`, so the scenario and the
// unit tests cannot drift apart.

import { scenario } from '../lib/index.js'
import { context, message, newDoc, ready, runTransform, transformCase } from './m4-common.js'
import { LATHE } from './m6-common.js'

/** The findings on screen, as `line|severity|text`. */
const findings = (/** @type {import('../lib/api.js').Harness} */ h) =>
  h.qa('results-finding').map((element) => `${element.dataset.line}|${element.dataset.severity}|${element.textContent?.trim()}`)

scenario('m6-lathe-renumber', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // ================================================== A. the cycles follow their blocks
  const cycles = await transformCase(h, 'renumber', 'lathe-cycles')
  h.check('the golden runs on the lathe dialect', cycles.profile === LATHE, cycles.profile)
  const id = await newDoc(h, cycles.input, cycles.profile)
  h.check('the document opened on it', h.app.activeProfile() === LATHE, h.app.activeProfile())

  // The fixture sets no options, so the form is opened and confirmed as it stands: the
  // dialect's own defaults are what a user gets.
  const ran = await runTransform(h, 'nc.renumber', { form: true })
  h.check('renumbering rewrites every P and Q with the new block numbers', ran && h.app.text() === cycles.expected, {
    ran,
    got: h.app.text().split('\n'),
    want: cycles.expected.split('\n'),
    status: message(h),
  })
  // `h.alert.visible()` answers `null` when no NSAlert is up. Phase 1 raised a preflight
  // here; M6 has nothing left to ask about, and that is the change.
  const alertAfterCycles = await h.alert.visible()
  h.check('no question was asked: every reference in this program could be followed', alertAfterCycles === null, alertAfterCycles)

  // Named individually, because "the text matches" does not say which half was wrong.
  const line = (/** @type {number} */ n) => ctx.editor.getLines(id, n, n)[0] ?? ''
  h.check('the roughing cycle now names the blocks that really hold the profile', line(9) === 'N70 G71 P80 Q100 U0.4 W0.1 F0.25' && line(10) === 'N80 G00 X20.' && line(12) === 'N100 X32.', {
    g71: line(9),
    first: line(10),
    last: line(12),
  })
  h.check('so do the finishing pass and the repeat cycle', line(13) === 'N110 G70 P80 Q100' && line(14) === 'N120 G73 P80 Q100 U0.2 W0.1', { g70: line(13), g73: line(14) })
  h.check('and the depth-of-cut block, which names no block at all, is untouched', line(8) === 'N60 G71 U1.5 R0.5', line(8))
  // A transform's warnings are glued onto the report's own message (`app/transforms.ts`
  // step 7), so the panel is where "they were rewritten" is said out loud.
  h.check('and the report says so in plain words, instead of telling the user to fix the jumps by hand', /rewritten with the new block numbers/.test(h.q('results-panel')?.textContent ?? ''), {
    status: message(h),
    panel: h.q('results-panel')?.textContent?.trim().slice(0, 300),
  })

  const after = h.app.text()
  h.focusEditor()
  await h.nativeKeys([{ key: 'z', mods: ['cmd'] }])
  await h.waitFor(() => h.app.text() === cycles.input, { timeout: 10000 })
  h.check('one undo takes the whole run back, the rewritten references included', h.app.text() === cycles.input && after !== cycles.input, {
    now: line(9),
    was: cycles.input.split('\n')[8],
  })

  // ============================================ B. the reference that must not be followed
  const caller = await transformCase(h, 'renumber', 'm99-p-caller')
  h.check('this golden runs on the lathe dialect too', caller.profile === LATHE, caller.profile)
  await newDoc(h, caller.input, caller.profile)

  // The preflight is the difference M6 makes: it is raised for what cannot be followed and
  // for nothing else.
  const ranCaller = await runTransform(h, 'nc.renumber', { form: true, confirm: 'Continue' })
  h.check('a reference the run cannot follow is asked about first, and Continue goes ahead', ranCaller && h.app.text() === caller.expected, {
    ran: ranCaller,
    got: h.app.text().split('\n'),
    want: caller.expected.split('\n'),
    status: message(h),
  })
  h.check('M99 P30 is left exactly as it was: that 30 is a block of the calling program', h.app.text().includes('M99 P30'), h.app.text().split('\n'))
  h.check('while the subprogram itself was renumbered', h.app.text().split('\n')[5] === 'N10 G0 Z5.', h.app.text().split('\n'))
  h.check(
    'and the line that holds it is reported, saying why it was left',
    findings(h).some((entry) => entry.startsWith('7|warning|') && /calling program/.test(entry)),
    findings(h),
  )

  // Cancel is the other answer, and it has to change nothing at all.
  const second = await newDoc(h, caller.input, caller.profile)
  const before = h.app.text()
  await runTransform(h, 'nc.renumber', { form: true, confirm: 'Cancel' })
  h.check('answering the question with Cancel leaves the program exactly as it was', h.app.text() === before && ctx.docs.get(second)?.dirty !== true, {
    text: h.app.text().split('\n'),
    dirty: ctx.docs.get(second)?.dirty,
  })
})
