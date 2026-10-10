# Writing with templates

A **template** is a piece of NC code with blanks in it: a program start, a tool change, a
drilling cycle. You pick it, fill in a short form, and gEdit writes the lines into your
program in the dialect's own style, with the block numbers carried on from where you are.
You can change a cycle that is already in the program through the same kind of form
(**Edit Cycle**), compute a value from other values (a feed from a pitch and a speed), and
keep templates of your own: write them in the **template manager**, or turn a few lines of
a program into one.

This page covers inserting a template, completion, favourites, Edit Cycle, the template
manager, **New Template from Selection**, and where your templates are kept. What gEdit does
with a number you type is the same everywhere: it writes **exactly what you typed**, in the
form the template says, and refuses what does not fit. It never rounds, never adds a digit
and never corrects a value for you.

> **Every template that ships with gEdit is marked "Review pending".** The templates were
> written from the control manuals, but nobody has checked them against a real machine yet.
> They are a starting point: speeds, positions, feeds and the M codes in them are samples.
> Read the lines a template inserts against what your control accepts before you run them.
> The form says so ("Review pending: check the inserted code against your machine before
> you run it."), and a button's tooltip says "Not yet reviewed".

| | |
|---|---|
| [The Insert tab](#the-insert-tab) | Where the templates are, and where Program start is |
| [Inserting a template](#inserting-a-template) | The form, the values, the preview, one undo step |
| [Block numbers](#block-numbers) | How the numbers continue, and where they do not; contour numbers of their own |
| [Formulas](#formulas) | A value that is worked out from the others |
| [Templates in completion](#templates-in-completion) | Typing a word on an empty line |
| [Favourites](#favourites) | Starring the templates you use most |
| [Edit Cycle](#edit-cycle) | Changing the cycle at the cursor in a form, or inserting a new one |
| [The template manager](#the-template-manager) | Your own templates: write, copy, replace a built-in one, reorder, delete, save |
| [New Template from Selection](#new-template-from-selection) | Lines of a program become a template |
| [Where your templates are kept](#where-your-templates-are-kept) | The code file, and what is in it |
| [What ships](#what-ships) | The templates of each control |

## The Insert tab

The **Insert** tab shows the templates of the program you are in. A Fanuc lathe program shows
the lathe's templates and not the mill's; a Klartext program shows the Klartext ones. The
list follows the program's dialect, its machine type (mill or lathe) and, on a Fanuc lathe,
the G-code system: a program under G-code system B gets that system's own **Tool start**
(`G92 S` instead of `G50 S`), the same program under system A gets the other. See
[Machines](machines.md#the-fanuc-lathe) for how a program's G-code system is decided.

The tab has these groups:

- **Templates.** One block of buttons for every group the templates are filed under
  (*Program*, *Tool change*, *Drilling*, *Tapping*, *Turning*, *Threading*, …; the group
  names are part of the template and can be your own). The templates the author marked as
  a button are buttons; the rest are in the block's **More Templates…** list. **Favorites**
  comes first when you have starred templates ([Favourites](#favourites)).
- **Cycles** with **Edit Cycle…** ([Edit Cycle](#edit-cycle)).
- **Manage** with **Manage Templates…** and **New Template from Selection…**
  ([the manager](#the-template-manager), [from selection](#new-template-from-selection)).

A built-in template's button carries a small dot and the tooltip "Not yet reviewed"; the
tooltip also shows the template's description.

**Program start**, the first lines of a program in the dialect's own style, is the first button
of the **Templates** group. In a new, empty file it writes into line 1. It is only on the Insert tab.

The same commands are in the command palette (**F1**): *Insert: Insert Template…* lists the
templates of the program in groups, favourites first; *Insert: <template name>* inserts one
directly; *Insert: Edit Cycle…* and *Templates: Manage Templates…* are the other two. None of
these commands has a keyboard shortcut, deliberately; see [Shortcuts](shortcuts.md).

If no program is open, or the active tab is a profile, a code file or the settings, a
template command says so in the status bar and does nothing: templates go into NC programs.

## Inserting a template

Press a template's button (or pick it from the palette). A form opens, titled with the
template's name, with one field for every value the template needs:

- **Starting values.** Each field starts with the template's own sample value, or, for a
  field the template remembers, the value you used last time for this template in this kind
  of program. Empty fields are optional ones. A field with **no choice made** (the Sinumerik
  *Program start* asks *Machining*: turning or milling) has to be chosen before **Insert**
  works. A **contour number** starts at a number the program does not use yet
  ([Contour numbers](#contour-numbers)).
- **Help text** under a field says what it is. A field that offers a fixed list (a
  *Return after each hole* of G98 or G99, say) is a list to choose from.
- **Numbers are kept as you type them.** A template says how a number is written. Most Fanuc
  templates write a length with at least a decimal point, so `10` is written `10.`; others
  write exactly what you typed (`as typed`); some fix the count of decimals, and then more
  typed decimals are **refused**, not rounded. A `+` you type in front of a number is left
  out unless the template writes plus signs (Klartext coordinates are written `X+10`).
- **Refusals.** A field that cannot be used is marked with the reason, in plain words:
  *Enter a value.*, *Enter a number.*, *Enter a whole number.*, *The smallest value is …*,
  *The largest value is …*, *At most … decimals.*, *Write it in upper case.*, *Choose one of
  the values.*, *The text cannot contain …* (a comment text with the comment's closing
  mark in it), *Write it on one line.* and *This dialect has no comments.* A contour number
  the program already has is refused too (*N100 is already on line 12. P and Q need a block
  number of their own.*; [Contour numbers](#contour-numbers)). Nothing is corrected for you.
  While a value is refused, **Insert** is disabled.
- **The machine.** With a machine chosen for the program
  ([Machines](machines.md)), two more things apply. On a Fanuc machine that reads a number
  without a point in increments (IS-B, IS-C), a length or an angle with more decimals than the
  machine has is refused (*At most 3 decimals.* on IS-B): the control would round it. On an
  Okuma machine set to the 1 µm or 10 µm unit, the note at the top of the form says that the
  sample values are for the 1 mm setting: convert every position and feed before you insert.
  Without a machine neither check is made.
- **The preview.** Under the fields the form shows the **text that will be inserted**, with
  the block numbers the program will get. It changes as you type. While a value is refused
  it says "Correct the marked values to see the text."
- **Words that are left empty drop out.** An optional field you leave empty takes its word
  with it, and one space: leave out *Hole position Y* and the line has no `Y` at all. A line
  that would be left with nothing but its block number is not written.

**Insert** writes the lines; **Cancel** writes nothing.

**Where the lines go.** After the block the cursor is in (all lines of a Klartext block
that continues with `~` count as one), not in the middle of it and not over a selection. If
the cursor's line is **empty**, the template **replaces that empty line**, so the program
start of a new file is line 1 and not line 2. The cursor ends at the end of the last
inserted line. The whole insertion is **one undo step**: one `Cmd/Ctrl+Z` takes it back,
renumbering of the blocks behind it included.

**A locked document** refuses the insertion before the form opens, with the usual message
about the lock ([Read-only programs](README.md#read-only-programs)).

If an insertion is refused after you pressed **Insert**, the status bar says
"<template> was not inserted: <the first refused value>".

## Block numbers

A template writes block numbers in the program's own numbering. Where a template line
starts with the block number (`{{N}}` in the template's text), gEdit works out the number
like this:

- It looks for the nearest block number **at or above the cursor**, at most 2,000 lines up,
  and continues with the next one in the program's step: `N70` above, step 10, gives `N80`,
  `N90`, … (written with the program's own digit count). On Okuma only a numeric
  sequence number counts, not a name such as `NLAP1`.
- If there is none above but the program has numbers in the next 200 lines, it starts at the
  dialect's first number.
- If the program has no block numbers near the cursor, the template writes **none**, so an
  unnumbered program stays unnumbered.
- **Klartext is always numbered.** A Klartext template numbers its blocks from the block
  above, one by one.
- A next block number above what the dialect can hold is refused: *The next block number
  would be above … Renumber the program first.*

**The known limit.** Only the lines a template writes are numbered. The blocks **behind**
the insertion keep their numbers, so inserting two blocks into the middle of a Fanuc, Okuma
or Sinumerik program numbered `N10`, `N20`, `N30` gives the new blocks the numbers `N20` and
`N30`, which the program then has twice. Run **Renumber** (NC tab,
[Transformations](transformations.md)) afterwards if that matters to you. **Klartext is the
exception**: every Klartext block carries a number and the numbers are counted, so the
blocks behind the insertion are renumbered in the same edit, one undo step; a continuation
line starting `~` has no number and is left alone. And the number is looked for only
2,000 lines up: a template inserted deeper into a very long program than that, with no
number in sight, starts from the dialect's first number.

**A note when a number is already pointed at.** If a number that the template's own lines
get is one that a `P`, `Q` or `GOTO` of the program points at (a `G71 P130` further down, say),
the note at the top of the form says so: *P130 on line 57 points at N130, and this template
writes a block N130 as well.* The template is still inserted; renumber or move it if that
`P130` should keep its block.

### Contour numbers

Some templates name their own blocks: the Fanuc lathe *Roughing and finishing* writes
`G71 P… Q…` and `G70 P… Q…` and numbers the first and last contour block with those numbers;
the Okuma *LAP roughing and finishing* names its contour (`NLAP1 G81` … `G85 NLAP1`). The
control allows each such number or name **once in a program**: with two `N100`, the cycle
roughs along whichever contour it finds. So:

- The fields start at numbers the program does **not** use: the template's sample (`100`,
  `200`) where the program has no such block and nothing points at it, otherwise the next
  free numbers above the program's highest one, in the program's step. On Okuma the name
  counts up: `NLAP1` is taken, the field starts at `NLAP2`. A remembered value is not used
  for these fields.
- A number you type that the program already has, that a `P`, `Q` or `GOTO` of the program
  points at, that the template's own lines get, or that another field of the form has, is
  refused beside its field. The program is read again when you press **Insert**.
- The same holds for a template of your own that names a block by `N{{…}}`, including one
  made with [New Template from Selection](#new-template-from-selection).

## Formulas

A field can be **calculated**: grey, not typed, and updated as you change the others. The
built-in *Rigid tapping (G84)* template asks for the thread pitch and the spindle speed and
computes the feed, `F = pitch × speed`, for you; with a pitch of `1` and `1000` rpm the form
shows `F1000.`.

The formula is part of the template. In a template of your own you write it in the manager
([Parameters](#the-template-manager)). The language is small and exact:

| | |
|---|---|
| Numbers and names | `4`, `0.05`, `.5`; a name is another number field of the template (`s`, `pitch`) or `pi` |
| Operators | `+  -  *  /  %`, brackets, and a minus in front (`-a`) |
| Functions | `abs floor ceil round sign sqrt ln log sin cos tan asin acos atan`; `round(x)` or `round(x, 3)` (a half goes away from zero: `round(2.5)` is `3`, `round(-2.5)` is `-3`); the angle functions work in **degrees** |
| Not allowed | `^`, implicit multiplication (`2(3)`), exponents (`2e5`), a comma as the decimal sign, any other name |

- **It is exact.** `0.1 + 0.2` is `0.3`, not `0.30000000000000004`. Addition, subtraction,
  multiplication, division (carried to 24 decimals) and `%` work on the decimal digits, so a
  value you type is never turned into a binary approximation. The functions are worked out in
  ordinary floating point and kept to 15 significant digits; `sin(30)` is exactly `0.5`.
- **The result is rounded only to the field's own decimals** (to the fixed count the field
  says, or to four decimals where it writes the digits as they come), half away from zero,
  and written like a typed number: with at least a decimal point where the field says so.
- **There are no units.** Values are worked out in the units you type them, millimetres or
  inches, degrees for angles. A constant such as the `1000` in `pi * d * n / 1000` is the
  author's: if the template is for millimetres and you work in inches, the formula does not
  know.
- **An empty field makes the result empty**, and the word is dropped, like any empty optional
  field.
- **A formula that cannot give a value stops the insertion.** *Division by zero in …*, *…:
  sqrt cannot take …* (a root of a negative number, `tan(90)`, `ln(0)`, `asin(2)`), a result
  above 1,000,000,000 (*… is too large.*) or an input that is not a number (*… reads …, which
  is not a number.*) are shown in the form, and nothing is inserted until the values change.
- **A formula that does not parse, or reads a text or itself in a circle, is found when the
  file is read** and reported in the Results panel; that template is left out until the file
  is corrected.

## Templates in completion

On a line that has **nothing before the word you type** (indentation is fine, a block number
or an earlier word is not), completion offers the templates of the program next to the
codes. Type the first letters of the name or of any word of it: `peck` finds *Peck drilling
(G83)*, and `peck d` too. On an empty line, the completion key brings up the whole list, templates first.

- Pick one with `Tab` (in gEdit `Enter` goes on to a new line, as it does for the codes).
  Each entry shows *Template: <group>* and the template's description, and "Not yet
  reviewed" for a built-in one.
- A template with fields opens its form, as if you had pressed its button. If you cancel the
  form, the word you had typed comes back (while the line is still empty). A template that is
  a **snippet** (a template of your own written with tab stops, see
  [Templates in a file](#what-a-template-is-made-of)) is written straight into the line.
- Templates are never offered inside a comment, a string or a call.

Completion is set on `Settings ▸ Assistance`; if you have it on *manual*, press the
completion key (`Ctrl+Space`) first.

## Favourites

Star the templates you use most in the manager (the star on a row, or the **Add to Favorites** /
**Remove from Favorites** button). Starred templates form a **Favorites** group at
the front of the Insert tab. The stars are one list for the manager and the Insert tab, kept
per code set (per kind of program), at most 200 of them; they are a preference of yours and
change nothing in any template or file. A lathe under G-code system B has its own stars,
separate from those of system A.

## Edit Cycle

**Edit Cycle…** (Insert tab, group *Cycles*, or *Insert: Edit Cycle…* in the palette) changes
the cycle in the block at the cursor in a form instead of in the text. It works on the words
of the block as they are written, not by matching a template, so it also works on a cycle
that a post-processor wrote.

Put the cursor on a cycle block, say a Fanuc `G98 G83 X20. Y60. Z-18. R3. Q4. F240.`, and
choose Edit Cycle. The form is titled with the cycle (*G83: Peck drilling cycle*) and has one
field per parameter of the cycle, shown as `X — Hole position X`, filled in with what the
block says, **as written**:

- Change the values you want and press **Apply**. **Only the words you changed are
  rewritten**, each in its own number form: `R3.` changed to `2` is written `R2.`, `F240.`
  changed to `240.000` is written `F240.000`. Everything else is left exactly as it was:
  other words of the block, the spacing, `G98`. A word the cycle does not list (an `H5` on a
  `G83`) is **kept**, and the form says so: *Kept as written: H5*.
- **Nothing changed** is nothing written: the block stays byte for byte, and the status bar
  says "The cycle was not changed."
- **Clear a field** to take an optional word out (the word and one space go). A required one
  cannot be cleared: *This value is required; it cannot be cleared.*
- **Fill in an empty field** to add an optional word: it is placed after the block's last
  parameter word, in the order of the code database (`… F240. K2`), and gets a decimal point
  if it is a length, an angle or a feed on a control that cares.
- **The text under the fields** shows the lines the block would become, and errors stand
  beside the field they belong to. **Apply** is disabled while one is shown.
- It is **one undo step**, and the status bar says "Changed the G83 block."

**The checks are the inspector's.** A value is checked as it is when you change one in
the [code inspector](inspector.md#changing-a-value): a word without a decimal point under a
machine that reads it in increments takes only a whole number of increments; a number
whose reading depends on a machine that is not chosen is refused, with the reason, rather
than guessed; and nothing is rounded. With a machine chosen, a value with more decimals than
the machine has is refused (*The value does not fit the form this word is written in; it
would have to be rounded.*). A field shows the value **as written** (`Q4000` shows `4000`);
when the machine reads it as something else, the help under the field says so: *Written
without a point: 4000 = 4 mm on this machine. Type the value as it is written.* A value that
is a variable, an expression or a word (`Z#101`, `Q206=FAUTO`, a Sinumerik argument
`R1`) is shown but is not edited here: *The value is a variable or an expression; edit it
in the text.*

**By dialect.**

- **Heidenhain Klartext:** a cycle is a block over several lines. A `Q` line is changed after
  the `=` only (`Q201=-15` to `Q201=-16.5`). A depth (`Q201`, and `Q344` of cycle 240) has to
  be negative or zero: a positive one reverses the cycle, and the form refuses it (*The largest
  value allowed is 0.*). A `Q` line that was not there is added in the
  database's order, indented like the others, with its label in capitals (the control writes
  its labels that way), and the `~` marks at the line ends stay right. A cleared optional
  `Q` line is removed, and the line before it gives up its `~` if it is the last.
- **Sinumerik:** the arguments of `CYCLE83(5,0,2,-30,,-8,,2,0,0.5,1,0)` are read **by
  position**. Clearing the last written argument drops it with its comma; clearing one in
  the middle leaves it empty. An `MCALL CYCLE83(…)` line is edited the same way.
- **Okuma:** the `G181` and other cycle blocks are edited word by word, like Fanuc. A
  one-block cycle written twice in a row (two `G74` blocks) is two cycles, each with its own
  form.

**Where Edit Cycle says no.** It tells you in the status bar, in plain words, and opens no
form:

- *This cycle is written in two blocks. Edit it in the text, or insert it from a template.*
  The lathe roughing and threading cycles `G71` to `G76` in their two-block form have
  parameters that belong to the first or the second block, and a form could put a word in
  the wrong one. Their templates insert both blocks.
- *This block runs the cycle written on line N. Edit the cycle there.* A position line
  under a modal cycle (`X80.` after `G83`, a Klartext `CYCL CALL`, a Sinumerik position
  after `MCALL`) is not the cycle: edit it where it is defined.
- *This cycle is not confirmed in the code database yet, so it has no form.*
- *The code database lists no parameters for this cycle.*
- *The block is too long to edit in a form.* (More than 100 lines or a line over 4,000
  characters.)
- *The block has changed since the form was opened. Open the form again.*
- A locked program: the usual lock message.

**A new cycle.** If the cursor is on **no cycle**, Edit Cycle asks which cycle you want
(*There is no cycle at the cursor. Choose a cycle to insert*; every cycle with parameters in
the program's code database), opens the same form empty, and **Insert** writes a new block
after the current one, with the next block number and the Klartext renumber as for a template
([Block numbers](#block-numbers)), in one undo step. A Sinumerik turning cycle is also listed
in a milling program and the other way round: the code database is shared and the list is not
filtered by machine type.

- **A cycle that stays on gets its end.** A Fanuc drilling cycle (`G73` to `G89`) or an Okuma
  `G181` and the like stays on until it is cancelled: every following position would drill.
  So the new cycle is inserted **with `G80`** (Okuma: **`G180`**, alone in its block) as the
  next block, and the note says *The cycle stays on until G80. Put further hole positions
  between the two blocks.* On Okuma the block after `G180` has to move X and Z.
- **Not inside a cycle that is on.** With the cursor on a block where such a cycle is still
  on (between a `G83` and its `G80`), Edit Cycle inserts nothing: *Cycle G83 on line 20 is
  still on here. Insert the new cycle after its G80.* A new cycle there would change what the
  next hole position of the old one does.
- **Sinumerik drilling cycles run at once.** A `CYCLE81` to `CYCLE89` call (not tapping)
  drills where the tool stands, with the feed in force; the note says so. Program the feed
  before the block (the Sinumerik drilling templates do), or use `MCALL` for several holes.

## The template manager

**Manage Templates…** (Insert tab, group *Manage*, or *Templates: Manage Templates…* in the
palette) opens the manager for the **code set of the program you are in**: the set that
holds its templates, for instance `fanuc-lathe`. The *Code set* list at the top switches to
another one, built-in or of your own. It needs a program to be open, since the preview
uses that program's dialect and numbering.

The list shows the built-in templates **that code set offers a program**, the ones the Insert
tab, the quick pick and completion would offer: the lathe's set lists the lathe templates,
not the mill drilling and tapping templates it inherits, and the mill's set the mill ones.
A set that programs of both kinds use (the Siemens one) lists both.

**The list.** Templates are listed by group, with a *Search* box (name, group or id). A row
shows a badge:

| Badge | Means |
|---|---|
| **Built-in** | A template that ships with gEdit. **Read-only**: you cannot change it here |
| **Review pending** | The built-in template has not been checked against the manuals and a machine yet |
| **Yours** | A template in your own file |
| **Yours, replaces the built-in** | Your template has the same id as a built-in one and takes its place |
| **Cannot be read** | An entry in your file that gEdit cannot read as a template |
| **1 problem** / **N problems** | Something in the template would stop it from being saved |

The star on a row is the [favourite](#favourites).

**What you can do** (the buttons above the list):

- **New** adds an empty template of your own.
- **Duplicate** copies the selected template under a **new id** (`<id>-copy`), into your
  file, to change from there. The copy is a template of its own.
- **Change a copy** (on a built-in template) copies it with **the same id**: your copy
  **replaces the built-in one** wherever the id is looked up, the Insert tab and completion
  included. The built-in row is hidden while your copy exists. A copy is whole: it does not
  merge with the built-in text.
- **Delete** (your own templates only) asks *Delete "<name>"? It is removed from your file
  when you save.* If it was a copy of a built-in one, deleting it **brings the built-in one
  back** when you save.
- **↑ / ↓** move one of your templates up or down in your file's order. The built-in rows
  cannot be reordered.

**System B.** If the selected built-in template has a different version for another
G-code system (the Fanuc lathe's *Program start* and *Tool start* in system B), the manager
says so, on that template only: *G-code system B documents use their own version of this template (fanuc-lathe-b).*

**The editor.** Selecting a template of yours shows what it is made of:

- **Name** (the label), **Id** (lower-case letters, digits and `-`, up to 64 characters: it is
  what the command is called, and what makes a copy replace a built-in one), **Group** (the
  Insert tab block it goes in), **Description** (the tooltip), **Machine type** (*Any
  machine*, *Milling machines only* or *Lathes only*; a program of the other kind does not
  see it), **Button on the Insert tab** and **Snippet**.
- **Text.** The lines of the template in a plain monospace box. Buttons insert
  placeholders at the cursor: the **next block number** (`{{N}}`, written at the very start
  of a line), the **system** values (`{{sys.date}}`, `{{sys.time}}`, `{{sys.file}}`,
  `{{sys.stem}}`: the date, the time, the file name and the file name without its
  extension, filled in when the template is inserted), and one button for every parameter
  (`{{z}}`: the value of the field *z*). A literal `{{` is written `\{{`.
- **Parameters.** *Add parameter* adds a field. Each has an **Id (used in the text)**, a name
  (the form's label), a **Kind of value** (*Number*, *Whole number*, *Text*, *Choice* or
  *Calculated*), a **Help text**, and the settings that belong to the kind: **Required**,
  **Smallest value** and **Largest value**, a **Starting value**, **Choices** (a name and a
  value each), **Written before** and **Written after** (`Z`, `F`, up to 16 characters),
  **Decimals** (*Not set (as typed)*, *As typed*, *At least a decimal point (10 becomes
  10.)*, or a fixed number), **Digits** (padding of the whole part), **Write + before a
  positive number**, **Only upper case**, **Write in a comment** (the text is wrapped in the
  dialect's comment marks), **Remember the last value**, **Not shown in the form** and, for
  *Calculated*, the **Formula** with its check beneath it. Changing the kind drops the
  settings that do not apply to the new one. Renaming a parameter's id rewrites `{{old}}` in
  the text and in the formulas, from the last valid id to the new valid one (while you type,
  an empty or invalid id changes nothing).
- **Preview with the starting values.** The text as the engine would write it from the
  starting values, in the open program's dialect and numbering. A required field without a
  starting value says so instead of showing a wrong text.

**Problems are shown as you work.** Each template of yours is checked every time it changes;
a problem is shown with the place in plain words, such as *Drill 8 › Parameter 2 (Depth) ›
Smallest value*. The check stops at a template's first problem, so one shows at a time.

**Save** checks the whole list and then writes your file. The rules, in plain words:

- **One problem anywhere means nothing is saved.** The message reads *Not saved: N problems in
  your templates. Fix them and save again.*, each problem is listed with its place, and your
  file is untouched. gEdit refuses rather than shortens or fixes: a text over its limit, an id
  used twice, a placeholder that names no field, a `{{N}}` that is not at the start of a line,
  a *Smallest value* above the *Largest*, a starting value out of range, a formula that does
  not parse or reads a text or itself, a snippet that has fields.
- **The file** is `<config>/codes/<code set>.json` ([Where your templates are
  kept](#where-your-templates-are-kept)). If it does not exist yet, Save **creates** it. If it
  does, only its `templates` list is replaced; every other member keeps its place and value.
- **The file's tab opens and stays open**, and the save is an ordinary save: the backup copy is
  made as the settings say ([Before a save](README.md#before-a-save-the-backup-copy)), and the
  change is **one undo step** in that tab.
- **The file must not have unsaved changes.** If it is open and edited: *Save or close <file>
  first.* If it changed on disk since the manager read it: *<file> has changed since the
  manager read it. Reload it with Revert.* A file that is open **locked** (you locked it, or it
  is read-only on disk) gets the usual message about the lock (*<file> is locked against editing,
  so saving the templates did not run*), and nothing is written: unlock the tab and save again.
- **A save that does not happen leaves the file as it was.** If the disk refuses the write, or
  you cancel a question the save asks (such as saving as UTF-8), the file's tab is put back as it
  was and is not marked changed; the message says so (*<file> could not be saved, so nothing in
  it was changed. Try again.*) and the next Save works.
- **A list that would make the file larger than 1 MiB** is not saved (*<file> would be larger than
  1 MiB, which is more than the program reads ...*): gEdit reads no larger file, so the templates
  would not load at the next start. Delete templates you do not need.
- When it has worked, *Saved <file>.* The new templates are on the Insert tab and in
  completion at once.
- **A file that is not valid JSON**, or holds more than one JSON object, is reported at the top
  and blocks saving: open the file (**Open file**) and correct it first.
- **A template gEdit cannot read** that is already in your file is listed as *(unreadable
  entry)* with its problems: *This entry cannot be read as a template. It stays in the file as
  it is. Delete it here, or open the file and correct it.* It is written back with the same
  values when you save and never edited by the manager; the file is written again as JSON, so a
  number such as `1.50` in that entry becomes `1.5` and its spacing is the manager's.
- **A template with a note**, for instance a flag written as `"yes"` instead of `true`, is
  saved without the mistyped member.

**Revert** reads the file again; **Close** asks first if there are unsaved changes (so does
leaving the dialog any other way, and changing the code set): *The changes to <file> are not
saved. Leave without saving them?* with **Discard changes**. A new template from the selection
that you have started (a number ticked or a name typed) counts as a change (*The new template is
not added yet. Leave without adding it?*). The question comes once, however often you press Esc.
**Enter never saves.** **Open
file** opens your templates file in a tab.

## New Template from Selection

Select the **whole lines** of a program that make the block or blocks you want to reuse (up
to 200 lines), and choose **New Template from Selection…** (Insert tab, group *Manage*, or
the palette). With nothing selected gEdit says *Select the blocks to turn into a template
first.*

The manager opens on **New template from the selection**, with the lines in a box:

- **The block numbers become `{{N}}`**, the next block number, so that the template numbers
  itself wherever it is inserted. A Klartext block number and a Fanuc `N` both qualify. A
  block number behind a block-delete slash (`/N40`) stays as written, and the draft says so;
  check it before you insert the template into the same program.
- **A block that the selection points at keeps its pointer.** When a line of the selection
  points at a block of the selection (a lathe `G71 P120 Q140` and its contour `N120` … `N140`,
  a `GOTO 70` and its `N70`, a Sinumerik `GOTOF N60`, an Okuma `G85 NLAP1` and its `NLAP1`),
  the number becomes **one field** written in both places (`N{{p}}` and `P{{p}}`), not
  `{{N}}`. It is always a field (there is nothing to tick: a `P` without its `N` would point
  nowhere), and when you insert the template the form offers a number the program does not
  use ([Contour numbers](#contour-numbers)). A pointer to a block **outside** the selection
  (`G70 P100 Q200` without its contour) stays as written, and the draft says so. A Klartext
  label (`LBL`, `CALL LBL`) stays as written as well.
- **The numbers in the lines are buttons you can tick** (*Click the numbers that should become
  values you fill in when you insert the template.*). Tick the `Z-5.` and it becomes a field,
  `{{z}}`, with `-5.` as its starting value and *Hole bottom (Z)* or the cycle's own parameter
  name as its label. **Select all** and **Select none** do what they say; the count tells you
  how many numbers and how many values you have.
- **The same value written twice becomes one field** (a `Z-5.` that appears in two blocks):
  ticking one ticks both. A second, different value for the same address is `z_2`, and so on.
- **What is offered:** plain numbers after an address (`X20.`, `F240.`), and variables that
  are set to a plain number (`Q200=2`, `#101=5`). **What never is:** codes (`G83`, `M3`,
  `R0`), block and program numbers, tool numbers inside a call, comments, strings, calls,
  expressions (`X#1`, `Q1=Q2+1`, `X=IC(2)`) and numbers written with a decimal comma. They stay
  in the text as they are. A `{{` inside a comment is escaped.
- A number written with a point stays a number that is written with a point; a whole
  number of a count or an index stays a whole number; a `+` in front is kept. A word the
  control reads in **least increments** (the lathe pecks `Q` of `G74`, `G75`, `G76`, `G83`)
  becomes a whole-number field, labelled *(least increments, no point)*: a point is not
  allowed there.

Give the template a **Name**, check the **Id** (made from the name; it must be unused, and a
built-in id is refused, so you never replace a built-in template by accident: *A template
with the id "…" exists already. Choose another id.*) and the **Group** (*My templates* to
begin with), then press **Add template**. It becomes a template of yours in the list, and
gets the program's machine type (*Milling machines only* or *Lathes only*) when the program
has one. It is **not saved yet**: look it over, change the text or the fields as you like, and
press **Save**. **Cancel** drops the draft.

## Where your templates are kept

Your templates are the `templates` list of a **code file** in your code files folder,
`<config>/codes/`, the same folder as your own G and M codes ([Your own profiles and code
files](profiles.md#code-files-your-own-g-and-m-codes); [where the folder
is](README.md#where-things-are)). The manager writes `<code set>.json` there: for the
Fanuc mill's templates `fanuc.json`, for a Klartext program `heidenhain.json`.

- A file with the **name of a built-in code set** adds to that set. The built-in templates
  stay, yours are laid over them **by id**: an id that is new is added, an id that exists is
  **replaced whole** by yours. A Fanuc lathe program also reads the Fanuc mill's set, so give a
  template its machine type to show it only to programs of that kind.
- A file for a **set of your own** (`shop-lathe.json`, which `extends` a built-in one) holds
  the templates of that set and the parents' templates stay available through `extends`.
- The file reloads when it is saved, so a template you write by hand and save in a tab is
  there at once. **Reload Profiles** (Tools tab) reads the folder again.
- A template in the file that gEdit cannot use is **left out and listed in the Results panel**
  with the file and its place in it (for example `templates[3].params[1].formula`). It never
  hides a built-in template that has its id. The rest of the file loads.

### What a template is made of

You rarely need to read the file; the manager writes it. If you do edit it by hand:

```json
{
  "dialect": "fanuc",
  "version": 1,
  "templates": [
    {
      "id": "spot-drill",
      "label": "Spot drilling (G81)",
      "group": "My templates",
      "description": "Spot drill with a fixed depth.",
      "toolbar": true,
      "machineType": "mill",
      "body": "{{N}}G81 X{{x}} Y{{y}} Z{{z}} R2. F{{f}}\n{{N}}G80",
      "params": [
        { "id": "x", "label": "Hole position X", "type": "number", "default": "10", "decimals": "min1" },
        { "id": "y", "label": "Hole position Y", "type": "number", "default": "10", "decimals": "min1" },
        { "id": "z", "label": "Depth", "type": "number", "required": true, "default": "-3", "decimals": "min1" },
        { "id": "f", "label": "Feed", "type": "number", "required": true, "default": "120", "min": 1, "decimals": "min1" }
      ]
    }
  ]
}
```

| Member | |
|---|---|
| `id`, `label`, `group` | **Required.** `id`: lower-case letters, digits and `-`, up to 64 characters |
| `body` | **Required.** The text, lines separated by `\n`. `{{N}}` is the next block number and may stand only at the very start of a line; `{{sys.date}}`, `{{sys.time}}`, `{{sys.file}}`, `{{sys.stem}}`; `{{<id>}}` a field; `\{{` a literal `{{` |
| `description`, `toolbar`, `machineType` | The tooltip; `true` for a button on the Insert tab; `"mill"` or `"lathe"` to show it only to programs of that kind |
| `snippet` | `true` for a template with editor tab stops (`${1:text}`) in the body and **no fields**: it is written straight into the line and offers no form |
| `params` | The fields, at most 40, each with `id` (a lower-case letter or `_`, then letters, digits or `_`, up to 32; not `sys`, `pi`, `__proto__` or a function name), `label`, `type` (`number`, `integer`, `text`, `choice`, `formula`) and, where they fit the type: `help`, `required`, `min`, `max`, `default`, `choices` (a list of `{ "label", "value" }`, up to 50), `prefix`, `suffix`, `decimals` (`"as-entered"`, `"min1"` or a count 0 to 6), `digits` (1 to 9), `plusSign`, `uppercase`, `comment`, `remember`, `formula`, `hidden` |

A number `default` is at most 40 characters, and no text of a template (the `body`, a `prefix`, `suffix`, text `default` or choice `value`) may hold an invisible control character other than a tab; a template that does is left out with that reason.

A member on a kind it does not fit (`decimals` on a text, `choices` on a number, `required` on a
formula) is a problem and the template is left out. An unknown member is ignored; a flag that
is not `true` or `false` is reported and read as absent. The **limits** keep one file from
making the Insert tab unusable: 200 templates per file; a body of at most 8,000 characters and
200 lines; a name of at most 80 characters, a group of 40, a description of 500, a help text
of 300, a prefix or suffix of 16. Nothing is shortened for you.

A template of the built-in sets also carries `"review": "pending"`; gEdit reads no other value
of it, and a template of yours does not need it.

## What ships

Every built-in template is marked *Review pending*. The names are as the Insert tab shows them.
Bold are the buttons, the others are in *More Templates…*.

| Control | Templates |
|---|---|
| **Fanuc mill** | **Program start**, **Tool change**, **Drilling (G81)**, Drilling with dwell (G82), Peck drilling (G83), Chip-breaking drilling (G73), Rigid tapping (G84), Boring (G85), Tool end, **Program end** |
| **Fanuc lathe** | **Program start**, **Tool start**, **Roughing and finishing (G71, G70)**, **Threading (G76)**, Grooving (G75), Drilling on the face (G83), Tool end, **Program end**. The G-code system B version of *Program start* and *Tool start* is its own |
| **Heidenhain Klartext** | **Program start**, **Tool call**, **Drilling (cycle 200)**, Universal drilling (cycle 203), Rigid tapping (cycle 207), Centering (cycle 240), Straight move (L), Circle around a centre (CC, C), Program stop, **Program end** |
| **Okuma lathe** | **Program start**, **Tool start**, Face drilling (G74), Threading (G71), LAP roughing and finishing (G85, G87), Driven-tool drilling (G181), Tool end, **Program end** |
| **Sinumerik turning** | **Program start**, **Tool start**, Stock removal (CYCLE95), Thread turning (CYCLE99), Tool end, **Program end** |
| **Sinumerik milling** | **Program start**, **Tool change**, **Drilling (CYCLE81)**, Drilling with dwell (CYCLE82), Deep-hole drilling (CYCLE83), Rigid tapping (CYCLE84), **Program end** |

The Sinumerik **Program start** and **Program end** are one template for turning and milling;
*Program start* asks which (*Machining*), with **nothing chosen** until you pick turning or
milling. A sample job is behind every default; read the values as examples to overwrite, not
as a recommendation for your machine. Some things the templates do on purpose:

- The Sinumerik drilling templates (`CYCLE81`, `CYCLE82`, `CYCLE83`) program the **drilling
  feed in a block of its own before `MCALL`**: a feed written after `MCALL` would drill at once
  where the tool stands.
- The Fanuc lathe *Roughing and finishing* moves to the **cycle start point** (`G0 X… Z…`, a
  point outside the stock) before `G71`; `G70` returns there.
- The Klartext depths (`Q201`, the centring diameter `Q344`) take **no positive value**.
- The Okuma sample values are for the **1 mm unit setting** (`X600` is 600 mm); the template
  descriptions say so, and the form warns on a machine set to 1 µm or 10 µm.
- The Fanuc *Rigid tapping* computes `F` as pitch × speed, a feed **per minute**: `G94` has to
  be in force (the Fanuc *Program start* writes it); the template does not write `G94` itself,
  because it would stay in force for the rest of the program. The dwell `P` of the Fanuc
  cycles is in least time increments (1 ms on an IS-B control).
- The `CYCLE95` *Largest depth of cut* is a radius or a diameter depending on `DIAMON` and the
  machine's cycle setting: check it before the first run.

## Limits

- The templates are only as good as the manuals they were written from, and they say
  *Review pending*. Check what they insert before you run it.
- A template inserts text. It does not know your tools, your work offsets or your machine
  beyond the dialect, the machine type and the G-code system of the program.
- Only the lines a template writes get block numbers; see [Block numbers](#block-numbers) for
  what that leaves behind.
- Edit Cycle does not edit a cycle that is written in two blocks, nor one that is a variable
  or an expression.
- A formula has no units.
- The manager does not reorder built-in templates, import or export a single template, or
  edit the other members of the code file. Copy the file, or open it in a tab, for that
  ([Sharing and backing up](profiles.md#sharing-and-backing-up)).
- A template of yours works for the programs of the code set it is saved in. To use it in
  another dialect, make it there ([New Template from Selection](#new-template-from-selection)
  in a program of that dialect).
