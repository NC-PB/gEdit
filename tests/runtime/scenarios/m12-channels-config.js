// Settings ▸ Machines ▸ Channels, and the file it writes (plan §6 M12 H12 `m12-channels-config`;
// WP12.3, I12 item 4, §7.15, §7.17, AD-32, X12 d): an NC programmer sets up a two-channel
// machine on the page without meeting a regular expression until she wants to, and
// `machines.json` on disk is the golden.
//
// **What the step is, as the owner asked for it** ("something that makes sense but does not
// overwhelm the user"): a layout choice, the channels (a short name, a name, the other ways it is
// written), and one text box for the wait codes, `M900-M999, M300`, with a live preview under it
// and a plain message that quotes the bad item. The patterns sit behind "Advanced", which does
// not open by itself while she works. A preset is a starting point and is copied only by its
// button, and by a second press when there are settings to replace.
//
// Three things about how this is driven:
//
//   1. **A choice is picked by its index.** `FormRenderer` gives a choice's `<select>` the indices of
//      its `choices` as option values (`selectChoice` in `m2-common.js` picks by label instead), and a
//      label is the user's wording, not the contract. The orders are those of `channelFields.ts`:
//      layout `none`, `single-file`, `multi-file`; partners `all`, `fixed`, `digits`, `bitmask`, `line`.
//   2. **The file is the contract, not the list on screen.** Every step that saves is judged by
//      `h.config.read('machines.json')` against a golden written out in full (keys sorted, the way
//      Rust writes them). The channel block is spelled out, not read from the form.
//   3. **A broken block costs the channels and nothing else (X12 d).** The scenario breaks the section
//      pattern *by hand*, the way a user with a text editor would (the file is opened as a document, as
//      in `m6-machines-manage`), and holds the machine to: it is listed with its problem, it can still
//      be picked, the machine item and the tooltip with every effective number rule are the same as
//      before, and what the page writes next leaves the broken block exactly as it was.

import { scenario } from '../lib/index.js'
import { setField } from './m4-common.js'
import { configPaths, setInput as typeInto } from './m2-common.js'
import {
  clickMachineAction,
  closeSettings,
  machineAction,
  machineRows,
  machineTooltip,
  machinesFile,
  openMachinesPage,
  pickMachine,
  sameJson,
  waitForMachine,
} from './m6-common.js'
import { NC_DIR, REPO_FILE, channelItem, channelState, context, golden, mapRows, open, ready, waitChannel } from './m12-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/** The two program numbers by their first digit: `O1xxx` is channel 1, `O2xxx` channel 2; M99 and M30 end a section. */
const SECTION_START = '^O(?<channel>[12])\\d{3}(?![\\d.])'
const SECTION_END = '(?<![A-Z])M(?:99|30)(?![\\d.])'

/** What the lathe's own default stores for the rest of a machine (`m6-machines-manage`; the tool word is `byLength` since M12.5). */
const LATHE_REST = { numberInput: { mode: 'calculator', incrementMm: '0.001' }, units: 'mm', diameter: 'on', variants: { gcodeSystem: 'A', incrementalAddresses: 'uw', toolWord: 'byLength' } }

/** The channel block the steps below build. */
const WANTED = {
  layout: 'single-file',
  list: [
    { id: '1', name: 'Path 1', aliases: ['P1'] },
    { id: '2', name: 'Path 2', aliases: ['P2'] },
  ],
  sectionStart: SECTION_START,
  sectionEnd: SECTION_END,
  syncMarks: [
    {
      id: 'rule-1',
      label: 'Waits',
      match: { kind: 'codes', codes: 'M900-M999, M300' },
      partners: { kind: 'word', address: 'P', decode: 'digits', whenAbsent: { kind: 'none' } },
    },
  ],
}

/** A record as the page writes it. @param {object} channels */
const record = (channels) => ({ id: 'twin-lathe', name: 'Twin lathe', profile: 'fanuc-lathe', notes: '', params: { ...LATHE_REST, channels } })

/** The file, with the defaults the page may add. @param {object[]} machines @param {Record<string, string>} [defaults] */
const file = (machines, defaults = {}) => ({ $version: 1, machines, defaults })

/**
 * Picks the option with this index in a choice field (see 1. above).
 * @param {Harness} h
 * @param {string} field
 * @param {number} index
 */
function choose(h, field, index) {
  const select = /** @type {HTMLSelectElement | null} */ (h.q('form-field', { field })?.querySelector('select'))
  if (!select) throw new Error(`choose: no select in field ${field}`)
  h.select(select, String(index))
}

/** The text control of a field. @param {Harness} h @param {string} field */
const control = (h, field) => /** @type {HTMLInputElement} */ (h.q('form-field', { field })?.querySelector('input, textarea'))

/** Whether Save can be pressed. @param {Harness} h */
const saveDisabled = (h) => /** @type {HTMLButtonElement} */ (machineAction(h, 'save')).disabled

/** The text and state of the preview under the wait codes. @param {Harness} h */
const preview = (h) => ({ state: h.q('codes-preview')?.dataset.state ?? '', text: (h.q('codes-preview')?.textContent ?? '').replace(/\s+/g, ' ').trim() })

/** The `<details>` of the Advanced disclosure and the tester. @param {Harness} h @param {string} id */
const details = (h, id) => /** @type {HTMLDetailsElement} */ (h.q(id))

scenario('m12-channels-config', { timeout: 420, files: REPO_FILE }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const c10 = await golden(h, 'c10-alternating')
  const dir = await h.fixture(NC_DIR)
  const program = await h.disk.read(`${dir}/c10-alternating.nc`)

  // ==================================================================== A. the step
  const page = await openMachinesPage(h)
  await clickMachineAction(h, 'add')
  setField(h, 'profile', /** @type {string} */ (ctx.profiles.get('fanuc-lathe')?.name))
  await h.frame()
  await clickMachineAction(h, 'next')
  h.check('a Fanuc lathe machine has a Channels step under its other settings', !!h.q('machine-channels-step') && !!h.q('channels-form'), h.qa('form-field').map((e) => e.dataset.field))
  h.check('which starts at "No channels": nothing to fill in, no Advanced, no tester', !!h.q('channels-none') && !h.q('channels-advanced') && !h.q('channels-tester') && h.qa('channel-row').length === 0)
  setField(h, 'name', 'Twin lathe')
  await h.idle()
  h.check('and the machine can already be saved with just a name', !saveDisabled(h))

  choose(h, 'layout', 1)
  await h.idle()
  h.check('choosing "all in one program" gives two channels to name and no wait codes yet', h.qa('channel-row').length === 2 && h.qa('rule-card').length === 0 && !!h.q('rules-none'), h.qa('channel-row').map((e) => e.dataset.channel))
  h.check('Advanced is there and closed', !!h.q('channels-advanced') && details(h, 'channels-advanced').open === false)
  h.check('a one-program machine without a way to find its sections cannot be saved yet, and the page says why', saveDisabled(h) && !!h.q('channels-problems'), h.q('channels-problems')?.textContent)

  // The channels: a short name, a name, other ways of writing it.
  const rowsEl = h.qa('channel-row')
  /** @param {HTMLElement} row @param {string} short @param {string} name @param {string} aliases */
  const fillChannel = (row, short, name, aliases) => {
    const inputs = [...row.querySelectorAll('input')]
    typeInto(inputs[0], short)
    typeInto(inputs[1], name)
    typeInto(inputs[2], aliases)
  }
  fillChannel(rowsEl[0], '1', 'Path 1', 'P1')
  fillChannel(rowsEl[1], '2', 'Path 2', 'P2')
  await h.idle()
  h.check('the channels take a name and aliases', h.qa('channel-row').map((r) => [...r.querySelectorAll('input')].map((i) => i.value).join('|')).join(',') === '1|Path 1|P1,2|Path 2|P2', h.qa('channel-row').map((r) => [...r.querySelectorAll('input')].map((i) => i.value)))

  // The wait codes: one text box, a live preview.
  h.click(h.q('rule-add'))
  await h.idle()
  h.check('"Add a wait rule" gives a card with the codes box and nothing else to learn first', h.qa('rule-card').length === 1 && !!control(h, 'codes') && preview(h).state === 'empty', preview(h))
  typeInto(control(h, 'label'), 'Waits')
  typeInto(control(h, 'codes'), 'M900-M999, M300')
  await h.idle()
  const good = preview(h)
  h.check('M900-M999, M300 is previewed (sorted) as M300 and a range of 100 codes: 101 in all', good.state === 'ok' && /M300.*M900.*M999.*100 codes.*101 codes/.test(good.text), good)
  choose(h, 'partners', 2)
  await h.idle()
  h.check('Advanced is still closed after all that', details(h, 'channels-advanced').open === false)

  // A bad item gives a plain message that quotes it, and Save waits.
  typeInto(control(h, 'codes'), 'M900-M999, M3OO')
  await h.idle()
  const bad = preview(h)
  h.check('"M3OO" (letter O) is named in a plain message and not previewed', bad.state === 'error' && /M3OO/.test(bad.text) && /not a number/.test(bad.text), bad)
  h.check('and Save is blocked while it stands, with the problem listed', saveDisabled(h) && /M3OO/.test(h.q('channels-problems')?.textContent ?? ''), h.q('channels-problems')?.textContent)
  typeInto(control(h, 'codes'), 'M900-M999, M300')
  await h.idle()
  h.check('written right again, the preview is back', preview(h).state === 'ok')

  // Advanced: the patterns. A pattern that does not compile is refused in the form.
  h.click(details(h, 'channels-advanced').querySelector('summary'))
  await h.waitFor(() => details(h, 'channels-advanced').open === true, { timeout: 3000 })
  typeInto(control(h, 'sectionStart'), '^O(')
  await h.idle()
  h.check('a section pattern that is not a regular expression is refused in the form: Save is blocked and the page says which', saveDisabled(h) && !!h.q('channels-problems'), h.q('channels-problems')?.textContent)
  h.check('the problem carries the path of the setting it is about', [...h.qa('channels-problems')[0].querySelectorAll('li')].some((li) => /sectionStart/.test(li.dataset.path ?? '')), [...h.qa('channels-problems')[0].querySelectorAll('li')].map((li) => li.dataset.path))
  typeInto(control(h, 'sectionStart'), SECTION_START)
  typeInto(control(h, 'sectionEnd'), SECTION_END)
  await h.idle()
  h.check('with the patterns right the problems are gone and Save is open', !h.q('channels-problems') && !saveDisabled(h))

  // ==================================================================== B. the tester
  h.check('the tester is there, closed', !!h.q('channels-tester') && details(h, 'channels-tester').open === false)
  h.click(details(h, 'channels-tester').querySelector('summary'))
  await h.waitFor(() => details(h, 'channels-tester').open === true, { timeout: 3000 })
  typeInto(h.q('channels-tester-text'), program)
  await h.waitFor(() => !!h.q('channels-tester-report'), { timeout: 5000 })
  await h.idle()
  const sections = h.qa('channels-tester-sections')[0]
  const rowOf = (/** @type {string} */ id) => [...(sections?.querySelectorAll('tbody tr') ?? [])].find((r) => /** @type {HTMLElement} */ (r).dataset.channel === id)
  const cells = (/** @type {Element | undefined} */ r) => [...(r?.querySelectorAll('td') ?? [])].map((td) => (td.textContent ?? '').trim())
  const want1 = c10.expect.sections[0].ranges.map((/** @type {any} */ r) => `${r.startLine}-${r.endLine}`).join(', ')
  h.check('pasted program lines: a channel with two sections shows two ranges, here channel 1 on 5-12 and 21-27', cells(rowOf('1')).join('|') === `Path 1|2|${want1}` && want1 === '5-12, 21-27', { got: cells(rowOf('1')), want1 })
  h.check('and channel 2 on 13-20 and 28-34: four ranges between the two', cells(rowOf('2')).join('|') === 'Path 2|2|13-20, 28-34', cells(rowOf('2')))
  h.check('that is not a problem: no problem list', !h.q('channels-tester-problems') && !h.q('channels-tester-none'))
  h.check('the lines no channel owns are named: 1-4 and 35-41', /1-4/.test(h.q('channels-tester-outside')?.textContent ?? '') && /35-41/.test(h.q('channels-tester-outside')?.textContent ?? ''), h.q('channels-tester-outside')?.textContent)
  const marks = [...(h.q('channels-tester-marks')?.querySelectorAll('tbody tr') ?? [])].map((r) => Number(/** @type {HTMLElement} */ (r).dataset.line))
  h.check('and the wait codes it found, by line: 11 and 26 in channel 1, 19 and 33 in channel 2', JSON.stringify(marks) === JSON.stringify([11, 19, 26, 33]), marks)
  h.check('each rule says how many it found and how long it took, none of them slow', h.qa('channels-tester-rules')[0]?.querySelector('tr[data-rule="rule-1"]')?.getAttribute('data-slow') === '0', h.q('channels-tester-rules')?.textContent)
  h.check('the tester wrote nothing', (await machinesFile(h)) === null)

  // ==================================================================== C. save, and the golden
  h.click(/** @type {HTMLElement} */ (machineAction(h, 'save')))
  await h.waitFor(() => !h.q('machine-form'), { timeout: 10000 })
  await h.idle()
  const saved = file([record(WANTED)])
  h.check('Save writes machines.json with the whole channel block, as it was entered', sameJson(await machinesFile(h), saved), { got: await machinesFile(h), want: saved })
  h.check('and the page lists the machine without a problem', machineRows(h).length === 1 && machineRows(h)[0].problems === 0, machineRows(h).map((r) => `${r.id}:${r.problems}`))

  // ==================================================================== D. a preset is applied on the button
  await clickMachineAction(h, 'add')
  setField(h, 'profile', /** @type {string} */ (ctx.profiles.get('fanuc-lathe')?.name))
  await h.frame()
  await clickMachineAction(h, 'next')
  setField(h, 'name', 'Preset test')
  const presetSelect = /** @type {HTMLSelectElement} */ (h.q('channels-preset'))
  const presetIds = [...presetSelect.options].map((o) => o.value).filter((v) => v !== '')
  h.check('the dialect offers presets, each marked as to be verified', presetIds.length >= 2 && [...presetSelect.options].filter((o) => o.value !== '').every((o) => /verify/i.test(o.textContent ?? '')), [...presetSelect.options].map((o) => o.textContent))
  h.select(presetSelect, presetIds[0])
  await h.idle()
  h.check('picking a preset in the list applies nothing: still no channels', !!h.q('channels-none') && h.qa('channel-row').length === 0 && !!h.q('channels-preset-note'), h.qa('channel-row').length)
  h.click(h.q('channels-preset-use'))
  await h.idle()
  const firstPreset = h.qa('channel-row').map((r) => r.dataset.channel)
  h.check('the button copies it (no block to replace: no question)', firstPreset.length >= 2 && !h.q('channels-preset-confirm') && !!h.q('channels-preset-applied'), firstPreset)
  const other = presetIds.find((id) => id !== presetIds[0]) ?? ''
  h.select(presetSelect, other)
  await h.idle()
  h.check('picking another preset while there are settings changes nothing', JSON.stringify(h.qa('channel-row').map((r) => r.dataset.channel)) === JSON.stringify(firstPreset) && !h.q('channels-preset-confirm'))
  h.click(h.q('channels-preset-use'))
  await h.idle()
  h.check('the button asks first, because there is something to replace, and still changes nothing', !!h.q('channels-preset-confirm') && JSON.stringify(h.qa('channel-row').map((r) => r.dataset.channel)) === JSON.stringify(firstPreset), h.q('channels-preset-confirm')?.textContent)
  h.click(h.q('channels-preset-replace'))
  await h.idle()
  h.check('and the second press replaces them', !h.q('channels-preset-confirm') && !!h.q('channels-preset-applied'), h.qa('channel-row').map((r) => r.dataset.channel))
  await closeCancel(h)
  h.check('Cancel wrote nothing: the file is as saved', sameJson(await machinesFile(h), saved))

  // ==================================================================== E. the broken block, by hand
  // A document with the machine, to see what the break changes.
  await closeSettings(h, page)
  const id = await open(h, `${dir}/c10-alternating.nc`)
  await pickMachine(h, 'Twin lathe')
  await waitForMachine(h, 'twin-lathe')
  const live = await waitChannel(h, (s) => s.present && s.layout === 'single-file')
  const tipBefore = machineTooltip(h)
  h.check('before the break the document is grouped by channel', live.layout === 'single-file' && mapRows(h).some((r) => r.kind === 'channel'), live)

  await ctx.commands.run('machines.openFile')
  await h.waitFor(() => !!ctx.docs.byPath(paths.machinesFile), { timeout: 15000 })
  const machinesDoc = ctx.docs.byPath(paths.machinesFile)
  if (!machinesDoc) throw new Error('machines.json did not open as a document')
  ctx.docs.activate(machinesDoc.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === machinesDoc.id, { timeout: 8000 })
  const onDisk = JSON.parse(await h.disk.read(paths.machinesFile))
  onDisk.machines[0].params.channels.syncMarks[0].match = { kind: 'regex', pattern: '(M9\\d\\d' }
  const handEdited = JSON.stringify(onDisk, null, 2) + '\n'
  ctx.editor.replaceAll(machinesDoc.id, handEdited)
  await h.waitFor(() => !!h.q('doc-tab', { docId: machinesDoc.id, dirty: '1' }), { timeout: 5000 })
  if ((await ctx.files.save(machinesDoc.id)) !== true) throw new Error('saving machines.json as a document failed')
  await h.idle()
  ctx.docs.activate(id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === id, { timeout: 8000 })
  const broken = await waitChannel(h, (s) => /broken/i.test(s.text))
  h.check('the hand-written file is on disk with the broken rule', JSON.parse(await h.disk.read(paths.machinesFile)).machines[0].params.channels.syncMarks[0].match.pattern === '(M9\\d\\d')
  h.check('the document\'s channel item says the channel rules are broken', broken.layout === '' && /broken/i.test(broken.text), broken)
  h.check('the map is the ordinary one again: no channel rows', !mapRows(h).some((r) => r.kind === 'channel' || r.kind === 'sync'), mapRows(h).map((r) => r.kind))
  h.check('the machine is still the document\'s machine, selectable as before', channelItem(h) !== null && ctx.machines.effective(id).machine.id === 'twin-lathe', ctx.machines.effective(id).machine.id)
  h.check('and the number reading is unchanged: every line of the machine\'s tooltip is the same', JSON.stringify(machineTooltip(h)) === JSON.stringify(tipBefore), { before: tipBefore, after: machineTooltip(h) })
  await pickMachine(h, 'None (dialect defaults)')
  await waitForMachine(h, '')
  await pickMachine(h, 'Twin lathe')
  await waitForMachine(h, 'twin-lathe')
  h.check('it can be picked again after the break', ctx.machines.effective(id).machine.id === 'twin-lathe')

  const page2 = await openMachinesPage(h)
  const row = machineRows(h).find((r) => r.id === 'twin-lathe')
  h.check('the Machines page reports it on the machine\'s row, with the path of the setting', (row?.problems ?? 0) >= 1 && /params\.channels\.syncMarks\[0\]/.test(row?.element.textContent ?? ''), { problems: row?.problems, text: row?.element.textContent?.slice(0, 300) })
  await clickMachineAction(h, 'edit', 'twin-lathe')
  h.check('Edit opens it with the problem listed and the rest of the machine as it was', !!h.q('channels-problems') && saveDisabled(h), h.q('channels-problems')?.textContent)
  await closeCancel(h)

  // The next write from the page leaves the hand-written block exactly as it is, byte for byte.
  await clickMachineAction(h, 'default', 'twin-lathe')
  await h.waitFor(() => machineRows(h).find((r) => r.id === 'twin-lathe')?.isDefault === true, { timeout: 8000 })
  const afterSave = JSON.parse(await h.disk.read(paths.machinesFile))
  h.check('the next save from the page keeps the broken block as written', JSON.stringify(afterSave.machines[0].params.channels) === JSON.stringify(sortedOnDisk(onDisk.machines[0].params.channels)), { got: afterSave.machines[0].params.channels })
  await ctx.machines.add({ name: 'Another', profile: 'fanuc-lathe', notes: '', params: /** @type {any} */ (structuredClone(LATHE_REST)) })
  await h.idle()
  const afterSecond = JSON.parse(await h.disk.read(paths.machinesFile))
  h.check('and the one after that: the record of the broken machine is byte-stable', JSON.stringify(afterSecond.machines[0]) === JSON.stringify(afterSave.machines[0]), { first: afterSave.machines[0], second: afterSecond.machines[0] })
  h.check('the machine is listed once and still has its problem', machineRows(h).filter((r) => r.id === 'twin-lathe').length === 1 && (machineRows(h).find((r) => r.id === 'twin-lathe')?.problems ?? 0) >= 1)
  await closeSettings(h, page2)
})

/** The Cancel of the machine form (not the dialog's). @param {Harness} h */
async function closeCancel(h) {
  await clickMachineAction(h, 'cancel')
  await h.waitFor(() => !h.q('machine-form'), { timeout: 8000 })
  await h.idle()
}

/**
 * The key order Rust writes: every object key sorted.
 * @param {any} value
 * @returns {any}
 */
function sortedOnDisk(value) {
  if (Array.isArray(value)) return value.map(sortedOnDisk)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortedOnDisk(value[k])]))
}
