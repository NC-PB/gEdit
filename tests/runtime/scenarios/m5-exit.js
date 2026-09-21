// The Phase 1 exit criteria (plan §5 M5 H5 `m5-exit-criteria`, `m5-exit-criteria-nopython`).
//
// One CNC programmer's afternoon, in the order they would do it: open the three posted
// programs, find their way around one of them, clean it up and renumber it, scale the
// feeds and the speeds of the other two with the bundled scripts, look at the tool list,
// compare against what is on disk, and save. Then the bytes on disk are compared with the
// goldens in `tests/fixtures/exit/expected/` — **not** the text in the editor, because the
// claim Phase 1 makes is about the file a control will read: the same encoding, the same
// line ending, the BOM kept and the NUL leader and trailer kept.
//
// The second scenario is the same afternoon on a machine with no Python. Only the two
// script steps fall away; everything else has to work exactly as before, which is the
// other half of the claim.
//
// **Which file gets which job**, so a golden can be read by eye (see
// `tests/fixtures/exit/README.md`):
//
//   fanuc-cp1252-crlf.nc          navigate (F7, Ctrl+G), remove empty lines, remove
//                                 comments, renumber, compare, save
//   fanuc-utf8-lf-packed-nul.nc   scale feeds to 90 %, scale speeds to 110 %, save
//   klartext-utf8bom-crlf.h       the same two scripts, the tool list, save
//
// **What is deliberately not driven with a Cmd key.** Open and Save All are commands here,
// not `Cmd+O` and `Mod+Alt+S`: those bindings are `m1-keys`' subject and a Cmd key needs
// the app to own the keyboard, which turns this scenario into a report about the desktop
// rather than about the app. The two keys that *are* pressed — F7 and Ctrl+G — are plain
// keys, they are the feature under test in step 2, and they are delivered either way.

import { scenario } from '../lib/index.js'
import { setInput } from './m2-common.js'
import { runTransform } from './m4-common.js'
import {
  context,
  message,
  messageIsError,
  pythonProbe,
  read,
  ready,
  redo,
  ribbonTab,
  runScript,
  scriptService,
  showPanel,
  textOf,
  undo,
} from './m5-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const FANUC = 'fanuc-cp1252-crlf.nc'
const PACKED = 'fanuc-utf8-lf-packed-nul.nc'
const KLARTEXT = 'klartext-utf8bom-crlf.h'

/** The three tool changes of the Fanuc program, and the block Ctrl+G looks up. */
const TOOL_LINES = [9, 20, 29]
const GOTO_BLOCK = 'N120'
const GOTO_LINE = 12

/**
 * Compares a saved file with its golden, byte for byte, and says where they part.
 * @param {Harness} h
 * @param {string} name
 * @param {string} produced absolute path of the file the app wrote
 * @param {string} golden absolute path of the expected bytes
 */
async function sameBytes(h, name, produced, golden) {
  const got = await h.disk.hex(produced)
  const want = await h.disk.hex(golden)
  if (got === want) {
    h.check(`${name}: the saved bytes are the golden`, true, { bytes: got.split(' ').length })
    return
  }
  const a = got.split(' ')
  const b = want.split(' ')
  let at = 0
  while (at < a.length && at < b.length && a[at] === b[at]) at++
  h.check(`${name}: the saved bytes are the golden`, false, {
    firstDifferenceAtByte: at,
    gotLength: a.length,
    wantLength: b.length,
    got: a.slice(Math.max(0, at - 8), at + 24).join(' '),
    want: b.slice(Math.max(0, at - 8), at + 24).join(' '),
    gotText: await h.disk.read(produced).catch(() => '(not text)'),
  })
}

/**
 * One transform, with its undo and its redo checked: the plan asks for each cleanup step
 * to be a single undo step, which is what makes a mistake recoverable on a posted program.
 * @param {Harness} h
 * @param {string} docId
 * @param {string} commandId
 * @param {{ form?: boolean }} [o]
 */
async function stepWithUndo(h, docId, commandId, o = {}) {
  const before = textOf(h, docId)
  await runTransform(h, commandId, { form: o.form === true })
  const after = textOf(h, docId)
  h.check(`${commandId} changed the program`, after !== before, { message: message(h) })
  await undo(h)
  h.check(`${commandId} is one undo step`, textOf(h, docId) === before, { got: textOf(h, docId).slice(0, 200), want: before.slice(0, 200) })
  await redo(h)
  h.check(`${commandId} comes back with one redo`, textOf(h, docId) === after, { got: textOf(h, docId).slice(0, 200), want: after.slice(0, 200) })
  return after
}

/**
 * The whole afternoon. `withPython` decides whether the two script steps happen.
 * @param {Harness} h
 * @param {boolean} withPython
 */
async function exitCriteria(h, withPython) {
  const ctx = context(h)
  await ready(h)
  const service = scriptService(h)
  const dir = await h.fixture('exit')
  const golden = `${dir}/${withPython ? 'expected' : 'expected-nopython'}`
  const paths = { fanuc: `${dir}/${FANUC}`, packed: `${dir}/${PACKED}`, klartext: `${dir}/${KLARTEXT}` }

  const probe = await pythonProbe(h)
  h.check(
    withPython ? 'Python is available for this run' : 'Python is not available for this run',
    probe?.ok === withPython,
    probe,
  )

  // ============================================================ 1. open all three at once
  await h.dialogs.queue('open', [paths.fanuc, paths.packed, paths.klartext])
  const opened = await ctx.files.open()
  h.check('one multi-select Open takes all three programs', opened.length === 3, opened)
  await h.waitFor(() => h.qa('doc-tab').length === 3, { timeout: 20000 })
  const id = {
    fanuc: ctx.docs.byPath(paths.fanuc)?.id ?? '',
    packed: ctx.docs.byPath(paths.packed)?.id ?? '',
    klartext: ctx.docs.byPath(paths.klartext)?.id ?? '',
  }
  h.check('each one is a tab of its own, and the starter buffer gave way to them', h.qa('doc-tab').length === 3 && id.fanuc && id.packed && id.klartext, h.qa('doc-tab').map((e) => e.dataset.path))

  const meta = (/** @type {string} */ docId) => ctx.docs.get(docId)
  h.check(
    'the Windows-1252 program was read as Windows-1252 with CRLF, and its accented text survived',
    meta(id.fanuc)?.encoding.encoding === 'windows-1252' && meta(id.fanuc)?.encoding.hasBom === false && meta(id.fanuc)?.eol === 'crlf' && textOf(h, id.fanuc).includes('BRACKET – Ø10 MÜLLER'),
    { encoding: meta(id.fanuc)?.encoding, eol: meta(id.fanuc)?.eol, line3: textOf(h, id.fanuc).split('\n')[2] },
  )
  h.check(
    'the NUL leader and trailer were kept outside the text, and the document is not modified by them (D2)',
    meta(id.packed)?.nul?.leader === 32 && meta(id.packed)?.nul?.trailer === 16 && meta(id.packed)?.nul?.stripped === 0 && meta(id.packed)?.dirty === false,
    { nul: meta(id.packed)?.nul, dirty: meta(id.packed)?.dirty },
  )
  h.check(
    'the Klartext program was read as UTF-8 with a BOM and CRLF, and detected as Klartext',
    meta(id.klartext)?.encoding.encoding === 'utf-8' && meta(id.klartext)?.encoding.hasBom === true && meta(id.klartext)?.eol === 'crlf' && meta(id.klartext)?.profileId === 'heidenhain-klartext',
    { encoding: meta(id.klartext)?.encoding, eol: meta(id.klartext)?.eol, profile: meta(id.klartext)?.profileId },
  )
  h.check('and the two Fanuc programs as Fanuc', meta(id.fanuc)?.profileId === 'fanuc-gcode' && meta(id.packed)?.profileId === 'fanuc-gcode', {
    fanuc: meta(id.fanuc)?.profileId,
    packed: meta(id.packed)?.profileId,
  })

  // ==================================================== 2. find the way around the program
  ctx.docs.activate(id.fanuc)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id.fanuc, { timeout: 10000 })
  ctx.editor.reveal(id.fanuc, 1, 1)
  await h.idle()
  h.focusEditor()

  /** @type {number[]} */
  const stops = []
  for (let i = 0; i < TOOL_LINES.length; i++) {
    await h.nativeKeys([{ key: 'F7' }])
    await h.idle()
    stops.push(h.app.cursor().line)
  }
  h.check(`F7 steps through the three tool changes (${TOOL_LINES.join(', ')})`, JSON.stringify(stops) === JSON.stringify(TOOL_LINES), { stops, expected: TOOL_LINES, mapped: ctx.outline.toolLines(id.fanuc) })
  h.check('the program map shows them too', ctx.outline.toolLines(id.fanuc).join() === TOOL_LINES.join(), ctx.outline.toolLines(id.fanuc))

  await h.nativeKeys([{ key: 'g', mods: ['ctrl'] }])
  const prompt = await h.waitFor(() => h.q('modal', { modal: 'prompt' }), { timeout: 8000 })
  h.check('Ctrl+G opens the go-to prompt', !!prompt)
  setInput(h.q('form-field', { field: 'value' }), GOTO_BLOCK)
  await h.waitFor(() => /** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled === false, { timeout: 5000 })
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal'), { timeout: 5000 })
  await h.idle()
  h.check(`${GOTO_BLOCK} goes to the block, which is line ${GOTO_LINE}, not line 120`, h.app.cursor().line === GOTO_LINE, { cursor: h.app.cursor(), line: ctx.editor.getLines(id.fanuc, GOTO_LINE, GOTO_LINE) })

  // ============================================ 3. clean it up and renumber it
  await ribbonTab(h, 'nc')
  ctx.editor.reveal(id.fanuc, 1, 1)
  await h.idle()
  await stepWithUndo(h, id.fanuc, 'nc.removeEmptyLines')
  await stepWithUndo(h, id.fanuc, 'nc.removeComments', { form: true })
  const cleaned = await stepWithUndo(h, id.fanuc, 'nc.renumber', { form: true })

  h.check('the program name comment survived "remove comments"', cleaned.includes('O4001 (BRACKET – Ø10 MÜLLER)'), cleaned.split('\n')[1])
  h.check('every other comment is gone', !cleaned.includes('(T1 D10 END MILL)') && !cleaned.includes('(ROUGH)') && !cleaned.includes('WRITTEN FOR GEDIT'), cleaned.split('\n').filter((l) => l.includes('(')).slice(0, 5))
  h.check('the blank lines are gone', !/\n\n/.test(cleaned), cleaned.split('\n').findIndex((l) => l === '' ))
  h.check('the blocks are renumbered from N10 in steps of 10', cleaned.includes('\nN10 G21') && cleaned.includes('\nN270 M30'), cleaned.split('\n').slice(2, 5))
  h.check('the tab is marked as modified', h.q('doc-tab', { docId: id.fanuc })?.dataset.dirty === '1')

  // =================================== 4. and 5. the bundled scripts (only with Python)
  if (withPython) {
    for (const [name, docId] of /** @type {[string, string][]} */ ([['packed', id.packed], ['klartext', id.klartext]])) {
      ctx.docs.activate(docId)
      await h.waitFor(() => h.q('editor-host')?.dataset.docId === docId, { timeout: 10000 })
      ctx.editor.reveal(docId, 1, 1)
      await h.idle()

      const before = textOf(h, docId)
      await runScript(h, 'bundled:scale_feed.py', { form: true, fields: { percent: 90 } })
      h.check(`${name}: the feeds were scaled to 90 %`, textOf(h, docId) !== before && /replaced/.test(message(h)) && !messageIsError(h), message(h))
      const feeds = textOf(h, docId)
      await runScript(h, 'bundled:scale_speed.py', { form: true, fields: { percent: 110 } })
      h.check(`${name}: the speeds were scaled to 110 %`, textOf(h, docId) !== feeds && /replaced/.test(message(h)) && !messageIsError(h), message(h))
    }

    h.check('the Klartext cycle feed Q206 was reported, not scaled', textOf(h, id.klartext).includes('Q206=150'), textOf(h, id.klartext).split('\n').find((l) => l.includes('Q206')))
    h.check('the feed of a TOOL CALL was scaled', textOf(h, id.klartext).includes('TOOL CALL 1 Z S3300 F720'), textOf(h, id.klartext).split('\n')[5])
    h.check('the packed Fanuc words were rewritten in place', textOf(h, id.packed).includes('N60G1Z-2.F225.') && textOf(h, id.packed).includes('N30S3300M3'), textOf(h, id.packed).split('\n').slice(5, 9))

    // ------------------------------------------------------------ 5. the tool list
    ctx.docs.activate(id.klartext)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === id.klartext, { timeout: 10000 })
    const beforeReport = textOf(h, id.klartext)
    await runScript(h, 'bundled:tool_list.py', { form: true })
    h.check('the tool list reports without touching the program', textOf(h, id.klartext) === beforeReport && /Results panel/.test(message(h)) && !messageIsError(h), message(h))

    await showPanel(h, 'results')
    const rows = h.qa('results-row').filter((e) => (e.dataset.line ?? '') !== '')
    h.check('it lists the three Klartext tools', rows.length === 3, h.qa('results-row').map((e) => `${e.dataset.line}:${(e.textContent ?? '').trim().slice(0, 40)}`))
    h.check('each row points into the Klartext document', rows.every((e) => e.dataset.docId === id.klartext), rows.map((e) => e.dataset.docId))
    const wanted = Number(rows[2]?.dataset.line ?? 0)
    h.click(rows[2])
    await h.waitFor(() => h.app.cursor().line === wanted, { timeout: 5000 })
    h.check(`a row click jumps to the line of its tool call (${wanted})`, h.app.cursor().line === wanted && ctx.editor.getLines(id.klartext, wanted, wanted)[0].includes('TOOL CALL'), { cursor: h.app.cursor(), line: ctx.editor.getLines(id.klartext, wanted, wanted) })
  } else {
    // The script commands are there, and they say why they are off.
    await ribbonTab(h, 'tools')
    h.check('the Tools group says Python was not found', (h.q('scripts-menu')?.textContent ?? '').includes('Python 3.9 or newer was not found'), h.q('scripts-menu')?.textContent?.trim())
    h.check('no script is offered to run', h.qa('script-item').length === 0)
    h.check('the run commands are disabled', ctx.commands.has('script.runPicker') && !ctx.commands.isEnabled('script.runPicker'))
    await service.run('bundled:scale_feed.py')
    await h.idle()
    h.check('asking for one anyway answers with the message', messageIsError(h) && message(h) === 'Python 3.9 or newer was not found, so the script commands are off', message(h))
    h.check('and the two other programs were not touched', read(service.running) === null && h.q('doc-tab', { docId: id.packed })?.dataset.dirty !== '1' && h.q('doc-tab', { docId: id.klartext })?.dataset.dirty !== '1', {
      packed: h.q('doc-tab', { docId: id.packed })?.dataset.dirty,
      klartext: h.q('doc-tab', { docId: id.klartext })?.dataset.dirty,
    })
  }

  // ======================================== 6. compare the cleaned program with what is on disk
  ctx.docs.activate(id.fanuc)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id.fanuc, { timeout: 10000 })
  // Not awaited: `compare.with` opens the source picker and its promise only settles once
  // the pick is answered — and this scenario is the one answering it. Awaiting it here
  // deadlocks the run (the same rule `m5-common.js` states for a script's parameter form,
  // and what `m2-compare.js` does with `void ctx.commands.run('compare.withSaved', …)`).
  void ctx.commands.run('compare.with')
  await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
  const sources = h.qa('quick-pick-item').map((e) => e.textContent?.trim().split('\n')[0])
  h.check('Compare offers the saved version first', sources[0]?.startsWith('Saved version') === true, sources)
  h.click(h.q('quick-pick-item', { index: 0 }))
  await h.waitFor(() => h.q('compare-view'), { timeout: 20000 })
  h.check('the comparison is against the saved version, and the editor gave way to it', h.q('compare-view')?.dataset.source === 'saved' && !h.q('editor-host'), h.q('compare-view')?.dataset.source)
  await h.waitFor(() => h.q('compare-view')?.querySelector('.monaco-diff-editor'), { timeout: 20000 })
  const changed = await h.waitFor(() => {
    const n = h.q('compare-view')?.querySelectorAll('.line-delete, .line-insert, .char-delete, .char-insert').length ?? 0
    return n > 0 ? n : null
  }, { timeout: 20000, interval: 100 })
  h.check('and it shows the differences the cleanup made', (changed ?? 0) > 0, { markedRegions: changed })

  await ctx.commands.run('compare.close')
  await h.waitFor(() => !h.q('compare-view') && h.q('editor-host'), { timeout: 10000 })
  h.check('closing it puts the program back', !h.q('compare-view') && h.q('editor-host')?.dataset.docId === id.fanuc)

  // ================================================================= 7. Save All, and the bytes
  const dirtyBefore = h.qa('doc-tab', { dirty: '1' }).length
  h.check(withPython ? 'all three programs are waiting to be saved' : 'only the cleaned program is waiting to be saved', dirtyBefore === (withPython ? 3 : 1), h.qa('doc-tab').map((e) => `${e.dataset.path?.split('/').pop()}:${e.dataset.dirty}`))
  const saved = await ctx.commands.run('file.saveAll')
  await h.waitFor(() => h.qa('doc-tab', { dirty: '1' }).length === 0, { timeout: 20000 })
  h.check('Save All wrote every modified program', saved === true && h.qa('doc-tab', { dirty: '1' }).length === 0, h.qa('doc-tab').map((e) => `${e.dataset.path?.split('/').pop()}:${e.dataset.dirty}`))

  await sameBytes(h, FANUC, paths.fanuc, `${golden}/${FANUC}`)
  await sameBytes(h, PACKED, paths.packed, `${golden}/${PACKED}`)
  await sameBytes(h, KLARTEXT, paths.klartext, `${golden}/${KLARTEXT}`)

  // The three byte-level claims again, named, so a failure says which one broke.
  const fanucHex = await h.disk.hex(paths.fanuc, 8)
  const klartextHex = await h.disk.hex(paths.klartext, 3)
  const packedHex = await h.disk.hex(paths.packed, 33)
  h.check('the Windows-1252 file was written back as Windows-1252 with CRLF and no BOM', !fanucHex.startsWith('ef bb bf') && (await h.disk.hex(paths.fanuc)).includes('0d 0a'), fanucHex)
  h.check('the Klartext file kept its BOM', klartextHex === 'ef bb bf', klartextHex)
  h.check('the packed file kept its NUL leader', packedHex.split(' ').slice(0, 32).every((b) => b === '00') && packedHex.split(' ')[32] === '28', packedHex)
  const packedAll = (await h.disk.hex(paths.packed)).split(' ')
  h.check('and its NUL trailer', packedAll.slice(-16).every((b) => b === '00') && packedAll[packedAll.length - 17] === '0a', packedAll.slice(-20).join(' '))
  h.check('the packed file is still LF only', !(await h.disk.hex(paths.packed)).includes('0d 0a'))
}

scenario('m5-exit-criteria', { timeout: 600 }, async (h) => {
  await exitCriteria(h, true)
})

scenario('m5-exit-criteria-nopython', { timeout: 600, python: '{run}/no-such-folder/python3' }, async (h) => {
  await exitCriteria(h, false)
})
