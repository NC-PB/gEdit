// The Sinumerik structure items of M9, in the running app (plan §6 M9 H9 `m9-structure`,
// WP9.3, WP9.5b): Remove Comments keeps `;$PATH=`, renumber numbers a label that starts
// with `N` (`NEXT_PECK:`) and keeps the colon of a main block (`:20`), and the program map
// shows no call for a control command (`CUT3DCC`) or a predefined procedure
// (`ORIRESET(…)`, `FGROUP(…)`, `WAITS(…)`).
//
// **These are the places where two answers about the same text used to disagree.** The
// tokenizer found `:20` as a punched-tape marker and the grammar painted it a block number;
// renumber read `NEXT_PECK:` as the block number `N` followed by a stray word and left it
// alone, but numbered `LAST_CUT:` two lines below; Remove Comments took the `;$PATH=` line,
// which the control reads as the path the program belongs to, for a comment; the map listed
// `CUT3DCC` as a subprogram call because its name ends in digits. Each check below is made
// the way a user meets it, with a command on a document, and compares text with text: the
// lines that should not change are compared byte for byte.
//
// What the checks do not retype is the program: `s03-sub.SPF` and the published drilling
// program are fixtures. The scratch programs are as short as they can be.

import { scenario } from '../lib/index.js'
import { newDoc } from './m4-common.js'
import { undo } from './m5-common.js'
import { SINUMERIK, SINUMERIK_MILL, context, mapItems, mapWithLine, openPath, openProbe, ready, runForm } from './m9-common.js'

/** The lines of the active document, without the empty one a trailing newline leaves. */
const linesOf = (/** @type {import('../lib/api.js').Harness} */ h) => h.app.text().split('\n')

scenario('m9-structure', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)

  // =============================================================== A. Remove Comments keeps ;$PATH=
  const shaft = await openPath(h, await h.fixture('nc/sinumerik/s03-sub.SPF'))
  h.check('the subprogram opens as Sinumerik', ctx.docs.get(shaft.id)?.profileId === SINUMERIK, ctx.docs.get(shaft.id)?.profileId)
  const before = linesOf(h)
  const header = before.findIndex((line) => line.startsWith(';$PATH='))
  const comment = before.findIndex((line) => line.startsWith('; WRITTEN FOR GEDIT'))
  h.check('it has both a ; comment and the ;$PATH= line the control reads as the path of the program', header > 0 && comment > 0, { header, comment })

  await runForm(h, 'nc.removeComments')
  const after = linesOf(h)
  h.check('Remove Comments keeps the ;$PATH= line, on its own line and as it was', after.includes(before[header]), after.slice(0, 6))
  h.check('and takes the ordinary ; comment', !after.some((line) => line.includes('WRITTEN FOR GEDIT')), after.slice(0, 6))
  h.check(
    'everything else is as it was, byte for byte and in order: the program lost that one line and nothing else',
    JSON.stringify(after) === JSON.stringify(before.filter((_, index) => index !== comment)),
    { before: before.length, after: after.length },
  )
  await undo(h)
  h.check('one undo gives the program back', JSON.stringify(linesOf(h)) === JSON.stringify(before), linesOf(h).length)

  const drilling = await openPath(h, await h.fixture('nc/owner-public/sinumerik-mill/DRILLING.mpf'))
  const drillingBefore = linesOf(h)
  h.check('the published drilling program opens as the milling profile', ctx.docs.get(drilling.id)?.profileId === SINUMERIK_MILL, ctx.docs.get(drilling.id)?.profileId)
  const pathLine = drillingBefore.findIndex((line) => line.startsWith(';$PATH='))
  const commentLines = drillingBefore.filter((line, index) => index !== pathLine && line.startsWith(';'))
  h.check('with a ;$PATH= header and a ; comment above every tool', pathLine === 1 && commentLines.length >= 5, { pathLine, comments: commentLines.length })
  await runForm(h, 'nc.removeComments')
  const drillingAfter = linesOf(h)
  h.check('Remove Comments keeps its ;$PATH= header as the second line', drillingAfter[1] === drillingBefore[pathLine], drillingAfter.slice(0, 4))
  h.check('no other line is a comment any more', !drillingAfter.slice(2).some((line) => line.startsWith(';')), drillingAfter.filter((line, index) => index > 1 && line.startsWith(';')).slice(0, 4))
  /** The program lines, which a comment run must not touch. */
  const code = drillingBefore.filter((line) => !line.includes(';'))
  let next = 0
  for (const line of drillingAfter) if (line === code[next]) next += 1
  h.check('and every line of code is still there, unchanged and in order', next === code.length, { kept: next, code: code.length })
  await undo(h)

  // =============================================================== B. renumber numbers NEXT_PECK:
  ctx.docs.activate(shaft.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === shaft.id, { timeout: 8000 })
  await h.idle()
  await runForm(h, 'nc.renumber')
  const renumbered = linesOf(h)
  const numbers = renumbered.flatMap((line) => {
    const found = /^N(\d+) /.exec(line)
    return found === null ? [] : [Number(found[1])]
  })
  h.check('renumber numbers every block of the subprogram in steps of ten, with no gap and no repeat', numbers.length >= 20 && numbers.every((value, index) => value === (index + 1) * 10), numbers)
  h.check('LAST_CUT: is a numbered block of its own', renumbered.some((line) => /^N\d+ LAST_CUT:$/.test(line)), renumbered.filter((line) => line.includes('LAST_CUT')))
  h.check('NEXT_PECK: too: a label that starts with N is a label, not the block number N', renumbered.some((line) => /^N\d+ NEXT_PECK:$/.test(line)), renumbered.filter((line) => line.includes('NEXT_PECK')))
  h.check(
    'the jumps that name the labels are untouched',
    renumbered.some((line) => line.endsWith('GOTOB NEXT_PECK')) && renumbered.some((line) => line.endsWith('GOTOF LAST_CUT')),
    renumbered.filter((line) => line.includes('GOTO')),
  )
  h.check('and the lines that carry no block number — the header, the PROC line, the DEF lines — are as they were', renumbered.slice(0, 6).join('\n') === before.slice(0, 6).join('\n'), renumbered.slice(0, 6))
  await undo(h)

  // =============================================================== D. the map
  const CALLS = ['%CALLS_MPF', 'N10 G17 G90', 'N20 CUT3DCC', 'N30 ORIRESET(0,0,0)', 'N40 FGROUP(X,Y,Z)', 'N50 WAITS(1)', 'N60 L10', 'N70 CYCLE81(10,0,2,-5)', 'N80 L20 (1)', 'N85 MYPROC(3)', 'N90 M30', ''].join('\n')
  const calls = await newDoc(h, CALLS, SINUMERIK_MILL)
  h.check('the scratch program is a milling program', ctx.docs.get(calls)?.profileId === SINUMERIK_MILL, ctx.docs.get(calls)?.profileId)
  const rows = await mapWithLine(h, 7)
  /** @param {number} line */
  const rowsAt = (line) => rows.filter((row) => row.line === line)
  const names = CALLS.split('\n')
  const lineOfText = (/** @type {string} */ text) => names.findIndex((line) => line.includes(text)) + 1
  h.check(
    'the subprograms and the cycle the program really calls are on the map, each once: L10, CYCLE81, L20 (1) and the user’s own MYPROC',
    ['L10', 'CYCLE81', 'L20', 'MYPROC'].every((name) => rowsAt(lineOfText(name)).length === 1 && rowsAt(lineOfText(name))[0].kind === 'subprogram-call'),
    mapItems(h),
  )
  h.check(
    'a control command with a digit in its name (CUT3DCC) and the procedures the control predefines (ORIRESET, FGROUP, WAITS) are not calls and are not on the map',
    ['CUT3DCC', 'ORIRESET', 'FGROUP', 'WAITS'].every((name) => rowsAt(lineOfText(name)).length === 0),
    mapItems(h),
  )
  h.check('%CALLS_MPF, the short form of the program header, starts the program on the map', rows.some((row) => row.kind === 'program' && row.line === 1), mapItems(h))

  // =============================================================== C. renumber keeps the colon of a main block
  const MAIN = ['%_N_MAIN_MPF', 'N5 G90 G0 X0', ':7 G1 X10 F100', 'N9 X20', ':11 X30', 'M30', ''].join('\n')
  const main = (await openProbe(h, 'MAIN.MPF', MAIN, SINUMERIK)).id
  h.check('the program with main blocks is a Sinumerik program', ctx.docs.get(main)?.profileId === SINUMERIK, ctx.docs.get(main)?.profileId)
  // The dialect guard (core/profiles/contradiction.ts) is what stood in the way here: it read
  // the `:7` line as a Fanuc tape start. A refusal is a failed check, not the end of the run.
  const ran = await runForm(h, 'nc.renumber').then(
    () => true,
    (/** @type {Error} */ error) => {
      h.check('renumber runs on a Sinumerik program that has main blocks', false, error.message)
      return false
    },
  )
  const mainLines = linesOf(h)
  h.check(
    'renumber numbers the main blocks in the same run, and a main block stays a main block: N10, :20, N30, :40',
    JSON.stringify(mainLines.slice(1, 5).map((line) => line.split(' ')[0])) === JSON.stringify(['N10', ':20', 'N30', ':40']),
    mainLines,
  )
  h.check('with the rest of each block as it was', mainLines.slice(1, 5).map((line) => line.split(' ').slice(1).join(' ')).join('|') === 'G90 G0 X0|G1 X10 F100|X20|X30', mainLines)
  if (ran) await undo(h)
  h.check('one undo gives the program back', h.app.text() === MAIN && ctx.docs.get(main)?.profileId === SINUMERIK, h.app.text())

  h.check('no file on disk was left changed', ctx.docs.all().filter((doc) => doc.path !== null).every((doc) => !doc.dirty), ctx.docs.all().map((doc) => `${doc.title}:${doc.dirty}`))
})
