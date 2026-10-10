"""M12.5 (plan section 6 M12.5, decision 7; section 7.16 #179; WP-RP2): the tokenizer fields
for the names and free text controls keep in a program, on the Python side.

The token goldens in ``tests/fixtures/tokens/`` carry the plan's lines for both tokenizers
(``test_gedit_nc.TestTokenGoldens`` runs them here, ``tokenizer.test.ts`` there). This file
holds what a golden line does not: that each new field a profile declares changes at least
one of its golden lines (so the parity test cannot pass by accident), that every new pattern
compiles in Python, the edges the TypeScript sentences pin, and the two program-check rows
the fields remove (decision 8): a ``%`` in a Klartext comment and free text read as ``T``
words. Every NC line is synthetic, written for gEdit.
"""

from __future__ import annotations

import copy
import unittest

from tests.python import helpers
from tests.python.test_gedit_nc import code_tokens, effective_profiles, golden_lines, shape
from tests.python.test_program_checks import findings, run_text

gedit_nc = helpers.import_gedit_nc()

#: The M12.5 `syntax` fields (plan section 7.16 #179).
RP_FIELDS = ["freeText", "colonWords", "callTargets", "labelAfter", "declareAfter", "plainTextRun", "tapeMarker"]


def compiled(profile_id, edit=None):
    profile = helpers.load_profile(profile_id)
    if edit is not None:
        edit(profile["syntax"])
    return gedit_nc.compile_profile(profile)


def pairs(line, cp):
    return ["%s:%s" % (token.kind, token.text) for token in code_tokens(gedit_nc.tokenize_line(line, cp)[0])]


def kinds(line, cp):
    return [token.kind for token in code_tokens(gedit_nc.tokenize_line(line, cp)[0])]


class TestTheGoldensReachEveryNewField(unittest.TestCase):
    """Each M12.5 field a profile declares changes at least one line of its own golden."""

    def test_every_new_field_a_profile_declares_changes_a_golden_line(self):
        seen = set()
        for profile_id in helpers.profile_ids():
            profile = helpers.load_profile(profile_id)
            lines = golden_lines(profile_id)
            full = [shape(gedit_nc.tokenize_line(line, gedit_nc.compile_profile(profile))[0]) for line in lines]
            for field in RP_FIELDS:
                if field not in profile["syntax"]:
                    continue
                seen.add(field)
                with self.subTest(profile=profile_id, field=field):
                    reduced = copy.deepcopy(profile)
                    del reduced["syntax"][field]
                    without = gedit_nc.compile_profile(reduced)
                    changed = [
                        line for line, tokens in zip(lines, full) if shape(gedit_nc.tokenize_line(line, without)[0]) != tokens
                    ]
                    self.assertTrue(changed, "no golden line of %s depends on syntax.%s" % (profile_id, field))
        self.assertEqual(sorted(seen), sorted(RP_FIELDS))


class TestTheNewPatternsCompile(unittest.TestCase):
    def test_every_free_text_and_call_target_pattern_compiles_in_python(self):
        profiles = [(profile_id, helpers.load_profile(profile_id)) for profile_id in helpers.profile_ids()]
        profiles += effective_profiles()
        count = 0
        for name, profile in profiles:
            syntax = profile.get("syntax") or {}
            cp = gedit_nc.compile_profile(profile)
            sources = list(syntax.get("freeText") or [])
            self.assertEqual(len(cp.patterns["free_text"]), len(sources))
            for source, regex in zip(sources, cp.patterns["free_text"]):
                with self.subTest(profile=name, pattern=source):
                    self.assertIn("text", regex.groupindex)
                    self.assertEqual(regex.pattern, gedit_nc.to_py_regex(source))
                count += 1
            if syntax.get("callTargets") is not None:
                self.assertEqual(cp.patterns["call_targets"].pattern, gedit_nc.to_py_regex(syntax["callTargets"]["pattern"]))
                count += 1
            else:
                self.assertIsNone(cp.patterns["call_targets"])
        self.assertGreaterEqual(count, 6)

    def test_a_pattern_that_does_not_compile_names_its_field(self):
        profile = helpers.load_profile("heidenhain-klartext")
        profile["syntax"]["freeText"] = ["CYCL", "(?<text>A"]
        with self.assertRaisesRegex(ValueError, r"syntax\.freeText\[1\]"):
            gedit_nc.compile_profile(profile)
        profile = helpers.load_profile("okuma-osp")
        profile["syntax"]["callTargets"] = {"after": ["CALL"]}
        with self.assertRaisesRegex(ValueError, r"syntax\.callTargets\.pattern"):
            gedit_nc.compile_profile(profile)


class TestTheEdgesOfTheNewRules(unittest.TestCase):
    """The sentences ``tokenizer.test.ts`` pins, on the Python tokenizer."""

    @classmethod
    def setUpClass(cls):
        cls.klartext = compiled("heidenhain-klartext")
        cls.sinumerik = compiled("sinumerik")
        cls.okuma = compiled("okuma-osp")
        cls.fanuc = compiled("fanuc-gcode")
        cls.lathe = compiled("fanuc-lathe")

    def test_free_text(self):
        self.assertEqual(kinds("6 CYCL DEF 7.1 X+12.5", self.klartext), ["blockNumber", "keyword", "word", "word"])
        self.assertEqual(kinds("8 CYCL DEF 200 Q200=2", self.klartext), ["blockNumber", "keyword", "word", "variable", "operator", "word"])
        self.assertNotIn("text", kinds("9 L X+1 CYCL DEF 200 DRILLING", self.klartext))
        self.assertEqual(pairs("10 CYCL DEF 200 DRILLING Q200=2", self.klartext)[3:5], ["text:DRILLING", "variable:Q200"])
        empty = compiled("heidenhain-klartext", lambda s: s.__setitem__("freeText", ["CYCL\\s+DEF\\s+\\d+\\s*(?<text>[A-Z]*)"]))
        self.assertEqual(kinds("5 CYCL DEF 200", empty), ["blockNumber", "keyword", "word"])
        inside = compiled("heidenhain-klartext", lambda s: s.__setitem__("freeText", ["L\\s+X(?<text>\\d+)"]))
        self.assertEqual(pairs("5 L X10", inside), ["blockNumber:5", "keyword:L", "word:X", "text:10"])
        middle = compiled("heidenhain-klartext", lambda s: s.__setitem__("freeText", ["FOO\\s+(?<text>[A-Z]+)\\s+BAR"]))
        self.assertEqual(pairs("5 FOO ABC BAR", middle), ["blockNumber:5", "word:FOO", "text:ABC", "word:BAR"])

    def test_free_text_of_a_name_typed_before_its_unit(self):
        # M13 review NC-7: a program name with nothing behind it yet, and the program of a
        # cycle 12 call, are text (the twin of `tokenizer.test.ts`).
        self.assertEqual(pairs("0 BEGIN PGM part1", self.klartext), ["blockNumber:0", "keyword:BEGIN PGM", "text:part1"])
        self.assertEqual(pairs("9 END PGM part1", self.klartext)[2], "text:part1")
        self.assertEqual(pairs("0 BEGIN PGM part1 MM", self.klartext)[2:], ["text:part1", "keyword:MM"])
        self.assertNotIn("text", kinds("0 BEGIN PGM part1 m", self.klartext))
        self.assertEqual(pairs("6 CYCL DEF 12.1 PGM part2", self.klartext)[-1], "text:part2")
        self.assertEqual(pairs("6 CYCL DEF 12.1 PGM TNC:\\NC\\PART2.H", self.klartext)[-1], "text:TNC:\\NC\\PART2.H")

    def test_colon_words(self):
        tokens = code_tokens(gedit_nc.tokenize_line("14 FUNCTION TURNDATA SPIN VCONST:ON VC:120 SMAX3000", self.klartext)[0])
        self.assertEqual((tokens[4].address, tokens[4].value_text, tokens[4].value), ("VCONST", "ON", None))
        self.assertEqual((tokens[5].address, tokens[5].value_text, tokens[5].value.raw), ("VC", "120", "120"))
        self.assertEqual(pairs("5 VC:12A", self.klartext)[1], "unknown:VC:12A")
        self.assertEqual(pairs("5 XVC:12", self.klartext)[1], "unknown:XVC:12")
        self.assertNotEqual(pairs("5 VC: S100", self.klartext)[1][:8], "word:VC:")

    def test_call_targets(self):
        marker = code_tokens(gedit_nc.tokenize_line("MODIN O12 Q3", self.okuma)[0])[1]
        self.assertEqual((marker.kind, marker.text, marker.address, marker.value_text), ("programMarker", "O12", None, None))
        self.assertEqual(pairs("CALL OSUB (ROUGH)", self.okuma), ["keyword:CALL", "programMarker:OSUB", "comment:(ROUGH)"])
        # B1: a subprogram name may run to 16 characters (the control's optional parameter);
        # one longer than that runs on and is no name.
        self.assertEqual(pairs("CALL OSUBPROGRAM12345", self.okuma)[1], "programMarker:OSUBPROGRAM12345")
        self.assertEqual(kinds("CALL O12345678901234567", self.okuma), ["keyword", "word"])
        self.assertNotIn("programMarker", kinds("GOTO OABCD", self.okuma))

    def test_jump_targets(self):
        self.assertEqual(kinds("GOTOC LOOP_A ;LATER", self.sinumerik), ["keyword", "label", "comment"])
        self.assertEqual(code_tokens(gedit_nc.tokenize_line("N45 GOTOB N10", self.sinumerik)[0])[-1].address, "N")
        self.assertEqual(
            kinds('N40 GOTOF "STEP_"<<COUNTER', self.sinumerik),
            ["blockNumber", "keyword", "string", "operator", "operator", "unknown"],
        )
        self.assertEqual(kinds("GOTOF MARK(1)", self.sinumerik), ["keyword", "call"])
        self.assertEqual(kinds("GOTOF 100", self.sinumerik), ["keyword"])
        # Integration: an R parameter is a variable (a computed target), not a label.
        self.assertEqual(kinds("GOTOF R10", self.sinumerik), ["keyword", "variable"])
        self.assertEqual(kinds("GOTOF R10X", self.sinumerik), ["keyword", "label"])
        self.assertEqual(kinds("GOTOF IF", self.sinumerik), ["keyword", "keyword"])

    def test_declarations(self):
        self.assertEqual(kinds("DEF INT A,B", self.sinumerik), ["keyword", "keyword", "variable", "operator", "variable"])
        self.assertEqual(pairs("DEF CHAN INT LIMIT", self.sinumerik), ["keyword:DEF", "unknown:CHAN", "keyword:INT", "variable:LIMIT"])
        self.assertEqual(kinds("N10 IF R1>1 DEF INT AB", self.sinumerik)[-1], "unknown")
        self.assertEqual(kinds("N20 IF COUNTER>1", self.sinumerik)[2], "unknown")

    def test_plain_text(self):
        self.assertEqual(pairs("M990 TRANSFER OK S 500", self.lathe)[1:], ["unknown:TRANSFER OK", "word:S 500"])
        self.assertEqual(pairs("m797spindle on", self.fanuc), ["word:m797", "unknown:spindle on"])
        self.assertEqual(kinds("G1 AB", self.fanuc), ["word", "word", "word"])
        self.assertEqual(kinds("G65 P9010 A1. B2.", self.fanuc), ["word", "word", "word", "word"])
        bare = compiled("fanuc-gcode", lambda s: s.pop("plainTextRun"))
        self.assertEqual(
            [token.text for token in code_tokens(gedit_nc.tokenize_line("M797 SPINDLE ONE", bare)[0])],
            ["M797", "S", "P", "I", "N", "D", "LE", "O", "NE"],
        )

    def test_the_keywords_and_the_sequence_name_that_is_a_keyword(self):
        self.assertEqual(kinds("NORMAL=1", self.sinumerik), ["word"])
        self.assertEqual(kinds("NOEX V1=2", self.okuma)[0], "keyword")
        self.assertEqual(code_tokens(gedit_nc.tokenize_line("NOEX1 G0", self.okuma)[0])[0].address, "OEX1")
        self.assertEqual(kinds("GOTO NOEX", self.okuma), ["keyword", "keyword"])

    def test_a_tape_marker_only_where_the_dialect_has_a_tape(self):
        self.assertEqual(kinds("%", self.klartext), ["operator"])
        self.assertEqual(kinds("%", self.fanuc), ["programMarker"])
        self.assertEqual(kinds("%", compiled("heidenhain-klartext", lambda s: s.pop("tapeMarker"))), ["programMarker"])

    def test_the_mask_leaves_a_text_token_as_it_is(self):
        line = "12 CYCL DEF 207 TAP.-RIGID NEW ;CHECK"
        self.assertEqual(gedit_nc.mask_comments(line, self.klartext), "12 CYCL DEF 207 TAP.-RIGID NEW       ")


class TestTheCheckRowsTheFieldsRemove(unittest.TestCase):
    """Decision 8 of M12.5: false alarms that go with the tokenizer."""

    def test_a_percent_sign_in_a_klartext_comment_is_no_tape_marker(self):
        program = "0 BEGIN PGM RP2 MM\n7 Q1=+100 ;INPUT 50...150 %\n8 L X+1 FMAX\n9 END PGM RP2 MM"
        report = run_text(program, "heidenhain-klartext")
        self.assertEqual(findings(report, "tapeMarkerInComment"), [])

    def test_the_iso_dialects_still_report_one(self):
        program = "%\nO1000\nN10 G0 X0 (50 %)\nM30\n%"
        report = run_text(program, "fanuc-gcode")
        self.assertEqual([row["line"] for row in findings(report, "tapeMarkerInComment")], [3])

    def test_free_text_after_a_code_is_no_row_of_t_words(self):
        program = "%\nO1000\nN10 M797 WAIT FOR THE TURRET TO TURN\nN20 T0101\nM30\n%"
        report = run_text(program, "fanuc-lathe")
        self.assertEqual(findings(report, "blockWords"), [])


if __name__ == "__main__":
    unittest.main()
