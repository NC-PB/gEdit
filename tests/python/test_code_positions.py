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


if __name__ == "__main__":
    unittest.main()
