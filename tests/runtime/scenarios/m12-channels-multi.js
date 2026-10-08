// One file per channel (plan §6 M12 H12 `m12-channels-multi`; X12, AD-32, D58, WP12.4, WP12.5).
//
// **The programs** are the fixtures of `channels/nc/fanuc-lathe/`, copied together as a folder,
// because the siblings of a program are looked for next to it:
//
//   c07-part_CH1.nc   channel 1 of a pair whose channel 2 is deliberately absent
//   c06-part_CH1.nc   channel 1 of a complete pair, with
//   c06-part_CH2.nc   its channel 2
//   c09-notachannel.nc   a name that no file-name pattern reads: it belongs to no channel until
//                     the user says which
//
// and the machine is the c06 golden's block (`_CH<n>.nc` names the channel, `P` is a bit sum).
//
// **What the item says** is read off its attributes: `data-layout=multi-file`, `data-channel-id`
// (this document's channel; empty while it is not set), `data-open` (the ids that are open) and
// `data-missing` (the ids no file was found for). "Open but not open yet" is therefore
// `data-open="1"` with `data-missing=""`: the other file exists, it is simply not a tab.
//
// **gEdit opens nothing by itself** (standing rule 14): the user picks "Open the other channels",
// which is the file dialog, started in the document's own folder. The assignment of a document no
// pattern fits is remembered per file (M7's file memory), so the second scenario of the pair opens
// the same file in a second session and finds it still assigned.

import { scenario } from '../lib/index.js'
import { runFromTools } from './m10-common.js'
import { removeFile } from './m2-common.js'
import { osOp, otherRun, quitCleanly, requireFirstRun } from './m7-common.js'
import { pickEntry } from './m6-common.js'
import {
  NC_DIR,
  REPO_FILE,
  activate,
  activeId,
  blockOf,
  channelMachines,
  context,
  mapRows,
  message,
  open,
  ready,
  waitChannel,
} from './m12-common.js'

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../m12-channels-multi-1/state-home'

/** The label of the pick that opens the other channels, and of the one that assigns channel 2. */
const OPEN_OTHERS = 'Open the other channels…'
const ASSIGN_2 = 'Assign this document to Channel 2'

scenario('m12-channels-multi-1', { timeout: 300, files: REPO_FILE, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await h.fixture(NC_DIR)
  const block = await blockOf(h, 'c06-part_CH1')

  // The machine is the dialect's default, so every document opened afterwards follows it.
  const machines = channelMachines(h)
  const machineId = await machines.add('Pair lathe', block)
  await ctx.machines.setDefault('fanuc-lathe', machineId)
  await h.idle()

  // ==================================================================== A. the sibling is absent
  const lone = await open(h, `${dir}/c07-part_CH1.nc`)
  const a = await waitChannel(h, (s) => s.present)
  h.check('a program whose name says channel 1 gets the item, for one file per channel', a.layout === 'multi-file' && a.id === '1' && a.count === '2', a)
  const aw = await waitChannel(h, (s) => s.missing === '2')
  h.check('and channel 2, whose file is not in the folder, is "not found"', aw.missing === '2' && aw.open === '1' && /not found/.test(aw.text), aw)
  h.check('the split command is not on offer: the channels are separate documents already', ctx.commands.isEnabled('channels.splitToDocuments') === false)
  h.check('the program map is the ordinary one: no channel rows', !mapRows(h).some((r) => r.kind === 'channel' || r.kind === 'sync'), mapRows(h).map((r) => r.kind))
  await ctx.commands.run('file.close')
  await h.waitFor(() => !ctx.docs.get(lone), { timeout: 8000 })

  // ==================================================================== B. the sibling exists
  const one = await open(h, `${dir}/c06-part_CH1.nc`)
  const b = await waitChannel(h, (s) => s.present && s.open === '1')
  h.check('channel 1 of a complete pair: its file is found, it is not open', b.id === '1' && b.open === '1' && b.missing === '' && /not open/.test(b.text), b)
  h.check('and the item says which of the two this one is', /1 of 2/.test(b.text), b.text)

  // Open the other channels: the file dialog, in this document's own folder.
  const openedBefore = h.dialogs.calls().filter((c) => c.kind === 'open').length
  await h.dialogs.queue('open', [`${dir}/c06-part_CH2.nc`])
  await pickEntry(h, 'channels.select', OPEN_OTHERS)
  const asked = h.dialogs.calls().filter((c) => c.kind === 'open').slice(openedBefore)
  h.check('the pick opens the file dialog once, for several files, in the folder of the document', asked.length === 1 && asked[0].args.options.multiple === true && asked[0].args.options.defaultPath === dir, asked.map((c) => c.args.options))
  const two = ctx.docs.byPath(`${dir}/c06-part_CH2.nc`)?.id
  h.check('the file the user picked is open', two !== undefined, ctx.docs.all().map((d) => d.title))
  if (two === undefined) throw new Error('channel 2 did not open')
  h.check('and nothing else was opened for the user', ctx.docs.all().filter((d) => /^c0[6-9]/.test(d.title)).length === 2, ctx.docs.all().map((d) => d.title))

  await activate(h, one)
  const c1 = await waitChannel(h, (s) => s.open === '1 2' && s.id === '1')
  h.check('both open: the first tab is channel 1 and the item counts both as open', c1.id === '1' && c1.open === '1 2' && c1.missing === '' && /1 of 2/.test(c1.text) && !/not open/.test(c1.text), c1)
  await activate(h, two)
  const c2 = await waitChannel(h, (s) => s.id === '2')
  h.check('the second tab is channel 2 of the same two', c2.id === '2' && c2.open === '1 2' && /2 of 2/.test(c2.text), c2)

  // The tool list of one channel's file: that file only, and it says the others are separate runs.
  const listed = (await runFromTools(h, 'bundled:tool_list.py', undefined, 60000)).report
  const columns = (listed.columns ?? []).map((/** @type {any} */ c) => c.key)
  h.check('the tool list of a channel file has no Channel column and lists that file\'s tools', !columns.includes('channel') && (listed.rows ?? []).map((/** @type {any} */ r) => r.tool).join() === 'T2,T4', { columns, rows: listed.rows })
  h.check('and says that this document is channel 2 and the other channels are separate runs', /This document is Channel 2; the other channels are separate runs\./.test(listed.message ?? ''), listed.message)

  // Closing a tab does not make the file vanish: it exists, it is not open.
  await ctx.commands.run('file.close')
  await h.waitFor(() => !ctx.docs.get(two), { timeout: 8000 })
  await activate(h, one)
  const c3 = await waitChannel(h, (s) => s.open === '1' && s.id === '1')
  h.check('closing channel 2 puts it back to "exists, not open"', c3.missing === '' && /not open/.test(c3.text), c3)

  // Remove the sibling from the folder: the item reads "not found" once it asks again.
  await removeFile(h, `${dir}/c06-part_CH2.nc`)
  const running = ctx.commands.run('channels.select')
  await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
  await h.nativeKeys([{ key: 'Escape' }])
  await running
  const gone = await waitChannel(h, (s) => s.missing === '2')
  h.check('with channel 2\'s file gone from the folder the item reads "not found"', gone.missing === '2' && /not found/.test(gone.text), gone)

  // A folder the OS will not let the app read is not "not found": the sibling may well be there
  // (owner answer 2026-10-08). The folder is made unreadable (mode 000) and restored at once.
  // The program is already open, so the item has nothing to read the folder with but the call.
  await osOp(h, 'chmod', dir, { mode: '000' })
  let denied
  try {
    const asking = ctx.commands.run('channels.select')
    await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
    await h.nativeKeys([{ key: 'Escape' }])
    await asking
    denied = await waitChannel(h, (s) => /could not be checked/.test(s.text))
  } finally {
    await osOp(h, 'chmod', dir, { mode: '755' })
  }
  h.check('with the folder unreadable the item reads "could not be checked", not "not found"', /could not be checked/.test(denied.text) && !/not found/.test(denied.text), denied)

  await ctx.commands.run('file.close')
  await h.waitFor(() => !ctx.docs.get(one), { timeout: 8000 })

  // ==================================================================== C. a name no pattern fits
  const free = await open(h, `${dir}/c09-notachannel.nc`)
  const c = await waitChannel(h, (s) => s.present)
  h.check('a pair whose names match no pattern: the item says the channel is not set', c.layout === 'multi-file' && c.id === '' && /not set/.test(c.text), c)
  await pickEntry(h, 'channels.select', ASSIGN_2)
  const d = await waitChannel(h, (s) => s.id === '2')
  h.check('"Assign this document to Channel 2" ties it to channel 2', d.id === '2' && d.layout === 'multi-file' && /2 of 2/.test(d.text), d)
  h.check('and says so', /Channel 2/.test(message(h)) && /c09-notachannel/.test(message(h)), message(h))
  h.check('the file on disk was not touched', (await h.disk.read(`${dir}/c09-notachannel.nc`)).includes('(WRITTEN FOR GEDIT') && !ctx.docs.get(free)?.dirty)
  // The assignment survives a restart: this session ends the way a user ends one.
  h.check('the machines file holds the machine, so the second session needs no setup', /** @type {any} */ (await h.config.read('machines.json'))?.defaults?.['fanuc-lathe'] === machineId, await h.config.read('machines.json'))
  await quitCleanly(h)
})

scenario('m12-channels-multi-2', { timeout: 120, files: REPO_FILE, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await requireFirstRun(h, 'm12-channels-multi-1')
  const dir = `${otherRun(h.cfg.run, 'm12-channels-multi-1')}/fixtures/${NC_DIR}`
  h.check('the first session left the program where the second finds it', (await h.disk.stat(`${dir}/c09-notachannel.nc`)) !== null, dir)

  const id = await open(h, `${dir}/c09-notachannel.nc`)
  const s = await waitChannel(h, (state) => state.present)
  h.check('the same file in a second session is still channel 2, by the assignment', s.layout === 'multi-file' && s.id === '2', s)
  h.check('and the tooltip says it was set by the user', /set by you/.test(s.title), s.title)
  h.check('its machine is still the dialect default', ctx.machines.effective(id).machine.name === 'Pair lathe', ctx.machines.effective(id).machine.name)
  h.check('no other file of the folder is opened by gEdit', ctx.docs.all().length === 1 && activeId(h) === id, ctx.docs.all().map((d) => d.title))
})
