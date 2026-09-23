// Dialect profiles and the generated grammars (plan §5 M3 H3 `m3-profiles`, §7.4, WP3.1
// and WP3.4): the profile a file gets is the one detection says, that id *is* the Monaco
// language id, and the grammar the profile generates really paints the editor.
//
// **Why the colours are read off the screen.** The plan asks for `monaco.editor.tokenize`
// on sample lines. The app never puts the Monaco namespace on `window`, and `AppContext`
// exposes models and the editor instance but not the namespace (§7.2), so a scenario has
// no route to that static function — and opening one would be a test seam into the very
// layer under test. What a user sees is the rendered token, so that is what this reads:
// `getComputedStyle` on the span Monaco drew, against the `ROLE_COLORS` the theme was
// generated from. It is the stronger check of the two, because it also covers theme
// generation and the role → colour mapping, which `tokenize` would not touch.
//
// Neither the palette nor the detection answers are retyped here: the palette is parsed
// out of `core/grammar/roles.ts` and the answers come from `tests/fixtures/expected/detect/`,
// both read at run time.
//
// **M6 split that folder** (P6 item 11). There is no longer one `fixtures.json`: there is
// one file per folder of `tests/fixtures/nc`, so a content work package adds its dialect's
// expectations without touching anybody else's, plus `_improvements.json` for the
// hand-written texts. A fixture's folder *is* its expectation file, so this scenario
// derives the file names from `OPENED` rather than listing them — a fixture whose folder
// has no expectation file then fails loudly instead of being skipped.

import { scenario } from '../lib/index.js'
import {
  PALETTE_ROLES,
  REPO_FILE,
  context,
  lineTokens,
  loadPalette,
  openFixture,
  openPath,
  paintedRoles,
  plain,
  revealLine,
  rgbOf,
  rolesByColor,
  roleOf,
  setTheme,
} from './m3-common.js'

/**
 * The fixtures opened in the running app. `core/profiles/detect.test.ts` already answers
 * for every file under `tests/fixtures/nc`; the point here is that the answer survives the
 * trip through `fileOps.open` → `profiles.detect` → `EditorService.createModel`, so this
 * is the spread that matters: extension, content against extension, and no extension.
 */
const OPENED = [
  'nc/fanuc/f01-mill-3tools.nc',
  'nc/fanuc/f02-packed.nc',
  'nc/fanuc/f05-comments-edge.nc',
  'nc/fanuc/f07.tap',
  'nc/fanuc/O1234',
  'nc/heidenhain/h01-3tools.h',
  'nc/heidenhain/detect-heidenhain.txt',
  'nc/ambiguous/heidenhain-fragment.txt',
]

/** Index into `OPENED` of the three files the paint checks read. */
const F01 = 0
const F02 = 1
const H01 = 5

/**
 * A line of a fixture and the role each of its words must be painted as, derived from the
 * profile and from `core/grammar/iso.ts`:
 *   - `%` and `O1001` frame the file → `programMarker`; `( … )` → `comment`
 *   - the profile's `addresses` give `T`, `F`, `S` and the axes their roles, `G` and `M`
 *     are the two code letters of word-address code itself, and a letter only the code
 *     database knows (`H`) is a plain `number`
 *   - `N10` is the block number, `/` and `/1` the block skip, `#101` a variable
 */
const FANUC_LINES = [
  { file: F01, line: 2, words: [['%', 'programMarker']] },
  { file: F01, line: 3, words: [['O1001', 'programMarker'], ['(BRACKET)', 'comment']] },
  { file: F01, line: 9, words: [['G21', 'gcode'], ['G90', 'gcode']] },
  { file: F01, line: 11, words: [['T1', 'tool'], ['M6', 'mcode']] },
  { file: F01, line: 13, words: [['S4800', 'spindle'], ['M3', 'mcode']] },
  { file: F01, line: 16, words: [['G43', 'gcode'], ['Z25.', 'axis'], ['H1', 'number'], ['M8', 'mcode']] },
  { file: F01, line: 18, words: [['G1', 'gcode'], ['Z-5.', 'axis'], ['F400.', 'feed']] },
  { file: F02, line: 4, words: [['N10', 'blockNumber'], ['G0', 'gcode'], ['X0', 'axis'], ['Y0', 'axis']] },
  { file: F02, line: 8, words: [['N40', 'blockNumber'], ['#101', 'variable'], ['#1', 'variable'], ['=', 'operator']] },
  { file: F02, line: 13, words: [['/1', 'skip'], ['N90', 'blockNumber'], ['X0.', 'axis']] },
  { file: F02, line: 17, words: [['N120', 'blockNumber'], ['/', 'skip'], ['G0', 'gcode']] },
]

/**
 * The same for Klartext, where a block is words separated by spaces rather than packed
 * letters (`core/grammar/klartext.ts`): the block number is the leading integer,
 * `TOOL CALL` is one keyword made of two words, and `R0` and `FMAX` are keywords because
 * the code database carries them as word codes rather than as addresses.
 */
const KLARTEXT_LINES = [
  { line: 1, words: [['0', 'blockNumber'], ['BEGIN PGM', 'keyword']] },
  { line: 3, words: [['BLK FORM', 'keyword'], ['X-50', 'axis'], ['Y-40', 'axis']] },
  { line: 5, words: [['4 * - ROUGH', 'section']] },
  { line: 6, words: [['TOOL CALL', 'keyword'], ['S3000', 'spindle'], ['F800', 'feed'], ['; D10 END MILL', 'comment']] },
  { line: 7, words: [['L', 'keyword'], ['Z+100', 'axis'], ['R0', 'keyword'], ['FMAX', 'keyword'], ['M3', 'mcode']] },
]

/** Files scanned line by line for a token the highlighter marked as an error. */
const NO_INVALID = [F02, F01, H01]

/** Whitespace of every shape a CAM post emits, on lines that are otherwise valid. */
const WHITESPACE_PROGRAM = [
  '%',
  'O2000 (WHITESPACE)',
  '   G21   G90   G94   ',
  '\tT1\tM6\t',
  'G0   X10.    Y-20.   ',
  '  (INDENTED COMMENT)  ',
  '',
  '   ',
  'G1 Z-1. F200.',
  'M30',
  '%',
].join('\n')

scenario('m3-profiles', { timeout: 300, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await h.waitFor(() => h.q('app-shell')?.dataset.ready === '1', { timeout: 20000 })
  await setTheme(h, 'dark')

  // ------------------------------------------------------------ the palette
  const palette = await loadPalette(h)
  h.check(
    'the role palette was read from core/grammar/roles.ts, both themes complete',
    PALETTE_ROLES.every((role) => /^#[0-9a-f]{6}$/i.test(palette.dark[role] ?? '') && /^#[0-9a-f]{6}$/i.test(palette.light[role] ?? '')),
    { missingDark: PALETTE_ROLES.filter((r) => !palette.dark[r]), missingLight: PALETTE_ROLES.filter((r) => !palette.light[r]) },
  )
  h.check('no two roles share a colour, so a painted token names exactly one role', new Set(Object.values(palette.dark)).size === PALETTE_ROLES.length && new Set(Object.values(palette.light)).size === PALETTE_ROLES.length, {
    dark: Object.keys(palette.dark).length,
    light: Object.keys(palette.light).length,
  })
  // `roles.test.ts` pins `--nc-tool` and `--nc-comment` in `app.css` to the same two
  // values, so this is a second, independent reading of the file that was just parsed.
  const variable = (/** @type {string} */ name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase()
  h.check('the panel colours in app.css are the palette values', variable('--nc-tool') === palette.dark.tool && variable('--nc-comment') === palette.dark.comment, {
    css: { tool: variable('--nc-tool'), comment: variable('--nc-comment') },
    parsed: { tool: palette.dark.tool, comment: palette.dark.comment },
  })
  const dark = rolesByColor(palette.dark)
  const light = rolesByColor(palette.light)

  // ------------------------------------------------------------ detection in the app
  // `nc/<folder>/<file>` → `expected/detect/<folder>.json`, merged over the folders this
  // scenario actually opens.
  /** @type {Record<string, string>} */
  const answers = {}
  for (const folder of [...new Set(OPENED.map((rel) => rel.split('/')[1]))]) {
    const file = JSON.parse(await h.disk.read(await h.fixture(`expected/detect/${folder}.json`)))
    Object.assign(answers, file.fixtures)
  }
  const goldens = JSON.parse(await h.disk.read(await h.fixture('expected/detect/_improvements.json')))
  h.check('every fixture this scenario opens has an entry in its folder’s detection goldens', OPENED.every((rel) => typeof answers[rel] === 'string'), OPENED.filter((rel) => typeof answers[rel] !== 'string'))

  /** @type {{ path: string, id: string }[]} */
  const opened = []
  for (const rel of OPENED) {
    const want = answers[rel]
    const file = await openFixture(h, rel)
    opened.push(file)
    const got = ctx.docs.get(file.id)?.profileId
    h.check(`${rel} is opened as ${want}`, got === want, { got, want })
    h.check(`${rel}: the profile id is the Monaco language id`, ctx.editor.model(file.id)?.getLanguageId() === want, {
      language: ctx.editor.model(file.id)?.getLanguageId(),
      profile: got,
    })
  }

  await revealLine(h, opened[H01].id, 1, 1)
  const shortName = ctx.profiles.get('heidenhain-klartext')?.shortName
  h.check('the status bar names the profile of the active document', h.q('status-item', { item: 'profile' })?.textContent?.trim() === shortName, {
    status: h.q('status-item', { item: 'profile' })?.textContent?.trim(),
    shortName,
  })

  // ------------------------------------------------------------ content outvotes the extension
  // The cases `expected/detect/_improvements.json` records as improvements over M0. The
  // texts and the answers come out of that file, so the two cannot drift apart.
  for (const [index, improvement] of goldens.improvements.entries()) {
    const suffix = improvement.path.slice(improvement.path.lastIndexOf('.'))
    const path = `${h.cfg.run}/improvement-${index}${suffix}`
    await h.disk.write(path, improvement.text)
    const { id } = await openPath(h, path)
    const got = ctx.docs.get(id)?.profileId
    h.check(`detection: ${improvement.case}`, got === improvement.expected, { got, expected: improvement.expected, wasAtM0: improvement.m0 })
  }

  // ------------------------------------------------------------ the generated grammar paints
  for (const { file, line, words } of FANUC_LINES) {
    const id = opened[file].id
    await revealLine(h, id, line, 1)
    const tokens = lineTokens(h, id, line, dark)
    for (const [text, role] of words) {
      h.check(`Fanuc ${OPENED[file].split('/').pop()}:${line} — ${text} is painted as ${role}`, roleOf(tokens, text) === role, { got: roleOf(tokens, text), want: role, line: tokens })
    }
  }

  for (const { line, words } of KLARTEXT_LINES) {
    await revealLine(h, opened[H01].id, line, 1)
    const tokens = lineTokens(h, opened[H01].id, line, dark)
    for (const [text, role] of words) {
      h.check(`Klartext h01:${line} — ${JSON.stringify(text)} is painted as ${role}`, roleOf(tokens, text) === role, { got: roleOf(tokens, text), want: role, line: tokens })
    }
  }

  // The plan's own wording. Distinctness is a different failure from "the colour is
  // wrong": a generator that collapsed two roles onto one theme rule would pass every
  // check above if the palette happened to agree.
  await revealLine(h, opened[F01].id, 18, 1)
  const cutting = lineTokens(h, opened[F01].id, 18, dark)
  await revealLine(h, opened[F01].id, 11, 1)
  const change = lineTokens(h, opened[F01].id, 11, dark)
  const three = {
    tool: change?.find((t) => t.text === 'T1')?.color,
    feed: cutting?.find((t) => t.text === 'F400.')?.color,
    axis: cutting?.find((t) => t.text === 'Z-5.')?.color,
  }
  h.check('tool, feed and axis are three different colours', new Set(Object.values(three)).size === 3 && !Object.values(three).includes(undefined), three)
  h.check(
    'and each is the colour its role has in the palette',
    three.tool === rgbOf(palette.dark.tool) && three.feed === rgbOf(palette.dark.feed) && three.axis === rgbOf(palette.dark.axis),
    { got: three, want: { tool: rgbOf(palette.dark.tool), feed: rgbOf(palette.dark.feed), axis: rgbOf(palette.dark.axis) } },
  )

  // ------------------------------------------------------------ no `invalid` on a valid line
  // `invalid` has a colour of its own in both themes, so a token painted with it is
  // unmistakable. The generated grammar never emits it — `defaultToken` is `''` and
  // marking an error is the linter's job (M4), not the highlighter's.
  const invalidColor = rgbOf(palette.dark.invalid)
  /** @type {string[]} */
  const marked = []
  const scan = async (/** @type {string} */ id) => {
    const lines = ctx.editor.getLineCount(id)
    for (let line = 1; line <= lines; line += 15) {
      await revealLine(h, id, Math.min(line, lines), 1)
      for (const span of h.q('editor-host')?.querySelectorAll('.view-lines .view-line span > span') ?? []) {
        if (getComputedStyle(span).color === invalidColor) marked.push(`${ctx.docs.get(id)?.title}: ${plain(span.textContent)}`)
      }
    }
  }
  for (const file of NO_INVALID) await scan(opened[file].id)

  const whitespaceId = ctx.files.newUntitled({ profileId: 'fanuc-gcode', text: WHITESPACE_PROGRAM })
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === whitespaceId, { timeout: 10000 })
  await scan(whitespaceId)
  h.check('no token on a valid line is marked invalid, whitespace included', marked.length === 0, marked)

  await revealLine(h, whitespaceId, 1, 1)
  const padded = paintedRoles(h, dark)
  h.check('a block with padding and tabs is still a coloured block', padded.get('T1') === 'tool' && padded.get('M6') === 'mcode' && padded.get('X10.') === 'axis', [...padded])
  h.check('an indented comment is a comment', padded.get('(INDENTED COMMENT)') === 'comment', [...padded])

  // ------------------------------------------------------------ the light theme is generated too
  await setTheme(h, 'light')
  await revealLine(h, opened[F01].id, 11, 1)
  const lightTokens = lineTokens(h, opened[F01].id, 11, light)
  h.check('the light theme paints the same roles from the light palette', roleOf(lightTokens, 'T1') === 'tool' && roleOf(lightTokens, 'M6') === 'mcode', lightTokens)
  h.check('the light tool colour is the light one, not the dark one', lightTokens?.find((t) => t.text === 'T1')?.color === rgbOf(palette.light.tool), {
    got: lightTokens?.find((t) => t.text === 'T1')?.color,
    light: rgbOf(palette.light.tool),
    dark: rgbOf(palette.dark.tool),
  })
  await setTheme(h, 'dark')

  // Nothing here edits a file on disk; the scratch buffer is the only dirty document.
  h.check(
    'the scenario changed no file it opened',
    ctx.docs.all().filter((d) => d.path !== null).every((d) => !d.dirty),
    ctx.docs.all().map((d) => `${d.title}:${d.dirty}`),
  )
})
