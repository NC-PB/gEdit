# gEdit planning

These documents describe where gEdit is heading: an open-source desktop editor for NC code (G-code and Heidenhain Klartext) with first-class scripting. They are working notes, not a promise. Every item has a priority and a rough size so contributors can pick up work.

**Phase 1 is implemented.** These notes therefore describe a mix of what exists and what is still intended — the tag on each item says which (see [Conventions](#conventions-used-in-these-documents)). For what the program actually does today, read the [user guide](../user/README.md) instead; for how Phase 1 was built and where it deviated from its own plan, [phase-1-implementation.md](phase-1-implementation.md).

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
- Dialect profiles: file types, detection, highlighting, block numbering, tool-call rules
- Context help for codes, a code inspector and parametric code templates
- File compare with NC-aware options
- Python scripting, bundled script library and external commands
- Preferences, themes and keyboard shortcuts

Supported dialects: Fanuc-style ISO code for milling, and Heidenhain Klartext. A Fanuc lathe profile, Siemens Sinumerik and Okuma OSP are planned — until the first of them exists, a turning program is read with a mill profile, with the consequences the [user guide](../user/dialects.md#lathes-and-other-controls) spells out.

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
| [roadmap.md](roadmap.md) | Phases 0 to 3, backlog and not-planned list |
| [phase-1-implementation.md](phase-1-implementation.md) | The executed plan for Phase 0 cleanup and Phase 1: architecture, milestones M0–M5, the binding contracts (§7) and where the implementation deviated from them (§7.12), owner decisions, deferred items (§10) |
| [syntax/syntax-fanuc.md](syntax/syntax-fanuc.md) | Fanuc syntax notes for the CAM-output subset |
| [syntax/syntax-heidenhain.md](syntax/syntax-heidenhain.md) | Heidenhain Klartext syntax notes |
| [syntax/syntax-sinumerik.md](syntax/syntax-sinumerik.md) | Siemens Sinumerik syntax notes |
| [syntax/syntax-okuma.md](syntax/syntax-okuma.md) | Okuma OSP syntax notes |

## Conventions used in these documents

Each feature carries a tag line such as `P1 · M · Core`.

| Field | Values |
|---|---|
| Priority | **P1** Phase 1 (MVP) — **shipped**, except where §10 of the implementation plan records it as deferred; **P2** Phase 2, **P3** Phase 3, **B** backlog (unscheduled) — none of these exist yet |
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

What Phase 1 deliberately did **not** do is listed in §10 of [phase-1-implementation.md](phase-1-implementation.md); the user-visible limits are in the [user guide](../user/README.md#what-gedit-does-not-do). Each document below notes what already exists in its own area.
