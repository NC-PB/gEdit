// Content gEdit refuses to edit as text, and saves that must not touch the file:
// UTF-16 and binary files leave the open document alone, and saving an unchanged
// buffer writes nothing, whichever way it is triggered.

import { scenario } from '../lib/index.js'

const REFUSED = [
  { file: 'utf16le-bom.nc', why: /UTF-16 encoded/ },
  { file: 'utf16be-bom.nc', why: /UTF-16 encoded/ },
  { file: 'nul-inside.nc', why: /binary data \(NUL bytes\)/ },
  { file: 'nul-heavy.bin', why: /binary data \(NUL bytes\)/ },
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

  // A refusal after "Don't Save" must not throw the edits away either.
  h.focusEditor()
  await h.nativeType('(EDIT A)\n')
  await h.waitFor(async () => (await h.title()) === '● utf8-lf.nc — gEdit')
  const edited = await state()
  const utf16 = `${run}/fixtures/nc/encoding/utf16le-bom.nc`
  await h.dialogs.queue('open', utf16)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.alert.click("Don't Save")
  await h.alert.click('OK|Ok')
  await h.sleep(400)
  h.check(
    'a refused file after "Don\'t Save" leaves the edited buffer as it was',
    JSON.stringify(await state()) === JSON.stringify(edited) && h.app.text().startsWith('(EDIT A)'),
    { edited, now: await state() },
  )

  // ---------------------------------------------------------------- saving an unchanged file
  const cp = await h.fixture('nc/encoding/cp1252-crlf.nc')
  const cpHex = await h.disk.hex(cp)
  await h.dialogs.queue('open', cp)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.alert.click("Don't Save")
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
