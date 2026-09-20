"""Shared plumbing for the Python tests (plan §8.1, gate G4). Owner: **WP4.6**.

Skeleton written by the M4 prelude: the paths, the fixture walk and the subprocess
runner. WP4.6 added the profile and code-database loaders and the per-case
``case.json``, so a golden case says which dialect it is written in. Standard
library only, Python 3.9 and newer, like everything else under
``src-tauri/resources/scripts``.

Two kinds of test use this:

* **parity** — ``gedit_nc`` has to reach the same answer as the TypeScript core on the
  goldens in ``tests/fixtures/tokens/`` and ``tests/fixtures/numberformat.cases.json``.
  Import the module (:func:`import_gedit_nc`) and call it directly.
* **golden** — a bundled script turned ``input.nc`` plus ``params.json`` into
  ``expected.*``. Run the real file in a subprocess (:func:`run_script`), because the
  header, stdin and ``GEDIT_CONTEXT`` are part of what is being tested.

Run from the repository root::

    python3 -m unittest discover -s tests/python -t .
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

#: ``<repo>``; this file is ``<repo>/tests/python/helpers.py``.
REPO_ROOT = Path(__file__).resolve().parents[2]

#: The bundled scripts folder, which is also the ``bundled:`` root at runtime.
SCRIPTS_DIR = REPO_ROOT / "src-tauri" / "resources" / "scripts"

#: ``tests/fixtures`` — shared with the vitest suite.
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures"

#: ``tests/fixtures/scripts/<script>/<case>/`` (plan §8.2).
SCRIPT_FIXTURES_DIR = FIXTURES_DIR / "scripts"

#: The built-in profiles and code databases, the ones the app resolves into a context.
PROFILES_DIR = REPO_ROOT / "src" / "lib" / "data" / "profiles"
CODES_DIR = REPO_ROOT / "src" / "lib" / "data" / "codes"

#: The dialect a fixture case is written in unless its ``case.json`` says otherwise.
DEFAULT_PROFILE_ID = "fanuc-gcode"

#: How long a script may take in a test before it is treated as hung.
RUN_TIMEOUT_SECONDS = 60


def import_gedit_nc() -> Any:
    """Imports ``gedit_nc`` from the bundled scripts folder.

    The app puts that folder on ``PYTHONPATH``; a test has to do the same, and it has to
    do it without shadowing anything already importable.
    """
    path = str(SCRIPTS_DIR)
    if path not in sys.path:
        sys.path.insert(0, path)
    import gedit_nc  # deliberately late: only importable once sys.path is set

    return gedit_nc


def read_text(path: Path) -> str:
    """A fixture as text. Always UTF-8 and always LF, like a script's stdin."""
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def read_lines(path: Path) -> List[str]:
    """A fixture split the way :func:`gedit_nc.read_input` splits stdin."""
    return read_text(path).split("\n")


def load_json(path: Path) -> Any:
    """A JSON fixture."""
    return json.loads(path.read_text(encoding="utf-8"))


def load_profile(profile_id: str) -> Dict[str, Any]:
    """A built-in profile, exactly as the app ships it and as the context carries it."""
    return load_json(PROFILES_DIR / (profile_id + ".json"))


def profile_ids() -> List[str]:
    """Every built-in profile id, sorted."""
    return sorted(path.stem for path in PROFILES_DIR.glob("*.json"))


def load_codes(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The code database ``profile.codes`` points at, as ``context["codes"]`` carries it."""
    dialect = profile.get("codes")
    if not isinstance(dialect, str) or dialect == "":
        return []
    return load_json(CODES_DIR / (dialect + ".json"))["codes"]


@dataclass
class ScriptCase:
    """One ``tests/fixtures/scripts/<script>/<case>/`` folder.

    ``params`` comes from ``params.json`` (``{}`` when there is none) and ``expected`` is
    the single ``expected.*`` file: ``expected.nc`` for a ``replace`` script,
    ``expected.json`` for a ``report`` one.

    ``options`` is the optional ``case.json``, which says what the run looks like rather
    than what the script is asked to do: ``profile`` names the dialect (default
    ``fanuc-gcode``) and every other key replaces that member of the context, so a case
    can be a selection that starts at line 40 rather than a whole document.
    """

    script: str
    name: str
    directory: Path
    input_file: Path
    expected_file: Path
    params: Dict[str, Any]
    options: Dict[str, Any] = dataclass_field(default_factory=dict)

    @property
    def expects_json(self) -> bool:
        return self.expected_file.suffix == ".json"

    @property
    def profile_id(self) -> str:
        value = self.options.get("profile")
        return value if isinstance(value, str) and value != "" else DEFAULT_PROFILE_ID

    def input_text(self) -> str:
        return read_text(self.input_file)

    def input_lines(self) -> List[str]:
        return read_lines(self.input_file)

    def expected_text(self) -> str:
        return read_text(self.expected_file)

    def expected_json(self) -> Any:
        return load_json(self.expected_file)

    def context(self) -> Dict[str, Any]:
        """The ``ScriptContextV2`` this case runs with (plan §7.5)."""
        profile = load_profile(self.profile_id)
        lines = self.input_lines()
        context = make_context(params=self.params, profile=profile, codes=load_codes(profile))
        context["document"]["name"] = self.input_file.name
        context["input"]["endLine"] = len(lines)
        for key, value in self.options.items():
            if key != "profile":
                context[key] = value
        return context


def script_cases(script: str) -> List[ScriptCase]:
    """Every case folder of ``script``, sorted by name.

    A case is a folder with an ``input.nc`` and exactly one ``expected.*``. An empty or
    missing fixture folder gives an empty list; the caller asserts that it found cases,
    so a typo in the script name fails loudly instead of passing with nothing to check.
    """
    root = SCRIPT_FIXTURES_DIR / script
    if not root.is_dir():
        return []
    cases: List[ScriptCase] = []
    for directory in sorted(p for p in root.iterdir() if p.is_dir()):
        input_file = directory / "input.nc"
        expected = sorted(p for p in directory.iterdir() if p.name.startswith("expected."))
        if not input_file.is_file() or len(expected) != 1:
            raise AssertionError(
                f"{directory} must hold input.nc and exactly one expected.* file, found {[p.name for p in expected]}"
            )
        params_file = directory / "params.json"
        options_file = directory / "case.json"
        cases.append(
            ScriptCase(
                script=script,
                name=directory.name,
                directory=directory,
                input_file=input_file,
                expected_file=expected[0],
                params=load_json(params_file) if params_file.is_file() else {},
                options=load_json(options_file) if options_file.is_file() else {},
            )
        )
    return cases


def make_context(
    params: Optional[Dict[str, Any]] = None,
    profile: Optional[Dict[str, Any]] = None,
    codes: Optional[Sequence[Dict[str, Any]]] = None,
    **overrides: Any,
) -> Dict[str, Any]:
    """A ``ScriptContextV2`` dictionary (plan §7.5) for a test run.

    The defaults describe "the whole of an unsaved Fanuc document"; pass ``profile`` to
    run against the real profile JSON, and ``overrides`` for anything else
    (``document``, ``input``, ``cursor``).
    """
    context: Dict[str, Any] = {
        "contract": 2,
        "document": {
            "path": None,
            "name": "Untitled-1",
            "profile": (profile or {}).get("id", "fanuc-gcode"),
            "encoding": "utf-8",
            "hasBom": False,
            "lineEnding": "lf",
            "modified": False,
        },
        "input": {"scope": "document", "startLine": 1, "endLine": 1},
        "cursor": {"line": 1, "column": 1},
        "params": dict(params or {}),
        "profile": profile or {},
        "codes": list(codes or []),
    }
    context.update(overrides)
    return context


@dataclass
class RunOutput:
    """What a script run produced."""

    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    def json(self) -> Any:
        """stdout parsed as JSON, with stderr in the message when it is not."""
        try:
            return json.loads(self.stdout)
        except json.JSONDecodeError as err:  # pragma: no cover - only on a failing test
            raise AssertionError(f"stdout is not JSON ({err}); stderr was:\n{self.stderr}") from err


def run_script(
    script_name: str,
    stdin: str = "",
    context: Optional[Dict[str, Any]] = None,
    interpreter: Optional[str] = None,
) -> RunOutput:
    """Runs a bundled script the way the app does, and returns its output.

    The same environment as the real runner (plan AD-13): the script's own folder as the
    working directory, ``PYTHONPATH`` pointing at the bundled folder so ``import
    gedit_nc`` works, UTF-8 forced on both pipes, no ``.pyc`` files, and ``GEDIT_CONTEXT``
    naming a temporary JSON file that is removed afterwards. Passing ``context=None``
    leaves ``GEDIT_CONTEXT`` unset, which is the v1 run a script also has to survive.
    """
    script = SCRIPTS_DIR / script_name
    if not script.is_file():
        raise AssertionError(f"no such bundled script: {script}")

    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(SCRIPTS_DIR), env.get("PYTHONPATH", "")]))
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env.pop("GEDIT_CONTEXT", None)

    with tempfile.TemporaryDirectory(prefix="gedit-test-") as temp_dir:
        if context is not None:
            context_file = Path(temp_dir) / "context.json"
            context_file.write_text(json.dumps(context), encoding="utf-8")
            env["GEDIT_CONTEXT"] = str(context_file)
        completed = subprocess.run(
            [interpreter or sys.executable, str(script)],
            input=stdin.encode("utf-8"),
            cwd=str(SCRIPTS_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=RUN_TIMEOUT_SECONDS,
            check=False,
        )
    return RunOutput(
        returncode=completed.returncode,
        stdout=completed.stdout.decode("utf-8"),
        stderr=completed.stderr.decode("utf-8"),
    )
