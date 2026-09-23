"""The Python modal interpreter (plan §7.4, AD-19). Owner: **WP6.4**.

Two kinds of test, and the split is the one the goldens' README asks for:

* **goldens** — ``tests/fixtures/modal/<profileId>/<case>.json``, a claim about a real
  synthetic program, read by this file now and by ``core/nc/modal.ts`` from M11. A golden
  says only what its case is about; a golden that listed everything would fail for reasons
  that have nothing to do with it.
* **unit tests over inline code lists** — a rule that has no program behind it. The Fanuc
  lathe rules are here (WP6.2 writes the data, WP6.6 the lathe goldens): ``G98`` / ``G99``
  as feed modes, ``G96`` / ``G97``, a ``G50`` clamp, a one-shot ``G71``, a modal ``G92``
  with a pitch feed, a ``DIAMOF``-like diameter switch, and a database with no distance
  code at all.

Every inline database here is **written for the test**. It is not a claim about any
control: what a control does belongs in ``src/lib/data`` and is reviewed by G10.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from tests.python import helpers

gedit_nc = helpers.import_gedit_nc()

#: ``tests/fixtures/modal``.
MODAL_DIR = helpers.FIXTURES_DIR / "modal"

#: Claims this work package writes down although another one still owes the data they need
#: (plan §5.2 rule 3). Each entry is a reason, printed when the claim is skipped; when it
#: starts holding, the test says so and asks for the entry to be removed, so the list
#: cannot rot into a way of ignoring a real failure.
PENDING: Dict[str, str] = {
    # Empty since I6: WP6.2 moved G43/G44/G49 to `lengthComp` (F25, plan §8.3), so
    # "length compensation is its own modal group" holds against the shipped database and
    # the claim now runs as an ordinary test.
}


def golden_files() -> List[Path]:
    """Every modal golden, sorted, as paths under ``tests/fixtures``."""
    if not MODAL_DIR.is_dir():
        return []
    return sorted(path for path in MODAL_DIR.glob("*/*.json"))


def relative_to_fixtures(path: Path) -> str:
    return str(path.relative_to(helpers.FIXTURES_DIR)).replace("\\", "/")


def cycle_of(state: Dict[str, Any]) -> Optional[str]:
    """The active cycle's code, or ``None``."""
    cycle = state["activeCycle"]
    return cycle["code"] if cycle is not None else None


def marked(value: Optional[str], record: Optional[Dict[str, Any]]) -> Optional[str]:
    """One value in the goldens' notation: ``G95``, ``=G95``, ``=G95@machine``."""
    if value is None or record is None:
        return None
    if not record.get("assumed"):
        return value
    source = record.get("from")
    if isinstance(source, str) and source != "" and source != "profile":
        return "=%s@%s" % (value, source)
    return "=" + value


def render(state: Dict[str, Any]) -> Dict[str, Any]:
    """The state as a golden writes it down."""
    groups = {name: marked(value.get("code"), value) for name, value in state["groups"].items()}
    tool = state["tool"]
    cycle = state["activeCycle"]
    diameter = state["diameter"]
    return {
        "groups": groups,
        "feedUnit": state["feedUnit"],
        "speedUnit": state["speedUnit"],
        "distance": state["distance"],
        "plane": state["plane"],
        "units": marked(state["units"]["value"], state["units"]),
        "diameter": marked(diameter["mode"], diameter) if diameter is not None else None,
        "tool": tool["station"] if tool is not None else None,
        "activeCycle": cycle["code"] if cycle is not None else None,
        "pitchFeedAmbiguous": state["pitchFeedAmbiguous"],
        "block": state["block"],
        "feed": state["feed"],
        "speed": state["speed"],
        "speedLimit": state["speedLimit"],
    }


class ModalTestCase(unittest.TestCase):
    """Shared machinery: run a program, and compare one state against a golden's claim."""

    def walk(
        self,
        profile: Dict[str, Any],
        codes: Sequence[Dict[str, Any]],
        lines: Sequence[str],
    ) -> List[Dict[str, Any]]:
        """The state after each line, 1-based: ``walk(...)[n - 1]`` is the state after n."""
        cp = gedit_nc.compile_profile(profile)
        interp = gedit_nc.ModalInterpreter(cp, codes)
        state = None
        out: List[Dict[str, Any]] = []
        for number, line in enumerate(lines, 1):
            tokens, state = gedit_nc.tokenize_line(line, cp, state)
            interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
            out.append(interp.state)
        return out

    def check(self, state: Dict[str, Any], after: Dict[str, Any], where: str) -> None:
        """Only the keys the golden lists are compared (plan §7.4)."""
        shown = render(state)
        for key, want in after.items():
            if key == "groups":
                for group, value in want.items():
                    with self.subTest(where=where, group=group):
                        self.assertEqual(shown["groups"].get(group), value)
            elif key == "block":
                for flag, value in want.items():
                    with self.subTest(where=where, flag=flag):
                        self.assertEqual(shown["block"].get(flag), value)
            elif key in ("feed", "speed", "speedLimit"):
                with self.subTest(where=where, key=key):
                    self.assertWordSeen(shown[key], want, "%s %s" % (where, key))
            else:
                with self.subTest(where=where, key=key):
                    self.assertEqual(shown[key], want, where)

    def assertWordSeen(self, got: Optional[Dict[str, Any]], want: Any, where: str) -> None:
        """A feed, speed or clamp: the value as written, or an object for its other fields."""
        if want is None:
            self.assertIsNone(got, where)
            return
        self.assertIsNotNone(got, where)
        if isinstance(want, str):
            self.assertEqual(got["valueText"], want, where)
            return
        for key, value in want.items():
            self.assertEqual(got.get(key), value, "%s.%s" % (where, key))

    def pending(self, name: str, run) -> None:
        """Runs a claim whose data another work package still owes (§5.2 rule 3).

        A listed claim that fails is skipped with the reason; one that **passes** fails the
        test and asks for it to be taken off the list, so the list empties itself.
        """
        reason = PENDING.get(name)
        if reason is None:
            run()
            return
        try:
            run()
        except AssertionError:
            self.skipTest("%s: %s" % (name, reason))
        self.fail("'%s' holds now: remove it from PENDING in %s" % (name, __file__))


# ---------------------------------------------------------------------------
# The goldens
# ---------------------------------------------------------------------------


class TestGoldens(ModalTestCase):
    """Every ``tests/fixtures/modal/**`` golden, the file both languages run."""

    def context_of(self, path: Path, golden: Dict[str, Any]) -> Dict[str, Any]:
        """The effective context this golden runs with, or a skip that says how to make it.

        A golden that names a machine needs its **generated** effective profile
        (``tests/fixtures/resolved/effective/**``, plan M6 P6 item 12), and only integration
        writes those (§5.2 rule 3). Until then it is a spec golden and is skipped with the
        command that ends the skip. A golden with no machine runs with the profile's own
        defaults, which is exactly what the generated entry for it would hold, so it runs
        today.
        """
        profile_id = golden.get("profile") or path.parent.name
        if "machine" not in golden:
            return helpers.effective_context(profile_id)
        try:
            return helpers.effective_context(golden=relative_to_fixtures(path))
        except AssertionError as err:
            self.skipTest(str(err))
            raise  # unreachable; keeps the type checkers and the reader happy

    def test_every_golden_says_which_program_it_is_about(self) -> None:
        files = golden_files()
        self.assertTrue(files, "no modal goldens found under %s" % MODAL_DIR)
        for path in files:
            with self.subTest(golden=relative_to_fixtures(path)):
                golden = json.loads(path.read_text(encoding="utf-8"))
                program = (path.parent / golden["input"]).resolve()
                self.assertTrue(program.is_file(), program)
                # Standing rule: a golden points at a synthetic program, never at a real
                # one (plan §9.2, D45).
                self.assertIn("WRITTEN FOR GEDIT", helpers.read_text(program))
                self.assertTrue(golden["states"], "a golden with no states claims nothing")

    def test_the_states_are_the_ones_the_interpreter_reaches(self) -> None:
        for path in golden_files():
            name = relative_to_fixtures(path)
            with self.subTest(golden=name):
                golden = json.loads(path.read_text(encoding="utf-8"))
                context = self.context_of(path, golden)
                lines = helpers.read_lines((path.parent / golden["input"]).resolve())
                states = self.walk(context["profile"], context["codes"], lines)
                for claim in golden["states"]:
                    line = claim["line"]
                    self.assertGreaterEqual(line, 1)
                    self.assertLessEqual(line, len(states), "%s line %d" % (name, line))
                    self.check(states[line - 1], claim["after"], "%s line %d" % (name, line))

    def test_the_two_profiles_the_work_package_owes_are_covered(self) -> None:
        # Plan WP6.4: at least 30 states for each of the two profiles.
        counts: Dict[str, int] = {}
        for path in golden_files():
            golden = json.loads(path.read_text(encoding="utf-8"))
            counts[path.parent.name] = counts.get(path.parent.name, 0) + len(golden["states"])
        for profile_id in ("fanuc-gcode", "heidenhain-klartext"):
            with self.subTest(profile=profile_id):
                self.assertGreaterEqual(counts.get(profile_id, 0), 30)


# ---------------------------------------------------------------------------
# The power-on state (AD-19 rule 8)
# ---------------------------------------------------------------------------


def profile_with(**members: Any) -> Dict[str, Any]:
    """A minimal profile for a unit test: only what the interpreter reads."""
    profile: Dict[str, Any] = {
        "id": "test",
        "grammar": "iso",
        "codes": "test",
        "addresses": {"axes": ["X", "Y", "Z"], "feed": "F", "spindle": "S", "tool": "T"},
        "toolCall": {"trigger": "(?<![A-Z])M0*6(?!\\d)", "tool": "(?<![A-Z])T(?<tool>\\d+)",
                     "toolFrom": "same-line-or-last"},
        "syntax": {"blockNumber": {"mode": "prefix", "prefix": "N"}, "comments": [{"start": "(", "end": ")"}],
                   "decimalSeparator": ".",
                   # A lathe writes its diameter switch as a word, not as a G code.
                   "keywords": ["DIAMON", "DIAMOF", "DIAM90"]},
        "numbering": {},
    }
    profile.update(members)
    return profile


#: A handful of entries that behave like a Fanuc lathe in G-code system A. Written for
#: these tests; the shipped data is WP6.2's and is reviewed by G10.
LATHE_CODES: List[Dict[str, Any]] = [
    {"code": "G0", "group": "motion", "modal": True, "label": "rapid"},
    {"code": "G1", "group": "motion", "modal": True, "label": "feed"},
    {"code": "G18", "group": "plane", "modal": True, "label": "ZX plane", "sets": {"plane": "ZX"}},
    {"code": "G32", "group": "motion", "modal": True, "label": "thread cut", "pitchFeed": True},
    {"code": "G50", "group": "nonmodal", "label": "speed clamp", "sets": {"speedLimit": True}},
    {"code": "G70", "group": "cycle", "label": "finishing", "sets": {"cycle": "start"}},
    {"code": "G71", "group": "cycle", "label": "roughing", "sets": {"cycle": "start"}},
    {"code": "G76", "group": "cycle", "label": "threading", "pitchFeed": True,
     "sets": {"cycle": "start"}},
    {"code": "G92", "group": "motion", "modal": True, "label": "single-pass threading",
     "pitchFeed": True, "sets": {"cycle": "start"}},
    {"code": "G96", "group": "spindlemode", "modal": True, "label": "surface speed",
     "sets": {"speedUnit": "surface"}},
    {"code": "G97", "group": "spindlemode", "modal": True, "label": "rpm",
     "sets": {"speedUnit": "rpm"}},
    {"code": "G98", "group": "feedmode", "modal": True, "label": "per minute",
     "sets": {"feedUnit": "per-minute"}},
    {"code": "G99", "group": "feedmode", "modal": True, "label": "per revolution",
     "sets": {"feedUnit": "per-rev"}},
    {"code": "DIAMON", "group": "diametermode", "modal": True, "label": "diameter",
     "sets": {"diameter": "on"}},
    {"code": "DIAMOF", "group": "diametermode", "modal": True, "label": "radius",
     "sets": {"diameter": "off"}},
    {"code": "DIAM90", "group": "diametermode", "modal": True, "label": "mixed",
     "sets": {"diameter": "absolute-only"}},
    {"code": "G90", "group": "distance", "modal": True, "label": "absolute",
     "sets": {"distance": "absolute"}},
    {"code": "G91", "group": "distance", "modal": True, "label": "incremental",
     "sets": {"distance": "incremental"}},
]

#: The lathe profile the tests above run with: system A powers on in G99, G97 and G18.
LATHE_PROFILE = profile_with(
    machineType="lathe",
    addresses={"axes": ["X", "Z", "U", "W"], "feed": "F", "spindle": "S", "tool": "T",
               "incremental": {"U": "X", "W": "Z"}, "diameter": ["X", "U"]},
    modal={"initial": {"feedmode": "G99", "spindlemode": "G97", "plane": "G18"},
           "units": "mm", "diameter": "on",
           "sources": {"feedmode": "profile", "spindlemode": "profile", "plane": "profile",
                       "units": "profile", "diameter": "profile"}},
)


class TestPowerOnState(ModalTestCase):
    """AD-19 rule 8: what is assumed at line 0, and what is not."""

    def test_the_initial_codes_are_applied_with_their_source(self) -> None:
        state = self.walk(LATHE_PROFILE, LATHE_CODES, ["(NOTHING YET)"])[0]
        shown = render(state)
        self.assertEqual(
            {name: shown["groups"][name] for name in ("feedmode", "spindlemode", "plane")},
            {"feedmode": "=G99", "spindlemode": "=G97", "plane": "=G18"},
        )
        self.assertEqual((shown["feedUnit"], shown["speedUnit"], shown["plane"]),
                         ("per-rev", "rpm", "ZX"))
        self.assertEqual((shown["units"], shown["diameter"]), ("=mm", "=on"))

    def test_the_source_of_an_assumed_value_is_the_one_modal_sources_names(self) -> None:
        # A profile as `applyMachine` leaves it when the machine set the feed mode and a
        # detected variant set the plane (plan §7.15 ParamSource).
        profile = profile_with(
            modal={"initial": {"feedmode": "G99", "plane": "G18"}, "units": "inch",
                   "sources": {"feedmode": "machine", "plane": "detected", "units": "machine"}}
        )
        shown = render(self.walk(profile, LATHE_CODES, [""])[0])
        self.assertEqual(shown["groups"]["feedmode"], "=G99@machine")
        self.assertEqual(shown["groups"]["plane"], "=G18@detected")
        self.assertEqual(shown["units"], "=inch@machine")

    def test_what_the_program_writes_ends_the_assumption(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["G99", "G98"])
        self.assertEqual(render(states[0])["groups"]["feedmode"], "G99")
        self.assertEqual(render(states[1])["groups"]["feedmode"], "G98")
        self.assertEqual(states[1]["groups"]["feedmode"]["line"], 2)

    def test_a_group_nothing_named_is_unknown_rather_than_guessed(self) -> None:
        shown = render(self.walk(profile_with(), LATHE_CODES, [""])[0])
        self.assertEqual(shown["groups"], {})
        self.assertEqual(shown["units"], "unknown")
        self.assertIsNone(shown["diameter"])
        self.assertEqual((shown["plane"], shown["feedUnit"], shown["speedUnit"]),
                         ("unknown", "unknown", "unknown"))

    def test_a_database_without_a_distance_code_leaves_one_reading_only(self) -> None:
        # Fanuc G-code system A has no G91, and Klartext has no distance code at all: the
        # only thing such a database allows is absolute, and that is not an assumption.
        without = [entry for entry in LATHE_CODES if entry["code"] not in ("G90", "G91")]
        self.assertEqual(self.walk(LATHE_PROFILE, without, [""])[0]["distance"], "absolute")

    def test_a_database_with_distance_codes_stays_unknown_until_one_is_written(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["G0 X10.", "G91", "G90"])
        self.assertEqual([state["distance"] for state in states],
                         ["unknown", "incremental", "absolute"])

    def test_reset_puts_it_back_where_it_started(self) -> None:
        cp = gedit_nc.compile_profile(LATHE_PROFILE)
        interp = gedit_nc.ModalInterpreter(cp, LATHE_CODES)
        before = interp.state
        tokens, _ = gedit_nc.tokenize_line("G98 G96 S180 G1 X10. F0.2", cp, None)
        interp.update(tokens, 1)
        self.assertNotEqual(interp.state, before)
        interp.reset()
        self.assertEqual(interp.state, before)


# ---------------------------------------------------------------------------
# The lathe rules, over inline code lists
# ---------------------------------------------------------------------------


class TestLatheRules(ModalTestCase):
    """The rules a turning program needs, before WP6.2's data and WP6.6's goldens exist."""

    def test_g98_and_g99_are_the_feed_modes_of_this_database(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["G99 G1 X20. F0.25", "G98 F250.", "G99"])
        self.assertEqual([state["feedUnit"] for state in states],
                         ["per-rev", "per-minute", "per-rev"])
        self.assertEqual([state["feed"]["valueText"] for state in states],
                         ["0.25", "250.", "250."])

    def test_the_feed_mode_is_read_from_the_database_and_not_from_the_number(self) -> None:
        # The point of F24: on this database `G94` is not a feed mode at all, so a lathe
        # program that writes it (a facing cycle in G-code system A) keeps its feed unit.
        facing = LATHE_CODES + [{"code": "G94", "group": "cycle", "label": "facing",
                                 "sets": {"cycle": "start"}}]
        states = self.walk(LATHE_PROFILE, facing, ["G99 G1 X20. F0.25", "G94 X10. Z-5. F0.3"])
        self.assertEqual([state["feedUnit"] for state in states], ["per-rev", "per-rev"])
        self.assertEqual(states[1]["block"]["cycle"], "G94")

    def test_constant_surface_speed_switches_what_an_s_word_means(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["G97 S1200", "G96 S220 M3", "G97 S1500"])
        self.assertEqual([state["speedUnit"] for state in states], ["rpm", "surface", "rpm"])
        self.assertEqual([state["speed"]["valueText"] for state in states],
                         ["1200", "220", "1500"])

    def test_a_clamp_block_does_not_change_the_speed(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES,
                           ["G97 S1200 M3", "G50 S2500", "G96 S220"])
        self.assertIsNone(states[0]["speedLimit"])
        self.assertEqual(states[1]["speedLimit"]["valueText"], "2500")
        self.assertEqual(states[1]["speed"]["valueText"], "1200")
        self.assertTrue(states[1]["block"]["speedLimit"])
        # The clamp stays in force; the flag belongs to its own block.
        self.assertEqual(states[2]["speedLimit"]["valueText"], "2500")
        self.assertEqual(states[2]["speed"]["valueText"], "220")
        self.assertFalse(states[2]["block"]["speedLimit"])

    def test_the_word_order_inside_a_clamp_block_does_not_matter(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["S2500 G50"])
        self.assertEqual(states[0]["speedLimit"]["valueText"], "2500")
        self.assertIsNone(states[0]["speed"])

    def test_a_one_shot_cycle_belongs_to_its_own_block(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES,
                           ["G71 U2. R0.5", "G71 P100 Q200 U0.4 W0.1 F0.3", "G1 X20. F0.2"])
        self.assertEqual([state["block"]["cycle"] for state in states], ["G71", "G71", None])
        # It is never an *active* cycle: it is over when its block is (AD-19 rule 2).
        self.assertEqual([cycle_of(state) for state in states], [None, None, None])

    def test_a_one_shot_threading_cycle_makes_only_its_own_f_a_lead(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES,
                           ["G76 P020060 Q100 R0.05", "G76 X18.16 Z-20. P1190 Q350 F2.0",
                            "G0 X100. Z100."])
        self.assertEqual([state["block"]["pitchFeed"] for state in states], [True, True, False])
        self.assertEqual(states[1]["feed"]["valueText"], "2.0")

    def test_a_modal_threading_cycle_stays_until_a_move_cancels_it(self) -> None:
        # G92 in G-code system A is a single-pass threading cycle in the motion group: it
        # repeats until another motion code replaces it.
        states = self.walk(LATHE_PROFILE, LATHE_CODES,
                           ["G92 X19.5 Z-20. F2.0", "X19.2", "X19.0", "G0 X100."])
        self.assertEqual([cycle_of(state) for state in states], ["G92", "G92", "G92", None])
        self.assertEqual([state["block"]["pitchFeed"] for state in states],
                         [True, False, False, False])
        self.assertEqual([state["groups"]["motion"]["code"] for state in states],
                         ["G92", "G92", "G92", "G0"])

    def test_a_threading_pass_is_a_move_whose_feed_is_a_lead(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["G32 X20. Z-10. F1.5", "G0 X30."])
        self.assertEqual([cycle_of(state) for state in states], ["G32", None])

    def test_the_diameter_mode_is_switched_by_the_database(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["(START)", "DIAMOF", "DIAMON"])
        self.assertEqual([render(state)["diameter"] for state in states], ["=on", "off", "on"])

    def test_whether_a_word_is_a_diameter_follows_the_distance_mode_too(self) -> None:
        # AD-19 rule 11. DIAM90 is a diameter while the program is absolute and a radius
        # while it is incremental, so the mode alone never answers the question.
        cp = gedit_nc.compile_profile(LATHE_PROFILE)
        interp = gedit_nc.ModalInterpreter(cp, LATHE_CODES)
        self.assertEqual(interp.diameter_reading("X"), "diameter")
        self.assertEqual(interp.diameter_reading("Z"), "radius")
        for line, number, expected in (("DIAMOF", 1, "radius"), ("DIAM90 G90", 2, "diameter"),
                                       ("G91", 3, "radius"), ("G90", 4, "diameter")):
            tokens, _ = gedit_nc.tokenize_line(line, cp, None)
            interp.update(tokens, number)
            self.assertEqual(interp.diameter_reading("X"), expected, line)

    def test_a_mill_profile_has_no_diameter_mode_at_all(self) -> None:
        state = self.walk(profile_with(), LATHE_CODES, [""])[0]
        self.assertIsNone(state["diameter"])


# ---------------------------------------------------------------------------
# The rules that hold whatever the dialect is
# ---------------------------------------------------------------------------


class TestGeneralRules(ModalTestCase):
    def test_an_unknown_code_changes_nothing(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES,
                           ["G99 G1 X10. F0.2", "G137 X20.", "M123"])
        self.assertEqual(render(states[1])["groups"], render(states[0])["groups"])
        self.assertEqual(render(states[2])["groups"], render(states[0])["groups"])
        self.assertEqual(states[2]["feedUnit"], "per-rev")

    def test_a_modal_group_keeps_one_code_at_a_time(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["G0 X10.", "G1 X20. F0.2"])
        self.assertEqual([state["groups"]["motion"]["code"] for state in states], ["G0", "G1"])

    def test_two_groups_do_not_touch_each_other(self) -> None:
        # A code of one group may never clear another group's code. On the shipped Fanuc
        # mill database this is what keeps `G41` alive across the `G49` of a safety line.
        codes = [
            {"code": "G41", "group": "compensation", "modal": True, "label": "left"},
            {"code": "G40", "group": "compensation", "modal": True, "label": "off"},
            {"code": "G43", "group": "lengthComp", "modal": True, "label": "length"},
            {"code": "G49", "group": "lengthComp", "modal": True, "label": "length off"},
        ]
        states = self.walk(profile_with(), codes, ["G41 D1", "G49", "G40"])
        self.assertEqual([state["groups"]["compensation"]["code"] for state in states],
                         ["G41", "G41", "G40"])
        self.assertEqual(states[1]["groups"]["lengthComp"]["code"], "G49")

    def test_the_shipped_mill_database_keeps_length_compensation_apart(self) -> None:
        def claim() -> None:
            context = helpers.effective_context("fanuc-gcode")
            states = self.walk(context["profile"], context["codes"], ["G41 D1 G1 X10. F200.", "G49"])
            self.assertEqual(states[1]["groups"]["compensation"]["code"], "G41")

        self.pending("length compensation is its own modal group", claim)

    def test_a_comment_never_reaches_the_state(self) -> None:
        states = self.walk(LATHE_PROFILE, LATHE_CODES, ["(G98 S1000 F250.)", "G1 X10. F0.2"])
        self.assertEqual(states[0]["feedUnit"], "per-rev")
        self.assertIsNone(states[0]["feed"])
        self.assertIsNone(states[0]["speed"])

    def test_a_tool_line_is_the_profile_s_trigger_and_not_a_t_word(self) -> None:
        states = self.walk(profile_with(), LATHE_CODES, ["T1", "T1 M6", "T2", "M6"])
        self.assertEqual([state["tool"] and state["tool"]["station"] for state in states],
                         [None, "1", "1", "2"])
        self.assertEqual([state["block"]["toolChange"] for state in states],
                         [False, True, False, True])

    def test_a_tool_line_the_profile_tells_it_to_ignore_is_not_one(self) -> None:
        # A Fanuc lathe writes `T0100` to cancel the offset of station 1 (plan §7.1).
        profile = profile_with(
            toolCall={"trigger": "(?<![A-Z])T\\d{2,4}(?!\\d)", "tool": "(?<![A-Z])T(?<tool>\\d{2})\\d{0,2}",
                      "toolFrom": "same-line", "ignore": "(?<![A-Z])T(\\d\\d)?00(?!\\d)"}
        )
        states = self.walk(profile, LATHE_CODES, ["T0101", "G0 X100. Z100. T0100", "T0303"])
        self.assertEqual([state["tool"]["station"] for state in states], ["01", "01", "03"])
        self.assertEqual([state["block"]["toolChange"] for state in states], [True, False, True])

    def test_the_tool_word_of_the_line_above_counts_when_the_profile_says_so(self) -> None:
        states = self.walk(profile_with(), LATHE_CODES, ["T5", "M6", "M6"])
        self.assertEqual([state["tool"] and state["tool"]["station"] for state in states],
                         [None, "5", "5"])
        self.assertEqual(states[1]["tool"]["line"], 2)

    def test_a_line_without_masked_text_leaves_the_tool_alone(self) -> None:
        # `masked` is optional: a caller that does not need the tool does not have to mask
        # every line to use the rest of the state.
        cp = gedit_nc.compile_profile(profile_with())
        interp = gedit_nc.ModalInterpreter(cp, LATHE_CODES)
        tokens, _ = gedit_nc.tokenize_line("T1 M6", cp, None)
        interp.update(tokens, 1)
        self.assertIsNone(interp.state["tool"])
        self.assertFalse(interp.state["block"]["toolChange"])

    def test_the_state_is_a_copy(self) -> None:
        cp = gedit_nc.compile_profile(LATHE_PROFILE)
        interp = gedit_nc.ModalInterpreter(cp, LATHE_CODES)
        state = interp.state
        state["groups"].clear()
        state["block"]["cycle"] = "G71"
        self.assertIn("feedmode", interp.state["groups"])
        self.assertIsNone(interp.state["block"]["cycle"])


class TestSpeedLimitOf(unittest.TestCase):
    """`speed_limit_of` (plan WP6.4): which code makes this block's S a clamp."""

    def setUp(self) -> None:
        self.cp = gedit_nc.compile_profile(LATHE_PROFILE)

    def limit(self, line: str, codes: Optional[Sequence[Dict[str, Any]]] = None) -> Optional[str]:
        tokens, _ = gedit_nc.tokenize_line(line, self.cp, None)
        from _nc_modal import speed_limit_of  # the helper WP6.6 reads through gedit_nc

        return speed_limit_of(LATHE_CODES if codes is None else codes, tokens)

    def test_a_block_with_a_speed_limit_code_names_it(self) -> None:
        self.assertEqual(self.limit("G50 S2500"), "G50")
        self.assertEqual(self.limit("S2500 G50 M3"), "G50")

    def test_a_written_form_answers_the_canonical_code(self) -> None:
        self.assertEqual(self.limit("G050 S2500"), "G50")

    def test_a_block_without_one_answers_nothing(self) -> None:
        self.assertIsNone(self.limit("G96 S220 M3"))
        self.assertIsNone(self.limit("G50 S2500", codes=[]))

    def test_the_code_is_the_database_s_and_not_a_list_in_a_script(self) -> None:
        # F24: `G50` is a clamp because this database says so. On a database that does not,
        # it is not — which is the whole reason the helper exists.
        without = [entry for entry in LATHE_CODES if entry["code"] != "G50"]
        self.assertIsNone(self.limit("G50 S2500", codes=without))


class TestFeedModeTrackerIsAWrapper(ModalTestCase):
    """Phase 1's tracker, now reading the same rules (plan §7.10 is unchanged for scripts).

    The Phase 1 behaviour itself is pinned by `test_gedit_nc.py`; what is here is what M6
    adds: a database whose feed modes are not `G94` / `G95`, and a one-shot cycle.
    """

    def walk_tracker(self, profile: Dict[str, Any], codes, lines):
        cp = gedit_nc.compile_profile(profile)
        tracker = gedit_nc.FeedModeTracker(codes)
        state = None
        out = []
        for line in lines:
            tokens, state = gedit_nc.tokenize_line(line, cp, state)
            tracker.update(tokens)
            out.append((tracker.feed_mode, tracker.css, tracker.active_cycle, tracker.pitch_feed))
        return out

    def test_a_lathe_feed_per_revolution_reads_as_the_phase_1_name(self) -> None:
        # `G99` is per revolution, so a script written against §7.10 sees `'G95'` and does
        # what it always did with a per-revolution feed — without knowing the lathe exists.
        states = self.walk_tracker(LATHE_PROFILE, LATHE_CODES, ["G99 F0.25", "G98 F250."])
        self.assertEqual([state[0] for state in states], ["G95", "G94"])

    def test_a_lathe_facing_cycle_is_not_read_as_a_feed_mode(self) -> None:
        facing = LATHE_CODES + [{"code": "G94", "group": "cycle", "label": "facing",
                                 "sets": {"cycle": "start"}}]
        states = self.walk_tracker(LATHE_PROFILE, facing, ["G99 F0.25", "G94 X10. Z-5. F0.3"])
        self.assertEqual([state[0] for state in states], ["G95", "G95"])
        self.assertEqual(states[1][2], "G94")

    def test_surface_speed_comes_from_the_database(self) -> None:
        states = self.walk_tracker(LATHE_PROFILE, LATHE_CODES, ["G97 S1200", "G96 S220", "G97"])
        self.assertEqual([state[1] for state in states], [False, True, False])

    def test_a_one_shot_cycle_is_reported_for_its_own_block_only(self) -> None:
        states = self.walk_tracker(LATHE_PROFILE, LATHE_CODES,
                                   ["G76 X18.16 Z-20. P1190 Q350 F2.0", "G0 X100."])
        self.assertEqual([(state[2], state[3]) for state in states], [("G76", True), (None, False)])

    def test_an_entry_without_sets_is_still_read_the_phase_1_way(self) -> None:
        # A user script may hand in a database of its own, written before `sets` existed.
        old = [{"code": "G71", "group": "cycle", "pitchFeed": True, "params": [{"address": "F"}]},
               {"code": "G1", "group": "motion"}]
        states = self.walk_tracker(profile_with(), old, ["G71 Z-10. F1.5", "G1 X10. F250."])
        self.assertEqual([(state[2], state[3]) for state in states], [("G71", True), (None, False)])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
