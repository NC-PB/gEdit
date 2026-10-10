// B1 A1 "Files and documents" in the real window.
//
//   b1-files-spellings   One file under two spellings is one tab. A symbolic link in the run folder and a
//                        `folder/../` spelling both lead to a file that is open: Open brings the first tab to the
//                        front ("<name> is already open") instead of adding a second one; Save As of an untitled tab
//                        onto the other spelling is refused with the "another tab already holds" box and writes
//                        nothing; a file rewritten with the same size and the same time is still noticed at Save.
//   b1-session-1/-2      A restored session shows the tab that was in front first and fills in the rest: with six
//                        files and the fourth in front, the fourth is the first document the restart opens, the tab
//                        order afterwards is the stored order, and the fourth is still in front.
//
// The pair works like `m7-session-1/2`: -1 writes the HOME and ends with a real quit, -2 reads it.

import { scenario } from '../lib/index.js'
import { quitCleanly, requireFirstRun, otherRun, activeDoc, configPaths } from './m7-common.js'
import { openPath } from './m3-common.js'
import { context, message, messageTail, newDoc, osOp, ready, symlink, tabPaths } from './b1-common.js'

const PROGRAM = ['%', 'O1001 (SPELLINGS)', 'N10 G21 G17 G40', 'N20 G0 X0 Y0', 'N30 M30', '%', ''].join('\n')

scenario('b1-files-spellings', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const dir = `${h.cfg.run}/spell`
  const real = `${dir}/real/prog.nc`
  const link = `${dir}/link.nc`
  const dotted = `${dir}/side/../real/prog.nc`
  await osOp(h, 'mkdir', `${dir}/real`)
  await osOp(h, 'mkdir', `${dir}/side`)
  await h.disk.write(real, PROGRAM)
  const made = await symlink(h, real, link)
  h.check('the run folder holds a real file and a symbolic link to it', made.isLink && made.link.endsWith('/spell/real/prog.nc'), made)

  // ------------------------------------------------------------ A. the link
  const first = await openPath(h, real)
  const other = await newDoc(h, 'G0 X1\n')
  h.check('a second program is in front, the file is open behind it', ctx.docs.getActiveId() === other && tabPaths(h).length === 1, { active: ctx.docs.getActiveId(), tabs: tabPaths(h) })
  const tail = messageTail(h, 'files.focused')
  await h.dialogs.queue('open', link)
  const viaLink = await ctx.files.open()
  await h.idle()
  h.check('opening the file through the link adds no tab: one file, one tab', tabPaths(h).length === 1 && ctx.docs.all().filter((d) => d.path !== null).length === 1, { tabs: tabPaths(h) })
  h.check('and the tab that holds the file is brought to the front', ctx.docs.getActiveId() === first.id && h.q('editor-host')?.dataset.docId === first.id && viaLink.every((id) => id === first.id), { active: ctx.docs.getActiveId(), answered: viaLink })
  h.check('the status line says it is already open', message(h).endsWith(tail), message(h))

  // ------------------------------------------------------------ B. a ".." spelling
  ctx.docs.activate(other)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === other, { timeout: 8000 })
  await h.dialogs.queue('open', dotted)
  await ctx.files.open()
  await h.idle()
  h.check('a spelling with ".." in it is the same tab too', tabPaths(h).length === 1 && ctx.docs.getActiveId() === first.id, { tabs: tabPaths(h), active: ctx.docs.getActiveId() })

  // ------------------------------------------------------------ C. Save As onto the other spelling
  ctx.docs.activate(other)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === other, { timeout: 8000 })
  const before = await h.disk.hex(real)
  h.allowErrors(/Another tab already holds/)
  await h.dialogs.queue('save', link)
  const saving = ctx.files.saveAs(other)
  const box = await h.alert.wait({ timeout: 15000 })
  h.check('Save As onto the other spelling of an open file is refused with the "another tab holds it" box', !!box && /another tab already holds/i.test(box.texts.join(' ')), box)
  await h.alert.click('OK|Ok')
  const saved = await saving
  await h.idle()
  h.check('nothing was written: the file is the bytes it was, and the untitled tab is still untitled', saved === false && (await h.disk.hex(real)) === before && ctx.docs.get(other)?.path === null, { saved, path: ctx.docs.get(other)?.path })

  // ------------------------------------------------------------ D. the same size, the same time
  // The file is rewritten with different bytes of the same length and its old modification time is put back, so
  // size and time cannot tell: Save must still ask, because it compares the content too (FAT32/exFAT drives).
  ctx.docs.activate(first.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === first.id, { timeout: 8000 })
  const stamp = await h.disk.stat(real)
  const rewritten = PROGRAM.replace('N20 G0 X0 Y0', 'N20 G0 X9 Y9')
  await h.disk.write(real, rewritten)
  await h.disk.touch(real, (stamp?.mtimeMs ?? 0) / 1000)
  h.check('the rewrite has the same size and the same time', rewritten.length === PROGRAM.length && Math.abs(((await h.disk.stat(real))?.mtimeMs ?? 0) - (stamp?.mtimeMs ?? 1)) < 1000, { size: [rewritten.length, PROGRAM.length], mtime: [(await h.disk.stat(real))?.mtimeMs, stamp?.mtimeMs] })
  ctx.editor.replaceAll(first.id, PROGRAM.replace('N30 M30', 'N30 M00'))
  await h.waitFor(() => !!h.q('doc-tab', { docId: first.id, dirty: '1' }), { timeout: 8000 })
  const saveAttempt = ctx.files.save(first.id)
  const question = await h.alert.wait({ timeout: 15000 })
  h.check('Save asks "changed on disk" instead of writing over the other text', !!question && (question.texts.join(' ').includes(ctx.t('files.changedOnDiskTitle')) || (question.buttons ?? []).includes(ctx.t('files.overwriteButton'))), question)
  await h.alert.click('Cancel')
  await saveAttempt
  await h.idle()
  h.check('Cancel left the file as the other program wrote it', (await h.disk.read(real)) === rewritten, await h.disk.read(real))
})

// ---------------------------------------------------------------------------------------------- session order

const HOME_1 = '{run}/state-home'
const HOME_2 = '{run}/../b1-session-1/state-home'
const NAMES = ['p1.nc', 'p2.nc', 'p3.nc', 'p4.nc', 'p5.nc', 'p6.nc']
const FRONT = 3
const pathsIn = (/** @type {string} */ run) => NAMES.map((name) => `${run}/keep/${name}`)
const body = (/** @type {string} */ name) => `%\nO${name.replace(/\D/g, '')}000 (${name})\nG0 X0 Y0\nM30\n%\n`

scenario('b1-session-1', { timeout: 240, vars: { HOME: HOME_1 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  const paths = configPaths(ctx)
  const files = pathsIn(h.cfg.run)
  for (const [at, path] of files.entries()) await h.disk.write(path, body(NAMES[at]))
  await h.dialogs.queue('open', files)
  await ctx.files.open()
  await h.waitFor(() => files.every((path) => !!ctx.docs.byPath(path)), { timeout: 20000 })
  h.check('the six programs are open in the order they were picked', JSON.stringify(tabPaths(h)) === JSON.stringify(files), tabPaths(h))
  ctx.docs.activate(/** @type {any} */ (ctx.docs.byPath(files[FRONT])).id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === ctx.docs.byPath(files[FRONT])?.id, { timeout: 10000 })
  await ctx.uiState.flush()
  const session = await h.waitFor(
    async () => {
      const stored = JSON.parse(await h.disk.read(paths.stateFile)).session
      return stored?.paths?.length === 6 && stored.active === FRONT ? stored : null
    },
    { timeout: 15000 },
  )
  h.check('the session is stored with the fourth file in front', JSON.stringify(session?.paths) === JSON.stringify(files) && session?.active === FRONT, session)
  await quitCleanly(h)
})

scenario('b1-session-2', { timeout: 240, vars: { HOME: HOME_2 } }, async (h) => {
  const ctx = context(h)
  await ready(h)
  await requireFirstRun(h, 'b1-session-1')
  const files = pathsIn(otherRun(h.cfg.run, 'b1-session-1'))
  // The front tab is opened first and alone; the others are opened behind it. Watch the order the documents are made in.
  await h.waitFor(() => files.every((path) => !!ctx.docs.byPath(path)), { timeout: 30000 })
  await h.idle()
  const made = files.map((path) => ({ path, id: ctx.docs.byPath(path)?.id ?? '' }))
  const serial = (/** @type {string} */ id) => Number(id.replace(/\D/g, ''))
  const firstMade = [...made].sort((a, b) => serial(a.id) - serial(b.id))[0]
  h.check('all six are back', made.every((m) => m.id !== ''), made)
  h.check('the tab that was in front was the first document the restart opened', firstMade.path === files[FRONT], made.map((m) => `${m.path.split('/').pop()}:${m.id}`))
  h.check('the tabs are in the order they were stored in, although the fourth was opened first', JSON.stringify(tabPaths(h)) === JSON.stringify(files), tabPaths(h))
  h.check('and the fourth is the one in front', activeDoc(ctx)?.path === files[FRONT] && h.q('editor-host')?.dataset.docId === made[FRONT].id, { active: activeDoc(ctx)?.path })
  h.check('nothing came back unsaved', made.every((m) => ctx.docs.get(m.id)?.dirty === false), made.map((m) => ctx.docs.get(m.id)?.dirty))
})
