# Extents goldens

The golden cases of `src-tauri/resources/scripts/extents.py` (plan §6 M10 WP10.3; roadmap
R3 and R6). P10 wrote this file as the contract before the script existed; WP10.3 owns this
folder, the script and `tests/python/test_extents.py` from Wave A on, and the sections below
are what the script does (the changes to P10's draft are listed at the end). Every program
here is synthetic and carries the `WRITTEN FOR GEDIT` marker (plan §9.1).

The script is `output = "report"` with no form: the smallest and largest value per axis, for
the whole program, per work offset and per tool, in **effective values** (`resolve_value`).
A value the script cannot be sure of is **not resolved**: it is counted, never guessed. That
includes every machine-dependent word while no machine is chosen (AD-31, D57).

## A case

```
tests/fixtures/scripts/extents/<case>/
  input.nc        the program, stdin
  case.json       optional: profile, machine, machineName (as tool_list and scale_feed)
  preceding.nc    optional: the lines above a selection (input.precedingLines, §7.5)
  expected.json   the whole report, as `gedit_nc.report` writes it
```

A case with a `machine` runs against the generated `tests/fixtures/resolved/effective/**`
entry for those parameters (`UPDATE_RESOLVED=1 npx vitest run tests/unit/resolved.test.ts`);
Python never merges a machine.

## The report

```json
{ "title": "Extents",
  "columns": [ { "key": "where", "label": "Where" }, { "key": "axis", "label": "Axis" },
               { "key": "min", "label": "Min" }, { "key": "minLine", "label": "At line" },
               { "key": "max", "label": "Max" }, { "key": "maxLine", "label": "At line" },
               { "key": "unresolved", "label": "Not resolved" } ],
  "rows": [ { "where": "Program", "scope": "program", "axis": "X (diameter)", "axisId": "X",
              "min": "20", "minLine": 12, "max": "100", "maxLine": 21, "unresolved": 4, "line": 21 } ],
  "message": "No machine: readings assumed from the profile defaults, and a word whose reading depends on the machine is not resolved. X is a diameter: diameter programming is on (assumed from the profile). 6 positions not resolved; the findings say why.",
  "findings": [ { "line": 10, "severity": "warning", "reason": "multi-pass", "message": "G71, 2 blocks: …" } ] }
```

- **Rows**, in this order: the whole program (`scope: "program"`); then, when the program
  writes a work-offset code at all, each work-offset group in program order (`"offset"`,
  `where` names the code and its line: `G55 (line 14)`; positions before the first one are
  `No work offset`), each followed by the tools that cut in it, in order of first use
  (`"tool"`: `G55, T2 (line 15)`, the line of the tool call); a program with no offset code
  lists its tools right after the program rows (`T1 (T0101, line 6)`). A tool is named as the
  tool list and the program map name it (M13 review, NC-9), followed by the word as written
  when that differs (`T1 (T010101, line 9)`, `ROUGH (T="ROUGH", line 5)`, `T5 (line 3)`).
  A program after the first one in the file (a subprogram behind `M30`) starts with no tool
  and no known position (M13 review, NC-4): what it moves before its own tool call is in the
  program and offset rows only, and an incremental word before it states the axis is
  `called-program`. Last come the machine
  positions (`"machine"`). Inside a scope, one row per axis in the order of the profile's
  `addresses.axes` (an incremental twin is not an axis of its own); an axis with neither a
  value nor a position that was not resolved has no row, and one with only the latter has
  a row with empty `min`/`max`. `scope` and `axisId` are not shown and are what a test reads;
  `line` (the line of the `max`, else of the first position not resolved) makes the row
  clickable.
- `min`/`max` are plain decimal text in the program's units — the units in force at the first
  value; a program that switches converts to them and says so — rounded half away from zero
  to 0.0001 mm (0.00001 inch), trailing zeros dropped; an axis of `addresses.angular` in
  degrees to 0.0001°. `minLine`/`maxLine` are the first line that reached the value.
- **One X column, in diameter values** on a turning profile (`machineType: lathe` with `X` in
  `addresses.diameter`): every X word is read by `ModalInterpreter.diameter_reading` (AD-19
  rule 11), and a radius word — `DIAMOF`, `G137`, or `DIAM90` with incremental distance, or
  `X=IC(…)` under `DIAM90` — counts double; the axis reads `X (diameter)`. A milling profile
  that lists diameter words (`sinumerik-mill`) keeps a plain `X` column, in which a diameter
  word counts half.
- **Machine positions** — the blocks whose code has `axisWords: 'machine'` (`G28`, `G30`,
  `G53`, `M91`, `M92`, `G75`, `SUPA`, `G153`; §7.16 #59) — are rows of their own, one per
  axis word (`scope: "machine"`, `where`: the code and its line, `axis`: the address as
  written, `U` or `IZ` included, `axisId` the axis it moves, `min` = `max` = the word's
  effective value, empty and `unresolved: 1` when it has none). They never enter a range,
  and the axes they moved are in an unknown place afterwards.
- `unresolved` counts the positions of that axis in that scope that were not resolved (the
  table below says which); the findings say why.
- `message`: the machine first — `Machine '…'.` or `No machine: readings assumed from the
  profile defaults, and a word whose reading depends on the machine is not resolved.` — then,
  on a turning profile, the diameter mode at the start with its source (`assumed from the
  profile`, `the machine`, `detected in the program`) and every code that switches it with
  its line (the first five); then how many positions were not resolved, or `No positions
  found.`

## Findings: one per kind, counted (`reason` is the kind; the app ignores the member)

Each finding stands at the first line of its kind and counts the rest; the kinds that name a
code (`multi-pass`, `cycle`, `cycle-position`, `unknown-code`, `frame`, `data`) have one
finding per code.

| `reason` | severity | What was not resolved |
|---|---|---|
| `machine-dependent` | warning | a word whose reading depends on the machine (no machine chosen and the profile's presets read it differently), with the readings of the first: `is-b: 0.05 mm; …` |
| `expression` | warning | a variable or an expression (`X#101`, `Z+Q5`, `X=V1+2`); `AC(…)`/`IC(…)` around a plain number are read (Sinumerik's value functions) |
| `distance-unknown` | warning | an axis word before the program (or the power-on state) says absolute or incremental |
| `diameter-unknown` | warning | an X word while `DIAM90` is in force and the distance mode is not known |
| `incremental-start` | warning | an incremental word whose start is not known: the start of a run, or after a machine position, a cycle, a frame, a shift or a value that was not resolved |
| `called-program` | warning | (M13 review, NC-4) an incremental word in a program after the first one in the file, before that program states the axis: it moves from where the calling program left the tool; one finding per program |
| `frame` | warning | a position inside a coordinate frame (the modal `frame`, §7.4 rule 13: a tilted plane, a rotation, a mirror, a scaling, `TRANSMIT`, polar interpolation); one per position |
| `unknown-code` | warning | the positions of a block that writes a code under the database's motion letter (`G`) that the database lacks: it may hide a machine position or a frame |
| `multi-pass` | warning | a cycle start whose words are data (the Fanuc lathe `G71`–`G73`): the control computes its passes; one per block on each axis of the plane |
| `cycle` | warning | a cycle whose positions are its parameters (written as a call, `CYCLE81(…)`, or defined, `CYCL DEF 200`), one per block that runs it on the tool axis (`Z` in `XY`, else the plane's axes); a call while the database describes no defined cycle |
| `cycle-position` | warning | axis words that are a called cycle's own positions (`position: 'other'`: `CYCL CALL POS`) |
| `arc` | warning | an arc whose plane, centre or radius is not known (`CT`, `CIP`, a centre written as an expression, a radius shorter than half the chord): its end points are in the ranges, its bulge is not; one per arc on both plane axes |
| `polar` | warning | a polar move (`LP`, `CP`) with no pole, or no radius or angle to start from |
| `rotary` | warning | (M10 review, NC-10) a linear position written while a rotary axis that turns it stands turned or at an unknown angle, with tool centre point control off (above); one per position, one finding per set of rotary axes |
| `data` | info | a block whose axis words are values (`axisWords: 'data'` / `wordsAreData`: `G92`, `G52`, `G4 X`, `CYCL DEF 7`, `TRANS`, `BLK FORM`): left out of the ranges |
| `selection` | info | a selection run without `input.precedingLines`: it starts from the power-on state |

## What the database decides (R3; no list of machine codes in the script)

- `axisWords: 'machine'` → the machine-position rows; `axisWords: 'data'` / `wordsAreData`
  → left out of the ranges. A data block's word that its code declares as a value of another
  kind (`CodeParam.unit` `dwell`, `count`, `increment`, `angle`: the `X` of `G4`) keeps the
  position; any other (a shift, a coordinate set) leaves it unknown, and a `wordsAreData`
  block (a macro call) leaves every axis unknown.
- A code with `pole: 'set'` is the **pole** (Klartext `CC`, §7.16 #97; the marker since the
  M10 review, NC-2, which address arithmetic reads too): the centre of the `C` arcs and of
  the polar moves after it.
- A code with `shift` (M10 review, NC-7: `G52`, `G92`, the lathe `G50`, `G10`, Sinumerik
  `TRANS`, `ATRANS`, Okuma `G50`) starts a group of its own when it writes an axis word, or
  no value at all (`TRANS` alone, a reset): `G54 + G52 (line 8)`, the work offset it is in
  and the shift. The positions after it are in another system than those before. A clamp
  (`G50 S2000`) starts none; writing the same work offset again stays in the shifted group.
- A linear position written while a **rotary axis** that turns it (ISO 841: `A`/`B` turn
  `Z`, `B`/`C` turn `X`, `A`/`C` turn `Y`; on a lathe `C` does not turn `X`) stands turned
  or at an angle not known, and tool centre point control is off and no frame open, is a
  position of the machine's axes, not of the workpiece: not resolved (`rotary`, M10 review,
  NC-10). A rotary axis the program has not written yet counts as unknown when the program
  writes it later (the positions before it are held to the end of the walk); one it never
  writes does not exist for it, so a three-axis program on a profile that lists `A`, `B`,
  `C` is resolved as before. `gedit_nc.RotaryState` is shared with address arithmetic.
- A code of the `offset` group starts a work-offset group when it changes the offset (the
  same code again does not, unless it writes new values after positions: a second
  `CYCL DEF 7` datum shift).
- A position **inside a coordinate frame** (the modal `frame`) is not resolved. Under tool
  centre point control (the modal `tcp`: `TRAORI`, `G43.4`, `M128`) `X`, `Y`, `Z` are the tool
  tip in the workpiece and **are** in the ranges.
- Incremental words: `sets.distance` (`G91`), `addresses.incremental` (R6's `U`/`W` choice on
  the effective profile; with `incrementalAddresses: none` `U` and `W` are axes of their own),
  the Klartext `I` prefix, Sinumerik `IC(…)`.
- A cycle (`sets.cycle` `start` or `define`, written, defined or in force under a modal cycle
  or a modal call): an ISO cycle written as a word (`G81`, `G74`) has its positions in the
  block's axis words, which are resolved (an absolute `Z` of `G81` is the hole bottom); one
  whose positions are its parameters is `cycle`. After a block that runs a cycle, the tool
  axis (`Z` in `XY`; in another plane every axis the block wrote and the plane's) is in an
  unknown place.

## The geometry vocabulary (the one place the script names codes)

The database has no arc data yet, so the script carries a small table, documented in its
docstring: `G2`/`G3` clockwise and counter-clockwise (ISO, every shipped G-code dialect);
the centre words `I`/`J`/`K` on `X`/`Y`/`Z` (the profile's `addresses.arcCenter` says which a
dialect writes, `arcCenterMode` how); the radius words `R` and `CR` (negative: the arc over
180°); Klartext's direction word `DR±`, polar words `PR`/`PA`; the arcs it cannot compute
(`CT`, `CTP`, `CIP`); Sinumerik `TURN=` (full turns) and `AC()`/`IC()`. Arc extremes are
taken in the active plane (the modal `plane`; Klartext from the tool axis, rule 15): the
quarter points of the swept circle, so an arc's bulge is in the range; on a lathe in `G18` the
X diameter is halved for the geometry and doubled back.

## Decisions WP10.3 made (P10 left them open; recorded in its hand-off)

- **Klartext polar moves are resolved from the pole**: `LP` with `PR`/`PA` (or `IPR`/`IPA`
  from the last polar move about the same pole), `CP` around the pole from where the tool is
  (`PA`, or `IPA`, which may run over full turns). With no pole, or a missing radius or angle
  that no earlier polar move gives, the move is `polar` (golden `klartext-polar`).
- **The rotary axes** of `sinumerik-mill` and Klartext (P10, §7.16 #111) are rows in degrees.
- **Cycle depths of Klartext and Sinumerik cycles are not computed**: the database marks the
  absolute tool-axis parameters (`Q203`, `RTP`/`RFP`/`DP`, R8) but not the depths relative to
  them (`Q201`, `DPR`; and Siemens' manuals say `DPR` wins over `DP` when both are written),
  so putting `DP` into a range could show a depth the cycle never reaches. Such a cycle's
  runs are counted as `cycle`.

## Changes to P10's draft of this file

`min`/`max` are plain rounded decimals rather than the P1 number format (a computed arc
extreme has no written form to follow); the `data` info is one per code, counted, rather than
one per block; a row may carry only positions that were not resolved; the machine rows name
the address as written; the vocabulary of `reason` ids above is new.
