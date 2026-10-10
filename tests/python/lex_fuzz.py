"""Test support for the lexer's fast path (B2): lines, profiles and the comparison.

``_nc_lex.tokenize_line`` has a whole-line fast path for the commonest block (see the
comment above ``_FastLine`` in ``_nc_lex.py``). A shortcut like that is only worth having
if it never answers differently from the character loop, so ``test_lex_fast_path.py``
reads the same lines both ways (``_nc_lex._FAST_PATH`` switches the shortcut off) and
compares every token and the line state.

This module only produces the material:

* :func:`profiles_to_read` -- every built-in profile and variants of them that switch on
  what the built-in ones do not use together (the Python twin of ``profilesToRead`` in
  ``tests/unit/helpers/randomNc.ts``, plus the variants that matter for the fast path:
  an exponent marker, a decimal comma, a colon word, a keyword with a digit in it, a
  case-sensitive profile);
* :func:`random_lines` -- seeded random lines: plain blocks (the shape the shortcut takes),
  plain blocks with one thing in them that the shortcut has to hand back to the loop, and
  the hard block heads of ``randomNc.ts``;
* :func:`golden_lines` -- every line of the NC fixtures and the token goldens, and mutations
  of them (one character inserted, removed, replaced or doubled).

Standard library only, Python 3.9 and newer, like the tests around it.
"""

from __future__ import annotations

import copy
import json
import random
from typing import Any, Dict, Iterator, List, Optional, Tuple

from tests.python import helpers

#: The ids of the built-in profiles, in the order the TypeScript helper reads them.
BUILTIN_IDS = [
    "fanuc-gcode",
    "fanuc-lathe",
    "heidenhain-klartext",
    "okuma-osp",
    "sinumerik",
    "sinumerik-mill",
]


def _variant(profile_id: str, change) -> Dict[str, Any]:
    profile = copy.deepcopy(helpers.load_profile(profile_id))
    change(profile)
    return profile


def _syntax(**fields):
    def change(profile):
        profile["syntax"].update(fields)

    return change


def profile_variants() -> List[Tuple[str, Dict[str, Any]]]:
    """``(name, resolved profile)`` of every variant, built-in ones first."""
    out: List[Tuple[str, Dict[str, Any]]] = []
    for profile_id in BUILTIN_IDS:
        out.append((profile_id, copy.deepcopy(helpers.load_profile(profile_id))))
    cont = _syntax(continuation="~\\s*$", continuationMark="~")

    def skip(**fields):
        def change(profile):
            profile["syntax"]["blockSkip"] = fields

        return change

    def alt_prefix(profile):
        profile["syntax"]["blockNumber"]["altPrefixes"] = ["L"]

    def no_references(profile):
        profile["numbering"]["references"] = []

    def keywords_plus(*words):
        def change(profile):
            profile["syntax"]["keywords"] = list(profile["syntax"]["keywords"]) + list(words)

        return change

    out += [
        ("fanuc + continuation ~", _variant("fanuc-gcode", cont)),
        ("fanuc case-sensitive", _variant("fanuc-gcode", _syntax(caseSensitive=True))),
        ("fanuc alt prefix L", _variant("fanuc-gcode", alt_prefix)),
        ("fanuc skip after number", _variant("fanuc-gcode", skip(chars="/", position="after-number", levels=True, plainLevel="1"))),
        ("fanuc skip before number, no levels", _variant("fanuc-gcode", skip(chars="/", position="before-number", levels=False))),
        ("fanuc without reference rules", _variant("fanuc-gcode", no_references)),
        ("fanuc + exponent E", _variant("fanuc-gcode", _syntax(exponentMarker="E"))),
        ("fanuc + exponent EX", _variant("fanuc-gcode", _syntax(exponentMarker="EX"))),
        ("fanuc + decimal comma", _variant("fanuc-gcode", _syntax(decimalSeparatorAlt=","))),
        ("fanuc + decimal separator comma", _variant("fanuc-gcode", _syntax(decimalSeparator=","))),
        ("fanuc + colon words", _variant("fanuc-gcode", _syntax(colonWords=["VC", "HSC-MODE"]))),
        ("fanuc + keyword with digits", _variant("fanuc-gcode", keywords_plus("G28", "M30", "X"))),
        ("fanuc + keyword Q", _variant("fanuc-gcode", keywords_plus("Q", "Y Z"))),
        ("fanuc + comment letter", _variant("fanuc-gcode", _syntax(comments=[{"start": "(", "end": ")"}, {"start": "MSG", "end": None}]))),
        ("fanuc + sequence names", _variant("fanuc-gcode", _syntax(sequenceNames=True))),
        ("fanuc + labels", _variant("fanuc-gcode", _syntax(labels="^\\s*(?<name>[A-Z_][A-Z0-9_]*):(?!=)"))),
        ("fanuc + calls", _variant("fanuc-gcode", _syntax(calls=True))),
        ("fanuc + sequence names with a digit in the prefix", _variant("fanuc-gcode", lambda p: (p["syntax"].update(sequenceNames=True), p["syntax"]["blockNumber"].update(prefix="N1")))),
        ("fanuc + free text", _variant("fanuc-gcode", _syntax(freeText=["Z\\s*(?<text>[0-9]+)", "(?<text>T[0-9]+)", "G1\\s+(?<text>X[0-9]+)"]))),
        ("fanuc + colon words and a colon comment", _variant("fanuc-gcode", _syntax(colonWords=["A1", "VC"], comments=[{"start": ":", "end": None}]))),
        ("fanuc without variables", _variant("fanuc-gcode", _syntax(variables=None))),
        ("fanuc plain text run 2", _variant("fanuc-gcode", _syntax(plainTextRun=2))),
        ("okuma case-sensitive", _variant("okuma-osp", _syntax(caseSensitive=True))),
        ("okuma + jump labels", _variant("okuma-osp", _syntax(labelAfter=["GOTO"]))),
        ("okuma + continuation", _variant("okuma-osp", cont)),
        ("okuma without reference rules", _variant("okuma-osp", no_references)),
        ("okuma without names", _variant("okuma-osp", _syntax(names=None))),
        ("okuma without variables", _variant("okuma-osp", _syntax(variables=None, systemVariables=None))),
        ("sinumerik + continuation", _variant("sinumerik", cont)),
        ("sinumerik without names", _variant("sinumerik", _syntax(names=None))),
        ("sinumerik without calls", _variant("sinumerik", _syntax(calls=False))),
        ("sinumerik without exponent", _variant("sinumerik", _syntax(exponentMarker=None))),
        ("klartext case-sensitive", _variant("heidenhain-klartext", _syntax(caseSensitive=True))),
        ("klartext without decimal comma", _variant("heidenhain-klartext", _syntax(decimalSeparatorAlt=None))),
        ("klartext without free text", _variant("heidenhain-klartext", _syntax(freeText=[]))),
        ("klartext without variables", _variant("heidenhain-klartext", _syntax(variables=None))),
        ("klartext without colon words", _variant("heidenhain-klartext", _syntax(colonWords=[]))),
        (
            "klartext + call targets",
            _variant(
                "heidenhain-klartext",
                lambda p: p["syntax"].update(
                    keywords=list(p["syntax"]["keywords"]) + ["CALL", "GOTO", "DEF"],
                    callTargets={"after": ["CALL"], "pattern": "O[A-Z0-9]{1,16}"},
                    labelAfter=["GOTO"],
                    declareAfter=["DEF"],
                ),
            ),
        ),
        ("klartext + names", _variant("heidenhain-klartext", _syntax(names="[A-Z]{2}[A-Z0-9]*"))),
        ("klartext + continuation start", _variant("heidenhain-klartext", _syntax(continuationStart="^[ \\t]*\\$"))),
    ]
    return out


# ---------------------------------------------------------------------------
# Lines
# ---------------------------------------------------------------------------

_HEADS = [
    "", "", "", "", "", " ", "\t", "  ", "/", "/ ", "/1 ", "/2", "/ /", "//", "/1 /3 ", "%", "$PART.MIN%",
    "$PART", "%_N_X_MPF", ";%_N_X_MPF", ";%", "O1234", "O12 (X)", "(C) ", ":", ":10 ", ":0020", "LOOP_A: ",
    "N10 LOOP_B: ", "/ N5 LOOP_C:", "LOOP_D:=1", "NEXT_PART:", "N", "N ", "NLAP1 ", "NFED1", "NLAP12",
    "NLAPS ", "nlap2 ", "NOEX ", "NA ", "N1A ", "L12 ", "<SHAFT_T12> ", "0 BEGIN PGM X MM", "12 ", "7 ",
    "123 ", "N5 ", "N005 ", "N 5 ",
]
_NUMBERS = ["10", "0", "1", "7", "007", "0100", "100", "99999", "123456789", "4", "20", "30", "120"]
_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_VALUES = [
    "0", "1", "10", "007", "10.5", "-3.25", "+4", ".5", "-.5", "5.", "-5.", "0.0000", "123456789012", "-0", "+.5",
    "1.", "1.5", "99.999", "-100", "2500", "1200.", "0.001",
]
#: Values that are numbers to the loop and something else to a naive reader.
_ODD_VALUES = [
    "1,5", "-2,25", ",5", "1,", "1.2.3", "1e5", "1E3", "1EX3", "2.5EX-4", "1.5ex2", "--1", "+-1", "-+1", ".", "-", "+",
    "1-2", "1+2", "-.", "1..2", "#1", "#[#1+1]", "[1+2]", "R5", "V10", "-R5", "(1)", "=5", "%", "1_000",
]
_KEYWORDS = [
    "GOTO", "IF", "THEN", "WHILE", "DO", "END", "EQ", "NE", "MOD", "SIN", "CALL", "DEF", "L", "C", "CC", "CR", "FMAX",
    "FN", "LBL", "REP", "RND", "CHF", "TOOL", "TOOL CALL", "CYCL DEF", "BEGIN PGM", "F TCP", "MAX", "MM", "STOP",
    "goto", "Tool Call", "l", "fmax", "APPR LT", "G28", "M30", "X", "Q", "RL", "RR", "R0", "R", "TCP",
]
_PERTURB = [
    "(c)", "(", ")", "; c", ";", "\"s\"", "\"", "=", "X=5", "SB=1200", "R1=3", "[", "]", "[1]", "(1,2)", "CYCLE81(1)",
    "MSG(\"A\")", ":", "VC:120", "HSC-MODE:1", "VCONST:ON", "#5", "Q5", "QL1", "V10", "VZOFZ", "$AA_IM", "R10", "<N>",
    "<A_B>", "%", "*", "~", "\\", "\xa0", "é", "ñ", "　", "\x0b", "\x0c", "\r", "NLAP1", "NA", "XNOW", "LAST_CUT",
    "AB", "ABC", "ABCD", "G1X", "XY", "XY+1", "P1X+0", "FQ50", "DR2+0.05", "IX+10", "I+5", "-", "+", ".", ",", "/", "1",
    "10", ".5", "N10", "N", "N-", ",R5", ",C", "#", "#[", "#[#1]", "EX", "EX3", "E3", "0.5EX2",
]


def _plain_word(rng: random.Random) -> str:
    letter = rng.choice(_LETTERS)
    value = rng.choice(_VALUES)
    return letter + rng.choice(["", "", "", "", " ", "  ", "\t"]) + value


def _atom(rng: random.Random, plain: float) -> str:
    roll = rng.random()
    if roll < plain:
        return _plain_word(rng)
    if roll < plain + (1 - plain) * 0.3:
        return rng.choice(_LETTERS) + rng.choice(["", " "]) + rng.choice(_ODD_VALUES)
    if roll < plain + (1 - plain) * 0.55:
        return rng.choice(_KEYWORDS)
    return rng.choice(_PERTURB)


def random_line(rng: random.Random) -> str:
    """One random line: mostly the plain shape, now and then with something in it."""
    kind = rng.random()
    if kind < 0.35:
        plain = 1.0  # nothing but the shape the shortcut takes
    elif kind < 0.65:
        plain = 0.9
    elif kind < 0.9:
        plain = 0.6
    else:
        plain = 0.2
    head = rng.choice(_HEADS)
    if head.endswith("N") or head == "N ":
        head += rng.choice(_NUMBERS)
    elif rng.random() < 0.5 and not any(ch in head for ch in ":%$;(<"):
        head += rng.choice(["N", "N", "N", "n", ":"]) + rng.choice(_NUMBERS) + rng.choice(["", " ", " ", "  ", "\t"])
    count = rng.randrange(0, 9)
    sep = rng.choice([" ", " ", "", "\t", "  "])
    body = sep.join(_atom(rng, plain) for _ in range(count))
    tail = rng.choice(["", "", "", "", "", " ", "  ", " ~", "~", " ;c", " (c)", " (N5", "\\", " *", " %", "\t"])
    return head + body + tail


def random_lines(seed: int, count: int) -> Iterator[str]:
    rng = random.Random(seed)
    for _ in range(count):
        yield random_line(rng)


def _fixture_files() -> List[Any]:
    root = helpers.FIXTURES_DIR
    files = sorted(root.rglob("*.nc"))
    files += sorted((root / "tokens").glob("*.json"))
    return files


def _token_golden_lines(path) -> List[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    lines: List[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("line", "input", "text", "lines") and isinstance(value, str):
                    lines.append(value)
                elif key in ("lines", "inputs") and isinstance(value, list):
                    lines.extend(v for v in value if isinstance(v, str))
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return lines


def golden_lines() -> List[str]:
    """Every line of the NC fixtures (``*.nc``) and every line the token goldens carry."""
    seen = {}
    for path in _fixture_files():
        if path.suffix == ".json":
            lines = _token_golden_lines(path)
        else:
            try:
                lines = helpers.read_lines(path)
            except UnicodeDecodeError:
                continue
        for line in lines:
            seen[line] = True
    return list(seen)


_POOL = (
    list("GXYZABCIJKRSFMTNOLPQUVWHDE") + list("0123456789") + list("+-.,;:()[]#=*/%$<>\"~\\_ ") + ["\t", "\xa0", "é", " "]
)


def mutate(rng: random.Random, line: str) -> str:
    """The line with one to three small changes."""
    for _ in range(rng.randrange(1, 4)):
        if line == "":
            line = rng.choice(_POOL)
            continue
        i = rng.randrange(0, len(line))
        action = rng.randrange(0, 5)
        if action == 0:
            line = line[:i] + rng.choice(_POOL) + line[i:]
        elif action == 1:
            line = line[:i] + line[i + 1 :]
        elif action == 2:
            line = line[:i] + rng.choice(_POOL) + line[i + 1 :]
        elif action == 3:
            line = line[:i] + line[i] + line[i:]
        else:
            line = line[:i]
    return line


def mutated_lines(seed: int, base: List[str], count: int) -> Iterator[str]:
    rng = random.Random(seed)
    if not base:
        return
    for _ in range(count):
        yield mutate(rng, rng.choice(base))


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------


class Tally:
    """What :func:`compare_lines` found."""

    def __init__(self) -> None:
        self.lines = 0
        self.fast = 0
        self.mismatches: List[Tuple[str, bool, Any, Any]] = []

    def merge(self, other: "Tally") -> None:
        self.lines += other.lines
        self.fast += other.fast
        self.mismatches.extend(other.mismatches)


def compare_lines(nc_lex: Any, cp: Any, lines, limit: int = 20) -> Tally:
    """Reads every line with the shortcut and with the character loop, and compares.

    Each line is read twice more behind a line that continues (``LineState(continuation=True)``),
    because that changes what the head of the block means. ``Tally.fast`` is the number of
    reads the shortcut really took, so a run that never reaches it cannot pass for a proof.
    """
    tally = Tally()
    original = nc_lex._tokenize_fast
    taken = [0]

    def counting(*args: Any, **kwargs: Any) -> bool:
        result = original(*args, **kwargs)
        if result:
            taken[0] += 1
        return result

    nc_lex._tokenize_fast = counting
    saved = nc_lex._FAST_PATH
    try:
        for index, line in enumerate(lines):
            states = [None, nc_lex.LineState(continuation=True)] if index % 3 == 0 else [None]
            for state in states:
                nc_lex._FAST_PATH = False
                expected = nc_lex.tokenize_line(line, cp, state)
                nc_lex._FAST_PATH = True
                before = taken[0]
                actual = nc_lex.tokenize_line(line, cp, state)
                tally.lines += 1
                tally.fast += taken[0] - before
                if actual != expected and len(tally.mismatches) < limit:
                    tally.mismatches.append((line, state is not None, expected, actual))
                elif actual != expected:
                    tally.mismatches.append((line, state is not None, None, None))
    finally:
        nc_lex._tokenize_fast = original
        nc_lex._FAST_PATH = saved
    return tally
