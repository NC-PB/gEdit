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

And the turning dialects of M8 (WP8.7):

* `okuma-turret` — four- and six-digit `T` words (the station is the middle pair of
  `T010101`), a `T` inside a `G74` block that only switches the offset, an offset change
  of the same station, the speed a post writes **before** it indexes the turret (it belongs
  to the new tool), a dwell and a thread lead kept out of the feed range, and a driven tool
  whose `SB=` speed is not the main spindle's
* `sinumerik-tools` — `T1`, `T0` (no tool), `T="NAME"`, `T1=5` (the tool of spindle 1),
  a message that names the tool, dwells kept out of the ranges and `LIMS=` kept out of the
  speed range; `S1=900` is the speed of spindle 1, the main spindle, so it is the drill's
  speed (M10 P10, the owner's reading of 2026-09-27; until M10 it was kept out too)

And the M8 NC review (G10), each with the program the review ran:

* `sinumerik-tool-names` — `T="007"` is a tool name and `T2=7` tool number 7: two rows,
  and the name keeps its zeros and its quotation marks
* `sinumerik-feed-type` — `G96` makes the feed a feed per revolution on this control, and
  after `G95` an `S` is revolutions per minute again

And the M9 review:

* `sinumerik-indexed-spindles` — `S[2]=500`, `M[2]=3` and `LIMS[2]=1800` name spindle 2,
  so none of them is in the main spindle's speed range (F1)
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
    "fanuc-lathe-five-digit",
    "fanuc-lathe-turret",
    "fanuc-packed",
    "fanuc-preselect",
    "fanuc-selection-primed",
    "klartext-names",
    "klartext-numbers",
    "klartext-sister-tool",
    "klartext-speed-only",
    # M6 (WP6.6): the turret, read with the lathe profile.
    "lathe-offsets",
    "lathe-system-b",
    "lathe-turning",
    # M8 (WP8.7): the turning dialects.
    "okuma-dollar-continuation",
    "okuma-turret",
    "sinumerik-tools",
    # The M8 NC review.
    "sinumerik-feed-type",
    "sinumerik-tool-names",
    # M9 (WP9.5a): the surface-speed tag carries its unit and the code that set it.
    "sinumerik-g961",
    "lathe-inch-surface",
    # The M9 review (F1): indexed spindle words are another spindle's.
    "sinumerik-indexed-spindles",
    # M12 (WP12.6): the list per channel.
    "channels-alternating",
    "channels-multi-file",
    "channels-selection",
    "channels-two-section",
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
        # `TOOL CALL Z S5000` and `TOOL CALL S6000 F900` have no tool number at all;
        # `TOOL CALL 4 S6500` repeats the tool already in the spindle with no axis
        # (syntax-heidenhain §5.1). None of the three starts a second call.
        report = self.report_of("klartext-speed-only")
        self.assertEqual(len(report["rows"]), 1)
        self.assertEqual(report["rows"][0]["calls"], 1)
        # The speed range still covers every `TOOL CALL`, because the tool did not change.
        self.assertEqual(report["rows"][0]["speed"], "3000-6500")

    def test_a_klartext_tool_call_with_the_axis_is_a_real_second_call(self):
        # Same tool number as before, but this time with its axis: the control may swap
        # in a sister tool (syntax-heidenhain §5.1), so this one does start a second call.
        report = self.report_of("klartext-sister-tool")
        self.assertEqual(len(report["rows"]), 1)
        self.assertEqual(report["rows"][0]["calls"], 2)

    def test_a_five_digit_fanuc_lathe_t_word_is_a_3_digit_tool_and_a_2_digit_offset(self):
        # Owner decision 3 (2026-09-27), since M12.5 the ``offset2`` machine setting (the
        # case's machine states it): T12345 = tool 123, offset 45. T12300 cancels that
        # offset the same way T0100 cancels station 1's, and a six-digit word is outside
        # every Fanuc lathe T-word rule, so it is never read as a tool change at all.
        report = self.report_of("fanuc-lathe-five-digit")
        self.assertEqual(len(report["rows"]), 1)
        row = report["rows"][0]
        self.assertEqual(row["tool"], "T123")
        self.assertEqual(row["offsets"], "45")
        self.assertEqual(row["calls"], 1)

    def run_text(self, profile_id, program, variant=None):
        context = (
            helpers.effective_context(profile_id)
            if variant is None
            else helpers.effective_context(profile_id, variant=variant)
        )
        full = helpers.make_context(profile=context["profile"], codes=context["codes"])
        full["machine"] = context["machine"]
        result = helpers.run_script(SCRIPT, stdin=program, context=full)
        self.assertTrue(result.ok, result.stderr)
        return result.json()["rows"]

    def test_a_five_digit_lathe_word_without_a_machine_is_a_2_digit_tool_and_a_3_digit_offset(self):
        # M12.5 decision 1 (the owner, 2026-10-08): ``byLength``, the default. The same
        # program under the case's 3 + 2 machine lists T123.
        rows = self.run_text("fanuc-lathe", "O2003\nN10 T12345 M8\nN20 G97 S1200 M03\nN30 G00 X100. Z100. T12000\nN40 M30\n")
        self.assertEqual([(row["tool"], row["offsets"], row["calls"]) for row in rows], [("T12", "345", 1)])

    def test_a_zero_offset_lathe_word_with_m6_loads_the_milling_spindle(self):
        # M12.5 decision 1: ``M06 T21000`` is tool 21 on every choice that reads 2 + 3; the
        # same word without ``M6`` stays an offset cancel.
        rows = self.run_text("fanuc-lathe", "O2004\nN10 M06 T21000\nN20 G1 X10. F100.\nN30 T21000\nN40 T0100\nN50 M30\n")
        self.assertEqual([(row["tool"], row["line"], row["calls"]) for row in rows], [("T21", 2, 1)])

    def test_a_lathe_t_inside_a_three_digit_g_block_is_no_tool_change(self):
        # M12.5 decision 1: a builder cycle's ``T`` is a parameter, on every ``toolWord`` choice.
        for variant in (None, ("toolWord", "offset2"), ("toolWord", "offset1"), ("toolWord", "offset3")):
            # `T0505` is tool 0 under `offset3` (2 + 3), which is no tool: there `T05005`.
            first = "T05005" if variant == ("toolWord", "offset3") else "T0505"
            program = "O2005\nN10 %s\nN20 G183 Z-5. T5 F20\nN30 G150 X10. T0707\nN40 M30\n" % first
            with self.subTest(variant=variant):
                rows = self.run_text("fanuc-lathe", program, variant)
                self.assertEqual([row["calls"] for row in rows], [1])
                self.assertEqual([row["line"] for row in rows], [2])

    def test_a_klartext_tool_call_by_name_at_the_end_of_the_line_is_a_tool_change(self):
        # M12.5: the trailing ``\b`` after a closing quote never matched at the line end.
        program = '0 BEGIN PGM DEMO MM\n1 TOOL CALL "END MILL 10"\n2 TOOL CALL "END MILL 10" Z S3000\n3 END PGM DEMO MM\n'
        rows = self.run_text("heidenhain-klartext", program)
        self.assertEqual([(row["tool"], row["line"], row["calls"]) for row in rows], [("END MILL 10", 2, 2)])

    def test_a_klartext_tool_name_with_a_digit_straight_behind_it_is_still_a_tool_change(self):
        # M12.5 review: the guard belongs on the axis letter, not on the name; and behind a
        # tool number with more than one decimal the tool is the whole number, not `5.1`.
        program = '0 BEGIN PGM DEMO MM\n1 TOOL CALL "D10"5 Z S3000\n2 TOOL CALL 5 ZS3000\n3 TOOL CALL 7.12 Z\n4 END PGM DEMO MM\n'
        rows = self.run_text("heidenhain-klartext", program)
        self.assertIn(("D10", 2), [(row["tool"], row["line"]) for row in rows])
        self.assertIn(("T5", 3), [(row["tool"], row["line"]) for row in rows])
        self.assertIn(("T7", 4), [(row["tool"], row["line"]) for row in rows])
        self.assertNotIn("T7.1", [row["tool"] for row in rows])

    def test_a_lathe_word_whose_tool_part_is_all_zeros_is_no_tool(self):
        # M12.5 review: `T00100` keeps the tool and changes the offset, on every choice; under
        # `offset3` (2 + 3) so do `T0101` and `T0100`.
        program = "O2006\nN10 T00100\nN20 T0001\nN30 T00012\nN40 M30\n"
        self.assertEqual(self.run_text("fanuc-lathe", program), [])
        program = "O2007\nN10 T0101\nN20 G28 U0 T0100\nN30 T00100\nN40 T01001\nN50 M30\n"
        rows = self.run_text("fanuc-lathe", program, ("toolWord", "offset3"))
        self.assertEqual([row["line"] for row in rows], [5])

    def test_a_lathe_t_in_a_block_of_the_controls_own_three_digit_g_codes_is_a_tool_change(self):
        # M12.5 review: `G107`, `G112`, `G113`, `G250` and `G251` are the control's own
        # three-digit codes (the user manual's lathe G-code table), not builder cycles.
        program = "O2008\nN10 G112 T0101\nN20 G250 T0202\nN30 G500 T0303\nN40 M30\n"
        rows = self.run_text("fanuc-lathe", program)
        self.assertEqual([row["line"] for row in rows], [2, 3])

    def test_an_okuma_dollar_continuation_carries_the_thread_lead_of_the_block_above_it(self):
        # G10 M8: `$` continues the block above it (`gedit_nc.continues_block`), so the F
        # on that line is still the G71 cycle's lead and stays out of the feed range.
        report = self.report_of("okuma-dollar-continuation")
        self.assertEqual(report["rows"][0]["feed"], "0.2 /rev")
        self.assertTrue(any("thread pitch" in finding["message"] for finding in report["findings"]))

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

    # Review finding NC7 (2026-09): `T0` preselected and `M6` alone below it unloads the
    # spindle, as `M6 T0` on one line does; it is no tool T0.
    def test_an_unload_split_over_two_lines_is_no_tool(self):
        report = self.report_of("fanuc-unload-split")
        self.assertEqual([(row["tool"], row["line"]) for row in report["rows"]], [("T1", 3), ("T2", 8), ("T3", 12)])
        self.assertEqual(report["message"], "3 tools")

    # Review finding NC2 (2026-09): `Decimal(raw)` refused a Klartext decimal comma, so the
    # feed and speed columns of such a tool went blank.
    def test_a_klartext_comma_feed_and_speed_are_listed(self):
        rows = self.report_of("klartext-decimal-comma")["rows"]
        self.assertEqual([(row["tool"], row["feed"], row["speed"]) for row in rows], [
            ("T5", "500,5-1000,", "5000,5"),
            ("T6", "400,25", "3000"),
        ])

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

    def test_the_first_t_of_a_block_with_two_is_the_tool_loaded(self):
        """Owner decision of 2026-10-08 (M9-1): `T01 T00 M6` loads tool 1; only a block
        whose first `T` is zero is an unload. The program map reads the same rule
        (`outline.test.ts`)."""
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(profile=profile, codes=helpers.load_codes(profile))
        program = "T01 T00 M6\nG1 X1. F100.\nT00 T02 M6\nT2 T5 M6\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual([(row["tool"], row["line"]) for row in result.json()["rows"]], [("T1", 1), ("T2", 4)])


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
        self.assertEqual(rows[0]["speed"], "220 m/min (G96)")
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


class TestTurningDialects(unittest.TestCase):
    """Okuma OSP and Sinumerik turning (M8, WP8.7): stations, offsets and whose speed it is.

    The stations and offsets come from the profile's tool rule; the feeds and speeds are the
    same words scale-feed and scale-speed read, with the same exclusions: a dwell is no feed
    and no speed, a clamp word and another spindle's speed are not the main spindle's `S`.
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
        return {row["tool"]: row for row in self.report(name)["rows"]}

    def test_the_station_of_a_six_digit_t_word_is_its_middle_pair(self):
        # `T010101` is nose-radius set 01, station 01, offset 01; `T001111` station 11.
        rows = self.rows("okuma-turret")
        self.assertEqual(list(rows), ["T1", "T2", "T7", "T11", "T12"])
        self.assertEqual(rows["T11"]["offsets"], "11")

    def test_a_t_word_inside_a_cycle_block_is_no_second_call(self):
        # `G74 … T0203` switches the offset for the cycle's end point (`toolCall.ignore`).
        self.assertEqual(self.rows("okuma-turret")["T2"]["calls"], 1)

    def test_an_offset_change_of_the_same_station_is_one_row_with_both_offsets(self):
        row = self.rows("okuma-turret")["T7"]
        self.assertEqual((row["calls"], row["offsets"]), (2, "07, 08"))

    def test_a_speed_written_before_the_turret_indexes_belongs_to_the_new_tool(self):
        # `G97 S1500 M03` then `T0202`, the order the Okuma notes show: no axis moves in
        # between, so the speed is the drill's, not the roughing tool's.
        rows = self.rows("okuma-turret")
        self.assertEqual(rows["T1"]["speed"], "180 m/min (G96)")
        self.assertEqual(rows["T2"]["speed"], "1500")

    def test_the_same_holds_on_a_fanuc_lathe(self):
        context = helpers.effective_context("fanuc-lathe")
        program = (
            "T0101\nG96 S200 M03\nG00 X50. Z2.\nG01 Z-20. F0.25\nG00 X100. Z100.\n"
            "G97 S1200 M03\nT0303\nG00 X0. Z2.\nG01 Z-10. F0.1\nM30\n"
        )
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        rows = {row["tool"]: row for row in result.json()["rows"]}
        self.assertEqual((rows["T1"]["speed"], rows["T3"]["speed"]), ("200 m/min (G96)", "1200"))

    def test_a_dwell_is_in_no_range(self):
        # Okuma `G04 F1` after the drill's feed; Sinumerik `G4 F1.5` and `G4 S2` after the
        # roughing tool's.
        self.assertEqual(self.rows("okuma-turret")["T2"]["feed"], "0.12 /rev")
        row = self.rows("sinumerik-tools")["T1"]
        self.assertEqual((row["feed"], row["speed"]), ("0.3 /rev", "180 m/min (G96)"))

    def test_driven_tool_and_numbered_spindle_speeds_are_not_the_main_spindle_speed(self):
        self.assertEqual(self.rows("okuma-turret")["T11"]["speed"], "")

    def test_a_word_that_names_the_main_spindle_is_its_speed(self):
        # M10 P10 (decision 3; the owner, 2026-09-27: "we consider S1= as main spindle"):
        # `S1=900` and `S[1]=900` drive spindle 1, the profile's `addresses.mainSpindle`, so
        # they are the tool's speed like a plain `S`; `S2=` and `S[2]=` stay another
        # spindle's. Until M10 the drill below showed no speed at all.
        self.assertEqual(self.rows("sinumerik-tools")["T5"]["speed"], "900")
        context = helpers.effective_context("sinumerik")
        program = (
            "T1 D1\nG97 S1=800 M1=3\nG1 X10 F0.1\nT2 D1\nG97 S[1]=700 M3\nG1 X10 F0.1\n"
            "T3 D1\nG97 S2=600 M2=3\nG1 X10 F0.1\nT4 D1\nG97 S[2]=500 M3\nG1 X10 F0.1\nM30\n"
        )
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        speeds = {row["tool"]: row["speed"] for row in result.json()["rows"]}
        self.assertEqual(speeds, {"T1": "800", "T2": "700", "T3": "", "T4": ""})
        # A profile that names no main spindle has none: there `S1=` stays another spindle's.
        profile = dict(context["profile"])
        profile["addresses"] = {k: v for k, v in profile["addresses"].items() if k != "mainSpindle"}
        result = helpers.run_script(SCRIPT, stdin=program, context=dict(context, profile=profile))
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual([row["speed"] for row in result.json()["rows"]], ["", "", "", ""])

    def test_an_indexed_spindle_word_is_not_the_main_spindle_speed(self):
        # M9 review F1: `S[2]=500` was read as the main spindle's `S`, so the roughing tool
        # showed 200-500 m/min. Like `S2=`, the index names spindle 2.
        row = self.rows("sinumerik-indexed-spindles")["T1"]
        self.assertEqual((row["feed"], row["speed"]), ("0.2-0.25 /rev", "200 m/min (G96)"))

    def test_a_travel_time_is_in_no_feed_range(self):
        # M9 review F8: the F of a G931 block is the time the move takes, not a feed.
        context = helpers.effective_context("sinumerik-mill")
        program = "T1 D1\nM6\nG94 S1000 M3\nG1 X10 F100\nG931 G1 X20 F3\nG94 G1 X30 F150\nM30\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["rows"][0]["feed"], "100-150")
        self.assertIn("in G931", payload["findings"][0]["message"])

    def test_every_sinumerik_tool_form_is_read(self):
        # `T0 D0` deselects, `T="…"` names, `T1=5` is tool 5 of spindle 1; a message that
        # names a tool describes it.
        rows = self.report("sinumerik-tools")["rows"]
        self.assertEqual([row["tool"] for row in rows], ["T1", "FINISH_35", "T5", "PARTOFF"])
        self.assertEqual(rows[0]["description"], "ROUGH")
        self.assertNotIn("offsets", [column["key"] for column in self.report("sinumerik-tools")["columns"]])

    def test_a_tool_name_made_of_digits_is_not_a_tool_number(self):
        # With tool management `T="007"` names a tool and `T2=7` is tool 7: a name is never
        # stripped of its zeros or merged with a number, and it keeps its quotation marks
        # where it would otherwise read as the number it is not.
        rows = self.report("sinumerik-tool-names")["rows"]
        self.assertEqual([(row["tool"], row["calls"], row["line"]) for row in rows], [("T7", 1, 1), ('"007"', 1, 3)])
        helpers.import_gedit_nc()
        import tool_list

        spec = tool_list.Spec(helpers.import_gedit_nc().compile_profile(helpers.load_profile("sinumerik")), {})
        self.assertIsNone(tool_list.tool_number_of('"007"', spec))
        self.assertEqual(tool_list.tool_label('"Rough_80"', spec), "Rough_80")
        self.assertEqual(tool_list.tool_label('"007"', spec), '"007"')

    def test_the_feed_type_decides_the_unit_of_a_range(self):
        rows = self.rows("sinumerik-feed-type")
        self.assertEqual(rows["ROUGH_80"]["feed"], "0.25-0.3 /rev")
        self.assertEqual(rows["FINISH"]["speed"], "1800")
        # M13 review NC-13: a range in another unit than the program's own says which.
        self.assertEqual(rows["DRILL_D8"]["feed"], "120 /min")


class TestSurfaceSpeedTag(unittest.TestCase):
    """M9 (WP9.5a, TODO "Script texts"): a surface-speed range says its unit and its code.

    "surface" named neither, and the finding said "(G96)" of a Sinumerik `G961`. Both now
    come from the code database (`sets.speedUnit`, `sets.units`) and the document's machine.
    """

    def report(self, name):
        case = next(case for case in helpers.script_cases("tool_list") if case.name == name)
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload, case.expected_json())
        return payload

    def test_the_code_that_set_the_surface_speed_is_named(self):
        rows = {row["tool"]: row for row in self.report("sinumerik-g961")["rows"]}
        self.assertEqual(rows["FACE_80"]["speed"], "150 m/min (G961)")
        self.assertEqual(rows["FACE_80"]["feed"], "120 /min")  # G961 is a feed per minute (NC-13: said)
        self.assertEqual(rows["DRILL_D8"]["speed"], "1800")

    def test_an_inch_program_reads_its_surface_speeds_in_feet_per_minute(self):
        rows = self.report("lathe-inch-surface")["rows"]
        self.assertEqual(rows[0]["speed"], "600 ft/min (G96)")

    def test_a_surface_speed_left_out_of_a_range_is_named_with_its_unit_and_code(self):
        findings = self.report("fanuc-feed-modes")["findings"]
        texts = [f["message"] for f in findings if "surface speed" in f["message"]]
        self.assertEqual(texts, ["T2: the S of 1 block is a surface speed in m/min (G96), not a spindle speed, so it is not in the range."])

    def test_the_machine_units_are_where_the_program_starts(self):
        case = next(case for case in helpers.script_cases("tool_list") if case.name == "lathe-turning")
        context = context_of(case)
        context["machine"] = dict(context["machine"])
        context["machine"]["params"] = dict(context["machine"]["params"], units="inch")
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        # lathe-turning writes G21, so its own code wins over the machine's power-on units.
        self.assertEqual(result.json()["rows"][0]["speed"], "220 m/min (G96)")
        program = "\n".join(line for line in case.input_text().split("\n") if not line.startswith("G21"))
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertEqual(result.json()["rows"][0]["speed"], "220 ft/min (G96)")


class TestChannels(unittest.TestCase):
    """M12 (WP12.6, AD-32): a turret's tools are that turret's."""

    def report_of(self, name):
        case = next(case for case in helpers.script_cases("tool_list") if case.name == name)
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def run_golden(self, golden, program):
        """The tool list of a channel program with the context the app builds for it."""
        base = helpers.FIXTURES_DIR / "channels"
        context = helpers.channel_context(base / "resolve" / golden)
        result = helpers.run_script(SCRIPT, stdin=helpers.read_text(base / "nc" / "fanuc-lathe" / program), context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json(), context

    def test_a_channel_column_comes_first_and_the_rows_are_grouped_by_channel(self):
        report = self.report_of("channels-alternating")
        self.assertEqual([column["key"] for column in report["columns"]][:2], ["channel", "tool"])
        self.assertEqual(
            [(row["channel"], row["tool"]) for row in report["rows"]],
            [("Channel 1", "T1"), ("Channel 1", "T3"), ("Channel 2", "T2"), ("Outside the channels", "T9")],
        )

    def test_a_channels_rows_come_from_all_of_its_ranges_in_document_order(self):
        rows = self.report_of("channels-alternating")["rows"]
        # T1 is called in both sections of channel 1: one row, two calls, first call in the first.
        t1 = next(row for row in rows if row["tool"] == "T1")
        self.assertEqual((t1["calls"], t1["line"]), (2, 5))
        self.assertEqual(t1["feed"], "0.25-0.3 /rev")
        t2 = next(row for row in rows if row["tool"] == "T2")
        self.assertEqual((t2["calls"], t2["line"], t2["feed"]), (2, 9, "0.08-0.1 /rev"))

    def test_the_summary_names_the_channels(self):
        self.assertEqual(self.report_of("channels-two-section")["message"], "Channel 1: 1 tool; Channel 2: 1 tool")
        self.assertEqual(
            self.report_of("channels-alternating")["message"],
            "Channel 1: 2 tools; Channel 2: 1 tool; Outside the channels: 1 tool",
        )

    def test_the_header_tool_list_describes_a_tool_called_in_a_section(self):
        rows = self.report_of("channels-two-section")["rows"]
        self.assertEqual(rows[1]["description"], "CENTRE DRILL")

    def test_a_row_names_the_document_line_not_the_index_in_the_channel(self):
        rows = self.report_of("channels-alternating")["rows"]
        self.assertEqual([row["line"] for row in rows if row["channel"] == "Channel 2"], [9])

    def test_a_selection_lists_the_tools_of_each_channel_inside_it(self):
        report = self.report_of("channels-selection")
        self.assertEqual(
            [(row["channel"], row["tool"], row["line"]) for row in report["rows"]],
            [("Channel 1", "T1", 14), ("Channel 1", "T3", 16), ("Channel 2", "T2", 9)],
        )

    def test_a_one_file_per_channel_document_says_which_channel_it_is(self):
        report = self.report_of("channels-multi-file")
        self.assertEqual([column["key"] for column in report["columns"]][0], "tool")
        self.assertNotIn("channel", report["rows"][0])
        self.assertEqual(report["message"], "1 tool. This document is Channel 2; the other channels are separate runs.")

    def test_the_generated_context_of_the_alternating_program_groups_it_too(self):
        report, _ = self.run_golden("c10-alternating.json", "c10-alternating.nc")
        self.assertEqual(
            [(row["channel"], row["tool"], row["line"]) for row in report["rows"]],
            [("Channel 1", "T1", 7), ("Channel 1", "T3", 22), ("Channel 2", "T2", 15), ("Channel 2", "T4", 29)],
        )
        self.assertEqual(report["message"], "Channel 1: 2 tools; Channel 2: 2 tools")

    def test_the_generated_context_of_a_channel_file_names_the_channel(self):
        report, _ = self.run_golden("c06-part_CH1.json", "c06-part_CH1.nc")
        self.assertTrue(report["message"].endswith("This document is Channel 1; the other channels are separate runs."))
        self.assertNotIn("channel", report["rows"][0])

    def test_a_program_without_channels_is_listed_exactly_as_before(self):
        # c05 is read with a channel machine and has no section: the context carries no member,
        # and the report is the one the same run without any channel context gives.
        listed, context = self.run_golden("c05-one-channel.json", "c05-one-channel.nc")
        self.assertNotIn("channels", context)
        text = helpers.read_text(helpers.FIXTURES_DIR / "channels" / "nc" / "fanuc-lathe" / "c05-one-channel.nc")
        again = helpers.run_script(SCRIPT, stdin=text, context=dict(context))
        self.assertEqual(listed, again.json())
        self.assertEqual([column["key"] for column in listed["columns"]][0], "tool")
        self.assertNotIn("channel", listed["rows"][0])

    def test_a_context_that_says_none_changes_nothing(self):
        for case in helpers.script_cases("tool_list"):
            if case.name.startswith("channels-"):
                continue
            with self.subTest(case=case.name):
                context = context_of(case)
                context["channels"] = {"layout": "none", "list": [], "marks": []}
                result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
                self.assertEqual(result.json(), case.expected_json())


# The M13 review's lathe pair (NC-4): a main program, then a subprogram behind its `M30`
# that cuts with whatever tool calls it.
M13_MAIN = (
    "O1\nG21 G99\nT0101\nG97 S800 M03\nG00 X50. Z2.\nG01 Z-20. F0.25\nG00 X100. Z100.\n"
    "T0303\nG00 X42. Z5.\nG76 P010060 Q50 R0.02\nG76 X37.5 Z-22. P1500 Q400 F1.5\nG00 X100. Z100.\nM30\n"
)
M13_SUB = "O2\nG00 X37. Z-48.\nG01 Z-50. F0.08\nU2. W-1.\nM99\n"


class TestM13Review(unittest.TestCase):
    """The M13 review's tool-list findings (NC-4, NC-13), each pinned on a small program."""

    def report(self, profile_id, program):
        context = helpers.effective_context(profile_id)
        full = helpers.make_context(profile=context["profile"], codes=context["codes"])
        full["machine"] = context["machine"]
        result = helpers.run_script(SCRIPT, stdin=program, context=full)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_subprogram_behind_the_main_program_is_charged_to_no_tool(self):
        report = self.report("fanuc-lathe", M13_MAIN + M13_SUB)
        rows = {row["tool"]: row for row in report["rows"]}
        self.assertEqual(rows["T1"]["feed"], "0.25 /rev")
        self.assertEqual(rows["T3"]["feed"], "")  # not the edge break's F0.08
        called = [f for f in report["findings"] if f["message"].startswith("O2:")]
        self.assertEqual(len(called), 1)
        self.assertEqual(called[0]["line"], 14)
        self.assertEqual(called[0]["severity"], "info")
        self.assertIn("1 feed (F0.08) before any tool call", called[0]["message"])

    def test_a_subprogram_in_front_of_the_main_program_reads_as_before(self):
        report = self.report("fanuc-lathe", M13_SUB + M13_MAIN)
        self.assertEqual([(row["tool"], row["feed"]) for row in report["rows"]], [("T1", "0.25 /rev"), ("T3", "")])
        self.assertFalse([f for f in report["findings"] if "before any tool call" in f["message"]])

    def test_a_g33_feed_word_is_not_called_a_thread_pitch(self):
        program = (
            "%_N_T_MPF\nG18 G90 G95\nT=\"THREAD_M44\" D1\nG97 S600 M3\nG0 X48 Z5\n"
            "G33 Z-30 K1.5 SF=0 F0.15\nG0 X60\nM30\n"
        )
        report = self.report("sinumerik", program)
        messages = [f["message"] for f in report["findings"]]
        self.assertEqual(len(messages), 1)
        self.assertNotIn("thread pitch", messages[0])
        self.assertIn("the F of 1 thread block is not its lead", messages[0])
        self.assertIn("G33 takes its lead from I, J or K", messages[0])
        # A Fanuc thread's F is its lead, and keeps the wording that says so.
        fanuc = self.report("fanuc-lathe", "O1\nT0101\nG99 G97 S500 M3\nG32 Z-10. F2.\nM30\n")
        self.assertIn("is a thread pitch", fanuc["findings"][0]["message"])

    def test_a_range_in_another_unit_than_the_program_says_which(self):
        report = self.report("fanuc-lathe", "O1\nG99\nT0101\nG97 S800 M03\nG01 Z-20. F0.25\nT0505\nG98 G01 X10. F100.\nM30\n")
        self.assertEqual([(row["tool"], row["feed"]) for row in report["rows"]], [("T1", "0.25 /rev"), ("T5", "100. /min")])
