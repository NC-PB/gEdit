// The helper API that scenarios get as `h` (plan §7.9). Runs inside the app page.

import { keyEvent, typeEvents } from './keys.js'

/** @typedef {import('./recorder.js').Recorder} Recorder */
/** @typedef {import('./recorder.js').Send} Send */
/** @typedef {import('./keys.js').KeySpec} KeySpec */
/** @typedef {import('$lib/app/testHook').GeditTestHook} GeditTestHook */

/**
 * What the runner passes to the page.
 * @typedef {object} RunConfig
 * @property {string} scenario
 * @property {string} run run folder (canonical path)
 * @property {string} home HOME of the app
 * @property {string} python interpreter the harness uses for GEDIT_PYTHON by default
 * @property {string} appVersion version in the synced package.json
 */

/**
 * @typedef {object} ExitExpectation
 * @property {number} [code] expected exit code (default 0)
 * @property {number} [within] ms to wait for the exit after the scenario returns (default 10000)
 * @property {{ path: string, includes?: string, excludes?: string, hex?: string, missing?: boolean }[]} [files]
 *   checked by the runner after the exit
 * @property {string[]} [events] run events the app must have printed, e.g. `MenuEvent quit`
 */

/** @typedef {{ len: number, mtimeMs: number, mode: number, isFile: boolean, isDir: boolean }} Stat */
/** @typedef {{ texts: string[], buttons: string[], count: number }} AlertInfo */
/** @typedef {Record<string, string | number | boolean>} Attrs */

// Attributes matched literally by h.q; any other key is a data attribute (`docId` -> `data-doc-id`).
const PLAIN_ATTRS = new Set(['disabled', 'role', 'title', 'hidden', 'checked', 'value', 'id'])

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Calls a backend command through Tauri's IPC.
 * @param {string} cmd
 * @param {Record<string, unknown> | Uint8Array} [args] a raw byte body goes to commands
 *   that take one (`plugin:fs|write_file`), together with `options.headers`
 * @param {{ headers?: Record<string, string> }} [options]
 * @returns {Promise<any>}
 */
export function invoke(cmd, args, options) {
  return /** @type {any} */ (window).__TAURI_INTERNALS__.invoke(cmd, args, options)
}

/**
 * `[data-testid=…]` plus attribute filters: a string or number must match exactly,
 * `true` requires the attribute, `false` requires it to be absent.
 * @param {string} testid
 * @param {Attrs} [attrs]
 */
export function selector(testid, attrs = {}) {
  let sel = `[data-testid="${CSS.escape(testid)}"]`
  for (const [key, value] of Object.entries(attrs)) {
    const attr =
      key.includes('-') || PLAIN_ATTRS.has(key)
        ? key
        : 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    if (value === true) sel += `[${attr}]`
    else if (value === false) sel += `:not([${attr}])`
    else sel += `[${attr}="${CSS.escape(String(value))}"]`
  }
  return sel
}

/**
 * @param {RunConfig} cfg
 * @param {Recorder} rec
 * @param {Send} send
 */
export function createHarness(cfg, rec, send) {
  /** @type {{ name: string, pass: boolean }[]} */
  const checks = []
  /** @type {ExitExpectation | null} */
  let exitExpected = null

  /**
   * @template T
   * @param {() => T | Promise<T>} fn
   * @param {{ timeout?: number, interval?: number }} [opts]
   * @returns {Promise<T | undefined>} the first truthy value, or the last value on timeout
   */
  async function waitFor(fn, { timeout = 5000, interval = 50 } = {}) {
    const end = performance.now() + timeout
    for (;;) {
      /** @type {T | undefined} */
      let v
      try {
        v = await fn()
      } catch {
        v = undefined
      }
      if (v || performance.now() >= end) return v
      await sleep(interval)
    }
  }

  /**
   * @param {string} testid
   * @param {Attrs} [attrs]
   * @returns {HTMLElement | null}
   */
  const q = (testid, attrs) => document.querySelector(selector(testid, attrs))

  /**
   * @param {string} testid
   * @param {Attrs} [attrs]
   * @returns {HTMLElement[]}
   */
  const qa = (testid, attrs) => [...document.querySelectorAll(selector(testid, attrs))].map((e) => /** @type {HTMLElement} */ (e))

  /** Focuses the editor's input (Monaco's hidden textarea inside editor-host). */
  const focusEditor = () => {
    const input = q('editor-host')?.querySelector('textarea')
    input?.focus()
    return !!input && document.activeElement === input
  }

  const h = {
    cfg,
    /** Recorded violations, console output, IPC and dialog calls of this page. */
    rec,
    sleep,
    invoke,

    /** @param {...unknown} args */
    log(...args) {
      send({ kind: 'log', msg: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') })
    },

    /**
     * Records a check; a false `cond` fails the scenario (the scenario keeps running).
     * @param {string} name
     * @param {unknown} cond
     * @param {unknown} [detail] evidence stored with the result
     * @returns {boolean} whether it passed
     */
    check(name, cond, detail) {
      const pass = !!cond
      checks.push({ name, pass })
      send({ kind: 'check', name, pass, detail })
      return pass
    },

    /** Checks recorded so far. */
    checks: () => checks.slice(),

    waitFor,
    q,
    qa,

    /**
     * Clicks an element the way the DOM does (`el.click()`); for a real mouse event use nativeClick.
     * @param {HTMLElement | null | undefined} el
     */
    click(el) {
      if (!el) throw new Error('h.click: no element')
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      el.click()
    },

    /**
     * Picks an option of a `<select>` and fires `input` and `change` like a user choice.
     * @param {HTMLElement | null | undefined} el
     * @param {string} value
     */
    select(el, value) {
      if (!(el instanceof HTMLSelectElement)) throw new Error('h.select: not a <select>')
      if (![...el.options].some((o) => o.value === value)) throw new Error(`h.select: no option ${value}`)
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },

    /**
     * Real key presses (NSEvents), e.g. `[{ key: 's', mods: ['cmd'] }]`.
     * @param {KeySpec[]} keys
     * @returns {Promise<string[]>}
     */
    nativeKeys: (keys) => invoke('h_native_input', { events: keys.map(keyEvent) }),

    /**
     * Types US-layout text with real key presses (`\n` = Enter). The editor must have focus.
     * @param {string} text
     * @returns {Promise<string[]>}
     */
    nativeType: (text) => invoke('h_native_input', { events: typeEvents(text) }),

    /**
     * A real mouse click at the element's center. macOS only delivers it when the app
     * could be activated; see h.window.state().active.
     * @param {HTMLElement | null | undefined} el
     * @param {{ dx?: number, dy?: number, clickCount?: number }} [opts] offset from the center
     * @returns {Promise<string[]>}
     */
    nativeClick(el, { dx = 0, dy = 0, clickCount = 1 } = {}) {
      if (!el) throw new Error('h.nativeClick: no element')
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2 + dx
      const y = window.innerHeight - (r.top + r.height / 2 + dy)
      return invoke('h_native_input', { events: [{ kind: 'click', x, y, clickCount }] })
    },

    /** Focuses the editor input (like clicking into the text); returns whether it has focus. */
    focusEditor,

    /**
     * Inserts text into the editor at the cursor, the way an input method does
     * (synthetic). Use it for characters a US key press cannot produce.
     * @param {string} text
     */
    insertText(text) {
      if (!focusEditor()) throw new Error('h.insertText: the editor input cannot take focus')
      return document.execCommand('insertText', false, text)
    },

    /** The native window title, read from Rust. @returns {Promise<string>} */
    title: () => invoke('h_title'),

    dialogs: {
      /**
       * Queues the answer of the next fake file dialog of that kind: a path, a list of
       * paths, or null for Cancel. The stub grants picked paths like the dialog plugin.
       * @param {'open' | 'save' | 'folder'} kind
       * @param {string | string[] | null} result
       */
      queue: (kind, result) => invoke('h_queue_dialog', { kind, value: result }),
      /** Every dialog the app asked for so far (file dialogs and message boxes). */
      calls: () => rec.dialogCalls.slice(),
      /** Drops queued answers; resolves to the ones nobody used. @returns {Promise<string[]>} */
      clear: () => invoke('h_clear_dialogs'),
    },

    alert: {
      /** The front-most visible NSAlert, or null. @returns {Promise<AlertInfo | null>} */
      visible: () => invoke('h_alert_info'),
      /**
       * Waits for an NSAlert to appear.
       * @param {{ timeout?: number }} [opts]
       * @returns {Promise<AlertInfo | null>}
       */
      wait: ({ timeout = 5000 } = {}) => waitFor(() => invoke('h_alert_info'), { timeout, interval: 100 }),
      /**
       * Clicks a button of the real NSAlert (alternatives: `'OK|Ok'`), waiting up to
       * `timeout` ms for it; rejects when no such button shows up.
       * @param {string} label
       * @param {{ timeout?: number }} [opts]
       * @returns {Promise<{ texts: string[], buttons: string[], clicked: string }>}
       */
      click: (label, { timeout = 5000 } = {}) => invoke('h_alert_click', { label, timeoutMs: timeout }),
    },

    disk: {
      /** UTF-8 text of a file. @param {string} p @returns {Promise<string>} */
      read: (p) => invoke('h_read_disk', { path: p }),
      /**
       * Bytes as space-separated hex (`"ef bb bf 25"`).
       * @param {string} p
       * @param {number} [max] only the first `max` bytes
       * @returns {Promise<string>}
       */
      hex: (p, max) => invoke('h_hex', { path: p, max }),
      /**
       * @param {string} p
       * @param {string | { base64: string }} content
       * @returns {Promise<number>} bytes written
       */
      write: (p, content) =>
        typeof content === 'string'
          ? invoke('h_write_disk', { path: p, text: content })
          : invoke('h_write_disk', { path: p, base64: content.base64 }),
      /**
       * Sets the modification time, in seconds since the Unix epoch (default: now).
       * @param {string} p
       * @param {number} [secs]
       */
      touch: (p, secs = Date.now() / 1000) => invoke('h_touch_mtime', { path: p, secs }),
      /** @param {string} p @returns {Promise<Stat | null>} null when missing */
      async stat(p) {
        try {
          return await invoke('h_stat', { path: p })
        } catch {
          return null
        }
      },
      /** @param {string} from @param {string} to */
      copy: (from, to) => invoke('h_copy', { src: from, dst: to }),
    },

    /**
     * Drops files or folders on the window: grants them like tauri-plugin-fs does and
     * emits `tauri://drag-drop`.
     * @param {string[]} paths
     * @param {{ x?: number, y?: number }} [position]
     */
    drop: (paths, { x = 0, y = 0 } = {}) => invoke('h_drop', { paths, x, y }),

    /** Pids whose command line matches (pgrep -f). @param {string} pattern @returns {Promise<number[]>} */
    pgrep: (pattern) => invoke('h_pgrep', { pattern }),

    /** Child processes of the app, as "pid ppid command" lines. @returns {Promise<string[]>} */
    children: () => invoke('h_children'),

    /**
     * A fresh copy of `tests/fixtures/<rel>` (file or folder) in the run folder; with
     * `{ from: 'runtime' }` of `tests/runtime/fixtures/<rel>`.
     * @param {string} rel
     * @param {{ from?: 'fixtures' | 'runtime' }} [opts]
     * @returns {Promise<string>} absolute path of the copy
     */
    fixture: (rel, { from } = {}) => invoke('h_fixture', { rel, from }),

    /** The app's test hook (`window.__gedit`). */
    get app() {
      const app = window.__gedit
      if (!app) throw new Error('window.__gedit is missing (not a VITE_GEDIT_TEST=1 build?)')
      return app
    },

    window: {
      /** `window.close()` from Rust, like the app's own Cmd+Q item. @param {number} [delayMs] */
      close: (delayMs = 0) => invoke('h_close_from_rust', { delayMs }),
      /** The red close button (`performClose:`). */
      performClose: () => invoke('h_quit', { mode: 'performclose' }),
      /** Cmd+Q through the main menu's key equivalent. */
      quitKey: () => invoke('h_quit', { mode: 'keyequiv' }),
      /** `[NSApp terminate:]`, the path of Dock > Quit and logout. */
      terminate: () => invoke('h_quit', { mode: 'terminate' }),
      /**
       * @returns {Promise<{ exists: boolean, active?: boolean, key?: boolean, visible?: boolean, sheet?: boolean, alerts?: number }>}
       */
      state: () => invoke('h_window_state'),
    },

    /**
     * Declares that the app is about to exit. Call it before triggering the exit; the
     * runner then counts the exit as a pass (with the expected code) and checks `files`.
     * @param {ExitExpectation} [expectation]
     */
    expectExit(expectation = {}) {
      exitExpected = { code: 0, within: 10000, files: [], ...expectation }
      send({ kind: 'expect-exit', ...exitExpected })
    },
    /** @returns {ExitExpectation | null} */
    exitExpectation: () => exitExpected,

    /**
     * Console errors matching `pattern` are expected in this run (the app logs them on
     * purpose, e.g. for a file that cannot be opened).
     * @param {RegExp} pattern
     */
    allowErrors(pattern) {
      send({ kind: 'allow-errors', source: pattern.source, flags: pattern.flags })
    },

    /**
     * Runs `fn`, marking CSP violations it causes as expected (for probes that prove
     * the policy is enforced).
     * @param {() => unknown} fn
     * @returns {Promise<import('./recorder.js').Violation[]>} the violations it caused
     */
    async expectViolations(fn) {
      const before = rec.violations.length
      rec.expectingViolations++
      try {
        await fn()
        await sleep(300)
      } finally {
        rec.expectingViolations--
      }
      return rec.violations.slice(before)
    },

    /**
     * Calls a backend command and never throws.
     * @param {string} cmd
     * @param {Record<string, unknown> | Uint8Array} [args]
     * @param {{ headers?: Record<string, string> }} [options]
     * @returns {Promise<{ ok: true, value: any } | { ok: false, error: string }>}
     */
    async attempt(cmd, args, options) {
      try {
        return { ok: true, value: await invoke(cmd, args, options) }
      } catch (e) {
        return { ok: false, error: typeof e === 'string' ? e : String(/** @type {any} */ (e)?.message ?? e) }
      }
    },

    /**
     * Sets or (with null) removes an environment variable of the running app.
     * @param {string} name
     * @param {string | null} value
     */
    setenv: (name, value) => invoke('h_setenv', { name, value }),

    /** The native menu as text. @returns {Promise<string>} */
    menu: () => invoke('h_menu_dump'),
  }
  return h
}

/** @typedef {ReturnType<typeof createHarness>} Harness */
