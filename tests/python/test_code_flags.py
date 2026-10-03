"""How the M9 code-database flags read in Python (plan §7.2, §7.16; P9).

The twin of ``src/lib/core/codes/flagsContract.test.ts``: the same entries, the same
answers. What is pinned is how a flag reads, not which entry carries it; the content work
packages set the flags, and WP9.2's flagged-entry golden lists them.

* ``axis_words_of``: ``wordsAreData`` makes every word of a block data, its axis words
  included; ``axisWords`` says the same of the axis words alone (``'data'``), or that they
  are a position outside the program's frame (``'machine'``).
* ``frame_of``: a code that opens or closes a coordinate frame.
* ``speed_limit_bound_of``: a speed limit without a bound is the upper one, the clamp it
  always was; Sinumerik ``G25`` is a lower one.
"""

from __future__ import annotations

import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()


class AxisWordsTest(unittest.TestCase):
    def test_words_are_data_covers_the_axis_words(self) -> None:
        cases = [
            ({"code": "G10", "wordsAreData": True}, "data"),
            ({"code": "G65", "wordsAreData": True, "axisWords": "data"}, "data"),
            ({"code": "G92", "axisWords": "data"}, "data"),
            ({"code": "G53", "axisWords": "machine"}, "machine"),
            ({"code": "G1"}, None),
            ({"code": "G0", "axisWords": "shift"}, None),
            (None, None),
        ]
        for entry, want in cases:
            with self.subTest(entry=entry):
                self.assertEqual(gedit_nc.axis_words_of(entry), want)


class FrameTest(unittest.TestCase):
    def test_open_close_or_nothing(self) -> None:
        cases = [
            ({"code": "G68.2", "frame": "open"}, "open"),
            ({"code": "G69", "frame": "close"}, "close"),
            ({"code": "G1"}, None),
            ({"code": "G1", "frame": True}, None),
            (None, None),
        ]
        for entry, want in cases:
            with self.subTest(entry=entry):
                self.assertEqual(gedit_nc.frame_of(entry), want)


class SpeedLimitBoundTest(unittest.TestCase):
    def test_a_limit_without_a_bound_is_the_upper_one(self) -> None:
        cases = [
            ({"code": "G50", "sets": {"speedLimit": True}}, "upper"),
            ({"code": "G26", "sets": {"speedLimit": True, "speedLimitBound": "upper"}}, "upper"),
            ({"code": "G25", "sets": {"speedLimit": True, "speedLimitBound": "lower"}}, "lower"),
            ({"code": "G97", "sets": {"speedUnit": "rpm"}}, None),
            ({"code": "G25", "sets": {"speedLimitBound": "lower"}}, None),
            (None, None),
        ]
        for entry, want in cases:
            with self.subTest(entry=entry):
                self.assertEqual(gedit_nc.speed_limit_bound_of(entry), want)


class MoreReadingTest(unittest.TestCase):
    """The twins of ``WP9.2: more of how a flag reads`` in ``flagsContract.test.ts``."""

    def test_false_and_a_value_in_the_wrong_case_are_no_flag(self) -> None:
        self.assertIsNone(gedit_nc.axis_words_of({"code": "G1", "wordsAreData": False}))
        self.assertIsNone(gedit_nc.axis_words_of({"code": "G1", "axisWords": "DATA"}))
        self.assertIsNone(gedit_nc.frame_of({"code": "G1", "frame": "OPEN"}))

    def test_no_pair_of_flags_hides_the_other(self) -> None:
        opening_data = {"code": "X1", "wordsAreData": True, "frame": "open"}
        machine_limit = {"code": "X2", "axisWords": "machine", "sets": {"speedLimit": True, "speedLimitBound": "lower"}}
        self.assertEqual(
            [
                (gedit_nc.axis_words_of(e), gedit_nc.frame_of(e), gedit_nc.speed_limit_bound_of(e))
                for e in (opening_data, machine_limit)
            ],
            [("data", "open", None), ("machine", None, "lower")],
        )


class FlaggedEntriesGoldenTest(unittest.TestCase):
    """``tests/fixtures/codes/flags.json``: every flagged entry of the shipped databases.

    ``src/lib/data/codes/flags.test.ts`` holds the shipped files to the ``declared`` members
    and the TypeScript readers to ``reads``; this holds the Python readers to the same
    ``reads`` for the same ``declared`` members. The two languages cannot disagree about a
    flag without one of the two tests failing.
    """

    golden = helpers.load_json(helpers.FIXTURES_DIR / "codes" / "flags.json")

    def test_the_golden_is_not_empty(self) -> None:
        databases = self.golden["databases"]
        self.assertEqual(
            sorted(databases),
            ["fanuc", "fanuc-lathe", "fanuc-lathe-b", "heidenhain", "okuma", "sinumerik"],
        )
        self.assertGreaterEqual(len(databases["fanuc"]), 24)
        self.assertGreaterEqual(len(databases["heidenhain"]), 18)

    def test_every_row_reads_the_same_in_python(self) -> None:
        rows = 0
        for dialect, entries in self.golden["databases"].items():
            for row in entries:
                entry = dict(row["declared"])
                entry["code"] = row["code"]
                with self.subTest(dialect=dialect, code=row["code"]):
                    self.assertEqual(
                        {
                            "axisWords": gedit_nc.axis_words_of(entry),
                            "frame": gedit_nc.frame_of(entry),
                            "speedLimitBound": gedit_nc.speed_limit_bound_of(entry),
                        },
                        row["reads"],
                    )
                rows += 1
        self.assertGreaterEqual(rows, 45)


class ExportTest(unittest.TestCase):
    def test_the_readers_are_part_of_the_module(self) -> None:
        for name in ("axis_words_of", "frame_of", "speed_limit_bound_of"):
            with self.subTest(name=name):
                self.assertIn(name, gedit_nc.__all__)


if __name__ == "__main__":
    unittest.main()
