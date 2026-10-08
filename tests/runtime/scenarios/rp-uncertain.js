// M12.5 "Real programs, second pass" in the running app: a dialect that was only a guess is
// shown as one (plan §6 M12.5, decision 2, WP-RP1 and WP-RP6).
//
// A program whose shape fits none of the supported controls well is still opened, read as the
// closest dialect, and marked: the dialect item in the status bar ends in a question mark and
// carries `data-uncertain="true"`, its tooltip says why, the status line says it once, and the
// quick pick opened on the item starts with "Keep <dialect> (the guess)". Keeping the guess is
// a decision and is remembered for the file; any pick clears the mark; nothing is ever blocked.
//
// **The programs are synthetic** (`tests/fixtures/nc/uncertain/`, written for gEdit, each saying
// so in its first line) and the words on screen are read through `ctx.t`, so a wording change
// moves the check with it. The dialect the guess falls on is read off the document, not
// assumed: what the scenario claims is the mark, the picker and the memory.

import { scenario } from '../lib/index.js'
import { context, message, pickEntry, pickerRows, readPicker, ready } from './m6-common.js'
import { openPath } from './m9-common.js'

const LATHE_GUESS = 'nc/uncertain/u03-dollar-comments.iso'
const MILL_GUESS = 'nc/uncertain/u01-pm-header.pm'
const SURE = 'nc/fanuc/f01-mill-3tools.nc'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The dialect item. @param {Harness} h */
const item = (h) => h.q('status-item', { item: 'profile' })

/** The item's text, mark and tooltip. @param {Harness} h */
function state(h) {
  const el = item(h)
  return { text: el?.textContent?.trim() ?? '', mark: el?.dataset.uncertain ?? null, title: el?.getAttribute('title') ?? '' }
}

/** Waits until the item shows the active document `id`'s profile. @param {Harness} h @param {string} id */
async function settled(h, id) {
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  await h.idle()
}

scenario('rp-uncertain', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  /** @param {string} id */
  const shortOf = (id) => ctx.profiles.get(ctx.docs.get(id)?.profileId ?? '')?.shortName ?? ''
  /** @param {string} id */
  const nameOf = (id) => ctx.profiles.profile(ctx.docs.get(id)?.profileId ?? '').name

  // =============================================================== A. a sure program shows no mark
  const sure = await openPath(h, await h.fixture(SURE))
  await settled(h, sure.id)
  h.check('a program that says what it is shows the plain dialect name, no question mark, no attribute', state(h).mark === null && state(h).text === shortOf(sure.id) && !state(h).text.includes('?'), state(h))
  h.check('and its document is not flagged', ctx.docs.get(sure.id)?.dialectUncertain !== true, ctx.docs.get(sure.id)?.dialectUncertain)

  // =============================================================== B. an uncertain program
  const lathe = await openPath(h, await h.fixture(LATHE_GUESS))
  await settled(h, lathe.id)
  const latheShort = shortOf(lathe.id)
  const latheName = nameOf(lathe.id)
  h.check('the program opens (nothing is blocked) as a real dialect, and the document is flagged', latheShort !== '' && ctx.docs.get(lathe.id)?.dialectUncertain === true, { profile: ctx.docs.get(lathe.id)?.profileId, flag: ctx.docs.get(lathe.id)?.dialectUncertain })
  h.check('the item reads "<dialect>?" and carries data-uncertain="true"', state(h).text === ctx.t('profiles.uncertain.label', { name: latheShort }) && state(h).text.endsWith('?') && state(h).mark === 'true', state(h))
  h.check('its tooltip says the dialect is uncertain and names the guess', state(h).title === ctx.t('profiles.uncertain.tooltip', { name: latheShort }), state(h).title)
  h.check(
    'and the status line told the user once, with the file and the guess',
    message(h).includes(ctx.t('profiles.uncertain.opened', { file: ctx.docs.get(lathe.id)?.title ?? '', name: latheShort })),
    message(h),
  )

  // The picker: placeholder, then "Keep ... (the guess)" as the first row, selected.
  const running = ctx.commands.run('file.setProfile')
  if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 }))) throw new Error('file.setProfile opened no picker')
  const placeholder = /** @type {HTMLInputElement | null} */ (h.q('quick-pick-input'))?.placeholder ?? ''
  const rows = pickerRows(h)
  h.check('the picker asks which control wrote the program, in its own words', placeholder === ctx.t('profiles.uncertain.placeholder'), placeholder)
  const keep = ctx.t('profiles.uncertain.keep', { name: latheName })
  h.check('its first row is "Keep … (the guess)" with the full dialect name and the detail that it is remembered', rows[0]?.label === keep && keep.endsWith('(the guess)') && rows[0]?.detail === ctx.t('profiles.uncertain.keepDetail'), rows.slice(0, 2))
  h.check('the dialects follow it, one row each', rows.length > 5 && rows.slice(1).some((r) => /^Okuma/.test(r.label)), rows.map((r) => r.label))
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await running
  await h.idle()
  h.check('Escape changes nothing: still marked', state(h).mark === 'true' && ctx.docs.get(lathe.id)?.dialectUncertain === true, state(h))

  // Keep the guess.
  await pickEntry(h, 'file.setProfile', keep)
  h.check('Keep clears the mark: the plain name, no attribute, the flag off, the dialect unchanged', state(h).text === latheShort && state(h).mark === null && ctx.docs.get(lathe.id)?.dialectUncertain === false && ctx.docs.get(lathe.id)?.profileId !== undefined, { s: state(h), flag: ctx.docs.get(lathe.id)?.dialectUncertain })
  h.check('the tooltip is the ordinary one again', state(h).title === ctx.t('profiles.tooltip', { name: latheShort }), state(h).title)
  h.check('the status line says the file keeps the dialect', message(h).includes(ctx.t('profiles.uncertain.kept', { file: ctx.docs.get(lathe.id)?.title ?? '', name: latheShort })), message(h))
  const keptProfile = ctx.docs.get(lathe.id)?.profileId

  // It is remembered for the file: close and open it again.
  await ctx.files.close(lathe.id)
  await h.idle()
  const again = await openPath(h, lathe.path)
  await settled(h, again.id)
  h.check('reopened, the same file is that dialect and no longer uncertain (remembered, even though nothing changed)', ctx.docs.get(again.id)?.profileId === keptProfile && state(h).mark === null && ctx.docs.get(again.id)?.dialectUncertain !== true, { profile: ctx.docs.get(again.id)?.profileId, s: state(h) })

  // The memory is the file's, not the content's: a copy of the same program elsewhere is a new question.
  const copyPath = `${h.cfg.run}/copy-of-guess.iso`
  await h.disk.write(copyPath, await h.disk.read(lathe.path))
  const copy = await openPath(h, copyPath)
  await settled(h, copy.id)
  h.check('a copy of the program under another name is uncertain again', state(h).mark === 'true' && state(h).text.endsWith('?'), state(h))

  // =============================================================== C. any pick clears
  const mill = await openPath(h, await h.fixture(MILL_GUESS))
  await settled(h, mill.id)
  h.check('the second synthetic program is uncertain too', state(h).mark === 'true', state(h))
  const okuma = ctx.profiles.get('okuma-osp')
  const okumaRow = (await readPicker(h, 'file.setProfile')).find((r) => /^Okuma/.test(r.label))
  await pickEntry(h, 'file.setProfile', okumaRow?.label ?? '')
  h.check('picking another dialect from the list switches to it and clears the mark', ctx.docs.get(mill.id)?.profileId === 'okuma-osp' && state(h).text === okuma?.shortName && state(h).mark === null && ctx.docs.get(mill.id)?.dialectUncertain === false, { s: state(h), profile: ctx.docs.get(mill.id)?.profileId })
  await ctx.files.close(mill.id)
  await h.idle()
  const millAgain = await openPath(h, mill.path)
  await settled(h, millAgain.id)
  h.check('and that choice, like every one, wins on the next open', ctx.docs.get(millAgain.id)?.profileId === 'okuma-osp' && state(h).mark === null, { profile: ctx.docs.get(millAgain.id)?.profileId, s: state(h) })

  // =============================================================== D. a sure program's picker is the ordinary one
  ctx.docs.activate(sure.id)
  await settled(h, sure.id)
  const sureRun = ctx.commands.run('file.setProfile')
  await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
  const sureRows = pickerRows(h)
  const sureHolder = /** @type {HTMLInputElement | null} */ (h.q('quick-pick-input'))?.placeholder ?? ''
  h.check('on a program that is not in doubt the picker has no "Keep" row and the ordinary placeholder', !sureRows.some((r) => r.label.startsWith('Keep ')) && sureHolder === ctx.t('profiles.placeholder'), { holder: sureHolder, first: sureRows[0]?.label })
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await sureRun
  await h.idle()
})
