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

#: The built-in profiles and code databases as they are **written**. A profile or database
#: that `extends` another is only half of itself here (plan AD-16, AD-17), which is why
#: nothing in the Python tests reads these folders directly any more.
PROFILES_DIR = REPO_ROOT / "src" / "lib" / "data" / "profiles"
CODES_DIR = REPO_ROOT / "src" / "lib" / "data" / "codes"

#: ``tests/fixtures/resolved`` — the generated view of the data as the app really uses it
#: (plan M6 P6 item 12): profiles and databases with their parents merged in, and one
#: **effective** profile per declared preset, per variant and per golden context.
#:
#: Python never merges a machine into a profile itself. If it did, the two implementations
#: would drift and a golden would stop proving anything; so it reads what
#: ``tests/unit/resolved.test.ts`` wrote, and says how to regenerate it when an entry is
#: missing.
RESOLVED_DIR = FIXTURES_DIR / "resolved"

#: What to run when a resolved fixture is missing or out of date.
UPDATE_RESOLVED = "run `UPDATE_RESOLVED=1 npm test -- resolved`"

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


def _resolved(kind: str, name: str) -> Any:
    """One generated file under ``tests/fixtures/resolved``, or a loud failure."""
    path = RESOLVED_DIR / kind / (name + ".json")
    if not path.is_file():
        raise AssertionError(
            "%s/%s.json is missing; %s" % (kind, name, UPDATE_RESOLVED)
        )
    return load_json(path)


def resolved_profile(profile_id: str) -> Dict[str, Any]:
    """A built-in profile with its parents merged in, as the app uses it (AD-16)."""
    return _resolved("profiles", profile_id)


def resolved_codes(dialect: str) -> List[Dict[str, Any]]:
    """The entries of a resolved code database, as ``context["codes"]`` carries them."""
    file = _resolved("codes", dialect)
    codes = file.get("codes")
    return codes if isinstance(codes, list) else []


def load_profile(profile_id: str) -> Dict[str, Any]:
    """A built-in profile, exactly as the app ships it and as the context carries it.

    M6: this is the **resolved** profile (:func:`resolved_profile`). A child profile is
    only half of itself in ``src/lib/data/profiles``, and a test that read the file would
    be testing something the app never runs.
    """
    return resolved_profile(profile_id)


def profile_ids() -> List[str]:
    """Every built-in profile id, sorted."""
    return sorted(path.stem for path in (RESOLVED_DIR / "profiles").glob("*.json"))


def load_codes(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The code database ``profile.codes`` points at, as ``context["codes"]`` carries it."""
    dialect = profile.get("codes")
    if not isinstance(dialect, str) or dialect == "":
        return []
    return resolved_codes(dialect)


def effective_context(
    profile_id: Optional[str] = None,
    preset: Optional[str] = None,
    variant: Optional[Any] = None,
    golden: Optional[Any] = None,
    **overrides: Any
) -> Dict[str, Any]:
    """The ``ScriptContextV2`` of one **effective** profile (plan §7.15, §7.4).

    Three ways to ask, and all three read a file ``tests/unit/resolved.test.ts`` wrote:

    ``effective_context(golden=<path>)``
        the context that golden runs with, looked up in ``resolved/effective/index.json``.
        A golden that names a machine is the reason this exists: the merge happened once,
        in TypeScript, and both languages read the result.
    ``effective_context(profile_id, preset="is-b")`` / ``(profile_id, variant=("gcodeSystem", "B"))``
        the context of one declared preset or variant choice, for a unit test.
    ``effective_context(profile_id)``
        the profile's own defaults — "no machine", which is what every document had before
        M6.

    A missing entry fails with the command that regenerates it, never with a guessed
    profile: guessing is how a test starts passing against data nobody has seen.
    """
    if golden is not None:
        index = _resolved("effective", "index")
        key = str(golden).replace("\\", "/")
        if key.startswith(str(FIXTURES_DIR)):
            key = str(Path(key).relative_to(FIXTURES_DIR)).replace("\\", "/")
        name = index.get(key)
        if not isinstance(name, str):
            raise AssertionError("no effective profile for golden %s; %s" % (key, UPDATE_RESOLVED))
        # `name` is `effective/<profileId>/<file>.json`, relative to `resolved/`.
        path = RESOLVED_DIR / name
        if not path.is_file():
            raise AssertionError("%s is missing; %s" % (name, UPDATE_RESOLVED))
        entry = load_json(path)
    else:
        if not profile_id:
            raise AssertionError("effective_context needs a profile id or a golden path")
        if preset is not None:
            leaf = "preset-%s" % preset
        elif variant is not None:
            pair = variant if isinstance(variant, (tuple, list)) else str(variant).split("=", 1)
            leaf = "variant-%s-%s" % (pair[0], pair[1])
        else:
            leaf = "defaults"
        entry = _resolved("effective", "%s/%s" % (profile_id, leaf))

    profile = entry["profile"]
    context = make_context(profile=profile, codes=resolved_codes(entry["codes"]), **overrides)
    context["machine"] = entry["machine"]
    return context


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

    ``preceding_file`` is the optional ``preceding.nc``: the part of the document that
    stands **above** ``input.nc``. Its presence makes the case a selection that starts
    just below it and fills ``input.precedingLines`` (plan section 7.5), which is how a
    fixture proves that the modal state above a selection is carried into it. Writing it
    as a plain NC file rather than as a JSON array inside ``case.json`` keeps it readable
    and diffable, which is the whole point of a golden.
    """

    script: str
    name: str
    directory: Path
    input_file: Path
    expected_file: Path
    params: Dict[str, Any]
    options: Dict[str, Any] = dataclass_field(default_factory=dict)
    preceding_file: Optional[Path] = None

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

    def preceding_lines(self) -> List[str]:
        """``preceding.nc`` as ``input.precedingLines``, or ``[]``.

        The file holds the text above the selection **including** its final line ending,
        the way it stands in the document, so splitting it leaves one empty element at the
        end that is not a line of the document. It is dropped here: the contract wants the
        lines above ``startLine``, and an extra empty one would put the selection a line
        too low and make the length check in ``gedit_nc.preceding_lines`` reject the whole
        field.
        """
        if self.preceding_file is None:
            return []
        lines = read_lines(self.preceding_file)
        if lines and lines[-1] == "":
            lines.pop()
        return lines

    def context(self) -> Dict[str, Any]:
        """The ``ScriptContextV2`` this case runs with (plan §7.5)."""
        profile = load_profile(self.profile_id)
        lines = self.input_lines()
        context = make_context(params=self.params, profile=profile, codes=load_codes(profile))
        context["document"]["name"] = self.input_file.name
        context["input"]["endLine"] = len(lines)
        # A `preceding.nc` makes the case a selection that starts right below it. It is
        # applied before `case.json`, so a case can still override any of it by hand.
        above = self.preceding_lines()
        if above:
            start = len(above) + 1
            context["input"] = {
                "scope": "selection",
                "startLine": start,
                "endLine": start + len(lines) - 1,
                "precedingLines": above,
            }
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
        preceding_file = directory / "preceding.nc"
        cases.append(
            ScriptCase(
                script=script,
                name=directory.name,
                directory=directory,
                input_file=input_file,
                expected_file=expected[0],
                params=load_json(params_file) if params_file.is_file() else {},
                options=load_json(options_file) if options_file.is_file() else {},
                preceding_file=preceding_file if preceding_file.is_file() else None,
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
