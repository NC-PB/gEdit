// The M1 wiring smoke test: proves the app boots, that bootstrap wired the registries,
// that the shell renders what the registries hold, and that a file actually opens
// through the real dialogs + fileOps + codec path.
//
// This is the regression net for the whole M1 wiring: without it a later change can
// break startup while every other gate still passes. It came from I2 (merge B), which
// wrote it to prove the merge and handed it to H1 to adopt; the only changes are the
// name and this comment.

import { scenario } from '../lib/index.js'

scenario('m1-smoke', { timeout: 180 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  h.check('the test hook exposes ctx', !!ctx, Object.keys(ctx ?? {}))

  // ------------------------------------------------------------------ startup
  h.check('the page runs from the app protocol', location.origin === 'tauri://localhost', location.href)

  const shell = h.q('app-shell')
  h.check('the app shell is rendered', !!shell)
  await h.waitFor(() => h.q('app-shell')?.getAttribute('data-ready') === '1', { timeout: 20000 })
  h.check('bootstrap finished and Monaco is up (data-ready=1)', h.q('app-shell')?.getAttribute('data-ready') === '1')

  // ------------------------------------------------------------------ the editor really renders
  const editor = h.q('editor-host')
  const lines = () => [...(editor?.querySelectorAll('.view-lines .view-line') ?? [])]
  await h.waitFor(() => lines().length > 0, { timeout: 10000 })
  h.check('Monaco fills the editor host and shows lines', !!editor && editor.offsetHeight > 100 && lines().length > 0, {
    size: [editor?.offsetWidth, editor?.offsetHeight],
    lines: lines().length,
  })
  const colors = () =>
    new Set(
      [...(editor?.querySelectorAll('.view-lines .view-line span span') ?? [])].map((s) => getComputedStyle(s).color),
    )
  await h.waitFor(() => colors().size > 1, { timeout: 5000 })
  h.check('the NC tokens are coloured', colors().size > 1, [...colors()])

  // ------------------------------------------------------------------ WP1.6 made a document
  h.check('an initial document exists', ctx.docs.all().length === 1, ctx.docs.all().map((d) => d.title))
  h.check('it is Untitled-1', ctx.docs.all()[0]?.title === 'Untitled-1', ctx.docs.all()[0]?.title)
  h.check('the window title follows it', (await h.title()) === 'Untitled-1 — gEdit', await h.title())
  h.check('the tab bar shows exactly one tab', h.qa('doc-tab').length === 1)

  // ------------------------------------------------------------------ registries -> shell
  const cmdIds = ctx.commands.list().map((c) => c.id)
  for (const id of ['file.new', 'file.open', 'file.save', 'file.close', 'view.commandPalette', 'view.showOutput'])
    h.check(`command ${id} is registered`, cmdIds.includes(id))

  h.check('the ribbon is rendered', !!h.q('ribbon'))
  h.check('the ribbon has tabs', h.qa('ribbon-tab').length >= 3, h.qa('ribbon-tab').map((e) => e.dataset.tab))
  h.check('the Home tab shows the File group buttons', !!h.q('cmd-button', { command: 'file.open' }))

  // ------------------------------------------------------------------ the status bar (the I2 fix)
  h.check('exactly one file status item', h.qa('status-item', { item: 'file' }).length === 1, {
    found: h.qa('status-item', { item: 'file' }).map((e) => e.textContent),
  })
  h.check('the file item names the document', h.q('status-item', { item: 'file' })?.textContent?.trim() === 'Untitled-1', h.q('status-item', { item: 'file' })?.textContent)
  for (const item of ['message', 'profile', 'encoding', 'eol', 'cursor']) {
    h.check(`status item ${item} is present exactly once`, h.qa('status-item', { item }).length === 1)
  }
  h.check('the profile item reads Fanuc', h.q('status-item', { item: 'profile' })?.textContent?.includes('Fanuc'), h.q('status-item', { item: 'profile' })?.textContent)
  h.check('the encoding item reads UTF-8', h.q('status-item', { item: 'encoding' })?.textContent === 'UTF-8', h.q('status-item', { item: 'encoding' })?.textContent)
  h.check('the cursor item reads Ln 1, Col 1', h.q('status-item', { item: 'cursor' })?.textContent === 'Ln 1, Col 1', h.q('status-item', { item: 'cursor' })?.textContent)

  // ------------------------------------------------------------------ panels from the registry
  h.check('the program map panel is in the left region', !!h.q('panel', { region: 'left', panel: 'programMap' }), {
    panels: h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`),
  })
  h.check('the program map itself rendered', !!h.q('program-map'))

  // the bottom region is closed until something opens it
  h.check('the output panel starts closed', !h.q('panel', { region: 'bottom' }))
  await ctx.commands.run('view.showOutput')
  await h.waitFor(() => !!h.q('panel', { region: 'bottom', panel: 'output' }), { timeout: 3000 })
  h.check('view.showOutput opens Output in the bottom region', !!h.q('panel', { region: 'bottom', panel: 'output' }))
  h.check('the output panel test ids are there', !!h.q('output-panel'))

  // ------------------------------------------------------------------ open a real file end to end
  const sample = await h.fixture('nc/heidenhain/h01-3tools.h')
  await h.dialogs.queue('open', sample)
  await ctx.commands.run('file.open')
  await h.waitFor(() => ctx.docs.all().some((d) => d.path === sample), { timeout: 10000 })
  const opened = ctx.docs.all().find((d) => d.path === sample)
  h.check('the file opened through dialogs + fileOps', !!opened, ctx.docs.all().map((d) => d.title))
  h.check('it replaced the untouched scratch buffer', ctx.docs.all().length === 1, ctx.docs.all().map((d) => d.title))
  h.check('the Klartext profile was detected', opened?.profileId === 'heidenhain-klartext', opened?.profileId)
  h.check('the editor shows the file', h.app.text().includes('BEGIN PGM'), h.app.text().slice(0, 40))
  h.check('the status bar followed', h.q('status-item', { item: 'file' })?.textContent?.trim() === 'h01-3tools.h', h.q('status-item', { item: 'file' })?.textContent)
  h.check('the profile item followed', h.q('status-item', { item: 'profile' })?.textContent?.includes('Heidenhain'), h.q('status-item', { item: 'profile' })?.textContent)
  await h.waitFor(() => h.qa('program-map-item').length > 0, { timeout: 3000 })
  h.check('the program map parsed the file', h.qa('program-map-item').length > 0, h.qa('program-map-item').length)

  // ------------------------------------------------------------------ the status service really shows
  ctx.status.show('m1 smoke message')
  await h.waitFor(() => h.q('status-message')?.textContent === 'm1 smoke message', { timeout: 2000 })
  h.check('status.show reaches the status bar', h.q('status-message')?.textContent === 'm1 smoke message')
})
