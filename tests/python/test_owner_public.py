"""Exit criterion X13 on the committed owner-public programs, the Python half (plan §2.2,
§6 M9 WP9.6). The TypeScript half is ``tests/unit/ownerPublic.test.ts``.

The only real programs in the repository are the ones the owner published
(``tests/fixtures/nc/owner-public/<profile>/``). This half proves what only Python can:

* the Python tokenizer finds exactly the unknown tokens
  ``tests/fixtures/expected/owner-public/known-gaps.json`` lists, as the TypeScript one
  does — the file is the shared golden;
* scale feed and scale speed at 100 % give back every byte of every program;
* ``tool_list`` gives one row per station of the program map, with the line of its first
  call and the number of tool segments — the map as its outline golden records it.

Each program is read with its folder's profile and the profile's defaults (the resolved
``effective/<profile>/defaults.json``): no machine, and no variant detected away from its
default, which the TypeScript half checks. The scripts run in subprocesses the way the app
starts them, several at a time: the largest program has 99,000 lines and each script takes
half a minute on it.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers

ROOT = helpers.FIXTURES_DIR / "nc" / "owner-public"
GAPS_FILE = helpers.FIXTURES_DIR / "expected" / "owner-public" / "known-gaps.json"
OUTLINE = helpers.FIXTURES_DIR / "expected" / "outline"

#: How many scripts run at once. Each is its own process, so they really run in parallel.
WORKERS = max(1, min(4, os.cpu_count() or 1))

#: How long one script may take on one program here (``helpers.run_script`` allows 60 s).
SCRIPT_TIMEOUT_SECONDS = 600


def decode(raw: bytes) -> str:
    """A program as the app hands it to a script: UTF-8 (a byte-order mark dropped), else
    Windows-1252, with LF line endings. The TypeScript half checks that every owner-public
    program is one of the two, without NUL bytes."""
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def programs() -> List[Tuple[str, Path]]:
    """``(rel, path)`` of every owner-public program, ``rel`` as the golden files key it."""
    out = []
    for path in sorted(ROOT.rglob("*")):
        if path.is_file():
            out.append((path.relative_to(helpers.FIXTURES_DIR).as_posix(), path))
    return out


def profile_of(rel: str) -> str:
    """The folder a program is in, which is the profile it opens with."""
    return rel.split("/")[2]


def unknown_tokens(text: str, profile_id: str) -> List[Dict[str, Any]]:
    """The unknown tokens grouped by text, in order of first appearance."""
    gedit_nc = helpers.import_gedit_nc()
    cp = gedit_nc.compile_profile(helpers.effective_context(profile_id)["profile"])
    found: Dict[str, Dict[str, Any]] = {}
    state = None
    for number, line in enumerate(text.split("\n"), start=1):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        for token in tokens:
            if token.kind != "unknown":
                continue
            entry = found.get(token.text)
            if entry is None:
                found[token.text] = {"text": token.text, "count": 1, "firstLine": number}
            else:
                entry["count"] += 1
    return list(found.values())


def station(written: str) -> str:
    """A station the way two readers write it the same (as ``realPrograms.ts`` does): no
    ``T``, no quotes or ``=``, no leading zeros, upper case."""
    bare = written.strip()
    if len(bare) > 1 and bare[0] in "Tt" and (bare[1].isdigit() or bare[1] in '"='):
        bare = bare[1:]
    if bare.startswith("="):
        bare = bare[1:]
    if len(bare) >= 2 and bare[0] == '"' and bare[-1] == '"':
        bare = bare[1:-1]
    if bare.isdigit():
        bare = bare.lstrip("0") or "0"
    return bare.upper()


def rows_of_map(tools: List[Tuple[int, str]]) -> List[Dict[str, Any]]:
    """One row per station in order of first use: its first line and how many segments."""
    rows: Dict[str, Dict[str, Any]] = {}
    for line, tool in tools:
        key = station(tool)
        if key in rows:
            rows[key]["calls"] += 1
        else:
            rows[key] = {"station": key, "line": line, "calls": 1}
    return list(rows.values())


def golden_tools(rel: str) -> Optional[List[Tuple[int, str]]]:
    """The tool changes of a program's outline golden, or ``None`` when it has none."""
    path = OUTLINE / (rel[len("nc/"):] + ".json")
    if not path.is_file():
        return None
    items = helpers.load_json(path)["items"]
    out: List[Tuple[int, str]] = []
    for item in items:
        for entry in [item] + list(item.get("children") or []):
            if entry.get("kind") == "tool":
                out.append((entry["line"], entry.get("tool", "")))
    return out


def run(script: str, text: str, profile_id: str, params: Dict[str, Any]) -> helpers.RunOutput:
    """One bundled script over the whole program, as the app runs it."""
    context = helpers.effective_context(profile_id, params=params)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    return helpers.run_script(script, stdin=text, context=context)


class TestOwnerPublicPrograms(unittest.TestCase):
    """X13: the Python tokenizer, the two scaling scripts and the tool list."""

    texts: Dict[str, str] = {}
    results: Dict[Tuple[str, str], helpers.RunOutput] = {}

    @classmethod
    def setUpClass(cls) -> None:
        cls.texts = {rel: decode(path.read_bytes()) for rel, path in programs()}
        jobs = []
        for rel, text in cls.texts.items():
            jobs.append((rel, "scale_feed.py", {"percent": 100}))
            jobs.append((rel, "scale_speed.py", {"percent": 100}))
            jobs.append((rel, "tool_list.py", {}))
        # The longest programs first, so the pool does not end on one of them alone.
        jobs.sort(key=lambda job: -len(cls.texts[job[0]]))
        # `run_script` treats a run of more than a minute as hung, which is right for a
        # golden case of twenty lines and wrong for 99,000 lines on a loaded machine.
        saved = helpers.RUN_TIMEOUT_SECONDS
        helpers.RUN_TIMEOUT_SECONDS = SCRIPT_TIMEOUT_SECONDS
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
                futures = {
                    pool.submit(run, script, cls.texts[rel], profile_of(rel), params): (rel, script)
                    for rel, script, params in jobs
                }
                cls.results = {futures[future]: future.result() for future in concurrent.futures.as_completed(futures)}
        finally:
            helpers.RUN_TIMEOUT_SECONDS = saved

    def test_there_are_the_twenty_published_programs(self) -> None:
        self.assertEqual(len(self.texts), 20)
        for rel, text in self.texts.items():
            self.assertNotIn("\x00", text, rel)

    def test_the_python_tokenizer_finds_exactly_the_listed_unknown_tokens(self) -> None:
        known = helpers.load_json(GAPS_FILE)["files"]
        for rel, text in self.texts.items():
            with self.subTest(program=rel):
                listed = [
                    {"text": entry["text"], "count": entry["count"], "firstLine": entry["firstLine"]}
                    for entry in (known.get(rel) or {}).get("unknown", [])
                ]
                self.assertEqual(unknown_tokens(text, profile_of(rel)), listed)

    def test_scale_feed_and_scale_speed_at_100_per_cent_give_back_every_byte(self) -> None:
        for rel, text in self.texts.items():
            for script in ("scale_feed.py", "scale_speed.py"):
                with self.subTest(program=rel, script=script):
                    result = self.results[(rel, script)]
                    self.assertTrue(result.ok, result.stderr[-2000:])
                    self.assertEqual(result.json()["text"], text)

    def test_the_tool_list_gives_one_row_per_station_of_the_map(self) -> None:
        known = helpers.load_json(GAPS_FILE)["files"]
        checked = 0
        for rel, text in self.texts.items():
            with self.subTest(program=rel):
                result = self.results[(rel, "tool_list.py")]
                self.assertTrue(result.ok, result.stderr[-2000:])
                tools = golden_tools(rel)
                if tools is None:
                    # A map gap has no golden; the map the program means is not there yet.
                    self.assertIsNotNone((known.get(rel) or {}).get("map"), "%s has no outline golden" % rel)
                    continue
                rows = [
                    {"station": station(str(row.get("tool", ""))), "line": row.get("line"), "calls": row.get("calls")}
                    for row in result.json().get("rows", [])
                ]
                self.assertEqual(rows, rows_of_map(tools))
                checked += 1
        self.assertGreaterEqual(checked, 17)

    def test_the_station_spellings_compare_alike(self) -> None:
        self.assertEqual(station("T01"), "1")
        self.assertEqual(station("01"), "1")
        self.assertEqual(station('T="DRILL_D8"'), "DRILL_D8")
        self.assertEqual(station("T=5"), "5")
        self.assertEqual(station("T0"), "0")
        self.assertEqual(rows_of_map([(5, "1"), (20, "2"), (40, "01")]), [
            {"station": "1", "line": 5, "calls": 2},
            {"station": "2", "line": 20, "calls": 1},
        ])


if __name__ == "__main__":
    unittest.main()
