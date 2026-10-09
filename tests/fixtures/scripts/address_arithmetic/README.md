# Address arithmetic goldens

The golden cases of `src-tauri/resources/scripts/address_arithmetic.py` (plan §6 M10
WP10.4; roadmap R3, R6 and R8). Written as a contract by the M10 prelude (P10 item 3), before
the script existed; WP10.4 owns this folder, the script and `tests/python/test_address_arithmetic.py`
and wrote the cases (listed at the end). Every program here is synthetic and carries the
`WRITTEN FOR GEDIT` marker (plan §9.1); none is copied from a machine, a CAM system or a
customer.

The script adds, subtracts, multiplies or divides the **literal** values of chosen
addresses — a program shift is its daily use: "the part sits 0.5 mm higher, move every Z".
It is `output = "replace"` with `envelope = true`, so each case checks the text it hands
back byte for byte **and** what it says about what it did not touch. **NC correctness first:
a block it cannot judge is left as written and listed, never shifted in part** (§6 M10
"NC correctness", R8).

## A case

```
tests/fixtures/scripts/address_arithmetic/<case>/
  input.nc        the program, stdin
  params.json     what the user filled in (the form below)
  case.json       optional: profile, machine, machineName, scope (a selection)
  preceding.nc    optional: the lines above a selection (input.precedingLines, §7.5)
  expected.nc     the text handed back, byte for byte
  envelope.json   { "message": …, "findings": [ … ] } of the envelope
```

`case.json` is the format `scale_feed` and `tool_list` already use: `profile` (the profile
id; absent: the folder name's dialect prefix as in `scale_feed`), `machine` (a partial
`MachineParams`, §7.15, applied as the document's machine — the same `machine` member as a
modal golden, §7.4), `machineName` (the name the run reports, as in
`tests/python/test_tool_list.py` `context_of`). A case with a `machine` runs against the
generated `tests/fixtures/resolved/effective/**` entry for exactly those parameters
(`UPDATE_RESOLVED=1 npx vitest run tests/unit/resolved.test.ts`); **Python never merges a
machine**. A case without one is "no machine": the profile's defaults, and every word whose
reading depends on the machine is left alone (D57).

## The form (`[[params]]` of the script header)

The ids are pinned so the runtime scenario `m10-arith` (H10) and the user guide (WP10.5)
can name them; labels and help texts are WP10.4's.

| id | type | values | default |
|---|---|---|---|
| `operation` | choice | `add`, `subtract`, `multiply`, `divide` | `add` |
| `operand` | number | the value; for `add`/`subtract` in the program's units, for `multiply`/`divide` unit-free | required |
| `addresses` | address-list | the addresses to change; `G`, `M`, `N`, `O`, `T` are never offered | `["Z"]` |
| `arcCentres` | choice | `auto` (off for add and subtract, on for multiply and divide), `yes`, `no`: also change the arc centre words **of the chosen axes** — `I` with `X`, `J` with `Y`, `K` with `Z` | `auto` |
| `xOperand` | choice | `diameter`, `radius`: what the operand means for the profile's `addresses.diameter` words (AD-19 rule 11); ignored on a profile without them **and on a milling profile** (M10 review, NC-1: Sinumerik milling lists `X` for `DIAMON`; there the operand is a plain coordinate, a radius word moves by it and a word written as a diameter by twice it) | `diameter` |
| `decimals` | choice | as `scale_feed`: `keep`, `0`–`4` (the P1 number format); `keep` keeps the decimals a value was written with and adds the ones the exact result needs in the word's own form, at most four | `keep` |

A `count` or `increment` parameter of a code (`CodeParam.unit`, §8.2: dwell times, repeat
counts `K`/`L`, block and program numbers) is changed only when its address is in
`addresses` **and** the word is not an arc centre picked up by `arcCentres`.

The form offers `X Y Z U V W A B C I J K R`; a context that names `G`, `M`, `N`, `O` or `T`,
an empty list, an unknown operation, a value that is not a number, a division by zero or a
multiplication by zero is refused with a message on stderr and exit 1 (nothing applied).
Feeds and speeds are `scale_feed` and `scale_speed`'s. The centre word of a diameter axis
(`I` on a lathe) is a radius value, so an add or subtract moves it by the radius of the X
operand.

**Multiply and divide** (M10 review, CODE-8) scale a distance like a position: an
incremental word (`G91`, a twin, the Klartext `I` prefix, `IC()`) is scaled, and the distance
mode does not matter. What would stay unscaled while the positions around it are scaled is
refused (`not-scaled`): a coordinate shift or set (`CodeEntry.shift`) written with a chosen
axis, and — when the tool axis is chosen — a cycle that writes a reviewed `'none'` parameter
that may be a length (no `unit` of `dwell`, `count` or `angle`, no feed or speed class, not
0): a peck depth `Q`, Klartext `Q201`, Sinumerik `SDIS`. The radius `R` of an arc is scaled
only when `R` is chosen (the form says so).

## The envelope

`message`, one paragraph, in this order:

1. what was done: `Added 0.5 to Z in 12 words on 10 blocks.` (`Subtracted`, `Multiplied`,
   `Divided` likewise; `Changed nothing.` when nothing qualified);
2. what was left, counted by reason in the order of the table below:
   `Left 4 blocks and 3 words as written: 2 machine positions, 1 inside a frame, 1 cycle not
   reviewed, 3 incremental words.` — only the reasons that occurred;
3. the machine, always last: `Machine 'Lathe 2': numbers without a point are increments of
   0.001 mm; X is a diameter.` or `No machine chosen: words whose reading depends on the
   machine are left alone.` (the form's note, WP10.4 Deliver).

`findings`: one per refused **block** and one per skipped **word**, in line order (a word
finding after the block's own, if any), and the run notes below. At most 500 are listed; the
message then says how many further findings there were, before the machine sentence. Each is
`{ "line", "severity", "message", "reason" }`. `reason` is one id of the vocabulary below;
the app ignores members it does not know (`core/scripting/apply.ts`), so it costs nothing
on screen and lets a test and a runtime scenario count reasons without parsing sentences.
`message` starts with the block or word **as written**, then `: `, then the reason in our
own words; the exact wording is WP10.4's and its goldens pin it.

A refused block gets exactly **one** finding: the first reason of the table that applies,
and none of its words gets one.

**A block is judged only when it matters**: it writes a word of a chosen address (or an
incremental twin of one), it opens a coordinate frame, or it belongs to a cycle while the run
moves positions (a chosen address is an axis of `addresses.axes` or a twin). A `G28 X0 Y0`
under a Z shift has nothing to change and is not listed.

## The vocabulary

### Blocks left as written (`severity: "warning"`)

| `reason` | When | What it reads |
|---|---|---|
| `unknown-code` | the block writes a code the database lacks under the letter the database writes its moves with (`G` on the ISO dialects; rule 9 of AD-19 reads it as changing nothing; here it might hide a machine position or a frame). Every keyword of the shipped profiles is in its database; a `CYCL DEF` number the database lacks is `cycle-not-reviewed` | the interpreter's index |
| `machine-position` | a code with `axisWords: 'machine'` (`G53`, `G28`, `G30`, `M91`, `M92`, `G75`, `G74`, `G153`, `SUPA`) | `axis_words_of` |
| `frame` | the block opens a frame (`frame: 'open'`, or written with values where `frameWithoutValues` says so) or runs while one is in force | `frame_of`, modal `frame` (§7.4 rule 13) |
| `rotary-without-tcp` | while tool centre point control is off, the block writes a chosen linear word that a rotary axis turns (ISO 841: `A`/`B` turn `Z`, `B`/`C` turn `X`, `A`/`C` turn `Y`; on a lathe `C` does not turn `X`) while that axis stands turned, at an unknown angle (a variable, an incremental move, a machine position), or before the program first writes it — a rotary position stays in force after the block that wrote it (M10 review, NC-4). The message says "moves B together with Z" when the block writes the turning axis itself | modal `tcp` (§7.4 rule 14), `gedit_nc.RotaryState` |
| `cycle-outside` | (WP10.4) the block runs a cycle that started or was defined **above the selection** and that this run would have moved there (a selection cannot change those lines), or the block itself starts above the selection | the primed walk |
| `cycle-not-reviewed` | a block that runs or defines a cycle (an entry with `sets.cycle` `'start'` or `'define'`; a `'call'`/`'call-modal'` block, a positioning block under a modal call, or a block under a modal cycle, judged by the cycle in force) whose entry has no parameter with a `position` role, or that writes a parameter without a role, or an argument the entry does not describe; also a cycle that resolves to the generic stand-in (a `CYCL DEF` number the database lacks), **a call the database does not know with a number among its arguments** (`CYCLE61(50,0,2,-1,…)`, `POCKET4(…)`: found at the M10 integration, where it was skipped in silence while every Z word around it moved), and **a call while no reviewed cycle is defined** (`definedCycle` is `null`, which is what a definition the database lacks leaves, §7.4 rule 8: the call runs positions from a definition that was left as written) | `position_of`, `params`, modal `definedCycle` |
| `cycle-position` | the cycle's entry has a parameter with role `'other'` (`CYCL CALL POS`, `CYCL CALL PAT`, `CYCLE800`) | `position_of` |
| `cycle-mode` | a `'mode'` parameter written with a value other than empty or `0` (`_AMODE`, `_DMODE`, `_GMODE`, `_AXN`) | `position_of` |
| `cycle-plane` | a `'tool-axis'` parameter is written (or in force) while the plane is not `XY`: the tool axis is then not certain | modal `plane` (rules of §7.4, rule 15 for Klartext) |
| `cycle-expression` | a `'tool-axis'` parameter written as a variable or an expression (`Q203=Q10`, `RFP=R1`) while the run moves the tool axis; also (WP10.4) an axis word of a chosen address in a cycle block written as one (`X30. Y30. Z#101` under `G83`) | the token |
| `cycle-unresolved` | (WP10.4) a position of a cycle block that the run would move has no resolved value (a point-less `R2` with no machine chosen): the cycle cannot be moved in one piece | `resolve_value` |
| `pole` | (M10 review, NC-2) the block sets the pole (`pole: 'set'`, Klartext `CC`) or moves around it (`pole: 'use'`: `C`, `LP`, `CP`, `CTP`) while the run changes an axis of the plane in force, and the pole cannot be moved: one of its words is a variable or has no resolved value, the plane is not known, or the run multiplies or divides (the polar radii would stay); the pole and every move around it until the next pole are refused together | `CodeEntry.pole`, modal `plane` |
| `arc-geometry` | (M10 review, NC-3) an arc whose centre or intermediate point is an absolute coordinate of a chosen axis — `I=AC(…)`, `J=AC(…)`, `K=AC(…)`, the `CIP` point `I1=`, `J1=`, `K1=` (`CodeParam.axis`) — and that coordinate cannot be computed (`I=AC(R1)`, `I1=R2`), or cannot be changed while the end point is | `CodeParam.axis`, the value functions |
| `not-scaled` | (M10 review, CODE-8) a multiply or divide: a coordinate shift or set (`CodeEntry.shift`) written with a chosen axis, or a cycle that writes a length parameter it does not scale (above) | `CodeEntry.shift`, `position_of` |

### Words left as written (`severity: "info"`; the rest of the block is changed)

| `reason` | When |
|---|---|
| `unreadable` | (M13 review, NC-5; **`severity: "warning"`**, the block still goes to the old position) the address of a chosen word stands alone, followed by a character no control reads: `Z–5.` with an en dash (U+2013) or a minus sign (U+2212) pasted for `-`. The finding names the character; the summary counts "words that cannot be read" |
| `data` | a code whose axis words are data (`axisWords: 'data'` or `wordsAreData`: `G92`, `G52`, `G10`, `CYCL DEF 7`, `TRANS`) — its words are values, not positions. The pole (`pole: 'set'`) is not: its words in the plane are positions |
| `incremental` | the distance mode is incremental (`G91`), or the address is an incremental twin (`addresses.incremental`, R6's `U`/`W` choice), or a Klartext `I` prefix (`IZ`) |
| `expression` | a variable or an `=` expression (Okuma `X=V1+2`, Sinumerik `X=R1`); a value function around a plain number is read (M10 review): `Z=AC(3.25)` is an absolute position whatever the distance mode, `Z=IC(2)` an incremental distance (`incremental` on add and subtract, scaled on multiply and divide) |
| `machine-dependent` | the word has no resolved value (`resolve_value` is `None`), which includes every machine-dependent word while no machine is chosen: "the reading depends on the machine; choose a machine" |
| `count` | a `count`/`increment` parameter reached through `arcCentres` (`G83 … K3` under multiply) |

`incremental` also covers a distance mode that is **not known** (no code set it before the
block: a Fanuc or Sinumerik program that never writes `G90`): adding to an incremental word
adds the offset twice, so a word is moved only while the mode is known to be absolute.
`machine-dependent` also covers a word with no number class on the profile (the Fanuc mill
`Q` of `G83`), and a no-machine result that two presets would write differently.

### Run notes

| `reason` | `severity` | When |
|---|---|---|
| `selection` | `warning` | a selection run without `precedingLines` (the state above it is unknown), or a block that starts above the selection and runs into it |
| `no-database` | `warning` | the context carries no code database: nothing is changed |
| `unknown-code-note` | `warning` | (M10 review, NC-5) a code the database lacks, under the move letter, in a block with nothing the run would change (`G16` alone, before the database knew it): one row per code, at its first line, with the number of blocks. It may change how the blocks after it are read |

### Notes (`severity: "info"`; the word **was** changed)

| `reason` | When |
|---|---|
| `rounded` | `write_back` rounded the result to a whole number of increments or units, half away from zero (`Z1000` + `0.0005` under IS-B → `Z1001`) |

## Cycles are moved in one piece (WP10.4)

A cycle and the blocks that run it form one **group**, moved together or not at all:

- a modal cycle written as a word (`sets.cycle: 'start'`, `modal`): its block and every
  positioning block, or block writing one of its parameters, until the interpreter's
  `activeCycle` ends (`G80`, a motion code);
- a cycle written as a call: its block; behind a keyword of the database's `cycle` group
  that sets nothing (`MCALL`) also every positioning block until that keyword stands alone;
- a definition (`'define'`, or a `CYCL DEF` number the database lacks) and every block that
  runs it (`'call'`, `'call-modal'`, and the positioning blocks while `M89` is in force),
  until the next definition. A call with no definition before it is a group of its own;
- a one-shot cycle (`'start'`, not `modal`: a lathe `G71`) is a group of its own;
- a modal entry whose words are data (`G66`) and every positioning block until another
  modal code of its group (`G67`): its arguments may be positions nobody described, so it
  is always `cycle-not-reviewed`; the one-shot program call (`CodeEntry.call`: `G65`) is
  refused the same way when it hands a chosen address a number (M10 review, NC-6), while a
  data code (`G10`, `G52`, `G92`) keeps its `data` word finding;
- the pole (`CodeEntry.pole: 'set'`) and every move around it (`'use'`) until the next pole,
  while the run changes an axis of the plane in force (M10 review, NC-2).

When one member is refused, every member is, with the first refused member's reason and a
message naming its line ("part of the same cycle as line 12, which is left as written"). A
call whose definition was left as written would drill where nobody asked for, and so would
a definition whose call is left. The positions **before** a call (`L X+10 Y+10 Z+5 FMAX`)
are ordinary moves and are not members.

Inside a cycle block a value that the run would move but cannot — a variable
(`cycle-expression`) or one with no resolved value (`cycle-unresolved`) — refuses the block
rather than moving the rest of it. An incremental word does not: under `G91` the whole
cycle block is relative and nothing in it moves.

A tool-axis parameter written as an **address word** (the Fanuc `R`) follows the distance
mode like any word; one written as a **call argument** or a **Klartext Q parameter** is an
absolute position by definition (the Siemens cycle manual lists `RTP`, `RFP` and `DP` as
absolute) and is moved under `G91` too.

## What R8 decides (plan §6 M10 P10 item 1, §7.2, §7.16 #106)

A cycle parameter with `position: 'tool-axis'` is moved **with** the axis words when the
shifted address is the tool axis: `Z` while the plane is `XY` — and so, for a multiply or a divide of `Z`, it is scaled with
the `Z` words. Today that is the `R` of the
Fanuc mill drilling cycles (absolute under `G90`; a `G91` block is incremental and skipped),
Klartext `Q203` of cycles 200, 201, 202, 203, 205, 206, 207, 208, 209, 240 and 262, and Sinumerik `RTP`,
`RFP`, `DP` of `CYCLE81`–`CYCLE89` and `CYCLE840`, plus `FDEP` of `CYCLE83`. Everything a
shift on another address touches is an ordinary axis word. A shift of `X` or `Y` leaves a
`'tool-axis'` parameter alone (it is a `Z` coordinate).

Klartext writes the parameters of a definition on continuation lines as `Q203=+0` — a Q
parameter, `=` and a literal — which is the parameter's value, not an `=` expression;
`Q203=+Q10` is an expression (`cycle-expression`). A modal Fanuc cycle carries its `R` into
the positioning blocks that repeat it (`X20. Y20. R5.` under `G81`): the parameters of the
cycle in force apply to such a block.

The full list of roles is `tests/fixtures/codes/positions.json`; the reasons per entry are
the G10 table (plan §8.7).

## Cases the plan names (WP10.4 Tests; H10 `m10-arith`)

`Z1000` → `Z500` under IS-B, `Z999.5` under the calculator reading (both subtract 0.5), left and
reported (`machine-dependent`) with no machine, and `Z10.` → `Z9.5` in all three (subtract
0.5); `Z1000` + `0.0005` under IS-B → `Z1001` (`rounded`); an Okuma 10 µm machine:
`Z1000` − 0.5 → `Z950`, `Z10.` − 0.5 → `Z-40.`; a lathe `Z` − 0.5 with `W` words reported
(`incremental`); Okuma `X=V1+2` (`expression`); multiply by 2 on `G83 … K3` leaves `K3`
(`count`); a Sinumerik `DIAMOF` section: a +0.5 diameter operand moves the `DIAMON` words by
0.5 and the `DIAMOF` words by 0.25; R8: a Klartext `CYCL DEF 200` whose `Q203` moves with
the `Z` words, `CYCL CALL POS` refused (`cycle-position`), a Sinumerik `CYCLE83` with its
trailing arguments at 0 moved and one with `_AMODE=1` refused (`cycle-mode`), `CYCLE800`
and the blocks under it refused (`frame`), a `TRAORI` section judged and a simultaneous `A`
/`C` move without it refused (`rotary-without-tcp`), `G53`/`M91`/`SUPA` refused
(`machine-position`).

## The cases (WP10.4)

| Case | Profile, machine | What it pins |
|---|---|---|
| `fanuc-z-is-b`, `fanuc-z-calculator`, `fanuc-z-no-machine` | Fanuc mill; an IS-B machine, a calculator machine, none | the X11 c numbers: `Z1000` − 0.5 → `Z500`, `Z999.5`, left (`machine-dependent`); `Z10.` → `Z9.5` in all three |
| `fanuc-rounded-is-b` | IS-B | `Z1000` + 0.0005 → `Z1001` (`rounded`) |
| `okuma-10um` | Okuma, unit 10 µm | `Z1000` − 0.5 → `Z950`, `Z10.` − 0.5 → `Z-40.` |
| `okuma-expression` | Okuma, unit 1 mm | `X=V1+2`, `X=V2`, `Z=V3` left (`expression`); `X` as a diameter |
| `lathe-z-shift` | Fanuc lathe, none | `W` words (`incremental`), `G28 U0. W0.` (`machine-position`), `G71`/`G70` (`cycle-not-reviewed`), the contour moved |
| `fanuc-multiply-g83` | Fanuc mill | multiply 2: `K3` of a `G81` left (`count`), `R` scaled with `Z`, a `G83` with its peck depth `Q1.` refused with its positions (`not-scaled`, M10 review), `I`/`J` of a `G2` not (only `Z` chosen), a `G91` `Z` scaled |
| `fanuc-arc-centres` | Fanuc mill | add to `X` and `Z`: the arc centres stay (incremental) |
| `fanuc-decimals` | Fanuc mill | divide 3 with three decimals, `Z-.5` keeps its style, each `rounded` |
| `fanuc-drilling` | Fanuc mill | `R` moved with `Z` in the start block and in a block under the cycle; a `G83` group refused for `Z#101` (`cycle-expression`, both blocks); a `G91` cycle block skipped; `G53`, `G28`; a `G68` frame; `G100` (`unknown-code`); `G65 P9001 Z5.` refused (`cycle-not-reviewed`, M10 review); `Z[#1+2.]` |
| `fanuc-selection-primed` | Fanuc mill, a selection with `preceding.nc` | the blocks of a `G81` started above the selection (`cycle-outside`); without the lines above, the run says so (`selection`, in the test) |
| `klartext-cycles` | Klartext | `Q203` of a definition called by `M99` moved; a definition called by `CYCL CALL POS` refused with it (`cycle-position`); `CYCL DEF 251` and its call (`cycle-not-reviewed`); `Q203=+Q10` and its call (`cycle-expression`); `IZ` (`incremental`); `M91`; `BLK FORM` (`data`) |
| `klartext-modal-call` | Klartext | an `M89` modal call moved with its positions; `Q203=+0,5` keeps its comma; a `PLANE SPATIAL` frame until `PLANE RESET` |
| `sinumerik-cycle83` | Sinumerik milling | `CYCLE81`, `MCALL CYCLE83` with the trailing arguments at 0 moved; `_AMODE=1`, `_GMODE=1` (`cycle-mode`, with the `MCALL` positions); `RFP=R1` (`cycle-expression`); a call under `G91` moved |
| `sinumerik-cycle800` | Sinumerik milling | `CYCLE800()` closes; `CYCLE800(…)` and the blocks under it (`frame`) |
| `sinumerik-traori` | Sinumerik milling | an `A`/`C` move under `TRAORI` moved, the same move after `TRAFOOF` refused (`rotary-without-tcp`; "moves A", since C turns no Z); the first block, which ends at `A0 C0`, moved; `SUPA`; `Z=IC(10)` (`incremental`); `TRANS Z5` (`data`) |
| `sinumerik-diamof` | Sinumerik turning | +0.5 to `X` as a diameter: `DIAMON` words +0.5, `DIAMOF` words +0.25; `X=IC(2)` (`incremental`) |
| `sinumerik-mill-x-shift` | Sinumerik milling | (M10 review, NC-1) +1 to `X`: every `X` +1 (not 0.5), a `DIAMON` word +2, no "as a diameter" |
| `klartext-polar` | Klartext | (NC-2) +5 to `X`, `Y`, `Z`: the absolute pole `CC X+50 Y+50` moves with the `L` and `C` end points, `CC IX+10 IY+0` is left (`incremental`), a pole `CC X+Q1` is refused with the `LP` and `C` around it (`pole`) |
| `sinumerik-arc-geometry` | Sinumerik milling | (NC-3) +5 to `X`, `Y`, `Z`: `I=AC()`/`J=AC()` and the `CIP` point `I1=`/`J1=` moved with the end point, `I1=AC()` too, a `G91` `CIP` left whole, `Z=AC(3.25)` moved, `I=AC(R1)` and `I1=R2` refused (`arc-geometry`) |
| `fanuc-rotary-state` | Fanuc mill | (NC-4) +0.5 to `Z`: a `Z` before the first `B` and every `Z` while `B` stands at 90 or 85 refused, `Z` at `B0 C30` moved (C turns no Z), a block under `G43.4` moved, the retract after `G49` at `B30` refused |
| `fanuc-polar-g16` | Fanuc mill | (NC-5) +5 to `X`, `Y`: `G16` to `G15` is a frame; `G123` alone is listed once (`unknown-code-note`) |
| `fanuc-multiply-rule` | Fanuc mill | (CODE-8) multiply 2 on `X`, `Y`, `Z`: a `G91` block and a block before `G90` scaled, `G52` refused (`not-scaled`), the `G4` dwell `X` left (`data`) |

The machines of the IS-B and 1 mm cases are written so that they do not equal the profile's
default preset: the generator names an effective file by the machine's parameters alone,
so a machine golden equal to the defaults would share — and overwrite — the file of the
no-machine modal goldens.
