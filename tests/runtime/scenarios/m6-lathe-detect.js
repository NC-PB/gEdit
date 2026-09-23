// The Fanuc lathe profile in the running app (plan §5 M6 H6 `m6-lathe-detect`, WP6.1 and
// WP6.2, AD-31): a posted turning program opens as `fanuc-lathe`, the G-code system it was
// written for is read out of the text, the Phase 1 fixtures keep the dialect they had, and
// the owner can still say so himself.
//
// **This is the NC-correctness scenario of the milestone.** Which G-code system a lathe
// file is read as decides what `G92 S2200` means — a spindle clamp in system A, a thread
// at 2200 rpm in system B — and the wrong answer scales a thread lead. So the checks are
// not "a lathe file looks like a lathe file": every answer comes out of
// `tests/fixtures/expected/detect/fanuc-lathe.json`, which is the table G10 reviews, and
// the variant is read off the status item's tooltip, which is the sentence a user can
// check the machine against.
//
// Two things the tooltip is deliberately asked for rather than the service:
//
//   1. **The source of each value is the claim.** "G-code system B" alone tells nobody
//      whether gEdit read it out of the program or fell back to the dialect's default;
//      "— detected in this program" against "— dialect default, assumed" is the difference
//      AD-31 exists for, and the item is where a user sees it.
//   2. **A variant that was *not* detected must say so.** A file whose two systems score
//      within `VARIANT_MARGIN` of each other keeps the profile's default (A), and it has to
//      be shown as assumed, not as read.

import { scenario } from '../lib/index.js'
import { KLARTEXT, LATHE, MILL, context, machineItem, machineText, openFixture, pickEntry, readPicker, tooltipLine } from './m6-common.js'

/** The Phase 1 fixtures whose dialect M6 may not move, and the folders they live in. */
const P1_FIXTURES = [
  'nc/fanuc/f01-mill-3tools.nc',
  'nc/fanuc/f02-packed.nc',
  'nc/fanuc/f04-feed-modes.nc',
  'nc/fanuc/f07.tap',
  'nc/fanuc/O1234',
  'nc/heidenhain/h01-3tools.h',
  'nc/heidenhain/detect-heidenhain.txt',
]

/** The variant's label and the label of each choice, as `fanuc-lathe.json` writes them. */
const VARIANT_LABEL = 'G-code system'
const CHOICE = { A: 'G-code system A', B: 'G-code system B' }

/** `machines.source.*`, the three endings a tooltip line can have. */
const FROM_TEXT = 'detected in this program'
const FROM_PROFILE = 'dialect default, assumed'

scenario('m6-lathe-detect', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })

  // ------------------------------------------------- the goldens, read rather than typed
  const goldens = JSON.parse(await h.disk.read(await h.fixture('expected/detect/fanuc-lathe.json')))
  /** @type {Record<string, string>} */
  const answers = goldens.fixtures
  /** @type {Record<string, { gcodeSystem: string, detected: boolean }>} */
  const variants = goldens.variants
  const lathes = Object.keys(answers).sort()
  h.check('the lathe detection golden lists a file set and a variant for each of them', lathes.length >= 8 && lathes.every((rel) => typeof variants[rel]?.gcodeSystem === 'string'), {
    files: lathes.length,
    withoutVariant: lathes.filter((rel) => variants[rel] === undefined),
  })

  // =============================================================== A. every lathe fixture
  /** @type {Record<string, string>} */
  const opened = {}
  for (const rel of lathes) {
    const want = answers[rel]
    const file = await openFixture(h, rel)
    opened[rel] = file.id
    const got = ctx.docs.get(file.id)?.profileId
    h.check(`${rel} opens as ${want}`, got === want, { got, want })
    h.check(`${rel}: the profile id is the Monaco language id`, ctx.editor.model(file.id)?.getLanguageId() === want, {
      language: ctx.editor.model(file.id)?.getLanguageId(),
      profile: got,
    })

    // The variant, off the status item the user reads.
    const expected = variants[rel]
    const line = tooltipLine(h, VARIANT_LABEL)
    const wantValue = CHOICE[/** @type {'A' | 'B'} */ (expected.gcodeSystem)]
    const wantSource = expected.detected ? FROM_TEXT : FROM_PROFILE
    h.check(
      `${rel}: the machine item reads ${wantValue}, ${expected.detected ? 'from the program' : 'as the dialect default'}`,
      line === `${VARIANT_LABEL}: ${wantValue} — ${wantSource}`,
      { line, want: `${VARIANT_LABEL}: ${wantValue} — ${wantSource}`, tooltip: machineItem(h)?.getAttribute('title') },
    )
  }

  // The two that carry the decision, named so a failure says which way it went wrong.
  const systemB = opened['nc/fanuc-lathe/l05-system-b.nc']
  const drillB = opened['nc/fanuc-lathe/l07-system-b-drill.nc']
  ctx.docs.activate(systemB)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === systemB, { timeout: 8000 })
  await h.idle()
  h.check(
    'the G92 S clamp of l05 is read as system B, not as a thread at 2200 rpm in A',
    tooltipLine(h, VARIANT_LABEL) === `${VARIANT_LABEL}: ${CHOICE.B} — ${FROM_TEXT}`,
    tooltipLine(h, VARIANT_LABEL),
  )
  ctx.docs.activate(drillB)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === drillB, { timeout: 8000 })
  await h.idle()
  h.check(
    'l07: the repeated G98/G99 cycle-return lines do not outvote the one decisive B marker (a variant pattern scores once)',
    tooltipLine(h, VARIANT_LABEL) === `${VARIANT_LABEL}: ${CHOICE.B} — ${FROM_TEXT}`,
    tooltipLine(h, VARIANT_LABEL),
  )

  // =============================================================== B. the status bar
  const l01 = opened['nc/fanuc-lathe/l01-turning-a.nc']
  ctx.docs.activate(l01)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === l01, { timeout: 8000 })
  await h.idle()
  const shortName = ctx.profiles.get(LATHE)?.shortName
  h.check('the dialect item names the lathe profile', h.q('status-item', { item: 'profile' })?.textContent?.trim() === shortName, {
    item: h.q('status-item', { item: 'profile' })?.textContent?.trim(),
    shortName,
  })
  h.check('with no machine defined the machine item says none, and marks it assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', {
    text: machineText(h),
    assumed: machineItem(h)?.dataset.assumed,
    machineId: machineItem(h)?.dataset.machineId,
    choice: machineItem(h)?.dataset.choice,
  })
  h.check('and it is a choice of none rather than a machine that went missing', machineItem(h)?.dataset.machineId === '' && machineItem(h)?.dataset.choice === 'none', {
    machineId: machineItem(h)?.dataset.machineId,
    choice: machineItem(h)?.dataset.choice,
  })
  // Every value a lathe document depends on is in the tooltip, each with its source. The
  // power-on groups are **not** among them while no machine is chosen: `machineSummaryLines`
  // lists `params.modalInitial`, which holds what a machine set and nothing else, so an
  // empty list there is the honest answer rather than a missing line (the dialect's own
  // power-on codes are still in force — `m6-lathe-scripts` is where they are measured, on
  // a feed the interpreter reads per revolution).
  const tooltipLabels = ['How the control reads numbers', 'Units at power-on', 'X and U are diameters at power-on', VARIANT_LABEL]
  h.check(
    'the tooltip names every effective parameter with where it came from',
    tooltipLabels.every((label) => tooltipLine(h, label) !== '' && / — /.test(tooltipLine(h, label))),
    tooltipLabels.map((label) => tooltipLine(h, label)),
  )
  h.check(
    'it opens by saying that those values are the dialect’s and not a machine’s',
    machineItem(h)?.getAttribute('title')?.startsWith('No machine. The values below are what the dialect documents, and they are assumed.') === true,
    machineItem(h)?.getAttribute('title')?.split('\n')[0],
  )
  h.check(
    'and the three that matter on a lathe are the dialect defaults, not a machine’s: calculator-type input, millimetres, diameter on',
    tooltipLine(h, 'How the control reads numbers') ===
      'How the control reads numbers: As written: X50 and X50. are both 50 mm; cycle steps in microns (Q6000 is 6 mm) — dialect default, assumed' &&
      tooltipLine(h, 'Units at power-on') === 'Units at power-on: Millimetres (mm) — dialect default, assumed' &&
      tooltipLine(h, 'X and U are diameters at power-on') === 'X and U are diameters at power-on: on — dialect default, assumed',
    tooltipLabels.map((label) => tooltipLine(h, label)),
  )

  // =============================================================== C. the P1 fixtures
  /** @type {Record<string, string>} */
  const p1Answers = {}
  for (const folder of [...new Set(P1_FIXTURES.map((rel) => rel.split('/')[1]))]) {
    Object.assign(p1Answers, JSON.parse(await h.disk.read(await h.fixture(`expected/detect/${folder}.json`))).fixtures)
  }
  /** @type {Record<string, string>} */
  const p1Opened = {}
  for (const rel of P1_FIXTURES) {
    const want = p1Answers[rel]
    // `h.fixture` re-copies the file on every call, so each fixture is opened exactly once
    // here and its document id kept: a second copy would change the mtime under an open
    // document and send the external-change poll off for nothing.
    const file = await openFixture(h, rel)
    p1Opened[rel] = file.id
    const got = ctx.docs.get(file.id)?.profileId
    h.check(`${rel} keeps its Phase 1 dialect (${want})`, got === want && got !== LATHE, { got, want })
  }
  // The one the plan named: `f04-feed-modes.nc` carries `G50 S` and `G96`, which are the
  // two strongest lathe markers there are, and it still has to stay a mill file — WP6.2
  // tuned the weights so a Phase 1 fixture would not move dialect at M6.
  h.check(
    'f04-feed-modes.nc, with its G50 S and G96, is still a mill program',
    ctx.docs.get(p1Opened['nc/fanuc/f04-feed-modes.nc'])?.profileId === MILL,
    ctx.docs.get(p1Opened['nc/fanuc/f04-feed-modes.nc'])?.profileId,
  )

  // =============================================================== D. the machine item's reach
  const klartextId = p1Opened['nc/heidenhain/h01-3tools.h']
  ctx.docs.activate(klartextId)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === klartextId, { timeout: 8000 })
  await h.idle()
  h.check('a Klartext document has no machine item at all: that dialect declares no machine parameters', machineItem(h) === null && ctx.docs.get(klartextId)?.profileId === KLARTEXT, {
    item: machineItem(h)?.outerHTML?.slice(0, 120) ?? null,
    profile: ctx.docs.get(klartextId)?.profileId,
  })
  const mill = { id: p1Opened['nc/fanuc/f01-mill-3tools.nc'] }
  ctx.docs.activate(mill.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === mill.id, { timeout: 8000 })
  await h.idle()
  h.check('a mill document has one, and it says none as well', machineItem(h) !== null && machineText(h) === 'Machine: none (assumed)', machineText(h))
  h.check('and the mill has no G-code system to choose, so that line is not in its tooltip', tooltipLine(h, VARIANT_LABEL) === '', tooltipLine(h, VARIANT_LABEL))

  // =============================================================== E. a manual switch
  // The picker groups the lathe under the mill it inherits from, so the two read as one
  // control family rather than as two unrelated dialects (WP6.1).
  // The two names are data (`Fanuc (ISO) mill`, `Fanuc (ISO) lathe`); what the picker adds
  // is the grouping — the shared head once, then the part that differs — so the labels are
  // derived from the names rather than retyped.
  const entries = await readPicker(h, 'file.setProfile')
  const millName = ctx.profiles.profile(MILL).name
  const latheName = ctx.profiles.profile(LATHE).name
  const head = millName.split(' ').filter((word, i) => latheName.split(' ')[i] === word).join(' ')
  const grouped = (/** @type {string} */ name) => `${head} · ${name.slice(head.length).trim()}`
  const millEntry = entries.find((entry) => entry.label === grouped(millName))
  const latheEntry = entries.find((entry) => entry.label === grouped(latheName))
  h.check('the dialect picker offers all three profiles', entries.length === ctx.profiles.list().length && entries.length === 3, entries.map((e) => e.label))
  h.check('the mill and the lathe are listed as one family, under the part of the name they share', millEntry !== undefined && latheEntry !== undefined && head !== '' && head !== millName, {
    labels: entries.map((e) => e.label),
    head,
    millName,
    latheName,
  })
  h.check('the mill entry is marked as the one this document uses', millEntry?.description === '✓', entries.map((e) => `${e.label}|${e.description}`))

  // Switching the mill document to the lathe by hand: the dialect follows, and so does the
  // machine item, which now has a G-code system to read.
  await pickEntry(h, 'file.setProfile', /** @type {string} */ (latheEntry?.label))
  await h.waitFor(() => ctx.docs.get(mill.id)?.profileId === LATHE, { timeout: 8000 })
  await h.idle()
  h.check('a hand-picked lathe profile takes on the document', ctx.docs.get(mill.id)?.profileId === LATHE && ctx.editor.model(mill.id)?.getLanguageId() === LATHE, {
    profile: ctx.docs.get(mill.id)?.profileId,
    language: ctx.editor.model(mill.id)?.getLanguageId(),
  })
  h.check('the status bar says so', h.q('status-item', { item: 'profile' })?.textContent?.trim() === shortName, h.q('status-item', { item: 'profile' })?.textContent?.trim())
  h.check(
    'and the G-code system appears in the tooltip, as the dialect default for a milling program that says nothing about it',
    tooltipLine(h, VARIANT_LABEL) === `${VARIANT_LABEL}: ${CHOICE.A} — ${FROM_PROFILE}`,
    tooltipLine(h, VARIANT_LABEL),
  )

  await pickEntry(h, 'file.setProfile', grouped(millName))
  await h.waitFor(() => ctx.docs.get(mill.id)?.profileId === MILL, { timeout: 8000 })
  h.check('and switching back is just as easy', ctx.docs.get(mill.id)?.profileId === MILL && tooltipLine(h, VARIANT_LABEL) === '', {
    profile: ctx.docs.get(mill.id)?.profileId,
    variantLine: tooltipLine(h, VARIANT_LABEL),
  })

  h.check(
    'the scenario changed no file it opened',
    ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty),
    ctx.docs.all().map((d) => `${d.title}:${d.dirty}`),
  )
})
