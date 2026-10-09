// M13 user profiles and code files through the Profiles page (plan §6 M13 WP13.3, AD-29, §7.12, X9):
// Settings > Profiles ("Manage Profiles…") lists the built-in profiles and the user's own files with
// their problems; "New profile from…" and "New code file from…" make a file that extends one you pick and
// open it; a save of a file in either folder reloads, so an edit takes effect at once; a broken file is a
// row with its JSON path and the built-ins keep working; "Test on document" shows what every rule of a
// profile finds in the open program; Import and Export copy a file in and out through the native
// dialogs; Remove asks first; Reload does nothing when nothing changed.
//
// The X9 criterion itself (the fixed files, the goldens, step 5, the M13 hover, a machine of the
// profile) is `exit2-x9`; this scenario is the page and the commands behind it.

import { scenario } from '../lib/index.js'
import { hoverAt, openPath, revealLine } from './m3-common.js'
import { setField } from './m4-common.js'
import { message } from './m6-common.js'
import { read } from './m5-common.js'
import {
  closeProfilesPage,
  context,
  deleteUserFile,
  hoverMissing,
  openProfilesPage,
  profileAction,
  profileRows,
  ready,
  reloadProfiles,
  userDirs,
} from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

const CODE_TEXT = (/** @type {string} */ id) => `${JSON.stringify({ dialect: id, version: 1, extends: 'fanuc-lathe', codes: [{ code: 'M13', label: 'Chip conveyor on', description: 'Starts the chip conveyor of this shop.' }] }, null, 2)}\n`

/** Waits until the Profiles page lists a row. @param {Harness} h @param {(r: ReturnType<typeof profileRows>[number]) => boolean} pred */
async function rowWhere(h, pred) {
  await h.waitFor(() => profileRows(h).some(pred), { timeout: 8000 })
  return profileRows(h).find(pred)
}

scenario('m13-user-profile', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const { profilesDir, codesDir } = userDirs(h)
  const shop = `${h.cfg.run}/shop`
  /** A document id's text. @param {string} id */
  const textOf = (id) => ctx.editor.getText(id)

  // ============================================================ A. the empty page
  h.check('both folders exist from the first start, and hold nothing', !!(await h.disk.stat(profilesDir))?.isDir && !!(await h.disk.stat(codesDir))?.isDir)
  let page = await openProfilesPage(h)
  h.check('Settings has a Profiles tab, after Machines', h.qa('settings-category').map((e) => e.dataset.category).slice(-2).join() === 'machines,profiles' && h.q('settings-page')?.dataset.category === 'profiles', h.qa('settings-category').map((e) => e.dataset.category))
  let rows = profileRows(h)
  h.check('the page lists the six built-in profiles and nothing of yours', rows.length === 6 && rows.every((r) => r.origin === 'builtin' && r.kind === 'profile' && r.file === ''), rows.map((r) => `${r.id}:${r.origin}`))
  h.check('each built-in row offers "New profile from this…" and "Test on document", and no Open, Export or Remove', rows.every((r) => !!profileAction(h, 'new', { row: r.element }) && !!profileAction(h, 'test', { row: r.element }) && !profileAction(h, 'open', { row: r.element }) && !profileAction(h, 'remove', { row: r.element })))
  h.check('the page offers Reload, New and Import for both kinds', !!profileAction(h, 'reload') && ['profiles', 'codes'].every((k) => !!profileAction(h, 'new', { kind: k }) && !!profileAction(h, 'import', { kind: k })))

  // ============================================================ B. a code file from a built-in set
  h.click(profileAction(h, 'new', { kind: 'codes' }))
  await h.waitFor(() => h.q('profile-form', { kind: 'codes' }), { timeout: 5000 })
  setField(h, 'parent', 'fanuc-lathe')
  setField(h, 'name', 'shop-codes')
  await h.frame()
  h.check('the form starts from a set you pick and a name you give it', !!profileAction(h, 'create') && profileAction(h, 'create')?.dataset.disabled === '0')
  h.click(profileAction(h, 'create'))
  await h.waitFor(() => !h.q('profile-form'), { timeout: 8000 })
  const codeRow = await rowWhere(h, (r) => r.kind === 'codes' && r.file === 'shop-codes.json')
  h.check('"shop-codes.json" was created, is listed under your code files and has no problem', codeRow?.origin === 'user' && codeRow.problems === 0, codeRow)
  const codeText = JSON.parse(await h.disk.read(`${codesDir}/shop-codes.json`))
  h.check('it is a database of its own that starts from fanuc-lathe', codeText.dialect === 'shop-codes' && codeText.extends === 'fanuc-lathe' && Array.isArray(codeText.codes), codeText)
  const codeDoc = ctx.docs.byPath(`${codesDir}/shop-codes.json`)?.id
  h.check('and it was opened as a document, so it can be edited', codeDoc !== undefined, ctx.docs.all().map((d) => d.title))

  // ============================================================ C. a profile from a built-in profile
  const latheRow = profileRows(h).find((r) => r.id === 'fanuc-lathe' && r.origin === 'builtin')
  if (!latheRow) throw new Error('no fanuc-lathe row')
  h.click(profileAction(h, 'new', { row: latheRow.element }))
  await h.waitFor(() => h.q('profile-form', { kind: 'profiles' }), { timeout: 5000 })
  h.check('"New profile from this…" on the lathe row starts the form from it, with a name proposed', /** @type {HTMLSelectElement | null} */ (h.q('form-field', { field: 'parent' })?.querySelector('select'))?.selectedOptions[0]?.textContent?.includes('fanuc-lathe') === true && /** @type {HTMLInputElement | null} */ (h.q('form-field', { field: 'name' })?.querySelector('input'))?.value === 'my-fanuc-lathe', {
    name: /** @type {HTMLInputElement | null} */ (h.q('form-field', { field: 'name' })?.querySelector('input'))?.value,
  })
  setField(h, 'name', 'Fanuc Lathe')
  await h.frame()
  h.check('a name that is already a profile cannot be used', profileAction(h, 'create')?.dataset.disabled === '1', h.q('profile-form')?.textContent?.slice(0, 200))
  setField(h, 'name', 'shop-lathe')
  await h.frame()
  h.click(profileAction(h, 'create'))
  await h.waitFor(() => !h.q('profile-form'), { timeout: 8000 })
  const shopRow = await rowWhere(h, (r) => r.id === 'shop-lathe' && r.kind === 'profile')
  h.check('"shop-lathe.json" is listed under your profiles, it starts from fanuc-lathe, and it has no problem', shopRow?.origin === 'user' && shopRow.file === 'shop-lathe.json' && shopRow.problems === 0 && /fanuc-lathe/.test(shopRow.text), shopRow)
  const created = JSON.parse(await h.disk.read(`${profilesDir}/shop-lathe.json`))
  h.check('the new file says who it is and what it starts from, and finds nothing by content so it never outscores its parent', created.id === 'shop-lathe' && created.extends === 'fanuc-lathe' && Array.isArray(created.detect?.content) && created.detect.content.length === 0, created)
  const profileDoc = ctx.docs.byPath(`${profilesDir}/shop-lathe.json`)?.id
  h.check('and it is open for editing', profileDoc !== undefined)
  h.check('the status bar says it was created and that a save puts it to use', /shop-lathe\.json was created/.test(message(h)), message(h))
  await closeProfilesPage(h, page)

  // ============================================================ D. an edit takes effect when saved
  if (profileDoc === undefined || codeDoc === undefined) throw new Error('the created files are not open')
  await h.disk.write(`${shop}/part.nc`, 'O1\nG21 G40 G99\nT0101 (ROUGH)\nM13\nG96 S200 M03\nG00 X30. Z2.\nM30\n')
  ctx.editor.replaceAll(codeDoc, CODE_TEXT('shop-codes'))
  await h.waitFor(() => ctx.docs.get(codeDoc)?.dirty === true, { timeout: 5000 })
  if ((await ctx.files.save(codeDoc)) !== true) throw new Error('saving shop-codes.json failed')
  await h.idle()
  const profileText = { id: 'shop-lathe', name: 'Shop lathe', shortName: 'SHOP', version: 1, extends: 'fanuc-lathe', codes: 'shop-codes', detect: { folders: [shop], content: [] }, numbering: { step: 7 } }
  ctx.editor.replaceAll(profileDoc, `${JSON.stringify(profileText, null, 2)}\n`)
  if ((await ctx.files.save(profileDoc)) !== true) throw new Error('saving shop-lathe.json failed')
  await h.idle()
  h.check('saving the file reloaded the profile: it has the name and the numbering it was given', ctx.profiles.profile('shop-lathe').name === 'Shop lathe' && ctx.profiles.profile('shop-lathe').numbering?.step === 7, ctx.profiles.profile('shop-lathe').numbering)
  const part = await openPath(h, `${shop}/part.nc`)
  h.check('a program in the folder opens with the new profile', ctx.docs.get(part.id)?.profileId === 'shop-lathe', ctx.docs.get(part.id)?.profileId)
  const hover = await hoverAt(h, part.id, 4, 2)
  h.check('and hover on M13 shows the text of the code file, saved in the other folder', hoverMissing(hover, '**M13** — Chip conveyor on\n\nStarts the chip conveyor of this shop\\.').length === 0, hover.slice(0, 200))

  // ============================================================ E. Test on document
  page = await openProfilesPage(h)
  const tested = await rowWhere(h, (r) => r.id === 'shop-lathe')
  h.click(profileAction(h, 'test', { row: tested?.element }))
  await h.waitFor(() => /** @type {any} */ (read(ctx.results.current))?.title?.includes('Shop lathe'), { timeout: 8000 })
  await closeProfilesPage(h, page)
  let report = /** @type {any} */ (read(ctx.results.current))
  h.check('"Test on document" fills the Results panel: the profile on the document', /Shop lathe on part\.nc/.test(report?.title ?? ''), report?.title)
  h.check('with the columns Line, What, Rule, Found and Time', JSON.stringify(report?.columns?.map((/** @type {any} */ c) => c.label)) === JSON.stringify(['Line', 'What', 'Rule', 'Found', 'Time']), report?.columns)
  const whats = new Set((report?.rows ?? []).map((/** @type {any} */ r) => r.what))
  h.check('it shows the tool change, the program start and end, the program map, and the setting it chose', ['Tool change', 'Program start', 'Program end', 'Program map'].every((w) => whats.has(w)) && [...whats].some((w) => /Setting/.test(String(w))), [...whats])
  h.check('and the detection by folder: gEdit would open this text as the profile', /Shop lathe/.test(String(report?.message)) && /would open this text as/.test(String(report?.message)), report?.message)
  const lineRows = h.qa('results-row').filter((e) => (e.dataset.line ?? '') !== '')
  h.check('every finding of a line carries its line; the setting chosen for the whole program has none', lineRows.length > 0 && lineRows.length < (report?.rows ?? []).length && (report?.rows ?? []).filter((/** @type {any} */ r) => r.line === null).length >= 1, { lines: lineRows.length, all: (report?.rows ?? []).length })
  const toolRow = h.qa('results-row').find((e) => /Tool change/.test(e.textContent ?? ''))
  await revealLine(h, part.id, 1, 1)
  if (toolRow) h.click(toolRow)
  await h.waitFor(() => h.app.cursor().line === 3, { timeout: 4000 })
  h.check('a click on a finding goes to its line (the T0101 on line 3)', h.app.cursor().line === 3, h.app.cursor())
  h.check('a test changes nothing: the program is not dirty', ctx.docs.get(part.id)?.dirty !== true)
  await ctx.commands.run('profile.testOnDocument')
  await h.idle()
  report = /** @type {any} */ (read(ctx.results.current))
  h.check('the command with no argument tests the document’s own profile', /Shop lathe on part\.nc/.test(report?.title ?? ''), report?.title)

  // ============================================================ F. a broken file
  const goodText = textOf(profileDoc)
  ctx.editor.replaceAll(profileDoc, goodText.replace('"step": 7', '"step": "seven"'))
  if ((await ctx.files.save(profileDoc)) !== true) throw new Error('saving the broken profile failed')
  await h.idle()
  page = await openProfilesPage(h)
  const broken = profileRows(h).find((r) => r.file === 'shop-lathe.json')
  h.check('the broken file is a row of its own with its problem, naming the JSON path', broken?.problems === 1 && broken.problemTexts.some((t) => t.includes('numbering.step')), broken)
  h.check('its Test button is disabled: a profile that did not load cannot be tested', profileAction(h, 'test', { row: broken?.element })?.dataset.disabled === '1')
  await closeProfilesPage(h, page)
  report = /** @type {any} */ (read(ctx.results.current))
  h.check('the problem is also in the Results panel, with the file and the path', /problem/i.test(String(report?.message)) && (report?.rows ?? []).some((/** @type {any} */ r) => r.file === 'shop-lathe.json' && /numbering\.step/.test(r.at)), report)
  h.check('the broken profile is not loaded, the built-ins are', ctx.profiles.get('shop-lathe') === undefined && ctx.profiles.get('fanuc-lathe') !== undefined, ctx.profiles.list().map((p) => p.id))
  h.check('the document that used it is read as the dialect gEdit detects, not left without one', ctx.docs.get(part.id)?.profileId === 'fanuc-lathe', ctx.docs.get(part.id)?.profileId)
  // A file that is not JSON at all, written from outside and picked up by Reload.
  await h.disk.write(`${profilesDir}/not-json.json`, '{ this is not json')
  await reloadProfiles(h)
  page = await openProfilesPage(h)
  const notJson = profileRows(h).find((r) => r.file === 'not-json.json')
  h.check('a file that is not JSON is a row with a problem, and nothing else is lost', (notJson?.problems ?? 0) >= 1 && profileRows(h).some((r) => r.file === 'shop-lathe.json'), notJson)
  await closeProfilesPage(h, page)
  ctx.editor.replaceAll(profileDoc, goodText)
  if ((await ctx.files.save(profileDoc)) !== true) throw new Error('saving the fixed profile failed')
  await h.idle()
  // CODE-6 (M13 review fixes): a document moved off a profile that failed after a bad save goes back to
  // it when the profile loads again, as the user's own profile (it was not chosen by hand in between).
  h.check('fixed and saved, the profile is loaded again and the document is back on it', ctx.profiles.get('shop-lathe') !== undefined && ctx.docs.get(part.id)?.profileId === 'shop-lathe', ctx.docs.get(part.id)?.profileId)

  // ============================================================ G. Reload does nothing when nothing changed
  const revision = read(ctx.profiles.revision)
  await reloadProfiles(h)
  h.check('Reload with the same files changes nothing: the registry is not rebuilt', read(ctx.profiles.revision) === revision && /reloaded/i.test(message(h)), { before: revision, after: read(ctx.profiles.revision), status: message(h) })
  await h.disk.write(`${profilesDir}/second.json`, `${JSON.stringify({ id: 'second', name: 'Second', shortName: 'SEC', version: 1, extends: 'fanuc-gcode', detect: { content: [] } }, null, 2)}\n`)
  await reloadProfiles(h)
  h.check('a file added from outside is picked up by Reload', ctx.profiles.get('second') !== undefined && read(ctx.profiles.revision) !== revision, null)

  // ============================================================ H. Export, Import and Remove
  page = await openProfilesPage(h)
  const second = profileRows(h).find((r) => r.id === 'second')
  const target = `${h.cfg.run}/exported-second.json`
  await h.dialogs.queue('save', target)
  h.click(profileAction(h, 'export', { row: second?.element }))
  await h.waitFor(async () => (await h.disk.stat(target)) !== null, { timeout: 8000 })
  h.check('Export saves the file where the dialog says, byte for byte', (await h.disk.read(target)) === (await h.disk.read(`${profilesDir}/second.json`)), null)
  const source = `${h.cfg.run}/Imported-Shop.json`
  await h.disk.write(source, `${JSON.stringify({ id: 'imported-shop', name: 'Imported shop', shortName: 'IMP', version: 1, extends: 'fanuc-gcode', detect: { content: [] } }, null, 2)}\n`)
  await h.dialogs.queue('open', source)
  h.click(profileAction(h, 'import', { kind: 'profiles' }))
  await rowWhere(h, (r) => r.file === 'imported-shop.json')
  h.check('Import copies the file into the folder under a lower-case name and loads it', (await h.disk.stat(`${profilesDir}/imported-shop.json`)) !== null && ctx.profiles.get('imported-shop') !== undefined, profileRows(h).map((r) => r.file))
  const toRemove = profileRows(h).find((r) => r.file === 'second.json')
  h.click(profileAction(h, 'remove', { row: toRemove?.element }))
  const ask = await h.alert.wait({ timeout: 8000 })
  h.check('Remove asks first, naming the file', !!ask && (ask.texts ?? []).join(' ').includes('second.json'), ask)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel keeps it', (await h.disk.stat(`${profilesDir}/second.json`)) !== null && profileRows(h).some((r) => r.file === 'second.json'))
  h.click(profileAction(h, 'remove', { row: profileRows(h).find((r) => r.file === 'second.json')?.element }))
  await h.alert.wait({ timeout: 8000 })
  await h.alert.click('Remove…|Remove')
  await h.waitFor(() => !profileRows(h).some((r) => r.file === 'second.json'), { timeout: 8000 })
  h.check('Remove deletes the file and the profile goes with it', (await h.disk.stat(`${profilesDir}/second.json`)) === null && ctx.profiles.get('second') === undefined)
  await closeProfilesPage(h, page)
  await deleteUserFile(h, 'profiles', 'not-json.json')
  await deleteUserFile(h, 'profiles', 'imported-shop.json')
  await reloadProfiles(h)
  h.check('the folders hold only what this scenario meant to keep', ctx.profiles.list().filter((p) => p.origin === 'user').map((p) => p.id).join() === 'shop-lathe')
})
