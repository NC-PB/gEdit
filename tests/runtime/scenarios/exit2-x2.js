// Phase 2 exit criterion X2, "Okuma and Sinumerik" (plan §2.2; `tests/fixtures/exit2/README.md`, X2).
//
// `okuma-lathe.MIN` and `sinumerik-lathe.MPF` are detected by extension and by content (also as
// their `.txt` copies, which are the same bytes). No token of either is painted `invalid` and the
// tokenizer finds no `unknown` token outside a comment on any line. With no machine chosen: F7,
// the program map, the tool list and scale feed give the golden results (Okuma four- and
// six-digit `T`, `G04 F` a dwell, `SB=` not the main spindle; Sinumerik `T="NAME"` and `T1 D1`,
// `LIMS=` a clamp, `G33` refused), and the Sinumerik modal state has diameter programming **on**
// at the first block (assumed, the profile default `DIAMON`) and **off** after the `DIAMOF` block.
// Both programs are saved at the end and compared with the golden bytes.

import { scenario } from '../lib/index.js'
import { REPO_FILE, loadPalette, rgbOf, setTheme } from './m3-common.js'
import {
  OKUMA,
  SINUMERIK,
  UNKNOWN_TOKENS,
  activate,
  checkStoredReport,
  checkToolList,
  context,
  exitDir,
  expectNoPython,
  firstDifference,
  gold,
  goldText,
  invalidPainted,
  machineItem,
  machineText,
  mapTools,
  openIn,
  read,
  ready,
  runAndCompare,
  runScript,
  sameBytes,
  textNow,
  unknownTokens,
  walkTools,
  writeUserScript,
} from './exit2-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/**
 * @param {Harness} h
 * @param {{ noPython?: boolean }} [o]
 */
export async function runX2(h, { noPython = false } = {}) {
  const ctx = context(h)
  await ready(h)
  await setTheme(h, 'dark')
  const palette = await loadPalette(h)
  const invalidColor = rgbOf(palette.dark.invalid)
  const dir = await exitDir(h)
  const okuma = await gold(h, dir, 'okuma-lathe.tools.json')
  const sinu = await gold(h, dir, 'sinumerik-lathe.tools.json')
  const modal = await gold(h, dir, 'sinumerik-lathe.modal.json')
  h.check('no machine exists at all', (await h.config.read('machines.json')) === null)

  /** @type {Record<string, { id: string, path: string }>} */
  const files = {}
  for (const name of ['okuma-lathe.MIN', 'okuma-lathe.txt', 'sinumerik-lathe.MPF', 'sinumerik-lathe.txt']) files[name] = await openIn(h, dir, name)

  // ============================================================ detection
  for (const [golden, want] of [[okuma, OKUMA], [sinu, SINUMERIK]]) {
    for (const [name, profile] of Object.entries(golden.detected)) {
      const got = ctx.docs.get(files[name].id)?.profileId
      h.check(`${name} is detected as ${profile}`, got === profile && profile === want, got)
    }
    h.check(`${golden.input}: the .txt copy is the same bytes`, golden.sameBytes === true && (await sameBytes(h, files[golden.input].path, files[golden.input.replace(/\.[A-Za-z]+$/, '.txt')].path)), null)
  }
  h.check('the .txt copies are detected by content alone (no extension speaks for them)', ctx.docs.get(files['okuma-lathe.txt'].id)?.profileId === OKUMA && ctx.docs.get(files['sinumerik-lathe.txt'].id)?.profileId === SINUMERIK, null)

  // ============================================================ tokens
  const scriptId = noPython ? null : await writeUserScript(h, 'exit2_unknown.py', UNKNOWN_TOKENS)
  for (const [name, golden] of [['okuma-lathe.MIN', okuma], ['sinumerik-lathe.MPF', sinu], ['okuma-lathe.txt', okuma], ['sinumerik-lathe.txt', sinu]]) {
    const { id } = files[name]
    await activate(h, id)
    const painted = await invalidPainted(h, id, invalidColor)
    h.check(`${name}: no token is painted invalid`, painted.length === 0, painted.slice(0, 5))
    if (scriptId !== null) {
      const unknown = await unknownTokens(h, scriptId)
      h.check(`${name}: the tokenizer finds no unknown token outside comments`, JSON.stringify(unknown) === JSON.stringify(golden.unknownTokens), unknown.slice(0, 8))
    }
  }

  // ============================================================ Okuma
  const okumaId = files['okuma-lathe.MIN'].id
  await activate(h, okumaId)
  h.check('Okuma: no machine, assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', machineText(h))
  await walkTools(h, okumaId, okuma.toolLines, 'Okuma')
  await h.waitFor(() => mapTools(h).length === okuma.mapTools.length, { timeout: 10000 })
  h.check('Okuma: the map reads the four- and the six-digit T words as the golden does (T1, T3, T9, T5, T11)', JSON.stringify(mapTools(h)) === JSON.stringify(okuma.mapTools), { got: mapTools(h), want: okuma.mapTools })
  if (noPython) {
    await expectNoPython(h, 'bundled:scale_feed.py', okumaId, 'Okuma: scale feed', { percent: 90 })
  } else {
    await checkToolList(h, okuma.toolList, 'Okuma')
    await runAndCompare(h, { id: okumaId, scriptId: 'bundled:scale_feed.py', fields: { percent: 90 }, golden: await goldText(h, dir, 'okuma-lathe.feed90.MIN'), report: await gold(h, dir, 'okuma-lathe.feed90.report.json'), label: 'Okuma: scale feed 90 % (G04 F a dwell left, SB= untouched, G71 lead listed)', undoAfter: false })
    h.check('Okuma: the dwell G04 F0.5 and the driven tool SB=2400 are untouched', textNow(h).includes('G04 F0.5') && textNow(h).includes('SB=2400'), null)
  }

  // ============================================================ Sinumerik
  const sinuId = files['sinumerik-lathe.MPF'].id
  await activate(h, sinuId)
  h.check('Sinumerik: no machine, assumed', machineText(h) === 'Machine: none (assumed)' && machineItem(h)?.dataset.assumed === '1', machineText(h))
  await walkTools(h, sinuId, sinu.toolLines, 'Sinumerik')
  await h.waitFor(() => mapTools(h).length === sinu.mapTools.length, { timeout: 10000 })
  h.check('Sinumerik: the map reads T="NAME" and T1 D1 as the golden does', JSON.stringify(mapTools(h)) === JSON.stringify(sinu.mapTools), { got: mapTools(h), want: sinu.mapTools })
  if (noPython) {
    await expectNoPython(h, 'bundled:scale_feed.py', sinuId, 'Sinumerik: scale feed', { percent: 90 })
    await expectNoPython(h, 'bundled:scale_speed.py', sinuId, 'Sinumerik: scale speed', { percent: 110 })
  } else {
    await checkToolList(h, sinu.toolList, 'Sinumerik')
    await runAndCompare(h, { id: sinuId, scriptId: 'bundled:scale_feed.py', fields: { percent: 90 }, golden: await goldText(h, dir, 'sinumerik-lathe.feed90.MPF'), report: await gold(h, dir, 'sinumerik-lathe.feed90.report.json'), label: 'Sinumerik: scale feed 90 % (the F of the G33 block refused)' })
    await runAndCompare(h, { id: sinuId, scriptId: 'bundled:scale_speed.py', fields: { percent: 110 }, golden: await goldText(h, dir, 'sinumerik-lathe.speed110.MPF'), report: await gold(h, dir, 'sinumerik-lathe.speed110.report.json'), label: 'Sinumerik: scale speed 110 % (LIMS= clamps kept, G33 blocks flagged)', undoAfter: false })
    h.check('Sinumerik: the three LIMS= clamps are untouched', ['LIMS=2800', 'LIMS=3200', 'LIMS=2500'].every((word) => textNow(h).includes(word)), null)

    // X2: the modal state at the first block and after DIAMOF, from the Python interpreter, through a user script.
    const modalId = await writeUserScript(h, 'exit2_modal.py', await h.disk.read(`${dir}/scripts/report_modal.py`))
    await runScript(h, modalId)
    await h.waitFor(() => /** @type {any} */ (read(context(h).results.current))?.title === modal.report.title, { timeout: 30000 })
    await h.idle()
    checkStoredReport(h, modal.report, 'Sinumerik modal report')
    const first = modal.report.rows[0]
    const last = modal.report.rows.find((/** @type {any} */ r) => r.diameter === 'off')
    h.check('diameter programming is ON (assumed, the profile default DIAMON) at the first block and OFF after the DIAMOF block (line 28)', first.diameter === '=on' && first.x === 'diameter' && last?.line === 28 && last?.x === 'radius', { first, last })
  }

  // ============================================================ saved bytes
  for (const [name, golden] of [['okuma-lathe.MIN', 'okuma-lathe.feed90.MIN'], ['sinumerik-lathe.MPF', 'sinumerik-lathe.speed110.MPF']]) {
    const { id, path } = files[name]
    await activate(h, id)
    const before = await h.disk.read(path)
    if (ctx.docs.get(id)?.dirty === true && (await ctx.files.save(id)) !== true) throw new Error(`saving ${name} failed`)
    await h.idle()
    const saved = await h.disk.read(path)
    const want = await goldText(h, dir, golden, noPython)
    h.check(`${name}: the saved file is ${noPython ? 'the input, byte for byte (nothing edited, nothing rewritten)' : `${golden}, byte for byte`}`, saved === want, { diff: firstDifference(saved, want) })
    h.check(`${name}: ${noPython ? 'the document was never dirty' : 'and the bytes really changed'}`, noPython ? saved === before : saved !== before, null)
  }
}

scenario('exit2-x2', { timeout: 600, files: REPO_FILE }, async (h) => {
  await runX2(h)
})
