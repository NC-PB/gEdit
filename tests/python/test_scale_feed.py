"""`scale_feed.py` (plan §5, WP4.7), against the golden cases in
``tests/fixtures/scripts/scale_feed/``.

Each case is a folder: `input.nc` (stdin), the optional `params.json` the user would have
filled in, the optional `case.json` that says which dialect it is written in or makes the
run a selection, and the two goldens

* `expected.nc` — the text the script hands back, byte for byte. It is a plain NC file so
  that a reviewer can diff it against `input.nc` and see the change, which is the whole
  point of a golden for a transform.
* `envelope.json` — the rest of the `envelope` stdout: `message` and `findings`.

The script runs in a subprocess the way the app runs it (header, stdin, `GEDIT_CONTEXT`),
because that is what is being tested.

The programs in the fixtures are synthetic. They were written for gEdit from
`docs/planning/syntax/`, are not copied from a machine, a CAM system or a customer, and
are not meant to run on a machine. They carry no `WRITTEN FOR GEDIT` comment rule of their
own: `scale_feed` never touches a comment, so the marker line is simply part of the
program and is asserted to come back unchanged.

What the cases cover, in the plan's words:

* `FMAX` and `FAUTO` are left alone (`klartext-basic`)
* G95 and G93 are skipped by default, with an option to scale them (`fanuc-feed-modes`,
  `fanuc-feed-modes-all`)
* `pitchFeed` blocks are never scaled and are reported (`fanuc-pitch-feed`)
* variables and expressions are skipped and reported (`fanuc-variables`)
* Klartext cycle Q feeds are listed and left unchanged (`klartext-basic`,
  `klartext-tapping`)
* the written form of a number survives (`fanuc-number-forms`)

And the four the M4 review added, each of which is a program the script used to get
wrong:

* a code whose number is a threading cycle in another G-code system is refused rather
  than scaled (`fanuc-lathe-threading`)
* a zero or negative feed is never raised to the "smallest feed" limit
  (`fanuc-zero-feed-with-limit`)
* a value the written precision rounds back to itself, or further than asked, is named
  line by line instead of only counted (`fanuc-lathe-decimals`)
* a run over a selection says which modal state it could not see (`fanuc-selection`)

And the three WP5.4 added, which are the same modal-state hazard **fixed** rather than
warned about: a selection whose case folder carries a `preceding.nc` is primed from the
lines above it (`input.precedingLines`, plan section 7.5), so the run reads the fragment
in the state it is really written in.

* a selection that starts inside a `G84` tapping cycle refuses its pitches
  (`fanuc-selection-primed`)
* a selection under a `G95` inherits the feed mode (`fanuc-selection-per-revolution`)
* a Klartext selection that starts inside a cycle's parameter block inherits the cycle
  **and** the `~` continuation (`klartext-selection-primed`)

Each of the three is checked twice: once against its golden, and once with
`precedingLines` taken back out, which is what the run used to do and what it still does
when the context does not carry the field.
"""

from __future__ import annotations

import json
import sys
import unittest

from tests.python import helpers

SCRIPT = "scale_feed.py"

#: `tomllib` reads the script header the way the backend does; it arrived in 3.11, and
#: the gate also runs on 3.9, where those checks are skipped rather than dropped.
HAS_TOMLLIB = sys.version_info >= (3, 11)

#: Cases the plan names by hand, so a renamed or deleted folder fails loudly.
REQUIRED_CASES = [
    "fanuc-basic",
    "fanuc-clamped",
    "fanuc-feed-modes",
    "fanuc-feed-modes-all",
    "fanuc-lathe-decimals",
    "fanuc-lathe-threading",
    "fanuc-number-forms",
    "fanuc-number-forms-two-decimals",
    "fanuc-pitch-feed",
    "fanuc-selection",
    "fanuc-selection-per-revolution",
    "fanuc-selection-primed",
    "fanuc-unchanged",
    "fanuc-value-filter",
    "fanuc-variables",
    "fanuc-zero-feed-with-limit",
    "klartext-basic",
    "klartext-per-revolution",
    "klartext-selection-primed",
    "klartext-tapping",
]

#: The addresses this script is allowed to rewrite. Everything else has to come back
#: token for token (see :func:`shape_of`).
SCALED_ADDRESSES = ("F", "FU", "FZ")

SEVERITIES = ("info", "warning", "error")


def envelope_of(case):
    """The expected `message` and `findings` of a case."""
    return helpers.load_json(case.directory / "envelope.json")


def run_case(case):
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=case.context())


def shape_of(lines, cp):
    """Every token of a program with the scaled values blanked out.

    Two programs with the same shape differ **only** inside the values of feed words: same
    line count, same tokens in the same order, same kinds and addresses, and every comment,
    string, block number, skip mark and space identical character for character. It is the
    invariant that matters most here — a transform that corrupts a program is the worst
    bug this script could have.
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
        self.cases = helpers.script_cases("scale_feed")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        self.assertTrue(self.cases, "no scale_feed fixtures found")
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

    def test_the_output_differs_from_the_input_only_inside_feed_values(self):
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
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

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

    def test_a_plain_feed_is_multiplied_by_the_percentage(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("G1 Z-2. F1080.", lines)
        self.assertIn("/N90 G1 X50. F270.", lines)
        self.assertIn("N120/G0 Y10. F225.", lines)

    def test_packed_code_is_scaled_without_being_respaced(self):
        self.assertIn("N10G1X10.Y-5.F450", self.lines("fanuc-basic"))

    def test_a_feed_inside_a_comment_is_not_a_feed(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("(T1  D10 FLAT END MILL - ROUGH AT F500)", lines)
        self.assertIn("(FINISH PASS AT F500)", lines)
        self.assertIn("(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", lines)

    def test_a_thread_pitch_is_never_scaled_and_is_reported(self):
        payload = self.output("fanuc-pitch-feed")
        lines = payload["text"].split("\n")
        # G84 and G74 tapping, G33 and G32 thread cutting: the F is a pitch, not a feed.
        self.assertIn("G98 G84 X20. Y10. Z-12. R3. F625.", lines)
        self.assertIn("G74 X80. Y10. Z-12. R3. F625.", lines)
        self.assertIn("G33 Z-20. F1.5", lines)
        self.assertIn("G32 Z-20. F1.5", lines)
        self.assertEqual(
            [finding["severity"] for finding in payload["findings"]], ["warning"] * 4
        )
        self.assertTrue(all("thread pitch" in message for message in self.messages("fanuc-pitch-feed")))
        # G80 and a motion code end the cycle, so the feeds around it are scaled.
        self.assertIn("G1 X60. F400.", lines)
        self.assertIn("G1 Z2. F480.", lines)

    def test_a_code_that_means_a_threading_cycle_elsewhere_is_refused(self):
        # G8 M4. G76 is a fine boring cycle on the shipped mill dialect and a multi-pass
        # threading cycle on a lathe in G-code system A, where its F is the thread lead;
        # G92 sets the coordinate system on the one and is the single-pass threading
        # cycle on the other. Both database entries said so in prose and carried no flag,
        # so `Scale feed rates` at 80 % turned a 2.0 mm lead into 1.6 mm without a word.
        # `pitchFeedAmbiguous` is that prose made machine readable, and the script
        # refuses rather than guesses: the flag decides, not the number.
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80}, profile=profile, codes=helpers.load_codes(profile)
        )
        program = "N200 G76 X18.16 Z-20. P1190 Q350 F2.0\nN210 G92 X19.5 Z-20. F2.0\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["text"], program)

        findings = result.json()["findings"]
        self.assertEqual([finding["line"] for finding in findings], [1, 2])
        for finding, code in zip(findings, ("G76", "G92")):
            self.assertEqual(finding["severity"], "warning")
            self.assertIn(code, finding["message"])
            self.assertIn("thread lead", finding["message"])
        self.assertIn("another G-code system", result.json()["message"])

    def test_the_ambiguous_code_is_recognised_however_the_block_is_written(self):
        """The refusal has to survive the ways a post actually writes a code.

        It is a code-database lookup through `normalize_code`, not a string match, so
        leading zeros, lower case and a packed block all reach the same entry. A refusal
        that only fired on `G76 ` would be a refusal a real program walks straight past.
        """
        profile = helpers.load_profile("fanuc-gcode")
        for program, code in (
            ("G076 X18.16 Z-20. F2.0\n", "G76"),
            ("g76 X18.16 Z-20. F2.0\n", "G76"),
            ("N10G76X18.16Z-20.F2.0\n", "G76"),
            ("N10 G92X19.5F2.0\n", "G92"),
        ):
            with self.subTest(program=program.strip()):
                context = helpers.make_context(
                    params={"percent": 80}, profile=profile, codes=helpers.load_codes(profile)
                )
                result = helpers.run_script(SCRIPT, stdin=program, context=context)
                self.assertTrue(result.ok, result.stderr)
                payload = result.json()
                self.assertEqual(payload["text"], program, "the block was rewritten")
                self.assertEqual(len(payload["findings"]), 1)
                self.assertIn(code, payload["findings"][0]["message"])
                self.assertIn("thread lead", payload["findings"][0]["message"])

    def test_the_refusal_says_the_value_the_code_and_what_to_do(self):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80}, profile=profile, codes=helpers.load_codes(profile)
        )
        result = helpers.run_script(SCRIPT, stdin="G76 X18.16 Z-20. F2.0\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(
            result.json()["findings"][0]["message"],
            "F2.0 is not scaled: G76 is a threading cycle in another G-code system of "
            "this dialect, where this F is the thread lead and not a feed rate. Check "
            "the block and scale it by hand if it really is a feed.",
        )

    def test_the_ambiguity_of_a_non_modal_code_ends_with_its_own_block(self):
        # G92 is non-modal, so the block after it is an ordinary move again. G76 is a
        # modal cycle and stays in force until G80 cancels it.
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 50}, profile=profile, codes=helpers.load_codes(profile)
        )
        program = "N10 G92 X19.5 F2.0\nN20 G1 X30. F400.\nN30 G76 Z-20. F2.0\nN40 X10. F2.0\nN50 G80\nN60 G1 X40. F400.\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(
            result.json()["text"].splitlines(),
            [
                "N10 G92 X19.5 F2.0",
                "N20 G1 X30. F200.",
                "N30 G76 Z-20. F2.0",
                "N40 X10. F2.0",
                "N50 G80",
                "N60 G1 X40. F200.",
            ],
        )

    def test_the_feed_modes_are_skipped_by_default_and_scaled_on_request(self):
        default = self.lines("fanuc-feed-modes")
        self.assertIn("G95 Y20. F0.15", default)
        self.assertIn("G93 X0. Y0. A90. F12.5", default)
        self.assertIn("G94 G1 Z-2. F225.", default)
        messages = self.messages("fanuc-feed-modes")
        self.assertTrue(any("feed per revolution (G95)" in message for message in messages))
        self.assertTrue(any("inverse-time feed (G93)" in message for message in messages))

        every = self.lines("fanuc-feed-modes-all")
        self.assertIn("G95 Y20. F0.14", every)
        self.assertIn("G93 X0. Y0. A90. F11.3", every)

    def test_a_feed_that_is_a_variable_or_an_expression_is_reported_and_left(self):
        lines = self.lines("fanuc-variables")
        self.assertIn("G1 Z-2. F#101", lines)
        self.assertIn("X40. F[#101*0.5]", lines)
        self.assertIn("X60. F#[#102]", lines)
        # The macro assignment is not a feed word at all and is never touched.
        self.assertIn("#101=800.", lines)
        self.assertIn("IF [#101 GT 2] GOTO 100", lines)
        self.assertIn("X80. F540.", lines)
        self.assertEqual(len(self.messages("fanuc-variables")), 4)

    def test_the_written_form_of_a_number_survives(self):
        lines = self.lines("fanuc-number-forms")
        self.assertIn("G1 X10. F1080.", lines)  # the trailing point stays
        self.assertIn("X20. F90", lines)  # and a value without one never gains one
        self.assertIn("X30. F.14", lines)  # the dropped leading zero stays dropped
        self.assertIn("X40. F0.072", lines)  # three written decimals stay three
        self.assertIn("X50. F6.8", lines)  # leading zeros go, one decimal stays one
        self.assertIn("X60. F11.111", lines)  # 11.1105 rounds half away from zero

    def test_a_fixed_decimal_count_never_gives_a_point_less_value_a_point(self):
        payload = self.output("fanuc-number-forms-two-decimals")
        lines = payload["text"].split("\n")
        self.assertIn("G1 X10. F1080.00", lines)
        # F100 would become F90.00, which a Fanuc control reads as ninety times the feed.
        self.assertIn("X20. F90", lines)
        self.assertTrue(
            any("without a decimal point" in finding["message"] for finding in payload["findings"])
        )

    def test_the_limits_clamp_the_scaled_value_and_say_so(self):
        payload = self.output("fanuc-clamped")
        lines = payload["text"].split("\n")
        self.assertIn("G1 Z-2. F200.", lines)
        self.assertIn("X40. F1350.", lines)
        self.assertIn("X60. F2500.", lines)
        self.assertEqual(len(payload["findings"]), 2)
        self.assertIn("smallest feed (200)", payload["findings"][0]["message"])
        self.assertIn("largest feed (2500)", payload["findings"][1]["message"])

    def test_the_value_filter_leaves_the_values_outside_it_alone(self):
        lines = self.lines("fanuc-value-filter")
        self.assertIn("G1 Z-2. F100.", lines)  # at or below "only above"
        self.assertIn("X40. F300.", lines)
        self.assertIn("X60. F500.", lines)
        self.assertIn("X80. F1500.", lines)  # at or above "only below"
        self.assertIn("2 left by the value filter", self.output("fanuc-value-filter")["message"])

    def test_a_hundred_per_cent_changes_nothing(self):
        case = self.case("fanuc-unchanged")
        payload = self.output("fanuc-unchanged")
        self.assertEqual(payload["text"], case.input_text())
        self.assertEqual(payload["message"], "No feed rate was changed; 5 already written that way.")

    def test_a_selection_counts_from_the_line_the_selection_started_on(self):
        payload = self.output("fanuc-selection")
        # Line 40 is the fragment warning below; line 41 is the pitch feed it did find.
        self.assertEqual([finding["line"] for finding in payload["findings"]], [40, 41])

    def test_a_selection_says_that_it_cannot_see_the_modal_state_above_it(self):
        # G8 M4. Feed modes and cycles are modal. A selection that starts below a G95 or
        # inside a G84 tapping cycle reads the fragment from the top-of-program state, so
        # a thread pitch set further up is scaled like an ordinary feed. The run still
        # happens — it is what the user asked for — but it opens by saying what it could
        # not see.
        payload = self.output("fanuc-selection")
        first = payload["findings"][0]
        self.assertEqual(first["line"], 40)
        self.assertEqual(first["severity"], "warning")
        self.assertIn("only the selection", first["message"])
        self.assertIn("cannot be recognised here", first["message"])

    def test_a_run_over_the_whole_document_does_not_warn_about_a_fragment(self):
        for name in ("fanuc-basic", "fanuc-pitch-feed"):
            with self.subTest(case=name):
                messages = self.messages(name)
                self.assertFalse(any("only the selection" in message for message in messages))

    def test_a_thread_pitch_above_a_selection_is_scaled_and_the_run_says_so(self):
        # The reviewer's own program: a G84 tapping cycle is still in force in the
        # repeat blocks, and a selection that starts at the repeats cannot know it.
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80},
            profile=profile,
            codes=helpers.load_codes(profile),
            input={"scope": "selection", "startLine": 6, "endLine": 9},
        )
        selection = "N60 X20. F1.5\nN70 X30. F1.5\nN80 G80\nN90 G1 X40. F0.25\n"
        result = helpers.run_script(SCRIPT, stdin=selection, context=context)
        self.assertTrue(result.ok, result.stderr)
        # The pitches are scaled — this run cannot tell that they are pitches — so the
        # warning at the head of the findings is the whole protection the user gets.
        self.assertEqual(result.json()["findings"][0]["line"], 6)
        self.assertIn("only the selection", result.json()["findings"][0]["message"])

    def test_klartext_rapid_is_a_keyword_and_is_never_scaled(self):
        lines = self.lines("klartext-basic")
        self.assertIn("5 L Z+100 R0 FMAX M3", lines)
        self.assertIn("10 L X+60 FAUTO", lines)
        self.assertIn("14 L Z+100 R0 FMAX M9", lines)

    def test_klartext_scales_the_feed_of_a_tool_call_and_of_a_move(self):
        lines = self.lines("klartext-basic")
        self.assertIn("4 TOOL CALL 6 Z S2000 F440", lines)
        self.assertIn("9 L Z-2 R0 F880", lines)
        self.assertIn("13 L IY+5 F550", lines)

    def test_a_feed_in_a_klartext_section_heading_is_not_a_feed(self):
        self.assertIn("8 * - MILL AT F800 ; NOT A COMMENT FEED", self.lines("klartext-basic"))

    def test_klartext_per_tooth_and_per_revolution_feeds_follow_the_option(self):
        default = self.lines("klartext-basic")
        self.assertIn("11 L Y+40 FZ0.05", default)
        self.assertIn("12 L X-10 FU0.12", default)
        messages = self.messages("klartext-basic")
        self.assertTrue(any("feed per tooth" in message for message in messages))
        self.assertTrue(any("feed per revolution" in message for message in messages))

        every = self.lines("klartext-per-revolution")
        self.assertIn("11 L Y+40 FZ0.06", every)
        self.assertIn("12 L X-10 FU0.13", every)

    def test_a_klartext_cycle_feed_is_listed_and_left_unchanged(self):
        payload = self.output("klartext-basic")
        self.assertIn("   Q206=180 ;PLUNGE FEED ~", payload["text"].split("\n"))
        listed = [f for f in payload["findings"] if "Q206" in f["message"]]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["line"], 10)
        self.assertIn("CYCL DEF 200", listed[0]["message"])

        # The tapping cycles: 206 declares a feed parameter, 207 declares a pitch.
        tapping = self.output("klartext-tapping")
        listed = [f for f in tapping["findings"] if f["message"].startswith("Q")]
        self.assertEqual([f["message"].split(" ")[0] for f in listed], ["Q206"])
        self.assertIn("   Q239=+1.25 ;THREAD PITCH ~", tapping["text"].split("\n"))


class TestSelectionPriming(unittest.TestCase):
    """The M4 carry-over, fixed: a selection run reads the state above the selection.

    `ScriptContextInput.precedingLines` (plan section 7.5) carries the document lines above
    `startLine`. `gedit_nc.prime_tracker` walks them into the `FeedModeTracker` before the
    first editable block, so a `G95` or a `G84` that starts higher up is in force inside
    the selection exactly as it would be in a whole-document run.

    Every case here is checked **twice**: once as it ships, and once with the field taken
    back out. The second half is what makes these cases evidence — without it a golden
    proves only that the script is self-consistent, not that the priming does anything.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

    def primed(self, name):
        case = self.case(name)
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def unprimed(self, name):
        """The same run with `precedingLines` taken back out: the M4 behaviour."""
        case = self.case(name)
        context = case.context()
        self.assertIn("precedingLines", context["input"], "this case is not a primed one")
        context["input"] = {
            key: value for key, value in context["input"].items() if key != "precedingLines"
        }
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_selection_inside_a_tapping_cycle_refuses_the_pitches_it_inherited(self):
        payload = self.primed("fanuc-selection-primed")
        lines = payload["text"].split("\n")
        # The G84 stands on line 7, above the selection. Its repeat blocks carry the pitch.
        self.assertIn("X40. F625.", lines)
        self.assertIn("X60. F625.", lines)
        # G80 cancels the cycle inside the selection, so the feed after it is scaled.
        self.assertIn("G1 X80. F320.", lines)
        pitches = [f for f in payload["findings"] if "thread pitch (G84)" in f["message"]]
        self.assertEqual([f["line"] for f in pitches], [8, 9])

    def test_without_the_lines_above_it_the_same_selection_scales_those_pitches(self):
        payload = self.unprimed("fanuc-selection-primed")
        lines = payload["text"].split("\n")
        # 80 % of a 1.25 mm pitch tapped at 500 rpm: the thread is scrapped in silence
        # apart from the warning. This is the defect the priming removes.
        self.assertIn("X40. F500.", lines)
        self.assertIn("X60. F500.", lines)
        self.assertIn("only the selection", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["severity"], "warning")

    def test_a_selection_under_a_feed_mode_set_above_it_inherits_the_mode(self):
        payload = self.primed("fanuc-selection-per-revolution")
        lines = payload["text"].split("\n")
        self.assertIn("G1 X20. F0.15", lines)
        self.assertIn("X40. F0.2", lines)
        self.assertIn("G1 X60. F200.", lines)  # after the G94 inside the selection
        self.assertIn("2 left in another feed mode", payload["message"])

    def test_without_the_lines_above_it_the_same_selection_scales_the_per_revolution_feeds(self):
        payload = self.unprimed("fanuc-selection-per-revolution")
        lines = payload["text"].split("\n")
        # Read as feed per minute: 80 % of 0.15 mm/rev is written straight into the file.
        self.assertIn("G1 X20. F0.12", lines)
        # And 0.2 is scaled too — one written decimal rounds 0.16 back to 0.2, which the
        # run reports as a value it could not move rather than as a value it left alone.
        self.assertIn("X40. F0.2", lines)
        self.assertTrue(any("stays as it is" in f["message"] for f in payload["findings"]))
        self.assertFalse(any("feed per revolution" in f["message"] for f in payload["findings"]))

    def test_a_klartext_selection_inherits_the_cycle_and_the_continuation(self):
        payload = self.primed("klartext-selection-primed")
        # `CYCL DEF 200` stands above the selection and the selection begins in the middle
        # of its `~` parameter block: the cycle feed is still recognised and left alone.
        listed = [f for f in payload["findings"] if f["message"].startswith("Q206")]
        self.assertEqual(len(listed), 1)
        self.assertIn("CYCL DEF 200", listed[0]["message"])
        self.assertIn("6 L Z-2 R0 F550", payload["text"].split("\n"))

    def test_without_the_lines_above_it_the_klartext_cycle_feed_is_not_recognised(self):
        payload = self.unprimed("klartext-selection-primed")
        self.assertEqual([f for f in payload["findings"] if f["message"].startswith("Q206")], [])

    def test_a_primed_run_names_what_it_inherited_instead_of_warning(self):
        for name, needle in (
            ("fanuc-selection-primed", "the thread-pitch cycle G84"),
            ("fanuc-selection-per-revolution", "a feed per revolution (G95)"),
            ("klartext-selection-primed", "the cycle CYCL DEF 200"),
        ):
            with self.subTest(case=name):
                payload = self.primed(name)
                first = payload["findings"][0]
                self.assertEqual(first["severity"], "info")
                self.assertEqual(first["line"], self.case(name).context()["input"]["startLine"])
                self.assertIn("were read for the modal state", first["message"])
                self.assertIn(needle, first["message"])
                self.assertFalse(
                    any("cannot be recognised here" in f["message"] for f in payload["findings"]),
                    "a primed run has nothing to warn about",
                )

    def test_a_primed_run_that_inherited_nothing_says_nothing(self):
        """Above the selection is an ordinary G94 program: there is nothing to report."""
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 90},
            profile=profile,
            codes=helpers.load_codes(profile),
            input={
                "scope": "selection",
                "startLine": 4,
                "endLine": 4,
                "precedingLines": ["%", "O1000", "G21 G90 G94"],
            },
        )
        result = helpers.run_script(SCRIPT, stdin="G1 X10. F200.", context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "G1 X10. F180.")
        self.assertEqual(payload["findings"], [])

    def test_preceding_lines_that_are_not_all_the_lines_above_are_refused(self):
        """A truncated field is a wrong answer; an absent one is an honest warning.

        The contract tells the runner to omit `precedingLines` rather than truncate them
        when the text above the selection is too large to send. A tracker primed with the
        tail of a program is confidently wrong — here the `G84` fell off the front, so the
        pitch would be scaled while the run claimed to know the state. The length check in
        `gedit_nc.preceding_lines` turns that back into the M4 warning.
        """
        case = self.case("fanuc-selection-primed")
        context = case.context()
        context["input"]["precedingLines"] = context["input"]["precedingLines"][-3:]
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertIn("only the selection", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        self.assertEqual(payload["text"], self.unprimed("fanuc-selection-primed")["text"])

    def test_preceding_lines_are_ignored_when_the_run_is_not_a_selection(self):
        """A document run already starts at the top of the program."""
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80},
            profile=profile,
            codes=helpers.load_codes(profile),
            input={
                "scope": "document",
                "startLine": 1,
                "endLine": 1,
                "precedingLines": ["G98 G84 X20. Z-12. R3. F625."],
            },
        )
        result = helpers.run_script(SCRIPT, stdin="G1 X10. F200.", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["text"], "G1 X10. F160.")


class TestCodeDatabase(unittest.TestCase):
    """The pitch rule is data, not a table of Fanuc numbers (`nc-transformations.md`)."""

    def run_with(self, codes, stdin, params=None):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(params=params or {"percent": 50}, profile=profile, codes=codes)
        result = helpers.run_script(SCRIPT, stdin=stdin, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_code_marked_pitch_feed_is_honoured_whatever_its_number(self):
        codes = [
            {"code": "G71", "group": "cycle", "pitchFeed": True, "params": [{"address": "F"}]},
            {"code": "G1", "group": "motion"},
        ]
        payload = self.run_with(codes, "G71 Z-10. F1.5\nG1 X10. F500.\n")
        self.assertEqual(payload["text"], "G71 Z-10. F1.5\nG1 X10. F250.\n")
        self.assertIn("thread pitch (G71)", payload["findings"][0]["message"])

    def test_the_same_code_is_a_plain_cycle_in_another_dialect(self):
        codes = [
            {"code": "G71", "group": "cycle", "params": [{"address": "F"}]},
            {"code": "G1", "group": "motion"},
        ]
        payload = self.run_with(codes, "G71 Z-10. F200.\nG1 X10. F500.\n")
        self.assertEqual(payload["text"], "G71 Z-10. F100.\nG1 X10. F250.\n")

    def test_a_run_without_a_code_database_says_what_it_could_not_know(self):
        payload = self.run_with([], "G84 X20. Z-12. R3. F625.\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        self.assertIn("no code database", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["line"], 1)


class TestHeader(unittest.TestCase):
    """The `# /// gedit` block, read the way `src-tauri/src/scripts/meta.rs` reads it.

    The backend parses it as TOML and hands the result to the webview as `ScriptMeta`
    (plan §7.6), so a header that does not parse, or a parameter that is not shaped like a
    `FieldSpec` (§7.5), breaks the script's form without breaking any Python.
    """

    FIELD_TYPES = ("number", "integer", "text", "bool", "choice", "file", "folder", "address-list")
    SCRIPT = SCRIPT
    NAME = "Scale feed rates"
    PARAMS = [
        "percent",
        "decimals",
        "minFeed",
        "maxFeed",
        "onlyAbove",
        "onlyBelow",
        "perRevolution",
        "inverseTime",
    ]

    def header_source(self):
        """The header block with its `# ` prefix removed, as the backend does it."""
        lines = (helpers.SCRIPTS_DIR / self.SCRIPT).read_text(encoding="utf-8").split("\n")
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
        self.assertEqual(meta["name"], self.NAME)
        self.assertEqual(meta["output"], "replace")
        self.assertEqual(meta["input"], "selection-or-document")
        # The result is the JSON envelope, so that a summary and findings come back too.
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

    def test_the_declared_parameters_are_the_ones_the_script_reads(self):
        """A parameter the script does not read would be a silently dead control."""
        source = (helpers.SCRIPTS_DIR / self.SCRIPT).read_text(encoding="utf-8")
        body = source.split("# ///", 2)[-1]
        for name in self.PARAMS:
            with self.subTest(param=name):
                self.assertIn('"%s"' % name, body)


class TestRunEnvironment(unittest.TestCase):
    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self):
        result = helpers.run_script(SCRIPT, stdin="G1 F500.\n", context=None)
        self.assertFalse(result.ok)
        self.assertEqual(result.stdout, "")
        self.assertIn("profile", result.stderr)

    def test_a_profile_it_cannot_compile_is_a_message_and_not_a_traceback(self):
        profile = helpers.load_profile("fanuc-gcode")
        profile["toolCall"]["trigger"] = "M0*6(?!\\d"
        result = helpers.run_script(
            SCRIPT, stdin="G1 F500.\n", context=helpers.make_context(profile=profile, codes=[])
        )
        self.assertFalse(result.ok)
        self.assertIn("toolCall.trigger", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def context(self, params):
        profile = helpers.load_profile("fanuc-gcode")
        return helpers.make_context(params=params, profile=profile, codes=helpers.load_codes(profile))

    def refuses(self, params, needle):
        result = helpers.run_script(SCRIPT, stdin="G1 F500.\n", context=self.context(params))
        self.assertFalse(result.ok, result.stdout)
        self.assertEqual(result.stdout, "", "a refused run must not hand back text")
        self.assertIn(needle, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_a_percentage_of_zero_or_less_is_refused_rather_than_zeroing_the_program(self):
        self.refuses({"percent": 0}, "greater than zero")
        self.refuses({"percent": -50}, "greater than zero")

    def test_a_parameter_that_is_not_a_number_is_refused(self):
        self.refuses({"percent": "ninety"}, "Percentage")
        self.refuses({"maxFeed": "lots"}, "Largest feed")
        self.refuses({"decimals": "many"}, "Decimal places")

    def test_limits_the_wrong_way_round_are_refused(self):
        self.refuses({"minFeed": 900, "maxFeed": 100}, "larger than")

    def test_a_percentage_may_arrive_as_a_float_or_as_text(self):
        for percent in (97.5, "97.5"):
            with self.subTest(percent=percent):
                result = helpers.run_script(
                    SCRIPT, stdin="G1 F1000.\n", context=self.context({"percent": percent})
                )
                self.assertTrue(result.ok, result.stderr)
                payload = result.json()
                self.assertEqual(payload["text"], "G1 F975.\n")
                self.assertIn("97.5 %", payload["message"])

    def test_an_empty_document_comes_back_empty(self):
        result = helpers.run_script(SCRIPT, stdin="", context=self.context({"percent": 90}))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "")
        self.assertEqual(payload["findings"], [])
        self.assertEqual(payload["message"], "No feed rates found.")

    def test_the_last_line_keeps_its_ending_or_its_absence(self):
        for stdin in ("G1 F500.\n", "G1 F500.", "G1 F500.\n\n"):
            with self.subTest(stdin=stdin):
                result = helpers.run_script(SCRIPT, stdin=stdin, context=self.context({"percent": 90}))
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.json()["text"], stdin.replace("F500.", "F450."))

    def test_a_value_that_would_round_to_zero_is_left_as_it_is(self):
        result = helpers.run_script(
            SCRIPT, stdin="G1 F5\nG1 F500\n", context=self.context({"percent": 5})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "G1 F5\nG1 F25\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        # The finding names what was skipped and how the run got to zero, because the two
        # ways out are different: more decimal places, or a different limit.
        self.assertEqual(
            payload["findings"][0]["message"],
            "F5 is not scaled: 5 % of 5 is 0.25, which written with no decimals is 0, and "
            "a feed of zero is a block that does not cut, not a slow one. Ask for more "
            "decimal places to scale it.",
        )

    def test_a_value_a_zero_limit_would_zero_names_the_limit_and_not_the_rounding(self):
        result = helpers.run_script(
            SCRIPT, stdin="G1 F500.\n", context=self.context({"percent": 90, "maxFeed": 0})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "G1 F500.\n")
        self.assertEqual(
            payload["findings"][0]["message"],
            "F500. is not scaled: the largest feed is 0, and a feed of zero is a block "
            "that does not cut, not a slow one.",
        )

    def test_the_findings_are_capped_and_the_message_says_how_many_were_left_out(self):
        lines = ["G95"] + ["G1 X%d. F0.2" % n for n in range(300)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(len(payload["findings"]), 200)
        self.assertIn("100 further notes are not listed.", payload["message"])
        self.assertEqual(payload["text"], "\n".join(lines) + "\n")

    def test_a_large_program_is_scaled_in_one_pass(self):
        """One pass over the tokens, not one per value.

        `helpers.run_script` kills a run after a minute, so a walk that turned quadratic
        would fail here rather than in a user's 100,000-line program.
        """
        lines = ["G94"] + ["N%d G1 X%d. F1200." % (n * 10, n % 400) for n in range(20000)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["message"], "Scaled 20,000 feed rates to 90 %.")
        self.assertEqual(payload["text"].count("F1080."), 20000)
        self.assertEqual(payload["findings"], [])

    def test_the_findings_come_back_in_line_order(self):
        for case in helpers.script_cases("scale_feed"):
            with self.subTest(case=case.name):
                findings = envelope_of(case)["findings"]
                self.assertEqual(
                    [finding["line"] for finding in findings],
                    sorted(finding["line"] for finding in findings),
                )

    def test_the_result_is_json_the_app_can_read(self):
        case = next(c for c in helpers.script_cases("scale_feed") if c.name == "fanuc-basic")
        result = run_case(case)
        payload = json.loads(result.stdout)
        self.assertIsInstance(payload["text"], str)
        self.assertNotIn("\r", payload["text"], "the app puts the line ending back itself")
        self.assertTrue(result.stdout.endswith("\n"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
