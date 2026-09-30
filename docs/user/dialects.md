# Dialects

Every control reads NC code a little differently. A comment is `( ... )` on one and `;` on
another; one numbers every block and refuses a program that does not; `X10.` and `X10` are
the same value on one control and a factor of a thousand apart on the next.

gEdit keeps all of that in a **dialect profile** — one data file per control family. The
editor itself has no favourite dialect: highlighting, the program map, the cleanups, the
renumbering, the code help and the scripts all ask the profile.

A profile says how a program is **written**. How one particular control **reads** it — what
`X50` is worth, which G-code system a lathe is set to, whether `X` is a diameter when the
program starts — is a separate thing, and it lives in a
[machine configuration](machines.md).

## What ships

| Profile | Status bar | For |
|---|---|---|
| **Fanuc (ISO) mill** | `Fanuc` | ISO/G-code programs for milling machines and machining centres — Fanuc and the many controls that emit the same code |
| **Fanuc (ISO) lathe** | `Fanuc T` | Turning programs for Fanuc-style lathe controls, in G-code system A or B |
| **Heidenhain Klartext** | `Heidenhain` | Klartext conversational programs (`BEGIN PGM` … `END PGM`) |
| **Okuma OSP lathe** | `Okuma` | Turning programs for Okuma OSP lathe controls of the OSP-P200L kind: one or two turrets, the C axis and driven tools |
| **Sinumerik 840D (turning)** | `Sinumerik` | Turning programs for Siemens Sinumerik 840D controls, written in the control's own language |

The Okuma and Sinumerik profiles are **turning profiles**: they were written for turning
programs first, on purpose. A program for an Okuma or a Siemens machining centre is not
covered yet — [Milling on Okuma and Sinumerik](#milling-on-okuma-and-sinumerik) says what
happens to one today.

A Siemens control can also be switched to read Fanuc-style ISO code. A program written for
that mode is Fanuc code: read it with a Fanuc profile. Its content usually takes it there by
itself, even as an `.MPF` file; if the status bar says Sinumerik, change it by hand.

## Which dialect a file gets

A dialect you picked by hand for a file wins: gEdit remembers it for that file
([Coming back where you left off](README.md#coming-back-where-you-left-off)). Otherwise it
scores each profile:

1. The **extension** counts. `.nc` and `.tap` point at Fanuc, and `.cnc`, `.eia` and `.iso`
   a little less; `.h` points strongly at Klartext; `.mpf` and `.spf` point at Sinumerik.
   `.min`, `.sub` and `.ssb` do more than point: they decide for Okuma on their own (see
   below). Any other extension, `.txt` included, counts for nothing.
2. The **content** of the first 400 non-empty lines counts:
   - a leading `%`, an `O1234` program number or a line of `G`/`M` codes points at Fanuc;
   - `BEGIN PGM`, `TOOL CALL`, `FMAX` or a block that starts with a bare number points at
     Klartext;
   - a `%_N_NAME_MPF` header, a `;$PATH=` line, a cycle call such as `CYCLE83(…)`,
     `T="…"`, `LIMS=`, `DIAMON` or `MSG(…)` points at Sinumerik;
   - a `$NAME.MIN%` header decides for Okuma on its own. `CALL O…` or `MODIN O…`, `RTS` or
     `MODOUT`, a driven-tool cycle (`G180`–`G189`), a LAP call such as `G85 NLAP1`, a
     `G71`/`G72` thread cycle with `H` and `D`, a `G77`/`G78` tap with `K`, or a line that
     continues its block with `$` each count as much as a hundred ordinary lines, and
     `SB=`, `V1 =`, `IF […] N…`, a six-digit `T` word or a sequence name such as `NLAP1`
     point at Okuma.

   Each line counts once, for the strongest thing it matched.
3. The highest total wins. A file that matched nothing at all — an empty file, an unknown
   extension, a plain text note — opens with the dialect of the document you were working
   in, or, with no document open, with the default dialect from
   `Settings ▸ Files ▸ Default dialect`.

The extension is a **hint, not a verdict**. A Klartext program that somebody saved as
`part.nc` is still recognised as Klartext, because its content says so. A Fanuc-style
program saved as `.MPF` usually opens as Fanuc too, when it has a `%` line or an `O` program
number; without them the extension can win — check the status bar.

**The Okuma extensions are the exception, and on purpose.** Line for line, an Okuma turning
program is Fanuc lathe code: `G00 X600 Z400`, `G96 S180 M03` and `G50 S2500` read the same on
both controls. What tells them apart is a handful of words that many programs never use.
And mistaking one for the other is not harmless: an Okuma `G71` cuts a thread and its `F`
is the lead, a Fanuc `G71` roughs a contour and its `F` is a feed — read the wrong way, a
feed script would change the pitch of the thread. So a `.MIN`, `.SUB` or `.SSB` file
always opens as Okuma, whatever is in it. Two things follow from that:

- **A Fanuc program named `.MIN` opens as Okuma.** `.min` used to count for Fanuc; it
  belongs to Okuma alone now. If your shop names Fanuc programs that way, set the dialect by
  hand once per file — gEdit remembers the choice for that file.
- **An Okuma program under another extension** — `.nc`, `.txt` or none at all — is judged
  on its content. Its `$NAME.MIN%` header decides on its own. Without a header, what only
  this control writes decides: `CALL`, `RTS`, the driven-tool cycles, a LAP call, a `G71`
  thread cycle with `H` and `D`, a `G77` tap with `K`, a line that starts with `$`; six-digit
  `T` words, `SB=`, `V` variables and named sequences help. A program that writes nothing
  but `G` and `M` codes and four-digit `T` words gives Okuma nothing to go on and usually
  opens as a Fanuc lathe program; if the two lathes score exactly the same, the dialect of
  the document you were working in wins when it is one of them. Check the status bar.

A schedule program (`.SDF`) is not claimed by its extension, and on Windows and Linux the
Open dialog lists it only under All files. Its content decides: a `$NAME.SDF%` header line
decides for Okuma like the other Okuma headers.

**Mill or lathe** is decided in the same scoring. The two Fanuc profiles share everything
that makes a file Fanuc, so what separates them is the turning-specific content: a
four-digit `T` word, `G50 S` or `G92 S`, `G96`/`G97`, a `G70`–`G73` block with `P` and `Q`,
a `G71`/`G72` with `U` and `R`, `G28 U`, `U`/`W` words. A milling program is separated by
`M6`, `G43 … H`, `G17` and `Y` words. A Fanuc file that shows neither goes to the **mill**,
which is the tie-break. The Okuma and Sinumerik profiles have no milling partner: an Okuma
milling program opens with the turning profile, because its extension decides, and a
Siemens milling program usually opens as **Fanuc (ISO) mill**, because the Sinumerik
profile does not count the ordinary lines that move `Y` — see
[Milling on Okuma and Sinumerik](#milling-on-okuma-and-sinumerik).

That is not only true of a fragment or a file of nothing but comments. A turning program
whose post writes short `T` words, absolute `X`/`Z` and no spindle-mode code at all can
show nothing that says "lathe", and it then opens as a mill: the turret tool changes do
not appear in the program map, and the `P`/`Q` of a `G70`–`G73` are never rewritten.
**Set the dialect by hand when the status bar shows the wrong one.** The transformations
know they are out of their depth there — renumbering or removing the block numbers of such
a program asks first and lists every `P`/`Q` it will not touch — and `Tools ▸ Tool list`
says to open the file with a lathe profile.

The dialect of the document is shown in the status bar. Click it to change it — the
highlighting, the code help, the program map and everything on the NC tab switch
immediately. On Windows and Linux the dialect also decides which file type the Save As
dialog lists first (macOS lists none). On every system it decides the name Save As offers
an untitled document — `program.nc`, `program.h`, `program.min` or `program.mpf` — and the
line ending a new document starts with: CR LF, or LF on Sinumerik.

Changing the dialect changes nothing in the text.

A Fanuc lathe program is read in G-code system A or B as well. That is a setting of the
machine rather than of the file; how gEdit settles it when no machine says so is described
in [machines.md](machines.md#the-fanuc-lathe). Okuma and Sinumerik have no G-code systems to
choose between.

## What a profile decides

| | Fanuc (ISO) mill | Fanuc (ISO) lathe | Heidenhain Klartext |
|---|---|---|---|
| File extensions | `.nc` `.tap` `.cnc` `.eia` `.iso` `.ncc` `.ptp` `.txt` | the same | `.h` |
| Comments | `( ... )` | `( ... )` | `;` to the end of the line. Text in `"` quotes is a string — a tool name, say — not a comment |
| Block numbers | `N` in front, optional | `N` in front, optional | a plain number at the start of the block, **required** |
| Block skip | `/` before or after the number, with levels | the same | `/` after the number |
| Decimal point | significant by default — `X10` and `X10.` are different values | **not** significant by default — both are 10 mm | not significant |
| Words | may be packed together (`G0M1`) | the same | separated by spaces |
| Variables | `#100` | `#100` | `Q`, `QL`, `QR`, `QS` numbers |
| Continuation | — | — | a trailing `~` |
| Tool call | `M6`, with the `T` word on the same line or the last one before it | the `T` word alone: station plus offset, `T0100` excluded | `TOOL CALL`, on the same line |
| Axes | `X` `Y` `Z` `A` `B` `C` `U` `V` `W` | `X` `Z` `C` `Y`, with `U` and `W` as the incremental twins of `X` and `Z`, and `X`/`U` written as diameters | `X` `Y` `Z` `A` `B` `C` `U` `V` `W`; an `I` in front makes the value incremental (`IX+10`) |
| Program start / end | `O1234` or `:1234` / `M30`, `M2` | the same | `BEGIN PGM name` / `END PGM` |
| Renumber defaults | start 10, step 10, no padding, at most 99999 and then starting over, restart at each program start, skip `%`, `O` and comment lines | the same | consecutive from 0, step 1 |
| Jumps that point at a block number | `M98 Q`, `GOTO`; `M99 P` and the `P`/`Q` of `G70`–`G73` are listed, never rewritten | `M98 Q`, `G70`–`G73` `P`/`Q`, `GOTO`; `M99 P` is listed, never rewritten | none — `CALL LBL` points at a label, not at a block number |
| Code help entries | 83 codes (7 not verified yet) and 25 addresses | 83 codes (10 not verified yet) and 26 addresses in system A, 85 codes (7 not verified yet) in system B | 82 codes (all verified) and 34 addresses |

And the two turning profiles of the other controls:

| | Okuma OSP lathe | Sinumerik 840D (turning) |
|---|---|---|
| File extensions | `.min` `.sub` `.ssb` — they decide the dialect on their own | `.mpf` `.spf` |
| Comments | `( ... )` | `;` to the end of the line. Text in `"` quotes is a string, not a comment, and a `;` inside it is just a character |
| Block numbers | `N` in front, optional: up to four digits, or a **name** that starts with a letter (`NLAP1`). A space has to follow it | `N` in front, optional. A label `NAME:` at the start of a block is a jump target of its own |
| Block skip | `/` at the very start of the block or directly after the sequence number, no levels | `/`, or `/0` to `/9` with a level, in front of the block |
| Decimal point | **never** significant: the machine's unit system scales every number, with a point or without — see [machines.md](machines.md#okuma-the-unit-system-scales-every-number) | not significant: `X10` and `X10.` are both 10 mm. The control's own language has no reading in increments, so no machine changes that |
| Words | separated by spaces in the manual's own examples; gEdit also reads them packed | separated by spaces; packed single-letter words (`G1X10`) are read too |
| Variables | `V1`…, system variables such as `VZOFZ`, and names of the program's own (`DIA1`) | `R1`…, `$` system variables (`$AA_IM[X]`), `DEF` variables and other names |
| Continuation | a line that starts with `$` continues the block above it | — |
| Tool call | the `T` word alone: four digits (station, offset) or six (nose-radius set, station, offset); not a `T` inside a cycle block, not station `00` | every `T` word except `T0`: `T3`, `T="NAME"`, `T1=5` for spindle 1; never a `T` inside a string |
| Axes | `X` `Z` `C` `Y`; `X` is a diameter, in incremental mode too. `U` and `W` are finish allowances, not incremental moves | `X` `Z` `C` `Y`; `X` is a diameter while diameter programming is on, which is how a program is assumed to start |
| Program start / end | `O` plus up to four letters or digits, on a line of its own / `M02`, `M30`, and `RTS` for a subprogram | the `%_N_NAME_MPF` header or `PROC name` / `M30`, `M2`, and `M17` or `RET` for a subprogram |
| Renumber defaults | start 10, step 10, no padding, at most 9999 and then it stops, restart at each `O` program, skip `$`, `%`, `O` and comment lines; a name such as `NLAP1` is never renumbered | start 10, step 10, no padding, at most 2147483647 (the control's limit) and then it stops (the control wants every number once), restart at each program start, skip `%`, `;`, `PROC`, `DEF` and `EXTERN` lines; a label is never renumbered |
| Jumps that point at a block number | `GOTO N…`, `IF […] N…`, and a LAP call (`G85`–`G88`) whose shape starts at a numbered block | `GOTOF`, `GOTOB`, `GOTO` and `GOTOC` followed by `N…`; a jump to a label goes by its name |
| Code help entries | 148 codes (6 not verified yet) and 28 addresses | 183 codes (6 not verified yet) and 20 addresses |

The extensions row is what the Open and Save As dialogs list for each dialect on Windows
and Linux; which of them count in detection is under
[Which dialect a file gets](#which-dialect-a-file-gets). The renumber defaults are what the
Renumber dialog offers the first time. After that it opens with what you used last,
whatever the dialect — see [transformations.md](transformations.md#renumber-blocks).

"Not verified yet" means the project wrote the entry but has not been able to check it
against the control's own documentation: the hover leaves it out and the completion list
marks it (see [Code help](README.md#code-help)). On Okuma that is six entries: `G36`/`G37`,
whose format no manual gives, `G107`/`G108`, and `G142`/`G143`, which only an older code
table names; on Sinumerik it is six as well: `CYCLE93`, `CYCLE97`, `G942`, `G952`, `M6` and
`M19`.

The decimal-point row says "by default" for the two Fanuc profiles because there it **is** a
machine setting: choosing a machine changes it, in either direction. On Sinumerik it is
not — the control's own language reads every number as written. On Okuma the point never
changes a value, but the machine's unit system decides what every number is worth — see
[machines.md](machines.md#okuma-the-unit-system-scales-every-number).

The program map lists what each profile calls worth listing:

- for **Fanuc**, the program number, whole-line comments, `M0`/`M1` stops, subprogram calls
  and the program end;
- for **Klartext**, the `*` section headings, `;` comments, the program header, labels,
  subprogram calls, `STOP` and the program end;
- for **Okuma**, the `O` program names, the operation comments (a whole-line comment, or a
  sequence number with nothing but a comment behind it, as in `N2 (CENTRE DRILL)`), named
  sequences such as `NLAP1`, `CALL O…` and `MODIN O…`, the G-code macro calls (`G161`–`G171`,
  `G205`–`G214`), `M00`/`M01` stops and the ends (`M02`, `M30`, `RTS`). A line lists one
  item, and a named block that ends the program (`NEND M02`) is listed as the end, with
  the name in its text;
- for **Sinumerik**, the `%_N_…` header and `PROC`, labels, whole-line `;` comments (lines of
  `-`, `*`, `=` or `_` left out), the text of every `MSG("…")`, subprogram and cycle calls,
  `M0`/`M1` stops and the ends (`M30`, `M2`, `M17`, `RET`).

Tool calls are in all of them.

## The Fanuc (ISO) lathe profile

Fanuc-style turning programs get a profile of their own. It is a child of the mill profile —
the same comments, the same block numbers, the same cleanups — and it changes the handful
of things that are genuinely different about turning.

**The tool word changes the tool.** A turret lathe has no `M6`. The profile reads a `T` word
as station plus offset: four digits are two and two (`T0101` is station 1, offset 01), three
digits are one and two (`T111` is station 1, offset 11), and one or two digits are the
station on its own. A word whose offset digits are `00` — the `T0100` in a retract block —
cancels the offset rather than changing the tool, and is left out of the program map, out of
`F7` tool-change navigation and out of the tool list.

If your posts write a short `T` word whose last digit is an offset, this rule is wrong for
your machine. It is part of the shipped profile and this version has no setting for it:
tell the project.

**Feed modes and the speed clamp depend on the G-code system.** `G98`/`G99` (per minute and
per revolution) and `G50 S` in system A, `G94`/`G95` and `G92 S` in system B; `G96`/`G97`
switch constant surface speed on and off in both. Which system a program is read in is a
machine setting — see [machines.md](machines.md#the-fanuc-lathe). The feed and speed
scripts read a turning program by the same rules.

**The multi-pass cycles point at block numbers.** `G70`–`G73` name the first and last block
of the finishing profile with `P` and `Q`, and renumbering rewrites them — see
[transformations.md](transformations.md#renumber-blocks).

**Thread leads are protected, whichever system the file is read in.** In `G32`, `G33` and
`G76`, in the tapping cycles `G84` and `G88`, and in `G92` (system A) or `G78` (system B),
the `F` word is a lead rather than a feed rate. The hover says so, and the scaling script
refuses those blocks and reports them; scaling one cuts a different thread. The refusal
does not depend on gEdit having picked the right G-code system: a `G78` is left alone in
system A too, and a `G92 … F` in system B, where it sets the coordinate system — in both
cases the results panel says the code means a threading cycle somewhere else and asks you
to check the block. The same holds for `G74`, which pecks a face on a lathe and taps a
left-hand thread on a mill.

**A speed clamp is not a speed.** `G50 S` (system A) and `G92 S` (system B) give the
highest spindle speed a `G96` program may reach. gEdit reads the `S` of either block as a
clamp in either system rather than as a speed to scale, and the scaling script leaves it
alone unless you tell it to scale the limits as well, because raising the clamp of a
constant-surface-speed program is what lets the spindle run away as the diameter falls.

**Distance is absolute unless the program says otherwise.** System A has no `G90`/`G91` pair
— those numbers are cycles there — so a system A program is read as absolute, with `U` and
`W` as the incremental words. System B has both, and gEdit does not assume which is in force
until the program names one.

**X is a diameter, and the G-code system is a machine setting.** Both of those belong to the
control rather than the file: [machines.md](machines.md#the-fanuc-lathe).

## The Okuma OSP lathe profile

For turning programs of the kind CAM posts write for OSP lathe controls: moves, feeds and
speeds, turret tool changes, the threading, grooving and tapping cycles, the C axis and the
driven-tool cycles, comments, sequence names, block skip, `CALL`/`RTS` subprograms,
`GOTO`/`IF` and the `V` variables.

**Sequence numbers can be names.** `N12` is a sequence number; `NLAP1` or `NT01` is a
sequence *name*, a label a jump or a LAP call can point at. Both have to be followed by a
space or a tab, and leading zeros count: `N0123` and `N123` are two different blocks. The
program map lists every name, renumbering leaves names alone, and the highlighting colours
them like section headings. **Remove Spaces keeps the space after a sequence number or
name**, which the control needs; what else it keeps, and why a packed program needs
checking, is in [transformations.md](transformations.md#remove-spaces).

**Block skip** is a `/` at the very start of the block or directly after the sequence
number. The control has no numbered skip levels.

**The tool word.** A `T` word has four digits — station and offset, `T0303` — or six, with
the nose-radius set in front: `T010203` is set 01, station 02, offset 03. The program map,
`F7` and the hover read it that way. A `T` inside a cycle block (`G71`–`G78`, `G180`–`G189`)
only switches the offset used at the cycle's end point, and station `00` is read as no tool;
neither is a tool change. Every other `T` word is an entry of its own — a repeat of the same
station or a change of its offset included — because in CAM output each one starts a new
operation, even when the turret does not move for it.

On a two-turret machine the program map, `F7` and the tool list do not tell the turrets
apart: `T0101` after `G13` and after `G14` are both station 1, and the tool list gives them
one row.

**Numbers depend on the machine's unit system.** An Okuma control can be set to read every
number in micrometres, in hundredths of a millimetre or in millimetres, and **the decimal
point does not change that**: on a control set to 10 µm, `X0.1` is 0.001 mm. That is a
machine setting, and gEdit treats it as one — see
[machines.md](machines.md#okuma-the-unit-system-scales-every-number). Until you choose a
machine, no length, feed, angle or dwell of an Okuma program has a value in gEdit: the
machine item shows the unit system as assumed, and a script that needs a value reports the
word instead of guessing.

**The same numbers mean something else than on a Fanuc lathe.** This is the part to read
twice:

| | Fanuc lathe | Okuma OSP lathe |
|---|---|---|
| `G71`, `G72` | roughing cycles | multi-pass **thread** cycles; `F` is the lead |
| `G75`, `G76` | grooving and threading cycles | a chamfer or corner round at the end of the `G01` move in the same block |
| `G80`–`G88` | the drilling cycles, and `G80`, which cancels them | LAP: the definition of a finished shape and its automatic roughing and finishing |
| Drilling with a driven tool | `G83`–`G89`, cancelled by `G80` | `G181`–`G189`, cancelled by `G180` |
| `G90`, `G91` | in G-code system A, `G90` is a turning cycle and `U`/`W` move incrementally | absolute and incremental positions; `X` stays a diameter |
| `G20`, `G21` | inch and metric | a home-position return and the return for a tool change |
| Dwell | `G04 X`, `U` or `P` | `G04 F`: the time is in `F` |
| `U`, `W` | incremental `X` and `Z` | finish allowances in the cycles; incremental moves are written with `G91` |
| Arc radius | `R` | `L` |
| Subprogram | `M98 P…` / `M99` | `CALL O…` / `RTS`; `MODIN O…` / `MODOUT` repeats one after every move |
| `M98`, `M99` | subprogram call and return | the tailstock quill's pushing force, low and high |
| `G92` | a threading pass (G-code system A) | not assigned |
| Variables | `#100` | `V100`, and names of the program's own such as `DIA1` |
| Work offsets | `G54`–`G59` | none; the program shifts its zero with `G50 X… Z…` |

The code help takes its meanings from this dialect's own database, so where it describes
one of these codes it describes the right-hand column. Where an entry is not verified yet —
optional codes such as `G36`/`G37` and `G142`/`G143` — the hover says the database does not
describe the word rather than borrow the Fanuc meaning. The feed and speed scripts read the same database:

- **A feed can be a time or a lead.** The `F` of `G04` is a dwell, and scaling feeds leaves
  it alone. In the thread cycles (`G31`–`G35`, `G71`, `G72`), the threads along an arc
  (`G112`, `G113`), the tapping cycles (`G77`, `G78`, `G184`, and the synchronized tapping
  codes), the feeds in step with the driven tool (`G36`, `G37`) and the driven-tool thread
  cycles (`G185`–`G188`) the `F` is a lead or a pitch, and it is never scaled. The `F` of
  `G76`, `G84`, `G88` and `G92` is refused and reported, because those numbers cut a thread
  or a tap on a Fanuc lathe.
- **`SB=` is not the main spindle.** It is the speed of the driven tool, switched with
  `M13`, `M14` and `M12`. Scaling spindle speeds leaves it alone and says so, unless you ask
  it to scale other spindles too.
- **`FA=` and `FB=` are feeds of their own**, the feeds after a change of the cutting
  conditions in LAP. Scaling feeds reports them and leaves them as written.
- **`G50 S` is a limit**, the highest speed a constant-cutting-speed program may reach. It
  is left alone unless you tell the script to scale the limits as well.

See [scripts.md](scripts.md) for the rest of what those scripts refuse.

**Renumbering follows the jumps.** `GOTO N100`, `IF [V1 EQ 5] N100` and a LAP call whose
shape starts at a numbered block name a block by its number, and renumbering rewrites them
under the usual rules
([transformations.md](transformations.md#jumps-and-cycles-that-point-at-a-block-number)).
A jump to a name — `GOTO NLOOP`, `G85 NLAP1` — needs nothing, because names are never
renumbered. Sequence numbers are compared as they are written, so `N0020` and `N20` are two
blocks — see [Numbers or names](transformations.md#numbers-or-names).

**Recognised, but not explained yet.** These are read and coloured correctly, and the code
help either leaves them out or marks them as not verified:

- the synchronization of two-turret machines: `M100` and the other synchronization codes are
  not described, and the `P` word only by name; the turret selection `G13`/`G14` is
  explained;
- the system variables;
- contour generation (`G101`–`G103`, `G132`/`G133`) and the pick-off spindle codes
  `G142`/`G143` (not verified); the Y-axis mode and coordinate conversion (`G136`–`G138`,
  where `X` is a radius) and the spindle selection `G140`/`G141` are explained;
- the G-code macro calls `G161`–`G171` and `G205`–`G214`: the map lists them as calls, and
  the code help has no entry for them;
- schedule programs (`.SDF`, `PSELECT`).

M-codes the database does not describe are machine functions set up by the builder; they are
never errors.

LAP, the automatic roughing and finishing along a shape (`G80`–`G88`), is explained in the
code help. The map lists the shape's sequence name, and renumbering keeps the calls pointing
at it.

**A line that starts with `$` continues the block above it** — the change of cutting
conditions of a LAP roughing call, a long `CALL`, a thread cycle whose words go on over two
lines. gEdit colours such lines, leaves them alone when renumbering, and the feed, speed and
tool-list scripts read a `$` line as part of the block above it: the lead written on the
`$` line of a `G71` block is left as written and reported like any other thread lead, and a
selection that starts on a `$` line starts inside that block. A code counts from the line
it is written on, so a thread code that stood on a `$` line below the block's `F` would not
cover that `F` — posts write the code on the first line.

**What it cannot tell apart.** A Fanuc system A program saved as `.MIN` opens as Okuma. Its
`G76`, `G84`, `G88` and `G92` blocks are protected — those numbers cut a thread or a tap on
a Fanuc lathe, so their `F` is left alone and reported — but everything else is read with
this control's meanings: a `G71 P… Q…` as a thread cycle, `M98` as the tailstock. A Fanuc
mill program saved as `.MIN` is worse off: its `G74` tapping cycle reads as an Okuma face
grooving cycle, so a feed script scales the tap's pitch. Set the dialect of such a file by
hand.

## The Sinumerik 840D turning profile

For turning programs in the control's own language, as CAM posts write them: moves, feeds
and speeds, tools by number or by name, the drilling, tapping and turning cycles, `MCALL`,
comments, labels, block skip with levels, `MSG`, subprogram calls, `R` parameters and
simple `DEF` variables.

**Comments, strings and brackets.** A comment is `;` to the end of the line. Parentheses are
**not** comments here: they hold the arguments of a call — `CYCLE83(5,0,2,-30,,-8)`,
`MSG("OD ROUGH")`, `L10(1)` — and group expressions. Text in `"` quotes is a string: a `;`
inside `MSG("A;B")` does not start a comment, and a `T` inside `MSG("T1 ROUGH")` is not a
tool change.

**Labels and names.** `LOOP_A:` at the start of a block is a label, and `GOTOF`, `GOTOB` and
`GOTO` jump to it by name. Names the program gives itself — `DEPTH` in `DEF REAL DEPTH`, a
variable called `XNOW`, a label called `NEXT_PASS` — are read as one word, never letter by
letter: `XNOW` is not an `X` word, and the hover and the cleanups treat it that way.

**Calls in the program map.** The map lists a call in every form the control knows: `L123`,
a name with arguments (`CONTOUR(1,2)`), `CALL "…"`, `PCALL/path/NAME(…)`, `EXTCALL("…")` with
its target, `ISOCALL`, and a name standing alone in its block — `SUB_PROG`, or `RAHMEN P3`
with a repeat count. A name of letters only and nothing else in the block is also how the
control's own commands are written (`DRIVE`, `CDON`), so such a name is listed only with a
repeat count, or when it has a digit or an underscore in it. A program end on a line that
also carries a label (`LOOP_END: M30`) is listed as the end, with the label in its text.

**The tool word.** The profile assumes a turret, where the `T` word changes the tool on its
own: `T3`, or `T="ROUGH_80"` where the control manages its tools by name. `T0`
deselects the tool and is not a change. `T1=5` is tool 5 for spindle 1, and `T1=0` is not a
change either. `D1` picks the cutting edge of the active tool; it is not a tool change. Which
of the two forms your post writes — a number or a name in quotes — is decided by how the
control manages its tools, not by gEdit: it reads both. A name is compared exactly as it is
written, capitals included, and a name made of digits is still a name: the tool list keeps
`T="007"` apart from tool number 7. Whether `T` alone changes the tool or a machine needs
`M6` as well is set up by the machine builder, and this profile takes the turret answer;
see [Milling on Okuma and Sinumerik](#milling-on-okuma-and-sinumerik) for the other one.

**Numbers are read as written.** In the control's own language `X50` and `X50.` are both
50 mm; there is no reading in increments, so the profile has one number reading and a
program has its values with no machine chosen
([machines.md](machines.md#sinumerik-diameter-programming-and-the-rest)). A program written
for the control's ISO mode is Fanuc-style code: read it with a Fanuc profile (set it by
hand if the status bar says Sinumerik), which has the increment readings.

**X is a diameter at the start of a program.** Diameter programming (`DIAMON`) is the
documented default of this turning profile — a decision for turning programs, not the
control's own delivery state. A program's own `DIAMON`, `DIAMOF` and `DIAM90` switch it, and
a control that starts in radius programming is told so with a machine configuration — see
[machines.md](machines.md#sinumerik-diameter-programming-and-the-rest).

**The feed type and the spindle mode are one setting.** On this control `G94`, `G95`, `G96`
and `G97` belong together: `G96` switches on the constant cutting speed **and** feed per
revolution, `G961` the constant cutting speed with feed per minute, `G97` a fixed spindle
speed with feed per revolution and `G971` one with feed per minute, and `G94` or `G95` end a
constant cutting speed. So after `G96 … G95` an `S` is revolutions per minute again, and after
`G94 … G96` an `F` is a feed per revolution. The power-on state a machine configuration can
set is therefore one feed-type code, not a feed mode and a spindle mode.

**The same numbers mean something else than on a Fanuc lathe:**

| | Fanuc lathe | Sinumerik 840D |
|---|---|---|
| `G70`, `G71` | finishing and roughing cycles | inch and millimetres; `G700`/`G710` switch the feed too |
| `G33` | thread cutting in G-code system B, the lead in `F` | thread cutting, the lead in `K` (or `I`); `SF=` is the start angle |
| `G34`, `G35` | – | a thread whose lead grows or shrinks: the lead at the start in `K` (or `I`), and `F` is the change of the lead per revolution |
| `G63` | – | one tapping block with a compensating chuck: `F` has to be the spindle speed times the pitch |
| `G96`, `G97` | the spindle mode | the feed type as well (above) |
| Dwell | `G04 X`, `U` or `P` | `G4 F` in seconds, or `G4 S` in spindle revolutions (`G4 S2=` for spindle 2) |
| Speed limit | `G50 S` or `G92 S` | `LIMS=` with `G96`; `G26 S` and `G25 S` set the upper and lower limit, and with axis words `G25`/`G26` limit the working area instead |
| Arc radius | `R` | `CR=`, or the opening angle `AR=` |
| Subprogram | `M98 P…` / `M99` | `L123` or the program's name, `M17` or `RET` to return |
| Drilling | `G83` … `G80` | `CYCLE83(…)`, made modal with `MCALL` and ended by `MCALL` alone |
| Work offsets | `G54`–`G59` | `G54`–`G57` and more, `G500` switches them off |
| Variables | `#100` | `R100`, `$` system variables, `DEF` names |

**A number in the address names the spindle.** `S3=2500` is a speed for spindle 3,
`M3=3` starts spindle 3 clockwise and `M3=5` stops it, and `SETMS(3)` makes spindle 3 the
master spindle — the one a plain `S` and `M3` are meant for — until `SETMS` on its own
returns to the master spindle the machine is set up with. The hover reads `M3=3` as `M3` for
spindle 3, not as a code `M33`.

**What the feed and speed scripts do with this dialect.** They read it from its own
database:

- the `F` of `G4` is a time, not a feed, and is never scaled; neither is its `S`, which
  counts revolutions;
- the thread lead is never scaled: not the `F` of `G34` and `G35` (the change of the lead),
  not the `F` of a `G63` block, and not in `G33`, `G331`, `G332`, `G335` or `G336`;
- `CYCLE840` stands in a block of its own and, without a spindle encoder, taps with the feed
  in force, which then is the speed times the pitch. So the `F` in force when it runs —
  wherever it was written — is left as written and reported, and so is every `F` written
  while `MCALL CYCLE840(…)` repeats the tap. Scale such a feed by hand if your call takes the
  lead from its own arguments. `CYCLE84` and `CYCLE99` do take the lead from their own
  arguments, and the feed around them is scaled like any other;
- the feeds and speeds among a cycle's arguments — the three feeds of `CYCLE95` and of
  `CYCLE952`, the tapping speed of `CYCLE84` — are listed and left, as are the chamfer and
  corner feeds `FRC=` and `FRCM=`;
- `LIMS=`, `LIMS[2]=`, `G26 S` and `G25 S` are limits, and so is every speed word of a
  `G25`/`G26` block (`G26 S3000 S2=2000`); all of them are left alone unless you tell the
  script to scale the limits as well;
- a speed for another spindle — `S3=`, `S[SPI]=` with the spindle number in a variable, or a
  plain `S` after `SETMS(3)` — is reported and left, because the script cannot tell which
  spindle is your main one; "Also scale other spindles" scales them with the rest;
- `SF=` is the start angle of a thread and no speed at all.

See [scripts.md](scripts.md) for the rest of what those scripts refuse.

**Renumbering follows the jumps that name a block.** `GOTOF N100` and `GOTOB N40` are
rewritten under the usual rules; `GOTOF LAST_CUT` needs nothing, because a label is a name
and keeps it.

**Two cleanups to be careful with:**

- **Remove Spaces** packs a program the way gEdit reads it, and whether the control reads it
  the same way is not confirmed: **do not remove the spaces from a Sinumerik program that
  goes to a machine** — see [transformations.md](transformations.md#remove-spaces).
- **Remove Comments** removes the `;$PATH=…` line that the control's transfer format uses to
  file a program in its folder; the `%_N_…` header stays. How to keep it:
  [transformations.md](transformations.md#remove-comments).

**Recognised, but not explained yet.** These are read and coloured correctly, and the code
help either leaves them out or marks them as not verified:

- the older cycles `CYCLE93` and `CYCLE97`, whose parameters the database does not describe
  yet; completion offers them, marked as not verified (`CYCLE87`–`CYCLE89` are explained).
  `CYCLE940`, `CYCLE98` and `CYCLE62` are explained, their parameters not yet;
  the pocket and slot cycles, `CYCLE800` and `CYCLE832` are coloured and listed in the
  program map as calls, with no code help at all;
- `G942` and `G952`, which the manual only lists;
- `M6` and `M19`: how a tool change is carried out and where an orientation stops are set up
  on the machine;
- synchronized actions (`WHEN … DO`) and the coordination of several channels (`WAITM`,
  `WAITE`, `SETM`);
- the lines a control's cycle screens write into a program (marked `*RO*` or `*HD*`) get no
  special treatment; CAM output does not usually contain them.

M-codes above 30 are set up by the machine builder and are never errors. Definition files
(`.GUD`, `.DEF`, `.INI`), tool data and archives are not NC programs. gEdit has no
plain-text mode: such a file opens with whichever dialect scores highest, and its colours
and code help mean nothing there.

## Milling on Okuma and Sinumerik

A milling program for either control is not covered yet, and it helps to know what happens
to one.

**A Siemens milling program usually opens as Fanuc (ISO) mill.** The Sinumerik profile
leaves every ordinary line that moves `Y` out of its score, so a program full of `X`/`Y`
moves outscores its header, its `.MPF` extension and its `T="…"` words; only a short
program stays Sinumerik. Read as Fanuc code, its `;` comments, quoted tool names and cycle
calls come out as ISO words. Set the dialect to Sinumerik by hand — gEdit remembers it for
the file. Read that way, most of it is right — comments, strings, block numbers, labels,
cycle calls and the highlighting — but three things are turning assumptions:

- **Every `T` word is a tool change.** A milling post often preselects the next tool right
  after the change (`T="DRILL_D8"` a few blocks after `M6`). The turning profile lists that
  preselection as a change of its own, and `F7` stops at it.
- **`X` is a diameter**, and the program is assumed to start in the turning plane `G18` with
  feed per revolution.
- The code help describes the codes the way a turning program uses them.

For Sinumerik, once the dialect is set by hand, a [machine configuration](machines.md)
takes you part of the way: switch off the setting that makes `X` a diameter at power-on,
and set the power-on plane to `G17` and the feed type to `G94`. The tool rule stays the
turning one.

**On Okuma it is worse, and there is no workaround.** An Okuma milling program opens with
the turning profile, because its extension decides. Okuma's machining-centre controls share
the look of the lathe language but not the meaning of its codes: a milling program opened
with the lathe profile gets lathe meanings for its G-codes — **do not trust the code help on
it**. Its tool changes are not seen either: the lathe profile reads only a four- or
six-digit `T` word as a tool change, so a shorter tool word (`T12` with `M6`) puts no tool
in the map and no stop for `F7`.

**A milling profile is a small child of the turning one.** When gEdit reads profiles from
your own folder — not in this version, see [Writing your own profile](#writing-your-own-profile)
— a milling variant of the Sinumerik profile is only a few lines: it names the turning
profile as its parent and changes the tool rule to `M6`, the axes, the diameter and the
power-on plane and feed. Something like this:

```json
{
  "id": "sinumerik-mill",
  "extends": "sinumerik",
  "name": "Sinumerik 840D (milling)",
  "shortName": "Sinumerik M",
  "machineType": "mill",
  "detect": {
    "extensions": { "mpf": 8, "spf": 8 },
    "content": [
      { "pattern": "^%_N_\\w+_(?:MPF|SPF)", "weight": 8 },
      { "pattern": "(?<![A-Z0-9_$])M0*6(?![\\d.]|\\s*=)", "weight": 5 },
      { "pattern": "(?<![A-Z0-9_$])CYCLE8\\d+[ \\t]*\\(", "weight": 4 },
      { "pattern": "(?<![A-Z0-9_$])T\\d*[ \\t]*=[ \\t]*\"", "weight": 4 },
      { "pattern": "(?<![A-Z0-9_$])G17(?![\\d.])", "weight": 3 },
      { "pattern": "(?<![A-Z0-9_$])MSG[ \\t]*\\(", "weight": 3 },
      { "pattern": "^;", "weight": 1 },
      { "pattern": "^N\\d+", "weight": 1 },
      { "pattern": "^(?:N\\d+[ \\t]*)?[GM]\\d{1,3}(?![\\d.])", "weight": 1 },
      { "pattern": "^(?:N\\d+[ \\t]*)?[XYZ][-+]?\\.?\\d", "weight": 1 }
    ]
  },
  "addresses": { "axes": ["X", "Y", "Z", "A", "B", "C"], "diameter": [], "angular": ["A", "B", "C", "AR", "SF"] },
  "toolCall": {
    "trigger": "(?<![A-Z0-9_$])M0*6(?![\\d.]|\\s*=)",
    "toolFrom": "same-line-or-last"
  },
  "modal": { "initial": { "plane": "G17", "feedmode": "G94" } },
  "machineParams": { "diameter": "off" }
}
```

Everything it does not mention — comments, strings, labels, block numbers, the number
presets, the code database, the pattern that reads the tool number out of a `T` word — it
takes from the turning profile. `M6` changes the tool, with the `T` word of the same block
or the last one before it, so a preselected tool is no longer a change. A member that is an
object, such as `addresses` or `toolCall`, is merged key by key; a list it writes replaces
the parent's whole, which is why `angular` keeps `AR` and `SF`. The `detect` rules are
restated in full for the same reason. `M6` and `G17` are what make a milling program score
higher here than with the turning profile, and the last two rules count the lines that
start with a `G`/`M` code or a move — the lines the turning profile leaves out when they
move `Y`, and the ones the Fanuc mill profile counts. They look only at the start of a
line, so a Klartext block (`12 L X+10`) does not count for them.

An Okuma milling profile needs more than that: a code database of its own, because on those
controls the same numbers mean different things. That waits for real milling programs to
write it from.

## Other controls

A program for a control gEdit has no profile for opens with whichever profile scores
highest — usually one of the Fanuc ones — which gets the text, the comments and the block
numbers right and the control-specific codes wrong. Check the dialect in the status bar
before you trust a code description on such a file.

## Writing your own profile

Not in this version. Profiles are data files inside the application, and gEdit does not
read profiles from your own folders yet. What you *can* shape today is a
[machine configuration](machines.md), which is where the settings that differ from machine
to machine belong anyway, and the script library — see [scripts.md](scripts.md). A script
always gets the profile and the code database of the document it runs on, **with the
document's machine already applied**, so it can be written against whatever dialect and
whatever G-code system is in front of it instead of assuming one.
