// Content gEdit refuses to edit as text, and saves that must not touch the file:
// a refused file leaves the open document alone, and saving an unchanged buffer writes
// nothing, whichever way it is triggered.
//
// M1: the codec decodes what M0 refused. UTF-16 with a byte order mark is read and
// written back (§7.2), and so is a punched-tape program with NUL bytes inside it — those
// are stripped with a count and the document is marked modified. What is left is the
// AD-7 rule: a file whose NUL share between leader and trailer is above 10 % is data,
// not a program. `m1-encoding2` covers the files that now open; this scenario keeps the
// refusal and the "a save must not touch the file" half.
//
// NEEDS A FREE SCREEN, for the undo check near the end: Cmd+Z is a key equivalent of the
// macOS Edit menu, so the event only reaches Monaco while the app is the active
// application. It fails the same way on M0 (see the H1 hand-off note).

import { scenario } from '../lib/index.js'

const REFUSED = [{ file: 'nul-heavy.bin', why: /% NUL bytes/ }]

/** Files M0 refused and M1 reads. Their round trip belongs to `m1-encoding2`. */
const NO_LONGER_REFUSED = [
  { file: 'utf16le-bom.nc', label: 'UTF-16 LE', stripped: false },
  { file: 'utf16be-bom.nc', label: 'UTF-16 BE', stripped: false },
  // Inner NULs are stripped with a count, which marks the document modified (AD-7).
  { file: 'nul-inside.nc', label: 'UTF-8', stripped: true },
]

scenario('m0-fix3', { timeout: 180 }, async (h) => {
  const run = h.cfg.run
  h.allowErrors(/Could not open/)
  const encodingLabel = () => h.q('status-item', { item: 'encoding' })?.textContent
  const state = async () => ({
    title: await h.title(),
    text: h.app.text(),
    docId: h.q('editor-host')?.dataset.docId,
    profile: h.app.activeProfile(),
    encoding: encodingLabel(),
  })
  /** The path of the open document, read from what Save As suggests (then cancelled). */
  const currentPath = async () => {
    const from = h.dialogs.calls().length
    await h.dialogs.queue('save', null)
    h.focusEditor()
    await h.nativeKeys([{ key: 's', mods: ['cmd', 'shift'] }])
    const call = await h.waitFor(() => h.dialogs.calls().slice(from).find((c) => c.kind === 'save' && c.doneAt))
    return call?.args.options.defaultPath ?? null
  }
  const save = async () => {
    h.focusEditor()
    await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  }

  // ---------------------------------------------------------------- Save As for the untitled buffer
  const untitled = `${run}/untitled-saved.nc`
  let calls = h.dialogs.calls().length
  await h.dialogs.queue('save', untitled)
  await save()
  await h.waitFor(async () => (await h.title()) === 'untitled-saved.nc — gEdit')
  const first = h.dialogs.calls().slice(calls)
  h.check(
    'Cmd+S on the untitled buffer opens Save As and writes the file',
    first.length === 1 && first[0].args.options.defaultPath === 'program.nc' && (await h.disk.read(untitled)).includes('O1000'),
    { dialogs: first, title: await h.title() },
  )

  // ---------------------------------------------------------------- refused content
  const baseline = await h.fixture('nc/encoding/utf8-lf.nc')
  await h.dialogs.queue('open', baseline)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'utf8-lf.nc — gEdit')
  const baselineHex = await h.disk.hex(baseline)

  for (const bad of REFUSED) {
    const path = await h.fixture(`nc/encoding/${bad.file}`)
    const before = await state()
    const hexBefore = await h.disk.hex(path)
    const statBefore = await h.disk.stat(path)
    calls = h.dialogs.calls().length
    await h.dialogs.queue('open', path)
    await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
    const alert = await h.alert.wait()
    const reported = (alert?.texts ?? []).join('\n')
    await h.alert.click('OK|Ok')
    await h.sleep(400)
    const after = await state()
    h.check(
      `${bad.file}: the open is refused with a reason and changes nothing`,
      !!alert &&
        reported.includes(`Could not open ${bad.file}`) &&
        bad.why.test(reported) &&
        JSON.stringify(after) === JSON.stringify(before) &&
        !!h.q('status-message', { error: '1' }) &&
        (await h.disk.hex(path)) === hexBefore &&
        (await h.disk.stat(path))?.mtimeMs === statBefore?.mtimeMs &&
        (await h.disk.hex(baseline)) === baselineHex,
      { alert, before, after, status: h.q('status-message')?.textContent, dialogs: h.dialogs.calls().slice(calls).map((c) => c.kind) },
    )
    h.check(`${bad.file}: the open document is still the one from before`, (await currentPath()) === baseline)
  }

  // M1: the three files M0 refused are read now. They open in their own tab, keep the
  // document that was active before, and report their encoding.
  for (const good of NO_LONGER_REFUSED) {
    const path = await h.fixture(`nc/encoding/${good.file}`)
    const hexBefore = await h.disk.hex(path)
    const tabs = h.qa('doc-tab').length
    await h.dialogs.queue('open', path)
    await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
    const opened = await h.waitFor(() => h.q('doc-tab', { path, active: '1' }), { timeout: 8000 })
    h.check(
      `${good.file}: opens as ${good.label} in a tab of its own, without a dialog`,
      !!opened && encodingLabel() === good.label && h.qa('doc-tab').length === tabs + 1 && (await h.alert.visible()) === null,
      { title: await h.title(), label: encodingLabel(), tabs: h.qa('doc-tab').length, alert: await h.alert.visible() },
    )
    h.check(
      good.stripped ? `${good.file}: the stripped NULs mark it modified` : `${good.file}: it opens unmodified`,
      (opened?.dataset.dirty === '1') === good.stripped,
      { dirty: opened?.dataset.dirty, status: h.q('status-message')?.textContent },
    )
    // Close it again, so exactly one document is unsaved when the run quits below.
    await h.nativeKeys([{ key: 'w', mods: ['cmd'] }])
    if (good.stripped) await h.alert.click("Don't Save")
    await h.waitFor(() => h.q('doc-tab', { path }) === null, { timeout: 4000 })
    h.check(`${good.file}: closing it wrote nothing`, (await h.disk.hex(path)) === hexBefore)
  }

  // A refused file must not throw away the edits of the document that stays open.
  h.click(h.q('doc-tab', { path: baseline }))
  await h.waitFor(async () => (await h.title()) === 'utf8-lf.nc — gEdit')
  h.focusEditor()
  await h.nativeType('(EDIT A)\n')
  await h.waitFor(async () => (await h.title()) === '● utf8-lf.nc — gEdit')
  const edited = await state()
  const tabsBeforeRefusal = h.qa('doc-tab').length
  await h.dialogs.queue('open', `${run}/fixtures/nc/encoding/nul-heavy.bin`)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.alert.click('OK|Ok')
  await h.sleep(400)
  h.check(
    'a refused file leaves the edited buffer as it was and opens no tab',
    JSON.stringify(await state()) === JSON.stringify(edited) && h.app.text().startsWith('(EDIT A)') && h.qa('doc-tab').length === tabsBeforeRefusal,
    { edited, now: await state(), tabs: h.qa('doc-tab').length },
  )

  // Drop the edit again, so exactly one document is unsaved when the run quits below.
  await h.nativeKeys([{ key: 'w', mods: ['cmd'] }])
  await h.alert.click("Don't Save")
  await h.waitFor(() => h.q('doc-tab', { path: baseline }) === null, { timeout: 4000 })
  h.check('closing the edited document with "Don\'t Save" leaves its file alone', (await h.disk.hex(baseline)) === baselineHex, {
    tabs: h.qa('doc-tab').map((e) => e.dataset.path),
  })

  // ---------------------------------------------------------------- saving an unchanged file
  const cp = await h.fixture('nc/encoding/cp1252-crlf.nc')
  const cpHex = await h.disk.hex(cp)
  await h.dialogs.queue('open', cp)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'cp1252-crlf.nc — gEdit')
  const cpStat = await h.disk.stat(cp)
  const opened = h.app.text()
  h.check('the Windows-1252 file is open unchanged', encodingLabel() === 'Windows-1252' && cpStat?.mtimeMs === (await h.disk.stat(cp))?.mtimeMs)

  for (const how of ['Cmd+S', 'the ribbon']) {
    calls = h.dialogs.calls().length
    if (how === 'Cmd+S') await save()
    else h.click(h.q('cmd-button', { command: 'file.save' }))
    await h.sleep(800)
    h.check(
      `saving the unchanged file with ${how} writes nothing`,
      (await h.disk.hex(cp)) === cpHex && (await h.disk.stat(cp))?.mtimeMs === cpStat?.mtimeMs && h.dialogs.calls().length === calls && (await h.title()) === 'cp1252-crlf.nc — gEdit',
      { mtime: (await h.disk.stat(cp))?.mtimeMs, status: h.q('status-message')?.textContent },
    )
  }

  // An edit that is taken back is no change at all: Monaco reports the version of the
  // opened text again, so the buffer counts as unmodified and Cmd+S writes nothing.
  h.focusEditor()
  await h.nativeType('X')
  await h.waitFor(async () => (await h.title()) === '● cp1252-crlf.nc — gEdit')
  await h.nativeKeys([{ key: 'z', mods: ['cmd'] }])
  const clean = await h.waitFor(async () => (await h.title()) === 'cp1252-crlf.nc — gEdit')
  await save()
  await h.sleep(800)
  h.check(
    'an edit that is undone again leaves the file alone',
    !!clean && (await h.disk.hex(cp)) === cpHex && (await h.disk.stat(cp))?.mtimeMs === cpStat?.mtimeMs && h.app.text() === opened,
    { cleanAfterUndo: !!clean, mtime: (await h.disk.stat(cp))?.mtimeMs, head: h.app.text().slice(0, 12) },
  )

  h.insertText('Ü')
  await h.waitFor(async () => (await h.title()) === '● cp1252-crlf.nc — gEdit')
  await save()
  await h.waitFor(async () => (await h.title()) === 'cp1252-crlf.nc — gEdit')
  const savedStat = await h.disk.stat(cp)
  h.check(
    'an edit is written, in the encoding of the file',
    (await h.disk.hex(cp)) === `dc ${cpHex}` && (savedStat?.mtimeMs ?? 0) > (cpStat?.mtimeMs ?? 0) && encodingLabel() === 'Windows-1252',
    { hex: (await h.disk.hex(cp)).slice(0, 30), mtimeBefore: cpStat?.mtimeMs, mtimeAfter: savedStat?.mtimeMs },
  )

  await save()
  await h.sleep(800)
  h.check('saving again right after writes nothing', (await h.disk.stat(cp))?.mtimeMs === savedStat?.mtimeMs)

  // ---------------------------------------------------------------- closing with Save
  h.focusEditor()
  await h.nativeType('(CLOSE SAVE)\n')
  await h.waitFor(async () => (await h.title()) === '● cp1252-crlf.nc — gEdit')
  await h.window.close()
  const prompt = await h.alert.wait()
  h.check('closing the modified file asks first', JSON.stringify(prompt?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']), prompt)
  h.expectExit({ files: [{ path: cp, includes: '(CLOSE SAVE)' }], events: ['CloseRequested main', 'Exit'] })
  await h.alert.click('Save').catch(() => {})
})
