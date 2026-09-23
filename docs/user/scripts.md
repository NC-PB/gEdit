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
3. `python3` (`python` on Windows), looked up through your login shell — so a Homebrew or
   python.org install is found even when you started gEdit from the Dock — and then in the
   usual install locations.

**If no interpreter is found, the script commands are disabled and say so. Everything else
in gEdit keeps working.** On Windows, the `python` that opens the Microsoft Store is
recognised as "not installed" rather than used.

## Running a script

Scripts are on the **Tools** tab, grouped by the folder they live in, with the script's
own description as the tooltip. A script that declares which dialects it is for is only
offered on those.

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
   The Output panel has a **Stop** button too. One script runs at a time.
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
| `panel` | Shows the raw output in the **Output** panel, with the JSON view when it is JSON |

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
5. **It produced nothing**, in `replace` mode. Otherwise a broken script would silently
   delete your selection.
6. **You edited the document while it ran.** The answer no longer fits the question: the
   lines it would overwrite have moved. Nothing is applied, and you are offered
   **Open result in new tab** so the work is not lost.

Nothing is ever applied silently: every run ends in a summary, a result, or a message
saying why not.

## The scripts that ship with gEdit

They are read-only. To change one, use **Copy to My Scripts** — the copy lands in your own
scripts folder, where it takes the place of the bundled one with the same file name, and
gEdit opens it for editing.

### Scale feed rates

Multiplies `F` values by a percentage.

| Parameter | |
|---|---|
| Percentage | 100 % leaves every feed as it is |
| Decimal places | As written, or 0 to 4 |
| Smallest feed / Largest feed | A scaled feed outside the range is pulled back to it. Empty means no limit |
| Only feeds above / Only feeds below | Leaves the others as they are |
| Per-revolution feeds | Automatic, yes or no. **Automatic** scales them on a turning program and leaves them alone on a milling one, which is what each of them usually wants |
| Inverse-time feeds | `G93`, where `F` is the reciprocal of the time the block may take. Off by default |

It leaves alone, and reports, the feeds it must not touch: **thread leads** (in a tapping
or threading cycle the `F` carries a lead rather than a feed rate — the finding names the
code, so you can see which cycle it was), feeds on rapid moves, and feeds written as a
variable: the control works out those values, gEdit cannot.

Feed *mode* is tracked as it goes, out of the dialect's own code database rather than out
of a table in the script: on a mill that is `G93`/`G94`/`G95`, on a lathe `G98`/`G99` in
G-code system A and `G94`/`G95` in system B. A feed inside the finishing profile of a
`G71`–`G73` cycle is an ordinary feed and is scaled like one.

**The limits are compared against real values.** If gEdit can work out what a feed is worth
on this document's [machine](machines.md), your smallest and largest are compared against
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

The same, for `S`. Leaves alone, and reports, speeds written as a variable, and by default
surface speeds and speed limits as well.

**Constant surface speeds** (`G96`) are a three-way choice like the per-revolution feeds:
automatic, yes or no. Under `G96` the `S` word is a surface speed in metres or feet per
minute, not revolutions per minute, so scaling it is a different decision from scaling an
rpm — and one you should make deliberately.

**A speed limit is not a speed.** The `S` of the block that clamps the top speed for
constant surface speed — `G50 S` in G-code system A, `G92 S` in system B — is left alone by
default and reported. Which code that is comes from the dialect's code database, so the
script is right on both systems without knowing either of them.

Defaults to whole numbers, which is what nearly every control wants. A selection is primed
from the lines above it in exactly the same way, and warns in exactly the same case.

### Tool list

One row per tool, in order of first use: the tool, the comment that describes it, the line
of its first call, and how many times it is called. Optionally the range of feeds and speeds
each tool is used with. Click a row to jump to the call.

On a turning program it lists the **turret stations**, and an extra column shows the
offsets each station was called with (`01, 11`) — so a station used with two different
offsets is one row and tells you both. `T0100`, which cancels the offset rather than
changing the tool, is not a call.

Where the description comes from is a parameter (the dialect's own rule, or the comment
above, below or at the end of the call line), as is whether `T01` and `T1` are written the
same way.

If a program has `T` words but no tool change at all, the list says so rather than coming
back silently empty. On a milling dialect that usually means the program is really a turning
program opened with a mill profile — switch the dialect in the status bar.

## Where scripts live

| Folder | |
|---|---|
| The bundled folder, inside the application | Read-only. Hide it with `Settings ▸ Scripts ▸ Show the scripts that ship with gEdit` |
| **Your own folder**, `scripts/` next to `settings.json` | Created on first start. The settings dialog shows the path |
| **Extra folders** you add | `Settings ▸ Scripts ▸ Extra script folders`, or the "Add folder" command. A shop can keep its scripts on a share this way |

Rules worth knowing:

- **One level of subfolders** becomes the groups in the menu. Deeper folders are ignored.
- A script **takes the place of** one with the same file name in an earlier folder: yours
  wins over a bundled one, an extra folder wins over both.
- `gedit_nc.py`, and any file whose name starts with `_` or `.`, is library code and is
  not listed as a script.
- A folder that is missing — an unmounted share, say — is not an error. It is reported as
  missing and the rest of the menu works.
- After adding or editing scripts outside gEdit, use **Rescan** to pick them up.

The script commands also include **New script** (writes a commented template into your
folder and opens it for editing) and **Open script** (opens the source of one of your own
scripts; a bundled script is never made writable).

---

## Writing a script

**New script** gives you a working template with the whole header commented. What follows
is the reference.

### The header

A comment block at the top of the file. The content is TOML. gEdit reads it; your script
never has to.

```python
#!/usr/bin/env python3
# /// gedit
# name = "Scale feed rates"
# description = "Multiply F values by a percentage."     # the tooltip
# profiles = ["fanuc-gcode", "heidenhain-klartext"]      # omit = offered everywhere
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

A script with no header still runs: stdin in, raw output in the Output panel.

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
| `address-list` | Check boxes over the addresses of the dialect |

`label` is what the form shows, `help` the line under it, `default` the pre-filled value,
`required` whether it may be left empty.

### What the script gets

- **stdin**: the input text, UTF-8, lines separated by LF. `gedit_nc.read_input()` gives
  it to you as a list of lines.
- **The environment variable `GEDIT_CONTEXT`**: the path of a JSON file, deleted after the
  run. `gedit_nc.load_context()` reads it.

```json
{
  "contract": 2,
  "document": { "path": "/jobs/part42.nc", "name": "part42.nc", "profile": "fanuc-gcode",
                "encoding": "windows-1252", "hasBom": false, "lineEnding": "crlf", "modified": true },
  "input":    { "scope": "selection", "startLine": 120, "endLine": 180,
                "precedingLines": ["%", "O1000 (BRACKET)", "..."] },
  "cursor":   { "line": 130, "column": 5 },
  "params":   { "percent": 90, "maxFeed": null },
  "profile":  { "id": "fanuc-gcode", "syntax": {}, "addresses": {}, "numbering": {} },
  "codes":    [ { "code": "G84", "group": "cycle", "pitchFeed": true } ],
  "machine":  { "id": "lathe-2", "name": "Lathe 2", "choice": "document",
                "params": { "numberInput": { "mode": "increment", "incrementMm": "0.001" },
                            "units": "mm", "diameter": "on",
                            "variants": { "gcodeSystem": "B" },
                            "modalInitial": { "feedmode": "G95" } },
                "source": { "numberInput": "machine", "units": "profile",
                            "diameter": "profile", "variants": { "gcodeSystem": "machine" },
                            "modalInitial": { "feedmode": "machine" } } }
}
```

`profile` is the dialect and `codes` is its code database, so a script can ask what a
comment looks like, how blocks are numbered or what `G84` means **in this dialect** instead
of assuming Fanuc. `contract: 2` marks the shape; a script started without a context gets
`{}` and should fall back to defaults rather than fail.

Both of them arrive with the document's [machine](machines.md) **already applied**: the
G-code system the machine is set to has picked the code database, its power-on modes are in
the profile, and `syntax.decimalPointSignificant` follows how that control reads numbers. A
script that only scales values never has to know that machines exist.

`machine` is the machine itself, for the scripts that do. `source` says where each parameter
came from — `"machine"`, `"detected"` or `"profile"` — so a script can tell a value it was
told from one it is assuming. A document with no machine still gets the member, with the
dialect's documented defaults and every source `"profile"`. Read it with
`gedit_nc.machine_params(context)`, which answers the same thing for a context from an older
version of gEdit that does not carry the member at all.

`input.precedingLines` is what makes a selection run trustworthy: the document lines above
`startLine`, so a script can work out the modal state — feed mode, the active cycle,
constant surface speed — that the selection is really written in. It is **absent** for a
whole-document run, which already sees everything, and absent when there is too much text
above the selection to send. Read it with `gedit_nc.preceding_lines(context)`, which
answers `[]` in both of those cases and in every case where the field cannot be trusted; a
script that gets `[]` for a selection should say so rather than guess.

Also set for you: `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` (so comments with umlauts
survive on Windows), the working directory is the script's own folder (so a helper module
next to it imports), and the bundled folder is on `PYTHONPATH` (so `import gedit_nc`
works from your own scripts too).

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
`error`.

`envelope = true`: stdout is always JSON, so a script can hand back new text **and** a
summary **and** warnings together — `gedit_nc.envelope(text, message, findings)`. This is
how the bundled scale scripts report the feeds they refused to touch.

### The library

`gedit_nc.py` sits next to the bundled scripts and is importable from yours.

| | |
|---|---|
| `load_context()`, `read_input()` | the context dictionary, and stdin as lines |
| `compile_profile(profile)` | the dialect's patterns, compiled once |
| `tokenize_line(line, cp, prev_state)` | one block's tokens, and the state the next line needs |
| `mask_comments(line, cp)` | the line with comments blanked out, same offsets |
| `parse_number`, `format_number`, `scale_decimal` | NC numbers as decimal strings, never as floats |
| `ModalInterpreter(cp, codes)` | everything that is in force after a block: the code per modal group, the feed and speed units, distance, diameter, units, plane, the last tool, feed, speed and speed clamp, and the active cycle |
| `FeedModeTracker(codes)` | the older, smaller view of the same thing: feed mode, `G96`/`G97`, the active cycle, and whether its `F` is a thread pitch |
| `speed_limit_of(codes, tokens)` | the code in this block that makes its `S` a clamp rather than a speed, or `None` |
| `machine_type_of`, `incremental_axes`, `diameter_axes` | `'mill'` or `'lathe'`, the `U`→`X` pairs, and the words written as a diameter |
| `machine_params(context)` | the document's [machine](machines.md), with the source of each parameter |
| `number_class_of`, `value_of`, `resolve_value`, `readings_of`, `write_back` | what a word's number actually **is** on this machine, and how to put a value back into it |
| `preceding_lines(context)` | the lines above a selection, or `[]` when there are none to trust |
| `prime_tracker(tracker, lines, cp)` | feeds those lines through a tracker and hands back the state the first selected line begins in |
| `report(...)`, `envelope(...)` | the two JSON result shapes |

**Three rules that matter more than any feature:**

0. **A selection is a fragment of a modal language.** `G95` three hundred blocks above the
   selection still decides what every `F` in it means. Prime your tracker with
   `preceding_lines` + `prime_tracker`, and when they give you nothing, say so in a finding
   instead of assuming the top-of-program state.
1. **Work on tokens, not on a regular expression over raw lines.** `tokenize_line` knows
   what is a comment, a string, a variable and an expression *in this dialect*. A naive
   `re.sub` rewrites the `G1` inside `(FINISH G1 PASS)` and corrupts the program.
2. **Never widen or narrow a number by accident.** Use `scale_decimal` and `format_number`.
   They keep `10.` from becoming `10`, keep the precision each value was written with, and
   round the way the editor's own transformations do.

Write for Python 3.9 as well as for the newest release: no `match`, no `X | Y` outside
annotations, and `from __future__ import annotations` at the top.

### Numbers, and the machine

`X50` is 50 mm on one control and 0.050 mm on the next, and which one it is depends on a
machine parameter rather than on the dialect ([machines.md](machines.md)).

A script that only **scales** can ignore all of it. Multiplying is unit-free: the same
arithmetic is right in every reading, and `syntax.decimalPointSignificant` already follows
the machine. A script that **compares** a value with a limit, or **computes** with one, has
to ask:

```python
machine = gedit_nc.machine_params(context)
cls = gedit_nc.number_class_of(token.address, context["profile"], tracker.feed_unit,
                               block_codes, tracker.pitch_feed)
value, readings = gedit_nc.resolve_value(token.value, cls, machine,
                                         context["profile"], units)
if value is None:
    # No class, or a reading that depends on a machine nobody chose. Report the word —
    # `readings` says what each preset would make of it — and leave it alone.
    ...
```

`value` is decimal text in millimetres, inches, degrees or seconds. `write_back` puts a
value back into the word it came from, keeping the word's own form — a point stays a point,
a point-less word stays a count — and telling you when it had to round.

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
- **A run is bounded**: a time limit, a Cancel button, capped output, its own process group
  where the system has them, and it is killed when the app exits. A script does not outlive
  the window.

What that does **not** mean: it bounds *which file* runs, for how long and how much it may
say — it says nothing about what is **in** that file. The interpreter and the script
folders are ordinary settings; anything that can change your settings file can point gEdit
at a different interpreter, and the "New script" command creates a writable, runnable file
by design.

So the rule is the one at the top of this page: **only run scripts you trust.** Read a
script before you run it, the same way you would read a macro somebody mailed you. They
are short, and they are meant to be read.

## When something does not work

| | |
|---|---|
| The script commands are greyed out | No Python was found. Set `Settings ▸ Scripts ▸ Python interpreter` to the interpreter's path |
| A script is not in the menu | It may be for other dialects (`profiles` in its header), it may be hidden behind a file of the same name in a later folder, or its name starts with `_`. Use **Rescan** after adding it |
| It appears, but its description is wrong or missing | Its header could not be read as TOML; it then runs in the simplest mode and shows raw output only |
| "Nothing was applied" after an edit | You typed in the document while it ran. Run it again, or take **Open result in new tab** |
| It is stopped every time | It needs longer than the time limit: raise `Settings ▸ Scripts ▸ Script timeout`, or set `timeout` in the script's header |
| Nothing comes back at all | Look in the **Output** panel: whatever the script wrote to its error output is there |
