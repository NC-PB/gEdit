"""`gedit_nc` (plan §7.10, WP4.6), against the goldens the TypeScript core is held to.

The point of this file is **parity**. ``tests/fixtures/tokens/<profileId>.json`` and
``tests/fixtures/numberformat.cases.json`` are read by `src/lib/core/nc/tokenizer.test.ts`
and `numberFormat.test.ts` as well, so a difference between the two implementations shows
up here or there rather than in a customer's program. When one of them has to change, the
fixture changes with it and both sides are re-run — never one side alone.

Everything else below is about a rule that is easier to read as a sentence than as a
fixture line: the profile patterns compiling in Python at all, the feed-mode interpreter,
the two ways a selection run is primed from the lines above it, and the two output shapes.

M8 (WP8.6) holds the Python side to the turning dialects as well: the opt-in ``syntax``
fields of plan AD-24 and §7.16 (``header``, ``sequenceNames``, ``labels``,
``systemVariables``, ``assignment``, ``calls``, ``names``) and the ``/0`` skip level. The
goldens of ``okuma-osp`` and ``sinumerik`` carry them, and ``TestTurningGoldensReachEveryField``
proves that each field a profile declares changes at least one golden line, so the
parity test above cannot pass by accident. The sentences below cover what a golden entry
does not spell out: the parsed ``value`` of an assignment, ``block_number_of`` and the
comment mask. Every NC line in this file was written for gEdit from the lexical rules of
``docs/planning/syntax/syntax-okuma.md`` §3 and ``syntax-sinumerik.md`` §3.
"""

from __future__ import annotations

import copy
import dataclasses
import json
import os
import re
import subprocess
import sys
import textwrap
import time
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


def _parse_original(text):
    """``original`` the way a comma-decimal case (§7.16 / R4) writes it in the fixture.

    ``.`` still parses with the untouched, contract-pinned ``parse_number``; a comma is
    read the way ``_nc_lex.py``'s ``_parse_value`` reads one — retried with it as the
    point, ``raw`` kept as the text this fixture wrote. Mirrors ``parseOriginal`` in
    ``numberFormat.test.ts``.
    """
    direct = gedit_nc.parse_number(text)
    if direct is not None or "," not in text:
        return direct
    alt = gedit_nc.parse_number(text.replace(",", "."))
    return None if alt is None else dataclasses.replace(alt, raw=text)

#: The opt-in `syntax` fields of the turning dialects (plan AD-24, and `names` from §7.16),
#: each with the key `compile_profile` files its pattern under; `None` for the two that are
#: switches rather than patterns.
TURNING_FIELDS = {
    "header": "header",
    "sequenceNames": None,
    "labels": "labels",
    "systemVariables": "system_variables",
    "assignment": "assignment",
    "calls": None,
    "names": "names",
}

#: Every field of a profile that holds a `Pattern` (`src/lib/core/profiles/types.ts`), as a
#: path: a name walks into an object, a trailing `[]` over the items of a list.
PATTERN_PATHS = [
    "detect.content[].pattern",
    "syntax.sectionHeading",
    "syntax.continuation",
    "syntax.continuationStart",
    "syntax.variables",
    "syntax.assignment",
    "syntax.labels",
    "syntax.systemVariables",
    "syntax.header",
    "syntax.names",
    "syntax.programNames",
    "toolCall.trigger",
    "toolCall.tool",
    "toolCall.ignore",
    "program.start[]",
    "program.end[]",
    "outline[].pattern",
    "numbering.references[].trigger",
    "toolList.commentFilter",
    "machineParams.variants[].choices[].detect[].pattern",
    "machineParams.variants[].choices[].overlay.toolCall.trigger",
    "machineParams.variants[].choices[].overlay.toolCall.tool",
    "machineParams.variants[].choices[].overlay.toolCall.ignore",
    "machineParams.variants[].choices[].overlay.numbering.references[].trigger",
]

gedit_nc = helpers.import_gedit_nc()


def code_tokens(tokens):
    """The tokens a golden entry describes: everything but whitespace."""
    return [token for token in tokens if token.kind != "whitespace"]


def golden_lines(profile_id):
    """The lines of one token golden, in order."""
    return [entry["line"] for entry in helpers.load_json(helpers.FIXTURES_DIR / "tokens" / (profile_id + ".json"))]


def every_golden_line():
    """The lines of every token golden, so a rule can be checked under a profile it was not written for."""
    lines = []
    for profile_id in helpers.profile_ids():
        lines.extend(golden_lines(profile_id))
    return lines


def shape(tokens):
    """Everything a line's tokens say, whitespace included, as plain tuples."""
    return [
        (
            token.kind,
            token.start,
            token.end,
            token.text,
            token.address,
            token.value_text,
            None if token.value is None else token.value.raw,
            token.incremental,
        )
        for token in tokens
    ]


def values_at(node, path):
    """Every value ``path`` reaches in ``node`` (see :data:`PATTERN_PATHS`)."""
    nodes = [node]
    for step in path.split("."):
        over_list = step.endswith("[]")
        name = step[:-2] if over_list else step
        reached = []
        for current in nodes:
            if not isinstance(current, dict) or name not in current:
                continue
            value = current[name]
            if over_list:
                reached.extend(value if isinstance(value, list) else [])
            else:
                reached.append(value)
        nodes = reached
    return nodes


def effective_profiles():
    """``(name, profile)`` of every effective profile ``tests/unit/resolved.test.ts`` wrote."""
    out = []
    for path in sorted((helpers.RESOLVED_DIR / "effective").glob("*/*.json")):
        entry = helpers.load_json(path)
        if isinstance(entry, dict) and isinstance(entry.get("profile"), dict):
            out.append(("%s/%s" % (path.parent.name, path.stem), entry["profile"]))
    return out


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


class TestTurningGoldensReachEveryField(unittest.TestCase):
    """The parity test above proves something about a field only if the goldens use it.

    Each opt-in field a profile declares is switched off in a copy of the profile, and at
    least one line of that profile's golden has to come out differently. Without this, a
    field could be mirrored wrongly in Python — or not at all — while every golden line
    still agreed, because no line happened to depend on it.
    """

    def test_every_field_a_profile_declares_changes_at_least_one_of_its_golden_lines(self):
        for profile_id in helpers.profile_ids():
            profile = helpers.load_profile(profile_id)
            lines = golden_lines(profile_id)
            cp = gedit_nc.compile_profile(profile)
            full = [shape(gedit_nc.tokenize_line(line, cp)[0]) for line in lines]
            for field in TURNING_FIELDS:
                if field not in profile["syntax"]:
                    continue
                with self.subTest(profile=profile_id, field=field):
                    reduced = copy.deepcopy(profile)
                    del reduced["syntax"][field]
                    without = gedit_nc.compile_profile(reduced)
                    changed = [
                        line
                        for line, tokens in zip(lines, full)
                        if shape(gedit_nc.tokenize_line(line, without)[0]) != tokens
                    ]
                    self.assertTrue(changed, "no golden line of %s depends on syntax.%s" % (profile_id, field))

    def test_the_dialects_older_than_m8_declare_none_of_the_fields(self):
        # Their goldens are the regression gate for the fields only while that holds: a
        # profile that names none of them has to tokenize exactly as it did before M8.
        for profile_id in ["fanuc-gcode", "fanuc-lathe", "heidenhain-klartext"]:
            with self.subTest(profile=profile_id):
                syntax = helpers.load_profile(profile_id)["syntax"]
                self.assertEqual([field for field in TURNING_FIELDS if field in syntax], [])


class TestTurningTokens(unittest.TestCase):
    """AD-24 in sentences: what a golden entry does not spell out.

    A golden entry pins ``kind``, ``text``, ``address`` and ``value_text``, but not the
    parsed ``value``, and the value is what every script computes with.
    """

    @classmethod
    def setUpClass(cls):
        cls.okuma = gedit_nc.compile_profile(helpers.load_profile("okuma-osp"))
        cls.sinumerik = gedit_nc.compile_profile(helpers.load_profile("sinumerik"))

    def tokens(self, line, cp):
        return code_tokens(gedit_nc.tokenize_line(line, cp)[0])

    def test_an_assignment_carries_a_value_only_when_its_right_hand_side_is_one_number(self):
        speed = self.tokens("SB=1200 M13", self.okuma)[0]
        self.assertEqual((speed.address, speed.value_text), ("SB", "1200"))
        self.assertEqual((speed.value.raw, speed.value.has_point), ("1200", False))
        depth = self.tokens("DA=1.5", self.okuma)[0].value
        self.assertEqual((depth.int_part, depth.frac_part), ("1", "5"))
        limit = self.tokens("LIMS=3000", self.sinumerik)[0]
        self.assertEqual((limit.address, limit.value.raw), ("LIMS", "3000"))

    def test_nothing_may_compute_with_a_right_hand_side_that_is_not_a_number(self):
        for line, cp, address in [
            ("F=V10", self.okuma, "F"),
            ("X=V1+V2", self.okuma, "X"),
            ("X=SIN[30]", self.okuma, "X"),
            ("F=R10", self.sinumerik, "F"),
            ("F=R10*2", self.sinumerik, "F"),
            ('T="DRILL_D8"', self.sinumerik, "T"),
            ("X=AC(10)", self.sinumerik, "X"),
        ]:
            with self.subTest(line=line):
                token = self.tokens(line, cp)[0]
                self.assertEqual((token.kind, token.address), ("word", address))
                self.assertIsNotNone(token.value_text)
                self.assertIsNone(token.value)

    def test_a_spindle_extension_is_part_of_the_address_and_never_the_main_spindle(self):
        # `S3=2500` is spindle 3 and `M3=3` the M3 of spindle 3: neither is an S word of the
        # main spindle nor a code M33.
        third = self.tokens("G26 S3=2500", self.sinumerik)[1]
        self.assertEqual((third.address, third.value.raw), ("S3", "2500"))
        m_code = self.tokens("M3=3", self.sinumerik)[0]
        self.assertEqual((m_code.address, m_code.value.raw), ("M3", "3"))
        self.assertEqual(self.tokens("S3000", self.sinumerik)[0].address, "S")
        self.assertEqual(self.tokens("S1200", self.okuma)[0].address, "S")

    def test_an_address_whose_value_is_still_missing_has_none(self):
        for line in ["X=", "X= (SET LATER)"]:
            with self.subTest(line=line):
                token = self.tokens(line, self.okuma)[0]
                self.assertEqual((token.text, token.address, token.value_text, token.value), ("X=", "X", None, None))

    def test_a_call_behind_the_equals_sign_is_taken_whole_with_its_spaces(self):
        token = self.tokens("X=AC(10, 5) Z=IC(-2)", self.sinumerik)[0]
        self.assertEqual((token.text, token.address, token.value_text), ("X=AC(10, 5)", "X", "AC(10, 5)"))

    def test_a_comparison_is_no_assignment(self):
        self.assertEqual(
            [(token.kind, token.text) for token in self.tokens("IF R1==1 GOTOF N10", self.sinumerik)][1:4],
            [("variable", "R1"), ("operator", "="), ("operator", "=")],
        )

    def test_a_double_equals_sign_is_a_comparison_even_where_the_pattern_does_not_say_so(self):
        # The built-in patterns look ahead for `=` that no second `=` follows; a user
        # profile may not, and the tokenizer checks the character itself as well.
        profile = helpers.load_profile("sinumerik")
        profile["syntax"]["assignment"] = "[A-Z_][A-Z0-9_]*"
        cp = gedit_nc.compile_profile(profile)
        self.assertEqual(
            [(token.kind, token.text) for token in self.tokens("XA==1", cp)],
            [("unknown", "XA"), ("operator", "="), ("operator", "="), ("word", "1")],
        )

    def test_a_name_may_stand_apart_from_its_bracket_and_is_still_the_call(self):
        # G8 M8 review: the control reads `CYCLE840 (…)` as it reads `CYCLE840(…)`, and a
        # tapping cycle read as a name and loose values was one no script saw: its feed was
        # scaled without a word.
        call = self.tokens("N60 CYCLE840 (5,0,2,-15,,0.5,3,3,1,,1.5)", self.sinumerik)[1]
        self.assertEqual(
            (call.kind, call.address, call.value_text, call.value),
            ("call", "CYCLE840", "5,0,2,-15,,0.5,3,3,1,,1.5", None),
        )
        self.assertEqual([token.kind for token in self.tokens('MSG\t("A;B") ;NOTE', self.sinumerik)], ["call", "comment"])
        value = self.tokens("X=AC (10)", self.sinumerik)[0]
        self.assertEqual((value.address, value.value_text, value.value), ("X", "AC (10)", None))
        self.assertEqual(self.tokens("IF (R1==1)", self.sinumerik)[0].kind, "keyword")

    def test_a_letter_and_a_number_need_their_bracket_touching_them_to_be_a_call(self):
        # `M30 (END)` in a program written for a control with `( … )` comments stays an M30.
        self.assertEqual(
            [(token.kind, token.text) for token in self.tokens("N90 M30 (END)", self.sinumerik)],
            [("blockNumber", "N90"), ("word", "M30"), ("operator", "("), ("unknown", "END"), ("operator", ")")],
        )
        self.assertEqual(self.tokens("L10(1)", self.sinumerik)[0].kind, "call")
        self.assertEqual(self.tokens("L10 (1)", self.sinumerik)[0].kind, "word")

    def test_a_no_break_space_in_front_of_the_equals_sign_is_whitespace(self):
        # G8 M8 review: the pattern's `\s` used to be ASCII only on this side, so the editor
        # read another spindle's `S3=` where a script read the main spindle's `S3`, scaled
        # it and wrote `S2`: a different spindle number.
        third = self.tokens("N20 S3\u00a0=2500 M3=3", self.sinumerik)[1]
        self.assertEqual((third.kind, third.address, third.value.raw), ("word", "S3", "2500"))
        self.assertEqual(self.tokens("SB\u00a0=1200 M13", self.okuma)[0].address, "SB")

    def test_the_address_of_an_assignment_is_the_whole_identifier(self):
        self.assertEqual(self.tokens("XNOW=62", self.sinumerik)[0].address, "XNOW")
        self.assertEqual(self.tokens("G1 X1=5", self.sinumerik)[1].address, "X1")
        # Okuma's pattern takes at most four characters, so a longer name takes no `=`.
        self.assertEqual(
            [(token.kind, token.text) for token in self.tokens("DIAMETER=5", self.okuma)],
            [("unknown", "DIAMETER"), ("operator", "="), ("word", "5")],
        )

    def test_a_sequence_name_has_at_most_four_characters(self):
        self.assertEqual(self.tokens("NLAP G85", self.okuma)[0].kind, "label")
        self.assertEqual(
            [(token.kind, token.text) for token in self.tokens("NLAPS1 G85", self.okuma)],
            [("unknown", "NLAPS1"), ("word", "G85")],
        )

    def test_a_name_never_reaches_into_the_continuation_marker(self):
        # No built-in profile has both, so the rule is shown on a copy that does: the
        # continuation marker is the line's tail and belongs to no other token.
        profile = helpers.load_profile("sinumerik")
        profile["syntax"]["continuation"] = "_\\s*$"
        cp = gedit_nc.compile_profile(profile)
        tokens, state = gedit_nc.tokenize_line("GOTOF XNOW_", cp)
        self.assertEqual(
            [(token.kind, token.text) for token in code_tokens(tokens)],
            [("keyword", "GOTOF"), ("unknown", "XNOW"), ("continuation", "_")],
        )
        self.assertTrue(state.continuation)

    def test_a_call_keeps_its_arguments_whole_and_has_no_value(self):
        call = self.tokens("CYCLE83(50,0,2,-25,,-5)", self.sinumerik)[0]
        self.assertEqual(
            (call.kind, call.address, call.value_text, call.value),
            ("call", "CYCLE83", "50,0,2,-25,,-5", None),
        )
        empty = self.tokens("SETMS()", self.sinumerik)[0]
        self.assertEqual((empty.kind, empty.address, empty.value_text), ("call", "SETMS", None))

    def test_an_unclosed_argument_list_ends_where_a_comment_begins(self):
        self.assertEqual(
            [(token.kind, token.text) for token in self.tokens("MSG(A;B", self.sinumerik)],
            [("call", "MSG(A"), ("comment", ";B")],
        )

    def test_a_declared_keyword_in_front_of_a_bracket_stays_a_keyword(self):
        self.assertEqual(self.tokens("IF(R1==1)", self.sinumerik)[0].kind, "keyword")

    def test_a_call_gives_a_value_back_so_a_sign_behind_it_subtracts(self):
        self.assertEqual(
            [(token.kind, token.text) for token in self.tokens("R1=PROBE(1)-2", self.sinumerik)],
            [("variable", "R1"), ("operator", "="), ("call", "PROBE(1)"), ("operator", "-"), ("word", "2")],
        )

    def test_a_name_carries_no_address_and_no_value(self):
        for line, cp, name in [("GOTOF PASS2", self.sinumerik, "PASS2"), ("V1=DIA1*2", self.okuma, "DIA1")]:
            with self.subTest(line=line):
                token = [token for token in self.tokens(line, cp) if token.text == name][0]
                self.assertEqual(
                    (token.kind, token.address, token.value_text, token.value),
                    ("unknown", None, None, None),
                )

    def test_a_sequence_name_behind_a_jump_is_one_label_so_its_letters_are_no_words(self):
        # Letter by letter `NFED1` would hand a feed script an F word of 1.
        tokens = self.tokens("GOTO NFED1", self.okuma)
        self.assertEqual([(token.kind, token.address) for token in tokens], [("keyword", "GOTO"), ("label", "FED1")])
        self.assertNotIn("label", [token.kind for token in self.tokens("X10NLAP1 G85", self.okuma)])

    def test_a_label_reports_its_name_in_upper_case(self):
        self.assertEqual(self.tokens("nlap1 g85", self.okuma)[0].address, "LAP1")
        self.assertEqual(self.tokens("loop_a: g1 x10", self.sinumerik)[0].address, "LOOP_A")

    def test_a_profile_that_declares_none_of_the_fields_never_gives_a_label_or_a_call(self):
        lines = ["N10 G0 X10.", "NLAP1 G85", "LOOP_A: G1 X10", "CYCLE83(10,0)", "SB=1200", "$FLANGE.MIN%", "%_N_A_MPF"]
        for profile_id in ["fanuc-gcode", "fanuc-lathe", "heidenhain-klartext"]:
            cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
            for line in lines:
                with self.subTest(profile=profile_id, line=line):
                    kinds = [token.kind for token in self.tokens(line, cp)]
                    self.assertNotIn("label", kinds)
                    self.assertNotIn("call", kinds)


#: Runs in a child process: the lines of a profile whose variable patterns can match
#: nothing, each checked to be read to its end. A child, because the failure this guards
#: against is a scanner that never advances, and in this process that is a hang.
_EMPTY_MATCH_CHILD = textwrap.dedent(
    """
    import json
    import sys

    import gedit_nc

    profile = json.loads(sys.stdin.read())
    profile["syntax"]["systemVariables"] = "\\\\$?[A-Z_]*"
    profile["syntax"]["variables"] = "R?\\\\d*"
    cp = gedit_nc.compile_profile(profile)
    for line in ["N10 G1 X10 F0.2", "$AA_IM[X]", "R1=R2*2", "G0 ;TEXT", "(", ""]:
        tokens, _ = gedit_nc.tokenize_line(line, cp)
        at = 0
        for token in tokens:
            assert token.start == at and token.end > token.start, (line, token)
            at = token.end
        assert at == len(line), line
    print("read to the end")
    """
)


class TestAPatternThatCanMatchNothing(unittest.TestCase):
    """An empty match of ``variables`` or ``systemVariables`` is no match (G8 M8).

    It used to push a token of no characters and leave the scanner where it was, so the
    first line a script read hung it. ``validate.ts`` refuses such a pattern now (from M12
    a user profile may carry one), and the tokenizer does not rely on that.
    """

    def test_the_scanner_moves_on(self):
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(helpers.SCRIPTS_DIR), env.get("PYTHONPATH", "")]))
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        completed = subprocess.run(
            [sys.executable, "-c", _EMPTY_MATCH_CHILD],
            input=json.dumps(helpers.load_profile("sinumerik")).encode("utf-8"),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr.decode("utf-8"))
        self.assertEqual(completed.stdout.decode("utf-8").strip(), "read to the end")


class TestLongLines(unittest.TestCase):
    """A long run of packed words costs time in proportion to its length (G8 M8).

    `p` stops at every letter of `G1X1G1X1…`, and the call and assignment rules each read
    to the end of the run from there: a script needed nine seconds for one Sinumerik line
    of 16k such characters. One scan per run is enough, because every letter of a run has
    the same end. The budget is two orders of magnitude above what the scan costs.
    """

    SHAPES = {
        "G1X1": lambda n: "G1X1" * (n // 4),
        "R1": lambda n: "R1" * (n // 2),
        "A1": lambda n: "A1" * (n // 2),
        "A_1": lambda n: "A_1" * (n // 3),
        "G1X1 and a bracket behind blanks": lambda n: "G1X1" * (n // 4 - 2) + "   (1)",
        "G1X1 and an = behind blanks": lambda n: "G1X1" * (n // 4 - 2) + "   =1",
        "V1": lambda n: "V1" * (n // 2),
    }

    def test_a_long_run_of_packed_words_stays_linear(self):
        for profile_id in ("sinumerik", "okuma-osp"):
            cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
            for name, make in self.SHAPES.items():
                with self.subTest(profile=profile_id, shape=name):
                    times = []
                    for length in (2000, 4000, 8000, 16000):
                        line = make(length)
                        started = time.perf_counter()
                        tokens, _ = gedit_nc.tokenize_line(line, cp)
                        times.append((time.perf_counter() - started) * 1000)
                        self.assertEqual(tokens[-1].end, len(line))
                    self.assertLess(max(times), 1500, " / ".join("%.0f ms" % ms for ms in times))


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
                original = None if case["original"] is None else _parse_original(case["original"])
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

    def test_a_klartext_comma_feed_is_scaled_and_written_back_with_its_comma(self):
        # §7.16 / R4: `scale_feed.py`/`scale_speed.py` pass a token's own `value.raw`
        # straight to `scale_decimal`, with no profile to read `decimalSeparatorAlt` from
        # (`scale_decimal`'s signature is pinned, plan §7.10) — so this goes through the
        # real tokenizer first, exactly as the bundled scripts do, not a hand-built literal.
        cp = gedit_nc.compile_profile(helpers.load_profile("heidenhain-klartext"))
        tokens, _ = gedit_nc.tokenize_line("12 L F1000,5", cp)
        feed = next(t for t in tokens if t.address == "F")
        self.assertEqual(feed.value.raw, "1000,5")

        scaled = gedit_nc.scale_decimal(feed.value.raw, "90")
        self.assertEqual(scaled, "900.45")
        # `original` (`F1000,5`) was written with one decimal, so `'keep'` rounds to one.
        self.assertEqual(gedit_nc.format_number(scaled, feed.value, KEEP), "900,5")

        # `X+25,` (5-Axis-1.H): a comma with nothing after it scales too.
        tokens, _ = gedit_nc.tokenize_line("13 L X+25,", cp)
        axis = next(t for t in tokens if t.address == "X")
        self.assertEqual(gedit_nc.scale_decimal(axis.value.raw, "100"), "25")
        self.assertEqual(gedit_nc.format_number("25", axis.value, KEEP), "+25,")

    def test_decimal_of_reads_a_klartext_comma_that_decimal_refuses(self):
        # 2026-09 (review finding NC2): the scripts compared and limited a token's value
        # with `Decimal(token.value.raw)`, which raises on `500,5`; a comma F or S made
        # Scale feed and Scale speed exit with a traceback at every percentage.
        from decimal import Decimal, InvalidOperation

        cp = gedit_nc.compile_profile(helpers.load_profile("heidenhain-klartext"))
        tokens, _ = gedit_nc.tokenize_line("12 L X-10,25 F500,5", cp)
        feed = next(t for t in tokens if t.address == "F")
        axis = next(t for t in tokens if t.address == "X")
        with self.assertRaises(InvalidOperation):
            Decimal(feed.value.raw)
        self.assertEqual(gedit_nc.decimal_of(feed.value), Decimal("500.5"))
        self.assertEqual(gedit_nc.decimal_of(axis.value), Decimal("-10.25"))
        # Text that `format_number` wrote back with the comma, and the plain forms.
        self.assertEqual(gedit_nc.decimal_of("250,25"), Decimal("250.25"))
        self.assertEqual(gedit_nc.decimal_of("1500,"), Decimal("1500"))
        self.assertEqual(gedit_nc.decimal_of("700."), Decimal("700"))
        self.assertEqual(gedit_nc.decimal_of(".5"), Decimal("0.5"))
        for text in ["", "abc", "1e3", "1,2,3", None]:
            with self.subTest(text=text):
                self.assertIsNone(gedit_nc.decimal_of(text))


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

    #: What ECMAScript's `\s` matches in the Basic Multilingual Plane, the set every engine
    #: of ES2015 and later has: white space, the Unicode space separators, the byte-order
    #: mark and the four line terminators.
    JS_SPACE = frozenset(
        [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]
        + list(range(0x2000, 0x200B))
    )
    #: What ECMAScript's `.` does not match.
    JS_LINE_TERMINATORS = frozenset([0x0A, 0x0D, 0x2028, 0x2029])

    def members(self, pattern):
        """The BMP characters a one-character pattern matches, translated and compiled as a profile's."""
        regex = re.compile(gedit_nc.to_py_regex(pattern), re.ASCII | re.IGNORECASE)
        return frozenset(code for code in range(0x10000) if not 0xD800 <= code <= 0xDFFF and regex.fullmatch(chr(code)))

    def test_white_space_and_the_dot_read_as_they_do_in_ecmascript(self):
        # G8 M8 review: with `re.ASCII` Python's `\s` is six characters and ECMAScript's
        # more than twenty, so `S3<NBSP>=2500` was an assignment to the editor and the
        # main spindle's `S3` to a script, which then scaled it (`tokens/sinumerik.json`).
        everything = frozenset(code for code in range(0x10000) if not 0xD800 <= code <= 0xDFFF)
        self.assertEqual(self.members("\\s"), self.JS_SPACE)
        self.assertEqual(self.members("\\S"), everything - self.JS_SPACE)
        self.assertEqual(self.members("."), everything - self.JS_LINE_TERMINATORS)
        self.assertEqual(self.members("[.]"), frozenset([ord(".")]))

    def test_white_space_inside_a_character_class_reads_the_same(self):
        everything = frozenset(code for code in range(0x10000) if not 0xD800 <= code <= 0xDFFF)
        comma = frozenset([ord(",")])
        self.assertEqual(self.members("[\\s,]"), self.JS_SPACE | comma)
        self.assertEqual(self.members("[^\\s,]"), everything - self.JS_SPACE - comma)
        self.assertEqual(self.members("[\\S,]"), (everything - self.JS_SPACE) | comma)
        self.assertEqual(self.members("[^\\S,]"), self.JS_SPACE - comma)
        self.assertEqual(self.members("[\\s\\S]"), everything)
        self.assertEqual(self.members("[^\\s\\S]"), frozenset())
        # A `-` beside a class escape is a character, never the end of a range (and the
        # profile's patterns ignore case, as they do in the editor).
        dash = frozenset([ord("-"), ord("z"), ord("Z")])
        self.assertEqual(self.members("[\\s-z]"), self.JS_SPACE | dash)
        self.assertEqual(self.members("[z-\\S]"), (everything - self.JS_SPACE) | dash)

    def test_a_pattern_of_a_built_in_profile_still_finds_what_it_found(self):
        # The comment filter of the tool list and the comment rule of the outline both hold
        # `\s` inside a class; `.` stands in every `(?<text>.*)`.
        profile = helpers.load_profile("sinumerik")
        rule = next(rule for rule in profile["outline"] if rule["kind"] == "comment")
        comment = re.compile(gedit_nc.to_py_regex(rule["pattern"]), re.ASCII | re.IGNORECASE)
        self.assertEqual(comment.match("; ROUGH OD").group("text"), " ROUGH OD")
        self.assertIsNone(comment.match(";----"))
        self.assertIsNone(comment.match("; \u00a0 "))


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
                    "assignment",
                    "labels",
                    "system_variables",
                    "header",
                    "names",
                    "continuation_start",
                ]:
                    self.assertIn(name, cp.patterns)
                self.assertTrue(cp.patterns["outline"])
                self.assertTrue(cp.patterns["detect_content"])

    def test_every_pattern_field_of_every_built_in_and_effective_profile_compiles(self):
        # The effective profiles are what a script is really handed: a profile with a
        # machine's preset or variant merged in (plan §7.15).
        profiles = [(profile_id, helpers.load_profile(profile_id)) for profile_id in helpers.profile_ids()]
        profiles += effective_profiles()
        self.assertGreater(len(profiles), len(helpers.profile_ids()))
        for name, profile in profiles:
            cp = gedit_nc.compile_profile(profile)
            for path in PATTERN_PATHS:
                for source in values_at(profile, path):
                    with self.subTest(profile=name, path=path, pattern=source):
                        self.assertIsInstance(source, str)
                        re.compile(gedit_nc.to_py_regex(source), cp.flags)

    def test_the_turning_patterns_are_compiled_exactly_where_a_profile_declares_them(self):
        for profile_id in helpers.profile_ids():
            profile = helpers.load_profile(profile_id)
            cp = gedit_nc.compile_profile(profile)
            for field, key in TURNING_FIELDS.items():
                if key is None:
                    continue
                with self.subTest(profile=profile_id, field=field):
                    source = profile["syntax"].get(field)
                    if source is None:
                        self.assertIsNone(cp.patterns[key])
                    else:
                        self.assertEqual(cp.patterns[key].pattern, gedit_nc.to_py_regex(source))
                        self.assertEqual(cp.patterns[key].flags & re.IGNORECASE, cp.flags & re.IGNORECASE)

    def test_the_named_groups_the_features_read_survive_the_rewrite(self):
        for profile_id in helpers.profile_ids():
            with self.subTest(profile=profile_id):
                cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
                self.assertIn("tool", cp.patterns["tool"].groupindex)
                for regex in cp.patterns["program_start"]:
                    self.assertIn("name", regex.groupindex)
                # The label rule reads the name out of its group, in front of a block
                # number or behind one (P8).
                if cp.patterns["labels"] is not None:
                    self.assertIn("name", cp.patterns["labels"].groupindex)

    def test_a_label_pattern_without_the_name_group_finds_no_label_rather_than_failing(self):
        profile = helpers.load_profile("sinumerik")
        profile["syntax"]["labels"] = "^\\s*[A-Z_][A-Z0-9_]*:(?!=)"
        cp = gedit_nc.compile_profile(profile)
        kinds = [token.kind for token in code_tokens(gedit_nc.tokenize_line("LOOP_A: G1 X10", cp)[0])]
        self.assertNotIn("label", kinds)

    def test_a_broken_turning_pattern_names_the_field_it_came_from(self):
        for field in ["assignment", "labels", "systemVariables", "header", "names"]:
            with self.subTest(field=field):
                profile = helpers.load_profile("sinumerik")
                profile["syntax"][field] = "[A-Z"
                with self.assertRaises(ValueError) as caught:
                    gedit_nc.compile_profile(profile)
                self.assertIn("syntax.%s" % field, str(caught.exception))

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


class TestMaskCommentsInTheTurningDialects(unittest.TestCase):
    """A dialect with strings and a comment to the line end reads the string first (P8).

    On a line like ``MSG("ROUGH;FINISH")`` the ``;`` is text the operator reads on the
    screen; a mask that started a comment there would hide the rest of the block from every
    code pattern.
    """

    def setUp(self):
        self.okuma = gedit_nc.compile_profile(helpers.load_profile("okuma-osp"))
        self.sinumerik = gedit_nc.compile_profile(helpers.load_profile("sinumerik"))

    def test_a_comment_marker_inside_a_string_opens_nothing(self):
        line = 'MSG("ROUGH;FINISH") G1 X10'
        self.assertEqual(gedit_nc.mask_comments(line, self.sinumerik), line)

    def test_the_comment_behind_a_string_is_still_blanked(self):
        self.assertEqual(gedit_nc.mask_comments('MSG("A;B") ;NOTE', self.sinumerik), 'MSG("A;B")      ')
        self.assertEqual(gedit_nc.mask_comments('T="DRILL_D8" ;TOOL 8', self.sinumerik), 'T="DRILL_D8"        ')

    def test_a_quote_inside_a_comment_belongs_to_the_comment(self):
        self.assertEqual(gedit_nc.mask_comments('G1 X10 ;SAY "HI"', self.sinumerik), "G1 X10          ")

    def test_a_named_tool_stays_code_and_a_commented_one_is_no_tool_call(self):
        trigger = self.sinumerik.patterns["tool_trigger"]
        named = gedit_nc.mask_comments('T="DRILL_D8" D1 ;WAS T="MILL_D10"', self.sinumerik)
        self.assertEqual(named, 'T="DRILL_D8" D1                  ')
        self.assertIsNotNone(trigger.search(named))
        self.assertIsNone(trigger.search(gedit_nc.mask_comments(';T="MILL_D10"', self.sinumerik)))

    def test_the_okuma_comment_is_the_bracket_and_a_quote_is_just_a_character(self):
        self.assertEqual(gedit_nc.mask_comments("N100 G00 X200 (ROUGH)", self.okuma), "N100 G00 X200        ")
        self.assertEqual(gedit_nc.mask_comments('G00 X="A" (ROUGH)', self.okuma), 'G00 X="A"        ')

    def test_the_file_header_is_stepped_over_whole_and_only_at_the_head_of_a_line(self):
        # Detection reads the header off the masked line, so a comment marker inside the
        # file name may not blank half of it.
        headers = [("$FLANGE.MIN%", self.okuma), ("$FLANGE(2).MIN%", self.okuma), ("%_N_PART_MPF", self.sinumerik)]
        for line, cp in headers:
            with self.subTest(line=line):
                self.assertEqual(gedit_nc.mask_comments(line, cp), line)
        self.assertEqual(gedit_nc.mask_comments("G00 X10 (ROUGH) $A.MIN%", self.okuma), "G00 X10         $A.MIN%")


def is_program_name(token, cp):
    """True for a program marker that is a program name (``<SHAFT_T12>``), not ``O1234``."""
    regex = cp.patterns.get("program_names")
    return token.kind == "programMarker" and regex is not None and regex.fullmatch(token.text) is not None


class TestMaskAgreesWithTheTokenizer(unittest.TestCase):
    """``mask_comments`` blanks exactly the spans ``tokenize_line`` reads as comments.

    Two readers of one line that disagree about where a comment is are how a tool change
    inside a comment reaches the program map. Every golden line is run under every profile,
    together with the lines ``mask.test.ts`` checks on the TypeScript side.
    """

    EXTRA = [
        ("fanuc-gcode", "N10 G0 X10. (A) Y20. (B"),
        ("fanuc-gcode", "G1 (A (B) ) X10."),
        ("heidenhain-klartext", '9 LBL "A;B"'),
        ("okuma-osp", "NLAP1 G85 (BAR TURNING)"),
        ("okuma-osp", "SB=1200 M13 (LIVE TOOL"),
        ("sinumerik", "N10 LOOP_A: G1 X10 ;FEED IN"),
        ("sinumerik", 'MSG("ROUGH;FINISH") ;OPERATOR NOTE'),
        ("sinumerik", 'MSG("A;B'),
        ("sinumerik", "MSG(A;B"),
    ]

    def check(self, line, cp):
        masked = gedit_nc.mask_comments(line, cp)
        self.assertEqual(len(masked), len(line))
        tokens, _ = gedit_nc.tokenize_line(line, cp)
        for token in tokens:
            span = masked[token.start : token.end]
            if token.kind == "comment":
                self.assertEqual(span, " " * len(token.text), dump(tokens))
            elif is_program_name(token, cp):
                # Phase 2 (§7.16): a program name masks its letters and digits as `_`.
                self.assertEqual(span, re.sub(r"[A-Za-z0-9]", "_", token.text), dump(tokens))
            else:
                self.assertEqual(span, token.text, dump(tokens))

    def test_every_golden_line_under_every_profile(self):
        lines = every_golden_line()
        for profile_id in helpers.profile_ids():
            cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
            for line in lines:
                with self.subTest(profile=profile_id, line=line):
                    self.check(line, cp)

    def test_the_lines_the_typescript_side_checks(self):
        for profile_id, line in self.EXTRA:
            with self.subTest(profile=profile_id, line=line):
                self.check(line, gedit_nc.compile_profile(helpers.load_profile(profile_id)))


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

    def test_skip_level_0_is_a_level_so_the_number_behind_it_is_still_the_block_number(self):
        # Read as `/` and a value, `/0 N10` had no block number, and a renumber would have
        # written a second one in front of the block (plan §7.16 #11).
        cp = gedit_nc.compile_profile(helpers.load_profile("sinumerik"))
        self.assertEqual(
            gedit_nc.block_number_of("/0 N10 G0 X10", cp),
            {"value": 10, "text": "10", "start": 3, "end": 6},
        )
        self.assertEqual(gedit_nc.block_number_of("/9 N20 G0", cp)["value"], 20)
        self.assertEqual(
            [(token.kind, token.text) for token in code_tokens(gedit_nc.tokenize_line("/0 N10 G0", cp)[0])],
            [("skip", "/0"), ("blockNumber", "N10"), ("word", "G0")],
        )

    def test_a_name_is_never_offered_as_a_block_number(self):
        okuma = gedit_nc.compile_profile(helpers.load_profile("okuma-osp"))
        self.assertIsNone(gedit_nc.block_number_of("NLAP1 G85", okuma))
        self.assertIsNone(gedit_nc.block_number_of("/NLAP1 G85", okuma))
        self.assertEqual(
            gedit_nc.block_number_of("N0010 G00", okuma),
            {"value": 10, "text": "0010", "start": 0, "end": 5},
        )
        sinumerik = gedit_nc.compile_profile(helpers.load_profile("sinumerik"))
        self.assertIsNone(gedit_nc.block_number_of("NEXT_PART: G0 X5", sinumerik))

    def test_the_number_of_a_labelled_block_is_still_a_block_number(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("sinumerik"))
        self.assertEqual(
            gedit_nc.block_number_of("N10 LOOP_A: G1 X10", cp),
            {"value": 10, "text": "10", "start": 0, "end": 3},
        )


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

    def test_a_siemens_tapping_cycle_counts_whether_or_not_a_blank_stands_before_its_bracket(self):
        # G8 M8 review: `CYCLE840 (…)` was a name and loose values to the tokenizer, so the
        # tapping cycle never reached the tracker and scale feed changed its F in silence.
        profile = helpers.load_profile("sinumerik")
        cp = gedit_nc.compile_profile(profile)
        for cycle in ["N60 CYCLE840 (5,0,2,-15,,0.5,3,3,1,,1.5)", "N60 CYCLE840(5,0,2,-15,,0.5,3,3,1,,1.5)"]:
            with self.subTest(cycle=cycle):
                states = self.walk(cp, profile, ["N40 G95 S500 M3", "N50 F750", cycle])
                self.assertEqual(states[2][2], "CYCLE840")
                self.assertTrue(states[2][3])

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


class TestContinuesBlock(unittest.TestCase):
    """A line that belongs to the block above it by a marker at its start (M8, §7.16 #27).

    G10 M8 NC finding 9: OSP writes the rest of a long block on lines that start with `$`,
    and the `F2` of `$ H2.45 L2 F2` under a `G71` line is that thread cycle's lead.
    """

    def test_the_okuma_marker_and_nothing_else(self):
        cp = gedit_nc.compile_profile(helpers.load_profile("okuma-osp"))
        for line, want in (
            ("$ H2.45 L2 F2 M23 M32 M73", True),
            ("  $ G84 XA=60 DA=2 FA=0.2", True),
            ("$", True),
            ("$ADV-CONT.MIN%", False),
            ("N001 G71 X27.55 Z-30", False),
            ("X10 $ Z5", False),
        ):
            with self.subTest(line=line):
                self.assertIs(gedit_nc.continues_block(line, cp), want)

    def test_a_profile_without_the_field_has_no_such_lines(self):
        for profile_id in ["fanuc-gcode", "fanuc-lathe", "heidenhain-klartext", "sinumerik"]:
            with self.subTest(profile=profile_id):
                cp = gedit_nc.compile_profile(helpers.load_profile(profile_id))
                self.assertIsNone(cp.patterns["continuation_start"])
                self.assertFalse(gedit_nc.continues_block("$ H2.45 L2 F2", cp))

    def test_the_tracker_keeps_the_block_open_only_when_it_is_told(self):
        # FeedModeTracker is built from the database alone, so it cannot see the profile's
        # marker; a script passes what `continues_block` answers, and one that does not
        # reads every line as a block of its own, as in P1.
        context = helpers.effective_context("okuma-osp")
        cp = gedit_nc.compile_profile(context["profile"])
        lines = ["N001 G71 X27.55 Z-30 B60 D0.7 U0.1", "$ H2.45 L2 F2 M23 M32 M73", "G00 X600 Z400"]
        for told, want in ((True, [True, True, False]), (False, [True, False, False])):
            with self.subTest(told=told):
                tracker = gedit_nc.FeedModeTracker(context["codes"])
                state = None
                seen = []
                for line in lines:
                    tokens, state = gedit_nc.tokenize_line(line, cp, state)
                    tracker.update(tokens, continued=told and gedit_nc.continues_block(line, cp))
                    seen.append(tracker.pitch_feed)
                self.assertEqual(seen, want)

    def test_a_selection_that_starts_on_a_dollar_line_starts_inside_the_block_above(self):
        context = helpers.effective_context("okuma-osp")
        cp = gedit_nc.compile_profile(context["profile"])
        above = ["G97 S800 M03", "N001 G71 X27.55 Z-30 B60 D0.7 U0.1"]
        inside = gedit_nc.FeedModeTracker(context["codes"])
        gedit_nc.prime_tracker(inside, above, cp, "$ H2.45 L2 F2 M23 M32 M73")
        self.assertEqual((inside.active_cycle, inside.pitch_feed), ("G71", True))
        after = gedit_nc.FeedModeTracker(context["codes"])
        gedit_nc.prime_tracker(after, above, cp, "G00 X600 Z400")
        self.assertEqual((after.active_cycle, after.pitch_feed), (None, False))
        # Without the first line the tracker cannot know, and closes the block as before.
        unknown = gedit_nc.FeedModeTracker(context["codes"])
        gedit_nc.prime_tracker(unknown, above, cp)
        self.assertEqual((unknown.active_cycle, unknown.pitch_feed), (None, False))


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
