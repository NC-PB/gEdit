// Helpers the M3 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Three things are worth knowing before reading a check that uses these:
//
//   1. **The expected colours are read out of `core/grammar/roles.ts`, not retyped.**
//      A scenario file is imported by the *node* runner as well as bundled into the page,
//      so it cannot `import` a `.ts` module — node would refuse it. `loadPalette()` takes
//      the other route: the scenario asks for the repository path with the `{repo}`
//      placeholder and reads the source at run time. `PALETTE_ROLES` is then checked
//      against what was parsed, so a reformatted palette fails loudly instead of silently
//      shrinking the set of colours a scenario knows about.
//   2. **Only the rendered viewport is in the DOM.** Monaco draws the lines around the
//      scroll position and nothing else, and M2 restores the cursor of a file this HOME
//      has seen before — so every paint read reveals its line first. A run folder is
//      reused between runs of the same scenario, which is what makes that bite on the
//      *second* run and not the first (mergeB §4.2).
//   3. **The hover and the suggest widget keep their last DOM after being hidden.** Both
//      readers below hide the widget, remember what is on screen, ask for a new one and
//      wait for the contents to *change*; "unchanged" is reported as "there is nothing
//      here" rather than as the previous answer (WP3.6 §6, mergeB §4.4).

/** @typedef {import('../lib/api.js').Harness} Harness */
/** @typedef {import('$lib/app/types').AppContext} AppContext */
/** @typedef {Record<string, string>} Palette role → `#rrggbb` */

/**
 * The scenario option that makes `loadPalette` and `repoPath` work: the runner fills the
 * placeholder in before the app starts.
 */
export const REPO_FILE = { 'repo-path.txt': '{repo}' }

/**
 * Every role `core/grammar/roles.ts` defines (§7.4). The parse below must find all of
 * them in both themes, which is what turns a reformatted source into a failed check
 * rather than into a scenario that quietly stops knowing some colours.
 */
export const PALETTE_ROLES = [
  'blockNumber',
  'skip',
  'gcode',
  'mcode',
  'axis',
  'arcCenter',
  'feed',
  'spindle',
  'tool',
  'variable',
  'keyword',
  'comment',
  'section',
  'programMarker',
  'number',
  'string',
  'operator',
  'invalid',
]

/** The app context, typed once so every scenario does not repeat the cast. */
export const context = (/** @type {Harness} */ h) => /** @type {AppContext} */ (h.app.ctx)

/** The repository this run was started from. Needs `files: REPO_FILE`. */
export async function repoPath(/** @type {Harness} */ h) {
  const text = await h.disk.read(`${h.cfg.run}/repo-path.txt`)
  return text.trim()
}

/**
 * `ROLE_COLORS` as the source file spells it. Needs `files: REPO_FILE`.
 * @param {Harness} h
 * @returns {Promise<{ dark: Palette, light: Palette }>}
 */
export async function loadPalette(h) {
  const source = await h.disk.read(`${await repoPath(h)}/src/lib/core/grammar/roles.ts`)
  const body = source.slice(source.indexOf('export const ROLE_COLORS'))
  /** @type {{ dark: Palette, light: Palette }} */
  const themes = { dark: {}, light: {} }
  for (const theme of /** @type {const} */ (['dark', 'light'])) {
    const start = body.indexOf(`  ${theme}: {`)
    const end = body.indexOf('\n  },', start)
    if (start < 0 || end < 0) continue
    for (const [, role, hex] of body.slice(start, end).matchAll(/([A-Za-z]\w*):\s*'(#[0-9a-fA-F]{6})'/g)) themes[theme][role] = hex
  }
  return themes
}

/** `#rrggbb` in the `rgb(r, g, b)` form `getComputedStyle` returns. */
export function rgbOf(/** @type {string} */ hex) {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/**
 * colour → role, for naming what a token was actually painted as. Every colour in a theme
 * is unique (`roles.test.ts` is the gate), so nothing is lost.
 * @param {Palette} palette
 * @returns {Record<string, string>}
 */
export function rolesByColor(palette) {
  /** @type {Record<string, string>} */
  const map = {}
  for (const [role, hex] of Object.entries(palette)) map[rgbOf(hex)] = role
  return map
}

/** Monaco renders a space inside a token as NBSP; a check on text should not care. */
export const plain = (/** @type {string | null | undefined} */ text) => (text ?? '').replace(/\u00a0/g, ' ')

// ---------------------------------------------------------------- the app

/**
 * Switches the app to one of the two generated themes and waits for it to take.
 * @param {Harness} h
 * @param {'dark' | 'light'} mode
 */
export async function setTheme(h, mode) {
  await context(h).commands.run('view.setTheme', mode)
  await h.waitFor(() => document.documentElement.dataset.theme === mode, { timeout: 5000 })
  await h.idle()
}

/**
 * Opens a file through the app's own open command, waits until Monaco shows it, and puts
 * the cursor back on line 1.
 *
 * The path goes through the queued file dialog rather than straight into
 * `files.open([path])`, because the fs scope only holds what a dialog picked or a drop
 * granted: handing `fileOps` an ungranted path makes the backend refuse the read, and the
 * app answers that with a native error box nobody is there to click.
 * @param {Harness} h
 * @param {string} path absolute
 * @returns {Promise<{ path: string, id: string }>}
 */
export async function openPath(h, path) {
  const ctx = context(h)
  await h.dialogs.queue('open', path)
  const opened = await ctx.files.open()
  const id = opened[0] ?? ctx.docs.byPath(path)?.id
  if (id === undefined) throw new Error(`openPath: ${path} did not open`)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 15000 })
  await revealLine(h, id, 1, 1)
  return { path, id }
}

/**
 * A fresh copy of `tests/fixtures/<rel>`, opened.
 * @param {Harness} h
 * @param {string} rel path under `tests/fixtures`
 * @returns {Promise<{ path: string, id: string }>}
 */
export async function openFixture(h, rel) {
  return openPath(h, await h.fixture(rel))
}

/**
 * Puts the cursor on a line and waits for the paint, so that line is in the DOM.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {number} [column]
 */
export async function revealLine(h, id, line, column = 1) {
  context(h).editor.reveal(id, line, column)
  await h.idle()
}

// ---------------------------------------------------------------- what is painted

/** @typedef {{ text: string, color: string, role: string }} PaintedToken */

/**
 * The tokens Monaco has drawn for one document line, in order.
 *
 * The view line is found by its text rather than by its position, because `.view-lines`
 * holds the rendered window in the DOM order recycling left behind, not in document order.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line 1-based
 * @param {Record<string, string>} names colour → role, from `rolesByColor`
 * @returns {PaintedToken[] | null} null when the line is not on screen
 */
export function lineTokens(h, id, line, names) {
  const want = plain(context(h).editor.getLines(id, line, line)[0] ?? '')
  for (const element of h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? []) {
    if (plain(element.textContent) !== want) continue
    return [...element.querySelectorAll('span > span')].map((span) => {
      const color = getComputedStyle(span).color
      return { text: plain(span.textContent), color, role: names[color] ?? '(default)' }
    })
  }
  return null
}

/**
 * The role a piece of text was painted as on a line, or a reason it could not be read.
 *
 * Monaco emits one span per *colour*, not one per token, so a packed block comes back as
 * `N10` + `G0G90` + `X0Y0` rather than as five spans. A word found inside a span was
 * therefore painted in that span's colour — which is the whole claim — so containment is
 * accepted, and only when exactly one span holds the word.
 * @param {PaintedToken[] | null} tokens
 * @param {string} text
 * @returns {string}
 */
export function roleOf(tokens, text) {
  if (tokens === null) return '(line not rendered)'
  const exact = tokens.find((candidate) => candidate.text === text)
  if (exact !== undefined) return exact.role
  const inside = tokens.filter((candidate) => candidate.text.includes(text))
  if (inside.length === 1) return inside[0].role
  return inside.length === 0 ? '(no such token)' : '(in more than one span)'
}

/**
 * text → role over every line Monaco currently has on screen (first occurrence wins).
 * @param {Harness} h
 * @param {Record<string, string>} names colour → role
 */
export function paintedRoles(h, names) {
  /** @type {Map<string, string>} */
  const seen = new Map()
  for (const span of h.q('editor-host')?.querySelectorAll('.view-lines .view-line span > span') ?? []) {
    const text = plain(span.textContent).trim()
    if (text !== '' && !seen.has(text)) seen.set(text, names[getComputedStyle(span).color] ?? '(default)')
  }
  return seen
}

// ---------------------------------------------------------------- the two widgets

const hoverNode = () => document.querySelector('.monaco-hover .hover-contents')
const hoverNow = () => plain(hoverNode()?.textContent).trim()

/**
 * The hover the editor shows at a position, or '' when it shows none.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {number} column
 * @returns {Promise<string>}
 */
export async function hoverAt(h, id, line, column) {
  const ctx = context(h)
  // `showHover` only *focuses* a hover that is already up, so it has to be hidden first.
  ctx.editor.triggerAction('editor.action.hideHover')
  await h.idle()
  const before = hoverNow()
  await revealLine(h, id, line, column)
  ctx.editor.triggerAction('editor.action.showHover')
  await h.waitFor(() => hoverNow() !== before, { timeout: 2500 })
  const text = hoverNow()
  return text === before ? '' : text
}

/** The icon a suggestion row carries says where it came from. */
const DB_ICONS = ['symbol-function', 'symbol-snippet', 'symbol-keyword']

/** @typedef {{ label: string, text: string, icon: string, fromDb: boolean }} SuggestRow */

/**
 * The rows of the suggest widget. `label` is the item's own label — Monaco draws it in
 * `.label-name` and glues the detail straight after it with no separator, so the whole
 * `textContent` reads `G80Cancel the canned cycle` and cannot be split on whitespace.
 * @returns {SuggestRow[]}
 */
function suggestRows() {
  return [...document.querySelectorAll('.suggest-widget .monaco-list-row')].map((row) => {
    const icon = [...(row.querySelector('.suggest-icon')?.classList ?? [])].find((c) => c.startsWith('codicon-symbol-')) ?? ''
    const name = icon.replace('codicon-', '')
    const text = plain(row.textContent).trim()
    return { label: plain(row.querySelector('.label-name')?.textContent).trim() || text, text, icon: name, fromDb: DB_ICONS.includes(name) }
  })
}

/** Whether the suggest widget is actually drawn (it stays in the DOM after being hidden). */
export function suggestShowing() {
  const widget = /** @type {HTMLElement | null} */ (document.querySelector('.suggest-widget'))
  if (widget === null) return false
  const box = widget.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && getComputedStyle(widget).visibility !== 'hidden'
}

/**
 * What an explicit Ctrl+Space offers at a position.
 *
 * `db` separates the code database from Monaco's own word-based suggestions, which WP2.6
 * leaves on (`wordBasedSuggestions: 'currentDocument'`): inside a comment an explicit
 * trigger still answers with words copied out of the document, and a naive "no rows here"
 * check would fail on those (mergeB §4.3).
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {number} column
 * @returns {Promise<{ rows: SuggestRow[], db: SuggestRow[], showing: boolean }>}
 */
export async function suggestAt(h, id, line, column) {
  const ctx = context(h)
  ctx.editor.triggerAction('hideSuggestWidget')
  await h.idle()
  const before = JSON.stringify(suggestRows())
  await revealLine(h, id, line, column)
  ctx.editor.triggerAction('editor.action.triggerSuggest')
  await h.waitFor(() => JSON.stringify(suggestRows()) !== before, { timeout: 2500 })
  const now = suggestRows()
  const changed = JSON.stringify(now) !== before
  const showing = changed && suggestShowing()
  ctx.editor.triggerAction('hideSuggestWidget')
  await h.idle()
  const rows = changed ? now : []
  return { rows, db: rows.filter((row) => row.fromDb), showing }
}

// ---------------------------------------------------------------- the program map

/** Every program-map row as `line:kind:active`, for the detail of a failing check. */
export const mapRows = (/** @type {Harness} */ h) => h.qa('program-map-item').map((e) => `${e.dataset.line}:${e.dataset.kind}:${e.dataset.active}`)

// ---------------------------------------------------------------- a large program

/**
 * A deterministic 300k-line / 10 MB CAM program, the same shape `tests/gen/gen-large.mjs`
 * writes: a header, a tool change and a long run of cutting moves, CRLF throughout.
 * Generated in the page rather than checked in, because `.perf/` is gitignored and the
 * harness copies only `tests/fixtures`.
 *
 * It is deliberately the program `m1-perf-open` measures the open of, so the M1 and the
 * M3 numbers describe one document.
 * @param {{ lines?: number }} [o]
 */
export function largeProgram({ lines: minLines = 300000 } = {}) {
  const head = ['%', 'O9001 (PERF 300K)', 'G21 G17 G40 G49 G80 G90 G94', 'T1 M6', 'S3000 M3', 'G0 X0. Y0.', 'G43 Z25. H1 M8', 'G1 Z-1. F200.']
  const tail = ['G0 Z25.', 'M30', '%']
  const lines = [...head]
  let x = 0
  let y = 0
  let direction = 1
  const fixed = (/** @type {number} */ value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4)
  while (lines.length < minLines - tail.length) {
    x += 0.5 * direction
    if (x > 100 || x < 0) {
      direction = -direction
      x += 0.5 * direction
      y = y >= 80 ? 0 : y + 1
    }
    const z = -2 + Math.sin(x / 7) * Math.cos(y / 5)
    lines.push(`G1 X${fixed(x)} Y${fixed(y)} Z${fixed(z)} F800.`)
  }
  lines.push(...tail)
  return lines.join('\r\n') + '\r\n'
}
