// About and the shortcut reference (plan §5 M2 H2 `m2-about`, WP2.4): the version and
// the third-party notices are there, the notices are only loaded when they are asked for
// (a lazy `import()` of a 1 MB JSON under the app's own CSP), and every registered
// command appears in the shortcut list with its macOS keys.
//
// Both dialogs are opened from the View tab's Help group, so the ribbon entries are
// covered too. `modals.open` only settles when the dialog closes, so the command is
// started with `void` and awaited afterwards (WP2.7 §7.1).

import { scenario } from '../lib/index.js'
import { setInput } from './m2-common.js'

scenario('m2-about', { timeout: 180 }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const openFromRibbon = async (/** @type {string} */ command, /** @type {string} */ id) => {
    h.click(h.q('ribbon-tab', { tab: 'view' }))
    // Wait for the button the tab switch is supposed to bring in, not for a fixed span:
    // 120 ms is enough on an idle Mac and a guess on a loaded one.
    await h.waitFor(() => !!h.q('cmd-button', { command }), { timeout: 5000 })
    const button = h.q('cmd-button', { command })
    if (!button) throw new Error(`no ribbon button for ${command}`)
    h.click(button)
    await h.waitFor(() => !!h.q('modal', { modal: id }), { timeout: 5000 })
  }

  // ------------------------------------------------------------ About
  await openFromRibbon('help.about', 'about')
  h.check('the About dialog is the one `modal` on screen (mergeA §2.2)', h.qa('modal').length === 1 && h.q('modal')?.dataset.modal === 'about', h.qa('modal').map((e) => e.dataset.modal))
  h.check('the backdrop keeps its own test id and holds the dialog', !!h.q('modal-backdrop')?.contains(h.q('modal')), h.q('modal-backdrop')?.outerHTML?.slice(0, 120))
  h.check('it shows this build', h.q('about-version')?.textContent?.trim() === h.app.version, { shown: h.q('about-version')?.textContent, version: h.app.version })
  h.check('it names the license', /MIT/.test(h.q('about-license')?.textContent ?? ''), h.q('about-license')?.textContent)
  h.check('the repository and the issue tracker are copyable text, not links', /^https:\/\//.test(h.q('about-repository')?.textContent ?? '') && /^https:\/\//.test(h.q('about-issues')?.textContent ?? '') && h.q('modal', { modal: 'about' })?.querySelectorAll('a').length === 0, {
    repository: h.q('about-repository')?.textContent,
    issues: h.q('about-issues')?.textContent,
    anchors: h.q('modal', { modal: 'about' })?.querySelectorAll('a').length,
  })
  h.check('it says there is no update check', (h.q('about-updates')?.textContent ?? '').length > 0, h.q('about-updates')?.textContent)

  // The notices are a lazy import(): nothing of them is in the dialog until it is asked.
  h.check('no notice is loaded before the button is pressed', h.qa('license-entry').length === 0 && !h.q('about-notices-status'))
  h.click(h.q('about-notices'))
  await h.waitFor(() => h.qa('license-entry').length > 0, { timeout: 20000 })
  const entries = h.qa('license-entry')
  h.check('pressing it loads every package', entries.length > 100, entries.length)
  h.check('each one names its package', entries.every((e) => (e.dataset.package ?? '').length > 0) && entries[0]?.dataset.open === '0', entries[0]?.outerHTML?.slice(0, 160))
  h.check('no license text is expanded yet', h.qa('license-text').length === 0)

  const first = entries[0]
  const firstPackage = first.dataset.package ?? ''
  h.click(/** @type {HTMLElement | null} */ (first.querySelector('button')))
  await h.waitFor(() => h.qa('license-text').length === 1, { timeout: 5000 })
  h.check('expanding one shows its license text', (h.q('license-text')?.textContent ?? '').length > 100 && h.q('license-entry', { package: firstPackage })?.dataset.open === '1', {
    length: h.q('license-text')?.textContent?.length,
    open: h.q('license-entry', { package: firstPackage })?.dataset.open,
  })

  h.click(h.q('modal', { modal: 'about' })?.querySelector('[data-testid="modal-cancel"]'))
  await h.waitFor(() => !h.q('modal', { modal: 'about' }), { timeout: 5000 })
  h.check('Close closes it', !h.q('modal'))

  // ------------------------------------------------------------ the shortcut reference
  await openFromRibbon('help.shortcuts', 'shortcuts')
  const rows = h.qa('shortcuts-row')
  const registered = ctx.commands.list()
  h.check('every registered command has a row', rows.length === registered.length, { rows: rows.length, commands: registered.length })
  h.check('the rows are grouped by category', h.qa('shortcuts-group').length > 1 && h.qa('shortcuts-group').every((g) => (g.dataset.group ?? '').length > 0), h.qa('shortcuts-group').map((g) => g.dataset.group))
  h.check('a row carries the command id and its platform keys', h.q('shortcuts-row', { command: 'file.save' })?.dataset.keys === '⌘S', h.q('shortcuts-row', { command: 'file.save' })?.dataset.keys)
  h.check('the two M2 bindings of §7.11 are shown the macOS way', h.q('shortcuts-row', { command: 'compare.with' })?.dataset.keys === '⌥⌘C' && h.q('shortcuts-row', { command: 'settings.open' })?.dataset.keys === '⌘,', {
    compare: h.q('shortcuts-row', { command: 'compare.with' })?.dataset.keys,
    settings: h.q('shortcuts-row', { command: 'settings.open' })?.dataset.keys,
  })
  const unbound = rows.filter((r) => !r.dataset.keys)
  h.check('a command without a shortcut is listed too, without keys', unbound.length > 0 && unbound.length === registered.filter((/** @type {any} */ c) => c.keys === undefined).length, {
    unbound: unbound.length,
    expected: registered.filter((/** @type {any} */ c) => c.keys === undefined).length,
  })

  setInput(h.q('shortcuts-filter'), 'compare')
  await h.waitFor(() => h.qa('shortcuts-row').length < rows.length, { timeout: 3000 })
  h.check('the filter narrows the list to one group', h.qa('shortcuts-row').every((r) => (r.dataset.command ?? '').startsWith('compare.')) && h.qa('shortcuts-row').length > 1, h.qa('shortcuts-row').map((r) => r.dataset.command))
  setInput(h.q('shortcuts-filter'), 'zzz-nothing-matches')
  await h.waitFor(() => !!h.q('shortcuts-empty'), { timeout: 3000 })
  h.check('and says so when nothing matches', !!h.q('shortcuts-empty') && h.qa('shortcuts-row').length === 0)

  // Esc is the Modal's own key handler (WP2.2), not a registered binding.
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !h.q('modal', { modal: 'shortcuts' }), { timeout: 5000 })
  h.check('Esc closes the shortcut reference', !h.q('modal'))
})
