// B1 A9: the ribbon in the real window.
//
//   b1-ribbon-tabs   The seven tabs File, Edit, Insert, NC, Tools, Scripts, View, the group labels and the buttons the
//                    owner's layout puts on them (Reload on File, Go To on Edit, Built-in Scripts on Tools, Run and
//                    My Scripts on Scripts), and the window title row that is gone.
//   b1-ribbon-narrow At a narrow width the ribbon scrolls, and the scrollbar takes its own room below the group
//                    labels instead of lying over them (macOS overlay scrollbars hid the labels). Measured on every
//                    tab: the bottom of the lowest label against the top of the scrollbar.
//
// The harness window is 1100 px wide and a scenario cannot resize it, so "narrow" is the ribbon given a width of
// 480 px: it is the ribbon's own box that overflows, whatever the window around it is.

import { scenario } from '../lib/index.js'
import { ribbonGroups } from './p3b-common.js'
import { TABS, context, ready, ribbonTab } from './b1-common.js'

scenario('b1-ribbon-tabs', { timeout: 180 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const tabs = h.qa('ribbon-tab').map((e) => e.dataset.tab)
  h.check('the ribbon has the seven tabs, in this order, and no Home tab', JSON.stringify(tabs) === JSON.stringify(TABS), tabs)
  h.check('the tab buttons read File, Edit, Insert, NC, Tools, Scripts, View', JSON.stringify(h.qa('ribbon-tab').map((e) => e.textContent?.trim().toLowerCase())) === JSON.stringify(['file', 'edit', 'insert', 'nc', 'tools', 'scripts', 'view']), h.qa('ribbon-tab').map((e) => e.textContent))
  h.check('the ribbon starts on File', h.q('ribbon-tab', { tab: 'file', 'aria-selected': 'true' }) !== null)
  h.check('there is no "gEdit" title row inside the window: the tab strip is the first thing in it', !h.q('app-title') && !h.q('app-header') && h.q('app-shell')?.firstElementChild !== null, h.q('app-shell')?.firstElementChild?.className)

  /** @param {string} tab */
  const groupsOn = async (tab) => {
    await ribbonTab(h, tab)
    return ribbonGroups(h).map((g) => ({ label: g.label, commands: g.commands }))
  }
  const labels = (/** @type {{ label: string }[]} */ groups) => groups.map((g) => g.label)

  const file = await groupsOn('file')
  h.check('File: the group "File" holds New, Open, Save, Save As, Save All, Close and Reload; Recent follows', file[0]?.label === ctx.t('files.groupFile') && ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.saveAll', 'file.close', 'file.reload'].every((c) => file[0].commands.includes(c)) && labels(file).includes(ctx.t('recent.groupRecent')), file)

  const edit = await groupsOn('edit')
  const goTo = edit.find((g) => g.label === ctx.t('navigation.groupGoto'))
  h.check('Edit: the edit commands, Search, a group "Go To" with Go to Line, and Typing', ['edit.undo', 'edit.redo', 'edit.find', 'edit.toggleComment'].every((c) => edit.some((g) => g.commands.includes(c))) && goTo?.commands.join() === 'nav.goto' && labels(edit).includes(ctx.t('search.group')) && labels(edit).includes(ctx.t('typing.group')), edit)

  const insert = await groupsOn('insert')
  h.check('Insert: Templates, Cycles and Manage, and Program start is in Templates', labels(insert).includes(ctx.t('templates.groupTemplates')) && insert.some((g) => g.commands.includes('insert.template:program-start')), insert.map((g) => g.label))

  const tools = await groupsOn('tools')
  const bundled = tools.find((g) => g.label === ctx.t('scripts.groupBundled'))
  h.check('Tools: Compare and a group "Built-in Scripts" that offers the built-in scripts', !!bundled && h.qa('script-item').length > 0 && h.qa('script-item').every((e) => (e.dataset.scriptId ?? '').startsWith('bundled:')) && labels(tools).includes(ctx.t('compare.group')), { groups: labels(tools), items: h.qa('script-item').map((e) => e.dataset.scriptId) })
  h.check('and none of the Scripts tab’s groups is on Tools', !labels(tools).includes(ctx.t('scripts.groupScripts')) && !labels(tools).includes(ctx.t('scripts.groupOwn')), labels(tools))

  const scripts = await groupsOn('scripts')
  const run = scripts.find((g) => g.label === ctx.t('scripts.groupScripts'))
  h.check('Scripts: "Run" holds Run Script and Stop, "My Scripts" follows, and the managing commands are there', ctx.t('scripts.groupScripts') === 'Run' && run?.commands.join() === 'script.runPicker,script.cancel' && labels(scripts).includes(ctx.t('scripts.groupOwn')) && ['script.new', 'script.rescan', 'script.addFolder'].every((c) => scripts.some((g) => g.commands.includes(c))), scripts)
  h.check('a built-in script is not on the Scripts tab', h.qa('script-item').every((e) => !(e.dataset.scriptId ?? '').startsWith('bundled:')), h.qa('script-item').map((e) => e.dataset.scriptId))

  const view = await groupsOn('view')
  h.check('View: panels, Code Inspector, Motion Colors, theme, settings and help', ['view.toggleSidePanel', 'view.toggleInspector', 'view.toggleBottomPanel', 'view.toggleMotionColors'].every((c) => view.some((g) => g.commands.includes(c))), labels(view))

  // The command is real: Reload on a program that was never saved says so, and asks nothing.
  await ribbonTab(h, 'file')
  const reload = h.q('cmd-button', { command: 'file.reload' })
  h.click(reload)
  await h.idle()
  h.check('Reload on an unsaved new program says there is nothing to reload', h.q('status-message')?.textContent?.includes('nothing to reload') === true && (await h.alert.visible()) === null, h.q('status-message')?.textContent)
})

scenario('b1-ribbon-narrow', { timeout: 180 }, async (h) => {
  await ready(h)
  const ribbon = /** @type {HTMLElement} */ (h.q('ribbon'))
  const body = /** @type {HTMLElement} */ (ribbon.querySelector('.ribbon-body'))
  h.check('the ribbon body is the scrolling box', getComputedStyle(body).overflowX === 'auto', getComputedStyle(body).overflowX)
  ribbon.style.width = '480px'
  ribbon.style.maxWidth = '480px'
  await h.frame()
  /** @type {Record<string, unknown>} */
  const perTab = {}
  let scrolling = 0
  let covered = 0
  try {
    for (const tab of TABS) {
      await ribbonTab(h, tab)
      await h.frame()
      const rect = body.getBoundingClientRect()
      const bar = body.offsetHeight - body.clientHeight
      const barTop = rect.bottom - bar
      const labelBottom = Math.max(0, ...[...body.querySelectorAll('.group-label')].map((e) => e.getBoundingClientRect().bottom))
      const scrolls = body.scrollWidth > body.clientWidth
      const gap = Math.round(barTop - labelBottom)
      perTab[tab] = { scrolls, bar, labelBottom: Math.round(labelBottom), barTop: Math.round(barTop), gap }
      if (scrolls) {
        scrolling++
        if (bar <= 0 || labelBottom > barTop + 0.5) covered++
      }
    }
  } finally {
    ribbon.style.width = ''
    ribbon.style.maxWidth = ''
  }
  h.check('at 480 px most tabs scroll sideways', scrolling >= 5, perTab)
  h.check('on every tab that scrolls the scrollbar takes its own room (not an overlay) and starts below the lowest group label', covered === 0, perTab)
})
