// Helpers of the scenarios of the B1 bug-fix round (suite `suites/b1.txt`). Registers no scenario.
//
// Every scenario of the round proves a behaviour the unit tests could only prove against a fake: the real
// window, the real Monaco, the real file system (a symlink, a folder the app cannot write) and the real
// native question. Expected text is `ctx.t(...)` or the goldens of the work package that changed it, never
// what the app happens to show.

import { python } from './m2-common.js'
import { context, revealLine } from './m3-common.js'
import { message, newDoc, ready, ribbonTab } from './m4-common.js'
import { osOp } from './m7-common.js'

export { context, message, newDoc, osOp, python, ready, revealLine, ribbonTab }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The ribbon tabs of B1 A9, in order. */
export const TABS = ['file', 'edit', 'insert', 'nc', 'tools', 'scripts', 'view']

const SYMLINK = `import json, os, sys
req = json.loads(sys.stdin.read())
os.symlink(req["target"], req["link"])
print(json.dumps({"link": os.path.realpath(req["link"]), "isLink": os.path.islink(req["link"])}))
`

/**
 * Makes a symbolic link `link` that points to `target`, outside the app (the helper API has no call for it).
 * @param {Harness} h
 * @param {string} target
 * @param {string} link
 * @returns {Promise<{ link: string, isLink: boolean }>}
 */
export async function symlink(h, target, link) {
  const result = await python(h, 'rh_symlink.py', SYMLINK, JSON.stringify({ target, link }))
  if (result.data === null) throw new Error(`symlink ${link}: ${result.stdout || result.stderr}`)
  return result.data
}

/**
 * The text a message with a `{name}` hole ends in, so a check does not depend on which spelling the message names.
 * @param {Harness} h
 * @param {string} key
 */
export function messageTail(h, key) {
  const mark = '\u0001'
  const parts = context(h).t(key, { name: mark }).split(mark)
  return parts[parts.length - 1]
}

/**
 * The document tabs that are bound to a file, as their paths in tab order.
 * @param {Harness} h
 */
export const tabPaths = (h) => h.qa('doc-tab').map((e) => e.dataset.path ?? '').filter((p) => p !== '')

/**
 * The visible Monaco hover, as a rectangle, with whether its content is cut off.
 * @returns {{ top: number, left: number, right: number, bottom: number, clipped: boolean, text: string } | null}
 */
export function hoverBox() {
  const widgets = [...document.querySelectorAll('.monaco-hover')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none'
  })
  const el = widgets[widgets.length - 1]
  if (!el) return null
  const r = el.getBoundingClientRect()
  const body = /** @type {HTMLElement | null} */ (el.querySelector('.monaco-scrollable-element, .hover-contents')) ?? /** @type {HTMLElement} */ (el)
  return {
    top: Math.round(r.top),
    left: Math.round(r.left),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
    clipped: body.scrollHeight > body.clientHeight + 1 && getComputedStyle(body).overflowY === 'hidden',
    text: (el.textContent ?? '').replace(/ /g, ' ').trim(),
  }
}

/**
 * Whether `row` is inside the visible part of the nearest scrolling ancestor.
 * @param {Element} row
 */
export function rowVisible(row) {
  /** @type {Element | null} */
  let scroller = row.parentElement
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
  if (!scroller) return { visible: true, scrolls: false, scrollTop: 0 }
  const outer = scroller.getBoundingClientRect()
  const r = row.getBoundingClientRect()
  return {
    visible: r.top >= outer.top - 1 && r.bottom <= outer.bottom + 1,
    scrolls: scroller.scrollHeight > scroller.clientHeight,
    scrollTop: scroller.scrollTop,
  }
}
