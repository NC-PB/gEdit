// Helpers `m0-fix3` and `m1-encoding2` share. This file registers no scenario.
//
// A file that is more than 10 % NUL bytes between leader and trailer is data, not a program
// (AD-7). Since the owner's answers of 2026-10-08 it is no longer refused: it opens
// **read-only**, byte for byte, and the lock says why (reason `binary`). That lock cannot
// be lifted, no writer that bypasses the keyboard may change it, and Save As cannot write it
// over its own file. `checkBinaryOpensReadOnly` is that whole contract, from outside.

import { context } from './m3-common.js'

/** @typedef {import('../lib/api.js').Harness} Harness */

/**
 * Opens `path` through the real dialog and checks that it is open as read-only data.
 * Leaves the document open and active; the caller closes it (it is never modified).
 *
 * @param {Harness} h
 * @param {string} path a fresh copy of a NUL-heavy file
 * @param {string} name its file name, for the check names
 * @returns {Promise<{ id: string | undefined }>}
 */
export async function checkBinaryOpensReadOnly(h, path, name) {
  const ctx = context(h)
  const hexBefore = await h.disk.hex(path)
  const statBefore = await h.disk.stat(path)
  await h.dialogs.queue('open', path)
  await h.nativeKeys([{ key: 'o', mods: ['cmd'] }])
  const tab = await h.waitFor(() => h.q('doc-tab', { path, active: '1' }), { timeout: 10000 })
  const id = tab?.dataset.docId
  const lock = () => h.q('status-item', { item: 'readonly' })
  const doc = () => (id === undefined ? undefined : ctx.docs.get(id))

  h.check(
    `${name}: it opens, in a tab of its own and without an alert`,
    !!tab && (await h.alert.visible()) === null,
    { tabs: h.qa('doc-tab').length, alert: await h.alert.visible() },
  )
  h.check(`${name}: the document is read-only and the reason is "binary"`, doc()?.readOnly === true && doc()?.readOnlyReason === 'binary' && !doc()?.dirty, {
    readOnly: doc()?.readOnly,
    reason: doc()?.readOnlyReason,
  })
  h.check(`${name}: the tab and the status bar show the lock with that reason`, tab?.dataset.readonly === '1' && lock()?.dataset.reason === 'binary', {
    tab: tab?.dataset.readonly,
    reason: lock()?.dataset.reason,
  })
  const said = await h.waitFor(() => /NUL bytes: opened read-only/.test(h.q('status-message')?.textContent ?? ''), { timeout: 5000 })
  h.check(`${name}: the status says why it is read-only (NUL share, data rather than a program)`, !!said && /data rather than a program/.test(h.q('status-message')?.textContent ?? ''), h.q('status-message')?.textContent)
  h.check(`${name}: the lock's hover text explains it and says it cannot be unlocked`, /NUL bytes/.test(lock()?.getAttribute('title') ?? '') && /cannot be unlocked/.test(lock()?.getAttribute('title') ?? ''), lock()?.getAttribute('title'))

  // Typing: a real key press, because "the option is set" is not "the program cannot change".
  const text = h.app.text()
  h.focusEditor()
  await h.idle()
  await h.nativeType('G0X99')
  await h.idle()
  h.check(`${name}: typing is refused`, h.app.text() === text && !doc()?.dirty, h.app.text().slice(0, 30))

  // A transform: refused before it runs, with the binary wording.
  ctx.status.clear()
  await ctx.commands.run('nc.removeEmptyLines')
  await h.idle()
  const refusal = h.q('status-message')?.textContent ?? ''
  h.check(`${name}: a transform is refused, naming the NUL bytes`, h.app.text() === text && !doc()?.dirty && /did not run/.test(refusal) && /NUL bytes/.test(refusal), refusal)

  // Unlocking: the command answers, and nothing changes.
  ctx.status.clear()
  await ctx.commands.run('file.toggleReadOnly')
  await h.idle()
  h.check(`${name}: unlocking is refused, and it stays read-only`, doc()?.readOnly === true && doc()?.readOnlyReason === 'binary' && /stays read-only/.test(h.q('status-message')?.textContent ?? ''), h.q('status-message')?.textContent)
  h.click(lock())
  await h.idle()
  h.check(`${name}: clicking the lock in the status bar does not unlock it either`, doc()?.readOnly === true && ctx.editor.editorInstance()?.getRawOptions().readOnly === true)

  // Save As over the same path.
  const calls = h.dialogs.calls().length
  ctx.status.clear()
  await h.dialogs.queue('save', path)
  h.focusEditor()
  await h.nativeKeys([{ key: 's', mods: ['cmd', 'shift'] }])
  await h.waitFor(() => h.dialogs.calls().slice(calls).some((c) => c.kind === 'save' && c.doneAt), { timeout: 8000 })
  await h.waitFor(() => /read-only data/.test(h.q('status-message')?.textContent ?? ''), { timeout: 5000 })
  h.check(`${name}: Save As to the same path is refused, with the reason`, /Choose another file name/.test(h.q('status-message')?.textContent ?? '') && !!h.q('status-message', { error: '1' }), h.q('status-message')?.textContent)

  h.check(`${name}: the bytes on disk are unchanged`, (await h.disk.hex(path)) === hexBefore && (await h.disk.stat(path))?.mtimeMs === statBefore?.mtimeMs, {
    mtimeBefore: statBefore?.mtimeMs,
    mtimeAfter: (await h.disk.stat(path))?.mtimeMs,
  })
  return { id }
}
