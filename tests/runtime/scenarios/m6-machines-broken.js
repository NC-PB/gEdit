// A `machines.json` that cannot be read (plan §5 M6 H6 `m6-machines-manage`, last clause;
// AD-31 "Storage", WP6.8 and WP6.10): one notice, no machine configurations in use, every
// write action on the page disabled, and a way out that keeps the broken file.
//
// **The rule this run exists for: a hand edit is never overwritten behind the user's
// back.** A machine says how every number in every program of that machine is read, so the
// one thing gEdit must not do with a file it did not understand is write a "repaired"
// version over it. The page therefore blocks every write — add, edit, duplicate, remove,
// default — and offers only the two things that cannot lose anything: open the file, or
// move it aside and start again. "Replace with an empty file" leaves `machines.json.bak`.
//
// The file is written into the run's HOME by the `files` option, before the app starts:
// that is the case AD-31 promises to survive, and it cannot be produced from inside the
// running app.

import { scenario } from '../lib/index.js'
import { configPaths } from './m2-common.js'
import {
  clickMachineAction,
  closeSettings,
  context,
  machineAction,
  machineRows,
  machinesFile,
  machineText,
  openFixture,
  openMachinesPage,
  ready,
  sameJson,
} from './m6-common.js'

const CONFIG = 'home/Library/Application Support/com.pburg.gedit'
/** Broken the way a hand edit breaks a file: a trailing comma and a missing brace. */
const BROKEN = '{\n  "$version": 1,\n  "machines": [\n    { "id": "lathe", "name": "Lathe",\n  ],\n'

/** Every write action of the page, by its `data-action`. */
const WRITES = ['add', 'edit', 'duplicate', 'default', 'remove']

scenario('m6-machines-broken', { timeout: 300, files: { [`${CONFIG}/machines.json`]: BROKEN } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)

  // ------------------------------------------------------------ the app still starts
  h.check('an unreadable machines.json does not stop the app', h.q('app-shell')?.dataset.ready === '1')
  h.check('the broken file is still exactly as it was written, and there is no .bak yet', (await h.disk.read(paths.machinesFile)) === BROKEN && (await h.disk.stat(`${paths.machinesFile}.bak`)) === null, {
    bak: await h.disk.stat(`${paths.machinesFile}.bak`),
  })

  // A lathe document is read with the dialect defaults and says so, rather than being
  // refused or being read with half a machine.
  const lathe = await openFixture(h, 'nc/fanuc-lathe/l01-turning-a.nc')
  h.check('a turning program still opens, with no machine and marked assumed', ctx.docs.get(lathe.id)?.profileId === 'fanuc-lathe' && machineText(h) === 'Machine: none (assumed)', {
    profile: ctx.docs.get(lathe.id)?.profileId,
    item: machineText(h),
  })

  // ------------------------------------------------------------ the page says why
  const page = await openMachinesPage(h)
  const notices = h.qa('machines-notice').map((e) => e.textContent?.trim() ?? '')
  h.check('the page carries the notice, and says it once', notices.length >= 1 && notices.some((text) => /cannot be used as it is/.test(text)), notices)
  h.check('no machine is listed: a file that was not understood contributes nothing', machineRows(h).length === 0, machineRows(h).map((r) => r.id))

  const offered = h.qa('machine-action').map((e) => `${e.dataset.action}:${e.dataset.disabled}`)
  h.check('exactly Add (disabled), Open machines file and Replace with an empty file are offered', JSON.stringify(offered) === JSON.stringify(['add:1', 'open-file:0', 'replace-file:0']), offered)
  h.check(
    'every action that would write is unavailable',
    WRITES.every((action) => {
      const button = machineAction(h, action)
      return button === undefined || /** @type {HTMLButtonElement} */ (button).disabled === true
    }),
    WRITES.map((action) => `${action}:${/** @type {HTMLButtonElement | undefined} */ (machineAction(h, action))?.disabled}`),
  )

  // ------------------------------------------------------------ opening it changes nothing
  await clickMachineAction(h, 'open-file')
  await h.waitFor(() => !!ctx.docs.byPath(paths.machinesFile), { timeout: 15000 })
  const openedDoc = ctx.docs.byPath(paths.machinesFile)
  if (openedDoc === undefined) throw new Error('“Open machines file” left no document open for the broken machines.json')
  const openedId = openedDoc.id
  h.check('the broken file can still be opened and fixed by hand', ctx.editor.getText(openedId) === BROKEN, JSON.stringify(ctx.editor.getText(openedId)))
  h.check('and opening it wrote nothing', (await h.disk.read(paths.machinesFile)) === BROKEN)

  // ------------------------------------------------------------ Replace with an empty file
  await clickMachineAction(h, 'replace-file')
  const asked = await h.alert.wait({ timeout: 8000 })
  h.check('replacing asks first, and says where the old file goes', !!asked && (asked?.texts ?? []).join(' ').includes('machines.json.bak'), asked)
  await h.alert.click('Cancel')
  await h.idle()
  h.check('Cancel leaves the broken file alone', (await h.disk.read(paths.machinesFile)) === BROKEN && (await h.disk.stat(`${paths.machinesFile}.bak`)) === null)

  await clickMachineAction(h, 'replace-file')
  await h.alert.wait({ timeout: 8000 })
  await h.alert.click('Replace with an empty file')
  await h.waitFor(async () => (await h.disk.stat(`${paths.machinesFile}.bak`)) !== null, { timeout: 10000 })
  h.check('the unusable file is kept as machines.json.bak, byte for byte', (await h.disk.read(`${paths.machinesFile}.bak`)) === BROKEN, JSON.stringify(await h.disk.read(`${paths.machinesFile}.bak`)))
  const empty = { $version: 1, machines: [], defaults: {} }
  h.check('and an empty, usable file takes its place', sameJson(await machinesFile(h), empty), { got: await machinesFile(h), want: empty })

  // ------------------------------------------------------------ the page is usable again
  await h.waitFor(() => h.qa('machines-notice').length === 0, { timeout: 8000 })
  h.check('the notice is gone', h.qa('machines-notice').length === 0)
  h.check('and Add is offered for real now', /** @type {HTMLButtonElement | undefined} */ (machineAction(h, 'add'))?.disabled === false && !machineAction(h, 'replace-file'), h.qa('machine-action').map((e) => `${e.dataset.action}:${e.dataset.disabled}`))
  await closeSettings(h, page)

  // The document that was open on the broken file is now behind the times; the app says so
  // through the external-change machinery, not through the machines page, and nothing here
  // touches it. What matters is that the turning document is unchanged.
  h.check('the turning document was never touched by any of this', ctx.editor.getText(lathe.id).startsWith('(WRITTEN FOR GEDIT') && !ctx.docs.get(lathe.id)?.dirty, {
    dirty: ctx.docs.get(lathe.id)?.dirty,
  })
})
