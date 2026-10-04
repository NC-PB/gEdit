"""The Sinumerik milling profile in Python (plan §6 M9 WP9.1, roadmap R2).

The twin of ``src/lib/data/profiles/sinumerikMill.test.ts`` and
``src/lib/data/codes/sinumerikMill.test.ts`` where the scripts are concerned: the scripts
read the **resolved** profile and database (``tests/fixtures/resolved``), so what is
checked here is that the milling child reaches them the way the TypeScript side sees it.

* The tool rule: ``M6`` with the ``T`` of its block or the last one before it, a ``T``
  alone a preselect, ``T0`` before ``M6`` no tool. The tool list of the owner's published
  drilling program gives one row per tool with its own feed and speed; read with the
  turning rule, every preselect was a call of its own and each tool's feed and speed sat
  one row up (the M8 TODO item: nine segments for five tools).
* The power-on state: ``G17`` and ``G94``, diameter programming off.
* The flags of §7.2 on the shared database, the same lists as the TypeScript test.
"""

from __future__ import annotations

import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

MILLING = "sinumerik-mill"
TURNING = "sinumerik"

AXIS_WORDS = {
    "machine": ["G153", "G53", "G74", "G75", "SUPA"],
    # G25 and G26 (M9 review F10): with axis words they limit the working area.
    "data": ["AMIRROR", "AROT", "ASCALE", "ATRANS", "G25", "G26", "MIRROR", "ROT", "SCALE", "TRANS"],
}
FRAME = {
    # P10 (decision of 2026-10-04): TRAORI is tool centre point control, not a frame.
    "open": ["AMIRROR", "AROT", "ASCALE", "CYCLE800", "MIRROR", "ROT", "SCALE", "TRAANG", "TRACYL", "TRANSMIT"],
    "close": ["TRAFOOF"],
}
#: P10: the codes that switch tool centre point control (`sets.tcp`).
TCP = {"on": ["TRAORI"], "off": ["TRAFOOF"]}


def tool_rows(profile_id: str, rel: str):
    text = helpers.read_text(helpers.FIXTURES_DIR / rel)
    context = helpers.effective_context(profile_id)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": text.count("\n") + 1}
    result = helpers.run_script("tool_list.py", stdin=text, context=context)
    if not result.ok:
        raise AssertionError(result.stderr)
    return result.json()["rows"]


class ToolListTest(unittest.TestCase):
    def test_the_drilling_program_gives_one_row_per_tool_with_its_own_feed_and_speed(self) -> None:
        rows = tool_rows(MILLING, "nc/owner-public/sinumerik-mill/DRILLING.mpf")
        self.assertEqual(
            [(row["tool"], row["line"], row["calls"], row["feed"], row["speed"]) for row in rows],
            [
                ("T1", 8, 1, "637", "6366"),
                ("T2", 746, 1, "443", "295"),
                ("T3", 2406, 1, "637", "6366"),
                ("T5", 2435, 1, "557", "1114"),
                ("T4", 2457, 1, "557", "1114"),
            ],
        )
        # The description is the tool's own comment above its change, not the operation
        # comment of the tool before it.
        self.assertEqual(rows[1]["description"], "GEWINDEBOHRER D11 P1.5 L58 SD11")

    def test_the_turning_rule_counted_every_preselect_as_a_call(self) -> None:
        # The reading this profile replaces, kept as the proof that it changed something.
        rows = tool_rows(TURNING, "nc/owner-public/sinumerik-mill/DRILLING.mpf")
        self.assertEqual([row["calls"] for row in rows], [1, 2, 2, 2, 2])
        self.assertEqual(rows[0]["feed"], "")

    def test_a_preselect_and_a_tool_put_away_are_no_rows(self) -> None:
        rows = tool_rows(MILLING, "nc/sinumerik-mill/m01-plate.MPF")
        self.assertEqual(
            [(row["tool"], row["line"], row["calls"]) for row in rows],
            [("FACEMILL_D50", 11, 1), ("DRILL_D8", 24, 1), ("ENDMILL_D10", 40, 1)],
        )

    def test_a_tool_in_the_m6_block_and_t0_m6(self) -> None:
        rows = tool_rows(MILLING, "nc/sinumerik-mill/m02-five-axis.MPF")
        self.assertEqual([(row["tool"], row["line"]) for row in rows], [("T5", 10)])


class PowerOnTest(unittest.TestCase):
    def test_a_milling_program_starts_in_g17_per_minute_with_diameter_off(self) -> None:
        mill = helpers.resolved_profile(MILLING)
        turn = helpers.resolved_profile(TURNING)
        self.assertEqual(mill["modal"]["initial"], {"plane": "G17", "feedmode": "G94"})
        self.assertEqual(turn["modal"]["initial"], {"plane": "G18", "feedmode": "G95"})
        self.assertEqual(mill["machineParams"]["diameter"], "off")
        self.assertEqual(turn["machineParams"]["diameter"], "on")
        self.assertEqual(helpers.effective_context(MILLING)["machine"]["params"]["diameter"], "off")
        # Everything else is the turning profile's (AD-16) — but for the rotary axes, which
        # the milling profile names as axes and as angles since M10 (P10).
        for key in ("syntax", "outline", "numbering", "program", "codes", "grammar"):
            self.assertEqual(mill[key], turn[key], key)
        rest = lambda addresses: {k: v for k, v in addresses.items() if k not in ("axes", "angular")}
        self.assertEqual(rest(mill["addresses"]), rest(turn["addresses"]))
        self.assertEqual(mill["addresses"]["axes"], ["X", "Y", "Z", "A", "B", "C"])
        self.assertEqual(mill["addresses"]["angular"], ["A", "B", "C", "AR", "SF"])
        self.assertEqual(mill["toolCall"]["tool"], turn["toolCall"]["tool"])
        self.assertEqual(mill["toolCall"]["toolFrom"], "same-line-or-last")


class FlagTest(unittest.TestCase):
    def test_the_flags_read_as_the_typescript_test_lists_them(self) -> None:
        codes = helpers.resolved_codes(TURNING)
        for value, want in AXIS_WORDS.items():
            got = sorted(entry["code"] for entry in codes if gedit_nc.axis_words_of(entry) == value)
            self.assertEqual(got, want, value)
        for value, want in FRAME.items():
            got = sorted(entry["code"] for entry in codes if gedit_nc.frame_of(entry) == value)
            self.assertEqual(got, want, value)
        for value, want in TCP.items():
            got = sorted(entry["code"] for entry in codes if gedit_nc.tcp_of(entry) == value)
            self.assertEqual(got, want, value)


if __name__ == "__main__":
    unittest.main()
