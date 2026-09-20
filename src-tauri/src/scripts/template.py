#!/usr/bin/env python3
# /// gedit
# name = "{{name}}"
# description = "What this script does, shown as the tooltip."
#
# # Which profiles offer it. Remove the line to offer it for every profile.
# # profiles = ["fanuc-gcode", "heidenhain-klartext"]
#
# # Where stdin comes from: document | selection | selection-or-document | none
# input = "selection-or-document"
#
# # What stdout means: panel | replace | new-document | report
# #   panel        anything; shown as raw output
# #   replace      the new text for the input range, applied as one undo step
# #   new-document the text for a new untitled tab
# #   report       a JSON report for the results panel
# output = "panel"
#
# # Seconds. Remove the line to use the timeout from the settings.
# # timeout = 60
#
# # A form is shown before the script runs, and the values arrive in
# # context["params"]. Types: number, integer, text, bool, choice, file,
# # folder, address-list.
# # [[params]]
# # id = "percent"
# # label = "Percentage"
# # type = "number"
# # default = 100
# # min = 1
# # max = 500
# ///
"""A gEdit script.

Standard library only, and it has to run on Python 3.9 as well as on the newest
release. There is no pip install step, by design.

The text to work on arrives on stdin as UTF-8 with LF line endings; the document
keeps its own encoding and line ending when it is saved. Everything else - the
document's metadata, the input range, the cursor, the parameter values, the
resolved profile and the code database - is in the JSON file named by the
GEDIT_CONTEXT environment variable. Write the result to stdout and anything else
to stderr.

Two rules that matter more than any feature:

1. Work on tokens, never on a regex over raw lines. `gedit_nc.tokenize_line`
   knows what is a comment, a string, a variable and an expression in *this*
   dialect. A naive `re.sub` rewrites the `G1` inside `(FINISH G1 PASS)` and
   corrupts the program.
2. Never widen or narrow a number by accident. Use `scale_decimal` and
   `format_number`; they keep `10.` from becoming `10` and round the same way
   the editor's own transforms do.
"""

from __future__ import annotations

import sys

import gedit_nc


def main() -> int:
    context = gedit_nc.load_context()
    lines = gedit_nc.read_input()

    # Your work goes here. `context["params"]` holds the form values,
    # `context["profile"]` the resolved dialect and `context["codes"]` what each
    # code means in it.
    params = context.get("params", {})
    print("{} line(s), {} parameter(s)".format(len(lines), len(params)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
