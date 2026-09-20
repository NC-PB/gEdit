"""`scale_speed.py` (plan §5, WP4.7), against the golden cases in
``tests/fixtures/scripts/scale_speed/``.

A case folder holds the same files as `test_scale_feed.py` describes: `input.nc`, the
optional `params.json` and `case.json`, and the two goldens `expected.nc` (the text the
script hands back, byte for byte) and `envelope.json` (the `message` and `findings` of the
`envelope` stdout). The script runs in a subprocess the way the app runs it.

The programs in the fixtures are synthetic. They were written for gEdit from
`docs/planning/syntax/`, are not copied from a machine, a CAM system or a customer, and
are not meant to run on a machine.

What the cases cover, in the plan's words:

* G96 and `G50`/`G92 S` are skipped by default, with options to scale them
  (`fanuc-surface-speed-and-limit`, `…-all`)
* tapping blocks get a warning (`fanuc-tapping`)
* Klartext `S` in `TOOL CALL` is scaled (`klartext-tool-call`)
* speeds are integers by default (`fanuc-number-forms`, `fanuc-number-forms-as-written`)
"""

from __future__ import annotations

import json
import sys
import unittest

from tests.python import helpers

SCRIPT = "scale_speed.py"

#: `tomllib` reads the script header the way the backend does; it arrived in 3.11, and
#: the gate also runs on 3.9, where those checks are skipped rather than dropped.
HAS_TOMLLIB = sys.version_info >= (3, 11)

#: Cases the plan names by hand, so a renamed or deleted folder fails loudly.
REQUIRED_CASES = [
    "fanuc-basic",
    "fanuc-clamped",
    "fanuc-number-forms",
    "fanuc-number-forms-as-written",
    "fanuc-selection",
    "fanuc-surface-speed-and-limit",
    "fanuc-surface-speed-and-limit-all",
    "fanuc-tapping",
    "fanuc-unchanged",
    "fanuc-value-filter",
    "fanuc-variables",
    "klartext-tool-call",
]

#: The address this script is allowed to rewrite; everything else comes back token for
#: token (see :func:`shape_of`).
SCALED_ADDRESSES = ("S",)

SEVERITIES = ("info", "warning", "error")


def envelope_of(case):
    """The expected `message` and `findings` of a case."""
    return helpers.load_json(case.directory / "envelope.json")


def run_case(case):
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=case.context())


def shape_of(lines, cp):
    """Every token of a program with the scaled values blanked out.

    Two programs with the same shape differ **only** inside the values of spindle words:
    same line count, same tokens in the same order, same kinds and addresses, and every
    comment, string, block number, skip mark and space identical character for character.
    """
    gedit_nc = helpers.import_gedit_nc()
    out = []
    state = None
    for line in lines:
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        out.append(
            [
                (
                    token.kind,
                    token.address,
                    "<value>"
                    if token.kind == "word" and token.address in SCALED_ADDRESSES
                    else token.text,
                )
                for token in tokens
            ]
        )
    return out


class TestGoldenCases(unittest.TestCase):
    def setUp(self):
        self.cases = helpers.script_cases("scale_speed")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        self.assertTrue(self.cases, "no scale_speed fixtures found")
        names = sorted(case.name for case in self.cases)
        self.assertEqual([name for name in REQUIRED_CASES if name not in names], [])

    def test_every_case_produces_its_expected_text_and_envelope(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                self.assertFalse(case.expects_json, "the text golden is expected.nc")
                result = run_case(case)
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.stderr, "")
                payload = result.json()
                self.assertEqual(sorted(payload), ["findings", "message", "text"])
                self.assertEqual(payload["text"], case.expected_text())
                self.assertEqual(
                    {"message": payload["message"], "findings": payload["findings"]},
                    envelope_of(case),
                )

    def test_the_output_differs_from_the_input_only_inside_spindle_values(self):
        gedit_nc = helpers.import_gedit_nc()
        for case in self.cases:
            with self.subTest(case=case.name):
                cp = gedit_nc.compile_profile(helpers.load_profile(case.profile_id))
                before = case.input_lines()
                after = case.expected_text().split("\n")
                self.assertEqual(len(before), len(after), "a scale run never adds a line")
                self.assertEqual(shape_of(before, cp), shape_of(after, cp))

    def test_the_trailing_newline_of_the_input_survives(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                text = case.input_text()
                self.assertEqual(case.expected_text().endswith("\n"), text.endswith("\n"))

    def test_every_finding_points_at_a_line_of_the_input(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                first = case.context()["input"]["startLine"]
                last = first + len(case.input_lines()) - 1
                for finding in envelope_of(case)["findings"]:
                    self.assertIn(finding["severity"], SEVERITIES)
                    self.assertGreaterEqual(finding["line"], first)
                    self.assertLessEqual(finding["line"], last)
                    self.assertTrue(finding["message"].endswith("."), finding["message"])


class TestRules(unittest.TestCase):
    """The rules behind the cases, stated once so that a fixture change cannot hide them."""

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_speed") if case.name == name)

    def output(self, name):
        """The golden text of a case, re-checked against a live run."""
        case = self.case(name)
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def lines(self, name):
        return self.output(name)["text"].split("\n")

    def messages(self, name):
        return [finding["message"] for finding in self.output(name)["findings"]]

    def test_a_plain_speed_is_multiplied_by_the_percentage(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("S2700 M3", lines)
        self.assertIn("S1350 M3", lines)

    def test_a_speed_inside_a_comment_is_not_a_speed(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("(T1  D10 FLAT END MILL AT S3000)", lines)
        self.assertIn("(FINISH AT S1500)", lines)
        self.assertIn("(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", lines)

    def test_a_feed_is_never_touched_by_the_speed_script(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("G1 Z-2. F1200.", lines)
        self.assertIn("G1 X40. F800.", lines)

    def test_a_surface_speed_and_a_speed_limit_follow_their_options(self):
        default = self.lines("fanuc-surface-speed-and-limit")
        self.assertIn("G50 S2500", default)
        self.assertIn("G96 S180 M3", default)
        self.assertIn("G97 S1080", default)
        messages = self.messages("fanuc-surface-speed-and-limit")
        self.assertTrue(any("spindle speed limit (G50)" in message for message in messages))
        self.assertTrue(any("surface speed (G96)" in message for message in messages))

        every = self.lines("fanuc-surface-speed-and-limit-all")
        self.assertIn("G50 S2250", every)
        self.assertIn("G96 S162 M3", every)
        self.assertIn("G97 S1080", every)

    def test_a_tapping_block_is_scaled_and_warned_about(self):
        payload = self.output("fanuc-tapping")
        lines = payload["text"].split("\n")
        self.assertIn("M29 S450", lines)
        self.assertIn("S360", lines)
        self.assertIn("X60. Y10. S405", lines)
        # The speed of a tapping cycle is usually set in the block before it, so the
        # warning has to reach the cycle as well as the speeds inside it.
        warnings = [f for f in payload["findings"] if f["severity"] == "warning"]
        self.assertEqual([f["line"] for f in warnings], [9, 11, 12])
        self.assertIn("runs at S500, which was scaled on line 7", warnings[0]["message"])
        self.assertTrue(all("check this block by hand" in f["message"] for f in warnings))
        # After G80 the cycle is over and the speed is an ordinary speed again.
        self.assertIn("S720 M3", lines)
        self.assertEqual(payload["findings"][-1]["line"], 12)

    def test_a_speed_that_is_a_variable_or_an_expression_is_reported_and_left(self):
        lines = self.lines("fanuc-variables")
        self.assertIn("S#500 M3", lines)
        self.assertIn("S[#500*0.5]", lines)
        self.assertIn("#500=1200.", lines)
        self.assertIn("S900", lines)
        self.assertEqual(len(self.messages("fanuc-variables")), 2)

    def test_a_speed_is_a_whole_number_unless_the_run_asks_for_decimals(self):
        whole = self.lines("fanuc-number-forms")
        self.assertIn("S900 M3", whole)
        self.assertIn("S315", whole)  # leading zeros are dropped
        # The point is never added and never removed: S1200.5 keeps it, S1000 does not
        # get one. Rounding is half away from zero.
        self.assertIn("S1080.", whole)
        self.assertIn("S11.", whole)

        written = self.lines("fanuc-number-forms-as-written")
        self.assertIn("S1080.5", written)
        self.assertIn("S11.48", written)
        self.assertIn("S900 M3", written)

    def test_the_limits_clamp_the_scaled_value_and_say_so(self):
        payload = self.output("fanuc-clamped")
        lines = payload["text"].split("\n")
        self.assertIn("S800 M3", lines)
        self.assertIn("S4000", lines)
        self.assertIn("S6000", lines)
        self.assertEqual(len(payload["findings"]), 2)
        self.assertIn("smallest speed (800)", payload["findings"][0]["message"])
        self.assertIn("largest speed (6000)", payload["findings"][1]["message"])

    def test_the_value_filter_leaves_the_values_outside_it_alone(self):
        lines = self.lines("fanuc-value-filter")
        self.assertIn("S400 M3", lines)  # at or below "only above"
        self.assertIn("S500", lines)
        self.assertIn("S6000", lines)  # at or above "only below"
        self.assertIn("2 left by the value filter", self.output("fanuc-value-filter")["message"])

    def test_a_hundred_per_cent_changes_nothing(self):
        case = self.case("fanuc-unchanged")
        payload = self.output("fanuc-unchanged")
        self.assertEqual(payload["text"], case.input_text())
        self.assertEqual(
            payload["message"], "No spindle speed was changed; 2 already written that way."
        )

    def test_a_selection_counts_from_the_line_the_selection_started_on(self):
        payload = self.output("fanuc-selection")
        # Line 40 is the fragment warning below; line 41 is the surface speed it found.
        self.assertEqual([finding["line"] for finding in payload["findings"]], [40, 41])

    def test_a_selection_says_that_it_cannot_see_the_modal_state_above_it(self):
        # G8 M4. G96 / G97 and the cycles are modal, so a selection that starts below
        # them reads an rpm as a surface speed or the other way round, and cannot tell
        # that a speed it changed is the one a thread further down is cut at.
        first = self.output("fanuc-selection")["findings"][0]
        self.assertEqual(first["line"], 40)
        self.assertEqual(first["severity"], "warning")
        self.assertIn("only the selection", first["message"])

    def test_a_run_over_the_whole_document_does_not_warn_about_a_fragment(self):
        for name in ("fanuc-basic", "fanuc-surface-speed-and-limit"):
            with self.subTest(case=name):
                self.assertFalse(any("only the selection" in message for message in self.messages(name)))

    def test_klartext_scales_the_speed_of_a_tool_call(self):
        lines = self.lines("klartext-tool-call")
        self.assertIn('3 TOOL CALL 5 Z S3300 F500', lines)
        self.assertIn('8 TOOL CALL "MILL_D10" Z S5500 F800', lines)
        self.assertIn("10 TOOL CALL QS1 Z S2750", lines)
        # A tool call without a tool argument only changes the speed, and is scaled too.
        self.assertIn("6 TOOL CALL Z S4950", lines)

    def test_a_klartext_speed_in_a_heading_or_a_comment_is_not_a_speed(self):
        lines = self.lines("klartext-tool-call")
        self.assertIn("2 * - ROUGH AT S3000", lines)
        self.assertIn("7 L X+50 ; S9000 IN A COMMENT", lines)


class TestCodeDatabase(unittest.TestCase):
    """The surface-speed and limit rules are data, not a table of Fanuc numbers."""

    def run_with(self, codes, stdin, params=None):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(params=params or {"percent": 50}, profile=profile, codes=codes)
        result = helpers.run_script(SCRIPT, stdin=stdin, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def codes(self):
        return helpers.load_codes(helpers.load_profile("fanuc-gcode"))

    def test_g92_clamps_the_speed_the_same_way_g50_does(self):
        payload = self.run_with(self.codes(), "G92 S2500\nS1000 M3\n")
        self.assertEqual(payload["text"], "G92 S2500\nS500 M3\n")
        self.assertIn("spindle speed limit (G92)", payload["findings"][0]["message"])

    def test_the_limit_of_a_block_wins_over_constant_surface_speed(self):
        payload = self.run_with(self.codes(), "G96 S180 M3\nG50 S2500\n")
        self.assertEqual(payload["text"], "G96 S180 M3\nG50 S2500\n")
        self.assertIn("surface speed (G96)", payload["findings"][0]["message"])
        self.assertIn("spindle speed limit (G50)", payload["findings"][1]["message"])

    def test_a_code_marked_pitch_feed_is_what_makes_a_block_a_thread_block(self):
        codes = [
            {"code": "G71", "group": "cycle", "pitchFeed": True, "params": [{"address": "F"}]},
            {"code": "G1", "group": "motion"},
        ]
        payload = self.run_with(codes, "S1000 M3\nG71 Z-10. F1.5\nG1 X10.\n")
        self.assertEqual(payload["text"], "S500 M3\nG71 Z-10. F1.5\nG1 X10.\n")
        self.assertEqual(payload["findings"][0]["line"], 2)
        self.assertIn("thread block (G71)", payload["findings"][0]["message"])

    def test_a_run_without_a_code_database_says_what_it_could_not_know(self):
        payload = self.run_with([], "G96 S180 M3\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        self.assertIn("no code database", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["line"], 1)


class TestHeader(unittest.TestCase):
    """The `# /// gedit` block, read the way `src-tauri/src/scripts/meta.rs` reads it."""

    FIELD_TYPES = ("number", "integer", "text", "bool", "choice", "file", "folder", "address-list")
    PARAMS = [
        "percent",
        "decimals",
        "minSpeed",
        "maxSpeed",
        "onlyAbove",
        "onlyBelow",
        "surfaceSpeed",
        "speedLimits",
    ]

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
        self.assertEqual(meta["name"], "Scale spindle speeds")
        self.assertEqual(meta["output"], "replace")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertIs(meta["envelope"], True)
        self.assertNotIn("profiles", meta)  # every dialect

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_every_parameter_is_shaped_like_a_field_spec(self):
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        self.assertEqual([param["id"] for param in params], self.PARAMS)
        for param in params:
            with self.subTest(param=param["id"]):
                self.assertIn(param["type"], self.FIELD_TYPES)
                self.assertTrue(param["label"])
                if param["type"] == "choice":
                    self.assertTrue(param["choices"])
                    for choice in param["choices"]:
                        self.assertEqual(sorted(choice), ["label", "value"])
                    values = [choice["value"] for choice in param["choices"]]
                    self.assertIn(param["default"], values)
                if param.get("required") is False:
                    self.assertNotIn("default", param, "an optional value starts empty")
                else:
                    self.assertIn("default", param)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_a_speed_is_a_whole_number_by_default(self):
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        decimals = next(param for param in params if param["id"] == "decimals")
        self.assertEqual(decimals["default"], "0")

    def test_the_declared_parameters_are_the_ones_the_script_reads(self):
        """A parameter the script does not read would be a silently dead control."""
        source = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8")
        body = source.split("# ///", 2)[-1]
        for name in self.PARAMS:
            with self.subTest(param=name):
                self.assertIn('"%s"' % name, body)


class TestRunEnvironment(unittest.TestCase):
    def context(self, params):
        profile = helpers.load_profile("fanuc-gcode")
        return helpers.make_context(params=params, profile=profile, codes=helpers.load_codes(profile))

    def refuses(self, params, needle):
        result = helpers.run_script(SCRIPT, stdin="S1000 M3\n", context=self.context(params))
        self.assertFalse(result.ok, result.stdout)
        self.assertEqual(result.stdout, "", "a refused run must not hand back text")
        self.assertIn(needle, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self):
        result = helpers.run_script(SCRIPT, stdin="S1000 M3\n", context=None)
        self.assertFalse(result.ok)
        self.assertEqual(result.stdout, "")
        self.assertIn("profile", result.stderr)

    def test_a_profile_it_cannot_compile_is_a_message_and_not_a_traceback(self):
        profile = helpers.load_profile("fanuc-gcode")
        profile["toolCall"]["trigger"] = "M0*6(?!\\d"
        result = helpers.run_script(
            SCRIPT, stdin="S1000 M3\n", context=helpers.make_context(profile=profile, codes=[])
        )
        self.assertFalse(result.ok)
        self.assertIn("toolCall.trigger", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_a_percentage_of_zero_or_less_is_refused_rather_than_stopping_the_spindle(self):
        self.refuses({"percent": 0}, "greater than zero")
        self.refuses({"percent": -50}, "greater than zero")

    def test_a_parameter_that_is_not_a_number_is_refused(self):
        self.refuses({"percent": "ninety"}, "Percentage")
        self.refuses({"minSpeed": "slow"}, "Smallest speed")
        self.refuses({"decimals": "many"}, "Decimal places")

    def test_limits_the_wrong_way_round_are_refused(self):
        self.refuses({"minSpeed": 9000, "maxSpeed": 100}, "larger than")

    def test_a_percentage_may_arrive_as_a_float_or_as_text(self):
        for percent in (97.5, "97.5"):
            with self.subTest(percent=percent):
                result = helpers.run_script(
                    SCRIPT, stdin="S1000 M3\n", context=self.context({"percent": percent})
                )
                self.assertTrue(result.ok, result.stderr)
                payload = result.json()
                self.assertEqual(payload["text"], "S975 M3\n")
                self.assertIn("97.5 %", payload["message"])

    def test_an_empty_document_comes_back_empty(self):
        result = helpers.run_script(SCRIPT, stdin="", context=self.context({"percent": 90}))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "")
        self.assertEqual(payload["findings"], [])
        self.assertEqual(payload["message"], "No spindle speeds found.")

    def test_the_last_line_keeps_its_ending_or_its_absence(self):
        for stdin in ("S1000 M3\n", "S1000 M3", "S1000 M3\n\n"):
            with self.subTest(stdin=stdin):
                result = helpers.run_script(SCRIPT, stdin=stdin, context=self.context({"percent": 90}))
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.json()["text"], stdin.replace("S1000", "S900"))

    def test_a_value_that_would_round_to_zero_is_left_as_it_is(self):
        result = helpers.run_script(
            SCRIPT, stdin="S10 M3\nS1000\n", context=self.context({"percent": 4})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "S10 M3\nS40\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        self.assertIn("would become 0", payload["findings"][0]["message"])

    def test_the_findings_are_capped_and_the_message_says_how_many_were_left_out(self):
        lines = ["G96 S100 M3"] + ["G96 S%d M3" % (100 + n) for n in range(300)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(len(payload["findings"]), 200)
        self.assertIn("101 further notes are not listed.", payload["message"])
        self.assertEqual(payload["text"], "\n".join(lines) + "\n")

    def test_a_large_program_is_scaled_in_one_pass(self):
        """One pass over the tokens, not one per value.

        `helpers.run_script` kills a run after a minute, so a walk that turned quadratic
        would fail here rather than in a user's 100,000-line program.
        """
        lines = ["G97"] + ["N%d G1 X%d. S2000" % (n * 10, n % 400) for n in range(20000)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["message"], "Scaled 20,000 spindle speeds to 90 %.")
        self.assertEqual(payload["text"].count("S1800"), 20000)
        self.assertEqual(payload["findings"], [])

    def test_the_findings_come_back_in_line_order(self):
        for case in helpers.script_cases("scale_speed"):
            with self.subTest(case=case.name):
                findings = envelope_of(case)["findings"]
                self.assertEqual(
                    [finding["line"] for finding in findings],
                    sorted(finding["line"] for finding in findings),
                )

    def test_the_result_is_json_the_app_can_read(self):
        case = next(c for c in helpers.script_cases("scale_speed") if c.name == "fanuc-basic")
        result = run_case(case)
        payload = json.loads(result.stdout)
        self.assertIsInstance(payload["text"], str)
        self.assertNotIn("\r", payload["text"], "the app puts the line ending back itself")
        self.assertTrue(result.stdout.endswith("\n"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
