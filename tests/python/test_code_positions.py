"""The R8 roles of the shipped code databases, read in Python (plan §6 M10 P10 item 1,
§7.2 ``CodeParam.position``, §7.16 #106).

The twin of ``src/lib/data/codes/positions.test.ts``: ``tests/fixtures/codes/positions.json``
lists every entry whose parameters carry the role, in order, with the role each declares
(``None``: not reviewed). This holds the shipped files and ``gedit_nc.position_of`` to it,
so the two languages cannot disagree about which cycle parameter a program shift moves.
"""

from __future__ import annotations

import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

GOLDEN = helpers.load_json(helpers.FIXTURES_DIR / "codes" / "positions.json")
DIALECTS = ["fanuc", "fanuc-lathe", "fanuc-lathe-b", "heidenhain", "okuma", "sinumerik"]


def own_codes(dialect: str):
    return helpers.load_json(helpers.CODES_DIR / ("%s.json" % dialect))["codes"]


class PositionGoldenTest(unittest.TestCase):
    def test_one_list_per_database_file(self) -> None:
        self.assertEqual(sorted(GOLDEN["databases"]), DIALECTS)

    def test_the_shipped_files_declare_exactly_the_listed_roles(self) -> None:
        for dialect in DIALECTS:
            rows = [
                {"code": e["code"], "params": [[p["address"], p.get("position")] for p in e.get("params") or []]}
                for e in own_codes(dialect)
                if any("position" in p for p in e.get("params") or [])
            ]
            with self.subTest(dialect=dialect):
                self.assertEqual(rows, GOLDEN["databases"][dialect])

    def test_position_of_reads_every_role_as_listed(self) -> None:
        count = 0
        for dialect, rows in GOLDEN["databases"].items():
            entries = {e["code"]: e for e in helpers.resolved_codes(dialect)}
            for row in rows:
                entry = entries[row["code"]]
                got = [[p["address"], gedit_nc.position_of(p)] for p in entry.get("params") or []]
                with self.subTest(dialect=dialect, code=row["code"]):
                    self.assertEqual(got, row["params"])
                count += 1
        self.assertGreaterEqual(count, 35)

    def test_no_lathe_database_carries_a_role_even_inherited(self) -> None:
        # The lathe's R is a machine parameter in G-code system A; every lathe cycle is refused.
        for dialect in ("fanuc-lathe", "fanuc-lathe-b", "okuma"):
            with self.subTest(dialect=dialect):
                found = [
                    e["code"]
                    for e in helpers.resolved_codes(dialect)
                    if any(gedit_nc.position_of(p) is not None for p in e.get("params") or [])
                ]
                self.assertEqual(found, [])


class OkumaHomeReturnTest(unittest.TestCase):
    """B1 (package A7-O): the Okuma home returns ``G20`` and ``G21`` go to positions stored
    in machine coordinates, so their axis words are machine positions, as Fanuc ``G28``,
    ``G30`` and ``G53`` are; their only parameter (``HP``, which position) has no R8 role."""

    def entries(self, dialect):
        return {e["code"]: e for e in helpers.resolved_codes(dialect)}

    def test_g20_and_g21_are_machine_positions_like_the_fanuc_returns(self):
        okuma = self.entries("okuma")
        fanuc = self.entries("fanuc")
        for code in ("G20", "G21"):
            with self.subTest(code=code):
                self.assertEqual(gedit_nc.axis_words_of(okuma[code]), "machine")
                self.assertEqual(
                    [[p["address"], gedit_nc.position_of(p)] for p in okuma[code].get("params") or []],
                    [["HP", None]],
                )
        for code in ("G28", "G30", "G53"):
            with self.subTest(code=code):
                self.assertEqual(gedit_nc.axis_words_of(fanuc[code]), "machine")

    def test_extents_keep_a_home_return_out_of_the_ranges(self):
        import extents  # the bundled folder is on sys.path once gedit_nc is imported

        # A machine in the 1 mm unit system, so a written X100. is 100 mm and is resolved.
        context = helpers.effective_context("okuma-osp", preset="okuma-1mm")
        context["machine"] = dict(context["machine"], id="m", name="M")
        cp = gedit_nc.compile_profile(context["profile"])
        walker = extents.Extents(context, cp)
        state = None
        program = ["G00 X100. Z50.", "G20 HP=1 X400. Z300.", "G00 X80. Z10.", "M02"]
        for number, line in enumerate(program, 1):
            state = walker.line(line, number, state, record=True)
        walker.settle_held()
        x = walker.program.ranges.get("X")
        self.assertIsNotNone(x)
        self.assertEqual(
            (extents.text_of(x.low, 4), extents.text_of(x.high, 4)), ("80", "100"),
            "the X of a G20 block is a machine position and never enters the program's range",
        )
        self.assertEqual([r["where"] for r in walker.machine_rows], ["G20 (line 2)", "G20 (line 2)"])


if __name__ == "__main__":
    unittest.main()
