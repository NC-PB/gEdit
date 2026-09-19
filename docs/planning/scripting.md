# Scripting and extensibility

Scripting is gEdit's main extension mechanism. Users write small Python scripts that read NC code and return new code or a report. Many built-in functions ship as bundled scripts that use the same contract, so they double as examples.

Tag format: `Priority · Size · Delivery`.

## Current contract (v1)

As implemented in `src-tauri/src/lib.rs` (`run_python_script`, `list_python_scripts`) and `+page.svelte`:

- The user picks a scripts folder in the ribbon. The app lists the `*.py` files directly in it.
- Running a script starts `python3` (`python` on Windows) with the working directory set to the scripts folder, so helper modules next to the script can be imported.
- stdin receives the selected text, or the whole document if nothing is selected.
- stdout is shown in the Script Output panel. If stdout parses as JSON, it is also shown as a structured result. stderr and the exit status are shown too.
- Nothing is written back to the document. There are no parameters, timeout or cancel.

v1 scripts keep working unchanged. Everything below is opt-in through a metadata header.

## Contract v2

### Script metadata header
`P1 · S · Core`

A comment block at the top of the script, in the style of Python's inline script metadata, with its own block type `gedit`. The content is TOML. The app parses it in Rust (`toml` crate), and Python never needs to read it.

```python
# /// gedit
# name = "Scale feed rates"
# description = "Multiply F values by a percentage, with optional limits."
# profiles = ["fanuc-gcode", "heidenhain-klartext"]   # omit = all
# input = "selection-or-document"                     # document | selection | selection-or-document | none
# output = "replace"                                  # replace | new-document | report | panel
# timeout = 60                                        # seconds
#
# [[params]]
# id = "percent"
# label = "Percentage"
# type = "number"
# default = 100
# min = 1
# max = 500
#
# [[params]]
# id = "max_feed"
# label = "Maximum feed"
# type = "number"
# required = false
# ///
```

Fields: `name`, `description`, `profiles`, `input`, `output`, `timeout`, `envelope` (see [output modes](#output-modes)), `documents` (`active` \| `all-open` \| `pick`), `params`. A script without a header runs in v1 mode.

### Parameters
`P1 · M · Core`

Declared parameters produce a form before the script runs. The form engine is the same one used for [template parameters](code-assistant.md#parametric-templates):

- Types: `number`, `integer`, `text`, `bool`, `choice` (with `choices = [{label, value}]`), `file` (open dialog, returns a path), `folder`, `address-list` (checkboxes of address letters from the profile).
- Options: `label`, `help`, `default`, `required`, `min`, `max`, `decimals`.
- The last values are remembered per script (state file) and pre-filled next time.
- A script with no parameters runs immediately.

### Script context
`P1 · S · Core`

The script gets its context through the environment variable `GEDIT_CONTEXT`, which holds the path to a temporary JSON file (deleted after the run). stdin stays plain text, so v1 habits and simple scripts still work.

```json
{
  "contract": 2,
  "document": {
    "path": "/jobs/part42.nc", "name": "part42.nc", "profile": "fanuc-gcode",
    "encoding": "latin1", "lineEnding": "crlf", "modified": true
  },
  "input": { "scope": "selection", "startLine": 120, "endLine": 180 },
  "cursor": { "line": 130, "column": 5 },
  "params": { "percent": 90, "max_feed": null },
  "profile": { "id": "fanuc-gcode", "syntax": {}, "addresses": {}, "numbering": {} },
  "codes": [ { "code": "G84", "group": "cycle", "pitchFeed": true } ],
  "documents": [
    { "name": "part42_op2.nc", "path": "/jobs/part42_op2.nc", "profile": "fanuc-gcode", "textFile": "/tmp/gedit-run-1/doc-2.nc" }
  ]
}
```

- `profile` is the fully resolved profile (with `extends` already merged), so scripts can use comment syntax, addresses and numbering without hardcoding them ([dialect-profiles.md](dialect-profiles.md)).
- `codes` is the profile's code dictionary without templates ([code database](code-assistant.md#code-database-format)), so scripts can look up what a code means in this dialect instead of assuming Fanuc numbers.
- `documents` is filled only when the header asks for `all-open` or `pick`. Each document's text is in a temp file. It is used by the combined tool list and join programs.
- stdin/stdout are UTF-8. The app sets `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`, so Windows console code pages do not garble comments. Text is sent with LF line endings, and the document keeps its own line ending on save.

### Output modes
`P1 · M · Core`

| `output` | stdout means | What the app does |
|---|---|---|
| `replace` | New text for the input range | Applies it as one undo step, changing only the lines that differ |
| `new-document` | Text for a new document | Opens an untitled tab with the same profile |
| `report` | JSON report (below) | Shows a table and findings in the results panel. Rows with a line are clickable. |
| `panel` | Anything | v1 behavior: shows raw output and JSON |

With `envelope = true`, stdout is always JSON: `{"text": "...", "message": "...", "findings": [...]}`. This lets a script return new text and a summary or warnings together.

Report format:

```json
{
  "title": "Tool list",
  "message": "8 tools, 2 without description",
  "columns": [
    { "key": "tool", "label": "T" },
    { "key": "description", "label": "Description" },
    { "key": "line", "label": "Line" }
  ],
  "rows": [ { "tool": 1, "description": "FACE MILL D50", "line": 12 } ],
  "findings": [ { "line": 250, "severity": "warning", "message": "Feed move while spindle is stopped" } ]
}
```

A row or finding with `line` (and optionally `document`) jumps there on click. `severity` is `info`, `warning` or `error`. Findings can later also appear as editor markers. The report can be copied as CSV or opened as text in a new tab. The same results component serves [find all](editor-core.md#find-all-results-panel) and file search.

### Applying results safely
`P1 · S · Core`

- Exit code other than 0: nothing is applied, and stderr is shown.
- Empty stdout in `replace` mode is treated as an error. Otherwise a bug would delete the selection.
- If the document changed while the script ran (the version id differs), the result is not applied, and the user can re-run or open the result in a new tab.
- Replace results are applied with a line diff, so bookmarks and folding outside the changes survive, and one undo reverts the whole run.

### Runtime, timeout and cancel
`P1 · S · Core`

- Interpreter path is configurable (settings). The default is `python3`, or `python` on Windows. A virtual environment works by pointing to its interpreter. At startup, gEdit checks the version (3.9 or newer) and shows a clear message if Python is missing. Script features are then disabled, and the rest of the editor keeps working.
- Default timeout 60 s (per-script override in the header). A Cancel button in the panel kills the process.
- stdout is capped (for example 200 MB) to protect the UI.
- The backend runs scripts asynchronously (already the case) and keeps the child handle so it can cancel.

### Security
`P1 · S · Core`

Scripts are normal programs that run with the user's rights. gEdit cannot sandbox them. Rules:

- Only scripts from the bundled folder, the user scripts folder and folders the user added in settings are listed. Names are validated (already done in `resolve_script`).
- Scripts never run automatically (not on open, not on save). They only run on an explicit user action.
- Bundled scripts are read-only. To change one, copy it to the user folder, where it shadows the bundled script of the same file name.
- The user guide says plainly: only run scripts you trust.

## Script discovery and UI

### Script folders and menu
`P1 · S · Core`

- Sources: bundled scripts (app resources), the user scripts folder `<config>/scripts` (created on first start), and extra folders from settings (today's "Scripts Dir" becomes one of these).
- One level of subfolders becomes groups in the menu.
- The Tools ribbon shows the scripts with their header `name` and `description` as a tooltip. Scripts not meant for the active profile are hidden.
- Every script is also a command in the command palette. A keyboard shortcut per script is P3 ([settings-ui.md](settings-ui.md#keyboard-shortcuts)).
- A "New script" command creates a commented template in the user folder and opens it in a tab.

## Bundled script library

Standard-library Python only, so no pip install is needed. Shared code lives in `gedit_nc.py` next to the bundled scripts (context loading, profile-aware tokenizer, number formatting, modal interpreter). The app adds the bundled folder to `PYTHONPATH`, so user scripts can `import gedit_nc` too.

| Script | Phase | Output | Spec |
|---|---|---|---|
| Scale feed rates | P1 | replace | [link](nc-transformations.md#scale-feed-rates) |
| Scale spindle speeds | P1 | replace | [link](nc-transformations.md#scale-spindle-speeds) |
| Tool list | P1 | report | [link](nc-transformations.md#tool-list) |
| Address arithmetic | P2 | replace | [link](nc-transformations.md#arithmetic-on-address-values) |
| Insert / remove text by rule | P2 | replace | [link](nc-transformations.md#insert-text-by-rule) |
| Batch replace from mapping file | P2 | replace | [link](nc-transformations.md#batch-replace-from-a-mapping-file) |
| Character cleanup | P2 | replace | [link](nc-transformations.md#character-cleanup) |
| Split by tool / extract tool segment | P2 | new-document | [link](nc-transformations.md#split-program-by-tool) |
| Join programs | P2 | new-document | [link](nc-transformations.md#join-programs) |
| Combined tool list | P2 | report | [link](nc-transformations.md#combined-tool-list) |
| Extents | P2 | report | [link](nc-transformations.md#extents) |
| Program checks | P2 | report | [link](nc-transformations.md#program-checks) |
| Translate / rotate / mirror | P3 | replace | [link](nc-transformations.md#geometry-transforms) |
| Expand drilling cycles | P3 | replace | [link](nc-transformations.md#expand-drilling-cycles) |
| Statistics and time estimate | P3 | report | [link](nc-transformations.md#statistics-and-time-estimate) |

Each bundled script has tests: sample input, parameters and expected output, run in CI with a plain Python.

## External commands
`P2 · M · Core`

Runs any program (a checker, a converter, or a script in another language) on the current file from a menu entry. It is configured in settings as a list:

| Field | Meaning |
|---|---|
| `name` | Menu label |
| `program` | Executable path |
| `args` | Array of arguments with placeholders `{file}`, `{dir}`, `{name}`, `{stem}`, `{ext}`, `{output}` |
| `cwd` | Working directory (default `{dir}`) |
| `saveFirst` | Save the document before running (default on) |
| `output` | `{output}` path template, if the tool writes a separate file |
| `result` | `reload` (tool changed the file in place), `open-output` (open `{output}` in a new tab), `panel` (show stdout/stderr), `none` |
| `profiles` | Only show for these profiles (optional) |
| `timeout` | Seconds, with cancel as for scripts |

Arguments are passed as an array without a shell, so paths with spaces need no quoting and nothing is interpreted by a shell.

## Plugins

Kept minimal. There is no JavaScript plugin API for now, because it would be a large surface to design, secure and keep stable. The extension unit is a **script package**: a folder with scripts, and optionally profiles (`profiles/*.json`) and code databases (`codes/*.json`). It is installed by copying it into `<config>/packages/`. The app picks up its scripts, profiles and templates as if they were user files. Enabling or disabling a package is a setting (P3). This covers sharing a shop's setup (profiles + templates + scripts) as one folder or Git repository.

## Minimal example

```python
# /// gedit
# name = "Remove optional-stop lines"
# description = "Delete every line that contains M1 outside a comment."
# output = "replace"
# ///
import re, sys

text = sys.stdin.read()
# (?<![A-Z]) and (?!\d) instead of \b, so packed code like "G0M1" also matches
lines = [l for l in text.split("\n") if not re.search(r"(?<![A-Z])M0*1(?!\d)", l.split("(")[0], re.I)]
sys.stdout.write("\n".join(lines))
```
