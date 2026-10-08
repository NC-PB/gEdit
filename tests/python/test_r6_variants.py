"""The two R6 machine choices, the Python half (plan M9 WP9.4, section 8.8 "The M9 variants").

``fanuc-lathe`` ``incrementalAddresses`` (``uw`` default, ``uwvh``, ``none``) and
``fanuc-lathe`` / ``okuma-osp`` ``toolWord`` (on the lathe ``byLength`` default since M12.5,
``offset2``, ``offset1``, ``offset3``; on Okuma ``offset2`` default and ``offset3``) are
overlays on the effective profile, and so is M12.5's ``sinumerik-mill`` ``toolChange``
(``m6`` default, ``t``). Python never merges a machine itself; it reads the
effective profile ``tests/unit/resolved.test.ts`` wrote for each choice, so these tests prove
the files Python really gets: ``incremental_axes`` under each choice, the tool rule of each
choice on the same word table the TypeScript test reads
(``tests/fixtures/machines/files/r6-tool-words.json``), and the bundled tool list under a
three-digit-offset machine.
"""

from __future__ import annotations

import unittest

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

LATHE = "fanuc-lathe"
OKUMA = "okuma-osp"
WORDS = helpers.load_json(helpers.FIXTURES_DIR / "machines" / "files" / "r6-tool-words.json")


def profile_of(profile_id, **choice):
    """The effective profile of one choice (every other variant at its default)."""
    (name, value), = choice.items()
    return helpers.effective_context(profile_id, variant=(name, value))["profile"]


def tool_of(compiled, word):
    """What the tool rule makes of ``word``: the tool, or ``None`` for no tool change."""
    patterns = compiled.patterns
    if patterns["tool_trigger"].search(word) is None:
        return None
    ignore = patterns.get("tool_ignore")
    if ignore is not None and ignore.search(word) is not None:
        return None
    match = patterns["tool"].search(word)
    return match.group("tool") if match is not None else None


class TestIncrementalAddresses(unittest.TestCase):
    def test_the_default_is_the_reading_before_m9(self):
        context = helpers.effective_context(LATHE)
        self.assertEqual(gedit_nc.incremental_axes(context["profile"]), {"U": "X", "W": "Z"})
        self.assertEqual(context["profile"]["addresses"]["diameter"], ["X", "U"])
        self.assertEqual(context["machine"]["params"]["variants"]["incrementalAddresses"], "uw")

    def test_each_choice(self):
        expected = {
            "uw": ({"U": "X", "W": "Z"}, ["X", "U"]),
            "uwvh": ({"U": "X", "W": "Z", "V": "Y", "H": "C"}, ["X", "U"]),
            "none": ({}, ["X"]),
        }
        for choice, (incremental, diameter) in expected.items():
            with self.subTest(choice=choice):
                profile = profile_of(LATHE, incrementalAddresses=choice)
                self.assertEqual(gedit_nc.incremental_axes(profile), incremental)
                self.assertEqual(gedit_nc.diameter_axes(profile), diameter)
                self.assertEqual(profile["addresses"]["axes"], ["X", "Z", "C", "Y", "U", "W"])

    def test_the_resolved_base_states_no_twin_and_okuma_never_did(self):
        self.assertEqual(gedit_nc.incremental_axes(helpers.load_profile(LATHE)), {})
        self.assertEqual(gedit_nc.incremental_axes(helpers.effective_context(OKUMA)["profile"]), {})


class TestToolWord(unittest.TestCase):
    def test_every_word_of_the_shared_table(self):
        count = 0
        for profile_id, choices in WORDS.items():
            if profile_id == "about":
                continue
            for choice, words in choices.items():
                compiled = gedit_nc.compile_profile(profile_of(profile_id, toolWord=choice))
                for word, tool in words.items():
                    count += 1
                    with self.subTest(profile=profile_id, choice=choice, word=word):
                        self.assertEqual(tool_of(compiled, word), tool)
        self.assertGreaterEqual(count, 50)

    def test_the_default_choice_is_the_rule_the_profile_had_before(self):
        # The lathe's default is ``byLength`` since M12.5 decision 1 (the owner, 2026-10-08);
        # Okuma's is still ``offset2``. Either way the base profile states its default.
        for profile_id, default in ((LATHE, "byLength"), (OKUMA, "offset2")):
            with self.subTest(profile=profile_id):
                resolved = helpers.load_profile(profile_id)["toolCall"]
                effective = helpers.effective_context(profile_id)["profile"]["toolCall"]
                self.assertEqual(effective, resolved)
                self.assertEqual(profile_of(profile_id, toolWord=default)["toolCall"], resolved)

    def test_a_lathe_with_no_machine_reads_five_digits_two_plus_three(self):
        # M12.5 decision 1: ``T12000 M6`` loads tool 12 into the milling spindle and
        # ``T12012`` is tool 12 with offset 12; the 3 + 2 machine setting reads 120 for both.
        program = "%\nO2000\nN10 G50 S3000\nN20 T12000 M6\nN30 T12012\nN40 G96 S200 M3\nN60 M30\n%\n"
        for choice, tools in ((None, ["T12"]), ("offset2", ["T120"])):
            with self.subTest(choice=choice):
                context = (
                    helpers.effective_context(LATHE)
                    if choice is None
                    else helpers.effective_context(LATHE, variant=("toolWord", choice))
                )
                full = helpers.make_context(profile=context["profile"], codes=context["codes"])
                full["machine"] = context["machine"]
                result = helpers.run_script("tool_list.py", stdin=program, context=full)
                self.assertTrue(result.ok, result.stderr)
                rows = result.json()["rows"]
                self.assertEqual([row["tool"] for row in rows], tools)
                self.assertEqual([row["calls"] for row in rows], [2])
                self.assertEqual([row["line"] for row in rows], [4])


class TestSiemensMillToolChange(unittest.TestCase):
    """M12.5 decision 5: ``sinumerik-mill`` ``toolChange`` (``m6`` as built, ``t``)."""

    def report(self, program, choice=None):
        context = (
            helpers.effective_context("sinumerik-mill")
            if choice is None
            else helpers.effective_context("sinumerik-mill", variant=("toolChange", choice))
        )
        full = helpers.make_context(profile=context["profile"], codes=context["codes"])
        full["machine"] = context["machine"]
        result = helpers.run_script("tool_list.py", stdin=program, context=full)
        self.assertTrue(result.ok, result.stderr)
        return [(row["tool"], row["line"]) for row in result.json()["rows"]]

    def test_t_lists_the_tool_of_a_program_without_m6(self):
        program = "N10 T5\nN20 L6\nN30 G0 X0 Y0 Z5\nN40 M30\n"
        self.assertEqual(self.report(program, "t"), [("T5", 1)])
        # The defaults (m6) list nothing, as before M12.5: the program map agrees on both
        # (``sinumerikMill.test.ts``), and the app hands a script the detected variant.
        self.assertEqual(self.report(program), [])

    def test_m6_is_the_default_and_reads_as_built(self):
        self.assertEqual(
            helpers.effective_context("sinumerik-mill")["machine"]["params"]["variants"], {"toolChange": "m6"}
        )
        self.assertEqual(self.report("N10 T5\nN20 M6\nN30 M30\n", "m6"), [("T5", 2)])
        self.assertEqual(self.report("N10 T5\nN20 M6\nN30 M30\n"), [("T5", 2)])

    def test_both_detection_rules_compile_in_python(self):
        profile = helpers.load_profile("sinumerik-mill")
        (variant,) = profile["machineParams"]["variants"]
        compiled = gedit_nc.compile_profile(profile)
        self.assertIsNotNone(compiled)
        import re

        lone = re.compile(variant["choices"][1]["detect"][0]["pattern"], re.IGNORECASE)
        for line, hit in (("N10 T5", True), ("T2 D1", True), ('N10 T="MILL10"', True), ("N10 T0", False), ("N10 T5 M6", False)):
            with self.subTest(line=line):
                self.assertEqual(lone.search(line) is not None, hit)

    def test_the_tool_list_of_a_three_digit_offset_lathe(self):
        context = helpers.effective_context(LATHE, variant=("toolWord", "offset3"))
        full = helpers.make_context(profile=context["profile"], codes=context["codes"])
        full["machine"] = context["machine"]
        program = "O1\nT1001 (OD ROUGH)\nG1 Z-20. F0.2\nT1000\nT3003 (OD FINISH)\nG1 Z-30. F0.15\nM30\n"
        result = helpers.run_script("tool_list.py", stdin=program, context=full)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual([row["tool"] for row in result.json()["rows"]], ["T1", "T3"])

    def test_the_tool_list_of_a_three_digit_offset_okuma(self):
        context = helpers.effective_context(OKUMA, variant=("toolWord", "offset3"))
        full = helpers.make_context(profile=context["profile"], codes=context["codes"])
        full["machine"] = context["machine"]
        program = "O0103\nG00 T2000\nG01 Z-20. F0.2\nG00 T1001\nG01 Z-30. F0.15\nM02\n"
        result = helpers.run_script("tool_list.py", stdin=program, context=full)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual([row["tool"] for row in result.json()["rows"]], ["T2", "T1"])


if __name__ == "__main__":
    unittest.main()
