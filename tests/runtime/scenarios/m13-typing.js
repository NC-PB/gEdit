// M13 typing options (plan §6 M13 WP13.4, AD-30, §7.13; the owner's answers of 2026-10-08 and -09):
// every built-in profile upper-cases the letters you type outside comments, strings and kept text
// (`editing.forceUppercase`), never lets Backspace or Delete join two blocks (`editing.preventLineJoin`),
// and asks before Convert Case writes lower case; `edit.toggleForceUppercase` switches the first for the
// session. Real key presses throughout, because the point is the keydown hook of the live editor.
//
//   A. every one of the six built-in profiles: lower-case letters in code become capitals, the same letters
//      inside a comment, a string or a kept text stay as typed (Fanuc/Okuma `( )`, Sinumerik and Klartext
//      `;`, Sinumerik `MSG("…")` and `T="…"`), and one undo takes a capital back with nothing left behind.
//   B. what is not a keystroke is not touched: `insertText` (paste and input methods) leaves lower case.
//   C. the session toggle: off -> lower case, on -> capitals; it also turns typing ON over a profile whose
//      own flag is off (a user profile), and it is not saved.
//   D. no join: Backspace in column 1 and Delete at a line end are refused with the status message when both
//      lines hold text; an empty or blank line stays deletable; selecting the line break joins.
//   E. Convert Case to lower case asks first on a built-in (Cancel keeps the text, Continue converts).

import { scenario } from '../lib/index.js'
import { context, message, newDoc, ready, runTransform, setField } from './m4-common.js'
import { revealLine } from './m3-common.js'
import { undo } from './m5-common.js'
import { reloadProfiles, userDirs } from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** What is typed (all lower case) and what the editor must hold, per built-in profile. */
const CASES = [
  { profile: 'fanuc-gcode', typed: 'n10 g1 x10. y5. f200 (rough pass) m3\n(later) t1 m6', want: 'N10 G1 X10. Y5. F200 (rough pass) M3\n(later) T1 M6', kept: 'a comment in ( )' },
  { profile: 'fanuc-lathe', typed: 'g50 s2400 (limit) m3\ng96 s200', want: 'G50 S2400 (limit) M3\nG96 S200', kept: 'a comment in ( )' },
  { profile: 'okuma-osp', typed: 'g0 x10. (move in) m3', want: 'G0 X10. (move in) M3', kept: 'a comment in ( )' },
  { profile: 'sinumerik', typed: 'g1 x10. ; side note\nmsg("hello world")\nt="rough" d1\nt2 d1', want: 'G1 X10. ; side note\nMSG("hello world")\nT="rough" D1\nT2 D1', kept: 'a ; comment, MSG("…") and T="…"' },
  { profile: 'sinumerik-mill', typed: 'g1 x10. ; side note\nmsg("hello world")', want: 'G1 X10. ; side note\nMSG("hello world")', kept: 'a ; comment and MSG("…")' },
  { profile: 'heidenhain-klartext', typed: 'l x+10 y+5 fmax ; side note m3', want: 'L X+10 Y+5 FMAX ; side note m3', kept: 'a ; comment (the whole rest of the line)' },
]

/** The lower-case letters outside the stretches a case keeps: a quick "no stray lower case" test. @param {string} text */
const lowerCount = (text) => (text.match(/[a-z]/g) ?? []).length

/** Types into the focused editor with real key presses and lets it settle. @param {Harness} h @param {string} text */
async function type(h, text) {
  h.check('the editor has the focus for the key presses', h.focusEditor())
  await h.nativeType(text)
  await h.idle()
}

/** A key press. @param {Harness} h @param {string} key @param {string[]} [mods] */
async function press(h, key, mods = []) {
  h.focusEditor()
  await h.nativeKeys([{ key, mods: /** @type {any} */ (mods) }])
  await h.idle()
}

scenario('m13-typing', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const text = (/** @type {string} */ id) => ctx.editor.getText(id).replace(/\n$/, '')

  // ============================================================ A. the six built-in profiles
  for (const c of CASES) {
    const profile = ctx.profiles.profile(c.profile)
    h.check(`${c.profile}: the profile carries both flags (AD-30)`, profile.editing?.forceUppercase === true && profile.editing?.preventLineJoin === true, profile.editing)
    const id = await newDoc(h, '', c.profile)
    await type(h, c.typed)
    h.check(`${c.profile}: letters typed in lower case become capitals in code and stay as typed in ${c.kept}`, text(id) === c.want, { got: text(id), want: c.want })
    h.check(`${c.profile}: and the only lower case left is in the kept text`, lowerCount(text(id)) === lowerCount(c.want), text(id))
    h.check(`${c.profile}: the document is dirty like after any typing`, ctx.docs.get(id)?.dirty === true)
  }

  // ---- one undo step per capital, nothing left behind
  const u = await newDoc(h, '', 'fanuc-gcode')
  await type(h, 'g')
  h.check('a typed g is a G', text(u) === 'G', text(u))
  await undo(h)
  h.check('one undo takes the capital back, with no lower-case g behind it', text(u) === '', JSON.stringify(text(u)))
  await type(h, 'g1 x2')
  await undo(h)
  h.check('an undo after a run of letters takes them as one typing group does, never leaving a lower-case copy', lowerCount(text(u)) === 0, JSON.stringify(text(u)))

  // ============================================================ B. what is not a keystroke
  const p = await newDoc(h, '', 'fanuc-gcode')
  h.focusEditor()
  await h.insertText('g1 x10.')
  await h.idle()
  h.check('text inserted as an input method or a paste would is not touched: g1 x10. stays lower case', text(p) === 'g1 x10.', text(p))

  // ============================================================ C. the session toggle
  // A user profile whose own flag is off: before any toggle it types as typed, and the toggle turns typing on.
  const { profilesDir } = userDirs(h)
  await h.disk.write(`${profilesDir}/lower-shop.json`, `${JSON.stringify({ id: 'lower-shop', name: 'Lower shop', shortName: 'LOWER', extends: 'fanuc-gcode', editing: { forceUppercase: false }, detect: { content: [] } }, null, 2)}\n`)
  await reloadProfiles(h)
  h.check('the user profile is loaded and carries forceUppercase false', ctx.profiles.get('lower-shop') !== undefined && ctx.profiles.profile('lower-shop').editing?.forceUppercase === false, ctx.profiles.profile('lower-shop')?.editing)
  const l = await newDoc(h, '', 'lower-shop')
  h.check('the toggle is a command, enabled with a document open', ctx.commands.has('edit.toggleForceUppercase') && ctx.commands.isEnabled('edit.toggleForceUppercase'))
  await type(h, 'g1')
  h.check('before any toggle a document follows its profile: this one asks for no capitals', text(l) === 'g1', text(l))
  await ctx.commands.run('edit.toggleForceUppercase')
  await h.idle()
  h.check('the toggle turns typing ON over a profile whose flag is off, and names what stays as typed', /\bon\b/i.test(message(h)) && /comments/i.test(message(h)), message(h))
  await type(h, ' x2')
  h.check('now it types capitals', text(l) === 'g1 X2', text(l))
  await ctx.commands.run('edit.toggleForceUppercase')
  await h.idle()
  h.check('the next toggle turns it off and says so', /\boff\b/i.test(message(h)), message(h))
  await type(h, ' y3')
  h.check('typed as typed again', text(l) === 'g1 X2 y3', text(l))

  // On a built-in the same switch works the other way round, for every open document.
  const t = await newDoc(h, '', 'fanuc-gcode')
  await type(h, 'g1 ')
  h.check('the switch is for the session and every document: typing is off here too', text(t) === 'g1 ', text(t))
  await ctx.commands.run('edit.toggleForceUppercase')
  await h.idle()
  await type(h, 'x2')
  h.check('switched on, a built-in profile types capitals again', text(t) === 'g1 X2', text(t))
  const state = JSON.stringify(await h.config.read('settings.json')) + JSON.stringify(await h.config.read('state.json'))
  h.check('the toggle is not saved anywhere: neither settings.json nor state.json mention it', !/forceUppercase|toggleForceUppercase/i.test(state))

  // ============================================================ D. no join of two blocks
  const j = await newDoc(h, 'N10 G1 X1.\nN20 G1 X2.\n\n   \nN30 M30\n', 'fanuc-gcode')
  const before = text(j)
  await revealLine(h, j, 2, 1)
  await press(h, 'Backspace')
  h.check('Backspace in column 1 between two blocks is refused, and the status bar says so', text(j) === before && /Not joined/.test(message(h)), { text: text(j), status: message(h) })
  await revealLine(h, j, 1, 12)
  await press(h, 'Delete')
  h.check('Delete at the end of a block is refused too', text(j) === before && /Not joined/.test(message(h)), { text: text(j), status: message(h) })
  await revealLine(h, j, 2, 5)
  await press(h, 'Backspace')
  h.check('Backspace inside a line still deletes a character', text(j).split('\n')[1] === 'N2 G1 X2.' || text(j).split('\n')[1] === 'N20G1 X2.', text(j).split('\n')[1])
  await undo(h)
  h.check('(one undo puts that character back)', text(j) === before, text(j))

  // The exception: an empty line, or one with only blanks, can be deleted.
  await revealLine(h, j, 3, 1)
  await press(h, 'Backspace')
  h.check('Backspace on an empty line deletes it', text(j).split('\n').length === before.split('\n').length - 1 && text(j).split('\n')[2] === '   ', text(j))
  await revealLine(h, j, 2, 11)
  await press(h, 'Delete')
  h.check('Delete at the end of a block above a blank line removes that line break (the blanks stay on the block)', text(j).split('\n').length === before.split('\n').length - 2 && text(j).split('\n')[2] === 'N30 M30', text(j))

  // Selecting the line break is how you delete one on purpose.
  await revealLine(h, j, 1, 12)
  await press(h, 'ArrowRight', ['shift'])
  await press(h, 'Backspace')
  h.check('with the line break selected, Backspace joins the two blocks as asked', text(j).split('\n')[0] === 'N10 G1 X1.N20 G1 X2.   ', text(j))

  // ============================================================ E. Convert Case to lower case asks first
  for (const profile of ['fanuc-gcode', 'okuma-osp']) {
    const c = await newDoc(h, 'G1 X10. (NOTE)\nM30\n', profile)
    const input = text(c)
    const running = ctx.commands.run('nc.convertCase')
    await h.waitFor(() => h.q('modal'), { timeout: 10000 })
    setField(h, 'case', 'lower case')
    await h.frame()
    h.click(h.q('modal-ok'))
    await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
    const asked = await h.alert.wait()
    h.check(`${profile}: converting to lower case asks first, naming the dialect`, !!asked && (asked.texts ?? []).join(' ').includes(ctx.profiles.profile(profile).name) && /upper case/i.test((asked.texts ?? []).join(' ')), asked)
    await h.alert.click('Cancel')
    await running
    await h.idle()
    h.check(`${profile}: Cancel leaves the program as it was`, text(c) === input && ctx.docs.get(c)?.dirty !== true, text(c))
    const done = await runTransform(h, 'nc.convertCase', { form: true, fields: { case: 'lower case' }, confirm: 'Continue' })
    h.check(`${profile}: Continue converts (the comment is left alone)`, done && text(c) === 'g1 x10. (NOTE)\nm30', text(c))
  }
  await newDoc(h, 'g1 x10. (note)\n', 'fanuc-gcode')
  const upper = await runTransform(h, 'nc.convertCase', { form: true, fields: { case: 'UPPER CASE' } })
  h.check('converting to upper case asks nothing', upper && !(await h.alert.visible()) && text(ctx.docs.getActiveId() ?? '') === 'G1 X10. (note)', text(ctx.docs.getActiveId() ?? ''))
})
