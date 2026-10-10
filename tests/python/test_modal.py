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

M8 (WP8.7) adds the goldens of the two turning dialects — ``okuma-osp`` with and without a
machine, under the 1 µm and 10 µm unit systems too, and ``sinumerik`` with its diameter mode
assumed on and a machine that starts it off — and the unit tests of what a code and a
speed are in the token forms of AD-24: a call is the code of its identifier, a word written
with ``=`` is never a code, and a dwell's speed word is not a speed. Those run the shipped
profiles, so they need the Python tokenizer of WP8.6.
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
        "definedCycle": state["definedCycle"]["code"] if state["definedCycle"] is not None else None,
        "modalCall": state["modalCall"]["code"] if state["modalCall"] is not None else None,
        # P10 (rules 13 and 14): the frame in force and tool centre point control, by code.
        "frame": state["frame"]["code"] if state["frame"] is not None else None,
        "tcp": state["tcp"]["code"] if state["tcp"] is not None else None,
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

    def test_the_turning_dialects_of_m8_are_covered_with_and_without_a_machine(self) -> None:
        # Plan WP8.7: goldens for both dialects, among them a machine that changes what the
        # control powers on in (the Sinumerik diameter mode) and the Okuma unit systems.
        counts: Dict[str, int] = {}
        machines: Dict[str, List[Any]] = {}
        for path in golden_files():
            golden = json.loads(path.read_text(encoding="utf-8"))
            counts[path.parent.name] = counts.get(path.parent.name, 0) + len(golden["states"])
            if "machine" in golden:
                machines.setdefault(path.parent.name, []).append(golden["machine"])
        for profile_id in ("okuma-osp", "sinumerik"):
            with self.subTest(profile=profile_id):
                self.assertGreaterEqual(counts.get(profile_id, 0), 30)
        self.assertIn({"diameter": "off"}, machines.get("sinumerik", []))
        modes = [m.get("numberInput", {}).get("mode") for m in machines.get("okuma-osp", [])]
        self.assertEqual(modes.count("scale"), 2, "the 1 µm and the 10 µm unit system")


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


# ---------------------------------------------------------------------------
# The turning dialects (M8, WP8.7), over inline code lists
# ---------------------------------------------------------------------------

#: Entries that behave like the ones the M8 databases ship, **written for these tests**.
#: `M33` is here only so that `M3=3` could be misread as it; it claims nothing about a control.
TURNING_CODES: List[Dict[str, Any]] = [
    {"code": "G0", "group": "motion", "modal": True, "label": "rapid"},
    {"code": "G1", "group": "motion", "modal": True, "label": "feed"},
    {"code": "G4", "group": "nonmodal", "label": "dwell", "fNotFeed": True},
    {"code": "G96", "group": "spindlemode", "modal": True, "label": "surface speed",
     "sets": {"speedUnit": "surface"}},
    {"code": "G97", "group": "spindlemode", "modal": True, "label": "rpm", "sets": {"speedUnit": "rpm"}},
    {"code": "M3", "group": "spindle", "modal": True, "label": "spindle on"},
    {"code": "M5", "group": "spindle", "modal": True, "label": "spindle stop"},
    {"code": "M33", "group": "spindle", "modal": True, "label": "a code M3=3 must not become"},
    {"code": "CYCLE81", "group": "cycle", "label": "drilling", "sets": {"cycle": "start"}},
    {"code": "CYCLE84", "group": "cycle", "label": "tapping", "pitchFeed": True,
     "sets": {"cycle": "start"}},
]


class TestTurningDialects(ModalTestCase):
    """What a code is, and what a speed is, in the token forms of AD-24 (plan §7.5).

    The profiles are the shipped ones, so their tokenizer rules apply (calls, assignments,
    names); the code lists are the ones above, so each rule is shown on exactly one entry.
    """

    def run_lines(self, profile_id: str, lines: Sequence[str]) -> List[Dict[str, Any]]:
        return self.walk(helpers.effective_context(profile_id)["profile"], TURNING_CODES, lines)

    def test_a_call_is_the_code_of_its_identifier(self) -> None:
        states = self.run_lines("sinumerik", ["CYCLE81(5,0,2,-10)", "CYCLE84(5,0,2,-15,,0.5,3,,1.5)", "G0 X10"])
        self.assertEqual([state["block"]["cycle"] for state in states], ["CYCLE81", "CYCLE84", None])
        self.assertEqual([state["block"]["pitchFeed"] for state in states], [False, True, False])
        self.assertEqual([cycle_of(state) for state in states], [None, None, None])

    def test_an_assignment_word_is_never_a_code(self) -> None:
        # `M3=3` switches spindle 3. It is not the code M33, and not the M3 of the spindle
        # this state follows either.
        states = self.run_lines("sinumerik", ["M5", "M3=3", "M3"])
        self.assertEqual([state["groups"]["spindle"]["code"] for state in states], ["M5", "M5", "M3"])

    def test_a_numbered_spindle_speed_is_the_speed_in_force_only_for_the_main_spindle(self) -> None:
        # M10 P10 (decision 3; the owner, 2026-09-27: "we consider S1= as main spindle"):
        # `S1=` and `S[1]=` name spindle 1, the profile's `addresses.mainSpindle`, so they are
        # the speed in force like the plain `S`; `S3=` and `S[2]=` stay other spindles'.
        # Until M10 `S1=900` left the speed at 500.
        states = self.run_lines("sinumerik", ["S500 M3", "S3=2400", "S1=900 M1=3", "S[2]=100", "S[1]=700", "G4 S1=3"])
        self.assertEqual(
            [state["speed"]["valueText"] for state in states], ["500", "500", "900", "900", "700", "700"]
        )
        # A dwell's revolutions are no speed, whichever way the spindle is named (rule 6).
        self.assertTrue(states[5]["block"]["fNotFeed"])

    def test_without_a_main_spindle_every_numbered_word_is_another_spindle(self) -> None:
        profile = dict(helpers.effective_context("sinumerik")["profile"])
        profile["addresses"] = {k: v for k, v in profile["addresses"].items() if k != "mainSpindle"}
        states = self.walk(profile, TURNING_CODES, ["S500 M3", "S1=900", "S[1]=700"])
        self.assertEqual([state["speed"]["valueText"] for state in states], ["500", "500", "500"])

    def test_an_indexed_spindle_word_is_neither_the_speed_nor_the_clamp_nor_a_code(self) -> None:
        # M9 review F1: `S[2]=500` became the speed in force, `LIMS[2]=1800` the main
        # clamp, and `M[2]=5` the code M5 of the spindle this state follows. The index names
        # spindle 2, as the address of `S2=` and `M2=` does.
        states = self.run_lines(
            "sinumerik", ["G96 S200 LIMS=3000 M3", "S[2]=500", "LIMS[2]=1800", "M[2]=5", "S2=600 M2=3"]
        )
        self.assertEqual([state["speed"]["valueText"] for state in states], ["200"] * 5)
        self.assertEqual([state["speedLimit"]["valueText"] for state in states], ["3000"] * 5)
        self.assertEqual([state["groups"]["spindle"]["code"] for state in states], ["M3"] * 5)

    def test_the_speed_word_of_a_dwell_block_is_not_a_speed(self) -> None:
        states = self.run_lines("sinumerik", ["G97 S500 M3", "G4 S2", "G4 F1.5", "G1 X10 F0.2"])
        self.assertEqual([state["speed"]["valueText"] for state in states], ["500"] * 4)
        self.assertEqual([state["feed"] and state["feed"]["valueText"] for state in states],
                         [None, None, None, "0.2"])
        self.assertEqual([state["block"]["fNotFeed"] for state in states], [False, True, True, False])
        self.assertEqual([state["speedLimit"] for state in states], [None] * 4)

    def test_a_clamp_word_is_a_clamp_wherever_it_stands(self) -> None:
        (state,) = self.run_lines("sinumerik", ["G96 S200 LIMS=3000 M4"])
        self.assertEqual((state["speed"]["valueText"], state["speedLimit"]["valueText"]), ("200", "3000"))
        # The block's own S is the cutting speed: the flag of rule 4 is a code's, not a word's.
        self.assertFalse(state["block"]["speedLimit"])

    def test_a_driven_tool_speed_is_not_the_main_spindle_speed(self) -> None:
        states = self.run_lines("okuma-osp", ["G97 S1500 M03", "SB=2000 M13"])
        self.assertEqual([state["speed"]["valueText"] for state in states], ["1500", "1500"])

    def test_a_feed_written_as_a_variable_has_no_value(self) -> None:
        for profile_id, line, text in (("okuma-osp", "G01 Z-30 F=V1", "V1"), ("sinumerik", "G1 X70 F=R1", "R1")):
            with self.subTest(profile=profile_id):
                (state,) = self.run_lines(profile_id, [line])
                self.assertEqual(state["feed"], {"valueText": text, "line": 1, "variable": True})

    def test_an_okuma_dollar_line_belongs_to_the_block_above_it(self) -> None:
        # G10 M8 NC finding 9: a line that starts with `$` continues the block above it, so
        # the one-shot G71 thread cycle and its lead cover it; the next line is a new block.
        # The interpreter reads the marker off its own profile (`syntax.continuationStart`).
        context = helpers.effective_context("okuma-osp")
        lines = ["G97 S800 M03", "N001 G71 X27.55 Z-30 B60 D0.7 U0.1", "$ H2.45 L2 F2 M23 M32 M73", "G00 X600 Z400"]
        states = self.walk(context["profile"], context["codes"], lines)
        self.assertEqual([state["block"]["pitchFeed"] for state in states], [False, True, True, False])
        self.assertEqual([state["block"]["cycle"] for state in states], [None, "G71", "G71", None])

    def test_the_shipped_okuma_database_switches_x_to_a_radius_in_y_axis_mode(self) -> None:
        # The source review (2026-09): coordinate conversion (G137) and the Y-axis mode
        # (G138) program X as a radius until G136, so extents and address arithmetic must
        # not read the X of a live-tool section at twice its value.
        context = helpers.effective_context("okuma-osp")
        lines = ["G00 X100 Z50", "G138", "G01 X20 Y5 F200", "G136", "G137 C0", "G01 X10 Y10", "G136"]
        states = self.walk(context["profile"], context["codes"], lines)
        self.assertEqual(
            [state["diameter"]["mode"] for state in states],
            ["on", "off", "off", "on", "off", "off", "on"],
        )

    def test_the_shipped_klartext_database_reads_m136_as_feed_per_revolution(self) -> None:
        # The source review (2026-09): M136 makes F a distance per spindle revolution until
        # M137. Without it a plain F under M136 was read as a feed per minute.
        context = helpers.effective_context("heidenhain-klartext")
        lines = ["1 TOOL CALL 5 Z S800", "2 M136", "3 L X+10 F0.2", "4 M137", "5 L X+20 F200"]
        states = self.walk(context["profile"], context["codes"], lines)
        self.assertEqual([state["feedUnit"] for state in states][1:], ["per-rev", "per-rev", "per-minute", "per-minute"])

    def test_the_shipped_sinumerik_database_reads_the_feed_type_as_one_group(self) -> None:
        # The M8 NC review: on this control G94, G95, G96 and G97 are one group. G96 makes
        # the feed a feed per revolution, and G95 ends the constant cutting speed.
        context = helpers.effective_context("sinumerik")
        lines = ["N10 G18 G90 G94 DIAMON", "N70 G96 S200 LIMS=3000 M4", "N140 G95 G1 X60 Z2 F0.12", "N150 S1800", "N160 G961 S180", "N170 G971"]
        states = self.walk(context["profile"], context["codes"], lines)
        self.assertEqual(
            [(state["groups"]["feedmode"]["code"], state["feedUnit"], state["speedUnit"]) for state in states],
            [
                ("G94", "per-minute", "rpm"),
                ("G96", "per-rev", "surface"),
                ("G95", "per-rev", "rpm"),
                ("G95", "per-rev", "rpm"),
                ("G961", "per-minute", "surface"),
                ("G971", "per-minute", "rpm"),
            ],
        )
        self.assertNotIn("spindlemode", states[-1]["groups"])

    def test_the_tracker_names_a_dwell_block(self) -> None:
        cp = gedit_nc.compile_profile(helpers.effective_context("okuma-osp")["profile"])
        tracker = gedit_nc.FeedModeTracker(TURNING_CODES)
        seen = []
        state = None
        for line in ("G04 F1", "G01 Z-10 F0.2"):
            tokens, state = gedit_nc.tokenize_line(line, cp, state)
            tracker.update(tokens)
            seen.append((tracker.f_not_feed, tracker.f_not_feed_code))
        self.assertEqual(seen, [(True, "G4"), (False, None)])


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


#: Entries for the tapping tests, **written for these tests**: a tapping mode of its own
#: group (Fanuc `G63`, ended by `G64`), a modal tapping cycle, a rigid-tapping M code, a
#: threading pass and a macro call whose words are data.
TAPPING_CODES: List[Dict[str, Any]] = [
    {"code": "G0", "group": "motion", "modal": True, "label": "rapid"},
    {"code": "G1", "group": "motion", "modal": True, "label": "feed"},
    {"code": "G32", "group": "motion", "modal": True, "pitchFeed": True, "label": "thread pass"},
    {"code": "G63", "group": "pathmode", "modal": True, "pitchFeed": True, "tapping": True, "label": "tapping mode"},
    {"code": "G64", "group": "pathmode", "modal": True, "label": "cutting mode"},
    {"code": "G65", "group": "nonmodal", "wordsAreData": True, "label": "macro call"},
    {"code": "G80", "group": "cycle", "modal": True, "label": "cancel", "sets": {"cycle": "cancel"}},
    {"code": "G84", "group": "cycle", "modal": True, "pitchFeed": True, "tapping": True, "label": "tap",
     "sets": {"cycle": "start"}},
    {"code": "M29", "group": "spindle", "tapping": True, "label": "rigid tapping"},
]


class TestTappingInTheTracker(ModalTestCase):
    """2026-09: what scale_speed asks the tracker about taps (owner decision of 2026-09-27).

    ``tapping`` / ``tapping_code`` come from the database's ``tapping`` flag on a code of the
    block, on the cycle in force or on a mode in force; ``pitch_mode`` is a modal
    ``pitchFeed`` code outside the cycle and motion groups (the ``G63`` decision of TODO
    Next up 8); ``data_code`` is a ``wordsAreData`` code of the block.
    """

    def walk(self, lines, profile_id="fanuc-gcode", codes=None):
        cp = gedit_nc.compile_profile(helpers.effective_context(profile_id)["profile"])
        tracker = gedit_nc.FeedModeTracker(TAPPING_CODES if codes is None else codes)
        state = None
        out = []
        for line in lines:
            tokens, state = gedit_nc.tokenize_line(line, cp, state)
            tracker.update(tokens, continued=gedit_nc.continues_block(line, cp))
            out.append((tracker.tapping_code, tracker.pitch_mode, tracker.pitch_feed, tracker.data_code))
        return out

    def test_a_tapping_code_of_the_block_makes_only_that_block_a_tap(self) -> None:
        states = self.walk(["M29 S500", "G0 X10.", "G84 X20. Z-10. R2. F750.", "X30.", "G80"])
        self.assertEqual([state[0] for state in states], ["M29", None, "G84", "G84", None])
        # M29 carries no pitch of its own: the feed of its block is not a lead.
        self.assertEqual([state[2] for state in states], [False, False, True, True, False])

    def test_a_tapping_mode_holds_until_its_group_has_another_code(self) -> None:
        states = self.walk(["G63 G1 Z-12. F500.", "G1 Z3.", "G64 G1 X70. F800."])
        self.assertEqual([state[0] for state in states], ["G63", "G63", None])
        self.assertEqual([state[1] for state in states], ["G63", "G63", None])
        self.assertEqual([state[2] for state in states], [True, True, False])

    def test_a_move_ends_a_modal_cycle_but_not_a_mode(self) -> None:
        # G1 ends the G84 cycle (rule 3) while the cycle group still names it; the tracker
        # reads a cycle through the active cycle, so the tap is over.
        states = self.walk(["G84 X20. Z-10. R2. F750.", "G1 X40. F300."])
        self.assertEqual([state[0] for state in states], ["G84", None])

    def test_threading_is_a_pitch_but_not_a_tap(self) -> None:
        (state,) = self.walk(["G32 Z-20. F1.5"])
        self.assertEqual(state[:3], (None, None, True))

    def test_the_words_of_a_macro_call_are_data_of_that_block_only(self) -> None:
        states = self.walk(["G65 P9810 Z-5. F3000.", "G1 X10. F500."])
        self.assertEqual([state[3] for state in states], ["G65", None])

    def test_a_continued_block_keeps_its_tapping_code(self) -> None:
        codes = [{"code": "G184", "group": "cycle", "modal": True, "pitchFeed": True, "tapping": True,
                  "label": "driven-tool tap", "sets": {"cycle": "start"}},
                 {"code": "M29", "group": "spindle", "tapping": True, "label": "rigid tapping"}]
        states = self.walk(["M29", "$ Q6", "G0 X10"], "okuma-osp", codes)
        self.assertEqual([state[0] for state in states], ["M29", "M29", None])

    def test_the_written_codes_carry_the_kind_of_token_that_wrote_them(self) -> None:
        cp = gedit_nc.compile_profile(helpers.effective_context("heidenhain-klartext")["profile"])
        codes = [{"code": "CYCL DEF 207", "group": "cycle", "tapping": True, "label": "tap",
                  "sets": {"cycle": "start"}},
                 {"code": "M99", "group": "cycle", "label": "call once"}]
        tracker = gedit_nc.FeedModeTracker(codes)
        tokens, _ = gedit_nc.tokenize_line("6 CYCL DEF 207 GEWINDEBOHREN GS", cp, None)
        tracker.update(tokens)
        self.assertEqual([(entry["code"], kind) for entry, kind in tracker.written], [("CYCL DEF 207", "keyword")])
        tokens, _ = gedit_nc.tokenize_line("7 L X+20 R0 FMAX M99", cp, None)
        tracker.update(tokens)
        self.assertEqual([(entry["code"], kind) for entry, kind in tracker.written], [("M99", "word")])

    def test_priming_leaves_a_mode_in_force_and_clears_a_one_block_tap(self) -> None:
        cp = gedit_nc.compile_profile(helpers.effective_context("fanuc-gcode")["profile"])
        tracker = gedit_nc.FeedModeTracker(TAPPING_CODES)
        gedit_nc.prime_tracker(tracker, ["G63 G1 Z-12. F500."], cp, "G1 Z3.")
        self.assertEqual((tracker.tapping_code, tracker.pitch_mode), ("G63", "G63"))
        tracker = gedit_nc.FeedModeTracker(TAPPING_CODES)
        gedit_nc.prime_tracker(tracker, ["M29 S500"], cp, "G0 X10.")
        self.assertIsNone(tracker.tapping_code)


# ---------------------------------------------------------------------------
# The defined cycle and the lower speed limit (M9, WP9.5b; plan section 7.4)
# ---------------------------------------------------------------------------

#: A database of the defining kind, as small as a rule needs: the Klartext shape, no names.
DEFINING_CODES: List[Dict[str, Any]] = [
    {"code": "CYCL DEF", "group": "cycle", "label": "definition", "sets": {}},
    {"code": "CYCL DEF 200", "group": "cycle", "label": "drill", "sets": {"cycle": "define"}},
    {"code": "CYCL DEF 207", "group": "cycle", "label": "tap", "pitchFeed": True, "tapping": True,
     "sets": {"cycle": "define"}},
    {"code": "CYCL DEF 7", "group": "offset", "label": "datum shift", "axisWords": "data"},
    {"code": "CYCL CALL", "group": "cycle", "label": "call", "sets": {"cycle": "call"}},
    {"code": "M89", "group": "cycle", "label": "modal call", "sets": {"cycle": "call-modal"}},
    {"code": "M99", "group": "cycle", "label": "call once", "sets": {"cycle": "call"}},
]


class TestDefinedCycle(ModalTestCase):
    """Plan section 7.4 rules 1-6, rule by rule; the golden is ``defined-cycle.json``."""

    def run_lines(self, lines: Sequence[str], codes: Sequence[Dict[str, Any]] = DEFINING_CODES) -> List[Dict[str, Any]]:
        return self.walk(helpers.effective_context("heidenhain-klartext")["profile"], codes, lines)

    @staticmethod
    def summary(state: Dict[str, Any]) -> tuple:
        defined, modal, active = state["definedCycle"], state["modalCall"], state["activeCycle"]
        return (
            defined["code"] if defined else None,
            modal["code"] if modal else None,
            active["code"] if active else None,
            state["block"]["cycle"],
        )

    def test_a_definition_runs_nothing_and_a_call_runs_it_without_ending_it(self) -> None:
        states = self.run_lines(["1 CYCL DEF 200 DRILLING", "2 CYCL CALL", "3 L X+10 FMAX M99", "4 CYCL CALL"])
        self.assertEqual(
            [self.summary(state) for state in states],
            [
                ("CYCL DEF 200", None, None, None),
                ("CYCL DEF 200", None, None, "CYCL DEF 200"),
                ("CYCL DEF 200", None, None, "CYCL DEF 200"),
                ("CYCL DEF 200", None, None, "CYCL DEF 200"),
            ],
        )
        self.assertEqual(states[0]["definedCycle"]["line"], 1)

    def test_a_call_with_nothing_defined_runs_nothing(self) -> None:
        # Rule 3: the program check of M10 reports it; the state does not invent a cycle.
        states = self.run_lines(["1 CYCL CALL", "2 L X+10 FMAX M99", "3 L X+20 FMAX M89", "4 L X+30 FMAX"])
        self.assertEqual([self.summary(state)[3] for state in states], [None, None, None, None])
        self.assertEqual(states[3]["modalCall"]["code"], "M89")

    def test_the_next_definition_replaces_the_cycle_and_ends_a_modal_call(self) -> None:
        states = self.run_lines(["1 CYCL DEF 207 TAP", "2 L X+0 FMAX M89", "3 CYCL DEF 200 DRILLING", "4 L X+10 FMAX"])
        self.assertEqual(
            [self.summary(state) for state in states],
            [
                ("CYCL DEF 207", None, None, None),
                ("CYCL DEF 207", "M89", "CYCL DEF 207", "CYCL DEF 207"),
                ("CYCL DEF 200", None, None, None),
                ("CYCL DEF 200", None, None, None),
            ],
        )
        self.assertTrue(states[0]["definedCycle"]["pitchFeed"])
        self.assertFalse(states[2]["definedCycle"]["pitchFeed"])

    def test_a_modal_call_runs_in_every_positioning_block_until_a_call(self) -> None:
        states = self.run_lines(
            ["1 CYCL DEF 200 DRILLING", "2 L X+0 FMAX M89", "3 L X+10", "4 M8", "5 L X+20 M99", "6 L X+30"]
        )
        self.assertEqual(
            [self.summary(state)[1:] for state in states],
            [
                (None, None, None),
                ("M89", "CYCL DEF 200", "CYCL DEF 200"),
                ("M89", "CYCL DEF 200", "CYCL DEF 200"),
                ("M89", "CYCL DEF 200", None),
                (None, None, "CYCL DEF 200"),
                (None, None, None),
            ],
        )

    def test_a_cycle_that_acts_where_it_is_defined_touches_none_of_it(self) -> None:
        # Rule 5. The sub-block `7.1` is the entry of cycle 7 (the join), whose X is data, so
        # under a modal call it is no positioning block either.
        states = self.run_lines(["1 CYCL DEF 200 DRILLING", "2 L X+0 FMAX M89", "3 CYCL DEF 7.0 DATUM", "4 CYCL DEF 7.1 X+5"])
        self.assertEqual(
            [self.summary(state) for state in states[2:]],
            [("CYCL DEF 200", "M89", "CYCL DEF 200", None), ("CYCL DEF 200", "M89", "CYCL DEF 200", None)],
        )

    def test_a_tool_change_ends_no_definition(self) -> None:
        states = self.run_lines(["1 CYCL DEF 200 DRILLING", "2 TOOL CALL 4 Z S1000", "3 L X+0 FMAX M99"])
        self.assertEqual([self.summary(state)[0] for state in states], ["CYCL DEF 200"] * 3)
        self.assertEqual(states[2]["block"]["cycle"], "CYCL DEF 200")


    def test_a_defined_cycle_never_makes_a_feed_word_a_lead(self) -> None:
        # The tap's pitch is its own parameter; the F of the block that calls it is the
        # positioning feed. The pitch flag stays on the definition.
        states = self.run_lines(["1 CYCL DEF 207 TAP", "2 L X+0 F500 M89", "3 L X+10 F500", "4 L X+20 F500 M99"])
        self.assertEqual([state["block"]["pitchFeed"] for state in states], [False, False, False, False])
        self.assertEqual([state["feed"]["valueText"] for state in states[1:]], ["500", "500", "500"])
        self.assertTrue(states[2]["activeCycle"]["pitchFeed"])

    def test_a_database_without_defining_entries_never_sets_either(self) -> None:
        # Rule 6: every ISO golden program, walked to its end, under its own database.
        for path in golden_files():
            if path.parent.name == "heidenhain-klartext":
                continue
            golden = json.loads(path.read_text(encoding="utf-8"))
            with self.subTest(golden=relative_to_fixtures(path)):
                context = TestGoldens.context_of(self, path, golden)
                lines = helpers.read_lines((path.parent / golden["input"]).resolve())
                for state in self.walk(context["profile"], context["codes"], lines):
                    self.assertIsNone(state["definedCycle"])
                    self.assertIsNone(state["modalCall"])

    def test_the_shipped_klartext_database_carries_the_family(self) -> None:
        # The data the rules run on (G10): definitions, calls, the modal call, and the
        # definitions that act where they stand, which carry no cycle value.
        codes = {entry["code"]: entry for entry in helpers.effective_context("heidenhain-klartext")["codes"]}
        cycle = {code: (entry.get("sets") or {}).get("cycle") for code, entry in codes.items()}
        self.assertEqual(
            sorted(code for code, value in cycle.items() if value == "define"),
            # M10 P10 added 202 (boring), 208 (bore milling) and 262 (thread milling); B1 (a7s) the
            # SL cycles 21-25 and the pocket, slot and stud cycles 251-254, 256, 257.
            ["CYCL DEF 200", "CYCL DEF 201", "CYCL DEF 202", "CYCL DEF 203", "CYCL DEF 205", "CYCL DEF 206",
             "CYCL DEF 207", "CYCL DEF 208", "CYCL DEF 209", "CYCL DEF 21", "CYCL DEF 22", "CYCL DEF 23",
             "CYCL DEF 24", "CYCL DEF 240", "CYCL DEF 25", "CYCL DEF 251", "CYCL DEF 252", "CYCL DEF 253",
             "CYCL DEF 254", "CYCL DEF 256", "CYCL DEF 257", "CYCL DEF 262"],
        )
        self.assertEqual(sorted(code for code, value in cycle.items() if value == "call"),
                         ["CYCL CALL", "CYCL CALL PAT", "CYCL CALL POS", "M99"])
        self.assertEqual([code for code, value in cycle.items() if value == "call-modal"], ["M89"])
        # Owner decision of 2026-10-08 (M9-4): on the owner's controls M89 is the modal cycle
        # call, so the entry is no longer marked for verification.
        self.assertIsNone(codes["M89"].get("verify"), "M89 is the modal cycle call (the owner, 2026-10-08)")
        # B1 (a7s): cycle 14 CONTOUR acts where it is defined (TNC 640 cycle manual 10/2017, §7.2).
        for code in ("CYCL DEF", "CYCL DEF 7", "CYCL DEF 9", "CYCL DEF 14", "CYCL DEF 19", "CYCL DEF 32", "CYCL DEF 247"):
            with self.subTest(code=code):
                self.assertIsNone(cycle[code])
        self.assertNotIn("start", cycle.values())
        self.assertNotIn("cancel", cycle.values())

    def test_the_tracker_keeps_its_phase_1_reading(self) -> None:
        # `FeedModeTracker` is what the bundled scripts read: a definition is the cycle of
        # its own block there, a call is no cycle at all, as before M9.
        cp = gedit_nc.compile_profile(helpers.effective_context("heidenhain-klartext")["profile"])
        tracker = gedit_nc.FeedModeTracker(DEFINING_CODES)
        seen = []
        state = None
        for line in ("1 CYCL DEF 207 TAP", "2 L X+0 F500 M89", "3 L X+10 F500", "4 CYCL CALL"):
            tokens, state = gedit_nc.tokenize_line(line, cp, state)
            tracker.update(tokens)
            seen.append((tracker.active_cycle, tracker.pitch_feed, tracker.tapping_code))
        self.assertEqual(
            seen,
            [("CYCL DEF 207", True, "CYCL DEF 207"), (None, False, None), (None, False, None), (None, False, None)],
        )



#: A database with a word that makes the cycle written behind it modal (the Sinumerik shape,
#: as small as rule 11b needs).
MODAL_NEXT_CODES: List[Dict[str, Any]] = [
    {"code": "MCALL", "group": "cycle", "label": "modal call", "sets": {"cycle": "call-modal-next"}},
    {"code": "CYCLE81", "group": "cycle", "label": "drill", "sets": {"cycle": "start"}},
    {"code": "CYCLE840", "group": "cycle", "label": "tap", "pitchFeed": True, "tapping": True,
     "sets": {"cycle": "start"}},
    {"code": "G0", "group": "motion", "modal": True, "label": "rapid", "sets": {"motion": "rapid"}},
    {"code": "G1", "group": "motion", "modal": True, "label": "line", "sets": {"motion": "feed"}},
]


class TestModalCallPrefix(ModalTestCase):
    """Rule 11b: a word in front of a cycle makes it modal; it runs in the positioning blocks after it."""

    def run_lines(self, lines: Sequence[str], codes: Sequence[Dict[str, Any]] = MODAL_NEXT_CODES) -> List[Dict[str, Any]]:
        return self.walk(helpers.effective_context("sinumerik-mill")["profile"], codes, lines)

    @staticmethod
    def summary(state: Dict[str, Any]) -> tuple:
        active = state["activeCycle"]
        return (active["code"] if active else None, state["block"]["cycle"], state["block"]["pitchFeed"])

    def test_the_cycle_runs_after_the_word_not_on_its_line_until_the_word_stands_alone(self) -> None:
        states = self.run_lines(
            [
                "MCALL CYCLE81(10,0,2,-5)",
                "X10 Y10",
                "G0 X20",
                "M8",
                "MCALL CYCLE840(10,0,2,-20,,0,1)",
                "X30",
                "MCALL MYHOLE(1)",
                "X40",
                "MCALL CYCLE81(10,0,2,-5)",
                "MCALL",
                "X50",
            ]
        )
        self.assertEqual(
            [self.summary(state) for state in states],
            [
                ("CYCLE81", None, False),
                ("CYCLE81", "CYCLE81", False),
                ("CYCLE81", "CYCLE81", False),
                ("CYCLE81", None, False),
                ("CYCLE840", None, False),
                ("CYCLE840", "CYCLE840", False),
                (None, None, False),
                (None, None, False),
                ("CYCLE81", None, False),
                (None, None, False),
                (None, None, False),
            ],
        )
        self.assertEqual(states[0]["activeCycle"], {"code": "CYCLE81", "line": 1, "pitchFeed": False})
        self.assertEqual(states[5]["activeCycle"], {"code": "CYCLE840", "line": 5, "pitchFeed": True})

    def test_a_cycle_written_without_the_word_still_runs_in_its_own_block(self) -> None:
        states = self.run_lines(["CYCLE81(10,0,2,-5)", "X10"])
        self.assertEqual([self.summary(state) for state in states], [(None, "CYCLE81", False), (None, None, False)])


class TestSubBlockJoin(unittest.TestCase):
    """A sub-block of an older Klartext cycle is that cycle (M9; the TS twin is the hover's join)."""

    def written(self, line: str) -> str:
        """The code the keyword of the line writes (the words behind it are codes of their own)."""
        from _nc_modal import _written_codes, _entry_index

        context = helpers.effective_context("heidenhain-klartext")
        cp = gedit_nc.compile_profile(context["profile"])
        tokens, _ = gedit_nc.tokenize_line(line, cp, None)
        return [code for code, kind in _written_codes(tokens, _entry_index(context["codes"])) if kind == "keyword"][0]

    def test_a_sub_block_is_the_entry_of_its_cycle(self) -> None:
        self.assertEqual(self.written("5 CYCL DEF 19.1 A+0 B+45 C+0"), "CYCL DEF 19")
        self.assertEqual(self.written("6 CYCL DEF 7.0 NULLPUNKT"), "CYCL DEF 7")
        self.assertEqual(self.written("7 CYCL DEF 32.1 T0.05"), "CYCL DEF 32")

    def test_a_whole_number_and_an_unknown_cycle_read_as_before(self) -> None:
        self.assertEqual(self.written("8 CYCL DEF 200 BOHREN"), "CYCL DEF 200")
        self.assertEqual(self.written("9 CYCL DEF 1.0 TIEFBOHREN"), "CYCL DEF")
        self.assertEqual(self.written("10 LBL 1"), "LBL")

    def test_the_flags_of_a_coordinate_cycle_are_reached(self) -> None:
        # The reason for the join (WP9.2): the frame flags of cycles 7-26 were reached by no
        # real program line, because every sub-block fell through to the generic entry.
        from _nc_modal import _entry_index, axis_words_of, frame_of

        index = _entry_index(helpers.effective_context("heidenhain-klartext")["codes"])
        code = self.written("5 CYCL DEF 19.1 A+0 B+45 C+0")
        entry = index[gedit_nc.normalize_code(code)]
        self.assertEqual((axis_words_of(entry), frame_of(entry)), ("data", "open"))

    def test_an_entry_of_the_sub_block_itself_wins(self) -> None:
        from _nc_modal import _codes_in, _entry_index

        codes = [{"code": "CYCL DEF", "group": "cycle", "label": "x"}, {"code": "CYCL DEF 19", "group": "tilt", "label": "x"},
                 {"code": "CYCL DEF 19.1", "group": "tilt", "label": "x"}]
        cp = gedit_nc.compile_profile(helpers.effective_context("heidenhain-klartext")["profile"])
        tokens, _ = gedit_nc.tokenize_line("5 CYCL DEF 19.1 A+0", cp, None)
        self.assertEqual(_codes_in(tokens, _entry_index(codes))[0], "CYCL DEF 19.1")


class TestLowerSpeedLimit(ModalTestCase):
    """Plan section 7.4: `speedLimit` is the upper limit in force; a lower one is no clamp."""

    CODES: List[Dict[str, Any]] = [
        {"code": "G25", "group": "nonmodal", "label": "lower", "sets": {"speedLimit": True, "speedLimitBound": "lower"}},
        {"code": "G26", "group": "nonmodal", "label": "upper", "sets": {"speedLimit": True}},
        {"code": "M3", "group": "spindle", "modal": True, "label": "cw"},
    ]

    def test_a_lower_limit_is_neither_the_speed_nor_the_clamp(self) -> None:
        profile = helpers.effective_context("sinumerik")["profile"]
        states = self.walk(profile, self.CODES, ["N10 G26 S3000", "N20 S800 M3", "N30 G25 S100", "N40 S900"])
        self.assertEqual(
            [(state["speed"] or {}).get("valueText") for state in states], [None, "800", "800", "900"]
        )
        self.assertEqual([(state["speedLimit"] or {}).get("valueText") for state in states], ["3000"] * 4)
        self.assertEqual([state["block"]["speedLimit"] for state in states], [True, False, True, False])

    def test_an_upper_limit_without_a_bound_is_the_clamp_as_before(self) -> None:
        profile = helpers.effective_context("sinumerik")["profile"]
        codes = [dict(self.CODES[1], code="G25")]
        (state,) = self.walk(profile, codes, ["N30 G25 S100"])
        self.assertEqual(state["speedLimit"]["valueText"], "100")


class TestSinumerikProgramStart(unittest.TestCase):
    """M9 (WP9.5b): the short transfer header starts a program in Python as it does in the map."""

    def test_both_header_forms_start_a_program_and_name_it(self) -> None:
        cp = gedit_nc.compile_profile(helpers.effective_context("sinumerik")["profile"])
        starts = cp.patterns["program_start"]

        def name(line: str) -> Optional[str]:
            for pattern in starts:
                match = pattern.search(line)
                if match is not None:
                    return match.groupdict().get("name")
            return None

        self.assertEqual([name(line) for line in ("%PART_ONE_MPF", "%_N_PART_ONE_MPF", "%GROOVE_SPF")],
                         ["PART_ONE", "PART_ONE", "GROOVE"])
        self.assertIsNone(name("%PART_ONE"))
        self.assertIsNone(name("N10 %PART_MPF"))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()


# ---------------------------------------------------------------------------
# M10 prelude (P10): the frame in force, tool centre point control and the tool-axis plane
# (plan §7.4 rules 13-15, §7.16 #107-#109), on the shipped databases
# ---------------------------------------------------------------------------


class TestFramesAndTcp(ModalTestCase):
    """What address arithmetic (WP10.4) and extents (WP10.3) read instead of code lists."""

    def run_lines(self, profile_id: str, lines: Sequence[str]) -> List[Dict[str, Any]]:
        context = helpers.effective_context(profile_id)
        return self.walk(context["profile"], context["codes"], lines)

    @staticmethod
    def frames(states: Sequence[Dict[str, Any]]) -> List[Optional[str]]:
        return [state["frame"]["code"] if state["frame"] is not None else None for state in states]

    @staticmethod
    def tcps(states: Sequence[Dict[str, Any]]) -> List[Optional[str]]:
        return [state["tcp"]["code"] if state["tcp"] is not None else None for state in states]

    def test_a_close_ends_the_frames_of_its_own_group_only(self) -> None:
        # Rule 13. G69 ends the rotation, not the scaling of G51 (each family has its own
        # group, P10); G50 ends the scaling. A second G68.2 replaces the first.
        states = self.run_lines(
            "fanuc-gcode",
            ["G17 G90", "G51 X0 Y0 P2000", "G68 X0 Y0 R30", "G69", "G50", "G68.2 X0 Y0 Z0 I0 J45 K0", "G68.2 X0 Y0 Z0 I0 J30 K0", "G69"],
        )
        self.assertEqual(self.frames(states), [None, "G51", "G68", "G51", None, "G68.2", "G68.2", None])
        self.assertEqual(states[2]["frame"]["line"], 3)
        # The mirror and the polar interpolation are families of their own too.
        states = self.run_lines("fanuc-gcode", ["G68.2 X0 Y0 Z0 I0 J45 K0", "G51.1 X0", "G69", "G50.1 X0", "G12.1", "G13.1"])
        self.assertEqual(self.frames(states), ["G68.2", "G51.1", "G51.1", None, "G12.1", None])

    def test_a_close_that_matches_nothing_leaves_the_frame_open(self) -> None:
        # The safe reading: a spurious reset of another family does not end this one.
        states = self.run_lines("fanuc-gcode", ["G51 X0 Y0 P2000", "G69", "G13.1"])
        self.assertEqual(self.frames(states), ["G51", "G51", "G51"])

    def test_klartext_plane_reset_ends_the_tilt_and_not_the_mirror(self) -> None:
        # PLANE RESET resets a PLANE function and cycle 19 (TNC 640 user's manual), never the
        # mirror of cycle 8; a second PLANE of another kind is in the same family.
        states = self.run_lines(
            "heidenhain-klartext",
            ["CYCL DEF 8.0 MIRROR", "CYCL DEF 8.1 X", "PLANE SPATIAL SPA+0 SPB+45 SPC+0 TURN", "PLANE VECTOR BX0 BY0 BZ1 NX0 NY1 NZ0 STAY", "PLANE RESET STAY", "CYCL DEF 19.0 WORKING PLANE", "CYCL DEF 19.1 B+30", "PLANE RESET STAY"],
        )
        self.assertEqual(
            self.frames(states),
            # The 19.0 line only names the cycle; its angles, and with them the tilt, come with
            # 19.1 (`frameZeroWords`, owner decision of 2026-10-08).
            ["CYCL DEF 8", "CYCL DEF 8", "PLANE SPATIAL", "PLANE VECTOR", "CYCL DEF 8", "CYCL DEF 8", "CYCL DEF 19", "CYCL DEF 8"],
        )

    def test_a_klartext_tilt_with_every_angle_zero_is_no_tilt(self) -> None:
        # Owner decision of 2026-10-08 (M10-2): cycle 19 and PLANE SPATIAL / PROJECTED /
        # EULER with every angle at zero close the tilt, as PLANE RESET does; any angle
        # other than zero, or one that is not a plain number, keeps it open. The manual's
        # reset of cycle 19 (all angles 0, then once more without an angle) ends closed.
        states = self.run_lines(
            "heidenhain-klartext",
            [
                "CYCL DEF 19.0 WORKING PLANE", "CYCL DEF 19.1 A+0 B+30 C+0", "L X0 Y0",
                "CYCL DEF 19.0 WORKING PLANE", "CYCL DEF 19.1 A+0 B+0 C+0",
                "CYCL DEF 19.0 WORKING PLANE", "CYCL DEF 19.1", "L X0 Y0",
                "PLANE SPATIAL SPA+0 SPB+45 SPC+0 TURN MB MAX FMAX", "PLANE SPATIAL SPA+0 SPB-0.000 SPC+0 STAY",
                "PLANE SPATIAL SPA+0 SPB+Q5 SPC+0 STAY", "PLANE PROJECTED PROPR+0 PROMIN+0 ROT+0 STAY",
                "PLANE EULER EULPR+0 EULNU+20 EULROT+0 STAY", "PLANE EULER EULPR+0 EULNU+0 EULROT+0 STAY",
            ],
        )
        self.assertEqual(
            self.frames(states),
            [None, "CYCL DEF 19", "CYCL DEF 19", "CYCL DEF 19", None, None, None, None,
             "PLANE SPATIAL", None, "PLANE SPATIAL", None, "PLANE EULER", None],
        )
        # An angle the block leaves out keeps its value (cycle 19 in the TNC manual): B+0
        # alone does not end a tilt that A opened.
        states = self.run_lines("heidenhain-klartext", ["CYCL DEF 19.1 A+20 B+30", "CYCL DEF 19.1 B+0", "CYCL DEF 19.1 A+0"])
        self.assertEqual(self.frames(states), ["CYCL DEF 19", "CYCL DEF 19", None])
        # PLANE AXIAL is not flagged: the manual says a zero axis angle does not end it.
        states = self.run_lines("heidenhain-klartext", ["PLANE AXIAL B+0 TURN"])
        self.assertEqual(self.frames(states), ["PLANE AXIAL"])

    def test_the_values_of_a_block_are_read_only_for_a_database_that_has_a_bare_frame_code(self) -> None:
        # Rule 13 needs to know whether a block writes values only for the codes that close
        # their frame when written without (Siemens `TRANS`, `CYCLE800()`). Any other
        # database never asks, and no block should pay for the walk.
        fanuc = helpers.effective_context("fanuc-gcode")
        cp = gedit_nc.compile_profile(fanuc["profile"])
        interp = gedit_nc.ModalInterpreter(cp, fanuc["codes"])
        tokens, _ = gedit_nc.tokenize_line("G1 X10. Y20. F100.", cp, None)
        interp.update(tokens, 1, "G1 X10. Y20. F100.")
        self.assertFalse(interp._block_values)
        self.assertEqual(interp._calls_bare, {})

        siemens = helpers.effective_context("sinumerik-mill")
        cp = gedit_nc.compile_profile(siemens["profile"])
        interp = gedit_nc.ModalInterpreter(cp, siemens["codes"])
        tokens, _ = gedit_nc.tokenize_line("G1 X10 Y20 F100", cp, None)
        interp.update(tokens, 1, "G1 X10 Y20 F100")
        self.assertTrue(interp._block_values)

    def test_a_siemens_frame_code_without_values_closes_its_group(self) -> None:
        # CYCLE800() clears the swivel frames and TRANS alone the programmable frame (the
        # Siemens programming manual); with any value they open, as before.
        states = self.run_lines(
            "sinumerik-mill",
            ["G17", 'CYCLE800(1,"",0,57,0,0,0,30,0,0,0,0,0,-1,100,1)', "ROT RPL=45", "CYCLE800()", "TRANS X10", "TRANS", "ROT", "SCALE X2 Y2", "G0 SCALE", "MIRROR X0", "N10 MIRROR"],
        )
        self.assertEqual(
            self.frames(states),
            [None, "CYCLE800", "ROT", "ROT", "ROT", None, None, "SCALE", None, "MIRROR", None],
        )
        self.assertEqual([f["code"] for f in self.open_frames("sinumerik-mill", ['CYCLE800(1,"",0,57,0,0,0,30,0,0,0,0,0,-1,100,1)', "ROT RPL=45", "CYCLE800()"])], ["ROT"])

    def open_frames(self, profile_id: str, lines: Sequence[str]) -> List[Dict[str, Any]]:
        context = helpers.effective_context(profile_id)
        cp = gedit_nc.compile_profile(context["profile"])
        interp = gedit_nc.ModalInterpreter(cp, context["codes"])
        state = None
        for number, line in enumerate(lines, 1):
            tokens, state = gedit_nc.tokenize_line(line, cp, state)
            interp.update(tokens, number, gedit_nc.mask_comments(line, cp))
        return interp.open_frames

    def test_traori_is_tool_centre_point_control_and_trafoof_ends_both(self) -> None:
        # Decision 2 (2026-10-04): TRAORI opens no frame; TRAFOOF still ends TRANSMIT.
        states = self.run_lines("sinumerik-mill", ["TRAORI", "G1 X10 A10 C20 F1000", "TRANSMIT", "TRAFOOF", 'CYCLE800(1,"",0,57,0,0,0,30,0,0,0,0,0,-1,100,1)', "TRAORI", "TRAFOOF"])
        self.assertEqual(self.tcps(states), ["TRAORI", "TRAORI", "TRAORI", None, None, "TRAORI", None])
        self.assertEqual(self.frames(states), [None, None, "TRANSMIT", None, "CYCLE800", "CYCLE800", "CYCLE800"])

    def test_tcp_ends_with_its_off_code_or_another_code_of_its_group(self) -> None:
        # Rule 14. G43 replaces G43.4 in the length-offset group on the control, so tool
        # centre point control is off after it, not on.
        states = self.run_lines("fanuc-gcode", ["G43.4 H1", "G1 X10 A10 F500", "G43 H1", "G43.5 H2", "G49", "G43.4 H1", "G40"])
        self.assertEqual(self.tcps(states), ["G43.4", "G43.4", None, "G43.5", None, "G43.4", "G43.4"])
        states = self.run_lines("heidenhain-klartext", ["M128", "M129", "FUNCTION TCPM F TCP AXIS POS PATHCTRL AXIS", "M129", "M128", "FUNCTION RESET TCPM"])
        self.assertEqual(self.tcps(states), ["M128", None, "FUNCTION TCPM", None, "M128", None])

    def test_tcp_is_off_at_power_on_and_on_a_lathe_never_on(self) -> None:
        self.assertIsNone(self.run_lines("fanuc-gcode", ["G0 X0"])[0]["tcp"])
        # The lathe database has neither G43.4 nor G49 (no length offset on a turret lathe).
        self.assertIsNone(self.run_lines("fanuc-lathe", ["G43.4 H1", "G1 X10 C20 F0.2"])[1]["tcp"])

    def test_the_klartext_tool_axis_names_the_plane(self) -> None:
        # Rule 15. TOOL CALL carries the tool axis as a bare letter; a call without one keeps
        # the plane, and a parallel axis leaves it unknown rather than guessed.
        states = self.run_lines(
            "heidenhain-klartext",
            ["TOOL CALL 1 Z S3000", "TOOL CALL S5000", "TOOL CALL 2 Y S2000", "TOOL CALL \"MILL\" X", "TOOL CALL 3 W", "TOOL CALL 4 Z"],
        )
        self.assertEqual([state["plane"] for state in states], ["XY", "XY", "ZX", "YZ", "unknown", "XY"])
        # Nothing else does: a positioning block with a Z word is no tool axis.
        self.assertEqual(self.run_lines("heidenhain-klartext", ["L Z+100 R0 FMAX"])[0]["plane"], "unknown")

    def test_an_iso_plane_code_still_decides_there(self) -> None:
        states = self.run_lines("fanuc-gcode", ["G17", "G18", "G19"])
        self.assertEqual([state["plane"] for state in states], ["XY", "ZX", "YZ"])
