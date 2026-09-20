"""The Python test plumbing itself, and the `gedit_nc` API surface. Owner: **P4**.

Gate G4 (``python3 -m unittest discover -s tests/python -t .``) has to be green from the
prelude on, and ``unittest`` exits 5 when it finds nothing, so this file is also what
keeps the gate meaningful before WP4.6 lands.

Everything asserted here stays true **after** ``gedit_nc`` is implemented: the names of
plan §7.10 and the shape of the helpers, never a stub's behaviour. WP4.6 tests the
behaviour in ``test_gedit_nc.py``.
"""

from __future__ import annotations

import inspect
import unittest

from tests.python import helpers

#: The public API of plan §7.10. Renaming one of these breaks every bundled script.
API_NAMES = [
    "load_context",
    "read_input",
    "to_py_regex",
    "compile_profile",
    "tokenize_line",
    "parse_number",
    "format_number",
    "scale_decimal",
    "FeedModeTracker",
    "report",
    "envelope",
]

#: The parameter names of the functions whose call sites are spread over several scripts.
API_SIGNATURES = {
    "to_py_regex": ["pattern"],
    "compile_profile": ["profile"],
    "tokenize_line": ["line", "cp", "prev_state"],
    "parse_number": ["raw"],
    "format_number": ["decimal", "original", "fmt", "decimal_point_significant"],
    "scale_decimal": ["raw", "percent"],
    "report": ["title", "columns", "rows", "message", "findings"],
    "envelope": ["text", "message", "findings"],
}


class TestLayout(unittest.TestCase):
    def test_the_folders_the_tests_read_from_exist(self) -> None:
        self.assertTrue(helpers.REPO_ROOT.joinpath("package.json").is_file(), helpers.REPO_ROOT)
        self.assertTrue(helpers.SCRIPTS_DIR.is_dir(), helpers.SCRIPTS_DIR)
        self.assertTrue(helpers.FIXTURES_DIR.is_dir(), helpers.FIXTURES_DIR)
        self.assertTrue(helpers.SCRIPTS_DIR.joinpath("gedit_nc.py").is_file())

    def test_a_missing_fixture_folder_is_empty_rather_than_an_error(self) -> None:
        self.assertEqual(helpers.script_cases("no-such-script"), [])


class TestGeditNcApi(unittest.TestCase):
    """The §7.10 contract: the names and their parameters, not what they do yet."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.gedit_nc = helpers.import_gedit_nc()

    def test_every_name_of_the_contract_is_exported(self) -> None:
        missing = [name for name in API_NAMES if not hasattr(self.gedit_nc, name)]
        self.assertEqual(missing, [])
        self.assertEqual(sorted(set(self.gedit_nc.__all__) & set(API_NAMES)), sorted(API_NAMES))

    def test_the_signatures_are_the_ones_scripts_call(self) -> None:
        for name, expected in API_SIGNATURES.items():
            with self.subTest(name=name):
                parameters = list(inspect.signature(getattr(self.gedit_nc, name)).parameters)
                self.assertEqual(parameters, expected)

    def test_feed_mode_tracker_exposes_the_four_modal_attributes(self) -> None:
        tracker = self.gedit_nc.FeedModeTracker
        self.assertTrue(inspect.isclass(tracker))
        self.assertTrue(hasattr(tracker, "update"))
        for attribute in ["feed_mode", "css", "active_cycle", "pitch_feed"]:
            with self.subTest(attribute=attribute):
                self.assertIn(attribute, tracker.__annotations__)

    def test_the_token_model_mirrors_the_typescript_one(self) -> None:
        self.assertEqual(
            list(self.gedit_nc.Token.__annotations__),
            ["kind", "start", "end", "text", "address", "value_text", "value", "incremental"],
        )
        self.assertEqual(
            list(self.gedit_nc.NumericLiteral.__annotations__),
            ["raw", "sign", "int_part", "frac_part", "has_point"],
        )
        self.assertEqual(list(self.gedit_nc.LineState.__annotations__), ["continuation"])


class TestRunScript(unittest.TestCase):
    def test_a_bundled_module_runs_cleanly_in_the_app_environment(self) -> None:
        # gedit_nc.py is a library: importing it as a script must do nothing at all.
        result = helpers.run_script("gedit_nc.py", stdin="G0 X0\n", context=helpers.make_context())
        self.assertTrue(result.ok, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_a_script_that_is_not_bundled_fails_loudly(self) -> None:
        with self.assertRaises(AssertionError):
            helpers.run_script("no_such_script.py")


class TestContext(unittest.TestCase):
    def test_the_default_context_is_a_contract_2_document_run(self) -> None:
        context = helpers.make_context(params={"percent": 90})
        self.assertEqual(context["contract"], 2)
        self.assertEqual(context["params"], {"percent": 90})
        self.assertEqual(context["input"]["scope"], "document")
        self.assertEqual(context["document"]["profile"], "fanuc-gcode")

    def test_overrides_replace_whole_members(self) -> None:
        context = helpers.make_context(input={"scope": "selection", "startLine": 12, "endLine": 20})
        self.assertEqual(context["input"]["startLine"], 12)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
