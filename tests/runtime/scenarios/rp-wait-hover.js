// A machine's wait code in the hover (plan §6 M12.5, decision 4; WP-RP5): on a machine whose
// channel block lists `M190-M199` as waits, hovering `M198` says it is a wait code of THIS
// machine and names the machine and the rule; the code database's own meaning of `M198` (a
// control's use of it that this machine does not have) is not shown. With no machine, or on a
// machine whose waits are another range, the database speaks as before.
//
// **The program is `tests/fixtures/channels/nc/fanuc-lathe/c14-part_1.ISO`**, path 1 of a set
// whose waits `M198` and `M199` stand alone without `P`; its README row says the preset
// `fanuc-3path-digits-nop12` reads it. The expected sentence is built from the translation
// (`assistant.hover.waitCode`) and from the preset's own label, never typed from the screen.

import { scenario } from '../lib/index.js'
import { hoverAt } from './m3-common.js'
import { NC_DIR, channelMachines, context, open, presetBlock, ready } from './m12-common.js'

const PART_1 = 'c14-part_1.ISO'

scenario('rp-wait-hover', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await h.fixture(NC_DIR)
  const id = await open(h, `${dir}/${PART_1}`)
  const lines = ctx.editor.getLines(id, 1, ctx.editor.getLineCount(id))
  const m198 = lines.findIndex((text) => /^M198$/.test(text.trim())) + 1
  const m191 = lines.findIndex((text) => /^M191 P123$/.test(text.trim())) + 1
  const g0 = lines.findIndex((text) => /^N5 G0 /.test(text.trim())) + 1
  h.check('the program is the path-1 file with a lone M198 and an M191 P123', m198 > 0 && m191 > 0 && g0 > 0, { m198, m191, g0 })
  /** @param {number} line @param {string} word */
  const hover = (line, word) => hoverAt(h, id, line, lines[line - 1].indexOf(word) + 2)
  const sentence = (/** @type {string} */ machine, /** @type {string} */ rule) => ctx.t('assistant.hover.waitCode', { machine, rule })

  // =============================================================== A. no machine: the database speaks
  const bare = await hover(m198, 'M198')
  h.check('with no machine M198 is described by the code database and says nothing about waiting on a machine', bare !== '' && !bare.includes('Wait code on this machine'), bare.slice(0, 200))

  // =============================================================== B. the three-path machine
  const machines = channelMachines(h)
  const block = presetBlock(h, 'fanuc-lathe', 'fanuc-3path-digits-nop12')
  const rule = block.syncMarks[0].label
  await machines.add('Three paths', block)
  await machines.use('Three paths')
  const text = await hover(m198, 'M198')
  h.check('on a machine that lists M190-M199 as waits, M198 reads "Wait code on this machine (Three paths): <the rule>"', text.includes(sentence('Three paths', rule)), { got: text.slice(0, 300), want: sentence('Three paths', rule) })
  h.check('and the note says the code database describes the control’s own meaning, which this machine does not use', text.includes(ctx.t('assistant.hover.waitCodeNote')), text.slice(0, 400))
  const other = await hover(m191, 'M191')
  h.check('M191 of the same range says it too', other.includes(sentence('Three paths', rule)), other.slice(0, 300))
  const plain = await hover(g0, 'G0')
  h.check('a word that is not a wait code is described as before', plain !== '' && !plain.includes('Wait code on this machine'), plain.slice(0, 200))

  // =============================================================== C. a machine whose waits are another range
  const head = presetBlock(h, 'fanuc-lathe', 'fanuc-2head-m100')
  await machines.add('Two heads', head)
  await machines.use('Two heads')
  const notWait = await hover(m198, 'M198')
  h.check('on a two-head machine (waits M100-M197) M198 is not a wait: the database speaks again', notWait !== '' && !notWait.includes('Wait code on this machine'), notWait.slice(0, 200))

  // =============================================================== D. and back
  await machines.use('Three paths')
  const again = await hover(m198, 'M198')
  h.check('and picking the three-path machine again brings the sentence back', again.includes(sentence('Three paths', rule)), again.slice(0, 200))
})
