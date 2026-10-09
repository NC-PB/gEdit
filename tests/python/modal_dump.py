"""The Python half of the TS/Python modal parity check (Phase 3 plan, P3a prelude; P3.1).

Not a test module (``unittest discover`` only collects ``test*.py``): a small command that
walks the Python modal interpreter over the program of every modal golden and prints the
state after **every** line, in the goldens' notation (``render`` of ``test_modal.py``), as
one JSON document on stdout. ``tests/unit/modalParity.test.ts`` runs it and holds the
TypeScript interpreter (``core/nc/modal.ts``) to the same states, line by line.

Run from the repository root (``-S``: the standard library is all it needs, and a stray
``tests`` package in a site-packages folder cannot shadow this one)::

    python3 -S -m tests.python.modal_dump                  # every golden
    python3 -S -m tests.python.modal_dump modal/sinumerik/shaft.json

The output (``$format`` 1)::

    { "$format": 1,
      "goldens": { "modal/<profileId>/<case>.json": {
          "effective": "effective/<profileId>/<file>.json",   # under tests/fixtures/resolved
          "codes": "<dialect>",                               # resolved/codes/<dialect>.json
          "lines": <number of lines>,
          "states": [ <state after line 1>, <after line 2>, ... ] } } }

Each golden runs with the effective profile ``tests/fixtures/resolved/effective/index.json``
names for it. For a golden without a machine that is the profile's defaults, the same
context ``test_modal.TestGoldens`` uses; the TypeScript side reads the very same file, so a
difference between the two languages is never a difference between two merges.

**A context written by TypeScript (P3.1).** The owner-public programs (and G11's local ones)
have no golden: TypeScript detects their profile, applies the machine (or none) and writes
the effective profile, the database's entries and the program's lines into one JSON
document, which this command reads with ``--context <file>`` (``-`` for stdin)::

    { "$format": 1,
      "runs": [ { "name": "<anything>", "profile": {...}, "codes": [ <CodeEntry>... ],
                  "lines": [ "<line 1>", ... ], "digest": true } ] }

and answers ``{ "$format": 1, "runs": { "<name>": { "lines": n, "states": [...] } } }``, or,
for a run with ``"digest": true``, ``"digests"`` in place of ``"states"``: per line the first
16 hex digits of the MD5 of the rendered state as canonical JSON (keys sorted, no blanks,
ASCII only, :func:`canonical`), so 300k lines answer in a few megabytes and TypeScript
compares them with the digests of its own states (``tests/unit/helpers/modalParity.ts``).
Python never merges anything here either: the profile is the one TypeScript wrote.
"""

from __future__ import annotations

import hashlib
import json
import sys
from typing import Any, Dict, List, Sequence

from tests.python import helpers
from tests.python.test_modal import MODAL_DIR, golden_files, relative_to_fixtures, render

gedit_nc = helpers.import_gedit_nc()

#: The output format; bump it when a member changes meaning.
FORMAT = 1


def effective_entry(name: str) -> str:
    """The resolved file a golden runs with, relative to ``tests/fixtures/resolved``."""
    index = helpers.load_json(helpers.RESOLVED_DIR / "effective" / "index.json")
    entry = index.get(name)
    if not isinstance(entry, str):
        raise SystemExit("no effective profile for golden %s; %s" % (name, helpers.UPDATE_RESOLVED))
    return entry


def walk(profile: Dict[str, Any], codes: Sequence[Dict[str, Any]], lines: Sequence[str]) -> List[Dict[str, Any]]:
    """The rendered state after each line (``test_modal.ModalTestCase.walk``, then ``render``)."""
    cp = gedit_nc.compile_profile(profile)
    interp = gedit_nc.ModalInterpreter(cp, codes)
    state = None
    out: List[Dict[str, Any]] = []
    for number, line in enumerate(lines, 1):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
        out.append(render(interp.state))
    return out


def dump(names: Sequence[str]) -> Dict[str, Any]:
    goldens: Dict[str, Any] = {}
    for name in names:
        path = helpers.FIXTURES_DIR / name
        golden = helpers.load_json(path)
        leaf = effective_entry(name)
        entry = helpers.load_json(helpers.RESOLVED_DIR / leaf)
        codes = helpers.resolved_codes(entry["codes"])
        lines = helpers.read_lines((path.parent / golden["input"]).resolve())
        goldens[name] = {
            "effective": leaf,
            "codes": entry["codes"],
            "lines": len(lines),
            "states": walk(entry["profile"], codes, lines),
        }
    return {"$format": FORMAT, "goldens": goldens}


def canonical(view: Dict[str, Any]) -> str:
    """A rendered state as canonical JSON: sorted keys, no blanks, every non-ASCII escaped."""
    return json.dumps(view, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(view: Dict[str, Any]) -> str:
    """The first 16 hex digits of the MD5 of :func:`canonical` (a parity check, not a security one)."""
    return hashlib.md5(canonical(view).encode("ascii")).hexdigest()[:16]


def run_context(document: Dict[str, Any]) -> Dict[str, Any]:
    """Every run of a context document written by TypeScript (see the module's text)."""
    if document.get("$format") != FORMAT:
        raise SystemExit("unknown context format %r" % (document.get("$format"),))
    runs: Dict[str, Any] = {}
    for run in document.get("runs") or []:
        lines = run["lines"]
        states = walk(run["profile"], run["codes"], lines)
        out: Dict[str, Any] = {"lines": len(lines)}
        if run.get("digest") is True:
            out["digests"] = [digest(view) for view in states]
        else:
            out["states"] = states
        runs[run["name"]] = out
    return {"$format": FORMAT, "runs": runs}


def main(argv: Sequence[str]) -> int:
    if argv and argv[0] == "--context":
        if len(argv) != 2:
            raise SystemExit("usage: modal_dump --context <file | ->")
        if argv[1] == "-":
            document = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        else:
            with open(argv[1], "rb") as handle:
                document = json.loads(handle.read().decode("utf-8"))
        json.dump(run_context(document), sys.stdout, ensure_ascii=False, sort_keys=True)
        sys.stdout.write("\n")
        return 0
    names = list(argv) if argv else [relative_to_fixtures(path) for path in golden_files()]
    if not names:
        raise SystemExit("no modal goldens found under %s" % MODAL_DIR)
    json.dump(dump(names), sys.stdout, ensure_ascii=False, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
