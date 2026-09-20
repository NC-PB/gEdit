// Encodings end to end: what the editor shows for each byte-level fixture, that an
// unchanged file is never rewritten, and that an edit is written back in the file's
// own encoding — or in UTF-8 after the user agrees.
//
// M1: every open adds a tab (the first one takes the untouched starter buffer's place),
// and re-opening a path focuses the tab that already holds it. Only the last document is
// left unsaved, so the quit alert keeps the single-document wording.

import { scenario } from '../lib/index.js'

const CASES = [
  { file: 'utf8-lf.nc', label: 'UTF-8', encoding: 'utf-8' },
  { file: 'utf8-bom-crlf.nc', label: 'UTF-8 BOM', encoding: 'utf-8' },
  { file: 'cp1252-crlf.nc', label: 'Windows-1252', encoding: 'windows-1252' },
  { file: 'cr-only.nc', label: 'UTF-8', encoding: 'utf-8' },
  { file: 'mixed-eol.nc', label: 'UTF-8', encoding: 'utf-8' },
  // The punched-tape leader and trailer are metadata, not text (§7.2), so the editor
  // shows the program between them — they are written back unchanged on save.
  { file: 'nul-leader-trailer.nc', label: 'UTF-8', encoding: 'utf-8', tape: true },
]

/**
 * The text those bytes stand for, with the line breaks the hook reports.
 * @param {string} hex
 * @param {string} encoding
 */
function decode(hex, encoding) {
  const bytes = Uint8Array.from(hex.split(' ').map((/** @type {string} */ b) => parseInt(b, 16)))
  return new TextDecoder(encoding).decode(bytes).replace(/\r\n?/g, '\n')
}

/** Drops the NUL runs at both ends, which the codec keeps out of the editor text. */
function withoutTape(/** @type {string} */ hex) {
  const bytes = hex.split(' ')
  while (bytes.length > 0 && bytes[0] === '00') bytes.shift()
  while (bytes.length > 0 && bytes[bytes.length - 1] === '00') bytes.pop()
  return bytes.join(' ')
}

/** @param {string} hex @param {number} at @param {string} insert */
function withBytes(hex, at, insert) {
  const bytes = hex.split(' ')
  bytes.splice(at, 0, ...insert.split(' '))
  return bytes.join(' ')
}

scenario('m0-encoding', { timeout: 180 }, async (h) => {
  const encodingLabel = () => h.q('status-item', { item: 'encoding' })?.textContent
  /**
   * @param {string} path
   * @param {string} name
   */
  const open = async (path, name) => {
    await h.dialogs.queue('open', path)
    await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
    return h.waitFor(async () => (await h.title()) === `${name} — gEdit`, { timeout: 8000 })
  }
  const save = async () => {
    h.focusEditor()
    await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  }

  // ---------------------------------------------------------------- reading and no-op saves
  for (const c of CASES) {
    const path = await h.fixture(`nc/encoding/${c.file}`)
    const hex = await h.disk.hex(path)
    const stat = await h.disk.stat(path)
    const opened = await open(path, c.file)
    const text = h.app.text()
    h.check(
      `${c.file}: opens as ${c.label} with the file's text`,
      !!opened && encodingLabel() === c.label && text === decode(c.tape ? withoutTape(hex) : hex, c.encoding) && !text.includes('\r'),
      { title: await h.title(), label: encodingLabel(), lines: text.split('\n').length, head: text.slice(0, 40), status: h.q('status-message')?.textContent },
    )
    const calls = h.dialogs.calls().length
    await save()
    await h.sleep(800)
    h.check(`${c.file}: saving it unchanged rewrites nothing`, (await h.disk.hex(path)) === hex && (await h.disk.stat(path))?.mtimeMs === stat?.mtimeMs && h.dialogs.calls().length === calls, {
      mtimeBefore: stat?.mtimeMs,
      mtimeAfter: (await h.disk.stat(path))?.mtimeMs,
      dialogs: h.dialogs.calls().slice(calls),
      title: await h.title(),
    })
  }

  // ---------------------------------------------------------------- an edit keeps the encoding
  const bom = await h.fixture('nc/encoding/utf8-bom-crlf.nc')
  const bomHex = await h.disk.hex(bom)
  await open(bom, 'utf8-bom-crlf.nc')
  h.check('a UTF-8 file with a BOM can take an edit', h.insertText('X'))
  await h.waitFor(async () => (await h.title()) === '● utf8-bom-crlf.nc — gEdit')
  await save()
  await h.waitFor(async () => (await h.title()) === 'utf8-bom-crlf.nc — gEdit')
  h.check(
    'the edit is written after the BOM and the CRLF line breaks survive',
    (await h.disk.hex(bom)) === withBytes(bomHex, 3, '58') && encodingLabel() === 'UTF-8 BOM',
    { hex: (await h.disk.hex(bom)).slice(0, 60), label: encodingLabel() },
  )

  const cp = await h.fixture('nc/encoding/cp1252-crlf.nc')
  const cpHex = await h.disk.hex(cp)
  await open(cp, 'cp1252-crlf.nc')
  h.insertText('Ü')
  await h.waitFor(async () => (await h.title()) === '● cp1252-crlf.nc — gEdit')
  await save()
  await h.waitFor(async () => (await h.title()) === 'cp1252-crlf.nc — gEdit')
  const afterUmlaut = withBytes(cpHex, 0, 'dc')
  h.check(
    'a Windows-1252 file keeps its encoding: Ü is written as 0xDC',
    (await h.disk.hex(cp)) === afterUmlaut && encodingLabel() === 'Windows-1252',
    { hex: (await h.disk.hex(cp)).slice(0, 40), label: encodingLabel() },
  )

  // ---------------------------------------------------------------- the UTF-8 fallback
  const statBefore = await h.disk.stat(cp)
  h.insertText('日')
  await h.waitFor(async () => (await h.title()) === '● cp1252-crlf.nc — gEdit')
  await save()
  const warning = await h.alert.wait()
  h.check(
    'saving a character Windows-1252 cannot store asks first',
    JSON.stringify(warning?.buttons) === JSON.stringify(['Save as UTF-8', 'Cancel']) &&
      !!warning?.texts.some((t) => t.includes('"日"') && t.includes('U+65E5') && t.includes('line 1, column 2')),
    warning,
  )
  await h.alert.click('Cancel')
  await h.sleep(800)
  h.check(
    'Cancel writes nothing and keeps the buffer modified',
    (await h.disk.hex(cp)) === afterUmlaut && (await h.disk.stat(cp))?.mtimeMs === statBefore?.mtimeMs && (await h.title()) === '● cp1252-crlf.nc — gEdit' && encodingLabel() === 'Windows-1252',
    { mtimeBefore: statBefore?.mtimeMs, mtimeAfter: (await h.disk.stat(cp))?.mtimeMs, title: await h.title() },
  )

  await save()
  await h.alert.wait()
  await h.alert.click('Save as UTF-8')
  await h.waitFor(async () => (await h.title()) === 'cp1252-crlf.nc — gEdit')
  const asUtf8 = await h.disk.hex(cp)
  h.check(
    'Save as UTF-8 rewrites the whole file in UTF-8',
    asUtf8.startsWith('c3 9c e6 97 a5 ') && encodingLabel() === 'UTF-8' && decode(asUtf8, 'utf-8') === h.app.text(),
    { hex: asUtf8.slice(0, 40), label: encodingLabel(), status: h.q('status-message')?.textContent },
  )

  const calls = h.dialogs.calls().length
  h.insertText('€')
  await h.waitFor(async () => (await h.title()) === '● cp1252-crlf.nc — gEdit')
  await save()
  await h.waitFor(async () => (await h.title()) === 'cp1252-crlf.nc — gEdit')
  h.check(
    'the next save stays UTF-8 and asks nothing',
    (await h.disk.hex(cp)).startsWith('c3 9c e6 97 a5 e2 82 ac ') && h.dialogs.calls().length === calls && (await h.alert.visible()) === null,
    { hex: (await h.disk.hex(cp)).slice(0, 40), label: encodingLabel() },
  )

  // ---------------------------------------------------------------- the guard on top of it
  // M1: `open` focuses a document that is already open instead of re-reading the file,
  // so the converted document has to go before the fixture is restored on disk.
  h.focusEditor()
  await h.nativeKeys([{ key: 'w', mods: ['cmd'] }])
  await h.waitFor(() => h.q('doc-tab', { path: cp }) === null, { timeout: 4000 })
  h.check('closing the converted document leaves no tab on that path', h.q('doc-tab', { path: cp }) === null, h.qa('doc-tab').map((e) => e.dataset.path))

  const guard = await h.fixture('nc/encoding/cp1252-crlf.nc')
  const guardHex = await h.disk.hex(guard)
  await open(guard, 'cp1252-crlf.nc')
  h.insertText('日')
  await h.waitFor(async () => (await h.title()) === '● cp1252-crlf.nc — gEdit')
  await h.window.close()
  const prompt = await h.alert.wait()
  h.check('closing it asks about the unsaved changes', JSON.stringify(prompt?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']), prompt)
  await h.alert.click('Save')
  const second = await h.alert.wait()
  h.check('saving from the close prompt asks about the encoding', JSON.stringify(second?.buttons) === JSON.stringify(['Save as UTF-8', 'Cancel']), second)
  await h.alert.click('Cancel')
  await h.sleep(1200)
  h.check(
    'cancelling the encoding question keeps the window and the file',
    (await h.window.state()).exists && (await h.disk.hex(guard)) === guardHex && (await h.title()) === '● cp1252-crlf.nc — gEdit',
    { state: await h.window.state(), title: await h.title() },
  )

  h.expectExit({ files: [{ path: guard, hex: guardHex }], events: ['CloseRequested main', 'Exit'] })
  await h.window.close()
  await h.alert.wait()
  await h.alert.click("Don't Save").catch(() => {})
})
