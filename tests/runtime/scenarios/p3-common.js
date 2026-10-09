// Helpers the P3a scenarios share (Phase 3 plan H3a). This file registers no scenario:
// `loadScenarios()` imports it like any other file under `scenarios/` and finds nothing new in it.
//
// What to know before reading a check that uses these:
//
//   1. **The inspector is read through its test ids** (plan §6.8; `inspector-panel`,
//      `inspector-row`, `inspector-cycle`, `inspector-state`, `inspector-edit`). A row is a
//      `div[role=button]`: a real double click on it, or Enter with the row focused, opens the value
//      prompt. `inspectLine` puts the cursor on a line and waits until the panel shows that block with
//      its state known, so a read never lands on the block before.
//   2. **The hover is read as the paragraphs and table rows Monaco rendered** (`hoverParts`), because
//      the context line is the *last paragraph* and the cycle table is a real `<table>`; the text the
//      Phase 2 scenarios compare (`hoverAt`) glues them together without separators.
//   3. **The motion marks are Monaco's own elements** in the line-decorations margin
//      (`.cldr.gedit-motion-mark.gedit-motion-<kind>`, P3.7); there is no test id. `marksOnScreen` reads
//      them row by row, paired with the line number of the same margin row.
//   4. **No expected text is retyped from the screen.** Wording comes from `ctx.t(key)`, the numbers
//      and kinds from the goldens of `tests/fixtures/modal/**` and `tests/fixtures/motion/**`, which
//      were written before the app showed them.

import { context, hoverAt, openFixture, openPath, plain, revealLine } from './m3-common.js'
import { ribbonTab } from './m4-common.js'

export { context, hoverAt, openFixture, openPath, plain, revealLine }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The Fanuc lathe program of X7. */
export const L01 = 'nc/fanuc-lathe/l01-turning-a.nc'

// ---------------------------------------------------------------- the inspector

/** The inspector's panel in the left region, or null while it is not the active left panel. @param {Harness} h */
export const inspectorPanel = (h) => h.q('panel', { region: 'left', panel: 'inspector' })

/**
 * Opens the inspector with its command and waits for the panel.
 * @param {Harness} h
 */
export async function showInspector(h) {
  if (!inspectorPanel(h)) await context(h).commands.run('view.toggleInspector')
  if (!(await h.waitFor(() => inspectorPanel(h) && h.q('inspector-panel'), { timeout: 5000 }))) throw new Error('the inspector did not open')
  await h.idle()
}

/**
 * Puts the cursor on `line` and waits until the inspector shows that line's block with its state
 * known (`data-ready="1"`).
 * @param {Harness} h
 * @param {string} id document
 * @param {number} line
 * @param {number} [column]
 * @returns {Promise<boolean>} whether the panel got there
 */
export async function inspectLine(h, id, line, column = 1) {
  await revealLine(h, id, line, column)
  const there = () => {
    const p = h.q('inspector-panel')
    return !!p && p.dataset.docId === id && Number(p.dataset.firstLine) <= line && line <= Number(p.dataset.lastLine) && p.dataset.ready === '1'
  }
  const ok = !!(await h.waitFor(there, { timeout: 8000 }))
  await h.idle()
  return ok && there()
}

/** @typedef {{ key: string, value: string, line: number, assumed: boolean, from: string, setHere: boolean }} StateRow */

/**
 * The state rows of the panel ("In force after this block"), by key.
 * @param {Harness} h
 * @returns {Map<string, StateRow>}
 */
export function stateRows(h) {
  /** @type {Map<string, StateRow>} */
  const out = new Map()
  for (const e of h.qa('inspector-state')) {
    const key = e.dataset.key ?? ''
    out.set(key, {
      key,
      value: plain(e.querySelector('.state-value')?.textContent).trim(),
      line: Number(e.dataset.line),
      assumed: e.dataset.assumed === '1',
      from: e.dataset.from ?? '',
      setHere: e.dataset.setHere === '1',
    })
  }
  return out
}

/**
 * The word rows of the panel.
 * @param {Harness} h
 */
export function wordRows(h) {
  return h.qa('inspector-row').map((e) => ({
    element: e,
    address: e.dataset.address ?? '',
    line: Number(e.dataset.line),
    kind: e.dataset.kind ?? '',
    editable: e.dataset.editable === '1',
    value: e.dataset.value ?? '',
    readings: Number(e.dataset.readings ?? 0),
    text: plain(e.textContent).trim(),
    /** The reading lines ("depends on the machine"), in the order shown. */
    readingLines: [...e.querySelectorAll('.readings li')].map((li) => plain(li.textContent).trim()),
    /** The note lines under the value (assumed values, hints). */
    notes: [...e.querySelectorAll('ul.notes li')].map((li) => plain(li.textContent).trim()),
  }))
}

/**
 * The row of word `address` on `line`; the first when `text` is not given.
 * @param {Harness} h
 * @param {string} address
 * @param {number} [line]
 * @param {string} [startsWith] the written word, e.g. `X50`
 */
export function wordRow(h, address, line, startsWith) {
  return wordRows(h).find((r) => r.address === address && (line === undefined || r.line === line) && (startsWith === undefined || r.text.startsWith(startsWith)))
}

/** How the last `openEdit` got its prompt: `real` (the native double click or Enter) or `dom` (a dispatched `dblclick`). */
export const opened = { how: '' }

/**
 * Opens the value prompt of a row the way a user does: a real double click on it, or Enter on the focused row.
 * A native click can be lost when another app took the keyboard a moment before (the harness takes it back
 * and says so in the run's focus records), so the real double click is tried up to three times with the window
 * brought to the front first; only then is a `dblclick` dispatched on the row, which the page cannot tell from
 * the browser's own (`opened.how` says which one it was). Resolves with the prompt's input, or null.
 * @param {Harness} h
 * @param {Element} row
 * @param {'doubleClick' | 'enter'} [how]
 * @returns {Promise<HTMLInputElement | null>}
 */
export async function openEdit(h, row, how = 'doubleClick') {
  const prompt = async (/** @type {number} */ timeout) => /** @type {HTMLInputElement | null} */ ((await h.waitFor(() => h.q('inspector-edit'), { timeout })) ?? null)
  /** @type {HTMLInputElement | null} */
  let input = null
  opened.how = ''
  /** @type {string[]} */
  const seen = []
  const watch = (/** @type {Event} */ e) => seen.push(`${e.type}:${/** @type {MouseEvent} */ (e).detail}@${/** @type {HTMLElement} */ (e.target).tagName}`)
  const types = ['mousedown', 'mouseup', 'click', 'dblclick']
  for (const t of types) document.addEventListener(t, watch, true)
  for (let attempt = 0; attempt < 3 && input === null; attempt++) {
    await h.window.ensureFront()
    if (how === 'doubleClick') {
      await h.nativeClick(/** @type {HTMLElement} */ (row), { clickCount: 2 })
    } else {
      /** @type {HTMLElement} */ (row).focus()
      await h.nativeKeys([{ key: 'Enter' }])
    }
    input = await prompt(1500)
    if (input !== null) opened.how = 'real'
    else h.log(`openEdit attempt ${attempt + 1} opened no prompt; the page saw: ${seen.join(' ')} (row ${JSON.stringify(row.getBoundingClientRect())}, connected ${row.isConnected})`)
  }
  for (const t of types) document.removeEventListener(t, watch, true)
  if (input === null) {
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    input = await prompt(1500)
    if (input !== null) opened.how = 'dom'
  }
  await h.idle()
  return input
}

/**
 * Replaces what the prompt holds with `text`, typed with real key presses.
 * @param {Harness} h
 * @param {string} text
 */
export async function typeInPrompt(h, text) {
  const input = /** @type {HTMLInputElement} */ (h.q('inspector-edit'))
  input.focus()
  input.select()
  await h.nativeKeys([{ key: 'Backspace' }])
  await h.nativeType(text)
  await h.idle()
  return input.value
}

// ---------------------------------------------------------------- the hover

/**
 * What the hover shows, as the paragraphs and the table rows Monaco rendered. Call it right after
 * `hoverAt` (the widget keeps its DOM after it is hidden).
 * @returns {{ paragraphs: string[], items: string[], html: string, rows: { word: string, meaning: string, written: string, notWritten: boolean }[], heading: string, last: string, text: string }}
 */
export function hoverParts() {
  const root = document.querySelector('.monaco-hover .hover-contents')
  const paragraphs = [...(root?.querySelectorAll('p') ?? [])].map((p) => plain(p.textContent).trim())
  const rows = [...(root?.querySelectorAll('table tbody tr') ?? [])].map((tr) => {
    const cells = [...tr.querySelectorAll('td')]
    return {
      word: plain(cells[0]?.textContent).trim(),
      meaning: plain(cells[1]?.textContent).trim(),
      written: plain(cells[2]?.textContent).trim(),
      notWritten: !!cells[2]?.querySelector('em'),
    }
  })
  // The paragraph that heads the table is the bold one that is not the first.
  const heading = [...(root?.querySelectorAll('p') ?? [])].filter((p, i) => i > 0 && p.querySelector('strong') !== null).map((p) => plain(p.textContent).trim())[0] ?? ''
  const items = [...(root?.querySelectorAll('li') ?? [])].map((li) => plain(li.textContent).trim())
  return { paragraphs, items, rows, heading, last: paragraphs.at(-1) ?? '', text: plain(root?.textContent).trim(), html: root?.innerHTML ?? '' }
}

/**
 * The hover on a word, found by its text in the line so no column is retyped.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {string} word the text to hover (its first occurrence in the line)
 */
export async function hoverOn(h, id, line, word) {
  const text = context(h).editor.getLines(id, line, line)[0] ?? ''
  const at = text.indexOf(word)
  if (at < 0) throw new Error(`hoverOn: ${JSON.stringify(word)} is not in line ${line}: ${JSON.stringify(text)}`)
  const flat = await hoverAt(h, id, line, at + 2)
  return { flat, ...hoverParts() }
}

// ---------------------------------------------------------------- the motion marks

/** The kinds, as the class suffix `gedit-motion-<kind>` spells them. */
export const KINDS = ['rapid', 'linear', 'arc', 'thread', 'cycle']

/**
 * The mark of every line Monaco has drawn in the margin: line number -> kind, or null for a line
 * with no mark.
 * @param {Harness} h
 * @returns {Map<number, string | null>}
 */
export function marksOnScreen(h) {
  /** @type {Map<number, string | null>} */
  const out = new Map()
  for (const row of h.q('editor-host')?.querySelectorAll('.margin-view-overlays > div') ?? []) {
    const n = Number(plain(row.querySelector('.line-numbers')?.textContent).trim())
    if (!(n > 0)) continue
    const mark = row.querySelector('.cldr.gedit-motion-mark')
    const kind = mark === null ? null : ([...mark.classList].find((c) => c.startsWith('gedit-motion-') && c !== 'gedit-motion-mark')?.slice('gedit-motion-'.length) ?? '?')
    out.set(n, kind)
  }
  return out
}

/** How many motion marks are drawn in the margin right now. @param {Harness} h */
export const markCount = (h) => h.q('editor-host')?.querySelectorAll('.margin-view-overlays .cldr.gedit-motion-mark').length ?? 0

/**
 * The motion decorations the editor model holds: `{ line, kind }` for each, whatever is drawn.
 * @param {Harness} h
 * @returns {{ line: number, kind: string }[]}
 */
export function markDecorations(h) {
  const editor = /** @type {any} */ (context(h).editor.editorInstance())
  const model = editor?.getModel()
  if (!model) return []
  /** @type {{ line: number, kind: string }[]} */
  const out = []
  for (const d of model.getAllDecorations()) {
    const cls = String(d.options?.linesDecorationsClassName ?? '')
    if (!cls.includes('gedit-motion-mark')) continue
    out.push({ line: d.range.startLineNumber, kind: cls.split(/\s+/).find((c) => c.startsWith('gedit-motion-') && c !== 'gedit-motion-mark')?.slice('gedit-motion-'.length) ?? '?' })
  }
  return out
}

/**
 * `MOTION_COLORS` as `core/nc/motion.ts` spells them (the scenario asks for the repository path with
 * `REPO_FILE`; node cannot import the `.ts`). A reformatted source fails the caller's check.
 * @param {string} source text of `src/lib/core/nc/motion.ts`
 * @returns {{ dark: Record<string, string>, light: Record<string, string> }}
 */
export function parseMotionColors(source) {
  const body = source.slice(source.indexOf('export const MOTION_COLORS'))
  /** @type {{ dark: Record<string, string>, light: Record<string, string> }} */
  const themes = { dark: {}, light: {} }
  for (const theme of /** @type {const} */ (['dark', 'light'])) {
    const start = body.indexOf(`  ${theme}: {`)
    const end = body.indexOf('\n  },', start)
    if (start < 0 || end < 0) continue
    for (const [, kind, hex] of body.slice(start, end).matchAll(/([a-z]+):\s*'(#[0-9a-fA-F]{6})'/g)) themes[theme][kind] = hex
  }
  return themes
}

/**
 * Switches Motion Colors with the View tab's button, the way a user does.
 * @param {Harness} h
 */
export async function clickMotionColors(h) {
  await ribbonTab(h, 'view')
  const button = h.q('cmd-button', { command: 'view.toggleMotionColors' })
  if (!button) throw new Error('the View tab has no Motion Colors button')
  h.click(button)
  await h.idle()
}

// ---------------------------------------------------------------- stalls

/**
 * Watches the main thread: a timer that re-arms itself every 4 ms, so the gap between two ticks is how
 * long one task kept the page busy (plus the timer). The worst gap is the longest stall.
 * @returns {{ stop: () => number, worst: () => number, gaps: () => { at: number, gap: number }[] }}
 */
export function stallMonitor() {
  const origin = performance.now()
  let last = origin
  let worst = 0
  /** @type {{ at: number, gap: number }[]} */
  const longGaps = []
  let running = true
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  const tick = () => {
    const now = performance.now()
    worst = Math.max(worst, now - last)
    if (now - last > 30) longGaps.push({ at: Math.round(now - origin), gap: Math.round(now - last) })
    last = now
    if (running) timer = setTimeout(tick, 4)
  }
  timer = setTimeout(tick, 4)
  return {
    worst: () => worst,
    gaps: () => longGaps,
    stop: () => {
      running = false
      if (timer !== undefined) clearTimeout(timer)
      return worst
    },
  }
}

/** Percentile of a sample, nearest rank. @param {number[]} values @param {number} p */
export function percentile(values, p) {
  if (values.length === 0) return -1
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

// ---------------------------------------------------------------- timing the page

/** Resolves at the moment a DOM change makes `predicate` true, sampling on every mutation; null on timeout. @param {() => boolean} predicate @param {number} timeout @returns {Promise<number | null>} */
export function untilDom(predicate, timeout) {
  return new Promise((resolve) => {
    if (predicate()) return resolve(performance.now())
    /** @param {number | null} value */
    const done = (value) => {
      observer.disconnect()
      clearTimeout(timer)
      resolve(value)
    }
    const observer = new MutationObserver(() => {
      if (predicate()) done(performance.now())
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true })
    const timer = setTimeout(() => done(null), timeout)
  })
}

/** Resolves with the time of the next frame. */
export const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())))

/** Whether Monaco has drawn a view line with exactly this text. @param {Harness} h @param {string} text */
export function drawn(h, text) {
  for (const line of h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? []) if (plain(line.textContent) === text) return true
  return false
}

/**
 * Types `count` characters (`1`) at the end of `line` with real key presses and measures each one: the time
 * from the keydown to the DOM change that draws it (`m12-perf`'s and `m3-perf`'s way).
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {number} count
 */
export async function measureTyping(h, id, line, count) {
  const ctx = context(h)
  const modelLine = () => ctx.editor.getLines(id, line, line)[0] ?? ''
  const focus = async () => {
    ctx.editor.reveal(id, line, modelLine().length + 1)
    await h.idle()
    return h.focusEditor() && h.app.cursor().line === line
  }
  const focused = await focus()
  await h.nativeKeys([{ key: '1' }])
  let warmed = (await untilDom(() => drawn(h, modelLine()), 15000)) !== null
  if (!warmed) {
    await focus()
    await h.nativeKeys([{ key: '1' }])
    warmed = (await untilDom(() => drawn(h, modelLine()), 15000)) !== null
  }
  /** @type {number[]} */
  const dom = []
  /** @type {number[]} */
  const keydownAt = []
  let retries = 0
  const stamp = () => keydownAt.push(performance.now())
  window.addEventListener('keydown', stamp, true)
  try {
    for (let i = 0; i < count; i++) {
      const want = `${modelLine()}1`
      keydownAt.length = 0
      let waiting = untilDom(() => drawn(h, want), 5000)
      await h.nativeKeys([{ key: '1' }])
      let shown = await waiting
      if (shown === null && modelLine() !== want) {
        retries++
        await focus()
        keydownAt.length = 0
        waiting = untilDom(() => drawn(h, want), 5000)
        await h.nativeKeys([{ key: '1' }])
        shown = await waiting
      }
      if (shown === null || keydownAt.length === 0) break
      await nextPaint()
      dom.push(shown - keydownAt[0])
    }
  } finally {
    window.removeEventListener('keydown', stamp, true)
  }
  return { focused, warmed, retries, count: dom.length, domP95: dom.length > 0 ? Math.round(percentile(dom, 95)) : -1, samples: dom.map(Math.round) }
}

/**
 * Runs `action` (an edit, a machine switch) and watches the page until the modal index and the outline of
 * `id` have both caught up. The outline rebuilds in its own 20k-line chunks (`app/outlineService.ts`, Phase
 * 1), and each of those chunks costs the page about 95 ms at this size; that is not the index, so the stall
 * of the index is the longest gap *after* the outline was done, when the index is still building. When the
 * index finishes first its own gaps are all there is.
 * @param {Harness} h
 * @param {string} id
 * @param {() => void | Promise<void>} action
 */
export async function watchRebuild(h, id, action) {
  const ctx = context(h)
  const monitor = stallMonitor()
  const origin = performance.now()
  /** @type {{ modal: number, outline: number }} */
  const done = { modal: -1, outline: -1 }
  await action()
  const modal = ctx.modal.whenReady(id).then(() => (done.modal = Math.round(performance.now() - origin)))
  const outline = ctx.outline.whenReady(id).then(() => (done.outline = Math.round(performance.now() - origin)))
  await Promise.all([modal, outline])
  monitor.stop()
  const gaps = monitor.gaps()
  const worstAll = Math.round(monitor.worst())
  const after = gaps.filter((g) => g.at > done.outline)
  // A window with no gap over 30 ms has a worst gap below that; the monitor keeps only the overall worst, so
  // the worst after the outline is the biggest gap listed, or "under 30" (reported as 30).
  const worstAfterOutline = done.modal > done.outline ? (after.length > 0 ? Math.max(...after.map((g) => g.gap)) : 30) : null
  return { done, gaps, worstAll, worstAfterOutline, isolated: done.modal > done.outline }
}

/**
 * How long the hover takes at a position, from the trigger to the content: the cursor is put there and the
 * editor settled first, so the scroll to a line far away is not in the number. Resolves with the time in ms,
 * or -1 when no new hover appeared.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 * @param {number} column
 */
export async function hoverLatency(h, id, line, column) {
  const ctx = context(h)
  ctx.editor.triggerAction('editor.action.hideHover')
  await h.idle()
  const read = () => plain(document.querySelector('.monaco-hover .hover-contents')?.textContent).trim()
  const before = read()
  await revealLine(h, id, line, column)
  await h.idle()
  const started = performance.now()
  ctx.editor.triggerAction('editor.action.showHover')
  const shown = await untilDom(() => read() !== before, 5000)
  return shown === null ? -1 : shown - started
}
