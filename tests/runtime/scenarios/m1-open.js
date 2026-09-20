// Opening files in M1: a multi-select gives one tab per file, a file that is already
// open is focused instead of opened twice, and a drop opens what it can and says what it
// ignored (plan §5 M1 H1 `m1-open-multi` and `m1-dnd`, §7.2 `FileOps.open`).
//
// Everything goes through the real Open command: the fake file dialog grants the picked
// paths exactly as the plugin does, so the file operations run unchanged.

import { scenario } from '../lib/index.js'

/** Opens through the real Cmd+O with `answer` queued for the dialog. */
async function openWith(/** @type {import('../lib/api.js').Harness} */ h, /** @type {string | string[] | null} */ answer) {
  await h.dialogs.queue('open', answer)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
}

scenario('m1-open-multi', { timeout: 120 }, async (h) => {
  const tabs = () => h.qa('doc-tab')
  const paths = () => tabs().map((e) => e.dataset.path)
  const item = (/** @type {string} */ name) => h.q('status-item', { item: name })?.textContent?.trim()

  const fanuc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const klartext = await h.fixture('nc/heidenhain/h01-3tools.h')
  const bom = await h.fixture('nc/encoding/utf8-bom-crlf.nc')

  h.check('the window starts with the one untitled buffer', tabs().length === 1 && paths()[0] === '', paths())
  h.check('its tab is the active one and unmodified', !!h.q('doc-tab', { active: '1', dirty: '0' }), tabs().map((e) => e.outerHTML.slice(0, 80)))

  // ------------------------------------------------------------ a three-file multi-select
  await openWith(h, [fanuc, klartext, bom])
  // The files are added one by one and the starter buffer is dropped once the last one
  // has taken its place, so "three tabs" is true twice on the way; wait for the end state.
  await h.waitFor(() => !!h.q('doc-tab', { path: bom }) && !h.q('doc-tab', { path: '' }), { timeout: 10000 })
  h.check(
    'a three-file multi-select gives three tabs, in the order they were picked',
    JSON.stringify(paths()) === JSON.stringify([fanuc, klartext, bom]),
    paths(),
  )
  h.check(
    'the untouched starter buffer is gone rather than left behind as an empty tab',
    tabs().length === 3 && !paths().includes(''),
    paths(),
  )
  await h.waitFor(async () => (await h.title()) === 'utf8-bom-crlf.nc — gEdit', { timeout: 5000 })
  h.check(
    'the last file picked is the active document, and the window title follows',
    !!h.q('doc-tab', { path: bom, active: '1' }) && (await h.title()) === 'utf8-bom-crlf.nc — gEdit',
    { title: await h.title(), active: h.q('doc-tab', { active: '1' })?.dataset.path },
  )
  h.check(
    'the status bar describes the active document, not the others',
    item('file') === 'utf8-bom-crlf.nc' && item('encoding') === 'UTF-8 BOM' && item('eol') === 'CRLF' && item('profile') === 'Fanuc',
    { file: item('file'), encoding: item('encoding'), eol: item('eol'), profile: item('profile') },
  )
  h.check('every tab is unmodified', h.qa('doc-tab', { dirty: '0' }).length === 3, h.qa('doc-tab').map((e) => e.dataset.dirty))
  h.check('every document got its own id', new Set(tabs().map((e) => e.dataset.docId)).size === 3, tabs().map((e) => e.dataset.docId))

  // Each document keeps its own profile: the dialect is detected per file, not per window.
  h.click(h.q('doc-tab', { path: klartext }))
  await h.waitFor(async () => (await h.title()) === 'h01-3tools.h — gEdit')
  await h.waitFor(() => item('profile') === 'Heidenhain', { timeout: 2000 })
  h.check('activating the Klartext tab switches the profile and the editor', h.app.activeProfile() === 'heidenhain-klartext' && h.app.text().startsWith('0 BEGIN PGM'), {
    profile: h.app.activeProfile(),
    head: h.app.text().slice(0, 20),
    item: item('profile'),
  })
  await h.waitFor(() => h.qa('program-map-item', { kind: 'tool' }).length === 3, { timeout: 3000 })
  h.check('the program map follows the active document', JSON.stringify(h.qa('program-map-item', { kind: 'tool' }).map((e) => e.dataset.line)) === '["6","17","35"]', h.qa('program-map-item', { kind: 'tool' }).map((e) => e.dataset.line))

  // ------------------------------------------------------------ opening one again
  const dialogsBefore = h.dialogs.calls().length
  await openWith(h, fanuc)
  await h.waitFor(async () => (await h.title()) === 'f01-mill-3tools.nc — gEdit', { timeout: 5000 })
  h.check(
    'opening a file that is already open focuses its tab instead of adding one',
    tabs().length === 3 && !!h.q('doc-tab', { path: fanuc, active: '1' }) && h.dialogs.calls().length === dialogsBefore + 1,
    { tabs: paths(), title: await h.title() },
  )
  h.check('the tab order is unchanged', JSON.stringify(paths()) === JSON.stringify([fanuc, klartext, bom]), paths())
  h.check('the status bar says so', h.q('status-message')?.textContent === 'f01-mill-3tools.nc is already open', h.q('status-message')?.textContent)

  // A mixed pick: one new file and one that is already open.
  const packed = await h.fixture('nc/fanuc/f02-packed.nc')
  await openWith(h, [klartext, packed])
  await h.waitFor(() => tabs().length === 4, { timeout: 8000 })
  h.check(
    'a pick of one open and one new file adds exactly one tab',
    JSON.stringify(paths()) === JSON.stringify([fanuc, klartext, bom, packed]) && !!h.q('doc-tab', { path: packed, active: '1' }),
    paths(),
  )

  // Cancelling the dialog changes nothing.
  const before = paths()
  await openWith(h, null)
  await h.sleep(600)
  h.check('cancelling the Open dialog changes nothing', JSON.stringify(paths()) === JSON.stringify(before) && !!h.q('doc-tab', { path: packed, active: '1' }), paths())

  h.expectExit({ within: 15000 })
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})

scenario('m1-dnd', { timeout: 120 }, async (h) => {
  const tabs = () => h.qa('doc-tab')
  const paths = () => tabs().map((e) => e.dataset.path)

  const nc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const klartext = await h.fixture('nc/heidenhain/h01-3tools.h')
  const folder = await h.fixture('nc/ambiguous')

  // `tauri-plugin-fs` grants every dropped path before the event reaches the page (F2),
  // and `files_stat` is what tells a folder from a file.
  await h.drop([nc, klartext, folder], { x: 300, y: 300 })
  // The files arrive one by one and the starter buffer is dropped once the last one has
  // taken its place, so "two tabs" is true mid-transition, on `['', nc]`. Wait for the end
  // state, the way `m1-open-multi` does, or the checks below race the second file in.
  await h.waitFor(() => !!h.q('doc-tab', { path: klartext }) && !h.q('doc-tab', { path: '' }), { timeout: 10000 })
  h.check('dropping two files and a folder opens the two files', JSON.stringify(paths()) === JSON.stringify([nc, klartext]), paths())
  h.check('the dropped folder is not opened as a document', paths().every((p) => p !== folder), paths())
  await h.waitFor(() => h.q('status-message')?.textContent === '1 folder was ignored: only files can be opened', { timeout: 3000 })
  h.check(
    'the status bar says the folder was ignored',
    h.q('status-message')?.textContent === '1 folder was ignored: only files can be opened' && !!h.q('status-message', { error: '0' }),
    h.q('status-message')?.textContent,
  )
  await h.waitFor(async () => (await h.title()) === 'h01-3tools.h — gEdit', { timeout: 5000 })
  h.check('the last dropped file is active', !!h.q('doc-tab', { path: klartext, active: '1' }), paths())

  // A drop of only a folder opens nothing and says so as an error.
  const only = await h.drop([folder], { x: 300, y: 300 })
  void only
  await h.waitFor(() => !!h.q('status-message', { error: '1' }), { timeout: 3000 })
  h.check(
    'dropping only a folder opens nothing and reports it as an error',
    tabs().length === 2 && !!h.q('status-message', { error: '1' }) && h.q('status-message')?.textContent === '1 folder was ignored: only files can be opened',
    { tabs: paths(), status: h.q('status-message')?.textContent },
  )

  // A path gEdit cannot reach — deleted between the drop and the stat, or a symlink the
  // fs scope answers `allowed: false` for — used to be discarded without a word (G8 F3).
  const gone = `${h.cfg.run}/never-existed.nc`
  await h.drop([gone], { x: 300, y: 300 })
  await h.waitFor(() => h.q('status-message')?.textContent?.includes('could not be opened'), { timeout: 3000 })
  h.check(
    'a dropped path that is gone is reported as an error, not silently ignored',
    tabs().length === 2 &&
      h.q('status-message')?.textContent === '1 item could not be opened: it is gone, or gEdit was not given access to it' &&
      !!h.q('status-message', { error: '1' }),
    { tabs: paths(), status: h.q('status-message')?.textContent },
  )

  // Dropping a file that is already open focuses its tab.
  await h.drop([nc], { x: 300, y: 300 })
  await h.waitFor(async () => (await h.title()) === 'f01-mill-3tools.nc — gEdit', { timeout: 5000 })
  h.check('dropping an open file focuses its tab', tabs().length === 2 && !!h.q('doc-tab', { path: nc, active: '1' }), paths())

  h.expectExit({ within: 15000 })
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})
