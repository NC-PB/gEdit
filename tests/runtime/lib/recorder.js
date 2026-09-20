// Records what every run is judged on: CSP violations, console errors and warnings,
// uncaught errors, IPC traffic, dialog calls and web workers. It also reroutes the
// native file dialogs (open, save, folder) to the harness stub in harness.rs.
// Installed at document start, before any app script runs.

/**
 * @typedef {object} DialogCall
 * @property {number} t ms since the page started
 * @property {'open' | 'save' | 'folder' | 'message' | 'ask' | 'confirm'} kind
 * @property {any} args the IPC arguments the app sent
 * @property {string} [response] the raw IPC response body
 * @property {number} [doneAt] ms since the page started
 */

/**
 * @typedef {object} Violation
 * @property {number} t
 * @property {string} directive
 * @property {string} blockedURI
 * @property {string} sourceFile
 * @property {number} line
 * @property {string} sample
 * @property {boolean} expected true while a scenario runs h.expectViolations()
 */

/**
 * @typedef {object} Recorder
 * @property {Violation[]} violations
 * @property {string[]} errors console.error calls, uncaught errors and unhandled rejections
 * @property {string[]} warnings console.warn calls
 * @property {{ calls: Record<string, number>, ok: number, err: number, netFail: number, inflight: number }} ipc
 * @property {string[]} otherFetches fetches that did not go to the IPC endpoint
 * @property {{ t: number, url: string, error: string | null, messages: number }[]} workers
 * @property {DialogCall[]} dialogCalls
 * @property {number} expectingViolations
 * @property {() => number} now
 */

/** @typedef {(record: Record<string, unknown>) => void} Send */

const DIALOG_CMD = /^plugin:dialog\|(open|save|message|ask|confirm)$/

/** @param {unknown} a */
export function describe(a) {
  try {
    if (a instanceof Error) return `${a.name}: ${a.message}`
    if (typeof a === 'object' && a !== null) return JSON.stringify(a)
    return String(a)
  } catch {
    return String(a)
  }
}

/**
 * Installs the hooks once per page; returns null in frames or on a second call.
 * @param {Send} send forwards each record to the runner as it happens
 * @returns {Recorder | null}
 */
export function installRecorder(send) {
  const w = /** @type {any} */ (window)
  if (window.top !== window || w.__geditRhRecorder) return null
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)

  /** @type {Recorder} */
  const rec = {
    violations: [],
    errors: [],
    warnings: [],
    ipc: { calls: {}, ok: 0, err: 0, netFail: 0, inflight: 0 },
    otherFetches: [],
    workers: [],
    dialogCalls: [],
    expectingViolations: 0,
    now,
  }
  w.__geditRhRecorder = rec

  document.addEventListener(
    'securitypolicyviolation',
    (e) => {
      /** @type {Violation} */
      const v = {
        t: now(),
        directive: e.effectiveDirective || e.violatedDirective,
        blockedURI: e.blockedURI,
        sourceFile: e.sourceFile,
        line: e.lineNumber,
        sample: e.sample,
        expected: rec.expectingViolations > 0,
      }
      rec.violations.push(v)
      send({ kind: 'csp', ...v })
    },
    true,
  )

  /** @param {string} text */
  const recordError = (text) => {
    rec.errors.push(text)
    send({ kind: 'console-error', text, t: now() })
  }
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...args) => {
    recordError(args.map(describe).join(' '))
    origError(...args)
  }
  console.warn = (...args) => {
    const text = args.map(describe).join(' ')
    rec.warnings.push(text)
    send({ kind: 'console-warn', text, t: now() })
    origWarn(...args)
  }
  window.addEventListener('error', (e) =>
    recordError(`uncaught: ${e.message} @${e.filename}:${e.lineno}`),
  )
  window.addEventListener('unhandledrejection', (e) =>
    recordError(`unhandledrejection: ${describe(e.reason)}`),
  )

  // Monaco creates its worker through MonacoEnvironment.getWorker; record each one.
  const OrigWorker = window.Worker
  /**
   * @param {string | URL} url
   * @param {WorkerOptions} [opts]
   */
  function RecordedWorker(url, opts) {
    const entry = { t: now(), url: String(url), error: /** @type {string | null} */ (null), messages: 0 }
    rec.workers.push(entry)
    const worker = new OrigWorker(url, opts)
    worker.addEventListener('error', (ev) => (entry.error = ev.message || 'error event'))
    worker.addEventListener('message', () => entry.messages++)
    return worker
  }
  RecordedWorker.prototype = OrigWorker.prototype
  w.Worker = RecordedWorker

  // Tauri's invoke() posts to the IPC custom protocol with fetch. File dialogs are
  // answered by h_fake_dialog instead of the plugin; message dialogs stay real.
  const origFetch = window.fetch.bind(window)
  /**
   * @param {RequestInfo | URL} input
   * @param {RequestInit} [init]
   */
  w.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('ipc://') && !url.startsWith('http://ipc.localhost')) {
      rec.otherFetches.push(url)
      return origFetch(input, init)
    }
    const base = url.slice(0, url.lastIndexOf('/') + 1)
    const cmd = decodeURIComponent(url.slice(base.length))
    rec.ipc.calls[cmd] = (rec.ipc.calls[cmd] || 0) + 1
    // h.idle() waits for this to reach zero: while a backend call is out, the app is
    // still working even if the DOM is quiet. The harness's own calls do not count -
    // h.idle() itself runs while one is in flight.
    const counts = !cmd.startsWith('h_')
    if (counts) rec.ipc.inflight++
    const m = DIALOG_CMD.exec(cmd)
    /** @type {DialogCall | null} */
    let call = null
    /** @type {Promise<Response>} */
    let p
    if (m) {
      /** @type {any} */
      let args = null
      try {
        args = JSON.parse(String(init?.body))
      } catch {
        args = null
      }
      const kind = /** @type {DialogCall['kind']} */ (
        m[1] === 'open' && args?.options?.directory ? 'folder' : m[1]
      )
      call = { t: now(), kind, args }
      rec.dialogCalls.push(call)
      send({ kind: 'dialog-call', dialog: kind, args })
      if (kind === 'open' || kind === 'save' || kind === 'folder') {
        p = origFetch(base + 'h_fake_dialog', { ...init, body: JSON.stringify({ kind, args }) })
      } else {
        p = origFetch(input, init)
      }
    } else {
      p = origFetch(input, init)
    }
    p.then(
      (r) => {
        if (counts) rec.ipc.inflight--
        if (call) {
          const c = call
          r.clone()
            .text()
            .then(
              (body) => {
                c.response = body
                c.doneAt = now()
              },
              () => (c.doneAt = now()),
            )
        }
        if (r.headers.get('Tauri-Response') === 'ok') rec.ipc.ok++
        else rec.ipc.err++
      },
      () => {
        if (counts) rec.ipc.inflight--
        rec.ipc.netFail++
      },
    )
    return p
  }

  return rec
}
