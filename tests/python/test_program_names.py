"""Fanuc program names (``<SHAFT_T12>``) as the bundled scripts see them (plan §7.16).

A program on the 30i family may be **named** instead of numbered: the name stands in
angle brackets where ``O1234`` would stand, and behind the call words (``M98 <SUB> L2``,
``G65 <MACRO> A1.``). The control reads the characters inside the brackets like comment
text. Read letter by letter, the name was a row of address words: scale feed rewrote the
``F12`` of ``<CHAMFER_F12>`` into ``<CHAMFER_F6>`` at 50 % — another program's name, so the call
to it broke — and on the lathe the ``T12`` of a name was a tool change.

The profile field ``syntax.programNames`` makes the name one ``programMarker`` token in
``_nc_lex`` (and in ``tokenizer.ts``, on the same goldens). The three scripts tokenize
through ``_nc_lex`` and were not changed; this file proves that they leave a name alone
once the lexer returns the token, and — by running each case once more with the field taken
out of the profile — that it is the token that protects the name, not an accident of the
program.

Every NC line here is synthetic, written for gEdit from ``syntax-fanuc.md`` §2.2 and the
file-name rules of the Series 30i manual; ``l08-named-programs.nc`` is the shared fixture.
"""

from __future__ import annotations

import copy
import re
import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

FIXTURE = helpers.FIXTURES_DIR / "nc" / "fanuc-lathe" / "l08-named-programs.nc"

#: A milling program whose names hold an `S` and an `F` word, for the speed script.
MILL = "\n".join(
    [
        "(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)",
        "%",
        "<SPINDLE_S1200> (MILL - NAMED)",
        "G21 G90 G94",
        "T1 M6",
        "S1000 M3",
        "G0 X0. Y0.",
        "M98 <POCKET_S800_F12> L2",
        "G65 <PROBE_S5> A1.",
        "G1 X10. F200.",
        "M30",
        "%",
        "",
    ]
)

NAME = re.compile(r"<[A-Za-z0-9+\-_.]+>")


def without_names(profile):
    """The profile as it was before the field: the regression gate of every case below."""
    reduced = copy.deepcopy(profile)
    del reduced["syntax"]["programNames"]
    return reduced


def run(script, text, profile_id, params, strip=False):
    context = helpers.effective_context(profile_id)
    context["params"] = dict(params)
    context["input"]["endLine"] = len(text.split("\n"))
    if strip:
        context["profile"] = without_names(context["profile"])
    result = helpers.run_script(script, stdin=text, context=context)
    if not result.ok:
        raise AssertionError(result.stderr)
    return result.json()


def changed_lines(before, after):
    return [(a, b) for a, b in zip(before.split("\n"), after.split("\n")) if a != b]


class TestTheLexerReadsAName(unittest.TestCase):
    def test_both_fanuc_profiles_declare_the_field(self):
        for profile_id in ["fanuc-gcode", "fanuc-lathe"]:
            with self.subTest(profile=profile_id):
                cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
                self.assertIsNotNone(cp.patterns["program_names"])

    def test_the_field_changes_golden_lines_of_both_fanuc_profiles(self):
        # The parity test of `test_gedit_nc` proves the field only if a golden depends on it.
        for profile_id in ["fanuc-gcode", "fanuc-lathe"]:
            with self.subTest(profile=profile_id):
                profile = helpers.load_profile(profile_id)
                full = gedit_nc.compile_profile(profile)
                reduced = gedit_nc.compile_profile(without_names(profile))
                lines = [
                    entry["line"]
                    for entry in helpers.load_json(helpers.FIXTURES_DIR / "tokens" / (profile_id + ".json"))
                ]
                changed = [
                    line
                    for line in lines
                    if [(t.kind, t.text) for t in gedit_nc.tokenize_line(line, full)[0]]
                    != [(t.kind, t.text) for t in gedit_nc.tokenize_line(line, reduced)[0]]
                ]
                self.assertGreaterEqual(len(changed), 4, changed)

    def test_a_name_is_one_program_marker_with_no_address_wherever_it_stands(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("fanuc-lathe"))
        for line in FIXTURE.read_text(encoding="utf-8").split("\n") + MILL.split("\n"):
            tokens, _ = gedit_nc.tokenize_line(line, cp)
            for match in NAME.finditer(line):
                if line.lstrip().startswith("("):
                    continue
                with self.subTest(line=line, name=match.group(0)):
                    covering = [t for t in tokens if t.start < match.end() and t.end > match.start()]
                    self.assertEqual([(t.kind, t.text, t.address) for t in covering], [("programMarker", match.group(0), None)])

    def test_the_mask_writes_an_underscore_for_each_letter_and_digit(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("fanuc-lathe"))
        self.assertEqual(gedit_nc.mask_comments("<SHAFT-T12.A> (OD PIN)", cp), "<_____-___._>         ")
        self.assertEqual(gedit_nc.mask_comments("N10 M98<SUB+M30>L2", cp), "N10 M98<___+___>L2")
        self.assertEqual(gedit_nc.mask_comments("G1 X1. (<SUB_T1>)", cp), "G1 X1.           ")

    def test_a_dialect_without_the_field_reads_brackets_as_before(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("sinumerik"))
        tokens, _ = gedit_nc.tokenize_line("IF R1<R2 GOTOF END_A", cp)
        self.assertNotIn("programMarker", [t.kind for t in tokens])


class TestScaleFeed(unittest.TestCase):
    PARAMS = {"percent": 50, "perRevolution": "yes"}

    def test_the_names_come_back_byte_for_byte_and_the_feeds_are_scaled(self):
        text = FIXTURE.read_text(encoding="utf-8")
        out = run("scale_feed.py", text, "fanuc-lathe", self.PARAMS)
        self.assertEqual(
            changed_lines(text, out["text"]),
            [("G01 U-4. F0.08", "G01 U-4. F0.04"), ("G01 U-3. W-1.5 F0.12", "G01 U-3. W-1.5 F0.06")],
        )
        self.assertEqual(NAME.findall(out["text"]), NAME.findall(text))

    def test_the_mill_names_come_back_as_well(self):
        out = run("scale_feed.py", MILL, "fanuc-gcode", {"percent": 50})
        self.assertEqual(changed_lines(MILL, out["text"]), [("G1 X10. F200.", "G1 X10. F100.")])

    def test_without_the_token_the_script_renamed_a_program(self):
        text = FIXTURE.read_text(encoding="utf-8")
        out = run("scale_feed.py", text, "fanuc-lathe", self.PARAMS, strip=True)
        self.assertIn(("M98 <CHAMFER_F12>", "M98 <CHAMFER_F6>"), changed_lines(text, out["text"]))


class TestScaleSpeed(unittest.TestCase):
    def test_the_names_come_back_byte_for_byte_and_the_speed_is_scaled(self):
        out = run("scale_speed.py", MILL, "fanuc-gcode", {"percent": 50})
        self.assertEqual(changed_lines(MILL, out["text"]), [("S1000 M3", "S500 M3")])

    def test_the_lathe_names_come_back_as_well(self):
        text = FIXTURE.read_text(encoding="utf-8")
        out = run("scale_speed.py", text, "fanuc-lathe", {"percent": 50})
        self.assertEqual(changed_lines(text, out["text"]), [("G96 S180 M03", "G96 S90 M03")])

    def test_without_the_token_the_script_renamed_a_program(self):
        out = run("scale_speed.py", MILL, "fanuc-gcode", {"percent": 50}, strip=True)
        self.assertIn(("<SPINDLE_S1200> (MILL - NAMED)", "<SPINDLE_S600> (MILL - NAMED)"), changed_lines(MILL, out["text"]))


class TestToolList(unittest.TestCase):
    def rows(self, text, profile_id, strip=False):
        return [(row["tool"], row["line"], row["calls"]) for row in run("tool_list.py", text, profile_id, {}, strip)["rows"]]

    def test_a_tool_word_inside_a_name_is_no_tool(self):
        text = FIXTURE.read_text(encoding="utf-8")
        self.assertEqual(self.rows(text, "fanuc-lathe"), [("T1", 6, 1)])
        self.assertEqual(self.rows(MILL, "fanuc-gcode"), [("T1", 5, 1)])

    def test_without_the_token_the_names_were_tools(self):
        text = FIXTURE.read_text(encoding="utf-8")
        self.assertEqual(self.rows(text, "fanuc-lathe", strip=True), [("T12", 3, 1), ("T1", 6, 1), ("T3", 11, 2)])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
