# gEdit: final implementation plan for Phase 2

Scope: the roadmap's Phase 2 (`docs/planning/roadmap.md`), pruned to what matters for editing CAM output (§2.1), ordered so that the owner's **lathe** work improves first and the known **data-loss** gap closes early. Phase 2 is finished when the exit criteria in §2.2 pass.

Status: this plan combines two earlier drafts that are not in the repository: Plan A (user value first) and Plan B (foundations first). It uses Plan A's scope, milestone order and most of its technical content, and grafts in Plan B's protocol refinements, its explicit modal semantics and its safer recovery and quit-guard details. Scores and grafts are in §0.

**Revision of 2026-09-22 (owner decisions, §10.1):** how the control reads a written number, the Fanuc G-code system and the power-on modes are **machine parameters**, set in named **machine configurations** chosen per document (AD-31, §7.15), not hardcoded per dialect; `fanuc-lathe-b` is gone (one `fanuc-lathe` profile with a G-code-system choice); Sinumerik turning defaults to `DIAMON`; the owner's real programs stay in a gitignored local folder (§9.2); W0 no longer needs a push (§5.1). A review pass on the same day corrected the number model (Okuma's unit system scales every number, with or without a point: a third reading `scale`; the Fanuc lathe defaults to calculator-type input; with no machine, a word whose reading depends on the machine is never converted), and pinned the modal sources, the reload of `machines.json`, the parameter units, the variant scoring and the local-program rules.

**Second revision of 2026-09-22 (owner decision D58, §10.1): multi-channel programs.** How a machine's **channels** are laid out is a property of the machine, exactly like how it reads a number: the channels may sit in **one file** as sections or in **several files**, one document per channel. The channel definition **and** the synchronization marks (wait codes) therefore live in the **machine configuration** and are written by the user; gEdit ships **no machine-builder-specific sync code set** and, in Phase 2, no sync preset at all — the owner has not yet said which wait codes the owner's machines use, and the design does not need to know (AD-32, §7.17, §8.9). Multi-channel becomes a milestone of its own, **M10** [M12 since 2026-09-30], between the program checks (M9) and the inspector; the inspector milestone becomes **M11** and the templates-and-exit milestone **M12** (§6 heading, D63). What lands in M10 is the cheap half: the channel model, the wait-code check, per-channel map and tool list, the channel status item and sync-point navigation. The **side-by-side channel view** goes to Phase 3 [Phase 4 since 2026-09-30] with its reasons written out (§11 item 27, F54–F56, D61).

**Review pass of the same day on the multi-channel design.** The first draft of AD-32 was read against real two-channel programs and the owner's own manuals, and it was wrong in ways that would have produced findings on *correct* programs — the failure that makes a check worthless. Corrected here: a channel may hold **several sections** that interleave, so a channel carries a list of line ranges and "a channel appears twice" is information, not a problem; lines that belong to no channel (between a `sectionEnd` and the next start, where a concatenated file keeps its shared subprograms) are an **outside** group instead of being dropped; the check compares **sequences, not sets**, so a repeated wait id is clean and the "duplicated" finding is gone; a sync rule declares **which of three mechanisms** it models (`rendezvous`, `count`, `ordered`), because an id-less wait is checked by count and an ordering code must not be required to appear on both sides; a channel carries **aliases**, because the section token, the partner token and the file-name token are three different strings in real posts; the order check is suspended by a **jump target or a backward jump**, not by a label, because real wait lines carry labels; a multi-file set may be described by a **per-channel name template** or **assigned by hand**, because several real layouts fit no single pattern; a **broken channel pattern** costs the channels, not the machine's number reading; the check applies **one machine** to every channel and says so; the **split** is documented as a one-way copy and carries the program header; and the check's algorithm and its cost are pinned in the contract (§7.17) and measured at the contract cap. The evidence for each is in §7.17, WP10.1–WP10.5, §8.9, §9.1, X12 and §12.

**Third revision of 2026-09-30 (the re-cut; D69 and D70, accepted 2026-10-01).** At the owner's request ("take a step back, check if the roadmap still makes sense") the order after M8 was checked against what the owner needs next, and it no longer fit, for four reasons:
1. **Reading the owner's real programs right has no milestone of its own.** It was scattered over the old M9's prelude (roadmap R2, R3, R4 and R6, accepted 2026-09-27) and TODO's "Bugs and risks > NC correctness" list. Every later feature — the checks, the extents, address arithmetic, compare, the inspector — reads values, so this work goes first, with its own gates and reviews: the new **M9, "Real programs read right"**.
2. **Address arithmetic waited for the wrong thing.** A Z shift on a lathe program is a daily task, and on Klartext and Sinumerik cycle depths it is a scrap risk (source review R8). It sat in the old M11 behind the TypeScript modal interpreter, although as a script it needs only the Python interpreter that shipped in M6. It moves to the checks and the extents, which also run on the Python interpreter: the new **M10**.
3. **Nothing has been released.** Phase 2's exit was four large milestones away, the owner has never tested a tagged build, and the Phase 1 exit (the owner's check of the bundles on Windows and Linux) is still open. A release after each milestone (§5.3) gives the owner something concrete to test, and real use a chance to steer the next milestone.
4. **The inspector, hover with modal context, the TypeScript modal interpreter and the parametric templates help understanding and writing; they do not make CAM output safer.** They move to a new **Phase 3, "Understand and write"**, with their Phase 2 designs kept in §6 ("Designed in Phase 2, moved to Phase 3"), so their contracts (the TypeScript half of §7.4, §7.8) keep a home. The roadmap's old Phase 3 becomes **Phase 4, "Comfort and geometry"**.

The milestones are now: M6, M7, the Windows pass (shipped), M8 (implemented, landing after G6), then **M9** Real programs read right, **M10** Check before the machine, **M11** Compare and search, **M12** Multi-channel programs, **M13** Your own dialects and codes, and the Phase 2 exit. Each milestone ends with a draft release the owner publishes (v0.2 = M6–M8, then v0.3 to v0.6, 1.0 at the exit; §5.3). Two proposals now have a deadline: R8's smallest version is needed before M10 starts, R5's before M12 (§10.2). Every older reference to an id in the repository or in commit history resolves through this table (old → new):

| Kind | Old | New |
|---|---|---|
| Milestone | M9 "Compare and search, block skip, program checks and extents" | split: block skip, program checks, extents → **M10**; search, compare → **M11**; its prelude's R2, R3, R4, R6 → the new **M9** |
| Milestone | M10 "Multi-channel programs" | **M12** (unchanged in content, R5 added to its prelude) |
| Milestone | M11 "Understand a block" | address arithmetic → **M10** (WP10.4); the rest → **Phase 3** (P3.1–P3.3) |
| Milestone | M12 "Make it yours … and the Phase 2 exit" | user profiles, code files, typing options, the exit → **M13**; templates → **Phase 3** (P3.4–P3.6) |
| Milestone | (none) | **M9** "Real programs read right" (new) |
| Prelude | P9 | R2, R3, R4, R6 → **P9** (new M9); the search and compare contracts → **P11**; command ids → P10 and P11 |
| Prelude | P10 / P11 / P12 | **P12** / the Phase 3 prelude / **P13** (its templates contract → the Phase 3 prelude) |
| Work package | WP9.1, WP9.2, WP9.3, WP9.4, WP9.5, WP9.6, WP9.7 | **WP11.1**, **WP11.2**, **WP10.1**, **WP10.2**, **WP10.3**, **WP11.3**, **WP11.4** |
| Work package | WP10.1 … WP10.7 | **WP12.1** … **WP12.7** |
| Work package | WP11.1, WP11.2, WP11.3, WP11.4, WP11.5 | **P3.1**, **P3.2**, **P3.3**, **WP10.4**, the Phase 3 documentation (and WP10.5 for address arithmetic) |
| Work package | WP12.1, WP12.2, WP12.3 | **P3.4**, **P3.5**, **P3.6** |
| Work package | WP12.4, WP12.5, WP12.6, WP12.7, WP12.8 | **WP13.1**, **WP13.2**, **WP13.3**, **WP13.4**, **WP13.5** |
| Work package | (none) | **WP9.1**–**WP9.7** (new M9), **WP10.5** (M10 documentation) |
| Harness WP | H9 / H10 / H11 / H12 | **H10** and **H11** / **H12** / **H10** (`m10-arith`) and Phase 3 / **H13** (and Phase 3 for `m12-templates`); **H9** is new |
| Integration | I9 / I10 / I11 / I12 | **I10** and **I11** / **I12** / Phase 3 / **I13** |
| Scenario | `m9-search`, `m9-compare-*`, `m9-blockskip`, `m9-scripts`, `m9-perf` | `m11-search`, `m11-compare-*`, `m10-blockskip`, `m10-scripts`, `m10-perf` and `m11-perf` |
| Scenario | `m10-*` | `m12-*` |
| Scenario | `m11-arith` / `m11-inspector`, `m11-hover`, `m11-perf` | `m10-arith` / Phase 3 (new names there) |
| Scenario | `m12-templates` / `m12-user-profile`, `m12-typing`, `m12-machines-io`, `m12-exit-criteria`, `m12-exit-criteria-nopython` | Phase 3 / `m13-user-profile`, `m13-typing`, `m13-machines-io`, `m13-exit-criteria`, `m13-exit-criteria-nopython` |
| Scenario | (none) | `m9-sinumerik-mill`, `m9-detect`, `m9-numbers`, `m9-structure` |
| Exit criterion | X7 (inspector); X9 (templates and profiles) | X7 → Phase 3; X9's templates half → Phase 3, its user-profile and code-file half stays |
| Exit criterion | (none) | **X13** "Real programs" (M9) |
| Decision | D38 (M8/M9 swap), D63 (M10 placement) | history, each with a "renumbered 2026-09-30" note (§10.3); **D69** the re-cut, **D70** releases per milestone (§10.2) |
| Phase | Phase 3 "Comfort and advanced transformations" | **Phase 4** "Comfort and geometry"; the new **Phase 3** is "Understand and write" |

Scenario prefixes are reused: a Phase 2 `m12-*` name is now a channel scenario and an `m11-*` name a compare or search scenario; the old meaning of a name in a commit before 2026-09-30 is the one in the "Old" column. Historical sentences below keep their old ids, with the new id in brackets where that helps.

It **reuses the Phase 1 execution protocol** (`docs/planning/phase-1-implementation.md` §4, cited as **P1 §4**) and the **Phase 1 contracts** (P1 §7, as amended by P1 §7.12). Both stay binding unless §5 or §7 of this document changes them. Numbering continues Phase 1: facts **F20+**, architecture decisions **AD-16+**, owner decisions **D23+**, milestones **M6–M13** (and **P3.1–P3.6** for the designs moved to Phase 3), so the harness suites `m0`–`m5` remain the regression base and nothing is renamed.

Path shorthands (as in Phase 1):
- `R` = the local cargo registry sources (`$CARGO_HOME/registry/src/index.crates.io-<hash>/`)
- `NM` = `node_modules`
- `SP` = a scratch directory outside the repo (worktrees, cargo target dirs, hand-off notes, background-run logs, review files)
- `P1` = `docs/planning/phase-1-implementation.md`

All other paths are relative to the repository root (main @ `21091a0`). The repository is public: this plan names no local machine paths, and no real program, file name of a real program or content derived from one appears in it (§9.2).

---

## 0. Verdict and grafts

| Criterion (1–10) | Plan A | Plan B | Notes |
|---|---|---|---|
| Technical claims are correct | 8 | 7 | Every fact both plans cite that I re-checked holds (table below). A keeps Phase 1's fragile "a cycle entry with `params` starts a cycle" inference, misses the `G43`/`G49` group bug, and orders WP6.2's content tests against a stub resolver. B finds those, but its `newToolOnly` rule silently changes Phase 1's tool-item semantics, its default leaves every `G99` feed unscaled on a lathe, it would rewrite `M99 P` inside a subprogram, and its "30 s after the last change" snapshot never fires while the user keeps typing. |
| Fit to the owner decisions | 9 | 6 | A ships the lathe in a lean M6 (Python modal state only, no registry reload) and prunes hard. B's M6 has eight WPs, including live profile reload, Rust user-config commands and a TypeScript modal index with no consumer until M9, and B keeps NC-event navigation, block ranges, insert/append file, in-app help, word marks, transliteration and per-profile rulers. A keeps OS file associations (a network-only plugin and installers nobody can test here) and a Sinumerik mill profile the owner has no machine for. |
| Parallel work with disjoint ownership | 8 | 8 | A splits `gedit_nc.py` into private modules so Python WPs stop colliding, and generates resolved fixtures so there is one merge implementation. B lets preludes implement small pure functions and lets content WPs ship spec goldens that fail until integration, which fixes A's WP6.1/WP6.2 ordering. Both are taken. |
| Verification quality | 8 | 9 | B adds per-line TS/Python modal parity on real programs (G11), property tests, an anonymization checker and a cargo test of the ObjC install on a throwaway class. A's NC-correctness procedure (detection margins printed, resolved JSON reviewed, `verify` items never reach hover) is the more precise gate. |
| Simplicity and risk | 7 | 6 | A: Python first, TS interpreter later, fewer features, but a new right panel region, a viewer mode, NUL-heavy files opened read-only and the single-instance plugin. B: foundations before any consumer, more features, a second Python resolver. |
| **Total** | **40** | **36** | A's scope and order are the better fit; B's protocol and robustness details make it safer. This plan combines the two. |

**Taken from Plan A:**
1. Scope and order: M6 lathe + Dock-quit guard, M7 never lose work, M8 Okuma/Sinumerik, M9 compare/search/checks, M11 inspector, M12 templates/user profiles. The cut list of §2.1, with A's reasons. (Re-cut on 2026-09-30: see the third revision at the top.)
2. The Python modal interpreter first (M6, the lathe scripts need it); the TypeScript one in M11 [Phase 3 since 2026-09-30, P3.1], where the inspector and hover consume it, against the same goldens.
3. Scale feed and scale speed get an **auto** choice (per-revolution feeds and constant surface speed are scaled on a lathe profile, skipped on a mill profile); a remembered `false` falls back to the new default without a migration (F33).
4. Reference-aware renumbering with `rewrite: false` for `M99 P`, a preflight that asks only about references it cannot rewrite, and `keepReferenced` for remove-block-numbers.
5. `tests/fixtures/resolved/**`: the resolved built-in profiles and databases written by one TypeScript implementation and read by Python tests and the NC review.
6. `gedit_nc.py` becomes a facade over private `_nc_lex.py` and `_nc_modal.py` modules (F37), done mechanically in P6.
7. Token-based NC search with word conditions (`T1` ≠ `T10`, `S>2000`), which also covers what "next NC event" would have done.
8. The tokenizer field list for Okuma and Sinumerik (`sequenceNames`, `assignment`, `labels`, `calls`, `systemVariables`, `header`) and the rule that `syntax` sections are pinned by the M8 prelude.
9. The NC-correctness gate procedure (§8.7) and the intake step with the owner's consent (now: only for the files the owner hands over as public, §9.2).
10. `h_crash` sends `SIGKILL` (B's `std::process::abort()` raises SIGABRT, which macOS answers with a crash report that can put a dialog in front of the harness).

**Taken from Plan B:**
1. Preludes may implement small pure functions every Wave A WP depends on: P6 implements the profile resolver, the code-database merge and `toolCall.ignore`, so the lathe content WP tests against real resolution.
2. Content WPs may write spec goldens for behavior another Wave A WP implements; those tests may fail in the content worktree and must pass at integration (G2).
3. Explicit modal semantics in the code database (`sets.cycle: start | cancel` and friends) instead of inferring a cycle start from `params`; the Phase 1 inferences are migrated as data, preserving behavior.
4. `G43`/`G44`/`G49` move to their own `lengthComp` group (F25).
5. The quit guard re-assigns `NSApp`'s delegate after adding the method, is unit-tested on a class built in the test, logs and degrades on failure, and the webview clears the dirty flag in `files.onWillQuit`.
6. Recovery uses per-session folders with a heartbeat (no single-instance plugin), is **never cleared on `RunEvent::Exit`** (Windows ends a session through Exit, F29), only after the user's quit decision; folders are 0700; leftovers are pruned after 14 days or 200 MB.
7. Backup modes `history` (default, app data folder) / `sibling` (`name.ext.bak`, refused on a symlink or directory) / `off`, with `files.backupCount`.
8. The code inspector is a tab in the left region next to the Program Map (F39): no layout contract change.
9. Cuts: OS file associations, compare tolerance, a Sinumerik mill profile; NUL-heavy files stay refused.
10. `toolCall.ignore` (a line that also matches is not a tool change) instead of lookahead-heavy trigger regexes; it serves the lathe offset cancel `T0100` and Okuma's `T` inside a cycle block.
11. Gate G11 (real-program smoke with full per-line TS/Python modal parity once the TS interpreter exists), the anonymization checker and `GEDIT_REAL_FIXTURES`. The publish/local split became "local by default" with the owner's decision (§9.2, D45).
12. The property test "`ModalIndex.stateAfter(n)` equals a sequential walk", the per-folder detection goldens, the `modal.initial` values shown as **assumed**, and the ≈1,500-changed-lines WP size cap.

**New in this plan:**
1. **W0**, a first item before M6: `feat/phase-2` is cut at the local Windows test-manifest fix (`fix/windows-test-manifest`, `c18fba2`, not pushed). Pushing it and the Windows CI confirmation are a separate, owner-approved step that Phase 2 does not wait for (§5.1, D46); because every Phase 2 commit contains `c18fba2`, the first approved milestone push carries it too.
2. **Machine configurations** (AD-31, owner decision D23/D24/D34/D35): a named setup of a base profile plus the machine parameters that change how its programs are read: how a written number is read (per address class where the control distinguishes it), unit at power-on, the Fanuc lathe's G-code system, diameter programming, and the power-on modal defaults. Chosen per document from a status-bar dropdown, remembered per file (M7), with a default per profile; "none" means the profile's documented defaults, shown as assumed. The minimum the Fanuc lathe needs is in M6.
3. **One Fanuc lathe profile.** G-code systems A and B are two choices of the machine parameter `gcodeSystem` of `fanuc-lathe`, each selecting a code database (`fanuc-lathe`, or its child `fanuc-lathe-b`); without a machine the system is detected from content. This replaces the `fanuc-lathe-b` profile of the first version of this plan. The Fanuc syntax notes were written from the owner's 18i-T/31i **system B** manuals (F41), and both drafts had defaulted to A only.
4. A recovered document is bound to its original path only when that path is already in the fs scope, and it carries the **disk stamp from snapshot time**, so the Phase 1 external-change banner (Reload / Keep mine / Compare) appears if the file changed after the snapshot (AD-21).
5. `M98 Q` (a local call) is rewritten only when the block has no `P` (F42); every other case is reported.
6. The docs check is part of G8 (no separate docs gate).
7. **Real programs stay local** (D45): intake, G11 and the TS/Python parity checks read a gitignored folder (`GEDIT_REAL_FIXTURES`, else `tests/real/` of the main working tree, also from a worktree) and skip cleanly without it; the committed fixtures are synthetic plus the files the owner hands over as public (§9).
8. **Multi-channel programs** (AD-32, owner decision D58): a milestone **M10** [M12 since 2026-09-30] between M9 and the inspector. The machine configuration gains the channel layout (`single-file` sections or `multi-file` siblings) and a user-written list of sync marks; gEdit resolves the channels of a document, checks the wait codes across them, shows the program map and the tool list per channel, and navigates from one sync point to the next. The side-by-side view is Phase 3 [Phase 4 since 2026-09-30]: a per-channel pane needs a second model per channel with a two-way mapping — the machinery of the Phase 3 [now Phase 4] rows "Split view" and "Aligned NC-aware diff with merge" (F56) — because Monaco's `setHiddenAreas` is private API and does nothing on a model over 300,000 lines or over 20 MB (F54).

### 0.1 Contested claims, checked for this plan

| Claim | A | B | Verdict | Evidence |
|---|---|---|---|---|
| tao's macOS delegate has no `applicationShouldTerminate:`, so a method can be added | yes | yes | **Holds.** The class is built at runtime with objc2's `ClassBuilder`, which `class_addMethod` can extend. | `R/tao-0.35.3/src/platform_impl/macos/app_delegate.rs:13-14, 47-84`; `event_loop.rs:176-178` |
| The guarded close does not re-enter the hook | – | yes | **Holds**: tao ends its loop with `[NSApp stop:]`, not `terminate:`. The dirty flag is cleared in `onWillQuit` anyway. | `R/tao-0.35.3/src/platform_impl/macos/app_state.rs:403-410`; `src/lib/contrib/files.ts:85-110` |
| AppKit may cache the delegate's selectors | – | yes | **Unverifiable offline; re-setting the delegate is cheap**, and `m6-dock-quit` proves the hook with a real `terminate:`. | — |
| Windows logoff cannot be vetoed | yes | yes | **Holds**, and it means `RunEvent::Exit` also runs on a Windows session end, so recovery must not be cleared there. | `R/tao-0.35.3/src/platform_impl/windows/event_loop.rs:2381-2390` |
| `objc2` builds offline and does not collide with the harness | yes | yes | **Holds**: 0.6.4 is in `Cargo.lock`; `sync.mjs` adds `objc2` only when no `objc2 =` line exists. | `src-tauri/Cargo.lock:1920`; `tests/runtime/harness/sync.mjs:79-84` |
| `G43`/`G49` share a group with `G40`–`G42` | missed | yes | **Holds**: a modal tracker would let `G49` cancel `G41`. | `src/lib/data/codes/fanuc.json` (group `compensation` on G40–G43, G49) |
| Phase 1 starts a cycle when an entry has `params` | kept | replaced | **Holds, and it is fragile**: a cycle entry written without `params` (a `verify` row) reads as a cancel. | `src-tauri/resources/scripts/gedit_nc.py:1634-1642` |
| The mill profile carries the lathe `G70`–`G73` reference rule and `min` | yes | yes | **Holds.** | `src/lib/data/profiles/fanuc-gcode.json` (`numbering.references`, `files.extensions`) |
| A repeated tool call is a tool item | yes (D25) | no (`newToolOnly`) | **Phase 1 already makes every trigger line a tool item**, repeats included; A keeps that, B would change it. | `src/lib/core/profiles/outline.ts:474-486` |
| Scale feed's `perRevolution` can become a choice without a migration | yes | no (OD16) | **Holds**: a remembered value that does not suit the field falls back to the default. | `src/lib/core/forms/values.ts:44-88`; `scale_feed.py:66-70` |
| The inspector fits the left region with no layout change | – | yes | **Holds**: two panels in one region become a tab strip. | `src/lib/components/shell/PanelHost.svelte:1-8` |
| Python needs its own profile resolver | no | yes | **No**: the script context already carries the resolved profile and the database slice; tests read generated resolved files. | `src/lib/core/scripting/context.ts:101-124` |
| The lathe default is G-code system A | A | A | **Decided by the owner (D23)**: the system depends on the machine's setting, so it is a machine parameter (AD-31). Without a machine it is detected from content; a tie reads as A. | `docs/planning/syntax/syntax-fanuc.md:5, 73, 240-259, 573` |
| The settings form engine already has list-valued fields | – | – | **Does not hold**: `FieldType` has no list type; the only list settings (`scripts.folders`, `editor.rulers`) are plain arrays in `settings.json`, validated by `merge.ts`, and `scripts.folders` is drawn by the settings dialog's own add/remove control. The Machines page therefore reuses `FormRenderer` for one machine's form and a page-owned list control for the list (F46). | `src/lib/core/forms/types.ts` (`FieldType`); `src/lib/core/settings/schema.ts` (comment above `SETTING_FIELDS`); `src/lib/core/settings/merge.ts` (`LIST_KIND`); `src/lib/components/dialogs/SettingsDialog.svelte` (`LIST_KEYS`, the list control) |
| Per-file memory exists and can carry the machine choice | – | – | **Not yet**: `UiState` has `layout`, `lastParams` and `lastScript` only; per-file memory is built in M7 (AD-22), which adds the machine choice next to the manual profile choice. Until then the choice holds for the session. | `src/lib/app/types.ts` (`UiState`) |
| The lathe tool patterns | checked | checked | **Hold** in node and Python 3 for the combination used here (§8.1): `T0101`→`01`, `T101`→`1`, `T0111`→`01`, `T12`→`12`; `T0100`, `T100`, `T1000`, `T0`, `T0000`, `T12345` are not changes. A two-digit `T10` reads as station 10 (review item). | run for this plan |

---

## 1. Verified facts this plan relies on

Checked for this plan against the repo and the installed sources. P1 F1–F19 still hold where cited (F2 drop grant, F6 CSP, F12 resources, F13 `HOME` isolation, F16 quit path).

| # | Fact | Evidence |
|---|---|---|
| F20 | Profiles are validated and compiled once, when `stores/profiles.ts` is imported. The validator keeps unknown fields (`extends` included) and nothing resolves them, so a child profile loads today as an incomplete profile: **resolution must run before validation**. | `src/lib/core/profiles/validate.ts:9-11`; `src/lib/stores/profiles.ts:69-91`; P1 §7.12 last bullet |
| F21 | The code database is chosen by `profile.codes` and cached per dialect id; no merge exists. Databases are `version: 1` with `dialect`, `addresses`, `codes`. | `src/lib/stores/codes.ts`; `src/lib/data/codes/index.ts` |
| F22 | The mill profile carries the lathe `G70–G73 P/Q` reference rule, plus `M99 P`, `M98 Q` and `GOTO`, and still lists `min` (the Okuma main-program extension) in `files.extensions` and `detect.extensions`. | `src/lib/data/profiles/fanuc-gcode.json` |
| F23 | In the outline, every line that matches the tool trigger becomes a tool item, repeats included; `tool` comes from the named group as written; code rules run on the comment-masked line (strings are not masked). `collapseOffsetDigits` halves an even-length number of ≥ 4 digits, so Okuma's `T010203` would read as `010`. | `src/lib/core/profiles/outline.ts:22, 225-245, 440-486`; `tool_list.py:66` |
| F24 | The Python feed tracker hardcodes `G93/G94/G95`, `G96/G97` and Klartext `FU`/`FZ`, starts in `G94`, starts a cycle for any `cycle` entry with `params`, `pitchFeed` or `pitchFeedAmbiguous` and cancels it otherwise, and treats a non-pitch `motion` code as a cycle cancel. `scale_speed.py` hardcodes `G50`/`G92` as speed limits. A system-A lathe (`G98/G99` feed modes, `G92` threading, `G94` facing, one-shot `G70–G76`) is misread. | `src-tauri/resources/scripts/gedit_nc.py:1497-1504, 1620-1656`; `scale_speed.py:155, 365-370` |
| F25 | `fanuc.json` puts `G43` and `G49` in group `compensation` with `G40`–`G42`; `G92` is `nonmodal`, `verify`, `pitchFeedAmbiguous`; `G76` (fine bore) is `pitchFeedAmbiguous`; `G74` is left-hand tapping with `pitchFeed`; `G98`/`G99` are `cyclereturn`. | `src/lib/data/codes/fanuc.json` |
| F26 | tao 0.35.3's macOS delegate class is built with objc2's `ClassBuilder` and implements `applicationWillTerminate:`, `application:openURLs:` and four others, **not** `applicationShouldTerminate:`. It is set with `setDelegate:` when the event loop is built, before `setup`. Dock → Quit, logout, shutdown and `osascript quit` therefore end the app without `CloseRequested`. | `R/tao-0.35.3/src/platform_impl/macos/app_delegate.rs:13-14, 47-88, 131-135`; `event_loop.rs:165-179`; `R/tauri-runtime-wry-2.11.4/src/lib.rs:4185-4187` |
| F27 | tao ends its run loop with `[NSApp stop:]`. P1's quit path is `menu::request_quit` → `window.close()` → `CloseRequested` → the webview's combined dialog → `files.onWillQuit` handlers → `destroy()`; it never sends `terminate:`. | `R/tao-0.35.3/src/platform_impl/macos/app_state.rs:403-410`; `src-tauri/src/menu.rs:237-262`; `src/lib/contrib/files.ts:85-110` |
| F28 | `objc2` 0.6.4 is in `Cargo.lock` (through tao) and exports `ffi::class_addMethod`; `NSApplicationTerminateReply` is an `NSUInteger` (Cancel 0, Now 1, Later 2). The harness patch adds `objc2 = "0.6"` only when the manifest has no `objc2 =` line. The harness can already send `[NSApp terminate:]` (`h_quit('terminate')`). | `src-tauri/Cargo.lock`; `R/objc2-0.6.4/src/ffi/class.rs:78-83`; `R/objc2-app-kit-0.3.2/src/generated/NSApplication.rs:1053-1067`; `tests/runtime/harness/sync.mjs:79-84`; `tests/runtime/harness/harness.rs:891-915` |
| F29 | On Windows, tao does not handle `WM_QUERYENDSESSION`; `WM_ENDSESSION` runs `loop_destroyed` (→ `RunEvent::Exit`) and Windows then ends the process. A logoff cannot be vetoed, and `Exit` is not proof of a clean quit. Linux has no equivalent hook. | `R/tao-0.35.3/src/platform_impl/windows/event_loop.rs:2381-2390` |
| F30 | A command can take `tauri::ipc::Request` and read `InvokeBody::Raw(Vec<u8>)` plus headers, and answer raw bytes with `tauri::ipc::Response`. A 10 MB recovery snapshot need not be JSON-escaped. | `R/tauri-2.11.5/src/ipc/mod.rs:55-64, 122, 148-165`; `NM/@tauri-apps/api/core.d.ts` |
| F31 | Monaco 0.55.1's diff editor exposes `getLineChanges()`, `originalEditable` and `renderMarginRevertIcon`, but no way to supply our own line diff: NC-aware comparison needs normalized temporary models. `editor.actions.findWithArgs` exists (StartFindWithArgs). F8/Shift+F8 are `editor.action.marker.nextInFiles`/`prevInFiles`. | `NM/monaco-editor/esm/vs/editor/editor.api.d.ts:4045, 4054, 6458`; `…/contrib/find/browser/findController.js:475-515`; `…/contrib/gotoError/browser/gotoError.js:216` |
| F32 | `readOnly`/`readOnlyMessage` are editor options; a snippet can be inserted with `editor.getContribution('snippetController2').insert(text)`. | `editor.api.d.ts:3323-3327`; `…/contrib/snippet/browser/snippetController2.js:41, 68` |
| F33 | A remembered form value that does not suit its field (a `false` for a field that became a `choice`) falls back to the field default. `scale_feed.perRevolution` and `scale_speed.surfaceSpeed` are `bool`, default `false`. | `src/lib/core/forms/values.ts:44-88`; `scale_feed.py:66-70`; `scale_speed.py:64-68` |
| F34 | The Insert tab's blocks are keyed by profile id (`data/blocks/{fanuc-gcode,heidenhain-klartext}.json`), so a new profile has no blocks until templates replace them. | `src/lib/data/blocks/index.ts`, `src/lib/contrib/blocks.ts` |
| F35 | `files_stat` reports `readonly`; `DocMeta` has no read-only field; `decodeFile` refuses a file with > 10 % inner NUL. | P1 §7.6; `src/lib/app/types.ts`; `src/lib/core/text/codec.ts` |
| F36 | The grammar dispatch is "`klartext`, else `iso`"; the tokenizer is profile-driven with no dialect branches (TS and Python). Okuma and Sinumerik need new tokenizer fields and two Monarch generators, not new tokenizers. | `src/lib/core/grammar/index.ts:46`; `src/lib/core/nc/tokenizer.ts` |
| F37 | Script discovery skips `gedit_nc.py` and every name starting with `_`; the whole `resources/scripts/` folder is bundled; `PYTHONPATH` is set to it. `gedit_nc.py` (1,761 lines) can be split into private `_nc_*.py` modules with no user-visible change. | `src-tauri/src/scripts/discovery.rs:14, 54, 287`; `runner.rs:9-10, 656`; `src-tauri/tauri.conf.json` (`bundle.resources`) |
| F38 | `state.rs` rewrites `state.json` preserving members it does not know, so a Rust-owned `session` member can live beside `recent` and `ui`. | `src-tauri/src/state.rs:50-70` |
| F39 | A panel region with two panels renders a tab strip; the inspector can share the left region with the Program Map. | `src/lib/components/shell/PanelHost.svelte:1-8, 36-47` |
| F40 | The script context carries the resolved profile and the database slice (`codes.forScripts(profileId)`); Python never needs to resolve `extends`. | `src/lib/core/scripting/context.ts:101-124` |
| F41 | The Fanuc syntax notes were written from the 18i-T and 31i lathe manuals **in G-code system B**; their turning example is system A; §4.1 tabulates A, B and C; open question 6 is "system A or B?". | `docs/planning/syntax/syntax-fanuc.md:5, 73-93, 240-259, 573` |
| F42 | `M98 Q<n>` runs blocks from `N<n>` in the **current** program (general availability marked verify). `M99 P` in a subprogram returns to a block of the caller. | `syntax-fanuc.md:327-328, 478` |
| F43 | Harness runs need an unlocked screen; a locked one BLOCKs every input scenario. Check with `ioreg -n Root -d1 \| grep -q 'CGSSessionScreenIsLocked[^,}]*Yes'`. | `tests/runtime/README.md:16-26, 64-100` |
| F44 | `tauri-plugin-single-instance` is not in the local registry (network needed); macOS "open with" arrives as `RunEvent::Opened`. Relevant only to the deferred OS file associations. | `ls R`; `R/tauri-2.11.5/src/app.rs:263-266` |
| F45 | The Windows CI failure (`STATUS_ENTRYPOINT_NOT_FOUND` in the lib's unit-test executable) is diagnosed; the fix is commit `c18fba2` on `fix/windows-test-manifest` (not pushed, not yet run on Windows): on Windows MSVC `build.rs` has the linker embed `windows-app-manifest.xml` into every linked target and calls `tauri_build::try_build` with `WindowsAttributes::new_without_app_manifest()`. macOS fmt/clippy/test pass. `c18fba2`'s parent is `main` @ `21091a0`, so `feat/phase-2` can start at `c18fba2` with no merge commit, and a later fast-forward of `main` keeps one history. | `git log fix/windows-test-manifest`; `git merge-base main fix/windows-test-manifest`; the W0 diagnosis notes (in `SP`) |
| F46 | The form engine has no list field: `FieldType` is `number`, `integer`, `text`, `bool`, `choice`, `file`, `folder`, `address-list`. `scripts.folders` is rendered by the settings dialog's own add/remove control (`LIST_KEYS`), `editor.rulers` is file-only, and `merge.ts` names their element types in `LIST_KIND` and takes a list whole or not at all. One machine's parameters fit the existing types (text, choice, bool). | `src/lib/core/forms/types.ts`; `src/lib/components/dialogs/SettingsDialog.svelte` (`LIST_KEYS`, the list control); `src/lib/core/settings/merge.ts` (`LIST_KIND`, `accept`) |
| F47 | `settings.json` is flat dotted keys holding only non-default values plus `"$version": 1`; unknown keys are kept; the dialog's pages come from `SETTING_FIELDS` categories and a page without rows is dropped (`pagesOf`). Rust owns the file: `read_json_object`/`save_json_object` in `config.rs` enforce the 1 MiB cap, atomic write (`atomic.rs`), the `.bak` rescue, "newer `$version` is read, never written", and stamp `SETTINGS_VERSION`, a constant shared with `state.json`. `config_load` is the one startup round trip; `settings_open_file` grants only that one file. | `src/lib/core/settings/{schema,merge,migrate}.ts`; `src/lib/stores/settings.ts`; `src-tauri/src/config.rs` (`SETTINGS_VERSION`, `MAX_FILE_BYTES`, `read_json_object`, `save_json_object`, `config_load`, `settings_open_file`); `src-tauri/src/atomic.rs` |
| F48 | Phase 1 already treats a number written without a point as a count of increments on Fanuc: `syntax.decimalPointSignificant` (Fanuc `true`, Klartext `false`) makes `formatNumber`/`format_number` keep a point-less value point-less, and `scale_feed`/`scale_speed` drop a fixed decimal count for such a value (`format_for`). The limits `minFeed`, `maxFeed`, `onlyAbove`, `onlyBelow` compare the value **as written**. Nothing converts a point-less value to millimetres. | `src/lib/core/nc/numberFormat.ts` (header, `formatNumber`); `src/lib/data/profiles/{fanuc-gcode,heidenhain-klartext}.json`; `src-tauri/resources/scripts/scale_feed.py` (`Params`, `format_for`, `clamp`) |
| F49 | Every NC consumer looks the profile and database up by `doc.profileId`: transforms, scripts, the outline service, block navigation, hover, completion and the grammar registration. Hover and completion are registered per Monaco language (= profile id) and can find the document through `docIdOf(model)`. The grammar reads only the database's `addresses` and its non-numeric word codes; numeric G/M codes have a rule of their own. | `src/lib/app/transforms.ts` (`run`); `src/lib/app/scripts.ts` (`buildContext` call); `src/lib/app/outlineService.ts` (`profileOf`, `compiled`); `src/lib/contrib/navigation.ts`; `src/lib/monaco/providers/{hover,completion,symbols}.ts`; `src/lib/monaco/languages.ts` (`registerAll`); `src/lib/core/grammar/shared.ts` (`addressNames`, `wordCodes`) |
| F50 | `ScriptContextV2` is `{ contract: 2, document, input, cursor, params, profile, codes }`, built by the pure `buildContext`; Python reads it with `gedit_nc.load_context()`, which answers `{}` for a v1 start, and bundled scripts fall back to defaults. A new member is therefore additive: `contract` stays 2. | `src/lib/core/scripting/{types,context}.ts`; `src-tauri/resources/scripts/gedit_nc.py` (`load_context`) |
| F51 | `tests/unit/fixtures.test.ts` requires the `WRITTEN FOR GEDIT` marker and a README line for every file under `tests/fixtures/nc/**`, and the outline and detection tests walk the same tree. A local real-program folder must therefore live outside `tests/fixtures/`, and owner-approved public programs need an explicit exemption from the marker (not from the README line). | `tests/unit/fixtures.test.ts`; `tests/unit/helpers/fixtures.ts` (`listFixtures`); `tests/fixtures/README.md` |
| F52 | Reading a number without a decimal point is machine-dependent on every control the owner uses. Fanuc: `X50` read as 50 mm and a cycle `Q6000` as 6 mm on the same source machine, so the reading depends on the address and on a machine parameter (verify per machine). Okuma OSP-P200L: a unit parameter selects 1 µm, 10 µm or 1 mm (metric) or 1/10000 in or 1 in, and the unit applies to **every** numeric literal, with or without a decimal point (10 µm: `X0.1` = 0.001 mm, `X1000` = 10 mm, `F23.456` = 0.23456 mm/rev; 1 µm: `F234.56` = 0.23456 mm/rev; 1 mm: `X1` = `X1.0` = 1 mm); its unit table gives different values per address class (lengths, feed per revolution, feed per minute, angles, dwell time; `S` always whole units), and angles and times keep their unit in the inch systems. `syntax-okuma.md` §3.3 simplifies this to "numbers without a decimal point" and is corrected in M8 (WP8.3). Sinumerik: whole numbers are whole units (verify). Heidenhain Klartext: values are mm or inch as written. | `syntax-fanuc.md` §3.2; `syntax-okuma.md` §3.3 (and the OSP-P200L programming manual, section 2-3, owner's copy); `syntax-sinumerik.md` §3.3; `src/lib/data/profiles/heidenhain-klartext.json` |
| F53 | Sinumerik `DIAMON`/`DIAMOF`/`DIAM90` form their own modal group (29) and switch diameter programming in the program; Okuma resets to `G90` and `G95`; the Fanuc power-on state is parameter-dependent and `G20`/`G21` keep the last state. | `syntax-sinumerik.md` §4.2; `syntax-okuma.md` §4.1; `syntax-fanuc.md` §4.2 (units row), §4.5 ("Power-on defaults") |
| F54 | **`setHiddenAreas` is not public API and fails on large models.** It is absent from `editor.api.d.ts`; it exists on `CodeEditorWidget` and Monaco's own diff editor uses it to hide unchanged regions. When a model is "too large for tokenization" the view model is `ViewModelLinesFromModelAsIs`, whose `setHiddenAreas` **returns `false` and does nothing**. The exact condition is `bufferTextLength > 20 MB` **or** `bufferLineCount > 300,000`, and only when `creationOptions.largeFileOptimizations` is true — the default, and gEdit creates its models with no options (`editorService.ts:281`). So the practical threshold is **over 300,000 lines** (or over 20 MB): a 10 MB program is under the size limit and fails only if it also passes the line count. Showing one channel per pane by hiding the other channels' lines would therefore work on an ordinary program and silently stop working on a long posted one. The one escape hatch was checked and rejected: `largeFileOptimizations: false` at model creation restores `setHiddenAreas`, at the price of tokenizing a file Monaco deliberately gives up on — a per-line cost on exactly the documents that are already the slowest. | `NM/monaco-editor/esm/vs/editor/editor.api.d.ts` (no `setHiddenAreas`); `…/browser/widget/codeEditor/codeEditorWidget.js:469-470`; `…/browser/widget/diffEditor/features/hideUnchangedRegionsFeature.js`; `…/common/viewModel/viewModelImpl.js:50-51`; `…/common/viewModel/viewModelLines.js:841-843`; `…/common/model/textModel.js:117-118, 202-204`; `src/lib/monaco/editorService.ts:281` |
| F55 | View zones and scroll sync **are** public: `IViewZone` (`afterLineNumber`, `heightInLines`/`heightInPx`, `domNode`, `showInHiddenAreas`), `IViewZoneChangeAccessor.addZone/removeZone/layoutZone`, `editor.changeViewZones()`, `onDidScrollChange`, `getScrollTop`/`setScrollTop`/`setScrollPosition`. Aligning panes with filler space and locking their scrolling needs no private API. | `editor.api.d.ts:5441-5509` (`IViewZone`), `:5510-5525` (`IViewZoneChangeAccessor`), `:6365` (`changeViewZones`), `:6112` (`onDidScrollChange`), `:6211-6225` (`getScrollTop`, `setScrollTop`, `setScrollPosition`) |
| F56 | **gEdit has exactly one code editor, and a second instance is not free.** `editorService` is written for "one `IStandaloneCodeEditor`, one model per document"; `EditorHost` creates that one editor and `EditorService.editorInstance()` returns a single instance. The only second Monaco widget is the compare diff editor, and its header records the two traps a further instance inherits: every *editor* option handed to a second widget goes into the **shared** standalone configuration service, and passing `theme` calls `themeService.setTheme()` globally. Each editor also builds its own view model: with wrapping on, one `ModelLineProjection` per model line, plus its own cursor controller, view layout and DOM. N panes over one 300k-line model therefore cost roughly N× that per-line view state on top of the single model. | `src/lib/monaco/editorService.ts:1-20, 382, 629-638`; `src/lib/components/editor/EditorHost.svelte`; `src/lib/app/types.ts` (`EditorService.editorInstance`); `src/lib/monaco/diff.ts:1-27`; `NM/monaco-editor/esm/vs/editor/common/viewModel/viewModelImpl.js:44-66`; `…/viewModelLines.js:17-70` |
| F57 | **gEdit cannot look into a folder.** `capabilities/default.json` grants `fs:allow-read-file` and `fs:allow-write-file` only — no directory permission — and §4 forbids changing that file in Phase 2. The one Rust file command, `files_stat`, takes explicit paths and answers only for paths `fs_scope().is_allowed` accepts. A dialog pick grants each picked file (P1 F3) and the fs plugin grants every dropped path before the event reaches JS (P1 F2). So a sibling channel file next to an open document is **not** readable, and not even stat-able, until the user picks or drops it. | `src-tauri/capabilities/default.json`; `src-tauri/src/files.rs:42-45`; §4 of this plan; `src/lib/contrib/files.ts:133-142`; P1 §7.6, F2, F3 |
| F58 | A report row or finding may name a **document**: `Located.document` wins over the report's `docId`, and the Results panel resolves it against the open documents and jumps there. A check that spans several documents therefore needs no new panel. | `src/lib/app/types.ts` (`ReportData`, `Located`); `src/lib/components/panels/ResultsPanel.svelte:16-47, 197-207, 298, 325` |
| F59 | `OutlineItem` already carries `children` and `endLine`, so a grouped map costs no new type; `OutlineKind` is a **closed union** (`tool`, `program`, `section`, `comment`, `label`, `stop`, `end`, `subprogram-call`) that profile validation also uses for `profile.outline[].kind`, so a new kind must be rejected in a profile's own rules. `OutlineIndex` is per document and splices one slot per changed line. | `src/lib/core/profiles/outline.ts:45-56, 291-340`; `src/lib/core/profiles/types.ts:29, 155, 188` |
| F60 | A script sees **one** document: stdin is the resolved scope of the active document and `ScriptContextV2.document` describes that file. Multi-document script input is P1 D16 and stays deferred (§11). A check that has to compare two channel *files* therefore cannot be a Python script; a new member of the context is additive and keeps `contract: 2` (F50). | `src/lib/core/scripting/context.ts:84-126`; `src/lib/core/scripting/types.ts`; §11 item 11 |
| F61 | The syntax notes **deliberately leave multi-channel coordination out** on all three controls, so gEdit has no verified sync-code facts to ship: Fanuc "Multi-channel synchronization" is under "Deliberately excluded"; Okuma lists "Two-turret synchronization: `G13`/`G14`, `P` sync codes, `M100`" and the address `P` "Synchronization code between turrets" as tokenized only; Sinumerik lists "multi-channel coordination (`WAITM`, `WAITE`, `SETM`)" as tokenized only. The roadmap's "Not planned" list excludes "machine-specific multi-channel sync code sets". | `syntax-fanuc.md:32`; `syntax-okuma.md:34, 301`; `syntax-sinumerik.md:39`; `roadmap.md:129` |

---

## 2. Scope decision and exit criteria

### 2.1 Roadmap Phase 2 rows

**In** = built in Phase 2. **Lean** = built, smaller than the spec (what is left out is named). **Deferred** = moved to a later phase — Phase 3 "Understand and write" or Phase 4 "Comfort and geometry" (the third revision) — or to the backlog. **Cut** = no plan to build it.

| Roadmap Phase 2 item | Decision | M | Reason |
|---|---|---|---|
| Real programs read right (not a roadmap row; the third revision, D69, proposed) | **In**: the Sinumerik milling profile (R2), 5-axis and high-speed codes with the two database flags (R3), the remaining tokenizer rules (R4), the per-machine `U`/`W` and `T` split (R6), the values-read-wrong items of TODO "NC correctness", the detection leftovers, G11 as a real test | M9 | Every later feature reads values; R2, R3, R4 and R6 were accepted by the owner on 2026-09-27. |
| User profiles with `extends` | **In**: built-in children (M6), user files (M13) | M6, M13 | The lathe child needs `extends` now; user profiles give per-machine folders, numbering and builder M-code tables. |
| Machine configurations (not a roadmap row; owner decision of 2026-09-22) | **In**: model, `machines.json`, the status-bar choice, the Settings ▸ Machines page, number input, unit, G-code system, diameter and power-on modes, the script context (M6); per-file memory (M7); Okuma and Sinumerik parameters (M8); the `U`/`W` and tool-word variants and the corrected presets (M9); checks, extents and address arithmetic (M10); compare (M11); channels and sync marks (M12, AD-32); import/export (M13). **Deferred**: the inspector, hover and the TS interpreter reading them (Phase 3) | M6–M13 | Number input, G-code system and power-on state depend on the machine's parameters, for Fanuc and Okuma alike (D23, D24, D34); hardcoding them per dialect would misread programs silently. AD-31. |
| Multi-channel programs (a roadmap **backlog** row, pulled forward on the owner decision of 2026-09-22) | **In, staged**: the channel layout and the sync marks as machine parameters, channel resolution (a channel may hold several sections), the wait-code check, program map and tool list per channel, the channel status item, sync-point navigation, assigning a document to a channel by hand, a one-way split into channel documents (M12); the script context and the Python API (M12). **Deferred**: the side-by-side channel view and the merge back from a split (Phase 4, §11 item 27) | M12 | The owner's twin-turret and sub-spindle lathes are their daily work, and a wait code that does not match is the mistake that stops a machine. The check, the per-channel map and sync-point navigation need no new editor; the parallel panes do (F54–F56). |
| Profile editor with pattern tester | **Lean**: the JSON opens in a tab, the app validates it with JSON paths, and **"Test profile on this document"** reports what every rule matched on each line (a pattern tester in the Results panel) | M13 | The form-generated editor and live preview are a long settings page for a rare task. |
| Editing options | **In**: `forceUppercase`, `preventLineJoin` | M13 | They prevent shop-floor typos. Per-profile `tabWidth`/`rulers`/`completion` deferred. |
| Load and save formatting | **Deferred** | – | CAM output is saved as posted; Phase 1 keeps bytes; silent reformatting conflicts with "never corrupt a program". |
| Per-profile colors | **Deferred** | – | Cosmetic; the generated themes distinguish roles. |
| Fanuc lathe child profile | **In, first**: one `fanuc-lathe` profile; G-code system A or B is a machine parameter that selects the database (`fanuc-lathe` or its child `fanuc-lathe-b`) | M6 | Owner decision: lathes first; the system is a machine setting (D23). |
| Sinumerik and Okuma OSP profiles, grammars, code databases | **In**: turning — `okuma-osp` (OSP-P200L), `sinumerik` (840D turning) (M8); Sinumerik milling as the built-in `sinumerik-mill` (M9, R2) | M8, M9 | Those are the owner's machines, and five of the six published Siemens programs are milling posts. Okuma milling waits for a programming manual of the machining-centre control (R9). |
| Modal interpreter (TS + `gedit_nc.py`) | **In**: Python (M6), with the Klartext defined-cycle state (M9). **Deferred**: TS to Phase 3 (P3.1), against the same golden set | M6, M9 | The scripts need Python now; the TS interpreter's consumers (the inspector, hover) moved to Phase 3. |
| Renumber advanced options | **Deferred**, except `keepReferenced` for remove-block-numbers | M6 | Fit-to-max, align column, every Nth, start triggers: rare in CAM output. |
| Reference-aware renumbering (roadmap P3) | **Pulled forward** (local numeric references) | M6 | A lathe `G71 P100 Q200` breaks on every renumber today; P1 only warns. |
| Block skip insert/remove | **In** | M10 | Small, core, common for prove-out sections. |
| Insert / remove text by rule; batch replace | **Deferred** | – | NC-aware replace-all with a count covers the common cases; good first contributed scripts. |
| Address arithmetic | **In**, with R8's smallest version (proposed) | M10 | A Z shift after a chuck or stock change is a daily lathe task; incremental `U`/`W` must be refused, which needs M6's profile data and M9's `U`/`W` choice; a cycle depth it cannot judge is refused and listed. |
| Character cleanup | **Cut as a script**; non-ASCII and over-long blocks become **program-check findings** | M10 | Reporting is what matters; transliteration tables are configuration surface. |
| Split by tool; join programs | **Deferred**; tool-segment **select** is in | M10 | Select + copy covers the manual path. |
| Extents; program checks | **In** | M10 | Cheap sanity checks without a backplot; lathe-aware. |
| Combined tool list | **Deferred** | – | Needs multi-document script input (P1 D16). |
| Hover with cycle parameters and modal context | **Deferred** to Phase 3 (P3.3), design kept | Phase 3 | Uses the TS interpreter; it helps understanding, not safety (third revision). |
| Code inspector panel; edit values | **Deferred** to Phase 3 (P3.2), design kept — lean: current block, modal state at the cursor, edit one value; no template list inside it | Phase 3 | As hover; templates, when they come, live on the Insert tab and in completion. |
| Parametric templates, placeholders, file templates, templates in completion; migrate blocks | **Deferred** to Phase 3 (P3.4–P3.6), design kept; formula parameters with them in Phase 3. Until then the Insert tab keeps the Phase 1 blocks (mill and Klartext only, F34) | Phase 3 | They help writing, not checking; the lathe, Okuma and Sinumerik templates come with them. |
| NC-aware whole-address match; find-all panel; search in open documents; replace into a new document | **In**, plus the replace count (P1 §10 item 23) and word conditions (`S>2000`) | M11 | gEdit runs its own replace, so the count and one undo step come with it. |
| Next and previous NC event | **Deferred** | – | Find-all with a word condition lists the same lines with one click per hit. |
| Bookmarks v2 | **Lean**: persistence per file only | M7 | Names and a panel add UI for little gain. |
| Block range; tool segment; insert/append file | **Lean**: tool-segment select only | M10 | Block ranges and inserting files are rare for CAM output. |
| Read-only files | **In**: file attribute and a lock toggle; NUL-heavy files stay refused | M7 | Protects archive copies. |
| Backup and crash recovery | **In** | M7 | Owner decision: close the data-loss gap early. |
| OS file associations | **Deferred** | – | Needs `tauri-plugin-single-instance` (network) on Windows/Linux, claims shared extensions, and the installers cannot be tested here (D42). |
| Forced uppercase; prevent joining blocks | **In** | M13 | See editing options. |
| Bundled user guide; regex help | **Cut** (in-app guide) / **Lean** (a regex page in `docs/user`) | M11 | The guide is `docs/user`; an in-app viewer adds a reader for text the repo already has. |
| Compare ignore options via review mode | **In**; numeric tolerance **cut** | M11 | Exit criterion. Normalization cannot do a tolerance honestly: rounding misses pairs that straddle a step. Number-format normalization removes the usual noise. |
| Word-level marking | **Deferred** | – | Monaco's inline character diff already points at the change. |
| Merge in both directions; export differences; two files on disk | **In** | M11 | Merging the machine-edited copy into a re-post is real work today. |
| External commands | **Cut** | – | A header-driven script calls `subprocess.run([...])` through the tested runner (timeout, cancel, process-group kill); a second launch surface is attack surface. `docs/user/scripts.md` shows the example. |
| Full settings dialog | **Lean**: new keys in the existing pages; a Machines page (M6); a Profiles page (M13); no search box | M6, M7, M13 | Few settings. |
| Role color editor | **Deferred** | – | Cosmetic. |
| Session restore and per-file memory | **In**, including the manual dialect choice and the machine choice per file | M7 | Fixes mill/lathe and machine mix-ups once per file. |
| Profile import/export | **In**, one file at a time; machine configurations too | M13 | – |
| Phase 1 D10: Dock → Quit, logout skip the prompt | **In** (macOS) | M6 | Owner decision. |

Phase 1 deferred items (P1 §10) revisited: 3 (NUL-heavy read-only) stays refused; 4 (`documents: all-open | pick`) stays deferred with the combined tool list; 6 (user profiles and `extends`) is in, JSON Schema files are cut (hand-written validators, F6); 7 (completion mode per profile) stays deferred; 8 (load/save formatting) deferred; 13 (blocks → templates) moved to Phase 3 with the templates (third revision); 14 (session, per-file memory, bookmark persistence) in (M7), names deferred; 15 (Dock quit) in (M6); 16 (atomic saves) replaced by backup before write (M7); 19 (per-profile colors) deferred; 23 (replace count) in (M11). The rest are unchanged.

### 2.2 Phase 2 exit criteria (testable)

Each criterion is first proven by its milestone's scenarios on `tests/fixtures/nc/**`; `m13-exit-criteria` repeats X1, X2, X5, X6, X8, the user-profile half of X9, X11 and X12 in one run over `tests/fixtures/exit2/` (synthetic, assembled by H13). X13 is proven on the committed owner-public programs by WP9.6's tests, in CI. X7 and the templates half of X9 moved to Phase 3 with the inspector and the templates (third revision); their text stays here as the design they will be proven against. The owner's local programs are checked by G11 on their machine only (§9.2); the exit criteria use the committed fixtures (synthetic plus the owner-approved public files).

| # | Criterion | Proven by |
|---|---|---|
| X1 | **Fanuc lathe.** `exit2/fanuc-lathe-a.nc` and `exit2/fanuc-lathe-b.nc` open as `fanuc-lathe`; with no machine chosen the machine item shows G-code system A and B respectively, marked as detected (D23). F7/Shift+F7 visit exactly the golden tool lines: every `T` call with a non-zero station and a non-`00` offset (`T0101`, `T0111`, `T0303`), never `T0100`. The map's tool labels and the tool list's rows (grouped by station, with the offsets used) match goldens. Hover on `G71`, `G76` (threading, lead), `X` (diameter) and `U` (incremental X) match goldens. Scale feed 90 % gives the golden bytes: `G99` feeds scaled; `G32`, both `G76` blocks and `G92` passes untouched and reported. Scale speed 110 %: `G96 S` scaled, `G50 S` untouched and reported. Renumber gives the golden bytes with rewritten `G71`/`G70 P/Q`, and `M99 P` reported. On the B file: `G95` feeds scaled, `G92 S` a clamp. Each run is one undo step. | `m6-lathe-*`, `m13-exit-criteria` |
| X2 | **Okuma and Sinumerik.** `exit2/okuma-lathe.MIN` and `exit2/sinumerik-lathe.MPF` are detected by extension and by content (also as `.txt` copies). `monaco.editor.tokenize` gives no `invalid` token and the tokenizer no `unknown` token outside comments on any line. F7, the tool list and scale feed give golden results: Okuma 4- and 6-digit `T`, `G04 F` a dwell, `SB=` not the main spindle; Sinumerik `T="NAME"` and `T1 D1`, `LIMS=` a clamp, `G33` refused. With no machine chosen, the Sinumerik modal state at the first block has diameter programming **on** (assumed, profile default `DIAMON`, D35) and off after a `DIAMOF` block (Python modal goldens; the inspector shows the same in Phase 3). | `m8-*`, `test_modal.py`, `m13-exit-criteria` |
| X3 | **No lost work (macOS).** With two dirty documents, `[NSApp terminate:]` shows exactly one unsaved-changes alert; Cancel keeps the app and both documents; with none dirty it quits at once. After `h_crash`, the next start offers both documents; Restore gives the exact text, profile, machine choice, encoding and line ending, dirty, bound to the original path; a file changed on disk after the snapshot shows the external-change banner. A save leaves the previous bytes, byte-exact, in the backup history. A file with the read-only attribute opens locked, and Save goes to Save As. | `m6-dock-quit-*`, `m7-*` |
| X4 | **Session.** A restart restores the tabs, the active tab, the cursor lines, the bookmarks, a manual dialect choice and a machine choice (a machine, or an explicit "none"). | `m7-session-1/2` |
| X5 | **Compare.** `exit2/repost-old.nc` vs `repost-new.nc` (renumbered, reformatted numbers, new header comments, one real feed change and one real Z change) in review mode with the profile defaults shows **exactly two** changed lines, and "go to line" lands on the original lines. In raw mode, copying a change left→right and right→left is one undo step in each target. Export gives the golden unified diff in a new tab. Two files on disk open and compare. | `m11-compare-*` |
| X6 | **Search.** Find-all `T1` (whole address) over three open documents gives the golden rows (no `T10`, no hit in a comment); `S>2000` gives the golden rows. Replace-all `M8`→`M88` reports the golden count and is one undo step; "into a new tab" leaves the source untouched. | `m11-search` |
| X7 | **Inspector** (moved to Phase 3, third revision). At the golden lines of `nc/fanuc-lathe/l01-turning-a.nc`, the inspector's modal state (feed unit, speed unit, tool, active cycle, speed clamp, work offset, diameter mode, each with its source line; assumed values marked with where they come from: the machine, a detected variant or the profile default) equals `tests/fixtures/modal/fanuc-lathe/*`, which the Python interpreter also passes. Editing `F` in the inspector rewrites only that word, in the same number style, as one undo step. | Phase 3 (the old `m11-inspector`); `test_modal.py` for the Python half |
| X8 | **Checks and transformations.** `program_checks` and `extents` on `exit2/checks-*` return the golden findings and tables for mill, lathe, Okuma and Sinumerik, each run with the machine its golden names (with none, a word whose reading depends on the machine is listed as "not resolved" and the header says so); every row jumps to its line. Address arithmetic `Z −0.5` on the lathe fixture changes only absolute `Z` words written with a decimal point and reports the `W` words (and, with no machine, every point-less `Z`). Block skip insert/remove on a selection is one undo step each. | `m10-scripts`, `m10-arith`, `m10-blockskip`, `m13-exit-criteria` |
| X9 | **Templates and profiles.** *Templates half, moved to Phase 3 (third revision):* the "Lathe tool start" template with the golden form values inserts the golden text with continuing block numbers, as one undo step, from the Insert tab and from completion. *User-profile half, M13:* a user profile `extends: fanuc-lathe` with a folder rule and step 5 in `<config>/profiles/` is loaded; a file in that folder opens with it and renumbers in steps of 5. A broken user profile is reported with its JSON path and skipped. A user code file adds a builder `M13` whose hover text appears. A machine configuration whose base profile is `fanuc-lathe` is offered for, and applies to, a document of that user profile. | `m13-user-profile`, `m13-exit-criteria` (the templates half: Phase 3, the old `m12-templates`) |
| X10 | **No regression.** Every Phase 1 scenario, including `m5-exit-criteria` and `m5-exit-criteria-nopython`, still passes, changed only for a milestone's listed intentional changes. Every fixture round-trips byte-exact. CI is green on macOS, Windows and Linux, including the Windows Rust unit tests (W0). No machine chosen reproduces Phase 1 behavior on every Phase 1 fixture (the profile defaults of `fanuc-gcode` and `heidenhain-klartext` equal the P1 settings), and a machine without a `channels` block leaves the program map, the outline, the status bar and the script context exactly as they are (X12 c). | cumulative suite `m0`–`m13`, CI |
| X11 | **Machine configurations and how numbers are read.** (a) In Settings ▸ Machines, adding "Lathe IS-B" (`fanuc-lathe`; numbers without a point: increments of 0.001 mm; G-code system B; power-on feed mode `G95`) and duplicating it as "Lathe calc" with calculator-type input writes both to `<config>/machines.json` (`"$version": 1`, written atomically); both are listed after a restart; Edit, Remove and "default for its profile" work. A hand-broken `machines.json` gives a start with no machines, one notice and a Machines page whose write actions are disabled, offering only "Open machines file" and "Replace with an empty file" (the broken file survives as `machines.json.bak`); a file with a higher `$version` is read and never written. Editing `machines.json` in gEdit and saving it reloads the machines at once, so a per-class value added by hand survives the next page action. (b) On `exit2/decimal-lathe.nc` the status item reads "Machine: none" with the assumed marker, and its tooltip lists every effective parameter with its source; picking "Lathe IS-B" changes it, a restart (M7) brings it back for that file, and "None" returns to the profile defaults. (c) Under "Lathe IS-B": address arithmetic `Z −0.5` turns `Z1000` into `Z500` and `Z10.` into `Z9.5`; `program_checks` reports `X50` as "no decimal point: 0.050 mm on this machine"; hover on `X50` says 0.050 mm. Under "Lathe calc": `Z1000` → `Z999.5`, no finding, hover 50 mm. **With none** (the lathe's profile default is calculator type, D56, but the machine decides): address arithmetic leaves `Z1000` unchanged and reports it ("the reading depends on the machine; choose a machine"), while `Z10.` still becomes `Z9.5`; the inspector refuses to edit `Z1000` with the same reason; hover, the inspector and the check list every reading of the profile's presets, the assumed default first ("50 mm as written (calculator, profile default), 0.050 mm (IS-B), 0.0050 mm (IS-C)"). Scale feed 90 % gives the golden bytes under both machines and under none (`F155` → `F140`: every Fanuc preset reads feeds as written, so the limits still compare). (d) A user script in `scripts.folders` that reports `gedit_nc.machine_params(ctx)` shows the effective values and their sources in each case. (e) **The explicit choice wins:** on `exit2/fanuc-lathe-b.nc` with a machine set to system A, the tool list, scale feed and hover follow system A, and one status warning names the mismatch; nothing switches by itself. The hover and inspector parts of (c) are proven with X7 in Phase 3 (the old `m11-hover`); in Phase 2 address arithmetic and the program check carry (c). | `m6-machines-*`, `m7-session-1/2`, `m10-scripts`, `m10-arith`, `m13-exit-criteria` |
| X12 | **Channels and wait codes.** (a) **Single file, the plain case.** With the machine "Twin 31i" (channels `1`/`2` with the aliases the fixture's patterns use, layout `single-file`, a user-written section-start pattern, one blocking `rendezvous` rule "prefix `M1`, two digits, **all** channels"), `exit2/twin-single.nc` — whose two channels **alternate over four sections** and share a subprogram between them — shows the channel item "Channel 1 of 2"; the program map has two channel rows, each carrying the tools of **both** of its ranges, its sync marks as `sync` rows, and one "Outside the channels" group holding the header and the shared subprogram; the tool list reports a **Channel** column with the golden rows; "Check wait codes" returns exactly the golden findings — one id whose ordinal partner is missing in channel 2, one id whose counts differ between the channels, one pair out of order, one blocking wait with no counterpart — while the ids that legitimately repeat in both channels produce **none**, and every row jumps to its line. Next/previous sync point walks the marks of the channel at the cursor across both of its sections; "Go to the matching mark" lands on the golden line in the other channel. "Split into channel documents" opens two untitled documents whose golden text carries the program header and every range of that channel, warns that it is a one-way copy, and writes nothing to disk. (a2) **Single file, the partner-from-the-line case.** The same fixture with the machine "Twin 31i lines", whose rule reads the partners from the line (`M1\d\d P<channels>`), adds the golden finding **"a mark names a channel the machine does not have"** — which an `all`-partner rule can never produce, since its partner set is the machine's own channel list. (b) **Several files.** With "Twin 31i multi" (layout `multi-file`, file-name pattern with a `channel` capture), `exit2/twin_CH1.nc` alone shows "Channel 1 of 2 — channel 2 found, not open" and the channel pick offers "Open channel 2…" in the document's own folder; opening it through the file dialog and running the same check gives the golden findings across the two documents, each row jumping into the right document. The sibling is checked under **the initiating document's** machine whichever machine it carries itself: opened with the profile's default machine (which has no channels) it still contributes its marks, and the report header names it and offers "use this machine for channel 2". With channel 2 absent from the folder the item says "not found" and the check reports the channel as not checked. A pair the patterns do not describe is tied together by hand ("Assign this document to channel 2") and the assignment survives a restart. (c) **Nothing else changes:** with no machine, with a machine that has no channels, or on a document whose name or content matches no channel rule, the channel item is hidden, the map is the P1 map and every earlier scenario passes unchanged. (d) A machine whose channel or sync pattern does not compile has its **channel block** reported on the Machines page and dropped to `layout: 'none'`, survives the next save byte-stable, **and stays selectable with every other parameter in force**: the same document's number reading, hover and address arithmetic under that machine are byte-identical to the run with a valid channel block. | `m12-*`, `m13-exit-criteria` |
| X13 | **Real programs.** Every committed owner-public program (`tests/fixtures/nc/owner-public/**`) detects as its folder says; has no `unknown` token outside comments, or each remaining one is listed with a reason in `tests/fixtures/expected/owner-public/known-gaps.json`; its program map matches its golden (the known gaps empty, or each documented there); and scale feed and scale speed at 100 % give back every byte. On the owner's machine G11 reports the same aggregates for `tests/real/`, counts only (§9.2, standing rule 12). | `tests/unit/ownerPublic.test.ts`, `tests/python/test_owner_public.py`, `m9-detect`, G11 |

**Phase 2 is done when:** `m13-exit-criteria` (X1, X2, X5, X6, X8, the user-profile half of X9, X11, X12) and `m13-exit-criteria-nopython` (detection, navigation, renumber, compare, search, the machine choice and the whole of X12 except the tool list's channel column, with `GEDIT_PYTHON=/nonexistent`) pass; X13 holds (its committed tests pass in CI, and G11 reports its aggregates on the owner's machine); the cumulative suite `m0`–`m13` passes on macOS (every scenario PASS, 0 CSP violations, 0 unexpected console errors); the G10 sign-off exists for all six built-in profiles (`fanuc-gcode`, `fanuc-lathe`, `heidenhain-klartext`, `okuma-osp`, `sinumerik`, `sinumerik-mill`), their machine-parameter declarations and every built-in database (the `fanuc-lathe-b` variant included), **and records that no built-in declares a sync preset** (§8.9); and the owner confirms the 1.0 release bundles (§5.3) on all three platforms.

---

## 3. Architecture decisions

**AD-16: Profile inheritance (`extends`).**
- A profile may name a parent with `extends`. `resolveProfiles(sources)` (§7.1) merges each child over its **resolved** parent: plain objects merge key by key, recursively; arrays, scalars and `null` replace; `$schema` is dropped; `extends` is kept on the result for display.
- The child must set its own `id`, `name` and `shortName`; a child that would inherit them is reported.
- Parents resolve before children whatever the source order. Unknown parent, cycle, depth > 4, or a user id equal to a built-in id → a problem with the file and JSON path, and that source is skipped. A built-in may extend only a built-in; a user profile may extend either.
- Resolution runs **before** validation (F20). The merged object goes through the P1 validator (extended only for the new fields of §7.1) and the compiler, so a child is checked exactly like a built-in.
- `BUILTIN_PROFILE_JSON` becomes the list of **resolved** built-ins, so every P1 test that iterates it covers the lathe profile too.
- Scripts receive the resolved profile through the P1 context (F40); Python never resolves anything.
- Detection tie-break (P1 AD-11): `priority`, then user over built-in, then the current or default profile.
- The pure `mergeProfile`/`resolveProfiles` are implemented by P6 (§5 rule 2).

**AD-17: Code-database inheritance.**
- A database file may name `extends` (a parent dialect id) and `remove` (parent codes it does not have). The child's entries **replace** the parent's by normalized code (whole entry, not a field merge: easier to review); addresses override by letter; aliases are re-checked after the merge; `templates` (Phase 3, P3.4) override by id.
- Hover, completion, the inspector and the script context all see the resolved database.
- `tests/unit/resolved.test.ts` writes the resolved built-ins to `tests/fixtures/resolved/{profiles,codes}/<id>.json` (`UPDATE_RESOLVED=1` rewrites, otherwise it compares). Python tests and the NC review read those files, so there is exactly one merge implementation.
- Additive: a database without the new fields still loads (`version` stays 1).

**AD-18: The Fanuc lathe is one child profile described by data only.**
- `fanuc-lathe` extends `fanuc-gcode`. Its machine parameter `gcodeSystem` (AD-31) has the choices A and B: A uses the database `fanuc-lathe` (extends `fanuc`), B the database `fanuc-lathe-b` (extends `fanuc-lathe`) plus a small profile overlay (the power-on feed mode `G95`). The G-code system is a machine setting (D23), not a second profile: the grammar, the patterns and the numbering are the same for A and B, only the meaning of codes differs. System C stays out (§11). §8.1, §8.2.
- New profile fields (§7.1): `machineType` (`mill` | `lathe`), `modal.initial`, `addresses.incremental` (`U`→`X`, `W`→`Z`), `addresses.diameter` (`X`, `U`), `addresses.angular`, `toolCall.ignore`, `numbering.references[].rewrite`, `machineParams` (AD-31).
- Turret tool changes are **patterns only**: the trigger fires on a `T` word of one to four digits; `toolCall.ignore` rejects an offset cancel (`T0100`, `T100`, `T0`); the `tool` group captures the station (`T0101`→`01`, `T101`→`1`, `T0111`→`01`). As in Phase 1 (F23), every tool line is a tool item, so a repeated `T0101` or an offset change `T0111` starts a new map segment (one per CAM operation, D25); the tool list groups rows by station and lists the offsets used.
- The mill profile loses its `G70–G73` rule (F22), gains mill markers for detection (`M6`, `G43 H`, `Y` words, `G17`) and `detect.priority: 1`, so a tie stays a mill. Profile detection only decides "Fanuc lathe"; which system a program is written in is decided by the variant's own `detect` rules (A: `G50 S`, `G98`/`G99`; B: `G92 S` clamp, `G94`/`G95` with lathe markers, `G77`–`G79`), and only when no machine is chosen (AD-31).

**AD-19: One modal interpreter, driven by data, in both languages.**
- State (`ModalState`, §7.4): the active code per modal group with its source line and an `assumed` flag; the derived units (`feedUnit`, `speedUnit`, `distance`, `units`, `plane`); the last tool, feed, speed and speed clamp with their lines; the active cycle; the pitch flags; the flags of the block just applied.
- Rules, binding for TS and Python, all read from the code database and the profile (no dialect names in code):
  1. A `modal` entry becomes the active code of its `group`; its `sets` (§7.2) update the derived units.
  2. `sets.cycle: 'start'` on a `modal` entry makes it the active cycle; on a non-modal entry (Fanuc lathe `G70`–`G76`) it applies to its own block only. `sets.cycle: 'cancel'` clears the active cycle.
  3. A `motion` entry without `sets.cycle` clears the active cycle, unless it carries `pitchFeed` (`G32`, system-A `G92`), in which case it becomes the active cycle with a pitch feed until the next motion code. This is Phase 1's behavior, now stated.
  4. `sets.speedLimit` makes **this block's** `S` a clamp (it updates `speedLimit`, not `speed`).
  5. `addresses.feedUnitWords` switch the feed unit by word (Klartext `FU`/`FZ`); a plain `F` returns to the unit the modal group gives.
  6. `fNotFeed` (M8) makes the block's `F` a time, not a feed (Okuma `G04 F`, Sinumerik `G4 F`).
  7. A tool line (trigger, not `ignore`, per the profile) sets `tool`.
  8. `reset()` applies the **effective** profile's power-on state (AD-31: the machine's values over the profile's): `modal.initial`, `modal.units` and `modal.diameter`, each with `assumed: true`, line 0 and `from` taken from `modal.sources` (`'machine' | 'detected' | 'profile'`, §7.15 `ParamSource`; a value that comes from a variant overlay carries the variant's source). Nothing else is assumed (a group is `unknown` until set), with one exception: a database that declares **no** `sets.distance` anywhere (Fanuc G-code system A, which has no `G91`, and Klartext) gives `distance: 'absolute'` — not assumed, it is the only reading the database allows; the incremental words are `addresses.incremental` (`U`/`W`) and the Klartext `I` prefix. A database with distance codes keeps `unknown` until one is set.
  9. An unknown code changes nothing.
  10. `sets.diameter` (Sinumerik `DIAMON`/`DIAMOF`/`DIAM90`) switches the diameter mode; `sets.units` switches the units, and with them the metric or inch unit of the `length` and feed classes (AD-31; the `angle` and `dwell` classes do not follow `units`).
  11. Whether a word of `addresses.diameter` is a diameter or a radius value in a block follows the diameter mode: `on` = diameter, `off` = radius, `absolute-only` (`DIAM90`) = diameter while `distance` is absolute and radius while it is incremental. Every consumer that compares, converts or explains such a value (extents, address arithmetic, hover, the inspector) uses this answer, never the mode alone.
- The interpreter never reads machine configurations: everything machine-specific arrives through the effective profile, so the goldens pin a behavior by naming the machine parameters they run with (§7.4).
- **Python first** (M6, `_nc_modal.py`), because the lathe scripts need it. `FeedModeTracker` stays as a thin wrapper with its P1 attribute values (P1 §7.10 unchanged for user scripts).
- **TS in Phase 3** (P3.1, `core/nc/modal.ts`; M11 before the third revision), passing the same goldens in `tests/fixtures/modal/**`. `ModalIndex` keeps a snapshot every 1,000 lines; an edit drops the snapshots at and after its first line; `stateAfter(line)` replays at most 999 lines and rebuilds the rest in idle chunks of ≤ 16 ms. No worker (P1 AD-12 reasoning).
- The P1 inferences (cycle start by `params`, `G94` at the top) move into data in P6 (`sets.cycle` on every existing cycle entry, `modal.initial.feedmode: G94` on the mill profile), so the Phase 1 goldens stay unchanged; semantic corrections found on the way go to the G10 list.

**AD-20: The macOS quit path.**
- `src-tauri/src/quit.rs` (the only file with Objective-C `unsafe`, `#[cfg(target_os = "macos")]`): at setup, `install` reads `[NSApp delegate]`, takes its class (not a hard-coded name), and, if the class does not already respond to `applicationShouldTerminate:` (a later tao may add it), adds it with `class_addMethod(cls, sel, imp, "Q@:@")` (F26, F28). It then re-assigns the same delegate so AppKit refreshes any cached selector checks. Any failure is logged and leaves Phase 1 behavior.
- The handler reads `QuitGuard.dirty`: clean → `NSTerminateNow` (Dock → Quit, logout and shutdown are not interrupted); dirty → `NSTerminateCancel`, and `menu::request_quit` is scheduled with `run_on_main_thread`, which runs the existing guarded close (F27): one combined unsaved-changes alert.
- The webview reports "any document dirty" through `quit_guard_set_dirty` on every flip (`contrib/quitGuard.ts`), and sets it to `false` in `files.onWillQuit` after the user's decision. The final `destroy()` ends the loop with `stop:` (F27), so the hook is not re-entered.
- A logout with a dirty document is cancelled by macOS ("gEdit cancelled logout") after gEdit asks; the user answers and logs out again (D27). `NSTerminateLater` is not used: whether the webview's IPC runs in the modal-panel run-loop mode is unverified.
- Windows and Linux cannot veto a session end (F29). There the recovery snapshots (AD-21) are the protection, and the user guide says so (D28).

**AD-21: Backup before write; recovery by snapshots.**
- **Backup.** Documents are still written in place (P1 AD-7: file identity and ACLs on shares). `fileOps.save` calls Rust `files_backup(path)` immediately before writing an existing file. It requires `is_allowed(path)`; Rust reads `files.backup` and `files.backupCount` from `settings.json` itself (the AD-8 pattern).
  - `history` (**default**): `<data>/backups/<fnv32 of the folder>/<name>/<UTC yyyymmdd-hhmmss.mmm>-<name>`, keeping `backupCount` (default 5) per file. Shop folders stay clean; DNC and CAM folder watchers never see extra files.
  - `sibling`: `<path>.bak`, overwritten; refused when that path is a symlink or a directory.
  - `off`.
  - A failed backup asks "Save without a backup?" / Cancel; it never blocks or proceeds silently.
- **Recovery snapshots.** With `files.recovery` on, every dirty document whose version changed since its last snapshot is sent at most every 30 s, and at once on window blur and on `visibilitychange`, from an idle callback (never on the keystroke path). The text goes as a raw body (F30) to `recovery_put`, with metadata (path, title, profile, encoding, BOM, EOL, NUL info, the document's **disk stamp**, time) in a header. Rust writes `<data>/recovery/<session>/<key>.{txt,json}` atomically; folders are 0700 on Unix.
- **Liveness.** At start Rust creates a session folder and a thread touches `<session>/alive` every 30 s. A session whose `alive` is older than 120 s is a leftover, so a second running gEdit is never offered as a crash. No single-instance plugin is needed.
- **Clearing.** An entry is dropped on save, close and discard. The current session is cleared in `files.onWillQuit`, after the user's quit decision, **never** on `RunEvent::Exit` (a Windows logoff also ends in Exit, F29). Leftovers older than 14 days are pruned; the total is capped at 200 MB (oldest sessions first).
- **Restore.** At start, after the first render and before session restore, leftovers open a dialog: Restore all, Restore selected, Discard, Later (ask again next start). A restored document is dirty, keeps its profile, machine choice (a vanished machine id falls back as in AD-31), encoding, EOL and NUL info, and is **bound to its original path only when that path is already allowed** by the startup grants (recent and session, D6); it then carries the snapshot's disk stamp, so the P1 external-change check shows its banner if the file changed after the snapshot. Otherwise it opens as an untitled document named after the file, and Save As proposes the original path. Nothing in the metadata is ever granted.

**AD-22: Session restore and per-file memory.**
- Rust owns the session list (`state.json` → `session: { paths, active }`, F38), updated 1 s after any open, close or activation and on quit. `session_save` keeps only `is_allowed` paths (≤ 50); startup re-grants them, given and canonical (a bounded widening like D6; with recent files ≤ 100 paths).
- The webview owns `ui.files` (≤ 500 paths, least recently used out; ≤ 200 bookmarks each): cursor, top line, bookmarks, a **manual profile choice** and a **machine choice** (`machineId`: a machine id, or `null` for an explicit "none"; absent = follow the profile's default machine), written on close (`files.onWillClose`), on tab switch and before quit.
- Opening a remembered path applies the manual choice instead of detection (the spec's detection step 4) and the remembered machine choice before the profile's default machine (AD-31); a profile id or machine id that no longer exists is ignored.
- `files.restoreSession` (default on) reopens the session at start; missing files are skipped with one status message; the pristine initial untitled document is closed.
- A file that is offline at start stays in the list (`session_save` keeps a refused path the stored list already held) and is tried again at every start; Rust counts the starts that miss it in `session.missing` and drops it after 5 starts in a row over at least 14 days (§7.16 #29). The startup grant is bounded in time, and a path that does not answer counts as missing (§7.16 #28).

**AD-23: Read-only documents.**
- `DocMeta.readOnly` with a reason: `attribute` (from `files_stat.readonly`) or `user` (the `file.toggleReadOnly` command).
- The editor applies `readOnly` and `readOnlyMessage` on activation (F32). Save of a read-only document goes to Save As. Unlocking an `attribute` document makes the buffer editable, but Save still goes to Save As (gEdit never changes file attributes). The tab and the status bar show a lock.
- Writers that go around the editor (transforms, replace scripts, Insert block, Compare's editable side, the line-ending picker) refuse a locked document through `app/readOnlyLock.ts`; `applyLines` is the backstop. Reload from disk is not an edit (§7.16 #30).
- NUL-heavy files stay refused (P1 AD-7).

**AD-24: Tokenizer extensions for Okuma and Sinumerik.**
- New opt-in `syntax` fields (§7.1): `sequenceNames` (Okuma `NLAP1` is a `label` token, never a block number, so renumber leaves it alone), `assignment` (an address pattern that takes `=` + expression: Okuma `SB=`, Sinumerik `CR=`, `S3=`, `R1=`), `labels` (Sinumerik `NAME:`), `calls` (identifier + `( … )` → one `call` token), `systemVariables` (`$AA_IM`, Okuma `VZOFZ`), `header` (`$NAME.MIN%`, `%_N_NAME_MPF` → `programMarker`). All default off, so the Fanuc and Klartext token goldens are the regression gate.
- New token kinds `label` and `call` (§7.5). Roles are not extended: labels color as `blockNumber`, calls as `keyword`, so the themes and the WCAG test stay as they are.
- Two Monarch generators, `okuma` and `sinumerik`, following the rule orders in `syntax-okuma.md` §3.8 and `syntax-sinumerik.md` §3.8, with `defaultToken ''`.
- Python mirrors every field (`_nc_lex.py`) against the same token goldens.

**AD-25: NC-aware search is token-based.**
- A query is either an **address word** (`T1`, `G01`, `S`, `S>12000`, `F<=0`), matched on tokens by decimal value (comments and strings never match; `G1` = `G01` = `G1.`; `T1` ≠ `T10`), or **text/regex** on the raw line with comments optionally masked.
- Find-all fills the P1 Results panel (rows with `docId` and `line`, capped at 10,000 with a "dropped" count). Scope: the active document or all open documents.
- Replace is a `TransformDef` (`nc.replace`) on the active document: one undo step, its count in the summary, and "into a new tab" through the P1 framework.
- `search.wholeAddressInFind` hands the equivalent regex to Monaco's find widget through `editor.actions.findWithArgs` (F31).

**AD-26: Compare review mode and merge.**
- Review mode normalizes both sides line by line (§7.7): block numbers, whitespace, comments (a comment-only line disappears), case, and number format through the tokenizer (`X+05.500`→`X5.5`, `G01`→`G1`; two literals are normalized to the same text only when they are **equal under every reading that applies**: on a machine with increment input `X10` ≠ `X10.`, with calculator-type input or an Okuma unit system (`scale`, where the unit multiplies both) they are equal, and with **no machine** they are equal only when every preset the profile declares reads them alike — review mode never hides a difference the owner's machine would see). Each side is normalized with its own document's effective machine (AD-31); when the two differ, the review bar says so. No tolerance (§2.1). The results are two **read-only temporary models** (F31); a `lineMap` per side maps back to the original lines for "go to line".
- Defaults come from `profile.compare` and can be toggled in the toolbar.
- Merge works in raw mode only: `getLineChanges()` gives the blocks; a copy writes into the target model between two stack elements (one undo step). Right→left is offered only when the original side is an open document.
- Two files on disk: both are opened as documents (dialog grants, P1 F3) and compared; merging and saving need nothing new.
- Export: a unified diff (raw or normalized, 3 lines of context, the P1 Myers diff in `core/transforms/lineDiff.ts`) into a new untitled document.

**AD-27: Code inspector** (Phase 3, P3.2; the design is kept).
- A panel in the **left** region next to the Program Map (F39), `Mod+Alt+A` toggles it; hidden by default. No layout contract change.
- Rows: every token of the current block (a Klartext block with `~` continuations counts as one) with its meaning from the code database, its **effective value** (`X50` → "0.050 mm, no decimal point: increments of 0.001 mm", with the machine as the source; with no machine and a reading that depends on one, every reading instead of a value, the assumed profile default first; AD-31) and a note (unit, "incremental", "diameter" or "radius" by AD-19 rule 11, "thread lead"); cycle parameters with the values found; unknown words shown as unknown. Below: the modal state after the block, each value with its source line (clickable) and assumed values marked with where they come from.
- Editing a value rewrites exactly that word through `rewriteWord` (P1 number formatting in the word's own style, keeping typed extra decimals: a typed value is never rounded). The prompt takes the effective value (mm or inch) and `writeBack` (AD-31) writes it in the word's own form; a value that is not a whole number of increments (or of units, in a `scale` unit system) for a point-less word is refused with the reason, never rounded; a word whose reading depends on a machine that is not chosen is not editable, with that reason shown; checked against the parameter's `min`/`max` and integer-only for `T`, `D`, `H`; `G`, `M`, `N`, `O` words are not editable. A violation shows next to the field; nothing is corrected silently. Applied with `applyLines` (one undo step).

**AD-28: Templates replace the blocks JSON** (Phase 3, P3.4–P3.6; until then the Phase 1 blocks stay).
- `templates` live in each code database; user templates in `<config>/codes/<dialect>.json` (same id overrides).
- `renderTemplate` is pure (§7.8). `{{N}}` at a line start continues the surrounding block numbers with the profile step (empty in an unnumbered document); an empty optional parameter drops its whole word; a line left with only a block number is dropped; `\{{` escapes. For a `consecutive` profile (Klartext) the insert and the renumber of the following blocks are one combined edit.
- `snippet: true` templates go through the snippet controller (F32).
- The Insert tab, completion and the palette list the templates of the active document's **effective database** (`machines.effective(docId).codes.templates`), not of its profile id: the variant is a property of the document (AD-31), so a system-B document sees the `fanuc-lathe-b` overrides. They re-read on a document switch and on `machines.revision`. `data/blocks/**`, `contrib/blocks.ts`, `utils/insertBlock.ts`, `BlocksGroup.svelte` and `i18n/en/blocks.ts` are deleted (D13 ends).

**AD-29: User profiles and code files.**
- Folders `<config>/profiles/` and `<config>/codes/`, read by Rust (`user_files_list`: `.json` only, ≤ 64 files, ≤ 1 MiB each, no symlink escapes).
- The profile registry and the code-database service become **reloadable** (a `revision` store). A reload re-registers languages (Monaco cannot unregister one; a vanished id stays registered, harmlessly), regenerates the themes and rebuilds the outline of every document whose compiled profile changed; a document whose profile disappeared is re-detected with a status message.
- Commands: New profile from… (writes a child with `extends` and opens it), Open, Import, Export, Reload, and "Test profile on this document". Saving a file inside those folders reloads automatically. Problems go to the Results panel with the file and the JSON path.

**AD-30: Typing options.**
- `editing.forceUppercase`: an `onKeyDown` handler turns a plain letter key (no modifier, not composing, cursor outside a comment or string according to the tokenizer) into `editor.trigger('keyboard', 'type', { text: upper })`, so auto-closing and undo grouping stay Monaco's. Paste is untouched.
- `editing.preventLineJoin`: Backspace at column 1 and Delete at the end of a line, with an empty single selection, do nothing and show a status hint. A selected line break can still be deleted.
- Both are profile values; Klartext has upper case off.

**AD-31: Machine configurations.** (Owner decisions D23, D24, D34, D35; contracts §7.15.)
- **What it is.** A *machine configuration* is a named, user-defined setup: a **base profile** (`fanuc-lathe`, `okuma-osp`, `sinumerik`, `fanuc-gcode`; from M13 also a user profile) plus the **machine parameters** that change how that machine reads its programs. It is not a profile: it adds no codes, numbering or templates (user profiles and code files do that, AD-29). It only picks among choices the base profile declares and sets the power-on state — with **one** exception, added in M12: the `channels` block of AD-32, the only machine parameter that carries patterns of the user's own, because no profile can enumerate how a particular installation splits its channels. One document has at most one machine; many documents may share one.
- **Parameters in scope** (`MachineParams`, §7.15), each justified by a consumer that would otherwise misread a program:

  | Parameter | What it decides | First consumer | M |
  |---|---|---|---|
  | `numberInput` | How a numeric literal is read, per address class where the control distinguishes them (length, angle, feed per minute, feed per revolution, dwell; F52). Three readings: **`increment`** (without a point a count of least input increments — IS-B 0.001 mm / 0.0001 in, IS-C —, with a point mm/inch/deg/s as written), **`calculator`** (as written, with or without a point) and **`scale`** (**every** literal, with or without a point, times the class unit: the Okuma 1 µm and 10 µm unit systems, where `X0.1` is 0.001 mm and `F23.456` is 0.23456 mm/rev). Chosen from **presets the profile declares**; per-class values beyond the preset only in the file. | the effective `syntax.decimalPointSignificant` (every P1 number rule), scale-feed limits | M6 |
  | `units` | mm or inch at power-on, until the program states `G20`/`G21` (Sinumerik `G70`/`G71`; Okuma has no such code, the control's parameter decides) | modal interpreter; the metric or inch unit of the length and feed classes (angles and dwell keep theirs) | M6 |
  | `variants` (Fanuc lathe: `gcodeSystem` A/B) | which code database and profile overlay apply; replaces a second profile | every lookup of a code's meaning | M6 |
  | `diameter` | whether `X` (and `U`) are diameters at program start; Sinumerik `DIAMON` default on (D35) | modal state, hover, extents, address arithmetic | M6 |
  | `modalInitial` | the power-on modal codes per group the profile offers (feed mode `G94`/`G95`, `G98`/`G99`, CSS, plane, distance) | modal interpreter (`reset()`) | M6 |

  **Out of scope, with the reason:** the **tool-word format** (it is detectable for 4- and 3-digit `T` words; only a 1–2-digit lathe `T` word is ambiguous, and it stays a review item, D49; adding it later is data only, a variant with a `toolCall` overlay); **folder → machine rules** (D53); machine M-code tables, numbering and templates (user profiles and code files, M13); machine limits such as the top spindle speed for program checks (backlog); G-code system C (§11).
- **Declared by the profile, never hardcoded.** A profile's `machineParams` (§7.1, §8.8) declares which parameters its machines may set, the presets for `numberInput`, the defaults, the modal groups the dialog offers and the `variants` (id, label, default, choices; a choice may name a code database (an AD-17 child), a **profile overlay** limited to `modal`, `toolCall`, `numbering` and `addresses`, and **detection rules**). It is inherited through `extends` like every other field. No code names a dialect: the Fanuc lathe's A/B difference, Okuma's unit table and the Sinumerik `DIAMON` default are all data, reviewed by G10. A profile without `machineParams` (Klartext) has no machine item.
- **Effective machine, per document** (`effectiveMachine`, P6, §7.15). Every parameter comes from exactly one source, recorded next to it: **`machine`** (the document's machine sets it) → **`detected`** (only without a machine: a variant's detection rules chose it, margin ≥ 3) → **`profile`** (the profile's documented default). The result is always complete, so a consumer never guesses. "None" means every value comes from `detected` or `profile`, and the UI shows it as **assumed**.
- **Which machine a document uses**, in this order: (1) an explicit choice for the document (the status-bar pick, or the remembered choice from per-file memory, M7), where an explicit "none" counts; (2) the base profile's **default machine** (`machines.json` → `defaults`); (3) none. **An explicit machine always wins over detection.** Variant detection still runs; when it disagrees with the machine by a margin ≥ 3, one status warning per open names both ("looks like G-code system B; machine 'Lathe 2' is set to A") with a "Choose machine…" action; nothing switches by itself.
- **Compatibility.** A machine applies to a document whose profile is the machine's base profile or extends it (its resolution chain contains it), so from M13 a user profile `extends: fanuc-lathe` uses the Fanuc-lathe machines. Picking a machine of another profile from the "Other machines" part of the list also switches the document to that profile (and records both choices). Switching the profile re-evaluates the machine: an incompatible one falls back to the new profile's default or none, with a status message.
- **Applying it** (`applyMachine`, P6): the resolved profile gets the chosen variants' overlays (in declaration order, merged like `extends`); then, where the profile declares `numberInput`, `syntax.decimalPointSignificant = (the length class's reading === 'increment')` — `false` for `calculator` **and** for `scale`, where a point changes nothing; `modal.initial` gets the machine's `modalInitial` over the profile's; `modal.units` and `modal.diameter` are set; `modal.sources` records where each of them came from (`machine`, `detected`, `profile`), for AD-19 rule 8; `codes` becomes the chosen variant's database. The result is validated and compiled like any profile (AD-16) and cached by the effective key (profile id + a canonical string of the parameters), so two machines with the same values share one compiled profile. With none, a profile's defaults reproduce its own JSON exactly apart from `modal.units`, `modal.diameter` and `modal.sources`: the P1 profiles behave as in Phase 1 (X10).
- **One effective view per document.** `machines.effective(docId)` → `{ profile, cp, codes, machine }` (`EffectiveProfile`, §7.15). Every consumer that read `profiles.compiled(doc.profileId)` or `codes.forProfile(doc.profileId)` (F49) reads it instead: transforms, scripts, the outline index (rebuilt when the effective key changes), block navigation, hover and completion (through `docIdOf(model)`), the program map, compare, search, the modal service and the inspector. The Monaco language id stays the profile id; the grammar is generated from the **union** of the profile's variant databases (F49: it reads only addresses and word codes), so a variant switch never needs a new language.
- **Reading a number** (`core/machines/numbers.ts` and its Python twin `_nc_machine.py`, one golden set). `numberClassOf` decides the class in this **fixed order**, first match wins: (1) the `CodeParam.unit` of a code in the block (`increment`, `count`, or a class named outright — the table of §8.2 is the one place these are written down); (2) the feed word (and Okuma `E`) of an `fNotFeed` block → `dwell`; (3) `F`/`E` in a block that carries `pitchFeed` or under an active pitch cycle → `feedPerRev` (a thread lead is always per revolution, whatever the modal feed mode says); (4) `addresses.angular` → `angle`; (5) the feed word → `feedPerMin`/`feedPerRev` from the modal feed unit; (6) axes, incremental twins, arc centres, `R` and cycle depths → `length`; (7) nothing else has a class: `S`, `T`, `D`, `H`, `N`, `O`, `G`, `M` and `unit: 'count'` words are never converted. `valueOf(literal, class, machine, units)` is the value in mm/inch/deg/s and follows the class's reading: `increment` — with a point as written, without a point `digits × increment`; `calculator` — as written; `scale` — `literal × unit`, whether or not it has a point. `CodeParam.unit: 'increment'` is always the length class read as increments (in a `scale` system, as the length unit). The `angle` and `dwell` classes ignore `units`: their unit is `incrementDeg` / `incrementSec` (absent: the digits of `incrementMm`, so IS-B `C90000` is 90° in a metric **and** in an inch program). `writeBack(value, original, …)` writes a value in the word's **own form**: a point stays a point; a point-less word stays point-less only while the result is a whole number of increments (or units), otherwise it is rounded half away from zero and the rounding is reported (the inspector refuses instead); `calculator` uses the P1 formatting. A word whose class cannot be told (a feed while the feed unit is unknown) gets no value; every consumer that needs one leaves the word alone and reports it.
- **No machine, no guess.** When `machine.source.numberInput` is not `machine`, a literal has a value only if **every preset the profile declares** reads it the same (`readingsOf`, §7.15): with the Fanuc presets a word written with a point is the same everywhere and keeps its value, a point-less length, angle or dwell word does not; with the Okuma presets (1 mm as written, 1 µm and 10 µm scaling) no length or feed word has one. A word without a value is never converted: address arithmetic skips and reports it ("the reading depends on the machine; choose a machine"), the inspector refuses to edit it with that reason, extents list it as "not resolved", scale-feed compares it with no limit, and hover, the inspector and the program-check finding list every reading with its preset, the assumed default first. Multiplying or dividing is unit-free and therefore unaffected, and so is every word with a value.
- **Consumers of the machine's number reading:** the effective `decimalPointSignificant` (every P1 formatting rule) and the scale-feed limits (M6); program checks, extents and address arithmetic (M10); compare (M11); hover and the inspector (Phase 3); user scripts through the context (M6). Scaling itself is unit-free in all three readings (the literal is scaled, and value = literal × a constant): a point-less value is scaled as a count and written back point-less, which Phase 1 already does (F48); the machine decides whether that is *required* (increment mode) or merely the style kept (calculator and scale modes).
- **Storage.** `<config>/machines.json`, owned by Rust exactly like `settings.json` (F47): read in the one `config_load` round trip, written whole by `machines_save` through the shared `config.rs` rules (JSON object ≤ 1 MiB, atomic, `.bak` rescue, a newer `$version` read and never written) with its **own** version constant `MACHINES_VERSION = 1`. Not `settings.json`: settings are flat keys that store only non-default values and a list is taken whole or not at all (F47); machines are user-owned records with ids, their own schema version and import/export, and keeping them apart leaves `mergeSettings` untouched. Loading is tolerant: a record that fails validation is kept verbatim, listed with its problem on the Machines page and not selectable, so a hand edit is never lost; unknown members are kept. **The file can be edited by hand while gEdit runs:** `machines.openFile` opens it as a document, and a save of that document (`files.onDidSave`, the P1 `settings.json` pattern in `contrib/settings.ts`) runs `machines.reloadFromDisk()`, so the next page action never writes a stale in-memory copy over the edit; a parse error found on reload is shown while the file is still open.
- **Management.** Settings ▸ Machines (a page after the schema pages; F47: `pagesOf` only builds pages from `SETTING_FIELDS`): a list control modeled on the `scripts.folders` control (name, base profile, "default" marker, problems) with Add, Edit, Duplicate, Remove, "Default for its profile" and "Open machines file". While the file itself could not be read (`machinesError`), every write action is disabled and the page offers only "Open machines file" and "Replace with an empty file" (which is the one path that moves the unusable file to `machines.json.bak`), so a broken hand edit is never overwritten behind the user's back. Add and Edit open one form through `modals.form`/`FormRenderer`, generated from the base profile's declaration (name: `text`, required; base profile: `choice`; "How the control reads numbers": `choice` over the presets (each preset's label says what it does to a number with and without a point); unit: `choice`; diameter: `bool`; each variant: `choice`; each offered modal group: `choice` over that group's codes in the effective database plus "profile default"). No new `FieldType` (F46). Changing the base profile in Add is a first step (a one-field form), so the second form always matches the profile. Import/export in M13 (WP13.3).
- **Selection UI.** A status item (`data-item="machine"`, next to the profile item) reads "Machine: <name>" or "Machine: none"; with none it carries the assumed marker, and its tooltip always lists every effective parameter with its source (machine, detected, profile default). A click runs `file.setMachine`: a quick pick with "None (profile defaults)", the compatible machines, "Other machines…" and "Manage machines…". Hidden for a profile without `machineParams`.
- **Removing or changing a machine** that open documents use re-evaluates them (default or none) with one status message; per-file memory and recovery entries that name a vanished id are ignored.
- **Scripts** get the effective machine in the context (`ScriptContextV2.machine`, additive, F50) and `context.profile` is the effective profile, so a P1 script that reads `syntax.decimalPointSignificant` already follows the machine; `gedit_nc.machine_params(ctx)` answers the profile's defaults (every source `profile`) when the member is missing.

**AD-32: Multi-channel programs.** (Owner decision D58; contracts §7.17; content §8.9; milestone M12.)
- **What a channel is here.** A *channel* (turret, spindle, "Kanal", "path") is one stream of blocks the control executes independently of the others. gEdit does not interpret channels: it **finds** them, **groups** what it already computes per channel, and **compares the wait codes between them**. It never reorders, rewrites or synchronizes anything.
- **Where the definition lives, and why.** In the **machine configuration**, not in the profile: whether a machine's two channels arrive as two sections of one file or as two files, and which code makes a channel wait, is a property of the machine and its post, not of the dialect (D58). Two machines with the same control can differ. The profile contributes only what it always contributes — the comment syntax used to mask a line, and, later, optional **presets** a user can start from. **Phase 2 ships no preset** (§8.9): the owner has not said which wait codes the owner's machines use, and a guess would be a machine-builder sync code set, which the roadmap keeps out of gEdit (F61).
- **Layout, one of three.**
  - `none` (default, and what every machine has until the user says otherwise): no channels, nothing in the UI changes.
  - `single-file`: the channels are **sections of one document**, found by a user-written `sectionStart` pattern whose `channel` capture (or, without one, the position in the declared channel list) names the channel. An optional `sectionEnd` pattern closes a section; without it a section runs to the next start or to the end of the document. **A channel may have any number of sections.** That is not an edge case: the owner's own Okuma manual says the turret-selection codes "may be specified in a program as many times as necessary" and that the control then separates the program into one program per turret, so a normal 2S program alternates `G13 … G14 … G13 … G14 …`. A channel therefore holds a **list of line ranges** in document order, and a channel appearing twice is information, never a problem. Every line that belongs to no channel — before the first section, between a `sectionEnd` and the next start (where a concatenated transfer file keeps its shared subprograms), after the last — is an **outside** range: its own group in the map, never dropped.
  - `multi-file`: each channel is **its own document**. Three ways say which, in this order: the in-file `marker` pattern, the base-name rules, and the user's own assignment. The base-name rules are a shared `fileName` pattern with `stem` and `channel` captures (`^(?<stem>.+)_CH(?<channel>\d+)\.nc$`), **or a per-channel template** (`list[].fileName`), because real sets exist whose names share no single pattern — a Siemens pair called `%_N_1000_MPF` and `%_N_2000_MPF`, a main program plus a counter-spindle program called `PART.MPF` and `PART_GS.MPF`. And because no pattern describes every post — Fanuc multi-path output often gives both paths the **same** name in different folders, which gEdit cannot even see (F57) — the channel pick also offers **"Assign this document to channel N"** for a document the user has already opened, remembered per file by M7. That is the fallback that makes the feature usable before the owner has answered D64: they open both files and say which is which, once.
- **Resolution, per document** (`channels.forDoc(docId)` → `ChannelSet`, §7.17). It runs from the document's **effective machine** (AD-31), so a document with no machine, a machine with no `channels` block, or a name and content that match no rule resolves to `layout: 'none'` and nothing in the UI appears. The set names, per declared channel: which document and line range holds it (`single-file`), or which file it is and whether that file exists and is open (`multi-file`). A declared channel that is nowhere is **missing**, and missing is shown, never silently empty. Resolution is pure over the lines and the base name; it re-runs on a content change (debounced with the outline, §7.17) and on a machine change. The **check** resolves every member with the *initiating* document's effective machine, never with each document's own: a sibling opened with a different machine, or with none, would otherwise contribute no marks at all and fill the report with "missing" (a fresh `twin_CH2.nc` takes its machine from per-file memory, else the profile's **default** machine, which need not be the twin-turret one). The report header names such a sibling — "channel 2 is set to machine X" — with a one-click "use this machine for channel 2"; two machines' rules are never mixed in silence.
- **A broken channel block costs the channels, not the machine.** A `channels` block whose patterns do not compile or leave the AD-11 subset is dropped to `layout: 'none'` with its problem recorded; the record **stays valid and selectable** and the rest of its parameters — above all how it reads numbers — keep working (§7.15). Invalidating the whole record for a typo in a pattern the user is experimenting with in the Channels tester would silently change how every number in every program of that machine is read (AD-31 "No machine, no guess", D57): a point-less `X50` would stop having a value at all. Whole-record invalidation stays for the parameters that decide the number reading.
- **Finding the siblings without opening them** (`multi-file`). gEdit may not look into a folder (F57), so it computes the sibling **names** from the pattern — pure, no I/O — and asks Rust `channel_siblings(path, names)` whether they exist. That command requires `is_allowed(path)` for the **open document's own path**, resolves each validated plain file name against **that path's parent**, and answers existence, size and modification time only. It grants nothing and reads nothing. Opening a channel still goes through the file dialog, which grants what the user picks (P1 F3; the cheaper alternative, no command at all, is D62) — pre-filled with the document's folder, multi-select, so one dialog opens every channel — or through a drop, which the fs plugin grants (P1 F2). **gEdit never opens a file by itself.** Standing rules 14 and 15 (§4) state both halves.
- **A channel is named by more than one token.** The three places a pattern names a channel — the section start, the file name, the partner list on a wait line — use different spellings in real programs: Okuma starts a section with `G13`/`G14`, a Siemens post writes the partners of `WAITM(10,WAIT_K1,WAIT_K2)` as symbolic names while its file is called `%_N_1000_MPF`, a Fanuc post writes `P12`. One channel id cannot be all of them, so each declared channel carries optional **aliases** (`1`, `G13`, `WAIT_K1`, `CH1`), matched case-insensitively wherever a pattern names a channel and unique across the whole list. Without aliases a user who declares `3`/`4` so that `G1(?<channel>[34])` works gets "unknown channel" for every `WAITM(…,1,2)`, and one who declares `1`/`2` cannot use the capture for the section start at all.
- **Sync marks are the user's patterns.** A machine's `syncMarks` is an ordered list of rules. A rule finds a mark on a **masked** line (comments never match) in one of two ways: `prefix` — a literal prefix followed by the mark id as digits (`M1` + two digits, `WAITM(` + the first argument) — or `regex` — a pattern with a named capture `mark`. It says which channels the mark makes wait, in one of three ways: `all` (every channel of the machine), `fixed` (a list written once per rule) or `line` (a second pattern whose `channels` capture is split on a declared separator, each piece matched against the declared channel ids and aliases). **Only execution-blocking waits are checked:** a rule may be declared `blocking: false`, and such a mark is shown in the map and in the navigation but never checked, because a marker that only sets a flag is not a rendezvous.
- **Three mechanisms, three checks** (`SyncRule.semantics`). A single "id must appear in both channels" rule produces findings on correct programs, which is worse than no check, and all three counter-examples come from the owner's own controls. **`rendezvous`** (the default) is a wait with an id: the k-th mark of an id in one channel meets the k-th in the partner. **`count`** is a wait with no id at all — the Okuma `M100`, whose documented rule is that the same *number* of them must appear on both turret sides — so the mark is empty and only counts and order are compared. **`ordered`** is not a rendezvous at all: the Okuma `P` codes order the two programs against each other from the smaller number to the larger, and the manual's own correct example runs P10/P20/P40 against P10/P30/P40, so an id present on one side only is legal and the only defect is an id that *decreases* inside one channel. A rule declares which it is; the tester and the user guide name the three in the same words.
- **What the check says, and what it does not.** `checkSyncMarks` (pure, §7.17) compares **sequences, not sets**, because a repeated id is normal: the Siemens two-channel example waits on `WAITM(0,…)` three times in each channel and on `80` and `90` twice each, and the first draft's "duplicated" would have fired eight times on a program that runs. It reports **count mismatch** (this id occurs three times in channel 1 and twice in channel 2), **missing** (a mark whose ordinal partner is absent), **out of order** (the two ordered sequences disagree, found by one linear diff), **not increasing** (an `ordered` rule only), **unknown channel** (a `line` partner names a channel the machine does not declare), **unmatched** (a blocking mark whose partner set names only its own channel — and never for a mark that already produced a `missing` or `count-mismatch`, so one defect gives one finding) and **outside channels** (a wait found where no section owns it). The order check is **suspended between two marks only when a real jump lies between them** — a label that some `GOTO`/`GOTOB`/`GOTOF`/`M99 P`/`M98 Q` in the same channel actually targets, or a backward jump — not by the mere presence of a label: in the Siemens shape every wait line *carries* a label (`NN8010: WAITM(10,…)`), and suspending on that would turn the whole check off on exactly the programs it is for. A label on the mark line itself is ignored. Findings are warnings that carry their document and line (F58); nothing is ever rewritten. The user guide states these limits plainly: the check compares written ids and written order, not machine semantics, and a clean result is not a proof.
- **One implementation, in TypeScript.** The check spans documents, and a script sees one (F60), so it is TS, not Python; that also puts it in the `-nopython` exit run. It is presented with the M10 program checks (same report shape, same Results panel, the Tools tab beside them), and `program_checks.py` is not touched.
- **What the rest of the app does with a channel set.** The program map groups its items under one `channel` row per channel and shows the blocking marks as `sync` rows (`OutlineItem` already carries `children`, so the grouping costs no new type, F59) (`OutlineKind` gains `channel` and `sync`, which a **profile** may not use in its own `outline` rules, §7.14); `outline.toolLines(id, channelId)` gives the per-channel tool lines, while `toolLines(id)` stays the flat document-wide list, so F7 does not change. The lines no channel owns are their own group ("Outside the channels"), so a shared subprogram between two sections is visible rather than lost. A status item next to the machine item names the channel at the cursor. `channels.nextSyncPoint`/`prevSyncPoint` walk the marks of that channel and `channels.gotoPartner` jumps to the same id in another channel, switching document when it must. `channels.splitToDocuments` writes each channel — every one of its ranges, in document order, behind the program's own header lines — into a new **untitled** document (nothing goes to disk): the roadmap's "split multi-channel programs by channel", at the cost of one command now that the sections are known. It is a **one-way copy for reading**: edits in a split document do not return to the source, the command says so before it runs and in the status message, and `docs/user/channels.md` repeats it. Carrying the header in is what makes each result a program rather than a fragment. It is offered for `single-file` only — in `multi-file` the channels are already separate documents.
- **Scripts** get the channel set of **their own** document in the context (`ScriptContextV2.channels`, additive, `contract` stays 2, F50): the layout, which channel this document is, every channel with its line range or file name, and the blocking marks found in this document with their partner channels. `tool_list.py` groups its rows by channel and adds a **Channel** column when the context has sections, and names the channel in its summary in `multi-file` mode. A combined list over several channel **files** needs multi-document script input, which is P1 D16 and stays deferred (§11 item 11) — the plan says so rather than pretending the column covers it.
- **Side by side is Phase 4** (D61, §11 item 27; Phase 3 before the third revision). Parallel editable panes aligned at the sync marks need one editor per channel. Monaco can align and lock the scrolling with public API (F55), but it cannot show one channel of one model: `setHiddenAreas` is private and does nothing on a model over 300,000 lines or over 20 MB (F54), which the owner's longest posted programs reach. The honest design is one model per channel with a two-way mapping back into the document (single file) or one document per pane (several files) — which is the machinery of the Phase 4 rows "Split view" (`editor-core.md`) and "Aligned NC-aware diff with merge" (`file-compare.md`, already written as "two synced editors ... view zones fill gaps"), plus the two traps a second widget inherits (F56). Phase 2 ships sync-point navigation instead, which is what the owner actually does with two channels open: line them up at a wait.

---

## 4. Security and capability deltas

P1 §3 still applies: CSP unchanged, `freezePrototype` false, no `src-tauri/permissions/`, no `{@html}` with file, script or profile content, no `eval` dependency, scripts never run by themselves.

**`src-tauri/capabilities/default.json` does not change in any Phase 2 milestone** (G8 checks that its diff is empty). The only new dependency line is `objc2` (macOS only, already in `Cargo.lock`, F28). No new npm dependency.

**Persistence deltas.** New app-owned files: `<config>/machines.json` (M6, Rust-owned, `$version` 1), and the webview-owned `state.json` members of M7 (`session`, `ui.files` with the machine choice). New folders: `<data>/backups/`, `<data>/recovery/` (M7), `<config>/profiles/`, `<config>/codes/` (M13). `settings.json` keeps `$version` 1 and gains only the M7 keys of §7.11: no machine data goes into it. M12 adds **no file**: the channel layout and the sync marks are members of a machine's `params` in `machines.json`, and `MACHINES_VERSION` stays **1** — the parser keeps unknown members verbatim (§7.15), no release ever shipped version 1 before the Phase 2 exit, and a bump would only make an earlier development build refuse to write a file it can already round-trip (D59).

| Feature (milestone) | How paths or data cross the boundary | New surface | Notes |
|---|---|---|---|
| Quit guard (M6) | none | `quit_guard_set_dirty(bool)`; one ObjC method on tao's delegate class | Unsafe code only in `quit.rs`; installed only if the selector is missing; logs and degrades. |
| Machine configurations (M6) | Fixed file `<config>/machines.json`: read inside `config_load`, written by `machines_save(machines)` (a JSON object ≤ 1 MiB, atomic, `$version` stamped, `.bak` rescue, a newer version never overwritten); `machines_open_file` grants exactly that one file, like `settings_open_file` | two commands; `ConfigLoad` gains `machines`, `machinesError` | No path or folder from the webview (rule 6). Names and notes are data: plain Svelte text, never `{@html}`; ids `^[a-z0-9][a-z0-9-]{0,63}$`; ≤ 100 machines, names ≤ 64 and notes ≤ 500 characters. The parameters select among profile-declared choices and never carry patterns. |
| Backup (M7) | `files_backup(path)` requires `is_allowed(path)`; writes only under `<data>/backups/` or exactly `<path>.bak` | none | The mode comes from `settings.json`, read by Rust. `sibling` refuses a symlink or directory at `<path>.bak`. |
| Recovery (M7) | Fixed folder `<data>/recovery/<session>/`; keys match `^[a-z0-9-]{1,64}$`; body ≤ 64 MiB, metadata header ≤ 8 KiB, capped before allocation; total ≤ 200 MB | raw-body `recovery_put`, raw `recovery_read` | Restore never grants a path; it binds only when the startup grants already allow it. |
| Session (M7) | `session_save` keeps `is_allowed` paths only (≤ 50); startup re-grants them | none | Same bounded widening as recent files (D6). |
| Read-only (M7) | none | none | gEdit never changes file attributes. |
| Okuma, Sinumerik (M8) | none | none | Data and grammars only. |
| Search, compare (M11) | Two files on disk go through the dialog (P1 F3) | none | – |
| Channels (M12) | `channel_siblings(path, names)`: `is_allowed(path)` is required for the **open document's own path**; each name is validated as a plain file name (1–255 characters, no path separator, no `:`, no wildcard, no control character, not `.` or `..`; ≤ 32 per call) and resolved against **that path's parent**; the answer is existence, byte size and modification time — no content, no new grant. Opening a channel goes through the dialog (P1 F3) or a drop (P1 F2) | one command | The folder is **derived from an allowed path**, never sent by the webview (standing rule 14). The channel and sync patterns live in `machines.json` and are user data, compiled with `new RegExp` / Python `re` only, length-capped and subset-checked like a user profile's (standing rule 15). Channel names and ids are plain Svelte text, never `{@html}`. |
| Bundled scripts (M9, M10) | as P1 AD-13 | none | Standard library only; output capped as P1 §7.12 row 12. |
| Inspector, hover (Phase 3) | none | none | Escaped markdown / plain Svelte text. |
| Machine import/export (M13) | Export writes through the save dialog's grant, import reads a dialog pick (`is_allowed`); the merged result is saved through `machines_save` | none | Imported records are validated like hand-edited ones; an id collision gets a new id, a name collision a suffix. |
| User profiles and code files (M13) | Fixed folders; names `^[a-z0-9][a-z0-9._-]{0,63}\.json$`; `user_file_import(src)` requires `is_allowed(src)` (a dialog pick); create/open grant only that one file; writes are JSON objects, atomic, never overwrite on create | four `user_file*` commands | User JSON is data: validated, size-capped; patterns ≤ 1,000 characters, compiled with `new RegExp` / Python `re` only, subset-checked (P1 AD-11). |

Standing rules added for Phase 2 (P1 §3 rules 1–5 still apply; G8 checks all of them):

6. A new Rust command that takes a file name resolves it against a **fixed folder** after name validation; otherwise it takes a path and checks `fs_scope().is_allowed`. No command takes a folder from the webview.
7. Objective-C `unsafe` code lives only in `src-tauri/src/quit.rs`, behind `#[cfg(target_os = "macos")]`; it logs and degrades instead of panicking.
8. Every raw-body command caps its body before it allocates.
9. Profile, code-database, template and user-file content is data: never `{@html}`, never a `Function`/`eval` path, never a shell. Templates never evaluate anything (formula parameters stay P3 and will need a hand-written parser).
10. Recovery and backup folders are created 0700 on Unix, never granted to the webview, and pruned by Rust.
11. No new process-launching surface (external commands are cut).
12. **Real programs never enter the repository or CI** (D45). `tests/real/` is gitignored except its `README.md`; G8 checks that `git ls-files tests/real` lists only that README and that no committed fixture, golden, hand-off note, review table or commit body names a local program or quotes its content (G11 reports counts only). **No snapshot API in the local-program tests:** `tests/unit/realFixtures.test.ts` and `tests/python/test_real_fixtures.py` may not call `toMatchSnapshot`, `toMatchInlineSnapshot`, `toMatchFileSnapshot` or any other snapshot helper (G8 greps for `toMatch*Snapshot` in them), because a snapshot would write program text into a committed `__snapshots__/*.snap` or into the committed test file itself (the repo already keeps such snapshots, `src/lib/core/grammar/__snapshots__/`). Every golden derived from a local program is written under the local folder, never under `tests/`; assertion messages give the manifest index, counts and line numbers, never file names or program text. A finding from a local program becomes a synthetic reproduction written for gEdit. The owner's explicitly public files are the only real programs committed (`tests/fixtures/nc/owner-public/**`, §9.2).
13. App-owned JSON files follow one rule set (F47): fixed name, Rust-owned, ≤ 1 MiB, atomic, `$version`, `.bak` rescue, a newer version never overwritten. `machines.json` is the Phase 2 addition.
14. A command may derive a **folder** only from a path the scope already allows, may answer **metadata only**, and never grants anything. `channel_siblings` is the one Phase 2 example: the parent of an `is_allowed` path, validated plain file names, existence, size and modified time. Rule 6 stands: no command takes a folder, a pattern or a path fragment from the webview that is not a validated file name. **gEdit never opens or reads a file the user did not pick or drop** (F57), so a channel that is not open is reported as "not open", never opened by itself.
15. **User-written patterns in `machines.json`** (the `channels` block of AD-32) are the one place a machine configuration carries a regex. They are data under the user-profile rules (P1 AD-11): ≤ 1,000 characters each, compiled with `new RegExp` / Python `re` only, inside the ECMAScript ∩ Python subset (the same scan the profile patterns pass), never `{@html}`, never a `Function`/`eval` path, never a shell. A `channels` block whose pattern does not compile or leaves the subset is kept verbatim, reported on the Machines page and dropped to `layout: 'none'`; the record itself stays valid and selectable, because a broken channel pattern must not change how that machine reads numbers (§7.15 rules, X12 d).

Residual risks, stated plainly:
- A user profile regex can be slow (ReDoS). It is the user's own file; detection reads at most 400 lines, rules run per line, and "Test profile" reports rules slower than 50 ms on the sample.
- Recovery snapshots and backups put program text (possibly customer IP) into the app data folder. Mitigations: 0700, deletion after save/close/quit, the 14-day prune; the user guide says where they are and how to turn them off.
- `machines.json` may name sites or customers in machine names and notes. It stays in the user's config folder, is never sent anywhere, and appears in a script's context only as the effective machine of the document being run.
- A channel or sync pattern can be slow (ReDoS), like a user profile's. It is the user's own file; channel resolution runs once per document open and per debounced change, over the masked lines; the Channels tester reports a rule slower than 50 ms on the sample, and the resolution is abandoned with a status message above a 500 ms budget on one document, leaving `layout: 'none'`.
- A script's context carries the sibling channel **paths** in `multi-file` mode. That discloses nothing new: the script already has `document.path`, and the names are derived from it by a pattern the same user wrote. gEdit still opens nothing on its own.
- The owner's local programs sit in a folder inside the working copy. `.gitignore` and the G8 check keep them out of commits; a `git add -f` would still defeat that, so the rule is also stated in `tests/real/README.md`.

---

## 5. Execution protocol: deltas to P1 §4

Everything in P1 §4 applies: preludes with contracts and stubs, work packages in worktrees with disjoint ownership, waves, integration, gates G0–G9, one squash commit per milestone. The changes:

### 5.1 W0: the Windows test-manifest fix (first item, before M6)

The fix for the Windows CI failure is committed locally (F45) but has run on macOS and in a partial cross-build only, and **the owner has not approved pushing it**. W0 therefore does not push; the fix enters Phase 2 locally and the Windows confirmation follows whenever the owner allows the push.
1. **Local, no network:** cut `feat/phase-2` **at** `c18fba2` (`git branch feat/phase-2 c18fba2`). `c18fba2` sits directly on `main` @ `21091a0` (F45), so there is no merge commit and the commit keeps its hash. Run the macOS gates G0–G4 on it (fmt, clippy, `cargo test`, `npm test`, Python) and record the result in the P6 commit body.
2. **Separately, with the owner's OK (D46)** and not blocking any milestone: push `fix/windows-test-manifest` unchanged and open a PR against `main`. Note that `c18fba2` is the first commit of `feat/phase-2` and therefore of every milestone commit: **approving the first milestone push (D44's fast-forward of `main`) also approves publishing the fix**, whether or not D46 has been answered by then. If the owner wants the fix reviewed on its own first, the owner answers D46 before the M6 push; if the owner wants Phase 2 without it, `feat/phase-2` is rebuilt on `main` @ `21091a0` at a milestone boundary (the milestones are squash commits, so this is a rebase of at most a handful of commits) and X10 then needs another Windows fix. `ci.yml` runs on `pull_request`. CI must show, on `Rust (windows-latest)`, step `cargo test --locked`: `Running unittests src\lib.rs` ends `test result: ok` (141 passed and 1 ignored on macOS; the Windows count may differ), and `unittests src\main.rs` and `Doc-tests gedit_lib` are ok. `Debug bundle (windows-latest)` (`npx tauri build --debug`) still succeeds, which proves there is exactly one manifest (a duplicate fails the link with `CVT1100` or `LNK1123`). macOS and Linux jobs are unchanged. Optional: count `Microsoft.Windows.Common-Controls` in `gedit.exe` (expect 1).
3. `main` takes the fix by **fast-forward** to `c18fba2` (no rebase, no squash), so `feat/phase-2` and `main` share the same commit and the later milestone fast-forwards stay linear (D44).
4. If Windows CI still fails, the rework is committed on `fix/windows-test-manifest` and merged into `feat/phase-2` at the next milestone boundary; X10 carries the requirement to the Phase 2 exit, whose CI check needs a push anyway.
5. Remove the scratch worktree `SP/wt/win-test-fix` and, if unwanted, the `x86_64-pc-windows-msvc` rustup target.

The same step starts the owner's inputs: the machine data of the owner's lathes (decimal-point setting, G-code system, power-on feed mode) for the example machines and the §13 check, and the first public programs, if any (§9.2).

### 5.2 Changes to the milestone protocol

1. **Branches.** Base branch `feat/phase-2`, cut at `c18fba2` in W0. Milestone branches `mN/base`, `mN/<wp>`, `mN/int` as in P1 §4.1. After the gates the milestone is squashed onto `feat/phase-2`; the owner fast-forwards `main` after checking it (D44), and from the third revision on a smaller self-contained batch lands the same way as soon as its gates pass (rule 11), followed by a release after each milestone (§5.3).
2. **Preludes may implement small pure functions** that every Wave A WP depends on (P1 already did with `compile.ts`). A prelude that changes a shared export leaves `npm test` and the Python suite green at its commit. The prelude also alone edits `src/lib/core/{profiles,codes,nc,templates,search,compare,machines,channels,scripting,transforms}/types.ts`, `src/lib/core/settings/schema.ts`, `src-tauri/src/config.rs` (the shared JSON-file rules), `.gitignore`, `tests/runtime/{harness,lib}/**`, `tests/python/helpers.py` and the stubs it creates, in addition to the P1 §4.2 list.
3. **Spec goldens.** A Wave A content WP may write goldens for behavior another Wave A WP implements (for example, lathe outline or modal goldens). Those tests may fail in the content worktree; its hand-off note lists them by name, and G2 at integration must be green. Every other test passes in the worktree as usual. A golden that names a `machine` (§7.4) also needs its generated effective profile (`tests/fixtures/resolved/effective/**`, P6 item 12), which only integration writes: **every integration regenerates `tests/fixtures/resolved/**` with `UPDATE_RESOLVED=1 npm test -- resolved` after Wave A** (I6, I8 and the same step in I9, I10, I11, I12 and I13 whenever a WP added goldens with a `machine`), and until then such goldens count as spec goldens. A WP may regenerate locally to run them but commits only its own goldens.
4. **WP size:** one agent session, roughly ≤ 1,500 changed lines including tests. A WP that grows past that is split at integration's request, recorded in the hand-off note.
5. **Waves:** Wave A starts from `mN/base`, Wave B from `mN/int`. No Wave C: work that would need one moves into the prelude.
6. **Gates:**
   - G1: 0 errors and 0 warnings.
   - G4 (Python) runs in every milestone.
   - G6 has a **precondition**: the screen is unlocked (F43) and `h_focus_state` reports a frontmost session. A `BLOCKED` scenario is never counted as a pass; the run is repeated when the owner has unlocked the screen. **The G6 window:** each milestone names its G6 window with the owner in advance (about ten minutes of an idle, unlocked Mac at M8, more with every milestone), in the integration's hand-off, so a finished milestone does not wait days for a free screen; if the spike of rule 12 works, G6 runs on a CI macOS runner and needs no window.
   - G8 also checks the standing rules 6–13 and that `docs/user/**` describes exactly what the milestone shipped, including the "What gEdit does not do" list in `docs/user/README.md` and "Current state" in `docs/planning/README.md`.
   - **G10, NC-correctness review** (new): every change under `src/lib/data/{profiles,codes}/**` (templates and `machineParams` declarations included), the NC behavior of `src-tauri/resources/scripts/**`, the number rules of `core/machines/numbers.ts`/`_nc_machine.py`, and every `expected*`/golden file of an NC fixture. Procedure in §8.7. It blocks the commit.
   - **G11, real-program smoke** (new, §9.2): runs **only on the owner's machine**. The folder is `GEDIT_REAL_FIXTURES`, else `<git rev-parse --git-common-dir>/../tests/real` — the **main working tree**, so a run inside a `SP/wt/<wp>` worktree finds the same programs (an ignored `tests/real/` does not exist in a worktree, which is why a plain relative path would report "no programs" although they are there). Without a folder the result is "not found"; with a folder but no `manifest.json` it is "no programs"; both are skips and are recorded in the commit body, which names which of the two folder sources was used, never its path. It reports counts and pass/fail only, never file names or content (standing rule 12).
7. **Long commands run in the background.** `tests/runtime/suite.sh`, `cargo test`, `npm run build` and the bundle build run with `run_in_background` and a log in `SP/logs/<milestone>-<step>.log`; the integrator polls the log instead of blocking a turn (the Phase 1 lesson).
8. **Fixture intake** (§9.2) is a serial step that runs whenever the owner hands over public files or asks for a G11 run on their local ones; it never blocks a milestone (G11 skips without local programs).
9. **Windows and Linux** are still CI-only. Each milestone adds its items to the owner's manual smoke list (§13); the milestone does not wait for it.
10. **Contract deviations** are recorded in §7.16 in the P1 §7.12 format.
11. **Land each batch on `main` as soon as its gates pass** (third revision, D70, proposed). A whole milestone, or a smaller increment where a batch is self-contained — a prelude with its own green gates, a Wave A work package that stands alone, a fix batch — is squashed onto `feat/phase-2` and offered to the owner for the fast-forward of `main` (D44) at once, instead of waiting for the end of its milestone. A release (§5.3) still follows only a whole milestone.
12. **The runtime harness on a CI macOS runner (a spike, size S, in the M9 prelude).** P9 item 8 tries `tests/runtime/suite.sh` on a GitHub macOS runner, started by hand. If it works, a follow-up adds the job to `ci.yml`, G6 runs there on every milestone, and the G6 window of rule 6 is no longer needed; if it does not, the commit body says why and G6 stays on the owner's Mac.
13. **G7 is measured on the development machine; CI scales the unit tests' tight budgets.** The budgets of G7 (P1 §4.3) are taken on the owner's Mac, and a unit test that asserts one of them is an early warning and not the gate. CI is a small shared VM running many test files in parallel. The first CI run of the M8 dialects measured 7 ms against a 5 ms budget that the Mac meets in 1 to 2, six times slower on a sub-millisecond measurement without a warm-up; the bulk work (tokenizing 300k lines, renumbering 100k) ran at about the Mac's speed in the same log. So a wall-clock assertion whose budget is under about 100 ms, or whose room over the worst value the Mac measures in a full parallel run is less than tenfold, goes through `tests/unit/helpers/budget.ts`: `expectWithin(measured, ms, what)` and `budgetMs(ms)` multiply the budget by `CI_FACTOR` (**5**) when `CI` is set and leave it alone otherwise, so G7 still bites on the development machine and CI catches a gross regression, never the Mac's budget. The factor covers the six-fold slowdown of a tiny measurement once the best of several runs is taken. The test timeout is a wall-clock limit too (`testTimeout` in `vitest.config.ts`, 20 s, because vitest's default 5 s failed the long fixture tests under load), and a scaled budget stays under it. The failure message names the budget and the factor. A test that times a steady state warms up first and keeps the fastest of a few runs (`fastest` in the same file). `BUDGET_LOG=<file>` writes every checked budget with its measured value. A budget with more than tenfold room stays a plain `expect`; a new wall-clock assertion states which of the two it is. Where a count can replace a clock (the outline's re-read lines, the mask fast path), prefer the count.

### 5.3 Releases after each milestone (accepted 2026-10-01, D70)

**Why.** Nothing has been released: the owner has never tested a tagged build, and the Phase 1 exit (the owner's check of the bundles on Windows and Linux) is still open. A release after each milestone gives them something concrete to test, and real use a chance to steer the next milestone (third revision, point 3).

**W1: the release workflow** (size S, before v0.2, a small infrastructure task of its own). A new `.github/workflows/release.yml` runs on a pushed version tag (`v*`): `npx tauri build` for macOS, Windows and Linux in a matrix, with the bundles attached to a **draft** GitHub release. `ci.yml` is not changed. Code signing and notarization are not part of W1; while the bundles are unsigned, the release notes say so and say how to open them on each platform. The version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` moves together (`versions:check`, D48).

**The releases** (a release follows the landing of its milestone on `main`):

| Release | Contents | When |
|---|---|---|
| v0.2 | M6, M7, the Windows pass and M8, with the Next-up fixes, the source review and the decision batch of 2026-09-27 | right after this batch lands on `main` and W1 exists |
| v0.3 | M9, real programs read right | after M9 |
| v0.4 | M10, check before the machine | after M10 |
| v0.5 | M11, compare and search | after M11 |
| v0.6 | M12, multi-channel programs | after M12 |
| 1.0 | M13 and the Phase 2 exit (§2.2) | after M13 and the owner's bundle check |

**Publishing is the owner's call every time.** The integrator bumps the version in the milestone's commit and, with the owner's OK, pushes the tag (a network step, like every push); the workflow makes a draft; only the owner publishes it. The draft's notes come from the milestone's commit body and `docs/planning/README.md` "Current state": what shipped, what it does not do yet, and on which platforms the owner has tried it.

**The owner's checklist per release**, on the three platforms: open a program, edit it, save it and confirm the bytes (byte-exact save); the close guard with an unsaved tab; one bundled script with Python and once without it (the "Python not found" message). Then the milestone's own items of §13. This is how the open Phase 1 exit check finally gets done: v0.2's checklist is that check.

---

## 6. Milestones

Order: W0 → M6 → M7 → the Windows pass → M8 → W1 (§5.3) → M9 → M10 → M11 → M12 → M13, each milestone followed by its landing on `main` and its release (§5.3). This is the third revision's order (D69, proposed); the designs moved to Phase 3 follow M13 at the end of this section. **D38 and D63 are history:** M8 ran before the old M9, so D38's swap and WP8.9 were never used, and D63's rule — multi-channel after the checks and before the inspector — survives as M12 after M10 and M11. Inside a milestone: prelude, Wave A, merge, Wave B, integration, gates, commit (P1 §4). The harness WP `Hn` owns `tests/runtime/scenarios/**`, `tests/runtime/fixtures/**` (the scenario fixtures and helper scripts it needs) and `tests/runtime/suites/mN.txt`, and updates earlier scenarios only for the intentional changes listed per milestone.

Each WP lists: **Owns**, **Depends on**, **Deliver**, **Tests**, **Acceptance** (where it adds to "its tests pass and G0 holds"), **Covers** (roadmap rows, exit criteria, P1 items).

### M6: Fanuc lathe, machine configurations and the macOS quit guard

**Goal:** a posted Fanuc turning program (system A or B) is recognized, navigated, scaled and renumbered correctly **for the machine it is meant for**: the owner defines their machines (number input, G-code system, diameter, power-on modes) once and picks one per document, and without a machine gEdit says what it assumes. Quitting from the Dock or logging out can no longer lose work on macOS.

**Prelude P6:**
1. Cut `feat/phase-2` at `c18fba2` (W0). Record the owner decisions D23, D24, D34, D35 and D45 (§10.1) in the commit body.
2. `src-tauri/Cargo.toml`: `[target.'cfg(target_os = "macos")'.dependencies] objc2 = "0.6"`. `cargo tree -i objc2 --offline` shows 0.6.4; `tests/runtime/sync.sh` still patches cleanly (F28). `npm run licenses`.
3. Rust stub `src-tauri/src/quit.rs` (§7.10: `QuitGuard`, `quit_guard_set_dirty`, `install`, `decide`); in `lib.rs`: `mod quit;`, `.manage(quit::QuitGuard::default())`, `quit::install(handle)` from `setup_app`, the command registered. Keep the single `tauri::Builder::default()` and `generate_handler![` anchors (P1 AD-15).
4. Contracts: §7.1 (the M6 profile fields, `machineParams` included), §7.2 (`CodeSets` with `diameter`, `CodeEntry.sets`, `CodeParam.unit`, `CodeDbFile.extends/remove`), §7.3 (`ProfileInfo` additions, `ProfileRegistry.effective`, `CodeDbService.byId`), `ModalState` and friends in `core/nc/types.ts` (§7.4), **§7.15** (`core/machines/types.ts`: `MachineConfig`, `MachineParams`, `NumberInput`, `EffectiveMachine`, `EffectiveProfile`, `MachinesFile`; `MachineService` in `app/types.ts`; `DocMeta.machineId`; `ScriptContextV2.machine` and `BuildContextInput.machine` in `core/scripting/types.ts`; `TransformContext.machine` in `core/transforms/types.ts`; `ConfigLoad.machines`/`machinesError`, `machinesSave`, `machinesOpenFile` and `quitGuardSetDirty` in `platform/commands.ts`).
5. **Implement** (§5.2 rule 2), with unit tests:
   - `core/profiles/resolve.ts` (`mergeProfile`, `resolveProfiles`) and `core/codes/resolve.ts` (`resolveCodeDbs`);
   - `core/machines/effective.ts` (`defaultParams`, `effectiveMachine`, `applyMachine`, `effectiveKey`, `compatible`; §7.15). With no machine and no detected variant, `applyMachine` returns the resolved profile unchanged apart from `modal.units`, `modal.diameter` and `modal.sources` (unit test over every built-in);
   - the minimal registry change in `stores/profiles.ts` and `stores/codes.ts`: resolve, then validate and compile; `BUILTIN_PROFILE_JSON` = the resolved built-ins; `profiles.effective(profileId, eff)` (apply, validate, compile, cache by `eff.key`) and `codes.byId(dialect)`;
   - `toolCall.ignore` in `core/profiles/compile.ts` (`re.toolIgnore`), `core/profiles/outline.ts` (a trigger line that also matches `ignore` on the masked line is not a tool line) and the Python compile/outline twin.
6. **The effective view, mechanically** (F49): a stub `stores/machines.ts` whose `effective(docId)` always answers "none" (profile defaults, no detection yet) through `profiles.effective`, and `app/bootstrap.ts` calls `machines.load(configLoad)` after settings and before the contributions (WP6.8 then only replaces bodies); every consumer switches to it: `app/transforms.ts`, `app/scripts.ts` (and `core/scripting/context.ts`: `machine` into the context, `profile`/`codes` from the effective view), `app/outlineService.ts` (rebuild when the effective key changes, not only the profile id), `contrib/navigation.ts`, `monaco/providers/{hover,completion}.ts` (document through `docIdOf(model)`; a model without a document uses the profile defaults), `monaco/languages.ts` (the grammar from the union of the profile's variant databases). With the stub, every P1 unit, Python and harness test passes unchanged.
7. Python, no behavior change: split `gedit_nc.py` into `gedit_nc.py` (facade: context, report, envelope, re-exports of every public name and every name a P1 test uses), `_nc_lex.py` (tokenizer, numbers, number format, profile compile, `ignore`), `_nc_modal.py` (`FeedModeTracker`, `prime_tracker`, the `ModalInterpreter` stub of §7.4) and the stub `_nc_machine.py` (§7.15 signatures; `machine_params(ctx)` already answers the profile defaults). Every P1 Python test passes unchanged. `tests/python/helpers.py` gains `resolved_profile(id)`, `resolved_codes(id)` and `effective_context(...)`, all reading `tests/fixtures/resolved/**`: `effective_context(golden=<path>)` gives the context of that golden (index lookup, item 12), `effective_context(profile_id, preset=…, variant=…)` the context of a declared preset or variant, and `effective_context(profile_id)` the profile defaults. A missing entry fails with "run `UPDATE_RESOLVED=1 npm test -- resolved`", never with a guessed profile; Python never merges a machine into a profile itself, so a Python test that needs a machine names it in a fixture file (a golden's `machine` member), never as an inline dict.
8. Rust: `config.rs` gains `read_json_object_versioned(path, name, version)` and `save_json_object_versioned(…, version)`; the P1 functions call them with `SETTINGS_VERSION`, so `settings.json` and `state.json` behave exactly as before (every P1 cargo test unchanged). `paths.rs` gains `MACHINES_FILE_NAME` and `machines_file()`. `ConfigLoad` gains `machines` and `machinesError`, read in the same round trip, and `ConfigPaths` gains `machinesFile` (the webview needs it to tell the machines document from any other, exactly as `settingsFile` does in `contrib/settings.ts`). Stub `src-tauri/src/machines.rs` (`MACHINES_VERSION`, `machines_save`, `machines_open_file`; §7.10), registered under the single `generate_handler![`.
9. Settings dialog: after the schema pages, a **Machines** page that renders `components/dialogs/MachinesPage.svelte` (a stub that lists nothing), so WP6.10 owns only the page. The i18n keys for the page title in `i18n/en/settings.ts`.
10. Contract-bearing data (mechanical, preserving P1 behavior): `sets` on the existing `fanuc.json` entries (G17–G19 plane, G20/G21 units, G90/G91 distance, G93–G95 feed unit, G96/G97 speed unit, `cycle: start` on every cycle entry P1 treats as a start and `cancel` on `G80`, `speedLimit` on `G50` and `G92`); `machineType: "mill"`, `modal.initial: { "feedmode": "G94" }` and the `machineParams` of §8.8 on `fanuc-gcode.json` (its default preset is IS-B, which gives `decimalPointSignificant: true`, the P1 value); `machineType: "mill"` and `addresses.feedUnitWords: { "FU": "per-rev", "FZ": "per-tooth" }` on `heidenhain-klartext.json` (no `machineParams`), with the matching `sets` on the Klartext cycle entries. Lathe stubs `data/profiles/fanuc-lathe.json` (with the `gcodeSystem` variant, no detection rules yet) and `data/codes/{fanuc-lathe,fanuc-lathe-b}.json` (valid, with `extends`, only the feed-mode and spindle-mode entries and their `sets`), registered in both `index.ts` files.
11. Split `tests/fixtures/expected/detect/fixtures.json` into `detect/<folder>.json`; `core/profiles/detect.test.ts` globs them.
12. `tests/unit/resolved.test.ts` and the generated `tests/fixtures/resolved/**`. Beside `resolved/{profiles,codes}/<id>.json` it writes the **effective** profiles, so that Python tests and G10 read what `applyMachine` produced and nothing re-implements the merge:
    - `resolved/effective/<profileId>/{defaults,preset-<id>,variant-<id>-<value>}.json` — one per declared preset and variant, for the G10 review (§8.7 item 5a);
    - one file per distinct effective context used by a golden: the test walks `tests/fixtures/{modal,scripts,machines}/**`, takes each golden's `machine` member (absent = none, with the variants **detected** on that golden's input), computes the effective profile and writes `resolved/effective/<profileId>/k-<hash>.json` (hash of the canonical JSON of the context's `machine` block), holding the profile, the compiled database id and that `machine` block;
    - `resolved/effective/index.json` — golden path → its file, so a Python test looks its context up by the golden it runs and never computes an effective key of its own.
    `UPDATE_RESOLVED=1` rewrites all of it; a run without it compares, and a missing entry fails with "run `UPDATE_RESOLVED=1 npm test -- resolved`" (§5.2 rule 3). Also `tests/fixtures/modal/README.md` with the golden format (§7.4).
13. Real-program infrastructure (§9.2), skipping cleanly while there are no programs: `.gitignore` entries `/tests/real/*` and `!/tests/real/README.md`; `tests/real/README.md` (what may go there, that it is never committed, the manifest format); `tests/unit/realFixtures.test.ts` and `tests/python/test_real_fixtures.py` (folder: `GEDIT_REAL_FIXTURES`, else `<git rev-parse --git-common-dir>/../tests/real`, so a worktree run sees the main working tree; "not found" and "no manifest" are distinct skips; no snapshot API, standing rule 12, and every golden they write stays in that folder); `tests/gen/check-anonymized.mjs` (for files the owner proposes to publish); the `owner-public` exemption in `tests/unit/fixtures.test.ts` (no marker required under `tests/fixtures/nc/owner-public/`, a README line with the owner's permission still required). FX owns these files afterwards.
14. Harness: `h_config_read(name)` (reads `settings.json`, `state.json` or `machines.json` from the app's config or data folder; fixed names only) in `tests/runtime/harness/harness.rs`; `h.app.ctx.machines`; helpers in `tests/runtime/lib/api.js`.
15. `npm run check && npm test && cargo check && python3 -m unittest discover -s tests/python -t .`; commit. P6 is larger than P1's preludes; it may commit in two green steps (items 1–5 and 7–14 as contracts, stubs and data; then item 6, the effective-view switch, alone, so a P1 regression points at one diff).

**Intentional behavior changes in M6** (H6 may update earlier scenarios and goldens only for these):
- A lathe program opens as `fanuc-lathe`, with G-code system A or B detected. Every P1 fixture keeps its dialect; if one would move (`f04-feed-modes.nc` has `G50 S` and `G96`), WP6.2 tunes the weights so it stays a mill file; if that is not possible, it records the move in its hand-off note and G10 decides (P1 fixtures are not edited).
- The mill profile no longer treats `G70–G73 P/Q` as block references.
- Renumber rewrites local references instead of only warning; remove-block-numbers keeps referenced numbers by default.
- `tool_list`'s "a turret lathe needs a lathe profile" warning appears only on a mill profile.
- Dock → Quit and logout with a dirty document show the unsaved-changes alert.
- The status bar has a machine item on Fanuc documents ("Machine: none" until the owner defines machines); the settings dialog has a Machines page. H6 updates the P1 scenarios that count status items or settings pages.
- The script context carries `machine`, and its `profile` is the effective profile (identical to P1's for the P1 profiles with no machine).

**Wave A**

#### WP6.1 Profile validation, registry info and the resolved code databases

- **Owns:**
  - `src/lib/core/profiles/{resolve,validate,detect}.ts` and their tests (P6 wrote `resolve.ts`; WP6.1 owns it from Wave A on)
  - `src/lib/core/codes/{resolve,load,lookup}.ts` and their tests
  - `src/lib/stores/{profiles,codes}.ts` and their tests
  - `src/lib/contrib/profileSelect.ts`, `src/lib/i18n/en/profiles.ts`
  - `tests/unit/resolved.test.ts`
- **Depends on:** P6.
- **Deliver:**
  - Validation of the new fields: `machineType`, `modal.initial` (group names are strings, codes normalize), `addresses.incremental`/`diameter`/`angular`/`feedUnitWords`, `toolCall.ignore`, `numbering.references[].rewrite`, every `sets` value and `CodeParam.unit` against §7.2, and "a child sets its own `id`, `name`, `shortName`". `modal.units`, `modal.diameter` and `modal.sources` are **accepted** on the way in (`applyMachine` writes them before validation, AD-31) but reported when a profile **source file** carries them.
  - Validation of `machineParams` (§7.1): preset ids unique, one default, every `NumberInput` well-formed (`mode` one of `increment` / `calculator` / `scale`; increments and units are decimal text `0.0…01` or `1`; `incrementDeg`/`incrementSec` likewise; known classes only, and an inch increment only on a class that follows `units`); a variant's default is one of its choices; every `codes` names a database that resolves; overlays touch only `modal`, `toolCall`, `numbering`, `addresses`; detection patterns compile; `modalGroups` are group names of the database; **the profile's own `syntax.decimalPointSignificant` agrees with its default preset** — `true` only when that preset's length class is `increment` — so "none" equals the JSON.
  - `profiles.effective(profileId, eff)` (P6's version) hardened: the cache is keyed by `eff.key`, dropped on a registry change, and an overlay or variant that fails validation is reported once and falls back to the profile defaults.
  - Variant detection `detectVariants(cp, text)` in `core/profiles/detect.ts`: per variant the winning choice and its margin over the runner-up (≥ 3 to count as `detected`, otherwise the variant's default); read from the first 400 masked lines. **A variant pattern scores its weight once (presence), not per line** — unlike profile detection (P1 detect.ts rule 2), because a marker that a post repeats in every block (system B's `G99 G83 …` cycle-return lines, which match the system-A `G98`/`G99` rule) would otherwise outvote a single decisive marker such as one `G92 S`.
  - `ProfileInfo` carries `machineType`, `origin`, `parent` and `hasMachineParams`; the status picker groups children under their parent ("Fanuc (ISO) · mill / lathe").
  - Detection tie-break: `priority`, then user over built-in, then the current or default profile.
  - The code-database service serves resolved databases (`extends`, `remove`, aliases re-checked) by profile and by id (`byId`, for the variant databases); lookup and completion see them.
- **Tests:** the merge table (nested objects, arrays replace, `null` replaces, `extends` kept, `$schema` dropped); parents after children; unknown parent, cycle, depth 5; a child that inherits `id`; database override, `remove`, an alias colliding after the merge; detection ties with three inline profiles; `machineParams` validation (each rule above, one failing case each); variant detection margins on inline texts, including a text that repeats one variant's marker six times against a single marker of the other (presence scoring: the single marker wins); `effective` caching (same key → same object; a new key → a new compiled profile).
- **Acceptance:** with only the built-ins, `profiles.list()` and every P1 test are unchanged apart from the new lathe entry; resolving all built-ins takes ≤ 20 ms and one effective compile ≤ 5 ms in node.
- **Covers:** "User profiles with `extends`" (mechanism); code-database inheritance; AD-31 (profile side).

#### WP6.2 Fanuc lathe content, the mill corrections and fixtures

- **Owns:**
  - `src/lib/data/profiles/{fanuc-gcode,fanuc-lathe}.json`, `src/lib/data/profiles/index.ts`
  - `src/lib/data/codes/{fanuc,fanuc-lathe,fanuc-lathe-b}.json`, `src/lib/data/codes/index.ts`
  - `tests/fixtures/nc/fanuc-lathe/**`, `tests/fixtures/nc/ambiguous/mill-4digit-t.nc`, `tests/fixtures/expected/detect/{fanuc,fanuc-lathe,ambiguous}.json`, `tests/fixtures/expected/outline/fanuc-lathe/**`, `tests/fixtures/tokens/fanuc-lathe.json`, `tests/fixtures/README.md`
- **Depends on:** P6.
- **Deliver:**
  - The profile of §8.1 (with its `machineParams`: the inherited presets with the lathe's own default `calculator` and `syntax.decimalPointSignificant: false`, `gcodeSystem` A/B with their databases, overlay and detection rules, diameter on, the offered modal groups) and the databases of §8.2 (`fanuc-lathe-b` as the B variant database), in our own words from `syntax-fanuc.md` §4–§8; uncertain entries carry `verify: true`; every preset and default names where it comes from or is marked "documented default, verify" (§8.8).
  - `CodeParam.unit` on every cycle parameter **exactly as the table in §8.2 gives it** (that table is the single place these are written down; AD-31's class order reads it first): the µm steps and pecks `increment`, the dwell times and repeat counts `count`, `G4` `X`/`U` `dwell`. The same `count` entries on the mill cycles of `fanuc.json` (§8.3), so a repeat count `K`/`L` is never mistaken for an arc centre or a length.
  - The mill corrections of §8.3: the `G70–G73` rule removed; mill markers and `priority: 1`; `G43`/`G44`/`G49` to group `lengthComp`; `G50` on the mill reworded as `verify`; `G92`/`G76` keep `pitchFeedAmbiguous` on the mill (a lathe program opened with the mill profile by hand must stay protected); `min` stays until M8; the mill's `machineParams` data from P6 reviewed.
  - The synthetic fixtures of §9.1 (M6 rows) and their detection (profile **and** variant), outline and token goldens (spec goldens, §5.2 rule 3).
- **Tests:** the database data test (no duplicates after resolution; every `pitchFeed` code is `cycle` or `motion`; every `sets` value valid; **every parameter of the §8.2 table carries exactly the `unit` that table gives it, in the lathe and in the mill database, and no other parameter carries one**; lathe `G74` is **not** `pitchFeed`; the B variant database changes no address and no non-numeric word code, so the union grammar equals each variant's); detection goldens for every fixture, P1 fixtures included, with a margin ≥ 3 between the winner and the runner-up; variant goldens: `l01-turning-a.nc` → A, `l05-system-b.nc` → B, each with a margin ≥ 3, a program with neither marker → the default A, not `detected`, and a **system-B drilling program with six `G99 G83` blocks and one `G92 S`** → B with a margin ≥ 3 (the presence rule of WP6.1); outline goldens with the tool lines (`T0101`, `T101`, `T0303 G00 X…`, `T0111`; never `T0100`); the mill lookalike `nc/ambiguous/mill-4digit-t.nc` (`T1001 M6`) stays mill; token goldens ≥ 60 lines.
- **Acceptance:** G10 passes on `tests/fixtures/resolved/{profiles,codes,effective}/fanuc-lathe*` and on the mill changes.
- **Covers:** "Fanuc lathe child profile"; X1 (content).

#### WP6.3 Reference-aware renumbering

- **Owns:**
  - `src/lib/core/transforms/{renumber,references,removeBlockNumbers}.ts` and their tests
  - `tests/fixtures/transforms/{renumber,remove-block-numbers}/**` (new cases)
  - `src/lib/contrib/ncNumbering.ts`, `src/lib/i18n/en/ncNumbering.ts`
- **Depends on:** P6.
- **Deliver:**
  - Renumber builds an old → new map per program (per `restartAtProgramStart` segment) and rewrites the values of reference words whose rule has `rewrite !== false` (§7.1). The written form is kept: zero padding as written, no decimal point.
  - A reference is **not** rewritten, and is reported, when its target is missing, when the old number occurs more than once in that program, when the target lies outside the renumbered scope, or when its rule says `rewrite: false` (`M99 P`: the target may be in the caller, F42).
  - The preflight asks only about references that will not be rewritten.
  - Remove-block-numbers gains `keepReferenced` (default true when the profile has reference rules): a number that a reference points at stays.
  - The summary reports rewritten, kept and unresolved references; the unresolved ones go to Results with their lines.
- **Tests:** goldens for `G71 P100 Q200` + `G70 P100 Q200`, `G73`, `GOTO 100`, `IF […] GOTO100`, `M98 Q50` (rewritten), `M98 P2000 Q50` (reported), `M99 P30` (reported), a duplicate target, a missing target, a selection with a reference outside it, two programs in one file, `P0100` padding; remove-block-numbers keeping `N100`/`N200`; 100k lines ≤ 1 s.
- **Covers:** "Reference-aware renumbering" (from P3, local numeric references); the Phase 1 renumber-reference finding (P1 G8 M4).

#### WP6.4 The Python modal interpreter

- **Owns:** `src-tauri/resources/scripts/_nc_modal.py`, `tests/python/test_modal.py`, `tests/fixtures/modal/{fanuc-gcode,heidenhain-klartext}/**`.
- **Depends on:** P6.
- **Deliver:**
  - `ModalInterpreter` exactly as §7.4 and AD-19, reading the power-on state (`modal.initial`, `modal.units`, `modal.diameter`, each with its `from` taken from `modal.sources`) from the **effective** profile it is given; `sets.diameter` and `sets.units` switch the diameter mode and the units; a database without any `sets.distance` gives `distance: 'absolute'`, not assumed (AD-19 rule 8); `units` is a value with its line, `assumed` flag and source, like every other assumed value (§7.4).
  - `FeedModeTracker` reimplemented on top of it, with the P1 attribute values (`feed_mode` stays `'G94'`/`'G95'`/`'G93'`/`'FU'`/`'FZ'`), so `scale_feed`, `scale_speed`, `tool_list` and user scripts keep working unchanged.
  - Helpers `machine_type_of(profile)`, `incremental_axes(profile)`, `diameter_axes(profile)`, `speed_limit_of(codes, tokens)`.
  - Goldens for `fanuc-gcode` and `heidenhain-klartext` (≥ 30 states each: feed modes, CSS, modal and cancelled cycles, `G41` kept across `G49`, the Klartext `FU`/`FZ` reset, a variable feed), plus `fanuc-gcode` cases run with a machine whose `modalInitial.feedmode` is `G95` (the golden's `machine` member, §7.4). The lathe rules are covered by unit tests over inline code lists (`G98`/`G99`, `G96`/`G97`, a `G50 S` clamp, one-shot `G71`/`G76`, modal `G92` with pitch feed cancelled by `G00`, a `DIAMOF`-like `sets.diameter` entry, a database without distance codes → `distance: 'absolute'`); the lathe goldens come in Wave B (WP6.6).
  - The API text for `src-tauri/resources/scripts/README.md` in the hand-off note (WP6.7 writes it).
- **Tests:** the goldens (each one's context read through `effective_context(golden=…)`, P6 items 7 and 12); every P1 Python test unchanged; a one-shot cycle does not leak into the next block; an unknown code changes nothing; `initial` is honored and marked assumed with `from` `'profile'`, `'detected'` or `'machine'` as `modal.sources` says, absent means `unknown`.
- **Covers:** "Modal interpreter" (Python half).

#### WP6.5 The macOS quit guard

- **Owns:** `src-tauri/src/quit.rs`, `src/lib/contrib/quitGuard.ts`, `src/lib/contrib/quitGuard.test.ts`.
- **Depends on:** P6.
- **Deliver:**
  - `install` per AD-20: `[NSApp delegate]`, its class, `respondsToSelector:` check, `class_addMethod(…, c"Q@:@")`, re-assign the delegate; the method reads the guard through a `OnceLock<AppHandle>`, returns `decide(dirty)`, and when dirty schedules `menu::request_quit` with `run_on_main_thread`. Failures are logged.
  - `quit_guard_set_dirty` stores an `AtomicBool`; non-macOS: `install` is a no-op and the command only stores the flag.
  - `contrib/quitGuard.ts` subscribes to `docs.list`, calls `quitGuardSetDirty` on every flip of "any document dirty" and once at start, and with `false` in `files.onWillQuit`.
- **Tests:** cargo tests for `decide` and the flag; on macOS, `install` on a class made in the test with `ClassBuilder` adds the selector and `respondsToSelector:` is then YES, and a class that already has it is left alone; vitest for the flip-only calls and the `onWillQuit` reset (fake command).
- **Covers:** P1 D10 (Dock → Quit, logout) on macOS; X3 (part).

#### WP6.8 Machine configurations: service and storage

- **Owns:**
  - `src/lib/stores/machines.ts` and its test (P6 wrote the stub)
  - `src/lib/core/machines/{effective,file,validate}.ts` and their tests (P6 wrote `effective.ts`; WP6.8 owns it from Wave A on)
  - `src-tauri/src/machines.rs` and its tests
  - `tests/fixtures/machines/files/**` (valid, broken, newer-version and record-level-invalid `machines.json` samples)
- **Depends on:** P6.
- **Deliver:**
  - `core/machines/file.ts`: `parseMachinesFile(raw)` (tolerant: invalid records kept verbatim in `invalid` with their problems, unknown members kept, `defaults` pointing at a missing machine ignored) and `serializeMachinesFile(file)` (stable order, the invalid records and unknown members written back).
  - `core/machines/validate.ts`: a record against its base profile's declaration (§7.15 rules: id and name format and uniqueness, base profile known, every parameter one of the declared choices or a well-formed `NumberInput`, `modalInitial` groups offered and codes in the effective database); problems carry a JSON path. A record whose base profile is unknown (a user profile not loaded yet) is kept and inactive.
  - `stores/machines.ts`: the `MachineService` of §7.15: `load(configLoad)` at bootstrap (after settings, before the first document opens), `reloadFromDisk()` (a fresh `configLoad`, parse, problems and revision updated, every open document's effective view re-evaluated — the same shape as `settings.reloadFromDisk`, so a hand edit saved in the editor is never overwritten by the next page action), `isMachinesDocument(id)` (through `docs.byPath(paths.machinesFile)`, as `contrib/settings.ts` does), list, add, update, duplicate, remove, `setDefault`, `openFile`, `replaceWithEmpty`; every change saved at once through `machinesSave`, a failed save shown with the file kept as it was, and **every write refused while the file could not be read** (`problems()` names it; only `openFile` and `replaceWithEmpty` are allowed then); `effective(docId)` in the AD-31 order (document choice → profile default machine → none, variant detection only without a machine), `setForDoc`, the mismatch warning once per open, re-evaluation on a profile switch and on machine changes, and `revision`. Per-file persistence of the choice comes in M7 (WP7.5).
  - `machines.rs`: `machines_save` and `machines_open_file` per §7.10 through the versioned `config.rs` helpers; `MACHINES_VERSION = 1`.
- **Tests:** parse/serialize round trips of every sample (a broken file → no machines + `machinesError`; a newer version read-only; an invalid record kept and written back byte-stable); validation rules one by one; the selection order (explicit machine, explicit none, profile default, none; a vanished id; an incompatible machine after a profile switch); detection only without a machine; explicit A on a B-looking text → A plus one mismatch warning; **reload:** a file changed on disk (a per-class `numberInput` value added by hand) then `reloadFromDisk` then `setDefault` writes the hand edit back, not the stale copy, and the effective view of an open document follows; a write attempt while `machinesError` is set is refused; cargo tests for the size cap, atomic write, `.bak` rescue, newer-version refusal and the one-file grant of `machines_open_file`.
- **Covers:** AD-31 (service, storage); X11 (a, b, e).

#### WP6.9 How the control reads numbers (TS and Python)

- **Owns:** `src/lib/core/machines/numbers.ts` and its test, `src-tauri/resources/scripts/_nc_machine.py`, `tests/python/test_machine.py`, `tests/fixtures/machines/numbers.json`.
- **Depends on:** P6.
- **Deliver:** `numberClassOf`, `valueOf`, `writeBack`, `readingsOf`, `resolveValue` (TS) and `number_class_of`, `value_of`, `write_back`, `readings_of`, `resolve_value`, `machine_params` (Python) exactly as §7.15, decimal-string arithmetic only (no floats; `Decimal` in Python, as P1 §7.10), rounding half away from zero; one golden file both languages pass: ≥ 80 cases over IS-B, IS-C, calculator, Okuma 1 µm, 10 µm and 1 mm, metric and inch, each class, per-class overrides, all three readings, `unit: 'increment'` and `count` parameters, signs, `F.15`, `-0`, zero, values at the increment limit, a value finer than the increment (rounded and flagged), and an unknown class (no value). Named cases the review checks by hand: **`scale`** — `X0.1` under 10 µm = 0.001 mm, `X1000` = 10 mm, `F23.456` = 0.23456 mm/rev, `F234.56` under 1 µm = 0.23456 mm/rev, and `X1` = `X1.0` = 1 mm under 1 mm; **angles and dwell ignore `units`** — `C90000` under IS-B is 90° in a metric and in an inch program, `G4 X2500` under IS-B is 2.5 s in both; **the class order** — one case per step of the AD-31 list (a `G83 … Q6000` `increment` parameter beating the length rule, a `G4 F2` dwell in an `fNotFeed` block, an `F` lead in a `G76` block read as per revolution although the modal feed mode says per minute, a `C` angle, a feed by modal unit, an axis, and `K3`/`L2` counts with no value); **no machine** — the readings of a point-less `X50` under the Fanuc presets differ (no value), those of `X50.` agree (50 mm), and every Okuma length word differs. The API text for the scripts README in the hand-off note.
- **Tests:** the golden file in vitest and unittest; `machine_params({})` and a context without `machine` give the profile defaults with every source `profile`; `write_back` keeps a point, keeps a point-less word point-less while the result is whole and reports the rounding otherwise, in all three readings.
- **Acceptance:** G10 (the number rules, against F52 and §8.8).
- **Covers:** AD-31 (numbers); X11 (c, d, the number half).

#### WP6.10 Machine configurations: status item and Settings ▸ Machines

- **Owns:** `src/lib/core/machines/fields.ts` and its test, `src/lib/contrib/machineSelect.ts` and its test, `src/lib/components/status/MachineStatus.svelte`, `src/lib/components/dialogs/MachinesPage.svelte` and its test, `src/lib/i18n/en/machines.ts`.
- **Depends on:** P6 (the `MachineService` contract and stub).
- **Deliver:**
  - The status item of AD-31 (`status-item`, `data-item="machine"`, next to the profile item; hidden without `machineParams`): name or "none", the assumed marker, the tooltip with every effective parameter and its source; `file.setMachine` (quick pick: None, compatible machines, Other machines…, Manage machines…); `machines.manage` (opens Settings ▸ Machines) and `machines.openFile` in the palette; `activate()` registers `files.onDidSave` → `machines.reloadFromDisk()` for the machines document (`machines.isMachinesDocument(id)`), exactly as `contrib/settings.ts` does for `settings.json`, and shows a reload error as a status message while the file is still open.
  - The Machines page: the list control (modeled on the `scripts.folders` control, F46) with Add, Edit, Duplicate, Remove (confirm when documents use the machine), "Default for its profile" and "Open machines file"; problems shown per row; while the file could not be read, the write actions are disabled and only "Open machines file" and "Replace with an empty file" are offered (AD-31 Management); Add = pick the base profile, then the parameter form; Edit = the parameter form, both through `modals.form` with a `FieldSpec[]` generated from the profile's declaration (§7.15 `machineFields`); a preset that no longer matches the stored `numberInput` shows as "Custom (edited in the file)" and is kept unless the user picks a preset.
  - Test ids of §7.12.
- **Tests:** `machineFields` for each built-in declaration (field types limited to `text`, `choice`, `bool`); the page actions with a fake `MachineService`, including the error state (write actions disabled, the two allowed actions offered); the save hook calls `reloadFromDisk` for the machines document only; the quick-pick items and the profile switch when an "other" machine is picked; the tooltip text with sources.
- **Covers:** AD-31 (UI); "Full settings dialog" (Machines page); X11 (a, b).

**Wave B**

#### WP6.6 Lathe-aware bundled scripts

- **Owns:**
  - `src-tauri/resources/scripts/{scale_feed,scale_speed,tool_list}.py`
  - `tests/python/{test_scale_feed,test_scale_speed,test_tool_list}.py`, `tests/fixtures/scripts/{scale_feed,scale_speed,tool_list}/**`
  - `tests/fixtures/modal/fanuc-lathe/**` (system A and system B cases, told apart by the golden's `machine` member)
- **Depends on:** WP6.2, WP6.4, WP6.9 (and the I6 regeneration of the resolved files).
- **Deliver:**
  - `scale_feed`: `perRevolution` becomes a choice **auto / yes / no** (auto = yes on a lathe profile, no on a mill; F33 makes a remembered `false` fall back to auto). Thread leads (`pitchFeed`, unambiguous on the lathe databases) are never scaled and are reported; findings name the code ("a feed per revolution (G99)"). Feeds inside the `P…Q` profile of `G71`–`G73` are ordinary feeds.
  - `scale_feed` and the machine: the limits (`minFeed`, `maxFeed`, `onlyAbove`, `onlyBelow`) compare **effective** values (`resolve_value` with the context's machine; F48); a feed with no resolved value — no class, an unknown feed unit, or a reading that depends on a machine nobody chose (AD-31 "No machine, no guess") — is still scaled as a count but not compared with a limit, and is reported; a clamped value is written back with `write_back` in the word's own form. The run's summary names the machine ("machine 'Lathe 2'" or "no machine: profile defaults assumed"). With the profile defaults of `fanuc-gcode` every P1 golden is unchanged (the Fanuc default preset reads feeds as written, §8.8).
  - `scale_speed`: `surfaceSpeed` becomes auto / yes / no; the clamp comes from `sets.speedLimit` (`SPEED_LIMIT_CODES` goes, F24); the clamp is never scaled by default and is reported. `S` has no number class (AD-31), so the decimal mode never changes it.
  - `tool_list`: stations from the profile's `tool` group; an "Offsets" column (`01, 11`); the turret warning only on a mill profile. It reads the effective profile and database of the context, so a variant or a later `toolCall` overlay needs no script change.
  - Lathe goldens for the three scripts and for `tests/fixtures/modal/fanuc-lathe/`.
- **Tests:** every P1 golden unchanged except the listed intentional changes; lathe cases: `G99` feed scaled; `G32`, `G76` (both blocks), `G92` untouched and reported; `G96 S` scaled under auto and untouched under no; `G50 S2500` untouched; system B (context with `variants.gcodeSystem: 'B'`): `G95` scaled, `G92 S` a clamp; the same B text run with a system-A context follows A; `T0100` is not a tool; `T0111` is station 1 with offset 11; `l06-decimal.nc` under IS-B, calculator and **no machine**: `F155` → `F140` in all three; a `maxFeed` limit compares the effective value (as written under every Fanuc preset, whose feed classes read feeds as written, so the limit still applies with no machine; `0.155` under a machine whose `feedPerRev` class is in increments of 0.001); a feed with no resolved value is scaled, not limited, and reported; the fanuc-lathe A goldens show `distance: 'absolute'` with no distance code in the program (AD-19 rule 8).
- **Covers:** the bundled scale feed / scale speed / tool list on lathes; X1 (scripts); X11 (c, scale feed).

#### WP6.7 Documentation

- **Owns:** `docs/user/{README,dialects,scripts,transformations}.md`, `docs/user/machines.md` (new), `docs/planning/README.md`, `src-tauri/resources/scripts/README.md` (the API section, from the WP6.4 and WP6.9 hand-off notes).
- **Depends on:** Wave A.
- **Deliver:** the lathe profile in `dialects.md` (what it decides, the T-word rule, systems A and B as a machine setting, how detection and an explicit machine interact); `machines.md`: what a machine configuration is, each parameter with the profile defaults of §8.8 **as defaults, not facts**, the three ways a control reads numbers (increments without a point, everything as written, or a unit system that scales every number) with one example each, how to read the setting off the machine (the decimal-point / input-increment / unit parameter, the G-code system, the power-on feed mode) without naming parameter numbers we have not verified, what "none" assumes, what it refuses to compute and how both are shown (D57), where `machines.json` lives and how to back it up; the reference rewrite in `transformations.md`; the new script options and `gedit_nc.machine_params` in `scripts.md`; the Dock-quit limit removed from "What gEdit does not do" (it stays for a Windows/Linux logoff, D28); "Current state".
- **Covers:** G8 docs check.

#### H6 Harness M6

- `m6-lathe-detect`: the lathe fixtures open as `fanuc-lathe`, the machine item shows system A or B as detected; the P1 fixtures keep their dialect; a manual switch works.
- `m6-machines-manage`: Settings ▸ Machines: add "Lathe IS-B", duplicate as "Lathe calc", edit, set a default, remove; `h_config_read('machines.json')` equals the golden after each step; restart with the same `--home` lists them; "Open machines file", add a per-class `numberInput` value by hand, save, then "Default for its profile": `h_config_read` still shows the hand edit (the save reloaded it); a broken file (written by the scenario before the start) gives one notice, no machines and a page whose write actions are disabled, and "Replace with an empty file" leaves `machines.json.bak`.
- `m6-machines-select`: on a lathe fixture "Machine: none" with the assumed marker; pick a machine, then none; a user script `tests/runtime/fixtures/scripts/machine_report.py` (written by H6) reports `gedit_nc.machine_params(ctx)` and the report rows equal the golden for none, IS-B and calculator; the B fixture with a system-A machine shows one mismatch warning and keeps A; picking a machine of another profile switches the document's profile.
- `m6-lathe-nav`: F7/Shift+F7 visit the golden tool lines and wrap; the map's tool labels; hover on `G76`, `G71`, `X`, `U`.
- `m6-lathe-scripts`: scale feed 90 %, scale speed 110 %, tool list; golden bytes; one undo each.
- `m6-lathe-renumber`: golden bytes with rewritten P/Q; one undo; `M99 P` reported.
- `m6-dock-quit-dirty`: two dirty documents, `h_quit('terminate')` → exactly one alert; Cancel keeps the app and both documents; a second `terminate` then Discard All exits.
- `m6-dock-quit-clean`: no dirty document → `terminate` exits without an alert, and `h_pgrep` finds no script process.

**Integration I6:** merge Wave A; regenerate `tests/fixtures/resolved/**` (`UPDATE_RESOLVED=1 npm test -- resolved`, the effective profiles included) before Wave B starts, so WP6.6 and the Python tests read the real lathe databases and variants; check that WP6.10's UI runs against WP6.8's service (both were built against the P6 contract); apply the G10 *changed* items.

**Gates:** G0–G6 (`m0`–`m6`); G7 (P1 budgets unchanged; detection of a 400-line file against every M6 profile plus variant detection ≤ 5 ms in node; one effective compile ≤ 5 ms; a machine switch on a 100k-line document rebuilds the outline within the P1 outline budget; renumber with rewrite on 100k lines ≤ 1 s); G8 (capability diff empty, `objc2` confined to `quit.rs`, standing rules 12 and 13, `machines.rs` takes no path); G10 (the lathe profile, its `machineParams` and variants, the databases, the mill corrections, the number rules, the script behavior); G11 if the owner has local lathe programs (on their machine).

**Commit:** `M6: Fanuc lathe profile, machine configurations, profile inheritance, reference-aware renumbering and the macOS quit guard`

---

### M7: Never lose work (backup, recovery, session, per-file memory, read-only)

**Goal:** a crash, a power cut, a Windows logoff or a bad save never costs the owner an edit, and gEdit comes back the way it was left.

**Prelude P7:**
1. Settings keys of §7.11 in `core/settings/schema.ts`, labels in `i18n/en/settings.ts`.
2. Contracts §7.9: `DocMeta.readOnly`/`readOnlyReason`, `FileOps.restoreDocument`/`setReadOnly`/`onWillClose`, `BookmarkService.set`, `UiState.files`, `FileMemoryStore` (with `machineId` and `machineFor`), `SessionService`, `RecoveryService` (the snapshot metadata carries `machineId`); the stubs for `restoreDocument`, `setReadOnly` and `onWillClose` in `app/fileOps.ts`, `set` in `monaco/bookmarks.ts`, and `stores/fileMemory.ts`, so WP7.4 and WP7.5 can call them before WP7.3 lands.
3. Rust stubs `backup.rs`, `recovery.rs`, `session.rs` (§7.10), registered; `setup_app` calls `recovery::start_session` and `session::grant_on_startup`; `paths.rs` `ensure_dirs` for `backups/` and `recovery/` (0700).
4. `platform/commands.ts` wrappers; `recoveryPut` sends raw bytes plus the `x-gedit-recovery` header.
5. Harness: `h_crash()` (the app sends itself `SIGKILL`) and `h_recovery_dir()` in `tests/runtime/harness/harness.rs`, helpers in `tests/runtime/lib/api.js`.
6. TS stubs `app/recovery.ts`, `app/session.ts`; commit.

**Intentional behavior changes in M7:**
- Saving an existing file first writes a history backup (default).
- A file with the read-only attribute opens locked.
- At start, leftover recovery sessions open the restore dialog, and the last session is restored (the harness starts with a fresh `HOME`, so earlier scenarios see neither).

**Wave A**

#### WP7.1 Rust: backup and session

- **Owns:** `src-tauri/src/{backup,session,state,paths}.rs` and their tests.
- **Depends on:** P7.
- **Deliver:** AD-21 backup and AD-22 session per §7.10 and the §4 rules; `state.rs` exposes one read-modify-write under a lock for `recent`, `ui` and `session`.
- **Tests (cargo):** history naming and pruning to N; same-millisecond collisions get a suffix; `sibling` overwrites and refuses a symlink or a directory; a not-allowed path is refused; a missing file → `Ok(None)`; the mode and count read from `settings.json` (off, sibling, history); the session keeps allowed paths only, caps at 50, and re-grants given and canonical paths; unknown `state.json` members survive.
- **Covers:** "Backup" (backend), "session restore" (backend).

#### WP7.2 Rust: recovery

- **Owns:** `src-tauri/src/recovery.rs` and its tests.
- **Depends on:** P7.
- **Deliver:** AD-21 recovery: the session folder, the `alive` heartbeat thread, atomic `.txt`/`.json` pairs, the leftover list, raw read, drop, discard of a session, clear of the current session, pruning (14 days, 200 MB), 0700; key validation, the 64 MiB body cap and the 8 KiB header cap before allocation, a malformed header refused.
- **Tests (cargo, injected clock):** raw round trip of 5 MB; the current session is never listed; a stale `alive` → leftover, a fresh one → not; pruning by age and by size; an id with `..` or `/` refused; the caps.
- **Covers:** "Crash recovery" (backend).

#### WP7.3 Save path and read-only documents

- **Owns:**
  - `src/lib/app/fileOps.ts` and its test, `src/lib/stores/documents.ts` and its test
  - `src/lib/monaco/editorService.ts` and its test
  - `src/lib/components/editor/TabBar.svelte`, `src/lib/components/status/ReadOnlyStatus.svelte`
  - `src/lib/contrib/readOnly.ts`, `src/lib/i18n/en/{files,readOnly}.ts`
- **Depends on:** P7.
- **Deliver:**
  - Save calls `filesBackup` before the in-place write of an existing file; a failure asks "Save without a backup?"; Cancel writes nothing.
  - AD-23: `readOnly` and its reason at open and through `file.toggleReadOnly`; Save of a read-only document goes to Save As; the lock in the tab and the status bar; the editor option on activation.
  - `restoreDocument` (bound to the path only when allowed, with the given disk stamp and machine choice; otherwise untitled with the file's name and Save As proposing the path) and `onWillClose` (before the model is disposed).
  - Open consults `fileMemory.profileFor(path)` before detection and sets `DocMeta.machineId` from `fileMemory.machineFor(path)` (AD-22, AD-31).
- **Tests:** the save pipeline order (backup, write, stamp) with fakes; the backup-failure branch; the read-only decision table; `restoreDocument` binding rules; `onWillClose` ordering; the manual profile wins over detection; a remembered machine (and a remembered explicit "none") is applied at open; the P1 byte-exact tests unchanged.
- **Covers:** "Read-only files"; backup (UI part); X3 (part).

#### WP7.4 Recovery service and restore dialog

- **Owns:** `src/lib/app/recovery.ts` and its test, `src/lib/contrib/recovery.ts`, `src/lib/components/dialogs/RecoveryDialog.svelte`, `src/lib/i18n/en/recovery.ts`.
- **Depends on:** P7.
- **Deliver:** AD-21 in the webview: the 30 s throttle, blur and `visibilitychange` triggers, idle-callback snapshots of dirty documents whose version changed; drop on save, close and discard; clear of the current session in `files.onWillQuit`; `flushNow()` for the harness; the restore dialog after the first render and before session restore, with Restore all / Restore selected / Discard / Later.
- **Tests (fake clock and commands):** no snapshot for a clean or unchanged document; one per version; continuous typing still snapshots every 30 s; no snapshot while a script run is applying; the discard paths; restore maps the metadata, the machine choice included; Exit alone does not clear.
- **Covers:** "Crash recovery"; X3 (part).

#### WP7.5 Session restore and per-file memory

- **Owns:**
  - `src/lib/stores/fileMemory.ts` and its test, `src/lib/app/session.ts` and its test
  - `src/lib/contrib/session.ts`, `src/lib/contrib/profileSelect.ts`
  - `src/lib/stores/machines.ts` and its test (M7: the per-file persistence of the choice only)
  - `src/lib/monaco/bookmarks.ts` and its test, `src/lib/i18n/en/session.ts`
- **Depends on:** P7.
- **Deliver:** AD-22: the memory (cursor, top line, bookmarks, manual profile, machine choice; LRU 500; bookmarks ≤ 200, clamped to the line count) written on close, on tab switch and before quit; restore on open when `files.rememberPerFile` is set; `BookmarkService.set`; the session list pushed to Rust (1 s debounce); restore at start when `files.restoreSession` is set; the profile picker records a manual choice; `machines.setForDoc` records the machine choice (an id, or `null` for "none"); picking "follow the default" forgets it.
- **Tests:** LRU and caps; a manual profile and a machine choice survive, a vanished profile or machine id is ignored; restore order and the active tab; missing files skipped with one message; the pristine untitled document closed.
- **Covers:** "Session restore and per-file memory"; "Bookmarks v2" (persistence); X4.

**Wave B**

#### WP7.6 Documentation

- **Owns:** `docs/user/{README,machines}.md`, `docs/planning/README.md`.
- **Deliver:** backups (where, how many, the modes, how to turn them off), recovery (where snapshots live, when they are deleted, that a Windows/Linux logoff is covered only by them), session restore, per-file memory (the machine choice included; a note in `docs/user/machines.md`), read-only; the "does not do" list rewritten.

#### H7 Harness M7

- `m7-backup`: save twice; the history holds the earlier bytes (`h_hex`); `sibling` mode; `off`.
- `m7-recovery-1/2`: edit two documents, `recovery.flushNow()`, `h_crash`; run 2 (same `--home`) shows the dialog; Restore gives the exact text, dirty, on the original path; a fixture rewritten between the runs shows the external-change banner; Save then drops the entry; Discard empties the leftover.
- `m7-session-1/2`: three tabs, cursor lines, bookmarks, a manual lathe choice on a mill-looking file, a machine on one lathe tab and an explicit "none" on another while a default machine exists; run 2 restores them all (the "none" tab stays none).
- `m7-readonly`: a `chmod 444` fixture opens locked, typing is refused with the message, Save goes to Save As; `file.toggleReadOnly` on a normal file.
- `m7-perf-recovery`: a 10 MB dirty document; the snapshot runs off the keystroke path and blocks the main thread ≤ 100 ms; typing p95 unchanged.

**Gates:** G0–G6 (`m0`–`m7`); G7 (the snapshot budget; a save of a 10 MB file with history backup ≤ 1 s longer than without; a 10-tab session restores ≤ 3 s; P1 budgets); G8 (capability diff empty; folder permissions; `is_allowed` on every path command; standing rules 6, 8, 10).

**Commit:** `M7: Backup on save, crash recovery, session restore, per-file memory and read-only files`

---

### M8: Okuma OSP and Sinumerik turning

**Goal:** the owner's Okuma and Siemens turning programs are recognized, highlighted without false errors, navigable by tool, and safe to scale.

**Prelude P8:**
1. Take in any public Okuma and Sinumerik programs the owner has handed over (§9.2); D34 and D35 are decided (§10.1).
2. Contracts: `grammar` widened to `okuma` | `sinumerik`; the `syntax` fields of AD-24 and `addresses.speedLimitWords` (§7.1); token kinds `label` and `call` (§7.5); `CodeEntry.fNotFeed` (§7.2). The enum additions in `core/profiles/validate.ts` and the new patterns compiled once in `core/profiles/compile.ts` (`re.assignment`, `re.labels`, `re.systemVariables`, `re.header`), the same mechanical kind of change P1's P3 made there.
3. Skeleton profiles `okuma-osp.json` and `sinumerik.json` (syntax sections from the notes, detection weight 0, a minimal `machineParams` with the default preset and `diameter: "on"`, so the machine item and the effective view work from the start) and database stubs `okuma.json`, `sinumerik.json`, all registered; `fanuc-gcode.json` loses `min` (F22). **The `syntax` sections written here are pinned for the milestone:** the tokenizer, grammar and content WPs all test against them; a content WP that needs a syntax change writes a hand-off note instead of editing it.
4. Grammar stubs `core/grammar/{okuma,sinumerik}.ts` (returning the `iso` grammar until replaced) and the dispatch in `core/grammar/index.ts`; per-grammar `wordPattern` in `monaco/languages.ts` (keeps `T010101`, `SB=`, `NLAP1`, `CYCLE81`, `$AA_IM`, `R10` together).
5. `tests/gen/gen-large.mjs --dialect okuma|sinumerik`; the detection golden files `expected/detect/{okuma,sinumerik}.json` (empty); commit.

**Intentional behavior changes in M8:** `.min`, `.sub`, `.ssb` files open as Okuma; `.mpf`, `.spf` as Sinumerik.

**Wave A**

#### WP8.1 Tokenizer extensions (TS)

- **Owns:** `src/lib/core/nc/{tokenizer,mask}.ts` and their tests, `tests/fixtures/tokens/{okuma-osp,sinumerik}.json`.
- **Depends on:** P8.
- **Deliver:** AD-24 in `tokenizer.ts` with no dialect names; with every new field off the output is unchanged; `maskComments` knows strings before `;` comments (Sinumerik); the token goldens (≥ 60 lines each: `NLAP1 G85`, `SB=1200 M13`, `X=V1+V2`, `IF [V1 EQ 5] GOTO N10`, `CALL O1234 Q2`, `T010101`, `$FLANGE.MIN%`; `%_N_PART_MPF`, `;$PATH=…`, `T="DRILL_D8"`, `CYCLE83(50,0,2,-25,,-5)`, `MCALL`, `LOOP_A:`, `R1=R2*2`, `X=AC(10)`, `G26 S3=2500`, `LIMS=3000`, `MSG("A;B")`, `$AA_IM[X]`, `CR=15`).
- **Tests:** the goldens; every P1 token golden unchanged; 300k lines of each new dialect < 1 s in node.
- **Covers:** "Sinumerik and Okuma … grammars" (tokenizer).

#### WP8.2 Okuma grammar

- **Owns:** `src/lib/core/grammar/okuma.ts` and its test and snapshot.
- **Depends on:** P8.
- **Deliver:** the `syntax-okuma.md` §3.8 rule order as role tokens; the language configuration (`blockComment ['(', ')']`); no `invalid` on any fixture line except the explicit error rules (wrong `T` length, `/` inside a block).
- **Tests:** every regex compiles; snapshot; role checks on sample lines; WCAG as in P1.

#### WP8.3 Okuma content

- **Owns:** `src/lib/data/profiles/okuma-osp.json`, `src/lib/data/codes/okuma.json`, `tests/fixtures/nc/okuma/**`, `tests/fixtures/expected/detect/okuma.json`, `tests/fixtures/expected/outline/okuma/**`, and `docs/planning/syntax/syntax-okuma.md` §3.3 (the one section it corrects, §9.2 step 3).
- **Depends on:** P8.
- **Deliver:** §8.4, including the full `machineParams` of §8.8 (the unit-system presets from the OSP-P200L unit table, per address class, metric and inch; `modalGroups`) and `CodeParam.unit` where a cycle parameter is a count; synthetic fixtures (§9.1) with outline goldens (spec goldens). The 1 µm and 10 µm presets are `scale` readings (the unit multiplies **every** literal, F52), the 1 mm preset is `calculator`; §3.3 of the notes, which describes the unit parameter as affecting only numbers without a decimal point, is corrected here in general terms with the manual's own examples (`X0.1` = 0.001 mm under 10 µm).
- **Tests:** the database data test; detection Okuma vs Fanuc lathe on `.MIN` and on extension-less files (margin ≥ 3); outline goldens (tool changes on `T0202`/`T010101`, none on a `T` inside a `G71`–`G78`/`G180`–`G189` block, `NLAP1` as a label, `CALL O…` as a call); the effective profile of each preset validates, and **every** Okuma preset gives `decimalPointSignificant: false` (1 mm reads as written, 1 µm and 10 µm scale both forms alike, so a point never changes a value); the per-class units of each preset equal the unit table (length, feed per revolution, feed per minute, angle, time; `S` never converted).
- **Acceptance:** G10.
- **Covers:** "Okuma OSP profile, grammar, code database"; X2.

#### WP8.4 Sinumerik grammar

- **Owns:** `src/lib/core/grammar/sinumerik.ts` and its test and snapshot.
- **Depends on:** P8.
- **Deliver:** the `syntax-sinumerik.md` §3.8 rule order; strings before `;`; the language configuration (`lineComment ';'`, brackets, `"` auto-close).
- **Tests:** as WP8.2.

#### WP8.5 Sinumerik content

- **Owns:** `src/lib/data/profiles/sinumerik.json`, `src/lib/data/codes/sinumerik.json`, `tests/fixtures/nc/sinumerik/**`, `tests/fixtures/expected/detect/sinumerik.json`, `tests/fixtures/expected/outline/sinumerik/**`.
- **Depends on:** P8.
- **Deliver:** §8.5, including the `machineParams` of §8.8 (**`diameter: "on"` as the turning default, D35**; the calculator-type default preset; `modalGroups`) and `sets.diameter` on `DIAMON`/`DIAMOF`/`DIAM90`; synthetic fixtures (§9.1) with outline goldens.
- **Tests:** the database data test; detection Sinumerik vs Klartext (both use `;`) with margin ≥ 3; outline goldens (`T="NAME"` and `T1` change tools, `T0` does not, `MSG("T1 ROUGH")` does not; `MSG("…")` as a comment-like item; labels; `PROC`); the effective profile with no machine has `modal.diameter: "on"`, and a machine with `diameter: "off"` gives `"off"`.
- **Acceptance:** G10.
- **Covers:** "Sinumerik profile, grammar, code database"; X2.

**Wave B**

#### WP8.6 Tokenizer parity (Python)

- **Owns:** `src-tauri/resources/scripts/_nc_lex.py`, `tests/python/test_gedit_nc.py`.
- **Depends on:** WP8.1.
- **Deliver:** every AD-24 field; the new token goldens pass; every pattern of every built-in profile compiles in Python.

#### WP8.7 Scripts across the new dialects

- **Owns:** `src-tauri/resources/scripts/{_nc_modal,scale_feed,scale_speed,tool_list}.py`, their tests, `tests/fixtures/scripts/{scale_feed,scale_speed,tool_list}/**` (new cases), `tests/fixtures/modal/{okuma-osp,sinumerik}/**`.
- **Depends on:** WP8.3, WP8.5 (WP8.6 at integration).
- **Deliver:** `fNotFeed` (Okuma `G04 F`, Sinumerik `G4 F`: never scaled, not reported as a feed); `F=R1` / `F=V1` skipped as variables; Okuma `SB=` and Sinumerik `S3=` are not the main spindle (reported, not scaled); Sinumerik `LIMS=` as a clamp through `speedLimitWords`; thread and tapping by `pitchFeed`; modal goldens for both dialects, including the Sinumerik diameter mode (on at the top, assumed from the profile; off after `DIAMOF`; `DIAM90`) and Okuma cases under the 1 µm and 10 µm presets (a `scale` reading: `F234.56` is 0.23456 mm/rev, so the scale-feed limits compare effective values through the per-class units for words **with and without** a point, while with no machine no Okuma feed has a resolved value and every limit is skipped and reported).
- **Tests:** golden runs on the new fixtures; every earlier golden unchanged.

#### WP8.9 Okuma and Sinumerik checks, extents and search (**only on a D38 swap**, when M9 has already shipped)

- **Owns:** `src-tauri/resources/scripts/{program_checks,extents}.py`, `tests/python/test_{program_checks,extents}.py`, `tests/fixtures/scripts/{program_checks,extents}/{okuma-osp,sinumerik}/**`, and the Okuma/Sinumerik cases in `src/lib/core/search/**` tests.
- **Depends on:** WP8.3, WP8.5.
- **Deliver:** the parts of WP11.1, WP10.2 and WP10.3 that need these profiles and could not be written in M9 [now M10 and M11]: the Okuma `SB=` search case; the check items of `syntax-okuma.md` §9 1–3, 9, 13, 14 and `syntax-sinumerik.md` §9 1–3, 8, 12; the decimal-point finding under the Okuma presets and with none; extents for both dialects, including the Sinumerik diameter/radius rule of WP10.3 on a program that switches `DIAMOF`. Nothing else of M9 moves.
- **Tests:** the goldens of WP10.2 and WP10.3 for the two dialects; every M9 golden unchanged.
- **Covers:** X2, X8 (the Okuma and Sinumerik half) when M9 ran first.
- **Not used** (2026-09-30): M8 ran first, so the swap never happened; these parts belong to WP10.2, WP10.3 and WP11.1.

#### WP8.8 Documentation

- **Owns:** `docs/user/{dialects,machines}.md`, `docs/planning/README.md`.
- **Deliver:** the two dialects: what ships, what is recognized only, extension rules, turning-first, how a milling user derives a profile; in `machines.md` the Okuma unit systems — with the warning that they scale **every** number, a decimal point included, so the right setting matters even for a program full of points — and the Sinumerik `DIAMON` default, both as defaults.

#### H8 Harness M8

- `m8-okuma`: detection, tokenize without `invalid`, F7, tool list, scale feed with `G04 F` untouched; golden bytes; the machine item offers the three unit-system presets.
- `m8-sinumerik-diamon`: a turning `.MPF` with no machine: the machine report script shows `diameter: on` from the profile; a machine with diameter off changes it.
- `m8-sinumerik`: the same for a turning `.MPF`; `CYCLE81(…)` colors as a keyword; completion offers `CYCLE8x` from the database.
- `m8-perf`: open a generated 10 MB Okuma and Sinumerik file ≤ 2 s; typing p95 < 50 ms.
- On a D38 swap only, `m8-checks`: program checks and extents on the Okuma and Sinumerik fixtures (the M9 scenario `m9-scripts`, now `m10-scripts`, then covers mill and lathe only; the swap was not used).

**Integration I8:** regenerate `tests/fixtures/resolved/**` (the effective profiles of §5.2 rule 3 included) after Wave A; apply the syntax hand-off notes and regenerate the affected token goldens on both sides; make every exhaustive `switch` over `TokenKind` handle `label` and `call`.

**Gates:** G0–G6 (`m0`–`m8`); G7 (300k lines tokenized < 1 s for every built-in profile; the open budget); G8; G10 (both profiles, their `machineParams` and databases; the script rules); G11 (on the owner's machine, if they have local programs).

**Commit:** `M8: Okuma OSP and Sinumerik turning profiles, grammars and code databases`

---

### M9: Real programs read right

**Goal:** gEdit reads the owner's real programs the way their machines read them: the right dialect, every token, the tool words, the incremental axes and the class of every number. Every later feature reads values (the checks, the extents, address arithmetic, compare), so this milestone comes first and has its own gates and reviews (third revision, D69). It is measured on the committed owner-public programs in CI and on the owner's local programs by G11 (X13).

**Where the work comes from.** The roadmap proposals R2, R3, R4 and R6, which the owner accepted on 2026-09-27 into the prelude of the old M9 (§10.1); the values-read-wrong items of TODO "Bugs and risks > NC correctness"; the last "Next up" item (a Fanuc-lathe `G71`/`G72` `F` without `P` under a wrong dialect guess); the detection leftovers of 2026-09-27; and G11, which is still a stub (TODO "Tech debt and test gaps").

**Prelude P9:**
1. Record the re-cut (D69, proposed) and the accepted R2, R3, R4 and R6 (§10.1) in the commit body.
2. **Roadmap R2, accepted by the owner 2026-09-27:** a new `sinumerik-mill` profile extending `sinumerik` — `M6` tool changes with a preselect (a `T` alone), diameter off, `G17`/`G94` power-on, detection weights for milling syntax (`M6`, `G17`, `CYCLE8…(`, `T…="…"`, `MSG(`, counting the ordinary `G`/`M`/move lines the turning profile leaves out on `Y`) — and about 20 database entries (`CYCLE800`, `CYCLE832`, `TRAORI`/`TRAFOOF`, `G75`, the `ORI…`/`DYN…` codes), sized as the source review's §5 R2 sizes it. Mill-turn (`DIAMON`, `LIMS`, `SETMS`, `TRANSMIT`) stays with the turning profile — a mill-turn program is still read as turning. The user guide's own sketch of this profile ([dialects.md](../user/dialects.md#milling-on-okuma-and-sinumerik)) is the starting shape. P9 writes the **skeleton**: `data/profiles/sinumerik-mill.json` (its `syntax` inherited, detection weight 0, the `machineParams` of the turning profile with `diameter` off) and, if the entries do not belong in the shared `sinumerik.json`, a `data/codes/sinumerik-mill.json` database extending `sinumerik` (AD-17), both registered; which of the two holds each entry is decided here and written into WP9.1's hand-off.
3. **Roadmap R3, accepted by the owner 2026-09-27:** two database flags — `wordsAreData` (`dec/scaling` already delivered it for `G65`/`G66`/`G10` and the other macro/offset/setting words; whether the same flag, or a second one, also covers a block's plain axis words as data is open for the prelude to decide) and a new flag marking a code that opens or closes a coordinate frame. WP10.3 (extents) and WP10.4 (address arithmetic) read these flags instead of hard-coded `G53`/`G28` lists. P9 writes both into §7.2 (`CodeEntry`), validated in `core/codes/load.ts` and mirrored in the Python reader, and records the choice in §7.16. In the same step it pins a lower/upper flag on `sets.speedLimit` (§7.2), which WP9.5 fills in.
4. **Roadmap R4, accepted 2026-09-27, remaining parts:** tokenizer rules in TS and Python on shared goldens, one golden per case — the Fanuc macro function and print names (`FIX[`, `POPEN`); Okuma two-letter `=` words and four-digit option M codes; the Sinumerik `:123` main block and the call-rule exclusions (`CUT3DCC`, `ORIRESET(`); Klartext `TIP-TIP` and the `PLANE` words. (The Klartext decimal comma and the Fanuc program names are already done: `dec/klartext`'s `syntax.decimalSeparatorAlt`, `dec/names`'s `syntax.programNames`.) Any new `syntax` field goes into §7.1 and §7.16; the `syntax` sections and the call rules of the five existing profiles are written here and **pinned for the milestone**, as P8 did, so WP9.3 and the content WPs test against the same data and a WP that needs a change writes a hand-off note instead.
5. **Roadmap R6, accepted 2026-09-27, smallest useful version:** a Fanuc lathe machine choice "`U`/`W`/`V`/`H` are incremental" (on in system A, off on some system-B machines), and a tool-word variant for the `T` split (Fanuc offset digits 1/2/3, Okuma three-digit offsets on machines with 200 or more offsets); both as variants and overlays of the existing machine parameters (AD-31), no new consumer. The rest of R6 (extra axis letters, an IS-A preset, the ×10 option, the point-less feed-per-revolution unit) stays with §11 #26. P9 pins the variant ids and choices in §8.8; WP9.4 writes the data.
6. The contract of the Klartext **"defined cycle"** state for §7.4 (AD-19): a `CYCL DEF` defines a cycle that each call runs and no call ends, and only the next definition replaces it, driven by the database's `sets` with no dialect name in code, next to Fanuc's active cycle; recorded in §7.16. Python only (`_nc_modal.py`); the TypeScript interpreter follows the same goldens in Phase 3 (P3.1).
7. The G11 manifest format (§9.2) gains the aggregates X13 reads (detection, unknown tokens outside comments with an allow-list, the map, scale feed and scale speed at 100 %), written into `tests/real/README.md`; a golden format for the owner-public known gaps (`tests/fixtures/expected/owner-public/known-gaps.json`: each remaining unknown token or map difference with its reason).
8. **Spike, size S (§5.2 rule 12):** run `tests/runtime/suite.sh` on a GitHub macOS runner (a CI job started by hand, `workflow_dispatch`, no secrets). The result — works, works with changes, or does not work and why — goes into the P9 commit body. If it works, a follow-up adds the job to `ci.yml`, and G6 then stops depending on the owner's screen. It is not a gate of M9.
9. `npm run check && npm test && cargo check && python3 -m unittest discover -s tests/python -t .`; commit.

**Intentional behavior changes in M9** (H9 may update earlier scenarios and goldens only for these):
- A Sinumerik milling program opens as `sinumerik-mill`: a `T` alone is a preselect, `M6` is the tool change, and the tool list gives one row per tool. A turning or mill-turn program keeps `sinumerik`.
- Words that were misread change their token or class: `FIX[#2]` is no `X` word, `POPEN` no five words, an Okuma `TL=` no local variable, `M1292` a code, a Sinumerik `:123` a main block number, `TIP-TIP` and the `PLANE` words keywords. A token golden changes only for these cases.
- Values change where a number class was wrong (the list in WP9.5); every changed golden names its item.
- Save As to another extension re-detects the dialect; Remove Comments keeps `;$PATH=`.
- Detection moves where WP9.6 says (the Y-axis lathe, the Fanuc lathe / Sinumerik tie); every committed fixture keeps its folder's dialect.

**Wave A**

#### WP9.1 The Sinumerik milling profile (R2)

- **Owns:** `src/lib/data/profiles/sinumerik-mill.json`, the database P9 chose for its entries (`src/lib/data/codes/sinumerik-mill.json`, or the milling and 5-axis entries of `src/lib/data/codes/sinumerik.json`), `src/lib/data/profiles/index.ts`, `src/lib/data/codes/index.ts`, `tests/fixtures/nc/sinumerik-mill/**`, `tests/fixtures/expected/detect/sinumerik-mill.json`, `tests/fixtures/expected/outline/sinumerik-mill/**`, the Sinumerik 5-axis and high-speed entries R3 names ("Sinumerik as R2 brings").
- **Depends on:** P9.
- **Deliver:** the profile of R2 and the prelude's skeleton filled in: the tool rule (`T` alone a preselect, `M6` the change, `T="NAME"` and `T1` both read), `machineParams` with diameter off, `G17`/`G94` power-on, the milling detection weights; about 20 entries (`CYCLE800`, `CYCLE832`, `TRAORI`/`TRAFOOF`, `G75`, `ORI…`, `DYN…`) with their parameter classes, in our own words from `syntax-sinumerik.md`; synthetic milling fixtures (§9.1) with detection and outline goldens.
- **Tests:** the database data test; detection `sinumerik-mill` against `sinumerik` on milling, turning and mill-turn programs, margin ≥ 3 on every fixture, the owner-public Siemens programs included (five of the six are milling posts); outline goldens where a preselect `T` is no segment; the tool list on the published drilling program gives one row per tool with its own feed and speed (the TODO item: 9 segments for 5 tools today).
- **Acceptance:** G10.
- **Covers:** roadmap R2; "Sinumerik and Okuma OSP profiles" (the milling half of Sinumerik); X13.

#### WP9.2 5-axis and high-speed codes and the two flags (R3)

- **Owns:** `src/lib/data/codes/{fanuc,heidenhain}.json` (the new entries and the two flags), `src/lib/core/codes/{load,lookup}.ts` and their tests (the flags), the flag reading in `src-tauri/resources/scripts/gedit_nc.py`, a data test for the flags (`src/lib/data/codes/flags.test.ts`, new).
- **Depends on:** P9.
- **Deliver:** entries with correct parameter classes for what CAM writes on every 5-axis and 3+2 file: Fanuc `G43.4`/`G43.5`, `G68.2`–`G68.4` with `G53.1` and `G69`/`G69.1`, `G05.1`, `G12.1`/`G13.1`, `G07.1`, refining the `G61`–`G67` and `G10` entries `dec/scaling` already added; Klartext cycles 7, 9, 19, 247 and the other `PLANE` forms; the words-are-data flag and the frame flag set on every entry they apply to, across the four milling dialects (the Sinumerik entries come with WP9.1). The TODO's other code-database gaps that a value depends on — the Okuma `CALRG` entry, the lathe `G84`/`G85`/`G88`/`G89` `P`/`K` counts, the `R` of the lathe drilling cycles — are taken where the notes settle them, each in the G10 table.
- **Tests:** the database data test; every flagged entry is listed in a golden, so a flag cannot be dropped silently; the flags read the same in TS and Python.
- **Acceptance:** G10.
- **Covers:** roadmap R3; X13 (no unknown code on the owner-public 5-axis programs).

#### WP9.3 The remaining tokenizer rules (R4)

- **Owns:** `src/lib/core/nc/{tokenizer,mask}.ts` and their tests, `src-tauri/resources/scripts/_nc_lex.py`, `tests/python/test_gedit_nc.py`, `src/lib/core/grammar/{iso,klartext,okuma,sinumerik}.ts` and their tests and snapshots, `tests/fixtures/tokens/**` (new cases).
- **Depends on:** P9 (the pinned `syntax` sections).
- **Deliver:** R4's remaining parts in both tokenizers and the grammars, with no dialect name in code: the Fanuc macro function and print names (`FIX[`, `POPEN`); the Okuma two-letter `=` words (`TL=`, `CL`, `CP=`) and four-digit option M codes (`M1292`); the Sinumerik `:123` main block (a block number and a jump target, as the grammar already reads it) and the call-rule exclusions (`CUT3DCC`, `ORIVIRT1`, `ORIRESET(`, `FGROUP(`, `WAITS(`, `INIT(`, `START(`); Klartext `TIP-TIP` and the `PLANE` words. Where the TODO's other tokenizer gaps are the same kind of rule — Sinumerik `LIMS[2]=`, `S[n]=`, `M[n]=`, `T[n]=` losing their address; `1.5EX3` differing between grammar and tokenizers; several skip levels on one block (`/1 /3`) — they are fixed here too.
- **Tests:** one golden per case, shared by vitest and unittest; every earlier token golden unchanged except the cases listed; 300k lines of each dialect < 1 s in node.
- **Covers:** roadmap R4; X13 (no unknown token outside comments).

#### WP9.4 Per-machine `U`/`W` and the `T` split (R6)

- **Owns:** `src/lib/data/profiles/{fanuc-lathe,okuma-osp}.json` (the variants and overlays of R6), `tests/fixtures/machines/files/**` (new samples), `tests/fixtures/expected/outline/{fanuc-lathe,okuma}/**` (the cases run under each choice).
- **Depends on:** P9.
- **Deliver:** the Fanuc lathe choice "`U`/`W`/`V`/`H` are incremental" as a variant whose overlay sets `addresses.incremental` (on in system A, off on some system-B machines; the default follows the G-code system and is marked verify); the tool-word variant as a `toolCall` overlay (Fanuc offset digits 1, 2 or 3; Okuma three-digit offsets on machines with 200 or more offsets, so `T2000` reads as station 2); both offered on the Machines page through the existing form (AD-31), no new consumer.
- **Tests:** the effective profile of each choice validates (the resolved `effective/**` files); outline goldens for the `T` split under each choice; `incremental_axes(profile)` under each choice; the default of every choice reproduces the current reading, so every earlier golden stays unchanged.
- **Acceptance:** G10 (the defaults and their sources, §8.8).
- **Covers:** roadmap R6 (smallest version); the TODO tool-word item; AD-31.

**Wave B**

#### WP9.5 Values read right

- **Owns:** `src/lib/core/machines/numbers.ts` and its test, `src-tauri/resources/scripts/{_nc_machine,_nc_modal}.py`, `tests/python/{test_machine,test_modal}.py`, `tests/fixtures/machines/numbers.json`, `tests/fixtures/modal/heidenhain-klartext/**`, `src/lib/data/profiles/{fanuc-gcode,okuma-osp,sinumerik}.json` (presets, addresses, structure rules), `src/lib/data/codes/heidenhain.json` (the `sets` of the cycle family), the `speedLimit` flags in `src/lib/data/codes/{fanuc,fanuc-lathe,fanuc-lathe-b,sinumerik,okuma}.json`, `src/lib/core/transforms/{removeComments,renumber}.ts` and their tests, `src/lib/app/fileOps.ts` and its test (Save As), `src-tauri/resources/scripts/{scale_feed,scale_speed,tool_list}.py`, their tests and `tests/fixtures/scripts/{scale_feed,scale_speed,tool_list}/**` (new cases).
- **Depends on:** Wave A (the flags, the tokens and the variants), I9's regeneration of the resolved files.
- **Deliver:** the values-read-wrong items of TODO "Bugs and risks > NC correctness", each with a synthetic reproduction:
  - **Number classes** (AD-31, TS and Python on the shared `numbers.json`): a thread-pitch `F` is feed per revolution only where the database says it is a lead, not under `G94` by default (Okuma `G181`–`G184`, Fanuc mill `G84`/`G74`; 100× off on an Okuma 1 µm machine); the Okuma 10 µm preset invents no 0.001 in inch unit; the Fanuc mill declares its angular addresses (`C90000` is not 9 in); per-tooth, inverse-time and `G931` feeds get a class; the Fanuc presets' point-less feed per revolution follows the preset instead of "as written" where a control without calculator input counts 0.01 mm/rev (verify, §8.8); the `F` of Okuma `G101`–`G103` is per minute whatever the feed mode; `numberClassOf` reads Fanuc `G63` as a modal pitch-feed mode, as the Python tracker already does.
  - **The Klartext "defined cycle" state** of P9 item 6 in `_nc_modal.py`: one `CYCL DEF` serves every call after it, `M89` calls after every positioning block until `M99` or the next `CYCL DEF`, a DEF-active cycle is never called, and a tool change with a cycle defined is normal. The `sets` data on the `CYCL DEF`/`CYCL CALL` family, `M89`/`M99` and `speedLimit` on the mill `G92` go through G10 for the first time.
  - **The Sinumerik structure items:** renumber numbers a label that starts with `N` (`NEXT_PECK:`) as it does `LAST_CUT:`; the map no longer lists `L10 (1)` as a call twice, nor control commands with digits or procedures (with WP9.3's call-rule exclusions); `%NAME_MPF` is recognized.
  - **Remove Comments keeps Sinumerik's `;$PATH=`** header line; **Save As re-detects the dialect** when the extension changes (`a.nc` saved as `a.h` becomes Klartext) and checks a read-only target before the backup.
  - **Scale feed refuses a Fanuc-lathe `G71`/`G72` `F` without `P`** when the dialect was only guessed (the last "Next up" item): a Fanuc `G71`/`G72` always carries `P`/`Q` or `U…R`, while the same block under an Okuma profile is a thread whose `F` is a lead, so an unconfirmed guess leaves it and reports it.
  - **The script texts:** the scale tooltips say what is scaled (rapid feeds and surface speeds are); scale feed no longer calls a Sinumerik `G33`/`G331`/`G332` `F` a pitch; the tool list's "surface" tag carries its unit and the code that set it; the scale-feed summary names the machine.
  - **Also from TODO "Ahead":** `sets.speedLimit` says whether a code sets an upper or a lower limit (Sinumerik `G25` is a lower limit and must not pass as a clamp), and scale feed's limits are per feed unit.
  If the WP grows past the size cap (§5.2 rule 4), integration splits it into the number classes and the rest, recorded in the hand-off note.
- **Tests:** one golden or unit case per item above; the named `numbers.json` cases pass in both languages; every earlier golden unchanged except the listed intentional changes.
- **Acceptance:** G10 (the number rules, the presets, the modal data, the script texts).
- **Covers:** TODO "NC correctness" (the values-read-wrong items) and the last "Next up" item; X13.

#### WP9.6 Detection leftovers and G11 automated

- **Owns:** `src/lib/data/profiles/fanuc-lathe.json` (the `detect` block only; the Sinumerik half of the tie goes through a hand-off note, because WP9.5 owns `sinumerik.json`), `src/lib/core/profiles/contradiction.ts` and its test, `tests/fixtures/expected/detect/**`, `tests/fixtures/nc/fanuc-lathe/**` (new synthetic reproductions), and, for this milestone, FX's files (§9.2): `tests/real/README.md`, `tests/unit/realFixtures.test.ts`, `tests/python/test_real_fixtures.py`, plus the new committed checks `tests/unit/ownerPublic.test.ts`, `tests/python/test_owner_public.py` and `tests/fixtures/expected/owner-public/known-gaps.json`.
- **Depends on:** Wave A (WP9.1 changes every Siemens detection).
- **Deliver:**
  - A **Y-axis-lathe marker**, so the private five-digit-`T` lathe program that opens as a mill (its Y moves outvote the lathe markers) opens as `fanuc-lathe`, proven by a synthetic program of that shape; the mill lookalike `mill-4digit-t.nc` stays mill.
  - The **Fanuc lathe / Sinumerik tie** on programs of nothing but numbered blocks and `G96`/`G97` (two of the owner's local programs, aggregate only) broken deliberately — `sinumerik.json`'s `detect.priority: -1` as Okuma's already is, or a lathe-only marker such programs carry — with a synthetic tie fixture.
  - The **contradiction guard between Fanuc mill and Okuma**: certain evidence where the notes give some (a decisive header, an Okuma-only word), and where they give none the gap stays and is written into `docs/user/dialects.md`.
  - **G11 as a real test**, manifest-driven, over the local folder of §9.2: per program, the detection equals the manifest; no `unknown` token outside comments except the manifest's allow-list; the map's tool stations equal the manifest and `tool_list` equals the map; a byte-exact round trip; scale feed and scale speed at 100 % give back every byte; no crash. Output: counts and pass/fail per check, a failure by manifest index and line number only (standing rule 12). The stubs go.
  - **The same aggregates over the committed owner-public programs**, in CI (X13): every file detects as its folder says, has no unknown token outside comments or has each remaining one in `known-gaps.json` with a reason, its map matches its golden, and scale feed and scale speed at 100 % are byte-identical.
- **Tests:** detection goldens for every fixture with a margin ≥ 3, printed (G10); the synthetic Y-axis lathe and tie cases; the G11 test on a synthetic manifest in a temporary folder (so its logic runs in CI with no real program); the owner-public test.
- **Acceptance:** G10 (the detection margins); G11 on the owner's machine.
- **Covers:** the detection leftovers of 2026-09-27; G11; X13.

#### WP9.7 Documentation

- **Owns:** `docs/user/{README,dialects,machines,scripts}.md`, `docs/planning/README.md`, and the sections of `docs/planning/syntax/*.md` that a real program contradicted (§9.2 step 3).
- **Depends on:** Wave A.
- **Deliver:** the Sinumerik milling profile in `dialects.md` (what it decides, how detection tells it from turning and mill-turn, the preselect rule), replacing the user guide's "derive it yourself" sketch; the `U`/`W` choice and the tool-word variant in `machines.md`, as defaults with their sources; the corrected number classes and presets; the script texts in `scripts.md`; what G11 checks, in `tests/real/README.md`'s own words, pointed to from the guide; "Current state".
- **Covers:** G8 docs check.

#### H9 Harness M9

- `m9-sinumerik-mill`: an owner-public milling `.MPF` opens as `sinumerik-mill`; F7 visits the `M6` changes only; the tool list gives one row per tool; a turning `.MPF` still opens as `sinumerik`.
- `m9-detect`: the synthetic Y-axis lathe opens as `fanuc-lathe`, the tie fixture as the profile WP9.6 chose; Save As of a Fanuc file to `.h` re-detects it as Klartext; every owner-public fixture opens as its folder says.
- `m9-numbers`: the decimal-point and number-class cases through a machine report script as in `m6-machines-select`: `C90000` under IS-B on the mill, a thread-pitch `F` under `G94`, the Okuma 10 µm preset in inch, a point-less feed per revolution under each Fanuc preset; the `U`/`W` choice and the `T` split change the tool list and the map as the goldens say.
- `m9-structure`: Remove Comments on a Sinumerik program keeps `;$PATH=`; renumber numbers `NEXT_PECK:`; the map shows no call for `CUT3DCC`.

**Integration I9:** merge Wave A; regenerate `tests/fixtures/resolved/**` (§5.2 rule 3), the new profile and the variants included, before Wave B starts; apply the syntax hand-off notes and regenerate the affected token goldens on both sides; apply WP9.6's `sinumerik.json` hand-off; apply the G10 *changed* items.

**Gates:** G0–G6 (`m0`–`m9`); G7 (300k lines tokenized < 1 s for every built-in profile, `sinumerik-mill` included; detection of a 400-line file against every profile plus variant detection ≤ 5 ms; one effective compile ≤ 5 ms); G8 (standing rule 12: G11 and the owner-public test print aggregates only, and no committed file names a local program); G10 (the milling profile and its database, the 5-axis and high-speed entries and both flags, the tokenizer rules, the variants and their defaults, the number classes and presets, the Klartext modal data, the script texts, the detection margins on every fixture including owner-public); G11 on the owner's machine, now a real run, with X13's local aggregates in the commit body.

**Commit:** `M9: Real programs read right — Sinumerik milling profile, 5-axis and high-speed codes, tokenizer rules, per-machine U/W and tool words, number classes, detection fixes and an automated G11`

**Release:** v0.3 once M9 lands on `main` (§5.3).

---

### M10: Check before the machine

**Goal:** the program can be checked before it goes to the machine — the program checks and the extents, lathe-aware and machine-aware — and the daily edits that change positions are safe: a Z shift by address arithmetic, and block skip on a prove-out section. All three scripts run on the Python interpreter that shipped in M6 and read the values M9 made right.

**Why here** (third revision, D69): address arithmetic sat in the old M11 behind the TypeScript modal interpreter, although as a script it needs only the Python interpreter; it is a daily task on a lathe, and a scrap risk on Klartext and Sinumerik cycle depths (source review R8). It belongs with the checks and the extents, which read the same values and the same database flags (R3).

**Prelude P10:**
1. **Roadmap R8, smallest version** (accepted 2026-10-01, §10.1): a parameter role "absolute position on the tool axis" in the code database (§7.2, `CodeParam`), set on the drilling cycles' parameters that hold one (Klartext `Q203`, Sinumerik `RTP`/`RFP`/`DP`, and the like, each in the G10 table), so a shift on the tool axis moves them with the axis words; **everything else address arithmetic cannot judge is refused and listed** — a cycle call with such a position but no role, a machine-coordinate block (`M91`, `M92`, `G75`, `SUPA`, `G53`), a block inside a tilted frame (R3's frame flag), simultaneous rotary moves without a TCP mode. The role's name and type are pinned here and recorded in §7.16. R8 was accepted on 2026-10-01, so the prelude ships the role and the refusals together; the refusal alone (every drilling cycle with a tool-axis position refused and listed) was the fallback while it was open.
2. The command ids and keys of §7.13 for WP10.1 with `findConflicts` clean; the i18n keys for the ribbon entries.
3. `tests/fixtures/scripts/address_arithmetic/README.md` with the golden format (the `machine` member as in §7.4); commit.

**Intentional behavior changes in M10:** the Tools tab and the script list gain program checks, extents and address arithmetic; the NC tab gains block skip and tool-segment select (H10 updates an earlier scenario only where it counts those entries).

**Wave A**

#### WP10.1 Block skip and tool segments


- **Owns:** `src/lib/core/transforms/blockSkip.ts` and its test, `src/lib/contrib/{ncBlockSkip,segments}.ts`, `src/lib/i18n/en/{ncBlockSkip,segments}.ts`, `tests/fixtures/transforms/block-skip/**`.
- **Depends on:** P10.
- **Deliver:** `nc.blockSkip.add` / `nc.blockSkip.remove` per the spec (position from the profile, optional level, levels kept, never twice, never a `/` inside an expression); `nav.selectToolSegment` (`Mod+F7`; at the cursor, or for a tool number) from the outline's `endLine`.
- **Tests:** goldens `/N100`, `N100 /`, `/1`, `#1=#2/2` and `R1=R2/2` untouched, Klartext after the number, an already-marked line; segment bounds.
- **Covers:** "Block skip"; "tool segment" (select); X8 (part).

#### WP10.2 Program checks script


- **Owns:** `src-tauri/resources/scripts/program_checks.py`, `tests/python/test_program_checks.py`, `tests/fixtures/scripts/program_checks/**`.
- **Depends on:** P10 (the M6 interpreter, the M8 dialects, the values M9 made right).
- **Deliver:** a `report` script with a bool parameter per check, all on by default and all profile-, database- and machine-driven: a cutting move with the spindle stopped or never started; a tool change without a following spindle start; a tool change while a cycle is active; the `M0`/`M1` list; the program frame (start/end markers missing or duplicated, code after the end); **a dimension word whose reading depends on the machine**, judged by the effective machine (AD-31): with increment input a warning per point-less word that names the value it is read as ("`X50`: 0.050 mm on machine 'Lathe 2'"), with calculator-type or `scale` input no finding (the machine reads every literal one way), and with **no machine** a warning that lists the readings of the profile's presets, the assumed default first — one per word where only point-less words differ (Fanuc), and one for the program where every number does (Okuma: "the unit system decides every value; choose a machine"); lower-case addresses outside comments; unclosed comments; non-ASCII characters and blocks longer than `syntax.maxLineLength` (the reporting half of character cleanup); **lathe**: `G96` without an earlier clamp (`sets.speedLimit`), an offset cancel (`T..00`) followed by a cutting move, `G70`–`G73` `P`/`Q` targets missing or in the wrong order, a subprogram call inside a `P…Q` profile, a thread cycle under `G96` (warning); the Okuma and Sinumerik items from `syntax-okuma.md` §9 1–3, 9, 13, 14 and `syntax-sinumerik.md` §9 1–3, 8, 12. **Roadmap R7, accepted by the owner 2026-09-27,** adds, each data-driven like the rest of this script: Fanuc — `%` inside a comment, a program reaching `%` with no end code, a word over eight digits, `G65` sharing its block with other words, mismatched `DO`/`END` numbers, the `M29` rigid-tap rules, the 5-axis modal-state rules; Klartext — a tool call or `M91`/`M92` while TCPM is on, a cycle call with no cycle defined, `PLANE` with no `MOVE`/`TURN`/`STAY`, a code the TNC 640 refuses; Sinumerik — a cut after `G332` with no new `S`, `G75` under tool-radius compensation, `G291`; Okuma — the `G137`/`G138`/`G140` rules and the two-turret spindle rule. R7 also **drops** the planned Okuma "`T` not 4 or 6 digits" error — it would flag every machining-centre program and every lathe with 200 or more offsets (already corrected in `syntax-okuma.md` §9 item 14).
- **Tests:** a golden finding list per check and dialect; the decimal-point check under none, an IS-B machine and a calculator machine on `l06-decimal.nc` and under each Okuma preset; no finding on the clean exit fixtures.
- **Acceptance:** G10 (check semantics).
- **Covers:** "Program checks"; "character cleanup" (report part); X8.

#### WP10.3 Extents script


- **Owns:** `src-tauri/resources/scripts/extents.py`, `tests/python/test_extents.py`, `tests/fixtures/scripts/extents/**`.
- **Depends on:** P10 (R3's flags and R6's `U`/`W` choice from M9).
- **Deliver:** minimum and maximum per axis, per tool and overall, in **effective values** (`resolve_value`: a word is converted by its class and reading, and a word with no resolved value — including every machine-dependent word while no machine is chosen, AD-31 — is "not resolved" and counted, never guessed); arc extremes in the active plane (I/J/K and R; lathe `G18` with X as a diameter); incremental words resolved (`G91`, lathe `U`/`W`, Klartext `I` prefix); work-offset changes start a group; `G28`/`G53` listed separately; lathe multi-pass cycles and variables reported as "not resolved"; **one X column, in diameter values**: on a profile with `addresses.diameter`, every X value is converted to a diameter by AD-19 rule 11 (a radius word — `DIAMOF`, or `DIAM90` with incremental distance — counts double) and the column is labelled "X (diameter)", so a program that switches `DIAMON`/`DIAMOF` never mixes the two in one minimum or maximum; the table's header names the machine or says "no machine: readings assumed from the profile defaults", and the diameter mode with its source.
- **Tests:** goldens for mill, lathe (diameter), Klartext and one arc case per quadrant; `l06-decimal.nc` under IS-B, calculator and none; a Sinumerik program switching `DIAMOF` (the same X minimum whether the section is written as a radius or as a diameter) and one with `DIAM90` plus `G91`.
- **Acceptance:** G10.
- **Covers:** "Extents"; X8. Roadmap R3 and R6, accepted 2026-09-27: extents reads R3's two database flags (words-are-data, frame open/close) instead of guessing from a hard-coded `G53`/`G28` list, and R6's `U`/`W`-incremental machine choice instead of assuming incremental on every system.

#### WP10.4 Address arithmetic script


- **Owns:** `src-tauri/resources/scripts/address_arithmetic.py`, `tests/python/test_address_arithmetic.py`, `tests/fixtures/scripts/address_arithmetic/**`.
- **Depends on:** P10 (R8's role and refusals), M9 (R3's flags, R6's `U`/`W` choice).
- **Deliver:** add, subtract, multiply or divide on chosen addresses; only literal values; `G`/`M`/`N`/`O`/`T` excluded; incremental words and blocks skipped and reported (`G91` mode, `addresses.incremental`, the Klartext `I` prefix); arc centres unchecked by default when adding, included for multiply; `G53`/`G28` blocks skipped; `=` expressions skipped; the P1 number format. **Reading numbers (AD-31):** the operand of add/subtract is in the program's units; each word's effective value comes from `resolve_value`, the result goes back through `write_back` in the word's own form (a point-less increment or unit word stays a whole number of increments or units, rounded half away from zero and reported when rounded; calculator mode writes the P1 way); multiply and divide are unit-free; `unit: 'increment'` and `count` parameters (the §8.2 table: dwell times, repeat counts `K`/`L`, block and program numbers) are excluded unless chosen explicitly; a word with **no resolved value** — including every machine-dependent word while no machine is chosen — is skipped and reported ("the reading depends on the machine; choose a machine"), never converted with an assumed default. **Diameter and radius:** on a profile with `addresses.diameter` the form asks whether the X operand is a diameter or a radius value, and each word is converted by its own mode (AD-19 rule 11), so a Sinumerik program that switches `DIAMON`/`DIAMOF` is shifted correctly; `IC()` and other expression words are skipped as expressions. The form notes the machine ("Machine 'Lathe 2': numbers without a point are increments of 0.001 mm; X is a diameter") or "No machine chosen: words whose reading depends on the machine are left alone".
- **Tests:** the spec edge cases; a lathe `Z −0.5` with `W` words reported; Okuma `X=V1+2` skipped; `Z1000` → `Z500` (IS-B), `Z999.5` (calculator), unchanged and reported with **no machine**, and `Z10.` → `Z9.5` in all three; `Z1000` + `0.0005` under IS-B → `Z1001` reported as rounded (half away from zero); under an Okuma 10 µm machine `Z1000` − 0.5 → `Z950` and `Z10.` − 0.5 → `Z-40.` (the unit scales a word with a point too); multiply by 2 on a `G83 … K3` block leaves `K3` alone (a `count` parameter, not an arc centre); a Sinumerik file with a `DIAMOF` section: a +0.5 diameter operand moves the `DIAMON` words by 0.5 and the `DIAMOF` words by 0.25.
- **Acceptance:** G10.
- **Roadmap R3, R6 and R8:** the skipped blocks are the ones whose code carries R3's frame flag or words-are-data flag, not a hard-coded `G53`/`G28` list; the incremental words follow R6's `U`/`W` choice; a drilling-cycle parameter with R8's tool-axis role moves with a shift on the tool axis, and every call P10 names as not judgeable is refused and listed, never shifted in part.
- **Covers:** "Address arithmetic"; roadmap R8 (smallest version); X8 (part); X11 (c, the arithmetic half).

**Wave B**

#### WP10.5 Documentation

- **Owns:** `docs/user/{README,transformations,scripts,shortcuts}.md`, `docs/planning/README.md`.
- **Depends on:** Wave A.
- **Deliver:** block skip and tool segments, the program checks (each check, what it can and cannot see, the decimal-point finding under a machine and with none), the extents (the diameter column, "not resolved"), address arithmetic (what it moves, what it refuses and lists, with the R8 cases named), and the "run another program from a script" example (D43); "Current state".
- **Covers:** G8 docs check.

#### H10 Harness M10

- `m10-blockskip`: insert and remove on a selection; one undo each.
- `m10-scripts`: program checks and extents from the Tools tab; rows jump to their lines.
- `m10-arith`: Z shift, `W` reported; the X11 c cases (`Z1000` under IS-B, calculator and none); a Klartext or Sinumerik drilling cycle moved by its tool-axis role or refused and listed, as the R8 decision says.
- `m10-perf`: program checks and extents on a 300k-line program within the script budget of P1; address arithmetic on 100k lines.

**Integration I10:** merge Wave A; regenerate `tests/fixtures/resolved/**` (§5.2 rule 3) so the new check, extents and arithmetic goldens that name a machine run; apply the G10 *changed* items.

**Gates:** G0–G6 (`m0`–`m10`); G7 (the budgets above); G8; G10 (checks, extents and address arithmetic semantics, the decimal-point check, the diameter rule and R8's role and refusals included); G11 on the owner's machine.

**Commit:** `M10: Program checks, extents, address arithmetic and block skip`

**Release:** v0.4 (§5.3).

---

### M11: Compare and search

**Goal:** a re-posted program can be compared without numbering noise and merged; any word can be found and replaced by value.

**Prelude P11:** contracts §7.6 (search) and §7.7 (compare); stubs `core/search/index.ts`, `core/compare/index.ts`; the `CompareService` additions as stubs in `app/compare.ts`; `profile.compare` typed without `tolerance` (a carried `tolerance` is ignored); the command ids and keys of §7.13 with `findConflicts` clean. **The compare and search leftovers of TODO "Ahead" land here too:** review-mode defaults for Klartext, Okuma and Sinumerik in their profiles' `compare` blocks (a Klartext cycle name is dialog-language text, not a comment, so a re-post in another language changes every cycle header — the default must say what it ignores), written here and pinned; commit.

**Intentional behavior changes in M11:** the compare toolbar gains controls (H11 updates `m2-compare` for exactly that).

**Wave A**

#### WP11.1 NC-aware search and replace


- **Owns:** `src/lib/core/search/**` and tests, `src/lib/contrib/search.ts` and its test, `src/lib/i18n/en/search.ts`.
- **Depends on:** P11.
- **Deliver:** AD-25: `parseQuery`, `findInLines`, `replaceInLines`, `wholeAddressRegex` (§7.6); `search.findAll` (`Mod+Shift+F`; a form: query, whole address, case, regex, in comments, scope active/all open) into Results; `search.replace` as the `nc.replace` transform (replace or new tab, the count in the summary); `search.wholeAddressInFind`.
- **Tests:** `G1` vs `G01`/`G1.`/`G10`/`G100`; `T1` vs `T10`/`T01`/`T0101`; `S>12000` with `S12000.`; nothing in comments or strings; Klartext words; Okuma `SB=`; regex groups in replace; 300k lines ≤ 1 s. A word condition compares the value **as written** (`X>50` matches `X60` and `X60.` alike, whatever the machine's decimal mode), and the search form says so; converting by machine is not part of search (D51).
- **Covers:** "NC-aware whole-address match", "find-all results panel", "search in open documents", "replace into a new document", the replace count; X6.
- **Also (TODO "Ahead"):** O-number references in search.

#### WP11.2 Compare normalization and unified diff


- **Owns:** `src/lib/core/compare/**` and tests, `tests/fixtures/compare/**`.
- **Depends on:** P11.
- **Deliver:** `compareDefaults`, `normalizeLine`, `normalizeLines` with `lineMap`, `unifiedDiff` (on the P1 Myers diff).
- **Tests:** each option alone and together; the decimal-point rule from the effective profile (`X10` ≠ `X10.` under an IS-B machine, equal under a calculator-type machine and under an Okuma `scale` machine, and different with **no** machine whenever one declared preset reads them apart — AD-26); a comment-only line dropped with the map intact; the Klartext leading block number; the re-post pair yields exactly its real changes; two 100k-line inputs normalized ≤ 1 s; unified-diff goldens.
- **Covers:** "Ignore options via review mode" (core); "export differences" (core); X5.

**Wave B**

#### WP11.3 Compare UI: review mode, merge, export, two files


- **Owns:** `src/lib/monaco/diff.ts`, `src/lib/app/compare.ts` and its test, `src/lib/components/editor/CompareView.svelte`, `src/lib/contrib/compare.ts`, `src/lib/i18n/en/compare.ts`.
- **Depends on:** WP11.2.
- **Deliver:** AD-26: the Raw/Review toggle and the option toggles (defaults from the profile, remembered for the session); each side normalized with its own document's effective profile, and a note in the review bar when the two effective machines differ; review models and "go to line" through the `lineMap`; `compare.copyToModified` / `compare.copyToOriginal` (`Mod+Alt+Right` / `Mod+Alt+Left` while the comparison is open; block or single line, then optionally the next difference), one undo step in the target; `compare.exportDiff` into a new tab; `compare.files` (two picks → two documents → compare). The P1 guards and disposals stay.
- **Tests:** target and direction rules (pure); the merge edit from a line change; the service with a fake diff handle.
- **Covers:** "Merge in both directions", "export differences", "two files on disk"; X5.
- **Also (TODO "Ahead"):** the compare race that a 250 ms delay only holds off today (`monaco/diff.ts`) is closed by ordering, not by a delay; the compare options are saved across sessions, not only remembered for the session.

#### WP11.4 Documentation


- **Owns:** `docs/user/{README,transformations,scripts,shortcuts}.md`, `docs/user/regex.md` (new), `docs/planning/README.md`.
- **Depends on:** Wave A.
- **Deliver:** the search syntax and the regex page (NC examples for the editor's JS flavor and for Python scripts, per `editor-core.md` "Regular expression help"), compare review and merge, the saved compare options and the review-mode defaults per profile.
- **Covers:** "Regex help" (lean).

#### H11 Harness M11

- `m11-search`: X6.
- `m11-compare-review`, `m11-compare-merge`, `m11-compare-export`, `m11-compare-files`: X5.
- `m11-perf`: find-all at 300k lines; review normalization at 100k lines; a merge ≤ 100 ms.

**Integration I11:** merge Wave A; regenerate `tests/fixtures/resolved/**` (§5.2 rule 3) for the goldens that name a machine.

**Gates:** G0–G6 (`m0`–`m11`); G7 (the budgets above); G8; G10 (the review-mode defaults of every profile and what they ignore); G11 (on the owner's machine).

**Commit:** `M11: Compare review mode and merge, NC-aware search and replace`

**Release:** v0.5 (§5.3).

---

### M12: Multi-channel programs

**Goal:** on the owner's twin-turret and sub-spindle machines, gEdit knows which channel the owner is looking at — whether the post writes the channels as sections of one file or as one file per channel — shows the map and the tool list per channel, walks from one wait to the next, and tells the owner before the program goes to the machine which sync ids do not match between the channels. They define their machines' channels and wait codes once, in the machine configuration, in their own patterns; gEdit ships no sync code set of its own (AD-32, D58).

**Placement (D63, renumbered by D69).** M12 sits after M10 and M11 because it needs everything before it and nothing after it: the machine configuration, its file, its validation, its page and the per-document effective view (M6); the per-file machine choice, the session and the recovery that bring two channel documents back together (M7); the Okuma and Sinumerik profiles, since two of the owner's three multi-channel machines speak them (M8); the values read right (M9); and M10's Results conventions and check vocabulary, next to which the wait-code check belongs. M13 (user profiles and the exit) neither needs it nor is needed by it, except that the exit run checks X12 last. The owner has not yet named the wait codes the owner's machines use (D64), and the design deliberately does not wait for them; R5 (below) is the one open decision it needs before it starts.

**Prelude P12:**
1. Contracts **§7.17** (`src/lib/core/channels/types.ts`: `ChannelRef`, `ChannelSection`, `ChannelMember`, `ChannelSet`, `ChannelProblem`, `SyncRule`, `SyncSemantics`, `SyncHit`, `SyncFinding`, `ChannelParams`; in `app/types.ts` — the one file P12 alone edits — `ChannelService`, the `DialogService.openFiles` `defaultPath?` and `FileMemo.channelId?` of §7.14; `MachineParams.channels` and `MachineParamsDecl.channels` in `core/machines/types.ts` and `core/profiles/types.ts`; `ScriptContextV2.channels` and `BuildContextInput.channels` in `core/scripting/types.ts`; `channelSiblings` in `platform/commands.ts`).
2. `core/profiles/types.ts`: `OutlineKind` gains `'channel'` and `'sync'`, **with the rule that a profile's own `outline` rules may not use them** (they are produced by the channel service, never by a pattern); `core/profiles/validate.ts` rejects them with a JSON path. Every exhaustive `switch` over `OutlineKind` is made to handle both, the mechanical change M8 made for `TokenKind` (§7.14).
3. **Implement** (§5.2 rule 2), with unit tests, the small pure functions every Wave A WP depends on: `core/channels/resolve.ts` (`findSections`, `siblingNames`, `channelAt`) and `core/channels/marks.ts` (`findMarks`). WP12.1 owns them from Wave A on.
4. Stubs: `core/channels/check.ts` (`checkSyncMarks` → no findings), `stores/channels.ts` (a `ChannelService` whose `forDoc` always answers `layout: 'none'`), and the call in `src/lib/app/bootstrap.ts` — `channels.start()` after `machines.load(configLoad)` — wired here, because the prelude is the only WP that edits `bootstrap.ts` (P1 §4.2). **With the stub every P1 and M6–M11 unit, Python and harness test passes unchanged**, which is the tripwire for the map and status-bar changes of WP12.5.
5. `core/machines/types.ts`: `channels?: ChannelParams` inside `MachineParams`, additive; `MACHINES_VERSION` stays **1** (D59, §4 "Persistence deltas"). `core/machines/file.ts` already keeps unknown members, so a file written by an M12 build round-trips through an M6 build unchanged; `core/machines/validate.ts` accepts the block and reports it as unvalidated until WP12.3.
6. Rust stub `src-tauri/src/channels.rs` (`channel_siblings`, §7.10), registered under the single `generate_handler![` (P1 AD-15); the `platform/commands.ts` wrapper.
7. Python stub `src-tauri/resources/scripts/_nc_channels.py` with the §7.17 signatures, re-exported by the `gedit_nc` facade (F37); `tests/python/helpers.py` gains `channel_context(golden=…)`, which reads the generated context of a golden exactly as `effective_context` does (P6 item 12), so Python never resolves channels itself.
8. Test ids of §7.12, the command ids and keys of §7.13 with `findConflicts` clean, `h.app.ctx.channels`, and `tests/fixtures/channels/README.md` with the golden format; commit.

**Roadmap R5, smallest version, in the same prelude** (accepted 2026-10-01, §10.1): in §7.17, a `decode` choice on the "partners from the line" rule (`split`, `digits` with 0 as channel 10, `bitmask`) and the partners of a mark with no `P` (`whenAbsent`), because the owner's 3-path set is a Fanuc lathe program whose waits carry digit `P` words, and the current rule would report every one of them as naming an unknown channel. The rest of R5 (an "alone in its block" rule, a "required on" pattern, a finding for two marks whose partner sets disagree, `WAITE` as an end-of-program wait that is never counted, `SETM`/`CLEARM` non-blocking, program checks and extents per channel) comes as data-only options if the owner accepts it. The `c02` fixture is rewritten in the real shapes (§9.1). R5 was accepted on 2026-10-01, so P12 ships `decode` and `whenAbsent`; `split` alone, with a user-guide note that a digit or bit-sum `P` word is not read, was the fallback while it was open.

**Intentional behavior changes in M12** (H12 may update earlier scenarios and goldens only for these):
- A document whose effective machine has a **valid** `channels` block gains a channel status item, and its program map groups its rows under one `channel` row per channel (each carrying the items of all of that channel's ranges) with the blocking sync marks as `sync` rows, plus one "Outside the channels" group. **Without such a machine nothing changes** (X12 c): no item, no grouping, the P1 map. A machine whose channel block is broken behaves like a machine without one, except for the problem shown on the Machines page and in the status item; nothing else about that machine changes (X12 d). H12 updates the M6 scenarios that count status items.
- `outline.items(id)` may return `channel` and `sync` rows; `OutlineIndex` itself is unchanged, so every committed outline golden stays as it is.
- The Tools tab gains "Check wait codes" next to the M10 checks; the NC tab gains the channel navigation group.

**Wave A**

#### WP12.1 Channel resolution and the channel fixtures

- **Owns:**
  - `src/lib/core/channels/{resolve,marks,siblings}.ts` and their tests (P12 wrote `resolve.ts` and `marks.ts`; WP12.1 owns them from Wave A on)
  - `tests/fixtures/nc/channels/**`, `tests/fixtures/expected/detect/channels.json`, `tests/fixtures/expected/outline/channels/**`, `tests/fixtures/channels/resolve/**`, `tests/fixtures/README.md`
- **Depends on:** P12.
- **Deliver:**
  - `findSections(lines, cp, params)`: the sections of a `single-file` document with, per channel, **every** 1-based inclusive line range it holds, in document order (a section ends at `sectionEnd`, else at the next start, else at the last line). A channel may start a section any number of times and the sections may interleave — a turret-selection program alternates `G13 … G14 … G13 … G14 …` and the control separates it the same way — so "a channel appears twice" is **not** a problem: it is a row in the tester ("channel 1: 4 sections, 212 lines") and nothing more. The `channel` capture resolves against ids **and aliases** and may name several channels at once when it contains `sectionSeparator` (`+S1/S3/S4`, one common section run by three processes): the range is then listed under each of them, through the same splitting code path as a `line` partner capture. Every line no channel owns — before the first section, between a `sectionEnd` and the next start, after the last section — goes into `outside`, in document order. Problems: a start naming an undeclared channel or alias, a declared channel that is nowhere, overlapping ranges.
  - `siblingNames(baseName, params)`: the file names of the other channels of a `multi-file` document — pure, no I/O (F57). Per channel, its own `list[].fileName` template if it has one, else `fileNameFor`, else the `fileName` pattern with the `channel` capture replaced; so a set whose members share no one pattern (`%_N_1000_MPF` / `%_N_2000_MPF`; `PART.MPF` / `PART_GS.MPF`, where one name carries no channel token at all) is expressible, and a template that cannot be derived is reported rather than guessed. A base name that matches nothing answers `null` ("this is not a channel file") — which is not the end of the story, because the user may still assign the document to a channel by hand (WP12.5). Name comparison is case-insensitive on macOS and Windows, as `docs.byPath` already is.
  - `markerChannel(lines, params)`: the channel a `multi-file` document says it is, from the optional `marker` pattern over the first 400 masked lines, resolved against ids and aliases; it wins over the file name when both answer, and a disagreement is a problem, not a silent choice. For a set whose names carry no channel token it is the only automatic answer.
  - `findMarks(lines, cp, params, channel)`: the sync marks of a channel's lines, on **masked** lines only (a mark inside a comment is not a mark), by `prefix` (a literal prefix plus the id as `idDigits` digits at a word boundary) or by `regex` (a `mark` capture; absent and not required for a `count` rule, whose marks carry `mark: ''`), with the partner channels resolved from `all`, `fixed` or `line` (the `channels` capture split on the rule's separator, each piece matched case-insensitively against a declared channel **id or alias**; an unmatched piece is kept as `unknown` for the check to report). A hit on a line no section owns keeps `channel: ''` and is reported by the check as "outside every channel", never keyed to a channel. Rules run in declaration order and the first rule that matches a line owns it.
  - Caps and budgets: ≤ 32 channels, ≤ 32 sync rules, ≤ 20,000 marks per document (the rest counted and reported, never dropped silently), each pattern ≤ 1,000 characters and inside the P1 AD-11 subset (standing rule 15); a resolution that passes 500 ms on one document is abandoned with a status message and `layout: 'none'`, so a pathological pattern cannot wedge the editor.
  - The synthetic fixtures of §9.1 (M12 rows) with their detection and outline goldens (spec goldens where WP12.5 has not landed, §5.2 rule 3) and their README provenance lines.
- **Tests:** the section table (a start with and without a `channel` capture; an explicit `sectionEnd`; lines before the first section; a section that runs to the end; an undeclared channel; a missing channel; a document with no match → `none`); **four alternating sections** (`G13`/`G14`/`G13`/`G14`) give two channels with two ranges each in document order, and `channelAt` answers correctly in the second range of each; a channel whose ranges are **not contiguous** with a `sectionEnd` between them puts the lines in between into `outside`, and a shared subprogram after the last `sectionEnd` is in `outside` too; a `channel` capture naming three channels through `sectionSeparator` lists the range under each; aliases resolve a section start (`G13` → channel `1`), a marker and a `line` partner piece, and an alias colliding with another channel's id is rejected at validation; sibling names (a shared `fileName`, a per-channel `list[].fileName`, a pair where one name has no channel token, no match, a stem with a dot, a three-channel set, case folding, a template that cannot be derived → reported); marker wins over the file name and a disagreement is reported; marks (prefix with and without `idDigits`, a regex without a `mark` capture rejected at validation **except for a `count` rule**, a mark in a comment ignored, a mark outside every section keeps `channel: ''`, `all`/`fixed`/`line` partners, an unknown channel in a `line` capture, two rules matching one line → the first wins); the caps and the 500 ms abandon; 300k lines with two rules resolved in ≤ 150 ms in node (assertion < 500 ms).
- **Acceptance:** G10 on the fixtures and their goldens.
- **Covers:** AD-32 (resolution); X12 (a, b).

#### WP12.2 The wait-code check

- **Owns:** `src/lib/core/channels/check.ts` and its test, `tests/fixtures/channels/check/**`.
- **Depends on:** P12.
- **Deliver:** `checkSyncMarks(perChannel, params, o)` → `SyncFinding[]`, pure, deterministic, sorted by channel then line. It compares **sequences, not sets**: a repeated id is normal in a correct program (the Siemens two-channel shape waits on the same id three times in each channel), so the id set of a channel says nothing on its own. Per sync rule and per ordered channel pair, the §7.17 algorithm — one pass into id → positions, ordinal pairing, one linear diff over the two id sequences — produces:
  - **count mismatch** — the two channels carry a different number of this id ("channel 2 has this wait twice, channel 1 three times"). For a `count` rule (no id at all) this is the whole check, and it is the documented Okuma `M100` rule: the same number of them must appear on both turret sides.
  - **missing** — a mark whose **ordinal** partner is absent (the 3rd `80` of channel 1 against a channel 2 that has two). Reported on the line of the unpaired mark.
  - **out of order** — the two ordered id sequences of a channel pair disagree, found by one linear diff, not by scanning id pairs. Reported once per channel pair with both lines on both sides; at most one inversion per pair plus the count of the rest.
  - **not increasing** — an `ordered` rule only: an id smaller than the previous one in the **same** channel. Such a rule never compares the two channels, so an id present on one side only is legal — the Okuma manual's own correct example runs P10/P20/P40 against P10/P30/P40, and `missing`/`unmatched` on it would be a false finding on a textbook program.
  - **unknown channel** — a mark's partner set names a channel the machine does not declare. Only a `line` partner rule can produce it: `all` and `fixed` resolve inside the declared list by construction.
  - **unmatched** — a blocking `rendezvous` mark whose partner set names only its own channel. **Precedence:** a mark that already produced a `missing` or `count-mismatch` finding is not also reported as unmatched, so one defect gives one finding.
  - **outside channels** — a `SyncHit` with `channel: ''` (§7.17): reported as "a wait outside every channel", never silently keyed to a channel.
  - **Order not checked** — the order of a pair is reported as not checked, with the reason in the finding, when a **jump target or a backward jump** lies between the two marks: a label that some `GOTO`/`GOTOB`/`GOTOF`/`M99 P`/`M98 Q` in the same channel names, or the line of a backward jump. **A label alone is not one**: in a real Siemens program every wait line carries its own label (`NN8010: WAITM(10,…)`), so suspending on any label would turn the check off for the whole program — the rule is a *target*, not a label, and a label on the mark line itself is ignored. `o.jumpLines` carries the target and backward-jump lines per channel; WP12.5 computes them from the outline and the profile's `numbering.references`.
  - Two ids are the same id when their text is the same and, when both are all digits, when their values are (`101` = `0101`); nothing else is normalized, and findings quote the ids as they are written (§7.17).
  - `blocking: false` rules are **never** checked (D60); their marks are carried for the map and the navigation only.
  - Findings carry `document` and `line` (F58), so one report jumps across two channel documents. Past the §7.17 budget the report is truncated and says so.
- **Tests:** a golden per kind on two- and three-channel inputs; **a clean pair produces no finding**, including a pair in the shape of a real two-channel program — a label on every wait line, one id repeated twice and another three times in *both* channels, same counts and same order — which the set-based draft would have reported eight times; a `count` rule with equal counts is clean and with unequal counts gives exactly one finding; an `ordered` rule with ids present on one side only (P10/P20/P40 against P10/P30/P40) is clean, and one decreasing id gives exactly one finding; a jump **target** between two ids suspends exactly that pair and nothing else, while a plain label between them (and a label on the mark line) suspends nothing; a mark that is `missing` is not also `unmatched`; `unknown-channel` only from a `line` partner rule; determinism (the same input twice, and the channels in the other order, give byte-identical findings); an id present in three channels where one is missing; **performance at the contract cap**: 20,000 marks over 8 channels and over 32 channels within the §7.17 budget in node (the old 2,000-over-three measurement stays as the typical case).
- **Acceptance:** G10 (what the check claims and what it does not).
- **Covers:** AD-32 (check); X12 (a, b).

#### WP12.3 Channel parameters in the machine configuration

- **Owns:**
  - `src/lib/core/machines/validate.ts` (the `channels` rules) and its test, `src/lib/core/machines/channelFields.ts` and its test
  - `src/lib/components/dialogs/ChannelsForm.svelte` and its test
  - `src/lib/i18n/en/machines.ts`, `tests/fixtures/machines/files/channels-{valid,bad-pattern,unknown-channel,custom}.json`
- **Depends on:** P12.
- **Deliver:**
  - Validation of a `channels` block against §7.17, every problem with a JSON path: at least two channels, ids `^[a-z0-9][a-z0-9_-]{0,15}$`, unique ignoring case, names 1–32 characters; **aliases** ≤ 8 per channel, 1–32 characters each, unique across the whole list ignoring case and never equal to another channel's id; `layout` one of `single-file` / `multi-file`; the patterns the layout needs are present and the others are not; every pattern compiles, is ≤ 1,000 characters and passes the P1 AD-11 subset scan (standing rule 15); a `single-file` `sectionStart` without a `channel` capture is allowed only when the channel count equals the number of starts it is expected to find — otherwise it must capture; `sectionSeparator` is a single non-word character; a `multi-file` set is addressable — a `fileName` with both `stem` and `channel`, **or** a `list[].fileName` template for every channel, **or** a `marker`, and when none is given the block is still valid but the page says that the channels can only be assigned by hand; a `{{…}}` template uses `{{stem}}` and `{{channel}}` only; every sync rule has a unique id, `semantics` one of `rendezvous` / `count` / `ordered` (default `rendezvous`), a prefix or a compiling regex **with a `mark` capture — required except for `count`, which has no id**, partners that resolve (`fixed` names declared channels or aliases; `line` has a `channels` capture), and `blocking` defaults to `true`. **A problem invalidates the block, not the record:** the block is kept verbatim, listed on the page with its JSON path, dropped to `layout: 'none'`, and the machine stays selectable with every other parameter in force (§7.15, X12 d).
  - `channelFields(params)`: the `FieldSpec[]` for one sync rule (including `semantics` as a `choice` whose labels say what each kind checks) and for the layout step, in existing `FieldType`s only (`text`, `choice`, `integer`, `bool`) — **no new `FieldType`** (F46).
  - The **Channels step** of the machine form, a page-owned control modelled on the `scripts.folders` list (F46): the channel list (add, remove, rename, reorder — the order is the display order — aliases and the optional per-channel file template), the layout choice with only its own patterns shown, and the sync-rule list, each rule edited through `modals.form`.
  - The **tester**, the profile pattern tester's shape (D40) one dialog closer: a paste box, or "Take the active document", and a live table of what the rules matched — each channel with **how many sections it has and which ranges** (a channel with four sections is a row, not a warning), the lines that belong to no channel, the marks with their ids, their rule's semantics and their partner channels, the problems, and the time each rule took, with a warning above 50 ms. It runs the same pure functions as the app, never a second implementation. The same report is available outside the dialog as `channels.testOnDocument` in the Results panel, like `profile.testOnDocument`.
- **Tests:** each validation rule with one failing case; an alias that collides with another channel's id is rejected; a `count` rule without a `mark` capture is accepted and a `rendezvous` rule without one is rejected; a `multi-file` block with neither `fileName` nor templates nor `marker` is valid and flagged as assign-only; a block with a bad pattern round-trips byte-stable through parse and serialize, **is reported, and the record is still offered for a document with its other parameters unchanged**; `channelFields` types; the form steps with a fake `MachineService`; the tester's table on inline text, including a four-section channel, a rule that matches nothing and a rule over the time warning.
- **Covers:** AD-32 (configuration); X12 (d); "Full settings dialog" (the Machines page gains its Channels step).

#### WP12.4 Rust: the sibling lookup

- **Owns:** `src-tauri/src/channels.rs` and its tests.
- **Depends on:** P12.
- **Deliver:** `channel_siblings(path, names)` per §7.10 and the §4 row: `fs_scope().is_allowed(path)` or `Err`; ≤ 32 names per call, each validated exactly as the §4 row states it — **a plain file name, 1–255 characters, no path separator, no `:`, no wildcard (`*`, `?`), no control character, not `.` and not `..`** — or that entry is `Err` on its own; each resolved against the **parent of `path`**; the answer is `{ name, exists, bytes, modified }` — no content, no new grant, no directory listing (standing rule 14). The `:` and the wildcards are not decoration: on Windows `a:b.nc` is an alternate data stream and `C:x.nc` is a drive-relative path, and a wildcard is a name no file has but some APIs expand.
- **Tests (cargo):** a not-allowed path refused; the whole §4 character set, one case each — `/`, `\`, `..`, `.`, a NUL, `a:b.nc`, `a*.nc`, `a?.nc`, a name holding `\x01`, an empty name, a 256-character name; more than 32 names refused; an existing and a missing sibling; a symlinked sibling reported as it is and never followed out of the folder; the command grants nothing (the scope is unchanged afterwards).
- **Covers:** AD-32 (sibling lookup); X12 (b).

#### WP12.5 The channel service, the status item, the map and the navigation

- **Owns:**
  - `src/lib/stores/channels.ts` and its test
  - `src/lib/contrib/channels.ts` and its test, `src/lib/components/status/ChannelStatus.svelte`
  - `src/lib/app/outlineService.ts` and its test, `src/lib/components/panels/ProgramMapPanel.svelte`
  - `src/lib/app/dialogs.ts` and its test (the one-line `defaultPath` pass-through of the §7.14 `DialogService` row; the interface change itself is P12's, which alone edits `app/types.ts`)
  - `src/lib/i18n/en/channels.ts`
- **Depends on:** P12 (the `ChannelService` contract and stub).
- **Deliver:**
  - `ChannelService` per §7.17: `forDoc(docId)` in the AD-32 order (the document's effective machine → its `channels` block → resolution; no block, a broken block or no match → `layout: 'none'`), re-resolved on a content change (debounced with the outline's 150 ms aggregation, never on the keystroke path), on a machine change (`machines.revision`) and when a sibling document opens, closes or is assigned; `channelAt(docId, line)`, `marks(docId)`, `siblings(docId)` (through `channelSiblings`, once per open and on demand, never on a timer), `assign(docId, channelId)`, `check(docId)` over the open channels, `revision`.
  - **One machine decides a check.** `check(docId)` resolves every member with the *initiating* document's effective machine (§7.17). A sibling carrying a different machine, or none, is still checked, and the report header names it ("channel 2 is set to machine 'Lathe 2'") with a one-click "use this machine for channel 2"; the rules of two machines are never mixed in silence, and a sibling that merely opened with the profile's default machine no longer turns the whole report into "missing".
  - The status item (`status-item`, `data-item="channel"`, next to the machine item, hidden for `layout: 'none'`): "Channel 1 of 2", or the channel name, with "channel 2 not open" / "channel 2 not found" in `multi-file` mode, and "the channel rules of this machine are broken" when the block did not validate; the tooltip lists the layout, every declared channel with where it was found (pattern, marker or the user's assignment) and how many sections it has, and the sync rules in force with their semantics. A click runs `channels.select`: a quick pick that reveals a section (`single-file`), focuses a sibling's tab, offers **"Assign this document to channel N"** for an open document no pattern claimed (persisted through M7's per-file memory, which is also what covers a set whose two paths share one name in different folders), or offers "Open channel 2…" — which opens the **file dialog** in the document's own folder (`DialogService.openFiles` `defaultPath`, §7.14) with multi-select (P1 F3), so one dialog opens every channel. **gEdit opens nothing by itself** (standing rule 14).
  - Program map grouping in `outlineService`: `items(id)` returns one `channel` row per channel with that channel's items — **from every one of its ranges, in document order** — as `children` and the blocking marks as `sync` rows, plus one **"Outside the channels"** group listing the `outside` ranges (the header, anything between a `sectionEnd` and the next start, the trailing lines), so a shared subprogram in a concatenated file is visible instead of lost; `toolLines(id)` is unchanged and `toolLines(id, channelId)` is added, so F7/Shift+F7 keep their P1 behaviour and "next tool change in this channel" becomes possible. `itemAt` resolves through the groups. It also computes `jumpLines` per channel for the check (labels that a `GOTO`/`GOTOB`/`GOTOF`/`M99 P`/`M98 Q` in the same channel actually targets, plus backward-jump lines) from the outline and `numbering.references`.
  - Commands (§7.13): `channels.nextSyncPoint` / `channels.prevSyncPoint` (the marks of the channel at the cursor, wrapping like bookmarks), `channels.gotoPartner` (the same id in the next channel that has it, switching document when it must and saying so when it cannot because that channel is not open), `channels.checkSync` (the WP12.2 findings into the Results panel, with the report's title naming the machine and the channels checked, not checked and checked under another machine's name), `channels.splitToDocuments`, `channels.assign`, `channels.testOnDocument`.
  - `channels.splitToDocuments`: one new **untitled** document per channel, holding that channel's ranges in document order **behind the program's own header lines** (the `%` leader, the `O` number or `%_N_…_MPF` / `;$PATH=` block), so each result is a program and not a fragment; named after the source file plus the channel id (`part — channel 1`), nothing written to disk. It is a **one-way copy for reading**: a confirmation before the first run and the status message afterwards both say that edits do not come back (the two-way mapping is Phase 4, §11 item 27), and the command is **disabled in `multi-file` layout**, where the channels are already separate documents.
  - Ribbon: the check on the Tools tab next to the M10 checks; the navigation in a `channels.group` on the NC tab. Test ids of §7.12.
- **Tests:** the resolution order with a fake `MachineService` (no machine, a machine without channels, a machine whose channel block is broken, a machine with channels and no match, a match); re-resolution on a content change, a machine change, a sibling opening and an assignment; the status text for each case; `check` with the sibling on **no machine** and on a **different machine** (both checked under the initiating document's machine, both named in the header); the grouped tree (a channel with several ranges, the "outside" group holding an inter-section subprogram, marks, a channel with no tools) and that `toolLines(id)` is byte-identical to M11's; `jumpLines` names a targeted label and not a plain one; the navigation decision functions (wrapping, the last mark, a partner in a document that is not open); `splitToDocuments` produces the golden texts **including the header**, touches no file, and is unavailable in `multi-file`; the file dialog receives the document's parent folder as `defaultPath` (fake dialog); the check report's title, its "not checked" list and its other-machine line.
- **Covers:** AD-32 (service, UI, navigation, assignment, split); X12 (a, b, c).

**Wave B**

#### WP12.6 Channels in the script context and the tool list

- **Owns:**
  - `src/lib/core/scripting/context.ts` and its test, `src/lib/app/scripts.ts` and its test
  - `src-tauri/resources/scripts/{_nc_channels.py,gedit_nc.py,tool_list.py}`
  - `tests/python/{test_channels.py,test_tool_list.py}`, `tests/fixtures/scripts/tool_list/channels/**`
- **Depends on:** WP12.1, WP12.5.
- **Deliver:**
  - `ScriptContextV2.channels` per §7.17, filled by `buildContext` from `BuildContextInput.channels`: the layout, which channel this document is, every declared channel with **its line ranges** (`single-file`; a channel may hold several) or file name, path and open flag (`multi-file`), the ranges that belong to **no** channel (`outside`), and the **blocking marks found in this document** with their ids and partner channels. Additive, `contract` stays 2 (F50); a document with `layout: 'none'` has no member at all, so every M5–M11 script and every user script is unaffected.
  - Python: `gedit_nc.channels(ctx)`, `channel_of(ctx, line)`, `channel_lines(ctx, lines, channel_id)`, `outside_lines(ctx, lines)` and `sync_marks(ctx)` in `_nc_channels.py`, re-exported by the facade; `channel_lines` concatenates every range of the channel in document order — what the control itself does when it separates a program into one program per turret — and never returns a line from `outside`. Each answers an empty result for a context without the member, so a script written against M11 keeps working and a script written against M12 runs on a single-channel document.
  - `tool_list.py`: when the context has sections, the rows are grouped by channel, a **Channel** column comes first and the summary names the channels; in `multi-file` mode the summary names the channel this document is and says that the other channels are separate runs. A combined list over several channel files needs multi-document input (P1 D16, §11 item 11) and is **not** claimed.
  - The API text for `src-tauri/resources/scripts/README.md` in the hand-off note (WP12.7 writes it).
- **Tests:** the context shape for each layout and for `none` (a pure `buildContext` test, no editor); every P1–M11 Python golden unchanged; the tool list on a two-section fixture (golden rows with the channel column), on a **four-section alternating** fixture (a channel's rows come from all of its ranges, in document order), on a `multi-file` channel (golden summary) and on a plain single-channel document (byte-identical to the M11 golden); `channel_lines` skips the `outside` ranges between two sections; `channels({})` and a context without the member answer empty.
- **Covers:** AD-32 (scripts); X12 (a).

#### WP12.7 Documentation

- **Owns:** `docs/user/channels.md` (new), `docs/user/{README,machines,scripts,shortcuts}.md`, `docs/planning/README.md`.
- **Depends on:** Wave A.
- **Deliver:** `channels.md`: what a channel is here and what gEdit does **not** do with it (no execution model, no reordering, no synchronization); how to set the two layouts up, with a worked example of each and of the three ways to say which channels a mark makes wait; that a channel may hold **several sections** and what happens to the lines between them; **aliases**, and why one channel usually needs more than one name; the **three sync semantics** (`rendezvous`, `count`, `ordered`) with one sentence each on what the check may conclude, and the warning that naming the wrong one produces findings on a correct program; how to write the patterns (with the note that they are the user's, and that gEdit ships none because the wait codes differ per machine and builder, D58); **what the check checks and what it cannot** — written ids and written order, not machine semantics, with jump targets and backward jumps named as the case it refuses to judge, and "a clean result is not a proof"; how to open the other channels, how to **assign** a document to a channel when no pattern fits, and why gEdit does not open files by itself; the split command **stated as a one-way copy for reading**; the navigation keys. In `machines.md`, the Channels step and the tester, and the note that a broken channel pattern costs the channels and not the machine's other settings; in `scripts.md`, `gedit_nc.channels` and the tool list's channel column with the multi-file limit; in `README.md`, the "What gEdit does not do" list gains the side-by-side channel view as a Phase 4 item, honestly worded, and the split's one-way nature.
- **Covers:** G8 docs check.

#### H12 Harness M12

- `m12-channels-config`: Settings ▸ Machines ▸ Channels: add a two-channel `single-file` machine with aliases and one sync rule, use the tester on pasted lines (it shows a channel with four sections as four ranges, not as a problem), save; `h_config_read('machines.json')` equals the golden; a rule with a pattern that does not compile is refused in the form and, when written into the file by hand, makes **the channel block** invalid — reported on the page, byte-stable after the next save — while the machine stays selectable and the document's number reading is unchanged (X12 d).
- `m12-channels-single`: the single-file fixture with that machine: the channel item reads "Channel 1 of 2" and follows the cursor across **both** of channel 1's sections; the map shows both channel rows with their tools and marks and an "Outside the channels" group holding the shared subprogram; the tool list has the channel column; "Split into channel documents" opens two untitled tabs with the golden text **including the header**, warns once that it is a one-way copy, and writes no file (`h_stat` on the folder); in the multi-file fixture the command is disabled.
- `m12-channels-multi`: `twin_CH1.nc` alone: "channel 2 found, not open"; the pick opens it through the dialog, which starts in the document's own folder; both open, the item names the channel per tab; with the sibling removed from the folder the item reads "not found"; a pair whose names match no pattern is tied together with "Assign this document to channel 2" and the assignment survives a restart.
- `m12-channels-check`: the mismatch fixtures: the golden findings in the Results panel, each row jumping to the right line **in the right document**; a clean pair reports no finding, **including the fixture with a label on every wait line and ids repeated in both channels**; the count and the ordered fixtures behave per their semantics; the report names the channels it did not check and, when the sibling carries another machine, says so and offers to use one machine for both.
- `m12-channels-nav`: next/previous sync point wraps inside the channel and crosses that channel's second section; "Go to the matching mark" crosses the section and, in multi-file mode, the document; with the partner channel closed it says so and moves nothing.
- `m12-channels-off`: the same fixtures with no machine and with a machine without channels: no channel item, the P1 map, and `m6-lathe-nav` unchanged.
- `m12-perf`: a generated **over-300,000-line** two-section document (the threshold that actually matters, F54) with a channel machine: open ≤ 2 s (the P1 budget), first resolution ≤ 150 ms, typing p95 unchanged, and the check at the contract cap (20,000 marks) inside the §7.17 budget.

**Integration I12:** merge Wave A; regenerate `tests/fixtures/resolved/**` (§5.2 rule 3) for the new goldens that name a machine; check that WP12.5's service runs against WP12.1's resolution and WP12.2's check (all three were built against the P12 contract); make every exhaustive `switch` over `OutlineKind` handle `channel` and `sync`; apply the G10 *changed* items.

**Gates:** G0–G6 (`m0`–`m12`); G7 (the budgets above, plus: the map aggregation of a grouped over-300k-line document stays inside the P1 outline budget; the wait-code check **at the contract cap** — 20,000 marks over 8 and over 32 channels — inside the §7.17 budget, not only at the 2,000-mark typical case; `channel_siblings` for 32 names ≤ 20 ms); G8 (capability diff empty, standing rules 6, 8, 14 and 15, `channels.rs` takes no folder, the pattern-subset scan covers `machines.json` patterns, and the `channel_siblings` name validator accepts exactly the character set the §4 row states); G10 (the check's semantics — the three `SyncSemantics` kinds against what each actually computes — and its stated limits, the fixtures and their goldens, and the confirmation that **no built-in profile declares a sync preset**, §8.9); G11 on the owner's machine if they have local multi-channel programs.

**Commit:** `M12: Multi-channel programs — channel configuration, wait-code check, per-channel map and tool list, sync-point navigation`

**Release:** v0.6 (§5.3).

---

### M13: Your own dialects and codes, and the Phase 2 exit

**Goal:** the owner sets up each machine's dialect details (folder, numbering, builder M-codes) as a user profile, next to its M6 machine configuration, and types without accidental lower case or merged blocks; Phase 2 closes with its exit criteria and the 1.0 release. (The templates half of the old M12 moved to Phase 3: see the end of this section.)

**Prelude P13:** the reload additions of §7.3 with `revision`/`reload`/`problems` stubs in `stores/{profiles,codes}.ts`; the `user_file*` Rust stubs in `src-tauri/src/userfiles.rs` (registered); `paths.rs` `ensure_dirs` for `<config>/{profiles,codes}`; the stub `app/userConfig.ts`; the `editing` blocks of `okuma-osp.json` and `sinumerik.json` (TODO decision "Upper-case typing on Okuma and Sinumerik", recommended yes), so AD-30 has a value on every profile it names; **the start-up order in `src/lib/app/bootstrap.ts`** — `await userConfig.load()` before `machines.load(configLoad)`, wired here against the stub, because the prelude is the only WP that edits `bootstrap.ts` (P1 §4.2) and WP13.2 only fills the body; `tests/fixtures/exit2/README.md`; `h.app.ctx.userConfig`; commit.

**Intentional behavior changes in M13:** typing in a Fanuc, lathe, Okuma or Sinumerik document is upper-cased and Backspace at column 1 no longer joins blocks (H13 updates the P1 scenarios that typed lower case or joined lines).

**Wave A**

#### WP13.1 Rust user files

- **Owns:** `src-tauri/src/{userfiles,paths}.rs` and their tests.
- **Depends on:** P13.
- **Deliver:** §7.10 `user_files_list`, `user_file_create`, `user_file_path`, `user_file_import`, `user_file_delete` with the §4 rules.
- **Tests (cargo):** names, sizes, the count cap, a symlink escape, import of a not-allowed source, no overwrite on create, JSON-object check, atomic write.

#### WP13.2 Reloadable registries

- **Owns:** `src/lib/stores/{profiles,codes}.ts` and their tests, `src/lib/monaco/languages.ts` and its test, `src/lib/app/outlineService.ts` and its test, `src/lib/app/userConfig.ts` and its test.
- **Depends on:** P13.
- **Deliver:** AD-29 reload: `profiles.reload(user)`, `codes.reload(user)` (user code files merged over the built-in of the same dialect; their `templates` are read once Phase 3 adds templates), the `revision` store, the effective-profile cache dropped, language re-registration and theme regeneration, outline rebuild for changed profiles (the modal rebuild comes with the TypeScript interpreter, P3.1), re-detection for a vanished profile; `userConfig.load()` at start (after settings, before `machines.load`, so a machine whose base is a user profile is valid at the first open) and after a save in the folders.
- **Tests:** reload keeps open documents; a broken user file is reported with its JSON path and the built-ins still work; a user id equal to a built-in id is rejected; reload re-registers without duplicates; an effective profile of a reloaded parent is recompiled.

#### WP13.3 User configuration commands and the Profiles page

- **Owns:** `src/lib/contrib/userConfig.ts`, `src/lib/core/profiles/testReport.ts` and its test, `src/lib/components/dialogs/{SettingsDialog,MachinesPage}.svelte` and their tests, `src/lib/stores/machines.ts` and its test (M13: import/export and re-validation on `profiles.revision`), `src/lib/i18n/en/{userConfig,settings,machines}.ts`.
- **Depends on:** P13.
- **Deliver:** the commands of AD-29; the Profiles page (list with origin, parent, file and problems; New from…, Open, Import, Export, Reload); `profile.testOnDocument` (Results rows per line: rule, captured text and time for detection, `toolCall` trigger/ignore/tool, program start/end, outline, references, numbering skips, **variant detection with its margin**; a warning above 50 ms); `machines.import` / `machines.export` (§4: export the whole file through the save dialog; import a picked file, validated like a hand edit, id collisions get a new id, name collisions a suffix, one summary); machines re-validated when the profile set changes (a machine whose base user profile appears becomes active, one whose base disappears becomes inactive, never deleted).
- **Tests:** `testReport` over the built-ins; the page actions with a fake command layer; machine import with collisions and invalid records; re-validation on a profile reload.
- **Covers:** "Profile editor with pattern tester" (lean); "Profile import/export" (machines included); X9 (the user-profile half).

#### WP13.4 Typing options

- **Owns:** `src/lib/core/nc/typing.ts` and its test, `src/lib/contrib/typing.ts`, `src/lib/i18n/en/typing.ts`.
- **Depends on:** P13.
- **Deliver:** AD-30 for `editing.forceUppercase` and `editing.preventLineJoin`; `edit.toggleForceUppercase` for the session.
- **Tests:** the decision functions (inside a comment or string, IME composing, modifiers, multi-cursor, a selection spanning a line break).
- **Covers:** "Editing options", "Forced uppercase", "Prevent joining blocks".

**Wave B**

#### WP13.5 Documentation

- **Owns:** `docs/user/**`, `README.md`, `docs/planning/{README,roadmap}.md`.
- **Deliver:** a full pass: own profiles and code files (an example user profile and an M-code table), how a user profile and a machine configuration divide the work, machine import/export, typing options; the roadmap marks Phase 2 done, adds machine configurations **and multi-channel programs** as Phase 2 rows, moves its backlog line "Split multi-channel lathe programs by channel and check wait codes (generic patterns only)" into Phase 2 as shipped, adds the **side-by-side channel view** to Phase 4 (§11 item 27), and narrows the "Not planned" entry so that it reads as it is meant: gEdit ships no machine-builder-specific sync **code set**, while the user's own channel and sync patterns are a supported machine parameter (D58, §8.9). The deferred rows move to Phase 3, Phase 4 or the backlog as §11 says, and the release notes of 1.0 say what Phase 2 did not do.

#### H13 Harness M13 and the Phase 2 exit criteria

- **Owns:** `tests/runtime/scenarios/**`, `tests/runtime/suites/m13.txt`, `tests/fixtures/exit2/**`.
- `m13-user-profile` (the user-profile half of X9), `m13-typing`.
- `m13-machines-io`: export the machines file, remove every machine, import it back; the list and the per-file choices are as before.
- **`m13-exit-criteria`:** X1, X2, X5, X6, X8, the user-profile half of X9, X11 and X12 in one run over `exit2/*`, saving at the end with golden bytes. **The order matters and is fixed here and in `tests/fixtures/exit2/README.md`:** X1 and X2 run **first, while no machine exists at all**, because they check what gEdit shows with nothing chosen (the detected G-code system, the assumed `DIAMON`); then X5, X6 and X8; then X9, X11 and X12, which create machines. X11(a) clears the default machine it set before X11(b) reads "Machine: none", and X12 runs **last** because its two machines carry channel blocks that every earlier criterion must not see — X12(c) re-checks one earlier fixture with those machines defined but not chosen.
- **`m13-exit-criteria-nopython`:** the parts that need no Python (detection, navigation, renumber with rewrite, compare, search, the machine choice and the whole of X12 except the tool list's channel column) with `GEDIT_PYTHON=/nonexistent`; the script commands show the P1 "Python not found" message.

**Integration I13:** the full cumulative suite; the performance numbers in the commit body.

**Gates:** G0–G11 with the full suite. **Phase 2 is done** when §2.2 holds.

**Commit:** `M13: User profiles and code files, typing options and the Phase 2 exit criteria`

**Release:** 1.0, after the owner's bundle check on the three platforms (§5.3, §13).

---

### Designed in Phase 2, moved to Phase 3: understand a block and templates

These designs were written for the old M11 (without address arithmetic, now WP10.4) and the old M12 (its templates half). The third revision (2026-09-30, D69) moves them to the new **Phase 3, "Understand and write"**: they help the owner understand and write a program, they do not make CAM output safer, and the TypeScript modal interpreter they share has no consumer in Phase 2. Their contracts stay where they are (the TypeScript half of §7.4, §7.8, the `ModalService` of §7.3, AD-19's TypeScript half, AD-27, AD-28) and their exit criteria move with them (X7; the templates half of X9). The Phase 3 plan gives them a milestone, a prelude and harness names of their own; until then they keep the ids P3.1–P3.6 below. The roadmap's Phase 3 rows that belong to them — cycle forms, formula parameters, the template manager and "create from selection", motion-mode line coloring from the modal interpreter — are planned with them. **What stays true in Phase 2 because of the move:** the Insert tab keeps the Phase 1 blocks, which exist for the mill and Klartext only (F34, D13 stays open); hover explains codes and addresses as in Phase 1, without the modal context and the effective values; G11 checks the Python modal state only, and the per-line TS/Python parity waits for P3.1.

**Phase 3 prelude (was P11 and the templates half of P12):** `ModalService` and the inspector contracts (§7.4, §7.3); stubs `core/nc/modal.ts`, `app/modalService.ts`, `core/codes/inspect.ts`, `core/nc/rewriteWord.ts`; `h.app.ctx.modal`; `Mod+Alt+A` in the key plan with `findConflicts` clean; contracts §7.8 (templates); stubs `core/templates/index.ts`. No layout contract change (AD-27).

**Intentional behavior changes when they land:** the Insert tab shows templates instead of blocks (the `insert.block:*` commands and test ids go; the P1 scenarios' `insert.block:start` moves to `insert.template:program-start`).

#### P3.1 TS modal interpreter, index and service (was WP11.1)


- **Owns:** `src/lib/core/nc/modal.ts` and its tests (including `modal.golden.test.ts`), `src/lib/app/modalService.ts` and its test.
- **Depends on:** the Phase 3 prelude (goldens from M6, M8 and M9).
- **Deliver:** `ModalInterpreter` and `ModalIndex` (AD-19, §7.4) passing **every** golden in `tests/fixtures/modal/**` unchanged (each golden's `machine` member applied through `applyMachine`); `ModalService` per document, fed by content changes, rebuilt when the document's effective key changes (profile, database, variant or machine parameters).
- **Tests:** the goldens; property test: over 1,000 random edits, `stateAfter(n)` equals a fresh sequential walk; 300k lines stepped < 1.5 s in node (assertion < 4 s); `stateAfter` within 1,000 lines of a snapshot ≤ 15 ms.
- **Covers:** "Modal interpreter" (TS half).

#### P3.2 Code inspector and edit value (was WP11.2)


- **Owns:** `src/lib/core/codes/inspect.ts` and its test, `src/lib/core/nc/rewriteWord.ts` and its test, `src/lib/components/panels/InspectorPanel.svelte`, `src/lib/contrib/inspector.ts`, `src/lib/i18n/en/inspector.ts`.
- **Depends on:** the Phase 3 prelude.
- **Deliver:** AD-27: `inspectBlock`; the left-region panel (`view.toggleInspector`, `Mod+Alt+A`); it follows the cursor with rAF throttling; double-click or Enter on a value → prompt → `rewriteWord` → `applyLines`; Esc cancels; validation per AD-27; test ids per §7.12.
- **Tests:** rows for packed Fanuc, lathe (`U` incremental, `X` diameter, `F` a lead under `G76`), a Klartext multi-line cycle, Okuma `SB=`, Sinumerik `CYCLE83(…)`, and a Sinumerik `X` labelled "radius" under `DIAMOF` and under `DIAM90` + `G91` (AD-19 rule 11); the effective-value column for `X50` under IS-B and calculator with the source, and under **none** as the list of readings, where the row is not editable and says why, while `X50.` is editable; `rewriteWord` keeps the point, the decimals, the sign, the spacing, the address case and a trailing comment, and keeps typed extra decimals; a typed `0.0505` into a point-less IS-B word is refused (not a whole number of increments), `0.051` becomes `X51`; the same refusal for a point-less word under an Okuma 10 µm machine (`0.015` is not a whole number of units); a violation is refused.
- **Covers:** "Code inspector panel", "edit values"; X7.

#### P3.3 Hover with cycle parameters and modal context (was WP11.3)


- **Owns:** `src/lib/core/codes/hoverText.ts` and its test, `src/lib/monaco/providers/hover.ts`, `src/lib/i18n/en/assistant.ts`.
- **Depends on:** the Phase 3 prelude.
- **Deliver:** on a cycle word, a table of its parameters with the values in the block; on an address word, one context line (`X — target, diameter, absolute, work offset G54`; under `DIAMOF` or `DIAM90` + `G91` "radius" instead of "diameter", AD-19 rule 11; `U — incremental X`; `F — feed per revolution (G99)`; under a pitch cycle `F — thread lead (G76)`; under CSS `S — surface speed (G96), clamp S2500 (line 4)`); a word whose value depends on the machine adds its effective value and why (`X50 — 0.050 mm: no decimal point, increments of 0.001 mm (machine 'Lathe 2')`), and with **no machine** every reading instead of one value (`X50 — no decimal point: 50 mm as written (calculator, profile default), 0.050 mm (IS-B), 0.0050 mm (IS-C); choose a machine`; on Okuma the same for a word **with** a point, because the unit system scales it); assumed values marked with their source. The hover reads the document's effective database, so a system-B document explains `G94` as a feed mode and a system-A one as a facing pass. Text stays escaped, untrusted markdown.
- **Tests:** the pure hover text for these cases across the five built-in profiles, with and without a machine; hover at line 300k ≤ 50 ms.
- **Covers:** "Hover with cycle parameters and modal context".

#### P3.4 Template engine (was WP12.1)


- **Owns:** `src/lib/core/templates/**` and tests.
- **Depends on:** the Phase 3 prelude.
- **Deliver:** `loadTemplates`, `templateFields`, `renderTemplate`, `validateTemplateValues` (§7.8) with the placeholder and parameter options of `code-assistant.md` "Parametric templates" and "Placeholders" except formulas: prefix/suffix, decimals (`as-entered`, `min1`, fixed), digit padding, plus sign, comment wrapping with the profile's delimiters, an empty optional parameter drops its word, a line left with only a block number drops, `\{{`, `{{N}}`, `{{sys.*}}`.
- **Tests:** every option; validation never corrects a value; `{{N}}` with and without numbering.

#### P3.5 Templates in the UI (was WP12.2)


- **Owns:** `src/lib/contrib/templates.ts`, `src/lib/components/shell/TemplatesGroup.svelte`, `src/lib/monaco/providers/completion.ts`, `src/lib/core/codes/completionItems.ts` and its test, `src/lib/i18n/en/templates.ts`. **Deletes** `src/lib/contrib/blocks.ts`, `src/lib/components/shell/BlocksGroup.svelte`, `src/lib/utils/insertBlock.ts` and its test, `src/lib/data/blocks/**`, `src/lib/i18n/en/blocks.ts`.
- **Depends on:** the Phase 3 prelude.
- **Deliver:** AD-28: the Insert tab by group (toolbar templates as buttons; the Home tab keeps one button for the active document's `program-start` template); `insert.template:<id>` in the palette; the form through `modals.form` with remembered values (`lastParams['template:'+id]`); one undo step (Klartext with the renumber in the same edit); snippet templates through the snippet controller; templates in completion. Every one of these reads `machines.effective(docId).codes.templates` — the document's effective database, never `templates(profileId)` — and re-reads on a document switch and on `machines.revision`, because the variant is a property of the document (AD-31).
- **Tests:** the insertion edit (numbered, unnumbered, Klartext renumber); completion items; a document under `gcodeSystem: B` offers the `fanuc-lathe-b` override of "Tool start" (`G92 S`), the same document under A the `fanuc-lathe` one.

#### P3.6 Template content (was WP12.3)


- **Owns:** the `templates` arrays in `src/lib/data/codes/*.json` (only this WP edits those files in its milestone), `tests/fixtures/templates/**`.
- **Depends on:** the Phase 3 prelude.
- **Deliver:** §8.6 in our own words.
- **Tests:** every template renders with its defaults and tokenizes without `unknown` tokens in code positions; a golden per template.
- **Acceptance:** G10; the owner reviews the default set (§13).

**Documentation and harness (was WP11.5, H11 and part of H12):** the user guide gains the inspector, the hover and the templates. The scenarios designed for them keep their old names until Phase 3 renames them: `m11-inspector` (X7), `m11-hover` (a parameter table with values; the modal line on a lathe feed under `G76`; `X50` under none, IS-B and calculator, the hover half of X11 c), `m11-perf` (inspector open while typing at 300k lines; update ≤ 30 ms per cursor move; a machine switch rebuilds the modal index in idle chunks) and `m12-templates` (the templates half of X9). Phase 2 reuses two of the old prefixes: `m11-perf` of Phase 2 is the compare and search budget of H11, and `m12-*` of Phase 2 are the channel scenarios of H12, so Phase 3 gives these four new names.

**Gates when they land:** G0–G6 with the cumulative suite; G7 (the budgets above; the P1 typing budget with the inspector open); G8; G10 (template content, the hover texts); **G11 with full per-line TS/Python modal parity** on every local real program, each run with the machine its manifest names (on the owner's machine; the committed goldens and the owner-public files give the same parity check in CI).

---

## 7. Shared contracts (binding; written by the preludes)

P1 §7 stays binding: a type is imported only from its home file; a later prelude replaces a placeholder at the same path; a WP keeps a pinned signature and replaces only the body; `app/types.ts` stays the home of the service interfaces. Everything below is **additive** unless §7.14 says otherwise.

### 7.1 Profile additions: `src/lib/core/profiles/types.ts` (P6, P8, P9, P11, P12, P13)

```ts
export type MachineType = 'mill' | 'lathe';
export type FeedUnit = 'per-minute' | 'per-rev' | 'per-tooth' | 'inverse-time' | 'unknown';

export interface Profile {
  // … every P1 §7.4 field …
  /** P6. Parent profile id; resolved before validation (AD-16), kept on the result for display. */
  extends?: string;
  /** P6. Default 'mill'. Scripts, hover and the inspector read it (auto options, diameter wording).
   *  Named `machineType` so it is never confused with a machine configuration (AD-31). */
  machineType?: MachineType;
  /** P8 widens the P1 union. */
  grammar: 'iso' | 'klartext' | 'okuma' | 'sinumerik';
  /** P6. The power-on state. `initial`: modal group → canonical code in force at the top of a program.
   *  `units`, `diameter` and `sources` are written by `applyMachine` (AD-31) from the machine or the
   *  defaults in `machineParams`; a built-in JSON writes only `initial`. All are applied as "assumed",
   *  and `sources` tells the interpreter where each came from (AD-19 rule 8): a key per modal group
   *  plus 'units' and 'diameter'. */
  modal?: { initial?: Record<string, string>; units?: 'mm' | 'inch'; diameter?: 'on' | 'off';
            sources?: Record<string, ParamSource> };
  /** P6. What a machine configuration of this profile may set, with the documented defaults (AD-31, §7.15, §8.8).
   *  Absent: the profile has no machine parameters (Klartext) and no machine item. */
  machineParams?: MachineParamsDecl;
  addresses: {
    // … P1 fields …
    /** P6. Incremental address → the axis it moves: { U: 'X', W: 'Z' }. */
    incremental?: Record<string, string>;
    /** P6. Addresses written as a diameter while the diameter mode is on: ['X', 'U']. */
    diameter?: string[];
    /** P6. Rotary axes, whose number class is `angle` (AD-31): ['A', 'B', 'C']. */
    angular?: string[];
    /** P6. Words that set the feed unit (Klartext { FU: 'per-rev', FZ: 'per-tooth' }); a plain feed word returns to the group's unit. */
    feedUnitWords?: Record<string, Exclude<FeedUnit, 'unknown'>>;
    /** P8. Assignment words whose value is a spindle-speed clamp (Sinumerik ['LIMS']). */
    speedLimitWords?: string[];
  };
  toolCall: {
    // … P1 fields (trigger, tool, toolFrom) …
    /** P6. A trigger line whose masked text also matches this is not a tool change (`T0100`; an Okuma `T` in a cycle block). */
    ignore?: Pattern;
  };
  syntax: {
    // … P1 fields …
    /** P8. `N` + a letter-led name (Okuma NLAP1) is a `label` token, never a block number. */
    sequenceNames?: boolean;
    /** P8. An address matching this at a word start takes `=` + expression (Okuma SB=, Sinumerik CR=, S3=, R1=). */
    assignment?: Pattern;
    /** P8. A label definition at block start (Sinumerik `NAME:`); named group `name`. */
    labels?: Pattern;
    /** P8. An identifier directly followed by `(` is one `call` token up to the matching `)`. */
    calls?: boolean;
    /** P8. System variables: `\$[A-Z_][A-Z0-9_]*`, Okuma `V[A-Z][A-Z0-9]{3}`. */
    systemVariables?: Pattern;
    /** P8. A first-line header read as one `programMarker`: `^\$[^%]*%` (Okuma), `^%_N_\w+_(MPF|SPF)` (Sinumerik). */
    header?: Pattern;
  };
  numbering: NumberingOptions;           // P1; `references` entries gain `rewrite`
  /** P11 reads it (P1 carried it). `tolerance` is ignored if present (§2.1). */
  compare?: Partial<CompareOptions>;
  /** P13 reads it (P1 carried it). */
  editing?: { forceUppercase?: boolean; preventLineJoin?: boolean };
}
export interface NumberingOptions {
  // … P1 fields …
  /** P6: `rewrite` defaults to true; false = report only (Fanuc `M99 P`). */
  references?: { trigger: Pattern; addresses: string[]; rewrite?: boolean }[];
}

// The machine-parameter declaration (P6). NumberInput and NumberClass are imported from core/machines/types.ts (§7.15).
export interface NumberInputPreset {
  id: string;                         // 'is-b', 'calculator', 'okuma-10um'
  label: string;                      // display text (data, untranslated)
  value: NumberInput;
  /** Where the notes say so ('syntax-okuma.md §3.3'); absent together with `verify: true` = a documented default only. */
  source?: string;
  verify?: boolean;
}
/** A profile overlay: merged like `extends` (AD-16), limited to these members (validated). */
export type ProfileOverlay = Partial<Pick<Profile, 'modal' | 'toolCall' | 'numbering' | 'addresses'>>;
export interface VariantChoice {
  value: string;                      // 'A'
  label: string;                      // 'G-code system A'
  /** The code database for this choice (an AD-17 child of the profile's `codes`); absent = `codes`. */
  codes?: string;
  overlay?: ProfileOverlay;
  /** Scored on the first 400 masked lines, only when no machine is chosen. Unlike `detect.content`,
   *  each pattern scores its weight **once** (presence), so a marker a post repeats in every block
   *  cannot outvote a single decisive one (WP6.1). */
  detect?: { pattern: Pattern; weight: number }[];
}
export interface VariantDecl { id: string /* 'gcodeSystem' */; label: string; default: string; choices: VariantChoice[] }
export interface MachineParamsDecl {
  /** Absent: numbers are read as the profile's JSON says, with no choice (Klartext). */
  numberInput?: { default: string /* preset id */; presets: NumberInputPreset[] };
  units?: 'mm' | 'inch';              // power-on default; absent = 'mm'
  diameter?: 'on' | 'off';            // lathes only; absent = not a lathe parameter
  /** Modal groups whose power-on code a machine may set (the dialog offers their codes). */
  modalGroups?: string[];
  variants?: VariantDecl[];
  /** M12, AD-32. Ready-made channel setups a user can start from. **No built-in profile declares one
   *  in Phase 2** (§8.9): the wait codes differ per machine and per builder, and gEdit ships none.
   *  Absent changes nothing — a machine of this profile may still be given channels by hand. */
  channels?: { presets: { id: string; label: string; source?: string; verify?: boolean; value: ChannelParams }[] };
}

// core/profiles/resolve.ts (implemented by P6; WP6.1 owns it afterwards)
export interface ProfileSource { raw: unknown; origin: 'builtin' | 'user'; file?: string }
export interface ResolvedProfile { profile: Record<string, unknown>; origin: 'builtin' | 'user'; file?: string; chain: string[] }
export interface ProfileProblem { origin: 'builtin' | 'user'; file: string | null; profileId: string | null; path: string; message: string }
export const MAX_EXTENDS_DEPTH = 4;
export function mergeProfile(parent: Readonly<Record<string, unknown>>, child: Readonly<Record<string, unknown>>): Record<string, unknown>;
export function resolveProfiles(sources: readonly ProfileSource[]): { resolved: ResolvedProfile[]; problems: ProfileProblem[] };

// core/profiles/compile.ts: CompiledProfile.re gains toolIgnore? (P6); assignment?, labels?, systemVariables?, header? (P8)
// data/profiles/index.ts (P6)
export const BUILTIN_PROFILE_SOURCES: readonly ProfileSource[];
export const BUILTIN_PROFILE_JSON: readonly unknown[];   // the resolved built-ins, registry order
```

### 7.2 Code database additions: `src/lib/core/codes/types.ts` (P6, P8, P9, P10; templates in Phase 3)

```ts
/** P6. What a code switches on; read by the modal interpreter (AD-19). */
export interface CodeSets {
  feedUnit?: 'per-minute' | 'per-rev' | 'per-tooth' | 'inverse-time';
  speedUnit?: 'rpm' | 'surface';
  distance?: 'absolute' | 'incremental';
  units?: 'mm' | 'inch';
  plane?: 'XY' | 'ZX' | 'YZ';
  /** A cycle entry starts or cancels a cycle; a non-modal start applies to its own block only. */
  cycle?: 'start' | 'cancel';
  /** The S word of this block is a spindle-speed clamp (Fanuc A G50, B G92; Sinumerik G26). */
  speedLimit?: boolean;
  // P9 (TODO "Ahead"): whether the limit is an upper or a lower one (Sinumerik G25); pinned by P9, filled by WP9.5, §7.16.
  /** Switches diameter programming (Sinumerik DIAMON 'on', DIAMOF 'off', DIAM90 'absolute-only'). */
  diameter?: 'on' | 'off' | 'absolute-only';
}
// CodeParam (P1 §7.4) gains, P6:
export interface CodeParam {
  // … P1 fields (address, label, required, min, max) …
  /** How a value of this parameter is read (AD-31; it wins over every other rule). Absent: by the
   *  address's class. 'increment': a whole number of least increments, whatever the address suggests
   *  (§8.2: Fanuc G74/G75 P/Q, G76 Q, G83/G87 Q, in µm);
   *  'count': a plain integer no reading touches (dwell ms, repeat counts K/L, block and program
   *  numbers). The complete list per code is the table in §8.2, which WP6.2 and AD-31 both read. */
  unit?: NumberClass | 'increment' | 'count';
  // P10 (roadmap R8, proposed): a role for a parameter that holds an absolute position on the tool axis
  // (the drilling cycles); name and type pinned by P10 and recorded in §7.16.
}
export interface CodeEntry {
  // … P1 fields (code, aliases, group, modal, pitchFeed, pitchFeedAmbiguous, label, description, params, verify) …
  sets?: CodeSets;                  // P6
  /** P8. The F word of this block is a time, not a feed (Okuma G04 F, Sinumerik G4 F). */
  fNotFeed?: boolean;
  // P9 (roadmap R3): `wordsAreData` (in the code since `dec/scaling`, §7.16 #37), extended or joined by a
  // second flag for a block's plain axis words, and a flag for a code that opens or closes a coordinate
  // frame; names and types pinned by P9 and recorded in §7.16.
}
export interface CodeDb {
  // … P1 fields …
  templates: TemplateDef[];         // Phase 3 (P3.4); [] until then
}
/** P6. The file format; `CodeDb` is what loading and resolving give. */
export interface CodeDbFile {
  dialect: string; version: 1;
  extends?: string;                 // parent dialect id
  remove?: string[];                // parent codes this database does not have
  addresses?: CodeDb['addresses']; codes: unknown[]; templates?: unknown[];
}
// core/codes/resolve.ts (implemented by P6)
export function resolveCodeDbs(files: Record<string, unknown>, onProblem?: (dialect: string, p: CodeDbProblem) => void): Record<string, CodeDb>;
```

A `group` stays free text (P1). The modal interpreter treats every `modal: true` entry's `group` as a modal group; the content rules (§8) fix the names: `motion`, `plane`, `units`, `distance`, `feedmode`, `spindlemode`, `spindle`, `coolant`, `compensation`, `lengthComp`, `offset`, `cycle`, `cyclereturn`, `diametermode`. A machine's `modalInitial` may only name groups its profile lists in `machineParams.modalGroups`.

### 7.3 Registries and services (P6, P12, P13; `ModalService` in Phase 3)

```ts
// app/types.ts — ProfileInfo (P1 §7.2) gains, P6:
export interface ProfileInfo { /* … */ machineType: MachineType; origin: 'builtin' | 'user'; parent: string | null; file: string | null;
  chain: string[] /* own id first, then the parents */; hasMachineParams: boolean }

// ProfileRegistry (P1 §7.2) gains, P6 (WP6.1 owns it from Wave A on):
//   effective(id: string, eff: EffectiveMachine): EffectiveProfile;   // applyMachine → validate → compile; cached by eff.key
//   detectVariants(id: string, text: string): Record<string, { value: string; margin: number }>;
// CodeDbService (P1 §7.3) gains, P6:
//   byId(dialect: string): CodeDb;                                    // a resolved database by id (variant databases)

// ProfileRegistry (P1 §7.2) gains, P13:
export interface UserFileText { name: string; text: string }
export interface ProfileRegistry {
  /* … P1 … */
  readonly revision: Readable<number>;              // bumps on every reload that changed the set
  problems(): ProfileProblem[];
  reload(user: UserFileText[]): ProfileProblem[];   // built-ins + user files, resolved again; never throws
}
// CodeDbService (P1 §7.3) gains, P13:
export interface CodeDbService {
  /* … P1 … */
  // No templates(profileId): a document's templates come from its EFFECTIVE database
  // (`machines.effective(docId).codes.templates`), because the variant is chosen per document (AD-28, AD-31).
  reload(user: UserFileText[]): ProfileProblem[];   // user code files merged over the built-in of the same dialect
}
// OutlineService (P1 §7.3) gains, P12 (AD-32):
//   toolLines(id: DocId, channelId?: string): number[];    // without a channel: the P1 list, unchanged
//   `items(id)` may return `channel` groups (the items of ALL of that channel's ranges as `children`,
//   its blocking marks as `sync` rows) and one "outside the channels" group for the ranges no channel
//   owns (header, inter-section, trailing); `itemAt` resolves through the groups. `OutlineIndex` is unchanged,
//   so every committed outline golden stays as it is. The grouping comes from `channels.forDoc(id)`.

// Phase 3 (P3.1; P11 before the third revision): app/modalService.ts → export const modal: ModalService
export interface ModalService {
  stateAfter(id: DocId, line: number): ModalState | null;   // null until the document's index is ready
  readonly changed: Readable<number>;
}
```

### 7.4 Modal interpreter (types P6; Python WP6.4, the Klartext defined cycle P9 and WP9.5; TS Phase 3, P3.1)

```ts
// core/nc/types.ts (P6)
export interface ModalValue { code: string; line: number /* 0 = assumed at the top */; assumed: boolean;
  /** For an assumed value: where it came from (§7.15 ParamSource: the document's machine, a detected
   *  variant's overlay, or the profile's default). Read from `modal.sources` (AD-19 rule 8). */
  from?: ParamSource }
export interface WordSeen { valueText: string; line: number; variable: boolean }   // `variable`: a variable or expression
export interface ModalState {
  /** Modal group → the code in force ('motion' → 'G1', 'feedmode' → 'G99'). */
  groups: Record<string, ModalValue>;
  feedUnit: FeedUnit;
  speedUnit: 'rpm' | 'surface' | 'unknown';
  /** 'absolute' without a line on a database that has no distance codes at all (AD-19 rule 8). */
  distance: 'absolute' | 'incremental' | 'unknown';
  /** The power-on value is assumed (machine, detected variant or profile); `G20`/`G21` set it with their line. */
  units: { value: 'mm' | 'inch' | 'unknown'; line: number; assumed: boolean; from?: ParamSource };
  plane: 'XY' | 'ZX' | 'YZ' | 'unknown';
  /** Diameter programming of the `addresses.diameter` words; null on a profile without the parameter (a mill).
   *  Whether one word is a diameter or a radius value also depends on `distance` (AD-19 rule 11). */
  diameter: { mode: 'on' | 'off' | 'absolute-only'; line: number; assumed: boolean; from?: ParamSource } | null;
  /** The tool of the last tool line: `station` as the profile's `tool` group captured it, `written` the whole word. */
  tool: { station: string; written: string; line: number } | null;
  feed: WordSeen | null; speed: WordSeen | null;
  /** Last clamp value (an S in a `sets.speedLimit` block, or a `speedLimitWords` assignment). */
  speedLimit: WordSeen | null;
  activeCycle: { code: string; line: number; pitchFeed: boolean } | null;
  pitchFeedAmbiguous: string | null;
  /** Flags of the block just applied only. */
  block: { cycle: string | null; pitchFeed: boolean; speedLimit: boolean; fNotFeed: boolean; toolChange: boolean };
}

// core/nc/modal.ts (Phase 3: the prelude's stub, P3.1)
export class ModalInterpreter {
  constructor(cp: CompiledProfile, db: CodeDb);         // the EFFECTIVE compiled profile and database (AD-31)
  reset(): void;                                        // modal.initial, modal.units, modal.diameter applied as assumed
  update(tokens: NcToken[], line: number, masked: string): void;   // one line; `masked` for the tool rule
  state(): ModalState;                                  // a frozen copy
  snapshot(): unknown; restore(s: unknown): void;
}
export class ModalIndex {
  constructor(cp: CompiledProfile, db: CodeDb, o?: { every?: number /* 1000 */ });
  reset(lineCount: number, getLine: (n: number) => string): void;
  applyChange(firstChangedLine: number, lineCount: number, getLine: (n: number) => string): void;  // drops snapshots ≥ first line
  stateAfter(line: number): ModalState;                 // 1-based
  ready(): boolean;
}
```

Golden format, shared by Python (M6) and vitest (Phase 3, P3.1), `tests/fixtures/modal/<profileId>/<case>.json`:

```json
{ "input": "../../nc/fanuc-lathe/l05-system-b.nc",
  "machine": { "variants": { "gcodeSystem": "B" }, "modalInitial": { "feedmode": "G95" } },
  "states": [ { "line": 12, "after": { "groups": { "feedmode": "G95", "spindlemode": "G96" }, "feedUnit": "per-rev",
                                       "tool": "01", "speed": "220", "speedLimit": "2500" } },
              { "line": 3,  "after": { "groups": { "plane": "=G18", "feedmode": "=G95@machine" }, "diameter": "=on" } },
              { "line": 20, "after": { "activeCycle": null, "block": { "cycle": "G71" } } } ] }
```

Only the listed keys are compared. `machine` (optional) is a partial `MachineParams` applied as the document's machine (source `machine`); without it the golden runs with no machine (profile defaults, source `profile`, variants as **detected**, source `detected`). A group value is the code, or `=<code>` for an assumed one, with the source appended when it is not the profile: `=<code>@machine`, `=<code>@detected`; `units` and `diameter` are the value with the same prefixes; `tool` is the station; `feed`/`speed`/`speedLimit` are the value text. Python exposes the same camelCase keys.

Both languages read the golden's **effective profile** from the generated `tests/fixtures/resolved/effective/**` (P6 item 12) — TS may also apply `applyMachine` itself, Python never merges — so a golden that names a machine or relies on variant detection runs against exactly one merge result. A golden whose effective profile has not been generated yet is a spec golden (§5.2 rule 3) and fails with "run `UPDATE_RESOLVED=1 npm test -- resolved`".

```python
# _nc_modal.py, re-exported by gedit_nc (P6 stub, WP6.4); standard library only, Python 3.9 syntax
class ModalInterpreter:
    def __init__(self, cp: "CompiledProfile", codes: "Sequence[dict]") -> None: ...
    def reset(self) -> None: ...
    def update(self, tokens: "Sequence[Token]", line: int, masked: str = "") -> None: ...
    @property
    def state(self) -> dict: ...        # the ModalState keys above
    # conveniences: feed_unit, speed_unit, tool, active_cycle, pitch_feed, pitch_feed_ambiguous,
    #               block_speed_limit, block_f_not_feed
class FeedModeTracker: ...              # P1 §7.10, now a wrapper; attribute values unchanged
def machine_type_of(profile: dict) -> str: ...       # 'mill' | 'lathe' (not the machine configuration: see machine_params, §7.15)
def incremental_axes(profile: dict) -> dict: ...     # {'U': 'X', 'W': 'Z'}
def diameter_axes(profile: dict) -> list: ...
```

### 7.5 Tokens (P8)

```ts
// core/nc/types.ts — P1 §7.4 TokenKind gains:
export type TokenKind = /* P1 kinds */ | 'label' | 'call';
// label: Okuma sequence name (`NLAP1`), Sinumerik `NAME:`; `address` = the name, upper case.
// call:  `CYCLE81(…)`, `MSG("…")`, `L10(1)`; `address` = the identifier, `valueText` = the argument text; not tokenized inside.
// assignment words: kind 'word', `address` = the letters ('SB', 'CR', 'S3'), `valueText` = the right-hand side; `value` null unless a plain number.
```

The Python `Token.kind` takes the same strings; the token golden format is P1 §7.4's.

### 7.6 Search (P11): `src/lib/core/search/types.ts`

```ts
export type WordOp = '=' | '!=' | '<' | '<=' | '>' | '>=';
export type SearchQuery =
  | { kind: 'word'; address: string; op?: WordOp; value?: string /* decimal text; absent = any value */ }
  | { kind: 'text'; text: string; regex: boolean; caseSensitive: boolean; inComments: boolean };
export interface SearchHit { line: number /* 1-based */; start: number; end: number /* 0-based columns */; text: string }
export function parseQuery(input: string, cp: CompiledProfile, o: { wholeAddress: boolean; regex: boolean; caseSensitive: boolean; inComments: boolean }): SearchQuery | { error: Msg };
export function findInLines(lines: string[], cp: CompiledProfile, q: SearchQuery, o?: { max?: number /* 10000 */ }): { hits: SearchHit[]; truncated: boolean };
export function replaceInLines(lines: string[], cp: CompiledProfile, q: SearchQuery, replacement: string): { lines: string[]; count: number };
export function wholeAddressRegex(address: string, value: string): string;   // '(?<![A-Z])G0*1(?![\\d.])'
```

Value comparison is decimal: `1` = `01` = `1.` = `1.0`. A word query never matches inside a comment or string.

### 7.7 Compare (P11): `src/lib/core/compare/types.ts` and `CompareService`

```ts
export interface CompareOptions { ignoreBlockNumbers: boolean; ignoreWhitespace: boolean; ignoreComments: boolean; ignoreCase: boolean; ignoreNumberFormat: boolean }
export function compareDefaults(p: Profile): CompareOptions;
export interface Normalized { text: string /* LF */; lineMap: Int32Array /* normalized index → original 1-based line */ }
export function normalizeLines(lines: string[], cp: CompiledProfile, o: CompareOptions): Normalized;
export function unifiedDiff(a: { name: string; lines: string[] }, b: { name: string; lines: string[] }, o?: { context?: number /* 3 */ }): string;

// app/types.ts — CompareService (P1 §7.3) gains:
export interface CompareService {
  /* … P1 … */
  readonly mode: Readable<'raw' | 'review'>; setMode(m: 'raw' | 'review'): void;
  readonly options: Readable<CompareOptions>; setOptions(p: Partial<CompareOptions>): void;
  copyChange(direction: 'toModified' | 'toOriginal', o?: { lineOnly?: boolean; thenNext?: boolean }): Promise<boolean>;  // raw only; one undo step in the target
  exportDiff(o: { normalized: boolean }): Promise<DocId | null>;
  openFiles(a?: string, b?: string): Promise<boolean>;   // picks what is missing, opens both as documents, compares
}
```

### 7.8 Templates (Phase 3, P3.4): `src/lib/core/templates/types.ts`

```ts
export interface TemplateParam {
  id: string; label: string; type: 'number' | 'integer' | 'text' | 'choice';
  help?: string; required?: boolean; min?: number; max?: number; default?: string | number;
  choices?: { label: string; value: string }[];
  prefix?: string; suffix?: string;
  decimals?: 'as-entered' | 'min1' | number;
  digits?: number; plusSign?: boolean; uppercase?: boolean;
  comment?: boolean;                // wrap in the profile's comment delimiters
  remember?: boolean;
}
export interface TemplateDef {
  id: string; label: string; group: string; description?: string;
  toolbar?: boolean; snippet?: boolean; body: string; params?: TemplateParam[];
}
export interface TemplateEnv {
  cp: CompiledProfile; prevBlockNumber: number | null; numbered: boolean;
  sys: { date: string; time: string; file: string; stem: string };
}
export function loadTemplates(raw: unknown, onProblem?: (p: { path: string; message: string }) => void): TemplateDef[];
export function templateFields(t: TemplateDef): FieldSpec[];
export function validateTemplateValues(t: TemplateDef, values: Record<string, unknown>): Record<string, Msg>;   // never corrects
export function renderTemplate(t: TemplateDef, values: Record<string, unknown>, env: TemplateEnv):
  { ok: true; text: string } | { ok: false; errors: Record<string, Msg> };
```

### 7.9 Documents, recovery, session and memory (P7)

```ts
// app/types.ts — DocMeta (P1 §7.2) gains:
readOnly: boolean;
readOnlyReason: 'attribute' | 'user' | null;

// FileOps (P1 §7.2) gains:
restoreDocument(o: { path: string | null; title: string; profileId: string; machineId?: string | null; encoding: FileEncoding; eol: Eol;
                     nul: NulInfo; textLF: string; diskStamp: DiskStamp | null }): DocId;  // dirty; bound to `path` only when allowed
setReadOnly(id: DocId, readOnly: boolean): void;
onWillClose(cb: (id: DocId) => void): Disposable;                                        // before the model is disposed

// BookmarkService (P1 §7.3) gains:
set(id: DocId, lines: number[]): void;

// stores/fileMemory.ts → export const fileMemory: FileMemoryStore
export interface FileMemo { line: number; column: number; top: number; bookmarks: number[]; profileId?: string;
  /** AD-31: a machine id, or null for an explicit "none"; absent = follow the profile's default machine. */
  machineId?: string | null;
  /** AD-32, written by M12's `channels.assign`: which channel of a `multi-file` set this document is,
   *  when no pattern says. Additive to the M7 record; an M7 build keeps it verbatim like any unknown
   *  member, and a channel id naming a channel the current machine does not declare is ignored. */
  channelId?: string | null; at: number }
export interface FileMemoryStore {
  get(path: string): FileMemo | undefined;
  profileFor(path: string): string | undefined;
  machineFor(path: string): string | null | undefined;
  remember(path: string, patch: Partial<Omit<FileMemo, 'at'>>): void;   // LRU 500; bookmarks ≤ 200
  forget(path: string): void;
}
// app/session.ts → export const session: SessionService
export interface SessionService { start(): Disposable; restore(): Promise<number /* documents opened */> }
// app/recovery.ts → export const recovery: RecoveryService
export interface RecoveryEntry { session: string; key: string; path: string | null; title: string; profileId: string;
  machineId?: string | null; encoding: FileEncoding; eol: Eol; nul: NulInfo; diskStamp: DiskStamp | null; savedAt: number; bytes: number;
  /** G8 M7: true when the sidecar was never written, so everything above it is Rust's
   *  stand-in (`recovery.rs::orphan_meta`) and the text is all there is. */
  metaLost?: boolean }
export interface RecoveryService {
  start(): Disposable; flushNow(): Promise<void>;
  leftovers(): Promise<RecoveryEntry[]>; restore(e: RecoveryEntry[]): Promise<DocId[]>; discard(session: string): Promise<void>;
}
// UiState (P1 §7.3) gains:  files: Record<string, FileMemo>
```

### 7.10 Tauri commands (all structs `camelCase`; TS wrappers in `platform/commands.ts`)

```rust
// M6 quit.rs
pub struct QuitGuard { dirty: AtomicBool }                     // Default: false
#[tauri::command] fn quit_guard_set_dirty(guard: State<QuitGuard>, dirty: bool);
pub fn install(app: &AppHandle);                               // macOS: adds applicationShouldTerminate:, re-sets the delegate, logs on failure; elsewhere no-op
pub fn decide(dirty: bool) -> u64;                             // NSTerminateNow = 1, NSTerminateCancel = 0

// M6 machines.rs, config.rs, paths.rs
pub const MACHINES_VERSION: u32 = 1;                           // must match MACHINES_VERSION in core/machines/types.ts
pub const MACHINES_FILE_NAME: &str = "machines.json";          // paths.rs; AppDirs::machines_file() = <config>/machines.json
// config.rs: ConfigLoad gains `machines: Value` (always an object; `{}` when missing or unusable) and `machines_error: Option<String>`
pub fn read_json_object_versioned(path: &Path, name: &str, version: u32) -> JsonFile;   // P1 read_json_object = (…, SETTINGS_VERSION)
pub fn save_json_object_versioned(path: &Path, name: &str, object: Map<String, Value>, current: &JsonFile, version: u32) -> Result<(), String>;
#[tauri::command] fn machines_save(app: AppHandle, machines: Value) -> Result<(), String>;
//   a JSON object ≤ 1 MiB; `$version` stamped; atomic; an unusable previous file kept as machines.json.bak; refused when the file on disk is newer
#[tauri::command] fn machines_open_file(app: AppHandle) -> Result<String, String>;     // creates `{"$version":1,"machines":[],"defaults":{}}` if missing; grants that one file

// M7 backup.rs, session.rs, recovery.rs
#[tauri::command] fn files_backup(app: AppHandle, path: String) -> Result<Option<String>, String>;
//   Err unless is_allowed; Ok(None) when files.backup = off or the file does not exist yet
#[tauri::command] fn session_save(app: AppHandle, paths: Vec<String>, active: Option<u32>) -> Result<(), String>;  // keeps is_allowed, ≤ 50
#[tauri::command] fn session_load(app: AppHandle) -> SessionState;   // { paths: Vec<String>, active: Option<u32> }
pub fn grant_on_startup(app: &AppHandle);
#[tauri::command] fn recovery_put(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String>;
//   raw body = UTF-8 text (≤ 64 MiB); header x-gedit-recovery = RecoveryMeta JSON (≤ 8 KiB) with the key ^[a-z0-9-]{1,64}$
#[tauri::command] fn recovery_drop(app: AppHandle, key: String) -> Result<(), String>;
#[tauri::command] fn recovery_clear_current(app: AppHandle) -> Result<(), String>;   // after the quit decision only
#[tauri::command] fn recovery_list(app: AppHandle) -> Vec<RecoveryEntry>;            // leftover sessions only
#[tauri::command] fn recovery_read(app: AppHandle, session: String, key: String) -> Result<tauri::ipc::Response, String>;  // raw bytes
#[tauri::command] fn recovery_discard(app: AppHandle, session: String) -> Result<(), String>;
pub fn start_session(app: &AppHandle);   // session folder (0700), heartbeat, pruning

// M12 channels.rs
pub struct SiblingInfo { name: String, exists: bool, bytes: u64, modified: Option<i64> }   // camelCase on the wire
#[tauri::command] fn channel_siblings(app: AppHandle, path: String, names: Vec<String>) -> Result<Vec<SiblingInfo>, String>;
//   Err unless fs_scope().is_allowed(path). `names` ≤ 32, each a plain file name (no separator, not `.`/`..`,
//   ≤ 255 chars) — a name that fails is answered with exists=false and reported, the call is not refused.
//   Each is resolved against the PARENT of `path` (standing rule 14). Metadata only: no content is read,
//   no directory is listed, nothing is granted. A sibling is opened only through the dialog (P1 F3).

// M13 userfiles.rs   (kind: "profiles" | "codes"; folder = <config>/<kind>)
#[tauri::command] fn user_files_list(app: AppHandle, kind: String) -> Result<Vec<UserFile>, String>;   // UserFile { name, text: Option<String>, error: Option<String> }
#[tauri::command] fn user_file_create(app: AppHandle, kind: String, name: String, text: String) -> Result<String, String>;  // JSON object; atomic; no overwrite; granted
#[tauri::command] fn user_file_path(app: AppHandle, kind: String, name: String) -> Result<String, String>;                // must exist; granted
#[tauri::command] fn user_file_import(app: AppHandle, kind: String, src: String) -> Result<String, String>;               // src must be is_allowed; never overwrites
#[tauri::command] fn user_file_delete(app: AppHandle, kind: String, name: String) -> Result<(), String>;
```

`lib.rs` keeps exactly one `tauri::Builder::default()` and one `generate_handler![` (P1 AD-15). Capabilities: unchanged in every milestone.

### 7.11 Settings keys and state (P7)

| Key | Type | Default | In the dialog |
|---|---|---|---|
| `files.backup` | `off` \| `sibling` \| `history` | `history` | Files |
| `files.backupCount` | int 1–50 | 5 | Files |
| `files.recovery` | bool | true | Files |
| `files.restoreSession` | bool | true | Files |
| `files.rememberPerFile` | bool | true | Files |

Rust reads `files.backup` and `files.backupCount` itself (P1 AD-8 pattern). `state.json` gains the Rust-owned `session` (`{ "paths": […], "active": 1 }`) and the webview-owned `ui.files` (with `machineId` per file); the P1 1 MiB cap stays. `ui.files` is bounded in **bytes** as well as in entries (`MAX_REMEMBERED_BYTES` = 384 KiB in `stores/fileMemory.ts`), because the entry count is no bound on the size of the file: Rust pretty-prints `state.json`, so 500 files x 200 bookmarks is 1.56 MiB, not the 200 KiB this row estimated before the G8 M7 fixes — and every writer of `state.json` fails together once it is over the cap. New folders: `<config>/profiles/`, `<config>/codes/`, `<data>/recovery/<session>/`, `<data>/backups/<fnv(dir)>/<name>/`.

No settings key holds machine data: machines, their defaults per profile and their version live in `<config>/machines.json` (§7.15, D50). `SETTINGS_VERSION` stays 1.

### 7.12 Test ids and harness additions

| `data-testid` | Element | Extra attributes | Since |
|---|---|---|---|
| `status-item` (P1) | status item | `data-item="machine"`, `data-machine-id` (empty for none), `data-choice=document\|default\|none`, `data-assumed` | M6 |
| `machine-row`, `machine-action` | Settings ▸ Machines | row `data-machine-id`, `data-profile-id`, `data-default`, `data-problems`; buttons `data-action=add\|edit\|duplicate\|remove\|default\|open-file\|replace-file`, `data-disabled` while the file could not be read (M13: `import\|export`) | M6 |
| `doc-tab` (P1) | tab | `data-readonly` | M7 |
| `status-item` (P1) | status item | `data-item="readonly"`, `data-reason` | M7 |
| `recovery-dialog`, `recovery-item` | restore dialog | `data-session`, `data-key`, `data-path`; buttons `data-action=restore\|discard\|later` | M7 |
| `compare-mode`, `compare-option`, `compare-copy`, `compare-export` | compare toolbar | `data-mode`, `data-option`, `aria-pressed`, `data-direction` | M11 |
| `status-item` (P1) | status item | `data-item="channel"`, `data-channel-id`, `data-channel-count`, `data-layout=single-file\|multi-file`, `data-missing` (the ids not found), `data-open` (the ids that are open) | M12 |
| `channel-row`, `channel-action` | Settings ▸ Machines ▸ Channels | row `data-channel-id`, `data-kind=channel\|sync`, `data-problems`; buttons `data-action=add\|edit\|remove\|up\|down\|test` | M12 |
| `program-map-item` (P1) | program map row | `data-kind` already carries the outline kind (now also `channel` and `sync`); a channel group row adds `data-channel-id` | M12 |
| `inspector-panel`, `inspector-row`, `inspector-state`, `inspector-edit` | inspector | `data-address`, `data-line`, `data-editable`; state `data-group`, `data-line`, `data-assumed` | Phase 3 |
| `cmd-button` (P1) | Insert tab | `data-command=insert.template:<id>` replaces `insert.block:<id>` | Phase 3 |
| `profile-row` | Settings ▸ Profiles | `data-profile-id`, `data-origin`, `data-problems` | M13 |

Harness commands added by the preludes: `h_config_read(name)` (P6; `settings.json`, `state.json` or `machines.json` only), `h_crash()` (`SIGKILL` to itself) and `h_recovery_dir()` (P7). `h.app.ctx` grows with `machines` (P6), `fileMemory`, `session`, `recovery` (P7), `channels` (P12) and `userConfig` (P13); `modal` comes with the Phase 3 prelude.

### 7.13 Command ids and default shortcuts (new)

| Keys | Command | WP |
|---|---|---|
| (none) | `file.setMachine` (the status item's click), `machines.manage`, `machines.openFile` | 6.10 |
| (none) | `machines.import`, `machines.export` | 13.3 |
| Mod+Shift+F | `search.findAll` | 11.1 |
| (none) | `search.replace`, `search.wholeAddressInFind` | 11.1 |
| Mod+Alt+Right / Mod+Alt+Left | `compare.copyToModified` / `compare.copyToOriginal` (only while a comparison is open) | 11.3 |
| (none) | `compare.exportDiff`, `compare.files`, `compare.toggleReview` | 11.3 |
| (none) | `nc.blockSkip.add`, `nc.blockSkip.remove` | 10.1 |
| Mod+F7 | `nav.selectToolSegment` | 10.1 |
| Alt+F7 / Shift+Alt+F7 | `channels.nextSyncPoint` / `channels.prevSyncPoint` (the marks of the channel at the cursor, wrapping) | 12.5 |
| Mod+Alt+P | `channels.gotoPartner` (the same sync id in the next channel that has it) | 12.5 |
| (none) | `channels.select` (the channel status item's click), `channels.assign` (tie an open document to a channel by hand, `multi-file` only), `channels.checkSync`, `channels.splitToDocuments` (`single-file` only), `channels.testOnDocument` | 12.5 |
| Mod+Alt+A | `view.toggleInspector` (the spec's key) | P3.2 (Phase 3) |
| (none) | `file.toggleReadOnly`, `recovery.showPending` | 7.3, 7.4 |
| (none) | `profile.newFrom`, `profile.open`, `profile.import`, `profile.export`, `profile.reload`, `profile.testOnDocument` | 13.3 |
| (none) | `edit.toggleForceUppercase` | 13.4 |
| (none) | `insert.template:<id>` | P3.5 (Phase 3) |

The registry's conflict check (P1 AD-4) and the AltGr rule (D21) apply; the `Mod+Alt` keys are on the Windows AltGr manual check (§13; `Mod+Alt+A` from Phase 3). `Alt+F7` was chosen over the nearer `Alt+F8` because Monaco binds `Alt+F8` and `Shift+Alt+F8` to marker navigation (`contrib/gotoError/browser/gotoError.js:178-202`), and `Mod+Alt+C` is already the comparison (`src/lib/contrib/compare.ts:133`).

### 7.14 Changes to Phase 1 contracts

| P1 contract | Change | M |
|---|---|---|
| §7.2 `DocMeta` | + `machineId?: string \| null` (M6); + `readOnly`, `readOnlyReason` (M7) | M6, M7 |
| §7.2 `FileOps` | + `restoreDocument` (with `machineId`), `setReadOnly`, `onWillClose` | M7 |
| §7.2 `ProfileInfo` | + `machineType`, `origin`, `parent`, `file`, `chain`, `hasMachineParams` | M6 |
| §7.2 `ProfileRegistry` | + `effective`, `detectVariants` (M6); + `revision`, `problems`, `reload` (M13); `profile()` returns the resolved profile | M6, M13 |
| §7.3 `CodeDbService` | serves resolved databases, + `byId` (M6); + `reload` (M13; templates, in Phase 3, come from the document's effective database, not from a profile id) | M6, M13 |
| §7.3 new `MachineService` (`stores/machines.ts`) | §7.15 | M6 |
| §7.5 `ScriptContextV2` | + `machine` (additive, `contract` stays 2); `profile` is the effective profile (resolved, machine applied), `codes` the effective database's entries | M6 |
| §7.5 `TransformContext` | + `machine: EffectiveMachine`; `cp` and `codes` are the effective ones | M6 |
| §7.5 `FieldType` | **unchanged**: no list type is added; the Machines page uses the existing types and a page-owned list control (F46) | – |
| §7.6 `ConfigLoad` | + `machines`, `machinesError` (the one startup round trip); `ConfigPaths` + `machinesFile` | M6 |
| §7.3 `CompareService` | + `mode`, `options`, `copyChange`, `exportDiff`, `openFiles` | M11 |
| §7.3 `BookmarkService` | + `set` | M7 |
| §7.3 `UiState` | + `files` | M7 |
| §7.4 `Profile`, `NumberingOptions` | §7.1 additions; `grammar` widened | M6, M8, M9, M11, M13 |
| §7.4 `CompiledProfile.re` | + `toolIgnore` (M6); + `assignment`, `labels`, `systemVariables`, `header` (M8) | M6, M8 |
| §7.4 `TokenKind` | + `label`, `call` (a `switch` without a default must handle them) | M8 |
| §7.4 `OutlineKind` | + `channel`, `sync` (it is a closed union, F59, and a `switch` without a default must handle them). They are produced by the **channel service**; `core/profiles/validate.ts` rejects them in a profile's own `outline` rules, so no profile can invent a channel row | M12 |
| §7.3 `OutlineService` | `items(id)` may return `channel` groups with the items of all of that channel's ranges as `children` and its blocking marks as `sync` rows, plus one "outside the channels" group (no signature change); + `toolLines(id, channelId?)`, while `toolLines(id)` keeps its P1 meaning and result. `OutlineIndex` itself is unchanged, so every committed outline golden stays as it is | M12 |
| §7.3 new `ChannelService` (`stores/channels.ts`) | §7.17 | M12 |
| §7.15 `MachineParams` | + `channels?: ChannelParams` (additive; `MACHINES_VERSION` stays 1, D59); `MachineParamsDecl` + `channels?` (presets only; no built-in declares one in Phase 2, §8.9) | M12 |
| §7.5 `ScriptContextV2` | + `channels` (additive, `contract` stays 2; absent for a document with no channels) | M12 |
| §7.2 `DialogService` | `openFiles` gains `defaultPath?: string`, so "Open the other channels…" starts in the document's own folder; the plugin already takes it (`saveFile` passes one today). **Owned:** the interface change by P12 (the one WP that edits `app/types.ts`), the one-line pass-through in `src/lib/app/dialogs.ts` by WP12.5, which also tests it | M12 |
| §7.9 `FileMemo` | + `channelId?: string \| null` (the user's own channel assignment for a `multi-file` document, AD-32); additive, an M7 build keeps it verbatim | M12 |
| §7.4 `CodeEntry`, `CodeParam`, `CodeDb` | + `sets` (with `diameter`), `CodeParam.unit` (M6), `fNotFeed` (M8), the R3 flags (M9), the R8 role (M10, proposed), `templates` (Phase 3); files may `extends`/`remove` | M6, M8, M9, M10, Phase 3 |
| §7.6 commands | + §7.10 (`channel_siblings` in M12); none removed | M6, M7, M12, M13 |
| §7.7 settings | + §7.11 (no machine keys); `config.rs` read/save helpers take the file's version (P1 behavior unchanged) | M6, M7 |
| §7.10 `gedit_nc` | + `ModalInterpreter` (with `diameter_reading`, AD-19 rule 11), `machine_type_of`, `incremental_axes`, `diameter_axes`, `speed_limit_of`, `machine_params`, `number_class_of`, `value_of`, `write_back`, `readings_of`, `resolve_value`, `WRITE_BACK_ERRORS`; `FeedModeTracker` reads feed modes and cycles from `sets` (same attribute values); implementation split into `_nc_lex.py`/`_nc_modal.py`/`_nc_machine.py` (import path unchanged) | M6 |
| §7.10 `gedit_nc` | + `channels`, `channel_of`, `channel_lines`, `sync_marks` from `_nc_channels.py` (import path unchanged); each answers an empty result for a context without the member, so an M5–M11 script is unaffected | M12 |
| D10 | closed on macOS (AD-20); Windows/Linux stay as documented (D28) | M6 |
| D13 | blocks JSON removed (with the templates) | Phase 3 |

### 7.15 Machine configurations (P6; WP6.8, WP6.9, WP6.10; AD-31)

**Types**, `src/lib/core/machines/types.ts`:

```ts
export const MACHINES_VERSION = 1;                     // must match machines.rs
export type NumberClass = 'length' | 'angle' | 'feedPerMin' | 'feedPerRev' | 'dwell';
/** How a numeric literal of a class is read (AD-31):
 *   'increment'  — with a decimal point mm/inch/deg/s as written, without one a count of least
 *                  input increments (Fanuc IS-B/IS-C with calculator-type input off);
 *   'calculator' — as written, with or without a point (Fanuc calculator-type input; the Okuma
 *                  1 mm and 1 inch unit systems, which are `scale` with a unit of 1);
 *   'scale'      — EVERY literal, with or without a point, times the class's unit: the Okuma 1 µm,
 *                  10 µm and 1/10000 inch unit systems, where X0.1 is 0.001 mm under 10 µm and
 *                  F23.456 is 0.23456 mm/rev (F52, OSP-P200L §2-3). */
export type NumberReading = 'increment' | 'calculator' | 'scale';
export interface NumberInput {
  /** For `length` words and every class without an entry in `classes`. */
  mode: NumberReading;
  /** The increment ('increment') or the value of "1" ('scale') for a length in a metric program,
   *  decimal text: '0.001' (IS-B), '0.0001' (IS-C), '0.01' (Okuma 10 µm), '1'. */
  incrementMm: string;
  /** The same in an inch program. Absent: a tenth of `incrementMm` (IS-B 0.0001 in, IS-C 0.00001 in). */
  incrementInch?: string;
  /** Angle words, in degrees, in metric AND inch programs (the `angle` class ignores `units`).
   *  Absent: the digits of `incrementMm`, so IS-B reads C90000 as 90° in both. */
  incrementDeg?: string;
  /** Dwell words, in seconds, in metric and inch programs alike. Absent: the digits of `incrementMm`. */
  incrementSec?: string;
  /** Where the control reads a class differently (Okuma's unit table; Fanuc feeds and dwell).
   *  `increment` is millimetres for `length` and the feed classes in a metric program, degrees for
   *  `angle`, seconds for `dwell`; `incrementInch` only on a class that follows `units`. */
  classes?: Partial<Record<NumberClass, { mode?: NumberReading; increment?: string; incrementInch?: string }>>;
}
export interface MachineParams {
  numberInput: NumberInput | null;       // null: the profile declares no numberInput (read as its JSON says)
  units: 'mm' | 'inch';
  diameter: 'on' | 'off' | null;         // null: not a lathe parameter of this profile
  variants: Record<string, string>;      // variant id → choice value: { gcodeSystem: 'B' }
  modalInitial: Record<string, string>;  // modal group → canonical code, over the profile's modal.initial
  /** M12, AD-32. The only machine parameter that carries the user's own patterns (§7.17).
   *  Absent or `layout: 'none'`: this machine has no channels and nothing in the UI changes. */
  channels?: ChannelParams;
}
export type ParamSource = 'machine' | 'detected' | 'profile';
export interface EffectiveMachine {
  id: string | null; name: string | null;
  /** Why: 'document' = chosen for this document or remembered for its file (`id` null = an explicit "none");
   *  'default' = the profile's default machine; 'none' = nothing chosen and no default. */
  choice: 'document' | 'default' | 'none';
  params: MachineParams;                 // always complete
  source: { numberInput: ParamSource; units: ParamSource; diameter: ParamSource;
            variants: Record<string, ParamSource>; modalInitial: Record<string, ParamSource> };
  /** Profile id + canonical JSON of `params`; the cache key of the effective profile. */
  key: string;
  /** Variant detection disagrees with the machine by a margin ≥ 3 (shown once per open). */
  mismatch: { variant: string; detected: string; chosen: string } | null;
}
export interface EffectiveProfile { profile: Profile; cp: CompiledProfile; codes: CodeDb; machine: EffectiveMachine }
/** One machine configuration, as stored. */
export interface MachineConfig {
  id: string;                            // ^[a-z0-9][a-z0-9-]{0,63}$, stable (per-file memory refers to it)
  name: string;                          // 1–64 characters, unique ignoring case
  profile: string;                       // base profile id
  /** Only what the user set; everything else (and every variant or modal group left out) follows the profile's defaults. */
  params: Partial<MachineParams>;
  notes?: string;                        // ≤ 500 characters
}
export interface MachinesFile {
  $version: 1;
  machines: MachineConfig[];             // ≤ 100
  /** Base profile id → the default machine for documents of that profile. */
  defaults: Record<string, string>;
}
```

**Pure functions**, `src/lib/core/machines/effective.ts` (implemented by P6, owned by WP6.8):

```ts
export function defaultParams(p: Profile): MachineParams;                   // the declaration's defaults; the P1 JSON for a profile without machineParams
export function effectiveMachine(p: Profile, m: MachineConfig | null, choice: EffectiveMachine['choice'],
  detected: Record<string, { value: string; margin: number }>): EffectiveMachine;   // source per parameter: machine → detected (only if m is null) → profile
export function applyMachine(p: Profile, eff: EffectiveMachine): { profile: Profile; codes: string };  // overlays, decimalPointSignificant, modal.*, codes (AD-31)
export function effectiveKey(profileId: string, params: MachineParams): string;
export function compatible(m: MachineConfig, chain: readonly string[]): boolean;   // chain = ProfileInfo.chain of the document's profile
```

**Numbers**, `src/lib/core/machines/numbers.ts` (WP6.9; Python twins in `_nc_machine.py`, one golden set `tests/fixtures/machines/numbers.json`):

```ts
export function numberClassOf(address: string, o: { profile: Profile; feedUnit: FeedUnit; blockCodes: readonly CodeEntry[];
    pitchFeed: boolean /* this block, or the active cycle, carries a pitch feed */ }):
  NumberClass | 'increment' | 'count' | null;          // null: no class (S, T, D, H, N, O, G, M) or undecidable (feed unit unknown)
  // The order is fixed (AD-31): CodeParam.unit → dwell in an fNotFeed block → F/E under a pitch feed →
  // addresses.angular → the feed word by modal unit → axes, arc centres, R, depths → null.
export function valueOf(lit: NumericLiteral, cls: NumberClass | 'increment', m: MachineParams, units: 'mm' | 'inch'): string | null;
  // decimal text in mm/inch/deg/s, by the class's reading: 'increment' — with a point as written, without it
  // digits × increment; 'calculator' — as written; 'scale' — literal × unit, with or without a point.
export function writeBack(value: string, original: NumericLiteral, cls: NumberClass | 'increment', m: MachineParams,
  units: 'mm' | 'inch', fmt: NumberFormatOptions, o?: { refuseRounding?: boolean }):
  { text: string; rounded: boolean } | { error: Msg };  // the word's own form; a point stays, and a point-less
  // word stays point-less only while the result is a whole number of increments (or units, in 'scale')
export interface Reading { preset: string; label: string; value: string | null }
export function readingsOf(lit: NumericLiteral, cls: NumberClass | 'increment', decl: MachineParamsDecl | undefined,
  units: 'mm' | 'inch'): Reading[];                     // one per declared preset, the default first
/** What a consumer asks. With `source.numberInput === 'machine'` the machine's reading; otherwise a value only
 *  when every declared preset agrees, and else the readings to show (AD-31 "No machine, no guess"). */
export function resolveValue(lit: NumericLiteral, cls: NumberClass | 'increment' | 'count' | null,
  eff: EffectiveMachine, decl: MachineParamsDecl | undefined, units: 'mm' | 'inch'):
  { value: string | null; readings: Reading[] /* empty when the value is settled or the word has no class */ };
```

**Service**, `app/types.ts` → `stores/machines.ts` exports `machines: MachineService` (P6 stub; WP6.8; WP7.5 adds persistence; WP13.3 import/export):

```ts
export interface MachineProblem { machineId: string | null; path: string /* JSON path in machines.json */; message: string }
export interface MachineService {
  readonly list: Readable<MachineConfig[]>;             // valid records, by name
  readonly revision: Readable<number>;                  // bumps on every change of the set or of a document's choice
  load(c: ConfigLoad): void;                            // bootstrap, after settings; never throws; problems() then says why
  /** Reads `machines.json` again (a fresh `configLoad`), re-evaluates every open document and bumps
   *  `revision`; never throws. Called when the user saves the machines document (`contrib/machineSelect.ts`
   *  hooks `files.onDidSave`, as `contrib/settings.ts` does for settings.json), so a hand edit is never
   *  overwritten by the next page action. */
  reloadFromDisk(): Promise<void>;
  isMachinesDocument(id: DocId): boolean;               // docs.byPath(ConfigPaths.machinesFile)
  problems(): MachineProblem[];                         // invalid records (kept in the file), a broken or newer file
  /** True while the file itself could not be read: every write below is refused, and the Machines page
   *  offers only `openFile` and `replaceWithEmpty` (AD-31 Management). */
  blocked(): boolean;
  replaceWithEmpty(): Promise<void>;                    // the one path that moves an unusable file to machines.json.bak
  get(id: string): MachineConfig | undefined;
  compatibleWith(profileId: string): MachineConfig[];   // base profile in the profile's chain
  defaultFor(profileId: string): string | null;
  add(m: Omit<MachineConfig, 'id'>): Promise<string>;   // id from the name (slug, suffix on collision); saved at once
  update(id: string, patch: Partial<Omit<MachineConfig, 'id'>>): Promise<void>;
  duplicate(id: string, name: string): Promise<string>;
  remove(id: string): Promise<void>;                    // documents using it are re-evaluated (one status message)
  setDefault(profileId: string, id: string | null): Promise<void>;
  openFile(): Promise<void>;                            // machinesOpenFile, then opens it as a document
  /** The document's effective view (AD-31 order); always an answer, the profile defaults at worst. */
  effective(docId: DocId): EffectiveProfile;
  /** An explicit choice: an id, null = "none (profile defaults)", undefined = follow the profile's default machine. */
  setForDoc(docId: DocId, id: string | null | undefined): void;
}
```

`DocMeta` (P1 §7.2) gains `machineId?: string | null` with the same three meanings; `stores/machines.ts` writes it, and from M7 `fileMemory` persists it (§7.9).

**How the effective parameters reach each consumer** (all through `machines.effective(docId)`, never by reading `machines.json` or a machine directly):

| Consumer | Receives | Since |
|---|---|---|
| TS transforms (`app/transforms.ts`) | `TransformContext.cp` and `.codes` from the effective view; `TransformContext` (P1 §7.5) gains `machine: EffectiveMachine`, so a transform that computes with values calls `resolveValue`/`writeBack` | M6 (P6) |
| Scripts (`app/scripts.ts` → `buildContext`) | `profile` = effective profile, `codes` = effective database entries, `machine` = §7.15 script member | M6 (P6) |
| Outline, block navigation, program map | the effective `cp`; the outline index is rebuilt when `machine.key` changes | M6 (P6) |
| Hover, completion (`docIdOf(model)`) | the effective `cp`, `codes` and `machine` | M6 (P6); modal context Phase 3 |
| Python modal interpreter | the effective profile inside the context (`modal.initial`, `modal.units`, `modal.diameter`, `modal.sources`) | M6 (WP6.4) |
| TS modal interpreter, `ModalService` | the effective `cp` and `codes`; rebuilt on a key change | Phase 3 |
| Compare (review mode) | each side's own effective `cp` | M11 |
| Inspector, address arithmetic, program checks, extents | the effective view plus `numbers.ts` / `_nc_machine.py` | M10; the inspector Phase 3 |
| Search | the effective `cp` for tokenizing; values compared as written (D51) | M11 |
| Channels (`stores/channels.ts`, §7.17) | `machines.effective(docId).machine.params.channels`; nothing else reads a machine's channel block | M12 |

**File** `<config>/machines.json` (Rust-owned; read in `config_load`, written by `machines_save`; the whole object each time, stable member order):

```json
{
  "$version": 1,
  "machines": [
    { "id": "lathe-2", "name": "Lathe 2", "profile": "fanuc-lathe",
      "params": { "numberInput": { "mode": "increment", "incrementMm": "0.001", "incrementSec": "0.001",
                                   "classes": { "feedPerMin": { "mode": "calculator" }, "feedPerRev": { "mode": "calculator" } } },
                  "variants": { "gcodeSystem": "B" }, "modalInitial": { "feedmode": "G95" } } },
    { "id": "twin-31i", "name": "Twin 31i", "profile": "fanuc-lathe",
      "params": { "variants": { "gcodeSystem": "B" },
                  "channels": {
                    "layout": "single-file",
                    "list": [{ "id": "1", "name": "Upper turret", "aliases": ["G13", "CH1"] },
                             { "id": "2", "name": "Lower turret", "aliases": ["G14", "CH2"] }],
                    "sectionStart": "^\\s*O\\d+\\s*\\(\\s*CHANNEL\\s*(?<channel>\\d+)",
                    "syncMarks": [
                      { "id": "wait", "label": "Wait", "semantics": "rendezvous",
                        "match": { "kind": "prefix", "prefix": "M1", "idDigits": { "min": 2, "max": 2 } },
                        "partners": { "kind": "all" }, "blocking": true }
                    ] } } }
  ],
  "defaults": { "fanuc-lathe": "lathe-2" }
}
```

The `channels` block is the user's own (AD-32, §7.17): the patterns above are an **example**, not a fact about any machine, and no built-in profile ships one (§8.9).

Rules: a machine stores the **full** `NumberInput` of the preset it was given (a later change of the profile's preset data never changes a machine under the user's hands; the dialog shows "Custom" when no preset matches); a record that fails validation is kept verbatim and reported; unknown members at any level are kept; `defaults` naming a missing or incompatible machine is ignored; a `$version` above `MACHINES_VERSION` is read and never written. A `channels` block whose patterns do not compile, or that leaves the P1 AD-11 subset (standing rule 15), invalidates **the block, not the record**: the block is kept verbatim and written back byte-stable, the problem is listed with its JSON path on the Machines page and in the channel status item ("the channel rules of this machine are broken"), the document resolves to `layout: 'none'` — and the machine stays selectable, with its number input, its variants, its units and its power-on state unchanged. A pattern is never compiled outside the channel code, so nothing else can be affected by it. The scope matters: the whole-record rule would make one mistyped character in a channel pattern change how every number in every program of that machine is read (AD-31, D57 — a point-less `X50` would get no value at all), which is a data-correctness change hidden behind an experiment in the Channels tester. Whole-record invalidation is kept for the parameters that decide the number reading, the variant and the power-on state.

**Dialog fields**, `src/lib/core/machines/fields.ts` (WP6.10): `machineFields(decl: MachineParamsDecl, codes: CodeDb, current?: MachineConfig): FieldSpec[]`: `name` (`text`, required), `numberInput` ("How the control reads numbers": `choice` over the preset ids, plus `custom` when the stored value matches none), `units` (`choice` mm/inch), `diameter` (`bool`), one `choice` per variant, one `choice` per offered modal group (the group's codes plus `''` = profile default), `notes` (`text`). Only existing `FieldType`s (F46). From M12 the form has a **Channels step** that the page owns (a list control like `scripts.folders`, F46) and whose per-rule form comes from `channelFields` (§7.17) — again only existing `FieldType`s.

**Script context** (`core/scripting/types.ts`, P6; filled by `buildContext` from `BuildContextInput.machine: EffectiveMachine`):

```ts
export interface ScriptContextV2 {
  // … P1 members; `contract` stays 2 …
  /** P6. The document's effective machine; `profile` above is the effective profile, `codes` the effective database. */
  machine: { id: string | null; name: string | null; choice: 'document' | 'default' | 'none';
             params: MachineParams; source: EffectiveMachine['source'] };
}
```

**Python** (`_nc_machine.py`, re-exported by `gedit_nc`; standard library only, Python 3.9 syntax; `Decimal` arithmetic):

```python
def machine_params(ctx: dict) -> dict: ...
    # ctx["machine"] when present; otherwise the defaults derived from ctx["profile"]["machineParams"]
    # (or the profile's own syntax for a profile without them), with every source "profile" and choice "none".
def number_class_of(address: str, profile: dict, feed_unit: str, block_codes: "Sequence[dict]",
                    pitch_feed: bool = False) -> "Optional[str]": ...
    # the fixed order of AD-31, first match wins
def value_of(literal: "NumericLiteral", number_class: str, machine: dict, units: str) -> "Optional[str]": ...
def write_back(value: str, original: "NumericLiteral", number_class: str, machine: dict, units: str,
               fmt: dict, refuse_rounding: bool = False) -> "Tuple[Optional[str], bool, Optional[str]]": ...
    # (text, rounded, error): text in the word's own form, or None with the reason
def readings_of(literal: "NumericLiteral", number_class: str, profile: dict, units: str) -> "List[dict]": ...
    # one {"preset", "label", "value"} per declared preset, the default first
def resolve_value(literal: "NumericLiteral", number_class: "Optional[str]", ctx_machine: dict, profile: dict,
                  units: str) -> "Tuple[Optional[str], List[dict]]": ...
    # (value, readings): with source "machine" the machine's reading; otherwise a value only when every
    # declared preset agrees, else None and the readings to report (AD-31 "No machine, no guess")
```

A user script that wants to respect the machine calls `machine_params(load_context())` and uses `resolve_value`/`write_back` for any value it compares or computes (`resolve_value` returns no value where the reading depends on a machine nobody chose, so the script reports instead of guessing); a script that only scales can keep P1's `format_number`, because the effective `syntax.decimalPointSignificant` already follows the machine.

### 7.16 Where Phase 2 deviated from these contracts

Filled at each milestone from the hand-off notes, in the P1 §7.12 format. Every entry is
**additive or a narrowing**; no §7 signature was replaced.

| # | Contract | What was done instead | Why | M |
|---|---|---|---|---|
| 1 | §7.15 `effectiveKey(profileId, params)` | A third, optional parameter: `effectiveKey(profileId, params, source?)`. `EffectiveMachine.key` is built with it, so it holds the provenance as well as the parameters. A call without it is the key §7.15 describes | The profile the key caches carries `modal.sources`, which `applyMachine` derives from `EffectiveMachine.source` and from nothing else. Two documents can agree on every parameter and disagree about where those parameters came from — one where `gcodeSystem: 'B'` was **detected** in the program, one where a machine states it — and they shared one compiled profile, so the second was told the first one's sources for every value it has to assume. That is the one guarantee `core/machines/effective.ts` exists for (G8 M6) | M6 |
| 2 | §7.15 `numberInput.incrementMm` | On a preset whose `mode` is `calculator`, it is read as the control's **least input increment** — the unit of a `CodeParam.unit: "increment"` word — and no longer as an unused member. The shipped `calculator` preset therefore declares `0.001` and not `1` | §7.15 defines the field for `increment` (the increment) and `scale` (the value of "1") and leaves it undefined for `calculator`. Without a reading there, every micron cycle parameter of a turning program — `G83 Q`, `G74`/`G75 P`/`Q`, `G76 Q` — had no value at all on the lathe's own default preset, which is most of the lathe data M6 added. syntax-fanuc.md §3.2 describes one control on which `X50` is 50 mm **and** `Q6000` is 6 mm, so "as written" is a statement about positions; the G10 review of M6 decided it this way | M6 |
| 3 | §7.15 `MachineService.list` ("valid records, by name") | `list` still publishes every record the file gave, broken ones included; `contrib/machineSelect.ts` filters on usability where it offers a machine | The Machines page has to show a broken record to offer fixing it, which is what AD-31 Management asks for. The contract's real requirement — "never silently selectable" — is now kept at the two places that select: `compatibleWith` (which always filtered) and the "Other machines…" picker, which did not (G8 M6). A separate `all()` for the page, with `list` valid-only, is the alternative; it is a §7.15 change and belongs to M12 [now M13], which adds import | M6 |
| 4 | §7.9 `FileOps.restoreDocument(o): DocId` | The signature is unchanged and still answers a `DocId` synchronously, but the document is created **unbound** and binds to `o.path` one `files_stat` later | "May this app touch that path?" is a round trip, and a synchronous call cannot make it. Unbound is the safe end of the decision: an unbound document reaches the disk only through Save As, where the user picks the file. A caller that needs the path must poll it rather than read it in the same turn (WP7.3) | M7 |
| 5 | §7.2 `DocMeta` | + `proposedPath?: string \| null`, set only by `restoreDocument`, cleared by a successful write | AD-21 asks for "an untitled document named after the file" and `DocMeta` had no way to say it. It is **only a name**: `byPath` ignores it, so no save, stat, reload or poll can reach the file through it; `saveAsOutcome` uses it as the native dialog's `defaultPath`, the one place the original path may matter, and the user confirms it there (WP7.3) | M7 |
| 6 | §7.9 `FileMemoryStore.remember(path, patch)` | A member **present in `patch` with the value `undefined` deletes** that member of the memo | It is the only way to record "follow the profile's default machine" again: `docs.update` cannot put `DocMeta.machineId` back to `undefined`, and AD-31's three states (id / `null` / absent) have to survive a round trip through the memo. The signature is unchanged; the rule is now on the interface (WP7.5, M7 integration) | M7 |
| 7 | §7.9 `RecoveryService` | + `restoreDecided` / `markRestoreDecided` / `claimRestoreDecision` / `awaitRestoreDecision` in `app/recovery.ts` (module exports, not members of the service) | AD-21 puts the restore dialog before session restore, and the two live in different contributions that must not await a human inside `activate()`. `contrib/recovery.ts` claims the decision synchronously and settles it in a `finally`; `contrib/session.ts` waits. The claim is what keeps it from becoming a deadlock: commands are registered **before** `activate()` and a duplicate id throws there, so a bare wait would let one typo in a future feature silently cost every user their tabs (WP7.4, M7 integration) | M7 |
| 8 | §5 WP7.4 "the restore dialog after the first render" | One further look at the leftover list 150 s after start, if nobody has been asked yet | AD-21's liveness rule is a timestamp: a session is a leftover only once its `alive` file is 120 s old, because anything fresher cannot be told from a gEdit that is merely slow. Restarting **right after** a crash is the normal case, and a single startup list then answers nothing. The re-check asks only when no list has been shown in this run, so "Later" stays later (M7 integration; WP7.2's preferred option of the three it handed over) | M7 |
| 9 | §5 M7 H7 (the scenario list) | Two scenarios the list does not name: `m7-perf-save` and `m7-perf-session` | §5 M7 "Gates" asks G7 for three budgets, and the H7 list carries a scenario for one of them — `m7-perf-recovery` measures the snapshot, and nothing measured the save with a backup or the ten-tab restore. Both of those bound a mechanism that is **on by default**, so a budget missed there ends with the programmer switching the mechanism off and the milestone protecting nobody. Measuring them once at integration and leaving nothing behind would have made the same omission the next time the numbers moved (M7 integration; `m7-save-fail` is H7's own additive scenario for the same reason) | M7 |
| 10 | §7.1 `syntax` (AD-24) | + `names?: Pattern`, a seventh opt-in field (Sinumerik `[A-Z_]{2}[A-Z0-9_]*`, Okuma `[A-Z]{2}[A-Z0-9]*`). Where it matches at a word start, after every other rule and before the one-letter words, the match is **one `unknown` token**; a keyword is a keyword only where the name at its position is no longer than it (`LOOP_A` is a name, `LOOP` a keyword); a name ends an operand like a variable. `compile.ts` compiles it as `re.names`; `_nc_lex.py` mirrors it with the other AD-24 fields (WP8.6) | With the six AD-24 fields a name the program gives itself was still read one letter at a time. `XNOW` came out as four words and hovered as "X axis" and "Tool", `PASS2` carried an S word of 2 and `LOOP_N2` a keyword `LOOP` and an `N2` block-number reference that a renumber would rewrite, and "insert spaces" turned `IF XNOW<=XBOT` into `IF X N O W<=X B O T` — on Okuma the same happened to `DIA1` and `SIN[`. Both manuals start a name with two letters (or underscores), which is the rule the field states. WP8.1 named the gap and the fix (a new `syntax` field) and left it to integration because the M8 `syntax` sections were pinned; I8 applies syntax hand-off notes (M8 integration) | M8 |
| 11 | P1 §7.4 `syntax.blockSkip.levels` | A level digit may be `0`: `/0` is one skip mark, like `/1` … `/9` | syntax-sinumerik §3.1 writes `/0`–`/9`, `/0` meaning what `/` means. Read as `/` plus a value, the block number behind it was no block number, so a renumber would have written a second one in front of the block. No Fanuc fixture or golden has a `/0`; the grammar of WP8.4 already reads it as one mark (M8 integration) | M8 |
| 12 | P1 §7.3 `CodeService.lookupWord` | Also answers for a `call` token, by its identifier, as for a keyword; an assignment word whose address carries a numeric extension (`M3=3`, `S3=2400`, `T1=4`) is looked up as the letter plus the value (`M3`) and as the bare letter's address, and hover writes it with its `=` | `M3=3` was looked up as a code `M33` and `S3=2400` shown as `S32400`, which is a wrong meaning; `CYCLE83(…)` and `MSG("…")` had no hover at all, because `hoverText` had no case for the new kind (I8: every switch over `TokenKind` handles `label` and `call`; a label stays silent) (M8 integration) | M8 |
| 13 | AD-24 "labels color as `blockNumber`" | Both grammars color a label — an Okuma sequence name, a Sinumerik `NAME:` — with the `section` role, and the program name behind Okuma `CALL`/`MODIN` with `programMarker` | P8's hand-off asked for it: a sequence name must not look like the block number a renumber rewrites, and `section` is already bold in both themes, so no role, color or WCAG pair is added (WP8.2, WP8.4) | M8 |
| 14 | §5 M8 H8 (the scenario list) | One scenario the list does not name: `m8-okuma-units` | The list asks only that the machine item offers the three Okuma unit systems. A unit system scales every number, a decimal point included, so the wrong one is off by a factor of 1,000 between 1 mm and 1 µm; the scenario proves end to end that the pick reaches every number the scripts see, that with no machine every Okuma feed limit is skipped and reported, and that a 1 µm machine made on the Machines page stores exactly the unit table the Python golden runs with (H8; `m7-perf-save` in #9 is the precedent) | M8 |
| 15 | AD-19 rules 1–6 | Three readings for the token forms M8 added, pinned by the Okuma and Sinumerik modal goldens, which the TS interpreter of M11 [now Phase 3, P3.1] must pass unchanged. **A `call` is the code of its identifier**: `CYCLE84(…)` starts its cycle like a `G84` (what `pitchFeed` on a call means is #22). **A word written with `=` is a value and never a code**: `M3=3` is neither `M33` nor the `M3` of the spindle the state follows, and `S3=`, `SB=`, `T1=` and `F=R1` are not the speed, tool or feed in force — except that a word of `addresses.speedLimitWords` (`LIMS=`) is a clamp wherever it stands. **Rule 6 extends to `S`**: in an `fNotFeed` block the `S` counts revolutions (Sinumerik `G4 S2`), so it is neither the speed nor a clamp | Without the first the Sinumerik cycles were invisible to the modal state; without the second `M3=3` would have switched the followed spindle and a script would have scaled another spindle's speed; without the third scale speed would have changed a dwell. None names a dialect: all three come from the token kinds, the database and the profile (WP8.7) | M8 |
| 16 | P1 §7.10 `FeedModeTracker`; §7.4 `ModalInterpreter` (Python) | + `FeedModeTracker.f_not_feed` and `f_not_feed_code`, + `ModalInterpreter.f_not_feed_code`: whether the block just applied is a dwell, and by which code. Additive; every P1 attribute keeps its value, so an M5 script is unaffected | A script that scales feeds or speeds has to leave both words of a dwell alone, and `FeedModeTracker` is the P1 view user scripts are written against; the README of the bundled scripts documents both (WP8.7) | M8 |
| 17 | §7.5 `call`, §7.1 `syntax.calls` ("an identifier written directly in front of `(`") | A name of `syntax.names` may stand apart from its bracket by blanks and is the same call (`CYCLE840 (…)`, `MSG ("…")`); a word of one letter and a number (`L10(1)`) still needs its bracket touching it. Both tokenizers, the Sinumerik grammar and the subprogram-call rule of the Sinumerik program map read it alike | The control reads both spellings the same, and the grammar and the detection rules already did: a tapping cycle written with a blank was painted as a call but reached no script, so scale feed changed its `F` without a word. Blanks after any identifier would have turned `M30 (END)` and `F200 (FEED)` into calls (G8 M8, fix-code) | M8 |
| 18 | §7.1 `syntax.assignment` | The address is the whole identifier (letters, digits, `_`) in front of the `=`. The pattern is only tried at the start of an identifier with an `=` (not `==`) behind it, and its match must be that identifier | Tried at every letter of a packed run, the pattern read to the end of the run each time: 32k characters took 3 s in the editor and a script took 9 s for 16k. No built-in reading changed (fuzz corpus of 47k lines per profile) (G8 M8, fix-code) | M8 |
| 19 | P1 §7.10 `to_py_regex` ("`(?<name>` → `(?P<name>`") | Also spells `\s`, `\S` (in and out of a class) and `.` out as the characters ECMAScript means | Under `re.ASCII` Python's `\s` misses the no-break space: `S3<NBSP>=2500` was spindle 3 to the editor and the main spindle's `S3` to a script, which scaled it to `S2` (G8 M8, fix-code) | M8 |
| 20 | §7.15 `machineFields(decl, codes, current?)`, `machineSummaryLines`, `machineTooltip` | A trailing optional `diameterWords` (the profile's `addresses.diameter`) that the diameter label names: "X and U are diameters at power-on" on the Fanuc lathe, "X is a diameter at power-on" on Okuma and Sinumerik | The label claimed that `U` is a diameter on Okuma, where it is a finish allowance, and on Sinumerik (G8 M8, fix-code) | M8 |
| 21 | §7.1 (validation) | `validate.ts` refuses a `syntax.labels` without `(?<name>…)`, and a `syntax.variables` or `syntax.systemVariables` pattern that can match the empty string at a position of its probe lines. Both tokenizers also read an empty variable match as no match. A narrowing | A label pattern without the group validated and read no labels at all; an empty variable match left both tokenizers where they were, forever, once M12 [now M13] loads user profiles. The probe is a sample, not a proof, and the tokenizers are safe without it (G8 M8, fix-code) | M8 |
| 22 | §7.2 `pitchFeed` ("the `F` of this block is a pitch"), §7.16 #15 | On a code written as a call, `pitchFeed` means the call may take its lead from the feed **in force**. Scale feed leaves the numeric `F` in force when such a call runs as written, wherever it was written, and every `F` written while `MCALL` repeats it, and reports each. Among the calls only `CYCLE840` carries it | A Siemens call stands in a block of its own (manual §3.2.3.1), so the flag on a call could never protect any `F`; with ENC = 1 `CYCLE840` cuts with the programmed feed, which is then the speed times the pitch (G10 M8 NC finding 3, fix-sinumerik). Argument 9 is not read: every `CYCLE840` protects its feed, and a plain feed there costs one edit by hand | M8 |
| 23 | §8.5 table (`CYCLE84`, `CYCLE97`, `CYCLE99` with `pitchFeed`) | Flag removed from the three | They take the lead from their own arguments (manual §3.25.1.24, §3.25.1.30); the flag made the feed around them unscalable (fix-sinumerik) | M8 |
| 24 | §8.8 `sinumerik` `modalGroups` with `spindlemode` | `feedmode`, `plane`, `distance`; `G93`–`G97`, `G961`/`G962`, `G971`–`G973` and `G942`/`G952` are one group, and each code sets both the feed unit and the speed unit | On this control the feed type and constant cutting speed are one G group (manual §4.3.15): `G96` switches feed per revolution on and `G94`/`G95` end it. A machine stored with `modalInitial.spindlemode` now gets one validation problem and that value is ignored (G10 M8 NC finding 6, fix-sinumerik) | M8 |
| 25 | D54, §8.8 `sinumerik` presets (`calculator` plus `is-b`, `is-c`) | Only `calculator`, not marked for verification; `X50` has its value with no machine | The manual settles the reading for Siemens mode (§2.15.6); the increment readings belong to ISO dialect mode, which the profile excludes. A machine stored with `is-b` or `is-c` rules keeps them and shows as "Custom". **Needs the owner**: D54 names the three (G10 M8 NC finding 11, fix-sinumerik) | M8 |
| 26 | Bundled script header of `scale_speed.py` | New bool parameter `otherSpindles` ("Also scale other spindles", off by default) | Speeds for other spindles (`S3=`, `S[n]=`, a plain `S` after `SETMS(n)`) are left as written and reported unless the user asks: the script cannot know which spindle number is the machine's main spindle (G10 M8 NC findings 8 and 12, fix-sinumerik) | M8 |
| 27 | §7.1 `syntax` (AD-24); P1 §7.10 `FeedModeTracker.update(tokens)`, `prime_tracker(tracker, lines, cp)`; §7.4 `ModalInterpreter.update` | + `syntax.continuationStart?: Pattern`, anchored with `^` (Okuma `^[ \t]*\$(?=[ \t]\|$)`): a line whose start matches it belongs to the block above. It tokenizes as before. + `gedit_nc.continues_block(line, cp)`; + `continued` on `FeedModeTracker.update` (default `False`, the P1 reading) and on `ModalInterpreter.update` (default: the interpreter asks its own profile); + an optional `first` on `prime_tracker`, the first selected line, so a selection that starts on a `$` line starts inside the block above. The three bundled scripts pass both. M11's interpreter [now Phase 3] and M9's checks [now M10] read such a line the same way (the Okuma modal test pins it). Additive | OSP writes the rest of a long block on `$` lines, and the lead of a `G71` thread cycle stands there as often as not: scale feed read `$ H2.45 L2 F2` as a block of its own and scaled the lead to `F1.60` without a word (G10 M8 NC finding 9; fix-okuma's spec golden, now `scale_feed/okuma-continued-block` and its selection twin). The tracker is built from the database alone and cannot see the profile's marker, which is why it is told (M8 integration) | M8 |
| 28 | P1 §7.6 `files_stat` | `async` (runs off the main thread); at most 256 paths per call; each path stat'd on its own thread within one 1.5 s budget; `FileStat` gains `unavailable: bool` (every other field empty, `allowed` included). The TS wrapper takes `{ partial }` and rejects when every entry is unavailable; `fileOps.statOne` maps `unavailable` to "no answer" itself. `RecentEntry.exists` is `true` for an entry whose check timed out; the startup grants (recent list and session) take at most 750 ms together per list and grant nothing that did not answer | A hung SMB or DNC share blocked the UI (a plain `fn` command runs on the main thread) and the window at start. Unknown is never gone: a caller decides nothing from an unavailable stat (TODO Next up 8) | Next up |
| 29 | AD-22, §7.10 `session_save` ("keeps `is_allowed` paths"), F38 | `session_save` also keeps a path the scope refuses when the stored list already held it; `state.json` → `session` gains an optional `missing: { "<path>": { since, starts } }` that only Rust reads (never sent by `session_load`). Startup grants only stored paths that are **files**, counts a start against every other one, and drops a path missing at 5 starts in a row over at least 14 days | A share mounted after login or a USB stick that was out lost its file from the session at the first tab change (TODO Next up 9). Keeping a path is not granting it, and a path still enters the list only while it is allowed | Next up |
| 30 | AD-23 | Writers that go around the editor's `readOnly` refuse a locked document through `app/readOnlyLock.ts` (`lockRefusal`): transforms that replace text (checked again right before the write), `output = "replace"` scripts (a result that arrives after the lock goes to the "Open in new tab" dialog), Insert block, and the editable side of Compare (`createDiff` follows the lock). `applyLines` is the backstop and refuses a locked model. Reload from disk is not an edit and stays allowed. `file.setEol` refuses a locked document too (the line endings are text; the encoding is not) | "Neither lock stops the NC tab or a script" let a transform or a replace script change a program the user had locked, and Compare's editable side ignored the lock (TODO Next up 6) | Next up |
| 31 | P1 §7.1 `numbering` (no hard-limit field) | A profile whose `numbering.max` comes with `onOverflow: 'stop'` has that max as a hard limit: the Renumber form caps Digits at its width, caps and requires Maximum, and caps Start; a run without the form is clamped and warned, once per value that was over (`ncNumbering.renumber.limitedMax`, `limitedDigits`). No schema field was added | Okuma reads no block number above 9999, and a Digits 5 run wrote `N00010` (TODO Next up 7). A Fanuc or Sinumerik max (`wrap`) is where the counter starts over, not a limit; a real hard limit there would need a schema field such as `numbering.maxDigits` | Next up |
| 32 | P1 §7.3 step 2 (`lastParams['transform:'+id]`) | The key is `'transform:'+id+':'+profileId` (the effective profile). Answers stored under the old key are ignored, not migrated | One shared key carried a Fanuc run's 99999 and "Start over" into the next Okuma run and lost Sinumerik's skip list (TODO Next up 7); the old shared answers are the defect | Next up |
| 33 | NC cleanup's "Renumber now?" offer | After a run on a selection the offer renumbers the **whole program** (it says so and collapses the selection first); nothing is renumbered if the selection cannot be cleared | Renumbering only the selection of a consecutively numbered program (Klartext) gave it duplicate numbers | Next up |
| 34 | §7.1 `syntax` (AD-24 family) | + `decimalSeparatorAlt?: '.' \| ','`, an eighth opt-in field. Where a number's strict, point-only parse fails, the tokenizer retries it with this character read as the point; the result keeps the original text (comma included) as its `raw`, so a rewrite can tell which separator to write back. `parseNumber`/`parse_number` are unchanged — the retry lives in the tokenizer's `readValue`/`_read_value`, never in the shared parsing/formatting contract itself | Five of the six published Klartext programs write a decimal comma (`X241,781`, `Q206=636,62`); the manual's own examples use the point. Threading a second, explicit separator through the tokenizer (rather than widening `parseNumber`'s own grammar) keeps `parseNumber('2,5') === null` true for every other dialect and keeps Python's pinned `parse_number(raw)`/`scale_decimal(raw, percent)` signatures (`tests/python/test_helpers.py`'s `API_SIGNATURES`) untouched | dec/klartext |
| 35 | `valueOf`/`writeBack` (`numbers.ts`), `value_of`/`write_back` (`_nc_machine.py`) — amends #34 | Both now read a Klartext decimal comma in a literal's raw text the same way the tokenizer does (retry with the comma read as the point), mirrored in TS and Python on shared goldens (`tests/fixtures/machines/numbers.json`) | Read strictly, a comma `F1000,5` had no value at all: feed limits and the "only above/below" filter were silently skipped (NC2, the M8 re-review). `scale_decimal`'s own signature stays pinned (`API_SIGNATURES`); it gets an internal, unconditional comma-tolerant retry instead (`_lenient_number`/`_decimal_text`), which is safe because it only ever receives a tokenizer's own `value.raw` | dec/int (fix) |
| 36 | §7.1 `syntax` (AD-24 family) | + `programNames?: Pattern`, a ninth opt-in field (Fanuc `<[A-Za-z0-9+\-_.]+>`). Where it matches outside a comment, at any token start, the match is one `programMarker` token with no address and no value, tried after comments and strings and before keywords. `maskComments`/`mask_comments` mask it as `_` per letter and digit (a second mask form, distinct from a blanked comment) so a tool rule cannot read digits inside a name as a tool number and a scale script cannot rewrite them; `program.start` and the outline's `program`/`subprogram-call` rules read the token to start a program or a call (`M98 <NAME>`, `G65 <NAME>`), and the map shows the name as written by recovering the characters the mask did not blank | A Fanuc program can be named instead of numbered (`<PARTS_1>`). Unrecognized, its digits read as ordinary text: scale feed renamed `<CHAMFER_F12>` to `<CHAMFER_F6>` at 50 %, renumber wrote `N10` in front of it, and on the lathe a name holding `T12` was a tool change. `syntax.names` (the M8 sequence-name field) was rejected: it yields an `unknown` token (so renumber still numbers the line), it runs on bare identifiers and would swallow packed Fanuc words, and the mask does not cover it. No AD-24 amendment: the Fanuc profile still declares none of the six M8 fields | dec/names |
| 37 | `src/lib/core/codes/types.ts` `CodeEntry` | + `tapping?: boolean` — the code taps a thread (a tapping cycle, a rigid-tapping call, or a tapping mode such as Fanuc `G63`), independent of `pitchFeed` (`CYCLE84` and `M29` are tapping without `pitchFeed`). + `wordsAreData?: boolean` — the words of the block are arguments or data (`G65`, `G66`, `G10`), so scale feed/speed leave and report them rather than reading one as a feed or a speed. Both flags are carried by `load.ts` and read by the bundled scripts through `context.codes` | Owner decision 1 (2026-09-27, tapping speed): a script needs to know which code taps, on which dialect, without a hardcoded G-code list per dialect. `wordsAreData` was chosen over `fNotFeed` (which means "a time", and would have made `numberClassOf` read a `G65` argument as a dwell) | dec/scaling |
| 38 | `src/lib/core/codes/types.ts` `CodeEntry` | + `tappingElsewhere?: boolean`, set only together with `pitchFeedAmbiguous`: the code is a **tap** on the other kind of machine the code's dual reading points at (Okuma `G84`/`G88`, the Fanuc lathe's `G74`). `scale_speed.tap_speeds` treats such a block like an ordinary tap: its own speed and the speed in force when it runs are left and reported. A `pitchFeedAmbiguous` code whose other reading is a **thread** (Fanuc mill `G76`/`G92`, Okuma `G76`/`G92`, lathe `G78`, lathe-B `G92`) is unaffected, and keeps the existing scale-and-warn behaviour | The re-review of the tapping fix (NC1) found that `pitchFeedAmbiguous`'s single "scale and warn" reading was right for a threading dual-meaning but wrong for a tapping one: Okuma's published `DRILLING.min` taps with `G84` (the machining centres' cycle there), and owner decision 1 applies to that reading too, not only to the codes the tapping database calls a tap outright | dec/int (fix, NC1) |
| 39 | `src/lib/core/codes/types.ts` `CodeSets` | An entry for an **assignment word** (no code letter of its own) may carry `speedUnit: 'surface'` — Sinumerik `SVC=`/`SVC[n]=`. `scale_speed` treats it like the `S` under `G96`: scaled under "Also scale constant surface speeds", for the master spindle or the spindle its index names | The Siemens programming manual makes `SVC` certainly the tool's cutting speed in m/min on the master spindle, exactly the plan's surface-speed rule; before this it was neither scaled nor reported (source review §6) | dec/scaling |
| 40 | §7.1 profile `addresses` | + `mainSpindle?: string`, validated `^[A-Za-z0-9]+$`. Sinumerik ships `"1"` (owner decision 4, 2026-09-27). A plain `S` while the master spindle is the main spindle (default, `SETMS`, or `SETMS(1)`), and `S1=`/`S[1]=`, are the main spindle's speed and scale; other spindle numbers stay "other spindles", reported and left unless asked for | A **profile default**, not a machine parameter: the owner fixed spindle 1, and a `machineParams.variants` overlay (which the model could carry, AD-31) would add a Machines-page choice and a resolved-fixture fan-out for a choice nobody has asked for yet. Without it, a Sinumerik post that writes `SETMS(1)` before every speed had nothing scaled | dec/scaling |
| 41 | P1 §7.10 `FeedModeTracker` (Python) | `pitch_mode`: a `pitchFeed` code may now be **modal**, sitting in a group of its own outside `cycle`/`motion` (Fanuc `G63`, the path-mode group with `G61`/`G62`/`G64`) — the feed is a lead while that code is the active code of its group. `ModalInterpreter`/its TS mirror are unchanged (a documented gap: `numberClassOf` does not yet read this mode, TODO) | Owner decision (TODO Next up 8): whether `pitchFeed` may sit outside a cycle or motion group. `G63` is the only such database entry | dec/scaling |
| 42 | `src/lib/core/profiles/contradiction.ts` (new module) | `findContradiction(cp, lines) → Contradiction \| null`, `leadingLines`, `contradictionRefusal(cp, read, lineCount, action, 'transforms' \| 'scripts') → Msg \| null`, `GUARDED_TRANSFORMS`, `guardsScriptOutput(output)`, `CONTRADICTION_KEYS`, and the exported constants `GUARD_LINES = 400`, `HEADER_LINES = 5`, `GUARD_READ_LIMIT = 20000`, `EVIDENCE_CHARS = 32`. Decided by the profile's `grammar` family (iso / klartext / okuma / sinumerik). A **header** (first 5 non-empty lines: `BEGIN PGM` on a numbered block, `%_N_…_MPF`, `;$PATH=`, `$NAME.MIN%`) decides alone; a **marker** of another grammar anywhere in the first 400 non-empty lines (never inside a comment) is enough otherwise. `app/transforms.ts` and `app/scripts.ts` each call it once, before the form, the preflight or any run: Remove Comments, Renumber, Remove Block Numbers, Insert/Remove Spaces and Convert Case are guarded (not Remove Empty Lines), and so is a script whose header declares `output: "replace"` or `"new-document"`. New i18n keys `transforms.contradiction`, `scripts.contradiction` name the line, the evidence, the likely dialect and the way out (Change Dialect…); a hand-picked dialect gets the same refusal | R1's most harmful finding: a wrongly detected Klartext or Sinumerik program was silently corrupted by an ordinary Remove Comments or Renumber. The guard reads only the text and the grammar, so it works even when the dialect was picked by hand | dec/detect |
| 43 | `src/lib/data/profiles/*.json` `detect` blocks; `src/lib/core/profiles/detect.ts` | Two exported constants, `DECISIVE_WEIGHT = 5000` and `CERTAIN_WEIGHT = 20` (the scoring code itself is unchanged). Klartext `^\d+ BEGIN PGM <name> MM\|INCH` and Sinumerik `%_N_…_MPF\|SPF` / `;$PATH=` now weigh `DECISIVE_WEIGHT`, like the Okuma `$NAME.MIN%` header already did. Okuma's `.min`/`.sub`/`.ssb` extensions drop from `DECISIVE_WEIGHT` to `CERTAIN_WEIGHT` (more than any one ordinary line, less than clear Fanuc mill content); `okuma-osp.json`'s `detect.priority` drops from `0` to `-1`, so a header-less tie with the Fanuc lathe goes to the lathe. Sinumerik gains markers on lines that also move `Y` (`=AC(`/`=IC(`/`=DC(`/`=ACP(`/`=ACN(`, `CR=`, `TRAORI`/`TRAFOOF`/`TRACYL`/`TRANSMIT`/`ORIWKS`/`ORIAXES`/`MCALL`/`SUPA`, `WORKPIECE(`, a bare `CYCLEnnn`); Okuma gains an R9 machining-centre guard (`G15 H…`/`G16 H…`, `G56 H…` with no `G43`/`G44`, weight 400) and loses `G180`–`G189` as a strong marker (100 → 3, since a Fanuc lathe builder macro can use the same numbers); a `T\d{4,5}` lathe `T` word counts as lathe evidence (weight 3) | The M8 re-review and the source review's run over the owner's programs: four of six published Siemens milling programs and a 5-axis Klartext program of `LN` blocks opened as Fanuc mill; `G180`–`G189` at weight 100 opened a Fanuc lathe builder-macro program as Okuma | dec/detect |
| 44 | `gedit_nc.py` (Python), beyond §7.10 | `decimal_of(literal_or_text)`: the exact value from the parsed parts, text read strictly then, on failure, with the Klartext-style comma retried as the point. Used by `scale_token`'s `value`/`new_text`/`limited` (via a local `exact_value`), and by `scale_feed.same_number`/`tool_list.numeric` | NC2 (the M8 re-review): `_nc_machine._decimal`/TS `toDec` read a token's `raw` strictly, so a comma value had no value at all, and a limit or an only-above/below filter silently never applied to it | dec/int (fix, NC2) |
| 45 | `src/lib/data/profiles/heidenhain-klartext.json`, outline `section`/`comment` rules | `syntax.sectionHeading` reads an optional block skip before **or** after the number (`^\s*(?:/\s*)?\d+\s+(?:/\s*)?\*`); the outline's `section` and `comment` rules accept the same. Data only — no field changed | NC4: one of the owner's posts writes the skip in front of a structure block (`/N *`); before this it was read as a plain heading and lost the mark | dec/int (fix, NC4) |
| 46 | `src/lib/data/profiles/okuma-osp.json` `syntax.continuationStart` | Changed from `"^[ \t]*\$(?=[ \t]\|$)"` (a blank had to follow the `$`) to `"^[ \t]*\$(?![^\r\n]*%)"` (a continuation unless the line carries the `$NAME.MIN%` header's `%`). Both TS (`compile.ts`) and Python (`_nc_lex.py`) read this one pattern, so one JSON edit fixes both languages | The manuals write a continuation with no blank after `$` (`$H2.45 L2 F2.5 M23`); the M8 re-review found the lead on such a line was scaled instead of left. This is the fix the dec-scaling hand-off flagged and left for integration | dec/int (fix) |

### 7.17 Channels (P12; WP12.1–WP12.6; AD-32)

**Types**, `src/lib/core/channels/types.ts`:

```ts
/** A channel the machine declares. `index` is the position in the list = the display order. */
export interface ChannelRef { id: string; name: string; index: number }

/** How a machine's channels are laid out. Stored in `MachineParams.channels` (§7.15). */
export interface ChannelParams {
  layout: 'none' | 'single-file' | 'multi-file';
  /** 2–32 channels (empty for `layout: 'none'`); ids `^[a-z0-9][a-z0-9_-]{0,15}$`, unique ignoring
   *  case; names 1–32 characters. The array order is the display order. */
  list: {
    id: string;
    name: string;
    /** Other spellings of THIS channel, matched case-insensitively wherever a pattern names a
     *  channel: the `channel` capture of `sectionStart` and `marker`, and every piece of a `line`
     *  partner capture. Real programs use three different tokens for one channel — Okuma starts a
     *  section with `G13`, a Siemens post writes the partners as `WAIT_K1`, the file is called
     *  `…_CH1` — so the id must not have to be all three (≤ 8 per channel, 1–32 characters each,
     *  unique across the whole list ignoring case, and never equal to another channel's id). */
    aliases?: string[];
    /** `multi-file` only: this channel's own base-name template, `{{stem}}` and `{{channel}}` only.
     *  Tried before `fileNameFor`, so a set whose names share no one pattern (`%_N_1000_MPF` /
     *  `%_N_2000_MPF`, `PART.MPF` / `PART_GS.MPF`) is expressible. */
    fileName?: string;
  }[];

  // --- single-file -------------------------------------------------------------------
  /** Starts a channel section. A named group `channel` gives the id (or an alias); without one the
   *  Nth match is the Nth declared channel (allowed only when the counts can match, WP12.3).
   *  A capture that names SEVERAL channels is split on `sectionSeparator` and the section then
   *  belongs to each of them — a documented layout (`+S1/S3/S4`, a common section both turrets run).
   *  A channel may start a section any number of times; the ranges are collected in document order. */
  sectionStart?: Pattern;
  /** The separator inside a `sectionStart` `channel` capture; default `/`. Reuses the `line` partner
   *  splitting code path, so there is one implementation of "this token names these channels". */
  sectionSeparator?: string;
  /** Ends a section. Absent: a section runs to the next start, else to the last line. Lines between
   *  a `sectionEnd` and the next start belong to no channel: they are `ChannelSet.outside`. */
  sectionEnd?: Pattern;

  // --- multi-file --------------------------------------------------------------------
  /** Matched on the BASE NAME, with named groups `stem` and `channel`:
   *  `^(?<stem>.+)_CH(?<channel>\\d+)\\.nc$`. Case-insensitive on macOS and Windows, as `docs.byPath` is.
   *  Optional: a set whose members are named by `list[].fileName`, or assigned by hand (see
   *  `channels.assign`, WP12.5), needs no `fileName` at all. */
  fileName?: Pattern;
  /** The shared fallback template for a channel without its own `list[].fileName`; `{{stem}}` and
   *  `{{channel}}` only, no expressions. Absent: derived from `fileName` by replacing the `channel`
   *  capture — WP12.1 reports when it cannot. */
  fileNameFor?: string;
  /** A line in the first 400 masked lines that names this document's channel (`channel` capture,
   *  id or alias). It WINS over the file name; a disagreement is a problem, never a silent choice.
   *  It is the only automatic answer for a set whose names carry no channel token at all
   *  (`%_N_1000_MPF` says which channel it is in a header comment). */
  marker?: Pattern;

  // --- sync marks --------------------------------------------------------------------
  syncMarks: SyncRule[];
}

/** What kind of coordination a rule's marks are, and therefore what the check may conclude from
 *  them (WP12.2). Three mechanisms exist on the owner's own controls and they are not the same
 *  check; a rule that names the wrong one produces findings on a correct program. */
export type SyncSemantics =
  /** A rendezvous with an id: the k-th mark of an id in one channel meets the k-th of that id in
   *  the partner (a Fanuc builder `M1xx` wait, a Siemens `WAITM(<id>,…)`). Default. */
  | 'rendezvous'
  /** A rendezvous with NO id: only the number and the order of the marks matter, and both sides
   *  must carry the same count (the documented Okuma `M100` rule: "the same number of M100 codes
   *  must be used at both the G13 and the G14 sides"). `mark` is optional for this kind. */
  | 'count'
  /** An ORDERING mechanism, not a rendezvous: the ids order the two channels against each other
   *  and need not appear in both (the documented Okuma `P` codes: execution proceeds from the
   *  smaller number to the larger, and the manual's own correct example is P10/P20/P40 against
   *  P10/P30/P40). The check only reports a number that DECREASES inside one channel; a number
   *  present on one side only is legal and is never "missing" or "unmatched". */
  | 'ordered';

export interface SyncRule {
  id: string;                     // stable, unique per machine; used by problems and goldens
  label: string;                  // display text (data, untranslated)
  /** Default `rendezvous`. It decides which findings the rule can produce (WP12.2). */
  semantics?: SyncSemantics;
  match:
    | { kind: 'prefix'; prefix: string; idDigits?: { min: number; max: number } }
    | { kind: 'regex'; pattern: Pattern };          // a named capture `mark` is REQUIRED except for `count`
  partners:
    | { kind: 'all' }                               // every channel of the machine
    | { kind: 'fixed'; channels: string[] }         // a list written once per rule
    | { kind: 'line'; pattern: Pattern; separator?: string /* default ',' */ };  // capture `channels`
  /** Only a blocking wait is checked (D60). A `false` mark is shown in the map and the navigation
   *  and never checked, because a marker that sets a flag is not a rendezvous. Default true. */
  blocking?: boolean;
}

export interface SyncHit {
  ruleId: string;
  /** The id as written, trimmed; `''` for a `count` rule, which has no id. Two ids are the same
   *  when their text is the same, and, when both are all digits, when their values are — so `M101`
   *  in one channel matches `M1 01` in the other. Nothing else is normalized; the check reports the
   *  ids as they are written. */
  mark: string;
  line: number;                   // 1-based, in the document that holds it
  channel: string;                // channel id, or '' for a hit outside every section
  /** Resolved partner channel ids; an id the machine does not declare is kept and reported. */
  partners: string[];
  blocking: boolean;
}

/** One channel's lines inside a `single-file` document: a channel may have SEVERAL ranges, because
 *  the turret sections of a real 2S program alternate (`G13 … G14 … G13 … G14 …`) and the control
 *  itself "separates the portions governed by the turret selection G codes" into one program per
 *  turret. Ranges are in document order, never overlapping. */
export interface ChannelSection { channel: ChannelRef; ranges: { startLine: number; endLine: number }[] }

export type ChannelMember =
  | { kind: 'section'; channel: ChannelRef; docId: DocId; ranges: { startLine: number; endLine: number }[] }
  | { kind: 'file'; channel: ChannelRef; name: string; path: string | null; exists: boolean;
      docId: DocId | null;
      /** How this document was tied to the channel: a pattern, or the user's own assignment
       *  (`channels.assign`, remembered by M7's per-file memory). The status item says which. */
      by: 'fileName' | 'marker' | 'assigned' };

export interface ChannelProblem { path: string /* JSON path in machines.json, or a line */; message: Msg }

export interface ChannelSet {
  layout: ChannelParams['layout'];
  /** Empty for `none`; otherwise one entry per channel that was found. */
  members: ChannelMember[];
  /** Declared channels that were not found; shown, never silently empty. */
  missing: ChannelRef[];
  /** `single-file`: every line range that belongs to NO channel, in document order — the lines
   *  before the first section, the lines after a `sectionEnd` and before the next start (the
   *  subprograms of a concatenated transfer file live there), and the lines after the last section.
   *  They are a group of their own in the map and are never dropped (§12). Empty for `multi-file`. */
  outside: { startLine: number; endLine: number }[];
  /** Blocking and non-blocking marks of THIS document, in line order. */
  marks: SyncHit[];
  problems: ChannelProblem[];
  /** True when a cap or the 500 ms budget stopped the resolution or the check; the UI says so. */
  truncated: boolean;
}

export type SyncFindingKind =
  /** `rendezvous`: an id occurs in channel A and names channel C, and C has fewer of it than A has
   *  (the ordinal partner is absent). Replaces the first draft's `duplicated`, which reported every
   *  correct program that waits on the same id twice. */
  | 'missing'
  /** `rendezvous`/`count`: the two channels carry a different NUMBER of this mark ("channel 2 has
   *  this wait twice, channel 1 three times"). The documented Okuma `M100` rule and the shape of
   *  the Siemens example, where `WAITM(0,…)` legitimately occurs three times per channel. */
  | 'count-mismatch'
  /** `rendezvous`: the two ordered mark sequences of a channel pair disagree (a linear diff), with
   *  the first disagreeing pair named. */
  | 'out-of-order'
  /** `ordered` only: a mark id that is smaller than the previous one in the SAME channel, which is
   *  the one thing the Okuma P-code rule forbids. Never raised for a `rendezvous` rule. */
  | 'not-increasing'
  /** A mark's partner set names a channel the machine does not declare. Only a `line` partner rule
   *  can produce it; `all` and `fixed` resolve inside the declared list by construction. */
  | 'unknown-channel'
  /** A blocking `rendezvous` mark whose partner set names only its own channel, so nothing can
   *  answer it. NOT raised for a mark that already produced a `missing` or `count-mismatch`
   *  finding — one defect gives one finding (WP12.2 precedence). */
  | 'unmatched'
  /** A mark found outside every channel section (`SyncHit.channel === ''`): reported as
   *  "wait outside every channel", never silently keyed to a channel. */
  | 'outside-channels'
  /** The order of this pair is not judged, with the reason in the message (a jump target or a
   *  backward jump lies between them). */
  | 'order-not-checked';
export interface SyncFinding {
  kind: SyncFindingKind;
  mark: string;                   // `''` for a `count` rule; the message then names the rule label
  ruleId: string;
  channel: string;                // the channel the finding is about
  other?: string;                 // the other channel of a pair
  counts?: { channel: number; other: number };   // `count-mismatch`
  line: number; document?: string;  // `Located.document` semantics (F58)
  otherLine?: number;
  message: Msg;
}
```

**The check's algorithm, binding** (WP12.2; it is part of the contract because the naive reading of
"a pair of ids" is quadratic and the caps allow 20,000 marks over 32 channels). Per sync rule and
per **ordered channel pair** (A, B) where a mark of A names B:

0. One pass over all marks first: a hit whose `channel` is `''` is `outside-channels`; a partner id
   that matches no declared channel id or alias is `unknown-channel`; non-blocking marks are set
   aside. Neither depends on a channel pair, so neither is repeated per pair.
1. Take A's marks that name B and B's marks that name A, each already in line order — one filter, no
   sorting.
2. `count`: compare the two lengths; a difference is one `count-mismatch`, nothing else. This is the
   whole check for an id-less rule.
3. `ordered`: walk each channel's list once and report a mark whose id is smaller than the previous
   one (`not-increasing`). The two channels are never compared, so an id on one side only is legal.
4. `rendezvous`: pair the two lists **by ordinal per id** (the k-th `80` of A against the k-th `80`
   of B) with one pass over each list into a map id → positions; a difference in a count is one
   `count-mismatch` per id, and a mark of A with no ordinal partner is `missing`. Then run **one
   linear diff (LCS) over the two ordered id sequences** to find order differences, O(n log n) worst
   case, never a pairwise scan over id pairs. At most one inversion is reported per channel pair,
   plus the count of the rest (as the draft already said). A pair whose two marks are separated by a
   line in `o.jumpLines` for that channel becomes `order-not-checked` instead of an inversion.
5. Last, `unmatched`: a blocking `rendezvous` mark whose partner set named only its own channel, and
   that produced neither a `missing` nor a `count-mismatch` finding in any pair. The precedence is
   what keeps one defect from being reported twice.

Budget: the check is bounded by the same caps as the resolution (≤ 20,000 marks per document, ≤ 32
channels) and by **1,000 ms over the whole report**; past it the report is truncated with
`ChannelSet.truncated` and a header line saying so, exactly as resolution already does. G7 measures
it at the contract cap, not below it.

**Pure functions** (`core/channels/{resolve,marks,siblings,check}.ts`; `resolve.ts` and `marks.ts` implemented by P12, owned by WP12.1 from Wave A on):

```ts
export function findSections(lines: readonly string[], cp: CompiledProfile, p: ChannelParams):
  { sections: ChannelSection[];                        // one entry per channel found, ranges in document order
    outside: { startLine: number; endLine: number }[]; // leading, inter-section and trailing lines
    problems: ChannelProblem[] };
export function channelAt(set: ChannelSet, line: number): ChannelRef | null;   // walks the ranges
export function siblingNames(baseName: string, p: ChannelParams):
  { channel: ChannelRef; name: string }[] | null;      // null: this name is not a channel file
export function markerChannel(lines: readonly string[], cp: CompiledProfile, p: ChannelParams): string | null;
export function findMarks(lines: readonly string[], cp: CompiledProfile, p: ChannelParams,
  o: { channelOf(line: number): string }): SyncHit[];   // masked lines only; first matching rule owns a line
export function checkSyncMarks(   // the key '' holds the hits no section owned (`outside-channels`)
  perChannel: Readonly<Record<string, SyncHit[]>>, p: ChannelParams,
  o: { /** Per channel, the lines the written order may not be carried across: a label that is a
        *  jump TARGET (some `GOTO`/`GOTOB`/`GOTOF`/`M99 P`/`M98 Q` in the same channel names it) and
        *  the line of a BACKWARD jump. A label that is merely written on a line — which every wait
        *  line of a real Siemens program is — is not one, and neither is a label on the mark line
        *  itself. WP12.5 computes it from the outline and the profile's `numbering.references`. */
       jumpLines?: Readonly<Record<string, number[]>> }): SyncFinding[];
```

`channelFields` lives beside the other machine-dialog fields, `core/machines/channelFields.ts` (WP12.3), not in `core/channels/`, because it belongs to the Machines page and not to the resolution:

```ts
export function channelFields(p: ChannelParams): { layout: FieldSpec[]; rule: FieldSpec[] };   // existing FieldTypes only (F46)
```

Caps, binding for both languages: ≤ 32 channels, ≤ 8 aliases per channel, ≤ 32 sync rules, ≤ 20,000 marks per document (the rest counted and reported, never dropped in silence), each pattern ≤ 1,000 characters and inside the P1 AD-11 subset, resolution abandoned above 500 ms with `layout: 'none'` and a status message, the **check** abandoned above 1,000 ms over the whole report with `truncated` set and a header line saying so. G7 measures the check at these caps (20,000 marks over 8 and over 32 channels), not at a comfortable sample, because the algorithm above is what makes the caps affordable.

**Service**, `app/types.ts` → `stores/channels.ts` exports `channels: ChannelService` (P12 stub; WP12.5):

```ts
export interface ChannelService {
  readonly revision: Readable<number>;
  start(): Disposable;                                  // bootstrap, after machines.load
  /** Always an answer; `layout: 'none'` when the document has no machine, the machine has no
   *  channel block, or nothing matched. Cached per document and effective machine key. */
  forDoc(id: DocId): ChannelSet;
  channelAt(id: DocId, line: number): ChannelRef | null;
  /** `multi-file`: existence of the siblings, through `channelSiblings` — metadata only, no opening. */
  siblings(id: DocId): Promise<ChannelMember[]>;
  /** `multi-file`: tie an OPEN document to a channel of this set by hand, for a set no pattern
   *  describes (`%_N_1000_MPF` / `%_N_2000_MPF`, `PART.MPF` / `PART_GS.MPF`, the same name in two
   *  folders). Remembered by M7's per-file memory, so it survives a restart; cleared with `null`. */
  assign(id: DocId, channelId: string | null): void;
  /** The check over the channels that are OPEN.
   *  **One machine decides.** Every member is resolved with the *initiating* document's effective
   *  machine, never with each document's own — two machines' rules silently mixed would produce
   *  findings nobody can read. A sibling whose own effective machine differs is still checked, and
   *  `otherMachines` names it so the report header can say "channel 2 is set to machine X" and
   *  offer "use this machine for channel 2"; a sibling with no machine at all is named the same way.
   *  `notChecked` names the channels that are missing or not open. */
  check(id: DocId): { findings: SyncFinding[]; checked: string[]; notChecked: ChannelRef[];
                      otherMachines: { channel: string; docId: DocId; machineName: string | null }[] };
}
```

**Script context** (`core/scripting/types.ts`, P12; filled by `buildContext` from `BuildContextInput.channels`; absent for `layout: 'none'`, so every M5–M11 script is unaffected):

```ts
export interface ScriptContextV2 {
  // … P1 and M6 members; `contract` stays 2 …
  channels?: {
    layout: 'single-file' | 'multi-file';
    /** Which channel this document is; null for a `single-file` document (it holds several). */
    self: string | null;
    list: { id: string; name: string;
            /** `single-file`: every line range of this channel, in document order (a turret section
             *  may repeat; `ranges` is empty for a declared channel that was not found). */
            ranges?: { startLine: number; endLine: number }[];
            /** `multi-file` only. The path adds nothing a script could not derive from `document.path`. */
            file?: string; path?: string; open?: boolean }[];
    /** `single-file`: the ranges that belong to no channel (header, inter-section, trailing), so a
     *  script that rebuilds a channel never silently swallows a shared subprogram. */
    outside?: { startLine: number; endLine: number }[];
    /** The marks found in THIS document only. A script never receives another document's text (F60). */
    marks: { id: string; line: number; channel: string; partners: string[]; blocking: boolean }[];
  };
}
```

**Python** (`_nc_channels.py`, re-exported by `gedit_nc`; standard library only, Python 3.9 syntax):

```python
def channels(ctx: dict) -> dict: ...          # ctx["channels"], or {"layout": "none", "list": [], "marks": []}
def channel_of(ctx: dict, line: int) -> "Optional[str]": ...   # walks the channel's ranges
def channel_lines(ctx: dict, lines: "Sequence[str]", channel_id: str) -> "List[str]": ...
    # every range of that channel, concatenated in document order — what the control itself does when
    # it separates a program into one program per turret. Never the lines of `outside`.
def outside_lines(ctx: dict, lines: "Sequence[str]") -> "List[str]": ...   # the ranges no channel owns
def sync_marks(ctx: dict, channel_id: "Optional[str]" = None) -> "List[dict]": ...
```

A script that wants to work per channel calls `channels(load_context())` and groups its rows by `channel_of(line)`; a script that does nothing with channels needs no change, because the member is simply absent on a document without them.

**Golden format**, `tests/fixtures/channels/<case>.json`, shared by the TS tests and (through `channel_context`) by Python:

```json
{ "input": "../nc/channels/fanuc-lathe/c01-twin-single.nc",
  "machine": { "channels": { "layout": "single-file", "list": [ … ], "sectionStart": "…", "syncMarks": [ … ] } },
  "expect": { "sections": [ { "channel": "1", "ranges": [ { "startLine": 3, "endLine": 48 },
                                                          { "startLine": 96, "endLine": 140 } ] } ],
              "outside": [ { "startLine": 1, "endLine": 2 }, { "startLine": 141, "endLine": 160 } ],
              "marks": [ { "mark": "10", "line": 12, "channel": "1", "partners": ["1", "2"] } ],
              "findings": [ { "kind": "missing", "mark": "30", "channel": "2", "line": 41 } ] } }
```

Only the listed keys are compared. `machine` is a partial `MachineParams` applied as the document's machine, exactly as a modal golden's is (§7.4), and the generated effective profile comes from `tests/fixtures/resolved/effective/**` (P6 item 12, §5.2 rule 3).

---

## 8. Content work (in our own words; gate G10)

All labels and descriptions are written in our own words from `docs/planning/syntax/*.md`; code numbers and parameter letters are facts. Anything the syntax notes mark **(verify)** ships with `verify: true` (hidden from hover, shown in completion as "Not verified yet", P1 WP3.6) unless the owner confirms it. No machine-builder codes in a built-in; unknown M-codes are "machine specific", never errors. Committed fixtures are synthetic and carry the `WRITTEN FOR GEDIT` marker, except the owner-approved public programs (§9.2). The tables fix **what** each entry says; the WP writes the JSON and the one-sentence descriptions, and G10 reviews them (§8.7).

**Machine-dependent values are defaults, not facts** (owner decision, D23/D24/D34/D35). Every value in a `machineParams` declaration (§8.8) and every `modal.initial` code is what gEdit assumes when no machine says otherwise. The label says so ("Increments of 0.001 mm (IS-B), the usual Fanuc setting"), the source is named where the notes give one, and `verify: true` marks the rest; the user guide presents them the same way (WP6.7).

### 8.1 The Fanuc lathe profile (`fanuc-lathe.json`; P6 skeleton, WP6.2)

Only what differs from the parent is written (AD-16); arrays replace, so `detect.content` is restated in full. The tool patterns were checked in node and Python 3 for this plan (§0.1).

```json
{
  "id": "fanuc-lathe",
  "extends": "fanuc-gcode",
  "name": "Fanuc (ISO) lathe",
  "shortName": "Fanuc T",
  "machineType": "lathe",
  "codes": "fanuc-lathe",
  "files": { "filterName": "Fanuc lathe G-Code" },
  "detect": {
    "extensions": { "nc": 3, "tap": 3, "cnc": 2, "eia": 2, "iso": 2 },
    "content": [
      { "pattern": "^\\s*%\\s*$", "weight": 5 },
      { "pattern": "^\\s*[O:]\\d{1,8}(?!\\d)", "weight": 5 },
      { "pattern": "^\\s*N\\d+", "weight": 1 },
      { "pattern": "^\\s*(N\\d+\\s*)?[GM]\\d{1,3}(\\.\\d)?(?![\\d.])", "weight": 1 },
      { "pattern": "^\\s*\\([^)]*\\)\\s*$", "weight": 1 },
      { "pattern": "(?<![A-Z])T\\d{4}(?!\\d)", "weight": 3 },
      { "pattern": "(?<![A-Z])G0*50\\s*S\\d", "weight": 4 },
      { "pattern": "(?<![A-Z])G0*92\\s*S\\d", "weight": 4 },
      { "pattern": "(?<![A-Z])G0*7[0-3](?![\\d.])(?=[^(]*P\\d)(?=[^(]*Q\\d)", "weight": 6 },
      { "pattern": "(?<![A-Z])G0*7[12]\\s*U[\\d.]+\\s*R", "weight": 6 },
      { "pattern": "(?<![A-Z])G0*28\\s*U", "weight": 4 },
      { "pattern": "(?<![A-Z])[UW][-+]?\\.?\\d", "weight": 1 }
    ],
    "priority": 0
  },
  "addresses": {
    "axes": ["X", "Z", "C", "Y", "U", "W"],
    "arcCenter": ["I", "K"],
    "incremental": { "U": "X", "W": "Z" },
    "diameter": ["X", "U"],
    "angular": ["C"]
  },
  "toolCall": {
    "trigger": "(?<![A-Z])T\\d{1,4}(?!\\d)",
    "ignore": "(?<![A-Z])T(?:\\d{0,2}00|0+)(?!\\d)",
    "tool": "(?<![A-Z])T(?<tool>\\d{1,2}?)(?:\\d{2})?(?!\\d)",
    "toolFrom": "same-line"
  },
  "modal": { "initial": { "feedmode": "G99", "spindlemode": "G97", "plane": "G18" } },
  "syntax": { "decimalPointSignificant": false },
  "machineParams": {
    "numberInput": { "default": "calculator" },
    "diameter": "on",
    "modalGroups": ["feedmode", "spindlemode", "plane"],
    "variants": [
      { "id": "gcodeSystem", "label": "G-code system", "default": "A",
        "choices": [
          { "value": "A", "label": "G-code system A", "codes": "fanuc-lathe",
            "detect": [ { "pattern": "(?<![A-Z])G0*50\\s*S\\d", "weight": 4 },
                        { "pattern": "(?<![A-Z])G0*9[89](?![\\d.])", "weight": 2 } ] },
          { "value": "B", "label": "G-code system B", "codes": "fanuc-lathe-b",
            "overlay": { "modal": { "initial": { "feedmode": "G95" } } },
            "detect": [ { "pattern": "(?<![A-Z])G0*92\\s*S\\d", "weight": 5 },
                        { "pattern": "(?<![A-Z])G0*7[789](?![\\d.])", "weight": 4 },
                        { "pattern": "(?<![A-Z])G0*9[45](?![\\d.])", "weight": 2 } ] }
        ] }
    ]
  },
  "numbering": {
    "references": [
      { "trigger": "(?<![A-Z])M0*99(?!\\d)", "addresses": ["P"], "rewrite": false },
      { "trigger": "(?<![A-Z])M0*98(?![^(]*P\\d)(?=[^(]*Q\\d)", "addresses": ["Q"] },
      { "trigger": "(?<![A-Z])G0*7[0-3](?![\\d.])(?=[^(]*P\\d)(?=[^(]*Q\\d)", "addresses": ["P", "Q"] },
      { "trigger": "(?<![A-Z])GOTO", "addresses": ["GOTO"] }
    ]
  },
  "toolList": { "description": "auto", "commentFilter": "^[-*=_\\s]*$", "dropLeadingZeros": true }
}
```

The `numberInput` **presets** and `units` are inherited from `fanuc-gcode` (objects merge key by key, AD-16), but the lathe's **default preset is `calculator`**, not the mill's `is-b`: the owner's 18i-T lathe manuals read `X40` as 40 mm and `G4U2` as a two-second dwell in the same programs, which is calculator-type input throughout (§8.8, D56; the mill keeps `is-b` because X10 pins Phase 1's results). `syntax.decimalPointSignificant` therefore becomes `false` on the lathe, which is what WP6.1's "the default preset agrees with the profile's own value" rule checks. Every real lathe still gets its machine configuration; with none, a word whose reading depends on the machine is left alone and reported (AD-31 "No machine, no guess"), so the `calculator` default never silently divides a value by a thousand. There is no `fanuc-lathe-b` profile any more: system B is the `gcodeSystem` choice `B`, with its database and the `G95` power-on overlay. Without a machine, the variant rules above decide the system (margin ≥ 3, printed by G10), otherwise the default A applies; a machine's `gcodeSystem` always wins (AD-31).

Notes for WP6.2 and the review:
- The `[^(]*` lookaheads run on the masked line (F23), so a `P` in a comment cannot fire them.
- `modal.initial` (A: `G99`, `G97`, `G18`; B through the overlay: `G95`, `G97`, `G18`) is the usual power-on state and a **documented default** (D24): a machine configuration overrides it per group. It only matters for a program that does not state its modes; CAM headers normally do. It is shown as "assumed", with its source.
- `G94` is a facing pass in A and a feed mode in B; with weight 2 it is the weakest B marker on purpose, and G10 checks that no A fixture reaches the B margin through it.
- A two-digit `T10`/`T12` is read as station 10/12. Whether the owner's posts ever write short `T` words on a lathe is D49; no machine parameter covers it in Phase 2 (AD-31).
- The mill profile, in the same WP: remove the `G7[0-3]` rule (F22); add `M0*6(?!\d)` (3), `G0*4[34](?![\d.])` with `H` (3), `Y` words (1) and `G0*17(?![\d.])` (1) to `detect.content`; `detect.priority: 1`. The margin between the winning and the second profile must be ≥ 3 on every fixture (G10 prints it).

### 8.2 The Fanuc lathe code databases (`fanuc-lathe.json` extends `fanuc`; the system-B variant database `fanuc-lathe-b.json` extends `fanuc-lathe`; WP6.2)

`fanuc-lathe` `remove`: `G43`, `G44`, `G49` (no length offset on a turret lathe), `G81`, `G82`, `G86` (mill cycles), `G91`, `G93`, `G95` (not in system A), `G54.1` **(verify: keep if the owner's control has extended offsets)**.

Replaced or added entries (system A):

| Code | Group | Modal | `sets` / flags | What the label says |
|---|---|---|---|---|
| G4 | nonmodal | – | – | Dwell; `X` or `U` in seconds, `P` in milliseconds |
| G18 | plane | ✓ | `plane: ZX` | ZX plane, the turning plane |
| G32 | motion | ✓ | `pitchFeed` | One threading pass; `F` is the lead |
| G40 / G41 / G42 | compensation | ✓ | – | Nose-radius compensation off / tool left / tool right; radius and tip come from the offset |
| G50 | nonmodal | – | `speedLimit` | Set the coordinate system; with `S`, the top spindle speed for constant surface speed |
| G70 | cycle | – | `cycle: start`; params `P`, `Q` | Finish along the profile from block `P` to block `Q` |
| G71 | cycle | – | `cycle: start`; params `U`, `R` / `P`, `Q`, `U`, `W`, `F` | Rough turning along Z (two blocks: depth and retract, then profile and allowances) |
| G72 | cycle | – | as G71 with `W` depth | Rough facing along X |
| G73 | cycle | – | `cycle: start`; params `U`, `W`, `R` / `P`, `Q`, `U`, `W`, `F` | Repeat the profile for pre-shaped stock |
| G74 | cycle | – | `cycle: start`; params `R` / `X`, `Z`, `P`, `Q`, `F`; **not** `pitchFeed` | Face peck drilling or face grooving; `P`/`Q` steps in µm |
| G75 | cycle | – | as G74 | Grooving along X |
| G76 | cycle | – | `cycle: start`; `pitchFeed`; params `P`, `Q`, `R` / `X`, `Z`, `R`, `P`, `Q`, `F` | Multi-pass threading (two blocks); `F` is the lead |
| G80 | cycle | ✓ | `cycle: cancel` | Cancel the drilling cycle |
| G83 / G87 | cycle | ✓ | `cycle: start`; params `Z`/`X`, `R`, `Q`, `P`, `F`, `K` | Drilling on the face / on the side, pecks with `Q` |
| G84 / G88 | cycle | ✓ | `cycle: start`; `pitchFeed` | Tapping on the face / on the side |
| G85 / G89 | cycle | ✓ | `cycle: start`; `verify` | Boring on the face / on the side |
| G90 | motion | ✓ | – | One OD/ID turning pass, straight or tapered (system A; Fanuc group 01, so the next `G00` ends it) |
| G92 | motion | ✓ | `pitchFeed` | One threading pass as a cycle (system A; unambiguous here) |
| G94 | motion | ✓ | – | One facing pass (system A) |
| G96 | spindlemode | ✓ | `speedUnit: surface` | Constant surface speed; `S` in m/min (ft/min) |
| G97 | spindlemode | ✓ | `speedUnit: rpm` | Fixed spindle speed in rpm |
| G98 | feedmode | ✓ | `feedUnit: per-minute` | Feed per minute (system A) |
| G99 | feedmode | ✓ | `feedUnit: per-rev` | Feed per revolution (system A) |
| M6 | tool | – | – | Tool change on a magazine machine; a turret indexes with the `T` word alone |

Addresses (replaced): `X` "position as a diameter"; `U` "incremental X, as a diameter; in cycles a depth or an allowance"; `W` "incremental Z; in cycles an allowance"; `C` "C axis, the spindle angle for live tools"; `P` "first profile block (G70–G73), dwell in ms, step in µm (G74/G75), packed thread data (G76), program number (M98)"; `Q` "last profile block (G70–G73), peck in µm (G74/G75, G83), first cut depth (G76), local call target (M98)"; `R` "arc radius; retract, taper or finish allowance in cycles"; `F` "feed; the lead when threading"; `E` "thread lead, fine form" **(verify)**; `T` "turret station and offset: `T0101` = station 1 with offset 1; `..00` cancels the offset". `H` (incremental C) is left out until verified.

**Parameter units** (`CodeParam.unit`, AD-31). This table is the **one** place the per-parameter units are written down; WP6.2, AD-31's class order and the number goldens all read it, and it covers the mill database too (§8.3), so no `K`/`L` repeat count is ever mistaken for an arc centre or a length:

| Code (database) | Parameter | `unit` | Why |
|---|---|---|---|
| `G74`, `G75` (lathe) | `P`, `Q` | `increment` | Shift and peck in µm (verify; syntax-fanuc §3.2 and the cycle tables) |
| `G74`, `G75` (lathe) | `R`, `X`, `Z`, `F` | – (by class) | Retract and allowances are lengths, `F` a feed |
| `G76` (lathe) | `Q` (both blocks) | `increment` | Minimum and first cut depth in µm |
| `G76` (lathe) | `P` | `count` | Packed digits in the first block, a height in µm in the second; `params` are per code, not per block, so no consumer converts it (a per-block unit is Phase 4) |
| `G83`, `G87` (lathe) | `Q` | `increment` | Peck in µm on the source controls |
| `G83`, `G87` (lathe) | `P` | `count` | Dwell in milliseconds |
| `G83`, `G87` (lathe) | `K` | `count` | Repeat count (syntax-fanuc §6.2) |
| `G70`–`G73` (lathe) | `P`, `Q` | `count` | Block numbers of the profile |
| `G4` | `X`, `U` | `dwell` | Seconds |
| `G4` | `P` | `count` | Milliseconds |
| `M98` | `P`, `L` | `count` | Program number and repeat count |
| `G81`–`G89`, `G84.2`, `G84.3` (mill, `fanuc.json`) | `P` | `count` | Dwell in milliseconds |
| `G81`–`G89`, `G84.2`, `G84.3` (mill) | `K`, `L` | `count` | Repeat counts (syntax-fanuc §3.2 "`L` and `K` when they are repeat counts", §4 `K` is also a repeat count in drilling cycles) |
| `G81`–`G89`, `G84.2`, `G84.3` (mill) | `Q`, `R`, `Z` | – (by class) | Peck, R level and depth are lengths |
| `M98` (mill) | `P`, `L` | `count` | as the lathe |

Everything not listed keeps its class from the address (AD-31 step 6).

`fanuc-lathe-b` (the system-B variant database, selected by `gcodeSystem: B`): `G90`/`G91` distance (`sets.distance`); `G77` (turning pass), `G78` (threading pass, `pitchFeed`), `G79` (facing pass) as `motion`; `G92` nonmodal with `speedLimit` (coordinate set / top speed); `G94`/`G95` feed modes; `G98`/`G99` cycle return (as the mill); `G33` threading (`pitchFeed`) instead of `G32`; `remove` `G50` **(verify: not used in the source manuals)**. The multi-pass cycles `G70`–`G76` are inherited unchanged (syntax-fanuc §4.1: "same as A"). Whether `U`/`W` stay incremental in B is parameter-dependent **(verify, question 13)**; if the owner's machines differ, it becomes a variant overlay of `addresses.incremental` (data only). The variant changes no address and no non-numeric word code (tested), so one grammar serves both systems.

### 8.3 The mill database (`fanuc.json`) and Klartext

- P6 adds `sets` mechanically (AD-19 last bullet), preserving P1 behavior, and the mill's `machineParams` (§8.8), whose default reproduces P1 (`decimalPointSignificant: true`, feeds compared as written).
- WP6.2 also writes the mill rows of the parameter-units table of §8.2 (`P` dwell, `K`/`L` repeats and `M98 P`/`L` as `count`), so the mill cycles are covered by the same one table.
- WP6.2, listed for review: `G43`/`G44`/`G49` to group `lengthComp` (F25); `G50` on the mill reworded as scaling cancel `verify` while keeping `speedLimit` (P1 treated its `S` as a clamp); `G92` and `G76` keep `pitchFeedAmbiguous`, because a lathe program opened with the mill profile by hand must stay protected.
- Klartext needs no database change beyond the P6 `sets`: `FU`/`FZ` move from hardcoded Python into `addresses.feedUnitWords`.

### 8.4 Okuma OSP lathe (`okuma-osp.json`, `okuma.json`; P8 skeleton, WP8.3)

Profile essentials (from `syntax-okuma.md` §2–§8):
- `name` "Okuma OSP lathe", `shortName` "Okuma", `machineType` lathe, `grammar` okuma, `codes` okuma. Extensions `min`, `sub`, `ssb` (default `min`; `.sdf` schedule programs only through "open anyway").
- Detection: extensions 6 each; content `^\$[\w-]+\.(MIN|SUB|SSB|SDF)%` (8), `CALL\s+O\w+` (5), `^\s*(N\w+\s+)?RTS(?![A-Z0-9])` (5), `(?<![A-Z])T\d{6}(?!\d)` (4), `(?<![A-Z])SB\s*=` (5), `(?<![A-Z])G18\d(?!\d)` (3), `(?<![A-Z])V\d+\s*=` (3), an alphanumeric sequence name (2).
- Syntax: `( )` comments; block skip `/` at the start or after the sequence name, no levels; `N` prefix with `sequenceNames: true`; `decimalPointSignificant: false`, which every Okuma preset gives — the 1 mm default reads numbers as written, and the 1 µm and 10 µm systems scale a number with a point exactly like one without (F52), so the point never changes a value; the machine's unit parameter decides how much each digit is worth (D34, §8.8); `variables` `V\d+`; `systemVariables` `V[A-Z][A-Z0-9]{3}`; `assignment` for the two-letter extended addresses, single letters before `=`, and named locals; `header` `^\$[^%]*%`; keywords `GOTO IF CALL RTS MODIN MODOUT GET PUT READ WRITE PSELECT END EQ NE GT GE LT LE AND OR EOR NOT`; `maxLineLength` 158.
- Addresses: `X` (diameter), `Z`, `C`, `Y`; `angular` `C`; arc centre `I`, `K`; no incremental twins (Okuma uses `G91`; `U`/`W` are allowances).
- Tool change: trigger `(?<![A-Z])T\d{4}(?:\d{2})?(?!\d)`; tool `(?<![A-Z])T(?:\d{2}(?=\d{4}(?!\d)))?(?<tool>\d{2})(?=\d{2}(?!\d))` (`T0202`→`02`, `T010203`→`02`); `ignore` a line with a cycle code `G0*(?:7[1-8]|18\d)(?![\d.])` (a `T` there changes only the offset) or a tool of `00`. An offset-only change of the same tool counts as a change (D25).
- Program: start `^\s*O(?<name>[A-Z0-9]{1,4})\s*$`; end `M02`, `M30`, `RTS`. Outline: program, operation comment, label (sequence name), subprogram call (`CALL`/`MODIN O…`), stop, end.
- Numbering: `N` names up to 4 characters, `max` 9999; references `GOTO N…` and `IF […] N…`; names are labels and never renumbered.
- `modal.initial`: `feedmode G95`, `distance G90` (the reset state in syntax-okuma §4.1; assumed; a machine may override it).
- `machineParams`: §8.8.

Database essentials (lathe subset, `syntax-okuma.md` §4):

| Codes | Group / flags | Label gist |
|---|---|---|
| G0, G1, G2, G3 | motion | rapid; feed; arcs by `I`/`K` or radius `L` (not `R`) |
| G4 | nonmodal, `fNotFeed` | dwell; the time is in `F` |
| G13, G14 | turret (`verify`) | select turret A / B |
| G20, G21 | nonmodal (`verify`) | home return / ATC home return — **not** inch/mm |
| G31–G35 | motion, `pitchFeed` | thread cutting, one pass per block |
| G40, G41, G42 | compensation | nose-radius compensation |
| G50 | nonmodal, `speedLimit` | with `S`: top spindle speed; with `X`/`Z`: zero shift |
| G64, G65 | (`verify`) | corner droop control off / on |
| G71, G72 | cycle, `cycle: start`, `pitchFeed` | multi-pass threading — **not** roughing |
| G73, G74 | cycle, `cycle: start` | grooving along X; face grooving or peck drilling |
| G75, G76 | nonmodal | automatic chamfer / corner round in a `G01` block — **not** cycles |
| G77, G78 | cycle, `cycle: start`, `pitchFeed` | tapping right / left hand |
| G80–G88 | `lap` (`verify`) | LAP shape definition and calls — **not** drilling |
| G90, G91 | distance, `sets` | absolute / incremental (X stays a diameter) |
| G94, G95 | feedmode, `sets` | per minute / per revolution |
| G96, G97 | spindlemode, `sets` | constant cutting speed / rpm |
| G180 | cycle, `cycle: cancel` | cancel the live-tool cycle |
| G181–G183, G189 | cycle, `cycle: start` | live-tool drill, bore, deep-hole drill, ream |
| G184–G188 | cycle, `cycle: start`, `pitchFeed` (`verify` for G185–G188) | live-tool tapping and threading |
| M codes of §4.2 | own groups | own one-line labels (`M12`–`M14` live-tool spindle; the rest per the notes) |
| CALL, RTS, GOTO, IF, MODIN, MODOUT | program / macro | call, return, jump, modal call |

Addresses: `L` radius/chamfer/relief, `D` depth, `E` dwell or lead change, `Q` repeat count / hole count / starts, `U`/`W` finish allowance (**not** incremental), `SB` live-tool speed (not the main spindle), `T` 4 or 6 digits, `P` turret sync code.

### 8.5 Sinumerik 840D turning (`sinumerik.json`, `sinumerik.json` database; P8 skeleton, WP8.5)

Profile essentials (from `syntax-sinumerik.md` §2–§8):
- `name` "Sinumerik 840D (turning)", `shortName` "Sinumerik", `machineType` lathe, `grammar` sinumerik, `codes` sinumerik; extensions `mpf`, `spf`.
- Detection: extensions 8; content `^%_N_\w+_(MPF|SPF)` (8), `^;\$PATH=` (6), `CYCLE\d+\s*\(` (4), `T\s*=\s*"` (4), `MSG\s*\(` (3), `LIMS\s*=` (4), `DIAMON` (4), `GOTO[FB]`, `DEF\s+(REAL|INT)`, `G64[0-9]` (2–3), whole-line `;` comments (1). Klartext also uses `;`: the Klartext markers (`BEGIN PGM`, a leading block number without `N`) keep the two apart (G10 prints the margins).
- Syntax: `;` comments, `strings: true`, block skip `/` and `/0`–`/9`, `N` prefix with `:` as an alternative prefix **(verify)**, `decimalPointSignificant: false`, packed words accepted, `variables` `R\d+`, `systemVariables` `\$[A-Z_][A-Z0-9_]*`, `assignment` `[A-Z_][A-Z0-9_]*(?=\s*=(?!=))`, `labels` `^\s*(?:/\d?\s*)?(?:N\d+\s+)?(?<name>[A-Z_][A-Z0-9_]*):(?!=)`, `calls: true`, `header` `^%_N_\w+_(?:MPF|SPF)`, the keyword lists of §3.8, `maxLineLength` 512 **(verify)**.
- Addresses: `X` (diameter while the diameter mode is on), `Z`, `C`, `Y`; `angular` `C`; `speedLimitWords: ["LIMS"]`. **Diameter programming (`DIAMON`) is the default for this turning profile** (owner decision D35): `machineParams.diameter: "on"`; a program's `DIAMOF`/`DIAM90` switch it (`sets.diameter`), and a machine configuration can start from `off`.
- Tool change (turret, D35): every `T` word except `T0`, including `T="NAME"`, and **outside strings** (code patterns still see strings; a post writes `MSG("T1 ROUGH")`). Trigger `^(?:[^"]*"[^"]*")*[^"]*?(?<![A-Z_$])T(?:\s*=\s*"[^"]*"|(?!0+(?![\d.]))\d+(?![\d.]))`, tool `^(?:[^"]*"[^"]*")*[^"]*?(?<![A-Z_$])T(?:\s*=\s*)?(?<tool>\d+|"[^"]*")`, `same-line` (checked by Plan A in node and Python: `T="FACEMILL_D50"`, `T1`, `T0303` fire; `T0`, `TRAORI`, `STOPRE`, `$TC_DP1`, `MSG("T1 ROUGH")` do not). A milling user derives a profile with `extends: "sinumerik"` and an `M6` rule (documented).
- Program: header or `PROC name`; end `M30`, `M2`, `M17`, `RET`. Outline: whole-line comments (separator lines filtered), `MSG("…")` text, labels, `PROC`, calls (`L\d+`, `EXTCALL`, `CALL`, a name with arguments that is not a known cycle), cycles, stops, end.
- `modal.initial`: `plane G18`, `feedmode G95` (documented defaults; machine data decides, so a machine may override them, D35).
- `machineParams`: §8.8.

Database essentials:

| Codes | Group / flags | Label gist |
|---|---|---|
| G0–G3, CIP, CT | motion | rapid, feed, arcs (`CR=`, `AR=`, `I/J/K`), arc through a point, tangential arc |
| G4 | nonmodal, `fNotFeed` | dwell: `F` seconds or `S` revolutions |
| G9, G60, G64, G641, G642 | path mode | exact stop / continuous path variants |
| G17, G18, G19 | plane, `sets` | working planes (G18 for turning) |
| G25, G26 | nonmodal; G26 `speedLimit` | lower / upper spindle speed limit |
| G33, G331, G332 | motion, `pitchFeed` | thread cutting; rigid tapping in / out |
| G40, G41, G42 | compensation | radius compensation |
| G53, G153, SUPA | nonmodal | suppress offsets for one block |
| G54–G57, G500 | offset | settable work offsets / cancel |
| G70, G71, G700, G710 | units, `sets` | inch / mm — **not** Fanuc lathe cycles |
| G90, G91 | distance, `sets` | absolute / incremental |
| G93, G94, G95 | feedmode, `sets` | inverse time / per minute / per revolution |
| G96, G97 | spindlemode, `sets` | constant cutting speed (with `LIMS=`) / rpm |
| DIAMON, DIAMOF, DIAM90 | `diametermode` (modal), `sets.diameter` on / off / absolute-only | diameter programming on / off / absolute values only |
| CYCLE81–CYCLE83, CYCLE85–CYCLE89 | cycle, `cycle: start` (params by name) | drilling and boring |
| CYCLE84, CYCLE840 | cycle, `cycle: start`, `pitchFeed` | rigid / floating tapping |
| CYCLE95, CYCLE93, CYCLE97, CYCLE99 | cycle (`verify`; 97/99 `pitchFeed`) | stock removal, groove, thread — recognized, parameters later |
| MCALL | cycle | modal cycle call; `MCALL` alone cancels (the interpreter tracks the cycle's own block only; P3) |
| TRANSMIT, TRACYL, TRAFOOF, SOFT, BRISK, STOPRE | nonmodal | transformations, acceleration mode, look-ahead stop |
| M0–M5, M8, M9, M17, M19, M30 | as usual | `M17` ends a subprogram |
| GOTOF, GOTOB, GOTO, IF, ENDIF, WHILE, ENDWHILE, FOR, ENDFOR, LOOP, ENDLOOP, RET, PROC, DEF, EXTERN, CALL, EXTCALL | program / macro | control flow and calls |

Addresses: `CR` arc radius, `AR` opening angle, `D` cutting edge, `LIMS` clamp, `SF` thread start angle, `T` number or name.

### 8.6 Templates (Phase 3, P3.6)

| Database | Templates (`toolbar: true` in bold) |
|---|---|
| `fanuc` (mill) | **Program start** (`%`, `O`, safe-start line, work offset), **Tool change** (`T`, `M6`, `G43 H`, `S`/`M3`, coolant), **Drilling** `G81`/`G83` with `G98`/`G99` and `G80`, tapping `G84` with the pitch-feed hint, safe retract, **Program end** |
| `fanuc-lathe` (A) | **Program start** (`G21 G40 G99`, `G28 U0 W0`), **Tool start** (`G50 S` clamp, `T` with comment, `G96 S` + direction, approach, coolant), **Rough and finish** (`G71` + `G70`, P/Q from `{{N}}`), **Threading `G76`** (two blocks), face drilling `G83` + `G80`, tool end (`G00 X Z T..00`, coolant off), **Program end** |
| `fanuc-lathe-b` (variant database) | the A set with `G95`, `G92 S` and `G33` where B differs (only the differing templates are overridden, AD-17); a system-B document sees them because its effective database is the variant |
| `heidenhain` | **Program frame** (`BEGIN PGM`, `BLK FORM`, `END PGM`), **Tool call**, **Drilling** (`CYCL DEF 200` + `CYCL CALL`), `L`/`CC`/`C` moves, stop |
| `okuma` | **Header** (`$NAME.MIN%`, `O…`, `G50 S`), **Tool start** (approach, `T`, `G96 S M03`, `M08`), centre drill `G74`, thread `G71`, live-tool drilling (`M110`, `SB=` + `M13`, `G181`, `G180`, `M12`, `M109`), **Program end** |
| `sinumerik` | **Header** (`G18 G90 G95 DIAMON`), **Tool change** (`T="…"`, `D1`, `G96 S… LIMS=… M4`), drilling `MCALL CYCLE83(…)` … `MCALL`, **Program end** |

Every parameter has a sensible default, `required` where the control needs it, ranges (a depth `max: 0`, a feed `min: 0`, a station an integer 1–99), and the number style of the dialect (`min1` decimals on Fanuc). Each template has a golden in `tests/fixtures/templates/<db>/<id>.json` (values → expected text).

### 8.7 The NC-correctness review (gate G10)

1. **Input:** the resolved JSON (`tests/fixtures/resolved/**`), the syntax notes, the fixtures and their goldens, the script diffs, and the intake findings (§9.2).
2. **Reviewer:** an agent that did not write the content.
3. **Per database entry:** the meaning matches the cited section of the notes; `group`, `modal`, `pitchFeed`, `sets`, `fNotFeed` agree with it (tapping and threading only for `pitchFeed`; one-shot cycles not `modal`; every modal group name from §7.2); the text is our own wording and short; a fact the notes mark **(verify)** carries `verify: true` or has a recorded owner confirmation; no machine-builder codes in a built-in.
4. **Per profile:** every pattern has at least one positive and one negative fixture line; the detection margin is ≥ 3 on every fixture, printed; the tool rule (trigger, `ignore`, `tool` group) is checked against the notes' tool-change section; every reference rule says whether it rewrites.
5. **Per script change:** every edge case of `nc-transformations.md` for that script maps to a test, and every "never scale" rule has a golden.
5a. **Per machine-parameter declaration** (§8.8): every preset and default is labelled as a default and cites its source or carries `verify: true`; each preset's `mode` per class is checked against the manual it comes from (a control whose unit parameter scales numbers **with** a point is `scale`, never `increment`); the default preset agrees with the profile's `syntax.decimalPointSignificant` (`true` only for an `increment` length class); each variant's detection margin is ≥ 3 on every fixture where it is `detected` (printed, with the presence scoring of WP6.1); overlays touch only `modal`, `toolCall`, `numbering`, `addresses`; the effective profile of every preset and variant (`tests/fixtures/resolved/effective/**`) is read; the parameter units of §8.2 are complete for every cycle the database defines; the number rules (`numbers.json`) agree with F52 and the per-class tables.
5b. **Per channel work** (M12, §8.9): **no built-in profile declares a sync preset** (the reviewer greps `machineParams.channels` in `tests/fixtures/resolved/profiles/**` and expects nothing); every fixture is synthetic and its channel and sync patterns are written for gEdit, never copied from a machine or a builder's manual (F61); the check's claims are read against what it computes — written ids and written order only, sequences and not sets, the jump rule as *targets and backward jumps* rather than labels, `blocking: false` never checked — and the user text says the same in the same words (`docs/user/channels.md`); **each of the three `SyncSemantics` kinds is checked against the mechanism it claims to model** (the reviewer reads the `count` rule against the "same number on both sides" rule and the `ordered` rule against the "smaller number first, both sides need not carry the same numbers" rule, and confirms that neither can emit `missing` or `unmatched`); every sync rule of every fixture machine has at least one positive and one negative line; a mark inside a comment is in the negative set; a correct program that repeats an id in both channels is in the clean set.
6. **Output:** `SP/review/<wp>.md` with *accepted*, *changed* and *needs owner*; the integration agent applies *changed*; the review table goes into the milestone commit body. *Needs owner* items go to §13 and never into hover; they block the milestone only when they decide a default behavior (for example, which code is per-revolution). A machine-dependent default never blocks: it ships as a documented default the machine configuration can override.

### 8.8 Machine parameters per profile (the defaults "none" assumes)

Every value here is a **documented default, not a fact** about the owner's machines (§8 header). "As written" = `calculator`: a number is read in mm, inch, degrees or seconds with or without a point. "In increments" = `increment`: only a number **without** a point is a count of increments. "Scaled" = `scale`: **every** number, with or without a point, is multiplied by the unit (Okuma). With no machine, a word the presets read differently gets no value at all (AD-31 "No machine, no guess"), so these defaults decide the wording gEdit shows, not the number it computes.

| Profile | `numberInput` presets (**default**) | `units` | `diameter` | `variants` | `modalGroups` | `modal.initial` (assumed) | Written by |
|---|---|---|---|---|---|---|---|
| `fanuc-gcode` (mill) | **`is-b`**: lengths **and angles and the dwell `X`** in increments (0.001 mm / 0.0001 in; angles 0.001°, dwell 0.001 s, verify — Fanuc's calculator-type switch covers mm, inch and seconds together, so a control that reads `X50` as 0.050 mm reads `G04 X2500` as 2.5 s), feed per minute as written (a 1 mm/min increment gives the same number) and feed per revolution as written (**verify:** with the calculator switch off a control may read it in increments); `is-c`: 0.0001 mm / 0.00001 in, 0.0001°, 0.0001 s, same classes; `calculator`: everything as written. Source: syntax-fanuc §3.2 (both readings occur; parameter-dependent). The default stays `is-b` because X10 pins every Phase 1 result to it. | mm (syntax-fanuc §4.2: the last state is kept, verify) | – | – | `feedmode`, `distance`, `plane` | `feedmode G94` | P6, WP6.2 review |
| `fanuc-lathe` | presets inherited from `fanuc-gcode`, **default `calculator`** (and `syntax.decimalPointSignificant: false`): the owner's 18i-T system-B manuals write `G0 X40 W–40` for 40 mm and `G4U2` for two seconds, which is calculator type throughout (**verify per machine**; §8.1, D56). The lathe profile is new in Phase 2, so no Phase 1 result depends on it. | inherited | **`on`** (X and U as diameters) | `gcodeSystem`: **A** (`fanuc-lathe`) / B (`fanuc-lathe-b`, overlay `feedmode G95`) | `feedmode`, `spindlemode`, `plane` | A: `G99`, `G97`, `G18`; B: `G95`, `G97`, `G18` | WP6.2 |
| `heidenhain-klartext` | none declared: values are mm or inch as written (`BEGIN PGM … MM`/`INCH`); no machine item | – | – | – | – | none | – |
| `okuma-osp` | The control's unit parameter (UNIT) **scales every number, with or without a decimal point** (F52, OSP-P200L §2-3), so all three presets give `decimalPointSignificant: false`. **`okuma-1mm`** (default, verify): `calculator` — lengths 1 mm, feed per revolution 1 mm/rev, feed per minute 1 mm/min, angles 1°, time 1 s (inch system: 1 in). `okuma-1um`: `scale` — lengths 0.001 mm (inch 0.0001 in), feed per revolution 0.001 mm/rev (0.0001 in/rev), feed per minute 0.1 mm/min (0.01 in/min), angles 0.001°, time 0.01 s; so `X10000` is 10 mm and `F234.56` is 0.23456 mm/rev. `okuma-10um`: `scale` — lengths 0.01 mm, feed per revolution 0.01 mm/rev, feed per minute 1 mm/min, angles 0.01°, time 0.1 s; `X0.1` is 0.001 mm, `X1000` is 10 mm, `F23.456` is 0.23456 mm/rev (the control has no 10 µm inch system: inch is 1/10000 in or 1 in, so an inch value on this preset is **verify**). `S` is never converted | mm | **`on`** | – | `feedmode`, `distance`, `spindlemode` | `feedmode G95`, `distance G90` | P8 (skeleton), WP8.3 |
| `sinumerik` | **`calculator`**: as written (syntax-sinumerik §3.3, verify); `is-b`, `is-c` offered for machines set up that way, labelled "not described in the notes" (D54). Because the three presets disagree on a point-less word, such a word has no value until a machine is chosen (AD-31); a Siemens post that writes `X50` therefore needs one machine set up once, and the status item says so | mm | **`on`** (`DIAMON` default for turning, owner decision D35) | – | `feedmode`, `plane`, `distance`, `spindlemode` | `plane G18`, `feedmode G95` | P8 (skeleton), WP8.5 |

What a machine can change that is **not** in this table: nothing, except the `channels` block of §8.9, which is the user's own and which no profile enumerates. A new parameter, a new preset or a new variant is a data change to this table and the profile JSON, reviewed by G10; no consumer names a profile.

### 8.9 Channels and sync marks: what ships, and what does not (M12, AD-32)

**gEdit ships no sync code set** (owner decision D58; the roadmap's "Not planned" list, F61). Every built-in profile's `machineParams.channels` is **absent** in Phase 2, which means: a machine of any profile that has `machineParams` may be given channels by hand, and none is given any by gEdit. The reason is not laziness but honesty — the syntax notes leave multi-channel coordination out on all three of the owner's controls (F61), so there is nothing verified to ship, and what a particular machine uses depends on its builder as much as on its control.

| Profile | `channels` preset shipped | What the notes say | What a user writes themselves |
|---|---|---|---|
| `fanuc-gcode` (mill) | none | "Multi-channel synchronization" is under *Deliberately excluded* (`syntax-fanuc.md:32`) | everything: the layout, the section or file-name pattern, and the wait rule |
| `fanuc-lathe` | none | as above; a twin-turret 31i is the owner's machine, and its wait codes are builder M-codes ("the same M-number means different things on different machines", `syntax-fanuc.md` §1) | as above |
| `okuma-osp` | none | "Two-turret synchronization: `G13`/`G14`, `P` sync codes, `M100`" and the address `P` = "Synchronization code between turrets" are **tokenized only** (`syntax-okuma.md:34, 301`) | **two rules, two kinds.** `G13`/`G14` are the *section* starts, declared as channel **aliases** so one `sectionStart` pattern serves them and so a turret may open a section as often as the program needs. The `P` codes are an **`ordered`** rule (a `prefix` on `P`): the OSP manual makes them an execution ordering, smaller number first, and its own correct example pairs P10/P20/P40 against P10/P30/P40, so a `rendezvous` rule would report two false "missing" findings on it. `M100` is a **`count`** rule with no id: the manual's rule is that the same *number* of them must appear on both sides. Written as a `rendezvous` prefix rule instead, every `M100` would carry the same id and every one after the first would be a false finding. The fixtures show both |
| `sinumerik` | none | "multi-channel coordination (`WAITM`, `WAITE`, `SETM`)" is **tokenized only** (`syntax-sinumerik.md:39`) | a **`rendezvous`** `regex` rule with `mark` and `channels` captures for `WAITM`, whose channel arguments are symbolic in real posts and are therefore matched through channel **aliases**. `WAITE` carries channel arguments but, on the notes' reading, no mark number; a machine that uses it declares it as a **`count`** rule until the owner's own programs settle it (D64). The fixtures show one of each |
| `heidenhain-klartext` | not possible | – | the profile has no `machineParams` at all, so it has no machine item and no channels |

**When a preset may be added** (a later phase or a later Phase 2 revision, D64): once the owner's real programs are in the local folder (§9.2) and G11 has run on them, a preset per control may be written **from what the owner's programs actually contain**, labelled a default with its source like every other machine parameter (§8 header), carrying `verify: true` until the owner confirms it. It is data, a row in this table and a `machineParams.channels.presets` entry, reviewed by G10. No consumer changes.

**What a machine may never express:** an execution model. The channel block says where the channels are and which lines are waits. It says nothing about what a wait does, how long it takes, or what the other channel is allowed to do meanwhile — and neither does the check (AD-32, D60). The user guide says this in the same words (WP12.7).

---

## 9. Fixtures

### 9.1 Synthetic fixtures (written for gEdit, `-text`, provenance in `tests/fixtures/README.md`)

| M | Folder | Files |
|---|---|---|
| M6 | `nc/fanuc-lathe/` | `l01-turning-a.nc` (CRLF; `%`, `O2001 (PIN D30)`, `G21 G40 G99`, `G28 U0 W0`, `T0101 (OD ROUGH)`, `G50 S2500`, `G96 S220 M03`, `G71` two blocks, `N100…N200` profile, `G70 P100 Q200`, `G00 X100. Z100. T0100`, `T0303 (THREAD)`, `G97 S1200`, `G76` two blocks, a `G92` pass list, one `G32` pass, `T0505 (DRILL)` with `G83` and `C`, `G80`, `M30`, `%`); `l02-packed.nc` (`N10T0101M8`, `T101`, `T1`, `T0111`, lower case); `l03-multi-program.nc` (main with `M98 P2002`, sub with `G71 P/Q` and `M99`); `l04-references.nc` (`GOTO`, `M98 Q`, `M98 P… Q…`, `M99 P`, a duplicate and a missing target); `l05-system-b.nc` (`G95`, `G92 S`, `G77`/`G78`, `G33`); `l06-decimal.nc` (point-less `X50`, `Z1000`, `F155`, `G83 … Q6000 K3`, `C90000`, `G4 X1.5` and `G4 P500`, next to the same values with points); `l07-system-b-drill.nc` (six `G99 G83 …` cycle-return blocks and one `G92 S`, the variant-scoring case of WP6.2); `O2001` (no extension); `detect-lathe.txt` |
| M6 | `nc/ambiguous/` | `mill-4digit-t.nc` (a mill with `T1001 M6`, which stays mill) |
| M6 | `machines/` | `numbers.json` (the WP6.9 golden set); `files/{valid,broken,newer-version,invalid-record}.json` (WP6.8) |
| M6 | `modal/`, `scripts/*`, `transforms/renumber/*` | the goldens of WP6.3, WP6.4, WP6.6 (run with and without a `machine` member) |
| M8 | `nc/okuma/`, `nc/sinumerik/` | `o01-flange.MIN` (4- and 6-digit `T`, `G50 S`, `G96`, `G74`), `o02-thread.MIN` (`G71` thread, `G33` passes), `o03-live-tool.MIN` (`M110`, `SB=` with `M13`, `G181`/`G180`, `M109`), `o04-sub.SUB` (`O1234 … RTS`, `CALL` with variables, `IF`/`GOTO`, a LAP `G85 NLAP1`); `s01-shaft.MPF` (`%_N_SHAFT_MPF`, `;$PATH=`, `G18 DIAMON`, `T="ROUGH" D1`, `G96 S200 LIMS=3000 M4`, `CYCLE95` recognized only, a `G33` thread), `s02-drill.MPF` (`MCALL CYCLE83(…)` … `MCALL`, `CYCLE84`), `s03-sub.SPF` (`PROC`, labels, `GOTOF`, `R` parameters, `MSG`); detection files without extension |
| M9 | `nc/sinumerik-mill/`, `nc/fanuc-lathe/`, `tokens/`, `machines/`, `modal/heidenhain-klartext/`, `expected/owner-public/` | milling `.MPF` programs with preselects, `CYCLE800` and `CYCLE832` (WP9.1); a synthetic Y-axis lathe with five-digit `T` words and a tie program of numbered blocks and `G96`/`G97` only (WP9.6); one token golden per R4 case (WP9.3); the number-class cases in `numbers.json` and the Klartext defined-cycle goldens (WP9.5); `known-gaps.json` (WP9.6) |
| M10 | `scripts/{program_checks,extents,address_arithmetic}/`, `transforms/block-skip/` | findings and table goldens; the address-arithmetic edge cases, R8's tool-axis role and refusals included |
| M11 | `compare/` | normalization pairs |
| M12 | `nc/channels/fanuc-lathe/` | `c01-twin-single.nc` (one file, two sections: `%`, `O2101 (CHANNEL 1)` … `M99`, `O2102 (CHANNEL 2)` … `M30`, lines above both, each section with its own tools and a run of `M130`/`M131`/`M132` waits — the `M1` + two digits prefix rule — that all match); `c02-mismatch-single.nc` (the same shape, run with a machine whose rule reads the partners **from the line** (`M1\d\d P<channels>`), with one id whose ordinal partner is missing in channel 2, one id whose counts differ between the channels, one pair swapped, one mark that names a third channel the machine does not have, and one wait with no counterpart; rewritten in the real shapes, digit `P` words included, if R5 is accepted); `c03-jump.nc` (a **targeted** label and a backward `GOTO` between two waits, so the order of exactly that pair is *not checked*, next to a plain label between two other waits, whose order **is** checked); `c04-comments.nc` (a wait written inside a comment and one inside a string, neither a mark); `c05-one-channel.nc` (the same machine, a program with no section at all → `layout: 'none'`); **`c10-alternating.nc`** (four sections, `1`/`2`/`1`/`2`, each channel with two ranges and tools in both, plus a shared subprogram after a `sectionEnd` that lands in `outside`); **`c11-repeat-ids.nc`** (the shape of a real two-channel program: a label on **every** wait line, one id twice and another three times in **both** channels, same counts, same order — the clean case that a set-based check would have reported eight times) |
| M12 | `nc/channels/fanuc-lathe/` (multi-file) | `c06-part_CH1.nc` / `c06-part_CH2.nc` (a matching pair), `c07-part_CH1.nc` (its `_CH2` deliberately absent), `c08-marker_A.nc` / `c08-marker_B.nc` (the channel written in the header, so the `marker` pattern wins over the file name), `c09-notachannel.nc` (a base name that matches no pattern, tied to a channel by `channels.assign` in the WP12.5 test), **`c12-main.nc` / `c12-main_GS.nc`** (a main program and a counter-spindle program: no shared channel token in the names, so the set is expressed with **per-channel `list[].fileName` templates**) |
| M12 | `nc/channels/okuma/`, `nc/channels/sinumerik/` | `o10-two-turret.MIN` (**alternating** turret sections, `G13`/`G14` declared as channel **aliases**, plus the two Okuma mechanisms: an **`ordered`** `prefix` rule on `P` whose numbers deliberately do not all appear on both sides — the clean case — and a **`count`** rule with no id for the wait M-code, one fixture with equal counts (clean) and one with unequal counts (one finding)); `s11-two-channel_1.MPF` / `s11-two-channel_2.MPF` (a **`rendezvous`** `regex` rule whose `mark` and `channels` captures read a `WAITM`-shaped line and whose partner tokens are symbolic, resolved through aliases; the patterns are written for gEdit, not taken from a manual, §8.9) |
| M12 | `channels/` | `resolve/**` and `check/**` (the §7.17 golden format: sections, marks and findings per case, each with its `machine` block); `machines/files/channels-{valid,bad-pattern,unknown-channel,custom}.json` (WP12.3) |
| M12 | `scripts/tool_list/channels/` | the per-channel tool list: a two-section run (channel column) and a multi-file run (the summary naming the channel) |
| M13 | `exit2/` | the exit programs (X1, X2, X5, X6, X8, X9, X11, X12; `decimal-lathe.nc` with point-less words for X11; `twin-single.nc` — four alternating sections, a shared subprogram between two of them, and ids that legitimately repeat in both channels — run under the two machines "Twin 31i" (`all` partners) and "Twin 31i lines" (`line` partners) for X12 a and a2, and the pair `twin_CH1.nc` / `twin_CH2.nc` for X12 b) with `expected/` bytes per machine case |
| Phase 3 | `templates/` | template renders (P3.6) |

### 9.2 The owner's programs: local by default (FX)

**Owner decision (D45): real programs stay local.** The repository is public; the owner's own programs are never committed, pushed or shown to CI. The owner will hand over separately a few programs that are safe to publish. Everything real-program related therefore works from a **gitignored local folder** and skips cleanly without it. P6 creates the infrastructure (§6 P6 item 13); FX owns it afterwards.

**Two sets, never mixed:**

| | Local programs | Owner-public programs |
|---|---|---|
| Where | the folder named by `GEDIT_REAL_FIXTURES`, else `tests/real/` **of the main working tree** (`<git rev-parse --git-common-dir>/../tests/real`, gitignored except `README.md`) — a gitignored folder does not exist in a `SP/wt/<wp>` worktree, so a worktree run must look there and report "not found" rather than "no programs" | `tests/fixtures/nc/owner-public/<profileId>/` (committed) |
| What goes there | any program the owner wants checked, unchanged | only files the owner explicitly hands over as public |
| Manifest and goldens | `manifest.json` in that folder, and any golden derived from a local program: **local too** (they can reveal comments, tool names, part numbers). No snapshot API in the local tests (standing rule 12): a vitest snapshot would write program text into a committed `.snap` file or into the test file itself | the usual detection, outline and token goldens, committed like any fixture |
| Who runs it | G11 on the owner's machine only | every test run and CI |
| Marker | none | none; `tests/unit/fixtures.test.ts` exempts this folder from the `WRITTEN FOR GEDIT` marker but requires a line in `tests/fixtures/README.md`: control, a generic CAM description, the hand-over date, "published with the owner's permission" (F51) |

**Local intake and G11:**
1. **Drop.** The owner copies programs into `tests/real/<control>/` (`fanuc-lathe/`, `okuma/`, `sinumerik/`, `heidenhain/`) or points `GEDIT_REAL_FIXTURES` at a folder elsewhere. `manifest.json` gives each file's expected profile, optionally its tool stations, an allow-list of expected `unknown` tokens, and the **machine** to run it with (inline partial `MachineParams`, or a machine id from a copy of the owner's `machines.json` placed next to the manifest; the tests never read the app's config folder), so G11 checks the programs the way the owner's machines read them. From M12 a manifest entry may also name a **channel set**: for a `single-file` program the expected channels and their line counts, for a `multi-file` one the other files of the set, plus the expected sync ids per channel. G11 then adds the channel checks (resolution equals the manifest, the wait-code check returns no finding on a program that ran on the machine, and a program the owner knows was wrong returns the finding they expect). Counts only, never a file name, a channel name or a mark as written (standing rule 12).
2. **Smoke (G11; a real, manifest-driven test from M9, WP9.6):** detection = manifest (profile, and the variant when no machine is named); no `unknown` token outside comments except the allow-list; outline stations = manifest; `tool_list` = outline; a byte-exact round trip; scale feed and scale speed at 100 % byte-identical; no crash; from Phase 3 (P3.1) on, TS and Python modal states equal on **every** line under the manifest's machine. Output: counts and pass/fail per check; a failure names the manifest index and the line number, never a file name or program text (standing rule 12). The commit body records "G11: n local programs, all pass", "G11 skipped: no programs in the local folder" or "G11 skipped: no local folder found" and which folder source was used (`GEDIT_REAL_FIXTURES` or the main working tree), never its path.
3. **Findings** from a local program become owner-visible notes (in `SP`, never in the repo) and content fixes in the next content WP, each proven by a **synthetic** reproduction written for gEdit, never by a copy or an excerpt. Where a real program contradicts the syntax notes, the content WP corrects the notes in the same milestone (it then also owns the relevant `docs/planning/syntax/*.md`), in general terms.

**Owner-public intake** (whenever the owner hands files over):
1. `node tests/gen/check-anonymized.mjs <files>` lists candidates for the owner's second look: comments with names, customers or part numbers, dates, paths, e-mail addresses and telephone numbers, non-ASCII names, `$…%` / `%_N_…` headers. Codes, numbers, spacing, encoding, line endings and a NUL leader stay byte-exact; gEdit never rewrites the files itself.
2. Only after the owner confirms, the files are copied byte-exact to `tests/fixtures/nc/owner-public/<profileId>/` with their README lines, detection and outline goldens; goldens derived from them carry `"ownerReviewed": false` until the owner confirms them.
3. The committed exit criteria never depend on these files (they stay on the synthetic `exit2/` set), so a later withdrawal of a public file costs a golden, not a gate.

**FX owns:** `tests/real/README.md`, the `.gitignore` entries, `tests/fixtures/nc/owner-public/**` and its goldens, `tests/unit/realFixtures.test.ts`, `tests/python/test_real_fixtures.py`, `tests/gen/check-anonymized.mjs`, and the owner-public exemption in `tests/unit/fixtures.test.ts`.

---

## 10. Owner decisions (defaults in bold; the plan runs with the defaults unless the owner changes them)

§10.1 records what the owner decided on 2026-09-22. §10.2 still needs their answer; the plan runs with the defaults meanwhile. §10.3 are defaults they can simply accept, the new ones of this revision included.

### 10.1 Decided by the owner (2026-09-22)

| # | Question | Decision | Where it lands |
|---|---|---|---|
| D23 | G-code system of the Fanuc lathes (A or B)? | **It depends on the machine's setting**, so it is a machine parameter: one `fanuc-lathe` profile with the `gcodeSystem` variant A/B (databases `fanuc-lathe` / `fanuc-lathe-b`), chosen per machine configuration from a dropdown; without a machine it is detected from content, a tie reads as A. The separate `fanuc-lathe-b` profile is dropped. The `T`-word part of the old question stays open as D49. | AD-18, AD-31, §8.1, §8.8; M6 |
| D24 | The lathes' power-on/reset state (feed mode, CSS, plane)? | **Machine-dependent**: a machine configuration sets it per modal group; the profile values (A: `G99`, `G97`, `G18`; B: `G95`, `G97`, `G18`) are documented defaults, shown as assumed with their source. | AD-19 rule 8, AD-31, §8.8; M6 |
| D34 | Okuma: are numbers without a decimal point mm or µm? | **It depends on the machine's unit setting, for Okuma and for Fanuc alike** (and in principle any control): gEdit must not hardcode it but offer it as a setting, per machine configuration, selectable from a dropdown. Presets per profile (IS-B, IS-C, calculator; Okuma 1 mm / 1 µm / 10 µm, per address class); "none" assumes the documented default of §8.8 and says so. | AD-31, §7.15, §8.8; M6 (Fanuc), M8 (Okuma) |
| D35 | Sinumerik turning: `DIAMON` by default? | **`DIAMON` is the default for the turning profile** (`machineParams.diameter: "on"`); a machine may start from `off`, the program's `DIAMOF`/`DIAM90` switch it. Both `T` forms and the assumed `G95` stay as proposed (not contradicted). | §8.5, §8.8; M8 |
| D58 | Multi-channel: where do the channel definition and the sync marks live? | **In the machine configuration, and user-definable.** How a machine's channels are laid out depends on the machine's configuration exactly as the number reading does: the channels may be **sections of one file** or **one file per channel**. The channel list, the layout with its patterns **and** the synchronization marks (wait codes) are therefore machine parameters that the user writes themselves (AD-32, §7.17). **gEdit ships no machine-builder-specific sync code set**, and in Phase 2 no preset at all (§8.9); presets may follow when the owner's real programs are in (D64). Multi-channel becomes milestone **M10** [M12 since 2026-09-30] (D63), staged: the model, the check, the per-channel views and the navigation now; the side-by-side view in Phase 3 [Phase 4 since 2026-09-30] (D61). | AD-32, §7.15, §7.17, §8.9, §11 item 27; M10 [M12] |
| D45 | Real programs as fixtures: publish or local? | **Real programs stay local**: never committed or published. Intake, G11 and the parity checks work from the gitignored `tests/real/` (or `GEDIT_REAL_FIXTURES`) and skip without it; the committed fixtures are synthetic plus the few programs the owner hands over separately as safe to publish. | §4 rule 12, §9.2; P6, FX |

**Decided by the owner (2026-09-27)**, after the [source review](source-review-2026-09.md) and its run over the owner's example programs:

| # | Question | Decision | Where it lands |
|---|---|---|---|
| — | Tapping speed (§9's pending decision, reopened with evidence) | **Refuse to scale the speed of a tapping block, and report it**: `scale_speed`'s `tap_speeds` pre-pass identifies every tapping block (a tapping code, a modal tapping cycle or mode in force, a modal call of a tapping cycle while it repeats, a DEF-active Klartext cycle while its `CYCL CALL` family runs it) and leaves its speed and the speed in force when it runs, of whichever spindle, as written; both are counted and reported ("N tapping speeds left as written"). Threading keeps the existing scale-and-warn behaviour, because it is not a tap in the database's own reading. | `CodeEntry.tapping`, `scale_speed.py`; §7.16 rows below; `dec/scaling` |
| — | The owner's published example programs | **Merged without the four large 5-axis files; the machine builder's name in the Siemens `CYCLE800` string stays** (the owner reviewed it and it names no one outside the shop). `tests/fixtures/nc/owner-public/**`, `ownerReviewed` still `false` until read over. | §9.2; `dec/int` (carried from `batch/int`) |
| — | The `T`-word format of the Fanuc lathe posts, five-digit case (part of D49, §10.2) | **A five-digit `T` word is a 3-digit tool plus a 2-digit offset** (`T12345` = tool 123, offset 45) — the existing profile rule (4 digits = 2+2, 3 digits = 1+2, 1–2 digits = station only) extended by one digit, implemented generically in `fanuc-lathe.json`'s `toolCall` pattern, not as a special case. Still **no machine parameter** in Phase 2; a sixth digit satisfies no combination and stays unrecognized, per the NC-correctness rule of leaving what no rule reads alone. D49's short-word (1–2-digit) question is still open, §10.2. | `fanuc-lathe.json`; `dec/tools` |
| — | The Sinumerik main spindle | **A plain `S` while the master spindle is the main spindle (the default, `SETMS`, or `SETMS(1)`), and `S1=`/`S[1]=`, are the main spindle's speed** (the owner confirmed `S1=` as the main spindle on 2026-09-27). Implemented as the profile default `addresses.mainSpindle: "1"` — a profile default, not a machine parameter (a variant would add a Machines-page selector for a choice nobody has asked for yet; it can become one later, data only). `S2=`, `S[n≠1]=` and a plain `S` after `SETMS(n≠1)` stay other spindles, reported and left unless "Also scale other spindles" is on. Okuma's `G141` (spindle select) is left as it is: a plain `S` after it still scales as the main spindle's, because `G141` is not a spindle-choice call the way `SETMS` is, and whether the sub spindle's plain `S` should count as another spindle needs the owner (open, TODO). | `sinumerik.json` `addresses.mainSpindle`, profile `types.ts`/`validate.ts`; §7.16 rows below; `dec/scaling` |
| — | Roadmap R1 (detection that cannot wreck a program) | **Accepted and implemented now** (`dec/detect`, folded into `dec/int`): decisive headers, Siemens-only and Okuma machining-centre markers, the contradiction guard on Remove Comments, Renumber, Remove Block Numbers, Insert/Remove Spaces, Convert Case and replacing scripts. See §7.16 and §10.1 above for the contract. | §7.16, this §10.1; `dec/detect` |
| — | Roadmap R2 (a built-in Sinumerik milling profile) | **Accepted, into the M9 prelude**: the `sinumerik-mill` profile and about 20 database entries, as the source review §5 R2 sizes it; mill-turn (`DIAMON`, `LIMS`, `SETMS`, `TRANSMIT`) stays with the turning profile. See [§6 M9](#m9-real-programs-read-right). | M9 prelude (P9); WP9.1 since 2026-09-30 |
| — | Roadmap R3 (5-axis and high-speed codes, and words that are data) | **Accepted, into the M9 prelude**: entries for what CAM writes on every 5-axis and 3+2 file across all four milling dialects, plus two database flags — the axis words of a block are data, and a code opens or closes a frame — read by WP9.5 and, later, WP11.4 [WP10.3 and WP10.4 since 2026-09-30] instead of hard-coded `G53`/`G28` lists. See [§6 M9](#m9-real-programs-read-right). | M9 prelude (P9) and WP9.2; read by WP10.3 and WP10.4 (renumbered 2026-09-30) |
| — | Roadmap R4 (read the numbers and names real programs write, before M9), remaining parts | **Accepted, into the M9 prelude**: tokenizer rules in TS and Python on shared goldens, one golden per case, for the Fanuc macro function and print names, the Okuma two-letter `=` words and four-digit option M codes, the Sinumerik `:123` main block and call-rule exclusions, and the Klartext `TIP-TIP`/`PLANE` words. The Klartext decimal comma and Fanuc program names were already done ahead of M9 (`dec/klartext`, `dec/names`). | M9 prelude (P9); WP9.3 since 2026-09-30 |
| — | Roadmap R6 (machine parameters the manuals show are per machine), smallest useful version | **Accepted, into the M9 prelude**: a Fanuc lathe `U`/`W`/`V`/`H`-incremental choice and a tool-word variant for the `T` split (Fanuc offset digits, Okuma 200-and-up offsets), both as variants and overlays of the existing machine parameters (AD-31), no new consumer. The rest of R6 (extra axis letters, an IS-A preset, the ×10 option, the point-less feed-per-revolution unit) stays with plan §11 #26. | M9 prelude (P9) and WP9.4 since 2026-09-30; extents (WP10.3) read `U`/`W`; §11 #26 |
| — | Roadmap R7 (the program checks the manuals make certain) | **Accepted, into WP9.4** [WP10.2 since 2026-09-30]: data-driven checks per dialect as [source-review-2026-09.md §5 R7](source-review-2026-09.md#r7-the-program-checks-the-manuals-make-certain) lists them; the planned Okuma "`T` not 4 or 6 digits" error is dropped, since it would flag every machining-centre program and every lathe with 200 or more offsets. | WP10.2 (was WP9.4) |
| — | Roadmap R5, R8, R9, and R10 beyond tapping | **Still proposed — owner to decide** on 2026-09-27; since then **R5 and R8 are accepted (2026-10-01, below)**, while R9 and the rest of R10 stay open (§10.2). R10's tapping part is done above and R3, R4's remaining parts, R6 and R7 are accepted above. See [TODO.md](../../TODO.md) and [source-review-2026-09.md §5](source-review-2026-09.md#5-roadmap-proposals). | — |

**Decided by the owner (2026-10-01)** ("The decisions as you recommended"), on the four proposals the re-cut of 2026-09-30 and the source review left open:

| # | Question | Decision | Where it lands |
|---|---|---|---|
| D69 | The re-cut of the roadmap (the third revision at the top of this plan) | **Accepted**: M9 "Real programs read right" first; address arithmetic with the checks and the extents (M10); compare and search (M11); multi-channel (M12); user profiles, code files, typing options and the exit (M13); the inspector, hover with modal context, the TypeScript modal interpreter and the templates in a new Phase 3 "Understand and write", their designs kept (§6); the roadmap's old Phase 3 is Phase 4 "Comfort and geometry". | The whole plan; [roadmap](roadmap.md#phase-2-real-cam-output-safely-in-progress) |
| D70 | A release after each milestone | **Accepted, v0.2 first**: a new CI workflow builds the bundles for macOS, Windows and Linux on a version tag and attaches them to a **draft** GitHub release that the owner publishes every time; v0.2 = M6–M8 with the fixes, v0.3 = M9, v0.4 = M10, v0.5 = M11, v0.6 = M12, 1.0 = the Phase 2 exit; each with a short owner checklist. It replaces D48's "0.2.0 at the Phase 2 exit" and adds the landing of smaller batches to D44 (§5.2 rule 11). | §5.2 rule 11, §5.3 (W1 first); D44, D48 (§10.3) |
| R8 | Roadmap R8 (address arithmetic that knows where absolute positions hide), smallest version | **Accepted**: the parameter role "absolute position on the tool axis" on the drilling cycles, and "refuse and list" for every other cycle. | M10 prelude (P10) and WP10.4; §7.2 `CodeParam` |
| R5 | Roadmap R5 (the wait-code model the manuals describe) | **Accepted: `decode` (`split`, `digits`, `bitmask`) and `whenAbsent`**; the rest of R5 as data-only options. | M12 prelude (P12); §7.17 |
| — | R9 and the rest of R10 | **Still open** (§10.2). | — |

### 10.2 Still needs the owner

| # | Decision | Default | Needed by |
|---|---|---|---|
| D46 | W0: push `fix/windows-test-manifest` (`c18fba2`) and open a PR, then fast-forward `main` when Windows CI is green. The commit is already in `feat/phase-2` (§5.1); only the push and the CI confirmation wait for their OK. **It rides along:** `c18fba2` is the first commit of `feat/phase-2`, so the first milestone push (D44) publishes it whether or not D46 was answered. | **Push when they allow it; fast-forward, no rebase.** Phase 2 does not wait. Answer D46 before the M6 push if the fix should be reviewed on its own; the alternative is rebuilding `feat/phase-2` without it. | Before the M6 push (it travels with it), and before the Phase 2 exit (X10 needs green Windows CI) |
| D47 | The cut and deferred list (§2.1, §11). The two they may want back: **OS file associations** (double-click a `.nc` in Finder/Explorer) and the **in-app user guide**. A Sinumerik milling profile was cut too (§11 item 18); the source review's R2 brought it back and the owner accepted it (§10.1, 2026-09-27, into the M9 prelude; since 2026-09-30 WP9.1), so that part of D47 no longer applies. | **Accept the cuts.** Associations would add the single-instance plugin and a new M7 WP. | Before M7 |
| D49 | The `T`-word format of the Fanuc lathe posts (the rest of the old D23): always `T0101`/`T101`, or also short `T1`/`T12` (where the last digit could be an offset)? The five-digit case is answered (§10.1, 2026-09-27: `T12345` = tool 123, offset 45); what is still open is only the **short, 1–2-digit** word. | **The profile rule stays: 4 or 5 digits split as station + 2-digit offset, 3 digits as 1 + 2, 1–2 digits are the station on its own; no machine parameter in Phase 2.** If the owner's posts write short words with an offset, a `toolWord` variant (a `toolCall` overlay, data only) is added. | Before G10 of M6 |
| D64 | **Which wait codes the owner's machines actually use**, and whether each machine's post writes one file or one file per channel: the 31i twin-turret lathe, the Okuma OSP-P200L, the Sinumerik 840D turning centre. Now also, per wait code, **which of the three mechanisms it is** — a rendezvous with an id, an id-less wait matched by count, or an ordering code (§7.17 `SyncSemantics`) — and, for a multi-file post, whether the channel files share a name pattern at all. | **The plan does not wait for it.** Every pattern is the user's own (D58), the fixtures are synthetic, the milestone ships with **no preset** (§8.9), and the mechanisms are declared per rule so a machine whose codes are unknown today can be set up correctly tomorrow without a code change. A multi-file set that no pattern describes is tied together by hand ("Assign this document to channel N"), so even an unanswered D64 leaves the feature usable. When they answer — best of all by putting two real multi-channel programs into `tests/real/` (§9.2) — the answer becomes one preset per control, data only, reviewed by G10, plus one G11 case. Until then they write the patterns once per machine in the Channels step, with the tester to check them. | Not needed by any gate; wanted before the M12 G10 review, so the fixtures resemble the owner's posts |
| D65 | Should "Check wait codes" also run **while typing**, as editor markers? | **No in Phase 2:** it runs on the command, like the other checks. Live linting of check findings is a roadmap backlog row for all checks, not something to start with the most expensive one. | Before M12's WP12.5 |
| R9, R10 | R9 (an Okuma machining-centre profile) and the rest of R10 (the function feeds `M128 F`, `M140 F`, `PLANE F` and cycle 19's `F`; Klartext's Q-parameter feeds) | **Unchanged, open** (R5 and R8 were accepted on 2026-10-01, §10.1), as the source review places them: R9's profile when a programming manual of the machining-centre control arrives. | Not needed by any gate |

### 10.3 Defaults the owner can accept as they are

| # | Decision | Default |
|---|---|---|
| D25 | What is a turret tool change for F7 and the map | **Every `T` call with a non-zero station and a non-`00` offset, repeats and offset changes included (each CAM operation is a segment, as a repeated `T1 M6` is in P1); `T..00` is an offset cancel; the tool list groups by station.** Alternative: only a change of station. |
| D26 | `G70–G73 P/Q` references on the mill profile | **Removed there; the lathe profile has them** (`dialect-profiles.md`: on a mill `G73 Q` is a peck depth). |
| D27 | Dock → Quit, logout, shutdown on macOS with unsaved changes | **Cancel the termination and show gEdit's own prompt; a logout is interrupted.** Clean → quit at once. |
| D28 | Windows and Linux logoff/shutdown | **Not vetoable (F29); recovery covers it; the user guide says so.** |
| D29 | Backup on save | **`history` in the app data folder, 5 per file.** `sibling` (`name.ext.bak`) stays opt-in because DNC and CAM folders may pick up extra files. |
| D30 | Atomic document saves | **No: documents stay written in place (identity, ACLs on shares); the backup is the safety net.** |
| D31 | Crash recovery | **On; dirty and changed documents at most every 30 s and on blur/hide; restore bound to the original path when already allowed, otherwise untitled.** |
| D32 | Session restore | **On.** |
| D33 | Okuma and Sinumerik depth | **Turning only (OSP-P200L, 840D turning); mill variants through a user profile with `extends`.** |
| D36 | Feed/speed scaling on lathes | **"Auto": per-revolution feeds and constant surface speed are scaled on a lathe profile, skipped on a mill; clamps and thread leads are never scaled by default.** |
| D37 | Remove block numbers | **Keeps the numbers a reference points at** (on by default when the profile has references). |
| D38 | Milestone order | **M6 → M7 → M8 → M9 → M11 → M12; M8 and M9 swap if the owner has neither local Okuma/Sinumerik programs (for G11 on their machine) nor public ones by the end of M7.** A swap cannot simply move M9 forward: WP9.1, WP9.4 and WP9.5 contain Okuma and Sinumerik work that needs those profiles. **On a swap, those parts move into M8 as WP8.9** (Wave B, after WP8.3 and WP8.5), M9's gates and `m9-scripts` cover mill and lathe only, and X2/X8's turning half is proven by `m8-checks`. Without that split the swap is dropped. *Renumbered 2026-09-30:* the swap was never used (M8 ran first), and the third revision (D69) replaces this order with M9 → M13; WP9.1, WP9.4 and WP9.5 are now WP11.1, WP10.2 and WP10.3. |
| D39 | Inspector placement | **A tab in the left region, `Mod+Alt+A`.** (Phase 3 since 2026-09-30.) |
| D40 | Profile editor | **JSON in a tab, validation with JSON paths, "Test profile on this document", the Profiles settings page; no form editor.** |
| D41 | Compare numeric tolerance | **Cut**; number-format normalization instead. |
| D42 | OS file associations | **Deferred to P3** [Phase 4 since 2026-09-30] (single-instance plugin needs network; shared extensions; installers untestable here). See D47. |
| D43 | External commands | **Cut; the user guide shows how a script runs another program.** |
| D44 | Releasing | **Each milestone is squashed onto `feat/phase-2`; the owner fast-forwards `main` after checking it.** Proposed addition, 2026-09-30: a smaller self-contained batch lands the same way as soon as its gates pass, and each milestone is followed by a draft release (D70, §5.2 rule 11, §5.3). |
| D48 | Version | **0.2.0 at the Phase 2 exit** (`versions:check`). Proposed change, 2026-09-30 (D70): 0.2 for M6–M8, one minor version per milestone after it, and 1.0 at the Phase 2 exit. |
| D50 | Where machine configurations live | **`<config>/machines.json`**, Rust-owned, with its own `$version`, under the same rules as `settings.json` (atomic, 1 MiB, `.bak`, newer version read-only). Not in `settings.json`, whose keys are flat and default-diffed (F47). Editing it by hand while gEdit runs is supported: a save of that document reloads it (the P1 settings pattern), and while it cannot be read the Machines page only opens or replaces it, so a hand edit is never overwritten. |
| D51 | What reads the machine's number input | **Every consumer that needs a value**: scale-feed limits (M6), program checks, extents and address arithmetic (M10), hover and the inspector (Phase 3), user scripts through the context. Search word conditions compare the value **as written**; compare only follows the effective point-significance rule. |
| D52 | No machine, and machine vs detection | **"None" assumes the profile defaults of §8.8, marked as assumed with their source; the G-code system is detected from content. An explicit machine (chosen, remembered or the profile's default machine) always wins; a detected mismatch shows one warning and never switches. Picking a machine of another profile switches the document's profile.** |
| D53 | Folder → machine rules (a DNC folder per machine) | **Deferred**: a default machine per profile plus the per-file memory (M7) in Phase 2; a folder rule is a Phase 4 candidate (§11). |
| D54 | What the machine dialog offers | **The presets the profile declares** (Fanuc IS-B, IS-C, calculator; Okuma 1 mm, 1 µm, 10 µm; Sinumerik calculator plus IS-B/IS-C, flagged as not in the notes); per-class values and other increments only by editing `machines.json` ("Open machines file"). A machine stores the full values, so a later change of a preset never changes it. |
| D57 | What a feature does with a word whose reading depends on the machine while **no** machine is chosen | **Nothing: it is never converted with an assumed default.** Address arithmetic and the inspector skip it and say why, extents list it as "not resolved", scale feed scales it but compares no limit, review mode keeps two literals apart unless every declared preset reads them alike, and hover, the inspector and the program check list every reading with its preset (the assumed default first). A word every preset reads the same (a Fanuc word with a decimal point, a feed) keeps its value, and multiplying or dividing is unaffected. One machine per profile, set up once, removes the question. |
| D55 | Where local and public real programs go | **Local: `tests/real/` (gitignored) or `GEDIT_REAL_FIXTURES`; public: `tests/fixtures/nc/owner-public/<profileId>/`** with README provenance (§9.2). |
| D56 | The profile defaults themselves (§8.8): Fanuc **mill** IS-B with feeds as written and dwell in increments, Fanuc **lathe** calculator type (the owner's 18i-T manuals), Okuma 1 mm (and the 1 µm / 10 µm systems as `scale` readings), Sinumerik calculator, the power-on modes, `units` mm | **As in §8.8**, each labelled a default, each marked verify where the notes do not settle it. The mill default keeps every Phase 1 result unchanged (X10); the lathe, Okuma and Sinumerik profiles are new in Phase 2, so their defaults follow their own sources. They correct them per machine rather than globally, and nothing is converted from a default while no machine is chosen (D57). |
| D59 | Where the channel block lives, and its version | **In a machine's `params` in `machines.json`; `MACHINES_VERSION` stays 1.** The block is additive, the parser keeps unknown members verbatim, and no release shipped version 1 before the Phase 2 exit, so a bump would only stop an earlier development build from writing a file it can already round-trip. A record whose channel patterns do not compile is kept verbatim, reported and not selectable — which is what a version bump would otherwise have had to buy (§7.15). |
| D60 | What the wait-code check checks | **Written ids and written order between channels, compared as sequences and not as sets:** a count mismatch per id, a mark whose ordinal partner is missing, an order difference found by one linear diff, an id that decreases inside a channel (`ordered` rules only), a mark naming an unknown channel, a blocking wait with no counterpart, and a wait outside every channel. A repeated id is **normal**, not a finding — the first draft's "duplicated" would have fired eight times on the two-channel example in the owner's own manual — so it is gone. Each rule declares which of the three mechanisms it models (`rendezvous`, `count`, `ordered`, §7.17); a `count` rule compares numbers of marks and an `ordered` rule never reports "missing", because on those mechanisms both would be false findings on correct programs. **Only execution-blocking waits** count (a rule may be declared `blocking: false`; such marks are shown and never checked). Where a **jump target or a backward jump** lies between two ids the order of that pair is reported as **not checked** rather than judged — a label alone is not enough, because real wait lines carry their own labels. Findings are warnings; nothing is ever rewritten, and the user guide says in as many words that a clean result is not a proof. |
| D61 | The side-by-side channel view | **Phase 3** [Phase 4 since 2026-09-30] (§11 item 27). Monaco can align panes with view zones and lock their scrolling through public API (F55), but it cannot show one channel of one model: `setHiddenAreas` is private and **does nothing** on a model over 300,000 lines or over 20 MB (F54), and the only way back — `largeFileOptimizations: false` — trades it for tokenizing a file Monaco gives up on. That reason applies to long programs only; the three that carry the decision for every program are a **model per pane** with a two-way mapping into the document, the fact that this is the machinery of the Phase 3 [now Phase 4] rows "Split view" and "Aligned NC-aware diff with merge", and the two traps a second Monaco widget inherits (F56). Phase 2 ships sync-point navigation, the check and the per-channel map instead. |
| D62 | How gEdit learns that the other channel files exist | **One narrow Rust command** (`channel_siblings`) that stats names derived from an already-allowed path, in that path's own folder, and grants nothing (standing rule 14). The alternative — computing the names and letting the file dialog say what exists — needs no command but cannot tell the user "channel 2 is next to this file but not open", which is the state they are usually in. **gEdit never opens a file by itself** either way. |
| D66 | What a check does when the other channel is open under a **different machine** (or none) | **One machine decides:** the check applies the initiating document's effective machine to every channel and names the divergence in the report header, with "use this machine for channel 2". Silently mixing two machines' patterns would make the findings unreadable, and using the sibling's own machine would fill the report with "missing" whenever the sibling happened to open with the profile's default machine. |
| D67 | What a **broken channel pattern** costs | **The channels, not the machine.** The block is dropped to `layout: 'none'` and reported; the record stays selectable and its number reading, variant, units and power-on state stay in force. A typo in a pattern the user is trying out in the tester must not change how every number in every program of that machine is read (D57). Whole-record invalidation stays for the parameters that decide the number reading. |
| D68 | What "Split into channel documents" is | **A one-way copy for reading**, said in the command, the status message and the user guide. Each result carries the program's own header lines so it is a valid program rather than a fragment, is named after the source file plus the channel id, and the command is offered for `single-file` only. Merging edits back needs the two-way mapping of Phase 3 [now Phase 4] (§11 items 27, 28). |
| D63 | Where multi-channel goes in the order | **A milestone of its own, M10, after M9 and before the inspector**, which becomes M11; templates and the Phase 2 exit become M12. It needs M6 (the machine configuration and its page), M7 (the per-file choice, the session that brings two channel documents back), M8 (two of the owner's three multi-channel machines are Okuma and Sinumerik) and M9 (the Results conventions the check reuses); it sits after **both** M8 and M9 so the D38 swap cannot move it; and nothing after it depends on it, which is where the newest work belongs. *Renumbered 2026-09-30:* by the third revision (D69) this milestone is M12, after M10 (checks) and M11 (compare and search); the inspector moved to Phase 3 and templates with it, the user profiles and the exit to M13. |

---

## 11. Deferred or cut items (Phase 2 → Phase 3 or backlog)

**Phases after the third revision (2026-09-30).** This section's title keeps the old numbering, because other documents link to it. What helps understanding and writing — the inspector, hover with modal context, the TypeScript modal interpreter, the templates and what belongs to them — goes to the new **Phase 3, "Understand and write"**; every other deferral that said "Phase 3" now goes to **Phase 4, "Comfort and geometry"** (the roadmap's old Phase 3), and says so below.

1. Form-generated profile editor and live preview (D40): Phase 3, with the template manager UI.
2. Per-profile colors, `highlight` rules, the role-color editor: Phase 4.
3. Load and save formatting (`onLoad`, `onSave`, encoding conversion to ASCII/Latin-1): backlog.
4. Next/previous NC event: covered by find-all word queries; Phase 4 if asked for.
5. Bookmark names, the bookmark panel, "bookmark all matches": Phase 4.
6. Block-range dialog, insert file, append file; extract/delete a tool segment: Phase 4.
7. Bundled in-app user guide: cut (the guide is `docs/user`; the regex page is added there in M11).
8. Word-level compare marking: Phase 4, with the aligned diff.
9. Compare numeric tolerance: cut (D41).
10. External commands: cut (D43).
11. Split by tool, join programs, combined tool list, the script `documents: all-open | pick` (P1 D16): backlog / Phase 4.
12. Insert/remove text by rule, batch replace from a mapping file: backlog (good first contributed scripts).
13. Character cleanup with transliteration: cut; reporting is part of program checks (M10).
14. Renumber advanced options (fit to max, align column, every Nth, skip containing, first/last lines, start trigger): Phase 4.
15. `M99 P` rewriting (the target can be in the caller), `M98 P… Q…`, and cross-file references: Phase 4.
16. OS file associations and `RunEvent::Opened` (D42): Phase 4.
17. Settings search box; JSON Schema files for profiles, databases and settings: Phase 4.
18. Okuma milling (OSP-M), Sinumerik milling, and Fanuc lathe G-code system C (a third `gcodeSystem` choice with its own variant database): after sample programs exist.
19. `MCALL` modality in the modal interpreter: the cycle's own block only; Phase 3, with the TypeScript interpreter.
20. Vetoing a Windows logoff (a `WM_QUERYENDSESSION` subclass): only if a user asks.
21. Per-profile `tabWidth`, `rulers`, completion mode; hover delay and modifier modes; quick switcher in MRU order: Phase 4 or cut.
22. Formula template parameters, cycle forms, the template manager, "create template from selection": Phase 3, "Understand and write", with the templates (item 32).
23. Native menus on Windows/Linux and recent files in the native menu (P1 D9): still deferred.
24. NUL-heavy files opened read-only: stays refused.
25. The TypeScript modal index in a worker: not needed at the budgets of G7.
26. Machine configurations, later parameters (AD-31): folder → machine rules (D53); a `toolWord` variant for short lathe `T` words (D49); machine limits (top spindle speed, travel) used by program checks; per-block parameter units (`G76` `P`); editing per-class number input in the dialog instead of the file (D54): Phase 4 or when asked for. (R6's smallest version — the `U`/`W` choice and the tool-word variant — is in M9, WP9.4.)
27. **The side-by-side channel view** (AD-32, D61): channels in parallel **editable** panes, aligned at the sync marks with filler space, matched and unmatched marks marked differently, next/previous sync point inside the view, optional locked scrolling, and closing returns to the single view. **Phase 4** (Phase 3 before the third revision), for four reasons, each checked rather than assumed:
    - Monaco cannot show one channel of one model. `setHiddenAreas` is not in `editor.api.d.ts`, and on a model Monaco considers too large — **over 300,000 lines, or over 20 MB** — the view model is `ViewModelLinesFromModelAsIs`, whose `setHiddenAreas` returns `false` and does nothing (F54). The one escape hatch, `largeFileOptimizations: false` at model creation, buys `setHiddenAreas` back by making Monaco tokenize a file it deliberately gives up on; it was checked and rejected. The cheap version of this feature does not exist. (This reason alone would not settle the question — a program under both thresholds is the common case — but the three below carry the decision on their own.)
    - What is left is a **model per pane**: in `single-file` mode a model built from the section's lines plus a two-way mapping back into the document's model (edits applied as minimal edits so the document keeps one undo step; transforms, external reloads and the machine's own re-resolution re-project), and in `multi-file` mode one document per pane with its own dirty state and save. The multi-file half is much the cheaper of the two, but shipping only it would leave the owner's single-file machines without the feature, and both halves need the same groundwork.
    - That groundwork is **already Phase 4 twice over**: "Split view" (`editor-core.md`, two editor groups sharing one model) and "Aligned NC-aware diff with merge" (`file-compare.md`, "two synced editors ... view zones fill gaps so matching lines stay level"). Building it for channels inside Phase 2 pulls both rows forward under another name.
    - gEdit has one editor today, and a second widget is not free: the compare diff editor is the only other one, and its two traps — every editor option handed to a second widget lands in the **shared** standalone configuration service, and a `theme` option sets the global theme — apply to every further instance, as does one view model with one projection per line per pane (F56).
    Alignment and locked scrolling themselves need **no private API** (F55), so the Phase 4 work is the models and the mapping, not the rendering. Phase 2 ships what gives most of the value without an editor: the check, the per-channel map and tool list, the channel status item, and `channels.nextSyncPoint` / `gotoPartner` — lining two open channels up at a wait, which is what the owner does by hand today.
28. Multi-channel, the rest: a **combined tool list over several channel files** (it needs multi-document script input, P1 D16, item 11 above); **merging a split channel document back into its source** (the same two-way mapping as item 27, and the reason the split is documented as a one-way copy); channel-aware compare (compare the same channel of two re-posts) and channel-aware search scope; a sync **timeline** or Gantt-like view; writing the split channels to disk instead of to untitled documents; the check's findings as live editor markers while typing (D65, and a roadmap backlog row for every check, not just this one); a check that follows jumps instead of refusing to judge a pair spanned by one; **folder-aware sibling lookup** for posts that give both paths the same name in different folders (it would need a directory permission, which §4 forbids in Phase 2 — the hand assignment covers it instead); sync presets per control, which are data and arrive with the owner's programs (D64, §8.9).
29. **The TypeScript modal interpreter, index and service** (was WP11.1): Phase 3, P3.1, with its design in §6. The per-line TS/Python parity of G11 moves with it; Phase 2's scripts use the Python interpreter.
30. **The code inspector and edit value** (was WP11.2, AD-27, X7): Phase 3, P3.2.
31. **Hover with cycle parameters and modal context** (was WP11.3): Phase 3, P3.3. Phase 2's hover stays the Phase 1 hover of codes and addresses; the machine's effective values show in the program check, the extents and address arithmetic instead.
32. **Parametric templates** (was WP12.1–WP12.3, AD-28, the templates half of X9): Phase 3, P3.4–P3.6. The Insert tab keeps the Phase 1 blocks until then (D13 stays open), so the lathe, Okuma and Sinumerik profiles have no Insert-tab blocks in Phase 2 (F34). With them in Phase 3: cycle forms, formula parameters, the template manager and "create from selection" (item 22), and motion-mode line coloring from the modal interpreter.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The lathe content is wrong for the owner's machines (G-code system, reset modes, `T` format, builder codes) | G-code system and reset modes are machine parameters (D23, D24) with detection as the fallback; G10; `verify: true` keeps uncertain text out of hover; G11 on their local programs with their machines; D49 for the `T` format; user code files (M13) take builder M-codes. |
| **A number is read with the wrong unit** (a factor of 1000 on a Z shift or an extent; on Okuma a factor of 100 even on a number written with a point) | Nothing is hardcoded: the machine decides, in three readings including Okuma's `scale` (AD-31); **with no machine nothing is converted at all** (D57) — the status item, hover, the inspector, the checks and every script summary list the readings and ask for a machine; the decimal-point check warns under none and increment machines; address arithmetic and the inspector report every rounding and refuse a value finer than the increment; point-less words with no class are left alone and reported; one golden set for TS and Python (WP6.9), reviewed by G10. |
| A wrong **default machine** misreads every new file of a profile | The status item always shows the machine; a variant mismatch warns once per open; the per-file choice (M7) and "None" override it with one click. |
| A preset's data changes in a later release and silently changes a machine | A machine stores the full `NumberInput` it was given; the dialog shows "Custom" when it matches no preset (§7.15). |
| The P6 switch of every consumer to the effective view breaks Phase 1 behavior | The switch is mechanical and runs against a stub that answers the profile defaults; the defaults of the P1 profiles reproduce their JSON (`applyMachine` unit test, WP6.1 validation of the default preset against `decimalPointSignificant`); every P1 unit, Python and harness test must pass unchanged at P6's commit (§5.2 rule 2). |
| An effective profile per (profile, machine) costs memory or compile time | Cached by the effective key, so machines with equal values share one; ≤ 5 ms per compile (G7); dropped on reload (M13). |
| `machines.json` is broken or written by a newer gEdit | The P1 JSON-file rules (F47): the app starts with no machines and a notice, a newer file is never written, invalid records are kept verbatim; while the file cannot be read, the Machines page refuses every write and offers only "Open machines file" and "Replace with an empty file" (which is what moves it to `.bak`). |
| A hand edit of `machines.json` is silently overwritten by the Machines page | A save of the machines document runs `machines.reloadFromDisk()` (`files.onDidSave`, the P1 settings pattern), so the page always writes the file's current content; a parse error is shown while the file is still open (WP6.8, WP6.10). |
| A real program or its content reaches the public repository | `tests/real/` gitignored; the G8 check of `git ls-files`; **no snapshot API in the local tests** (a `toMatchSnapshot` would write program text into a committed `.snap` file, G8 greps for it); goldens and manifests of local programs stay local; G11 prints counts only; findings are reproduced synthetically (standing rule 12). |
| **The wait-code check gives false confidence**: it compares written ids and written order, while the machine executes jumps, loops and conditions | The check says what it checks, in the finding text, in the report header and in `docs/user/channels.md`, and it refuses to judge a pair with a jump target or a backward jump between the two marks ("order not checked here", D60) instead of guessing. Findings are warnings; nothing is rewritten; a clean result is documented as "no mismatch found", never as "correct". G10 reviews the claims against what the code computes (§8.7 item 5b). |
| **The check cries wolf on a correct program**, which is worse than no check: users stop reading a report that is always red | Three things, each with a fixture: ids are compared as **sequences**, so an id that legitimately repeats in both channels is clean (`c11-repeat-ids.nc`); each rule declares its **semantics**, so an id-less wait is compared by count and an ordering code is not required to appear on both sides (`o10-two-turret.MIN`); and the order check is suspended only by a real jump, not by the labels that every wait line of a real program carries (`c03-jump.nc`). G10 reads each kind against the mechanism it claims to model (§8.7 item 5b). |
| A broken channel pattern changes how the machine reads **numbers** | The block is invalidated, not the record (§7.15, §4 rule 15): `layout: 'none'`, the problem shown on the Machines page and in the status item, everything else in force. X12 (d) asserts that the document's number reading, hover and address arithmetic are byte-identical to the run with a valid block. |
| The check is fast on the fixtures and slow on a real program | The algorithm is in the contract, not left to the implementation (§7.17): ordinal pairing through one map per channel and one linear diff per channel pair, never a scan over id pairs, with a report-wide budget after which the report is truncated and says so. G7 measures it at the contract cap (20,000 marks, 8 and 32 channels), not at the typical 2,000. |
| A channel's second section, or a shared subprogram between two sections, is dropped | A channel holds a **list of ranges** and the lines no channel owns are the `outside` group, both in the model, the map, the split and the script context; fixtures cover four alternating sections and an inter-section subprogram. |
| A split channel is edited for an hour and the work is lost | The split is a one-way copy: the command warns before it runs, the status message repeats it, `docs/user/channels.md` says it, each result carries the program header so it is at least a valid program, and the command is disabled where it is pointless (`multi-file`). The merge-back is Phase 4 (§11 item 27). |
| A channel file no pattern describes cannot join a set (same name in two folders, `%_N_1000_MPF` / `%_N_2000_MPF`, `PART.MPF` / `PART_GS.MPF`) | Per-channel name templates, the in-file `marker`, and — for everything else — "Assign this document to channel N" on an open document, remembered per file (M7). The feature therefore works before the owner has answered D64. |
| A sync rule matches too much (a comment, an `M100` that is not a wait) or too little | Rules run on **masked** lines (a mark in a comment is not a mark) and the tester shows what each rule matched, with its time, before the machine is saved; the check lists every mark it found, so a rule that fires on the wrong line is visible in the first run; `blocking: false` keeps a marker out of the check without deleting it; nothing is ever rewritten. |
| A wrong channel split hides half a program from the map | A declared channel that is nowhere is **missing** and shown as missing; a document that matches nothing resolves to `layout: 'none'` and behaves exactly as in M11; a channel keeps **every** range it has; every line no channel owns — before the first section, between a `sectionEnd` and the next start, after the last — is its own "outside" group, never dropped; the status item always says which channel and how many were found. |
| A channel or sync pattern is slow (ReDoS) or pathological | The user's own file, like a user profile: ≤ 1,000 characters, the AD-11 subset scan, the tester's 50 ms warning per rule, and a hard 500 ms budget per document after which the resolution is abandoned with a status message and `layout: 'none'` — the editor never waits on it, and the map, typing and saving are unaffected (G7). |
| A multi-channel machine is chosen for an ordinary single-channel file | Nothing matches, `layout: 'none'`, and every earlier scenario passes unchanged — which is X12 (c) and a fixture (`c05-one-channel.nc`, `c09-notachannel.nc`), not an assumption. |
| gEdit reaches into a folder, or opens a file the user did not ask for | It cannot: the capability grants read-file and write-file only and does not change in Phase 2 (F57). `channel_siblings` stats names derived from an **already-allowed** path in that path's own folder and grants nothing (standing rule 14); a channel is opened only through the dialog or a drop. A channel that is not open is reported as not open, and the check names it among the channels it did not check. |
| A mill program is detected as a lathe (or the reverse), and scripts read the wrong meaning | Mill markers and `priority: 1`; a margin ≥ 3 on every fixture (G10 prints it); the mill lookalike fixture; the manual choice remembered per file (M7); a folder rule in a user profile (M13); `pitchFeedAmbiguous` stays on the mill database. |
| Reference rewriting corrupts a program | Only local numeric references with a unique target in the renumbered scope are rewritten; `M99 P` and `M98 P… Q…` are never rewritten; everything else is reported; one undo step; goldens for duplicates, missing targets, selections, two programs. |
| AppKit does not call a method added at runtime (a cached selector check) | The delegate is re-assigned after `class_addMethod`; `m6-dock-quit-*` prove it with a real `[NSApp terminate:]`; a failure logs and leaves P1 behavior, with M7 recovery as the net; the owner checks a real Dock → Quit and a real logout (§13). |
| The hook breaks with a tao update | Installed only if the selector is missing; the code is isolated in `quit.rs`; the harness scenarios catch a regression. |
| The quit hook cancels a logout although nothing is dirty | The dirty flag flips from the webview and is cleared in `onWillQuit`; `m6-dock-quit-clean` covers the clean case. |
| Recovery is cleared by a Windows logoff before anything is restored | Recovery is cleared only in `files.onWillQuit`, never on `RunEvent::Exit` (F29); `WP7.4` tests it. |
| Recovery snapshots slow typing, fill the disk, or hold customer IP | Dirty and changed documents only, idle-time and raw IPC (F30), the G7 budget; caps (64 MiB per body, 200 MB total, 14 days); 0700; deletion after save/close/quit; the user guide says where they are. |
| A second running gEdit is mistaken for a crash | The per-session heartbeat; a leftover is a session whose `alive` is older than 120 s. |
| A restored document overwrites a file that changed after the crash | It carries the snapshot's disk stamp, so the P1 external-change banner offers Reload / Keep mine / Compare; the history backup keeps the overwritten bytes. |
| Backup on shares or on Windows (locks, slow copies) | A failure asks and never proceeds silently; history lives in the local data folder; the owner's Windows smoke test (§13). |
| Tokenizer extensions break the Fanuc or Klartext goldens | Every new field is opt-in; all P1 token goldens must pass unchanged; the `syntax` sections are pinned in P8; Python parity against the same goldens. |
| Okuma/Sinumerik facts are mostly **(verify)** | Turning subset only; the owner's local programs through G11 and any public ones before G10 of M8; the unit system and `DIAMON` are machine parameters, not guesses; `verify: true`; unknown codes shown as unknown; D38 would have let M9 go first (not used: M8 ran first). |
| TS and Python modal interpreters drift apart | One golden set from M6; one rules text (AD-19); the TS interpreter (Phase 3, P3.1) must pass the goldens unchanged; full per-line parity on real programs (G11); `FeedModeTracker` is a wrapper, not a second implementation. |
| `ModalIndex` stalls the UI on 300k-line programs | Snapshots every 1,000 lines; idle rebuild in ≤ 16 ms chunks; G7 budgets; the inspector shows "…" until ready. |
| A reloaded profile leaves stale compiled state | The `revision` store drives re-registration, outline and modal rebuilds; `m13-user-profile` edits a profile while a document uses it. |
| User regexes (ReDoS) | The length cap and subset check; "Test profile" reports rules slower than 50 ms; accepted residual risk (§4). |
| The P6 split of `gedit_nc.py` breaks a user script | The facade re-exports every public name; every P1 Python test runs unchanged against it; the import path is the same. |
| Harness runs are BLOCKED by a locked screen or run too long | The G6 precondition; BLOCKED ≠ PASS; background runs with logs (§5.2 rules 6–7); each milestone names its G6 window with the owner in advance, and the M9 prelude tries the harness on a CI macOS runner (§5.2 rule 12). |
| W0 does not fix Windows CI first time, or the push is approved late | The fix is in `feat/phase-2` from the start and Phase 2 proceeds on macOS gates; the W0 diagnosis lists the fallbacks (a duplicate manifest shows as `CVT1100`/`LNK1123`); a rework is merged at a milestone boundary; X10 still requires green CI at the exit. |
| Intentional behavior changes break P1 scenarios | Each milestone lists them; its harness WP updates exactly those scenarios. |
| Content copied from manuals | G10 checks "our own words"; codes and letters only as facts. |
| Network is needed | Nowhere in Phase 2's build and gates (objc2 is local, F28); the only network steps are the owner-approved pushes — W0's fix and the milestone fast-forwards, which are **not independent**: the first approved milestone push publishes `c18fba2` too (§5.1, D46). |
| **Real programs are still read wrong after M9**, and the checks, extents and address arithmetic of M10 build on wrong values | X13 is an exit criterion of its own, proven on the committed owner-public programs in CI and on the local ones by G11 (aggregates only); every value-changing fix has a synthetic reproduction and a G10 review; a remaining unknown token must be listed with a reason, not silently allowed. |
| A release bundle is broken or misleads (a platform never tried, unsigned) | Releases are **drafts** that only the owner publishes, after the checklist of §5.3; the notes say on which platforms the build was tried and what it does not do. |
| The re-cut leaves the Phase 2 exit short of what the roadmap promised (no inspector, no templates) | The roadmap's Phase 2 exit criteria change with the re-cut (D69, accepted 2026-10-01); X7 and the templates half of X9 move to Phase 3 with their designs (§6), so nothing is dropped, only moved; the owner accepted the re-cut on 2026-10-01. |

---

## 13. Manual checks for the owner (cannot be automated here)

Carried from Phase 1 (still open):
- Review the M3 code databases (`fanuc.json`, `heidenhain.json`) and the Phase 1 exit-criteria goldens. The lathe databases extend `fanuc.json`, so do this **before or with** the M6 review.
- Smoke-test the bundles on Windows and Linux (P1 §12 list), now as the checklist of the v0.2 release (§5.3); AltGr on Windows (now also `Mod+Alt+Left/Right`, and `Mod+Alt+A` in Phase 3); the F-keys on a Mac laptop (now also `Mod+F7`).

Per step:
- **W0:** allow the push when convenient (D46); look at the Windows CI run. Nothing waits for it.
- **Any time:** put the programs you want checked into `tests/real/` with a `manifest.json` (never committed; see `tests/real/README.md`), and hand over separately the few you are happy to publish (D45).
- **M6:** answer D49; review the lathe tables (§8.1, §8.2) and the machine defaults (§8.8) and the open `verify` list; **set up each real lathe as a machine configuration** from its parameters (how it reads numbers — calculator-type input or increments, and which increment —, the G-code system, the power-on feed mode, diameter programming; the plan's lathe default is calculator type, which is what your 18i-T manuals show, so correct it per machine if yours differs) and check on one program that the results match what the machine does (F7, tool list, scale feed with a limit, renumber with `G71 P/Q`), once with the machine and once with "none"; on a real Mac, Dock → Quit and log out with an unsaved tab (the prompt appears; the logout is cancelled) and with only saved tabs (nothing is interrupted).
- **M7:** Force Quit gEdit (Activity Monitor) with unsaved tabs and restart (the machine choice comes back); check the backup history after a save; open a read-only file from a network share; on Windows/Linux, log off with an unsaved tab and confirm the recovery offer at the next start; backup on a network share.
- **M8:** set up the Okuma and Siemens machines (the Okuma unit system off the control's UNIT parameter — it scales every number, a number with a decimal point included, so check one value against the machine; Sinumerik `DIAMON` behaves as the default says); review the two database tables; open a `.MIN` and a `.MPF` from the machines; run G11 on the local ones.
- **After each release (from v0.2):** the checklist of §5.3 on macOS, Windows and Linux (open, edit, save byte-exact, the close guard, one script with and without Python), then the milestone's own items below; publish the draft when you are satisfied. v0.2's checklist is the Phase 1 exit check that is still open.
- **M9:** check that the owner-public programs and your local ones open as the right dialect (G11's counts are in the commit body); open a Siemens milling program and check F7 and the tool list; for each lathe that needs it, set the `U`/`W` choice and the tool-word variant in its machine configuration; answer R8 (needed before M10, §10.2).
- **M10:** run program checks on a program that once caused a problem at the machine; shift Z on a copy with address arithmetic and compare with the machine's reading, once on a lathe program and once on a Klartext or Sinumerik drilling program (its cycle depths are moved, or refused and listed, as R8 says); answer R5 (needed before M12, §10.2).
- **M11:** compare a real re-posted program with its predecessor in review mode.
- **M12:** answer D64 if you can — best by putting one multi-channel program (or one matching pair of channel files) per machine into `tests/real/` with its manifest entry. Then, for each twin-turret or sub-spindle machine, set its channels up once in Settings ▸ Machines ▸ Channels (the layout, the section or file-name pattern, the channel aliases, the wait rule **and its kind** — a rendezvous with an id, an id-less wait matched by count, or an ordering code) and use the **tester** on a real program until every section and every wait is found; a channel with several sections is expected and is shown as several ranges. Run "Check wait codes" on a program that **ran correctly** (expect no finding — this is the important one: a false finding on a good program is the failure mode we care about most) and on one you know was wrong (expect the finding you would have made); walk a pair with next/previous sync point and "Go to the matching mark". Tell us where the wording of a finding does not match how you would say it at the machine.
- **M13:** set up one real machine as a user profile (folder, numbering, builder M-codes) next to its machine configuration; export `machines.json` as a backup.
- **At the Phase 2 exit (1.0):** the release bundles on macOS, Windows and Linux: open, edit, save byte-exact; Dock quit and close guard; the machine item and the Machines page; the channel item and the wait-code check on one of your own multi-channel programs; compare review mode; one bundled check script with and without Python.
- **Phase 3, when it comes:** read a few blocks of a real program in the inspector and confirm the modal state and the effective values under your machine; review the default templates.

---

## 14. Coverage: roadmap row → work package

| Roadmap Phase 2 item | WPs or decision |
|---|---|
| Real programs read right (the third revision, D69) | P9 (R2–R6 contracts and skeletons, the defined-cycle contract, the G11 format, the harness-in-CI spike), 9.1 (Sinumerik milling, R2), 9.2 (5-axis and high-speed codes, the two flags, R3), 9.3 (tokenizer rules, R4), 9.4 (`U`/`W` and the `T` split, R6), 9.5 (values read right), 9.6 (detection leftovers, G11 automated, the owner-public checks), 9.7 (docs); X13 |
| User profiles with `extends` | P6, 6.1 (mechanism, built-in children); 13.1, 13.2, 13.3 (user files) |
| Profile editor with pattern tester | 13.3 (lean, D40) |
| Editing options; forced uppercase; prevent joining | 13.4 |
| Load/save formatting; per-profile colors | deferred (§11 items 2–3) |
| Fanuc lathe child profile (G-code system as a machine variant) | P6, 6.1, 6.2, 6.6; 9.4 (`U`/`W`, `T` split) |
| Machine configurations (owner decision; AD-31) | P6 (contracts, effective view, storage stubs), 6.8 (service, storage, reload), 6.9 (numbers), 6.10 (status item, Machines page, the save hook), 6.1 (declaration, variants), 6.2 / 8.3 / 8.5 (per-profile data, §8.8), 6.4 / 8.7 (power-on state), 6.6 (scale feed), 7.3 / 7.4 / 7.5 (per-file choice, recovery), 9.4 (the R6 variants), 9.5 (number classes, presets), 10.2 (decimal-point check), 10.3 (extents), 10.4 (address arithmetic), 11.2 / 11.3 (compare), 13.2 / 13.3 (reload, import/export); P3.1–P3.3 (TS interpreter, inspector, hover: Phase 3) |
| How the control reads numbers, per machine (D34; increment / calculator / Okuma `scale`, and D57's "no machine, no guess") | 6.9 (rules, readings), 6.1 (validation, effective `decimalPointSignificant`), 6.2 and 8.2 (the parameter-units table), 6.6, 8.3, 8.7, 9.5 (number classes), 10.2, 10.3, 10.4, 11.2 (compare); P3.2, P3.3 (Phase 3); X11 |
| Sinumerik `DIAMON` default (D35) | P8, 8.5, 8.7; X2 |
| Real programs local (D45) | P6 item 13, FX, 9.6 (G11 automated), G11, standing rule 12 |
| **Multi-channel programs** (a backlog row, pulled forward; owner decision D58, AD-32) | P12 (contracts, `OutlineKind`, the pure resolution, the stubs, R5's smallest version), 12.1 (resolution, fixtures), 12.2 (the wait-code check), 12.3 (the channel parameters, the Channels step, the tester), 12.4 (the sibling lookup), 12.5 (service, status item, per-channel map, navigation, split), 12.6 (script context, Python API, tool list per channel), 12.7 (docs); §8.9 (no preset ships); X12. **Side by side: Phase 4** (§11 item 27, D61) |
| Split multi-channel programs by channel; check wait codes (the backlog row, generic patterns only) | 12.5 (`channels.splitToDocuments`, a one-way copy into untitled documents, `single-file` only), 12.2 + 12.5 (the check); writing them to disk and merging them back stay out (§11 item 28) |
| Sinumerik and Okuma OSP profiles, grammars, code databases | P8, 8.1–8.7; 9.1 (Sinumerik milling, R2) |
| Modal interpreter (TS + Python) | 6.4 (Python), 9.5 (the Klartext defined cycle); P3.1 (TS, Phase 3) |
| Renumber advanced options | deferred except `keepReferenced` (6.3) |
| Reference-aware renumbering (from P3) | 6.3 |
| Block skip | 10.1 |
| Insert/remove text by rule, batch replace | deferred (§11 item 12) |
| Address arithmetic | P10 (R8's smallest version), 10.4 |
| Character cleanup | folded into 10.2 (report part); transliteration cut |
| Split by tool, join programs, combined tool list | deferred (§11 items 6, 11); tool-segment select in 10.1 |
| Extents, program checks | 10.3, 10.2 (WP8.9, the D38 fallback, was never used) |
| Hover with cycle parameters and modal context | P3.3 (Phase 3, §11 item 31) |
| Code inspector, edit values | P3.1, P3.2 (Phase 3, §11 item 30) |
| Parametric templates, placeholders, file templates, completion; migrate blocks | P3.4, P3.5, P3.6 (Phase 3, §11 item 32); 13.2 reads user templates once they exist |
| Whole-address match, find-all panel, search in open documents, replace into a new document (and the replace count) | 11.1 |
| Next/previous NC event; bookmarks v2 | deferred (§11 item 4); 7.5 (persistence) |
| Block range, tool segment, insert/append file | 10.1 (tool-segment select); deferred (§11 item 6) |
| Read-only files, backup and recovery | 7.1–7.4 |
| OS file associations | deferred (D42, D47) |
| Bundled user guide, regex help | cut; 11.4 (regex page in `docs/user`) |
| Compare ignore options via review mode | 11.2, 11.3 |
| Word-level marking | deferred (§11 item 8) |
| Merge both directions, export differences, two files on disk | 11.2, 11.3 |
| External commands | cut (D43) |
| Full settings dialog, role color editor | lean (the Machines page in 6.10, M7 keys, the Profiles page in 13.3); role colors deferred |
| Session restore and per-file memory | 7.1, 7.5 |
| Profile import/export | 13.1, 13.3 |
| macOS Dock-quit guard (P1 D10) | 6.5 |
| Windows CI test executable (Phase 1 open item) | W0 (local; the push is D46) |
| Releases (not a roadmap row; D70, proposed) | W1 (the release workflow), the release step of every milestone (§5.3) |
| Exit criteria | H6–H13, `m13-exit-criteria` (X11 and X12 included), `m13-exit-criteria-nopython`; X13 through WP9.6's committed tests and G11 |
