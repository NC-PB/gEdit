# gEdit planning

These documents describe where gEdit is heading: an open-source desktop editor for NC code (Fanuc-style ISO code, Heidenhain Klartext, Okuma OSP and Sinumerik) with first-class scripting. They are working notes, not a promise. Every item has a priority and a rough size so contributors can pick up work.

**Phase 1 and Phase 2 are implemented** (M6–M13 are on `main`, Phase 2 is done; the plan was re-cut on 2026-09-30, see the [roadmap](roadmap.md#phase-2-real-cam-output-safely-done)). These notes therefore describe a mix of what exists and what is still intended — the tag on each item says which (see [Conventions](#conventions-used-in-these-documents)). For what the program actually does today, read the [user guide](../user/README.md) instead; for how Phase 1 was built and where it deviated from its own plan, [phase-1-implementation.md](phase-1-implementation.md); for the plan Phase 2 was built from, [phase-2-implementation.md](phase-2-implementation.md). The open items and the decisions still to be made are collected in [TODO.md](../../TODO.md).

## Vision

gEdit should be the tool you open after the post-processor has run: read the program, understand it, make small corrections, run a check or a transformation, compare it with the last version and save it in the format the control expects. It should be fast on large files and work offline. It should be easy to extend with a short Python script instead of a feature request.

## Principles

1. **Keep it simple.** Build a few features well instead of matching every feature of commercial editors. If a feature needs a long settings page to be useful, question it first.
2. **CAM output first.** The target is code that post-processors emit: rapid, linear and circular moves, feeds and speeds, tool changes, work offsets, standard drilling cycles, comments, block numbers, subprogram calls and simple variables. Hand-written shop-floor programs with proprietary or conversational cycles are not a design driver.
3. **Scripting-first extensibility.** When a function is a batch computation over the text (scale feeds, build a tool list, shift coordinates), it ships as a bundled Python script that uses the same contract as user scripts. The core stays small, and users can read and adapt every bundled script. See [scripting.md](scripting.md).
4. **Data-driven dialects.** What the editor knows about a control (comments, block numbers, tool calls, extensions, colors, code descriptions) lives in a JSON profile, not in scattered code. See [dialect-profiles.md](dialect-profiles.md).
5. **Everything is undoable.** Every transformation and every script result is applied as one undo step. Nothing overwrites the document without a way back.
6. **Never corrupt a program.** Keep encoding, line endings and bytes we do not understand unchanged unless the user asks to change them.
7. **Open source and original.** All texts, code descriptions, templates and illustrations are written by contributors in their own words. Control manuals serve only as a source of facts.

## Scope

In scope:

- Text editing and navigation for NC code (tabs, bookmarks, NC-aware search, go to block number, tool-change navigation)
- NC-specific text transformations (renumbering, cleanup, feed and speed scaling, coordinate math)
- Dialect profiles: file types, detection, highlighting, block numbering, tool-call rules, and profiles and code files of the user's own (M13)
- Context help for codes, a code inspector and parametric code templates
- File compare with NC-aware options
- Python scripting and a bundled script library (external commands were cut in Phase 2: a script can start a program itself)
- Preferences, themes and keyboard shortcuts

Supported dialects: Fanuc-style ISO code for milling, Fanuc-style ISO code for turning, Heidenhain Klartext, Okuma OSP for turning and Siemens Sinumerik 840D for turning. Siemens Sinumerik 840D for milling is built (M9, "Real programs read right") and ships in the next release; Okuma milling is not covered yet (it waits for a machining-centre manual, roadmap R9). Alongside the dialect profile sits the **machine configuration** — how one particular control reads what the profile describes (number reading or unit system, G-code system, diameter programming, power-on modes); see the [user guide](../user/machines.md).

Profiles and code files of the user's own are covered as of M13: they start from a shipped profile, are laid over it, and are managed on a Profiles page; see the [user guide](../user/profiles.md).

Several channels in one control (two turrets, two paths) are covered as of M12: gEdit finds the channels, groups the program map and the tool list by channel, and checks that the wait codes written in the channels fit each other. It executes nothing and synchronizes nothing; see the [user guide](../user/channels.md).

## Non-goals

Not planned for now (full list in [roadmap.md](roadmap.md#not-planned)):

- Backplot, 3D toolpath display, simulation of any kind
- Sending or receiving programs to and from machines (DNC, serial, FTP)
- Program or document management, ERP/PDM integration
- Conversational shop-floor formats and machine-builder-specific cycles

## Documents

These are design notes. The manual for the program as it stands is [docs/user](../user/README.md).

| Document | Content |
|---|---|
| [editor-core.md](editor-core.md) | Documents, tabs, file handling, navigation, bookmarks, search, what Monaco provides for free |
| [nc-transformations.md](nc-transformations.md) | Renumbering, cleanup, value scaling, coordinate transforms, reports and checks |
| [code-assistant.md](code-assistant.md) | Hover help, code inspector, parametric templates, completion, code database format |
| [file-compare.md](file-compare.md) | Comparing two NC files, NC-aware ignore options, merging |
| [dialect-profiles.md](dialect-profiles.md) | Profile model and JSON schema with Fanuc and Heidenhain examples |
| [scripting.md](scripting.md) | Script contract, metadata header, parameters, output modes, bundled library, external commands |
| [settings-ui.md](settings-ui.md) | Preferences, storage layout, themes, shortcuts, UI layout |
| [roadmap.md](roadmap.md) | Phases 0 to 4, the Phase 2 milestones and planned releases, backlog and not-planned list |
| [phase-1-implementation.md](phase-1-implementation.md) | The executed plan for Phase 0 cleanup and Phase 1: architecture, milestones M0–M5, the binding contracts (§7) and where the implementation deviated from them (§7.12), owner decisions, deferred items (§10) |
| [phase-2-implementation.md](phase-2-implementation.md) | The plan Phase 2 was built from: the scope decision per roadmap row (§2), milestones M6–M13 (§6), the contracts they add (§7), with the test ids (§7.12) and where the implementation deviated (§7.16), the dialect and machine-parameter data they ship (§8), fixtures (§9), the owner decisions behind them (§10) and what was deferred or cut (§11) |
| [phase-3-implementation.md](phase-3-implementation.md) | The plan of record for Phase 3, "Understand and write" (2026-10-09): scope and exit criteria (§2), the architecture decisions it adds (§3), milestones P3a "Understand a block" and P3b "Write with templates" with their work packages (§5), the contracts (§6) and where they changed (§7) |
| [source-review-2026-09.md](source-review-2026-09.md) | What the control manuals, the builders' handbooks and the owner's example programs showed after M8: what gEdit missed, the corrections made, and roadmap proposals for the owner to decide |
| [syntax/syntax-fanuc.md](syntax/syntax-fanuc.md) | Fanuc syntax notes for the CAM-output subset |
| [syntax/syntax-heidenhain.md](syntax/syntax-heidenhain.md) | Heidenhain Klartext syntax notes |
| [syntax/syntax-sinumerik.md](syntax/syntax-sinumerik.md) | Siemens Sinumerik syntax notes |
| [syntax/syntax-okuma.md](syntax/syntax-okuma.md) | Okuma OSP syntax notes |

## Conventions used in these documents

Each feature carries a tag line such as `P1 · M · Core`.

| Field | Values |
|---|---|
| Priority | **P1** Phase 1 (MVP) — **shipped**, except where §10 of the Phase 1 plan records it as deferred; **P2** Phase 2 — built, see [Current state (Phase 2)](#current-state-phase-2-done) for what exists and §11 of the Phase 2 plan for what it deferred or cut; **P3** Phase 3 ("Understand and write") and Phase 4 ("Comfort and geometry") — the design notes were written before the re-cut of 2026-09-30 and tag both as P3, so the [roadmap](roadmap.md) says which is which; **B** backlog (unscheduled) — none of these exist yet, except reference-aware renumbering, which was pulled forward and shipped in M6 |
| Size | **S** a day or two, **M** one to two weeks, **L** several weeks (part-time contributor) |
| Delivery | **Monaco**: built into the editor component, needs wiring and UI only. **Core**: app code (TypeScript or Rust). **Script**: bundled Python script using the public script contract. **Profile**: data in the dialect profile, no new code. |

Rule of thumb for Core vs. Script: navigation, interactive editing, and cleanups that must work without Python are Core. Parameterized batch computations, reports and geometry work are Scripts. A script can move into the core later without changing its user interface, because both use the same parameter forms and output modes.

## Current state (Phase 1, shipped)

gEdit is a multi-document Tauri 2 + SvelteKit + Monaco app. What Phase 1 delivered:

- **Documents and files** — tabs, multi-select open and drag and drop, new / close / close all / save all, recent files, byte-exact round trip of encoding (UTF-8, UTF-8 BOM, UTF-16, Windows-1252), line endings and the NUL tape leader and trailer, external-change detection, and compare against the saved version, another tab or any file.
- **Dialects as data** — Fanuc (ISO) mill and Heidenhain Klartext as JSON profiles: detection from extension *and* content, generated highlighting, block-number and tool-call rules, the outline, numbering defaults and a code database per dialect.
- **Reading a program** — program map, go to line or block number, next and previous tool change, bookmarks, folding and sticky scroll, hover help and dictionary-driven completion.
- **NC transformations** — renumber and remove block numbers, insert and remove spaces, remove empty lines, remove comments, convert case; each on the selection or the document, as one undo step, with a Results panel for everything they refused to touch.
- **Scripting** — the v2 contract: metadata header, parameter forms, the JSON context with the resolved profile and code database, four output modes, safe apply, timeout and cancel, script folders with shadowing, and three bundled scripts (scale feed rates, scale spindle speeds, tool list) sharing `gedit_nc.py` with the app's own tokenizer and number formatting.
- **Around it** — settings dialog and storage layout, light/dark/system theme, window and layout state, command palette, a generated shortcut reference, About with third-party notices, an i18n layer with every UI string in one place, and a macOS runtime harness that drives the real app.

What Phase 1 deliberately did **not** do is listed in §10 of [phase-1-implementation.md](phase-1-implementation.md); the user-visible limits are in the [user guide](../user/README.md#what-gedit-does-not-do). Phase 1's exit condition also includes the owner's confirmation of the CI bundles on all three platforms (a hand test on Windows and Linux), which is still open. Each design note listed above records what Phase 1 left in its area; the Phase 2 work so far is summarised below, and where a note has not caught up with it yet, this summary and the user guide win.

## Current state (Phase 2, done)

Phase 2 was built milestone by milestone against [phase-2-implementation.md](phase-2-implementation.md). The plan was re-cut on 2026-09-30 (accepted by the owner on 2026-10-01): reading real programs right comes first (M9), then checks and address arithmetic (M10), compare and search (M11), multi-channel programs (M12) and user profiles with the Phase 2 exit (M13); the inspector, hover with modal context, the TypeScript modal interpreter and templates moved to Phase 3. A tagged release is planned after each milestone. The [roadmap](roadmap.md#phase-2-real-cam-output-safely-done) has the reasons and the status of every row.

- **Shipped.** M6 (the Fanuc lathe profile and profile inheritance, machine configurations, the Python modal interpreter, reference-aware renumbering, the macOS quit guard); M7 (a backup before every overwriting save, crash recovery, session restore, per-file memory, read-only documents); and a Windows hardening pass (one spelling per path, long names, device names, the interpreter lookup).
- **Shipped, continued.** M8: Okuma OSP lathe and Sinumerik 840D turning, each with its own grammar, code database and synthetic fixtures, the Okuma unit systems as machine presets, and the decisions of 2026-09-27 that followed the [source review](source-review-2026-09.md) (decisive detection, tapping speeds refused, the five-digit Fanuc lathe `T` word, the Sinumerik main spindle). v0.2.0 is a draft release.
- **Shipped, continued.** M9, "Real programs read right" (v0.3.0, published 2026-10-04): a built-in Sinumerik milling profile, 5-axis and high-speed codes with two new database flags, the remaining tokenizer rules, per-machine `U`/`W` and tool-word choices, number classes and per-unit feed limits, the Klartext defined cycle, Save As re-detecting the dialect, Remove Comments keeping `;$PATH=`, detection fixes for a Y-axis lathe and the Fanuc lathe / Sinumerik tie, and an automated check over the owner's local programs. The runtime suite now runs on a GitHub macOS runner on every push to `main`, so G6 no longer needs the owner's Mac.
- **On `main`, v0.4.0 draft (2026-10-05).** M10, "Check before the machine": block skip on a selection (with levels where the control has them) and `Mod+F7` to select a tool's lines on the NC tab; three bundled scripts on the Tools tab, **Program checks** (31 checks, each data-driven, with the decimal-point finding under a machine and with none), **Extents** (ranges per program, work offset and tool in effective values, with what could not be worked out counted) and **Address arithmetic** (a Z shift that moves the cycle positions on the tool axis with it, or refuses a block it cannot judge and lists it; the R8 role). The prelude settled what M9 left open: tool centre point control is no coordinate frame, the Klartext cycles 202, 208 and 262 are described, and `S1=` is the main spindle's speed. Two reviews followed the integration and their findings are fixed (§7.16 #123 to #133 of the plan). The first run of the runtime suite on the GitHub runner passed 89 of 92 scenarios; the three failures (`m1-keys`, `m10-blockskip`, `m10-perf`) are fixed in the branch and have not run again (see [TODO.md](../../TODO.md)). v0.4 follows.
- **On `main` (2026-10-05).** M11, "Compare and search": **NC-aware search and replace** (an address word with a condition, compared as written; a program number that also finds its calls; text and regular expressions, in comments on request; Find All into Results over one or all open documents; Replace All in place or into a new tab, with a count; Find Whole Address in the editor's own find box); **compare review mode** (what a dialect's re-post changes, without the numbering and format noise, with the defaults of each profile and notes for what it keeps, [§8.11 of the plan](phase-2-implementation.md)); merge in both directions (`Mod+Alt+Right`, `Mod+Alt+Left`), export of differences, compare two files, saved options, and a regular-expression help page. Three reviews of the integrated branch (13 NC findings, 21 code findings, a skeptic pass) are fixed with regression tests (§7.16 #143 to #147 of the plan); the runtime fixes found by the first full local run are in. Left open on purpose: three small items (see [TODO.md](../../TODO.md)). The user guide describes all of it: [Searching](../user/README.md#searching), [Regular expressions](../user/regex.md) and [Comparing two programs](../user/README.md#comparing-two-programs). v0.5 follows.
- **On `main` (2026-10-08).** M12, "Multi-channel programs": the channels and the wait codes of a machine are set up in its configuration (a plain list of codes with a live preview, the `P` form, stops and ends, and regular expressions under Advanced, with presets marked *verify* for Fanuc two and three paths, Okuma two turrets and Sinumerik two channels); a channel item in the status bar, the program map and the tool list per channel, Next/Previous Sync Point and Go to the Matching Mark, **Check Wait Codes**, a tester for the settings, a one-way split into channel documents, and channels in scripts ([channels guide](../user/channels.md)). Two reviews (15 NC and 19 code findings) and a skeptic pass are fixed, and a performance round brought a 300,000-line program with 20,000 waits inside the budgets ([§7.16 #167–#169 of the plan](phase-2-implementation.md)). It lands on `main` after the runtime suite `m0`–`m12` (106 scenarios) has run on the GitHub runner.
- **On `main` (2026-10-08).** M12.5, "Real programs, second pass": detection that says so when no dialect fits well (a question mark on the dialect item, a first picker entry that keeps the guess), more headerless shapes, the five-digit lathe `T` word by length, Siemens milling without `M6`, fewer false alarms in the program checks, new channel presets and new token kinds for text, jump targets and names. Reviews, a skeptic pass and two fix batches are in ([§7.16 #190–#191 of the plan](phase-2-implementation.md)); the runtime suite is 112 scenarios and runs on the GitHub runner after the landing.
- **On `main`; Phase 2 done (2026-10-09).** M13, "Your own dialects and codes": user profiles and code files in two folders next to the settings, a Profiles page in the settings with a test of a profile on the open program (what every rule finds, line by line, with its time), a profile of yours that is picked automatically only through rules it adds itself, code files that add to a built-in set or make a set of their own (the user's M codes stay in force when a lathe switches G-code system), registries that reload on save without losing a document, machine import and export, and the typing options (letters typed in code come out in upper case on every control, comments, strings and free text as typed; Backspace and Delete do not join two blocks of text; a session switch; Convert Case asks before it writes lower case). The exit criteria of §2.2 have their programs and golden results in `tests/fixtures/exit2/`. Two reviews (14 NC and 20 code findings), a skeptic pass and two fix batches are in ([§7.16 #203 of the plan](phase-2-implementation.md)); among them, a code entry of yours changes only the members it writes (`"replace": true` replaces it whole) and a built-in profile wins every tie. The runtime suite is 126 scenarios (`m0`–`m12`, `rp`, `m13`) and runs on the GitHub runner after the landing. There is one release, 1.0, cut at the very end after the owner's bundle check on the three platforms.
- **Phase 3 under way: P3a "Understand a block" is built and reviewed (2026-10-09) and lands on `main` next.** The plan of record is [phase-3-implementation.md](phase-3-implementation.md). P3a delivers the TypeScript modal interpreter (the same state as the Python one after every line of every golden and of the owner-public programs, built in idle time and never waited for), the code inspector with value editing (what each word of a block means on the document's machine, what is in force after it, and a change that is written the way the machine reads it or refused, never rounded), the hover with a cycle's parameters and the modal context, and motion colors (a mark beside every moving line, rapid, straight, arc, thread or cycle). The user guide has [Understanding a block](../user/inspector.md). It has had two reviews (17 NC and 13 code findings), a skeptic pass and both fix batches, and TypeScript equals Python on every line of the goldens, the owner-public programs and the other programs it was run on; its new runtime scenarios pass on the development Mac. What is left is the landing and the runtime suite on the GitHub runner; the reviews' outcome per known gap is in the plan. P3b (templates in place of the code blocks, cycle forms, the template manager) follows.
- **Next.** P3a lands, then P3b. The one release, 1.0, is cut at the very end, after P3b and the owner's check of the bundles (the v0.6 changes and P3a go into it).

What each shipped milestone does is in the [user guide](../user/README.md), the profiles and code files of M13 in [Your own profiles and code files](../user/profiles.md); the open items and decisions are in [TODO.md](../../TODO.md). Where a design note has not caught up with the code, the user guide and this summary win.
