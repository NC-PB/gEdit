// The M1 codec against every encoding fixture (plan §5 M1 H1 `m1-encoding2`, AD-7, §7.2):
// what the status bar says, that an unedited save writes nothing at all, and that an edit
// is written back byte for byte in the file's own encoding, byte order mark, line ending
// and punched-tape leader and trailer.
//
// The expected bytes are always "the file, with the encoded X inserted where the cursor
// was", which is the point of a byte-exact round trip: nothing else in the file may move.
//
// One document is open at a time: closing the last one leaves a fresh untitled buffer,
// which the next open takes the place of.

import { scenario } from '../lib/index.js'

/**
 * Every fixture that must round trip. `at` is the byte offset the encoded `X` lands at
 * (after a byte order mark or a NUL leader), `ins` the bytes it is written as.
 */
const CASES = [
  { file: 'utf8-lf.nc', label: 'UTF-8', eol: 'LF', at: 0, ins: '58' },
  { file: 'utf8-bom-crlf.nc', label: 'UTF-8 BOM', eol: 'CRLF', at: 3, ins: '58' },
  { file: 'cp1252-crlf.nc', label: 'Windows-1252', eol: 'CRLF', at: 0, ins: '58' },
  { file: 'cr-only.nc', label: 'UTF-8', eol: 'CR', at: 0, ins: '58' },
  { file: 'nul-leader-trailer.nc', label: 'UTF-8', eol: 'CRLF', at: 40, ins: '58' },
  { file: 'utf16le-bom.nc', label: 'UTF-16 LE', eol: 'CRLF', at: 2, ins: '58 00' },
  { file: 'utf16be-bom.nc', label: 'UTF-16 BE', eol: 'CRLF', at: 2, ins: '00 58' },
]

/** @param {string} hex @param {number} at @param {string} insert */
function insertBytes(hex, at, insert) {
  const bytes = hex.split(' ')
  bytes.splice(at, 0, ...insert.split(' '))
  return bytes.join(' ')
}

/** @param {string} text */
function utf8Hex(text) {
  return [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

scenario('m1-encoding2', { timeout: 240 }, async (h) => {
  h.allowErrors(/Could not open/)
  const item = (/** @type {string} */ name) => h.q('status-item', { item: name })?.textContent?.trim()
  const dirty = () => h.q('doc-tab', { active: '1' })?.dataset.dirty

  /** Opens through the real dialog and waits for its tab. @param {string} path */
  const open = async (path) => {
    await h.dialogs.queue('open', path)
    await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
    return h.waitFor(() => h.q('doc-tab', { path, active: '1' }), { timeout: 10000 })
  }
  const save = async () => {
    h.focusEditor()
    await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  }
  /** Closes the open document; the window then holds a fresh untitled buffer again. */
  const close = async (/** @type {boolean} */ modified) => {
    await h.nativeKeys([{ key: 'w', mods: ['cmd'] }])
    if (modified) await h.alert.click("Don't Save")
    await h.waitFor(() => h.q('doc-tab', { path: '' }) !== null, { timeout: 5000 })
  }

  // ------------------------------------------------------------ byte-exact round trips
  for (const c of CASES) {
    const path = await h.fixture(`nc/encoding/${c.file}`)
    const hex = await h.disk.hex(path)
    const stat = await h.disk.stat(path)
    const opened = await open(path)
    h.check(`${c.file}: opens as ${c.label} with ${c.eol} line endings, unmodified`, !!opened && item('encoding') === c.label && item('eol') === c.eol && dirty() === '0', {
      encoding: item('encoding'),
      eol: item('eol'),
      dirty: dirty(),
      file: item('file'),
    })

    // An unedited save must not touch the file: rewriting it could only alter it.
    const calls = h.dialogs.calls().length
    await save()
    await h.sleep(700)
    h.check(`${c.file}: saving it unedited writes nothing`, (await h.disk.hex(path)) === hex && (await h.disk.stat(path))?.mtimeMs === stat?.mtimeMs && h.dialogs.calls().length === calls, {
      mtimeBefore: stat?.mtimeMs,
      mtimeAfter: (await h.disk.stat(path))?.mtimeMs,
      status: h.q('status-message')?.textContent,
    })

    // One typed character, then a save: every other byte has to stay where it was.
    h.focusEditor()
    await h.nativeType('X')
    await h.waitFor(() => dirty() === '1', { timeout: 4000 })
    await save()
    await h.waitFor(() => dirty() === '0', { timeout: 6000 })
    h.check(`${c.file}: the edit is written in the file's own encoding, everything else unchanged`, (await h.disk.hex(path)) === insertBytes(hex, c.at, c.ins), {
      expected: insertBytes(hex, c.at, c.ins).slice(0, 48),
      actual: (await h.disk.hex(path)).slice(0, 48),
      length: (await h.disk.hex(path)).split(' ').length,
    })
    h.check(`${c.file}: it is still ${c.label} with ${c.eol} line endings`, item('encoding') === c.label && item('eol') === c.eol, { encoding: item('encoding'), eol: item('eol') })
    await close(false)
  }

  // ------------------------------------------------------------ mixed line endings
  const mixed = await h.fixture('nc/encoding/mixed-eol.nc')
  const mixedHex = await h.disk.hex(mixed)
  const mixedStat = await h.disk.stat(mixed)
  await open(mixed)
  h.check('mixed-eol.nc: the status bar marks the mixed line endings and names the majority', item('eol') === 'CRLF (mixed)', item('eol'))
  h.check('mixed-eol.nc: it opens unmodified, so nothing is rewritten behind the user', dirty() === '0', dirty())
  await save()
  await h.sleep(700)
  h.check('mixed-eol.nc: saving it unedited leaves the mixed file alone', (await h.disk.hex(mixed)) === mixedHex && (await h.disk.stat(mixed))?.mtimeMs === mixedStat?.mtimeMs, {
    mtimeAfter: (await h.disk.stat(mixed))?.mtimeMs,
  })
  h.focusEditor()
  await h.nativeType('X')
  await h.waitFor(() => dirty() === '1', { timeout: 4000 })
  const mixedText = h.app.text()
  await save()
  await h.waitFor(() => dirty() === '0', { timeout: 6000 })
  h.check('mixed-eol.nc: the edit rewrites the whole file with the majority line ending', (await h.disk.hex(mixed)) === utf8Hex(mixedText.replace(/\n/g, '\r\n')), {
    actual: (await h.disk.hex(mixed)).slice(0, 60),
    expected: utf8Hex(mixedText.replace(/\n/g, '\r\n')).slice(0, 60),
    crOnly: (await h.disk.hex(mixed)).includes('0d 28'),
  })
  // Fixed in I1: `app/fileOps.ts` `write()` clears `eolMixedOnLoad`, because the file it
  // just wrote is uniform. `components/status/EolStatus.svelte:5` promises the item reads
  // plain CRLF "until it is saved once, which is when the whole file takes the majority
  // ending" (AD-7), and the byte check above proves the file really is uniform CRLF.
  await h.waitFor(() => item('eol') === 'CRLF', { timeout: 3000 })
  h.check('mixed-eol.nc: the save clears the mixed marker, so the item reads plain CRLF', item('eol') === 'CRLF', item('eol'))
  await close(false)

  // ------------------------------------------------------------ NUL bytes inside the text
  const inside = await h.fixture('nc/encoding/nul-inside.nc')
  const insideHex = await h.disk.hex(inside)
  const insideStat = await h.disk.stat(inside)
  await open(inside)
  h.check('nul-inside.nc: the stripped NUL bytes are counted in the status bar', h.q('status-message')?.textContent?.includes('Removed 3 NUL bytes from nul-inside.nc'), h.q('status-message')?.textContent)
  h.check('nul-inside.nc: the document is marked modified, because it no longer matches the file', dirty() === '1', dirty())
  h.check('nul-inside.nc: nothing was written yet', (await h.disk.stat(inside))?.mtimeMs === insideStat?.mtimeMs)
  h.check('nul-inside.nc: the editor text holds no NUL', !h.app.text().includes(String.fromCharCode(0)), h.app.text().split('\n')[6])
  await save()
  await h.waitFor(() => dirty() === '0', { timeout: 6000 })
  h.check('nul-inside.nc: saving writes the file without the three NUL bytes and changes nothing else', (await h.disk.hex(inside)) === insideHex.split(' ').filter((b) => b !== '00').join(' '), {
    before: insideHex.split(' ').length,
    after: (await h.disk.hex(inside)).split(' ').length,
  })
  await close(false)

  // ------------------------------------------------------------ data, not a program
  const binary = await h.fixture('nc/encoding/nul-heavy.bin')
  const binaryHex = await h.disk.hex(binary)
  const before = { tabs: h.qa('doc-tab').length, title: await h.title() }
  await h.dialogs.queue('open', binary)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  const refusal = await h.alert.wait()
  const reported = (refusal?.texts ?? []).join('\n')
  h.check(
    'nul-heavy.bin: the open is refused, with the NUL share as the reason',
    !!refusal && reported.includes('Could not open nul-heavy.bin') && /% NUL bytes/.test(reported) && /data rather than a program/.test(reported),
    refusal,
  )
  await h.alert.click('OK|Ok')
  await h.sleep(500)
  h.check(
    'nul-heavy.bin: nothing was opened and the file was not touched',
    h.qa('doc-tab').length === before.tabs && (await h.title()) === before.title && (await h.disk.hex(binary)) === binaryHex && !!h.q('status-message', { error: '1' }),
    { tabs: h.qa('doc-tab').length, title: await h.title(), status: h.q('status-message')?.textContent },
  )

  h.expectExit({ within: 15000 })
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})
