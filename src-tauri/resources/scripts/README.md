# Bundled scripts

Everything in this folder ships with gEdit as a bundle resource
(`bundle.resources` in `src-tauri/tauri.conf.json` maps `resources/scripts/` to
`scripts/`), so at runtime it is `resource_dir()/scripts`. That folder is the
**`bundled:` script root**, and it is also what gEdit puts on `PYTHONPATH`, so a user
script can `import gedit_nc` as well.

Bundled scripts are **read-only**. The app never grants one to the webview's file scope:
to change one, use "Copy to user folder", which puts a copy in `<config>/scripts`, where
it shadows the bundled file of the same name (plan §3, AD-13).

| File | Owner | What |
| --- | --- | --- |
| `gedit_nc.py` | **WP4.6** | the shared library: context, tokenizer, number formatting, feed modes, report and envelope output (plan §7.10) |
| `tool_list.py` | **WP4.6** | tools in order of first use, with descriptions and call counts — `output = "report"` |
| `scale_feed.py` | **WP4.7** | multiply `F` values by a percentage — `output = "replace"` |
| `scale_speed.py` | **WP4.7** | multiply `S` values by a percentage — `output = "replace"` |

`gedit_nc.py` and any file whose name starts with `_` are **not listed as scripts**:
discovery skips them, because they are library code, not commands.

## What `gedit_nc` gives you

Plan §7.10 is the contract; the docstrings in the file are the detail.

| | |
| --- | --- |
| `load_context()`, `read_input()` | the context dictionary and stdin as lines |
| `compile_profile(profile)` | every pattern of the profile compiled once |
| `tokenize_line(line, cp, prev_state)` | one block's tokens, and the state the next line needs |
| `mask_comments(line, cp)` | the line with the comments blanked, same offsets — what a profile's own patterns run against |
| `parse_number`, `format_number`, `scale_decimal` | NC numbers as decimal strings, never as floats |
| `FeedModeTracker(codes)` | G93/G94/G95, G96/G97, the active cycle and whether its `F` is a thread pitch |
| `report(...)`, `envelope(...)` | the two JSON result shapes |

`tokenize_line`, `parse_number` and `format_number` are ports of
`src/lib/core/nc/{tokenizer,numbers,numberFormat}.ts` and are held to the same goldens in
`tests/fixtures/tokens/` and `tests/fixtures/numberformat.cases.json`. That shared set is
the contract between the two implementations: when one has to change, the fixture changes
with it and **both** sides are re-run.

## Writing one

Standard library only, and it has to run on Python 3.9 as well as on the newest release —
no `match`, no `X | Y` outside annotations, and `from __future__ import annotations` at
the top. There is no pip install step, by design: an NC programmer should be able to run
gEdit's scripts on a fresh machine with nothing but Python.

A script declares itself in a header block that the backend reads as TOML:

```python
#!/usr/bin/env python3
# /// gedit
# name = "Scale feed rates"
# description = "Multiply F values by a percentage."
# profiles = ["fanuc-gcode", "heidenhain-klartext"]   # omit = every profile
# input = "selection-or-document"                     # document | selection | selection-or-document | none
# output = "replace"                                  # replace | new-document | report | panel
# timeout = 60                                        # seconds; omit = scripts.timeoutSeconds
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

Without a header a script still runs, in v1 mode: stdin in, raw stdout in the output
panel.

Input arrives on stdin as UTF-8 with LF line endings; the document keeps its own encoding
and line ending on save. Everything else — the document's metadata, the input range, the
cursor, the parameter values, the resolved profile and the code database — is in the JSON
file named by the `GEDIT_CONTEXT` environment variable. Write the **result** to stdout and
anything else to stderr.

Two rules that matter more than any feature:

1. **Work on tokens, never on a regex over raw lines.** `gedit_nc.tokenize_line` knows
   what is a comment, a string, a variable and an expression in *this* dialect. A naive
   `re.sub` rewrites the `G1` inside `(FINISH G1 PASS)` and corrupts the program.
2. **Never widen or narrow a number by accident.** Use `scale_decimal` and
   `format_number`; they keep `10.` from becoming `10`, keep the written precision, and
   round the same way the editor's own transforms do.

## Tests

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
| `params.json` | optional | the parameter values the user would have filled in |
| `case.json` | optional | `{"profile": "heidenhain-klartext"}`, and any context member to replace (an `input` that makes the case a selection, for example) |

`case.json` defaults to the `fanuc-gcode` profile with its code database, and the whole
document as the input.
