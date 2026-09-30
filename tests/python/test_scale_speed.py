"""`scale_speed.py` (plan §5, WP4.7), against the golden cases in
``tests/fixtures/scripts/scale_speed/``.

A case folder holds the same files as `test_scale_feed.py` describes: `input.nc`, the
optional `params.json` and `case.json`, and the two goldens `expected.nc` (the text the
script hands back, byte for byte) and `envelope.json` (the `message` and `findings` of the
`envelope` stdout). The script runs in a subprocess the way the app runs it.

The programs in the fixtures are synthetic. They were written for gEdit from
`docs/planning/syntax/`, are not copied from a machine, a CAM system or a customer, and
are not meant to run on a machine.

What the cases cover, in the plan's words:

* G96 and `G50`/`G92 S` are skipped by default, with options to scale them
  (`fanuc-surface-speed-and-limit`, `…-all`)
* tapping blocks get a warning (`fanuc-tapping`)
* Klartext `S` in `TOOL CALL` is scaled (`klartext-tool-call`)
* speeds are integers by default (`fanuc-number-forms`, `fanuc-number-forms-as-written`)

And the three WP5.4 added:

* a selection under a `G96` set above it inherits constant surface speed, because its
  case folder carries a `preceding.nc` (`input.precedingLines`, plan section 7.5) —
  `fanuc-selection-primed`
* a speed that is already zero or negative is never raised to the "smallest speed" limit
  (`fanuc-zero-speed-with-limit`) — the defect G8 M4 finding 11 fixed in `scale_feed.py`
  and left standing here
* a block whose code is a threading cycle somewhere else is named when the
  speed it runs at was changed (`fanuc-lathe-threading`)

And the turning dialects of M8 (WP8.7), each a word a naive script would have scaled:

* `okuma-live-tool` — `SB=` is the driven tool's speed and never the main spindle's: it
  is reported and left, next to a `G50 S` clamp and a speed from a variable
* `sinumerik-spindles` — `LIMS=` is a clamp wherever it stands (the profile's
  `addresses.speedLimitWords`), `G26 S` is one by its code and so is the `S3=` of a `G26`
  block, `S3=` elsewhere names spindle 3 by its number, the `S` of `G4 S2` counts
  revolutions of a dwell, and the start angle `SF=` of a thread is no speed at all; only
  the plain `S` words move
* `sinumerik-speed-limits-all` — with the option set, both kinds of clamp are scaled

And the M8 NC review (G10), each a program the review ran:

* `sinumerik-g63` — tapping with a compensating chuck: the `S` of a `G63` block is scaled
  and the block is named for a check by hand, because its `F` is the speed times the pitch
* `sinumerik-feed-type` — on this control `G94`, `G95`, `G96` and `G97` are one group: after
  `G95` the `S1800` is revolutions again, and a surface speed names the code in force
* `sinumerik-limits` — `G25 S` is a lower limit, and in a `G26` block every speed word is a
  limit, the ones for spindles 2 and 3 included; `G26 X… Z…` limits the working area
* `sinumerik-master-spindle` / `-all` — after `SETMS(3)` a plain `S` drives spindle 3:
  reported and left, or scaled when the run is asked to scale other spindles
* `sinumerik-dwell-and-angle` — `G4 S2=10` waits ten turns of spindle 2, and `SF=0` is
  a start angle, so neither is a speed
* `sinumerik-indexed-words` / `-all` — `LIMS[2]=` and `S[2]=` name a spindle by an index
"""

from __future__ import annotations

import json
import sys
import unittest

from tests.python import helpers

SCRIPT = "scale_speed.py"

#: `tomllib` reads the script header the way the backend does; it arrived in 3.11, and
#: the gate also runs on 3.9, where those checks are skipped rather than dropped.
HAS_TOMLLIB = sys.version_info >= (3, 11)

#: Cases the plan names by hand, so a renamed or deleted folder fails loudly.
REQUIRED_CASES = [
    "fanuc-basic",
    "fanuc-clamped",
    "fanuc-number-forms",
    "fanuc-number-forms-as-written",
    "fanuc-lathe-threading",
    "fanuc-selection",
    "fanuc-selection-primed",
    "fanuc-surface-speed-and-limit",
    "fanuc-surface-speed-and-limit-all",
    "fanuc-tapping",
    "fanuc-unchanged",
    "fanuc-value-filter",
    "fanuc-variables",
    "fanuc-zero-speed-with-limit",
    "klartext-tool-call",
    # M6 (WP6.6): turning.
    "lathe-surface-speed",
    "lathe-surface-speed-no",
    "lathe-system-b-clamp",
    # G8 M6: a system-A program opened with a system-B machine. Its `G50 S` clamp used to
    # be raised by 50 % with no finding at all, which is what lets a spindle run away as
    # the diameter falls under G96.
    "lathe-a-clamp-as-b",
    # M8 (WP8.7): the turning dialects.
    "okuma-live-tool",
    "sinumerik-spindles",
    "sinumerik-speed-limits-all",
    # The M8 NC review: each the program the review ran, with its own input.
    "sinumerik-dwell-and-angle",
    "sinumerik-feed-type",
    "sinumerik-g63",
    "sinumerik-indexed-words",
    "sinumerik-indexed-words-all",
    "sinumerik-limits",
    "sinumerik-master-spindle",
    "sinumerik-master-spindle-all",
]

#: The address this script is allowed to rewrite; everything else comes back token for
#: token (see :func:`shape_of`).
SCALED_ADDRESSES = ("S",)

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

    Two programs with the same shape differ **only** inside the values of spindle words:
    same line count, same tokens in the same order, same kinds and addresses, and every
    comment, string, block number, skip mark and space identical character for character.
    A clamp written as a word of its own (the profile's `addresses.speedLimitWords`, M8) is
    a spindle value the script may scale when it is asked to scale the limits.
    """
    gedit_nc = helpers.import_gedit_nc()
    limits = (cp.profile.get("addresses") or {}).get("speedLimitWords") or []
    scaled = set(SCALED_ADDRESSES) | {word.upper() for word in limits if isinstance(word, str)}
    out = []
    state = None
    for line in lines:
        tokens, state = gedit_nc.tokenize_line(line, cp, state)
        row = []
        for i, token in enumerate(tokens):
            row.append(
                (
                    token.kind,
                    token.address,
                    "<value>" if token.kind == "word" and scalable(tokens, i, scaled) else token.text,
                )
            )
        out.append(row)
    return out


def scalable(tokens, i, scaled):
    """Whether the word at ``i`` is one the script may rewrite when every option is on.

    The spindle word, a clamp word, another spindle's word (`S3=`, `SB=`) and the number of
    an indexed one (`S[2]=300`, `LIMS[2]=1800`), which the tokenizer hands over as a word
    without an address straight after the `=`.
    """
    token = tokens[i]
    address = (token.address or "").upper()
    if address in scaled:
        return True
    if address.startswith("S") and "=" in token.text and len(address) >= 2:
        rest = address[1:]
        return rest.isdigit() or (len(rest) == 1 and rest.isalpha())
    if address == "":
        before = [t for t in tokens[:i] if t.kind != "whitespace"]
        return len(before) >= 2 and before[-1].text.strip() == "=" and "[" in before[-2].text
    return False


class TestGoldenCases(unittest.TestCase):
    def setUp(self):
        self.cases = helpers.script_cases("scale_speed")

    def test_the_fixture_folder_holds_the_cases_the_plan_names(self):
        self.assertTrue(self.cases, "no scale_speed fixtures found")
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

    def test_the_output_differs_from_the_input_only_inside_spindle_values(self):
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
        return next(case for case in helpers.script_cases("scale_speed") if case.name == name)

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

    def test_a_plain_speed_is_multiplied_by_the_percentage(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("S2700 M3", lines)
        self.assertIn("S1350 M3", lines)

    def test_a_speed_inside_a_comment_is_not_a_speed(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("(T1  D10 FLAT END MILL AT S3000)", lines)
        self.assertIn("(FINISH AT S1500)", lines)
        self.assertIn("(WRITTEN FOR GEDIT - SYNTHETIC TEST PROGRAM, NOT FOR A MACHINE)", lines)

    def test_a_feed_is_never_touched_by_the_speed_script(self):
        lines = self.lines("fanuc-basic")
        self.assertIn("G1 Z-2. F1200.", lines)
        self.assertIn("G1 X40. F800.", lines)

    def test_a_surface_speed_and_a_speed_limit_follow_their_options(self):
        default = self.lines("fanuc-surface-speed-and-limit")
        self.assertIn("G50 S2500", default)
        self.assertIn("G96 S180 M3", default)
        self.assertIn("G97 S1080", default)
        messages = self.messages("fanuc-surface-speed-and-limit")
        self.assertTrue(any("spindle speed limit (G50)" in message for message in messages))
        self.assertTrue(any("surface speed (G96)" in message for message in messages))

        every = self.lines("fanuc-surface-speed-and-limit-all")
        self.assertIn("G50 S2250", every)
        self.assertIn("G96 S162 M3", every)
        self.assertIn("G97 S1080", every)

    def test_a_tapping_block_is_scaled_and_warned_about(self):
        payload = self.output("fanuc-tapping")
        lines = payload["text"].split("\n")
        self.assertIn("M29 S450", lines)
        self.assertIn("S360", lines)
        self.assertIn("X60. Y10. S405", lines)
        # The speed of a tapping cycle is usually set in the block before it, so the
        # warning has to reach the cycle as well as the speeds inside it.
        warnings = [f for f in payload["findings"] if f["severity"] == "warning"]
        self.assertEqual([f["line"] for f in warnings], [9, 11, 12])
        self.assertIn("runs at S500, which was scaled on line 7", warnings[0]["message"])
        self.assertTrue(all("check this block by hand" in f["message"] for f in warnings))
        # After G80 the cycle is over and the speed is an ordinary speed again.
        self.assertIn("S720 M3", lines)
        self.assertEqual(payload["findings"][-1]["line"], 12)

    def test_a_speed_that_is_a_variable_or_an_expression_is_reported_and_left(self):
        lines = self.lines("fanuc-variables")
        self.assertIn("S#500 M3", lines)
        self.assertIn("S[#500*0.5]", lines)
        self.assertIn("#500=1200.", lines)
        self.assertIn("S900", lines)
        self.assertEqual(len(self.messages("fanuc-variables")), 2)

    def test_a_speed_is_a_whole_number_unless_the_run_asks_for_decimals(self):
        whole = self.lines("fanuc-number-forms")
        self.assertIn("S900 M3", whole)
        self.assertIn("S315", whole)  # leading zeros are dropped
        # The point is never added and never removed: S1200.5 keeps it, S1000 does not
        # get one. Rounding is half away from zero.
        self.assertIn("S1080.", whole)
        self.assertIn("S11.", whole)

        written = self.lines("fanuc-number-forms-as-written")
        self.assertIn("S1080.5", written)
        self.assertIn("S11.48", written)
        self.assertIn("S900 M3", written)

    def test_the_limits_clamp_the_scaled_value_and_say_so(self):
        payload = self.output("fanuc-clamped")
        lines = payload["text"].split("\n")
        self.assertIn("S800 M3", lines)
        self.assertIn("S4000", lines)
        self.assertIn("S6000", lines)
        self.assertEqual(len(payload["findings"]), 2)
        self.assertIn("smallest speed (800)", payload["findings"][0]["message"])
        self.assertIn("largest speed (6000)", payload["findings"][1]["message"])

    def test_the_value_filter_leaves_the_values_outside_it_alone(self):
        lines = self.lines("fanuc-value-filter")
        self.assertIn("S400 M3", lines)  # at or below "only above"
        self.assertIn("S500", lines)
        self.assertIn("S6000", lines)  # at or above "only below"
        self.assertIn("2 left by the value filter", self.output("fanuc-value-filter")["message"])

    def test_a_hundred_per_cent_changes_nothing(self):
        case = self.case("fanuc-unchanged")
        payload = self.output("fanuc-unchanged")
        self.assertEqual(payload["text"], case.input_text())
        self.assertEqual(
            payload["message"], "No spindle speed was changed; 2 already written that way."
        )

    def test_a_selection_counts_from_the_line_the_selection_started_on(self):
        payload = self.output("fanuc-selection")
        # Line 40 is the fragment warning below; line 41 is the surface speed it found.
        self.assertEqual([finding["line"] for finding in payload["findings"]], [40, 41])

    def test_a_selection_says_that_it_cannot_see_the_modal_state_above_it(self):
        # G8 M4. G96 / G97 and the cycles are modal, so a selection that starts below
        # them reads an rpm as a surface speed or the other way round, and cannot tell
        # that a speed it changed is the one a thread further down is cut at.
        first = self.output("fanuc-selection")["findings"][0]
        self.assertEqual(first["line"], 40)
        self.assertEqual(first["severity"], "warning")
        self.assertIn("only the selection", first["message"])

    def test_a_run_over_the_whole_document_does_not_warn_about_a_fragment(self):
        for name in ("fanuc-basic", "fanuc-surface-speed-and-limit"):
            with self.subTest(case=name):
                self.assertFalse(any("only the selection" in message for message in self.messages(name)))

    def test_klartext_scales_the_speed_of_a_tool_call(self):
        lines = self.lines("klartext-tool-call")
        self.assertIn('3 TOOL CALL 5 Z S3300 F500', lines)
        self.assertIn('8 TOOL CALL "MILL_D10" Z S5500 F800', lines)
        self.assertIn("10 TOOL CALL QS1 Z S2750", lines)
        # A tool call without a tool argument only changes the speed, and is scaled too.
        self.assertIn("6 TOOL CALL Z S4950", lines)

    def test_a_klartext_speed_in_a_heading_or_a_comment_is_not_a_speed(self):
        lines = self.lines("klartext-tool-call")
        self.assertIn("2 * - ROUGH AT S3000", lines)
        self.assertIn("7 L X+50 ; S9000 IN A COMMENT", lines)


class TestCodeDatabase(unittest.TestCase):
    """The surface-speed and limit rules are data, not a table of Fanuc numbers."""

    def run_with(self, codes, stdin, params=None):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(params=params or {"percent": 50}, profile=profile, codes=codes)
        result = helpers.run_script(SCRIPT, stdin=stdin, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def codes(self):
        return helpers.load_codes(helpers.load_profile("fanuc-gcode"))

    def test_g92_clamps_the_speed_the_same_way_g50_does(self):
        payload = self.run_with(self.codes(), "G92 S2500\nS1000 M3\n")
        self.assertEqual(payload["text"], "G92 S2500\nS500 M3\n")
        self.assertIn("spindle speed limit (G92)", payload["findings"][0]["message"])

    def test_the_limit_of_a_block_wins_over_constant_surface_speed(self):
        payload = self.run_with(self.codes(), "G96 S180 M3\nG50 S2500\n")
        self.assertEqual(payload["text"], "G96 S180 M3\nG50 S2500\n")
        self.assertIn("surface speed (G96)", payload["findings"][0]["message"])
        self.assertIn("spindle speed limit (G50)", payload["findings"][1]["message"])

    def test_a_code_marked_pitch_feed_is_what_makes_a_block_a_thread_block(self):
        codes = [
            {"code": "G71", "group": "cycle", "pitchFeed": True, "params": [{"address": "F"}]},
            {"code": "G1", "group": "motion"},
        ]
        payload = self.run_with(codes, "S1000 M3\nG71 Z-10. F1.5\nG1 X10.\n")
        self.assertEqual(payload["text"], "S500 M3\nG71 Z-10. F1.5\nG1 X10.\n")
        self.assertEqual(payload["findings"][0]["line"], 2)
        self.assertIn("thread block (G71)", payload["findings"][0]["message"])

    def test_a_run_without_a_code_database_says_what_it_could_not_know(self):
        payload = self.run_with([], "G96 S180 M3\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        self.assertIn("no code database", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["line"], 1)


class TestHeader(unittest.TestCase):
    """The `# /// gedit` block, read the way `src-tauri/src/scripts/meta.rs` reads it."""

    FIELD_TYPES = ("number", "integer", "text", "bool", "choice", "file", "folder", "address-list")
    PARAMS = [
        "percent",
        "decimals",
        "minSpeed",
        "maxSpeed",
        "onlyAbove",
        "onlyBelow",
        "surfaceSpeed",
        "speedLimits",
        "otherSpindles",
    ]

    def header_source(self):
        """The header block with its `# ` prefix removed, as the backend does it."""
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
        self.assertEqual(meta["name"], "Scale spindle speeds")
        self.assertEqual(meta["output"], "replace")
        self.assertEqual(meta["input"], "selection-or-document")
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

    @unittest.skipUnless(HAS_TOMLLIB, "tomllib is 3.11 and newer")
    def test_a_speed_is_a_whole_number_by_default(self):
        import tomllib

        params = tomllib.loads(self.header_source())["params"]
        decimals = next(param for param in params if param["id"] == "decimals")
        self.assertEqual(decimals["default"], "0")

    def test_the_declared_parameters_are_the_ones_the_script_reads(self):
        """A parameter the script does not read would be a silently dead control."""
        source = (helpers.SCRIPTS_DIR / SCRIPT).read_text(encoding="utf-8")
        body = source.split("# ///", 2)[-1]
        for name in self.PARAMS:
            with self.subTest(param=name):
                self.assertIn('"%s"' % name, body)


class TestSelectionPriming(unittest.TestCase):
    """The M4 carry-over, fixed: a selection run reads the state above the selection.

    `ScriptContextInput.precedingLines` (plan section 7.5) carries the document lines above
    `startLine`; `gedit_nc.prime_tracker` walks them into the `FeedModeTracker` before the
    first editable block. The case is checked twice — as it ships, and with the field taken
    back out, which is what the run used to do and still does without it.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_speed") if case.name == name)

    def primed(self, name):
        case = self.case(name)
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def unprimed(self, name):
        case = self.case(name)
        context = context_of(case)
        self.assertIn("precedingLines", context["input"], "this case is not a primed one")
        context["input"] = {
            key: value for key, value in context["input"].items() if key != "precedingLines"
        }
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_selection_under_a_g96_inherits_constant_surface_speed(self):
        payload = self.primed("fanuc-selection-primed")
        lines = payload["text"].split("\n")
        # G96 stands on line 6, above the selection: S200 is metres per minute, not rpm.
        self.assertIn("S200", lines)
        # G97 inside the selection ends it, so the two speeds after it are scaled.
        self.assertIn("G97 S1080", lines)
        self.assertIn("S1350", lines)
        first = payload["findings"][0]
        self.assertEqual(first["severity"], "info")
        self.assertIn("constant surface speed (G96)", first["message"])
        self.assertIn("were read for the modal state", first["message"])

    def test_without_the_lines_above_it_the_surface_speed_is_scaled_as_rpm(self):
        payload = self.unprimed("fanuc-selection-primed")
        self.assertIn("S180", payload["text"].split("\n"))
        self.assertIn("only the selection", payload["findings"][0]["message"])
        self.assertEqual(payload["findings"][0]["severity"], "warning")

    def test_preceding_lines_that_are_not_all_the_lines_above_are_refused(self):
        """A truncated field is a wrong answer; an absent one is an honest warning."""
        case = self.case("fanuc-selection-primed")
        context = context_of(case)
        context["input"]["precedingLines"] = context["input"]["precedingLines"][-2:]
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertIn("only the selection", payload["findings"][0]["message"])
        self.assertEqual(payload["text"], self.unprimed("fanuc-selection-primed")["text"])


class TestZeroAndLimits(unittest.TestCase):
    """A limit bounds a scaled speed; it never invents one (G8 M4 finding 11).

    `scale_feed.py` got this in M4. `scale_speed.py` did not: its zero check ran **after**
    `clamp()` and skipped a value that was already zero, so `S0` with a smallest speed of
    500 came back as `S500` and a spindle the program had stopped started turning.
    """

    def context(self, params):
        profile = helpers.load_profile("fanuc-gcode")
        return helpers.make_context(params=params, profile=profile, codes=helpers.load_codes(profile))

    def test_a_stopped_spindle_is_never_raised_to_the_smallest_speed(self):
        case = next(c for c in helpers.script_cases("scale_speed") if c.name == "fanuc-zero-speed-with-limit")
        result = run_case(case)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        lines = payload["text"].split("\n")
        self.assertIn("M5 S0", lines)
        self.assertIn("S-500", lines)
        # A real speed below the limit is raised, which is what the limit is for.
        self.assertIn("S500 M3", lines)
        self.assertIn("S3200", lines)
        self.assertEqual(payload["text"], case.expected_text())

    def test_the_finding_says_which_value_was_skipped_and_why(self):
        result = helpers.run_script(
            SCRIPT, stdin="M5 S0\n", context=self.context({"percent": 80, "minSpeed": 500})
        )
        self.assertTrue(result.ok, result.stderr)
        finding = result.json()["findings"][0]
        self.assertEqual(finding["severity"], "warning")
        self.assertEqual(
            finding["message"],
            "S0 is a speed of zero, which is a spindle that does not turn, so it is left "
            "exactly as written and the percentage is not applied. The smallest speed "
            "(500) is not applied to it either: a limit bounds a scaled speed, it does "
            "not invent one.",
        )

    def test_without_a_limit_a_zero_speed_is_still_left_alone(self):
        result = helpers.run_script(SCRIPT, stdin="M5 S0\n", context=self.context({"percent": 80}))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "M5 S0\n")
        self.assertIn("zero or negative", payload["message"])

    def test_a_value_the_run_rounds_further_than_asked_is_named(self):
        # The same rule as `scale_feed.py`: 150 % of S0.1 written with one decimal is 0.2,
        # which is twice the speed, not half again. Rounding to the written precision is
        # right; being quiet about it is not.
        result = helpers.run_script(
            SCRIPT, stdin="S0.1 M3\n", context=self.context({"percent": 150, "decimals": "keep"})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "S0.2 M3\n")
        self.assertEqual(
            payload["findings"][0]["message"],
            "S0.1 becomes 0.2, not 0.15: the result was rounded to 1 decimal. Ask for "
            "more decimal places if that is too coarse.",
        )


class TestAmbiguousThreadingCodes(unittest.TestCase):
    """`pitchFeedAmbiguous` on the speed side (G8 M4 finding 7).

    `scale_feed.py` **refuses** the `F` of a `G76` or `G92` block, because it may be a
    thread lead. The `S` of such a block is a spindle speed in either reading, so it is
    scaled — but if the lathe reading is the right one, the thread is cut at the changed
    speed while its lead was deliberately left alone, and the pair has to be looked at
    together. So it is scaled and named, never scaled in silence.
    """

    def run_program(self, program, params=None):
        profile = helpers.load_profile("fanuc-gcode")
        context = helpers.make_context(
            params=params or {"percent": 90}, profile=profile, codes=helpers.load_codes(profile)
        )
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        return result.json()

    def test_a_threading_cycle_that_starts_after_a_changed_speed_is_named(self):
        case = next(c for c in helpers.script_cases("scale_speed") if c.name == "fanuc-lathe-threading")
        payload = self.run_program(case.input_text())
        self.assertEqual(payload["text"], case.expected_text())
        self.assertIn("G97 S720 M3", payload["text"].split("\n"))
        finding = payload["findings"][0]
        self.assertEqual(finding["severity"], "warning")
        self.assertEqual(finding["line"], 7)
        self.assertIn("G76", finding["message"])
        self.assertIn("another G-code system", finding["message"])
        self.assertIn("1 thread block to check by hand", payload["message"])

    def test_a_speed_inside_an_ambiguous_cycle_is_scaled_and_named(self):
        # G76 is modal, so the block after it is still inside the cycle.
        payload = self.run_program("G76 X18.16 Z-20. P1190 Q350 F2.0\nG97 S650\nG80\nS1000\n")
        self.assertEqual(
            payload["text"].splitlines(), ["G76 X18.16 Z-20. P1190 Q350 F2.0", "G97 S585", "G80", "S900"]
        )
        named = [f for f in payload["findings"] if "S650" in f["message"]]
        self.assertEqual(len(named), 1)
        self.assertIn("threading cycle on another kind of machine", named[0]["message"])
        # G80 cancels it, so the speed after it is scaled without a word.
        self.assertFalse(any("S1000" in f["message"] for f in payload["findings"]))

    def test_the_s_of_a_g92_block_is_still_read_as_a_speed_limit(self):
        # `G92 S` clamps the top speed in G-code systems B and C, which is the mill
        # reading of the same code, and that rule is unchanged.
        payload = self.run_program("G92 S2000\nS1200 M3\n")
        self.assertEqual(payload["text"].splitlines(), ["G92 S2000", "S1080 M3"])
        self.assertIn("speed limit (G92)", payload["findings"][0]["message"])


class TestRunEnvironment(unittest.TestCase):
    def context(self, params):
        profile = helpers.load_profile("fanuc-gcode")
        return helpers.make_context(params=params, profile=profile, codes=helpers.load_codes(profile))

    def refuses(self, params, needle):
        result = helpers.run_script(SCRIPT, stdin="S1000 M3\n", context=self.context(params))
        self.assertFalse(result.ok, result.stdout)
        self.assertEqual(result.stdout, "", "a refused run must not hand back text")
        self.assertIn(needle, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_without_a_context_it_says_what_it_needs_and_writes_nothing_to_stdout(self):
        result = helpers.run_script(SCRIPT, stdin="S1000 M3\n", context=None)
        self.assertFalse(result.ok)
        self.assertEqual(result.stdout, "")
        self.assertIn("profile", result.stderr)

    def test_a_profile_it_cannot_compile_is_a_message_and_not_a_traceback(self):
        profile = helpers.load_profile("fanuc-gcode")
        profile["toolCall"]["trigger"] = "M0*6(?!\\d"
        result = helpers.run_script(
            SCRIPT, stdin="S1000 M3\n", context=helpers.make_context(profile=profile, codes=[])
        )
        self.assertFalse(result.ok)
        self.assertIn("toolCall.trigger", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_a_percentage_of_zero_or_less_is_refused_rather_than_stopping_the_spindle(self):
        self.refuses({"percent": 0}, "greater than zero")
        self.refuses({"percent": -50}, "greater than zero")

    def test_a_parameter_that_is_not_a_number_is_refused(self):
        self.refuses({"percent": "ninety"}, "Percentage")
        self.refuses({"minSpeed": "slow"}, "Smallest speed")
        self.refuses({"decimals": "many"}, "Decimal places")

    def test_limits_the_wrong_way_round_are_refused(self):
        self.refuses({"minSpeed": 9000, "maxSpeed": 100}, "larger than")

    def test_a_percentage_may_arrive_as_a_float_or_as_text(self):
        for percent in (97.5, "97.5"):
            with self.subTest(percent=percent):
                result = helpers.run_script(
                    SCRIPT, stdin="S1000 M3\n", context=self.context({"percent": percent})
                )
                self.assertTrue(result.ok, result.stderr)
                payload = result.json()
                self.assertEqual(payload["text"], "S975 M3\n")
                self.assertIn("97.5 %", payload["message"])

    def test_an_empty_document_comes_back_empty(self):
        result = helpers.run_script(SCRIPT, stdin="", context=self.context({"percent": 90}))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "")
        self.assertEqual(payload["findings"], [])
        self.assertEqual(payload["message"], "No spindle speeds found.")

    def test_the_last_line_keeps_its_ending_or_its_absence(self):
        for stdin in ("S1000 M3\n", "S1000 M3", "S1000 M3\n\n"):
            with self.subTest(stdin=stdin):
                result = helpers.run_script(SCRIPT, stdin=stdin, context=self.context({"percent": 90}))
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.json()["text"], stdin.replace("S1000", "S900"))

    def test_a_value_that_would_round_to_zero_is_left_as_it_is(self):
        result = helpers.run_script(
            SCRIPT, stdin="S10 M3\nS1000\n", context=self.context({"percent": 4})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "S10 M3\nS40\n")
        self.assertEqual(payload["findings"][0]["severity"], "warning")
        # The finding names what was skipped and how the run got to zero, because the two
        # ways out are different: more decimal places, or a different limit.
        self.assertEqual(
            payload["findings"][0]["message"],
            "S10 is not scaled: 4 % of 10 is 0.4, which written with no decimals is 0, "
            "and a speed of zero is a spindle that does not turn, not a slow one. Ask "
            "for more decimal places to scale it.",
        )

    def test_the_findings_are_capped_and_the_message_says_how_many_were_left_out(self):
        lines = ["G96 S100 M3"] + ["G96 S%d M3" % (100 + n) for n in range(300)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(len(payload["findings"]), 200)
        self.assertIn("101 further notes are not listed.", payload["message"])
        self.assertEqual(payload["text"], "\n".join(lines) + "\n")

    def test_a_large_program_is_scaled_in_one_pass(self):
        """One pass over the tokens, not one per value.

        `helpers.run_script` kills a run after a minute, so a walk that turned quadratic
        would fail here rather than in a user's 100,000-line program.
        """
        lines = ["G97"] + ["N%d G1 X%d. S2000" % (n * 10, n % 400) for n in range(20000)]
        result = helpers.run_script(
            SCRIPT, stdin="\n".join(lines) + "\n", context=self.context({"percent": 90})
        )
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["message"], "Scaled 20,000 spindle speeds to 90 %.")
        self.assertEqual(payload["text"].count("S1800"), 20000)
        self.assertEqual(payload["findings"], [])

    def test_the_findings_come_back_in_line_order(self):
        for case in helpers.script_cases("scale_speed"):
            with self.subTest(case=case.name):
                findings = envelope_of(case)["findings"]
                self.assertEqual(
                    [finding["line"] for finding in findings],
                    sorted(finding["line"] for finding in findings),
                )

    def test_the_result_is_json_the_app_can_read(self):
        case = next(c for c in helpers.script_cases("scale_speed") if c.name == "fanuc-basic")
        result = run_case(case)
        payload = json.loads(result.stdout)
        self.assertIsInstance(payload["text"], str)
        self.assertNotIn("\r", payload["text"], "the app puts the line ending back itself")
        self.assertTrue(result.stdout.endswith("\n"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


class TestLathe(unittest.TestCase):
    """Turning (M6, WP6.6): constant surface speed, and the clamp the database names.

    A turning program cuts nearly everything under `G96`, where `S` is a surface speed in
    metres or feet per minute and not revolutions; and the block that clamps the top speed
    is `G50` in G-code system A and `G92` in system B, which is a **machine** setting and
    not a property of the dialect (plan AD-31). Neither is a table in the script any more:
    the profile says what kind of machine it describes and the code database says which code
    clamps (`sets.speedLimit`, F24).
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_speed") if case.name == name)

    def output(self, name):
        case = self.case(name)
        result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context_of(case))
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], case.expected_text())
        return payload

    def lines(self, name):
        return self.output(name)["text"].split("\n")

    def test_a_surface_speed_is_scaled_on_a_lathe_without_being_asked(self):
        # auto / yes / no, and auto follows the profile's `machineType` (F33 turns a
        # remembered `false` into the default). On a turning profile a run that skipped
        # every G96 block would leave the cutting speeds of the whole program alone.
        self.assertIn("G96 S242 M03", self.lines("lathe-surface-speed"))
        self.assertIn("G97 S1320 M03", self.lines("lathe-surface-speed"))

    def test_the_option_still_says_no(self):
        payload = self.output("lathe-surface-speed-no")
        self.assertIn("G96 S220 M03", payload["text"].split("\n"))
        self.assertIn("G97 S1320 M03", payload["text"].split("\n"))
        css = [f for f in payload["findings"] if "surface speed" in f["message"]]
        self.assertEqual([f["line"] for f in css], [12])

    def test_the_clamp_of_system_a_is_left_alone_and_named(self):
        payload = self.output("lathe-surface-speed")
        self.assertIn("G50 S2500", payload["text"].split("\n"))
        limit = payload["findings"][0]
        self.assertEqual(limit["line"], 11)
        self.assertEqual(limit["message"], "S2500 is a spindle speed limit (G50), so it is not scaled.")

    def test_the_clamp_of_system_b_is_a_different_code_and_the_database_says_so(self):
        payload = self.output("lathe-system-b-clamp")
        self.assertIn("G92 S2200", payload["text"].split("\n"))
        self.assertIn("G96 S220 M03", payload["text"].split("\n"))
        limit = payload["findings"][0]
        self.assertEqual(limit["line"], 8)
        self.assertEqual(limit["message"], "S2200 is a spindle speed limit (G92), so it is not scaled.")

    def test_the_same_block_is_a_clamp_in_both_systems_and_says_why(self):
        """`G92 S2200` clamps in system B, and G8 M6 made system A read it as one too.

        This is the whole reason the list of clamp codes had to leave the script (F24): a
        table that says "G50 and G92" lives in the code database, where each G-code system
        has its own. In system A `G92` is the single-pass threading cycle — but a
        threading pass carries no `S` word, so an `S` in such a block is a clamp written
        for system B and not a speed to scale. Raising the top-speed clamp of a
        constant-surface-speed program is what lets the spindle run away as the diameter
        falls, so both databases now read this block the same conservative way.
        """
        context = helpers.effective_context("fanuc-lathe", params={"percent": 110})
        result = helpers.run_script(SCRIPT, stdin="G92 S2200\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "G92 S2200\n")
        self.assertIn("G92", payload["findings"][0]["message"])

    def test_a_system_a_clamp_is_not_raised_by_a_system_b_machine(self):
        """G8 M6: the shop has one lathe, set to system B; the program is posted for A.

        `G50 S2500` is the top-speed clamp of G-code system A. The system-B database had
        dropped the entry altogether, so the block lost its `sets.speedLimit` flag and the
        `S` was scaled as an ordinary speed: a 150 % run **raised** the clamp of a
        constant-surface-speed program from 2500 to 3750 rpm, with no finding of any kind.
        That is the change that lets a spindle run away as the diameter falls, and on a
        bar-fed part it throws the chuck. B keeps the entry now, with a description saying
        the number is not its own clamp but that gEdit still reads the `S` as one.
        """
        out = self.output("lathe-a-clamp-as-b")
        self.assertIn("G50 S2500", out["text"].split("\n"))
        limit = [f for f in out["findings"] if "speed limit (G50)" in f["message"]]
        self.assertEqual(len(limit), 1, out["findings"])
        # The cutting speed of the same program is scaled, so this is not a run that did
        # nothing at all.
        self.assertIn("G96 S270 M03", out["text"].split("\n"))

    def test_the_clamp_can_be_scaled_on_request_in_either_system(self):
        for name, code, want in (
            ("lathe-surface-speed", "G50", "G50 S2750"),
            ("lathe-system-b-clamp", "G92", "G92 S2420"),
        ):
            with self.subTest(code=code):
                case = self.case(name)
                context = context_of(case)
                context["params"] = {"percent": 110, "speedLimits": True}
                result = helpers.run_script(SCRIPT, stdin=case.input_text(), context=context)
                self.assertTrue(result.ok, result.stderr)
                self.assertIn(want, result.json()["text"].split("\n"))

    def test_a_context_that_still_sends_a_boolean_is_honoured(self):
        """`surfaceSpeed` was a `bool` in Phase 1 (F33); an older context still says so."""
        program = "G96 S220 M03\n"
        for value, expected in ((True, "G96 S242 M03"), (False, "G96 S220 M03")):
            with self.subTest(surfaceSpeed=value):
                context = helpers.effective_context(
                    "fanuc-lathe", params={"percent": 110, "surfaceSpeed": value}
                )
                result = helpers.run_script(SCRIPT, stdin=program, context=context)
                self.assertTrue(result.ok, result.stderr)
                self.assertEqual(result.json()["text"], expected + "\n")


class TestTurningDialects(unittest.TestCase):
    """Okuma OSP and Sinumerik turning (M8, WP8.7): which S-like words are not the speed.

    Only the plain `S` word is the main spindle's speed. A clamp may be a word of its own
    (`LIMS=`, the profile's `addresses.speedLimitWords`), another spindle is named by its
    number (`S3=`) or by an address of its own (`SB=`), and a dwell may count revolutions in
    `S` (`G4 S2`). None of these is scaled as a speed; the clamp follows the limit option.
    """

    def case(self, name):
        return next(case for case in helpers.script_cases("scale_speed") if case.name == name)

    def output(self, name):
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

    def test_a_driven_tool_speed_is_reported_and_left(self):
        self.assertEqual(self.line("okuma-live-tool", 25), "SB=2000 M13")
        (finding,) = self.findings_on("okuma-live-tool", 25)
        self.assertIn("SB=2000 is the speed of a spindle with an address of its own", finding["message"])
        self.assertIn("Also scale other spindles", finding["message"])
        self.assertIn("(SB=)", self.output("okuma-live-tool")["message"])
        # The main spindle's speeds of the same program are scaled.
        self.assertEqual(self.line("okuma-live-tool", 15), "G97 S1650 M03")

    def test_a_spindle_named_by_its_number_is_reported_and_left(self):
        self.assertEqual(self.line("sinumerik-spindles", 20), "N170 S3=2400 M3=3")
        (finding,) = self.findings_on("sinumerik-spindles", 20)
        self.assertIn("S3=2400 is the speed of spindle 3, named by its number", finding["message"])

    def test_in_a_limit_block_another_spindle_word_is_a_limit_of_that_spindle(self):
        # `G26 S3=2500` is the top speed of spindle 3, not a speed to change by hand.
        self.assertEqual(self.line("sinumerik-spindles", 25), "N220 G26 S3=2500")
        (finding,) = self.findings_on("sinumerik-spindles", 25)
        self.assertEqual(finding["message"], "S3=2500 is the speed limit of spindle 3 (G26), so it is not scaled.")
        lines = self.output("sinumerik-limits")["text"].split("\n")
        self.assertEqual(lines[:3], ["N20 G25 S50", "N30 G26 S3000 S2=2000 S3=4000", "N120 G26 X300 Z200"])
        messages = [f["message"] for f in self.output("sinumerik-limits")["findings"]]
        self.assertEqual(
            messages,
            [
                "S50 is a spindle speed limit (G25), so it is not scaled.",
                "S3000 is a spindle speed limit (G26), so it is not scaled.",
                "S2=2000 is the speed limit of spindle 2 (G26), so it is not scaled.",
                "S3=4000 is the speed limit of spindle 3 (G26), so it is not scaled.",
            ],
        )
        self.assertEqual(self.output("sinumerik-limits")["message"], "No spindle speed was changed; 4 left as a speed limit.")

    def test_the_lower_limit_is_scaled_with_the_limit_option_only(self):
        context = helpers.effective_context("sinumerik", params={"percent": 80, "speedLimits": True})
        result = helpers.run_script(SCRIPT, stdin="N20 G25 S50\nN30 G26 S3000 S2=2000\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.json()["text"], "N20 G25 S40\nN30 G26 S2400 S2=1600\n")

    def test_a_start_angle_and_a_dwell_of_another_spindle_are_no_speed(self):
        payload = self.output("sinumerik-dwell-and-angle")
        lines = payload["text"].split("\n")
        self.assertEqual((lines[2], lines[4]), ("N120 G33 Z-24 K1.5 SF=0", "N230 G4 S2=10"))
        self.assertEqual([f["line"] for f in payload["findings"]], [3, 6])
        self.assertNotIn("SF", json.dumps([payload["message"], payload["findings"]]))
        self.assertIn("1 dwell in spindle revolutions left as written", payload["message"])

    def test_after_setms_a_plain_s_drives_the_spindle_it_chose(self):
        payload = self.output("sinumerik-master-spindle")
        lines = payload["text"].split("\n")
        # `SETMS(3)` on line 33: the tap's S500 is spindle 3's, so it is left and named.
        self.assertEqual(lines[33], "N300 S500 M3")
        (finding,) = [f for f in payload["findings"] if f["line"] == 34]
        self.assertIn("S500 drives spindle 3, which SETMS(3) on line 33 made the master spindle", finding["message"])
        self.assertIn("S after SETMS(3)", payload["message"])
        # The main spindle's S1600 before it is scaled.
        self.assertEqual(lines[8], "N50 G97 S1280 M3")
        # Asked to scale other spindles, the run scales it and `S3=2400` too.
        lines = self.output("sinumerik-master-spindle-all")["text"].split("\n")
        self.assertEqual((lines[20], lines[33]), ("N170 S3=1920 M3=3", "N300 S400 M3"))

    def test_setms_on_its_own_goes_back_to_the_configured_master_spindle(self):
        context = helpers.effective_context("sinumerik", params={"percent": 50})
        program = "N10 SETMS(2)\nN20 S400 M3\nN30 SETMS\nN40 S1000 M3\nN50 SETMS(4)\nN60 SETMS()\nN70 S600 M3\nN80 S0=800\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(
            payload["text"],
            "N10 SETMS(2)\nN20 S400 M3\nN30 SETMS\nN40 S500 M3\nN50 SETMS(4)\nN60 SETMS()\nN70 S300 M3\nN80 S0=400\n",
        )
        self.assertEqual([f["line"] for f in payload["findings"]], [2])

    def test_a_selection_below_setms_inherits_the_master_spindle(self):
        context = helpers.effective_context(
            "sinumerik",
            params={"percent": 50},
            input={"scope": "selection", "startLine": 3, "endLine": 3, "precedingLines": ["N10 SETMS(3)", "N20 G0 X10"]},
        )
        result = helpers.run_script(SCRIPT, stdin="N30 S800 M3\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "N30 S800 M3\n")
        self.assertIn("spindle 3 as the master spindle (SETMS(3))", payload["findings"][0]["message"])

    def test_a_spindle_index_names_the_spindle_of_a_limit_or_a_speed(self):
        messages = [f["message"] for f in self.output("sinumerik-indexed-words")["findings"]]
        self.assertIn("LIMS[2]=1800 is the speed limit of spindle 2, so it is not scaled.", messages)
        self.assertIn("LIMS[1]=2500 is the speed limit of spindle 1, so it is not scaled.", messages)
        self.assertTrue(any(m.startswith("S[2]=300 is the speed of spindle 2") for m in messages))
        lines = self.output("sinumerik-indexed-words-all")["text"].split("\n")
        self.assertEqual(lines[:3], ["N40 LIMS=2240 LIMS[2]=1440", "N100 G96 S144 LIMS[1]=2000", "N110 S[2]=240 M[2]=3"])

    def test_the_speed_of_a_g63_tap_is_scaled_and_the_block_named(self):
        payload = self.output("sinumerik-g63")
        self.assertEqual(payload["text"].split("\n")[2], "N190 G63 Z-20 F500 S320 M3")
        (finding,) = payload["findings"]
        self.assertEqual(finding["severity"], "warning")
        self.assertIn("thread block (G63)", finding["message"])

    def test_on_this_control_the_feed_type_decides_whether_s_is_a_cutting_speed(self):
        # G96 and G97 belong to the feed type: after `G95` the S1800 is revolutions again,
        # which is what a run that leaves surface speeds alone has to see.
        payload = self.output("sinumerik-feed-type")
        lines = payload["text"].split("\n")
        self.assertEqual((lines[2], lines[11]), ("N30 S1600 M3", "N150 S1440"))
        self.assertEqual(
            [f["message"] for f in payload["findings"] if "surface" in f["message"]],
            ["S200 is a surface speed (G96), so it is not scaled.", "S250 is a surface speed (G96), so it is not scaled."],
        )
        context = helpers.effective_context("sinumerik", params={"percent": 50, "surfaceSpeed": "no"})
        result = helpers.run_script(SCRIPT, stdin="N10 G961 S200 M4\nN20 G971 S1200\n", context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "N10 G961 S200 M4\nN20 G971 S600\n")
        self.assertEqual(payload["findings"][0]["message"], "S200 is a surface speed (G961), so it is not scaled.")

    def test_the_speeds_of_a_cycle_written_as_a_call_are_listed_and_left(self):
        payload = self.output("sinumerik-master-spindle")
        rows = [f["message"] for f in payload["findings"] if f["line"] == 36]
        self.assertEqual(len(rows), 2)
        self.assertIn("Argument 11 of CYCLE84 (SST, spindle speed while tapping) is 500", rows[0])
        self.assertIn("6 cycle speeds left unchanged", payload["message"])

    def test_lims_is_a_clamp_that_only_the_limit_option_scales(self):
        self.assertEqual(self.line("sinumerik-spindles", 7), "N40 G96 S220 LIMS=2800 M4")
        messages = [f["message"] for f in self.findings_on("sinumerik-spindles", 7)]
        self.assertEqual(messages, ["LIMS=2800 is a spindle speed limit, so it is not scaled."])
        self.assertEqual(self.line("sinumerik-speed-limits-all", 7), "N40 G96 S220 LIMS=3080 M4")
        self.assertEqual(self.line("sinumerik-speed-limits-all", 5), "N20 G26 S3300")

    def test_the_s_of_a_dwell_counts_revolutions_and_is_left(self):
        self.assertEqual(self.line("sinumerik-spindles", 10), "N70 G4 S2")
        self.assertEqual(self.findings_on("sinumerik-spindles", 10), [])
        self.assertIn(
            "1 dwell in spindle revolutions left as written", self.output("sinumerik-spindles")["message"]
        )

    def test_a_longer_name_that_starts_like_the_spindle_is_none_of_its_business(self):
        # `SPOS=` positions the spindle and `SPEED` could be a variable: neither is the
        # spindle's address extended by a number or a letter, so neither is reported.
        context = helpers.effective_context("sinumerik", params={"percent": 110})
        program = "N10 SPOS=0\nN20 SPEED=1200\nN30 S1000 M3\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertEqual(payload["text"], "N10 SPOS=0\nN20 SPEED=1200\nN30 S1100 M3\n")
        self.assertEqual(payload["findings"], [])

    def test_a_thread_after_another_spindle_speed_is_not_blamed_on_the_main_spindle(self):
        # The driven tool taps at its own speed (`SB=500` with `M13`); the main spindle's
        # scaled S1500 is not the speed that thread is cut at, so no warning says it is.
        context = helpers.effective_context("okuma-osp", params={"percent": 110})
        program = "G97 S1500 M03\nG00 X50 Z5\nM05\nM110\nSB=500 M13\nG184 X50 Z-10 C0 K3 F750 Q6\nG180\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        payload = result.json()
        self.assertIn("G97 S1650 M03", payload["text"])
        self.assertEqual([f["line"] for f in payload["findings"]], [5])
        self.assertNotIn("thread block", payload["message"])
        # The same tap straight after the scaled main-spindle speed is reported.
        program = "G97 S1500 M03\nG00 X50 Z5\nG184 X50 Z-10 C0 K3 F750 Q6\nG180\n"
        result = helpers.run_script(SCRIPT, stdin=program, context=context)
        self.assertTrue(result.ok, result.stderr)
        self.assertIn("1 thread block to check by hand", result.json()["message"])
