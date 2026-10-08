// One program, several channels (plan §6 M12 H12 `m12-channels-single`; X12, AD-32, WP12.5):
// the channel status item, the program map per channel, the tool list per channel and
// "Split into channel documents".
//
// **The program** is `channels/nc/fanuc-lathe/c10-alternating.nc`: four sections `O1001`,
// `O2001`, `O1002`, `O2002` that belong to channels 1, 2, 1, 2 (the first digit of the number
// names the channel), and a subprogram `O9001` after the last section that both call and that
// belongs to neither. Its ranges are the golden's (`resolve/c10-alternating.json`, read here
// from disk): channel 1 holds lines 5-12 and 21-27, channel 2 lines 13-20 and 28-34, and lines
// 1-4 and 35-41 are outside every channel. The machine is the golden's own channel block.
//
// What the plan words as "Channel 1 of 2" is the *multi-file* wording (`m12-channels-multi`);
// with sections in one file the item reads "Channel: <name>", and the scenario reads the
// channel off `data-channel-id` instead of the text.
//
// **The split** is a one-way copy for reading: two untitled tabs whose text is the program's
// header plus that channel's ranges, in document order. The expected text is built here from the
// golden's ranges and the program's lines, never from what the command made. The command warns
// once per session, and writes nothing: the folder holds the same files afterwards.

import { scenario } from '../lib/index.js'
import { listDir } from './m2-common.js'
import { runFromTools } from './m10-common.js'
import { runScript, writeUserScript } from './m5-common.js'
import { pickMachine, waitForMachine } from './m6-common.js'
import {
  NC_DIR,
  REPO_FILE,
  activeId,
  blockOf,
  channelItem,
  channelMachines,
  channelState,
  context,
  golden,
  goto,
  mapByChannel,
  mapRows,
  message,
  open,
  ready,
  report,
  waitChannel,
} from './m12-common.js'

/** The lines of a program as the editor numbers them. @param {string} text */
const linesOf = (text) => text.split('\n')

/** Lines `from..to` (1-based, inclusive) of `lines`. @param {string[]} lines @param {number} from @param {number} to */
const slice = (lines, from, to) => lines.slice(from - 1, to)


/**
 * A user script that reports what `gedit_nc.channels(ctx)` and its helpers tell a script about
 * the document (WP12.6). One row per fact, `key|value`.
 */
const CHANNEL_REPORT = `# /// gedit
# name = "Harness channel report"
# description = "Reports the channel context of the document."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H12). Not a bundled script."""

import gedit_nc

ctx = gedit_nc.load_context()
lines = gedit_nc.read_input()
member = gedit_nc.channels(ctx)


def spans(ranges):
    return ",".join("%d-%d" % (r["startLine"], r["endLine"]) for r in ranges) or "(none)"


rows = [{"key": "layout", "value": member["layout"]}]
for channel in member["list"]:
    rows.append({"key": "channel " + channel["id"], "value": spans(channel.get("ranges", []))})
rows.append({"key": "outside", "value": spans(member.get("outside", []))})
rows.append({"key": "marks", "value": ",".join("%s@%d/%s" % (m["id"], m["line"], m["channel"]) for m in gedit_nc.sync_marks(ctx)) or "(none)"})
rows.append({"key": "marks of 2", "value": ",".join("%d" % m["line"] for m in gedit_nc.sync_marks(ctx, "2")) or "(none)"})
rows.append({"key": "channel_of 23", "value": str(gedit_nc.channel_of(ctx, 23))})
rows.append({"key": "channel_of 2", "value": str(gedit_nc.channel_of(ctx, 2))})
rows.append({"key": "lines of 2", "value": str(len(gedit_nc.channel_lines(ctx, lines, "2")))})
rows.append({"key": "first line numbers of 1", "value": ",".join(str(n) for n in gedit_nc.channel_line_numbers(ctx, lines, "1")[:2])})
rows.append({"key": "outside lines", "value": str(len(gedit_nc.outside_lines(ctx, lines)))})

gedit_nc.report("Channel report", [{"key": "key", "label": "Fact"}, {"key": "value", "label": "Value"}], rows)
`

scenario('m12-channels-single', { timeout: 240, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const ref = await golden(h, 'c10-alternating')
  const dir = await h.fixture(NC_DIR)
  const path = `${dir}/c10-alternating.nc`
  const text = await h.disk.read(path)
  const lines = linesOf(text)
  const ranges = Object.fromEntries(ref.expect.sections.map((/** @type {any} */ s) => [s.channel, s.ranges]))
  const id = await open(h, path)

  // ==================================================================== A. no machine, no item
  h.check('with no machine the document has no channel item', channelItem(h) === null, channelState(h))
  h.check('the document is read as a Fanuc lathe program', ctx.docs.get(id)?.profileId === 'fanuc-lathe', ctx.docs.get(id)?.profileId)
  h.check('and the split command is not on offer for it', ctx.commands.isEnabled('channels.splitToDocuments') === false)

  // ==================================================================== B. the machine, the item
  const machines = channelMachines(h)
  await machines.add('Twin lathe', await blockOf(h, 'c10-alternating'))
  await machines.use('Twin lathe')
  const first = await waitChannel(h, (s) => s.present)
  h.check('with a machine that has channels, the document gains the channel item, for one program', first.present && first.layout === 'single-file' && first.count === '2', first)
  h.check('and the split command is on offer', ctx.commands.isEnabled('channels.splitToDocuments') === true)

  // The item follows the cursor, across BOTH sections of a channel.
  /** @type {[number, string, string][]} */
  const walk = [
    [6, '1', 'inside channel 1, first section (lines 5-12)'],
    [14, '2', 'inside channel 2, first section (lines 13-20)'],
    [23, '1', 'back in channel 1, its second section (lines 21-27)'],
    [30, '2', 'in channel 2, its second section (lines 28-34)'],
    [12, '1', 'the last line of the first section is still channel 1 (the section end belongs to it)'],
    [2, '', 'the header lines belong to no channel'],
    [37, '', 'nor does the shared subprogram after the last section'],
  ]
  for (const [line, want, why] of walk) {
    await goto(h, id, line)
    const state = await waitChannel(h, (s) => s.id === want)
    h.check(`line ${line} - ${why}`, state.id === want, { line, want, got: state.id, text: state.text })
  }
  const outside = channelState(h)
  h.check('outside the channels the item says so, and keeps its counts', outside.id === '' && outside.count === '2' && outside.layout === 'single-file', outside)
  h.check('the golden gives channel 1 two sections and channel 2 two', ranges['1'].length === 2 && ranges['2'].length === 2, ranges)

  // ==================================================================== C. the program map
  await goto(h, id, 1)
  await h.waitFor(() => mapRows(h).some((r) => r.kind === 'channel'), { timeout: 10000 })
  await h.idle()
  const rows = mapRows(h)
  const channelRows = rows.filter((r) => r.kind === 'channel')
  h.check('the map has one row per channel and one for the lines no channel owns', JSON.stringify(channelRows.map((r) => r.channelId)) === JSON.stringify(['1', '2', '']), channelRows.map((r) => `${r.channelId}|${r.text}`))
  h.check('the channel rows are named after the channels, and the last one "Outside the channels"', channelRows[0].text.includes('Channel 1') && channelRows[1].text.includes('Channel 2') && channelRows[2].text.length > 0, channelRows.map((r) => r.text))
  const by = mapByChannel(h)
  const toolsOf = (/** @type {string} */ channel) => (by[channel] ?? []).filter((r) => r.kind === 'tool').map((r) => r.line)
  h.check('channel 1 carries the tools of BOTH its sections (T1 on line 7, T3 on 22)', JSON.stringify(toolsOf('1')) === JSON.stringify([7, 22]), by['1']?.map((r) => `${r.kind}@${r.line}`))
  h.check('channel 2 its two (T2 on line 15, T4 on 29)', JSON.stringify(toolsOf('2')) === JSON.stringify([15, 29]), by['2']?.map((r) => `${r.kind}@${r.line}`))
  const syncOf = (/** @type {string} */ channel) => (by[channel] ?? []).filter((r) => r.kind === 'sync').map((r) => r.line)
  h.check('the blocking wait codes are rows of their channel: channel 1 on 11 and 26', JSON.stringify(syncOf('1')) === JSON.stringify([11, 26]), by['1']?.map((r) => `${r.kind}@${r.line}`))
  h.check('channel 2 on 19 and 33', JSON.stringify(syncOf('2')) === JSON.stringify([19, 33]), by['2']?.map((r) => `${r.kind}@${r.line}`))
  const outsideRows = by[''] ?? []
  h.check('"Outside the channels" holds what only it owns: the shared subprogram O9001 on line 35, no tool', outsideRows.some((r) => r.line === 35) && !outsideRows.some((r) => r.kind === 'tool' || r.kind === 'sync'), outsideRows.map((r) => `${r.kind}@${r.line}`))
  h.check('no tool or wait row is left at the top level', rows.filter((r) => r.depth === 0 && ['tool', 'sync'].includes(r.kind)).length === 0, rows.filter((r) => r.depth === 0).map((r) => `${r.kind}@${r.line}`))

  // Clicking a row goes to its line.
  const sync26 = rows.find((r) => r.kind === 'sync' && r.line === 26)
  if (!sync26) throw new Error('no sync row on line 26')
  h.click(sync26.element)
  await h.waitFor(() => h.app.cursor().line === 26, { timeout: 4000 })
  const landed = await waitChannel(h, (s) => s.id === '1')
  h.check('a click on a wait-code row goes to its line, in the second section of channel 1', h.app.cursor().line === 26 && landed.id === '1', { line: h.app.cursor().line, channel: landed.id })

  // ==================================================================== D. the tool list
  const run = await runFromTools(h, 'bundled:tool_list.py', undefined, 60000)
  const listed = run.report
  const keys = (listed.columns ?? []).map((/** @type {any} */ c) => c.key)
  const tools = (listed.rows ?? []).map((/** @type {any} */ r) => ({ channel: r.channel, tool: r.tool, line: r.line }))
  h.check('the tool list starts with a Channel column', keys[0] === 'channel' && keys.includes('tool'), keys)
  h.check(
    'its rows are grouped by channel in the machine\'s order: T1 and T3 in channel 1, T2 and T4 in channel 2, with the document\'s line numbers',
    JSON.stringify(tools) ===
      JSON.stringify([
        { channel: 'Channel 1', tool: 'T1', line: 7 },
        { channel: 'Channel 1', tool: 'T3', line: 22 },
        { channel: 'Channel 2', tool: 'T2', line: 15 },
        { channel: 'Channel 2', tool: 'T4', line: 29 },
      ]),
    tools,
  )
  h.check('and the subprogram, which calls no tool, adds no row of its own', !tools.some((t) => t.channel !== 'Channel 1' && t.channel !== 'Channel 2'), tools)
  h.check('the tool list changed nothing', !ctx.docs.get(id)?.dirty)


  // ==================================================================== D2. what a script is told
  const scriptId = await writeUserScript(h, 'rh_channel_report.py', CHANNEL_REPORT)
  /** `key|value` of the rows of the report on screen. */
  const facts = () => (/** @type {any[]} */ (report(h)?.rows ?? [])).map((r) => `${r.key}|${r.value}`)
  await runScript(h, scriptId)
  await h.waitFor(() => (report(h)?.title ?? '') === 'Channel report', { timeout: 30000 })
  const told = facts()
  h.check(
    'a script is handed the channels: the layout, the ranges of both sections of each, what lies outside, the wait codes by channel',
    JSON.stringify(told.slice(0, 5)) ===
      JSON.stringify(['layout|single-file', 'channel 1|5-12,21-27', 'channel 2|13-20,28-34', 'outside|1-4,35-41', 'marks|M901@11/1,M901@19/2,M902@26/1,M902@33/2']),
    told,
  )
  h.check(
    'and the helpers answer from them: the marks of one channel, the channel of a line (None outside), the lines a channel runs as one program (15), their document line numbers, the lines outside (11)',
    JSON.stringify(told.slice(5)) === JSON.stringify(['marks of 2|19,33', 'channel_of 23|1', 'channel_of 2|None', 'lines of 2|15', 'first line numbers of 1|5,6', 'outside lines|11']),
    told.slice(5),
  )
  await pickMachine(h, 'None (dialect defaults)')
  await waitForMachine(h, '')
  await runScript(h, scriptId)
  await h.waitFor(() => facts()[0] === 'layout|none', { timeout: 30000 })
  h.check('without channels the same script is told "none" and gets empty answers, and does not fail', facts()[0] === 'layout|none' && facts().includes('channel_of 23|None') && facts().includes('lines of 2|0'), facts())
  await pickMachine(h, 'Twin lathe')
  await waitForMachine(h, machines.ids['Twin lathe'])
  await goto(h, id, 1)

  // ==================================================================== E. split
  const before = await listDir(h, dir)
  const docsBefore = ctx.docs.all().length
  const running = ctx.commands.run('channels.splitToDocuments')
  const alert = await h.alert.wait({ timeout: 8000 })
  h.check('the first split says what it is: a copy for reading, whose changes do not come back', !!alert && /do not come back/i.test((alert.texts ?? []).join(' ')), alert)
  await h.alert.click('Split')
  await running
  await h.idle()
  const split = ctx.docs.all().slice(docsBefore)
  h.check('it made two untitled documents', split.length === 2 && split.every((d) => d.path === null || d.path === undefined), split.map((d) => `${d.title}|${d.path}`))
  const header = slice(lines, 1, 4)
  const want1 = [...header, ...slice(lines, 5, 12), ...slice(lines, 21, 27)].join('\n')
  const want2 = [...header, ...slice(lines, 13, 20), ...slice(lines, 28, 34)].join('\n')
  const got1 = ctx.editor.getLines(split[0].id, 1, ctx.editor.getLineCount(split[0].id)).join('\n')
  const got2 = ctx.editor.getLines(split[1].id, 1, ctx.editor.getLineCount(split[1].id)).join('\n')
  h.check('the first is the header and channel 1\'s two sections, in document order', got1 === want1, { got: got1.split('\n').length, want: want1.split('\n').length })
  h.check('the second is the header and channel 2\'s two sections', got2 === want2, { got: got2.split('\n').length, want: want2.split('\n').length })
  h.check('the shared subprogram is in neither', !got1.includes('O9001 (SHARED') && !got2.includes('O9001 (SHARED'))
  h.check('the first of them is on screen, and they are named after the program and the channel', activeId(h) === split[0].id && /Channel 1/.test(split[0].title) && /Channel 2/.test(split[1].title), split.map((d) => d.title))
  h.check('a message says how many were made', /2 documents/.test(message(h)), message(h))
  h.check('and nothing was written: the folder holds the same files', JSON.stringify(await listDir(h, dir)) === JSON.stringify(before), { before, after: await listDir(h, dir) })
  for (const d of split) {
    h.check(`and "${d.title}" has no file behind it`, (await h.disk.stat(`${dir}/${d.title}`)) === null)
  }

  // The warning is once per session: the second split goes straight through.
  ctx.docs.activate(id)
  await h.waitFor(() => activeId(h) === id, { timeout: 5000 })
  const second = await ctx.commands.run('channels.splitToDocuments')
  await h.idle()
  h.check('the second split asks nothing and makes two more', second === true && !(await h.alert.visible()) && ctx.docs.all().length === docsBefore + 4, { docs: ctx.docs.all().length, was: docsBefore })
  h.check('the original is as it was', ctx.docs.get(id)?.dirty !== true && ctx.editor.getLines(id, 1, ctx.editor.getLineCount(id)).join('\n') === text.replace(/\n$/, '\n'), { dirty: ctx.docs.get(id)?.dirty })
})
