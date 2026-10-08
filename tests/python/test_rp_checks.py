"""M12.5 "Real programs, second pass", WP-RP4: the program checks' false alarms and end checks.

Every case is a synthetic program written for gEdit (plan §6 M12.5 decisions 4, 8 and 9);
each "no row" case gave a row before the fix, and each end case gave none. Standard library
only; run from the repository root::

    python3 -m unittest tests.python.test_rp_checks

The cycle-19 reading (decision 6) is a modal golden
(``tests/fixtures/modal/heidenhain-klartext/tilt-reset.json``) and a rule test in
``test_modal.py``.
"""

from __future__ import annotations

import copy
import unittest
from typing import Any, Dict, List, Optional

from tests.python import helpers
from tests.python.test_program_checks import SCRIPT, findings, lines_of, run_text

MARK = "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)"
KMARK = "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE"
SMARK = "; WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE"


def text(*lines: str) -> str:
    return "\n".join(lines)


def document(name: str) -> Dict[str, Any]:
    return {
        "path": "/work/" + name,
        "name": name,
        "profile": "sinumerik",
        "encoding": "utf-8",
        "hasBom": False,
        "lineEnding": "lf",
        "modified": False,
    }


class TestBlockWords(unittest.TestCase):
    """Decision 8: `T<a> T<b> M6` is legal (owner, 2026-10-08, M9-1)."""

    def test_two_tool_words_with_the_tool_change_code_are_no_finding(self) -> None:
        program = text("%", "O1000", MARK, "N10 G90 G54", "N20 T7 T8 M6", "N30 S1200 M3", "N40 G0 X0 Y0", "N50 M30", "%")
        self.assertEqual(lines_of(run_text(program, "fanuc-gcode"), "blockWords"), [])

    def test_two_tool_words_without_the_change_code_are_still_reported(self) -> None:
        program = text("%", "O1000", MARK, "N10 G90 G54", "N20 T7 T8", "N30 M6", "N40 S1200 M3", "N50 M30", "%")
        self.assertEqual(lines_of(run_text(program, "fanuc-gcode"), "blockWords"), [5])

    def test_three_tool_words_with_the_change_code_are_still_reported(self) -> None:
        program = text("%", "O1000", MARK, "N20 T7 T8 T9 M6", "N30 S1200 M3", "N50 M30", "%")
        self.assertEqual(lines_of(run_text(program, "fanuc-gcode"), "blockWords"), [4])

    def test_a_lathe_whose_tool_word_is_the_change_keeps_the_finding(self) -> None:
        # The lathe's trigger is the tool word itself: no separate change code in the block.
        program = text("%", "O1000", MARK, "N10 G50 S2000", "N20 T0101 T0202", "N30 G96 S200 M3", "N40 M30", "%")
        self.assertEqual(lines_of(run_text(program, "fanuc-lathe"), "blockWords"), [5])

    def test_a_mill_turn_tool_change_read_by_the_lathe_profile_is_no_finding(self) -> None:
        # M12.5 review: a mill-turn program is read with the lathe profile, whose trigger is
        # the tool word itself; the block's own `M6` makes the two words legal there too.
        for block in ("N10 T01 T02 M06", "N10 T1 T2 M6", "N10 T12012 T13013 M6"):
            with self.subTest(block=block):
                program = text("%", "O1000", MARK, "N5 G50 S2000", block, "N30 M30", "%")
                self.assertEqual(lines_of(run_text(program, "fanuc-lathe"), "blockWords"), [])


class TestSpindleOff(unittest.TestCase):
    """Decision 8: a bare path keyword is no move, not even with a cycle number behind it."""

    def program(self, *middle: str) -> str:
        return text("0 BEGIN PGM SPIN MM", KMARK, *middle, "8 L X+0 Y+0 R0 FMAX M3", "9 L X+10 R0 F200", "10 END PGM SPIN MM")

    def test_a_bare_l_in_front_of_the_tolerance_cycle_is_no_cut(self) -> None:
        report = run_text(self.program("5 L CYCL DEF 32.0 TOLERANCE", "6 CYCL DEF 32.1 T0.05"), "heidenhain-klartext")
        self.assertEqual(lines_of(report, "spindleOff"), [])

    def test_a_bare_l_on_its_own_line_is_no_cut(self) -> None:
        report = run_text(self.program("5 L", "6 CYCL DEF 32.0 TOLERANCE"), "heidenhain-klartext")
        self.assertEqual(lines_of(report, "spindleOff"), [])

    def test_a_feed_move_before_the_first_spindle_start_is_still_reported(self) -> None:
        report = run_text(self.program("5 L X+5 R0 F200"), "heidenhain-klartext")
        self.assertEqual(lines_of(report, "spindleOff"), [3])

    def test_the_words_of_a_cycle_definition_behind_a_bare_l_are_no_cut(self) -> None:
        # M12.5 review: `T` is cycle 32's tolerance and `TA` its angle tolerance, written
        # behind a bare `L` after the spindle stopped; a cycle definition moves nothing.
        for tolerance in ("6 L CYCL DEF 32.1 T0.05", "6 L CYCL DEF 32.1 T0,05"):
            with self.subTest(tolerance=tolerance):
                program = text(
                    "0 BEGIN PGM T MM", KMARK, "1 TOOL CALL 1 Z S1000", "2 L Z+50 R0 FMAX M3", "3 L X+0 F500",
                    "4 L Z+50 R0 FMAX M5", "5 L CYCL DEF 32.0 TOLERANCE", tolerance,
                    "7 L CYCL DEF 32.2 HSC-MODE:1 TA0.5", "8 END PGM T MM",
                )
                self.assertEqual(lines_of(run_text(program, "heidenhain-klartext"), "spindleOff"), [])
        program = text("0 BEGIN PGM T MM", KMARK, "1 TOOL CALL 1 Z S1000", "2 L Z+50 R0 FMAX M3", "4 L Z+50 R0 FMAX M5", "5 L X+10 F500", "8 END PGM T MM")
        self.assertEqual(lines_of(run_text(program, "heidenhain-klartext"), "spindleOff"), [6])

    def test_a_polar_move_still_cuts(self) -> None:
        report = run_text(self.program("5 CC X+0 Y+0", "6 LP PR+10 PA+45 F300"), "heidenhain-klartext")
        self.assertEqual(lines_of(report, "spindleOff"), [4])


class TestJumpTargets(unittest.TestCase):
    """Decision 8: a target written as an expression is not judged."""

    def rows(self, *lines: str) -> List[int]:
        return lines_of(run_text(text(SMARK, *lines), "sinumerik"), "jumpTargets")

    def test_a_computed_target_is_not_judged(self) -> None:
        self.assertEqual(
            self.rows("N10 DEF INT COUNTER", "N20 COUNTER=1", 'N40 GOTOF "STEP_"<<COUNTER', "STEP_1:", "N60 M30"),
            [],
        )

    def test_a_string_or_a_variable_target_is_not_judged(self) -> None:
        self.assertEqual(self.rows('N10 GOTOF "AWAY"', "N20 GOTOF R10", "N30 GOTOF COUNT<<1", "N60 M30"), [])

    def test_a_plain_name_that_is_no_label_is_still_reported(self) -> None:
        self.assertEqual(self.rows("N10 GOTOF NOWHERE", "N60 M30"), [2])

    def test_a_plain_name_that_is_a_label_is_still_followed(self) -> None:
        self.assertEqual(self.rows("N10 GOTOF SKIPSIM", "N20 G0 X10", "SKIPSIM:", "N60 M30"), [])


class TestProgramEnd(unittest.TestCase):
    """Decision 9: a program the file ends inside of, with no end."""

    def test_a_klartext_program_without_end_pgm(self) -> None:
        report = run_text(text("0 BEGIN PGM T MM", KMARK, "2 L X+1 FMAX"), "heidenhain-klartext")
        rows = findings(report, "programFrame")
        self.assertEqual([(r["line"], r["severity"]) for r in rows], [(3, "error")])
        self.assertIn("BEGIN PGM T MM", rows[0]["message"])

    def test_a_klartext_end_pgm_with_another_name(self) -> None:
        report = run_text(text("0 BEGIN PGM T MM", KMARK, "2 L X+1 FMAX", "3 END PGM U MM"), "heidenhain-klartext")
        rows = findings(report, "programFrame")
        self.assertEqual([(r["line"], r["severity"]) for r in rows], [(4, "error")])
        self.assertIn("names it T", rows[0]["message"])

    def test_a_klartext_program_with_its_end_pgm_is_clean(self) -> None:
        report = run_text(text("0 BEGIN PGM T MM", KMARK, "2 L X+1 FMAX", "3 END PGM T MM"), "heidenhain-klartext")
        self.assertEqual(lines_of(report, "programFrame"), [])

    def test_a_sinumerik_main_program_without_an_end_code(self) -> None:
        program = text(SMARK, "N10 G0 X100 Z5", "N20 G1 X50 F0.2", "N90 G0 X100")
        rows = findings(run_text(program, "sinumerik", document=document("PART.MPF")), "programFrame")
        self.assertEqual([(r["line"], r["severity"]) for r in rows], [(4, "error")])

    def test_an_untitled_sinumerik_document_is_not_judged(self) -> None:
        # M12.5 review: without a file name nothing says main program or subprogram; a pasted
        # subprogram body or a snippet is no file cut short.
        program = text(SMARK, "N10 G0 X100", "N20 G1 X50 F0.2", "N30 G1 X40")
        self.assertEqual(lines_of(run_text(program, "sinumerik"), "programFrame"), [])
        self.assertEqual(lines_of(run_text(program, "sinumerik", document=document("PART.MPF")), "programFrame"), [4])

    def test_a_main_program_that_ends_in_an_unconditional_jump_back_is_not_cut_short(self) -> None:
        # M12.5 review: an endless `GOTOB` loop cannot fall through to the end of the file.
        loop = text(SMARK, "START:", "N10 G0 X100", "N20 G1 X50 F0.2", "N90 GOTOB START")
        self.assertEqual(lines_of(run_text(loop, "sinumerik", document=document("PART.MPF")), "programFrame"), [])
        # A conditional jump, a skippable one and `GOTOS` (which goes on when the PLC signal
        # is 0) can fall through, so the program is still judged.
        for last in ("N90 IF R1>0 GOTOB START", "/N90 GOTOB START", "N90 GOTOS"):
            with self.subTest(last=last):
                program = text(SMARK, "START:", "N10 G0 X100", "N20 G1 X50 F0.2", last)
                self.assertEqual(lines_of(run_text(program, "sinumerik", document=document("PART.MPF")), "programFrame"), [5])

    def test_a_subprogram_header_written_as_a_comment_names_a_subprogram(self) -> None:
        # M12.5 review: `;%_N_SUB_SPF` is a program start as `%_N_SUB_SPF` is, in a file
        # whose name does not say SPF.
        for header in (";%_N_SUB_SPF", "%_N_SUB_SPF"):
            with self.subTest(header=header):
                program = text(header, SMARK, "N10 G0 X100", "N20 G1 X50 F0.2")
                self.assertEqual(lines_of(run_text(program, "sinumerik", document=document("SUB")), "programFrame"), [])

    def test_the_data_section_at_the_end_of_an_archive_has_no_end_to_miss(self) -> None:
        # M12.5 review: `%_N_<n>_<m>_MPF` with `<m>` other than 0 holds data (tool data and
        # the like), not a program; a channel section `_0_` without an end is still judged.
        programs = text("%_N_1_0_MPF", SMARK, "N10 G0 X100", "N20 M30", "%_N_2_0_MPF", "N10 G0 X100", "N20 M30")
        data = text(programs, "%_N_2_7_MPF", "$TC_DP1[1,1]=120")
        self.assertEqual(lines_of(run_text(data, "sinumerik", document=document("ARCHIVE.MPF")), "programFrame"), [])
        cut = text("%_N_1_0_MPF", SMARK, "N10 G0 X100", "N20 M30", "%_N_2_0_MPF", "N10 G0 X100")
        self.assertEqual(lines_of(run_text(cut, "sinumerik", document=document("ARCHIVE.MPF")), "programFrame"), [6])

    def test_a_sinumerik_subprogram_without_an_end_code_is_not_judged(self) -> None:
        program = text(SMARK, "N10 G0 X100 Z5", "N20 G1 X50 F0.2", "N90 G0 X100")
        self.assertEqual(lines_of(run_text(program, "sinumerik", document=document("PART.SPF")), "programFrame"), [])
        header = text("%_N_PART_SPF", SMARK, "N10 G0 X100", "N90 G0 X100")
        self.assertEqual(lines_of(run_text(header, "sinumerik"), "programFrame"), [])
        proc = text(SMARK, "PROC PART", "N10 G0 X100", "N90 G0 X100")
        self.assertEqual(lines_of(run_text(proc, "sinumerik"), "programFrame"), [])

    def test_a_sinumerik_main_program_that_ends_is_clean(self) -> None:
        for end in ("N90 M30", "N90 M2", "N90 M02", "N90 M17", "N90 RET"):
            with self.subTest(end=end):
                program = text("%_N_PART_MPF", SMARK, "N10 G0 X100", end)
                self.assertEqual(lines_of(run_text(program, "sinumerik"), "programFrame"), [])

    def test_a_sinumerik_mill_main_program_is_judged_the_same(self) -> None:
        program = text(SMARK, "N10 T1 M6", "N20 G0 X0 Y0")
        self.assertEqual(lines_of(run_text(program, "sinumerik-mill", document=document("PART.MPF")), "programFrame"), [3])

    def test_a_fanuc_program_without_tape_markers_keeps_its_old_reading(self) -> None:
        # Decision 9 names Klartext and Sinumerik; the Fanuc tape rule is unchanged.
        program = text("O1000", MARK, "G0 X10.", "G1 X20. F100.")
        self.assertEqual(lines_of(run_text(program, "fanuc-gcode"), "programFrame"), [])

    def test_a_selection_never_judges_the_end(self) -> None:
        program = text(SMARK, "N10 G0 X100", "N90 G0 X100")
        context_lines = program.split("\n")
        report = run_text(
            program,
            "sinumerik",
            input={"scope": "selection", "startLine": 1, "endLine": len(context_lines)},
        )
        self.assertEqual(lines_of(report, "programFrame"), [])


class TestMachineWaitCodes(unittest.TestCase):
    """Decision 4, the checks' half: a line that holds one of the machine's channel marks gets
    no `requiredWords` and no `aloneInBlock` row (the machine's wait code wins)."""

    def context(self, marks: bool, requires: Optional[List[str]] = None, alone: bool = False) -> Dict[str, Any]:
        context = copy.deepcopy(helpers.effective_context("fanuc-lathe"))
        # The shipped database has no `requires` on M198 (its P is a hover note); a user
        # database that asks for one shows the rule.
        for entry in context["codes"]:
            if entry.get("code") == "M198":
                if requires:
                    entry["requires"] = requires
                if alone:
                    entry["alone"] = True
        if marks:
            context["channels"] = {
                "layout": "multi-file",
                "self": "1",
                "list": [{"id": "1", "name": "Path 1"}, {"id": "2", "name": "Path 2"}],
                "outside": [],
                "marks": [{"id": "M198", "line": 4, "channel": "1", "partners": ["2"], "blocking": True}],
            }
        return context

    def run_with(self, program: str, context: Dict[str, Any]) -> Dict[str, Any]:
        lines = program.split("\n")
        context["params"] = {}
        context["input"] = {"scope": "document", "startLine": 1, "endLine": len(lines)}
        result = helpers.run_script(SCRIPT, program, context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_wait_code_alone_in_its_block_needs_no_p(self) -> None:
        program = text("%", "O1000", MARK, "N10 M198", "N20 M30", "%")
        without = self.run_with(program, self.context(marks=False, requires=["P"]))
        self.assertEqual(lines_of(without, "requiredWords"), [4])
        machine = self.run_with(program, self.context(marks=True, requires=["P"]))
        self.assertEqual(lines_of(machine, "requiredWords"), [])

    def test_a_wait_code_line_gets_no_alone_row(self) -> None:
        program = text("%", "O1000", MARK, "N10 M198 G4 X1.", "N20 M30", "%")
        without = self.run_with(program, self.context(marks=False, alone=True))
        self.assertEqual(lines_of(without, "aloneInBlock"), [4])
        machine = self.run_with(program, self.context(marks=True, alone=True))
        self.assertEqual(lines_of(machine, "aloneInBlock"), [])


if __name__ == "__main__":
    unittest.main()
