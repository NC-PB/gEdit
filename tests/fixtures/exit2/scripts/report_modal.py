# /// gedit
# name = "Exit2 modal report"
# description = "Reports, line by line, whether X is a diameter and where that comes from."
# input = "document"
# output = "report"
# ///
"""Written for gEdit's Phase 2 exit criteria (X2). Not a bundled script.

Walks the document through ``gedit_nc.ModalInterpreter`` with the context the app hands a
script (the effective profile, database and machine of the document) and reports after
every line the diameter mode in the notation of ``tests/fixtures/modal/README.md``: ``on``
or ``off`` when the program set it, ``=on`` when it is assumed from the profile's default,
``=off@machine`` when the document's machine says so. ``x`` is what an X word on that line
is read as (``diameter`` or ``radius``), ``feedUnit`` the feed unit in force.
"""

import gedit_nc


def marked(value, record):
    if value is None or record is None:
        return ""
    if not record.get("assumed"):
        return value
    source = record.get("from")
    if isinstance(source, str) and source not in ("", "profile"):
        return "=%s@%s" % (value, source)
    return "=" + value


context = gedit_nc.load_context()
cp = gedit_nc.compile_profile(context.get("profile") or {})
interp = gedit_nc.ModalInterpreter(cp, context.get("codes") or [])
state = None
rows = []
for number, line in enumerate(gedit_nc.read_input(), 1):
    tokens, state = gedit_nc.tokenize_line(line, cp, state)
    interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
    diameter = interp.state["diameter"]
    rows.append(
        {
            "line": number,
            "diameter": marked(diameter["mode"], diameter) if diameter is not None else "",
            "x": interp.diameter_reading("X") or "",
            "feedUnit": interp.state["feedUnit"] or "",
        }
    )

gedit_nc.report(
    "Exit2 modal report",
    [
        {"key": "line", "label": "Line"},
        {"key": "diameter", "label": "Diameter programming"},
        {"key": "x", "label": "X is"},
        {"key": "feedUnit", "label": "Feed unit"},
    ],
    rows,
)
