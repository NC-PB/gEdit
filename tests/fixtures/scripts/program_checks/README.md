# Program checks goldens

The golden cases of `src-tauri/resources/scripts/program_checks.py` (plan §6 M10 WP10.2;
roadmap R7). Written as a contract by the M10 prelude (P10), before the script existed;
WP10.2 owns this folder, the script and `tests/python/test_program_checks.py`. Every program
here is synthetic and carries the `WRITTEN FOR GEDIT` marker (plan §9.1).

The script is `output = "report"`: it changes nothing and lists what it finds. **A check
that cries wolf on a correct program is worse than no check**: every check is driven by the
profile, the code database and the effective machine (AD-31), never by a dialect name in
the script, and where it cannot judge it says so once instead of flagging every line.

## A case

```
tests/fixtures/scripts/program_checks/<case>/
  input.nc        the program, stdin
  params.json     optional: the checks switched off (`{ "lowerCase": false }`)
  case.json       optional: profile, machine, machineName, scope (as tool_list and scale_feed)
  preceding.nc    optional: the lines above a selection (input.precedingLines, §7.5)
  expected.json   the whole report, as `gedit_nc.report` writes it
```

A case with a `machine` runs against the generated `tests/fixtures/resolved/effective/**`
entry for those parameters (`UPDATE_RESOLVED=1 npx vitest run tests/unit/resolved.test.ts`);
Python never merges a machine. The clean exit fixtures (`tests/fixtures/exit/**`) give **no**
row and no run note (`TestCleanPrograms`), and so do the owner-public programs except for the
findings `TestCleanPrograms` lists, each read against the manual.

`data-pins.json` pins the database and profile members the checks read (see "The data",
below); `TestShippedData` holds the shipped, resolved data to it. (WP10.2 first handed this
data over as a patch; the integration I10 wrote it into the shipped data.)

## The report

```json
{ "title": "Program checks",
  "columns": [ { "key": "line", "label": "Line" }, { "key": "check", "label": "Check" },
               { "key": "severity", "label": "Severity" }, { "key": "message", "label": "Finding" } ],
  "rows": [ { "line": 12, "check": "Spindle", "checkId": "spindleOff", "severity": "warning",
              "message": "G1 Z-2. F200.: a cut while the spindle is stopped (M5 on line 9)" } ],
  "message": "3 findings in 2 checks. Machine 'Lathe 2': numbers without a point are increments of 0.001 mm.",
  "findings": [] }
```

- One **row** per finding, ordered by line and then by the order of the table below. `check`
  is the check's label; `checkId` is the parameter id, which the table does not show and a
  test and the runtime scenario `m10-scripts` (H10) read. A row with a `line` is clickable
  (Results panel).
- `severity`: `error` — the control refuses the program or the program is broken where it
  stands (an unclosed comment, a `G70` target that is not there, code after the end);
  `warning` — almost certainly not what was meant (a cut with the spindle stopped);
  `info` — a list the user asked for (the stops) or a reading to confirm (the machine
  reading, the lower case the control may not take).
- `message` (of the report): `No findings.` or the count of findings and checks, then the
  machine, always last: `Machine '…': numbers without a point are increments of 0.001 mm.`,
  `… every number is read as written.`, `… every number counts in units of 0.01 mm.`, or
  `No machine chosen: where the presets read a number differently, the finding lists every
  reading.` (`No machine chosen.` on a profile with one reading).
- `findings`: **run notes only**, `info`, each once: a selection whose lines above were not
  sent (the state-carrying checks start judging where the selection sets the state), a
  selection at all (the program frame, the jump and profile targets need the whole program),
  a database that does not say which codes start the spindle and which moves are rapid. A
  check result is a row, never a finding. The one `warning` among them is the cut: a report
  never lists more than 5,000 rows (`MAX_ROWS`, the app's own limit): errors are kept first,
  then warnings, then information, the kept rows stay in line order, and the note says how many
  were left out (`TestLargeReports`).

## The checks (`[[params]]`, all `bool`, all on by default)

In the order a line's rows are listed. A check whose data the profile or database lacks does
not run and is not listed; the general checks run on every profile.

| id | severity | What it finds | Driven by |
|---|---|---|---|
| `programFrame` | error, warning | a program that runs into the next start marker or the closing tape marker without an end code; code after the end (`program.end`) or after the closing `%`, which never runs; the end written twice; a tape with only one `%` | `program.start`, `program.end`, the outline's `end` rules; a lone `%` the tokenizer reads as a marker on a profile without `syntax.header` |
| `spindleOff` | warning | a cut while the spindle is stopped (named with the code that stopped it), or a cut before the program starts a spindle — the latter only in a program that starts one somewhere, since a subprogram runs under its caller's spindle | `sets.spindle`, `sets.toolSpindle`, `sets.motion`; `M1=3` style spindle assignments |
| `toolChangeSpindle` | warning | the first cut after a tool change with no spindle start between (a machining centre's tool change stops the spindle; a turret's does not, so not on a lathe; a call of the tool already in the spindle is no change) | `toolCall`, `machineType` |
| `toolChangeInCycle` | warning | a tool change while a modal cycle (`activeCycle`, a Klartext modal call `M89` included) or a modal call behind a `cycle`-group keyword (`MCALL`) is in force; a Klartext definition alone is no active cycle (§7.4 rule 2) | modal state |
| `offsetCancelCut` | warning | lathe: a cut after a lone tool word the tool rule's `ignore` matches with a station (`T0100`), before the next tool call | `toolCall.ignore`, `toolCall.tool` |
| `speedAfterTapping` | error | a cut after leaving a tapping move that sets the speed to zero (`G332`), with no new speed word between | `sets.exitSpeed` |
| `cssClamp` | warning | constant surface speed with no upper speed clamp earlier in the program (once per program) | `sets.speedUnit`, `sets.speedLimit`, `addresses.speedLimitWords` |
| `threadUnderCss` | warning | a thread (a `pitchFeed` code that is no tap) cut under constant surface speed (once per stretch of it) | `pitchFeed`, `tapping`, the modal speed unit |
| `stateConflicts` | warning | a code written in a state the control refuses it in | `conflicts`: `tcp`, `radiusComp`, `lengthComp`, `cycle`, `surfaceSpeed`, `feedNotPerMinute`, `frame:<group>`, and `!` for "refused unless" |
| `requiredWords` | error | a code whose block lacks every word of its `requires` | `requires` |
| `aloneInBlock` | error | a code that has to stand alone shares its block; a macro call (`wordsAreData`) may carry its arguments behind it, nothing in front and no second code of its letter | `alone` |
| `rigidTapping` | error | a speed word or a move between the rigid-tapping call and its cycle, or the call inside a running tapping cycle | `tapping` on a non-modal code without `sets.cycle` (`M29`) and on the modal tapping cycles |
| `cycleUndefined` | error | a cycle call (`sets.cycle` `call`/`call-modal`) when **no** block before it wrote a code of group `cycle` that is not itself a call (the generic `CYCL DEF` counts, so a definition the database lacks is never reported) | `sets.cycle`, `group` |
| `modalCallOpen` | warning | a modal call behind a `cycle`-group keyword still in force at the program end | the `MCALL` rule of `scale_feed` |
| `languageSwitch` | warning | a code that switches the control to its ISO dialect (`G291`) | `sets.language` |
| `profileTargets` | error | lathe: the `P`/`Q` blocks of a reference rule naming both missing from the program, or `P` after `Q` | `numbering.references` |
| `callInProfile` | error | lathe: a subprogram call inside such a `P`…`Q` profile | the outline's `subprogram-call` rules |
| `jumpTargets` | error, warning | a jump whose target block or label is not in the program; a target written on two lines (a label defined twice is an error where the profile has `syntax.labels`); `GOTOF` to a label above, `GOTOB` to one below; `GOTOC` may miss | the `numbering.references` that rewrite (a rule with `rewrite: false` points into another program); labels at the head of a block |
| `doEnd` | error | `DO`/`END` loop numbers outside 1–3, an `END` with no open `DO` of its number, loops that cross, a `DO` with no `END` | `syntax.keywords` with both `DO` and `END` |
| `blockWords` | error | two plain speed words or two tool words in one block; more M codes than `syntax.maxMCodes` | `addresses`; `syntax.maxMCodes` |
| `toolWordFormat` | warning | a tool word the effective tool rule does not describe, and tool words of more than one length in a file | a `toolWord` machine variant |
| `programNameBlock` | error | a program name that shares its block with other words | every `program.start` pattern ends the line (`$`) |
| `sequenceSeparator` | error | a sequence name or block number with no space or tab behind it | `syntax.sequenceNames` |
| `wordDigits` | error | a word with more digits than the control stores, once converted to increments, under every reading the machine or the presets allow | `syntax.maxWordDigits` |
| `machineReading` | info | a length or angle word without a point whose value depends on the machine (AD-31): with a machine that reads increments, the value it is read as and what it would be with a point; none with calculator or `scale` input; with no machine, the readings of the presets, the assumed default first — one row per word where only point-less words differ, one row for the program where every number does (a unit system) | `machine_params`, `resolve_value`, `number_class_of` |
| `tapeMarkerInComment` | error | a `%` inside a comment (it ends the program when the tape is read in) | as `programFrame`'s tape marker |
| `unclosedComments` | error | a comment opened and not closed on its line | `syntax.comments` with an `end` |
| `brackets` | error | `( )` where they are syntax (not a comment), `[ ]` and `"` unbalanced in a block, and a `)` with no `(` | `syntax.comments`, `syntax.strings` |
| `lowerCase` | info | lower-case addresses outside comments and strings | `editing.forceUppercase` |
| `characters` | warning, error | non-ASCII characters outside comments and strings (warning); blocks longer than `syntax.maxLineLength` (error) | `syntax.maxLineLength` |
| `stops` | info | every program stop and optional stop, as a list | the outline's `stop` rules |

### What a cut is

A block cuts when it moves an axis, or writes a feed move that is a keyword of its own (a
Klartext polar `LP`/`CP` carries no axis word), under a `sets.motion: 'feed'` code (the modal
one in force, or the block's own non-modal one), with no rapid word (`addresses.rapid`) and no
code whose axis words are data or a machine position; or when it runs a cycle (a
`sets.cycle: 'start'` code, a call of the defined cycle, a positioning block under a modal
cycle, `M89` or an `MCALL`). The blocks of a contour definition (`contour: 'open'` to
`'close'`: the Okuma LAP shape between `G81` and `G80`) do not cut. A spindle is running when
a `sets.spindle`/`sets.toolSpindle` code or a spindle assignment (`M1=3`) started it, judged
before and after the cut's own block; after an M code the database does not know, the
spindle state is unknown until the next one it knows.

## The data (`data-pins.json`)

| Member | Values | On |
|---|---|---|
| `sets.spindle` | `on`, `off` | `M3`, `M4` (Klartext `M13`, `M14`) on; `M5` off |
| `sets.toolSpindle` | `on`, `off` | Okuma driven tool: `M13`, `M14` on; `M12` off |
| `sets.motion` | `rapid`, `feed` | `G0` rapid; the feed moves and the thread passes of every database, the lathe single cycles (`G90`, `G92`, `G94`, `G77`–`G79`), the Klartext path functions |
| `sets.radiusComp` | `on`, `off` | `G41`, `G42` / `G40`; Klartext `RL`, `RR` / `R0` |
| `sets.lengthComp` | `on`, `off` | Fanuc mill `G43`, `G44`, `G43.4`, `G43.5` / `G49` |
| `sets.exitSpeed` | `zero` | Sinumerik `G331`, `G332` |
| `sets.language` | `iso`, `native` | Sinumerik `G291`, `G290` (new entries) |
| `conflicts` | conditions | Fanuc mill: `G28`, `G30`, `G53`, `G68`, the drilling cycles, `G93`, `G95`, `G96` under TCP; `G43.4`/`G43.5` under a cycle, constant surface speed, a feed other than per minute, or a `frame`, `polar` or `cylindrical` frame; `G68.2`–`G68.4` under TCP, compensation, a cycle, surface speed, or a `frame`, `mirror`, `scaling`, `polar` or `cylindrical` frame; `G53.1` unless a `frame` frame is open. Klartext `TOOL CALL`, `M91`, `M92` under TCP. Sinumerik `G75` under radius compensation or TCP. Okuma `G140`, `G141`, `G15`, `G16` under surface speed or nose-radius compensation |
| `alone` | `true` | Fanuc `G53.1`, `G65`; Okuma `M110` |
| `requires` | words | Klartext `PLANE …` (`MOVE`, `TURN` or `STAY`); Okuma `G96`, `G97` (`S`) |
| `contour` | `open`, `close` | Okuma `G81`, `G82`, `G83` / `G80` |
| `syntax.maxWordDigits` | 8 | `fanuc-gcode` (and the lathe through `extends`) |
| `syntax.maxMCodes` | 8 | `okuma-osp` |

## What M9 and P10 leave for these checks (plan §6 M10 P10 item 4)

- **A call after a definition the database lacks.** The modal state reads a `CYCL CALL`
  after an unknown `CYCL DEF` as "nothing defined" (§7.4 rule 8). P10 added cycles 202, 208
  and 262; a call after any other unknown definition is still not reported, because the
  generic `CYCL DEF` entry counts as a definition (`cycleUndefined`).
- **`M89`** is `verify` and modal only where a machine parameter says so (§10.2 M9-4); the
  checks read the modal call the interpreter keeps and say nothing more about it.
- **Klartext polar moves** (`LP PR… PA…`, `CP`) carry no axis word; a feed move written as
  a keyword of its own counts as a move by its keyword.
- **The main spindle** (decision of 2026-10-04): `S1=` and `S[1]=` are the main spindle's
  speed where `addresses.mainSpindle` is 1 (`speedAfterTapping`, `rigidTapping`); `M1=3`
  starts the main spindle (`spindleOff`).
- **Tool centre point control** is the modal `tcp` (§7.4 rule 14), the frame in force the
  modal `frame` (rule 13): `stateConflicts` reads them, not a list of codes.
- **`G931`** (travel time) has its own feed unit and is never scaled (§7.16 #96); no check
  converts it in M10.

## Not checked, and why

- Okuma `/` in the middle of a block (§9 item 2): the Fanuc tokenizer reads a mid-block `/`
  the same way, and a Fanuc parameter allows it there; nothing in the data tells them apart.
- Okuma `G136` alone in its block: the manual states it for ending a `G137` conversion; the
  owner's own post writes `G136 M109` after `G138`, and no rule says that is wrong.
- Okuma after `G137` a first block without both `X` and `Y`, or `G91` straight after it;
  a Y-axis move before the first `G136`/`G138`: they need a "next block" rule and a machine
  fact the data does not hold.
- The two-turret spindle rule: a two-turret program is two channels (M12, §7.17).
- A code a TNC 640 refuses (`M104`, `FN 15`, cycles 1–6, …): the notes put it behind a
  machine setting for the control generation, which the machine configuration does not have.
- Fanuc lathe `G69` ending a tilted plane instead of `G69.1`, and `G53.1` "directly after"
  `G68.2` (only "while a `frame` frame is open" is checked).
