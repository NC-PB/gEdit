"""The two blocks of a two-block lathe cycle in Python (B1, plan "Two-block schema").

The twin of ``src/lib/core/codes/blocks.test.ts``: ``gedit_nc.cycle_block_of`` and
``params_of_block`` are held to the cases of ``tests/fixtures/codes/blocks.json``, on the
resolved databases the app hands to a script. And the rule that keeps every other reader
right without knowing the block: an address declared in both blocks reads the same in both
(``unit``, ``position``, ``axis``, ``programNumber``), so ``number_class_of`` and
``position_of`` give one answer for either block.
"""

from __future__ import annotations

import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

CASES = helpers.load_json(helpers.FIXTURES_DIR / "codes" / "blocks.json")["cases"]
READING_MEMBERS = ("unit", "position", "axis", "programNumber")


def entry_of(dialect: str, code: str):
    for entry in helpers.resolved_codes(dialect):
        if entry.get("code") == code:
            return entry
    raise AssertionError("no %s in %s" % (code, dialect))


class CycleBlockTest(unittest.TestCase):
    def test_the_shared_cases(self) -> None:
        for case in CASES:
            with self.subTest(dialect=case["dialect"], code=case["code"], written=case["written"]):
                entry = entry_of(case["dialect"], case["code"])
                self.assertEqual(gedit_nc.cycle_block_of(entry, case["written"]), case["block"])
                params = gedit_nc.params_of_block(entry, case["block"])
                self.assertEqual([p["address"] for p in params], case["params"])

    def test_an_entry_written_by_hand(self) -> None:
        entry = {
            "code": "G71",
            "blocks": 2,
            "params": [
                {"address": "U", "label": "a", "block": 1},
                {"address": "S", "label": "both"},
                {"address": "P", "label": "p", "block": 2},
            ],
        }
        self.assertTrue(gedit_nc.declares_blocks(entry))
        self.assertEqual(gedit_nc.cycle_block_of(entry, ["p"]), 2)
        self.assertEqual(gedit_nc.cycle_block_of(entry, ["s"]), 1)
        self.assertIsNone(gedit_nc.cycle_block_of(entry, ["X"]))
        self.assertEqual([p["label"] for p in gedit_nc.params_of_block(entry, 2)], ["both", "p"])
        # Without blocks: 2, or without any block, nothing is said and every parameter counts.
        plain = {"code": "G71", "params": [{"address": "P", "label": "p", "block": 2}]}
        self.assertFalse(gedit_nc.declares_blocks(plain))
        self.assertIsNone(gedit_nc.cycle_block_of(plain, ["P"]))
        self.assertIsNone(gedit_nc.cycle_block_of(None, ["P"]))
        self.assertEqual(len(gedit_nc.params_of_block(plain, 1)), 1)


class SameReadingInBothBlocksTest(unittest.TestCase):
    def test_every_address_of_both_blocks_reads_alike(self) -> None:
        for dialect in ("fanuc-lathe", "fanuc-lathe-b"):
            for entry in helpers.resolved_codes(dialect):
                if not gedit_nc.declares_blocks(entry):
                    continue
                first = {p["address"]: p for p in gedit_nc.params_of_block(entry, 1)}
                for param in gedit_nc.params_of_block(entry, 2):
                    other = first.get(param["address"])
                    if other is None:
                        continue
                    for member in READING_MEMBERS:
                        with self.subTest(dialect=dialect, code=entry["code"], address=param["address"], member=member):
                            self.assertEqual(param.get(member), other.get(member))

    def test_number_class_of_answers_once_for_either_block(self) -> None:
        profile = helpers.load_profile("fanuc-lathe")
        g76 = entry_of("fanuc-lathe", "G76")
        # The packed P of the first block and the thread height of the second: never converted.
        self.assertEqual(gedit_nc.number_class_of("P", profile, "per-rev", [g76], True), "count")
        self.assertEqual(gedit_nc.number_class_of("Q", profile, "per-rev", [g76], True), "increment")
        self.assertEqual(gedit_nc.number_class_of("F", profile, "per-rev", [g76], True), "feedPerRev")
        g71 = entry_of("fanuc-lathe", "G71")
        self.assertEqual(gedit_nc.number_class_of("P", profile, "per-rev", [g71]), "count")
        self.assertEqual(gedit_nc.number_class_of("U", profile, "per-rev", [g71]), "length")


if __name__ == "__main__":
    unittest.main()
