# gEdit scripts

This folder is the **`bundled:` script root**. Everything in it ships with gEdit as a
bundle resource (`bundle.resources` in `src-tauri/tauri.conf.json` maps `resources/scripts/`
to `scripts/`), so at runtime it is `resource_dir()/scripts`. It is also what gEdit puts on
`PYTHONPATH`, so **any** script — bundled or your own — can `import gedit_nc`.

Bundled scripts are **read-only**. The app never grants one to the webview's file scope: to
change one, use "Copy to user folder", which puts a copy in `<config>/scripts`, where it
shadows the bundled file of the same name (plan §3, AD-13).

| File | Owner | What |
| --- | --- | --- |
| `gedit_nc.py` | **WP4.6** | the shared library: context, tokenizer, number formatting, feed modes, report and envelope output (plan §7.10) |
| `tool_list.py` | **WP4.6** | tools in order of first use, with descriptions and call counts — `output = "report"` |
| `scale_feed.py` | **WP4.7** | multiply `F` values by a percentage — `output = "replace"` |
| `scale_speed.py` | **WP4.7** | multiply `S` values by a percentage — `output = "replace"` |

`gedit_nc.py` and any file whose name starts with `_` are **not listed as scripts**:
discovery skips them, because they are library code, not commands.

---

## The rest of this file is the contract

It is written for someone putting their own `.py` into the user scripts folder. Everything
below is what gEdit guarantees and what it expects back; the bundled scripts are worked
examples of it, and `src-tauri/src/scripts/template.py` is the skeleton "New script"
writes.

## 1. Where your script goes, and what it is called

| Root | Where | Id |
| --- | --- | --- |
| bundled | this folder, inside the app | `bundled:scale_feed.py` |
| user | `<config>/scripts` | `user:my_script.py`, `user:turning/my_script.py` |
| extra | each folder in the `scripts.folders` setting | `extra0:my_script.py` |

An id is `root:name.py` or `root:group/name.py`. Every segment is a plain file name — no
separators, no `.` or `..`, nothing starting with `.` — the file ends in `.py`, and the
resolved path has to stay inside its root, so a symlink cannot point out of the folder. One
sub-folder deep is a group, which is how the Scripts menu builds its sub-menus.

A user script with the same name as a bundled one **shadows** it; only one of the two is
listed.

## 2. The header

A script declares itself in a block the backend reads as TOML. Without one it still runs,
in v1 mode: stdin in, raw stdout in the Output panel.

```python
#!/usr/bin/env python3
# /// gedit
# name = "Scale feed rates"
# description = "Multiply F values by a percentage."
# profiles = ["fanuc-gcode", "heidenhain-klartext"]   # omit = every profile
# input = "selection-or-document"                     # document | selection | selection-or-document | none
# output = "replace"                                  # replace | new-document | report | panel
# timeout = 60                                        # 1..86400 s; omit = scripts.timeoutSeconds
# envelope = true                                     # stdout is {"text", "message", "findings"}
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

`[[params]]` entries are `FieldSpec`s (plan §7.5) and become the form gEdit shows **before**
the script runs; the values arrive in `context["params"]` under their `id`. The types are
`number`, `integer`, `text`, `bool`, `choice`, `file`, `folder` and `address-list`. A
`choice` carries `choices = [{ label = …, value = … }]`; an optional field sets
`required = false` and no `default`.

The header is read out of the first 64 KiB of the file. **A header that does not parse is
not a script that half works**: gEdit falls back to `panel`, because a half-understood
script must never be read as `replace`.

## 3. What your script is given

**stdin** is the text to work on: UTF-8, LF line endings, no BOM. It is the whole document
or the selection, according to `input`. `selection-or-document` is resolved *before* the
run, so the context always says which one you got. The document keeps its own encoding and
line ending; gEdit puts them back when it saves.

**Everything else** is JSON in the file named by the `GEDIT_CONTEXT` environment variable.
`gedit_nc.load_context()` reads it, and answers `{}` when it is missing — a v1 run, which
your script should survive with defaults rather than a traceback.

```jsonc
{
  "contract": 2,
  "document": {
    "path": "/Users/x/parts/O1234.nc",   // null for an untitled document
    "name": "O1234.nc",
    "profile": "fanuc-gcode",
    "encoding": "utf-8", "hasBom": false, "lineEnding": "crlf",
    "modified": true
  },
  "input": {
    "scope": "selection",                // selection | document | none
    "startLine": 41, "endLine": 48,      // 1-based, inclusive, whole lines
    "precedingLines": ["%", "O1234", "…"] // optional; see §6
  },
  "cursor": { "line": 44, "column": 3 },
  "params": { "percent": 90 },
  "profile": { /* the resolved dialect profile, as it is shipped */ },
  "codes":   [ /* the dialect's code database, without templates */ ]
}
```

`profile` and `codes` are what make a script dialect-agnostic: comment syntax, addresses,
keywords, number format and what each code *means* all come from there. Nothing in a good
script hardcodes Fanuc.

## 4. What your script hands back

stdout is the **result**; anything you want to say to yourself goes to **stderr**. Exit 0
means the result is good.

| `output` | stdout | Applied as |
| --- | --- | --- |
| `panel` | anything | shown raw in the Output panel — the default, and the fallback |
| `replace` | the new text for `startLine..endLine` | one undo step, minimal edits |
| `new-document` | the text | a new untitled tab with the same profile |
| `report` | the JSON of `gedit_nc.report(...)` | a table in the Results panel |

With `envelope = true` on a `replace` or `new-document` script, stdout is
`gedit_nc.envelope(text, message, findings)` instead of bare text, which lets you hand back
a summary and a list of things you refused to touch:

```json
{"text": "…the whole program…",
 "message": "Scaled 12 of 14 feed rates to 90 %; 2 left as a thread pitch.",
 "findings": [{"line": 41, "severity": "warning", "message": "F625. is a thread pitch …"}]}
```

`gedit_nc.report(title, columns, rows, message, findings)` carries its own `message` and
`findings`, so a `report` script does not set `envelope`. A row or finding with a `line` is
clickable in the Results panel. `severity` is `info`, `warning` or `error`.

Two details worth knowing:

* A single trailing newline in **plain** stdout is dropped when the input did not end with
  one, because `print()` adds one and every run would otherwise grow the program by a line.
  An envelope's `text` is used exactly as given.
* For `replace`, **empty stdout is an error, not an empty document**. A script that crashed
  after printing nothing must not delete the selection.

## 5. What gEdit does with the answer — and what it refuses to do

This is the safety bar (plan §5 M5). It bounds what the *editor* does with your result; it
is not a sandbox around your script.

* **Nothing runs without the user asking.** There is no run-on-open and no run-on-save.
* A result is applied as **one undo step**, or not at all.
* A result is **never** applied to a document that changed while the script ran. The
  version is taken before stdin is built and compared afterwards; a mismatch offers the
  text in a new tab instead of overwriting.
* A failure is **visible**. A non-zero exit, a signal, a timeout, a cancel, truncated
  stdout and a malformed envelope or report all end as an error with a reason, and your
  stderr is kept for the Output panel. Nothing is applied on any of them.

The run itself: your script's own folder is the working directory; `PYTHONPATH` is **set**
(not extended) to this folder; `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` and
`PYTHONDONTWRITEBYTECODE=1` are set; stdout is capped at 64 MiB and stderr at 1 MiB; the
deadline is your `timeout`, else `scripts.timeoutSeconds` (60 s by default); and on Unix the
child gets its own process group, so a cancel takes your grandchildren with it.

**A script is an ordinary program with the user's rights, and gEdit cannot sandbox it**
(AD-13). The id grammar bounds *which file* runs — no traversal, no editing a bundled
script, one source of truth for the interpreter and the folder list, a bounded deadline,
capped output, no shell — and says nothing about what is inside that file. Run scripts you
trust, the way you would any other program.

## 6. Selections are the middle of a sentence

NC is modal. `G95`, a `G84` tapping cycle, `G96` — each stays in force until something
cancels it. A run over a **selection** therefore starts mid-program, and a script that
begins at the top-of-program state reads the fragment wrong: it scales a thread pitch it
cannot recognise, or a per-revolution feed as a per-minute one.

`input.precedingLines` carries the document lines **above** `startLine`, and two lines at
the top of your run fix it:

```python
context = gedit_nc.load_context()
tracker = gedit_nc.FeedModeTracker(context.get("codes") or [])
above = gedit_nc.preceding_lines(context)      # [] when it was not sent, or cannot be used
state = gedit_nc.prime_tracker(tracker, above, cp)   # also the LineState line 1 begins in
```

`prime_tracker` returns the `LineState` to pass to your first `tokenize_line`, so a Klartext
`~` continuation that begins above the selection is still a continuation inside it.

Three rules to keep:

1. **The field is optional, and absent is a correct context.** Keep whatever your script did
   without it — for the bundled ones that is a loud warning at the first line saying what
   they could not see. Never assume the state instead.
2. **`preceding_lines()` decides whether it may be used**, not you. It answers `[]` unless
   the scope is `selection`, the value is a list of strings, and there are exactly
   `startLine - 1` of them. The contract tells the runner to *omit* the field rather than
   truncate it, because a tracker primed with the tail of a program is confidently wrong
   while an absent field keeps the honest warning; that length check is where the rule is
   enforced on this side.
3. **Prime once**, before the tracker's first `update()`. Priming one that has already
   walked a program layers two programs on top of each other.

A primed run should **say** what it inherited when that changes what it does — see
`inherited_text` in `scale_feed.py`. A number the user did not expect is worth one line in
the results panel.

## 7. What `gedit_nc` gives you

Plan §7.10 is the contract; the docstrings in the file are the detail.

| | |
| --- | --- |
| `load_context()`, `read_input()` | the context dictionary and stdin as lines |
| `compile_profile(profile)` | every pattern of the profile compiled once |
| `tokenize_line(line, cp, prev_state)` | one block's tokens, and the state the next line needs |
| `mask_comments(line, cp)` | the line with the comments blanked, same offsets — what a profile's own patterns run against |
| `parse_number`, `format_number`, `scale_decimal` | NC numbers as decimal strings, never as floats |
| `FeedModeTracker(codes)` | G93/G94/G95, G96/G97, the active cycle, whether its `F` is a thread pitch, and whether the code means a threading cycle in another G-code system |
| `preceding_lines(context)`, `prime_tracker(tracker, lines, cp)` | the lines above a selection, and the modal state they leave behind (§6) |
| `report(...)`, `envelope(...)` | the two JSON result shapes |

`tokenize_line`, `parse_number` and `format_number` are ports of
`src/lib/core/nc/{tokenizer,numbers,numberFormat}.ts` and are held to the same goldens in
`tests/fixtures/tokens/` and `tests/fixtures/numberformat.cases.json`. That shared set is
the contract between the two implementations: when one has to change, the fixture changes
with it and **both** sides are re-run.

## 8. Writing one

Standard library only, and it has to run on Python 3.9 as well as on the newest release —
no `match`, no `X | Y` outside annotations, and `from __future__ import annotations` at the
top. There is no pip install step, by design: an NC programmer should be able to run
gEdit's scripts on a fresh machine with nothing but Python.

Four rules that matter more than any feature:

1. **Work on tokens, never on a regex over raw lines.** `gedit_nc.tokenize_line` knows what
   is a comment, a string, a variable and an expression in *this* dialect. A naive `re.sub`
   rewrites the `G1` inside `(FINISH G1 PASS)` and corrupts the program.
2. **Never widen or narrow a number by accident.** Use `scale_decimal` and `format_number`;
   they keep `10.` from becoming `10`, keep the written precision, and round the same way
   the editor's own transforms do. Never use a float.
3. **Ask the code database what a value means, not a table of your own.** The same `F` is a
   feed, a thread pitch or a thread lead depending on what is in force. `FeedModeTracker`
   reads that out of `context["codes"]`, so an unknown dialect degrades to "nothing is in
   force" rather than to a wrong answer.
4. **When you are not sure, refuse and say exactly what you skipped and why.** Not a count
   in a summary — a finding on the line, naming the value, the reason, and what the user
   can do about it. Refusing a real boring feed costs one manual edit; scaling a thread
   lead scraps the part.

## 9. Tests

`tests/python/` (standard library `unittest`, run by gate G4):

```sh
python3 -m unittest discover -s tests/python -t .
```

Fixtures live in `tests/fixtures/scripts/<script>/<case>/`, and the tokenizer and
number-format goldens in `tests/fixtures/tokens/` and
`tests/fixtures/numberformat.cases.json` are **shared with the TypeScript unit tests** —
that shared set is what keeps the two implementations honest.

A case folder holds

| File | | |
| --- | --- | --- |
| `input.nc` | required | what the script gets on stdin |
| `expected.nc` / `expected.json` | required, exactly one | what it has to produce |
| `envelope.json` | for an envelope script | the `message` and `findings` of the result |
| `params.json` | optional | the parameter values the user would have filled in |
| `preceding.nc` | optional | the document text **above** the input: makes the case a selection starting just below it and fills `input.precedingLines` (§6) |
| `case.json` | optional | `{"profile": "heidenhain-klartext"}`, and any context member to replace |

`case.json` defaults to the `fanuc-gcode` profile with its code database, and the whole
document as the input. A case with a `preceding.nc` is worth checking **twice** — once as
it stands and once with `precedingLines` taken back out — because a golden on its own only
proves the script is self-consistent, not that the priming does anything. The
`TestSelectionPriming` classes in `tests/python/test_scale_feed.py` and
`test_scale_speed.py` are the pattern.

The programs in the fixtures are synthetic: written for gEdit from `docs/planning/syntax/`,
not copied from a machine, a CAM system or a customer, and not meant to run on a machine.
