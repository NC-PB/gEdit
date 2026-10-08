// The channel presets of M12.5 on the Channels step (plan §6 M12.5, decision 3, §8.9; WP-RP5):
// the Fanuc lathe offers seven presets now (three new ones, one relabelled), Sinumerik four (the
// archive, the `_C<n>` pair and the tagged sections are new). A preset applies only on its
// button, copies its block exactly as the profile ships it, and a machine saved from it stores
// that block.
//
// The expected ids and counts are written out here from the plan's §8.9 table; the blocks are
// compared with the profile's own (`presetBlock`), so a preset edited in data moves the check
// with it, and the count and ids are what a change of the list must also update.

import { scenario } from '../lib/index.js'
import { setField } from './m4-common.js'
import { saveMachineForm, startAdd } from './m8-common.js'
import { closeSettings, machineAction, machinesFile, openMachinesPage, sameJson } from './m6-common.js'
import { presetBlock, ready } from './m12-common.js'

const LATHE_PRESETS = ['fanuc-2path', 'fanuc-2path-digits', 'fanuc-3path-digits', 'fanuc-3path-bitmask', 'fanuc-2path-nop', 'fanuc-3path-digits-nop12', 'fanuc-2head-m100']
const SINUMERIK_PRESETS = ['sinumerik-2channel', 'sinumerik-2channel-archive', 'sinumerik-2channel-c', 'sinumerik-tagged']

scenario('rp-presets', { timeout: 420 }, async (h) => {
  await ready(h)
  const page = await openMachinesPage(h)

  /** The preset list on the Channels step. */
  const presetSelect = () => /** @type {HTMLSelectElement} */ (h.q('channels-preset'))
  const options = () => [...presetSelect().options].filter((o) => o.value !== '')
  /** The channel rows' ids on the step. */
  const rowIds = () => h.qa('channel-row').map((r) => r.dataset.channel)

  // =============================================================== A. the lathe
  await startAdd(h, 'fanuc-lathe')
  h.check('the Fanuc lathe offers its seven presets, in the order of the plan', JSON.stringify(options().map((o) => o.value)) === JSON.stringify(LATHE_PRESETS), options().map((o) => o.value))
  h.check('each is marked "verify"', options().every((o) => /verify/i.test(o.textContent ?? '')), options().map((o) => o.textContent))
  h.check('and the builder-range presets say whose range it is, not that it is the standard one', options().filter((o) => /M900-M999/.test(o.textContent ?? '')).every((o) => /one builder/i.test(o.textContent ?? '')), options().map((o) => o.textContent))
  setField(h, 'name', 'Three-path lathe')
  h.select(presetSelect(), 'fanuc-3path-digits-nop12')
  await h.idle()
  h.check('picking it changes nothing', !!h.q('channels-none') && rowIds().length === 0)
  h.click(h.q('channels-preset-use'))
  await h.idle()
  h.check('the button gives the three paths (1, 2, 3)', JSON.stringify(rowIds()) === JSON.stringify(['1', '2', '3']) && !!h.q('channels-preset-applied'), rowIds())
  h.check('which saves', !(/** @type {HTMLButtonElement} */ (machineAction(h, 'save')).disabled))
  await saveMachineForm(h, {})
  const file = /** @type {any} */ (await machinesFile(h))
  const saved = file?.machines?.find((/** @type {any} */ m) => m.name === 'Three-path lathe')
  const wanted = presetBlock(h, 'fanuc-lathe', 'fanuc-3path-digits-nop12')
  h.check('and machines.json holds the preset’s block as the profile ships it (waits M190-M199, no P = paths 1 and 2)', sameJson(saved?.params?.channels, wanted), { got: saved?.params?.channels, want: wanted })

  // The two-head preset: waits M100-M197, a note about M198.
  await startAdd(h, 'fanuc-lathe')
  setField(h, 'name', 'Two-head lathe')
  h.select(presetSelect(), 'fanuc-2head-m100')
  await h.idle()
  h.click(h.q('channels-preset-use'))
  await h.idle()
  h.check('the two-head preset gives two channels', JSON.stringify(rowIds()) === JSON.stringify(['1', '2']), rowIds())
  await saveMachineForm(h, {})
  const second = /** @type {any} */ (await machinesFile(h))?.machines?.find((/** @type {any} */ m) => m.name === 'Two-head lathe')
  h.check('and stores its block, with the code range M100-M197', sameJson(second?.params?.channels, presetBlock(h, 'fanuc-lathe', 'fanuc-2head-m100')) && JSON.stringify(second?.params?.channels?.syncMarks?.[0]?.match).includes('M100-M197'), second?.params?.channels?.syncMarks)

  // =============================================================== B. Sinumerik
  await startAdd(h, 'sinumerik')
  h.check('Sinumerik offers four presets', JSON.stringify(options().map((o) => o.value)) === JSON.stringify(SINUMERIK_PRESETS), options().map((o) => o.value))
  setField(h, 'name', 'Archive')
  h.select(presetSelect(), 'sinumerik-2channel-archive')
  await h.idle()
  h.click(h.q('channels-preset-use'))
  await h.idle()
  h.check('the archive preset gives two channels in one file', rowIds().length === 2 && !!h.q('channels-preset-applied'), rowIds())
  await saveMachineForm(h, {})
  const archive = /** @type {any} */ (await machinesFile(h))?.machines?.find((/** @type {any} */ m) => m.name === 'Archive')
  h.check('and the saved block is the preset’s: layout single-file, the sections found by their %_N_<n>_0_MPF line', sameJson(archive?.params?.channels, presetBlock(h, 'sinumerik', 'sinumerik-2channel-archive')) && archive?.params?.channels?.layout === 'single-file', archive?.params?.channels?.layout)

  await closeSettings(h, page)
})
