// Light, dark and "follow the system" (plan §5 M2 H2 `m2-theme`, §7.3, WP2.6): the
// choice reaches the CSS variables, Monaco and the native window, it is remembered as a
// settings key, and going back to `system` takes that key out of the file again.
//
// The choice is made the way a user makes it — the View tab's Appearance button, then the
// QuickPick — because that path also proves the command is on the ribbon. The argument
// form (`view.setTheme('dark')`) is what the settings dialog and a restart use.
//
// `getCurrentWindow().setTheme()` needs `core:window:allow-set-theme`, the one capability
// M2 adds (G8). A missing permission rejects inside `app/theme.ts` and is logged as
// `Could not set the window theme`, which fails the run — so every theme change below is
// also a check of that capability.

import { scenario } from '../lib/index.js'
import { configPaths, read } from './m2-common.js'

/** The two palettes of `app.css`. WebKit prints `--bg-app` in its shortest form. */
const BACKGROUND = { dark: ['#1e1e1e'], light: ['#ffffff', '#fff'] }
const BODY = { dark: 'rgb(30, 30, 30)', light: 'rgb(255, 255, 255)' }

scenario('m2-theme', { timeout: 180 }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const paths = configPaths(ctx)

  const themeOf = () => document.documentElement.dataset.theme
  const variable = (/** @type {string} */ name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const monacoRoot = () => /** @type {HTMLElement | null} */ (document.querySelector('.monaco-editor'))
  const monacoTheme = () => {
    const classes = monacoRoot()?.classList
    return classes?.contains('vs-dark') ? 'vs-dark' : classes?.contains('vs') ? 'vs' : '(none)'
  }
  const systemTheme = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

  // ------------------------------------------------------------ the starting point
  h.check('the app starts on the system theme', ctx.settings.get('appearance.theme') === 'system', ctx.settings.get('appearance.theme'))
  h.check('`data-theme` is what the system says', themeOf() === systemTheme(), { dataTheme: themeOf(), system: systemTheme() })
  h.check('Monaco is on the matching built-in theme', monacoTheme() === (systemTheme() === 'dark' ? 'vs-dark' : 'vs'), monacoTheme())
  h.check('reading the settings did not create the file', (await h.disk.stat(paths.settingsFile)) === null, paths.settingsFile)

  // ------------------------------------------------------------ light, through the ribbon
  h.click(h.q('ribbon-tab', { tab: 'view' }))
  await h.sleep(150)
  const button = h.q('cmd-button', { command: 'view.setTheme' })
  h.check('the View tab offers the theme button', !!button, h.qa('cmd-button').map((e) => e.dataset.command))
  h.click(button)
  await h.waitFor(() => !!h.q('quick-pick'), { timeout: 5000 })
  const choices = h.qa('quick-pick-item').map((e) => e.textContent?.trim().split('\n')[0])
  h.check('the picker offers the three modes, translated', choices.length === 3 && choices[0]?.startsWith('System') && choices[1]?.startsWith('Light') && choices[2]?.startsWith('Dark'), choices)
  h.click(h.q('quick-pick-item', { index: 1 }))
  // The desktop may already be light, so `data-theme` is not what says the pick arrived:
  // the stored choice is. `applyTheme` runs from the store's subscription right after.
  await h.waitFor(() => ctx.settings.get('appearance.theme') === 'light', { timeout: 5000 })

  h.check('picking Light switches the document theme', themeOf() === 'light')
  h.check('the light palette is in force', BACKGROUND.light.includes(variable('--bg-app')) && getComputedStyle(document.body).backgroundColor === BODY.light, {
    bgApp: variable('--bg-app'),
    body: getComputedStyle(document.body).backgroundColor,
  })
  h.check('Monaco switched to vs', monacoTheme() === 'vs', monacoRoot()?.className)
  await h.waitFor(() => h.q('status-message'), { timeout: 3000 })
  h.check('the status bar names the new theme', h.q('status-message')?.textContent?.trim() === 'Theme: Light', h.q('status-message')?.textContent)

  await h.waitFor(async () => (await h.disk.stat(paths.settingsFile)) !== null, { timeout: 5000 })
  const afterLight = JSON.parse(await h.disk.read(paths.settingsFile))
  h.check('and on disk, as a settings key and nothing else', JSON.stringify(afterLight) === JSON.stringify({ $version: 1, 'appearance.theme': 'light' }), afterLight)

  // ------------------------------------------------------------ dark, with the argument
  await ctx.commands.run('view.setTheme', 'dark')
  await h.waitFor(() => ctx.settings.get('appearance.theme') === 'dark' && themeOf() === 'dark', { timeout: 5000 })
  h.check('the choice is in the store', ctx.settings.get('appearance.theme') === 'dark', ctx.settings.get('appearance.theme'))
  h.check('view.setTheme("dark") takes the argument instead of asking', themeOf() === 'dark' && !h.q('quick-pick'))
  h.check('the dark palette is in force', BACKGROUND.dark.includes(variable('--bg-app')) && getComputedStyle(document.body).backgroundColor === BODY.dark, {
    bgApp: variable('--bg-app'),
    body: getComputedStyle(document.body).backgroundColor,
  })
  h.check('Monaco switched to vs-dark', monacoTheme() === 'vs-dark', monacoRoot()?.className)
  const afterDark = JSON.parse(await h.disk.read(paths.settingsFile))
  h.check('the file holds the new choice, still with nothing else in it', JSON.stringify(afterDark) === JSON.stringify({ $version: 1, 'appearance.theme': 'dark' }), afterDark)

  // The editor keeps working in either theme: the text is untouched by a theme change.
  h.check('the document is untouched by the theme', h.app.text().startsWith('% '), h.app.text().slice(0, 20))

  // ------------------------------------------------------------ back to system
  await ctx.commands.run('view.setTheme', 'system')
  await h.waitFor(() => ctx.settings.get('appearance.theme') === 'system', { timeout: 5000 })
  // `setTheme(null)` hands the window back to the desktop, and inside a WKWebView
  // `prefers-color-scheme` follows the *window*, not the desktop: while a manual theme is
  // in force the media query answers with that theme, and it settles a moment after the
  // window is handed back. So the two are compared once they agree, not on the first tick.
  await h.waitFor(() => themeOf() === systemTheme(), { timeout: 5000 })
  h.check('system resolves to what the desktop says', themeOf() === systemTheme(), { dataTheme: themeOf(), system: systemTheme() })
  h.check('Monaco follows it too', monacoTheme() === (themeOf() === 'dark' ? 'vs-dark' : 'vs'), { monaco: monacoTheme(), dataTheme: themeOf() })
  const afterSystem = JSON.parse(await h.disk.read(paths.settingsFile))
  h.check('a value back at its default leaves the file', JSON.stringify(afterSystem) === JSON.stringify({ $version: 1 }), afterSystem)

  // ------------------------------------------------------------ a comparison rebuilds the editor
  // G8 M2: the compare overlay unmounts `EditorHost` and mounts it again, so closing a
  // comparison runs `editor.create()` a second time with the hard-coded construction
  // options. `theme: 'vs-dark'` there goes to Monaco's *global* standalone theme service,
  // so the whole app used to fall back to dark — and the settings-driven editor options
  // with it — until the user touched a setting. `EditorService` now replays the last
  // `updateOptions` payload onto every instance it builds.
  const fontFamily = () => String(ctx.editor.editorInstance()?.getRawOptions()?.fontFamily ?? '')
  const fontSize = () => Number(ctx.editor.editorInstance()?.getRawOptions()?.fontSize)

  await ctx.commands.run('view.setTheme', 'light')
  await h.waitFor(() => themeOf() === 'light' && monacoTheme() === 'vs', { timeout: 5000 })
  await ctx.settings.save({ 'appearance.editorFontSize': 22 })
  await h.waitFor(() => fontSize() === 22, { timeout: 5000 })
  const settingsFont = read(ctx.settings.values)['appearance.editorFontFamily']
  h.check('the editor is on the settings font and size, not the construction defaults', fontSize() === 22 && fontFamily() === settingsFont, { size: fontSize(), family: fontFamily(), setting: settingsFont })

  ctx.files.newUntitled()
  await h.waitFor(() => h.qa('doc-tab').length === 2, { timeout: 5000 })
  await ctx.commands.run('compare.withDocument')
  await h.waitFor(() => !!h.q('compare-view') && !h.q('editor-host'), { timeout: 15000 })
  h.check('a comparison takes the editor host away', !!h.q('compare-view') && !h.q('editor-host'))
  await ctx.commands.run('compare.close')
  await h.waitFor(() => !h.q('compare-view') && !!h.q('editor-host') && !!monacoRoot(), { timeout: 15000 })

  h.check('closing it keeps the light Monaco theme', monacoTheme() === 'vs', { monaco: monacoTheme(), className: monacoRoot()?.className })
  h.check('and the settings-driven editor options', fontSize() === 22 && fontFamily() === settingsFont, { size: fontSize(), family: fontFamily(), setting: settingsFont })
  h.check('the document theme never moved', themeOf() === 'light' && ctx.settings.get('appearance.theme') === 'light', { dataTheme: themeOf(), setting: ctx.settings.get('appearance.theme') })

  // ------------------------------------------------------------ the effective theme store
  h.check('the values store agrees with the getter', read(ctx.settings.values)['appearance.theme'] === ctx.settings.get('appearance.theme'), read(ctx.settings.values)['appearance.theme'])
  // A missing `core:window:allow-set-theme` rejects inside `setWindowTheme` and is logged
  // with this text; the run's own "no unexpected console errors" check covers the rest.
  h.check('the native window accepted every theme (core:window:allow-set-theme)', !h.rec.errors.some((e) => /window theme/i.test(e)), h.rec.errors)
})
