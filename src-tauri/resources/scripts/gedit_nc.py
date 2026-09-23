"""Shared helpers for gEdit's bundled and user Python scripts (plan section 7.10).

Every public name below is the binding contract: a script written against it keeps
working. The API stub came from the M4 prelude (P4); **WP4.6** filled it in.

What it is for
--------------
A script receives its input on stdin (UTF-8, LF line endings) and everything else
through the JSON file named by the ``GEDIT_CONTEXT`` environment variable. gEdit puts
the bundled scripts folder on ``PYTHONPATH``, so a user script can ``import gedit_nc``
too.

The rules this module lives by:

* **Standard library only.** No pip install, ever. It must run on Python 3.9 as well as
  on the newest release, so no ``match``, no ``X | Y`` at runtime (the ``annotations``
  future import keeps the type hints legal), and no ``dataclasses`` features newer
  than 3.9.
* **Numbers are decimal strings, never floats.** ``10.`` and ``10`` are different
  positions on a Fanuc control, trailing zeros carry the programmer's intent, and the
  TypeScript side (``src/lib/core/nc``) has to reach the same digits. Arithmetic uses
  ``decimal.Decimal`` with ``ROUND_HALF_UP``, which in Python's ``decimal`` means
  **half away from zero** — the same rule the TypeScript side applies to the digits, so
  1111.05 rounds to 1111.1 and -1111.05 to -1111.1 on both sides.
* **The profile decides, not Fanuc.** Comment syntax, addresses, keywords and numbering
  all come out of the context's ``profile``. Nothing here hardcodes a dialect.
* **Patterns are shared.** ``profile`` patterns are written in the common subset of
  ECMAScript and Python ``re`` (plan AD-11); :func:`to_py_regex` bridges the one
  difference that is left, the named-group syntax.

Output
------
A script writes its result to stdout. Which shape depends on the ``output`` field of its
``# /// gedit`` header:

``replace`` / ``new-document``
    the new text, or, with ``envelope = true``, the JSON of :func:`envelope`
``report``
    the JSON of :func:`report`
``panel``
    anything at all

Anything a script wants to say to the developer goes to **stderr**; stdout is the result.

Mirroring the TypeScript core
-----------------------------
:func:`tokenize_line`, :func:`parse_number` and :func:`format_number` are ports of
``src/lib/core/nc/{tokenizer,numbers,numberFormat}.ts`` and are held to the same goldens
(``tests/fixtures/tokens/<profileId>.json``, ``tests/fixtures/numberformat.cases.json``).
Those fixtures are the contract between the two implementations: when one of them has to
change, the fixture changes with it and both sides are re-run. Do not "fix" a difference
on one side only.

One difference is unavoidable and harmless in practice: TypeScript counts UTF-16 code
units and Python counts code points, so ``Token.start`` / ``Token.end`` differ for a line
that holds a character outside the basic plane (an emoji in a comment). Within Python the
offsets are always consistent with the string they came from.

Selections and modal state
--------------------------
NC is a modal language: ``G95``, a ``G84`` tapping cycle or ``G96`` stays in force until
something cancels it. A run over a **selection** therefore starts in the middle of a
sentence, and a script that begins at the top-of-program state reads the fragment wrong —
it scales a thread pitch it cannot recognise, or a per-revolution feed as a per-minute one
(G8 M4 finding 6).

The context carries the cure: ``input.precedingLines``, the document lines above
``input.startLine``. :func:`preceding_lines` reads that field **and decides whether it may
be trusted**, and :func:`prime_tracker` walks it into a :class:`FeedModeTracker` and hands
back the :class:`LineState` the first selected line begins in. Two lines at the top of a
``run()`` and the selection is read in the state it is really written in.

The field is optional, and absent is a correct, supported context: a script must keep the
behaviour it had without it (say what it could not see) rather than assume the state.

How the module is laid out (M6)
-------------------------------
``gedit_nc`` is the **facade**: the context, the output helpers, and a re-export of every
public name. The implementation sits in three private modules next to it, split by what
they answer:

``_nc_lex``
    what a line *says* — the tokenizer, comment masking, block numbers, profile
    compilation and decimal-string numbers
``_nc_modal``
    what it *means* — :class:`FeedModeTracker`, and from M6 the ``ModalInterpreter`` of
    plan section 7.4
``_nc_machine``
    how one control *reads* it — the machine parameters and the number rules of plan
    section 7.15

Import ``gedit_nc`` and nothing else: the split is an implementation detail and the
private modules may move again. Every name below is exported from here, unchanged.

Machines (M6)
-------------
``X50`` is 50 mm on one control and 0.050 mm on the next, and which one it is depends on a
machine parameter, not on the dialect. :func:`machine_params` answers what the document's
machine decides and **where each value came from**; :func:`resolve_value` answers with a
value only where the reading is settled, and otherwise with the readings to report, so a
script says "the reading depends on the machine" instead of guessing. A context written
before M6 carries no machine, and :func:`machine_params` then describes the profile's own
documented defaults — which is exactly the behaviour such a script already had.

Beyond section 7.10
-------------------
:func:`mask_comments`, :func:`block_number_of`, :func:`normalize_code`,
:func:`number_format_of`, :func:`preceding_lines` and :func:`prime_tracker` are not in the
section 7.10 list. The first four are ports of code the TypeScript side has as well; the
last two are the M5 carry-over above. They are public, documented and covered by the
tests, but the contract that may not move is the section 7.10 one.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List, Optional, Sequence

# The implementation, re-exported unchanged (see "How the module is laid out"). The
# `noqa`-free plain imports are deliberate: a script that reads this file has to be able to
# see that `gedit_nc.tokenize_line` really is `_nc_lex.tokenize_line`.
from _nc_lex import (
    CompiledProfile,
    LineState,
    NumericLiteral,
    Token,
    block_number_of,
    compile_profile,
    format_number,
    mask_comments,
    normalize_code,
    number_format_of,
    parse_number,
    scale_decimal,
    to_py_regex,
    tokenize_line,
)
from _nc_machine import (
    WRITE_BACK_ERRORS,
    machine_params,
    number_class_of,
    readings_of,
    resolve_value,
    value_of,
    write_back,
)
from _nc_modal import (
    FeedModeTracker,
    ModalInterpreter,
    diameter_axes,
    incremental_axes,
    machine_type_of,
    prime_tracker,
    speed_limit_of,
)


__all__ = [
    "NumericLiteral",
    "Token",
    "LineState",
    "CompiledProfile",
    "FeedModeTracker",
    "ModalInterpreter",
    "load_context",
    "read_input",
    "to_py_regex",
    "compile_profile",
    "preceding_lines",
    "prime_tracker",
    "tokenize_line",
    "parse_number",
    "format_number",
    "scale_decimal",
    "report",
    "envelope",
    # Section 7.15, the machine (M6). A context without one answers the profile defaults.
    "machine_params",
    "number_class_of",
    "value_of",
    "write_back",
    "readings_of",
    "resolve_value",
    # Why `write_back` refused, by code. A script names the code instead of matching the
    # sentence, which is the same contract the TypeScript `WRITE_BACK_ERRORS` keeps.
    "WRITE_BACK_ERRORS",
    # Section 7.4 helpers over the effective profile (M6).
    "machine_type_of",
    "incremental_axes",
    "diameter_axes",
    "speed_limit_of",
    # Beyond section 7.10, see the module docstring.
    "mask_comments",
    "block_number_of",
    "normalize_code",
    "number_format_of",
    "CONTEXT_ENV",
    "CONTRACT",
]

#: The environment variable that names the context JSON file.
CONTEXT_ENV = "GEDIT_CONTEXT"

#: The contract version the app writes and this module understands.
CONTRACT = 2


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------


def load_context() -> Dict[str, Any]:
    """The ``ScriptContextV2`` dictionary (plan section 7.5), or ``{}``.

    Reads the JSON file named by ``GEDIT_CONTEXT``. An empty dictionary means the script
    was started the v1 way (no header, no context), which every bundled script has to
    survive: fall back to sensible defaults rather than raising. A context file that is
    there but unreadable is reported on stderr and treated the same way, because a script
    that dies on a broken context file says nothing useful to the person running it.
    """
    path = os.environ.get(CONTEXT_ENV)
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as err:
        print("gedit_nc: cannot read %s (%s)" % (CONTEXT_ENV, err), file=sys.stderr)
        return {}
    return data if isinstance(data, dict) else {}


def read_input() -> List[str]:
    """stdin as a list of lines, split on ``"\\n"``, without the line endings.

    The text arrives LF-joined whatever the document's own line ending is; the app puts
    it back on save. A trailing newline therefore shows up as a final empty element, and
    it has to be preserved on the way out, or every run would eat the last line break.
    """
    stream = getattr(sys.stdin, "buffer", None)
    raw = stream.read() if stream is not None else sys.stdin.read().encode("utf-8")
    return raw.decode("utf-8").split("\n")


def preceding_lines(context: Dict[str, Any]) -> List[str]:
    """The document lines **above** ``input.startLine``, or ``[]`` when they cannot be used.

    ``ScriptContextV2.input.precedingLines`` (plan section 7.5) is optional, and an empty
    answer here means "run as if it were not there" — which is exactly the behaviour every
    bundled script had before M5. Feed the answer to :func:`prime_tracker`.

    It is used only when **all** of these hold, and ignored in one piece otherwise:

    * ``input.scope`` is ``"selection"``. A whole-document run already starts at the top of
      the program, and a ``none`` run has no lines to be above.
    * the field is a list and every element is a string.
    * ``len(precedingLines) == input.startLine - 1``, so the lines really are *all* the
      lines above the first editable one.

    That last rule is the one that matters. The contract tells the runner to **omit** the
    field rather than truncate it when the text above the selection is too large to send,
    because a tracker primed with half the program is a confident wrong answer, while an
    absent field keeps the loud "this run could not see above the selection" warning. The
    length check enforces that rule on this side as well, so a runner that truncates anyway
    — or a hand-written context, or a v1-shaped one — degrades to the honest warning
    instead of to a silent mis-scale.
    """
    scope = context.get("input")
    if not isinstance(scope, dict) or scope.get("scope") != "selection":
        return []
    lines = scope.get("precedingLines")
    if not isinstance(lines, list) or not lines:
        return []
    if not all(isinstance(line, str) for line in lines):
        return []
    start = scope.get("startLine")
    if not isinstance(start, int) or isinstance(start, bool) or len(lines) != start - 1:
        return []
    return list(lines)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def _write_json(payload: Dict[str, Any]) -> None:
    """The result, on stdout, as compact UTF-8 JSON."""
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.stdout.flush()


def report(
    title: str,
    columns: Sequence[Dict[str, str]],
    rows: Sequence[Dict[str, Any]],
    message: Optional[str] = None,
    findings: Optional[Sequence[Dict[str, Any]]] = None,
) -> None:
    """Writes a ``report`` result to stdout (``output = "report"``).

    ``columns`` are ``{"key": ..., "label": ...}`` in display order, ``rows`` are
    dictionaries keyed by those ``key`` values. A row or finding that carries ``line``
    (and optionally ``document``) is clickable in the results panel. ``findings`` are
    ``{"line": int, "message": str, "severity": "info" | "warning" | "error"}``.
    """
    payload: Dict[str, Any] = {
        "title": title,
        "columns": [dict(column) for column in columns],
        "rows": [dict(row) for row in rows],
    }
    if message is not None:
        payload["message"] = message
    if findings is not None:
        payload["findings"] = [dict(finding) for finding in findings]
    _write_json(payload)


def envelope(
    text: str,
    message: Optional[str] = None,
    findings: Optional[Sequence[Dict[str, Any]]] = None,
) -> None:
    """Writes an ``envelope`` result to stdout (``envelope = true`` in the header).

    ``{"text": ..., "message": ..., "findings": [...]}``, so a script can hand back new
    text together with a summary and warnings. ``text`` is used exactly as given: it
    keeps the trailing newline of the input when the input had one.
    """
    payload: Dict[str, Any] = {"text": text}
    if message is not None:
        payload["message"] = message
    if findings is not None:
        payload["findings"] = [dict(finding) for finding in findings]
    _write_json(payload)
