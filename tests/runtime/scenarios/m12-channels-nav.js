// Sync-point navigation (plan §6 M12 H12 `m12-channels-nav`; WP12.5, §7.13): `Alt+F7`,
// `Shift+Alt+F7` and `Mod+Alt+P`, all through real key presses, because the binding is what is
// under test.
//
// **`Mod+Alt+P` is Monaco's own key on macOS**: Cmd+Option+P toggles "preserve case" in the
// editor's find widget, with the editor focused and no other condition, so the binding would
// swallow the key before gEdit saw it. `contrib/channels.ts` removes it (`keybindingRemovals`,
// §7.16 #153). The proof here is behavioural: with the find widget open and the editor focused,
// the key moves the cursor and Monaco's "preserve case" state stays off.
//
// **The marks** are the goldens': in `c10-alternating.nc` channel 1 waits on lines 11 and 26
// (the second one in its second section) and channel 2 on 19 and 33; in the pair
// `c06-part_CH1/CH2.nc` channel 1 waits on 10, 14 and 21, channel 2 on 9, 13 and 19.
// The k-th mark of an id in one channel meets the k-th of that id in the other.

import { scenario } from '../lib/index.js'
import { NC_DIR, REPO_FILE, activate, activeId, blockOf, channelMachines, context, goto, keys, message, open, press, ready, waitChannel } from './m12-common.js'

scenario('m12-channels-nav', { timeout: 240, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = await h.fixture(NC_DIR)
  const machines = channelMachines(h)
  await machines.add('Twin lathe', await blockOf(h, 'c10-alternating'))
  await machines.add('Pair lathe', await blockOf(h, 'c06-part_CH1'))

  /** Presses a combination and answers the cursor line once the editor has settled. @param {typeof keys.next} combo */
  const step = async (combo) => {
    await press(h, combo)
    return h.app.cursor().line
  }

  // ==================================================================== A. one program, two sections each
  const id = await open(h, `${dir}/c10-alternating.nc`)
  await machines.use('Twin lathe')
  await waitChannel(h, (s) => s.present)

  await goto(h, id, 6)
  h.check('Alt+F7 in channel 1 goes to its next wait code, line 11', (await step(keys.next)) === 11 && /11/.test(message(h)), { line: h.app.cursor().line, status: message(h) })
  h.check('and the next one, line 26, which is in channel 1\'s SECOND section (channel 2\'s waits in between are skipped)', (await step(keys.next)) === 26, h.app.cursor().line)
  const wrapped = await step(keys.next)
  h.check('past the last one it starts over at the first, and says so', wrapped === 11 && /started over/i.test(message(h)), { line: wrapped, status: message(h) })
  h.check('Shift+Alt+F7 goes the other way and wraps backwards to the last one', (await step(keys.prev)) === 26 && /started over/i.test(message(h)), { line: h.app.cursor().line, status: message(h) })
  h.check('and steps back to line 11', (await step(keys.prev)) === 11 && !/started over/i.test(message(h)), { line: h.app.cursor().line, status: message(h) })

  await goto(h, id, 14)
  h.check('from channel 2 the same key walks channel 2\'s waits: 19', (await step(keys.next)) === 19, h.app.cursor().line)
  h.check('then 33, in its second section', (await step(keys.next)) === 33, h.app.cursor().line)
  h.check('then starts over at 19', (await step(keys.next)) === 19, h.app.cursor().line)

  await goto(h, id, 2)
  h.check('outside every channel (the header) the key walks all the waits of the program, from the first', (await step(keys.next)) === 11, h.app.cursor().line)

  // Mod+Alt+P: the matching mark of the other channel.
  const find = /** @type {any} */ (ctx.editor.editorInstance()?.getContribution('editor.contrib.findController'))
  await ctx.commands.run('edit.find')
  await h.waitFor(() => !!document.querySelector('.find-widget.visible'), { timeout: 5000 })
  const preserveBefore = find.getState().preserveCase
  await goto(h, id, 11)
  h.check('Mod+Alt+P on channel 1\'s first wait goes to the matching one in channel 2, line 19', (await step(keys.partner)) === 19 && /channel 2/i.test(message(h)), { line: h.app.cursor().line, status: message(h) })
  h.check('the key reached gEdit and not Monaco: the find widget\'s "preserve case" did not change', find.getState().preserveCase === preserveBefore && preserveBefore === false, { before: preserveBefore, after: find.getState().preserveCase })
  h.check('and again from there, channel 1 answers (line 11): the partner of a mark is found both ways', (await step(keys.partner)) === 11, h.app.cursor().line)
  await goto(h, id, 26)
  h.check('the second wait of channel 1 (line 26) meets the second of channel 2 (line 33), not the first', (await step(keys.partner)) === 33, h.app.cursor().line)
  await goto(h, id, 8)
  const stay = await step(keys.partner)
  h.check('off a wait code the key moves nothing and says where to put the cursor', stay === 8 && /cursor on a wait code/i.test(message(h)), { line: stay, status: message(h) })
  ctx.editor.triggerAction('closeFindWidget')
  await h.idle()

  // ==================================================================== B. one file per channel
  await ctx.commands.run('file.close')
  await h.waitFor(() => !ctx.docs.get(id), { timeout: 8000 })
  const one = await open(h, `${dir}/c06-part_CH1.nc`)
  await machines.use('Pair lathe')
  const two = await open(h, `${dir}/c06-part_CH2.nc`)
  await machines.use('Pair lathe')
  await activate(h, one)
  await waitChannel(h, (s) => s.open === '1 2' && s.id === '1')

  await goto(h, one, 5)
  h.check('in a channel file Alt+F7 walks that file\'s waits: 10, 14, 21', JSON.stringify([await step(keys.next), await step(keys.next), await step(keys.next)]) === '[10,14,21]', h.app.cursor().line)
  h.check('and starts over inside the same file, never crossing into the other', (await step(keys.next)) === 10 && activeId(h) === one, { line: h.app.cursor().line, doc: activeId(h) })

  await goto(h, one, 10)
  await step(keys.partner)
  await waitChannel(h, (s) => s.id === '2')
  h.check('Mod+Alt+P crosses the document: channel 2\'s file is on screen, the cursor on its matching wait (line 9)', activeId(h) === two && h.app.cursor().line === 9 && /Channel 2/.test(message(h)), { doc: activeId(h), line: h.app.cursor().line, status: message(h) })
  h.check('and the status says which document it switched to', /c06-part_CH2/.test(message(h)), message(h))
  await step(keys.partner)
  await waitChannel(h, (s) => s.id === '1')
  h.check('back again: channel 1\'s file, line 10', activeId(h) === one && h.app.cursor().line === 10, { doc: activeId(h), line: h.app.cursor().line })
  await goto(h, one, 14)
  await step(keys.partner)
  h.check('a wait with no P (it names both paths) meets the one in the other file, line 13', activeId(h) === two && h.app.cursor().line === 13, { doc: activeId(h), line: h.app.cursor().line })

  // The partner channel closed: it says so and moves nothing.
  await ctx.commands.run('file.close')
  await h.waitFor(() => !ctx.docs.get(two), { timeout: 8000 })
  await activate(h, one)
  await goto(h, one, 21)
  await waitChannel(h, (s) => s.open === '1')
  const unmoved = await step(keys.partner)
  h.check('with the partner channel closed it says so and moves nothing', unmoved === 21 && activeId(h) === one && /Channel 2 is not open/i.test(message(h)), { line: unmoved, doc: activeId(h), status: message(h) })
})
