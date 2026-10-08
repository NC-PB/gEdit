// Without channels nothing changes (plan §6 M12 H12 `m12-channels-off`; X12 c and d, "Intentional
// behavior changes in M12"): the same multi-channel programs with no machine, with a machine
// that has no channel block, and with a machine whose channel block is broken.
//
// **What "nothing" means.** No channel status item (except for a broken block, where the item
// exists *to say so*), the Phase 1 program map (no `channel` and no `sync` row, the tools at the
// top as before), the sync-point keys answer "no channels" and move nothing, "Check Wait Codes"
// refuses with a message and shows no report, and the machine's other settings read exactly as
// they did: the tooltip of the machine item, which names every effective value, is the same line
// for line. `m6-lathe-nav` is the existing scenario that holds the lathe map; it runs unchanged
// in the same suite.
//
// The broken block is a single-file block whose section pattern is not a regular expression.
// It is the machine's own problem and nobody else's: the machine stays selectable, and the map
// and the keys are those of a machine without channels.

import { scenario } from '../lib/index.js'
import { machineTooltip, pickMachine, waitForMachine } from './m6-common.js'
import { NC_DIR, REPO_FILE, blockOf, channelItem, channelMachines, channelState, context, goto, keys, mapRows, message, open, press, ready, report, waitChannel } from './m12-common.js'

/** A channel block that cannot be used: two channels, a section start that is not a pattern. */
const BROKEN = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Channel 1' },
    { id: '2', name: 'Channel 2' },
  ],
  sectionStart: '^O(',
  syncMarks: [],
}

/** The map as a plain list, to compare. @param {import('../lib/api.js').Harness} h */
const mapList = (h) => mapRows(h).map((r) => `${r.depth}|${r.kind}|${r.line}|${r.text}`)

scenario('m12-channels-off', { timeout: 240, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await h.fixture(NC_DIR)
  const machines = channelMachines(h)
  await machines.add('Twin lathe', await blockOf(h, 'c10-alternating'))
  await machines.add('Plain lathe', undefined)
  await machines.add('Broken lathe', BROKEN)

  const id = await open(h, `${dir}/c10-alternating.nc`)
  await h.waitFor(() => mapRows(h).some((r) => r.kind === 'tool'), { timeout: 10000 })
  await h.idle()

  // ==================================================================== A. no machine
  const p1 = mapList(h)
  h.check('with no machine the map is the ordinary one: tools at the top, from line 7 to 29', mapRows(h).filter((r) => r.kind === 'tool').map((r) => r.line).join() === '7,15,22,29' && !mapRows(h).some((r) => r.kind === 'channel' || r.kind === 'sync'), p1)
  h.check('there is no channel item', channelItem(h) === null, channelState(h))
  await goto(h, id, 6)
  await press(h, keys.next)
  h.check('Alt+F7 moves nothing and says the program has no channels', h.app.cursor().line === 6 && /no channels/i.test(message(h)), { line: h.app.cursor().line, status: message(h) })
  await press(h, keys.partner)
  h.check('so does Mod+Alt+P', h.app.cursor().line === 6 && /no channels/i.test(message(h)), { line: h.app.cursor().line, status: message(h) })
  const reportBefore = report(h)
  await ctx.commands.run('channels.checkSync')
  h.check('Check Wait Codes refuses, with a message, and shows no report', report(h) === reportBefore && /no channel settings/i.test(message(h)), { status: message(h) })
  h.check('and the split command is not offered', ctx.commands.isEnabled('channels.splitToDocuments') === false)

  // ==================================================================== B. a machine without channels
  await machines.use('Plain lathe')
  await h.idle()
  const plainTip = machineTooltip(h)
  h.check('a machine without a channel block adds no item', channelItem(h) === null, channelState(h))
  h.check('and the map is byte for byte the same', JSON.stringify(mapList(h)) === JSON.stringify(p1), { was: p1, now: mapList(h) })
  await goto(h, id, 6)
  await press(h, keys.next)
  h.check('the keys say there are no channels', h.app.cursor().line === 6 && /no channels/i.test(message(h)), message(h))

  // ==================================================================== C. a broken block
  await machines.use('Broken lathe')
  const broken = await waitChannel(h, (s) => s.present)
  h.check('a broken channel block is shown in the status item, and only there', /broken/i.test(broken.text) && broken.layout === '' && broken.id === '', broken)
  h.check('its tooltip says what is wrong (the rules of this machine are broken)', /broken/i.test(broken.title), broken.title)
  h.check('the map is the ordinary one, as without channels', JSON.stringify(mapList(h)) === JSON.stringify(p1), { was: p1, now: mapList(h) })
  const brokenTip = machineTooltip(h)
  h.check('the machine\'s other settings read exactly as before: the tooltip of the machine item, line for line', JSON.stringify(brokenTip.filter((l) => !/^Name|^Machine/.test(l))) === JSON.stringify(plainTip.filter((l) => !/^Name|^Machine/.test(l))), { plain: plainTip, broken: brokenTip })
  await goto(h, id, 6)
  await press(h, keys.next)
  h.check('the keys say there are no channels', h.app.cursor().line === 6 && /no channels/i.test(message(h)), message(h))
  await ctx.commands.run('channels.checkSync')
  h.check('and Check Wait Codes refuses', report(h) === reportBefore, message(h))

  // ==================================================================== D. back to none
  await machines.use('Twin lathe')
  await waitChannel(h, (s) => s.present && s.layout === 'single-file')
  h.check('with the machine that has channels the same document is grouped again', mapRows(h).some((r) => r.kind === 'channel'), mapList(h))
  await pickMachine(h, 'None (dialect defaults)')
  await waitForMachine(h, '')
  await h.waitFor(() => channelItem(h) === null && !mapRows(h).some((r) => r.kind === 'channel'), { timeout: 8000 })
  await h.idle()
  h.check('and choosing no machine takes the item and the grouping away again', channelItem(h) === null && JSON.stringify(mapList(h)) === JSON.stringify(p1), { item: channelState(h), map: mapList(h) })

  // ==================================================================== E. one file per channel
  const pair = await open(h, `${dir}/c06-part_CH1.nc`)
  await h.idle()
  h.check('a channel file with no machine has no item either', channelItem(h) === null && !!ctx.docs.get(pair), channelState(h))
  await machines.use('Plain lathe')
  h.check('nor with a machine that has no channels', channelItem(h) === null, channelState(h))
  h.check('and the program map has no channel rows', !mapRows(h).some((r) => r.kind === 'channel' || r.kind === 'sync'), mapList(h))
})
