# Okuma OSP (lathe): syntax notes (CAM-output subset)

Proposed dialect id in gEdit: `okuma-osp`, with a `lathe` profile first and a `mill` profile later. These are planning notes. Nothing here is implemented unless §11 says so.

Sources:

- OSP-P200L / P20L programming manual (English). It covers 2-axis and two-turret lathes, C-axis and live tools.
- Added by the source review of 2026-09 ([source-review-2026-09.md](../source-review-2026-09.md)): the OSP-P300S/L lathe programming manual (German, the 2014 and the 2020 edition), the special-functions manual for the same controls (2020, the options: arc threading, synchronized tapping, work coordinate systems, 3D coordinate conversion, turret synchronous mode) and the operation manual of a multi-tasking turning-centre series (2017: Y-axis and tilted mode, sub-spindle mode, tool words). Where they settle a point below, the text says so.
- General DIN 66025 introductions (German).

Anything marked **(verify)** is general knowledge or an interpretation that the manuals do not state clearly. Check it against real CAM output before hard-coding it. Okuma machining centres (OSP "M" controls) share much of the lexical syntax but differ in code meanings. They are not covered here, and none of the manuals above covers them either: four of the owner's five Okuma programs are machining-centre programs, which open with this lathe profile today (see the review).

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

- `MODIN`/`MODOUT`, `GET`/`PUT`, `READ`/`WRITE`, system variables (`VZOFZ`, `VTOFX[…]`, …).
- Two-turret synchronization: the `P` sync codes and `M100`. (`G13`/`G14`, which select the turret a block is for, are described since M8; §4.1.)
- Contour generation (`G101`–`G103`, `G132`/`G133`): described in §4.1 since the source review, not in the database yet.
- Schedule programs (`.SDF`, `PSELECT`).

LAP (automatic roughing and finishing, `G80`–`G88`) was in this list until M8. The manual describes its codes and parameters in full, so the database describes them now; §6.4 has what the editor needs.

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
| Tape/serial header | First line `$<FILENAME>.<EXT>%`, for example `$FLANGE-OP1.MIN%`. Programs on tape end with `%` **(verify)**. Whether files stored on disk or USB keep the header: **(verify)**. A `$` at the start of a later line is not a header: it continues the block above (§3.1). |
| Program name | `O` + up to 4 characters: letters and digits if the first character is a letter, digits only if the first character is a digit. Names are compared as text, so `O0123` ≠ `O123` and `O0` ≠ `O00`. With an option parameter a subprogram name may have up to 16 characters; the profile's `CALL`/`O` patterns stop at 4. |
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

**A block can go on over several lines.** A line whose first character is `$` belongs to the block of the line before it: its words are part of that block, as if they had been written on its line. The manual uses it where one line would get too long: the change of cutting conditions (`G84`, `XA=`, `FA=` …) of a LAP roughing call, the variables handed over by a long `CALL`, and a `G71` thread cycle whose parameters run over two lines. The block ends at the first following line that does not start with `$`. The first line of the file is the exception: `$NAME.MIN%` there is the header (§2.2), which ends in `%`. For the editor this means that a thread code or a cycle in the first line is still in force on its `$` lines: a feed script that read a `$` line on its own would take the lead of a `G71` for a feed. (Corrected in M8: these notes used to give `&` as the continuation character, §7.1. Since the M8 integration the profile declares the marker as `syntax.continuationStart` and the modal interpreter and the scripts read such a line as part of the block above; see §11.7.)

### 3.2 Words and addresses

| Form | Examples (own) | Notes |
|---|---|---|
| Letter + number | `X64.` `Z-40` `F0.25` `G01` `M42` `T0202` `S180` | |
| Letter `=` expression or variable | `Z=V1+V2` `X=DIA1` `X=100+XP2` | `=` is required when the value is not a plain number. Spaces around `=` are allowed. |
| Two-letter extended address | `SB=1200` `QA=5` `DA=1.5` | **`=` is always required.** Reserved set: one of the letters `A D F I K L R S T U W X Z` followed by `A` or `B` (`SA`, `SB`, `DA`, `ZB`, …), plus `BC` and `BR`. The manual also uses `QA` (C-axis revolutions) and `SA` (C-axis speed in thread cycles). Option functions add more: `CL` (retract in arc threading), `CP`/`CQ`/`CR` (3D coordinate conversion), `SX`/`SY`/`SZ` (a zero-shift macro), and on multi-tasking machines `TL`, `TD`, `TS` and others; the profile lists them in `syntax.extendedAddresses`, the grammar and the hover paint them as addresses (keywords), and any other name in front of `=` is a local variable (M9). |
| Keyword word | `CALRG` | Selects the larger arc (over 180°) in an `L`-radius arc block |

### 3.3 Numbers

- Optional sign, digits, optional decimal point. `X64`, `X64.`, `X64.0` and `X64.000` are all accepted.
- **Every number is read in the unit system of the machine, with or without a decimal point.** A control parameter (UNIT, OSP-P200L §2-3) sets what a written "1" is worth: 1 µm, 10 µm or 1 mm in a metric system, 1/10000 inch or 1 inch in an inch system. The unit multiplies the number as written, so a decimal point does not switch to millimetres:
  - 10 µm: `X50` and `X50.` are both 0.5 mm, `X0.5` is 0.005 mm, `X5000` is 50 mm, `F25` is 0.25 mm/rev;
  - 1 µm: `X50000` is 50 mm, `X50000.5` is 50.0005 mm, `F250` is 0.25 mm/rev, `F12.5` is 0.0125 mm/rev;
  - 1 mm: `X50`, `X50.` and `X50.000` are all 50 mm, `F0.25` is 0.25 mm/rev.

  The file itself does not say which system the machine uses. (Corrected in M8: this section used to say that only numbers *without* a point depend on the parameter. The row on number values in §4.4 and item 18 of §9 were corrected with it: the unit is what matters, a point never does. The 2020 P300 manual confirms this reading, and all five of the owner's Okuma programs make sense only in the 1 mm system.)
- The unit is not the same for every kind of word. What a "1" is worth, per system:

  | Kind of word | Words | 1 µm | 10 µm | 1 mm | 1/10000 inch | 1 inch |
  |---|---|---|---|---|---|---|
  | Length | `X Z I K D H L U W` | 0.001 mm | 0.01 mm | 1 mm | 0.0001 in | 1 in |
  | Feed per revolution | `F E` | 0.001 mm/rev | 0.01 mm/rev | 1 mm/rev | 0.0001 in/rev | 1 in/rev |
  | Feed per minute | `F` | 0.1 mm/min | 1 mm/min | 1 mm/min | 0.01 in/min | 1 in/min |
  | Angle | `A B C` | 0.001° | 0.01° | 1° | 0.001° | 1° |
  | Time (dwell) | `F E` | 0.01 s | 0.1 s | 1 s | 0.01 s | 1 s |
  | Spindle speed | `S` | 1 rpm | 1 rpm | 1 rpm | 1 rpm | 1 rpm |
  | Cutting speed | `S` | 1 m/min | 1 m/min | 1 m/min | 1 ft/min | 1 ft/min |

  There is no 10 µm inch system. An inch system reads angles and times like its metric counterpart (1/10000 inch like 1 µm, 1 inch like 1 mm), and `S` is never scaled. An `F` word may carry digits below its unit, up to eight digits in all.
- **In gEdit the unit system is a machine parameter** (owner decision D34), not a property of the dialect. The profile declares three presets with the per-class units of the table: 1 mm (`calculator`, the assumed default, **verify** against the owner's machines), 1 µm and 10 µm (`scale`, every number times the unit). An inch machine takes the inch column of the 1 µm or the 1 mm preset; the 10 µm preset is metric only. Because a point never changes a value, `syntax.decimalPointSignificant` is `false` under every preset. With no machine chosen, the presets disagree about every length and feed word, so such a word has no value and nothing converts it (AD-31, "no machine, no guess").
- Ranges from the manual (metric):

| Address | Range |
|---|---|
| X, Z | ±99999.999 |
| C | ±359.999 |
| F | Up to 8 significant digits |
| G | 0–999 |
| M | 0–511 in the code list; option functions use four digits (`M1292`), which the Okuma grammar reads as one code (M9) |
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

A `$` at the start of any line after line 1 is the continuation of the block above (§3.1), not a header and not an error.

---

## 4. Codes commonly emitted by CAM (lathe)

### 4.1 G-codes

"Modal" means active until another code of the same kind replaces it; "one-shot" means active for that block only. "—" means the manual does not say; do not build modal-state checks on those rows yet **(verify)**.

| Code | Meaning (own words) | Kind | Parameters / notes |
|---|---|---|---|
| `G00` | Rapid positioning. The axes do not move in step, each goes at its own rapid rate, so the tool can leave the straight line between start and end. | modal | `X Z C` |
| `G01` | Linear move at feed | modal | `X Z C F` |
| `G02` / `G03` | Arc CW / CCW (ZX plane) | modal | End `X Z`, plus either `I K` (centre relative to the start point, always signed incremental; `I` along X, `K` along Z) or `L` (radius, positive, **not `R`**). With `L`, both `X` and `Z` are required and `I`/`K` are forbidden. `CALRG` selects the arc over 180°. |
| `G04` | Dwell | one-shot | Time in **`F`** (seconds, up to 9999.99). Not `P`/`X`/`U`. |
| `G40` / `G41` / `G42` | Nose radius compensation off / left / right | modal | Nose radius number comes from the 6-digit `T` |
| `G50` | `G50 S…`: maximum spindle speed. `G50 X… Z…`: zero shift, non-modal, no `T` allowed in the same block. | see note | Very common in CAM headers |
| `G64` / `G65` | Corner droop control off / on: with it on, each move ends only when the axes have caught up with the command, so corners stay sharp | modal | Described with the preparatory functions (manual Section 4 §3). No modal group of §7.2 fits; the database shows them in `pathmode` without a modal state. |
| `G75` / `G76` | Automatic chamfer / corner rounding in a `G01` block, size in `L` | one-shot | Only one of `X`/`Z` in the block. **Not grooving/threading cycles as on Fanuc.** |
| `G90` / `G91` | Absolute / incremental. `G90` after reset. Not both in one block. | modal | `X` stays a diameter in `G91`. |
| `G94` / `G95` | Feed per minute / per revolution. `G95` after reset. | modal | |
| `G96` / `G97` | Constant cutting speed (m/min) / fixed rpm | modal | **A `G96`/`G97` block must contain `S`.** No threading in `G96`. |
| `G110` / `G111` | With `G96`: the constant cutting speed is kept for the tool of turret A / of turret B | — | Two-turret machines; `G111` moves it to turret B, `G110` brings it back (manual Section 4 §6 and Section 11) |
| `G13` / `G14` | The blocks that follow are for turret A / turret B | — | Optional; two-turret machines. The two-turret programming section (manual Section 11 §1) describes them; a program may switch as often as it needs. `G313` selects a third turret. |
| `G15` / `G16` | Select a work (program) coordinate system: `G15 Hn` modal, `G16 Hn` for one block, n up to 10, 50 or 100 by machine | modal / one-shot | Optional. After a reset the last `G15` system is in force; not allowed under `G96` or `G41`/`G42`; chosen per saddle and per spindle. Missing from the database |
| `G17` / `G18` / `G19` | Compensation plane: X-Y (face contour, with the C axis connected) / X-Z (nose-radius compensation, the turning plane) / Y-Z | modal | `G18` is in force at power-on and after a reset, and `M109` selects it again |
| `G31` / `G33` | Longitudinal thread cycle, one pass per block | cycle | `X` pass diameter, `Z` end, `F` lead, taper `I` or `A`, `E`/`K` start shift, `L` chamfer, `J` thread count, `C` phase |
| `G32` | Face thread cycle | cycle | |
| `G34` / `G35` | Variable-lead thread (increasing / decreasing lead) | cycle | |
| `G36` / `G37` | Feed axis moved in step with the driven-tool spindle, forward / reverse | — | Optional. The special-functions manual calls this synchronized tapping, so `F` is tied to the pitch and the database refuses to scale it. No manual gives the word format **(verify)**. |
| `G71` / `G72` | Multi-pass thread cycle, longitudinal / face | cycle | See §6. **Not roughing cycles as on Fanuc.** Its parameters may run on over a `$` line (§3.1). |
| `G73` | Longitudinal grooving cycle | cycle | |
| `G74` | Face grooving / axial peck drilling | cycle | See §6 |
| `G77` / `G78` | Tapping cycle, right-hand / left-hand | cycle | |
| `G80`–`G88` | LAP: shape definition and roughing/finishing calls | — | **Not drilling cycles as on Fanuc.** Optional. See §6.4. `G84` (a LAP change of cutting conditions here, §6.4) and `G88` (continuous threading here) are also the machining centres' tapping cycle on this control family, so gEdit marks them `CodeEntry.tappingElsewhere` — `scale_speed` leaves the speed of such a block as written, like its feed, because it cannot tell which kind of machine the program is really for (`dec/scaling`, owner decision 1, 2026-09-27). |
| `G92` | Not assigned on this control | — | The code table leaves it empty. It is the single-pass thread cycle of a Fanuc lathe in G-code system A, so the database marks it as a code whose `F` may be a lead: a Fanuc program opened as Okuma keeps its thread leads. |
| `G180`–`G189` | Live-tool cycles: `G180` cancel; `G181` drill; `G182` bore; `G183` deep-hole drill; `G184` tap; `G185`–`G188` threading; `G189` ream | cycle, active until `G180` | See §6.3. The manual's cycle list (Section 7 §8) settles it for `G181`–`G184`, `G189`, `G178` and `G179`: they repeat at every following position until `G180` (the second hole's block only writes what changes). `G185`–`G188` run once; the database keeps them in force until `G180` all the same, so a lead in a following block is never scaled. |
| `G107` / `G108` | Synchronized tapping with the main spindle, right / left hand | cycle | Optional: `G107 X Z K F D` — X, Z the target, K the distance from the cycle start to the cutting start, **F the pitch** (under `G94` the pitch is F÷S; always one thread), D the spindle angle at the cutting start. Whether it stays active over several blocks is **(verify)**. |
| `G178` / `G179` | Synchronized tapping with the driven tool, forward / reverse | cycle, until `G180` | Optional; the driven-tool cycle list gives the format (`X Z C R I/K F D J Q`, manual Section 7 §8) |
| `G112` / `G113` | Thread along an arc, clockwise / counter-clockwise | modal | Optional; used in the shape of a LAP thread (`G88`). End `X Z`; the centre as `I K` from the start point, or a radius `L` (then both X and Z, and the arc under 180°). `F` is the lead (per `J` threads when `J` is given), `E` the lead change per thread (positive grows, negative shrinks), `M26`/`M27` the lead axis, `CL` a retract for a slide hold. |
| `G140` / `G141` | Machining with the main spindle / the sub spindle | — | Optional, multi-spindle machines. **The program coordinate system and the zero offset switch with them** (the sub spindle's Z runs the other way). One stands at the program start, or right after `G13`/`G14`; the B turret is always in `G140`. Refused under `G91`, `G96`, nose-radius compensation, LAP or a pending chamfer. A program after `G141` is written like one for the main spindle, so a plain `S` there drives the sub spindle (an inference, like Sinumerik `SETMS`; **verify** once). |
| `G142` / `G143` | Machining with the pick-off spindle / with it and a third turret | — | Only the P200L code table names them; the P300 list has `G144`/`G145` (W-axis control) instead **(verify)** |
| `G161`–`G170`, `G171`–`G176`, `G205`–`G214` | G-code macros: a code the machine's setup ties to a macro program, called once (`G171`–`G175`, the P200-compatible `G176`, `G205`–`G214`) or after every move like `MODIN` (`G161`–`G170`) | — | Optional. The program map lists them as calls (today only up to `G171`). What the macro does, and what its words mean, depends on the machine; on multi-tasking machines `G174 SX= SY= SZ=` is a zero shift and `G175` cancels it. |
| `G136` / `G137` / `G138` | End conversion and Y-axis mode / start coordinate conversion / Y-axis mode on | modal | Optional (mill-turn). **After `G137` or `G138`, X is a radius**: G137 machines the face in Cartesian X and Y (the block's `C` gives the direction of the new X axis; the first block after it needs both X and Y, and `G91` right after it is an alarm), G138 programs X, Y, Z as a Cartesian system. `G136` ends both, alone in its block. The Y-axis mode survives a reset and a power-off, and on a Y-axis machine an axis move before the first `G136`/`G138` is an alarm, so posts write one at every tool start (the owner's does). In the database since the source review, with `sets.diameter`. |
| `G101` / `G102` / `G103` | Contour generation: straight line / arc CW / arc CCW in X, C (and Z), arcs with the radius in `L`; with `G137` in X and Y | modal | `F` is in mm/min here. The owner's post writes them in every face-milling section. Missing from the database |
| `G132` / `G133` | Arc CW / CCW on the cylinder surface: `Z C L F` | modal | Missing from the database |
| `G119` | Compensation plane C-X-Z (side contour) | modal | Missing from the database |
| `G20` / `G21` | Home position return / ATC home return (`G24`/`G25` the same without interpolation) | — | **Not inch/metric as on Fanuc.** Optional. |
| `G54`–`G59` | Not defined on this control. The work zero lives in the control's zero-offset data; programs shift it with `G50 X Z`, and on machines with the option select a work coordinate system with `G15`/`G16 H`. | — | |
| `G93` | Inverse-time feed | modal | Optional. Missing from the database |

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
| `M17` | Sends the result of a post-process gauge over the serial line (optional). **Not a subprogram end** as on some other controls. |
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
| `M85` | LAP: no return to the start point after roughing |
| `M88` / `M89` | Air blow off / on |
| `M98` / `M99` | Tailstock quill pressing with its low / high force. **Not the subprogram call and return of a Fanuc control**, which are `CALL` and `RTS` here. |
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
| `M98` / `M99` | Tailstock quill force, low / high | Subprogram call / return |
| Variables | `V1`…, named locals, `VZOFZ`… | `#1`…, `#100`…, `#500`… |
| Expressions | `[ ]` brackets, `EQ`/`NE`/…, `SIN[…]` | `[ ]` brackets, `EQ`/`NE`/…, `SIN[…]` (similar) |
| What a number is worth | The machine's unit system scales every number, with or without a point (§3.3) | A number without a point may count increments (often 0.001 mm), set by a parameter |
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

The manual gives the 6-digit order as "nose radius number, tool number, offset number", and the P300 manual confirms it. **Which form a machine uses is its equipment:** 4 digits where nose-radius compensation is not fitted, 6 where it is. Offset sets hold 32, 64 or 96 entries, or 200, 500 or 999 on some machines, and with those the offset part has **three** digits: the plain form becomes station + 3 digits (`T2000` is station 2), and a 3-digit form `T100` (station 1) exists too. The profile's rule reads 4 and 6 digits only, so `T2000` is tool 20 today. Multi-tasking machines write tool words of their own (`TL=`, `TD=`). The owner's turning post writes 6 digits. How many offsets each of the owner's lathes has is a machine fact (a tool-word parameter, like D49 for the Fanuc lathe).

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

  `X`: start position, `Z`: tap depth, `K`: rapid approach distance, `F`: the cutting feed in the feed mode in force, so it is tied to the pitch (= pitch × rpm under `G94`, the lead under `G95`; which one the post uses is **verify**). The spindle speed must be set before the cycle. A parameter can make `G77`/`G78` run as synchronized tapping (`G107`/`G108`).
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

### 6.4 LAP (automatic roughing and finishing)

LAP is an optional function of the control, described in full in the manual (Section 8); the database describes its codes since M8.

- The shape is defined between `G81` (longitudinal) or `G82` (face) and `G80`. `G83` defines the blank (LAP4). The first shape block carries the sequence name the calls use (`NLAP1`, `NAT01`); a call looks its shape up by that name.
- `G85 NLAP1 D… F… U… W…` roughs along that shape (`D` depth of cut, `F` feed, `U`/`W` finish allowances). `G86` is copy roughing with the same words, `G87` finishing with `U`/`W` only, `G88` continuous threading (`D`, `H`, `B`, `U`, `W`, the infeed M codes). The code has to follow the sequence number directly.
- No `S`, `T` or `M` in a `G85`, `G86` or `G87` block; they go into the blocks before it. A `G88` block carries its infeed M codes.
- **A change of cutting conditions** belongs to the `G85` block and is written on the lines after it that start with `$` (§3.1): `$ G84 XA=… DA=… FA=…` and `$ XB=… DB=… FB=…` (`ZA=`/`ZB=` for a face). From the point `XA=` the roughing cuts with depth `DA=` and feed `FA=`, from `XB=` with `DB=` and `FB=`.
- **Feeds inside the shape:** in a shape block, `E` is the feed of the roughing along that element and `F` the finishing feed. `G87` finishes at the feeds the shape writes.
- Threads in a shape (`G88`) use `G34`, `G35` and, where the optional arc threading is fitted, `G112`/`G113`, each with its lead in `F`.
- Editor support: link the sequence name after `G85`/`G86`/`G87`/`G88` to its definition (go to definition), fold `G81`…`G80`, and add one map item per LAP call. A feed script should report `FA=`, `FB=` and a shape's `E` as feeds it left alone, like the arguments of any other cycle.

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

A long variable list goes on over lines that start with `$` (§3.1): `CALL O1000 V1=0101 V2=0202 …` and then `$ DX1=30 DX2=50`. (Corrected in M8: these notes used to give `&`, which the manual does not use.)

G-code macros (optional) call a macro program through a code of its own: `G171`–`G176` and `G205`–`G214` once, like `CALL`, and `G161`–`G170` after every following move, like `MODIN`. Which program a code runs is part of the machine's setup, not of the program. The program map's call rule stops at `G171` today.

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
| Subprogram call | `CALL O…`, `MODIN O…`, the G-code macros `G161`–`G171` and `G205`–`G214` (§7.1) | Target, or the macro code |
| Stops | `M00`, `M01` | Stop / optional stop |
| End | `M02`, `M30`, `RTS`, `END` (schedule) | End |

A line can be two items at once: `NEND M02` is the jump target `NEND` and the end of the program. The program map shows one item per line, the first rule that matches, and a rule in front of the label rule lists such a line as the end, with the name in its text (`NEND M02`), because the end is the item that must not go missing (G10 M8, as for the Sinumerik `LOOP_END: M30`; a map that shows both needs the outline to allow several items per line). A comment on such a line — `NEND (UNLOAD) M02` — now shows its real text rather than blanks: `displayText()` recovers the unmasked characters of the matched `text` group generally, not only for this rule (`dec/tools`, the M8 re-review's finding).

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
14. **W** `T` word the machine's tool-word format does not describe. (Was "E: other than 4 or 6 digits". Not as planned: 3-digit offsets on machines with 200 or more offsets, `TL=`/`TD=` tool words, and every tool call of a machining-centre program opened with this profile would be flagged. It needs the tool-word machine parameter of §5.1 first.) **W** Mixed 4- and 6-digit `T` words in one file.
15. **E** Unclosed `(` comment in a block. **W** Nested `(`.
16. **E** Two-letter extended address without `=` (`SB1200`).
17. **E** Block longer than 158 characters.
18. **I** The unit system the program was written for. A point never changes a value on this control (§3.3), so a "missing decimal point" warning means nothing here; say which unit system the chosen machine uses instead.
19. **W** First `G01`/`G02`/`G03` after a tool change without an `F` in effect.
20. **W** `G85`/`G86`/`G87` referencing a sequence name that does not exist, or `S`/`T`/`M` in a `G85` block. **W** `G81`/`G82` without a closing `G80`.
21. **W** Fanuc-only constructs in an Okuma file: `G54`–`G59`, `R` on an arc, `G04 P`, `M98 P…` or `M99 P…` (a program or block number after them; the bare `M98`/`M99` are the tailstock codes here), `G92` (not assigned), `#` variables, `U`/`W` used as incremental moves, `;`. This probably means the wrong dialect or post.
22. **I** Local variable name that clashes with a function or operator name, or starts with `O`/`N`/`V`.
23. **I** Non-ASCII characters in comments (parity checks and tape codes).
24. **E** `G140`/`G141` or `G15`/`G16` while `G96` or nose-radius compensation is active.
25. **E** After `G137`: a first block without both X and Y, or `G91` right after it; `G136` with other words in its block.
26. **E** On a Y-axis machine: an axis move before the first `G136` or `G138` (the mode survives a reset).
27. **E** Two turrets: a block with `S`, `M00`/`M01`/`M03`/`M04`/`M05`/`M41`–`M44` or `G96` on one side without a `P` code of the same number on the other side (the two sides must agree on spindle commands).
28. **W** `M100` counts that differ between the sides (the control then goes on **without** waiting, silently); `M100` during nose-radius compensation; a `P` wait on one side met by `M100` on the other (no wait either).

---

## 10. Open questions / verify on real CAM output

1. Do posts write the `$NAME.MIN%` header and a closing `%`? The owner's posts write neither, and no `O` line either (aggregate). Other posts may.
2. ~~Default unit.~~ The unit system decides (§3.3); all of the owner's programs are 1 mm.
3. ~~`T` order.~~ Settled (§5.1); how many offsets each of the owner's lathes has is open. Does `T00xx` cancel?
4. Do current OSP versions (P300L and later) accept `;` comments, `G54`-style offsets, lower case, or packed words?
5. Is a comment allowed on the same line as the `O` name?
6. Do posts use alphanumeric sequence names (for example `NT01`) to mark tool sections? If so, use them as map labels.
7. How common are LAP calls (`G85`/`G87`) in current CAM output compared with long-hand moves?
8. The `$` continuation (§3.1) is settled by the manual (LAP condition changes, `CALL` variable lists, `G71` examples). The owner's posts never write it (aggregate); other posts may.
9. Tapping feed convention in `G77`/`G78` and `G184` (lead vs. feed per minute) as emitted by posts.
10. Line endings and encoding of files saved on the control and on USB.
11. Can a `.SUB` file hold several `O` programs, and how does the control resolve a `CALL O…` across files?
12. Okuma milling (OSP "M") needs its own profile: different G-codes, work offsets and tool change. Sample programs now exist (four of the owner's five Okuma programs, aggregate: `G15 H` at the start, `T… M6` with a pre-select, `G56 H` length offsets, `G41 D`, arcs with `R`, drilling cycles with `R`/`P`/`Q`, `G169`/`G170` around 5-axis moves, five-digit block numbers). What is missing is a programming manual for the machining-centre control.
13. New: on the machining centre, what `G16 H0`, `G71 Z`, `M54`, the `P` of the drilling cycles and `G169`/`G170` do, and whether five-digit `N` is accepted.
14. New: does the owner have a B-axis multi-tasking turning centre (tool words `TL=`/`TD=`, `G127` tilted machining, `G303` 3D frames)?

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

### 11.7a Two-turret synchronization, from the P300 manual (for M12)

- A `P` code is `P` and up to four digits. Execution runs from the smaller number to the larger; equal numbers run together (a rendezvous); when one side has finished, the other goes on. The numbers must ascend in execution order. This is the `ordered` semantics of the channel plan.
- Spindle commands need the same `P` number on both sides (§9 item 27); `M100` is the id-less wait (`count`), with the pitfalls of §9 item 28.
- A second coupling: turret synchronous mode is switched on with `M207` from one side or `M1292` from the other and off with `M206`, and both sides wait. `M200`–`M202` couple the Z feed without being waits.
- On a machine that cuts with the sub-spindle base, `G14` selects the base, not a turret; only `G00`/`G01`/`G94`/`G95` are allowed on that side.

### 11.7 After M8 (G10 review): what the Okuma profile still does not do

Unlike §11.1–§11.6, this is the state of the M8 profile, not of the code before M3.

- **`$` continuation lines are read as part of their block, not joined.** The profile declares the leading marker (`syntax.continuationStart`, plan §7.16 #27), and the modal interpreter and the three bundled scripts read a line that starts with `$` as part of the block above it (§3.1), so the lead on the `$` line of a `G71` block stays a lead. The tokenizer still reads the line on its own, so a code counts from the line it stands on: a thread code written on a `$` line would not cover an `F` on the block's first line. Renumbering leaves such lines alone only because `$` is in `skipStartingWith`, a list the user can edit in the form; with `$` taken out of it, renumbering numbers the line and cuts it off its block (M8 re-review, [TODO.md](../../../TODO.md)). ~~The profile's marker also requires a blank after the `$`, which the manuals do not~~ — **fixed, `dec/int`**: the pattern now tells a continuation line from the `$NAME.MIN%` header by the `%`, not by a blank, so `$H1.8 …` (the manuals' own layout) is read as a continuation and its lead stays a lead.
- **One program-map item per line.** `NEND M02` is listed as the program end, with the name in its text, not as the label `NEND` (§8).
- **The `E` feed of a shape block** is neither scaled nor reported by the feed script: an `E` word can also be a dwell or a lead change, and only being inside a LAP shape tells them apart (§6.4). The feeds of a LAP condition change (`FA=`, `FB=`) are reported and left as written.
- **What a G-code macro's words mean** (§7.1) depends on the machine's setup; the map lists the call and nothing reads its arguments.
- **Sequence names are compared as text** by the renumbering since M8: `N0020` and `N20` are two blocks, and a jump follows the one written exactly like it.
