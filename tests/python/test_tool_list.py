"""`tool_list.py` (plan §5, WP4.6), against the golden cases in
``tests/fixtures/scripts/tool_list/``.

Each case is a folder: `input.nc`, the optional `params.json` the user would have filled
in, the optional `case.json` that says which dialect it is written in, and `expected.json`
— the whole report, authored from the input. The script runs in a subprocess the way the
app runs it (header, stdin, `GEDIT_CONTEXT`), because that is what is being tested.

What the cases cover, in the plan's words:

* a preselect `T2` after `T1 M6` is not a tool change (`fanuc-preselect`)
* `M06T1` (`fanuc-packed`)
* the description modes (`fanuc-description-*`)
* Klartext by number and by name (`klartext-numbers`, `klartext-names`)
* `TOOL CALL Z S5000` is not a tool change (`klartext-speed-only`)
"""

from __future__ import annotations

import sys
import unittest

from tests.python import helpers

SCRIPT = "tool_list.py"

#: `tomllib` reads the script header the way the backend does; it arrived in 3.11, and
#: the gate also runs on 3.9, where those two checks are skipped rather than dropped.
HAS_TOMLLIB = sys.version_info >= (3, 11)

#: Cases the plan names by hand, so a renamed or deleted folder fails loudly.
REQUIRED_CASES = [
    "fanuc-description-above",
    "fanuc-description-auto",
    "fanuc-description-below",
    "fanuc-description-trailing",
    "fanuc-feed-modes",
    "fanuc-lathe-turret",
    "fanuc-packed",
    "fanuc-preselect",
    "klartext-names",
    "klartext-numbers",
    "klartext-speed-only",
]


def run_case(case):
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=case.context())


class TestGoldenCases(unittest.TestCase):
    def setUp(self):
        self.cases = helpers.script_cases("tool_list")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        self.assertTrue(self.cases, "no tool_list fixtures found")
        names = sorted(case.name for case in self.cases)
        self.assertEqual([name for name in REQUIRED_CASES if name not in names], [])

    def test_every_case_produces_its_expected_report(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                self.assertTrue(case.expects_json, "a tool list is a report, so expected.json")
                result = run_case(case)
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.stderr, "")
                self.assertEqual(result.json(), case.expected_json())

    def test_a_report_row_carries_a_line_number_inside_the_program(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                report = case.expected_json()
                keys = [column["key"] for column in report["columns"]]
                for row in report["rows"]:
                    self.assertEqual(sorted(row), sorted(keys))
                    self.assertIsInstance(row["line"], int)
                    self.assertGreaterEqual(row["line"], 1)
                for finding in report.get("findings", []):
                    self.assertIn(finding["severity"], ("info", "warning", "error"))
                    self.assertIsInstance(finding["line"], int)


class TestRules(unittest.TestCase):
    """The rules behind the cases, stated once so a fixture change cannot hide them."""

    def report_of(self, name):
        case = next(case for case in helpers.script_cases("tool_list") if case.name == name)
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def tools(self, name):
        return [row["tool"] for row in self.report_of(name)["rows"]]

    def test_a_preselect_is_not_a_tool_change(self):
        # `T1 M6` then a bare `T2`: two tools, each called once, and T2's call is its own
        # `T2 M6` further down, not the preselect.
        report = self.report_of("fanuc-preselect")
        self.assertEqual([(row["tool"], row["calls"], row["line"]) for row in report["rows"]], [("T1", 1, 7), ("T2", 1, 15)])

    def test_a_tool_without_a_comment_falls_back_to_the_header_tool_list(self):
        rows = self.report_of("fanuc-preselect")["rows"]
        # `(T2  D8.5 DRILL)` describes T2 and gives up its own `T2`.
        self.assertEqual(rows[1]["description"], "D8.5 DRILL")

    def test_packed_output_finds_the_tool_in_m06t1(self):
        report = self.report_of("fanuc-packed")
        self.assertEqual([(row["tool"], row["calls"]) for row in report["rows"]], [("T1", 2), ("T3", 1)])

    def test_a_tool_change_inside_a_comment_is_not_a_tool_change(self):
        self.assertNotIn("T5", self.tools("fanuc-packed"))

    def test_the_description_modes_pick_different_comments(self):
        self.assertEqual(
            [row["description"] for row in self.report_of("fanuc-description-auto")["rows"]],
            ["TRAILING T1", "ABOVE T2"],
        )
        self.assertEqual(
            [row["description"] for row in self.report_of("fanuc-description-above")["rows"]],
            ["ABOVE T1", "ABOVE T2"],
        )
        self.assertEqual(
            [row["description"] for row in self.report_of("fanuc-description-below")["rows"]],
            ["BELOW T1", "BELOW T2"],
        )
        self.assertEqual(
            [row["description"] for row in self.report_of("fanuc-description-trailing")["rows"]],
            ["TRAILING T1", ""],
        )

    def test_leading_zeros_are_a_display_rule_and_never_a_second_tool(self):
        self.assertEqual(self.tools("fanuc-zeros-dropped"), ["T1"])
        self.assertEqual(self.tools("fanuc-zeros-as-written"), ["T01"])
        self.assertEqual(self.report_of("fanuc-zeros-dropped")["rows"][0]["calls"], 2)

    def test_klartext_names_a_tool_by_number_by_name_and_by_parameter(self):
        self.assertEqual(self.tools("klartext-names"), ["MILL_D10", "QS1", "T12.1"])
        self.assertEqual(self.tools("klartext-numbers"), ["T1", "T2"])

    def test_a_klartext_speed_change_is_not_a_tool_change(self):
        report = self.report_of("klartext-speed-only")
        self.assertEqual(len(report["rows"]), 1)
        self.assertEqual(report["rows"][0]["calls"], 1)
        # The speed range still covers every `TOOL CALL`, because the tool did not change.
        self.assertEqual(report["rows"][0]["speed"], "3000-6000")

    def test_a_thread_pitch_is_never_counted_as_a_feed(self):
        report = self.report_of("fanuc-feed-modes")
        tap = report["rows"][1]
        self.assertEqual(tap["feed"], "")
        self.assertTrue(any("thread pitch" in finding["message"] for finding in report["findings"]))

    def test_a_feed_in_another_mode_is_reported_rather_than_mixed_into_the_range(self):
        report = self.report_of("fanuc-feed-modes")
        self.assertEqual(report["rows"][0]["feed"], "250.-1200.")
        self.assertTrue(any("G95" in finding["message"] for finding in report["findings"]))

    def test_a_surface_speed_and_a_speed_limit_are_not_spindle_speeds(self):
        report = self.report_of("fanuc-feed-modes")
        messages = " ".join(finding["message"] for finding in report["findings"])
        self.assertIn("surface speed", messages)
        self.assertIn("speed limit", messages)

    def test_a_selection_counts_from_the_line_the_selection_started_on(self):
        self.assertEqual(self.report_of("fanuc-selection")["rows"][0]["line"], 41)

    def test_the_feed_and_speed_columns_can_be_switched_off(self):
        report = self.report_of("fanuc-no-feed-speed")
        self.assertEqual([column["key"] for column in report["columns"]], ["tool", "description", "line", "calls"])
        self.assertNotIn("feed", report["rows"][0])

    def test_a_program_without_a_tool_change_says_so_instead_of_failing(self):
        report = self.report_of("fanuc-no-tools")
        self.assertEqual(report["rows"], [])
        self.assertEqual(report["message"], "No tool changes found.")

    def test_a_turret_lathe_program_says_why_its_tool_list_is_empty(self):
        # G8 M4. A turret lathe changes tool with a bare `T0101`; the shipped Fanuc
        # profile reads a tool change as `M6`, which such a program never writes. The
        # report was empty and said "No tool changes found.", which reads as "this
        # program uses no tools" — on a program with six tool words in it.
        report = self.report_of("fanuc-lathe-turret")
        self.assertEqual(report["rows"], [])
        self.assertIn("No tool change found, but 6 tool words were seen", report["message"])
        self.assertIn("needs a lathe profile", report["message"])
        finding = report["findings"][0]
        self.assertEqual(finding["severity"], "warning")
        self.assertEqual(finding["line"], 7)
        self.assertIn("M6", finding["message"])

    def test_a_program_with_neither_tools_nor_tool_words_is_not_blamed_on_the_profile(self):
        # The two empty reports have to stay apart: this one really uses no tools.
        self.assertEqual(self.report_of("fanuc-no-tools")["findings"], [])

    def test_a_tool_change_without_a_number_is_a_warning_and_not_a_row(self):
        report = self.report_of("fanuc-tool-change-without-number")
        self.assertEqual(report["rows"], [])
        self.assertEqual(report["findings"][0]["severity"], "warning")


class TestHeader(unittest.TestCase):
    """The `# /// gedit` block, read the way `src-tauri/src/scripts/meta.rs` reads it.

    The backend parses it as TOML and hands the result to the webview as `ScriptMeta`
    (plan §7.6), so a header that does not parse, or a parameter that is not shaped like a
    `FieldSpec` (§7.5), breaks the script's form without breaking any Python.
    """

    FIELD_TYPES = ("number", "integer", "text", "bool", "choice", "file", "folder", "address-list")

    def header_source(self):
        """The header block with its `# ` prefix removed, as the backend does it."""
        lines = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8").split("\n")
        i = 1 if lines[0].startswith("#!") else 0
        self.assertEqual(lines[i].strip(), "# /// gedit")
        body = []
        i += 1
        while lines[i].strip() != "# ///":
            self.assertTrue(lines[i].startswith("#"), lines[i])
            body.append(lines[i][2:] if lines[i].startswith("# ") else lines[i][1:])
            i += 1
        return "\n".join(body)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_header_is_the_toml_the_backend_expects(self):
        import tomllib

        meta = tomllib.loads(self.header_source())
        self.assertEqual(meta["name"], "Tool list")
        self.assertEqual(meta["output"], "report")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertNotIn("envelope", meta)  # a report is not an envelope

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_every_parameter_is_shaped_like_a_field_spec(self):
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        self.assertEqual([param["id"] for param in params], ["description", "dropLeadingZeros", "feedSpeed"])
        for param in params:
            with self.subTest(param=param["id"]):
                self.assertIn(param["type"], self.FIELD_TYPES)
                self.assertTrue(param["label"])
                self.assertIn("default", param)
                if param["type"] == "choice":
                    self.assertTrue(param["choices"])
                    for choice in param["choices"]:
                        self.assertEqual(sorted(choice), ["label", "value"])
                    values = [choice["value"] for choice in param["choices"]]
                    self.assertIn(param["default"], values)


class TestRunEnvironment(unittest.TestCase):
    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self):
        result = helpers.run_script(SCRIPT, stdin="T1 M6\n", context=None)
        self.assertFalse(result.ok)
        self.assertEqual(result.stdout, "")
        self.assertIn("profile", result.stderr)

    def test_a_profile_it_cannot_compile_is_a_message_and_not_a_traceback(self):
        profile = helpers.load_profile("fanuc-gcode")
        profile["toolCall"]["trigger"] = "M0*6(?!\\d"
        context = helpers.make_context(profile=profile, codes=[])
        result = helpers.run_script(SCRIPT, stdin="T1 M6\n", context=context)
        self.assertFalse(result.ok)
        self.assertIn("toolCall.trigger", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_an_empty_document_is_an_empty_list(self):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(profile=profile, codes=helpers.load_codes(profile))
        result = helpers.run_script(SCRIPT, stdin="", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["rows"], [])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
