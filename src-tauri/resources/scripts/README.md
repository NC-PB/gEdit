# gEdit scripts

This folder is the **`bundled:` script root**. Everything in it ships with gEdit as a
bundle resource (`bundle.resources` in `src-tauri/tauri.conf.json` maps `resources/scripts/`
to `scripts/`), so at runtime it is `resource_dir()/scripts`. It is also what gEdit puts on
`PYTHONPATH`, so **any** script — bundled or your own — can `import gedit_nc`.

Bundled scripts are **read-only**. The app never grants one to the webview's file scope: to
change one, use **Copy to My Scripts** (command palette) or **Edit Script ▸ Copy and edit**,
which puts a copy in `<config>/scripts`, where it shadows the bundled file of the same name
unless an extra folder holds one too (Phase 1 plan §3, AD-13).

| File | What |
| --- | --- |
| `gedit_nc.py` | the shared library, and the only import path a script may use: context, tokenizer, number formatting, modal state, machine parameters, report and envelope output (Phase 1 plan §7.10) |
| `_nc_lex.py` | the tokenizer and the number formatting behind it |
| `_nc_modal.py` | `ModalInterpreter` and `FeedModeTracker`: what is in force after a block |
| `_nc_machine.py` | the machine parameters, and what a written number is worth on one |
| `tool_list.py` | tools in order of first use, with descriptions and call counts — `output = "report"` |
| `scale_feed.py` | multiply `F` values by a percentage — `output = "replace"` |
| `scale_speed.py` | multiply `S` values by a percentage — `output = "replace"` |
| `program_checks.py` | M10 (WP10.2): what a program does that the control or the machine will not like — `output = "report"` |
| `extents.py` | M10 (WP10.3): the smallest and largest value of every axis, per offset, tool and program — `output = "report"` |
| `address_arithmetic.py` | M10 (WP10.4): add, subtract, multiply or divide the values of chosen addresses; a shift of the tool axis moves the cycle positions that hold one (roadmap R8) — `output = "replace"` |

`gedit_nc.py`, and any file or folder whose name starts with `_` or `.`, is **not listed as
a script**: discovery skips them, because they are library code, not commands. The `_nc_*`
modules are the internals of `gedit_nc`, which re-exports everything that is public — a
script imports `gedit_nc` and nothing else, so the split can move without breaking anyone.

---

## The rest of this file is the contract

It is written for someone putting their own `.py` into the user scripts folder. Everything
below is what gEdit guarantees and what it expects back; the bundled scripts are worked
examples of it, and `src-tauri/src/scripts/template.py` is the skeleton **New Script**
writes. The user guide's [Scripts](../../../docs/user/scripts.md) page describes the same
things for the person running the scripts.

## 1. Where your script goes, and what it is called

| Root | Where | Id |
| --- | --- | --- |
| bundled | this folder, inside the app | `bundled:scale_feed.py` |
| user | `<config>/scripts` | `user:my_script.py`, `user:turning/my_script.py` |
| extra | each folder in the `scripts.folders` setting | `extra0:my_script.py` |

An id is `root:name.py` or `root:group/name.py`. Every segment is a plain file name — no
separators, no `.` or `..`, nothing starting with `.`, `_` or a blank — the file ends in
`.py`, and the resolved path has to stay inside its root, so a symlink cannot point out of
the folder. A segment may not be `gedit_nc.py`, may not end in `.` or a space, and may not
contain `:` or a control character; on Windows a device name (`CON`, `PRN`, `AUX`, `NUL`,
`COM0`–`COM9`, `LPT0`–`LPT9`, with any extension) is refused too, and **New Script** refuses
those names on every platform. One sub-folder deep is a group, which is how the Tools tab
groups its script buttons.

A script shadows one with the same file name — in any group — in an earlier root: user
over bundled, an extra folder over both, a later extra folder over an earlier one. Only the
winner is listed.

## 2. The header

A script declares itself in a block the backend reads as TOML. Without one it still runs,
in panel mode, on every dialect: stdin in, raw stdout in the Script Output panel.

```python
#!/usr/bin/env python3
# /// gedit
# name = "Scale lathe feeds"
# description = "Multiply F values by a percentage."
# profiles = ["fanuc-lathe", "okuma-osp", "sinumerik"]   # omit = every profile
# input = "selection-or-document"                       # document | selection | selection-or-document | none
# output = "replace"                                    # replace | new-document | report | panel
# timeout = 60                                          # 1..86400 s; omit = scripts.timeoutSeconds
# envelope = true                                       # stdout is {"text", "message", "findings"}
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

An example. The bundled `scale_feed.py` declares no `profiles`, so it is offered on every
dialect. `profiles` is compared exactly: a script for `fanuc-gcode` is not offered on
`fanuc-lathe`, an empty list means every profile, and an unknown id is not reported.

The block has to come first: only blank lines, a `#!` line (line 1) and a coding line
(line 1 or 2) may stand above it. Every line of it is a comment, it ends at `# ///`, and it
has to close within the first 64 KiB of the file. `name` is required. A key gEdit does not
know is recorded as a warning that nothing shows, and is otherwise ignored — so a misspelt
`ouput = "replace"` leaves the script in panel mode. `documents` is accepted (`"active"`,
`"all-open"` or `"pick"`), but every value means the active document.

`[[params]]` entries are `FieldSpec`s (Phase 1 plan §7.5) and become the form gEdit shows
**before** the script runs; the values arrive in `context["params"]` under their `id`. The
types are `number`, `integer`, `text`, `bool`, `choice`, `file`, `folder` and
`address-list`. A `choice` carries `choices = [{ label = …, value = … }]`, each with a label
and a plain value. An `address-list` offers only its own `choices`: a script's form has no
document to take the dialect's addresses from.

Every field needs an `id` (ASCII letters, digits, `_` and `-`, not starting with a digit,
and not used twice), a `label` and a `type`. A field is optional unless it sets
`required = true`. `min` may not be above `max`, `decimals` is at most 10, and a `default`
must suit the type (an `address-list` default is a list of text). An optional number,
integer or choice left empty is absent from `context["params"]`; an empty text, file or
folder arrives as `""`, a bool as `false`, an address list as `[]`.

**A header that does not parse is not a script that half works**: gEdit falls back to
`panel`, because a half-understood script must never be read as `replace`. The Tools tab
then lists the script under its file name, and its tooltip says that the header could not
be read — not why.

## 3. What your script is given

**stdin** is the text to work on: UTF-8, LF line endings, no BOM. It is the whole document
or the selection, according to `input`. `selection-or-document` is resolved *before* the
run, so the context always says which one you got. The document keeps its own encoding and
line ending; gEdit puts them back when it saves.

**Everything else** is JSON in the file named by the `GEDIT_CONTEXT` environment variable,
which every run gets. `gedit_nc.load_context()` reads it, and answers `{}` when it is
missing — a script started outside gEdit, from a terminal or a test — which your script
should survive with defaults, or a clear message, rather than a traceback.

```jsonc
{
  "contract": 2,
  "document": {
    "path": "/jobs/parts/O1234.nc",      // null for an untitled document
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
  "profile": { /* the effective dialect profile: resolved, with the machine applied */ },
  "codes":   [ /* the effective code database, without templates */ ],
  "machine": { /* the document's machine, with the source of each parameter */ }
}
```

`profile` and `codes` are what make a script dialect-agnostic: comment syntax, addresses,
keywords, number format and what each code *means* all come from there. Nothing in a good
script hardcodes Fanuc. A `codes` entry can carry `tapping` (the code taps a thread —
a cycle, a rigid-tapping call, or a mode such as Fanuc `G63`), `tappingElsewhere` (set with
`pitchFeedAmbiguous`: the code is a tap on the *other* kind of machine its dual meaning
points at, e.g. Okuma `G84`/`G88`, the Fanuc lathe's `G74`) and `wordsAreData` (the words of
the block are arguments or data, not a feed or a position — `G65`, `G66`, `G10`); a profile
can carry `addresses.mainSpindle` (which spindle number is the main one, Sinumerik `"1"`)
and `syntax.programNames`/`syntax.decimalSeparatorAlt` (a program-name token, a second
decimal separator). `scale_feed.py` and `scale_speed.py` read all of these.

M10 added the members `program_checks.py` reads, all optional and all read straight off the
entry dictionary: `sets.spindle` and `sets.toolSpindle` (`on`/`off`: the code starts or stops
the main or a driven-tool spindle), `sets.motion` (`rapid`/`feed`), `sets.radiusComp` and
`sets.lengthComp` (`on`/`off`), `sets.exitSpeed` (`zero`: a tapping mode that ends with the
speed at zero), `sets.language` (`iso`/`native`: a Sinumerik code that switches the control's
programming language); and, on the entry itself, `conflicts` (the states in which the control
refuses the code: `tcp`, `radiusComp`, `lengthComp`, `cycle`, `surfaceSpeed`,
`feedNotPerMinute`, `frame:<group>`, and `!` in front of a condition for "refused unless"),
`alone` (the code has to stand alone in its block), `requires` (words of which the block must
carry one) and `contour` (`open`/`close`: the blocks between define a shape, not a cut). A
profile can carry `syntax.maxWordDigits` and `syntax.maxMCodes`. `program_checks.py` says in
its report when the database has none of the spindle members, instead of guessing.

The M10 review added four more, read straight off the entry by `address_arithmetic.py` and
`extents.py`: `pole` (`set` on the code whose axis words are the circle centre or pole,
Klartext `CC`; `use` on the moves around it, `C`, `LP`, `CP`, `CTP`), `call` (`true`: the code
runs another program and hands it the block's words as arguments, Fanuc `G65`), `shift`
(`true`: the code's axis words shift or set the coordinate system, `G52`, `G92`, `TRANS`), and
on a parameter `axis` (the axis whose coordinate the parameter is, the `CIP` point `I1=`). A
profile can carry `syntax.blockSkip.plainLevel` (the level the bare `/` is) and
`program.endRecord` (an `end` line is the closing record of the file, Klartext `END PGM`).

Both are **effective**: the profile is resolved through its `extends` chain and the
document's machine configuration is already applied to it, so the chosen G-code system has
picked the code database, the machine's power-on codes are in `modal.initial` and
`syntax.decimalPointSignificant` follows how that control reads a number. A script that
scales values never has to know that machines exist.

`machine` is the machine itself, for the scripts that do: `{id, name, choice, params,
source}`, where `source` says per parameter whether it came from the machine, from what was
detected in this program, or from the profile's documented default. For a document with no
machine the member holds the profile's documented defaults — every source `"profile"`
except a variant detected in the program (and the power-on codes that variant brings),
whose source is `"detected"`. Read it with `gedit_nc.machine_params(context)`; for a context
without the member — from a gEdit older than machine configurations — it answers those
defaults with every source `"profile"`.

`channels` is the one optional member more, for a document of a machine that has channel
settings (a control that runs several streams at once: two turrets, two paths). It is
**absent** for any other document — no machine, a machine without channel settings, a
program no section start matches — so a script written before channels existed runs
unchanged and `contract` stays 2. When it is there:

```jsonc
"channels": {
  "layout": "single-file",   // single-file: one program, a section for each channel | multi-file: a program for each channel
  "self": null,              // multi-file: the id of the channel this document is
  "list": [                  // every declared channel, in the machine's order
    { "id": "1", "name": "Turret A", "ranges": [ { "startLine": 5, "endLine": 12 }, { "startLine": 21, "endLine": 27 } ] },
    { "id": "2", "name": "Turret B", "ranges": [ { "startLine": 13, "endLine": 20 } ] }
  ],                         // multi-file: file, path and open instead of ranges; a channel not found has no ranges
  "outside": [ { "startLine": 1, "endLine": 4 } ],   // single-file: lines that belong to no channel
  "marks": [ { "id": "M901", "line": 11, "channel": "1", "partners": ["1", "2"], "blocking": true } ]
}
```

The line numbers are the document's own, also for a selection (the first line of stdin is
`input.startLine` then). `marks` are the waits found in *this* document only; `id` is `""`
for a rule that counts without a code, and `channel` is `""` outside every section. A script
never receives the text of another file. `gedit_nc` reads the member for you (§7).

## 4. What your script hands back

stdout is the **result**; anything you want to say to yourself goes to **stderr**. Exit 0
means the result is good.

| `output` | stdout | Applied as |
| --- | --- | --- |
| `panel` | anything | shown raw in the Script Output panel — the default, and the fallback |
| `replace` | the new text for `startLine..endLine` | one undo step, minimal edits |
| `new-document` | the text | a new untitled tab with the same profile |
| `report` | the JSON of `gedit_nc.report(...)` | a table in the Results panel |

With `envelope = true` on a `replace` or `new-document` script, stdout is
`gedit_nc.envelope(text, message, findings)` instead of bare text, which lets you hand back
a summary and a list of things you refused to touch:

```json
{"text": "…the new text for the input lines…",
 "message": "Scaled 12 of 14 feed rates to 90 %; 2 left as a thread pitch.",
 "findings": [{"line": 41, "severity": "warning", "message": "F625. is a thread pitch …"}]}
```

`gedit_nc.report(title, columns, rows, message, findings)` carries its own `message` and
`findings`, so a `report` script does not set `envelope`. A row or finding with a `line` is
clickable in the Results panel. `severity` is `info`, `warning` or `error`. `line` is a line
number of the **document**, not of stdin: in a selection run add `startLine - 1`. A finding
needs `line` and `message`, or the whole result is refused. At most 1000 findings and 5000
rows are taken, and the Results panel says how many more there were.

Two details worth knowing:

* A single trailing newline in **plain** stdout is dropped when the input did not end with
  one, because `print()` adds one and every run would otherwise grow the program by a line.
  An envelope's `text` is used exactly as given.
* For `replace`, **empty stdout is an error, not an empty document**. A script that crashed
  after printing nothing must not delete the selection.

## 5. What gEdit does with the answer — and what it refuses to do

This is the safety bar (Phase 1 plan §5, M5). It bounds what the *editor* does with your
result; it is not a sandbox around your script.

* **Nothing runs without the user asking.** There is no run-on-open and no run-on-save.
* A result is applied as **one undo step**, or not at all.
* A result is **never** applied to a document that changed while the script ran. The
  version is taken before stdin is built and compared afterwards; a mismatch offers the
  text in a new tab instead of overwriting.
* A failure is **visible**. A non-zero exit, a signal, a timeout, a cancel, truncated
  stdout (outside `panel`) and a malformed envelope or report all end as an error with a
  reason, and your stderr is kept for the Script Output panel. Nothing is applied on any of
  them.

The run itself: your script's own folder is the working directory; `PYTHONPATH` is **set**
(not extended) to this folder; `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8` and
`PYTHONDONTWRITEBYTECODE=1` are set; stdout is capped at 64 MiB and stderr at 1 MiB; the
deadline is your `timeout`, else `scripts.timeoutSeconds` (60 s by default); and on Unix the
child gets its own process group, so a cancel takes your grandchildren with it. On Windows
only the script itself is killed. Every run is killed when the app exits. The context file
sits in a folder of its own — readable by you alone on macOS and Linux — that is deleted
after the run. The interpreter is `GEDIT_PYTHON`, else `scripts.python` when it names an
existing file, else the lookup the user guide describes, and it has to be Python 3.9 or
newer.

**A script is an ordinary program with the user's rights, and gEdit cannot sandbox it**
(Phase 1 plan AD-13). The id grammar bounds *which file* runs — no traversal, no editing a
bundled script, one source of truth for the interpreter and the folder list, a bounded
deadline, capped output, no shell — and says nothing about what is inside that file. Run
scripts you trust, the way you would any other program.

## 6. Selections are the middle of a sentence

NC is modal. `G95`, a `G84` tapping cycle, `G96` — each stays in force until something
cancels it. A run over a **selection** therefore starts mid-program, and a script that
begins at the top-of-program state reads the fragment wrong: it scales a thread pitch it
cannot recognise, or a per-revolution feed as a per-minute one.

`input.precedingLines` carries the document lines **above** `startLine`, and a few lines at
the top of your run fix it:

```python
context = gedit_nc.load_context()
cp = gedit_nc.compile_profile(context["profile"])
tracker = gedit_nc.FeedModeTracker(context.get("codes") or [])
above = gedit_nc.preceding_lines(context)             # [] when it was not sent, or cannot be used
state = gedit_nc.prime_tracker(tracker, above, cp)    # also the LineState line 1 begins in
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

The Phase 1 plan §7.10, and the Phase 2 plan §7.4 and §7.15, are the contract; the
docstrings in the file are the detail.

| | |
| --- | --- |
| `load_context()`, `read_input()` | the context dictionary (`{}` without `GEDIT_CONTEXT`, or when the file cannot be read) and stdin as lines |
| `preceding_lines(context)` | the lines above a selection, or `[]` when they may not be used (§6) |
| `CONTEXT_ENV`, `CONTRACT` | `"GEDIT_CONTEXT"`, and the contract version this module understands (`2`) |
| `compile_profile(profile)` | every pattern of the profile compiled once, as a `CompiledProfile`; a profile it cannot use raises `ValueError`, naming the field |
| `to_py_regex(pattern)` | a profile pattern, written in the subset both languages read, as Python `re` source |
| `tokenize_line(line, cp, prev_state=None)` | one block's tokens, and the `LineState` the next line needs (Klartext's `~`) |
| `Token`, `NumericLiteral`, `LineState` | a token: `kind`, `start`, `end`, `text`, `address`, `value_text`, `value` (a `NumericLiteral`, or `None` for `F#101` and `F=R1`), `incremental`; a number as written: `raw`, `sign`, `int_part`, `frac_part`, `has_point`; the state between lines: `continuation` |
| `mask_comments(line, cp)` | the line with the comments blanked, same offsets — what a profile's own patterns run against |
| `block_number_of(line, cp)` | the block number of a line, as `{value, text, start, end}`, or `None` |
| `continues_block(line, cp)` | whether the line belongs to the block above it by a marker at its start (Okuma `$`) |
| `normalize_code(code)` | the canonical form of a written code: `G01` → `G1`, `cycl  def 200` → `CYCL DEF 200` (remembered per spelling: `functools.lru_cache`, bounded) |
| `parse_number`, `format_number`, `scale_decimal` | NC numbers as decimal strings, never as floats |
| `decimal_of(literal_or_text)` | the exact value of a token's value or raw text, read strictly and then, on failure, with a Klartext-style decimal comma retried as the point — beyond §7.10, used where a value has to be exact rather than merely "roughly the right class" (a limit check, a same-value comparison) |
| `number_format_of(profile)` | the profile's number format with its defaults filled in, for `format_number` and `write_back` |
| `ModalInterpreter(cp, codes)` | what is in force after a block — see below |
| `FeedModeTracker(codes)` | the older, smaller view: `feed_mode` (`G93`/`G94`/`G95`, or Klartext `FU`/`FZ`), `css` (between `G96` and `G97`), `active_cycle`, `pitch_feed` (the block's `F` is a thread pitch), `pitch_feed_ambiguous` and `ambiguous_code` (a code that is a threading cycle on another kind of machine, in the other G-code system or on another make of control), `f_not_feed` and `f_not_feed_code` (a dwell). Without a code database it still reads `G93`–`G95` and `G96`/`G97` by their usual meaning, but knows no cycle and no thread pitch. Also: `tapping` and `tapping_code` (a tapping code or cycle is in force), `pitch_mode` (a `pitchFeed` code that is modal and sits in a group of its own outside `cycle`/`motion` — Fanuc `G63` — is in force, so its feed is a lead too), `data_code` (a `wordsAreData` code's block — its words are not fed at all), `written` (a `CodeEntry.tapping` code was restated or an axis moved in this block, for `scale_speed`'s tapping rule) |
| `prime_tracker(tracker, lines, cp, first=None)` | walks the lines above a selection through a tracker and returns the `LineState` the selection begins in (§6); `first` is the first selected line |
| `speed_limit_of(codes, tokens)` | the code in this block whose `sets.speedLimit` makes the block's `S` a clamp, or `None` |
| `axis_words_of(entry)`, `frame_of(entry)`, `speed_limit_bound_of(entry)`, `tcp_of(entry)` | how one code entry's flags read (§7.2): the block's axis words are `'data'` or a `'machine'` position; the code opens or closes a coordinate `frame`; the side a speed limit bounds; tool centre point control `'on'`/`'off'` (M10) |
| `position_of(param)` | M10 (roadmap R8): what a cycle parameter is to a program shift — `'tool-axis'` (an absolute coordinate on the tool axis), `'none'`, `'other'` (an absolute position a shift cannot judge), `'mode'`, or `None` when nobody reviewed it |
| `is_assignment(token)`, `same_spindle(written, main)` | M10 review: a word written with `=` (`S1=900`, an indexed `S[2]=500`), which is a value and never a code; whether `1`, `01` and `1` name one spindle (a letter without case) |
| `names_main_spindle(token, speed_address, main_spindle)` | M10: a speed word that names the main spindle by its number (`S1=`, `S[1]=` where `addresses.mainSpindle` is 1) |
| `RotaryState(profile)` | M10 review: where each rotary axis stands while tool centre point control is off — `'unwritten'`, `'zero'`, `'turned'` or `'unknown'` (`state`); `update(words, line, machine)` with `(address, literal, incremental)` per rotary word; `blocking(linear, *states)` answers which rotary axes that turn a linear axis (ISO 841; on a lathe `C` does not turn `X`) are turned or unknown, and which are still unwritten; `first_written` says where each was first written. Address arithmetic and extents use it to leave positions of a tilted machine alone |
| `machine_type_of(profile)`, `incremental_axes(profile)`, `diameter_axes(profile)` | `'mill'` or `'lathe'`, the `{'U': 'X', 'W': 'Z'}` pairs, and the words written as a diameter |
| `machine_params(context)` | the document's machine: `params` (how numbers are read, units, diameter, variants, power-on codes) and `source` for each of them — `"machine"`, `"detected"` or `"profile"` (§3) |
| `number_class_of`, `value_of`, `readings_of`, `resolve_value`, `write_back` | what a word's number **is** on this machine, and how to write a value back into it — see [below](#why-your-script-needs-the-number-rules) |
| `WRITE_BACK_ERRORS` | the message `write_back` answers with when it refuses, by code: `rounded`, `noReading`, `notANumber` |
| `channels(context)` | the `channels` member as a copy — always with `layout`, `self`, `list`, `outside` and `marks` — or, for a document without channels, `{"layout": "none", "self": None, "list": [], "outside": [], "marks": []}` |
| `channel_of(context, line)` | the id of the channel that holds the 1-based document line, or `None` (outside every section, or no channels). A section several channels share belongs to each; this answers the first. In `multi-file` every line is the document's own channel |
| `channel_lines(context, lines, channel_id)` | the lines of one channel, all its sections joined in program order — what the control runs as one program. Never a line from outside the channels; `[]` for an unknown id |
| `channel_line_numbers(context, lines, channel_id)` | the document line number of each line `channel_lines` returns |
| `outside_lines(context, lines)`, `outside_line_numbers(context, lines)` | the lines that belong to no channel, and their document line numbers |
| `sync_marks(context, channel_id=None)` | the waits found in this document, of one channel or of all, in line order (copies) |
| `report(...)`, `envelope(...)` | the two JSON result shapes |

`tokenize_line`, `parse_number` and `format_number` are ports of
`src/lib/core/nc/{tokenizer,numbers,numberFormat}.ts` and are held to the same goldens in
`tests/fixtures/tokens/` and `tests/fixtures/numberformat.cases.json`. That shared set is
the contract between the two implementations: when one has to change, the fixture changes
with it and **both** sides are re-run.

The number rules are a port of `src/lib/core/machines/numbers.ts` and are held to
`tests/fixtures/machines/numbers.json` in both languages; the modal interpreter's goldens
are `tests/fixtures/modal/<profile>/**`.

### Channels

On a machine with channel settings the context carries `channels` (§3). Each function above
answers an empty result when the document has none, so **a script that uses them also runs
on a single-channel program** and needs no second version. They read `lines` as your script
got it: for a whole-document run line `i` is document line `i + 1`, for a selection the first
line is `input.startLine`, and every function cuts the ranges to the lines given. A selection
therefore sees the part of each channel inside it and never a line it was not handed.

```python
import gedit_nc

ctx = gedit_nc.load_context()
lines = gedit_nc.read_input()
for ch in gedit_nc.channels(ctx)["list"]:
    own = gedit_nc.channel_lines(ctx, lines, ch["id"])         # one program per turret
    numbers = gedit_nc.channel_line_numbers(ctx, lines, ch["id"])  # where each came from
```

A shared section (a line that two channels run) is in the list of each of them. Python 3.9
is enough; the module uses the standard library only.

### `ModalInterpreter(cp, codes)` — what is in force after a block

NC is modal: a feed mode, a cycle or constant surface speed stays in force until something
cancels it, and a script that reads a block without that state reads it wrong. Build one
from the compiled profile and the context's `codes`, feed it every line in program order,
and ask it what is in force:

```python
context = gedit_nc.load_context()
cp = gedit_nc.compile_profile(context["profile"])
interp = gedit_nc.ModalInterpreter(cp, context["codes"])
lines = gedit_nc.read_input()
state = None
for number, line in enumerate(lines, context["input"]["startLine"]):   # document lines
    tokens, state = gedit_nc.tokenize_line(line, cp, state)
    interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
    if interp.pitch_feed:
        continue            # this block's F is a thread lead, not a feed rate
```

`interp.state` is the whole picture: the active code per modal group with the line that set
it, the feed unit, the speed unit, the distance and diameter modes, the units, the plane,
the last tool, feed, speed and speed clamp, the active cycle, the coordinate frame in force
(`frame`, M10) and tool centre point control (`tcp`, M10), and the flags of the block just
applied. A value nothing in the program set is marked `assumed`, with `from` saying
where it came from — the document's machine, a detected variant, or the profile's documented
default. Nothing is guessed: a group nothing has named reads `unknown`.

Everything it knows comes from the profile and the code database, so the same code reads a
mill, a lathe in either G-code system, and Klartext. The third argument of `update` is the
line with its comments masked (`gedit_nc.mask_comments`); leave it out and the tool rule is
simply not applied.

`gedit_nc.FeedModeTracker` is the older, smaller view of the same state and keeps working
unchanged. Whether a diameter word is a diameter **or a radius** in the block you are
looking at is `interp.diameter_reading('X')` — the diameter mode alone does not answer it,
because a `DIAM90`-style mode is a diameter while the program is absolute and a radius while
it is incremental.

The turning dialects write three things an ISO mill never does, and the state reads them
from the tokens, not from a dialect name:

* a **call** (`CYCLE840(…)`) is the code of its identifier, so its cycle start and its
  pitch feed reach the block like those of a `G84`. A call stands in a block of its own, so
  its pitch feed protects no `F` of that block: on a call, ``pitchFeed`` means the cycle may
  take its lead from the feed **in force**, and `scale_feed.py` leaves that feed — and every
  feed written while such a call repeats behind `MCALL` — as written. A cycle whose lead is
  its own argument (`CYCLE84`, `CYCLE99`) does not carry the flag;
* a word written with **`=`** (`SB=2000`, `S3=2400`, `M3=3`, `LIMS=3000`, `F=R1`) is a
  value and never a code: `M3=3` switches spindle 3 and is neither `M33` nor the `M3` of
  the spindle the state follows, and only the plain `S` is the speed in force — and, from
  M10, a word that names the **main** spindle by its number (`S1=`, `S[1]=` where the
  profile's `addresses.mainSpindle` is 1: the owner's reading of 2026-09-27). A word the
  profile lists in `addresses.speedLimitWords` (`LIMS=`) is a clamp wherever it stands. The
  state does not follow which spindle is the master (`SETMS(3)`); `scale_speed.py` reads
  that itself, from a call of a non-modal code of the database's ``spindle`` group;
* a **dwell** block (the database's `fNotFeed`: `G04 F2`, `G4 F2`, `G4 S2`) is a dwell as
  a whole: its `F` is a time and its `S` counts revolutions, so neither changes the feed or
  the speed in force. `FeedModeTracker` says so with `f_not_feed` and names the code in
  `f_not_feed_code`; a script that scales feeds or speeds leaves both words alone.

Three readings arrived with M10 (the prelude P10; plan §7.4 rules 13–15), for the scripts
that move or measure positions:

* **`frame`** is the innermost coordinate frame in force — a tilted plane, a rotation, a
  mirror, a scaling, a transformation — as `{code, line}`, or `None`; `open_frames` lists
  them all. A `frame: 'close'` code ends the open frames of its **own group** only (`G69`
  ends `G68`, not the scaling of `G51`; `PLANE RESET` ends a `PLANE`, not the mirror of cycle
  8); a frame code written without values closes its group where the database says so
  (`CYCLE800()`, `TRANS` alone), and a Klartext tilt closes its group once every angle the
  database names for it stands at zero (`frameZeroWords`: cycle 19's `A`/`B`/`C`, `PLANE
  SPATIAL`'s `SPA`/`SPB`/`SPC`; an angle not written keeps its value, one that is not a plain
  number counts as not zero). A close that matches nothing leaves the frame open: when in
  doubt, a position is in a frame.
* **`tcp`** is the code that switched tool centre point control on (`TRAORI`, `G43.4`,
  `M128`, `FUNCTION TCPM`), or `None`. Under it `X`/`Y`/`Z` are the tool tip in the
  workpiece; it is not a frame.
* **`plane`** follows the bare tool-axis letter of a Klartext `TOOL CALL 1 Z` (`XY`), which
  is the database's `sets.planeFromAxisWord`.

Okuma continues a block on lines that **start** with `$` (the profile's
`syntax.continuationStart`), and the lead of a `G71` thread cycle often stands on one:
`N001 G71 X27.55 Z-30 B60 D0.7 U0.1`, then `$ H2.45 L2 F2 M23 M32 M73`. Such a line tokenizes
like any other; `gedit_nc.continues_block(line, cp)` says whether it belongs to the block
above. `ModalInterpreter(cp, codes)` asks its own profile. `FeedModeTracker` is built from
the database alone and cannot, so tell it — without the argument it reads every line as a
block of its own, as it always did:

```python
tokens, state = gedit_nc.tokenize_line(line, cp, state)
tracker.update(tokens, continued=gedit_nc.continues_block(line, cp))
```

For a selection, pass the first selected line to `prime_tracker` as well
(`prime_tracker(tracker, above, cp, lines[0])`): a selection that starts on a `$` line
starts inside the block above it, thread cycle and all.

### Why your script needs the number rules

`X50` is 50 mm on one control and 0.050 mm on the next, and the difference is a machine
parameter, not a property of the dialect. A script that only *scales* can ignore all of this
— scaling is unit-free, and the effective `syntax.decimalPointSignificant` already follows
the machine. A script that **compares** a value with a limit, or **computes** with one, has
to ask. The whole loop, for the words a script compares; it runs as it stands, on a whole
program or a selection, on every shipped dialect:

```python
context = gedit_nc.load_context()
profile = context["profile"]
cp = gedit_nc.compile_profile(profile)
machine = gedit_nc.machine_params(context)
interp = gedit_nc.ModalInterpreter(cp, context["codes"])
first = context["input"]["startLine"]
above = gedit_nc.preceding_lines(context)          # the lines above a selection, or []
state = None
for number, line in enumerate(above + gedit_nc.read_input(), first - len(above)):
    tokens, state = gedit_nc.tokenize_line(line, cp, state)
    interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
    if number < first:
        continue                                    # above the selection: its state only
    units = interp.state["units"]["value"]          # "mm" or "inch" in this block
    # The database entries of the codes this block writes (G84, M3, CYCLE840(…)).
    written = [t.address if t.kind == "call" else t.text
               for t in tokens if t.kind in ("word", "call")]
    block_codes = [entry for entry in map(interp.entry, written) if entry is not None]
    for token in tokens:
        if token.kind != "word" or token.address not in ("X", "Z", "F"):
            continue                                # the words this script compares
        cls = gedit_nc.number_class_of(token.address, profile, interp.feed_unit,
                                       block_codes, interp.pitch_feed)
        value, readings = gedit_nc.resolve_value(token.value, cls, machine, profile, units)
        if value is None:
            # No number (F#101), no class, or a reading that depends on a machine nobody
            # chose. Report the word — `readings` says what each preset would make of it —
            # and leave it alone.
            ...
```

`number_class_of` wants the feed unit and the thread flag **in force** and the database
entries of the block's codes, so it takes them from a `ModalInterpreter` that has just been
given the block; a `FeedModeTracker` does not carry the feed unit. `units` follows the
program: the machine's power-on units until a `G20` or `G21` changes them. `value` is
decimal text in millimetres, inches, degrees or seconds. To put a value back into the word
it came from, use `write_back`, which keeps the word's own form (a point stays a point, a
point-less word stays a count) and tells you when the value had to be rounded:

```python
text, rounded, error = gedit_nc.write_back(new_value, token.value, cls, machine, units,
                                           gedit_nc.number_format_of(profile))
```

Never divide by a thousand yourself, and never assume a point-less word is a count: the
machine decides, and where no machine was chosen gEdit refuses to decide for it.

## 8. Writing one

A script you share, or one that ships with gEdit, uses the standard library only, and it
has to run on Python 3.9 as well as on the newest release — no `match`, no `X | Y` outside
annotations, and `from __future__ import annotations` at the top. There is no pip install
step, by design: an NC programmer should be able to run gEdit's scripts on a fresh machine
with nothing but Python. A script of your own may use a virtual environment's interpreter
(`scripts.python`).

The rules that matter more than any feature — prime a selection, work on tokens, never let a
number change its form by accident, ask the code database, and when in doubt leave the value
alone and say so — are written out once, in the user guide:
[Five rules that matter more than any feature](../../../docs/user/scripts.md#five-rules-that-matter-more-than-any-feature).

## 9. Tests

`tests/python/` (standard library `unittest`, run by CI on Python 3.9 and 3.12):

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
document as the input. Two of its keys are not context members: `machine` (the machine's
parameters) runs the case against the effective profile generated for it — run
`UPDATE_RESOLVED=1 npm test -- resolved` after adding one — and `machineName` is the name it
carries in the messages. A case with a `preceding.nc` is worth checking **twice** — once as
it stands and once with `precedingLines` taken back out — because a golden on its own only
proves the script is self-consistent, not that the priming does anything. The
`TestSelectionPriming` classes in `tests/python/test_scale_feed.py` and
`test_scale_speed.py` are the pattern.

The programs in the fixtures are synthetic: written for gEdit from `docs/planning/syntax/`,
not copied from a machine, a CAM system or a customer, and not meant to run on a machine.
