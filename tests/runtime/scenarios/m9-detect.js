// Detection after M9, in the running app (plan §6 M9 H9 `m9-detect`, WP9.1, WP9.6, WP9.5b):
// every committed fixture opens as the dialect its detection golden says, the owner-public
// programs as the folder they are in says, the fixtures WP9.6 added (the synthetic Y-axis
// lathe and the Fanuc lathe / Sinumerik tie) are among them, and Save As to another
// extension finds the dialect again.
//
// **The goldens are the claim and the app is asked.** `tests/fixtures/expected/detect/*.json`
// is the table gate G10 reviews (the margins are printed by `fanucLathe.test.ts` and
// `sinumerikMill.test.ts`); this scenario opens each fixture through the file dialog, as a
// user does, and compares the profile the document ends up with. A golden answer of
// `fallback` (the content is inconclusive and the current profile stays) and `refused` (the
// file does not open at all) is not a profile and is left to `m3-profiles` and `m1-encoding2`.
//
// **Save As re-detects, from the extension.** A program with nothing in it that one
// dialect writes — `G0 X0 Y0`, `M30` — is read as the dialect its extension says; saved as
// `a.nc` it is Fanuc, and when it is saved as `a.h` it is a Klartext program. The check
// uses such a program on purpose: a program that says what it is (`f01-mill-3tools.nc`)
// keeps its dialect under any extension, which is the other half of the rule and is checked
// too. That Save As re-detects at all is WP9.5b's.

import { scenario } from '../lib/index.js'
import { ready } from './m4-common.js'
import { openFixtureAs } from './m8-common.js'
import { KLARTEXT, FANUC_LATHE, FANUC_MILL, context, detectGolden, detectionPairs, openPath } from './m9-common.js'

/**
 * The detection goldens of the dialects, as `expected/detect/<name>.json`. `ambiguous` (the
 * answer depends on the document's current profile) and `encoding` (decoding is the thing
 * under test; some of them raise a notice or refuse) are the business of `m3-profiles` and
 * `m1-encoding2`.
 */
const GOLDENS = ['fanuc', 'fanuc-lathe', 'heidenhain', 'okuma', 'sinumerik', 'sinumerik-mill', 'owner-public']

/** A program with nothing in it that one dialect writes. */
const NOTHING_SAID = ['(PROBE)', 'G0 X0 Y0', 'G1 X10. F200.', 'M30', ''].join('\n')

scenario('m9-detect', { timeout: 540 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // =============================================================== A. every golden, in the app
  /** @type {{ rel: string, golden: string, got: string | undefined }[]} */
  const wrong = []
  /** @type {Map<string, string>} */
  const answers = new Map()
  let opened = 0
  for (const folder of GOLDENS) {
    for (const [rel, want] of await detectionPairs(h, folder)) {
      answers.set(rel, want)
      const file = await openPath(h, await h.fixture(rel))
      opened += 1
      const got = ctx.docs.get(file.id)?.profileId
      if (got !== want) wrong.push({ rel, golden: want, got })
      // One document per fixture would put 80 tabs on the screen; the answer is what counts.
      await ctx.files.close(file.id)
    }
  }
  h.check(`the detection goldens name ${opened} fixtures with a profile, and the app opens every one of them as that profile`, opened >= 55 && wrong.length === 0, wrong)

  // =============================================================== B. the owner-public programs say what their folder says
  const published = [...answers].filter(([rel]) => rel.startsWith('nc/owner-public/'))
  h.check('there are the owner’s published programs among them, for all six dialects', published.length >= 20 && new Set(published.map(([, profile]) => profile)).size === 6, [...new Set(published.map(([, profile]) => profile))])
  h.check(
    'and each is detected as its folder says: the folder is the profile id',
    published.every(([rel, profile]) => rel.split('/')[2] === profile),
    published.filter(([rel, profile]) => rel.split('/')[2] !== profile),
  )

  // =============================================================== C. what WP9.6 added
  const Y_LATHE = 'nc/fanuc-lathe/l09-y-axis-lathe.nc'
  const TIE = 'expected/detect/programs/tie-numbered-blocks'
  h.check(
    'the Fanuc lathe golden holds the synthetic Y-axis lathe, and the app opened it as the Fanuc lathe (above), not as a mill because it moves Y',
    answers.get(Y_LATHE) === FANUC_LATHE,
    answers.get(Y_LATHE),
  )
  // The tie: a numbered-block program with only G96/G97 turning evidence and no Siemens
  // word scores the same for the Fanuc lathe and Sinumerik turning; priority decides, and
  // the Fanuc lathe has the higher one (WP9.6, with the Sinumerik priorities -1 / -2).
  const sinumerikDoc = await openPath(h, await h.fixture('nc/sinumerik/s01-shaft.MPF'))
  const tie = await openPath(h, await h.fixture(TIE))
  h.check('the Fanuc lathe / Sinumerik tie, opened while a Sinumerik document is active, opens as the Fanuc lathe', ctx.docs.get(tie.id)?.profileId === FANUC_LATHE, ctx.docs.get(tie.id)?.profileId)
  await ctx.files.close(tie.id)
  await ctx.files.close(sinumerikDoc.id)
  const mill4 = await openPath(h, await h.fixture('nc/ambiguous/mill-4digit-t.nc'))
  h.check('and the mill that only looks like it, T1001 M6, stays a mill', ctx.docs.get(mill4.id)?.profileId === FANUC_MILL && (await detectGolden(h, 'ambiguous'))['nc/ambiguous/mill-4digit-t.nc'] === FANUC_MILL, ctx.docs.get(mill4.id)?.profileId)
  await ctx.files.close(mill4.id)

  // =============================================================== D. Save As finds the dialect again
  const plain = `${h.cfg.run}/PROBE.nc`
  await h.disk.write(plain, NOTHING_SAID)
  const probe = await openPath(h, plain)
  h.check('a program that says nothing opens as Fanuc under .nc', ctx.docs.get(probe.id)?.profileId === FANUC_MILL, ctx.docs.get(probe.id)?.profileId)

  const sameExtension = `${h.cfg.run}/PROBE-COPY.nc`
  await h.dialogs.queue('save', sameExtension)
  h.check('Save As to another .nc name saves', (await ctx.files.saveAs(probe.id)) === true)
  await h.idle()
  h.check('and keeps the dialect', ctx.docs.get(probe.id)?.profileId === FANUC_MILL, ctx.docs.get(probe.id)?.profileId)

  const klartext = `${h.cfg.run}/PROBE.h`
  await h.dialogs.queue('save', klartext)
  h.check('Save As to a .h file saves', (await ctx.files.saveAs(probe.id)) === true)
  await h.idle()
  await h.waitFor(() => ctx.docs.get(probe.id)?.profileId === KLARTEXT, { timeout: 8000 })
  const shortName = ctx.profiles.get(KLARTEXT)?.shortName
  h.check('the document is now a Klartext program: the extension decides when the content does not', ctx.docs.get(probe.id)?.profileId === KLARTEXT, ctx.docs.get(probe.id)?.profileId)
  h.check('the editor’s language follows it, and so does the status bar', ctx.editor.model(probe.id)?.getLanguageId() === KLARTEXT && h.q('status-item', { item: 'profile' })?.textContent?.trim() === shortName, {
    language: ctx.editor.model(probe.id)?.getLanguageId(),
    status: h.q('status-item', { item: 'profile' })?.textContent?.trim(),
    shortName,
  })
  h.check('what was written is the text of the buffer, byte for byte', (await h.disk.read(klartext)) === NOTHING_SAID.replace(/\r\n/g, '\n') || (await h.disk.read(klartext)) === NOTHING_SAID.replace(/\n/g, '\r\n'), (await h.disk.read(klartext)).slice(0, 60))

  // A program that says what it is keeps its dialect under any extension: the content wins.
  const f01 = await openFixtureAs(h, 'nc/fanuc/f01-mill-3tools.nc', 'F01.nc')
  const asH = `${h.cfg.run}/F01.h`
  await h.dialogs.queue('save', asH)
  h.check('a program that does say what it is also saves', (await ctx.files.saveAs(f01.id)) === true)
  await h.idle()
  h.check('and keeps its dialect under an extension of another one', ctx.docs.get(f01.id)?.profileId === FANUC_MILL, ctx.docs.get(f01.id)?.profileId)

  h.check('no document was left unsaved', ctx.docs.all().filter((doc) => doc.path !== null).every((doc) => !doc.dirty), ctx.docs.all().map((doc) => `${doc.title}:${doc.dirty}`))
})
