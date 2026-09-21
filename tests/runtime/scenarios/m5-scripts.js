// The scripting UI, end to end (plan §5 M5 H5, WP5.1, WP5.2, §7.5, §7.9, §7.11). Seven
// scenarios, because five of them need an app of their own:
//
//   m5-scripts-ui        the Tools surface, the parameter form, the apply and its undo,
//                        the report rows, a non-zero exit, and Cancel from the panel
//   m5-scripts-guard     an edit made *during* a run: nothing is applied, a new tab is offered
//   m5-scripts-timeout   `timeout = 1` in the header, from the UI
//   m5-scripts-cancel    Cancel from the status item, and what it leaves behind
//   m5-scripts-exitkill  `-1` starts a run and closes the window, `-2` looks for survivors
//   m5-scripts-security  what the webview may and may not ask the backend for
//   m5-no-python         GEDIT_PYTHON pointing at nothing, and the recovery from it
//
// **What these add to M4.** `m4-scripts-backend` drives `script_run` at the IPC level. M5
// is the eight steps in front of it (`app/scripts.ts`): the profile filter, the parameter
// form, the input scope, the context, the version taken at the start, `decideApply` and
// the apply — plus the surface that reaches them. So every run here goes through
// `ScriptService` or through a command, never through `h.attempt('script_run')`, and the
// checks are about what the *operator* sees: the program, the status bar, the panel, the
// Results rows and the undo stack.
//
// **The safety bar** (plan §5 M5) is what the scenarios are ordered around. Each of its
// four sentences has a check that fails if it stops being true:
//   - one undo step                → `m5-scripts-ui`, "one Cmd+Z takes the whole run back"
//   - never a document that changed → `m5-scripts-guard`
//   - never silently               → every refusal below reads the status bar
//   - failures and timeouts visible → `m5-scripts-timeout`, `m5-scripts-cancel`, the
//                                     non-zero exit in `m5-scripts-ui`
//   - nothing runs without asking   → `m5-scripts-ui` counts the runs the app made on its own
//
// **Why the cancels are split over three scenarios.** They are three different controls
// and three different reasons to stop: the panel's Cancel button (`output-cancel`), the
// status item (which *is* the Cancel control, and is the only one reachable while the
// bottom region shows Results), and the deadline in a script's own header. A single
// scenario would only prove one of them.
//
// **No Cmd key and no real mouse click is used.** `Mod+F9` and a `nativeClick` both need
// the app to own the keyboard, which a locked screen takes away; F9 is a plain key and is
// posted either way, and everything else is a DOM click or an IPC call. `script.runLast`
// is therefore driven through its command and its *binding* is left to `m1-keys`.

import { scenario } from '../lib/index.js'
import { configPaths } from './m2-common.js'
import { newDoc, runTransform } from './m4-common.js'
import {
  BUNDLED,
  context,
  GRANDCHILD,
  menuScriptIds,
  message,
  messageIsError,
  pythonProbe,
  read,
  ready,
  ribbonTab,
  runScript,
  scriptService,
  setField,
  scriptStatus,
  showPanel,
  sleeper,
  slowReplacer,
  SCRIPT_COMMANDS,
  startScript,
  textOf,
  undo,
  V1_COMMANDS,
  V1_IPC,
  waitForScript,
  writeUserScript,
} from './m5-common.js'

/** A small Fanuc program with two feeds and two speeds, used by several scenarios. */
const PROGRAM = [
  '%',
  'O5001 (M5 SCRIPTS)',
  'G21 G17 G40 G49 G80 G90 G94',
  'T1 M6',
  'S3000 M3',
  'G0 X0. Y0.',
  'G43 Z25. H1 M8',
  'G1 Z-2. F250.',
  'X40. F800.',
  'G0 Z25. M9',
  'T2 M6',
  'S2400 M3',
  'G1 Z-5. F120.',
  'M30',
  '%',
  '',
].join('\n')

/** A script that prints something and then exits non-zero, in `replace` mode. */
const FAILING = `# /// gedit
# name = "Harness failing replace"
# description = "Prints a program and then fails, so nothing may be applied."
# input = "selection-or-document"
# output = "replace"
# ///
"""Written for gEdit's runtime harness (H5). Not a bundled script."""

import sys

sys.stdin.read()
print("(THIS MUST NEVER REACH THE EDITOR)")
sys.stderr.write("the harness made this script fail\\n")
sys.exit(3)
`

// =================================================================================
// m5-scripts-ui
// =================================================================================

scenario('m5-scripts-ui', { timeout: 420 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const service = scriptService(h)

  const probe = await pythonProbe(h)
  h.check('the startup probe answered and found an interpreter', probe?.ok === true, probe)

  // ----------------------------------------------------------------- the Tools surface
  await ribbonTab(h, 'tools')
  h.check(
    'every `script.*` command of WP5.2 is registered',
    SCRIPT_COMMANDS.every((id) => ctx.commands.has(id)),
    SCRIPT_COMMANDS.filter((id) => !ctx.commands.has(id)),
  )
  h.check(
    'the v1 script commands are gone (plan D14)',
    V1_COMMANDS.every((id) => !ctx.commands.has(id)),
    V1_COMMANDS.filter((id) => ctx.commands.has(id)),
  )
  h.check(
    'no v1 script control is left in the shell',
    !h.q('scripts-folder') && !h.q('script-select') && !h.q('script-run'),
  )
  h.check('F9 and Mod+F9 carry the two run commands (§7.11)', ctx.commands.get('script.runPicker')?.keys === 'F9' && ctx.commands.get('script.runLast')?.keys === 'Mod+F9', {
    picker: ctx.commands.get('script.runPicker')?.keys,
    last: ctx.commands.get('script.runLast')?.keys,
  })
  h.check(
    'the Tools group offers the three bundled scripts for a Fanuc program',
    JSON.stringify([...menuScriptIds(h)].sort()) === JSON.stringify(BUNDLED),
    menuScriptIds(h),
  )
  h.check(
    'each one is grouped and carries its own run command (§7.9 `script-item`)',
    h.qa('scripts-group').length >= 1 &&
      h.qa('script-item').every((e) => (e.getAttribute('data-command') ?? '').startsWith('script.run:')),
    { groups: h.qa('scripts-group').length, commands: h.qa('script-item').map((e) => e.getAttribute('data-command')) },
  )
  h.check(
    'the description is the tooltip, so the operator reads it before running anything',
    h.qa('script-item').every((e) => (e.getAttribute('title') ?? '').length > (e.textContent ?? '').trim().length),
    h.qa('script-item').map((e) => e.getAttribute('title')),
  )
  h.check('the script status item is in the status bar and idle', scriptStatus(h)?.getAttribute('data-running') === '0', scriptStatus(h)?.outerHTML?.slice(0, 160))

  // Nothing has run yet: `activate()` lists the folders and probes the interpreter, and
  // that is all it is allowed to do (plan §3, standing rule 5).
  await showPanel(h, 'output')
  h.check('the Output panel starts empty, so nothing ran on its own', h.q('output-panel')?.getAttribute('data-running') === '0' && !h.q('output-json') && !h.q('output-stdout') && !h.q('output-stderr'), h.q('output-panel')?.textContent?.trim().slice(0, 120))
  h.check('its Cancel is disabled while nothing runs', h.q('output-cancel')?.hasAttribute('disabled') === true)
  h.check('`script.runLast` is off before anything has been run', ctx.commands.isEnabled('script.runLast') === false)

  // ------------------------------------------------------ F9 opens the picker (plain key)
  h.focusEditor()
  await h.nativeKeys([{ key: 'F9' }])
  const picker = await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 })
  h.check('F9 opens the script picker', !!picker)
  h.check(
    'it offers exactly the scripts the Tools group offers',
    h.qa('quick-pick-item').length === 3,
    h.qa('quick-pick-item').map((e) => e.textContent?.trim().split('\n')[0]),
  )
  await h.nativeKeys([{ key: 'Escape' }])
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 5000 })
  h.check('Escape closes it without running anything', !h.q('quick-pick') && read(service.running) === null)

  // ============================================== the parameter form, the run, the undo
  //
  // The bottom region is closed first, on purpose: the I5 rule is that `ScriptService` is
  // the only thing that *reveals* the Output panel, and only before a `panel`-mode run or
  // after a failure. A `replace` run that worked must leave the layout alone — which can
  // only be seen if the scenario is not the one holding the panel open.
  ctx.layout.hide('bottom')
  await h.waitFor(() => !h.q('output-panel'), { timeout: 5000 })

  const docId = await newDoc(h, PROGRAM)
  const before = textOf(h, docId)

  const running = service.run('bundled:scale_feed.py')
  await h.waitFor(() => h.q('modal'), { timeout: 20000 })
  h.check(
    'a script with parameters opens its form before it runs',
    !!h.q('form-field', { field: 'percent' }) && h.qa('form-field').length === 8,
    h.qa('form-field').map((e) => e.dataset.field),
  )
  h.check('the form is titled with the script name, not its file name', (h.q('modal')?.textContent ?? '').includes('Scale feed rates'), h.q('modal')?.textContent?.slice(0, 80))
  h.check('nothing has been sent to the backend yet', read(service.running) === null)
  setField(h, 'percent', 90)
  await h.frame()
  h.click(h.q('modal-ok'))
  await running
  await h.idle()

  const scaled = textOf(h, docId)
  h.check('the feeds were scaled and nothing else changed', scaled === before.replace('F250.', 'F225.').replace('F800.', 'F720.').replace('F120.', 'F108.'), { got: scaled, want: before.replace('F250.', 'F225.').replace('F800.', 'F720.').replace('F120.', 'F108.') })
  h.check('the status bar says how many lines were replaced, and it is not an error', /replaced/.test(message(h)) && !messageIsError(h), { message: message(h), error: messageIsError(h) })
  h.check('the run is over and the status item is idle again', read(service.running) === null && scriptStatus(h)?.getAttribute('data-running') === '0')
  h.check(
    'a replace run that worked does not throw the Output panel over the program',
    h.q('panel', { region: 'bottom', panel: 'output' }) === null,
    h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`),
  )

  await undo(h)
  h.check('one undo takes the whole run back (the safety bar: one undo step)', textOf(h, docId) === before, textOf(h, docId))

  // The panel kept the run whatever the mode was, which is where a failure would be read.
  await showPanel(h, 'output')
  h.check('the Output panel kept the finished run as its structured result', !!h.q('output-json') && h.q('output-panel')?.getAttribute('data-running') === '0', h.q('output-panel')?.textContent?.slice(0, 160))
  h.check('and the structured result is the envelope the script returned', typeof JSON.parse(h.q('output-json')?.textContent ?? 'null')?.text === 'string', h.q('output-json')?.textContent?.slice(0, 120))

  // ============================================== the report, and its rows
  await runScript(h, 'bundled:tool_list.py', { form: true })
  h.check('a report-mode script leaves the program alone', textOf(h, docId) === before)
  h.check('and says where the result went', /Results panel/.test(message(h)) && !messageIsError(h), message(h))

  await showPanel(h, 'results')
  const rows = h.qa('results-row').filter((e) => (e.dataset.line ?? '') !== '')
  h.check('the Results panel holds one row per tool', rows.length === 2, h.qa('results-row').map((e) => `${e.dataset.line}:${e.textContent?.trim().slice(0, 30)}`))
  const wantedLine = Number(rows[1]?.dataset.line ?? 0)
  h.click(rows[1])
  await h.waitFor(() => h.app.cursor().line === wantedLine, { timeout: 5000 })
  h.check(`a row click jumps to its line (${wantedLine})`, h.app.cursor().line === wantedLine, { cursor: h.app.cursor(), wantedLine })
  h.check('the row names the document it points into', (rows[1]?.dataset.docId ?? '') === docId, rows[1]?.dataset.docId)

  // `script.runLast` repeats the remembered values with no form.
  let modalSeen = false
  const watch = setInterval(() => {
    if (h.q('modal')) modalSeen = true
  }, 20)
  const ranLast = await ctx.commands.run('script.runLast')
  clearInterval(watch)
  await h.idle()
  h.check('runLast repeats the last script without asking again', ranLast === true && !modalSeen && !h.q('modal') && textOf(h, docId) === before, { ranLast, modalSeen })

  // ============================================== a non-zero exit applies nothing
  const failing = await writeUserScript(h, 'rh_failing.py', FAILING)
  await runScript(h, failing)
  h.check('a script that exits non-zero changes nothing', textOf(h, docId) === before, textOf(h, docId))
  h.check(
    'it says so as an error, naming the exit code',
    messageIsError(h) && message(h) === 'The script exited with code 3. Nothing was applied.',
    message(h),
  )
  await h.waitFor(() => h.q('output-panel'), { timeout: 5000 })
  h.check('and the failure is visible in the Output panel, which it opened itself', !!h.q('panel', { region: 'bottom', panel: 'output' }) && (h.q('output-stderr')?.textContent ?? '').includes('the harness made this script fail'), {
    panel: h.q('panel', { region: 'bottom', panel: 'output' })?.dataset.panel,
    stderr: h.q('output-stderr')?.textContent?.slice(0, 120),
  })
  h.check('what it printed on stdout is shown, not applied', (h.q('output-stdout')?.textContent ?? '').includes('THIS MUST NEVER REACH THE EDITOR'), h.q('output-stdout')?.textContent?.slice(0, 120))

  // ============================================== Cancel, from the panel's own button
  const sleeperId = await writeUserScript(h, 'rh_panel_sleeper.py', sleeper({ seconds: 120 }))
  const t0 = performance.now()
  /** @type {string[]} */
  const trace = []
  const mark = (/** @type {string} */ what) => trace.push(`t+${Math.round(performance.now() - t0)} ${what} runs=${h.rec.ipc.calls['script_run'] ?? 0} inflight=${h.rec.ipc.inflight}`)
  service.running.subscribe((/** @type {any} */ v) => mark(`store=${v === null ? 'null' : v.runId + ' ' + v.scriptId}`))
  mark('before startScript')
  const { done: slow } = await startScript(h, sleeperId)
  slow.then(() => mark('slow RESOLVED'), (/** @type {any} */ e) => mark('slow REJECTED ' + e))
  mark('after startScript')
  await h.waitFor(() => h.q('output-panel', { running: '1' }), { timeout: 15000 })
  mark('after the 15 s waitFor')
  h.check('a panel-mode run opens the Output panel and shows it as running', h.q('output-panel')?.getAttribute('data-running') === '1' && h.q('output-cancel')?.hasAttribute('disabled') === false, {
    running: read(service.running),
    panel: h.q('output-panel')?.getAttribute('data-running'),
    cancelDisabled: h.q('output-cancel')?.hasAttribute('disabled'),
    regions: h.qa('panel').map((e) => `${e.dataset.region}/${e.dataset.panel}`),
    message: message(h),
  })
  h.check('the status item shows the run and offers to stop it', scriptStatus(h)?.getAttribute('data-running') === '1' && (scriptStatus(h)?.textContent ?? '').includes('Harness sleeper'), scriptStatus(h)?.textContent)

  // A second run while one is in flight. `h.idle()` must not be used to settle it: it
  // waits for the IPC queue to drain, and the run in flight *is* an IPC call, so it would
  // sit out the whole script (and the deadline behind it).
  if (read(service.running) === null) {
    h.check('a second run is refused while one is in flight', false, 'the first run was already over')
  } else {
    await service.run(sleeperId)
    await h.frame()
    h.check('a second run is refused while one is in flight', message(h) === 'A script is already running' && messageIsError(h), message(h))
  }

  mark('before the cancel click; cancelEl=' + (h.q('output-cancel') !== null) + ' disabled=' + h.q('output-cancel')?.hasAttribute('disabled'))
  h.click(h.q('output-cancel'))
  mark('after the cancel click')
  await slow
  mark('after await slow')
  await h.idle()
  mark('after idle')
  h.log('TRACE ' + JSON.stringify(trace))
  h.check('the panel’s Cancel stops the run', read(service.running) === null && h.q('output-panel')?.getAttribute('data-running') === '0')
  h.check('a cancelled run applies nothing and says so', messageIsError(h) && message(h) === 'The script was stopped. Nothing was applied.', message(h))
  h.check('the panel marks the run as stopped', (h.q('output-panel')?.textContent ?? '').includes('Stopped'), h.q('output-panel')?.textContent?.slice(0, 200))
  const left = await h.waitFor(async () => {
    const script = await h.pgrep('rh_panel_sleeper.py')
    const grandchild = await h.pgrep(GRANDCHILD)
    return script.length === 0 && grandchild.length === 0 ? true : null
  }, { timeout: 15000, interval: 200 })
  h.check('neither the script nor its grandchild is left running', left === true, { script: await h.pgrep('rh_panel_sleeper.py'), grandchild: await h.pgrep(GRANDCHILD) })
})

// =================================================================================
// m5-scripts-guard: the document changed while the script ran
// =================================================================================

scenario('m5-scripts-guard', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const service = scriptService(h)
  h.check('the startup probe found an interpreter', (await pythonProbe(h))?.ok === true)

  const slowId = await writeUserScript(h, 'rh_slow_replace.py', slowReplacer(6))
  const docId = await newDoc(h, PROGRAM)
  const before = textOf(h, docId)
  const tabs = h.qa('doc-tab').length

  const { done: running } = await startScript(h, slowId)
  // The edit the guard is about: made after stdin was read and before the result arrives.
  ctx.editor.reveal(docId, 2, 1)
  ctx.editor.insertText('(EDITED WHILE THE SCRIPT WAS RUNNING)\n')
  await h.idle()
  const edited = textOf(h, docId)
  h.check('the program was edited while the script was still running', edited !== before && read(service.running) !== null, { running: read(service.running) })

  const alert = await h.alert.wait({ timeout: 60000 })
  h.check('a stale result is offered as a new tab instead of being applied', !!alert && alert.texts.join(' ').includes('nothing was applied'), alert)
  h.check('the buttons are Open in new tab and Cancel', (alert?.buttons ?? []).includes('Open in new tab') && (alert?.buttons ?? []).includes('Cancel'), alert?.buttons)
  h.check('nothing has been applied while the question is on screen', textOf(h, docId) === edited)

  await h.alert.click('Open in new tab')
  await running
  await h.idle()

  h.check('the edited program is untouched (the safety bar: never a document that changed)', textOf(h, docId) === edited, textOf(h, docId))
  h.check('the result landed in a new tab', h.qa('doc-tab').length === tabs + 1, h.qa('doc-tab').map((e) => e.dataset.path ?? e.dataset.docId))
  const newId = ctx.docs.getActiveId() ?? ''
  // The input ended with a line break, so the trailing-LF rule does not fire and the text
  // is the script's stdout as it stands (`core/scripting/apply.ts`).
  h.check('and that tab holds what the script produced, upper-cased and complete', newId !== docId && textOf(h, newId) === before.toUpperCase(), { got: textOf(h, newId), want: before.toUpperCase() })
  h.check('the status bar says where the result went', /new tab/.test(message(h)), message(h))

  // The other answer: discard. The same run again, this time refused outright.
  ctx.docs.activate(docId)
  await h.waitFor(() => ctx.docs.getActiveId() === docId, { timeout: 5000 })
  const { done: again } = await startScript(h, slowId)
  ctx.editor.reveal(docId, 2, 1)
  ctx.editor.insertText('(EDITED AGAIN)\n')
  await h.idle()
  const editedTwice = textOf(h, docId)
  await h.alert.wait({ timeout: 30000 })
  await h.alert.click('Cancel')
  await again
  await h.idle()
  h.check('answering Cancel discards the result and says so', textOf(h, docId) === editedTwice && messageIsError(h) && /discarded/.test(message(h)), { message: message(h), changed: textOf(h, docId) !== editedTwice })
  h.check('and no extra tab was opened', h.qa('doc-tab').length === tabs + 1, h.qa('doc-tab').length)
})

// =================================================================================
// m5-scripts-timeout: `timeout = 1` in the header
// =================================================================================

scenario('m5-scripts-timeout', { timeout: 240 }, async (h) => {
  await ready(h)
  const service = scriptService(h)
  h.check('the startup probe found an interpreter', (await pythonProbe(h))?.ok === true)

  const id = await writeUserScript(h, 'rh_timeout.py', sleeper({ seconds: 300, header: '# output = "panel"\n# timeout = 1' }))
  const entry = read(service.list).find((/** @type {any} */ e) => e.id === id)
  h.check('the header timeout was read, and the script is otherwise fine', entry?.meta?.timeout === 1 && entry?.headerError === null, entry?.meta)

  const docId = await newDoc(h, PROGRAM)
  const before = textOf(h, docId)
  const started = performance.now()
  await runScript(h, id)
  const tookMs = Math.round(performance.now() - started)

  h.check(`the run is stopped at its own deadline rather than at the settings one: ${tookMs} ms`, tookMs < 20000, { tookMs })
  h.check('it says the script ran past its time limit, as an error', messageIsError(h) && message(h) === 'The script ran past its time limit and was stopped. Nothing was applied.', message(h))
  h.check('nothing was applied', textOf(h, docId) === before)
  await h.waitFor(() => h.q('output-panel'), { timeout: 5000 })
  h.check('the Output panel is open and marks the run as timed out', !!h.q('panel', { region: 'bottom', panel: 'output' }) && (h.q('output-panel')?.textContent ?? '').includes('Timed out'), h.q('output-panel')?.textContent?.slice(0, 200))
  h.check('what the script printed before the deadline is still there', (h.q('output-stderr')?.textContent ?? '').includes('sleeping'), h.q('output-stderr')?.textContent?.slice(0, 120))
  h.check('and what it prints at the end is not, because it never got there', !(h.q('output-stdout')?.textContent ?? '').includes('not stopped'), h.q('output-stdout')?.textContent?.slice(0, 120))

  const left = await h.waitFor(async () => {
    const script = await h.pgrep('rh_timeout.py')
    const grandchild = await h.pgrep(GRANDCHILD)
    return script.length === 0 && grandchild.length === 0 ? true : null
  }, { timeout: 15000, interval: 200 })
  h.check('neither the script nor the grandchild it started survived the deadline (AD-13)', left === true, { script: await h.pgrep('rh_timeout.py'), grandchild: await h.pgrep(GRANDCHILD) })
  h.check('the app is usable straight afterwards', h.q('app-shell')?.dataset.ready === '1' && read(service.running) === null)
})

// =================================================================================
// m5-scripts-cancel: Cancel from the status item
// =================================================================================

scenario('m5-scripts-cancel', { timeout: 240 }, async (h) => {
  await ready(h)
  const service = scriptService(h)
  h.check('the startup probe found an interpreter', (await pythonProbe(h))?.ok === true)

  const id = await writeUserScript(h, 'rh_cancel.py', sleeper({ seconds: 300 }))
  const docId = await newDoc(h, PROGRAM)
  const before = textOf(h, docId)

  const { done: running } = await startScript(h, id)
  await h.waitFor(() => scriptStatus(h)?.getAttribute('data-running') === '1', { timeout: 15000 })
  h.check('the status item names the running script and is clickable', scriptStatus(h)?.getAttribute('data-script-id') === id && scriptStatus(h)?.hasAttribute('disabled') === false, scriptStatus(h)?.outerHTML?.slice(0, 200))
  h.check('`script.cancel` is enabled only while something runs', context(h).commands.isEnabled('script.cancel') === true)
  const alive = await h.waitFor(async () => {
    const pids = await h.pgrep('rh_cancel.py')
    return pids.length > 0 ? pids : null
  }, { timeout: 15000, interval: 100 })
  h.check('the run really started a process', (alive ?? []).length > 0, alive)

  // The bottom region is showing Results, so the panel's Cancel is not on screen: the
  // status item is the control that is always reachable.
  context(h).layout.show('results')
  await h.idle()
  h.check('the Output panel is not on screen, and the status item still offers Cancel', !h.q('output-cancel') && scriptStatus(h)?.getAttribute('data-running') === '1')

  // The "Stopping the script…" message is taken from the **store**, not read off the DOM
  // after the click. `ScriptService.cancel` sets it synchronously and the run's own promise
  // replaces it the moment the process is gone, which on a fast machine is inside the same
  // frame — so the intermediate state is real and held for at least the `script_cancel`
  // round trip, but it need never be *painted*, and a scenario that polls the DOM for it
  // fails on speed rather than on behaviour. A subscription cannot miss it.
  /** @type {string[]} */
  const said = []
  const stopWatching = context(h).status.current.subscribe((/** @type {any} */ v) => {
    if (v && said[said.length - 1] !== v.text) said.push(v.text)
  })
  h.click(scriptStatus(h))
  // The status item runs `script.cancel` through the registry, so `cancel()` is reached a
  // microtask later: wait for the message, or for the run to end without ever saying it.
  await h.waitFor(() => (said.includes('Stopping the script…') || read(service.running) === null ? true : null), { timeout: 5000, interval: 5 })
  h.check('clicking it says the script is being stopped', said.includes('Stopping the script…'), said)
  await running
  await h.idle()
  stopWatching()
  h.check('and then says it was stopped, so the two messages are in that order', said.indexOf('Stopping the script…') < said.lastIndexOf('The script was stopped. Nothing was applied.'), said)

  h.check('the run ends as stopped, with nothing applied', read(service.running) === null && textOf(h, docId) === before && messageIsError(h) && message(h) === 'The script was stopped. Nothing was applied.', { message: message(h), changed: textOf(h, docId) !== before })
  h.check('the status item is idle and disabled again', scriptStatus(h)?.getAttribute('data-running') === '0' && scriptStatus(h)?.hasAttribute('disabled') === true)
  h.check('`script.cancel` is off again', context(h).commands.isEnabled('script.cancel') === false)

  const left = await h.waitFor(async () => {
    const script = await h.pgrep('rh_cancel.py')
    const grandchild = await h.pgrep(GRANDCHILD)
    return script.length === 0 && grandchild.length === 0 ? true : null
  }, { timeout: 15000, interval: 200 })
  h.check('cancel leaves neither the script nor its grandchild behind', left === true, { script: await h.pgrep('rh_cancel.py'), grandchild: await h.pgrep(GRANDCHILD) })

  // A second run afterwards proves the registry was cleaned up, not just the process.
  await runScript(h, 'bundled:tool_list.py', { form: true })
  h.check('a script can be run again after a cancel', /Results panel/.test(message(h)) && !messageIsError(h), message(h))
})

// =================================================================================
// m5-scripts-exitkill: the window closes while a script runs
// =================================================================================
//
// The script lives **outside both run folders**, in `runs/m5-exit-scripts`, and is reached
// through the `scripts.folders` setting: when a run ends, the harness kills everything
// whose command line matches that run's folder, which would clean up the very process
// `-2` is looking for and turn a real leak into a pass.

/** `<rh>/runs/m5-exit-scripts`: beside both run folders, inside neither. */
const exitScripts = (/** @type {string} */ run) => run.replace(/\/[^/]+$/, '/m5-exit-scripts')

scenario('m5-scripts-exitkill-1', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const service = scriptService(h)
  h.check('the startup probe found an interpreter', (await pythonProbe(h))?.ok === true)

  const dir = exitScripts(h.cfg.run)
  await h.disk.write(`${dir}/rh_exit_sleeper.py`, sleeper({ seconds: 180 }))
  await h.disk.write(`${dir}/started.txt`, '')
  await ctx.settings.save({ 'scripts.folders': [dir] })

  // I5 made `activate()` follow `scripts.folders`, so no rescan is asked for here: a
  // folder added anywhere has to show up on its own.
  const id = 'extra0:rh_exit_sleeper.py'
  h.check('a folder added to the settings becomes a script root without a rescan', await waitForScript(h, id, 20000), read(service.list).map((/** @type {any} */ e) => e.id))

  await newDoc(h, PROGRAM)
  const { done: running } = await startScript(h, id)
  // Deliberately not awaited: the app is about to go away under it.
  void running.catch(() => undefined)

  const pids = await h.waitFor(async () => {
    const found = await h.pgrep('rh_exit_sleeper.py')
    return found.length > 0 ? found : null
  }, { timeout: 25000, interval: 100 })
  h.check('the script is running when the window is asked to close', (pids ?? []).length > 0, pids)
  const grandchildren = await h.waitFor(async () => {
    const found = await h.pgrep(GRANDCHILD)
    return found.length > 0 ? found : null
  }, { timeout: 25000, interval: 100 })
  h.check('so is the grandchild it started', (grandchildren ?? []).length > 0, grandchildren)
  h.check('the script wrote down which processes it owns, for the next run to look for', ((await h.disk.read(`${dir}/started.txt`)) ?? '').trim() !== '', await h.disk.read(`${dir}/started.txt`))
  h.check('the UI still shows the run as in flight', scriptStatus(h)?.getAttribute('data-running') === '1', scriptStatus(h)?.textContent)

  // No unsaved document, so nothing asks: the window closes and `on_run_event(Exit)`
  // calls `scripts::kill_all`.
  h.expectExit({ events: ['CloseRequested main', 'Exit'], within: 25000 })
  await h.window.close()
})

scenario('m5-scripts-exitkill-2', { timeout: 180 }, async (h) => {
  await ready(h)
  const dir = exitScripts(h.cfg.run)

  const started = await h.disk.read(`${dir}/started.txt`).catch(() => '')
  if (started.trim() === '') {
    await h.blocked('m5-scripts-exitkill-1 never started a script, so there is nothing to look for', { dir })
    return
  }
  h.check('the previous run started a script and a grandchild', started.trim().split(/\s+/).length === 2, started.trim())

  const script = await h.pgrep('rh_exit_sleeper.py')
  const grandchild = await h.pgrep(GRANDCHILD)
  h.check('a script started from the UI does not outlive the window (AD-13, D20)', script.length === 0, script)
  h.check('neither does the grandchild it spawned', grandchild.length === 0, grandchild)
})

// =================================================================================
// m5-scripts-security
// =================================================================================
//
// What the *webview* is allowed to ask for. The threat model (plan §3, AD-8, AD-13) is a
// compromised page, not a malicious script: a script the user chose to run is code they
// trust, and the README says so. So the checks below are about the seams the page can
// reach — the id grammar, the two path commands, the interpreter and the folder list
// never crossing IPC, and the v1 surface being gone.

scenario('m5-scripts-security', { timeout: 300 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const service = scriptService(h)
  h.check('the startup probe found an interpreter', (await pythonProbe(h))?.ok === true)
  const paths = configPaths(ctx)
  await newDoc(h, PROGRAM)

  // -------------------------------------------------------------- the v1 surface is gone
  for (const command of V1_IPC) {
    const gone = await h.attempt(command, {})
    h.check(`${command} is no longer a backend command (plan D14)`, !gone.ok, gone)
  }

  // ------------------------------------------------------------------- the id grammar
  const badIds = [
    'user:../../../etc/passwd',
    'bundled:/etc/passwd',
    'bundled:sub/../tool_list.py',
    'nowhere:tool_list.py',
    'tool_list.py',
    'bundled:',
    'user:.py',
    'user:gedit_nc.py',
    '../evil.py',
  ]
  /** @type {Record<string, string>} */
  const refusedByService = {}
  for (const id of badIds) {
    await service.run(id)
    await h.idle()
    refusedByService[id] = message(h)
  }
  h.check(
    'the runner refuses every id that is not a discovered script, by name and visibly',
    Object.values(refusedByService).every((m) => m.startsWith('There is no script with the id')),
    refusedByService,
  )
  /** @type {Record<string, unknown>} */
  const refusedByBackend = {}
  for (const id of badIds) {
    refusedByBackend[id] = await h.attempt('script_run', { req: { runId: `m5-bad-${id}`, scriptId: id, stdin: '', context: {}, timeoutSecs: 5 } })
  }
  h.check('and the backend refuses them too, before anything is spawned', Object.values(refusedByBackend).every((r) => !(/** @type {any} */ (r).ok)), refusedByBackend)

  // ------------------------------------------------------------------ the path commands
  const bundledSource = await h.attempt('script_source_path', { scriptId: 'bundled:tool_list.py' })
  h.check('a bundled script is never granted to the webview (plan §3)', !bundledSource.ok, bundledSource)
  const library = read(service.list).some((/** @type {any} */ e) => e.id.endsWith('gedit_nc.py'))
  h.check('the script library is not offered as a script', !library, read(service.list).map((/** @type {any} */ e) => e.id))

  const mine = await writeUserScript(h, 'rh_mine.py', '# /// gedit\n# name = "Mine"\n# ///\nprint("mine")\n')
  const userSource = await h.attempt('script_source_path', { scriptId: mine })
  h.check('a script in a folder the user owns is granted, and only that file', userSource.ok && userSource.value === `${paths.userScriptsDir}/rh_mine.py`, userSource)

  /** @type {Record<string, unknown>} */
  const refusedNames = {}
  for (const name of ['../evil', 'sub/x', '/etc/passwd', '_hidden', '.dot', 'gedit_nc', 'x\ny', 'name.']) {
    refusedNames[name] = await h.attempt('script_new', { name })
  }
  h.check('`script_new` refuses a name that is not a plain file name', Object.values(refusedNames).every((r) => !(/** @type {any} */ (r).ok)), refusedNames)

  // ------------------------------------- the interpreter and the folders never cross IPC
  const smuggled = await h.attempt('script_run', {
    req: {
      runId: 'm5-smuggle',
      scriptId: mine,
      stdin: '',
      context: {},
      timeoutSecs: 5,
      python: '/bin/sh',
      interpreter: '/bin/sh',
      folder: '/tmp',
      env: { PATH: '/tmp' },
    },
  })
  h.check(
    'a run request cannot name an interpreter: the extra fields are ignored and ours is used',
    smuggled.ok && smuggled.value.interpreter === h.cfg.python,
    smuggled.ok ? smuggled.value.interpreter : smuggled,
  )
  const listed = await h.attempt('scripts_list', { folders: ['/tmp'], python: '/bin/sh' })
  h.check(
    'a list request cannot name a folder either: the roots are the settings ones',
    listed.ok && /** @type {any[]} */ (listed.value.folders).every((/** @type {any} */ f) => f.path !== '/tmp'),
    listed.ok ? listed.value.folders : listed,
  )

  // --------------------------------------------------- the page cannot read the bundle
  const ungranted = await h.attempt('plugin:fs|read_file', { path: `${paths.configDir}/settings.json`, options: {} })
  h.check('the fs scope does not hand the page a path it was never granted', !ungranted.ok, ungranted)
})

// =================================================================================
// m5-no-python
// =================================================================================

scenario('m5-no-python', { timeout: 300, python: '{run}/no-such-folder/python3' }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const service = scriptService(h)
  const missing = `${h.cfg.run}/no-such-folder/python3`

  const probe = await pythonProbe(h)
  h.check('the startup probe reports no usable interpreter and names the one it tried', probe?.ok === false && probe?.interpreter === missing && (probe?.message ?? '').includes(missing), probe)

  // ------------------------------------------------------------------ what is switched off
  await ribbonTab(h, 'tools')
  h.check('the Tools group says Python was not found', (h.q('scripts-menu')?.textContent ?? '').includes('Python 3.9 or newer was not found'), h.q('scripts-menu')?.textContent?.trim())
  h.check('so it offers no script to run', h.qa('script-item').length === 0, menuScriptIds(h))
  h.check('discovery still worked: the backend reads no Python to find a script', read(service.list).filter((/** @type {any} */ e) => e.root === 'bundled').length === 3, read(service.list).map((/** @type {any} */ e) => e.id))

  const docId = await newDoc(h, PROGRAM)
  const runCommands = ['script.runPicker', 'script.runLast', ...BUNDLED.map((id) => `script.run:${id}`)]
  h.check('every command that would *run* something is disabled', runCommands.every((id) => ctx.commands.has(id) && !ctx.commands.isEnabled(id)), runCommands.filter((id) => ctx.commands.isEnabled(id)))
  const manageCommands = ['script.new', 'script.openSource', 'script.rescan', 'script.addFolder', 'script.copyToUser']
  h.check('and the ones that only manage files stay on (WP5.2 open question 1)', manageCommands.every((id) => ctx.commands.isEnabled(id)), manageCommands.filter((id) => !ctx.commands.isEnabled(id)))

  await service.run('bundled:tool_list.py')
  await h.idle()
  h.check('asking for a run anyway answers with the message, not with a hang', messageIsError(h) && message(h) === 'Python 3.9 or newer was not found, so the script commands are off', message(h))

  // ------------------------------------------------------------------ everything else works
  const before = textOf(h, docId)
  await runTransform(h, 'nc.renumber', { form: true })
  h.check('the transforms, which are TypeScript, still work', textOf(h, docId) !== before && textOf(h, docId).includes('N10 G21'), textOf(h, docId).split('\n').slice(0, 4))
  await undo(h)
  h.check('and their one undo step does too', textOf(h, docId) === before, textOf(h, docId))

  const fixture = await h.fixture('nc/fanuc/f01-mill-3tools.nc')
  await h.dialogs.queue('open', fixture)
  await ctx.files.open()
  await h.waitFor(() => !!ctx.docs.byPath(fixture), { timeout: 15000 })
  h.check('a file still opens, is detected and is drawn', ctx.docs.byPath(fixture)?.profileId === 'fanuc-gcode' && h.q('editor-host')?.dataset.docId === ctx.docs.byPath(fixture)?.id, { profile: ctx.docs.byPath(fixture)?.profileId })
  const fanucId = ctx.docs.byPath(fixture)?.id ?? ''
  ctx.editor.reveal(fanucId, 1, 1)
  h.focusEditor()
  await h.nativeKeys([{ key: 'F7' }])
  await h.idle()
  h.check('navigation still works: F7 found the first tool change', h.app.cursor().line > 1, h.app.cursor())

  // ------------------------------------------------ the recovery, with no restart (I5)
  //
  // `GEDIT_PYTHON` wins over `scripts.python` (AD-13, `runner.rs` `interpreter_with`), so
  // the scenario's own override has to go first: what is being tested is that fixing the
  // interpreter *in the settings dialog* is enough, not that an environment variable can
  // be out-voted.
  await h.setenv('GEDIT_PYTHON', null)
  await ctx.settings.save({ 'scripts.python': h.cfg.python })
  const back = await h.waitFor(() => {
    const value = read(service.python)
    return value?.ok === true ? value : null
  }, { timeout: 30000, interval: 100 })
  h.check('fixing the interpreter in the settings re-probes it, with no restart (I5)', back?.ok === true && back?.interpreter === h.cfg.python, back)
  await h.waitFor(() => ctx.commands.isEnabled('script.runPicker'), { timeout: 10000 })
  h.check('the run commands come back on', ctx.commands.isEnabled('script.runPicker') === true && ctx.commands.isEnabled(`script.run:${BUNDLED[0]}`) === true)
  await ribbonTab(h, 'tools')
  h.check('and the Tools group offers the scripts again', h.qa('script-item').length === 3, menuScriptIds(h))

  ctx.docs.activate(fanucId)
  await h.waitFor(() => ctx.docs.getActiveId() === fanucId, { timeout: 5000 })
  await runScript(h, 'bundled:tool_list.py', { form: true })
  h.check('a script runs straight away, without the app being restarted', /Results panel/.test(message(h)) && !messageIsError(h), message(h))
})
