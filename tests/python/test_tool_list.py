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

And the two WP5.4 added, both about a range that would otherwise carry a number that is
not what the column says it is:

* a selection under a `G95` set above it inherits the feed mode, because its case folder
  carries a `preceding.nc` (`input.precedingLines`, plan section 7.5) —
  `fanuc-selection-primed`
* the `F` of a block whose code is a threading cycle somewhere else stays out
  of the feed range (`fanuc-lathe-ambiguous`)
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
    "fanuc-lathe-ambiguous",
    "fanuc-lathe-turret",
    "fanuc-packed",
    "fanuc-preselect",
    "fanuc-selection-primed",
    "klartext-names",
    "klartext-numbers",
    "klartext-speed-only",
    # M6 (WP6.6): the turret, read with the lathe profile.
    "lathe-offsets",
    "lathe-system-b",
    "lathe-turning",
]


def context_of(case):
    """The `ScriptContextV2` a case runs with: the **effective** profile and machine.

    The app never hands a script a profile on its own. It hands it the effective view of the
    document — the profile with the chosen machine's variants, number reading and power-on
    state applied, the database that goes with it, and the machine block beside it (plan
    §7.15, AD-31). A case that names a `machine` in its `case.json` therefore runs against
    the generated `tests/fixtures/resolved/effective/**` entry for exactly those parameters,
    written once by `tests/unit/resolved.test.ts`: **Python never merges a machine into a
    profile**, because two implementations of one merge is how the two sides start
    disagreeing quietly. A case without one runs with the profile's own defaults, which is
    what "no machine" means.

    `machineName` in a `case.json` is the name that machine carries in the run. The
    generator calls every machine it writes `review`; a golden message is easier to read,
    and to check by hand, with the name a user would have given it, and the name changes
    nothing but the sentence it appears in.
    """
    context = case.context()
    if isinstance(case.options.get("machine"), dict):
        effective = helpers.effective_context(golden=case.directory / "case.json")
    else:
        effective = helpers.effective_context(case.profile_id)
    context["profile"] = effective["profile"]
    context["codes"] = effective["codes"]
    context["machine"] = dict(effective["machine"])
    name = case.options.get("machineName")
    if isinstance(name, str) and name != "":
        context["machine"]["id"] = name.lower().replace(" ", "-")
        context["machine"]["name"] = name
    context.pop("machineName", None)
    return context


def run_case(case):
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))


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
        # G8 M4. A turret lathe changes tool with a bare `T0101`; the mill profile reads a
        # tool change as `M6`, which such a program never writes. The report was empty and
        # said "No tool changes found.", which reads as "this program uses no tools" — on a
        # program with six tool words in it. M6: the lathe profile exists now, so the
        # sentence says to open the program with it instead of that gEdit has none.
        report = self.report_of("fanuc-lathe-turret")
        self.assertEqual(report["rows"], [])
        self.assertIn("No tool change found, but 6 tool words were seen", report["message"])
        self.assertIn("belongs to a lathe profile", report["message"])
        finding = report["findings"][0]
        self.assertEqual(finding["severity"], "warning")
        self.assertEqual(finding["line"], 7)
        self.assertIn("M6", finding["message"])
        self.assertIn("open this program with a lathe profile", finding["message"])

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


class TestModalStateOfASelection(unittest.TestCase):
    """A range only means something inside one mode, and the mode may be set above.

    A report is not an edit, so a wrong number here does not damage the program — it tells
    a machinist that a tool runs between 0.12 and 300 mm/min when half of that range is
    millimetres per revolution. Priming (`gedit_nc.prime_tracker`) keeps the two apart.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("tool_list") if case.name == name)

    def test_a_selection_under_a_feed_mode_set_above_it_keeps_it_out_of_the_range(self):
        case = self.case("fanuc-selection-primed")
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        report = result.json()
        self.assertEqual(report, case.expected_json())
        self.assertEqual(report["rows"][0]["feed"], "300.")
        self.assertIn("is in G95, not per minute", report["findings"][0]["message"])

    def test_without_the_lines_above_it_the_per_revolution_feeds_widen_the_range(self):
        case = self.case("fanuc-selection-primed")
        context = context_of(case)
        context["input"] = {
            key: value for key, value in context["input"].items() if key != "precedingLines"
        }
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        report = result.json()
        self.assertEqual(report["rows"][0]["feed"], "0.12-300.")
        self.assertEqual(report["findings"], [])

    def test_the_lines_above_a_selection_are_not_scanned_for_tool_calls(self):
        """They prime the modal state and nothing else.

        A tool changed above the selection is not called inside it, so a row for it would
        report a tool the user did not select.
        """
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            profile=profile,
            codes=helpers.load_codes(profile),
            input={
                "scope": "selection",
                "startLine": 3,
                "endLine": 4,
                "precedingLines": ["(T9  A TOOL ABOVE THE SELECTION)", "T9 M6"],
            },
        )
        result = helpers.run_script(SCRIPT, stdin="T4 M6\nG1 Z-1. F250.", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual([row["tool"] for row in result.json()["rows"]], ["T4"])


class TestAmbiguousThreadingCodes(unittest.TestCase):
    """`pitchFeedAmbiguous` (G8 M4 finding 7) on the report side.

    `G76` is a fine boring cycle on the shipped mill dialect and a multi-pass threading
    cycle on a lathe in G-code system A, where its `F` is the thread lead. Nothing in the
    block says which, and gEdit ships no lathe profile, so the value stays out of the feed
    range and is named — the same direction `scale_feed.py` takes when it refuses to scale
    it. A range is a number a machinist reads off and uses.
    """

    def report_of(self, program):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(profile=profile, codes=helpers.load_codes(profile))
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_the_f_of_an_ambiguous_block_is_not_in_the_feed_range(self):
        case = next(c for c in helpers.script_cases("tool_list") if c.name == "fanuc-lathe-ambiguous")
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        report = result.json()
        self.assertEqual(report, case.expected_json())
        self.assertEqual(report["rows"][0]["feed"], "0.25")
        self.assertIn("may be a thread lead", report["findings"][0]["message"])

    def test_a_non_modal_ambiguity_ends_with_its_own_block(self):
        # G92 is non-modal: the block after it is an ordinary move again, and its feed is
        # an ordinary feed.
        report = self.report_of("T1 M6\nG92 X19.5 F2.0\nG1 X30. F400.\n")
        self.assertEqual(report["rows"][0]["feed"], "400.")
        self.assertEqual(len(report["findings"]), 1)
        self.assertIn("may be a thread lead", report["findings"][0]["message"])


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


class TestLathe(unittest.TestCase):
    """The turret (M6, WP6.6): stations, offsets, and the units a range is in.

    On a lathe the `T` word is the tool change and carries two things at once, the station
    and the offset it runs with; there is no `M6`. All of that is the profile's
    (`toolCall.trigger`, `toolCall.ignore`, the `tool` group), so the same script reads a
    turning program as soon as the document has the lathe profile — and a variant, or a
    later `toolCall` overlay, needs no change here either (plan §7.1, AD-31).
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("tool_list") if case.name == name)

    def report(self, name):
        case = self.case(name)
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload, case.expected_json())
        return payload

    def rows(self, name):
        return self.report(name)["rows"]

    def keys(self, name):
        return [column["key"] for column in self.report(name)["columns"]]

    def test_the_station_is_the_profiles_tool_group_and_not_the_whole_word(self):
        # `T0101` is station 1 with offset 01. The profile's `tool` pattern says which
        # digits are the station; this script counts rows per station, so the three tools
        # of the program are three rows and not six.
        self.assertEqual([row["tool"] for row in self.rows("lathe-turning")], ["T1", "T3", "T5"])
        self.assertEqual([row["line"] for row in self.rows("lathe-turning")], [10, 28, 47])

    def test_an_offset_cancel_is_not_a_tool_change(self):
        # `G00 X100. Z100. T0100` retracts with the offset of station 1 cancelled. Counting
        # it would put a call — and on a program that ends every tool that way, a whole row
        # — in the list for a block that changes no tool (`toolCall.ignore`).
        self.assertEqual([row["calls"] for row in self.rows("lathe-turning")], [1, 1, 1])

    def test_the_offsets_column_lists_the_offsets_a_station_was_called_with(self):
        # Every turret spelling of one station: `T0101`, `T101`, `T1` and `T0111`.
        rows = self.rows("lathe-offsets")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["tool"], "T1")
        self.assertEqual(rows[0]["calls"], 4)
        self.assertEqual(rows[0]["offsets"], "01, 11")

    def test_a_milling_report_has_no_offsets_column(self):
        # The column is the turret's. A mill's `T` word is the station and nothing else, so
        # the column would be an empty one in every row.
        self.assertNotIn("offsets", self.keys("fanuc-preselect"))
        self.assertIn("offsets", self.keys("lathe-turning"))

    def test_the_turret_warning_is_only_on_a_milling_profile(self):
        """The same program, twice: once as a mill would read it, once as what it is.

        Opened with the mill profile a turning program has no tool change at all, and the
        report says so and where the program belongs. Opened with the lathe profile the
        bare `T` word **is** the tool change, so there is nothing to warn about.
        """
        mill = self.report("fanuc-lathe-turret")
        self.assertEqual(mill["rows"], [])
        self.assertIn("belongs to a lathe profile", mill["message"])
        lathe = self.report("lathe-turning")
        self.assertEqual(lathe["message"], "3 tools")
        for finding in lathe["findings"]:
            self.assertNotIn("lathe profile", finding["message"])

    def test_the_feed_range_is_in_the_unit_the_control_powers_on_in(self):
        """0.12-0.25 mm per revolution, not "no feeds found".

        A range only means something inside one unit, and Phase 1 fixed that unit at feed
        per minute because a milling control powers on there. A turning control powers on in
        feed per revolution (`G99`), so that is what its ranges are in — otherwise every
        feed of every turning program would be left out of the column and explained in a
        finding. The unit is written next to the range, because the same digits read as
        millimetres per minute would be nonsense.
        """
        rows = self.rows("lathe-turning")
        self.assertEqual(rows[0]["feed"], "0.12-0.25 /rev")
        self.assertEqual(rows[2]["feed"], "0.08 /rev")

    def test_a_thread_lead_is_not_a_feed_in_any_unit(self):
        payload = self.report("lathe-turning")
        self.assertEqual(payload["rows"][1]["feed"], "", "the thread tool has no feed range")
        pitch = [f for f in payload["findings"] if "thread pitch" in f["message"]]
        self.assertEqual(len(pitch), 1)
        self.assertEqual(pitch[0]["line"], 33)
        self.assertIn("the F of 3 blocks", pitch[0]["message"])

    def test_a_surface_speed_range_says_that_it_is_one(self):
        # 220 m/min and 220 rpm are not the same number, and a column that showed both as
        # `220` would be read as whichever the reader expected.
        rows = self.rows("lathe-turning")
        self.assertEqual(rows[0]["speed"], "220 surface")
        self.assertEqual(rows[1]["speed"], "1200")

    def test_the_clamp_is_not_a_speed_in_either_g_code_system(self):
        for name, line in (("lathe-turning", 11), ("lathe-system-b", 8)):
            with self.subTest(case=name):
                payload = self.report(name)
                limits = [f for f in payload["findings"] if "speed limit" in f["message"]]
                self.assertEqual([f["line"] for f in limits], [line])
                self.assertNotIn("2500", payload["rows"][0]["speed"])
                self.assertNotIn("2200", payload["rows"][0]["speed"])

    def test_system_b_is_read_with_its_own_database(self):
        rows = self.rows("lathe-system-b")
        self.assertEqual([row["tool"] for row in rows], ["T2", "T4"])
        self.assertEqual([row["offsets"] for row in rows], ["02", "04"])
        self.assertEqual(rows[0]["feed"], "0.3 /rev")
        # `G78` is the threading cycle of system B: its F is the lead, so T4 has no range.
        self.assertEqual(rows[1]["feed"], "")
