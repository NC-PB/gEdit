# Siemens Sinumerik 840D sl: syntax notes (CAM-output subset)

The dialect id in gEdit is `sinumerik` (`src/lib/data/profiles/sinumerik.json`, database `src/lib/data/codes/sinumerik.json`). These are planning notes; what shipped is in those two files. Sections 1–10 describe the control, §11 is a record of the editor before Phase 1.

Sources:

- The control maker's NC programming manual for the 840D sl, software 4.92, edition 06/2019 (German). It settles most of what the first version of these notes had to leave open; the tag below cites its section and page. The notes say what it says in their own words and quote nothing.
- An 840D sl programming manual from a machine builder (German). Most of it covers the builder's own cycles, which are out of scope. Only general control syntax that is visible in its examples was used.
- General DIN 66025 introductions (German).
- Added by the source review of 2026-09 ([source-review-2026-09.md](../source-review-2026-09.md)): the control maker's cycles manual (01/2008), its fundamentals and job-planning manuals (2006, 2013), its measuring-cycles manuals (2008, 2019), its 5-axis machining handbook (2009) and its training material on the high-level language (2010). Where one of them settles a point below, the text says so without a page tag.
- General knowledge where those sources say nothing.

Source tags used below:

| Tag | Meaning |
|---|---|
| **[P §x, p.n]** | Settled by the control maker's 840D sl programming manual (06/2019): section and page. |
| **[M]** | Seen in the machine builder's 840D sl manual. |
| **[GK: verify]** | General knowledge — verify against a Sinumerik manual. Short form of "(general knowledge — verify against a Sinumerik manual)". |

Where a whole section is general knowledge, its first paragraph says so once.

---

## 1. Scope note

**In scope.** Programs in Siemens mode (the control's own language: DIN 66025 words plus the Siemens high-level language), as post-processors write them for milling and turning centres:

- rapid, linear and circular moves; feeds, speeds and spindle commands
- tool selection (`T`, `T="name"`), cutting edges (`D`), `M6`
- settable work offsets (`G54`–`G57`, `G505`–`G599`, `G500`)
- programmable frames for 3+2 (`TRANS`, `ROT`, `AROT`, …) and the standard swivel cycle `CYCLE800`
- 5-axis transformation `TRAORI` / `TRAFOOF`
- high-speed settings: `CYCLE832`, or `G64x`/`COMPCAD`/`SOFT`/`FFWON` written directly
- standard drilling cycles `CYCLE81`–`CYCLE86`, `CYCLE840`, modal calls with `MCALL`
- the turning cycles of the 4.92 cycle list (§6.4)
- comments, block numbers, labels, block skip, `MSG()`
- subprogram calls (`L…`, by name, `CALL`, `PCALL`, `EXTCALL`), `M17`/`RET`, `R` parameters, simple `DEF` variables

**Tokenized only, no help text or checks for now:**

- String functions, arrays and frame arithmetic.
- Synchronized actions (`WHEN … DO …`, `ID=`, `IDS=`), multi-channel coordination (`WAITM`, `WAITE`, `SETM`), axis and spindle container commands.
- Milling pocket/slot cycles (`POCKET3`, `SLOT1`, `CYCLE61`, …). CAM posts seldom use them. Recognize the names and show them in the map.

**Deliberately excluded:**

- Conversational work-step programs written with the control's graphical front-end. They are stored as G-code with large blocks of hidden, machine-generated lines.
- Machine-builder cycles. They show up as ordinary subprogram calls such as `NAME(1,2)` and are highlighted generically.
- ISO dialect mode (`G291` [P §3.23.7, p.1025], or a program called with `ISOCALL` [P §3.2.3.7, p.544]), in which the control reads Fanuc-style code with the ISO settings of its machine data; `G290` switches back to Siemens mode, the reset state. gEdit's decision: such a file is read with a Fanuc profile. Two of the five programs in the owner's Siemens folder look like ISO-mode programs (parenthesis comments, no `MSG` or `LIMS`), so this case is real; the database has neither `G290` nor `G291` yet.
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

The first two lines are only present in files moved through the transfer format. A file saved on a PC as `BRACKET_OP10.MPF` usually starts directly with the first comment or block **[GK: verify]**. The `CYCLE83` arguments are illustrative only.

### 2.2 Structural elements

| Item | Rule | Src |
|---|---|---|
| Main program | Extension `.MPF`; inside the control the name gets the prefix `_N_` and the postfix `_MPF` | [M]; [P §2.2.1, p.47] |
| Subprogram (also cycle files) | Extension `.SPF`, postfix `_SPF` | [M]; [P §2.2.1, p.47] |
| Workpiece folder | `.WPD` directory that groups main programs, subprograms and init files of one part | [M] |
| Transfer header, line 1 | `%` then the name with its four-character file id: `%_N_<NAME>_MPF`, `%_N_<NAME>_SPF`, and also the short form `%<NAME>_MPF`. It gives name and type. It is not an NC block. | [M]; [P §2.2.1, p.47] |
| Transfer header, line 2 (optional) | `;$PATH=/_N_WKS_DIR/_N_<PART>_WPD`, or `/_N_MPF_DIR` / `/_N_SPF_DIR` for the folders of main programs and global subprograms | [M] the `;$PATH=` line; [P §3.4.1.1, p.564] the folder names |
| Program start | No `%` inside the program, no O-number. The file name is the program name. | [P §2.2.1, p.46] |
| Program names | Letters, digits, underscore, at most 24 characters, upper and lower case the same. A name whose first two characters are two letters, or `_` and a letter, can be called by its name alone; a name that starts with digits (`%_N_1000_MPF`) only with `CALL`. A few names are refused because they clash with Windows device names. | [P §2.2.1, p.46] |
| Main program end | `M30` or `M2`; `M17` ends a program too | [M]; [P §2.2.2.1, p.49] |
| Subprogram end | `M17`, or `M30`, which the language treats the same in a subprogram; or `RET`, in a block of its own. A main program called as a subprogram returns at its `M2`/`M30`. | [P §3.2.2.8–3.2.2.9, p.522–523; §3.2.3.1, p.534] |
| Parameterized subprogram | First statement `PROC <name>(<type> <par>, …)` with optional attributes `SAVE`, `DISPLOF`, … | [P §3.2.2.2, p.507] |
| Declaration in caller | `EXTERN <name>(<type>, …)` before a parameterized call of a subprogram in the workpiece or global folder; cycles need none | [M]; [P §3.2.3.2, p.536] |
| Definitions | Local and program-global variables are defined in the definition part at the top of a program, one data definition per block and one data type per definition | [P §3.1.1.5, p.404] |
| Block | One line = one block. There is no continuation character: `&` is a formatting character that reads like a space. | [P §2.2.2.2, p.50; §2.3.2, p.56] |
| Block number | `N` and a positive whole number (an INT, so there is no five-digit limit). The order is free, but a number should occur once, or a block search is ambiguous. Real 5-axis posts number past N3,700,000, which is why the profile's renumbering maximum is the INT limit 2147483647 and it stops rather than wraps (a maximum that stops is the control's hard limit to the renumber form). | [P §2.2.2.2, p.50; address table p.1215] |
| Line end | A block ends with LF. CR LF is accepted on import **[GK: verify]**. Keep the original line ending when saving. | [P §2.2.2.2, p.50] |
| Encoding | Plain ASCII in CAM output. Older controls use Latin-1 for umlauts in comments; newer ones may use UTF-8. Never convert silently. Characters that cannot be shown are read as spaces. | [GK: verify]; [P §2.3.2, p.56] |
| Block length | At most 512 characters, the comment and the LF included | [P §2.2.2.2, p.50] |

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

1. **Block skip** `/` or `/0`–`/9` at the start of the block, one level per block; `/` and `/0` are the same (first) level, so there are ten. How many levels a control offers is display machine data. The level digit follows the slash directly (`/7 N35 …`). [M]; [P §2.2.2.5, p.52–53]
2. **Block number** `N` + digits. Optional; order and uniqueness are not enforced (§2.2). **Main block** `:` + digits is the other kind of block number: the list of special characters names `:` for main blocks, label ends and chaining [P §2.3.2, p.55]. Only valid at block start (after the skip).
3. **Label** `IDENT:` at block start, right after the block number when there is one [P §3.1.5.2, p.473]. A statement can follow on the same line (`LOOP_A: G1 X10`) [M]. A label can start with `N` (`NEXT_PART:`), so check "identifier followed by `:`" **before** the block-number rule. Exclude `:=` (not used in Siemens mode, but safe).
4. **Words**, separated by spaces or tabs; `&` separates like a space [P §2.3.2, p.56].
5. **Comment** `;` to end of line [M]; [P §2.2.2.4, p.51].

### 3.2 Words and addresses

| Form | Examples (own) | Notes | Src |
|---|---|---|---|
| Letter + number | `X12.5` `G1` `M30` `F800` `S12000` `T5` `D1` `L100` | The value follows the letter directly; a separator after the letter is allowed. | [M]; [P §2.2.2.3, p.51] |
| Letter `=` expression | `X=R1+5` `F=R10*2` `S=1200` | `=` is required when the value is more than one constant; it may be left out for a single-letter address with one constant. | [P §2.2.2.3, p.51] |
| Address with numeric extension | `S3=2500` `M3=3` `M1=5` `T1=4` `X1=10` | `=` (or one of `( [ ) ] ,` or an operator) must follow the extension, which is what tells `S3=` from `S3`. Spindle-addressed S/M/T. | [M]; [P §2.2.2.3, p.51] |
| Multi-letter keyword with `=` | `CR=15` `AR=90` `TURN=2` `LIMS=3000` `ADIS=0.5` `SPOS=90` `CHF=1` `RND=2` `FRC=0.1` `FB=0.2` `I1=` `J1=` `K1=` | An address of more than one letter always needs `=`. Tokenize `[A-Z_][A-Z0-9_]*=` as "address with assignment". | [M] LIMS; [P §2.2.2.3, p.51] |
| Indexed address | `LIMS[2]=1800` `FA[C]=100` `S[SPI]=300` `M[SPI]=3` `T[SPI]=5` | `[…]` after the name holds a spindle number, an axis, or a variable in place of the numeric extension of `S`, `M`, `T`, `H`, `SPOS`. The grammar reads `LIMS[2]` as a name, a bracketed index and an assignment, not as one address; the scripts match that pattern themselves. | [P §2.6.3, p.103–104; §2.15.4, p.386–387] |
| Per-value absolute/incremental | `X=AC(10)` `Y=IC(-5)` `C=DC(90)` `C=ACP(45)` `C=ACN(45)`; diameter or radius for one value `X=DAC(40)` `X=RIC(1)` | Function-like modifiers | [P §2.8.4.1, p.155; §2.8.4.2, p.157; §2.8.4.4, p.162; §2.8.4.7, p.169–170] |
| Multi-letter axis names | `C1=90` `Z3=10` `X4=20` | The machine builder names the axes. `=` is required when the axis name ends in a digit. | [P §2.2.2.3, p.51; §2.15.4, p.385–387] |
| Command keyword | `TRAORI` `STOPRE` `SOFT` `COMPCAD` `DIAMON` `SUPA` | Bare keywords, no value | [M] STOPRE; [P §4.1, p.1175–1213] |
| Call with arguments | `CYCLE81(10,0,2,-12)` `MSG("TEXT")` `SETMS(3)` `NAME(1,,5)` | Identifier immediately followed by `(`. Empty arguments (`,,`) are allowed, and a reserved argument is written as `0` or left empty. | [M]; [P §3.25.1.1, p.1042] |

### 3.3 Numbers

- Optional sign, digits, optional decimal point, digits: `10`, `10.`, `.5`, `-0.25`; a plus sign and leading zeros may be left out [P §2.2.2.1, p.48].
- **A whole number is the number it says.** `X10` assigns 10 to the address, `X10.25` assigns 10.25, and `X.25` 0.25. There is no reading in increments in the control's own language: `X10` is 10 mm (or inch, under `G70`/`G700`). This differs from Fanuc controls configured for implicit 0.001. More decimals than an address takes are rounded to the digits it takes. [P §2.15.6, p.389–390]
- Exponent written `EX`: `X=-.1EX-3` [P §2.15.6, p.389].
- Hex `'H1F'`, binary `'B1011'` (with single quotes) [P §2.15.6, p.390]. Rare in CAM output.
- The value belongs to the preceding address. Leading zeros of the value need not be written, so `G1` and `G01` are the same code [P §2.2.2.1, p.48].

### 3.4 Comments, strings and brackets

- `;` starts a comment that runs to the end of the line [M]. A `;` inside a string is not a comment.
- **Parentheses are not comments in Siemens mode.** They hold call arguments (`L10(1)`, `MSG("…")`, `CYCLE81(…)`) [M] and group expressions [P §2.3.2, p.55]. Only in ISO mode are `( … )` comments **[GK: verify]**. Do not reuse the Fanuc comment rule.
- Strings: `"…"` [M]; [P §2.3.2, p.56]. They appear in `MSG`, `T="…"`, `CALL "…"`, `EXTCALL("…")` and as cycle arguments. How a quote is escaped inside a string needs checking **[GK: verify]**.
- `[ ]`: address and array indices (`R[5]`, `$AA_IM[X]`, `$TC_DP1[1,1]`, `LIMS[2]`) [P §2.3.2, p.55].

### 3.5 Identifiers, operators, case

- Identifiers: letters, digits and `_`; the first two characters should be letters or underscores. At most 24 characters for a program name, 31 for a variable, 8 for an axis [P §2.15.5, p.388]. Upper and lower case are not told apart — except in a tool name [P §2.3.2, p.56]; the manual uses both `GOTOF` and `gotof` [M]. Set Monarch `ignoreCase: true`.
- Operators [P §2.15.7, p.391–392]:
  - arithmetic: `+ - * /`, `DIV` (integer division), `MOD` (remainder, integers only)
  - comparison: `==` `<>` `<` `>` `<=` `>=`
  - logical: `NOT` `AND` `OR` `XOR`
  - bitwise: `B_AND` `B_OR` `B_XOR` `B_NOT`
  - string concatenation: `<<` (a jump can name its target as `"N"<<R10`) [P §3.1.5.2, p.474]
  - assignment: `=`
- Built-in functions, written with `( )`: `SIN COS TAN ASIN ACOS ATAN2 SQRT ABS POT TRUNC ROUND LN EXP` [P §2.15.7, p.392–393]; `MINVAL`, `MAXVAL`, `BOUND` and others in the variables chapter [P §3.1.1.15, p.431].

### 3.6 Variables

| Kind | Form | Src |
|---|---|---|
| R parameters | `R<n>` or `R[<expression>]`, `R1=5`, `X=R1`; how many there are is machine data | [P §3.1.1.2, p.398–399] |
| System variables | `$` and one or two letters and `_`: the first letter gives the kind of data (`$M` machine data, `$S` setting data, `$T` tool management, `$P` programmed values, `$A` current main-run data), the second where it applies (`N` the whole NC, `C` a channel, `A` an axis): `$MC_…`, `$AA_IM[X]`, `$P_EP[X]`. `$TC_…` and `$P_…` are exceptions to that second letter. | [P §2.3.2, p.56; §3.1.1.1, p.397] |
| Local user variables | `DEF REAL DEPTH=5`, types `INT REAL BOOL CHAR STRING[n] AXIS FRAME`; arrays `DEF REAL POS[10]`; in the definition part, one definition per block | [P §3.1.1.5, p.404] |
| Global user variables | Defined in a separate definition file (`_N_DEF_DIR/…`). In programs they appear as plain identifiers (`NAME=2`, `IF NAME==1 …`). | [M]; [P §3.1.1.5, p.404] |
| Subprogram parameters | Names from the `PROC` line, at most 127 | [P §3.2.2.2, p.507–508] |

A tokenizer cannot tell a global variable from a subprogram called by name. Colour unknown identifiers neutrally.

### 3.7 Whitespace

- Spaces or tabs separate words, and so does `&` [P §2.3.2, p.56]. A separator is needed where two words would otherwise merge into one identifier (`G1 X10` vs. the identifier `G1X10`). Packed output such as `G1X10Y20` is accepted by the control for single-letter addresses **[GK: verify on real posts]**. The tokenizer should accept both forms.
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
| 19 | `[ \t&]+` | `white` |

Keyword lists for rule 15:

- `@control`: `IF ELSE ENDIF WHILE ENDWHILE FOR TO ENDFOR REPEAT REPEATB UNTIL LOOP ENDLOOP CASE OF DEFAULT GOTO GOTOF GOTOB GOTOC RET PROC EXTERN DEF CALL PCALL MCALL EXTCALL BLOCK AND OR NOT XOR DIV MOD B_AND B_OR B_XOR B_NOT`
- `@nc`: `TRAORI TRAFOOF TRANSMIT TRACYL TRAANG TRANS ATRANS ROT AROT RPL SCALE ASCALE MIRROR AMIRROR SUPA DIAMON DIAMOF DIAM90 SOFT BRISK FFWON FFWOF COMPON COMPCURV COMPCAD COMPOF CUT2D CUT3DC CFC CFTCP CFIN ORIWKS ORIMKS ORIAXES ORIVECT STOPRE CIP CT AC IC DC ACP ACN`
- `@types`: `INT REAL BOOL CHAR STRING AXIS FRAME`

A strict version handles `;` inside strings by matching rule 2 before rule 1 on the remainder of a line. In CAM output this case is rare enough that rule order 1 → 2 is acceptable for highlighting. The program map and linter must use a real scanner that handles strings first.

---

## 4. Codes commonly emitted by CAM

The G groups, their members, which of them are modal and which is the control's reset state come from the G-group tables of the manual [P §4.3, p.1226–1246]; the meanings from the sections cited per row. Only one code of a G group may stand in a block [P §4.3.1, p.1226]. What the tables mark as the reset state is the control maker's delivery state; for the codes the tables mark as configurable, the machine builder can change it (machine data MD20150) [P §4.3, p.1246], so gEdit treats every power-on code as a documented default a machine configuration can override.

### 4.1 Motion and path

| Code | Meaning (own words) | Group | Parameters / notes |
|---|---|---|---|
| `G0` | Rapid positioning | 1 | Axis words |
| `G1` | Linear move at feed | 1 | Axis words, `F` |
| `G2` / `G3` | Arc clockwise / counter-clockwise | 1 | End point, plus one of: `I J K` (centre, incremental from start by default; `I=AC(…)` for absolute), `CR=` (radius, negative for arcs over 180°), `AR=` (opening angle). Helix: extra axis word and `TURN=` for full turns. |
| `CIP` | Arc through an intermediate point | 1 | `I1= J1= K1=` intermediate point |
| `CT` | Arc tangential to the previous path | 1 | End point only |
| `G33` | Thread cutting with constant lead | 1 | Lead in `I`, `J` or `K` by the axis it runs along, start angle `SF=`; the spindle needs a position encoder [P §2.9.10.1, p.224–226] |
| `G34` / `G35` | Thread cutting with a lead that grows / shrinks linearly | 1 | Lead at the start in `I`, `J` or `K`, **`F` is the change of the lead per revolution** (mm/rev²), not a feed [P §2.9.10.2, p.231–232] |
| `G335` / `G336` | Thread along a clockwise / counter-clockwise arc (a convex thread) | 1 | Lead in `I`, `J` or `K` as with `G33`; the arc by `CR=`, `AR=`, an intermediate point, or a centre written `IR=`, `JR=`, `KR=` (the default names, set in machine data); `SF=` [P §2.9.10.5, p.238–239] |
| `G331` / `G332` | Rigid tapping in / out | 1 | Lead in `I`, `J` or `K`, its sign giving a right- or left-hand thread; `G332` retracts with the same lead and reverses the spindle by itself. `S` is always read in rpm while one of them is in force, and the tapping spindle has to be the master spindle [P §2.9.11.1–2.9.11.7, p.243–247; §2.6.1, p.95] |
| `G4` | Dwell (non-modal, alone in its block) | 2 | `F` = seconds, `S` = revolutions of the master spindle, `S<n>=` = revolutions of spindle n. Not `P` as on Fanuc. Neither changes the program's feed or speed. [P §2.14.7, p.371–372] |
| `G63` | Tapping with a compensating chuck, one block | 2 | Axis word, direction `M3`/`M4`, speed `S`, feed `F` = spindle speed × pitch; afterwards the move type in force before it applies again. The retract is a second `G63` block with the reversed direction. [P §2.9.12.1, p.247–248] |
| `G9` | Exact stop for this block only | 11 | [P §4.3.11, p.1230] |
| `G60` / `G64` | Exact-stop mode (the reset state) / continuous-path mode | 10 | [P §4.3.10, p.1230] |
| `G641` / `G642` / `G643` / `G644` / `G645` | Continuous path with rounding by distance (`ADIS=`) / by axis tolerances / tolerances inside the block / greatest dynamics / tangential transitions too | 10 | [P §4.3.10, p.1230]. `CYCLE832` switches the path mode, the compressor, `SOFT`/`BRISK` and feed-forward itself, and the cycles manual says the CAM program after it should not repeat them; a post that does not use it writes them directly |
| `SOFT` / `BRISK` / `DRIVE` | Jerk-limited / step (the reset state) / speed-dependent acceleration, modal | 21 | [P §4.3.21, p.1233] |
| `FFWON` / `FFWOF` | Feed-forward control on/off | 24 | |
| `COMPON` / `COMPCURV` / `COMPCAD` / `COMPSURF` / `COMPOF` | Compressor for short linear blocks; `COMPOF` is the reset state | 30 | [P §4.3.30, p.1236]. Usually switched by `CYCLE832` (see `G642`) |
| `G601` / `G602` / `G603` | Block change at fine / coarse exact stop / at the end of interpolation | 12 | Missing from the database |
| `DYNNORM` / `DYNPOS` / `DYNROUGH` / `DYNSEMIFIN` / `DYNFINISH` / `DYNPREC` | Dynamics response per technology | 59 | Missing from the database |
| `CTOL=` / `OTOL=` / `ADIS=` | Contour tolerance (a length) / orientation tolerance (an angle) / rounding distance; a negative tolerance clears it | – | Missing from the database |

### 4.2 Plane, units, dimensions, feed type

| Code | Meaning | Group | Notes |
|---|---|---|---|
| `G17` / `G18` / `G19` | Working plane XY (the reset state) / ZX / YZ | 6 | `G18` is the turning plane [M]; [P §4.3.6, p.1228] |
| `G90` / `G91` | Absolute (the reset state) / incremental | 14 | Per-value override with `AC()` / `IC()` [P §4.3.14, p.1231] |
| `G70` / `G71` | Inch / metric (the reset state) for geometry only | 13 | **Different from Fanuc lathes, where G70/G71 are cycles** [P §4.3.13, p.1230] |
| `G700` / `G710` | Inch / metric for geometry and feed | 13 | [P §4.3.13, p.1230–1231]. Preferred in newer posts **[GK: verify]** |
| `G93` / `G94` / `G95` | Inverse-time / per minute (the reset state) / per revolution feed | 15 | `G94` and `G95` also end a constant cutting speed [P §2.6.3, p.105] |
| `G96` / `G961` / `G962` | Constant cutting speed with feed per revolution / per minute / whichever feed type is in force | 15 | **`G96` switches feed per revolution on.** `S` is then a cutting speed in m/min (ft/min under `G70`/`G700`) [P §2.6.3, p.102–103] |
| `G97` / `G971` / `G972` | Constant spindle speed with feed per revolution / per minute / whichever is in force | 15 | Ends a constant cutting speed; without a new `S` the spindle keeps the speed it had. `G97` without a `G96` before it works like `G95` [P §2.6.3, p.103–105] |
| `G973` | As `G97`, without switching a speed limit on (for ISO mode) | 15 | [P §2.6.3, p.103, p.106] |
| `G931` / `G942` / `G952` | Feed given by the travel time / feed per minute, spindle speed frozen / feed per revolution, spindle speed frozen | 15 | Only in the tables [P §4.1, p.1195; §4.3.15, p.1231]; gEdit ships `G942`/`G952` marked for verification and leaves `G931` out |
| `LIMS=` / `LIMS[<n>]=` | Speed limit of the master spindle / of spindle n, for up to four spindles in one block | – | Acts under `G96`, `G961` and `G97`, not under `G971`; kept in setting data after the program ends [P §2.6.3, p.103–105] |
| `G25` / `G26` | With `S` (and `S1=`, `S2=`, up to three per block): lowest / highest spindle speed; with axis words: lower / upper working-area limit | 3 (non-modal) | Either way a limit, written into setting data. A speed limit stays after the program ends [P §2.6.5, p.108–109]; a working-area limit survives a reset when machine data says so [P §2.14.3.1, p.355–358]. `G26 S3=2500` [M] |
| `DIAMOF` / `DIAMON` / `DIAM90` / `DIAMCYCOF` | Diameter programming off (the control maker's reset state) / on / diameter for absolute values, radius for incremental ones / off while a cycle runs | 29 | Turning. **The gEdit turning profile starts with `DIAMON`** (owner decision D35); the builder decides what a real control starts with (MD20150). Axis-wise forms `DIAMONA[<axis>]`, `DIAM90A`, `DIAMOFA` and the per-value forms `DAC`, `DIC`, `RAC`, `RIC` exist as well. [P §2.8.4.6–2.8.4.7, p.167–170; §4.3.29, p.1235–1236] |

### 4.3 Compensation, offsets, frames

| Code | Meaning | Group | Notes |
|---|---|---|---|
| `G40` / `G41` / `G42` | Cutter radius compensation off (the reset state) / left / right | 7 | Activated with a `D` edge [P §4.3.7, p.1229]. **No `G43`/`G49` in Siemens mode**: neither is in the instruction list, and length compensation comes with `D` [P §2.4, p.64; §4.1]. |
| `G450` / `G451` | Corner behaviour with radius compensation (arc / intersection) | 18 | |
| `CUT2D` / `CUT3DC` | 2D / 3D radius compensation | 22 | |
| `CFC` / `CFTCP` / `CFIN` | Feed reference: contour (the reset state) / tool centre / inner radius only | 16 | [P §4.3.16, p.1232] |
| `G500` | Switch the settable work offset off (the reset state); base frames stay | 8 | Often in the program header [P §4.3.8, p.1229] |
| `G54`–`G57` | Settable work offsets 1–4 | 8 | |
| `G505`–`G599` | Further settable work offsets; how many a control has is machine data | 8 | [P §4.3.8, p.1229] |
| `G53` / `G153` / `SUPA` | Suppress offsets for this block: the programmable and settable frames / and the base frames / and handwheel, external and preset offsets | 9 | Used for safe retract before tool change [P §4.3.9, p.1229] |
| `G58` / `G59` | Programmable **axial** offsets (replace / add), not work offsets as on Fanuc | 3 | Their axis words are offsets, not positions |
| `G74` / `G75` | Reference-point approach / approach a fixed machine point (`G75 X0 Z0 FP=n`): the axis value is not a position | 2 | Common in milling posts as a retract; not allowed while radius compensation or a transformation is active. Missing from the database |
| `TRANS` / `ATRANS` | Programmable translation (absolute / additive) | 3 (non-modal, own block; the frame it sets stays) | `TRANS` alone resets the programmable frame [P §4.3.4, p.1227] |
| `ROT` / `AROT` | Programmable rotation around axes, or `RPL=` in plane | 3 | Used for 3+2 when the post does not use `CYCLE800` |
| `SCALE` / `ASCALE`, `MIRROR` / `AMIRROR` | Scaling / mirroring | 3 | Rare in CAM output |

### 4.4 Orientation and 5-axis

| Code | Meaning | Notes |
|---|---|---|
| `CYCLE800(…)` | Swivel the working plane (standard Siemens cycle, common in CAM output for 3+2) | See §6.2 |
| `TRAORI` | Switch on the 4- or 5-axis transformation (tool-centre-point programming) | Optional arguments `(n, x,y,z, a,b)`. After it, X/Y/Z are the tool tip |
| `TRAFOOF` | Switch off the active transformation | Must follow every `TRAORI`/`TRANSMIT`/`TRACYL` section |
| `ORIWKS` / `ORIMKS` | Orientation in workpiece / machine coordinates | |
| `ORIAXES` / `ORIVECT` | Interpolate orientation axis-wise / as a vector (great circle) | |
| `A3= B3= C3=` | Tool direction vector (alternative to rotary axis words) | Also `A2/B2/C2` (angles), `A4`…`C8`, `LEAD`/`TILT`/`THETA` |
| `ORIEULER` / `ORIRPY`, `ORIPATH` / `ORIPLANE` / `ORICURVE`, `ORIRESET(…)` | How orientation angles are read / interpolated; `ORIRESET` only while `TRAORI` is on | Missing from the database |
| `TRANSMIT` / `TRACYL` / `TRAANG` | Face-end (polar) / peripheral-surface / inclined-axis transformation for mill-turn | Named in [M] as control functions |

### 4.5 Spindle, tool, M functions

| Code | Meaning | Notes | Src |
|---|---|---|---|
| `S…` | Speed of the master spindle (a cutting speed under `G96`, `G961`, `G962`) | `S0=` also names the master spindle; at most three `S` values per block | [M]; [P §2.6.1, p.93–95] |
| `S<n>=…` | Speed of spindle `<n>` | | [M]; [P §2.6.1, p.93] |
| `M3` / `M4` / `M5` | Spindle CW / CCW / stop, master spindle | In a block with axis words they switch before the axes move (the reset setting) | [P §2.6.1, p.93–95] |
| `M<n>=3` / `=4` / `=5` | Same, for spindle `<n>` | | [M]; [P §2.6.1, p.94] |
| `SETMS(<n>)` / `SETMS` | Make spindle `<n>` the master spindle / go back to the master spindle set in machine data. In a block of its own. The main spindle is usually the one set as master, but its number is the builder's choice: one builder's manual numbers the main spindle 4. | | [M]; [P §2.6.1, p.93–96] |
| `SPOS=` / `M19` | Spindle positioning / to the angle in setting data (`M<n>=19` for spindle n) | Position control holds until the next `M3`, `M4` or `M5`. `M19` is one of the control's predefined M functions; the database keeps it marked for verification with `M6`, as the review asked, because where it stops is the machine's setup | [P §2.7.4, p.123–124; §2.13, p.349] |
| `T…` `D…` `M6` | Tool, edge, tool change (§5) | `M6` is listed as the tool change in the control's standard setting; the builder decides whether a turret needs it | [P §2.4, p.64–70; §2.13, p.349] |
| `M0` / `M1` | Program stop / optional stop | | [M] |
| `M2` / `M30` | Program end | | [M] |
| `M17` | Subprogram end | | [M]; [P §3.2.2.8, p.522] |
| `M7` / `M8` / `M9` | Coolant (mist, flood, off). Machine-dependent: they are not among the control's predefined M functions. | | [GK: verify] |
| `M40` / `M41`–`M45` | Automatic gear stage / gear stage 1–5; predefined by the control. All five programs in the owner's Siemens folder write `M41` | | [P §2.13, p.348–349] |
| `M70` | Spindle switched to axis mode; predefined | | [P §2.13, p.349] |
| `MSG("…")` / `MSG()` | Show / clear an operator message. CAM posts often use it for the operation name **(verify)**. | | [M] |
| `STOPRE` | Stop look-ahead (pre-processing stop) | | [M] |

M-numbers above 30 are machine-specific, except the predefined `M40`–`M45` and `M70`. `M0`, `M1`, `M2`, `M17` and `M30` never take an address extension, and a block holds at most five M functions. Keep the rest in a user-editable machine table; do not mark them as errors.

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
| G96/G97 | Feed type as well: `G96` is also feed per revolution | Spindle mode only |
| Integer values | `X10` = 10 mm | Often `X10` = 0.010 mm |

---

## 5. Tool change and offsets

### 5.1 Words

- `T<n>` (tool number, 0–32000), `T=<n>`, `T<n>=…` (tool for spindle `<n>`; whether a control accepts the spindle extension is the builder's setup). `T0` deselects the tool. [P §2.4.1, p.64–65]
- With tool management: `T="<name>"` names the tool, and the name is compared with its capitals; `T=<n>` is then the number of a magazine location, not a tool number. A location that is empty acts like `T0`. [P §2.4.3, p.67–70]
- `D<n>`: cutting edge (offset set) of the active tool. `D0` switches length and radius offsets off [M, as `T0 D0`]. The tool change activates the offsets of a `D` number [P §2.4, p.64]; many configurations activate `D1` automatically after a tool change.
- `M6`: executes the change on milling machines with a chain, disc or box magazine; a turret changes on the `T` word alone. Which of the two a machine does is set up by the builder at commissioning. [P §2.4, p.64; §2.4.2, p.66–67]

### 5.2 Detecting a tool change for the program map

1. Remove comments and strings (keep the string value for `T="…"`).
2. Remember the last `T` word: number, name or expression, plus its line.
3. **Milling (file contains `M6`/`M06`)**: each `M6` word (not `M60`–`M69`) is a tool change. The tool is the `T` in the same block, or the last `T` before it. Posts often pre-select the **next** tool right after the change (`T="NEXT"` a few blocks after `M6`). That pre-selection is not a change. [P §2.4.2, p.67: the example preselects `T5` while `T1` works]
4. **Turning (no `M6` in the file)**: each `T` word except `T0` is a change.
5. Label: tool name or number, plus the first comment line directly above or on the same block (CAM tool description). A name made of digits is still a name: `T="007"` is not tool 7.
6. Machine-builder tool-change cycles appear as subprogram calls (`NAME(…)`). Provide a per-profile "extra tool-change pattern" regex instead of hard-coding names.

### 5.3 Offsets worth showing

- Work offset changes (`G54`…, `G505`…, `G500`) as map items.
- `D0` inside a cutting section (after `M6` and before the next tool) is suspicious (§9).

---

## 6. Cycles relevant to CAM output

Parameter lists and meanings come from the manual's cycle chapter [P §3.25.1, p.1042–1170]; the classic parameter order is listed, and newer software versions add mode parameters at the end, so the tokenizer and the signature help must accept any number of arguments, including empty ones (`,,`) [M: empty arguments]. A parameter the manual marks as reserved is written as `0` or left empty [P §3.25.1.1, p.1042].

### 6.1 Drilling cycles

Call styles:

- `CYCLE8x(…)` drills once at the current position.
- `MCALL CYCLE8x(…)`, `MCALL` written in the same line before the cycle, makes the cycle modal. Each following block that moves (`X… Y…`) drills a hole; a block with only `S` or `F` while `G0` or `G1` is in force, or with `G0` or `G1` alone or among other G codes, runs it too. `MCALL` alone ends it, and a new modal call replaces the old one. [P §3.25.1.1, p.1042; §3.2.3.4, p.539–541]

Parameters shared by all drilling cycles:

| Param | Meaning |
|---|---|
| RTP | Retraction plane (absolute) |
| RFP | Reference plane (absolute; top of hole) |
| SDIS | Safety distance above RFP (no sign) |
| DP | Final depth (absolute) |
| DPR | Final depth relative to RFP. Which of DP and DPR counts follows the mode argument `_AMODE`; in its compatible setting, `DPR` decides when both are programmed. |

| Cycle | Purpose | Further parameters (in order) |
|---|---|---|
| `CYCLE81` | Drill, centre drill | DTB: dwell at depth — the compatible setting reads a positive value as seconds and a negative one as spindle revolutions — then `_GMODE`, `_DMODE`, `_AMODE` [P §3.25.1.21, p.1082–1083] |
| `CYCLE82` | Drill or counterbore with dwell | DTB (as above), then the mode arguments and the pre- and through-drilling depths and feeds: 14 arguments, of which 12 (`S_FA`) and 14 (`S_FD`) are feeds, as a value or in % [P §3.25.1.22, p.1083–1086]. The database lists only the first six |
| `CYCLE83` | Deep-hole drilling with pecks | FDEP / FDPR: first peck depth (abs / rel), `_DAM`: how much each further peck is reduced (an amount, or a factor by its sign or `_AMODE`), DTB: dwell at depth, DTS: dwell at start / for chip removal (both by sign as above), FRF: feed factor for the first peck (a factor 0.001–1, or a percentage by `_AMODE`), VARI: 0 = chip breaking, 1 = full retract, then further mode parameters [P §3.25.1.23, p.1086–1089] |
| `CYCLE84` | Rigid tapping (spindle position-controlled) | DTB in seconds, SDAC: spindle direction after cycle, MPIT: metric thread size or PIT: pitch (in mm, TPI, inch or module as `_PITA` says), POSS: spindle stop angle, SST: tapping speed, SST1: retract speed, then further parameters. **The lead and the speed are its own arguments.** [P §3.25.1.24, p.1089–1092] |
| `CYCLE840` | Tapping with compensating chuck | DTB in seconds, SDR: retract direction, SDAC, ENC, MPIT/PIT, …. **ENC (argument 9) decides where the lead comes from:** 0 and 20 with a spindle encoder, 11 without, all three from MPIT/PIT; **1 without an encoder, from the programmed feed, which then has to be the speed times the pitch.** [P §3.25.1.39, p.1129–1131] |
| `CYCLE85` | Ream, feed in and feed out | DTB, FFR: feed in, RFF: feed out [P §3.25.1.25, p.1092–1093] |
| `CYCLE86` | Bore, oriented spindle stop, lift off, rapid out | DTB, SDIR: spindle direction (3 = M3, 4 = M4), RPA/RPO/RPAP: lift-off in the three plane axes, POSS: stop angle [P §3.25.1.26, p.1093–1094] |
| `CYCLE87` | Bore, then spindle stop without orientation (`M5`) and program stop (`M0`) at depth; on NC start the cycle retracts at rapid by itself | SDIR — not in the 4.92 cycle list; described in the 01/2008 cycles manual |
| `CYCLE88` | As `CYCLE87` with a dwell at depth | DTB, SDIR — as above |
| `CYCLE89` | Bore with dwell, feed back out to the safety distance, then rapid to the retraction plane | DTB — as above |

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

The 4.92 signature has 16 arguments: `_FR, _TC, _ST, _MODE, _X0, _Y0, _Z0, _A, _B, _C, _X1, _Y1, _Z1, _DIR, _FR_I, _DMODE`; the 2008 edition has 15 (no `_DMODE`). `_TC="0"` deselects the swivel data set, and **`CYCLE800()` deselects it and clears the swivel frames**; the manual recommends clearing it (and `TRAFOOF`) at program start. Posts also write a bare `CYCLE800` with no brackets. The reference points `_X0…_Z1` are absolute positions, so a Z shift of the program has to move them or refuse.

For gEdit, treat the call as opaque: show parameter names in signature help and add a "plane change" map item.

### 6.3 `CYCLE832`: high-speed settings

Written at the start of an operation (for example `CYCLE832(0.01,_FINISH,1)`) and reset at the end (`CYCLE832()` or an "off" mode). Arguments:

- path tolerance
- machining mode: off, finish, semi-finish, rough; newer versions add orientation variants
- further mode words

The 4.92 signature is `(S_TOL, S_TOLM, S_OTOL)`: `S_TOLM` 0 off, 1 finish, 2 semi-finish, 3 rough, 4 precision, plus 10 when argument 3 is an orientation tolerance (and a higher digit for the surface mode); symbolic forms `_OFF`, `_FINISH`, `_SEMIFIN`, `_ROUGH`, `_PRECISION`, `_ORI_…`. Argument 3 has to be written even on a 3-axis machine. The 2008 signature is `(_TOL, _TOLM)`, where `_TOLM` is a **packed multi-digit code** (machining type, transformation, path mode, feed-forward, compressor). So the second argument means different things in different versions: hover must show the raw value and never decode an old code with the new table. Tolerance 0 or `CYCLE832()` switches it off. Internally the cycle switches `G64x`, the compressor, `SOFT` and `FFWON` (older versions `TRAORI` too, so a `TRAORI` check must stay at info level), and posts that do not use it write those commands directly (§4.1), often with `CTOL=`/`OTOL=` tolerances.

### 6.4 Turning cycles

The turning cycles of the 4.92 cycle list [P §3.25.1.2, p.1043]:

| Cycle | Purpose | Feeds and speeds among its arguments | Src |
|---|---|---|---|
| `CYCLE951` | Stock removal at a corner (points, radii, chamfers) | `_FF1` (argument 16) | [P §3.25.1.43, p.1139–1142] |
| `CYCLE930` | Groove, one or a row | `_FF1` (argument 21) | [P §3.25.1.41, p.1134–1136] |
| `CYCLE940` | Relief groove form E or F, thread undercut | | [P §3.25.1.42, p.1136–1139] |
| `CYCLE99` | Thread turning (longitudinal, face, taper) | none: the pitch is `_PIT` (argument 13) | [P §3.25.1.30, p.1102–1107] |
| `CYCLE98` | Thread chain | none: the leads are arguments (`_PP1`–`_PP3`) | [P §3.25.1.29, p.1098–1102] |
| `CYCLE92` | Parting off, with reduced speed and feed near the centre | `_SV1`, `_SV2` (top speed), `_FF1`, `_FF2`, `_SS2` | [P §3.25.1.27, p.1094–1096] |
| `CYCLE952` | Contour turning, grooving, plunge turning, rest material | `_F`, `_FR` (arguments 5 and 6, one per axis when plunge turning), `_FS` (argument 34, finishing when one call roughs and finishes) | [P §3.25.1.44, p.1142–1148] |
| `CYCLE62` | Contour call for the contour cycles | | [P §3.25.1.12, p.1064] |
| `CYCLE95` | Stock removal along a contour subprogram (described in its own section, though the overview table leaves it out) | `FF1`, `FF2`, `FF3` (arguments 6–8: roughing, plunging, finishing) | [P §3.25.1.28, p.1096–1098] |

`CYCLE93` (groove) and `CYCLE97` (thread) are not in the 4.92 list; they are recognized by name and stay marked for verification until their parameters are in the database. The 01/2008 cycles manual gives both: `CYCLE93` has 18 parameters (`SPD, SPL, WIDG, DIAG, STA1, ANG1, ANG2, RCO1, RCO2, RCI1, RCI2, FAL1, FAL2, IDEP, DTB, VARI, _VRT, _DN`), `CYCLE97` 17, lead first (`PIT, MPIT, SPL, FPL, DM1, DM2, APP, ROP, TDEP, FAL, IANG, NSP, NRC, NID, VARI, NUMT, _VRT`). `POCKET3/4`, `SLOT1/2`, `CYCLE61` (face milling), `CYCLE72` (contour milling) are milling cycles: show them in the map as "cycle". The measuring cycles (`CYCLE961`–`CYCLE998`, `CYCLE150`) read their inputs from `_` variables in the 2008 version and take bracketed arguments in 4.92.

A thread or tapping cycle whose lead is one of its own arguments does not take anything from the feed in force; `CYCLE840` with ENC = 1 does, which is why the database marks only `CYCLE840` with `pitchFeed` among the calls.

---

## 7. Subprograms, labels, variables

### 7.1 Calls

A subprogram call, cycles included, has to stand in a block of its own [P §3.2.3.1, p.534; §3.2.3.2, p.536].

| Form | Meaning | Src |
|---|---|---|
| `L<n>` | Call `L<n>.SPF`. Up to 7 digits, and leading zeros are part of the name: `L123`, `L0123` and `L00123` are three programs. | [M] call form; [P §3.2.3.1, p.534] |
| `L<n>(args)` | Call with parameters | [M] |
| `<NAME>` alone in a block | Call `<NAME>` by name; the control looks for `_MPF` first, then `_SPF`, so a subprogram named like its main program calls the main program again. A main program called this way returns at its `M2`/`M30`. | [M]; [P §3.2.3.1, p.534] |
| `<NAME> P<k>` / `L<n> P<k>` | Repeat the call k times, 1–9999; parameters are passed on the first run only | [P §3.2.3.3, p.538–539] |
| `<NAME>(args)` | Parameterized call. Needs `PROC` in the callee and, for a program in the workpiece or global folder, `EXTERN` in the caller. | [M]; [P §3.2.3.2, p.536–538] |
| `CALL <name>` | Indirect call, the name in a `STRING` constant (`CALL "/_N_WKS_DIR/…/_N_TEIL1_SPF"`) or variable; no parameters | [P §3.2.3.5, p.541–542] |
| `CALL <name> BLOCK <start> TO <end>` / `CALL BLOCK <start> TO <end>` | Run the part of a program between two labels, of another program or of this one | [P §3.2.3.6, p.542–543] |
| `ISOCALL <name>` | Call a program written in the ISO dialect; the control switches to ISO mode for it | [P §3.2.3.7, p.544] |
| `PCALL <path/name>(args)` | Call with an absolute path and parameters, written `PCALL/_N_WKS_DIR/_N_WELLE_WPD/WELLE(…)`; without a path it is an ordinary call | [P §3.2.3.8, p.544–545] |
| `CALLPATH("<path>")` | Extend the search path for calls; not a call itself | [P §3.2.3.9, p.545–546] |
| `EXTCALL("<path/name>")` | Run a program from a local, network or USB drive; the name in quotes inside brackets, with an optional `_SPF`/`.SPF` ending; no parameters. Posts use it to keep a small main program and stream a large surface program **[GK: verify]**. | [P §3.2.3.10, p.546–548] |
| `MCALL <name>(…)` / `MCALL` | Modal call after each block that moves / cancel; only the last modal call is in force | [P §3.2.3.4, p.539–541] |
| `REPEATB <label> P=<n>`, `REPEAT <label> P=<n>`, `REPEAT <l1> <l2> P=<n>` | Repeat the block with the label / the section from the label to the `REPEAT` / the section between two labels (or from a label to `ENDLABEL:`) | [P §3.1.6, p.477–478] |
| `M17` / `M30` / `RET` | Return from subprogram; `M17` and `M30` are the same there, `RET` stands in its own block and keeps a continuous-path mode running | [M]; [P §3.2.2.8–3.2.2.9, p.522–523] |

### 7.2 Labels and jumps

- Definition: `NAME:` at block start, right after the block number when there is one. A label has 2 to 32 characters — letters, digits, underscores — and its first two characters are letters or underscores. [M]; [P §3.1.5.2, p.473]
- `GOTOF <target>` searches forward, `GOTOB <target>` backward [M]. `GOTO` searches forward first, then backward; `GOTOC` is like `GOTO` but raises no alarm when the target is missing and goes on with the next line. `GOTOS` jumps to the start of the program. [P §3.1.5.1–3.1.5.2, p.471–473]
- The target is a label, a main or sub-block number (`GOTOF 200`, `GOTOF N300`), or a `STRING` variable that holds either — also built at run time (`GOTOF "N"<<R10`). A target can only be a block of the same program. [P §3.1.5.2, p.473–475]
- A jump without a condition stands in a block of its own; several conditional jumps may share a block. [P §3.1.5.2, p.474]
- Conditional jump: `IF <condition> GOTOF <label>` [M]; [P §3.1.5.2, p.472].

### 7.2a Channel coordination (for M10)

- `WAITM(mark, ch, ch, …)` is a rendezvous: marks 0–99 in a multi-channel system (only mark 0 with one channel), the own channel need not be listed, the mark is cleared after the rendezvous, and a channel holds at most 10 marks at a time. The channel arguments may be numbers, channel **names** (when machine data enables them) or variables, so a machine needs aliases. `WAITMC` is a conditional rendezvous that does not stop the axes but still blocks.
- `WAITE(ch, …)` waits for the **end of the program** in the other channels. It is not a mark, and a check that compared how many `WAITE` each channel has would flag the normal case.
- `SETM`/`CLEARM` set or clear marks **without waiting**, and survive a reset. `INIT(ch, "prog")` and `START(ch)` select and start another channel's program.
- At least two motion blocks must separate `INIT`/`START`/`WAITE`/`WAITM`/`SETM`/`CLEARM` from a following `WAITMC`.
- Structured blocks: `IF`/`ELSE`/`ENDIF` [M]; `LOOP`/`ENDLOOP`, `FOR`/`TO`/`ENDFOR`, `WHILE`/`ENDWHILE`, `REPEAT`/`UNTIL` [P §3.1.7.1–3.1.7.5, p.484–489]; `CASE … OF … DEFAULT` [P §3.1.5.3, p.475].

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
| Subprogram call | `\bL\d+\b`; `EXTCALL("…")` with its target; `CALL`, `ISOCALL`; `PCALL` followed by a space or directly by `/`; a bare identifier followed by `(` that is not a control function; a name standing alone in its block, with or without `P<n>` — for a name of letters only, which is also how the control's own commands stand in a block (`DRIVE`, `CDON`), only with `P<n>` | Call target |
| Label | `^\s*(/\d?\s*)?(N\d+\s+)?([A-Za-z_]\w*):` | Label name |
| Stops | `\bM0?0\b`, `\bM0?1\b` | Stop / optional stop |
| End | `\bM30\b`, `\bM0?2\b`, `\bM17\b`, `\bRET\b`, also on a line that carries a label (`LOOP_END: M30`), which the map lists as the end with the label in its text | Program end |

The patterns are sketches. `\b` fails on packed words (`N10G54`), so the real rules use a lookbehind for "no letter before" and `(?![\d.])` after the code, as in §3.8.

---

## 9. Validation and lint ideas (cheap, line-based)

Severity: **E** = likely error, **W** = warning, **I** = info.

1. **E** Unbalanced `( )` or `[ ]`, or an unclosed `"` in a block. Parentheses are syntax here, not comments.
2. **E** `GOTOF`/`GOTOB`/`GOTO` target label is missing (not for `GOTOC`, which is allowed to miss). **W** `GOTOF` target is above the jump, or `GOTOB` target is below it.
3. **E** Duplicate label names in one file.
4. **E** Unbalanced `IF`/`ENDIF`, `WHILE`/`ENDWHILE`, `FOR`/`ENDFOR`, `REPEAT`/`UNTIL`, `LOOP`/`ENDLOOP`.
5. **E** Main program (`.MPF`) without `M30`/`M2`. **W** Subprogram (`.SPF`) without `M17`/`RET` (ending at end of file works, but posts should be explicit).
6. **E** `G2`/`G3` without any of `I`/`J`/`K`, `CR=`, `AR=`. **E** `CR=` together with `I`/`J`/`K` in one block.
7. **W** First `G1`/`G2`/`G3` after a tool change has no `F` in effect.
8. **W** `MCALL CYCLE…` still active at a tool change, `M30` or `M17` (missing cancelling `MCALL`).
9. **W** `TRAORI`/`TRANSMIT`/`TRACYL` without a following `TRAFOOF` before program end. **W** `CYCLE800` used but not reset before `M30`.
10. **I** `CYCLE832(…)` active at program end without a reset call.
11. **W** Cutting moves after `M6` with no `D` word, or with `D0`.
12. **W** `G96`/`G961` without an upper limit (`LIMS=` or `G26 S`) earlier in the program. A `G25 S` is a **lower** limit and does not count; `LIMS=` does not act under `G971`.
13. **E** Two codes from the same G group in one block [P §4.3.1, p.1226] — the group table of §4 is settled now.
14. **W** Fanuc-only codes in a Sinumerik file: `G43`, `G49`, `G80`–`G89` (in Siemens mode), `M98`, `M99`, `#` variables, `( … )` used as comments. This probably means the wrong dialect or post.
15. **W** Header `%_N_<NAME>_MPF` does not match the file name or extension.
16. **W** A comment after the closing bracket of a cycle call on a line with `*RO*`/`*HD*` markers nearby (breaks back-translation on the control) [M].
17. **E** Block longer than 512 characters, the comment included [P §2.2.2.2, p.50].
18. **I** `DEF` after the first NC block.
19. **I** Unknown G-code (list-driven; unknown M-codes are never errors).
20. **W** A subprogram call, `SETMS`, `RET`, `G4` or an unconditional jump shares its block with other words [P §3.2.3.1, p.534; §2.6.1, p.94; §2.14.7, p.371; §3.1.5.2, p.474].
21. **E** A cutting move after `G332` without a new `S`: leaving `G331`/`G332` sets the spindle speed to zero. (Switching from `G96`/`G961`/`G962` into `G331`/`G332` zeroes the cutting speed.)
22. **E** `G75` while radius compensation or a transformation is active. **W** A frame instruction (`TRANS`, `ROT`, …) that shares its block with other words.
23. **W** `G291` in a Sinumerik document: from there the control reads ISO code.

---

## 10. Open questions / verify on real CAM output

1. Do posts write the `%_N_…_MPF` / `;$PATH=` header, or plain files? Should gEdit add or strip it on save (a profile option)?
2. ~~Which `CYCLE832` signature?~~ Settled per version (§6.3); which version each of the owner's machines runs is open.
3. ~~`CYCLE800` arguments; does `CYCLE800()` reset?~~ Settled (§6.2).
4. Drilling cycle argument count on current versions (extra mode parameters after the classic list). *The 4.92 lists are in §6.1; older posts may write fewer.*
5. Tool change in mill-turn output: `T="…"` + `M6` vs. `T1=…` spindle-addressed forms vs. builder cycles.
6. Is packed output (`G1X10Y20`) ever produced? Is a space after `N` guaranteed?
7. Encoding of umlauts in comments (Latin-1 vs. UTF-8) on current 840D sl / ONE controls.
8. ~~Block length limit and maximum program-name length on current versions.~~ Settled: 512 characters per block, 24 per program name (§2.2).
9. How `"` is escaped inside strings.
10. ~~`DP` vs. `DPR` precedence.~~ Settled: `DPR` decides when both are given (§6.1).
11. ~~Leading-zero rule for `L` numbers (`L1` vs `L01`).~~ Settled: leading zeros are part of the name (§7.1).
12. ~~Are the modal group numbers in §4 correct for current software?~~ Settled by the group tables (§4).
13. Should Sinumerik ONE get its own profile, or is it covered by the same dialect? (Assume one dialect with a version option.)
14. Which spindle number is the master spindle on the owner's machines, and do his posts write `SETMS(n)` for driven tools and the counter spindle? (`scale_speed` leaves a plain `S` after `SETMS(n)` alone unless asked, so on a post that writes `SETMS(1)` before every `S` it scales nothing.) On one builder's turning centres the main spindle is 4, the counter spindle 3 and the driven tools of the two turrets 1 and 2.
15. Do his posts write `CYCLE840` with ENC = 1, and `G63` directly? (A `G63` block without its own `F` would tap with the feed in force; `scale_feed` protects the feed in force only for calls.)
16. New: which of the owner's machines run ISO mode (`G291`), and which Fanuc G-code system and number reading they emulate there.

---

## 11. Gaps in the editor before Phase 1 (historical)

This section records the state of the editor before Phase 1, as read in September 2026 from `src/lib/languages/*.ts`, `src/lib/utils/gcodeParser.ts`, `src/lib/utils/detectLanguage.ts`, `src/lib/utils/dialects.ts`, `src/lib/monaco/setup.ts`, `src/lib/data/blocks/*.json` and `src/routes/+page.svelte`. Several of those files have since been removed or rewritten; what shipped for Sinumerik is the profile, the grammar in `src/lib/core/grammar/sinumerik.ts` and the database named at the top.

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
