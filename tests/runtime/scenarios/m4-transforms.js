// The transforms, run the way a user runs them (plan §5 M4 H4 `m4-transforms`, WP4.1 to
// WP4.3): the NC ribbon tab, the options form, the preflight confirmation, the edit on a
// real Monaco model, the scope of a selection, the new-document target and the Results
// panel.
//
// **The goldens are the unit tests' goldens.** Every case below copies
// `tests/fixtures/transforms/<id>/<case>/` into the run folder and compares the whole
// document text against `expected.nc`. The vitest suites prove the same transforms as
// pure functions; what this scenario adds is everything between the user and that
// function — the command, the form, the scope, `applyLines`, the status bar and the
// panel — and that the answer survives the round trip through a Monaco model.
//
// Three things are worth knowing about the table:
//
//   1. **`fields` is the case's `options.json`, expressed as the form.** A choice is set
//      by its label (`UPPER CASE`), an integer by its text. `fieldsMatchFixture` below
//      checks that the two agree on *which* options the case sets, so a fixture that
//      grows an option fails here instead of silently running with a default.
//   2. **Three transforms have no options form at all** (`remove-block-numbers`,
//      `insert-spaces`, `remove-spaces`, `remove-empty-lines`): `def.options` is absent,
//      so `TransformService` opens no dialog and `form` stays false.
//   3. **Two cases answer a native alert.** `renumber/references` is the preflight — the
//      program jumps to block numbers the run does not rewrite — and
//      `remove-comments/klartext-sections` is the Klartext follow-up of
//      `contrib/ncCleanup.ts`, which offers `nc.renumber` because the removed line broke
//      the consecutive numbering. The follow-up is declined, so the golden is the
//      transform's own output.

import { scenario } from '../lib/index.js'
import {
  NC_COMMANDS,
  PREFIX_DEF,
  cmdButton,
  context,
  message,
  newDoc,
  openDocIds,
  ready,
  revealLine,
  ribbonTab,
  runTransform,
  selectLines,
  transformCase,
} from './m4-common.js'

/**
 * One golden case: the command, the fixture folder, and the form the user fills in.
 * @type {{ command: string, id: string, name: string, form?: boolean, fields?: Record<string, string | number | boolean>, confirm?: string, why: string }[]}
 */
const CASES = [
  {
    command: 'nc.renumber',
    id: 'renumber',
    name: 'skip-marks',
    form: true,
    fields: { start: 10, step: 10, skipStartingWith: '', restartAtProgramStart: false },
    why: 'every block-skip form keeps its mark, and a skipped block without a number gets one behind the mark',
  },
  {
    command: 'nc.renumber',
    id: 'renumber',
    name: 'packed',
    form: true,
    fields: { start: 10, step: 10, skipStartingWith: '', restartAtProgramStart: false },
    why: 'packed CAM output: only the block number moves, the words behind it stay packed',
  },
  {
    command: 'nc.renumber',
    id: 'renumber',
    name: 'references',
    form: true,
    fields: { start: 10, step: 10, skipStartingWith: '(', restartAtProgramStart: false },
    confirm: 'Continue',
    why: 'the preflight asks about the jump targets, and the references are left as they were',
  },
  {
    command: 'nc.removeBlockNumbers',
    id: 'remove-block-numbers',
    name: 'skip-marks',
    why: '/N100 becomes /G0 and every skip mark stays where it stood',
  },
  {
    command: 'nc.insertSpaces',
    id: 'insert-spaces',
    name: 'fanuc-packed',
    why: 'expressions, comments and the block-skip forms survive the spacing',
  },
  {
    command: 'nc.insertSpaces',
    id: 'insert-spaces',
    name: 'fanuc-unclosed-comment',
    why: 'an unclosed comment runs to the end of the line and is not touched',
  },
  {
    command: 'nc.removeSpaces',
    id: 'remove-spaces',
    name: 'fanuc-would-merge',
    why: 'a space whose removal would merge two numbers stays, and is reported',
  },
  {
    command: 'nc.removeEmptyLines',
    id: 'remove-empty-lines',
    name: 'fanuc-blanks',
    why: 'every blank line goes and the trailing newline stays',
  },
  {
    command: 'nc.removeComments',
    id: 'remove-comments',
    name: 'fanuc-default',
    form: true,
    why: 'the program-name comment stays, an emptied line goes, and a skipped block keeps its mark',
  },
  {
    command: 'nc.convertCase',
    id: 'convert-case',
    name: 'fanuc-upper',
    form: true,
    fields: { case: 'UPPER CASE' },
    why: 'comments and strings keep their case; the macro words do not',
  },
  {
    command: 'nc.convertCase',
    id: 'convert-case',
    name: 'klartext-tool-names',
    form: true,
    fields: { case: 'UPPER CASE' },
    why: 'a quoted Klartext tool name is code the control matches, so it is left alone',
  },
  {
    command: 'nc.removeComments',
    id: 'remove-comments',
    name: 'klartext-sections',
    form: true,
    confirm: 'Cancel',
    why: 'section headings and the continuation ~ survive, and the renumber follow-up is offered',
  },
]

/** The option ids the case sets, from whichever `options.json` shape it uses. */
const fieldsMatchFixture = (/** @type {any} */ fixture, /** @type {any} */ entry) =>
  JSON.stringify(Object.keys(fixture.options).sort()) === JSON.stringify(Object.keys(entry.fields ?? {}).sort())

/** A short program whose line 3 holds nothing but its block number. */
const LABELLED = ['N10 G0 X0', 'N20 G1 X10.', 'N30', 'N40 G1 X20.', 'N50 M30', ''].join('\n')

scenario('m4-transforms', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // ==================================================================== A. the NC tab
  const tabs = h.qa('ribbon-tab').map((e) => e.dataset.tab)
  h.check('the ribbon has an NC tab between Insert and Tools', JSON.stringify(tabs) === '["home","insert","nc","tools","view"]', tabs)

  await ribbonTab(h, 'nc')
  const ncButtons = h.qa('cmd-button').map((e) => e.dataset.command).filter((id) => id?.startsWith('nc.'))
  h.check('the NC tab shows all seven transform commands', NC_COMMANDS.every((id) => ncButtons.includes(id)) && ncButtons.length === NC_COMMANDS.length, ncButtons)
  // Numbering before Cleanup, and each group in its own contribution order. Both used to
  // start at order 10, so `ribbonModel.groupsOf` broke the tie by first appearance — the
  // alphabetical load order of the two contribution files — and Cleanup came first by
  // accident; `contrib/ncNumbering.ts` now says 5/15 so the tab does not depend on a
  // filename. `NC_COMMANDS` is that order.
  h.check('the NC tab draws Numbering before Cleanup, each group in its contribution order', JSON.stringify(ncButtons) === JSON.stringify(NC_COMMANDS), ncButtons)
  const captions = [...document.querySelectorAll('.group-label')].map((e) => e.textContent?.trim())
  h.check('the two group captions are translated', captions.includes('Numbering') && captions.includes('Cleanup'), captions)
  h.check(
    'they are enabled while a document is open',
    NC_COMMANDS.every((id) => cmdButton(h, id) !== null && !(/** @type {HTMLButtonElement} */ (cmdButton(h, id)).disabled)),
    NC_COMMANDS.filter((id) => /** @type {HTMLButtonElement | null} */ (cmdButton(h, id))?.disabled),
  )

  // =================================================================== B. the goldens
  for (const entry of CASES) {
    const label = `${entry.id}/${entry.name}`
    const fixture = await transformCase(h, entry.id, entry.name)
    h.check(`${label}: the form values are the options the fixture runs with`, fieldsMatchFixture(fixture, entry), {
      fixture: Object.keys(fixture.options),
      form: Object.keys(entry.fields ?? {}),
    })

    const id = await newDoc(h, fixture.input, fixture.profile)
    h.check(`${label}: the document opens on ${fixture.profile}`, h.app.activeProfile() === fixture.profile, h.app.activeProfile())

    const ran = await runTransform(h, entry.command, { form: entry.form, fields: entry.fields, confirm: entry.confirm })
    h.check(`${label}: ${entry.why}`, ran && h.app.text() === fixture.expected, {
      ran,
      got: h.app.text().split('\n'),
      want: fixture.expected.split('\n'),
      status: message(h),
    })
    h.check(`${label}: the run stayed in the document it was started in`, ctx.docs.get(id)?.id === id && h.q('editor-host')?.dataset.docId === id, {
      active: h.q('editor-host')?.dataset.docId,
      id,
    })
  }

  // ======================================= B2. the two ways a run does not happen at all
  // Step 1, availability: the reason goes to the status bar and nothing is edited.
  const klartext = await newDoc(h, ['0 BEGIN PGM TEST MM', '1 TOOL CALL 1 Z S3000', '2 END PGM TEST MM', ''].join('\n'), 'heidenhain-klartext')
  const klartextText = h.app.text()
  await runTransform(h, 'nc.removeSpaces')
  h.check(
    'a transform the dialect cannot run says why and edits nothing',
    message(h) === 'Heidenhain Klartext separates its words with spaces, so they cannot be removed.' && h.app.text() === klartextText && ctx.docs.getActiveId() === klartext,
    { message: message(h), text: h.app.text().split('\n') },
  )
  await runTransform(h, 'nc.removeBlockNumbers')
  h.check(
    'so does one the dialect forbids',
    message(h) === 'This dialect needs a number on every block, so they cannot be removed.' && h.app.text() === klartextText,
    { message: message(h), text: h.app.text().split('\n') },
  )

  // Step 2, cancel: the form is the last point at which nothing has happened yet.
  const untouched = await newDoc(h, 'N10 G0 X0\nN20 M30\n')
  const beforeCancel = h.app.text()
  await runTransform(h, 'nc.renumber', { form: true, fields: { start: 500 }, cancelForm: true })
  h.check('a cancelled options form leaves the program exactly as it was', h.app.text() === beforeCancel && ctx.docs.getActiveId() === untouched, {
    text: h.app.text().split('\n'),
    active: ctx.docs.getActiveId(),
  })

  // ================================================== C. the scope is what was selected
  const scoped = await newDoc(h, LABELLED)
  await selectLines(h, 3, 4)
  await runTransform(h, 'nc.removeBlockNumbers')
  const lines = h.app.text().split('\n')
  h.check(
    'a selection is the scope: only the selected blocks lost their numbers',
    JSON.stringify(lines) === JSON.stringify(['N10 G0 X0', 'N20 G1 X10.', '', 'G1 X20.', 'N50 M30', '']),
    lines,
  )
  h.check('the status bar says the run was a selection', message(h) === 'Removed 2 block numbers. (selection)', message(h))

  // The report's lines are the document's, not the scope's: the emptied line is line 3.
  await h.waitFor(() => h.q('results-panel'), { timeout: 8000 })
  const finding = h.qa('results-finding').find((e) => e.dataset.line === '3')
  h.check(
    'the emptied line is reported on its document line, in its document',
    !!finding && finding.dataset.docId === scoped && finding.dataset.severity === 'warning',
    h.qa('results-finding').map((e) => `${e.dataset.line}:${e.dataset.severity}:${e.dataset.docId}`),
  )

  // A click on a finding reveals that line in the document it names.
  await revealLine(h, scoped, 1, 1)
  h.click(finding)
  await h.waitFor(() => h.app.cursor().line === 3, { timeout: 5000 })
  h.check('clicking a finding reveals its line', h.app.cursor().line === 3, h.app.cursor())

  // The panel's two export actions carry `results-copy` and `results-open`. §7.9 named
  // only the panel, the rows and the findings, so until integration added those two ids
  // this was a positional pick that a harmless re-layout would have broken.
  const openAsText = h.q('results-open')
  h.check(
    'the panel offers its two export actions',
    h.q('results-copy') !== null && openAsText !== null,
    [h.q('results-copy')?.textContent?.trim(), openAsText?.textContent?.trim()],
  )
  const tabsBefore = openDocIds(h).length
  h.click(/** @type {HTMLElement} */ (openAsText))
  await h.waitFor(() => openDocIds(h).length === tabsBefore + 1, { timeout: 5000 })
  h.check(
    'Open as text puts the report in a new document',
    h.app.text().startsWith('Remove Block Numbers') && h.app.text().includes('Removed 2 block numbers.'),
    h.app.text().slice(0, 240),
  )
  ctx.docs.activate(scoped)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === scoped, { timeout: 5000 })

  // A run with nothing to report retracts its own report and nothing else.
  await runTransform(h, 'nc.removeEmptyLines')
  await h.idle()
  h.check('a run with nothing to report clears the panel it filled', h.qa('results-finding').length === 0 && h.q('results-panel') !== null, h.qa('results-finding').length)

  // ========================================================= D. the new-document target
  const source = await newDoc(h, 'N10 G0 X0\nN20 G1 X10.\nN30 M30\n')
  const before = openDocIds(h).length
  const sourceText = h.app.text()
  await selectLines(h, 2, 2)
  const result = await ctx.transforms.run(PREFIX_DEF, { target: 'new-document' })
  await h.idle()
  const created = ctx.docs.getActiveId()
  h.check('the transform answered with its result', result !== null && Array.isArray(result?.lines), result && Object.keys(result))
  h.check('a new tab was opened and activated', openDocIds(h).length === before + 1 && created !== source, {
    before,
    now: openDocIds(h).length,
    source,
    created,
  })
  h.check('it holds only the selected lines, transformed', h.app.text() === '(Z) N20 G1 X10.', JSON.stringify(h.app.text()))
  h.check('it carries the source document profile', ctx.docs.get(/** @type {string} */ (created))?.profileId === 'fanuc-gcode', ctx.docs.get(/** @type {string} */ (created))?.profileId)
  h.check(
    'the source document was not touched and stays unmodified',
    ctx.editor.getText(source) === sourceText && h.q('doc-tab', { docId: source })?.dataset.dirty !== '1',
    { text: ctx.editor.getText(source), dirty: h.q('doc-tab', { docId: source })?.dataset.dirty },
  )
})
