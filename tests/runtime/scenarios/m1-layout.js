// The shell layout (plan §5 M1 H1 `m1-layout`, AD-6, §7.9 `panel`): the window never
// grows a scrollbar of its own, the ribbon scrolls instead of squeezing its buttons, the
// panel regions collapse and expand, Output lives in the bottom region, and the two
// splitters resize their region from the keyboard.
//
// WINDOW SIZE: the plan says 1366x768. The harness fixes the window at 1100x700
// (`tests/runtime/harness/harness.rs`, `prepare_main_window`) and a scenario cannot
// resize it, so everything below runs at the narrower 1100x668 viewport — a stricter
// width for the same properties. See the H1 hand-off note.

import { scenario } from '../lib/index.js'

const TABS = ['home', 'insert', 'tools', 'view']

scenario('m1-layout', { timeout: 180 }, async (h) => {
  const ctx = /** @type {import('$lib/app/types').AppContext} */ (h.app.ctx)
  const doc = document.documentElement
  const region = (/** @type {string} */ name) => h.q('panel', { region: name })
  const separators = () => [...document.querySelectorAll('[role="separator"]')].map((e) => /** @type {HTMLElement} */ (e))
  const pageScrolls = () => doc.scrollWidth > doc.clientWidth || doc.scrollHeight > doc.clientHeight

  /** Runs a view command the way a user does: the View tab, then its ribbon button. */
  const viewCommand = async (/** @type {string} */ id) => {
    h.click(h.q('ribbon-tab', { tab: 'view' }))
    await h.sleep(120)
    const button = h.q('cmd-button', { command: id })
    if (!button) throw new Error(`no ribbon button for ${id}`)
    h.click(button)
    await h.sleep(250)
  }

  // ------------------------------------------------------------ the window itself
  const shell = h.q('app-shell')
  const rect = shell?.getBoundingClientRect()
  h.check(
    'the shell fills the window exactly and the page itself never scrolls',
    Math.round(rect?.width ?? 0) === window.innerWidth && Math.round(rect?.height ?? 0) === window.innerHeight && !pageScrolls(),
    { viewport: [window.innerWidth, window.innerHeight], shell: [rect?.width, rect?.height], page: [doc.scrollWidth, doc.scrollHeight] },
  )

  // ------------------------------------------------------------ the ribbon
  const ribbon = h.q('ribbon')
  const ribbonBody = /** @type {HTMLElement | null} */ (ribbon?.querySelector('.ribbon-body'))
  h.check('the ribbon body is the horizontal scroll container', !!ribbonBody && getComputedStyle(ribbonBody).overflowX === 'auto' && getComputedStyle(ribbonBody).overflowY === 'hidden', {
    overflowX: ribbonBody ? getComputedStyle(ribbonBody).overflowX : null,
    overflowY: ribbonBody ? getComputedStyle(ribbonBody).overflowY : null,
  })
  /** @type {Record<string, unknown>} */
  const perTab = {}
  let squeezed = 0
  for (const tab of TABS) {
    h.click(h.q('ribbon-tab', { tab }))
    await h.sleep(150)
    const groups = [...(ribbonBody?.querySelectorAll('.ribbon-group') ?? [])]
    const buttons = h.qa('cmd-button')
    for (const el of [...groups, ...buttons]) if (getComputedStyle(/** @type {Element} */ (el)).flexShrink !== '0') squeezed++
    perTab[tab] = { groups: groups.length, buttons: buttons.length, scrollWidth: ribbonBody?.scrollWidth, clientWidth: ribbonBody?.clientWidth, pageScrolls: pageScrolls() }
    h.check(`the ${tab} tab renders without making the page scroll`, !pageScrolls() && h.q('ribbon-tab', { tab, 'aria-selected': 'true' }) !== null, perTab[tab])
  }
  h.check('no ribbon group or button may be squeezed: they all have flex-shrink 0', squeezed === 0, { squeezed, perTab })
  h.click(h.q('ribbon-tab', { tab: 'home' }))
  await h.sleep(150)

  // A real overflow, on the strip that does overflow at this width: the tab bar. It is
  // the same AD-6 rule — the strip scrolls, the window does not.
  const bar = h.q('tab-bar')
  for (let i = 0; i < 11; i++) await ctx.commands.run('file.new')
  await h.waitFor(() => h.qa('doc-tab').length === 12, { timeout: 8000 })
  await h.sleep(300)
  h.check(
    'with twelve tabs the tab bar scrolls horizontally and the window still does not',
    (bar?.scrollWidth ?? 0) > (bar?.clientWidth ?? 0) && !pageScrolls() && getComputedStyle(/** @type {Element} */ (bar)).overflowX === 'auto',
    { scrollWidth: bar?.scrollWidth, clientWidth: bar?.clientWidth, page: [doc.scrollWidth, doc.clientWidth] },
  )
  const activeTab = h.q('doc-tab', { active: '1' })
  const barRect = bar?.getBoundingClientRect()
  const activeRect = activeTab?.getBoundingClientRect()
  h.check(
    'the active tab is scrolled into view',
    !!activeRect && !!barRect && activeRect.left >= barRect.left - 1 && activeRect.right <= barRect.right + 1,
    { bar: [barRect?.left, barRect?.right], active: [activeRect?.left, activeRect?.right], scrollLeft: bar?.scrollLeft },
  )
  // Back to one document, so the rest measures the panels and not the tab strip.
  while (ctx.docs.all().length > 1) await ctx.commands.run('file.close')
  await h.waitFor(() => h.qa('doc-tab').length === 1, { timeout: 8000 })

  // ------------------------------------------------------------ the panel regions
  h.check('the left region shows the program map, the bottom region is closed', !!h.q('panel', { region: 'left', panel: 'programMap' }) && !region('bottom'), {
    panels: h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`),
  })
  h.check('the program map renders inside that panel', h.q('panel', { region: 'left' })?.contains(h.q('program-map')) === true)

  await viewCommand('view.toggleSidePanel')
  h.check('the View tab collapses the side panel', !region('left') && separators().length === 0, {
    panels: h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`),
    separators: separators().length,
  })
  h.check('the editor takes the space the panel left', !pageScrolls() && (h.q('editor-host')?.getBoundingClientRect().width ?? 0) > window.innerWidth - 40, {
    editor: h.q('editor-host')?.getBoundingClientRect().width,
    viewport: window.innerWidth,
  })
  await viewCommand('view.toggleSidePanel')
  h.check('toggling again brings it back, with its panel still active', !!h.q('panel', { region: 'left', panel: 'programMap' }) && separators().length === 1)

  await viewCommand('view.showOutput')
  h.check('Show Output opens the Output panel in the bottom region', !!h.q('panel', { region: 'bottom', panel: 'output' }) && !!h.q('output-panel'), {
    panels: h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`),
  })
  h.check('the output test ids live inside that panel', h.q('panel', { region: 'bottom' })?.contains(h.q('output-panel')) === true)
  h.check('both regions now have a splitter', separators().length === 2 && separators().map((s) => s.getAttribute('aria-orientation')).sort().join(',') === 'horizontal,vertical', separators().map((s) => s.getAttribute('aria-orientation')))
  h.check('opening the bottom panel did not make the window scroll', !pageScrolls(), [doc.scrollWidth, doc.scrollHeight])

  await viewCommand('view.toggleBottomPanel')
  h.check('the View tab collapses the bottom region again', !region('bottom') && separators().length === 1, h.qa('panel').map((e) => e.dataset.region))
  await viewCommand('view.showOutput')
  h.check('Show Output brings it back', !!h.q('panel', { region: 'bottom', panel: 'output' }))

  // ------------------------------------------------------------ the splitters
  const vertical = separators().find((s) => s.getAttribute('aria-orientation') === 'vertical')
  const horizontal = separators().find((s) => s.getAttribute('aria-orientation') === 'horizontal')
  const now = (/** @type {HTMLElement | undefined} */ s) => Number(s?.getAttribute('aria-valuenow'))
  const leftWidth = () => Math.round(h.q('panel', { region: 'left' })?.getBoundingClientRect().width ?? 0)
  const bottomHeight = () => Math.round(h.q('panel', { region: 'bottom' })?.getBoundingClientRect().height ?? 0)

  h.check('the side splitter is a focusable separator with a value and a range', now(vertical) === 260 && vertical?.getAttribute('aria-valuemin') === '160' && vertical?.getAttribute('aria-valuemax') === '640' && vertical?.tabIndex === 0, {
    now: now(vertical),
    min: vertical?.getAttribute('aria-valuemin'),
    max: vertical?.getAttribute('aria-valuemax'),
    tabIndex: vertical?.tabIndex,
  })
  // The rendered width may land a fraction of a pixel under the value the splitter
  // carries (`flex: 0 1 auto` next to a 1 px border), the same way the bottom panel's
  // height does below: measured once at 291 px for a value of 292 (mergeA §3). The
  // splitter's own value stays exact, so only the measurement gets the tolerance.
  const asWideAs = (/** @type {number} */ target) => now(vertical) === target && Math.abs(leftWidth() - target) <= 1
  h.check('the panel is as wide as the splitter says', asWideAs(now(vertical)), { width: leftWidth(), valuenow: now(vertical) })

  vertical?.focus()
  h.check('the splitter takes the focus', document.activeElement === vertical, document.activeElement?.getAttribute('role'))
  await h.nativeKeys([{ key: 'ArrowRight' }, { key: 'ArrowRight' }])
  await h.waitFor(() => asWideAs(292), { timeout: 3000 })
  h.check('two right arrows widen the side panel by two steps', asWideAs(292), { valuenow: now(vertical), width: leftWidth() })
  await h.nativeKeys([{ key: 'ArrowLeft' }])
  await h.waitFor(() => asWideAs(276), { timeout: 3000 })
  h.check('the left arrow narrows it again', asWideAs(276), { valuenow: now(vertical), width: leftWidth() })
  await h.nativeKeys([{ key: 'Home' }])
  await h.waitFor(() => asWideAs(160), { timeout: 3000 })
  h.check('Home clamps it to the minimum', asWideAs(160), { valuenow: now(vertical), width: leftWidth() })
  await h.nativeKeys([{ key: 'End' }])
  await h.waitFor(() => now(vertical) === 640, { timeout: 3000 })
  h.check('End clamps it to the maximum, and the editor is still there', now(vertical) === 640 && !pageScrolls() && (h.q('editor-host')?.getBoundingClientRect().width ?? 0) > 100, {
    valuenow: now(vertical),
    width: leftWidth(),
    editor: h.q('editor-host')?.getBoundingClientRect().width,
  })
  await h.nativeKeys([{ key: 'Home' }])
  await h.waitFor(() => now(vertical) === 160, { timeout: 3000 })

  // The bottom panel may shrink by a fraction of a pixel (`flex: 0 1 auto` under a 1 px
  // border), so its rendered height is checked to the pixel, not to the sub-pixel.
  //
  // `aria-valuenow` follows the store in the same tick, but the rendered height settles a
  // frame or two later, while Monaco's `automaticLayout` resizes the editor beside it. So
  // the wait covers the height as well; sampling it on the valuenow frame alone caught an
  // intermediate 213-215 px and failed about one run in four.
  const bottomBefore = now(horizontal)
  const heightBefore = bottomHeight()
  const settled = (/** @type {number} */ target) => now(horizontal) === target && Math.abs(bottomHeight() - (heightBefore + (target - bottomBefore))) <= 1
  horizontal?.focus()
  await h.nativeKeys([{ key: 'ArrowUp' }])
  await h.waitFor(() => settled(bottomBefore + 16), { timeout: 3000 })
  h.check(
    'the bottom splitter grows its panel upwards, the inverted way a drag does',
    settled(bottomBefore + 16),
    { before: bottomBefore, now: now(horizontal), heightBefore, height: bottomHeight() },
  )
  await h.nativeKeys([{ key: 'ArrowDown' }])
  await h.waitFor(() => settled(bottomBefore), { timeout: 3000 })
  h.check('and shrinks it again', settled(bottomBefore) && !pageScrolls(), { now: now(horizontal), height: bottomHeight(), page: [doc.scrollWidth, doc.scrollHeight] })

  h.expectExit({ within: 15000 })
  await h.nativeKeys([{ key: 'w', mods: ['cmd', 'shift'] }])
})
