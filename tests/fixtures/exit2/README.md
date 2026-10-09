# `tests/fixtures/exit2/`: the Phase 2 exit criteria

The programs, user files and goldens of `m13-exit-criteria` and
`m13-exit-criteria-nopython` (phase 2 plan §2.2, §6 M13 H13). The M13 prelude (P13) wrote
the plan of this folder; H13a wrote the files and the goldens, and this README says what
each one is and how a run reads it.

Every file is synthetic. It was written for gEdit from the syntax notes in
`docs/planning/syntax/`, in our own words. None was copied from a machine, a control manual,
a customer program or any program that is not gEdit's own, and none is meant to run on a
machine. Each program says so in its first line: `(WRITTEN FOR GEDIT - SYNTHETIC
EXIT-CRITERIA PROGRAM, NOT FOR A MACHINE)`. Where the control needs the first line, the marker
is the second line: behind the Okuma `$NAME.MIN%` header. The Sinumerik `%_N_NAME_MPF` header is
followed by its `;$PATH=` line, as the control writes them, so there the marker is the third line.
`repost-old.nc` and `repost-new.nc` are byte copies of `compare/x5-repost/original.nc` and
`reposted.nc`, which are gEdit's own fixtures; they carry that folder's marker in line 2.

`.gitattributes` marks `tests/fixtures/**` as `-text`, so the bytes in the repository are the
bytes the run sees. **Do not open these files in an editor.** `fanuc-lathe-a.nc` and its
goldens are CRLF, and the `checks-*` programs hold an en dash in UTF-8.

## How the files were made

- **Inputs** are written by `gen-exit2.py`. That covers the programs, the user profile and
  code files, and the two copies. Change a program there, never by hand:

  ```sh
  python3 tests/fixtures/exit2/gen-exit2.py .        # from the repository root
  ```

  The two report scripts under `scripts/` are plain files.
- **Goldens** are what gEdit's own code makes of the inputs. H13a ran a scratch vitest
  outside the repository that calls the functions the app calls:
  - detection and variant detection;
  - `effectiveMachine` / `applyMachine` and the registry's `effective`;
  - `OutlineIndex`, `hoverAt`, the `renumber`, block-skip and `replace` transforms;
  - `normalizeLines` / `unifiedDiff`, `findInLines`;
  - the channel service, `groupByChannel`, `stepSync`, `findPartner`, `splitTexts` and
    `checkReport`.

  The bundled Python scripts were run with `python3 -S` and a `GEDIT_CONTEXT` built by
  `buildContext`, with the form's starting values plus the parameters named in each golden.
  Every golden was then checked by hand against its criterion. Where the output looked wrong,
  the program was changed so the criterion does not depend on the doubtful behaviour, and the
  behaviour was reported (`SP/handoff/m13-h13a.md`, "Findings"). A changed program means the
  goldens that read it have to be made and checked again.

## Conventions of the goldens

- **Saved documents.** A golden program (`*.feed90.nc`, `*.renumber.nc`, `*.arith-…nc`, …) is
  **the document after that one run from its input**, saved. It keeps the input's encoding
  and line ending: `fanuc-lathe-a.*.nc` are CRLF, everything else LF. Compare the editor text
  with the golden with CRLF folded to LF. At the end of the run, compare the saved file
  byte for byte (see "Saving at the end").
- **`*.report.json`.** This is the rest of a replace script's envelope:
  `{ script, params, message, findings }`.
  - `message` is the script's summary. The status bar puts the script's name in front of it,
    so compare the end of the status text.
  - `findings` are the Results rows (`line|severity|message`).
- **`*.tools.json`**:
  - `toolLines` are the lines F7/Shift+F7 visit (`ctx.outline.toolLines(id)`).
  - `mapTools` are the program map's tool rows (`line`, `text`).
  - `toolList` is the whole envelope of the bundled `tool_list.py` with its form defaults:
    `title`, `columns`, `rows`, `message`, `findings`. The rows read as in `m6-lathe-scripts`.
  - `variants` are the effective variant choices with their source; `detected` marks what the
    machine item shows as detected.
  - X2 adds `detected` (the profile each file opens with), `sameBytes` and `unknownTokens`
    (the tokenizer's unknown tokens outside comments, which must be empty).
- **Check and extents goldens** (`*.findings.*.json`, `*.extents.*.json`, `*.checks.*.json`,
  `machine-params.*.json`, `sinumerik-lathe.modal.json`). `report` is the whole report
  envelope, compared as `m10-scripts` does. `machine` is `null` for "none", or the machine the
  run makes.
- **Machines.** Every machine a golden names is written out in full: `name`, `profile`,
  `notes`, `params`. The run makes it through the service (`ctx.machines.add`, as
  `m10-common.js` does) or, for X11(a), on the Machines page. It then picks it with the real
  picker. Ids are the app's, so `machines.x11.json` masks them as `"*"`.
- **Line numbers** are 1-based document lines. **Paths** are not compared: a golden that
  needs one (`user-profile.json`) says which.

## The order of the run (fixed; plan §6 M13 H13)

1. **X1 and X2 first, while no machine exists at all.** They check what gEdit shows with
   nothing chosen: the G-code system detected from the program, and `DIAMON` assumed.
2. **X5, X6 and X8.**
   - X8 makes `X8 Lathe IS-B` and `X8 Okuma 1um` (defined in the goldens' `machine` member)
     and **removes them at its end**.
3. **X9, X11 and X12.**
   - X9 makes `X9 Lathe`. **At the end of X9, remove its machine and the three user files,
     then reload** (`profile.reload`, or `ctx.userConfig.load()`), so that the later criteria
     start from the built-ins only. (Before the M13 review fixes, NC-2, a user profile that
     `extends: fanuc-lathe` also won a tie over the built-in and took `decimal-lathe.nc`,
     `fanuc-lathe-*.nc` and `twin*.nc` outside its folder; finding H13a-3. A built-in now
     wins every tie, which `exit2-x9-ties` checks.)
   - X11(a) clears the default machine it set before X11(b) reads "Machine: none".
   - **X12 runs last.** Its machines carry channel blocks that no earlier criterion may see.
     X12(c) re-checks `fanuc-lathe-a.nc` with those machines defined but not chosen.
4. **Saving at the end.** Every document whose criterion edits it is saved and compared byte
   for byte with its golden. With Python the golden is in `expected/`; without Python it is
   in `expected-nopython/`. Several goldens may come from one input (feed, then speed, then
   renumber). Run each from the input and undo it, as `m6-lathe-scripts` does. Apply the last
   one again before the save, so that the saved bytes are the golden of that last run.

## What each criterion uses

X3, X4, X7, X10 and X13 have **no file here**:

| Criterion | Proven by |
|---|---|
| X3, X4 | `m6-dock-quit-*`, `m7-*` and `m7-session-1/2` |
| X7 and the templates half of X9 | moved to Phase 3 |
| X10 | the cumulative suite `m0`–`m13` plus CI |
| X13 | the committed owner-public programs: `tests/unit/ownerPublic.test.ts`, `tests/python/test_owner_public.py`, `m9-detect` and G11 |

### X1: Fanuc lathe (no machine)

`fanuc-lathe-a.nc` is **CRLF**, G-code system A, detected with margin 6. It starts with the
subprogram `O3102`, an edge break whose `U2. W-1.` is the `U` the hover reads and which
returns with `M99 P300`. Then comes the main program `O3101`:

- `G99`;
- `G50 S2400` with `G96`;
- the two-block `G71` with `P100 Q180`, and `G70 P100 Q180`;
- the finish on the same station with its second offset `T0111`;
- `M98 P3102` and the return target `N300`;
- the thread three ways: the two-block `G76`, a `G92` pass list and one `G32` pass;
- `T0100`/`T0300` as offset cancels on the retracts.

The subprogram stands first only because the fixture was written that way. The tool list resets
at a program start (a subprogram behind the main program is its own program, M13 NC-4, finding H13a-1
fixed), so the order does not change the result.

`fanuc-lathe-b.nc` is G-code system B, detected with margin 12:

- `G90 G95`;
- `G92 S2200`;
- `G96`;
- `G71`/`G70`;
- a `G78` pass list.

It has no `U`/`W` anywhere.

| Golden | What it holds |
|---|---|
| `fanuc-lathe-a.tools.json` | toolLines `[16, 34, 41]` (`T0101`, `T0111`, `T0303`; never `T0100`). Map `T1 — OD ROUGH`, `T1 — OD FINISH`, `T3 — THREAD`. Tool list: `T1` with offsets `01, 11`, and `T3`. |
| `fanuc-lathe-a.hover.json` | Hover on `G71`, `G76`, `X` (diameter) and `U` (incremental X), with line and column. Compare the markdown, or at least its first line and the sentences the criterion names. |
| `fanuc-lathe-a.feed90.nc` + `.report.json` | `F0.25`→`F0.23`, `F0.12`→`F0.11`, `F0.08`→`F0.07`. The `G76`, `G92` and `G32` leads stay and are listed. |
| `fanuc-lathe-a.speed110.nc` + `.report.json` | `G96 S200`→`S220`, `S240`→`S264`, `G97 S1000`→`S1100`. `G50 S2400` stays and is listed. The three thread blocks are flagged. |
| `fanuc-lathe-a.renumber.nc` + `.report.json` | The form as it opens (start 10, step 10). The `G71`/`G70 P100 Q180` become `P100 Q190`. The preflight asks about `M99 P300` (the run's confirm is "Continue"); it is left as written and reported as a warning on its line. The report holds preflight, summary, warnings and skipped rows in English. |
| `fanuc-lathe-b.tools.json` | The same shape for system B: toolLines `[6, 22]`, `T1`, `T2`. |
| `fanuc-lathe-b.feed90.nc` + `.report.json` | `G95` feeds scaled. The `G78` lead is listed. `G92 S2200` is a clamp, not a feed. |

Each run is one undo step.

### X2: Okuma and Sinumerik (no machine)

| File | Contents |
|---|---|
| `okuma-lathe.MIN` / `okuma-lathe.txt` | The same bytes: header `$EXIT2-OKUMA.MIN%`, written for the profile's assumed 1 mm unit. Six-digit `T010101`, `T030303` (the finish tool, which cuts under `G42` and takes its nose radius from the last pair), `T050505`, `T001111` and four-digit `T0909`. A `G04 F0.5` dwell at the groove bottom. The `G71` thread cycle with lead `F2`. A driven-tool section with `SB=2400 M13` after the main spindle's `M05`, `G181` and `G94`. |
| `sinumerik-lathe.MPF` / `sinumerik-lathe.txt` | The same bytes: header `%_N_EXIT2_SHAFT_MPF`. `MSG("…")` before each tool. `T="ROUGH" D1`, `T1 D1`, `T2 D1`, `T="THREAD_M44" D1`. `G96 S… LIMS=` three times. `DIAMON` is never written; `DIAMOF` comes halfway (line 28), and from there X is a radius, the thread included. Three `G33 … K1.5` passes; the last carries `F0.15`, the feed of the retract after it. |

| Golden | What it holds |
|---|---|
| `okuma-lathe.tools.json`, `sinumerik-lathe.tools.json` | As X1. Okuma: 5 tools. Sinumerik: `ROUGH`, `T1`, `T2`, `THREAD_M44`. |
| `okuma-lathe.feed90.MIN` + report | Six feeds scaled. The `G71` lead is listed. The dwell is left (counted in the summary). `SB=` is untouched. |
| `sinumerik-lathe.feed90.MPF` + report | Five feeds scaled. The `F0.15` of the `G33` block is refused and listed ("G33 takes its lead from I, J or K"). |
| `sinumerik-lathe.speed110.MPF` + report | `S` scaled. The three `LIMS=` stay as clamps. The three `G33` blocks are flagged. |
| `sinumerik-lathe.modal.json` | The whole report of `scripts/report_modal.py`, run as a user script: one row per line. `diameter` is `=on` (assumed, profile default `DIAMON`) up to line 27 and `off` from line 28 (the `DIAMOF` block). `x` is `diameter`, then `radius`. |

### X5: compare

`repost-old.nc` and `repost-new.nc` are copies of `compare/x5-repost/`. Make `repost-new.nc`
the active document and compare it with `repost-old.nc` in review mode with the
`fanuc-gcode` defaults and no machine.

| Golden | What it holds |
|---|---|
| `repost.review.json` | Exactly two changes. Go to line lands on 11 and 19 in the old file, 13 and 22 in the new one. |
| `repost.review.diff` | The review-mode export, byte for byte, with no newline after the last line. The headers are `--- repost-old.nc` and `+++ repost-new.nc` (the two document titles). |

### X6: search

`search-a.nc`, `search-b.nc` and `search-c.nc` are Fanuc mill programs:

- `T1` in A, written `T01` in C;
- `T10` (A) and `T12` (B);
- three comments naming `T1` or `T10`;
- `S1800`/`S2400` (A), `S2000` (B), `S2001` (C);
- `M8` twice in A and once each in B and C.

All goldens are whole address, scope "all open documents", and the rows are
`{ document, line, text }`.

| Golden | What it holds |
|---|---|
| `search-T1.json` | A:7 and C:6. |
| `search-S-gt-2000.json` | A:15 and C:7. |
| `search-M8.json` | The four `M8`. |
| `replace-M8-M88.json` | Replace all in `search-a.nc` (the active document): count 2, "Replaced 2 hits." It is one undo step; "into a new tab" leaves `search-a.nc` untouched. |
| `search-a.replaced.nc` | The document after the replace. |

### X8: checks and transformations

Four deliberately wrong programs. Each defect is announced by a `NEXT:` comment on the line
above it.

| Program | Profile | Every check it reports |
|---|---|---|
| `checks-mill.nc` | `fanuc-gcode` | 19 rows, every check that runs on the mill profile. |
| `checks-lathe.nc` | `fanuc-lathe` | 23 rows with no machine. `toolWordFormat` needs a machine that states its tool word, so it appears only under `X8 Lathe IS-B` (24 rows). |
| `checks-okuma.MIN` | `okuma-osp` | Written for a 1 µm machine. 21 rows with no machine (`machineReading` once for the program: a unit system), 20 under `X8 Okuma 1um`. |
| `checks-sinumerik.MPF` | `sinumerik` | 16 rows. The profile has one number reading, so no word depends on the machine and no `machineReading` row can exist. |

The point-less words are:

- `X50` in the mill program;
- `Z2000` in the lathe program;
- every word of the Okuma program.

Checks that a dialect cannot report are absent on purpose: `offsetCancelCut`, `cssClamp`,
`profileTargets` and `callInProfile` belong to turning; `requiredWords`,
`sequenceSeparator` and `programNameBlock` to Okuma; `speedAfterTapping`, `languageSwitch`
and `modalCallOpen` to Sinumerik; `doEnd` and `wordDigits` to Fanuc. `tapeMarkerInComment`
and `unclosedComments` run where the dialect has the marker and the comment end.

| Golden | What it holds |
|---|---|
| `checks-<x>.findings.<machine>.json` | `program_checks.py`. `<machine>` is `none`, `x8-lathe-is-b` or `x8-okuma-1um`; `machine` defines the machine. Every row with a line jumps to it. |
| `checks-<x>.extents.<machine>.json` | `extents.py`. With none, the point-less words are "not resolved", with the finding and the header saying so. A tool scope is named as the tool list names the tool, with the word as written (`T1 (T010101, line 9)`; M13 review, NC-9). |
| `checks-lathe.arith-z-0.5.none.nc` + report | Address arithmetic `subtract 0.5` on `Z`, no machine. It changes only absolute `Z` words with a point. It lists both `W` words and the point-less `Z2000`. The cycles it has not reviewed (`G71`, `G70`, `G84`) and the `G68.2` frame are left and listed. The `Z–5.` with an en dash (line 76) is left and listed as a word that cannot be read (M13 review, NC-5). |
| `checks-mill.blockskip.nc` | Block skip insert on the selection lines 18–23 (the `T2` operation), form defaults. |
| `checks-mill.blockskip.json` | The selection, both status texts, and that remove on the same selection gives the input back. |

Insert and remove are one undo step each.

### X9: user profile (user-profile half)

| File | Contents |
|---|---|
| `user/profiles/exit2-lathe.json` | `extends: fanuc-lathe`, `codes: exit2-lathe`, `detect.folders: ["{{SHOP}}"]`, `numbering.step: 5`. |
| `user/profiles/exit2-broken.json` | `numbering.step: "five"`. |
| `user/codes/exit2-lathe.json` | `extends: fanuc-lathe`, a builder `M13` "Chip conveyor on". |
| `shop/part-17.nc` | A turning program that writes `M13`. |

The run copies `shop/` and puts the absolute path of the copy for `{{SHOP}}`. It must be
exactly the path the document is opened with: folder rules do not resolve links, so
`/tmp` is not `/private/tmp`. It writes the profiles to `paths.profilesDir` and the code file
to `paths.codesDir`, and loads them.

The run makes `X9 Lathe` (in `user-profile.json`) and removes it, together with the user
files, at the end of X9.

| Golden | What it holds |
|---|---|
| `shop/part-17.renumber5.nc` | Renumber with the form as it opens: `N10`, `N15`, … with `G71`/`G70 P60 Q80`. |
| `user-profile.json` | The profile item (id, display name, origin `user`, file, parent, chain). The one problem row (`exit2-broken.json`, `exit2-broken · numbering.step`, "has to be a number") and that the broken profile is not loaded. The document opens with `exit2-lathe`. The renumber summary. The `M13` hover. `X9 Lathe` is offered (`compatible`) and applied: it is the document's machine, its number input is the machine's, and the decimal point counts. |

### X11: machine configurations and how numbers are read

`decimal-lathe.nc` is G-code system B (`G90 G95`, `G92 S`, detected). It has:

- `Z10.`, `Z1000`, `Z0.`, `X50`, `X50.`, `W-2000`, `W-5.`;
- the feed per minute `F155` under `G94`.

Under IS-B it is a sensible facing pass; read as written, the point-less words are
1000/50/2000 mm.

| Golden | What it holds |
|---|---|
| `machines.x11.json` | `machines.json` after (a): `Lathe IS-B` (IS-B preset; variants B, `uw`, `byLength`; power-on `G95`) and `Lathe calc` (its duplicate with the calculator preset), no default. Ids are masked. Compare with keys sorted. |
| `decimal-lathe.arith-z-0.5.{is-b,calc,none}.nc` + reports | IS-B: `Z1000`→`Z500`, `Z10.`→`Z9.5`. Calc: `Z1000`→`Z999.5`. None: `Z1000` is left and reported as depending on the machine, and `Z10.`→`Z9.5`. `W` words are listed in all three. |
| `decimal-lathe.checks.{is-b,calc,none}.json` | IS-B: `machineReading` rows for `Z1000`, `X50` and `W-2000` ("X50: 0.05 mm on machine 'Lathe IS-B'; X50. would be 50 mm"). Calc: no findings. None: every reading, the assumed default first. |
| `decimal-lathe.feed90.nc` + `.report.json` | The same bytes under all three: `F0.15`→`F0.14`, `F155`→`F140`. The report holds each run's summary. |
| `machine-params.{is-b,calc,none}.json` | `scripts/report_machine_params.py` run as a user script: every effective value with its source. With no machine, the system B and `G95` are `detected`. |
| `fanuc-lathe-b.under-a.json` | (e) `fanuc-lathe-b.nc` with the machine `X11 Lathe A` (system A). Variants from the machine, detection B with margin 12. The one status warning ("This program looks like G-code system "B"; machine "X11 Lathe A" is set to "A". Nothing was changed."). Tool list and scale feed read as system A: the `G78` lead is kept as "a threading cycle in another G-code system". Hover on `G92` (system A's threading pass), `G78` and `G95` (both not described under system A). |

### X12: channels and wait codes (last)

`twin-single.nc` holds two channels of a twin-turret lathe:

- `O1xxx` sections are channel 1 and `O2xxx` sections channel 2, alternating over four
  sections. Both call the subprogram `O9001`, which is outside every channel.
- The wait codes are `M1` + two digits.
- These defects are there on purpose:
  - `M150` exists only in channel 1 (its partner is missing);
  - `M160` exists only in channel 2;
  - `M130` is written twice in channel 1 and once in channel 2;
  - `M140`/`M141` are swapped between the channels;
  - `M170 P123` names a channel 3.
- `M110` (twice per channel) and `M120` repeat legitimately and give no finding.
- Only the wait codes are designed. The motion is not a coherent job: both channels face
  with `O9001` and command the main spindle between the same waits, which a real
  twin-turret program would not do. The file's third line says so.

`twin_CH1.nc` and `twin_CH2.nc` are the same job as one file per channel: `M150` only in
`CH1`, `M160` only in `CH2`.

| Golden | What it holds |
|---|---|
| `machines.x12.json` | `Twin 31i` (single file, section start `^O(?<channel>[12])\d{3}(?![\d.])`, end `M99`/`M30`, one blocking rendezvous rule "prefix `M1`, two digits, all channels"). `Twin 31i lines` (the same, partners from `M1\d\d\s*P(?<channels>\d+)`). `Twin 31i multi` (multi-file, `^(?<stem>.+)_CH(?<channel>\d+)\.nc$`). `Twin broken` (a section start that does not compile). |
| `twin-single.map.json` | The sections, the outside ranges and the marks. Every map row with its depth: two channel groups, each holding the tools, programs and `sync` rows of both its sections; then "Outside the channels" with the header comments and `O9001`. |
| `twin-single.tools.json` | `tool_list.py` with the channels in the context: the Channel column. Not run without Python. |
| `twin-single.check.json` | "Check wait codes" under `Twin 31i`: `count-mismatch` (line 18), `out-of-order` (37), `missing` (41, channel 1) and `missing` (54, channel 2), each with its text. The report title is "Wait codes, Twin 31i: 4 to look at". |
| `twin-single.lines.check.json` | (a2) Under `Twin 31i lines`: the same four plus `unknown-channel` (line 44). |
| `twin-single.nav.json` | Alt+F7 from the first line of each channel's first section, wrapping. The Shift+Alt+F7 step back. The matching mark of every mark (`none` where the check reports it). |
| `twin-single.split-1.nc`, `twin-single.split-2.nc` | The exact text of the two untitled documents: lines 1–4 and that channel's two sections. No newline at the end; nothing is written to disk. |
| `twin-multi.check.json` | (b) From `twin_CH1.nc` with `twin_CH2.nc` opened through the file dialog: two `missing` rows, `d1` = `twin_CH1.nc` line 17 and `d2` = `twin_CH2.nc` line 16. |
| `twin-broken.json` | (d) The channel block's problem, as the Machines page lists it. Compare the path and the text up to "is not a valid pattern": the rest is the JavaScript engine's own message, and WebKit words it differently. The block reads as layout `none`. Address arithmetic gives the same text under `Twin broken` and `Twin 31i`. |

(c) has no golden of its own. `fanuc-lathe-a.nc`, with the X12 machines defined but none
chosen, shows no channel item, and its map rows are `fanuc-lathe-a.tools.json`'s
`mapTools`.

## `expected-nopython/`: what `m13-exit-criteria-nopython` saves

This is the same run with `GEDIT_PYTHON` pointing at nothing (plan §2.2).

- **TypeScript features** work as with Python: detection, navigation, renumber with its
  rewrite, compare, search, block skip, the machine choice and the whole of X12 except the
  tool list. Their goldens here are the same bytes as in `expected/`: `fanuc-lathe-a.renumber.nc`,
  `shop/part-17.renumber5.nc`, `search-a.replaced.nc`, `checks-mill.blockskip.nc`,
  `twin-single.split-1/2.nc` and `repost.review.diff`. Their JSON goldens are read from
  `expected/`.
- **Script commands** (scale feed and speed, the tool list, the checks, the extents, address
  arithmetic, the two report scripts) show the Phase 1 "Python not found" message. Every
  document only they would have changed is saved **byte for byte as its input**, because an
  unedited document is never rewritten (D3). The goldens of this kind here are copies of the
  inputs:
  - `fanuc-lathe-a.feed90.nc`, `fanuc-lathe-a.speed110.nc`, `fanuc-lathe-b.feed90.nc`;
  - `okuma-lathe.feed90.MIN`, `sinumerik-lathe.feed90.MPF`, `sinumerik-lathe.speed110.MPF`;
  - `checks-lathe.arith-z-0.5.none.nc`;
  - `decimal-lathe.arith-z-0.5.{is-b,calc,none}.nc`, `decimal-lathe.feed90.nc`.
