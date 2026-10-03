# Fanuc-style ISO G-code: syntax notes (CAM-output subset)

Dialect id in gEdit: `fanuc-gcode`. Planning notes; nothing here is implemented yet unless §11 says so.

Sources: Fanuc lathe programming manuals (18i-T and 31i, G-code system B), the control maker's user manuals for the Series 30i/31i/32i Model A (common functions, lathe system and machining-centre system, German editions), and general DIN 66025 / ISO introductions.
Anything marked **(verify)** comes from general knowledge rather than from those sources. Check it against real CAM output or a control manual before hard-coding it. The source review of 2026-09 ([source-review-2026-09.md](../source-review-2026-09.md)) read the Series 30i manuals and settled most of what these notes had marked, milling included; what is still marked is either not in those manuals or decided by a parameter of the machine. The parameter numbers the notes name are those of the Model A manuals.

---

## 1. Scope note

**In scope:** what post-processors write for:

- 3-axis milling on Fanuc M-series (and compatible) controls.
- 2-axis turning on T-series controls, plus simple live-tool drilling (C-axis indexing).

That covers rapid, linear and circular moves; feeds and speeds; tool changes; work offsets; length and radius compensation; the standard canned drilling and tapping cycles; comments; block numbers; block skip; subprogram calls; and simple `#` variables.

**Tokenized but without help text or checks (for now):**

- Macro B control flow: `IF`, `GOTO`, `WHILE`. gEdit highlights and navigates it but does not evaluate it.
- Lathe multi-pass cycles G70–G76. CAM output for lathes may contain them; low priority.
- Direct drawing input: `,C`, `,R`, and `A` for angles.
- Polar and cylindrical interpolation, tilted work plane, 5-axis tool-centre control, high-speed/look-ahead modes.

**Deliberately excluded:**

- Machine-builder specific codes:
  - most M-codes above M09 (loaders, tailstock, doors, sub-spindle, brakes, etc.)
  - G1xx/G2xx macro cycles
  - `#1000+` variables that builders use for their own signals
- Conversational or shop-floor formats. Multi-channel synchronization. Sub-spindle transfer sequences.
- Simulation, backplot and DNC.

> Rule of thumb: the same M-number means different things on different machines. The dialect must treat an unknown M-code as "machine specific", not as an error. Keep builder M-codes in a user-editable machine table (§4.4).

---

## 2. File and program structure

### 2.1 Typical CAM output (own examples)

Milling:

```
%
O1001 (BRACKET OP1)
(T1  D12 FLAT END MILL)
(T5  D6.8 DRILL)
G21 G17 G40 G49 G80 G90 G94
T1 M06 (D12 FLAT END MILL)
T5
S6000 M03
G54
G00 X-20. Y0.
G43 Z25. H01 M08
Z3.
G01 Z-2. F300.
X40. F1200.
G02 X50. Y10. R10.
G00 Z25.
M09
M05
G91 G28 Z0.
G90
M01
T5 M06 (D6.8 DRILL)
...
M30
%
```

Turning (G-code system A):

```
%
O2001 (PIN D30)
G21 G40 G99
G28 U0. W0.
T0101 (OD ROUGH)
G50 S2500
G96 S220 M03
G00 X34. Z2. M08
G71 U1.5 R0.5
G71 P100 Q200 U0.4 W0.1 F0.25
N100 G00 X16.
G01 Z0. F0.1
X20. Z-2.
Z-30.
N200 X34.
G70 P100 Q200
G00 X100. Z100. T0100
M30
%
```

### 2.2 Structural elements

| Element | Form | Notes |
|---|---|---|
| Tape/record marker | `%` alone on a line | First and last line of the file. The control ignores anything before the first `%` (lead-in). A program that runs into the closing `%` without `M02`/`M30` (or `M99` in a subprogram) stops with an alarm. Whether text after the closing `%` is read is **(verify)**. |
| Program number | `O` + digits, e.g. `O1001` | 4 digits, 8 with an option on the 30i family; `O0` is not allowed. `:` is accepted in place of `O`. On the 30i family a program can also be named instead of numbered: `<NAME>` in angle brackets, up to 32 letters, digits and `- + _ .`, and the same bracketed name may follow `M98`, `G65` and `G66` as the call target. `.` and `..` are reserved names. The owner's own lathe output uses this form. gEdit reads `<NAME>` as one `programMarker` token (`syntax.programNames`) wherever the pattern matches, not only where the manual allows one; a name standing somewhere the manual forbids is a linting question (M9), not a tokenizing one. |
| Program title | Comment in the O-block: `O1001 (BRACKET)` | Shown in the control's directory. Length limit **(verify)**. |
| Main program end | `M30` (end + rewind) or `M02` | `M30` also stops the spindle and coolant on typical machines. |
| Subprogram end | `M99` | `M99` in a main program loops back to its start. |
| Several programs in one file | Several `O…` blocks between one pair of `%` | CAM posts that emit subprograms usually append them after the main program's `M30` **(verify)**. |
| Block | One line | End of block (EOB) is LF. CR LF is accepted. The control screen and many printed listings show EOB as `;`, so pasted text can contain `;` at the end of each line **(verify: whether controls accept `;` on input)**. The tokenizers read a `;` that starts no comment as an operator, the end-of-block character, and not as an unknown mark (M9). |
| Block number | `N` + digits, optional | Up to 8 digits on the 30i family; `N0` is not allowed. Numbering is free, need not be ascending, and may be sparse. CAM often numbers every block in steps (e.g. 10) or only the tool-change blocks. Duplicate N numbers are legal, but a search then finds only the first. |

### 2.3 File conventions

- **Extensions:** there is no standard. Common ones are `.nc`, `.tap`, `.cnc`, `.txt`, `.eia`, `.iso`, `.min`, `.ncc` and `.ptp`, plus files without an extension named like the program (`O1001`) **(verify)**. Detection must fall back to content sniffing (see §11).
- **Encoding:** 7-bit ASCII. The control's code table has no lower case and no tab, and a character outside it is dropped on input, comments included; so umlauts, `ø`, `°` and `µ` do not survive. The owner's real programs carry lower-case comments, so what the owner's controls do with them is still **(verify)**. Keep the file's byte content and line endings unchanged on save, and offer an explicit "normalize line endings" command.
- **`%` inside a comment** ends the program on input: the rest of the file is lost at the control.
- **Comment length:** the sources say the control displays about 31 characters of a comment as an operator message. Longer comments are common in CAM output; whether they are truncated or rejected is **(verify)**.

---

## 3. Lexical rules (tokenizer spec)

### 3.1 Block anatomy

```
[/n] [Nnnnn] word word … [(comment)] EOB
word  = address-letter  value
value = number | variable | [expression]
```

- **Word order** is free. The conventional order (DIN 66025) is `N G X Y Z (U V W A B C) I J K F S T (D H) M`.
- **G-codes:** several per block are allowed if they belong to different modal groups. Two from the same group are **not** an alarm: the last one in the block wins. Only a G code the control does not know raises an alarm.
- **Other addresses** normally appear at most once per block. Up to 3 M-codes per block only when a parameter allows it (one M by default); `M00`, `M01`, `M02`, `M30`, `M98`, `M99` and `M198` never share a block with another M code.
- **Whitespace** is optional between words, and even between an address and its value. The sources contain `G0X50Z2`, `G0X 50 Z3` and `N 120 / X…`. The tokenizer must not require spaces, and it should allow `\s*` between the letter and the value.
- **Case:** controls expect upper-case addresses: the code table has no lower case (§2.3). Tokenize case-insensitively and lint lower-case outside comments.
- **Leading zeros** are not significant for codes: `G0` = `G00`, `M3` = `M03`. For lathe T-words the digit grouping matters (see §5).

### 3.2 Numbers

- Pattern: `[+-]?(\d+\.?\d*|\.\d+)`.
  - Valid: `10`, `10.`, `10.5`, `.5`, `-0.5`, `+3`, `F.15`.
  - There is no exponent and no thousands separator.
  - **A comma is not a decimal separator:** `F2,5` is an error.
- **The decimal point changes meaning.** With a point, the value is in mm or inch (seconds for dwell `X`/`U`). Without a point, a control may read the value in least-input increments (0.001 mm). The sources show both behaviours on the same machine: `X50` means 50 mm, but cycle `Q6000` means 6 mm (µm units). So the reading depends on the address and on machine parameters **(verify per machine)**. What the 30i manuals settle:
  - Calculator-type input is one parameter switch for all addresses (with a per-axis variant); the increment system (IS-A 0.01 mm, IS-B, IS-C, and finer) is set per axis; another parameter makes a point-less value ten times the increment.
  - Without calculator-type input, a point-less **feed per revolution** counts in 0.01 mm/rev (0.001 with a parameter), and a feed per minute in 1 mm/min (0.001 with a parameter); an inverse-time `F` (`G93`) counts in 0.001.
  - A value with more than eight digits, counted after conversion to increments, is an alarm.
  - `P` and `Q` of the lathe cycles `G74`–`G76`, `G83` and `G87` never take a point; they count in the least input increment of their axis.
  - CAM posts for Fanuc therefore write a decimal point on every dimension word (`X10.`). A missing point is worth a warning.
- **Integer-only addresses:**
  - `O` and `N`
  - `G`, optionally with one decimal digit (`G54.1`, `G12.1`, `G68.2`)
  - `M` and `T`
  - `H` and `D` (register numbers)
  - `P` when it is a dwell in ms, a program number or a sequence number
  - `L` and `K` when they are repeat counts
  - A decimal point on these is suspicious **(verify for K/L)**.
- **Digit limits:** N up to 5 digits on older controls, 8 on the 30i family. Dimension words at most 8 digits after conversion to increments (see above).

### 3.3 Comments

- `(` … `)` anywhere in a block. No nesting: a comment ends at the first `)`.
- An unclosed `(` runs to end of line. Tokenize it as a comment, but flag it.
- `;` is **not** a comment in this dialect. It marks end of block (see §2.2).
- A comment must not hold `%` or an end of block (§2.3).
- Parentheses are never used for arithmetic. Expressions use `[` `]`.

### 3.4 Block skip

- `/` at the head of a block skips the block when the operator's block-skip switch is on. The sources write it both before a block without N (`/M99 P…`) and directly after the N-word (`N120/G00 …`). Accept both positions.
- Numbered skip levels `/1`…`/9` exist; several levels may mark one block (`/1 /3`). A slash in the middle of a block skips from there to the end of the block.
- Anywhere else, `/` is the division operator inside expressions (`#1=#2/#3`, `X[#1/2]`).

### 3.5 Variables and expressions (Macro B, basic)

- **Variables:** `#` + number (`#1`, `#101`, `#500`, `#3000`). Indirect form: `#[#1+1]`.
- **Assignment** as its own statement: `#101=#102*2.`.
- **Variables as values:** `X#101`, `Z-#102`, `F[#3*0.5]`.
- **Operators:** `+ - * /`.
- **Functions** (settled by the 30i manual): `SIN COS TAN ASIN ACOS ATAN` (also `ATN`), `SQRT` (also `SQR`), `ABS BIN BCD ROUND` (also `RND`), `FIX FUP LN EXP POW ADP`. `ATAN` takes two arguments as `ATAN[a]/[b]` or `ATAN[a,b]`. The tokenizer reads these names today as runs of address letters (`FIX[#2]` becomes an `X` word): a gap the [source review](../source-review-2026-09.md) lists.
- **Comparisons:** `EQ NE GT LT GE LE`. Operators `OR` and `XOR` add, `AND` and `MOD` multiply.
- **Control flow:**
  - `GOTO n`, `IF [cond] GOTO n` and `IF [cond] THEN stmt`.
  - `WHILE [cond] DO m … END m`, with `m` from 1 to 3 only: at most three nested loops, never crossing, and no jump into a loop.
- `#0` (and `#3100`) are always empty. System variables have names too (`[#_NAME]`), and a program can name its own (`SETVN`, then `[#NAME]`). A constant without a point inside brackets counts as if it had one.

### 3.6 Direct drawing input (rare in CAM output)

`,C` (chamfer), `,R` (corner radius) and `A` (line angle, lathes). The comma belongs to the address. Tokenize these, but add no help text or checks for now.

### 3.7 Strings

There are none in the in-scope subset; text appears only in comments. Macro print commands (`POPEN`, `PCLOS`, `DPRNT[…]`, `BPRNT[…]`) and the axis functions `AX[]`/`AXNUM[]` exist and are out of scope; tokenize them as one word each, never as address letters (today they are split into letters, see the [source review](../source-review-2026-09.md)).

### 3.8 Monarch rule order (proposal)

Definitions:

- `NUM = [+-]?(?:\d+\.?\d*|\.\d+)`
- `VAL = \s*(?:NUM)`

Rules, in order:

| # | Regex (ignoreCase) | Token | Remark |
|---|---|---|---|
| 1 | `^\s*%.*$` | `keyword.tape` | Only as the first non-blank character. |
| 2 | `\([^)]*\)` | `comment` | Non-greedy by construction. Never spans `)`. |
| 3 | `\([^)]*$` | `comment.unclosed` | Stateless, so an unclosed comment never leaks into the next line. |
| 4 | `^\s*\/[1-9]?` | `keyword.skip` | Block skip at line start. |
| 5 | `(N\s*\d+)(\s*)(\/[1-9]?)` | `[number.sequence, white, keyword.skip]` | Block skip after the N-word. |
| 6 | `^\s*O\s*\d+` | `keyword.program` | Also `^\s*<[^>]+>` and `^\s*:\d+` (both valid, §2.2). |
| 7 | `(?:IF\|GOTO\|THEN\|WHILE\|DO\|END\|EQ\|NE\|GT\|LT\|GE\|LE\|AND\|OR\|XOR\|MOD)(?![A-Z])` | `keyword.macro` | **Must precede the single-letter address rules** (`GOTO` vs `G`, `DO` vs `D`, `IF` vs `I`). This is safe because a real address is always followed by a digit, sign, `.`, `#` or `[`. |
| 8 | `(?:SIN\|COS\|TAN\|ATAN\|ASIN\|ACOS\|SQRT\|ABS\|ROUND\|FIX\|FUP\|LN\|EXP)(?=\s*\[)` | `keyword.function` | |
| 9 | `N\s*\d+` | `number.sequence` | |
| 10 | `G\s*\d{1,3}(?:\.\d{1,2})?` | `keyword.gcode` | Optional sub-tokens: motion `G0*[0-3](?![\d.])` → `keyword.gcode.motion`. |
| 11 | `M\s*\d{1,3}` | `keyword.mcode` | |
| 12 | `T\s*\d+` | `type.tool` | |
| 13 | `,[ACR]` + `VAL` | `number.drawing` | |
| 14 | `[XYZUVWABC]` + `VAL` | `number.axis` | |
| 15 | `[IJK]` + `VAL` | `number.arc` | |
| 16 | `R` + `VAL` | `number.radius` | |
| 17 | `F` + `VAL` / `S` + `VAL` / `E` + `VAL` | `number.feed` / `number.speed` | |
| 18 | `[HDPQLK]` + `VAL` | `number.param` | |
| 19 | `[A-Z]\s*(?=-?\s*[#\[])` | `number.address` | Address whose value is a variable or expression. |
| 20 | `#\s*\d+` and `#(?=\[)` | `variable` | |
| 21 | `[\[\]]` | `@brackets` | |
| 22 | `[=+\-*/]` | `operator` | |
| 23 | `\d+\.?\d*\|\.\d+` | `number` | Bare unsigned number. Needed for expression operands (`#1=2.`, `[#1+2.]`) and for jump targets (`GOTO10`, `DO1`, `END1`). The sign stays an operator. Optionally, split `GOTO\s*\d+` into `[keyword.macro, number.label]` to support navigation. |
| 24 | `;` | `delimiter.eob` | |
| 25 | `\s+` | `white` | Today whitespace falls through to `invalid` (§11). |
| 26 | (default) | `invalid` | Anything else, e.g. `F2,5`, stray `)`, `$`. |

Notes:

- Monarch tests rules against the rest of the line, so `^` only matches at column 0. Lookbehind is not usable. Rule 5 therefore uses groups instead.
- The tokenizer stays context-free. Profile-dependent meanings are resolved in hover, lint and the program map, not in highlighting. Examples: `H` means "incremental C" on some lathes but "length offset" on mills; `G74` has different meanings on mill and lathe.
- Built-in Monaco themes only colour generic prefixes (`keyword`, `number`, `comment`, `type`, `variable`). To show tools, feeds and axes in different colours, gEdit needs its own theme rules for the token names above.

---

## 4. Codes commonly emitted by CAM

### 4.1 Profiles: the same code means different things

A single `fanuc-gcode` language is not enough for help, lint and the program map. It needs a **profile** setting. The tokenizer stays shared.

| Code / word | Mill (M) | Lathe, G-code system A | Lathe, system B | Lathe, system C |
|---|---|---|---|---|
| G90 / G91 | abs / incr | G90 = OD/ID turning cycle; no G91 | abs / incr | abs / incr |
| U / W / V / H | real axes, if present | incremental X / Z / Y / C (U in diameter) | the manuals switch with `G90`/`G91`; whether `U`/`W` still work as incremental twins depends on the machine: one 18i-T builder's examples use them, two 31i system-B setups refuse them **(verify per machine)** | as B |
| G92 | set the work coordinate system, or with `S` clamp the top spindle speed | thread cutting cycle | coordinate set / max spindle speed (`G92 S…`); preset `G92.1` | as B |
| G50 | scaling cancel (`G51` on) | coordinate set / max spindle speed (`G50 S…`); preset `G50.3` | scaling cancel (`G51` on) | scaling cancel |
| G94 / G95 | feed per min / per rev | G94 = facing cycle | feed per min / per rev | feed per min / per rev |
| G98 / G99 | cycle return: initial level / R level | feed per min / per rev | cycle return: initial / R | as B |
| G77 / G78 / G79 | – | not defined (an alarm) | turning / thread / facing cycle | G20 / G21 / G24 |
| G32 / G33 | G33 thread | G32 thread (one pass) | G33 | G33 |
| G34 | thread with a variable lead | the same | the same | the same |
| G20 / G21 | inch / mm | inch / mm | inch / mm | G70 / G71 |
| G70–G76 | G73 high-speed peck, G74 left-hand tap, G76 fine bore | multi-pass cycles | same as A | renumbered G72–G78 |
| G83 / G87 | peck drill / back bore | face drill / side drill | same | same |
| G93 | inverse-time feed | inverse-time feed (in the feed-mode group with G98/G99) | the same, with G94/G95 | the same |
| H | length-offset register | incremental C | like U/W in system B | as B |
| D | radius-offset register | – (offset comes from the T-word) | – ; offset register on magazine mill-turn machines | – |
| X | position | diameter | diameter | diameter |

The G-code system is chosen by two parameter bits; B and C are options. On a lathe with an automatic tool changer (a parameter says so), `G43`/`G44`/`G49` and the 5-axis codes are available as on a mill.

> DIN 66025-style controls from other vendors use G70/G71 for inch/mm. The Fanuc lathe meaning (finishing cycle / roughing cycle) is different. This is one more reason why content sniffing must not guess between dialects on G70/G71 alone.

Suggested profiles ([dialect-profiles.md](../dialect-profiles.md#built-in-and-user-profiles)): the built-in `fanuc-gcode` profile describes milling and is the default for `.nc` and `.tap`. Turning gets child profiles for G-code systems A, B and C, system A first. Offer the lathe profile automatically when the content looks like turning (§11.5).

### 4.2 G-codes by logical group

Use gEdit's own group names. Fanuc's numeric group ids differ between the mill and lathe manuals.

| Group | Codes | Meaning (own wording) | Typical CAM parameters / notes |
|---|---|---|---|
| motion | `G00` | Rapid positioning. Axes may arrive at different times (not interpolated). | End point |
| motion | `G01` | Straight feed move | End point, `F` (needs an active feed) |
| motion | `G02` / `G03` | Arc clockwise / counter-clockwise | End point plus either `R` or centre `I J K`. The centre is incremental from the arc start. The plane decides the pair: G17 → I J, G18 → I K, G19 → J K. `R` cannot describe a full circle. A negative R selects the >180° arc **(verify)**. Adding the third axis gives a helix **(verify)**. |
| motion | `G32` (A) / `G33` (B, C) | Single thread-cutting pass (lathe) | End point, `F` = lead |
| non-modal | `G04` | Dwell | Seconds with a decimal point via `X` or `U`. `P` is a whole number counted in the least input increment (milliseconds on the usual increment system); a parameter can make the dwell count spindle revolutions under feed per revolution. |
| non-modal | `G09` | Exact stop for one block | |
| non-modal | `G10` | Write offsets/data from the program | `G10 L2 P1 X… Y… Z…` (and `L20`) sets a work offset; on a lathe `G10 P… X… Z…` writes a tool offset. Its axis words are **data**, not a move: no extent, no shift, no scaling may touch them (`CodeEntry.wordsAreData`, in the database now; scale feed/speed leave and report them). The owner's multi-path lathe programs contain it. |
| non-modal | `G28` | Return to reference point via an intermediate point | Lathe: `G28 U0. W0.`. Mill idiom: `G91 G28 Z0.` then `G90` **(verify)**. |
| non-modal | `G30` | Return to 2nd reference point **(verify)** | |
| non-modal | `G53` | Move in machine coordinates, this block only | Absolute values only. Often used before tool changes. |
| non-modal | `G52` | Local coordinate shift | Rare |
| non-modal | `G92` / `G50` | Set coordinate system; on lathes also the maximum spindle speed with `S` (A: G50, B/C: G92) | Put `G50 S…`/`G92 S…` in its own block before `G96` (source advice). |
| non-modal | `G65` | Macro call with arguments | `P` program, `L` repeats, every other letter an argument (§7.1), **data** rather than a move or a feed (`CodeEntry.wordsAreData`, in the database now, `G66`/`G66.1` too). Another NC word in the same block is an alarm. |
| plane | `G17` / `G18` / `G19` | XY / ZX / YZ plane | Lathes default to G18. Mills default to G17 **(verify defaults are parameter dependent)**. |
| units | `G20` / `G21` | inch / mm | Should come before any dimension word. At power-on the last used state is kept. |
| distance | `G90` / `G91` | absolute / incremental | Mill and lathe B/C only |
| feed mode | `G94` / `G95` | per minute / per revolution | Lathe A uses `G98`/`G99` instead. `G93` inverse time: its `F` is not modal, every block needs its own. |
| spindle mode | `G96` / `G97` | constant surface speed / fixed rpm | `S` = m/min (ft/min) or rpm |
| cutter comp | `G40` / `G41` / `G42` | Cancel / tool left / tool right of the path | Mill: register `D`. Lathe: nose radius and tip direction from the T offset. Switch on during an approach move and off during a retract move. Do not repeat G41/G42 while it is already active (source advice). |
| length comp | `G43` / `G44` / `G49` | Length offset + / − / cancel | `G43 Z… H…`. CAM normally uses H = tool number. |
| work offset | `G54`…`G59` | Work coordinate systems 1–6 | Extended: `G54.1 P1…P48` (optionally up to P300) or `G54 P1`; on the lathe as well, as an option |
| canned cycle | `G80`, `G73`–`G89` | See §6 | Any code from the motion group cancels an active drilling cycle (sources). |
| cycle return | `G98` / `G99` | Return to initial level / to R level | Mill and lathe B/C |
| macro modal | `G66` / `G67` | Modal macro call / cancel | Rare in CAM |
| other, may appear | `G61`/`G62`/`G63`/`G64` (one modal group: exact stop, corner override, **tapping mode**, cutting mode), `G05.1 Q1` (look-ahead contour control), `G08 P1`, `G68`/`G69` (rotation), `G68.2`/`G68.3`/`G68.4` + `G53.1` … `G69` (tilted working plane; the lathe ends it with `G69.1`), `G43.4`/`G43.5` (tool-centre control), `G15`/`G16` (polar coordinates, mill), `G50.1`/`G51.1` (mirror), `G84.2`/`G84.3` (rigid tapping in an older block format, `L` repeats), `G66`/`G66.1`/`G67` | Settled by the 30i manuals. The owner's mill output writes the tilted-plane pair. `G61`/`G62`/`G64`, `G65`/`G66`/`G67`, `G10`, `G84.2` and `G84.3` are in the mill database now (`dec/scaling`); `G05.1`, `G68`, `G68.2`–`G68.4`, `G53.1`, `G43.4`/`G43.5`, `G50.1`/`G51.1`, `G51`, `G52` and `G69`/`G69.1` are in the database now (M9, WP9.2). Fanuc `G15`/`G16` are polar coordinates; Okuma's `G15`/`G16` are program coordinate systems (`G15 H…`), a different meaning. `G08` and `G61.1` are not in the database ([source review](../source-review-2026-09.md), proposal R3). In `G63` blocks `F` is tied to the pitch: `G63` is a modal code of the path-mode group (`G61`/`G62`/`G63`/`G64`, "valid until" per the manual), and gEdit reads the feed as a lead while it is the active code of that group — the one `pitchFeed` code that sits outside a cycle or motion group. `G84.2`/`G84.3` are the FS15-format rigid taps (mill; the lathe has `G84.2` only). |
| lathe live tool | `G12.1`/`G13.1` (also written `G112`/`G113`), `G07.1` (also `G107`) | Polar interpolation X–C on/off (while it is on, `C` is a length in mm and arcs use I/J); cylindrical interpolation Z–C (`C` stays an angle) | The owner's lathe output uses polar interpolation. Out of scope beyond hover text, but extents and address arithmetic must not read `C` as an angle inside it. |

### 4.3 M-codes (portable subset)

| Code | Meaning | Notes |
|---|---|---|
| `M00` | Program stop | Operator presses cycle start to continue. |
| `M01` | Optional stop | Only when the optional-stop switch is on. |
| `M02` | Program end | |
| `M03` / `M04` / `M05` | Spindle CW / CCW / stop | `S` usually in the same or the previous block |
| `M06` | Tool change (magazine machines) | Not used on turret lathes |
| `M07` | Second coolant (mist or high pressure) | Machine dependent |
| `M08` / `M09` | Coolant on / off | |
| `M19` | Spindle orientation | Common, but machine dependent |
| `M29` | Rigid-tapping mode before `G84` | The number is set by a parameter (another parameter can make every `G84` rigid). `M29 S…` goes in the block before `G84` or in the same block; an `S` or an axis move between `M29` and `G84`, or `M29` inside the cycle, is an alarm. The source machine used a different M-number, so make it configurable. |
| `M30` | Program end and rewind | |
| `M98` | Subprogram call | §7 |
| `M99` | Subprogram end / return / loop | §7 |

Everything else comes from a per-machine M-code table: user-editable JSON with code → short text. Unknown M-codes are shown as "machine specific", not as errors.

### 4.4 Other addresses

| Address | Meaning (mill / lathe) |
|---|---|
| `X Y Z` | Target position. On lathes X is a diameter. |
| `U V W` | Lathe: incremental X / Y / Z (U in diameter). Mill: extra linear axes. Inside lathe cycles: depth/allowance. With `G04`: dwell time. |
| `A B C` | Rotary axes. Lathe C = spindle angle for live tooling. |
| `I J K` | Arc centre (incremental). `K` is also a repeat count in drilling cycles. |
| `R` | Arc radius; R-plane in drilling cycles; retract/allowance in lathe cycles |
| `F` | Feed (mm/min or mm/rev); lead in threading |
| `E` | Lathe: the inch-thread form of a thread (instead of a lead in `F`); refused by the thread cycles `G92` and `G76`. The database entry keeps its old "fine lead" wording marked for verification until it is rewritten. |
| `S` | Spindle speed or surface speed; clamp value with G50/G92 |
| `T` | Tool (§5) |
| `H` / `D` | Offset registers (mill). Lathe `H` = incremental C in G-code system A (and `V` incremental Y). |
| `P` | Dwell (ms), program number (M98/G65), sequence number (M99, G70–G73), packed thread data (G76) |
| `Q` | Peck depth, shift amount, profile end (G70–G73), start block (M98 Q) |
| `L` | Repeat count (`M98`, `G65`, `G84.2`) |

### 4.5 Modal vs non-modal

- **Modal G-codes** stay active until another code from the same group replaces them.
- **Non-modal (one-shot) G-codes:** G04, G09, G10, G28, G30, G31, G52, G53, G65, G92/G50 (setting), and the lathe cycles G70–G76.
- **Words:**
  - `F` and `S` are modal.
  - T, H and D selections stay active until changed.
  - Axis values persist.
  - While a drilling cycle is active, its data (`Z R P F`) stays active. On the source lathe controls `Q` must be repeated in every cycle block. On mills it is normally modal **(verify)**.
- **Power-on defaults** depend on parameters. CAM headers usually contain a "safe start" line (`G21 G17 G40 G49 G80 G90 G94`). A modal-state tracker in gEdit should report "unknown" until a group is explicitly set, rather than assume defaults.

---

## 5. Tool change and offsets

### 5.1 Mill and magazine machines (including mill-turn with tool spindle)

- A **tool change** is a block containing `M06`/`M6`. The new tool is the `T` in that block, or else the last `T` programmed before it. Accept every spelling: `T1 M06`, `M06 T1`, `M6T1`, `N40 T1 M6`, and `T1` followed by `M06` on its own line.
- A `T` without `M06` is a **pre-selection**: the next tool is staged in the magazine. CAM usually writes it right after the change (`T5 M06` … `T6`). It is **not** a tool change in the program map. It can be shown as "next: T6".
- **Offsets:**
  - `H` = length register (with G43). CAM normally writes H = T.
  - `D` = radius register (with G41/G42).
  - Magazine-type mill-turn machines select the offset with a separate `D` word after `M6 T…`.
- Some machines run the tool change as a macro (`M06` mapped to a program, or `G65 P9xxx T…`) **(verify)**. Make the detection pattern configurable per profile.

### 5.2 Turret lathes

- **Any `T` word** is a tool change. No `M06` is needed, and the `T` can share a block with motion (`T0303 G00 X100. Z4.`).
- **T-word formats:**

  | Form | Meaning |
  |---|---|
  | 5 digits, `Tttooo`\* | `ttt` = turret station (3 digits), `oo` = offset register (2 digits). `T12345` = tool 123 with offset 45. |
  | 3–4 digits, `Tttoo` | `tt` = turret station, `oo` = offset register. `T0101` = `T101` = tool 1 with offset 1. `T121` = tool 1 with offset 21. |
  | 1–2 digits (`T1`, `T12`) | Station only. The offset is assigned implicitly by machine setting. |

  How many of the last digits are the offset is a parameter of the control (1, 2 or 3 digits, or chosen by the number of offsets), and a `T` word may have up to 8 digits. So the split above is the usual setting, not a rule: whether a **short** (1–2-digit) word ever carries an implicit offset on the owner's machines is still open (D49). \*The owner decided the five-digit case on 2026-09-27: three digits of station, two of offset, extending the same 2-and-2 / 1-and-2 pattern by one digit (`dec/tools`). A sixth digit and beyond fits no form and is left as it is.

- **Offset cancel:** `T0100`/`T100` (same station, offset 00) cancels the offset. It is **not** a new tool. `T0`/`T0000` **(verify)**.
- A tool's offset number may differ from its station, e.g. a second offset for the same insert (`T0111`). Treat `tt` as the tool identity and `oo` as information only.

### 5.3 Program-map label for a tool

Use the first match of:

1. A comment in the tool-change block.
2. Comment-only lines directly after it (before the first motion block).
3. Comment-only lines directly before it.

Many CAM posts also print a tool list as comment lines in the header (`(T1 D12 FLAT END MILL)`). This list can be parsed to label tools that have no inline comment.

Tool numbers are numeric only. Tool names exist only in comments. Ranges: lathe stations 1–2 digits; mill T up to 4 digits or more **(verify)**.

---

## 6. Cycles relevant to CAM output

### 6.1 Mill drilling and tapping cycles (settled by the 30i machining-centre manual)

Common words:

- `X Y` = hole position. Every following block with X/Y drills another hole while the cycle is active.
- `Z` = hole bottom. `R` = R-plane (rapid down to it, feed from it).
- `F` = feed. `K` = repeat count (up to 9999), used with G91 increments; the older-format rigid tap `G84.2`/`G84.3` counts with `L`.
- `G98` returns to the initial level, `G99` to the R-plane. `G80` cancels.

| Code | Motion (own wording) | Extra words |
|---|---|---|
| `G81` | Feed to Z, rapid out | – |
| `G82` | Feed to Z, dwell, rapid out | `P` dwell ms |
| `G83` | Peck drilling, full retract to R after each peck | `Q` peck depth |
| `G73` | Peck drilling with short chip-break retract | `Q` |
| `G84` | Right-hand tapping; spindle reverses at the bottom | `F` = pitch × S (G94) or = pitch (G95). Rigid tapping: `M29 S…` beforehand (§4.3). `P` dwell; `Q` peck depth for peck tapping. |
| `G84.2` / `G84.3` | Rigid tapping right / left hand in the older block format | `X Y Z R P F L`, `L` repeats; `F` as G84 |
| `G74` | Left-hand tapping | as G84 |
| `G85` | Bore: feed in, feed out | – |
| `G86` | Bore: feed in, spindle stop, rapid out | – |
| `G89` | Bore: feed in, dwell, feed out | `P` |
| `G76` | Fine bore: orient spindle, shift off the wall, rapid out | `Q` shift, `P` dwell |
| `G87` | Back boring | `Q` shift, `P` dwell |
| `G88` | Bore, dwell, manual retract | `P`; rare |

Every cycle of this table takes `K` as the repeat count.
| `G80` | Cancel cycle | – |

Typical CAM pattern (own example):

```
G00 X10. Y10.
G43 Z25. H05 M08
G99 G83 X10. Y10. Z-18. R2. Q3. F150.
X30.
X50. Y25.
G80
```

### 6.2 Lathe drilling cycles (live tooling or stationary tool on centre)

The position is set by a `G00` block before the cycle: X/Z (and C) for face holes, Z/C for side holes. With C indexing, the next hole is simply a new `C` word (or incremental `H` plus a `K` repeat).

| Code | Motion | Words |
|---|---|---|
| `G83` | Drilling along Z (face); pecks when `Q` is given | `Z` bottom, `R`, `Q` peck (in µm without a decimal point on the source controls), `P` dwell ms, `F`, `K` repeats |
| `G84` | Tapping along Z | `Z`, `R`, `P`, `F` (lead), `K`; `Q` for peck tapping |
| `G84.2` | Rigid tapping in the older block format | as G84 |
| `G85` | Boring along Z | `Z`, `R`, `P`, `F`, `K` |
| `G87` | Drilling along X (side) | `X` bottom (diameter), `R`, `Q`, `P`, `F`, `K` |
| `G88` | Tapping along X | `X`, `R`, `P`, `F` (lead), `K` |
| `G89` | Boring along X | `X`, `R`, `P`, `F`, `K` |
| `G80` | Cancel | – |

All of them take the position of the hole in the cross axis and `C` (or `H` incremental) as well, and an `M` word that names the C-axis clamp code. `R` is the distance from the initial level to the R point, written incrementally; `Q` never takes a decimal point. The database gives `G84`, `G85`, `G88` and `G89` only some of these words so far ([TODO](../../../TODO.md)).

On newer controls the cycle axes follow the selected plane. Keep drilling in G18, as in the source recommendation. The rigid-tapping M-code is machine specific.

### 6.3 Lathe single cycles (some posts use them for threading)

| A | B | Purpose | Words |
|---|---|---|---|
| `G90` | `G77` | OD/ID turning pass | `X Z F`, `R` taper (system C: `G20`) |
| `G92` | `G78` | Threading pass | `X Z F` (lead), `R` taper (system C: `G21`) |
| `G94` | `G79` | Facing pass | `X Z F`, `R` taper (system C: `G24`) |

These are modal until another motion-group code.

### 6.4 Lathe multi-pass cycles (may appear in CAM output; low priority)

All use a **two-block format**. `P`/`Q` in the second block name the **N numbers** of the first and last profile blocks. The profile lies between them in the same program.

| Code | Purpose | Block 1 | Block 2 |
|---|---|---|---|
| `G71` | Rough along Z (OD/ID) | `U` depth per pass (radius), `R` retract | `P Q` profile, `U` X allowance (diameter; sign = OD/ID), `W` Z allowance, `F` rough feed |
| `G72` | Rough along X (facing) | `W` depth per pass, `R` retract | as G71 |
| `G73` | Repeat the profile, for pre-shaped blanks | `U W` total stock to remove, `R` number of passes | as G71 |
| `G70` | Finish along profile `P`…`Q` | – | `P Q`. Uses the F/S written inside the profile blocks. |
| `G74` | Face peck drilling or face grooving | `R` retract | `X Z`, `P` X step (µm), `Q` Z peck (µm), `F` |
| `G75` | OD grooving | `R` retract | `X Z`, `P` X peck (µm), `Q` Z step (µm), `F` |
| `G76` | Multi-pass threading | `P` packed 6 digits (finish passes, pull-out chamfer, insert angle), `Q` minimum cut depth (µm), `R` finish allowance | `X Z` thread end at the root, `R` taper, `P` thread height (µm), `Q` first cut depth (µm), `F` lead |

Own example: `G76 P020060 Q80 R0.03` / `G76 X16.93 Z-22. P920 Q250 F1.5`.

- Older controls use a one-block format (`G71 P Q U W D F`) **(verify)**.
- G-code system C shifts these to G72–G78.
- The second `G71`/`G72` block may also carry `S` and `T`. The first profile block (`N` of `P`) must contain `G00` or `G01`.
- The sources say subprogram calls are not allowed between P and Q.

---

## 7. Subprograms, labels, variables

### 7.1 Programs and calls

| Construct | Form | Notes |
|---|---|---|
| Subprogram | `O2000` … `M99` | Same file (after the main M30) or separate file |
| Call | `M98 P2000` | |
| Call with repeats | `M98 P52000` | Digits before the last four = count, so 5 × O2000. This packed form works only for 4-digit program numbers and never together with `L`; a 5- to 8-digit program is called as `M98 P12345 L5`. |
| Call by name | `M98 <NAME>`, `M98 <NAME> L5`, `G65 <NAME>` | 30i family; the name as in §2.2. The manual also allows a bracketed name after `G66`, `G66.1`, `M96`, `G72.1` and `G72.2`; gEdit tokenizes all of them as one name, but the program map lists only the `M98`/`G65` forms as calls (dec/names) |
| External call | `M198 P…` | Runs a program from an external device or data server |
| Local call | `M98 Q<n>` | Runs blocks from `N<n>` up to the next `M99` within the current program. Available on the source controls; general availability **(verify)**. With a `P` as well (`M98 P… Q…`), a parameter makes the call start at block `Q` of the **called** program. |
| Return to label | `M99 P<n>` | Returns to `N<n>` of the caller instead of the next block |
| Loop | `M99` in the main program | Restarts the main program |
| Macro call | `G65 P9010 A1. B2.` | Every letter but G, L, N, O and P is an argument: A #1, B #2, C #3, I #4, J #5, K #6, D #7, E #8, F #9, H #11, M #13, Q #17, R #18, S #19, T #20, U #21, V #22, W #23, X #24, Y #25, Z #26 (a second form repeats I/J/K up to ten times). An argument without a decimal point is read in the least input increment of its address, the classic probing mistake. `G66`/`G66.1`/`G67` modal. |
| Nesting | 4 levels on the source controls | 30i family: subprograms 10 levels, macros 5, 15 in total |

Program numbers 8000–8999 and 9000–9999 can be write-protected by a parameter. Machine builders often keep their macros there **(verify)**. In gEdit this is information only.

### 7.2 Labels

The only labels are `N` numbers. The following point at them:

- `M99 P<n>`
- `M98 Q<n>`
- `GOTO <n>` / `IF […] GOTO <n>`
- `G70`–`G73` `P<n>` / `Q<n>`

Useful editor features:

- Go to definition: jump from the reference to `N<n>`.
- Find references for an N number and for an O number (`M98 P`, `G65 P`).
- **Renumbering must rewrite all these references.** Otherwise renumbering breaks the program.

### 7.3 Variables

| Range | Kind | Notes |
|---|---|---|
| `#0` | Always empty ("null") | `#3100` too |
| `#1`–`#33` | Local (macro arguments) | Cleared per call |
| `#100`–`#199` | Common, lost at power-off/reset | The sources show `#100`–`#149` standard, up to `#199` as an option. |
| `#500`–`#999` | Common, retained | The sources show `#500`–`#531` standard, up to `#999` as an option. |
| `#1000`+ | System variables (I/O, offsets, positions, alarms) | `#3000=n (TEXT)` raises an alarm with a message; `#3006` stops with a message; `#3901`/`#3902` are the part counters; positions from `#5001` on. |

For the editor: highlight variables, show the kind of the range on hover, and list assignments/uses of the same variable (simple text search). No evaluation.

---

## 8. Program-map / outline hints

| Item | Detection | Label |
|---|---|---|
| Program start | `O\d+` at block start (first one) | `O1001` + comment |
| Subprogram definition | Any further `O\d+` block | "Sub O2000" + comment |
| Tool change | §5 rules, per profile | `T5` + label (§5.3). Optional: first `S`/`F` of that tool. |
| Operation | Comment-only line between tool changes | Comment text. Nest it under the current tool. |
| Work offset change | `G54`–`G59`, `G54.1 P…` differing from the previous one | `G55` |
| Units/plane change | `G20`/`G21`, `G17`–`G19` after the header | Warning icon when it changes mid-program |
| Subprogram / macro call | `M98 P…`, `M98 Q…`, `G65 P…` | "Call O2000 ×5". Click jumps to the target if it is in the file. |
| Program stop | `M00`, `M01` | "Stop" / "Optional stop" |
| Lathe rough/finish | `G71`/`G72`/`G73`/`G70` (second block) | "Rough P100–Q200", linked to the profile range |
| Drilling cycle | First block with `G73`–`G89` | "G83 Z-18. Q3." (optional, as a child of the tool) |
| Program end | `M30`/`M02`/`M99` | "End" |
| Block-skip region | Consecutive lines starting with `/` | Optional marker, foldable |

Always strip comments before matching codes, so that `(T1 …)` inside a comment never counts as a tool change.

Folding ranges fall out of the same data: per program (O…M30/M99), per tool, and per G71–G73 profile.

---

## 9. Validation and lint ideas (cheap, line-based)

| Severity | Check |
|---|---|
| error | Unclosed `(`, or `)` without `(`. Unbalanced `[ ]`. |
| error | Comma used as a decimal separator (`F2,5`). Characters that are not valid outside comments. A bare number outside an expression or jump target (e.g. `X10 5`). |
| warning | Two G-codes of the same group in one block: not an alarm, the last one wins, which is rarely what the programmer meant. The same address twice in one block (except G/M). |
| error | `%` inside a comment (it ends the program on input). A program that reaches `%` or the end of the file without `M02`/`M30` (main) or `M99` (subprogram). A word with more than eight digits after conversion to increments. |
| error | `G65` sharing its block with another NC word. `DO`/`END` numbers outside 1–3, unmatched or crossing. An `S` or an axis move between `M29` and `G84`, or `M29` inside the cycle. A `G70`–`G73` first profile block without `G00`/`G01`. |
| warning | 5-axis modal state: `G68.2` while length or radius compensation or a `G68` rotation is on; `G53.1` not directly after `G68.2`, or not alone; `G43.4`/`G43.5` under radius compensation, a canned cycle, `G96`, or any feed mode but `G94`; `G53` inside tool-centre control; a lathe tilted plane ended with `G69` instead of `G69.1`. |
| error | `G02`/`G03` without `R` and without I/J/K. Both `R` and I/J/K given. Arc centre words that do not match the plane (e.g. `K` without `I`/`J` in G17). |
| error | G70–G73 `P`/`Q`, `M99 P`, `M98 Q` or `GOTO` pointing to an N number that does not exist. `P` after `Q` in file order. `M98` inside a P…Q profile. |
| error | `WHILE … DO m` without a matching `END m`. |
| warning | No `%` at start/end, or only one of them. No `M30`/`M02` in the main program. Code after `M30` that is not a new `O` block (unreachable). |
| warning | First `G01`/`G02`/`G03` without an active `F`. Cutting move while the spindle was never started (`M03`/`M04`) or with no `S` set. |
| warning | Dimension word without a decimal point (`X10`), because it may be read as 0.010 mm (§3.2). Decimal point on `N/O/M/T/H/D/P`. |
| warning | `G41`/`G42` switched on in an arc block **(verify: control alarm)**. Mill `G41`/`G42` without `D`. Compensation still active at a tool change or program end. |
| warning | Mill `G43` without `H`. `H` ≠ current tool number (as info, since CAM normally matches them). Tool change while a drilling cycle is still active (missing `G80`). |
| warning | Drilling cycle block without `Z` or `R`. `G83`/`G73` without `Q`. On the lathe profile, `Q` missing in a repeated cycle block. |
| warning | Missing `G20`/`G21` in the header, or a unit change mid-program. No work offset before the first move. |
| warning | Profile mismatch hints, e.g. lathe-A file containing `G94`/`G95` together with `G98`/`G99`, or `G90` used as absolute. |
| info | Duplicate N numbers (a warning when a `GOTO` targets one). N numbers not ascending. N above the digit limit. More than one M code in a block (a warning when one of them is `M00`/`M01`/`M02`/`M30`/`M98`/`M99`/`M198`; quiet by default, because the owner's lathe posts write two M codes per block and a parameter allows it). |
| info | Unknown G/M codes (not in the dialect list or the machine M-table). |
| info | Lower-case letters outside comments. Non-ASCII characters and characters outside the control's code table, comments included (they are dropped on input; the severity waits for the owner's answer on lower-case comments). Comment longer than the configured display length (default 31). |
| info | Feed plausibility by mode: `F` > 20 in G95 (probably mm/min), `F` < 1 in G94 on mill (probably mm/rev). Configurable thresholds. |
| info | `G84` feed ≠ pitch × S (only when a pitch can be read from the tool comment; optional) **(verify)** |

All checks should work on a per-line parse with a small modal-state tracker. None needs geometry.

---

## 10. Open questions / verify on real CAM output

1. Which extensions and file names do the users' posts produce, and are there files without `%`?
2. Do the posts write `;` at block ends? Any leading/trailing NUL or blank lines?
3. ~~Program number format.~~ Settled: 4 digits, 8 with an option, and `<NAME>` programs on the 30i family; one of the owner's lathe programs starts with a `<NAME>` (§2.2).
4. Where do the posts put the tool description: tool-change line, the line after, a header tool list, or all three? Same question for operation comments.
5. Mill posts: is `T` pre-selection (`T5` after `T1 M06`) always emitted? Tool change via a macro instead of `M06`?
6. Lathe posts: G-code system A or B? `T0101` or `T1`? Is `G50 S…` / `G92 S…` in its own block?
7. Are the lathe multi-pass cycles (G71/G70/G76) used, or are all moves expanded as G01?
8. Drilling: is `Q` written with a decimal point (mm) or as an integer (µm)? `K` or `L` for repeats?
9. Rigid tapping: which M-code does each machine use? (Where it goes is settled: before `G84` or in its block, §4.3.)
10. ~~Are the high-speed and 5-axis codes present?~~ Yes: the owner's mill output writes `G68.2` with `G53.1`, and the owner's lathe output polar interpolation (aggregate).
11. Maximum comment length that survives at the control; what the owner's controls do with lower-case comments, which the code table does not have (§2.3).
12. ~~Block skip levels.~~ Settled: `/1`–`/9`, several per block (§3.4). Which levels the owner's posts use is open.
13. Is `U`/`W` still incremental in system B on the target machines? Machine dependent (§4.1).
14. ~~Does any post emit Macro B?~~ Yes: the owner's lathe programs carry `#` variables and `G10` (aggregate).

---

## 11. Gaps in the current gEdit implementation

Based on `src/lib/languages/fanuc.ts`, `src/lib/utils/gcodeParser.ts`, `src/lib/utils/detectLanguage.ts`, `src/lib/utils/dialects.ts`, `src/lib/monaco/setup.ts` and `src/lib/data/blocks/fanuc-gcode.json`.

### 11.1 Tokenizer (`fanuc.ts`)

`defaultToken: 'invalid'` combined with the narrow rules means that many valid words fall through to `invalid`. I checked each case by replaying the rules on sample lines.

| Input | Result today |
|---|---|
| `X10.` / `Y-5.` (trailing decimal point, standard in Fanuc posts) | Splits into `X10` + `.` invalid. The rule `\d*\.?\d+` needs a digit after the point. |
| `F.15`, `F150.0`, `S1200.` | `[SFT]\d+` has no decimal part. `F.15` is entirely invalid. `F150.0` → `F150` + `.0` invalid. |
| `G54.1`, `G12.1`, `G68.2` | Decimal G-codes → `G54` + `.1` invalid. |
| `P`, `Q`, `H`, `D`, `L`, `U`, `W`, `V`, `E`, `K` addresses | No rule, so letter and digits are invalid: `G83 … Q2. P500`, `G43 … H01`, `G28 U0. W0.`, `M98 P1000`. |
| `(A) X10 (B)` | `\(.*\)` is greedy: the whole line becomes a comment, including `X10`. |
| Unclosed `(` | Not a comment at all → invalid. |
| `/` block skip | Invalid. |
| `#101=#102+1`, `X[#1+2.]`, `IF`/`GOTO`/`WHILE`, `SIN[…]` | Only `#\d+` is recognized. `=`, `+`, `[ ]` and all keywords are invalid. |
| `;` EOB, `,C`/`,R` | Invalid. (`;` is read as an operator by the tokenizers, so it is not an unknown mark; M9.) |
| `:` + digits | Tokenized as a sequence number. In ISO it is a program number (settled, §2.2). |
| Whitespace | Falls through to `invalid` (harmless visually, but noisy for later semantic features). |
| Token classes | `T`, `S` and `F` share `number.hex`. There is no custom theme, so tools/feeds/axes cannot be coloured separately. |

### 11.2 Language configuration (`setup.ts`)

- `setLanguageConfiguration` is never called for `fanuc-gcode`. As a result:
  - no toggle-comment (block comment `(` `)`)
  - no bracket pairs or auto-closing for `(` and `[`
  - no `wordPattern` (so double-click selects `X10.` badly)
- No hover provider (context help), no folding provider, no diagnostics (markers), no document symbols (Monaco's outline/breadcrumbs could reuse the program-map data).

### 11.3 Completions (`fanuc.ts`)

- Only G81–G85, as snippets. Missing:
  - G73, G74, G76, G86–G89, G80, G98/G99
  - motion, work offsets, compensation, M-codes
- No profile awareness: lathe G83/G87/G74 semantics differ (§4.1).
- Completions are offered inside comments too.
- The documentation strings are German while the rest of the app/docs are English. Decide on a UI language / i18n approach.

### 11.4 Program map (`gcodeParser.ts`)

- The tool regex `(?:\bM0?6\s+T\d+\b)|(?:\bT\d+\s+M0?6\b)` requires whitespace and word boundaries. Tested:
  - **misses** `T1M6`, `N10T1M06`, `M06T1` (compact output), `T1 G43 M6` (words in between), `T1` / `M06` on separate lines, and every lathe tool change (`T0101`, no M06)
  - **matches** `T1 M6`, `M6 T1`, `N10 T1 M06`
- Pre-selection (`T6` alone on mills) and lathe offset cancel (`T0100`) are not distinguished (§5).
- Comments are detected only when the whole line is a single comment. Missed: `N10 (ROUGHING)`, `/(…)`, `(A)(B)`, and the comment on a tool-change line used as its label.
- Item types are only `tool` and `comment`. Missing (§8):
  - program number/name
  - subprogram definitions (further `O` blocks)
  - `M98`/`G65` calls
  - work-offset changes
  - `M00`/`M01` stops
  - program end
  - G70–G73 profiles
- Code inside comments is not stripped before matching, so `(… T1 M6 …)` would be taken as a tool change.
- There is no mill/lathe profile input.

### 11.5 Detection and dialect config (`detectLanguage.ts`, `dialects.ts`)

- One `fanuc-gcode` dialect with no profile (mill / lathe-A / lathe-B / lathe-C) and no machine M-code table.
- Only `.nc` and `.min` map to Fanuc. `.tap`, `.cnc`, `.eia`, `.iso`, `.ncc`, `.ptp` and extension-less `O1234` files fall back to sniffing **(verify list)**.
- `FANUC_STRONG` allows `O` with at most 5 digits and treats `:` as a program number **(verify)**. `<NAME>` programs are now recognized by the tokenizer, the program map and renumbering (`syntax.programNames`, dec/names); detection still has no content pattern for `^\s*<[A-Za-z0-9+\-_.]+>`, so a named program is detected through its other lines only.
- No mill-vs-lathe sniffing. Possible signals:
  - lathe: `G96` with `G50 S`/`G92 S`, 3–4-digit `T` without `M06`, `U`/`W` words, `G71`/`G70 P Q`, X–Z moves only
  - mill: `M06`, `G43 H`, `G17`, Y words

### 11.6 Code blocks (`fanuc-gcode.json`)

- Header block: `"% \nO1000 (NEW PRG) \n"` has trailing spaces after `%` and after the O-line (whether harmless is **(verify)**). It has no safe-start line (`G17 G40 G49 G80 G94`).
- There is no program-end block (`M30` + `%`).
- The drilling block has no `G98`/`G99` and no closing `G80`. It also has no `G43`/`M08`, so inserting it as-is leaves the cycle active.
- There are no lathe blocks (e.g. `G50 S` + `G96` start, `G71`/`G70` template, threading).
