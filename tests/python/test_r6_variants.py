"""The two R6 machine choices, the Python half (plan M9 WP9.4, section 8.8 "The M9 variants").

``fanuc-lathe`` ``incrementalAddresses`` (``uw`` default, ``uwvh``, ``none``) and
``fanuc-lathe`` / ``okuma-osp`` ``toolWord`` (``offset2`` default, ``offset1``, ``offset3``)
are overlays on the effective profile. Python never merges a machine itself; it reads the
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
        for profile_id in (LATHE, OKUMA):
            with self.subTest(profile=profile_id):
                resolved = helpers.load_profile(profile_id)["toolCall"]
                effective = helpers.effective_context(profile_id)["profile"]["toolCall"]
                self.assertEqual(effective, resolved)
                self.assertEqual(profile_of(profile_id, toolWord="offset2")["toolCall"], resolved)

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
