# Dialects

Every control reads NC code a little differently. A comment is `( ... )` on one and `;` on
another; one numbers every block and refuses a program that does not; `X10.` and `X10` are
the same value on one control and a factor of a thousand apart on the next.

gEdit keeps all of that in a **dialect profile** — one data file per control family. The
editor itself has no favourite dialect: highlighting, the program map, the cleanups, the
renumbering, the code help and the scripts all ask the profile.

A profile says how a program is **written**. How one particular control **reads** it — what
`X50` is worth, which G-code system a lathe is set to — is a separate thing, and it lives in
a [machine configuration](machines.md).

## What ships

| Profile | Status bar | For |
|---|---|---|
| **Fanuc (ISO) mill** | `Fanuc` | ISO/G-code programs for milling machines and machining centres — Fanuc and the many controls that emit the same code |
| **Fanuc (ISO) lathe** | `Fanuc T` | Turning programs for Fanuc-style lathe controls, in G-code system A or B |
| **Heidenhain Klartext** | `Heidenhain` | Klartext conversational programs (`BEGIN PGM` … `END PGM`) |

Siemens Sinumerik and Okuma OSP are planned for a later phase; until then a program for one
of those opens with whichever profile fits it best, which is usually the mill one.

## Which dialect a file gets

When you open a file, gEdit scores each profile:

1. The **extension** counts. `.nc` and `.tap` point at Fanuc, `.h` points strongly at
   Klartext.
2. The **content** of the first 400 non-empty lines counts. A leading `%`, an `O1234`
   program number or a line of `G`/`M` codes points at Fanuc; `BEGIN PGM`, `TOOL CALL`,
   `FMAX` or a block that starts with a bare number points at Klartext. Each line counts
   once, for the strongest thing it matched.
3. The highest total wins. A file that matched nothing at all — an empty file, an unknown
   extension, a plain text note — keeps the default dialect from
   `Settings ▸ Files ▸ Default dialect`.

The extension is a **hint, not a verdict**. A Klartext program that somebody saved as
`part.nc` is still recognised as Klartext, because its content says so.

**Mill or lathe** is decided in the same scoring. The two Fanuc profiles share everything
that makes a file Fanuc, so what separates them is the turning-specific content: a
four-digit `T` word, `G50 S` or `G92 S`, `G96`/`G97`, a `G71`/`G70` pair with `P` and `Q`,
`G28 U`, `U`/`W` words. A milling program is separated by `M6`, `G43 … H`, `G17` and `Y`
words. A Fanuc file that shows neither goes to the **mill**, which is the tie-break.

That is not only true of a fragment or a file of nothing but comments. A turning program
whose post writes short `T` words, absolute `X`/`Z` and no spindle-mode code at all can
show nothing that says "lathe", and it then opens as a mill: the turret tool changes do
not appear in the program map, and the `P`/`Q` of a `G70`–`G73` are not block numbers to
that profile. **Set the dialect by hand when the status bar shows the wrong one.** The
transformations know they are out of their depth there — renumbering or removing the block
numbers of such a program asks first and lists every `P`/`Q` it will not touch — and
`Tools ▸ Tool list` says to open the file with a lathe profile.

The dialect of the document is shown in the status bar. Click it to change it — the
highlighting, the code help, the program map and everything on the NC tab switch
immediately. The dialect also decides the filters in the Save As dialog and the extension
a new file is offered.

Changing the dialect changes nothing in the text.

## Which G-code system a lathe file gets

Fanuc lathes come in G-code systems A and B, and the same numbers mean different things in
each. That is a setting of the machine, not of the file, so:

- If the document has a **machine configuration** whose G-code system is set, that wins.
  Always. See [machines.md](machines.md).
- Otherwise gEdit reads the program: `G50 S2500` points at A, a `G92 S2500` or a `G77`/`G78`
  points at B. It needs a clear margin before it says so; a program with no sign either way
  reads as **A**, which is the documented default.
- Either way the status bar's machine item says what is in force, and marks it assumed when
  it was not you who said it.

If the text and your machine disagree, gEdit tells you once and changes nothing.

## What a profile decides

| | Fanuc (ISO) mill | Fanuc (ISO) lathe | Heidenhain Klartext |
|---|---|---|---|
| File extensions | `.nc` `.tap` `.cnc` `.eia` `.iso` `.min` `.ncc` `.ptp` `.txt` | the same | `.h` |
| Comments | `( ... )` | `( ... )` | `;` to the end of the line, plus text in `"` quotes |
| Block numbers | `N` in front, optional | `N` in front, optional | a plain number at the start of the block, **required** |
| Block skip | `/` before or after the number, with levels | the same | `/` after the number |
| Decimal point | significant by default — `X10` and `X10.` are different values | **not** significant by default — both are 10 mm | not significant |
| Words | may be packed together (`G0M1`) | the same | separated by spaces |
| Variables | `#100` | `#100` | `Q`, `QL`, `QR`, `QS` numbers |
| Continuation | — | — | a trailing `~` |
| Tool call | `M6`, with the `T` word on the same line or the last one before it | the `T` word alone: station plus offset, `T0100` excluded | `TOOL CALL`, on the same line |
| Axes | `X` `Y` `Z` `A` `B` `C` `U` `V` `W` | `X` `Z` `C` `Y`, with `U` and `W` as the incremental twins of `X` and `Z`, and `X`/`U` written as diameters | — |
| Program start / end | `O1234` or `:1234` / `M30`, `M2` | the same | `BEGIN PGM name` / `END PGM` |
| Renumber defaults | start 10, step 10, no padding, restart at each program start, skip `%`, `O` and comment lines | the same | consecutive from 0, step 1 |
| Jumps that point at a block number | `M99 P`, `M98 Q`, `GOTO` | `M99 P`, `M98 Q`, `G70`–`G73` `P`/`Q`, `GOTO` | none — `CALL LBL` points at a label, not at a block number |
| Code help entries | 82 codes and 25 addresses | 76 codes and 26 addresses in system A, 80 in system B | 80 codes and 34 addresses |

The decimal-point row says "by default" for the two Fanuc profiles because that one **is** a
machine setting: choosing a machine changes it, in either direction — see
[machines.md](machines.md).

The program map lists what each profile calls worth listing: for Fanuc the program number,
whole-line comments, `M0`/`M1` stops, subprogram calls and the program end; for Klartext
the `*` section headings, `;` comments, the program header, labels, subprogram calls,
`STOP` and the program end. Tool calls are in both.

## The lathe profile

Turning programs get a profile of their own. It is a child of the mill profile — the same
comments, the same block numbers, the same cleanups — and it changes the handful of things
that are genuinely different about turning.

**The tool word changes the tool.** A turret lathe has no `M6`. The profile reads a `T` word
as station plus offset: four digits are two and two (`T0101` is station 1, offset 01), three
digits are one and two (`T111` is station 1, offset 11), and one or two digits are the
station on its own. A word whose offset digits are `00` — the `T0100` in a retract block —
cancels the offset rather than changing the tool, and is left out of the program map, out of
`F7` tool-change navigation and out of the tool list.

If your posts write a short `T` word whose last digit is an offset, this rule is wrong for
your machine. It is data, so it can be corrected without a new build.

**Feed modes are `G98` and `G99`** (per minute and per revolution) in G-code system A, and
`G94`/`G95` in system B. The speed clamp is `G50 S` in A and `G92 S` in B, and `G96`/`G97`
switch constant surface speed on and off. All of this now reaches the feed and speed
tracker, so the scaling scripts read a turning program correctly.

**The multi-pass cycles point at block numbers.** `G70`–`G73` name the first and last block
of the finishing profile with `P` and `Q`, and renumbering rewrites them — see
[transformations.md](transformations.md#renumber-blocks).

**Thread leads are protected, whichever system the file is read in.** In `G32`, `G76`,
`G92` (system A) and `G33`, `G78` (system B) the `F` word is a lead rather than a feed
rate. The hover says so, and the scaling script refuses those blocks and reports them;
scaling one cuts a different thread. The refusal does not depend on gEdit having picked
the right G-code system: a `G78` is left alone in system A too, where that number means
nothing, and a `G92 … F` is left alone in system B, where it sets the coordinate system —
in both cases the results panel says the code means a threading cycle somewhere else and
asks you to check the block. The same holds for `G74`, which pecks a face on a lathe and
cuts a left-hand thread on a mill.

**A speed clamp is never raised.** `G50 S` (system A) and `G92 S` (system B) give the
highest spindle speed a `G96` program may reach. gEdit reads the `S` of either block as a
clamp in either system rather than as a speed to scale, because raising the clamp of a
constant-surface-speed program is what lets the spindle run away as the diameter falls.

**Distance is absolute unless the program says otherwise.** System A has no `G90`/`G91` pair
— those numbers are cycles there — so a system A program is read as absolute, with `U` and
`W` as the incremental words. System B has both, and gEdit does not assume which is in force
until the program names one.

**X is a diameter, and the G-code system is a machine setting.** Both of those belong to the
control rather than the file: [machines.md](machines.md).

## Other controls

Siemens Sinumerik and Okuma OSP are planned for a later phase. Until then their programs
open with whichever shipping profile scores highest — usually the Fanuc mill one — which
gets the text, the comments and the block numbers right and the control-specific codes
wrong. Check the dialect in the status bar before you trust a code description on such a
file.

## Writing your own profile

Not in this version. Profiles are data files inside the application, and gEdit does not
read profiles from your own folders yet. What you *can* shape today is a
[machine configuration](machines.md), which is where the settings that differ from machine
to machine belong anyway, and the script library — see [scripts.md](scripts.md). A script
always gets the profile and the code database of the document it runs on, **with the
document's machine already applied**, so it can be written against whatever dialect and
whatever G-code system is in front of it instead of assuming one.
