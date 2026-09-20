// Comparing (plan §5 M2 H2 `m2-compare`, §7.3, WP2.5): with the saved version, with
// another tab and with a file; the toolbar; closing restores the editor and its view
// state; no temporary model is left behind; and a file above the 50 MB worker limit is
// refused instead of producing a diff that never arrives (F8).
//
// It also drives the case mergeA §2.5 found and fixed: a comparison closed *before* its
// first diff has been computed. The worker answers `null` for a model that was unsynced
// meanwhile, and `WorkerBasedDocumentDiffProvider` turns that into a throw unless its
// cancellation token has been flagged — which happens a tick after `dispose()` returns.
// A user hits this by opening Compare and changing their mind, so the scenario does too.
//
// The Esc pair below was H2's app bug 1, fixed in integration: Monaco's text area calls
// `preventDefault()` on *every* Escape (an IE keypress workaround), so the guard in
// `CompareView.onKeyDown` returned on `event.defaultPrevented` and nothing closed. The
// real "Monaco handled it" signal is `stopPropagation()`, which the keybinding service
// raises only when a keybinding matched — so the two checks are now kept together: a
// plain Esc closes the comparison, and an Esc that closes the find widget does not.
//
// Counting models needs Monaco's `IModelService`, and the page has no `monaco` global:
// the scenario bundle would only bundle a second, unrelated copy of the editor. The one
// live handle is the editor instance, so the registry is read out of its instantiation
// service. That is an internal of a pinned dependency (monaco 0.55), and the check below
// says so rather than skipping quietly if it ever moves.

import { scenario } from '../lib/index.js'
import { configPaths, python } from './m2-common.js'

/** 50 MiB + a bit, in one write, so `readDisk` decodes more than `MODEL_SYNC_LIMIT_CHARS`. */
const BIG = 'import sys\np = sys.stdin.read().strip()\nwith open(p, "w") as f:\n    f.write(("G1 X1 Y1 Z1 F500 (PADDING PADDING PADDING)\\n" * 1300000))\n    f.write("M30\\n")\nprint(1)\n'

/** Monaco's model registry, through the editor's instantiation service (see the header). */
function modelService(/** @type {any} */ ctx) {
  let inst = /** @type {any} */ (ctx.editor.editorInstance())?._instantiationService
  while (inst) {
    for (const [id, service] of inst._services?._entries ?? []) {
      if (String(id) === 'modelService' && typeof service?.getModels === 'function') return service
    }
    inst = inst._parent
  }
  return null
}

scenario('m2-compare', { timeout: 300 }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const view = () => h.q('compare-view')
  const toolButton = (/** @type {string} */ label) => /** @type {HTMLElement | null} */ (view()?.querySelector(`[aria-label="${label}"]`) ?? null)
  const closeAndWait = async () => {
    await ctx.commands.run('compare.close')
    await h.waitFor(() => !view() && !!h.q('editor-host'), { timeout: 10000 })
  }

  const fanuc = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  const klartext = await h.fixture('nc/heidenhain/h01-3tools.h')
  await h.dialogs.queue('open', [fanuc, klartext])
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  await h.waitFor(() => h.qa('doc-tab').length >= 2 && !!ctx.docs.byPath(fanuc), { timeout: 15000 })

  const id = ctx.docs.byPath(fanuc).id
  ctx.docs.activate(id)
  await h.waitFor(() => ctx.docs.getActiveId() === id, { timeout: 5000 })
  // A difference to find, and a cursor position that must survive the comparison.
  ctx.editor.reveal(id, 5, 1)
  ctx.editor.insertText('(COMPARE ME)\n')
  await h.waitFor(() => h.q('doc-tab', { docId: id, dirty: '1' }), { timeout: 5000 })
  ctx.editor.reveal(id, 5, 1)
  const cursorBefore = JSON.stringify(h.app.cursor())
  const textBefore = ctx.editor.getText(id)

  const models = modelService(ctx)
  h.check('Monaco’s model registry is reachable (monaco 0.55 internals)', models !== null)
  const modelCount = () => models?.getModels().length ?? -1
  const baseline = modelCount()

  // ------------------------------------------------------------ Mod+Alt+C, the saved version
  await h.nativeKeys([{ key: 'c', mods: ['cmd', 'alt'] }])
  await h.waitFor(() => !!h.q('quick-pick'), { timeout: 5000 })
  const sources = h.qa('quick-pick-item').map((e) => e.textContent?.trim().split('\n')[0])
  h.check('Mod+Alt+C offers the three sources of a saved document with a second tab open', sources.length === 3 && sources[0]?.startsWith('Saved version') && sources[1]?.startsWith('Open document') && sources[2]?.startsWith('File'), sources)
  h.click(h.q('quick-pick-item', { index: 0 }))
  await h.waitFor(() => !!view(), { timeout: 15000 })
  h.check('the comparison opens in the overlay, against the saved version', view()?.dataset.source === 'saved', view()?.dataset.source)
  h.check('the editor host gives way to it', !h.q('editor-host'))
  h.check('the caption names both sides', /f01-mill-3tools\.nc ↔ saved version/.test(view()?.textContent ?? ''), view()?.querySelector('.caption')?.textContent)
  await h.waitFor(() => !!view()?.querySelector('.monaco-diff-editor'), { timeout: 15000 })
  h.check('a diff editor is mounted', !!view()?.querySelector('.monaco-diff-editor'))
  h.check('the diff really has two sides', (view()?.querySelectorAll('.monaco-diff-editor .editor').length ?? 0) >= 2, view()?.querySelectorAll('.monaco-diff-editor .editor').length)

  // ------------------------------------------------------------ Esc, and the find widget first
  // The find widget owns the first Esc, because Monaco's keybinding service matched
  // `closeFindWidget` and stopped propagation before the event could reach `CompareView`.
  const findWidget = () => /** @type {HTMLElement | null} */ (view()?.querySelector('.find-widget.visible') ?? null)
  await h.nativeKeys([{ key: 'f', mods: ['cmd'] }])
  await h.waitFor(() => !!findWidget(), { timeout: 5000 })
  h.check('Mod+F opens the find widget inside the comparison', !!findWidget())
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !findWidget(), { timeout: 5000 })
  h.check('the first Esc closes the find widget and leaves the comparison open', !findWidget() && !!view(), { findWidget: !!findWidget(), open: !!view() })

  // Two spies, because the two facts live in different phases. Capture runs before the
  // target, so the comparison is still mounted and "was it delivered inside?" can be
  // asked at all — by the time the event bubbles back to `document`, `CompareView` has
  // closed it. Bubble runs after the target, which is where Monaco's `preventDefault()`
  // has landed, so it is the only phase that can show the flag is meaningless.
  /** @type {{ inside: boolean } | null} */
  let delivered = null
  /** @type {{ prevented: boolean } | null} */
  let settled = null
  const onCapture = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') delivered = { inside: !!view()?.contains(/** @type {Node} */ (event.target)) }
  }
  const onBubble = (/** @type {KeyboardEvent} */ event) => {
    if (event.key === 'Escape') settled = { prevented: event.defaultPrevented }
  }
  document.addEventListener('keydown', onCapture, true)
  document.addEventListener('keydown', onBubble)
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !view(), { timeout: 5000 })
  document.removeEventListener('keydown', onCapture, true)
  document.removeEventListener('keydown', onBubble)
  // Read through a cast: TypeScript does not see the assignments inside the listeners.
  const sawDelivery = /** @type {{ inside: boolean } | null} */ (delivered)
  const sawFlag = /** @type {{ prevented: boolean } | null} */ (settled)
  h.check('the Escape key is delivered inside the comparison', sawDelivery?.inside === true, sawDelivery)
  // True even though this Escape closed the comparison: Monaco preventDefaults them all.
  h.check('Monaco marks every Escape defaultPrevented, so it cannot be the test', sawFlag?.prevented === true, sawFlag)
  h.check('the next Esc closes the comparison', !view() && !!h.q('editor-host'), { delivered: sawDelivery, flag: sawFlag, stillOpen: !!view() })
  if (view()) h.click(toolButton('Close Comparison'))
  await h.waitFor(() => !view() && !!h.q('editor-host'), { timeout: 10000 })

  // ------------------------------------------------------------ closing puts the editor back
  h.check('closing brings the editor back', !view() && !!h.q('editor-host'))
  h.check('the document was never touched', ctx.editor.getText(id) === textBefore)
  await h.waitFor(() => JSON.stringify(h.app.cursor()) === cursorBefore, { timeout: 5000 })
  h.check('and the cursor is where it was', JSON.stringify(h.app.cursor()) === cursorBefore, { before: cursorBefore, after: JSON.stringify(h.app.cursor()) })
  // The model is let go of a moment after the close on purpose (mergeA §2.5, I2), so
  // every count below waits instead of reading straight away.
  await h.waitFor(() => modelCount() === baseline, { timeout: 5000 })
  h.check('no temporary model is left behind', modelCount() === baseline, { baseline, now: modelCount() })

  // ------------------------------------------------------------ the toolbar
  void ctx.commands.run('compare.withSaved', { docId: id })
  await h.waitFor(() => !!view()?.querySelector('.monaco-diff-editor'), { timeout: 15000 })
  const inlineButton = () => /** @type {HTMLElement | null} */ (view()?.querySelector('[aria-pressed]') ?? null)
  h.check('it starts side by side', inlineButton()?.getAttribute('aria-pressed') === 'false', inlineButton()?.getAttribute('aria-pressed'))
  await ctx.commands.run('compare.toggleInline')
  await h.waitFor(() => inlineButton()?.getAttribute('aria-pressed') === 'true', { timeout: 5000 })
  h.check('compare.toggleInline switches to the inline view', inlineButton()?.getAttribute('aria-pressed') === 'true')
  h.click(inlineButton())
  await h.waitFor(() => inlineButton()?.getAttribute('aria-pressed') === 'false', { timeout: 5000 })
  h.check('and the toolbar button switches back', inlineButton()?.getAttribute('aria-pressed') === 'false')
  h.check('the toolbar has the two navigation buttons', !!toolButton('Next Difference') && !!toolButton('Previous Difference'))
  h.click(toolButton('Next Difference'))
  await h.sleep(300)
  await ctx.commands.run('compare.prevDiff')
  await h.sleep(300)
  h.check('stepping through the differences leaves the comparison up and the document alone', !!view() && ctx.editor.getText(id) === textBefore)
  await closeAndWait()
  await h.waitFor(() => modelCount() === baseline, { timeout: 5000 })
  h.check('compare.close drops the model as well', modelCount() === baseline, { baseline, now: modelCount() })

  // ------------------------------------------------------------ closed before the first diff
  // mergeA §2.5: this threw `no diff result available` as an unhandled rejection. A
  // `Canceled` rejection is how Monaco ends work it no longer needs and is expected.
  const errorsBefore = h.rec.errors.length
  void ctx.commands.run('compare.withSaved', { docId: id })
  await h.waitFor(() => !!view(), { timeout: 15000 })
  ctx.compare.close()
  await h.waitFor(() => !view() && !!h.q('editor-host'), { timeout: 10000 })
  await h.sleep(1500)
  const after = h.rec.errors.slice(errorsBefore).filter((/** @type {string} */ e) => !/Canceled/.test(e))
  h.check('a comparison closed before its first diff says nothing at all', after.length === 0 && !h.rec.errors.some((/** @type {string} */ e) => /diff result/.test(e)), after)
  await h.waitFor(() => modelCount() === baseline, { timeout: 5000 })
  h.check('and leaves no model behind either', modelCount() === baseline, { baseline, now: modelCount() })

  // ------------------------------------------------------------ with another document
  await ctx.commands.run('compare.withDocument')
  await h.waitFor(() => !!view(), { timeout: 15000 })
  h.check('with exactly two tabs open there is nothing to pick', view()?.dataset.source === 'document' && !h.q('quick-pick'), view()?.dataset.source)
  h.check('the caption names the other tab', /f01-mill-3tools\.nc ↔ h01-3tools\.h/.test(view()?.textContent ?? ''), view()?.querySelector('.caption')?.textContent)
  await h.waitFor(() => !!view()?.querySelector('.monaco-diff-editor'), { timeout: 15000 })
  h.check('a document comparison owns no model of its own', modelCount() === baseline, { baseline, now: modelCount() })
  await closeAndWait()
  h.check('closing a document comparison keeps both documents', ctx.docs.all().length === 2 && ctx.editor.getText(id) === textBefore, ctx.docs.all().map((/** @type {any} */ d) => d.title))

  // ------------------------------------------------------------ with a file
  const other = await h.fixture('nc/fanuc/f02-packed.nc')
  await h.dialogs.queue('open', other)
  await ctx.commands.run('compare.withFile')
  await h.waitFor(() => !!view(), { timeout: 15000 })
  h.check('a file comparison names the file', view()?.dataset.source === 'file' && /f02-packed\.nc/.test(view()?.textContent ?? ''), view()?.dataset.source)
  await h.waitFor(() => !!view()?.querySelector('.monaco-diff-editor'), { timeout: 15000 })
  h.check('the file is not opened as a tab', ctx.docs.all().length === 2 && !ctx.docs.byPath(other), ctx.docs.all().map((/** @type {any} */ d) => d.title))
  h.check('its temporary model is on the original side', modelCount() === baseline + 1, { baseline, now: modelCount() })
  await closeAndWait()
  await h.waitFor(() => modelCount() === baseline, { timeout: 5000 })
  h.check('and it is disposed when the comparison closes', modelCount() === baseline, { baseline, now: modelCount() })

  // ------------------------------------------------------------ the 50 MB guard (F8)
  const huge = `${h.cfg.run}/huge.nc`
  await python(h, 'rh_big.py', BIG, huge)
  const size = (await h.disk.stat(huge))?.len ?? 0
  h.check('the generated file is above the diff worker’s limit', size > 50 * 1024 * 1024, size)
  await h.dialogs.queue('open', huge)
  const opened = await ctx.commands.run('compare.withFile')
  await h.sleep(500)
  h.check('a file above the limit is refused, and no diff is built', !view() && !!h.q('editor-host'), { opened, view: !!view() })
  h.check('the status bar says why', h.q('status-message')?.dataset.error === '1' && /cannot be compared/.test(h.q('status-message')?.textContent ?? ''), h.q('status-message')?.textContent)
  h.check('nothing of it stayed in the model registry', modelCount() === baseline, { baseline, now: modelCount() })

  // The comparison never wrote anything: the config folder is still untouched by it.
  const paths = configPaths(ctx)
  h.check('comparing wrote no settings', (await h.disk.stat(paths.settingsFile)) === null, paths.settingsFile)
})
