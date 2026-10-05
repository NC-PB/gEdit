# Scripts

A script is a small Python program that reads your NC code and gives something back: new
code, or a table. Scripts are how gEdit is extended. Scaling feeds, scaling spindle speeds,
listing tools, checking a program, finding its extents and doing arithmetic on address
values are done by scripts that ship with the app, and they use exactly the same contract
as one you write yourself — so if a bundled script is nearly what you need, copy it and
change the part that is not.

> **Only run scripts you trust.** A script is an ordinary program running with your rights:
> it can read and write your files and reach the network. gEdit does not sandbox it.
> See [Security](#security) at the end of this page.

## What you need

Python **3.9 or newer**. Nothing else — no `pip install`, no packages. The bundled scripts
use the standard library only, on purpose: you should be able to run them on a fresh
machine.

gEdit looks for an interpreter at startup, in this order:

1. The `GEDIT_PYTHON` environment variable, if it is set.
2. `Settings ▸ Scripts ▸ Python interpreter`, if it names a file that exists. Point this
   at a virtual environment's interpreter if you want one.
3. The interpreter your own command line would run.
   - **macOS and Linux**: `python3`, looked up through your login shell — so a Homebrew or
     python.org install is found even when you started gEdit from the Dock — and then in
     the usual install locations.
   - **Windows**: the `py` launcher first, asked which interpreter `py -3` would start,
     then `python`, then `python3`. Each is looked for where a command prompt would find
     it — the Windows folder included, so a launcher installed for all users is found
     whatever is on `PATH`.

`GEDIT_PYTHON` is read from the environment gEdit was started with: a variable exported in
a shell profile reaches it only when gEdit is started from that shell, not from the Dock or
Finder; on Windows, set it as a user environment variable. gEdit looks again when you
change the interpreter setting; after installing Python while gEdit runs, restart it.

**If no interpreter is found — or only one older than 3.9 — the commands that run a script
are disabled and say so. Everything else in gEdit keeps working**, writing and editing
scripts included. On Windows that covers the case that looks least like it: a
clean Windows 10 or 11 already has `python.exe` and `python3.exe` on `PATH` before Python
is installed, as placeholders that open the Microsoft Store instead of running anything.
gEdit never takes one of those for an interpreter, and the Tools tab says "Python 3.9 or
newer was not found". A Python you really did install from the Store is used as usual.

## Running a script

Scripts are in the **Python Scripts** group of the **Tools** tab — a subfolder's scripts
under its name, the rest under "Scripts" — with the script's own description as the
tooltip. A script that declares which dialects it is for is only offered on those.

| | |
|---|---|
| Pick a script from a list | **F9** |
| Run the last script again | **Cmd/Ctrl+F9** |
| Run a particular script | Its button on the Tools tab, or its own entry in the `F1` command palette |

**Cmd/Ctrl+F9 does not ask again.** It runs the last script straight away, with the values
you used last time — running the same thing again is what the command is for. To change a
parameter, start the script from **F9** or from its Tools button, which opens the form.

What then happens, in order:

1. **Parameters.** If the script declares any, a form opens, pre-filled with the values you
   used last time for that script. A script without parameters runs immediately.
2. **The input.** Most scripts take the selection, or the whole program when nothing is
   selected. A selection is extended to whole lines. The text goes to the script as UTF-8
   with LF line endings, whatever the file's own encoding and line ending are.
3. **The run.** The status bar shows that a script is running: click it to stop the run.
   The **Script Output** panel has a **Stop** button too. One script runs at a time.
4. **The result.** What happens depends on the script — see below.

A run that takes longer than the time limit is stopped. The limit is
`Settings ▸ Scripts ▸ Script timeout` (60 seconds by default) unless the script's own
header sets one. A stopped or cancelled run changes nothing.

### What comes back

| The script declares | What gEdit does with its output |
|---|---|
| `replace` | Replaces the input lines, as **one undo step** |
| `new-document` | Opens the text in a new untitled tab, in the same dialect |
| `report` | Shows a table and findings in the **Results** panel; a row with a line number jumps there when you click it |
| `panel` | Shows the raw output in the **Script Output** panel, with a **Structured result** section when it is JSON |

`panel` is also what a script with no header gets, and what a script with a header gEdit
could not read gets. That is deliberate: a half-understood script must never be treated as
one that may rewrite your program.

### When nothing is applied

The safety rules, in the order they are checked — so the message you get names the cause,
not whatever failed first:

1. **You cancelled it.**
2. **It ran out of time.**
3. **It ended with an error** (a non-zero exit code, or it was killed). Whatever it wrote
   on its error output is shown.
4. **Its output was cut off** at the size cap. A prefix of a program is a program that
   ends in the middle of a cut, so it is refused rather than applied.
5. **It did not return a usable result**: a `report` whose JSON is not a report, or an
   envelope whose JSON is not `{"text", …}`.
6. **It produced nothing**, in `replace` mode. Otherwise a broken script would silently
   delete your selection.
7. **You edited the document while it ran.** The answer no longer fits the question: the
   lines it would overwrite have moved. Nothing is applied, and a dialog — *The program
   changed while the script ran* — offers **Open in new tab** so the work is not lost.
8. **You locked the document while it ran**, in `replace` mode. Nothing is written into it;
   the same **Open in new tab** is offered.

A run can also be refused before it starts: no program is open, the script is not for this
dialect, it needs a selection, its header asks to replace an input it does not take, it
would replace the text of a locked (read-only) program, another script is running, or no
Python was found. The status bar says which. A script in any other mode still runs on a
locked program: it changes nothing there.

Nothing is ever applied silently: every run ends in a summary, a result, or a message
saying why not.

## The scripts that ship with gEdit

They are read-only. To change one, use **Copy to My Scripts** in the `F1` palette, or
**Edit Script**, which offers the copy (**Copy and edit**). The copy lands in your own
scripts folder, where it takes the place of the bundled one with the same file name, and
gEdit opens it for editing. A file of that name already in your folder is never
overwritten: the copy is refused and says so.

### Scale feed rates

Multiplies `F` values by a percentage.

| Parameter | |
|---|---|
| Percentage | 0.1 to 1000; 100 % leaves every feed as it is |
| Decimal places | As written, or 0 to 4 |
| Smallest feed / Largest feed | A scaled feed outside the range is pulled back to it. Empty means no limit |
| Only feeds above / Only feeds below | Leaves the others as they are |
| The limits are in | Which feeds the four values above are compared with: *automatically* (per revolution on a turning dialect, per minute on a milling one), *feed per minute* or *feed per revolution*. A feed in the other unit is scaled **without** the limits, and the run says so, so a largest feed of 0.3 meant per revolution never lowers a feed per minute |
| Also scale per-revolution feeds | Automatically, yes or no. **Automatically** scales them on a turning dialect and leaves them alone on a milling one, which is what each of them usually wants |
| Also scale inverse-time feeds | `G93`, where `F` is the reciprocal of the time the block may take. Off by default |

With **As written** a value keeps the decimals it was written with. Whatever the decimals,
the run warns when rounding puts a result more than 5 % away from the exact value (`F0.3`
at 50 % becomes `F0.2`). Where the decimal point matters, a feed written without one never
gets one, and a value that would round to zero is left as it was and reported.

It leaves alone, and reports, the feeds it must not touch: **thread leads** (in a tapping
or threading cycle the `F` carries a lead rather than a feed rate — the finding names the
code of the block, so you can see which cycle it was) and feeds written as a variable
(`F#101`, `F=R1`, `F=V1`): the control works out those values, gEdit cannot. A feed written
under an address of its own — a chamfer feed `FRC=`, the `FA=` of a change of cutting
conditions — is not the `F` word either; it is reported and left. An Okuma line that starts
with `$` belongs to the block above it, whether or not a blank follows the `$`, so the lead
a `G71` thread cycle carries on its `$` line is a thread lead like any other. Klartext
`FMAX` and `FAUTO` are not numbers and are never touched; an `F` on a rapid block (`G0 … F`)
is scaled like any other. A value written with a Klartext decimal comma (`F1000,5`) is
scaled like any other and written back with its comma; a limit compares it correctly too.

**A thread lead is a lead only where the database says so.** The `F` of a threading code is
never scaled. A tapping cycle is different: its `F` follows the feed unit in force, so under
`G94` it is a feed per minute and is scaled like one (it used to be taken for a feed per
revolution, which is a hundred times too small on an Okuma set to 1 µm). Its speed is still
left, as below. A Sinumerik `G33`, `G331`, `G332`, `G335` or `G336` takes its lead from `I`,
`J` or `K`: the block's `F` does not cut the thread, stays the feed in force, and is left as
written with a finding that says so. After a Sinumerik `G931` an `F` is a travel time, not a
feed: it is never scaled, whatever the options, and each one is reported.

**A feed in another unit than the limits is scaled without the smallest and largest feed.**
A feed per tooth or an inverse-time feed has no unit the limits could be compared in; it is
scaled and reported. With no machine, a Fanuc feed written without a point and per revolution
has no value either ([machines.md](machines.md#not-every-word-is-read-the-same-way)); it is
scaled and not compared. This holds only when the run sets the smallest or largest feed and
no filter. **With "Only feeds above" or "Only feeds below" set, such a feed is left as
written** and reported as a warning, and the summary says how many were left because the
filter cannot be compared with them: a feed in another unit and one with no value are not
guessed at.

**A Fanuc lathe `G71`, `G72` or `G73` without a `P` is refused while no machine is chosen.**
On a Fanuc lathe these roughing cycles carry `P` and `Q` (or `U` and `R`), and the `F` is a
feed. The same `G71 X… Z… F2.` with no `P` is an Okuma thread cycle, whose `F` is the lead,
and a program whose dialect was only guessed could be either. The `F` is left with a warning
that says so; choose a machine for the document to have it scaled, or scale the block by
hand.

**A code that means two things is refused.** Some codes cut a thread on another kind of
machine, in the other G-code system or on another make of control — `G76` and `G92` on the
Fanuc mill profile, `G74` and `G78` (system A) or `G74` and `G92` (system B) on the Fanuc
lathe, `G76`, `G84`, `G88` and `G92` on an Okuma. Nothing in the block says which reading is
meant, so their `F` is left alone with a warning — "threading cycle" for the codes above,
and "**tapping** cycle" for Okuma's `G84` and `G88` and the Fanuc lathe's `G74`, whose other
reading is a tap rather than a thread (their speed is left too, below).

**An `F` under a code the dialect's database does not know is reported and left, not
scaled**, when that code is written under the letter the dialect writes its moves with
(`G` on the ISO dialects; Klartext has none). A builder's own cycle may take that word as
something other than a feed rate, and scaling it changed a real program's radial tapping
lead before this rule existed.

**The words of a `G65`/`G66` macro call and a `G10` offset block are arguments or data, not
feeds.** They are reported and left, whatever letter they are written under.

**A dwell is not a feed.** In a dwell block the `F` word is a time — Okuma `G04 F2`,
Sinumerik `G4 F2` — so it is never scaled and not counted as a feed rate; the summary says
how many dwells it left as written.

**Cycles written as calls.** A Sinumerik cycle such as `CYCLE85(…)` or `CYCLE95(…)` carries
its feeds as arguments. They are listed and left as they are. A tapping cycle written that
way stands in a block of its own and has no `F` of its own; the one that can take its lead
from the feed in force (`CYCLE840`, tapping with a compensating chuck and no spindle
encoder, where the feed is the speed times the pitch) leaves that feed exactly as written,
wherever it stands, and says so — and while `MCALL` repeats such a call after every move,
every feed written in between is left too. If your call takes the lead from its own
arguments, scale that feed by hand. A cycle that always takes its lead from its arguments
(`CYCLE84`, `CYCLE99`) changes nothing about the feeds around it.

Feed *mode* is tracked as it goes, out of the dialect's own code database rather than out
of a table in the script: on the Fanuc mill that is `G93`/`G94`/`G95`; on a Fanuc lathe
`G98`/`G99` in G-code system A and `G94`/`G95` in system B; on an Okuma `G94`/`G95`; on a
Sinumerik `G93`/`G94`/`G95`, and there `G96`/`G97` (per revolution) and `G961`/`G971` (per
minute) switch the feed unit too. On a Fanuc lathe, a feed inside the finishing profile of
a `G71`–`G73` roughing cycle is an ordinary feed and is scaled like one; on an Okuma, `G71`
and `G72` are thread cycles and their `F` is a lead. **Fanuc `G63`** (tapping mode) is a
mode of its own, not a cycle: while it is in force — until `G61`, `G62` or `G64` — the
feed is a lead and is left, exactly as inside a tapping cycle.

**An Okuma `E` word that no code of its block, or the cycle in force, declares as a
parameter is reported and left.** LAP's high-speed bar turning cycle makes `E` a contour
feed only inside a finish-contour definition, and `E` can also be a lead or a dwell
elsewhere on this control — reporting it is the one reading that is safe everywhere.

**The limits are compared against real values.** If gEdit can work out what a feed is worth
on this document's [machine](machines.md), your limits and thresholds are compared against
that value, and a feed that has to be clamped is written back in the form the word was
written in. If it cannot — a feed whose reading depends on a machine nobody chose — the
feed is still **scaled** and simply not compared, and the run says which ones those were.
The summary names the machine it worked with, or says that none was chosen and the
dialect's defaults were assumed.

**A selection is read in the state it is really written in.** When you run the script on
part of a program, the lines above the selection are read for their modal state before the
first line it may change, so a `G95`, a `G96` or a tapping cycle set higher up is in force.
The run tells you what it inherited, as an ordinary note on its first line. Started inside a
modal tapping call that repeats (Sinumerik `MCALL CYCLE840`), the selection still leaves the
next tap's lead, because the run knows it is still inside the call.

There is one limit. A very large amount of text above the selection is not sent to the
script — a selection tens of thousands of lines into a program — and the run then says so
with a **warning** instead: it saw only the selection, the modes above it are unknown, and
a thread pitch belonging to a cycle that starts higher up may have been scaled. That
warning is the one case where you should run the command on the whole program, or check
those blocks by hand.

### Scale spindle speeds

The same, for `S`. Leaves alone, and reports, speeds written as a variable and — unless you
ask — speed limits and the speeds of other spindles.

**A tap's speed is left as written, and reported, like its feed.** Feed and speed are tied
by the thread's pitch, so scaling one without the other cuts a different thread. This covers
every speed word of a tapping block — a tapping code of the block itself, a modal tapping
cycle in force (Fanuc `G84`, Sinumerik `G331`…), a tapping mode in force (Fanuc `G63` until
`G61`/`G62`/`G64`), a modal call of a tapping cycle while it repeats (`MCALL CYCLE840`), or a
tapping cycle a keyword defines (Klartext `CYCL DEF 207`) while a call of the database's
`cycle` group that starts nothing runs it (`CYCL CALL`, `M99`, `M89`; a later `CYCL DEF`
under the same keyword, such as another parameter set of 207, does not end it) — plus, for a
tapping block with no speed word of its own, the speed word written last before it, of
whichever spindle. The run counts these speeds and reports "N tapping speeds left as
written"; threading keeps the old behaviour, scaled with a warning, because it is not a tap
in the database's own reading. **Okuma's `G84` and `G88`, and the Fanuc lathe's `G74`, also
keep their speed**: these numbers are a tapping cycle on a machining centre or a mill, even
though on a lathe they are LAP or a face-pecking cycle, and the pitch ties speed to feed
there too. A speed-only block under a modal tap — `S900` with no move — is treated as an
ordinary speed and scaled, and counted as the last speed written, so the next tap that runs
with no `S` of its own still leaves the right one.

**Constant surface speeds** (`G96`) are a three-way choice like the per-revolution feeds:
**Also scale constant surface speeds**, automatically, yes or no. Under `G96` the `S` word
is a surface speed in metres or feet per minute, not revolutions per minute, so scaling it
is a different decision from scaling an rpm — and one you should make deliberately.
**Automatically** scales them on a turning dialect, where nearly every cut is one, and
leaves them alone, and reports them, on a milling one. On Sinumerik, `SVC=` and `SVC[n]=`
follow the same choice: the tool's cutting speed on the master spindle, or the spindle the
index names.

**A speed limit is not a speed.** The `S` of the block that clamps the top speed for
constant surface speed — `G50 S` on a Fanuc lathe in G-code system A and on an Okuma,
`G92 S` in system B, `G26 S` on a Sinumerik — is left alone by default and reported, and so is a clamp written as a word of its own (`LIMS=3000`,
`LIMS[2]=1800`). In such a block every speed word is a limit, the ones for other spindles
included (`G26 S3000 S2=2000`). Which code or word that is comes from the dialect's code
database and profile, so the script is right on every dialect without knowing any of them.
The Sinumerik `G25 S` is the **lowest** speed, not a clamp: it is never scaled, with "Also
scale the limits" or without it, and it is still counted as a limit left as written. A word
with an index — `S[2]=500`, `LIMS[2]=1800` — belongs to the spindle the index names: it is
never the main spindle's speed in force and never the main clamp.

**Other spindles are left alone unless you ask.** On a Sinumerik program, gEdit's main
spindle is spindle 1: a plain `S` while spindle 1 is the master (the default, `SETMS`, or
`SETMS(1)`), and `S1=`, are scaled by default; on a Fanuc lathe or an Okuma the master
spindle's plain `S` is scaled the same way. A speed written with an address of its own —
`SB=2000` for a driven tool, `S3=2400` for spindle 3, `S[SPI]=2400` for the spindle whose
number is in `SPI` — is reported and left, and so is a plain `S` while the program has made
another spindle the master (`SETMS(2)` on a Sinumerik, `G141` on an Okuma — the sub spindle
question there still needs the project's answer), because the script cannot tell which
spindle is your main one otherwise. **Also scale other spindles** scales them with the rest.
The `S` of a dwell is never a speed (`G4 S2` waits two spindle revolutions), and neither is
a word the dialect lists as an angle (the start angle `SF=` of a thread).

**Cycles written as calls** carry their speeds as arguments (the tapping speed of
`CYCLE84(…)`); they are listed and left as they are.

A value written with a Klartext decimal comma is scaled and written back with its comma,
like a feed.

Defaults to whole numbers, which is what nearly every control wants. A selection is primed
from the lines above it in exactly the same way, and warns in exactly the same case. If a
selection ends with a speed that is still in force at its last line and was itself scaled,
an **info** note on that line says so: the lines below the selection were not read, so a
tapping or threading block further down that runs at this speed may have had its lead
written for the old one. Run the command on the whole program, or check those blocks by
hand, when this note appears.

### Tool list

One row per tool, in order of first use: the tool, the comment that describes it, the line
of its first call, how many times it is called, and — unless you switch it off — the range
of feeds and speeds each tool is used with. Click a row to jump to the call.

On a Fanuc or Okuma turning program it lists the **turret stations**, and an extra column
shows the offsets each station was called with (`01, 11`) — so a station used with two
different offsets is one row and tells you both. On a Fanuc lathe, `T0100` (and, with a
five-digit word, `T12300`), which cancels the offset rather than changing the tool, is not a
call; on an Okuma, `T0100` is station 1 with offset 00, and only station `00` (`T0001`) is
no tool. A six-digit Okuma `T010203` is nose-radius set 01, station 02 and offset 03, and a
`T` inside a cycle block only switches the offset. A Sinumerik `T` carries no offset, so its
list has no such column. On a Fanuc mill, `T0` followed by `M6` is an unload — no tool T0 —
even when the two are on separate lines.

A Klartext `TOOL CALL` of the tool already in the spindle, written with no axis, is a speed
change rather than a second call: only a `TOOL CALL` that names a different tool, or names
the axis (a possible sister-tool swap on the same number), counts as a change and moves the
list on.

A range of constant surface speeds shows its unit and the code that set it, `220 m/min (G96)`
or `150 m/min (G961)` (`ft/min` in an inch program); a range of spindle speeds in rpm carries
no mark. A feed after a Sinumerik `G931` is a travel time and is left out of the feed range
with a note.

A speed or feed written **before** the turret indexes (`G97 S1500 M03`, then `T0202`)
belongs to the new tool: a value counts for the tool that moves next. A dwell is in no range,
and neither is a driven tool's `SB=` or a numbered spindle's `S3=`: the speed column is the
plain `S` of the main spindle, so a driven tool shows no speed of its own.

A range is in one unit: the one the control starts in — per revolution on a lathe, marked
`/rev` — or, for a tool with no value in that unit, the one it has (`/tooth` and `surface`
are marked as well; per minute and rpm carry no mark). A value in another unit is left out
of the range and listed under the table, and so are thread pitches and speed limits. A
Klartext value written with a decimal comma is read and shown the same as any other.

A tool named in quotation marks is a name, whatever it is made of: `T="007"` and tool
number 7 are two rows, and a name keeps its zeros and, when it is all digits, its quotation
marks.

Where the description comes from is a parameter — the dialect's rule; the end of the call
line, else above, else below; or only the lines above, the lines below or the end of the
call line — and a numbered tool without one takes it from a tool list comment elsewhere in
the program (`(T5 D12 FLAT END MILL)`), the first such line for each number. Another
parameter decides whether the list writes `T1` or `T01` (as the first call wrote it);
`T01` and `T1` are always the same tool.

If a program has `T` words but no tool change at all, the list says so rather than coming
back silently empty. On a milling dialect that usually means the program is really a turning
program opened with a mill profile — switch the dialect in the status bar.

### Program checks

Lists what a program does that the control or the machine will not like, before the
program goes to the machine. It changes nothing: the result is a table in the **Results**
panel, one row per finding, in line order, with the line, the check, a severity and the
finding. Click a row to jump to the line.

It is **a reading of the text, not a simulation**. It does not know where the tool is, what
the stock looks like or whether the tool fits the hole; it finds what a program says about
itself that cannot be right. A check that cries wolf on a correct program is worse than no
check, so each one is driven by the dialect, the code database and the machine, never by a
guess about what your post usually writes, and where a check cannot judge it says nothing
rather than flag every line.

| Severity | Means |
|---|---|
| **Error** | The control refuses the program, or it is broken where it stands: an unclosed comment, a `G70` target that is not there, code after the end |
| **Warning** | Almost certainly not what was meant: a cut with the spindle stopped |
| **Info** | A list you asked for (every stop), or a reading to confirm (the machine reading, lower case) |

Every check is a tick box on the form, all on; clear one and its rows go. A check whose
data the dialect does not have is not run; the general checks run on every dialect.

| Check | Severity | What it finds |
|---|---|---|
| **Program frame** | error, warning | A program that runs into the next start marker or the closing `%` with no end code; code after the end or after the closing `%`, which never runs; the end written twice; a tape with only one `%` |
| **Spindle** | warning | A cut while the spindle is stopped (the row names the code that stopped it), or a cut before the program starts a spindle. The second is reported only in a program that starts a spindle somewhere, because a subprogram runs under its caller's spindle |
| **Spindle after tool change** | warning | The first cut after a tool change with no spindle start in between. Only on a machining centre, whose tool change stops the spindle; a turret does not |
| **Tool change in a cycle** | warning | A tool change while a modal cycle, or a modal call such as `MCALL` or Klartext `M89`, is in force |
| **Offset cancel** | warning | Lathe: a cut after a lone tool word that cancels the offset (`T0100`) and before the next tool call |
| **Speed after tapping** | error | Sinumerik: a cut after leaving a tapping move that sets the speed to zero (`G331`, `G332`) with no new speed |
| **Speed clamp** | warning | Constant surface speed with no spindle-speed limit earlier in the program (once per program) |
| **Thread under surface speed** | warning | A thread cut under constant surface speed (once per stretch of it) |
| **Refused in this state** | warning | A code written in a state the control refuses it in. Examples: `G28` or `G53` under tool centre point control, a tilted working plane under compensation or inside another frame, Klartext `TOOL CALL` or `M91` while `M128` is on, Sinumerik `G75` under radius compensation, Okuma `G140` under constant surface speed |
| **Missing word** | error | A code whose block lacks the word the control needs with it: Klartext `PLANE` without `MOVE`, `TURN` or `STAY`, Okuma `G96` without `S` |
| **Alone in its block** | error | A code that has to stand in a block of its own does not: Fanuc `G53.1` and a `G65` macro call (its arguments may follow it, nothing may stand in front), Okuma `M110` |
| **Rigid tapping** | error | A speed word or a move between the rigid-tapping call (`M29`) and its cycle, or the call inside a running tapping cycle. `M29` counts as a tapping call only when a tapping cycle follows it, so on a lathe where that M number means something else nothing is reported |
| **Cycle call** | error | A cycle call with no cycle defined before it. A Klartext definition the database does not know still counts as a definition, so nothing is reported after one |
| **Modal call** | warning | A modal call still in force at the end of the program |
| **Control language** | warning | A code that switches the control to its ISO dialect (Sinumerik `G291`) |
| **Profile targets** | error | Lathe: the `P` and `Q` blocks of a roughing or finishing cycle missing, or `P` after `Q` |
| **Call in a profile** | error | Lathe: a subprogram call inside such a `P` to `Q` profile |
| **Jump target** | error, warning | A jump to a block or label that is not in the program; a target written on two lines; `GOTOF` to a label above, `GOTOB` to one below. A jump to a name that no label has but that begins labels which exist (`GOTOF TOOL` over `TOOL_1_0:`) is a string variable the check cannot see, and is not reported |
| **DO and END** | error | Loop numbers outside 1 to 3, an `END` with no `DO`, loops that cross, a `DO` never ended |
| **Words in a block** | error | Two speed words or two tool words in one block; more M codes than the control takes (Okuma: eight) |
| **Tool word** | warning | A tool word the machine's tool-word format does not describe, and tool words of different lengths in one file. Only where the machine itself states the format |
| **Program name** | error | A program name that shares its block with other words |
| **Sequence name** | error | A sequence name or block number with no space or tab behind it |
| **Digits** | error | A word with more digits than the control stores (Fanuc: eight), once converted to increments, under every reading the machine or the presets allow |
| **Machine reading** | info | A dimension word without a decimal point whose value depends on how the machine reads numbers, see below |
| **Tape marker** | error | A `%` inside a comment, which ends the program when the tape is read in |
| **Comment** | error | A comment opened and not closed on its line |
| **Brackets** | error | Brackets or quotes that are not balanced in a block, or a `)` with no `(` |
| **Lower case** | info | Lower-case addresses outside comments and strings, on a control that reads upper case |
| **Characters** | warning, error | Characters outside ASCII outside comments (warning); blocks longer than the control takes (error) |
| **Stop** | info | Every program stop and optional stop, as a list |

**Small things that are not findings.** `F MAX` written apart is the rapid word `FMAX` and
not a feed. A thread cycle that carries a tool word starts the cycle, and `G80 T2 M6` ends
it, so neither is a tool change inside one. The blocks that describe an Okuma LAP shape are
not cuts.

**The decimal-point finding.** `X50` is 50 mm on one control and 0.050 mm on the next
([Machines](machines.md)). **Machine reading** names the words whose value depends on that:

- With a machine whose numbers are **increments**, one row per such word says what it is
  read as on that machine ("0.050 mm on machine 'Lathe 2'") and what it would be with a
  point.
- With a machine that uses **calculator-type input**, or an Okuma **unit system**, no row:
  the machine reads every literal one way.
- With **no machine**, the rows list the readings of the dialect's presets, the assumed one
  first. On Fanuc that is one row per number without a point; on Okuma it is one row for
  the whole program, because every number there depends on the unit system. The report
  says "No machine chosen" and the way out is to choose one.

It is information and not a warning, so that a post which writes no points does not drown
the report.

**A selection** is read together with the lines above it, so the spindle, the cycle and the
other state at its first line are right. Some checks need the whole program, the program
frame and the jump and profile targets among them, and the report says so in a note when
you run on a selection.

**What it does not check, and why.**

- Okuma `G136` alone in its block, and the first blocks after `G137`: the manual states
  them for ending a conversion, and the owner's own post writes `G136 M109`; no rule says
  that is wrong.
- A code a Heidenhain TNC 640 refuses (`M104`, `FN 15`, cycles 1 to 6): which codes it
  refuses depends on a setting of the control generation, which the machine configuration
  does not have.
- The two-turret spindle rule of Okuma: a two-turret program is two channels.
- The Fanuc lathe's `G69` ending a tilted plane instead of `G69.1`, and `G53.1` standing
  directly after `G68.2`.

**Long reports are cut at 5,000 rows.** Errors are kept first, then warnings, then
information; what is kept stays in line order, and a note says how many were left out. An
error on the last line of a very long program is still there.

**It takes time on a long program.** Tokenizing and following the modal state are most of
the cost: a 300,000-line program takes a minute or more on a busy machine. The three
scripts of this section ask for 300 seconds in their headers, which wins over
`Settings ▸ Scripts ▸ Script timeout`.

### Extents

The smallest and largest value of every axis, for the whole program, for each work offset
and for each tool. Also a table in the **Results** panel; click a row to jump to the line
of the largest value. It reads the program and changes nothing.

| Column | |
|---|---|
| **Where** | The program, a work offset (`G55 (line 14)`), a tool inside it (`G55, T2 (line 15)`), or a machine position |
| **Axis** | `X`, `Y`, `Z` and the rotary axes. On a **turning** dialect the X column is `X (diameter)`, see below |
| **Min**, **Max** and their lines | In the program's units, rounded to 0.0001 mm (0.00001 inch, 0.0001 degree) |
| **Not resolved** | How many positions of this axis in this scope could not be worked out |

Everything is in **effective values**: a word is converted by the way the machine reads
it, so a program that switches between millimetres and inches does not mix the two, and an
incremental move (`G91`, `U`/`W` on a lathe, a Klartext `I` prefix, a Sinumerik `IC()`) is
added to where the tool was. **Arcs count**: the largest and smallest values on a circle
are found from its centre or radius in the plane in force, so the bulge of an arc is in the
range and not only its end point.

**One X column on a lathe.** Every `X` is turned into a diameter, so a program that
switches between diameter and radius programming (`DIAMON`, `DIAMOF`) never mixes the two
in one minimum or maximum. A word written as a radius counts double. The message above the
table says which mode the program starts in and where that came from: the dialect, the
machine, or the program. A milling dialect keeps a plain `X`, in which a diameter word
counts half.

**Machine positions** (`G28`, `G30`, `G53`, `M91`, `M92`, Sinumerik `SUPA`) are listed in
rows of their own and never enter a range: they are places on the machine, not on the
part. The axes they moved are in an unknown place afterwards, which matters to a later
incremental move.

**Tool centre point control.** Under `G43.4`, `G43.5`, `M128`, `FUNCTION TCPM` or `TRAORI`
the `X`, `Y` and `Z` are the tool tip in the workpiece, and they are in the ranges.

**Work offsets and shifts.** A change of work offset starts a new group. So does a shift
written over it (a local shift `G52`, `G92`, Sinumerik `TRANS`), and the group is named for
both (`G54 + G52 (line 8)`), because the positions after it are in another system than
those before. A speed clamp such as `G50 S2000` is not a shift.

**"Not resolved"** means gEdit would have had to guess, so it counted instead. The
findings under the table say which and why, once per kind:

- **No machine is chosen**, and the dialect's presets read the word differently.
- A **variable** or an expression (`X#101`, `Z+Q5`).
- A position inside a **tilted plane, a rotation, a mirror, a scaling, `TRANSMIT`, polar
  coordinates (`G16`) or polar interpolation**: its numbers are not coordinates of the
  workpiece.
- A position written while a **rotary axis that turns it stands turned**, or at an angle
  nobody knows, with tool centre point control off: it is a position of the machine's axes
  (see [the rotary rule](#rotary-axes-and-tool-centre-point-control)).
- An **incremental move from an unknown start**: the first one of a run, or one after a
  machine position, a cycle, a shift or a value that was not resolved.
- **Cycle depths** of Klartext and Sinumerik cycles: the depth is a distance from another
  parameter, and where both are written the control takes one of them, so a depth would
  show a place the cycle never reaches.
- **Lathe roughing passes** (`G71` to `G73`): the control works the passes out.
- An **arc it cannot compute** (Klartext `CT`, `CIP`, a centre written as a variable, a
  radius shorter than half the chord, an Okuma arc by radius `L`).
- A **code the database does not know** under the move letter, because it may hide a
  machine position or a frame.

Klartext polar moves are worked out from the pole `CC`; with no pole, or no radius or angle
to start from, they are not resolved. Blocks whose words are values and not positions
(`G92`, `G52`, the `X` of a dwell, `CYCL DEF 7`, `BLK FORM`) are left out of the ranges and
listed once per code.

A subprogram call is not followed: the called blocks are read where they stand in the
file. A selection is read with the lines above it, as in the program checks.

### Address arithmetic

Adds, subtracts, multiplies or divides the **written values** of the addresses you choose:
the part sits half a millimetre higher, so every `Z` moves; a flipped sign; a scale. It
replaces the text as one undo step and ends with a message that says what it changed and
what it left, so read the message.

| Field | |
|---|---|
| **Operation** | Add, Subtract, Multiply, Divide |
| **Value** | For add and subtract, in the program's units (millimetres or inches; degrees for a rotary axis). For multiply and divide, a plain factor. A factor of 0 is refused |
| **Addresses** | The words to change: `X Y Z U V W A B C I J K R`. `G`, `M`, `N`, `O` and `T` are never offered. Default `Z`. When multiplying, add `R` if your arcs are written with a radius |
| **Arc centres** | Also change the centre words of the chosen axes: `I` with `X`, `J` with `Y`, `K` with `Z`. *Automatically* means no for add and subtract, where a centre is a distance from the start point on most controls, and yes for multiply and divide |
| **The X value is** | On a turning dialect only: whether the value is a diameter or a radius. Each `X` word is converted by the mode it is written in, so a Sinumerik program that switches `DIAMON` and `DIAMOF` moves right. On a milling dialect the value is a plain coordinate: a radius word moves by it, a word read as a diameter by twice it |
| **Decimal places** | *As written* keeps the decimals each value had and adds what the result needs, at most four; or 0 to 4 |

It never guesses what a number is worth. Each word's value is read the way **the
machine** reads it ([Machines](machines.md)) and the result is written back in the word's
own form: a point stays a point, and a word without a point stays a whole number of
increments, rounded half away from zero and reported when it had to round. With **no
machine chosen**, a word whose value depends on the machine is left as written and listed,
unless every preset of the dialect would write the same result. A count (a repeat count
`K`, a dwell, a block number) changes only when you choose its address.

Examples: `Z1000` minus 0.5 is `Z500` on an increment machine (IS-B) and `Z999.5` on a
calculator-type one, and is left with no machine; `Z10.` becomes `Z9.5` on all three. On an
Okuma machine with 10 µm units, `Z1000` minus 0.5 is `Z950` and `Z10.` minus 0.5 is
`Z-40.`.

**Multiply and divide treat a distance like a position.** An incremental move is scaled
too, whatever the distance mode, and so are the cycle positions on a scaled tool axis. What
would be left unscaled while the positions around it are scaled is refused: a coordinate
shift or set written with a chosen axis, and, when the tool axis is chosen, a cycle that
writes a length parameter of its own (a peck depth `Q`, Klartext `Q201`, Sinumerik `SDIS`).
The radius `R` of an arc is scaled only when you choose `R`.

#### What a Z shift moves in a cycle

A drilling cycle holds absolute positions on the tool axis that are not axis words: the
`R` plane of a Fanuc `G81`, Klartext's `Q203`, the Sinumerik `RTP`, `RFP`, `DP` and `FDEP`.
Moving every `Z` and leaving those would move the surface and not the hole. So **a shift of
the tool axis moves them too**, while the plane in force is the one the tool axis stands
across (`Z` in the XY plane); in another plane, or one that is not known, the cycle is
refused.

| Dialect | What moves with `Z` |
|---|---|
| Fanuc mill | The `R` plane of `G73`, `G74`, `G76`, `G81` to `G89` (absolute under `G90`; under `G91` it is a distance and is left) |
| Klartext | `Q203` of cycles 200 to 209, 240 and 262 |
| Sinumerik | `RTP`, `RFP` and `DP` of `CYCLE81` to `CYCLE89` and `CYCLE840`, and `FDEP` of `CYCLE83` |

A call argument and a Klartext `Q` are absolute positions and move under `G91` as well.
The other parameters of those cycles are reviewed and left. A shift of `X` or `Y` does not
touch them: they are `Z` coordinates.

A cycle and the blocks that run it are **moved in one piece, or not at all**: a modal cycle
and its positions, a Klartext definition and every call of it, an `MCALL` and its
positions. If one member cannot be moved, every member is left, and the row names the line
of the first refused one ("part of the same cycle as line 12"). A cycle that starts above
your selection cannot be moved from a selection, so its blocks inside the selection are
left and the row says why.

#### What it refuses, and lists

A block it cannot judge is **left as written and listed, never shifted in part**: a shift
that moves the surface around a cycle but not the cycle scraps the part. There is one row
per refused block, with the block as written and the reason in plain words.

- **A machine position**: `G53`, `G28`, `G30`, `M91`, `M92`, `SUPA`. A place on the
  machine, not on the part.
- **Inside a frame**: a tilted plane, a rotation, a mirror, a scaling, polar coordinates
  (`G16`), `CYCLE800`, `G68`. The numbers there are not the part's coordinates. A frame
  that is closed again (`G69`, `G15`, `PLANE RESET`, `CYCLE800()`) ends it.
- **A rotary axis without tool centre point control**, see the next section.
- **A cycle it has no role for**: every lathe and Okuma cycle, a Fanuc `G65` that hands a
  chosen address a number, a Sinumerik or Klartext cycle the database has not reviewed, and
  **a call it does not know that has a number among its arguments** (`CYCLE61(50,0,2,-1,…)`,
  `POCKET4(…)`, a subprogram `MYSUB(10)`), since its depth could be an absolute position
  nobody described. A call with no number (`MYSUB`, `CYCLE832()`) is not a cycle with
  positions and is not touched. Until the database describes the standard milling cycles,
  this listing is the guard.
- **A cycle with positions it cannot move**: Klartext `CYCL CALL POS` (its tool-axis
  position acts as a second datum shift on top of `Q203`, so moving both would move the hole
  twice) and `CYCL CALL PAT` (the points stand outside the block), and the points of
  `CYCLE800`. The definition is refused together with its call.
- **A mode argument** other than empty or 0 (`_AMODE`, `_DMODE`, `_GMODE`, `_AXN`).
- **Another plane than XY**, or one that is not known: the tool axis is then not `Z` for
  sure.
- **A variable or an expression** where the shift would move a cycle position, or an axis
  word of a chosen address written as one inside a cycle block (`Z#101` under `G83`).
- **A pole and the moves around it, or an arc whose centre cannot be moved with its end
  point**, see "The Klartext pole and arc geometry" below.
- **A distance mode that is not known**: nothing before the block says `G90` or `G91`.
  Adding to an incremental word would add the offset twice, so a word is moved only while
  the mode is known to be absolute. A program that never writes `G90` falls under this
  unless the machine says what the control starts in
  ([Machines](machines.md#the-power-on-distance-mode)).
- **A code the database does not know** under the move letter (a `G` code), in a block it
  would otherwise change: it may be a machine position or a frame. A code it does not know
  in a block with nothing to change is listed once, as a note, with the number of blocks.

Words it leaves inside a block it does change are listed too, at information level: an
**incremental** word (`G91`, a lathe `U`/`W`, a Klartext `IZ`); a **variable** or an
expression (Okuma `X=V1+2`, Sinumerik `X=R1`); a **code whose words are values** (`G92`,
`G52`, `G10`, `CYCL DEF 7`, `TRANS`); a **count** reached through the arc centres; and a
word whose reading **depends on the machine**. A Sinumerik `Z=AC(3.25)` is an absolute
position and is moved; `Z=IC(2)` is an incremental distance and is left.

At most 500 rows are listed, and the message says how many more there were. Its last
sentence names the machine ("Machine 'Lathe 2': numbers without a point are increments of
0.001 mm; X is a diameter.") or says "No machine chosen: words whose reading depends on the
machine are left alone."

#### Rotary axes, and tool centre point control

A rotary axis that is turned changes what a `Z` word means: with `B` at 90 degrees, a move
along `Z` is a move along the workpiece's `X`. So a chosen linear word is **refused while a
rotary axis that turns it stands turned, or may, and tool centre point control is off**. A
rotary position stays in force after the block that wrote it, so the blocks behind it are
refused too.

- **Under tool centre point control** (`G43.4`, `G43.5`, `M128`, `FUNCTION TCPM`,
  `TRAORI`) the numbers are the tool tip in the workpiece, whatever the rotary axes do. A
  shift there is right and is made. Tool centre point control is not a frame and does not
  stop a shift.
- **Which axis turns which**, by the usual convention: `A` and `B` turn `Z`, `B` and `C`
  turn `X`, `A` and `C` turn `Y`. On a lathe `C` does not turn `X`, so a lathe `Z` or `X`
  shift is not stopped by it.
- **An axis at zero is not turned.** An axis the program first writes as 0 stays out of the
  way. An axis first written to a value other than 0 counts as unknown from the start of
  the run up to that line, and so does an axis the program moves by an expression or an
  incremental move. An axis the program never writes does not exist for it.
- **On a machine position** (`L A0 C0 M92`) a literal 0 is zero, so a program that parks
  its axes at 0 on the machine does not lose its whole three-axis part.
- A cycle's tool-axis positions under a tilt are refused as well. The row says "moves B
  together with Z" when the block writes the turning axis itself.

A rotary position written without any frame (`G0 B90.` and then plain 2D moves) is judged
like any other block. On a table whose axis is not the shifted one, check such a program
by hand.

#### The Klartext pole and arc geometry

A shift on `X` or `Y` has to move **the pole** `CC` together with the points around it, or
the polar moves and arcs would be drawn about the old centre. An absolute `CC X+50 Y+50`
moves with the axes of the plane; an incremental `CC IX+10` is left. The pole and the moves
around it up to the next pole (`C`, `LP`, `CP`, `CTP`) are refused **together** when a pole
word is a variable or has no value, the plane is not known, or the run multiplies or
divides (the polar radii would stay). A shift of `Z` alone leaves the pole alone.

Arc centres written as absolute coordinates move with the end point: Sinumerik `I=AC(…)`,
`J=AC(…)`, `K=AC(…)` and the `CIP` intermediate point `I1=`, `J1=`, `K1=`. An arc whose
centre cannot be computed (`I=AC(R1)`) or cannot be changed while the end point is, is
refused.

A Klartext value that changes sign is written without its plus: `Z-2` plus 5 becomes `Z3`.
That is the editor's number format for the dialect, not something this script chose.

#### Not covered yet

There is no entry for the standard Sinumerik milling cycles (`CYCLE61`, `POCKET4`,
`SLOT1`) with their position roles, so a call to one is refused and listed. A Klartext
cycle the database lacks (`CYCL DEF 251`) does not replace the earlier definition in the
modal state, so address arithmetic refuses it with its calls. The fix for both is database
content, not the script.

## Where scripts live

| Folder | |
|---|---|
| The bundled folder, inside the application | Read-only. Hide it with `Settings ▸ Scripts ▸ Show the scripts that ship with gEdit`, then **Rescan** |
| **Your own folder**, `scripts`, in the folder that holds your settings ([Where things are](README.md#where-things-are)) | Created on first start. The settings dialog shows the path |
| **Extra folders** you add | `Settings ▸ Scripts ▸ Extra script folders`, or the **Add Folder** command. A shop can keep its scripts on a share this way |

Rules worth knowing:

- **One level of subfolders** becomes the groups on the Tools tab. Deeper folders are
  ignored.
- A script **takes the place of** one with the same file name in an earlier folder: yours
  wins over a bundled one, an extra folder wins over both.
- `gedit_nc.py`, and any file whose name starts with `_` or `.`, is library code and is
  not listed as a script. A subfolder whose name starts with `_` or `.` is skipped too.
- A folder that is missing — an unmounted share, say — is not an error: its scripts are
  simply not listed until it is back and the list is read again (**Rescan**, or a restart),
  and the rest of the list works.
- **The list is read once, not at every run.** After you change a script's header — in
  gEdit or outside it — or add a script outside gEdit, use **Rescan**: the name, the
  description, the dialects, the input, the form and the output mode are all read when the
  list is built. Of the header, only `timeout` is read again at every run; the code itself
  always runs as it is saved.

The script commands also include **New Script** (writes a commented template into your
folder, opens it for editing and lists it) and **Edit Script** (opens the source of a
script in your own folder or an extra folder; on a bundled script it offers **Copy and
edit** instead — the bundled file itself is never made writable).

---

## Writing a script

**New Script** gives you a working template with the whole header commented. What follows
is the reference; the [script contract](../../src-tauri/resources/scripts/README.md) that
ships next to the bundled scripts has the same rules in full, for a developer.

### The header

A comment block at the top of the file. The content is TOML. gEdit reads it; your script
never has to.

```python
#!/usr/bin/env python3
# /// gedit
# name = "Scale lathe feeds"
# description = "Multiply F values by a percentage."     # the tooltip
# profiles = ["fanuc-lathe", "okuma-osp", "sinumerik"]   # omit = offered everywhere
# input = "selection-or-document"                        # document | selection | selection-or-document | none
# output = "replace"                                     # panel | replace | new-document | report
# timeout = 60                                           # seconds; omit = the setting
# envelope = true                                        # stdout is {"text", "message", "findings"}
#
# [[params]]
# id = "percent"
# label = "Percentage"
# type = "number"
# default = 100
# min = 1
# max = 500
# ///
```

An example. The bundled **Scale feed rates** declares no `profiles`, so it is offered on
every dialect.

`profiles` lists dialect ids — `fanuc-gcode`, `fanuc-lathe`, `heidenhain-klartext`,
`okuma-osp`, `sinumerik`, `sinumerik-mill` — compared exactly: a script for `fanuc-gcode` is
not offered on `fanuc-lathe`, and one for `sinumerik` is not offered on `sinumerik-mill`. An empty list means every dialect, and an id gEdit does not know is not
reported.

The block has to come first: only blank lines, a `#!` line (line 1) and a coding line
(line 1 or 2) may stand above it. Every line of it is a comment, it ends at `# ///`, and it
has to close within the first 64 KiB of the file. `name` is required. A key gEdit does not
know is ignored without a message, so a misspelt `ouput = "replace"` leaves the script in
panel mode. `documents` is accepted (`"active"`, `"all-open"` or `"pick"`), but a script
always gets the active document.

When gEdit refuses a header, the script is listed under its file name, runs in panel mode,
and its tooltip says that the header could not be read — not why. A script with no header
at all runs the same way: stdin in, raw output in the Script Output panel.

### Parameters

Each `[[params]]` block becomes one field of the form that opens before the run, and the
values arrive in the context as `params`. Fields are remembered per script.

| `type` | The field |
|---|---|
| `number`, `integer` | A number, with optional `min`, `max`, `decimals` |
| `text` | A line of text |
| `bool` | A checkbox |
| `choice` | One of `choices = [{ label = "...", value = ... }]` |
| `file`, `folder` | A path, picked with the system dialog |
| `address-list` | Check boxes over the `choices` you list; the value is the list of the checked values |

`label` is what the form shows, `help` the line under it, `default` the pre-filled value,
`required` whether it may be left empty.

Every field needs an `id` (ASCII letters, digits, `_` and `-`, not starting with a digit,
and not used twice), a `label` and a `type`. A field is optional unless it sets
`required = true`. A `choice` needs `choices`, and a `default` must suit the type.
Otherwise gEdit refuses the whole header, and the script runs in panel mode.

### What the script gets

- **stdin**: the input text, UTF-8, lines separated by LF. `gedit_nc.read_input()` gives
  it to you as a list of lines.
- **The environment variable `GEDIT_CONTEXT`**: the path of a JSON file, deleted after the
  run. `gedit_nc.load_context()` reads it.

```json
{
  "contract": 2,
  "document": { "path": "/jobs/part42.nc", "name": "part42.nc", "profile": "fanuc-lathe",
                "encoding": "windows-1252", "hasBom": false, "lineEnding": "crlf", "modified": true },
  "input":    { "scope": "selection", "startLine": 120, "endLine": 180,
                "precedingLines": ["%", "O1000 (BRACKET)", "..."] },
  "cursor":   { "line": 130, "column": 5 },
  "params":   { "percent": 90 },
  "profile":  { "id": "fanuc-lathe", "syntax": {}, "addresses": {}, "numbering": {} },
  "codes":    [ { "code": "G84", "group": "cycle", "pitchFeed": true } ],
  "machine":  { "id": "lathe-2", "name": "Lathe 2", "choice": "document",
                "params": { "numberInput": { "mode": "increment", "incrementMm": "0.001" },
                            "units": "mm", "diameter": "on",
                            "variants": { "gcodeSystem": "B" },
                            "modalInitial": { "feedmode": "G95" } },
                "source": { "numberInput": "machine", "units": "profile",
                            "diameter": "profile", "variants": { "gcodeSystem": "machine" },
                            "modalInitial": { "feedmode": "machine", "plane": "profile",
                                              "spindlemode": "profile" } } }
}
```

A number field left empty — and a choice with no default that nobody picked — is not in
`params` at all: read it with `params.get(…)`. An empty text, file or folder field arrives
as `""`, an unticked box as `false`, an empty address list as `[]`.

`profile` is the dialect and `codes` is its code database, so a script can ask what a
comment looks like, how blocks are numbered or what `G84` means **in this dialect** instead
of assuming Fanuc. `contract: 2` marks the shape; a script started without a context gets
`{}` and should fall back to defaults, or say what it is missing, rather than fail with a
traceback.

Both of them arrive with the document's [machine](machines.md) **already applied**: the
G-code system the machine is set to has picked the code database, its power-on modes are in
the profile, and `syntax.decimalPointSignificant` follows how that control reads numbers. A
script that only scales values never has to know that machines exist.

`machine` is the machine itself, for the scripts that do. `source` says where each parameter
came from — `"machine"`, `"detected"` or `"profile"` — so a script can tell a value it was
told from one it is assuming. A document with no machine still gets the member: the
dialect's documented defaults, except a G-code system gEdit detected in the program, and
the power-on feed mode that system brings, whose source is then `"detected"`; every other
source is `"profile"`. Read it with `gedit_nc.machine_params(context)`, which answers the
defaults, every source `"profile"`, for a context from an older version of gEdit that does
not carry the member at all.

`choice` is `"document"` (chosen for this program or remembered for its file; `id` is
`null` when that choice was "none"), `"default"` (the dialect's default machine) or
`"none"` (nothing chosen and no default set). Test `id`, not `choice`.

`input.precedingLines` is what makes a selection run trustworthy: the document lines above
`startLine`, so a script can work out the modal state — feed mode, the active cycle,
constant surface speed — that the selection is really written in. It is **absent** for a
whole-document run, which already sees everything, for a selection that starts on line 1,
and when more than 50,000 lines or about 4 MB of text stand above the selection. Read it
with `gedit_nc.preceding_lines(context)`, which answers `[]` in all of those cases and in
every case where the field cannot be trusted; a script that gets `[]` for a selection that
does not start on line 1 should say so rather than guess.

Also set for you: `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` (so comments with umlauts
survive on Windows), the working directory is the script's own folder (so a helper module
next to it imports), and `PYTHONPATH` is set to the bundled folder (so `import gedit_nc`
works from your own scripts too) — replacing one of your own, so keep helpers next to the
script or use a virtual environment's interpreter. `PYTHONDONTWRITEBYTECODE=1` keeps
`__pycache__` out of your folders.

Write **the result** to stdout and anything else to stderr.

### The output

`output = "replace"` or `"new-document"`: stdout is the new text.

**The trailing-newline rule, in full**, because half of it is a trap. One trailing newline
is dropped **only when the input did not end with one**. So `print("\n".join(lines))` is
right on a program whose file has no final newline, and adds a blank line at the end of one
that has — which is the normal case, and invisible to the person running it. The rule
cannot be better than that: always dropping would eat the real trailing blank line of an
echo written with `sys.stdout.write(stdin)`.

Write the result with **`sys.stdout.write("\n".join(lines))`**, which is correct either
way, or with `gedit_nc.envelope()`, whose `text` is used exactly as you gave it. The
example at the end of this page does the first.

`output = "report"`: stdout is JSON. `gedit_nc.report()` writes it for you:

```python
gedit_nc.report(
    title="Tool list",
    columns=[{"key": "tool", "label": "T"}, {"key": "line", "label": "Line"}],
    rows=[{"tool": 1, "line": 12}],
    message="8 tools, 2 without a description",
    findings=[{"line": 250, "severity": "warning", "message": "Feed move while the spindle is stopped"}],
)
```

A row or a finding that carries `line` is clickable. `severity` is `info`, `warning` or
`error`. `line` is a line number of the document, not of stdin: in a selection run add
`context["input"]["startLine"] - 1`. A finding needs `line` and `message`, or the whole
result is refused. At most 1000 findings and 5000 rows are taken, and the panel says how
many more there were.

`envelope = true` on a `replace` or `new-document` script: stdout is always JSON, so a
script can hand back new text **and** a summary **and** warnings together —
`gedit_nc.envelope(text, message, findings)`. This is how the bundled scale scripts report
the feeds they refused to touch.

### The library

`gedit_nc.py` sits next to the bundled scripts and is importable from yours: it reads the
context and the input, reads a line the way the dialect does (`tokenize_line`), keeps NC
numbers as decimal text rather than floats, follows what is modal (`ModalInterpreter`, and
the smaller `FeedModeTracker`), reads a word's number the way the machine does, and writes
the two JSON result shapes. Every public name, with what it is for, is listed in
[the library reference](../../src-tauri/resources/scripts/README.md#7-what-gedit_nc-gives-you);
the docstrings in the file have the detail.

On a dialect that defines a cycle once and calls it later (Klartext), `ModalInterpreter.state`
also carries `definedCycle` (the last `CYCL DEF`, which no call ends) and `modalCall` (the
`M89` that runs it after every positioning block); `defined_cycle` and `modal_call` read them.
`active_cycle` includes the defined cycle while a modal call runs it. `FeedModeTracker` is
unchanged. On the other dialects both are `None`.

The modal state also carries, since the checks and the arithmetic needed them, the
coordinate **frame** in force (`frame`: a tilted plane, a rotation, a mirror, a scaling, or
`None`) and **tool centre point control** (`tcp`: the code that switched it on, or `None`);
`RotaryState` follows where each rotary axis stands while tool centre point control is off,
and `position_of` says what a cycle parameter is to a shift of positions (an absolute
coordinate on the tool axis or not). The three bundled scripts use them; so can yours. A
code database entry can also carry a few optional members that the checks read, for example
`conflicts`, `alone` and `requires` ([the library reference](../../src-tauri/resources/scripts/README.md)
lists them all).

### Five rules that matter more than any feature

1. **A selection is a fragment of a modal language.** `G95` three hundred blocks above the
   selection still decides what every `F` in it means. Prime your tracker with
   `preceding_lines` + `prime_tracker`, and when they give you nothing, say so in a finding
   instead of assuming the top-of-program state.
2. **Work on tokens, not on a regular expression over raw lines.** `tokenize_line` knows
   what is a comment, a string, a variable and an expression *in this dialect*. A naive
   `re.sub` rewrites the `G1` inside `(FINISH G1 PASS)` and corrupts the program. Inside a word
   or a comment you already isolated a pattern is fine; how Python's `re` differs from the
   editor's find, and the NC examples, are on [Regular expressions](regex.md#in-a-script).
3. **Never widen or narrow a number by accident.** Use `scale_decimal` and `format_number`,
   never a float. They keep `10.` from becoming `10`, keep the precision each value was
   written with, and round the way the editor's own transformations do.
4. **Ask the code database what a value means, not a table of your own.** The same `F` is a
   feed, a thread pitch or a thread lead depending on what is in force, and the dialect's
   database in `context["codes"]` is what says which; the trackers read it for you.
5. **When you are not sure, leave the value alone and say so** in a finding on its line —
   the value, the reason, what to do. Refusing a feed costs one edit; scaling a thread lead
   scraps the part.

Write for Python 3.9 as well as for the newest release: no `match`, no `X | Y` outside
annotations, and `from __future__ import annotations` at the top. A script you share, like
the bundled ones, uses the standard library only; your own may use a virtual environment's
interpreter.

### Numbers, and the machine

`X50` is 50 mm on one control and 0.050 mm on the next, and which one it is depends on a
machine parameter rather than on the dialect ([Machines](machines.md)).

A script that only **scales** can ignore all of it. Multiplying is unit-free: the same
arithmetic is right in every reading, and `syntax.decimalPointSignificant` already follows
the machine. A script that **compares** a value with a limit, or **computes** with one, has
to ask: `machine_params` for the machine, `number_class_of` for what kind of number the word
is in this block, `resolve_value` for what it is worth — decimal text in millimetres,
inches, degrees or seconds, or nothing when the reading depends on a machine nobody chose —
and `write_back` to put a value back into the word in its own form: a point stays a point,
a point-less word stays a count, and you are told when it had to round.
[The library reference](../../src-tauri/resources/scripts/README.md#why-your-script-needs-the-number-rules)
has the whole loop as a worked example that runs as it stands.

**Never divide by a thousand yourself, and never assume a point-less word is a count.** The
machine decides, and where no machine was chosen gEdit refuses to decide for it. Say so in a
finding instead.

### A minimal example

```python
#!/usr/bin/env python3
# /// gedit
# name = "Remove optional stops"
# description = "Delete every line that contains M1 outside a comment."
# output = "replace"
# ///
from __future__ import annotations

import sys

import gedit_nc


def main() -> int:
    context = gedit_nc.load_context()
    if not context.get("profile"):
        print("Run this from gEdit: it needs the dialect.", file=sys.stderr)
        return 1
    cp = gedit_nc.compile_profile(context["profile"])
    kept = []
    state = None
    for line in gedit_nc.read_input():
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        if any(t.kind == "word" and gedit_nc.normalize_code(t.text) == "M1" for t in tokens):
            continue
        kept.append(line)
    sys.stdout.write("\n".join(kept))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### Running another program from a script

A script is an ordinary program, so it can start another one: the shop's own formatter, a
checker that reads the NC text, a converter. gEdit has no "external commands" feature of its
own; this is how you get one. The example passes the selection through a tool and replaces
it with what the tool prints.

```python
#!/usr/bin/env python3
# /// gedit
# name = "Format with the shop tool"
# description = "Pass the selection through the shop's own formatter and replace it with the result."
# input = "selection-or-document"
# output = "replace"
# timeout = 60
# ///
from __future__ import annotations

import subprocess
import sys

import gedit_nc

TOOL = ["/opt/shop/bin/ncformat", "--stdin", "--stdout"]   # your program and its arguments


def main() -> int:
    lines = gedit_nc.read_input()
    try:
        done = subprocess.run(
            TOOL,
            input="\n".join(lines),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=45,          # shorter than the script's own `timeout`
        )
    except (OSError, subprocess.TimeoutExpired) as err:
        print("Could not run %s: %s" % (TOOL[0], err), file=sys.stderr)
        return 1
    if done.returncode != 0 or not done.stdout.strip():
        print(done.stderr or "The tool returned nothing.", file=sys.stderr)
        return 1
    sys.stdout.write(done.stdout.rstrip("\n"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Four habits keep it safe:

- **A list of arguments, never `shell=True`.** A file name or a program fragment must never
  be read as a command line.
- **A timeout on the child, shorter than the script's own.** Stopping a script on Windows
  ends the script but not a program it started, so a child that hangs is yours to bound.
- **A failure ends the script with an error.** A non-zero exit means gEdit applies nothing
  and shows what the script wrote on its error output; an empty result in `replace` mode is
  refused too. Never print half an answer.
- **The tool runs with your rights**, like the script. Read it before you trust it with a
  program, and see [Security](#security).

---

## Security

This is the honest version, because a comfortable one would be misleading.

**A script is an ordinary program with your rights.** It can read and write any file you
can, and reach the network. gEdit cannot sandbox it, and does not pretend to.

What gEdit does guarantee:

- **Nothing runs by itself.** Not on open, not on save, not on a timer. A script runs
  because you asked for it.
- **Only scripts in the listed folders run**, named by an id the editor validates: no
  path outside a script folder, no `..`, no symlink out of one, and no shell — the
  interpreter is started directly with the script as an argument, so a file name can never
  be read as a command line.
- **Bundled scripts are never writable.** The scripts that ship with gEdit are the scripts
  that run.
- **A run is bounded**: a time limit, a **Stop** button, capped output (64 MiB of result,
  1 MiB of error output), and it is killed when the app exits. On macOS and Linux the
  processes the script started are stopped with it; on Windows only the script itself is.

What that does **not** mean: it bounds *which file* runs, for how long and how much it may
say — it says nothing about what is **in** that file. The interpreter and the script
folders are ordinary settings; anything that can change your settings file can point gEdit
at a different interpreter, and **New Script** creates a writable, runnable file by
design.

So the rule is the one at the top of this page: **only run scripts you trust.** Read a
script before you run it, the same way you would read a macro somebody mailed you. They
are short, and they are meant to be read.

## When something does not work

| | |
|---|---|
| The Tools tab says "Python 3.9 or newer was not found" | No Python, or one older than 3.9. Set `Settings ▸ Scripts ▸ Python interpreter` to the interpreter's path |
| A script is not on the Tools tab | It may be for other dialects (`profiles` in its header), it may be hidden behind a file of the same name in a later folder, its name or its subfolder's name starts with `_` or `.`, it sits more than one folder deep, or the bundled scripts are hidden. Use **Rescan** after adding it |
| It appears under its file name, and the tooltip says the header could not be read | gEdit refused the header (see [The header](#the-header)); it then runs in panel mode and shows raw output only. Fix it, then **Rescan** |
| *The program changed while the script ran* | You typed in the document while it ran, so nothing was applied. Run it again, or take **Open in new tab** |
| It is stopped every time | It needs longer than the time limit: raise `Settings ▸ Scripts ▸ Script timeout` (up to an hour), or set `timeout` in the script's header (up to a day) |
| Nothing comes back at all | Look in the **Script Output** panel: whatever the script wrote to its error output is there |
