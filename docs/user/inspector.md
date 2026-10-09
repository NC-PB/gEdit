# Understanding a block: the inspector, the hover and the motion colours

Three things in gEdit answer the question you ask a hundred times in a program you did not
write: *what does this line do, and what is in force when it runs?*

| | What it does |
|---|---|
| [The inspector](#the-inspector) | A panel that lists the words of the block at the cursor, what each one means **on your machine**, and what is in force after the block. You can change one value from it. |
| [The hover in context](#the-hover-in-context) | The explanation you already get when you rest the pointer on a word, now with the parameters of a cycle and what the word means *here*. |
| [Motion colours](#motion-colours) | A narrow coloured mark beside every line that moves: rapid, straight, arc, thread or cycle. |

All three read the program the way the machine will: from the top, line by line, keeping track of
what each block switches on and off (the feed unit, the plane, the work offset, the cycle in force,
and so on). gEdit calls that the **modal state**. None of this is a backplot or a simulation. It
reads text, and what it shows is only as good as what it is told about your control. Where it has
to guess, it says **assumed** and says where the guess comes from; where a value depends on your
machine and you have not said which one it is, it lists the possible readings and picks none
([Machines](machines.md#why-it-matters-the-number-without-a-decimal-point)).

**Your control's manual is the authority, not this editor.**

---

## The inspector

### Opening it

The inspector is a panel on the left, next to the **Program Map**, and it is **closed until you
open it**:

- **View ▸ Panels ▸ Code Inspector** on the ribbon, or
- `Cmd/Ctrl+Alt+A`, or
- `F1`, then *Inspector: Code Inspector*.

The same key closes it again and brings back the Program Map (or hides the left side if there is
nothing else in it). While the inspector is closed it costs nothing.

On Windows and Linux, a few keyboard layouts produce a letter with `AltGr+A` (a Polish layout
types `ą`), and `Ctrl+Alt+A` is the same key combination. If the key types a letter instead of
opening the panel on your keyboard, use the ribbon button or the palette; they do the same.

### What it shows

Put the cursor in any line. The inspector follows it and shows the **block** the cursor is in.
Usually that is the line; the heading says `Line 12`. A block that runs over several lines
is shown as a whole and the heading says `Lines 12–14`: a line that ends in the continuation
marker, a Klartext definition with `~`, an Okuma line that continues with `$`.

The panel has two parts.

**This block** lists the words of the block, one row each, in the order they are written: the
block number, the codes, the addresses with their values, the parameters of a cycle, `SB=800` or
`Q200=2`-style assignments, variables and anything gEdit does not know. Spaces, comments,
strings, labels and the continuation marker are not words and get no row. Each row shows the word
as written, what it means, its value and one or more short notes:

| A note says | It means |
|---|---|
| *Feed per minute*, *Feed per revolution*, with *G99 on line 9* | Which kind of feed the `F` is, and the line that switched to it. *G99 at power-on* means the program never said, and the control's starting mode is used. |
| *Thread lead (G76)* | The `F` here is the pitch of a thread, not a feed. That is exactly where scaling a feed would cut a different thread. |
| *Surface speed*, *Clamped at 2500 (line 11)*, *Speed limit, not a speed* | What `S` is under constant surface speed, and the top spindle speed in force; or an `S` that only sets that limit (`G50 S2500`). `S` is never converted. |
| *A time in seconds, not a feed* | The `F` of a dwell such as `G4 F1.5`. |
| *Incremental*, *Incremental X* | A distance from where the tool is, not a position: `G91 X10.`, or `U` on a lathe. |
| *Diameter*, *Radius* | What a lathe `X` measures, from the diameter mode in force. If the distance mode is not known, it says that it cannot tell. |
| *A value for G50, not a position* | An axis word that is data of a code and does not move anything. |
| *Machine coordinates (G53)* | A position in the machine's own coordinates. |
| *Not described* | The word is not in the code help of the dialect. gEdit does not guess. |
| *A variable: its value is known only when the program runs* | `X#101`, `X=IC(5)` and similar. |

**In force after this block** lists what the machine is set to once the block has run:

- Motion, Plane, Distance (absolute or incremental), Units, Diameter mode, Work offset, Tool,
  Spindle, Speed, Speed limit, Feed, Coolant, Compensation, Active cycle, Defined cycle,
  Frame and Tool centre point, then any other modal group the dialect has, as `Group <name>`.
- Each row says **where it was set**: `line 7`, a link that moves the cursor there; `at power-on`
  for what the control starts with.
- **set here** marks what this very block set or changed, so you can see at a glance what a
  line does as opposed to what it merely sits in.
- **Assumed** appears when the program never set the mode and gEdit had to take it from somewhere else: the
  *machine* you chose for the document, what was *detected from the program*, or the
  dialect's *profile default*. Nothing assumed is shown as if the program had said it.

Every word is read **after** its block. That is how the machine reads it. In `G91 X10.` the `X`
is incremental, in `G99 F0.2` the `F` is a feed per revolution, and in `G76 … F1.5` the `F` is
a lead. So the inspector, the hover and an edit agree with each other.

### A value and what the machine reads

When a word is a number whose reading depends on the control, the row shows the **effective value**,
the one your machine reads, with the reason:

- With a machine chosen for the document, `X50` on a Fanuc lathe set to IS-B reads as `0.05 mm`:
  no decimal point, so the digits are counted in steps of 0.001 mm. `X50.` with the point reads 50 mm.
  On an Okuma unit system of 10 µm, `X50` is `0.5 mm`, point or no point.
- With **no machine**, the row shows no value at all. It shows the list **Depends on the
  machine:** with one line for each way the control could read it (calculator-type input,
  IS-B, IS-C; or the three Okuma unit systems), the dialect's default first, and the note *Depends on
  the machine; choose a machine*. That is the rule of [Machines](machines.md): no machine, no
  guess. Choose the machine in the status bar and the rows change.

A word whose every possible reading agrees (a value with a decimal point on a Fanuc, say) shows
the value and no list.

### Cycles

When the block starts, defines or calls a cycle, or runs under a cycle that is in force, the panel
shows a small table of its parameters: **Runs G83**, **Defines CYCL DEF 200** or **Calls CYCL
DEF 200**; each parameter by the name the code help gives it, the value written, and the line
it was written on, or *not written*. Some cases:

- A Klartext cycle is defined over several lines; the table collects them. A later `M99` or
  `M89` *calls* it and the table shows the parameters of the definition.
- A Sinumerik `CYCLE83(5,0,2,-30,,-8,…)` is read by position, so each argument gets the name
  of its place; an empty argument is *not written*.
- A Fanuc cycle (`G81`–`G89`) shows the words of its block. The position blocks that follow
  are under a modal cycle; the state row *Active cycle* says which one.
- Some lathe cycles are written in **two blocks**, `G76` for instance: the first block holds the
  settings of the passes, the second the thread itself with its end
  point, the height and the lead. The table says *Block 1 of 2* or *Block 2 of 2* and shows the
  parameters of that block. Okuma writes its thread in one block and shows one table.

### Changing a value

To change a number, **double-click its row, or put the focus on it and press Enter.** A small
dialog opens, `Change X50`, with the field *New value in mm* already holding the effective value.
Type the new value and press OK.

Without the panel: put the cursor on the word and run *Inspector: Edit Value at Cursor…* from the
palette (`F1`).

What happens, and why:

- **Only the number's characters change.** The address, the sign style and the form stay: `X10.500`
  with `12.3` becomes `X12.300`; `Z+3.` with `5` becomes `Z+5.`; `T0101` with `202` becomes
  `T0202`; a Klartext `Y+5,5` with `6.25` becomes `Y+6,25`. Everything else on the line,
  and in the rest of the program, is untouched.
- **You type the real value, in the unit shown, and gEdit writes it the way your machine reads it.**
  On the IS-B lathe `X50` means `0.05 mm`: type `0.051` and the line becomes `X51`.
- **gEdit never rounds for you.** On that lathe, `0.0505` cannot be written in steps of 0.001 mm.
  The dialog says so next to the field, OK stays greyed, and nothing is written until you type
  something the word can hold. The same goes for an Okuma 10 µm machine and `0.015`.
- **It is refused, with the reason, when the answer would be a guess:**

| Refused | Reason shown |
|---|---|
| A word whose value depends on the machine, and you have not chosen one | *The value depends on the machine; choose a machine first.* |
| Block numbers and the program number | *Block numbers are changed with Renumber.* ([Transformations](transformations.md)) |
| A G or M code, a call, a word gEdit does not know | A code is not a value; type over it in the editor. |
| A variable or an expression | The value is known only when the program runs. |
| Something that is not a decimal number | *That is not a decimal number.* (A comma is read as a point.) |
| A decimal number where the word takes a whole number: a tool word, `D` and `H` written without a point, any count such as a number of passes | *This word takes a whole number.* |
| A value below the smallest or above the largest the code help gives for that parameter | *The smallest value allowed is …* / *The largest value allowed is …* |
| A document that is locked against editing | The status bar says that Change Value did not run ([Read-only programs](README.md#read-only-programs)). |

- **Esc or Cancel writes nothing and says nothing.**
- **One Undo takes it back.** The change is one edit, and a bookmark or a fold on the line stays.
- If the program changed while the dialog was open, gEdit writes nothing and tells you.
- When it has written, the status bar says `X50 changed to X51`.

The inspector edits one value at a time. It does not insert code, and it does not rewrite the
rest of the program: for that, use the [NC tab](transformations.md) or a [script](scripts.md).

### Waiting, and what it does not read

Right after you open a large program, or edit near its top, the modal state is not known yet for
the lines further down, and the panel says **Waiting for the program to be read**. gEdit reads in
the background, in small steps, so typing is not held up; for a program of 300,000 lines it takes
about a second and a half. The panel fills in by itself.

It reads NC programs only: on a JSON or Python document it says so. A line longer than 4,000 characters is not
inspected.

---

## The hover in context

Resting the pointer on a word still shows what [Code help](README.md#code-help) always showed:
what the code does, its group, whether it is modal, which addresses it needs. That text comes first,
unchanged. Once the program has been read, the hover adds what the word means **in this block**.

### A cycle word: a table of its parameters

Over a cycle code (`G83`, `G76`, `CYCL DEF 200`, `CYCLE83`) the hover adds a table:

| Word | Meaning | Written |
|---|---|---|
| `Z` | Depth | `-15.` |
| `R` | Retract plane | `2.` |
| `Q` | Peck depth | `5.` |
| `P` | Dwell at the bottom | *not written* |

The title says which cycle it is. For a lathe cycle in two blocks it says *block 1 of 2* or
*block 2 of 2*, with the parameters of that block. Over the `M99` that runs a Klartext cycle, the
title says *defined on line 7* and the table shows the parameters of that definition. If
the cycle is defined over several lines (`~`), all of them are read.

### An address word: one line of context

Over `X`, `F`, `S` or `U`, the hover adds one line: the word, a dash, then the parts that apply.

| Dialect | You rest on | The line includes |
|---|---|---|
| Fanuc lathe | `X32.` | `X — target, diameter (assumed: profile default), absolute` |
| Fanuc lathe | `U-2.` in `G01 U-2.` | `U — incremental X, diameter (assumed: profile default)` |
| Fanuc lathe | `F0.25` after `G99` | `F — feed per revolution (G99)` |
| Fanuc lathe | `S220` after `G96` and `G50 S2500` | `S — surface speed (G96), clamp 2500 rpm (line 11)` |
| Fanuc lathe | `F1.5` in `G76` | `F — thread lead (G76)` |
| Fanuc lathe | `Q3000` in `G83` | the three readings of a point-less cycle parameter (below) |
| Fanuc mill | `X-15.` | `X — target, absolute (G90), work offset G54` |
| Fanuc mill | `F450.` in `G84` | `F — feed per minute (G94)` (a tap in a mill is not a lead) |
| Fanuc mill | `X80.` in a block after `G83` | `…, cycle G83 in force (line 39)` |
| Klartext | `IX+5` | `IX — target, incremental` |
| Klartext | `Q201` in `CYCL DEF 200` | `Q201 — Depth, negative into the material (CYCL DEF 200)` |
| Sinumerik turning | `X84` under `DIAMOF` | `X — target, radius, …` |
| Sinumerik turning | `G91 X-1` | `X — target, radius, incremental (G91)` |
| Sinumerik turning | `G4 F1.5` | `F — a time in seconds, not a feed (G4)` |
| Sinumerik turning | `S200` under `G96` and `LIMS=2800` | `S — surface speed (G96), clamp 2800 rpm (line 9)` |
| Okuma | `F2` in the thread cycle `G71` | `F — thread lead (G71)`, with the readings below |
| Okuma | `G50 S2000` | `S — speed limit, not a speed (G50)` |

The parts are the same as the inspector's notes: target, absolute or incremental, diameter or radius,
the work offset, the frame the word is inside (`inside TRANSMIT (line 19)`), the cycle in force,
the kind of feed and the code that set it, and the surface speed with its clamp.
*Assumed* appears here too, with its source: *machine*, *detected from the program* or *profile
default*. On a milling profile a position is not called a radius or a diameter, unless diameter programming is switched on.

### A number that depends on the machine

Over a word whose reading depends on the machine, the hover says what it is worth:

- **With a machine chosen:** `X50 — 0.05 mm: no decimal point, increments of 0.001 mm (machine 'Lathe IS-B')`.
  Under calculator-type input it says `50 mm: as written`. On an Okuma unit system:
  `X27.55 — 0.2755 mm: every number counts in units of 0.01 mm (machine 'Okuma 10um')`.
- **With no machine:** `X50 — depends on the machine; choose a machine:`, then one line for each
  reading, the profile's default marked:

  ```
  50 mm: As written (profile default)
  0.05 mm: Increments of 0.001 mm (IS-B)
  0.005 mm: Increments of 0.0001 mm (IS-C)
  ```

- **A machine that does not set the number input** says so by name and lists the readings.
- A word that is written with a decimal point on a Fanuc has only one reading and no such line.
  On an Okuma control, even a word with a point has several readings, because the unit system scales
  every number.

A word that a machine's channel settings list as a wait keeps the wait text
([Channels](channels.md#the-hover-on-a-wait-code)).

### When the hover is the plain one

The extra paragraphs appear only when gEdit has read the program up to the line. Until then, and in
a comparison view or a scratch document, you get the plain explanation exactly as before. The text
that comes from a profile, a code file or the program is always shown as text, never as markup.

---

## Motion colours

A narrow bar between the line numbers and the text marks every line that **moves**, in the colour
of how it moves. The words keep their own colours; the bar is the only addition.

| Colour | Kind | Lines |
|---|---|---|
| Red | **Rapid move** | `G0`; a Klartext line with `FMAX` |
| Green | **Straight feed move** | `G1`, a Klartext `L` |
| Blue | **Arc** | `G2`, `G3`, `CIP`, `CT`; Klartext `C`, `CR`, `CP`, `CTP`; the circular approach and departure (`APPR CT`, `DEP LCT`) |
| Purple | **Thread or tapping** | `G32`, `G33`, the threading cycles (`G76`, and `G92` in G-code system A), `G84` tapping, a Klartext cycle 207 call, and the positions under a tapping cycle |
| Amber | **Canned cycle** | `G81`–`G89` and the positions under them, the line that calls a Klartext cycle (`CYCL CALL`, `M99`, `M89`), a Sinumerik `CYCLE83(…)` call; the lines that only *define* a cycle move nothing and get no mark |

The shade follows the theme, light or dark, and is chosen so that the bar can be seen against the
editor background in both.

A thread is purple even where the control treats the pass as a cycle: a threading pass is a
thread first.

### What gets no mark

A mark is a claim that the line moves in that way, so gEdit leaves it out when it cannot say:

- A line that moves nothing: a block with only `M8`, a comment, a lone `G0` with no axis word,
  a dwell (`G4 X1.`), a block that gives an axis word as **data** of a code (`G50 X100.`).
- The second and later lines of a multi-line block: only the line with the cycle code or the
  position is marked.
- A line whose motion mode the program has **never set**. Before the first `G0`, `G1` or `L`, the
  mode is only a starting assumption, and the bar stays blank rather than show a guess.
- A path function that has no motion of its own, such as the Klartext corner rounding `RND` and
  chamfer `CHF`.

Two readings are simpler than the control's: the lathe turning cycles (`G90` and `G94` in G-code
system A, `G77` and `G79` in system B) show as straight moves, and a reference return such as
`G28` shows the colour of the motion mode in force. A Sinumerik `MCALL` marks the line that calls
it, but not the positions that follow.

### Switching it off

The colours are on. To switch them off or on:

- **View ▸ Lines ▸ Motion Colors** on the ribbon (or *View: Motion Colors* in the palette, `F1`), which says
  *Motion colors off.* or *Motion colors on.*, or
- `Settings ▸ Assistance ▸ Color lines by how they move`.

The marks are drawn for the lines you see and a hundred above and below, so a very fast scroll may
show a few unmarked lines for a moment. Right after opening a large program, lines the background
reading has not reached yet have no mark, and they appear by themselves.

---

## What to expect

- **Nothing is changed by looking.** The inspector, the hover and the colours only read. The one
  place that writes is the inspector's value dialog, and it asks first.
- **The same program, different machines:** the inspector and the hover change when you change the
  machine of the document, or the dialect (the profile); the colours follow too. Nothing of this is written to
  the file.
- **Speed:** typing is not slowed by any of the three. They update when the editor is idle.
- **A dialect gEdit has no profile for** is read by the closest one, and the readings are only as
  good as that fit ([Dialects](dialects.md#what-a-profile-decides)).
