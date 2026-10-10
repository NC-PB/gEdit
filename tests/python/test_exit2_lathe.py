"""The lathe program of the Phase 2 exit criteria (``tests/fixtures/exit2/checks-lathe.nc``) against
the golden of address arithmetic, without the app.

B1 intB (glue item 20, after fixnc NC-02): on the Fanuc lathe ``G69`` ends only the turret mirror
image; a ``G68.2`` tilted plane ends with ``G69.1``. The program used to close its ``G68.2`` with
``G69``, which now leaves the rest of the program inside the frame, so address arithmetic left ten
blocks as written and the runtime scenarios (exit2-x8) would have failed on the golden. This runs
the script on the same input, with the same parameters, and compares the saved text byte for byte
with the golden (``expected/`` and the text of ``expected-nopython/``, which is the input again
for the lines that matter here), so the runtime harness does not have to be the first to say so.
"""

from __future__ import annotations

import json
import unittest

from tests.python import helpers as H

EXIT2 = H.FIXTURES_DIR / "exit2"


class TestExit2LatheGolden(unittest.TestCase):
    def test_the_tilted_plane_ends_with_g69_1_and_the_arithmetic_golden_holds(self) -> None:
        profile = H.load_profile("fanuc-lathe")
        source = (EXIT2 / "checks-lathe.nc").read_bytes().decode("utf-8")
        report = json.loads((EXIT2 / "expected" / "checks-lathe.arith-z-0.5.none.report.json").read_text(encoding="utf-8"))
        lines = source.split("\n")
        if lines[-1] == "":
            lines.pop()
        context = H.make_context(params=report["params"], profile=profile, codes=H.load_codes(profile))
        context["document"]["name"] = "checks-lathe.nc"
        context["input"]["endLine"] = len(lines)
        out = H.run_script("address_arithmetic.py", stdin=source, context=context)
        self.assertEqual(out.returncode, 0, out.stderr)
        envelope = out.json()
        golden = (EXIT2 / "expected" / "checks-lathe.arith-z-0.5.none.nc").read_bytes().decode("utf-8")
        self.assertEqual(envelope["text"], golden)
        # The tilted plane is the one frame the report names, and it is closed by its own G69.1.
        frames = [row for row in envelope["findings"] if row.get("reason") == "frame"]
        self.assertEqual([row["line"] for row in frames], [36], frames)
        self.assertIn("G69.1", lines[36])

    def test_the_two_goldens_differ_only_in_what_the_script_changed(self) -> None:
        saved = (EXIT2 / "expected" / "checks-lathe.arith-z-0.5.none.nc").read_text(encoding="utf-8").split("\n")
        nopython = (EXIT2 / "expected-nopython" / "checks-lathe.arith-z-0.5.none.nc").read_text(encoding="utf-8").split("\n")
        self.assertEqual(saved[36], "G69.1")
        self.assertEqual(nopython[36], "G69.1")


if __name__ == "__main__":
    unittest.main()
