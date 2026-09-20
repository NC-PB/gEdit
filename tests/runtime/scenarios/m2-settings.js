// The settings (plan §5 M2 H2 `m2-settings`, §7.7, AD-8, WP2.6 and WP2.7): the dialog
// writes only what changed, a new value reaches the live editor without a reload, and a
// broken `settings.json` costs the defaults plus a notice — never the start of the app.
//
// The run starts with an unparsable file on purpose (`files` writes it into the run's
// HOME before the app starts), because that is the case AD-8 promises to survive and the
// one that produces the `.bak` rescue on the next write.
//
// `settings.open` is `modals.open`, which only settles when the dialog closes: the
// command is started with `void` and the dialog is waited for (WP2.7 §7.1).

import { scenario } from '../lib/index.js'
import { configPaths, listDir, selectChoice, setInput, tempLeftovers } from './m2-common.js'

const CONFIG = 'home/Library/Application Support/com.pburg.gedit'
const BROKEN = '{not json\n'

const field = (/** @type {any} */ h, /** @type {string} */ id) => h.q('form-field', { field: id })
const control = (/** @type {any} */ h, /** @type {string} */ id) =>
  /** @type {HTMLInputElement | HTMLSelectElement | null} */ (field(h, id)?.querySelector('input, select') ?? null)

scenario('m2-settings', { timeout: 300, files: { [`${CONFIG}/settings.json`]: BROKEN } }, async (h) => {
  const ctx = /** @type {any} */ (h.app.ctx)
  const paths = configPaths(ctx)
  const dialog = () => h.q('modal', { modal: 'settings' })
  const file = async () => JSON.parse(await h.disk.read(paths.settingsFile))
  const openDialog = async (/** @type {boolean} */ viaKey) => {
    if (viaKey) await h.nativeKeys([{ key: ',', mods: ['cmd'] }])
    else void ctx.commands.run('settings.open')
    if (!(await h.waitFor(() => !!dialog(), { timeout: 5000 }))) throw new Error('the settings dialog did not open')
  }
  /**
   * Edits the open `settings.json` document and saves it.
   *
   * Two things are deliberate. The reload first: the dialog wrote the file a moment ago,
   * so the buffer is behind the disk, and the external-change poll would replace what is
   * typed here while the document is still clean. And `editor.replaceAll` rather than
   * `model.setValue`: AD-5 reserves `setValue` for a model that is being created, and
   * every rewrite in the app goes through the one-undo-step path — a scenario that takes
   * the shortcut tests something the app never does.
   * @param {string} text
   */
  const writeSettingsDocument = async (/** @type {string} */ text) => {
    const id = ctx.docs.byPath(paths.settingsFile).id
    await ctx.files.reloadFromDisk(id)
    ctx.editor.replaceAll(id, text)
    await h.waitFor(() => !!h.q('doc-tab', { docId: id, dirty: '1' }), { timeout: 5000 })
    if ((await ctx.files.save(id)) !== true) throw new Error('saving settings.json as a document failed')
  }
  const goTo = async (/** @type {string} */ category) => {
    h.click(h.q('settings-category', { category }))
    await h.waitFor(() => !!h.q('settings-page', { category }), { timeout: 3000 })
  }

  // ------------------------------------------------------------ a file that cannot be read
  h.check('an unparsable settings.json does not stop the app', h.q('app-shell')?.dataset.ready === '1')
  const report = ctx.settings.report()
  h.check('the failure is reported', typeof report.error === 'string' && report.error.length > 0, report)
  h.check('every value is the default', ctx.settings.get('editor.tabWidth') === 4 && ctx.settings.get('appearance.editorFontSize') === 14, {
    tabWidth: ctx.settings.get('editor.tabWidth'),
    fontSize: ctx.settings.get('appearance.editorFontSize'),
  })
  h.check('the status bar carries the notice', h.q('status-message')?.dataset.error === '1', h.q('status-message')?.textContent)
  h.check('the bad file is still there, and no .bak yet', (await h.disk.read(paths.settingsFile)) === BROKEN && (await h.disk.stat(`${paths.settingsFile}.bak`)) === null)
  h.check('the config folder and the user scripts folder were created', !!(await h.disk.stat(paths.configDir))?.isDir && !!(await h.disk.stat(paths.userScriptsDir))?.isDir, paths)

  // ------------------------------------------------------------ Mod+, opens the dialog
  await openDialog(true)
  h.check('Mod+, opens the settings dialog (§7.11)', !!dialog())
  h.check('it is the one `modal` on screen', h.qa('modal').length === 1 && h.q('modal')?.dataset.modal === 'settings', h.qa('modal').map((e) => e.dataset.modal))
  const categories = h.qa('settings-category').map((e) => e.dataset.category)
  h.check('the five pages of §7.7 are there, in order', JSON.stringify(categories) === JSON.stringify(['appearance', 'editor', 'assistance', 'files', 'scripts']), categories)
  h.check('Appearance is open first', h.q('settings-page')?.dataset.category === 'appearance')
  h.check('its fields are drawn with labels, not with i18n keys', !!field(h, 'appearance.theme') && !!field(h, 'appearance.editorFontSize') && !/settings\.appearance/.test(dialog()?.textContent ?? ''), dialog()?.textContent?.slice(0, 120))
  h.check('another page’s fields are not drawn', !field(h, 'editor.tabWidth'))
  h.check('the dialog says the file could not be read', !!h.q('settings-notice'), h.q('settings-notice')?.textContent)
  h.check('the file-only keys of §7.7 are nowhere in the dialog', !field(h, 'editor.rulers'))

  // ------------------------------------------------------------ a value that does not fit
  await goTo('editor')
  setInput(control(h, 'editor.tabWidth'), '99')
  await h.waitFor(() => !!field(h, 'editor.tabWidth')?.dataset.error, { timeout: 3000 })
  h.check('a value outside the range is reported, never corrected (§7.5)', field(h, 'editor.tabWidth')?.dataset.error === 'forms.errors.range' && control(h, 'editor.tabWidth')?.value === '99', {
    error: field(h, 'editor.tabWidth')?.dataset.error,
    value: control(h, 'editor.tabWidth')?.value,
  })
  h.check('Save is disabled while a field is wrong', /** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled === true)
  h.check('and the page that holds it is marked', h.q('settings-category', { category: 'editor' })?.dataset.invalid === '1')
  setInput(control(h, 'editor.tabWidth'), '2')
  await h.waitFor(() => !field(h, 'editor.tabWidth')?.dataset.error, { timeout: 3000 })
  h.check('Save comes back once the value fits', /** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled === false && h.q('settings-category', { category: 'editor' })?.dataset.invalid === '0')

  // ------------------------------------------------------------ Save writes only the changes
  await goTo('appearance')
  setInput(control(h, 'appearance.editorFontSize'), '20')
  const dialogCalls = h.dialogs.calls().length
  const docId = ctx.docs.getActiveId()
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !dialog(), { timeout: 5000 })
  await h.waitFor(() => ctx.settings.get('editor.tabWidth') === 2, { timeout: 5000 })
  h.check('saving closes the dialog and the new values are effective', !dialog() && ctx.settings.get('editor.tabWidth') === 2 && ctx.settings.get('appearance.editorFontSize') === 20)
  await h.waitFor(() => ctx.editor.model(docId)?.getOptions().tabSize === 2, { timeout: 5000 })
  h.check('the tab width reaches an open model with no reload', ctx.editor.model(docId)?.getOptions().tabSize === 2)
  h.check('the font size reaches the live editor', ctx.editor.editorInstance()?.getRawOptions().fontSize === 20, ctx.editor.editorInstance()?.getRawOptions().fontSize)
  h.check('settings.json holds $version and exactly the two changed keys, sorted', JSON.stringify(await file()) === JSON.stringify({ $version: 1, 'appearance.editorFontSize': 20, 'editor.tabWidth': 2 }), await file())
  h.check('no file dialog was needed', h.dialogs.calls().length === dialogCalls, h.dialogs.calls().slice(dialogCalls))
  h.check('the unreadable file was rescued as settings.json.bak', (await h.disk.read(`${paths.settingsFile}.bak`)) === BROKEN, await h.disk.stat(`${paths.settingsFile}.bak`))

  // ------------------------------------------------------------ Esc throws the edit away
  await openDialog(false)
  await goTo('editor')
  setInput(control(h, 'editor.tabWidth'), '8')
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !dialog(), { timeout: 5000 })
  h.check('Esc closes the dialog and discards what was typed', !dialog() && ctx.settings.get('editor.tabWidth') === 2, ctx.settings.get('editor.tabWidth'))

  // ------------------------------------------------------------ Reset category
  await openDialog(false)
  await goTo('editor')
  h.check('the footer offers Reset category and Open settings file', !!h.q('settings-reset') && !!h.q('settings-open-file'))
  h.click(h.q('settings-reset'))
  const alert = await h.alert.wait({ timeout: 5000 })
  h.check('Reset asks first, and names the page', !!alert && /Editor/.test((alert?.texts ?? []).join(' ')), alert)
  await h.alert.click('Reset')
  await h.waitFor(() => ctx.settings.get('editor.tabWidth') === 4, { timeout: 5000 })
  h.check('the category goes back to its defaults', ctx.settings.get('editor.tabWidth') === 4 && control(h, 'editor.tabWidth')?.value === '4', control(h, 'editor.tabWidth')?.value)
  h.check('it is written straight away, and the other pages are untouched', JSON.stringify(await file()) === JSON.stringify({ $version: 1, 'appearance.editorFontSize': 20 }), await file())

  // ------------------------------------------------------------ the scripts folder list
  await goTo('scripts')
  h.check('the user scripts folder is shown', h.q('settings-scripts-folder')?.textContent?.trim() === paths.userScriptsDir, { shown: h.q('settings-scripts-folder')?.textContent?.trim(), want: paths.userScriptsDir })
  h.check('the extra folders start empty and are a list, not a text field', h.qa('settings-list-item').length === 0 && !field(h, 'scripts.folders')?.querySelector('input'))
  await h.dialogs.queue('folder', h.cfg.run)
  h.click(h.q('settings-list-add'))
  await h.waitFor(() => h.qa('settings-list-item').length === 1, { timeout: 5000 })
  h.check('a picked folder joins the list and is never reported as invalid', h.qa('settings-list-item')[0]?.textContent?.includes(h.cfg.run) && !field(h, 'scripts.folders')?.dataset.error && /** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled === false, h.qa('settings-list-item')[0]?.textContent)
  h.click(h.q('modal-ok'))
  await h.waitFor(async () => (await file())['scripts.folders'] !== undefined, { timeout: 5000 })
  h.check('the list is written as a JSON array', JSON.stringify((await file())['scripts.folders']) === JSON.stringify([h.cfg.run]), await file())

  await openDialog(false)
  await goTo('scripts')
  h.click(h.q('settings-list-remove'))
  await h.waitFor(() => h.qa('settings-list-item').length === 0, { timeout: 3000 })
  h.click(h.q('modal-ok'))
  await h.waitFor(async () => (await file())['scripts.folders'] === undefined, { timeout: 5000 })
  h.check('removing the last entry takes the key back out of the file', (await file())['scripts.folders'] === undefined, await file())

  // ------------------------------------------------------------ Open settings file
  await openDialog(false)
  const before = h.dialogs.calls().length
  h.click(h.q('settings-open-file'))
  await h.waitFor(() => !!h.q('doc-tab', { path: paths.settingsFile }), { timeout: 10000 })
  h.check('the settings file opens as a document, with no file dialog', !!h.q('doc-tab', { path: paths.settingsFile }) && h.dialogs.calls().length === before && !dialog(), h.dialogs.calls().slice(before))

  // Saving it re-reads the settings (`files.onDidSave` → `settings.reloadFromDisk`).
  await writeSettingsDocument('{"$version":1,"editor.tabWidth":7}\n')
  await h.waitFor(() => ctx.settings.get('editor.tabWidth') === 7, { timeout: 5000 })
  h.check('saving settings.json as a document re-reads it', ctx.settings.get('editor.tabWidth') === 7)
  const liveId = ctx.docs.getActiveId()
  await h.waitFor(() => ctx.editor.model(liveId)?.getOptions().tabSize === 7, { timeout: 5000 })
  h.check('and every open model follows', ctx.editor.model(liveId)?.getOptions().tabSize === 7, { liveId, tabSize: ctx.editor.model(liveId)?.getOptions().tabSize })

  // ------------------------------------------------------------ a value of the wrong type
  await writeSettingsDocument('{"$version":1,"editor.tabWidth":"two","future.option":1}\n')
  await h.waitFor(() => ctx.settings.report().warnings.length > 0, { timeout: 5000 })
  h.check('an unusable value falls back to the default, with a warning', ctx.settings.get('editor.tabWidth') === 4 && ctx.settings.report().warnings.length === 1 && ctx.settings.report().error === undefined, ctx.settings.report())
  await openDialog(false)
  h.check('the dialog shows that notice too', !!h.q('settings-notice'), h.q('settings-notice')?.textContent)
  await goTo('assistance')
  selectChoice(h, control(h, 'assist.completion'), 'Off')
  h.click(h.q('modal-ok'))
  await h.waitFor(() => ctx.settings.get('assist.completion') === 'off', { timeout: 5000 })
  h.check('a key this build does not know survives the next write (AD-8)', (await file())['future.option'] === 1 && (await file())['assist.completion'] === 'off', await file())

  // ------------------------------------------------------------ a file from a newer build
  await writeSettingsDocument('{"$version":99,"editor.tabWidth":6}\n')
  await h.waitFor(() => ctx.settings.get('editor.tabWidth') === 6, { timeout: 5000 })
  h.check('a newer $version is read', ctx.settings.get('editor.tabWidth') === 6 && ctx.settings.isReadOnly() === true, { tabWidth: ctx.settings.get('editor.tabWidth'), readOnly: ctx.settings.isReadOnly() })
  await openDialog(false)
  h.check('the dialog says it cannot write it, and offers neither Save nor Reset', !!h.q('settings-readonly') && /** @type {HTMLButtonElement} */ (h.q('modal-ok')).disabled === true && /** @type {HTMLButtonElement} */ (h.q('settings-reset')).disabled === true, h.q('settings-readonly')?.textContent)
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !dialog(), { timeout: 5000 })
  const refused = await ctx.settings.save({ 'editor.tabWidth': 3 }).then(() => null, (/** @type {Error} */ e) => e.message)
  h.check('and a save is refused rather than overwriting it', typeof refused === 'string' && /newer/.test(refused), refused)
  h.check('the file is exactly as the newer build left it', (await h.disk.read(paths.settingsFile)) === '{"$version":99,"editor.tabWidth":6}\n', await h.disk.read(paths.settingsFile))

  // ------------------------------------------------------------ crash safety (AD-8)
  const names = await listDir(h, paths.configDir)
  h.check('no atomic write left a temp file behind in the config folder', tempLeftovers(names).length === 0, names)
  const dataNames = paths.dataDir === paths.configDir ? names : await listDir(h, paths.dataDir)
  h.check('nor in the data folder', tempLeftovers(dataNames).length === 0, dataNames)
})
