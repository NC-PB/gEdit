"""The program checks script (plan section 6 M10, WP10.2; roadmap R7).

Golden cases in ``tests/fixtures/scripts/program_checks/<case>/`` (the folder's README pins
the report and the check ids), and rule tests built on the same runner. Standard library
only; run from the repository root::

    python3 -m unittest tests.python.test_program_checks

The members of the code databases and profiles that the checks read (``sets.spindle``,
``conflicts``, ``syntax.maxWordDigits`` ...) are pinned in
``tests/fixtures/scripts/program_checks/data-pins.json``; :class:`TestShippedData` holds the
shipped, resolved data to it.
"""

from __future__ import annotations

import json
import os
import re
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from tests.python import helpers

SCRIPT = "program_checks.py"
CASES_DIR = helpers.SCRIPT_FIXTURES_DIR / "program_checks"
PINS = helpers.load_json(CASES_DIR / "data-pins.json")

gedit_nc = helpers.import_gedit_nc()


# ---------------------------------------------------------------------------
# Running the script
# ---------------------------------------------------------------------------


def case_context(case: helpers.ScriptCase) -> Dict[str, Any]:
    """The context a golden case runs with: the effective profile and machine, as in
    ``test_tool_list.context_of``."""
    context = case.context()
    if isinstance(case.options.get("machine"), dict):
        effective = helpers.effective_context(golden=case.directory / "case.json")
    else:
        effective = helpers.effective_context(case.profile_id)
    context["profile"] = effective["profile"]
    context["codes"] = effective["codes"]
    context["machine"] = dict(effective["machine"])
    name = case.options.get("machineName")
    if isinstance(name, str) and name:
        context["machine"]["id"] = name.lower().replace(" ", "-")
        context["machine"]["name"] = name
    context.pop("machineName", None)
    context.pop("machine_params", None)
    return context


def run_text(
    text: str,
    profile_id: str = helpers.DEFAULT_PROFILE_ID,
    params: Optional[Dict[str, Any]] = None,
    preset: Optional[str] = None,
    variant: Optional[Any] = None,
    **overrides: Any
) -> Dict[str, Any]:
    """The report for ``text`` on a profile (its defaults: no machine), as a dictionary."""
    context = helpers.effective_context(profile_id, preset=preset, variant=variant)
    context["params"] = dict(params or {})
    lines = text.split("\n")
    context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
    context.update(overrides)
    result = helpers.run_script(SCRIPT, text, context)
    if not result.ok:
        raise AssertionError("program_checks failed:\n" + result.stderr)
    return result.json()


def findings(report: Dict[str, Any], check: Optional[str] = None) -> List[Dict[str, Any]]:
    rows = report["rows"]
    return [row for row in rows if check is None or row["checkId"] == check]


def ids(report: Dict[str, Any]) -> List[str]:
    return [row["checkId"] for row in report["rows"]]


def lines_of(report: Dict[str, Any], check: Optional[str] = None) -> List[int]:
    return [row["line"] for row in findings(report, check)]


def run_case(case: helpers.ScriptCase) -> Dict[str, Any]:
    result = helpers.run_script(SCRIPT, case.input_text(), case_context(case))
    if not result.ok:
        raise AssertionError("%s failed:\n%s" % (case.name, result.stderr))
    return result.json()


#: `UPDATE_PROGRAM_CHECKS=1` rewrites every `expected.json` from the script (review the diff).
UPDATE = os.environ.get("UPDATE_PROGRAM_CHECKS") == "1"


class TestGoldenCases(unittest.TestCase):
    """Every case folder: the whole report, rows, message and run notes."""

    def test_the_fixture_folder_holds_cases(self) -> None:
        self.assertGreaterEqual(len(helpers.script_cases("program_checks")), 30)

    def test_every_case_produces_its_expected_report(self) -> None:
        for case in helpers.script_cases("program_checks"):
            with self.subTest(case=case.name):
                report = run_case(case)
                if UPDATE:
                    case.expected_file.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    continue
                self.assertEqual(report, case.expected_json())

    def test_rows_are_ordered_by_line_and_then_by_check(self) -> None:
        order = {check_id: i for i, check_id in enumerate(check_ids())}
        for case in helpers.script_cases("program_checks"):
            rows = case.expected_json()["rows"]
            with self.subTest(case=case.name):
                keys = [(row["line"], order[row["checkId"]]) for row in rows]
                self.assertEqual(keys, sorted(keys))
                for row in rows:
                    self.assertIn(row["severity"], ("info", "warning", "error"))
                    self.assertEqual(sorted(row), ["check", "checkId", "line", "message", "severity"])

    def test_every_check_has_a_golden_row(self) -> None:
        seen = set()
        for case in helpers.script_cases("program_checks"):
            seen.update(row["checkId"] for row in case.expected_json()["rows"])
        self.assertEqual(sorted(set(check_ids()) - seen), [])


# ---------------------------------------------------------------------------
# The header, the check table and the README agree
# ---------------------------------------------------------------------------

#: `tomllib` reads the script header the way the backend does; it arrived in 3.11, and
#: the gate also runs on 3.9, where those checks are skipped rather than dropped.
HAS_TOMLLIB = __import__("sys").version_info >= (3, 11)


def script_module() -> Any:
    import importlib

    module = importlib.import_module("program_checks")
    return module


def check_ids() -> List[str]:
    return [check_id for check_id, _ in script_module().CHECKS]


def header_source() -> str:
    lines = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8").split("\n")
    i = 1 if lines[0].startswith("#!") else 0
    assert lines[i].strip() == "# /// gedit"
    body = []
    i += 1
    while lines[i].strip() != "# ///":
        assert lines[i].startswith("#"), lines[i]
        body.append(lines[i][2:] if lines[i].startswith("# ") else lines[i][1:])
        i += 1
    return "\n".join(body)


class TestHeader(unittest.TestCase):
    def test_the_three_m10_scripts_ask_for_five_minutes_not_the_default_minute(self) -> None:
        # G7 (M10): tokenizing and the modal state alone take about 30 s on a 300,000-line
        # program, so the checks, the extents and the arithmetic (which has the same walk)
        # would meet the 60 s default of `scripts.timeoutSeconds` on a slow or busy
        # machine. The header wins over the setting (m5-scripts-timeout, and `timeout_secs` in
        # runner.rs), so a long program still gets its answer; m10-perf judges the 300 s.
        for name in ("program_checks.py", "extents.py", "address_arithmetic.py"):
            text = (helpers.SCRIPTS_DIR / name).read_text(encoding="utf-8")
            head = text.split("# /// gedit\n", 1)[1].split("\n# ///\n", 1)[0]
            self.assertIn("\n# timeout = 300\n", "\n" + head + "\n", name)

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_header_is_the_toml_the_backend_expects(self) -> None:
        import tomllib

        meta = tomllib.loads(header_source())
        self.assertEqual(meta["name"], "Program checks")
        self.assertEqual(meta["output"], "report")
        self.assertEqual(meta["input"], "selection-or-document")
        self.assertNotIn("envelope", meta)
        self.assertNotIn("profiles", meta)  # every dialect: the data decides what runs

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_one_bool_per_check_all_on_in_the_order_of_the_check_table(self) -> None:
        import tomllib

        params = tomllib.loads(header_source())["params"]
        checks = script_module().CHECKS
        self.assertEqual([(p["id"], p["label"]) for p in params], checks)
        for param in params:
            with self.subTest(param=param["id"]):
                self.assertEqual(param["type"], "bool")
                self.assertIs(param["default"], True)
                self.assertTrue(param["help"])

    def test_the_readme_lists_the_checks_in_the_same_order(self) -> None:
        text = (CASES_DIR / "README.md").read_text(encoding="utf-8")
        listed = re.findall(r"^\| `([A-Za-z]+)` \| (?:info|warning|error)", text, re.M)
        self.assertEqual(listed, check_ids())


# ---------------------------------------------------------------------------
# Correct programs give no finding
# ---------------------------------------------------------------------------

EXIT_DIR = helpers.FIXTURES_DIR / "exit"
OWNER_PUBLIC = helpers.FIXTURES_DIR / "nc" / "owner-public"


def decode(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    return text.replace("\r\n", "\n").replace("\r", "\n")


#: The owner's public programs (fixtures, plan §9.2) and the rows each one gives, read
#: against the manuals: a thread cut under constant surface speed in both lathe posts (the
#: Okuma manual refuses it outright), a programmed stop, the reading of an Okuma program with
#: no machine chosen, and one tape marker with no closing one. Anything else is a check that
#: cries wolf. The 5-axis programs of 45 000 to 99 000 lines run in `TestLongPrograms`.
OWNER_ROWS = {
    "fanuc-gcode/2.5D_MILLING.NC": [],
    "fanuc-gcode/5-Axis.NC": [(1, "programFrame", "info")],
    "fanuc-lathe/TURN.NC": [(205, "threadUnderCss", "warning")],
    "fanuc-lathe/TURN_1.NC": [(208, "threadUnderCss", "warning")],
    "heidenhain-klartext/2.5D_MILLING.H": [],
    "heidenhain-klartext/5-Axis-1.H": [(8388, "stops", "info")],
    "heidenhain-klartext/DRILLING.H": [],
    "heidenhain-klartext/Demo_1.H": [],
    "okuma-osp/2.5D_MILLING.min": [(12, "machineReading", "info")],
    "okuma-osp/DRILLING.min": [(12, "machineReading", "info")],
    "okuma-osp/TURN.min": [(15, "machineReading", "info"), (201, "threadUnderCss", "warning")],
    "sinumerik/TURN_1.mpf": [],
    "sinumerik-mill/2.5D_Milling.mpf": [],
    "sinumerik-mill/DRILLING.mpf": [],
    "sinumerik-mill/Demo_1.mpf": [],
}


class TestCleanPrograms(unittest.TestCase):
    def test_the_exit_fixtures_give_no_row_and_no_note(self) -> None:
        for name, profile in (
            ("fanuc-cp1252-crlf.nc", "fanuc-gcode"),
            ("fanuc-utf8-lf-packed-nul.nc", "fanuc-gcode"),
            ("klartext-utf8bom-crlf.h", "heidenhain-klartext"),
        ):
            with self.subTest(name=name):
                report = run_text(decode(EXIT_DIR / name), profile)
                self.assertEqual(report["rows"], [])
                self.assertEqual(report["findings"], [])

    def test_the_owner_public_programs_give_only_the_rows_read_against_the_manuals(self) -> None:
        for relative, expected in OWNER_ROWS.items():
            path = OWNER_PUBLIC / relative
            with self.subTest(program=relative):
                report = run_text(decode(path), relative.split("/")[0])
                self.assertEqual([(r["line"], r["checkId"], r["severity"]) for r in report["rows"]], expected)
                self.assertEqual(report["findings"], [])

    def test_every_owner_public_program_is_in_the_table(self) -> None:
        listed = set(OWNER_ROWS) | set(LONG_PROGRAMS)
        present = {"%s/%s" % (p.parent.name, p.name) for p in OWNER_PUBLIC.glob("*/*") if p.is_file()}
        self.assertEqual(sorted(present - listed), [])


#: The long owner-public programs. They run only with `PROGRAM_CHECKS_LONG=1`: a minute or
#: more each in the subprocess on a slow machine, and the short programs hold the same rules.
LONG_PROGRAMS = {
    "fanuc-gcode/5X_MILLING.NC": [],
    "heidenhain-klartext/5X_MILLING.H": [],
    "heidenhain-klartext/5X_MILLING_VECTOR.H": [],
    "okuma-osp/5X_MILLING.min": [(13, "machineReading", "info")],
    "sinumerik-mill/5X_Milling.mpf": [],
}


@unittest.skipUnless(os.environ.get("PROGRAM_CHECKS_LONG") == "1", "set PROGRAM_CHECKS_LONG=1")
class TestLongPrograms(unittest.TestCase):
    def test_the_long_owner_public_programs(self) -> None:
        mod = script_module()
        for relative, expected in LONG_PROGRAMS.items():
            with self.subTest(program=relative):
                text = decode(OWNER_PUBLIC / relative)
                context = helpers.effective_context(relative.split("/")[0])
                lines = text.split("\n")
                context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
                run = mod.Run(context, lines)
                mod.walk(run)
                rows = sorted(run.rows, key=lambda r: (r[0], r[1], r[2]))
                self.assertEqual([(r[3]["line"], r[3]["checkId"], r[3]["severity"]) for r in rows], expected)


# ---------------------------------------------------------------------------
# Rules a golden alone does not prove
# ---------------------------------------------------------------------------

MARK = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)"


def program(*lines: str) -> str:
    return "\n".join((MARK,) + lines) + "\n"


class TestSpindle(unittest.TestCase):
    def test_a_rapid_written_f_max_is_a_rapid_as_fmax_is(self) -> None:
        # The owner's Klartext posts write `L A+0 C+0 R0 F MAX M126` with the spindle stopped.
        def rows(move: str) -> List[int]:
            text = program("0 BEGIN PGM T MM", "1 TOOL CALL 1 Z S3000", "2 M5", move, "9 END PGM T MM")
            return lines_of(run_text(text, "heidenhain-klartext"), "spindleOff")

        self.assertEqual(rows("3 L X+10 R0 F MAX"), [])
        self.assertEqual(rows("3 L X+10 R0 FMAX"), [])
        self.assertEqual(rows("3 L X+10 R0 F200"), [5])

    def test_an_m_code_the_database_does_not_know_makes_the_spindle_state_unknown(self) -> None:
        # M123 may be a builder's spindle start: the cut after it is not judged.
        text = program("O1", "S1000 M3", "G1 X10. F100.", "M5", "M123", "G1 X20.", "M30")
        self.assertEqual(lines_of(run_text(text), "spindleOff"), [])
        without = program("O1", "S1000 M3", "G1 X10. F100.", "M5", "G1 X20.", "M30")
        self.assertEqual(lines_of(run_text(without), "spindleOff"), [6])

    def test_a_program_that_starts_no_spindle_is_a_subprogram_and_not_blamed(self) -> None:
        sub = program("O2", "G91 G1 Z-2. F300.", "X20.", "G90", "M99")
        self.assertEqual(findings(run_text(sub)), [])
        main = program("O1", "G1 Z-2. F300.", "S1000 M3", "X20.", "M30")
        self.assertEqual(lines_of(run_text(main), "spindleOff"), [3])

    def test_a_rapid_with_the_spindle_stopped_is_no_cut(self) -> None:
        text = program("O1", "S1000 M3", "G1 X10. F100.", "M5", "G0 Z50.", "G28 G91 Z0.", "M30")
        self.assertEqual(findings(run_text(text)), [])

    def test_a_turret_change_does_not_stop_the_spindle(self) -> None:
        text = program("O1", "G50 S2000", "T0101", "G96 S200 M3", "G1 X40. Z-5. F0.2", "T0202", "G1 X30. Z-10. F0.2", "M30")
        self.assertEqual(ids(run_text(text, "fanuc-lathe")), [])

    def test_without_the_data_the_spindle_is_not_checked_and_the_report_says_so(self) -> None:
        text = program("O1", "T1 M6", "G1 X10. F100.", "M30")
        # A database that does not say which code starts the spindle or moves at rapid: a
        # user database that lacks the `sets` members.
        context = helpers.effective_context("fanuc-gcode")
        for entry in context["codes"]:
            sets = {k: v for k, v in (entry.get("sets") or {}).items() if k not in ("spindle", "toolSpindle", "motion")}
            if sets:
                entry["sets"] = sets
            else:
                entry.pop("sets", None)
        lines = text.split("\n")
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        result = helpers.run_script(SCRIPT, text, context)
        self.assertTrue(result.ok, result.stderr)
        report = result.json()
        self.assertEqual(lines_of(report, "toolChangeSpindle"), [])
        self.assertEqual(len(report["findings"]), 1)
        self.assertIn("does not say which codes start and stop the spindle", report["findings"][0]["message"])
        self.assertEqual(lines_of(run_text(text), "toolChangeSpindle"), [4])

    def test_a_check_switched_off_writes_no_row(self) -> None:
        text = program("O1", "T1 M6", "G1 X10. F100.", "M30")
        self.assertEqual(lines_of(run_text(text, params={"toolChangeSpindle": False})), [])


class TestUnclosedStringsAndBrackets(unittest.TestCase):
    """B1: an unclosed string or ``[`` runs to the end of its line in both tokenizers and in
    the mask, and the report says so in plain words, never as a stray ``)`` of the comment
    the bracket swallowed."""

    def messages(self, profile_id: str, *lines: str) -> List[Tuple[int, str]]:
        report = run_text(program(*lines), profile_id)
        return [(row["line"], row["message"]) for row in findings(report, "brackets")]

    def test_an_unclosed_bracket_with_a_comment_behind_it_on_fanuc(self) -> None:
        self.assertEqual(
            self.messages("fanuc-gcode", "O1", "#1=[#2+1 (NOTE)", "#3=[#4 (A) +1] (B)", "G1 X10)", "M30"),
            [
                (3, "#1=[#2+1 (NOTE): a [ is opened and not closed on its line"),
                (5, "G1 X10): a ) with no ( before it"),
            ],
        )

    def test_two_unclosed_brackets_are_counted(self) -> None:
        self.assertEqual(
            self.messages("fanuc-gcode", "O1", "#1=[[#2+1", "M30"),
            [(3, "#1=[[#2+1: 2 [ are opened and not closed on its line")],
        )

    def test_an_unclosed_bracket_and_string_on_sinumerik(self) -> None:
        self.assertEqual(
            self.messages("sinumerik", "R1=[R2+3 ;NOTE", 'MSG("A;B', "R1=(R2+3", "M30"),
            [
                (2, "R1=[R2+3 ;NOTE: a [ is opened and not closed on its line"),
                (3, 'MSG("A;B: a string is opened with " and not closed on its line'),
                (4, "R1=(R2+3: a ( is opened and not closed on its line"),
            ],
        )

    def test_an_unclosed_string_on_klartext(self) -> None:
        self.assertEqual(
            self.messages("heidenhain-klartext", "0 BEGIN PGM T MM", '1 TOOL CALL "D10 Z S1000 ; NOTE', "2 END PGM T MM"),
            [(3, '1 TOOL CALL "D10 Z S1000 ; NOTE: a string is opened with " and not closed on its line')],
        )


class TestToolWordsAndMoves(unittest.TestCase):
    def test_a_fanuc_lathe_tool_word_with_or_without_its_leading_zero_is_one_form(self) -> None:
        # The tool rule takes 1 to 5 digits: T101 and T0101 are the same station and offset.
        text = program("O1", "G50 S2000", "T0101", "G96 S200 M3", "G1 X40. Z-5. F0.2", "T101", "G1 X30. F0.2", "M30")
        self.assertEqual(lines_of(run_text(text, "fanuc-lathe"), "toolWordFormat"), [])

    def test_an_undescribed_tool_word_is_reported_only_where_the_machine_states_the_form(self) -> None:
        # A machining-centre program opened with the lathe profile writes `T1 M6` (R7, R9).
        text = "\n".join(["O1", "T1 M6", "S1000 M3", "G1 X10 F100", "M02"])
        self.assertEqual(lines_of(run_text(text, "okuma-osp"), "toolWordFormat"), [])

    def test_a_klartext_path_keyword_without_its_own_words_moves_nothing(self) -> None:
        text = "\n".join(
            [
                "0 BEGIN PGM K MM",
                "1 TOOL CALL 1 Z S3000",
                "2 L Z+50 R0 FMAX M3",
                "3 M5",
                "4 L R0 F500",
                "5 LP PR+10 PA+45 F300",
                "6 END PGM K MM",
            ]
        )
        self.assertEqual(lines_of(run_text(text, "heidenhain-klartext"), "spindleOff"), [6])


class TestConflicts(unittest.TestCase):
    def test_a_conflict_is_judged_after_the_other_codes_of_its_block(self) -> None:
        on = program("O1", "T1 M6", "S1000 M3", "G41 D1 G1 X5. Y5. F500.", "G68.2 X0 Y0 Z0 I0 J45. K0", "M30")
        self.assertEqual(lines_of(run_text(on), "stateConflicts"), [6])
        same_block = program("O1", "T1 M6", "S1000 M3", "G41 D1 G1 X5. Y5. F500.", "G40 G68.2 X0 Y0 Z0 I0 J45. K0", "M30")
        self.assertEqual(lines_of(run_text(same_block), "stateConflicts"), [])
        written_with = program("O1", "T1 M6", "S1000 M3", "G41 G68.2 X0 Y0 Z0 I0 J45. K0", "M30")
        self.assertEqual(lines_of(run_text(written_with), "stateConflicts"), [5])

    def test_the_frame_a_code_opens_itself_is_not_its_own_conflict(self) -> None:
        text = program("O1", "T1 M6", "S1000 M3", "G68.2 X0 Y0 Z0 I0 J45. K0", "G53.1", "G69", "M30")
        self.assertEqual(lines_of(run_text(text), "stateConflicts"), [])


class TestToolChangeInCycle(unittest.TestCase):
    """The cycle must have been in force before the block with the tool word (two owner lathe
    posts write a tool word in the block that starts a thread cycle)."""

    def rows(self, *lines: str, profile: str = "fanuc-gcode") -> List[int]:
        return lines_of(run_text(program("O1", "S500 M3", *lines, "M30"), profile), "toolChangeInCycle")

    def test_a_tool_change_after_the_cycle_started_is_reported(self) -> None:
        self.assertEqual(self.rows("G81 X0. Y0. Z-5. R2. F100.", "T2 M6", "X10."), [5])

    def test_the_block_that_starts_the_cycle_is_no_tool_change_inside_it(self) -> None:
        self.assertEqual(self.rows("T2 M6 G81 X0. Y0. Z-5. R2. F100.", "X10.", "G80"), [])

    def test_the_block_that_cancels_the_cycle_is_none_either(self) -> None:
        self.assertEqual(self.rows("G81 X0. Y0. Z-5. R2. F100.", "G80 T2 M6"), [])


class TestRigidTapping(unittest.TestCase):
    """`M29` is a tapping call only when a tapping cycle follows it (found on the owner's lathe
    programs at the M10 integration: an M number that means something else there, and a tapping
    cycle hundreds of lines later, made twelve errors in a correct program)."""

    def rows(self, *lines: str) -> List[int]:
        return lines_of(run_text(program("O1", "T1 M6", "S500 M3", *lines, "M30")), "rigidTapping")

    def test_a_speed_between_the_call_and_the_cycle_is_reported_at_the_speed(self) -> None:
        self.assertEqual(self.rows("M29 S500", "S600", "G84 Z-10. R2. F750."), [6])

    def test_a_move_between_the_call_and_the_cycle_is_reported_at_the_move(self) -> None:
        self.assertEqual(self.rows("M29 S500", "G0 X10.", "G84 Z-10. R2. F750."), [6])

    def test_no_cycle_after_the_call_no_finding(self) -> None:
        self.assertEqual(self.rows("M29 S500", "G0 X10.", "G1 X20. F100."), [])

    def test_a_tool_call_ends_the_call_before_a_later_cycle(self) -> None:
        self.assertEqual(self.rows("M29", "G0 X10.", "T2 M6", "G0 X20.", "G84 Z-10. R2. F750."), [])

    def test_a_new_call_announces_the_cycle_itself(self) -> None:
        self.assertEqual(self.rows("M29", "G0 X10.", "M29 S500", "G84 Z-10. R2. F750."), [])

    def test_the_call_with_its_cycle_next_is_clean(self) -> None:
        self.assertEqual(self.rows("M29 S500", "G84 Z-10. R2. F750.", "G80"), [])


class TestSelectionPriming(unittest.TestCase):
    """A selection is the middle of a sentence: the lines above it decide the state."""

    ABOVE = [MARK, "%", "O1", "T1 M6", "S1000 M3", "G1 X0. F100.", "M5"]
    SELECTED = ["G1 X10.", "X20.", "M30"]

    def context(self, primed: bool) -> Dict[str, Any]:
        context = helpers.effective_context("fanuc-gcode")
        start = len(self.ABOVE) + 1
        context["input"] = {"scope": "selection", "startLine": start, "endLine": start + len(self.SELECTED) - 1}
        if primed:
            context["input"]["precedingLines"] = list(self.ABOVE)
        return context

    def report(self, primed: bool) -> Dict[str, Any]:
        result = helpers.run_script(SCRIPT, "\n".join(self.SELECTED), self.context(primed))
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_stop_above_the_selection_is_in_force_in_it(self) -> None:
        report = self.report(True)
        self.assertEqual(lines_of(report, "spindleOff"), [8])
        self.assertIn("M5 on line 7", findings(report, "spindleOff")[0]["message"])

    def test_without_the_lines_above_the_state_is_not_known_and_nothing_is_guessed(self) -> None:
        report = self.report(False)
        self.assertEqual(lines_of(report, "spindleOff"), [])
        self.assertTrue(any("were not sent" in f["message"] for f in report["findings"]))

    def test_a_selection_never_judges_the_program_frame(self) -> None:
        report = self.report(True)
        self.assertEqual(lines_of(report, "programFrame"), [])
        self.assertTrue(any("need the whole program" in f["message"] for f in report["findings"]))


class TestProgramStructure(unittest.TestCase):
    def test_a_label_behind_a_jump_does_not_define_it(self) -> None:
        # `GOTO NLOOP` names the sequence name NLOOP; it is defined once, at the head of line 6.
        report = run_text(decode(helpers.FIXTURES_DIR / "nc" / "okuma" / "o04-sub.SUB"), "okuma-osp")
        self.assertEqual(lines_of(report, "jumpTargets"), [])

    def test_a_reference_into_another_program_is_not_looked_up_here(self) -> None:
        # `M98 P2005 Q500` jumps to N500 of program 2005; only `M98 Q500` is local.
        report = run_text(decode(helpers.FIXTURES_DIR / "nc" / "fanuc-lathe" / "l04-references.nc"), "fanuc-lathe")
        self.assertEqual(lines_of(report, "jumpTargets"), [12, 13])

    def test_a_conditional_end_is_no_end(self) -> None:
        text = program("%", "O1", "S1000 M3", "IF [#1 EQ 1] THEN M30", "G0 X10.", "M30", "%")
        self.assertEqual(lines_of(run_text(text), "programFrame"), [])

    def test_a_skipped_end_is_no_end(self) -> None:
        text = program("%", "O1", "S1000 M3", "/M30", "G0 X10.", "M30", "%")
        self.assertEqual(lines_of(run_text(text), "programFrame"), [])

    def test_a_klartext_label_after_m30_still_runs(self) -> None:
        text = "\n".join(
            [
                "0 BEGIN PGM SUBS MM",
                "1 ; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE",
                "2 CALL LBL 1",
                "3 M30",
                "4 LBL 1",
                "5 L X+10 FMAX",
                "6 LBL 0",
                "7 END PGM SUBS MM",
            ]
        )
        self.assertEqual(lines_of(run_text(text, "heidenhain-klartext"), "programFrame"), [])

    def test_a_block_after_the_end_that_a_jump_names_still_runs(self) -> None:
        text = program("%", "O1", "S1000 M3", "GOTO 100", "M30", "N100 G0 X10.", "M30", "%")
        self.assertEqual(lines_of(run_text(text), "programFrame"), [])
        unnamed = program("%", "O1", "S1000 M3", "M30", "N100 G0 X10.", "%")
        self.assertEqual(lines_of(run_text(unnamed), "programFrame"), [6])

    def test_a_label_after_the_end_starts_code_that_can_run(self) -> None:
        text = "\n".join(["; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE", "N10 GOTOF SUB_1", "N20 M30", "SUB_1: G0 X10", "N30 G0 X20", "N40 GOTOB N20"])
        self.assertEqual(lines_of(run_text(text, "sinumerik-mill"), "programFrame"), [])

    def test_text_after_end_pgm_never_runs(self) -> None:
        text = "\n".join(["0 BEGIN PGM X MM", "1 L X+0 FMAX", "2 END PGM X MM", "3 L X+10 FMAX"])
        self.assertEqual(lines_of(run_text(text, "heidenhain-klartext"), "programFrame"), [4])

    def test_the_nul_leader_of_a_tape_is_no_code(self) -> None:
        text = "\0\0\0\n%\nO1\nS1000 M3\nM30\n%\n\0\0"
        self.assertEqual(findings(run_text(text)), [])


class TestNumbers(unittest.TestCase):
    def test_a_word_with_a_point_is_read_alike_by_every_fanuc_preset(self) -> None:
        self.assertEqual(findings(run_text(program("O1", "G0 X50. Z0", "M30"))), [])

    def test_a_point_less_word_is_listed_with_every_reading(self) -> None:
        rows = findings(run_text(program("O1", "G0 X50", "M30")), "machineReading")
        self.assertEqual(len(rows), 1)
        self.assertIn("0.05 mm by 'Increments of 0.001 mm (IS-B)' (the assumed default)", rows[0]["message"])

    def test_a_unit_system_is_said_once_for_the_program(self) -> None:
        text = "\n".join(["O1", "G0 X50 Z2.", "G1 X40 Z-10. F0.2", "M02"])
        rows = findings(run_text(text, "okuma-osp"), "machineReading")
        self.assertEqual(len(rows), 1)
        self.assertIn("the unit system decides every value", rows[0]["message"])

    def test_the_digit_limit_holds_under_every_reading_before_it_is_reported(self) -> None:
        # 12345.678 is 8 digits on an IS-B machine and under the calculator reading: fine.
        self.assertEqual(lines_of(run_text(program("O1", "G0 X12345.678", "M30")), "wordDigits"), [])
        self.assertEqual(lines_of(run_text(program("O1", "G0 X123456.789", "M30")), "wordDigits"), [3])
        # A count without a point is its own digits.
        self.assertEqual(lines_of(run_text(program("O1", "G4 P123456789", "M30")), "wordDigits"), [3])

    def test_a_block_longer_than_the_control_takes(self) -> None:
        long_line = "G01 X10 Z-10 F0.2 " + "(" + "A" * 150 + ")"
        report = run_text("\n".join(["O1", long_line, "M02"]), "okuma-osp", machine_params=None)
        self.assertEqual(lines_of(report, "characters"), [2])


class TestLargeReports(unittest.TestCase):
    """A report is cut at the app's row limit, here, so a long program cannot lose it whole."""

    #: 2,600 lines of three point-less dimension words each: 7,800 `machineReading` rows
    #: with no machine chosen (the Fanuc presets read a point-less number differently).
    POINTLESS = program("O1", "G0 X0 Y0", *(["G1 X1000 Y2000 Z-500 F100"] * 2600), "M30")

    def test_the_limit_is_the_apps(self) -> None:
        source = (helpers.REPO_ROOT / "src" / "lib" / "core" / "scripting" / "apply.ts").read_text(encoding="utf-8")
        found = re.search(r"export const MAX_ROWS = (\d+);", source)
        self.assertIsNotNone(found)
        self.assertEqual(script_module().MAX_ROWS, int(found.group(1)))

    def test_a_program_with_thousands_of_readings_is_listed_up_to_the_limit_and_says_so(self) -> None:
        report = run_text(self.POINTLESS)
        limit = script_module().MAX_ROWS
        self.assertEqual(len(report["rows"]), limit)
        notes = [f for f in report.get("findings", []) if "not listed" in f["message"]]
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["severity"], "warning")
        # 7,800 readings: the walk keeps 5,000 of them and counts the rest.
        self.assertIn("2800 findings are not listed", notes[0]["message"])
        self.assertIn(str(limit), notes[0]["message"])

    def test_a_report_inside_the_limit_has_no_note(self) -> None:
        report = run_text(program("O1", "G0 X50", "M30"))
        self.assertEqual([f for f in report.get("findings", []) if "not listed" in f["message"]], [])

    def test_errors_are_kept_before_information_and_the_rows_stay_in_line_order(self) -> None:
        mod = script_module()
        rows = (
            [{"line": n, "severity": "info"} for n in range(1, 11)]
            + [{"line": 11, "severity": "error"}, {"line": 12, "severity": "warning"}, {"line": 13, "severity": "error"}]
        )
        kept, cut = mod.cap_rows(rows, 5)
        self.assertEqual(cut, 8)
        self.assertEqual([r["line"] for r in kept], [1, 2, 11, 12, 13])
        self.assertEqual([r["severity"] for r in kept], ["info", "info", "error", "warning", "error"])
        same, none = mod.cap_rows(rows, 13)
        self.assertEqual((same, none), (rows, 0))

    def test_an_error_on_the_last_line_survives_a_flood_of_readings(self) -> None:
        text = self.POINTLESS.rstrip("\n") + "\nG1 X[1+2\n"
        report = run_text(text)
        self.assertEqual(len(report["rows"]), script_module().MAX_ROWS)
        self.assertIn("brackets", ids(report))

    def test_the_output_stays_far_below_what_the_app_can_read(self) -> None:
        # 7,800 rows were 2.2 MB; the cut keeps the output bounded whatever the program is.
        context = helpers.effective_context("fanuc-gcode")
        context["params"] = {}
        lines = self.POINTLESS.split("\n")
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        result = helpers.run_script(SCRIPT, self.POINTLESS, context)
        self.assertTrue(result.ok, result.stderr)
        self.assertLess(len(result.stdout.encode("utf-8")), 2_000_000)


class TestNumberReadingIsRemembered(unittest.TestCase):
    """The class of an address and the readings of a literal are asked once, not per word."""

    def test_one_class_per_combination_and_one_reading_per_literal(self) -> None:
        mod = script_module()
        context = helpers.effective_context("fanuc-gcode")
        lines = program("O1", "G0 X0 Y0", *(["G1 X1000 Y2000 Z-500 F100"] * 400), "M30").split("\n")
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        context["params"] = {}
        run = mod.Run(context, lines)
        classes = {"count": 0}
        readings = {"count": 0}
        real_class, real_resolve = mod.gedit_nc.number_class_of, mod.gedit_nc.resolve_value

        def counting_class(*args: Any, **kwargs: Any) -> Any:
            classes["count"] += 1
            return real_class(*args, **kwargs)

        def counting_resolve(*args: Any, **kwargs: Any) -> Any:
            readings["count"] += 1
            return real_resolve(*args, **kwargs)

        mod.gedit_nc.number_class_of, mod.gedit_nc.resolve_value = counting_class, counting_resolve
        try:
            mod.walk(run)
        finally:
            mod.gedit_nc.number_class_of, mod.gedit_nc.resolve_value = real_class, real_resolve
        # 402 blocks: without the memo each asks for the class of every word that could be a
        # dimension (more than 1,200 times), and the reading of each of its three literals.
        self.assertLess(classes["count"], 40)
        self.assertLess(readings["count"], 10)
        self.assertEqual(len(run.reading_rows), 400 * 3)


class TestShippedData(unittest.TestCase):
    """The members the checks read are in the shipped, resolved data, as `data-pins.json` says."""

    @staticmethod
    def entry(database: str, code: str) -> Optional[Dict[str, Any]]:
        key = gedit_nc.normalize_code(code)
        for entry in helpers.resolved_codes(database):
            if gedit_nc.normalize_code(entry["code"]) == key:
                return entry
        return None

    def test_every_pinned_code_carries_its_members(self) -> None:
        for database, members in PINS["codes"].items():
            for code, patch in members.items():
                with self.subTest(database=database, code=code):
                    entry = self.entry(database, code)
                    self.assertIsNotNone(entry)
                    for member, value in patch.items():
                        if member == "sets":
                            for key, item in value.items():
                                self.assertEqual((entry.get("sets") or {}).get(key), item, key)
                        else:
                            self.assertEqual(entry.get(member), value, member)

    def test_the_added_entries_are_there(self) -> None:
        for database, entries in PINS["add"].items():
            for added in entries:
                with self.subTest(database=database, code=added["code"]):
                    entry = self.entry(database, added["code"])
                    self.assertIsNotNone(entry)
                    for member, value in added.items():
                        self.assertEqual(entry.get(member), value, member)

    def test_the_profile_syntax_members(self) -> None:
        for profile_id, patch in PINS["profiles"].items():
            for key, value in patch["syntax"].items():
                with self.subTest(profile=profile_id, member=key):
                    self.assertEqual(helpers.resolved_profile(profile_id)["syntax"].get(key), value)
        # The lathe reads the Fanuc limit through `extends`.
        self.assertEqual(helpers.resolved_profile("fanuc-lathe")["syntax"].get("maxWordDigits"), 8)

    def test_every_member_reads_the_way_the_script_reads_it(self) -> None:
        mod = script_module()
        values = {
            "spindle": ("on", "off"), "toolSpindle": ("on", "off"), "motion": ("rapid", "feed"),
            "radiusComp": ("on", "off"), "lengthComp": ("on", "off"), "exitSpeed": ("zero",),
            "language": ("iso", "native"),
        }
        for database, members in PINS["codes"].items():
            groups = {e.get("group") for e in helpers.resolved_codes(database)}
            for code, patch in members.items():
                with self.subTest(database=database, code=code):
                    self.assertTrue(set(patch) <= {"sets", "conflicts", "alone", "requires", "contour"}, patch)
                    for key, value in patch.get("sets", {}).items():
                        self.assertIn(value, values[key])
                    for condition in patch.get("conflicts", []):
                        name = condition.lstrip("!")
                        if name.startswith("frame:"):
                            self.assertIn(name.split(":", 1)[1], groups)
                        else:
                            self.assertIn(name, mod.CONDITIONS)
                    if "alone" in patch:
                        self.assertIs(patch["alone"], True)
                    if "contour" in patch:
                        self.assertIn(patch["contour"], ("open", "close"))


class TestRunEnvironment(unittest.TestCase):
    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self) -> None:
        result = helpers.run_script(SCRIPT, stdin="T1 M6\n", context=None)
        self.assertFalse(result.ok)
        self.assertEqual(result.stdout, "")
        self.assertIn("profile", result.stderr)

    def test_a_profile_it_cannot_compile_is_a_message_and_not_a_traceback(self) -> None:
        profile = helpers.load_profile("fanuc-gcode")
        profile["toolCall"]["trigger"] = "M0*6(?!\\d"
        context = helpers.make_context(profile=profile, codes=[])
        result = helpers.run_script(SCRIPT, stdin="T1 M6\n", context=context)
        self.assertFalse(result.ok)
        self.assertIn("toolCall.trigger", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_an_empty_document_has_no_findings(self) -> None:
        report = run_text("")
        self.assertEqual(report["rows"], [])
        self.assertTrue(report["message"].startswith("No findings."))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
