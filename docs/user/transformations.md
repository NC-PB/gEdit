# Transformations

The **NC** tab holds the changes you make to a whole program rather than to one line:
renumbering it, unpacking or packing it, throwing out empty lines or comments, fixing
the case, and marking lines to be skipped. It also selects the lines of one tool. They are
built into the editor, so they work whether or not Python is installed. Feeds, speeds, tool
lists, program checks, extents and arithmetic on address values are done by scripts instead
— see [Scripts](scripts.md).

## Four rules that hold for all of them

**1. Selection or program.** With text selected, the transformation runs on the selected
lines; with nothing selected, on the whole program. A selection is always extended to
whole lines — half a block is not a block. With several cursors only the main selection
counts, and a selection that ends at the very start of a line does not take that line.

The scope is taken **when you pick the command**, before any options dialog opens. A click
in the dialog can never quietly widen a run to the whole program.

**2. One undo step.** However many lines a run changed, one `Cmd/Ctrl+Z` puts the program
back exactly as it was. Only the lines that actually differ are rewritten, so bookmarks
and folded sections outside the change survive. On a big run — a thousand or more changed
lines, such as renumbering a long program or removing the comments of a big CAM file — the
change is applied in one piece, and bookmarks and folds between the first and the last
changed line can move.

**3. It tells you what it did, and what it did not do.** The status bar gets a one-line
summary ("Renumbered 412 blocks"). Anything the run refused to touch goes to the
**Results** panel with the line number and the reason; click a row to jump there. A run
with nothing to report clears its own previous report.

When there is something to report, the panel opens by itself. Its heading repeats the
summary and adds what is worth knowing — how many jumps were rewritten, that the numbering
started over. Each row gives the line, a severity and the reason: **Info** for a line left
alone on purpose (a program marker, a skipped prefix, a kept comment, a number kept because
a jump points at it), **Warning** for one to check before the program goes to the machine.
Renumber Blocks and Remove Block Numbers list at most 200 rows and say how many there
were. **Copy CSV** and **Open as text** take the table elsewhere. Closing the program
clears its report.

**4. It asks before it does something you may not want.** A transformation that would
leave a jump pointing at the wrong block or delete its target, renumber only part of a
Klartext program, or write lower case for a control that reads only upper case, asks first
and lets you say no. Remove Empty Lines and Remove Comments, which can leave gaps in
Klartext's block numbers, say so afterwards and offer to renumber. That offer always
renumbers the whole program; after a run on a selection it says so and clears the
selection first.

**The options are remembered.** Every dialog on this tab opens with the answers you last
gave for that dialect, also after a restart. The first time in each dialect they come from
the dialect.

**A locked program is refused.** On a read-only document every command on this tab stops
before it asks anything, and the status bar says which lock is on and how to lift it.
Unlock on purpose, or work on a copy.

Behind all of this, gEdit reads each line the way the active dialect's control does: it
knows what is a comment, a string, a variable, an expression and a keyword, so a `G1`
inside `(FINISH G1 PASS)` is a comment and stays a comment. Where a rewrite is not provably
safe, the line is left as written and listed in Results rather than changed and hoped for.

---

## Numbering

### Renumber Blocks…

Writes a fresh set of block numbers. The dialog opens with your last answers for the
dialect, so an Okuma program never gets the Fanuc answers. The defaults are the ones of
the first run in a dialect:

| Option | What it does |
|---|---|
| **Start at** | The number the first block gets (default 10) |
| **Increment** | The step between blocks (default 10) |
| **Digits** | Pad with leading zeros to this width; 0 writes the number as short as it is. On a control with a hard limit, at most as many digits as its highest block number (Okuma: 4, Sinumerik: 10) |
| **Maximum** | Leave empty for no maximum (default 99999 on Fanuc). On Okuma and Sinumerik it is required and at most the highest block number the control accepts: 9999 on Okuma, 2147483647 on Sinumerik (a whole number there, so real 5-axis posts that number past N3,700,000 still fit) |
| **Above the maximum** | Start over at the start value, or stop and warn (Okuma and Sinumerik: stop by default) |
| **Spaces after the number** | Between `N120` and the rest of the block |
| **Skip lines starting with** | Separated by spaces. Fanuc skips `%`, `O` and `(`; Okuma `$`, `%`, `O` and `(`; Sinumerik `%`, `;`, `PROC`, `DEF` and `EXTERN`. A program marker (`%`, `O1001`, Okuma's `$NAME.MIN%`, Sinumerik's `%_N_…`) is never numbered, whatever the list says — on Okuma only an `O` line with nothing behind it counts as one, so `O1001 (NAME)` is protected only by the `O` in the list |
| **Skip empty lines** | On by default |
| **Start over at each program start** | For files that hold several programs. On by default |
| **Only renumber blocks that already have a number** | Leaves unnumbered blocks unnumbered |
| **Also read these as a block number** | Other prefixes in the file; the new numbers are always written with the profile's own |

On Klartext there is no dialog: the control needs its blocks numbered from 0 in steps of 1,
so that is what the command writes, and the continuation lines of a `~` block get no number.

#### Jumps and cycles that point at a block number

`GOTO 100`, `M98 Q100`, `M99 P100` and, on a lathe, the `P`/`Q` of `G70`–`G73` all name a
block by its number, and so do `GOTO N100`, `IF […] N100` and a LAP call on Okuma and
`GOTO`, `GOTOF`, `GOTOB` or `GOTOC` followed by `N100` on Sinumerik. **Renumbering rewrites
the ones it can prove and reports the rest.** A jump to a name — an Okuma sequence name such
as `NLOOP`, a Sinumerik label such as `LAST_CUT` — needs nothing, because names are never
renumbered.

A reference is rewritten when all four of these hold:

1. Exactly one block in the program carries that number — a number used twice is an
   ambiguity, not an answer.
2. That block is in the **same program**. `GOTO 100` means the `N100` of the program it
   stands in, and a file can hold several programs.
3. That block is inside the lines this run renumbers. A jump that points at a block outside
   the selection keeps its number, because that block keeps its number too.
4. The rule allows it at all. `M99 P` returns to a block of the **calling** program, which
   this file does not show, so it is never rewritten — a number from this program would
   send the return somewhere else entirely. The same goes for `M98 P2000 Q50`: the `Q`
   names a block of program 2000, not of this one.

A turning program opened with the Fanuc **mill** profile is the same case: the mill does not
know `G70`–`G73` as turning cycles, so their `P` and `Q` are never rewritten — you are asked
first and the lines are listed — while the blocks they name are renumbered like any other,
so afterwards `P` and `Q` point at numbers that are gone. Set the lathe profile first (see
[Dialects](dialects.md#which-dialect-a-file-gets)).

Anything else is left exactly as written and listed in Results with the reason: the target
is missing, the target occurs twice — **before or after** the run — the target is outside
the run, the jump itself is outside the run and points into it, the reference is a variable
or an expression (`GOTO #100`), the block carries the same address twice so nothing can say
which word is meant, or the rule forbids it. A jump target rewritten wrongly is worse than
one left behind — the program still runs, and lands in the wrong place.

The rules do not care in which order a block writes its words, and they allow a space
between an address and its value: `G71 P 100 Q 200` is read like `G71 P100 Q200`, and
`N50 P2000 M98 Q50` like `N50 M98 P2000 Q50`.

The references it **can** follow are not worth a dialog, so it does not raise one for them.
If there are any it cannot follow, you are asked before it starts, and afterwards the
Results panel says how many were rewritten and how many need your eye. Those are worth
checking before the program goes to the machine.

The search is over the whole document, not over your selection: a `GOTO` *above* a selection
points into it just as well. Such a jump is outside the lines the run may change, so it is
**not** rewritten: you are asked first, and afterwards it is listed as a warning. The same
goes for a jump below the selection. Renumber the whole program, or fix the jump by hand.

##### Main blocks and labels on Sinumerik

A main block, `:20 G1 X10`, is numbered like any other block: renumbering keeps its colon
and gives it the next number of the same count (`:110`). A jump that names it by its colon,
`GOTOF :20`, is rewritten with it. `GOTOF N20` names an ordinary `N20` only, never the main
block `:20`, so it is reported as missing when there is no `N20`. A jump written without a
blank, `GOTOF:20`, is read as a label and is not followed; leave a blank after the jump word.
A label that starts with `N`, such as `NEXT_PECK:`, gets a block number in front of it
(`N20 NEXT_PECK:`) like any other label.

##### Numbers or names

A Fanuc or Sinumerik control reads a block number as a number: `N0100` and `N100` are the
same block, and a rewritten `GOTO 0100` keeps the four digits it was written with (more only
if the new number needs them). An Okuma control reads its sequence numbers as names:
`N0100` and `N100` are two blocks. There a jump follows only the block written exactly like
it, is rewritten with exactly the text that block gets — also when only the zeros change —
and a jump whose zeros match no block is reported as a missing target.

#### Other things it tells you about

- If the numbers pass the maximum and start over (with **Above the maximum** set to
  **Start over at the start value**), the program then has **duplicate block numbers** —
  the control takes the first match, and block search, `GOTO` and `M99 P` become
  ambiguous. When the program has jumps or cycle calls you are asked before a run that might
  need more numbers than the maximum allows; without any, it runs and warns afterwards, and
  the block where the numbering starts over is listed. A jump whose new target number the
  program now carries twice is not rewritten but listed: a value that names several blocks
  is not an answer. Use a larger maximum, a smaller increment, or "Stop and warn".
- Renumbering a selection starts at **Start at** and does not look at the numbers around
  it. Nothing warns you when a new number is one that a block outside the selection already
  carries, unless a jump inside the selection, or one pointing into it, names that number —
  choose a start above the numbers in front of the selection.
- On a dialect that numbers blocks consecutively (Klartext), renumbering only a selection
  does not fit the blocks around it, and you are asked first.
- A selection that starts inside a Klartext block (below a line that ends in `~`) is read
  together with the lines above it, so the rest of that block gets no number of its own.

Lines that get no new number are listed in Results with the reason: program markers, named
blocks, skipped prefixes, unnumbered blocks when only numbered ones are renumbered, and every
line from the one where the numbering stopped at the maximum; the block where the numbering
starts over is listed too.

### Remove Block Numbers

Takes the numbers off. Available only where the dialect does not insist on them, so it is
offered on Fanuc, Okuma and Sinumerik and refused on Klartext with the reason.

| Option | What it does |
|---|---|
| **Keep numbers that are pointed at** | On by default. A block number that a jump, a return or a turning cycle names stays where it is; everything else goes |

Removing a number that something jumps to does not renumber the jump — it deletes the
target outright, and the control alarms. That is why the option above exists and why it is
on: with it, a program comes out clean except for the handful of blocks that have to keep
their numbers, and each of those is listed in Results with the reason.

Switch it off and every number goes. Then you are asked first, and afterwards every line in
the run that points at a block number is listed so you can fix the jumps by hand. (A jump to
a Sinumerik main block, `GOTOB :20`, is counted in the question but gets no line of its own
in that list yet.)

On Sinumerik a main block, `:20`, that a jump names (`GOTOF :20`) is one of the numbers that
stay; a main block nobody names loses its number like the others.

There is one pointer the option cannot keep: a **computed** jump such as `GOTO #100` works
its target out while the program runs, so there is no number to hold on to and that block
loses its number like any other. That case is asked about and listed whichever way the
option stands.

Lines that held nothing but their block number end up empty; they are counted and listed.

---

## Cleanup

### Insert Spaces

Unpacks CAM output: `N10G0G90X0Y0` becomes `N10 G0 G90 X0 Y0`. Spaces only ever go
*between* two words gEdit found, so comments, strings, variables (`#101`, `V1`, `R1`),
expressions (`[#1+2.]`), keywords (`GOTO100` stays one word), signs (`X-10`) and a lathe's
`,R1.` are never pulled apart. Every rewritten line is read back and has to come out as the
same words; a line that does not is kept as it was and listed in Results.

On a dialect that already separates its words (Klartext) there is nothing to unpack: the
command changes nothing and says so ("Nothing to do: the words are already separated.").

### Remove Spaces

The other direction, and the dangerous one, because a space that carried meaning cannot
come back. Not available on Klartext, which needs its spaces, nor on Sinumerik (milling and
turning), whose names, keywords and addresses of more than one letter need theirs.

A space is removed only when joining the two sides gives back exactly the same words.
`X10 5` would join into `X105`, so a line like `N10 G0 X10 5` is left exactly as written —
every space of it — and listed in Results.

Comments and strings keep every space inside them; the spaces around a comment go
(`O1001 (BRACKET)` becomes `O1001(BRACKET)`). A keyword keeps its own space and the ones on
either side of it (`GOTO 100`, `IF [#1 EQ 1] THEN`, Okuma `CALL O100`), and so do variables
and expressions, a call such as `MSG("…")`, a label or a sequence name (`LAST_CUT:`, Okuma
`NLOOP`), a name standing on its own (`GOTOF LAST_CUT`, `DEF REAL XNOW`) and a block-skip
mark. Leading indentation and trailing blanks go — making the program compact is the point.

On **Okuma** the space after a sequence number or name stays too, because the control
requires one (`N100 G00X50`, never `N100G00X50`), and so does the space on either side of a
word whose address has more than one letter, as the manual always writes it:
`N100 G00 X80 SB=1200 M03` becomes `N100 G00X80 SB=1200 M03`. Whether the control accepts
packed words anywhere else is not confirmed — check a packed Okuma program before it goes to
a machine. On **Sinumerik** the command is not offered: a name written against a block
number (`N30 XNOW=62` would become `N30XNOW=62`) reads as one longer name.

### Remove Empty Lines

Removes every line that holds nothing but whitespace. A line with only a block number is
not empty, and neither is a comment.

The final newline of the file is kept (on a selection, its last line stays even when it is
empty). On Klartext, where block numbers have to stay consecutive, the run warns that the
program needs renumbering and offers to do it — it does not renumber behind your back.

### Remove Comments…

Finds comments the way the control reads them, not with a search for `(`, so an unclosed
bracket at the end of a file or a `(` inside a string does not take half the program with
it.

| Option | What it does |
|---|---|
| **Remove lines that become empty** | A line that held nothing but a comment goes instead of being left blank. On by default |
| **Keep the program-name comment** | The comment that names the program: `O1001 (BRACKET)` on Fanuc, the comment behind the file header on Okuma and Sinumerik (`$MAIN.MIN% (…)`, `%_N_…_MPF ;…`) — on Okuma not the one behind an `O` line. On by default |
| **Keep comments in the first lines** | The header block your shop stamps on every program, counted from line 1 of the document even when you run on a selection. 0, the default, keeps none |
| **Keep section headings** | Klartext structure blocks such as `* - ROUGH`, offered only where the dialect has them. On by default |

On Fanuc, Okuma and Sinumerik a line left with nothing but its block number **stays**,
because that number may be the target of a `GOTO`. On Klartext, where the numbers are
positional and jumps go to labels, the line goes (with **Remove lines that become empty**
on), and the run warns that the program needs renumbering and offers to do it. A Klartext
continuation `~` behind a comment survives: `12 ; SETUP ~` becomes `12 ~`, and the block
stays one block.

On Sinumerik a whole-line comment such as `;$PATH=/_N_MPF_DIR`, which the control's transfer
format uses to file the program in its folder, is part of the file header and is always kept,
whatever the options say, and listed in Results as kept ("Comment kept: it is inside the
header"). The same text behind code is an ordinary comment. The rule is general: a whole-line
comment that the dialect's detection treats as a decisive mark of the dialect stays, because
removing it would also remove what identifies the file.

Every comment that was kept is listed in Results with the reason.

### Convert Case…

Converts the program to upper or lower case. Comments are left alone unless you switch off
**Leave comments as they are**. Text in quotes in the code keeps its case — a tool name in
`TOOL CALL "MILL_D10"` or `T="drill_d8"`, the text of a `MSG("…")` — but inside a comment
you chose to convert, a quote is just a character and its text converts with the rest. **A
Fanuc program name in `<angle brackets>` is not kept apart yet**: `<mac_f1>` becomes
`<MAC_F1>`, and the control may read a name as case-sensitive, which would break a call to
the lower-case original — check a program that calls another by name before converting it.

| Option | What it does |
|---|---|
| **Convert to** | **UPPER CASE** (the default) or **lower case** |
| **Leave comments as they are** | On by default. Tool names and other text in quotes in the code are always left alone |

It runs on all six shipped dialects; a profile that declares upper and lower case to be
different code refuses it. Lower case asks first on the two Fanuc profiles, whose controls
read only upper case: such a program may be refused when it is loaded.

A line whose converted form would not read back as the same words is kept as written and
listed. A word or comment whose conversion would change its length — `ß` becoming `SS`
moves every offset behind it — keeps its case while the rest of the line is converted, and
the line is listed.

The **Upper Case** and **Lower Case** buttons on the Home tab are the editor's plain text
commands: they change the selected text as it is — with nothing selected, the word at the
cursor — comments and quoted tool names included. Use **Convert Case…** on a program.

---

## Block skip

A block that starts with a slash is skipped when the control's skip switch is on: the
standard way to mark a prove-out section, a measuring pass or a part of the program that
runs only on some jobs. Two commands, in the **Block Skip** group of the NC tab, put the
mark on a selection and take it off again. Neither has a shortcut.

They are offered where the dialect has a block skip mark, and, like the other commands on this
tab, refused on a program that plainly belongs to another dialect.

### Insert Block Skip…

Marks every block of the selection that can take a mark.

| Option | What it does |
|---|---|
| **Skip level** | Only on a dialect with several skip switches (Fanuc, Sinumerik). **Plain (/)** writes the bare slash; a level writes `/1` to `/9`, followed by a blank (`/3 N10`) |

**Where the mark goes** is the dialect's habit. In front of a block number that starts with
a letter (`/N100 G0 X0`, an Okuma sequence name `/NLAP1`); behind a Klartext block number,
which is a plain integer (`12 /L X+0 Y+0`); at the head of a block that has no number. A
blank line is never marked.

- **With nothing selected** the command asks first, because every line of the program would
  be marked. A selection never asks, unless it covers the whole file.
- **A block that already carries a mark** — at any level, in front of or behind the number —
  is never marked twice. If its level is not the one you asked for it is listed, and the
  count is in the summary.
- **A continuation is part of the block that starts it.** A Klartext block continued with `~`
  and an Okuma `$` line carry no mark of their own: the first line has it. If your
  selection starts in the middle of such a block, that block is **not** marked and the
  summary says so; select from its first line to skip it.
- **Left unmarked, and listed:** a program number or name (`%`, `O1001`, the Okuma and
  Sinumerik file headers such as `$PART.MIN%` and `;$PATH=`), a Klartext `BEGIN PGM` and
  `END PGM`. Skipping the line that names or closes the program would hide it from the
  control. An `M30` is an ordinary block and is marked if it is in your selection.
- **Only the mark is written.** A slash that is division (`#1=#2/2`, `R1=R2/2`,
  `[#1/#2]`), and a mid-block mark on Fanuc (`/5` meaning "skip from here"), are never
  touched.

### Remove Block Skip…

Takes the mark off every block of the selection, and the blanks behind it.

| Option | What it does |
|---|---|
| **Skip level** | Only on Fanuc and Sinumerik. **All levels** (the default), **Plain**, or one digit. A mark of another level stays; it is counted in the summary and listed as information |

The bare `/` is level 1 on Fanuc, the same switch as `/1`, and level 0 on Sinumerik, the
same as `/0`; **Plain** takes off whichever of the two the dialect means. Remove never asks
before it runs.

Insert and then Remove on the same lines gives the program back **byte for byte**: Remove
cuts the blanks behind the mark, and keeps one only where the control needs the words
apart and the cut would glue two together.

Both commands are one undo step, say in the status bar what they did, and list in Results
what they left.

## Tool segments

**Select Tool Segment** (`Cmd/Ctrl+F7`, and the **Segments** group of the NC tab) selects
the lines that belong to one tool: from the line that calls it up to the line before the
next tool call, or to the end of the program for the last one. Trailing blank lines are left
out. Then copy it, move it, or run a command on it: every command on this tab works on the
selection, and so does Block Skip.

- **Cursor inside a segment**: that segment is selected.
- **Cursor outside every segment**, in the header before the first tool call: a question asks which tool, one choice
  for each tool that is used, with the line it starts at. A tool called more than once is
  one choice.
- **A tool used in several places** (a roughing and a finishing call, say): the first
  segment at or after the cursor, wrapping round; the status bar says how many segments
  that tool has.
- A program with no tool changes says so.

What a tool change is comes from the dialect, as in the program map and `F7`: `M6` on a
mill, the `T` word on a lathe, `TOOL CALL` in Klartext.

---

## Where the rest is

| You want | Where |
|---|---|
| Scale feeds or spindle speeds | A bundled script — [Scripts](scripts.md) |
| A tool list | A bundled script — [Scripts](scripts.md) |
| Program checks, the smallest and largest value of every axis | Bundled scripts — [Program checks](scripts.md#program-checks) and [Extents](scripts.md#extents) |
| Adding to, subtracting from, multiplying or dividing the values of chosen addresses (a Z shift, say) | A bundled script — [Address arithmetic](scripts.md#address-arithmetic) |
| Mirroring, splitting by tool, joining programs | Not in this version; write a script, or wait for the bundled library to grow |
| Find and replace | The editor's own: `Cmd/Ctrl+F` to find, `Ctrl+H` on Windows and Linux or `Cmd+Alt+F` on macOS to replace |
| Find an address or a value everywhere (`G1`, `S>12000`), list the hits, or replace them in place or into a new tab | **Find All…** and **Replace All…** on the Home tab, which follow the four rules above — [Searching](README.md#searching), and [Regular expressions](regex.md) for patterns |
