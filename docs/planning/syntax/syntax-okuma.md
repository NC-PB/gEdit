# Okuma OSP (lathe): syntax notes (CAM-output subset)

Proposed dialect id in gEdit: `okuma-osp`, with a `lathe` profile first and a `mill` profile later. These are planning notes. Nothing here is implemented unless §11 says so.

Sources:

- OSP-P200L / P20L programming manual (English). It covers 2-axis and two-turret lathes, C-axis and live tools.
- General DIN 66025 introductions (German).

Anything marked **(verify)** is general knowledge or an interpretation that the manual does not state clearly. Check it against real CAM output before hard-coding it. Okuma machining centres (OSP "M" controls) share much of the lexical syntax but differ in code meanings. They are not covered here.

---

## 1. Scope note

**In scope.** What lathe post-processors write for OSP controls:

- `G00`/`G01`/`G02`/`G03`, including arcs by radius with `L`
- `G50 S` spindle limit, `G96`/`G97`, `G94`/`G95`, `G40`–`G42`
- `T` codes (4- and 6-digit), spindle, coolant and gear-range M-codes
- C-axis and live-tool basics (`M110`/`M109`, `M146`/`M147`, `SB=`, `M12`–`M14`)
- the standard fixed cycles a post may emit:
  - threading: `G33`/`G31`/`G32`, `G71`/`G72`
  - face drilling / grooving: `G74`, `G73`
  - tapping: `G77`/`G78`
  - live-tool drilling: `G180`–`G189`
- comments, sequence names, block delete
- subprogram `CALL`/`RTS`, `GOTO`/`IF`, common and local variables

**Tokenized only, no help text or checks for now:**

- LAP (automatic roughing/finishing: `G80`–`G88`, `G84`). It is a standard control function and some posts use it. The map shows it; §6.4 covers only the structure.
- `MODIN`/`MODOUT`, `GET`/`PUT`, `READ`/`WRITE`, system variables (`VZOFZ`, `VTOFX[…]`, …).
- Two-turret synchronization: `G13`/`G14`, `P` sync codes, `M100`.
- Y-axis and coordinate conversion (`G136`–`G138`), contour generation (`G101`–`G133`), `G140`-series spindle selection.
- Schedule programs (`.SDF`, `PSELECT`).

**Deliberately excluded:**

- Okuma's interactive/conversational programming formats.
- Machine-builder or peripheral functions: loaders, gauging, bar feeders, steady rests, most optional M-codes. They are highlighted as M-codes from a data table, no special handling.
- Backplot and DNC.

---

## 2. File and program structure

### 2.1 Typical CAM output (own example)

```
$FLANGE-OP1.MIN%
O1001
(FLANGE OP1 - CAM OUTPUT)
N1 (FACE AND OD ROUGH)
G50 S2500
G00 X600 Z400
T010101
G96 S180 M03 M42
G00 X72 Z3 M08
G95 G01 Z0.2 F0.25
X-1.6
G00 Z3
X64
G01 Z-40 F0.3
X72
G00 X600 Z400 M09
N2 (CENTER DRILL)
G97 S1500 M03
T000202
G00 X0 Z5 M08
G74 X0 Z-12 D3 F0.12
G00 Z5
G00 X600 Z400 M09
M05
M02
%
```

The feeds, the index position and the `G74` arguments are illustrative only. `T000202` is the 6-digit form with nose radius set 00, because one file should not mix 4- and 6-digit `T` words (§9). Whether posts write `M02` or `M30` depends on the post **(verify)**.

### 2.2 Structural elements

| Item | Rule |
|---|---|
| Program types | Schedule program, main program, subprogram (user or system) |
| File extensions | `.MIN` main program, `.SUB` user subprogram, `.SSB` system subprogram (supplied with the control), `.SDF` schedule program |
| File name | Up to 16 alphanumeric characters, starting with a letter, plus an extension of up to 3 letters. Hyphens appear in the manual's examples (`SHAFT-A.MIN`). |
| Tape/serial header | First line `$<FILENAME>.<EXT>%`, for example `$FLANGE-OP1.MIN%`. Programs on tape end with `%` **(verify)**. Whether files stored on disk or USB keep the header: **(verify)**. |
| Program name | `O` + up to 4 characters: letters and digits if the first character is a letter, digits only if the first character is a digit. Names are compared as text, so `O0123` ≠ `O123` and `O0` ≠ `O00`. |
| Program-name block | Contains nothing else. Whether a comment on the same line is accepted: **(verify)**; CAM posts put the comment on the next line. |
| Main program | The `O` name is optional. Ends with `M02` or `M30`. |
| Subprogram | The `O` name is mandatory. Ends with `RTS`. A `.SUB` file can hold several `O` programs **(verify)**. |
| Schedule program | No `O` name. Uses `PSELECT` blocks. Ends with `END`. |
| End of block | LF in ISO code, CR in EIA code. Files on a PC often use CR LF **(verify)**. Keep line endings unchanged. |
| Block length | At most 158 characters per block |
| Character set | ISO (ASCII) or EIA tape code. Parity checks (TV/TH) also apply to comment text, so avoid non-ASCII characters in comments. |

---

## 3. Lexical rules (tokenizer spec)

### 3.1 Block anatomy

```
[/] [Nxxxx] [control-statement] word word … [(comment)]
```

1. **Block delete** `/`: only at the start of the block or directly after the sequence name. Anywhere else the control raises an alarm. The manual shows no numbered skip levels (`/2` …) for this control **(verify)**.
2. **Sequence name** `N` + 1–4 characters. There are two forms:
   - a sequence number, digits only (`N0010`, `N12`)
   - a sequence name, starting with a letter and followed by letters or digits (`NLAP1`, `NT01`)

   It must be the first word, except for `/`. It **must be followed by a space or tab**. Leading zeros matter (`N0123` ≠ `N123`). Order is free, but names must be unique if jumps use them.
3. **Control statement**, if any, directly after the sequence name: `GOTO`, `IF`, `CALL`, `RTS`, `MODIN`, `MODOUT`, `GET`, `PUT`, `READ`, `WRITE`, `PSELECT`. It must be followed by a space or tab. `IF` may be followed directly by `[`.
4. **Words.**
5. **Comment** in parentheses.

### 3.2 Words and addresses

| Form | Examples (own) | Notes |
|---|---|---|
| Letter + number | `X64.` `Z-40` `F0.25` `G01` `M42` `T0202` `S180` | |
| Letter `=` expression or variable | `Z=V1+V2` `X=DIA1` `X=100+XP2` | `=` is required when the value is not a plain number. Spaces around `=` are allowed. |
| Two-letter extended address | `SB=1200` `QA=5` `DA=1.5` | **`=` is always required.** Reserved set: one of the letters `A D F I K L R S T U W X Z` followed by `A` or `B` (`SA`, `SB`, `DA`, `ZB`, …), plus `BC` and `BR`. The manual also uses `QA` (C-axis revolutions) and `SA` (C-axis speed in thread cycles). |
| Keyword word | `CALRG` | Selects the larger arc (over 180°) in an `L`-radius arc block |

### 3.3 Numbers

- Optional sign, digits, optional decimal point. `X64`, `X64.`, `X64.0` and `X64.000` are all accepted.
- **Numbers without a decimal point depend on a unit parameter.** In the "1 mm" unit setting, `X1` = `X1.0` = 1 mm. In the "1 µm" setting, `X1` = 0.001 mm. The file itself does not say which setting is used. gEdit should offer a profile option "integer unit: mm | µm" (default mm, **verify** with real machines). A lint can report axis words without a decimal point.
- Ranges from the manual (metric):

| Address | Range |
|---|---|
| X, Z | ±99999.999 |
| C | ±359.999 |
| F | Up to 8 significant digits |
| G | 0–999 |
| M | 0–511 |
| S | 0–9999 in the range table, 0–65535 in the S section |
| T | 4 or 6 digits |
| O, N | 4 characters |

- `$` + hex digits is a hexadecimal constant inside `BIN[…]`/`BCD[…]`. It is rare. Do not confuse it with the `$…%` header, which only appears at the start of line 1.

### 3.4 Comments

- `( … )` anywhere in a block, including after words (`N100 G00 X200 (ROUGH)`).
- Match non-greedily (`\([^)]*\)`) so that `(A) X10 (B)` keeps `X10` as code.
- Nested parentheses are not supported **(verify)**. An unclosed `(`: **(verify)** whether it runs to the end of the block; treat it as a comment to the end of the line and lint it.
- No `;` comments in this manual. Whether newer OSP versions accept them: **(verify)**.

### 3.5 Expressions and operators

- Arithmetic: `+ - * /`.
- Square brackets `[ ]` group expressions and hold function arguments: `SIN[30]`, `SQRT[V1*V1+V2*V2]`, `MOD[17,5]`.
- Functions:
  - trigonometry: `SIN`, `COS`, `TAN`, `ATAN`, `ATAN2`
  - arithmetic: `SQRT`, `ABS`, `MOD`
  - rounding: `ROUND`, `FIX`, `FUP`, and the variants `DROUND`, `DFIX`, `DFUP`
  - conversion: `BIN`, `BCD`
- Comparison: `EQ NE GT GE LT LE`, used inside `IF [ … ]`. They need a space on each side.
- Logical and bitwise: `OR AND EOR NOT`. They need a space on each side.
- Parentheses are **never** expression brackets. They always start a comment. This is the main difference from Siemens syntax.

### 3.6 Variables

| Kind | Form | Notes |
|---|---|---|
| Common variables | `V1`–`V200` | Shared by main and subprograms; kept through reset and power-off. `V5 = V5 + 1`. The count may depend on options **(verify)**. |
| Local variables | Free names: two letters first, up to 4 characters (`DIA1`, `XP1`, `ABC`, `WLZ1`) | Must not clash with function names, operators or extended addresses. The manual excludes `O`, `N` and `V`, which reads as "not as first letter" **(verify)**. Cleared on reset; names passed in a `CALL` block are cleared by `RTS`. |
| System variables | `V` + letter + 3 characters, some indexed: `VZOFZ`, `VZSHX`, `VTOFX[5]`, `VNSRZ[4]` | Fixed names from a table (zero offsets, zero shift, tool offsets, nose radius, limits, …) |

Tokenizer order: system variables (`V[A-Z][A-Z0-9]{3}` from a list) → common variables (`V\d+`) → local variables (identifier matching the local-name rule and not a keyword).

### 3.7 Whitespace and case

- A space or tab is **required** after a sequence name, after a control statement, and around `LT`…`GE` / `AND`/`OR`/`EOR`/`NOT`.
- Elsewhere the manual's examples always separate words with spaces. Whether packed words (`G00X50Z150`) are accepted: **(verify)**. The tokenizer should accept both.
- The manual uses upper case only. Highlight case-insensitively and lint lower case **(verify whether the control accepts it)**.

### 3.8 Monarch rule order (proposal)

Nothing spans lines, so a single `root` state is enough. Monarch takes the first matching rule, not the longest, so address rules must come before the generic identifier rule.

| # | Regex (sketch, `ignoreCase: true`) | Token |
|---|---|---|
| 1 | `^\$[^%]*%` (line 1 only) | `meta.header` |
| 2 | `^\s*%\s*$` | `meta.tape` |
| 3 | `\([^)]*\)?` | `comment` (optional `)` so an unclosed comment ends at end of line) |
| 4 | `^\s*\/` → push state `afterSkip`, where rule 5 without `^` applies and the state pops on the next token | `keyword.skip` |
| 5 | `^\s*N([0-9]{1,4}\|[A-Z][A-Z0-9]{0,3})(?=[ \t]\|$)` → push state `afterSeq`, which accepts `/` (rule 4) and a control statement (rule 7), then pops | `tag.sequence` |
| 6 | `^\s*O([0-9]{1,4}\|[A-Z][A-Z0-9]{0,3})\s*$` | `entity.name.program` |
| 7 | `\b(GOTO\|IF\|CALL\|RTS\|MODIN\|MODOUT\|GET\|PUT\|READ\|WRITE\|PSELECT\|END)\b` | `keyword.control` |
| 8 | `\bO[A-Z0-9]{1,4}\b` after `CALL`/`MODIN` | `entity.name.function` |
| 9 | `N[A-Z0-9]{1,4}` after `GOTO`, after `IF […]`, or after `G85`/`G86`/`G87`/`G88` | `tag.sequence.ref` |
| 10 | `G\d{1,3}(?![\d.])` | `keyword.gcode` |
| 11 | `M\d{1,3}(?![\d.])` | `keyword.mcode` |
| 12 | `T(\d{6}\|\d{4})(?!\d)` | `number.tool`. Other lengths: `invalid`. |
| 13 | `([ADFIKLRSTUWXZ][AB]\|BC\|BR\|QA)(?=\s*=)` | `keyword.address` |
|    | `[A-UW-Z](?=\s*=)` (single letter + `=`, e.g. `T=V1`, `Z=LZ1+2`) | `keyword.address` |
| 14 | `V[A-Z][A-Z0-9]{3}` from the system-variable list | `variable.predefined` |
|    | `V\d{1,3}\b` | `variable` |
| 15 | `\b(ATAN2?\|SIN\|COS\|TAN\|SQRT\|ABS\|MOD\|D?ROUND\|D?FIX\|D?FUP\|BIN\|BCD\|EQ\|NE\|[GL][TE]\|AND\|OR\|EOR\|NOT\|CALRG)\b` | `keyword.operator` / `support.function` |
| 16 | `[XZYCWU]` + number | `number.axis` |
|    | `[IK]` + number | `number.arc` |
|    | `L` + number | `number.radius` (radius, chamfer size, or relief amount depending on the G-code) |
|    | `F` | `number.feed` |
|    | `S` | `number.speed` |
|    | `[DEHQPABJR]` + number | `number` |
| 17 | `[A-Z]{2}[A-Z0-9]{0,2}\b` (not matched by earlier rules) | `variable.local` |
|    | any other `[A-Z][A-Z0-9]*` | `identifier` |
| 18 | numbers `[-+]?(\d+\.?\d*\|\.\d+)` | `number` |
| 19 | `[-+*/=]`, `[\[\],]` | `operator` / `delimiter` |
| 20 | `[ \t]+` | `white` |

`defaultToken` should be neutral (`source`). Reserve `invalid` for explicit error rules: wrong `T` length, `/` in the middle of a block.

---

## 4. Codes commonly emitted by CAM (lathe)

### 4.1 G-codes

"Modal" means active until another code of the same kind replaces it; "one-shot" means active for that block only. "—" means the manual does not say; do not build modal-state checks on those rows yet **(verify)**.

| Code | Meaning (own words) | Kind | Parameters / notes |
|---|---|---|---|
| `G00` | Rapid positioning. Each axis moves at its own rapid rate, so the path is not a straight line. | modal | `X Z C` |
| `G01` | Linear move at feed | modal | `X Z C F` |
| `G02` / `G03` | Arc CW / CCW (ZX plane) | modal | End `X Z`, plus either `I K` (centre relative to the start point, always signed incremental; `I` along X, `K` along Z) or `L` (radius, positive, **not `R`**). With `L`, both `X` and `Z` are required and `I`/`K` are forbidden. `CALRG` selects the arc over 180°. |
| `G04` | Dwell | one-shot | Time in **`F`** (seconds, up to 9999.99). Not `P`/`X`/`U`. |
| `G40` / `G41` / `G42` | Nose radius compensation off / left / right | modal | Nose radius number comes from the 6-digit `T` |
| `G50` | `G50 S…`: maximum spindle speed. `G50 X… Z…`: zero shift, non-modal, no `T` allowed in the same block. | see note | Very common in CAM headers |
| `G64` / `G65` | Corner droop control off / on | modal | |
| `G75` / `G76` | Automatic chamfer / corner rounding in a `G01` block, size in `L` | one-shot | Only one of `X`/`Z` in the block. **Not grooving/threading cycles as on Fanuc.** |
| `G90` / `G91` | Absolute / incremental. `G90` after reset. Not both in one block. | modal | `X` stays a diameter in `G91`. |
| `G94` / `G95` | Feed per minute / per revolution. `G95` after reset. | modal | |
| `G96` / `G97` | Constant cutting speed (m/min) / fixed rpm | modal | **A `G96`/`G97` block must contain `S`.** No threading in `G96`. |
| `G110` / `G111` | Constant speed control on turret A / B | — | Two-turret machines |
| `G13` / `G14` | Select turret A / B | — | Optional; two-turret machines |
| `G17` / `G18` / `G19` | Cutter radius compensation plane (live-tool milling) | — | Optional |
| `G31` / `G33` | Longitudinal thread cycle, one pass per block | cycle | `X` pass diameter, `Z` end, `F` lead, taper `I` or `A`, `E`/`K` start shift, `L` chamfer, `J` thread count, `C` phase |
| `G32` | Face thread cycle | cycle | |
| `G34` / `G35` | Variable-lead thread (increasing / decreasing lead) | cycle | |
| `G71` / `G72` | Multi-pass thread cycle, longitudinal / face | cycle | See §6. **Not roughing cycles as on Fanuc.** |
| `G73` | Longitudinal grooving cycle | cycle | |
| `G74` | Face grooving / axial peck drilling | cycle | See §6 |
| `G77` / `G78` | Tapping cycle, right-hand / left-hand | cycle | |
| `G80`–`G88` | LAP: shape definition and roughing/finishing calls | — | **Not drilling cycles as on Fanuc.** See §6.4. |
| `G180`–`G189` | Live-tool cycles: `G180` cancel; `G181` drill; `G182` bore; `G183` deep-hole drill; `G184` tap; `G185`–`G188` threading; `G189` ream | cycle, active until `G180` **(verify)** | See §6.3 |
| `G107` / `G108`, `G178` / `G179` | Synchronized tapping | | Optional |
| `G136` / `G137` / `G138` | End conversion or Y-axis mode off / start coordinate conversion / Y-axis mode on | | Optional (mill-turn) |
| `G20` / `G21` | Home position return / ATC home return | — | **Not inch/metric as on Fanuc.** Optional. |
| `G54`–`G59` | Not defined on this control. The work zero lives in the control's zero-offset data; programs shift it with `G50 X Z`. | — | Newer OSP versions: **(verify)** |

### 4.2 M-codes most relevant for CAM output

| Code | Meaning |
|---|---|
| `M00` / `M01` | Program stop / optional stop |
| `M02` / `M30` | End of main program (reset and rewind) |
| `M03` / `M04` / `M05` | Work spindle forward / reverse / stop |
| `M06` | Tool change (optional, ATC machines only; turret machines index with `T`) |
| `M08` / `M09` | Coolant on / off |
| `M12` / `M13` / `M14` | Live-tool spindle stop / forward / reverse |
| `M15` / `M16` | C-axis positioning in positive / negative direction |
| `M19` | Spindle orientation |
| `M22` / `M23` | Thread-end chamfer off / on |
| `M24` / `M25` | Chuck barrier off / on |
| `M26` / `M27` | Thread lead along Z / along X |
| `M32` / `M33` / `M34` | Thread infeed: along one flank / zigzag / along the other flank |
| `M40`–`M44` | Spindle gear range: neutral, 1, 2, 3, 4 |
| `M48` / `M49` | Spindle override: honour / ignore |
| `M55` / `M56` | Tailstock quill retract / advance |
| `M60` / `M61` | Constant speed: wait for speed / do not wait |
| `M73` / `M74` / `M75` | Thread infeed pattern 1 / 2 / 3 |
| `M83` / `M84` | Chuck clamp / unclamp |
| `M88` / `M89` | Air blow off / on |
| `M109` / `M110` | C-axis mode off / on. `M110` must be alone in its block. |
| `M146` / `M147` | C-axis unclamp / clamp |

All other M-numbers up to 511 are optional or machine functions. Keep them in a data table; never treat them as errors. One block may hold at most one `S`, one `T` and eight `M` codes.

### 4.3 Other addresses

| Address | Meaning |
|---|---|
| `S` | Spindle rpm, or cutting speed under `G96` |
| `SB=` | Live-tool spindle speed |
| `F` | Feed per rev or per minute. Also dwell time in `G04`/cycles and thread lead in thread cycles. |
| `I`, `K` | Arc centre offsets, taper amount, rapid shift in cycles |
| `L` | Arc radius, chamfer/round size, thread chamfer length, relief amount (`G183`) |
| `D` | Depth of cut / peck depth (cycles, LAP) |
| `E` | Dwell at the bottom (cycles), lead change (variable-lead threads), Z shift of the thread start |
| `Q` | Repeat count (`CALL … Q…`), number of holes (`G181`–`G189`), number of thread starts (`G71`) |
| `U`, `W` | Finish allowance X / Z in LAP and some cycles. **Not incremental X/Z as on Fanuc lathes** (Okuma uses `G91`). |
| `C` | C-axis angle, or thread phase in `G33` |
| `A`, `B` | Taper angle, infeed angle (thread cycles) |
| `J` | Number of threads within the lead `F` |
| `P` | Synchronization code between turrets (two-turret machines) |

### 4.4 Differences from Fanuc that matter for the editor

| Topic | Okuma OSP lathe | Fanuc lathe (verify details in syntax-fanuc.md) |
|---|---|---|
| Program name | `O` + 4 alphanumeric characters; names compared as text | `O` + digits (numeric) |
| File types | `.MIN`, `.SUB`, `.SSB`, `.SDF` | Typically `.NC` / no fixed extension |
| Header | `$NAME.MIN%` | `%` line |
| Sequence names | Alphanumeric (`NLAP1`); space after is mandatory | Digits only |
| Arc radius | `L` | `R` |
| Dwell | `G04 F<s>` | `G04 X`/`U`/`P` |
| Incremental | `G91` only | `U`/`W` words (G-code system A) |
| `G71`/`G72` | Thread-cutting cycles | Roughing cycles |
| `G75`/`G76` | Chamfer / round in `G01` | Grooving / threading cycles |
| `G80`–`G89` | LAP shape and calls | Drilling cycles (lathe) |
| Drilling with live tools | `G181`–`G189`, cancel `G180` | `G83`–`G89` (lathe), cancel `G80` |
| `G20`/`G21` | Home / ATC return | Inch / metric |
| Work offsets | Zero-offset data, `G50 X Z` shift; no `G54`–`G59` | `G54`–`G59` or `G50`/`G92` |
| Subprogram call | `CALL O1234 Q2 VAR=…` / `RTS` | `M98 P…` / `M99` |
| Variables | `V1`…, named locals, `VZOFZ`… | `#1`…, `#100`…, `#500`… |
| Expressions | `[ ]` brackets, `EQ`/`NE`/…, `SIN[…]` | `[ ]` brackets, `EQ`/`NE`/…, `SIN[…]` (similar) |
| Integers without a decimal point | Unit parameter (often mm) | Often 0.001 mm |
| Tool word | `T0202` or `T010203` (see §5) | `T0202` (tool + offset) |

---

## 5. Tool change and offsets

### 5.1 T word

| Form | Digits | Meaning |
|---|---|---|
| 4 digits | `T ttoo` | `tt` = tool (turret station) number 00–99, `oo` = tool offset number |
| 6 digits | `T rrttoo` | `rr` = nose radius compensation number, `tt` = tool number, `oo` = tool offset number |

Examples (own):

- `T0303`: tool 3, offset 3.
- `T010101`: nose radius set 1, tool 1, offset 1.
- `T020305`: nose radius set 2, tool 3, offset 5.

The manual gives the 6-digit order as "nose radius number, tool number, offset number". The 4-digit order (tool then offset) follows from a grooving-cycle example that switches `T0101` → `T0102` for a second offset on the same tool. **(verify both on a machine)**. Offset sets hold 32, 64 or 96 entries depending on the machine.

### 5.2 Behaviour

- The turret indexes when the `T` word runs. In a block with motion, `T` runs first. No `M06` is needed on turret machines; `M06` exists only for ATC machines.
- A `T` inside a cycle block (for example `G73`/`G74` … `T0102`) only switches the **offset** for the cycle's end point. It is not a tool change.
- Changing only the offset or nose-radius digits of the current tool (`T010101` → `T110111`) is not a tool change either.

### 5.3 Detecting a tool change for the program map

1. Remove comments.
2. For each `T` word with 4 or 6 digits, extract the tool number (`tt`).
3. Emit a tool change when `tt` differs from the current tool, or for the first `T` in the program. Skip `T` words in cycle blocks (`G71`–`G78`, `G180`–`G189` lines).
4. `tt = 00` is "no tool / cancel" **(verify)**. Do not list it.
5. On ATC machines, `M06` with the last `T` is the change; use the same logic as Fanuc mills.
6. Label: the tool number plus the comment on the same block or the nearest preceding comment line. CAM posts usually write an operation comment before the index move.
7. Live tool active: `SB=` + `M13`/`M14` after the `T`. The map can tag the tool as "live" when `M110`/`SB=` follows before the next `T`.

---

## 6. Cycles relevant to CAM output

### 6.1 Face drilling / grooving: `G74`

```
G74 X… Z… [I…] [K…] D… [L…] [DA=…] [E…] F… [T…]
```

| Param | Meaning |
|---|---|
| X, Z | Target point; `X0` for a centre hole |
| I, K | Shift per pass in X (as diameter) / Z |
| D | Peck depth |
| L | Total depth after which the tool retracts fully (optional) |
| DA= | Retract amount per peck (default from a parameter) |
| E | Dwell at the bottom (same unit as `G04 F`) |
| T | Offset number to use at the target point (optional) |

`G73` is the longitudinal (X-direction) counterpart for grooving.

### 6.2 Tapping and threading

- `G77` right-hand / `G78` left-hand tapping:

  ```
  G77 X… Z… K… F…
  ```

  `X`: start position, `Z`: tap depth, `K`: rapid approach distance, `F`: feed (= pitch × rpm under `G94`, or lead under `G95`, **verify** which the post uses). The spindle speed must be set before the cycle.
- `G33`/`G31` single-pass thread: one block per pass. CAM posts often write a list of these blocks, one per infeed. Parameters as in §4.1.
- `G71` multi-pass longitudinal thread (`G72` face):

  | Param | Meaning |
  |---|---|
  | X | Final diameter |
  | Z | End of thread |
  | A or I | Taper angle, or radius difference |
  | B | Infeed angle |
  | D | First depth of cut (diameter) |
  | U | Finish allowance (diameter) |
  | H | Thread height (diameter) |
  | L | End chamfer (with `M23`) |
  | E | Lead change for variable-lead threads |
  | F | Lead |
  | J | Threads within `F` |
  | M | Infeed mode/pattern (`M32`–`M34`, `M73`–`M75`) |
  | Q | Multi-start count |

### 6.3 Live-tool cycles `G181`–`G189` (cancel `G180`)

```
G181 X… Z… [C…] [R…] I…|K… F… [Q…] [E…]      (drill)
G183 … D… L…                                   (deep hole: peck D, relief L)
```

| Param | Meaning |
|---|---|
| X, Z | Hole start and end. Which is the start depends on face vs. radial drilling. |
| C | C-axis angle of the first hole |
| I / K | Rapid approach distance for radial / face holes |
| R | Infeed direction and amount |
| F | Feed |
| Q | Number of equally spaced holes (repeat around C) |
| E | Dwell at the bottom |
| D | Peck depth (`G183`) |
| L | Relief amount (`G183`) |

Typical surroundings:

- before: `M110` (C-axis on), `SB=` + `M13`
- after: `G180` (cancel), `M12`, `M109`
- The control clamps and unclamps the C-axis around each hole.

`G185`–`G188` (threading with the C-axis) use `SA=` for C-axis speed. `G190`/`G191` (keyway cutting) are optional, recognize only.

### 6.4 LAP (recognize structure only)

- The shape is defined between `G81` (longitudinal) or `G82` (face) and `G80`. `G83` defines the blank. The first shape block carries a sequence name (`NLAP1`).
- `G85 NLAP1 D… F… U… W…` roughs along that shape. `G86` is copy roughing, `G87` finishing, `G84` changes cutting conditions within a `G85`. `G88` is continuous threading.
- No `S`, `T` or `M` in a `G85` block.
- Editor support: link the sequence name after `G85`/`G86`/`G87` to its definition (go to definition), fold `G81`…`G80`, and add one map item per LAP call.

---

## 7. Subprograms, labels, variables

### 7.1 Calls and returns

| Form | Meaning |
|---|---|
| `CALL O1234` | Call subprogram `O1234`. The search order across `.SUB`/`.SSB` files is set by the control **(verify)**. |
| `CALL O1234 Q3` | Call 3 times (1–9999) |
| `CALL O1234 DIA1=50 ZL1=-20` | Call with local variables set for the subprogram. They are cleared by `RTS`. |
| `RTS` | End of subprogram; continue after the `CALL` block |
| `MODIN O1234 [Q…] [vars]` / `MODOUT` | Call the subprogram after every following move block until `MODOUT`. Must be cancelled in the same program. Nesting up to 8. |
| `M02` / `M30` | End of main program |

The manual shows a `CALL` whose variable list continues on the next line, starting with `&` **(verify: continuation syntax)**.

### 7.2 Labels and jumps

There are no separate labels. Jump targets are sequence names:

- `GOTO N2000`
- `IF [V1 EQ 10] GOTO N2000`, or the short form `IF [V1 EQ 10] N2000`
- `IF ABC N2000` jumps if local variable `ABC` is defined

The target must be in the same program.

### 7.3 What the editor needs

- **Go to definition:**
  - sequence names after `GOTO` / `IF` / `G85`–`G87` → their block in the same file
  - `CALL O…` / `MODIN O…` → the `O` block in the same file, or in sibling `.SUB`/`.SSB` files
- **Highlighting:** `V\d+`, system variables and local variable names in distinct colours.
- **Folding:** from each `O` block to its `RTS`/`M02`/`M30`; LAP `G81`/`G82` … `G80`; tool sections.

---

## 8. Program-map / outline hints

| Item | Detection (after stripping comments) | Label |
|---|---|---|
| File header | `^\$([^.%]+)\.(MIN\|SUB\|SSB\|SDF)%` (raw line 1) | File name |
| Program | `^\s*O([A-Z0-9]{1,4})\s*$` | `O` name (several per `.SUB` file) |
| Operation comment | Full-line `( … )`, or a block that has only a sequence name plus a comment (`N2 (CENTER DRILL)`) | Comment text |
| Sequence name (alphanumeric) | `^\s*/?\s*N[A-Z][A-Z0-9]{0,3}\b` | Name (usually a LAP shape or a jump target) |
| Tool change | §5.3 | `T` tool number + comment |
| Spindle limit | `G50 S…` | "Max rpm …" (info) |
| Zero shift | `G50 X… Z…` | "Zero shift" |
| C-axis / live tool | `M110`, `M109` | "C-axis on/off" |
| Cycle | `G7[1-4]`, `G7[78]`, `G18[1-9]`, `G3[1-5]` (threads) | Cycle name |
| LAP call | `G8[5-8]` | "LAP rough/finish" + shape name |
| Subprogram call | `CALL O…`, `MODIN O…` | Target |
| Stops | `M00`, `M01` | Stop / optional stop |
| End | `M02`, `M30`, `RTS`, `END` (schedule) | End |

---

## 9. Validation and lint ideas (cheap, line-based)

Severity: **E** = likely error, **W** = warning, **I** = info.

1. **E** Sequence name not followed by a space or tab (`N100G00`).
2. **E** `/` anywhere other than block start or directly after the sequence name.
3. **E** Program-name block (`O…`) contains other words.
4. **E** `O` name longer than 4 characters, or starting with a digit and containing a letter. The same rule applies to `N` names.
5. **E** Control statement (`GOTO`, `CALL`, `RTS`, `MODIN`, `MODOUT`, …) not followed by a space or tab. Comparison or logical operator without spaces.
6. **E** `GOTO`/`IF` target sequence name missing in the same program. **E** Duplicate sequence names used as jump targets.
7. **E** Main program (`.MIN`) without `M02`/`M30`. **E** Subprogram without `RTS`. **E** `MODIN` without a `MODOUT` in the same program.
8. **E** `G02`/`G03` with `L` and `I`/`K` in the same block, or with `L` but only one of `X`/`Z`. **W** Arc with neither `L` nor `I`/`K`.
9. **E** `G96`/`G97` block without `S`. **W** `G96` without an earlier `G50 S` limit.
10. **E** Thread cycle (`G31`–`G35`, `G71`, `G72`) while `G96` is active.
11. **E** `G75`/`G76` outside `G01` mode, or with both `X` and `Z`.
12. **E** `G90` and `G91` in one block. **E** `T` word in a `G50` block. **E** `M110` not alone in its block.
13. **E** More than one `S`, more than one `T`, or more than eight `M` codes in one block.
14. **E** `T` word with other than 4 or 6 digits. **W** Mixed 4- and 6-digit `T` words in one file.
15. **E** Unclosed `(` comment in a block. **W** Nested `(`.
16. **E** Two-letter extended address without `=` (`SB1200`).
17. **E** Block longer than 158 characters.
18. **W** Axis word without a decimal point (a unit-setting trap) and profile set to "check integers".
19. **W** First `G01`/`G02`/`G03` after a tool change without an `F` in effect.
20. **W** `G85`/`G86`/`G87` referencing a sequence name that does not exist, or `S`/`T`/`M` in a `G85` block. **W** `G81`/`G82` without a closing `G80`.
21. **W** Fanuc-only constructs in an Okuma file: `G54`–`G59`, `R` on an arc, `G04 P`, `M98`/`M99`, `#` variables, `U`/`W` used as incremental moves, `;`. This probably means the wrong dialect or post.
22. **I** Local variable name that clashes with a function or operator name, or starts with `O`/`N`/`V`.
23. **I** Non-ASCII characters in comments (parity checks and tape codes).

---

## 10. Open questions / verify on real CAM output

1. Do posts write the `$NAME.MIN%` header and a closing `%`? Should gEdit add or strip it on save (profile option)?
2. Default unit for numbers without a decimal point on typical machines (mm vs. µm). Do posts always write decimal points?
3. 4-digit `T` order (tool + offset) and 6-digit order (nose R + tool + offset): confirm with posts and machines. Does `T00xx` cancel?
4. Do current OSP versions (P300L and later) accept `;` comments, `G54`-style offsets, lower case, or packed words?
5. Is a comment allowed on the same line as the `O` name?
6. Do posts use alphanumeric sequence names (for example `NT01`) to mark tool sections? If so, use them as map labels.
7. How common are LAP calls (`G85`/`G87`) in current CAM output compared with long-hand moves?
8. The `&` continuation of `CALL` variable lists: real syntax, and does CAM output ever use it?
9. Tapping feed convention in `G77`/`G78` and `G184` (lead vs. feed per minute) as emitted by posts.
10. Line endings and encoding of files saved on the control and on USB.
11. Can a `.SUB` file hold several `O` programs, and how does the control resolve a `CALL O…` across files?
12. Okuma milling (OSP "M") needs its own profile: different G-codes, work offsets and tool change. Collect sample programs before planning it.

---

## 11. Gaps in current gEdit implementation

Based on `src/lib/languages/*.ts`, `src/lib/utils/gcodeParser.ts`, `src/lib/utils/detectLanguage.ts`, `src/lib/utils/dialects.ts`, `src/lib/monaco/setup.ts`, `src/lib/data/blocks/*.json` and `src/routes/+page.svelte`, as read in September 2026.

### 11.1 Extension conflict: `.min`

- `dialects.ts` lists `min` as a **Fanuc** extension.
- `detectLanguage.ts` maps `.min` to `fanuc-gcode` before sniffing.
- `.MIN` is the Okuma main-program extension, so every Okuma main program opens as Fanuc today.
- When an Okuma dialect is added, move `min` to it (or sniff `.min` files: `$…MIN%` header, 6-digit `T`, `CALL O`, `RTS`, `G50 S` with `G96`, `SB=`).
- Add `.sub`, `.ssb` and `.sdf`.
- The open dialog filter in `+page.svelte` is hard-coded to `nc`, `h`, `min`, `txt`. `.SUB`/`.SSB`/`.SDF` cannot be picked without "all files".

### 11.2 Dialect registration and detection

- `Dialect` has only two members. `DIALECTS` and `setup.ts` know no Okuma language.
- The sniffer scores Okuma code as Fanuc (N numbers, G/M words, `%`).
- Strong Okuma markers:
  - `^\$[\w-]+\.(MIN|SUB|SSB|SDF)%`
  - `\bCALL\s+O\w+`
  - `^\s*(N\w+\s+)?RTS\b`
  - `\bT\d{6}\b`
  - `\bSB=`
  - `\bG18[0-9]\b`
  - `\bV\d+\s*=`
  - `\bIF\s*\[.*\b(EQ|NE|LT|GT|LE|GE)\b`
- Weak markers: `G02`/`G03` with `L` and no `R`, `G04 F`, alphanumeric `N` names.

### 11.3 Tokenizer (reusing `fanuc.ts` would be wrong)

| Input | Result with `fanuc.ts` today |
|---|---|
| `F0.25`, `F.2` | `[SFT]\d+` has no decimal part. `F0` + `.25` → invalid. Every per-rev feed is broken. |
| `T010101` | Accepted as `T\d+`, but 4- vs. 6-digit meaning is not distinguished and wrong lengths are not flagged. |
| `NLAP1`, `NT01` | `[N:]\d+` only matches digits → invalid. |
| `O1001` works; `OABC` | Alphanumeric program names → invalid. |
| `L25.` (arc radius), `D3`, `E0.5`, `Q4`, `U0.2`, `W0.1`, `H1.2` | No rule for `L`, `D`, `E`, `Q`, `U`, `W`, `H` → invalid. |
| `SB=1200`, `DA=1`, `Z=V1+2`, `V5 = 10` | `=`, extended addresses and `V` variables are not handled. `#\d+` is Fanuc-only. |
| `CALL O1234`, `RTS`, `GOTO N10`, `IF [V1 EQ 5] N10`, `SIN[30]` | Keywords and brackets are not handled → invalid. |
| `(A) X10 (B)` | Greedy `\(.*\)`: the whole line becomes a comment. |
| `$FLANGE.MIN%` | No rule → invalid. |
| `/` block delete, whitespace | Invalid (`defaultToken: 'invalid'`). |

A new `okuma.ts` should follow §3.8.

### 11.4 Language configuration, completions, providers

- No `setLanguageConfiguration`. For Okuma it should set:
  - `blockComment: ['(', ')']` (no line comment)
  - brackets `[]`
  - auto-closing for `(`, `[`
  - a `wordPattern` that keeps `T010101`, `SB=`, `NLAP1` and `X-12.5` together
- No completions or signature help. Minimum set:
  - `G50 S` header
  - `G96 S M03`
  - `T` word template
  - `G74` drilling
  - `G71` threading
  - `G181`…`G180` live-tool drilling
  - `CALL O… Q…` / `RTS`
- The existing Fanuc completions (German text, `G81`–`G85` with `R`/`P`/`Q`) would give **wrong** help for an Okuma file, where `G81`–`G85` are LAP codes. Completions must be registered per dialect.

### 11.5 Program map (`gcodeParser.ts`)

- It returns an empty list for any language id other than the two existing ones.
- Tool detection requires `M6`+`T` in one block, so it finds nothing on an Okuma turret lathe. Needed: `T` alone, 4/6-digit parsing, offset-only changes ignored, cycle `T` words ignored (§5.3).
- Comment detection only accepts lines that are a single parenthesized comment. It misses `N2 (CENTER DRILL)`, which is the usual CAM operation marker.
- Item types are only `tool`/`comment`. Okuma needs:
  - program (`O` name), file header
  - subprogram call / `RTS`
  - alphanumeric sequence names
  - `G50 S` / zero shift
  - C-axis on/off
  - cycles, LAP calls
  - stop, end

### 11.6 Code blocks (`data/blocks/*.json`)

- There is no `okuma-osp.json`, and `index.ts` maps only the two existing ids.
- The Fanuc header block (`%` / `O1000 (NEW PRG)` / `G21 G90 G54`) is not valid Okuma:
  - comment on the `O` line: **(verify)**
  - `G21` means ATC home return
  - `G54` is undefined
- Its drilling block (`G81 Z-10.0 R2.0 F150.0`) would start a LAP shape definition on an Okuma control.
- Suggested Okuma blocks:
  - header: `$NAME.MIN%` / `O….` / `G50 S…`
  - tool start: `G00 X… Z…` / `T……` / `G96 S… M03` / `M08`
  - `G74` centre-drill
  - `G71` thread
  - live-tool drill: `M110` / `SB= M13` / `G181 …` / `G180` / `M109`
  - program end: `M09` / `M05` / `M02` / `%`
