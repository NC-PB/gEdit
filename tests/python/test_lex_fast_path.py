"""The whole-line fast path in ``tokenize_line`` (B1 B2). Guards ``_FastLine`` in ``_nc_lex.py``.

A script tokenizes every line of the program, and the character loop of ``tokenize_line``
was about half of the time of the scripts on a 300,000-line program. The fast path reads the
commonest block (plain words with plain numbers, now and then a comment) with two regular
expressions after it has shown that none of the loop's other rules can apply. It is a late
performance shortcut, so two kinds of test hold it:

* **call counts** (the style of ``test_mask_fast_path.py``): a wall-clock budget would flake
  under load and would not say *why* it slowed down. What regresses is the shortcut silently
  stopping short, so these count the calls to the loop's own expensive helpers: a plain
  line must never reach them, and a line that has something in it for the loop still must;
* **a differential fuzz**: the same lines are read with the shortcut and with the loop
  (``_nc_lex._FAST_PATH = False``) on every built-in profile and on variants of them, and
  every token and the line state must be equal. ``lex_fuzz.py`` makes the material: random
  plain blocks with one oddity in them, every line of the NC fixtures and the token goldens,
  and mutations of those. The suite runs a few thousand lines per profile; the proof run of
  B1 B2 was a million per profile (see the hand-off).
"""

from __future__ import annotations

import sys
import unittest

from tests.python import helpers, lex_fuzz

gedit_nc = helpers.import_gedit_nc()
nc_lex = sys.modules["_nc_lex"]

#: The helpers of the character loop that a plain line must not reach.
LOOP_HELPERS = ["_read_value", "_match_keyword", "_comment_at", "_chunk_end_at", "_describe_word", "_number_end_at"]


class _Counting(unittest.TestCase):
    def _counted(self, name):
        """Replaces ``_nc_lex.<name>`` with a call-counting wrapper for this test only."""
        original = getattr(nc_lex, name)
        calls = []

        def wrapper(*args, **kwargs):
            calls.append(1)
            return original(*args, **kwargs)

        setattr(nc_lex, name, wrapper)
        self.addCleanup(lambda: setattr(nc_lex, name, original))
        return calls

    def _loop_calls(self):
        return {name: self._counted(name) for name in LOOP_HELPERS}

    def _profile(self, profile_id):
        return gedit_nc.compile_profile(helpers.load_profile(profile_id))

    def assertNoLoop(self, calls, line):
        reached = {name: len(seen) for name, seen in calls.items() if seen}
        self.assertEqual(reached, {}, "the character loop ran for %r" % line)


class TestFastPathTakesThePlainBlock(_Counting):
    def test_a_plain_fanuc_block_never_reaches_the_character_loop(self):
        cp = self._profile("fanuc-gcode")
        calls = self._loop_calls()
        for line in ["N10 G1 X10.5 Y-3. F500", "G0 X-1.5 Z.5", "G91 G28 Z0", "  M3 S3000  ", "X1Y2Z3", "N5"]:
            tokens, _ = gedit_nc.tokenize_line(line, cp)
            self.assertTrue(tokens, line)
        self.assertNoLoop(calls, "a plain Fanuc block")

    def test_a_block_with_a_comment_does_not_either(self):
        cp = self._profile("fanuc-gcode")
        calls = self._loop_calls()
        for line in ["G1 X1. (FEED IN)", "(TOOL 1  D10 END MILL)", "G0 X1. (A) Z2. (B)"]:
            gedit_nc.tokenize_line(line, cp)
        self.assertNoLoop(calls, "a block with a comment")

    def test_packed_dialects_with_other_comment_markers(self):
        for profile_id, lines in [
            ("sinumerik", ["N10 G1 X10.5 Y-3. F500 ; COMMENT", "G0 X1 Z2", "; ONLY A COMMENT"]),
            ("okuma-osp", ["N10 G1 X10.5 Z-3. F0.2", "N20 G0 X5 (NOTE)"]),
        ]:
            cp = self._profile(profile_id)
            calls = self._loop_calls()
            for line in lines:
                gedit_nc.tokenize_line(line, cp)
            self.assertNoLoop(calls, profile_id)

    def test_klartext_chunks_and_keywords(self):
        cp = self._profile("heidenhain-klartext")
        calls = self._loop_calls()
        for line in ["12 L X+10 Y-20.5 R0 FMAX M3", "7 L Z+100 R0 F1000", "8 C X+0,5 DR-", "9 L ; A COMMENT"]:
            gedit_nc.tokenize_line(line, cp)
        # `DR-` is a chunk of the shape of no plain word, so that block (and only it) is the loop's.
        calls_before = {name: len(seen) for name, seen in calls.items()}
        self.assertEqual(sum(calls_before.values()) > 0, True)
        for seen in calls.values():
            del seen[:]
        for line in ["12 L X+10 Y-20.5 R0 FMAX M3", "7 L Z+100 R0 F1000", "9 L ; A COMMENT", "10 CC X+0 Y+0"]:
            gedit_nc.tokenize_line(line, cp)
        self.assertNoLoop(calls, "Klartext blocks")

    def test_the_proof_that_the_shortcut_was_taken_is_the_taken_count(self):
        # `compare_lines` counts the reads the shortcut really took, so a fuzz run that never
        # reaches it cannot pass for a proof.
        cp = self._profile("fanuc-gcode")
        # The first line is read twice (behind a continuing line as well), the others once.
        tally = lex_fuzz.compare_lines(nc_lex, cp, ["G1 X1.", "G1 X1. (C)", "#1=5"])
        self.assertEqual(tally.lines, 4)
        self.assertEqual(tally.fast, 3)
        self.assertEqual(tally.mismatches, [])


class TestFastPathHandsBackWhatTheLoopOwns(_Counting):
    def _reaches_loop(self, profile_id, line):
        cp = self._profile(profile_id)
        calls = self._loop_calls()
        gedit_nc.tokenize_line(line, cp)
        return any(calls.values())

    def test_fanuc_lines_with_something_in_them(self):
        for line in [
            "#1=5",  # a variable
            "G1 X#1",  # a variable as a value
            "G1 X[#1+1]",  # an expression
            "IF [#1 EQ 1] GOTO 60",  # keywords
            "GOTO 70",
            "M98 P<SHAFT>",  # a program name
            "G1 X1. \"S\"",  # a string
            "O1234 (MAIN)",  # a program number at the head of the block
            "X",  # an address without a value
            "G1 X1.2.3",  # not a number
            "G1 X1. Y",
            "N10 G1 X1.\xa0Y2.",  # a no-break space
            "G1 X1.:",
        ]:
            self.assertTrue(self._reaches_loop("fanuc-gcode", line), line)

    def test_klartext_lines_with_something_in_them(self):
        for line in [
            "5 TOOL CALL 1 Z S3000",  # a keyword of several parts
            "5 CYCL DEF 200 DRILLING",
            "6 L X+Q5",  # a Q parameter
            "7 L X+10 DR-",
            "8 FQ50",
            "9 L X+10 Y+20 FMAX ~",  # a continuation
        ]:
            self.assertTrue(self._reaches_loop("heidenhain-klartext", line), line)

    def test_sinumerik_lines_with_something_in_them(self):
        for line in [
            "N10 R1=5",
            "N10 CYCLE83(1,2)",
            "N10 G1 X=R1",
            "N10 G1 X1.5EX3",
            "N10 G1 X10 DIAMON",  # a name
            "$AA_IM[X]=1",
        ]:
            self.assertTrue(self._reaches_loop("sinumerik", line), line)


#: Lines each trap of the shortcut has been written for; they are read with the loop and
#: without it on every profile and variant, whatever they mean there.
TRAP_LINES = [
    "X1.5E3", "X1.5EX3", "X1E3 Y2", "G1X1E-3", "G1 X1.5ex2",
    "L", "L;", "L ;", "L(c)", "C+45", "L+10", "CC X+0", "FMAX", "FMAX;c", "RL", "R", "F",
    "G28", "G91 G28 Z0", "M30", "M30 (END)", "G1 X5 M30",
    "X10.\xa0Y5", "X10.\x0bY5", "X10. ;c\xa0", "X10. ; c  \t", ";", ";  ", "(", "(  ", ")", "()", "(A)(B)", "(A) (B) X1",
    "N1A2 X1", "X1 N1A", "N1A", "N1 A2", "Z 12", "Z12 X1", "G1 X10", "G1 X10 Y5", "N5 G1 X10 (A)", "X1 Z12", "T12", "A1:5 X1", "A1:5", "X1 A1:", ":5", "X1 :5",
    "X1 (A", "X1 (A) )", "X1(A)Y2", "X1;A(B)", "X1 ; (A)",
    "O1234", "O1234 (A)", "o12", ":123", ":123 G1", "%", "% G1", "$PART%", "N10", "N10 N20", "N 10 X1", "n10 g1 x1",
    "N10 X1 N20", "NLAP1", "N10 NLAP1", "X1 NLAP1", "NOEX", "X1 NA", "G85 NLAP1 D3",
    "V10", "V1 X1", "X1 V1", "R10", "X1 R5", "#5", "X#5", "Q5", "X1 Q5", "QL1", "VZOFZ", "$AA_IM",
    "XNOW", "AB", "X1 AB", "DIAMON", "G1 DIAMON", "X1 ABC Y2",
    "GOTO 10", "GOTOF LOOP_A", "IF X1", "G1 IF", "DEF INT A", "CALL OABC", "CALL", "TOOL CALL 1", "TOOL", "CYCL DEF 200",
    "X=5", "X1 =5", "SB=1200", "X1[2]", "X[1]", "X1 (1)", "CYCLE81(1)", "X1 CYCLE81(1)", "X (1)",
    "VC:120", "X1 VC:1", "HSC-MODE:1", "A:", "A: X1",
    "X1,5", "X,5", "X1,5,6", "X.", "X-.", "X+", "X-", "X--1", "X+-1", "X1-2", "X1+2", "X1.-2", "1", "-1", "1 2", "1.5 X2", ".5",
    "X 1", "X  \t1", "X 1 Y 2", "X Y1", "XY1", "X1Y", "X1 Y", "1X", "1.5X", "1,5X",
    "é", "X1é", "éX1", "X1　Y2", "\x00", "X1\x00",
    "G1 X1 ~", "G1 X1~", "~", "X1 \\", "X1 *", "* - HEAD", "12 * - ROUGH", "/X1", "/ X1", "/1 X1", "X1 /", "X1 / Y2",
    "G1 X1 ;(", "X1 ;) Y2", "X1 (;) Y2", "X1 \"a\"", "\"a\" X1", "X1 \"a",
]


class TestFastPathAgainstTheLoop(unittest.TestCase):
    #: A read the shortcut takes in this fraction of the lines at least, or the run proves nothing.
    MINIMUM_FAST = 0.1

    @classmethod
    def setUpClass(cls):
        cls.variants = lex_fuzz.profile_variants()
        cls.goldens = lex_fuzz.golden_lines()

    def _check(self, name, profile, lines, minimum=0.0):
        cp = gedit_nc.compile_profile(profile)
        tally = lex_fuzz.compare_lines(nc_lex, cp, lines)
        details = "\n".join(
            "%r (continues=%s)\n  loop: %s\n  fast: %s" % (line, state, expected, actual)
            for line, state, expected, actual in tally.mismatches[:3]
        )
        self.assertEqual(len(tally.mismatches), 0, "%s: %d of %d reads differ\n%s" % (name, len(tally.mismatches), tally.lines, details))
        if minimum:
            self.assertGreaterEqual(
                tally.fast, int(tally.lines * minimum), "%s: the shortcut took only %d of %d reads" % (name, tally.fast, tally.lines)
            )
        return tally

    def test_the_trap_lines_on_every_profile_and_variant(self):
        for name, profile in self.variants:
            self._check(name, profile, TRAP_LINES)

    def test_random_lines_on_every_profile_and_variant(self):
        for name, profile in self.variants:
            lines = list(lex_fuzz.random_lines(20261010, 700))
            self._check(name, profile, lines, minimum=0.0)

    def test_every_fixture_and_golden_line_on_the_built_in_profiles(self):
        for name, profile in self.variants[: len(lex_fuzz.BUILTIN_IDS)]:
            self._check(name, profile, self.goldens, minimum=0.2)

    def test_mutated_fixture_lines_on_the_built_in_profiles(self):
        for name, profile in self.variants[: len(lex_fuzz.BUILTIN_IDS)]:
            lines = list(lex_fuzz.mutated_lines(20261011, self.goldens, 1500))
            self._check(name, profile, lines, minimum=0.1)

    def test_the_random_run_reaches_the_shortcut_on_the_built_in_profiles(self):
        for name, profile in self.variants[: len(lex_fuzz.BUILTIN_IDS)]:
            lines = list(lex_fuzz.random_lines(7, 500))
            self._check(name, profile, lines, minimum=self.MINIMUM_FAST)


class TestFastPathProfiles(unittest.TestCase):
    """Which profiles have a shortcut at all: one with a rule it cannot prove it leaves alone has none."""

    def _fast(self, profile):
        return nc_lex._lex_spec(gedit_nc.compile_profile(profile)).fast

    def test_the_built_in_profiles_have_one(self):
        for profile_id in lex_fuzz.BUILTIN_IDS:
            self.assertIsNotNone(self._fast(helpers.load_profile(profile_id)), profile_id)

    def test_a_profile_with_a_comment_that_starts_like_a_word_has_none(self):
        variants = dict(lex_fuzz.profile_variants())
        self.assertIsNone(self._fast(variants["fanuc + comment letter"]))

    def test_a_profile_with_another_decimal_point_has_none(self):
        variants = dict(lex_fuzz.profile_variants())
        self.assertIsNone(self._fast(variants["fanuc + decimal separator comma"]))

    def test_the_switch_turns_it_off(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("fanuc-gcode"))
        saved = nc_lex._FAST_PATH
        self.addCleanup(lambda: setattr(nc_lex, "_FAST_PATH", saved))
        nc_lex._FAST_PATH = False
        calls = []
        original = nc_lex._tokenize_fast
        nc_lex._tokenize_fast = lambda *a: calls.append(1) or original(*a)
        self.addCleanup(lambda: setattr(nc_lex, "_tokenize_fast", original))
        gedit_nc.tokenize_line("G1 X1.", cp)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
