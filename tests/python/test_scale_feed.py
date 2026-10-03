"""`scale_feed.py` (plan §5, WP4.7), against the golden cases in
``tests/fixtures/scripts/scale_feed/``.

Each case is a folder: `input.nc` (stdin), the optional `params.json` the user would have
filled in, the optional `case.json` that says which dialect it is written in or makes the
run a selection, and the two goldens

* `expected.nc` — the text the script hands back, byte for byte. It is a plain NC file so
  that a reviewer can diff it against `input.nc` and see the change, which is the whole
  point of a golden for a transform.
* `envelope.json` — the rest of the `envelope` stdout: `message` and `findings`.

The script runs in a subprocess the way the app runs it (header, stdin, `GEDIT_CONTEXT`),
because that is what is being tested.

The programs in the fixtures are synthetic. They were written for gEdit from
`docs/planning/syntax/`, are not copied from a machine, a CAM system or a customer, and
are not meant to run on a machine. They carry no `WRITTEN FOR GEDIT` comment rule of their
own: `scale_feed` never touches a comment, so the marker line is simply part of the
program and is asserted to come back unchanged.

What the cases cover, in the plan's words:

* `FMAX` and `FAUTO` are left alone (`klartext-basic`)
* G95 and G93 are skipped by default, with an option to scale them (`fanuc-feed-modes`,
  `fanuc-feed-modes-all`)
* `pitchFeed` blocks are never scaled and are reported (`fanuc-pitch-feed`)
* variables and expressions are skipped and reported (`fanuc-variables`)
* Klartext cycle Q feeds are listed and left unchanged (`klartext-basic`,
  `klartext-tapping`)
* the written form of a number survives (`fanuc-number-forms`)

And the four the M4 review added, each of which is a program the script used to get
wrong:

* a code whose number is a threading cycle somewhere else is refused rather
  than scaled (`fanuc-lathe-threading`)
* a zero or negative feed is never raised to the "smallest feed" limit
  (`fanuc-zero-feed-with-limit`)
* a value the written precision rounds back to itself, or further than asked, is named
  line by line instead of only counted (`fanuc-lathe-decimals`)
* a run over a selection says which modal state it could not see (`fanuc-selection`)

And the three WP5.4 added, which are the same modal-state hazard **fixed** rather than
warned about: a selection whose case folder carries a `preceding.nc` is primed from the
lines above it (`input.precedingLines`, plan section 7.5), so the run reads the fragment
in the state it is really written in.

* a selection that starts inside a `G84` tapping cycle refuses its pitches
  (`fanuc-selection-primed`)
* a selection under a `G95` inherits the feed mode (`fanuc-selection-per-revolution`)
* a Klartext selection that starts inside a cycle's parameter block inherits the cycle
  **and** the `~` continuation (`klartext-selection-primed`)

Each of the three is checked twice: once against its golden, and once with
`precedingLines` taken back out, which is what the run used to do and what it still does
when the context does not carry the field.

And the turning cases M6 added (WP6.6). A turning program is not a milling program with
other numbers in it: nearly every feed is a feed per **revolution**, the codes that carry a
thread lead are ordinary codes of the dialect, and which of them means what depends on the
machine's G-code system rather than on the dialect (plan AD-31). Each case is a claim:

* `lathe-turning` — a feed per revolution is scaled on a lathe without being asked, the
  `P`-`Q` profile of a `G71` holds ordinary feeds, and the leads of `G76`, `G92` and `G32`
  are not touched
* `lathe-per-revolution-no` — the same program with the option set to no: nothing is
  scaled, and each finding names the code that is in force (`G99`), not the mill's `G95`
* `lathe-system-b` / `lathe-system-b-as-a` — one program, two machines. In system B `G78`
  cuts the thread and its `F` is the 2 mm lead; read as system A, where `G78` is not a code
  at all, the same word is multiplied. Which one happens is the machine's setting
* `lathe-decimal-is-b` / `-calculator` / `-no-machine` — `F155` becomes `F140` in all three,
  because scaling is unit-free whatever the control makes of a number without a point
* `lathe-feed-limit-machine` / `-no-machine` — and the limits are not: the same program,
  once against a limit of 0.2 mm/rev on a machine that reads a point-less feed in
  increments of 0.001, and once with no machine, where (M9) a point-less feed per
  revolution is 0.01 mm/rev counts on the increment presets and as written on the
  calculator one, so it has no value and the limit is left out of it
* `klartext-no-value-limit` — a feed per tooth and a feed per revolution are not in the
  unit of the limits (per minute on a milling profile), so they are scaled and the limits
  are left out of them, loudly (M9: by their unit; the per-revolution one used to be
  compared)

And the three the G8 review of M6 added. Each is a real program paired with the machine a
shop would have, and each came back from this script with a thread lead multiplied and
nothing said about it — the mistake that scraps a part. A lead is refused now whichever
way the program and the profile are paired, because the flag sits on the **code**:

* `lathe-b-thread-no-clamp` — a G-code system B program whose post writes no `G92 S`
  clamp, so variant detection cannot reach its margin and the program is read as system A,
  where `G78` is not a code at all. The three 1.5 mm leads are left alone all the same
* `lathe-a-thread-as-b` — the mirror: a system A program opened with the shop's system-B
  machine, where `G92` sets the coordinate system. Its `G92 X… Z… F1.5` is still a thread
* `lathe-mill-tapping` — a milling program opened with the lathe profile, where `G74` pecks
  a face instead of cutting a left-hand thread. Its `F1.25` is still a pitch

And the turning dialects of M8 (WP8.7):

* `okuma-turning` — the `F` of `G04` is a dwell time, never scaled and not counted as a
  feed; `G71` is a thread cycle here (not a roughing cycle), `G33` passes and the `G184` tap
  keep their leads, and `F=V1` is a variable
* `okuma-feed-limit-1um` / `-10um` / `-no-machine` — the Okuma unit systems scale every
  number, with or without a point, so `F250` and `F234.56` are 0.25 and 0.23456 mm/rev
  under 1 µm (`F25` and `F23.456` under 10 µm), and the largest feed compares those values;
  with no machine chosen no Okuma feed has a value, and every limit is left out and said so
* `sinumerik-turning` — `G4 F` is a dwell, `F=R1` a parameter, the `G33` lead is in `K`
  and untouched, the feeds of `CYCLE85(…)` are arguments that are listed and left, and the
  feed in force when `CYCLE840(…)` runs is left as written, because without a spindle
  encoder that cycle taps with it (the M8 review corrected this golden: it had locked in
  `F750` scaled to `F600`, a tap cut with the wrong lead)

And the M8 NC review (G10), each with the program the review ran:

* `sinumerik-variable-lead` / `-under-g33` — the `F` of `G34` and `G35` is the change of
  the lead, never a feed, and the finding names the block's code even while `G33` is modal
* `sinumerik-g63` — the `F` of a `G63` tap is the speed times the pitch
* `sinumerik-cycle840-per-rev` — the same `CYCLE840` in `G95` with two decimals: `F1` stays
* `sinumerik-mcall-tapping` — `MCALL CYCLE840(…)` repeats the tap after every move, so the
  feed written between it and the `MCALL` that ends it stays too; `MCALL CYCLE81(…)` does
  not tap and its feeds are scaled
* `sinumerik-feed-type` — `G96` switches to feed per revolution on this control, and the
  finding names the code in force
* `sinumerik-cycle-feeds` / `-only` — the feeds of `CYCLE95` and `CYCLE952` are listed, and
  the chamfer feeds `FRC=` and `FRCM=` are reported
* `okuma-thread-after-g32` — the finding names `G71`, the block's own thread cycle, and not
  the `G32` still in force
* `okuma-feeds-of-their-own` — `FA=` and `FB=` are feeds under addresses of their own

And the M9 NC review (NC-F1): "only feeds above" and "only feeds below" decide **whether** a
feed is scaled, so a feed they cannot be compared with is left as written and reported,
where the smallest and largest feed are only left out of it:

* `lathe-filter-other-unit` — "only feeds below 0.3" on a lathe: the `G98` feeds per minute
  stay, a largest feed of 0.25 clamps a turning feed beside them
* `lathe-filter-no-value` — "only feeds above 0.1" with no machine: the point-less `F25`
  has no value and stays
"""

from __future__ import annotations

import json
import sys
import unittest

from tests.python import helpers

SCRIPT = "scale_feed.py"

#: `tomllib` reads the script header the way the backend does; it arrived in 3.11, and
#: the gate also runs on 3.9, where those checks are skipped rather than dropped.
HAS_TOMLLIB = sys.version_info >= (3, 11)

#: Cases the plan names by hand, so a renamed or deleted folder fails loudly.
REQUIRED_CASES = [
    "fanuc-basic",
    "fanuc-clamped",
    "fanuc-feed-modes",
    "fanuc-feed-modes-all",
    "fanuc-lathe-decimals",
    "fanuc-lathe-threading",
    "fanuc-number-forms",
    "fanuc-number-forms-two-decimals",
    "fanuc-pitch-feed",
    "fanuc-selection",
    "fanuc-selection-per-revolution",
    "fanuc-selection-primed",
    "fanuc-unchanged",
    "fanuc-value-filter",
    "fanuc-variables",
    "fanuc-zero-feed-with-limit",
    "klartext-basic",
    "klartext-per-revolution",
    "klartext-selection-primed",
    "klartext-tapping",
    # M6 (WP6.6): the turning cases. Each one is a claim the plan names by hand.
    "klartext-no-value-limit",
    "lathe-decimal-calculator",
    "lathe-decimal-is-b",
    "lathe-decimal-no-machine",
    "lathe-feed-limit-machine",
    "lathe-feed-limit-no-machine",
    "lathe-per-revolution-no",
    "lathe-system-b",
    "lathe-system-b-as-a",
    "lathe-turning",
    # G8 M6: the three programs the NC review ran, each of which came back with a thread
    # lead multiplied and nothing said. The pairing of program and machine is the point.
    "lathe-a-thread-as-b",
    "lathe-b-thread-no-clamp",
    "lathe-mill-tapping",
    # M8 (WP8.7): the turning dialects, each a word a naive script would have scaled.
    "okuma-turning",
    "okuma-feed-limit-1um",
    "okuma-feed-limit-10um",
    "okuma-feed-limit-no-machine",
    "sinumerik-turning",
    # The M8 NC review: each the program the review ran, with its own input.
    "okuma-feeds-of-their-own",
    "okuma-thread-after-g32",
    "sinumerik-cycle-feeds",
    "sinumerik-cycle-feeds-only",
    "sinumerik-cycle840-per-rev",
    "sinumerik-feed-type",
    "sinumerik-g63",
    "sinumerik-mcall-tapping",
    "sinumerik-variable-lead",
    "sinumerik-variable-lead-under-g33",
    # 2026-09 (TODO Next up 8 and 2, R10): the leads the databases did not know, a selection
    # inside a modal tapping call, and the feeds of an Okuma LAP contour.
    "fanuc-leads-the-database-knows",
    "sinumerik-mcall-tapping-selection",
    "okuma-lap-shape-feeds",
    # M9 (WP9.5a): values read right. Each fails against the script of m9/int.
    "lathe-roughing-no-range",
    "lathe-roughing-no-range-machine",
    "lathe-limits-per-unit",
    "mill-limits-per-revolution",
    "okuma-contour-feed",
    "sinumerik-thread-lead-elsewhere",
    # The M9 review (F8): the F after G931 is a travel time.
    "sinumerik-g931",
    # The M9 NC review (NC-F1): a value filter that cannot be compared leaves the feed.
    "lathe-filter-other-unit",
    "lathe-filter-no-value",
]

#: The addresses this script is allowed to rewrite. Everything else has to come back
#: token for token (see :func:`shape_of`).
SCALED_ADDRESSES = ("F", "FU", "FZ")

SEVERITIES = ("info", "warning", "error")


def context_of(case):
    """The `ScriptContextV2` a case runs with: the **effective** profile and machine.

    The app never hands a script a profile on its own. It hands it the effective view of the
    document — the profile with the chosen machine's variants, number reading and power-on
    state applied, the database that goes with it, and the machine block beside it (plan
    §7.15, AD-31). A case that names a `machine` in its `case.json` therefore runs against
    the generated `tests/fixtures/resolved/effective/**` entry for exactly those parameters,
    written once by `tests/unit/resolved.test.ts`: **Python never merges a machine into a
    profile**, because two implementations of one merge is how the two sides start
    disagreeing quietly. A case without one runs with the profile's own defaults, which is
    what "no machine" means.

    `machineName` in a `case.json` is the name that machine carries in the run. The
    generator calls every machine it writes `review`; a golden message is easier to read,
    and to check by hand, with the name a user would have given it, and the name changes
    nothing but the sentence it appears in.
    """
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


def envelope_of(case):
    """The expected `message` and `findings` of a case."""
    return helpers.load_json(case.directory / "envelope.json")


def run_case(case):
    return helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))


def shape_of(lines, cp):
    """Every token of a program with the scaled values blanked out.

    Two programs with the same shape differ **only** inside the values of feed words: same
    line count, same tokens in the same order, same kinds and addresses, and every comment,
    string, block number, skip mark and space identical character for character. It is the
    invariant that matters most here — a transform that corrupts a program is the worst
    bug this script could have.
    """
    gedit_nc = helpers.import_gedit_nc()
    out = []
    state = None
    for line in lines:
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        out.append(
            [
                (
                    token.kind,
                    token.address,
                    "<value>"
                    if token.kind == "word" and token.address in SCALED_ADDRESSES
                    else token.text,
                )
                for token in tokens
            ]
        )
    return out


class TestGoldenCases(unittest.TestCase):
    def setUp(self):
        self.cases = helpers.script_cases("scale_feed")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        self.assertTrue(self.cases, "no scale_feed fixtures found")
        names = sorted(case.name for case in self.cases)
        self.assertEqual([name for name in REQUIRED_CASES if name not in names], [])

    def test_every_case_produces_its_expected_text_and_envelope(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                self.assertFalse(case.expects_json, "the text golden is expected.nc")
                result = run_case(case)
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.stderr, "")
                payload = result.json()
                self.assertEqual(sorted(payload), ["findings", "message", "text"])
                self.assertEqual(payload["text"], case.expected_text())
                self.assertEqual(
                    {"message": payload["message"], "findings": payload["findings"]},
                    envelope_of(case),
                )

    def test_the_output_differs_from_the_input_only_inside_feed_values(self):
        gedit_nc = helpers.import_gedit_nc()
        for case in self.cases:
            with self.subTest(case=case.name):
                cp = gedit_nc.compile_profile(helpers.load_profile(case.profile_id))
                before = case.input_lines()
                after = case.expected_text().split("\n")
                self.assertEqual(len(before), len(after), "a scale run never adds a line")
                self.assertEqual(shape_of(before, cp), shape_of(after, cp))

    def test_the_trailing_newline_of_the_input_survives(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                text = case.input_text()
                self.assertEqual(case.expected_text().endswith("\n"), text.endswith("\n"))

    def test_every_finding_points_at_a_line_of_the_input(self):
        for case in self.cases:
            with self.subTest(case=case.name):
                first = context_of(case)["input"]["startLine"]
                last = first + len(case.input_lines()) - 1
                for finding in envelope_of(case)["findings"]:
                    self.assertIn(finding["severity"], SEVERITIES)
                    self.assertGreaterEqual(finding["line"], first)
                    self.assertLessEqual(finding["line"], last)
                    self.assertTrue(finding["message"].endswith("."), finding["message"])


class TestRules(unittest.TestCase):
    """The rules behind the cases, stated once so that a fixture change cannot hide them."""

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

    def output(self, name):
        """The golden text of a case, re-checked against a live run."""
        case = self.case(name)
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def lines(self, name):
        return self.output(name)["text"].split("\n")

    def messages(self, name):
        return [finding["message"] for finding in self.output(name)["findings"]]

    def test_a_plain_feed_is_multiplied_by_the_percentage(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("G1 Z-2. F1080.", lines)
        self.assertIn("/N90 G1 X50. F270.", lines)
        self.assertIn("N120/G0 Y10. F225.", lines)

    def test_packed_code_is_scaled_without_being_respaced(self):
        self.assertIn("N10G1X10.Y-5.F450", self.lines("fanuc-basic"))

    def test_a_feed_inside_a_comment_is_not_a_feed(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("(T1  D10 FLAT END MILL - ROUGH AT F500)", lines)
        self.assertIn("(FINISH PASS AT F500)", lines)
        self.assertIn("(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", lines)

    def test_a_thread_pitch_is_never_scaled_and_is_reported(self):
        payload = self.output("fanuc-pitch-feed")
        lines = payload["text"].split("\n")
        # G84 and G74 tapping, G33 and G32 thread cutting: the F is a pitch, not a feed.
        self.assertIn("G98 G84 X20. Y10. Z-12. R3. F625.", lines)
        self.assertIn("G74 X80. Y10. Z-12. R3. F625.", lines)
        self.assertIn("G33 Z-20. F1.5", lines)
        self.assertIn("G32 Z-20. F1.5", lines)
        self.assertEqual(
            [finding["severity"] for finding in payload["findings"]], ["warning"] * 4
        )
        self.assertTrue(all("thread pitch" in message for message in self.messages("fanuc-pitch-feed")))
        # G80 and a motion code end the cycle, so the feeds around it are scaled.
        self.assertIn("G1 X60. F400.", lines)
        self.assertIn("G1 Z2. F480.", lines)

    def test_a_code_that_means_a_threading_cycle_elsewhere_is_refused(self):
        # G8 M4. G76 is a fine boring cycle on the shipped mill dialect and a multi-pass
        # threading cycle on a lathe in G-code system A, where its F is the thread lead;
        # G92 sets the coordinate system on the one and is the single-pass threading
        # cycle on the other. Both database entries said so in prose and carried no flag,
        # so `Scale feed rates` at 80 % turned a 2.0 mm lead into 1.6 mm without a word.
        # `pitchFeedAmbiguous` is that prose made machine readable, and the script
        # refuses rather than guesses: the flag decides, not the number.
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80}, profile=profile, codes=helpers.load_codes(profile)
        )
        program = "N200 G76 X18.16 Z-20. P1190 Q350 F2.0\nN210 G92 X19.5 Z-20. F2.0\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["text"], program)

        findings = result.json()["findings"]
        self.assertEqual([finding["line"] for finding in findings], [1, 2])
        for finding, code in zip(findings, ("G76", "G92")):
            self.assertEqual(finding["severity"], "warning")
            self.assertIn(code, finding["message"])
            self.assertIn("thread lead", finding["message"])
        self.assertIn("threading cycle somewhere else", result.json()["message"])

    def test_the_tapping_and_threading_codes_of_the_source_review_keep_their_lead(self):
        # The source review (2026-09) ran scale feed on codes the databases did not know:
        # the variable-lead thread G34 (mill and lathe) and the older-format rigid tap G84.2
        # (lathe) had their lead scaled with nothing said. Their entries now carry
        # `pitchFeed`, so the F stays as written and is reported.
        for profile_id, program in (
            ("fanuc-gcode", "N10 G34 Z-30. F2.0 K0.1\n"),
            ("fanuc-lathe", "N10 G34 Z-30. F2.0 K0.1\n"),
            ("fanuc-lathe", "N10 G97 S300 M3\nN20 G84.2 Z-20. F1.5\nN30 G80\n"),
        ):
            with self.subTest(profile=profile_id, program=program):
                profile = helpers.load_profile(profile_id)
                context = helpers.make_context(
                    params={"percent": 80}, profile=profile, codes=helpers.load_codes(profile)
                )
                result = helpers.run_script(SCRIPT, stdin=program, context=context)
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.json()["text"], program)
                findings = result.json()["findings"]
                self.assertTrue(findings, "the kept lead is reported")
                self.assertTrue(all(finding["severity"] == "warning" for finding in findings), findings)

    def test_a_klartext_feed_per_revolution_is_not_raised_to_a_feed_limit(self):
        # The source review (2026-09): after M136 a plain F is millimetres per revolution.
        # Read as a feed per minute, a "smallest feed" of 50 turned F0.2 into F50.0, which
        # is 50 mm per revolution. M136 now sets the feed unit, and a feed per revolution is
        # left alone on this milling dialect unless the user asks for it.
        profile = helpers.load_profile("heidenhain-klartext")
        context = helpers.make_context(
            params={"percent": 110, "minFeed": 50}, profile=profile, codes=helpers.load_codes(profile)
        )
        program = "0 BEGIN PGM T MM\n1 TOOL CALL 5 Z S800\n2 M136\n3 L X+10 F0.2\n4 M137\n5 L X+20 F200\n6 END PGM T MM\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        lines = result.json()["text"].split("\n")
        self.assertEqual(lines[3], "3 L X+10 F0.2")
        self.assertEqual(lines[5], "5 L X+20 F220")

    def test_the_ambiguous_code_is_recognised_however_the_block_is_written(self):
        """The refusal has to survive the ways a post actually writes a code.

        It is a code-database lookup through `normalize_code`, not a string match, so
        leading zeros, lower case and a packed block all reach the same entry. A refusal
        that only fired on `G76 ` would be a refusal a real program walks straight past.
        """
        profile = helpers.load_profile("fanuc-gcode")
        for program, code in (
            ("G076 X18.16 Z-20. F2.0\n", "G76"),
            ("g76 X18.16 Z-20. F2.0\n", "G76"),
            ("N10G76X18.16Z-20.F2.0\n", "G76"),
            ("N10 G92X19.5F2.0\n", "G92"),
        ):
            with self.subTest(program=program.strip()):
                context = helpers.make_context(
                    params={"percent": 80}, profile=profile, codes=helpers.load_codes(profile)
                )
                result = helpers.run_script(SCRIPT, stdin=program, context=context)
                self.assertTrue(result.ok, result.stderr)
                payload = result.json()
                self.assertEqual(payload["text"], program, "the block was rewritten")
                self.assertEqual(len(payload["findings"]), 1)
                self.assertIn(code, payload["findings"][0]["message"])
                self.assertIn("thread lead", payload["findings"][0]["message"])

    def test_the_refusal_says_the_value_the_code_and_what_to_do(self):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80}, profile=profile, codes=helpers.load_codes(profile)
        )
        result = helpers.run_script(SCRIPT, stdin="G76 X18.16 Z-20. F2.0\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(
            result.json()["findings"][0]["message"],
            "F2.0 is not scaled: G76 is a threading cycle on another kind of machine or "
            "in another G-code system, where this F is the thread lead and not a feed "
            "rate. Check the block and scale it by hand if it really is a feed.",
        )

    def test_the_ambiguity_of_a_non_modal_code_ends_with_its_own_block(self):
        # G92 is non-modal, so the block after it is an ordinary move again. G76 is a
        # modal cycle and stays in force until G80 cancels it.
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 50}, profile=profile, codes=helpers.load_codes(profile)
        )
        program = "N10 G92 X19.5 F2.0\nN20 G1 X30. F400.\nN30 G76 Z-20. F2.0\nN40 X10. F2.0\nN50 G80\nN60 G1 X40. F400.\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(
            result.json()["text"].splitlines(),
            [
                "N10 G92 X19.5 F2.0",
                "N20 G1 X30. F200.",
                "N30 G76 Z-20. F2.0",
                "N40 X10. F2.0",
                "N50 G80",
                "N60 G1 X40. F200.",
            ],
        )

    def test_the_feed_modes_are_skipped_by_default_and_scaled_on_request(self):
        default = self.lines("fanuc-feed-modes")
        self.assertIn("G95 Y20. F0.15", default)
        self.assertIn("G93 X0. Y0. A90. F12.5", default)
        self.assertIn("G94 G1 Z-2. F225.", default)
        messages = self.messages("fanuc-feed-modes")
        self.assertTrue(any("feed per revolution (G95)" in message for message in messages))
        self.assertTrue(any("inverse-time feed (G93)" in message for message in messages))

        every = self.lines("fanuc-feed-modes-all")
        self.assertIn("G95 Y20. F0.14", every)
        self.assertIn("G93 X0. Y0. A90. F11.3", every)

    def test_a_feed_that_is_a_variable_or_an_expression_is_reported_and_left(self):
        lines = self.lines("fanuc-variables")
        self.assertIn("G1 Z-2. F#101", lines)
        self.assertIn("X40. F[#101*0.5]", lines)
        self.assertIn("X60. F#[#102]", lines)
        # The macro assignment is not a feed word at all and is never touched.
        self.assertIn("#101=800.", lines)
        self.assertIn("IF [#101 GT 2] GOTO 100", lines)
        self.assertIn("X80. F540.", lines)
        self.assertEqual(len(self.messages("fanuc-variables")), 4)

    def test_the_written_form_of_a_number_survives(self):
        lines = self.lines("fanuc-number-forms")
        self.assertIn("G1 X10. F1080.", lines)  # the trailing point stays
        self.assertIn("X20. F90", lines)  # and a value without one never gains one
        self.assertIn("X30. F.14", lines)  # the dropped leading zero stays dropped
        self.assertIn("X40. F0.072", lines)  # three written decimals stay three
        self.assertIn("X50. F6.8", lines)  # leading zeros go, one decimal stays one
        self.assertIn("X60. F11.111", lines)  # 11.1105 rounds half away from zero

    def test_a_fixed_decimal_count_never_gives_a_point_less_value_a_point(self):
        payload = self.output("fanuc-number-forms-two-decimals")
        lines = payload["text"].split("\n")
        self.assertIn("G1 X10. F1080.00", lines)
        # F100 would become F90.00, which a Fanuc control reads as ninety times the feed.
        self.assertIn("X20. F90", lines)
        self.assertTrue(
            any("without a decimal point" in finding["message"] for finding in payload["findings"])
        )

    def test_the_limits_clamp_the_scaled_value_and_say_so(self):
        payload = self.output("fanuc-clamped")
        lines = payload["text"].split("\n")
        self.assertIn("G1 Z-2. F200.", lines)
        self.assertIn("X40. F1350.", lines)
        self.assertIn("X60. F2500.", lines)
        self.assertEqual(len(payload["findings"]), 2)
        self.assertIn("smallest feed (200)", payload["findings"][0]["message"])
        self.assertIn("largest feed (2500)", payload["findings"][1]["message"])

    def test_the_value_filter_leaves_the_values_outside_it_alone(self):
        lines = self.lines("fanuc-value-filter")
        self.assertIn("G1 Z-2. F100.", lines)  # at or below "only above"
        self.assertIn("X40. F300.", lines)
        self.assertIn("X60. F500.", lines)
        self.assertIn("X80. F1500.", lines)  # at or above "only below"
        self.assertIn("2 left by the value filter", self.output("fanuc-value-filter")["message"])

    def test_a_hundred_per_cent_changes_nothing(self):
        case = self.case("fanuc-unchanged")
        payload = self.output("fanuc-unchanged")
        self.assertEqual(payload["text"], case.input_text())
        self.assertEqual(
            payload["message"],
            "No feed rate was changed; 5 already written that way. No machine: profile "
            "defaults assumed.",
        )

    def test_a_selection_counts_from_the_line_the_selection_started_on(self):
        payload = self.output("fanuc-selection")
        # Line 40 is the fragment warning below; line 41 is the pitch feed it did find.
        self.assertEqual([finding["line"] for finding in payload["findings"]], [40, 41])

    def test_a_selection_says_that_it_cannot_see_the_modal_state_above_it(self):
        # G8 M4. Feed modes and cycles are modal. A selection that starts below a G95 or
        # inside a G84 tapping cycle reads the fragment from the top-of-program state, so
        # a thread pitch set further up is scaled like an ordinary feed. The run still
        # happens — it is what the user asked for — but it opens by saying what it could
        # not see.
        payload = self.output("fanuc-selection")
        first = payload["findings"][0]
        self.assertEqual(first["line"], 40)
        self.assertEqual(first["severity"], "warning")
        self.assertIn("only the selection", first["message"])
        self.assertIn("cannot be recognised here", first["message"])

    def test_a_run_over_the_whole_document_does_not_warn_about_a_fragment(self):
        for name in ("fanuc-basic", "fanuc-pitch-feed"):
            with self.subTest(case=name):
                messages = self.messages(name)
                self.assertFalse(any("only the selection" in message for message in messages))

    def test_a_thread_pitch_above_a_selection_is_scaled_and_the_run_says_so(self):
        # The reviewer's own program: a G84 tapping cycle is still in force in the
        # repeat blocks, and a selection that starts at the repeats cannot know it.
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80},
            profile=profile,
            codes=helpers.load_codes(profile),
            input={"scope": "selection", "startLine": 6, "endLine": 9},
        )
        selection = "N60 X20. F1.5\nN70 X30. F1.5\nN80 G80\nN90 G1 X40. F0.25\n"
        result = helpers.run_script(SCRIPT, stdin=selection, context=context)
        self.assertTrue(result.ok, result.stderr)
        # The pitches are scaled — this run cannot tell that they are pitches — so the
        # warning at the head of the findings is the whole protection the user gets.
        self.assertEqual(result.json()["findings"][0]["line"], 6)
        self.assertIn("only the selection", result.json()["findings"][0]["message"])

    def test_klartext_rapid_is_a_keyword_and_is_never_scaled(self):
        lines = self.lines("klartext-basic")
        self.assertIn("5 L Z+100 R0 FMAX M3", lines)
        self.assertIn("10 L X+60 FAUTO", lines)
        self.assertIn("14 L Z+100 R0 FMAX M9", lines)

    def test_klartext_scales_the_feed_of_a_tool_call_and_of_a_move(self):
        lines = self.lines("klartext-basic")
        self.assertIn("4 TOOL CALL 6 Z S2000 F440", lines)
        self.assertIn("9 L Z-2 R0 F880", lines)
        self.assertIn("13 L IY+5 F550", lines)

    def test_a_feed_in_a_klartext_section_heading_is_not_a_feed(self):
        self.assertIn("8 * - MILL AT F800 ; NOT A COMMENT FEED", self.lines("klartext-basic"))

    def test_klartext_per_tooth_and_per_revolution_feeds_follow_the_option(self):
        default = self.lines("klartext-basic")
        self.assertIn("11 L Y+40 FZ0.05", default)
        self.assertIn("12 L X-10 FU0.12", default)
        messages = self.messages("klartext-basic")
        self.assertTrue(any("feed per tooth" in message for message in messages))
        self.assertTrue(any("feed per revolution" in message for message in messages))

        every = self.lines("klartext-per-revolution")
        self.assertIn("11 L Y+40 FZ0.06", every)
        self.assertIn("12 L X-10 FU0.13", every)

    def test_a_klartext_cycle_feed_is_listed_and_left_unchanged(self):
        payload = self.output("klartext-basic")
        self.assertIn("   Q206=180 ;PLUNGE FEED ~", payload["text"].split("\n"))
        listed = [f for f in payload["findings"] if "Q206" in f["message"]]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["line"], 10)
        self.assertIn("CYCL DEF 200", listed[0]["message"])

        # The tapping cycles: 206 declares a feed parameter, 207 declares a pitch.
        tapping = self.output("klartext-tapping")
        listed = [f for f in tapping["findings"] if f["message"].startswith("Q")]
        self.assertEqual([f["message"].split(" ")[0] for f in listed], ["Q206"])
        self.assertIn("   Q239=+1.25 ;THREAD PITCH ~", tapping["text"].split("\n"))

    # Review finding NC2 (2026-09): the tokenizer keeps a Klartext decimal comma in the
    # value's raw text, and `Decimal(raw)` raised: the script exited with a traceback at
    # every percentage. The run has to scale it and write the comma back.
    def test_a_klartext_comma_feed_is_scaled_and_keeps_its_comma(self):
        lines = self.lines("klartext-decimal-comma")
        self.assertIn("6 L Z-2,25 F250,3", lines)
        self.assertIn("8 L Y+50, F400,", lines)
        self.assertIn("7 L X+50 F500", lines)
        # With a feed limit the value is read too (`value_of`), so the limit applies.
        payload = self.output("klartext-decimal-comma-limit")
        limited = payload["text"].split("\n")
        self.assertIn("8 L Y+50, F1500,", limited)
        self.assertIn("6 L Z-2,25 F1001,0", limited)
        self.assertNotIn("without a limit check", payload["message"])

    # Review finding NC4 (2026-09): a block skip in front of the number turned a `*`
    # structure block into words, and the run rewrote the F and S inside its text.
    def test_a_skipped_klartext_heading_is_a_heading_and_left_alone(self):
        lines = self.lines("klartext-skipped-heading")
        self.assertIn("/1 * - SCHRUPPEN F500 S3000 TOOL 12", lines)
        self.assertIn("4 / * - SCHLICHTEN F800 S4000", lines)
        self.assertIn("/5 ; F500 S3000", lines)
        # A skipped block that moves is still scaled.
        self.assertIn("/6 L X+10 F250", lines)


class TestSelectionPriming(unittest.TestCase):
    """The M4 carry-over, fixed: a selection run reads the state above the selection.

    `ScriptContextInput.precedingLines` (plan section 7.5) carries the document lines above
    `startLine`. `gedit_nc.prime_tracker` walks them into the `FeedModeTracker` before the
    first editable block, so a `G95` or a `G84` that starts higher up is in force inside
    the selection exactly as it would be in a whole-document run.

    Every case here is checked **twice**: once as it ships, and once with the field taken
    back out. The second half is what makes these cases evidence — without it a golden
    proves only that the script is self-consistent, not that the priming does anything.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

    def primed(self, name):
        case = self.case(name)
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def unprimed(self, name):
        """The same run with `precedingLines` taken back out: the M4 behaviour."""
        case = self.case(name)
        context = context_of(case)
        self.assertIn("precedingLines", context["input"], "this case is not a primed one")
        context["input"] = {
            key: value for key, value in context["input"].items() if key != "precedingLines"
        }
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_selection_inside_a_tapping_cycle_refuses_the_pitches_it_inherited(self):
        payload = self.primed("fanuc-selection-primed")
        lines = payload["text"].split("\n")
        # The G84 stands on line 7, above the selection. Its repeat blocks carry the pitch.
        self.assertIn("X40. F625.", lines)
        self.assertIn("X60. F625.", lines)
        # G80 cancels the cycle inside the selection, so the feed after it is scaled.
        self.assertIn("G1 X80. F320.", lines)
        pitches = [f for f in payload["findings"] if "thread pitch (G84)" in f["message"]]
        self.assertEqual([f["line"] for f in pitches], [8, 9])

    def test_without_the_lines_above_it_the_same_selection_scales_those_pitches(self):
        payload = self.unprimed("fanuc-selection-primed")
        lines = payload["text"].split("\n")
        # 80 % of a 1.25 mm pitch tapped at 500 rpm: the thread is scrapped in silence
        # apart from the warning. This is the defect the priming removes.
        self.assertIn("X40. F500.", lines)
        self.assertIn("X60. F500.", lines)
        self.assertIn("only the selection", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["severity"], "warning")

    def test_a_selection_under_a_feed_mode_set_above_it_inherits_the_mode(self):
        payload = self.primed("fanuc-selection-per-revolution")
        lines = payload["text"].split("\n")
        self.assertIn("G1 X20. F0.15", lines)
        self.assertIn("X40. F0.2", lines)
        self.assertIn("G1 X60. F200.", lines)  # after the G94 inside the selection
        self.assertIn("2 left in another feed mode", payload["message"])

    def test_without_the_lines_above_it_the_same_selection_scales_the_per_revolution_feeds(self):
        payload = self.unprimed("fanuc-selection-per-revolution")
        lines = payload["text"].split("\n")
        # Read as feed per minute: 80 % of 0.15 mm/rev is written straight into the file.
        self.assertIn("G1 X20. F0.12", lines)
        # And 0.2 is scaled too — one written decimal rounds 0.16 back to 0.2, which the
        # run reports as a value it could not move rather than as a value it left alone.
        self.assertIn("X40. F0.2", lines)
        self.assertTrue(any("stays as it is" in f["message"] for f in payload["findings"]))
        self.assertFalse(any("feed per revolution" in f["message"] for f in payload["findings"]))

    def test_a_klartext_selection_inherits_the_cycle_and_the_continuation(self):
        payload = self.primed("klartext-selection-primed")
        # `CYCL DEF 200` stands above the selection and the selection begins in the middle
        # of its `~` parameter block: the cycle feed is still recognised and left alone.
        listed = [f for f in payload["findings"] if f["message"].startswith("Q206")]
        self.assertEqual(len(listed), 1)
        self.assertIn("CYCL DEF 200", listed[0]["message"])
        self.assertIn("6 L Z-2 R0 F550", payload["text"].split("\n"))

    def test_without_the_lines_above_it_the_klartext_cycle_feed_is_not_recognised(self):
        payload = self.unprimed("klartext-selection-primed")
        self.assertEqual([f for f in payload["findings"] if f["message"].startswith("Q206")], [])

    def test_a_primed_run_names_what_it_inherited_instead_of_warning(self):
        for name, needle in (
            ("fanuc-selection-primed", "the thread-pitch cycle G84"),
            ("fanuc-selection-per-revolution", "a feed per revolution (G95)"),
            ("klartext-selection-primed", "the cycle CYCL DEF 200"),
        ):
            with self.subTest(case=name):
                payload = self.primed(name)
                first = payload["findings"][0]
                self.assertEqual(first["severity"], "info")
                self.assertEqual(first["line"], context_of(self.case(name))["input"]["startLine"])
                self.assertIn("were read for the modal state", first["message"])
                self.assertIn(needle, first["message"])
                self.assertFalse(
                    any("cannot be recognised here" in f["message"] for f in payload["findings"]),
                    "a primed run has nothing to warn about",
                )

    def test_a_primed_run_that_inherited_nothing_says_nothing(self):
        """Above the selection is an ordinary G94 program: there is nothing to report."""
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 90},
            profile=profile,
            codes=helpers.load_codes(profile),
            input={
                "scope": "selection",
                "startLine": 4,
                "endLine": 4,
                "precedingLines": ["%", "O1000", "G21 G90 G94"],
            },
        )
        result = helpers.run_script(SCRIPT, stdin="G1 X10. F200.", context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "G1 X10. F180.")
        self.assertEqual(payload["findings"], [])

    def test_preceding_lines_that_are_not_all_the_lines_above_are_refused(self):
        """A truncated field is a wrong answer; an absent one is an honest warning.

        The contract tells the runner to omit `precedingLines` rather than truncate them
        when the text above the selection is too large to send. A tracker primed with the
        tail of a program is confidently wrong — here the `G84` fell off the front, so the
        pitch would be scaled while the run claimed to know the state. The length check in
        `gedit_nc.preceding_lines` turns that back into the M4 warning.
        """
        case = self.case("fanuc-selection-primed")
        context = context_of(case)
        context["input"]["precedingLines"] = context["input"]["precedingLines"][-3:]
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertIn("only the selection", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        self.assertEqual(payload["text"], self.unprimed("fanuc-selection-primed")["text"])

    def test_preceding_lines_are_ignored_when_the_run_is_not_a_selection(self):
        """A document run already starts at the top of the program."""
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params={"percent": 80},
            profile=profile,
            codes=helpers.load_codes(profile),
            input={
                "scope": "document",
                "startLine": 1,
                "endLine": 1,
                "precedingLines": ["G98 G84 X20. Z-12. R3. F625."],
            },
        )
        result = helpers.run_script(SCRIPT, stdin="G1 X10. F200.", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["text"], "G1 X10. F160.")


class TestCodeDatabase(unittest.TestCase):
    """The pitch rule is data, not a table of Fanuc numbers (`nc-transformations.md`)."""

    def run_with(self, codes, stdin, params=None):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(params=params or {"percent": 50}, profile=profile, codes=codes)
        result = helpers.run_script(SCRIPT, stdin=stdin, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_code_marked_pitch_feed_is_honoured_whatever_its_number(self):
        codes = [
            {"code": "G71", "group": "cycle", "pitchFeed": True, "params": [{"address": "F"}]},
            {"code": "G1", "group": "motion"},
        ]
        payload = self.run_with(codes, "G71 Z-10. F1.5\nG1 X10. F500.\n")
        self.assertEqual(payload["text"], "G71 Z-10. F1.5\nG1 X10. F250.\n")
        self.assertIn("thread pitch (G71)", payload["findings"][0]["message"])

    def test_the_same_code_is_a_plain_cycle_in_another_dialect(self):
        codes = [
            {"code": "G71", "group": "cycle", "params": [{"address": "F"}]},
            {"code": "G1", "group": "motion"},
        ]
        payload = self.run_with(codes, "G71 Z-10. F200.\nG1 X10. F500.\n")
        self.assertEqual(payload["text"], "G71 Z-10. F100.\nG1 X10. F250.\n")

    def test_a_run_without_a_code_database_says_what_it_could_not_know(self):
        payload = self.run_with([], "G84 X20. Z-12. R3. F625.\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        self.assertIn("no code database", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["line"], 1)


class TestHeader(unittest.TestCase):
    """The `# /// gedit` block, read the way `src-tauri/src/scripts/meta.rs` reads it.

    The backend parses it as TOML and hands the result to the webview as `ScriptMeta`
    (plan §7.6), so a header that does not parse, or a parameter that is not shaped like a
    `FieldSpec` (§7.5), breaks the script's form without breaking any Python.
    """

    FIELD_TYPES = ("number", "integer", "text", "bool", "choice", "file", "folder", "address-list")
    SCRIPT = SCRIPT
    NAME = "Scale feed rates"
    PARAMS = [
        "percent",
        "decimals",
        "minFeed",
        "maxFeed",
        "onlyAbove",
        "onlyBelow",
        # M9 (WP9.5a): the unit the four limit values are in.
        "limitUnit",
        "perRevolution",
        "inverseTime",
    ]

    def header_source(self):
        """The header block with its `# ` prefix removed, as the backend does it."""
        lines = (helpers.SCRIPTS_DIR / self.SCRIPT).read_text(encoding="utf-8").split("\n")
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
        self.assertEqual(meta["name"], self.NAME)
        self.assertEqual(meta["output"], "replace")
        self.assertEqual(meta["input"], "selection-or-document")
        # The result is the JSON envelope, so that a summary and findings come back too.
        self.assertIs(meta["envelope"], True)
        self.assertNotIn("profiles", meta)  # every dialect

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_every_parameter_is_shaped_like_a_field_spec(self):
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        self.assertEqual([param["id"] for param in params], self.PARAMS)
        for param in params:
            with self.subTest(param=param["id"]):
                self.assertIn(param["type"], self.FIELD_TYPES)
                self.assertTrue(param["label"])
                if param["type"] == "choice":
                    self.assertTrue(param["choices"])
                    for choice in param["choices"]:
                        self.assertEqual(sorted(choice), ["label", "value"])
                    values = [choice["value"] for choice in param["choices"]]
                    self.assertIn(param["default"], values)
                if param.get("required") is False:
                    self.assertNotIn("default", param, "an optional value starts empty")
                else:
                    self.assertIn("default", param)

    def test_the_declared_parameters_are_the_ones_the_script_reads(self):
        """A parameter the script does not read would be a silently dead control."""
        source = (helpers.SCRIPTS_DIR / self.SCRIPT).read_text(encoding="utf-8")
        body = source.split("# ///", 2)[-1]
        for name in self.PARAMS:
            with self.subTest(param=name):
                self.assertIn('"%s"' % name, body)


class TestRunEnvironment(unittest.TestCase):
    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self):
        result = helpers.run_script(SCRIPT, stdin="G1 F500.\n", context=None)
        self.assertFalse(result.ok)
        self.assertEqual(result.stdout, "")
        self.assertIn("profile", result.stderr)

    def test_a_profile_it_cannot_compile_is_a_message_and_not_a_traceback(self):
        profile = helpers.load_profile("fanuc-gcode")
        profile["toolCall"]["trigger"] = "M0*6(?!\\d"
        result = helpers.run_script(
            SCRIPT, stdin="G1 F500.\n", context=helpers.make_context(profile=profile, codes=[])
        )
        self.assertFalse(result.ok)
        self.assertIn("toolCall.trigger", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def context(self, params):
        profile = helpers.load_profile("fanuc-gcode")
        return helpers.make_context(params=params, profile=profile, codes=helpers.load_codes(profile))

    def refuses(self, params, needle):
        result = helpers.run_script(SCRIPT, stdin="G1 F500.\n", context=self.context(params))
        self.assertFalse(result.ok, result.stdout)
        self.assertEqual(result.stdout, "", "a refused run must not hand back text")
        self.assertIn(needle, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_a_percentage_of_zero_or_less_is_refused_rather_than_zeroing_the_program(self):
        self.refuses({"percent": 0}, "greater than zero")
        self.refuses({"percent": -50}, "greater than zero")

    def test_a_parameter_that_is_not_a_number_is_refused(self):
        self.refuses({"percent": "ninety"}, "Percentage")
        self.refuses({"maxFeed": "lots"}, "Largest feed")
        self.refuses({"decimals": "many"}, "Decimal places")

    def test_limits_the_wrong_way_round_are_refused(self):
        self.refuses({"minFeed": 900, "maxFeed": 100}, "larger than")

    def test_a_percentage_may_arrive_as_a_float_or_as_text(self):
        for percent in (97.5, "97.5"):
            with self.subTest(percent=percent):
                result = helpers.run_script(
                    SCRIPT, stdin="G1 F1000.\n", context=self.context({"percent": percent})
                )
                self.assertTrue(result.ok, result.stderr)
                payload = result.json()
                self.assertEqual(payload["text"], "G1 F975.\n")
                self.assertIn("97.5 %", payload["message"])

    def test_an_empty_document_comes_back_empty(self):
        result = helpers.run_script(SCRIPT, stdin="", context=self.context({"percent": 90}))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "")
        self.assertEqual(payload["findings"], [])
        self.assertEqual(payload["message"], "No feed rates found.")

    def test_the_last_line_keeps_its_ending_or_its_absence(self):
        for stdin in ("G1 F500.\n", "G1 F500.", "G1 F500.\n\n"):
            with self.subTest(stdin=stdin):
                result = helpers.run_script(SCRIPT, stdin=stdin, context=self.context({"percent": 90}))
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.json()["text"], stdin.replace("F500.", "F450."))

    def test_a_value_that_would_round_to_zero_is_left_as_it_is(self):
        result = helpers.run_script(
            SCRIPT, stdin="G1 F5\nG1 F500\n", context=self.context({"percent": 5})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "G1 F5\nG1 F25\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        # The finding names what was skipped and how the run got to zero, because the two
        # ways out are different: more decimal places, or a different limit.
        self.assertEqual(
            payload["findings"][0]["message"],
            "F5 is not scaled: 5 % of 5 is 0.25, which written with no decimals is 0, and "
            "a feed of zero is a block that does not cut, not a slow one. Ask for more "
            "decimal places to scale it.",
        )

    def test_a_value_a_zero_limit_would_zero_names_the_limit_and_not_the_rounding(self):
        result = helpers.run_script(
            SCRIPT, stdin="G1 F500.\n", context=self.context({"percent": 90, "maxFeed": 0})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "G1 F500.\n")
        self.assertEqual(
            payload["findings"][0]["message"],
            "F500. is not scaled: the largest feed is 0, and a feed of zero is a block "
            "that does not cut, not a slow one.",
        )

    def test_the_findings_are_capped_and_the_message_says_how_many_were_left_out(self):
        lines = ["G95"] + ["G1 X%d. F0.2" % n for n in range(300)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(len(payload["findings"]), 200)
        self.assertIn("100 further notes are not listed.", payload["message"])
        self.assertEqual(payload["text"], "\n".join(lines) + "\n")

    def test_a_large_program_is_scaled_in_one_pass(self):
        """One pass over the tokens, not one per value.

        `helpers.run_script` kills a run after a minute, so a walk that turned quadratic
        would fail here rather than in a user's 100,000-line program.
        """
        lines = ["G94"] + ["N%d G1 X%d. F1200." % (n * 10, n % 400) for n in range(20000)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(
            payload["message"], "Scaled 20,000 feed rates to 90 %. No machine: profile defaults assumed."
        )
        self.assertEqual(payload["text"].count("F1080."), 20000)
        self.assertEqual(payload["findings"], [])

    def test_the_findings_come_back_in_line_order(self):
        for case in helpers.script_cases("scale_feed"):
            with self.subTest(case=case.name):
                findings = envelope_of(case)["findings"]
                self.assertEqual(
                    [finding["line"] for finding in findings],
                    sorted(finding["line"] for finding in findings),
                )

    def test_the_result_is_json_the_app_can_read(self):
        case = next(c for c in helpers.script_cases("scale_feed") if c.name == "fanuc-basic")
        result = run_case(case)
        payload = json.loads(result.stdout)
        self.assertIsInstance(payload["text"], str)
        self.assertNotIn("\r", payload["text"], "the app puts the line ending back itself")
        self.assertTrue(result.stdout.endswith("\n"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


class TestLathe(unittest.TestCase):
    """Turning (M6, WP6.6): the feed unit, the thread leads, the machine and the limits.

    Every claim here is checked against the golden of its own case **and** stated in one
    sentence, so that a fixture regenerated by hand cannot quietly change what the script
    does. The programs are the synthetic turning fixtures of `tests/fixtures/nc/fanuc-lathe`;
    what a Fanuc lathe does with a code comes from `docs/planning/syntax/syntax-fanuc.md`
    through `src/lib/data`, never from this file.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

    def output(self, name):
        """The golden of a case, re-checked against a live run."""
        case = self.case(name)
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def lines(self, name):
        return self.output(name)["text"].split("\n")

    def messages(self, name):
        return [finding["message"] for finding in self.output(name)["findings"]]

    # -- the feed unit ------------------------------------------------------

    def test_a_feed_per_revolution_is_scaled_on_a_lathe_without_being_asked(self):
        # The option is auto / yes / no, and auto follows the profile's `machineType`. On a
        # turning profile nearly every feed is a feed per revolution: a run that skipped
        # them by default, as the mill default does, would do nothing at all and say so in
        # a sentence nobody reads.
        lines = self.lines("lathe-turning")
        self.assertIn("G71 P100 Q200 U0.4 W0.1 F0.23", lines)
        self.assertIn("N110 G01 Z0. F0.11", lines)
        self.assertIn("G83 Z-15. R2. Q3000 F0.07", lines)

    def test_the_option_still_says_no_and_the_finding_names_the_code_in_force(self):
        payload = self.output("lathe-per-revolution-no")
        self.assertEqual(payload["text"], self.case("lathe-per-revolution-no").input_text())
        skipped = [f for f in payload["findings"] if "per revolution" in f["message"]]
        self.assertEqual([f["line"] for f in skipped], [16, 18, 50])
        for finding in skipped:
            # G99, not G95: `FeedModeTracker` calls the mode `G95` whatever code the
            # dialect writes for it, and a finding that named the mill's code would send
            # the reader looking for a G95 that is not in the program (F24).
            self.assertIn("a feed per revolution (G99)", finding["message"])
            self.assertNotIn("G95", finding["message"])

    def test_the_power_on_feed_mode_holds_before_the_program_states_one(self):
        """A lathe that never writes a feed mode is still in feed per revolution.

        `FeedModeTracker` is built from a code database alone and starts in feed per
        minute, which is a milling control's power-on state. The effective profile's
        `modal.initial` is what this control powers on in (AD-19 rule 8), and the run reads
        it — otherwise a program that leaves the feed mode to the control would have its
        feeds read as millimetres per minute and, with the option set to no, scaled anyway.
        """
        context = helpers.effective_context("fanuc-lathe", params={"percent": 90, "perRevolution": "no"})
        program = "G00 X40. Z2.\nG01 Z-10. F0.25\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], program, "a per-revolution feed was scaled")
        self.assertIn("a feed per revolution (G99)", payload["findings"][0]["message"])

    def test_the_feeds_inside_a_g71_profile_are_ordinary_feeds(self):
        # G70-G73 are one-shot cycles on this control (AD-19 rule 2): the `F` of the cycle
        # block is the roughing feed, and the blocks between `P` and `Q` are ordinary moves
        # whose feeds belong to the finishing pass. None of them is a thread lead.
        payload = self.output("lathe-turning")
        for line in (16, 18):
            self.assertFalse(
                any(f["line"] == line for f in payload["findings"]),
                "line %d was refused" % line,
            )

    def test_a_thread_lead_is_never_scaled_and_the_finding_names_its_code(self):
        payload = self.output("lathe-turning")
        lines = payload["text"].split("\n")
        # G76 (the second block of the two-block form), the modal G92 pass and G32.
        self.assertIn("G76 X18.16 Z-18. P920 Q250 F1.5", lines)
        self.assertIn("G92 X19.4 Z-18. F1.5", lines)
        self.assertIn("G32 Z-18. F1.5", lines)
        pitches = [f for f in payload["findings"] if "thread pitch" in f["message"]]
        self.assertEqual([f["line"] for f in pitches], [33, 35, 41])
        for finding, code in zip(pitches, ("G76", "G92", "G32")):
            self.assertEqual(finding["severity"], "warning")
            self.assertIn("thread pitch (%s)" % code, finding["message"])

    def test_a_lathe_lead_is_refused_outright_and_not_as_an_ambiguous_code(self):
        """On the mill profile `G76` and `G92` are ambiguous; on the lathe they are leads.

        The mill database marks them `pitchFeedAmbiguous` because a turning program opened
        with the mill profile gives nothing away. The lathe database says what they are, so
        the refusal is the plain thread-pitch one and the reader is not told to go and
        decide something the profile already knows.
        """
        for message in self.messages("lathe-turning"):
            self.assertNotIn("another G-code system", message)

    # -- the G-code system is the machine's ---------------------------------

    def test_system_b_leaves_the_thread_lead_of_its_own_threading_cycle_alone(self):
        payload = self.output("lathe-system-b")
        self.assertIn("G78 X29.4 Z-25. F2.0", payload["text"].split("\n"))
        self.assertIn("G77 X38. Z-40. F0.27", payload["text"].split("\n"))
        leads = [f for f in payload["findings"] if "thread pitch" in f["message"]]
        self.assertEqual([f["line"] for f in leads], [22, 26])
        self.assertIn("thread pitch (G78)", leads[0]["message"])

    def test_a_system_b_thread_lead_survives_being_read_as_system_a(self):
        """The wrong machine used to be silent here; G8 M6 made it refuse instead.

        `G78` is the threading cycle of G-code system B and is not a code of system A at
        all, so a document whose machine says A — or a detection that answered A, which a
        B program without a `G92 S` clamp can easily produce — read `G78 X29.4 Z-25. F2.0`
        as an unknown code with an ordinary feed and wrote 90 % of a 2 mm lead into the
        file. The system-A database now carries G77, G78 and G79 with
        `pitchFeedAmbiguous` on the threading one, so the refusal no longer depends on
        which system detection picked: refusing a real feed costs one edit by hand,
        scaling a lead cuts a different thread.
        """
        a = self.output("lathe-system-b-as-a")
        b = self.output("lathe-system-b")
        self.assertIn("G78 X29.4 Z-25. F2.0", a["text"].split("\n"))
        self.assertIn("G78 X29.4 Z-25. F2.0", b["text"].split("\n"))
        # Read as A the reason is the ambiguity, read as B it is the code itself.
        self.assertTrue(any("G78" in f["message"] for f in a["findings"]))
        self.assertTrue(any("thread pitch (G78)" in f["message"] for f in b["findings"]))
        # Everything else about the two runs is the same, which is what makes the point.
        self.assertIn("G77 X38. Z-40. F0.27", a["text"].split("\n"))
        self.assertTrue(any("thread pitch (G33)" in f["message"] for f in a["findings"]))

    # -- the machine's number reading ---------------------------------------

    def test_the_decimal_point_changes_nothing_about_scaling(self):
        """`F155` becomes `F140` under IS-B, under calculator input and with no machine.

        Scaling is unit-free in all three readings — the literal is multiplied, and the
        value is the literal times a constant — so the machine never changes the digits
        that are written. It changes what those digits are **worth**, which is the limits'
        business and nothing else's (AD-31, F48).
        """
        for name in ("lathe-decimal-is-b", "lathe-decimal-calculator", "lathe-decimal-no-machine"):
            with self.subTest(case=name):
                lines = self.lines(name)
                self.assertIn("G01 Z-10 F140", lines)
                self.assertIn("G01 Z-10. F140.", lines)

    def test_a_machine_case_really_runs_against_that_machine(self):
        """The guard on the generated fixtures: the case's machine must reach the run.

        `tests/unit/resolved.test.ts` keys an effective entry by the machine's **parameters**
        alone, so a machine that picks exactly the profile's defaults — `lathe-decimal-
        calculator`, whose preset is the lathe's default — shares its file with the
        "no machine" entry of the same profile, and which of the two is written depends on
        the order the goldens are walked in. It is right today; this asserts it rather than
        trusting it, because the difference is invisible in the text and decides whether a
        value is resolved from the machine or from "every preset agrees" (AD-31).
        """
        for name, source in (
            ("lathe-decimal-is-b", "machine"),
            ("lathe-decimal-calculator", "machine"),
            ("lathe-feed-limit-machine", "machine"),
            ("lathe-decimal-no-machine", "profile"),
            ("lathe-system-b", "profile"),
        ):
            with self.subTest(case=name):
                machine = context_of(self.case(name))["machine"]
                self.assertEqual(machine["source"]["numberInput"], source)

    def test_the_limits_compare_what_the_machine_reads(self):
        """A largest feed of 0.2 is 0.2 mm/rev, not the literal 0.2 (F48).

        On this machine a feed word written without a decimal point is a count of 0.001 mm
        increments, so `F250` is 0.25 mm/rev; 120 % of it is 0.3, which is over the limit,
        and the limit is written back into the word's own form as `F200`. The two feeds that
        stay under it are scaled as written.
        """
        payload = self.output("lathe-feed-limit-machine")
        lines = payload["text"].split("\n")
        self.assertIn("G01 Z-10. F186", lines)
        self.assertIn("G01 X38. F200", lines)
        self.assertIn("G01 Z-20. F0.14", lines)
        self.assertEqual(
            payload["findings"][0]["message"],
            "F250 would become 300; the largest feed (0.2) was used instead, written as 200.",
        )
        self.assertIn("Machine 'Lathe 2'.", payload["message"])

    def test_with_no_machine_a_point_less_feed_per_revolution_is_not_limited(self):
        """M9 (WP9.5a), changed: the same program with no machine is scaled without the limit.

        With no machine a word keeps a value only where every preset the profile declares
        reads it alike (AD-31). Until M9 the three Fanuc presets read every feed as written,
        so `F250` passed as 250 mm/rev and the limit of 200 clamped it. A control without
        calculator-type input counts a point-less feed per revolution in 0.01 mm/rev, so the
        increment presets read `F250` as 2.5 mm/rev and the calculator one as 250: nothing
        is settled, the word is scaled (`F300`) and the limit is left out of it, loudly.
        """
        payload = self.output("lathe-feed-limit-no-machine")
        self.assertIn("G01 X38. F300", payload["text"].split("\n"))
        unresolved = [f for f in payload["findings"] if f["message"].startswith("F250 is scaled")]
        self.assertEqual(len(unresolved), 1)
        self.assertIn("depends on the machine (250 (As written", unresolved[0]["message"])
        self.assertIn("2.5 (Increments of 0.001 mm (IS-B)", unresolved[0]["message"])
        self.assertIn("No machine: profile defaults assumed.", payload["message"])

    def test_a_feed_in_another_unit_is_scaled_but_never_limited(self):
        """A feed per tooth and a feed per revolution are not lengths per minute.

        The words are still scaled — multiplying them is right in every reading — but the
        limits, which are per minute on a milling profile, are not applied to them and the
        run says so. M9 (WP9.5a), changed: until M9 the per-revolution `FU0.12` was
        compared with a "largest feed" of 900 meant per minute (it passed only because 0.14
        is smaller), and the per-tooth `FZ0.05` was reported as having no value at all; both
        are now named by their unit, the limits' own unit beside it.
        """
        payload = self.output("klartext-no-value-limit")
        lines = payload["text"].split("\n")
        self.assertIn("5 L Y+40 FZ0.06", lines)
        self.assertIn("4 L X+0 Y+0 F900", lines)  # clamped to the limit
        self.assertIn("6 L X-10 FU0.14", lines)  # per revolution: scaled, never compared
        for word, unit in (("FZ0.05", "a feed per tooth"), ("FU0.12", "a feed per revolution")):
            found = [f for f in payload["findings"] if word in f["message"]]
            self.assertEqual(len(found), 1, word)
            self.assertEqual(found[0]["severity"], "warning")
            self.assertIn("the feed limits were not applied to it: it is %s" % unit, found[0]["message"])
            self.assertIn("the limits are for feeds per minute", found[0]["message"])
        self.assertIn("2 scaled without the limits, which are for feeds per minute", payload["message"])

    def test_a_run_without_a_limit_says_nothing_about_a_value_it_never_needed(self):
        """The same program with no limit: no finding, because nothing was compared."""
        case = self.case("klartext-no-value-limit")
        context = context_of(case)
        context["params"] = {"percent": 120, "perRevolution": "yes"}
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["findings"], [])

    def test_the_machine_decides_whether_a_value_may_be_given_a_decimal_point(self):
        """The machine reaches every Phase 1 number rule through the effective profile.

        `applyMachine` sets `syntax.decimalPointSignificant` from the length class's reading
        (AD-31): on a control with increment input a point-less word is a count of
        increments, and giving it a point multiplies what the control reads by a thousand —
        so a run that asks for two decimals rounds such a value whole instead and says so.
        With calculator-type input, which is what the lathe profile defaults to, `F155` and
        `F155.` are the same number and the decimals are written. Nothing in this script
        decides that; it reads `syntax.decimalPointSignificant` as it did in Phase 1.
        """
        case = self.case("lathe-decimal-is-b")
        program = "G99\nG01 Z-10. F155\n"
        for name, expected in (("lathe-decimal-is-b", "F140"), ("lathe-decimal-calculator", "F139.50")):
            with self.subTest(case=name):
                context = context_of(self.case(name))
                context["params"] = {"percent": 90, "decimals": "2"}
                result = helpers.run_script(SCRIPT, stdin=program, context=context)
                self.assertTrue(result.ok, result.stderr)
                payload = result.json()
                self.assertEqual(payload["text"], "G99\nG01 Z-10. %s\n" % expected)
        self.assertTrue(case.expected_file.is_file())

    def test_the_summary_names_the_machine_or_says_there_is_none(self):
        self.assertIn("Machine 'Lathe IS-B'.", self.output("lathe-decimal-is-b")["message"])
        self.assertIn("Machine 'Lathe B'.", self.output("lathe-system-b")["message"])
        self.assertIn(
            "No machine: profile defaults assumed.", self.output("lathe-turning")["message"]
        )

    # -- the option, as older contexts send it ------------------------------

    def test_a_context_that_still_sends_a_boolean_is_honoured(self):
        """`perRevolution` was a `bool` in Phase 1 (F33).

        The form engine turns a remembered `false` into the new field's default, so the app
        never sends one; a hand-written or older context still can, and a run that said
        `true` or `false` meant it.
        """
        program = "G99\nG01 Z-10. F0.25\n"
        for value, expected in ((True, "G01 Z-10. F0.23"), (False, "G01 Z-10. F0.25")):
            with self.subTest(perRevolution=value):
                context = helpers.effective_context(
                    "fanuc-lathe", params={"percent": 90, "perRevolution": value}
                )
                result = helpers.run_script(SCRIPT, stdin=program, context=context)
                self.assertTrue(result.ok, result.stderr)
                self.assertIn(expected, result.json()["text"].split("\n"))


class TestTurningDialects(unittest.TestCase):
    """Okuma OSP and Sinumerik turning (M8, WP8.7): the words a naive script would scale.

    Each dialect has its own ways of writing a number that is not a feed rate — a dwell in
    `F`, a thread lead in `F` on one control and in `K` on the other, a feed that is a
    parameter, a cycle that carries its feeds as arguments — and a unit system that decides
    what a written feed is worth. Every rule below is the database's or the profile's, never
    a dialect name in the script; the cases say what that data makes of real-looking code.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

    def output(self, name):
        """The golden of a case, re-checked against a live run."""
        case = self.case(name)
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def line(self, name, number):
        return self.output(name)["text"].split("\n")[number - 1]

    def findings_on(self, name, number):
        return [f for f in self.output(name)["findings"] if f["line"] == number]

    def test_a_dwell_time_is_never_scaled_and_is_not_counted_as_a_feed(self):
        # `fNotFeed`: the F of Okuma `G04` and of Sinumerik `G4` is the time the tool waits.
        for name, number, text in (("okuma-turning", 15, "G04 F1"), ("sinumerik-turning", 10, "N70 G4 F1.5")):
            with self.subTest(case=name):
                self.assertEqual(self.line(name, number), text)
                self.assertEqual(self.findings_on(name, number), [])
                self.assertIn("1 dwell time left as written", self.output(name)["message"])
        # Seven feed words on the Okuma program, not eight: the dwell is none of them.
        self.assertIn("Scaled 3 of 7 feed rates", self.output("okuma-turning")["message"])

    def test_okuma_g71_is_a_thread_cycle_and_its_lead_is_left(self):
        # On a Fanuc lathe G71 is a roughing cycle whose F is an ordinary feed; here it cuts
        # a thread and F2 is the lead (`pitchFeed` on the Okuma database).
        self.assertEqual(
            self.line("okuma-turning", 21), "G71 X27.55 Z-30 B60 D0.7 U0.1 H2.45 L2 F2 M23 M32 M73"
        )
        (finding,) = self.findings_on("okuma-turning", 21)
        self.assertIn("thread pitch (G71)", finding["message"])
        # A pass block that writes only X is still a pass of the G33 thread above it.
        self.assertEqual(self.line("okuma-turning", 23), "X28.9")
        self.assertIn("thread pitch (G184)", self.findings_on("okuma-turning", 43)[0]["message"])

    def test_a_feed_written_as_a_variable_or_a_parameter_is_left(self):
        for name, number, word in (("okuma-turning", 30, "F=V1"), ("sinumerik-turning", 13, "F=R1")):
            with self.subTest(case=name):
                self.assertIn(word, self.line(name, number))
                (finding,) = self.findings_on(name, number)
                self.assertEqual(finding["message"], "%s is not a plain number, so it is not scaled." % word)

    def test_the_lead_of_a_sinumerik_thread_is_not_an_f_word(self):
        # G33 writes its lead in K. Nothing in that block is a feed word, so nothing moves.
        self.assertEqual(self.line("sinumerik-turning", 18), "N150 G33 Z-24 K1.5 SF=0")
        self.assertEqual(self.findings_on("sinumerik-turning", 18), [])

    def test_the_unit_system_decides_what_a_limit_compares(self):
        """Every number is a count of the unit, point or not (syntax-okuma.md §3.3).

        Under 1 µm `F250` and `F234.56` are 0.25 and 0.23456 mm/rev; under 10 µm `F25` and
        `F23.456` are the same two feeds. A largest feed of 0.2 mm/rev clamps both, and the
        clamp is written back in each word's own form, a point-less word point-less.
        """
        one = self.output("okuma-feed-limit-1um")["text"].split("\n")
        self.assertEqual((one[10], one[13], one[14]), ("G95 G01 Z200 F200", "G01 X50000 Z-30000 F200.00", "X52000 F165"))
        ten = self.output("okuma-feed-limit-10um")["text"].split("\n")
        self.assertEqual((ten[10], ten[13], ten[14]), ("G95 G01 Z20 F20", "G01 X5000 Z-3000 F20.000", "X5200 F17"))
        for name, machine in (("okuma-feed-limit-1um", "Lathe 3"), ("okuma-feed-limit-10um", "Lathe 4")):
            with self.subTest(case=name):
                message = self.output(name)["message"]
                self.assertIn("2 clamped to a limit", message)
                self.assertIn("Machine '%s'." % machine, message)
                # G04 F200 waits 2 s under 1 µm, G04 F20 2 s under 10 µm; neither is a feed.
                self.assertIn("1 dwell time left as written", message)

    def test_with_no_machine_no_okuma_feed_has_a_value_and_no_limit_applies(self):
        payload = self.output("okuma-feed-limit-no-machine")
        lines = payload["text"].split("\n")
        self.assertEqual((lines[10], lines[13], lines[14]), ("G95 G01 Z200 F275", "G01 X50000 Z-30000 F258.02", "X52000 F165"))
        self.assertEqual([f["line"] for f in payload["findings"]], [11, 14, 15])
        for finding in payload["findings"]:
            self.assertEqual(finding["severity"], "warning")
            self.assertIn("depends on the machine", finding["message"])
        self.assertIn("3 scaled without a limit check", payload["message"])
        self.assertIn("No machine: profile defaults assumed.", payload["message"])

    def test_the_feeds_of_a_cycle_written_as_a_call_are_listed_and_left(self):
        self.assertEqual(self.line("sinumerik-turning", 23), "N200 CYCLE85(5,0,2,-20,,0.5,80,200)")
        messages = [f["message"] for f in self.findings_on("sinumerik-turning", 23)]
        self.assertEqual(len(messages), 2)
        self.assertIn("Argument 7 of CYCLE85 (FFR, feed on the way in) is 80", messages[0])
        self.assertIn("Argument 8 of CYCLE85 (RFF, feed on the way out) is 200", messages[1])
        self.assertIn("2 cycle feeds left unchanged", self.output("sinumerik-turning")["message"])

    def test_the_feed_a_tapping_call_runs_with_is_left_as_written(self):
        # CYCLE840 without a spindle encoder (ENC = 1) taps with the programmed F, which is
        # the speed times the pitch: 500 rpm x 1.5 = F750. A call stands in a block of its
        # own, so that F is on another line, and it is the one that must not move.
        self.assertEqual(self.line("sinumerik-turning", 26), "N230 F750")
        (finding,) = self.findings_on("sinumerik-turning", 26)
        self.assertEqual(finding["severity"], "warning")
        self.assertIn("F750 is the feed in force when CYCLE840 runs on line 27", finding["message"])
        self.assertEqual(self.findings_on("sinumerik-turning", 27), [])
        self.assertIn("1 left as the possible lead of a tapping cycle", self.output("sinumerik-turning")["message"])
        # The same in feed per revolution, written with two decimals: `F1` is a 1 mm pitch.
        payload = self.output("sinumerik-cycle840-per-rev")
        self.assertEqual(payload["text"].split("\n")[1], "N390 F1")
        self.assertEqual([f["line"] for f in payload["findings"]], [2])

    def test_a_modal_tapping_call_protects_every_feed_until_it_ends(self):
        payload = self.output("sinumerik-mcall-tapping")
        lines = payload["text"].split("\n")
        self.assertEqual((lines[4], lines[7]), ("N50 F500", "N80 X40 Y0 F520"))
        self.assertIn("F520 is written while CYCLE840 (line 6) repeats after every move", payload["findings"][1]["message"])
        # After `MCALL` on its own, and under a modal drilling cycle, feeds are feeds.
        self.assertEqual((lines[9], lines[13], lines[16]), ("N100 G1 X60 F400", "N140 F96", "N170 X40 Y20 F80"))
        self.assertEqual([f["line"] for f in payload["findings"]], [5, 8])

    def test_a_call_whose_lead_is_its_own_argument_leaves_the_feed_in_force_alone(self):
        # CYCLE84 (rigid tapping) and CYCLE99 (thread turning) take the lead from their own
        # arguments: the feed before them is an ordinary feed and is scaled.
        context = helpers.effective_context("sinumerik", params={"percent": 50})
        program = (
            "N10 G95 F0.2\nN20 CYCLE84(5,0,2,-15,,0.5,3,,1.5,,500,500)\n"
            "N30 F0.4\nN40 CYCLE99(0,40,-30,40,2,1,0.92,0.05,30,0,5,1,1.5,1300101,1)\n"
        )
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "N10 G95 F0.1\nN20 CYCLE84(5,0,2,-15,,0.5,3,,1.5,,500,500)\nN30 F0.2\nN40 CYCLE99(0,40,-30,40,2,1,0.92,0.05,30,0,5,1,1.5,1300101,1)\n")
        self.assertEqual(payload["findings"], [])

    def test_the_lead_carriers_are_found_before_the_first_word_is_scaled(self):
        helpers.import_gedit_nc()
        import gedit_nc
        import scale_feed

        profile = helpers.load_profile("sinumerik")
        cp = gedit_nc.compile_profile(profile)
        codes = helpers.load_codes(profile)
        params = scale_feed.Params({"percent": 80}, profile)
        lines = ["F100", "G4 F2", "CYCLE840(5,0,2,-15,,0,3,3,1,,1)", "F=R1", "CYCLE840(5,0,2,-15,,0,3,3,1,,1)"]
        carriers = scale_feed.lead_carriers(lines, cp, codes, params, None, 1)
        # The dwell's F is a time and never the feed in force; `F=R1` is no number to keep.
        self.assertEqual(carriers, {(0, 0): ("CYCLE840", 3, "in-force")})
        # The walk is skipped only when no such call is named anywhere, and the name is
        # compared as the control reads it, whatever its case.
        lower = ["f100", "cycle840(5,0,2,-15,,0,3,3,1,,1)"]
        self.assertEqual(scale_feed.lead_carriers(lower, cp, codes, params, None, 1), {(0, 0): ("CYCLE840", 2, "in-force")})
        rigid = ["F100", "CYCLE84(5,0,2,-15,,0.5,3,,1.5,,500,500)"]
        self.assertEqual(scale_feed.lead_carriers(rigid, cp, codes, params, None, 1), {})
        # A profile whose tokenizer writes no calls pays nothing.
        fanuc = helpers.load_profile("fanuc-gcode")
        self.assertEqual(
            scale_feed.lead_carriers(["F100", "G84 Z-10"], gedit_nc.compile_profile(fanuc), helpers.load_codes(fanuc), scale_feed.Params({}, fanuc), None, 1),
            {},
        )

    def test_the_lead_change_of_a_variable_lead_thread_is_never_scaled(self):
        payload = self.output("sinumerik-variable-lead")
        self.assertEqual(payload["text"], self.case("sinumerik-variable-lead").input_text())
        self.assertEqual(
            [f["message"][:40] for f in payload["findings"]],
            ["F0.05 is a thread pitch (G34), not a fee", "F0.04 is a thread pitch (G35), not a fee"],
        )
        # With G33 still modal the finding names the block's own code.
        messages = [f["message"] for f in self.output("sinumerik-variable-lead-under-g33")["findings"]]
        self.assertIn("(G34)", messages[0])
        self.assertIn("(G35)", messages[1])

    def test_a_travel_time_after_g931_is_left_and_reported(self):
        # M9 review F8: G931 stood in no database, so its F words were halved as feeds and
        # the moves ran twice as fast, with nothing said. No option scales a time, not even
        # "also scale inverse-time feeds".
        payload = self.output("sinumerik-g931")
        lines = payload["text"].split("\n")
        self.assertEqual(lines[5:8], ["N40 G1 X100 F4", "N50 X200 F2", "N60 G931 G1 X300 F3"])
        self.assertEqual((lines[3], lines[8]), ("N20 G1 X0 Y0 F500", "N70 G94 F500"))
        self.assertEqual(
            [f["message"] for f in payload["findings"]],
            ["F%s is a travel time, not a feed rate (G931), so it is not scaled." % v for v in ("4", "2", "3")],
        )

    def test_the_feed_of_a_g63_tap_is_left(self):
        payload = self.output("sinumerik-g63")
        self.assertEqual(payload["text"].split("\n")[2], "N190 G63 Z-20 F500 S400 M3")
        self.assertIn("F500 is a thread pitch (G63)", payload["findings"][0]["message"])

    def test_a_finding_names_the_block_code_before_the_modal_one(self):
        (first, second) = self.output("okuma-thread-after-g32")["findings"]
        self.assertIn("(G32)", first["message"])
        self.assertIn("(G71)", second["message"])

    def test_on_this_control_g96_is_a_feed_per_revolution(self):
        payload = self.output("sinumerik-feed-type")
        self.assertEqual(payload["text"].split("\n")[3], "N40 G1 Z-20 F96")
        self.assertEqual(
            [f["message"] for f in payload["findings"]][:2],
            ["F0.25 is a feed per revolution (G96), so it is not scaled.", "F0.3 is a feed per revolution (G96), so it is not scaled."],
        )

    def test_the_turning_cycles_list_their_feeds(self):
        payload = self.output("sinumerik-cycle-feeds-only")
        self.assertEqual(payload["message"], "No feed rates found; 5 cycle feeds left unchanged.")
        self.assertEqual([f["line"] for f in payload["findings"]], [1, 1, 1, 2, 2])

    def test_the_finishing_feed_at_the_end_of_a_contour_call_is_listed_too(self):
        # CYCLE952 written out in full: argument 34 is the feed of the finishing cut when
        # one call roughs and finishes. It is a cycle feed like arguments 5 and 6.
        context = helpers.effective_context("sinumerik", params={"percent": 80})
        call = (
            'N30 CYCLE952("CONT_3","","",2101311,0.3,0.15,0,2,1,1,0.2,0.1,0.2,0,1,1,0,0,0,'
            "0,0,0,0,1,0,0,1,0,100,200,1,0,0,0.12)"
        )
        program = "N10 G95\nN20 CYCLE62(\"KONTUR\",1,,)\n%s\n" % call
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], program)
        messages = [f["message"] for f in payload["findings"] if f["line"] == 3]
        self.assertEqual([m.split(" (")[0] for m in messages], ["Argument 5 of CYCLE952", "Argument 6 of CYCLE952", "Argument 34 of CYCLE952"])
        self.assertIn("(_FS, feed for the finishing cut when one call roughs and finishes) is 0.12", messages[2])
        self.assertIn("3 cycle feeds left unchanged", payload["message"])

    def test_a_feed_under_an_address_of_its_own_is_reported(self):
        payload = self.output("sinumerik-cycle-feeds")
        self.assertIn("2 feeds under addresses of their own left as written (FRC=, FRCM=)", payload["message"])
        self.assertTrue(payload["findings"][-1]["message"].startswith("FRCM=0.08 is a feed under an address of its own"))
        okuma = self.output("okuma-feeds-of-their-own")
        self.assertEqual(okuma["text"].split("\n")[:2], ["G85 NAT01 D4 F0.24", "$ G84 XA=60 DA=2 FA=0.2 FB=0.15"])
        self.assertIn("(FA=, FB=)", okuma["message"])

    def test_a_factor_of_the_feed_is_not_listed_as_a_feed(self):
        # FRF multiplies the feed for the first peck; it follows the feed it multiplies.
        helpers.import_gedit_nc()
        import scale_feed  # the bundled folder is on sys.path now

        self.assertIsNone(scale_feed.CALL_FEED_LABEL.search("Feed factor for the first peck"))
        self.assertIsNotNone(scale_feed.CALL_FEED_LABEL.search("Feed on the way in"))
        self.assertEqual(
            scale_feed.call_arguments('5,0,2,-30,,-8,"A,B",AC(1,2),[R1,2]'),
            ["5", "0", "2", "-30", "", "-8", '"A,B"', "AC(1,2)", "[R1,2]"],
        )
        self.assertEqual(scale_feed.call_arguments(None), [])

    def test_an_indexed_assignment_is_a_value_and_never_a_code(self):
        # M9 review F1: `M[2]=3` read as the code M3 and `FA[X]=100` as the word FA100,
        # because the text in front of the `=` carries the bracket.
        gedit_nc = helpers.import_gedit_nc()
        import scale_feed

        cp = gedit_nc.compile_profile(helpers.effective_context("sinumerik")["profile"])
        for text in ("M[2]=3", "S[2]=500", "LIMS[2]=1800", "FA[X]=100", "M3=3", "F=R1"):
            tokens, _ = gedit_nc.tokenize_line(text, cp, None)
            with self.subTest(text=text):
                self.assertTrue(scale_feed.assignment_word(tokens[0]))
        tokens, _ = gedit_nc.tokenize_line("M3", cp, None)
        self.assertFalse(scale_feed.assignment_word(tokens[0]))


class TestLeadsTheDatabaseKnows(unittest.TestCase):
    """2026-09: TODO Next up 8, the first two items of Next up 2, R10 and review §6.

    Every rule is the database's: a lead of a code it marks ``pitchFeed`` (G84.2, G84.3, the
    tapping mode G63), a block whose words are data (``wordsAreData``: G65, G66, G10), and a
    code it does not know at all, under the letter it writes its moves with.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

    def output(self, name):
        case = self.case(name)
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def rows(self, name):
        return {f["line"]: f["message"] for f in self.output(name)["findings"]}

    def test_the_older_format_rigid_taps_keep_their_lead(self):
        lines = self.output("fanuc-leads-the-database-knows")["text"].split("\n")
        self.assertEqual(lines[6], "G98 G84.2 X20. Y10. Z-15. R3. F900.")
        self.assertEqual(lines[9], "G98 G84.3 X60. Y10. Z-15. R3. F900.")
        rows = self.rows("fanuc-leads-the-database-knows")
        self.assertIn("F900. is a thread pitch (G84.2)", rows[7])
        self.assertIn("F900. is a thread pitch (G84.3)", rows[10])

    def test_the_tapping_mode_keeps_every_feed_until_the_cutting_mode(self):
        lines = self.output("fanuc-leads-the-database-knows")["text"].split("\n")
        self.assertEqual(lines[14:17], ["G63 G1 Z-12. F500.", "G1 Z3. F500.", "G64 G1 X70. F640."])
        rows = self.rows("fanuc-leads-the-database-knows")
        self.assertIn("F500. is a thread pitch (G63)", rows[15])
        self.assertIn("F500. is a thread pitch (G63)", rows[16])

    def test_the_arguments_of_a_macro_call_are_no_feed(self):
        payload = self.output("fanuc-leads-the-database-knows")
        self.assertIn("G65 P9810 Z-5. F3000.", payload["text"].split("\n"))
        self.assertIn("F3000. is an argument or a data value of G65", self.rows("fanuc-leads-the-database-knows")[18])
        self.assertIn("1 argument or data word left as written", payload["message"])

    def test_a_feed_under_a_code_the_database_does_not_know_is_reported_not_scaled(self):
        payload = self.output("fanuc-leads-the-database-knows")
        self.assertIn("G195 X40. F487.", payload["text"].split("\n"))
        self.assertIn(
            "this block writes G195, which the code database does not know",
            self.rows("fanuc-leads-the-database-knows")[20],
        )
        self.assertIn("1 left under a code the database does not know", payload["message"])
        # A known code in the next block is scaled as ever.
        self.assertIn("G1 X80. F480.", payload["text"].split("\n"))

    def test_the_letter_of_the_moves_comes_from_the_database(self):
        helpers.import_gedit_nc()
        import scale_feed  # the bundled folder is on sys.path now

        self.assertEqual(scale_feed.code_letters([{"code": "G1", "group": "motion", "label": "x"}]), frozenset({"G"}))
        # Klartext writes its moves as keywords, so no letter is a code letter there.
        klartext = helpers.effective_context("heidenhain-klartext")["codes"]
        self.assertEqual(scale_feed.code_letters(klartext), frozenset())
        # Without a database nothing is unknown: the run says what it could not know.
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(params={"percent": 50}, profile=profile, codes=[])
        result = helpers.run_script(SCRIPT, stdin="G195 X40. F400.\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["text"], "G195 X40. F200.\n")

    def test_a_selection_inside_a_modal_tapping_call_keeps_the_next_lead(self):
        # The re-review of the M8 fixes: F520 was scaled with no finding, because the walk
        # for the leads of a call started at the selection.
        payload = self.output("sinumerik-mcall-tapping-selection")
        lines = payload["text"].split("\n")
        self.assertEqual(lines[0], "N80 X40 Y0 F520")
        self.assertEqual(lines[2], "N100 G1 X60 F400")
        self.assertIn("F520 is written while CYCLE840 (line 7) repeats after every move", payload["findings"][0]["message"])

    def test_an_e_word_no_code_of_its_block_explains_is_reported(self):
        # Okuma LAP: E is the feed along the contour of the high-speed bar turning cycle,
        # F the finishing feed (OSP manual, LAP section). E is never the F word, so it is
        # left; the finishing F beside it is scaled, and the dwell E of G181 is a parameter.
        payload = self.output("okuma-lap-shape-feeds")
        lines = payload["text"].split("\n")
        self.assertEqual(lines[10:12], ["G01 X20 Z0 F0.16 E0.3", "G01 Z-20 E0.25"])
        self.assertEqual(lines[16], "G181 X0 Z-12 F64.00 E0.5")
        rows = self.rows("okuma-lap-shape-feeds")
        self.assertEqual(sorted(rows), [11, 12])
        self.assertIn("E0.3 is left as written", rows[11])
        self.assertIn("(E)", payload["message"])

    def test_an_okuma_dollar_line_without_a_blank_continues_the_block(self):
        # Review §6, fixed in dec/int: `continuationStart` of okuma-osp.json now tells a
        # continuation line (`$H2.45 …`, no `%`) from the `$NAME.MIN%` header by the `%`,
        # so the lead on `$H2.45 … F2` is left, not scaled.
        context = helpers.effective_context("okuma-osp", params={"percent": 80})
        program = "N001 G71 X27.55 Z-30 B60 D0.7 U0.1\n$H2.45 L2 F2.5 M23\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["text"], program)


class TestValuesReadRight(unittest.TestCase):
    """M9 (WP9.5a): the scale-feed items of "values read right", one claim per case.

    Every case here was wrong on `m9/int` (the regression proof of the hand-off): the
    roughing lookalike was scaled, the turning limits lowered every per-minute feed of a
    driven tool to 0.3, the contour feed of an Okuma `G101` was left as a feed per
    revolution, and a Sinumerik `G33` F was called a thread pitch.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_feed") if case.name == name)

    def output(self, name, params=None):
        case = self.case(name)
        context = context_of(case)
        if params is not None:
            context["params"] = params
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        if params is None:
            self.assertEqual(payload["text"], case.expected_text())
        return payload

    # -- a profile-range cycle without its range --------------------------------

    def test_a_roughing_cycle_without_a_p_is_refused_while_no_machine_confirms_the_dialect(self):
        payload = self.output("lathe-roughing-no-range")
        lines = payload["text"].split("\n")
        # The real roughing cycle carries its range, and its feed is scaled.
        self.assertIn("G71 P100 Q200 U0.4 W0.1 F0.23", lines)
        # The lookalikes are an Okuma thread cycle's shape: their F may be a lead.
        self.assertIn("G71 X18.2 Z-18. F2.0", lines)
        self.assertIn("G72 X18.2 Z-18. F2.0", lines)
        refused = [f for f in payload["findings"] if "names no P" in f["message"]]
        self.assertEqual([f["line"] for f in refused], [21, 22])
        self.assertTrue(all(f["severity"] == "warning" for f in refused))
        self.assertIn("Choose a machine for the document", refused[0]["message"])
        self.assertIn("2 left because a profile-range cycle names no range", payload["message"])

    def test_with_a_machine_of_the_profile_chosen_the_same_blocks_are_scaled(self):
        payload = self.output("lathe-roughing-no-range-machine")
        lines = payload["text"].split("\n")
        self.assertIn("G71 X18.2 Z-18. F1.8", lines)
        self.assertIn("G72 X18.2 Z-18. F1.8", lines)
        self.assertEqual(payload["findings"], [])
        self.assertIn("Machine 'Lathe 1'.", payload["message"])

    def test_the_first_block_of_a_roughing_cycle_has_no_feed_and_is_not_touched(self):
        lines = self.output("lathe-roughing-no-range")["text"].split("\n")
        self.assertIn("G71 U2. R0.5", lines)

    def test_the_guard_reads_the_database_and_names_no_code(self):
        # A code whose entry declares no P/Q range is never refused this way: on the Okuma
        # profile G71 is the thread cycle, and its F is refused as the lead it is.
        context = helpers.effective_context("okuma-osp", params={"percent": 90})
        result = helpers.run_script(SCRIPT, stdin="G71 X18.2 Z-18 F2.0\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        messages = [f["message"] for f in result.json()["findings"]]
        self.assertEqual(len(messages), 1)
        self.assertNotIn("names no P", messages[0])
        self.assertIn("thread pitch (G71)", messages[0])

    # -- the limits are in one feed unit ------------------------------------------

    def test_turning_limits_never_touch_a_feed_per_minute(self):
        payload = self.output("lathe-limits-per-unit")
        lines = payload["text"].split("\n")
        # Per revolution: clamped and raised to the limits.
        self.assertIn("G01 X38. F0.30", lines)
        self.assertIn("G01 X40. F0.10", lines)
        # Per minute (G98): scaled, never lowered to 0.3 mm/min.
        self.assertIn("G01 X20. F240.", lines)
        self.assertIn("G01 Z-5. F96.", lines)
        other = [f for f in payload["findings"] if "limits are for feeds per revolution" in f["message"]]
        self.assertEqual([f["line"] for f in other], [15, 16])
        self.assertIn("it is a feed per minute", other[0]["message"])
        self.assertIn("2 scaled without the limits, which are for feeds per revolution", payload["message"])

    def test_the_limit_unit_can_be_chosen_outright(self):
        payload = self.output("mill-limits-per-revolution")
        lines = payload["text"].split("\n")
        self.assertIn("G01 Y50. F0.30", lines)  # clamped, per revolution
        self.assertIn("G01 Z-2. F330.", lines)  # per minute: no limit
        self.assertIn("G01 X0. F550.", lines)

    def test_the_same_turning_program_with_the_limits_per_minute(self):
        case = self.case("lathe-limits-per-unit")
        params = dict(helpers.load_json(case.directory / "params.json"))
        params.update({"limitUnit": "per-minute", "minFeed": 100, "maxFeed": 220})
        payload = self.output("lathe-limits-per-unit", params)
        lines = payload["text"].split("\n")
        self.assertIn("G01 X20. F220.", lines)  # 240 lowered to the per-minute limit
        self.assertIn("G01 Z-5. F100.", lines)  # 96 raised to it
        self.assertIn("G01 Z-10. F0.30", lines)  # per revolution: scaled, not raised to 100
        self.assertIn("3 scaled without the limits, which are for feeds per minute", payload["message"])

    def test_a_filter_leaves_a_feed_in_another_unit_as_written(self):
        """NC-F1: "only feeds below 0.3" (per revolution) must not scale a `G98 F200.`."""
        payload = self.output("lathe-filter-other-unit")
        lines = payload["text"].split("\n")
        self.assertIn("G01 X20. F200.", lines)
        self.assertIn("G01 Z-5. F80.", lines)
        self.assertIn("G01 Z-10. F0.25", lines)  # scaled and clamped to the largest feed
        self.assertIn("G01 X38. F0.35", lines)  # left by the filter
        left = [f for f in payload["findings"] if "passes the filter cannot be told" in f["message"]]
        self.assertEqual([f["line"] for f in left], [15, 16])
        self.assertEqual({f["severity"] for f in left}, {"warning"})
        self.assertTrue(left[0]["message"].startswith("F200. is not scaled: it is a feed per minute"))
        self.assertIn("2 left because the value filter cannot be compared with them", payload["message"])
        self.assertNotIn("scaled without the limits", payload["message"])

    def test_a_filter_leaves_a_feed_with_no_value_as_written(self):
        """NC-F1: with no machine a point-less feed per revolution has no value to filter."""
        payload = self.output("lathe-filter-no-value")
        lines = payload["text"].split("\n")
        self.assertIn("G01 Z-10. F25", lines)
        self.assertIn("G01 X38. F0.30", lines)
        left = [f for f in payload["findings"] if f["message"].startswith("F25 ")]
        self.assertEqual(len(left), 1)
        self.assertIn("is not scaled: what it is worth depends on the machine", left[0]["message"])
        self.assertIn('the "only feeds above" value (0.1) cannot be compared with it', left[0]["message"])
        self.assertIn("1 left because the value filter cannot be compared with it", payload["message"])
        self.assertNotIn("without a limit check", payload["message"])

    def test_without_a_filter_the_same_feeds_are_scaled_without_the_limits(self):
        """The smallest and largest feed only bound a scaled feed; they never hold one back."""
        payload = self.output("lathe-filter-other-unit", {"percent": 150, "maxFeed": 0.25})
        lines = payload["text"].split("\n")
        self.assertIn("G01 X20. F300.", lines)
        self.assertIn("G01 Z-5. F120.", lines)
        self.assertIn("2 scaled without the limits, which are for feeds per revolution", payload["message"])
        payload = self.output("lathe-filter-no-value", {"percent": 150, "maxFeed": 0.25})
        self.assertIn("G01 Z-10. F38", payload["text"].split("\n"))
        self.assertIn("1 scaled without a limit check", payload["message"])

    def test_a_run_without_limits_says_nothing_about_their_unit(self):
        payload = self.output("lathe-limits-per-unit", {"percent": 120})
        self.assertFalse([f for f in payload["findings"] if "limits" in f["message"]])

    # -- a code that declares its feed unit -----------------------------------------

    def test_an_okuma_contour_move_cuts_at_a_feed_per_minute_whatever_the_feed_mode(self):
        payload = self.output("okuma-contour-feed")
        lines = payload["text"].split("\n")
        self.assertIn("N100 G101 X20. C90. F120", lines)
        # The next block is still a G101 move, and so is its feed.
        self.assertIn("N110 X40. C180. F96", lines)
        self.assertIn("N120 G102 X20. C270. L10. F80", lines)
        # The turning feeds around it are per revolution, left by the option.
        self.assertIn("N50 G01 Z-20. F0.2", lines)
        self.assertIn("N130 G01 X42. F0.1", lines)

    # -- the texts -------------------------------------------------------------------

    def test_a_sinumerik_g33_f_is_not_called_a_pitch(self):
        payload = self.output("sinumerik-thread-lead-elsewhere")
        messages = [f["message"] for f in payload["findings"]]
        self.assertEqual(len(messages), 1)
        self.assertNotIn("pitch", messages[0])
        self.assertIn("G33 takes its lead from I, J or K, not from F", messages[0])
        self.assertIn("stays the feed in force", messages[0])
        self.assertIn("1 left in a thread block whose lead is written elsewhere", payload["message"])
        self.assertNotIn("thread pitch", payload["message"])

    def test_a_fanuc_thread_f_is_still_the_lead(self):
        context = helpers.effective_context("fanuc-lathe", params={"percent": 90})
        result = helpers.run_script(SCRIPT, stdin="G32 Z-18. F1.5\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertIn("F1.5 is a thread pitch (G32)", result.json()["findings"][0]["message"])

    def test_the_summary_names_the_machine(self):
        # The owner's wish (TODO "Script texts"): delivered with the machines of M6 and kept.
        self.assertIn("Machine 'Lathe 1'.", self.output("lathe-roughing-no-range-machine")["message"])
        self.assertIn("No machine: profile defaults assumed.", self.output("lathe-roughing-no-range")["message"])

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_the_description_says_what_is_scaled(self):
        import tomllib

        meta = tomllib.loads(TestHeader().header_source())
        self.assertIn("an F written in a rapid block included", meta["description"])
        self.assertNotIn("rapid moves", meta["description"])
        limit = next(param for param in meta["params"] if param["id"] == "limitUnit")
        self.assertEqual(limit["default"], "auto")
        self.assertEqual([choice["value"] for choice in limit["choices"]], ["auto", "per-minute", "per-rev"])
