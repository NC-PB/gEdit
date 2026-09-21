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

Before it runs it looks for **jumps that point at a block number** — `M99 P`, `M98 Q`, the
`P`/`Q` of `G70`–`G73`, `GOTO`. Renumbering does not rewrite them, so if there are any you
are asked whether to go ahead, and afterwards each one is listed in Results so you can
check it.

Other things it will tell you about:

- If the numbers pass the maximum and start over, the program then has **duplicate block
  numbers** — the control takes the first match, and block search, `GOTO` and `M99 P`
  become ambiguous. Use a larger maximum, a smaller increment, or "Stop and warn".
- On a dialect that numbers blocks consecutively (Klartext), renumbering only a selection
  does not fit the blocks around it, and you are asked first.
- A selection that may start in the middle of a block is flagged rather than guessed at.

Program markers, named blocks and skipped prefixes are listed in Results with the reason
they kept their number.

### Remove Block Numbers

Takes the numbers off. Available only where the dialect does not insist on them, so it is
offered on Fanuc and refused on Klartext with the reason.

Removing a number that something jumps to deletes the target outright and the control will
alarm, so the check for jumps here is blunter than the renumber one — you are asked, and
every affected line is listed afterwards. Lines that held nothing but their block number
end up empty; they are counted and listed.

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
