"""`address_arithmetic.py` (plan §6 M10 WP10.4; roadmap R3, R6 and R8), against the golden
cases in ``tests/fixtures/scripts/address_arithmetic/`` and the rules of its README.

Each case is a folder: `input.nc` (stdin), `params.json` (the form), the optional
`case.json` (profile, machine, machineName) and `preceding.nc` (the lines above a
selection), and the two goldens `expected.nc` (byte for byte) and `envelope.json` (the
`message` and `findings`). A case with a `machine` runs against the generated
`tests/fixtures/resolved/effective/**` entry; Python never merges a machine.

The programs are synthetic, written for gEdit, and carry the `WRITTEN FOR GEDIT` marker.

What the cases cover, in the plan's words (WP10.4 Tests):

* `Z1000` → `Z500` under IS-B, `Z999.5` under the calculator reading, left and reported
  with no machine, and `Z10.` → `Z9.5` in all three (`fanuc-z-is-b`, `fanuc-z-calculator`,
  `fanuc-z-no-machine`);
* `Z1000` + 0.0005 under IS-B → `Z1001`, reported as rounded (`fanuc-rounded-is-b`);
* an Okuma 10 µm machine: `Z1000` − 0.5 → `Z950`, `Z10.` − 0.5 → `Z-40.` (`okuma-10um`);
* a lathe `Z` − 0.5 with `W` words reported (`lathe-z-shift`);
* Okuma `X=V1+2` skipped (`okuma-expression`);
* multiply by 2 on a `G83 … K3` block leaves `K3` alone (`fanuc-multiply-g83`);
* a Sinumerik `DIAMOF` section: +0.5 as a diameter moves the `DIAMON` words by 0.5 and the
  `DIAMOF` words by 0.25 (`sinumerik-diamof`);
* R8: a Klartext `CYCL DEF 200` whose `Q203` moves with the `Z` words, `CYCL CALL POS`
  refused, a definition the database lacks refused with its call, a `Q203` written as a
  variable refused with its call (`klartext-cycles`, `klartext-modal-call`); a Sinumerik
  `CYCLE83` with its trailing arguments at 0 moved and one with `_AMODE=1` refused
  (`sinumerik-cycle83`); `CYCLE800` and the blocks under it refused (`sinumerik-cycle800`);
  a `TRAORI` section judged and the same `A`/`C` move without it refused, `SUPA` refused
  (`sinumerik-traori`); the `R` plane of a Fanuc drilling cycle moved, a cycle that cannot
  move in one piece refused with every block that runs it, `G53`/`G28` refused, a frame, an
  unknown code (`fanuc-drilling`); a cycle started above a selection (`fanuc-selection-primed`).
"""

from __future__ import annotations

import json
import unittest
from decimal import Decimal

from tests.python import helpers

SCRIPT = "address_arithmetic.py"

try:  # Python 3.11 and newer
    import tomllib  # noqa: F401

    HAS_TOMLLIB = True
except ImportError:  # pragma: no cover - Python 3.9 and 3.10
    HAS_TOMLLIB = False

#: The cases the plan names (WP10.4 Tests and H10 `m10-arith`).
REQUIRED_CASES = [
    "fanuc-z-is-b",
    "fanuc-z-calculator",
    "fanuc-z-no-machine",
    "fanuc-rounded-is-b",
    "okuma-10um",
    "okuma-expression",
    "lathe-z-shift",
    "fanuc-multiply-g83",
    "sinumerik-diamof",
    "klartext-cycles",
    "klartext-modal-call",
    "sinumerik-cycle83",
    "sinumerik-cycle800",
    "sinumerik-traori",
    "fanuc-drilling",
    "fanuc-selection-primed",
    # The M10 review.
    "klartext-polar",
    "sinumerik-arc-geometry",
    "fanuc-rotary-state",
    "fanuc-polar-g16",
    "sinumerik-mill-x-shift",
    "fanuc-multiply-rule",
]

#: The vocabulary of the README: block reasons, word reasons, notes and run notes.
BLOCK_REASONS = {
    "pole",
    "arc-geometry",
    "not-scaled",
    "unknown-code",
    "machine-position",
    "frame",
    "rotary-without-tcp",
    "cycle-outside",
    "cycle-not-reviewed",
    "cycle-position",
    "cycle-mode",
    "cycle-plane",
    "cycle-expression",
    "cycle-unresolved",
}
WORD_REASONS = {"unreadable", "data", "incremental", "expression", "machine-dependent", "count"}
NOTE_REASONS = {"rounded"}
RUN_REASONS = {"selection", "no-database", "unknown-code-note"}


def context_of(case):
    """The context a case runs with: the effective profile and machine (as `test_scale_feed`)."""
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


def run_case(case, **changes):
    context = context_of(case)
    for key, value in changes.items():
        context[key] = value
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)


def envelope_of(case):
    return helpers.load_json(case.directory / "envelope.json")


def case_named(name):
    for case in helpers.script_cases("address_arithmetic"):
        if case.name == name:
            return case
    raise AssertionError("no case %s" % name)


def run(text, profile="fanuc-gcode", preset=None, name=None, **params):
    """Runs the script on a program written inline, with the given form values."""
    context = helpers.effective_context(profile, preset=preset) if preset else helpers.effective_context(profile)
    if name is not None:
        context["machine"]["id"] = name.lower()
        context["machine"]["name"] = name
    context["params"] = dict({"operation": "add", "operand": 0.5}, **params)
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(text.split("\n"))}
    result = helpers.run_script(SCRIPT, stdin=text, context=context)
    if not result.ok:
        raise AssertionError(result.stderr)
    return result.json()


def lines_of(payload):
    return payload["text"].split("\n")


def reasons(payload):
    return [finding["reason"] for finding in payload["findings"]]


def finding_at(payload, line):
    found = [f for f in payload["findings"] if f["line"] == line]
    if len(found) != 1:
        raise AssertionError("expected one finding at line %d, got %r" % (line, found))
    return found[0]


def shape_of(lines, cp):
    """The tokens of a program with the values blanked: kinds and addresses must survive."""
    gedit_nc = helpers.import_gedit_nc()
    out = []
    state = None
    for line in lines:
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        out.append(
            [
                (token.kind, token.address, "<value>" if token.kind in ("word", "call") else token.text)
                for token in tokens
            ]
        )
    return out


class TestGoldenCases(unittest.TestCase):
    def setUp(self):
        self.cases = helpers.script_cases("address_arithmetic")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        self.assertTrue(self.cases, "no address_arithmetic fixtures found")
        names = sorted(case.name for case in self.cases)
        self.assertEqual([name for name in REQUIRED_CASES if name not in names], [])

    def test_every_case_produces_its_expected_text_and_envelope(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                result = run_case(case)
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.stderr, "")
                payload = result.json()
                self.assertEqual(sorted(payload), ["findings", "message", "text"])
                self.assertEqual(payload["text"], case.expected_text())
                self.assertEqual({"message": payload["message"], "findings": payload["findings"]}, envelope_of(case))

    def test_the_output_differs_from_the_input_only_inside_values(self):
        gedit_nc = helpers.import_gedit_nc()
        for case in self.cases:
            with self.subTest(case=case.name):
                cp = gedit_nc.compile_profile(context_of(case)["profile"])
                self.assertEqual(shape_of(case.expected_text().split("\n"), cp), shape_of(case.input_lines(), cp))

    def test_the_trailing_newline_survives(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                self.assertEqual(case.expected_text().endswith("\n"), case.input_text().endswith("\n"))

    def test_every_finding_carries_a_reason_of_the_vocabulary_and_a_line_of_the_selection(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                envelope = envelope_of(case)
                first = len(case.preceding_lines()) + 1
                last = first + len(case.input_lines()) - 1
                for finding in envelope["findings"]:
                    self.assertEqual(sorted(finding), ["line", "message", "reason", "severity"])
                    reason = finding["reason"]
                    if reason in BLOCK_REASONS:
                        self.assertEqual(finding["severity"], "warning")
                    elif reason == "unreadable":
                        self.assertEqual(finding["severity"], "warning")  # M13 review NC-5
                    elif reason in WORD_REASONS or reason in NOTE_REASONS:
                        self.assertEqual(finding["severity"], "info")
                    else:
                        self.assertIn(reason, RUN_REASONS)
                    self.assertTrue(first <= finding["line"] <= last, finding)

    def test_a_refused_block_gets_exactly_one_finding_and_no_word_finding(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                findings = envelope_of(case)["findings"]
                blocks = [f["line"] for f in findings if f["reason"] in BLOCK_REASONS]
                self.assertEqual(len(blocks), len(set(blocks)))
                words = [f["line"] for f in findings if f["reason"] in WORD_REASONS | NOTE_REASONS]
                self.assertEqual([line for line in words if line in blocks], [])

    def test_the_message_ends_with_the_machine(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                message = envelope_of(case)["message"]
                name = case.options.get("machineName")
                if name:
                    self.assertIn("Machine '%s': " % name, message)
                else:
                    self.assertTrue(message.endswith("No machine chosen: words whose reading depends on the machine are left alone."))


class TestPlanCases(unittest.TestCase):
    """The plan's own numbers, read from the goldens' outputs line by line."""

    def text_of(self, name):
        result = run_case(case_named(name))
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_z1000_reads_as_the_machine_reads_it_and_z10_point_is_the_same_everywhere(self):
        for name, z1000 in (("fanuc-z-is-b", "G1 Z500 F200."), ("fanuc-z-calculator", "G1 Z999.5 F200.")):
            with self.subTest(case=name):
                lines = lines_of(self.text_of(name))
                self.assertEqual(lines[6], z1000)
                self.assertEqual(lines[7], "G1 Z9.5")
        payload = self.text_of("fanuc-z-no-machine")
        self.assertEqual(lines_of(payload)[6], "G1 Z1000 F200.")
        self.assertEqual(lines_of(payload)[7], "G1 Z9.5")
        self.assertEqual(finding_at(payload, 7)["reason"], "machine-dependent")
        self.assertIn("choose a machine", finding_at(payload, 7)["message"])

    def test_a_rounded_result_is_written_and_reported(self):
        payload = self.text_of("fanuc-rounded-is-b")
        self.assertEqual(lines_of(payload)[4], "G1 Z1001 F200.")
        self.assertEqual(finding_at(payload, 5)["reason"], "rounded")

    def test_an_okuma_unit_scales_a_word_with_a_point_too(self):
        lines = lines_of(self.text_of("okuma-10um"))
        self.assertEqual(lines[4], "G1 Z950 F0.2")
        self.assertEqual(lines[5], "G1 Z-40.")

    def test_a_lathe_shift_reports_the_w_words(self):
        payload = self.text_of("lathe-z-shift")
        self.assertEqual(lines_of(payload)[6], "G1 Z-10.5 F0.2")
        self.assertEqual(lines_of(payload)[7], "W-5.")
        self.assertEqual(finding_at(payload, 8)["reason"], "incremental")

    def test_an_okuma_expression_is_left(self):
        payload = self.text_of("okuma-expression")
        self.assertEqual(lines_of(payload)[3], "G90 G0 X=V1+2 Z10.5")
        self.assertEqual([f["reason"] for f in payload["findings"] if f["line"] == 4], ["expression"])

    def test_multiply_leaves_the_count_of_a_g83_alone(self):
        payload = self.text_of("fanuc-multiply-g83")
        self.assertEqual(lines_of(payload)[6], "G81 X10. Y10. Z-10. R4. F100. K3")
        self.assertEqual(finding_at(payload, 7)["reason"], "count")
        # M10 review (CODE-8): the peck depth Q is a distance a multiply does not scale, so
        # the G83 and its positions are left whole and listed.
        self.assertEqual(lines_of(payload)[9], "G83 X30. Y10. Z-5. R2. Q1. F100.")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (10, 11)], ["not-scaled"] * 2)
        # Only Z is chosen, so only its centre word K is an arc centre here; I and J stay.
        self.assertEqual(lines_of(payload)[12], "G2 X10. Y0. I5. J0. Z-4.")
        # An incremental distance scales like a position.
        self.assertEqual(lines_of(payload)[13], "G91 G1 Z-2.")

    def test_a_diamof_section_moves_by_half_the_diameter(self):
        lines = lines_of(self.text_of("sinumerik-diamof"))
        self.assertEqual(lines[3], "N20 G0 X50.5 Z2")
        self.assertEqual(lines[6], "N50 G1 X20.25 Z-20")
        self.assertEqual(lines[8], "N70 G1 X30.5 Z-25")

    def test_klartext_q203_moves_with_z_and_a_call_with_its_own_position_is_refused(self):
        payload = self.text_of("klartext-cycles")
        lines = lines_of(payload)
        self.assertEqual(lines[12], "  Q203=+0.5 ;SURFACE ~")
        self.assertEqual(lines[24], "  Q203=-2 ;SURFACE ~")
        self.assertEqual(finding_at(payload, 29)["reason"], "cycle-position")
        self.assertEqual(finding_at(payload, 19)["reason"], "cycle-position")

    def test_sinumerik_cycle_positions_move_unless_a_mode_says_otherwise(self):
        payload = self.text_of("sinumerik-cycle83")
        lines = lines_of(payload)
        self.assertEqual(lines[4], "N40 CYCLE81(10.5,0.5,2,-29.5,,1)")
        self.assertEqual(lines[5], "N50 MCALL CYCLE83(10.5, 0.5, 2, -29.5, , -4.5, , 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0)")
        self.assertEqual(finding_at(payload, 10)["reason"], "cycle-mode")

    def test_the_blocks_of_a_cycle800_frame_are_refused(self):
        payload = self.text_of("sinumerik-cycle800")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (6, 7, 8)], ["frame"] * 3)
        self.assertEqual(lines_of(payload)[4], "N40 G0 Z50.5")
        self.assertEqual(lines_of(payload)[9], "N90 G0 Z100.5")

    def test_a_rotary_move_is_judged_under_traori_and_refused_without_it(self):
        payload = self.text_of("sinumerik-traori")
        # The first block that writes A and C ends at A0 C0, where Z is a height above the part.
        self.assertEqual(lines_of(payload)[2], "N20 G0 X0 Y0 Z100.5 A0 C0")
        self.assertEqual(lines_of(payload)[4], "N40 G1 X10 Y0 Z5.5 A30 C45 F500")
        self.assertEqual(finding_at(payload, 7)["reason"], "rotary-without-tcp")
        self.assertEqual(finding_at(payload, 9)["reason"], "machine-position")


class TestRules(unittest.TestCase):
    def test_only_the_chosen_address_changes(self):
        payload = run("G90 G17\nG1 X10. Y10. Z5. F100.\n", addresses=["Z"])
        self.assertEqual(lines_of(payload)[1], "G1 X10. Y10. Z5.5 F100.")

    def test_a_comment_is_never_touched(self):
        payload = run("G90 G17\nG1 Z5. (Z10.)\n")
        self.assertEqual(lines_of(payload)[1], "G1 Z5.5 (Z10.)")

    def test_the_operations(self):
        program = "G90 G17\nG1 Z10.\n"
        expected = {"add": "G1 Z10.5", "subtract": "G1 Z9.5", "multiply": "G1 Z5.", "divide": "G1 Z20."}
        for operation, line in expected.items():
            with self.subTest(operation=operation):
                self.assertEqual(lines_of(run(program, operation=operation, operand=0.5))[1], line)

    def test_a_negative_factor_flips_the_sign(self):
        self.assertEqual(lines_of(run("G90 G17\nG1 Z10.\n", operation="multiply", operand=-1))[1], "G1 Z-10.")

    def test_arc_centres_are_left_when_adding_and_included_when_multiplying(self):
        program = "G90 G17\nG2 X10. Y0. I5. J0.\n"
        self.assertEqual(lines_of(run(program, addresses=["X"]))[1], "G2 X10.5 Y0. I5. J0.")
        self.assertEqual(lines_of(run(program, addresses=["X"], arcCentres="yes"))[1], "G2 X10.5 Y0. I5.5 J0.")
        self.assertEqual(lines_of(run(program, operation="multiply", operand=2, addresses=["X"]))[1], "G2 X20. Y0. I10. J0.")
        self.assertEqual(lines_of(run(program, operation="multiply", operand=2, addresses=["X"], arcCentres="no"))[1], "G2 X20. Y0. I5. J0.")

    def test_the_centre_word_of_a_diameter_axis_moves_as_a_radius(self):
        payload = run("G18 G90\nG2 X50. Z-10. I2. K0.\n", profile="fanuc-lathe", addresses=["X"], arcCentres="yes")
        self.assertEqual(lines_of(payload)[1], "G2 X50.5 Z-10. I2.25 K0.")

    def test_a_count_chosen_explicitly_is_changed(self):
        payload = run("G90 G17\nG83 X10. Y10. Z-5. R2. Q1. F100. K3\nG80\n", operation="multiply", operand=2, addresses=["K"])
        self.assertEqual(lines_of(payload)[1], "G83 X10. Y10. Z-5. R2. Q1. F100. K6")

    def test_the_r_plane_moves_with_z_and_alone_when_r_is_chosen(self):
        program = "G90 G17\nG81 X10. Y10. Z-5. R2. F100.\nX20. R3.\nG80\n"
        self.assertEqual(lines_of(run(program))[1:3], ["G81 X10. Y10. Z-4.5 R2.5 F100.", "X20. R3.5"])
        self.assertEqual(lines_of(run(program, addresses=["R"]))[1:3], ["G81 X10. Y10. Z-5. R2.5 F100.", "X20. R3.5"])
        self.assertEqual(lines_of(run(program, addresses=["X"]))[1:3], ["G81 X10.5 Y10. Z-5. R2. F100.", "X20.5 R3."])

    def test_an_incremental_cycle_block_moves_nothing(self):
        payload = run("G90 G17\nG91 G81 X10. Z-7. R-48. F100.\nG90 G80\n")
        self.assertEqual(lines_of(payload)[1], "G91 G81 X10. Z-7. R-48. F100.")
        self.assertEqual(reasons(payload), ["incremental", "incremental"])

    def test_a_cycle_is_moved_in_one_piece_or_not_at_all(self):
        payload = run("G90 G17\nG81 X10. Y10. Z-5. R2. F100.\nX20. Y20.\nX30. Y30. Z#1\nG80\nG1 Z5.\n")
        self.assertEqual(lines_of(payload)[1], "G81 X10. Y10. Z-5. R2. F100.")
        self.assertEqual(lines_of(payload)[5], "G1 Z5.5")
        self.assertEqual(reasons(payload), ["cycle-expression"] * 3)
        self.assertIn("same cycle as line 4", finding_at(payload, 2)["message"])

    def test_a_zero_every_preset_reads_alike_is_still_written_differently_by_each(self):
        # `Z0` is 0 mm on every Fanuc preset, but 0.5 mm is `Z500` in IS-B and `Z0.5` as
        # written: with no machine chosen the word is left, never written the default's way.
        payload = run("G90 G17\nG1 Z0\n")
        self.assertEqual(lines_of(payload)[1], "G1 Z0")
        self.assertEqual(reasons(payload), ["machine-dependent"])
        self.assertEqual(lines_of(run("G90 G17\nG1 Z0\n", preset="is-b", name="Mill"))[1], "G1 Z500")

    def test_a_point_less_cycle_position_without_a_machine_refuses_the_cycle(self):
        payload = run("G90 G17\nG81 X10. Y10. Z-5. R2 F100.\nG80\n")
        self.assertEqual(lines_of(payload)[1], "G81 X10. Y10. Z-5. R2 F100.")
        self.assertEqual(reasons(payload), ["cycle-unresolved"])

    def test_a_cycle_parameter_nobody_reviewed_refuses_the_block(self):
        payload = run("G90 G17\nG81 X10. Y10. Z-5. R2. F100. E5.\nG80\n")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed"])

    def test_a_plane_other_than_xy_refuses_a_cycle_with_a_tool_axis_position(self):
        payload = run("G90 G18\nG81 X10. Y10. Z-5. R2. F100.\nG80\n")
        self.assertEqual(reasons(payload), ["cycle-plane"])
        payload = run("G90\nG81 X10. Y10. Z-5. R2. F100.\nG80\n")
        self.assertEqual(reasons(payload), ["cycle-plane"])

    def test_a_modal_macro_call_refuses_its_positions(self):
        payload = run("G90 G17\nG66 P9001 Z-5.\nX10. Y10.\nG67\nG1 Z5.\n")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed", "cycle-not-reviewed"])
        self.assertEqual(lines_of(payload)[4], "G1 Z5.5")

    def test_machine_positions_are_refused(self):
        payload = run("G90 G17\nG53 Z0.\nG28 G91 Z0.\n")
        self.assertEqual(reasons(payload), ["machine-position", "machine-position"])
        payload = run("0 BEGIN PGM T MM\n1 L Z-5 R0 FMAX M91\n2 END PGM T MM\n", profile="heidenhain-klartext")
        self.assertEqual(reasons(payload), ["machine-position"])

    def test_a_frame_refuses_the_blocks_inside_it_until_it_closes(self):
        payload = run("G90 G17\nG68 X0. Y0. R30.\nG1 Z-1.\nG69\nG1 Z-2.\n")
        self.assertEqual(reasons(payload), ["frame", "frame"])
        self.assertEqual(lines_of(payload)[4], "G1 Z-1.5")

    def test_a_scaling_frame_is_not_closed_by_the_rotation_close(self):
        payload = run("G90 G17\nG51 X0. Y0. Z0. P2.\nG69\nG1 Z-2.\nG50\nG1 Z-3.\n")
        self.assertEqual(reasons(payload), ["frame", "frame"])
        self.assertEqual(lines_of(payload)[5], "G1 Z-2.5")

    def test_an_unknown_g_code_refuses_its_block(self):
        payload = run("G90 G17\nG100 Z-3.\n")
        self.assertEqual(reasons(payload), ["unknown-code"])

    def test_data_words_are_left_and_the_rest_of_the_block_changed(self):
        payload = run("G90 G17\nG92 X0. Y0. Z0.\nG52 Z5.\nG10 L2 P1 Z-100.\n")
        self.assertEqual(reasons(payload), ["data", "data", "data"])
        self.assertEqual(lines_of(payload)[1:4], ["G92 X0. Y0. Z0.", "G52 Z5.", "G10 L2 P1 Z-100."])

    def test_an_unknown_distance_mode_leaves_every_word(self):
        payload = run("G17\nG1 Z5.\n")
        self.assertEqual(reasons(payload), ["incremental"])
        self.assertIn("not known", payload["findings"][0]["message"])

    def test_a_rotary_move_without_tcp_is_refused_and_judged_under_it(self):
        program = "G90 G17\nG1 Z5. B30.\nG43.4 H1\nG1 Z5. B30.\nG49\nG1 Z5. B30.\n"
        payload = run(program)
        self.assertEqual([f["line"] for f in payload["findings"]], [2, 6])
        self.assertEqual(lines_of(payload)[3], "G1 Z5.5 B30.")
        # A rotary move that does not move a chosen axis is no shift at all.
        self.assertEqual(run("G90 G17\nG1 X5. B30.\n")["findings"], [])

    def test_klartext_q203_is_absolute_and_its_decimal_comma_survives(self):
        program = "0 BEGIN PGM T MM\n1 TOOL CALL 1 Z S3000\n2 CYCL DEF 200 DRILLING ~\n  Q203=+0,5 ;SURFACE ~\n  Q204=50 ;2ND\n3 L X+10 Y+10 Z+5 R0 FMAX M99\n4 END PGM T MM\n"
        payload = run(program, profile="heidenhain-klartext")
        self.assertEqual(lines_of(payload)[3], "  Q203=+1,0 ;SURFACE ~")
        self.assertEqual(lines_of(payload)[5], "3 L X+10 Y+10 Z+5.5 R0 FMAX M99")

    def test_klartext_without_a_tool_axis_refuses_the_cycle(self):
        program = "0 BEGIN PGM T MM\n1 CYCL DEF 200 DRILLING ~\n  Q203=+0 ;SURFACE\n2 L X+10 Y+10 Z+5 R0 FMAX M99\n3 END PGM T MM\n"
        payload = run(program, profile="heidenhain-klartext")
        self.assertEqual(reasons(payload), ["cycle-plane", "cycle-plane"])
        self.assertEqual(lines_of(payload)[3], "2 L X+10 Y+10 Z+5 R0 FMAX M99")

    def test_klartext_a_call_with_no_cycle_defined_is_refused(self):
        payload = run("0 BEGIN PGM T MM\n1 TOOL CALL 1 Z S3000\n2 L X+10 Y+10 Z+5 R0 FMAX M99\n3 END PGM T MM\n", profile="heidenhain-klartext")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed"])

    def test_klartext_r0_is_a_code_and_never_a_value(self):
        payload = run("0 BEGIN PGM T MM\n1 L X+10 R0 FMAX\n2 CR X+20 Y+0 R+5 DR+\n3 END PGM T MM\n", profile="heidenhain-klartext", addresses=["R"])
        self.assertEqual(lines_of(payload)[1:3], ["1 L X+10 R0 FMAX", "2 CR X+20 Y+0 R+5.5 DR+"])

    def test_sinumerik_cycle_positions_are_absolute_under_g91(self):
        payload = run("N10 G17 G91\nN20 CYCLE81(10,0,2,-30)\n", profile="sinumerik-mill")
        self.assertEqual(lines_of(payload)[1], "N20 CYCLE81(10.5,0.5,2,-29.5)")

    def test_sinumerik_extra_arguments_are_not_reviewed(self):
        payload = run("N10 G17 G90\nN20 CYCLE87(10,0,2,-30,,3,7)\n", profile="sinumerik-mill")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed"])

    def test_sinumerik_a_variable_tool_axis_position_refuses_the_call_on_a_z_shift_only(self):
        program = "N10 G17 G90\nN20 CYCLE81(10,R1,2,-30)\n"
        self.assertEqual(reasons(run(program, profile="sinumerik-mill")), ["cycle-expression"])
        self.assertEqual(run(program, profile="sinumerik-mill", addresses=["X"])["findings"], [])

    def test_a_lathe_cycle_is_refused_and_listed(self):
        payload = run("G18 G90\nG83 X0 Z-20. R2. Q5000 F0.1\nG80\n", profile="fanuc-lathe")
        self.assertEqual(reasons(payload), ["cycle-not-reviewed"])

    def test_the_x_operand_as_a_radius_doubles_on_a_diameter_word(self):
        payload = run("G18 G90\nG0 X50. Z2.\n", profile="fanuc-lathe", addresses=["X"], xOperand="radius")
        self.assertEqual(lines_of(payload)[1], "G0 X51. Z2.")

    def test_the_decimals_option(self):
        payload = run("G90 G17\nG1 Z1.\n", operation="divide", operand=3, decimals="3")
        self.assertEqual(lines_of(payload)[1], "G1 Z0.333")
        self.assertEqual(reasons(payload), ["rounded"])
        payload = run("G90 G17\nG1 Z1.\n", operation="divide", operand=3)
        self.assertEqual(lines_of(payload)[1], "G1 Z0.3333")

    def test_as_written_adds_the_decimals_the_result_needs(self):
        self.assertEqual(lines_of(run("G90 G17\nG1 Z10.\n", operand=0.125))[1], "G1 Z10.125")
        self.assertEqual(lines_of(run("G90 G17\nG1 Z10.1234\n", operand=0.5))[1], "G1 Z10.6234")

    def test_adding_zero_changes_nothing(self):
        program = "G90 G17\nG81 X10. Y10. Z-5. R2. F100.\nG80\nG1 Z1.\n"
        payload = run(program, operand=0)
        self.assertEqual(payload["text"], program)
        self.assertTrue(payload["message"].startswith("Changed nothing."))

    def test_the_message_names_what_was_done_and_left(self):
        payload = run("G90 G17\nG1 Z1.\nG53 Z0.\nG1 Z#1\n", name="Mill 1", preset="is-b")
        self.assertEqual(
            payload["message"],
            "Added 0.5 to Z in 1 word on 1 block. Left 1 block and 1 word as written: 1 machine position, "
            "1 variable or expression. Machine 'Mill 1': numbers without a point are increments of 0.001 mm.",
        )


class TestSelectionPriming(unittest.TestCase):
    def setUp(self):
        self.case = case_named("fanuc-selection-primed")

    def test_a_cycle_started_above_the_selection_refuses_its_blocks_in_it(self):
        payload = run_case(self.case).json()
        self.assertEqual(reasons(payload), ["cycle-outside", "cycle-outside"])
        self.assertEqual(lines_of(payload)[3], "G0 Z50.5")

    def test_without_the_lines_above_it_the_selection_says_what_it_cannot_see(self):
        context = context_of(self.case)
        context["input"] = dict(context["input"])
        context["input"].pop("precedingLines")
        result = helpers.run_script(SCRIPT, stdin=self.case.input_text(), context=context)
        payload = result.json()
        self.assertEqual(payload["findings"][0]["reason"], "selection")
        self.assertEqual(lines_of(payload)[3], "G0 Z50.")
        self.assertNotIn("cycle-outside", reasons(payload))

    def test_preceding_lines_that_are_not_all_the_lines_above_are_refused(self):
        context = context_of(self.case)
        context["input"] = dict(context["input"])
        context["input"]["precedingLines"] = context["input"]["precedingLines"][1:]
        payload = helpers.run_script(SCRIPT, stdin=self.case.input_text(), context=context).json()
        self.assertEqual(payload["findings"][0]["reason"], "selection")


#: The dialect of each folder of `tests/fixtures/nc/`.
FIXTURE_PROFILES = {
    "fanuc": "fanuc-gcode",
    "fanuc-lathe": "fanuc-lathe",
    "heidenhain": "heidenhain-klartext",
    "okuma": "okuma-osp",
    "sinumerik": "sinumerik",
    "sinumerik-mill": "sinumerik-mill",
}

#: Programs longer than this are left to the runtime scenario `m10-perf` (H10).
FIXTURE_MAX_LINES = 10000


def fixture_programs():
    """``(profile, path)`` of every committed NC fixture short enough for a unit test."""
    root = helpers.FIXTURES_DIR / "nc"
    out = []
    for folder, profile in FIXTURE_PROFILES.items():
        out += [(profile, path) for path in sorted((root / folder).iterdir()) if path.is_file()]
    for folder in sorted((root / "owner-public").iterdir()):
        out += [(folder.name, path) for path in sorted(folder.iterdir()) if path.is_file()]
    return out


def fixture_text(path):
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    return text.replace("\r\n", "\n").replace("\r", "\n")


class TestFixturePrograms(unittest.TestCase):
    """Every committed program, synthetic and the owner's public ones: adding zero changes
    nothing, and a shift changes nothing but values (the invariant that matters most)."""

    def test_adding_zero_hands_every_program_back_unchanged_and_a_shift_only_changes_values(self):
        gedit_nc = helpers.import_gedit_nc()
        checked = 0
        for profile, path in fixture_programs():
            text = fixture_text(path)
            if text.count("\n") > FIXTURE_MAX_LINES or not text.strip():
                continue
            with self.subTest(program="%s/%s" % (path.parent.name, path.name)):
                zero = run(text, profile=profile, operand=0, addresses=["X", "Y", "Z"])
                self.assertEqual(zero["text"], text)
                shifted = run(text, profile=profile, operand=0.5, addresses=["X", "Z"])
                cp = gedit_nc.compile_profile(helpers.effective_context(profile)["profile"])
                self.assertEqual(shape_of(shifted["text"].split("\n"), cp), shape_of(text.split("\n"), cp))
                for finding in shifted["findings"]:
                    self.assertIn(finding["reason"], BLOCK_REASONS | WORD_REASONS | NOTE_REASONS | RUN_REASONS)
                checked += 1
        self.assertGreater(checked, 30)


class TestHeader(unittest.TestCase):
    PARAMS = ["operation", "operand", "addresses", "arcCentres", "xOperand", "decimals"]
    FIELD_TYPES = ("number", "integer", "text", "bool", "choice", "file", "folder", "address-list")

    def header_source(self):
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
        self.assertEqual(meta["name"], "Address arithmetic")
        self.assertEqual(meta["output"], "replace")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertIs(meta["envelope"], True)
        self.assertNotIn("profiles", meta)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_form_ids_are_the_pinned_ones(self):
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        self.assertEqual([param["id"] for param in params], self.PARAMS)
        by_id = {param["id"]: param for param in params}
        self.assertEqual([c["value"] for c in by_id["operation"]["choices"]], ["add", "subtract", "multiply", "divide"])
        self.assertEqual(by_id["addresses"]["default"], ["Z"])
        self.assertEqual(by_id["addresses"]["type"], "address-list")
        offered = [c["value"] for c in by_id["addresses"]["choices"]]
        self.assertEqual([a for a in offered if a in ("G", "M", "N", "O", "T")], [])
        self.assertEqual([c["value"] for c in by_id["arcCentres"]["choices"]], ["auto", "yes", "no"])
        self.assertEqual([c["value"] for c in by_id["xOperand"]["choices"]], ["diameter", "radius"])
        self.assertEqual(by_id["xOperand"]["default"], "diameter")
        self.assertEqual([c["value"] for c in by_id["decimals"]["choices"]], ["keep", "0", "1", "2", "3", "4"])
        self.assertIs(by_id["operand"]["required"], True)
        for param in params:
            with self.subTest(param=param["id"]):
                self.assertIn(param["type"], self.FIELD_TYPES)
                self.assertTrue(param["label"])
                if param["type"] == "choice":
                    self.assertIn(param["default"], [c["value"] for c in param["choices"]])

    def test_the_declared_parameters_are_the_ones_the_script_reads(self):
        source = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8")
        body = source.split("# ///", 2)[-1]
        for name in self.PARAMS:
            with self.subTest(param=name):
                self.assertIn('"%s"' % name, body)


class TestRunEnvironment(unittest.TestCase):
    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self):
        result = helpers.run_script(SCRIPT, stdin="G1 Z1.\n", context=None)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("needs a dialect profile", result.stderr)

    def test_a_form_that_cannot_be_used_is_refused_rather_than_guessed(self):
        bad = [
            {"operation": "divide", "operand": 0},
            {"operation": "multiply", "operand": 0},
            {"operation": "add"},
            {"operation": "add", "operand": "abc"},
            {"operation": "power", "operand": 2},
            {"operation": "add", "operand": 1, "addresses": []},
            {"operation": "add", "operand": 1, "addresses": ["G"]},
            {"operation": "add", "operand": 1, "decimals": "11"},
        ]
        for params in bad:
            with self.subTest(params=params):
                context = helpers.effective_context("fanuc-gcode")
                context["params"] = params
                result = helpers.run_script(SCRIPT, stdin="G90\nG1 Z1.\n", context=context)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertTrue(result.stderr.startswith("Address arithmetic: "), result.stderr)

    def test_a_run_without_a_code_database_changes_nothing_and_says_so(self):
        context = helpers.effective_context("fanuc-gcode")
        context["codes"] = []
        context["params"] = {"operation": "add", "operand": 1}
        payload = helpers.run_script(SCRIPT, stdin="G90\nG1 Z1.\n", context=context).json()
        self.assertEqual(payload["text"], "G90\nG1 Z1.\n")
        self.assertEqual(reasons(payload), ["no-database"])

    def test_findings_are_capped_and_counted(self):
        program = "G91\n" + "G1 Z1.\n" * 600
        payload = run(program)
        self.assertEqual(len(payload["findings"]), 500)
        self.assertIn("100 further findings are not listed.", payload["message"])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


def words_of(line, address):
    """The values of every ``address`` word of one line, as written (``X20.``: ``'20.'``)."""
    import re

    return re.findall(r"(?<![A-Z0-9_])%s(-?[0-9.]+)" % address, line)


class TestReviewFindings(unittest.TestCase):
    """The M10 review: each test fails without its fix."""

    def text_of(self, name):
        result = run_case(case_named(name))
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    # NC-1 ------------------------------------------------------------------

    def test_an_x_shift_on_a_milling_profile_moves_x_by_the_value_itself(self):
        path = helpers.FIXTURES_DIR / "nc" / "owner-public" / "sinumerik-mill" / "DRILLING.mpf"
        text = fixture_text(path)
        payload = run(text, profile="sinumerik-mill", operand=0.5, addresses=["X"])
        self.assertNotIn("diameter", payload["message"])
        moved = 0
        for old, new in zip(text.split("\n"), lines_of(payload)):
            if old == new:
                continue
            before, after = words_of(old, "X"), words_of(new, "X")
            self.assertEqual(len(before), len(after), old)
            for a, b in zip(before, after):
                self.assertEqual(Decimal(b) - Decimal(a), Decimal("0.5"), (old, new))
                moved += 1
        self.assertGreater(moved, 50)
        self.assertIn("N70 G0 G17 X20.5 Y20", lines_of(payload))

    def test_a_diamon_word_on_a_mill_moves_by_twice_the_value(self):
        payload = self.text_of("sinumerik-mill-x-shift")
        lines = lines_of(payload)
        self.assertEqual(lines[4], "N40 G0 X11 Y10 Z50")
        self.assertEqual(lines[8], "N80 G1 X42 Y10")
        self.assertNotIn("(as a", payload["message"])
        self.assertNotIn("radius", payload["message"])

    def test_a_lathe_still_reads_the_operand_as_a_diameter(self):
        lines = lines_of(self.text_of("sinumerik-diamof"))
        self.assertEqual(lines[6], "N50 G1 X20.25 Z-20")

    # NC-2 ------------------------------------------------------------------

    def test_an_absolute_klartext_pole_moves_with_x_and_y_and_an_incremental_one_does_not(self):
        payload = self.text_of("klartext-polar")
        lines = lines_of(payload)
        self.assertEqual(lines[7], "7 CC X+55 Y+55")
        self.assertEqual(lines[11], "11 C X+55 Y+65 DR-")
        self.assertEqual(lines[12], "12 CC IX+10 IY+0")
        self.assertNotIn("not a position", " ".join(f["message"] for f in payload["findings"] if f["line"] == 8))

    def test_a_pole_that_cannot_be_moved_is_refused_with_the_moves_around_it(self):
        payload = self.text_of("klartext-polar")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (15, 16, 17)], ["pole"] * 3)
        self.assertEqual(lines_of(payload)[16], "16 C X+70 Y+50 DR+")

    def test_a_z_shift_leaves_the_pole_alone(self):
        case = case_named("klartext-polar")
        payload = run(case.input_text(), profile="heidenhain-klartext", operand=5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[7], "7 CC X+50 Y+50")
        self.assertNotIn("pole", reasons(payload))

    def test_a_multiply_refuses_the_contour_around_a_pole(self):
        case = case_named("klartext-polar")
        payload = run(case.input_text(), profile="heidenhain-klartext", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[7], "7 CC X+50 Y+50")
        self.assertEqual(finding_at(payload, 8)["reason"], "pole")

    # NC-3 ------------------------------------------------------------------

    def test_absolute_arc_centres_and_intermediate_points_move_with_the_end_point(self):
        lines = lines_of(self.text_of("sinumerik-arc-geometry"))
        self.assertEqual(lines[6], "N60 G2 X75 Y55 I=AC(55) J=AC(55)")
        self.assertEqual(lines[7], "N70 G3 X35 Y55 I-20 J0")
        self.assertEqual(lines[8], "N80 CIP X75 Y55 I1=55 J1=75")
        self.assertEqual(lines[9], "N90 CIP X35 Y55 I1=AC(55) J1=AC(35)")
        self.assertEqual(lines[10], "N100 G91 CIP X10 Y10 I1=5 J1=8")
        self.assertEqual(lines[11], "N110 G90 G1 Z=AC(8.25)")

    def test_an_arc_whose_geometry_cannot_be_computed_is_refused_whole(self):
        payload = self.text_of("sinumerik-arc-geometry")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (13, 14)], ["arc-geometry"] * 2)
        self.assertEqual(lines_of(payload)[12], "N120 G2 X70 Y50 I=AC(R1) J=AC(50)")

    def test_a_multiply_scales_an_absolute_centre_too(self):
        payload = run("G17 G90\nG2 X70 Y50 I=AC(50) J=AC(50)\n", profile="sinumerik-mill", operation="multiply", operand=2, addresses=["X", "Y"])
        self.assertEqual(lines_of(payload)[1], "G2 X140 Y100 I=AC(100) J=AC(100)")

    # NC-4 ------------------------------------------------------------------

    def test_a_tilted_rotary_axis_refuses_the_linear_words_it_turns_until_it_is_zero(self):
        payload = self.text_of("fanuc-rotary-state")
        lines = lines_of(payload)
        self.assertEqual([finding_at(payload, line)["reason"] for line in (7, 10, 11, 12, 13, 21)], ["rotary-without-tcp"] * 6)
        self.assertEqual(lines[9], "G0 X0. Y0. Z50.")
        self.assertEqual(lines[14], "G0 X20. Y20. Z50.5")  # B0 C30: C does not turn Z
        self.assertEqual(lines[18], "G1 X5. Y5. Z5.5 B30. C10.")  # under G43.4

    def test_the_owner_public_five_axis_program_keeps_every_z_of_its_toolpath(self):
        path = helpers.FIXTURES_DIR / "nc" / "owner-public" / "fanuc-gcode" / "5-Axis.NC"
        text = fixture_text(path)
        payload = run(text, operand=0.5, addresses=["Z"])
        self.assertEqual(payload["text"], text)
        self.assertEqual(set(reasons(payload)), {"rotary-without-tcp"})

    def test_a_cycle_position_under_a_turned_rotary_axis_is_refused(self):
        payload = run("G90 G17\nG0 B90. C0.\nG81 X10. Y10. R3. F100.\nG80\n", operand=0.5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[2], "G81 X10. Y10. R3. F100.")
        self.assertEqual(reasons(payload), ["rotary-without-tcp"])
        self.assertEqual(lines_of(run("G90 G17\nG0 B0. C0.\nG81 X10. Y10. R3. F100.\nG80\n", operand=0.5, addresses=["Z"]))[2], "G81 X10. Y10. R3.5 F100.")

    def test_a_c_axis_lathe_still_shifts_z_and_x(self):
        program = "G18 G90\nG0 X50. Z5. C0.\nG0 C90.\nG1 X40. Z-5. F0.2\n"
        payload = run(program, profile="fanuc-lathe", operand=0.5, addresses=["X", "Z"], xOperand="radius")
        self.assertEqual(lines_of(payload)[3], "G1 X41. Z-4.5 F0.2")
        self.assertEqual(payload["findings"], [])

    # NC-5 ------------------------------------------------------------------

    def test_a_fanuc_polar_coordinate_command_is_a_frame(self):
        payload = self.text_of("fanuc-polar-g16")
        lines = lines_of(payload)
        self.assertEqual(lines[9], "G0 X50. Y45.")
        self.assertEqual(lines[11], "X50. Y135.")
        self.assertEqual(lines[13], "G0 X15. Y15.")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (9, 10, 12)], ["frame"] * 3)

    def test_an_unknown_code_in_a_block_with_nothing_to_change_is_noted(self):
        payload = self.text_of("fanuc-polar-g16")
        note = finding_at(payload, 15)
        self.assertEqual((note["reason"], note["severity"]), ("unknown-code-note", "warning"))
        self.assertTrue(note["message"].startswith("G123: "))

    # NC-6 ------------------------------------------------------------------

    def test_a_macro_call_with_a_chosen_word_is_refused(self):
        program = "G90 G17\nG0 X0. Y0.\nG43 H1 Z50.\nG65 P9810 Z5. F1000.\nG65 P9811 Z0. S1.\nG65 P9000 A1.\nG0 Z50.\n"
        payload = run(program, operand=0.5, addresses=["Z"])
        self.assertEqual([finding_at(payload, line)["reason"] for line in (4, 5)], ["cycle-not-reviewed"] * 2)
        self.assertEqual(lines_of(payload)[3:6], ["G65 P9810 Z5. F1000.", "G65 P9811 Z0. S1.", "G65 P9000 A1."])
        self.assertEqual(lines_of(payload)[2], "G43 H1 Z50.5")
        # The data codes keep their info finding.
        self.assertEqual(reasons(run("G90 G17\nG52 Z5.\n")), ["data"])

    # CODE-8 ------------------------------------------------------------------

    def test_a_multiply_scales_incremental_distances_and_refuses_a_shift(self):
        payload = self.text_of("fanuc-multiply-rule")
        lines = lines_of(payload)
        self.assertEqual(lines[4], "G1 X2. Y4. Z6. F100.")  # before G90: the mode does not matter
        self.assertEqual(lines[7], "G91 G1 X2. Y4. Z-6.")
        self.assertEqual([finding_at(payload, line)["reason"] for line in (10, 12)], ["not-scaled"] * 2)
        self.assertNotIn("shift does not apply", " ".join(f["message"] for f in payload["findings"]))

    def test_an_absolute_value_function_is_moved_and_an_incremental_one_is_left(self):
        payload = run("G17 G90\nG1 Z=AC(3.25)\nG1 Z=IC(2)\n", profile="sinumerik-mill", operand=1, addresses=["Z"])
        self.assertEqual(lines_of(payload)[1:3], ["G1 Z=AC(4.25)", "G1 Z=IC(2)"])
        self.assertEqual(reasons(payload), ["incremental"])


class TestM13ReviewUnreadable(unittest.TestCase):
    """M13 review NC-5: a word whose value cannot be read is reported and counted."""

    PROGRAM = "G00 X10. Z\u20135.\nG00 Z\u22125.\nG01 Z-5. F0.1\n"

    def test_a_dash_pasted_for_the_minus_sign_is_named_and_counted(self):
        payload = run(self.PROGRAM, profile="fanuc-lathe", operation="subtract", operand=0.5, addresses=["Z"])
        self.assertEqual(lines_of(payload)[:3], ["G00 X10. Z\u20135.", "G00 Z\u22125.", "G01 Z-5.5 F0.1"])
        self.assertEqual([(f["line"], f["reason"], f["severity"]) for f in payload["findings"]], [(1, "unreadable", "warning"), (2, "unreadable", "warning")])
        self.assertIn("U+2013 EN DASH, not the ASCII minus sign -", payload["findings"][0]["message"])
        self.assertIn("U+2212 MINUS SIGN", payload["findings"][1]["message"])
        self.assertIn("Left 2 words as written: 2 words that cannot be read.", payload["message"])

    def test_an_address_that_is_not_chosen_says_nothing(self):
        payload = run(self.PROGRAM, profile="fanuc-lathe", operation="subtract", operand=0.5, addresses=["X"])
        self.assertEqual(payload["findings"], [])
