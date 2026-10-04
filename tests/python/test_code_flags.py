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

M10 (P10) adds two, with their TypeScript twins ``positionOf`` and ``tcpOf``:

* ``position_of``: what a code parameter is to a program shift (roadmap R8) —
  ``'tool-axis'``, ``'none'``, ``'other'``, ``'mode'``, or ``None`` for one nobody reviewed.
* ``tcp_of``: a code that switches tool centre point control ``'on'`` or ``'off'``.
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
                            "tcp": gedit_nc.tcp_of(entry),
                        },
                        row["reads"],
                    )
                rows += 1
        self.assertGreaterEqual(rows, 45)


class PositionTest(unittest.TestCase):
    """P10 (R8): the twin of ``R8: the parameter role`` in ``flagsContract.test.ts``."""

    def test_the_four_roles_and_nothing_else(self) -> None:
        cases = [
            ({"address": "Q203", "position": "tool-axis"}, "tool-axis"),
            ({"address": "Q201", "position": "none"}, "none"),
            ({"address": "_X0", "position": "other"}, "other"),
            ({"address": "_AMODE", "position": "mode"}, "mode"),
            ({"address": "RTP"}, None),
            ({"address": "RTP", "position": "TOOL-AXIS"}, None),
            ({"address": "RTP", "position": "absolute"}, None),
            ({"address": "RTP", "position": True}, None),
            (None, None),
            ("RTP", None),
        ]
        for param, want in cases:
            with self.subTest(param=param):
                self.assertEqual(gedit_nc.position_of(param), want)


class TcpTest(unittest.TestCase):
    """P10 (decision of 2026-10-04): the twin of ``tool centre point control`` there."""

    def test_on_off_or_nothing(self) -> None:
        cases = [
            ({"code": "G43.4", "sets": {"tcp": "on"}}, "on"),
            ({"code": "TRAFOOF", "frame": "close", "sets": {"tcp": "off"}}, "off"),
            ({"code": "TRAORI", "frame": "open"}, None),
            ({"code": "M128", "sets": {"tcp": "ON"}}, None),
            ({"code": "M128", "sets": {"tcp": True}}, None),
            ({"code": "G1"}, None),
            (None, None),
        ]
        for entry, want in cases:
            with self.subTest(entry=entry):
                self.assertEqual(gedit_nc.tcp_of(entry), want)

    def test_tcp_and_the_frame_are_two_questions(self) -> None:
        # TRAFOOF ends a frame (TRANSMIT) and tool centre point control (TRAORI) at once.
        entry = {"code": "TRAFOOF", "frame": "close", "sets": {"tcp": "off"}}
        self.assertEqual((gedit_nc.frame_of(entry), gedit_nc.tcp_of(entry)), ("close", "off"))


class ExportTest(unittest.TestCase):
    def test_the_readers_are_part_of_the_module(self) -> None:
        for name in ("axis_words_of", "frame_of", "speed_limit_bound_of", "position_of", "tcp_of", "names_main_spindle"):
            with self.subTest(name=name):
                self.assertIn(name, gedit_nc.__all__)


if __name__ == "__main__":
    unittest.main()
