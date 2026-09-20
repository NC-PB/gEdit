// The code assistant (plan §5 M3 H3 `m3-assistant`, WP3.6): the hover explains a code, an
// address and a variable, the completion offers the dialect's codes and stays out of a
// comment, and the two `assist.*` settings really switch them off.
//
// Everything is driven through `ctx.editor`, so the scenario needs no key presses and
// survives a screen another app owns. Two Monaco habits shape every read (WP3.6 §6):
//   - `editor.action.showHover` only *focuses* a hover that is already up, so a second
//     reading needs `hideHover` first;
//   - both widgets keep their last DOM after being hidden, so a reader waits for the
//     contents to *change* and reports "unchanged" as "there is nothing here".
//
// The one thing that is not obvious from the plan: inside a comment an explicit
// Ctrl+Space still answers, with Monaco's own word-based suggestions
// (`wordBasedSuggestions: 'currentDocument'`, WP2.6). That is deliberate and is not the
// code database, so the checks below count database rows, which `suggestAt` tells apart
// by the row's icon (mergeB §4.3).

import { scenario } from '../lib/index.js'
import { context, hoverAt, revealLine, suggestAt, suggestShowing } from './m3-common.js'

/** A Fanuc program with one line per question the hover and the completion must answer. */
const FANUC = [
  '%',
  'O3000 (ASSISTANT)',
  'N10 G83 X10. Y20. Z-5. R2. Q1. F100',
  'N20 M8',
  'N30 #101=5',
  'N40 G12',
  'N50 G8',
  'N60 (TOOL 1 - 10MM G8)',
  'N70 G83',
  'N80 G9',
  'N90G0G90X0Y0',
  'M30',
  '%',
].join('\n')

/** The same for Klartext, where a block starts with its number and a keyword. */
const KLARTEXT = ['0 BEGIN PGM ASSIST MM', '1 TOOL CALL 1 Z S3000 F800', '2 L Z+100 R0 FMAX M3', '3 CYCL', '4 END PGM ASSIST MM'].join('\n')

const field = (/** @type {any} */ h, /** @type {string} */ id) => h.q('form-field', { field: id })
const control = (/** @type {any} */ h, /** @type {string} */ id) => /** @type {HTMLInputElement | null} */ (field(h, id)?.querySelector('input') ?? null)

/** The labels the suggest widget currently shows, database rows only. */
const suggestLabels = () =>
  [...document.querySelectorAll('.suggest-widget .monaco-list-row')]
    .filter((row) => [...(row.querySelector('.suggest-icon')?.classList ?? [])].some((c) => /^codicon-symbol-(function|snippet|keyword)$/.test(c)))
    .map((row) => (row.querySelector('.label-name')?.textContent ?? '').trim())

scenario('m3-assistant', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })

  const fanucId = ctx.files.newUntitled({ profileId: 'fanuc-gcode', text: FANUC })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === fanucId, { timeout: 15000 })
  await revealLine(h, fanucId, 1, 1)
  h.check('the scratch buffer carries the Fanuc profile', ctx.docs.get(fanucId)?.profileId === 'fanuc-gcode', ctx.docs.get(fanucId)?.profileId)

  // ------------------------------------------------------------ hover: a code
  const g83 = await hoverAt(h, fanucId, 3, 6)
  h.check('hover on G83 names the code and its label', g83.includes('G83') && g83.includes('Peck drilling cycle'), g83)
  h.check('hover on G83 explains what it does', g83.includes('chips clear'), g83)
  h.check('hover on G83 shows the group and that it is modal', g83.includes('Cycle') && g83.includes('modal'), g83)
  h.check('hover on G83 lists the words the cycle needs', /Required:\s*Z,\s*R,\s*Q,\s*F/.test(g83), g83)
  h.check('the hover is rendered markdown, not its source', !g83.includes('**') && !g83.includes('\\.') && !g83.includes('_Cycle'), g83)

  const m8 = await hoverAt(h, fanucId, 4, 6)
  h.check('hover on M8 says the coolant goes on', m8.includes('M8') && m8.includes('Coolant on'), m8)
  h.check('hover on M8 is the coolant group, not the cycle group', m8.includes('Coolant') && !m8.includes('Peck'), m8)

  // ------------------------------------------------------------ hover: an address, a variable, an unknown code
  const x = await hoverAt(h, fanucId, 3, 10)
  h.check('hover on X10. explains the address', x.includes('X') && x.includes('X axis'), x)

  const variable = await hoverAt(h, fanucId, 5, 6)
  h.check('hover on #101 gives its kind and no value', variable.includes('Variable') && variable.includes('Only the control knows the value'), variable)
  h.check('hover on #101 invents no number for it', !/=\s*5/.test(variable) && !variable.includes('Peck'), variable)

  const unknown = await hoverAt(h, fanucId, 6, 6)
  h.check('a code the database does not carry is shown as not described', unknown.includes('G12') && unknown.includes('does not describe this word yet'), unknown)

  const inComment = await hoverAt(h, fanucId, 8, 8)
  h.check('no hover inside a ( ) comment', inComment === '', inComment)

  // ------------------------------------------------------------ completion
  const g8 = await suggestAt(h, fanucId, 7, 7)
  const labels = g8.db.map((row) => row.label)
  h.check('the suggest widget is drawn', g8.showing && g8.db.length > 0, g8.rows)
  h.check('G8 offers G80 to G89 from the database', g8.db.length === 10 && labels.every((label) => /^G8\d$/.test(label)), labels)
  h.check('G81 is among them (the plan names it)', labels.includes('G81'), labels)
  h.check('every code is offered once: nothing registers a second provider', new Set(labels).size === labels.length, labels)
  h.check('a suggestion carries the label from the database', g8.rows.some((row) => row.text.includes('Peck drilling cycle')), g8.rows.map((r) => r.text))
  // The snippet icon is a promise that accepting the item leaves tab stops to fill in,
  // so it follows the insert text and not the group: G81 to G89 carry Z/R/F (and Q), and
  // G80 only cancels the cycle, so it inserts the bare code and is drawn like one.
  /** @param {string} code */
  const iconOf = (code) => g8.db.find((row) => row.label === code)?.icon
  const expanding = g8.db.filter((row) => row.label !== 'G80')
  h.check(
    'a cycle with words to fill in is offered as a snippet',
    expanding.length === 9 && expanding.every((row) => row.icon === 'symbol-snippet'),
    expanding.map((r) => `${r.label}:${r.icon}`),
  )
  h.check('G80 has nothing to fill in and is not drawn as a snippet', iconOf('G80') === 'symbol-function', iconOf('G80'))

  // G9x are modes rather than cycles, so they insert the bare code and carry the plain
  // code icon: the two kinds really are told apart.
  const g9 = await suggestAt(h, fanucId, 10, 7)
  h.check('a mode code is offered as a plain code, not as a snippet', g9.db.length > 0 && g9.db.every((row) => row.icon === 'symbol-function'), g9.db.map((r) => `${r.label}:${r.icon}`))
  h.check('G9 offers the distance, feed and spindle modes', g9.db.map((r) => r.label).includes('G90') && g9.db.map((r) => r.label).includes('G95'), g9.db.map((r) => r.label))

  // A packed block is the case WP3.6 §5.2 asked for: the language configuration's
  // `wordPattern` decides what Monaco calls "the word under the cursor", and a pattern
  // that swallowed `N90G0G90X0Y0G8` whole would look nothing up. Typing also proves the
  // widget opens **by itself** on `assist.completion: auto`, with no Ctrl+Space.
  const packedLine = 'N90G0G90X0Y0'
  await revealLine(h, fanucId, 11, packedLine.length + 1)
  ctx.editor.triggerAction('hideSuggestWidget')
  await h.idle()
  h.check('the editor has the focus for typing', h.focusEditor())
  await h.nativeType('G8')
  const popped = await h.waitFor(() => suggestShowing() && document.querySelectorAll('.suggest-widget .monaco-list-row').length > 0, { timeout: 3000 })
  const packedRows = suggestLabels()
  h.check('typing opens the suggestions on its own, without Ctrl+Space', !!popped, { rows: packedRows, line: ctx.editor.getLines(fanucId, 11, 11)[0] })
  // While a word grows under the cursor Monaco re-filters the list it already has instead
  // of asking the provider again, and its filter is fuzzy — so after typing `G`, then `8`,
  // `G18` and `G28` can still be in the list beside G80 to G89. What matters here is that
  // the list is not *empty*: a `wordPattern` that swallowed the whole packed block would
  // filter every item away.
  h.check('a packed block does not filter the suggestions away', packedRows.length > 0 && ['G80', 'G83', 'G89'].every((code) => packedRows.includes(code)) && packedRows.every((label) => /^G\d/.test(label)), {
    rows: packedRows,
    line: ctx.editor.getLines(fanucId, 11, 11)[0],
  })
  ctx.editor.triggerAction('hideSuggestWidget')
  await h.idle()
  // Asking again queries the provider afresh with the word as it stands now, so this one
  // is exact: the word under the cursor is the `G8` at the end, not `N90G0G90X0Y0G8`.
  const packedFresh = await suggestAt(h, fanucId, 11, packedLine.length + 3)
  const packedFreshLabels = packedFresh.db.map((row) => row.label)
  h.check('the word under the cursor in a packed block is the G8 at its end', packedFreshLabels.length === 10 && packedFreshLabels.every((label) => /^G8\d$/.test(label)), {
    rows: packedFreshLabels,
    line: ctx.editor.getLines(fanucId, 11, 11)[0],
  })
  ctx.editor.triggerAction('undo')
  await h.waitFor(() => (ctx.editor.getLines(fanucId, 11, 11)[0] ?? '') === packedLine, { timeout: 3000 })

  const commentSuggest = await suggestAt(h, fanucId, 8, 22)
  h.check('the code database offers nothing inside a comment', commentSuggest.db.length === 0, commentSuggest.rows)
  h.check(
    'what is left there is word-based only, which is WP2.6 and not the database',
    commentSuggest.rows.every((row) => row.icon === 'symbol-text' || row.icon === ''),
    commentSuggest.rows,
  )

  // Accepting a cycle writes its required words, so the tab stops are real rather than
  // only a flag on the item.
  await revealLine(h, fanucId, 9, 8)
  ctx.editor.triggerAction('editor.action.triggerSuggest')
  await h.waitFor(() => suggestShowing() && document.querySelectorAll('.suggest-widget .monaco-list-row').length > 0, { timeout: 2500 })
  ctx.editor.triggerAction('acceptSelectedSuggestion')
  await h.waitFor(() => (ctx.editor.getLines(fanucId, 9, 9)[0] ?? '') !== 'N70 G83', { timeout: 3000 })
  const inserted = ctx.editor.getLines(fanucId, 9, 9)[0] ?? ''
  h.check('accepting the G83 suggestion inserts the cycle with its required words', /G83\s+Z\s*R\s*Q\s*F/.test(inserted.replace(/\s+/g, ' ')), inserted)
  ctx.editor.triggerAction('undo')
  await h.waitFor(() => (ctx.editor.getLines(fanucId, 9, 9)[0] ?? '') === 'N70 G83', { timeout: 3000 })

  // ------------------------------------------------------------ the other dialect
  const klartextId = ctx.files.newUntitled({ profileId: 'heidenhain-klartext', text: KLARTEXT })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === klartextId, { timeout: 15000 })
  await revealLine(h, klartextId, 1, 1)

  const fmax = await hoverAt(h, klartextId, 3, 15)
  h.check('hover answers in Klartext too (FMAX)', fmax.includes('FMAX') && fmax.includes('Rapid'), fmax)
  h.check('the Klartext hover is the Klartext database, not the Fanuc one', fmax.includes('Feed mode') && !fmax.includes('Coolant'), fmax)

  const toolCall = await hoverAt(h, klartextId, 2, 4)
  h.check('hover reads a keyword made of two words (TOOL CALL)', toolCall.includes('TOOL CALL') && toolCall.includes('Tool call'), toolCall)

  const klartextSuggest = await suggestAt(h, klartextId, 4, 7)
  const klartextLabels = klartextSuggest.db.map((row) => row.label)
  h.check('a Klartext block start offers the dialect keywords', klartextSuggest.db.length > 0 && klartextLabels.some((label) => label.startsWith('CYCL DEF')), klartextLabels.slice(0, 12))
  h.check('none of them is a Fanuc code', !klartextLabels.some((label) => /^G\d/.test(label)), klartextLabels.slice(0, 12))

  // ------------------------------------------------------------ assist.hover, through the dialog
  // The providers read the setting on every call and `editorOptions.ts` also maps it onto
  // the editor, so both halves are exercised by turning it off in the real dialog.
  void ctx.commands.run('settings.open')
  await h.waitFor(() => !!h.q('modal', { modal: 'settings' }), { timeout: 5000 })
  h.click(h.q('settings-category', { category: 'assistance' }))
  await h.waitFor(() => !!h.q('settings-page', { category: 'assistance' }), { timeout: 3000 })
  const hoverBox = control(h, 'assist.hover')
  h.check('the Assistance page offers the hover switch and the completion mode', !!hoverBox && !!field(h, 'assist.completion'), h.qa('form-field').map((e) => e.dataset.field))
  if (hoverBox) {
    hoverBox.checked = false
    hoverBox.dispatchEvent(new Event('change', { bubbles: true }))
  }
  h.click(h.q('modal-ok'))
  await h.waitFor(() => !h.q('modal', { modal: 'settings' }) && ctx.settings.get('assist.hover') === false, { timeout: 5000 })
  h.check('the dialog turned assist.hover off', ctx.settings.get('assist.hover') === false)

  await revealLine(h, fanucId, 1, 1)
  h.click(h.q('doc-tab', { docId: fanucId }))
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === fanucId, { timeout: 8000 })
  const silenced = await hoverAt(h, fanucId, 3, 6)
  h.check('with assist.hover off, G83 answers nothing', silenced === '', silenced)

  await ctx.settings.save({ 'assist.hover': true })
  await h.waitFor(() => ctx.settings.get('assist.hover') === true, { timeout: 5000 })
  const back = await hoverAt(h, fanucId, 3, 6)
  h.check('turning it back on brings the hover back with no reload', back.includes('Peck drilling cycle'), back)

  // ------------------------------------------------------------ assist.completion
  await ctx.settings.save({ 'assist.completion': 'off' })
  await h.waitFor(() => ctx.settings.get('assist.completion') === 'off', { timeout: 5000 })
  const offSuggest = await suggestAt(h, fanucId, 7, 7)
  h.check('with assist.completion off nothing is suggested at all', offSuggest.rows.length === 0 && !offSuggest.showing, offSuggest.rows)

  // `manual` is the middle setting: nothing pops up while typing, Ctrl+Space still works.
  await ctx.settings.save({ 'assist.completion': 'manual' })
  await h.waitFor(() => ctx.settings.get('assist.completion') === 'manual', { timeout: 5000 })
  await revealLine(h, fanucId, 11, packedLine.length + 1)
  ctx.editor.triggerAction('hideSuggestWidget')
  await h.idle()
  h.focusEditor()
  await h.nativeType('G8')
  await h.waitFor(() => (ctx.editor.getLines(fanucId, 11, 11)[0] ?? '') === `${packedLine}G8`, { timeout: 3000 })
  await h.idle({ quiet: 400 })
  h.check('on manual, typing opens nothing by itself', !suggestShowing(), { rows: suggestLabels(), line: ctx.editor.getLines(fanucId, 11, 11)[0] })
  ctx.editor.triggerAction('editor.action.triggerSuggest')
  const manual = await h.waitFor(() => (suggestShowing() && suggestLabels().length > 0 ? suggestLabels() : undefined), { timeout: 3000 })
  h.check('but Ctrl+Space still answers from the database', (manual ?? []).length === 10 && (manual ?? []).every((label) => /^G8\d$/.test(label)), manual)
  ctx.editor.triggerAction('hideSuggestWidget')
  ctx.editor.triggerAction('undo')
  await h.waitFor(() => (ctx.editor.getLines(fanucId, 11, 11)[0] ?? '') === packedLine, { timeout: 3000 })

  await ctx.settings.save({ 'assist.completion': 'auto' })
  await h.waitFor(() => ctx.settings.get('assist.completion') === 'auto', { timeout: 5000 })
  const onAgain = await suggestAt(h, fanucId, 7, 7)
  h.check('back on auto, the database answers again', onAgain.db.length === 10, onAgain.db.map((r) => r.label))
  h.check(
    'no file on disk was touched: everything ran in untitled buffers',
    ctx.docs.all().filter((d) => d.path !== null).length === 0 || ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty),
    ctx.docs.all().map((d) => `${d.title}:${d.dirty}`),
  )
})
