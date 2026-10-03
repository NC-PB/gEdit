// Helpers the M9 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Four things are worth knowing before reading a check that uses these:
//
//   1. **Nothing NC is retyped where a file already says it.** Detection answers, outline
//      items, the tool-word goldens and the known gaps of the owner-public programs are
//      read at run time out of `tests/fixtures/**`, as `m8-common.js` does. What is
//      written out here is a claim the milestone makes that no file states in that form:
//      what a written number is worth on a machine, and the shape of a renumbered program.
//   2. **A probe program is a file the scenario writes** (`openProbe`), under the extension
//      the control writes, because a three-line snippet is too short for detection to say
//      anything; the dialect is then named explicitly and checked. A machine can only be
//      picked for a document whose dialect the machine belongs to.
//   3. **The number walk reports what the scripts would be handed.** `NUMBER_WALK` runs the
//      same functions `scale_feed.py` runs on a feed word (`gedit_nc.number_class_of` with
//      the modal feed unit and the thread-pitch flag of the block, then
//      `gedit_nc.resolve_value` with the document's effective machine), on every number
//      word of the document, and reports `line | word | class | value`. The class is where
//      M9 changed the readings; the value is what a machine parameter makes of it.
//   4. **Everything a machine needs is made through the service**, as in
//      `m6-machines-select`: `m6-machines-manage` is the scenario that proves the page.

import { setInput } from './m2-common.js'
import { context, openPath, plain, revealLine } from './m3-common.js'
import { message, ready } from './m4-common.js'
import { read, runScript, writeUserScript } from './m5-common.js'
import { machineItem, machineText, pickMachine, tooltipLine, waitForMachine } from './m6-common.js'
import { detectGolden, outlineGolden, reportRows } from './m8-common.js'

export { context, detectGolden, machineItem, machineText, message, openPath, outlineGolden, pickMachine, plain, read, ready, reportRows, revealLine, runScript, setInput, tooltipLine, waitForMachine, writeUserScript }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The profile ids of the milestone, by name. */
export const FANUC_MILL = 'fanuc-gcode'
export const FANUC_LATHE = 'fanuc-lathe'
export const KLARTEXT = 'heidenhain-klartext'
export const OKUMA = 'okuma-osp'
export const SINUMERIK = 'sinumerik'
export const SINUMERIK_MILL = 'sinumerik-mill'

// ---------------------------------------------------------------- probe programs

/**
 * Writes a program into the run folder, opens it through the dialog and, when detection
 * does not already give `profileId`, names it. Answers whether detection gave it.
 *
 * A three-line probe is not a program detection can decide on, which is the reason it is
 * named; the document's profile is checked by the caller either way.
 * @param {Harness} h
 * @param {string} name file name with the extension the control writes, e.g. `PROBE.MIN`
 * @param {string} text LF-separated, with a trailing newline
 * @param {string} profileId
 * @returns {Promise<{ path: string, id: string, detected: boolean }>}
 */
export async function openProbe(h, name, text, profileId) {
  const ctx = context(h)
  const path = `${h.cfg.run}/${name}`
  await h.disk.write(path, text)
  const opened = await openPath(h, path)
  const detected = ctx.docs.get(opened.id)?.profileId === profileId
  if (!detected) {
    ctx.files.setProfile(opened.id, profileId)
    await h.idle()
  }
  return { ...opened, detected }
}

// ---------------------------------------------------------------- the number walk

/**
 * A user script that reports the number class and the value of every number word that has
 * a class, under the document's effective profile and machine (point 3 above). The last
 * row names the run (`end | <machine>/<lines>:<first line>`), so a scenario can tell this
 * report from the one the panel still shows from the run before.
 */
export const NUMBER_WALK = `# /// gedit
# name = "Harness number walk"
# description = "Reports the number class and the value of every number word of the document under its effective machine."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H9). Not a bundled script."""

import gedit_nc

ctx = gedit_nc.load_context()
profile = ctx.get("profile") or {}
codes = ctx.get("codes") or []
machine = gedit_nc.machine_params(ctx)
units = machine["params"]["units"]
cp = gedit_nc.compile_profile(profile)
interp = gedit_nc.ModalInterpreter(cp, codes)


def block_entries(tokens):
    found = []
    for token in tokens:
        if token.kind != "word" or not token.address or "=" in token.text:
            continue
        entry = interp.entry(token.address + (token.value_text or ""))
        if entry is not None:
            found.append(entry)
    return found


rows = []
state = None
lines = gedit_nc.read_input()
for number, line in enumerate(lines, 1):
    tokens, state = gedit_nc.tokenize_line(line, cp, state)
    interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
    entries = block_entries(tokens)
    for token in tokens:
        if token.kind != "word" or not token.address or token.value is None:
            continue
        number_class = gedit_nc.number_class_of(token.address, profile, interp.feed_unit, entries, interp.pitch_feed)
        if number_class is None:
            continue
        answer, readings = gedit_nc.resolve_value(token.value, number_class, machine, profile, units)
        if answer is not None:
            value = answer
        else:
            value = "(depends on the machine)" if readings else "(no value)"
        rows.append({"at": str(number), "word": token.text.strip(), "cls": number_class, "value": value})

rows.append({"at": "end", "word": "%s/%d:%s" % (machine["name"] or "(none)", len(lines), lines[0].strip()), "cls": "-", "value": "-"})
gedit_nc.report(
    "Number walk",
    [
        {"key": "at", "label": "Line"},
        {"key": "word", "label": "Word"},
        {"key": "cls", "label": "Class"},
        {"key": "value", "label": "Value"},
    ],
    rows,
)
`

/** The column keys of `NUMBER_WALK`, in its order. */
export const WALK_KEYS = ['at', 'word', 'cls', 'value']

/**
 * Runs `NUMBER_WALK` on the active document and answers its rows by `line:word`, each as
 * `class|value`. A word written twice on one line keeps its first reading.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {string} text the document's text (LF), for the run marker
 * @param {string | null} machine the name of the machine the document uses, for the run marker
 * @returns {Promise<Map<string, string>>}
 */
export async function numberWalk(h, scriptId, text, machine) {
  const lines = text.split('\n')
  const marker = `end|${machine ?? '(none)'}/${lines.length}:${lines[0].trim()}|-|-`
  await runScript(h, scriptId)
  await h.waitFor(() => reportRows(h, WALK_KEYS).includes(marker), { timeout: 30000 })
  /** @type {Map<string, string>} */
  const answers = new Map()
  for (const row of reportRows(h, WALK_KEYS)) {
    const [at, word, cls, value] = row.split('|')
    if (at === 'end') continue
    const key = `${at}:${word}`
    if (!answers.has(key)) answers.set(key, `${cls}|${value}`)
  }
  return answers
}

/**
 * A user script that reports the machine variants and the incremental and diameter words
 * the document's effective profile carries (`gedit_nc.incremental_axes`, `diameter_axes`),
 * which is what a script is handed under a machine's `U`/`W` choice.
 */
export const INCREMENTAL_REPORT = `# /// gedit
# name = "Harness incremental report"
# description = "Reports the incremental and diameter words of the effective profile and the variants of the machine."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H9). Not a bundled script."""

import gedit_nc

ctx = gedit_nc.load_context()
profile = ctx.get("profile") or {}
machine = gedit_nc.machine_params(ctx)
variants = machine["params"]["variants"]
incremental = gedit_nc.incremental_axes(profile)
rows = [
    {"key": "machine", "value": machine["name"] or "(none)"},
    {"key": "incrementalAddresses", "value": variants.get("incrementalAddresses") or "(none)"},
    {"key": "toolWord", "value": variants.get("toolWord") or "(none)"},
    {"key": "incremental", "value": " ".join("%s:%s" % (word, incremental[word]) for word in sorted(incremental)) or "(none)"},
    {"key": "diameter", "value": " ".join(gedit_nc.diameter_axes(profile)) or "(none)"},
]
gedit_nc.report("Incremental report", [{"key": "key", "label": "Parameter"}, {"key": "value", "label": "Value"}], rows)
`

/** The column keys of `INCREMENTAL_REPORT`. */
export const INCREMENTAL_KEYS = ['key', 'value']

// ---------------------------------------------------------------- a transform with a form

/**
 * Runs a transform command whose options form has to be accepted as it is. Waits for the
 * form's OK button itself (the form can be on screen a frame before its buttons), clicks it
 * and awaits the command.
 * @param {Harness} h
 * @param {string} commandId
 * @returns {Promise<boolean>}
 */
export async function runForm(h, commandId) {
  const running = context(h).commands.run(commandId)
  /** @type {Set<string>} */
  const said = new Set()
  const ok = await h.waitFor(
    () => {
      const line = message(h)
      if (line !== '') said.add(line)
      return h.q('modal-ok')
    },
    { timeout: 10000 },
  )
  if (!ok) {
    const alert = await h.alert.visible().catch(() => null)
    throw new Error(`${commandId}: no options form with an OK button (status bar: ${[...said].join(' / ') || 'nothing'}; alert: ${JSON.stringify(alert)}; document: ${context(h).docs.getActiveId?.() ?? '?'})`)
  }
  await h.frame()
  h.click(ok)
  await h.waitFor(() => !h.q('modal'), { timeout: 10000 })
  const answer = await running
  await h.idle()
  return answer
}

// ---------------------------------------------------------------- the program map

/**
 * The program-map rows on screen as `{ line, kind, text }`.
 * @param {Harness} h
 */
export const mapItems = (h) =>
  h.qa('program-map-item').map((element) => ({
    line: Number(element.dataset.line),
    kind: element.dataset.kind ?? '',
    text: element.querySelector('.text')?.textContent?.trim() ?? '',
  }))

/**
 * Waits until the active document's map has a row for `line` (the outline is rebuilt after
 * the document opens or the machine changes), and answers the rows.
 * @param {Harness} h
 * @param {number} line
 */
export async function mapWithLine(h, line) {
  await h.waitFor(() => mapItems(h).some((item) => item.line === line), { timeout: 15000 })
  await h.idle()
  return mapItems(h)
}

// ---------------------------------------------------------------- goldens

/**
 * Every fixture of one detection golden with the profile it must open as, skipping the two
 * kinds of answer that are not a profile (`fallback` keeps the current profile, `refused`
 * means the file does not open at all).
 * @param {Harness} h
 * @param {string} folder `expected/detect/<folder>.json`
 * @returns {Promise<[string, string][]>}
 */
export async function detectionPairs(h, folder) {
  const golden = await detectGolden(h, folder)
  return Object.entries(golden).filter(([, profile]) => profile !== 'fallback' && profile !== 'refused')
}

/**
 * `expected/owner-public/known-gaps.json`, the tokens the owner-public programs still read
 * as unknown: fixture path → the texts of its `unknown` entries.
 * @param {Harness} h
 * @returns {Promise<Map<string, string[]>>}
 */
export async function knownUnknowns(h) {
  const golden = JSON.parse(await h.disk.read(await h.fixture('expected/owner-public/known-gaps.json')))
  /** @type {Map<string, string[]>} */
  const found = new Map()
  for (const [rel, entry] of Object.entries(golden.files ?? {})) {
    found.set(rel, (entry?.unknown ?? []).map((/** @type {{ text: string }} */ item) => item.text))
  }
  return found
}
