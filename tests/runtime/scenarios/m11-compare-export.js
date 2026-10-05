// X5, export (plan §6 M11 H11 `m11-compare-export`, §2.2 X5, WP11.3): "Export Differences" puts a
// unified diff into a new tab. In review mode it is the diff of the normalized sides and equals the
// golden `tests/fixtures/compare/x5-repost/expected.diff` byte for byte; in raw mode it is the diff
// of the texts as they are, and is checked for being a well-formed unified diff of exactly those
// texts (headers, hunk counts, every `-` line from the original, every `+` line from the
// modified side, every context line from both). The comparison ends, the new tab is the active
// one, the sources are untouched, and with no difference nothing opens.

import { scenario } from '../lib/index.js'
import { closeCompare, context, docIds, guard, message, monacoRegistry, openCompare, openPath, ready, setMode, view } from './m11-common.js'

/**
 * Whether `diff` is a unified diff turning `a` into `b`, hunk by hunk. Answers the problems.
 * @param {string} diff
 * @param {string[]} a original lines
 * @param {string[]} b modified lines
 * @param {{ from: string, to: string }} names
 */
function unifiedProblems(diff, a, b, names) {
  /** @type {string[]} */
  const problems = []
  const rows = diff.split('\n')
  if (rows[0] !== `--- ${names.from}`) problems.push(`first line is ${JSON.stringify(rows[0])}`)
  if (rows[1] !== `+++ ${names.to}`) problems.push(`second line is ${JSON.stringify(rows[1])}`)
  let i = 2
  let hunks = 0
  let ai = 1
  let bi = 1
  while (i < rows.length) {
    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rows[i])
    if (!head) {
      if (rows[i] === '' && i === rows.length - 1) break
      problems.push(`line ${i + 1} is not a hunk header: ${JSON.stringify(rows[i])}`)
      break
    }
    hunks += 1
    const aStart = Number(head[1])
    const aCount = head[2] === undefined ? 1 : Number(head[2])
    const bStart = Number(head[3])
    const bCount = head[4] === undefined ? 1 : Number(head[4])
    ai = aCount === 0 ? aStart + 1 : aStart
    bi = bCount === 0 ? bStart + 1 : bStart
    let seenA = 0
    let seenB = 0
    i += 1
    while (i < rows.length && !rows[i].startsWith('@@') && !(rows[i] === '' && i === rows.length - 1)) {
      const mark = rows[i][0]
      const body = rows[i].slice(1)
      if (mark === '-') {
        if (a[ai - 1] !== body) problems.push(`'-' line ${ai} of the original is ${JSON.stringify(a[ai - 1])}, the diff says ${JSON.stringify(body)}`)
        ai += 1
        seenA += 1
      } else if (mark === '+') {
        if (b[bi - 1] !== body) problems.push(`'+' line ${bi} of the modified is ${JSON.stringify(b[bi - 1])}, the diff says ${JSON.stringify(body)}`)
        bi += 1
        seenB += 1
      } else if (mark === ' ') {
        if (a[ai - 1] !== body || b[bi - 1] !== body) problems.push(`context line ${ai}/${bi} differs: ${JSON.stringify(body)}`)
        ai += 1
        bi += 1
        seenA += 1
        seenB += 1
      } else {
        problems.push(`unknown row ${JSON.stringify(rows[i])}`)
      }
      i += 1
    }
    if (seenA !== aCount || seenB !== bCount) problems.push(`hunk ${hunks} says -${aCount} +${bCount} and holds -${seenA} +${seenB}`)
  }
  if (hunks === 0) problems.push('no hunk at all')
  return problems
}

scenario('m11-compare-export', { timeout: 240 }, async (h) => {
  const ctx = context(h)
  const compare = /** @type {any} */ (ctx.compare)
  await ready(h)
  const reg = monacoRegistry(h)
  const dir = await h.fixture('compare/x5-repost')
  const orig = await openPath(h, `${dir}/original.nc`)
  const post = await openPath(h, `${dir}/reposted.nc`)
  ctx.docs.activate(post.id)
  await h.waitFor(() => h.q('editor-host')?.dataset.docId === post.id, { timeout: 5000 })
  const origText = ctx.editor.getText(orig.id)
  const postText = ctx.editor.getText(post.id)
  const golden = await h.disk.read(`${dir}/expected.diff`)
  const source = { kind: 'document', docId: orig.id }
  /** The id of the one new tab an export opened, once it is the active document. */
  const exported = async (/** @type {() => void | Promise<void>} */ trigger) => {
    const before = docIds(h)
    await trigger()
    await h.waitFor(() => docIds(h).length === before.length + 1 && !view(h), { timeout: 10000 })
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === ctx.docs.getActiveId(), { timeout: 5000 })
    await h.idle()
    return docIds(h).find((id) => !before.includes(id)) ?? ''
  }
  let rawDiff = ''

  await guard(h, 'A. raw export', async () => {
    await openCompare(h, reg, post.id, /** @type {any} */ (source))
    h.check('the export button says raw', h.q('compare-export')?.dataset.normalized === 'false', h.q('compare-export')?.dataset.normalized)
    const id = await exported(() => h.click(h.q('compare-export')))
    rawDiff = ctx.editor.getText(id)
    h.check('one new tab opened and it is the active document', !!id && ctx.docs.getActiveId() === id && !ctx.docs.get(id)?.path, { id, active: ctx.docs.getActiveId() })
    h.check('the comparison ended and the editor is back, showing the new tab', !view(h) && h.q('editor-host')?.dataset.docId === id)
    const problems = unifiedProblems(rawDiff, origText.split('\n'), postText.split('\n'), { from: 'original.nc', to: 'reposted.nc' })
    h.check('it is a unified diff of the raw texts: headers from the tab names, hunks that count, every line from its side', problems.length === 0, problems.slice(0, 5))
    h.check('and it is the whole raw difference: it has a hunk for the block numbers, the reformatted numbers and both real changes', /^-N70 X130\. F600\.$/m.test(rawDiff) && /^\+X130\.000 F650\.0$/m.test(rawDiff) && /^-N140 G81 G98 X20\. Y20\. Z-15\.25 R2\. F120\.$/m.test(rawDiff) && /^\+G81 G98 X20\.000 Y20\.000 Z-15\.000 R2\.000 F120\.0$/m.test(rawDiff), rawDiff.slice(0, 400))
    h.check('both source documents are untouched', ctx.editor.getText(orig.id) === origText && ctx.editor.getText(post.id) === postText && !ctx.docs.get(orig.id)?.dirty && !ctx.docs.get(post.id)?.dirty)
  })

  await guard(h, 'B. review export is the golden diff (X5)', async () => {
    ctx.docs.activate(post.id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === post.id, { timeout: 5000 })
    await openCompare(h, reg, post.id, /** @type {any} */ (source))
    await setMode(h, 'review')
    h.check('the export button says normalized in review mode', h.q('compare-export')?.dataset.normalized === 'true', h.q('compare-export')?.dataset.normalized)
    const id = await exported(() => h.click(h.q('compare-export')))
    const text = ctx.editor.getText(id)
    h.check('the new tab holds exactly tests/fixtures/compare/x5-repost/expected.diff', text === golden, { got: text.slice(0, 300), want: golden.slice(0, 300) })
    h.check('and the comparison ended, the sources untouched', !view(h) && ctx.editor.getText(orig.id) === origText && ctx.editor.getText(post.id) === postText)
  })

  await guard(h, 'C. the command, with and without its argument', async () => {
    ctx.docs.activate(post.id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === post.id, { timeout: 5000 })
    await openCompare(h, reg, post.id, /** @type {any} */ (source))
    h.check('the comparison opens in review mode, where it was left', view(h)?.dataset.mode === 'review')
    const id = await exported(() => void ctx.commands.run('compare.exportDiff', { normalized: false }))
    h.check('compare.exportDiff { normalized: false } in review mode gives the raw diff again', ctx.editor.getText(id) === rawDiff, ctx.editor.getText(id).slice(0, 200))
    ctx.docs.activate(post.id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === post.id, { timeout: 5000 })
    await openCompare(h, reg, post.id, /** @type {any} */ (source))
    const id2 = await exported(() => void ctx.commands.run('compare.exportDiff'))
    h.check('with no argument it follows the mode: review, the golden', ctx.editor.getText(id2) === golden)
  })

  await guard(h, 'D. no difference: nothing opens', async () => {
    ctx.docs.activate(orig.id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === orig.id, { timeout: 5000 })
    await openCompare(h, reg, orig.id, { kind: 'saved' })
    const tabs = docIds(h).length
    const answer = await compare.exportDiff({ normalized: false })
    await h.idle()
    h.check('a document against its own saved version exports nothing: no new tab, the comparison stays open, the status says so without an error', answer === null && docIds(h).length === tabs && !!view(h) && h.q('status-message')?.dataset.error !== '1' && /no differences/i.test(message(h)), { answer, tabs: docIds(h).length, status: message(h) })
    const answer2 = await compare.exportDiff({ normalized: true })
    h.check('the same in review mode', answer2 === null && docIds(h).length === tabs && !!view(h), { answer2 })
    await closeCompare(h)
  })

  await guard(h, 'E. a saved version with an edit', async () => {
    ctx.docs.activate(post.id)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === post.id, { timeout: 5000 })
    ctx.editor.reveal(post.id, 1, 1)
    ctx.editor.insertText('(EDIT)\n')
    await h.waitFor(() => !!h.q('doc-tab', { docId: post.id, dirty: '1' }), { timeout: 5000 })
    await openCompare(h, reg, post.id, { kind: 'saved' })
    await setMode(h, 'raw')
    const id = await exported(() => h.click(h.q('compare-export')))
    const text = ctx.editor.getText(id)
    h.check('the diff against the saved version is the one inserted line', /^\+\(EDIT\)$/m.test(text) && (text.match(/^[-+][^-+]/gm) ?? []).length === 1, text.slice(0, 300))
    h.check('and names the saved side by the document’s own name', /^--- .*reposted\.nc/.test(text) && /^\+\+\+ reposted\.nc/m.test(text), text.split('\n').slice(0, 2))
  })
  await guard(h, 'F. CODE-5: the compared document keeps its place, the new tab starts at the top', async () => {
    const big = Array.from({ length: 1200 }, (_, i) => `G1 X${i}. Y${i}.`).join('\n') + '\n'
    const doc = ctx.files.newUntitled({ profileId: 'fanuc-gcode', text: big, activate: true })
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === doc, { timeout: 5000 })
    ctx.editor.reveal(doc, 500, 1)
    await h.idle()
    const topLine = () => /** @type {any} */ (ctx.editor.editorInstance())?.getVisibleRanges?.()?.[0]?.startLineNumber ?? 0
    h.check('the compared document is scrolled to about line 500', topLine() > 400 && topLine() < 520, topLine())
    await openCompare(h, reg, doc, /** @type {any} */ (source))
    await setMode(h, 'raw')
    const id = await exported(() => h.click(h.q('compare-export')))
    await h.sleep(600)
    const instance = /** @type {any} */ (ctx.editor.editorInstance())
    const firstVisible = () => instance?.getVisibleRanges?.()?.[0]?.startLineNumber ?? 0
    h.check('the new tab opens at line 1', ctx.docs.getActiveId() === id && firstVisible() <= 2, { active: ctx.docs.getActiveId(), top: firstVisible() })
    ctx.docs.activate(doc)
    await h.waitFor(() => h.q('editor-host')?.dataset.docId === doc, { timeout: 5000 })
    await h.sleep(600)
    const top = /** @type {any} */ (ctx.editor.editorInstance())?.getVisibleRanges?.()?.[0]?.startLineNumber ?? 0
    h.check('switching back shows the compared document still near line 500', top > 400 && top < 520, top)
  })
})
