# Siemens Sinumerik 840D sl: syntax notes (CAM-output subset)

Proposed dialect id in gEdit: `sinumerik-gcode`. These are planning notes. Nothing here is implemented unless §11 says so.

Sources:

- An 840D sl programming manual from a machine builder (German). Most of it covers the builder's own cycles, which are out of scope. Only general control syntax that is visible in its examples was used.
- General DIN 66025 introductions (German).
- General knowledge where those sources say nothing.

Source tags used below:

| Tag | Meaning |
|---|---|
| **[M]** | Seen in the provided 840D sl manual. |
| **[GK: verify]** | General knowledge — verify against a Sinumerik manual. Short form of "(general knowledge — verify against a Sinumerik manual)". |

Where a whole section is general knowledge, its first paragraph says so once.

---

## 1. Scope note

**In scope.** Programs in Siemens mode ("DIN/ISO" G-code with Siemens extensions), as post-processors write them for milling and turning centres:

- rapid, linear and circular moves; feeds, speeds and spindle commands
- tool selection (`T`, `T="name"`), cutting edges (`D`), `M6`
- settable work offsets (`G54`–`G57`, `G505`–`G599`, `G500`)
- programmable frames for 3+2 (`TRANS`, `ROT`, `AROT`, …) and the standard swivel cycle `CYCLE800`
- 5-axis transformation `TRAORI` / `TRAFOOF`
- high-speed settings: `CYCLE832`, or `G64x`/`COMPCAD`/`SOFT`/`FFWON` written directly
- standard drilling cycles `CYCLE81`–`CYCLE89`, `CYCLE840`, modal calls with `MCALL`
- comments, block numbers, labels, block skip, `MSG()`
- subprogram calls (`L…`, by name, `EXTCALL`), `M17`/`RET`, `R` parameters, simple `DEF` variables

**Tokenized only, no help text or checks for now:**

- Full control flow (`WHILE`, `FOR`, `CASE`, `REPEAT`), string functions, arrays and frame arithmetic.
- Synchronized actions (`WHEN … DO …`, `ID=`, `IDS=`), multi-channel coordination (`WAITM`, `WAITE`, `SETM`), axis and spindle container commands.
- Turning cycles (`CYCLE95`, `CYCLE93`, `CYCLE97`, `CYCLE99`, `CYCLE952`) and milling pocket/slot cycles (`POCKET3`, `SLOT1`, `CYCLE61`, …). CAM posts seldom use them. Recognize the names and show them in the map.

**Deliberately excluded:**

- Conversational work-step programs written with the control's graphical front-end. They are stored as G-code with large blocks of hidden, machine-generated lines.
- Machine-builder cycles. They show up as ordinary subprogram calls such as `NAME(1,2)` and are highlighted generically.
- ISO dialect mode (`G291`), in which the control reads Fanuc-style code. Use the Fanuc dialect for such files **[GK: verify]**.
- Definition files: `.GUD`, `.DEF`, `.INI`, tool offset files (`.TOA`), archives (`.ARC`). Open them as plain text.
- Backplot and DNC.

---

## 2. File and program structure

### 2.1 Typical CAM output (own example)

```
%_N_BRACKET_OP10_MPF
;$PATH=/_N_WKS_DIR/_N_BRACKET_WPD
; BRACKET OP10 - CAM OUTPUT
; T1  FACE MILL D50
; T12 DRILL D8.5
N10 G17 G90 G40 G71 G94
N20 G500 D0
N30 T="FACEMILL_D50" M6
N40 D1 G54
N50 CYCLE832(0.02,_ROUGH,1)
N60 MSG("FACE TOP")
N70 S3200 M3
N80 G0 X-35 Y0
N90 Z5 M8
N100 G1 Z0 F600
N110 X135
N120 G0 Z50
N130 T="DRILL_D8_5" M6
N140 D1
N150 S2400 M3
N160 MCALL CYCLE83(50,0,2,-25,,-5,,3,0,0,1,0)
N170 X20 Y20
N180 X80 Y20
N190 MCALL
N200 CYCLE832()
N210 G0 Z100 M9
N220 M5
N230 M30
```

The first two lines are only present in files moved through the transfer/archive format. A file saved on a PC as `BRACKET_OP10.MPF` usually starts directly with the first comment or block **[GK: verify]**. The `CYCLE83` arguments are illustrative only.

### 2.2 Structural elements

| Item | Rule | Src |
|---|---|---|
| Main program | Extension `.MPF` | [M] |
| Subprogram (also cycle files) | Extension `.SPF` | [M] |
| Workpiece folder | `.WPD` directory that groups main programs, subprograms and init files of one part | [M] |
| Transfer header, line 1 | `%_N_<NAME>_MPF` or `%_N_<NAME>_SPF`. It gives name and type. It is not an NC block. | [M] |
| Transfer header, line 2 (optional) | `;$PATH=/_N_WKS_DIR/_N_<PART>_WPD`, or `/_N_MPF_DIR` / `/_N_SPF_DIR` for the global program folders | [M] WKS form; [GK: verify] MPF/SPF_DIR |
| Program start | No `%`, no O-number. The file name is the program name. | [GK: verify] |
| Program names | Letters, digits, underscore. Purely numeric names occur (`%_N_1000_MPF`). Maximum length depends on software version (24 or more characters). | [M] numeric; [GK: verify] length |
| Main program end | `M30` (or `M2`) | [M] |
| Subprogram end | `M17` or `RET`. Without either, the end of file also returns **[GK: verify]**. | [M] M17; [GK: verify] RET |
| Parameterized subprogram | First line `PROC <name>(<type> <par>, …)` with optional attributes `SAVE`, `DISPLOF`, … | [GK: verify] |
| Declaration in caller | `EXTERN <name>(<type>, …)` near the top of the calling program, needed for parameterized calls outside the cycle folders | [M] |
| Definitions | `DEF …` lines must come before the first NC block of a program | [GK: verify] |
| Block | One line = one block. No continuation character. | [GK: verify] |
| Line end | LF; CR LF accepted on import. Keep the original line ending when saving. | [GK: verify] |
| Encoding | Plain ASCII in CAM output. Older controls use Latin-1 for umlauts in comments; newer ones may use UTF-8. Never convert silently. | [GK: verify] |
| Block length | Limited (512 characters on many versions). | [GK: verify] |

### 2.3 Hidden and protected lines

Programs that were edited on the control through cycle input screens contain extra comment lines with markers such as `*RO*` (read-only) and `*HD*` (hidden). The control needs them to turn a cycle call back into its input screen [M, general form; exact marker format [GK: verify]]. The same source says that a comment after a cycle call's closing bracket breaks that back-translation [M].

gEdit should:

- show these lines dimmed
- never renumber, reorder or reformat them
- warn when the user edits a line next to such a marker (§9)

CAM output usually does not contain them.

---

## 3. Lexical rules (tokenizer spec)

### 3.1 Block anatomy

```
[/n] [N123 | :123] [LABEL:] word word … [; comment]
```

1. **Block skip** `/` or `/0`–`/9` at the start of the block [M]. The level digit follows the slash directly (`/7 N35 …`) [M].
2. **Block number** `N` + digits [M]. Optional; order and uniqueness are not enforced. **Main block** `:` + digits marks a main block **[GK: verify]**. Only valid at block start (after the skip).
3. **Label** `IDENT:` at block start, optionally after the block number **[GK: verify]**. A statement can follow on the same line (`LOOP_A: G1 X10`) [M]. A label can start with `N` (`NEXT_PART:`), so check "identifier followed by `:`" **before** the block-number rule. Exclude `:=` (not used in Siemens mode, but safe).
4. **Words**, separated by spaces or tabs.
5. **Comment** `;` to end of line [M].

### 3.2 Words and addresses

| Form | Examples (own) | Notes | Src |
|---|---|---|---|
| Letter + number | `X12.5` `G1` `M30` `F800` `S12000` `T5` `D1` `L100` | The value follows the letter directly. | [M] |
| Letter `=` expression | `X=R1+5` `F=R10*2` `S=1200` | `=` is required whenever the value is not a plain number. | [GK: verify] |
| Address with numeric extension | `S3=2500` `M3=3` `M1=5` `T1=4` | Spindle-addressed S/M/T. `=` is required. | [M] |
| Multi-letter keyword with `=` | `CR=15` `AR=90` `TURN=2` `LIMS=3000` `ADIS=0.5` `SPOS=90` `CHF=1` `RND=2` `I1=` `J1=` `K1=` | Tokenize `[A-Z_][A-Z0-9_]*=` as "address with assignment". | [M] LIMS; rest [GK: verify] |
| Per-value absolute/incremental | `X=AC(10)` `Y=IC(-5)` `C=DC(90)` `C=ACP(45)` `C=ACN(45)` | Function-like modifiers | [GK: verify] |
| Multi-letter axis names | `C1=90` `Z3=10` `A3=…` | Machine-dependent. `=` is required when the axis name ends in a digit. | [GK: verify] |
| Command keyword | `TRAORI` `STOPRE` `SOFT` `COMPCAD` `DIAMON` `SUPA` | Bare keywords, no value | [M] STOPRE; rest [GK: verify] |
| Call with arguments | `CYCLE81(10,0,2,-12)` `MSG("TEXT")` `SETMS(3)` `NAME(1,,5)` | Identifier immediately followed by `(`. Empty arguments (`,,`) are allowed. | [M] |

### 3.3 Numbers

- Optional sign, digits, optional decimal point, digits. `10`, `10.`, `.5`, `-0.25` **[GK: verify]**.
- **The decimal point is optional and whole numbers mean whole units**: `X10` is 10 mm (or inch). This differs from Fanuc controls configured for implicit 0.001 **[GK: verify]**.
- Exponent written `EX`: `1.5EX3`, `2EX-4` **[GK: verify]**.
- Hex `'H1F'`, binary `'B1011'` (with single quotes) **[GK: verify]**. Rare in CAM output.
- The value belongs to the preceding address. `G1` and `G01` are the same code **[GK: verify]**.

### 3.4 Comments, strings and brackets

- `;` starts a comment that runs to the end of the line [M]. A `;` inside a string is not a comment.
- **Parentheses are not comments in Siemens mode.** They hold call arguments (`L10(1)`, `MSG("…")`, `CYCLE81(…)`) [M] and group expressions. Only in ISO mode are `( … )` comments **[GK: verify]**. Do not reuse the Fanuc comment rule.
- Strings: `"…"` [M]. They appear in `MSG`, `T="…"`, `CALL "…"`, `EXTCALL "…"` and as cycle arguments. How a quote is escaped inside a string needs checking **[GK: verify]**.
- `[ ]`: array and system-variable indices (`R[5]`, `$AA_IM[X]`, `$TC_DP1[1,1]`) **[GK: verify]**.

### 3.5 Identifiers, operators, case

- Identifiers: letter or `_` first, then letters, digits and `_`. Case-insensitive: the manual uses both `GOTOF` and `gotof` [M]. Set Monarch `ignoreCase: true`.
- Operators:
  - arithmetic: `+ - * /`, `DIV` (integer division), `MOD` **[GK: verify]**
  - comparison: `==` `<>` `<` `>` `<=` `>=` [M for `==` `<>`]
  - logical: `AND` `OR` [M], `NOT` `XOR` **[GK: verify]**
  - bitwise: `B_AND` `B_OR` `B_XOR` `B_NOT` **[GK: verify]**
  - string concatenation: `<<` **[GK: verify]**
  - assignment: `=`
- Built-in functions: `SIN COS TAN ASIN ACOS ATAN2 SQRT ABS POT TRUNC ROUND MINVAL MAXVAL` and others, written with `( )` **[GK: verify]**.

### 3.6 Variables

| Kind | Form | Src |
|---|---|---|
| R parameters | `R0`–`R99` by default (the count is machine data); `R1=5`, `X=R1`; indexed `R[R2]` | [GK: verify] |
| System variables | `$` prefix: `$P_…` program, `$A_…`/`$AA_…` actual values, `$TC_…` tool data, `$MC_…`/`$MN_…` machine data | [GK: verify] |
| Local user variables | `DEF REAL DEPTH=5`, types `INT REAL BOOL CHAR STRING[n] AXIS FRAME`; arrays `DEF REAL POS[10]` | [GK: verify] |
| Global user variables | Defined in a separate definition file. In programs they appear as plain identifiers (`NAME=2`, `IF NAME==1 …`). | [M] |
| Subprogram parameters | Names from the `PROC` line | [GK: verify] |

A tokenizer cannot tell a global variable from a subprogram called by name. Colour unknown identifiers neutrally.

### 3.7 Whitespace

- Spaces or tabs separate words. A separator is needed where two words would otherwise merge into one identifier (`G1 X10` vs. the identifier `G1X10`). Packed output such as `G1X10Y20` is accepted by the control for single-letter addresses **[GK: verify on real posts]**. The tokenizer should accept both forms.
- A space after `N123` is conventional but not required **[GK: verify]**.

### 3.8 Monarch rule order (proposal)

Monarch states persist across lines, and no Sinumerik construct spans lines. Keep everything in `root`, use line-start anchors (`^`) for skip and block number, and add explicit rules for whitespace and operators so that `defaultToken` can stay neutral (for example `source`, not `invalid`).

Monarch takes the **first** rule that matches at the current position, not the longest. The generic identifier rule would also match `G1`, `X10` or `R5`, so it must come after all address rules. Use `(?![\d.])` instead of `\b` after codes so that packed text like `G1X10` still splits.

| # | Regex (sketch, `ignoreCase: true`) | Token |
|---|---|---|
| 1 | `;.*$` | `comment` |
| 2 | `"[^"]*"` | `string` |
| 3 | `^\s*\/[0-9]?` | `keyword.skip` |
| 4 | `^\s*N\d+`, `^\s*:\d+`, and `N\d+` directly after a skip token (small `afterSkip` state that pops on the next token) | `tag.blocknumber` |
| 5 | `[A-Za-z_]\w*(?=:(?!=))` | `type.label` |
| 6 | `\$[A-Za-z_]\w*` | `variable.predefined` |
| 7 | `R\d+(?![\w.])` | `variable.parameter` |
| 8 | `G\d+(?![\d.])` | `keyword.gcode` |
| 9 | `M\d+(?![\d.])` (also the `M3` of `M3=3`) | `keyword.mcode` |
| 10 | `L\d+(?![\d.])` | `entity.name.function` (subprogram call, not an axis) |
| 11 | `(CYCLE\d+\|POCKET\d\|SLOT\d\|HOLES\d\|LONGHOLE)(?=\s*\()` | `support.function.cycle` |
| 12 | `[A-Za-z_]\w*(?==(?!=))` (e.g. `CR=`, `S3=`, `LIMS=`, `T="…"`) | `keyword.address` |
| 13 | `[XYZABCUVW][-+]?(\d+\.?\d*\|\.\d+)` | `number.axis` |
|   | `[IJK]…` | `number.arc` |
|   | `F…` / `S…` | `number.feed` / `number.speed` |
|   | `[TD]…` | `number.tool` |
|   | `[HPEQ]…` | `number` |
| 14 | `[A-Za-z_]\w*(?=\s*\()` | `entity.name.function` (call by name: `NAME(…)`, `MSG(…)`, `SETMS(…)`) |
| 15 | `[A-Za-z_]\w*` with `cases`: `@control`, `@nc`, `@types`, default `identifier` | see lists below |
| 16 | `[-+]?(\d+\.?\d*\|\.\d+)(EX[-+]?\d+)?` | `number` |
| 17 | `==\|<>\|<=\|>=\|<<\|[-+*/=<>]` | `operator` |
| 18 | `[()\[\],]` | `delimiter` |
| 19 | `[ \t]+` | `white` |

Keyword lists for rule 15:

- `@control`: `IF ELSE ENDIF WHILE ENDWHILE FOR TO ENDFOR REPEAT REPEATB UNTIL LOOP ENDLOOP CASE OF DEFAULT GOTO GOTOF GOTOB GOTOC RET PROC EXTERN DEF CALL PCALL MCALL EXTCALL BLOCK AND OR NOT XOR DIV MOD B_AND B_OR B_XOR B_NOT`
- `@nc`: `TRAORI TRAFOOF TRANSMIT TRACYL TRAANG TRANS ATRANS ROT AROT RPL SCALE ASCALE MIRROR AMIRROR SUPA DIAMON DIAMOF DIAM90 SOFT BRISK FFWON FFWOF COMPON COMPCURV COMPCAD COMPOF CUT2D CUT3DC CFC CFTCP CFIN ORIWKS ORIMKS ORIAXES ORIVECT STOPRE CIP CT AC IC DC ACP ACN`
- `@types`: `INT REAL BOOL CHAR STRING AXIS FRAME`

A strict version handles `;` inside strings by matching rule 2 before rule 1 on the remainder of a line. In CAM output this case is rare enough that rule order 1 → 2 is acceptable for highlighting. The program map and linter must use a real scanner that handles strings first.

---

## 4. Codes commonly emitted by CAM

This section is general knowledge unless tagged [M]: verify it against a Sinumerik manual. Group numbers are listed so that a lint can flag two codes from the same modal group in one block. **Verify the group numbers before using them for errors; until then report only warnings.**

### 4.1 Motion and path

| Code | Meaning (own words) | Group | Parameters / notes |
|---|---|---|---|
| `G0` | Rapid positioning | 1 | Axis words |
| `G1` | Linear move at feed | 1 | Axis words, `F` |
| `G2` / `G3` | Arc clockwise / counter-clockwise | 1 | End point, plus one of: `I J K` (centre, incremental from start by default; `I=AC(…)` for absolute), `CR=` (radius, negative for arcs over 180°), `AR=` (opening angle). Helix: extra axis word and `TURN=` for full turns. |
| `CIP` | Arc through an intermediate point | 1 | `I1= J1= K1=` intermediate point |
| `CT` | Arc tangential to the previous path | 1 | End point only |
| `G33` | Thread cutting with constant lead | 1 | Lead in `K`/`I`, start angle `SF=` |
| `G331` / `G332` | Rigid tapping in / out | 1 | Lead `K`; the spindle must be in position mode (`SPOS`) |
| `G4` | Dwell (non-modal, own block) | 2 | `F` = seconds or `S` = spindle revolutions. Not `P` as on Fanuc. |
| `G9` | Exact stop for this block only | 11 | |
| `G60` / `G64` | Exact-stop mode / continuous-path mode | 10 | |
| `G641` / `G642` / `G645` | Continuous path with rounding (`ADIS=`) / with axis tolerances / tangential variant | 10 | `G642` is common in CAM output, usually set by `CYCLE832` |
| `SOFT` / `BRISK` | Jerk-limited / step acceleration | 21 | |
| `FFWON` / `FFWOF` | Feed-forward control on/off | 24 | |
| `COMPON` / `COMPCURV` / `COMPCAD` / `COMPOF` | Compressor for short linear blocks | 30 | `COMPCAD` is typical for mold/surface CAM output |

### 4.2 Plane, units, dimensions, feed type

| Code | Meaning | Group | Notes |
|---|---|---|---|
| `G17` / `G18` / `G19` | Working plane XY / ZX / YZ | 6 | `G18` is the turning plane [M] |
| `G90` / `G91` | Absolute / incremental | 14 | Per-value override with `AC()` / `IC()` |
| `G70` / `G71` | Inch / metric for geometry only | 13 | **Different from Fanuc lathes, where G70/G71 are cycles** |
| `G700` / `G710` | Inch / metric for geometry and feed | 13 | Preferred in newer posts |
| `G93` / `G94` / `G95` | Inverse-time / per minute / per revolution feed | 15 | `G95` appears in turning [M] |
| `G96` / `G97` | Constant cutting speed / constant spindle speed | 15 | `G96 S…` needs a limit: `LIMS=` [M] |
| `G25` / `G26` | Lower / upper spindle speed limit | 3 | `G26 S3=2500` [M] |
| `DIAMON` / `DIAMOF` / `DIAM90` | Diameter programming on / off / only for absolute values | 29 | Turning |

### 4.3 Compensation, offsets, frames

| Code | Meaning | Group | Notes |
|---|---|---|---|
| `G40` / `G41` / `G42` | Cutter radius compensation off / left / right | 7 | Activated with a `D` edge. **No `G43`/`G49` in Siemens mode**: length compensation comes with `D`. |
| `G450` / `G451` | Corner behaviour with radius compensation (arc / intersection) | 18 | |
| `CUT2D` / `CUT3DC` | 2D / 3D radius compensation | 22 | |
| `CFC` / `CFTCP` / `CFIN` | Feed reference: contour / tool centre / inner radius | 16 | |
| `G500` | Deselect settable work offset | 8 | Often in the program header |
| `G54`–`G57` | Settable work offsets 1–4 | 8 | |
| `G505`–`G599` | Further settable work offsets | 8 | |
| `G53` / `G153` / `SUPA` | Suppress offsets for this block (increasing scope) | 9 | Used for safe retract before tool change |
| `TRANS` / `ATRANS` | Programmable translation (absolute / additive) | frame | `TRANS` alone resets the programmable frame |
| `ROT` / `AROT` | Programmable rotation around axes, or `RPL=` in plane | frame | Used for 3+2 when the post does not use `CYCLE800` |
| `SCALE` / `ASCALE`, `MIRROR` / `AMIRROR` | Scaling / mirroring | frame | Rare in CAM output |

### 4.4 Orientation and 5-axis

| Code | Meaning | Notes |
|---|---|---|
| `CYCLE800(…)` | Swivel the working plane (standard Siemens cycle, common in CAM output for 3+2) | See §6.2 |
| `TRAORI` | Switch on the 5-axis transformation (tool-centre-point programming) | Optional arguments (transformation number, offsets) |
| `TRAFOOF` | Switch off the active transformation | Must follow every `TRAORI`/`TRANSMIT`/`TRACYL` section |
| `ORIWKS` / `ORIMKS` | Orientation in workpiece / machine coordinates | |
| `ORIAXES` / `ORIVECT` | Interpolate orientation axis-wise / as a vector | |
| `A3= B3= C3=` | Tool direction vector (alternative to rotary axis words) | |
| `TRANSMIT` / `TRACYL` / `TRAANG` | Face-end / peripheral-surface / inclined-axis transformation for mill-turn | Named in [M] as control functions |

### 4.5 Spindle, tool, M functions

| Code | Meaning | Notes | Src |
|---|---|---|---|
| `S…` / `S<n>=…` | Spindle speed (or cutting speed with `G96`); `<n>` = spindle number | | [M] |
| `M3` / `M4` / `M5` | Spindle CW / CCW / stop (master spindle) | | [GK: verify] |
| `M<n>=3` / `=4` / `=5` | Same, for spindle `<n>` | | [M] |
| `SETMS(<n>)` | Choose the master spindle | | [M] |
| `SPOS=` / `M19` | Spindle positioning / orientation | | [GK: verify] |
| `T…` `D…` `M6` | Tool, edge, tool change (§5) | | [GK: verify] |
| `M0` / `M1` | Program stop / optional stop | | [M] |
| `M2` / `M30` | Program end | | [M] |
| `M17` | Subprogram end | | [M] |
| `M7` / `M8` / `M9` | Coolant (mist, flood, off). Machine-dependent. | | [GK: verify] |
| `MSG("…")` / `MSG()` | Show / clear an operator message. CAM posts often use it for the operation name **(verify)**. | | [M] |
| `STOPRE` | Stop look-ahead (pre-processing stop) | | [M] |

M-numbers above 30 are machine-specific. Keep them in a user-editable machine table; do not mark them as errors.

### 4.6 Differences from Fanuc that matter for the editor

| Topic | Sinumerik | Fanuc (details in syntax-fanuc.md) |
|---|---|---|
| Comment | `; …` | `( … )` |
| Program identity | File name (`NAME.MPF`), optional `%_N_…` header | `%` + `O1234` |
| Arc radius | `CR=` | `R` |
| Dwell | `G4 F<s>` / `G4 S<rev>` | `G04 P<ms>` / `X<s>` |
| Length compensation | With `D` | `G43 H` |
| Drilling | `CYCLE81(…)`, `MCALL CYCLE81(…)` | `G81 … G80` |
| Subprogram | `L123`, `NAME`, `M17`/`RET` | `M98 P…`, `M99` |
| Variables | `R1`, `DEF`, `$…` | `#1`, `#100` |
| G70/G71 | Inch/metric | Lathe finishing/roughing cycles |
| Integer values | `X10` = 10 mm | Often `X10` = 0.010 mm |

---

## 5. Tool change and offsets

This section is general knowledge unless tagged [M]: verify it against a Sinumerik manual.

### 5.1 Words

- `T<n>` (tool or pocket number), `T=<expr>`, `T="<name>"` (tool name with tool management), `T<n>=…` (tool for spindle `<n>`). `T0` deselects the tool [M, as `T0 D0`].
- `D<n>`: cutting edge (offset set) of the active tool. `D0` switches length and radius offsets off [M, as `T0 D0`]. Many configurations activate `D1` automatically after a tool change.
- `M6`: executes the change on milling machines with a magazine. Whether `T` alone changes the tool (turret) or `M6` is needed is machine data.

### 5.2 Detecting a tool change for the program map

1. Remove comments and strings (keep the string value for `T="…"`).
2. Remember the last `T` word: number, name or expression, plus its line.
3. **Milling (file contains `M6`/`M06`)**: each `M6` word (not `M60`–`M69`) is a tool change. The tool is the `T` in the same block, or the last `T` before it. Posts often pre-select the **next** tool right after the change (`T="NEXT"` a few blocks after `M6`). That pre-selection is not a change.
4. **Turning (no `M6` in the file)**: each `T` word except `T0` is a change.
5. Label: tool name or number, plus the first comment line directly above or on the same block (CAM tool description).
6. Machine-builder tool-change cycles appear as subprogram calls (`NAME(…)`). Provide a per-profile "extra tool-change pattern" regex instead of hard-coding names.

### 5.3 Offsets worth showing

- Work offset changes (`G54`…, `G505`…, `G500`) as map items.
- `D0` inside a cutting section (after `M6` and before the next tool) is suspicious (§9).

---

## 6. Cycles relevant to CAM output

This section is general knowledge: verify it against a Sinumerik manual. Classic parameter order is listed. Newer software versions add mode parameters at the end, so the tokenizer and the signature help must accept any number of arguments, including empty ones (`,,`) [M: empty arguments].

### 6.1 Drilling cycles

Call styles:

- `CYCLE8x(…)` drills once at the current position.
- `MCALL CYCLE8x(…)` makes the cycle modal. Each following positioning block (`X… Y…`) drills a hole. `MCALL` alone ends it.

Parameters shared by all drilling cycles:

| Param | Meaning |
|---|---|
| RTP | Retraction plane (absolute) |
| RFP | Reference plane (absolute; top of hole) |
| SDIS | Safety distance above RFP (no sign) |
| DP | Final depth (absolute) |
| DPR | Final depth relative to RFP. If DP and DPR are both given, DPR wins **(verify)**. |

| Cycle | Purpose | Further parameters (in order) |
|---|---|---|
| `CYCLE81` | Drill, centre drill | none |
| `CYCLE82` | Drill or counterbore with dwell | DTB: dwell at depth (s) |
| `CYCLE83` | Deep-hole drilling with pecks | FDEP / FDPR: first peck depth (abs / rel), DAM: peck reduction, DTB: dwell at depth, DTS: dwell at start / for chip removal, FRF: feed factor for first peck, VARI: 0 = chip breaking, 1 = full retract, then further mode parameters |
| `CYCLE84` | Rigid tapping (spindle position-controlled) | DTB, SDAC: spindle direction after cycle, MPIT: metric thread size or PIT: pitch, POSS: spindle stop angle, SST: tapping speed, SST1: retract speed, then further parameters |
| `CYCLE840` | Tapping with compensating chuck | DTB, SDR: retract direction, SDAC, ENC: with/without encoder, MPIT/PIT, … |
| `CYCLE85` | Bore/ream, feed in and feed out | DTB, FFR: feed in, RFF: feed out |
| `CYCLE86` | Bore, oriented spindle stop, lift off, rapid out | DTB, SDIR: spindle direction, RPA/RPO/RPAP: lift-off in the three plane axes, POSS: stop angle |
| `CYCLE87` | Bore with stop at depth (operator retracts) | SDIR |
| `CYCLE88` | Bore with dwell and stop at depth | DTB, SDIR |
| `CYCLE89` | Bore with dwell, feed out | DTB |

Hole patterns: `HOLES1` (row), `HOLES2` (circle), `CYCLE801` (grid), `CYCLE802` (list of positions). CAM posts usually write explicit positions after `MCALL` instead. Recognize the names only.

### 6.2 `CYCLE800`: swivel plane (3+2)

A standard Siemens cycle that post-processors often write before each tilted operation. The arguments, in order (classic signature):

1. retract mode
2. swivel data set name (string, may be empty)
3. swivel mode (coded: axis by axis, solid angle, projection angle, direct rotary positions)
4. rotation order code
5. offset before rotation (X0, Y0, Z0)
6. the three rotation values
7. offset after rotation (X1, Y1, Z1)
8. preferred direction
9. fine retract / tool alignment
10. further mode parameters on newer versions

For gEdit, treat the call as opaque: show parameter names in signature help and add a "plane change" map item. `CYCLE800()` with no arguments resets the swivel **(verify)**.

### 6.3 `CYCLE832`: high-speed settings

Written at the start of an operation (for example `CYCLE832(0.01,_FINISH,1)`) and reset at the end (`CYCLE832()` or an "off" mode). Arguments:

- path tolerance
- machining mode: off, finish, semi-finish, rough; newer versions add orientation variants
- further mode words

Older software uses numeric mode codes. Newer software uses symbolic constants such as `_ROUGH` **(verify per version)**. Internally the cycle switches `G64x`, the compressor, `SOFT` and `FFWON`, so posts that do not use it write those commands directly (§4.1), often with `CTOL=`/`OTOL=` tolerances.

### 6.4 Turning and milling cycles (recognize only)

`CYCLE95` (stock removal), `CYCLE93` (groove), `CYCLE97`/`CYCLE99` (thread), `CYCLE952` (contour turning), `POCKET3/4`, `SLOT1/2`, `CYCLE61`/`CYCLE71` (face milling, newer/older name), `CYCLE72` (contour milling) **(verify)**. Show them in the map as "cycle". No parameter help in phase 1.

---

## 7. Subprograms, labels, variables

### 7.1 Calls

| Form | Meaning | Src |
|---|---|---|
| `L<n>` | Call `L<n>.SPF`. Leading zeros matter (`L1` ≠ `L01`) **(verify)**. | [M] call form |
| `L<n>(args)` | Call with parameters | [M] |
| `L<n> P<k>` | Repeat the call k times | [GK: verify] |
| `<NAME>` alone in a block | Call `<NAME>.SPF` by name | [M] |
| `<NAME>(args)` | Parameterized call. Needs `PROC` in the callee and `EXTERN` in the caller. | [M] |
| `CALL "<name>"` / `PCALL <path>` | Indirect call / call with path | [GK: verify] |
| `EXTCALL "<name>"` | Run a program from external storage. Posts use it to keep a small main program and stream a large surface program. | [GK: verify] |
| `MCALL <name>(…)` / `MCALL` | Modal call after each positioning block / cancel | [GK: verify] |
| `REPEAT <l1> <l2> P=<n>`, `REPEATB <label> P=<n>`, `CALL BLOCK <l1> TO <l2>` | Repeat a program section | [GK: verify] |
| `M17` / `RET` | Return from subprogram | [M] / [GK: verify] |

### 7.2 Labels and jumps

- Definition: `NAME:` at block start [M]. Names start with a letter or `_`, up to 32 characters **[GK: verify]**.
- `GOTOF <label>` searches forward, `GOTOB <label>` backward [M]. `GOTO` searches forward then backward; `GOTOC` is like `GOTO` but raises no alarm when the target is missing **[GK: verify]**.
- The target can also be a block number (`GOTOF N200`) **[GK: verify]**.
- Conditional jump: `IF <condition> GOTOF <label>` [M].
- Structured blocks: `IF`/`ELSE`/`ENDIF` [M]; `WHILE`/`ENDWHILE`, `FOR`/`TO`/`ENDFOR`, `REPEAT`/`UNTIL`, `LOOP`/`ENDLOOP`, `CASE … OF … DEFAULT` **[GK: verify]**.

### 7.3 What the editor needs

- **Go to definition:** a label (same file). `L<n>` / `NAME` → a sibling `.SPF` in the same folder or `.WPD`.
- **Folding:** `IF`…`ENDIF`, `WHILE`…`ENDWHILE`, `FOR`…`ENDFOR`, `REPEAT`…`UNTIL`, `LOOP`…`ENDLOOP`. Also a tool section (from one tool change to the next).
- **Highlighting:** `R\d+`, `$…`, `DEF` names (collected per file) in a distinct colour.

---

## 8. Program-map / outline hints

| Item | Detection (after stripping comments and strings, unless noted) | Map label |
|---|---|---|
| Program header | `^%_N_(\w+)_(MPF\|SPF)` | Name and type |
| Path line | `^;\$PATH=` (on the raw line) | Folder (info) |
| `PROC` | `^\s*(N\d+\s+)?PROC\s+(\w+)` | Subprogram name and parameters |
| Tool change | §5.2 | `T` name/number + comment above |
| Operation comment | Full-line `;` comments. Merge consecutive comment lines into one item; use the first non-separator line (skip lines of `*`, `-`, `=`). | Comment text |
| Operator message | `MSG\("([^"]*)"\)` (on raw line) | Message text (often the CAM operation name, **verify**) |
| Work offset | `\bG5(4\|5\|6\|7)\b`, `\bG5\d\d\b` (505–599), `\bG500\b` | Offset name |
| Plane / orientation | `CYCLE800(`, `TRAORI`, `TRAFOOF`, `TRANSMIT`, `TRACYL`, blocks with `ROT`/`AROT`/`TRANS` | "Plane change" / "5-axis on/off" |
| Cycle | `MCALL CYCLE\d+`, `CYCLE\d+\(` | Cycle name |
| Subprogram call | `\bL\d+\b`, `EXTCALL`, `CALL`, `PCALL`, a bare identifier followed by `(` that is not a known function | Call target |
| Label | `^\s*(/\d?\s*)?(N\d+\s+)?([A-Za-z_]\w*):` | Label name |
| Stops | `\bM0?0\b`, `\bM0?1\b` | Stop / optional stop |
| End | `\bM30\b`, `\bM0?2\b`, `\bM17\b`, `\bRET\b` | Program end |

The patterns are sketches. `\b` fails on packed words (`N10G54`), so the real rules use a lookbehind for "no letter before" and `(?![\d.])` after the code, as in §3.8.

---

## 9. Validation and lint ideas (cheap, line-based)

Severity: **E** = likely error, **W** = warning, **I** = info.

1. **E** Unbalanced `( )` or `[ ]`, or an unclosed `"` in a block. Parentheses are syntax here, not comments.
2. **E** `GOTOF`/`GOTOB`/`GOTO` target label is missing. **W** `GOTOF` target is above the jump, or `GOTOB` target is below it.
3. **E** Duplicate label names in one file.
4. **E** Unbalanced `IF`/`ENDIF`, `WHILE`/`ENDWHILE`, `FOR`/`ENDFOR`, `REPEAT`/`UNTIL`, `LOOP`/`ENDLOOP`.
5. **E** Main program (`.MPF`) without `M30`/`M2`. **W** Subprogram (`.SPF`) without `M17`/`RET` (ending at end of file works, but posts should be explicit).
6. **E** `G2`/`G3` without any of `I`/`J`/`K`, `CR=`, `AR=`. **E** `CR=` together with `I`/`J`/`K` in one block.
7. **W** First `G1`/`G2`/`G3` after a tool change has no `F` in effect.
8. **W** `MCALL CYCLE…` still active at a tool change, `M30` or `M17` (missing cancelling `MCALL`).
9. **W** `TRAORI`/`TRANSMIT`/`TRACYL` without a following `TRAFOOF` before program end. **W** `CYCLE800` used but not reset before `M30`.
10. **I** `CYCLE832(…)` active at program end without a reset call.
11. **W** Cutting moves after `M6` with no `D` word, or with `D0`.
12. **W** `G96` without `LIMS=` (or `G26`) earlier in the program.
13. **W** Two codes from the same modal group in one block (group table in §4, **verify** before making it an error).
14. **W** Fanuc-only codes in a Sinumerik file: `G43`, `G49`, `G80`–`G89` (in Siemens mode), `M98`, `M99`, `#` variables, `( … )` used as comments. This probably means the wrong dialect or post.
15. **W** Header `%_N_<NAME>_MPF` does not match the file name or extension.
16. **W** A comment after the closing bracket of a cycle call on a line with `*RO*`/`*HD*` markers nearby (breaks back-translation on the control) [M].
17. **I** Block longer than the configured limit (default 512, **verify**).
18. **I** `DEF` after the first NC block.
19. **I** Unknown G-code (list-driven; unknown M-codes are never errors).

---

## 10. Open questions / verify on real CAM output

1. Do posts write the `%_N_…_MPF` / `;$PATH=` header, or plain files? Should gEdit add or strip it on save (a profile option)?
2. Which `CYCLE832` signature and mode constants do current posts emit (numeric vs. `_FINISH` style)? Collect samples for several software versions.
3. `CYCLE800` argument list per software version. Does `CYCLE800()` reset the swivel?
4. Drilling cycle argument count on current versions (extra mode parameters after the classic list).
5. Tool change in mill-turn output: `T="…"` + `M6` vs. `T1=…` spindle-addressed forms vs. builder cycles.
6. Is packed output (`G1X10Y20`) ever produced? Is a space after `N` guaranteed?
7. Encoding of umlauts in comments (Latin-1 vs. UTF-8) on current 840D sl / ONE controls.
8. Block length limit and maximum program-name length on current versions.
9. How `"` is escaped inside strings.
10. `DP` vs. `DPR` precedence in `CYCLE81`–`CYCLE89`.
11. Leading-zero rule for `L` numbers (`L1` vs `L01`).
12. Are the modal group numbers in §4 correct for current software?
13. Should Sinumerik ONE get its own profile, or is it covered by the same dialect? (Assume one dialect with a version option.)

---

## 11. Gaps in current gEdit implementation

Based on `src/lib/languages/*.ts`, `src/lib/utils/gcodeParser.ts`, `src/lib/utils/detectLanguage.ts`, `src/lib/utils/dialects.ts`, `src/lib/monaco/setup.ts`, `src/lib/data/blocks/*.json` and `src/routes/+page.svelte`, as read in September 2026.

### 11.1 Dialect registration

- `Dialect` is the union `'fanuc-gcode' | 'heidenhain-klartext'`. `DIALECTS` has no Sinumerik entry. `setup.ts` registers only two Monaco languages.
- The open dialog filter in `+page.svelte` is hard-coded to `nc`, `h`, `min`, `txt`. `.MPF`/`.SPF` files cannot be picked without switching to "all files". The save filters come from `DIALECTS`, so no `.MPF`/`.SPF` either.

### 11.2 Detection (`detectLanguage.ts`)

- No `.mpf`/`.spf` extension mapping.
- The content sniffer knows only Fanuc and Heidenhain. A Sinumerik file (N numbers, `G`/`M` words) scores as Fanuc.
- Suggested strong markers:
  - `^%_N_\w+_(MPF|SPF)`
  - `^;\$PATH=`
  - `CYCLE8\d+\(`, `CYCLE832\(`, `CYCLE800\(`
  - `MSG\(`
  - `T="`
  - `\bTRAORI\b`, `\bGOTO[FB]\b`, `\bDEF\s+(REAL|INT)\b`
  - `\bG64[0-9]\b`
- Suggested weak markers: full-line `;` comments, `\bM17\b`, `\bG500\b`, `\bD\d+\b` without `H`.

### 11.3 Tokenizer

- There is no Sinumerik tokenizer. Reusing `fanuc.ts` would be wrong:
  - `\(.*\)` would turn every cycle call, `MSG("…")` and `L10(1)` into a comment.
  - `;` comments are not recognized.
  - There are no rules for strings, labels (`NAME:`), `=` assignments (`CR=`, `S3=`), `R` parameters, `$` system variables, keywords (`TRAORI`, `GOTOF`, …), operators or `[ ]`.
  - `defaultToken: 'invalid'` would mark most Siemens-specific text as invalid.
- `heidenhain.ts` is not a base either (its generic identifier rule colours everything as `variable.name`).
- Build a new `sinumerik.ts` following §3.8. It needs a neutral default token and explicit whitespace/operator rules.

### 11.4 Language configuration and providers

- No `setLanguageConfiguration` for any language. For Sinumerik it should set:
  - `lineComment: ';'`
  - brackets `()`, `[]`
  - auto-closing for `(`, `[`, `"`
  - `wordPattern` that keeps `CYCLE81`, `$AA_IM`, `R10`, `X-12.5` together
  - folding markers for `IF`/`ENDIF`, `WHILE`/`ENDWHILE`, `FOR`/`ENDFOR`, `LOOP`/`ENDLOOP`, `REPEAT`/`UNTIL`
- No hover, signature help or diagnostics providers. Cycle parameter help (§6) needs a signature-help provider, not just snippets.

### 11.5 Completions

None for Sinumerik. Minimum set:

- `CYCLE81`–`CYCLE89` and `CYCLE840` snippets with parameter placeholders
- `MCALL` wrapper
- `CYCLE800`, `CYCLE832` (with a reset variant)
- `TRAORI`/`TRAFOOF` pair
- `MSG("")`
- tool change `T="$1" M6` + `D1`
- `G54`…`G57`, `G500`

The existing Fanuc completion docs are German; use one UI language for new entries.

### 11.6 Program map (`gcodeParser.ts`)

- For any language other than the two known ids it returns an empty list.
- Item types are only `tool` and `comment`. Sinumerik needs (§8):
  - label, `PROC`, subprogram call, `EXTCALL`
  - `MSG`
  - work offset
  - plane change (`CYCLE800`/`TRAORI`)
  - cycle
  - stop, end
- Reusing the Fanuc branch would not help. Its tool regex requires `M6` and `T\d+` in the same block, so it misses:
  - `T="NAME" M6`
  - `T` and `M6` on separate blocks (common when the post pre-selects the next tool)
  - spindle-addressed `T1=5`
  - turret changes without `M6`
- Its comment detection only accepts lines wrapped in `( )`, so `;` comments are never found.
- Comments and strings are not stripped before matching.

### 11.7 Code blocks (`data/blocks/*.json`)

- There is no `sinumerik-gcode.json`, and `index.ts` maps only the two existing ids.
- Suggested blocks:
  - header: `G17 G90 G40 G71 G94` / `G500 D0`
  - tool change: `T="…" M6` / `D1` / `G54`
  - `MCALL CYCLE81(…)` … `MCALL`
  - `CYCLE800` reset
  - `CYCLE832` on/off pair
  - program end: `G0 Z… M9` / `M5` / `M30`
