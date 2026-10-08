// The older tilt cycle, `CYCL DEF 19`, as the interpreter a script gets reads it (plan §6 M12.5,
// decision 6; WP-RP4): the manual ends the tilt by defining the cycle once with every angle at 0
// and once more with NO angle at all. A `19.1` sub-block that writes no angle at all therefore
// closes the tilt; `19.0` only names the cycle and changes nothing; a `19.1` with an angle keeps
// the tilt open (angles it leaves out keep their value, so `B+20` alone does not close an `A+0`).
//
// **The thing asked is the frame the modal interpreter reports after each line**, through a
// small user script (the same `gedit_nc.ModalInterpreter` the bundled scripts use, on the
// effective profile and codes of the document). The expected frames are written out from the
// program below. The program is synthetic, in our own words.

import { scenario } from '../lib/index.js'
import { KLARTEXT, context, openProbe, ready, reportRows, runScript, writeUserScript } from './m9-common.js'

const PROGRAM = [
  '0 BEGIN PGM TILT MM',
  '1 BLK FORM 0.1 Z X+0 Y+0 Z-20',
  '2 BLK FORM 0.2 X+100 Y+100 Z+0',
  '3 TOOL CALL 1 Z S3000',
  '4 CYCL DEF 19.0 WORKING PLANE',
  '5 CYCL DEF 19.1 A+0 B+30 C+0',
  '6 L X+0 Y+0 R0 FMAX',
  '7 CYCL DEF 19.0 WORKING PLANE',
  '8 CYCL DEF 19.1',
  '9 L X+10 Y+10 R0 FMAX',
  '10 CYCL DEF 19.0 WORKING PLANE',
  '11 CYCL DEF 19.1 B+20',
  '12 CYCL DEF 19.1 A+0',
  '13 CYCL DEF 19.0 WORKING PLANE',
  '14 L Z+50 R0 FMAX',
  '15 CYCL DEF 19.1 A+0 B+0 C+0',
  '16 L Z+60 R0 FMAX',
  '17 END PGM TILT MM',
  '',
].join('\n')

/** The tilt open after each line (1-based; the program's statement N is line N + 1, the last line is blank): `-` for none. */
const OPEN = 'CYCL DEF 19'
const WANT = [
  '-', '-', '-', '-', // 1-4: BEGIN PGM, the blank form, the tool call
  '-', // 5: 19.0 only names the cycle
  OPEN, OPEN, // 6-7: 19.1 with an angle other than 0
  OPEN, // 8: 19.0 changes nothing
  '-', '-', // 9-10: 19.1 with no angle at all closes it
  '-', // 11: 19.0 changes nothing
  OPEN, // 12: B+20
  OPEN, // 13: A+0 alone does not close a tilt whose B is still 20
  OPEN, OPEN, // 14-15
  '-', '-', '-', '-', // 16-19: every angle 0 closes it
]

const FRAME_WALK = `# /// gedit
# name = "Harness frame walk"
# description = "Reports the open frame after every line."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H-RP). Not a bundled script."""

import gedit_nc

context = gedit_nc.load_context()
cp = gedit_nc.compile_profile(context.get("profile") or {})
interp = gedit_nc.ModalInterpreter(cp, context.get("codes") or [])
state = None
rows = []
for number, line in enumerate(gedit_nc.read_input(), 1):
    tokens, state = gedit_nc.tokenize_line(line, cp, state)
    interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
    frame = interp.state["frame"]
    rows.append({"at": str(number), "frame": frame["code"] if frame is not None else "-"})

gedit_nc.report("Frame walk", [{"key": "at", "label": "Line"}, {"key": "frame", "label": "Frame"}], rows)
`

scenario('rp-cycl19', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const walk = await writeUserScript(h, 'rh_frame_walk.py', FRAME_WALK)
  const doc = await openProbe(h, 'TILT.H', PROGRAM, KLARTEXT)
  h.check('the program is a Klartext program', ctx.docs.get(doc.id)?.profileId === KLARTEXT, ctx.docs.get(doc.id)?.profileId)
  await runScript(h, walk)
  await h.waitFor(() => h.qa('results-row').length >= WANT.length, { timeout: 30000 })
  const got = reportRows(h, ['at', 'frame']).map((row) => row.split('|')).sort((a, b) => Number(a[0]) - Number(b[0]))
  h.check(`the walk reports ${WANT.length} lines`, got.length === WANT.length, got.length)
  for (const [i, want] of WANT.entries()) {
    const text = ctx.editor.getLines(doc.id, i + 1, i + 1)[0] ?? ''
    h.check(`after line ${i + 1} (${text}) the tilt is ${want === '-' ? 'closed' : 'open'}`, got[i]?.[1] === want, { got: got[i], want })
  }
})
