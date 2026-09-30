# Scripts

A script is a small Python program that reads your NC code and gives something back: new
code, or a table. Scripts are how gEdit is extended. Scaling feeds, scaling spindle speeds
and listing tools are done by scripts that ship with the app, and they use exactly the
same contract as one you write yourself — so if a bundled script is nearly what you need,
copy it and change the part that is not.

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
with `$` belongs to the block above it, so the lead a `G71` thread cycle carries on its `$`
line is a thread lead like any other. Klartext `FMAX` and `FAUTO` are not numbers and are
never touched; an `F` on a rapid block (`G0 … F`) is scaled like any other.

**A code that means two things is refused.** Some codes cut a thread on another kind of
machine, in the other G-code system or on another make of control — `G76` and `G92` on the
Fanuc mill profile, `G74` and `G78` (system A) or `G74` and `G92` (system B) on the Fanuc
lathe, `G76`, `G84`, `G88` and `G92` on an Okuma. Nothing in the block says which reading is
meant, so their `F` is left alone with a warning.

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
and `G72` are thread cycles and their `F` is a lead.

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
The run tells you what it inherited, as an ordinary note on its first line.

There is one limit. A very large amount of text above the selection is not sent to the
script — a selection tens of thousands of lines into a program — and the run then says so
with a **warning** instead: it saw only the selection, the modes above it are unknown, and
a thread pitch belonging to a cycle that starts higher up may have been scaled. That
warning is the one case where you should run the command on the whole program, or check
those blocks by hand.

### Scale spindle speeds

The same, for `S`. Leaves alone, and reports, speeds written as a variable and — unless you
ask — speed limits and the speeds of other spindles.

**Constant surface speeds** (`G96`) are a three-way choice like the per-revolution feeds:
**Also scale constant surface speeds**, automatically, yes or no. Under `G96` the `S` word
is a surface speed in metres or feet per minute, not revolutions per minute, so scaling it
is a different decision from scaling an rpm — and one you should make deliberately.
**Automatically** scales them on a turning dialect, where nearly every cut is one, and
leaves them alone, and reports them, on a milling one.

**A speed limit is not a speed.** The `S` of the block that clamps the top speed for
constant surface speed — `G50 S` on a Fanuc lathe in G-code system A and on an Okuma,
`G92 S` in system B, `G26 S` on a Sinumerik, and the lower limit `G25 S` — is left alone
by default and reported, and so is a clamp written as a word of its own (`LIMS=3000`,
`LIMS[2]=1800`). In such a block every speed word is a limit, the ones for other spindles
included (`G26 S3000 S2=2000`). Which code or word that is comes from the dialect's code
database and profile, so the script is right on every dialect without knowing any of them.

**Other spindles are left alone unless you ask.** Only the master spindle's plain `S` is
scaled by default. A speed written with an address of its own — `SB=2000` for a driven tool,
`S3=2400` for spindle 3, `S[SPI]=2400` for the spindle whose number is in `SPI` — is
reported and left, and so is a plain `S` while the program has made another spindle the
master (`SETMS(3)` on a Sinumerik), because the script cannot tell which spindle is your
main one. **Also scale other spindles** scales them with the rest. The `S` of a dwell is
never a speed (`G4 S2` waits two spindle revolutions), and neither is a word the dialect
lists as an angle (the start angle `SF=` of a thread).

**Cycles written as calls** carry their speeds as arguments (the tapping speed of
`CYCLE84(…)`); they are listed and left as they are.

Defaults to whole numbers, which is what nearly every control wants. A selection is primed
from the lines above it in exactly the same way, and warns in exactly the same case.

### Tool list

One row per tool, in order of first use: the tool, the comment that describes it, the line
of its first call, how many times it is called, and — unless you switch it off — the range
of feeds and speeds each tool is used with. Click a row to jump to the call.

On a Fanuc or Okuma turning program it lists the **turret stations**, and an extra column
shows the offsets each station was called with (`01, 11`) — so a station used with two
different offsets is one row and tells you both. On a Fanuc lathe, `T0100`, which cancels
the offset rather than changing the tool, is not a call; on an Okuma, `T0100` is station 1
with offset 00, and only station `00` (`T0001`) is no tool. A six-digit Okuma `T010203` is
nose-radius set 01, station 02 and offset 03, and a `T` inside a cycle block only switches
the offset. A Sinumerik `T` carries no offset, so its list has no such column.

A speed or feed written **before** the turret indexes (`G97 S1500 M03`, then `T0202`)
belongs to the new tool: a value counts for the tool that moves next. A dwell is in no range,
and neither is a driven tool's `SB=` or a numbered spindle's `S3=`: the speed column is the
plain `S` of the main spindle, so a driven tool shows no speed of its own.

A range is in one unit: the one the control starts in — per revolution on a lathe, marked
`/rev` — or, for a tool with no value in that unit, the one it has (`/tooth` and `surface`
are marked as well; per minute and rpm carry no mark). A value in another unit is left out
of the range and listed under the table, and so are thread pitches and speed limits.

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
`okuma-osp`, `sinumerik` — compared exactly: a script for `fanuc-gcode` is not offered on
`fanuc-lathe`. An empty list means every dialect, and an id gEdit does not know is not
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

### Five rules that matter more than any feature

1. **A selection is a fragment of a modal language.** `G95` three hundred blocks above the
   selection still decides what every `F` in it means. Prime your tracker with
   `preceding_lines` + `prime_tracker`, and when they give you nothing, say so in a finding
   instead of assuming the top-of-program state.
2. **Work on tokens, not on a regular expression over raw lines.** `tokenize_line` knows
   what is a comment, a string, a variable and an expression *in this dialect*. A naive
   `re.sub` rewrites the `G1` inside `(FINISH G1 PASS)` and corrupts the program.
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
