"""`extents.py` (plan §6 M10 WP10.3), against the golden cases in
``tests/fixtures/scripts/extents/`` (their README is the report format).

The goldens run the real script in a subprocess, the way the app runs it; the rules below
them import the module and walk short programs, so each rule has a test that fails when the
rule is taken out. What the plan names (WP10.3 Tests):

* mill, lathe (diameter), Klartext and one arc case per quadrant — ``fanuc-mill``,
  ``lathe-diameter``, ``klartext-basic``, ``fanuc-arc-quadrants``
* ``l06-decimal.nc`` under IS-B, calculator and no machine — ``lathe-decimal-*``
* a Sinumerik program switching ``DIAMOF``: the same X minimum whether the section is
  written as a radius or as a diameter — ``sinumerik-diamof-radius`` and
  ``sinumerik-diamof-diameter``
* ``DIAM90`` with ``G91`` — ``sinumerik-diam90-g91``

and what the decisions of M9 and P10 added: R6's ``U``/``W`` choice
(``lathe-uw-not-incremental``), frames and tool centre point control (``fanuc-frames-tcp``,
``sinumerik-mill-five-axis``), Klartext polar moves (``klartext-polar``), Okuma's unit
systems (``okuma-*``), a primed selection (``fanuc-selection-primed``).
"""

from __future__ import annotations

import copy
import json
import sys
import unittest
from decimal import Decimal

from tests.python import helpers
from tests.python.test_tool_list import context_of

SCRIPT = "extents.py"

#: `tomllib` reads the script header the way the backend does (3.11 and newer).
HAS_TOMLLIB = sys.version_info >= (3, 11)

#: Cases the plan names, so a renamed or deleted folder fails loudly.
REQUIRED_CASES = [
    "fanuc-arc-quadrants",
    "fanuc-frames-tcp",
    "fanuc-mill",
    "fanuc-no-distance",
    "fanuc-selection-primed",
    "klartext-basic",
    "klartext-polar",
    "lathe-decimal-calculator",
    "lathe-decimal-is-b",
    "lathe-decimal-no-machine",
    "lathe-diameter",
    "lathe-uw-not-incremental",
    "okuma-1um",
    "okuma-no-machine",
    "sinumerik-diam90-g91",
    "sinumerik-diamof-diameter",
    "sinumerik-diamof-radius",
    "sinumerik-mill-five-axis",
    # The M10 review.
    "fanuc-local-shift",
    "fanuc-rotary-no-tcp",
    "sinumerik-trans",
]

gedit_nc = helpers.import_gedit_nc()
import extents  # noqa: E402  (the bundled folder is on sys.path from here on)


def run_case(case, drop_preceding=False):
    context = context_of(case)
    if drop_preceding:
        context["input"].pop("precedingLines", None)
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)


def case_named(name):
    for case in helpers.script_cases("extents"):
        if case.name == name:
            return case
    raise AssertionError("no extents case %s" % name)


def report_of(name):
    out = run_case(case_named(name))
    assert out.ok, out.stderr
    return out.json()


def row(report, axis, scope="program", where=None):
    for r in report["rows"]:
        if r["axisId"] == axis and r["scope"] == scope and (where is None or r["where"] == where):
            return r
    return None


def reasons(report):
    return [f["reason"] for f in report.get("findings", [])]


# ---------------------------------------------------------------------------
# Walking a program in-process
# ---------------------------------------------------------------------------


def walk(text, profile_id="fanuc-gcode", codes=None, machine_leaf=None, first=1, above=()):
    """The `Extents` walker after ``text``, with the effective profile of ``profile_id``."""
    context = helpers.effective_context(profile_id, preset=machine_leaf) if machine_leaf else helpers.effective_context(profile_id)
    if machine_leaf:
        context["machine"] = dict(context["machine"], id="m", name="M")
    if codes is not None:
        context["codes"] = codes
    cp = gedit_nc.compile_profile(context["profile"])
    w = extents.Extents(context, cp)
    state = None
    for number, line in enumerate(above, first - len(above)):
        state = w.line(line, number, state, record=False)
    for number, line in enumerate(text.strip("\n").split("\n"), first):
        state = w.line(line, number, state, record=True)
    # A position written before a rotary axis that turns it is held until the end (NC-10).
    w.settle_held()
    return w


def extent(w, axis, scope=None):
    """``(min, max, unresolved)`` of one axis in the program scope, values as text."""
    r = (scope or w.program).ranges.get(axis)
    if r is None:
        return None
    lo = None if r.low is None else extents.text_of(r.low, 4)
    hi = None if r.high is None else extents.text_of(r.high, 4)
    return (lo, hi, r.unresolved)


class TestGoldenCases(unittest.TestCase):
    def setUp(self):
        self.cases = helpers.script_cases("extents")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        names = [case.name for case in self.cases]
        for required in REQUIRED_CASES:
            self.assertIn(required, names)

    def test_every_case_produces_its_expected_report(self):
        self.assertTrue(self.cases)
        for case in self.cases:
            with self.subTest(case=case.name):
                out = run_case(case)
                self.assertTrue(out.ok, out.stderr)
                self.assertEqual(out.json(), case.expected_json())

    def test_every_row_and_finding_points_into_the_program(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                report = case.expected_json()
                start = case.context()["input"]["startLine"]
                end = start + len(case.input_lines()) - 1
                for r in report["rows"]:
                    self.assertTrue(start <= r["line"] <= end, r)
                    self.assertEqual(set(r) - {"where", "axis", "min", "minLine", "max", "maxLine", "unresolved", "line", "scope", "axisId"}, set())
                for f in report.get("findings", []):
                    self.assertTrue(start <= f["line"] <= end, f)
                    self.assertIn(f["reason"], extents.KINDS)
                    self.assertEqual(f["severity"], extents.KINDS[f["reason"]])

    def test_a_primed_selection_reads_differently_without_the_lines_above(self):
        case = case_named("fanuc-selection-primed")
        primed = run_case(case).json()
        bare = run_case(case, drop_preceding=True).json()
        self.assertNotEqual(primed, bare)
        # Above the selection: `G91` and a move to (5, 5). Without it the run knows neither.
        self.assertEqual(row(primed, "X")["min"], "15")
        self.assertIn("selection", reasons(bare))
        self.assertEqual(row(bare, "X")["min"], "")
        self.assertGreater(row(bare, "X")["unresolved"], 0)


class TestPlanCases(unittest.TestCase):
    """The cases WP10.3's Tests line names, read by their meaning rather than byte for byte."""

    def test_the_decimal_program_reads_by_the_machine(self):
        is_b = report_of("lathe-decimal-is-b")
        calc = report_of("lathe-decimal-calculator")
        none = report_of("lathe-decimal-no-machine")
        # `G00 X50 Z1000` (line 10): 0.05 and 1 mm on IS-B, 50 and 1000 mm as written.
        self.assertEqual(row(is_b, "X")["min"], "0.05")
        self.assertEqual((row(calc, "Z")["max"], row(calc, "Z")["maxLine"]), ("1000", 10))
        # With no machine the point-less words are not resolved and the header says so; the
        # word with a point (`Z1000.`, line 12) is the same on every preset.
        self.assertEqual((row(none, "Z")["max"], row(none, "Z")["maxLine"]), ("1000", 12))
        self.assertEqual(row(none, "Z")["unresolved"], 3)
        self.assertIn("machine-dependent", reasons(none))
        self.assertTrue(none["message"].startswith("No machine"))
        self.assertTrue(is_b["message"].startswith("Machine 'Lathe IS-B'."))
        self.assertNotIn("machine-dependent", reasons(is_b))

    def test_a_diamof_section_gives_the_same_x_minimum_as_its_diameter_twin(self):
        radius = report_of("sinumerik-diamof-radius")
        diameter = report_of("sinumerik-diamof-diameter")
        self.assertEqual(row(radius, "X")["axis"], "X (diameter)")
        self.assertEqual(row(radius, "X")["min"], "30")
        self.assertEqual(row(radius, "X")["min"], row(diameter, "X")["min"])
        self.assertIn("DIAMOF (line 7)", radius["message"])

    def test_diam90_reads_an_incremental_x_as_a_radius(self):
        report = report_of("sinumerik-diam90-g91")
        # X40, then G91 X-5 (radius: -10) and X-2.5 (-5): 25 as a diameter.
        self.assertEqual(row(report, "X")["min"], "25")

    def test_one_arc_per_quadrant_reaches_its_extreme(self):
        report = report_of("fanuc-arc-quadrants")
        tool = lambda n: "G54, T%d (line %d)" % (n, [5, 8, 11, 14, 17, 20, 23, 26][n - 1])  # noqa: E731
        self.assertEqual(row(report, "Y", "tool", tool(2))["max"], "10")
        self.assertEqual(row(report, "X", "tool", tool(3))["min"], "-10")
        self.assertEqual(row(report, "Y", "tool", tool(4))["min"], "-10")
        self.assertEqual(row(report, "X", "tool", tool(5))["max"], "10")
        # A quarter that crosses no axis adds nothing to its end points.
        self.assertEqual((row(report, "X", "tool", tool(1))["min"], row(report, "Y", "tool", tool(1))["min"]), ("0", "0"))
        self.assertEqual((row(report, "X", "tool", tool(6))["min"], row(report, "Y", "tool", tool(6))["min"]), ("0", "0"))
        # `R-10` is the arc over 180°, and `G2 I-10.` a full circle.
        self.assertEqual(row(report, "X", "tool", tool(7))["min"], "-10")
        self.assertEqual(row(report, "Y", "tool", tool(8))["min"], "-10")

    def test_machine_positions_are_rows_of_their_own(self):
        report = report_of("fanuc-mill")
        machine = [r for r in report["rows"] if r["scope"] == "machine"]
        self.assertEqual([(r["where"], r["axis"], r["min"]) for r in machine], [("G28 (line 23)", "Z", "0"), ("G53 (line 24)", "X", "-400"), ("G53 (line 24)", "Y", "0")])
        self.assertEqual(row(report, "X")["min"], "-20")  # -400 never entered the range


class TestRules(unittest.TestCase):
    """Each rule of the script, with a program that fails when the rule is taken out."""

    def test_a_word_whose_reading_depends_on_the_machine_is_never_guessed(self):
        w = walk("G90 G17 G0 X10. Y1000\nM30")
        self.assertEqual(extent(w, "Y"), (None, None, 1))
        self.assertEqual(extent(w, "X"), ("10", "10", 0))
        w = walk("G90 G17 G0 X10. Y1000\nM30", machine_leaf="is-b")
        self.assertEqual(extent(w, "Y"), ("1", "1", 0))

    def test_an_incremental_word_adds_to_the_position_and_a_twin_too(self):
        w = walk("G90 G0 X10. Y0.\nG91 X5. Y-2.\nX5.\nM30")
        self.assertEqual(extent(w, "X"), ("10", "20", 0))
        self.assertEqual(extent(w, "Y"), ("-2", "0", 0))
        w = walk("G00 X40. Z2.\nU10. W-3.\nM30", "fanuc-lathe")
        self.assertEqual(extent(w, "X"), ("40", "50", 0))
        self.assertEqual(extent(w, "Z"), ("-1", "2", 0))

    def test_an_incremental_word_from_an_unknown_start_is_not_resolved(self):
        w = walk("G91 G0 X5.\nM30")
        self.assertEqual(extent(w, "X"), (None, None, 1))
        self.assertEqual(list(w.findings.found)[0][0], "incremental-start")

    def test_a_klartext_incremental_prefix_is_incremental(self):
        w = walk("TOOL CALL 1 Z S100\nL X+10 Y+0 R0 FMAX\nL IX+5 R0 FMAX", "heidenhain-klartext")
        self.assertEqual(extent(w, "X"), ("10", "15", 0))

    def test_a_radius_word_counts_double_in_the_diameter_column(self):
        w = walk("G18 G90 DIAMOF\nG0 X10 Z0\nDIAMON\nG0 X30", "sinumerik")
        self.assertEqual(extent(w, "X"), ("20", "30", 0))
        self.assertEqual(w.axes.label("X"), "X (diameter)")

    def test_a_milling_profile_keeps_a_plain_x_column(self):
        w = walk("G17 G90 G0 X10 Y0\nDIAMON\nG0 X30", "sinumerik-mill")
        self.assertEqual(w.axes.label("X"), "X")
        self.assertEqual(extent(w, "X"), ("10", "15", 0))

    def test_a_dwell_keeps_the_position_and_a_shift_does_not(self):
        w = walk("G00 X40. Z2.\nG04 X0.5\nG00 U10.\nM30", "fanuc-lathe")
        self.assertEqual(extent(w, "X"), ("40", "50", 0))
        w = walk("G90 G0 X10. Y0.\nG52 X100. Y0.\nG91 X5.\nM30")
        self.assertEqual(extent(w, "X"), ("10", "10", 1))

    def test_data_words_are_no_positions(self):
        w = walk("G90 G0 X10. Y0.\nG92 X500. Y500.\nM30")
        self.assertEqual(extent(w, "X"), ("10", "10", 0))
        self.assertEqual([k for k, _ in w.findings.found], ["data"])

    def test_the_machine_position_flag_comes_from_the_database(self):
        program = "G90 G17 G0 X10. Y0.\nG53 X-400. Y0.\nM30"
        self.assertEqual(extent(walk(program), "X"), ("10", "10", 0))
        codes = copy.deepcopy(helpers.resolved_codes("fanuc"))
        for entry in codes:
            if entry.get("code") == "G53":
                entry.pop("axisWords", None)
        # Without the flag G53 is an ordinary code and its words are positions: the script
        # carries no list of machine codes of its own (R3).
        self.assertEqual(extent(walk(program, codes=codes), "X"), ("-400", "10", 0))

    def test_a_position_inside_a_frame_is_not_resolved_and_one_under_tcp_is(self):
        w = walk("G90 G17 G0 X0. Y0.\nG68 X0. Y0. R30.\nG1 X40.\nG69\nG43.4 H1\nG1 X20. A10.\nM30")
        self.assertEqual(extent(w, "X"), ("0", "20", 1))
        self.assertEqual(extent(w, "A"), ("10", "10", 0))

    def test_a_cycle_whose_positions_are_its_parameters_is_counted_on_the_tool_axis(self):
        w = walk("G17 G90 G0 X0 Y0 Z50\nCYCLE81(10,0,2,-20,,)\nM30", "sinumerik-mill")
        self.assertEqual(extent(w, "Z"), ("50", "50", 1))
        # `Z` after the cycle is where the cycle left it: an incremental move is not resolved.
        w = walk("G17 G90 G0 X0 Y0 Z50\nCYCLE81(10,0,2,-20,,)\nG91 G0 Z5\nM30", "sinumerik-mill")
        self.assertEqual(extent(w, "Z"), ("50", "50", 2))

    def test_an_iso_cycle_has_its_depth_in_its_axis_words(self):
        w = walk("G90 G17 G0 X0. Y0. Z10.\nG81 X5. Y5. Z-12. R2. F100.\nX10.\nG80\nM30")
        self.assertEqual(extent(w, "Z"), ("-12", "10", 0))
        self.assertEqual(extent(w, "X"), ("0", "10", 0))

    def test_a_lathe_multi_pass_cycle_is_not_resolved(self):
        w = walk("G00 X82. Z2.\nG71 U2. R1.\nG71 P10 Q20 U0.5 W0.1 F0.25\nN10 G00 X20.\nN20 G01 X82.\nM30", "fanuc-lathe")
        self.assertEqual(extent(w, "X"), ("20", "82", 2))
        self.assertEqual(extent(w, "Z"), ("2", "2", 2))

    def test_a_klartext_cycle_runs_where_it_is_called(self):
        program = "TOOL CALL 1 Z S100\nCYCL DEF 200 DRILLING ~\n  Q201=-10 ~\n  Q203=+0\nL X+10 Y+10 R0 FMAX M99\nL X+20 R0 FMAX M99"
        w = walk(program, "heidenhain-klartext")
        self.assertEqual(extent(w, "Z"), (None, None, 2))
        self.assertEqual(extent(w, "X"), ("10", "20", 0))

    def test_the_pole_is_the_centre_of_a_klartext_arc(self):
        w = walk("TOOL CALL 1 Z S100\nCC X+50 Y+50\nL X+0 Y+50 R0 FMAX\nC X+0 DR-", "heidenhain-klartext")
        self.assertEqual(extent(w, "X"), ("0", "100", 0))
        self.assertEqual(extent(w, "Y"), ("0", "100", 0))

    def test_sinumerik_value_functions_are_read(self):
        w = walk("G17 G90 G0 X10 Y0\nG1 X=IC(5)\nG2 X25 Y0 I=AC(20) J=AC(0)", "sinumerik-mill")
        self.assertEqual(extent(w, "X"), ("10", "25", 0))
        # Clockwise from the left of the centre runs over the top.
        self.assertEqual(extent(w, "Y"), ("0", "5", 0))

    def test_an_arc_whose_radius_does_not_reach_is_not_resolved(self):
        w = walk("G90 G17 G0 X0. Y0.\nG2 X40. Y0. R5.\nM30")
        self.assertEqual(extent(w, "X"), ("0", "40", 1))

    def test_work_offset_changes_start_groups_and_tools_belong_to_them(self):
        w = walk("G90 G17 G54 T1 M6\nG0 X1. Y1.\nG55\nG0 X2. Y2.\nG55\nG0 X3.\nM30")
        self.assertEqual([g.label for g in w.groups], ["G54 (line 1)", "G55 (line 3)"])
        rows = w.rows()
        self.assertEqual(
            sorted({r["where"] for r in rows}),
            ["G54 (line 1)", "G54, T1 (line 1)", "G55 (line 3)", "G55, T1 (line 1)", "Program"],
        )

    def test_units_switched_mid_program_are_converted(self):
        w = walk("G21 G90 G17 G0 X10. Y0.\nG20 G0 X1.\nM30")
        self.assertEqual(extent(w, "X"), ("10", "25.4", 0))
        self.assertTrue(w.units_switched)


class TestGeometry(unittest.TestCase):
    def test_the_centre_of_a_radius_arc(self):
        z = Decimal(0)
        ten = Decimal(10)
        # From (10, 0) to (0, 10): the short way round (0, 0) or the long way round (10, 10).
        self.assertEqual(extents.centre_from_radius(ten, z, z, ten, ten, "ccw"), (z, z))
        self.assertEqual(extents.centre_from_radius(ten, z, z, ten, -ten, "ccw"), (ten, ten))
        self.assertEqual(extents.centre_from_radius(ten, z, z, ten, ten, "cw"), (ten, ten))
        self.assertIsNone(extents.centre_from_radius(z, z, Decimal(40), z, Decimal(5), "cw"))

    def test_an_angle_inside_a_sweep(self):
        self.assertTrue(extents.within(45.0, 90.0, 90.0))
        self.assertFalse(extents.within(45.0, 90.0, 180.0))
        self.assertTrue(extents.within(45.0, -90.0, 0.0))
        self.assertFalse(extents.within(0.0, 90.0, 0.0))  # an end point is no extreme of its own

    def test_a_polar_point_is_exact_on_the_quarter_turns(self):
        self.assertEqual(extents.polar_point(Decimal(30), Decimal(90)), (Decimal(0), Decimal(30)))
        self.assertEqual(extents.polar_point(Decimal(30), Decimal(-90)), (Decimal(0), Decimal(-30)))
        x, y = extents.polar_point(Decimal(30), Decimal(60))
        self.assertEqual((str(x), str(y)), ("15.000000", "25.980762"))


class TestRuns(unittest.TestCase):
    def test_without_a_profile_it_says_why_and_fails(self):
        out = helpers.run_script(SCRIPT, stdin="G0 X1\n", context=None)
        self.assertFalse(out.ok)
        self.assertIn("Extents needs a dialect profile", out.stderr)

    def test_an_empty_program_says_there_is_nothing_to_measure(self):
        context = helpers.effective_context("fanuc-gcode")
        out = helpers.run_script(SCRIPT, stdin="%\n%\n", context=context)
        self.assertTrue(out.ok, out.stderr)
        self.assertEqual(out.json()["rows"], [])
        self.assertIn("No positions found.", out.json()["message"])


class TestHeader(unittest.TestCase):
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
        self.assertEqual(meta["name"], "Extents")
        self.assertEqual(meta["output"], "report")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertNotIn("envelope", meta)
        self.assertNotIn("params", meta)  # no form: a report that runs at once

    def test_the_report_columns_are_the_readme_ones(self):
        self.assertEqual(
            [c["key"] for c in extents.COLUMNS],
            ["where", "axis", "min", "minLine", "max", "maxLine", "unresolved"],
        )
        json.dumps(extents.COLUMNS)


if __name__ == "__main__":
    unittest.main()


class TestReviewFindings(unittest.TestCase):
    """The M10 review: each test fails without its fix."""

    def rows_of(self, name):
        out = run_case(case_named(name))
        self.assertTrue(out.ok, out.stderr)
        return out.json()

    @staticmethod
    def row(payload, where, axis):
        found = [r for r in payload["rows"] if r["where"] == where and r["axisId"] == axis]
        return (found[0]["min"], found[0]["max"], found[0]["unresolved"]) if found else None

    def test_a_coordinate_shift_starts_a_group_of_its_own(self):
        payload = self.rows_of("fanuc-local-shift")
        self.assertEqual(self.row(payload, "G54 (line 5)", "Z"), ("-5", "10", 0))
        self.assertEqual(self.row(payload, "G54 + G52 (line 9)", "Z"), ("-5", "10", 0))
        self.assertEqual(self.row(payload, "G54 + G92 (line 14)", "Z"), ("50", "50", 0))

    def test_a_sinumerik_trans_and_atrans_start_groups_and_a_bare_trans_too(self):
        wheres = [r["where"] for r in self.rows_of("sinumerik-trans")["rows"] if r["scope"] == "offset"]
        self.assertEqual(
            sorted(set(wheres)),
            ["G54 (line 2)", "G54 + ATRANS (line 8)", "G54 + TRANS (line 10)", "G54 + TRANS (line 5)"],
        )

    def test_a_clamp_alone_starts_no_group(self):
        w = walk("G18 G90 G54\nG0 X50. Z5.\nG50 S2000\nG1 X40. Z-5. F0.2\n", profile_id="fanuc-lathe")
        self.assertEqual([g.label for g in w.groups], ["G54 (line 1)"])

    def test_a_linear_position_under_a_turned_rotary_axis_is_not_resolved(self):
        payload = self.rows_of("fanuc-rotary-no-tcp")
        self.assertEqual(self.row(payload, "Program", "Z"), ("-1", "50", 4))
        self.assertEqual(self.row(payload, "Program", "X"), ("5", "5", 2))
        self.assertEqual(
            sorted({f["reason"] for f in payload["findings"]}), ["rotary"]
        )

    def test_the_owner_public_five_axis_program_reports_no_pivot_positions_as_extents(self):
        path = helpers.FIXTURES_DIR / "nc" / "owner-public" / "fanuc-gcode" / "5-Axis.NC"
        text = path.read_bytes().decode("utf-8", "replace").replace("\r\n", "\n")
        w = walk(text)
        for axis in ("X", "Y", "Z"):
            r = w.program.ranges[axis]
            self.assertIsNone(r.low, axis)
            self.assertGreater(r.unresolved, 100, axis)

    def test_a_three_axis_program_on_a_profile_with_rotary_axes_is_resolved(self):
        w = walk("G90 G17 G54\nG0 X0. Y0. Z50.\nG1 Z-5. F100.\n")
        self.assertEqual(extent(w, "Z"), ("-5", "50", 0))


class TestWordsWithNoMachine(unittest.TestCase):
    """CODE-6: what a program full of machine-dependent words costs."""

    def test_the_sentence_of_the_readings_is_built_for_the_finding_that_is_kept(self):
        lines = "\n".join("G1 X%d Y%d" % (1000 + n, 2000 + n) for n in range(300))
        calls = []
        real = extents.readings_text

        def counting(*args):
            calls.append(args)
            return real(*args)

        extents.readings_text = counting
        try:
            w = walk("G90\nG0 X0 Y0\n" + lines)
            findings = w.findings.out()
        finally:
            extents.readings_text = real
        machine = [f for f in findings if f["reason"] == "machine-dependent"]
        self.assertEqual(len(machine), 1)
        self.assertIn("600 words", machine[0]["message"])
        self.assertIn("(is-b: 1 mm; is-c: 0.1 mm; calculator: 1000 mm)", machine[0]["message"])
        # One sentence for the one finding. Without the deferral it is built for every word.
        self.assertEqual(len(calls), 1)

