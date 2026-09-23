"""The owner's own programs, Python side (plan §9.2, D45, gate G11).

Written by the M6 prelude (P6); **FX owns it afterwards**. The TypeScript twin is
``tests/unit/realFixtures.test.ts`` and the two agree on the folder and on the two kinds
of skip, so one run can say which of them happened.

Standing rule 12 in three lines: no snapshot helper of any kind, no file name and no line
of a program in any message, and the folder itself is never printed — it is a path on the
owner's disk. A failure names the manifest index and a line number, and that is all.

The folder is ``GEDIT_REAL_FIXTURES``, else ``tests/real`` **of the main working tree**
(``git rev-parse --git-common-dir`` and up one). A gitignored folder does not exist inside
a linked worktree, so a plain relative path would report "no programs" while the programs
sit in the main checkout.
"""

from __future__ import annotations

import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

from tests.python import helpers

#: The environment variable that names a folder elsewhere.
ENV = "GEDIT_REAL_FIXTURES"


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


def summary(folder: Optional[Path], programs: Optional[List[Dict[str, Any]]]) -> str:
    """The one line the commit body records: counts only, never a path."""
    if folder is None:
        return "G11 skipped: no local folder found"
    source = "env" if os.environ.get(ENV, "").strip() else "worktree"
    if not programs:
        return "G11 skipped: no programs in the local folder (%s)" % source
    return "G11: %d local programs (%s)" % (len(programs), source)


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

    def test_every_program_the_manifest_names_is_there(self) -> None:
        if self.folder is None:
            self.skipTest("no local folder found")
        if not self.programs:
            self.skipTest("no programs in the local folder")
        # FX fills the checks in: detection, unknown words, the tool stations, `tool_list`
        # and a byte-exact round trip — each reported by manifest index only.
        for index, program in enumerate(self.programs):
            with self.subTest(entry=index):
                self.assertTrue((self.folder / program["file"]).is_file(), "manifest entry %d" % index)


if __name__ == "__main__":
    unittest.main()
