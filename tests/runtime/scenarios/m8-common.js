// Helpers the M8 scenarios share. This file registers no scenario: `loadScenarios()`
// imports it like any other file under `scenarios/` and finds nothing new in it.
//
// Six things are worth knowing before reading a check that uses these:
//
//   1. **A script golden is opened under the dialect's own file name.** The inputs in
//      `tests/fixtures/scripts/**` are all called `input.nc`, and an Okuma program under
//      `.nc` may be read as a Fanuc lathe program (`docs/user/dialects.md`, the known
//      detection gap). A program reaches a turning shop with its control's extension, so
//      `openCaseAs` copies the input byte for byte to `<NAME>.MIN` or `<NAME>.MPF` and
//      opens that — and every scenario then checks the dialect it got before it runs a
//      single script, because a golden run under the wrong dialect proves nothing.
//   2. **Nothing NC is retyped.** Detection answers, outline items, script goldens, modal
//      states, preset labels and the database's cycle list are read at run time from the
//      fixtures, the profile or the code service. What *is* written out here is a claim the
//      milestone makes that no file states in that form — what a written number is worth
//      under each Okuma unit system — and it is written as the labels of those presets say
//      it, so a reviewer can hold the two side by side.
//   3. **The two harness scripts are throw-away user scripts** (`m5-common.writeUserScript`),
//      never files under `tests/runtime/fixtures/scripts/`, whose contents `m0-main`
//      asserts. They compute nothing the app could hand over: every value comes from
//      `gedit_nc`, the module every bundled script uses.
//   4. **A machine is created through the page where the milestone is about the page**,
//      and through `ctx.machines` where it is only the means: `m6-machines-manage` already
//      proves the page writes what it is given.
//   5. **The large programs are the ones `tests/gen/gen-large.mjs` writes**, byte for byte.
//      That module imports `node:fs` and cannot be bundled into the page, so the turning
//      half of it is ported below; `node tests/gen/gen-large.mjs --dialect okuma --lines
//      300000 --mb 10` writes the same file as `turningProgram('okuma')` (H8 checked it).
//   6. **Keypress to render is taken exactly as `m3-perf` takes it** (the measurement is
//      explained there): a capture-phase `keydown` stamp, the MutationObserver that sees
//      the character drawn, and the budget checked against that plus one frame.

import { context, openPath, plain, revealLine } from './m3-common.js'
import { setField } from './m4-common.js'
import { message, runScript, writeUserScript } from './m5-common.js'
import { clickMachineAction, machineAction, machineField, machineItem, pickerRows, settingsDialog } from './m6-common.js'

export { context, message, openPath, plain, revealLine, runScript, setField, writeUserScript }

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The two dialects of this milestone, by profile id. */
export const OKUMA = 'okuma-osp'
export const SINUMERIK = 'sinumerik'

// ---------------------------------------------------------------- fixtures and goldens

/**
 * A detection golden (`tests/fixtures/expected/detect/<folder>.json`): fixture → profile id.
 * @param {Harness} h
 * @param {string} folder
 * @returns {Promise<Record<string, string>>}
 */
export async function detectGolden(h, folder) {
  return JSON.parse(await h.disk.read(await h.fixture(`expected/detect/${folder}.json`))).fixtures
}

/**
 * An outline golden: its profile and its items.
 * @param {Harness} h
 * @param {string} rel e.g. `okuma/o01-flange.MIN`
 * @returns {Promise<{ profile: string, items: { kind: string, line: number, text: string, tool?: string }[] }>}
 */
export async function outlineGolden(h, rel) {
  return JSON.parse(await h.disk.read(await h.fixture(`expected/outline/${rel}.json`)))
}

/**
 * A copy of a file, byte for byte, opened under another name in the run folder.
 *
 * Use it for a fixture a scenario has already copied and opened: `h.fixture` copies afresh
 * on every call, and a second copy changes the mtime under the open document.
 * @param {Harness} h
 * @param {string} source absolute path
 * @param {string} name file name in the run folder
 * @returns {Promise<{ path: string, id: string }>}
 */
export async function openCopy(h, source, name) {
  const path = `${h.cfg.run}/${name}`
  await h.disk.copy(source, path)
  return openPath(h, path)
}

/**
 * A copy of a fixture opened under another file name, byte for byte.
 * @param {Harness} h
 * @param {string} rel path under `tests/fixtures`
 * @param {string} name file name in the run folder
 * @returns {Promise<{ path: string, id: string }>}
 */
export async function openFixtureAs(h, rel, name) {
  return openCopy(h, await h.fixture(rel), name)
}

/**
 * @typedef {object} ScriptCase
 * @property {string} dir the case folder, copied into the run folder
 * @property {string} input
 * @property {string | null} expected `expected.nc` of a replace script
 * @property {any} envelope `envelope.json`: `{ message, findings }`
 * @property {any} report `expected.json` of a report script
 * @property {any} options `case.json`
 * @property {Record<string, string | number | boolean>} params `params.json`, the form's fields
 */

/**
 * `tests/fixtures/scripts/<rel>/`, copied into the run folder and read.
 * @param {Harness} h
 * @param {string} rel e.g. `scale_feed/okuma-turning`
 * @returns {Promise<ScriptCase>}
 */
export async function scriptCase(h, rel) {
  const dir = await h.fixture(`scripts/${rel}`)
  /** @param {string} name */
  const read = async (name) => h.disk.read(`${dir}/${name}`).catch(() => null)
  const input = await read('input.nc')
  if (input === null) throw new Error(`scriptCase: ${rel} has no input.nc`)
  return {
    dir,
    input,
    expected: await read('expected.nc'),
    envelope: JSON.parse((await read('envelope.json')) ?? 'null'),
    report: JSON.parse((await read('expected.json')) ?? 'null'),
    options: JSON.parse((await read('case.json')) ?? '{}'),
    params: JSON.parse((await read('params.json')) ?? '{}'),
  }
}

/**
 * Opens a case's `input.nc`, byte for byte, as `name` in the run folder (point 1 above).
 * @param {Harness} h
 * @param {ScriptCase} c
 * @param {string} name e.g. `O05-SCALE.MIN`
 * @returns {Promise<{ path: string, id: string }>}
 */
export async function openCaseAs(h, c, name) {
  const path = `${h.cfg.run}/${name}`
  await h.disk.copy(`${c.dir}/input.nc`, path)
  return openPath(h, path)
}

// ---------------------------------------------------------------- the Results panel

/**
 * The findings on screen as `line|severity|message`.
 *
 * `ResultsPanel` draws a severity badge and a "Line N" label beside the text, so the
 * message is read out of its own `.text` span rather than out of the row's `textContent`.
 * @param {Harness} h
 */
export const findings = (h) =>
  h.qa('results-finding').map((element) => `${element.dataset.line}|${element.dataset.severity}|${element.querySelector('.text')?.textContent?.trim() ?? ''}`)

/** The same shape, from a golden's `findings` array. */
export const goldenFindings = (/** @type {any[]} */ list) => (list ?? []).map((f) => `${f.line}|${f.severity}|${f.message}`)

/**
 * The report rows on screen, one string per row, the cells joined with `|` in the order of
 * `keys`. A cell is read by its column key, never by its position.
 * @param {Harness} h
 * @param {string[]} keys
 */
export const reportRows = (h, keys) =>
  h.qa('results-row').map((row) => keys.map((key) => row.querySelector(`.cell[data-column="${key}"]`)?.textContent?.trim() ?? '').join('|'))

/**
 * The rows a report golden (`expected.json`) holds, in the same shape.
 * @param {any} report
 */
export const goldenRows = (report) =>
  report.rows.map((/** @type {any} */ row) => report.columns.map((/** @type {any} */ column) => String(row[column.key] ?? '')).join('|'))

/**
 * Whether the status bar ends with the script's own summary: `app/scripts.ts` puts the
 * script's name and what it did in front of it.
 * @param {Harness} h
 * @param {string} golden
 */
export const summaryIs = (h, golden) => message(h).endsWith(golden)

/**
 * One line of a document, `''` past its end.
 * @param {Harness} h
 * @param {string} id
 * @param {number} line
 */
export const lineOf = (h, id, line) => context(h).editor.getLines(id, line, line)[0] ?? ''

// ---------------------------------------------------------------- the machine item and the page

/**
 * Clicks the machine status item — the user's way in — and, in the picker it opens, the
 * entry called `label`.
 *
 * The item's click runs `file.setMachine` without handing its promise to anyone, so there
 * is nothing to await: the scenario waits for the picker instead. When the entry is
 * "Manage machines…", that command only settles once the settings dialog is closed again,
 * which is the other reason nothing here awaits it.
 * @param {Harness} h
 * @param {string} label
 * @returns {Promise<ReturnType<typeof pickerRows>>} the rows the picker offered
 */
export async function pickFromItem(h, label) {
  const item = machineItem(h)
  if (!item) throw new Error('pickFromItem: there is no machine item on this document')
  h.click(item)
  if (!(await h.waitFor(() => h.q('quick-pick'), { timeout: 8000 }))) throw new Error('the machine item opened no picker')
  const rows = pickerRows(h)
  const row = rows.find((entry) => entry.label === label)
  if (!row) throw new Error(`pickFromItem: no entry ${JSON.stringify(label)} in ${JSON.stringify(rows.map((e) => e.label))}`)
  h.click(row.element)
  await h.waitFor(() => !h.q('quick-pick'), { timeout: 8000 })
  await h.idle()
  return rows
}

/**
 * The options of a choice field of the machine form: their labels, and the one selected.
 * @param {Harness} h
 * @param {string} field
 */
export function choiceOf(h, field) {
  const select = /** @type {HTMLSelectElement | null} */ (machineField(h, field)?.querySelector('select') ?? null)
  return {
    labels: [...(select?.options ?? [])].map((option) => option.textContent?.trim() ?? ''),
    selected: select?.selectedOptions[0]?.textContent?.trim() ?? '',
  }
}

/**
 * The label the machine form shows for a preset of the profile: its own label, and "(unconfirmed)"
 * after it when the preset is marked `verify` (B1 A4, `machines.value.unconfirmed`).
 * @param {Harness} h
 * @param {{ label: string, verify?: boolean }} preset
 */
export function shownPreset(h, preset) {
  return preset.verify === true ? `${preset.label} (${context(h).t('machines.value.unconfirmed')})` : preset.label
}

/**
 * Whether a bool field of the machine form is ticked, or null when the form has no such field.
 * @param {Harness} h
 * @param {string} field
 */
export function ticked(h, field) {
  const box = /** @type {HTMLInputElement | null} */ (machineField(h, field)?.querySelector('input[type="checkbox"]') ?? null)
  return box === null ? null : box.checked
}

/**
 * Settings ▸ Machines ▸ Add, the dialect step answered with `profileId`: leaves the
 * parameter form of that dialect on screen.
 * @param {Harness} h
 * @param {string} profileId
 */
export async function startAdd(h, profileId) {
  await clickMachineAction(h, 'add')
  if (h.q('machine-form')?.dataset.step !== 'profile') throw new Error('Add did not ask for the dialect first')
  const name = context(h).profiles.get(profileId)?.name
  if (name === undefined) throw new Error(`startAdd: no profile ${profileId}`)
  setField(h, 'profile', name)
  await h.frame()
  await clickMachineAction(h, 'next')
  await h.waitFor(() => h.q('machine-form')?.dataset.step === 'params', { timeout: 8000 })
}

/**
 * Fills the machine form that is on screen and saves it, waiting until the list is back.
 * @param {Harness} h
 * @param {Record<string, string | number | boolean>} fields
 */
export async function saveMachineForm(h, fields) {
  for (const [field, value] of Object.entries(fields)) setField(h, field, value)
  await h.frame()
  const save = /** @type {HTMLButtonElement | undefined} */ (machineAction(h, 'save'))
  if (save === undefined) throw new Error('saveMachineForm: the form has no Save button')
  if (save.disabled) throw new Error(`saveMachineForm: Save is disabled with ${JSON.stringify(fields)}`)
  h.click(save)
  await h.waitFor(() => !h.q('machine-form'), { timeout: 10000 })
  await h.idle()
}

/**
 * Closes the settings dialog with Cancel, which writes no settings key. A machine the page
 * saved is already in `machines.json`: the page writes it at Save, not at OK.
 * @param {Harness} h
 */
export async function closeSettingsDialog(h) {
  h.click(h.q('modal-cancel'))
  await h.waitFor(() => !settingsDialog(h), { timeout: 8000 })
  await h.idle()
}

// ---------------------------------------------------------------- the harness scripts

/**
 * A user script that reports the document's effective machine and what written numbers
 * are worth under it.
 *
 * A value is `gedit_nc.resolve_value` — the function a script uses before it compares a
 * value with anything — so a word whose meaning the machine decides and no machine was
 * chosen for is reported as such rather than given a number (AD-31 "No machine, no
 * guess"). The words are the ones the Okuma preset labels use as their own examples.
 */
export const MACHINE_REPORT = `# /// gedit
# name = "Harness machine report"
# description = "Reports the effective machine of the document and what written numbers are worth under it."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H8). Not a bundled script."""

import gedit_nc

ctx = gedit_nc.load_context()
profile = ctx.get("profile") or {}
machine = gedit_nc.machine_params(ctx)
params = machine["params"]
source = machine["source"]
units = params["units"]
rules = params["numberInput"] or {}


def worth(raw, number_class):
    literal = {"raw": raw, "has_point": "." in raw}
    value, readings = gedit_nc.resolve_value(literal, number_class, machine, profile, units)
    if value is not None:
        return value
    return "(depends on the machine)" if readings else "(no value)"


rows = [
    {"key": "machine", "value": machine["name"] or "(none)", "source": machine["choice"]},
    {"key": "numberInput.mode", "value": rules.get("mode") or "(none)", "source": source["numberInput"]},
    {"key": "numberInput.incrementMm", "value": rules.get("incrementMm") or "(none)", "source": source["numberInput"]},
    {"key": "units", "value": units, "source": source["units"]},
    {"key": "diameter", "value": params["diameter"] or "(none)", "source": source["diameter"]},
]
for word, raw, number_class, unit in [
    ("X50", "50", "length", "mm"),
    ("X50.", "50.", "length", "mm"),
    ("X50000", "50000", "length", "mm"),
    ("X0.1", "0.1", "length", "mm"),
    ("F250", "250", "feedPerRev", "mm/rev"),
    ("F25", "25", "feedPerRev", "mm/rev"),
    ("F0.25", "0.25", "feedPerRev", "mm/rev"),
    ("G04 F200", "200", "dwell", "s"),
    ("G04 F20", "20", "dwell", "s"),
    ("G04 F2", "2", "dwell", "s"),
]:
    rows.append({"key": word, "value": worth(raw, number_class), "source": unit})

gedit_nc.report(
    "Machine report",
    [{"key": "key", "label": "Parameter"}, {"key": "value", "label": "Value"}, {"key": "source", "label": "Source"}],
    rows,
)
`

/** The column keys of `MACHINE_REPORT`, in its order. */
export const REPORT_KEYS = ['key', 'value', 'source']

/** How many rows `MACHINE_REPORT` writes. */
export const REPORT_ROWS = 15

/**
 * Runs a report script and reads its rows once there are at least `rows` of them.
 * @param {Harness} h
 * @param {string} scriptId
 * @param {string[]} keys
 * @param {number} rows
 */
export async function runReport(h, scriptId, keys, rows) {
  // The panel keeps the previous report's rows until the new one arrives, so the old ones
  // are counted away first: a run that answered nothing must not read as the last answer.
  const before = h.qa('results-row').length
  await runScript(h, scriptId)
  await h.waitFor(() => h.qa('results-row').length >= rows, { timeout: 30000 })
  const got = reportRows(h, keys)
  return { rows: got, before }
}

/**
 * A user script that walks the document through `gedit_nc.ModalInterpreter`, line by
 * line, and reports the state after each one in the notation of the modal goldens
 * (`tests/python/test_modal.py` `render`): `G95` set by the program, `=G95` assumed from
 * the profile, `=off@machine` assumed from the machine.
 *
 * The context is the one `app/scripts.ts` builds — the **effective** profile and code
 * database of the document, with its machine applied — which is the thing a golden in
 * `tests/fixtures/modal/` cannot see: those run on a generated effective profile, this runs
 * on the one the app made.
 */
export const MODAL_WALK = `# /// gedit
# name = "Harness modal walk"
# description = "Walks the document through the modal interpreter and reports the state after every line."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's runtime harness (H8). Not a bundled script."""

import json

import gedit_nc


def marked(value, record):
    if value is None or record is None:
        return None
    if not record.get("assumed"):
        return value
    source = record.get("from")
    if isinstance(source, str) and source not in ("", "profile"):
        return "=%s@%s" % (value, source)
    return "=" + value


def render(state):
    diameter = state["diameter"]
    tool = state["tool"]
    cycle = state["activeCycle"]
    return {
        "groups": {name: marked(value.get("code"), value) for name, value in state["groups"].items()},
        "feedUnit": state["feedUnit"],
        "speedUnit": state["speedUnit"],
        "distance": state["distance"],
        "plane": state["plane"],
        "units": marked(state["units"]["value"], state["units"]),
        "diameter": marked(diameter["mode"], diameter) if diameter is not None else None,
        "tool": tool["station"] if tool is not None else None,
        "activeCycle": cycle["code"] if cycle is not None else None,
        "pitchFeedAmbiguous": state["pitchFeedAmbiguous"],
        "block": state["block"],
        "feed": state["feed"],
        "speed": state["speed"],
        "speedLimit": state["speedLimit"],
    }


context = gedit_nc.load_context()
cp = gedit_nc.compile_profile(context.get("profile") or {})
interp = gedit_nc.ModalInterpreter(cp, context.get("codes") or [])
state = None
rows = []
for number, line in enumerate(gedit_nc.read_input(), 1):
    tokens, state = gedit_nc.tokenize_line(line, cp, state)
    interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
    rows.append({
        "at": str(number),
        "x": interp.diameter_reading("X"),
        "state": json.dumps(render(interp.state), sort_keys=True),
    })

gedit_nc.report(
    "Modal walk",
    [{"key": "at", "label": "Line"}, {"key": "x", "label": "X is"}, {"key": "state", "label": "State"}],
    rows,
)
`

/**
 * Runs `MODAL_WALK` and answers the state after each line, 1-based (`[n - 1]` is line n).
 * @param {Harness} h
 * @param {string} scriptId
 * @param {number} lines the document's line count
 * @returns {Promise<{ x: string, state: any }[]>}
 */
export async function modalWalk(h, scriptId, lines) {
  await runScript(h, scriptId)
  await h.waitFor(() => h.qa('results-row').length >= lines, { timeout: 30000 })
  return h.qa('results-row').map((row) => {
    const cell = (/** @type {string} */ key) => row.querySelector(`.cell[data-column="${key}"]`)?.textContent ?? ''
    let state = null
    try {
      state = JSON.parse(cell('state'))
    } catch {
      state = null
    }
    return { at: Number(cell('at')), x: cell('x').trim(), state }
  }).sort((a, b) => a.at - b.at).map(({ x, state }) => ({ x, state }))
}

/**
 * The claims of one golden state that do not hold, compared the way `test_modal.py`
 * `check` compares them: only the keys the golden lists; `groups` and `block` member by
 * member; a feed, speed or clamp by the value as written, or by the fields a golden object
 * names.
 * @param {any} state the rendered state after the line
 * @param {Record<string, any>} after the golden's claims
 * @returns {string[]} one `key: got … want …` per claim that fails
 */
export function brokenClaims(state, after) {
  /** @type {string[]} */
  const broken = []
  if (state === null || typeof state !== 'object') return ['(no state was reported for this line)']
  const say = (/** @type {string} */ key, /** @type {unknown} */ got, /** @type {unknown} */ want) => broken.push(`${key}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  for (const [key, want] of Object.entries(after)) {
    if (key === 'groups' || key === 'block') {
      for (const [member, value] of Object.entries(/** @type {Record<string, unknown>} */ (want))) {
        const got = state[key]?.[member] ?? null
        if (got !== value) say(`${key}.${member}`, got, value)
      }
    } else if (key === 'feed' || key === 'speed' || key === 'speedLimit') {
      const got = state[key]
      if (want === null) {
        if (got !== null) say(key, got, want)
      } else if (typeof want === 'string') {
        if (got?.valueText !== want) say(key, got?.valueText ?? null, want)
      } else {
        for (const [member, value] of Object.entries(/** @type {Record<string, unknown>} */ (want))) {
          if (got?.[member] !== value) say(`${key}.${member}`, got?.[member], value)
        }
      }
    } else if (JSON.stringify(state[key] ?? null) !== JSON.stringify(want)) {
      say(key, state[key], want)
    }
  }
  return broken
}

// ---------------------------------------------------------------- the large programs

/** The Okuma seed of `tests/gen/gen-large.mjs`, unchanged. */
const OKUMA_SEED = [
  '(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)',
  'O0001',
  '(SHAFT - SYNTHETIC TURNING SOURCE)',
  '(T01 OD ROUGH)',
  '(T02 OD FINISH)',
  '(T03 GROOVE)',
  'G50 S2200',
  'G00 X400 Z300',
  '(OD ROUGH)',
  'T0101',
  'G96 S180 M03 M42',
  'G00 X62 Z3 M08',
  'G95 G01 Z0 F0.3',
  'G01 X-1.6',
  'G00 Z3.',
  'G00 X400 Z300 M09',
  '(OD FINISH)',
  'T0202',
  'G96 S240 M03',
  'G00 X56 Z3 M08',
  'G01 Z-40. F0.15',
  'G00 X400 Z300 M09',
  '(GROOVE)',
  'T0303',
  'G97 S900 M03',
  'G00 X58 Z-30. M08',
  'G01 X52. F0.08',
  'G00 X58.',
  'G00 X400 Z300 M09',
  'M05',
  'M02',
  '%',
]

/** The Sinumerik seed of `tests/gen/gen-large.mjs`, unchanged. */
const SINUMERIK_SEED = [
  '; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE',
  '; SHAFT - SYNTHETIC TURNING SOURCE',
  '; T1 OD ROUGH',
  '; T2 OD FINISH',
  '; T3 GROOVE',
  'G18 G90 G95 G40 DIAMON',
  'G500',
  'G0 X200 Z200',
  '; OD ROUGH',
  'T1 D1',
  'G96 S220 LIMS=2500 M4',
  'G0 X62 Z3 M8',
  'G1 Z0 F0.3',
  'G1 X-1.6',
  'G0 Z3',
  'G0 X200 Z200 M9',
  '; OD FINISH',
  'T2 D1',
  'G96 S240 M4',
  'G0 X56 Z3 M8',
  'G1 Z-40 F0.15',
  'G0 X200 Z200 M9',
  '; GROOVE',
  'T3 D1',
  'G97 S900 M4',
  'G0 X58 Z-30 M8',
  'G1 X52 F0.08',
  'G0 X58',
  'G0 X200 Z200 M9',
  'M5',
  'M30',
]

/**
 * The splitting rules of `gen-large.mjs` for the two turning dialects, as sources: a
 * lookbehind is written into a `RegExp` constructor rather than a literal, so the page
 * bundle needs no regex transform for its target.
 */
const TURNING_RULES = {
  okuma: {
    seed: OKUMA_SEED,
    toolChange: new RegExp('(?<![A-Z])T(?!(?:\\d{2})?00\\d{2}(?!\\d))\\d{4}(?:\\d{2})?(?!\\d)', 'i'),
    lead: /^\s*\(.*\)\s*$/,
    end: /^\s*(?:N\w+\s+)?M0*(?:30|2)(?!\d)/i,
    feed: /^\s*(?:N\w+\s+)?(?:G\d+\s+)*G0*1(?![\d.])/i,
    cycle: new RegExp('(?<![A-Z])G(?:7[1-8]|18[1-9])(?![\\d.])', 'i'),
  },
  sinumerik: {
    seed: SINUMERIK_SEED,
    toolChange: new RegExp('^[^;]*?(?<![A-Z_$])T(?:\\s*=\\s*"[^"]*"|(?!0+(?![\\d.]))\\d+(?![\\d.]))', 'i'),
    lead: /^\s*;/,
    end: /^\s*(?:N\d+\s+)?M0*(?:30|2)(?![\d.])/i,
    feed: /^\s*(?:N\d+\s+)?(?:G\d+\s+)*G0*1(?![\d.])/i,
    cycle: new RegExp('(?<![A-Z_])CYCLE\\d+\\s*\\(', 'i'),
  },
}

/** `gen-large.mjs` `MAX_RUN`: most moves of a segment go into one run. */
const MAX_RUN = 2000

/**
 * Fixed-point value with 4 decimals, without a negative zero (`gen-large.mjs` `coord`).
 * @param {number} value
 */
const coord = (value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(4)

/**
 * Gives the tools of the n-th copy of the segments new numbers (`gen-large.mjs`
 * `renumberTools`, the two turning branches).
 * @param {string} line
 * @param {'okuma' | 'sinumerik'} dialect
 * @param {number} shift
 */
function renumberTools(line, dialect, shift) {
  const next = (/** @type {string} */ n) => String(((Number(n) - 1 + shift) % 99) + 1)
  if (dialect === 'sinumerik') {
    const comment = line.indexOf(';')
    const code = comment < 0 ? line : line.slice(0, comment)
    const rest = comment < 0 ? '' : line.slice(comment)
    return code.replace(new RegExp('(?<![A-Z_$])T(\\d+)(?![\\d.])', 'gi'), (_, n) => 'T' + next(n)) + rest
  }
  const comment = line.indexOf('(')
  const code = comment < 0 ? line : line.slice(0, comment)
  const rest = comment < 0 ? '' : line.slice(comment)
  return (
    code.replace(new RegExp('(?<![A-Z])T(\\d{4}|\\d{6})(?!\\d)', 'gi'), (_, /** @type {string} */ digits) => {
      const pairs = digits.match(/\d{2}/g) ?? []
      return 'T' + pairs.map((pair) => next(pair).padStart(2, '0')).join('')
    }) + rest
  )
}

/**
 * The program `node tests/gen/gen-large.mjs --dialect <dialect> --lines <lines> --mb <mb>`
 * writes, CRLF: the seed's header and footer around copies of its tool segments, each copy
 * with new turret stations and a run of turning passes, until the program has at least
 * `lines` lines **and** `mb` MiB.
 * @param {'okuma' | 'sinumerik'} dialect
 * @param {{ lines?: number, mb?: number }} [o]
 */
export function turningProgram(dialect, { lines: minLines = 300000, mb = 10 } = {}) {
  const rules = TURNING_RULES[dialect]
  const source = [...rules.seed]
  const endAt = source.findIndex((line) => rules.end.test(line))
  /** @type {number[]} */
  const starts = []
  for (let i = 0; i < endAt; i++) {
    if (!rules.toolChange.test(source[i])) continue
    let start = i
    while (start > 0 && rules.lead.test(source[start - 1])) start--
    starts.push(start)
  }
  const segments = starts.map((start, i) => {
    const segLines = source.slice(start, starts[i + 1] ?? endAt)
    const anchor = segLines.findIndex((line) => rules.feed.test(line) || rules.cycle.test(line))
    return { lines: segLines, anchor, kind: rules.feed.test(segLines[anchor]) ? 'feed' : 'cycle' }
  })
  const header = source.slice(0, starts[0])
  const footer = source.slice(endAt)

  const eol = '\r\n'
  const minBytes = mb * 1024 * 1024
  const size = (/** @type {string[]} */ list) => list.reduce((n, line) => n + line.length + eol.length, 0)
  /** @type {string[]} */
  const out = []
  let bytes = 0
  const push = (/** @type {string} */ line) => {
    out.push(line)
    bytes += line.length + eol.length
  }
  const enough = (/** @type {number} */ moreLines, /** @type {number} */ moreBytes) => out.length + moreLines >= minLines && bytes + moreBytes >= minBytes

  // `createMoves` of the generator, turning branch: passes along a shaft, a diameter and a
  // length with a feed per revolution; a driven-tool cycle repeats at C angles.
  let step = 0
  let hole = 0
  let dia = 60
  let along = 0
  const move = (/** @type {string} */ kind) => {
    if (kind === 'cycle') {
      hole++
      return { words: [`C${coord((hole * 15) % 360)}`, `Z${coord(-2 - (hole % 5))}`], optional: 0 }
    }
    along -= 0.5
    if (along < -120) {
      along = 0
      dia = dia <= 12 ? 60 : dia - 0.5
    }
    const feedPerRev = (0.08 + (step++ % 7) * 0.02).toFixed(3)
    return { words: [`X${coord(dia)}`, `Z${coord(along)}`, `F${feedPerRev}`], optional: 1 }
  }

  header.forEach(push)
  const footerBytes = size(footer)
  for (let copy = 0, done = false; !done; copy++) {
    for (const segment of segments) {
      const lines = segment.lines.map((line) => renumberTools(line, dialect, copy * segments.length))
      const tail = lines.slice(segment.anchor + 1)
      const restLines = tail.length + footer.length
      const restBytes = size(tail) + footerBytes
      lines.slice(0, segment.anchor + 1).forEach(push)
      for (let run = 0; run < MAX_RUN && !enough(restLines, restBytes); run++) {
        const { words, optional } = move(segment.kind)
        const linesLeft = minLines - out.length - restLines
        const perLine = linesLeft > 0 ? (minBytes - bytes - restBytes) / linesLeft : Infinity
        let used = words.length - optional
        while (used < words.length && words.slice(0, used).join(' ').length + eol.length < perLine) used++
        push(words.slice(0, used).join(' '))
      }
      tail.forEach(push)
      if (enough(footer.length, footerBytes)) {
        done = true
        break
      }
    }
  }
  footer.forEach(push)
  return out.join(eol) + eol
}

// ---------------------------------------------------------------- keypress to render

/** One frame at 60 Hz, rounded up: the most the compositor can add after the DOM write. */
export const FRAME_MS = 17

/**
 * Percentile of a sample, nearest rank.
 * @param {number[]} values
 * @param {number} p
 */
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

/**
 * Resolves at the moment a DOM change makes `predicate` true, sampling on every mutation
 * rather than on a timer (`m3-perf`).
 * @param {() => boolean} predicate
 * @param {number} timeout
 * @returns {Promise<number | null>} when it became true
 */
export const untilDom = (predicate, timeout) =>
  new Promise((resolve) => {
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

/** The next animation frame. @returns {Promise<number>} */
export const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())))

/**
 * Whether Monaco currently has a view line with exactly this text.
 * @param {Harness} h
 * @param {string} text
 */
export function drawn(h, text) {
  for (const line of h.q('editor-host')?.querySelectorAll('.view-lines .view-line') ?? []) {
    if (plain(line.textContent) === text) return true
  }
  return false
}

/**
 * Types `count` characters at the end of `line` with real key presses and measures each
 * one, from the `keydown` in the page to the frame that draws it — `m3-perf`'s method,
 * including its warm-up key and its bounded retry of a dropped NSEvent.
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

  // One key first, thrown away: it proves the keyboard reaches *this* document before a
  // number is taken from it (the first key after a 10 MB open was seen to go nowhere).
  const warmTarget = `${modelLine()}1`
  await h.nativeKeys([{ key: '1' }])
  let warmed = (await untilDom(() => drawn(h, warmTarget), 15000)) !== null
  if (!warmed) {
    await focus()
    const retarget = `${modelLine()}1`
    await h.nativeKeys([{ key: '1' }])
    warmed = (await untilDom(() => drawn(h, retarget), 15000)) !== null
  }

  const original = modelLine()
  /** @type {number[]} */
  const dom = []
  /** @type {number[]} */
  const paint = []
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
      const painted = await nextPaint()
      dom.push(shown - keydownAt[0])
      paint.push(painted - keydownAt[0])
    }
  } finally {
    window.removeEventListener('keydown', stamp, true)
  }
  const round = (/** @type {number[]} */ values) => values.map((value) => Math.round(value))
  return {
    focused,
    warmed,
    retries,
    count: paint.length,
    typed: modelLine().length - original.length,
    domP95: dom.length > 0 ? Math.round(percentile(dom, 95)) : -1,
    rafP95: paint.length > 0 ? Math.round(percentile(paint, 95)) : -1,
    worst: paint.length > 0 ? Math.round(Math.max(...paint)) : -1,
    domSamples: round(dom),
    rafSamples: round(paint),
  }
}
