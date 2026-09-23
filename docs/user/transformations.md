# Transformations

The **NC** tab holds the changes you make to a whole program rather than to one line:
renumbering it, unpacking or packing it, throwing out empty lines or comments, and fixing
the case. They are built into the editor, so they work whether or not Python is installed.
Feeds, speeds and tool lists are done by scripts instead — see [scripts.md](scripts.md).

## Four rules that hold for all of them

**1. Selection or program.** With text selected, the transformation runs on the selected
lines; with nothing selected, on the whole program. A selection is always extended to
whole lines — half a block is not a block.

The scope is taken **when you pick the command**, before any options dialog opens. A click
in the dialog can never quietly widen a run to the whole program.

**2. One undo step.** However many lines a run changed, one `Cmd/Ctrl+Z` puts the program
back exactly as it was. Only the lines that actually differ are rewritten, so bookmarks
and folded sections outside the change survive.

**3. It tells you what it did, and what it did not do.** The status bar gets a one-line
summary ("Renumbered 412 blocks"). Anything the run refused to touch goes to the
**Results** panel with the line number and the reason; click a row to jump there. A run
with nothing to report clears its own previous report.

**4. It asks before it does something you may not want.** A transformation that would
break a jump, or write a program your control will refuse, asks first and lets you say no.

Behind all of this is a tokenizer that knows the active dialect: it knows what is a
comment, a string, a variable, an expression and a keyword, so a `G1` inside
`(FINISH G1 PASS)` is a comment and stays a comment. Where a rewrite is not provably safe,
the line is left as written and listed in Results rather than changed and hoped for.

---

## Numbering

### Renumber Blocks…

Writes a fresh set of block numbers. The options come pre-filled from the dialect and
remember what you used last time:

| Option | What it does |
|---|---|
| **Start at** | The number the first block gets (Fanuc default 10) |
| **Increment** | The step between blocks (Fanuc default 10) |
| **Digits** | Pad with leading zeros to this width; 0 writes the number as short as it is |
| **Maximum** | Leave empty for no maximum (Fanuc default 99999) |
| **Above the maximum** | Start over at the start value, or stop and warn |
| **Spaces after the number** | Between `N120` and the rest of the block |
| **Skip lines starting with** | Separated by spaces. Fanuc skips `%`, `O` and `(` |
| **Skip empty lines** | On by default |
| **Start over at each program start** | For files that hold several programs |
| **Only renumber blocks that already have a number** | Leaves unnumbered blocks unnumbered |
| **Also read these as a block number** | Other prefixes in the file; the new numbers are always written with the profile's own |

#### Jumps and cycles that point at a block number

`GOTO 100`, `M98 Q100`, `M99 P100` and, on a lathe, the `P`/`Q` of `G70`–`G73` all name a
block by its number. **Renumbering rewrites the ones it can prove and reports the rest.**

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

Anything else is left exactly as written and listed in Results with the reason: the target
is missing, the target occurs twice — **before or after** the run — the target is outside
the run, the reference is a variable or an expression (`GOTO #100`), the block carries the
same address twice so nothing can say which word is meant, or the rule forbids it. A jump
target rewritten wrongly is worse than one left behind — the program still runs, and lands
in the wrong place.

The rules do not care in which order a block writes its words, and they allow a space
between an address and its value: `G71 P 100 Q 200` and `N50 P2000 M98 Q50` are read
exactly like the forms without the space.

The references it **can** follow are not worth a dialog, so it does not raise one for them.
If there are any it cannot follow, you are asked before it starts, and afterwards the
summary says how many were rewritten and how many need your eye. Those are worth checking
before the program goes to the machine.

The search is over the whole document, not over your selection: a `GOTO` *above* a selection
points into it just as well.

Other things it will tell you about:

- If the numbers pass the maximum and start over, the program then has **duplicate block
  numbers** — the control takes the first match, and block search, `GOTO` and `M99 P`
  become ambiguous. You are asked before a run that might need more numbers than the
  maximum allows, and no reference is rewritten in a program whose numbering repeats: a
  value that names several blocks is not an answer. Use a larger maximum, a smaller
  increment, or "Stop and warn".
- On a dialect that numbers blocks consecutively (Klartext), renumbering only a selection
  does not fit the blocks around it, and you are asked first.
- A selection that may start in the middle of a block is flagged rather than guessed at.

Program markers, named blocks and skipped prefixes are listed in Results with the reason
they kept their number.

### Remove Block Numbers

Takes the numbers off. Available only where the dialect does not insist on them, so it is
offered on Fanuc and refused on Klartext with the reason.

| Option | What it does |
|---|---|
| **Keep numbers that are pointed at** | On by default. A block number that a jump, a return or a turning cycle names stays where it is; everything else goes |

Removing a number that something jumps to does not renumber the jump — it deletes the
target outright, and the control alarms. That is why the option above exists and why it is
on: with it, a program comes out clean except for the handful of blocks that have to keep
their numbers, and each of those is listed in Results with the reason.

Switch it off and every number goes. Then you are asked first, and afterwards every line
that still points at a number which is now gone is listed so you can fix the jumps by hand.

There is one pointer the option cannot keep: a **computed** jump such as `GOTO #100` works
its target out while the program runs, so there is no number to hold on to and that block
loses its number like any other. That case is asked about and listed whichever way the
option stands.

Lines that held nothing but their block number end up empty; they are counted and listed.

---

## Cleanup

### Insert Spaces

Unpacks CAM output: `N10G0G90X0Y0` becomes `N10 G0 G90 X0 Y0`. Spaces only ever go
*between* two words the tokenizer found, so comments, strings, variables (`#101`, `Q1`),
expressions (`[#1+2.]`), keywords like `TOOL CALL`, signs (`X-10`) and a lathe's `,R1.`
are never pulled apart. Every rewritten line is read back and has to come out as the same
words; a line that does not is kept as it was and listed in Results.

On a dialect that already separates its words (Klartext) there is nothing to unpack, and
the command says so instead of pushing `LBL 0` and `REP 5` apart.

### Remove Spaces

The other direction, and the dangerous one, because a space that carried meaning cannot
come back. Not available on Klartext, which needs its spaces.

A space is removed only when joining the two sides gives back exactly the same words:
`X10 5` would join into `X105`, so that space stays. Comments and strings keep every space
they had; a keyword keeps its own. Leading indentation and trailing blanks go — making the
program compact is the point.

### Remove Empty Lines

Removes every line that holds nothing but whitespace. A line with only a block number is
not empty, and neither is a comment.

The final newline of the file is kept. On Klartext, where block numbers have to stay
consecutive, the run warns that the program needs renumbering and offers to do it — it
does not renumber behind your back.

### Remove Comments…

Finds comments with the tokenizer, not with a search for `(`, so an unclosed bracket at
the end of a file or a `(` inside a string does not take half the program with it.

| Option | What it does |
|---|---|
| **Remove lines that become empty** | A line that held nothing but a comment goes instead of being left blank. On by default |
| **Keep the program-name comment** | `O1001 (BRACKET)` — the one the control shows in its directory |
| **Keep comments in the first lines** | The header block your shop stamps on every program; 0 keeps none |
| **Keep section headings** | Klartext structure blocks such as `* - ROUGH`, offered only where the dialect has them |

On Fanuc a line left with nothing but its block number **stays**, because that number may
be the target of a `GOTO`. On Klartext, where the numbers are positional and jumps go to
labels, the line goes and the run warns that the program needs renumbering. A Klartext
continuation `~` behind a comment survives: `12 ; SETUP ~` becomes `12 ~`, and the block
stays one block.

Every comment that was kept is listed in Results with the reason.

### Convert Case…

Converts the program to upper or lower case. Text in comments can be left alone (and text
in quotes always is). Not available on a dialect where upper and lower case mean different
things.

Lower case on a control that only reads upper case is a program that may be refused when
it is loaded, so that direction asks first. A line whose converted form would not read
back as the same words — `ß` becoming `SS` changes the length and every offset behind it —
is kept as written and listed.

---

## Where the rest is

| You want | Where |
|---|---|
| Scale feeds or spindle speeds | A bundled script — [scripts.md](scripts.md) |
| A tool list | A bundled script — [scripts.md](scripts.md) |
| Coordinate arithmetic, mirroring, splitting by tool, program checks | Not in this version; write a script, or wait for the bundled library to grow |
| Find and replace | The editor's own: `Cmd/Ctrl+F` to find, `Ctrl+H` on Windows and Linux or `Cmd+Alt+F` on macOS to replace |
