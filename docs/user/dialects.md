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
[machine configuration](machines.md). The profiles that ship are not the only ones: you can
write [profiles and code files of your own](profiles.md), which start from one of them and
change only what differs.

## What ships

| Profile | Status bar | For |
|---|---|---|
| **Fanuc (ISO) mill** | `Fanuc` | ISO/G-code programs for milling machines and machining centres — Fanuc and the many controls that emit the same code |
| **Fanuc (ISO) lathe** | `Fanuc T` | Turning programs for Fanuc-style lathe controls, in G-code system A or B |
| **Heidenhain Klartext** | `Heidenhain` | Klartext conversational programs (`BEGIN PGM` … `END PGM`) |
| **Okuma OSP lathe** | `Okuma` | Turning programs for Okuma OSP lathe controls of the OSP-P200L kind: one or two turrets, the C axis and driven tools |
| **Sinumerik 840D (turning)** | `Sinumerik` | Turning programs for Siemens Sinumerik 840D controls, written in the control's own language |
| **Sinumerik 840D (milling)** | `Sinumerik M` | Milling programs for Siemens Sinumerik 840D controls, in the same language: a tool change is `M6`, and a `T` alone only preselects the next tool |

The Okuma profile is a **turning profile**: it was written for turning programs first, on
purpose. A program for an Okuma machining centre is not covered yet — [Milling on Okuma and
Sinumerik](#milling-on-okuma-and-sinumerik) says what happens to one today. Siemens has two
profiles that share one language, one for turning and one for milling; the same section says
what the milling one decides, and [Which dialect a file gets](#which-dialect-a-file-gets)
how a Siemens program is sent to the right one.

A Siemens control can also be switched to read Fanuc-style ISO code. A program written for
that mode is Fanuc code: read it with a Fanuc profile. Its content usually takes it there by
itself, even as an `.MPF` file; if the status bar says Sinumerik, change it by hand.

## Which dialect a file gets

A dialect you picked by hand for a file wins: gEdit remembers it for that file
([Coming back where you left off](README.md#coming-back-where-you-left-off)). That holds for
a [profile of your own](profiles.md) as much as for a shipped one: it is in the list when you
click the dialect, and the choice is remembered for the file. Otherwise it scores each
profile:

1. The **extension** counts. `.nc` and `.tap` point at Fanuc, and `.cnc`, `.eia` and `.iso`
   a little less; `.h` points strongly at Klartext; `.mpf` and `.spf` point at Sinumerik.
   `.min`, `.sub` and `.ssb` point at Okuma more than any single line does — but not more
   than clear content of another dialect (see below). Any other extension, `.txt` included,
   counts for nothing.
2. The **content** of the first 400 non-empty lines counts:
   - a leading `%`, an `O1234` program number (or a `:1234` that stands alone on its line) or a
     line of `G`/`M` codes points at Fanuc. A line such as `:20 G1 X10 F100` is not a Fanuc
     program number: on Siemens it is a main block;
   - a numbered first block that opens with `BEGIN PGM` decides for Klartext on its own,
     like the two headers below; every other numbered Klartext block (`LN` included),
     `TOOL CALL` or `FMAX` points at Klartext, more weakly;
   - a `%_N_NAME_MPF` header (also when it is written as a comment, `;%_N_NAME_MPF`) or a `;$PATH=` line decides for Sinumerik on its own; short of
     that, a cycle call such as `CYCLE83(…)`, `T="…"`, `LIMS=`, `DIAMON`, `MSG(…)`, and —
     counting even on a line that moves `Y`, so a milling program is not outscored by its own
     ordinary moves — `=AC(`/`=IC(`/`=DC(`/`=ACP(`/`=ACN(`, `CR=`,
     `TRAORI`/`TRAFOOF`/`TRACYL`/`TRANSMIT`/`ORIWKS`/`ORIAXES`/`MCALL`/`SUPA`,
     `WORKPIECE(` and a bare `CYCLEnnn` point at Sinumerik. A short `%NAME_MPF` header starts
     the program for the map and the cleanups but does not decide the dialect on its own;
   - a `$NAME.MIN%` header decides for Okuma on its own, and so does a `G15 H…`/`G16 H…` or
     a `G56 H…` line without `G43`/`G44` on it — codes no Fanuc post writes, which is how an
     Okuma machining-centre program is told from a Fanuc one even without a header. Short of
     those, `CALL O…` or `MODIN O…`, `RTS` or `MODOUT`, a LAP call such as `G85 NLAP1`, a
     `G71`/`G72` with an `X` or `Z` end point and no `P` (a Fanuc `G71`/`G72` always carries
     `P`/`Q` or `U…R`), a `G77`/`G78` tap with `K`, or a line that continues its block with
     `$` and the words straight behind it (`$G84 …`) each count as much as a hundred ordinary
     lines. A `$` with a blank behind it counts for much less, because other controls write
     `$` comments (`$ ROUGH TURNING`) and must not be taken for Okuma. Further, `SB=`, `V1 =`, `IF […] N…`, a six-digit `T` word, a
     sequence name such as `NLAP1` and every numbered block (`N10 …`, a little, as on Fanuc)
     point at Okuma. A `G180`–`G189` driven-tool cycle is only a hint now, not a strong
     marker: a Fanuc lathe's own builder macros can use the same numbers.

   Each line counts once, for the strongest thing it matched.
3. The highest total wins. A file that matched nothing at all — an empty file, an unknown
   extension, a plain text note — opens with the dialect of the document you were working
   in, or, with no document open, with the default dialect from
   `Settings ▸ Files ▸ Default dialect`.

**A profile of your own is picked automatically only through rules it added itself**: a
folder it lists (every program inside it, subfolders included, is read with the profile), an
extension of its own, or content patterns of its own. What it merely inherits from the
profile it starts from does not make it a candidate, and when it and a shipped profile
score the same, the shipped one wins, whatever the priority. So a profile of yours that only changes the numbering does
not take over the programs of the profile it starts from; pick it by hand, or give it a
folder. The details, with an example, are in [When your profile is
used](profiles.md#when-your-profile-is-used).

The extension is a **hint, not a verdict**. A Klartext program that somebody saved as
`part.nc` is still recognised as Klartext, because its content says so. A Fanuc-style
program saved as `.MPF` usually opens as Fanuc too, when it has a `%` line or an `O` program
number; without them the extension can win — check the status bar.

**The Okuma extensions used to be an exception, and no longer are.** Line for line, an
Okuma turning program is Fanuc lathe code: `G00 X600 Z400`, `G96 S180 M03` and `G50 S2500`
read the same on both controls. What tells them apart is a handful of words that many
programs never use. And mistaking one for the other is not harmless: an Okuma `G71` cuts a
thread and its `F` is the lead, a Fanuc `G71` roughs a contour and its `F` is a feed — read
the wrong way, a feed script would change the pitch of the thread. A `.MIN`, `.SUB` or
`.SSB` file still weighs in Okuma's favour more than any one ordinary line can, but clear
Fanuc content now outweighs it:

- **A Fanuc program named `.MIN` opens as Fanuc again**, when its content says so (a `G74`
  mill tap, a lathe roughing cycle with `P`/`Q`). A very short `.MIN` file with little
  content of its own may still open as Okuma — check the status bar, and set the dialect by
  hand once per file if your shop names Fanuc programs this way; gEdit remembers the choice.
- **An Okuma program under another extension** — `.nc`, `.txt` or none at all — is judged
  on its content the same way. Its `$NAME.MIN%` header, or a `G15 H`/`G16 H`/`G56 H` line,
  decides on its own. Without either, what only this control writes decides: `CALL`, `RTS`,
  the driven-tool cycles, a LAP call, a `G71`/`G72` with an end point and no `P`, a `G77` tap
  with `K`, a line that starts with `$`; six-digit `T` words, `SB=`, `V` variables and named
  sequences help. A program with nothing Okuma-only in it — plain `G`/`M` codes and
  four-digit `T` words — now opens as a **Fanuc lathe program**, whatever document was open
  before it (the guesswork that used to decide a tie is gone: every code Okuma writes that
  means something else on a Fanuc lathe now has a marker of its own). Check the status bar.

A schedule program (`.SDF`) is not claimed by its extension, and on Windows and Linux the
Open dialog lists it only under All files. Its content decides: a `$NAME.SDF%` header line
decides for Okuma like the other Okuma headers.

**Mill or lathe** is decided in the same scoring. The two Fanuc profiles share everything
that makes a file Fanuc, so what separates them is the turning-specific content: a
four- or five-digit `T` word, `G50 S` or `G92 S`, `G96`/`G97`, a `G70`–`G73` block with `P`
and `Q`, a `G71`/`G72` with `U` and `R`, `G28 U`, `U`/`W` words. A milling program is
separated by `M6`, `G43 … H`, `G17` and `Y` words. A Fanuc file that shows neither goes to
the **mill**, which is the tie-break.

Two cases are decided on purpose:

- **A lathe with a Y axis.** Its milling section moves `X` and `Y` on many lines, which on any
  other program means a mill. A lathe post returns to the reference point with the
  incremental words — `G28 U0 W0`, `G30 U0. V0.` — where a mill writes `G91 G28 Z0`, so a
  reference return by `U`, `V` or `H` counts as lathe evidence, and such a program
  opens as a lathe. A return by `W` alone counts only when the block has no `G91` and no
  `P`, and not inside a `( )` comment: a boring mill's `G91 G28 W0.` or `G30 P2 W0.` is not
  lathe evidence.
- **A program of nothing but numbered blocks and `G96`/`G97`.** The Fanuc lathe and the
  Siemens turning profile read it the same way, so nothing in it decides. It opens as the
  **Fanuc lathe**, whatever document was open before it. One `;` comment, `LIMS=` or any
  other Siemens word makes it Siemens.

**Siemens milling or turning.** A file that is Siemens by its header or its words is scored
once more between the two Sinumerik profiles. The milling profile wins on what only a
milling post writes: an `M6` in a block that has no `T` number of its own (`T="DRILL_D8" M6`
counts; `T1 M6`, the Fanuc shape, does not), `CYCLE800`, `CYCLE832` and the milling cycles
(`CYCLE61`, `CYCLE64`, `CYCLE70`, `CYCLE72`, `CYCLE76`–`CYCLE79`, `CYCLE899`, `POCKET3`,
`POCKET4`, `SLOT1`, `SLOT2`, `LONGHOLE`), and a little on `G17` and `G94`. The turning profile
wins on `DIAMON`, `LIMS=`, `G96`/`G97`, `TRANSMIT`, `TRACYL` and speeds written for a numbered
spindle. A line that moves `Y` counts a little for milling and not at all for turning, so a
milling program with no header is not outscored by its own ordinary moves; a mill-turn
program moves `Y` on many lines too, and stays with turning because of its one turning word. **One turning word decides:** `DIAMON`, `DIAM90`, `LIMS=`,
`SETMS`, `TRANSMIT`, `TRACYL` or a speed or `M` code written for a numbered spindle (`S2=`,
`M2=`), outside a comment or string, sends the whole file to the turning profile, however many
milling operations it has. `G96`/`G97` alone and `DIAMOF` do not decide; a milling post that
writes `G97 S…` stays milling. A folder rule of a profile of your own still wins. A file with neither kind of evidence — a subprogram that
only moves — goes to the turning profile. Okuma has no milling partner yet: an Okuma
milling program opens with the turning profile, from its `G15 H`/`G56 H` offsets as much as
from its extension.

**Programs with no header.** A CAM post often leaves the header out, and the content then has to
decide. These shapes are read as they should be:

- **An Okuma program with no `$…MIN%` line**, only numbered blocks and modal codes, opens as
  Okuma when it carries something only this control writes: a `G13` or `G14` alone in its block
  (the turret change), an `NOEX VTLL[1]=…` block, or an `MT=`, `OS=` or `HP=` word with a whole
  number (`MT=1`; not on a `DEF` line, where Siemens declares a variable). A lone `G140` or
  `G141` helps, but less, because another control writes it too. Two things a Fanuc-style
  program writes keep it from being taken for Okuma: a `G28` with an axis word (`G28 U0 W0`;
  Okuma writes `G28` alone) and a `G15` alone in its block (Okuma's `G15` always has an `H`).
  A lathe that writes a lone `G14` and `G15` for its second spindle is therefore read as
  Fanuc. A lone `G13` or `G14` is an Okuma marker but not a certain one, so a program with it
  and none of these is read as Okuma and can be marked as a guess.
- **A Siemens milling program with no `%_N_` header** and many moves with `Y` opens as Siemens
  milling. A `Y` word counts for the milling profile; it still counts for nothing in turning,
  where a mill-turn program moves `Y` all the time.
- **A five-axis Fanuc milling program** that calls tools in blocks such as `T1205 T1310 M6` is a
  mill. A four- or five-digit `T` word in a block with `M6`, or a block with two `T` words, is
  no longer taken as turret-lathe evidence.
- **A `$` comment line** of another control (`$ ROUGH TURNING`) no longer sends the file to Okuma.

If one of these programs still lands in the wrong dialect, say so in the status bar by
choosing the right one; gEdit remembers it ([When gEdit is not sure](#when-gedit-is-not-sure)).

**If the program's own text says it is another dialect's, some cleanups refuse to run.**
Remove Comments, Renumber, Remove Block Numbers, Insert Spaces, Remove Spaces, Convert Case,
Insert and Remove Block Skip, and a script whose result replaces the program or opens as a
new one (Address arithmetic among them), all check the text
first: a header of another dialect (`BEGIN PGM`, `%_N_…_MPF`, `;$PATH=`, `$NAME.MIN%`), or a
line only that other control writes, refuses the run and names the line, the dialect it
looks like, and the current one — with a **Change Dialect…** action, or use the status-bar
dialect item, then run again. This happens even when you chose the dialect by hand: the
check reads only the text. Remove Empty Lines, Select Tool Segment, reports (Program checks and
Extents among them) and panel scripts are never refused this way, because they change no NC text a wrong dialect could corrupt.

For a Siemens program the refusal also says which of the two Sinumerik profiles the text
looks like: milling when it has an `M6`, `CYCLE800`, `CYCLE832` or a milling cycle and none
of the turning words, otherwise turning (the dialect it names is still "Sinumerik"). The two
Siemens profiles share their grammar, so neither refuses the other's program. Okuma's own
words count as evidence too: a `G15 H…` or `G16 H…` line, a `G56 H…` line without a
`G43`/`G44` on it, and `SB=`.

**The gap that stays:** a Fanuc mill program read as Okuma is refused only when it uses `#`
variables (or a Fanuc lathe `P`/`Q` cycle). Otherwise the two cannot be told apart yet —
`T1 M6`, `G43 H`, `G54` and the drilling cycles may be written by both — so Remove Comments
or Renumber would run under the wrong dialect. Check the status bar on an Okuma-looking file
that came from a Fanuc mill post, and set the dialect by hand.

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

**Save As looks again.** A file that already had a name and is saved under a different
extension — `a.nc` as `a.h` — gets its dialect detected again with the new name, the way it is
on open, and the status bar says so (`a.h now uses the Heidenhain dialect`). What keeps it from
changing: a dialect or machine you picked by hand stays with the document, and is remembered
for the new name as well; a dialect already remembered for the new name wins; an untitled
document keeps the dialect it started with; and a program whose own text says what it is
keeps its dialect under any extension. In practice only a file with nothing to say — a bare
list of moves — follows the extension.

A Fanuc lathe program is read in G-code system A or B as well. That is a setting of the
machine rather than of the file; how gEdit settles it when no machine says so is described
in [machines.md](machines.md#the-fanuc-lathe). Okuma and Sinumerik have no G-code systems to
choose between.

### When gEdit is not sure

Some programs fit none of the dialects well. They come from a control gEdit has no profile
for, for instance a conversational format with its own program start, or an old turning
control with its own cycles. gEdit still has to read them as something, so it takes the
closest dialect, and **says that it is a guess**: the dialect item in the status bar carries
a question mark, `Fanuc T?` where it would say `Fanuc T`. Hover it: *Dialect uncertain: this
program fits none of the dialects well. It is read as Fanuc (ISO) lathe, the closest guess.
Click to choose the dialect, or keep the guess.* Opening the file also writes this once in
the status line.

What the question mark means, and what it does not:

- **It means** that the best two dialects scored almost the same and that the program has
  nothing that only one control writes. The highlighting, the program map and the code help
  follow the guess, and the meaning of a code can be wrong for the real control. Read the
  hover with that in mind, and check a scaling script's result before it goes to a machine.
- **It does not block anything.** The cleanups, the scripts and the checks run as they would
  on a sure dialect. The refusal of the [cleanups on another dialect's
  text](#which-dialect-a-file-gets) is a separate thing and works as before.
- **It never appears** on a file whose dialect you chose or kept, on a file whose folder
  rule decides, on a program with a header or a code only one control writes, on a file with
  fewer than five lines of code, or on an empty file. A Fanuc mill against a Fanuc lathe, or
  Siemens turning against Siemens milling, is a question about the machine type, not about the
  control, and does not raise it either. A very short program of nothing but positioning
  blocks, with no header, can show it: it really does look like several controls.

What to do about it:

1. Click the dialect item. The list opens with *The control that wrote this program is not
   clear. Read it as…* and, first in the list, **Keep Fanuc (ISO) lathe (the guess)** (the
   name is the guessed dialect's).
2. **Keep the guess** when it is good enough for what you do with the file. gEdit remembers
   it for this file, the question mark goes away, and it does not come back when you reopen
   the file. A program that has no name yet keeps nothing: the question mark goes, but
   nothing is remembered.
3. **Pick another dialect** when you know the control. That is remembered too, and the
   question mark goes away.
4. Close the list without a choice and nothing changes.

*Save As* looks at the program again, so a file saved under another name can show the
question mark or lose it.

## What a profile decides

| | Fanuc (ISO) mill | Fanuc (ISO) lathe | Heidenhain Klartext |
|---|---|---|---|
| File extensions | `.nc` `.tap` `.cnc` `.eia` `.iso` `.ncc` `.ptp` `.txt` | the same | `.h` |
| Comments | `( ... )` | `( ... )` | `;` to the end of the line. Text in `"` quotes is a string — a tool name, say — not a comment |
| Block numbers | `N` in front, optional | `N` in front, optional | a plain number at the start of the block, **required** |
| Block skip | `/` before or after the number, with levels | the same | `/` before or after the number |
| Decimal point | significant by default — `X10` and `X10.` are different values | **not** significant by default — both are 10 mm | not significant; a value may be written with a comma too (`X241,781`), which gEdit reads and writes back the same way |
| Words | may be packed together (`G0M1`) | the same | separated by spaces |
| Variables | `#100` | `#100` | `Q`, `QL`, `QR`, `QS` numbers |
| Continuation | — | — | a trailing `~` |
| Tool call | `M6`, with the `T` word on the same line or the last one before it | the `T` word alone: station plus offset (the digit split is a machine choice), `T0100` excluded | `TOOL CALL`, on the same line |
| Axes | `X` `Y` `Z` `A` `B` `C` `U` `V` `W` | `X` `Z` `C` `Y`, with `U` and `W` as the incremental twins of `X` and `Z` by default (a machine can turn that off or add `V` and `H`), and `X`/`U` written as diameters | `X` `Y` `Z` `A` `B` `C` `U` `V` `W`; an `I` in front makes the value incremental (`IX+10`) |
| Program start / end | `O1234`, `:1234`, or a name in `<angle brackets>` / `M30`, `M2` | the same | `BEGIN PGM name` / `END PGM` |
| Renumber defaults | start 10, step 10, no padding, at most 99999 and then starting over, restart at each program start, skip `%`, `O` and comment lines | the same | consecutive from 0, step 1 |
| Jumps that point at a block number | `M98 Q`, `GOTO`; `M99 P` and the `P`/`Q` of `G70`–`G73` are listed, never rewritten | `M98 Q`, `G70`–`G73` `P`/`Q`, `GOTO`; `M99 P` is listed, never rewritten | none — `CALL LBL` points at a label, not at a block number |
| Code help entries | 140 codes (7 not verified yet) and 25 addresses | 138 codes (10 not verified yet) and 26 addresses in system A, 140 codes (7 not verified yet) in system B | 114 codes (1 not verified yet) and 34 addresses |

And the profiles of the other two controls (the Sinumerik milling profile has the same
columns as the turning one, with the differences in
[Milling on Okuma and Sinumerik](#milling-on-okuma-and-sinumerik)):

| | Okuma OSP lathe | Sinumerik 840D (turning) |
|---|---|---|
| File extensions | `.min` `.sub` `.ssb` — they decide the dialect on their own | `.mpf` `.spf` |
| Comments | `( ... )` | `;` to the end of the line. Text in `"` quotes is a string, not a comment, and a `;` inside it is just a character |
| Block numbers | `N` in front, optional: up to four digits, or a **name** that starts with a letter (`NLAP1`). A space has to follow it | `N` in front, optional, or a **main block** number `:20`. A label `NAME:` at the start of a block is a jump target of its own |
| Block skip | `/` at the very start of the block or directly after the sequence number, no levels | `/`, or `/0` to `/9` with a level, in front of the block |
| Decimal point | **never** significant: the machine's unit system scales every number, with a point or without — see [machines.md](machines.md#okuma-the-unit-system-scales-every-number) | not significant: `X10` and `X10.` are both 10 mm. The control's own language has no reading in increments, so no machine changes that |
| Words | separated by spaces in the manual's own examples; gEdit also reads them packed | separated by spaces; packed single-letter words (`G1X10`) are read too |
| Variables | `V1`…, system variables such as `VZOFZ`, and names of the program's own (`DIA1`) | `R1`…, `$` system variables (`$AA_IM[X]`), `DEF` variables and other names |
| Continuation | a line that starts with `$` continues the block above it | — |
| Tool call | the `T` word alone: four digits (station, offset) or six (nose-radius set, station, offset), with three-digit offsets as a machine choice; not a `T` inside a cycle block, not station `00` | every `T` word except `T0`: `T3`, `T="NAME"`, `T1=5` for spindle 1; never a `T` inside a string |
| Axes | `X` `Z` `C` `Y`; `X` is a diameter, in incremental mode too. `U` and `W` are finish allowances, not incremental moves | `X` `Z` `C` `Y`; `X` is a diameter while diameter programming is on, which is how a program is assumed to start |
| Program start / end | `O` plus up to four letters or digits, on a line of its own / `M02`, `M30`, and `RTS` for a subprogram | the `%_N_NAME_MPF` or `%NAME_MPF` header or `PROC name` / `M30`, `M2`, and `M17` or `RET` for a subprogram |
| Renumber defaults | start 10, step 10, no padding, at most 9999 and then it stops, restart at each `O` program, skip `$`, `%`, `O` and comment lines; a name such as `NLAP1` is never renumbered | start 10, step 10, no padding, at most 2147483647 (the control's limit) and then it stops (the control wants every number once), restart at each program start, skip `%`, `;`, `PROC`, `DEF` and `EXTERN` lines; a label is never renumbered |
| Jumps that point at a block number | `GOTO N…`, `IF […] N…`, and a LAP call (`G85`–`G88`) whose shape starts at a numbered block | `GOTOF`, `GOTOB`, `GOTO` and `GOTOC` followed by `N…` or by a main block `:20`; a jump to a label goes by its name |
| Code help entries | 164 codes (6 not verified yet) and 28 addresses | 203 codes (6 not verified yet) and 20 addresses, for turning and milling alike |

The extensions row is what the Open and Save As dialogs list for each dialect on Windows
and Linux; which of them count in detection is under
[Which dialect a file gets](#which-dialect-a-file-gets). The renumber defaults are what the
Renumber dialog offers the first time. After that it opens with what you used last,
whatever the dialect — see [transformations.md](transformations.md#renumber-blocks).

"Not verified yet" means the project wrote the entry but has not been able to check it
against the control's own documentation: the hover leaves it out and the completion list
marks it (see [Code help](README.md#code-help)). On Okuma that is six entries: `G36`/`G37`,
whose format no manual gives, `G107`/`G108`, and `G142`/`G143`, which only an older code
table names; on Sinumerik it is five: `CYCLE93`, `CYCLE97`, `G942`, `G952` and `M19` (`M6`
is the tool change that loads the tool selected with `T`); on Klartext there is none: `M89`
is the modal cycle call, which calls the cycle defined last after every positioning block
until `M99` or the next cycle definition.

The decimal-point row says "by default" for the two Fanuc profiles because there it **is** a
machine setting: choosing a machine changes it, in either direction. On Sinumerik it is
not — the control's own language reads every number as written. On Okuma the point never
changes a value, but the machine's unit system decides what every number is worth — see
[machines.md](machines.md#okuma-the-unit-system-scales-every-number). On Klartext, a value
may be written with a decimal comma instead of the point — the owner's published CAM output
mostly does — and gEdit reads either one; a value keeps whichever mark it was written with
when a script rewrites it.

**Typing.** Every shipped profile also decides two things about how the editor behaves while
you type, and they are the same on all six: letters typed in code are made upper case (a
comment, a string and free text are left as typed), and a key press that would run two
blocks together is refused. See [Typing](README.md#typing-forced-upper-case-and-no-accidental-joins);
a profile of your own can change either one.

The program map lists what each profile calls worth listing:

- for **Fanuc**, the program number, whole-line comments, `M0`/`M1` stops, subprogram calls
  and the program end;
- for **Klartext**, the `*` section headings, `;` comments, the program header, labels,
  subprogram calls, `STOP` and the program end;
- for **Okuma**, the `O` program names, the operation comments (a whole-line comment, or a
  sequence number with nothing but a comment behind it, as in `N2 (CENTRE DRILL)`), named
  sequences such as `NLAP1`, `CALL O…` and `MODIN O…`, the G-code macro calls (`G161`–`G176`,
  `G205`–`G214`), `M00`/`M01` stops and the ends (`M02`, `M30`, `RTS`). A line lists one
  item, and a named block that ends the program (`NEND M02`) is listed as the end, with
  the name in its text;
- for **Sinumerik**, the `%_N_…` header and `PROC`, labels, whole-line `;` comments (lines of
  `-`, `*`, `=` or `_` left out), the text of every `MSG("…")`, subprogram and cycle calls,
  `M0`/`M1` stops and the ends (`M30`, `M2`, `M17`, `RET`).

Tool calls are in all of them.

**A Fanuc program can be named instead of numbered.** `<PARTS_1>` in angle brackets, at the
start of a program or right after `M98`, `G65`, `G66`, `G66.1`, `M96`, `G72.1` or `G72.2`, is
read as one name — up to 32 letters, digits, `-`, `+`, `_` and `.` — never letter by letter.
It starts the program the way `O1234` does, `M98 <PARTS_1>` calls it, the map shows the name
as written, and the cleanups and scripts leave its letters and digits alone: scale feed does
not rewrite an `F12` inside `<CHAMFER_F12>`, and on the lathe a name holding `T12` is not a
tool change. Convert Case still changes a name's letters, so a shop whose names are
case-sensitive should leave one alone rather than run it through that cleanup.

**Words that are not axis words.** What the editor reads as one word, not letter by letter:
the Fanuc macro functions and print commands (`FIX[#2]`, `SQRT[…]`, `POPEN`, `DPRNT[…]`) are
keywords, and no `X` hides in `FIX`; on Klartext the `PLANE` forms and their words (`TURN`,
`STAY`, `MB MAX`, `SEQ+`), the `FUNCTION TCPM` words (`F TCP`, `AXIS POS`, `PATHCTRL AXIS`)
and `REFPNT TIP-TIP` are keywords too. The Fanuc `;` is the end-of-block character and not an
unknown mark. A block can carry several block-skip marks (`/1 /3`); each is read as a mark. Renumber keeps every skip level in its place: `/1/2 N20` stays `/1/2 N110`.

## The Fanuc (ISO) lathe profile

Fanuc-style turning programs get a profile of their own. It is a child of the mill profile —
the same comments, the same block numbers, the same cleanups — and it changes the handful
of things that are genuinely different about turning.

**The tool word changes the tool.** A turret lathe has no `M6`. The profile reads a `T` word
as station plus offset, and with no machine chosen the length of the word decides:

| Digits | Read as | Example |
|---|---|---|
| one or two | the station on its own | `T1`, `T12` |
| three or four | station, then a two-digit offset | `T101` is station 1, offset 01; `T0101` is station 1, offset 01 |
| five | a two-digit station, then a three-digit offset (2 + 3) | `T12012` is station 12, offset 012; `T21000` is station 21 |

A word whose offset digits are all zero — the `T0100` in a retract block, the `T12000` of a
five-digit post — cancels the offset rather than changing the tool, and is left out of the
program map, out of `F7` tool-change navigation and out of the tool list. There are two
exceptions that hold on every reading. **A zero offset next to `M6` is a tool change**: on a
mill-turn, `M06 T21000` loads tool 21 into the milling spindle. And **a block with a
three-digit `G` code has no tool change**: in `G183 Z-5. T5 F20` the `T` is a parameter of the
builder's cycle, not a tool. The control's own three-digit codes (`G107`, `G112`, `G113`,
`G250`, `G251`, the aliases of `G07.1`, `G12.1`, `G13.1`, `G50.2` and `G51.2`) are not builder
cycles: in `G112 T0101` the `T` is still a tool change. A `T` word of six or more digits satisfies none of these forms
and is left as it is. A word whose tool part is all zeros (`T00100`, `T0001`; under the 2 + 3
setting also `T0101`) keeps the tool and changes only the offset: it is no tool change on any
setting.

The split into station and offset is a setting of the machine's tool offset memory, so it
is a **machine choice**, *Tool word: offset digits* ([machines.md](machines.md#the-fanuc-lathe)).
The default is the reading by length shown above, marked "verify": the project has no manual
that settles it for every post. A machine can instead read always the last two digits as the
offset (`T12345` is tool 123, offset 45: "3 + 2"), the last three (`T01001` is tool 1,
"2 + 3"), or the last digit alone (`T12` is station 1, offset 2).

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
until the program names one. Whether `U` and `W` move incrementally on your machine, and
whether `V` and `H` do too on a lathe with a Y axis, is a machine choice as well
([machines.md](machines.md#the-fanuc-lathe)); by default `U` and `W` do.

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

That is the split for two-digit offsets, which a lathe with up to 99 offsets has. A machine
with 200 or more offsets writes the offset with three digits, and `T2000` is then station 2,
not tool 20: choose *Three-digit offsets* in the machine's *Tool word* setting
([machines.md](machines.md#okuma-the-unit-system-scales-every-number)). Under that reading a
word has three, four, five or seven digits (`T100`, `T2000`, `T12345`, `T0102003`); a
six-digit word fits neither split and is not read as a tool change.

On a two-turret machine the program map, `F7` and the tool list do not tell the turrets
apart: `T0101` after `G13` and after `G14` are both station 1, and the tool list gives them
one row.

**Option words.** A word with a two-letter address in front of `=` that the control defines
itself — `TL=2`, `CL=`, `CP=` — is an address and is coloured like one. Any other name in
front of an `=` is a local variable of the program (`DIA1=50`), and the hover says so.
Option M codes have four digits (`M1292`).

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
| `G20`, `G21` | inch and metric | a home-position return and the return for a tool change; the position is the machine's own (`HP=` says which), so gEdit treats the block as a move to machine positions |
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
- **`G84` and `G88` also leave the spindle speed**, like their feed: on the machining
  centres these lathe numbers are a tapping cycle, and the pitch ties the speed to the feed
  there too. Scaling spindle speeds reports and leaves the speed of such a block, and the
  speed in force when it runs, the same way scaling feeds already left its `F`.

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
- the pick-off spindle codes `G142`/`G143` (not verified); the contour codes
  `G101`–`G103` and the contour arcs on the cylinder surface `G132`/`G133` are explained and
  their `F` is a feed per minute whatever the feed mode; the Y-axis mode and coordinate conversion (`G136`–`G138`, where `X`
  is a radius), the spindle selection `G140`/`G141` and the program coordinate systems
  `G15`/`G16` are explained;
- the G-code macro calls `G171`–`G176` and `G205`–`G214`: the map lists them as calls, and the
  code help has no entry for them (`G161`–`G170` are explained);
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

**Main blocks and indexed words.** A colon and a number at the start of a block, `:20 G1 X10`,
is a main block number. To the highlighting, Renumber and the jumps it is a block number
(`GOTOF :20` is a jump to it), and the colon stays when it is renumbered. A word with an
index, `S[2]=500`, `LIMS[2]=1800` or `M[2]=5`, is one word whose index is the spindle: it is
never the main spindle's speed, a clamp of the main spindle or an `M` code. `1.5EX3` is one
number.

**Calls in the program map.** The map lists a call in every form the control knows: `L123`,
a name with arguments (`CONTOUR(1,2)`), `CALL "…"`, `PCALL/path/NAME(…)`, `EXTCALL("…")` with
its target, `ISOCALL`, and a name standing alone in its block — `SUB_PROG`, or `RAHMEN P3`
with a repeat count. The control's own commands are not calls and are left out: `CUT3DCC`,
`ORIVIRT1`, and the procedures `ORIRESET(…)`, `FGROUP(…)`, `WAITS(…)`, `INIT(…)` and
`START(…)`. In the code itself a name that stands alone in its block — a bare `CYCLE800` or
`HOME`, behind at most a block number and a label — is read as a call without arguments
(`CYCLE800` alone is the same as `CYCLE800()`, which ends the swivel); a name among other
words (`G2 X10 Y10 CR15`) stays an unknown mark. A name of letters only and nothing else in the block is also how the
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
the milling profile takes the other one, see [Milling on Okuma and
Sinumerik](#milling-on-okuma-and-sinumerik).

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
spindle 3, not as a code `M33`. **gEdit's main spindle is spindle 1**: a plain `S` while
spindle 1 is the master (the default, `SETMS`, or `SETMS(1)`), and `S1=`, are the main
spindle's speed, in the tool list as well as in the feed and speed scripts; `S2=` and a plain
`S` after `SETMS(2)` are another spindle. If a program makes another spindle the default
master before gEdit reads it, tell the project.

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
- `SVC=` and `SVC[n]=` are the tool's cutting speed on the master spindle, or on the
  spindle the index names, and follow "Also scale constant surface speeds" the same way a
  plain `S` under `G96` does;
- a speed for another spindle — `S2=`, `S[SPI]=` with the spindle number in a variable, or a
  plain `S` after `SETMS(2)` — is reported and left, because gEdit's main spindle is
  spindle 1 (above) and the script cannot tell which spindle is yours if it differs;
  "Also scale other spindles" scales them with the rest;
- `SF=` is the start angle of a thread and no speed at all.

See [scripts.md](scripts.md) for the rest of what those scripts refuse.

**Renumbering follows the jumps that name a block.** `GOTOF N100` and `GOTOB N40` are
rewritten under the usual rules; `GOTOF LAST_CUT` needs nothing, because a label is a name
and keeps it. `GOTOF:20` and `GOTOB:20`, written without a blank, are followed like `GOTOF :20`: the number behind the colon is rewritten in place, and Remove Block Numbers keeps the `:20` such a jump names.

**Two cleanups to be careful with:**

- **Remove Spaces** is not offered on Sinumerik: names, keywords and addresses of more than
  one letter need their spaces — see [transformations.md](transformations.md#remove-spaces).
- **Remove Comments** keeps the `;$PATH=…` line that the control's transfer format uses to
  file a program in its folder, with the `%_N_…` header, and lists it as kept
  ([transformations.md](transformations.md#remove-comments)).

**Recognised, but not explained yet.** These are read and coloured correctly, and the code
help either leaves them out or marks them as not verified:

- the older cycles `CYCLE93` and `CYCLE97`, whose parameters the database does not describe
  yet; completion offers them, marked as not verified (`CYCLE87`–`CYCLE89` are explained).
  `CYCLE940`, `CYCLE98` and `CYCLE62` are explained, their parameters not yet;
  the pocket, slot and other milling cycles (`CYCLE61`, `POCKET3`, `SLOT1` …) are coloured and
  listed in the program map as calls, with no code help at all (`CYCLE800` and `CYCLE832`
  are explained);
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

**Sinumerik has a milling profile**, *Sinumerik 840D (milling)*, `Sinumerik M` in the status
bar. It is a small child of the turning one: the same comments, strings, block numbers,
labels, cycle calls and highlighting, and the same code database, because it is one Siemens
language on both kinds of machine. It changes what is different about a milling machine:

- **`M6` is the tool change** unless the machine says otherwise. The tool is the `T` word in
  the same block or the last one written before it, in any of the forms the turning profile
  reads (`T3`, `T="DRILL_D8"`, `T1=5`). A `T` word on its own **only preselects** the next
  tool: the program map, `F7` and the tool list show one entry per tool, where the turning
  profile showed a second one for every preselect. `T0`, `T=0` and `T0 M6` put the tool away
  and are no change. The manual leaves the kind of tool change to the machine builder, so
  some milling machines change the tool by `T` alone, with no `M6`. For those, the machine
  has a choice, *Tool change*: [machines.md](machines.md#sinumerik-diameter-programming-and-the-rest).
  A program that never writes `M6` but selects tools with a lone `T` is read that way even
  with no machine.
- **The program starts in the plane `G17` with feed per minute `G94`**, where the turning
  profile starts in `G18` with feed per revolution. Both are machine settings, and a machine
  configuration corrects them ([machines.md](machines.md#sinumerik-diameter-programming-and-the-rest)).
- **`X` is a radius.** Diameter programming is off at the start, and a program's own
  `DIAMON` still switches it on. The Machines page offers the same diameter setting as for
  turning, defaulting to off.
- **Nothing else changes.** Comments, strings, labels, main blocks, the number reading
  ("as written"), the cleanups and the scripts work as described for the turning profile.

On the published drilling program, five tools are five entries in the map and five rows in the
tool list, each with its own feed and speed; the turning profile gave nine map entries, and
the tool list moved every tool's feed and speed one row down.

**What the code help covers.** The database describes what CAM writes for five-axis and
high-speed milling: `CYCLE800` (swivel), `CYCLE832` (high-speed settings), `TRAORI` and
`TRAFOOF`, `TRANSMIT`, `TRACYL`, `G75` (a fixed-point approach), the `ORI…` orientation words
and the `DYN…` dynamic words, `TRANS`, `ROT`, `SCALE` and `MIRROR` and their additive forms.
It does not describe the milling cycles themselves (`CYCLE61`, `POCKET3` …), `CUT3DCC`,
`COMPSURF`, `G601`–`G603`, `G643`/`G644` or the tolerance words `CTOL=`, `OTOL=` and `FP=`:
those are coloured and listed as calls and have no code help. The profile lists `A`, `B` and
`C` as axes and as angles, so the scripts read the rotary axes of a five-axis machine in
degrees. `TRAORI` is tool centre point control and not a coordinate frame; `TRAFOOF` ends it
and `TRANSMIT`, `TRACYL` and `TRAANG` too; `CYCLE800` is a tilted plane, which is a frame.
The profile's `M6` entry is not verified yet, so its hover says the database does not
describe it.

**A mill-turn program stays with the turning profile.** A lathe with a driven tool and a
`Y` axis writes `TRANSMIT`, `TRACYL`, `LIMS=` or `G96`, and a Siemens file is sent to turning
on those words, its `M6` tool changes and `Y` moves included. If you want the milling rules for one
such program, set the dialect by hand.

**Okuma has no milling profile.** An Okuma milling program opens with the turning profile —
from its `G15 H`/`G16 H`/`G56 H` offsets as much as from its extension, so at least it is read
as Okuma rather than as a Fanuc lathe program. Okuma's machining-centre controls share the
look of the lathe language but not the meaning of its codes: a milling program opened with
the lathe profile gets lathe meanings for its G-codes — **do not trust the code help on
it**. Its tool changes are seen correctly (a four-, five- or six-digit `T` word all show),
but the lathe's tool-station reading is still what shows, not a machining-centre one. An Okuma
milling profile needs a code database of its own, because on those controls the same numbers
mean different things. That waits for real milling programs and the control's programming
manual to write it from.

## Names, texts and keywords that are read as such

A program is full of words that are not codes: the name of a cycle, the name of a program, a
label, a variable, a message. gEdit used to colour many of them as unknown marks. These are
read correctly now:

**Heidenhain Klartext.**

- The name of a cycle (`CYCL DEF 207 RIGID TAPPING`), the name after `BEGIN PGM` and `END PGM`,
  the path after `CALL PGM`, and the text of `FN 16:` are **text**. They are coloured as
  text, have no hover and are not counted as unknown. Convert Case leaves them alone: a
  program named `Test` keeps `Test`.
- The colon words `VCONST`, `VC` and `HSC-MODE` are known: `FUNCTION TURNDATA SPIN
  VCONST:ON VC:120` and `CYCL DEF 32.2 HSC-MODE:1 TA0.5` raise no unknown marks.
- A `%` in a comment (`; INPUT 50...150 %`) is a percent sign. Klartext has no tape marker,
  so the program check *Tape marker* does not report it.
- An empty `CYCL DEF 19.1`, the one that names no angle, **ends the tilt**, like `19.1` with
  every angle at zero. The control resets the plane this way: the program writes `19.0`
  and a `19.1` with no angle, and the tilt is gone. A `19.0` alone changes nothing.
  Address arithmetic and the extents stop treating the rest of the program as tilted.

```
12 CYCL DEF 19.0 WORKING PLANE
13 CYCL DEF 19.1 B+30
14 L Z+100 R0 FMAX         ; tilted by 30 degrees
15 CYCL DEF 19.0 WORKING PLANE
16 CYCL DEF 19.1            ; no angle: the tilt ends here
17 L Z+100 R0 FMAX         ; not tilted
```

**Siemens.**

- The target of a jump (`GOTOF SKIPSIM`, `GOTOB LOOP_A`, `GOTO NEXT_PASS`) is a **label**.
  The name behind `DEF` (`DEF INT COUNTER`, `DEF REAL DEPTH, XNOW`) is a **variable**.
  Neither is an unknown mark. `GOTOF "STEP_"<<COUNTER` builds its target while the
  program runs: the program check *Jump target* does not judge it.
- `SBLOF`, `SBLON`, `DISPLOF` and `DISPLON` (single-block and display control) and
  `NORM`, `KONT`, `KONTC` and `KONTT` (the approach and retract behaviour of tool radius
  compensation, as in `G1 G41 NORM X10 Y10`) are **keywords**, not calls.
- A header written as a comment, `;%_N_SHAFT_12_MPF`, starts the program in the program map.

**Okuma.**

- `CALL OABCD` names a program, whether the name is letters or digits.
- `VTLL` and `VTLD` (the tool length and diameter variables) are variables, as in
  `NOEX VTLL[1]=50 VTLD[1]=8`.
- `NOEX` at the start of a block is a command, no longer a sequence name (`OEX`), and two such
  blocks no longer raise *the label is defined twice*. `DRAW` and `CLEAR` are commands.

**Fanuc.** Words of free text outside parentheses, such as a message a post writes in the
program (`M797 SPINDLE ONE DONE`), are read as **one** unknown piece after the code, not as
a row of `S`, `P`, `I` words. They are still unknown: the program map and the cleanups do not
treat them as codes, and the *Words in a block* check no longer sees tool words in them.

What is still not read as a name, and shows as unknown: the machine data words of a Sinumerik
(`GUD` qualifiers, `AA<n>`, `_N<n>`), `WORK`, `PS` and `LC` on Okuma, and the text behind
`//` on Siemens.

## What the checks and the arithmetic read from a dialect

The program checks, the extents and address arithmetic ([Scripts](scripts.md)) have no
list of codes of their own: they read the code database and the profile of the dialect. What
the dialects give them:

| | |
|---|---|
| **Fanuc mill** | Which codes start and stop the spindle and which moves are rapid; the states the control refuses a code in (`G28`, `G53`, the drilling cycles and `G68` under tool centre point control; `G53.1` outside a tilted plane); `G65` as a program call that hands its arguments over, and a word limit of eight digits. `G15` and `G16` (polar coordinates) are described and count as a frame, like `G51` (scaling), `G51.1` (mirror), `G12.1` (polar interpolation), `G7.1` (cylindrical interpolation) and `G68` (rotation). The drilling cycles `G73`, `G74`, `G76`, `G81` to `G89` carry the `R` plane that a Z shift moves |
| **Fanuc lathe** | The same, except that it has no `G43.4` or `G43.5`; its cycles are not shifted by address arithmetic (a lathe's `R` may be incremental or absolute by a machine parameter), they are refused and listed |
| **Heidenhain Klartext** | Cycles 200 to 209, 240 and 262 hold `Q203`, the surface, which a Z shift moves; **202** (boring), **208** (bore milling) and **262** (thread milling) are described. The pole `CC` is shifted with an `X` or `Y` shift. `PLANE` needs `MOVE`, `TURN` or `STAY`, and `TOOL CALL` and `M91`/`M92` are refused while `M128` is on. The tool axis comes from `TOOL CALL`, which decides the plane. `END PGM` is the closing record and takes no skip mark. Cycle 19 and `PLANE SPATIAL` with all angles zero never end the tilted plane for the scripts, so everything after one is treated as inside a frame |
| **Okuma OSP lathe** | A limit of eight M codes in a block; `G96` and `G97` need `S`; `M110` stands alone; `G140`, `G141`, `G15` and `G16` are refused under constant surface speed or nose-radius compensation; the LAP shape between `G81` and `G80` is not a cut. No cycle is shifted by address arithmetic |
| **Sinumerik 840D** | `CYCLE81` to `CYCLE89` and `CYCLE840` carry `RTP`, `RFP`, `DP` (and `FDEP` of `CYCLE83`) for a Z shift, with the trailing mode arguments described; `G290` and `G291` switch the control between its own language and ISO mode; `G75` is refused under radius compensation. A program that never writes `G90` is not known to be absolute (see [Machines](machines.md#the-power-on-distance-mode)) |

Where the data is missing the scripts say so, once, and do not flag every line: a code the
database lacks under the move letter makes a block "not reviewed" for the arithmetic and
"not resolved" for the extents.

## Other controls

A program for a control gEdit has no profile for opens with whichever profile scores
highest — usually one of the Fanuc ones — which gets the text, the comments and the block
numbers right and the control-specific codes wrong. Check the dialect in the status bar
before you trust a code description on such a file.

## Writing your own profile

You can write profiles and code files of your own: a profile for the programs of one
machine or one folder (their numbering step, the files they come in, the way you want typing
to behave), and a code file with the M codes your machine builder added. They live in two
folders next to the settings, are managed on `Settings ▸ Profiles`, and are laid over the
profile they start from, so a file is usually a few lines. Everything about them, with an
example profile, an example M-code table and the rules that decide when a profile of yours
is used, is on its own page: [Your own profiles and code files](profiles.md).

What differs from machine to machine in how a control *reads* a program belongs in a
[machine configuration](machines.md) instead, not in a profile
([which is which](profiles.md#profile-or-machine)). The script library is the third
way to shape gEdit — see [scripts.md](scripts.md). A script always gets the profile and the
code database of the document it runs on, **with the document's machine already applied**,
so it can be written against whatever dialect and whatever G-code system is in front of it
instead of assuming one. That includes a profile of yours.
