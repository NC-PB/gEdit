"""How the control reads numbers, the Python half (plan §7.15, AD-31, WP6.9).

The point of this file is **parity**. Every case in
``tests/fixtures/machines/numbers.json`` is run by `src/lib/core/machines/numbers.test.ts`
as well, so a difference between the two implementations shows up here or there rather
than in a customer's program. When one of them has to change, the fixture changes with it
and both sides are re-run — never one side alone.

The cases below the table are about the module's own edges: the fallback that lets a
context written before M6 keep working, and the two ways a script can hand a machine in.
"""

from __future__ import annotations

import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

# The reason strings, which `gedit_nc` does not re-export: the golden set names the case
# ("rounded"), and the module says what the sentence for it is.
import _nc_machine  # noqa: E402  (importable only once helpers has set sys.path)

KEEP = {"decimals": "keep", "trailingZeros": "keep", "keepPoint": True, "plusSign": "keep"}


def literal(raw):
    """A golden literal as the tokenizer would have produced it."""
    parsed = gedit_nc.parse_number(raw)
    if parsed is None:
        raise AssertionError("%r does not parse" % (raw,))
    return parsed


class GoldenCases(unittest.TestCase):
    """The table both languages answer, case for case."""

    @classmethod
    def setUpClass(cls):
        cls.golden = helpers.load_json(helpers.FIXTURES_DIR / "machines" / "numbers.json")

    # -- the golden set's own vocabulary --------------------------------------

    def input_of(self, name):
        """One ``NumberInput`` of the golden set, or ``None`` for a profile without one."""
        if name is None:
            return None
        inputs = self.golden["inputs"]
        self.assertIn(name, inputs)
        return inputs[name]

    def params_of(self, name):
        """The machine parameters a case describes; only ``numberInput`` matters here."""
        return {
            "numberInput": self.input_of(name),
            "units": "mm",
            "diameter": None,
            "variants": {},
            "modalInitial": {},
        }

    def profile_of(self, name):
        """A built-in profile as the app uses it, or one the golden set writes itself."""
        entry = self.golden["profiles"][name]
        if "profile" in entry:
            return helpers.resolved_profile(entry["profile"])
        return entry["inline"]

    def decl_profile_of(self, name):
        """A profile that carries the declaration a case names.

        ``readings_of`` and ``resolve_value`` take the profile, not the declaration, so a
        declaration the golden set writes itself (the Okuma presets, whose profile ships
        in M8) is wrapped in a profile here.
        """
        entry = self.golden["decls"][name]
        if "profile" in entry:
            return helpers.resolved_profile(entry["profile"])
        written = entry.get("numberInput")
        if written is None:
            return {}
        presets = [
            {"id": preset["id"], "label": preset["label"], "value": self.input_of(preset["input"])}
            for preset in written["presets"]
        ]
        return {"machineParams": {"numberInput": {"default": written["default"], "presets": presets}}}

    # -- the table ------------------------------------------------------------

    def test_the_table_holds_the_cases_the_plan_asks_for(self):
        total = sum(len(self.golden[section]) for section in ("class", "value", "writeBack", "readings", "resolve"))
        self.assertGreaterEqual(total, 80)

    def test_every_word_gets_the_class_typescript_gives_it(self):
        for number, case in enumerate(self.golden["class"], 1):
            with self.subTest(case=number, note=case["note"]):
                self.assertEqual(
                    gedit_nc.number_class_of(
                        case["address"],
                        self.profile_of(case["profile"]),
                        case["feedUnit"],
                        case["codes"],
                        case.get("pitchFeed", False),
                    ),
                    case["expected"],
                )

    def test_every_literal_has_the_value_typescript_reads_out_of_it(self):
        for number, case in enumerate(self.golden["value"], 1):
            with self.subTest(case=number, note=case["note"]):
                self.assertEqual(
                    gedit_nc.value_of(
                        literal(case["literal"]), case["class"], self.params_of(case["input"]), case["units"]
                    ),
                    case["expected"],
                )

    def test_every_value_goes_back_into_the_word_the_way_typescript_writes_it(self):
        for number, case in enumerate(self.golden["writeBack"], 1):
            with self.subTest(case=number, note=case["note"]):
                text, rounded, error = gedit_nc.write_back(
                    case["value"],
                    literal(case["original"]),
                    case["class"],
                    self.params_of(case["input"]),
                    case["units"],
                    self.golden["fmt"],
                    case.get("refuseRounding", False),
                )
                expected = case["expected"]
                if "error" in expected:
                    self.assertIsNone(text)
                    self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS[expected["error"]])
                else:
                    self.assertIsNone(error)
                    self.assertEqual(text, expected["text"])
                    self.assertEqual(rounded, expected["rounded"])

    def test_every_preset_reads_a_literal_the_way_typescript_does(self):
        for number, case in enumerate(self.golden["readings"], 1):
            with self.subTest(case=number, note=case["note"]):
                readings = gedit_nc.readings_of(
                    literal(case["literal"]), case["class"], self.decl_profile_of(case["decl"]), case["units"]
                )
                self.assertEqual(
                    [{"preset": r["preset"], "value": r["value"]} for r in readings], case["expected"]
                )
                for reading in readings:
                    self.assertTrue(reading["label"], reading["preset"])

    def test_every_word_resolves_the_way_typescript_resolves_it(self):
        for number, case in enumerate(self.golden["resolve"], 1):
            with self.subTest(case=number, note=case["note"]):
                ctx_machine = {
                    "id": None,
                    "name": None,
                    "choice": "document" if case["source"] == "machine" else "none",
                    "params": self.params_of(case["input"]),
                    "source": {
                        "numberInput": case["source"],
                        "units": "profile",
                        "diameter": "profile",
                        "variants": {},
                        "modalInitial": {},
                    },
                }
                value, readings = gedit_nc.resolve_value(
                    literal(case["literal"]),
                    case["class"],
                    ctx_machine,
                    self.decl_profile_of(case["decl"]),
                    case["units"],
                )
                self.assertEqual(value, case["expected"]["value"])
                self.assertEqual([r["preset"] for r in readings], case["expected"]["readings"])


class MachineParams(unittest.TestCase):
    """What a script gets when nobody chose a machine (§7.15)."""

    def test_an_empty_context_answers_the_defaults_with_every_source_the_profile(self):
        machine = gedit_nc.machine_params({})
        self.assertEqual(machine["choice"], "none")
        self.assertIsNone(machine["id"])
        self.assertIsNone(machine["params"]["numberInput"])
        self.assertEqual(machine["params"]["units"], "mm")
        self.assertEqual(machine["source"]["numberInput"], "profile")
        self.assertEqual(machine["source"]["units"], "profile")

    def test_a_context_without_a_machine_answers_the_profile_defaults(self):
        profile = helpers.load_profile("fanuc-gcode")
        machine = gedit_nc.machine_params(helpers.make_context(profile=profile))
        self.assertEqual(machine["choice"], "none")
        self.assertEqual(machine["params"]["numberInput"], profile["machineParams"]["numberInput"]["presets"][0]["value"])
        self.assertEqual(machine["params"]["units"], "mm")
        for name in ("numberInput", "units", "diameter"):
            self.assertEqual(machine["source"][name], "profile")
        self.assertEqual(machine["source"]["modalInitial"], {"feedmode": "profile"})

    def test_the_lathe_defaults_to_the_preset_its_declaration_names(self):
        profile = helpers.load_profile("fanuc-lathe")
        machine = gedit_nc.machine_params(helpers.make_context(profile=profile))
        presets = profile["machineParams"]["numberInput"]["presets"]
        wanted = next(p for p in presets if p["id"] == profile["machineParams"]["numberInput"]["default"])
        self.assertEqual(machine["params"]["numberInput"], wanted["value"])
        self.assertEqual(machine["params"]["diameter"], "on")
        self.assertEqual(machine["params"]["variants"], {"gcodeSystem": "A"})

    def test_a_profile_that_declares_nothing_reads_its_numbers_as_written(self):
        profile = helpers.load_profile("heidenhain-klartext")
        machine = gedit_nc.machine_params(helpers.make_context(profile=profile))
        self.assertIsNone(machine["params"]["numberInput"])
        self.assertEqual(gedit_nc.value_of(literal("50"), "length", machine, "mm"), "50")

    def test_the_effective_machine_of_the_context_is_taken_as_it_stands(self):
        context = helpers.effective_context("fanuc-gcode", preset="is-b")
        machine = gedit_nc.machine_params(context)
        self.assertEqual(machine["source"]["numberInput"], "machine")
        value, readings = gedit_nc.resolve_value(literal("50"), "length", machine, context["profile"], "mm")
        self.assertEqual(value, "0.05")
        self.assertEqual(readings, [])

    def test_the_whole_effective_machine_may_be_passed_where_parameters_are_wanted(self):
        # A script holds `machine_params(load_context())`, not its `params` member, and
        # passing it must not silently read numbers as if no machine had been chosen.
        context = helpers.effective_context("fanuc-gcode", preset="is-b")
        machine = gedit_nc.machine_params(context)
        self.assertEqual(gedit_nc.value_of(literal("50"), "length", machine, "mm"), "0.05")
        self.assertEqual(gedit_nc.value_of(literal("50"), "length", machine["params"], "mm"), "0.05")


class WriteBackEdges(unittest.TestCase):
    """The rules that are easier to read as a sentence than as a fixture line."""

    def setUp(self):
        self.machine = {
            "numberInput": {
                "mode": "increment",
                "incrementMm": "0.001",
                "incrementInch": "0.0001",
                "incrementDeg": "0.001",
                "incrementSec": "0.001",
                "classes": {"feedPerMin": {"mode": "calculator"}, "feedPerRev": {"mode": "calculator"}},
            }
        }

    def test_a_point_survives_and_a_point_less_word_stays_point_less_in_all_three_readings(self):
        calculator = {"numberInput": {"mode": "calculator", "incrementMm": "1"}}
        scale = {"numberInput": {"mode": "scale", "incrementMm": "0.01"}}
        # A point-less word is a count of increments under `increment`, of units under
        # `scale` and millimetres under `calculator`; a pointed word is millimetres in
        # `increment` and `calculator` and still a count of units under `scale`.
        for machine, counted, written in (
            (self.machine, "0.06", "60"),
            (calculator, "60", "60"),
            (scale, "0.6", "0.6"),
        ):
            with self.subTest(machine=machine["numberInput"]["mode"]):
                self.assertEqual(
                    gedit_nc.write_back(counted, literal("50"), "length", machine, "mm", KEEP), ("60", False, None)
                )
                self.assertEqual(
                    gedit_nc.write_back(written, literal("50."), "length", machine, "mm", KEEP), ("60.", False, None)
                )

    def test_a_rounding_is_reported_and_can_be_refused(self):
        text, rounded, error = gedit_nc.write_back("0.0505", literal("50"), "length", self.machine, "mm", KEEP)
        self.assertEqual((text, rounded, error), ("51", True, None))
        text, rounded, error = gedit_nc.write_back(
            "0.0505", literal("50"), "length", self.machine, "mm", KEEP, True
        )
        self.assertIsNone(text)
        self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS["rounded"])

    def test_a_value_that_fits_is_never_refused(self):
        self.assertEqual(
            gedit_nc.write_back("0.05", literal("50"), "length", self.machine, "mm", KEEP, True), ("50", False, None)
        )

    def test_a_value_that_is_not_a_number_is_refused_instead_of_raising(self):
        text, _rounded, error = gedit_nc.write_back("1e3", literal("50"), "length", self.machine, "mm", KEEP)
        self.assertIsNone(text)
        self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS["notANumber"])

    def test_a_word_without_a_reading_has_nothing_to_write_back_into(self):
        text, _rounded, error = gedit_nc.write_back("3", literal("3"), "count", self.machine, "mm", KEEP)
        self.assertIsNone(text)
        self.assertEqual(error, _nc_machine.WRITE_BACK_ERRORS["noReading"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
