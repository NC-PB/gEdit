// The hover in context (Phase 3 plan H3a `p3-hover`; X14 and the hover half of X11 (c)):
//
//   A. `l01-turning-a.nc`, no machine. A cycle word shows a table of its parameters with the values of its
//      block (`G76` in two blocks, 1 of 2 and 2 of 2); an address word shows one context line, the last
//      paragraph, after the Phase 2 text, which is unchanged (target/diameter/absolute, `U` incremental X, `F`
//      per revolution (G99) and thread lead (G76), `S` surface speed with its clamp and its line, the speed
//      limit of G50).
//   B. The other built-in profiles' fixtures: a Klartext cycle definition over nine lines (the table, the call
//      `M99` that names the definition's line, a parameter's meaning, an incremental `IY`), Sinumerik `CYCLE83`
//      by position, an Okuma thread cycle with the lead and its readings, the mill's `G83`, a position under a
//      modal cycle, `F` per minute.
//   C. X11 (c), the hover half, on a short lathe program: `X50` under no machine lists the readings (the
//      assumed default first) and says to choose a machine, under "Lathe IS-B" says 0.05 mm with the rule and
//      the machine, under "Lathe calc" 50 mm; `X50.` (a point) has no value line; on Okuma the same list for a
//      word with a point. `G94` is a feed mode under a system-B machine and a facing pass under system A.
//   D. Nothing stale. After an edit that changes the feed mode, the hover never says the old one: it says the
//      Phase 2 text only, or the new context.
//
// The wording is `ctx.t(...)`; the numbers and the written values come from the programs, read back from the
// document text or taken from the plan.

import { scenario } from '../lib/index.js'
import { machineMaker } from './m10-common.js'
import { ready } from './m4-common.js'
import { openProbe } from './m9-common.js'
import { context, hoverOn, L01, openFixture, plain } from './p3-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** @param {ReturnType<typeof context>} ctx @param {string} key @param {Record<string, string | number>} [params] */
const t = (ctx, key, params) => ctx.t(`assistant.context.${key}`, params)

scenario('p3-hover', { timeout: 600 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const say = (/** @type {string} */ key, /** @type {Record<string, string | number>} */ params) => t(ctx, key, params)

  // ============================================================ A. the lathe fixture, no machine
  const { id } = await openFixture(h, L01)
  h.check('l01-turning-a.nc opens as a Fanuc lathe program', ctx.docs.get(id)?.profileId === 'fanuc-lathe', ctx.docs.get(id)?.profileId)
  await ctx.modal.whenReady(id)

  const g76a = await hoverOn(h, id, 32, 'G76')
  h.check('G76 (line 32): the Phase 2 text comes first, unchanged, and the cycle table follows', g76a.paragraphs[0].startsWith('G76 —') && g76a.rows.length > 0 && g76a.html.indexOf('<table') > g76a.html.indexOf('</strong> — '), g76a.paragraphs[0])
  h.check('the table is headed "Parameters of G76, block 1 of 2"', g76a.heading === say('table.withPart', { title: say('table.title', { code: 'G76' }), part: say('table.part', { index: 1, of: 2 }) }), g76a.heading)
  const word = (/** @type {typeof g76a} */ hover, /** @type {string} */ w) => hover.rows.find((r) => r.word === w)
  h.check('block 1 shows the values of its block: P 020060, Q 80, R 0.03, and X, Z, F as not written', word(g76a, 'P')?.written === '020060' && word(g76a, 'Q')?.written === '80' && word(g76a, 'R')?.written === '0.03' && ['X', 'Z', 'F'].every((w) => word(g76a, w)?.notWritten === true && word(g76a, w)?.written === say('table.notWritten')), g76a.rows.map((r) => `${r.word}=${r.written}`))
  h.check('the columns are Word, Meaning, Written', plain(document.querySelector('.monaco-hover .hover-contents thead')?.textContent).replace(/\s+/g, ' ').trim() === [say('table.word'), say('table.meaning'), say('table.written')].join(' '), plain(document.querySelector('.monaco-hover .hover-contents thead')?.textContent))
  const g76b = await hoverOn(h, id, 33, 'G76')
  h.check('G76 (line 33): block 2 of 2 with X 18.16, Z -18., P 920, Q 250, F 1.5 and R not written', g76b.heading === say('table.withPart', { title: say('table.title', { code: 'G76' }), part: say('table.part', { index: 2, of: 2 }) }) && word(g76b, 'X')?.written === '18.16' && word(g76b, 'Z')?.written === '-18.' && word(g76b, 'P')?.written === '920' && word(g76b, 'Q')?.written === '250' && word(g76b, 'F')?.written === '1.5' && word(g76b, 'R')?.notWritten === true, g76b.rows.map((r) => `${r.word}=${r.written}`))
  const g71 = await hoverOn(h, id, 15, 'G71')
  h.check('G71 (line 15) is the first of its two blocks, with U 2. and R 0.5', g71.heading.endsWith(say('table.part', { index: 1, of: 2 })) && word(g71, 'U')?.written === '2.' && word(g71, 'R')?.written === '0.5', g71.rows.map((r) => `${r.word}=${r.written}`))

  const x = await hoverOn(h, id, 14, 'X32.')
  h.check('X32. (line 14): the Phase 2 explanation first, the context line last: target, diameter, absolute', x.paragraphs[0].startsWith('X —') && x.paragraphs[0].includes('X axis') && x.last.startsWith('X — ') && x.last.includes(say('target')) && x.last.includes(say('diameter')) && x.last.includes(say('absolute')), x.paragraphs)
  h.check('and the diameter is marked as assumed from the profile default (no program or machine says it)', x.last.includes(say('assumed', { source: say('source.profile') })), x.last)
  const f12 = await hoverOn(h, id, 18, 'F0.12')
  h.check('F0.12 (line 18) is a feed per revolution, set by G99', f12.last === `F — ${say('withCode', { what: say('feedPerRev'), code: 'G99' })}`, f12.last)
  const lead = await hoverOn(h, id, 33, 'F1.5')
  h.check('F1.5 under G76 (line 33) is a thread lead (G76)', lead.last === `F — ${say('lead', { code: 'G76' })}`, lead.last)
  const lead92 = await hoverOn(h, id, 35, 'F1.5')
  h.check('F1.5 under G92 (line 35) is a thread lead (G92)', lead92.last === `F — ${say('lead', { code: 'G92' })}`, lead92.last)
  const s220 = await hoverOn(h, id, 12, 'S220')
  h.check('S220 (line 12) is a surface speed (G96) with the clamp of line 11', s220.last === `S — ${say('withCode', { what: say('surfaceSpeed'), code: 'G96' })}, ${say('clamp', { value: '2500', line: 11 })}`, s220.last)
  const s2500 = await hoverOn(h, id, 11, 'S2500')
  h.check('S2500 beside G50 (line 11) is a speed limit, not a speed', s2500.last === `S — ${say('speedLimitBy', { code: 'G50' })}`, s2500.last)
  const g83 = await hoverOn(h, id, 50, 'G83')
  h.check('G83 (line 50): the drilling cycle table with Z -15., R 2., Q 3000 and F 0.08', word(g83, 'Z')?.written === '-15.' && word(g83, 'R')?.written === '2.' && word(g83, 'Q')?.written === '3000' && word(g83, 'F')?.written === '0.08', g83.rows.map((r) => `${r.word}=${r.written}`))
  const q = await hoverOn(h, id, 50, 'Q3000')
  h.check('Q3000 in it depends on the machine (microns on the source controls): readings, the default first, and "choose a machine"', q.paragraphs.some((p) => p === say('value.readings', { word: 'Q3000' })) && q.items.length === 3 && q.items[0].startsWith('3 mm:') && /^0\.3 mm:/.test(q.items[2]), { paragraphs: q.paragraphs.slice(-2), items: q.items })
  const comment = await hoverOn(h, id, 10, 'T0101')
  h.check('T0101 (line 10): a word that is not a position gets no "target" line', !comment.last.includes(say('target')), comment.last)

  // ============================================================ B. the other built-in profiles
  const k = await openFixture(h, 'nc/heidenhain/h04-cycle-feeds.h')
  await ctx.modal.whenReady(k.id)
  const klartext = ctx.editor.getText(k.id).split('\n')
  // The definition at line 7 spans nine lines (the `~` continues a block): what its Q words say is in the text.
  const written = (/** @type {number} */ first, /** @type {number} */ last) => {
    /** @type {Record<string, string>} */
    const out = {}
    for (const line of klartext.slice(first - 1, last)) {
      const m = /\b(Q\d+)\s*=\s*([^\s;~]+)/.exec(line)
      if (m) out[m[1]] = m[2]
    }
    return out
  }
  const def1 = await hoverOn(h, k.id, 7, 'CYCL DEF 200')
  const want1 = written(7, 16)
  h.check('Klartext: CYCL DEF 200 (line 7) shows a table with the nine Q words of its block, over nine lines', def1.rows.length === 9 && Object.keys(want1).length === 9 && Object.entries(want1).every(([w, v]) => def1.rows.find((r) => r.word === w)?.written === v), { rows: def1.rows.map((r) => `${r.word}=${r.written}`), want: want1 })
  h.check('and its heading names the cycle', def1.heading === say('table.title', { code: 'CYCL DEF 200' }), def1.heading)
  const q201 = await hoverOn(h, k.id, 9, 'Q201')
  h.check('Q201 (line 9) is said by its meaning in the cycle: "Q201 — Depth, negative into the material (CYCL DEF 200)"', q201.last === `Q201 — ${say('param', { label: 'Depth, negative into the material', code: 'CYCL DEF 200' })}`, q201.last)
  const call = await hoverOn(h, k.id, 17, 'M99')
  h.check('M99 (line 17) calls the definition and names its line: "defined on line 7", the same nine values', call.heading === say('table.calls', { code: 'CYCL DEF 200', line: 7 }) && call.rows.length === 9 && call.rows.find((r) => r.word === 'Q201')?.written === '-20', call.heading)
  const iy = await hoverOn(h, k.id, 49, 'IY')
  h.check('IY+5 (line 49) is a target, incremental', iy.last === `IY — ${say('target')}, ${say('incremental')}`, iy.last)
  // The second definition (line 10) writes Q206=FAUTO, a word and not a number: the table must still show what is written.
  const def2 = await hoverOn(h, k.id, 20, 'CYCL DEF 200')
  const q206 = def2.rows.find((r) => r.word === 'Q206')
  h.check('the definition at line 20 writes Q206=FAUTO: the table shows FAUTO as written, not "not written"', q206?.written === 'FAUTO' && q206.notWritten === false, q206)

  const s = await openFixture(h, 'nc/sinumerik/s02-drill.MPF')
  await ctx.modal.whenReady(s.id)
  const c83 = await hoverOn(h, s.id, 12, 'CYCLE83')
  const sw = (/** @type {string} */ w) => c83.rows.find((r) => r.word === w)
  // CYCLE83(5,0,2,-30,,-8,,2,0,0.5,1,0): the parameters are read by position, an empty one is not written.
  h.check('Sinumerik CYCLE83 (line 12) is read by position: RTP 5, RFP 0, SDIS 2, DP -30, DPR not written, FDEP -8, FDPR not written, _DAM 2', sw('RTP')?.written === '5' && sw('RFP')?.written === '0' && sw('SDIS')?.written === '2' && sw('DP')?.written === '-30' && sw('DPR')?.notWritten === true && sw('FDEP')?.written === '-8' && sw('FDPR')?.notWritten === true && sw('_DAM')?.written === '2', c83.rows.slice(0, 9).map((r) => `${r.word}=${r.written}`))
  const sf = await hoverOn(h, s.id, 11, 'F0.12')
  h.check('Sinumerik F0.12 (line 11) is a feed per revolution (under G95/G96 turning)', sf.last.startsWith('F — ') && sf.last.includes(say('feedPerRev')), sf.last)

  const o = await openFixture(h, 'nc/okuma/o02-thread.MIN')
  await ctx.modal.whenReady(o.id)
  const og71 = await hoverOn(h, o.id, 11, 'G71')
  h.check('Okuma G71 (line 11): a one-block thread cycle, so no "block 1 of 2" in its heading; X 27.55, Z -30, F 2', og71.heading === say('table.title', { code: 'G71' }) && og71.rows.find((r) => r.word === 'X')?.written === '27.55' && og71.rows.find((r) => r.word === 'F')?.written === '2', { heading: og71.heading, rows: og71.rows.slice(0, 3) })
  const of2 = await hoverOn(h, o.id, 11, 'F2')
  h.check('Okuma F2 under G71 is a thread lead (G71) and depends on the machine: it says so and lists the readings', of2.paragraphs.includes(`F — ${say('lead', { code: 'G71' })}`) && of2.paragraphs.includes(say('value.readings', { word: 'F2' })), of2.paragraphs.slice(-3))
  h.check('the readings of F2, the default first: 2 mm/rev, 0.002 mm/rev, 0.02 mm/rev', of2.items.length === 3 && of2.items[0].startsWith('2 mm/rev') && of2.items[1].startsWith('0.002 mm/rev') && of2.items[2].startsWith('0.02 mm/rev'), of2.items)
  const ox = await hoverOn(h, o.id, 11, 'X27.55')
  h.check('Okuma X27.55 (a word WITH a point) lists the readings too, since the Okuma presets scale it: "choose a machine"', ox.paragraphs.includes(say('value.readings', { word: 'X27.55' })) && ox.items.length === 3 && ox.items[0].startsWith('27.55 mm') , { paragraphs: ox.paragraphs.slice(-2), items: ox.items })

  const f = await openFixture(h, 'nc/fanuc/f01-mill-3tools.nc')
  await ctx.modal.whenReady(f.id)
  const fx = await hoverOn(h, f.id, 34, 'X20.')
  h.check('Fanuc mill X20. (line 34) is a target, absolute (G90), with the work offset G54', fx.last === `X — ${say('target')}, ${say('withCode', { what: say('absolute'), code: 'G90' })}, ${say('workOffset', { code: 'G54' })}`, fx.last)
  const fxc = await hoverOn(h, f.id, 37, 'X80.')
  h.check('X80. (line 37) under the modal G81 of line 36 names the cycle in force', fxc.last.endsWith(say('cycleInForce', { code: 'G81', line: 36 })), fxc.last)
  const mg83 = await hoverOn(h, f.id, 39, 'G83')
  h.check('mill G83 (line 39): X 20., Y 60., Z -18., R 3., Q 4., F 240., K not written', ['X:20.', 'Y:60.', 'Z:-18.', 'R:3.', 'Q:4.', 'F:240.'].every((p) => mg83.rows.find((r) => r.word === p.split(':')[0])?.written === p.split(':')[1]) && mg83.rows.find((r) => r.word === 'K')?.notWritten === true, mg83.rows.map((r) => `${r.word}=${r.written}`))
  const mf = await hoverOn(h, f.id, 36, 'F240.')
  h.check('mill F240. (line 36) is a feed per minute (G94) and not a lead', mf.last === `F — ${say('withCode', { what: say('feedPerMinute'), code: 'G94' })}`, mf.last)

  // ============================================================ C. X11 (c), the hover half
  const probe = await openProbe(h, 'PROBE_HOVER.NC', ['G21 G99', 'G00 X50 Z1000', 'G00 X50. Z10.', 'G01 U-2. W-1. F0.1', 'G50 S2000', 'G96 S220', 'G94 X30. Z-1. F0.2', 'M30', ''].join('\n'), 'fanuc-lathe')
  const maker = machineMaker(h)
  await maker.add('Lathe IS-B', 'fanuc-lathe', 'is-b')
  await maker.add('Lathe calc', 'fanuc-lathe', 'calculator')
  await maker.add('Lathe B', 'fanuc-lathe', 'calculator', { variants: { gcodeSystem: 'B' } })
  await maker.add('Okuma 10 um', 'okuma-osp', 'okuma-10um')
  await maker.none()
  await ctx.modal.whenReady(probe.id)

  const u = await hoverOn(h, probe.id, 4, 'U-2.')
  h.check('U-2. is an incremental X, a diameter', u.last.startsWith('U — ') && u.last.includes(say('incrementalOf', { axis: 'X' })), u.last)
  const none = await hoverOn(h, probe.id, 2, 'X50')
  h.check('no machine: X50 says it depends on the machine and to choose one, then lists the readings, the assumed default first', none.paragraphs.includes(say('value.readings', { word: 'X50' })) && none.items.length === 3 && /^50 mm: As written \(profile default\)$/.test(none.items[0]) && /^0\.05 mm: .*IS-B/.test(none.items[1]) && /^0\.005 mm: .*IS-C/.test(none.items[2]), { paragraphs: none.paragraphs.slice(-2), items: none.items })
  const pointed = await hoverOn(h, probe.id, 3, 'X50.')
  h.check('X50. (with a point) has no value line: one reading, nothing to choose', !pointed.html.includes('<li>') && !pointed.paragraphs.some((p) => p.includes(say('value.readings', { word: 'X50.' }))) && pointed.last.startsWith('X — '), pointed.paragraphs.slice(-2))
  const gA = await hoverOn(h, probe.id, 7, 'G94')
  h.check('system A (no machine): G94 is a facing pass', /facing/i.test(gA.paragraphs[0]) && !/feed per minute/i.test(gA.paragraphs[0]), gA.paragraphs[0])

  await maker.use('Lathe IS-B')
  await ctx.modal.whenReady(probe.id)
  const isb = await hoverOn(h, probe.id, 2, 'X50')
  h.check("'Lathe IS-B': X50 is 0.05 mm: no decimal point, increments of 0.001 mm (machine 'Lathe IS-B')", /^X50 — 0\.05\d* mm: no decimal point, increments of 0\.001 mm \(machine 'Lathe IS-B'\)$/.test(isb.last) && isb.last === say('value.machine', { word: 'X50', value: '0.05', unit: 'mm', why: say('value.noPoint', { step: '0.001', unit: 'mm' }), name: 'Lathe IS-B' }), isb.last)
  const isbPoint = await hoverOn(h, probe.id, 3, 'X50.')
  h.check("'Lathe IS-B': X50. is 50 mm as written: no value line", !isbPoint.paragraphs.some((p) => p.includes("machine 'Lathe IS-B'")), isbPoint.paragraphs.slice(-2))

  await maker.use('Lathe calc')
  await ctx.modal.whenReady(probe.id)
  const calc = await hoverOn(h, probe.id, 2, 'X50')
  h.check("'Lathe calc': X50 is 50 mm as written (machine 'Lathe calc')", calc.last === say('value.machine', { word: 'X50', value: '50', unit: 'mm', why: say('value.asWritten'), name: 'Lathe calc' }) && /^X50 — 50 mm/.test(calc.last), calc.last)

  await maker.use('Lathe B')
  await ctx.modal.whenReady(probe.id)
  const gB = await hoverOn(h, probe.id, 7, 'G94')
  h.check('a system-B machine: G94 is a feed mode (feed per minute)', /feed per minute/i.test(gB.paragraphs[0]) && !/facing/i.test(gB.paragraphs[0]), gB.paragraphs[0])
  await maker.none()

  // Okuma, a word with a point, with and without a machine
  const okuma = await openProbe(h, 'PROBE_HOVER.MIN', ['G90', 'G01 X27.55 Z-5. F0.2', 'M02', ''].join('\n'), 'okuma-osp')
  await maker.none()
  await ctx.modal.whenReady(okuma.id)
  const oNone = await hoverOn(h, okuma.id, 2, 'X27.55')
  h.check('Okuma, no machine: X27.55 lists the readings and says to choose a machine', oNone.paragraphs.includes(say('value.readings', { word: 'X27.55' })) && oNone.items.length >= 2, { paragraphs: oNone.paragraphs.slice(-2), items: oNone.items })
  await maker.use('Okuma 10 um')
  await ctx.modal.whenReady(okuma.id)
  const oMach = await hoverOn(h, okuma.id, 2, 'X27.55')
  h.check("Okuma 10 um: X27.55 gets one line with the effective value, the rule and the machine's name", oMach.last.startsWith('X27.55 — ') && oMach.last.includes("(machine 'Okuma 10 um')") && oMach.last.includes('mm') && !oMach.html.includes('<li>'), oMach.last)
  await maker.none()

  // ============================================================ D. nothing stale after an edit
  const edit = await openProbe(h, 'PROBE_STALE.NC', ['G21 G99', 'G00 X10. Z5.', 'G01 Z-5. F0.1', 'M30', ''].join('\n'), 'fanuc-lathe')
  await ctx.modal.whenReady(edit.id)
  const before = await hoverOn(h, edit.id, 3, 'F0.1')
  h.check('before the edit F0.1 is a feed per revolution (G99)', before.last === `F — ${say('withCode', { what: say('feedPerRev'), code: 'G99' })}`, before.last)
  ctx.editor.reveal(edit.id, 1, 1)
  await h.idle()
  h.focusEditor()
  // G99 -> G98 on line 1 with real keys: Home, then replace the last digit.
  await h.nativeKeys([{ key: 'End' }])
  await h.nativeKeys([{ key: 'Backspace' }])
  await h.nativeType('8')
  const stale = await hoverOn(h, edit.id, 3, 'F0.1')
  h.check('right after G99 became G98 the hover never says the old mode: it is the Phase 2 text or the new context', ctx.editor.getText(edit.id).startsWith('G21 G98') && !stale.last.includes('G99') && !stale.last.includes(say('feedPerRev')), stale.last)
  await ctx.modal.whenReady(edit.id)
  const fresh = await hoverOn(h, edit.id, 3, 'F0.1')
  h.check('and once the program has been read again it says feed per minute (G98)', fresh.last === `F — ${say('withCode', { what: say('feedPerMinute'), code: 'G98' })}`, fresh.last)
})
