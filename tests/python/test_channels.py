"""The channels of a document in a script (plan §7.17, AD-32). Owner: **WP12.6**. It pins
the names, and the empty answer for a context without the member, which is what keeps every
M5–M11 script unaffected.
"""

from __future__ import annotations

import pathlib
import unittest

from tests.python import helpers

#: Section 7.17's Python API, re-exported by the facade.
CHANNEL_NAMES = [
    "channels",
    "channel_of",
    "channel_lines",
    "channel_line_numbers",
    "outside_lines",
    "outside_line_numbers",
    "sync_marks",
]

RESOLVE = helpers.FIXTURES_DIR / "channels" / "resolve"
NC = helpers.FIXTURES_DIR / "channels" / "nc" / "fanuc-lathe"


def golden(name):
    return helpers.channel_context(RESOLVE / ("%s.json" % name))


def lines_of(name):
    return helpers.read_lines(NC / name)


NO_CHANNELS = {"layout": "none", "self": None, "list": [], "outside": [], "marks": []}


class ChannelApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gedit_nc = helpers.import_gedit_nc()

    def test_the_facade_exports_the_channel_api(self) -> None:
        for name in CHANNEL_NAMES:
            self.assertIn(name, self.gedit_nc.__all__)
            self.assertTrue(callable(getattr(self.gedit_nc, name)))

    def test_the_scripts_readme_documents_every_channel_name(self) -> None:
        readme = (pathlib.Path(__file__).resolve().parents[2] / "src-tauri" / "resources" / "scripts" / "README.md").read_text(encoding="utf-8")
        for name in CHANNEL_NAMES:
            self.assertIn("`" + name + "(", readme, name)

    def test_a_context_without_channels_answers_empty(self) -> None:
        g = self.gedit_nc
        for ctx in ({}, helpers.make_context()):
            self.assertEqual(g.channels(ctx), NO_CHANNELS)
            # Every key is there, so a script need not check (CODE-10).
            for key in ("layout", "self", "list", "outside", "marks"):
                self.assertIn(key, g.channels(ctx))
            self.assertIsNone(g.channels(ctx)["self"])
            self.assertEqual(g.channels(ctx)["outside"], [])
            self.assertIsNone(g.channel_of(ctx, 1))
            self.assertEqual(g.channel_lines(ctx, ["G0 X0"], "1"), [])
            self.assertEqual(g.outside_lines(ctx, ["G0 X0"]), [])
            self.assertEqual(g.sync_marks(ctx), [])

    def test_channel_context_without_a_generated_entry_says_how_to_make_it(self) -> None:
        with self.assertRaises(AssertionError) as caught:
            helpers.channel_context(helpers.FIXTURES_DIR / "channels" / "resolve" / "nothing.json")
        self.assertIn("UPDATE_RESOLVED", str(caught.exception))


class FourSectionTest(unittest.TestCase):
    """``c10-alternating.nc``: channel 1 holds lines 5-12 and 21-27, channel 2 13-20 and
    28-34, lines 1-4 and 35-41 belong to neither."""

    def setUp(self) -> None:
        self.g = helpers.import_gedit_nc()
        self.ctx = golden("c10-alternating")
        self.lines = lines_of("c10-alternating.nc")

    def test_channels_is_the_member(self) -> None:
        member = self.g.channels(self.ctx)
        self.assertEqual(member["layout"], "single-file")
        self.assertIsNone(member["self"])
        self.assertEqual([c["id"] for c in member["list"]], ["1", "2"])
        self.assertEqual(
            member["list"][0]["ranges"],
            [{"startLine": 5, "endLine": 12}, {"startLine": 21, "endLine": 27}],
        )
        self.assertEqual(member["outside"], [{"startLine": 1, "endLine": 4}, {"startLine": 35, "endLine": 41}])
        # A copy: a script that edits it changes nothing the others read.
        member["list"][0]["ranges"].clear()
        self.assertEqual(len(self.g.channels(self.ctx)["list"][0]["ranges"]), 2)

    def test_channel_of_walks_every_range(self) -> None:
        expected = {1: None, 4: None, 5: "1", 12: "1", 13: "2", 20: "2", 21: "1", 27: "1", 28: "2", 34: "2", 35: None, 41: None}
        for line, channel in expected.items():
            with self.subTest(line=line):
                self.assertEqual(self.g.channel_of(self.ctx, line), channel)
        for bad in (0, -3, 99):
            self.assertIsNone(self.g.channel_of(self.ctx, bad))

    def test_channel_lines_concatenates_the_ranges_in_document_order(self) -> None:
        one = self.g.channel_lines(self.ctx, self.lines, "1")
        two = self.g.channel_lines(self.ctx, self.lines, "2")
        self.assertEqual(one, self.lines[4:12] + self.lines[20:27])
        self.assertEqual(two, self.lines[12:20] + self.lines[27:34])
        # What the control does when it separates the program: O1001, then O1002.
        self.assertEqual([l for l in one if l.startswith("O")], ["O1001 (CHANNEL 1 - ROUGH)", "O1002 (CHANNEL 1 - FINISH)"])

    def test_channel_lines_never_returns_a_line_of_outside(self) -> None:
        both = self.g.channel_lines(self.ctx, self.lines, "1") + self.g.channel_lines(self.ctx, self.lines, "2")
        # The subprogram between the last section and the `%` is in neither channel.
        self.assertNotIn("O9001 (SHARED - FACE PASS)", both)
        self.assertNotIn("%", both)
        self.assertEqual(len(both), 8 + 7 + 8 + 7)

    def test_the_three_groups_cover_the_input_exactly_once(self) -> None:
        g = self.g
        total = (
            len(g.channel_lines(self.ctx, self.lines, "1"))
            + len(g.channel_lines(self.ctx, self.lines, "2"))
            + len(g.outside_lines(self.ctx, self.lines))
        )
        self.assertEqual(total, len(self.lines))
        self.assertEqual(g.outside_lines(self.ctx, self.lines)[:4], self.lines[:4])
        self.assertEqual(g.outside_lines(self.ctx, self.lines)[4:], self.lines[34:])

    def test_line_numbers_name_the_document_line_of_each_line(self) -> None:
        numbers = self.g.channel_line_numbers(self.ctx, self.lines, "1")
        self.assertEqual(numbers, list(range(5, 13)) + list(range(21, 28)))
        self.assertEqual(self.g.outside_line_numbers(self.ctx, self.lines), [1, 2, 3, 4] + list(range(35, 42)))
        self.assertEqual(self.g.channel_line_numbers(self.ctx, self.lines, "nope"), [])

    def test_an_unknown_channel_is_empty(self) -> None:
        self.assertEqual(self.g.channel_lines(self.ctx, self.lines, "3"), [])
        self.assertEqual(self.g.channel_lines(self.ctx, self.lines, ""), [])

    def test_a_selection_reads_only_the_part_of_each_channel_inside_it(self) -> None:
        ctx = dict(self.ctx, input={"scope": "selection", "startLine": 10, "endLine": 22})
        selected = self.lines[9:22]
        self.assertEqual(self.g.channel_lines(ctx, selected, "1"), self.lines[9:12] + self.lines[20:22])
        self.assertEqual(self.g.channel_lines(ctx, selected, "2"), self.lines[12:20])
        self.assertEqual(self.g.channel_line_numbers(ctx, selected, "1"), [10, 11, 12, 21, 22])
        self.assertEqual(self.g.outside_lines(ctx, selected), [])

    def test_sync_marks_are_in_line_order_and_filter_by_channel(self) -> None:
        marks = self.g.sync_marks(self.ctx)
        self.assertEqual([(m["id"], m["line"], m["channel"]) for m in marks], [("M901", 11, "1"), ("M901", 19, "2"), ("M902", 26, "1"), ("M902", 33, "2")])
        self.assertEqual(marks[0]["partners"], ["1", "2"])
        self.assertTrue(marks[0]["blocking"])
        self.assertEqual([m["line"] for m in self.g.sync_marks(self.ctx, "2")], [19, 33])
        self.assertEqual(self.g.sync_marks(self.ctx, "9"), [])
        marks[0]["partners"].append("x")
        self.assertEqual(self.g.sync_marks(self.ctx)[0]["partners"], ["1", "2"])


class OneFilePerChannelTest(unittest.TestCase):
    def setUp(self) -> None:
        self.g = helpers.import_gedit_nc()
        self.ctx = golden("c06-part_CH2")
        self.lines = lines_of("c06-part_CH2.nc")

    def test_the_document_is_one_channel(self) -> None:
        member = self.g.channels(self.ctx)
        self.assertEqual(member["layout"], "multi-file")
        self.assertEqual(member["self"], "2")
        self.assertEqual(member["outside"], [])
        self.assertEqual([(c["id"], c["open"]) for c in member["list"]], [("1", False), ("2", True)])
        self.assertEqual(member["list"][1]["file"], "c06-part_CH2.nc")
        self.assertNotIn("ranges", member["list"][1])

    def test_every_line_is_this_channels(self) -> None:
        for line in (1, 7, len(self.lines)):
            self.assertEqual(self.g.channel_of(self.ctx, line), "2")
        self.assertEqual(self.g.channel_lines(self.ctx, self.lines, "2"), self.lines)
        self.assertEqual(self.g.channel_lines(self.ctx, self.lines, "1"), [])
        self.assertEqual(self.g.outside_lines(self.ctx, self.lines), [])

    def test_marks(self) -> None:
        marks = self.g.sync_marks(self.ctx)
        self.assertTrue(marks)
        self.assertEqual({m["channel"] for m in marks}, {"2"})


class DocumentWithoutChannelsTest(unittest.TestCase):
    def test_a_program_no_section_start_matches_has_no_member(self) -> None:
        g = helpers.import_gedit_nc()
        ctx = golden("c05-one-channel")
        self.assertNotIn("channels", ctx)
        lines = lines_of("c05-one-channel.nc")
        self.assertEqual(g.channels(ctx), NO_CHANNELS)
        self.assertEqual(g.channel_lines(ctx, lines, "1"), [])
        self.assertEqual(g.outside_lines(ctx, lines), [])
        self.assertEqual(g.sync_marks(ctx), [])
        self.assertIsNone(g.channel_of(ctx, 4))


class MalformedMemberTest(unittest.TestCase):
    """The context is JSON from the app, but a hand-written one must not crash a script."""

    def test_garbage_answers_empty(self) -> None:
        g = helpers.import_gedit_nc()
        for member in (None, 3, [], {}, {"layout": "other"}, {"layout": "none"}):
            ctx = {"channels": member}
            with self.subTest(member=member):
                self.assertEqual(g.channels(ctx), NO_CHANNELS)
                self.assertEqual(g.channel_lines(ctx, ["a"], "1"), [])
                self.assertEqual(g.sync_marks(ctx), [])
        for ctx in (None, [], "x"):
            self.assertEqual(g.channels(ctx), NO_CHANNELS)

    def test_bad_ranges_are_ignored(self) -> None:
        g = helpers.import_gedit_nc()
        member = {
            "layout": "single-file",
            "self": None,
            "list": [
                {"id": "1", "name": "A", "ranges": [{"startLine": 2, "endLine": 3}, {"startLine": "x"}, {"startLine": 5, "endLine": 4}, 7, {"startLine": 0, "endLine": 2}]},
                "junk",
                {"name": "no id", "ranges": [{"startLine": 1, "endLine": 9}]},
            ],
        }
        ctx = {"channels": member}
        lines = ["l%d" % n for n in range(1, 7)]
        self.assertEqual(g.channel_lines(ctx, lines, "1"), ["l2", "l3"])
        self.assertEqual(g.channels(ctx)["marks"], [])
        self.assertEqual(g.channels(ctx)["outside"], [])


if __name__ == "__main__":
    unittest.main()
