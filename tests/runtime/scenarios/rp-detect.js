// The detection findings of M12.5 in the running app (plan §6 M12.5, WP-RP1, WP-RP3): three
// shapes of programs that were read as the wrong dialect before, each as a synthetic
// program written for gEdit, opened through the file dialog like any other file.
//
//   - an Okuma lathe program without the `$NAME.MIN%` header, hundreds of modal lines (read as
//     the Fanuc lathe: F1);
//   - a Siemens milling program without a header (scored 0 on its `Y` lines: F2);
//   - a five-axis Fanuc mill with four-digit tools and a pre-selected next tool (read as a
//     lathe: F3);
//   - a Siemens program whose first line is `;%_N_SHAFT_12_MPF`: the header of a Sinumerik file
//     as some posts write it, decisive for detection and a program item on the map (F13);
//   - an Okuma program with a lone `G13` / `G140` in the first lines (a certain marker).
//
// None of them may be flagged uncertain: each carries evidence of one dialect. The programs
// are generated here (the same shapes `detectRp.test.ts` pins in unit tests, so the running
// app is shown to agree with the pure function).

import { scenario } from '../lib/index.js'
import { context, openPath, ready } from './m9-common.js'
import { OKUMA, SINUMERIK, SINUMERIK_MILL, FANUC_LATHE, FANUC_MILL } from './m9-common.js'

/** `count` lines made by `line(number, index)`, numbered from `first` in steps of 10. */
const numbered = (/** @type {number} */ first, /** @type {number} */ count, /** @type {(n: number, i: number) => string} */ line) => Array.from({ length: count }, (_, i) => line(first + i * 10, i))

const OKUMA_NO_HEADER = [
  'N10 G140',
  'N20 G0 X400 Z300',
  'N30 G50 S2000',
  'N40 T010101',
  'N50 G96 S180 M3',
  'N60 SB=1500 M13',
  ...numbered(70, 300, (n, i) => `N${n} X${(50.1 - i * 0.1).toFixed(1)} Z-0.2`),
  'N9990 M2',
  '',
].join('\n')

const SIEMENS_MILL_NO_HEADER = [
  '; demo part, no header',
  'WORKPIECE(,,,"BOX",112,0,-50,-80,-60,60,60,-60)',
  'T="MILL10" M6',
  'CYCLE800(1,"TC1",200000,27,0,0,0,0,0,0,0,0,0,1,,0)',
  ...numbered(10, 300, (n, i) => `N${n} G1 X${i % 40} Y${(i * 3) % 50} Z-1 F500`),
  'M30',
  '',
].join('\n')

const FIVE_AXIS_MILL = [
  '%',
  'O1000 (FIVE AXIS)',
  'N10 G90 G17',
  'N20 T1205 T1310 M6',
  'N30 T1310',
  'N40 G43.4 H1205',
  ...numbered(50, 300, (n, i) => `N${n} X${i % 30}. Y${(i * 2) % 40}. Z-1. A0 C${i % 360}.`),
  'N9990 M30',
  '%',
  '',
].join('\n')

const SIEMENS_HEADER = [
  ';%_N_SHAFT_12_MPF',
  ';$PATH=/_N_MPF_DIR',
  'N10 G18 G90 G95',
  'N20 T1 D1',
  'N30 G96 S200 M3',
  'N40 G0 X52 Z2',
  'N50 G1 Z-20 F0.2',
  'N60 X60',
  'N70 G0 X100 Z100',
  'N80 M30',
  '',
].join('\n')

/** @type {[string, string, string, string][]} name, text, profile, the finding */
const CASES = [
  ['NOHEADER.MIN', OKUMA_NO_HEADER, OKUMA, 'an Okuma lathe program with no header (F1)'],
  ['NOHEADER.MPF', SIEMENS_MILL_NO_HEADER, SINUMERIK_MILL, 'a Siemens milling program with no header (F2)'],
  ['FIVEAXIS.NC', FIVE_AXIS_MILL, FANUC_MILL, 'a five-axis Fanuc mill with four-digit tools (F3)'],
  ['SHAFT_12.MPF', SIEMENS_HEADER, SINUMERIK, 'a Siemens program with a ;%_N_ header (F13)'],
]

scenario('rp-detect', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const profileItem = () => h.q('status-item', { item: 'profile' })

  for (const [name, text, want, about] of CASES) {
    const path = `${h.cfg.run}/${name}`
    await h.disk.write(path, text)
    const doc = await openPath(h, path)
    await h.idle()
    h.check(`${about} opens as ${want}`, ctx.docs.get(doc.id)?.profileId === want, ctx.docs.get(doc.id)?.profileId)
    h.check('and is not flagged uncertain: no mark on the item, no flag on the document', ctx.docs.get(doc.id)?.dialectUncertain !== true && profileItem()?.dataset.uncertain === undefined && !(profileItem()?.textContent ?? '').includes('?'), {
      flag: ctx.docs.get(doc.id)?.dialectUncertain,
      item: profileItem()?.textContent,
    })
  }

  // F13: the header is a program item on the map.
  const shaft = ctx.docs.byPath(`${h.cfg.run}/SHAFT_12.MPF`)
  if (shaft !== undefined) {
    ctx.docs.activate(shaft.id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === shaft.id, { timeout: 8000 })
    await h.waitFor(() => h.qa('program-map-item').some((e) => e.dataset.kind === 'program'), { timeout: 15000 })
    const program = h.qa('program-map-item').find((e) => e.dataset.kind === 'program')
    h.check('the ;%_N_SHAFT_12_MPF line is the program item of the map, on line 1', program?.dataset.line === '1', program?.dataset)
  }

  // The committed short Okuma file without a header, and the three uncertain shapes' lathe guess is not Okuma.
  const o07 = await openPath(h, await h.fixture('nc/okuma/o07-no-header.MIN'))
  h.check('the committed short Okuma file without a header opens as Okuma', ctx.docs.get(o07.id)?.profileId === OKUMA, ctx.docs.get(o07.id)?.profileId)
  const dollar = await openPath(h, await h.fixture('nc/uncertain/u03-dollar-comments.iso'))
  h.check('a %1 / $-comment ISO program is not taken for Okuma (F14)', ctx.docs.get(dollar.id)?.profileId !== OKUMA && ctx.docs.get(dollar.id)?.profileId === FANUC_LATHE, ctx.docs.get(dollar.id)?.profileId)
})
