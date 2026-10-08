"""The owner's own programs, Python side (plan §9.2, D45, gate G11).

Written by the M6 prelude (P6) as a stub; **FX owns it**, and M9 (WP9.6) made it the
Python half of the real G11 run. The TypeScript half is ``tests/unit/realFixtures.test.ts``,
which runs every check of ``tests/real/README.md`` — the bundled scripts included, started
the way the app starts them, under the machine the manifest names. This half proves the one
thing only Python can: that **the Python tokenizer** reads the owner's programs the way the
TypeScript one does, so the ``unknownTokens`` check is run here a second time with the same
manifest, the same allow-list and the same known gaps, and printed in the same form. (A
machine changes no token: an overlay may not touch ``syntax``, so the resolved profile is
the one to tokenize with.) The two agree on the folder and on the two kinds of skip, so one
run can say which of them happened.

Standing rule 12 in three lines: no snapshot helper of any kind, no file name and no line
of a program in any message, and the folder itself is never printed — it is a path on the
owner's disk. A failure names the manifest index and a line number, and that is all.

The folder is ``GEDIT_REAL_FIXTURES``, else ``tests/real`` **of the main working tree**
(``git rev-parse --git-common-dir`` and up one). A gitignored folder does not exist inside
a linked worktree, so a plain relative path would report "no programs" while the programs
sit in the main checkout.

By default the run fails only on a crash; with ``GEDIT_G11=strict`` every failure and
every known gap that passes now fails it too, as in the TypeScript half.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

from tests.python import helpers

#: The environment variable that names a folder elsewhere.
ENV = "GEDIT_REAL_FIXTURES"

#: The check this half runs, by its name in ``tests/real/README.md``.
CHECK = "unknownTokens"


def _worktree_folder() -> Optional[Path]:
    """``tests/real`` of the main working tree, even from inside a linked worktree."""
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=str(helpers.REPO_ROOT),
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not common:
        return None
    root = Path(common)
    if not root.is_absolute():
        root = (helpers.REPO_ROOT / root).resolve()
    return root.parent / "tests" / "real"


def real_folder() -> Optional[Path]:
    """The folder with the owner's programs, or ``None`` when there is none."""
    named = os.environ.get(ENV, "").strip()
    if named:
        path = Path(named).expanduser()
        return path if path.is_dir() else None
    fallback = _worktree_folder()
    return fallback if fallback is not None and fallback.is_dir() else None


def read_manifest(folder: Path) -> Optional[List[Dict[str, Any]]]:
    """The manifest entries, or ``None`` when the folder has no manifest ("no programs")."""
    path = folder / "manifest.json"
    if not path.is_file():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    programs = raw.get("programs") if isinstance(raw, dict) else None
    if not isinstance(programs, list):
        return []
    return [
        entry
        for entry in programs
        if isinstance(entry, dict) and isinstance(entry.get("file"), str) and isinstance(entry.get("profile"), str)
    ]


def source_name() -> str:
    """Which of the two folders, as the report names it — never its path."""
    return "GEDIT_REAL_FIXTURES" if os.environ.get(ENV, "").strip() else "main working tree"


def summary(folder: Optional[Path], programs: Optional[List[Dict[str, Any]]]) -> str:
    """The one line the commit body records: counts only, never a path."""
    if folder is None:
        return "G11 skipped: no local folder found"
    if not programs:
        return "G11 skipped: no programs in the local folder (%s)" % source_name()
    return "G11: %d local programs (%s)" % (len(programs), source_name())


# ---------------------------------------------------------------------------
# The check
# ---------------------------------------------------------------------------


def decode(raw: bytes) -> str:
    """A file as the app opens it, for the tokenizer: the NUL leader and trailer of a tape
    dropped, a byte-order mark read, UTF-8 else Windows-1252, LF line endings."""
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        text = raw.decode("utf-16")
    else:
        raw = raw.strip(b"\x00")
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("cp1252", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


def allowed(token: str, entries: Any) -> bool:
    """Whether ``token`` is on the allow-list: an entry's text with case ignored, or a
    ``/…/`` pattern over the token's text, read like a profile pattern."""
    gedit_nc = helpers.import_gedit_nc()
    for entry in entries if isinstance(entries, list) else []:
        text = entry.get("text") if isinstance(entry, dict) else entry
        if not isinstance(text, str) or text == "":
            continue
        if len(text) > 2 and text.startswith("/") and text.endswith("/"):
            try:
                if re.search(gedit_nc.to_py_regex(text[1:-1]), token, re.IGNORECASE):
                    return True
            except re.error:
                pass
            continue
        if text.lower() == token.lower():
            return True
    return False


def first_unknown(text: str, profile_id: str, allow: Any) -> int:
    """The line of the first unknown token not on the allow-list, ``0`` when there is none."""
    gedit_nc = helpers.import_gedit_nc()
    cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
    state = None
    for number, line in enumerate(text.split("\n"), start=1):
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        for token in tokens:
            if token.kind == "unknown" and not allowed(token.text, allow):
                return number
    return 0


def run_check(folder: Path, programs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The ``unknownTokens`` and ``noCrash`` counts over the manifest, with its known gaps."""
    counts = {CHECK: {"pass": 0, "fail": 0, "known": 0, "skipped": 0}, "noCrash": {"pass": 0, "fail": 0, "known": 0, "skipped": 0}}
    failures: List[Dict[str, int]] = []
    no_longer: List[Dict[str, Any]] = []
    for index, program in enumerate(programs):
        gaps = program.get("knownGaps") if isinstance(program.get("knownGaps"), dict) else {}
        gap = isinstance(gaps.get(CHECK), str)
        try:
            text = decode((folder / program["file"]).read_bytes())
            line = first_unknown(text, program["profile"], program.get("allowUnknown"))
        except Exception:  # noqa: BLE001 - any failure of a real program is a finding
            counts[CHECK]["skipped"] += 1
            counts["noCrash"]["fail"] += 1
            failures.append({"check": "noCrash", "index": index})
            continue
        counts["noCrash"]["pass"] += 1
        if line == 0:
            counts[CHECK]["pass"] += 1
            if gap:
                no_longer.append({"check": CHECK, "index": index})
        elif gap:
            counts[CHECK]["known"] += 1
        else:
            counts[CHECK]["fail"] += 1
            failures.append({"check": CHECK, "index": index, "line": line})
    return {"programs": len(programs), "checks": counts, "failures": failures, "noLongerGaps": no_longer}


def format_report(report: Dict[str, Any], source: str) -> List[str]:
    """The printed form, in the TypeScript half's format with ``(Python)`` in front."""
    lines = ["G11 (Python) source: %s; %d programs" % (source, report["programs"])]
    for check in (CHECK, "noCrash"):
        c = report["checks"][check]
        line = "G11 (Python) %-14s%3d pass %3d fail" % (check, c["pass"], c["fail"])
        if check != "noCrash":
            line += " %3d known" % c["known"]
        if c["skipped"]:
            line += " %3d skipped" % c["skipped"]
        lines.append(line)
    parts = []
    for check in (CHECK, "noCrash"):
        where = [
            "#%d%s" % (f["index"], ":%d" % f["line"] if "line" in f else "")
            for f in report["failures"]
            if f["check"] == check
        ]
        if where:
            parts.append("%s %s" % (check, " ".join(where)))
    lines.append("G11 (Python) failures: %s" % ("; ".join(parts) if parts else "(none)"))
    gone = ["%s #%d" % (g["check"], g["index"]) for g in report["noLongerGaps"]]
    lines.append("G11 (Python) no longer a gap: %s" % ("; ".join(gone) if gone else "(none)"))
    return lines


class TestLocalPrograms(unittest.TestCase):
    """Runs only on the owner's machine; everywhere else it skips, and says which skip."""

    def setUp(self) -> None:
        self.folder = real_folder()
        self.programs = read_manifest(self.folder) if self.folder is not None else None

    def test_the_summary_says_which_skip_it_is_and_never_where_it_looked(self) -> None:
        line = summary(self.folder, self.programs)
        self.assertTrue(line.startswith("G11"))
        if self.folder is not None:
            self.assertNotIn(str(self.folder), line)

    def test_the_python_tokenizer_reads_every_program_the_manifest_names(self) -> None:
        if self.folder is None:
            self.skipTest("no local folder found")
        if not self.programs:
            self.skipTest("no programs in the local folder")
        report = run_check(self.folder, self.programs)
        lines = format_report(report, source_name())
        for line in lines:
            self.assertNotIn(str(self.folder), line)
        print("\n" + "\n".join(lines))
        self.assertEqual(report["checks"]["noCrash"]["fail"], 0, "the tokenizer crashed on a local program")
        if os.environ.get("GEDIT_G11") == "strict":
            self.assertEqual(report["failures"], [])
            self.assertEqual(report["noLongerGaps"], [])


class TestOnASyntheticManifest(unittest.TestCase):
    """The same logic in a temporary folder, so it runs in CI with no real program."""

    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="gedit-g11-py-"))
        self.addCleanup(shutil.rmtree, str(self.dir), True)
        shutil.copyfile(str(helpers.FIXTURES_DIR / "nc" / "fanuc" / "f01-mill-3tools.nc"), str(self.dir / "mill.nc"))
        (self.dir / "unknown.nc").write_bytes(b"%\r\nO1000 (WRITTEN FOR GEDIT)\r\nG0 X0 Y0\r\n?\r\nM30\r\n%\r\n")
        # The first line has no unit, so the name is no program name (`syntax.freeText`, M12.5)
        # and stays the one unknown token the manifest has to allow.
        (self.dir / "klartext.h").write_bytes(
            "0 BEGIN PGM 2.5D_PART\n1 L Z+100 R0 FMAX\n2 END PGM 2.5D_PART MM\n".encode("utf-8")
        )
        self.programs = [
            {"file": "mill.nc", "profile": "fanuc-gcode"},
            {"file": "unknown.nc", "profile": "fanuc-gcode"},
            {"file": "unknown.nc", "profile": "fanuc-gcode", "allowUnknown": [{"text": "?", "why": "a test character"}]},
            {"file": "unknown.nc", "profile": "fanuc-gcode", "knownGaps": {CHECK: "a character the post writes"}},
            {"file": "mill.nc", "profile": "fanuc-gcode", "knownGaps": {CHECK: "not any more"}},
            {"file": "missing.nc", "profile": "fanuc-gcode"},
            {"file": "klartext.h", "profile": "heidenhain-klartext", "allowUnknown": ["/^\\d[\\w.]*_PART$/"]},
            {"file": "klartext.h", "profile": "heidenhain-klartext"},
        ]

    def test_it_counts_passes_failures_known_gaps_and_crashes(self) -> None:
        report = run_check(self.dir, self.programs)
        self.assertEqual(report["checks"][CHECK], {"pass": 4, "fail": 2, "known": 1, "skipped": 1})
        self.assertEqual(report["checks"]["noCrash"], {"pass": 7, "fail": 1, "known": 0, "skipped": 0})
        self.assertEqual(
            report["failures"],
            [{"check": CHECK, "index": 1, "line": 4}, {"check": "noCrash", "index": 5}, {"check": CHECK, "index": 7, "line": 1}],
        )
        self.assertEqual(report["noLongerGaps"], [{"check": CHECK, "index": 4}])

    def test_it_prints_counts_and_indexes_only(self) -> None:
        lines = format_report(run_check(self.dir, self.programs), "GEDIT_REAL_FIXTURES")
        self.assertEqual(lines[0], "G11 (Python) source: GEDIT_REAL_FIXTURES; 8 programs")
        self.assertEqual(lines[1], "G11 (Python) unknownTokens   4 pass   2 fail   1 known   1 skipped")
        self.assertEqual(lines[2], "G11 (Python) noCrash         7 pass   1 fail")
        self.assertEqual(lines[3], "G11 (Python) failures: unknownTokens #1:4 #7:1; noCrash #5")
        self.assertEqual(lines[4], "G11 (Python) no longer a gap: unknownTokens #4")
        text = "\n".join(lines)
        for name in ("mill.nc", "unknown.nc", "missing.nc", "klartext.h", "2.5D_PART", str(self.dir)):
            self.assertNotIn(name, text)

    def test_the_allow_list_reads_texts_without_case_and_patterns(self) -> None:
        self.assertTrue(allowed("init.", ["INIT."]))
        self.assertTrue(allowed("SPANBRECHEN.", [{"text": "spanbrechen.", "why": "dialog text"}]))
        self.assertTrue(allowed("REF.PKT", ["/^[A-Z]+\\.[A-Z]+$/"]))
        self.assertFalse(allowed("REF", ["/^[A-Z]+\\.[A-Z]+$/"]))
        self.assertFalse(allowed("X", ["/(/"]))
        self.assertFalse(allowed("X", None))

    def test_it_decodes_like_the_app(self) -> None:
        self.assertEqual(decode(b"\x00\x00G0 X1\r\nM30\r\n\x00"), "G0 X1\nM30\n")
        self.assertEqual(decode(b"\xef\xbb\xbfG0\n"), "G0\n")
        self.assertEqual(decode("(Ø)\n".encode("cp1252")), "(Ø)\n")
        self.assertEqual(decode("G0\r\n".encode("utf-16")), "G0\n")


if __name__ == "__main__":
    unittest.main()
