# gEdit: implementation plan for Phase 3

Scope: the roadmap's Phase 3, **"Understand and write"** (`docs/planning/roadmap.md`): a user puts the cursor in any block and sees what each word means and what is in force there, changes a value from there, reads a cycle's parameters and the modal context in the hover, sees at a glance how each line moves, and writes new code from parameterized templates instead of the old code blocks. Phase 3 is finished when the exit criteria in §2.2 pass.

Status: **plan of record from 2026-10-09** (the Phase 3 prelude for P3a). It takes over the Phase 3 designs that the Phase 2 plan kept for it (`phase-2-implementation.md` §6, "Designed in Phase 2, moved to Phase 3": P3.1–P3.6, the prelude, the documentation and harness paragraph and the gates), designs the rows that had none (motion-mode line colouring, now **P3.7**; cycle forms and formula parameters, **P3.8**, and the template manager with "create from selection", **P3.9**, designed by the P3b prelude), and splits the work into two milestones:

| Milestone | What it delivers | Status |
|---|---|---|
| **P3a "Understand a block"** | the TypeScript modal interpreter, its index and a per-document service (P3.1); reading one word on the document's machine, the inspector's rows and editing a value (P3.2a); the inspector panel (P3.2b); hover with cycle parameters and modal context (P3.3); motion colours (P3.7) | implemented 2026-10-09 (branch `p3a/int`), reviewed and fixed; landing on `main` next |
| **P3b "Write with templates"** | the template engine (P3.4), templates in the Insert tab and in completion in place of the blocks (P3.5), template content for every built-in database (P3.6), cycle forms and formula parameters (P3.8), the template manager and "create from selection" (P3.9) | designs moved here; its prelude writes the contracts and designs P3.8 and P3.9 |

It **reuses the Phase 2 execution protocol** (`phase-2-implementation.md` §5, cited as **P2 §5**, which itself reuses P1 §4) and the **Phase 2 contracts** (P2 §7, as amended by P2 §7.16). Both stay binding unless §4 or §6 of this document changes them. Numbering continues Phase 2: architecture decisions **AD-33+**, exit criteria **X14+** (X7 and the templates half of X9 keep their Phase 2 numbers), contract deviations **#204+** in §7 (continuing P2 §7.16), work packages **P3.1–P3.9**. The contracts the Phase 2 plan already wrote for Phase 3 stay there and are cited: AD-19 (one modal interpreter, both languages), AD-27 (code inspector), AD-28 (templates replace the blocks), §7.3 (`ModalService`), §7.4 (the modal state, the TypeScript classes, the golden format, the defined cycle, rules 13–15), §7.8 (templates), §7.12 and §7.13 (test ids, command ids), §8.6 (template content).

Path shorthands as in P2: `SP` = a scratch directory outside the repo; `P2` = `docs/planning/phase-2-implementation.md`. All other paths are relative to the repository root (branch `p3/base` from `m13/int` @ `e85d4cb`). The repository is public: this plan names no local machine paths, and no real program, file name of a real program or content derived from one appears in it.

---

## 0. Where this plan comes from

- **The third revision of the roadmap** (P2 §0, 2026-09-30, D69) moved the inspector, hover with modal context, the TypeScript modal interpreter and the templates out of Phase 2: they help a user understand and write a program; they do not make CAM output safer. Their designs were kept in P2 §6 and are moved here (§5), unchanged where nothing argued against them.
- **The owner's decisions for this session (2026-10-09):** one release at the very end (no tags before it); `spike/harness-ci` may be force-pushed before every landing; `roadmap.md` is updated as milestones land; Phase 3 template content ships **marked "review pending"** and the owner reviews it later (§9).
- **Standing rules** (P2 §10, the memory notes): facts about controls come from the manuals, in our own words; the owner has no machines; real programs are reported only as counts; the commercial reference editor is never named; evidence lives in `docs/planning/` only (the evidence gate, `tests/unit/evidenceGate.test.ts`); users are NC programmers, so every user-facing text is plain.
- **What this prelude changed against the session plan:** the inspector work package is split in two, and the hover moves to Wave B (AD-36, §7 #206): reading one word on the machine is shared by the inspector, the hover and the edit, so it gets **one** owner in Wave A (P3.2a) and every consumer comes after it.

## 1. Verified facts this plan relies on (at `e85d4cb`)

- **F100.** The TypeScript modal state is typed and complete: `ModalState`, `ModalValue`, `WordSeen` in `src/lib/core/nc/types.ts` carry every key of P2 §7.4, including `definedCycle`, `modalCall` (P9), `frame` and `tcp` (P10). Nothing fills them in TypeScript; `core/nc/modal.ts` did not exist before this prelude.
- **F101.** The Python interpreter (`src-tauri/resources/scripts/_nc_modal.py`, 1,851 lines) is the oracle: 26 goldens under `tests/fixtures/modal/<profileId>/` (six profiles; 1,002 program lines in all) pass in `tests/python/test_modal.py`. Its `render(state)` writes a state in the goldens' notation; `diameter_reading(address)` is AD-19 rule 11.
- **F102.** Every golden's effective profile is generated once, in TypeScript, under `tests/fixtures/resolved/effective/**` (`index.json` maps `modal/<p>/<case>.json` to it); for every golden without a `machine` that entry equals the profile's `defaults.json`, which is what `test_modal.py` uses. Python never merges a machine into a profile.
- **F103.** Walking all 26 goldens in Python takes about 0.3 s (`tests/python/modal_dump.py`, this prelude).
- **F104.** The hover is pure in `core/codes/hoverText.ts` (`hoverAt`, `hoverText`, escaped markdown, `isTrusted: false`); `monaco/providers/hover.ts` reads the document's effective profile and database (`machines.effective(docId)`) and, since M12.5, the machine's wait codes. It knows no modal state.
- **F105.** `writeBack(value, original, cls, m, units, fmt, { refuseRounding })` and `resolveValue`, `readingsOf`, `numberClassOf` (`core/machines/numbers.ts`) already implement every number rule the inspector's edit needs (AD-31); `applyLines` (`monaco/applyLines.ts`, through `app/transforms.ts`) is the one-undo-step edit.
- **F106.** The outline service is started by its contribution (`contrib/programMap.ts` calls `outline.start()`), is fed by `editor.onDidChangeContent`, and rebuilds on `machines.revision`, `profiles.revision` and `channels.revision`: the pattern the modal service follows.
- **F107.** `CodeSets.motion` is `'rapid' | 'feed'` on every motion code of the six databases (Fanuc mill, lathe A and B, Okuma, Sinumerik: `G0`…; Klartext: `L`, `C`, `CR`, `CT`, `LP`, `CP`, `CTP`, `LN`, `APPR`/`DEP` forms, all non-modal). No database says which feed moves are arcs. Klartext writes a rapid as `FMAX` (`addresses.rapid`).
- **F108.** Monaco 0.55.1 binds no `Mod+Alt+A`: its `A` keys are `Shift+Alt+A` (block comment; `Ctrl+Shift+A` on Linux), `Mod+A` (select all) and, on macOS, `Ctrl+A` (line start). No shipped gEdit command uses it; `findConflicts` over every shipped shortcut plus the P3a pins is clean on both platforms (`tests/unit/commandPins.test.ts`).
- **F109.** Settings are one flat schema (`core/settings/schema.ts`); a new key with a default reaches every user without a migration (`SETTINGS_VERSION` stays 1).

## 2. Scope and exit criteria

### 2.1 Roadmap Phase 3 rows

| Roadmap Phase 3 item | Decision | Milestone, WP |
|---|---|---|
| Modal interpreter, TypeScript half, matching the Python one on the shared goldens | **In**: interpreter, index with snapshots, a per-document service; per-line parity with Python on every golden and every owner-public program | P3a, P3.1 |
| Code inspector panel, edit values | **In, lean** (AD-27): the current block, the modal state after it, edit one value; no template list inside it | P3a, P3.2a (rules), P3.2b (panel) |
| Hover with cycle parameters and modal context | **In** | P3a, P3.3 |
| Motion-mode line coloring from the modal interpreter | **In**: a mark beside each moving line (rapid, straight, arc, thread, cycle) from the modal index, with a setting (AD-34) | P3a, P3.7 |
| Parametric templates, placeholders, file-based templates: the engine | **In** (P2 §7.8) | P3b, P3.4 |
| Templates in completion and in the Insert tab, in place of the blocks JSON | **In**; the blocks are deleted | P3b, P3.5 |
| Template content for the built-in dialects | **In**, marked "review pending" (owner, 2026-10-09) | P3b, P3.6 |
| Cycle forms, formula parameters, template manager UI and create from selection | **In**, designed by the P3b prelude | P3b, P3.8, P3.9 |

### 2.2 Phase 3 exit criteria (testable)

Each criterion is proven by its milestone's tests and runtime scenarios on committed fixtures (synthetic, or the owner-public programs); the owner's local programs are checked by G11 on their machine only, as counts.

| # | Criterion | Proven by |
|---|---|---|
| X7 | **Inspector** (from P2 §2.2). At the golden lines of `nc/fanuc-lathe/l01-turning-a.nc`, the inspector's modal state (feed unit, speed unit, tool, active cycle, speed clamp, work offset, diameter mode, each with its source line; assumed values marked with where they come from: the machine, a detected variant or the profile default) equals `tests/fixtures/modal/fanuc-lathe/*`. Editing `F` in the inspector rewrites only that word, in the same number style, as one undo step. **And the inspector half of X11 (c):** under "Lathe IS-B" the row of `X50` says 0.05 mm and its source; under "Lathe calc" 50 mm; with **no machine** it lists every reading, the assumed default first, and refuses to edit `Z1000` with the reason "the reading depends on the machine; choose a machine", while `Z10.` is editable; a typed `0.0505` into a point-less IS-B word is refused, `0.051` becomes `X51`. | `inspect.test.ts`, `rewriteWord.test.ts`, `p3-inspector` |
| X9t | **Templates** (the templates half of P2 X9). The "Lathe tool start" template with the golden form values inserts the golden text with continuing block numbers, as one undo step, from the Insert tab and from completion; a system-B document gets the `fanuc-lathe-b` override (`G92 S`). | P3b: `p3-templates` |
| X14 | **Hover in context.** On `nc/fanuc-lathe/l01-turning-a.nc` and the other built-in profiles' fixtures: a cycle word shows a table of its parameters with the values of its block (a Klartext cycle definition over several lines included); an address word shows one context line (`X — target, diameter, absolute, work offset G54`; under `DIAMOF`, or `DIAM90` with `G91`, "radius"; `U — incremental X`; `F — feed per revolution (G99)`; under a pitch cycle `F — thread lead (G76)`; under constant surface speed `S — surface speed (G96), clamp 2500 rpm (line 11)`); **the hover half of X11 (c):** `X50` under IS-B "0.05 mm: no decimal point, increments of 0.001 mm (machine 'Lathe IS-B')", under calculator 50 mm, with no machine every reading ("50 mm as written (calculator, profile default), 0.05 mm (IS-B), 0.005 mm (IS-C); choose a machine"; on Okuma the same for a word **with** a point); a system-B document explains `G94` as a feed mode and a system-A one as a facing pass. While the modal index has not reached the line, the hover says what it said in Phase 2 and nothing stale. Text is escaped, untrusted markdown. | `hoverText.test.ts`, `p3-hover` |
| X15 | **Parity.** The TypeScript interpreter passes every golden of `tests/fixtures/modal/**` unchanged, and gives the **same state as Python after every line** of every golden's program (`tests/unit/modalParity.test.ts`) and of every owner-public program (`tests/fixtures/nc/owner-public/**`, detected profile, no machine), in CI; on the owner's machine G11 reports the same parity over the local programs, each with the machine its manifest names, as counts. | `modalParity.test.ts`, G11 |
| X16 | **Motion colours.** On the motion goldens `tests/fixtures/motion/<profileId>/*.json` (mill, lathe A and B, Klartext, Okuma, Sinumerik and Sinumerik milling) every line's kind equals the golden (`rapid`, `linear`, `arc`, `thread`, `cycle`, or none: a comment, `M8`, `T0101`, a `G0` alone, a block whose motion mode is unknown or only assumed). In the app the visible lines carry `gedit-motion-<kind>` on the line-decorations margin; switching **Motion Colors** off removes every mark and on brings them back; a dialect or machine switch recolours from the new state. | `motion.test.ts`, `p3-colors` |
| X17 | **No regression, within the budgets.** Every Phase 1 and Phase 2 scenario passes (cumulative `m0`–`m13`, `rp`), changed only for the listed intentional changes; CI green on the three platforms. G7 at 300k lines: the modal index steps 300k lines < 1.5 s in node (assertion < 4 s); `stateAfter` within 1,000 lines of a snapshot ≤ 15 ms; the inspector updates ≤ 30 ms per cursor move with the panel open while typing; hover at line 300k ≤ 50 ms; a motion-colour update ≤ 4 ms once the states are known, never more than 1,000 marks; the Phase 1 typing budget holds with the inspector open and the colours on; a machine switch rebuilds the index in idle chunks of ≤ 16 ms. The replay budgets are counted in lines and hold for lines up to about 300 characters; replay and build time grow linearly with the line width beyond that (1,000-character lines: about 33 ms for 999 lines past a snapshot), a known limit recorded by the P3a code review and deferred. | unit budgets, `p3-perf`, CI |
| X18 | **Cycle forms and the template manager** (P3b): made testable by the P3b prelude when it designs P3.8 and P3.9. | P3b |

**Phase 3 is done when** X7, X9t and X14–X18 pass; the cumulative runtime suite (`m0`–`m13`, `rp`, `p3a`, `p3b`) passes on the GitHub macOS runner; the G10 sign-off exists for the hover texts, the `sets.path` flags and the template content (the content still marked "review pending" until the owner's review, §9); and the owner has read a few blocks of a real program in the inspector (§10).

## 3. Architecture decisions

AD-19, AD-27 and AD-28 of P2 §3 stay binding as written; the decisions below add to them.

**AD-33: One modal index per document, built in idle time, never waited for.**
- `app/modalService.ts` keeps one `ModalIndex` per open document, built with the document's **effective** compiled profile and database (`machines.effective(docId)`, AD-31). An edit calls `applyChange` at once, which only drops the snapshots at and after the first changed line; `buildSome(16)` runs from `requestIdleCallback` (a `setTimeout` where there is none), the active document first. A change of the effective key (profile, database, a variant, a machine parameter: `machines.revision`, `profiles.revision`, a dialect switch) rebuilds the index from scratch; a closed document drops it.
- **Readers never block.** `stateAfter(id, line)` replays at most 999 lines from the nearest snapshot at or before `line`, and answers `null` when no snapshot within that distance exists yet; `changed` bumps after every edit, chunk and rebuild, and a reader asks again then. A reader shows nothing modal rather than something stale.
- No worker (P1 AD-12): the interpreter is a per-line loop over tokens the tokenizer already makes; a worker would copy the document and the compiled profile for a gain the idle chunks already give.
- Why not compute on demand from line 1: hover at line 300k would replay 300k lines (≈ 1.5 s). Why not keep a state per line: 300k frozen states is hundreds of megabytes.

**AD-34: Motion colours are line decorations, not semantic tokens.**
- A mark beside each line that moves, in the line-decorations margin between the line numbers and the text (`linesDecorationsClassName`), coloured by the kind of move: `rapid`, `linear`, `arc`, `thread`, `cycle` (§6.6 rules). The words keep their role colours.
- **Not semantic tokens:** they colour the text of tokens and would override the role colours of every word on the line (feed, axis, code), which is the information a programmer reads first; Monaco also asks a semantic-token provider for whole documents or ranges on every edit, while a decoration set for the visible range is replaced in one call. **Not a whole-line background:** it competes with the selection, the find matches, the current-line highlight and the compare colours, and it would need a second palette per theme for contrast with the text.
- **Only the visible lines** (plus `marginLines` above and below) carry marks, recomputed on scroll, on `modal.changed` and on a setting change, throttled to one update per animation frame, from one `modal.statesAfter` call. At most `maxMarks` exist at once. A line whose state is not known yet carries no mark.
- **Colours are theme roles of their own** (`MOTION_COLORS`, one set per theme, each ≥ 3:1 against the editor background, the contrast WCAG asks of a mark that is no text), applied as CSS custom properties `--gedit-motion-<kind>` when the theme changes; a profile's `colors` may override them later (per-profile colours are Phase 4).
- **Arcs come from the data**, not from a code list: `CodeSets.path: 'arc'` (new, §6.6) on the arc codes; `sets.motion` stays `rapid | feed`, because the program checks read `feed` as "this block cuts".
- A setting, `assist.motionColors`, **on by default** (§9, a default the owner can change), and a View-tab toggle, `view.toggleMotionColors`.

**AD-35: A word is read in the state after its block.**
- The inspector, the hover and the edit read a word in the modal state **after** its block: the block's own codes are in force for it (`G91 X10.` is incremental, `G99 F.2` a feed per revolution, `G76 … F1.5` a lead), which is how every Python script reads it (`update`, then the state). For a block over several lines (Klartext `~`), that is the state after its last line. The state **before** the block is used only to mark what the block changed.
- One module reads a word: `core/codes/wordValue.ts` (`readWord`, `diameterReading`), so the inspector's value, the hover's context line and the edit's refusal can never disagree (§6.3).

**AD-36: The inspector's rules come before every consumer of them.**
- P3.2 of P2 §6 is split: **P3.2a** (Wave A) owns reading a word, the inspector's rows and `rewriteWord`, all pure and testable on hand-built states, written by the NC architect because every value it shows is an NC reading; **P3.2b** (Wave B) builds the panel on them. **P3.3** moves from Wave A to Wave B, after `wordValue.ts` exists. P3.1 needs none of them and runs beside P3.2a.

## 4. Execution protocol: deltas to P2 §5

Everything in P2 §5 applies (preludes with contracts and stubs, work packages in worktrees with disjoint `Owns`, Wave A from `p3/base`, Wave B from `p3a/int`, integration, gates G0–G11, reviews, one squash commit per milestone). The changes:

1. **Branches.** P3a: `p3/base` (this prelude, from `m13/int` @ `e85d4cb`; M13 lands on `main` in parallel), work-package branches `p3a/<wp>`, integration `p3a/int`. Before landing: merge `origin/main` into the branch (M13's squash and any Dependabot PR), then one squash commit on `main` per milestone. P3b the same with `p3b/*`.
2. **No release per milestone** (owner, 2026-10-09): one release at the very end, after P3b; the version is bumped then.
3. **Model and effort per task** (the session plan; the memory note "model and effort per task"): the NC architect (Opus, high) for the preludes and the NC-critical work packages, the judge (Opus, extra high) for the skeptic pass and the parity verdict, the implementer (Sonnet, high) for well-scoped code, UI and the harness, the docs writer (Sonnet, medium) for documentation and records, Haiku only for exact recipes whose result is checked. Each work package below names its model.
4. **G6 on the GitHub runner only.** The development Mac has too little free disk for a local harness build during P3a; the runtime suite runs on `spike/harness-ci` (force-push allowed, owner 2026-10-09) before the landing and on `main` after it. Scenarios that pin behaviour P3a changes on purpose are found by grep and updated first (§5, "Intentional behaviour changes").
5. **The parity judge** (new, after integration): the judge runs `modalParity.test.ts` and G11's parity on the owner's local programs (counts only), reads every difference, and decides per difference whether TypeScript or Python is wrong; a Python fix needs a regression test in `tests/python/test_modal.py`, a TypeScript fix one in `modal.test.ts`, and the golden set grows by one case where the difference had no golden.
6. **Regex cost in the app's WebKit.** The interpreter runs the profile's tool rule on every line; a pattern that is cheap in node can be slow in the webview (P2 lessons). `p3-perf` measures in the app; a unit test pins the number of regex calls per line, not only milliseconds.
7. **Contract deviations** are recorded in §7, numbered after P2 §7.16.

## 5. Milestones

### P3a: Understand a block

**Goal:** a user puts the cursor in any block and sees what each word means on their machine and what is in force there, edits one value safely, reads the cycle's parameters and the modal context in the hover, and sees at a glance which lines are rapids, cuts, arcs, threads and cycles.

**Status: on `main` (2026-10-09), reviewed and fixed.** The prelude (`p3/base`, commit "Phase 3 prelude (P3a)") and both waves are on `p3a/int`: P3.1, P3.2a, P3.2b, P3.3 and P3.7, with the user guide (P3.D) and the runtime scenarios of H3a. **Reviews:** the NC review gave 17 findings and the code review 13; the skeptic pass confirmed 27 (2 High, 9 Medium, 16 Low), partly refuted one (CODE-3, kept as Low), refuted one (NC-11, the plan's own rule 5 names `RND` and `CHF` as unmarked; it stays a data proposal in the backlog) and found no defect in CODE-13; CODE-3 (the eager build of every document is AD-33), CODE-4 (lines wider than about 300 characters; recorded as a limit in X17 and §6.1) and the flag of NC-14 (`CodeEntry.blocks`) were deferred. **Fix batches:** the NC batch (NC-01…10, 12…17 and CODE-8; one more reader of `MCALL` than the skeptic listed, `extents`) and the code batch (CODE-1, 2, 3 in part, 5, 6, 7, 9, 10, 11, 12), with the corrections of the integration (§7 #219–#224). `MCALL` is read in both languages (rule 11b, `sets.cycle: 'call-modal-next'`; `program_checks`, `address_arithmetic`, `scale_feed`, `scale_speed` and `extents` follow). **Parity after the fixes (TypeScript equals Python line by line):** 27 modal goldens; the 20 owner-public programs (300,863 lines): 0 lines differ; the owner's local programs (G11 recipe, counts only): 17 programs, 8,296 lines, 0 differ; an independent corpus of 393 files, read as an aggregate (390 programs, 4,080,477 lines; 3 files not detected): 0 lines and 0 programs differ. **Runtime scenarios (H3a), run locally on the development Mac after the fixes:** `p3-inspector` 72/72, `p3-hover` 51/51, `p3-colors` 38/38, `p3-perf` 36/36, `m3-assistant`, `m3-perf`, `m12-perf` and every scenario that reads a hover or a motion mark pass; the two things only a real window shows (the prompt opens with its value selected; the focus stays on the row after an edit that changes the word's width) are checks of `p3-inspector`. **Runtime suite on the GitHub runner: 130 of 130, none flaky (run 37971477581)** (the cumulative `m0`–`m13`, `rp`, `p3a` run on the landing). The known gaps that the review looked at are listed below, each with its outcome.

**What the prelude decided:**

1. **The split and the waves** (AD-36, §7 #206). Wave A: P3.1 and P3.2a. Wave B: P3.2b, P3.3, P3.7, P3.D (documentation), H3a (harness). No Wave C (P2 §5.2 rule 5): the harness is in Wave B, as H13 was.
2. **The index contract** (AD-33, §6.1, §7 #204, #205). `ModalIndex.stateAfter` answers `ModalState | null`; the index gains `buildSome(budgetMs)` and `statesAfter(first, last)`; the service gains `statesAfter` and `whenReady`, and `stateAfter(id, 0)` is the power-on state. The service is started by a contribution of its own, `contrib/modal.ts` (P3.1; §7 #211), as `programMap.ts` starts the outline.
3. **Reading a word** (AD-35, §6.3): `core/codes/wordValue.ts` with `readWord` and `diameterReading` (the twin of Python's `diameter_reading`), owned by P3.2a, read by the inspector, the hover and the edit.
4. **The hover's context** (§6.5, §7 #210): `HoverOptions.context` (`HoverContext`: the states before and after the block, the effective profile and machine, the block's other lines); `hoverAt` takes it. Absent or not ready, the hover is the Phase 2 hover.
5. **Motion colours** (AD-34, §6.6, §7 #207, #208): `core/nc/motion.ts` (kinds, colours, the CSS class prefix, the budgets, `motionOfLine`), `CodeSets.path: 'arc'` read by the loader (the flags are set on the data by P3.7), the setting `assist.motionColors` (default on) with its label.
6. **Commands** (§6.7, §7 #209): `view.toggleInspector` on `Mod+Alt+A`, `inspector.editValue` and `view.toggleMotionColors`, no key for the two, all pinned `pending` in `tests/unit/commandPins.test.ts` with `findConflicts` clean on both platforms; i18n stubs `i18n/en/{inspector,motionColors}.ts`.
7. **The harness hook and the test ids** (§6.8): `h.app.ctx.modal`; `inspector-panel`, `inspector-row`, `inspector-state`, `inspector-edit`, `inspector-cycle` (`INSPECTOR_TEST_IDS`); the motion marks' classes `gedit-motion-<kind>`.
8. **The parity harness** (§6.9): `tests/python/modal_dump.py` prints Python's state after every line of every golden's program; `tests/unit/modalParity.test.ts` runs it and holds TypeScript to it line by line; the `TS_PENDING` mark of the prelude was deleted by P3.1, and `modal_dump.py --context <file>` now also runs the owner-public programs with the profile and database that TypeScript detected, comparing a 16-digit digest of the state after every line.

**Prelude P3a (done):** this plan; the contracts and stubs `core/nc/modal.ts`, `app/modalService.ts` (+ `ModalService` in `app/types.ts`, `ctx.modal`), `core/codes/wordValue.ts`, `core/codes/inspect.ts`, `core/nc/rewriteWord.ts`, `core/nc/motion.ts` (+ its colour test), `HoverContext` in `core/codes/hoverText.ts`; `CodeSets.path` (types, loader, `flagsContract.test.ts`, the Fanuc spelling map); `assist.motionColors`; the command pins and i18n stubs; `contrib/README.md` rows for `inspector.ts`, `modal.ts`, `motionColors.ts`; the parity harness; the roadmap's Phase 3 rows; the pointer in P2 §6.

**Intentional behaviour changes when P3a lands:** the hover gains the context line, the parameter table and the readings of a machine-dependent number (scenarios that pin hover text: `m3-assistant`, and any `m9-*`, `m12-*` or `rp-*` scenario that reads a hover — H3a greps for them first); a coloured mark beside every moving line, on by default (a scenario that counts decorations or reads the margin's classes is updated by H3a); the Settings ▸ Assistance page gains one switch; the View tab gains **Code Inspector** and **Motion Colors**. **Changed again by the review fixes (scenarios updated on purpose):** `p3-inspector` reads a threading move in force (`G92`, `G32` of system A) as the motion row and expects no cycle row (NC-13); `exit2-x8`'s golden `tests/fixtures/exit2/expected/checks-sinumerik.extents.none.json` counts the positions that the modal `MCALL CYCLE83` runs (6 blocks, 5 of them under the tool `ROUGH`; the finding stands at its first position, line 32) instead of the one `MCALL` line (NC-03, `extents.py`); `p3-colors` reads the colour of a mark when it finds it, because Monaco recycles the margin's elements while the view scrolls on.

**Known gaps, for the NC and code reviews (none is fixed in P3a; each is recorded so that the review decides, not discovers).** The outcome of the reviews (NC batch of the review fixes, 2026-10-09) follows each item in *italics*.

1. **Klartext `Q206=FAUTO`.** A cycle parameter written as a word (`FAUTO`, `FMAX`, `FU…`) shows as "not written" in the inspector's cycle table and in the hover's table, because `assignmentAt` in `inspect.ts` takes a plain number only. Suggested: accept a word value as written text with no number. *Fixed (NC-07): a cycle parameter written as the rapid marker, a feed-mode code or a feed-unit word (`Q206=FAUTO`, `Q208=+FMAX`, `Q206=FU0.2`) is written, shown as written, not a variable and not editable; an expression stays a variable.*
2. **Okuma wording.** For a point-less word under a unit system that scales every number, the inspector's note says "No decimal point: steps of 0.01" and the hover says "every number counts in units of 0.01". P3.3 chose the hover's wording (a machine that also scales a word with a point counts every number in its unit); the review decides whether the inspector follows it. *Fixed (NC-09): the inspector follows the hover.*
3. **Sinumerik `MCALL CYCLE83(…)` sets no active cycle** in the interpreter (nor in Python), although the doc comment of `ModalState.activeCycle` names it. The positions after an `MCALL` get no "cycle in force" part and no cycle mark. A fix changes both languages at once, with goldens. *Fixed (NC-03): `sets.cycle: 'call-modal-next'` on `MCALL` and the interpreter's rule 11b in both languages (§7 #219); the `MCALL` line runs nothing and is no cycle in the colours, the inspector says it defines the cycle; the four scripts that recognised `MCALL` as "a cycle-group keyword without `sets`" read the new value, and their fixtures are unchanged; `extents` reports the cycle at its first position.*
4. **Lathe turning cycles read as straight moves.** `G90` and `G94` (system A) and `G77` and `G79` (system B) are `motion: feed` entries of the motion group, not cycles. *Fixed (NC-10): `sets.path: 'cycle'` on the four (§6.6, §7 #220); they and the positions under them are cycles in the colours.*
5. **`G28`/`G30` take the motion in force.** They have no `sets.motion`, so after `G1` a reference return is marked as a straight move. *Fixed (NC-04): `sets.motion: 'rapid'` on Fanuc `G28`, `G30`, `G53`, and a non-modal motion code of the block wins over a modal one (`G01 G28 X0.` is a rapid). With it (NC-01): the axis words of `G28`/`G30` are declared as the intermediate point in the program's coordinates; the hover and the inspector say so, with absolute or incremental, and keep "machine coordinates" for `G53`.*
6. **Klartext `RND` and `CHF`** (corner rounding and chamfer) have no `sets.motion` and get no mark. *Kept (NC-11, refuted as a defect): rule 5 names them as unmarked; a data proposal for the backlog.*
7. **Okuma `G102`/`G103`** are flagged as arcs on the strength of the database labels and syntax notes, not of the manuals; the NC architect confirms or removes them. *Confirmed by the NC review: OSP-P200L programming manual, contour generation, `G102`/`G103` are the arcs.*
8. **The two-block cycle heuristic.** Which `G71`, `G74`–`G76` lines are block 1 and block 2 is found by the pairing rule of §7 #215. A flag in the data (for instance `blocks: 2` with a label per block) would replace it and let the thread height carry its own label. *Kept for now (NC-14): the heuristic steps over up to three comment or blank lines between the blocks; the flag (`CodeEntry.blocks` with `CodeParam.block`) is recorded in TODO for a data milestone. Its most harmful consequence is removed without it (NC-02): a word declared as a parameter of a code whose axis words are data (`G71 U2.`, `G04 U1.5`) gets no diameter and no incremental note.*
9. **Klartext index build at 300,000 lines: 1.4–2.0 s against the 1.5 s of X17.** Mill, Okuma and Sinumerik are 0.7–1.2 s. The interpreter's share is 0.4–0.6 s in every dialect; the tokenizer and mask take 1.0–1.4 s of the Klartext figure. For G7 and `p3-perf` to decide: raise the Klartext budget or make the tokenizer cheaper. The build is idle work, so nothing waits for it, but a hover deep in an unbuilt document answers with the plain text until the build has passed it. *Open: H3a's `p3-perf` measured the index in idle slices (the page never stalls for more than 30 ms after the outline is built) and the hover at line 299,980 in about 7 ms; the Klartext figure stays as measured and is the owner's to accept or to tighten.*
10. **G11 does not yet run the per-line parity over the owner's local programs.** The recipe exists (`SP/handoff/p31-g11-modal-parity.recipe.ts.txt`); it needs the machine form of the manifest, which `machineOf` does not export yet. The check has been run by hand: no line differs. *Kept open: after the NC fixes the recipe was run by hand again on the owner's local programs: 17 programs, 8,296 lines, 0 lines differ (counts only); moving it into G11 stays on the backlog.*
11. **Not seen in a real editor or in a real window.** *Outcome: H3a ran them (`p3-inspector`, `p3-colors`, `p3-perf`): the bar sits between the line numbers and the text, the double click and the Enter key open the prompt, the focus stays on the row after an edit that changes the word's width, the colours are the constants in both themes. The panel in the three themes and the feel of the mark stay with the owner's manual check (§10).*

**Wave A**

#### P3.1 TS modal interpreter, index and service (was WP11.1)

- **Model:** NC architect (Opus, high).
- **Owns:** `src/lib/core/nc/modal.ts` and its tests (`modal.test.ts`, `modal.golden.test.ts`, `modal.property.test.ts`), `src/lib/app/modalService.ts` and its test, `src/lib/contrib/modal.ts` and its test, `tests/unit/modalParity.test.ts`, `tests/unit/helpers/modalParity.ts`, `tests/python/modal_dump.py`.
- **Depends on:** the prelude (the goldens of M6, M8, M9, M10 and M12.5).
- **Deliver:** `ModalInterpreter` and `ModalIndex` (AD-19, P2 §7.4, §6.1 here) mirroring `_nc_modal.py` rule for rule — rules 1–11, the defined cycle (rules 1–8 of P2 §7.4), rules 13–15, the speed-limit bound, indexed assignment words, the main spindle by number, `=` words that are values, calls that are their identifier's code — driven by the effective compiled profile and database and by no dialect name; `ModalService` per AD-33 (index per document, `applyChange` on every content change, idle `buildSome(16)` active document first, rebuild on a new effective key, `changed`, `whenReady`); `contrib/modal.ts` starts it (`ModalServiceInternals.start()`). `TS_PENDING` is deleted from the parity test (done); `modal_dump.py` is extended with a mode that reads a program plus an effective profile and database written by TypeScript (`--context <file>`), so the owner-public programs and G11's local ones run with a profile TypeScript detected and Python never merges.
- **Settled by the prelude, from TODO:** `SETMS(n)` and the Okuma `G141` are **not** followed, as in Python (P2 §7.4, "The modal state still does not follow `SETMS`"), so the two languages stay equal line by line; following them is a later decision for both languages at once, with goldens. P2 §7.16 #15 (a call is its identifier's code, an `=` word a value, `S` in an `fNotFeed` block a count), #22 (`pitchFeed` on a call) and #27 (a line whose start matches `syntax.continuationStart` belongs to the block above; the interpreter asks its own profile, on **the text the tokens give back**, which is what Python's `continues_block` reads; it is the same as `masked` except when a comment holds the marker's look-ahead, such as `$ … (50%)` on Okuma, and the parity check decided it) are binding. A variant the machine pushes (a G-code system chosen or detected) changes the effective key and rebuilds the index (AD-33).
- **Tests:** every golden unchanged (`modal.golden.test.ts`, each golden's effective profile from `resolved/effective/`); per-line parity on every golden and every owner-public program (`modalParity.test.ts`); property test: over 1,000 random edits, `stateAfter(n)` equals a fresh sequential walk, and `statesAfter` equals `stateAfter` line by line; 300k lines stepped < 1.5 s in node (assertion < 4 s, `budget.ts`); `stateAfter` within 1,000 lines of a snapshot ≤ 15 ms; `applyChange` ≤ 1 ms; `buildSome(16)` returns within 16 ms + one line; the service with fakes: an edit drops only later snapshots, a machine switch rebuilds, a closed document is dropped, `null` before the index reaches a line; regex calls per line pinned.
- **Covers:** "Modal interpreter" (TS half); X15.

#### P3.2a Reading a word, the inspector's rows and editing a value (was the core half of WP11.2)

- **Model:** NC architect (Opus, high).
- **Owns:** `src/lib/core/codes/wordValue.ts`, `src/lib/core/codes/inspect.ts`, `src/lib/core/nc/rewriteWord.ts` and their tests, `src/lib/i18n/en/inspector.ts` (in Wave A).
- **Depends on:** the prelude. Not on P3.1: every test builds its states by hand or reads them from the Python dump.
- **Deliver:** `readWord` and `diameterReading` (§6.3 rules 1–5); `blockRange`, `inspectBlock`, `checkEdit`, `checkValue` (AD-27, §6.3): the rows, the cycle with its parameters (a Klartext definition over several lines, a Sinumerik call's arguments by position, a Fanuc cycle's words, the two blocks of a lathe `G76` each with its own parameters, the thread height among them), the state rows in `INSPECTOR_STATE_KEYS` order with their source lines and the "set here" mark; `rewriteWord` (§6.4 rules 1–5) on `writeBack` with `refuseRounding`; the messages (`inspector.note.*`, `inspector.state.*`, `inspector.why.*`), plain words.
- **Tests:** rows for packed Fanuc, lathe (`U` incremental, `X` diameter, `F` a lead under `G76`), a Klartext multi-line cycle, Okuma `SB=`, Sinumerik `CYCLE83(…)`, and a Sinumerik `X` read as "radius" under `DIAMOF` and under `DIAM90` + `G91` (AD-19 rule 11); `diameterReading` on the cases of `test_modal.py`; the effective value of `X50` under IS-B and calculator with the source, and under **none** as the list of readings, where the row is not editable and says why, while `X50.` is editable; `rewriteWord` keeps the point, the decimals, the sign, the spacing, the address case and a trailing comment, and keeps typed extra decimals; `0.0505` into a point-less IS-B word refused, `0.051` → `X51`; the same refusal under an Okuma 10 µm machine (`0.015`); `G`, `M`, `N`, `O` not editable; `T`, `D`, `H` whole numbers only; a parameter's `min`/`max`; a violation is refused, never corrected.
- **Covers:** "Code inspector panel" and "edit values" (the rules); X7 (the rules half).

**Integration of Wave A (`p3a/int`):** merge P3.1 and P3.2a; regenerate the resolved fixtures if a golden was added (`UPDATE_RESOLVED=1 npm test -- resolved`); an integration test runs `inspectBlock` on `nc/fanuc-lathe/l01-turning-a.nc` with the real index and holds its state rows to the fanuc-lathe goldens (X7's state half).

**Wave B**

#### P3.2b The inspector panel

- **Model:** implementer (Sonnet, high); the panel's wording read by the NC architect.
- **Owns:** `src/lib/components/panels/InspectorPanel.svelte` and its test, `src/lib/contrib/inspector.ts` and its test, `src/lib/app/inspectorService.ts` and its test (the model of the panel: it follows the cursor, inspects once per frame and carries out an edit), `src/lib/components/panels/InspectorEdit.svelte` and its test (the value prompt), `src/lib/i18n/en/inspector.ts` (in Wave B: the panel's keys only), the `view.toggleInspector` row of `tests/runtime/lib/shortcuts.js` (the command-pin test asks for it the moment the key is registered).
- **Depends on:** Wave A.
- **Deliver:** AD-27: the panel in the **left** region next to the Program Map (hidden by default), registered by `contrib/inspector.ts` with `view.toggleInspector` (`Mod+Alt+A`, View tab, group `view.groupPanels`, after Side Panel) and `inspector.editValue` (palette; the word at the cursor); it follows the cursor with one update per animation frame and on `modal.changed`; double-click or Enter on a value → a prompt that takes the effective value (mm or inch) → `checkValue` → `rewriteWord` → `applyLines` (one undo step); Esc cancels; the violation shows next to the field; a source line is a link that moves the cursor; assumed values carry their source ("assumed: machine", "assumed: profile default"); "Waiting for the program to be read" while the state is not ready; the test ids of §6.8. Delete the `pending` marks of the two commands and add the key to `tests/runtime/lib/shortcuts.js`.
- **Tests:** the panel with a fake service and fake editor (rows, state rows, links, the edit path end to end with a fake `applyLines`, Esc, a refusal, not ready); the commands' enablement.
- **Covers:** X7 (the panel half).

#### P3.3 Hover with cycle parameters and modal context (was WP11.3)

- **Model:** NC architect (Opus, high).
- **Owns:** `src/lib/core/codes/hoverText.ts` and its test, `src/lib/monaco/providers/hover.ts`, `src/lib/i18n/en/assistant.ts`.
- **Depends on:** Wave A (`wordValue.ts`, the modal service).
- **Deliver:** with `HoverContext` (§6.5): on a cycle word, a table of its parameters with the values in the block (the lines of a Klartext definition included); on an address word, one context line (`X — target, diameter, absolute, work offset G54`; "radius" by AD-19 rule 11; `U — incremental X`; `F — feed per revolution (G99)`; under a pitch cycle `F — thread lead (G76)`; under CSS `S — surface speed (G96), clamp 2500 rpm (line 11)`); a word whose value depends on the machine adds its effective value and why (`X50 — 0.05 mm: no decimal point, increments of 0.001 mm (machine 'Lathe 2')`), with no machine every reading instead of one value (on Okuma also for a word **with** a point); assumed values marked with their source. The provider builds the context from `modal.stateAfter(docId, first - 1)` and `(docId, last)` and `machines.effective(docId)`. The hover reads the document's effective database, so system B explains `G94` as a feed mode. Text stays escaped, untrusted markdown.
- **Tests:** the pure hover text for these cases across the six built-in profiles, with and without a machine, with the context absent and not ready (the Phase 2 text, unchanged); escaping of a value from a user database; hover at line 300k ≤ 50 ms.
- **Covers:** "Hover with cycle parameters and modal context"; X14.

#### P3.7 Motion colours (new)

- **Model:** implementer (Sonnet, high); the rules of `motionOfLine` and the `sets.path` flags reviewed by the NC architect (G10).
- **Owns:** `src/lib/core/nc/motion.ts` and its test, `src/lib/monaco/motionColors.ts` and its test, `src/lib/contrib/motionColors.ts` and its test, `src/lib/i18n/en/motionColors.ts`, the `sets.path` members in `src/lib/data/codes/*.json` (only this WP edits those files in P3a), `tests/fixtures/motion/**`.
- **Depends on:** Wave A (the modal service).
- **Deliver:** AD-34 and §6.6: `motionOfLine` (rules 1–5); `sets.path: 'arc'` on `G2`, `G3` (Fanuc mill, lathe — system B inherits —, Okuma), `G2`, `G3`, `CIP`, `CT` (Sinumerik), and the Klartext circles `C`, `CR`, `CT`, `CP`, `CTP` and the circular `APPR`/`DEP` forms (`APPR CT`, `APPR LCT`, `DEP CT`, `DEP LCT`), and, added by P3.7 on the strength of the database labels, the Okuma contour arcs `G102`, `G103` (to be confirmed by the NC architect, see the known gaps), each checked in the manuals (resolved fixtures regenerated); `monaco/motionColors.ts`: a decorations collection per editor for the visible range ± `marginLines`, recomputed on scroll, `modal.changed`, a model or dialect switch and the setting, one update per frame, from one `statesAfter` call; the CSS custom properties from `MOTION_COLORS` on a theme change; `contrib/motionColors.ts` with `view.toggleMotionColors` (switches `assist.motionColors`, View tab, group `motionColors.group`); delete the `pending` mark.
- **Tests:** the motion goldens (`tests/fixtures/motion/<profileId>/<case>.json`: `{ input, machine?, lines: { "<n>": "<kind>" | null } }`, every listed line, synthetic programs only) for every built-in profile; the decorations with a fake editor (only the visible range, ≤ `maxMarks`, nothing for a line whose state is null, off removes all); the update ≤ 4 ms at 300k lines with the states known; the data flags listed in a test so none is dropped silently.
- **Covers:** "Motion-mode line coloring from the modal interpreter"; X16.

#### P3.D Documentation

- **Model:** docs writer (Sonnet, medium).
- **Owns:** `docs/user/**`, `README.md`, `docs/planning/{README,roadmap}.md`, `CHANGELOG.md` ("Unreleased").
- **Deliver:** the user guide gains the inspector (what each part shows, assumed values, editing a value and why one is refused), the hover in context and the motion colours (the five kinds, the setting); the roadmap marks P3a's rows; the planning README's "Current state".

#### H3a Harness P3a

- **Model:** implementer (Sonnet, high).
- **Owns:** `tests/runtime/scenarios/**`, `tests/runtime/suites/p3a.txt`.
- **Deliver:** first the scenarios that pin a behaviour P3a changes on purpose (above); then `p3-inspector` (X7 with the inspector half of X11 c), `p3-hover` (X14), `p3-colors` (X16), `p3-perf` (X17: the inspector open while typing at 300k lines, ≤ 30 ms per cursor move; hover at line 300k; a colour update while scrolling; a machine switch rebuilding the index in idle chunks). These are the designed `m11-inspector`, `m11-hover` and `m11-perf` under new names (P2 §6). Runs on the GitHub runner (§4 rule 4).

**Integration I3a:** merge Wave B; the full unit suite and Python; the runtime suite on `spike/harness-ci`; then the **parity judge** (§4 rule 5).

**Reviews:** NC (the NC architect: `wordValue.ts`, `inspect.ts`, `rewriteWord.ts`, the hover texts, `motionOfLine` and the `sets.path` data; ids `NC-…`) and code (the implementer: the service, the panel, the decorations, the budgets; ids `CODE-…`) in parallel, read-only; the skeptic (the judge) verifies each finding; fixers get only verified findings, each fix with a regression test that fails without it.

**Gates:** G0–G11 (G6 on the runner); G7 the budgets of X17; G10 the hover texts and the `sets.path` flags; G11 with the per-line parity on the owner's machine.

**Commit:** `P3a: Understand a block — modal interpreter, inspector, hover in context, motion colours`

### P3b: Write with templates

**Goal:** a user inserts parameterized templates — a program start, a tool change, a cycle — from the Insert tab or from completion, with the dialect's number style and continuing block numbers, edits a cycle in a form, and keeps templates of their own.

**Status:** designed (the moved designs below); its prelude runs after P3a lands.

**Prelude P3b (to come; NC architect):** the template contracts of P2 §7.8 in `src/lib/core/templates/types.ts` with the stub `core/templates/index.ts`; the `templates` member of `CodeDb` (P2 §7.2) read by the loader; `insert.template:<id>` command ids and test ids (P2 §7.12, §7.13); **designs P3.8** (cycle forms from the database's cycle entries, pre-filled from the block — the word reading of P3.2a —, present words keep their order, new optional words follow in the database's order, unknown words kept; formula parameters: a small expression language over the other parameters, evaluated exactly with the decimal rules of `numbers.ts`, never `eval`) **and P3.9** (the template manager: list, edit, duplicate and delete user templates in `<config>/codes/<dialect>.json`, through the M13 user-file commands; "create from selection": the selected lines become a template body, the numbers the user marks become parameters), each with Owns, tests and a model, and X18 made testable; recorded in this plan.

**Intentional behaviour changes when P3b lands:** the Insert tab shows templates instead of blocks (the `insert.block:*` commands and test ids go; the Phase 1 scenarios' `insert.block:start` moves to `insert.template:program-start`).

**Wave A**

#### P3.4 Template engine (was WP12.1)

- **Model:** implementer (Sonnet, high).
- **Owns:** `src/lib/core/templates/**` and tests.
- **Depends on:** the P3b prelude.
- **Deliver:** `loadTemplates`, `templateFields`, `renderTemplate`, `validateTemplateValues` (P2 §7.8) with the placeholder and parameter options of `code-assistant.md` "Parametric templates" and "Placeholders" (formulas come with P3.8): prefix/suffix, decimals (`as-entered`, `min1`, fixed), digit padding, plus sign, comment wrapping with the profile's delimiters, an empty optional parameter drops its word, a line left with only a block number drops, `\{{`, `{{N}}`, `{{sys.*}}`.
- **Tests:** every option; validation never corrects a value; `{{N}}` with and without numbering.

#### P3.6 Template content (was WP12.3)

- **Model:** NC architect (Opus, high).
- **Owns:** the `templates` arrays in `src/lib/data/codes/*.json` (only this WP edits those files in P3b), `tests/fixtures/templates/**`.
- **Depends on:** the P3b prelude.
- **Deliver:** P2 §8.6 in our own words, from the manuals, every template marked **review pending** (owner, 2026-10-09) until the owner's review.
- **Tests:** every template renders with its defaults and tokenizes without `unknown` tokens in code positions; a golden per template.
- **Acceptance:** G10; the owner reviews the default set (§10).

#### P3.8 Cycle forms and formula parameters (engine half)

- **Model:** NC architect (Opus, high). Designed by the P3b prelude.

**Wave B**

#### P3.5 Templates in the UI (was WP12.2)

- **Model:** implementer (Sonnet, high).
- **Owns:** `src/lib/contrib/templates.ts`, `src/lib/components/shell/TemplatesGroup.svelte`, `src/lib/monaco/providers/completion.ts`, `src/lib/core/codes/completionItems.ts` and its test, `src/lib/i18n/en/templates.ts`. **Deletes** `src/lib/contrib/blocks.ts`, `src/lib/components/shell/BlocksGroup.svelte`, `src/lib/utils/insertBlock.ts` and its test, `src/lib/data/blocks/**`, `src/lib/i18n/en/blocks.ts` (the deletion by exact recipe, Haiku, checked).
- **Depends on:** Wave A.
- **Deliver:** AD-28: the Insert tab by group (toolbar templates as buttons; the Home tab keeps one button for the active document's `program-start` template); `insert.template:<id>` in the palette; the form through `modals.form` with remembered values (`lastParams['template:'+id]`); one undo step (Klartext with the renumber in the same edit); snippet templates through the snippet controller; templates in completion. Every one of these reads `machines.effective(docId).codes.templates` — the document's effective database — and re-reads on a document switch and on `machines.revision`, because the variant is a property of the document (AD-31).
- **Tests:** the insertion edit (numbered, unnumbered, Klartext renumber); completion items; a document under `gcodeSystem: B` offers the `fanuc-lathe-b` override of "Tool start" (`G92 S`), the same document under A the `fanuc-lathe` one.

#### P3.9 Template manager and create from selection

- **Model:** implementer (Sonnet, high). Designed by the P3b prelude.

#### P3.D' Documentation and H3b Harness P3b

- Documentation (docs writer): the templates, the forms, the manager. Harness (implementer): `p3-templates` (X9t, the designed `m12-templates`), the P3.8 and P3.9 scenarios, the Phase 1 scenarios moved from `insert.block:start` to `insert.template:program-start`.

**Gates:** G0–G11; G10 the template content; **Phase 3 is done** when §2.2 holds.

**Commit:** `P3b: Write with templates — engine, Insert tab and completion, content, cycle forms, template manager`

## 6. Shared contracts (binding; written by the preludes)

### 6.1 The modal interpreter and its index: `src/lib/core/nc/modal.ts` (deltas to P2 §7.4)

P2 §7.4 is binding (the state, the rules, the golden format). This prelude's stub adds, and P3.1 implements:

```ts
export const SNAPSHOT_EVERY = 1000;
export const STATES_MAX = 1000;                               // the most lines one `statesAfter` call answers
export class ModalNotImplemented extends Error {}           // the stub's error; nothing ships that calls the stub
export class ModalInterpreter {                               // unchanged from P2 §7.4
  constructor(cp: CompiledProfile, db: CodeDb);
  reset(): void; update(tokens: NcToken[], line: number, masked: string): void;
  state(): ModalState; snapshot(): unknown; restore(s: unknown): void;
}
export class ModalIndex {
  constructor(cp: CompiledProfile, db: CodeDb, o?: { every?: number });
  reset(lineCount: number, getLine: (n: number) => string): void;            // builds nothing yet
  applyChange(firstChangedLine: number, lineCount: number, getLine: (n: number) => string): void;
  buildSome(budgetMs: number): boolean;                       // NEW: idle build; true when the document is covered
  stateAfter(line: number): ModalState | null;                // CHANGED: null when no snapshot within `every` lines
  statesAfter(first: number, last: number): ModalState[] | null;   // NEW: ≤ 1,000 lines
  ready(): boolean;
}
```

`statesAfter(first, last)` (P3.1, §7 #212): it needs only a snapshot within `every` lines before `first` (the whole prefix need not be built), and then replays up to `last`; `last` is clamped to the document's end; `last < first` gives `[]`; more than `STATES_MAX` lines throws `RangeError`; a `first` outside the document, or one with no such snapshot yet, gives `null`. `stateAfter(n)` is `null` for an `n` outside `0…lineCount`, one that is not an integer, or one whose snapshot is not built yet, except the line of snapshot k itself while snapshot k−1 is valid: it is read from k−1 (exactly `every` lines), so an edit on line k·1,000 never leaves that line without a state (§7 #221). Replay cost is counted in lines; the budgets of X17 hold for lines up to about 300 characters and grow linearly beyond (a snapshot spacing by characters as well is deferred).

A fresh `ModalInterpreter` is in its reset state; `reset()` puts it back there. `stateAfter(0)` is the power-on state. The interpreter splits nothing itself: a caller hands it lines split on `\n` with `\r\n` and `\r` read as `\n`, which is how the Python helpers split a program, so the parity check compares the same lines.

### 6.2 The modal service: `src/lib/app/modalService.ts` (P2 §7.3, extended)

```ts
export interface ModalService {
  stateAfter(id: DocId, line: number): ModalState | null;     // 0 = power-on; null: not reached yet, or no such document
  statesAfter(id: DocId, first: number, last: number): ModalState[] | null;   // NEW: ≤ 1,000 lines
  readonly changed: Readable<number>;
  whenReady(id: DocId): Promise<void>;                        // NEW: the harness and the tests
}
// app/types.ts: AppContext.modal (the harness hook `h.app.ctx.modal`)
// P3.1: createModalService(deps) returns ModalServiceInternals = ModalService + start(): Disposable, called by contrib/modal.ts
export const KEY_CHECK_DELAY_MS = 300;                       // the key re-read after a pause in typing (§7 #213)
```

Rules: AD-33. A reader never caches a state across `changed`. The effective key (profile plus machine parameters, variants included) is re-read once, `KEY_CHECK_DELAY_MS` after the last edit, and on `machines.revision`, `profiles.revision` and every `docs.list` emit, never on each keystroke: `machines.effective` detects over the whole text. The idle pump runs one `buildSome(16)` slice per idle callback (`requestIdleCallback`, else `setTimeout 0`), the active document first.

### 6.3 Reading a word and the inspector's rows: `src/lib/core/codes/{wordValue,inspect}.ts`

```ts
// wordValue.ts (P3.2a)
export interface WordReading { cls: ResolvedClass; value: string | null; unit: string | null; source: ParamSource | null;
  readings: Reading[]; diameter: 'diameter' | 'radius' | 'unknown' | null; incremental: boolean; lead: boolean }
export interface WordView { profile: Profile; db: CodeDb; machine: EffectiveMachine }
export function readWord(token: NcToken, blockTokens: readonly NcToken[], after: ModalState, view: WordView): WordReading | null;
export function diameterReading(s: ModalState, profile: Profile, address?: string): 'diameter' | 'radius' | 'unknown';

// inspect.ts (P3.2a)
export interface InspectInput { line: number; lineCount: number; getLine(n: number): string }
export interface InspectView { profile: Profile; cp: CompiledProfile; db: CodeDb; machine: EffectiveMachine }
export type InspectedKind = 'code' | 'address' | 'cycleParam' | 'call' | 'variable' | 'assignment' | 'unknown';
export interface InspectedValue { cls; effective: string | null; unit; source: ParamSource | null; readings: Reading[] }
export interface InspectedWord { line; token; kind; written; address; meaning; value: InspectedValue | null; notes: Msg[];
  edit: { ok: true } | { ok: false; reason: Msg } }
export interface InspectedCycle { code; line; role: 'runs' | 'defines' | 'calls'; params: { param: CodeParam; written: string | null; line: number | null }[] }
export interface InspectedState { key; label: Msg; value: string; line: number; assumed: boolean; from?: ParamSource }
export interface BlockInspection { firstLine; lastLine; words: InspectedWord[]; cycle: InspectedCycle | null; state: InspectedState[]; stateReady: boolean }
export const INSPECTOR_STATE_KEYS;   // motion, plane, distance, units, diameter, workOffset, tool, spindle, speed, speedLimit,
                                     // feed, coolant, compensation, cycle, definedCycle, frame, tcp; then `group:<name>`
export function blockRange(input, cp): { first: number; last: number };
export function inspectBlock(input, view, before: ModalState | null, after: ModalState | null): BlockInspection;
export function checkEdit(word): { ok: true } | { ok: false; reason: Msg };
export function checkValue(word, typed: string, view): Msg | null;      // never corrects
```

`readWord` rules (binding; in the module's header): 1. the state after the block (AD-35); 2. `numberClassOf` with the block's entries, the codes in force and the pitch, then `resolveValue` with the effective machine and the profile's declaration (no machine and a machine-dependent reading: no value, every reading, the default first); 3. diameter or radius by `diameterReading` (AD-19 rule 11); 4. incremental: `addresses.incremental`, the Klartext `I` prefix, or distance `incremental` for an axis word; 5. a thread lead as the database declares it. Every text from a profile, a database or the document is data: shown as text. The fields that P3.2a added to these shapes (`InspectedWord.param`, `.how`, `InspectedCycle.part`, `InspectedState.setHere`) are in §7 #215.

### 6.4 Rewriting one word: `src/lib/core/nc/rewriteWord.ts`

```ts
export interface RewriteHow { cls: ResolvedClass; params: MachineParams; units: 'mm' | 'inch'; fmt: NumberFormatOptions }
export type RewriteResult = { ok: true; line: string; text: string; start: number; end: number } | { ok: false; reason: Msg };
export function rewriteWord(line: string, token: NcToken, typed: string, how: RewriteHow): RewriteResult;
```

Rules (binding): only the token's characters change; the address as written; the number's form kept (point, point-less, sign style, written decimals, and typed extra decimals: never rounded); a classed word through `writeBack(…, { refuseRounding: true })`, so a point-less word takes only a whole number of increments (or units, under `scale`); a machine-dependent word with no machine has no reading to write into (`noReading`); not a number is refused (`notANumber`). The caller validates with `checkValue` first and applies with `applyLines`.

### 6.5 The hover in context: `src/lib/core/codes/hoverText.ts`

```ts
export interface HoverContext {
  before: ModalState | null;            // stateAfter(first - 1): what the block changed
  after: ModalState | null;             // stateAfter(last): every word is read here (AD-35)
  profile: Profile; machine: EffectiveMachine;
  blockLines?: { first: number; last: number; line: number; lineCount: number; getLine(n: number): string };   // a block over several lines; `line` is the hovered line, `lineCount` the document's length (§7 #217)
}
// HoverOptions.context?: HoverContext;   hoverAt(…, o: Pick<HoverOptions, 'waitCode' | 'context'>)
```

Absent (a diff side, a scratch model) or `after` null: the Phase 2 hover, unchanged. The machine's wait codes keep winning over the database (M12.5). The provider builds the context with `contextOf(model, line, docId, view)` (`monaco/providers/hover.ts`, exported for the tests and the harness).

### 6.6 Motion colours: `src/lib/core/nc/motion.ts`, `CodeSets.path`

```ts
export type MotionKind = 'rapid' | 'linear' | 'arc' | 'thread' | 'cycle';
export const MOTION_KINDS: readonly MotionKind[];
export const MOTION_CLASS_PREFIX = 'gedit-motion-';
export const MOTION_COLORS: Record<'light' | 'dark', Record<MotionKind, string>>;   // ≥ 3:1 on the editor background
export const MOTION_BUDGETS = { lines: 300_000, updateMs: 4, marginLines: 100, maxMarks: 1_000 };
export function motionOfLine(tokens: readonly NcToken[], before: ModalState, after: ModalState,
  cp: CompiledProfile, db: CodeDb): MotionKind | null;
// core/codes/types.ts: CodeSets.path?: 'arc' | 'cycle'   (loader: SETS_VALUES.path = ['arc', 'cycle'])
// settings: 'assist.motionColors': boolean (default true), Settings ▸ Assistance
```

The kind of a line (binding):
1. **Only a moving block gets a mark:** an axis word with a value (`addresses.axes`, an incremental address of `addresses.incremental`, a Klartext `I` axis, an assignment such as `Z=IC(-2)`) that no code of the block makes data (`axisWords: 'data'`) and that is not a dwell (`G4 X1.`); or a non-modal entry of group `motion` (a Klartext path function, polar moves included) with a word that has a value other than the feed (`LP PR+10 PA+30` moves, a bare `L` does not); or a cycle runs in it (`after.block.cycle`) **and the line itself carries the cycle code or a position**, so the tail line of a multi-line block and a data block get no mark (§7 #218).
2. `thread`, asked **before** the cycle: `after.block.pitchFeed`, a called cycle whose definition has a pitch feed (`after.definedCycle`), an active cycle with a pitch feed, or a running or active cycle whose entry has `tapping` (Sinumerik `CYCLE84`, whose lead is an argument). The interpreter makes a pitch motion code (`G32`, `G33`, Okuma `G31`–`G37`) the block's cycle as well, so asking the cycle first would paint every threading pass as a cycle. A threading or tapping **cycle** (lathe `G76`, mill `G84`, Okuma `G71`/`G72`, a Klartext cycle 207 call) is a thread, and so are the positions under an active tapping cycle.
3. `cycle`: `after.block.cycle` on a line that starts, calls or positions, or a moving block under an active cycle without a pitch feed. The line of `MCALL CYCLE81(…)` runs nothing (rule 11b) and gets no mark; the positions after it are cycles.
4. Otherwise the block's own motion code (a non-modal one before a modal one: `G01 G28 X0.` is a rapid), else `after.groups.motion` when **not assumed**: `rapid` for `sets.motion: 'rapid'` or the profile's rapid marker in the block (`addresses.rapid`, `FMAX`, also written apart as `F MAX`); `arc` for `sets.path: 'arc'`; `cycle` for `sets.path: 'cycle'` (the lathe single-pass cycles `G90`, `G94` of system A, `G77`, `G79` of system B); `linear` for any other `sets.motion: 'feed'`.
5. Otherwise none: a guess is never painted (no code yet, an assumed mode, a motion-group code with no `sets.motion` such as `CC`, `RND` or `CHF`).

The colours (dark / light): rapid `#e5534b` / `#cf222e`, linear `#3fb950` / `#1a7f37`, arc `#58a6ff` / `#0969da`, thread `#d2a8ff` / `#8250df`, cycle `#e3b341` / `#9a6700`; `core/nc/motion.test.ts` holds them distinct and ≥ 3:1 against `EDITOR_COLORS`.

### 6.7 Commands and keys (P2 §7.13, extended)

| Keys | Command | Title (i18n) | Where | Owner |
|---|---|---|---|---|
| Mod+Alt+A | `view.toggleInspector` | `inspector.toggle` "Code Inspector" | View tab, `view.groupPanels`, after Side Panel; category `inspector.category` | `contrib/inspector.ts` (P3.2b) |
| (none) | `inspector.editValue` | `inspector.editValue` "Edit Value at Cursor…" | palette; category `inspector.category` | `contrib/inspector.ts` (P3.2b) |
| (none) | `view.toggleMotionColors` | `motionColors.toggle` "Motion Colors" | View tab, `motionColors.group` "Lines"; category `motionColors.category` | `contrib/motionColors.ts` (P3.7) |
| (none) | `insert.template:<id>` | the template's label | Insert tab | `contrib/templates.ts` (P3.5, P3b) |

All three P3a rows are pinned `pending` in `tests/unit/commandPins.test.ts`; `findConflicts` over every shipped shortcut plus these is clean on both platforms. Monaco binds no `Mod+Alt+A` (F108); macOS has no system shortcut on `Cmd+Option+A`. On Windows and Linux `Ctrl+Alt+A` is `AltGr+A` on some keyboard layouts (Polish programmer: `ą`): it stays on the AltGr manual check (§10); the View-tab button and the palette remain.

### 6.8 Test ids and the harness hook (P2 §7.12, extended)

| `data-testid` | Element | Extra attributes |
|---|---|---|
| `inspector-panel` | the panel | `data-doc-id`, `data-first-line`, `data-last-line`, `data-ready` |
| `inspector-waiting` | the "Waiting for the program to be read" paragraph, present while the state is not ready | (none) |
| `inspector-row` | a word row (a `div` with `role="button"` and `tabindex=0`: double-click it, or focus it and press Enter) | `data-address`, `data-line`, `data-kind`, `data-editable`, `data-value` (the effective value, empty without one), `data-readings` (the count) |
| `inspector-cycle` | the cycle table | `data-code`, `data-role` |
| `inspector-state` | a state row | `data-key`, `data-group` (for `group:<name>`), `data-line`, `data-assumed`, `data-from` |
| `inspector-edit` | the value prompt | `data-address`, `data-error` (the message key while refused) |

The motion marks carry the classes `gedit-motion-<kind>` on Monaco's line-decorations margin. The harness reaches the modal state through `h.app.ctx.modal` (`stateAfter`, `statesAfter`, `whenReady`).

### 6.9 The parity harness

- `tests/python/modal_dump.py` (`python3 -S -m tests.python.modal_dump [golden…]`, from the repository root): for every golden, the effective profile named by `resolved/effective/index.json`, then `render(state)` of `test_modal.py` after every line; one JSON document, `$format` 1: `{ goldens: { "modal/<p>/<case>.json": { effective, codes, lines, states[] } } }`.
- `tests/unit/helpers/modalParity.ts`: `goldenNames`, `pythonDump`, `goldenLines`, `goldenView` (the TypeScript twin of `render`), `claimDiffers` (the claim check of `test_modal.check`), `effectiveOf`, `walkTs`; since P3.1 also `canonicalJson`, `digestOf`, `pythonContext`, `walkRun`, `splitLines` and `differingLines`.
- `modal_dump.py --context <file|->` reads `{ $format: 1, runs: [{ name, profile, codes, lines, digest }] }` and answers with the states, or, per line, the first 16 hex digits of the MD5 of the canonical JSON (`sort_keys`, compact, `ensure_ascii`).
- `tests/unit/modalParity.test.ts`: per golden, Python reaches every claim; TypeScript reaches every claim; TypeScript equals Python on every line. `TS_PENDING` was deleted by P3.1; the file also runs the owner-public programs through `modal_dump.py --context` (per-line digests; about 13 s wall). Without Python 3.9+ the file says why and skips.

### 6.10 Settings and i18n

- `assist.motionColors: boolean`, default `true`, Settings ▸ Assistance ("Color lines by how they move"). No other key; `state.json` unchanged in P3a.
- Namespaces: `inspector` (P3.2a, then P3.2b), `motionColors` (P3.7); the hover's texts stay in `assistant` (P3.3). Every user-facing text is plain: "assumed", "set on line 12", "depends on the machine; choose a machine".

## 7. Where Phase 3 deviated from the contracts

Numbering continues P2 §7.16. Filled at each step from the hand-off notes; every entry is additive or a narrowing.

| # | Contract | What was done instead | Why | Step |
|---|---|---|---|---|
| 204 | P2 §7.4 `ModalIndex` | `stateAfter` answers `ModalState \| null` (null when no snapshot lies within `every` lines before the line); the index gains `buildSome(budgetMs)` and `statesAfter(first, last)` | The index is built in idle chunks (AD-33): a reader that met an unbuilt stretch would otherwise replay up to the whole document on the UI thread; the motion colours read a viewport in one call | P3a prelude |
| 205 | P2 §7.3 `ModalService` | + `statesAfter`, `whenReady`; `stateAfter(id, 0)` is the power-on state; `AppContext.modal` | The colours (a viewport), the harness (`whenReady`, as `outline.whenReady`), the inspector's "before" state at line 1 | P3a prelude |
| 206 | P2 §6 "Designed in Phase 2, moved to Phase 3" | P3.2 split into P3.2a (word reading, rows, `rewriteWord`; Wave A; NC architect) and P3.2b (the panel; Wave B); P3.3 moves to Wave B; new module `core/codes/wordValue.ts` | One owner for reading a word, before every consumer of it (AD-36); the inspector, the hover and the edit must not disagree about a value | P3a prelude |
| 207 | P2 §7.2 `CodeSets` | + `path?: 'arc'`, read by the loader; set on the data by P3.7 | The colours tell arcs from straight moves; `motion` stays `rapid \| feed`, because the program checks read `feed` as "cuts" | P3a prelude |
| 208 | P2 §7.11 settings | + `assist.motionColors` (boolean, default true) | AD-34: the colours can be switched off | P3a prelude |
| 209 | P2 §7.12, §7.13 | + `inspector.editValue`, `view.toggleMotionColors`; the test id `inspector-cycle` and the attributes of §6.8; the inspector toggle on the View tab, group `view.groupPanels` | The palette needs a way to edit without the mouse; the colours need a toggle; the harness needs the cycle table | P3a prelude |
| 210 | `HoverOptions` (P1 WP3.6, M12.5) | + `context?: HoverContext`; `hoverAt` takes it | The hover's modal context and the machine's readings (P3.3) | P3a prelude |
| 211 | P1 AD-3 contributions | + `contrib/modal.ts` (P3.1) starts the modal service | The service needs a start like the outline's (`programMap.ts`), and the hover and the colours need it while the inspector is hidden | P3a prelude |
| 212 | #204 `statesAfter` | `STATES_MAX` (1,000) is exported; `statesAfter(first, last)` needs only a snapshot within `every` lines before `first`; `last` is clamped to the document's end; `last < first` gives `[]`; more than `STATES_MAX` lines throws `RangeError`; a start outside the document or without a snapshot gives `null`. `stateAfter` is `null` outside `0…lineCount`, for a non-integer and for an unbuilt stretch | The colours ask for a viewport near the cursor while the index is still being built; a range beyond the cap is a caller's bug, not a slow answer | P3.1 |
| 213 | #205 `ModalService` | The service re-reads the effective key once, `KEY_CHECK_DELAY_MS` (300 ms) after the last edit, as well as on `machines.revision`, `profiles.revision` and every `docs.list` emit; `createModalService` returns `ModalServiceInternals` (`ModalService` + `start()`) | A variant that detection now reads differently must rebuild the index, but `machines.effective` detects over the whole text and must not run on every keystroke | P3.1 |
| 214 | P2 §7.16 #27 | The interpreter asks `continuationStart` on the text the tokens give back, not on `masked` | That is what Python's `continues_block` reads; the two differ only when a comment holds the marker's look-ahead (Okuma `$ … (50%)`), so parity decided it | P3.1 |
| 215 | #206 `inspect.ts`, `wordValue.ts` | `InspectedWord.param?` and `.how?` (what `checkValue` and `rewriteWord` need); `InspectedCycle.part?: { index: 1 \| 2; of: 2 }` (the two blocks of `G71`, `G74`–`G76`, found by a heuristic: both blocks write the same non-modal `cycle: 'start'` code, the first writes no feed word, the second an address the first does not); `InspectedState.setHere`; `InspectedValue.unit` is the exported `ValueUnit`; `RewriteHow.readings?`, and `RewriteHow.units` is the units **after** the block (AD-35); `WordReading.unit` is set when there are only readings; exports `blockEntries`, `inForceEntries`, `keywordEntry`, `paramOf`, `isFeedWord`, `isAxisWord`, `incrementalAxisOf`, `unitOfClass`, `unitsAfter`, `MAX_BLOCK_LINES`, `callArguments`; `inspector.why.pending` is gone | The prelude's shapes had no place for the "set here" mark, the second block of a lathe cycle, or the information the edit needs; all additive | P3.2a |
| 216 | AD-27 | The inspector's model is `app/inspectorService.ts`, not the panel: `follow()`, `inspectNow()`, `edit(word)`, `editAtCursor()`, `reveal(line)`. Each trigger (cursor, content, activation, `modal.changed`, machine and profile revision) only asks for an animation frame and the block is inspected once in it; a line longer than 4,000 characters is not inspected; the value prompt is `components/panels/InspectorEdit.svelte`; an edit checks the program version before it writes. The panel is mounted only while it is the active left panel, so a hidden inspector costs nothing | `inspector.editValue` works with the panel hidden and needs the same logic; the unit tests run in node without a DOM; the keystroke path must stay a flag check | P3.2b |
| 217 | #210 `HoverContext` | `blockLines` gains `line` (the hovered line) and `lineCount` (the document's length); `contextOf(model, line, docId, view)` in `monaco/providers/hover.ts` is exported | The hover needs both to read a `~` block, the neighbour block of a two-block cycle and the definition that a call runs | P3.3 |
| 218 | §6.6 rules 1–3 | `motionOfLine` asks the lead (thread) **before** the cycle; a dwell, a data block and the tail line of a multi-line block get no mark; a bare path word with no value (`L`) moves nothing; threading and tapping cycles read as `thread`; the Okuma contour arcs `G102`, `G103` carry `sets.path: 'arc'` | The interpreter makes a pitch motion code the block's cycle too, so the prelude's order would have painted every thread pass as a cycle; the other three rules keep a mark from claiming a move that is not there | P3.7 |
| 219 | P2 §7.2 `CodeSets.cycle`, §7.4 AD-19 rule 11 | + `'call-modal-next'` (Sinumerik `MCALL`) and rule 11b in both interpreters: the `start` cycle written in the same block becomes `activeCycle` (with its `pitchFeed`) and runs nothing there; every later positioning block runs it (`block.cycle`); the word alone, or with another cycle, ends or replaces it; no motion code and no cancel ends it. `program_checks`, `address_arithmetic`, `scale_feed` and `scale_speed` recognise the word by the value, no longer by "a cycle-group keyword without `sets`"; `extents` reports the cycle at the positions that run it. Goldens: `modal/sinumerik-mill/mcall.json` (new), `modal/sinumerik/drill.json` lines 24–29 and the motion goldens `sinumerik-mill/five-axis.json` line 12, `sinumerik/turning.json` line 17 changed to the manual's reading | The manual: the program after `MCALL` is called after every following block with path motion, not at once (840D sl NC programming, work preparation, 06/2019, §3.2.3.4); the old reading showed the `MCALL` line as drilling and the drilling positions as rapids | P3a review fixes (NC) |
| 220 | #207 `CodeSets.path` | `path?: 'arc' \| 'cycle'`; `'cycle'` on the lathe single-pass cycles (`G90`, `G94` of system A, `G77`, `G79` of system B) | Each of their blocks is a whole pass (approach, cut, retract, return), not a straight move; Python does not read `path` | P3a review fixes (NC) |
| 221 | #212 `stateAfter` | The line of a snapshot that is not valid while the one before it is (`line === k·every`, `k === valid`) is answered from snapshot k−1 (`every` lines of replay) in `stateAfter` and `statesAfter` | An edit on line k·1,000 dropped the snapshot that answers that very line, and the inspector and hover lost their state for every keystroke on it until the next idle slice | P3a review fixes (NC) |
| 222 | §6.3 `wordValue.ts` | `readWord`: a word declared as a parameter of a block code whose `axisWords` is `'data'` has no diameter reading and is not incremental; + `feedUnitSource` (the code a feed word's unit comes from: the feed-unit code in force only when it agrees with the class, else the code that declares the word with that unit); the inspector's diameter note follows the hover's rule (a length only; on a mill only a diameter), and its scaled/no-point note the hover's wording; + `inspector.note.axisVia`, `assistant.context.threadInForce` | `G71 U2.` is a radius depth of cut and `G04 U1.5` a dwell time, never a diameter or an incremental move; Okuma `G101 … F` is a feed per minute whatever `G95` says; the two views must not disagree | P3a review fixes (NC) |
| 223 | §6.2 `ModalService` reached-test | A reader that waited for the line of a snapshot (`k·every`) is reached by snapshot k−1, and the test asks the line right after the snapshot (`k·every + 1`), not the snapshot line itself | With #221 the snapshot line is answered from the snapshot before it, so the old question ("does `stateAfter(k·every)` answer?") said yes one snapshot too early and the revision would have moved once per slice until the real one arrived | P3a final (integration) |
| 224 | X7, X14 (plan wording) | The plan says what the build writes: `X50` under IS-B reads "0.05 mm" (the shortest form of the number, the same text in the panel, the hover and the guide; no padded zero) and the clamp "clamp 2500 rpm (line 11)" | An NC programmer reads "0.05 mm" as the value; a trailing zero would suggest a precision the machine's increment does not give, and the build, the guide and the unit tests already say it | P3a final (H3a finding 2) |

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The TypeScript and Python interpreters drift apart | One golden set; per-line parity on every golden and owner-public program in CI and on the local programs in G11; the parity judge; a difference fixed on the wrong side is caught by the other side's goldens. |
| The index costs typing time on large programs | `applyChange` only drops snapshots; the rebuild is idle work in ≤ 16 ms chunks; readers never block (AD-33); `p3-perf` measures typing with the inspector open and the colours on in the app's WebKit. |
| A regex of the tool rule is slow in WebKit | Measured in the app; regex calls per line pinned in a unit test (§4 rule 6). |
| A colour or a value presented as fact when it is a guess | Assumed motion modes get no mark; a machine-dependent value with no machine shows every reading; the inspector marks every assumed value with its source. |
| The hover changes text that scenarios pin | H3a greps and updates them first (intentional changes listed above). |
| `Mod+Alt+A` is taken by AltGr layouts on Windows/Linux | The View-tab button and the palette; the AltGr manual check (§10). |
| The Mac's disk is too small for a local harness build | G6 on the GitHub runner (§4 rule 4); no Rust change in P3a. |

## 9. Owner decisions and defaults

- **Decided by the owner (2026-10-09):** one release at the very end; force-push of `spike/harness-ci` allowed; `roadmap.md` updated as milestones land; template content marked "review pending" and reviewed later.
- **Defaults the owner can change** (the plan runs with them):
  1. **Motion colours on by default**, as a narrow mark beside the line numbers, not a background (AD-34).
  2. **The inspector is hidden by default** and opens with `Mod+Alt+A` or the View tab (AD-27).
  3. **No mark for a line whose motion mode is only assumed** (rule 5 of §6.6), rather than a mark in the assumed colour.
  4. **The kinds:** rapid, straight, arc, thread, cycle — five colours; a probing or a dwell block gets no kind of its own.

## 10. Manual checks for the owner

- Read a few blocks of a real program in the inspector and confirm the modal state and the effective values under your machine; edit one feed and undo it.
- Hover a cycle and an `X` word with your machine chosen and with none.
- Look at a program with the motion colours on, in the light and the dark theme; say whether the default should stay on.
- On Windows (and a Linux desktop) press `Ctrl+Alt+A`: with a keyboard layout that uses AltGr for a letter, the letter may win.
- P3b: review the default templates (they ship marked "review pending").

## 11. Coverage: roadmap row → work package

| Roadmap Phase 3 row | WP | Exit criterion |
|---|---|---|
| Modal interpreter, TypeScript half | P3.1 | X15 |
| Code inspector panel, edit values | P3.2a, P3.2b | X7 |
| Hover with cycle parameters and modal context | P3.3 | X14 |
| Motion-mode line coloring from the modal interpreter | P3.7 | X16 |
| Parametric templates, placeholders, file-based templates: the engine | P3.4 | X9t |
| Templates in completion and in the Insert tab | P3.5 | X9t |
| Template content for the built-in dialects | P3.6 | X9t |
| Cycle forms, formula parameters | P3.8 | X18 |
| Template manager UI and create from selection | P3.9 | X18 |
| (no regression, budgets) | every WP, H3a, H3b | X17 |
