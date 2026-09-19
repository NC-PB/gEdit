# Heidenhain Klartext: syntax notes (CAM-output subset)

Dialect id in gEdit: `heidenhain-klartext`.

Klartext is Heidenhain's plain-language program format. Heidenhain calls it "conversational", but CAM post-processors emit it, so it is in scope. What is excluded is input that only makes sense at the control, such as FK free contours (§1).

Primary source: the TNC 640 user manual for Klartext programming (German edition, NC software 34059x-07, 2016). Anything that comes from general knowledge and not from that manual is marked **(verify)**. All examples below were written for this document. The manual's own examples are not reproduced.

The German manual prints some examples with a decimal comma (`DL+0,2`). NC files use a decimal **point**, so this document uses points throughout (see §10).

---

## 1. Scope note

**In scope:** Klartext as emitted by CAM post-processors for milling on TNC 4xx / iTNC 530 / TNC 6xx controls:

- program frame (`BEGIN PGM` / `END PGM`, `BLK FORM`)
- linear and circular moves (`L`, `C`/`CC`/`CR`/`CT`, polar `LP`/`CP`, `RND`/`CHF`)
- feed, speed, rapid, radius compensation
- `TOOL CALL` / `TOOL DEF`
- common M functions
- tolerance cycle 32 and the standard 200-series drilling cycles
- `CYCL CALL` / `M99`
- labels, `CALL LBL`, `CALL PGM`
- basic Q parameters (FN 0–FN 9, direct formulas)
- 3+2 (`PLANE SPATIAL` / `PLANE RESET`) and 5-axis (`M128`/`M129`, `FUNCTION TCPM`, `LN` blocks with vectors)
- comments and structure blocks

**Deliberately excluded:**

- FK free contour programming (`FL`, `FC`, `FLT`, `FCT`, `FPOL`, …). This is shop-floor input. The tokenizer should only recognise the words so they are not flagged as errors.
- SL/contour pocket cycles (14, 20–25, 27–29, 39, 270–275), pattern cycles (220/221), probing cycles, and turning, grinding, gear and imbalance cycles (8xx).
- Palette tables and tool, preset or datum *tables* (`.T`, `.TCH`, `.PR`, `.D`, `.P`, `.TAB`). gEdit may open them as plain text later.
- Q-parameter I/O and system functions (FN 14 and above: `FN 16 F-PRINT`, `FN 18 SYSREAD`, table access, SQL). Highlight them, but give them no semantics.
- Machine-builder specific cycles and M functions.
- The Heidenhain ISO format (`.I` files). It is a G-code dialect and needs its own dialect, not Klartext.
- Unit programs `.HU` (smarT.NC) and contour programs `.HC`.

---

## 2. File & program structure

| Item | Rule |
|---|---|
| Extension | `.H` (the control shows it in upper case; CAM usually writes `.h` or `.H`). The control also knows `.I` (ISO), `.HU`, `.HC`, `.T`, `.TCH`, `.D`, `.PNT`, `.PR`, `.TAB`, `.P`, `.DEP`, `.A`/`.TXT` (plain text). Only `.H` is in scope. |
| File name | Portable POSIX file-name characters only: `A–Z a–z 0–9 . _ -`. Maximum path length is 255 characters (drive + dirs + name + ext). |
| First block | `0 BEGIN PGM <name> MM` or `… INCH`. The unit is mandatory. |
| Last block | `<n> END PGM <name> MM\|INCH`. The name and unit must match `BEGIN PGM` (verify: whether the control rejects a mismatch or silently fixes it). |
| Program name vs file name | The name after `BEGIN PGM` normally equals the file name without extension (verify: whether the control enforces or rewrites it on import). |
| Block numbers | Every logical block starts with an integer block number. Numbering is ascending from `0` (`BEGIN PGM`) in steps of 1. The control generates the numbers itself (verify: behaviour on import when numbers are missing, duplicated or have gaps; probably renumbered). |
| Stock (optional) | `BLK FORM 0.1 <axis> X Y Z` (MIN point) + `BLK FORM 0.2 X Y Z` (MAX point, absolute or incremental). Variants: `BLK FORM CYLINDER <axis> R\|D… L… [DIST…] [RI\|DI…]` and `BLK FORM ROTATION <axis> DIM_R\|DIM_D LBL…`. Only needed for simulation. |
| Program end | `M2` or `M30` (usually on its own block or on the final retract), followed by `END PGM`. Subprograms (`LBL n … LBL 0`) go **after** M2/M30. |
| Multi-line blocks | Cycle definitions (and `PATTERN DEF`) span several physical lines. Every line except the last ends with `~`, and the continuation lines carry **no** block number and are indented (verify: exact indentation and whether `~` is required). A *logical block* is one numbered line plus its continuation lines. |
| Units | `MM`: coordinates in mm, F in mm/min. `INCH`: coordinates in inch, **F in 1/10 inch/min** (F100 = 10 in/min). Feed for rotary axes is in deg/min in both. |
| Encoding | Plain text (ASCII). The control stores programs internally in its own format and converts on transfer (verify). Unsure whether UTF-8 or ISO-8859-1 is used for umlauts in comments (verify); the safe choice is to read as UTF-8 with a Latin-1 fallback and to keep the original encoding on save. |
| Line endings | CRLF is typical for files transferred from the control (verify). Preserve whatever the file has. |
| Size | The control accepts up to 2 GB per program, so CAM files can be very large. The editor must stay usable with files of several hundred MB (tokenizer and outline must be linear-time). |

### Example (own, CAM-style, 3-axis)

```
0  BEGIN PGM PLATE_42 MM
1  BLK FORM 0.1 Z X-50 Y-40 Z-20
2  BLK FORM 0.2 X+50 Y+40 Z+0
3  * - FACE MILL D50
4  CYCL DEF 32.0 TOLERANZ
5  CYCL DEF 32.1 T0.02
6  CYCL DEF 32.2 HSC-MODE:0 TA0.5
7  TOOL CALL 3 Z S3200 F900 ; D50 FACE MILL
8  L Z+100 R0 FMAX M3
9  L X-80 Y-20 R0 FMAX M8
10 L Z+0 F300
11 L X+80 F900
12 L Z+100 R0 FMAX
13 * - DRILL D8.5
14 TOOL CALL "DRILL_8.5" Z S2400
15 L Z+100 R0 FMAX M13
16 CYCL DEF 200 BOHREN ~
     Q200=2 ;CLEARANCE ~
     Q201=-24 ;DEPTH ~
     Q206=250 ;PLUNGE FEED ~
     Q202=6 ;PECK ~
     Q210=0 ;DWELL TOP ~
     Q203=+0 ;SURFACE ~
     Q204=50 ;2ND CLEARANCE ~
     Q211=0.2 ;DWELL BOTTOM ~
     Q395=0 ;DEPTH REF
17 L X+30 Y+20 R0 FMAX M99
18 L X-30 Y+20 R0 FMAX M99
19 L Z+100 R0 FMAX M9
20 L Z-1 R0 FMAX M91
21 M30
22 END PGM PLATE_42 MM
```

On a real control, the words after the cycle number (`BOHREN`) and after `;` in parameter lines are labels that the control writes in its dialog language. The labels above are placeholders.

### Example (own, 3+2 and 5-axis fragments)

```
30 PLANE SPATIAL SPA+0 SPB+30 SPC+90 TURN MB MAX FMAX SEQ- TABLE ROT
...
45 PLANE RESET STAY
50 M128
51 L X+12.3456 Y-4.5 Z+7.25 B+15.5 C-120.25 F2000
...
60 M129
70 FUNCTION TCPM F TCP AXIS POS PATHCTRL AXIS
...
80 FUNCTION RESET TCPM
90 LN X+10.1234 Y+5.6789 Z-2.3456 NX+0.1234567 NY-0.0456789 NZ+0.9912981 F1500
```

---

## 3. Lexical rules (for a Monarch tokenizer)

### 3.1 Block anatomy

```
[indent] <blocknr> [/] <function words...> [word...] [M...] [; comment] [~]
```

- **Block number:** an integer at line start (after optional whitespace), followed by whitespace. It is present on every logical block, and `0` is valid.
- **Block skip:** `/` marks a block that is skipped when the operator enables skipping. It sits after the block number (verify: `12 /L …` vs `/12 L …`, and whether a space follows).
- **Continuation line:** an indented line with no block number, belonging to the previous block. It always follows a line ending in `~`.
- **Whitespace** separates words. Most words have **no** space between letter and value (`X+10`, `S3200`, `F900`, `R0`, `Q200=2`, `SPB+30`, `DIST50`). A few need a space: `MB 50` / `MB MAX` (after `M140`), `REP 4` (verify), `FN 0:`.
- **Multi-word function names** are separated by single spaces: `BEGIN PGM`, `END PGM`, `BLK FORM`, `TOOL CALL`, `TOOL DEF`, `CYCL DEF`, `CYCL CALL [PAT|POS]`, `CALL LBL`, `CALL PGM`, `SEL PGM`, `CALL SELECTED PGM`, `PLANE SPATIAL` (etc.), `PLANE RESET`, `FUNCTION TCPM`, `FUNCTION RESET TCPM`, `TRANS DATUM AXIS|TABLE|RESET`, `DECLARE STRING`, `FUNCTION DWELL`, `PATTERN DEF`, `APPR LT|LN|CT|LCT`, `DEP LT|LN|CT|LCT` (plus polar `APPR PLT|PLN|PCT|PLCT`, `DEP PLCT`, …). The tokenizer should allow `\s+` between the parts.
- **Case:** the control writes upper case, and tool and label names are upper-cased on save. Tokenize case-insensitively (keep `ignoreCase: true`), but lint lower case as a warning (verify: whether the control accepts lower case on import).

### 3.2 Token classes

| Class | Pattern (regex sketch) | Notes |
|---|---|---|
| Block number | `^\s*\d+(?=\s\|$)` | Monaco supports a leading `^` in a Monarch rule as a line-start anchor. |
| Structure block | `^\s*\d+\s+\*.*$` | `* - text`, a heading for following lines (up to 252 characters). Style it as a heading or doc comment. |
| Comment | `;.*?(?=\s*~\s*$)\|;.*$` | Runs from `;` to end of line, but must **not** swallow a trailing `~`. It can be a whole block (`12 ; text`) or trail a block. A comment block must not end with `~`. |
| Continuation | `~\s*$` | Delimiter. |
| String | `"[^"]*"` | Tool names, label names, `QS` values, some paths. |
| Program keywords | `BEGIN PGM`, `END PGM`, `MM`, `INCH`, `BLK FORM`, `0.1`, `0.2`, `CYLINDER`, `ROTATION` | `0.1`/`0.2` after `BLK FORM` are sub-block indices, not numbers to lint. |
| Path functions (first word after the block number) | `LN`, `LP`, `L`, `CTP`, `CT`, `CP`, `CC`, `CR`, `C`, `RND`, `CHF`, `APPR …`, `DEP …` | Order the longest first. `L`/`C` are functions only when followed by whitespace or end of line; `C+45` is the C axis and `L+10` is a tool length in `TOOL DEF`. |
| Axis / coordinate word | `I?(X\|Y\|Z\|A\|B\|C\|U\|V\|W)([+-]?(\d+\.?\d*\|\.\d+)\|[+-]?Q[LRS]?\d+)` | The `I` prefix means incremental. The value may be a Q parameter (`X+Q5`, `IY-QL2`). |
| Polar words | `I?(PR\|PA)…`, `CCA…` | `IPA` is the total angle in helices. |
| Vector words (LN) | `(NX\|NY\|NZ\|TX\|TY\|TZ)[+-]?\d*\.?\d+` | CAM writes about 7 decimals. `TX/TY/TZ` must be numeric (no Q). |
| Radius comp | `\bR(L\|R\|0)\b` | Modal (stays until the next `R0`/`RL`/`RR` or a `DEP`). |
| Radius value | `R[+-]?(\d…\|Q…)` | Radius in `CR`, `RND`, `TOOL DEF`, `BLK FORM CYLINDER`. |
| Rotation direction | `\bDR[+-](?![\d.Q])` | `DR+` = counter-clockwise, `DR-` = clockwise. **Conflict:** `DR-0.02` in `TOOL CALL` is a delta radius. The rule: a following digit or `Q` means delta. `DR2±…` is delta R2. `DL±…` is delta length. |
| Feed | `F(MAX\|AUTO)\b`, `F\s+(MAX\|AUTO)`, `F[UZ]?(\d…\|Q[LRS]?\d+)` | `FMAX` is rapid (block-wise). `FAUTO`/`F AUTO` = feed from `TOOL CALL` (verify spelling in files). `FU` = per revolution, `FZ` = per tooth. `FQ50` = feed from Q50. |
| Speed | `S(\d…\|Q…)`, `VC…` | `VC` = cutting speed alternative (verify file syntax). |
| M function | `\bM\d{1,3}\b` | At most **4** per block. Some take arguments: `M128 F<feed>`, `M140 MB <dist>\|MB MAX [F<feed>]` (verify: others such as `M120 LA<n>`, `M101 BT<n>`). |
| Tool call args | `TOOL CALL (\d+(\.\d)?\|"name"\|QS\d+)? (X\|Y\|Z)? S… F… DL… DR… DR2…` | All parts are optional. See §5. |
| Cycle header | `CYCL DEF \d+(\.\d+)?` + name | Name = rest of the line up to `~` (language-dependent). |
| Cycle parameter line | `^\s+Q\d+\s*=\s*(value) (;label)? ~?` | Treat `Qnnn` as a parameter name and the text after `;` as a comment. |
| Q parameter ref | `[+-]?Q[LRS]?\d+` | `Q` global, `QL` local, `QR` persistent, `QS` string. |
| FN functions | `FN\s*\d+\s*:` | Followed by `Q.. = expr` or `IF … GOTO LBL …`. |
| Operators | `= + - * / ^ % ( ) :` and `\|\|` (string concat); words `DIV SQRT SIN COS TAN ASIN ACOS ATAN SQ LN LOG EXP NEG INT ABS FRAC SGN PI LEN ANG IF GOTO EQU NE GT LT IS DEFINED UNDEFINED` | Parentheses also appear in `PATTERN DEF POSn (X… Y… Z…)`. |
| Labels | `LBL (\d+\|"name"\|QS\d+)`, `CALL LBL … [REP n]` | |
| Program call | `CALL PGM <path>` | `<path>` is a bare name or `TNC:\dir\file.H`, which may include `.I` (verify: quoting of paths with spaces). |
| PLANE words | `SPATIAL PROJECTED EULER VECTOR POINTS RELATIV AXIAL RESET`, `SPA SPB SPC`, `MOVE TURN STAY`, `DIST`, `MB`, `SEQ[+-]`, `TABLE ROT`, `COORD ROT` | |
| TCPM words | `FUNCTION TCPM`, `F TCP`, `F CONT`, `AXIS POS`, `AXIS SPAT`, `PATHCTRL AXIS`, `PATHCTRL VECTOR`, `FUNCTION RESET TCPM` | Newer software adds reference-point options (`REFPNT …`) (verify). |
| Numbers | `[+-]?(\d+\.?\d*\|\.\d+)` | Positions are written with an explicit sign by the control (`X+10`). CAM posts do the same. Unsigned is probably accepted (verify). Decimal point only. |
| Unknown | — | Use a neutral default token (e.g. `''` or `source`), **not** `invalid`. Leave error marking to the linter. |

Numeric formats seen from CAM:

- positions: 3–4 decimals (4 is recommended; 5 is possible with an option)
- `LN` vectors: 7 decimals
- `S` and `F`: integers or 1–3 decimals
- Q values: at most 16 characters, including up to 9 digits before the point

---

## 4. Codes commonly emitted by CAM

### 4.1 Program frame and misc

| Code | Meaning | Notes |
|---|---|---|
| `BEGIN PGM n MM\|INCH` | Program start, name, unit | Block 0 |
| `END PGM n MM\|INCH` | Program end marker | Last block |
| `BLK FORM 0.1/0.2` | Rectangular stock (min/max corner) | 0.1 carries the tool axis |
| `* - text` | Structure/section heading | Outline item |
| `; text` | Comment (whole block or trailing) | |
| `STOP [Mx]` | Programmed stop | |
| `FUNCTION DWELL TIME t` / `REV n` | Dwell in seconds / spindle revolutions | Newer alternative to cycle 9 |
| `TRANS DATUM AXIS X… Y… Z…` / `TABLE TABLINE n` / `RESET` | Datum shift (direct / from datum table / reset) | Alternative to cycle 7 |

### 4.2 Path functions (Cartesian)

| Code | Meaning | Typical words | Notes |
|---|---|---|---|
| `L` | Straight line to end point (feed or rapid) | axes (up to 6: X Y Z A B C, also U V W), `R0/RL/RR`, `F…`/`FMAX`, `M…` | Omitted axes keep their value (modal positions) |
| `CC` | Set circle centre / pole (no motion) | two axes of the working plane, or none (= last position) | Modal until the next `CC`. Incremental CC is relative to the last tool position |
| `C` | Arc around the last `CC` to end point | end point, `DR±`, `F`, `M` | Full circle: end = start |
| `CR` | Arc by radius | end point, `R±r` (`+` = arc < 180°, `-` = arc > 180°), `DR±` | Chord must not exceed diameter |
| `CT` | Arc tangential to previous element | end point | Needs at least 2 preceding positioning blocks |
| `RND R r [F]` | Corner rounding between two elements | radius | F valid only inside this block |
| `CHF l [F]` | Chamfer between two lines | chamfer length | Must not start a contour; F only this block |
| `APPR …` / `DEP …` | Approach/depart contour (tangential line, normal line, arc, line+arc) | end point, `LEN`, `CCA`, `R`, comp | Rare in CAM output; highlight as path functions |

Working plane: the tool axis in `TOOL CALL` sets it (Z → XY, Y → ZX, X → YZ). Arcs are in that plane unless the tilted plane is active. An arc with a third axis becomes a helix or spatial circle.

### 4.3 Polar path functions

| Code | Meaning | Words |
|---|---|---|
| `LP` | Line in polar coordinates around pole `CC` | `PR` (radius), `PA` (angle), `IPR`/`IPA` incremental |
| `CP` | Arc around pole | `PA`/`IPA`, `DR±`. Helix: `CP IPA±total IZ±height DR±`, where the IPA sign must match DR |
| `CTP` | Tangential arc to polar end point | `PR`, `PA` |

### 4.4 Radius compensation and feed

| Code | Meaning | Modal |
|---|---|---|
| `R0` | No radius compensation (tool centre on path) | yes |
| `RL` / `RR` | Tool left / right of contour in direction of travel | yes. Switching RL↔RR needs an `R0` block between them. Compensation must not be activated in an arc block |
| `F<n>` | Feed (mm/min, or 1/10 in/min in INCH programs) | yes |
| `FMAX` | Rapid | **block-wise only**. The previous numeric F applies again afterwards |
| `FAUTO` | Feed from the last `TOOL CALL` | block (verify) |
| `FU<n>` / `FZ<n>` | Feed per revolution / per tooth | yes (verify) |
| `FQ<n>` | Feed from Q parameter (CAM posts often define Q feeds at the program start) | yes |

### 4.5 M functions typical in CAM output

| M | Meaning | Takes effect | Modal / reset |
|---|---|---|---|
| M0 | Program stop (spindle and coolant stop, machine-dependent) | end | – |
| M1 | Optional stop | end | – |
| M2 / M30 | Program end | end | – |
| M3 / M4 / M5 | Spindle CW / CCW / stop | start / start / end | spindle group |
| M6 | Tool change (machine-dependent). **Not** used for tool detection: `TOOL CALL` performs the change | end | – |
| M8 / M9 | Coolant on / off | start / end | coolant group |
| M13 / M14 | Spindle CW / CCW **and** coolant on | start | spindle+coolant |
| M89 | Modal cycle call (machine-dependent) | – | – |
| M91 | Coordinates in this block refer to machine zero | start | block only. Tool length is not applied |
| M92 | Coordinates refer to a machine-builder reference position | start | block only |
| M94 | Reduce rotary-axis display below 360° | start | block |
| M99 | Call the last defined cycle once at this block's end position | end | block only |
| M116 / M117 | Rotary feed in mm/min on/off | | modal |
| M126 / M127 | Shortest-path rotary positioning on/off | | modal |
| M128 [F…] / M129 | Keep tool tip position when tilt axes move (TCPM) on/off; F = feed for compensating moves | M128 start, M129 end | modal. Must be reset before `TOOL CALL`, M91 and M92 |
| M140 MB n\|MB MAX [F…] | Retract along tool axis by distance / to travel limit | start | block only |
| M101 / M102, M107 / M108, M120, M136 / M137, M138, M144 / M145, M148 / M149 | Less common; highlight only | | |

M functions that take effect at block start run before those at block end. Otherwise they run in the programmed order.

### 4.6 Multi-axis (3+2 / 5-axis)

| Code | Meaning | Notes |
|---|---|---|
| `PLANE SPATIAL SPA… SPB… SPC… <MOVE\|TURN\|STAY> …` | Tilt the working plane by spatial angles (rotations about machine X, Y, Z) | All three angles are mandatory, even if 0. `MOVE [DIST d] F…\|FMAX\|FAUTO` swivels with compensating motion. `TURN [MB n\|MB MAX] F…\|FMAX` swivels rotary axes only. `STAY` means the angles go to Q120–Q122 and a separate `L A+Q120 …` positions. Optional `SEQ+/-` (solution choice) and `TABLE ROT`/`COORD ROT` (verify word order) |
| `PLANE PROJECTED / EULER / VECTOR / POINTS / RELATIV / AXIAL` | Other plane definitions | CAM mostly uses SPATIAL, sometimes VECTOR or AXIAL |
| `PLANE RESET [MOVE\|TURN\|STAY …]` | Reset the tilted plane (also resets cycle 19) | Always reset with this, not with zero angles |
| `CYCL DEF 19.0 … / 19.1 A… B… C…` | Older tilt cycle | Some posts still emit it (verify exact sub-block words) |
| `M128` / `M129` | TCPM on/off (older form) | see §4.5 |
| `FUNCTION TCPM F TCP\|F CONT AXIS POS\|AXIS SPAT PATHCTRL AXIS\|PATHCTRL VECTOR` | TCPM with explicit feed interpretation / rotary meaning / interpolation | Reset with `FUNCTION RESET TCPM`. Auto-reset on program select |
| `LN X Y Z NX NY NZ [TX TY TZ] [R0\|RL\|RR] F M` | Line with 3D tool compensation | X/Y/Z and NX/NY/NZ are **always all present**, in the same axis order. TX/TY/TZ = normalised tool orientation (numbers only). Without TCPM, the offset is applied along the normal by the sum of the delta values. With TCPM + TX/TY/TZ + RL/RR, 3D radius comp applies (peripheral milling) |

---

## 5. Tool change & offsets

**Tool change detection:** a `TOOL CALL` block whose first argument is a tool **number**, a quoted **name** or a `QS` parameter.

- `TOOL CALL 12 Z S8000 F1200` – number (range 0–32767). `TOOL CALL 0` = null tool (L=0, R=0; cancels length comp).
- `TOOL CALL 12.1 Z …` – indexed tool (index `.1`–`.9`, e.g. a step drill with several lengths).
- `TOOL CALL "EM_D10_R0.5" Z …` – name, at most 32 characters, upper case, allowed characters `A–Z 0–9 # $ % & , - _ . @`. Forbidden: space and ``! " ' ( ) * + : ; < = > ? [ / ] ^ ` { | } ~``.
- `TOOL CALL QS3 Z …` – name taken from a string parameter (verify file syntax).
- `TOOL CALL Z S5000` / `TOOL CALL S5000` – **no tool argument**: only changes speed (and/or axis/feed). **Not a tool change.** The outline should show it as a speed change or ignore it.

Remaining `TOOL CALL` words (all optional, dialog order): tool axis `X|Y|Z`, `S<rpm>` (or `VC` cutting speed), `F`/`FU`/`FZ`, `DL±` (delta length), `DR±` (delta radius), `DR2±` (delta corner radius).

- Positive delta = oversize, negative = undersize. The limit is ±99.999 mm. Delta values may be Q parameters.
- `TOOL DEF <nr|"name"|Q>` after a tool call = **pre-selection of the next tool** (machine-dependent). Show it as a hint, not a change.
- `TOOL DEF <nr> L±… R±…` defines tool geometry in the program (old style, rare in CAM output).

**Length/radius compensation:**

- Length compensation is automatic after `TOOL CALL`, with no H-style word as in ISO. The effective length is L + DL(TOOL CALL) + DL(table).
- Radius compensation is `RL`/`RR` on `L` blocks, cancelled by `R0` or `DEP`. The effective radius is R + DR(TOOL CALL) + DR(table).
- CAM posts usually output tool-centre paths with `R0`. Contours with `RL`/`RR` are used when the operator should be able to adjust fits.

**Work offsets** (no G54-style words in Klartext):

| Form | Meaning |
|---|---|
| `CYCL DEF 247 …` with `Q339=<n>` | Activate preset (datum) line n from the preset table (verify: Q339 as parameter number) |
| `CYCL DEF 7.0 …` / `7.1 X…` / `7.2 Y…` / `7.3 Z…` | Datum shift by values (old-style cycle with numbered sub-blocks). `7.1 #n` = line n of the datum table (verify) |
| `TRANS DATUM AXIS X… Y… Z…` / `TRANS DATUM TABLE TABLINE n` / `TRANS DATUM RESET` | Newer datum-shift function |
| `L … M91` / `M92` | Machine-coordinate moves (safe retract, tool-change position). These are not offsets but are useful to flag |

---

## 6. Cycles relevant to CAM output

### 6.1 General form

- **Old-style cycles (0–39):** one numbered block per sub-line, `CYCL DEF <nr>.<sub> …`. Example: cycle 32 is `32.0 <name>` / `32.1 T<tol>` / `32.2 HSC-MODE:<0|1> TA<deg>`.
- **Q-style cycles (200+):** a header `CYCL DEF <nr> <name> ~`, then one indented line per parameter, `Qnnn=<value> ;<label> ~`, with the last line having no `~`. The control identifies cycles by number and parameters by Q number. The name and labels are language-dependent text (verify: that the control ignores them on import).
- **Parameter values** are numbers (with sign) or Q parameters. Some feed parameters also accept `FAUTO`/`FMAX`/`FU`-style values (verify).

**DEF-active vs CALL-active:**

- Cycles 7, 8, 9, 10, 11, 19, 32 and 247 act as soon as they are defined.
- Machining cycles (200-series) only store data and run on a call:

| Call | Effect |
|---|---|
| `CYCL CALL` | Run the cycle at the current position |
| `CYCL CALL POS X… Y… Z…` | Run at the given position (verify) |
| `CYCL CALL PAT` | Run at every point of a preceding `PATTERN DEF` or point table |
| `L X… Y… R0 FMAX M99` | Move there, then call once |
| `M89` | Modal call (machine-dependent) |

**Common CAM pattern:**

1. `CYCL DEF 2xx` once
2. `L X Y R0 FMAX M99` per hole (or `L X Y FMAX` + `CYCL CALL`)
3. Retract

Z pre-positioning is usually handled by the cycle itself: it rapids to `Q203+Q200` in the tool axis.

### 6.2 Cycle 32 – tolerance

| Word | Meaning |
|---|---|
| `T` | Allowed path deviation (mm). Typical: finishing 0.002–0.02, roughing 0.05–0.3 |
| `HSC-MODE:0/1` | 0 = finishing (accuracy), 1 = roughing (speed) |
| `TA` | Tolerance for rotary axes in degrees (5-axis) |

Reset: `CYCL DEF 32.0` + `32.1` without values (verify). CAM usually emits it once per operation. The outline can show it as an operation-quality hint.

### 6.3 Drilling cycles (own descriptions of parameters)

Shared Q parameters:

| Q | Meaning |
|---|---|
| Q200 | Safety clearance above the surface (incremental, positive) |
| Q201 | Depth from the surface to the hole bottom (incremental; negative = into the material; 0 = cycle does nothing) |
| Q203 | Absolute Z of the workpiece surface |
| Q204 | Second (retract) clearance above the surface (incremental) |
| Q206 | Feed while plunging |
| Q202 | Peck (infeed) depth |
| Q210 | Dwell at the top after each retract (s) |
| Q211 | Dwell at the bottom (s) |
| Q208 | Retract feed |
| Q395 | Depth reference: 0 = tool tip, 1 = full diameter (newer software) |

| Cycle | Purpose | Parameters (typical order) |
|---|---|---|
| 200 | Drilling / pecking with full retract | Q200 Q201 Q206 Q202 Q210 Q203 Q204 Q211 Q395 |
| 201 | Reaming | Q200 Q201 Q206 Q211 Q208 Q203 Q204 |
| 202 | Boring (oriented spindle stop, lift-off) | Q200 Q201 Q206 Q211 Q208 Q203 Q204 Q214 (lift-off direction) Q336 (spindle angle) (verify) |
| 203 | Universal drilling (decreasing pecks, chip breaking) | Q200 Q201 Q206 Q202 Q210 Q203 Q204 Q212 (peck decrement) Q213 (breaks before retract) Q205 (min peck) Q211 Q208 Q256 (chip-break retract) Q395 (verify) |
| 204 | Back boring | (verify) |
| 205 | Universal deep-hole drilling | Q200 Q201 Q206 Q202 Q203 Q204 Q212 Q205 Q258/Q259 (advance stop distances) Q257 (depth per chip break) Q256 Q211 Q379 (deepened start) Q253 (pre-position feed) Q208 Q395 (verify) |
| 206 | Tapping with floating holder | Q200 Q201 Q206 (= S × pitch) Q211 Q203 Q204 (verify) |
| 207 | Rigid tapping | Q200 Q201 Q239 (pitch; sign = right/left hand) Q203 Q204 (verify) |
| 208 | Bore milling (helical) | Q200 Q201 Q206 Q334 (pitch per rev) Q203 Q204 Q335 (nominal diameter) Q342 (pre-drilled diameter) Q351 (climb/up-cut) (verify) |
| 209 | Rigid tapping with chip breaking | Q200 Q201 Q239 Q203 Q204 Q257 Q256 Q336 Q403 (retract speed factor) (verify) |
| 240 | Centering (to depth or diameter) | Q200 Q343 (0 = depth, 1 = diameter) Q201 Q344 (diameter) Q206 Q211 Q203 Q204 (verify) |
| 241 | Single-lip deep-hole drilling | (verify) |
| 262–267 | Thread milling variants | Optional, only if posts emit them (verify) |

Pocket and stud cycles (251–258) and face milling (232/233) are only emitted by some posts in "cycle output" mode. Highlight them generically, with no special support.

### 6.4 Other DEF-active cycles CAM may emit

| Cycle | Sub-block form |
|---|---|
| 7 datum shift | `7.0` / `7.1 X…` / `7.2 Y…` / `7.3 Z…` |
| 9 dwell | `9.0` / `9.1 V.ZEIT t` (German label) (verify) |
| 10 rotation | `10.0` / `10.1 ROT±a` |
| 19 tilt (old) | see §4.6 |
| 247 preset | Q-style, one parameter |

Reset values are 0.

---

## 7. Subprograms, labels, variables

- `LBL <n>` (n = 1–65535) or `LBL "NAME"` marks a label. Each number or name may be defined **once**. `LBL 0` marks the end of a subprogram and may appear many times.
- `CALL LBL <n|"NAME"|QSn>` calls a subprogram. Execution continues after `LBL 0`, then returns. `CALL LBL 0` is invalid.
- `CALL LBL <n> REP <m>` repeats the section between `LBL n` and this call m more times (the section runs m+1 times in total; m ≤ 65534).
- Subprograms belong after M2/M30. If placed before, they run once in the normal flow.
- `CALL PGM <name|path>` runs another program as a subprogram:
  - The called program must not contain M2/M30.
  - Q parameters are global across the call.
  - Transformations stay active after the call.
- `SEL PGM <path>` + `CALL SELECTED PGM` do the same with a variable path.
- **Q parameters:**

  | Type | Scope | Range |
  |---|---|---|
  | `Q` | global | 0–1999 (0–99 and 1600–1999 are for the user; 100–199 system; 200–1199 control cycles; 1200–1599 machine-builder cycles) |
  | `QL` | local to the program | 0–499 |
  | `QR` | persistent | 0–499 |
  | `QS` | string | same ranges as Q, up to 255 characters |

- **Assignment forms:**
  - `FN 0: Q5 = +12.5` (assign)
  - `FN 1:` add, `FN 2:` subtract, `FN 3:` multiply, `FN 4:` divide (`DIV`)
  - `FN 5:` square root (`SQRT`), `FN 6:` sine, `FN 7:` cosine
  - `FN 8:` root of sum of squares (`LEN`)
  - `FN 9: IF +Q1 EQU +Q2 GOTO LBL 7` (also `IS DEFINED` / `IS UNDEFINED`)
  - `FN 10`/`11`/`12` = `NE`/`GT`/`LT` jumps; `FN 13` angle (`ANG`)
  - Direct formula: `Q12 = Q3 * (Q4 + 2)` with `SIN COS TAN ASIN ACOS ATAN SQ SQRT LN LOG EXP NEG INT ABS FRAC SGN PI ^ %`
  - Strings: `DECLARE STRING QS1 = "TEXT"`, `QS2 = QS1 || QS3`
- **Usage:** any numeric word can take `±Q…` (`X+Q10`, `Z-Q3`, `FQ50`, `S+Q7` (verify sign on S)). CAM posts commonly use feeds at the program start (`Q50 = 7500 ; …`, then `FQ50`).
- **Highlighting / navigation:** go-to-definition from `CALL LBL x` to `LBL x`, and find-all-references for `Qn`, `QLn`, `QRn` and `QSn` (plain text search on normalised names).

---

## 8. Program-map / outline hints

Lines to surface. In CAM files, most of them carry a block-number prefix.

| Priority | Pattern | Outline item |
|---|---|---|
| 1 | `BEGIN PGM name unit` | Program header (name, unit) |
| 1 | `* - text` | Section heading (CAM operation names often go here) |
| 1 | `TOOL CALL` with number, name or QS | Tool change: show "T12.1 "NAME" Z S8000" plus the nearest preceding comment or structure line as the operation name |
| 2 | `; text` as a whole block | Comment / operation note |
| 2 | `CYCL DEF 2xx …` | Drilling operation (cycle number + English meaning) |
| 2 | `CYCL DEF 32.x` | Tolerance setting (value T) |
| 2 | `PLANE … ` (not RESET), `CYCL DEF 19` | Tilted plane on (angles) |
| 2 | `PLANE RESET`, `M128`/`M129`, `FUNCTION [RESET] TCPM` | 3+2 off / 5-axis on or off |
| 2 | `CYCL DEF 247`, `CYCL DEF 7`, `TRANS DATUM …` | Work offset / datum change |
| 2 | `LBL n` (n≠0), `LBL "name"` | Subprogram / label definition (fold to the matching `LBL 0`) |
| 3 | `CALL LBL`, `CALL PGM`, `SEL PGM` | Call (link to target) |
| 3 | `TOOL CALL` without tool, `TOOL DEF n` | Speed change / next-tool pre-selection |
| 3 | `STOP`, `M0`, `M1` | Operator stop |
| 3 | `M2`/`M30`, `END PGM` | Program end |

**Parsing rules for the outline:**

- Strip the block number: `^\s*\d+\s+`.
- Strip the block-skip `/`.
- Ignore continuation lines (lines following a `~`).
- Match keywords case-insensitively with `\s+` between words.

**Folding candidates:**

- cycle header + continuation lines
- `LBL n … LBL 0`
- `PATTERN DEF … `
- structure sections (from `* -` to the next `* -`)
- the tool block (from `TOOL CALL` to the next `TOOL CALL`)

---

## 9. Validation / lint ideas (cheap, line-based)

**Structure:**

- First logical block is not `BEGIN PGM`, or the last is not `END PGM`.
- Name or unit differs between BEGIN and END.
- BEGIN name differs from the file name (info).
- Block numbers missing, not ascending, duplicated or not contiguous. Offer a **renumber** action that starts at 0 and **skips continuation lines** and structure-less lines correctly.
- Text after `END PGM`.
- No `M2`/`M30` before `END PGM` (info: may be intentional for a called program).
- `LBL n` defined twice.
- `CALL LBL` to an undefined label.
- `CALL LBL 0`.
- `LBL` sections placed before M2/M30 without a jump around them (warn: they run inline).
- A line ending in `~` followed by a numbered line, or a continuation line after a line without `~`.
- A comment block ending in `~`.

**Motion:**

- `RL` → `RR` (or back) without an intermediate `R0` block.
- `RL`/`RR` first appearing on a `C`/`CR`/`CT`/`CP` block.
- `C` or `CP` with no preceding `CC` in the program; `LP`/`CTP` without `CC`.
- `CR` without `R`.
- `CHF`/`RND` as the first contour element, or not between two path blocks.
- `CT` with fewer than two preceding positioning blocks.
- Helix `CP IPA…` where the IPA sign ≠ the DR sign.
- First non-rapid move after `TOOL CALL` with no F in effect (no F in TOOL CALL and none on the block).
- Cutting move (non-FMAX) with no spindle start (`M3`/`M4`/`M13`/`M14`) since the last TOOL CALL.
- More than 4 M functions in one block.
- Conflicting M functions in one block (`M3` + `M4`, `M8` + `M9`).

**Tools:**

- Tool number > 32767 or index outside .1–.9.
- Tool name with lower case (warn), > 32 characters, or forbidden characters.
- Unbalanced `"`.
- `TOOL CALL` while `M128` or TCPM is active (should be reset first).
- `M91`/`M92` while `M128` is active.

**Cycles:**

- `CYCL DEF 2xx` never called (no `CYCL CALL`/`M99`/`M89`/`CYCL CALL PAT|POS` before the next `CYCL DEF`, `TOOL CALL` or end).
- `M99`/`CYCL CALL` with no cycle defined.
- Missing required Q parameters for known cycle numbers (table-driven from §6.3).
- Q201 = 0 (no-op) or with a sign that points away from the material (info).
- Duplicate Q numbers inside one cycle.

**Multi-axis:**

- `PLANE SPATIAL` missing any of SPA/SPB/SPC.
- `PLANE …` without MOVE/TURN/STAY.
- `PLANE` active at the next `TOOL CALL` or `END PGM` without `PLANE RESET` (info).
- `M128` without `M129` before the end.
- `FUNCTION TCPM` without `FUNCTION RESET TCPM`.
- `LN` missing one of X/Y/Z/NX/NY/NZ.
- `LN` with a Q parameter in TX/TY/TZ.
- Vector not normalised (|v| deviating from 1 by more than about 1e-5).

**General:**

- Unbalanced parentheses in formulas or `PATTERN DEF`.
- Unknown first word after the block number.
- Assignments to Q100–Q199 (system range) (warn).
- F values that are implausibly high for the unit (INCH programs use 1/10 in/min).
- Decimal comma used in numbers.

---

## 10. Open questions / to verify on real CAM output

1. Exact continuation format: is `~` mandatory on every continued line? How much indentation is used? Are single-line cycle definitions accepted on import?
2. Structure block syntax (`* - text`) and how nesting depth is encoded in the file.
3. Position and spacing of the block-skip `/`.
4. Import behaviour when block numbers are missing, duplicated or have gaps (renumbered? rejected?).
5. Does the name after `BEGIN PGM` have to match the file name? What happens on a mismatch?
6. File encoding (UTF-8 vs ISO-8859-1) and line endings as written by the control and by typical transfer tools. Are umlauts allowed in comments?
7. Is a decimal comma ever accepted? Are unsigned coordinates (`X10`) and lower-case words accepted?
8. Does the control ignore the language-dependent cycle names and `;` parameter labels on import (for example, does a German program load on an English control)?
9. File syntax of `FAUTO` vs `F AUTO`, `VC`, `FU`/`FZ` and `TOOL CALL QSn`, and the modality of FU/FZ.
10. Word order in `PLANE … TURN MB … F… SEQ… TABLE ROT|COORD ROT`, and `PLANE RESET` options.
11. `FUNCTION TCPM` reference-point options on newer software (`REFPNT …`).
12. `CYCL CALL POS` syntax, cycle 7 datum-table form (`#n`), cycle 247 parameter number, cycle 19 sub-block words, cycle 9 label text, and cycle 32 reset form.
13. Full, current parameter lists for cycles 202–209 and 240/241 (cycle manual not in the provided sources). Which cycles do common CAM posts actually emit?
14. Other M functions that take arguments (`M120 LA`, `M101 BT`, …).
15. Maximum line length and maximum comment length (structure text: 252 characters).
16. Differences between control generations: TNC 426/430 (no `PLANE`, older cycle forms), iTNC 530, TNC 620/640, and newer controls. Are there syntax changes that affect tokenizing?
17. Should `.I` (Heidenhain ISO) get its own dialect, or be treated as a generic ISO dialect? What is its header format?
18. Path quoting in `CALL PGM` for names with spaces or special characters.

---

## 11. Gaps in the current gEdit implementation

Files reviewed:

- `src/lib/languages/heidenhain.ts`
- `src/lib/utils/gcodeParser.ts`
- `src/lib/utils/detectLanguage.ts`
- `src/lib/utils/dialects.ts`
- `src/lib/data/blocks/heidenhain-klartext.json`
- `src/lib/monaco/setup.ts`

### Tokenizer (`heidenhain.ts`)

1. **Rule order makes most rules dead.** The first rule `[a-zA-Z_]\w*` matches every word, so these become `variable.name` and the coordinate/feed rules never fire:
   - `X` in `X+10`
   - `M3`, `S3200`, `F900`, `FMAX`
   - `R0`/`RL`/`RR`, `IX`, `Q200`
   - `DR`, `SPB`, `NX`
2. `defaultToken: 'invalid'`: every unmatched character is marked invalid. This covers `+ = : ~ * " / ( ) , |` (and whitespace). As a result:
   - `FN 0: Q1 = +5`, cycle parameter lines (`Q203=+0`: the `=` is invalid), `* - text`, quoted tool names, `PATTERN DEF` and `~` are all partly flagged.
3. There is no block-number token (block numbers render as ordinary floats).
4. There is no structure-block (`* -`) token, no string token, no continuation `~` token, and no block-skip `/`.
5. The comment rule `;.*$` swallows the trailing `~` on cycle parameter lines. That is harmless for colour but loses the continuation marker.
6. The keyword list lacks `BLK FORM`, `LBL`, `LP`, `LN`, `CP`, `CTP`, `PLANE`, `SPATIAL`, `RESET`, `FUNCTION`, `TCPM`, `MM`/`INCH`, `FMAX`/`FAUTO`, `R0`/`RL`/`RR`, `DR±`, `REP`, `PGM` (alone), `SEL`, `TRANS DATUM`, `PATTERN DEF` and the formula operators (`DIV`, `SQRT`, `SIN`, …). Multi-word keywords are only coloured word by word.
7. The keyword `M` never matches, because `M3` is consumed as one identifier.
8. No distinction between:
   - `DR+`/`DR-` (direction) and `DR-0.02` (delta radius)
   - `C` (function) and `C+45` (axis)
   - `L` (function) and `L+10` (length)

### Completions (`getHeidenhainCompletions`)

9. Only three items (`CYCL DEF 200`, `CYCL DEF 240`, `L`):
   - Both cycle snippets are truncated (200: only Q200/Q201; 240: only Q200/Q343/Q201), so they produce incomplete cycles.
   - Continuation lines are not indented.
   - Labels and documentation are German placeholders ("Dummy").
10. The `L` snippet inserts unsigned coordinates (`X10`) and always adds `M3`.
11. There are no completions for `TOOL CALL`, `PLANE SPATIAL`/`PLANE RESET`, `M128`/`M129`, `CYCL CALL`, `LBL`/`CALL LBL`, M functions or `FN` functions.
12. Completions are not context-aware. A context-aware provider would, for example, offer cycle parameters after `CYCL DEF 2xx`, or tool axis and S after `TOOL CALL n`.

### Program map (`gcodeParser.ts`)

13. The tool regex `^TOOL CALL` requires the line to **start** with `TOOL CALL`. Real files always have a block number (`7 TOOL CALL …`), so **no tool changes are found in typical CAM output**.
14. The comment check `startsWith(';')` misses numbered comment blocks (`12 ; text`), which is the normal form. Structure blocks (`* - text`) are not recognised at all.
15. A speed-only `TOOL CALL S5000` would be listed as a tool change (if it were matched at all). The tool number or name is not extracted; the raw line is shown instead.
16. Missing item types:
    - `BEGIN PGM`
    - `LBL` definitions and calls, `CALL PGM`
    - `CYCL DEF` (drilling and tolerance)
    - `PLANE` / `PLANE RESET`, `M128`/`M129`/TCPM
    - preset/datum changes (`CYCL DEF 247`, `CYCL DEF 7`, `TRANS DATUM`)
    - `STOP`/`M0`/`M1`, `M30`/`END PGM`

    `StructureItem.type` only allows `'tool' | 'comment'`.
17. Continuation lines are not recognised. This does not matter today, but will once cycle parameters are parsed.

### Dialect detection (`detectLanguage.ts`, `dialects.ts`)

18. `.h` maps to Heidenhain (case-insensitive, fine).
19. `.i` / `.I` is not mapped. It gets sniffed and will likely be classified as Fanuc, which is acceptable only until an ISO dialect exists; it should never become Klartext.
20. The weak-marker list lacks `LN`, `PLANE`, `CYCL CALL`, `* -` and numbered `;` comments. This only matters for `.txt` or unknown extensions.
21. `dialects.ts` extensions are `['h', 'txt']`. Consider whether save dialogs on case-sensitive file systems should also accept `H` (verify on Linux).

### Code blocks (`heidenhain-klartext.json`)

22. `start` inserts `BEGIN PGM NEW_PRG MM` without a block number and without a matching `END PGM`.
23. The `example` (cycle 240) and `drill` (cycle 200) blocks:
    - have no `~` continuation markers and no indentation of the parameter lines
    - are not numbered
    - cycle 200 lacks `Q395`

    Pasted as-is they probably do not form a valid multi-line block (verify on a control or simulator).
24. The blocks insert German cycle names and labels. Decide on a policy: keep the control's language or make it configurable per dialect.

### Missing editor features (not yet planned)

25. No hover or context help for Klartext words or cycle Q parameters.
26. No folding provider (for the regions listed in §8).
27. No linter (§9).
28. No block renumbering that is aware of continuation lines and block 0 (Fanuc-style N renumbering would corrupt Klartext).
