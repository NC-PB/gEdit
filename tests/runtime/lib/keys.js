// Native key events for h.nativeKeys and h.nativeType: macOS virtual key codes of a
// US keyboard layout, and the characters AppKit would report for them.

/** @typedef {'cmd' | 'shift' | 'alt' | 'ctrl'} Mod */
/** @typedef {{ key: string, mods?: Mod[] }} KeySpec */

/**
 * @typedef {object} NativeKeyEvent
 * @property {'key'} kind
 * @property {string} chars
 * @property {number} keyCode
 * @property {boolean} cmd
 * @property {boolean} shift
 * @property {boolean} alt
 * @property {boolean} ctrl
 * @property {boolean} function NSEventModifierFlagFunction (arrows, F-keys, Home/End)
 */

/** @type {Record<string, number>} */
const CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14,
  r: 15, y: 16, t: 17, 1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, '=': 24, 9: 25, 7: 26,
  '-': 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, l: 37, j: 38,
  "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46, '.': 47, ' ': 49, '`': 50,
}

/** Shifted characters and the key that produces them. */
/** @type {Record<string, string>} */
const SHIFTED = {
  '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9',
  ')': '0', _: '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',',
  '>': '.', '?': '/', '~': '`',
}

/** Named keys: [keyCode, characters, function flag]. */
/** @type {Record<string, [number, string, boolean]>} */
const NAMED = {
  Enter: [36, '\r', false],
  Tab: [48, '\t', false],
  Space: [49, ' ', false],
  Backspace: [51, '', false],
  Escape: [53, '', false],
  Delete: [117, '', true],
  Home: [115, '', true],
  End: [119, '', true],
  PageUp: [116, '', true],
  PageDown: [121, '', true],
  ArrowLeft: [123, '', true],
  ArrowRight: [124, '', true],
  ArrowDown: [125, '', true],
  ArrowUp: [126, '', true],
  F1: [122, '', true],
  F2: [120, '', true],
  F3: [99, '', true],
  F4: [118, '', true],
  F5: [96, '', true],
  F6: [97, '', true],
  F7: [98, '', true],
  F8: [100, '', true],
  F9: [101, '', true],
  F10: [109, '', true],
  F11: [103, '', true],
  F12: [111, '', true],
}

/**
 * The event for one key press. `key` is a named key (`Enter`, `ArrowUp`, `F7`, …) or a
 * single character a US layout can type (`s`, `S`, `(`).
 * @param {KeySpec} spec
 * @returns {NativeKeyEvent}
 */
export function keyEvent({ key, mods = [] }) {
  const has = (/** @type {Mod} */ m) => mods.includes(m)
  const named = NAMED[key]
  if (named) {
    const [keyCode, chars, fn] = named
    return { kind: 'key', chars, keyCode, cmd: has('cmd'), shift: has('shift'), alt: has('alt'), ctrl: has('ctrl'), function: fn }
  }
  if ([...key].length !== 1) throw new Error(`unknown key ${JSON.stringify(key)}`)
  const lower = key.toLowerCase()
  const base = SHIFTED[key] ?? lower
  const code = CODES[base]
  if (code === undefined) {
    throw new Error(`no US key for ${JSON.stringify(key)}; use h.insertText() for other characters`)
  }
  const shifted = has('shift') || key in SHIFTED || key !== lower
  // AppKit reports the shifted character; Cmd does not change it.
  const chars = shifted && key === lower && !(key in SHIFTED) ? key.toUpperCase() : key
  return { kind: 'key', chars, keyCode: code, cmd: has('cmd'), shift: shifted, alt: has('alt'), ctrl: has('ctrl'), function: false }
}

/**
 * Events that type `text` key by key; `\n` presses Enter, `\t` presses Tab.
 * @param {string} text
 * @returns {NativeKeyEvent[]}
 */
export function typeEvents(text) {
  return [...text].map((ch) =>
    ch === '\n' ? keyEvent({ key: 'Enter' }) : ch === '\t' ? keyEvent({ key: 'Tab' }) : keyEvent({ key: ch }),
  )
}
