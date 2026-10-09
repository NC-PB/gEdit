// Motion colours (Phase 3 plan H3a `p3-colors`; X16, the in-app half). The plan spells the id `p3-colors`; the
// same scenario is registered as `p3-colours` too, for a reader who types the other spelling (it is not in a suite).
//
//   A. Every golden of `tests/fixtures/motion/<profileId>/*.json` is opened as a program of its profile (the
//      lathe in system B under the machine the golden names) and the mark of every line, read from the
//      line-decorations margin (`.cldr.gedit-motion-mark.gedit-motion-<kind>`), is the golden's: `rapid`,
//      `linear`, `arc`, `thread`, `cycle`, or no mark at all for a comment, `M8`, `T0101`, a `G0` alone, a
//      block whose motion mode is unknown or only assumed. All five kinds are seen.
//   B. The look. The bar sits in the line-decorations margin, to the left of the text and to the right of the
//      line numbers; its colour is `MOTION_COLORS` of the theme (read from the source), in the dark theme and
//      in the light one, and `--gedit-motion-<kind>` on the document element is the same colour.
//   C. The toggle. Motion Colors (View tab button, command, and the setting `assist.motionColors`, on by
//      default) removes every mark and says so; on brings the same marks back; the choice is saved.
//   D. Recolouring. A dialect switch (the same text as a Klartext program), a machine switch (system A to
//      system B, which turns a threading cycle into a coordinate setting) and an edit (G1 to G0 with real keys)
//      each recolour from the new state, and undoing the edit gives the old marks back.

import { scenario } from '../lib/index.js'
import { ready } from './m4-common.js'
import { undo } from './m5-common.js'
import { openProbe } from './m9-common.js'
import { REPO_FILE, repoPath, rgbOf, setTheme } from './m3-common.js'
import { makeMachine, useMachine } from './exit2-common.js'
import { KINDS, clickMotionColors, context, markCount, marksOnScreen, parseMotionColors, revealLine } from './p3-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/**
 * The goldens, `tests/fixtures/motion/<profileId>/<case>.json`. The harness cannot list a folder, so the
 * list is here; the README of that folder lists the same ten (one per built-in profile at least, the lathe in
 * both G-code systems).
 */
const GOLDENS = [
  ['fanuc-gcode', 'mill-moves', 'nc'],
  ['fanuc-gcode', 'mill-cycles', 'nc'],
  ['fanuc-gcode', 'mill-data-words', 'nc'],
  ['fanuc-lathe', 'turning-a', 'nc'],
  ['fanuc-lathe', 'system-b', 'nc'],
  ['okuma-osp', 'lathe', 'MIN'],
  ['sinumerik', 'turning', 'MPF'],
  ['sinumerik-mill', 'five-axis', 'MPF'],
  ['heidenhain-klartext', 'cycles', 'H'],
  ['heidenhain-klartext', 'path-functions', 'H'],
]

/** The machine name of a golden's machine block. @param {string} profile @param {string} name */
const machineName = (profile, name) => `Motion ${profile} ${name}`

/**
 * Reads the mark of lines 1..`count` by scrolling the editor through the program, waiting at each stop until
 * the margin shows what `want` says (or the wait runs out).
 * @param {Harness} h
 * @param {string} id
 * @param {number} count
 * @param {Record<string, string | null>} [want] line -> kind, to wait for the update to land
 * @returns {Promise<Map<number, string | null>>}
 */
async function readMarks(h, id, count, want) {
  /** @type {Map<number, string | null>} */
  const seen = new Map()
  for (let top = 1; top <= count; top += 12) {
    await revealLine(h, id, Math.min(count, top + 8), 1)
    const settled = () => {
      const m = marksOnScreen(h)
      if (m.size === 0) return false
      if (!want) return true
      return [...m].every(([line, kind]) => (want[String(line)] ?? null) === kind)
    }
    await h.waitFor(settled, { timeout: 3000 })
    for (const [line, kind] of marksOnScreen(h)) seen.set(line, kind)
  }
  return seen
}

/** The lines on which two readings differ. @param {Map<number, string | null>} a @param {Map<number, string | null>} b */
const differing = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((line) => (a.get(line) ?? null) !== (b.get(line) ?? null)).sort((x, y) => x - y)

/** @param {Harness} h */
async function motionColors(h) {
  const ctx = context(h)
  await ready(h)
  h.check('Motion Colors is on by default', ctx.settings.get('assist.motionColors') === true, ctx.settings.get('assist.motionColors'))

  // ============================================================ A. the goldens
  /** @type {Set<string>} */
  const kindsSeen = new Set()
  /** @type {Record<string, { id: string, want: Record<string, string | null>, count: number, machine: string | null, machineId: string }>} */
  const opened = {}
  for (const [profile, name, ext] of GOLDENS) {
    const dir = await h.fixture(`motion/${profile}`)
    const golden = JSON.parse(await h.disk.read(`${dir}/${name}.json`))
    const probe = await openProbe(h, `MOTION_${profile}_${name}.${ext}`, golden.input.join('\n') + '\n', profile)
    /** @type {string | null} */
    let machine = null
    let machineId = ''
    if (golden.machine) {
      machine = machineName(profile, name)
      machineId = await makeMachine(h, { name: machine, profile, params: golden.machine })
      await useMachine(h, machineId, machine)
    }
    await ctx.modal.whenReady(probe.id)
    const count = golden.input.length
    const marks = await readMarks(h, probe.id, count, golden.lines)
    const wrong = Object.entries(golden.lines).filter(([line, kind]) => (marks.get(Number(line)) ?? null) !== kind).map(([line, kind]) => `${line}: wanted ${kind}, drawn ${marks.get(Number(line)) ?? null}`)
    h.check(`${profile}/${name}: every one of the ${count} lines carries the golden's mark${machine ? ` (machine ${machine})` : ''}`, ctx.docs.get(probe.id)?.profileId === profile && marks.size >= count && wrong.length === 0, { wrong, drawn: [...marks].filter(([, k]) => k).length })
    for (const kind of marks.values()) if (kind) kindsSeen.add(kind)
    opened[`${profile}/${name}`] = { id: probe.id, want: golden.lines, count, machine, machineId }
  }
  h.check('all five kinds were drawn somewhere: rapid, linear, arc, thread, cycle', KINDS.every((k) => kindsSeen.has(k)), [...kindsSeen])

  // The plan's named cases, on the mill program.
  const mill = opened['fanuc-gcode/mill-moves']
  await ctx.docs.activate(mill.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === mill.id, { timeout: 5000 })
  const millMarks = await readMarks(h, mill.id, mill.count, mill.want)
  h.check('a bare move before any motion code (X10. Y10., line 4) is assumed and carries no mark', millMarks.get(4) === null, millMarks.get(4))
  h.check('comments, tool and coolant lines, a G0 alone carry none (lines 2, 5, 9, 10, 21)', [2, 5, 9, 10, 21].every((line) => millMarks.get(line) === null), [2, 5, 9, 10, 21].map((l) => millMarks.get(l)))
  h.check('after G1 a bare X25. is linear, after G2 a bare X45. is an arc, after G0 a Z50. is rapid (lines 12, 15, 19)', millMarks.get(12) === 'linear' && millMarks.get(15) === 'arc' && millMarks.get(19) === 'rapid', [12, 15, 19].map((l) => millMarks.get(l)))

  // ============================================================ B. the look
  const lathe = opened['fanuc-lathe/turning-a']
  await ctx.docs.activate(lathe.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === lathe.id, { timeout: 5000 })
  const colors = parseMotionColors(await h.disk.read(`${await repoPath(h)}/src/lib/core/nc/motion.ts`))
  h.check('MOTION_COLORS was read from the source: five kinds in both themes', KINDS.every((k) => /^#[0-9a-f]{6}$/i.test(colors.dark[k] ?? '') && /^#[0-9a-f]{6}$/i.test(colors.light[k] ?? '')), colors)
  /**
   * The first drawn mark of each kind, found by scrolling the lathe program. What is read of a mark (its colour, its box and the
   * box of its line number) is read the moment it is found: Monaco recycles the margin's elements while the view scrolls on, and a
   * recycled element has no style any more.
   * @returns {Promise<Map<string, { color: string, bar: DOMRect, numbers: DOMRect | undefined }>>}
   */
  const markElements = async () => {
    /** @type {Map<string, { color: string, bar: DOMRect, numbers: DOMRect | undefined }>} */
    const found = new Map()
    for (let top = 1; top <= lathe.count; top += 12) {
      await revealLine(h, lathe.id, Math.min(lathe.count, top + 8), 1)
      await h.waitFor(() => markCount(h) > 0, { timeout: 3000 })
      for (const el of h.q('editor-host')?.querySelectorAll('.margin-view-overlays .cldr.gedit-motion-mark') ?? []) {
        const kind = [...el.classList].find((c) => c.startsWith('gedit-motion-') && c !== 'gedit-motion-mark')?.slice('gedit-motion-'.length)
        if (kind && !found.has(kind)) {
          const row = el.closest('.margin-view-overlays > div')
          found.set(kind, { color: getComputedStyle(el).backgroundColor, bar: el.getBoundingClientRect(), numbers: row?.querySelector('.line-numbers')?.getBoundingClientRect() })
        }
      }
    }
    return found
  }
  for (const theme of /** @type {const} */ (['dark', 'light'])) {
    await setTheme(h, theme)
    await h.waitFor(() => markCount(h) > 0, { timeout: 3000 })
    const elements = await markElements()
    /** @type {Record<string, string>} */
    const drawn = {}
    /** @type {Record<string, string>} */
    const variable = {}
    for (const kind of KINDS) {
      const el = elements.get(kind)
      drawn[kind] = el ? el.color : '(not drawn)'
      variable[kind] = getComputedStyle(document.documentElement).getPropertyValue(`--gedit-motion-${kind}`).trim()
    }
    h.check(`${theme} theme: each kind is drawn in MOTION_COLORS`, KINDS.every((k) => drawn[k] === rgbOf(colors[theme][k])), { drawn, want: colors[theme] })
    h.check(`${theme} theme: --gedit-motion-<kind> on the document element holds the same colours`, KINDS.every((k) => variable[k].toLowerCase() === colors[theme][k].toLowerCase()), variable)
  }
  await setTheme(h, 'dark')
  const sample = (await markElements()).get('linear')
  const bar = sample?.bar
  const numbers = sample?.numbers
  const text = h.q('editor-host')?.querySelector('.view-lines .view-line')?.getBoundingClientRect()
  h.check('the bar is a few pixels wide, right of the line numbers and left of the text (the line-decorations margin)', !!bar && !!numbers && !!text && bar.width >= 2 && bar.width <= 6 && bar.left >= numbers.right - 1 && bar.right <= text.left + 1, bar && { bar: [bar.left, bar.right], numbers: numbers && [numbers.left, numbers.right], text: text && text.left })

  // ============================================================ C. the toggle
  await ctx.docs.activate(mill.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === mill.id, { timeout: 5000 })
  await readMarks(h, mill.id, mill.count, mill.want)
  const onMarks = await readMarks(h, mill.id, mill.count, mill.want)
  h.check('before the toggle the mill program carries its marks', [...onMarks.values()].filter((k) => k).length === Object.values(mill.want).filter((k) => k).length, [...onMarks])
  await clickMotionColors(h)
  await h.waitFor(() => markCount(h) === 0 && ctx.settings.get('assist.motionColors') === false, { timeout: 5000 })
  const offMarks = await readMarks(h, mill.id, mill.count)
  h.check('Motion Colors off removes every mark', markCount(h) === 0 && [...offMarks.values()].every((k) => k === null) && ctx.settings.get('assist.motionColors') === false, { drawn: markCount(h), setting: ctx.settings.get('assist.motionColors') })
  h.check('and the status bar says so', (h.q('status-message')?.textContent ?? '').includes(ctx.t('motionColors.off')), h.q('status-message')?.textContent)
  h.check('the choice is saved in settings.json', (await h.waitFor(async () => /** @type {any} */ (await h.config.read('settings.json'))?.['assist.motionColors'] === false, { timeout: 5000 })) === true, await h.config.read('settings.json'))
  await ctx.commands.run('view.toggleMotionColors')
  await h.waitFor(() => markCount(h) > 0 && ctx.settings.get('assist.motionColors') === true, { timeout: 5000 })
  const backMarks = await readMarks(h, mill.id, mill.count, mill.want)
  h.check('on again brings the same marks back (here by the command)', differing(onMarks, backMarks).length === 0 && markCount(h) > 0, differing(onMarks, backMarks))
  h.check('and the status bar says so', (h.q('status-message')?.textContent ?? '').includes(ctx.t('motionColors.on')), h.q('status-message')?.textContent)

  // ============================================================ D. recolouring
  // an edit with real keys: G1 -> G0 on line 11 (G1 Z-2. F200.), then Undo
  await revealLine(h, mill.id, 11, 1)
  h.focusEditor()
  await h.nativeKeys([{ key: 'Home' }])
  await h.nativeKeys([{ key: 'ArrowRight' }])
  await h.nativeKeys([{ key: 'ArrowRight', mods: ['shift'] }])
  await h.nativeType('0')
  const lineNow = ctx.editor.getLines(mill.id, 11, 11)[0]
  await h.idle()
  const edited = await readMarks(h, mill.id, mill.count, { ...mill.want, 11: 'rapid', 12: 'rapid', 13: 'rapid' })
  h.check('G1 Z-2. F200. typed into G0 Z-2. F200.: the line is rapid, and so are the bare moves below it (X25., Y25.) up to the next code', lineNow === 'G0 Z-2. F200.' && edited.get(11) === 'rapid' && edited.get(12) === 'rapid' && edited.get(13) === 'rapid', { line: lineNow, marks: [11, 12, 13].map((l) => edited.get(l)) })
  await undo(h)
  const undone = await readMarks(h, mill.id, mill.count, mill.want)
  h.check('one Undo gives the old marks back', differing(undone, onMarks).length === 0, differing(undone, onMarks))

  // a dialect switch: the same text as a Klartext program
  ctx.files.setProfile(mill.id, 'heidenhain-klartext')
  await h.waitFor(() => ctx.docs.get(mill.id)?.profileId === 'heidenhain-klartext', { timeout: 5000 })
  await ctx.modal.whenReady(mill.id)
  await h.idle()
  const klartext = await readMarks(h, mill.id, mill.count)
  h.check('a dialect switch recolours from the new state: the fanuc mill text is not a Klartext program, so its marks are not the mill program\'s', differing(klartext, onMarks).length > 0, [...klartext].filter(([, k]) => k).length)
  ctx.files.setProfile(mill.id, 'fanuc-gcode')
  await h.waitFor(() => ctx.docs.get(mill.id)?.profileId === 'fanuc-gcode', { timeout: 5000 })
  await ctx.modal.whenReady(mill.id)
  const returned = await readMarks(h, mill.id, mill.count, mill.want)
  h.check('and switching back gives the mill marks back', differing(returned, onMarks).length === 0, differing(returned, onMarks))

  // a machine switch: system B of the lathe changes what G92 means
  const sysB = opened['fanuc-lathe/system-b']
  await ctx.docs.activate(sysB.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === sysB.id, { timeout: 5000 })
  const underB = await readMarks(h, sysB.id, sysB.count, sysB.want)
  const machineA = await makeMachine(h, { name: 'Motion system A', profile: 'fanuc-lathe', params: { variants: { gcodeSystem: 'A' } } })
  await useMachine(h, machineA, 'Motion system A')
  await ctx.modal.whenReady(sysB.id)
  const underA = await readMarks(h, sysB.id, sysB.count)
  const wantMap = new Map(Object.entries(sysB.want).map(([l, k]) => [Number(l), k]))
  h.check('a machine switch recolours: under a system-A machine the same text is a different program (G92 X Z is a threading cycle there)', differing(underB, wantMap).length === 0 && differing(underB, underA).length > 0, { underB: [...underB], underA: [...underA] })
  await useMachine(h, sysB.machineId, /** @type {string} */ (sysB.machine))
  await ctx.modal.whenReady(sysB.id)
  const again = await readMarks(h, sysB.id, sysB.count, sysB.want)
  h.check('and the system-B machine again gives the golden back', differing(again, wantMap).length === 0, differing(again, wantMap))
}

scenario('p3-colors', { timeout: 600, files: REPO_FILE }, motionColors)
scenario('p3-colours', { timeout: 600, files: REPO_FILE }, motionColors)
