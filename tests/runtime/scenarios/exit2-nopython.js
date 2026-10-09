// Phase 2 exit criteria without Python (plan §2.2, "m13-exit-criteria-nopython"): the same programs and
// goldens with `GEDIT_PYTHON=/nonexistent`. What is TypeScript works as with Python: detection, tokens,
// F7 and the program map, renumber with its rewrite, compare, search, block skip, the machine choice and
// the whole of X12 except the tool list's Channel column. Every script command (scale feed and speed,
// the tool list, the checks, the extents, address arithmetic) shows the Phase 1 "Python not found"
// message and leaves the document alone, so a document only a script would have changed is saved
// byte for byte as its input (D3: an unedited document is never rewritten) and equals the golden of
// `expected-nopython/`.
//
// The criteria run in one app, in the order that keeps them apart: search first (its scope is every
// open document), then compare, X1, X2, X8 and X12 last.

import { scenario } from '../lib/index.js'
import { REPO_FILE } from './m3-common.js'
import { NO_PYTHON, context, pythonStatus } from './exit2-common.js'
import { runX1 } from './exit2-x1.js'
import { runX2 } from './exit2-x2.js'
import { runX5 } from './exit2-x5.js'
import { runX6 } from './exit2-x6.js'
import { runX8 } from './exit2-x8.js'
import { runX12 } from './exit2-x12.js'

scenario('exit2-nopython', { timeout: 900, files: REPO_FILE, python: NO_PYTHON }, async (h) => {
  const ctx = context(h)
  const status = await pythonStatus(h)
  h.check('the app found no interpreter: GEDIT_PYTHON points at nothing', status === null || status.ok === false, status)
  h.check('the script commands are still offered, and say why they cannot run when asked', ctx.commands.has('script.runPicker'))
  await runX6(h)
  await runX5(h)
  await runX1(h, { noPython: true })
  await runX2(h, { noPython: true })
  await runX8(h, { noPython: true })
  await runX12(h, { noPython: true })
})
