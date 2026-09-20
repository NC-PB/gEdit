// The broad M0 regression: what the app looks like when it starts, that the webview
// runs under the production CSP, the file operations behind the ribbon and the
// shortcuts, the script backend, the fs scope, and the unsaved-changes guard.
//
// Updated for the three intentional M1 behaviour changes (plan §5 M1):
//   1. Open adds a tab instead of replacing the document, so the "open with unsaved
//      changes" prompt is gone — and the lone untouched starter buffer is the scratch
//      document a first open (or drop) takes the place of.
//   2. The script output lives in the bottom panel, which `scripts.run` opens itself.
//   3. The ribbon `profile-select` dropdown became the `profile` status-bar item
//      (§7.9 marks `profile-select` M0-only).
// Everything else is the M0 behaviour, unchanged.

import { scenario } from '../lib/index.js'

const INITIAL = '% \nO1000\nG0 X0 Y0\nM30 \n%'

/**
 * The bytes a new document is written with: the hook's LF text, with the CRLF breaks
 * every P1 profile gives a new file (`newFileLineEnding`, plan §2 and D17).
 * @param {string} text
 */
const onDisk = (text) => text.replace(/\n/g, '\r\n')

scenario('m0-main', { timeout: 180 }, async (h) => {
  const run = h.cfg.run
  const scripts = await h.fixture('scripts', { from: 'runtime' })
  await h.fixture('evil.py', { from: 'runtime' })
  const pwned = `${run}/runtime-fixtures/PWNED`
  const sampleH = await h.fixture('nc/heidenhain/h01-3tools.h')
  const fanucTxt = await h.fixture('nc/fanuc/detect-fanuc.txt')

  // ---------------------------------------------------------------- the page itself
  h.check('the page runs from the app protocol', location.origin === 'tauri://localhost', location.href)
  h.check('the test hook reports the app version', h.app.version === h.cfg.appVersion, {
    hook: h.app.version,
    packageJson: h.cfg.appVersion,
  })

  const editor = h.q('editor-host')
  const lines = () => [...(editor?.querySelectorAll('.view-lines .view-line') ?? [])]
  h.check('Monaco fills the editor host', !!editor && editor.offsetHeight > 100 && lines().length > 0, {
    size: [editor?.offsetWidth, editor?.offsetHeight],
    lines: lines().length,
  })
  const colors = () =>
    new Set([...(editor?.querySelectorAll('.view-lines .view-line span span') ?? [])].map((s) => getComputedStyle(s).color))
  await h.waitFor(() => colors().size > 1, { timeout: 3000 })
  h.check('the Fanuc tokens are coloured', colors().size > 1, [...colors()])

  await h.waitFor(() => h.rec.workers.length > 0 && h.rec.workers[0].messages > 0, { timeout: 8000 })
  const worker = h.rec.workers[0]
  const workerWarnings = h.rec.warnings.filter((w) => /Could not create web worker/i.test(w))
  h.check(
    "Monaco's editor worker comes from the app itself and answers",
    !!worker && worker.url.startsWith('tauri://localhost/') && !worker.error && worker.messages > 0 && workerWarnings.length === 0,
    { workers: h.rec.workers, workerWarnings },
  )
  const codicon = await document.fonts.load('16px codicon').catch(() => [])
  h.check('the bundled codicon font loads', codicon.some((f) => f.status === 'loaded'), {
    faces: codicon.map((f) => `${f.family} ${f.status}`),
    check: document.fonts.check('16px codicon'),
  })
  const resources = performance.getEntriesByType('resource').map((e) => e.name)
  const external = resources.filter((name) => !/^(tauri:\/\/localhost\/|ipc:\/\/)/.test(name))
  h.check('nothing is loaded from outside the app', external.length === 0, { external, total: resources.length })

  // ---------------------------------------------------------------- the initial document
  h.check('the window title names the untitled buffer', (await h.title()) === 'Untitled-1 — gEdit', await h.title())
  h.check('the editor holds the starter program', h.app.text() === INITIAL, h.app.text())
  h.check('the cursor starts at 1:1', JSON.stringify(h.app.cursor()) === '{"line":1,"column":1}', h.app.cursor())
  // M1 change 3: the dropdown is gone; the same profile is read off the status bar.
  h.check('the Fanuc profile is active', h.app.activeProfile() === 'fanuc-gcode' && h.q('profile-select') === null, {
    profile: h.app.activeProfile(),
    legacySelect: h.q('profile-select'),
  })
  h.check(
    'the profile status item shows it',
    h.q('status-item', { item: 'profile' })?.textContent === 'Fanuc',
    h.q('status-item', { item: 'profile' })?.textContent,
  )
  h.check('the status bar shows the encoding and the cursor', h.q('status-item', { item: 'encoding' })?.textContent === 'UTF-8' && h.q('status-item', { item: 'cursor' })?.textContent === 'Ln 1, Col 1', {
    file: h.q('status-item', { item: 'file' })?.textContent,
    profile: h.q('status-item', { item: 'profile' })?.textContent,
    encoding: h.q('status-item', { item: 'encoding' })?.textContent,
    cursor: h.q('status-item', { item: 'cursor' })?.textContent,
  })
  h.check('the first document has an id', h.q('editor-host')?.dataset.docId === 'd1')
  h.check('the program map is empty for the starter program', h.qa('program-map-item').length === 0)
  h.check('the Home tab is selected', h.q('ribbon-tab', { tab: 'home', 'aria-selected': 'true' }) !== null)

  // The hook switches the profile the same way the picker does. The store changes in the
  // same tick; the status item is Svelte state, so it repaints on the next frame.
  const profileLabel = () => h.q('status-item', { item: 'profile' })?.textContent
  const fanucLabel = profileLabel()
  h.app.setProfile('heidenhain-klartext')
  h.check('setProfile() switches the profile at once', h.app.activeProfile() === 'heidenhain-klartext', h.app.activeProfile())
  await h.waitFor(() => profileLabel() === 'Heidenhain', { timeout: 2000 })
  h.check('the profile status item follows', profileLabel() === 'Heidenhain' && fanucLabel === 'Fanuc', {
    before: fanucLabel,
    now: profileLabel(),
  })
  let refused = false
  try {
    h.app.setProfile('no-such-profile')
  } catch {
    refused = true
  }
  h.check('setProfile() refuses an unknown profile', refused && h.app.activeProfile() === 'heidenhain-klartext')
  h.app.setProfile('fanuc-gcode')
  await h.waitFor(() => profileLabel() === fanucLabel, { timeout: 2000 })
  h.check('setProfile() switches back', h.app.activeProfile() === 'fanuc-gcode' && profileLabel() === fanucLabel, {
    profile: h.app.activeProfile(),
    label: profileLabel(),
  })

  const menu = await h.menu()
  h.check(
    'the app menu quits through its own item, not the predefined one',
    /MenuItem id="quit" text="Quit gEdit" enabled=Some\(true\)/.test(menu) && !/Predefined text="Quit/.test(menu),
    menu,
  )

  // ---------------------------------------------------------------- the script backend
  const list = await h.attempt('list_python_scripts', { folderPath: scripts })
  h.check(
    'the script list holds the .py files of the folder only',
    list.ok && JSON.stringify(list.value) === JSON.stringify(['a_echo.py', 'b_fail.py', 'c_sleep.py', 'pyexe.py']),
    list,
  )
  const input = 'G0 X0\nG1 Y5\n'
  const echo = await h.attempt('run_python_script', { folderPath: scripts, scriptName: 'a_echo.py', inputText: input })
  h.check(
    'a script reads stdin, answers JSON and runs in the scripts folder',
    echo.ok && echo.value.success && echo.value.data.len === input.length && echo.value.data.upper === input.toUpperCase() && echo.value.data.cwd === scripts,
    echo,
  )
  const failing = await h.attempt('run_python_script', { folderPath: scripts, scriptName: 'b_fail.py', inputText: 'x' })
  h.check('a failing script reports stderr and success:false', failing.ok && failing.value.success === false && /boom on stderr/.test(failing.value.stderr), failing)

  /** @type {Record<string, unknown>} */
  const rejected = {}
  for (const name of ['../evil.py', 'sub/x.py', '/etc/x.py', 'x.txt', 'missing.py', `${scripts}/a_echo.py`, '..\\evil.py', '.py', '..', 'dir.py']) {
    rejected[name] = await h.attempt('run_python_script', { folderPath: scripts, scriptName: name, inputText: '' })
  }
  h.check('script names that are not a plain .py file in the folder are refused', Object.values(rejected).every((r) => !(/** @type {any} */ (r).ok)), rejected)
  h.check('no trap script ran', (await h.disk.stat(pwned)) === null)
  const oldCall = await h.attempt('run_python_script', { scriptPath: `${scripts}/a_echo.py`, inputText: 'x' })
  h.check('the removed v1 call shape is refused', !oldCall.ok, oldCall)
  h.check('the sample command of the template is gone', !(await h.attempt('greet', { name: 'x' })).ok)

  // A script must not block the main thread; the same probe with a blocking command calibrates it.
  /**
   * @template T
   * @param {string} label
   * @param {() => Promise<T>} work
   */
  const probe = async (label, work) => {
    let frames = 0
    let running = true
    const loop = () => {
      frames++
      if (running) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    /** @type {number[]} */
    const pings = []
    const pinger = (async () => {
      while (running) {
        const t = performance.now()
        await h.invoke('h_is_main_thread_sync')
        pings.push(Math.round(performance.now() - t))
        await h.sleep(100)
      }
    })()
    const t0 = performance.now()
    const value = await work()
    const durationMs = Math.round(performance.now() - t0)
    running = false
    await pinger
    return { label, durationMs, frames, maxPingMs: Math.max(...pings), value }
  }
  const blocked = await probe('main thread blocked for 2 s', () => h.invoke('h_block_main_sync', { ms: 2000 }))
  const script = await probe('c_sleep.py (2 s)', () => h.attempt('run_python_script', { folderPath: scripts, scriptName: 'c_sleep.py', inputText: '' }))
  h.check(
    'a running script keeps the UI responsive',
    script.value.ok && script.durationMs >= 1900 && script.maxPingMs < 500 && blocked.maxPingMs >= 1500,
    { script, calibration: blocked },
  )

  // The ribbon path: Tools -> Scripts Dir -> pick a script -> Run
  h.click(h.q('ribbon-tab', { tab: 'tools' }))
  await h.dialogs.queue('folder', scripts)
  h.click(h.q('scripts-folder'))
  const select = await h.waitFor(() => h.q('script-select'))
  h.check('the picked folder fills the script list', !!select)
  if (select) {
    h.select(select, 'a_echo.py')
    // M1: the Run button carries `disabled` until the picked script reaches the store,
    // and Svelte flushes that one microtask later — a user cannot click faster.
    const runButton = await h.waitFor(() => h.q('script-run', { disabled: false }), { timeout: 2000 })
    h.check('picking a script enables the Run button', !!runButton, h.q('script-run')?.outerHTML?.slice(0, 120))
    h.click(runButton)
    // M1 change 2: the output is a bottom-region panel, which `scripts.run` opens itself.
    await h.waitFor(() => h.q('output-panel', { running: '0' }) && h.q('output-json'), { timeout: 10000 })
    const shown = JSON.parse(h.q('output-json')?.textContent ?? 'null')
    h.check(
      'the output panel shows the result of the run',
      shown?.len === INITIAL.length && shown.upper === INITIAL.toUpperCase() && !!h.q('status-message', { error: '0' }),
      { shown, status: h.q('status-message')?.textContent },
    )
    h.check(
      'the output panel sits in the bottom region',
      !!h.q('panel', { region: 'bottom', panel: 'output' }),
      h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`),
    )
  }
  h.click(h.q('ribbon-tab', { tab: 'home' }))

  // ---------------------------------------------------------------- the fs scope
  const scoped = `${run}/fs-roundtrip.nc`
  /** @param {string} text */
  const bytes = (text) => new TextEncoder().encode(text)
  /** @param {string} path @param {string} text */
  const writeFile = (path, text) => h.attempt('plugin:fs|write_file', bytes(text), { headers: { path: encodeURIComponent(path), options: '{}' } })
  /** @param {string} path */
  const readFile = async (path) => {
    const r = await h.attempt('plugin:fs|read_file', { path, options: {} })
    // The command answers with raw bytes (an ArrayBuffer, or an array of numbers).
    return r.ok ? { ok: true, value: new TextDecoder().decode(r.value instanceof ArrayBuffer ? new Uint8Array(r.value) : Uint8Array.from(r.value)) } : r
  }
  const beforeGrant = await writeFile(scoped, 'G0 X1\n')
  await h.invoke('h_allow', { path: scoped })
  const written = await writeFile(scoped, 'G0 X1 Y2\n')
  const readBack = await readFile(scoped)
  h.check(
    'a file is readable and writable only after it is granted',
    !beforeGrant.ok && written.ok && readBack.ok && readBack.value === 'G0 X1 Y2\n',
    { beforeGrant, written, readBack },
  )
  const outside = {
    read: await readFile(`${run}/not-granted.nc`),
    etcHosts: await readFile('/etc/hosts'),
    write: await writeFile(`${run}/not-granted.nc`, 'x'),
    openForWrite: await h.attempt('plugin:fs|open', { path: `${run}/not-granted.nc`, options: { write: true } }),
  }
  h.check('paths outside the scope stay refused', Object.values(outside).every((r) => !r.ok), outside)
  // A drop grants its paths the way tauri-plugin-fs does before the page sees the event.
  const dropped = `${run}/dropped.nc`
  await h.disk.write(dropped, 'G0 X5\n')
  const beforeDrop = await readFile(dropped)
  await h.drop([dropped], { x: 200, y: 200 })
  const afterDrop = await readFile(dropped)
  h.check('a dropped file is granted like the fs plugin grants it', !beforeDrop.ok && afterDrop.ok && afterDrop.value === 'G0 X5\n', { beforeDrop, afterDrop })

  // M1 change 1: a drop opens the file. The starter buffer has not been touched, so it
  // is the scratch document and the dropped file takes its place instead of leaving an
  // empty tab behind; the window keeps exactly one tab.
  await h.waitFor(async () => (await h.title()) === 'dropped.nc — gEdit', { timeout: 8000 })
  h.check(
    'the dropped file becomes the open document, replacing the untouched starter buffer',
    h.qa('doc-tab').length === 1 && !!h.q('doc-tab', { path: dropped, active: '1' }) && h.app.text() === 'G0 X5\n',
    { tabs: h.qa('doc-tab').map((e) => e.dataset.path), title: await h.title(), text: h.app.text() },
  )

  // The harness can set a file's time, which the external-change checks need later.
  await h.disk.touch(dropped, 1700000000)
  h.check('the harness can set a modification time', (await h.disk.stat(dropped))?.mtimeMs === 1700000000000, await h.disk.stat(dropped))

  const acl = {
    'fs|exists': await h.attempt('plugin:fs|exists', { path: scoped }),
    'fs|read_text_file': await h.attempt('plugin:fs|read_text_file', { path: scoped, options: {} }),
    'fs|remove': await h.attempt('plugin:fs|remove', { path: scoped }),
    'window|close': await h.attempt('plugin:window|close', { label: 'main' }),
    'path|resolve_directory': await h.attempt('plugin:path|resolve_directory', { directory: 1 }),
    'app|version': await h.attempt('plugin:app|version', {}),
    'event|emit': await h.attempt('plugin:event|emit', { event: 'x', payload: null }),
    'opener|open_url': await h.attempt('plugin:opener|open_url', { url: 'https://example.com' }),
  }
  h.check('commands the capability does not grant are denied', Object.values(acl).every((r) => !r.ok), acl)

  // ---------------------------------------------------------------- editing and saving
  // The starter buffer is gone (the drop took its place), so the Save As path below needs
  // a fresh untitled document. `file.new` opens an empty one and reuses the free index 1.
  await h.nativeKeys([{ key: 'n', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'Untitled-1 — gEdit', { timeout: 4000 })
  const untitledId = h.q('editor-host')?.dataset.docId
  h.check('Cmd+N opens a second, empty untitled document', h.qa('doc-tab').length === 2 && h.app.text() === '' && untitledId !== 'd1', {
    tabs: h.qa('doc-tab').map((e) => e.dataset.docId),
    docId: untitledId,
    title: await h.title(),
  })

  h.check('the editor takes focus', h.focusEditor())
  await h.nativeType('T5 M6\n')
  await h.waitFor(async () => (await h.title()) === '● Untitled-1 — gEdit')
  h.check('typing edits the buffer and marks it modified', h.app.text() === 'T5 M6\n' && (await h.title()) === '● Untitled-1 — gEdit', {
    text: h.app.text(),
    title: await h.title(),
  })
  h.check('the cursor follows the typing', JSON.stringify(h.app.cursor()) === '{"line":2,"column":1}', h.app.cursor())
  h.check('the status bar shows the new cursor position', h.q('status-item', { item: 'cursor' })?.textContent === 'Ln 2, Col 1')
  const mapped = await h.waitFor(() => h.q('program-map-item', { line: 1, kind: 'tool' }), { timeout: 3000 })
  h.check('the program map picks up the tool call', !!mapped, h.qa('program-map-item').map((e) => e.dataset.line + ':' + e.dataset.kind))
  h.click(h.q('program-map-item', { line: 1 }))
  await h.waitFor(() => h.app.cursor().line === 1)
  h.check('clicking a program map entry moves the cursor there', JSON.stringify(h.app.cursor()) === '{"line":1,"column":1}', h.app.cursor())

  const savedPath = `${run}/saved.nc`
  let calls = h.dialogs.calls().length
  await h.dialogs.queue('save', savedPath)
  await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'saved.nc — gEdit')
  const saveCall = h.dialogs.calls().slice(calls)
  h.check(
    'Cmd+S on the untitled buffer asks once and writes the file',
    saveCall.length === 1 && saveCall[0].kind === 'save' && saveCall[0].args.options.defaultPath === 'program.nc' && (await h.disk.read(savedPath)) === onDisk(h.app.text()),
    { saveCall, title: await h.title(), disk: await h.disk.read(savedPath).catch((e) => String(e)) },
  )
  // M1/AD-7 (F7): rfd merges every filter into one `allowedFileTypes` list on macOS,
  // which hides extension-less programs, so macOS gets no filters at all.
  h.check('the save dialog carries no filters on macOS', saveCall[0].args.options.filters === undefined, saveCall[0].args.options)
  h.check('saving keeps the document id', h.q('editor-host')?.dataset.docId === untitledId, h.q('editor-host')?.dataset.docId)

  await h.nativeType('(SECOND)\n')
  await h.waitFor(async () => (await h.title()) === '● saved.nc — gEdit')
  calls = h.dialogs.calls().length
  await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'saved.nc — gEdit')
  h.check(
    'the second save writes to the known path without asking',
    h.dialogs.calls().length === calls && (await h.disk.read(savedPath)).includes('(SECOND)'),
    { dialogs: h.dialogs.calls().slice(calls), disk: await h.disk.read(savedPath) },
  )

  // ---------------------------------------------------------------- opening
  const tabsBeforeOpen = h.qa('doc-tab').length
  await h.dialogs.queue('open', sampleH)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'h01-3tools.h — gEdit')
  await h.waitFor(() => h.q('status-item', { item: 'profile' })?.textContent === 'Heidenhain', { timeout: 2000 })
  const tools = h.qa('program-map-item', { kind: 'tool' }).map((e) => e.dataset.line)
  h.check(
    'opening a Klartext file switches the profile and the program map',
    h.app.activeProfile() === 'heidenhain-klartext' && h.q('status-item', { item: 'profile' })?.textContent === 'Heidenhain' && JSON.stringify(tools) === '["6","17","35"]',
    { title: await h.title(), profile: h.app.activeProfile(), tools, status: h.q('status-item', { item: 'profile' })?.textContent },
  )
  const klartextId = h.q('editor-host')?.dataset.docId
  h.check('the opened document gets a new id and its own tab', klartextId !== untitledId && /^d\d+$/.test(klartextId ?? '') && h.qa('doc-tab').length === tabsBeforeOpen + 1, {
    docId: klartextId,
    tabs: h.qa('doc-tab').map((e) => e.dataset.docId),
  })
  h.check('the hook returns the text with LF line breaks', !h.app.text().includes('\r') && h.app.text().startsWith('0 BEGIN PGM'), h.app.text().slice(0, 40))

  const copyPath = `${run}/h01-copy.h`
  calls = h.dialogs.calls().length
  await h.dialogs.queue('save', copyPath)
  await h.nativeKeys([{ key: 's', mods: ['cmd', 'shift'] }])
  await h.waitFor(async () => (await h.title()) === 'h01-copy.h — gEdit')
  const saveAs = h.dialogs.calls().slice(calls)
  h.check(
    'Save As suggests the current file, carries no macOS filter and keeps the bytes',
    saveAs.length === 1 && saveAs[0].args.options.defaultPath === sampleH && saveAs[0].args.options.filters === undefined && (await h.disk.hex(copyPath)) === (await h.disk.hex(sampleH)),
    { saveAs, hexEqual: (await h.disk.hex(copyPath)) === (await h.disk.hex(sampleH)) },
  )

  // ------------------------------------------------- opening no longer asks about edits
  // M1 change 1: Open adds a tab, so it never replaces a modified buffer and the M0
  // "unsaved changes" prompt on Open is gone. The edited document keeps its changes and
  // its file on disk; both documents stay open.
  h.focusEditor()
  await h.nativeType('; EDITED\n')
  await h.waitFor(async () => (await h.title()) === '● h01-copy.h — gEdit')

  const tabsBeforeSecondOpen = h.qa('doc-tab').length
  const messagesBefore = h.dialogs.calls().filter((c) => c.kind === 'message').length
  await h.dialogs.queue('open', fanucTxt)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'detect-fanuc.txt — gEdit')
  await h.sleep(500)
  h.check(
    'opening a file while another one is modified asks nothing and adds a tab',
    (await h.alert.visible()) === null &&
      h.dialogs.calls().filter((c) => c.kind === 'message').length === messagesBefore &&
      h.qa('doc-tab').length === tabsBeforeSecondOpen + 1,
    { tabs: h.qa('doc-tab').map((e) => e.dataset.path), alert: await h.alert.visible() },
  )
  h.check(
    'the edited document keeps its changes and its file on disk',
    !!h.q('doc-tab', { docId: klartextId ?? '', dirty: '1' }) && !(await h.disk.read(copyPath)).includes('EDITED'),
    { tab: h.q('doc-tab', { docId: klartextId ?? '' })?.dataset.dirty, disk: (await h.disk.read(copyPath)).slice(0, 40) },
  )
  await h.waitFor(() => h.q('status-item', { item: 'profile' })?.textContent === 'Fanuc', { timeout: 2000 })
  h.check(
    'the newly opened file is the active document, with its own profile',
    h.app.activeProfile() === 'fanuc-gcode' && h.q('editor-host')?.dataset.docId !== klartextId,
    { profile: h.app.activeProfile(), docId: h.q('editor-host')?.dataset.docId },
  )

  // Opening a file that is already open focuses its tab instead of adding a second one.
  const tabsBeforeRefocus = h.qa('doc-tab').length
  await h.dialogs.queue('open', copyPath)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === '● h01-copy.h — gEdit')
  h.check(
    'opening a file that is already open focuses its tab',
    h.qa('doc-tab').length === tabsBeforeRefocus && h.q('editor-host')?.dataset.docId === klartextId && h.app.text().startsWith('; EDITED'),
    { tabs: h.qa('doc-tab').length, docId: h.q('editor-host')?.dataset.docId, status: h.q('status-message')?.textContent },
  )

  // ---------------------------------------------------------------- errors
  h.allowErrors(/Could not open does-not-exist\.nc/)
  await h.dialogs.queue('open', `${run}/does-not-exist.nc`)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  const errorAlert = await h.alert.wait()
  h.check('a file that cannot be read is reported in a dialog', !!errorAlert && errorAlert.texts.some((t) => t.includes('does-not-exist.nc')), errorAlert)
  await h.alert.click('OK|Ok')
  await h.sleep(300)
  h.check(
    'the failed open shows an error in the status bar and keeps the document',
    !!h.q('status-message', { error: '1' }) && (await h.title()) === '● h01-copy.h — gEdit',
    { status: h.q('status-message')?.textContent, title: await h.title() },
  )

  // ---------------------------------------------------------------- the close guard
  // Exactly one document is unsaved, so the alert keeps the single-document wording.
  h.focusEditor()
  await h.nativeType('; DIRTY FOR CLOSE\n')
  await h.waitFor(async () => (await h.title()) === '● h01-copy.h — gEdit')
  h.check('only the edited document is unsaved', h.qa('doc-tab', { dirty: '1' }).length === 1, h.qa('doc-tab').map((e) => `${e.dataset.path}:${e.dataset.dirty}`))
  await h.window.close()
  const closePrompt = await h.alert.wait()
  h.check('closing a modified buffer asks first', JSON.stringify(closePrompt?.buttons) === JSON.stringify(['Save', "Don't Save", 'Cancel']), closePrompt)
  await h.alert.click('Cancel')
  await h.sleep(1500)
  const state = await h.window.state()
  h.check('Cancel keeps the window open', state.exists && state.visible && (await h.title()) === '● h01-copy.h — gEdit', state)

  // ---------------------------------------------------------------- the CSP
  h.check('nothing violated the CSP so far', h.rec.violations.length === 0, h.rec.violations)
  /** @type {Record<string, string>} */
  const probes = {}
  const violations = await h.expectViolations(async () => {
    try {
      probes.eval = `NOT BLOCKED: ${eval('1 + 1')}`
    } catch (e) {
      probes.eval = `blocked: ${e}`
    }
    try {
      probes.newFunction = `NOT BLOCKED: ${new Function('return 2')()}`
    } catch (e) {
      probes.newFunction = `blocked: ${e}`
    }
    const style = document.createElement('style')
    style.textContent = '#rh-style-probe{width:123px}'
    document.head.appendChild(style)
    const div = document.createElement('div')
    div.id = 'rh-style-probe'
    document.body.append(div)
    await h.sleep(50)
    probes.inlineStyle = div.offsetWidth === 123 ? 'works' : `blocked (${div.offsetWidth}px)`
    div.remove()
    style.remove()
  })
  h.check(
    'the CSP blocks eval and new Function while inline styles keep working',
    /^blocked/.test(probes.eval) && /^blocked/.test(probes.newFunction) && probes.inlineStyle === 'works' && violations.some((v) => /script-src/.test(v.directive)),
    { probes, violations },
  )

  const ipcWarnings = h.rec.warnings.filter((w) => /IPC custom protocol failed/.test(w))
  h.check('every command went over the IPC custom protocol', ipcWarnings.length === 0 && h.rec.ipc.ok > 0 && h.rec.ipc.netFail === 0, {
    ipc: { ok: h.rec.ipc.ok, err: h.rec.ipc.err, netFail: h.rec.ipc.netFail },
    ipcWarnings,
    otherFetches: h.rec.otherFetches,
  })

  // Leave a clean buffer, so the run ends without a prompt.
  h.focusEditor()
  await h.nativeKeys([{ key: 's', mods: ['cmd'] }])
  await h.waitFor(async () => (await h.title()) === 'h01-copy.h — gEdit')
  h.check('every document is saved when the run ends', h.qa('doc-tab', { dirty: '1' }).length === 0, h.qa('doc-tab').map((e) => `${e.dataset.path}:${e.dataset.dirty}`))
})
