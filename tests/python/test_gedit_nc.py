"""`gedit_nc` (plan §7.10, WP4.6), against the goldens the TypeScript core is held to.

The point of this file is **parity**. ``tests/fixtures/tokens/<profileId>.json`` and
``tests/fixtures/numberformat.cases.json`` are read by `src/lib/core/nc/tokenizer.test.ts`
and `numberFormat.test.ts` as well, so a difference between the two implementations shows
up here or there rather than in a customer's program. When one of them has to change, the
fixture changes with it and both sides are re-run — never one side alone.

Everything else below is about a rule that is easier to read as a sentence than as a
fixture line: the profile patterns compiling in Python at all, the feed-mode interpreter,
the two ways a selection run is primed from the lines above it, and the two output shapes.
"""

from __future__ import annotations

import json
import re
import unittest

from tests.python import helpers

#: The golden fields, and the attribute each one is called in Python.
FIELDS = {
    "kind": "kind",
    "start": "start",
    "end": "end",
    "text": "text",
    "address": "address",
    "valueText": "value_text",
    "incremental": "incremental",
}

#: The fields an entry has to spell out when the token carries them, so this file cannot
#: go quiet about one of them. `tokenizer.test.ts` asserts the same thing.
SPELLED_OUT = ["address", "valueText", "incremental"]

KEEP = {"decimals": "keep", "trailingZeros": "keep", "keepPoint": True, "plusSign": "keep"}

gedit_nc = helpers.import_gedit_nc()


def code_tokens(tokens):
    """The tokens a golden entry describes: everything but whitespace."""
    return [token for token in tokens if token.kind != "whitespace"]


def dump(tokens):
    """A short, readable dump of a line's tokens, used in failure messages."""
    return " ".join(
        "%s:%s%s" % (token.kind, token.text, "" if token.address is None else "[%s]" % token.address)
        for token in code_tokens(tokens)
    )


class TestTokenGoldens(unittest.TestCase):
    """The same entries `src/lib/core/nc/tokenizer.test.ts` runs, token for token."""

    def goldens(self, profile_id):
        return helpers.load_json(helpers.FIXTURES_DIR / "tokens" / (profile_id + ".json"))

    def test_the_goldens_exist_for_every_built_in_profile(self):
        for profile_id in helpers.profile_ids():
            with self.subTest(profile=profile_id):
                self.assertTrue((helpers.FIXTURES_DIR / "tokens" / (profile_id + ".json")).is_file())
                self.assertGreaterEqual(len(self.goldens(profile_id)), 60)

    def test_every_golden_line_tokenizes_the_way_typescript_does(self):
        for profile_id in helpers.profile_ids():
            cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
            for number, entry in enumerate(self.goldens(profile_id), 1):
                with self.subTest(profile=profile_id, line=number, text=entry["line"]):
                    previous = gedit_nc.LineState(**entry["prev"]) if "prev" in entry else None
                    tokens, state = gedit_nc.tokenize_line(entry["line"], cp, previous)
                    actual = code_tokens(tokens)
                    self.assertEqual(len(actual), len(entry["tokens"]), dump(tokens))

                    for i, want in enumerate(entry["tokens"]):
                        got = actual[i]
                        for key, value in want.items():
                            self.assertEqual(getattr(got, FIELDS[key]), value, "%s: %s" % (key, dump(tokens)))
                        for key in SPELLED_OUT:
                            value = getattr(got, FIELDS[key])
                            if value is not None and value is not False:
                                self.assertIn(key, want, "token %d of %r" % (i + 1, entry["line"]))

                    self.assertEqual(state.continuation, entry.get("state", {"continuation": False})["continuation"])

    def test_the_tokens_of_a_golden_line_cover_it_without_a_gap(self):
        for profile_id in helpers.profile_ids():
            cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
            for entry in self.goldens(profile_id):
                with self.subTest(profile=profile_id, text=entry["line"]):
                    line = entry["line"]
                    tokens, _ = gedit_nc.tokenize_line(line, cp, gedit_nc.LineState(False))
                    at = 0
                    for token in tokens:
                        self.assertEqual(token.start, at, dump(tokens))
                        self.assertEqual(token.text, line[token.start : token.end], dump(tokens))
                        at = token.end
                    self.assertEqual(at, len(line), dump(tokens))


class TestNumberFormatGoldens(unittest.TestCase):
    """The same table `src/lib/core/nc/numberFormat.test.ts` runs, case for case."""

    @classmethod
    def setUpClass(cls):
        cls.cases = helpers.load_json(helpers.FIXTURES_DIR / "numberformat.cases.json")

    def test_the_table_holds_the_cases_the_plan_asks_for(self):
        self.assertGreaterEqual(len(self.cases), 40)

    def test_every_case_formats_the_way_typescript_does(self):
        for number, case in enumerate(self.cases, 1):
            with self.subTest(case=number, note=case.get("note", "")):
                original = None if case["original"] is None else gedit_nc.parse_number(case["original"])
                if case["original"] is not None:
                    self.assertIsNotNone(original, "original %r does not parse" % case["original"])
                self.assertEqual(
                    gedit_nc.format_number(case["decimal"], original, case["fmt"], case["significant"]),
                    case["expected"],
                )

    def test_a_literal_nothing_changed_comes_back_exactly_as_it_was_written(self):
        for raw in ["10", "10.", ".15", "-0.5", "+3", "1234.5678", "0.000", "10.500", "+0"]:
            with self.subTest(raw=raw):
                original = gedit_nc.parse_number(raw)
                self.assertIsNotNone(original)
                self.assertEqual(gedit_nc.format_number(raw, original, KEEP), raw)

    def test_the_decimal_point_is_significant_unless_told_otherwise(self):
        original = gedit_nc.parse_number("10.")
        fmt = dict(KEEP, keepPoint=False)
        self.assertEqual(gedit_nc.format_number("10", original, fmt), "10.")
        self.assertEqual(gedit_nc.format_number("10", original, fmt, False), "10")

    def test_rounding_is_half_away_from_zero_never_to_the_even_digit(self):
        fmt = {"decimals": 0, "trailingZeros": "drop", "keepPoint": False, "plusSign": "never"}
        self.assertEqual(
            [gedit_nc.format_number(raw, None, fmt) for raw in ["0.5", "1.5", "2.5", "3.5", "4.5"]],
            ["1", "2", "3", "4", "5"],
        )
        self.assertEqual(
            [gedit_nc.format_number(raw, None, fmt) for raw in ["-0.5", "-1.5", "-2.5"]],
            ["-1", "-2", "-3"],
        )

    def test_a_value_that_is_not_a_number_is_refused_rather_than_guessed(self):
        for raw in ["", "ten", "1.2.3", "10mm", "#101", "1e3"]:
            with self.subTest(raw=raw):
                self.assertIsNone(gedit_nc.parse_number(raw))
                with self.assertRaises(ValueError):
                    gedit_nc.format_number(raw, None, KEEP)


class TestParseNumber(unittest.TestCase):
    def test_the_parts_are_the_ones_the_typescript_contract_names(self):
        cases = {
            "-10.": ("-", "10", "", True),
            ".5": ("", "", "5", True),
            "10": ("", "10", None, False),
            "+0": ("+", "0", None, False),
            "0.000": ("", "0", "000", True),
        }
        for raw, (sign, int_part, frac_part, has_point) in cases.items():
            with self.subTest(raw=raw):
                value = gedit_nc.parse_number(raw)
                self.assertIsNotNone(value)
                self.assertEqual(
                    (value.raw, value.sign, value.int_part, value.frac_part, value.has_point),
                    (raw, sign, int_part, frac_part, has_point),
                )


class TestScaleDecimal(unittest.TestCase):
    def test_the_arithmetic_is_exact_and_never_reaches_a_float(self):
        self.assertEqual(gedit_nc.scale_decimal("1234.5", "90"), "1111.05")
        self.assertEqual(gedit_nc.scale_decimal("0.1", "3"), "0.003")
        self.assertEqual(gedit_nc.scale_decimal("-2.5", "40"), "-1")
        self.assertEqual(gedit_nc.scale_decimal("400.", "100"), "400")
        # 0.1 * 3 is 0.30000000000000004 in binary floating point; not here.
        self.assertEqual(gedit_nc.scale_decimal("0.1", "300"), "0.3")
        self.assertEqual(gedit_nc.scale_decimal("1234.5678", "100"), "1234.5678")

    def test_a_tiny_result_is_still_a_decimal_string_and_not_an_exponent(self):
        scaled = gedit_nc.scale_decimal("0.0001", "1")
        self.assertEqual(scaled, "0.000001")
        self.assertNotIn("E", scaled.upper())
        self.assertIsNotNone(gedit_nc.parse_number(scaled))

    def test_the_written_form_comes_from_the_original_and_not_from_the_scale(self):
        # `10.500` scaled by 100 % is the same number; the zeros come back because the
        # literal had them, not because the arithmetic kept them.
        original = gedit_nc.parse_number("10.500")
        self.assertEqual(gedit_nc.scale_decimal("10.500", "100"), "10.5")
        self.assertEqual(gedit_nc.format_number("10.5", original, KEEP), "10.500")

    def test_a_result_that_is_zero_never_comes_back_signed(self):
        self.assertEqual(gedit_nc.format_number(gedit_nc.scale_decimal("-2.5", "0"), None, KEEP), "0")

    def test_a_result_can_be_written_back_through_format_number(self):
        original = gedit_nc.parse_number("1234.5")
        self.assertEqual(gedit_nc.format_number(gedit_nc.scale_decimal("1234.5", "90"), original, KEEP), "1111.1")

    def test_what_is_not_a_number_is_refused(self):
        with self.assertRaises(ValueError):
            gedit_nc.scale_decimal("F100", "90")
        with self.assertRaises(ValueError):
            gedit_nc.scale_decimal("100", "ninety")


class TestToPyRegex(unittest.TestCase):
    def test_a_named_group_becomes_the_python_spelling(self):
        self.assertEqual(gedit_nc.to_py_regex("^O(?<name>\\d+)"), "^O(?P<name>\\d+)")

    def test_a_lookbehind_is_not_a_named_group(self):
        for pattern in ["(?<![A-Z])T(\\d+)", "(?<=N)\\d+", "(?<!\\d)(?<=[A-Z])X"]:
            with self.subTest(pattern=pattern):
                self.assertEqual(gedit_nc.to_py_regex(pattern), pattern)

    def test_a_character_class_and_an_escape_are_left_alone(self):
        self.assertEqual(gedit_nc.to_py_regex(r"[(?<a>]"), r"[(?<a>]")
        self.assertEqual(gedit_nc.to_py_regex(r"\(?<a>"), r"\(?<a>")

    def test_both_kinds_survive_in_one_pattern(self):
        self.assertEqual(
            gedit_nc.to_py_regex("(?<![A-Z])T(?<tool>\\d+)(?!\\d)"),
            "(?<![A-Z])T(?P<tool>\\d+)(?!\\d)",
        )


class TestCompileProfile(unittest.TestCase):
    """Every pattern of every built-in profile has to compile in Python (plan AD-11)."""

    def test_every_pattern_of_every_built_in_profile_compiles(self):
        for profile_id in helpers.profile_ids():
            with self.subTest(profile=profile_id):
                cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
                self.assertEqual(cp.profile["id"], profile_id)
                for name in [
                    "detect_content",
                    "tool_trigger",
                    "tool",
                    "program_start",
                    "program_end",
                    "outline",
                    "references",
                ]:
                    self.assertIn(name, cp.patterns)
                self.assertTrue(cp.patterns["outline"])
                self.assertTrue(cp.patterns["detect_content"])

    def test_the_named_groups_the_features_read_survive_the_rewrite(self):
        for profile_id in helpers.profile_ids():
            with self.subTest(profile=profile_id):
                cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
                self.assertIn("tool", cp.patterns["tool"].groupindex)
                for regex in cp.patterns["program_start"]:
                    self.assertIn("name", regex.groupindex)

    def test_the_keywords_are_upper_case_and_longest_first(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("heidenhain-klartext"))
        self.assertEqual(cp.keywords, sorted(cp.keywords, key=lambda word: (-len(word), word)))
        self.assertTrue(all(word == word.upper() for word in cp.keywords))
        self.assertLess(cp.keywords.index("LBL"), cp.keywords.index("L"))

    def test_the_flags_follow_the_profiles_case_rule(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("fanuc-gcode"))
        self.assertTrue(cp.flags & re.ASCII)
        self.assertTrue(cp.flags & re.IGNORECASE)
        strict = gedit_nc.compile_profile({"syntax": {"caseSensitive": True}, "toolCall": {"trigger": "M6", "tool": "T"}})
        self.assertFalse(strict.flags & re.IGNORECASE)

    def test_ascii_digits_only_so_a_comment_cannot_smuggle_a_number_in(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("fanuc-gcode"))
        self.assertIsNone(cp.patterns["tool"].search("T١٢"))  # Eastern Arabic 12

    def test_a_broken_pattern_names_the_field_it_came_from(self):
        profile = helpers.load_profile("fanuc-gcode")
        profile["outline"][2]["pattern"] = "M0*[01"
        with self.assertRaises(ValueError) as caught:
            gedit_nc.compile_profile(profile)
        self.assertIn("outline[2].pattern", str(caught.exception))

    def test_a_missing_required_pattern_is_an_error_and_not_a_silent_default(self):
        profile = helpers.load_profile("fanuc-gcode")
        del profile["toolCall"]["trigger"]
        with self.assertRaises(ValueError) as caught:
            gedit_nc.compile_profile(profile)
        self.assertIn("toolCall.trigger", str(caught.exception))


class TestMaskComments(unittest.TestCase):
    def setUp(self):
        self.fanuc = gedit_nc.compile_profile(helpers.load_profile("fanuc-gcode"))
        self.klartext = gedit_nc.compile_profile(helpers.load_profile("heidenhain-klartext"))

    def test_a_comment_is_blanked_and_the_offsets_stay(self):
        line = "G0 X0. (T1 M6) Y0."
        masked = gedit_nc.mask_comments(line, self.fanuc)
        self.assertEqual(len(masked), len(line))
        self.assertEqual(masked, "G0 X0.         Y0.")

    def test_a_tool_change_inside_a_comment_is_not_a_tool_change(self):
        masked = gedit_nc.mask_comments("(T1 M6)", self.fanuc)
        self.assertIsNone(self.fanuc.patterns["tool_trigger"].search(masked))

    def test_a_klartext_comment_gives_the_continuation_marker_back(self):
        line = "5 CYCL DEF 200 ; DRILLING ~"
        masked = gedit_nc.mask_comments(line, self.klartext)
        self.assertTrue(masked.endswith("~"))
        self.assertEqual(len(masked), len(line))

    def test_a_string_is_code_and_a_marker_inside_it_opens_nothing(self):
        line = '5 TOOL CALL "D;10" Z S1000'
        self.assertEqual(gedit_nc.mask_comments(line, self.klartext), line)

    def test_a_section_heading_is_text_from_the_star_on(self):
        line = "4 * - TOOL CALL 5"
        masked = gedit_nc.mask_comments(line, self.klartext)
        self.assertEqual(masked, "4 " + " " * (len(line) - 2))
        self.assertIsNone(self.klartext.patterns["tool_trigger"].search(masked))

    def test_a_line_without_a_comment_comes_back_unchanged(self):
        self.assertEqual(gedit_nc.mask_comments("G0X0Y0", self.fanuc), "G0X0Y0")


class TestBlockNumberOf(unittest.TestCase):
    def test_the_span_covers_the_prefix_so_a_renumber_can_replace_it(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("fanuc-gcode"))
        self.assertEqual(
            gedit_nc.block_number_of("N120 X10.", cp),
            {"value": 120, "text": "120", "start": 0, "end": 4},
        )
        self.assertEqual(gedit_nc.block_number_of("/1N90X0.", cp)["value"], 90)
        self.assertIsNone(gedit_nc.block_number_of("G0X0", cp))

    def test_klartext_numbers_the_block_with_a_leading_integer(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("heidenhain-klartext"))
        self.assertEqual(gedit_nc.block_number_of("12 L X+10", cp)["text"], "12")
        self.assertIsNone(gedit_nc.block_number_of("L X+10", cp))


class TestNormalizeCode(unittest.TestCase):
    def test_it_answers_the_same_canonical_form_as_the_typescript_lookup(self):
        cases = {
            "g01": "G1",
            "G00": "G0",
            "M06": "M6",
            "G54.1": "G54.1",
            "cycl  def 200": "CYCL DEF 200",
            "G 83": "G83",
            "CALL LBL": "CALL LBL",
        }
        for written, canonical in cases.items():
            with self.subTest(written=written):
                self.assertEqual(gedit_nc.normalize_code(written), canonical)


class TestNumberFormatOf(unittest.TestCase):
    def test_a_profile_without_a_number_format_gets_the_one_that_changes_nothing(self):
        fmt = gedit_nc.number_format_of(helpers.load_profile("fanuc-gcode"))
        self.assertEqual(fmt, {"decimals": "keep", "trailingZeros": "keep", "keepPoint": True, "plusSign": "keep"})
        original = gedit_nc.parse_number("10.500")
        self.assertEqual(gedit_nc.format_number("10.500", original, fmt), "10.500")

    def test_what_the_profile_does_say_wins(self):
        fmt = gedit_nc.number_format_of({"numberFormat": {"decimals": 2, "plusSign": "always"}})
        self.assertEqual(fmt["decimals"], 2)
        self.assertEqual(fmt["plusSign"], "always")
        self.assertEqual(fmt["trailingZeros"], "keep")


class TestFeedModeTracker(unittest.TestCase):
    """The modal state scale-feed and scale-speed read (WP4.7)."""

    def setUp(self):
        self.fanuc_profile = helpers.load_profile("fanuc-gcode")
        self.klartext_profile = helpers.load_profile("heidenhain-klartext")
        self.fanuc = gedit_nc.compile_profile(self.fanuc_profile)
        self.klartext = gedit_nc.compile_profile(self.klartext_profile)

    def walk(self, cp, profile, lines):
        """Runs ``lines`` through a tracker and yields its state after each one."""
        tracker = gedit_nc.FeedModeTracker(helpers.load_codes(profile))
        state = None
        out = []
        for line in lines:
            tokens, state = gedit_nc.tokenize_line(line, cp, state)
            tracker.update(tokens)
            out.append((tracker.feed_mode, tracker.css, tracker.active_cycle, tracker.pitch_feed))
        return out

    def test_a_fresh_tracker_is_per_minute_with_nothing_else_on(self):
        tracker = gedit_nc.FeedModeTracker()
        self.assertEqual((tracker.feed_mode, tracker.css, tracker.active_cycle, tracker.pitch_feed), ("G94", False, None, False))

    def test_the_iso_feed_modes_are_modal(self):
        states = self.walk(self.fanuc, self.fanuc_profile, ["G94 G1 X0. F100.", "X10.", "G95 F0.15", "X20.", "G93 F12.5", "G94"])
        self.assertEqual([state[0] for state in states], ["G94", "G94", "G95", "G95", "G93", "G94"])

    def test_constant_surface_speed_is_on_between_g96_and_g97(self):
        states = self.walk(self.fanuc, self.fanuc_profile, ["G97 S1000", "G96 S180", "G1 X10. F0.2", "G97 S1200"])
        self.assertEqual([state[1] for state in states], [False, True, True, False])

    def test_a_tapping_cycle_carries_a_pitch_feed_until_it_is_cancelled(self):
        states = self.walk(
            self.fanuc,
            self.fanuc_profile,
            ["G98G84X20.Y20.Z-15.R5.F450.", "X80.", "Y60.", "G80", "G1X0.F300."],
        )
        self.assertEqual([state[3] for state in states], [True, True, True, False, False])
        self.assertEqual(states[0][2], "G84")
        self.assertIsNone(states[3][2])

    def test_a_drilling_cycle_is_active_but_its_feed_is_a_feed(self):
        states = self.walk(self.fanuc, self.fanuc_profile, ["G98G81X10.Y10.Z-5.R2.F200.", "X20.", "G80"])
        self.assertEqual([state[2] for state in states], ["G81", "G81", None])
        self.assertEqual([state[3] for state in states], [False, False, False])

    def test_a_motion_code_cancels_a_cycle_the_way_the_control_does(self):
        states = self.walk(self.fanuc, self.fanuc_profile, ["G98G81X10.Y10.Z-5.R2.F200.", "G0Z25."])
        self.assertEqual([state[2] for state in states], ["G81", None])

    def test_a_threading_pass_is_a_pitch_feed_although_it_is_a_motion_code(self):
        states = self.walk(self.fanuc, self.fanuc_profile, ["G32X20.Z-10.F1.5", "G0X30."])
        self.assertEqual([state[3] for state in states], [True, False])

    def test_klartext_reads_the_cycle_out_of_its_multi_word_code(self):
        states = self.walk(
            self.klartext,
            self.klartext_profile,
            ["5 CYCL DEF 207 RIGID TAPPING ~", "   Q239=+1.25 ;THREAD PITCH", "6 L X+10 R0 FMAX M99"],
        )
        self.assertEqual([state[2] for state in states], ["CYCL DEF 207", "CYCL DEF 207", None])
        self.assertEqual([state[3] for state in states], [True, True, False])

    def test_klartext_feed_per_tooth_and_per_revolution_are_modes_a_plain_feed_ends(self):
        states = self.walk(
            self.klartext,
            self.klartext_profile,
            ["18 TOOL CALL 8 Z S4000 FZ0.05", "19 L X+10", "20 L X-10 FU0.12", "21 L IY+5 F800"],
        )
        self.assertEqual([state[0] for state in states], ["FZ", "FZ", "FU", "G94"])

    def test_a_feed_in_a_comment_never_reaches_the_tracker(self):
        states = self.walk(self.fanuc, self.fanuc_profile, ["(G95 F0.15)", "G1X10.F200."])
        self.assertEqual([state[0] for state in states], ["G94", "G94"])

    def test_without_a_code_database_an_unknown_dialect_stays_silent(self):
        states = self.walk(self.fanuc, {"codes": ""}, ["G98G84X20.Z-15.R5.F450."])
        self.assertEqual(states[0][2], None)
        self.assertFalse(states[0][3])
        # The feed modes are named by §7.10 itself, so they work without a database too.
        self.assertEqual(self.walk(self.fanuc, {"codes": ""}, ["G95 F0.15"])[0][0], "G95")


class TestPrecedingLines(unittest.TestCase):
    """Which contexts may prime a tracker, and which may not (WP5.4).

    `input.precedingLines` is optional, and the answer to "may I use it" has to be one
    place, because three bundled scripts and every user script ask it. A field that is
    there but not trustworthy has to read as absent: an absent one keeps the loud "this
    run could not see above the selection" warning, while a half-filled one primes the
    tracker with the tail of a program and is confidently wrong.
    """

    def context(self, **input_fields):
        context = helpers.make_context()
        context["input"] = input_fields
        return context

    def test_all_the_lines_above_a_selection_are_used(self):
        context = self.context(
            scope="selection", startLine=4, endLine=6, precedingLines=["%", "O1000", "G95"]
        )
        self.assertEqual(gedit_nc.preceding_lines(context), ["%", "O1000", "G95"])

    def test_a_field_that_is_short_of_start_line_minus_one_is_refused(self):
        # The contract says to omit the field rather than truncate it; this is where that
        # rule is enforced on the Python side.
        context = self.context(scope="selection", startLine=40, endLine=42, precedingLines=["G95"])
        self.assertEqual(gedit_nc.preceding_lines(context), [])

    def test_a_field_that_is_longer_than_start_line_minus_one_is_refused(self):
        context = self.context(
            scope="selection", startLine=2, endLine=3, precedingLines=["%", "O1000"]
        )
        self.assertEqual(gedit_nc.preceding_lines(context), [])

    def test_a_document_or_none_run_never_uses_it(self):
        for scope in ("document", "none"):
            with self.subTest(scope=scope):
                context = self.context(
                    scope=scope, startLine=1, endLine=9, precedingLines=["G95"]
                )
                self.assertEqual(gedit_nc.preceding_lines(context), [])

    def test_anything_that_is_not_a_list_of_strings_is_refused(self):
        for value in (None, "G95", [1, 2], ["G95", 7], {}, []):
            with self.subTest(value=value):
                context = self.context(
                    scope="selection", startLine=3, endLine=4, precedingLines=value
                )
                self.assertEqual(gedit_nc.preceding_lines(context), [])

    def test_a_v1_context_answers_nothing_rather_than_raising(self):
        for context in ({}, {"input": None}, {"input": {"scope": "selection"}}):
            with self.subTest(context=context):
                self.assertEqual(gedit_nc.preceding_lines(context), [])


class TestPrimeTracker(unittest.TestCase):
    """The lines above a selection, walked into a tracker (WP5.4)."""

    def setUp(self):
        self.profile = helpers.load_profile("fanuc-gcode")
        self.codes = helpers.load_codes(self.profile)
        self.cp = gedit_nc.compile_profile(self.profile)
        self.klartext_profile = helpers.load_profile("heidenhain-klartext")
        self.klartext = gedit_nc.compile_profile(self.klartext_profile)

    def primed(self, lines, cp=None, codes=None):
        tracker = gedit_nc.FeedModeTracker(self.codes if codes is None else codes)
        state = gedit_nc.prime_tracker(tracker, lines, cp or self.cp)
        return tracker, state

    def test_a_feed_mode_set_above_the_selection_is_in_force_after_priming(self):
        tracker, _ = self.primed(["%", "O1000", "G21 G90", "G95"])
        self.assertEqual(tracker.feed_mode, "G95")

    def test_an_open_cycle_and_its_thread_pitch_survive(self):
        tracker, _ = self.primed(["M29 S500", "G98 G84 X20. Z-12. R3. F625."])
        self.assertEqual((tracker.active_cycle, tracker.pitch_feed), ("G84", True))

    def test_constant_surface_speed_survives(self):
        tracker, _ = self.primed(["G50 S2500", "G96 S180 M3"])
        self.assertTrue(tracker.css)

    def test_a_cancelled_cycle_does_not(self):
        tracker, _ = self.primed(["G98 G84 X20. Z-12. R3. F625.", "G80"])
        self.assertEqual((tracker.active_cycle, tracker.pitch_feed), (None, False))

    def test_a_modal_ambiguity_survives_and_a_non_modal_one_does_not(self):
        # G76 is a modal cycle: it is still open at the first selected block. G92 is not,
        # so its ambiguity belonged to the block that wrote it and to no other — and the
        # first selected line is a different block.
        modal, _ = self.primed(["G76 X18.16 Z-20. P1190 Q350 F2.0"])
        self.assertEqual((modal.pitch_feed_ambiguous, modal.ambiguous_code), (True, "G76"))
        block, _ = self.primed(["G92 X19.5 F2.0"])
        self.assertEqual((block.pitch_feed_ambiguous, block.ambiguous_code), (False, None))

    def test_it_answers_the_line_state_the_next_line_begins_in(self):
        _, state = self.primed(
            ["4 CYCL DEF 200 DRILLING ~", "   Q200=2 ;CLEARANCE ~"],
            cp=self.klartext,
            codes=helpers.load_codes(self.klartext_profile),
        )
        self.assertTrue(state.continuation)
        _, ended = self.primed(
            ["4 CYCL DEF 200 DRILLING ~", "   Q204=50 ;2ND CLEARANCE"],
            cp=self.klartext,
            codes=helpers.load_codes(self.klartext_profile),
        )
        self.assertFalse(ended.continuation)

    def test_no_lines_leave_the_tracker_at_the_top_of_a_program(self):
        tracker, state = self.primed([])
        self.assertEqual((tracker.feed_mode, tracker.css, tracker.active_cycle), ("G94", False, None))
        self.assertIsNone(state)

    def test_priming_reaches_the_same_state_as_walking_the_whole_program(self):
        """The property that makes this a fix and not a heuristic.

        A primed run over lines 5..6 has to stand exactly where a run over 1..6 stands
        when it reaches line 5 — otherwise the selection is read in a third state that is
        neither the fragment's nor the document's.
        """
        program = ["%", "O1000", "G21 G90", "G95", "M29 S500", "G98 G84 X20. Z-12. R3. F625."]
        whole = gedit_nc.FeedModeTracker(self.codes)
        state = None
        for line in program:
            tokens, state = gedit_nc.tokenize_line(line, self.cp, state)
            whole.update(tokens)
        part, _ = self.primed(program)
        self.assertEqual(
            (part.feed_mode, part.css, part.active_cycle, part.pitch_feed),
            (whole.feed_mode, whole.css, whole.active_cycle, whole.pitch_feed),
        )


class TestBundledFolderStaysShippable(unittest.TestCase):
    def test_no_compiled_bytecode_is_left_where_it_would_be_bundled(self):
        # `tauri build` copies this folder into the app as a resource, untracked files
        # included, so a `__pycache__` left by a test run or a manual `python gedit_nc.py`
        # would ship. Everything that imports the module sets `-B` or
        # `PYTHONDONTWRITEBYTECODE`; if this fails, delete the folder and find what did not.
        stray = sorted(path.name for path in helpers.SCRIPTS_DIR.glob("__pycache__"))
        stray += sorted(path.name for path in helpers.SCRIPTS_DIR.glob("*.pyc"))
        self.assertEqual(stray, [], "delete %s" % (helpers.SCRIPTS_DIR / "__pycache__"))


class TestReadInputAndContext(unittest.TestCase):
    def test_a_trailing_newline_survives_as_a_final_empty_line(self):
        result = helpers.run_script("gedit_nc.py", stdin="G0 X0\nG1 X1\n", context=helpers.make_context())
        self.assertTrue(result.ok, result.stderr)

    def test_the_module_does_nothing_when_it_is_run_instead_of_imported(self):
        result = helpers.run_script("gedit_nc.py", stdin="G0 X0\n", context=helpers.make_context())
        self.assertEqual((result.stdout, result.stderr), ("", ""))


class TestOutput(unittest.TestCase):
    """`report` and `envelope` write the JSON the results panel and the applier read."""

    SNIPPET = (
        "import sys, json\n"
        "sys.path.insert(0, %r)\n"
        "import gedit_nc\n"
    )

    def run_snippet(self, body):
        import subprocess
        import sys as system

        source = (self.SNIPPET % str(helpers.SCRIPTS_DIR)) + body
        # `-B`: nothing may leave a `.pyc` in the bundled scripts folder, because that
        # folder ships as an app resource (see `tests/python/__init__.py`).
        done = subprocess.run(
            [system.executable, "-B", "-c", source],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(done.returncode, 0, done.stderr.decode("utf-8"))
        return json.loads(done.stdout.decode("utf-8"))

    def test_a_report_carries_the_title_columns_and_rows(self):
        payload = self.run_snippet(
            'gedit_nc.report("Tool list", [{"key": "tool", "label": "T"}], [{"tool": "T1", "line": 12}],\n'
            '                "1 tool", [{"line": 12, "severity": "warning", "message": "check"}])\n'
        )
        self.assertEqual(payload["title"], "Tool list")
        self.assertEqual(payload["columns"], [{"key": "tool", "label": "T"}])
        self.assertEqual(payload["rows"], [{"tool": "T1", "line": 12}])
        self.assertEqual(payload["message"], "1 tool")
        self.assertEqual(payload["findings"][0]["severity"], "warning")

    def test_a_report_without_a_message_or_findings_leaves_them_out(self):
        payload = self.run_snippet('gedit_nc.report("Empty", [], [])\n')
        self.assertEqual(sorted(payload), ["columns", "rows", "title"])

    def test_an_envelope_hands_back_the_text_exactly_as_it_was_given(self):
        payload = self.run_snippet('gedit_nc.envelope("G0 X0\\nG1 X1\\n", "done")\n')
        self.assertEqual(payload["text"], "G0 X0\nG1 X1\n")
        self.assertEqual(payload["message"], "done")

    def test_a_comment_outside_ascii_survives_the_json(self):
        payload = self.run_snippet('gedit_nc.envelope("(GR\\u00d6SSE)\\n")\n')
        self.assertEqual(payload["text"], "(GRÖSSE)\n")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
